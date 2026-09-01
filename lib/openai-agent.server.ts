import { activeInstructions, AGENT_TOOLS, chooseDemoAction } from './agent-policy.server';
import { isAgentActionName, publicObservation } from './game-engine';
import type { AgentAction, GameState, RunMode } from './workshop-types';

interface AgentStepResult {
  action: AgentAction;
  model: string;
  provider: 'openai' | 'demo';
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
  model: string;
}): Promise<AgentStepResult> {
  const started = Date.now();
  if (!options.apiKey) {
    const action = chooseDemoAction(options.state, options.runMode, options.strategy);
    return {
      action,
      model: `${options.model} · simulated`,
      provider: 'demo',
      inputTokens: 620 + options.state.turns * 45 + (options.state.interfaceMode === 'visual' ? 520 : 80),
      outputTokens: 42,
      latencyMs: 180 + options.state.turns * 17,
    };
  }

  const content: Array<Record<string, unknown>> = [
    { type: 'input_text', text: `Current turn: ${options.state.turns + 1}\n${publicObservation(options.state)}\nChoose exactly one tool.` },
  ];
  if (options.state.interfaceMode === 'visual' && options.imageDataUrl?.startsWith('data:image/png')) {
    content.push({ type: 'input_image', image_url: options.imageDataUrl, detail: 'low' });
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: options.model,
      instructions: activeInstructions(options.runMode, options.strategy),
      input: [{ role: 'user', content }],
      tools: AGENT_TOOLS,
      tool_choice: 'required',
      parallel_tool_calls: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 300,
      store: false,
      safety_identifier: 'hackeriot-workshop-participant',
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
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
    provider: 'openai',
    inputTokens: payload.usage?.input_tokens ?? 0,
    outputTokens: payload.usage?.output_tokens ?? 0,
    latencyMs: Date.now() - started,
  };
}
