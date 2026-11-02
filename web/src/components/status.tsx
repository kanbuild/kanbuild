import { AlertTriangle, PauseCircle, CheckCircle2, CircleDashed, ClipboardCheck, Clock, Link2, Loader2, MessageCircleQuestion, ShieldCheck, XCircle } from 'lucide-react';
import type { AgentRole, AgentStatus, Feature, GateType, Priority, Run } from '@shared/types.ts';
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

/** A step finished in Build but nothing is waiting or running: the pipeline needs "Continue". */
export const isPaused = (f: Feature) => f.status === 'build' && f.agentStatus === 'completed' && !f.gate;

/** Waiting for the user (checkpoint) or paused: the feature is not finished even though its last step completed. */
export const isWaiting = (f: Feature) => !!f.gate || isPaused(f);

export function RunProgress({ feature, run, className }: { feature: Feature; run: Run | null | undefined; className?: string }) {
  const status = run?.status ?? feature.agentStatus;
  if (!status) return null;
  if (isWaiting(feature) && (!run || run.id === feature.currentRunId)) return <Progress value={100} tone="amber" className={className} />;
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

/** Tokens that are actually new on some turn: input + cache writes + output (excludes cache re-reads). */
export const newTokens = (run: Run | null | undefined) =>
  run ? run.usage.inputTokens + run.usage.outputTokens + run.usage.cacheCreationTokens : 0;

export const runCost = (run: Run | null | undefined) => run?.estimatedCostUsd ?? run?.reportedCostUsd ?? null;

const ROLE_LABEL: Record<AgentRole, string> = {
  planner: 'Planner',
  developer: 'Developer',
  tester: 'Tester',
  reviewer: 'Reviewer',
  validator: 'Validation',
};
export const roleLabel = (r: AgentRole) => ROLE_LABEL[r] ?? r;

/** What a run does, e.g. "Plan", "Fix (validation)", "Review". */
export function runLabel(run: Pick<Run, 'kind' | 'role' | 'fixReason'>): string {
  switch (run.kind) {
    case 'plan':
      return 'Plan';
    case 'feature':
      return 'Develop';
    case 'fix':
      return run.fixReason === 'validation' ? 'Fix (validation)' : run.fixReason === 'review' ? 'Fix (review)' : 'Fix (your feedback)';
    case 'test':
      return 'Tests';
    case 'review':
      return 'Review';
    case 'validate':
      return 'Validation';
    case 'answer':
      return `${roleLabel(run.role)} (answers)`;
    case 'followup':
      return 'Follow-up';
  }
}

const GATE_META: Record<GateType, { label: string; icon: React.ElementType }> = {
  plan_approval: { label: 'Approve plan', icon: ClipboardCheck },
  clarification: { label: 'Needs your input', icon: MessageCircleQuestion },
  final_approval: { label: 'Awaiting approval', icon: ShieldCheck },
};

/** The pipeline step chip shown on cards: checkpoint, dependency wait, or the active step. */
export function PipelineChip({ feature }: { feature: Feature }) {
  if (feature.gate) {
    const m = GATE_META[feature.gate.type];
    const Icon = m.icon;
    return (
      <Badge variant="amber">
        <Icon className="h-3 w-3" /> {m.label}
      </Badge>
    );
  }
  if (isPaused(feature)) {
    return (
      <Badge variant="amber" title="The last step finished but the next one did not start. Open the card and click Continue pipeline.">
        <PauseCircle className="h-3 w-3" /> Paused
      </Badge>
    );
  }
  const run = feature.run;
  if (feature.status === 'build' && feature.agentStatus === 'queued' && feature.blockedBy.length && !feature.worktreePath) {
    return (
      <Badge variant="outline" className="text-muted-foreground" title={feature.blockedBy.map((d) => d.title).join(', ')}>
        <Link2 className="h-3 w-3" /> Blocked by {feature.blockedBy.length === 1 ? feature.blockedBy[0].title : `${feature.blockedBy.length} features`}
      </Badge>
    );
  }
  if (run && isActive(feature.agentStatus) && !(run.kind === 'feature' && run.role === 'developer' && run.cycle === 1 && run.attempt === 1)) {
    return <Badge variant="violet">{runLabel(run)}</Badge>;
  }
  return null;
}

export function needsAttention(f: Feature) {
  return isWaiting(f) || (f.status === 'build' && f.agentStatus === 'failed');
}
