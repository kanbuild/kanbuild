import { getDb, newId, now } from './db.ts';
import { bus } from './events.ts';
import { HttpError, getProject } from './projects.ts';
import { getRun, publicRun } from './runs.ts';
import type { AgentStatus, Feature, FeatureStatus, Priority } from '../../shared/types.ts';

const PRIORITIES: Priority[] = ['low', 'medium', 'high'];
const STATUSES: FeatureStatus[] = ['backlog', 'build', 'done'];

function rowToFeature(r: any): Feature {
  const f: Feature = {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    description: r.description,
    priority: r.priority,
    status: r.status,
    position: r.position,
    branch: r.branch,
    worktreePath: r.worktree_path,
    sessionId: r.session_id,
    agentStatus: r.agent_status,
    currentRunId: r.current_run_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  const run = f.currentRunId ? getRun(f.currentRunId) : null;
  f.run = run ? publicRun(run) : null;
  return f;
}

export function listFeatures(projectId: string): Feature[] {
  return (
    getDb().prepare('SELECT * FROM features WHERE project_id = ? ORDER BY status, position, created_at').all(projectId) as any[]
  ).map(rowToFeature);
}

export function getFeature(id: string): Feature {
  const r = getDb().prepare('SELECT * FROM features WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, 'Feature not found');
  return rowToFeature(r);
}

export function publishFeature(id: string) {
  try {
    bus.publish({ type: 'feature.updated', feature: getFeature(id) });
  } catch {
    /* deleted */
  }
}

function nextPosition(projectId: string, status: FeatureStatus, top = false): number {
  const r = getDb()
    .prepare(`SELECT ${top ? 'MIN' : 'MAX'}(position) AS p FROM features WHERE project_id = ? AND status = ?`)
    .get(projectId, status) as { p: number | null };
  if (r.p === null) return 1000;
  return top ? r.p - 1000 : r.p + 1000;
}

export interface FeatureInput {
  title?: string;
  description?: string;
  priority?: Priority;
}

export function createFeature(projectId: string, input: FeatureInput): Feature {
  getProject(projectId);
  const title = input.title?.trim();
  if (!title) throw new HttpError(400, 'title is required');
  const priority = input.priority && PRIORITIES.includes(input.priority) ? input.priority : 'medium';
  const id = newId('ftr');
  const ts = now();
  getDb()
    .prepare(
      `INSERT INTO features (id, project_id, title, description, priority, status, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'backlog', ?, ?, ?)`,
    )
    .run(id, projectId, title, input.description ?? '', priority, nextPosition(projectId, 'backlog'), ts, ts);
  publishFeature(id);
  return getFeature(id);
}

export function updateFeatureFields(id: string, input: FeatureInput): Feature {
  const f = getFeature(id);
  const title = input.title !== undefined ? input.title.trim() : f.title;
  if (!title) throw new HttpError(400, 'title cannot be empty');
  const priority = input.priority && PRIORITIES.includes(input.priority) ? input.priority : f.priority;
  getDb()
    .prepare('UPDATE features SET title=?, description=?, priority=?, updated_at=? WHERE id=?')
    .run(title, input.description ?? f.description, priority, now(), id);
  publishFeature(id);
  return getFeature(id);
}

export interface FeatureStatePatch {
  status?: FeatureStatus;
  position?: number;
  branch?: string | null;
  worktreePath?: string | null;
  sessionId?: string | null;
  agentStatus?: AgentStatus | null;
  currentRunId?: string | null;
}

const COLS: Record<keyof FeatureStatePatch, string> = {
  status: 'status',
  position: 'position',
  branch: 'branch',
  worktreePath: 'worktree_path',
  sessionId: 'session_id',
  agentStatus: 'agent_status',
  currentRunId: 'current_run_id',
};

export function patchFeatureState(id: string, patch: FeatureStatePatch, opts: { silent?: boolean } = {}): Feature {
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [k, v] of Object.entries(patch) as [keyof FeatureStatePatch, unknown][]) {
    if (v === undefined) continue;
    if (k === 'status' && !STATUSES.includes(v as FeatureStatus)) throw new HttpError(400, 'Invalid status');
    sets.push(`${COLS[k]}=?`);
    vals.push(v);
  }
  sets.push('updated_at=?');
  vals.push(now());
  getDb().prepare(`UPDATE features SET ${sets.join(', ')} WHERE id=?`).run(...vals, id);
  if (!opts.silent) publishFeature(id);
  return getFeature(id);
}

/** Move to a column; position defaults to the bottom (or top for Done so latest completions appear first). */
export function moveFeature(id: string, status: FeatureStatus, position?: number): Feature {
  const f = getFeature(id);
  const pos = position ?? (f.status === status ? f.position : nextPosition(f.projectId, status, status === 'done'));
  return patchFeatureState(id, { status, position: pos });
}

/** Reassign positions for an ordered list of feature ids within one column. */
export function reorderFeatures(projectId: string, status: FeatureStatus, orderedIds: string[]) {
  const stmt = getDb().prepare('UPDATE features SET position=? WHERE id=? AND project_id=? AND status=?');
  orderedIds.forEach((fid, i) => stmt.run((i + 1) * 1000, fid, projectId, status));
  for (const fid of orderedIds) publishFeature(fid);
}

/** Deletes the card (and its run history) only; branches and worktrees on disk are kept. */
export function deleteFeature(id: string) {
  const f = getFeature(id);
  getDb().prepare('DELETE FROM features WHERE id = ?').run(id);
  bus.publish({ type: 'feature.deleted', featureId: id, projectId: f.projectId });
}
