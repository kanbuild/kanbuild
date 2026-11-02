import type { AgentRole, AgentStatus, FixReason, Gate, PipelineConfig, ReviewResult, RunKind, ValidationResult } from '../../shared/types.ts';

/** What the pipeline needs to know about each run of the current cycle. */
export interface StepRun {
  kind: RunKind;
  role: AgentRole;
  status: AgentStatus;
  fixReason: FixReason | null;
  questions: string[];
  plan: string;
  review: ReviewResult | null;
  validation: ValidationResult[] | null;
}

export type Decision =
  | { type: 'run'; kind: RunKind; role: AgentRole; fixReason?: FixReason; reason: string }
  | { type: 'gate'; gate: Omit<Gate, 'runId' | 'openedAt'> }
  | { type: 'done'; note?: string }
  | { type: 'stop'; error: string }
  | { type: 'idle' };

export interface PipelineContext {
  config: PipelineConfig;
  /** Validation commands resolved for the worktree (configured or detected). */
  hasValidationCommands: boolean;
}

const countFixes = (runs: StepRun[], reason: FixReason) => runs.filter((r) => r.kind === 'fix' && r.fixReason === reason).length;

export function validationPassed(v: ValidationResult[] | null): boolean {
  return !!v && v.every((r) => r.exitCode === 0 && !r.timedOut);
}

/** First step of a new cycle. */
export function firstStep(config: PipelineConfig, kind: 'start' | 'followup'): { kind: RunKind; role: AgentRole } {
  if (kind === 'followup') return { kind: 'followup', role: 'developer' };
  return config.plan ? { kind: 'plan', role: 'planner' } : { kind: 'feature', role: 'developer' };
}

/**
 * Decide what happens after the last run of a cycle finished. Pure function of the pipeline config and
 * the cycle's run history (oldest first), so it is easy to test and survives restarts.
 */
export function nextStep(ctx: PipelineContext, runs: StepRun[]): Decision {
  const { config } = ctx;
  const last = runs[runs.length - 1];
  if (!last || last.status === 'cancelled' || last.status === 'queued' || last.status === 'running' || last.status === 'initialising') {
    return { type: 'idle' };
  }

  if (last.role === 'validator') {
    if (last.status === 'completed' && validationPassed(last.validation)) return afterValidated(ctx, runs);
    if (last.status === 'failed' && !last.validation?.length) return { type: 'stop', error: 'Validation could not run' };
    const fixes = countFixes(runs, 'validation');
    if (fixes < config.maxFixLoops) {
      return { type: 'run', kind: 'fix', role: 'developer', fixReason: 'validation', reason: `Validation failed; developer fix ${fixes + 1}/${config.maxFixLoops}` };
    }
    return { type: 'stop', error: `Validation still failing after ${fixes} automatic fix attempt(s). Inspect the Validation results, then Retry, send a follow-up, or fix it yourself.` };
  }

  // Agent runs that failed (process error, budget, crash) stop the pipeline; the user can Retry.
  if (last.status === 'failed') return { type: 'stop', error: '' };

  if (last.questions.length) {
    return { type: 'gate', gate: { type: 'clarification', questions: last.questions, role: last.role } };
  }

  switch (last.role) {
    case 'planner':
      if (config.planApproval) return { type: 'gate', gate: { type: 'plan_approval', plan: last.plan } };
      return { type: 'run', kind: 'feature', role: 'developer', reason: 'Plan ready; implementing' };
    case 'developer':
    case 'tester':
      return afterChange(ctx, runs);
    case 'reviewer': {
      if (last.review?.verdict !== 'changes_requested') return finish(config);
      const fixes = countFixes(runs, 'review');
      if (fixes < config.maxFixLoops) {
        return { type: 'run', kind: 'fix', role: 'developer', fixReason: 'review', reason: `Reviewer requested changes; developer fix ${fixes + 1}/${config.maxFixLoops}` };
      }
      if (config.finalApproval) {
        return { type: 'gate', gate: { type: 'final_approval', note: `The reviewer still requests changes after ${fixes} fix round(s). Approve anyway or request changes.` } };
      }
      return { type: 'stop', error: `The reviewer still requests changes after ${fixes} fix round(s). See the Review, then Retry, send a follow-up, or fix it yourself.` };
    }
  }
  return { type: 'idle' };
}

/** After the developer or tester changed code: validate, or continue as if validation passed. */
function afterChange(ctx: PipelineContext, runs: StepRun[]): Decision {
  if (ctx.config.validate && ctx.hasValidationCommands) return { type: 'run', kind: 'validate', role: 'validator', reason: 'Running validation commands' };
  return afterValidated(ctx, runs);
}

function afterValidated(ctx: PipelineContext, runs: StepRun[]): Decision {
  const { config } = ctx;
  if (config.tester && !runs.some((r) => r.role === 'tester' && r.status === 'completed')) {
    return { type: 'run', kind: 'test', role: 'tester', reason: 'Tester agent adds and runs tests' };
  }
  if (config.reviewer) return { type: 'run', kind: 'review', role: 'reviewer', reason: 'Reviewer agent reviews the changes' };
  return finish(config);
}

function finish(config: PipelineConfig): Decision {
  if (config.finalApproval) return { type: 'gate', gate: { type: 'final_approval' } };
  return { type: 'done' };
}

/** Short label of what a run does, for cards and the run selector. */
export function stepLabel(kind: RunKind, role: AgentRole, fixReason: FixReason | null): string {
  if (role === 'planner') return 'Planning';
  if (role === 'validator') return 'Validating';
  if (role === 'tester') return 'Testing';
  if (role === 'reviewer') return 'Reviewing';
  if (kind === 'fix') return fixReason === 'validation' ? 'Fixing validation' : fixReason === 'review' ? 'Addressing review' : 'Applying feedback';
  if (kind === 'followup') return 'Follow-up';
  return 'Developing';
}
