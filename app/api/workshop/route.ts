import { env } from 'cloudflare:workers';
import { HIDDEN_BAD_BASELINE, PARTICIPANT_STARTER } from '@/lib/agent-policy.server';
import { createInitialGameState } from '@/lib/game-engine';
import {
  ensureSchema, ensureTeam, getTeamName, latestSession, listPrompts, listTraces,
  resetTeam, savePrompt, saveSession,
} from '@/lib/repository.server';
import { createTrace } from '@/lib/trace.server';
import type { RunMode, WorkshopSession, WorkshopSnapshot } from '@/lib/workshop-types';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = safeTeamId(url.searchParams.get('team') ?? 'team-green');
  await ensureSchema();
  await ensureTeam(teamId);
  return Response.json(await snapshot(teamId));
}

export async function POST(request: Request) {
  const payload = await request.json() as Record<string, unknown>;
  const teamId = safeTeamId(String(payload.teamId ?? 'team-green'));
  await ensureSchema();
  await ensureTeam(teamId, String(payload.teamName ?? 'Team Green').slice(0, 60));

  switch (payload.action) {
    case 'save_prompt': {
      const content = String(payload.content ?? '').trim();
      if (content.length < 40 || content.length > 6000) return Response.json({ error: 'Prompt must contain 40–6000 characters.' }, { status: 400 });
      await savePrompt(teamId, content);
      return Response.json(await snapshot(teamId));
    }
    case 'start_run': {
      const runMode: RunMode = payload.runMode === 'participant' ? 'participant' : 'baseline';
      const prompts = await listPrompts(teamId);
      const promptVersion = runMode === 'participant' ? Number(payload.promptVersion ?? prompts[0]?.version ?? 0) || null : null;
      if (runMode === 'participant' && promptVersion == null) return Response.json({ error: 'Save a participant strategy first.' }, { status: 400 });
      const id = crypto.randomUUID();
      const model = env.OPENAI_MODEL ?? 'gpt-5.6-terra';
      const session: WorkshopSession = {
        id, teamId, runMode, promptVersion, state: createInitialGameState(), createdAt: new Date().toISOString(),
        trace: createTrace({ sessionId: id, teamId, runMode, promptVersion, model }),
      };
      await saveSession(session);
      return Response.json({ session, snapshot: await snapshot(teamId) });
    }
    case 'reset_team': {
      if (!instructorAuthorized(request)) return Response.json({ error: 'Instructor token is incorrect.' }, { status: 403 });
      await resetTeam(teamId);
      await ensureTeam(teamId);
      return Response.json(await snapshot(teamId));
    }
    case 'reveal_baseline': {
      if (!instructorAuthorized(request)) return Response.json({ error: 'Instructor token is incorrect.' }, { status: 403 });
      return Response.json({ baseline: HIDDEN_BAD_BASELINE });
    }
    case 'starter_prompt':
      return Response.json({ starter: PARTICIPANT_STARTER });
    default:
      return Response.json({ error: 'Unknown workshop action.' }, { status: 400 });
  }
}

async function snapshot(teamId: string): Promise<WorkshopSnapshot> {
  const [teamName, prompts, traces, activeSession] = await Promise.all([
    getTeamName(teamId), listPrompts(teamId), listTraces(teamId), latestSession(teamId),
  ]);
  return {
    teamId, teamName, prompts, traces, activeSession,
    configuration: {
      liveModelAvailable: Boolean(env.OPENAI_API_KEY),
      model: env.OPENAI_MODEL ?? 'gpt-5.6-terra',
      mlflowConfigured: Boolean(env.MLFLOW_TRACKING_URI),
      mlflowUrl: env.MLFLOW_TRACKING_URI,
    },
  };
}

function instructorAuthorized(request: Request) {
  return !env.INSTRUCTOR_TOKEN || request.headers.get('x-instructor-token') === env.INSTRUCTOR_TOKEN;
}

function safeTeamId(value: string) {
  const safe = value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 48);
  return safe || 'team-green';
}
