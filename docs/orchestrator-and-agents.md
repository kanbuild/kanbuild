# Orchestrator, agent runner, launch flags and stream parsing

Source files: `server/src/orchestrator.ts`, `server/src/runner.ts`, `server/src/launch.ts`, `server/src/streamParser.ts`

Pipeline decision logic is in [pipeline.md](pipeline.md). Prompts are in [prompts-and-reports.md](prompts-and-reports.md).

## Orchestrator (`orchestrator.ts`, singleton `orchestrator`, line 822)

**In-memory state**
- `active: Map<runId, ActiveRun>`: log tail, cancel flag, kill/flush/stall timers, `lastOutputAt`.
- `validations: Map<runId, ValidationRun>`.
- `starting: Set` and a `ticking` guard against re-entrant ticks.
- **Correctness never depends on memory.** Everything is re-derivable from the DB.

**Constants**
- `CANCEL_MARK` (line 35).
- `STALL_WARNING_MS` (line 52, from `ORCH_STALL_WARNING_MS`, default 5 min).

### Scheduling: `tick()` (line 201)

- FIFO over queued runs, ordered by `created_at`.
- A feature that has no worktree yet and has `blockedBy` dependencies (deps not Done) waits with activity "Waiting for dependencies: …". Once a worktree exists, dependencies are ignored.
- A non-validator run waits while `runningCount() >= settings.concurrency`, with activity "Queued (i of n) — waiting for an execution slot".
- **Validator runs never use a slot.** `runningCount()` (line 196) counts `initialising`/`running` runs, excluding validators.
- A run that can start is marked `initialising` synchronously, then `start(runId)` is called.
- `tick()` is called after: enqueueing, finalizing, `PUT /settings`, dependency changes, and moves out of build.

### Worktree setup: `ensureWorktree` (line 250)

- Reuses `feature.branch` and `feature.worktreePath` if the directory exists.
- Otherwise:
  1. Computes each dependency's merged status (`isMerged`).
  2. Picks the base with `chooseBaseRef`, which may stack the branch on one unmerged dependency branch.
  3. Calls `allocateBranchAndPath`, then `createWorktree`.
  4. Patches `{branch, worktreePath, baseRef}`.

  Details in [git-worktrees-validation.md](git-worktrees-validation.md).

### Starting a run: `start(runId)` (line 274)

1. `fix` and `followup` runs require an existing worktree. Otherwise it calls `ensureWorktree`.
2. Validator runs go to `runValidation` (line 385).
3. Agent runs pick a prompt and a session to resume:

| Kind | Prompt | Resumes |
|---|---|---|
| `plan` | `buildReplanPrompt(message)` if there is a message and `feature.sessionId`; else `buildPlanPrompt` | The feature session (replan only) |
| `feature` | `buildImplementPlanPrompt` if a completed planner run with a session exists in this cycle; else `buildPrompt` (attempt = earlier feature runs + 1) | The feature session (planned case) |
| `fix` | `buildFixPrompt`; without a session, falls back to `buildPrompt(attempt 2)` plus "# Also fix…" | `feature.sessionId` |
| `test` | `buildTesterPrompt` | Nothing (fresh session) |
| `review` | `buildReviewerPrompt` | Nothing (fresh session) |
| `answer` | `buildAnswerPrompt` | The latest earlier run of the same role in this cycle with a session; else `feature.sessionId`. Throws if neither exists |
| `followup` | `buildFollowupPrompt` | `feature.sessionId` (required) |

4. Prepares the run:
   - `logDir = RUNS_DIR/<runId>`.
   - `prepareCapabilities` writes `logDir/capabilities` (see [capabilities-catalog.md](capabilities-catalog.md)). Missing selections become a warning event.
   - `buildClaudeArgs`, then `prompt.md` and `command.txt` are written.
   - A `system` event records role, read-only or edit, profile, model, effort, budget, and which session is resumed.
5. Launches: `launchDetached({logDir, cwd: worktree, binary: settings.claudeBinary, args})`.
6. Updates the run to `running` with `pid`, `logDir` and `logOffset 0`. The initial stage is `reviewing`, `testing` or `planning`.
7. Calls `attach(run, 0)`. Any exception sends the run to `finishWithoutProcess(failed)`.

**Session ownership** (`sessionOwner`, line 55):
- Only **planner** and **developer** sessions are copied to `feature.sessionId`.
- Plan → implement → fixes → follow-ups are one continuous Claude session.
- Tester and reviewer always start fresh. `answer` runs resume the asking role's own session.

### Live tracking: `attach(run, offset)` (line 474)

- Creates the `ActiveRun`, a `LogTail`, and a stall-check interval of `min(30s, max(1s, STALL/4))` (unref'd).
- `onEvents`:
  - Updates `lastOutputAt`, logging "Agent output resumed" if the run had stalled.
  - Stores the events.
  - Calls `scheduleFlush`.
- `onStderr`: stores the last 20 lines as `stderr` events (500 characters each).
- `onExit` → `finalize`.
- **`checkStall`** (line 515), the quiet-agent watchdog:
  - Fires once when there has been no output for at least `STALL_WARNING_MS` while `running`.
  - Adds a `warning` event: "No output from the agent for N min… A test or build command may be hanging (watch mode, open handles, watchman)…".
  - Sends an attention notification "Agent seems stuck".
  - Resets when output resumes. **It never kills the agent.**
- **`scheduleFlush`** (line 532):
  - At most once per second, persists `logOffset`, `progress`, `stage`, `activity`, `usage`, `metrics`, `model`, `sessionId`, and `estimatedCostUsd = estimateCost(usage, model)`.
  - Copies the session ID to the feature for session owners, if this is still the current run.
- **`finalize`** (line 559):
  1. Clears timers and decides the status ([pipeline.md](pipeline.md#run-status-agentstatus)).
  2. Cost: `estimateCostByModel(result.modelUsage)`, falling back to `estimateCost`.
  3. Duration: `result.durationMs`, falling back to wall clock.
  4. `collectChanges`, then `extractSelfReport(result.text ?? lastText)`, then `buildReport`.
  5. Adds a warning if the agent reported failing tests.
  6. Updates the feature: `agentStatus`, `sessionId`; sends an error notification on failure.
  7. `advance` (unless cancelled), then `tick()`.

### Validation runs: `runValidation` (line 385)

- Commands = `installCommand` (only if `node_modules` is missing and at least one command resolved) followed by the resolved commands.
- Output streams into `tool_result` events, flushed at most once per second (last line as summary, 4000-character tail as detail). On failure, events carry the last 80 lines.
- Progress = done / total.
- Final status: cancelled, failed (first failure), or completed.
- Stores `validation`, the report (`buildValidationReport`) and `commitHash`. Then `advance` and `tick`.

### Recovery and shutdown

- **`recover()`** (line 782), on startup:
  - `initialising`/`running` runs with no pid or logDir (validators, half-started runs) are **re-queued**.
  - All others are reattached at `logOffset`. `LogTail` replays the log and finalizes runs whose process has ended. A run whose process died without an exit file becomes "terminated unexpectedly".
  - Then `tick()`.
- **`shutdown()`** (line 801) stops tails and timers and cancels validations. Agents keep running.

## Runner (`runner.ts`)

**Child environment.** `childEnv(extra)` (lines 36-47) is used for **every** child process: agents and validation commands. Starting from `process.env`, it:
- Deletes `INHERITED_SESSION_VARS` (lines 14-29): `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_REMOTE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_PID`, `CLAUDE_CODE_MESSAGING_SOCKET`/`_TOKEN`, `CLAUDE_CODE_TEE_SDK_STDOUT`, `CLAUDE_CODE_INCLUDE_PARTIAL_MESSAGES`, `CLAUDE_CODE_DIAGNOSTICS_FILE`, `CLAUDE_AFTER_LAST_COMPACT`, `CLAUDE_EFFORT`. This stops an orchestrator started inside Claude Code from leaking its session to agents.
- Deletes `ORCH_GITHUB_TOKEN` and `ORCH_GIT_TOKEN`.
- **Deletes `NODE_ENV`.** If it leaked, `NODE_ENV=production` would make React load its prod build (no `act()`) and make npm skip devDependencies (no Jest).
- Deletes `NODE_OPTIONS` only if it is exactly `--disable-warning=ExperimentalWarning`.
- Merges `extra` last.

**Launching.** `launchDetached(spec)` (line 58):
- Spawns `/bin/sh -c '"$0" "$@" < /dev/null; code=$?; echo "$code" > "$ORCH_EXIT_FILE.tmp" && mv … "$ORCH_EXIT_FILE"' <binary> <args…>`.
- Options: `detached:true` (its own process group), stdout/stderr appended to `stdout.ndjson`/`stderr.log`, `unref`.
- Returns the sh pid.

**Process helpers**
- `isAlive(pid)`: `kill(pid,0)`; `EPERM` counts as alive.
- `killGroup(pid,sig)`: `kill(-pid)`, falling back to `kill(pid)`.
- `readExitCode`, `readStderrTail(logDir, 4000)`.

**`LogTail(logDir, pid, cb, pollMs=400)`** (line 137):
- Owns a `StreamParser`.
- `start(offset)` silently replays bytes `[0, offset)` to rebuild parser state.
- Consumes only complete lines, so offsets always fall on newlines.
- Reads stderr up to 64 KB per tick.
- Ends when the exit file appears, or the pid has been dead for more than 1.5 s. Then: final read, `flush()`, `onExit(code or null)`.

## Launch config and CLI flags (`launch.ts`)

**Constants**

| Constant | Value |
|---|---|
| `LEAN_TOOLS` | Read, Edit, Write, Glob, Grep, Bash |
| `READ_ONLY_TOOLS` | Read, Glob, Grep, Bash |
| `READ_ONLY_ALLOWED` | Read, Glob, Grep + `Bash(` for git status/diff/log/show/branch/rev-parse, ls, cat, head, tail, wc, grep |
| `DISALLOWED_FOR_READ_ONLY` | Edit, Write, NotebookEdit |

`isReadOnlyRole` is true for planner and reviewer.

**`resolveLaunchConfig(project, settings, role)`** (line 52), precedence per field:
- `profile`: project → settings → `lean`.
- `effort`: role → project → settings.
- `model`: role → project → `settings.defaultModel` → null.
- `maxBudgetUsd`: the setting, if > 0.
- `mcpConfig`: `project.mcpConfig`.
- `allowedTools`: `READ_ONLY_ALLOWED` for read-only roles, else `project.allowedTools`.

**`buildClaudeArgs(prompt, cfg, {resumeSessionId})`** (line 84):
1. `-p <prompt> --output-format stream-json --verbose --permission-mode <default (read-only) | acceptEdits>`
2. `--resume <id>` when resuming.
3. `--allowedTools`: the allowed tools, plus MCP allow rules (`mcp__<name>`), plus `Skill(<name>)` per selected skill.
4. `--disallowedTools`: Edit/Write/NotebookEdit for read-only roles, plus unselected MCP servers when the claude.ai-connector case disables strict mode.
5. `--model`, `--effort`, `--max-budget-usd` when set.
6. **Lean profile only:**
   - `--tools <READ_ONLY_TOOLS | LEAN_TOOLS (+Skill if skills are selected)>`
   - `--disable-slash-commands` (when no skills are selected)
   - `--setting-sources project,local`
7. `--strict-mcp-config`:
   - When MCP servers are selected: if `caps.strictMcp`.
   - Otherwise: for the lean profile.
8. `--mcp-config` for the generated file and/or `project.mcpConfig` (repeatable).
9. `--plugin-dir <skills-plugin>` when lean and skills are selected.
10. **`--dangerously-skip-permissions` is never used.**

**Other exports**
- `previewCommand(binary,args)`: shell-quoted, with the prompt replaced by `"<feature prompt>"`.
- `resumeCommand(binary,wt,sid)` → `cd <wt> && <bin> --resume <sid>`.

## Stream parser (`streamParser.ts`)

`StreamParser` (line 95) is an incremental NDJSON parser for `claude -p --output-format stream-json --verbose`.

**Progress milestones.** Markers `[[PROGRESS:planning|implementing|testing|finalizing]]` map to 15/40/70/90 (`MILESTONES`, line 21). Progress is monotonic and each marker emits a lifecycle event.

**Stage heuristics**
- A Bash command matching `TEST_CMD_RE` → `testing`.
- A build command → `implementing`.
- Edit, Write or MultiEdit → `implementing`.
- A thinking block → activity "Thinking…".
- `describeToolUse` (line 48) produces summaries such as "Reading …/a/b", "Running: <desc>" and "Delegating to sub-agent".

**Usage and metrics**
- Usage is summed **deduped by message id**, because Claude Code emits one assistant event per content block. The `result` event's `modelUsage` (or `usage`) overrides the sum when present.
- `metrics`:
  - `turns` = number of unique message IDs.
  - Context per message = input + cache_creation + cache_read; `baseline` is the first message's context, `peak` is the max.
  - `permissionDenials`: tool errors matching `/permission|not allowed|denied|requires approval/` (warning events), overridden by `result.permission_denials.length`.

**Other message types**
- `system`:
  - `init`: session and model.
  - `api_retry`/`api_error`: warning.
  - `compact_boundary`: "Context compacted".
- Non-JSON lines become `stderr` events.
- `result` (line 280) provides `isError = is_error || subtype !== 'success'`, `text`, `totalCostUsd`, `durationMs`, `numTurns` and `modelUsage`.
