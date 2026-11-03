# Settings, projects, features, editor, notifications and pricing

Source files: `server/src/settings.ts`, `server/src/projects.ts`, `server/src/features.ts`, `server/src/editor.ts`, `server/src/notify.ts`, `server/src/pricing.ts`

## Global settings (`settings.ts`)

- Stored as key → JSON rows in the `settings` table.
- `getSettings()` (line 17) merges the stored rows over `DEFAULTS` (line 5).
- `updateSettings` (line 28) validates each key, **silently ignores** unknown or invalid values, and publishes `settings.updated`.

| Key | Default | Validation |
|---|---|---|
| `concurrency` | 2 | floor, clamp 1-16 |
| `agentProfile` | `lean` | `lean` or `full` |
| `effort` | `medium` | `''`, `low`, `medium`, `high`, `xhigh`, `max` |
| `maxBudgetUsd` | 0 (no cap) | ≥ 0; passed as `--max-budget-usd` |
| `defaultModel` | `''` | string |
| `editorCommand` | `vscode` | preset ID or custom command |
| `claudeBinary` | `$ORCH_CLAUDE_BIN \|\| 'claude'` | the **env var always wins** |
| `notifications` | `all` | `all`, `attention` or `off` |
| `systemNotifications` | true on darwin | boolean |

To add a setting:
1. Add it to `DEFAULTS` and the validation in `updateSettings`.
2. Add it to the `Settings` type.
3. Add a field in `SettingsDialog.tsx`.

## Projects (`projects.ts`)

**`createProject`** (line 167):
- `path` is required. It is `~`-expanded, resolved, and validated by `validateRepoPath`: it must be a git repo root with at least one branch.
- A duplicate path → 409.
- Defaults:
  - `baseBranch` = the current branch, else the first branch. It must exist.
  - `name` = the suggested name.
  - `worktreeRoot` = `<repo>-worktrees`.
  - `allowedTools` = `DEFAULT_ALLOWED_TOOLS`.

**`updateProject`** (line 221):
- `path` is immutable (400).
- A new `baseBranch` must exist.
- `pipeline` and `roles` are **merged** over the existing values via `cleanPipeline`/`cleanRoles`.
- `mcpServers` and `skills` are replaced.
- An empty `name` or `worktreeRoot` keeps the old value.

**`deleteProject`**: 409 if any agent is active. Removes DB rows only.

**Defaults and normalisers**
- **`DEFAULT_ALLOWED_TOOLS`** (line 54): Read, Edit, Write, Glob, Grep, plus `Bash(…)` for:
  - git status, diff, log, add, commit, show, branch, rev-parse
  - npm, npx, pnpm, yarn, node
  - ls, cat, head, tail, wc, grep, mkdir
- **`DEFAULT_PIPELINE`** (line 7): see [pipeline.md](pipeline.md#overview).
- **`cleanPipeline`** (line 22):
  - Non-boolean values fall back to the base value.
  - `maxFixLoops` is floored and clamped to 0-5.
  - `validationCommands` are trimmed, empty entries dropped, max 20.
  - `remote` must match `/^[\w.-]+$/`.
- **`cleanRoles`** (line 43): `{model, effort}` per role in `CLAUDE_ROLES`.
- **`cleanNames`** (line 126), for MCP and skill lists: trimmed strings, deduped, ≤200 characters each, ≤100 entries.
- `agentProfile` accepts `''`, `lean` or `full`; `effort` accepts `''` or a valid effort. `''` means **inherit the global setting**.

**`HttpError(status, msg)`** (line 82) is the error class used across the server.

**Override precedence** (resolved by `resolveLaunchConfig`, [orchestrator-and-agents.md](orchestrator-and-agents.md)):
- role (`roles_json`) → project → global settings.
- Project-level overrides: `model`, `agentProfile`, `effort`, `mcpConfig`, `allowedTools`, `mcpServers`, `skills`, `pipeline`, `roles`.

## Features (`features.ts`)

- **Values:** statuses `backlog | build | done`; priorities `low | medium | high`. An invalid priority becomes `medium` on create, or keeps the old value on update.
- **`createFeature`** (line 129): `title` is required (trimmed). Starts in backlog at the bottom (`nextPosition`, line 115).
- **`rowToFeature`** (line 11) adds computed fields (several queries per feature, an N+1 pattern):
  - `totals {runs, costUsd = Σ COALESCE(estimated, reported), newTokens = input + output + cache_creation}`
  - `dependsOn`, `blockedBy` (dependencies not Done, line 44)
  - `run` (the `publicRun` of `current_run_id`)
- **`patchFeatureState`** (line 186): the generic state writer for status/session/gate/etc. `gate` is stored as JSON; `silent` suppresses the publish.
- **Moves and order**
  - `moveFeature` (line 203): bottom of the target column, or the **top** of Done.
  - `reorderFeatures`: positions become `(i+1)*1000`.
  - Status changes go through `PATCH /features/:id` ([api.md](api.md#patch-featuresid-status-semantics-apits159-183)).
- **`setDependencies`** (line 62): rejects self, unknown IDs, other projects' features, and cycles (`findCycle`).
- **`deleteFeature`** (line 220): publishes `feature.deleted` and re-publishes its dependents. The branch and worktree stay on disk.
- **`publishFeature`** (line 107) → `feature.updated`.

## Editor, reveal, terminal (`editor.ts`)

**Presets.** `EDITOR_PRESETS` (line 16):
- `vscode` (`code` + the app-bundle CLI path)
- `cursor`, `zed`, `webstorm`
- `intellij` (`idea`)
- `finder` (the platform file manager)

**Finding the binary**
- `EXTRA_BIN_DIRS`: `/usr/local/bin`, `/opt/homebrew/bin`, `~/.local/bin`. A backend started outside a shell has a minimal PATH.
- `findExecutable(cmd, extraPaths)` (line 34).

**Resolving the command.** `resolveEditorCommand(setting, target, platform)` (line 70):
- For a preset: try PATH, then the extra dirs, then the bundle paths, then `open -a <App>` on macOS. If none works, throw `EditorError` with install hints.
- Otherwise the setting is treated as a custom command (or a macOS app name).

**Other helpers**
- `revealCommand`: `open` (macOS), `explorer` (Windows) or `xdg-open`.
- `launch(cmd)` (line 109): detached spawn.
- `openTerminalCommand(command)` (line 125): macOS only. Uses `osascript` to make Terminal run the resume command.
- `appleScriptString` (line 120) escapes strings for AppleScript.

## Notifications (`notify.ts`)

- `setClientCounter(fn)`: index.ts registers the number of open WS tabs.
- `shouldNotify(mode, level)` (line 20):
  - `off`: nothing.
  - `attention`: only `attention` and `error` levels.
  - `all`: everything.
- `notify(n)` (line 30):
  - Publishes a `notification` WS message. The browser shows a desktop Notification when the tab is hidden, otherwise a toast.
  - Also sends a macOS `osascript` banner when `systemNotifications` is on, the platform is darwin, and **no dashboard tab is connected**.
- `systemNotificationArgs`: title ≤120 characters, body ≤240, escaped.
- Which transitions notify: [pipeline.md](pipeline.md#notifications-by-transition-levels-see-notifyts).

## Pricing and cost (`pricing.ts`) — estimates only

**Price formula.** `p(input, output, cacheRead = 0.1×input)`; cache write = 1.25× input (5-minute TTL); 1-hour cache write = 2× input.

**`TABLE`** (line 28), USD per million tokens. It is matched by **prefix, in order**, so more specific IDs must come first:

| Prefix | In | Out | Cache read |
|---|---|---|---|
| `claude-fable-5-1`, `claude-mythos-5-1` | 10 | 50 | 0.25 |
| `claude-fable-5` | 10 | 50 | default |
| `claude-opus-5-5` | 4 | 20 | 0.2 |
| `claude-opus-5`, `claude-opus-4-5`…`4-8` | 5 | 25 | default |
| `claude-opus-4-1`, `claude-opus-4` | 15 | 75 | default |
| `claude-sonnet-5-5` | 2 | 10 | 0.2 |
| `claude-sonnet-5` | 2 | 10 | default |
| `claude-sonnet-4`, `claude-3-7-sonnet` | 3 | 15 | default |
| `claude-haiku-5-5` | 0.1 | 0.5 | 0.01 |
| `claude-haiku-4-5` | 1 | 5 | default |
| `claude-3-5-haiku` | 0.8 | 4 | default |

**Aliases:** opus → `claude-opus-5-5`, sonnet → `claude-sonnet-5-5`, haiku → `claude-haiku-5-5`, fable → `claude-fable-5-1`.

**Functions**
- `priceFor(model)` (line 57): lowercases, strips a `[...]` suffix and a Bedrock prefix (`anthropic.`, `us.anthropic.`, `eu.anthropic.`), resolves aliases. An unknown model → null cost.
- `estimateCost(usage, model)` (line 67): 1-hour cache writes are `min(cacheCreation1h, cacheCreation)`; the rest is billed at the 5-minute rate.
- `estimateCostByModel(byModel)` (line 83): sums the models with a known price.

**Cost flow**
- **Live:** `estimateCost(parser.usage, model)`.
- **Final:** prefer the per-model breakdown from the `result` event. `reportedCostUsd` = Claude Code's `total_cost_usd`.
- **Validator runs** cost $0.
- **Feature totals** sum all runs.
- **UI:** "est." labels. "New tokens" excludes cache reads.
