import type { AgentSelfReport, AgentStatus, Changes, Feature, Project, Report, Usage } from '../../shared/types.ts';

function asString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(asString).join('\n');
  return JSON.stringify(v);
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(asString).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v];
  return [];
}

function asNum(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function emptySelfReport(): AgentSelfReport {
  return {
    summary: '',
    implementationDetails: '',
    tests: { executed: [], passed: null, failed: null, notRun: [], output: '' },
    build: { status: 'unknown', output: '' },
    outstandingIssues: [],
    reported: false,
  };
}

/**
 * Extract the agent's structured self-report from its final message.
 * Looks for the last ```json fenced block (or a bare top-level JSON object) containing a "summary" key.
 * Tolerant of missing fields and snake/camel case.
 */
export function extractSelfReport(text: string): AgentSelfReport {
  const report = emptySelfReport();
  if (!text) return report;
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) candidates.push(m[1]);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));

  let obj: any = null;
  for (const c of candidates.reverse()) {
    try {
      const parsed = JSON.parse(c);
      if (parsed && typeof parsed === 'object' && ('summary' in parsed || 'tests' in parsed)) {
        obj = parsed;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!obj) {
    // No structured block: keep the final message as the summary so nothing is lost.
    report.summary = text.trim().slice(0, 4000);
    return report;
  }
  report.reported = true;
  report.summary = asString(obj.summary);
  report.implementationDetails = asString(obj.implementation_details ?? obj.implementationDetails);
  const t = obj.tests ?? {};
  report.tests = {
    executed: asStringArray(t.executed ?? t.commands),
    passed: asNum(t.passed),
    failed: asNum(t.failed),
    notRun: asStringArray(t.not_run ?? t.notRun ?? t.not_executed),
    output: asString(t.output ?? t.errors),
  };
  const b = obj.build ?? {};
  const status = String(b.status ?? 'unknown').toLowerCase();
  report.build = {
    status: (['passed', 'failed', 'not_run'].includes(status) ? status : status === 'success' ? 'passed' : 'unknown') as AgentSelfReport['build']['status'],
    output: asString(b.output),
  };
  report.outstandingIssues = asStringArray(obj.outstanding_issues ?? obj.outstandingIssues ?? obj.issues);
  return report;
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return 'n/a';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}h ${m}m ${sec}s` : m ? `${m}m ${sec}s` : `${sec}s`;
}

const n = (x: number) => x.toLocaleString('en-US');

export function buildReport(args: {
  runId: string;
  feature: Feature;
  project: Project;
  status: AgentStatus;
  self: AgentSelfReport;
  changes: Changes;
  usage: Usage;
  estimatedCostUsd: number | null;
  reportedCostUsd: number | null;
  durationMs: number | null;
  model: string | null;
  error: string | null;
}): Report {
  const { feature, project, self, changes, usage } = args;
  const lines: string[] = [];
  lines.push(`# Implementation report: ${feature.title}`);
  lines.push('');
  lines.push(`- **Project:** ${project.name}`);
  lines.push(`- **Status:** ${args.status}`);
  lines.push(`- **Generated:** ${new Date().toISOString()}`);
  if (args.error) lines.push(`- **Error:** ${args.error}`);
  lines.push('');

  lines.push('## 1. Summary');
  lines.push(self.summary || '_The agent did not provide a summary._');
  lines.push('');

  lines.push('## 2. Implementation details');
  lines.push(self.implementationDetails || '_Not reported._');
  lines.push('');

  lines.push('## 3. Files changed');
  if (changes.files.length === 0) lines.push('_No file changes detected._');
  for (const kind of ['created', 'modified', 'deleted', 'renamed'] as const) {
    const files = changes.files.filter((f) => f.change === kind);
    if (!files.length) continue;
    lines.push(`**${kind[0].toUpperCase() + kind.slice(1)} (${files.length})**`);
    for (const f of files) lines.push(`- \`${f.path}\`${f.committed ? '' : ' _(uncommitted)_'}`);
  }
  if (changes.hasUncommittedChanges) {
    lines.push('');
    lines.push('> ⚠️ The worktree contains uncommitted changes.');
  }
  lines.push('');

  lines.push('## 4. Testing results');
  if (!self.reported) {
    lines.push('_The agent did not report structured test results._');
  } else {
    const t = self.tests;
    lines.push(`- **Passed:** ${t.passed ?? 'n/a'}`);
    lines.push(`- **Failed:** ${t.failed ?? 'n/a'}`);
    lines.push(`- **Executed:** ${t.executed.length ? t.executed.map((e) => `\`${e}\``).join(', ') : 'none'}`);
    if (t.notRun.length) lines.push(`- **Not executed:** ${t.notRun.join('; ')}`);
    if (t.output) {
      lines.push('');
      lines.push('```text');
      lines.push(t.output.slice(0, 6000));
      lines.push('```');
    }
  }
  lines.push('');

  lines.push('## 5. Build status');
  lines.push(`**${self.build.status}**`);
  if (self.build.output) {
    lines.push('');
    lines.push('```text');
    lines.push(self.build.output.slice(0, 6000));
    lines.push('```');
  }
  lines.push('');

  lines.push('## 6. Outstanding issues');
  if (self.outstandingIssues.length) for (const i of self.outstandingIssues) lines.push(`- ${i}`);
  else lines.push(self.reported ? '_None reported._' : '_Not reported._');
  lines.push('');

  lines.push('## 7. Git information');
  lines.push(`- **Branch:** \`${changes.branch ?? 'n/a'}\` (base \`${changes.baseBranch}\`)`);
  lines.push(`- **Head commit:** \`${changes.headCommit ?? 'n/a'}\``);
  lines.push(`- **Worktree:** \`${changes.worktreePath ?? 'n/a'}\``);
  if (changes.commits.length) {
    lines.push('- **Commits:**');
    for (const c of changes.commits) lines.push(`  - \`${c.hash.slice(0, 8)}\` ${c.subject}`);
  } else {
    lines.push('- **Commits:** none on top of the base branch');
  }
  lines.push('- Branches are never merged automatically.');
  lines.push('');

  lines.push('## 8. Agent usage');
  lines.push(`- **Model:** ${args.model ?? 'unknown'}`);
  lines.push(`- **Duration:** ${fmtDuration(args.durationMs)}`);
  lines.push(`- **Input tokens:** ${n(usage.inputTokens)}`);
  lines.push(`- **Output tokens:** ${n(usage.outputTokens)}`);
  lines.push(`- **Cache creation tokens:** ${n(usage.cacheCreationTokens)}`);
  lines.push(`- **Cache read tokens:** ${n(usage.cacheReadTokens)}`);
  lines.push(
    `- **Total reported tokens:** ${n(usage.inputTokens + usage.outputTokens + usage.cacheCreationTokens + usage.cacheReadTokens)}`,
  );
  lines.push(`- **Estimated cost (orchestrator pricing table):** ${args.estimatedCostUsd !== null ? `$${args.estimatedCostUsd.toFixed(4)}` : 'n/a'}`);
  lines.push(`- **Estimated cost (reported by Claude Code):** ${args.reportedCostUsd !== null ? `$${args.reportedCostUsd.toFixed(4)}` : 'n/a'}`);
  lines.push('');
  lines.push('> Costs are estimates based on public API list prices. They are not actual charges — Claude subscription plans are not billed per token.');

  return {
    runId: args.runId,
    featureId: feature.id,
    generatedAt: new Date().toISOString(),
    status: args.status,
    self,
    changes,
    usage,
    estimatedCostUsd: args.estimatedCostUsd,
    reportedCostUsd: args.reportedCostUsd,
    durationMs: args.durationMs,
    model: args.model,
    markdown: lines.join('\n'),
  };
}
