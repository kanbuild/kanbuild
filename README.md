# Local AI Development Orchestrator

A local-first Kanban board that delegates feature development to autonomous **Claude Code** agents.
Each project has its own board. When you drag a card into **Build**, the orchestrator creates a dedicated
git branch and worktree and starts a headless Claude Code process inside it. While the agent runs, the board
shows its progress, tokens and estimated cost. When it finishes, the orchestrator writes an implementation
report and moves the card to **Done**.

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
4. Click a card to follow the agent: **Overview**, **Activity** (live), **Changes**, **Tests** and **Report**.
5. When the agent succeeds, the card moves to **Done**. Review the branch or worktree (there is an **Open in editor** button) and merge it yourself.

## How it works

```
React (Vite, Tailwind, shadcn/ui, dnd-kit)
   │  REST + WebSocket (/api, /ws) on 127.0.0.1
Node.js backend (Express, ws, node:sqlite)
   ├─ Project / Feature managers         server/src/projects.ts, features.ts
   ├─ Agent orchestrator + queue         server/src/orchestrator.ts
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

When a card enters Build, the orchestrator:

1. Creates a run in the **Queued** state. The queue is stored in SQLite and runs in FIFO order, up to the concurrency limit (default **2**, set under Settings).
2. Enters **Initialising**: it creates the branch `feature/<slug>-<id>` from the project's base branch and adds the worktree `<repo>-worktrees/feature-<slug>-<id>`.
3. Enters **Running**: it launches `claude -p <prompt> --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools …` with the worktree as its working directory.
   - The prompt contains only the feature's requirements and instructions for how to work: commit the changes, print progress milestones, and end with a JSON report.
   - Claude Code finds the project context itself (`CLAUDE.md` files, `agent-docs/`, READMEs, the code).
4. Reads the NDJSON stream as it arrives and pulls out the session ID, model, current activity, tool events, token usage and milestones.
5. On exit, collects the git changes (commits, created/modified/deleted files, uncommitted work) and parses the agent's JSON self-report. It then builds the markdown implementation report.
6. Sets the run to **Completed** (the card moves to Done), **Failed** (the card stays in Build with **Retry**) or **Cancelled**.

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
- Branches are **never merged** automatically, and completed worktrees are kept for review.
- Removing a worktree is refused if it has uncommitted changes, unless you explicitly confirm a second prompt.
- Deleting a feature or removing a project only removes dashboard data. Repositories, branches and worktrees on disk stay.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `ORCH_PORT` | `4317` | Backend port |
| `ORCH_HOST` | `127.0.0.1` | Bind address (keep it local) |
| `ORCH_DATA_DIR` | `~/.local-orchestrator` | SQLite DB and run logs |
| `ORCH_CLAUDE_BIN` | `claude` | Claude Code binary (overrides the Settings value) |

Under **Settings**, the app also lets you set the agent profile, effort, a budget per run, the concurrency limit, the default model, the editor and the Claude binary. **Project settings** cover the base branch, the worktree directory, a model override and the allowed tools.

## Testing

```bash
npm test
```

The test suite includes an end-to-end test of the orchestrator against a temporary git repository. It uses `server/test/fixtures/fake-claude.mjs`, a stand-in that emits realistic `stream-json` and commits a file. The test covers:

- the concurrency limit and queue
- worktree isolation
- reports
- failure, retry and cancel
- that the original repository stays unaffected

To try the UI without spending tokens, run:

```bash
ORCH_CLAUDE_BIN=$PWD/server/test/fixtures/fake-claude.mjs npm start
```

## API

- `GET/POST /api/projects`
- `PATCH/DELETE /api/projects/:id`
- `POST /api/projects/validate`
- `GET/POST /api/projects/:id/features`
- `POST /api/projects/:id/reorder`
- `GET/PATCH/DELETE /api/features/:id`. A `PATCH` with `status: "build"` starts an agent.
- `POST /api/features/:id/{cancel,retry,open,reveal,open-terminal}`
- `POST /api/features/:id/followup` (`{ message }`)
- `GET /api/features/:id/session`
- `GET /api/projects/:id/launch-preview`
- `GET /api/features/:id/{runs,changes}`
- `DELETE /api/features/:id/worktree[?force=true]`
- `GET /api/runs/:id/{events,report}`
- `GET/PUT /api/settings`
- WebSocket `/ws`, which pushes `feature.updated`, `run.updated`, `run.event` and similar messages.
