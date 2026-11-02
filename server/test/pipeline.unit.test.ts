import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { firstStep, nextStep, type StepRun } from '../src/pipeline.ts';
import { parseUnifiedDiff } from '../src/diffParse.ts';
import { chooseBaseRef, findCycle } from '../src/dependencies.ts';
import { parseRemote } from '../src/github.ts';
import { DISALLOWED_FOR_READ_ONLY, buildClaudeArgs, resolveLaunchConfig } from '../src/launch.ts';
import { DEFAULT_PIPELINE, cleanPipeline } from '../src/projects.ts';
import { systemNotificationArgs, shouldNotify } from '../src/notify.ts';
import { detectValidationCommands, installCommand } from '../src/validation.ts';
import { extractSelfReport } from '../src/report.ts';
import { buildAnswerPrompt, buildFixPrompt, buildPlanPrompt, buildReviewerPrompt, fixMessage, formatAnswers } from '../src/prompt.ts';
import type { Feature, PipelineConfig, Project, Settings } from '../../shared/types.ts';

const run = (p: Partial<StepRun>): StepRun => ({
  kind: 'feature', role: 'developer', status: 'completed', fixReason: null, questions: [], plan: '', review: null, validation: null, ...p,
});
const ok = [{ command: 'npm test', exitCode: 0, durationMs: 1, timedOut: false, output: '' }];
const bad = [{ command: 'npm test', exitCode: 1, durationMs: 1, timedOut: false, output: 'boom' }];
const cfg = (p: Partial<PipelineConfig> = {}) => ({ config: { ...DEFAULT_PIPELINE, ...p }, hasValidationCommands: true });

describe('pipeline.nextStep', () => {
  it('starts with a plan when enabled', () => {
    expect(firstStep(DEFAULT_PIPELINE, 'start')).toEqual({ kind: 'plan', role: 'planner' });
    expect(firstStep({ ...DEFAULT_PIPELINE, plan: false }, 'start')).toEqual({ kind: 'feature', role: 'developer' });
    expect(firstStep(DEFAULT_PIPELINE, 'followup')).toEqual({ kind: 'followup', role: 'developer' });
  });

  it('gates the plan, or goes straight to development', () => {
    const plan = [run({ kind: 'plan', role: 'planner', plan: '1. do it' })];
    expect(nextStep(cfg(), plan)).toEqual({ type: 'gate', gate: { type: 'plan_approval', plan: '1. do it' } });
    expect(nextStep(cfg({ planApproval: false }), plan)).toMatchObject({ type: 'run', kind: 'feature', role: 'developer' });
  });

  it('validates after development, then tests, then validates again, then finishes', () => {
    const h = [run({ kind: 'plan', role: 'planner' }), run({})];
    expect(nextStep(cfg(), h)).toMatchObject({ type: 'run', kind: 'validate', role: 'validator' });
    h.push(run({ kind: 'validate', role: 'validator', validation: ok }));
    expect(nextStep(cfg(), h)).toMatchObject({ type: 'run', kind: 'test', role: 'tester' });
    h.push(run({ kind: 'test', role: 'tester' }));
    expect(nextStep(cfg(), h)).toMatchObject({ type: 'run', kind: 'validate' });
    h.push(run({ kind: 'validate', role: 'validator', validation: ok }));
    expect(nextStep(cfg(), h)).toEqual({ type: 'done' });
    expect(nextStep(cfg({ finalApproval: true }), h)).toEqual({ type: 'gate', gate: { type: 'final_approval' } });
    expect(nextStep(cfg({ reviewer: true }), h)).toMatchObject({ type: 'run', kind: 'review', role: 'reviewer' });
  });

  it('skips validation when there is nothing to run', () => {
    expect(nextStep({ config: { ...DEFAULT_PIPELINE, tester: false }, hasValidationCommands: false }, [run({})])).toEqual({ type: 'done' });
    expect(nextStep(cfg({ validate: false, tester: false }), [run({})])).toEqual({ type: 'done' });
  });

  it('sends validation failures back to the developer up to maxFixLoops', () => {
    const h = [run({}), run({ kind: 'validate', role: 'validator', status: 'failed', validation: bad })];
    expect(nextStep(cfg(), h)).toMatchObject({ type: 'run', kind: 'fix', fixReason: 'validation' });
    h.push(run({ kind: 'fix', fixReason: 'validation' }), run({ kind: 'validate', role: 'validator', status: 'failed', validation: bad }));
    expect(nextStep(cfg(), h)).toMatchObject({ type: 'run', kind: 'fix' });
    h.push(run({ kind: 'fix', fixReason: 'validation' }), run({ kind: 'validate', role: 'validator', status: 'failed', validation: bad }));
    expect(nextStep(cfg(), h)).toMatchObject({ type: 'stop', error: expect.stringMatching(/after 2/) });
    expect(nextStep(cfg({ maxFixLoops: 0 }), h.slice(0, 2))).toMatchObject({ type: 'stop' });
  });

  it('loops review findings back to the developer and re-reviews', () => {
    const c = cfg({ tester: false, reviewer: true });
    const changes = { verdict: 'changes_requested' as const, summary: '', findings: [] };
    const h = [run({}), run({ kind: 'validate', role: 'validator', validation: ok }), run({ kind: 'review', role: 'reviewer', review: changes })];
    expect(nextStep(c, h)).toMatchObject({ type: 'run', kind: 'fix', fixReason: 'review' });
    h.push(run({ kind: 'fix', fixReason: 'review' }));
    expect(nextStep(c, h)).toMatchObject({ type: 'run', kind: 'validate' });
    h.push(run({ kind: 'validate', role: 'validator', validation: ok }));
    expect(nextStep(c, h)).toMatchObject({ type: 'run', kind: 'review' });
    h.push(run({ kind: 'review', role: 'reviewer', review: { ...changes, verdict: 'approve' } }));
    expect(nextStep(c, h)).toEqual({ type: 'done' });
    // Review loop exhausted: final approval lets the user decide; otherwise stop.
    const stuck = [run({}), run({ kind: 'review', role: 'reviewer', review: changes }), run({ kind: 'fix', fixReason: 'review' }), run({ kind: 'fix', fixReason: 'review' }), run({ kind: 'review', role: 'reviewer', review: changes })];
    expect(nextStep(c, stuck)).toMatchObject({ type: 'stop' });
    expect(nextStep(cfg({ reviewer: true, finalApproval: true }), stuck)).toMatchObject({ type: 'gate', gate: { type: 'final_approval' } });
  });

  it('opens a clarification gate for any agent that asks', () => {
    for (const role of ['planner', 'developer', 'tester', 'reviewer'] as const) {
      expect(nextStep(cfg(), [run({ role, questions: ['Which format?'] })])).toEqual({ type: 'gate', gate: { type: 'clarification', questions: ['Which format?'], role } });
    }
    // After answering, the answer run is judged by its role.
    expect(nextStep(cfg(), [run({ role: 'planner', kind: 'plan', questions: ['?'] }), run({ role: 'planner', kind: 'answer', plan: 'p' })])).toMatchObject({ type: 'gate', gate: { type: 'plan_approval' } });
  });

  it('stops on agent failure and idles on cancel', () => {
    expect(nextStep(cfg(), [run({ status: 'failed' })])).toEqual({ type: 'stop', error: '' });
    expect(nextStep(cfg(), [run({ status: 'cancelled' })])).toEqual({ type: 'idle' });
  });

  it('cleans untrusted pipeline config', () => {
    const c = cleanPipeline({ plan: 'yes', maxFixLoops: 99, remote: 'origin; rm -rf /', validationCommands: [' npm test ', ''] });
    expect(c.plan).toBe(true);
    expect(c.maxFixLoops).toBe(5);
    expect(c.remote).toBe('origin');
    expect(c.validationCommands).toEqual(['npm test']);
  });
});

describe('diff parser', () => {
  it('parses modifications, additions, deletions, renames, binaries and no-newline markers', () => {
    const raw = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@ function x() {',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' export { a };',
      '\\ No newline at end of file',
      'diff --git a/new file.txt b/new file.txt',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/new file.txt',
      '@@ -0,0 +1 @@',
      '+hello',
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git a/old/name.ts b/new/name.ts',
      'similarity index 95%',
      'rename from old/name.ts',
      'rename to new/name.ts',
      'diff --git a/logo.png b/logo.png',
      'index 4444444..5555555 100644',
      'Binary files a/logo.png and b/logo.png differ',
      '',
    ].join('\n');
    const files = parseUnifiedDiff(raw);
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['src/a.ts', 'modified', 2, 1],
      ['new file.txt', 'added', 1, 0],
      ['gone.txt', 'deleted', 0, 1],
      ['new/name.ts', 'renamed', 0, 0],
      ['logo.png', 'modified', 0, 0],
    ]);
    expect(files[3].oldPath).toBe('old/name.ts');
    expect(files[4].binary).toBe(true);
    const lines = files[0].hunks[0].lines;
    expect(files[0].hunks[0].header).toContain('@@ -1,3 +1,4 @@');
    expect(lines[0]).toEqual({ type: 'context', oldNo: 1, newNo: 1, text: 'const a = 1;' });
    expect(lines[1]).toEqual({ type: 'del', oldNo: 2, newNo: null, text: 'const b = 2;' });
    expect(lines[2]).toEqual({ type: 'add', oldNo: null, newNo: 2, text: 'const b = 3;' });
    expect(lines[4]).toEqual({ type: 'context', oldNo: 3, newNo: 4, text: 'export { a };' });
    expect(lines[5].type).toBe('meta');
    expect(files[1].oldPath).toBeNull();
  });
});

describe('dependencies', () => {
  it('detects cycles', () => {
    const g = new Map([['b', ['a']], ['c', ['b']]]);
    expect(findCycle(g, 'a', ['c'])).toEqual(['a', 'c', 'b', 'a']);
    expect(findCycle(g, 'd', ['c'])).toBeNull();
  });
  it('chooses the base ref', () => {
    expect(chooseBaseRef('main', [])).toEqual({ ref: 'main', stackedOn: null });
    expect(chooseBaseRef('main', [{ title: 'A', branch: 'feature/a', merged: true }])).toEqual({ ref: 'main', stackedOn: null });
    expect(chooseBaseRef('main', [{ title: 'A', branch: 'feature/a', merged: false }, { title: 'B', branch: 'feature/b', merged: true }])).toEqual({ ref: 'feature/a', stackedOn: 'A' });
    expect(chooseBaseRef('main', [{ title: 'A', branch: 'feature/a', merged: false }, { title: 'B', branch: 'feature/b', merged: false }])).toEqual({
      error: expect.stringMatching(/"A", "B".*Merge all but one/),
    });
  });
});

describe('github', () => {
  it('parses remotes', () => {
    expect(parseRemote('https://github.com/acme/shop.git')).toEqual({ host: 'github.com', owner: 'acme', repo: 'shop' });
    expect(parseRemote('https://user@github.com/acme/shop')).toEqual({ host: 'github.com', owner: 'acme', repo: 'shop' });
    expect(parseRemote('git@github.com:acme/my.repo.git')).toEqual({ host: 'github.com', owner: 'acme', repo: 'my.repo' });
    expect(parseRemote('ssh://git@github.example.com:2222/acme/shop.git')).toEqual({ host: 'github.example.com', owner: 'acme', repo: 'shop' });
    expect(parseRemote('/srv/git/shop.git')).toBeNull();
  });
});

const project: Project = {
  id: 'p', name: 'Shop', description: '', path: '/r', baseBranch: 'main', worktreeRoot: '/w', allowedTools: ['Read', 'Edit', 'Bash(npm:*)'], model: 'opus',
  agentProfile: '', effort: '', mcpConfig: '', pipeline: DEFAULT_PIPELINE, roles: { reviewer: { model: 'sonnet', effort: 'low' } }, createdAt: '',
};
const settings: Settings = {
  concurrency: 2, agentProfile: 'lean', effort: 'medium', maxBudgetUsd: 0, defaultModel: '', editorCommand: 'vscode', claudeBinary: 'claude', notifications: 'all', systemNotifications: false,
};
const feature: Feature = {
  id: 'f', projectId: 'p', title: 'Export', description: 'CSV', priority: 'low', status: 'build', position: 0, branch: null, worktreePath: null, sessionId: null,
  agentStatus: null, currentRunId: null, dependsOn: [], blockedBy: [], gate: null, baseRef: null, prUrl: null, prNumber: null, createdAt: '', updatedAt: '',
};

describe('roles', () => {
  it('runs planner and reviewer read-only with their own model/effort', () => {
    const rev = resolveLaunchConfig(project, settings, 'reviewer');
    expect(rev).toMatchObject({ readOnly: true, model: 'sonnet', effort: 'low' });
    const args = buildClaudeArgs('P', rev);
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('default');
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe(DISALLOWED_FOR_READ_ONLY.join(','));
    expect(args[args.indexOf('--allowedTools') + 1]).not.toContain('Edit');
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,Bash');
    const dev = resolveLaunchConfig(project, settings, 'developer');
    expect(dev).toMatchObject({ readOnly: false, model: 'opus', effort: 'medium' });
    expect(buildClaudeArgs('P', dev)).not.toContain('--disallowedTools');
  });

  it('builds role prompts with markers and the right report fields', () => {
    const plan = buildPlanPrompt(feature, project, 'feature/x', resolveLaunchConfig(project, settings, 'planner'));
    expect(plan).toContain('<!-- orchestrator-role: planner -->');
    expect(plan).toContain('Do NOT modify any files');
    expect(plan).toContain('"plan"');
    expect(plan).toContain('"needs_clarification"');
    const review = buildReviewerPrompt(feature, project, 'feature/x', 'main');
    expect(review).toContain('git diff main...HEAD');
    expect(review).toContain('"verdict"');
    const fix = buildFixPrompt('validation', fixMessage('validation', { validation: [{ command: 'npm test', exitCode: 1, durationMs: 1, timedOut: false, output: 'FAIL x' }] }), project, 'feature/x');
    expect(fix).toContain('<!-- orchestrator-fix: validation -->');
    expect(fix).toContain('FAIL x');
    expect(fix).toContain('Do not weaken');
    const qa = formatAnswers(['CSV or JSON?', 'Paginate?'], ['CSV', '']);
    expect(qa).toContain('**A1:** CSV');
    expect(qa).toContain('use your best judgement');
    expect(buildAnswerPrompt('tester', qa)).toContain('<!-- orchestrator-role: tester -->');
    // Test-running rules: no watch mode, bounded timeouts, the project's own commands.
    const withCmds = { ...project, pipeline: { ...project.pipeline, validationCommands: ['cd mobile && npx jest --ci'] } };
    const dev = buildFixPrompt('user', 'x', withCmds, 'feature/x');
    expect(dev).toContain('`cd mobile && npx jest --ci`');
    expect(dev).toContain('--watchAll=false --watchman=false --forceExit --maxWorkers=2');
    expect(dev).toContain('at most 300 seconds');
    expect(dev).toContain('do not retry it with a longer timeout');
  });

  it('extracts plans, questions and reviews from agent reports', () => {
    const r = extractSelfReport('ok\n```json\n{"summary":"s","plan":"1. x","needs_clarification":["Q?"],"review":{"verdict":"Changes requested","findings":[{"severity":"critical","file":"a.ts","line":"3","message":"m"}]}}\n```');
    expect(r.plan).toBe('1. x');
    expect(r.needsClarification).toEqual(['Q?']);
    expect(r.review).toEqual({ verdict: 'changes_requested', summary: '', findings: [{ severity: 'blocker', file: 'a.ts', line: 3, message: 'm' }] });
    // Verdict inferred from findings when missing.
    expect(extractSelfReport('```json\n{"review":{"findings":[{"severity":"major","file":"a","message":"m"}]}}\n```').review?.verdict).toBe('changes_requested');
  });
});

describe('notifications', () => {
  it('escapes osascript strings and filters by level', () => {
    const args = systemNotificationArgs('Plan "ready"', 'Feature \\ x');
    expect(args[1]).toBe('display notification "Feature \\\\ x" with title "AI Orchestrator" subtitle "Plan \\"ready\\""');
    expect(shouldNotify('attention', 'success')).toBe(false);
    expect(shouldNotify('attention', 'error')).toBe(true);
    expect(shouldNotify('off', 'attention')).toBe(false);
    expect(shouldNotify('all', 'info')).toBe(true);
  });
});

describe('validation detection', () => {
  it('detects npm scripts and install needs', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-val-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', typecheck: 'tsc', build: 'vite build', lint: 'eslint .' } }));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    expect(detectValidationCommands(dir)).toEqual({ commands: ['npm run typecheck', 'npm test', 'npm run build'], source: 'package.json (npm)' });
    expect(installCommand(dir)).toBe('npm ci');
    fs.mkdirSync(path.join(dir, 'node_modules'));
    expect(installCommand(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
    expect(detectValidationCommands(dir).commands).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
