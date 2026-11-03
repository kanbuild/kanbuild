/** Pure helpers for the desktop main process (unit-tested in desktop/test/env.test.ts). */
import path from 'node:path';

const MARK = '__ORCH_PATH__';

/** Extract the PATH printed between markers by the login shell (shell rc files may print other noise). */
export function parseMarkedPath(stdout: string): string | null {
  const start = stdout.indexOf(MARK);
  if (start < 0) return null;
  const end = stdout.indexOf(MARK, start + MARK.length);
  if (end < 0) return null;
  const value = stdout.slice(start + MARK.length, end).trim();
  return value || null;
}

/** Append the usual install locations for claude/git/node that a GUI app would otherwise miss. */
export function withFallbackPath(current: string | undefined, home: string): string {
  const parts = (current || '').split(':').filter(Boolean);
  const extra = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.claude', 'local'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  for (const dir of extra) if (!parts.includes(dir)) parts.push(dir);
  return parts.join(':');
}

/** Environment for the backend child: the user's PATH, the bundled dashboard, no Electron internals. */
export function buildBackendEnv(
  base: NodeJS.ProcessEnv,
  opts: { path: string; webDist: string; port: number },
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (k.startsWith('ELECTRON_') || k === 'NODE_OPTIONS' || k === 'NODE_ENV') continue;
    env[k] = v;
  }
  env.PATH = opts.path;
  env.ORCH_WEB_DIST = opts.webDist;
  env.ORCH_PORT = String(opts.port);
  env.ORCH_HOST = '127.0.0.1';
  // Same value as the server's npm scripts, so childEnv() strips it from agents again.
  env.NODE_OPTIONS = '--disable-warning=ExperimentalWarning';
  return env;
}

/** True for URLs that belong to the dashboard itself (stay in the window); everything else opens externally. */
export function isLocalUrl(url: string, port: number): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'ws:') && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && Number(u.port || 80) === port;
  } catch {
    return false;
  }
}
