# Data model: SQLite schema and shared types

Source files: `server/src/db.ts`, `server/src/runs.ts`, `shared/types.ts` (row mapping lives in `features.ts` and `projects.ts`; see [settings-projects-features.md](settings-projects-features.md))

## Engine and migrations (`server/src/db.ts`)

**Engine.**
- Built-in `node:sqlite` `DatabaseSync`, loaded via `createRequire(...)('node:sqlite')` (db.ts:8) so vitest and bundlers keep the `node:` prefix.
- On open it sets `PRAGMA journal_mode=WAL; foreign_keys=ON; busy_timeout=5000` (db.ts:131).

**Migrations** (db.ts:18-124):
- `MIGRATIONS` is an **append-only** array of SQL strings, versioned with `PRAGMA user_version`.
- `migrate()` (db.ts:136) runs each pending entry in BEGIN/COMMIT, then sets `user_version=i+1`, and rolls back on error.
- Current version: **5**. To change the schema, append a new entry, then update this doc.

**Helpers:**
- `getDb()` (db.ts:126) is a lazy singleton; `closeDb()` (db.ts:152) is for tests.
- `now()` returns an ISO string.
- `newId(prefix)` (db.ts:161) returns `<prefix>_<16 hex>`. Prefixes: `prj`, `ftr`, `run`.
- `tx(fn)` (db.ts:165) wraps `fn` in `BEGIN IMMEDIATE`.
- JSON columns are parsed defensively (`safeJson`, `safeJsonArray`).

## Schema (after migration 5)

**projects**

| Column | Notes | Added |
|---|---|---|
| `id` | PK | m1 |
| `name` | | m1 |
| `description` | default `''` | m1 |
| `path` | UNIQUE | m1 |
| `base_branch` | | m1 |
| `worktree_root` | | m1 |
| `allowed_tools` | JSON array | m1 |
| `model` | `''` = inherit | m1 |
| `created_at` | | m1 |
| `agent_profile` | `''` (inherit), `lean` or `full` | m3 |
| `effort` | | m3 |
| `mcp_config` | raw JSON or a path | m3 |
| `pipeline_json` | default `'{}'` | m4 |
| `roles_json` | default `'{}'` | m4 |
| `mcp_servers_json` | default `'[]'` | m5 |
| `skills_json` | default `'[]'` | m5 |

**features**

| Column | Notes | Added |
|---|---|---|
| `id` | PK | m1 |
| `project_id` | FK → projects, ON DELETE CASCADE | m1 |
| `title`, `description` | | m1 |
| `priority` | default `medium` | m1 |
| `status` | default `backlog` | m1 |
| `position` | REAL | m1 |
| `branch`, `worktree_path`, `session_id` | | m1 |
| `agent_status`, `current_run_id` | | m1 |
| `created_at`, `updated_at` | | m1 |
| `gate_json` | | m4 |
| `base_ref` | | m4 |
| `pr_url`, `pr_number` | | m4 |

Index: `features_project(project_id, status, position)`.

**runs**

| Column | Notes | Added |
|---|---|---|
| `id` | PK | m1 |
| `feature_id` | FK → features, CASCADE | m1 |
| `attempt` | per-feature counter across all cycles | m1 |
| `status`, `pid` | | m1 |
| `log_dir`, `log_offset` | | m1 |
| `started_at`, `ended_at` | | m1 |
| `exit_code`, `error` | | m1 |
| `progress`, `stage`, `current_activity` | | m1 |
| `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens` | | m1 |
| `model` | | m1 |
| `reported_cost_usd`, `estimated_cost_usd` | | m1 |
| `session_id`, `commit_hash` | | m1 |
| `report_json` | | m1 |
| `created_at` | | m1 |
| `cache_creation_1h_tokens` | | m2 |
| `kind` | default `feature` | m3 |
| `message` | | m3 |
| `turns`, `baseline_context_tokens`, `peak_context_tokens`, `permission_denials` | | m3 |
| `role` | default `developer` | m4 |
| `fix_reason` | | m4 |
| `cycle` | default 1 | m4 |
| `validation_json` | | m4 |

Index: `runs_feature(feature_id, attempt)`.

**Other tables**
- **run_events** (m1): `id` INTEGER PK AUTOINCREMENT, `run_id` FK cascade, `ts`, `kind`, `summary`, `detail`. Index `run_events_run(run_id, id)`.
- **settings** (m1): `key` PK, `value` (JSON-encoded).
- **feature_dependencies** (m4): `feature_id`, `depends_on_id` (both FK → features, cascade); PK is the pair; index on `depends_on_id`.

Deleting a project cascades to its features, runs, run_events and dependencies.

## Run data access (`server/src/runs.ts`)

- **`createRun`** (runs.ts:107):
  - `attempt` = the feature's max + 1.
  - `cycle` defaults to the latest cycle, or 1.
  - Initial status/stage `queued`, activity "Waiting for an execution slot".
  - Publishes `run.updated`.
- **`updateRun`** (runs.ts:163):
  - Maps camelCase fields to columns.
  - `usage`, `metrics`, `report` and `validation` expand to several columns or JSON.
  - Publishes `run.updated` unless `silent`.
- **Events:** `addEvent` (runs.ts:198) inserts into `run_events` and publishes `run.event`. `listEvents` (runs.ts:207) returns events with `id > after` (limit default 5000, max 20000).
- **`publicRun`** omits `logDir` and `logOffset`. It is used in API responses and in `feature.run`.
- `listCycleRuns` returns a cycle's runs ordered by `attempt`; the pipeline uses it.

## Key types (`shared/types.ts`)

**Versioning**
- `API_VERSION = 7` (line 7; 7 added `autoStartBuild`, `pipeline.autoStart` and `POST /features/:id/start`). Bump it when the backend and dashboard must change together.

**Status and role enums**
- `FeatureStatus` = `backlog | build | done`. This is the Kanban column.
- `AgentStatus` = `queued | initialising | running | completed | failed | cancelled`.
  - `ACTIVE_AGENT_STATUSES` = the first three (line 113).
- `AgentProfile` = `lean | full`.
- `Effort` = `low | medium | high | xhigh | max`. `''` means inherit.
- `RunKind`:

  | Kind | Meaning |
  |---|---|
  | `plan` | Planner, read-only |
  | `feature` | Developer implements |
  | `fix` | Developer, resumes its session |
  | `test` | Tester, fresh session |
  | `review` | Reviewer, read-only, fresh |
  | `validate` | Commands only, no agent |
  | `answer` | Resume after the user answers |
  | `followup` | New cycle |

- `AgentRole` = `planner | developer | tester | reviewer | validator`.
  - `ClaudeRole` excludes `validator`; `CLAUDE_ROLES` lists the four Claude roles.
- `FixReason` = `validation | review | user`.

**Configuration**
- `PipelineConfig` fields:
  - `plan`, `planApproval`
  - `validate`, `validationCommands` (`[]` means auto-detect)
  - `tester`, `reviewer`, `finalApproval`
  - `maxFixLoops` (per fix reason)
  - `autoCreatePr`, `prDraft`, `remote`
  - `autoStart: boolean | null` (`null` = use the global `Settings.autoStartBuild`)
- `RoleConfig {model, effort}` (`''` = inherit). `RolesConfig` = `Partial<Record<ClaudeRole, RoleConfig>>`.

**Gates and results**
- `GateType` = `plan_approval | clarification | final_approval`.
- `Gate {type, runId, openedAt, plan?, questions?, role?, note?}`.
- `ValidationResult {command, exitCode, durationMs, timedOut, output (tail)}`.
- `ReviewFinding {severity: blocker|major|minor|nit, file, line|null, message}`.
- `ReviewResult {verdict: approve|changes_requested, summary, findings}`.

**Entities**
- `Project`:
  - Identity: `id`, `name`, `description`, `path`, `createdAt`.
  - Git: `baseBranch`, `worktreeRoot`.
  - Agent config: `allowedTools`, `model`, `agentProfile`, `effort`, `mcpConfig`.
  - Capabilities and pipeline: `mcpServers[]`, `skills[]` (`source:name`), `pipeline`, `roles`.
- `Feature`:
  - Card: `id`, `projectId`, `title`, `description`, `priority`, `status`, `position`.
  - Git and session: `branch`, `worktreePath`, `sessionId`, `baseRef`, `prUrl`, `prNumber`.
  - Pipeline state: `agentStatus`, `currentRunId`, `gate`.
  - Dependencies: `dependsOn[]`, `blockedBy[]` (computed: dependencies not Done).
  - Joined extras: `totals? {runs, costUsd, newTokens}`, `run?` (the current run).
- `Run`:
  - Identity: `id`, `featureId`, `attempt`, `kind`, `role`, `cycle`, `fixReason`, `message`.
  - Process and progress: `status`, `pid`, `startedAt`, `endedAt`, `progress` (0-100 or null), `stage`, `currentActivity`.
  - Usage and cost: `usage`, `metrics`, `model`, `reportedCostUsd`, `estimatedCostUsd`.
  - Outcome: `validation`, `exitCode`, `error`, `sessionId`, `commitHash`, `createdAt`.
- `ProgressStage` = `queued`, `initialising`, `planning`, `implementing`, `testing`, `finalizing`, `validating`, `reviewing`, `reporting`, `done`.
- `Usage {inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, cacheCreation1hTokens?}`.
- `RunMetrics {turns, baselineContextTokens, peakContextTokens, permissionDenials}`.
- `RunEventKind` = `lifecycle`, `system`, `text`, `tool_use`, `tool_result`, `warning`, `error`, `stderr`.

**Reports and changes**
- `Changes {branch, baseBranch, worktreePath, headCommit, commits, files: FileChange[], hasUncommittedChanges, worktreeExists}`.
- `AgentSelfReport {summary, implementationDetails, tests, build, outstandingIssues, docsUpdated, plan, needsClarification, review, reported}`.
- `Report {runId, featureId, generatedAt, status, self, changes, usage, estimatedCostUsd, reportedCostUsd, durationMs, model, metrics?, kind?, role?, markdown}`.
- Diff types: `DiffLine` (`context|add|del|meta`, `oldNo`, `newNo`), `DiffHunk`, `DiffFile` (`status`, `additions`, `deletions`, `binary`, `truncated`), `DiffResult {scope, base, files, truncated}`.

**Settings, integrations and messages**
- `Settings` (see [settings-projects-features.md](settings-projects-features.md)).
- `GithubStatus {configured, source: env|file|null, login}`.
- `AppNotification {id, title, body, level: info|success|attention|error, featureId, projectId, ts}`.
- Catalog types: `McpServerInfo` (scope `user|local|project|plugin|claude.ai`, `launchable`), `SkillInfo`, `Catalog`.
- `PathValidation`.
- `ServerMessage` (lines 430-438): see [api.md](api.md#websocket).

## Positions

- Card `position` is a REAL in steps of 1000; an empty column starts at 1000.
- Moving a card puts it at the bottom of the column, except **Done**, where it goes to the **top**.
- `reorderFeatures` rewrites positions to `(i+1)*1000`.
