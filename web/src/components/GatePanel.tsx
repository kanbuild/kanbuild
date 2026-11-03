import { useEffect, useState } from 'react';
import { Markdown } from './Markdown';
import { Check, ClipboardCheck, HelpCircle, FileDiff, MessageCircleQuestion, Pencil, ShieldCheck } from 'lucide-react';
import type { Feature, Run } from '@shared/types.ts';
import { api, type GateAction } from '@/api';
import { upsertFeature } from '@/store';
import { Button } from './ui/button';
import { Textarea } from './ui/input';
import { roleLabel } from './status';

/** One-line outcome of the cycle's latest validation, test and review runs. */
function summarize(runs: Run[]): string[] {
  const last = (role: Run['role']) => [...runs].reverse().find((r) => r.role === role);
  const out: string[] = [];
  const v = last('validator');
  if (v) out.push(`validation ${v.status === 'completed' ? 'passed ✓' : 'failed ✗'}`);
  const t = last('tester');
  if (t) out.push(`tests ${t.status === 'completed' ? 'added ✓' : t.status}`);
  const fixes = runs.filter((r) => r.kind === 'fix').length;
  if (fixes) out.push(`${fixes} fix round(s)`);
  if (last('reviewer')) out.push('reviewed');
  return out;
}
import { toast, toastError } from './toast';

/** Approval / clarification checkpoint: shown at the top of the detail sheet while the pipeline waits for the user. */
export function GatePanel({ feature, runs, onShowDiff, onDone }: { feature: Feature; runs: Run[]; onShowDiff: () => void; onDone: () => void }) {
  const gate = feature.gate!;
  const [comment, setComment] = useState('');
  const [answers, setAnswers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setComment('');
    setAnswers((gate.questions ?? []).map(() => ''));
  }, [gate.runId, gate.type, gate.questions]);

  const act = async (action: GateAction, msg: string) => {
    setBusy(true);
    try {
      upsertFeature(await api.gate(feature.id, action, { comment, answers }));
      toast(msg);
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const gateRun = runs.find((r) => r.id === gate.runId);
  const cycleRuns = gateRun ? runs.filter((r) => r.cycle === gateRun.cycle).slice().reverse() : [];

  return (
    <section className="border-b border-foreground/10 p-4">
      <div className="metal-surface overflow-hidden rounded-2xl shadow-gold-glow">
      <div className="flex items-center gap-2 border-b border-[hsl(var(--gold)/0.35)] bg-[hsl(var(--gold)/0.12)] px-4 py-2 text-xs font-medium text-amber-800 dark:text-[hsl(var(--gold-hi))]">
        <HelpCircle className="h-3.5 w-3.5" /> The agent is waiting for you
        <span className="ml-auto text-[11px] font-normal opacity-80">Checkpoint</span>
      </div>
      <div className="space-y-3 p-4">
      {gate.type === 'plan_approval' && (
        <>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardCheck className="h-4 w-4 text-amber-600 dark:text-[hsl(var(--gold))]" /> Review the implementation plan
          </h3>
          <div className="prose-report metal-inset max-h-64 overflow-y-auto rounded-xl p-4 text-sm">
            {gate.plan ? <Markdown>{gate.plan}</Markdown> : <p className="text-muted-foreground">The planner did not return a structured plan; see its report.</p>}
          </div>
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Optional comments for the developer, or what should change in the plan" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => act('approve', 'Plan approved — implementing')}>
              <Check /> Approve and implement
            </Button>
            <Button size="sm" variant="chrome" disabled={busy || !comment.trim()} onClick={() => act('reject', 'Plan sent back for revision')}>
              <Pencil /> Request plan changes
            </Button>
          </div>
        </>
      )}

      {gate.type === 'clarification' && (
        <>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <MessageCircleQuestion className="h-4 w-4 text-amber-600 dark:text-[hsl(var(--gold))]" /> The {roleLabel(gate.role ?? 'developer').toLowerCase()} has questions
          </h3>
          <p className="text-xs text-muted-foreground">Your answers are sent back to the same Claude Code session, which then continues.</p>
          <div className="space-y-3">
            {(gate.questions ?? []).map((q, i) => (
              <div key={i} className="space-y-1">
                <p className="text-sm font-medium">{q}</p>
                <Textarea
                  rows={2}
                  value={answers[i] ?? ''}
                  onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
                  placeholder="Your answer (leave empty to let the agent decide)"
                />
              </div>
            ))}
          </div>
          <Button size="sm" disabled={busy || !answers.some((a) => a.trim())} onClick={() => act('answer', 'Answers sent — the agent continues')}>
            <Check /> Send answers
          </Button>
        </>
      )}

      {gate.type === 'final_approval' && (
        <>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-[hsl(var(--gold))]" /> Ready for your approval
          </h3>
          {gate.note && <p className="text-sm text-amber-800 dark:text-amber-200">{gate.note}</p>}
          {cycleRuns.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {cycleRuns.length} run(s) in this cycle
              {summarize(cycleRuns).map((s) => (
                <span key={s}> · {s}</span>
              ))}
              . Details in the Pipeline tab.
            </p>
          )}
          <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="What should change? (required to request changes)" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onShowDiff}>
              <FileDiff /> Review the diff
            </Button>
            <Button size="sm" disabled={busy} onClick={() => act('approve', 'Approved — feature moved to Done')}>
              <Check /> Approve → Done
            </Button>
            <Button size="sm" variant="chrome" disabled={busy || !comment.trim()} onClick={() => act('reject', 'Changes requested — the developer continues')}>
              <Pencil /> Request changes
            </Button>
          </div>
        </>
      )}
      </div>
      </div>
    </section>
  );
}
