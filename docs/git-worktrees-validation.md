# Git, worktrees, diffs, dependencies and validation

Source files: `server/src/git.ts`, `server/src/diffParse.ts`, `server/src/dependencies.ts`, `server/src/validation.ts`

## git.ts

### Core helpers

- `git(cwd, args, {allowFail})` (line 13): `execFile` with a 32 MB buffer and `GIT_TERMINAL_PROMPT=0`. Throws `GitError` unless `allowFail`. `gitOk` returns success only.
- `isMerged(repo, branch, into)` (line 33): true if the branch no longer exists; otherwise `merge-base --is-ancestor`.
- `expandHome`.
- `slugify(s, 40)`: lowercase, NFKD, non-alphanumerics become `-`, fallback `feature`.

### Repo validation

`validateRepoPath` (line 56):
- Checks that the path exists, is a directory, is a git repo and is the repo root (`rev-parse --show-toplevel`).
- Lists branches and the current branch.
- Errors when the repo has no commits.
- Suggests `<parent>/<name>-worktrees` as the worktree root.

### Worktree lifecycle

**Naming.** `allocateBranchAndPath(repo, worktreeRoot, title, featureId)` (line 94):
- Branch: **`feature/<slug>-<short>`**.
- Worktree: **`<worktreeRoot>/feature-<slug>-<short>`**.
- `short` = the first 6 characters of the feature ID after its prefix.
- On a collision it tries suffixes `-1`…`-49`, then throws.

**Create and remove**
- `createWorktree(repo, path, branch, baseRef)` (line 111): `git worktree add -b <branch> <path> <baseRef>`. Errors if the path already exists.
- `removeWorktree(repo, path, force)` (line 122): without `force`, a dirty worktree is refused. A missing path just prunes. **Branches are kept.**
- `isWorktreeDirty`, `headCommit`.
- Nothing is ever merged, rebased or deleted automatically, and the main checkout is never modified.

### Change summary

`collectChanges(worktree, branch, baseRef)` (line 147) builds the `Changes` object shown in the UI Changes tab and in reports:
- Commits: `merge-base..HEAD`.
- Committed files: `diff --name-status -M`. A/C → created, M/T → modified, D → deleted, R → renamed.
- Then `status --porcelain -uall` adds uncommitted and untracked files (`committed:false`).
- Results are sorted by path.

### Diffs

`getDiff(worktree, baseRef, scope, file?)` (line 218):

| Scope | Compares |
|---|---|
| `all` | Working tree vs merge-base, including untracked files |
| `committed` | `mergeBase..HEAD` |
| `uncommitted` | Working tree vs HEAD, including untracked files |
| `commit:<sha>` | `git show <sha>` (sha validated as 4-40 hex characters) |

- Untracked files (≤50) are diffed with `--no-index /dev/null <file>`, so the index is never touched.
- Git options: `-c core.quotePath=false --no-color --no-ext-diff -M -U3`.
- Budget: `MAX_DIFF_LINES = 4000` in total, or `MAX_FILE_LINES = 20000` for a single-file request. Over-budget files get `hunks=[]` and `truncated:true`; the UI then offers "Load diff" per file.

## diffParse.ts

`parseUnifiedDiff(raw): DiffFile[]` (line 25):
- Handles `diff --git` headers, including quoted, C-escaped or space-containing paths (split at `" b/"`).
- Handles new and deleted modes, `rename from/to`, binary markers, and `---`/`+++ /dev/null`.
- Parses `@@` hunk headers with old and new line numbers. Line kinds: `add`, `del`, `context`, `meta` (`\ No newline`).
- Counts additions and deletions. `oldPath` is cleared when it equals `path`.

## dependencies.ts

- **`findCycle(graph, featureId, dependsOn)`** (line 6): DFS that returns the cycle path or null. `setDependencies` uses it to reject a cycle with "That would create a dependency cycle: A → B → A".
- **`chooseBaseRef(baseBranch, deps[{title, branch, merged}])`** (line 30):

  | Unmerged dependencies with a branch | Result |
  |---|---|
  | none | `{ref: baseBranch, stackedOn: null}` |
  | exactly one | `{ref: dep.branch, stackedOn: title}` (**stacking**) |
  | more than one | `{error: "Cannot stack on several unmerged dependencies… Merge all but one…"}` (fails the run) |

- **Blocking** is decided in `tick()` (orchestrator): a feature whose dependencies are not **Done** waits, but only before it has a worktree.
- Done ≠ merged: `isMerged` decides whether the new branch starts from the base branch or is stacked.
- `feature.baseRef` stores the ref the branch was created from. Diffs and PRs use `baseRef || project.baseBranch`.

## validation.ts (no agent, no tokens)

**Constants:** `DEFAULT_TIMEOUT_MS` = 10 min per command; `OUTPUT_TAIL_LINES` = 200.

**`detectValidationCommands(dir)`** (line 21). Checks the repo root only, so monorepos must configure commands explicitly.
- **package.json:**
  - Package manager: pnpm if `pnpm-lock.yaml`, yarn if `yarn.lock`, otherwise npm.
  - Order: typecheck (first of `typecheck`, `type-check`, `tsc`), then `test` (unless it contains "no test specified"), then `build`.
  - Form: `npm test` / `npm run <script>`, or `pnpm <script>` / `yarn <script>`.
- **Cargo.toml:** `cargo test`.
- **go.mod:** `go vet ./...` and `go test ./...`.
- Otherwise: `[]` with source "none detected". The validate step is then **skipped silently**.

**`installCommand(dir)`** (line 46). Only when `package.json` exists and `node_modules` is missing (fresh worktrees):

| Lockfile | Command |
|---|---|
| `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` |
| `yarn.lock` | `yarn install --frozen-lockfile` |
| `package-lock.json` | `npm ci` |
| none | `npm install --no-save --no-package-lock` |

It never writes a lockfile.

**`resolveValidationCommands(configured, worktree)`** (line 54): configured commands win (source "project settings"); otherwise auto-detect in the worktree.

**`ValidationRun(cwd, commands, cb, timeoutMs)`** (line 67):
- Runs commands sequentially and stops at the first failure or timeout.
- Each command: `/bin/sh -c`, detached group, `env = childEnv({CI:'1', FORCE_COLOR:'0', NO_COLOR:'1'})`.
- Output: ANSI codes stripped, 200-line tail kept.
- Timeout: SIGKILL the group and set `timedOut`.
- Exit codes: a spawn error → 127, a signal kill → 128.
- `cancel()`: SIGTERM, then SIGKILL after 3 s. `wasCancelled` reports it.

The UI's Project dialog shows detected commands via `GET /projects/:id/validation-preview`.
