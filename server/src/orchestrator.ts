import fs from 'node:fs';
import path from 'node:path';
import { RUNS_DIR, now } from './db.ts';
import { getFeature, moveFeature, patchFeatureState, publishFeature } from './features.ts';
import { allocateBranchAndPath, collectChanges, createWorktree, headCommit } from './git.ts';
import { estimateCost, estimateCostByModel } from './pricing.ts';
import { HttpError, getProject } from './projects.ts';
import { buildPrompt } from './prompt.ts';
import { buildReport, extractSelfReport } from './report.ts';
import { LogTail, isAlive, killGroup, launchDetached, readExitCode, readStderrTail } from './runner.ts';
import { addEvent, createRun, getRun, listRunsByStatus, updateRun, type RunRow } from './runs.ts';
import { getSettings } from './settings.ts';
import { ACTIVE_AGENT_STATUSES, type AgentStatus, type Feature } from '../../shared/types.ts';

const CANCEL_MARK = 'Cancellation requested';

interface ActiveRun {
  runId: string;
  featureId: string;
  tail: LogTail | null;
  cancelRequested: boolean;
  killTimer: NodeJS.Timeout | null;
  lastFlush: number;
  flushTimer: NodeJS.Timeout | null;
}

/**
 * Agent Orchestrator + Execution Queue.
 * Queue state lives in SQLite (runs with status 'queued'), so it survives restarts.
 */
export class Orchestrator {
  private active = new Map<string, ActiveRun>();
  private starting = new Set<string>();
  private ticking = false;

  /** Start (or restart) development of a feature: create a run and enqueue it. */
  enqueue(featureId: string): Feature {
    const feature = getFeature(featureId);
    if (feature.agentStatus && ACTIVE_AGENT_STATUSES.includes(feature.agentStatus)) {
      throw new HttpError(409, 'An agent is already assigned to this feature');
    }
    const run = createRun(featureId);
    addEvent(run.id, 'lifecycle', `Run #${run.attempt} queued`);
    patchFeatureState(featureId, { status: 'build', agentStatus: 'queued', currentRunId: run.id });
    if (feature.status !== 'build') moveFeature(featureId, 'build');
    setImmediate(() => this.tick());
    return getFeature(featureId);
  }

  retry(featureId: string): Feature {
    return this.enqueue(featureId);
  }

  async cancel(featureId: string): Promise<Feature> {
    const feature = getFeature(featureId);
    const runId = feature.currentRunId;
    const run = runId ? getRun(runId) : null;
    if (!run || !ACTIVE_AGENT_STATUSES.includes(run.status)) {
      throw new HttpError(409, 'No active agent run to cancel');
    }
    if (run.status === 'queued') {
      this.finishWithoutProcess(run, 'cancelled', 'Cancelled before start');
      return getFeature(featureId);
    }
    const active = this.active.get(run.id);
    if (active) active.cancelRequested = true;
    addEvent(run.id, 'lifecycle', 'Cancellation requested');
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

  runningCount(): number {
    return listRunsByStatus(['initialising', 'running']).length;
  }

  /** Fill free execution slots from the queue (FIFO). */
  tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const { concurrency } = getSettings();
      let running = this.runningCount();
      const queued = listRunsByStatus(['queued']).filter((r) => !this.starting.has(r.id));
      for (const run of queued) {
        if (running >= concurrency) break;
        running++;
        this.starting.add(run.id);
        // Mark synchronously so concurrent ticks see the slot as taken.
        updateRun(run.id, { status: 'initialising', stage: 'initialising', currentActivity: 'Preparing git worktree', startedAt: now() });
        patchFeatureState(run.featureId, { agentStatus: 'initialising' });
        this.start(run.id).finally(() => this.starting.delete(run.id));
      }
      this.updateQueuePositions();
    } finally {
      this.ticking = false;
    }
  }

  private updateQueuePositions() {
    const queued = listRunsByStatus(['queued']);
    queued.forEach((r, i) => {
      const activity = `Queued (${i + 1} of ${queued.length}) — waiting for an execution slot`;
      if (r.currentActivity !== activity) updateRun(r.id, { currentActivity: activity });
      publishFeature(r.featureId);
    });
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
    addEvent(runId, 'lifecycle', 'Initialising');

    try {
      // 1-3. Branch + isolated worktree (reused on retry if it still exists).
      let branch = feature.branch;
      let worktreePath = feature.worktreePath;
      if (!branch || !worktreePath || !fs.existsSync(worktreePath)) {
        if (branch && worktreePath && !fs.existsSync(worktreePath)) {
          addEvent(runId, 'warning', `Previous worktree ${worktreePath} no longer exists; creating a new one`);
        }
        const alloc = await allocateBranchAndPath(project.path, project.worktreeRoot, feature.title, feature.id);
        branch = alloc.branch;
        worktreePath = alloc.worktreePath;
        addEvent(runId, 'lifecycle', `Creating worktree ${worktreePath} on branch ${branch} from ${project.baseBranch}`);
        await createWorktree(project.path, worktreePath, branch, project.baseBranch);
        patchFeatureState(feature.id, { branch, worktreePath });
      } else {
        addEvent(runId, 'lifecycle', `Reusing existing worktree ${worktreePath} (branch ${branch})`);
      }

      if (this.wasCancelledMeanwhile(runId)) return;

      // 4-6. Launch Claude Code inside the worktree.
      const logDir = path.join(RUNS_DIR, runId);
      const prompt = buildPrompt(feature, project, branch, run.attempt);
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, 'prompt.md'), prompt);
      const model = project.model || settings.defaultModel;
      const args = [
        '-p',
        prompt,
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'acceptEdits',
      ];
      if (project.allowedTools.length) args.push('--allowedTools', project.allowedTools.join(','));
      if (model) args.push('--model', model);

      const pid = launchDetached({ logDir, cwd: worktreePath, binary: settings.claudeBinary, args });
      updateRun(runId, {
        status: 'running',
        pid,
        logDir,
        logOffset: 0,
        stage: 'planning',
        currentActivity: 'Starting Claude Code',
        model: model || null,
      });
      patchFeatureState(feature.id, { agentStatus: 'running' });
      addEvent(runId, 'lifecycle', `Claude Code launched (pid ${pid}) in ${worktreePath}`);
      this.attach(getRun(runId)!, 0);
    } catch (err: any) {
      addEvent(runId, 'error', `Failed to start agent: ${err.message}`);
      this.finishWithoutProcess(getRun(runId)!, 'failed', err.message);
    }
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
    };
    const tail = new LogTail(run.logDir, run.pid, {
      onEvents: (events, offset) => {
        for (const e of events) addEvent(run.id, e.kind, e.summary, e.detail ?? null);
        this.scheduleFlush(state, offset);
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

  /** Persist parser state at most ~once per second. */
  private scheduleFlush(state: ActiveRun, offset: number) {
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
        model: model ?? undefined,
        sessionId: p.sessionId ?? undefined,
        estimatedCostUsd: estimateCost(usage, model),
      });
      if (p.sessionId) {
        const f = getFeatureSafe(state.featureId);
        if (f && f.sessionId !== p.sessionId) patchFeatureState(state.featureId, { sessionId: p.sessionId });
        else publishFeature(state.featureId);
      } else publishFeature(state.featureId);
    };
    if (Date.now() - state.lastFlush > 1000) doFlush();
    else if (!state.flushTimer) state.flushTimer = setTimeout(doFlush, 1000);
  }

  private async finalize(state: ActiveRun, exitCode: number | null) {
    if (state.flushTimer) clearTimeout(state.flushTimer);
    if (state.killTimer) clearTimeout(state.killTimer);
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

    updateRun(run.id, { stage: 'reporting', currentActivity: 'Generating implementation report' });

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
        const changes = await collectChanges(feature.worktreePath, feature.branch, project.baseBranch);
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
      model,
      sessionId: parser.sessionId,
      reportedCostUsd: result?.totalCostUsd ?? null,
      estimatedCostUsd,
      commitHash: commit,
      report: report ?? undefined,
    });
    addEvent(run.id, status === 'failed' ? 'error' : 'lifecycle', `Run ${status}${error ? `: ${error.split('\n')[0]}` : ''}`);

    if (feature && feature.currentRunId === run.id) {
      patchFeatureState(feature.id, { agentStatus: status, sessionId: parser.sessionId ?? feature.sessionId });
      // 10. Successful features move to Done automatically.
      if (status === 'completed' && feature.status === 'build') moveFeature(feature.id, 'done');
    }
    this.tick();
  }

  private finishWithoutProcess(run: RunRow, status: AgentStatus, error: string) {
    updateRun(run.id, { status, endedAt: now(), error, currentActivity: status === 'cancelled' ? 'Cancelled' : 'Failed' });
    addEvent(run.id, status === 'failed' ? 'error' : 'lifecycle', `Run ${status}: ${error}`);
    const feature = getFeatureSafe(run.featureId);
    if (feature && feature.currentRunId === run.id) patchFeatureState(feature.id, { agentStatus: status });
    this.tick();
  }

  /**
   * Startup reconciliation: reattach to agents still running, finalize those that finished
   * while the backend was down, fail those that died, and resume the queue.
   */
  recover() {
    for (const run of listRunsByStatus(['initialising', 'running'])) {
      if (!run.logDir || !run.pid) {
        // Crashed during initialisation, before a process existed: put it back in the queue.
        updateRun(run.id, { status: 'queued', stage: 'queued', currentActivity: 'Re-queued after restart' });
        addEvent(run.id, 'warning', 'Backend restarted during initialisation; run re-queued');
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
    }
    this.active.clear();
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
