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

  describe('cd persists between commands', () => {
    const done = (id: string) => waitFor(() => term.getTerminalSession(id)?.status === 'exited' && term.getTerminalSession(id));
    const run = async (cmd: string) => {
      const s = term.runTerminalCommand('ftr_cd', cwd, cmd);
      const r = await done(s.id);
      if (!r) throw new Error('no session');
      return r;
    };

    it('a later command starts where cd left off', async () => {
      fs.mkdirSync(path.join(cwd, 'sub', 'deeper'), { recursive: true });
      const c = await run('cd sub');
      expect(c.cwd).toBe(cwd);
      expect(c.endCwd).toBe(path.join(cwd, 'sub'));
      expect(c.output).toBe('');
      const p = await run('pwd');
      expect(p.cwd).toBe(c.endCwd);
      expect(fs.realpathSync(p.output.trim())).toBe(fs.realpathSync(c.endCwd!));
      expect(term.getTerminalCwd('ftr_cd', cwd)).toBe(c.endCwd);
    });

    it('records the directory even when the command exits non-zero', async () => {
      const r = await run('cd deeper && exit 3');
      expect(r.exitCode).toBe(3);
      expect(r.endCwd?.endsWith('/sub/deeper')).toBe(true);
      expect(term.getTerminalCwd('ftr_cd', cwd).endsWith('/sub/deeper')).toBe(true);
    });

    it('a command that does not cd keeps the current directory', async () => {
      const before = term.getTerminalCwd('ftr_cd', cwd);
      await run('true');
      expect(term.getTerminalCwd('ftr_cd', cwd)).toBe(before);
    });

    it('reset goes back to the worktree root', async () => {
      term.resetTerminalCwd('ftr_cd');
      expect(term.getTerminalCwd('ftr_cd', cwd)).toBe(cwd);
      expect((await run('pwd')).output.trim()).toBe(fs.realpathSync(cwd));
    });

    it('falls back to the root when the stored directory was deleted', async () => {
      fs.mkdirSync(path.join(cwd, 'gone'));
      await run('cd gone');
      fs.rmSync(path.join(cwd, 'gone'), { recursive: true });
      expect(term.getTerminalCwd('ftr_cd', cwd)).toBe(cwd);
      expect((await run('pwd')).output.trim()).toBe(fs.realpathSync(cwd));
    });

    it('maps a physical path back under a symlinked worktree root', async () => {
      const link = path.join(tmp, 'wt-link');
      fs.symlinkSync(cwd, link);
      const s = term.runTerminalCommand('ftr_link', link, 'cd sub');
      const r = await done(s.id);
      expect(r && r.endCwd).toBe(path.join(link, 'sub'));
    });

    it('cwd is tracked per feature', async () => {
      await run('cd sub');
      expect(term.getTerminalCwd('ftr_other', cwd)).toBe(cwd);
      term.resetTerminalCwd('ftr_cd');
    });

    it('leaves no temp cwd files behind', async () => {
      const r = await run('true');
      await new Promise((res) => setTimeout(res, 50));
      expect(fs.existsSync(path.join(os.tmpdir(), `orch-${r.id}.cwd`))).toBe(false);
    });
  });

  it('cleanOutput strips ANSI and normalizes carriage returns', () => {
    expect(term.cleanOutput('\x1b[1mbold\x1b[0m\r\nline\rnext')).toBe('bold\nline\nnext');
  });
});
