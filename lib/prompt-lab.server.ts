import type { AgentProviderConfig } from './agent-provider.server';
import { buildStatsSnapshot, evaluateTrial, executeTool, LAB_TOOLS, systemPromptForLevel, type TrialDefinition } from './prompt-lab';

export type LabSpan = {
  id: string;
  parentId?: string;
  name: string;
  type: 'CHAIN' | 'LLM' | 'TOOL' | 'EVALUATOR';
  startTime: number;
  endTime: number;
  status: 'OK' | 'ERROR';
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  attributes?: Record<string, string | number | boolean>;
};

export type LabTrace = {
  id: string;
  levelId: number;
  levelTitle: string;
  trialId: string;
  trialLabel: string;
  prompt: string;
  model: string;
  provider: string;
  score: number;
  passed: boolean;
  tokenUsage: { input: number; output: number; total: number };
  latencyMs: number;
  spans: LabSpan[];
};

export type TrialRun = {
  trialId: string;
  label: string;
  prompt: string;
  status: 'passed' | 'failed';
  toolCall: string;
  assistantMessage: string;
  traceId: string;
  score: number;
  tokens: number;
  latencyMs: number;
  exportedToMlflow: boolean;
  exportError?: string;
};

export async function runTrial(options: {
  levelId: number;
  levelTitle: string;
  trial: TrialDefinition;
  prompt: string;
  provider: AgentProviderConfig;
  allowedTools: string[];
}): Promise<{ result: TrialRun; trace: LabTrace }> {
  const { provider } = options;
  if (!provider.apiKey || !provider.responsesUrl) throw new Error('The live AI provider is not configured.');
  const started = Date.now();
  const systemPrompt = systemPromptForLevel(options.levelId);
  const allowed = new Set(options.allowedTools);
  const tools = LAB_TOOLS.filter((tool) => allowed.has(tool.name));
  if (!tools.length) throw new Error('At least one AI tool must remain enabled.');
  const maxToolCalls = options.trial.maxToolCalls ?? 1;
  const conversation: unknown[] = [{ role: 'user', content: [{ type: 'input_text', text: options.prompt }] }];
  const steps: Array<{
    response: ResponsePayload;
    call: { name: string; call_id: string; arguments?: string };
    args: Record<string, unknown>;
    output: ReturnType<typeof executeTool>;
    stats: ReturnType<typeof buildStatsSnapshot>;
    choiceStarted: number;
    choiceEnded: number;
    toolEnded: number;
    statsEnded: number;
  }> = [];
  let state = { ...options.trial.initial };
  let inputTokens = 0;
  let outputTokens = 0;
  let nextStarted = started;
  let final: ResponsePayload | undefined;
  let finalStarted = started;
  let ended = started;

  for (let stepIndex = 0; stepIndex < maxToolCalls; stepIndex += 1) {
    const response = await requestResponse(provider, {
      model: provider.model,
      instructions: systemPrompt,
      input: conversation,
      tools,
      tool_choice: stepIndex === 0 ? 'required' : 'auto',
      parallel_tool_calls: false,
      reasoning: { effort: provider.reasoningEffort },
      max_output_tokens: provider.maxOutputTokens,
      store: false,
      safety_identifier: 'prompt-lab-workshop',
    });
    const choiceEnded = Date.now();
    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
    const call = response.output?.find((item) => item.type === 'function_call');
    if (!call?.name || !call.call_id) {
      if (stepIndex === 0) throw new Error('The AI did not return a valid tool call.');
      final = response;
      finalStarted = nextStarted;
      ended = choiceEnded;
      break;
    }
    if (!tools.some((tool) => tool.name === call.name)) throw new Error('The AI selected a disabled tool.');
    let args: Record<string, unknown> = {};
    try { args = call.arguments ? JSON.parse(call.arguments) as Record<string, unknown> : {}; } catch { args = {}; }
    const output = executeTool(call.name, args, state);
    const toolEnded = Date.now();
    const stats = buildStatsSnapshot(options.trial, output, options.levelId);
    const statsEnded = Math.max(Date.now(), toolEnded + 1);
    const validCall = { name: call.name, call_id: call.call_id, arguments: call.arguments };
    steps.push({ response, call: validCall, args, output, stats, choiceStarted: nextStarted, choiceEnded, toolEnded, statsEnded });
    conversation.push(...(response.output ?? []), { type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
    state = output;
    nextStarted = statsEnded;
  }

  if (!final) {
    finalStarted = nextStarted;
    final = await requestResponse(provider, {
      model: provider.model,
      instructions: 'Report the completed AI actions in one short sentence. Do not call another tool.',
      input: conversation,
      max_output_tokens: 96,
      store: false,
      safety_identifier: 'prompt-lab-workshop',
    });
    ended = Date.now();
    inputTokens += final.usage?.input_tokens ?? 0;
    outputTokens += final.usage?.output_tokens ?? 0;
  }

  const evaluation = evaluateTrial(options.trial, state);
  const traceId = `trace-${crypto.randomUUID()}`;
  const rootId = spanId();
  const assistantMessage = outputText(final) || 'Tool completed.';
  const actionSpans: LabSpan[] = [];
  for (const [index, step] of steps.entries()) {
    actionSpans.push({
      id: spanId(), parentId: rootId, name: index === 0 ? 'llm.choose_tool' : `llm.choose_tool.${index + 1}`, type: 'LLM',
      startTime: step.choiceStarted, endTime: step.choiceEnded, status: 'OK',
      inputs: { system_prompt: systemPrompt, user_prompt: options.prompt, enabled_tools: tools.map(({ name, description }) => ({ name, description })) },
      outputs: { tool: step.call.name, arguments: step.args },
      attributes: { 'gen_ai.request.model': step.response.model ?? provider.model, 'gen_ai.usage.input_tokens': step.response.usage?.input_tokens ?? 0, 'gen_ai.usage.output_tokens': step.response.usage?.output_tokens ?? 0, 'workshop.step': index + 1 },
    }, {
      id: spanId(), parentId: rootId, name: `tool.${step.call.name}`, type: 'TOOL',
      startTime: step.choiceEnded, endTime: step.toolEnded, status: 'OK', inputs: step.args, outputs: step.output,
      attributes: { 'workshop.step': index + 1 },
    }, {
      id: spanId(), parentId: rootId, name: `tool.check_stats.${index + 1}`, type: 'TOOL',
      startTime: step.toolEnded, endTime: step.statsEnded, status: 'OK', inputs: { scope: 'all', after: step.call.name }, outputs: step.stats,
      attributes: { 'workshop.automatic': true, 'workshop.step': index + 1 },
    });
  }
  const trace: LabTrace = {
    id: traceId,
    levelId: options.levelId,
    levelTitle: options.levelTitle,
    trialId: options.trial.id,
    trialLabel: options.trial.label,
    prompt: options.prompt,
    model: final.model ?? steps.at(-1)?.response.model ?? provider.model,
    provider: provider.provider,
    score: evaluation.passed ? 100 : 0,
    passed: evaluation.passed,
    tokenUsage: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
    latencyMs: ended - started,
    spans: [
      {
        id: rootId, name: 'prompt_lab_trial', type: 'CHAIN', startTime: started, endTime: ended + 1,
        status: evaluation.passed ? 'OK' : 'ERROR',
        inputs: { prompt: options.prompt, initial_state: options.trial.initial },
        outputs: { passed: evaluation.passed, score: evaluation.passed ? 100 : 0, action_sequence: steps.map((step) => step.call.name), final_state: state },
        attributes: { 'workshop.level': options.levelId, 'workshop.trial': options.trial.id, 'workshop.result': evaluation.passed ? 'passed' : 'failed' },
      },
      ...actionSpans,
      {
        id: spanId(), parentId: rootId, name: 'llm.read_tool_result', type: 'LLM', startTime: finalStarted, endTime: ended,
        status: 'OK', inputs: { action_sequence: steps.map((step) => step.call.name), final_state: state }, outputs: { message: assistantMessage },
        attributes: { 'gen_ai.request.model': final.model ?? provider.model, 'gen_ai.usage.input_tokens': final.usage?.input_tokens ?? 0, 'gen_ai.usage.output_tokens': final.usage?.output_tokens ?? 0 },
      },
      {
        id: spanId(), parentId: rootId, name: 'evaluate_expected_state', type: 'EVALUATOR', startTime: ended, endTime: ended + 1,
        status: evaluation.passed ? 'OK' : 'ERROR', inputs: { checkpoint: 'post_action' }, outputs: { passed: evaluation.passed, score: evaluation.passed ? 100 : 0 },
      },
    ],
  };

  return {
    result: {
      trialId: options.trial.id,
      label: options.trial.label,
      prompt: options.prompt,
      status: evaluation.passed ? 'passed' : 'failed',
      toolCall: steps.map((step) => formatCall(step.call.name, step.args)).join(' → '),
      assistantMessage,
      traceId,
      score: trace.score,
      tokens: trace.tokenUsage.total,
      latencyMs: trace.latencyMs,
      exportedToMlflow: false,
    },
    trace,
  };
}

type ResponsePayload = {
  model?: string;
  output?: Array<{ type?: string; name?: string; call_id?: string; arguments?: string; content?: Array<{ type?: string; text?: string }> }>;
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

async function requestResponse(provider: AgentProviderConfig, body: Record<string, unknown>): Promise<ResponsePayload> {
  const response = await fetch(provider.responsesUrl!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json', ...provider.extraHeaders },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${provider.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI'} request failed (${response.status}): ${await safeError(response)}`);
  return response.json() as Promise<ResponsePayload>;
}

async function safeError(response: Response) {
  try {
    const payload = await response.json() as { error?: { message?: string } | string; message?: string };
    return (typeof payload.error === 'string' ? payload.error : payload.error?.message ?? payload.message ?? response.statusText).slice(0, 400);
  } catch {
    return response.statusText || 'Unknown provider error';
  }
}

function outputText(payload: ResponsePayload) {
  if (payload.output_text) return payload.output_text.trim();
  return payload.output?.flatMap((item) => item.content ?? []).find((item) => item.type === 'output_text')?.text?.trim() ?? '';
}

function formatCall(name: string, args: Record<string, unknown>) {
  const values = Object.entries(args).map(([key, value]) => `${key}: ${String(value)}`).join(', ');
  return `${name}(${values})`;
}

function spanId() {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 16);
}
