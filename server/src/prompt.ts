import type { AgentRole, Feature, FixReason, Project, ReviewFinding, ValidationResult } from '../../shared/types.ts';
import type { LaunchConfig } from './launch.ts';

/** Machine-readable markers at the top of every prompt (also used by the test double). */
const roleMarker = (role: AgentRole) => `<!-- orchestrator-role: ${role} -->`;

const CLARIFY_FIELD = `  "needs_clarification": [],`;

const DEV_REPORT_SCHEMA = `\`\`\`json
{
  "summary": "What was implemented, in 1-3 sentences",
  "implementation_details": "Technical explanation of the changes and any decisions you made (markdown allowed)",
  "tests": {
    "executed": ["commands you ran, e.g. npm test"],
    "passed": 0,
    "failed": 0,
    "not_run": ["tests/checks you could not run and why"],
    "output": "short relevant excerpt of test output, especially failures"
  },
  "build": { "status": "passed | failed | not_run", "output": "short excerpt" },
  "docs_updated": ["documentation files you created or updated"],
${CLARIFY_FIELD}
  "outstanding_issues": ["known problems, incomplete requirements, follow-ups"]
}
\`\`\``;

const PLAN_REPORT_SCHEMA = `\`\`\`json
{
  "summary": "The approach in 1-2 sentences",
  "plan": "The implementation plan as markdown: steps, files to create/change, tests to add, risks and open decisions",
${CLARIFY_FIELD}
  "outstanding_issues": []
}
\`\`\``;

const REVIEW_REPORT_SCHEMA = `\`\`\`json
{
  "summary": "Overall assessment in 1-3 sentences",
  "review": {
    "verdict": "approve | changes_requested",
    "summary": "What is good and what must change",
    "findings": [
      { "severity": "blocker | major | minor | nit", "file": "path/relative/to/repo", "line": 42, "message": "What is wrong and how to fix it" }
    ]
  },
${CLARIFY_FIELD}
  "outstanding_issues": []
}
\`\`\``;

/** Bash allowlist entries rendered as plain command prefixes, e.g. "Bash(npm:*)" -> "npm". */
export function allowedBashCommands(allowedTools: string[]): string[] {
  return allowedTools
    .map((t) => /^Bash\((.+?)(?::\*)?\)$/.exec(t.trim())?.[1])
    .filter((x): x is string => !!x);
}

function featureSection(feature: Feature): string {
  return `# Feature
**Title:** ${feature.title}
**Priority:** ${feature.priority}

**Requirements:**
${feature.description.trim() || '(no further description provided — infer the intended behaviour from the title and the project documentation)'}
`;
}

const CONTEXT_SECTION = `# Project context and documentation
- The project's CLAUDE.md is already loaded. Follow its instructions about which documentation to consult (for example \`agent-docs/\`) and how to keep it up to date.
- Read only the documentation relevant to this feature: start from an index or the file names, not every file.
- Prefer the documentation over exploring the codebase. When you do need code, locate it with Grep/Glob and read only the parts you need. Do not re-read files that are already in your context.
`;

function permissionsLine(cfg: LaunchConfig | undefined, allowedTools: string[]): string {
  const bash = allowedBashCommands(cfg?.allowedTools ?? allowedTools);
  const edits = cfg?.readOnly ? 'You must NOT modify any files (edits are blocked).' : 'File edits are allowed.';
  return `Permissions: ${edits}${
    bash.length
      ? ` Shell commands are allowed only if they start with: ${bash.map((c) => `\`${c}\``).join(', ')}. Other commands are denied automatically — don't retry them; use an allowed alternative or note it in outstanding issues.`
      : ' Shell commands may be denied; note it in outstanding issues if you could not run something.'
  }`;
}

const CLARIFY_RULE = `Questions: you run non-interactively, but you may ask the user. Only if a requirement is ambiguous in a way where a wrong guess would waste significant work, stop before making changes and finish with the report, putting concise questions in \`needs_clarification\`. The user's answers will be sent back to this same session. Otherwise make a reasonable decision, record it in the report and leave \`needs_clarification\` empty.`;

const PROGRESS_SECTION = `# Progress milestones
Print these exact markers on their own line as you reach each stage (they drive the dashboard progress bar):
[[PROGRESS:planning]]  — after you have read the relevant docs and planned the change
[[PROGRESS:implementing]] — when you start making code changes
[[PROGRESS:testing]] — when you start running tests / builds
[[PROGRESS:finalizing]] — when you are committing and writing the final report
`;

function reportSection(schema: string): string {
  return `# Final report (required)
Keep your final message short: one sentence, then exactly one fenced \`\`\`json block with this shape (no comments inside):
${schema}
Use null for passed/failed counts if you could not determine them. Be honest: report failures and unrun tests.
`;
}

function devRules(project: Project, cfg: LaunchConfig | undefined): string {
  return `# How to work
1. Work only inside the current working directory (this worktree). Do not modify other checkouts, switch branches, merge, rebase or push.
2. Implement the feature completely, following existing patterns. Add or update tests where the project has a test setup.
3. Create or update documentation as CLAUDE.md requires, and commit it together with the code.
4. Run the most relevant tests first, then the full test suite and build/type-check once at the end. Keep command output short (e.g. pipe through \`tail -n 60\`).
5. Commit your work to the current branch with clear commit messages. Leave the worktree clean.
6. ${CLARIFY_RULE}
7. ${permissionsLine(cfg, project.allowedTools)}
`;
}

/** Developer: implement the feature from scratch (no plan step). */
export function buildPrompt(feature: Feature, project: Project, branch: string, attempt: number, cfg?: LaunchConfig, baseRef?: string): string {
  return `${roleMarker('developer')}
You are an autonomous coding agent implementing one feature for the "${project.name}" project.
You are working inside a dedicated git worktree on branch \`${branch}\` (created from \`${baseRef || project.baseBranch}\`).
${attempt > 1 ? `\nThis is attempt #${attempt}. A previous attempt may have left work in this worktree — check \`git status\` and \`git log\` first and continue from there.\n` : ''}
${featureSection(feature)}
${CONTEXT_SECTION}
${devRules(project, cfg)}
${PROGRESS_SECTION}
${reportSection(DEV_REPORT_SCHEMA)}`;
}

/** Planner: read-only exploration, produce a plan for the user to approve. */
export function buildPlanPrompt(feature: Feature, project: Project, branch: string, cfg?: LaunchConfig, baseRef?: string): string {
  return `${roleMarker('planner')}
You are the planning agent for one feature of the "${project.name}" project.
You are inside a dedicated git worktree on branch \`${branch}\` (created from \`${baseRef || project.baseBranch}\`). Another step will implement your plan in this same session after the user approves it.

${featureSection(feature)}
${CONTEXT_SECTION}
# Your task
1. Do NOT modify any files. Only read what you need to plan the change.
2. Write a concrete implementation plan: the approach, numbered steps, the files to create or change (with the functions/components involved), the tests to add, documentation to update, and risks or decisions the user should know about.
3. Keep it proportional to the feature: a small feature needs a short plan.
4. ${CLARIFY_RULE.replace('stop before making changes and finish', 'finish')}
5. ${permissionsLine(cfg, project.allowedTools)}

Print [[PROGRESS:planning]] when you start writing the plan.

${reportSection(PLAN_REPORT_SCHEMA)}`;
}

/** Planner (resumed): revise the plan with the user's feedback. */
export function buildReplanPrompt(feedback: string): string {
  return `${roleMarker('planner')}
The user reviewed your plan and requested changes:

${feedback.trim()}

Revise the plan accordingly. Still do not modify any files. Finish with one sentence plus the same \`\`\`json report block (with the full revised plan in "plan"):
${PLAN_REPORT_SCHEMA}`;
}

/** Developer (resumed from the planner session): implement the approved plan. */
export function buildImplementPlanPrompt(project: Project, branch: string, cfg?: LaunchConfig, comment?: string | null): string {
  return `${roleMarker('developer')}
The user approved your plan${comment?.trim() ? ` with these comments:\n\n${comment.trim()}\n\nTake the comments into account.` : '.'} Implement it now in this worktree (branch \`${branch}\`). You may edit files from now on.

${devRules(project, cfg)}
${PROGRESS_SECTION}
${reportSection(DEV_REPORT_SCHEMA)}`;
}

function formatValidation(results: ValidationResult[]): string {
  return results
    .map((r) => `### \`${r.command}\` → ${r.timedOut ? 'timed out' : `exit ${r.exitCode}`}\n\`\`\`text\n${r.output.split('\n').slice(-60).join('\n')}\n\`\`\``)
    .join('\n\n');
}

function formatFindings(findings: ReviewFinding[]): string {
  return findings.map((f, i) => `${i + 1}. [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.message}`).join('\n');
}

export function fixMessage(reason: FixReason, data: { validation?: ValidationResult[]; findings?: ReviewFinding[]; reviewSummary?: string; comment?: string }): string {
  if (reason === 'validation') return `The project's validation commands failed:\n\n${formatValidation((data.validation ?? []).filter((r) => r.exitCode !== 0 || r.timedOut))}`;
  if (reason === 'review') return `A code reviewer requested changes.${data.reviewSummary ? `\n\n${data.reviewSummary}` : ''}\n\nFindings:\n${formatFindings(data.findings ?? [])}`;
  return `The user reviewed the result and requested changes:\n\n${data.comment ?? ''}`;
}

/** Developer (resumed): fix validation failures, review findings or user feedback. */
export function buildFixPrompt(reason: FixReason, message: string, project: Project, branch: string, cfg?: LaunchConfig): string {
  const intro = {
    validation: 'After your last change, the orchestrator ran the project\'s validation commands in this worktree and they failed. Find and fix the cause. Do not weaken, skip or delete tests to make them pass.',
    review: 'A reviewer agent reviewed your changes. Address every blocker and major finding; fix minor ones where reasonable, and explain in the report anything you deliberately did not change.',
    user: 'The user reviewed your work and requested changes. Address them.',
  }[reason];
  return `${roleMarker('developer')}
<!-- orchestrator-fix: ${reason} -->
${intro}
You are still in the same worktree on branch \`${branch}\`.

${message.trim()}

${devRules(project, cfg)}
${PROGRESS_SECTION}
${reportSection(DEV_REPORT_SCHEMA)}`;
}

/** Tester: fresh session that adds and runs tests for the feature. */
export function buildTesterPrompt(feature: Feature, project: Project, branch: string, baseRef: string, cfg?: LaunchConfig): string {
  return `${roleMarker('tester')}
You are the testing agent for the "${project.name}" project. Another agent has implemented the feature below on branch \`${branch}\` in this worktree. See what changed with \`git log ${baseRef}..HEAD\` and \`git diff ${baseRef}...HEAD --stat\`, then read only the relevant parts.

${featureSection(feature)}
${CONTEXT_SECTION}
# Your task
1. Check the tests for this feature against its requirements, acceptance criteria and edge cases. Add or extend tests where coverage is missing, following the project's existing test setup and conventions.
2. Do not change production code, unless a test reveals a genuine bug: then make the minimal fix and describe it in the report.
3. Run the new tests, then the full test suite. Keep command output short (pipe through \`tail -n 60\`).
4. Commit your tests to the current branch. Leave the worktree clean. Do not switch branches, merge, rebase or push.
5. ${CLARIFY_RULE}
6. ${permissionsLine(cfg, project.allowedTools)}

Print [[PROGRESS:testing]] when you start running tests and [[PROGRESS:finalizing]] when you commit.

${reportSection(DEV_REPORT_SCHEMA)}`;
}

/** Reviewer: fresh, read-only session that reviews the branch diff. */
export function buildReviewerPrompt(feature: Feature, project: Project, branch: string, baseRef: string, cfg?: LaunchConfig): string {
  return `${roleMarker('reviewer')}
You are the code reviewer for the "${project.name}" project. Review the changes on branch \`${branch}\` in this worktree against its base \`${baseRef}\`. Start with \`git diff ${baseRef}...HEAD --stat\` and \`git log ${baseRef}..HEAD --oneline\`, then read the diff of the relevant files.

${featureSection(feature)}
# What to check
- The requirements above are fully and correctly implemented.
- Correctness: edge cases, error handling, data validation, concurrency, security issues.
- Tests cover the new behaviour and would catch regressions.
- The code follows the project's conventions (CLAUDE.md and its documentation) and existing patterns; documentation is updated where CLAUDE.md requires it.

# Rules
1. Do NOT modify any files. Your output is the review.
2. Use \`changes_requested\` only for blocker or major findings; minor issues and nits alone mean \`approve\`.
3. Reference findings by file path (relative to the repository root) and line number in the new version.
4. ${CLARIFY_RULE.replace('stop before making changes and finish', 'finish')}
5. ${permissionsLine(cfg, project.allowedTools)}

Print [[PROGRESS:planning]] when you start reading and [[PROGRESS:finalizing]] when you write the review.

${reportSection(REVIEW_REPORT_SCHEMA)}`;
}

export function formatAnswers(questions: string[], answers: string[]): string {
  return questions.map((q, i) => `**Q${i + 1}:** ${q}\n**A${i + 1}:** ${answers[i]?.trim() || '(no answer — use your best judgement)'}`).join('\n\n');
}

/** Any role (resumed): the user answered the agent's questions. */
export function buildAnswerPrompt(role: AgentRole, qa: string): string {
  return `${roleMarker(role)}
Answers to your questions:

${qa}

Continue the task you were given with the same rules, printing the [[PROGRESS:...]] markers, and finish with one sentence plus the same \`\`\`json report block as before.`;
}

/** Instruction sent to a resumed session (`claude --resume`): the session already has the full context. */
export function buildFollowupPrompt(message: string, branch: string): string {
  return `${roleMarker('developer')}
Follow-up request for this feature (you are still in the same worktree, on branch \`${branch}\`):

${message.trim()}

Apply the same rules as before: follow the project's CLAUDE.md and documentation, run the relevant tests, commit your changes, print the [[PROGRESS:...]] markers, and finish with one sentence plus the same \`\`\`json report block (describing this follow-up), for example:
${DEV_REPORT_SCHEMA}
`;
}
