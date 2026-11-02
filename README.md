# Local AI Development Orchestrator

A local-first Kanban board that delegates feature development to autonomous **Claude Code** agents.
Each project has its own board. When you drag a card into **Build**, the orchestrator creates a dedicated
git branch and worktree and runs a configurable **pipeline** of agents inside it:

- a planner whose plan you approve;
- a developer;
- automatic validation commands;
- a tester;
- optionally a reviewer and your final approval.

Agents can stop and ask you questions. Features can depend on each other. A built-in diff viewer shows the
changes, desktop notifications tell you when you're needed, and one click opens a GitHub pull request.

> Manage development through a Kanban board. Let AI agents handle implementation.

## Requirements

- Node.js **22.13+** (uses the built-in `node:sqlite`; no native modules to compile)
- `git`
- [Claude Code](https://code.claude.com) CLI on your `PATH` (`claude`), already authenticated
- macOS or Linux (agents are launched through `/bin/sh`)

## Getting started

```bash
npm install
```

```bash
npm run build && npm start
```

Open <http://localhost:4317>. For development with hot reload, run `npm run dev` instead (backend on :4317, Vite on <http://localhost:5173>).

1. **Add project**: enter the path of an existing git repository. The orchestrator checks the path is a repository and detects its branches.
2. **New feature**: give it a title, a detailed multiline description and a priority.
3. Drag the card from **Backlog** to **Build**. The agent starts, or waits in the queue if every slot is taken.
4. With the default pipeline, the planner writes a plan and the card shows **Approve plan**. Open the card, read the plan, then approve it (optionally with comments) or request changes.
5. The developer implements the plan. The orchestrator then runs the project's validation commands, sending any failures back to the developer, and a tester agent adds tests.
6. Click a card to follow along. The tabs are **Overview**, **Pipeline**, **Activity** (live), **Changes** (diff viewer), **Tests/Validation** and **Report**.
7. When the pipeline finishes, the card moves to **Done**. Review the diff, then click **Create PR** or merge it yourself. Nothing is ever merged automatically.

## How it works

```
React (Vite, Tailwind, shadcn/ui, dnd-kit)
   │  REST + WebSocket (/api, /ws) on 127.0.0.1
Node.js backend (Express, ws, node:sqlite)
   ├─ Project / Feature managers         server/src/projects.ts, features.ts
   ├─ Agent orchestrator + queue         server/src/orchestrator.ts
   ├─ Pipeline state machine             server/src/pipeline.ts
   ├─ Validation runner                  server/src/validation.ts
   ├─ Dependencies / stacking            server/src/dependencies.ts
   ├─ Diff parser                        server/src/diffParse.ts
   ├─ Notifications                      server/src/notify.ts
   ├─ GitHub (token, push, PRs)          server/src/github.ts, pr.ts
   ├─ Process runner + log tailer        server/src/runner.ts
   ├─ stream-json parser (progress/usage)server/src/streamParser.ts
   ├─ Pricing / cost estimates           server/src/pricing.ts
   ├─ Report generator                   server/src/report.ts
   └─ Git worktree manager               server/src/git.ts
        │
        ├─ claude -p … --output-format stream-json   (one detached process per feature)
        └─ ~/.local-orchestrator/  (SQLite DB + per-run logs)
```

### Agent lifecycle

When a card enters Build, the orchestrator does the following for each agent step of the pipeline:

1. Creates a run in the **Queued** state. The queue is stored in SQLite and runs in FIFO order, up to the concurrency limit (default **2**, set under Settings).
2. Enters **Initialising**: it creates the branch `feature/<slug>-<id>` from the project's base branch and adds the worktree `<repo>-worktrees/feature-<slug>-<id>`.
3. Enters **Running**: it launches `claude -p <prompt> --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools …` with the worktree as its working directory.
   - The prompt contains only the feature's requirements and instructions for how to work: commit the changes, print progress milestones, and end with a JSON report.
   - Claude Code finds the project context itself (`CLAUDE.md` files, `agent-docs/`, READMEs, the code).
4. Reads the NDJSON stream as it arrives and pulls out the session ID, model, current activity, tool events, token usage and milestones.
5. On exit, collects the git changes (commits, created/modified/deleted files, uncommitted work) and parses the agent's JSON self-report. It then builds the markdown implementation report.
6. Sets the run to **Completed**, **Failed** (the card stays in Build with **Retry**) or **Cancelled**. When a run completes, the pipeline decides the next step: another run, a checkpoint, or Done (see below).

### Pipeline and agent roles

Each pipeline step is a separate run, shown in the **Pipeline** tab with its own status, activity, cost and report:

```
plan → (approve plan) → develop → validate ⇄ fix → tests → validate → review ⇄ fix → (final approval) → Done → PR
                any agent may stop with questions → (your answers) → the same session continues
```

| Role | What it does | Session | Permissions |
|---|---|---|---|
| **Planner** | Reads only what it needs and writes an implementation plan | New; the developer then **resumes it**, so the plan and exploration are not re-read | read-only |
| **Developer** | Implements the plan; fixes validation failures, review findings and your feedback | One session for plan → implement → fixes | edits + project allowlist |
| **Validator** | The orchestrator runs the validation commands itself, with no agent and no tokens | — | — |
| **Tester** | Adds and runs tests for the feature | New, independent | edits + project allowlist |
| **Reviewer** | Reviews `git diff <base>...HEAD` against the requirements and returns a verdict and findings | New, independent | read-only |

- **Read-only roles** run with `--permission-mode default`, `--tools Read,Glob,Grep,Bash`, `--disallowedTools Edit,Write,NotebookEdit` and a read-only command allowlist (git diff/log/show, ls, cat, grep…).
- **Toggling steps:** under **Project settings → Pipeline** you can switch each step on or off. The defaults are plan + plan approval, validation and tester. Reviewer and final approval are off. With every step off you get the classic single agent.
- **Fix rounds:** validation failures and review findings go back to the developer up to *max fix rounds* (default 2 each). After that the pipeline stops with the results visible. If final approval is on and the reviewer still wants changes, you decide instead.
- **Roles:** each role can have its own model and effort (for example the reviewer on `sonnet`, effort `low`).
- **Retry** re-runs only the step that failed, not the whole pipeline. Every decision is derived from the run history stored in SQLite, so pipelines survive backend restarts.

**Validation commands** are configured per project. When none are configured they're auto-detected:

- `package.json` scripts: `typecheck`, `test`, `build` (npm/pnpm/yarn by lockfile); dependencies are installed first if the worktree has no `node_modules`, without writing a lockfile;
- `cargo test`;
- `go vet` / `go test`.

They run with a timeout of 10 minutes per command, stop at the first failure, and the output tail is sent to the developer's fix prompt.

**Measured on a real run** (Claude Code CLI 2.1, the "Power function" feature on a tiny Node repo, default pipeline, lean profile):

| Run | Turns | Context/turn | Est. cost |
|---|---|---|---|
| Plan (planner) | 3 | 7.5k → 8.0k | $0.058 |
| Develop (resumed the planner's session) | 5 | 10.8k → 13.9k | $0.172 |
| Validation ×2 (`npm test`) | — | — | $0 |
| Tests (tester, new session) | 6 | 8.4k → 12.1k | $0.105 |
| **Total** (66 s) | | | **$0.335** |

A reviewer on `claude-sonnet-5-5` with effort `low` reviewed the next feature in 2 turns for $0.032.

### Tests that hang

Agents run the project's tests themselves, so a test command that never exits stalls the whole run. Watch mode, open handles and watchman's macOS file-access prompt are the usual causes. Several things guard against this:

- **Prompt rules:** agents are told to use the project's validation commands, never start watch mode or dev servers, pass `--watchAll=false --watchman=false --forceExit --maxWorkers=2` to Jest, and cap each command at 5 minutes. A command that hangs gets reported instead of retried with a longer timeout.
- **Watchdog:** if an agent produces no output for 5 minutes (`ORCH_STALL_WARNING_MS`), its run gets a warning and you get a notification, so you can cancel it.
- **Monorepos:** only the repository root is auto-detected. If the app lives in a subfolder, set the validation commands yourself (Project settings → Pipeline), for example `cd mobile && npx jest --watchAll=false --watchman=false --forceExit --maxWorkers=2`. Agents are then told to use the same commands.

### Approval checkpoints and clarification questions

When the pipeline pauses, the card shows a highlighted chip and the sidebar shows "*n* waiting":

- **Approve plan:** read the plan (markdown). **Approve and implement**, optionally with comments for the developer, or **Request plan changes**, which revises the plan in the same session.
- **Needs your input:** any agent may stop and list questions (`needs_clarification` in its report) when a wrong guess would waste significant work. You answer in the panel, and the agent's own session resumes with your answers.
- **Awaiting approval** (final, optional): review the diff, then **Approve → Done** or **Request changes**, which starts a developer fix run.

**Stop pipeline** closes a checkpoint. Checkpoints are stored in the database and survive restarts.

### Feature dependencies

In a feature's dialog, **Depends on** lists other features of the project; cycles are rejected. A dependent feature can be moved to Build at any time. It then waits with "Blocked by …" until its dependencies are **Done**. The base of its new branch is chosen as follows:

- all dependencies merged into the base branch (or none) → the project's base branch;
- exactly one unmerged → the branch is **stacked** on that dependency's branch, so it has its code, and a PR targets that branch;
- more than one unmerged → the run stops and asks you to merge all but one.

### Diff viewer

The **Changes** tab shows the worktree's diff relative to its merge-base with the base, including uncommitted and untracked files. It has:

- unified or split view;
- a file list;
- scope: all changes, committed only, uncommitted only, or a single commit;
- collapsible files, with large diffs loaded per file.

Clicking a review finding (`file:line`) jumps to that line.

### Desktop notifications

You're notified when a checkpoint opens, a step fails, a pipeline completes or a PR is created. In **Settings → Notifications** choose *Everything*, *Only when I need to act* or *Off*, and enable browser notifications. When the tab is in the background you get a desktop notification, which opens the card when clicked; otherwise you get a toast. On macOS the backend also shows a system notification (via `osascript`) when no dashboard tab is open.

### GitHub pull requests

Add a token under **Settings → GitHub**: a fine-grained token with *Contents: read & write* and *Pull requests: read & write*.

- The token is checked against `GET /user` and stored in `~/.local-orchestrator/github-token` with mode `0600`. `ORCH_GITHUB_TOKEN` overrides it.
- It is never returned to the browser, never passed to agents or validation commands, and never written to logs.

**Create PR** on a finished feature works like this:

1. It pushes the branch to the project's remote (default `origin`) using a `GIT_ASKPASS` helper, so the token never appears in argv or git config. It never force-pushes.
2. It opens a draft PR (configurable) whose description is built from the reports: summary, plan, validation, tests, review, the docs updated and outstanding issues.
3. If the PR already exists, it is reused.

Stacked features target their dependency's branch, which is pushed too if needed. **Open a PR automatically when Done** is available per project. PRs are never merged.

### Agent profiles and token use

Every API turn re-sends the agent's whole context, so the token count grows with *turns × context size*. Most of it is **cache re-reads**, which are billed at roughly 5–10% of the input price. The dashboard keeps these apart:

- **New tokens:** input + cache write + output.
- **Cache re-reads**, shown separately.
- **Turns**, and the **context per turn** at the start and at its peak.
- **Denied tool calls**: each one usually costs an extra turn.

Agents run the normal Claude Code harness in headless mode (`claude -p`). The profile decides how much of your configuration they load:

| Profile | What the agent gets | Context per turn at start (measured) |
|---|---|---|
| **lean** (default) | `--tools Read,Edit,Write,Glob,Grep,Bash`, `--disable-slash-commands`, `--strict-mcp-config` (no user MCP servers), and `--setting-sources project,local`. The repository's CLAUDE.md and `.claude/settings.json` still load; `~/.claude` plugins, hooks and global CLAUDE.md do not. | ~7.7k tokens |
| **full** | Exactly what an interactive session gets: all built-in tools, skills, plugins, MCP servers, hooks and the global CLAUDE.md. | ~35k tokens |

**Settings** also has effort (`--effort`, default `medium`) and a per-run hard budget (`--max-budget-usd`). Projects can override the profile and effort, and pass their own MCP servers with `--mcp-config`. Project settings show the exact command line agents will run.

The prompt defers to the repository's own documentation workflow. CLAUDE.md decides which docs, such as `agent-docs/`, the agent reads and keeps up to date. The prompt asks the agent to read only the relevant docs, prefer them over exploring the code, and report `docs_updated`. It also lists the allowed shell commands, so the agent doesn't waste turns on commands that will be denied.

### Continuing a session

Each run records its Claude Code session ID. From a card's **Overview** tab you can continue in two ways:

- **Send follow-up** runs `claude -p "<message>" --resume <sessionId>` in the same worktree, in the background. You get the same live monitoring, a new report, and "Follow-up #n" in the run history.
- **Continue in terminal** gives you `cd <worktree> && claude --resume <sessionId>` to copy. On macOS, **Open in Terminal** opens Terminal.app with that command. Sessions must be resumed from the worktree directory.

When the orchestrator itself is started from inside a Claude Code session, the agents would inherit that session's ID. The orchestrator strips those session variables, so every agent gets its own session.

### Open in editor

Pick an editor preset in Settings: VS Code (default), Cursor, Zed, WebStorm, IntelliJ, Finder, or a custom command. The orchestrator looks for the editor's CLI in these places, in order:

1. Your `PATH`.
2. `/usr/local/bin`, `/opt/homebrew/bin`, and the CLI inside the app bundle.
3. On macOS, it falls back to `open -a "<App>"`.

So VS Code opens even if the `code` shell command isn't installed.

### Background execution and recovery

Agents run as **detached** process groups. Their stdout and stderr go straight to files under `~/.local-orchestrator/runs/<runId>/`, and a small shell wrapper records the exit code. This means:

- Closing the browser has no effect on running agents.
- Stopping or restarting the backend has no effect on them either. On startup the backend reconciles each unfinished run:
  - If the process is still alive, it reattaches the log tailer and rebuilds the parser state from the log.
  - If the process finished while the backend was down, it finalizes the run normally from the log and exit code.
  - If the process died without a result, it marks the run **Failed** ("terminated unexpectedly").
  - Queued runs, and runs that were still initialising, go back into the queue.
- **Cancel** sends SIGTERM to the agent's process group, then SIGKILL after 5 seconds.

### Progress

Claude Code does not report a completion percentage, so the progress bar uses the milestone markers the agent is asked to print:

| Marker | Progress |
|---|---|
| `[[PROGRESS:planning]]` | 15% |
| `[[PROGRESS:implementing]]` | 40% |
| `[[PROGRESS:testing]]` | 70% |
| `[[PROGRESS:finalizing]]` | 90% |

Until the first marker arrives, the bar is **indeterminate** rather than showing an invented percentage. The current stage and activity come from tool events, for example "Editing src/app.ts" or "Running: npm test".

### Tokens and cost

Usage comes from Claude Code's structured metadata: per-message `usage`, then the final `result.modelUsage`. It covers input, output, cache write (split by 5-minute and 1-hour TTL) and cache read tokens.

Each run shows two cost figures:

- **Estimated cost**: computed from the pricing table in `server/src/pricing.ts`, which has per-model list prices including cache pricing.
- **Reported cost**: Claude Code's own `total_cost_usd`.

Both are **estimates, not actual charges**. Claude subscription plans (Pro/Max/Team) are not billed per token.

### Safety

- The backend listens on `127.0.0.1` only and rejects requests whose `Host` or `Origin` is not localhost, which protects against DNS rebinding and cross-site requests.
- Agents run with `--permission-mode acceptEdits` and a per-project **allowlist** of tools (editable in Project settings). Anything not on the list is denied. The orchestrator never uses `--dangerously-skip-permissions`.
- Every agent works in its own worktree, so the original working directory is never touched.
- Branches are **never merged** automatically, and completed worktrees are kept for review. Pull requests are only created when you click **Create PR**, or when you enabled auto-PR for the project. The orchestrator never force-pushes.
- The planner and reviewer run read-only. Validation commands run in the worktree with the agent session variables and the GitHub token stripped from their environment.
- The GitHub token is stored with `0600` permissions. It is never sent to the browser, never passed to agents and never logged.
- Removing a worktree is refused if it has uncommitted changes, unless you explicitly confirm a second prompt.
- Deleting a feature or removing a project only removes dashboard data. Repositories, branches and worktrees on disk stay.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ORCH_PORT` | `4317` | Backend port |
| `ORCH_HOST` | `127.0.0.1` | Bind address (keep it local) |
| `ORCH_DATA_DIR` | `~/.local-orchestrator` | SQLite DB and run logs |
| `ORCH_CLAUDE_BIN` | `claude` | Claude Code binary (overrides the Settings value) |
| `ORCH_GITHUB_TOKEN` | — | GitHub token (overrides the one stored from Settings) |
| `ORCH_GITHUB_API_URL` | `https://api.github.com` | GitHub API base (GitHub Enterprise: `https://<host>/api/v3`, detected from the remote) |

Under **Settings**, the app also lets you set the agent profile, effort, a budget per run, the concurrency limit, the default model, the editor and the Claude binary. **Project settings** cover the base branch, the worktree directory, a model override and the allowed tools.

## Testing

```bash
npm test
```

The test suite includes end-to-end tests of the orchestrator against temporary git repositories. They use `server/test/fixtures/fake-claude.mjs`, a stand-in that emits realistic `stream-json` and plays each role: read-only planner and reviewer, developer and tester that commit files. The tests cover:

- the concurrency limit and queue, worktree isolation, reports, and failure, retry and cancel;
- the full pipeline: plan → approval → develop → failing validation → fix → tester → Done, with the session reused across the planner, developer and fixes;
- the fix-round limit, and retrying the failed step;
- clarification questions and answers resuming the same session;
- review → fix → re-review → final approval → a PR opened against a mock GitHub API, with the branch pushed to a bare remote;
- dependencies: waiting, and stacking on an unmerged branch;
- checkpoints surviving a restart;
- the diff API.

Unit tests cover the pipeline state machine, the diff parser, cycle detection, remote parsing, role arguments, prompts, notification escaping and validation detection.

To try the UI without spending tokens, run:

```bash
ORCH_CLAUDE_BIN=$PWD/server/test/fixtures/fake-claude.mjs npm start
```

## API

- `PUT /api/features/:id/dependencies` (`{ dependsOn: [...] }`)
- `POST /api/features/:id/gate` (`{ action: approve | reject | answer, comment?, answers? }`)
- `GET /api/features/:id/diff?scope=all|committed|uncommitted|commit:<sha>&file=`
- `POST /api/features/:id/pr`
- `GET/PUT /api/settings/github`, `POST /api/notifications/test`
- `GET /api/projects/:id/validation-preview`
- `GET/POST /api/projects`
- `PATCH/DELETE /api/projects/:id`
- `POST /api/projects/validate`
- `GET/POST /api/projects/:id/features`
- `POST /api/projects/:id/reorder`
- `GET/PATCH/DELETE /api/features/:id`. A `PATCH` with `status: "build"` starts the pipeline.
- `POST /api/features/:id/{cancel,retry,open,reveal,open-terminal}`
- `POST /api/features/:id/followup` (`{ message }`)
- `GET /api/features/:id/session`
- `GET /api/projects/:id/launch-preview`
- `GET /api/features/:id/{runs,changes}`
- `DELETE /api/features/:id/worktree[?force=true]`
- `GET /api/runs/:id/{events,report}`
- `GET/PUT /api/settings`
- WebSocket `/ws`, which pushes `feature.updated`, `run.updated`, `run.event`, `notification` and similar messages.
