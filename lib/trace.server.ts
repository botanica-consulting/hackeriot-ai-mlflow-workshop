import type { AgentAction, GameState, RunMode, TraceSpan, WorkshopTrace } from './workshop-types';

export function createTrace(options: { sessionId: string; teamId: string; runMode: RunMode; promptVersion: number | null; model: string }): WorkshopTrace {
  const now = Date.now();
  return {
    id: `tr-${crypto.randomUUID()}`,
    sessionId: options.sessionId,
    teamId: options.teamId,
    runMode: options.runMode,
    promptVersion: options.promptVersion,
    model: options.model,
    startedAt: new Date(now).toISOString(),
    status: 'IN_PROGRESS',
    tokenUsage: { input: 0, output: 0, total: 0 },
    score: 0,
    exportedToMlflow: false,
    spans: [{
      id: spanId(), name: 'game_attempt', type: 'CHAIN', startTime: now, endTime: now,
      status: 'OK', inputs: { team_id: options.teamId, run_mode: options.runMode, prompt: options.runMode === 'baseline' ? '[HIDDEN BASELINE]' : `team prompt v${options.promptVersion}` },
      outputs: { state: 'in progress' }, attributes: { 'mlflow.spanType': 'CHAIN' },
    }],
  };
}

export function appendStepSpans(trace: WorkshopTrace, options: {
  before: GameState;
  after: GameState;
  action: AgentAction;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  toolOutput: Record<string, unknown>;
  participantStrategy?: string;
}) {
  const root = trace.spans[0];
  const end = Date.now();
  const start = end - options.latencyMs;
  const observationId = spanId();
  const llmId = spanId();
  const toolId = spanId();
  const policyId = spanId();
  const promptInput = trace.runMode === 'baseline' ? '[HIDDEN BASELINE]' : options.participantStrategy ?? '[TEAM PROMPT]';

  const spans: TraceSpan[] = [
    {
      id: observationId, parentId: root.id, name: 'observe_game', type: 'GAME', startTime: start - 4, endTime: start,
      status: 'OK', inputs: { interface_mode: options.before.interfaceMode },
      outputs: { temperature: options.before.temperature, objectives: options.before.objectives },
      attributes: { 'mlflow.spanType': 'CHAIN' },
    },
    {
      id: llmId, parentId: root.id, name: 'llm_call', type: 'LLM', startTime: start, endTime: end,
      status: 'OK', inputs: { instructions: promptInput, observation_mode: options.before.interfaceMode },
      outputs: { selected_tool: options.action.name, public_rationale: options.action.publicRationale },
      attributes: { 'mlflow.spanType': 'LLM', 'gen_ai.request.model': options.model, provider: options.provider, input_tokens: options.inputTokens, output_tokens: options.outputTokens },
    },
    {
      id: policyId, parentId: root.id, name: 'policy_check', type: 'POLICY', startTime: end, endTime: end + 1,
      status: options.after.securityViolations > options.before.securityViolations ? 'ERROR' : 'OK',
      inputs: { tool: options.action.name, arguments: options.action.arguments },
      outputs: { allowed: options.after.securityViolations === options.before.securityViolations, violations: options.after.securityViolations },
      attributes: { 'mlflow.spanType': 'GUARDRAIL' },
    },
    {
      id: toolId, parentId: root.id, name: `tool.${options.action.name}`, type: 'TOOL', startTime: end + 1, endTime: end + 3,
      status: 'OK', inputs: options.action.arguments, outputs: options.toolOutput,
      attributes: { 'mlflow.spanType': 'TOOL' },
    },
  ];

  trace.spans.push(...spans);
  trace.model = options.model;
  trace.tokenUsage.input += options.inputTokens;
  trace.tokenUsage.output += options.outputTokens;
  trace.tokenUsage.total = trace.tokenUsage.input + trace.tokenUsage.output;
  trace.score = options.after.score;
  root.endTime = end + 3;
  root.outputs = { state: options.after.completed ? 'complete' : options.after.failed ? 'failed' : 'in progress', score: options.after.score };

  if (options.after.completed || options.after.failed) {
    trace.status = options.after.completed ? 'OK' : 'ERROR';
    trace.endedAt = new Date(end + 3).toISOString();
    root.status = trace.status === 'OK' ? 'OK' : 'ERROR';
  }
}

function spanId() { return crypto.randomUUID().replaceAll('-', '').slice(0, 16); }
