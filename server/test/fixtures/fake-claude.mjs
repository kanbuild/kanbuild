#!/usr/bin/env node
// Stand-in for the Claude Code CLI used by tests and demos (`ORCH_CLAUDE_BIN`).
// Emits realistic `--output-format stream-json` events and plays the role named in the prompt marker
// (`<!-- orchestrator-role: … -->`): planner/reviewer only read; developer/tester write files and commit.
//
// Knobs (env):
//   FAKE_CLAUDE_DELAY_MS   delay between steps (default 150)
//   FAKE_CLAUDE_FAIL=1     report an error result
//   FAKE_CLAUDE_CLARIFY    role that asks a question (until the prompt contains answers)
//   FAKE_REVIEW_VERDICT    approve | changes_once (request changes until a review fix was committed) | changes
//   FAKE_CLAUDE_ARGS_DIR   record args + cwd of every invocation
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const delay = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 150);
const fail = process.env.FAKE_CLAUDE_FAIL === '1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1] ?? '';
const role = (prompt.match(/<!-- orchestrator-role: (\w+) -->/) ?? [])[1] ?? 'developer';
const fixReason = (prompt.match(/<!-- orchestrator-fix: (\w+) -->/) ?? [])[1] ?? null;
const answered = prompt.includes('Answers to your questions');
const title = (prompt.match(/\*\*Title:\*\* (.*)/) ?? [])[1] ?? (prompt.includes('Follow-up request') ? `followup ${Date.now()}` : 'feature');
const resumed = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
const session = resumed ?? 'sess-' + Math.random().toString(36).slice(2, 10);
if (process.env.FAKE_CLAUDE_ARGS_DIR) {
  fs.mkdirSync(process.env.FAKE_CLAUDE_ARGS_DIR, { recursive: true });
  fs.writeFileSync(`${process.env.FAKE_CLAUDE_ARGS_DIR}/${session}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`, JSON.stringify({ args, cwd: process.cwd(), role }));
}
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'claude-sonnet-5-5';
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let n = 0;
const usage = () => ({ input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 2000, cache_read_input_tokens: 5000 });
const assistant = (content) => emit({ type: 'assistant', session_id: session, message: { id: `msg_${++n}`, model, content, usage: usage() } });
const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });
const commit = (msg) => {
  git('add', '-A');
  git('-c', 'user.email=agent@example.com', '-c', 'user.name=Agent', 'commit', '-m', msg);
};
const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

process.on('SIGTERM', () => process.exit(143));

emit({ type: 'system', subtype: 'init', session_id: session, model, cwd: process.cwd(), tools: ['Read', 'Edit'], permissionMode: 'acceptEdits' });
await sleep(delay);
assistant([{ type: 'text', text: '[[PROGRESS:planning]]\nReading CLAUDE.md and README to understand conventions.' }]);
assistant([{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: `${process.cwd()}/README.md` } }]);
emit({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'readme contents' }] } });
await sleep(delay);

let report;
if (process.env.FAKE_CLAUDE_CLARIFY === role && !answered) {
  report = { summary: 'I need a decision before continuing.', needs_clarification: ['Should the export be CSV or JSON?'], outstanding_issues: [] };
} else if (role === 'planner') {
  report = { summary: `Plan for ${title}.`, plan: `1. Add \`feature-${slug}.txt\`\n2. Add a test\n3. Update docs`, needs_clarification: [], outstanding_issues: [] };
} else if (role === 'reviewer') {
  const log = git('log', '--format=%s');
  const mode = process.env.FAKE_REVIEW_VERDICT ?? 'approve';
  const changes = mode === 'changes' || (mode === 'changes_once' && !log.includes('fix(review)'));
  report = {
    summary: changes ? 'Needs work.' : 'Looks good.',
    review: {
      verdict: changes ? 'changes_requested' : 'approve',
      summary: changes ? 'Missing input validation.' : 'Clean implementation.',
      findings: changes ? [{ severity: 'major', file: `feature-${slug}.txt`, line: 1, message: 'Validate the input' }] : [{ severity: 'nit', file: 'README.md', line: 1, message: 'Typo' }],
    },
    needs_clarification: [],
    outstanding_issues: [],
  };
} else {
  // developer / tester: write a file and commit.
  assistant([{ type: 'text', text: '[[PROGRESS:implementing]]' }, { type: 'tool_use', id: 'tu_2', name: 'Write', input: { file_path: `${process.cwd()}/feature.txt`, content: title } }]);
  let file;
  let msg;
  if (role === 'tester') {
    file = `test-${slug}.test.txt`;
    msg = `test: ${title}`;
  } else if (fixReason) {
    file = `fix-${fixReason}.txt`;
    msg = `fix(${fixReason}): ${title}`;
  } else {
    file = `feature-${slug}.txt`;
    msg = `feat: ${title}`;
  }
  fs.appendFileSync(file, `${role}: ${title} ${Date.now()}\n`);
  emit({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'File written' }] } });
  await sleep(delay);
  assistant([{ type: 'text', text: '[[PROGRESS:testing]]' }, { type: 'tool_use', id: 'tu_3', name: 'Bash', input: { command: 'npm test', description: 'Run unit tests' } }]);
  emit({ type: 'user', session_id: session, message: { content: [{ type: 'tool_result', tool_use_id: 'tu_3', content: '3 passing' }] } });
  await sleep(delay);
  assistant([{ type: 'text', text: '[[PROGRESS:finalizing]]' }]);
  commit(msg);
  report = {
    summary: `Implemented ${title}.`,
    implementation_details: 'Added a feature file.',
    tests: { executed: ['npm test'], passed: 3, failed: 0, not_run: [], output: '3 passing' },
    build: { status: 'passed', output: '' },
    outstanding_issues: [],
    docs_updated: ['agent-docs/features.md'],
    needs_clarification: [],
  };
}

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
