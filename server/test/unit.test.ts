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
    expect(p.usage).toEqual({ inputTokens: 10, outputTokens: 7, cacheCreationTokens: 0, cacheReadTokens: 0 });
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
