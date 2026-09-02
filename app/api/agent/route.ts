import { env } from 'cloudflare:workers';
import { AGENT_TOOLS } from '@/lib/agent-policy.server';
import { resolveAgentProvider } from '@/lib/agent-provider.server';
import { applyGameAction, normalizeGameState, toolOutputFor } from '@/lib/game-engine';
import { exportToMlflow } from '@/lib/mlflow-export.server';
import { runAgentStep } from '@/lib/openai-agent.server';
import { getPrompt, getSession, updateSession } from '@/lib/repository.server';
import { appendAgentError, appendStepSpans } from '@/lib/trace.server';

export async function POST(request: Request) {
  const payload = await request.json() as { sessionId?: string; imageDataUrl?: string };
  if (!payload.sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 });
  const session = await getSession(payload.sessionId);
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
  if (session.runMode === 'human') return Response.json({ error: 'Human sessions use the action harness, not the LLM endpoint.' }, { status: 409 });
  if (session.state.completed || session.state.failed) return Response.json({ session });

  const prompt = await getPrompt(session.teamId, session.promptVersion);
  const strategy = session.runMode === 'participant' ? prompt?.content ?? '' : '';
  const before = normalizeGameState(session.state);
  let result;
  const provider = resolveAgentProvider(env);

  try {
    result = await runAgentStep({
      state: before, runMode: session.runMode, strategy, imageDataUrl: payload.imageDataUrl,
      provider: provider.provider, apiKey: provider.apiKey, model: provider.model,
      responsesUrl: provider.responsesUrl, extraHeaders: provider.extraHeaders,
      maxOutputTokens: provider.maxOutputTokens, reasoningEffort: provider.reasoningEffort,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Live model call failed';
    appendAgentError(session.trace, { model: provider.model, provider: provider.provider, message });
    await updateSession(session);
    return Response.json({ error: message, session }, { status: 502 });
  }

  const nextState = applyGameAction(before, result.action);
  const toolOutput = toolOutputFor(result.action, nextState);
  session.state = nextState;
  appendStepSpans(session.trace, {
    before, after: nextState, action: result.action, model: result.model, provider: result.provider,
    inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs: result.latencyMs,
    toolOutput, participantStrategy: strategy,
    toolCatalog: AGENT_TOOLS.map((tool) => ({ name: tool.name, description: tool.description })),
  });

  if (nextState.completed || nextState.failed) {
    const exportResult = await exportToMlflow(session.trace, {
      trackingUri: env.MLFLOW_TRACKING_URI,
      experimentId: env.MLFLOW_EXPERIMENT_ID,
      experimentName: env.MLFLOW_EXPERIMENT_NAME,
    });
    session.trace.exportedToMlflow = exportResult.exported;
    if (exportResult.error) session.trace.exportError = exportResult.error;
  }

  await updateSession(session);
  return Response.json({ session, action: result.action, toolOutput, provider: result.provider });
}
