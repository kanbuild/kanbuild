# Pipeline and state machines

Source files: `server/src/pipeline.ts` (pure decision logic), `server/src/orchestrator.ts` (acting on decisions, gates, retry/cancel), `server/src/projects.ts` (`DEFAULT_PIPELINE`)

## Overview

```
plan → [plan_approval gate] → feature (develop) → validate ⇄ fix(validation) → test → validate
     → review ⇄ fix(review) → [final_approval gate] → done → (optional auto PR)
Any agent run that returns needs_clarification → [clarification gate] → answer run (same role and session)
```

- Each step is a **run** (a DB row).
- `validate` runs have role `validator` and no agent: the orchestrator runs shell commands itself.
- Default config (`DEFAULT_PIPELINE`, projects.ts:7):

  | Field | Default |
  |---|---|
  | `plan` | true |
  | `planApproval` | true |
  | `validate` | true |
  | `validationCommands` | `[]` (auto-detect) |
  | `tester` | true |
  | `reviewer` | false |
  | `finalApproval` | false |
  | `maxFixLoops` | 2 (0-5) |
  | `autoCreatePr` | false |
  | `prDraft` | true |
  | `remote` | `origin` |

## Feature column (`FeatureStatus`)

- **backlog → build**: `PATCH {status:'build'}` calls `enterBuild` (orchestrator.ts:88).
  - With auto-start on (the project's `pipeline.autoStart`, else the global `autoStartBuild`), it calls `startFeature`.
  - With auto-start off, the card waits in Build, **ready to start**: `agentStatus` is null, there is no gate and no new run. `tick()` only schedules queued runs, so it stays put. `isPaused` and `continuePipeline` need `agentStatus = completed`, so it never looks paused. `POST /features/:id/start` (the ▶ button) calls `startFeature`.
  - Follow-ups, Retry, gate resolutions and Continue pipeline always start right away.
  - `enqueueRun` also forces the card into build.
- **build → done**: only `Orchestrator.complete()` (orchestrator.ts:751). It runs on a pipeline `done` decision or a final-approval approve.
- **Manual move out of build**:
  - Needs `confirmCancel` if an agent is active; the run is then cancelled.
  - Clears any gate, then calls `tick()` so dependents can unblock.
- **Moving Done → Build** starts a **new cycle** (the UI asks for confirmation).

## Run status (`AgentStatus`)

`queued` → `initialising` → `running` → `completed` | `failed` | `cancelled`

- **queued**: set by `createRun`.
- **initialising**: set synchronously in `tick()` (orchestrator.ts:230) so concurrent ticks see the slot as taken.
- **running**: set after `launchDetached` (or in `runValidation`).
- **Final status**, decided in `finalize` (orchestrator.ts:572-586):
  - `cancelled` if a cancel was requested, or if `run.error === CANCEL_MARK` ("Cancellation requested", which survives restarts).
  - `completed` if there is a result event with `!isError` and the exit code is 0 or null.
  - `failed` otherwise. The error text is one of:
    - "Claude Code reported an error (subtype)"
    - "Agent process terminated unexpectedly"
    - "exited with code N without a result"

    When there is no result, the last 1000 characters of stderr are appended.
- `feature.agentStatus` mirrors the run's status, but only while `feature.currentRunId === run.id`.

## Decision function (`pipeline.ts`)

`firstStep(config, 'start'|'followup')` (pipeline.ts:35):
- `start` → `plan/planner` if `config.plan`, otherwise `feature/developer`.
- `followup` → `followup/developer`.

`nextStep(ctx, runs)` (pipeline.ts:44) is a **pure function** of the config plus the current cycle's runs, oldest first, with their stored reports. It returns a `Decision`: `run` | `gate` | `done` | `stop{error}` | `idle`. Rules, in order:

1. **No last run, or the last run is cancelled, queued, initialising or running** → `idle`.
2. **Last run was the validator**:
   - Passed (`validationPassed`, pipeline.ts:30: completed, all commands exit 0, no timeouts) → `afterValidated`.
   - Failed with no results → `stop` "Validation could not run".
   - Failed, and validation fix runs in this cycle are below `maxFixLoops` → run `fix/developer` with `fixReason:'validation'`.
   - Otherwise → `stop` "Validation still failing after N…".
3. **Last agent run failed** → `stop` with an empty error. The run keeps its own error; the user clicks Retry.
4. **Last run has questions** (`needs_clarification`) → `clarification` gate `{questions, role}`.
5. **Planner** → `plan_approval` gate `{plan}` if `planApproval`, otherwise run `feature/developer`.
6. **Developer or tester** → `afterChange`.
   - `afterChange` (pipeline.ts:91): if `validate` is on and validation commands exist (checked against the worktree), run `validate/validator`; otherwise `afterValidated`.
   - `afterValidated` (pipeline.ts:96), first match wins:
     1. `tester` on and no completed tester run in this cycle → `test/tester`. The tester runs at most once per cycle.
     2. `reviewer` on → `review/reviewer`.
     3. Otherwise → `finish()`.
7. **Reviewer**, first match wins:
   1. Verdict is not `changes_requested` → `finish()`.
   2. Review fixes are below `maxFixLoops` → `fix/developer` with `fixReason:'review'`.
   3. `finalApproval` is on → `final_approval` gate with a note.
   4. Otherwise → `stop`.

- `finish()` (pipeline.ts:105) → `final_approval` gate if `finalApproval`, otherwise `done`.
- `stepLabel(kind, role, fixReason)` (pipeline.ts:111) gives "Planning", "Developing", "Fixing validation", "Addressing review", "Applying feedback", "Testing", "Reviewing", "Validating" or "Follow-up".
- Fix loops are counted **per `fixReason` within the cycle**.

Unit tests: `server/test/pipeline.unit.test.ts`.

## Cycles

- `cycle` = latest + 1, on `startFeature` (Build) and `followUp`.
- Every other run (pipeline steps, gate resolutions, retry) inherits the cycle of the run that produced it.
- `listCycleRuns` orders runs by `attempt`.
- Everything is in the DB, so pipelines survive restarts.

## Acting on decisions (`orchestrator.ts`)

- **`advance(featureId, runId)`** (line 663) wraps `applyNextStep` and never throws. On error it logs "Could not start the next pipeline step… Use 'Continue pipeline'" and sends a "Pipeline paused" notification.
- **`applyNextStep`** (line 689):
  1. Builds the `StepRun` history: `needsClarification`, `plan` and `review` from `report_json`; `validation` from `validation_json`.
  2. Calls `nextStep` and acts on the decision:
     - **`run`**: builds a fix message with `fixMessage` from the previous validation results or review findings, then `enqueueRun`.
     - **`gate`**: patches `feature.gate` and sets the activity ("Waiting for plan approval"…). Sends an attention notification: "Plan ready for your approval", "The agent has questions" or "Ready for your approval".
     - **`done`**: `complete()`.
     - **`stop` with an error**: marks the run failed with the error ("Pipeline stopped") and notifies.
     - **`idle`**: nothing.
- **`complete`** (line 751):
  - Clears the gate, sets `agentStatus=completed` and moves the card to Done (top).
  - Sends a success notification.
  - If `autoCreatePr` is on, a token exists and there is no `prUrl` yet, it runs `createPrForFeature` asynchronously. Errors become an event and a notification.

## Gates: `resolveGate(featureId, action, {comment, answers})` (orchestrator.ts:122)

| Gate | Action | Effect |
|---|---|---|
| `plan_approval` | `approve` | Enqueue `feature/developer`; the comment becomes the run's `message` |
| `plan_approval` | `reject` | Comment required. Enqueue `plan/planner` with the comment (a replan in the resumed session) |
| `clarification` | `answer` | At least one non-blank answer required. `formatAnswers` builds the Q/A text; enqueue `answer` in `gate.role` |
| `final_approval` | `approve` | `complete()` |
| `final_approval` | `reject` | Comment required. Enqueue `fix/developer` with `fixReason:'user'` |

Any other combination returns 400. `enqueueRun` always clears the gate.

## Retry, continue, follow-up, cancel

- **`retry(featureId)`** (line 100): re-enqueues the current run's exact `kind`, `role`, `message`, `fixReason` and `cycle`, re-running only the failed step. With no current run it calls `startFeature`.
- **`continuePipeline`** (line 678): requires `status=build`, `agentStatus=completed`, no gate and a `currentRunId`; then re-runs `advance`. For "paused" pipelines where `applyNextStep` threw or the gate was lost.
- **`followUp(featureId, message)`** (line 109): requires a non-empty message, `feature.sessionId` and an existing worktree. Enqueues `followup/developer` in a **new cycle**. The planner steps are skipped for follow-ups.
- **`cancel(featureId)`** (line 159), by situation:

  | Situation | Effect |
  |---|---|
  | Open gate, no active run | Close the gate, `agentStatus=cancelled` |
  | Queued | `finishWithoutProcess(cancelled)` |
  | Validation running | `ValidationRun.cancel()` |
  | Agent running | Set the cancel flag and `error=CANCEL_MARK`, SIGTERM the process group, SIGKILL after 5 s |

## Notifications by transition (levels; see `notify.ts`)

| Transition | Level |
|---|---|
| Gate opened | attention |
| Agent stalled | attention |
| Step failed | error |
| Pipeline stopped | error |
| Pipeline paused | error |
| Feature done | success |
| PR ready | success |
| PR failed | error |
