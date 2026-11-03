# Prompts, agent self-reports and run reports

Source files: `server/src/prompt.ts`, `server/src/report.ts`, `server/src/files.ts` (`@file` search)

## Prompt structure (`prompt.ts`)

**Markers.**
- Every prompt starts with `<!-- orchestrator-role: <role> -->`.
- Fix prompts add `<!-- orchestrator-fix: <reason> -->`.
- `test/fixtures/fake-claude.mjs` reads these markers. **Keep them stable.**

**Shared sections**
- `CONTEXT_SECTION`: CLAUDE.md is already loaded; read only the relevant docs (e.g. `agent-docs/`); prefer docs over exploring code; don't re-read files.
- `CLARIFY_RULE`: ask (`needs_clarification`) only when a wrong guess would waste significant work. Answers come back to the same session.
- `PROGRESS_SECTION`: emit the `[[PROGRESS:planning|implementing|testing|finalizing]]` markers.
- `permissionsLine`: says whether edits are allowed and lists the allowed Bash prefixes, via `allowedBashCommands(allowedTools)` (line 54, `Bash(npm:*)` → `npm`).

**Report schemas.** Each asks the agent to end with one sentence, then **exactly one fenced json block**:
- `DEV_REPORT_SCHEMA`: `summary`, `implementation_details`, `tests{executed, passed, failed, not_run, output}`, `build{status, output}`, `docs_updated`, `needs_clarification`, `outstanding_issues`.
- `PLAN_REPORT_SCHEMA`: `summary`, `plan`, `needs_clarification`, `outstanding_issues`.
- `REVIEW_REPORT_SCHEMA`: `summary`, `review{verdict, summary, findings[{severity, file, line, message}]}`, `needs_clarification`, `outstanding_issues`.

**Test-hang prevention.** `testingRules(project)` (line 132) tells the agent to:
- Use the project's `validationCommands` or the package.json scripts.
- Never use watch mode, dev servers or anything interactive.
- Run Jest with `--watchAll=false --watchman=false --forceExit --maxWorkers=2`, and Vitest as `vitest run`.
- Set a Bash timeout ≤ `TEST_COMMAND_TIMEOUT_MS` (300 s, line 126).
- If a command hangs, report it in `outstanding_issues` instead of retrying or working around it (e.g. `node -e`).
- Pipe output through `tail -n 60`.

**Developer rules.** `devRules` (line 141):
1. Work only in the worktree. No branch switch, merge, rebase or push.
2. Implement fully, with tests.
3. Update docs per CLAUDE.md and commit them.
4. Run the relevant tests, then the full suite and build.
5. Commit and leave the worktree clean.
6. Follow the clarify rule.
7. Respect the permissions line.

## Builders

| Builder | Line | Notes |
|---|---|---|
| `buildPrompt(feature, project, branch, attempt, cfg, baseRef)` | 155 | Developer from scratch. Attempt > 1 adds "check git status/log and continue" |
| `buildPlanPrompt` | 168 | Planner, read-only; plan proportional to the feature size |
| `buildReplanPrompt(feedback)` | 188 | Resumed planner; revise the plan |
| `buildImplementPlanPrompt(project, branch, cfg, comment)` | 199 | Resumed planner session becomes the developer: "You may edit files from now on" |
| `fixMessage(reason, data)` | 218 | Validation: failed results with the last 60 lines each. Review: summary + numbered findings. User: the comment |
| `buildFixPrompt(reason, message, project, branch, cfg)` | 225 | Validation fixes: "Do not weaken, skip or delete tests" |
| `buildTesterPrompt` | 244 | Uses `git log base..HEAD` / `git diff base...HEAD --stat`. Change production code only for genuine bugs; commit the tests |
| `buildReviewerPrompt` | 265 | Read-only. `changes_requested` only for blocker or major findings; cite file:line |
| `formatAnswers(questions, answers)` | 288 | Q/A pairs; an empty answer → "(no answer — use your best judgement)" |
| `buildAnswerPrompt(role, qa)` | 293 | |
| `buildFollowupPrompt(message, branch)` | 303 | Includes referenced files |

The project's launch-preview endpoint renders these builders for a fake feature, so the user can inspect them in the Project dialog.

## `@file` references

**Search API** (`files.ts`). `GET /projects/:id/files` calls:
- `listRepoFiles` (files.ts:8): `git ls-files --cached --others --exclude-standard -z`. Deduped, capped at 50,000, cached 30 s per repo.
- `rankFiles` (files.ts:27): case-insensitive ranking: exact basename < basename prefix < basename substring < path prefix < path substring < fuzzy subsequence. Ties go to the shorter path, then alphabetical. An empty query returns the shortest paths first.

**Prompt side** (`prompt.ts`):
- `extractFileRefs(text)` (line 61):
  - Regex `(?:^|[\s(\[])@([^\s@\`'"()\[\]<>]+)`. Emails don't match because `@` must follow whitespace, `(` or `[`.
  - Strips trailing punctuation.
  - Rejects `..` and absolute paths.
  - Dedupes and caps at 50.
  - Mirrored in `web/src/lib/utils.ts` — keep the two in sync.
- `referencedFilesSection(text, repoPath)` (line 71) adds a "**Referenced files**" list. A path missing from the base checkout is marked "(not found in the base checkout — it may not exist yet)".
- It is used for feature descriptions (`featureSection`, line 81) and follow-up messages.

## Self-report parsing (`report.ts`)

**`extractSelfReport(text)`** (line 82):
- Candidates are every fenced block, plus the span from the first `{` to the last `}`.
- They are tried **last first**. The first that parses and contains any of `summary`, `tests`, `plan`, `review` or `needs_clarification` wins.
- Field names are accepted in snake_case or camelCase, with aliases (`questions`, `issues`).
- With no JSON, the summary is the first 4000 characters of the text and `reported:false`.
- The planner's `plan` and `needs_clarification` **must** parse, or gates won't open.

**`parseReview`** (line 53):
- Severity `critical` → `blocker`; an unknown severity → `minor`.
- Verdict:
  - `approve`, `approved` or `lgtm` → approve.
  - Anything containing "change", or `reject` → `changes_requested`.
  - Otherwise it is inferred: any blocker or major finding → `changes_requested`.

`emptySelfReport()` is at line 36.

## Markdown reports

**`buildReport(args)`** (line 144) builds numbered sections:
- Title (`reportTitle`, line 330), plus a quote of the follow-up, fix or answer message.
- Metadata, error.
- Summary.
- Questions.
- Plan.
- Code review table.
- Implementation details (not for read-only roles).
- Files changed by type, with docs updated and an uncommitted-changes warning.
- Testing and build (not for read-only roles).
- Outstanding issues.
- Git info.
- **Agent usage**: model, duration, turns, context at start and peak, denials, new tokens (input + cache write + output), each token type, both cost estimates, and a disclaimer that these are estimates.

**`buildValidationReport(args)`** (line 341):
- A synthetic self-report: pass/fail counts, failure output with the last 40 lines per command, build status.
- A command table.
- The failing output, last 80 lines.
- Usage is zero and the cost is 0.

Reports are stored in `runs.report_json`, served at `GET /runs/:id/report`, and rendered in the UI Report tab. PR bodies reuse them ([github-prs.md](github-prs.md)).
