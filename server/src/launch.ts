import type { Capabilities } from './capabilities.ts';
import type { AgentProfile, AgentRole, Effort, Project, Settings } from '../../shared/types.ts';

/**
 * Built-in tools available to agents in the lean profile. Everything else (web tools, sub-agents,
 * task/cron/notification tools, …) is removed from the tool list, which shrinks the context that is
 * re-sent on every turn and prevents sub-agents from spawning extra full contexts.
 */
export const LEAN_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'];

/** Tools for read-only roles (planner, reviewer): no Edit/Write. */
export const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'Bash'];
export const READ_ONLY_ALLOWED = [
  'Read',
  'Glob',
  'Grep',
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git branch:*)',
  'Bash(git rev-parse:*)',
  'Bash(ls:*)',
  'Bash(cat:*)',
  'Bash(head:*)',
  'Bash(tail:*)',
  'Bash(wc:*)',
  'Bash(grep:*)',
];
export const DISALLOWED_FOR_READ_ONLY = ['Edit', 'Write', 'NotebookEdit'];

export const isReadOnlyRole = (role: AgentRole | undefined) => role === 'planner' || role === 'reviewer';

export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface LaunchConfig {
  profile: AgentProfile;
  effort: Effort | null;
  model: string | null;
  maxBudgetUsd: number | null;
  mcpConfig: string | null;
  allowedTools: string[];
  /** Planner/reviewer: no file edits. */
  readOnly: boolean;
  role: AgentRole;
  /** Selected MCP servers / skills, resolved by prepareCapabilities(). Null = profile default. */
  capabilities: Capabilities | null;
}

/** Merge global settings with project overrides. Empty project values mean "inherit". */
/** Role overrides (project.roles) win over project settings, which win over global settings. */
export function resolveLaunchConfig(project: Project, settings: Settings, role: AgentRole = 'developer'): LaunchConfig {
  const roleCfg = role !== 'validator' ? project.roles?.[role] : undefined;
  const effort = (roleCfg?.effort || project.effort || settings.effort || '') as Effort | '';
  const readOnly = isReadOnlyRole(role);
  return {
    profile: project.agentProfile || settings.agentProfile || 'lean',
    effort: effort && EFFORTS.includes(effort) ? effort : null,
    model: roleCfg?.model || project.model || settings.defaultModel || null,
    maxBudgetUsd: settings.maxBudgetUsd && settings.maxBudgetUsd > 0 ? settings.maxBudgetUsd : null,
    mcpConfig: project.mcpConfig?.trim() || null,
    allowedTools: readOnly ? READ_ONLY_ALLOWED : project.allowedTools,
    readOnly,
    role,
    capabilities: null,
  };
}

/**
 * Build the argument list for `claude`.
 *
 * Both profiles run the normal Claude Code harness in headless print mode (`-p`) with
 * `--permission-mode acceptEdits` and the project's tool allowlist. The lean profile additionally:
 *  - ignores user-level MCP servers (`--strict-mcp-config`, optionally loading the project's own MCP config),
 *  - limits the built-in tools (`--tools`),
 *  - disables skills and slash commands (`--disable-slash-commands`) unless skills were selected,
 *  - loads only project/local settings (`--setting-sources project,local`): the repository's CLAUDE.md
 *    and .claude/settings.json still apply; user-level plugins, hooks, agents and ~/.claude/CLAUDE.md do not.
 *
 * MCP servers / skills selected in the project (cfg.capabilities) apply to both profiles: only the
 * selected servers are loaded (generated --mcp-config + --strict-mcp-config) and allowed, and the
 * selected skills are allowed (lean: shipped through a session-only --plugin-dir).
 */
export function buildClaudeArgs(prompt: string, cfg: LaunchConfig, opts: { resumeSessionId?: string | null } = {}): string[] {
  const caps = cfg.capabilities;
  const skills = caps?.skillNames ?? [];
  /** MCP servers were selected: only those may be used, in either profile. */
  const restrictMcp = !!caps && caps.allowMcp.length > 0;
  const allowed = [...cfg.allowedTools, ...(restrictMcp ? caps!.allowMcp : []), ...skills.map((n) => `Skill(${n})`)];
  const disallowed = [...(cfg.readOnly ? DISALLOWED_FOR_READ_ONLY : []), ...(restrictMcp && !caps!.strictMcp ? caps!.disallowMcp : [])];
  // Read-only roles run in the default permission mode: anything outside the read-only allowlist is denied.
  const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', cfg.readOnly ? 'default' : 'acceptEdits'];
  if (opts.resumeSessionId) args.push('--resume', opts.resumeSessionId);
  if (allowed.length) args.push('--allowedTools', allowed.join(','));
  if (disallowed.length) args.push('--disallowedTools', disallowed.join(','));
  if (cfg.model) args.push('--model', cfg.model);
  if (cfg.effort) args.push('--effort', cfg.effort);
  if (cfg.maxBudgetUsd) args.push('--max-budget-usd', String(cfg.maxBudgetUsd));
  // claude.ai connectors cannot be exported to a config file, so selecting one drops --strict-mcp-config
  // (the unselected servers are denied through --disallowedTools instead).
  const strictMcp = restrictMcp ? caps!.strictMcp : cfg.profile === 'lean';
  if (cfg.profile === 'lean') {
    const tools = cfg.readOnly ? READ_ONLY_TOOLS : LEAN_TOOLS;
    args.push('--tools', (skills.length ? [...tools, 'Skill'] : tools).join(','));
    if (!skills.length) args.push('--disable-slash-commands');
    args.push('--setting-sources', 'project,local');
  }
  if (strictMcp) args.push('--strict-mcp-config');
  const mcpConfigs = [caps?.mcpConfigPath, cfg.mcpConfig].filter((x): x is string => !!x);
  for (const c of mcpConfigs) args.push('--mcp-config', c);
  if (caps?.skillPluginDir) args.push('--plugin-dir', caps.skillPluginDir);
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
