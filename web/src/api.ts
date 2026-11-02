import type { Changes, Feature, FeatureStatus, PathValidation, Priority, Project, Report, Run, RunEvent, Settings } from '@shared/types.ts';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) {
    super(message);
  }
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText, data);
  return data as T;
}

export type SettingsResponse = Settings & {
  defaultAllowedTools: string[];
  editorPresets: { id: string; label: string }[];
  platform: string;
};

export interface SessionInfo {
  sessionId: string | null;
  worktreePath: string | null;
  worktreeExists: boolean;
  command: string | null;
  canOpenTerminal: boolean;
}

export interface LaunchPreview {
  config: { profile: string; effort: string | null; model: string | null; maxBudgetUsd: number | null; mcpConfig: string | null };
  command: string;
  prompt: string;
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

export const api = {
  settings: () => req<SettingsResponse>('GET', '/settings'),
  updateSettings: (s: Partial<Settings>) => req<Settings>('PUT', '/settings', s),

  projects: () => req<Project[]>('GET', '/projects'),
  validatePath: (path: string) => req<PathValidation>('POST', '/projects/validate', { path }),
  createProject: (p: ProjectInput) => req<Project>('POST', '/projects', p),
  updateProject: (id: string, p: ProjectInput) => req<Project>('PATCH', `/projects/${id}`, p),
  deleteProject: (id: string) => req<{ ok: boolean }>('DELETE', `/projects/${id}`),

  features: (projectId: string) => req<Feature[]>('GET', `/projects/${projectId}/features`),
  createFeature: (projectId: string, f: { title: string; description: string; priority: Priority }) =>
    req<Feature>('POST', `/projects/${projectId}/features`, f),
  updateFeature: (id: string, f: Partial<{ title: string; description: string; priority: Priority; status: FeatureStatus; position: number; confirmCancel: boolean }>) =>
    req<Feature>('PATCH', `/features/${id}`, f),
  deleteFeature: (id: string, confirmCancel = false) => req<{ ok: boolean }>('DELETE', `/features/${id}?confirmCancel=${confirmCancel}`),
  reorder: (projectId: string, status: FeatureStatus, ids: string[]) => req('POST', `/projects/${projectId}/reorder`, { status, ids }),
  cancel: (id: string) => req<Feature>('POST', `/features/${id}/cancel`),
  retry: (id: string) => req<Feature>('POST', `/features/${id}/retry`),
  openEditor: (id: string) => req<{ ok: boolean; via: string }>('POST', `/features/${id}/open`, {}),
  reveal: (id: string) => req<{ ok: boolean }>('POST', `/features/${id}/reveal`, {}),
  session: (id: string) => req<SessionInfo>('GET', `/features/${id}/session`),
  openTerminal: (id: string) => req<{ ok: boolean }>('POST', `/features/${id}/open-terminal`, {}),
  followUp: (id: string, message: string) => req<Feature>('POST', `/features/${id}/followup`, { message }),
  launchPreview: (projectId: string) => req<LaunchPreview>('GET', `/projects/${projectId}/launch-preview`),
  removeWorktree: (id: string, force = false) => req<{ ok: boolean; note: string }>('DELETE', `/features/${id}/worktree?force=${force}`),
  runs: (featureId: string) => req<Run[]>('GET', `/features/${featureId}/runs`),
  changes: (featureId: string) => req<Changes>('GET', `/features/${featureId}/changes`),

  events: (runId: string, after = 0) => req<RunEvent[]>('GET', `/runs/${runId}/events?after=${after}`),
  report: (runId: string) => req<Report>('GET', `/runs/${runId}/report`),
};
