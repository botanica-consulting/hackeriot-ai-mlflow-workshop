import { env } from 'cloudflare:workers';
import { resolveAgentProvider } from '@/lib/agent-provider.server';
import { applyGameAction, createInitialGameState, isAgentActionName, toolOutputFor } from '@/lib/game-engine';
import {
  ensureSchema, ensureTeam, getSession, getTeamName, latestSession, listPrompts, listTraces,
  savePrompt, saveSession, updateSession,
} from '@/lib/repository.server';
import { appendHumanActionSpans, createTrace } from '@/lib/trace.server';
import type { AgentAction, RunMode, WorkshopSession, WorkshopSnapshot } from '@/lib/workshop-types';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const teamId = safeTeamId(url.searchParams.get('team') ?? 'team-green');
  await ensureSchema();
  await ensureTeam(teamId);
  return Response.json(await snapshot(teamId));
}

export async function POST(request: Request) {
  const payload = await request.json() as Record<string, unknown>;
  const teamId = safeTeamId(typeof payload.teamId === 'string' ? payload.teamId : 'team-green');
  await ensureSchema();
  await ensureTeam(teamId, (typeof payload.teamName === 'string' ? payload.teamName : 'Team Green').slice(0, 60));

  switch (payload.action) {
    case 'save_prompt': {
      const content = (typeof payload.content === 'string' ? payload.content : '').trim();
      if (content.length > 6000) return Response.json({ error: 'Prompt must contain no more than 6000 characters.' }, { status: 400 });
      await savePrompt(teamId, content);
      return Response.json(await snapshot(teamId));
    }
    case 'start_run': {
      const provider = resolveAgentProvider(env);
      const runMode: RunMode = payload.runMode === 'human' ? 'human' : 'participant';
      if (runMode !== 'human' && !provider.live) return Response.json({ error: `Add a ${provider.provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY'} before starting an AI run.` }, { status: 503 });
      const prompts = await listPrompts(teamId);
      const promptVersion = runMode === 'participant' ? Number(payload.promptVersion ?? prompts[0]?.version ?? 0) || null : null;
      if (runMode === 'participant' && promptVersion == null) return Response.json({ error: 'Save a participant strategy first.' }, { status: 400 });
      const id = crypto.randomUUID();
      const model = runMode === 'human' ? 'human-player' : provider.model;
      const session: WorkshopSession = {
        id, teamId, runMode, promptVersion, state: createInitialGameState(), createdAt: new Date().toISOString(),
        trace: createTrace({ sessionId: id, teamId, runMode, promptVersion, model }),
      };
      await saveSession(session);
      return Response.json({ session, snapshot: await snapshot(teamId) });
    }
    case 'human_action': {
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
      const toolName = typeof payload.toolName === 'string' ? payload.toolName : '';
      if (!sessionId || !isAgentActionName(toolName)) return Response.json({ error: 'A valid human tool action is required.' }, { status: 400 });
      const session = await getSession(sessionId);
      if (!session || session.teamId !== teamId) return Response.json({ error: 'Human session not found.' }, { status: 404 });
      if (session.runMode !== 'human') return Response.json({ error: 'Human actions can only be used in human exploration mode.' }, { status: 409 });
      if (session.state.completed || session.state.failed) return Response.json({ session, toolOutput: { message: 'This session has ended. Start a new human exploration.' } });
      const action: AgentAction = {
        name: toolName,
        arguments: isPlainObject(payload.arguments) ? payload.arguments as AgentAction['arguments'] : {},
        publicRationale: 'Selected by the human explorer through the action harness.',
      };
      const before = structuredClone(session.state);
      const after = applyGameAction(before, action);
      const toolOutput = toolOutputFor(action, after);
      session.state = after;
      appendHumanActionSpans(session.trace, { before, after, action, toolOutput });
      await updateSession(session);
      return Response.json({ session, toolOutput });
    }
    case 'stop_run': {
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : '';
      const session = await getSession(sessionId);
      if (!session || session.teamId !== teamId || session.runMode !== 'participant') return Response.json({ error: 'Prompt run not found.' }, { status: 404 });
      const now = Date.now();
      session.trace.status = 'ERROR';
      session.trace.endedAt = new Date(now).toISOString();
      const root = session.trace.spans[0];
      if (root) {
        root.status = 'ERROR';
        root.endTime = now;
        root.outputs = { state: 'stopped', score: session.state.score };
      }
      await updateSession(session);
      return Response.json({ session });
    }
    default:
      return Response.json({ error: 'Unknown workshop action.' }, { status: 400 });
  }
}

async function snapshot(teamId: string): Promise<WorkshopSnapshot> {
  const provider = resolveAgentProvider(env);
  const [teamName, prompts, traces, activeSession] = await Promise.all([
    getTeamName(teamId), listPrompts(teamId), listTraces(teamId), latestSession(teamId),
  ]);
  return {
    teamId, teamName, prompts, traces, activeSession,
    configuration: {
      liveModelAvailable: provider.live,
      provider: provider.provider,
      model: provider.model,
      mlflowConfigured: Boolean(env.MLFLOW_TRACKING_URI),
      mlflowUrl: env.MLFLOW_TRACKING_URI,
    },
  };
}

function safeTeamId(value: string) {
  const safe = value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 48);
  return safe || 'team-green';
}

function isPlainObject(value: unknown): value is Record<string, string | number | boolean> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
