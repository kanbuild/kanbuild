# Architecture

Source files: `server/src/index.ts`, `server/build.mjs`, `server/src/db.ts`, `server/src/events.ts`, `web/vite.config.ts`, root `package.json`, `server/package.json`, `web/package.json`, `.gitignore`

## Process model

```
Browser (React dashboard)
   │  REST /api/*        WebSocket /ws (server → client only)
   ▼
Backend: Node + Express + ws (server/src/index.ts), run by tsx, no build step
   │  SQLite (node:sqlite, WAL) at ~/.local-orchestrator/orchestrator.db
   │  in-process event bus (events.ts) → fan-out to every WS client
   │
   ├── spawns DETACHED agent processes: /bin/sh wrapper → `claude -p … --output-format stream-json`
   │     cwd = the feature's git worktree; stdout/stderr appended to runs/<runId>/ files
   │     the backend tails those files (LogTail, ~400 ms poll) and parses NDJSON (StreamParser)
   └── runs validation commands itself (ValidationRun, /bin/sh -c, detached group)
```

- Agents are **detached**, so they keep running when the backend stops. On startup `orchestrator.recover()` reattaches to them using the stored `log_offset` and the `exit_code` file. See [orchestrator-and-agents.md](orchestrator-and-agents.md).
- All pipeline decisions are derived from DB state. See [pipeline.md](pipeline.md).
- Web is a single-page app. In production the server serves `web/dist` (or `ORCH_WEB_DIST`); in dev, Vite serves the UI.
- The **macOS app** (`desktop/`, Electron) starts this same backend as a child process (bundled Node + `server/dist/server.mjs`), or reuses one already listening, and shows the dashboard in a window. See [desktop-app.md](desktop-app.md).

## Ports

| | Default | Notes |
|---|---|---|
| Backend | `127.0.0.1:4317` | `ORCH_HOST`, `ORCH_PORT` (index.ts:14-15) |
| Vite dev | `127.0.0.1:5173` | proxies `/api` → :4317 and `/ws` → `ws://…:4317` (vite.config.ts:9-14) |

## Startup sequence (`server/src/index.ts`)

1. `getDb()` opens the DB and runs migrations (index.ts:53).
2. Express is set up:
   - `x-powered-by` is disabled.
   - The **localhost guard** (index.ts:57-63) returns 403 unless `Host` is localhost/127.0.0.1/[::1] **and** `Origin` is absent or local.
   - `express.json({limit:'2mb'})` parses bodies.
   - `/api` → `routes/api.ts`.
3. The static dashboard is served if `web/dist` exists:
   - `.html` is sent with `Cache-Control: no-cache`.
   - The SPA fallback regex is `^(?!\/api|\/ws).*`.
   - `warnIfDashboardStale()` (index.ts:35) warns if `web/src` or `shared` is newer than `web/dist/index.html`.
   - Without `web/dist`, `GET /` returns a "Frontend not built" text.
4. WebSocket (`noServer`) upgrades only on `/ws`, with the same local checks; other upgrades are destroyed (index.ts:82-89).
   - On connect it sends `{type:'hello'}` (not part of `ServerMessage`).
   - It forwards every `bus` message as JSON (index.ts:94-97).
   - `setClientCounter` tells notify.ts how many tabs are open.
5. After `listen`: log the URL and data dir, then `orchestrator.recover()` (index.ts:120-124).
   - If the port is taken (`EADDRINUSE`, index.ts:100-118), the server probes `GET /api/settings` on that port. If an orchestrator answers, it says a backend is already running (the Mac app or another `npm start`) and how to find it with `lsof`; otherwise it says another program holds the port and suggests `ORCH_PORT`. Either way it exits with code 1 and no stack trace.
6. SIGINT/SIGTERM → `orchestrator.shutdown()` (stops tails/timers, cancels validations), `stopAllTerminalCommands()` (kills Terminal-tab commands), close, exit. **Agents keep running.**

## Event bus (`server/src/events.ts`)

- `bus` is an `EventEmitter` (max listeners 100).
- `publish(msg: ServerMessage)` emits `'message'`.
- All realtime updates go through this. Message list: [api.md](api.md#websocket).

## Data directory (`ORCH_DATA_DIR`, default `~/.local-orchestrator`)

```
orchestrator.db         SQLite (WAL); override the path with ORCH_DB_FILE
github-token            mode 0600 (github.ts)
git-askpass.sh          mode 0700, answers git's credential prompts during PR pushes
runs/<runId>/
  stdout.ndjson         agent stream-json output (appended)
  stderr.log
  exit_code             written atomically by the sh wrapper (tmp + mv)
  prompt.md             the exact prompt sent
  command.txt           preview of the CLI command (prompt replaced)
  capabilities/         generated mcp.json (0600) + skills-plugin/ for this run
```

`DATA_DIR` and `RUNS_DIR` are constants in db.ts:11-14, computed **at import time**. Deleting a project or feature removes DB rows (cascade) but leaves the `runs/` dirs.

## Environment variables

| Var | Default | Where | Purpose |
|---|---|---|---|
| `ORCH_HOST` | `127.0.0.1` | index.ts:14 | Bind address |
| `ORCH_PORT` | `4317` | index.ts:15 | Backend port |
| `ORCH_DATA_DIR` | `~/.local-orchestrator` | db.ts:11 | Data dir (read at import) |
| `ORCH_WEB_DIST` | `<repo>/web/dist` | index.ts:18 | Built dashboard to serve (the Mac app points it at `Resources/web`) |
| `ORCH_DB_FILE` | `<DATA_DIR>/orchestrator.db` | db.ts:129 | SQLite file |
| `ORCH_CLAUDE_BIN` | `claude` | settings.ts:12,24 | Claude binary; **always overrides** the stored `claudeBinary` setting |
| `ORCH_CLAUDE_HOME` | `os.homedir()` | catalog.ts:18 | Home used for MCP and skill discovery (tests) |
| `ORCH_STALL_WARNING_MS` | `300000` | orchestrator.ts:52 | Quiet-agent warning threshold (read at import) |
| `ORCH_GITHUB_TOKEN` | — | github.ts:19 | GitHub token; overrides the token file; stripped from child env |
| `ORCH_GITHUB_API_URL` | api.github.com | github.ts:77-78 | API base (tests, GHE override) |
| `ORCH_EXIT_FILE` | per run | runner.ts:63 | Internal: exit-code path for the sh wrapper |
| `ORCH_GIT_TOKEN` | per push | github.ts:138 | Internal: token for the askpass helper; stripped from child env |
| `NODE_OPTIONS` | `--disable-warning=ExperimentalWarning` | server scripts | Silences the node:sqlite warning; stripped from child env when exactly this value |

## npm scripts

| Where | Script | Command |
|---|---|---|
| root | `dev` | `concurrently` server dev + web dev |
| root | `start` | `build -w web`, then server start |
| root | `start:server` | Server only |
| root | `build` | `vite build` (web only) |
| root | `build:server` | esbuild bundle → `server/dist/server.mjs` (for the Mac app) |
| root | `desktop:dev` / `desktop:dist` | Build everything, then launch Electron / package the .app ([desktop-app.md](desktop-app.md)) |
| root | `test` | server vitest, then desktop vitest |
| root | `typecheck` | server, web, then desktop `tsc --noEmit` |
| server | `dev`/`start`/`test`/`typecheck`/`build` | `tsx watch` / `tsx` / `vitest run` / `tsc` (with the `NODE_OPTIONS` above) / `node build.mjs` |
| web | `dev`/`build`/`typecheck` | vite / vite build / tsc |

## Dependencies

- **Server:** `express ^4.21`, `ws ^8.18`, `tsx ^4.19`. Dev: `typescript ^5.7`, `vitest ^2.1`, `@types/*`.
- **Web:** see [web-dashboard.md](web-dashboard.md#stack).
- **Root:** `concurrently` only.
- **Server dev:** `esbuild` (bundle for packaged installs).
- **Desktop:** `electron` (pinned), `electron-builder`, `esbuild`, `vitest`. See [desktop-app.md](desktop-app.md).

## tsconfig

- Server: ES2022, ESNext modules, Bundler resolution, strict, `allowImportingTsExtensions`, `noEmit`. Includes `src`, `test` and `../shared`.
- Web: aliases `@` → `web/src`, `@shared` → `../shared`.

`.gitignore`: `node_modules/`, `dist/`, `.orchestrator-data/`, `*.log`, `.DS_Store`.
