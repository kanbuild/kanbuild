# REST API and WebSocket

Source files: `server/src/routes/api.ts`, `server/src/terminal.ts`, `server/src/events.ts`, `server/src/index.ts` (guard and WS), `web/src/api.ts` (client)

All routes are mounted at `/api`.

**Handler conventions**
- Every handler is wrapped in `h()` (api.ts:34). It awaits the handler and responds with `res.json(out ?? {ok:true})`.
- The error middleware (api.ts:303) turns `HttpError(status,msg)` (projects.ts:82) into that status. Anything else is a 500, logged as `[api]`.
- The error body is always `{error}`, sometimes with extra fields (e.g. `dirty`).
- Requests must pass the localhost guard ([architecture.md](architecture.md#startup-sequence-serversrcindexts)). curl without an `Origin` header works.

## Settings and integrations

| Method + path | Body / behavior |
|---|---|
| `GET /settings` | `Settings` + `defaultAllowedTools`, `editorPresets [{id,label}]`, `platform`, `github` (status), `apiVersion` |
| `PUT /settings` | Partial `Settings`. Invalid keys are silently ignored. Then `orchestrator.tick()` |
| `GET /settings/github` | `verifyToken()` → `GithubStatus`; on a `GithubError` returns the status + `error` |
| `PUT /settings/github` | `{token}`. Validated via `GET /user` and stored with mode 0600. Empty string clears. `GithubError` → 400. The token is never returned |
| `POST /notifications/test` | Sends a test notification → `{ok, sent}` |
| `POST /catalog` | `{path, refresh?}` → MCP and skills `Catalog`. 400 if not a git repo |

## Projects

| Method + path | Body / behavior |
|---|---|
| `GET /projects` | Ordered by `created_at` |
| `POST /projects/validate` | `{path}` → `PathValidation` (exists, isGitRepo, isWorktreeRoot, branches, currentBranch, suggestedName, suggestedWorktreeRoot, error) |
| `POST /projects` | `ProjectInput`; `path` is required. Duplicate path → 409 |
| `GET /projects/:id` | |
| `PATCH /projects/:id` | Partial `ProjectInput`. Changing `path` → 400 |
| `DELETE /projects/:id` | 409 if any feature has an active agent. Removes dashboard records only; repo and worktrees are untouched |
| `GET /projects/:id/launch-preview` | `{config, command, prompt, roles:{planner,developer,tester,reviewer:{config,command,prompt}}}`. Built from a fake `ftr_preview` feature with `prepareCapabilities(write:false)` |
| `GET /projects/:id/files?q=&limit=` | `@`-file search (`files.ts`). `limit` is clamped to 1-100 (default 30) |
| `GET /projects/:id/validation-preview` | `{commands, source}` from `detectValidationCommands(project.path)` |
| `GET /projects/:id/features` | Lists features |
| `POST /projects/:id/features` | `{title, description?, priority?}`. Created in backlog |
| `POST /projects/:id/reorder` | `{status, ids[]}`. 400 if `ids` is not an array |

## Features

| Method + path | Body / behavior |
|---|---|
| `GET /features/:id` | |
| `PATCH /features/:id` | `{title?, description?, priority?, status?, position?, confirmCancel?}`. See status semantics below |
| `DELETE /features/:id?confirmCancel=true` | 409 if active and not confirmed. Cancels the agent, then deletes the card. Branch and worktree stay on disk |
| `PUT /features/:id/dependencies` | `{dependsOn: string[]}`. Rejects self, unknown IDs, cross-project features and cycles. Then `tick()` |
| `POST /features/:id/gate` | `{action: approve\|reject\|answer, comment?, answers?: string[]}` → `orchestrator.resolveGate` |
| `POST /features/:id/continue` | `orchestrator.continuePipeline` (re-derives the next step when paused) |
| `POST /features/:id/pr` | `createPrForFeature`: push the branch and open a PR, or reuse an existing one |
| `GET /features/:id/diff?scope=&file=` | `scope` = `all` (default), `committed`, `uncommitted` or `commit:<4-40 hex>`. 404 without a worktree. Base = `feature.baseRef \|\| project.baseBranch` |
| `POST /features/:id/cancel` | Cancel the agent or validation, or close an open gate |
| `POST /features/:id/start` | `orchestrator.startFeature`: start a new pipeline cycle now (the ▶ button). 409 if a run is active. Works from any column (the card moves to Build) |
| `POST /features/:id/retry` | Re-run the current step (same kind, role, message and cycle) |
| `GET /features/:id/runs` | Runs, newest attempt first |
| `GET /features/:id/changes` | `collectChanges(worktree, branch, base)` → `Changes` |
| `POST /features/:id/open` | `{editor?}` → `{ok, via}`. Opens the worktree in an editor. `EditorError` → 400 |
| `POST /features/:id/reveal` | Reveal the worktree in the file manager |
| `GET /features/:id/session` | `{sessionId, worktreePath, worktreeExists, command: "cd <wt> && claude --resume <sid>", canOpenTerminal (darwin only)}` |
| `POST /features/:id/open-terminal` | macOS Terminal with the resume command. 409 if the agent is active or there is no session |
| `POST /features/:id/followup` | `{message}`. Resumes the session with a new instruction (new cycle) |
| `DELETE /features/:id/worktree?force=true` | 409 if active or a Terminal command is running; 404 if there is no worktree. Dirty without `force` → 409 `{error, dirty:true}`. Removes the worktree and keeps the branch |

## Terminal (commands in a feature's worktree)

See [git-worktrees-validation.md](git-worktrees-validation.md#terminal-command-runner-terminalts). Sessions live in memory only.

| Method + path | Behavior |
|---|---|
| `GET /features/:id/terminal` | `TerminalState {sessions, cwd, root}`: sessions oldest first with buffered output (backfill), `cwd` = where the next command runs, `root` = the worktree (both null without a worktree) |
| `POST /features/:id/terminal` | `{command}` → `TerminalSession`. 400 if empty; 404 without a worktree; 409 while an agent is active or when 4 commands already run for this feature |
| `POST /terminal/:sid/stop` | SIGTERM the command's process group (SIGKILL after 3 s). 404 for an unknown session |
| `DELETE /features/:id/terminal` | Forgets finished sessions; returns the remaining (running) ones |
| `DELETE /features/:id/terminal/cwd` | Resets the feature's terminal directory to the worktree root → `{cwd}` |

### `PATCH /features/:id` status semantics (api.ts:159-183)

1. Field updates (title, description, priority) are applied first.
2. `status` → `build` (from another column): `orchestrator.enterBuild(id, position)`.
   - Auto-start on (`autoStartFor(project)`): `startFeature`. 409 if a run is active.
   - Auto-start off: the card moves to Build with `agentStatus: null` and no gate ("ready to start"), keeping `currentRunId`. No run is created until `POST /features/:id/start`.
3. `status` → another column:
   - If an agent is active, `confirmCancel` is required (409 otherwise); then `await cancel`.
   - Any open gate is cleared, the card is moved, and `tick()` runs so dependents can start.
4. A numeric `position` that differs from the current one is patched.

## Runs

| Method + path | Behavior |
|---|---|
| `GET /runs/:id` | `publicRun` (no `logDir`/`logOffset`); 404 if missing |
| `GET /runs/:id/events?after=&limit=` | Events with `id > after`; limit default 5000, max 20000 |
| `GET /runs/:id/report` | Parsed `report_json`; 404 until the run is finished |

## WebSocket

- **Path and direction:** `/ws`, server → client only. The first frame is `{type:'hello'}`; the client ignores it.
- **Not used:** SSE, and client → server messages.
- **Server side:** every message goes through `publish()` (events.ts) and must belong to the `ServerMessage` union (shared/types.ts:430-438).
- **Client side:** messages are handled in `web/src/store.ts` `handle()`.

| `type` | Payload | Emitted by |
|---|---|---|
| `feature.updated` | `{feature}` | `publishFeature` (features.ts:107): create, update, move, state patches |
| `feature.deleted` | `{featureId, projectId}` | features.ts:225 |
| `run.updated` | `{run}` | `createRun`, `updateRun` (unless `silent`), runs.ts:117,189 |
| `run.event` | `{event}` | `addEvent`, runs.ts:203 |
| `project.updated` | `{project}` | Project create/update |
| `project.deleted` | `{projectId}` | `deleteProject` |
| `settings.updated` | `{settings}` | `updateSettings` |
| `notification` | `{notification: AppNotification}` | notify.ts |
| `terminal.updated` | `{session: TerminalSession}` (full snapshot incl. output; on exit `endCwd` says where the shell ended) | terminal.ts: start and exit |
| `terminal.output` | `{sessionId, featureId, offset, chunk}`; `offset` = absolute char offset of `chunk`, so the client can dedupe against backfill | terminal.ts |

**Adding an endpoint:**
1. Add the route in `api.ts` inside `h()`.
2. Add the client function in `web/src/api.ts`.
3. Update this doc.
4. If the response shape changes in a way old dashboards can't handle, bump `API_VERSION`.
