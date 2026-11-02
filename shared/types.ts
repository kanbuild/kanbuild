// Types shared between the backend and the frontend.

export type Priority = 'low' | 'medium' | 'high';
export type FeatureStatus = 'backlog' | 'build' | 'done';
export type AgentStatus =
  | 'queued'
  | 'initialising'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export const ACTIVE_AGENT_STATUSES: AgentStatus[] = ['queued', 'initialising', 'running'];

export interface Project {
  id: string;
  name: string;
  description: string;
  path: string;
  baseBranch: string;
  worktreeRoot: string;
  /** Tools passed to `claude --allowedTools`. */
  allowedTools: string[];
  /** Optional model override (e.g. "sonnet", "opus"). Empty = Claude Code default. */
  model: string;
  createdAt: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface Feature {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: Priority;
  status: FeatureStatus;
  position: number;
  branch: string | null;
  worktreePath: string | null;
  sessionId: string | null;
  agentStatus: AgentStatus | null;
  currentRunId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Snapshot of the current run, joined in by the API for card display. */
  run?: Run | null;
}

export type ProgressStage =
  | 'queued'
  | 'initialising'
  | 'planning'
  | 'implementing'
  | 'testing'
  | 'finalizing'
  | 'reporting'
  | 'done';

export interface Run {
  id: string;
  featureId: string;
  attempt: number;
  status: AgentStatus;
  pid: number | null;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  error: string | null;
  /** 0-100, or null when progress cannot be meaningfully determined. */
  progress: number | null;
  stage: ProgressStage | null;
  currentActivity: string | null;
  usage: Usage;
  model: string | null;
  /** Cost reported by Claude Code itself (total_cost_usd), still an estimate. */
  reportedCostUsd: number | null;
  /** Cost computed by the orchestrator from token usage and the pricing table. */
  estimatedCostUsd: number | null;
  sessionId: string | null;
  commitHash: string | null;
  createdAt: string;
}

export type RunEventKind =
  | 'lifecycle'
  | 'system'
  | 'text'
  | 'tool_use'
  | 'tool_result'
  | 'warning'
  | 'error'
  | 'stderr';

export interface RunEvent {
  id: number;
  runId: string;
  ts: string;
  kind: RunEventKind;
  summary: string;
  detail: string | null;
}

export interface FileChange {
  path: string;
  change: 'created' | 'modified' | 'deleted' | 'renamed';
  committed: boolean;
}

export interface CommitInfo {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface Changes {
  branch: string | null;
  baseBranch: string;
  worktreePath: string | null;
  headCommit: string | null;
  commits: CommitInfo[];
  files: FileChange[];
  hasUncommittedChanges: boolean;
  worktreeExists: boolean;
}

export interface TestResults {
  executed: string[];
  passed: number | null;
  failed: number | null;
  notRun: string[];
  output: string;
}

export interface BuildResult {
  status: 'passed' | 'failed' | 'not_run' | 'unknown';
  output: string;
}

/** Structured self-report the agent emits at the end of its run. */
export interface AgentSelfReport {
  summary: string;
  implementationDetails: string;
  tests: TestResults;
  build: BuildResult;
  outstandingIssues: string[];
  reported: boolean;
}

export interface Report {
  runId: string;
  featureId: string;
  generatedAt: string;
  status: AgentStatus;
  self: AgentSelfReport;
  changes: Changes;
  usage: Usage;
  estimatedCostUsd: number | null;
  reportedCostUsd: number | null;
  durationMs: number | null;
  model: string | null;
  markdown: string;
}

export interface Settings {
  concurrency: number;
  defaultModel: string;
  editorCommand: string;
  claudeBinary: string;
}

export interface PathValidation {
  exists: boolean;
  isGitRepo: boolean;
  isWorktreeRoot: boolean;
  branches: string[];
  currentBranch: string | null;
  suggestedName: string;
  suggestedWorktreeRoot: string;
  error?: string;
}

export type ServerMessage =
  | { type: 'feature.updated'; feature: Feature }
  | { type: 'feature.deleted'; featureId: string; projectId: string }
  | { type: 'run.updated'; run: Run }
  | { type: 'run.event'; event: RunEvent }
  | { type: 'project.updated'; project: Project }
  | { type: 'project.deleted'; projectId: string }
  | { type: 'settings.updated'; settings: Settings };
