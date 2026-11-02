import type { AgentProfile, Effort, Project, Settings } from '../../shared/types.ts';

/**
 * Built-in tools available to agents in the lean profile. Everything else (web tools, sub-agents,
 * task/cron/notification tools, …) is removed from the tool list, which shrinks the context that is
 * re-sent on every turn and prevents sub-agents from spawning extra full contexts.
 */
export const LEAN_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'];

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface LaunchConfig {
  profile: AgentProfile;
  effort: Effort | null;
  model: string | null;
  maxBudgetUsd: number | null;
  mcpConfig: string | null;
  allowedTools: string[];
}

/** Merge global settings with project overrides. Empty project values mean "inherit". */
export function resolveLaunchConfig(project: Project, settings: Settings): LaunchConfig {
  const effort = (project.effort || settings.effort || '') as Effort | '';
  return {
    profile: project.agentProfile || settings.agentProfile || 'lean',
    effort: effort && EFFORTS.includes(effort) ? effort : null,
    model: project.model || settings.defaultModel || null,
    maxBudgetUsd: settings.maxBudgetUsd && settings.maxBudgetUsd > 0 ? settings.maxBudgetUsd : null,
    mcpConfig: project.mcpConfig?.trim() || null,
    allowedTools: project.allowedTools,
  };
}

/**
 * Build the argument list for `claude`.
 *
 * Both profiles run the normal Claude Code harness in headless print mode (`-p`) with
 * `--permission-mode acceptEdits` and the project's tool allowlist. The lean profile additionally:
 *  - ignores user-level MCP servers (`--strict-mcp-config`, optionally loading the project's own MCP config),
 *  - limits the built-in tools (`--tools`),
 *  - disables skills and slash commands (`--disable-slash-commands`),
 *  - loads only project/local settings (`--setting-sources project,local`): the repository's CLAUDE.md
 *    and .claude/settings.json still apply; user-level plugins, hooks, agents and ~/.claude/CLAUDE.md do not.
 */
export function buildClaudeArgs(prompt: string, cfg: LaunchConfig, opts: { resumeSessionId?: string | null } = {}): string[] {
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits'];
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
  if (cfg.allowedTools.length) args.push('--allowedTools', cfg.allowedTools.join(','));
  if (cfg.model) args.push('--model', cfg.model);
  if (cfg.effort) args.push('--effort', cfg.effort);
  if (cfg.maxBudgetUsd) args.push('--max-budget-usd', String(cfg.maxBudgetUsd));
  if (cfg.profile === 'lean') {
    args.push('--tools', LEAN_TOOLS.join(','));
    args.push('--disable-slash-commands');
    args.push('--setting-sources', 'project,local');
    args.push('--strict-mcp-config');
  }
  if (cfg.mcpConfig) args.push('--mcp-config', cfg.mcpConfig);
  return args;
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Human-readable command line (prompt abbreviated) for the launch preview in the UI. */
export function previewCommand(binary: string, args: string[]): string {
  const shown = args.map((a, i) => (args[i - 1] === '-p' ? '"<feature prompt>"' : shellQuote(a)));
  return [shellQuote(binary), ...shown].join(' ');
}

/** Command for continuing an agent's session interactively from a terminal. */
export function resumeCommand(binary: string, worktreePath: string, sessionId: string): string {
  return `cd ${shellQuote(worktreePath)} && ${shellQuote(binary)} --resume ${shellQuote(sessionId)}`;
}
