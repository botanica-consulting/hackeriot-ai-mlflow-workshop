import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
});

export const promptVersions = sqliteTable('prompt_versions', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id),
  version: integer('version').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().references(() => teams.id),
  runMode: text('run_mode').notNull(),
  promptVersion: integer('prompt_version'),
  stateJson: text('state_json').notNull(),
  traceJson: text('trace_json').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prompt_versions (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(team_id) REFERENCES teams(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_versions_team_version
   ON prompt_versions(team_id, version)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    run_mode TEXT NOT NULL,
    prompt_version INTEGER,
    state_json TEXT NOT NULL,
    trace_json TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(team_id) REFERENCES teams(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_team_updated
   ON sessions(team_id, updated_at DESC)`,
] as const;
