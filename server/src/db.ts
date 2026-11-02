import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Loaded via require so bundlers/test runners don't strip the `node:` prefix of this newer builtin.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncType;

export const DATA_DIR = path.resolve(
  process.env.ORCH_DATA_DIR || path.join(os.homedir(), '.local-orchestrator'),
);
export const RUNS_DIR = path.join(DATA_DIR, 'runs');

let db: DatabaseSync | null = null;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL UNIQUE,
    base_branch TEXT NOT NULL,
    worktree_root TEXT NOT NULL,
    allowed_tools TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE features (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'backlog',
    position REAL NOT NULL DEFAULT 0,
    branch TEXT,
    worktree_path TEXT,
    session_id TEXT,
    agent_status TEXT,
    current_run_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX features_project ON features(project_id, status, position);
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    feature_id TEXT NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL,
    status TEXT NOT NULL,
    pid INTEGER,
    log_dir TEXT,
    log_offset INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    ended_at TEXT,
    exit_code INTEGER,
    error TEXT,
    progress REAL,
    stage TEXT,
    current_activity TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    reported_cost_usd REAL,
    estimated_cost_usd REAL,
    session_id TEXT,
    commit_hash TEXT,
    report_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX runs_feature ON runs(feature_id, attempt);
  CREATE TABLE run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    ts TEXT NOT NULL,
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    detail TEXT
  );
  CREATE INDEX run_events_run ON run_events(run_id, id);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  `ALTER TABLE runs ADD COLUMN cache_creation_1h_tokens INTEGER NOT NULL DEFAULT 0;`,
  `
  ALTER TABLE projects ADD COLUMN agent_profile TEXT NOT NULL DEFAULT '';
  ALTER TABLE projects ADD COLUMN effort TEXT NOT NULL DEFAULT '';
  ALTER TABLE projects ADD COLUMN mcp_config TEXT NOT NULL DEFAULT '';
  ALTER TABLE runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'feature';
  ALTER TABLE runs ADD COLUMN message TEXT;
  ALTER TABLE runs ADD COLUMN turns INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN baseline_context_tokens INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN peak_context_tokens INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN permission_denials INTEGER NOT NULL DEFAULT 0;
  `,
];

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const file = process.env.ORCH_DB_FILE || path.join(DATA_DIR, 'orchestrator.db');
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(d: DatabaseSync) {
  const version = (d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let i = version; i < MIGRATIONS.length; i++) {
    d.exec('BEGIN');
    try {
      d.exec(MIGRATIONS[i]);
      d.exec(`PRAGMA user_version = ${i + 1}`);
      d.exec('COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  }
}

/** Close and forget the connection (used by tests). */
export function closeDb() {
  db?.close();
  db = null;
}

export function now(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function tx<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}
