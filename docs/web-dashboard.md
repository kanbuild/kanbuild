# Web dashboard (`web/`)

Source files: everything under `web/` — `src/main.tsx`, `App.tsx`, `store.ts`, `api.ts`, `hooks.ts`, `lib/utils.ts`, `index.css`, `components/*.tsx`, `components/ui/*.tsx`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`

## Stack

| Item | Details |
|---|---|
| Framework | React 18.3 (StrictMode) |
| Build | Vite 6 + TypeScript 5.7 (strict, `noEmit`) |
| Styling | Tailwind 3.4 + `tailwindcss-animate` |
| UI primitives | Radix (dialog, tabs, slot) + `class-variance-authority`, `clsx`, `tailwind-merge` (shadcn style) |
| Icons | `lucide-react` |
| Drag and drop | `@dnd-kit` (core, sortable, utilities) |
| Markdown | `react-markdown` + `remark-gfm` |

- **No router** and no state library: a custom store built on `useSyncExternalStore`.
- **Aliases:** `@` → `web/src`, `@shared` → `../shared`. Shared types are imported as `@shared/types.ts`.
- **Dev:** Vite on `127.0.0.1:5173`, proxying `/api` and `/ws` (ws:true) to :4317.
- **Checks:** there are no web tests and no linter. The only check is `npm run typecheck`.
- `index.html`: title "Kanbuild", 🧩 SVG favicon.
- **Branding:** the product name is **Kanbuild**. The sidebar mark is `components/Logo.tsx` (a placeholder `Bot` icon until the real logo lands; swap it there only).

## Bootstrap (`main.tsx`)

1. Adds the `dark` class to `<html>` if `prefers-color-scheme: dark`. This is checked once; there is no toggle.
2. Calls `connect()` to open the WebSocket before render.
3. Renders `<StrictMode><ErrorBoundary><App/></ErrorBoundary></StrictMode>`.

## Store (`store.ts`)

**State:**
```
{ connected, projects: Project[], features: Record<id, Feature> (all projects), loadedProjects: Set, settings: SettingsResponse|null }
```

**Mechanics**
- `set(patch)` replaces the state immutably and calls the listeners.
- `useStore(selector)` wraps `useSyncExternalStore`. **Selectors must return stable references.** Use module-level constants like `NO_TOOLS = []` (ProjectDialog.tsx:13) and `useMemo` over stable slices (Board.tsx:122).
- `getState()` gives non-React access.

**Actions**
- `upsertFeature`, `removeFeature`, `upsertProject`.
- `loadProjects()`: projects + settings, then `loadFeatures` for **every** project, so the sidebar counts work everywhere.
- `loadFeatures(pid)`.
- `setSettings` (merges).

**Pub/sub channels** (not stored): `onRunEvent`, `onRunUpdate`, `onNotification`. Run events and run lists live in component state; only `feature.run` is global.

**WebSocket client.** `connect()` (128-158):
- Uses `ws(s)://host/ws`.
- On open, after being disconnected (including the first connect): reloads projects and every loaded project's features. Missed events are not replayed; a full refetch replaces them.
- On close: backoff reconnect from 500 ms, doubling, capped at 8 s.

**Message handling.** `handle()` (96-126) covers each `ServerMessage`:

| Message | Effect |
|---|---|
| `feature.updated` | upsert |
| `feature.deleted` | remove |
| `run.updated` | patches the feature whose `currentRunId` matches, and notifies run listeners |
| `run.event` | listeners only |
| `project.*` | upsert/remove |
| `settings.updated` | merge |
| `notification` | listeners |

## API client (`api.ts`)

- `req(method, url, body)` fetches `/api${url}`.
- On a non-2xx response it throws `ApiError(status, data.error, data)`. The parsed body is on `err.body`; for example `err.body.dirty` is used when removing a worktree.
- The `api` object has one function per endpoint in [api.md](api.md): `settings`, `updateSettings`, `projects`, `validatePath`, `createProject`, `updateProject`, `deleteProject`, `features`, `createFeature`, `updateFeature`, `deleteFeature`, `reorder`, `cancel`, `retry`, `openEditor`, `reveal`, `session`, `openTerminal`, `followUp`, `launchPreview`, `removeWorktree`, `runs`, `changes`, `setDependencies`, `gate`, `continuePipeline`, `createPr`, `diff`, `catalog`, `searchFiles`, `validationPreview`, `githubStatus`, `setGithubToken`, `testNotification`, `events`, `report`.
- Types: `SettingsResponse`, `SessionInfo`, `LaunchPreview`, `ProjectInput`, `GateAction`.

## Layout and components

### `App.tsx`

**Sidebar** (`w-64`)
- Connection status: "local backend connected" or "reconnecting…".
- Project list:
  - An amber "N waiting" pill (from `needsAttention`).
  - A sky pill for the active count.
  - A trash button on hover that removes the project from the dashboard only.
- Settings button.

**Main area**
- An **out-of-sync banner** when `settings.apiVersion !== API_VERSION`, suggesting a rebuild via `npm start`.
- Project header: name, the **base-branch switcher** (`BranchSwitcher`), path, est. project cost; "Project settings" and "New feature" buttons.
- The `Board`.
- An empty state when there is no project.

**Root-level mounts:** ProjectDialog, FeatureDialog, SettingsDialog, AgentDetailSheet, `ConfirmHost`, `Toaster`.

**Selected project:** stored in localStorage `orch:lastProject`.

**Notifications:**
- When the tab is hidden and permission is granted, a desktop `Notification`. Clicking it focuses the window, selects the project and opens the detail sheet.
- Otherwise a toast (error tone when `level === 'error'`).

### `Board.tsx`

**Columns:**
- **Backlog**: "Drag a card into Build to start an agent". It has the only + button.
- **Build**: "X running · Y queued · limit N concurrent (global)".
- **Done**.

Cards are sorted by `position`, then `createdAt`.

**Drag and drop**
- Cards are dragged optimistically through local `cols`, which re-sync from the server only when no drag is active.
- Sensors: Pointer (6 px activation distance, so a click still opens the card) and Keyboard.
- `columnFirstCollision` (40-52) gives the column under the pointer priority over cards.
- `onDragEnd`:
  1. Leaving Build with an active agent → destructive confirm, then `confirmCancel:true`.
  2. Done → Build → confirm "Start a new agent run?".
  3. `api.updateFeature({status})`, then `api.reorder`.
  4. On an error or a declined confirm, reset to the server columns.

### `FeatureCard.tsx` + `status.tsx`

**Card appearance**
- Border: red on failure, amber ring when waiting (gate or paused), dashed for a blocked backlog card.
- Shows: status badge, `PipelineChip`, `runLabel · #attempt`, `RunProgress`, current activity, error, duration, tokens, cost, branch.
- PR link: its pointerdown is stopped so it doesn't start a drag.

**`status.tsx` helpers**
- `isActive`, `isPaused` (build + completed + no gate → needs "Continue"), `isWaiting`, `needsAttention` (waiting, or Build + failed).
- `STATUS_META`, `GATE_META`.
- `runLabel` by kind, `roleLabel`.
- `RunProgress`: indeterminate when running without a reported progress.
- `newTokens` (excludes cache reads), `runCost` (estimated ?? reported).
- `PriorityBadge`.

### `BranchSwitcher.tsx` (project header)

- A `GitBranch` chip showing `project.baseBranch`. Clicking it opens a popover (absolute panel; outside click or Esc closes it). Keyed by project ID in `App.tsx`, so it resets when switching projects.
- On every open it reloads branches via `api.validatePath(project.path)` (no dedicated endpoint) and marks the repo's checked-out branch.
- A filter input narrows the list. Choosing a branch calls `api.updateProject(id, {baseBranch})`, then `upsertProject` and a toast. The server rejects unknown branches (toast error).
- It only changes the ref **new** features branch from. Existing features keep `feature.baseRef`, and the repo's own checkout is never touched (no `git checkout`).

### `FeatureDialog.tsx`

- Fields: title (required), description (`MentionTextarea`), priority, and "Depends on" checkboxes over the project's other features.
- Save: create or update, then `setDependencies` only if the set changed.

### `ProjectDialog.tsx`

**Create mode**
- The path is validated with a 350 ms debounce and auto-fills name, base branch and worktree root.
- Save requires a git repo root with branches.

**Fields**
- name, base branch (select), description, worktree dir, model, agent profile, effort
- `CapabilitiesPicker`
- "Advanced: extra MCP config"
- **Pipeline** toggles: Plan, Approve plan (needs Plan), Validate, Tester, Reviewer, Final approval. Also:
  - validation commands, one per line (the hint shows the auto-detected ones)
  - max fix rounds, git remote, draft PRs, auto-create PR
- **Agent roles:** model and effort per role.
- Allowed tools, one per line.
- **Launch preview:** command and prompt per role.

### `AgentDetailSheet.tsx` (right sheet, `sm:max-w-3xl`)

**Data**
- Runs come from `api.runs` and are patched live via `onRunUpdate`.
- The selected run defaults to `feature.currentRunId`.
- The report is fetched only once the run is no longer active.
- The early `return null` (around line 485) comes **after all hooks**.

**Header actions**
- Edit, Cancel agent, Retry `<step>`, Continue pipeline (when paused), Stop pipeline (when gated).
- PR #N link, or Create PR (needs a GitHub token).
- Open in editor, Delete.
- A run selector when there is more than one run.

`GatePanel` renders above the tabs when `feature.gate` is set.

**Tabs**
1. **Overview**
   - Stage and progress, activity, error.
   - `ReviewSection`: findings with file:line links that jump to the Changes tab.
   - Plan, questions.
   - Stats grid: duration, new tokens, est. cost, model, turns, context, cache reads, denials, token breakdown.
   - `ContinueSession`: send a follow-up (Cmd/Ctrl+Enter); shows the terminal resume command, Copy, and Open in Terminal (macOS).
   - The run message, description, metadata.
2. **Pipeline** (`PipelineTab.tsx`)
   - Step chain from the config: Plan → Approve plan → Develop/Follow-up (+ N fix rounds) → Validate → Tests → Review → Your approval → Done.
   - Step states come from the latest cycle's runs.
   - Run list grouped by cycle, with costs.
   - Clicking a run selects it (validator → Tests tab, otherwise Report).
3. **Activity**
   - `api.events` backfill plus live `onRunEvent` events, deduped by id.
   - Filters: all, tools, problems.
   - Auto-scroll; click a row to expand its detail.
4. **Changes**
   - `api.changes`: branch, base, commits, files, and a docs badge (`isDocPath`: `docs/`, `agent-docs/`, `CLAUDE*.md`, `README*.md`).
   - Actions: Refresh, Open, Reveal, Copy path.
   - **Remove worktree** is a two-step confirm: on a 409 `dirty` response it asks again with `force`.
   - Note: "Branches are never merged automatically".
   - Followed by the `DiffViewer`.
5. **Tests / Validation**: for validator runs, a `<details>` per command (open when failed); otherwise the self-reported tests and build.
6. **Report**: `report.markdown` rendered with `Markdown` in `.prose-report`.

### `GatePanel.tsx`

| Gate | UI |
|---|---|
| `plan_approval` | The plan as Markdown; Approve and implement; Request plan changes (needs a comment) |
| `clarification` | One textarea per question; Send answers (blank answer = let the agent decide) |
| `final_approval` | Note + cycle summary (validation, tests, fix rounds, reviewed); Review the diff; Approve → Done; Request changes (needs a comment) |

### `DiffViewer.tsx`

- **Scope select:** all, committed, uncommitted, or a specific `commit:<hash>`.
- **Mode:** unified or split, stored in localStorage `orch:diffMode`.
- **Controls:** expand/collapse all; a file nav sidebar (md+ screens, more than one file).
- **Truncated files** get a per-file "Load diff" button.
- **Finding jump:** matches the file by exact path or suffix, scrolls to `#diff-{i}-L{line}` and highlights it. A `nonce` makes repeat clicks work.

### `MentionTextarea.tsx` (`@file` autocomplete)

- **Trigger:** `@` at the start of the text or after whitespace, `(` or `[`, matched before the caret.
- **Search:** `api.searchFiles(pid, q, 12)`, debounced 120 ms.
- **Keys:**
  - ↑/↓ move through results; Enter or Tab inserts `@path `.
  - Esc closes the popup and stops propagation, so the dialog stays open.
  - Other keys go to the parent, so Cmd+Enter still sends.
- A "Reference file" button, and chips listing the referenced files (via `extractFileRefs` in `lib/utils.ts`, which mirrors the server version).
- Used in FeatureDialog and ContinueSession.

### `SettingsDialog.tsx`

**Fields**
- Agent profile (with `PROFILE_HELP`), effort, budget per run, max concurrent agents (1-16), default model.
- Editor: a preset or a custom command.
- Claude binary.

**Notifications fieldset**
- Level.
- Browser permission state and an enable button.
- Send test.
- macOS system notifications.

**GitHub fieldset**
- Shows status, login and token source. The token is saved immediately on its own, not via the main Save button.
- Remove is offered only for file-stored tokens.

### Utilities

- **`confirm.tsx` / `confirmStore.ts`:**
  - `await confirm({title, description, confirmLabel?, destructive?})` resolves to a boolean.
  - It is rendered by the single `ConfirmHost`.
  - Only one pending confirm at a time: a second one overwrites the first, and the first never resolves.
- **`toast.tsx`:** `toast(text, 'info'|'error')` (3.5 s / 7 s) and `toastError(err)`. Shown bottom-right.
- **`ErrorBoundary.tsx`:** the fallback says agents keep running, shows the stack, and has a Reload button.
- **`CapabilitiesPicker.tsx`:** see [capabilities-catalog.md](capabilities-catalog.md#ui-capabilitiespickertsx-inside-the-project-dialog).
- **`Markdown.tsx`:** react-markdown + gfm.
- **`hooks.ts`:** `useNow(active, ms=1000)`, a ticking clock that runs only while active.
- **`lib/utils.ts`:** `cn()`, `formatTokens` (1.2k / 3.45M), `formatCost` (— or $), `formatDuration`, `formatTime`, `extractFileRefs`.

### UI primitives (`components/ui/`)

| File | Contents |
|---|---|
| `button.tsx` | variants default, destructive, outline, secondary, ghost, link; sizes default, sm, lg, icon; `asChild` |
| `badge.tsx` | variants default, secondary, outline, red, amber, green, blue, violet, gray (with dark variants) |
| `dialog.tsx` | `DialogContent` (centered, max-w-lg, scrolls), `SheetContent` (right side, `sm:max-w-3xl`), header, footer, title, description |
| `tabs.tsx` | Radix tabs |
| `input.tsx` | `Input`, `Textarea`, native `Select`, `Label`, `Field({label, hint})` |
| `progress.tsx` | `Progress({value|null, tone})`; `null` is indeterminate (`animate-indeterminate` keyframe) |

## Styling conventions

**Tokens and theming**
- shadcn "zinc" HSL CSS variables in `index.css` (`:root` and `.dark`), mapped in `tailwind.config.js`.
- `darkMode: ['class']`, `--radius: 0.6rem`.

**Status colors**

| Color | Meaning |
|---|---|
| amber | waiting or attention |
| sky | running or info |
| emerald | success |
| red | failure |
| violet | pipeline step, docs, skills |

**Idioms**
- `text-[10px]`/`text-[11px]` hints, `font-mono text-xs` for paths, `tabular-nums` for numbers, `cn()` everywhere.
- `.prose-report` is hand-written Markdown typography (no typography plugin).

## Gotchas

1. **Hooks must run unconditionally.** A conditional `useStore` in App.tsx once blanked the dashboard (fixed in 7ddcbe2, which also added ErrorBoundary).
2. **Stable selector results only.** A selector that returns a fresh `[]` or `{}` causes a render loop.
3. **Version banner:** bump `API_VERSION` in `shared/types.ts` for coordinated changes. The server sends `index.html` with no-cache, so a reload picks up a rebuilt dashboard.
4. **localStorage keys:** `orch:lastProject` and `orch:diffMode`. Every access is wrapped in try/catch.
5. **No UI action merges branches.** Create PR pushes the branch and opens a PR.
6. Costs are always labeled "est.".
