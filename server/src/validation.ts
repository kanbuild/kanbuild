import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { childEnv, killGroup } from './runner.ts';
import type { ValidationResult } from '../../shared/types.ts';

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_TAIL_LINES = 200;

export interface DetectedValidation {
  commands: string[];
  /** Where the commands came from, for display. */
  source: string;
}

/**
 * Work out validation commands when the project has none configured.
 * Node: install dependencies when node_modules is missing (fresh worktrees have none), then test,
 * type-check and build scripts. Rust: cargo test. Go: go test ./... and go vet ./...
 */
export function detectValidationCommands(dir: string): DetectedValidation {
  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    let scripts: Record<string, string> = {};
    try {
      scripts = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts ?? {};
    } catch {
      /* invalid package.json: fall through with no scripts */
    }
    const pm = fs.existsSync(path.join(dir, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(dir, 'yarn.lock')) ? 'yarn' : 'npm';
    const run = (s: string) => (pm === 'npm' ? (s === 'test' ? 'npm test' : `npm run ${s}`) : `${pm} ${s}`);
    const commands: string[] = [];
    const hasTest = scripts.test && !/no test specified/.test(scripts.test);
    const typecheck = ['typecheck', 'type-check', 'tsc'].find((s) => scripts[s]);
    if (typecheck) commands.push(run(typecheck));
    if (hasTest) commands.push(run('test'));
    if (scripts.build) commands.push(run('build'));
    return { commands, source: `package.json (${pm})` };
  }
  if (fs.existsSync(path.join(dir, 'Cargo.toml'))) return { commands: ['cargo test'], source: 'Cargo.toml' };
  if (fs.existsSync(path.join(dir, 'go.mod'))) return { commands: ['go vet ./...', 'go test ./...'], source: 'go.mod' };
  return { commands: [], source: 'none detected' };
}

/** Install step for Node projects whose worktree has no node_modules yet (never writes a lockfile). */
export function installCommand(dir: string): string | null {
  if (!fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, 'node_modules'))) return null;
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm install --frozen-lockfile';
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn install --frozen-lockfile';
  if (fs.existsSync(path.join(dir, 'package-lock.json'))) return 'npm ci';
  return 'npm install --no-save --no-package-lock';
}

export function resolveValidationCommands(configured: string[], worktree: string | null): DetectedValidation {
  if (configured.length) return { commands: configured, source: 'project settings' };
  if (!worktree || !fs.existsSync(worktree)) return { commands: [], source: 'none detected' };
  return detectValidationCommands(worktree);
}

export interface ValidationCallbacks {
  onStart: (command: string) => void;
  onOutput: (command: string, chunk: string) => void;
  onResult: (result: ValidationResult) => void;
}

/** Runs validation commands sequentially (stopping at the first failure) and can be cancelled. */
export class ValidationRun {
  private child: ChildProcess | null = null;
  private cancelled = false;

  constructor(
    private cwd: string,
    private commands: string[],
    private cb: ValidationCallbacks,
    private timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async run(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    for (const command of this.commands) {
      if (this.cancelled) break;
      const r = await this.runOne(command);
      results.push(r);
      this.cb.onResult(r);
      if (r.exitCode !== 0 || r.timedOut) break;
    }
    return results;
  }

  get wasCancelled() {
    return this.cancelled;
  }

  cancel() {
    this.cancelled = true;
    if (this.child?.pid) killGroup(this.child.pid, 'SIGTERM');
    const pid = this.child?.pid;
    if (pid) setTimeout(() => killGroup(pid, 'SIGKILL'), 3000).unref();
  }

  private runOne(command: string): Promise<ValidationResult> {
    this.cb.onStart(command);
    const started = Date.now();
    return new Promise((resolve) => {
      let tail: string[] = [];
      let partial = '';
      let timedOut = false;
      const child = spawn('/bin/sh', ['-c', command], {
        cwd: this.cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: childEnv({ CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' }),
      });
      this.child = child;
      const onData = (buf: Buffer) => {
        const text = partial + buf.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
        const lines = text.split('\n');
        partial = lines.pop() ?? '';
        if (lines.length) {
          tail = [...tail, ...lines].slice(-OUTPUT_TAIL_LINES);
          this.cb.onOutput(command, lines.join('\n'));
        }
      };
      child.stdout!.on('data', onData);
      child.stderr!.on('data', onData);
      const timer = setTimeout(() => {
        timedOut = true;
        if (child.pid) killGroup(child.pid, 'SIGKILL');
      }, this.timeoutMs);
      const finish = (code: number | null) => {
        clearTimeout(timer);
        if (partial) tail = [...tail, partial].slice(-OUTPUT_TAIL_LINES);
        this.child = null;
        resolve({ command, exitCode: code, durationMs: Date.now() - started, timedOut, output: tail.join('\n') });
      };
      child.on('error', (err) => {
        tail.push(`Failed to start: ${err.message}`);
        finish(127);
      });
      child.on('close', (code, signal) => finish(code ?? (signal ? 128 : null)));
    });
  }
}
