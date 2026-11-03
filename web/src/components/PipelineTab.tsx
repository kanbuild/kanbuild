import { CheckCircle2, Circle, CircleDot, XCircle } from 'lucide-react';
import type { Feature, PipelineConfig, Run } from '@shared/types.ts';
import { cn, formatCost, formatDuration, formatTokens } from '@/lib/utils';
import { AgentStatusBadge, newTokens, roleLabel, runCost, runDurationMs, runLabel } from './status';

type StepState = 'done' | 'current' | 'pending' | 'failed';

interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

/** The configured pipeline for the latest cycle, with each step's state derived from its runs. */
function steps(config: PipelineConfig, feature: Feature, cycleRuns: Run[]): Step[] {
  const latest = (pred: (r: Run) => boolean) => [...cycleRuns].reverse().find(pred);
  const state = (r: Run | undefined): StepState =>
    !r ? 'pending' : r.status === 'completed' ? 'done' : r.status === 'failed' || r.status === 'cancelled' ? 'failed' : 'current';
  const out: Step[] = [];
  const followup = cycleRuns[0]?.kind === 'followup';
  if (config.plan && !followup) {
    out.push({ label: 'Plan', state: state(latest((r) => r.role === 'planner')) });
    if (config.planApproval) {
      const approved = cycleRuns.some((r) => r.role === 'developer');
      out.push({ label: 'Approve plan', state: approved ? 'done' : feature.gate?.type === 'plan_approval' ? 'current' : 'pending' });
    }
  }
  const dev = latest((r) => r.role === 'developer');
  const fixes = cycleRuns.filter((r) => r.kind === 'fix').length;
  out.push({ label: followup ? 'Follow-up' : 'Develop', state: state(dev), detail: fixes ? `${fixes} fix round(s)` : undefined });
  if (config.validate) out.push({ label: 'Validate', state: state(latest((r) => r.role === 'validator')) });
  if (config.tester) out.push({ label: 'Tests', state: state(latest((r) => r.role === 'tester')) });
  if (config.reviewer) out.push({ label: 'Review', state: state(latest((r) => r.role === 'reviewer')) });
  if (config.finalApproval) out.push({ label: 'Your approval', state: feature.status === 'done' ? 'done' : feature.gate?.type === 'final_approval' ? 'current' : 'pending' });
  out.push({ label: 'Done', state: feature.status === 'done' ? 'done' : 'pending' });
  // Any step after the current one can't be "done" from an older pass.
  return out;
}

const ICON: Record<StepState, React.ElementType> = { done: CheckCircle2, current: CircleDot, pending: Circle, failed: XCircle };
const COLOR: Record<StepState, string> = {
  done: 'text-emerald-500',
  current: 'text-primary',
  pending: 'text-muted-foreground/50',
  failed: 'text-red-600',
};

export function PipelineTab({
  feature,
  config,
  runs,
  selectedRunId,
  onSelect,
}: {
  feature: Feature;
  config: PipelineConfig | null;
  runs: Run[];
  selectedRunId: string | null;
  onSelect: (run: Run) => void;
}) {
  const byCycle = new Map<number, Run[]>();
  for (const r of [...runs].sort((a, b) => a.attempt - b.attempt)) byCycle.set(r.cycle, [...(byCycle.get(r.cycle) ?? []), r]);
  const cycles = [...byCycle.entries()].sort((a, b) => b[0] - a[0]);
  const latest = cycles[0]?.[1] ?? [];
  const total = runs.reduce((s, r) => s + (runCost(r) ?? 0), 0);
  const now = Date.now();

  return (
    <div className="space-y-6 p-5">
      {config && (
        <section>
          <h3 className="mb-3 text-sm font-semibold">Pipeline</h3>
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
            {steps(config, feature, latest).map((s, i, arr) => {
              const Icon = ICON[s.state];
              return (
                <li key={s.label} className="flex items-center gap-1">
                  <span
                    className={cn(
                      'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs',
                      s.state === 'pending' ? 'border border-dashed border-foreground/15 text-muted-foreground' : 'metal-raised',
                      s.state === 'current' && 'shadow-glow',
                      s.state === 'failed' && 'border-red-400/60',
                    )}
                    title={s.detail}
                  >
                    <Icon className={cn('h-3.5 w-3.5', COLOR[s.state])} />
                    {s.label}
                    {s.detail && <span className="text-[10px] text-muted-foreground">· {s.detail}</span>}
                  </span>
                  {i < arr.length - 1 && <span className={cn('h-px w-3', s.state === 'done' ? 'bg-emerald-500/60' : 'bg-foreground/15')} />}
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[11px] text-muted-foreground">Configure the steps in Project settings → Pipeline.</p>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Runs</h3>
          <span className="text-xs text-muted-foreground">Total est. ~{formatCost(total)} across {runs.length} run(s)</span>
        </div>
        {cycles.map(([cycle, list]) => {
          const cost = list.reduce((s, r) => s + (runCost(r) ?? 0), 0);
          return (
            <div key={cycle} className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                <span>
                  Cycle {cycle}
                  {list[0]?.kind === 'followup' ? ' · follow-up' : ''}
                </span>
                <span>~{formatCost(cost)}</span>
              </div>
              <div className="metal-surface divide-y overflow-hidden rounded-xl">
                {list.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => onSelect(r)}
                    className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-xs hover:bg-foreground/[0.04]', r.id === selectedRunId && 'bg-primary/10')}
                  >
                    <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">#{r.attempt}</span>
                    <span className="w-32 shrink-0 font-medium">{runLabel(r)}</span>
                    <span className="w-20 shrink-0 text-muted-foreground">{roleLabel(r.role)}</span>
                    <AgentStatusBadge status={r.status} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground" title={r.error ?? r.currentActivity ?? ''}>
                      {r.status === 'failed' ? r.error : r.currentActivity}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{formatDuration(runDurationMs(r, now))}</span>
                    {r.role !== 'validator' && <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{formatTokens(newTokens(r))}</span>}
                    {r.role !== 'validator' && <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">~{formatCost(runCost(r))}</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {runs.length === 0 && <p className="text-sm text-muted-foreground">Nothing has run yet. Drag the card into Build to start the pipeline.</p>}
      </section>
    </div>
  );
}
