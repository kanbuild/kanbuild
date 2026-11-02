import type { ProgressStage, RunEventKind, Usage } from '../../shared/types.ts';

export interface ParsedEvent {
  kind: RunEventKind;
  summary: string;
  detail?: string | null;
  ts?: string;
}

export interface ResultInfo {
  isError: boolean;
  subtype: string;
  text: string;
  totalCostUsd: number | null;
  durationMs: number | null;
  numTurns: number | null;
  modelUsage: Record<string, Usage> | null;
}

/** Milestone markers the agent is instructed to print; mapped to coarse progress values. */
export const MILESTONES: Record<string, { stage: ProgressStage; progress: number }> = {
  planning: { stage: 'planning', progress: 15 },
  implementing: { stage: 'implementing', progress: 40 },
  testing: { stage: 'testing', progress: 70 },
  finalizing: { stage: 'finalizing', progress: 90 },
};
const MILESTONE_RE = /\[\[PROGRESS:\s*([a-z]+)\s*\]\]/gi;

const TEST_CMD_RE = /\b(test|vitest|jest|pytest|mocha|go test|cargo test|rspec|phpunit|playwright)\b/i;
const BUILD_CMD_RE = /\b(build|tsc|compile|cargo build|go build|make)\b/i;

function truncate(s: string, n: number): string {
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

function shortPath(p: unknown): string {
  if (typeof p !== 'string') return '';
  const parts = p.split('/');
  return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p;
}

/** Human readable one-liner for a tool invocation. */
export function describeToolUse(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read':
      return `Reading ${shortPath(input.file_path)}`;
    case 'Write':
      return `Writing ${shortPath(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Editing ${shortPath(input.file_path)}`;
    case 'NotebookEdit':
      return `Editing notebook ${shortPath(input.notebook_path)}`;
    case 'Bash':
      return `Running: ${truncate(String(input.description || input.command || ''), 120)}`;
    case 'Glob':
      return `Finding files: ${input.pattern}`;
    case 'Grep':
      return `Searching: ${truncate(String(input.pattern || ''), 80)}`;
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return 'Updating task list';
    case 'WebFetch':
      return `Fetching ${input.url}`;
    case 'WebSearch':
      return `Searching the web: ${input.query}`;
    case 'Task':
    case 'Agent':
      return `Delegating to sub-agent: ${truncate(String(input.description || ''), 80)}`;
    default:
      return `Using ${name}`;
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .join('\n');
  }
  return '';
}

/**
 * Incremental parser for `claude -p --output-format stream-json --verbose` NDJSON output.
 * Pure state machine: feed lines, read state.
 */
export class StreamParser {
  sessionId: string | null = null;
  model: string | null = null;
  progress: number | null = null;
  stage: ProgressStage | null = null;
  currentActivity: string | null = null;
  result: ResultInfo | null = null;
  toolUses = 0;
  lastText = '';
  /** Usage per API message id; Claude Code may emit one assistant event per content block. */
  private usageByMessage = new Map<string, Usage>();
  private finalUsage: Usage | null = null;
  private toolNames = new Map<string, { name: string; summary: string }>();
  private buffer = '';

  get usage(): Usage {
    if (this.finalUsage) return this.finalUsage;
    const total = emptyUsage();
    for (const u of this.usageByMessage.values()) {
      total.inputTokens += u.inputTokens;
      total.outputTokens += u.outputTokens;
      total.cacheCreationTokens += u.cacheCreationTokens;
      total.cacheReadTokens += u.cacheReadTokens;
      total.cacheCreation1hTokens = (total.cacheCreation1hTokens ?? 0) + (u.cacheCreation1hTokens ?? 0);
    }
    return total;
  }

  /** Feed a raw chunk of stdout; returns events parsed from complete lines. */
  feedChunk(chunk: string): ParsedEvent[] {
    this.buffer += chunk;
    const out: ParsedEvent[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      out.push(...this.feedLine(line));
    }
    return out;
  }

  /** Flush a trailing line without newline (at process end). */
  flush(): ParsedEvent[] {
    const rest = this.buffer;
    this.buffer = '';
    return rest.trim() ? this.feedLine(rest) : [];
  }

  feedLine(line: string): ParsedEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return [{ kind: 'stderr', summary: truncate(trimmed, 300), detail: trimmed }];
    }
    if (!msg || typeof msg !== 'object') return [];
    if (msg.session_id && !this.sessionId) this.sessionId = msg.session_id;

    switch (msg.type) {
      case 'system':
        return this.onSystem(msg);
      case 'assistant':
        return this.onAssistant(msg);
      case 'user':
        return this.onUser(msg);
      case 'result':
        return this.onResult(msg);
      default:
        return [];
    }
  }

  private onSystem(msg: any): ParsedEvent[] {
    if (msg.subtype === 'init') {
      this.sessionId = msg.session_id ?? this.sessionId;
      this.model = msg.model ?? this.model;
      this.currentActivity = 'Session started';
      return [
        {
          kind: 'system',
          summary: `Claude Code session started (model: ${msg.model ?? 'default'}, permission mode: ${msg.permissionMode ?? 'n/a'})`,
          detail: JSON.stringify({ cwd: msg.cwd, tools: msg.tools, session_id: msg.session_id }, null, 2),
        },
      ];
    }
    if (msg.subtype === 'api_retry' || msg.subtype === 'api_error') {
      return [{ kind: 'warning', summary: `API retry: ${truncate(JSON.stringify(msg.error ?? msg), 200)}` }];
    }
    if (msg.subtype === 'compact_boundary') {
      return [{ kind: 'system', summary: 'Context compacted' }];
    }
    return [];
  }

  private onAssistant(msg: any): ParsedEvent[] {
    const m = msg.message ?? {};
    if (m.model && m.model !== '<synthetic>') this.model = m.model;
    if (m.usage) {
      const key = m.id || `anon-${this.usageByMessage.size}`;
      this.usageByMessage.set(key, {
        inputTokens: m.usage.input_tokens ?? 0,
        outputTokens: m.usage.output_tokens ?? 0,
        cacheCreationTokens: m.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: m.usage.cache_read_input_tokens ?? 0,
        cacheCreation1hTokens: m.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      });
    }
    const out: ParsedEvent[] = [];
    for (const block of m.content ?? []) {
      if (block.type === 'text' && block.text) {
        this.lastText = block.text;
        for (const match of String(block.text).matchAll(MILESTONE_RE)) {
          const ms = MILESTONES[match[1].toLowerCase()];
          if (ms && (this.progress === null || ms.progress >= this.progress)) {
            this.progress = ms.progress;
            this.stage = ms.stage;
            out.push({ kind: 'lifecycle', summary: `Milestone: ${ms.stage}` });
          }
        }
        const clean = String(block.text).replace(MILESTONE_RE, '').trim();
        if (clean) {
          out.push({ kind: 'text', summary: truncate(clean, 240), detail: clean.length > 240 ? clean : null });
        }
      } else if (block.type === 'tool_use') {
        this.toolUses++;
        const input = (block.input ?? {}) as Record<string, unknown>;
        const summary = describeToolUse(block.name, input);
        this.toolNames.set(block.id, { name: block.name, summary });
        this.currentActivity = summary;
        if (block.name === 'Bash' && typeof input.command === 'string') {
          if (TEST_CMD_RE.test(input.command) && (this.stage === null || this.stage === 'implementing' || this.stage === 'planning')) {
            this.stage = 'testing';
          }
          else if (BUILD_CMD_RE.test(input.command) && this.stage === null) this.stage = 'implementing';
        }
        if ((block.name === 'Edit' || block.name === 'Write' || block.name === 'MultiEdit') && (this.stage === null || this.stage === 'planning')) {
          this.stage = 'implementing';
        }
        out.push({ kind: 'tool_use', summary, detail: truncate(JSON.stringify(input, null, 2), 4000) });
      } else if (block.type === 'thinking') {
        this.currentActivity = 'Thinking…';
      }
    }
    return out;
  }

  private onUser(msg: any): ParsedEvent[] {
    const out: ParsedEvent[] = [];
    const content = msg.message?.content;
    if (!Array.isArray(content)) return out;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const tool = this.toolNames.get(block.tool_use_id);
      const text = toolResultText(block.content);
      const isError = !!block.is_error;
      const permissionDenied = /permission|not allowed|denied/i.test(text) && isError;
      out.push({
        kind: isError ? (permissionDenied ? 'warning' : 'error') : 'tool_result',
        summary: `${isError ? (permissionDenied ? 'Permission denied' : 'Tool error') : 'Result'}${tool ? ` (${tool.name})` : ''}: ${truncate(text || '(empty)', 200)}`,
        detail: text.length > 200 ? text.slice(0, 20000) : null,
      });
    }
    return out;
  }

  private onResult(msg: any): ParsedEvent[] {
    let modelUsage: Record<string, Usage> | null = null;
    if (msg.modelUsage && typeof msg.modelUsage === 'object') {
      modelUsage = {};
      for (const [model, u] of Object.entries<any>(msg.modelUsage)) {
        modelUsage[model] = {
          inputTokens: u.inputTokens ?? 0,
          outputTokens: u.outputTokens ?? 0,
          cacheCreationTokens: u.cacheCreationInputTokens ?? 0,
          cacheReadTokens: u.cacheReadInputTokens ?? 0,
          cacheCreation1hTokens: u.cacheCreationEphemeral1hInputTokens ?? 0,
        };
      }
      const total = emptyUsage();
      for (const u of Object.values(modelUsage)) {
        total.inputTokens += u.inputTokens;
        total.outputTokens += u.outputTokens;
        total.cacheCreationTokens += u.cacheCreationTokens;
        total.cacheReadTokens += u.cacheReadTokens;
        total.cacheCreation1hTokens = (total.cacheCreation1hTokens ?? 0) + (u.cacheCreation1hTokens ?? 0);
      }
      if (total.inputTokens + total.outputTokens + total.cacheCreationTokens + total.cacheReadTokens > 0) {
        this.finalUsage = total;
      }
    } else if (msg.usage) {
      this.finalUsage = {
        inputTokens: msg.usage.input_tokens ?? 0,
        outputTokens: msg.usage.output_tokens ?? 0,
        cacheCreationTokens: msg.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        cacheCreation1hTokens: msg.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      };
    }
    this.result = {
      isError: !!msg.is_error || (msg.subtype && msg.subtype !== 'success'),
      subtype: msg.subtype ?? 'unknown',
      text: typeof msg.result === 'string' ? msg.result : this.lastText,
      totalCostUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null,
      durationMs: typeof msg.duration_ms === 'number' ? msg.duration_ms : null,
      numTurns: typeof msg.num_turns === 'number' ? msg.num_turns : null,
      modelUsage,
    };
    this.currentActivity = this.result.isError ? 'Agent finished with an error' : 'Agent finished';
    return [
      {
        kind: this.result.isError ? 'error' : 'lifecycle',
        summary: `Agent finished: ${this.result.subtype}${this.result.numTurns ? ` after ${this.result.numTurns} turns` : ''}`,
      },
    ];
  }
}
