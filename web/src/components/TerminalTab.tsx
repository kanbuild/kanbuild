import { useCallback, useEffect, useRef, useState } from 'react';
import { CornerDownLeft, FolderOpen, Loader2, RotateCcw, Square, SquareTerminal, Trash2 } from 'lucide-react';
import type { Feature, TerminalSession } from '@shared/types.ts';
import { api } from '@/api';
import { onTerminal, useStore } from '@/store';
import { cn, formatDuration } from '@/lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Chip } from './ui/chip';
import { toastError } from './toast';

const HISTORY_KEY = 'orch:termHistory';
const HISTORY_MAX = 50;
const QUICK_FALLBACK = ['git status', 'git log --oneline -10'];

function loadHistory(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function saveHistory(h: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-HISTORY_MAX)));
  } catch {
    /* storage unavailable */
  }
}

/** Merge a streamed chunk into a session, using offsets so backfill + live output never duplicate. */
function applyChunk(s: TerminalSession, offset: number, chunk: string): TerminalSession {
  const end = s.outputStart + s.output.length;
  if (offset + chunk.length <= end) return s;
  const fresh = offset >= end ? chunk : chunk.slice(end - offset);
  return { ...s, output: s.output + fresh };
}

/** Show `dir` relative to the worktree: `wt-name`, `wt-name/server`, or the absolute path when outside it. */
export function displayDir(dir: string | null, root: string | null): string {
  if (!dir) return '';
  if (!root) return dir;
  const base = root.split('/').filter(Boolean).pop() ?? root;
  if (dir === root) return base;
  if (dir.startsWith(root + '/')) return `${base}/${dir.slice(root.length + 1)}`;
  return dir;
}

/** Terminal tab: run shell commands in the feature's worktree and stream their output. */
export function TerminalTab({ feature, agentActive }: { feature: Feature; agentActive: boolean }) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState<string[]>(QUICK_FALLBACK);
  // Where the next command runs (the server keeps it per feature, so `cd` persists).
  const [cwd, setCwd] = useState<string | null>(feature.worktreePath);
  const [root, setRoot] = useState<string | null>(feature.worktreePath);
  const historyRef = useRef<string[]>(loadHistory());
  const historyIdx = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);
  // Missed WS messages are not replayed, so re-fetch whenever the socket (re)connects.
  const connected = useStore((st) => st.connected);
  const hasWorktree = !!feature.worktreePath;
  const disabledReason = !hasWorktree
    ? 'This feature has no worktree yet. Build it first.'
    : agentActive
      ? 'The agent is working in this worktree. Commands are available when it finishes.'
      : null;

  useEffect(() => {
    let alive = true;
    // Subscribe before the backfill so nothing streamed in between is lost.
    const off = onTerminal((m) => {
      if (m.type === 'terminal.updated') {
        if (m.session.featureId !== feature.id) return;
        // A command that ended somewhere else moved the feature's cwd (mirrors terminal.ts).
        const { endCwd, cwd: started } = m.session;
        if (endCwd && endCwd !== started) setCwd(endCwd);
        setSessions((prev) => {
          const i = prev.findIndex((s) => s.id === m.session.id);
          if (i < 0) return [...prev, m.session];
          const next = [...prev];
          next[i] = m.session;
          return next;
        });
      } else if (m.featureId === feature.id) {
        setSessions((prev) => prev.map((s) => (s.id === m.sessionId ? applyChunk(s, m.offset, m.chunk) : s)));
      }
    });
    api
      .terminalState(feature.id)
      .then(({ sessions: list, cwd: serverCwd, root: serverRoot }) => {
        if (!alive) return;
        setCwd(serverCwd);
        setRoot(serverRoot);
        setSessions((prev) => {
          // Keep any longer live copy of a session we already received.
          // Sessions started after the fetch was sent (only known from live messages) are kept too.
          const byId = new Map(prev.map((s) => [s.id, s]));
          const listed = new Set(list.map((s) => s.id));
          const merged = list.map((s) => {
            const live = byId.get(s.id);
            if (!live) return s;
            if (live.status === 'exited' && s.status === 'running') return live;
            return live.outputStart + live.output.length > s.outputStart + s.output.length ? live : s;
          });
          return [...merged, ...prev.filter((s) => !listed.has(s.id))].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
      off();
    };
  }, [feature.id, connected]);

  useEffect(() => {
    api
      .validationPreview(feature.projectId)
      .then((r) => {
        const cmds = r.commands.filter((c) => !/\b(npm ci|install)\b/.test(c));
        setQuick([...new Set([...cmds, ...QUICK_FALLBACK])].slice(0, 6));
      })
      .catch(() => {});
  }, [feature.projectId]);

  // Auto-scroll while the user is at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [sessions]);

  const run = useCallback(
    async (cmd: string) => {
      const c = cmd.trim();
      if (!c || busy) return;
      setBusy(true);
      try {
        const s = await api.runTerminal(feature.id, c);
        // Live messages may already have delivered (and finished) this session; never overwrite them.
        setSessions((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]));
        const h = historyRef.current.filter((x) => x !== c);
        h.push(c);
        historyRef.current = h.slice(-HISTORY_MAX);
        saveHistory(historyRef.current);
        historyIdx.current = null;
        setCommand('');
        stickRef.current = true;
      } catch (err) {
        toastError(err);
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, feature.id],
  );

  const stop = async (id: string) => {
    try {
      await api.stopTerminal(id);
    } catch (err) {
      toastError(err);
    }
  };

  const resetCwd = async () => {
    try {
      setCwd((await api.resetTerminalCwd(feature.id)).cwd);
      inputRef.current?.focus();
    } catch (err) {
      toastError(err);
    }
  };

  const clear = async () => {
    try {
      setSessions(await api.clearTerminal(feature.id));
    } catch (err) {
      toastError(err);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const h = historyRef.current;
    if (e.key === 'Enter') {
      e.preventDefault();
      void run(command);
    } else if (e.key === 'ArrowUp' && h.length) {
      e.preventDefault();
      const i = historyIdx.current === null ? h.length - 1 : Math.max(0, historyIdx.current - 1);
      historyIdx.current = i;
      setCommand(h[i]);
    } else if (e.key === 'ArrowDown' && historyIdx.current !== null) {
      e.preventDefault();
      const i = historyIdx.current + 1;
      if (i >= h.length) {
        historyIdx.current = null;
        setCommand('');
      } else {
        historyIdx.current = i;
        setCommand(h[i]);
      }
    }
  };

  const running = sessions.filter((s) => s.status === 'running').length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
        <SquareTerminal className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate font-mono" title={feature.worktreePath ?? ''}>{feature.worktreePath ?? 'no worktree'}</span>
        {running ? <span className="shrink-0">{running} running</span> : null}
        <Button size="sm" variant="ghost" onClick={clear} disabled={!sessions.some((s) => s.status !== 'running')}>
          <Trash2 className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
      >
        {sessions.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <p>Run commands in this feature's worktree: tests, dev servers, git.</p>
            <p className="mt-1 text-[11px]">
              <span className="font-mono">cd</span> carries over to the next command; environment variables (<span className="font-mono">export</span>) don't.
              Output is plain text (no interactive programs). Commands stop when the backend stops.
            </p>
          </div>
        ) : (
          sessions.map((s) => <SessionBlock key={s.id} session={s} root={root} onStop={() => stop(s.id)} />)
        )}
      </div>

      <div className="space-y-2 border-t border-border/60 p-3">
        {disabledReason ? <p className="text-[11px] text-muted-foreground">{disabledReason}</p> : null}
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <Chip key={q} onClick={() => run(q)} disabled={!!disabledReason || busy} className="font-mono text-[11px]">
              {q}
            </Chip>
          ))}
        </div>
        <div className="metal-inset flex items-center gap-2 rounded-lg px-3 focus-within:ring-2 focus-within:ring-primary/25">
          {cwd ? (
            <span className="max-w-[45%] shrink-0 truncate font-mono text-xs text-muted-foreground" title={cwd} data-testid="terminal-cwd">
              {displayDir(cwd, root)}
            </span>
          ) : null}
          {cwd && root && cwd !== root ? (
            <button
              type="button"
              onClick={resetCwd}
              title="Back to the worktree root"
              aria-label="Back to worktree root"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          ) : null}
          <span className="font-mono text-sm text-primary">$</span>
          <input
            ref={inputRef}
            value={command}
            onChange={(e) => {
              setCommand(e.target.value);
              historyIdx.current = null;
            }}
            onKeyDown={onKeyDown}
            disabled={!!disabledReason}
            placeholder="npm test"
            aria-label="Terminal command"
            spellCheck={false}
            autoComplete="off"
            className="h-9 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60 disabled:cursor-not-allowed"
          />
          <Button size="sm" variant="ghost" onClick={() => run(command)} disabled={!!disabledReason || busy || !command.trim()} aria-label="Run command">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CornerDownLeft className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SessionBlock({ session: s, root, onStop }: { session: TerminalSession; root: string | null; onStop: () => void }) {
  const running = s.status === 'running';
  const moved = !!s.endCwd && s.endCwd !== s.cwd;
  const ok = s.exitCode === 0;
  const duration = s.endedAt ? new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime() : null;
  return (
    <div className="metal-surface overflow-hidden rounded-xl">
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
        {root && s.cwd !== root ? (
          <span className="max-w-[35%] shrink-0 truncate font-mono text-[11px] text-muted-foreground" title={s.cwd}>
            {displayDir(s.cwd, root)}
          </span>
        ) : null}
        <span className="font-mono text-xs text-primary">$</span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={s.command}>{s.command}</span>
        {running ? (
          <>
            <Badge variant="blue" dot>running</Badge>
            <Button size="sm" variant="ghost" onClick={onStop} aria-label={`Stop ${s.command}`}>
              <Square className="h-3 w-3" /> Stop
            </Button>
          </>
        ) : (
          <>
            {duration !== null ? <span className="text-[10px] tabular-nums text-muted-foreground">{formatDuration(duration)}</span> : null}
            <Badge variant={ok ? 'green' : 'red'}>{s.signal && s.exitCode === null ? s.signal : `exit ${s.exitCode ?? '?'}`}</Badge>
          </>
        )}
      </div>
      <pre className={cn('max-h-96 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11px] leading-relaxed', !s.output && 'text-muted-foreground')}>
        {s.outputStart > 0 ? '… (earlier output trimmed)\n' : ''}
        {s.output || (running ? 'Waiting for output…' : moved ? null : '(no output)')}
        {!running && moved ? (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <FolderOpen className="inline h-3 w-3" /> now in <span className="text-foreground">{displayDir(s.endCwd, root)}</span>
          </span>
        ) : null}
      </pre>
    </div>
  );
}
