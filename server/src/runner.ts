import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StreamParser, type ParsedEvent } from './streamParser.ts';

export interface LaunchSpec {
  logDir: string;
  cwd: string;
  binary: string;
  args: string[];
}

export const STDOUT_FILE = 'stdout.ndjson';
export const STDERR_FILE = 'stderr.log';
export const EXIT_FILE = 'exit_code';

/**
 * Launch a Claude Code process fully detached from the backend.
 * stdout/stderr go straight to files, and a tiny sh wrapper records the exit code,
 * so the agent keeps running (and its outcome is recoverable) even if the backend restarts.
 */
export function launchDetached(spec: LaunchSpec): number {
  fs.mkdirSync(spec.logDir, { recursive: true });
  const out = fs.openSync(path.join(spec.logDir, STDOUT_FILE), 'a');
  const err = fs.openSync(path.join(spec.logDir, STDERR_FILE), 'a');
  const exitFile = path.join(spec.logDir, EXIT_FILE);
  const env: NodeJS.ProcessEnv = { ...process.env, ORCH_EXIT_FILE: exitFile };
  // Avoid the child believing it is nested inside another Claude Code session.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const child = spawn(
    '/bin/sh',
    ['-c', '"$0" "$@" < /dev/null; code=$?; echo "$code" > "$ORCH_EXIT_FILE.tmp" && mv "$ORCH_EXIT_FILE.tmp" "$ORCH_EXIT_FILE"', spec.binary, ...spec.args],
    { cwd: spec.cwd, detached: true, stdio: ['ignore', out, err], env },
  );
  fs.closeSync(out);
  fs.closeSync(err);
  if (!child.pid) throw new Error(`Failed to launch ${spec.binary}`);
  child.on('error', () => {
    /* surfaced through the exit file / liveness check */
  });
  child.unref();
  return child.pid;
}

export function isAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';
  }
}

/** Signal the whole process group (wrapper shell + Claude Code + its children). */
export function killGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

export function readExitCode(logDir: string): number | null {
  try {
    const raw = fs.readFileSync(path.join(logDir, EXIT_FILE), 'utf8').trim();
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function readStderrTail(logDir: string, bytes = 4000): string {
  try {
    const file = path.join(logDir, STDERR_FILE);
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const len = Math.min(bytes, size);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

export interface TailCallbacks {
  onEvents(events: ParsedEvent[], offset: number): void;
  onExit(exitCode: number | null): void;
}

/**
 * Polls a run's stdout log, feeding new bytes to the parser, and detects termination
 * via the exit-code file or process liveness. Can be (re)attached at any byte offset:
 * bytes before `offset` are replayed silently to rebuild parser state.
 */
export class LogTail {
  readonly parser = new StreamParser();
  private offset = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private deadSince: number | null = null;
  private stderrOffset = 0;

  constructor(
    private logDir: string,
    private pid: number | null,
    private cb: TailCallbacks & { onStderr?(text: string): void },
    private pollMs = 400,
  ) {}

  start(resumeOffset = 0) {
    const file = path.join(this.logDir, STDOUT_FILE);
    if (resumeOffset > 0 && fs.existsSync(file)) {
      const fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(resumeOffset);
      const read = fs.readSync(fd, buf, 0, resumeOffset, 0);
      fs.closeSync(fd);
      this.parser.feedChunk(buf.subarray(0, read).toString('utf8'));
      this.offset = read;
    }
    try {
      this.stderrOffset = fs.statSync(path.join(this.logDir, STDERR_FILE)).size;
      if (resumeOffset === 0) this.stderrOffset = 0;
    } catch {
      this.stderrOffset = 0;
    }
    this.tick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private readNew(final = false): boolean {
    const file = path.join(this.logDir, STDOUT_FILE);
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      return false;
    }
    if (size <= this.offset) return false;
    const fd = fs.openSync(file, 'r');
    const len = size - this.offset;
    const buf = Buffer.alloc(len);
    const read = fs.readSync(fd, buf, 0, len, this.offset);
    fs.closeSync(fd);
    // Only consume up to the last complete line so offsets always land on line boundaries.
    const chunk = buf.subarray(0, read);
    const lastNl = chunk.lastIndexOf(0x0a);
    if (lastNl < 0 && !final) return false;
    const complete = final ? chunk : chunk.subarray(0, lastNl + 1);
    this.offset += complete.length;
    const events = this.parser.feedChunk(complete.toString('utf8'));
    this.cb.onEvents(events, this.offset);
    return true;
  }

  private readStderr() {
    if (!this.cb.onStderr) return;
    const file = path.join(this.logDir, STDERR_FILE);
    try {
      const size = fs.statSync(file).size;
      if (size <= this.stderrOffset) return;
      const fd = fs.openSync(file, 'r');
      const len = Math.min(size - this.stderrOffset, 64 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, this.stderrOffset);
      fs.closeSync(fd);
      this.stderrOffset += len;
      const text = buf.toString('utf8').trim();
      if (text) this.cb.onStderr(text);
    } catch {
      /* no stderr */
    }
  }

  private tick = () => {
    if (this.stopped) return;
    try {
      this.readNew();
      this.readStderr();
      const exitCode = readExitCode(this.logDir);
      const alive = isAlive(this.pid);
      if (exitCode !== null || !alive) {
        // Allow a short grace period for the final bytes / exit file to land.
        if (this.deadSince === null) this.deadSince = Date.now();
        if (exitCode !== null || Date.now() - this.deadSince > 1500) {
          this.readNew(true);
          // Trailing data without newline.
          const rest = this.parser.flush();
          if (rest.length) this.cb.onEvents(rest, this.offset);
          this.stop();
          this.cb.onExit(exitCode);
          return;
        }
      }
    } catch (err) {
      console.error('[tail] error', err);
    }
    this.timer = setTimeout(this.tick, this.pollMs);
  };
}
