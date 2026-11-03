import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Columns2, FileCode2, RefreshCw, Rows3 } from 'lucide-react';
import type { CommitInfo, DiffFile, DiffHunk, DiffLine, DiffResult } from '@shared/types.ts';
import { api } from '@/api';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { toastError } from './toast';

type Mode = 'unified' | 'split';
const MODE_KEY = 'orch:diffMode';

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
}

const STATUS_STYLE: Record<DiffFile['status'], { letter: string; cls: string }> = {
  added: { letter: 'A', cls: 'text-emerald-600' },
  modified: { letter: 'M', cls: 'text-sky-600' },
  deleted: { letter: 'D', cls: 'text-red-600' },
  renamed: { letter: 'R', cls: 'text-violet-600' },
};

const lineBg = (t: DiffLine['type'] | 'empty') =>
  t === 'add' ? 'bg-emerald-500/10' : t === 'del' ? 'bg-red-500/10' : t === 'meta' ? 'text-muted-foreground italic' : t === 'empty' ? 'bg-muted/40' : '';
const numCls = 'w-10 select-none border-r px-1.5 text-right align-top text-[10px] tabular-nums text-muted-foreground/70';
const sign = (t: DiffLine['type']) => (t === 'add' ? '+' : t === 'del' ? '-' : ' ');

/** Pair deletions with additions so a split view shows old and new side by side. */
function splitRows(h: DiffHunk): { left: DiffLine | null; right: DiffLine | null }[] {
  const rows: { left: DiffLine | null; right: DiffLine | null }[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const l of h.lines) {
    if (l.type === 'del') dels.push(l);
    else if (l.type === 'add') adds.push(l);
    else {
      flush();
      rows.push({ left: l, right: l });
    }
  }
  flush();
  return rows;
}

function FileDiff({
  file,
  index,
  mode,
  open,
  onToggle,
  onLoad,
  focusLine,
}: {
  file: DiffFile;
  index: number;
  mode: Mode;
  open: boolean;
  onToggle: () => void;
  onLoad: () => void;
  focusLine: number | null;
}) {
  const st = STATUS_STYLE[file.status];
  const lineId = (n: number | null) => (n !== null ? `diff-${index}-L${n}` : undefined);
  return (
    <div id={`diff-${index}`} className="metal-surface overflow-hidden rounded-xl">
      <button onClick={onToggle} className="sticky top-0 z-10 flex w-full items-center gap-2 border-b bg-gradient-to-b from-[hsl(var(--metal-raised-hi))] to-[hsl(var(--metal-raised-lo))] px-3 py-1.5 text-left font-mono text-xs">
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className={cn('w-3 shrink-0 font-semibold', st.cls)}>{st.letter}</span>
        <span className="min-w-0 flex-1 truncate">
          {file.oldPath && file.status === 'renamed' ? (
            <>
              <span className="text-muted-foreground">{file.oldPath} → </span>
              {file.path}
            </>
          ) : (
            file.path
          )}
        </span>
        <span className="shrink-0 text-emerald-600">+{file.additions}</span>
        <span className="shrink-0 text-red-600">-{file.deletions}</span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          {file.binary && <p className="p-3 text-xs text-muted-foreground">Binary file not shown.</p>}
          {file.truncated && (
            <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              Large diff not loaded.
              <Button size="sm" variant="outline" onClick={onLoad}>
                Load diff
              </Button>
            </div>
          )}
          {!file.binary && !file.truncated && file.hunks.length === 0 && <p className="p-3 text-xs text-muted-foreground">No content changes{file.status === 'renamed' ? ' (renamed only)' : ''}.</p>}
          <table className="w-full border-collapse font-mono text-[11.5px] leading-[1.45]">
            <tbody>
              {file.hunks.map((h, hi) => (
                <HunkRows key={hi} hunk={h} mode={mode} lineId={lineId} focusLine={focusLine} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HunkRows({ hunk, mode, lineId, focusLine }: { hunk: DiffHunk; mode: Mode; lineId: (n: number | null) => string | undefined; focusLine: number | null }) {
  const header = (
    <tr>
      <td colSpan={mode === 'split' ? 4 : 3} className="border-y bg-sky-500/5 px-3 py-0.5 text-[11px] text-sky-700 dark:text-sky-400">
        {hunk.header}
      </td>
    </tr>
  );
  if (mode === 'unified') {
    return (
      <>
        {header}
        {hunk.lines.map((l, i) => (
          <tr key={i} id={l.type !== 'del' ? lineId(l.newNo) : undefined} className={cn(lineBg(l.type), focusLine !== null && l.newNo === focusLine && 'outline outline-2 -outline-offset-2 outline-amber-400')}>
            <td className={numCls}>{l.oldNo ?? ''}</td>
            <td className={numCls}>{l.newNo ?? ''}</td>
            <td className="whitespace-pre px-2">
              <span className="select-none text-muted-foreground">{l.type === 'meta' ? '' : sign(l.type)}</span>
              {l.text}
            </td>
          </tr>
        ))}
      </>
    );
  }
  return (
    <>
      {header}
      {splitRows(hunk).map((r, i) => (
        <tr key={i} id={lineId(r.right?.newNo ?? null)} className={cn(focusLine !== null && r.right?.newNo === focusLine && 'outline outline-2 -outline-offset-2 outline-amber-400')}>
          <td className={cn(numCls, lineBg(r.left ? r.left.type : 'empty'))}>{r.left?.oldNo ?? ''}</td>
          <td className={cn('w-1/2 whitespace-pre border-r px-2', lineBg(r.left ? r.left.type : 'empty'))}>{r.left?.text}</td>
          <td className={cn(numCls, lineBg(r.right ? r.right.type : 'empty'))}>{r.right?.newNo ?? ''}</td>
          <td className={cn('w-1/2 whitespace-pre px-2', lineBg(r.right ? r.right.type : 'empty'))}>{r.right?.text}</td>
        </tr>
      ))}
    </>
  );
}

/** Built-in git diff viewer for a feature's worktree. */
export function DiffViewer({
  featureId,
  commits,
  refreshKey,
  focus,
}: {
  featureId: string;
  commits: CommitInfo[];
  refreshKey?: unknown;
  focus?: { file: string; line: number | null; nonce: number } | null;
}) {
  const [scope, setScope] = useState('all');
  const [mode, setModeState] = useState<Mode>(readMode);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);

  const setMode = (m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    api
      .diff(featureId, scope)
      .then((d) => {
        setDiff(d);
        setCollapsed(new Set());
      })
      .catch((err) => {
        setDiff(null);
        toastError(err);
      })
      .finally(() => setLoading(false));
  }, [featureId, scope]);
  useEffect(load, [load, refreshKey]);

  const loadFile = async (path: string) => {
    try {
      const one = await api.diff(featureId, scope, path);
      const f = one.files[0];
      if (f) setDiff((d) => (d ? { ...d, files: d.files.map((x) => (x.path === path ? f : x)) } : d));
    } catch (err) {
      toastError(err);
    }
  };

  const scrollTo = (i: number, line?: number | null) => {
    const el = (line ? document.getElementById(`diff-${i}-L${line}`) : null) ?? document.getElementById(`diff-${i}`);
    el?.scrollIntoView({ block: line ? 'center' : 'start', behavior: 'smooth' });
  };

  // Jump to a review finding (file:line) once the diff is loaded.
  useEffect(() => {
    if (!focus || !diff) return;
    const i = diff.files.findIndex((f) => f.path === focus.file || f.path.endsWith(`/${focus.file}`) || focus.file.endsWith(f.path));
    if (i < 0) return;
    setCollapsed((c) => {
      const n = new Set(c);
      n.delete(diff.files[i].path);
      return n;
    });
    setTimeout(() => scrollTo(i, focus.line), 50);
  }, [focus, diff]);

  const totals = useMemo(() => diff?.files.reduce((a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }), { add: 0, del: 0 }), [diff]);
  const focusIndex = focus && diff ? diff.files.findIndex((f) => f.path === focus.file || f.path.endsWith(`/${focus.file}`)) : -1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
        <select className="metal-raised h-7 max-w-[16rem] cursor-pointer rounded-lg px-2 text-xs [&>option]:bg-background" value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">All changes (incl. uncommitted)</option>
          <option value="committed">Committed only</option>
          <option value="uncommitted">Uncommitted only</option>
          {commits.map((c) => (
            <option key={c.hash} value={`commit:${c.hash}`}>
              {c.hash.slice(0, 7)} {c.subject.slice(0, 50)}
            </option>
          ))}
        </select>
        <div className="metal-inset flex overflow-hidden rounded-lg">
          <button className={cn('flex items-center gap-1 px-2 py-1', mode === 'unified' && 'metal-raised font-medium')} onClick={() => setMode('unified')} title="Unified view">
            <Rows3 className="h-3.5 w-3.5" /> Unified
          </button>
          <button className={cn('flex items-center gap-1 border-l px-2 py-1', mode === 'split' && 'metal-raised font-medium')} onClick={() => setMode('split')} title="Side-by-side view">
            <Columns2 className="h-3.5 w-3.5" /> Split
          </button>
        </div>
        <button className="text-muted-foreground hover:text-foreground" onClick={() => setCollapsed(new Set(collapsed.size ? [] : diff?.files.map((f) => f.path)))}>
          {collapsed.size ? 'Expand all' : 'Collapse all'}
        </button>
        <span className="ml-auto text-muted-foreground">
          {diff ? (
            <>
              {diff.files.length} file(s) <span className="text-emerald-600">+{totals?.add}</span> <span className="text-red-600">-{totals?.del}</span>
            </>
          ) : null}
        </span>
        <Button size="sm" variant="ghost" className="h-7" onClick={load} disabled={loading}>
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        {diff && diff.files.length > 1 && (
          <nav className="hidden w-56 shrink-0 overflow-y-auto border-r py-1 md:block">
            {diff.files.map((f, i) => (
              <button
                key={f.path}
                onClick={() => scrollTo(i)}
                className={cn('flex w-full items-center gap-1.5 px-3 py-1 text-left font-mono text-[11px] hover:bg-muted/60', i === focusIndex && 'bg-amber-500/10')}
                title={f.path}
              >
                <span className={cn('w-3 shrink-0 font-semibold', STATUS_STYLE[f.status].cls)}>{STATUS_STYLE[f.status].letter}</span>
                <span className="min-w-0 flex-1 truncate" style={{ direction: 'rtl', textAlign: 'left' }}>
                  {f.path}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {f.additions + f.deletions}
                </span>
              </button>
            ))}
          </nav>
        )}
        <div ref={scroller} className="min-w-0 flex-1 space-y-3 overflow-y-auto p-4">
          {diff?.truncated && (
            <Badge variant="amber">Large diff: some files are collapsed; load them individually.</Badge>
          )}
          {diff?.files.map((f, i) => (
            <FileDiff
              key={f.path}
              file={f}
              index={i}
              mode={mode}
              open={!collapsed.has(f.path)}
              onToggle={() =>
                setCollapsed((c) => {
                  const n = new Set(c);
                  if (n.has(f.path)) n.delete(f.path);
                  else n.add(f.path);
                  return n;
                })
              }
              onLoad={() => loadFile(f.path)}
              focusLine={i === focusIndex ? focus?.line ?? null : null}
            />
          ))}
          {diff && diff.files.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
              <FileCode2 className="h-6 w-6" /> No changes in this scope.
            </div>
          )}
          {!diff && loading && <p className="py-10 text-center text-sm text-muted-foreground">Loading diff…</p>}
        </div>
      </div>
    </div>
  );
}
