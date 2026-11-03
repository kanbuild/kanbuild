# macOS desktop app

Source files: `desktop/src/main.ts`, `desktop/src/env.ts`, `desktop/scripts/build-main.mjs`, `desktop/scripts/fetch-node.mjs`, `desktop/electron-builder.config.cjs`, `desktop/build/*`, `desktop/test/env.test.ts`, `server/build.mjs`, `.github/workflows/release-mac.yml`, `.github/workflows/ci.yml`

The Mac app is **AI Orchestrator.app**, built with Electron. It has the same backend and dashboard as the web version and no sign-in. It does not reimplement anything. It starts the normal backend and shows `http://localhost:4317` in a window. The web version (`npm start` plus a browser) is unchanged, and both use the same data dir (`~/.local-orchestrator`), so projects and history are shared.

## Process model

```
AI Orchestrator.app
 ├─ Electron main (desktop/dist/main.cjs, bundled from src/main.ts)
 │    ├─ probes 127.0.0.1:<port>/api/settings
 │    │    orchestrator answers → reuse it (never two backends on one DB)
 │    │    nothing listening    → spawn the bundled backend
 │    │    something else       → error dialog "port in use"
 │    └─ BrowserWindow → http://localhost:<port>   (no preload, contextIsolation, sandbox)
 └─ backend child: Resources/node/bin/node Resources/server/server.mjs
        env: login-shell PATH, ORCH_WEB_DIST=Resources/web, ORCH_PORT, ORCH_HOST=127.0.0.1
        stdout/stderr → ~/Library/Logs/AI Orchestrator/server.log
```

## Launch sequence (`main.ts`)

1. `requestSingleInstanceLock()` (main.ts:224). A second launch focuses the existing window.
2. `probe()` (main.ts:61) GETs `/api/settings` with a 1.5 s timeout.
   - JSON with a numeric `apiVersion` means an orchestrator is running, so the app reuses it.
   - `ECONNREFUSED` means nothing is listening. Anything else (non-JSON, timeout, reset) means another program has the port.
3. `startBackend()` (main.ts:87):
   - Resolves the PATH with `loginShellPath()` (main.ts:47): `$SHELL -ilc 'printf "__ORCH_PATH__%s__ORCH_PATH__" "$PATH"'` with an 8 s timeout, parsed by `parseMarkedPath()`. `withFallbackPath()` appends `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin` and the system dirs. **Why:** apps started from Finder get a minimal PATH, so `claude`, `git` and `npm` would otherwise be missing for agents and validation.
   - Builds the env with `buildBackendEnv()` (env.ts:34). It drops `ELECTRON_*`, `NODE_ENV` and the inherited `NODE_OPTIONS`, and sets `NODE_OPTIONS=--disable-warning=ExperimentalWarning` (the server's `childEnv()` strips exactly this value again).
   - Spawns the backend (`cwd` = home) and waits up to 30 s for `probe()` to see the orchestrator.
4. `createWindow()` (main.ts:151):
   - Bounds are remembered in `<userData>/window-state.json`.
   - `backgroundColor: '#0b0c0e'` matches the dashboard's dark `--background` token, so there is no flash before the page paints.
   - `setWindowOpenHandler` and `will-navigate` send every URL that is not the dashboard's own origin (`isLocalUrl`, env.ts:53) to `shell.openExternal`, such as GitHub PR links.
5. The menu (`buildMenu`, main.ts:187) has the standard app/Edit/Window menus. View → *Open in Browser*. Help → *Show Backend Log* and *Open Data Folder*.

## Lifecycle

- **Closing the window** keeps the app (and the pipelines) running in the Dock. `activate` reopens it.
- **Quit** (`before-quit`, main.ts:259) sends SIGTERM to the backend *the app started*, with SIGKILL after 5 s. The backend runs its normal shutdown. **Agents are detached and keep running**, and `recover()` reattaches on the next launch. A reused external backend is left alone.
- **Backend crash** (`onBackendCrash`, main.ts:109) shows a dialog: Restart (respawns and reloads the window), Show Log, or Quit.
- **Notifications:** the window is a WS client, so `notify.ts` sends dashboard (HTML5) notifications exactly as it does for a browser tab. The osascript fallback applies only when no window is open.

## Bundled pieces

| In the .app (`Contents/Resources/`) | Built by | Notes |
|---|---|---|
| `app.asar` → `dist/main.cjs`, `package.json` | `scripts/build-main.mjs` (esbuild, CJS, `electron` external) | No `node_modules` inside the app |
| `server/server.mjs` | `server/build.mjs` (esbuild ESM bundle of `server/src/index.ts`, `createRequire` banner, `bufferutil`/`utf-8-validate` external) | `npm run build:server` → `server/dist/server.mjs` |
| `web/` | `vite build` | Served through `ORCH_WEB_DIST` |
| `node/bin/node` + `LICENSE` | `scripts/fetch-node.mjs` | The official Node **v22.23.4** darwin binary per arch, SHA-256 checked against `SHASUMS256.txt`, cached in `desktop/vendor/node-<arch>/`. `ORCH_NODE_ARCHS=arm64` limits the download |

**Why a bundled Node rather than Electron's own:** the backend needs `node:sqlite` (Node ≥ 22.13), and running it as a plain Node child keeps it identical to `npm start`. Users don't need Node installed. They need only `git` and an authenticated `claude` CLI.

In development (`!app.isPackaged`), `resources()` (main.ts:29) uses `ORCH_NODE_BIN` (default `node` on PATH), `server/dist/server.mjs` and `web/dist` from the repo.

## Commands

```bash
npm run desktop:dev     # build web + server bundle + main, then launch Electron (needs Node 22.13+ on PATH)
npm run desktop:dist    # full build → desktop/release/AI-Orchestrator-<version>-<arch>.{dmg,zip} (macOS only)
npm run build:server    # just the backend bundle
npm run test -w desktop # unit tests for env.ts
```

`desktop:dist` builds both `arm64` and `x64`. The `${arch}` macro in `extraResources` selects `vendor/node-${arch}`.

## Signing, notarization and releases

`electron-builder.config.cjs` reads the env:

| Env / GitHub secret | Effect |
|---|---|
| `CSC_LINK` (base64 .p12 of a *Developer ID Application* cert) + `CSC_KEY_PASSWORD` | Signs the app, hardened runtime. `@electron/osx-sign` also signs `Resources/node/bin/node` with `entitlementsInherit` |
| + `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | Notarizes and staples |
| none | `identity: null`: an **unsigned** build (a warning is printed). On macOS 15+ users must try to open it, then System Settings → Privacy & Security → **Open Anyway** (older macOS: right-click → Open) |

`build/entitlements.mac.plist` has `allow-jit` and `allow-unsigned-executable-memory` (V8 in Electron and the bundled Node) and `disable-library-validation` (the backend runs user tools).

**Release:** push a tag `vX.Y.Z`. `.github/workflows/release-mac.yml` (macos-latest) runs typecheck and tests, sets `desktop/package.json` to the tag version, runs `npm run desktop:dist` with the secrets, writes the signed/notarized status to the job summary, and attaches the dmg/zip to a GitHub Release. `workflow_dispatch` builds without publishing (as a workflow artifact). **First release checklist:**

1. Add the five values above as **repository** secrets (Settings → Secrets and variables → Actions → New repository secret). Environment secrets are not visible, because the workflow declares no `environment:`.
2. Merge the workflow to the default branch (currently `claude/affectionate-wright-b6ps16`). GitHub shows **Run workflow** only for workflows on the default branch.
3. Go to Actions → **Release macOS app** → **Run workflow** (the default branch). The job summary should say `Signed: true` and `Notarized: true`. Download the `macos-app` artifact.
4. Install the dmg and check it with `spctl -a -vv "/Applications/AI Orchestrator.app"`, which should report `source=Notarized Developer ID`.
5. Publish: `git tag v0.1.0 && git push origin v0.1.0`.

`.github/workflows/ci.yml` runs typecheck, tests and builds on Ubuntu and macOS for pushes to the default branch (`main` or `claude/affectionate-wright-b6ps16`) and for PRs (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`).

## Gotchas

- Only the backend's port matters. Set `ORCH_PORT` before launching the app to change it (the dashboard origin, and so its localStorage, follows the port).
- If `npm start` is already running, the app reuses that backend, and quitting the app does not stop it.
- Logs: `~/Library/Logs/AI Orchestrator/server.log` (on Linux dev runs, `<userData>/logs/server.log`).
- After upgrading the server's Node requirement, bump `NODE_VERSION` in `fetch-node.mjs`.
- Electron is pinned exactly (`desktop/package.json`) because `electronVersion` is read from it.
- `.dmg` targets build only on macOS. On Linux, `npx electron-builder --config electron-builder.config.cjs --mac dir --arm64` (in `desktop/`) still produces an unsigned `.app` folder, which is useful to inspect the layout.
