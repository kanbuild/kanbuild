import { describe, expect, it } from 'vitest';
import { StreamParser } from '../src/streamParser.ts';
import { estimateCost, priceFor } from '../src/pricing.ts';
import { extractSelfReport } from '../src/report.ts';
import { slugify } from '../src/git.ts';

describe('StreamParser', () => {
  it('tracks session, usage (deduped by message id), milestones and result', () => {
    const p = new StreamParser();
    const lines = [
      { type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5-5' },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: '[[PROGRESS:planning]] reading' }], usage: { input_tokens: 10, output_tokens: 5 } } },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/a/b/c/d.ts' } }], usage: { input_tokens: 10, output_tokens: 7 } } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true }] } },
    ];
    const events = lines.flatMap((l) => p.feedLine(JSON.stringify(l)));
    expect(p.sessionId).toBe('s1');
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.progress).toBe(15);
    expect(p.currentActivity).toBe('Editing …/b/c/d.ts');
    expect(p.usage).toEqual({ inputTokens: 10, outputTokens: 7, cacheCreationTokens: 0, cacheReadTokens: 0, cacheCreation1hTokens: 0 });
    expect(events.some((e) => e.kind === 'error')).toBe(true);
    p.feedLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.5, modelUsage: { 'claude-opus-5-5': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1, cacheCreationInputTokens: 2 } } }));
    expect(p.result?.isError).toBe(false);
    expect(p.result?.totalCostUsd).toBe(0.5);
    expect(p.usage.inputTokens).toBe(100);
  });

  it('keeps progress indeterminate without milestones', () => {
    const p = new StreamParser();
    p.feedLine(JSON.stringify({ type: 'assistant', message: { id: 'x', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'npm test' } }] } }));
    expect(p.progress).toBeNull();
    expect(p.stage).toBe('testing');
  });

  it('handles chunked input across line boundaries', () => {
    const p = new StreamParser();
    const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' }) + '\n';
    p.feedChunk(line.slice(0, 10));
    expect(p.sessionId).toBeNull();
    p.feedChunk(line.slice(10));
    expect(p.sessionId).toBe('abc');
  });
});

describe('pricing', () => {
  it('resolves models and aliases', () => {
    expect(priceFor('claude-opus-5-5')?.input).toBe(4);
    expect(priceFor('claude-sonnet-4-6')?.input).toBe(3);
    expect(priceFor('sonnet')?.input).toBe(2);
    expect(priceFor('claude-opus-5-5[1m]')?.output).toBe(20);
    expect(priceFor('unknown-model')).toBeNull();
  });
  it('includes cache pricing', () => {
    const c = estimateCost({ inputTokens: 1_000_000, outputTokens: 1_000_000, cacheCreationTokens: 1_000_000, cacheReadTokens: 1_000_000 }, 'claude-sonnet-5-5');
    expect(c).toBeCloseTo(2 + 10 + 2.5 + 0.2, 5);
  });
  it('prices 1-hour cache writes at 2x input', () => {
    // Matches the cost Claude Code itself reported for a real Opus 5.5 run.
    const c = estimateCost({ inputTokens: 13, outputTokens: 1577, cacheCreationTokens: 10873, cacheReadTokens: 162710, cacheCreation1hTokens: 10873 }, 'claude-opus-5-5');
    expect(c).toBeCloseTo(0.151118, 5);
  });
});

describe('extractSelfReport', () => {
  it('parses the last json block', () => {
    const r = extractSelfReport('blah\n```json\n{"summary":"x","tests":{"executed":["npm test"],"passed":2,"failed":1,"not_run":["e2e"]},"build":{"status":"failed"},"outstanding_issues":["y"]}\n```');
    expect(r.reported).toBe(true);
    expect(r.tests.failed).toBe(1);
    expect(r.tests.notRun).toEqual(['e2e']);
    expect(r.build.status).toBe('failed');
    expect(r.outstandingIssues).toEqual(['y']);
  });
  it('falls back to raw text', () => {
    const r = extractSelfReport('I did things');
    expect(r.reported).toBe(false);
    expect(r.summary).toBe('I did things');
  });
});

describe('slugify', () => {
  it('produces branch-safe slugs', () => {
    expect(slugify('Portfolio Charts & Graphs!')).toBe('portfolio-charts-graphs');
    expect(slugify('???')).toBe('feature');
  });
});

import { LEAN_TOOLS, buildClaudeArgs, previewCommand, resolveLaunchConfig, resumeCommand } from '../src/launch.ts';
import { allowedBashCommands, buildFollowupPrompt, buildPrompt } from '../src/prompt.ts';
import { EditorError, findExecutable, openTerminalCommand, resolveEditorCommand } from '../src/editor.ts';
import { DEFAULT_PIPELINE } from '../src/projects.ts';
import type { Feature, Project, Settings } from '../../shared/types.ts';

const project: Project = {
  id: 'prj_1', name: 'Tiles', description: '', path: '/r', baseBranch: 'main', worktreeRoot: '/r-wt',
  allowedTools: ['Read', 'Bash(npm:*)', 'Bash(git commit:*)'], model: '', agentProfile: '', effort: '', mcpConfig: '',
  pipeline: DEFAULT_PIPELINE, roles: {}, createdAt: '',
};
const settings: Settings = {
  concurrency: 2, agentProfile: 'lean', effort: 'medium', maxBudgetUsd: 0, defaultModel: '', editorCommand: 'vscode', claudeBinary: 'claude',
  notifications: 'all', systemNotifications: false,
};
const sampleFeature: Feature = {
  id: 'f', projectId: 'p', title: 'T', description: 'D', priority: 'low', status: 'build', position: 0, branch: null, worktreePath: null, sessionId: null,
  agentStatus: null, currentRunId: null, dependsOn: [], blockedBy: [], gate: null, baseRef: null, prUrl: null, prNumber: null, createdAt: '', updatedAt: '',
};

describe('launch args', () => {
  it('lean profile trims tools, skills, MCP and user settings', () => {
    const args = buildClaudeArgs('PROMPT', resolveLaunchConfig(project, settings));
    expect(args.slice(0, 2)).toEqual(['-p', 'PROMPT']);
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--disable-slash-commands');
    expect(args[args.indexOf('--tools') + 1]).toBe(LEAN_TOOLS.join(','));
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('project,local');
    expect(args[args.indexOf('--effort') + 1]).toBe('medium');
    expect(args).not.toContain('--max-budget-usd');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });
  it('full profile and project overrides', () => {
    const cfg = resolveLaunchConfig({ ...project, agentProfile: 'full', effort: 'high', model: 'sonnet', mcpConfig: '/r/.mcp.json' }, { ...settings, maxBudgetUsd: 2 });
    const args = buildClaudeArgs('P', cfg, { resumeSessionId: 'sess-1' });
    expect(args).not.toContain('--tools');
    expect(args).not.toContain('--strict-mcp-config');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-1');
    expect(args[args.indexOf('--effort') + 1]).toBe('high');
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('2');
    expect(args[args.indexOf('--mcp-config') + 1]).toBe('/r/.mcp.json');
  });
  it('renders preview and resume commands', () => {
    expect(previewCommand('claude', ['-p', 'long prompt', '--tools', 'Read,Edit'])).toBe('claude -p "<feature prompt>" --tools Read,Edit');
    expect(resumeCommand('claude', "/a b/it's", 'sess-1')).toBe(`cd '/a b/it'\\''s' && claude --resume sess-1`);
  });
});

describe('prompt', () => {
  it('defers to CLAUDE.md docs workflow and lists allowed commands', () => {
    const p = buildPrompt(sampleFeature, project, 'feature/t', 1);
    expect(p).toContain('Follow its instructions about which documentation to consult');
    expect(p).toContain('`npm`, `git commit`');
    expect(p).toContain('"docs_updated"');
    expect(allowedBashCommands(['Bash(git status:*)', 'Bash(pwd)', 'Read'])).toEqual(['git status', 'pwd']);
    expect(buildFollowupPrompt('also add divide', 'feature/x')).toContain('also add divide');
  });
});

describe('editor resolution', () => {
  it('uses a custom absolute command', () => {
    const r = resolveEditorCommand('/bin/echo -n', '/tmp/x');
    expect(r).toEqual({ bin: '/bin/echo', args: ['-n', '/tmp/x'], description: '/bin/echo' });
  });
  it('gives an actionable error when VS Code is missing', () => {
    if (findExecutable('code')) return; // VS Code CLI installed on this machine
    expect(() => resolveEditorCommand('vscode', '/tmp/x', 'linux')).toThrow(/Shell Command: Install 'code' command in PATH/);
    expect(() => resolveEditorCommand('code', '/tmp/x', 'linux')).toThrow(EditorError);
  });
  it('builds a Terminal.app launcher on macOS only', () => {
    const c = openTerminalCommand(`cd '/a' && claude --resume s`, 'darwin');
    expect(c.bin).toBe('osascript');
    expect(c.args[1]).toBe(`tell application "Terminal" to do script "cd '/a' && claude --resume s"`);
    expect(() => openTerminalCommand('x', 'linux')).toThrow(EditorError);
  });
});

describe('parser metrics', () => {
  it('counts turns, baseline/peak context and permission denials', () => {
    const p = new StreamParser();
    const u = (i: number, cw: number, cr: number) => ({ input_tokens: i, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: 1 });
    p.feedLine(JSON.stringify({ type: 'assistant', message: { id: 'a', content: [], usage: u(5, 20000, 0) } }));
    p.feedLine(JSON.stringify({ type: 'assistant', message: { id: 'a', content: [], usage: u(5, 20000, 0) } }));
    p.feedLine(JSON.stringify({ type: 'assistant', message: { id: 'b', content: [], usage: u(5, 100, 20000) } }));
    p.feedLine(JSON.stringify({ type: 'result', subtype: 'success', result: '', permission_denials: [{ tool_name: 'Bash' }] }));
    expect(p.metrics).toEqual({ turns: 2, baselineContextTokens: 20005, peakContextTokens: 20105, permissionDenials: 1 });
  });
});
