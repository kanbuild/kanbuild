import express, { type NextFunction, type Request, type Response } from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import {
  createFeature,
  deleteFeature,
  getFeature,
  listFeatures,
  moveFeature,
  patchFeatureState,
  reorderFeatures,
  updateFeatureFields,
} from '../features.ts';
import { collectChanges, isWorktreeDirty, removeWorktree, validateRepoPath } from '../git.ts';
import { orchestrator } from '../orchestrator.ts';
import { DEFAULT_ALLOWED_TOOLS, HttpError, createProject, deleteProject, getProject, listProjects, updateProject } from '../projects.ts';
import { getReport, getRun, listEvents, listRunsForFeature, publicRun } from '../runs.ts';
import { getSettings, updateSettings } from '../settings.ts';
import { ACTIVE_AGENT_STATUSES, type FeatureStatus } from '../../../shared/types.ts';

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve()
    .then(() => fn(req, res))
    .then((out) => {
      if (!res.headersSent) res.json(out ?? { ok: true });
    })
    .catch(next);
};

function isActive(featureId: string) {
  const f = getFeature(featureId);
  return !!f.agentStatus && ACTIVE_AGENT_STATUSES.includes(f.agentStatus);
}

export const api = express.Router();

// ---- Settings ----
api.get('/settings', h(() => ({ ...getSettings(), defaultAllowedTools: DEFAULT_ALLOWED_TOOLS })));
api.put('/settings', h((req) => {
  const s = updateSettings(req.body ?? {});
  orchestrator.tick(); // concurrency may have increased
  return s;
}));

// ---- Projects ----
api.get('/projects', h(() => listProjects()));
api.post('/projects/validate', h((req) => validateRepoPath(String(req.body?.path ?? ''))));
api.post('/projects', h((req) => createProject(req.body ?? {})));
api.get('/projects/:id', h((req) => getProject(req.params.id)));
api.patch('/projects/:id', h((req) => updateProject(req.params.id, req.body ?? {})));
api.delete('/projects/:id', h(async (req) => {
  const features = listFeatures(req.params.id);
  if (features.some((f) => f.agentStatus && ACTIVE_AGENT_STATUSES.includes(f.agentStatus))) {
    throw new HttpError(409, 'Cancel running agents before removing this project');
  }
  deleteProject(req.params.id);
  return { ok: true, note: 'Project removed from the dashboard. Source code and worktrees were not touched.' };
}));

// ---- Features ----
api.get('/projects/:id/features', h((req) => listFeatures(req.params.id)));
api.post('/projects/:id/features', h((req) => createFeature(req.params.id, req.body ?? {})));
api.post('/projects/:id/reorder', h((req) => {
  const { status, ids } = req.body ?? {};
  if (!Array.isArray(ids)) throw new HttpError(400, 'ids must be an array');
  reorderFeatures(req.params.id, status as FeatureStatus, ids);
  return { ok: true };
}));

api.get('/features/:id', h((req) => getFeature(req.params.id)));

/**
 * Update fields and/or move between columns.
 * Moving into Build triggers an agent; moving an active card out of Build requires confirmCancel.
 */
api.patch('/features/:id', h(async (req) => {
  const id = req.params.id;
  const { title, description, priority, status, position, confirmCancel } = req.body ?? {};
  let feature = getFeature(id);
  if (title !== undefined || description !== undefined || priority !== undefined) {
    feature = updateFeatureFields(id, { title, description, priority });
  }
  if (status && status !== feature.status) {
    if (status === 'build') {
      feature = orchestrator.enqueue(id);
    } else {
      if (isActive(id)) {
        if (!confirmCancel) throw new HttpError(409, 'An agent is working on this feature. Confirm to cancel it.');
        await orchestrator.cancel(id);
      }
      feature = moveFeature(id, status, typeof position === 'number' ? position : undefined);
    }
  }
  if (typeof position === 'number' && feature.position !== position) {
    feature = patchFeatureState(id, { position });
  }
  return getFeature(id);
}));

api.delete('/features/:id', h(async (req) => {
  if (isActive(req.params.id)) {
    if (req.query.confirmCancel !== 'true') throw new HttpError(409, 'An agent is working on this feature. Confirm to cancel it.');
    await orchestrator.cancel(req.params.id);
  }
  deleteFeature(req.params.id);
  return { ok: true, note: 'Feature removed. Its branch and worktree (if any) were kept on disk.' };
}));

api.post('/features/:id/cancel', h((req) => orchestrator.cancel(req.params.id)));
api.post('/features/:id/retry', h((req) => orchestrator.retry(req.params.id)));
api.get('/features/:id/runs', h((req) => listRunsForFeature(req.params.id)));

api.get('/features/:id/changes', h(async (req) => {
  const f = getFeature(req.params.id);
  const p = getProject(f.projectId);
  return collectChanges(f.worktreePath, f.branch, p.baseBranch);
}));

api.post('/features/:id/open', h((req) => {
  const f = getFeature(req.params.id);
  if (!f.worktreePath || !fs.existsSync(f.worktreePath)) throw new HttpError(404, 'Worktree does not exist');
  const cmd = String(req.body?.editor || getSettings().editorCommand || 'code');
  const [bin, ...args] = cmd.split(/\s+/).filter(Boolean);
  const child = spawn(bin, [...args, f.worktreePath], { detached: true, stdio: 'ignore' });
  return new Promise((resolve, reject) => {
    child.once('error', (e) => reject(new HttpError(500, `Could not launch "${cmd}": ${e.message}`)));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, path: f.worktreePath });
    });
  });
}));

/** Remove a worktree. Refuses when it has uncommitted changes unless force=true (explicit confirmation). */
api.delete('/features/:id/worktree', h(async (req, res) => {
  const f = getFeature(req.params.id);
  if (isActive(f.id)) throw new HttpError(409, 'Cannot remove the worktree while an agent is running');
  if (!f.worktreePath) throw new HttpError(404, 'Feature has no worktree');
  const project = getProject(f.projectId);
  const force = req.query.force === 'true';
  if (fs.existsSync(f.worktreePath) && !force && (await isWorktreeDirty(f.worktreePath))) {
    res.status(409).json({ error: 'Worktree has uncommitted changes. Confirm to delete them permanently.', dirty: true });
    return;
  }
  await removeWorktree(project.path, f.worktreePath, force);
  patchFeatureState(f.id, { worktreePath: null });
  return { ok: true, note: `Worktree removed. Branch ${f.branch} was kept.` };
}));

// ---- Runs ----
api.get('/runs/:id', h((req) => {
  const r = getRun(req.params.id);
  if (!r) throw new HttpError(404, 'Run not found');
  return publicRun(r);
}));
api.get('/runs/:id/events', h((req) => listEvents(req.params.id, Number(req.query.after ?? 0), Math.min(Number(req.query.limit ?? 5000), 20000))));
api.get('/runs/:id/report', h((req) => {
  const report = getReport(req.params.id);
  if (!report) throw new HttpError(404, 'No report for this run yet');
  return report;
}));

api.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error('[api]', err);
  res.status(status).json({ error: err.message || 'Internal error' });
});
