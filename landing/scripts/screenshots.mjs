#!/usr/bin/env node
// Regenerates the real app screenshots used by the landing page's Getting Started guide.
//
//   npm run build            # build the dashboard first (web/dist)
//   node landing/scripts/screenshots.mjs
//
// It starts an isolated backend (temp data dir, port 4399) driven by the fake Claude CLI,
// a stub GitHub API, and a throwaway demo repo, seeds a board through the REST API, then
// captures light and dark PNGs into landing/public/screenshots/. No tokens are spent.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Playwright is not a project dependency: install it globally (or with NODE_PATH) to run this script.
const { chromium } = createRequire(import.meta.url)('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const outDir = path.resolve(here, '../public/screenshots');
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = process.argv.slice(2);

// ---------- demo repo ----------
const repo = path.join(tmp, 'acme-web');
function makeRepo() {
  const files = {
    'README.md': '# acme-web\n\nThe Acme customer dashboard.\n',
    'CLAUDE.md': '# CLAUDE.md\n\nRun `npm test` before committing.\n',
    'package.json': JSON.stringify({ name: 'acme-web', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n',
    'src/math.js': 'export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n',
    'src/reports.js': "import { add } from './math.js';\n\nexport function total(rows) {\n  return rows.reduce((sum, r) => add(sum, r.amount), 0);\n}\n",
    'src/settings.js': 'export const defaults = { theme: "light" };\n',
  };
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
    fs.writeFileSync(path.join(repo, f), c);
  }
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('-c', 'user.name=Acme', '-c', 'user.email=dev@acme.test', 'add', '.');
  git('-c', 'user.name=Acme', '-c', 'user.email=dev@acme.test', 'commit', '-qm', 'Initial commit');
}

// ---------- stub GitHub API (so Settings shows a connected token) ----------
function githubStub() {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      if (req.url?.startsWith('/user')) return res.end(JSON.stringify({ login: 'octocat', id: 1 }));
      res.statusCode = 404;
      res.end('{}');
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

// ---------- backend ----------
async function startServer(ghUrl) {
  const env = {
    ...process.env,
    ORCH_PORT: String(PORT),
    ORCH_DATA_DIR: path.join(tmp, 'data'),
    ORCH_CLAUDE_BIN: path.join(here, 'slow-claude.mjs'),
    ORCH_GITHUB_API_URL: ghUrl,
    ORCH_STALL_WARNING_MS: '3600000',
    NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
  };
  delete env.ORCH_GITHUB_TOKEN;
  const child = spawn(path.join(root, 'node_modules/.bin/tsx'), ['src/index.ts'], { cwd: path.join(root, 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', (d) => process.stderr.write(d));
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/settings`);
      if (r.ok) return child;
    } catch {}
    await sleep(200);
  }
  throw new Error('backend did not start');
}

async function api(method, p, body) {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}
const feature = (id) => api('GET', `/features/${id}`);
async function waitFor(id, pred, label, ms = 60000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const f = await feature(id);
    if (pred(f)) return f;
    await sleep(250);
  }
  throw new Error(`timeout waiting for ${label}: ${JSON.stringify(await feature(id))}`);
}

// ---------- capture ----------
async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  makeRepo();
  const gh = await githubStub();
  const server = await startServer(`http://127.0.0.1:${gh.address().port}`);
  const browser = await chromium.launch();
  try {
    await run(browser);
  } finally {
    await browser.close();
    server.kill('SIGTERM');
    gh.close();
  }
}

async function shoot(browser, name, prepare, { clip } = {}) {
  if (only.length && !only.includes(name)) return;
  for (const theme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: theme, reducedMotion: 'reduce' });
    await ctx.addInitScript((t) => localStorage.setItem('orch:theme', t), theme);
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    const target = await prepare(page);
    await page.waitForTimeout(700);
    const file = path.join(outDir, `${name}.${theme}.jpg`);
    const opts = { path: file, animations: 'disabled', type: 'jpeg', quality: 82 };
    if (target?.clip) await page.screenshot({ ...opts, clip: target.clip });
    else if (target) await target.screenshot(opts);
    else await page.screenshot({ ...opts, clip });
    console.log('saved', path.relative(root, file));
    await ctx.close();
  }
}

const byTitle = (page, title) => page.getByText(title, { exact: true }).first();
async function openSheet(page, title, tab) {
  await byTitle(page, title).click();
  const sheet = page.getByRole('dialog');
  await sheet.waitFor();
  if (tab) await sheet.getByRole('tab', { name: tab, exact: true }).click();
  await page.waitForTimeout(800);
  return sheet;
}
const dialog = (page) => page.getByRole('dialog');

async function run(browser) {
  // 1. First launch: no projects yet.
  await shoot(browser, 'empty', async () => null);

  // 2. Add project dialog, with the path filled in and validated.
  await shoot(browser, 'add-project', async (page) => {
    await page.getByRole('button', { name: 'Add project' }).first().click();
    await dialog(page).getByPlaceholder('~/Projects/Tiles').fill(repo);
    await page.waitForTimeout(1200);
    const box = await dialog(page).boundingBox();
    return { clip: { x: box.x, y: box.y, width: box.width, height: 500 } }; // path, name, branch, worktree dir
  });

  // Seed the board.
  await api('PUT', '/settings/github', { token: 'github_pat_11DEMO0000000000000000000000000000000000' });
  const project = await api('POST', '/projects', { path: repo, name: 'acme-web', baseBranch: 'main', description: 'Customer dashboard' });
  await api('PATCH', `/projects/${project.id}`, {
    pipeline: { ...project.pipeline, plan: true, planApproval: true, validate: true, tester: true, reviewer: true, finalApproval: true },
  });
  const mk = (title, description, priority) => api('POST', `/projects/${project.id}/features`, { title, description, priority });
  const rate = await mk('Rate limiting for the public API', 'Limit each API key to 100 requests per minute. Return 429 with a Retry-After header.', 'high');
  const reports = await mk('Reports API', 'Add GET /api/reports/:month that totals invoices with @src/reports.js. Paginate by 50.', 'high');
  const oauth = await mk('OAuth login with GitHub', 'Add "Sign in with GitHub" next to the email login. Link accounts by verified email.', 'medium');
  const dark = await mk('Dark mode for the settings page', 'Follow the OS by default, store the choice, and keep the existing tokens. Add a toggle next to the account menu.', 'medium');
  const csv = await mk('CSV export for reports', 'Download the monthly report as CSV.', 'low');
  await mk('Onboarding email sequence', 'Three emails over the first week.', 'low');
  await api('PUT', `/features/${csv.id}/dependencies`, { dependsOn: [reports.id] });

  const gate = (f, type) => waitFor(f.id, (x) => x.gate?.type === type, `${f.title} ${type}`);
  for (const f of [rate, dark, oauth]) await api('PATCH', `/features/${f.id}`, { status: 'build' });
  for (const f of [rate, dark]) {
    await gate(f, 'plan_approval');
    await api('POST', `/features/${f.id}/gate`, { action: 'approve' });
  }
  await gate(rate, 'final_approval');
  await api('POST', `/features/${rate.id}/gate`, { action: 'approve' });
  await waitFor(rate.id, (x) => x.status === 'done', 'rate done');
  await gate(dark, 'final_approval');
  await gate(oauth, 'plan_approval');
  await api('PATCH', `/features/${reports.id}`, { status: 'build' });
  await gate(reports, 'plan_approval');
  await api('POST', `/features/${reports.id}/gate`, { action: 'approve' });
  await waitFor(reports.id, (x) => x.agentStatus === 'running' && !x.gate, 'reports developing');
  await sleep(4000); // let the held developer run emit a few events

  // 3. The board.
  await shoot(browser, 'board', async () => null);
  // 4. Quick add in the Backlog column.
  await shoot(browser, 'quick-add', async (page) => {
    await page.getByPlaceholder('Quick add a feature…').click();
    await page.keyboard.type('Invoice PDF download');
    await page.waitForTimeout(400);
    await page.keyboard.press('Tab');
    await page.keyboard.type('Add a Download PDF button to each invoice row. Reuse @src/reports.js totals.');
    return null;
  }, { clip: { x: 270, y: 60, width: 400, height: 450 } });
  // 5. Agent working: the detail sheet of the running card.
  await shoot(browser, 'agent-running', async (page) => { await openSheet(page, 'Reports API'); return null; });
  await shoot(browser, 'agent-pipeline', async (page) => { await openSheet(page, 'Reports API', 'Pipeline'); return null; });
  await shoot(browser, 'agent-activity', async (page) => { await openSheet(page, 'Reports API', 'Activity'); return null; });
  // 6. Plan approval gate.
  await shoot(browser, 'plan-approval', async (page) => { await openSheet(page, 'OAuth login with GitHub'); return null; });
  // 7. Final approval + the diff.
  await shoot(browser, 'changes', async (page) => { await openSheet(page, 'Dark mode for the settings page', 'Changes'); return null; });
  await shoot(browser, 'final-approval', async (page) => { await openSheet(page, 'Dark mode for the settings page'); return null; });
  // 8. Project pipeline settings.
  await shoot(browser, 'project-pipeline', async (page) => {
    await page.getByRole('button', { name: 'Project settings' }).click();
    await dialog(page).locator('legend', { hasText: 'Pipeline' }).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(400);
    return dialog(page);
  });
  // 9. Settings → GitHub token.
  await shoot(browser, 'settings-github', async (page) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const fieldset = dialog(page).locator('fieldset', { has: page.locator('legend', { hasText: 'GitHub' }) });
    await fieldset.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    return fieldset;
  });
  await shoot(browser, 'settings', async (page) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    // Show what a real install has here instead of this script's fake CLI path (not saved).
    await dialog(page).locator('input[value$="slow-claude.mjs"]').fill('claude');
    await page.locator('body').click({ position: { x: 5, y: 5 }, trial: true });
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.waitForTimeout(400);
    return dialog(page);
  });
}
await main();
fs.rmSync(tmp, { recursive: true, force: true });
