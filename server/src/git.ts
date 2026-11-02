import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Changes, CommitInfo, FileChange, PathValidation } from '../../shared/types.ts';

export class GitError extends Error {
  constructor(message: string, public stderr = '') {
    super(message);
  }
}

export function git(cwd: string, args: string[], opts: { allowFail?: boolean } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err && !opts.allowFail) {
        reject(new GitError(`git ${args.join(' ')} failed: ${stderr.trim() || err.message}`, stderr));
      } else {
        resolve(stdout);
      }
    });
  });
}

export function expandHome(p: string): string {
  if (p === '~') return process.env.HOME || p;
  if (p.startsWith('~/')) return path.join(process.env.HOME || '', p.slice(2));
  return p;
}

export function slugify(s: string, max = 40): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '') || 'feature'
  );
}

export async function validateRepoPath(rawPath: string): Promise<PathValidation> {
  const p = path.resolve(expandHome(rawPath.trim()));
  const base = path.basename(p);
  const result: PathValidation = {
    exists: false,
    isGitRepo: false,
    isWorktreeRoot: false,
    branches: [],
    currentBranch: null,
    suggestedName: base,
    suggestedWorktreeRoot: path.join(path.dirname(p), `${base}-worktrees`),
  };
  if (!rawPath.trim()) return { ...result, error: 'Path is required' };
  try {
    result.exists = fs.statSync(p).isDirectory();
  } catch {
    return { ...result, error: 'Directory does not exist' };
  }
  if (!result.exists) return { ...result, error: 'Path is not a directory' };
  const top = (await git(p, ['rev-parse', '--show-toplevel'], { allowFail: true })).trim();
  if (!top) return { ...result, error: 'Not a git repository' };
  result.isGitRepo = true;
  result.isWorktreeRoot = path.resolve(top) === fs.realpathSync(p) || path.resolve(top) === p;
  if (!result.isWorktreeRoot) result.error = `Path is inside a repository; use the repository root (${top})`;
  const branches = await git(p, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], { allowFail: true });
  result.branches = branches.split('\n').map((b) => b.trim()).filter(Boolean);
  const cur = (await git(p, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFail: true })).trim();
  result.currentBranch = cur || null;
  if (result.branches.length === 0) result.error = 'Repository has no commits yet; create an initial commit first';
  return result;
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  const out = await git(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true });
  return out.trim().length > 0;
}

/** Pick a unique branch name and worktree directory for a feature. */
export async function allocateBranchAndPath(
  repo: string,
  worktreeRoot: string,
  title: string,
  featureId: string,
): Promise<{ branch: string; worktreePath: string }> {
  const slug = slugify(title);
  const short = featureId.replace(/^[a-z]+_/, '').slice(0, 6);
  for (let i = 0; i < 50; i++) {
    const suffix = i === 0 ? short : `${short}-${i}`;
    const branch = `feature/${slug}-${suffix}`;
    const worktreePath = path.join(worktreeRoot, `feature-${slug}-${suffix}`);
    if (!(await branchExists(repo, branch)) && !fs.existsSync(worktreePath)) return { branch, worktreePath };
  }
  throw new Error('Could not allocate a unique branch name');
}

export async function createWorktree(repo: string, worktreePath: string, branch: string, baseBranch: string) {
  if (fs.existsSync(worktreePath)) throw new Error(`Worktree path already exists: ${worktreePath}`);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  await git(repo, ['worktree', 'add', '-b', branch, worktreePath, baseBranch]);
}

export async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  const out = await git(worktreePath, ['status', '--porcelain']);
  return out.trim().length > 0;
}

export async function removeWorktree(repo: string, worktreePath: string, force: boolean) {
  if (!fs.existsSync(worktreePath)) {
    await git(repo, ['worktree', 'prune'], { allowFail: true });
    return;
  }
  if (!force && (await isWorktreeDirty(worktreePath))) {
    throw new GitError('Worktree has uncommitted changes');
  }
  await git(repo, ['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath]);
}

export async function headCommit(cwd: string): Promise<string | null> {
  const out = (await git(cwd, ['rev-parse', 'HEAD'], { allowFail: true })).trim();
  return out || null;
}

const STATUS_MAP: Record<string, FileChange['change']> = {
  A: 'created',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'created',
  T: 'modified',
};

export async function collectChanges(
  worktreePath: string | null,
  branch: string | null,
  baseBranch: string,
): Promise<Changes> {
  const changes: Changes = {
    branch,
    baseBranch,
    worktreePath,
    headCommit: null,
    commits: [],
    files: [],
    hasUncommittedChanges: false,
    worktreeExists: !!worktreePath && fs.existsSync(worktreePath),
  };
  if (!worktreePath || !changes.worktreeExists) return changes;

  changes.headCommit = await headCommit(worktreePath);
  const mergeBase = (await git(worktreePath, ['merge-base', baseBranch, 'HEAD'], { allowFail: true })).trim();

  if (mergeBase) {
    const log = await git(worktreePath, ['log', '--format=%H%x1f%s%x1f%an%x1f%aI', `${mergeBase}..HEAD`], { allowFail: true });
    changes.commits = log
      .split('\n')
      .filter(Boolean)
      .map((l): CommitInfo => {
        const [hash, subject, author, date] = l.split('\x1f');
        return { hash, subject, author, date };
      });
    const diff = await git(worktreePath, ['diff', '--name-status', '-M', `${mergeBase}..HEAD`], { allowFail: true });
    for (const line of diff.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const code = parts[0][0];
      const file = parts[parts.length - 1];
      changes.files.push({ path: file, change: STATUS_MAP[code] || 'modified', committed: true });
    }
  }

  const status = await git(worktreePath, ['status', '--porcelain', '-uall'], { allowFail: true });
  const lines = status.split('\n').filter(Boolean);
  changes.hasUncommittedChanges = lines.length > 0;
  for (const line of lines) {
    const xy = line.slice(0, 2);
    let file = line.slice(3);
    if (file.includes(' -> ')) file = file.split(' -> ')[1];
    let change: FileChange['change'] = 'modified';
    if (xy === '??' || xy.includes('A')) change = 'created';
    else if (xy.includes('D')) change = 'deleted';
    else if (xy.includes('R')) change = 'renamed';
    const existing = changes.files.find((f) => f.path === file);
    if (existing) existing.committed = false;
    else changes.files.push({ path: file, change, committed: false });
  }
  changes.files.sort((a, b) => a.path.localeCompare(b.path));
  return changes;
}
