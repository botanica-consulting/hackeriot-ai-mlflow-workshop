import { activeInstructions, AGENT_TOOLS } from './agent-policy.server';
import type { AgentProvider, ReasoningEffort } from './agent-provider.server';
import { isAgentActionName, publicObservation } from './game-engine';
import type { AgentAction, GameState, RunMode } from './workshop-types';

interface AgentStepResult {
  action: AgentAction;
  model: string;
  provider: AgentProvider;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export async function runAgentStep(options: {
  state: GameState;
  runMode: RunMode;
  strategy: string;
  imageDataUrl?: string;
  apiKey?: string;
  provider: AgentProvider;
  responsesUrl?: string;
  extraHeaders?: Record<string, string>;
  model: string;
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
}): Promise<AgentStepResult> {
  const started = Date.now();
  const content: Array<Record<string, unknown>> = [
    { type: 'input_text', text: `Current turn: ${options.state.turns + 1}\n${publicObservation(options.state)}\nChoose exactly one tool.` },
  ];
  if (options.state.interfaceMode === 'visual' && options.imageDataUrl?.startsWith('data:image/png')) {
    content.push({ type: 'input_image', image_url: options.imageDataUrl, detail: 'low' });
  }

  if (!options.apiKey || !options.responsesUrl) {
    throw new Error(`${providerLabel(options.provider)} is selected but its API key is missing`);
  }

  const response = await fetch(options.responsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      ...options.extraHeaders,
    },
    body: JSON.stringify({
      model: options.model,
      instructions: activeInstructions(options.runMode, options.strategy),
      input: [{ role: 'user', content }],
      tools: AGENT_TOOLS,
      tool_choice: 'required',
      parallel_tool_calls: false,
      reasoning: { effort: options.reasoningEffort ?? 'low' },
      max_output_tokens: options.maxOutputTokens ?? 300,
      store: false,
      safety_identifier: 'hackeriot-workshop-participant',
    }),
  });

  if (!response.ok) {
    throw new Error(`${providerLabel(options.provider)} request failed (${response.status}): ${await safeErrorMessage(response)}`);
  }

  const payload = await response.json() as {
    model?: string;
    output?: Array<{ type?: string; name?: string; arguments?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const call = payload.output?.find((item) => item.type === 'function_call');
  if (!call?.name || !isAgentActionName(call.name)) throw new Error('Model did not return a valid game tool call');

  let args: Record<string, string | number | boolean> = {};
  try { args = call.arguments ? JSON.parse(call.arguments) : {}; } catch { args = {}; }

  return {
    action: { name: call.name, arguments: args, publicRationale: `Selected ${call.name} from the available evidence.` },
    model: payload.model ?? options.model,
    provider: options.provider,
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
    latencyMs: Date.now() - started,
  };
}

function providerLabel(provider: AgentProvider) {
  return provider === 'openrouter' ? 'OpenRouter' : 'OpenAI';
}

async function safeErrorMessage(response: Response) {
  try {
    const payload = await response.json() as {
      error?: { message?: string; metadata?: { raw?: string; provider_name?: string } } | string;
      message?: string;
    };
    if (typeof payload.error === 'object' && payload.error?.metadata?.raw) {
      try {
        const upstream = JSON.parse(payload.error.metadata.raw) as { error?: { message?: string } };
        const detail = upstream.error?.message;
        if (detail) return `${payload.error.metadata.provider_name ?? 'Provider'}: ${detail}`.slice(0, 600);
      } catch { /* keep the provider's top-level message */ }
    }
    const message = typeof payload.error === 'string' ? payload.error : payload.error?.message ?? payload.message;
    return message?.slice(0, 600) ?? response.statusText;
  } catch {
    return response.statusText || 'Unknown provider error';
  }
}
