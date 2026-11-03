import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bus } from './events.ts';
import { childEnv, killGroup } from './runner.ts';
import type { TerminalSession } from '../../shared/types.ts';

/**
 * Worktree command runner: runs user-typed shell commands in a feature's worktree
 * (e.g. `npm test`, `npm run dev`) and streams the output to the dashboard.
 * Not a PTY: stdin is closed, ANSI codes are stripped. Sessions are in memory only.
 *
 * Each command runs in its own shell, so `cd` is carried over explicitly: an EXIT trap writes
 * the shell's final directory to a temp file, and the next command for that feature starts there.
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
/** Current directory per feature (set by commands that `cd`). Absent = the worktree root. */
const featureCwd = new Map<string, string>();

function isDir(p: string | null | undefined): p is string {
  if (!p) return false;
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Where the next command for this feature starts: the last `cd` target if it still exists, else `root`. */
export function getTerminalCwd(featureId: string, root: string): string {
  const cwd = featureCwd.get(featureId);
  return isDir(cwd) ? cwd : root;
}

/** `pwd` reports the physical path; map it back under `root` when root goes through a symlink (e.g. /tmp on macOS). */
function underRoot(dir: string, root: string): string {
  let real = root;
  try {
    real = fs.realpathSync(root);
  } catch {
    return dir;
  }
  if (real === root) return dir;
  if (dir === real) return root;
  return dir.startsWith(real + '/') ? root + dir.slice(real.length) : dir;
}

/** Go back to the worktree root. */
export function resetTerminalCwd(featureId: string) {
  featureCwd.delete(featureId);
}

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

/** Start `command` with /bin/sh in the feature's current directory (`root` = its worktree, by default). */
export function runTerminalCommand(featureId: string, root: string, command: string): TerminalSession {
  const cmd = command.trim();
  if (!cmd) throw new TerminalError(400, 'Command is empty');
  if (runningCount(featureId) >= MAX_RUNNING_PER_FEATURE) {
    throw new TerminalError(409, `At most ${MAX_RUNNING_PER_FEATURE} commands can run at once. Stop one first.`);
  }
  const cwd = getTerminalCwd(featureId, root);
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
    endCwd: null,
    output: '',
    outputStart: 0,
  };
  const entry: Entry = { session, child: null, killTimer: null };
  sessions.set(session.id, entry);
  prune(featureId);

  // The EXIT trap also fires on `exit N`, but not when the command is killed by a signal.
  const cwdFile = path.join(os.tmpdir(), `orch-${session.id}.cwd`);
  const script = `trap 'pwd > "$ORCH_TERM_CWD_FILE" 2>/dev/null' EXIT\n${cmd}`;
  const child = spawn('/bin/sh', ['-c', script], {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv({ FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb', ORCH_TERM_CWD_FILE: cwdFile }),
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
    try {
      const end = underRoot(fs.readFileSync(cwdFile, 'utf8').trim(), root);
      if (isDir(end)) {
        session.endCwd = end;
        // Only a command that actually moved updates the feature's cwd, so a long-running
        // command started earlier (e.g. a dev server) doesn't undo a later `cd` when it ends.
        if (end !== cwd) featureCwd.set(featureId, end);
      }
    } catch {
      /* killed by a signal, or failed to start */
    }
    fs.rm(cwdFile, { force: true }, () => {});
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
