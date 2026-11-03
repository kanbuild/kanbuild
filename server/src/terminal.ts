import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { bus } from './events.ts';
import { childEnv, killGroup } from './runner.ts';
import type { TerminalSession } from '../../shared/types.ts';

/**
 * Worktree command runner: runs user-typed shell commands in a feature's worktree
 * (e.g. `npm test`, `npm run dev`) and streams the output to the dashboard.
 * Not a PTY: stdin is closed, ANSI codes are stripped. Sessions are in memory only.
 */

/** Characters of output kept per session (older output is dropped from the front). */
export const MAX_OUTPUT_CHARS = 200_000;
/** Commands that may run at the same time for one feature. */
export const MAX_RUNNING_PER_FEATURE = 4;
/** Sessions (running + finished) kept per feature; the oldest finished ones are dropped. */
export const MAX_SESSIONS_PER_FEATURE = 20;

interface Entry {
  session: TerminalSession;
  child: ChildProcess | null;
  killTimer: NodeJS.Timeout | null;
}

const sessions = new Map<string, Entry>();

export class TerminalError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][0-9A-Za-z]|\x1b[=>]/g;

export function cleanOutput(text: string): string {
  return text.replace(ANSI, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function snapshot(e: Entry): TerminalSession {
  return { ...e.session };
}

export function listTerminalSessions(featureId: string): TerminalSession[] {
  return [...sessions.values()]
    .filter((e) => e.session.featureId === featureId)
    .sort((a, b) => a.session.startedAt.localeCompare(b.session.startedAt))
    .map(snapshot);
}

export function getTerminalSession(id: string): TerminalSession | null {
  const e = sessions.get(id);
  return e ? snapshot(e) : null;
}

export function runningCount(featureId: string): number {
  let n = 0;
  for (const e of sessions.values()) if (e.session.featureId === featureId && e.session.status === 'running') n++;
  return n;
}

function prune(featureId: string) {
  const mine = [...sessions.values()]
    .filter((e) => e.session.featureId === featureId)
    .sort((a, b) => a.session.startedAt.localeCompare(b.session.startedAt));
  let excess = mine.length - MAX_SESSIONS_PER_FEATURE;
  for (const e of mine) {
    if (excess <= 0) break;
    if (e.session.status === 'running') continue;
    sessions.delete(e.session.id);
    excess--;
  }
}

function append(e: Entry, raw: string) {
  const chunk = cleanOutput(raw);
  if (!chunk) return;
  const s = e.session;
  const offset = s.outputStart + s.output.length;
  s.output += chunk;
  if (s.output.length > MAX_OUTPUT_CHARS) {
    const drop = s.output.length - MAX_OUTPUT_CHARS;
    s.output = s.output.slice(drop);
    s.outputStart += drop;
  }
  bus.publish({ type: 'terminal.output', sessionId: s.id, featureId: s.featureId, offset, chunk });
}

/** Start `command` with /bin/sh in `cwd` (the feature's worktree). */
export function runTerminalCommand(featureId: string, cwd: string, command: string): TerminalSession {
  const cmd = command.trim();
  if (!cmd) throw new TerminalError(400, 'Command is empty');
  if (runningCount(featureId) >= MAX_RUNNING_PER_FEATURE) {
    throw new TerminalError(409, `At most ${MAX_RUNNING_PER_FEATURE} commands can run at once. Stop one first.`);
  }
  const session: TerminalSession = {
    id: `term_${randomUUID().slice(0, 8)}`,
    featureId,
    cwd,
    command: cmd,
    status: 'running',
    exitCode: null,
    signal: null,
    pid: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    output: '',
    outputStart: 0,
  };
  const entry: Entry = { session, child: null, killTimer: null };
  sessions.set(session.id, entry);
  prune(featureId);

  const child = spawn('/bin/sh', ['-c', cmd], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv({ FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb' }),
  });
  entry.child = child;
  session.pid = child.pid ?? null;
  child.stdout!.setEncoding('utf8');
  child.stderr!.setEncoding('utf8');
  child.stdout!.on('data', (d: string) => append(entry, d));
  child.stderr!.on('data', (d: string) => append(entry, d));

  let done = false;
  const finish = (code: number | null, signal: string | null) => {
    if (done) return;
    done = true;
    if (entry.killTimer) clearTimeout(entry.killTimer);
    entry.child = null;
    session.status = 'exited';
    session.exitCode = code;
    session.signal = signal;
    session.endedAt = new Date().toISOString();
    bus.publish({ type: 'terminal.updated', session: snapshot(entry) });
  };
  child.on('error', (err) => {
    append(entry, `Failed to start: ${err.message}\n`);
    finish(127, null);
  });
  child.on('close', (code, signal) => finish(code, signal));

  bus.publish({ type: 'terminal.updated', session: snapshot(entry) });
  return snapshot(entry);
}

/** SIGTERM the command's process group, SIGKILL after 3 s. */
export function stopTerminalCommand(id: string): TerminalSession {
  const e = sessions.get(id);
  if (!e) throw new TerminalError(404, 'Terminal session not found');
  const pid = e.child?.pid;
  if (e.session.status === 'running' && pid) {
    killGroup(pid, 'SIGTERM');
    if (!e.killTimer) {
      e.killTimer = setTimeout(() => killGroup(pid, 'SIGKILL'), 3000);
      e.killTimer.unref();
    }
  }
  return snapshot(e);
}

/** Forget a feature's finished sessions. Running ones are kept. */
export function clearTerminalSessions(featureId: string): TerminalSession[] {
  for (const e of [...sessions.values()]) {
    if (e.session.featureId === featureId && e.session.status !== 'running') sessions.delete(e.session.id);
  }
  return listTerminalSessions(featureId);
}

/** Kill every running command (backend shutdown) — unlike agents, these don't outlive the backend. */
export function stopAllTerminalCommands() {
  for (const e of sessions.values()) {
    const pid = e.child?.pid;
    if (e.session.status === 'running' && pid) killGroup(pid, 'SIGTERM');
  }
}
