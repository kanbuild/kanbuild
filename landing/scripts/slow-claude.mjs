#!/usr/bin/env node
// Screenshot helper around the fake Claude CLI (server/test/fixtures/fake-claude.mjs).
// The developer run of the "Reports API" feature pauses right before it runs the
// tests and stays alive, so screenshots can catch a card mid-run. Everything else passes
// straight through.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fake = path.resolve(here, '../../server/test/fixtures/fake-claude.mjs');
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] ?? '';
const role = (prompt.match(/<!-- orchestrator-role: (\w+) -->/) ?? [])[1] ?? 'developer';
// After plan approval the developer prompt no longer names the feature, so match its worktree.
const hold = role === 'developer' && /reports-api/.test(process.cwd()) && !/orchestrator-fix/.test(prompt);

const child = spawn(process.execPath, [fake, ...args], {
  stdio: ['inherit', 'pipe', 'inherit'],
  env: { ...process.env, FAKE_CLAUDE_DELAY_MS: hold ? '700' : '60' },
});
process.on('SIGTERM', () => {
  child.kill('SIGTERM');
  process.exit(143);
});

let buf = '';
let held = false;
child.stdout.on('data', (chunk) => {
  if (held) return;
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i + 1);
    buf = buf.slice(i + 1);
    if (hold && line.includes('"name":"Bash"')) {
      // Pretend the test run is still going: keep the process alive and quiet.
      held = true;
      child.kill('SIGKILL');
      setInterval(() => {}, 1 << 30);
      return;
    }
    process.stdout.write(line);
  }
});
child.on('exit', (code) => {
  if (!held) process.exit(code ?? 1);
});
