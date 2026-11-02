#!/usr/bin/env node
// Stand-in for the Claude Code CLI used by tests and demos (`ORCH_CLAUDE_BIN`).
// Emits realistic `--output-format stream-json` events, edits a file and commits it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const delay = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 150);
const fail = process.env.FAKE_CLAUDE_FAIL === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] ?? '';
const title = (prompt.match(/\*\*Title:\*\* (.*)/) ?? [])[1] ?? (prompt.startsWith('Follow-up') ? `followup ${Date.now()}` : 'feature');
const resumed = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
const session = resumed ?? 'sess-' + Math.random().toString(36).slice(2, 10);
if (process.env.FAKE_CLAUDE_ARGS_DIR) {
  fs.mkdirSync(process.env.FAKE_CLAUDE_ARGS_DIR, { recursive: true });
  fs.writeFileSync(`${process.env.FAKE_CLAUDE_ARGS_DIR}/${session}-${Date.now()}.json`, JSON.stringify({ args, cwd: process.cwd() }));
}
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'claude-sonnet-5-5';
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let n = 0;
const usage = () => ({ input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 2000, cache_read_input_tokens: 5000 });
const assistant = (content) => emit({ type: 'assistant', session_id: session, message: { id: `msg_${++n}`, model, content, usage: usage() } });

process.on('SIGTERM', () => process.exit(143));

emit({ type: 'system', subtype: 'init', session_id: session, model, cwd: process.cwd(), tools: ['Read', 'Edit'], permissionMode: 'acceptEdits' });
await sleep(delay);
assistant([{ type: 'text', text: '[[PROGRESS:planning]]\nReading CLAUDE.md and README to understand conventions.' }]);
assistant([{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: `${process.cwd()}/README.md` } }]);
emit({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'readme contents' }] } });
await sleep(delay);
assistant([{ type: 'text', text: '[[PROGRESS:implementing]]' }, { type: 'tool_use', id: 'tu_2', name: 'Write', input: { file_path: `${process.cwd()}/feature.txt`, content: title } }]);
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
fs.writeFileSync(`feature-${slug}.txt`, `Implemented: ${title}\n`);
emit({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'File written' }] } });
await sleep(delay);
assistant([{ type: 'text', text: '[[PROGRESS:testing]]' }, { type: 'tool_use', id: 'tu_3', name: 'Bash', input: { command: 'npm test', description: 'Run unit tests' } }]);
emit({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 'tu_3', content: '3 passing' }] } });
await sleep(delay);
assistant([{ type: 'text', text: '[[PROGRESS:finalizing]]' }]);
execFileSync('git', ['add', '-A']);
execFileSync('git', ['-c', 'user.email=agent@example.com', '-c', 'user.name=Agent', 'commit', '-m', `feat: ${title}`]);
const report = {
  summary: `Implemented ${title}.`,
  implementation_details: 'Added a feature file.',
  tests: { executed: ['npm test'], passed: 3, failed: 0, not_run: [], output: '3 passing' },
  build: { status: 'passed', output: '' },
  outstanding_issues: [],
  docs_updated: ['agent-docs/features.md'],
};
const text = `Done.\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\``;
assistant([{ type: 'text', text }]);
emit({
  type: 'result',
  subtype: fail ? 'error_during_execution' : 'success',
  is_error: fail,
  result: text,
  session_id: session,
  duration_ms: delay * 5,
  num_turns: 5,
  total_cost_usd: 0.0123,
  usage: usage(),
  modelUsage: { [model]: { inputTokens: 6000, outputTokens: 1500, cacheReadInputTokens: 25000, cacheCreationInputTokens: 2000, costUSD: 0.0123 } },
});
process.exit(fail ? 1 : 0);
