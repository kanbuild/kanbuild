import { getDb, newId, now } from './db.ts';
import { bus } from './events.ts';
import type { AgentStatus, ProgressStage, Report, Run, RunEvent, RunEventKind, RunKind, RunMetrics, Usage } from '../../shared/types.ts';

export interface RunRow extends Run {
  logDir: string | null;
  logOffset: number;
}

export function rowToRun(r: any): RunRow {
  return {
    id: r.id,
    featureId: r.feature_id,
    attempt: r.attempt,
    kind: r.kind ?? 'feature',
    message: r.message ?? null,
    metrics: {
      turns: r.turns ?? 0,
      baselineContextTokens: r.baseline_context_tokens ?? 0,
      peakContextTokens: r.peak_context_tokens ?? 0,
      permissionDenials: r.permission_denials ?? 0,
    },
    status: r.status,
    pid: r.pid,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    exitCode: r.exit_code,
    error: r.error,
    progress: r.progress,
    stage: r.stage,
    currentActivity: r.current_activity,
    usage: {
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheCreationTokens: r.cache_creation_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheCreation1hTokens: r.cache_creation_1h_tokens,
    },
    model: r.model,
    reportedCostUsd: r.reported_cost_usd,
    estimatedCostUsd: r.estimated_cost_usd,
    sessionId: r.session_id,
    commitHash: r.commit_hash,
    createdAt: r.created_at,
    logDir: r.log_dir,
    logOffset: r.log_offset,
  };
}

export function publicRun(r: RunRow): Run {
  const { logDir: _l, logOffset: _o, ...rest } = r;
  return rest;
}

export function getRun(id: string): RunRow | null {
  const r = getDb().prepare('SELECT * FROM runs WHERE id = ?').get(id);
  return r ? rowToRun(r) : null;
}

export function listRunsForFeature(featureId: string): Run[] {
  return (getDb().prepare('SELECT * FROM runs WHERE feature_id = ? ORDER BY attempt DESC').all(featureId) as any[]).map((r) =>
    publicRun(rowToRun(r)),
  );
}

export function listRunsByStatus(statuses: AgentStatus[]): RunRow[] {
  const q = `SELECT * FROM runs WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at`;
  return (getDb().prepare(q).all(...statuses) as any[]).map(rowToRun);
}

export function createRun(featureId: string, kind: RunKind = 'feature', message: string | null = null): RunRow {
  const d = getDb();
  const prev = d.prepare('SELECT MAX(attempt) AS a FROM runs WHERE feature_id = ?').get(featureId) as { a: number | null };
  const id = newId('run');
  d.prepare(
    `INSERT INTO runs (id, feature_id, attempt, kind, message, status, stage, current_activity, created_at)
     VALUES (?, ?, ?, ?, ?, 'queued', 'queued', 'Waiting for an execution slot', ?)`,
  ).run(id, featureId, (prev.a ?? 0) + 1, kind, message, now());
  const run = getRun(id)!;
  bus.publish({ type: 'run.updated', run: publicRun(run) });
  return run;
}

export interface RunPatch {
  status?: AgentStatus;
  pid?: number | null;
  logDir?: string;
  logOffset?: number;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number | null;
  error?: string | null;
  progress?: number | null;
  stage?: ProgressStage | null;
  currentActivity?: string | null;
  usage?: Usage;
  metrics?: RunMetrics;
  model?: string | null;
  reportedCostUsd?: number | null;
  estimatedCostUsd?: number | null;
  sessionId?: string | null;
  commitHash?: string | null;
  report?: Report;
}

const COLS: Record<string, string> = {
  status: 'status',
  pid: 'pid',
  logDir: 'log_dir',
  logOffset: 'log_offset',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  exitCode: 'exit_code',
  error: 'error',
  progress: 'progress',
  stage: 'stage',
  currentActivity: 'current_activity',
  model: 'model',
  reportedCostUsd: 'reported_cost_usd',
  estimatedCostUsd: 'estimated_cost_usd',
  sessionId: 'session_id',
  commitHash: 'commit_hash',
};

export function updateRun(id: string, patch: RunPatch, opts: { silent?: boolean } = {}): RunRow {
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === 'usage') {
      const u = v as Usage;
      sets.push('input_tokens=?', 'output_tokens=?', 'cache_creation_tokens=?', 'cache_read_tokens=?', 'cache_creation_1h_tokens=?');
      vals.push(u.inputTokens, u.outputTokens, u.cacheCreationTokens, u.cacheReadTokens, u.cacheCreation1hTokens ?? 0);
    } else if (k === 'metrics') {
      const m = v as RunMetrics;
      sets.push('turns=?', 'baseline_context_tokens=?', 'peak_context_tokens=?', 'permission_denials=?');
      vals.push(m.turns, m.baselineContextTokens, m.peakContextTokens, m.permissionDenials);
    } else if (k === 'report') {
      sets.push('report_json=?');
      vals.push(JSON.stringify(v));
    } else if (COLS[k]) {
      sets.push(`${COLS[k]}=?`);
      vals.push(v);
    }
  }
  if (sets.length) getDb().prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  const run = getRun(id)!;
  if (!opts.silent) bus.publish({ type: 'run.updated', run: publicRun(run) });
  return run;
}

export function getReport(runId: string): Report | null {
  const r = getDb().prepare('SELECT report_json FROM runs WHERE id = ?').get(runId) as { report_json: string | null } | undefined;
  return r?.report_json ? JSON.parse(r.report_json) : null;
}

export function addEvent(runId: string, kind: RunEventKind, summary: string, detail: string | null = null, ts = now()): RunEvent {
  const res = getDb()
    .prepare('INSERT INTO run_events (run_id, ts, kind, summary, detail) VALUES (?, ?, ?, ?, ?)')
    .run(runId, ts, kind, summary, detail);
  const event: RunEvent = { id: Number(res.lastInsertRowid), runId, ts, kind, summary, detail };
  bus.publish({ type: 'run.event', event });
  return event;
}

export function listEvents(runId: string, afterId = 0, limit = 2000): RunEvent[] {
  return (
    getDb()
      .prepare('SELECT id, run_id, ts, kind, summary, detail FROM run_events WHERE run_id = ? AND id > ? ORDER BY id LIMIT ?')
      .all(runId, afterId, limit) as any[]
  ).map((r) => ({ id: r.id, runId: r.run_id, ts: r.ts, kind: r.kind, summary: r.summary, detail: r.detail }));
}

export function newRunId() {
  return newId('run');
}
