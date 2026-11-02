import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.env.ORCH_CLAUDE_BIN = path.join(here, 'fixtures/fake-claude.mjs');
process.env.FAKE_CLAUDE_DELAY_MS = '150';
const argsDir = path.join(tmp, 'args');
process.env.FAKE_CLAUDE_ARGS_DIR = argsDir;

const repo = path.join(tmp, 'Tiles');
function sh(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

let mods: any;
async function waitFor<T>(fn: () => T | undefined | false, ms = 15000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timeout');
}

beforeAll(async () => {
  fs.mkdirSync(repo);
  sh(repo, 'init', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), '# Tiles\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'Use TypeScript.\n');
  sh(repo, 'add', '-A');
  sh(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init');
  mods = {
    projects: await import('../src/projects.ts'),
    features: await import('../src/features.ts'),
    settings: await import('../src/settings.ts'),
    runs: await import('../src/runs.ts'),
    orch: await import('../src/orchestrator.ts'),
  };
});

afterAll(() => {
  mods.orch.orchestrator.shutdown();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('end-to-end orchestration with a fake Claude Code', () => {
  it('runs features concurrently up to the limit, queues the rest, and reports', async () => {
    const { projects, features, settings, runs, orch } = mods;
    settings.updateSettings({ concurrency: 2 });
    // Classic single-agent flow: no plan, validation, tester or reviewer.
    const project = await projects.createProject({ path: repo, pipeline: { plan: false, validate: false, tester: false, reviewer: false } });
    expect(project.worktreeRoot).toBe(path.join(tmp, 'Tiles-worktrees'));
    const f = ['Portfolio charts', 'Onboarding', 'Account settings'].map((t) =>
      features.createFeature(project.id, { title: t, description: 'Do it well' }),
    );
    for (const x of f) orch.orchestrator.enqueue(x.id);

    // Wait until the scheduler has had a chance to start runs.
    await waitFor(() => runs.listRunsByStatus(['running', 'initialising']).length >= 2);
    expect(runs.listRunsByStatus(['running', 'initialising']).length).toBe(2);
    expect(runs.listRunsByStatus(['queued']).length).toBe(1);

    const done = await waitFor(() => {
      const all = features.listFeatures(project.id);
      return all.every((x: any) => x.status === 'done') && all;
    }, 30000);

    for (const feat of done) {
      expect(feat.agentStatus).toBe('completed');
      expect(feat.branch).toMatch(/^feature\//);
      expect(fs.existsSync(feat.worktreePath)).toBe(true);
      expect(feat.worktreePath.startsWith(project.worktreeRoot)).toBe(true);
      expect(feat.sessionId).toMatch(/^sess-/);
      const report = runs.getReport(feat.currentRunId);
      expect(report.self.reported).toBe(true);
      expect(report.self.tests.passed).toBe(3);
      expect(report.changes.commits.length).toBe(1);
      expect(report.changes.files.some((x: any) => x.change === 'created')).toBe(true);
      expect(report.usage.outputTokens).toBe(1500);
      expect(report.estimatedCostUsd).toBeGreaterThan(0);
      expect(report.markdown).toContain('## 8. Agent usage');
      const run = runs.getRun(feat.currentRunId);
      expect(run.progress).toBe(100);
      expect(runs.listEvents(run.id).some((e: any) => e.kind === 'tool_use')).toBe(true);
    }
    // The original working directory is untouched.
    expect(sh(repo, 'status', '--porcelain').trim()).toBe('');
    expect(sh(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main');
    expect(fs.readdirSync(repo).sort()).toEqual(['.git', 'CLAUDE.md', 'README.md']);
  }, 60000);

  it('marks failures and supports retry and cancel', async () => {
    const { projects, features, runs, orch } = mods;
    const project = projects.listProjects()[0];
    process.env.FAKE_CLAUDE_FAIL = '1';
    const f = features.createFeature(project.id, { title: 'Will fail' });
    orch.orchestrator.enqueue(f.id);
    const failed = await waitFor(() => {
      const x = features.getFeature(f.id);
      return x.agentStatus === 'failed' && x;
    });
    expect(failed.status).toBe('build');
    expect(runs.getRun(failed.currentRunId).error).toMatch(/error/);

    process.env.FAKE_CLAUDE_FAIL = '0';
    process.env.FAKE_CLAUDE_DELAY_MS = '2000';
    orch.orchestrator.retry(f.id);
    await waitFor(() => features.getFeature(f.id).agentStatus === 'running');
    const retried = features.getFeature(f.id);
    expect(retried.run.attempt).toBe(2);
    expect(retried.worktreePath).toBe(failed.worktreePath); // worktree reused
    await orch.orchestrator.cancel(f.id);
    const cancelled = await waitFor(() => {
      const x = features.getFeature(f.id);
      return x.agentStatus === 'cancelled' && x;
    });
    expect(cancelled.status).toBe('build');
    expect(runs.listRunsForFeature(f.id).map((r: any) => r.status)).toEqual(['cancelled', 'failed']);
  }, 60000);

  it('passes lean flags and resumes the session for follow-ups', async () => {
    const { projects, features, runs, orch } = mods;
    process.env.FAKE_CLAUDE_DELAY_MS = '100';
    process.env.FAKE_CLAUDE_FAIL = '0';
    const project = projects.listProjects()[0];
    const f = features.createFeature(project.id, { title: 'Follow me' });
    orch.orchestrator.enqueue(f.id);
    const done = await waitFor(() => {
      const x = features.getFeature(f.id);
      return x.status === 'done' && x;
    });
    const firstArgs = JSON.parse(fs.readFileSync(path.join(argsDir, fs.readdirSync(argsDir).find((n) => n.startsWith(done.sessionId))!), 'utf8'));
    expect(firstArgs.args).toContain('--strict-mcp-config');
    expect(firstArgs.args).toContain('--disable-slash-commands');
    expect(firstArgs.args).not.toContain('--resume');
    const firstRun = runs.getRun(done.currentRunId);
    expect(firstRun.metrics.turns).toBe(6);
    expect(firstRun.metrics.baselineContextTokens).toBe(8200);

    expect(() => orch.orchestrator.followUp(f.id, '  ')).toThrow(/message is required/);
    orch.orchestrator.followUp(f.id, 'Also handle the empty state');
    expect(features.getFeature(f.id).status).toBe('build');
    const again = await waitFor(() => {
      const x = features.getFeature(f.id);
      return x.status === 'done' && x.currentRunId !== done.currentRunId && x;
    });
    expect(again.sessionId).toBe(done.sessionId);
    const followRun = runs.getRun(again.currentRunId);
    expect(followRun.kind).toBe('followup');
    expect(followRun.message).toBe('Also handle the empty state');
    const files = fs.readdirSync(argsDir).filter((n) => n.startsWith(done.sessionId)).sort();
    const second = JSON.parse(fs.readFileSync(path.join(argsDir, files[files.length - 1]), 'utf8'));
    expect(second.args[second.args.indexOf('--resume') + 1]).toBe(done.sessionId);
    expect(fs.realpathSync(second.cwd)).toBe(fs.realpathSync(done.worktreePath));
    expect(second.args[1]).toContain('Also handle the empty state');
    const report = runs.getReport(again.currentRunId);
    expect(report.kind).toBe('followup');
    expect(report.markdown).toContain('Follow-up request');
    expect(report.self.docsUpdated).toEqual(['agent-docs/features.md']);
    expect(report.changes.commits.length).toBe(2);
  }, 60000);
});
