import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ServerMessage } from '../../shared/types.ts';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-term-'));
process.env.ORCH_DATA_DIR = path.join(tmp, 'data');
process.env.ORCH_GITHUB_TOKEN = 'ghp_should_not_leak';

let term: typeof import('../src/terminal.ts');
let bus: typeof import('../src/events.ts').bus;
const messages: ServerMessage[] = [];
const cwd = path.join(tmp, 'wt');

async function waitFor<T>(fn: () => T | null | undefined | false, ms = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'marker.txt'), 'x');
  term = await import('../src/terminal.ts');
  bus = (await import('../src/events.ts')).bus;
  bus.on('message', (m: ServerMessage) => messages.push(m));
});

afterAll(() => {
  term.stopAllTerminalCommands();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('terminal command runner', () => {
  it('runs a command in the worktree and streams output', async () => {
    const s = term.runTerminalCommand('ftr_a', cwd, 'ls; echo "hi \x1b[32mthere\x1b[0m"; echo err >&2');
    expect(s.status).toBe('running');
    const done = await waitFor(() => {
      const x = term.getTerminalSession(s.id);
      return x?.status === 'exited' ? x : null;
    });
    expect(done.exitCode).toBe(0);
    expect(done.output).toContain('marker.txt');
    expect(done.output).toContain('hi there');
    expect(done.output).toContain('err');
    expect(done.output).not.toContain('\x1b');
    const chunks = messages.filter((m) => m.type === 'terminal.output' && m.sessionId === s.id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.type === 'terminal.updated' && m.session.id === s.id && m.session.status === 'exited')).toBe(true);
  });

  it('reports a non-zero exit code', async () => {
    const s = term.runTerminalCommand('ftr_a', cwd, 'exit 3');
    const done = await waitFor(() => term.getTerminalSession(s.id)?.status === 'exited' && term.getTerminalSession(s.id));
    expect(done && done.exitCode).toBe(3);
  });

  it('uses the sanitized child env (no GitHub token)', async () => {
    const s = term.runTerminalCommand('ftr_a', cwd, 'echo "tok=${ORCH_GITHUB_TOKEN:-none}"');
    const done = await waitFor(() => term.getTerminalSession(s.id)?.status === 'exited' && term.getTerminalSession(s.id));
    expect(done && done.output).toContain('tok=none');
  });

  it('stops a long-running command and its children', async () => {
    const s = term.runTerminalCommand('ftr_b', cwd, 'sleep 30 & sleep 30; wait');
    expect(term.runningCount('ftr_b')).toBe(1);
    term.stopTerminalCommand(s.id);
    const done = await waitFor(() => term.getTerminalSession(s.id)?.status === 'exited' && term.getTerminalSession(s.id));
    expect(done && (done.signal || done.exitCode !== 0)).toBeTruthy();
    expect(term.runningCount('ftr_b')).toBe(0);
  });

  it('rejects empty commands and too many concurrent ones', () => {
    expect(() => term.runTerminalCommand('ftr_c', cwd, '   ')).toThrow(/empty/);
    const ids = Array.from({ length: term.MAX_RUNNING_PER_FEATURE }, () => term.runTerminalCommand('ftr_c', cwd, 'sleep 30').id);
    expect(() => term.runTerminalCommand('ftr_c', cwd, 'echo no')).toThrow(term.TerminalError);
    ids.forEach((id) => term.stopTerminalCommand(id));
  });

  it('clear keeps running sessions and drops finished ones', async () => {
    const a = term.runTerminalCommand('ftr_d', cwd, 'true');
    await waitFor(() => term.getTerminalSession(a.id)?.status === 'exited');
    const b = term.runTerminalCommand('ftr_d', cwd, 'sleep 30');
    const left = term.clearTerminalSessions('ftr_d');
    expect(left.map((s) => s.id)).toEqual([b.id]);
    term.stopTerminalCommand(b.id);
  });

  it('caps buffered output and records the dropped prefix', async () => {
    const s = term.runTerminalCommand('ftr_e', cwd, `head -c ${term.MAX_OUTPUT_CHARS + 5000} /dev/zero | tr '\\0' a`);
    const done = await waitFor(() => term.getTerminalSession(s.id)?.status === 'exited' && term.getTerminalSession(s.id));
    expect(done && done.output.length).toBe(term.MAX_OUTPUT_CHARS);
    expect(done && done.outputStart).toBe(5000);
  });

  it('cleanOutput strips ANSI and normalizes carriage returns', () => {
    expect(term.cleanOutput('\x1b[1mbold\x1b[0m\r\nline\rnext')).toBe('bold\nline\nnext');
  });
});
