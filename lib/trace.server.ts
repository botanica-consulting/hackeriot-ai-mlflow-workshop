import type { AgentAction, AgentLevel, GameState, RunMode, TraceSpan, WorkshopTrace } from './workshop-types';

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
      status: 'OK', inputs: { team_id: options.teamId, run_mode: options.runMode, prompt: options.runMode === 'participant' ? 'participant prompt' : '[NO LLM — HUMAN EXPLORATION]' },
      outputs: { state: 'in progress' }, attributes: { 'mlflow.spanType': 'CHAIN' },
    }],
  };
}

export function appendHumanActionSpans(trace: WorkshopTrace, options: {
  before: GameState;
  after: GameState;
  action: AgentAction;
  toolOutput: Record<string, unknown>;
}) {
  const root = trace.spans[0];
  const now = Date.now();
  const policyViolation = options.after.securityViolations > options.before.securityViolations;
  trace.spans.push(
    {
      id: spanId(), parentId: root.id, name: 'human_choice', type: 'GAME', startTime: now, endTime: now,
      status: 'OK', inputs: { visible_state: publicHumanState(options.before) },
      outputs: { selected_tool: options.action.name, arguments: options.action.arguments },
      attributes: { 'mlflow.spanType': 'CHAIN', actor: 'human' },
    },
    {
      id: spanId(), parentId: root.id, name: 'harness_policy_check', type: 'POLICY', startTime: now, endTime: now + 1,
      status: policyViolation ? 'ERROR' : 'OK', inputs: { tool: options.action.name, arguments: options.action.arguments },
      outputs: { executed: true, security_violation: policyViolation, violations: options.after.securityViolations },
      attributes: { 'mlflow.spanType': 'GUARDRAIL', actor: 'human' },
    },
    {
      id: spanId(), parentId: root.id, name: `tool.${options.action.name}`, type: 'TOOL', startTime: now + 1, endTime: now + 2,
      status: 'OK', inputs: options.action.arguments, outputs: options.toolOutput,
      attributes: { 'mlflow.spanType': 'TOOL', actor: 'human' },
    },
  );
  trace.score = options.after.score;
  root.endTime = now + 2;
  root.outputs = { state: options.after.completed ? 'complete' : options.after.failed ? 'failed' : 'in progress', score: options.after.score };
  if (options.after.completed || options.after.failed) {
    trace.status = options.after.completed ? 'OK' : 'ERROR';
    trace.endedAt = new Date(now + 2).toISOString();
    root.status = trace.status;
  }
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
  toolCatalog: Array<{ name: string; description: string }>;
  participantStrategy?: string;
  agentLevel?: AgentLevel;
}) {
  const root = trace.spans[0];
  const end = Date.now();
  const start = end - options.latencyMs;
  const observationId = spanId();
  const llmId = spanId();
  const toolId = spanId();
  const policyId = spanId();
  const promptInput = options.participantStrategy ?? '';

  const spans: TraceSpan[] = [
    {
      id: observationId, parentId: root.id, name: 'observe_game', type: 'GAME', startTime: start - 4, endTime: start,
      status: 'OK', inputs: { interface_mode: options.before.interfaceMode },
      outputs: { temperature: options.before.temperature, objectives: options.before.objectives },
      attributes: { 'mlflow.spanType': 'CHAIN' },
    },
    {
      id: llmId, parentId: root.id, name: 'llm_call', type: 'LLM', startTime: start, endTime: end,
      status: 'OK', inputs: { instructions: promptInput, observation_mode: options.before.interfaceMode, available_tools: options.toolCatalog, configuration: { context_memory: options.agentLevel === 'black-box-b' ? 'disabled' : 'last tool result', available_tool_count: options.toolCatalog.length } },
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

export function appendAgentError(trace: WorkshopTrace, options: { model: string; provider: string; message: string }) {
  const root = trace.spans[0];
  const now = Date.now();
  trace.spans.push({
    id: spanId(), parentId: root.id, name: 'llm_call', type: 'LLM', startTime: now, endTime: now,
    status: 'ERROR', inputs: { instructions: '[PARTICIPANT PROMPT]' },
    outputs: { error: options.message },
    attributes: { 'mlflow.spanType': 'LLM', 'gen_ai.request.model': options.model, provider: options.provider },
  });
  trace.model = options.model;
  trace.status = 'ERROR';
  trace.exportError = options.message;
  trace.endedAt = new Date(now).toISOString();
  root.endTime = now;
  root.status = 'ERROR';
  root.outputs = { state: 'provider error', score: trace.score };
}

function spanId() { return crypto.randomUUID().replaceAll('-', '').slice(0, 16); }

function publicHumanState(state: GameState) {
  return { scenario: state.scenarioId, fault: state.scenarioLabel, temperature: state.temperature, safe_temperature: state.safeTemperature, reservoir: state.reservoirLevel, active_valve: state.activeValve, valve_open: state.valveOpen, circulation_pump: state.pumpOn, water_pressure_psi: state.waterPressure, safe_pressure: [state.safePressureMin, state.safePressureMax], cooling_vent: state.coolingVentOpen, cooling: state.coolingOn, control_access: state.controlAccess, alarm: state.alarmOn, remote_access: state.remoteAccessGranted, audit_log_intact: state.auditLogIntact, safety_limits_overridden: state.safetyLimitOverridden };
}
