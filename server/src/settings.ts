import { getDb } from './db.ts';
import type { Settings } from '../../shared/types.ts';
import { bus } from './events.ts';

const DEFAULTS: Settings = {
  concurrency: 2,
  defaultModel: '',
  editorCommand: 'code',
  claudeBinary: process.env.ORCH_CLAUDE_BIN || 'claude',
};

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const s: Settings = { ...DEFAULTS };
  for (const r of rows) {
    if (r.key in s) (s as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value);
  }
  // Environment override always wins for the binary (used for tests / custom installs).
  if (process.env.ORCH_CLAUDE_BIN) s.claudeBinary = process.env.ORCH_CLAUDE_BIN;
  return s;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const d = getDb();
  const stmt = d.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS) || v === undefined) continue;
    if (k === 'concurrency') {
      const n = Math.max(1, Math.min(16, Math.floor(Number(v))));
      if (!Number.isFinite(n)) continue;
      stmt.run(k, JSON.stringify(n));
    } else {
      stmt.run(k, JSON.stringify(String(v)));
    }
  }
  const s = getSettings();
  bus.publish({ type: 'settings.updated', settings: s });
  return s;
}
