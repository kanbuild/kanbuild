import fs from 'node:fs';
import path from 'node:path';
import { RUNS_DIR, now } from './db.ts';
import { chooseBaseRef } from './dependencies.ts';
import { dependencyRefs, getFeature, moveFeature, patchFeatureState, publishFeature } from './features.ts';
import { allocateBranchAndPath, collectChanges, createWorktree, headCommit, isMerged } from './git.ts';
import { getToken } from './github.ts';
import { notify } from './notify.ts';
import { firstStep, nextStep, stepLabel, type StepRun } from './pipeline.ts';
import { createPrForFeature } from './pr.ts';
import { estimateCost, estimateCostByModel } from './pricing.ts';
import { HttpError, getProject } from './projects.ts';
import {
  buildAnswerPrompt,
  buildFixPrompt,
  buildFollowupPrompt,
  buildImplementPlanPrompt,
  buildPlanPrompt,
  buildPrompt,
  buildReplanPrompt,
  buildReviewerPrompt,
  buildTesterPrompt,
  fixMessage,
  formatAnswers,
} from './prompt.ts';
import { buildClaudeArgs, previewCommand, resolveLaunchConfig } from './launch.ts';
import { buildReport, buildValidationReport, extractSelfReport } from './report.ts';
import { LogTail, isAlive, killGroup, launchDetached, readExitCode, readStderrTail } from './runner.ts';
import { addEvent, createRun, getReport, getRun, latestCycle, listCycleRuns, listRunsByStatus, listRunsForFeature, updateRun, type NewRun, type RunRow } from './runs.ts';
import { getSettings } from './settings.ts';
import { ValidationRun, installCommand, resolveValidationCommands } from './validation.ts';
import { ACTIVE_AGENT_STATUSES, type AgentStatus, type Feature, type Gate, type Project } from '../../shared/types.ts';

const CANCEL_MARK = 'Cancellation requested';

interface ActiveRun {
  runId: string;
  featureId: string;
  tail: LogTail | null;
  cancelRequested: boolean;
  killTimer: NodeJS.Timeout | null;
  lastFlush: number;
  flushTimer: NodeJS.Timeout | null;
  /** Last time the agent produced output (stream events). */
  lastOutputAt: number;
  stallWarned: boolean;
  stallTimer: NodeJS.Timeout | null;
}

/** Warn when an agent has produced no output for this long (usually a hung test command). */
export const STALL_WARNING_MS = Number(process.env.ORCH_STALL_WARNING_MS || 5 * 60 * 1000);

/** Roles whose Claude Code session is "the feature's session" (followed up, resumed, opened in a terminal). */
const sessionOwner = (role: string) => role === 'planner' || role === 'developer';

/**
 * Agent Orchestrator + Execution Queue + Pipeline driver.
 * Queue state lives in SQLite (runs with status 'queued'), so it survives restarts. Every pipeline
 * decision is derived from the cycle's run history (see pipeline.ts), so it survives restarts too.
 */
export class Orchestrator {
  private active = new Map<string, ActiveRun>();
  private validations = new Map<string, ValidationRun>();
  private starting = new Set<string>();
  private ticking = false;

  private assertIdle(feature: Feature) {
    if (feature.agentStatus && ACTIVE_AGENT_STATUSES.includes(feature.agentStatus)) {
      throw new HttpError(409, 'An agent is already assigned to this feature');
    }
  }

  /** Card entered Build: start a new pipeline cycle (plan first, if enabled). */
  startFeature(featureId: string): Feature {
    const feature = getFeature(featureId);
    this.assertIdle(feature);
    const project = getProject(feature.projectId);
    const step = firstStep(project.pipeline, 'start');
    return this.enqueueRun(featureId, { ...step, cycle: latestCycle(featureId) + 1 });
  }

  /** Back-compat alias used by older callers/tests. */
  enqueue(featureId: string): Feature {
    return this.startFeature(featureId);
  }

  private enqueueRun(featureId: string, opts: NewRun & { cycle: number }): Feature {
    const feature = getFeature(featureId);
    const run = createRun(featureId, opts);
    const label = stepLabel(run.kind, run.role, run.fixReason);
    addEvent(run.id, 'lifecycle', `${label} queued (run #${run.attempt}, cycle ${run.cycle})${run.kind === 'followup' && run.message ? `: ${run.message}` : ''}`);
    patchFeatureState(featureId, { status: 'build', agentStatus: 'queued', currentRunId: run.id, gate: null });
    if (feature.status !== 'build') moveFeature(featureId, 'build');
    setImmediate(() => this.tick());
    return getFeature(featureId);
  }

  /** Retry the current pipeline step (same kind/role/message), or start over when nothing ran yet. */
  retry(featureId: string): Feature {
    const feature = getFeature(featureId);
    this.assertIdle(feature);
    const run = feature.currentRunId ? getRun(feature.currentRunId) : null;
    if (!run) return this.startFeature(featureId);
    return this.enqueueRun(featureId, { kind: run.kind, role: run.role, message: run.message, fixReason: run.fixReason, cycle: run.cycle });
  }

  /** Continue the feature's existing Claude Code session (`--resume`) with a new instruction (new cycle). */
  followUp(featureId: string, message: string): Feature {
    const text = message.trim();
    if (!text) throw new HttpError(400, 'A follow-up message is required');
    const feature = getFeature(featureId);
    this.assertIdle(feature);
    if (!feature.sessionId) throw new HttpError(409, 'This feature has no Claude Code session to continue yet');
    if (!feature.worktreePath || !fs.existsSync(feature.worktreePath)) {
      throw new HttpError(409, 'The worktree no longer exists, so the session cannot be resumed there');
    }
    return this.enqueueRun(featureId, { kind: 'followup', role: 'developer', message: text, cycle: latestCycle(featureId) + 1 });
  }

  /** Act on an open approval / clarification checkpoint. */
  resolveGate(featureId: string, action: 'approve' | 'reject' | 'answer', input: { comment?: string; answers?: string[] } = {}): Feature {
    const feature = getFeature(featureId);
    const gate = feature.gate;
    if (!gate) throw new HttpError(409, 'There is no open checkpoint for this feature');
    this.assertIdle(feature);
    const gateRun = getRun(gate.runId);
    if (!gateRun) throw new HttpError(409, 'The checkpoint refers to a run that no longer exists');
    const cycle = gateRun.cycle;
    const comment = input.comment?.trim() || '';
    addEvent(gateRun.id, 'lifecycle', `Checkpoint "${gate.type.replace('_', ' ')}": ${action}${comment ? ` — ${comment}` : ''}`);

    if (gate.type === 'plan_approval') {
      if (action === 'approve') return this.enqueueRun(featureId, { kind: 'feature', role: 'developer', message: comment || null, cycle });
      if (action === 'reject') {
        if (!comment) throw new HttpError(400, 'Describe what should change in the plan');
        return this.enqueueRun(featureId, { kind: 'plan', role: 'planner', message: comment, cycle });
      }
    }
    if (gate.type === 'clarification' && action === 'answer') {
      const answers = Array.isArray(input.answers) ? input.answers.map(String) : [];
      if (!answers.some((a) => a.trim())) throw new HttpError(400, 'Answer at least one question');
      const message = formatAnswers(gate.questions ?? [], answers);
      return this.enqueueRun(featureId, { kind: 'answer', role: gate.role ?? gateRun.role, message, cycle });
    }
    if (gate.type === 'final_approval') {
      if (action === 'approve') {
        this.complete(featureId);
        return getFeature(featureId);
      }
      if (action === 'reject') {
        if (!comment) throw new HttpError(400, 'Describe the changes you want');
        return this.enqueueRun(featureId, { kind: 'fix', role: 'developer', fixReason: 'user', message: fixMessage('user', { comment }), cycle });
      }
    }
    throw new HttpError(400, `Action "${action}" is not valid for this checkpoint`);
  }

  async cancel(featureId: string): Promise<Feature> {
    const feature = getFeature(featureId);
    const runId = feature.currentRunId;
    const run = runId ? getRun(runId) : null;
    if (feature.gate && (!run || !ACTIVE_AGENT_STATUSES.includes(run.status))) {
      addEvent(feature.gate.runId, 'lifecycle', 'Checkpoint closed: pipeline cancelled by user');
      return patchFeatureState(featureId, { gate: null, agentStatus: 'cancelled' });
    }
    if (!run || !ACTIVE_AGENT_STATUSES.includes(run.status)) {
      throw new HttpError(409, 'No active agent run to cancel');
    }
    if (run.status === 'queued') {
      this.finishWithoutProcess(run, 'cancelled', 'Cancelled before start');
      return getFeature(featureId);
    }
    addEvent(run.id, 'lifecycle', 'Cancellation requested');
    const validation = this.validations.get(run.id);
    if (validation) {
      validation.cancel();
      return getFeature(featureId);
    }
    const active = this.active.get(run.id);
    if (active) active.cancelRequested = true;
    updateRun(run.id, { currentActivity: 'Cancelling…', error: CANCEL_MARK });
    if (run.pid) {
      killGroup(run.pid, 'SIGTERM');
      const timer = setTimeout(() => {
        if (run.pid && isAlive(run.pid)) killGroup(run.pid, 'SIGKILL');
      }, 5000);
      if (active) active.killTimer = timer;
    } else if (!active) {
      this.finishWithoutProcess(run, 'cancelled', 'Cancelled');
    }
    return getFeature(featureId);
  }

  /** Agent processes holding a concurrency slot (validation commands don't count). */
  runningCount(): number {
    return listRunsByStatus(['initialising', 'running']).filter((r) => r.role !== 'validator').length;
  }

  /** Fill free execution slots from the queue (FIFO), skipping features waiting for dependencies. */
  tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const { concurrency } = getSettings();
      let running = this.runningCount();
      const queued = listRunsByStatus(['queued']).filter((r) => !this.starting.has(r.id));
      const waiting: RunRow[] = [];
      for (const run of queued) {
        const feature = getFeatureSafe(run.featureId);
        if (!feature) continue;
        const needsWorktree = !feature.worktreePath || !fs.existsSync(feature.worktreePath);
        if (needsWorktree && feature.blockedBy.length) {
          const activity = `Waiting for dependencies: ${feature.blockedBy.map((d) => d.title).join(', ')}`;
          if (run.currentActivity !== activity) {
            updateRun(run.id, { currentActivity: activity });
            publishFeature(run.featureId);
          }
          continue;
        }
        if (run.role !== 'validator') {
          if (running >= concurrency) {
            waiting.push(run);
            continue;
          }
          running++;
        }
        this.starting.add(run.id);
        // Mark synchronously so concurrent ticks see the slot as taken.
        updateRun(run.id, {
          status: 'initialising',
          stage: 'initialising',
          currentActivity: needsWorktree ? 'Preparing git worktree' : 'Starting',
          startedAt: now(),
        });
        patchFeatureState(run.featureId, { agentStatus: 'initialising' });
        this.start(run.id).finally(() => this.starting.delete(run.id));
      }
      waiting.forEach((r, i) => {
        const activity = `Queued (${i + 1} of ${waiting.length}) — waiting for an execution slot`;
        if (r.currentActivity !== activity) updateRun(r.id, { currentActivity: activity });
        publishFeature(r.featureId);
      });
    } finally {
      this.ticking = false;
    }
  }

  /** Create the branch + worktree, stacked on an unmerged dependency when needed. */
  private async ensureWorktree(runId: string, feature: Feature, project: Project): Promise<{ branch: string; worktreePath: string; baseRef: string }> {
    let { branch, worktreePath } = feature;
    if (branch && worktreePath && fs.existsSync(worktreePath)) {
      addEvent(runId, 'lifecycle', `Reusing existing worktree ${worktreePath} (branch ${branch})`);
      return { branch, worktreePath, baseRef: feature.baseRef || project.baseBranch };
    }
    if (branch && worktreePath) addEvent(runId, 'warning', `Previous worktree ${worktreePath} no longer exists; creating a new one`);
    const deps = await Promise.all(
      dependencyRefs(feature.id).map(async (d) => {
        const dep = getFeatureSafe(d.id);
        const depBranch = dep?.branch ?? null;
        return { title: d.title, branch: depBranch, merged: depBranch ? await isMerged(project.path, depBranch, project.baseBranch) : true };
      }),
    );
    const choice = chooseBaseRef(project.baseBranch, deps);
    if ('error' in choice) throw new Error(choice.error);
    const alloc = await allocateBranchAndPath(project.path, project.worktreeRoot, feature.title, feature.id);
    if (choice.stackedOn) addEvent(runId, 'lifecycle', `Stacking on dependency "${choice.stackedOn}" (branch ${choice.ref}, not merged into ${project.baseBranch} yet)`);
    addEvent(runId, 'lifecycle', `Creating worktree ${alloc.worktreePath} on branch ${alloc.branch} from ${choice.ref}`);
    await createWorktree(project.path, alloc.worktreePath, alloc.branch, choice.ref);
    patchFeatureState(feature.id, { branch: alloc.branch, worktreePath: alloc.worktreePath, baseRef: choice.ref });
    return { ...alloc, baseRef: choice.ref };
  }

  private async start(runId: string) {
    const run = getRun(runId)!;
    let feature: Feature;
    try {
      feature = getFeature(run.featureId);
    } catch {
      updateRun(runId, { status: 'cancelled', endedAt: now(), error: 'Feature deleted' });
      return;
    }
    const project = getProject(feature.projectId);
    const settings = getSettings();
    addEvent(runId, 'lifecycle', `Initialising: ${stepLabel(run.kind, run.role, run.fixReason)}`);

    try {
      const resumesSession = run.kind === 'followup' || run.kind === 'fix';
      if (resumesSession && (!feature.worktreePath || !fs.existsSync(feature.worktreePath))) {
        throw new Error('Cannot continue: the worktree is missing');
      }
      const { branch, worktreePath, baseRef } = await this.ensureWorktree(runId, feature, project);
      feature = getFeature(feature.id);
      if (this.wasCancelledMeanwhile(runId)) return;

      if (run.role === 'validator') {
        await this.runValidation(run, feature, project, worktreePath);
        return;
      }

      // Pick the prompt and the session to resume for this step.
      const cfg = resolveLaunchConfig(project, settings, run.role);
      const cycleRuns = listCycleRuns(feature.id, run.cycle);
      const planned = cycleRuns.some((r) => r.role === 'planner' && r.status === 'completed' && r.sessionId);
      let prompt: string;
      let resume: string | null = null;
      switch (run.kind) {
        case 'plan':
          if (run.message && feature.sessionId) {
            prompt = buildReplanPrompt(run.message);
            resume = feature.sessionId;
          } else prompt = buildPlanPrompt(feature, project, branch, cfg, baseRef);
          break;
        case 'feature':
          if (planned && feature.sessionId) {
            prompt = buildImplementPlanPrompt(project, branch, cfg, run.message);
            resume = feature.sessionId;
          } else {
            const attempt = listRunsForFeature(feature.id).filter((r) => r.kind === 'feature' && r.attempt <= run.attempt).length;
            prompt = buildPrompt(feature, project, branch, attempt, cfg, baseRef);
          }
          break;
        case 'fix':
          prompt = buildFixPrompt(run.fixReason ?? 'user', run.message ?? '', project, branch, cfg);
          resume = feature.sessionId;
          if (!resume) prompt = `${buildPrompt(feature, project, branch, 2, cfg, baseRef)}\n\n# Also fix\n${run.message ?? ''}`;
          break;
        case 'test':
          prompt = buildTesterPrompt(feature, project, branch, baseRef, cfg);
          break;
        case 'review':
          prompt = buildReviewerPrompt(feature, project, branch, baseRef, cfg);
          break;
        case 'answer': {
          const asker = [...cycleRuns].reverse().find((r) => r.attempt < run.attempt && r.role === run.role && r.sessionId);
          resume = asker?.sessionId ?? (sessionOwner(run.role) ? feature.sessionId : null);
          if (!resume) throw new Error('Cannot find the session that asked the questions');
          prompt = buildAnswerPrompt(run.role, run.message ?? '');
          break;
        }
        case 'followup':
        default:
          if (!feature.sessionId) throw new Error('Cannot resume: the Claude Code session is missing');
          prompt = buildFollowupPrompt(run.message ?? '', branch);
          resume = feature.sessionId;
      }

      const logDir = path.join(RUNS_DIR, runId);
      const args = buildClaudeArgs(prompt, cfg, { resumeSessionId: resume });
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, 'prompt.md'), prompt);
      fs.writeFileSync(path.join(logDir, 'command.txt'), previewCommand(settings.claudeBinary, args) + '\n');
      addEvent(
        runId,
        'system',
        `Launch: ${run.role} (${cfg.readOnly ? 'read-only' : 'can edit'}), profile ${cfg.profile}${cfg.model ? `, model ${cfg.model}` : ''}${cfg.effort ? `, effort ${cfg.effort}` : ''}${cfg.maxBudgetUsd ? `, budget $${cfg.maxBudgetUsd}` : ''}${resume ? `, resuming session ${resume}` : ', new session'}`,
        previewCommand(settings.claudeBinary, args),
      );

      const pid = launchDetached({ logDir, cwd: worktreePath, binary: settings.claudeBinary, args });
      updateRun(runId, {
        status: 'running',
        pid,
        logDir,
        logOffset: 0,
        stage: run.role === 'reviewer' ? 'reviewing' : run.role === 'tester' ? 'testing' : 'planning',
        currentActivity: 'Starting Claude Code',
        model: cfg.model || null,
      });
      patchFeatureState(feature.id, { agentStatus: 'running' });
      addEvent(runId, 'lifecycle', `Claude Code launched (pid ${pid}) in ${worktreePath}`);
      this.attach(getRun(runId)!, 0);
    } catch (err: any) {
      addEvent(runId, 'error', `Failed to start: ${err.message}`);
      this.finishWithoutProcess(getRun(runId)!, 'failed', err.message);
    }
  }

  /** Validator step: the orchestrator runs the project's validation commands itself (no agent, no tokens). */
  private async runValidation(run: RunRow, feature: Feature, project: Project, worktreePath: string) {
    const resolved = resolveValidationCommands(project.pipeline.validationCommands, worktreePath);
    const install = installCommand(worktreePath);
    const commands = [...(install && resolved.commands.length ? [install] : []), ...resolved.commands];
    const startedAt = Date.now();
    updateRun(run.id, { status: 'running', stage: 'validating', currentActivity: `Running ${commands.length} validation command(s)`, progress: 0 });
    patchFeatureState(feature.id, { agentStatus: 'running' });
    addEvent(run.id, 'system', `Validation commands (${resolved.source}): ${commands.join(' && ') || 'none'}`);

    let done = 0;
    let buffer = '';
    let lastFlush = 0;
    const flush = () => {
      if (!buffer) return;
      const lines = buffer.split('\n').filter((l) => l.trim());
      if (lines.length) addEvent(run.id, 'tool_result', lines[lines.length - 1].slice(0, 300), buffer.slice(-4000));
      buffer = '';
      lastFlush = Date.now();
    };
    const v = new ValidationRun(worktreePath, commands, {
      onStart: (c) => {
        flush();
        addEvent(run.id, 'tool_use', `Running: ${c}`);
        updateRun(run.id, { currentActivity: `Running: ${c}` });
      },
      onOutput: (_c, chunk) => {
        buffer += chunk + '\n';
        if (Date.now() - lastFlush > 1000) flush();
      },
      onResult: (r) => {
        flush();
        done++;
        const ok = r.exitCode === 0 && !r.timedOut;
        addEvent(
          run.id,
          ok ? 'lifecycle' : 'error',
          `${ok ? '✓' : '✗'} ${r.command} — ${r.timedOut ? 'timed out' : `exit ${r.exitCode}`} (${(r.durationMs / 1000).toFixed(1)}s)`,
          ok ? null : r.output.split('\n').slice(-80).join('\n'),
        );
        updateRun(run.id, { progress: Math.round((done / Math.max(1, commands.length)) * 100) });
      },
    });
    this.validations.set(run.id, v);
    let results: Awaited<ReturnType<ValidationRun['run']>> = [];
    try {
      results = await v.run();
    } finally {
      this.validations.delete(run.id);
    }
    const failed = results.find((r) => r.exitCode !== 0 || r.timedOut);
    const status: AgentStatus = v.wasCancelled ? 'cancelled' : failed ? 'failed' : 'completed';
    const error = v.wasCancelled ? 'Cancelled by user' : failed ? `Validation failed: ${failed.command} (${failed.timedOut ? 'timed out' : `exit ${failed.exitCode}`})` : null;
    const changes = await collectChanges(worktreePath, feature.branch, feature.baseRef || project.baseBranch);
    const report = buildValidationReport({
      runId: run.id,
      feature,
      project,
      status,
      results,
      changes,
      durationMs: Date.now() - startedAt,
      note: commands.length ? undefined : `No validation commands configured or detected (${resolved.source}).`,
    });
    updateRun(run.id, {
      status,
      endedAt: now(),
      error,
      validation: results,
      report,
      progress: status === 'completed' ? 100 : null,
      stage: status === 'completed' ? 'done' : 'validating',
      currentActivity: status === 'completed' ? 'Validation passed' : status === 'cancelled' ? 'Cancelled' : 'Validation failed',
      commitHash: changes.headCommit,
    });
    addEvent(run.id, status === 'completed' ? 'lifecycle' : 'error', `Validation ${status}${error ? `: ${error}` : ''}`);
    const f = getFeatureSafe(run.featureId);
    if (f && f.currentRunId === run.id) {
      patchFeatureState(f.id, { agentStatus: status });
      if (status !== 'cancelled') this.advance(f.id, run.id);
    }
    this.tick();
  }

  private wasCancelledMeanwhile(runId: string): boolean {
    const r = getRun(runId);
    return !r || r.status === 'cancelled';
  }

  /** Attach a log tailer to a running process (fresh launch or recovered after restart). */
  attach(run: RunRow, resumeOffset: number) {
    if (!run.logDir) return;
    const state: ActiveRun = {
      runId: run.id,
      featureId: run.featureId,
      tail: null,
      cancelRequested: false,
      killTimer: null,
      lastFlush: 0,
      flushTimer: null,
      lastOutputAt: Date.now(),
      stallWarned: false,
      stallTimer: null,
    };
    state.stallTimer = setInterval(() => this.checkStall(state), Math.min(30000, Math.max(1000, STALL_WARNING_MS / 4)));
    state.stallTimer.unref?.();
    const tail = new LogTail(run.logDir, run.pid, {
      onEvents: (events, offset) => {
        if (events.length) {
          state.lastOutputAt = Date.now();
          if (state.stallWarned) {
            state.stallWarned = false;
            addEvent(run.id, 'lifecycle', 'Agent output resumed');
          }
        }
        for (const e of events) addEvent(run.id, e.kind, e.summary, e.detail ?? null);
        this.scheduleFlush(state, offset, run.role);
      },
      onStderr: (text) => {
        for (const line of text.split('\n').slice(-20)) if (line.trim()) addEvent(run.id, 'stderr', line.slice(0, 500));
      },
      onExit: (code) => {
        this.finalize(state, code).catch((err) => console.error('[orchestrator] finalize failed', err));
      },
    });
    state.tail = tail;
    this.active.set(run.id, state);
    tail.start(resumeOffset);
  }

  /** Flag runs that have been silent for a long time (typically a test command that never exits). */
  private checkStall(state: ActiveRun) {
    if (state.stallWarned || state.cancelRequested || Date.now() - state.lastOutputAt < STALL_WARNING_MS) return;
    state.stallWarned = true;
    const run = getRun(state.runId);
    if (!run || run.status !== 'running') return;
    const minutes = Math.round((Date.now() - state.lastOutputAt) / 60000);
    const doing = run.currentActivity ? `: ${run.currentActivity}` : '';
    addEvent(
      run.id,
      'warning',
      `No output from the agent for ${minutes} min${doing}. A test or build command may be hanging (watch mode, open handles, watchman). Cancel the run if it doesn't recover.`,
    );
    const f = getFeatureSafe(state.featureId);
    if (f) notify({ title: 'Agent seems stuck', body: `${f.title}${doing}`, level: 'attention', featureId: f.id, projectId: f.projectId });
  }

  /** Persist parser state at most ~once per second. */
  private scheduleFlush(state: ActiveRun, offset: number, role: string) {
    const doFlush = () => {
      state.flushTimer = null;
      state.lastFlush = Date.now();
      const p = state.tail!.parser;
      const usage = p.usage;
      const model = p.model;
      updateRun(state.runId, {
        logOffset: offset,
        progress: p.progress,
        stage: p.stage ?? undefined,
        currentActivity: p.currentActivity ?? undefined,
        usage,
        metrics: p.metrics,
        model: model ?? undefined,
        sessionId: p.sessionId ?? undefined,
        estimatedCostUsd: estimateCost(usage, model),
      });
      const f = getFeatureSafe(state.featureId);
      if (p.sessionId && sessionOwner(role) && f && f.sessionId !== p.sessionId && f.currentRunId === state.runId) {
        patchFeatureState(state.featureId, { sessionId: p.sessionId });
      } else publishFeature(state.featureId);
    };
    if (Date.now() - state.lastFlush > 1000) doFlush();
    else if (!state.flushTimer) state.flushTimer = setTimeout(doFlush, 1000);
  }

  private async finalize(state: ActiveRun, exitCode: number | null) {
    if (state.flushTimer) clearTimeout(state.flushTimer);
    if (state.killTimer) clearTimeout(state.killTimer);
    if (state.stallTimer) clearInterval(state.stallTimer);
    this.active.delete(state.runId);
    const run = getRun(state.runId);
    if (!run) return;
    const parser = state.tail!.parser;
    const result = parser.result;
    const feature = getFeatureSafe(run.featureId);

    let status: AgentStatus;
    let error: string | null = null;
    const cancelled = state.cancelRequested || run.error === CANCEL_MARK;
    if (cancelled) {
      status = 'cancelled';
      error = 'Cancelled by user';
    } else if (result && !result.isError && (exitCode === 0 || exitCode === null)) {
      status = 'completed';
    } else {
      status = 'failed';
      if (result?.isError) error = `Claude Code reported an error (${result.subtype})${result.text ? `: ${result.text.slice(0, 300)}` : ''}`;
      else if (!result && exitCode === null) error = 'Agent process terminated unexpectedly';
      else if (!result) error = `Claude Code exited with code ${exitCode} without a result`;
      else error = `Claude Code exited with code ${exitCode}`;
      const stderr = readStderrTail(run.logDir || '');
      if (stderr.trim() && !result) error += `\n${stderr.trim().slice(-1000)}`;
    }

    updateRun(run.id, { stage: 'reporting', currentActivity: 'Generating report' });

    const usage = parser.usage;
    const model = parser.model || run.model;
    const estimatedCostUsd = result?.modelUsage ? estimateCostByModel(result.modelUsage) ?? estimateCost(usage, model) : estimateCost(usage, model);
    const endedAt = now();
    const durationMs = result?.durationMs ?? (run.startedAt ? Date.parse(endedAt) - Date.parse(run.startedAt) : null);

    let report = null;
    let commit: string | null = null;
    if (feature) {
      try {
        const project = getProject(feature.projectId);
        const changes = await collectChanges(feature.worktreePath, feature.branch, feature.baseRef || project.baseBranch);
        commit = changes.headCommit ?? (feature.worktreePath ? await headCommit(feature.worktreePath) : null);
        report = buildReport({
          runId: run.id,
          feature,
          project,
          status,
          self: extractSelfReport(result?.text ?? parser.lastText),
          changes,
          usage,
          estimatedCostUsd,
          reportedCostUsd: result?.totalCostUsd ?? null,
          durationMs,
          model,
          error,
          metrics: parser.metrics,
          kind: run.kind,
          role: run.role,
          fixReason: run.fixReason,
          message: run.message,
        });
        if (report.self.tests.failed && report.self.tests.failed > 0) {
          addEvent(run.id, 'warning', `Agent reported ${report.self.tests.failed} failing test(s)`);
        }
      } catch (err: any) {
        addEvent(run.id, 'error', `Report generation failed: ${err.message}`);
      }
    }

    updateRun(run.id, {
      status,
      endedAt,
      exitCode,
      error,
      progress: status === 'completed' ? 100 : parser.progress,
      stage: status === 'completed' ? 'done' : parser.stage,
      currentActivity: status === 'completed' ? 'Completed' : status === 'cancelled' ? 'Cancelled' : 'Failed',
      usage,
      metrics: parser.metrics,
      model,
      sessionId: parser.sessionId,
      reportedCostUsd: result?.totalCostUsd ?? null,
      estimatedCostUsd,
      commitHash: commit,
      report: report ?? undefined,
    });
    addEvent(run.id, status === 'failed' ? 'error' : 'lifecycle', `Run ${status}${error ? `: ${error.split('\n')[0]}` : ''}`);

    if (feature && feature.currentRunId === run.id) {
      patchFeatureState(feature.id, {
        agentStatus: status,
        sessionId: sessionOwner(run.role) ? parser.sessionId ?? feature.sessionId : feature.sessionId,
      });
      if (status === 'failed') {
        notify({ title: `${stepLabel(run.kind, run.role, run.fixReason)} failed`, body: feature.title, level: 'error', featureId: feature.id, projectId: feature.projectId });
      }
      if (status !== 'cancelled') this.advance(feature.id, run.id);
    }
    this.tick();
  }

  /** Decide and apply the next pipeline step after a run finished. Never throws: a failure is shown on the card. */
  advance(featureId: string, runId: string) {
    try {
      this.applyNextStep(featureId, runId);
    } catch (err: any) {
      console.error('[orchestrator] pipeline step failed', err);
      addEvent(runId, 'error', `Could not start the next pipeline step: ${err.message}. Use "Continue pipeline" to try again.`);
      const f = getFeatureSafe(featureId);
      if (f) notify({ title: 'Pipeline paused', body: `${f.title}: ${err.message}`, level: 'error', featureId, projectId: f.projectId });
    }
  }

  /**
   * Re-run the pipeline decision for a feature whose last step finished but that is not waiting for
   * anything (no checkpoint, no active run), e.g. after an error while starting the next step.
   */
  continuePipeline(featureId: string): Feature {
    const feature = getFeature(featureId);
    this.assertIdle(feature);
    if (feature.gate) throw new HttpError(409, 'The pipeline is waiting at a checkpoint; use the checkpoint panel');
    if (feature.status !== 'build' || feature.agentStatus !== 'completed' || !feature.currentRunId) {
      throw new HttpError(409, 'There is no finished step to continue from');
    }
    this.advance(featureId, feature.currentRunId);
    return getFeature(featureId);
  }

  private applyNextStep(featureId: string, runId: string) {
    const feature = getFeatureSafe(featureId);
    const run = getRun(runId);
    if (!feature || !run || feature.currentRunId !== runId) return;
    const project = getProject(feature.projectId);
    const cycleRuns = listCycleRuns(featureId, run.cycle);
    const history: StepRun[] = cycleRuns.map((r) => {
      const self = getReport(r.id)?.self;
      return {
        kind: r.kind,
        role: r.role,
        status: r.status,
        fixReason: r.fixReason,
        questions: self?.needsClarification ?? [],
        plan: self?.plan ?? '',
        review: self?.review ?? null,
        validation: r.validation,
      };
    });
    const hasValidationCommands = resolveValidationCommands(project.pipeline.validationCommands, feature.worktreePath).commands.length > 0;
    const decision = nextStep({ config: project.pipeline, hasValidationCommands }, history);
    const last = history[history.length - 1];

    switch (decision.type) {
      case 'run': {
        let message: string | null = null;
        if (decision.fixReason === 'validation') message = fixMessage('validation', { validation: last.validation ?? [] });
        if (decision.fixReason === 'review') message = fixMessage('review', { findings: last.review?.findings ?? [], reviewSummary: last.review?.summary });
        addEvent(runId, 'lifecycle', `Next step: ${decision.reason}`);
        this.enqueueRun(featureId, { kind: decision.kind, role: decision.role, fixReason: decision.fixReason ?? null, message, cycle: run.cycle });
        return;
      }
      case 'gate': {
        const gate: Gate = { ...decision.gate, runId, openedAt: now() };
        patchFeatureState(featureId, { gate });
        const meta = {
          plan_approval: ['Plan ready for your approval', 'Waiting for plan approval'],
          clarification: ['The agent has questions', 'Waiting for your answers'],
          final_approval: ['Ready for your approval', 'Waiting for final approval'],
        }[gate.type];
        updateRun(runId, { currentActivity: meta[1] });
        addEvent(runId, 'lifecycle', `Checkpoint: ${meta[1].toLowerCase()}`);
        notify({ title: meta[0], body: feature.title, level: 'attention', featureId, projectId: feature.projectId });
        return;
      }
      case 'done':
        this.complete(featureId);
        return;
      case 'stop':
        if (decision.error) {
          updateRun(runId, { status: 'failed', error: decision.error, currentActivity: 'Pipeline stopped' });
          patchFeatureState(featureId, { agentStatus: 'failed' });
          addEvent(runId, 'error', decision.error);
          notify({ title: 'Pipeline stopped', body: `${feature.title}: ${decision.error}`, level: 'error', featureId, projectId: feature.projectId });
        }
        return;
      case 'idle':
        return;
    }
  }

  /** Pipeline finished (or the user approved it): move to Done and optionally open a PR. */
  private complete(featureId: string) {
    const feature = patchFeatureState(featureId, { gate: null, agentStatus: 'completed' });
    if (feature.status !== 'done') moveFeature(featureId, 'done');
    if (feature.currentRunId) addEvent(feature.currentRunId, 'lifecycle', 'Pipeline complete; feature moved to Done');
    notify({ title: 'Feature done', body: feature.title, level: 'success', featureId, projectId: feature.projectId });
    const project = getProject(feature.projectId);
    if (project.pipeline.autoCreatePr && getToken() && !feature.prUrl) {
      createPrForFeature(featureId).catch((err) => {
        if (feature.currentRunId) addEvent(feature.currentRunId, 'error', `Automatic pull request failed: ${err.message}`);
        notify({ title: 'Pull request failed', body: `${feature.title}: ${err.message}`, level: 'error', featureId, projectId: feature.projectId });
      });
    }
    this.tick();
  }

  private finishWithoutProcess(run: RunRow, status: AgentStatus, error: string) {
    updateRun(run.id, { status, endedAt: now(), error, currentActivity: status === 'cancelled' ? 'Cancelled' : 'Failed' });
    addEvent(run.id, status === 'failed' ? 'error' : 'lifecycle', `Run ${status}: ${error}`);
    const feature = getFeatureSafe(run.featureId);
    if (feature && feature.currentRunId === run.id) {
      patchFeatureState(feature.id, { agentStatus: status });
      if (status === 'failed') notify({ title: `${stepLabel(run.kind, run.role, run.fixReason)} failed`, body: `${feature.title}: ${error.split('\n')[0]}`, level: 'error', featureId: feature.id, projectId: feature.projectId });
    }
    this.tick();
  }

  /**
   * Startup reconciliation: reattach to agents still running, finalize those that finished
   * while the backend was down, fail those that died, and resume the queue. Validation runs
   * (in-process, idempotent) are simply re-queued. Open checkpoints live in the DB and need nothing.
   */
  recover() {
    for (const run of listRunsByStatus(['initialising', 'running'])) {
      if (!run.logDir || !run.pid) {
        updateRun(run.id, { status: 'queued', stage: 'queued', currentActivity: 'Re-queued after restart', progress: null });
        addEvent(run.id, 'warning', run.role === 'validator' ? 'Backend restarted during validation; validation re-queued' : 'Backend restarted during initialisation; run re-queued');
        patchFeatureState(run.featureId, { agentStatus: 'queued' });
        continue;
      }
      const alive = isAlive(run.pid) && readExitCode(run.logDir) === null;
      addEvent(
        run.id,
        'lifecycle',
        alive ? `Backend restarted; reattached to running agent (pid ${run.pid})` : 'Backend restarted; agent process has finished, reconciling',
      );
      this.attach(run, run.logOffset);
    }
    this.tick();
  }

  shutdown() {
    for (const a of this.active.values()) {
      a.tail?.stop();
      if (a.flushTimer) clearTimeout(a.flushTimer);
      if (a.killTimer) clearTimeout(a.killTimer);
      if (a.stallTimer) clearInterval(a.stallTimer);
    }
    this.active.clear();
    for (const v of this.validations.values()) v.cancel();
    this.validations.clear();
  }
}

function getFeatureSafe(id: string): Feature | null {
  try {
    return getFeature(id);
  } catch {
    return null;
  }
}

export const orchestrator = new Orchestrator();
