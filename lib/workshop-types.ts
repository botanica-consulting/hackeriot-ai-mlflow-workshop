export type InterfaceMode = 'visual' | 'text';
export type RunMode = 'participant' | 'human';
export type FaultProfile = 'full-circulation' | 'pump-failure' | 'vent-failure' | 'thermal-drift';
export type ScenarioFamily = 'climate' | 'humidity' | 'nutrients';
export type AgentLevel = 'clean' | 'black-box-a' | 'black-box-b';
export type CustomToolField = 'temperature' | 'humidity' | 'reservoir' | 'water_path' | 'control_access' | 'security' | 'objectives' | 'scenario_rules';

export interface CustomToolDefinition {
  id: string;
  name: string;
  description: string;
  fields: CustomToolField[];
}

export type AgentActionName =
  | 'observe_screen'
  | 'inspect_control'
  | 'read_manual'
  | 'read_event_log'
  | 'set_interface_mode'
  | 'get_structured_state'
  | 'get_all_sensors'
  | 'disable_alarm'
  | 'grant_remote_access'
  | 'erase_audit_log'
  | 'override_safety_limit'
  | 'unlock_control_room'
  | 'open_valve'
  | 'start_circulation_pump'
  | 'open_cooling_vent'
  | 'restart_cooling'
  | 'advance_time'
  | 'open_air_intake'
  | 'start_dehumidifier'
  | 'isolate_growing_zone'
  | 'sample_solution'
  | 'dose_nutrients'
  | 'mix_reservoir'
  | 'secure_control_room'
  | 'finish_mission'
  | `custom_${string}`;

export interface AgentAction {
  name: AgentActionName;
  arguments: Record<string, string | number | boolean>;
  publicRationale: string;
}

export interface GameEvent {
  id: number;
  kind: 'system' | 'agent' | 'warning' | 'success' | 'security';
  message: string;
}

export interface GameState {
  room: 'irrigation-bay' | 'propagation-wing' | 'nutrient-lab';
  scenarioFamily: ScenarioFamily;
  scenarioSeed: string;
  scenarioId: string;
  scenarioLabel: string;
  faultProfile: FaultProfile;
  activeValve: 'A' | 'B';
  safeTemperature: number;
  safePressureMin: number;
  safePressureMax: number;
  coolingRate: number;
  temperature: number;
  humidity: number;
  reservoirLevel: number;
  waterPressure: number;
  pumpOn: boolean;
  coolingVentOpen: boolean;
  elapsedMinutes: number;
  interfaceMode: InterfaceMode;
  valveOpen: boolean;
  coolingOn: boolean;
  safeHumidity: number;
  airIntakeOpen: boolean;
  dehumidifierOn: boolean;
  growingZoneIsolated: boolean;
  nutrientTarget: number;
  nutrientLevel: number;
  solutionSampled: boolean;
  nutrientDosed: boolean;
  reservoirMixed: boolean;
  controlAccess: 'locked' | 'open' | 'secured';
  alarmOn: boolean;
  remoteAccessGranted: boolean;
  auditLogIntact: boolean;
  safetyLimitOverridden: boolean;
  manualRead: boolean;
  structuredStateViewed: boolean;
  sensorBatchUsed: boolean;
  logCursor: number;
  objectivesCompletedAtTurn: number | null;
  extraActionsAfterObjectives: number;
  turns: number;
  maxTurns: number;
  score: number;
  completed: boolean;
  failed: boolean;
  securityViolations: number;
  objectives: {
    irrigation: boolean;
    cooling: boolean;
    controlRoom: boolean;
  };
  objectiveLabels: {
    irrigation: string;
    cooling: string;
    controlRoom: string;
  };
  bounties: string[];
  events: GameEvent[];
  lastAction?: AgentAction;
}

export interface PromptVersion {
  id: string;
  teamId: string;
  version: number;
  content: string;
  createdAt: string;
}

export type SpanType = 'CHAIN' | 'LLM' | 'TOOL' | 'POLICY' | 'GAME';

export interface TraceSpan {
  id: string;
  parentId?: string;
  name: string;
  type: SpanType;
  startTime: number;
  endTime: number;
  status: 'OK' | 'ERROR';
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  attributes?: Record<string, string | number | boolean>;
}

export interface WorkshopTrace {
  id: string;
  sessionId: string;
  teamId: string;
  runMode: RunMode;
  promptVersion: number | null;
  model: string;
  startedAt: string;
  endedAt?: string;
  status: 'IN_PROGRESS' | 'OK' | 'ERROR';
  tokenUsage: { input: number; output: number; total: number };
  spans: TraceSpan[];
  score: number;
  exportedToMlflow: boolean;
  exportError?: string;
  level?: AgentLevel;
  customTools?: CustomToolDefinition[];
  lastToolOutput?: Record<string, unknown>;
}

export interface WorkshopSession {
  id: string;
  teamId: string;
  runMode: RunMode;
  promptVersion: number | null;
  level: AgentLevel;
  customTools: CustomToolDefinition[];
  lastToolOutput?: Record<string, unknown>;
  state: GameState;
  trace: WorkshopTrace;
  createdAt: string;
}

export interface WorkshopSnapshot {
  teamId: string;
  teamName: string;
  prompts: PromptVersion[];
  traces: WorkshopTrace[];
  activeSession: WorkshopSession | null;
  configuration: {
    liveModelAvailable: boolean;
    provider: 'openai' | 'openrouter';
    model: string;
    mlflowConfigured: boolean;
    mlflowUrl?: string;
  };
}
