import path from 'node:path';
import { getDb, newId, now } from './db.ts';
import { bus } from './events.ts';
import { expandHome, validateRepoPath } from './git.ts';
import { getSettings } from './settings.ts';
import { CLAUDE_ROLES, type PipelineConfig, type Project, type RolesConfig } from '../../shared/types.ts';

export const DEFAULT_PIPELINE: PipelineConfig = {
  plan: true,
  planApproval: true,
  validate: true,
  validationCommands: [],
  tester: true,
  reviewer: false,
  finalApproval: false,
  maxFixLoops: 2,
  autoCreatePr: false,
  prDraft: true,
  remote: 'origin',
  autoStart: null,
};

/** Merge a (partial, possibly untrusted) pipeline config over a base config. */
export function cleanPipeline(input: unknown, base: PipelineConfig = DEFAULT_PIPELINE): PipelineConfig {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const bool = (k: keyof PipelineConfig) => (typeof v[k] === 'boolean' ? (v[k] as boolean) : (base[k] as boolean));
  const loops = Number(v.maxFixLoops);
  return {
    plan: bool('plan'),
    planApproval: bool('planApproval'),
    validate: bool('validate'),
    validationCommands: Array.isArray(v.validationCommands)
      ? v.validationCommands.map((c) => String(c).trim()).filter(Boolean).slice(0, 20)
      : base.validationCommands,
    tester: bool('tester'),
    reviewer: bool('reviewer'),
    finalApproval: bool('finalApproval'),
    maxFixLoops: Number.isFinite(loops) && v.maxFixLoops !== undefined && v.maxFixLoops !== null ? Math.max(0, Math.min(5, Math.floor(loops))) : base.maxFixLoops,
    autoCreatePr: bool('autoCreatePr'),
    prDraft: bool('prDraft'),
    remote: typeof v.remote === 'string' && /^[\w.-]+$/.test(v.remote.trim()) ? v.remote.trim() : base.remote,
    autoStart: v.autoStart === null || typeof v.autoStart === 'boolean' ? (v.autoStart as boolean | null) : (base.autoStart ?? null),
  };
}

/** Whether moving a card into Build starts its agent: the project override, else the global setting. */
export function autoStartFor(project: Project): boolean {
  return project.pipeline.autoStart ?? getSettings().autoStartBuild;
}

export function cleanRoles(input: unknown, base: RolesConfig = {}): RolesConfig {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
  const out: RolesConfig = { ...base };
  for (const role of CLAUDE_ROLES) {
    if (!(role in v)) continue;
    const r = v[role] ?? {};
    out[role] = { model: typeof r.model === 'string' ? r.model.trim() : '', effort: cleanEffort(r.effort, '') };
  }
  return out;
}

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
    mcpServers: cleanNames(safeJsonArray(r.mcp_servers_json)),
    skills: cleanNames(safeJsonArray(r.skills_json)),
    pipeline: cleanPipeline(safeJson(r.pipeline_json)),
    roles: cleanRoles(safeJson(r.roles_json)),
    createdAt: r.created_at,
  };
}

function safeJson(s: string | null | undefined): unknown {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

function safeJsonArray(s: string | null | undefined): unknown {
  try {
    return s ? JSON.parse(s) : [];
  } catch {
    return [];
  }
}

/** Sanitize a list of MCP server names / skill ids: strings, trimmed, deduped, at most 100. */
export function cleanNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => String(x ?? '').trim()).filter((x) => x && x.length <= 200))].slice(0, 100);
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
  mcpServers?: string[];
  skills?: string[];
  pipeline?: Partial<PipelineConfig>;
  roles?: RolesConfig;
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
    mcpServers: cleanNames(input.mcpServers),
    skills: cleanNames(input.skills),
    pipeline: cleanPipeline(input.pipeline),
    roles: cleanRoles(input.roles),
    createdAt: now(),
  };
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, description, path, base_branch, worktree_root, allowed_tools, model, agent_profile, effort, mcp_config, mcp_servers_json, skills_json, pipeline_json, roles_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      JSON.stringify(project.mcpServers),
      JSON.stringify(project.skills),
      JSON.stringify(project.pipeline),
      JSON.stringify(project.roles),
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
    mcpServers: input.mcpServers !== undefined ? cleanNames(input.mcpServers) : p.mcpServers,
    skills: input.skills !== undefined ? cleanNames(input.skills) : p.skills,
    pipeline: input.pipeline ? cleanPipeline(input.pipeline, p.pipeline) : p.pipeline,
    roles: input.roles ? cleanRoles(input.roles, p.roles) : p.roles,
  };
  getDb()
    .prepare(
      'UPDATE projects SET name=?, description=?, base_branch=?, worktree_root=?, allowed_tools=?, model=?, agent_profile=?, effort=?, mcp_config=?, mcp_servers_json=?, skills_json=?, pipeline_json=?, roles_json=? WHERE id=?',
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
      JSON.stringify(next.mcpServers),
      JSON.stringify(next.skills),
      JSON.stringify(next.pipeline),
      JSON.stringify(next.roles),
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
