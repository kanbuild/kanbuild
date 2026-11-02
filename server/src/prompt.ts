import type { Feature, Project } from '../../shared/types.ts';
import type { LaunchConfig } from './launch.ts';

const REPORT_SCHEMA = `\`\`\`json
{
  "summary": "What was implemented, in 1-3 sentences",
  "implementation_details": "Technical explanation of the changes (markdown allowed)",
  "tests": {
    "executed": ["commands you ran, e.g. npm test"],
    "passed": 0,
    "failed": 0,
    "not_run": ["tests/checks you could not run and why"],
    "output": "short relevant excerpt of test output, especially failures"
  },
  "build": { "status": "passed | failed | not_run", "output": "short excerpt" },
  "docs_updated": ["documentation files you created or updated"],
  "outstanding_issues": ["known problems, incomplete requirements, follow-ups"]
}
\`\`\``;

/** Bash allowlist entries rendered as plain command prefixes, e.g. "Bash(npm:*)" -> "npm". */
export function allowedBashCommands(allowedTools: string[]): string[] {
  return allowedTools
    .map((t) => /^Bash\((.+?)(?::\*)?\)$/.exec(t.trim())?.[1])
    .filter((x): x is string => !!x);
}

/**
 * Orchestration-only instructions. Project context is NOT duplicated here: Claude Code loads the
 * repository's CLAUDE.md itself, and that file decides which documentation the agent should use.
 */
export function buildPrompt(feature: Feature, project: Project, branch: string, attempt: number, cfg?: LaunchConfig): string {
  const bash = allowedBashCommands(cfg?.allowedTools ?? project.allowedTools);
  return `You are an autonomous coding agent implementing one feature for the "${project.name}" project.
You are working inside a dedicated git worktree on branch \`${branch}\` (created from \`${project.baseBranch}\`).
${attempt > 1 ? `\nThis is attempt #${attempt}. A previous attempt may have left work in this worktree — check \`git status\` and \`git log\` first and continue from there.\n` : ''}
# Feature
**Title:** ${feature.title}
**Priority:** ${feature.priority}

**Requirements:**
${feature.description.trim() || '(no further description provided — infer the intended behaviour from the title and the project documentation)'}

# Project context and documentation
- The project's CLAUDE.md is already loaded. Follow its instructions about which documentation to consult (for example \`agent-docs/\`) and how to keep it up to date.
- Read only the documentation relevant to this feature: start from an index or the file names, not every file.
- Prefer the documentation over exploring the codebase. When you do need code, locate it with Grep/Glob and read only the parts you need. Do not re-read files that are already in your context.
- Create or update documentation as CLAUDE.md requires, and commit it together with the code.

# How to work
1. Work only inside the current working directory (this worktree). Do not modify other checkouts, switch branches, merge, rebase or push.
2. Implement the feature completely, following existing patterns. Add or update tests where the project has a test setup.
3. Run the most relevant tests first, then the full test suite and build/type-check once at the end. Keep command output short (e.g. pipe through \`tail -n 60\`).
4. Commit your work to the current branch with clear commit messages. Leave the worktree clean.
5. You run non-interactively: nobody can answer questions. Make reasonable, documented decisions when something is ambiguous.
6. Permissions: file edits are allowed.${bash.length ? ` Shell commands are allowed only if they start with: ${bash.map((c) => `\`${c}\``).join(', ')}. Other commands are denied automatically — don't retry them; use an allowed alternative or note it in outstanding issues.` : ' Shell commands may be denied; note it in outstanding issues if you could not run something.'}

# Progress milestones
Print these exact markers on their own line as you reach each stage (they drive the dashboard progress bar):
[[PROGRESS:planning]]  — after you have read the relevant docs and planned the change
[[PROGRESS:implementing]] — when you start making code changes
[[PROGRESS:testing]] — when you start running tests / builds
[[PROGRESS:finalizing]] — when you are committing and writing the final report

# Final report (required)
Keep your final message short: one sentence, then exactly one fenced \`\`\`json block with this shape (no comments inside):
${REPORT_SCHEMA}
Use null for passed/failed counts if you could not determine them. Be honest: report failures and unrun tests.
`;
}

/** Instruction sent to a resumed session (`claude --resume`): the session already has the full context. */
export function buildFollowupPrompt(message: string, branch: string): string {
  return `Follow-up request for this feature (you are still in the same worktree, on branch \`${branch}\`):

${message.trim()}

Apply the same rules as before: follow the project's CLAUDE.md and documentation, run the relevant tests, commit your changes, print the [[PROGRESS:...]] markers, and finish with one sentence plus the same \`\`\`json report block (describing this follow-up), for example:
${REPORT_SCHEMA}
`;
}
