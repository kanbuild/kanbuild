import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Coins, GitBranch, Timer, Zap } from 'lucide-react';
import type { Feature } from '@shared/types.ts';
import { cn, formatCost, formatDuration, formatTokens } from '@/lib/utils';
import { useNow } from '@/hooks';
import { AgentStatusBadge, PriorityBadge, RunProgress, isActive, newTokens, runCost, runDurationMs, totalTokens } from './status';

export function FeatureCardView({ feature, dragging, onClick }: { feature: Feature; dragging?: boolean; onClick?: () => void }) {
  const run = feature.run;
  const active = isActive(feature.agentStatus);
  const now = useNow(active && feature.agentStatus !== 'queued');
  const showAgent = feature.status !== 'backlog' || !!feature.agentStatus;
  const duration = runDurationMs(run, now);
  return (
    <div
      onClick={onClick}
      className={cn(
        'group cursor-pointer rounded-lg border bg-card p-3 text-card-foreground shadow-sm transition-shadow hover:shadow-md',
        dragging && 'rotate-1 shadow-lg ring-2 ring-sky-400/50',
        feature.agentStatus === 'failed' && 'border-red-300 dark:border-red-900',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium leading-snug">{feature.title}</h3>
        <PriorityBadge priority={feature.priority} />
      </div>
      {feature.description && feature.status === 'backlog' && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{feature.description}</p>
      )}
      {showAgent && (
        <div className="mt-2.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <AgentStatusBadge status={feature.agentStatus} />
            {run && run.attempt > 1 && (
              <span className="text-[10px] text-muted-foreground">{run.kind === 'followup' ? 'follow-up' : 'attempt'} #{run.attempt}</span>
            )}
          </div>
          {feature.agentStatus && <RunProgress feature={feature} run={run} />}
          {run?.currentActivity && active && (
            <p className="truncate text-xs text-muted-foreground" title={run.currentActivity}>
              {run.currentActivity}
            </p>
          )}
          {run?.error && feature.agentStatus === 'failed' && (
            <p className="line-clamp-2 text-xs text-red-600 dark:text-red-400" title={run.error}>
              {run.error}
            </p>
          )}
          {run && (run.startedAt || totalTokens(run) > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1" title="Elapsed execution time">
                <Timer className="h-3 w-3" /> {formatDuration(duration)}
              </span>
              <span
                className="inline-flex items-center gap-1"
                title={`New tokens (input + cache write + output). Plus ${formatTokens(run.usage.cacheReadTokens)} cache re-reads over ${run.metrics?.turns ?? 0} turns.`}
              >
                <Zap className="h-3 w-3" /> {formatTokens(newTokens(run))}
                {run.metrics?.turns ? <span className="opacity-70">· {run.metrics.turns} turns</span> : null}
              </span>
              <span className="inline-flex items-center gap-1" title="Estimated cost (not an actual charge)">
                <Coins className="h-3 w-3" /> ~{formatCost(runCost(run))}
              </span>
            </div>
          )}
          {feature.branch && (
            <p className="flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground" title={feature.branch}>
              <GitBranch className="h-3 w-3 shrink-0" /> {feature.branch}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function SortableFeatureCard({ feature, onOpen }: { feature: Feature; onOpen: (f: Feature) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: feature.id, data: { feature } });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(isDragging && 'opacity-40')}
      {...attributes}
      {...listeners}
    >
      <FeatureCardView feature={feature} onClick={() => onOpen(feature)} />
    </div>
  );
}
