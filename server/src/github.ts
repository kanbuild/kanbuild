import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.ts';
import { GitError, git } from './git.ts';
import type { GithubStatus } from '../../shared/types.ts';

const TOKEN_FILE = () => path.join(DATA_DIR, 'github-token');
const ASKPASS_FILE = () => path.join(DATA_DIR, 'git-askpass.sh');

export class GithubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Token from ORCH_GITHUB_TOKEN, else from the 0600 token file. Never sent to the browser, agents or logs. */
export function getToken(): { token: string; source: 'env' | 'file' } | null {
  if (process.env.ORCH_GITHUB_TOKEN) return { token: process.env.ORCH_GITHUB_TOKEN.trim(), source: 'env' };
  try {
    const t = fs.readFileSync(TOKEN_FILE(), 'utf8').trim();
    return t ? { token: t, source: 'file' } : null;
  } catch {
    return null;
  }
}

let cachedLogin: string | null = null;

export function githubStatus(): GithubStatus {
  const t = getToken();
  return { configured: !!t, source: t?.source ?? null, login: t ? cachedLogin : null };
}

/** Validate the token against GET /user, then store it with owner-only permissions. Empty token clears it. */
export async function setToken(token: string): Promise<GithubStatus> {
  const t = token.trim();
  if (!t) {
    fs.rmSync(TOKEN_FILE(), { force: true });
    cachedLogin = null;
    return githubStatus();
  }
  if (!/^[\w-]{20,255}$/.test(t)) throw new GithubError(400, 'That does not look like a GitHub token');
  const user = await ghFetch<{ login: string }>('GET', '/user', undefined, t);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE(), t + '\n', { mode: 0o600 });
  fs.chmodSync(TOKEN_FILE(), 0o600);
  cachedLogin = user.login;
  return githubStatus();
}

/** Check the configured token and refresh the cached login. */
export async function verifyToken(): Promise<GithubStatus> {
  const t = getToken();
  if (!t) return githubStatus();
  const user = await ghFetch<{ login: string }>('GET', '/user', undefined, t.token);
  cachedLogin = user.login;
  return githubStatus();
}

export interface RemoteRepo {
  host: string;
  owner: string;
  repo: string;
}

/** Parse GitHub remotes: https://github.com/o/r(.git), git@github.com:o/r.git, ssh://git@github.com/o/r.git. */
export function parseRemote(url: string): RemoteRepo | null {
  const u = url.trim();
  let m = u.match(/^(?:ssh:\/\/)?[\w.-]+@([\w.-]+)(?::\d+)?[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) m = u.match(/^(?:https?|git):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  return { host: m[1].toLowerCase(), owner: m[2], repo: m[3] };
}

/** REST API base: ORCH_GITHUB_API_URL (tests), github.com, or GitHub Enterprise's /api/v3. */
export function apiBase(host = 'github.com'): string {
  if (process.env.ORCH_GITHUB_API_URL) return process.env.ORCH_GITHUB_API_URL.replace(/\/$/, '');
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

export async function ghFetch<T>(method: string, apiPath: string, body?: unknown, token?: string, host?: string): Promise<T> {
  const t = token ?? getToken()?.token;
  if (!t) throw new GithubError(400, 'No GitHub token configured. Add one in Settings → GitHub.');
  let res: Response;
  try {
    res = await fetch(`${apiBase(host)}${apiPath}`, {
      method,
      signal: AbortSignal.timeout(20000),
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'local-ai-orchestrator',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err: any) {
    const cause = err?.name === 'TimeoutError' ? 'timed out after 20s' : err?.cause?.code || err?.cause?.message || err?.message;
    throw new GithubError(502, `Could not reach GitHub at ${apiBase(host)} (${cause}). Check your network, VPN or proxy.`);
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text.slice(0, 300) };
  }
  if (!res.ok) {
    const detail = Array.isArray(data?.errors) ? data.errors.map((e: any) => e.message || e.code).filter(Boolean).join('; ') : '';
    const msg = res.status === 401 ? 'GitHub rejected the token (401). Check it in Settings → GitHub.' : `GitHub API ${res.status}: ${data?.message ?? res.statusText}${detail ? ` (${detail})` : ''}`;
    throw new GithubError(res.status, msg);
  }
  return data as T;
}

/** A tiny GIT_ASKPASS helper that reads the token from the environment, so it never appears in argv or git config. */
function askpassScript(): string {
  const file = ASKPASS_FILE();
  const content = '#!/bin/sh\ncase "$1" in\n  Username*) echo "x-access-token" ;;\n  *) echo "$ORCH_GIT_TOKEN" ;;\nesac\n';
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, content, { mode: 0o700 });
  }
  return file;
}

function gitWithToken(cwd: string, args: string[]): Promise<string> {
  const token = getToken()?.token;
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(token ? { GIT_ASKPASS: askpassScript(), ORCH_GIT_TOKEN: token } : {}) },
      },
      (err, stdout, stderr) => {
        const clean = (s: string) => (token ? s.split(token).join('***') : s);
        if (err) reject(new GitError(`git ${args[0]} failed: ${clean(stderr.trim() || err.message)}`, clean(stderr)));
        else resolve(stdout + stderr);
      },
    );
  });
}

export async function remoteUrl(cwd: string, remote: string): Promise<string> {
  const url = (await git(cwd, ['remote', 'get-url', remote], { allowFail: true })).trim();
  if (!url) throw new GithubError(400, `The repository has no remote named "${remote}". Set the remote in Project settings → Pipeline.`);
  return url;
}

export async function remoteHasBranch(cwd: string, remote: string, branch: string): Promise<boolean> {
  const out = await gitWithToken(cwd, ['ls-remote', '--heads', remote, `refs/heads/${branch}`]);
  return out.trim().length > 0;
}

/** Push a local branch to the remote (never force). */
export async function pushBranch(cwd: string, remote: string, branch: string): Promise<void> {
  await gitWithToken(cwd, ['push', remote, `refs/heads/${branch}:refs/heads/${branch}`]);
}

export interface PullRequest {
  number: number;
  html_url: string;
  state: string;
  draft?: boolean;
}

export async function findOpenPr(r: RemoteRepo, branch: string): Promise<PullRequest | null> {
  const list = await ghFetch<PullRequest[]>('GET', `/repos/${r.owner}/${r.repo}/pulls?state=open&head=${encodeURIComponent(`${r.owner}:${branch}`)}`, undefined, undefined, r.host);
  return list[0] ?? null;
}

export async function createPullRequest(
  r: RemoteRepo,
  pr: { head: string; base: string; title: string; body: string; draft: boolean },
): Promise<PullRequest> {
  return ghFetch<PullRequest>('POST', `/repos/${r.owner}/${r.repo}/pulls`, pr, undefined, r.host);
}
