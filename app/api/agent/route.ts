import { env } from 'cloudflare:workers';
import { applyGameAction, toolOutputFor } from '@/lib/game-engine';
import { exportToMlflow } from '@/lib/mlflow-export.server';
import { runAgentStep } from '@/lib/openai-agent.server';
import { getPrompt, getSession, updateSession } from '@/lib/repository.server';
import { appendStepSpans } from '@/lib/trace.server';

export async function POST(request: Request) {
  const payload = await request.json() as { sessionId?: string; imageDataUrl?: string };
  if (!payload.sessionId) return Response.json({ error: 'sessionId is required' }, { status: 400 });
  const session = await getSession(payload.sessionId);
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
  if (session.state.completed || session.state.failed) return Response.json({ session });

  const prompt = await getPrompt(session.teamId, session.promptVersion);
  const strategy = session.runMode === 'participant' ? prompt?.content ?? '' : '';
  const before = structuredClone(session.state);
  let result;
  let fallbackError: string | undefined;

  try {
    result = await runAgentStep({
      state: before, runMode: session.runMode, strategy, imageDataUrl: payload.imageDataUrl,
      apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL ?? 'gpt-5.6-terra',
    });
  } catch (error) {
    fallbackError = error instanceof Error ? error.message : 'Live model call failed';
    result = await runAgentStep({ state: before, runMode: session.runMode, strategy, model: env.OPENAI_MODEL ?? 'gpt-5.6-terra' });
  }

  const nextState = applyGameAction(before, result.action, strategy);
  const toolOutput = toolOutputFor(result.action, nextState);
  session.state = nextState;
  appendStepSpans(session.trace, {
    before, after: nextState, action: result.action, model: result.model, provider: result.provider,
    inputTokens: result.inputTokens, outputTokens: result.outputTokens, latencyMs: result.latencyMs,
    toolOutput, participantStrategy: strategy,
  });

  if (fallbackError) session.trace.exportError = `Live model fallback: ${fallbackError}`;
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
  return Response.json({ session, action: result.action, toolOutput, provider: result.provider, fallbackError });
}
