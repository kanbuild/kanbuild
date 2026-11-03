import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Catalog, McpScope, McpServerInfo, SkillInfo, SkillSource } from '../../shared/types.ts';

/**
 * Discovery of the MCP servers and skills the local Claude Code installation knows about.
 *
 * Sources (later sources win on a name clash, like Claude Code's own precedence):
 *   MCP:    installed plugins → ~/.claude.json mcpServers (user) → ~/.claude.json projects[path] (local)
 *           → <repo>/.mcp.json (project) → `claude mcp list` (status, plus claude.ai connectors)
 *   Skills: ~/.claude/skills, installed plugins' skills/, <repo>/.claude/skills
 */

/** Claude Code's home directory (overridable for tests). */
export function claudeHome(): string {
  return process.env.ORCH_CLAUDE_HOME || os.homedir();
}

export interface McpConfigEntry {
  name: string;
  scope: McpScope;
  /** Raw server config as Claude Code stores it. Never sent to the browser (may contain secrets). */
  config: Record<string, unknown>;
  plugin?: string;
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export interface InstalledPlugin {
  name: string;
  installPath: string;
}

/** Plugins listed in ~/.claude/plugins/installed_plugins.json (v1 and v2 formats). */
export function installedPlugins(): InstalledPlugin[] {
  const data = readJson(path.join(claudeHome(), '.claude', 'plugins', 'installed_plugins.json'));
  const plugins = data?.plugins;
  if (!plugins || typeof plugins !== 'object') return [];
  const out: InstalledPlugin[] = [];
  for (const [key, value] of Object.entries(plugins)) {
    const entries = Array.isArray(value) ? value : [value];
    const entry = entries.find((e: any) => e && typeof e.installPath === 'string') as any;
    if (!entry || !isDir(entry.installPath)) continue;
    out.push({ name: key.split('@')[0], installPath: entry.installPath });
  }
  return out;
}

/** Replace ${CLAUDE_PLUGIN_ROOT} in a plugin's server config so it can be exported to a standalone config. */
function substitutePluginRoot(v: unknown, root: string): unknown {
  if (typeof v === 'string') return v.split('${CLAUDE_PLUGIN_ROOT}').join(root);
  if (Array.isArray(v)) return v.map((x) => substitutePluginRoot(x, root));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitutePluginRoot(x, root)]));
  return v;
}

function pluginMcpServers(p: InstalledPlugin): Record<string, unknown> {
  const manifest = readJson(path.join(p.installPath, '.claude-plugin', 'plugin.json'));
  let servers: any = manifest?.mcpServers;
  if (typeof servers === 'string') servers = readJson(path.resolve(p.installPath, servers));
  if (!servers) servers = readJson(path.join(p.installPath, '.mcp.json'));
  if (servers?.mcpServers) servers = servers.mcpServers;
  return servers && typeof servers === 'object' ? (substitutePluginRoot(servers, p.installPath) as Record<string, unknown>) : {};
}

/** MCP server configs from Claude Code's config files (synchronous; no CLI call). */
export function readMcpConfigs(projectPath: string): Map<string, McpConfigEntry> {
  const out = new Map<string, McpConfigEntry>();
  const add = (servers: unknown, scope: McpScope, plugin?: string) => {
    if (!servers || typeof servers !== 'object') return;
    for (const [name, config] of Object.entries(servers as Record<string, unknown>)) {
      if (config && typeof config === 'object') out.set(name, { name, scope, config: config as Record<string, unknown>, plugin });
    }
  };
  for (const p of installedPlugins()) add(pluginMcpServers(p), 'plugin', p.name);
  const user = readJson(path.join(claudeHome(), '.claude.json'));
  add(user?.mcpServers, 'user');
  add(user?.projects?.[projectPath]?.mcpServers, 'local');
  add(readJson(path.join(projectPath, '.mcp.json'))?.mcpServers, 'project');
  return out;
}

/** Hide credentials: query strings and userinfo in URLs, and anything that looks like a token argument. */
export function redactTarget(target: string): string {
  return target
    .replace(/(https?:\/\/)[^/@\s]+@/g, '$1***@')
    .replace(/(https?:\/\/[^\s?]+)\?\S*/g, '$1?***')
    .replace(/((?:--?[\w-]*(?:token|key|secret|password)[\w-]*)[= ])\S+/gi, '$1***')
    .replace(/\b(sk|ghp|gho|xox[bp])[-_][A-Za-z0-9_-]{8,}/g, '***');
}

function transportOf(config: Record<string, unknown>): McpServerInfo['transport'] {
  const t = String(config.type ?? config.transport ?? '').toLowerCase();
  if (t === 'http' || t === 'streamable-http') return 'http';
  if (t === 'sse') return 'sse';
  if (t === 'ws' || t === 'websocket') return 'ws';
  if (t === 'stdio' || typeof config.command === 'string') return 'stdio';
  if (typeof config.url === 'string') return 'http';
  return 'unknown';
}

function targetOf(config: Record<string, unknown>): string {
  if (typeof config.url === 'string') return redactTarget(config.url);
  if (typeof config.command === 'string') {
    const args = Array.isArray(config.args) ? config.args.map(String) : [];
    return redactTarget([config.command, ...args].join(' '));
  }
  return '';
}

export interface CliMcpLine {
  name: string;
  target: string;
  status: McpServerInfo['status'];
}

/** Parse `claude mcp list` output, e.g. `claude.ai Gmail: https://… - ✓ Connected`. */
export function parseMcpList(output: string): CliMcpLine[] {
  const out: CliMcpLine[] = [];
  for (const raw of output.split('\n')) {
    const line = raw.trim();
    const colon = line.indexOf(': ');
    const dash = line.lastIndexOf(' - ');
    if (colon <= 0 || dash <= colon) continue;
    const name = line.slice(0, colon).trim();
    const target = line.slice(colon + 2, dash).replace(/\s+\((?:HTTP|SSE|stdio|WS)\)$/i, '').trim();
    const statusText = line.slice(dash + 3).toLowerCase();
    const status: McpServerInfo['status'] = statusText.includes('connected') && !statusText.includes('fail')
      ? 'connected'
      : statusText.includes('auth')
        ? 'needs_auth'
        : statusText.includes('pending')
          ? 'pending'
          : statusText.includes('fail') || statusText.includes('✗')
            ? 'failed'
            : null;
    out.push({ name, target, status });
  }
  return out;
}

export const isClaudeAiConnector = (name: string) => /^claude\.ai\s/i.test(name);

function runMcpList(binary: string, cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, ['mcp', 'list'], { cwd, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) reject(new Error((stderr || err.message).trim().split('\n')[0]));
      else resolve(stdout);
    });
  });
}

export async function discoverMcpServers(projectPath: string, binary: string, warnings: string[]): Promise<McpServerInfo[]> {
  const configs = readMcpConfigs(projectPath);
  const byName = new Map<string, McpServerInfo>();
  for (const e of configs.values()) {
    byName.set(e.name, {
      name: e.name,
      scope: e.scope,
      transport: transportOf(e.config),
      target: targetOf(e.config),
      status: null,
      launchable: true,
      ...(e.plugin ? { plugin: e.plugin } : {}),
    });
  }
  try {
    for (const l of parseMcpList(await runMcpList(binary, projectPath))) {
      const known = byName.get(l.name);
      if (known) known.status = l.status;
      else if (isClaudeAiConnector(l.name)) {
        byName.set(l.name, { name: l.name, scope: 'claude.ai', transport: 'http', target: redactTarget(l.target), status: l.status, launchable: false });
      }
    }
  } catch (err) {
    warnings.push(`Could not run \`${binary} mcp list\` (connection status and claude.ai connectors unavailable): ${(err as Error).message}`);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Minimal frontmatter parser for SKILL.md (`name:` and `description:`, including folded/quoted values). */
export function parseSkillFrontmatter(text: string): { name?: string; description?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === '|' || value === '>' || value === '|-' || value === '>-' || value === '') {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      value = parts.join(' ');
    }
    out[kv[1]] = value.replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  return { name: out.name, description: out.description };
}

function scanSkills(dir: string, source: SkillSource, plugin?: string): SkillInfo[] {
  if (!isDir(dir)) return [];
  const out: SkillInfo[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const skillDir = path.join(dir, entry);
    const file = path.join(skillDir, 'SKILL.md');
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const fm = parseSkillFrontmatter(text);
    const name = (fm.name || entry).trim();
    out.push({
      id: plugin ? `plugin:${plugin}:${name}` : `${source}:${name}`,
      name,
      description: fm.description ?? '',
      source,
      ...(plugin ? { plugin } : {}),
      path: skillDir,
    });
  }
  return out;
}

export function discoverSkills(projectPath: string): SkillInfo[] {
  const skills = [
    ...scanSkills(path.join(claudeHome(), '.claude', 'skills'), 'user'),
    ...installedPlugins().flatMap((p) => scanSkills(path.join(p.installPath, 'skills'), 'plugin', p.name)),
    ...scanSkills(path.join(projectPath, '.claude', 'skills'), 'project'),
  ];
  const seen = new Set<string>();
  return skills.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true))).sort((a, b) => a.name.localeCompare(b.name));
}

const cache = new Map<string, { at: number; catalog: Catalog }>();
const CACHE_MS = 60_000;

export async function getCatalog(projectPath: string, binary: string, opts: { refresh?: boolean } = {}): Promise<Catalog> {
  const hit = cache.get(projectPath);
  if (hit && !opts.refresh && Date.now() - hit.at < CACHE_MS) return hit.catalog;
  const warnings: string[] = [];
  const catalog: Catalog = {
    mcpServers: await discoverMcpServers(projectPath, binary, warnings),
    skills: discoverSkills(projectPath),
    fetchedAt: new Date().toISOString(),
    warnings,
  };
  cache.set(projectPath, { at: Date.now(), catalog });
  return catalog;
}

/** Last catalog fetched for a path (any age), used at launch to know every discovered server name. */
export function cachedCatalog(projectPath: string): Catalog | null {
  return cache.get(projectPath)?.catalog ?? null;
}
