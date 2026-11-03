import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Markdown } from './Markdown';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Activity,
  Bug,
  ArrowUp,
  CheckCircle2,
  AlertTriangle,
  BookOpen,
  Copy,
  FolderOpen,
  MessageSquarePlus,
  Send,
  Ban,
  Bot,
  ExternalLink,
  FileText,
  FlaskConical,
  FolderGit2,
  GitPullRequest,
  Play,
  LayoutDashboard,
  ListChecks,
  Workflow,
  Pencil,
  RefreshCw,
  RotateCcw,
  Terminal,
  SquareTerminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import type { Changes, Feature, Report, ReviewResult, Run, RunEvent } from '@shared/types.ts';
import { api, ApiError, type SessionInfo } from '@/api';
import { onRunEvent, onRunUpdate, upsertFeature, useStore } from '@/store';
import { useNow } from '@/hooks';
import { cn, formatCost, formatDuration, formatTime, formatTokens } from '@/lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, SheetContent } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { AgentStatusBadge, PipelineChip, isPaused, isReadyToStart, PriorityBadge, RunProgress, isActive, newTokens, roleLabel, runDurationMs, runLabel } from './status';
import { DiffViewer } from './DiffViewer';
import { Chip } from './ui/chip';
import { Composer, composerTextareaClass, type ComposerSuggestion } from './ui/composer';
import { GatePanel } from './GatePanel';
import { PipelineTab } from './PipelineTab';
import { TerminalTab } from './TerminalTab';
import { Textarea } from './ui/input';
import { MentionTextarea } from './MentionTextarea';
import { confirm } from './confirm';
import { toast, toastError } from './toast';

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="metal-surface rounded-xl p-3" title={hint}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

const EVENT_STYLE: Record<RunEvent['kind'], { icon: React.ElementType; cls: string }> = {
  lifecycle: { icon: Bot, cls: 'text-violet-600 dark:text-violet-400' },
  system: { icon: Terminal, cls: 'text-muted-foreground' },
  text: { icon: FileText, cls: 'text-foreground' },
  tool_use: { icon: Wrench, cls: 'text-sky-700 dark:text-sky-400' },
  tool_result: { icon: Terminal, cls: 'text-muted-foreground' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600 dark:text-amber-400' },
  error: { icon: AlertTriangle, cls: 'text-red-600 dark:text-red-400' },
  stderr: { icon: Terminal, cls: 'text-red-500/80' },
};

function EventRow({ e }: { e: RunEvent }) {
  const [open, setOpen] = useState(false);
  const s = EVENT_STYLE[e.kind];
  const Icon = s.icon;
  return (
    <div
      className={cn(
        'group mx-3 my-1 flex gap-2 rounded-lg border border-transparent px-2.5 py-1.5 font-mono text-xs transition-colors hover:border-border hover:bg-foreground/[0.03]',
        (e.kind === 'tool_use' || e.kind === 'tool_result') && 'metal-raised hover:filter-none',
        (e.kind === 'error' || e.kind === 'stderr') && 'border-red-500/20 bg-red-500/5',
        e.kind === 'warning' && 'border-amber-500/20 bg-amber-500/5',
      )}
    >
      <span className="shrink-0 tabular-nums text-muted-foreground/80">{formatTime(e.ts)}</span>
      {e.kind === 'tool_result' ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" /> : <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', s.cls)} />}
      <div className="min-w-0 flex-1">
        <div className={cn('whitespace-pre-wrap break-words', s.cls, e.detail && 'cursor-pointer')} onClick={() => e.detail && setOpen(!open)}>
          {e.summary}
          {e.detail && <span className="ml-1 text-muted-foreground">{open ? '▾' : '▸'}</span>}
        </div>
        {open && e.detail && <pre className="metal-inset mt-1.5 max-h-80 overflow-auto rounded-lg p-2 text-[11px] text-muted-foreground">{e.detail}</pre>}
      </div>
    </div>
  );
}

function ActivityLog({ runId, active }: { runId: string; active: boolean }) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [filter, setFilter] = useState<'all' | 'tools' | 'problems'>('all');
  const [follow, setFollow] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents([]);
    api.events(runId).then((ev) => !cancelled && setEvents(ev)).catch(toastError);
    const off = onRunEvent((e) => {
      if (e.runId === runId) setEvents((prev) => (prev.some((p) => p.id === e.id) ? prev : [...prev, e]));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [runId]);

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [events, follow, filter]);

  const shown = events.filter((e) =>
    filter === 'all' ? true : filter === 'tools' ? e.kind === 'tool_use' || e.kind === 'tool_result' : ['error', 'warning', 'stderr'].includes(e.kind),
  );
  const problems = events.filter((e) => ['error', 'warning', 'stderr'].includes(e.kind)).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        {(['all', 'tools', 'problems'] as const).map((f) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)} className="h-6 px-2.5 text-[11px] capitalize">
            {f}
            {f === 'problems' && problems > 0 && ` (${problems})`}
          </Chip>
        ))}
        <span className="ml-auto text-muted-foreground">{events.length} events</span>
        {active && <span className="inline-flex items-center gap-1 text-sky-600 dark:text-cyan-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> live</span>}
      </div>
      <div
        ref={ref}
        className="flex-1 overflow-y-auto py-1"
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
      >
        {shown.map((e) => (
          <EventRow key={e.id} e={e} />
        ))}
        {shown.length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">No events yet.</p>}
      </div>
    </div>
  );
}

const isDocPath = (p: string) => /(^|\/)(agent-docs|docs)\//i.test(p) || /(^|\/)(CLAUDE|README)[^/]*\.md$/i.test(p);

function copy(text: string, msg: string) {
  if (!navigator.clipboard) {
    window.prompt('Copy this:', text);
    return;
  }
  navigator.clipboard.writeText(text).then(() => toast(msg), () => window.prompt('Copy this:', text));
}

/** Continue the agent's Claude Code session: dashboard follow-up (headless --resume) or interactively in a terminal. */
function ContinueSession({ feature, onQueued }: { feature: Feature; onQueued: () => void }) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const busy = isActive(feature.agentStatus);
  useEffect(() => {
    api.session(feature.id).then(setInfo).catch(() => setInfo(null));
  }, [feature.id, feature.sessionId, feature.worktreePath]);

  if (!feature.sessionId) return null;
  const send = async () => {
    setSending(true);
    try {
      upsertFeature(await api.followUp(feature.id, message));
      setMessage('');
      toast('Follow-up queued — the agent resumes its session');
      onQueued();
    } catch (err) {
      toastError(err);
    } finally {
      setSending(false);
    }
  };
  const unavailable = busy || !info?.worktreeExists;
  return (
    <section className="space-y-3">
      <div>
        <h3 className="chrome-text flex items-center gap-2 text-lg font-semibold tracking-tight">
          <MessageSquarePlus className="h-4 w-4 text-primary" /> Keep working on this feature
        </h3>
        <p className="text-xs text-muted-foreground">
          {busy ? 'Available once the current run finishes.' : 'Resumes the same Claude Code session, branch and worktree. The card moves back to Build and the agent starts right away.'}
        </p>
      </div>
      <Composer
        onSend={send}
        canSend={!unavailable && !!message.trim()}
        sending={sending}
        sendLabel="Send follow-up"
        suggestions={unavailable ? undefined : FOLLOW_UP_SUGGESTIONS}
        onSuggest={(t) => setMessage(t)}
        suggestionsLabel="Ideas"
      >
        <MentionTextarea
          projectId={feature.projectId}
          value={message}
          onChange={setMessage}
          rows={3}
          placeholder="Ask the agent for more work, e.g. “Also handle the empty state and add a test for it.” Type @ to reference a file."
          disabled={unavailable}
          aria-label="Follow-up message"
          className={composerTextareaClass.replace('mt-2 ', '')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && message.trim()) {
              e.preventDefault();
              send();
            }
          }}
        />
      </Composer>
      {info?.command && (
        <details className="metal-surface rounded-xl p-3 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">Continue in a terminal instead</summary>
          <div className="space-y-2 pt-3">
            <p className="text-muted-foreground">Resumes the exact same Claude Code session interactively:</p>
            <pre className="metal-inset overflow-x-auto rounded-lg p-2 font-mono text-xs">{info.command}</pre>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => copy(info.command!, 'Command copied')}>
                <Copy /> Copy command
              </Button>
              {info.canOpenTerminal && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => api.openTerminal(feature.id).catch(toastError)}>
                  <SquareTerminal /> Open in Terminal
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Resuming reloads the previous conversation, so the first turn re-reads its context. Don&apos;t send a dashboard follow-up while the session is open in a terminal.
            </p>
          </div>
        </details>
      )}
      {info && !info.worktreeExists && <p className="text-xs text-red-600">The worktree was removed, so the session can no longer be resumed.</p>}
    </section>
  );
}

const FOLLOW_UP_SUGGESTIONS: ComposerSuggestion[] = [
  { icon: <FlaskConical />, text: 'Add tests for ' },
  { icon: <Bug />, text: 'Fix a bug: ' },
  { icon: <Wrench />, text: 'Refactor ' },
  { icon: <FileText />, text: 'Update docs for ' },
];

type DiffFocus = { file: string; line: number | null; nonce: number } | null;

function ChangesView({ feature, runStatus, focus }: { feature: Feature; runStatus: string | undefined; focus: DiffFocus }) {
  const [changes, setChanges] = useState<Changes | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    api.changes(feature.id).then(setChanges).catch(toastError).finally(() => setLoading(false));
  }, [feature.id]);
  useEffect(load, [load, runStatus, feature.worktreePath]);

  const removeWorktree = async () => {
    const ok = await confirm({
      title: 'Remove worktree?',
      description: `This deletes the directory ${feature.worktreePath}. The branch ${feature.branch} is kept.`,
      confirmLabel: 'Remove worktree',
      destructive: true,
    });
    if (!ok) return;
    try {
      const r = await api.removeWorktree(feature.id);
      toast(r.note);
    } catch (err) {
      if (err instanceof ApiError && err.body?.dirty) {
        const force = await confirm({
          title: 'Worktree has uncommitted changes',
          description: 'Removing it will permanently delete those uncommitted changes. This cannot be undone.',
          confirmLabel: 'Delete uncommitted changes',
          destructive: true,
        });
        if (force) await api.removeWorktree(feature.id, true).then((r) => toast(r.note)).catch(toastError);
      } else toastError(err);
    }
    load();
  };

  if (!feature.worktreePath && !feature.branch) return <p className="p-6 text-sm text-muted-foreground">No worktree yet — it is created when the feature enters Build.</p>;
  const docs = changes?.files.filter((f) => isDocPath(f.path)) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span>
            <span className="text-muted-foreground">Branch </span>
            <span className="font-mono">{feature.branch ?? '—'}</span>
            <span className="text-muted-foreground"> from </span>
            <span className="font-mono">{changes?.baseBranch}</span>
          </span>
          <span className="min-w-0 break-all">
            <span className="text-muted-foreground">Worktree </span>
            <span className="font-mono">{feature.worktreePath ?? 'removed'}</span>
            {changes && !changes.worktreeExists && feature.worktreePath && <span className="ml-1 text-red-600">(not found)</span>}
          </span>
          {changes && (
            <span className="text-muted-foreground">
              {changes.commits.length} commit(s) · {changes.files.length} file(s)
              {docs.length > 0 && (
                <Badge variant="violet" className="ml-2" title={docs.map((d) => d.path).join('\n')}>
                  <BookOpen className="h-3 w-3" /> {docs.length} doc(s)
                </Badge>
              )}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn(loading && 'animate-spin')} /> Refresh
          </Button>
          {feature.worktreePath && (
            <>
              <Button size="sm" variant="outline" onClick={() => api.openEditor(feature.id).then(() => toast('Opening in editor…')).catch(toastError)}>
                <ExternalLink /> Open in editor
              </Button>
              <Button size="sm" variant="outline" onClick={() => api.reveal(feature.id).catch(toastError)}>
                <FolderOpen /> Reveal in Finder
              </Button>
              <Button size="sm" variant="outline" onClick={() => copy(feature.worktreePath!, 'Path copied')}>
                <FolderGit2 /> Copy path
              </Button>
              {!isActive(feature.agentStatus) && (
                <Button size="sm" variant="ghost" className="text-red-600" onClick={removeWorktree}>
                  <Trash2 /> Remove worktree
                </Button>
              )}
            </>
          )}
        </div>
        {changes?.hasUncommittedChanges && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            The worktree has uncommitted changes.
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">Branches are never merged automatically. Review and merge manually, or open a pull request.</p>
      </div>
      {changes?.worktreeExists ? (
        <DiffViewer featureId={feature.id} commits={changes.commits} refreshKey={`${runStatus}-${feature.run?.commitHash}`} focus={focus} />
      ) : (
        changes && <p className="p-6 text-sm text-muted-foreground">The worktree no longer exists, so its diff cannot be shown.</p>
      )}
    </div>
  );
}

function ReviewSection({ review, onJump }: { review: ReviewResult; onJump: (file: string, line: number | null) => void }) {
  const sev = { blocker: 'red', major: 'amber', minor: 'blue', nit: 'gray' } as const;
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        Code review <Badge variant={review.verdict === 'approve' ? 'green' : 'red'}>{review.verdict === 'approve' ? 'approved' : 'changes requested'}</Badge>
      </h3>
      {review.summary && <p className="text-sm">{review.summary}</p>}
      <div className="metal-surface divide-y overflow-hidden rounded-xl">
        {review.findings.map((f, i) => (
          <div key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
            <Badge variant={sev[f.severity]}>{f.severity}</Badge>
            <button className="shrink-0 font-mono text-sky-700 hover:underline dark:text-sky-400" onClick={() => onJump(f.file, f.line)} title="Show in diff">
              {f.file}
              {f.line ? `:${f.line}` : ''}
            </button>
            <span className="min-w-0 flex-1">{f.message}</span>
          </div>
        ))}
        {review.findings.length === 0 && <p className="p-3 text-xs text-muted-foreground">No findings.</p>}
      </div>
    </section>
  );
}

function ValidationView({ run }: { run: Run }) {
  const results = run.validation ?? [];
  return (
    <div className="space-y-4 p-5">
      <p className="text-sm text-muted-foreground">Commands run by Kanbuild in the worktree (no agent, no tokens). The first failure stops the run and is sent back to the developer.</p>
      <div className="metal-surface divide-y overflow-hidden rounded-xl">
        {results.map((r, i) => {
          const ok = r.exitCode === 0 && !r.timedOut;
          return (
            <details key={i} open={!ok} className="group">
              <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs">
                <Badge variant={ok ? 'green' : 'red'}>{ok ? 'passed' : r.timedOut ? 'timed out' : `exit ${r.exitCode}`}</Badge>
                <span className="min-w-0 flex-1 truncate font-mono">{r.command}</span>
                <span className="text-muted-foreground">{(r.durationMs / 1000).toFixed(1)}s</span>
              </summary>
              <pre className="metal-inset max-h-80 overflow-auto rounded-none border-x-0 px-3 py-2 text-[11px]">{r.output || '(no output)'}</pre>
            </details>
          );
        })}
        {results.length === 0 && <p className="p-4 text-xs text-muted-foreground">{isActive(run.status) ? 'Running…' : 'No validation commands ran.'}</p>}
      </div>
    </div>
  );
}

function TestsView({ report, run }: { report: Report | null; run: Run | null }) {
  if (run?.role === 'validator') return <ValidationView run={run} />;
  if (!report) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {run && isActive(run.status) ? 'Test and build results are captured when the agent finishes. Follow live test commands in the Activity tab.' : 'No results for this run.'}
      </p>
    );
  }
  const { tests, build, reported } = report.self;
  const buildVariant = build.status === 'passed' ? 'green' : build.status === 'failed' ? 'red' : 'gray';
  return (
    <div className="space-y-5 p-5">
      {!reported && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          The agent did not produce a structured test report.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tests passed" value={<span className="text-emerald-600">{tests.passed ?? '—'}</span>} />
        <Stat label="Tests failed" value={<span className={tests.failed ? 'text-red-600' : ''}>{tests.failed ?? '—'}</span>} />
        <Stat label="Commands run" value={tests.executed.length} />
        <Stat label="Build" value={<Badge variant={buildVariant}>{build.status.replace('_', ' ')}</Badge>} />
      </div>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Tests executed</h3>
        {tests.executed.length ? (
          <ul className="space-y-1">{tests.executed.map((t) => <li key={t} className="metal-inset rounded-lg px-2 py-1 font-mono text-xs">{t}</li>)}</ul>
        ) : (
          <p className="text-xs text-muted-foreground">None reported.</p>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Not executed</h3>
        {tests.notRun.length ? (
          <ul className="list-disc space-y-1 pl-5 text-xs">{tests.notRun.map((t) => <li key={t}>{t}</li>)}</ul>
        ) : (
          <p className="text-xs text-muted-foreground">None reported.</p>
        )}
      </section>
      {tests.output && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Test output</h3>
          <pre className="max-h-80 overflow-auto rounded-xl metal-inset p-3 text-xs">{tests.output}</pre>
        </section>
      )}
      {build.output && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Build output</h3>
          <pre className="max-h-80 overflow-auto rounded-xl metal-inset p-3 text-xs">{build.output}</pre>
        </section>
      )}
    </div>
  );
}

export function AgentDetailSheet({ featureId, onClose, onEdit }: { featureId: string | null; onClose: () => void; onEdit: (f: Feature) => void }) {
  const feature = useStore((s) => (featureId ? s.features[featureId] : null));
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [tab, setTab] = useState('overview');
  const [focus, setFocus] = useState<DiffFocus>(null);
  const [creatingPr, setCreatingPr] = useState(false);
  const project = useStore((s) => (feature ? s.projects.find((p) => p.id === feature.projectId) ?? null : null));
  const githubConfigured = useStore((s) => !!s.settings?.github?.configured);

  useEffect(() => {
    setSelectedRunId(null);
    setRuns([]);
    setTab(feature?.status === 'done' ? 'report' : 'overview');
    setFocus(null);
    if (featureId) api.runs(featureId).then(setRuns).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [featureId]);

  // Keep run list fresh.
  useEffect(() => {
    if (!featureId) return;
    return onRunUpdate((r) => {
      if (r.featureId !== featureId) return;
      setRuns((prev) => {
        const i = prev.findIndex((p) => p.id === r.id);
        if (i < 0) return [r, ...prev];
        const next = [...prev];
        next[i] = r;
        return next;
      });
    });
  }, [featureId]);

  const runId = selectedRunId ?? feature?.currentRunId ?? null;
  const run = useMemo(() => runs.find((r) => r.id === runId) ?? (feature?.run?.id === runId ? feature.run : null) ?? null, [runs, runId, feature]);
  const active = isActive(run?.status);
  const now = useNow(active);

  useEffect(() => {
    setReport(null);
    if (!runId || active) return;
    api.report(runId).then(setReport).catch(() => setReport(null));
  }, [runId, active, run?.status]);

  if (!feature) return null;
  // A finished feature opens on the chat composer, so continuing the work is the first thing you see.
  const continueFirst = !active && !isActive(feature.agentStatus) && !feature.gate && !isPaused(feature) && (feature.status === 'done' || feature.agentStatus === 'completed');

  const act = async (fn: () => Promise<Feature>, msg: string) => {
    try {
      upsertFeature(await fn());
      toast(msg);
      setSelectedRunId(null);
    } catch (err) {
      toastError(err);
    }
  };

  const doDelete = async () => {
    const ok = await confirm({
      title: 'Delete feature?',
      description: (
        <>
          The card and its run history are removed{isActive(feature.agentStatus) ? ' and the running agent is cancelled' : ''}.
          {feature.branch && <> The branch <code className="font-mono">{feature.branch}</code> and its worktree are kept on disk.</>}
        </>
      ),
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteFeature(feature.id, true);
      onClose();
    } catch (err) {
      toastError(err);
    }
  };

  const createPr = async () => {
    setCreatingPr(true);
    try {
      const f = await api.createPr(feature.id);
      upsertFeature(f);
      toast(`Pull request #${f.prNumber} ready`);
    } catch (err) {
      toastError(err);
    } finally {
      setCreatingPr(false);
    }
  };
  const jumpToDiff = (file: string, line: number | null) => {
    setFocus({ file, line, nonce: Date.now() });
    setTab('changes');
  };

  const usage = run?.usage;
  return (
    <Dialog open={!!featureId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby={undefined}>
        <div className="border-b border-foreground/10 p-5 pr-12">
          <div className="flex items-center gap-2">
            <PriorityBadge priority={feature.priority} />
            <AgentStatusBadge status={run?.status ?? feature.agentStatus} />
            <PipelineChip feature={feature} />
            <Badge variant="outline" className="capitalize">{feature.status}</Badge>
            {run && <span className="text-xs text-muted-foreground">{runLabel(run)} · {roleLabel(run.role)}</span>}
          </div>
          <DialogPrimitive.Title className="mt-2.5 text-xl font-semibold leading-tight tracking-tight">{feature.title}</DialogPrimitive.Title>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onEdit(feature)}>
              <Pencil /> Edit
            </Button>
            {isActive(feature.agentStatus) && (
              <Button size="sm" variant="outline" onClick={() => act(() => api.cancel(feature.id), 'Cancelling agent…')}>
                <Ban /> Cancel agent
              </Button>
            )}
            {(feature.agentStatus === 'failed' || feature.agentStatus === 'cancelled') && (
              <Button size="sm" variant="outline" onClick={() => act(() => api.retry(feature.id), 'Retrying the step')} title="Re-runs the step that failed (same role and instructions)">
                <RotateCcw /> Retry {feature.run ? runLabel(feature.run).toLowerCase() : ''}
              </Button>
            )}
            {isReadyToStart(feature) && (
              <Button size="sm" onClick={() => act(() => api.startFeature(feature.id), 'Agent queued')} title="Auto-start is off for this project">
                <Play /> Start build
              </Button>
            )}
            {isPaused(feature) && (
              <Button size="sm" variant="gold" onClick={() => act(() => api.continuePipeline(feature.id), 'Pipeline continued')} title="The last step finished but the next one did not start">
                <Play /> Continue pipeline
              </Button>
            )}
            {feature.gate && (
              <Button size="sm" variant="outline" onClick={() => act(() => api.cancel(feature.id), 'Pipeline stopped')}>
                <Ban /> Stop pipeline
              </Button>
            )}
            {feature.prUrl ? (
              <Button size="sm" variant="chrome" asChild>
                <a href={feature.prUrl} target="_blank" rel="noreferrer">
                  <GitPullRequest /> PR #{feature.prNumber}
                </a>
              </Button>
            ) : (
              feature.branch &&
              !isActive(feature.agentStatus) && (
                <Button
                  size="sm"
                  variant="chrome"
                  disabled={creatingPr || !githubConfigured}
                  onClick={createPr}
                  title={githubConfigured ? 'Push the branch and open a pull request (never merges)' : 'Add a GitHub token in Settings first'}
                >
                  <GitPullRequest /> {creatingPr ? 'Creating PR…' : 'Create PR'}
                </Button>
              )
            )}
            {feature.worktreePath && (
              <Button size="sm" variant="outline" onClick={() => api.openEditor(feature.id).then((r) => toast(`Opening in ${r.via}…`)).catch(toastError)}>
                <ExternalLink /> Open in editor
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400" onClick={doDelete}>
              <Trash2 /> Delete
            </Button>
            {runs.length > 1 && (
              <select
                className="metal-raised ml-auto h-8 cursor-pointer rounded-lg px-2 text-xs [&>option]:bg-background"
                value={runId ?? ''}
                onChange={(e) => setSelectedRunId(e.target.value)}
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    #{r.attempt} {runLabel(r)} · {r.status}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {feature.gate && <GatePanel feature={feature} runs={runs} onShowDiff={() => setTab('changes')} onDone={() => setSelectedRunId(null)} />}

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="px-5 pt-3">
            <TabsList className="flex w-full overflow-x-auto">
              <TabsTrigger value="overview"><LayoutDashboard className="h-3.5 w-3.5" /> Overview</TabsTrigger>
              <TabsTrigger value="pipeline"><Workflow className="h-3.5 w-3.5" /> Pipeline</TabsTrigger>
              <TabsTrigger value="activity"><Activity className="h-3.5 w-3.5" /> Activity</TabsTrigger>
              <TabsTrigger value="changes"><FolderGit2 className="h-3.5 w-3.5" /> Changes</TabsTrigger>
              <TabsTrigger value="tests">{run?.role === 'validator' ? <ListChecks className="h-3.5 w-3.5" /> : <FlaskConical className="h-3.5 w-3.5" />} {run?.role === 'validator' ? 'Validation' : 'Tests'}</TabsTrigger>
              <TabsTrigger value="report"><FileText className="h-3.5 w-3.5" /> Report</TabsTrigger>
              <TabsTrigger value="terminal"><SquareTerminal className="h-3.5 w-3.5" /> Terminal</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-5 p-5">
              {continueFirst && <ContinueSession feature={feature} onQueued={() => setTab('activity')} />}
              {run ? (
                <section className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="capitalize">{run.stage ?? run.status}</span>
                    <span>{run.progress !== null ? `${Math.round(run.progress)}%` : active ? 'progress indeterminate' : ''}</span>
                  </div>
                  <RunProgress feature={feature} run={run} className="h-2" />
                  <p className="text-sm">{run.currentActivity}</p>
                  {run.error && run.status !== 'completed' && (
                    <pre className="whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{run.error}</pre>
                  )}
                </section>
              ) : (
                <p className="text-sm text-muted-foreground">No agent has run yet. Drag the card into Build to start one.</p>
              )}
              {report?.self.review && <ReviewSection review={report.self.review} onJump={jumpToDiff} />}
              {report?.self.plan && !feature.gate && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Implementation plan</h3>
                  <div className="prose-report metal-surface max-h-96 overflow-y-auto rounded-xl p-4 text-sm">
                    <Markdown>{report.self.plan}</Markdown>
                  </div>
                </section>
              )}
              {report && report.self.needsClarification.length > 0 && !feature.gate && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Questions asked</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm">{report.self.needsClarification.map((q) => <li key={q}>{q}</li>)}</ul>
                </section>
              )}
              {run && usage && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Duration" value={formatDuration(runDurationMs(run, now))} />
                    <Stat label="New tokens" value={formatTokens(newTokens(run))} hint="Input + cache write + output. Excludes cache re-reads." />
                    <Stat label="Est. cost" value={`~${formatCost(run.estimatedCostUsd)}`} hint="Computed from token usage and public API list prices" />
                    <Stat label="Model" value={<span className="font-mono text-xs">{run.model ?? 'default'}</span>} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Turns" value={run.metrics.turns} hint="API round-trips. Each one re-sends the whole context." />
                    <Stat
                      label="Context / turn"
                      value={`${formatTokens(run.metrics.baselineContextTokens)} → ${formatTokens(run.metrics.peakContextTokens)}`}
                      hint="Context size on the first turn (system prompt, tools, CLAUDE.md, prompt) and at its peak"
                    />
                    <Stat label="Cache re-reads" value={formatTokens(usage.cacheReadTokens)} hint="Context re-read from cache on every turn; billed at ~5–10% of the input price" />
                    <Stat
                      label="Denied tool calls"
                      value={<span className={run.metrics.permissionDenials ? 'text-amber-600' : ''}>{run.metrics.permissionDenials}</span>}
                      hint="Commands blocked by the allowlist. Each usually costs an extra turn; add common ones in Project settings."
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Input" value={formatTokens(usage.inputTokens)} />
                    <Stat label="Cache write" value={formatTokens(usage.cacheCreationTokens)} />
                    <Stat label="Output" value={formatTokens(usage.outputTokens)} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Costs are <strong>estimates</strong> from public API list prices (including cache pricing)
                    {run.reportedCostUsd !== null && <> · Claude Code reported ~{formatCost(run.reportedCostUsd)}</>}. They are not actual charges — Claude subscription plans are not billed per token.
                  </p>
                </>
              )}
              {!active && !feature.gate && !continueFirst && <ContinueSession feature={feature} onQueued={() => setTab('activity')} />}
              {run?.message && ['followup', 'fix', 'answer', 'feature', 'plan'].includes(run.kind) && (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">
                    {run.kind === 'followup' ? 'Follow-up request' : run.kind === 'answer' ? 'Your answers' : run.kind === 'fix' ? 'What to fix' : 'Your comments'}
                  </h3>
                  <pre className="whitespace-pre-wrap rounded-xl metal-inset p-3 font-sans text-sm">{run.message}</pre>
                </section>
              )}
              <section>
                <h3 className="mb-2 text-sm font-semibold">Description</h3>
                <pre className="whitespace-pre-wrap rounded-xl metal-inset p-3 font-sans text-sm">{feature.description || <span className="text-muted-foreground">No description.</span>}</pre>
              </section>
              <section className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                <div><span className="text-muted-foreground">Branch: </span><span className="font-mono">{feature.branch ?? '—'}</span></div>
                <div className="break-all"><span className="text-muted-foreground">Worktree: </span><span className="font-mono">{feature.worktreePath ?? '—'}</span></div>
                <div><span className="text-muted-foreground">Session: </span><span className="font-mono">{run?.sessionId ?? feature.sessionId ?? '—'}</span></div>
                <div><span className="text-muted-foreground">Created: </span>{new Date(feature.createdAt).toLocaleString()}</div>
                {run?.commitHash && <div><span className="text-muted-foreground">Head commit: </span><span className="font-mono">{run.commitHash.slice(0, 10)}</span></div>}
              </section>
            </div>
          </TabsContent>

          <TabsContent value="activity" className="min-h-0 flex-1">
            {runId ? <ActivityLog runId={runId} active={active} /> : <p className="p-6 text-sm text-muted-foreground">No activity yet.</p>}
          </TabsContent>

          <TabsContent value="pipeline" className="min-h-0 flex-1 overflow-y-auto">
            <PipelineTab
              feature={feature}
              config={project?.pipeline ?? null}
              runs={runs}
              selectedRunId={runId}
              onSelect={(r) => {
                setSelectedRunId(r.id);
                setTab(r.role === 'validator' ? 'tests' : 'report');
              }}
            />
          </TabsContent>

          <TabsContent value="changes" className="min-h-0 flex-1">
            <ChangesView feature={feature} runStatus={run?.status} focus={focus} />
          </TabsContent>

          <TabsContent value="terminal" className="min-h-0 flex-1">
            <TerminalTab feature={feature} agentActive={isActive(feature.agentStatus)} />
          </TabsContent>

          <TabsContent value="tests" className="min-h-0 flex-1 overflow-y-auto">
            <TestsView report={report} run={run} />
          </TabsContent>

          <TabsContent value="report" className="min-h-0 flex-1 overflow-y-auto">
            {report ? (
              <div className="prose-report p-5">
                <Markdown>{report.markdown}</Markdown>
              </div>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">{active ? 'The implementation report is generated when the agent finishes.' : 'No report for this run.'}</p>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Dialog>
  );
}
