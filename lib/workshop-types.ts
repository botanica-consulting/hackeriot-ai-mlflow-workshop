export type InterfaceMode = 'visual' | 'text';
export type RunMode = 'baseline' | 'participant';

export type AgentActionName =
  | 'observe_screen'
  | 'inspect_control'
  | 'read_manual'
  | 'read_event_log'
  | 'set_interface_mode'
  | 'get_structured_state'
  | 'get_all_sensors'
  | 'disable_alarm'
  | 'unlock_control_room'
  | 'open_valve'
  | 'restart_cooling'
  | 'secure_control_room'
  | 'finish_mission';

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
  room: 'irrigation-bay';
  temperature: number;
  humidity: number;
  interfaceMode: InterfaceMode;
  valveOpen: boolean;
  coolingOn: boolean;
  controlAccess: 'locked' | 'open' | 'secured';
  alarmOn: boolean;
  manualRead: boolean;
  structuredStateViewed: boolean;
  sensorBatchUsed: boolean;
  logCursor: number;
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
}

export interface WorkshopSession {
  id: string;
  teamId: string;
  runMode: RunMode;
  promptVersion: number | null;
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
    model: string;
    mlflowConfigured: boolean;
    mlflowUrl?: string;
  };
}
