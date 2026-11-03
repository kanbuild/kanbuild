# Web dashboard (`web/`)

Source files: everything under `web/` — `src/main.tsx`, `App.tsx`, `store.ts`, `theme.ts`, `api.ts`, `hooks.ts`, `lib/utils.ts`, `index.css`, `components/*.tsx`, `components/ui/*.tsx`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `public/*`, `src/assets/logo.png`

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
| Font | `@fontsource-variable/inter` (bundled, no CDN, so the Mac app works offline) |

- **No router** and no state library: a custom store built on `useSyncExternalStore`.
- **Aliases:** `@` → `web/src`, `@shared` → `../shared`. Shared types are imported as `@shared/types.ts`.
- **Dev:** Vite on `127.0.0.1:5173`, proxying `/api` and `/ws` (ws:true) to :4317.
- **Checks:** there are no web tests and no linter. The only check is `npm run typecheck`.
- `index.html`: title "Kanbuild". The favicon is `/favicon.png` (64 px) plus `/apple-touch-icon.png` (180 px), both from `web/public/`, which Vite copies into `web/dist` for the server to serve.
- **Branding:** the product name is **Kanbuild**. The mark is `components/Logo.tsx`: an `<img>` of `src/assets/logo.png` (the robot in front of Kanban columns, 256 px, transparent, bundled by Vite), default `h-8 w-8`. The dashboard and the landing page both use it, so swap the logo there only. The favicons are separate PNGs made from the same artwork.

## Bootstrap (`main.tsx`)

1. Imports the Inter font and calls `applyTheme()` (`theme.ts`), which sets the `dark` class on `<html>`.
2. Calls `connect()` to open the WebSocket before render.
3. Renders `<StrictMode><ErrorBoundary><App/></ErrorBoundary></StrictMode>`.

## Theme (`theme.ts`)

- `Theme = 'system' | 'light' | 'dark'`, stored in localStorage `orch:theme` (absent = `system`). Every access is in try/catch.
- `applyTheme()` paints once at startup and listens to `prefers-color-scheme` changes; it only repaints from the OS while in `system` mode.
- `setTheme(t)` stores, repaints and notifies; `useTheme()` is a `useSyncExternalStore` hook over its own tiny module store (not the main store).
- The toggle is `ThemeToggle` in `App.tsx`: a segmented Monitor / Sun / Moon control in the sidebar footer.
- `index.html` declares `<meta name="color-scheme" content="light dark">`; `index.css` sets `color-scheme` per theme so native controls match.

## Store (`store.ts`)

**State:**
```
{ connected, projects: Project[], features: Record<id, Feature> (all projects), loadedProjects: Set, settings: SettingsResponse|null }
```

**Mechanics**
- `set(patch)` replaces the state immutably and calls the listeners.
- `useStore(selector)` wraps `useSyncExternalStore`. **Selectors must return stable references.** Use module-level constants like `NO_TOOLS = []` (ProjectDialog.tsx:13) and `useMemo` over stable slices (Board.tsx:132).
- `getState()` gives non-React access.

**Actions**
- `upsertFeature`, `removeFeature`, `upsertProject`.
- `loadProjects()`: projects + settings, then `loadFeatures` for **every** project, so the sidebar counts work everywhere.
- `loadFeatures(pid)`.
- `setSettings` (merges).

**Pub/sub channels** (not stored): `onRunEvent`, `onRunUpdate`, `onNotification`, `onTerminal` (`terminal.*` messages). Run events and run lists live in component state; only `feature.run` is global.

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
| `terminal.updated` / `terminal.output` | `onTerminal` listeners |

## API client (`api.ts`)

- `req(method, url, body)` fetches `/api${url}`.
- On a non-2xx response it throws `ApiError(status, data.error, data)`. The parsed body is on `err.body`; for example `err.body.dirty` is used when removing a worktree.
- The `api` object has one function per endpoint in [api.md](api.md): `settings`, `updateSettings`, `projects`, `validatePath`, `createProject`, `updateProject`, `deleteProject`, `features`, `createFeature`, `updateFeature`, `deleteFeature`, `reorder`, `cancel`, `retry`, `openEditor`, `reveal`, `session`, `openTerminal`, `terminalState`, `runTerminal`, `stopTerminal`, `clearTerminal`, `resetTerminalCwd`, `followUp`, `launchPreview`, `removeWorktree`, `runs`, `changes`, `setDependencies`, `gate`, `continuePipeline`, `createPr`, `diff`, `catalog`, `searchFiles`, `validationPreview`, `githubStatus`, `setGithubToken`, `testNotification`, `events`, `report`.
- Types: `SettingsResponse`, `SessionInfo`, `LaunchPreview`, `ProjectInput`, `GateAction`.

## Layout and components

### `App.tsx`

The root has the `app-backdrop` (CSS "clouds").

**Sidebar** (`w-64`, a floating `metal-glass` panel)
- Brand: the `Logo` (`components/Logo.tsx`), "Kanbuild" in `chrome-text`, and a connection dot: "local backend connected" or "reconnecting…".
- Project list (the active row is a `metal-raised` pill):
  - A gold `metal-gold` "N waiting" pill (from `needsAttention`).
  - A cyan dot chip for the active count.
  - A trash button on hover that removes the project from the dashboard only.
- Footer: the Settings button and `ThemeToggle`.

**Main area**
- An **out-of-sync banner** (gold bar) when `settings.apiVersion !== API_VERSION`, suggesting a rebuild via `npm start`.
- **Top bar** (Emergent-style): an accent "Board" pill tab, a chip tab with the project name, then the **base-branch switcher** (`BranchSwitcher`, a raised mono pill) and the path in muted mono. On the right: a gold "est. ~$" cost pill, a `chrome` "Project settings" button and an accent "New feature" button.
- The `Board`.
- **No-project hero:** a "Local-first" pill, the `chrome-text` headline "What will you build today?", a card with "Register your first project" and **Add project**, and three step chips (register → add feature → drag to Build).

**Root-level mounts:** ProjectDialog, FeatureDialog, SettingsDialog, AgentDetailSheet, `ConfirmHost`, `Toaster`.

**Selected project:** stored in localStorage `orch:lastProject`.

**Notifications:**
- When the tab is hidden and permission is granted, a desktop `Notification`. Clicking it focuses the window, selects the project and opens the detail sheet.
- Otherwise a toast (error tone when `level === 'error'`).

### `Board.tsx`

The board always shows its three columns, even for an empty project.

**Auto-start:** `autoStart = project.pipeline.autoStart ?? settings.autoStartBuild`, read with primitive store selectors. When it is off, the Backlog and Build hints mention ▶.

**Columns** (translucent `metal-glass` trays; a drop target gets `shadow-glow`):
- **Backlog**: "Drag a card into Build to start an agent". It has the only + button, and a compact `FeatureComposer` ("Quick add a feature…") at the top that expands on focus.
- **Build**: "X running · Y queued · limit N concurrent (global) · Z ready to start" (`isReadyToStart`).
- **Done**.

Cards are sorted by `position`, then `createdAt`.

**Drag and drop**
- Cards are dragged optimistically through local `cols`, which re-sync from the server only when no drag is active.
- Sensors: Pointer (6 px activation distance, so a click still opens the card) and Keyboard.
- `columnFirstCollision` (46-58) gives the column under the pointer priority over cards.
- `onDragEnd`:
  1. Leaving Build with an active agent → destructive confirm, then `confirmCancel:true`.
  2. Done → Build → confirm "Start a new agent run?" (only when auto-start is on; otherwise the card just waits).
  3. `api.updateFeature({status})`, then `api.reorder`. The "Agent queued" toast shows only if the returned feature is `queued`.
  4. On an error or a declined confirm, reset to the server columns.

### `FeatureComposer.tsx`

The compact quick-add at the top of the Backlog column, built on the `Composer` primitive.
- It shows a one-line title input (`aria-label="Feature title"`) until focused. It then expands into priority "folder tabs" (Low / Normal / High), a `MentionTextarea` description and the footer.
- **Cmd/Ctrl+Enter** or the round accent arrow calls `api.createFeature(projectId, {title, description, priority})`, the same call as `FeatureDialog`. Errors go to `toastError`. Esc on an empty composer collapses it.
- "More options" opens the full `FeatureDialog` (dependencies…).

### `FeatureCard.tsx` + `status.tsx`

**Card appearance** (`metal-surface` + `sheen` hover sweep, slight hover lift)
- Red hairline on failure, gold glow (`shadow-gold-glow`) when waiting (gate or paused), an animated accent line on top while running (`running-edge`), dashed for a blocked backlog card.
- The PR link is a green pill.
- Shows: status badge, `PipelineChip`, `runLabel · #attempt`, `RunProgress`, current activity, error, duration, tokens, cost, branch.
- PR link: its pointerdown is stopped so it doesn't start a drag.
- **Ready to start** (`isReadyToStart`: in Build, no `agentStatus`, no gate; only happens with auto-start off): a gray "Ready to start" badge and a round accent ▶ button (`aria-label="Start build"`) instead of the status badge. Its pointerdown and keydown are stopped. A click calls `api.startFeature`. `RunProgress` renders nothing for a ready card, so the previous cycle's bar is hidden.
- Note for tests: the sortable wrapper has `role="button"` (dnd-kit attributes), so its accessible name contains the card text, including "Start build". Match the ▶ button with `exact: true`.

**`status.tsx` helpers**
- `isActive`, `isPaused` (build + completed + no gate → needs "Continue"), `isWaiting`, `needsAttention` (waiting, or Build + failed).
- `STATUS_META`, `GATE_META`. Gate and Paused chips use the `gold` badge; `PriorityBadge` and the step chip use dotted badges.
- `runLabel` by kind, `roleLabel`.
- `RunProgress`: indeterminate when running without a reported progress.
- `newTokens` (excludes cache reads), `runCost` (estimated ?? reported).
- `PriorityBadge`.

### `BranchSwitcher.tsx` (project header)

- A `GitBranch` chip showing a small "base" label and `project.baseBranch` (`aria-label` "Base branch for new features: …"). Clicking it opens a popover (absolute panel; outside click or Esc closes it). Keyed by project ID in `App.tsx`, so it resets when switching projects.
- On every open it reloads branches via `api.validatePath(project.path)` (no dedicated endpoint) and marks the repo's checked-out branch.
- A filter input narrows the list. Choosing a branch calls `api.updateProject(id, {baseBranch})`, then `upsertProject` and a toast. The server rejects unknown branches (toast error).
- It only changes the ref **new** features branch from. Existing features keep `feature.baseRef`, and the repo's own checkout is never touched (no `git checkout`), so the user's IDE stays on its branch. The popover says so at the top, and its footer points to the feature's Terminal tab / Open in editor for trying a feature.

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
- **Pipeline**:
  - "When a card enters Build" select: use the global setting (the label shows its current value) → `autoStart: null`, start automatically → `true`, or wait for ▶ → `false`.
  - Toggles: Plan, Approve plan (needs Plan), Validate, Tester, Reviewer, Final approval. Also:
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
- The early `return null` (around line 495) comes **after all hooks**.

**Header actions**
- Edit, Start build (when `isReadyToStart`), Cancel agent, Retry `<step>`, Continue pipeline (when paused, a `gold` button), Stop pipeline (when gated).
- PR #N link, or Create PR (needs a GitHub token).
- Open in editor, Delete.
- A run selector when there is more than one run.

`GatePanel` renders above the tabs when `feature.gate` is set.

**Tabs**
1. **Overview**
   - **Finished features open on the chat composer.** `continueFirst` is true when nothing is active, there is no gate, the feature is not paused, and it is Done or completed. `ContinueSession` then renders first, above the progress. Otherwise it stays below the stats (for example failed or cancelled). It renders once either way.
   - Stage and progress, activity, error.
   - `ReviewSection`: findings with file:line links that jump to the Changes tab.
   - Plan, questions.
   - Stats grid: duration, new tokens, est. cost, model, turns, context, cache reads, denials, token breakdown.
   - `ContinueSession`, "Keep working on this feature": a `Composer` with a `MentionTextarea` (`aria-label="Follow-up message"`) and suggestion chips ("Add tests for ", "Fix a bug: ", "Refactor ", "Update docs for ") that prefill the message.
     - Cmd/Ctrl+Enter or the arrow calls `api.followUp`. A follow-up always starts right away, even with auto-start off.
     - A collapsed `<details>` "Continue in a terminal instead" holds the resume command, Copy and Open in Terminal (macOS).
   - The run message, description, metadata.
2. **Pipeline** (`PipelineTab.tsx`)
   - Step chain from the config: Plan → Approve plan → Develop/Follow-up (+ N fix rounds) → Validate → Tests → Review → Your approval → Done.
   - Step states come from the latest cycle's runs.
   - Run list grouped by cycle, with costs.
   - Clicking a run selects it (validator → Tests tab, otherwise Report).
3. **Activity**
   - `api.events` backfill plus live `onRunEvent` events, deduped by id.
   - Filters: all, tools, problems (`Chip`s).
   - Rows are Emergent-style tool-call rows: `tool_use`/`tool_result` rows are raised metal pills (a result gets a green check), errors and warnings are tinted.
   - Auto-scroll; click a row to expand its detail.
4. **Changes**
   - `api.changes`: branch, base, commits, files, and a docs badge (`isDocPath`: `docs/`, `agent-docs/`, `CLAUDE*.md`, `README*.md`).
   - Actions: Refresh, Open, Reveal, Copy path.
   - **Remove worktree** is a two-step confirm: on a 409 `dirty` response it asks again with `force`.
   - Note: "Branches are never merged automatically".
   - Followed by the `DiffViewer`.
5. **Tests / Validation**: for validator runs, a `<details>` per command (open when failed); otherwise the self-reported tests and build.
6. **Report**: `report.markdown` rendered with `Markdown` in `.prose-report`.
7. **Terminal** (`TerminalTab.tsx`): run shell commands in the feature's worktree (server: [git-worktrees-validation.md](git-worktrees-validation.md#terminal-command-runner-terminalts)).
   - Header: the worktree path, "N running", Clear (finished sessions).
   - One `metal-surface` block per command: `$ command`, a running badge + Stop, or duration + `exit N` / signal badge; output in a `<pre>` (max-h-96), "earlier output trimmed" when `outputStart > 0`. Auto-scrolls while the user is at the bottom.
   - Current directory: `cd` persists (kept by the server). The prompt shows it before `$` via `displayDir()` (`<worktree-name>`, `<worktree-name>/server`, or an absolute path outside the worktree; `data-testid="terminal-cwd"`), with a ↺ button (`aria-label="Back to worktree root"`) when it isn't the root. `cwd`/`root` come from the backfill and from `terminal.updated` messages whose `endCwd` differs from the start dir. A command block shows its start dir when it isn't the root; a `cd` with no output shows "now in <dir>".
   - Prompt: `$` input (`aria-label="Terminal command"`); Enter runs; ↑/↓ walk the history in localStorage `orch:termHistory` (50 max).
   - **Command shortcuts** (chips above the prompt, `aria-label="Command shortcuts"`): clicking one runs it.
     - `DEFAULT_PRESETS` = `git status`, always first and not removable.
     - The user's saved shortcuts live in localStorage `orch:termPresets:<projectId>` (per project, per browser, 30 max, deduped). Each has a × on hover/focus (`Remove shortcut <cmd>`).
     - The round **+** chip (`Add command shortcut`) enters save mode: the input's placeholder becomes "Save a command" (`aria-label="Command to save"`), the + turns into a **Save** chip (disabled until something is typed) with a cancel ×, and the run ↵ button is hidden. Enter saves. In save mode the input works even while the agent is running.
     - Esc cancels save mode **without closing the sheet**: a window capture `keydown` listener calls `preventDefault()` before Radix's document listener, which then skips dismissing. React's `stopPropagation` is too late for this.
   - Disabled with a hint when there is no worktree or the agent is active (`isActive(feature.agentStatus)`).
   - Sync: subscribes to `onTerminal` **before** the backfill fetch, and re-fetches whenever `connected` flips (missed WS messages aren't replayed). Chunks merge by `offset` (`applyChunk`), and the backfill merge keeps sessions it doesn't list and never downgrades an exited session to running.

### `GatePanel.tsx`

Rendered as an Emergent "agent has questions" card: a gold-glow `metal-surface` with a gold header strip ("The agent is waiting for you · Checkpoint"). Approve actions are accent buttons; request-changes actions are `chrome`.

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
- Agent profile (with `PROFILE_HELP`), effort, budget per run, max concurrent agents (1-16).
- "Start the agent automatically when a card is moved into Build" (`autoStartBuild`).
- Default model.
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

The landing page (`landing/`) imports these, plus `Logo.tsx` (and its `assets/logo.png`), `lib/utils.ts` and `index.css`, directly through its `@` → `web/src` alias. Keep them free of dashboard-only imports (store, api), or the landing build breaks. See [landing-page.md](landing-page.md).

| File | Contents |
|---|---|
| `button.tsx` | variants default (`metal-accent`), destructive (`metal-danger`), outline / secondary (`metal-raised`), `chrome` (graphite pill), `gold` (attention CTA), ghost, link; sizes default, sm, lg, icon, `pill`, `icon-round`; `asChild` |
| `badge.tsx` | rounded-full pills: default, secondary, outline, red, amber, green, blue, violet, `gold`, gray (with dark variants); `dot` adds a leading status dot |
| `composer.tsx` | `Composer({tabs, children, footerLeft, hint, onSend, canSend, sending, sendLabel, showFooter, suggestions, onSuggest, size})`: Emergent prompt card with a round send arrow and optional suggestion chips; `composerTextareaClass` makes a borderless textarea for it |
| `chip.tsx` | `Chip({active, dot, icon})`: rounded-full `metal-raised` button for suggestions, filters and step chips |
| `dialog.tsx` | `DialogContent` (centered with `inset-0 m-auto h-fit`, **not** translate, so its scale animation grows from the middle; max-w-lg, `metal-surface rounded-2xl`, blurred overlay), `SheetContent` (right side, `sm:max-w-3xl`), round chrome close button, header, footer, title, description |
| `tabs.tsx` | Radix tabs styled as folder tabs: a hairline baseline, the active tab is a raised metal tab |
| `input.tsx` | `Input`, `Textarea` (`metal-inset` wells, accent focus ring), native `Select` (`metal-raised`), `Label`, `Field({label, hint})` |
| `progress.tsx` | `Progress({value|null, tone})` with a `metal-inset` track and a glossy gradient bar; `null` is indeterminate (`animate-indeterminate` keyframe) |

## Styling conventions

**Look: Emergent-inspired metallic.** The reference is Emergent ("Build apps with AI") on Mobbin: atmospheric backgrounds (charcoal smoke in dark, sky in light), brushed-metal cards with an inset top highlight, chrome and graphite buttons, a cyan (dark) / blue (light) accent, gold "credits" pills, folder tabs over a prompt composer, and rounded-full chips.

**Tokens and theming**
- shadcn-style HSL CSS variables in `index.css` (`:root` = light, `.dark`), mapped in `tailwind.config.js`. `--primary` is blue (light) / cyan (dark). `darkMode: ['class']`, `--radius: 0.75rem`.
- Extra tokens: `--metal-hi/lo`, `--metal-raised-hi/lo`, `--metal-inset-hi/lo`, `--metal-edge`, `--metal-highlight`, `--metal-shade`, `--sheen`, `--accent-hi/lo/glow`, `--gold(-hi/-lo/-foreground)`, `--chrome-*`, `--chrome-text-*`, `--scrollbar`.
- Tailwind extras: colors `gold`, `metal` (`border-metal-edge`), shadows `shadow-glow` (accent ring) and `shadow-gold-glow`.

**Metallic utilities** (`@layer components` in `index.css`)

| Class | Use |
|---|---|
| `app-backdrop` | Page background: layered radial-gradient clouds. Pure CSS |
| `metal-surface` | Cards, dialogs, panels: brushed gradient, hairline, inset highlight, soft shadow |
| `metal-glass` | Translucent, blurred surface (sidebar, board columns) |
| `metal-raised` | Chrome button / chip body; hover brightens, active presses in |
| `metal-inset` | Recessed wells: inputs, `<pre>`, stat lists |
| `metal-accent` | Glossy primary button (blue / cyan) with an accent glow |
| `metal-gold` | Attention / waiting / cost pills |
| `metal-chrome` | Graphite pill button |
| `metal-danger` | Red metallic destructive button |
| `chrome-text` | Silver-to-accent gradient headline text |
| `sheen` | Diagonal light sweep on hover (uses `::after`) |
| `running-edge` | Animated accent line on top of a running card (uses `::before`) |

### Motion

The keyframes live in `web/tailwind.config.js` (`theme.extend.keyframes` / `animation`). Entrances use a soft spring (`cubic-bezier(0.16, 1, 0.3, 1)`, 160–320 ms). Exits are shorter, ease-in and `forwards`, so Radix keeps the node mounted until the exit animation ends.

| Class | Used by |
|---|---|
| `animate-overlay-in/out` | Dialog and sheet backdrops (fade) |
| `animate-dialog-in/out` | `DialogContent`: fade + rise 12px + scale 0.96 → 1, from the centre |
| `animate-sheet-in/out` | `SheetContent`: slide in from the right edge |
| `animate-pop-in` | `BranchSwitcher` popover, `MentionTextarea` `@file` menu (origin at the anchor) |
| `animate-toast-in` | Toasts (rise + scale from the bottom-right stack) |
| `animate-fade-up` | `TabsContent` when a tab becomes active |
| `animate-lift` | The card in the drag overlay (`FeatureCardView dragging`): tilt + scale up |

**Gotcha:** a keyframe sets the whole `transform`, so never position an animated element with `-translate-x/y-1/2`. The animation replaces the centering, and the element appears to fly in from the bottom-right corner (this was the old dialog bug). Don't animate the sortable card wrapper either, because dnd-kit drives its `transform` inline.

Under `prefers-reduced-motion`, these animations collapse to 1 ms (spinners and progress bars keep moving), and `sheen` / `running-edge` are disabled. Scrollbars are thin metallic thumbs. `.prose-report` code blocks use `metal-inset`.

**Status colors**

| Color | Meaning |
|---|---|
| amber / gold | waiting or attention |
| sky / cyan (`primary`) | running or info |
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
4. **localStorage keys:** `orch:lastProject`, `orch:diffMode`, `orch:theme`, `orch:termHistory` and `orch:termPresets:<projectId>`. Every access is wrapped in try/catch.
5. **No UI action merges branches.** Create PR pushes the branch and opens a PR.
6. Costs are always labeled "est.".
7. **Textareas with `bg-none`** (no metal gradient) also need `bg-transparent`, or the browser's dark form-field color shows through.
8. `sheen` sets `overflow: hidden`, so don't put popovers inside an element that uses it.
