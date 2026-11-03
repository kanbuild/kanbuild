# GitHub integration and pull requests

Source files: `server/src/github.ts`, `server/src/pr.ts`

The orchestrator only **pushes branches and opens PRs**. It never merges, never force-pushes and never deletes branches.

## Token (`github.ts`)

**Sources**
- `getToken()` (line 18): `ORCH_GITHUB_TOKEN` (source `env`) wins over the file `DATA_DIR/github-token` (source `file`).
- The token file is mode 0600, re-applied with chmod after each write.

**Setting the token.** `setToken(token)` (line 36):
- An empty token deletes the file.
- Otherwise the token must match `/^[\w-]{20,255}$/` and pass `GET /user` before it is written.

**Status**
- `githubStatus()` returns `{configured, source, login}` with a cached login.
- `verifyToken()` re-checks the token.

**Exposure**
- Exposed via `GET`/`PUT /api/settings/github`. The token is never returned to the browser.
- The token is stripped from every child process's environment (`childEnv`).

## API client

- **`parseRemote(url)`** (line 68): handles scp-style `git@host:o/r.git`, `ssh://`, `https://` and `git://`. Returns `{host, owner, repo}`.
- **`apiBase(host)`** (line 77):
  - `ORCH_GITHUB_API_URL` if set.
  - Otherwise `https://api.github.com`.
  - For a GHE host: `https://<host>/api/v3`.
- **`ghFetch(method, path, body, token, host)`** (line 82):
  - Bearer token, `X-GitHub-Api-Version: 2022-11-28`, 20 s timeout.
  - Network failure → `GithubError(502, "Could not reach GitHub… network, VPN or proxy")`.
  - 401 → a friendly message.
  - Other errors include the `errors[]` details.
- **`findOpenPr(repo, branch)`**: `GET /repos/o/r/pulls?state=open&head=owner:branch`.
- **`createPullRequest(repo, {head, base, title, body, draft})`**.

## Authenticated push

- `askpassScript()` writes `DATA_DIR/git-askpass.sh` (mode 0700). It answers `x-access-token` for the username and `$ORCH_GIT_TOKEN` for the password.
- `gitWithToken(cwd, args)` sets `GIT_ASKPASS` and `ORCH_GIT_TOKEN` only for that one git process. The token never appears in argv or git config, and errors are redacted (`***`).
- **`pushBranch(cwd, remote, branch)`** (line 161): `git push <remote> refs/heads/b:refs/heads/b`. **Never forces.**
- `remoteUrl(cwd, remote)`: a missing remote → 400. `remoteHasBranch`: `ls-remote --heads`.

## Create PR flow (`pr.ts`)

**`createPrForFeature(featureId)`** (line 59). Called by `POST /api/features/:id/pr`, or automatically by `complete()` when `pipeline.autoCreatePr` is on and a token exists.

1. Preconditions:
   - A token must exist (else 400).
   - No active agent (else 409).
   - The branch and worktree must exist (else 409).
2. `remote = pipeline.remote || 'origin'`, then `parseRemote`. A non-GitHub remote → 400.
3. `base = feature.baseRef || project.baseBranch`. **For a stacked feature, if the base branch isn't on the remote yet, it is pushed first.**
4. Push the feature branch from the worktree.
5. Reuse an existing open PR if `findOpenPr` finds one. Otherwise create a PR with `draft = pipeline.prDraft`. If GitHub returns a **422 mentioning "draft"** (drafts aren't available on every plan), it retries with `draft:false`.
6. Patch `prUrl` and `prNumber` on the feature and notify "Pull request #N ready" (success).
7. Error mapping: `GithubError` 401/400 → HTTP 400; anything else → 502. When auto-create fails, the error becomes a run event and an error notification.

**PR body.** `buildPrBody(feature, project)` (line 10) uses the reports from the **latest cycle** only. Sections, in order:
1. **Summary**: the first developer `feature`/`followup` report summary + implementation details (≤4000 characters).
2. `<details>` **Requirements** (≤6000 characters) and **Implementation plan** (≤8000 characters).
3. **Validation**: ✅/❌ per command from the last validator run.
4. **Tests**: from the tester report, or the last developer report.
5. **Automated review**: verdict, summary and finding severities.
6. **Documentation updated**: deduped across all reports.
7. **Outstanding issues**: from the last developer report.
8. **Footer**: "Implemented by Claude Code agents… Review before merging."

## UI

- Settings dialog → GitHub fieldset: connect, replace or remove the token. It shows the login and the token source.
- Detail sheet header: "Create PR" (disabled without a token) or a "PR #N" link. The card footer also shows the PR link.

Tests: `server/test/pipeline.test.ts` covers this against a mock GitHub HTTP server (see [testing.md](testing.md)).
