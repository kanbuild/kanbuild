import type { Usage } from '../../shared/types.ts';

/**
 * Anthropic first-party API list prices in USD per million tokens.
 * cacheWrite = 5-minute cache write (1.25x input), cacheWrite1h = 1-hour cache write (2x input; Claude Code's default),
 * cacheRead as published (≈0.1x input unless noted).
 *
 * These are ESTIMATES. Users on a Claude subscription (Pro/Max/Team) are not billed per token,
 * and API invoices are the only source of truth for actual charges.
 */
export interface Price {
  input: number;
  output: number;
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
}

const p = (input: number, output: number, cacheRead = input * 0.1): Price => ({
  input,
  output,
  cacheWrite: input * 1.25,
  cacheWrite1h: input * 2,
  cacheRead,
});

// Ordered: first matching prefix wins, so more specific IDs come first.
const TABLE: [string, Price][] = [
  ['claude-fable-5-1', p(10, 50, 0.25)],
  ['claude-mythos-5-1', p(10, 50, 0.25)],
  ['claude-fable-5', p(10, 50)],
  ['claude-opus-5-5', p(4, 20, 0.2)],
  ['claude-opus-5', p(5, 25)],
  ['claude-opus-4-8', p(5, 25)],
  ['claude-opus-4-7', p(5, 25)],
  ['claude-opus-4-6', p(5, 25)],
  ['claude-opus-4-5', p(5, 25)],
  ['claude-opus-4-1', p(15, 75)],
  ['claude-opus-4', p(15, 75)],
  ['claude-sonnet-5-5', p(2, 10, 0.2)],
  ['claude-sonnet-5', p(2, 10)],
  ['claude-sonnet-4', p(3, 15)],
  ['claude-3-7-sonnet', p(3, 15)],
  ['claude-haiku-5-5', p(0.1, 0.5, 0.01)],
  ['claude-haiku-4-5', p(1, 5)],
  ['claude-3-5-haiku', p(0.8, 4)],
];

// Aliases accepted by `claude --model`.
const ALIASES: Record<string, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
  fable: 'claude-fable-5-1',
};

export function priceFor(model: string | null | undefined): Price | null {
  if (!model) return null;
  let m = model.toLowerCase().trim();
  m = m.replace(/\[.*\]$/, ''); // e.g. "claude-opus-5-5[1m]"
  m = m.replace(/^(anthropic\.|us\.anthropic\.|eu\.anthropic\.)/, '');
  if (ALIASES[m]) m = ALIASES[m];
  for (const [prefix, price] of TABLE) if (m.startsWith(prefix)) return price;
  return null;
}

export function estimateCost(usage: Usage, model: string | null | undefined): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const write1h = Math.min(usage.cacheCreation1hTokens ?? 0, usage.cacheCreationTokens);
  const write5m = usage.cacheCreationTokens - write1h;
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      write5m * price.cacheWrite +
      write1h * price.cacheWrite1h +
      usage.cacheReadTokens * price.cacheRead) /
    1_000_000
  );
}

/** Sum the cost of a per-model usage breakdown (Claude Code's `modelUsage` in the result event). */
export function estimateCostByModel(byModel: Record<string, Usage>): number | null {
  let total = 0;
  let any = false;
  for (const [model, usage] of Object.entries(byModel)) {
    const c = estimateCost(usage, model);
    if (c !== null) {
      total += c;
      any = true;
    }
  }
  return any ? total : null;
}
