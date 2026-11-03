import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverSkills, parseMcpList, parseSkillFrontmatter, readMcpConfigs, redactTarget } from '../src/catalog.ts';
import { SKILLS_PLUGIN, mcpToolPrefix, prepareCapabilities } from '../src/capabilities.ts';
import { LEAN_TOOLS, buildClaudeArgs, resolveLaunchConfig } from '../src/launch.ts';
import { rankFiles } from '../src/files.ts';
import { buildFollowupPrompt, buildPrompt, extractFileRefs } from '../src/prompt.ts';
import { DEFAULT_PIPELINE } from '../src/projects.ts';
import type { Feature, Project, Settings } from '../../shared/types.ts';

let tmp: string;
let home: string;
let repo: string;
const prevHome = process.env.ORCH_CLAUDE_HOME;

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-caps-'));
  home = path.join(tmp, 'home');
  repo = path.join(tmp, 'repo');
  process.env.ORCH_CLAUDE_HOME = home;
  const pluginRoot = path.join(home, '.claude', 'plugins', 'cache', 'tools');
  write(
    path.join(home, '.claude.json'),
    JSON.stringify({
      mcpServers: { sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp?token=abc', headers: { Authorization: 'Bearer x' } } },
      projects: { [repo]: { mcpServers: { localdb: { command: 'npx', args: ['db-mcp', '--api-key=secret'] } } } },
    }),
  );
  write(path.join(repo, '.mcp.json'), JSON.stringify({ mcpServers: { files: { command: 'node', args: ['server.js'] } } }));
  write(path.join(home, '.claude', 'skills', 'pdf', 'SKILL.md'), '---\nname: pdf\ndescription: >\n  Work with PDF\n  files.\n---\nbody');
  write(path.join(repo, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: "Deploy the app"\n---\n');
  write(path.join(pluginRoot, 'skills', 'lint', 'SKILL.md'), '---\nname: lint\ndescription: Lint it\n---\n');
  write(path.join(pluginRoot, '.mcp.json'), JSON.stringify({ mcpServers: { linter: { command: '${CLAUDE_PLUGIN_ROOT}/bin/lint' } } }));
  write(
    path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'tools@market': [{ scope: 'user', installPath: pluginRoot }] } }),
  );
});
afterAll(() => {
  if (prevHome === undefined) delete process.env.ORCH_CLAUDE_HOME;
  else process.env.ORCH_CLAUDE_HOME = prevHome;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const settings: Settings = {
  concurrency: 2, agentProfile: 'lean', effort: '', maxBudgetUsd: 0, defaultModel: '', editorCommand: 'vscode', claudeBinary: 'claude',
  notifications: 'all', systemNotifications: false, autoStartBuild: true,
};
const mkProject = (p: Partial<Project> = {}): Project => ({
  id: 'prj', name: 'Repo', description: '', path: repo, baseBranch: 'main', worktreeRoot: '/w', allowedTools: ['Read'], model: '', agentProfile: '',
  effort: '', mcpConfig: '', mcpServers: [], skills: [], pipeline: DEFAULT_PIPELINE, roles: {}, createdAt: '', ...p,
});

describe('catalog discovery', () => {
  it('parses skill frontmatter including folded and quoted values', () => {
    expect(parseSkillFrontmatter('---\nname: a\ndescription: >\n  one\n  two\n---')).toEqual({ name: 'a', description: 'one two' });
    expect(parseSkillFrontmatter("---\nname: 'b'\n---")).toEqual({ name: 'b', description: undefined });
    expect(parseSkillFrontmatter('no frontmatter')).toEqual({});
  });
  it('reads MCP servers from user, local, project and plugin configs', () => {
    const m = readMcpConfigs(repo);
    expect([...m.keys()].sort()).toEqual(['files', 'linter', 'localdb', 'sentry']);
    expect(m.get('localdb')!.scope).toBe('local');
    expect(m.get('files')!.scope).toBe('project');
    expect(m.get('linter')!.scope).toBe('plugin');
    expect(m.get('linter')!.config.command).toBe(path.join(home, '.claude', 'plugins', 'cache', 'tools', 'bin', 'lint'));
  });
  it('discovers user, plugin and project skills', () => {
    const s = discoverSkills(repo);
    expect(s.map((x) => x.id).sort()).toEqual(['plugin:tools:lint', 'project:deploy', 'user:pdf']);
    expect(s.find((x) => x.name === 'pdf')!.description).toBe('Work with PDF files.');
  });
  it('redacts secrets from targets', () => {
    expect(redactTarget('https://mcp.sentry.dev/mcp?token=abc')).toBe('https://mcp.sentry.dev/mcp?***');
    expect(redactTarget('npx db --api-key=secret')).toBe('npx db --api-key=***');
    expect(redactTarget('https://user:pw@host/x')).toBe('https://***@host/x');
  });
  it('parses `claude mcp list` output', () => {
    const out = 'Checking MCP server health...\n\nclaude.ai Gmail: https://gmail.mcp.claude.com/mcp - ✓ Connected\nsentry: https://mcp.sentry.dev/mcp (HTTP) - ! Needs authentication\nbad: npx x - ✗ Failed to connect\n';
    expect(parseMcpList(out)).toEqual([
      { name: 'claude.ai Gmail', target: 'https://gmail.mcp.claude.com/mcp', status: 'connected' },
      { name: 'sentry', target: 'https://mcp.sentry.dev/mcp', status: 'needs_auth' },
      { name: 'bad', target: 'npx x', status: 'failed' },
    ]);
  });
});

describe('capabilities at launch', () => {
  it('leaves launch args unchanged when nothing is selected', () => {
    const p = mkProject();
    const cfg = resolveLaunchConfig(p, settings);
    cfg.capabilities = prepareCapabilities(p, cfg.profile, { dir: path.join(tmp, 'none'), write: true });
    expect(cfg.capabilities).toBeNull();
    const args = buildClaudeArgs('P', cfg);
    expect(args).toContain('--disable-slash-commands');
    expect(args).toContain('--strict-mcp-config');
    expect(args).not.toContain('--mcp-config');
  });
  it('exports selected MCP servers to a private generated config and allows their tools', () => {
    const p = mkProject({ mcpServers: ['sentry', 'files', 'gone'] });
    const dir = path.join(tmp, 'run1');
    const cfg = resolveLaunchConfig(p, settings);
    cfg.capabilities = prepareCapabilities(p, cfg.profile, { dir, write: true });
    expect(cfg.capabilities!.missing).toEqual(['mcp:gone']);
    const file = path.join(dir, 'mcp.json');
    expect(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers)).toEqual(['sentry', 'files']);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const args = buildClaudeArgs('P', cfg);
    expect(args).toContain('--strict-mcp-config');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe(file);
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,mcp__sentry,mcp__files');
    // Full profile restricts MCP the same way.
    const full = resolveLaunchConfig({ ...p, agentProfile: 'full' }, settings);
    full.capabilities = cfg.capabilities;
    expect(buildClaudeArgs('P', full)).toContain('--strict-mcp-config');
  });
  it('claude.ai connectors drop --strict-mcp-config and deny unselected servers', () => {
    const p = mkProject({ mcpServers: ['claude.ai Gmail', 'files'] });
    const cfg = resolveLaunchConfig(p, settings);
    cfg.capabilities = prepareCapabilities(p, cfg.profile, { dir: path.join(tmp, 'run2'), write: false });
    const args = buildClaudeArgs('P', cfg);
    expect(args).not.toContain('--strict-mcp-config');
    expect(args[args.indexOf('--allowedTools') + 1]).toContain(mcpToolPrefix('claude.ai Gmail'));
    expect(mcpToolPrefix('claude.ai Gmail')).toBe('mcp__claude_ai_Gmail');
    const denied = args[args.indexOf('--disallowedTools') + 1].split(',');
    expect(denied.sort()).toEqual(['mcp__linter', 'mcp__localdb', 'mcp__sentry']);
  });
  it('ships selected user/plugin skills through a session plugin in the lean profile', () => {
    const p = mkProject({ skills: ['user:pdf', 'plugin:tools:lint', 'project:deploy'] });
    const dir = path.join(tmp, 'run3');
    const cfg = resolveLaunchConfig(p, settings);
    cfg.capabilities = prepareCapabilities(p, cfg.profile, { dir, write: true });
    const args = buildClaudeArgs('P', cfg);
    expect(args).not.toContain('--disable-slash-commands');
    expect(args[args.indexOf('--tools') + 1]).toBe([...LEAN_TOOLS, 'Skill'].join(','));
    expect(args[args.indexOf('--plugin-dir') + 1]).toBe(path.join(dir, 'skills-plugin'));
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(`Read,Skill(${SKILLS_PLUGIN}:pdf),Skill(${SKILLS_PLUGIN}:lint),Skill(deploy)`);
    expect(fs.existsSync(path.join(dir, 'skills-plugin', 'skills', 'pdf', 'SKILL.md'))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'skills-plugin', '.claude-plugin', 'plugin.json'), 'utf8')).name).toBe(SKILLS_PLUGIN);
    // Full profile already loads user skills and plugins: only allow rules, no plugin dir.
    const full = resolveLaunchConfig({ ...p, agentProfile: 'full' }, settings);
    full.capabilities = prepareCapabilities({ ...p, agentProfile: 'full' }, full.profile, { dir: path.join(tmp, 'run4'), write: false });
    const fargs = buildClaudeArgs('P', full);
    expect(fargs).not.toContain('--plugin-dir');
    expect(fargs[fargs.indexOf('--allowedTools') + 1]).toBe('Read,Skill(pdf),Skill(tools:lint),Skill(deploy)');
  });
});

describe('file references', () => {
  const files = ['server/src/launch.ts', 'server/src/runner.ts', 'web/src/App.tsx', 'README.md', 'docs/launch/guide.md'];
  it('ranks basename matches before path and fuzzy matches', () => {
    expect(rankFiles(files, 'launch')).toEqual(['server/src/launch.ts', 'docs/launch/guide.md']);
    expect(rankFiles(files, 'readme.md')).toEqual(['README.md']);
    expect(rankFiles(files, 'srcrunr')).toEqual(['server/src/runner.ts']);
    expect(rankFiles(files, '', 2)).toEqual(['README.md', 'web/src/App.tsx']);
  });
  it('extracts @references from text', () => {
    expect(extractFileRefs('See @src/a.ts, and (@b/c.md). Email me@x.com @src/a.ts @../etc/passwd @/abs')).toEqual(['src/a.ts', 'b/c.md']);
  });
  it('adds a Referenced files section to prompts', () => {
    const feature: Feature = {
      id: 'f', projectId: 'prj', title: 'T', description: 'Use @.mcp.json and @nope.ts', priority: 'low', status: 'build', position: 0, branch: null,
      worktreePath: null, sessionId: null, agentStatus: null, currentRunId: null, dependsOn: [], blockedBy: [], gate: null, baseRef: null, prUrl: null,
      prNumber: null, createdAt: '', updatedAt: '',
    };
    const prompt = buildPrompt(feature, mkProject(), 'feature/x', 1);
    expect(prompt).toContain('**Referenced files**');
    expect(prompt).toContain('- `.mcp.json`\n');
    expect(prompt).toContain('- `nope.ts` (not found');
    expect(buildPrompt({ ...feature, description: 'plain' }, mkProject(), 'b', 1)).not.toContain('Referenced files');
    expect(buildFollowupPrompt('also check @web/x.tsx', 'b')).toContain('- `web/x.tsx`');
  });
});
