import path from 'node:path';
import { getDb, newId, now } from './db.ts';
import { bus } from './events.ts';
import { expandHome, validateRepoPath } from './git.ts';
import type { Project } from '../../shared/types.ts';

export const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git add:*)',
  'Bash(git commit:*)',
  'Bash(git show:*)',
  'Bash(npm:*)',
  'Bash(npx:*)',
  'Bash(pnpm:*)',
  'Bash(yarn:*)',
  'Bash(node:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(head:*)',
  'Bash(tail:*)',
  'Bash(wc:*)',
  'Bash(grep:*)',
  'Bash(git branch:*)',
  'Bash(git rev-parse:*)',
  'Bash(mkdir:*)',
];

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function rowToProject(r: any): Project {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    path: r.path,
    baseBranch: r.base_branch,
    worktreeRoot: r.worktree_root,
    allowedTools: JSON.parse(r.allowed_tools),
    model: r.model,
    agentProfile: r.agent_profile ?? '',
    effort: r.effort ?? '',
    mcpConfig: r.mcp_config ?? '',
    createdAt: r.created_at,
  };
}

export function listProjects(): Project[] {
  return (getDb().prepare('SELECT * FROM projects ORDER BY created_at').all() as any[]).map(rowToProject);
}

export function getProject(id: string): Project {
  const r = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, 'Project not found');
  return rowToProject(r);
}

export interface ProjectInput {
  name?: string;
  description?: string;
  path?: string;
  baseBranch?: string;
  worktreeRoot?: string;
  allowedTools?: string[];
  model?: string;
  agentProfile?: string;
  effort?: string;
  mcpConfig?: string;
}

function cleanProfile(v: string | undefined, fallback: Project['agentProfile']): Project['agentProfile'] {
  if (v === undefined) return fallback;
  return v === 'lean' || v === 'full' ? v : '';
}
function cleanEffort(v: string | undefined, fallback: Project['effort']): Project['effort'] {
  if (v === undefined) return fallback;
  return (['low', 'medium', 'high', 'xhigh', 'max'] as const).includes(v as any) ? (v as Project['effort']) : '';
}

export async function createProject(input: ProjectInput): Promise<Project> {
  if (!input.path) throw new HttpError(400, 'path is required');
  const v = await validateRepoPath(input.path);
  if (!v.isGitRepo || !v.isWorktreeRoot || v.branches.length === 0) throw new HttpError(400, v.error || 'Invalid repository');
  const repoPath = path.resolve(expandHome(input.path.trim()));
  const existing = getDb().prepare('SELECT id FROM projects WHERE path = ?').get(repoPath);
  if (existing) throw new HttpError(409, 'This repository is already registered');
  const baseBranch = input.baseBranch || v.currentBranch || v.branches[0];
  if (!v.branches.includes(baseBranch)) throw new HttpError(400, `Base branch "${baseBranch}" does not exist`);
  const project: Project = {
    id: newId('prj'),
    name: input.name?.trim() || v.suggestedName,
    description: input.description ?? '',
    path: repoPath,
    baseBranch,
    worktreeRoot: input.worktreeRoot?.trim() ? path.resolve(expandHome(input.worktreeRoot.trim())) : v.suggestedWorktreeRoot,
    allowedTools: input.allowedTools?.length ? input.allowedTools : DEFAULT_ALLOWED_TOOLS,
    model: input.model ?? '',
    agentProfile: cleanProfile(input.agentProfile, ''),
    effort: cleanEffort(input.effort, ''),
    mcpConfig: input.mcpConfig ?? '',
    createdAt: now(),
  };
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, description, path, base_branch, worktree_root, allowed_tools, model, agent_profile, effort, mcp_config, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      project.id,
      project.name,
      project.description,
      project.path,
      project.baseBranch,
      project.worktreeRoot,
      JSON.stringify(project.allowedTools),
      project.model,
      project.agentProfile,
      project.effort,
      project.mcpConfig,
      project.createdAt,
    );
  bus.publish({ type: 'project.updated', project });
  return project;
}

export async function updateProject(id: string, input: ProjectInput): Promise<Project> {
  const p = getProject(id);
  if (input.path && path.resolve(expandHome(input.path)) !== p.path) {
    throw new HttpError(400, 'The repository path cannot be changed; remove and re-add the project instead');
  }
  if (input.baseBranch && input.baseBranch !== p.baseBranch) {
    const v = await validateRepoPath(p.path);
    if (!v.branches.includes(input.baseBranch)) throw new HttpError(400, `Base branch "${input.baseBranch}" does not exist`);
  }
  const next: Project = {
    ...p,
    name: input.name?.trim() || p.name,
    description: input.description ?? p.description,
    baseBranch: input.baseBranch || p.baseBranch,
    worktreeRoot: input.worktreeRoot?.trim() ? path.resolve(expandHome(input.worktreeRoot.trim())) : p.worktreeRoot,
    allowedTools: input.allowedTools ? input.allowedTools.map((t) => t.trim()).filter(Boolean) : p.allowedTools,
    model: input.model ?? p.model,
    agentProfile: cleanProfile(input.agentProfile, p.agentProfile),
    effort: cleanEffort(input.effort, p.effort),
    mcpConfig: input.mcpConfig ?? p.mcpConfig,
  };
  getDb()
    .prepare(
      'UPDATE projects SET name=?, description=?, base_branch=?, worktree_root=?, allowed_tools=?, model=?, agent_profile=?, effort=?, mcp_config=? WHERE id=?',
    )
    .run(
      next.name,
      next.description,
      next.baseBranch,
      next.worktreeRoot,
      JSON.stringify(next.allowedTools),
      next.model,
      next.agentProfile,
      next.effort,
      next.mcpConfig,
      id,
    );
  bus.publish({ type: 'project.updated', project: next });
  return next;
}

/** Removes the project from the dashboard only. Source code and worktrees on disk are untouched. */
export function deleteProject(id: string) {
  getProject(id);
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
  bus.publish({ type: 'project.deleted', projectId: id });
}
