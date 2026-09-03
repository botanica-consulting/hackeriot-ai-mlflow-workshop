import { env } from 'cloudflare:workers';
import { SCHEMA_STATEMENTS } from '@/db/schema';
import type { PromptVersion, WorkshopSession, WorkshopTrace } from './workshop-types';

type PromptRow = { id: string; team_id: string; version: number; content: string; created_at: string };
type SessionRow = { id: string; team_id: string; run_mode: string; prompt_version: number | null; state_json: string; trace_json: string; created_at: string };

function db() {
  if (!env.DB) throw new Error('D1 database binding is unavailable');
  return env.DB;
}

export async function ensureSchema() {
  const d1 = db();
  await d1.batch(SCHEMA_STATEMENTS.map((statement) => d1.prepare(statement)));
}

export async function ensureTeam(teamId: string, name = 'Team Green') {
  const now = new Date().toISOString();
  await db().prepare('INSERT OR IGNORE INTO teams (id, name, created_at) VALUES (?, ?, ?)').bind(teamId, name, now).run();
}

export async function getTeamName(teamId: string) {
  const row = await db().prepare('SELECT name FROM teams WHERE id = ?').bind(teamId).first<{ name: string }>();
  return row?.name ?? 'Team Green';
}

export async function listPrompts(teamId: string): Promise<PromptVersion[]> {
  const result = await db().prepare('SELECT id, team_id, version, content, created_at FROM prompt_versions WHERE team_id = ? ORDER BY version DESC').bind(teamId).all<PromptRow>();
  return (result.results ?? []).map(mapPrompt);
}

export async function savePrompt(teamId: string, content: string): Promise<PromptVersion> {
  const latest = await db().prepare('SELECT COALESCE(MAX(version), 0) AS version FROM prompt_versions WHERE team_id = ?').bind(teamId).first<{ version: number }>();
  const prompt: PromptVersion = {
    id: crypto.randomUUID(), teamId, version: Number(latest?.version ?? 0) + 1,
    content, createdAt: new Date().toISOString(),
  };
  await db().prepare('INSERT INTO prompt_versions (id, team_id, version, content, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(prompt.id, prompt.teamId, prompt.version, prompt.content, prompt.createdAt).run();
  return prompt;
}

export async function getPrompt(teamId: string, version: number | null): Promise<PromptVersion | null> {
  if (version == null) return null;
  const row = await db().prepare('SELECT id, team_id, version, content, created_at FROM prompt_versions WHERE team_id = ? AND version = ?')
    .bind(teamId, version).first<PromptRow>();
  return row ? mapPrompt(row) : null;
}

export async function saveSession(session: WorkshopSession) {
  const now = new Date().toISOString();
  syncSessionMetadata(session);
  await db().prepare(`INSERT INTO sessions (id, team_id, run_mode, prompt_version, state_json, trace_json, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(session.id, session.teamId, session.runMode, session.promptVersion, JSON.stringify(session.state), JSON.stringify(session.trace), session.trace.status, session.createdAt, now).run();
}

export async function updateSession(session: WorkshopSession) {
  syncSessionMetadata(session);
  await db().prepare('UPDATE sessions SET state_json = ?, trace_json = ?, status = ?, updated_at = ? WHERE id = ?')
    .bind(JSON.stringify(session.state), JSON.stringify(session.trace), session.trace.status, new Date().toISOString(), session.id).run();
}

export async function getSession(sessionId: string): Promise<WorkshopSession | null> {
  const row = await db().prepare('SELECT id, team_id, run_mode, prompt_version, state_json, trace_json, created_at FROM sessions WHERE id = ?').bind(sessionId).first<SessionRow>();
  return row ? mapSession(row) : null;
}

export async function latestSession(teamId: string): Promise<WorkshopSession | null> {
  const row = await db().prepare('SELECT id, team_id, run_mode, prompt_version, state_json, trace_json, created_at FROM sessions WHERE team_id = ? ORDER BY updated_at DESC LIMIT 1').bind(teamId).first<SessionRow>();
  return row ? mapSession(row) : null;
}

export async function listTraces(teamId: string, limit = 12): Promise<WorkshopTrace[]> {
  const result = await db().prepare('SELECT trace_json FROM sessions WHERE team_id = ? ORDER BY updated_at DESC LIMIT ?').bind(teamId, limit).all<{ trace_json: string }>();
  return (result.results ?? []).map((row) => JSON.parse(row.trace_json) as WorkshopTrace);
}

export async function resetTeam(teamId: string) {
  const d1 = db();
  await d1.batch([
    d1.prepare('DELETE FROM sessions WHERE team_id = ?').bind(teamId),
    d1.prepare('DELETE FROM prompt_versions WHERE team_id = ?').bind(teamId),
  ]);
}

function mapPrompt(row: PromptRow): PromptVersion {
  return { id: row.id, teamId: row.team_id, version: row.version, content: row.content, createdAt: row.created_at };
}

function mapSession(row: SessionRow): WorkshopSession {
  const state = JSON.parse(row.state_json) as WorkshopSession['state'];
  const stored = JSON.parse(row.trace_json) as WorkshopSession['trace'];
  return {
    id: row.id, teamId: row.team_id, runMode: row.run_mode as WorkshopSession['runMode'],
    promptVersion: row.prompt_version, level: stored.level ?? 'clean', customTools: stored.customTools ?? [], lastToolOutput: stored.lastToolOutput, state, trace: stored, createdAt: row.created_at,
  };
}

function syncSessionMetadata(session: WorkshopSession) {
  session.trace.level = session.level;
  session.trace.customTools = session.customTools;
  session.trace.lastToolOutput = session.lastToolOutput;
}
