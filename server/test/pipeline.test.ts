import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-pipe-'));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.env.ORCH_CLAUDE_BIN = path.join(here, 'fixtures/fake-claude.mjs');
process.env.FAKE_CLAUDE_DELAY_MS = '60';
process.env.ORCH_STALL_WARNING_MS = '1500';
const argsDir = path.join(tmp, 'args');
process.env.FAKE_CLAUDE_ARGS_DIR = argsDir;

const repo = path.join(tmp, 'Shop');
const bare = path.join(tmp, 'shop-remote.git');
const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

// Minimal GitHub REST API double.
const prs: any[] = [];
const ghRequests: { method: string; url: string; auth: string | undefined; body: any }[] = [];
const gh = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const parsed = body ? JSON.parse(body) : null;
    ghRequests.push({ method: req.method!, url: req.url!, auth: req.headers.authorization, body: parsed });
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== 'Bearer ghp_testtoken_0123456789abcdef') {
      res.statusCode = 401;
      res.end(JSON.stringify({ message: 'Bad credentials' }));
    } else if (req.url === '/user') res.end(JSON.stringify({ login: 'octo' }));
    else if (req.method === 'GET' && req.url!.startsWith('/repos/acme/shop/pulls')) res.end(JSON.stringify(prs.filter((p) => req.url!.includes(encodeURIComponent(`acme:${p.head}`)))));
    else if (req.method === 'POST' && req.url === '/repos/acme/shop/pulls') {
      const pr = { number: prs.length + 1, html_url: `https://github.com/acme/shop/pull/${prs.length + 1}`, state: 'open', ...parsed };
      prs.push(pr);
      res.statusCode = 201;
      res.end(JSON.stringify(pr));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ message: 'Not Found' }));
    }
  });
});

let m: any;
async function waitFor<T>(fn: () => T | undefined | false | null, ms = 20000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timeout');
}
const argsFor = (pred: (a: any) => boolean) =>
  fs
    .readdirSync(argsDir)
    .map((n) => ({ n, a: JSON.parse(fs.readFileSync(path.join(argsDir, n), 'utf8')) }))
    .sort((x, y) => fs.statSync(path.join(argsDir, x.n)).mtimeMs - fs.statSync(path.join(argsDir, y.n)).mtimeMs)
    .map((x) => x.a)
    .filter(pred);

beforeAll(async () => {
  fs.mkdirSync(repo);
  sh(repo, 'init', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), '# Shop\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'Read agent-docs first.\n');
  sh(repo, 'add', '-A');
  sh(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init');
  sh(tmp, 'init', '--bare', '-b', 'main', bare);
  sh(repo, 'remote', 'add', 'origin', 'https://github.com/acme/shop.git');
  sh(repo, 'remote', 'set-url', '--push', 'origin', bare);
  await new Promise<void>((r) => gh.listen(0, '127.0.0.1', () => r()));
  process.env.ORCH_GITHUB_API_URL = `http://127.0.0.1:${(gh.address() as any).port}`;
  m = {
    projects: await import('../src/projects.ts'),
    features: await import('../src/features.ts'),
    runs: await import('../src/runs.ts'),
    orch: await import('../src/orchestrator.ts'),
    github: await import('../src/github.ts'),
    pr: await import('../src/pr.ts'),
    settings: await import('../src/settings.ts'),
  };
  m.settings.updateSettings({ concurrency: 2, systemNotifications: false });
});

afterAll(() => {
  m.orch.orchestrator.shutdown();
  gh.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const feature = (id: string) => m.features.getFeature(id);
const roles = (id: string) => m.runs.listRunsForFeature(id).reverse().map((r: any) => `${r.kind}:${r.role}:${r.status}`);

describe('agent pipeline', () => {
  it('plans, waits for approval, develops, fixes failing validation, tests, and finishes', async () => {
    const project = await m.projects.createProject({
      path: repo,
      pipeline: { validationCommands: ['test -f fix-validation.txt || (echo "FAIL: fix missing"; exit 1)'] },
    });
    expect(project.pipeline).toMatchObject({ plan: true, planApproval: true, validate: true, tester: true, reviewer: false, maxFixLoops: 2 });
    const f = m.features.createFeature(project.id, { title: 'Export orders', description: 'CSV export' });
    m.orch.orchestrator.startFeature(f.id);

    const gated = await waitFor(() => feature(f.id).gate?.type === 'plan_approval' && feature(f.id));
    expect(gated.gate.plan).toContain('feature-export-orders.txt');
    expect(gated.status).toBe('build');
    // The planner is read-only.
    const plannerArgs = argsFor((a) => a.role === 'planner')[0].args;
    expect(plannerArgs[plannerArgs.indexOf('--permission-mode') + 1]).toBe('default');
    expect(plannerArgs[plannerArgs.indexOf('--disallowedTools') + 1]).toContain('Edit');
    expect(plannerArgs[plannerArgs.indexOf('--tools') + 1]).toBe('Read,Glob,Grep,Bash');
    // Nothing was written yet.
    expect(sh(gated.worktreePath, 'log', '--oneline', 'main..HEAD').trim()).toBe('');

    expect(() => m.orch.orchestrator.resolveGate(f.id, 'reject', {})).toThrow(/Describe/);
    m.orch.orchestrator.resolveGate(f.id, 'approve', { comment: 'Use semicolons' });

    const done = await waitFor(() => feature(f.id).status === 'done' && feature(f.id), 30000);
    expect(done.agentStatus).toBe('completed');
    expect(done.gate).toBeNull();
    expect(roles(f.id)).toEqual([
      'plan:planner:completed',
      'feature:developer:completed',
      'validate:validator:failed',
      'fix:developer:completed',
      'validate:validator:completed',
      'test:tester:completed',
      'validate:validator:completed',
    ]);
    const runs = m.runs.listRunsForFeature(f.id).reverse();
    // Developer continued the planner's session; the tester got a fresh one.
    expect(runs[1].sessionId).toBe(runs[0].sessionId);
    expect(runs[3].sessionId).toBe(runs[0].sessionId);
    expect(runs[5].sessionId).not.toBe(runs[0].sessionId);
    expect(done.sessionId).toBe(runs[0].sessionId);
    const devArgs = argsFor((a) => a.role === 'developer')[0].args;
    expect(devArgs[devArgs.indexOf('--permission-mode') + 1]).toBe('acceptEdits');
    expect(devArgs[1]).toContain('Use semicolons');
    expect(runs[3].fixReason).toBe('validation');
    expect(runs[3].message).toContain('FAIL: fix missing');
    expect(runs[2].validation[0].exitCode).toBe(1);
    expect(m.runs.getReport(runs[2].id).markdown).toContain('Validation report');
    expect(m.runs.getReport(runs[0].id).self.plan).toContain('Add a test');
    const log = sh(done.worktreePath, 'log', '--format=%s', 'main..HEAD');
    expect(log).toMatch(/test: Export orders/);
    expect(log).toMatch(/fix\(validation\)/);

    // Diff viewer: committed changes plus untracked files, relative to the merge-base.
    const git = await import('../src/git.ts');
    fs.writeFileSync(path.join(done.worktreePath, 'scratch.txt'), 'wip\n');
    const all = await git.getDiff(done.worktreePath, 'main', 'all');
    expect(all.files.map((x: any) => x.path)).toEqual(expect.arrayContaining(['fix-validation.txt', 'scratch.txt', 'test-export-orders.test.txt']));
    expect(all.files.length).toBe(4);
    expect(all.files.find((x: any) => x.path === 'scratch.txt')?.status).toBe('added');
    const unc = await git.getDiff(done.worktreePath, 'main', 'uncommitted');
    expect(unc.files.map((x: any) => x.path)).toEqual(['scratch.txt']);
    const committed = await git.getDiff(done.worktreePath, 'main', 'committed');
    expect(committed.files.length).toBe(3);
    const head = sh(done.worktreePath, 'rev-parse', 'HEAD').trim();
    const one = await git.getDiff(done.worktreePath, 'main', `commit:${head}`);
    expect(one.files.map((x: any) => x.path)).toEqual(['test-export-orders.test.txt']);
    fs.rmSync(path.join(done.worktreePath, 'scratch.txt'));
  }, 60000);

  it('stops after the maximum number of validation fixes', async () => {
    const project = m.projects.listProjects()[0];
    await m.projects.updateProject(project.id, { pipeline: { plan: false, tester: false, maxFixLoops: 1, validationCommands: ['echo nope; exit 3'] } });
    const f = m.features.createFeature(project.id, { title: 'Never green' });
    m.orch.orchestrator.startFeature(f.id);
    const failed = await waitFor(() => feature(f.id).agentStatus === 'failed' && feature(f.id), 30000);
    expect(roles(f.id)).toEqual(['feature:developer:completed', 'validate:validator:failed', 'fix:developer:completed', 'validate:validator:failed']);
    expect(failed.run.error).toMatch(/still failing after 1/);
    expect(failed.status).toBe('build');
    // Retry re-runs the current step (validation), not the whole pipeline.
    m.orch.orchestrator.retry(f.id);
    await waitFor(() => feature(f.id).agentStatus === 'failed' && m.runs.listRunsForFeature(f.id).length === 5 && feature(f.id));
    expect(roles(f.id)[4]).toBe('validate:validator:failed');
  }, 60000);

  it('asks for clarification and resumes the same session with the answers', async () => {
    const project = m.projects.listProjects()[0];
    await m.projects.updateProject(project.id, { pipeline: { plan: false, validate: false, tester: false } });
    process.env.FAKE_CLAUDE_CLARIFY = 'developer';
    const f = m.features.createFeature(project.id, { title: 'Ambiguous export' });
    m.orch.orchestrator.startFeature(f.id);
    const gated = await waitFor(() => feature(f.id).gate?.type === 'clarification' && feature(f.id));
    expect(gated.gate.questions).toEqual(['Should the export be CSV or JSON?']);
    expect(gated.gate.role).toBe('developer');
    expect(() => m.orch.orchestrator.resolveGate(f.id, 'answer', { answers: [' '] })).toThrow(/at least one/);
    m.orch.orchestrator.resolveGate(f.id, 'answer', { answers: ['CSV'] });
    const done = await waitFor(() => feature(f.id).status === 'done' && feature(f.id));
    delete process.env.FAKE_CLAUDE_CLARIFY;
    const runs = m.runs.listRunsForFeature(f.id).reverse();
    expect(runs.map((r: any) => r.kind)).toEqual(['feature', 'answer']);
    expect(runs[1].sessionId).toBe(runs[0].sessionId);
    expect(runs[1].message).toContain('**A1:** CSV');
    expect(done.sessionId).toBe(runs[0].sessionId);
  }, 60000);

  it('reviews, fixes findings, waits for final approval and opens a pull request', async () => {
    const project = m.projects.listProjects()[0];
    await m.projects.updateProject(project.id, { pipeline: { plan: false, validate: false, tester: false, reviewer: true, finalApproval: true } });
    await m.projects.updateProject(project.id, { roles: { reviewer: { model: 'claude-haiku-5-5', effort: 'low' } } });
    process.env.FAKE_REVIEW_VERDICT = 'changes_once';
    const f = m.features.createFeature(project.id, { title: 'Order history' });
    m.orch.orchestrator.startFeature(f.id);
    const gated = await waitFor(() => feature(f.id).gate?.type === 'final_approval' && feature(f.id), 30000);
    delete process.env.FAKE_REVIEW_VERDICT;
    expect(roles(f.id)).toEqual(['feature:developer:completed', 'review:reviewer:completed', 'fix:developer:completed', 'review:reviewer:completed']);
    const runs = m.runs.listRunsForFeature(f.id).reverse();
    expect(m.runs.getReport(runs[1].id).self.review.verdict).toBe('changes_requested');
    expect(runs[2].message).toContain('Validate the input');
    expect(m.runs.getReport(runs[3].id).self.review.verdict).toBe('approve');
    expect(runs[1].sessionId).not.toBe(runs[0].sessionId); // independent reviewer session
    const reviewerArgs = argsFor((a) => a.role === 'reviewer')[0].args;
    expect(reviewerArgs[reviewerArgs.indexOf('--model') + 1]).toBe('claude-haiku-5-5');
    expect(reviewerArgs[reviewerArgs.indexOf('--effort') + 1]).toBe('low');
    expect(gated.status).toBe('build');

    m.orch.orchestrator.resolveGate(f.id, 'approve');
    const done = await waitFor(() => feature(f.id).status === 'done' && feature(f.id));
    expect(done.gate).toBeNull();

    // Pull request: without a token it is refused; with one, the branch is pushed and the PR opened.
    await expect(m.pr.createPrForFeature(f.id)).rejects.toThrow(/No GitHub token/);
    await expect(m.github.setToken('ghp_wrongtoken_0123456789abcdef')).rejects.toThrow(/rejected the token/);
    const status = await m.github.setToken('ghp_testtoken_0123456789abcdef');
    expect(status).toEqual({ configured: true, source: 'file', login: 'octo' });
    expect((fs.statSync(path.join(process.env.ORCH_DATA_DIR!, 'github-token')).mode & 0o777).toString(8)).toBe('600');
    const withPr = await m.pr.createPrForFeature(f.id);
    expect(withPr.prNumber).toBe(1);
    expect(withPr.prUrl).toBe('https://github.com/acme/shop/pull/1');
    const post = ghRequests.find((r) => r.method === 'POST')!;
    expect(post.body).toMatchObject({ head: done.branch, base: 'main', title: 'Order history', draft: true });
    expect(post.body.body).toContain('Automated review: approved');
    expect(sh(bare, 'branch', '--list', done.branch).trim()).toContain(done.branch);
    // Idempotent: a second call reuses the open PR.
    const again = await m.pr.createPrForFeature(f.id);
    expect(again.prNumber).toBe(1);
    expect(ghRequests.filter((r) => r.method === 'POST').length).toBe(1);
    // The token never reaches agents or logs.
    const events = m.runs.listRunsForFeature(f.id).flatMap((r: any) => m.runs.listEvents(r.id));
    expect(JSON.stringify(events)).not.toContain('ghp_testtoken');
    await m.github.setToken('');
  }, 60000);

  it('waits for dependencies and stacks on an unmerged dependency branch', async () => {
    const project = m.projects.listProjects()[0];
    await m.projects.updateProject(project.id, { pipeline: { plan: false, validate: false, tester: false, reviewer: false, finalApproval: false } });
    const a = m.features.createFeature(project.id, { title: 'Cart model' });
    const b = m.features.createFeature(project.id, { title: 'Checkout page' });
    m.features.setDependencies(b.id, [a.id]);
    expect(() => m.features.setDependencies(a.id, [b.id])).toThrow(/cycle/);
    expect(() => m.features.setDependencies(a.id, [a.id])).toThrow(/itself/);
    expect(feature(b.id).blockedBy.map((d: any) => d.title)).toEqual(['Cart model']);

    process.env.FAKE_CLAUDE_DELAY_MS = '300';
    m.orch.orchestrator.startFeature(b.id);
    await waitFor(() => feature(b.id).run?.currentActivity?.startsWith('Waiting for dependencies'));
    expect(feature(b.id).agentStatus).toBe('queued');
    expect(feature(b.id).worktreePath).toBeNull();
    m.orch.orchestrator.startFeature(a.id);
    const doneA = await waitFor(() => feature(a.id).status === 'done' && feature(a.id));
    const doneB = await waitFor(() => feature(b.id).status === 'done' && feature(b.id));
    process.env.FAKE_CLAUDE_DELAY_MS = '60';
    expect(doneB.baseRef).toBe(doneA.branch);
    expect(doneB.blockedBy).toEqual([]);
    expect(fs.existsSync(path.join(doneB.worktreePath, 'feature-cart-model.txt'))).toBe(true);
    const report = m.runs.getReport(doneB.currentRunId);
    expect(report.changes.baseBranch).toBe(doneA.branch);
    expect(report.changes.commits.map((c: any) => c.subject)).toEqual(['feat: Checkout page']);
  }, 60000);

  it('continues a paused pipeline whose next step was not started', async () => {
    const project = m.projects.listProjects()[0];
    await m.projects.updateProject(project.id, { pipeline: { plan: true, planApproval: true } });
    const f = m.features.createFeature(project.id, { title: 'Paused plan' });
    m.orch.orchestrator.startFeature(f.id);
    await waitFor(() => feature(f.id).gate?.type === 'plan_approval');
    expect(() => m.orch.orchestrator.continuePipeline(f.id)).toThrow(/checkpoint/);
    // Simulate a lost checkpoint: completed planner run, no gate.
    m.features.patchFeatureState(f.id, { gate: null });
    expect(feature(f.id).agentStatus).toBe('completed');
    m.orch.orchestrator.continuePipeline(f.id);
    expect(feature(f.id).gate.type).toBe('plan_approval');
    await m.orch.orchestrator.cancel(f.id);
  }, 30000);

  it('warns when an agent goes quiet and notes when it resumes', async () => {
    const project = m.projects.listProjects()[0];
    await m.projects.updateProject(project.id, { pipeline: { plan: false, validate: false, tester: false, reviewer: false, finalApproval: false } });
    process.env.FAKE_CLAUDE_DELAY_MS = '2600';
    const f = m.features.createFeature(project.id, { title: 'Slow tests' });
    m.orch.orchestrator.startFeature(f.id);
    const done = await waitFor(() => feature(f.id).status === 'done' && feature(f.id), 40000);
    process.env.FAKE_CLAUDE_DELAY_MS = '60';
    const events = m.runs.listEvents(done.currentRunId);
    expect(events.some((e: any) => e.kind === 'warning' && /No output from the agent/.test(e.summary))).toBe(true);
    expect(events.some((e: any) => e.summary === 'Agent output resumed')).toBe(true);
  }, 60000);

  it('keeps open checkpoints across a backend restart', async () => {
    const project = m.projects.listProjects()[0];
    await m.projects.updateProject(project.id, { pipeline: { plan: true, planApproval: true } });
    const f = m.features.createFeature(project.id, { title: 'Restart me' });
    m.orch.orchestrator.startFeature(f.id);
    await waitFor(() => feature(f.id).gate?.type === 'plan_approval');
    m.orch.orchestrator.shutdown();
    const fresh = new m.orch.Orchestrator();
    fresh.recover();
    expect(feature(f.id).gate.type).toBe('plan_approval');
    await fresh.cancel(f.id);
    expect(feature(f.id).gate).toBeNull();
    expect(feature(f.id).agentStatus).toBe('cancelled');
  }, 30000);
});
