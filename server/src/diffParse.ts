import type { DiffFile, DiffHunk } from '../../shared/types.ts';

/** Strip git's a/ b/ prefixes and C-style quoting ("a/sp ace.txt"). */
function cleanPath(p: string): string {
  let s = p.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).replace(/\\(["\\])/g, '$1').replace(/\\t/g, '\t').replace(/\\n/g, '\n');
  }
  if (s === '/dev/null') return s;
  return s.replace(/^[ab]\//, '');
}

/** Paths from a `diff --git a/x b/y` header (ambiguous with spaces; ---/+++ lines refine it later). */
function headerPaths(line: string): [string, string] {
  const rest = line.slice('diff --git '.length);
  const quoted = rest.match(/^("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/);
  if (quoted) return [cleanPath(quoted[1]), cleanPath(quoted[2])];
  // Unquoted paths with spaces: split in the middle, where " b/" starts.
  const i = rest.indexOf(' b/');
  if (i > 0) return [cleanPath(rest.slice(0, i)), cleanPath(rest.slice(i + 1))];
  return [cleanPath(rest), cleanPath(rest)];
}

/** Parse `git diff` / `git show` output (unified format, with rename detection). */
export function parseUnifiedDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const lines = raw.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const [a, b] = headerPaths(line);
      file = { path: b, oldPath: a !== b ? a : null, status: 'modified', additions: 0, deletions: 0, binary: false, truncated: false, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;

    if (!hunk || !/^[ +\-\\]/.test(line)) {
      // File header section.
      if (line.startsWith('new file mode')) {
        file.status = 'added';
        continue;
      }
      if (line.startsWith('deleted file mode')) {
        file.status = 'deleted';
        continue;
      }
      if (line.startsWith('rename from ')) {
        file.oldPath = cleanPath(line.slice('rename from '.length));
        file.status = 'renamed';
        continue;
      }
      if (line.startsWith('rename to ')) {
        file.path = cleanPath(line.slice('rename to '.length));
        file.status = 'renamed';
        continue;
      }
      if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
        file.binary = true;
        continue;
      }
      if (line.startsWith('--- ') && !hunk) {
        const p = cleanPath(line.slice(4));
        if (p === '/dev/null') file.status = 'added';
        else file.oldPath = file.oldPath ?? (p !== file.path ? p : null);
        continue;
      }
      if (line.startsWith('+++ ') && !hunk) {
        const p = cleanPath(line.slice(4));
        if (p === '/dev/null') {
          file.status = 'deleted';
          if (file.oldPath) file.path = file.oldPath;
        } else file.path = p;
        if (file.status === 'added' || file.oldPath === '/dev/null') file.oldPath = null;
        continue;
      }
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
        hunk = { header: line, lines: [] };
        file.hunks.push(hunk);
        continue;
      }
      continue; // index, similarity, mode lines
    }

    // Hunk body.
    const c = line[0];
    const text = line.slice(1);
    if (c === '+') {
      hunk.lines.push({ type: 'add', oldNo: null, newNo: newNo++, text });
      file.additions++;
    } else if (c === '-') {
      hunk.lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text });
      file.deletions++;
    } else if (c === ' ') {
      hunk.lines.push({ type: 'context', oldNo: oldNo++, newNo: newNo++, text });
    } else if (c === '\\') {
      hunk.lines.push({ type: 'meta', oldNo: null, newNo: null, text: line.slice(2) });
    }
  }
  for (const f of files) if (f.oldPath === f.path) f.oldPath = null;
  return files;
}
