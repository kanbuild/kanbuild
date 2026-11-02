import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Activity,
  AlertTriangle,
  Ban,
  Bot,
  ExternalLink,
  FileMinus,
  FilePen,
  FilePlus,
  FileText,
  FlaskConical,
  FolderGit2,
  GitCommit,
  LayoutDashboard,
  Pencil,
  RefreshCw,
  RotateCcw,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react';
import type { Changes, Feature, Report, Run, RunEvent } from '@shared/types.ts';
import { api, ApiError } from '@/api';
import { onRunEvent, onRunUpdate, upsertFeature, useStore } from '@/store';
import { useNow } from '@/hooks';
import { cn, formatCost, formatDuration, formatTime, formatTokens } from '@/lib/utils';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Dialog, SheetContent } from './ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { AgentStatusBadge, PriorityBadge, RunProgress, isActive, runDurationMs, totalTokens } from './status';
import { confirm } from './confirm';
import { toast, toastError } from './toast';

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border p-3" title={hint}>
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
    <div className={cn('group flex gap-2 px-3 py-1 font-mono text-xs hover:bg-muted/50', (e.kind === 'error' || e.kind === 'stderr') && 'bg-red-500/5', e.kind === 'warning' && 'bg-amber-500/5')}>
      <span className="shrink-0 tabular-nums text-muted-foreground">{formatTime(e.ts)}</span>
      <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', s.cls)} />
      <div className="min-w-0 flex-1">
        <div className={cn('whitespace-pre-wrap break-words', s.cls, e.detail && 'cursor-pointer')} onClick={() => e.detail && setOpen(!open)}>
          {e.summary}
          {e.detail && <span className="ml-1 text-muted-foreground">{open ? '▾' : '▸'}</span>}
        </div>
        {open && e.detail && <pre className="mt-1 max-h-80 overflow-auto rounded bg-muted p-2 text-[11px] text-muted-foreground">{e.detail}</pre>}
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
          <button key={f} onClick={() => setFilter(f)} className={cn('rounded px-2 py-0.5 capitalize', filter === f ? 'bg-muted font-medium' : 'text-muted-foreground')}>
            {f}
            {f === 'problems' && problems > 0 && ` (${problems})`}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">{events.length} events</span>
        {active && <span className="inline-flex items-center gap-1 text-sky-600"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" /> live</span>}
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

function ChangesView({ feature, runStatus }: { feature: Feature; runStatus: string | undefined }) {
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
  const icon = { created: FilePlus, modified: FilePen, deleted: FileMinus, renamed: FilePen };
  const color = { created: 'text-emerald-600', modified: 'text-sky-600', deleted: 'text-red-600', renamed: 'text-violet-600' };
  const counts = { created: 0, modified: 0, deleted: 0, renamed: 0 };
  changes?.files.forEach((f) => counts[f.change]++);

  return (
    <div className="space-y-5 p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3 text-xs">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Branch</div>
          <div className="break-all font-mono">{feature.branch ?? '—'}</div>
          <div className="mt-1 text-muted-foreground">base: <span className="font-mono">{changes?.baseBranch}</span></div>
        </div>
        <div className="rounded-lg border p-3 text-xs">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Worktree</div>
          <div className="break-all font-mono">{feature.worktreePath ?? 'removed'}</div>
          {changes && !changes.worktreeExists && feature.worktreePath && <div className="mt-1 text-red-600">Directory not found</div>}
        </div>
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
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(feature.worktreePath!).then(() => toast('Path copied'))}>
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
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          The worktree has uncommitted changes.
        </div>
      )}
      <section>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          Files <span className="text-xs font-normal text-muted-foreground">{counts.created} created · {counts.modified} modified · {counts.deleted} deleted</span>
        </h3>
        <div className="divide-y rounded-lg border">
          {changes?.files.map((f) => {
            const Icon = icon[f.change];
            return (
              <div key={f.path} className="flex items-center gap-2 px-3 py-1.5 font-mono text-xs">
                <Icon className={cn('h-3.5 w-3.5 shrink-0', color[f.change])} />
                <span className="min-w-0 flex-1 truncate">{f.path}</span>
                {!f.committed && <Badge variant="amber">uncommitted</Badge>}
                <span className={cn('text-[10px] uppercase', color[f.change])}>{f.change}</span>
              </div>
            );
          })}
          {changes && changes.files.length === 0 && <p className="p-4 text-xs text-muted-foreground">No changes relative to {changes.baseBranch}.</p>}
        </div>
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold">Commits</h3>
        <div className="divide-y rounded-lg border">
          {changes?.commits.map((c) => (
            <div key={c.hash} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <GitCommit className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="font-mono text-muted-foreground">{c.hash.slice(0, 8)}</span>
              <span className="min-w-0 flex-1 truncate">{c.subject}</span>
              <span className="text-muted-foreground">{new Date(c.date).toLocaleString()}</span>
            </div>
          ))}
          {changes && changes.commits.length === 0 && <p className="p-4 text-xs text-muted-foreground">No commits on top of {changes.baseBranch}.</p>}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Branches are never merged automatically. Review and merge manually.</p>
      </section>
    </div>
  );
}

function TestsView({ report, run }: { report: Report | null; run: Run | null }) {
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
          <ul className="space-y-1">{tests.executed.map((t) => <li key={t} className="rounded bg-muted px-2 py-1 font-mono text-xs">{t}</li>)}</ul>
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
          <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{tests.output}</pre>
        </section>
      )}
      {build.output && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Build output</h3>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">{build.output}</pre>
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

  useEffect(() => {
    setSelectedRunId(null);
    setRuns([]);
    setTab(feature?.status === 'done' ? 'report' : 'overview');
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

  const usage = run?.usage;
  return (
    <Dialog open={!!featureId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent aria-describedby={undefined}>
        <div className="border-b p-5 pr-12">
          <div className="flex items-center gap-2">
            <PriorityBadge priority={feature.priority} />
            <AgentStatusBadge status={run?.status ?? feature.agentStatus} />
            <Badge variant="outline" className="capitalize">{feature.status}</Badge>
          </div>
          <DialogPrimitive.Title className="mt-2 text-lg font-semibold leading-tight">{feature.title}</DialogPrimitive.Title>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => onEdit(feature)}>
              <Pencil /> Edit
            </Button>
            {isActive(feature.agentStatus) && (
              <Button size="sm" variant="outline" onClick={() => act(() => api.cancel(feature.id), 'Cancelling agent…')}>
                <Ban /> Cancel agent
              </Button>
            )}
            {(feature.agentStatus === 'failed' || feature.agentStatus === 'cancelled' || feature.agentStatus === 'completed') && (
              <Button size="sm" variant="outline" onClick={() => act(() => api.retry(feature.id), 'New agent run queued')}>
                <RotateCcw /> {feature.agentStatus === 'completed' ? 'Run again' : 'Retry'}
              </Button>
            )}
            {feature.worktreePath && (
              <Button size="sm" variant="outline" onClick={() => api.openEditor(feature.id).then(() => toast('Opening in editor…')).catch(toastError)}>
                <ExternalLink /> Open in editor
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-red-600" onClick={doDelete}>
              <Trash2 /> Delete
            </Button>
            {runs.length > 1 && (
              <select
                className="ml-auto h-8 rounded-md border bg-background px-2 text-xs"
                value={runId ?? ''}
                onChange={(e) => setSelectedRunId(e.target.value)}
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    Run #{r.attempt} · {r.status}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b px-5 py-2">
            <TabsList>
              <TabsTrigger value="overview"><LayoutDashboard className="h-3.5 w-3.5" /> Overview</TabsTrigger>
              <TabsTrigger value="activity"><Activity className="h-3.5 w-3.5" /> Activity</TabsTrigger>
              <TabsTrigger value="changes"><FolderGit2 className="h-3.5 w-3.5" /> Changes</TabsTrigger>
              <TabsTrigger value="tests"><FlaskConical className="h-3.5 w-3.5" /> Tests</TabsTrigger>
              <TabsTrigger value="report"><FileText className="h-3.5 w-3.5" /> Report</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-5 p-5">
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
              {run && usage && (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Duration" value={formatDuration(runDurationMs(run, now))} />
                    <Stat label="Total tokens" value={formatTokens(totalTokens(run))} />
                    <Stat label="Est. cost" value={`~${formatCost(run.estimatedCostUsd)}`} hint="Computed from token usage and public API list prices" />
                    <Stat label="Model" value={<span className="font-mono text-xs">{run.model ?? 'default'}</span>} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Input" value={formatTokens(usage.inputTokens)} />
                    <Stat label="Output" value={formatTokens(usage.outputTokens)} />
                    <Stat label="Cache write" value={formatTokens(usage.cacheCreationTokens)} />
                    <Stat label="Cache read" value={formatTokens(usage.cacheReadTokens)} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Costs are <strong>estimates</strong> from public API list prices (including cache pricing)
                    {run.reportedCostUsd !== null && <> · Claude Code reported ~{formatCost(run.reportedCostUsd)}</>}. They are not actual charges — Claude subscription plans are not billed per token.
                  </p>
                </>
              )}
              <section>
                <h3 className="mb-2 text-sm font-semibold">Description</h3>
                <pre className="whitespace-pre-wrap rounded-md bg-muted/60 p-3 font-sans text-sm">{feature.description || <span className="text-muted-foreground">No description.</span>}</pre>
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

          <TabsContent value="changes" className="min-h-0 flex-1 overflow-y-auto">
            <ChangesView feature={feature} runStatus={run?.status} />
          </TabsContent>

          <TabsContent value="tests" className="min-h-0 flex-1 overflow-y-auto">
            <TestsView report={report} run={run} />
          </TabsContent>

          <TabsContent value="report" className="min-h-0 flex-1 overflow-y-auto">
            {report ? (
              <div className="prose-report p-5">
                <ReactMarkdown>{report.markdown}</ReactMarkdown>
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
