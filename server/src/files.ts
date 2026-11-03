import { git } from './git.ts';

const MAX_FILES = 50_000;
const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; files: string[] }>();

/** Tracked and untracked (not ignored) files of a repository, relative to its root. Cached briefly. */
export async function listRepoFiles(repoPath: string): Promise<string[]> {
  const hit = cache.get(repoPath);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.files;
  const out = await git(repoPath, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const files = [...new Set(out.split('\0').filter(Boolean))].slice(0, MAX_FILES);
  cache.set(repoPath, { at: Date.now(), files });
  return files;
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0;
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++;
  return i === needle.length;
}

/**
 * Rank files for a query (case-insensitive): exact basename > basename prefix > basename substring
 * > path substring > fuzzy subsequence. Shorter paths win ties. Empty query = shortest paths first.
 */
export function rankFiles(files: string[], query: string, limit = 30): string[] {
  const q = query.trim().toLowerCase();
  const scored: { f: string; score: number }[] = [];
  for (const f of files) {
    const lower = f.toLowerCase();
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    let score: number;
    if (!q) score = 0;
    else if (base === q) score = 0;
    else if (base.startsWith(q)) score = 1;
    else if (base.includes(q)) score = 2;
    else if (lower.startsWith(q)) score = 3;
    else if (lower.includes(q)) score = 4;
    else if (isSubsequence(q, lower)) score = 5;
    else continue;
    scored.push({ f, score });
  }
  scored.sort((a, b) => a.score - b.score || a.f.length - b.f.length || a.f.localeCompare(b.f));
  return scored.slice(0, limit).map((s) => s.f);
}
