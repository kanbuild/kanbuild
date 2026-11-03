import fs from 'node:fs';
import path from 'node:path';
import type { AgentProfile, Project } from '../../shared/types.ts';
import { cachedCatalog, discoverSkills, isClaudeAiConnector, readMcpConfigs } from './catalog.ts';

/** Name of the throwaway plugin that carries the project's selected user/plugin skills. */
export const SKILLS_PLUGIN = 'orch-skills';

/** How the project's MCP/skill selection turns into `claude` arguments. Null = nothing selected (profile default). */
export interface Capabilities {
  /** Generated --mcp-config file holding the selected servers' configs. */
  mcpConfigPath: string | null;
  /** Use --strict-mcp-config (false when a claude.ai connector is selected: it cannot be exported to a file). */
  strictMcp: boolean;
  /** Permission rules for the selected servers' tools, e.g. `mcp__sentry`. */
  allowMcp: string[];
  /** Discovered servers that were not selected (only used when strictMcp is false). */
  disallowMcp: string[];
  /** Selected skill names (as shown to the model). Non-empty enables the Skill tool. */
  skillNames: string[];
  /** --plugin-dir carrying selected user/plugin skills (lean profile only). */
  skillPluginDir: string | null;
  /** Selected ids that are no longer discoverable. */
  missing: string[];
}

/** MCP tool prefix as Claude Code builds it: `mcp__<name with non [A-Za-z0-9_-] replaced by _>`. */
export const mcpToolPrefix = (name: string) => `mcp__${name.replace(/[^A-Za-z0-9_-]/g, '_')}`;

export interface PrepareOptions {
  /** Where generated files go (<data dir>/capabilities/<project id>). */
  dir: string;
  /** false = compute paths and args without writing files (launch preview). */
  write: boolean;
}

/**
 * Resolve the project's selected MCP servers and skills into launch settings, writing the generated
 * MCP config (mode 0600: it may hold credentials copied from the user's Claude Code config) and the
 * skills plugin directory when `write` is set.
 */
export function prepareCapabilities(project: Project, profile: AgentProfile, opts: PrepareOptions): Capabilities | null {
  const mcpNames = project.mcpServers ?? [];
  const skillIds = project.skills ?? [];
  if (!mcpNames.length && !skillIds.length) return null;
  const missing: string[] = [];

  // ---- MCP ----
  let mcpConfigPath: string | null = null;
  let strictMcp = true;
  const allowMcp: string[] = [];
  const disallowMcp: string[] = [];
  if (mcpNames.length) {
    const configs = readMcpConfigs(project.path);
    const servers: Record<string, unknown> = {};
    for (const name of mcpNames) {
      const entry = configs.get(name);
      if (entry) servers[name] = entry.config;
      else if (isClaudeAiConnector(name)) strictMcp = false;
      else {
        missing.push(`mcp:${name}`);
        continue;
      }
      allowMcp.push(mcpToolPrefix(name));
    }
    if (Object.keys(servers).length) {
      mcpConfigPath = path.join(opts.dir, 'mcp.json');
      if (opts.write) {
        fs.mkdirSync(opts.dir, { recursive: true });
        fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: servers }, null, 2), { mode: 0o600 });
        fs.chmodSync(mcpConfigPath, 0o600);
      }
    }
    if (!strictMcp) {
      // claude.ai connectors only load without --strict-mcp-config, which also loads every other configured
      // server: deny the ones that were not selected.
      const known = new Set([...configs.keys(), ...(cachedCatalog(project.path)?.mcpServers.map((s) => s.name) ?? [])]);
      for (const name of known) if (!mcpNames.includes(name)) disallowMcp.push(mcpToolPrefix(name));
    }
  }

  // ---- Skills ----
  const skillNames: string[] = [];
  let skillPluginDir: string | null = null;
  if (skillIds.length) {
    const available = new Map(discoverSkills(project.path).map((s) => [s.id, s]));
    const toLink: { name: string; path: string }[] = [];
    for (const id of skillIds) {
      const s = available.get(id);
      if (!s) {
        missing.push(`skill:${id}`);
        continue;
      }
      if (s.source === 'project') skillNames.push(s.name); // already in the worktree
      else if (profile === 'lean') {
        // Lean ignores user settings and plugins, so ship user/plugin skills in a session-only plugin.
        skillNames.push(`${SKILLS_PLUGIN}:${s.name}`);
        toLink.push({ name: s.name, path: s.path });
      } else skillNames.push(s.source === 'plugin' ? `${s.plugin}:${s.name}` : s.name);
    }
    if (toLink.length) {
      skillPluginDir = path.join(opts.dir, 'skills-plugin');
      if (opts.write) {
        fs.rmSync(skillPluginDir, { recursive: true, force: true });
        fs.mkdirSync(path.join(skillPluginDir, '.claude-plugin'), { recursive: true });
        fs.mkdirSync(path.join(skillPluginDir, 'skills'), { recursive: true });
        fs.writeFileSync(
          path.join(skillPluginDir, '.claude-plugin', 'plugin.json'),
          JSON.stringify({ name: SKILLS_PLUGIN, version: '0.0.0', description: `Skills selected for project ${project.name}` }, null, 2),
        );
        for (const s of toLink) fs.symlinkSync(s.path, path.join(skillPluginDir, 'skills', s.name.replace(/[^\w.-]/g, '_')), 'dir');
      }
    }
  }

  return { mcpConfigPath, strictMcp, allowMcp, disallowMcp, skillNames, skillPluginDir, missing };
}
