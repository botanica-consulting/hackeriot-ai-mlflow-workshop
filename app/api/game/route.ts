import { resolveAgentProvider, type AgentProviderEnvironment } from '@/lib/agent-provider.server';
import { exportToMlflow } from '@/lib/mlflow-export.server';
import { getLevel, LAB_LEVELS } from '@/lib/prompt-lab';
import { runTrial } from '@/lib/prompt-lab.server';

type RuntimeEnvironment = AgentProviderEnvironment & {
  MLFLOW_TRACKING_URI?: string;
  MLFLOW_PUBLIC_URL?: string;
  MLFLOW_EXPERIMENT_ID?: string;
  MLFLOW_EXPERIMENT_NAME?: string;
};

const env = process.env as RuntimeEnvironment;

export async function GET() {
  const provider = resolveAgentProvider(env);
  return Response.json({
    levels: LAB_LEVELS.map((level) => ({
      id: level.id,
      title: level.title,
      tools: level.tools,
      toolsEditable: Boolean(level.toolsEditable),
      trials: level.trials.map(({ id, label, prompt }) => ({ id, label, prompt })),
    })),
    configuration: {
      liveModelAvailable: provider.live,
      model: provider.model,
      mlflowConfigured: Boolean(env.MLFLOW_TRACKING_URI),
      mlflowUrl: env.MLFLOW_PUBLIC_URL ?? env.MLFLOW_TRACKING_URI,
    },
  });
}

export async function POST(request: Request) {
  const payload = await request.json() as { levelId?: number; prompts?: Array<{ trialId?: string; prompt?: string }>; allowedTools?: unknown };
  const level = getLevel(Number(payload.levelId));
  if (!level) return Response.json({ error: 'Unknown level.' }, { status: 400 });
  const provider = resolveAgentProvider(env);
  if (!provider.live) return Response.json({ error: 'A live AI provider key is required.' }, { status: 503 });
  const allowedTools = level.toolsEditable ? cleanTools(payload.allowedTools, level.tools) : level.tools;
  if (!allowedTools.length) return Response.json({ error: 'At least one AI tool must remain enabled.' }, { status: 400 });

  const promptByTrial = new Map((payload.prompts ?? []).map((item) => [item.trialId, item.prompt]));
  try {
    const runs = await Promise.all(level.trials.map((trial) => {
      const prompt = cleanPrompt(promptByTrial.get(trial.id), trial.prompt);
      return runTrial({ levelId: level.id, levelTitle: level.title, trial, prompt, provider, allowedTools });
    }));
    const exports = await Promise.all(runs.map(({ trace }) => exportToMlflow(trace, {
      trackingUri: env.MLFLOW_TRACKING_URI,
      experimentId: env.MLFLOW_EXPERIMENT_ID,
      experimentName: env.MLFLOW_EXPERIMENT_NAME ?? 'Prompt Lab',
    })));
    const results = runs.map(({ result }, index) => ({
      ...result,
      exportedToMlflow: exports[index].exported,
      exportError: exports[index].error,
    }));
    return Response.json({ results, score: results.reduce((sum, result) => sum + result.score, 0) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The AI run failed.';
    return Response.json({ error: message }, { status: 502 });
  }
}

function cleanPrompt(value: unknown, fallback: string) {
  if (typeof value !== 'string') return fallback;
  const prompt = value.trim();
  if (!prompt) return fallback;
  return prompt.slice(0, 1000);
}

function cleanTools(value: unknown, available: string[]) {
  if (!Array.isArray(value)) return available;
  const selected = new Set(value.filter((item): item is string => typeof item === 'string'));
  return available.filter((name) => selected.has(name));
}
