import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Loader2, XCircle } from 'lucide-react';
import type { AgentStatus, Feature, Priority, Run } from '@shared/types.ts';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';

export const ACTIVE: AgentStatus[] = ['queued', 'initialising', 'running'];
export const isActive = (s: AgentStatus | null | undefined) => !!s && ACTIVE.includes(s);

const STATUS_META: Record<AgentStatus, { label: string; variant: 'gray' | 'blue' | 'violet' | 'green' | 'red' | 'amber'; icon: React.ElementType; spin?: boolean }> = {
  queued: { label: 'Queued', variant: 'gray', icon: Clock },
  initialising: { label: 'Initialising', variant: 'violet', icon: Loader2, spin: true },
  running: { label: 'Running', variant: 'blue', icon: Loader2, spin: true },
  completed: { label: 'Completed', variant: 'green', icon: CheckCircle2 },
  failed: { label: 'Failed', variant: 'red', icon: AlertTriangle },
  cancelled: { label: 'Cancelled', variant: 'amber', icon: XCircle },
};

export function AgentStatusBadge({ status }: { status: AgentStatus | null }) {
  if (!status)
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <CircleDashed className="h-3 w-3" /> Not started
      </Badge>
    );
  const m = STATUS_META[status];
  const Icon = m.icon;
  return (
    <Badge variant={m.variant}>
      <Icon className={`h-3 w-3 ${m.spin ? 'animate-spin' : ''}`} /> {m.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  const v = priority === 'high' ? 'red' : priority === 'medium' ? 'amber' : 'gray';
  return <Badge variant={v}>{priority}</Badge>;
}

export function RunProgress({ feature, run, className }: { feature: Feature; run: Run | null | undefined; className?: string }) {
  const status = run?.status ?? feature.agentStatus;
  if (!status) return null;
  if (status === 'completed') return <Progress value={100} tone="green" className={className} />;
  if (status === 'failed') return <Progress value={run?.progress ?? 100} tone="red" className={className} />;
  if (status === 'cancelled') return <Progress value={run?.progress ?? 0} className={className} />;
  if (status === 'queued') return <Progress value={0} className={className} />;
  // Running/initialising: only show a percentage when the agent reported a milestone.
  return <Progress value={run?.progress ?? null} className={className} />;
}

export function runDurationMs(run: Run | null | undefined, now: number): number | null {
  if (!run?.startedAt) return null;
  const end = run.endedAt ? Date.parse(run.endedAt) : now;
  return end - Date.parse(run.startedAt);
}

export const totalTokens = (run: Run | null | undefined) =>
  run ? run.usage.inputTokens + run.usage.outputTokens + run.usage.cacheCreationTokens + run.usage.cacheReadTokens : 0;

export const runCost = (run: Run | null | undefined) => run?.estimatedCostUsd ?? run?.reportedCostUsd ?? null;
