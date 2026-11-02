import type { Feature, Project } from '../../shared/types.ts';

/**
 * Orchestration-only instructions. Project context (CLAUDE.md, agent-docs/, README, conventions)
 * is deliberately NOT duplicated here: Claude Code discovers it from its working directory.
 */
export function buildPrompt(feature: Feature, project: Project, branch: string, attempt: number): string {
  return `You are an autonomous coding agent implementing one feature for the "${project.name}" project.
You are working inside a dedicated git worktree on branch \`${branch}\` (created from \`${project.baseBranch}\`).
${attempt > 1 ? `\nThis is attempt #${attempt}. A previous attempt may have left work in this worktree — inspect \`git status\` and \`git log\` first and continue from there.\n` : ''}
# Feature
**Title:** ${feature.title}
**Priority:** ${feature.priority}

**Requirements:**
${feature.description.trim() || '(no further description provided — infer the intended behaviour from the title and the codebase)'}

# How to work
1. Before writing code, read the project's own context: root and nested CLAUDE.md files, agent-docs/ or docs/ directories, README files, and the existing code and conventions. Follow them.
2. Work only inside the current working directory (this worktree). Do not modify other checkouts, do not switch branches, do not merge, rebase or push.
3. Implement the feature completely, following existing patterns. Add or update tests where the project has a test setup.
4. Run the project's relevant tests and build/type-check commands if they exist, and fix failures you introduced.
5. Commit your work to the current branch with clear commit messages (\`git add\` + \`git commit\`). Leave the worktree clean.
6. You are running non-interactively: nobody can answer questions. If something is ambiguous, make a reasonable, documented decision. If a tool or command is denied by permissions, continue without it and mention it in outstanding issues.

# Progress milestones
Print these exact markers on their own line as you reach each stage (they drive the dashboard progress bar):
[[PROGRESS:planning]]  — after you have read the context and planned the change
[[PROGRESS:implementing]] — when you start making code changes
[[PROGRESS:testing]] — when you start running tests / builds
[[PROGRESS:finalizing]] — when you are committing and writing the final report

# Final report (required)
End your final message with exactly one fenced \`\`\`json block with this shape (no comments inside):
\`\`\`json
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
  "outstanding_issues": ["known problems, incomplete requirements, follow-ups"]
}
\`\`\`
Use null for passed/failed counts if you could not determine them. Be honest: report failures and unrun tests.
`;
}
