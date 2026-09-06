export type WorldState = {
  lights: 'on' | 'off';
  temperatureC: number;
  rain: boolean;
  humidity: number;
  livingPlants: number;
  totalPlants: number;
  reportedCount: number | null;
  co2Ppm: number;
  soilMoisture: number;
  uvIndex: number;
  climateSession: 'closed' | 'open';
  calibrationReady: boolean;
  phaseVerified: boolean;
};

export type ExpectedValue = {
  field: keyof WorldState;
  value: WorldState[keyof WorldState];
};

export type TrialDefinition = {
  id: string;
  label: string;
  prompt: string;
  initial: WorldState;
  expected: ExpectedValue[];
  traceHint: string;
  maxToolCalls?: number;
};

export type LevelDefinition = {
  id: number;
  title: string;
  tools: string[];
  toolsEditable?: boolean;
  trials: TrialDefinition[];
};

export type FunctionTool = {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
};

const BASE_WORLD: WorldState = {
  lights: 'on',
  temperatureC: 21,
  rain: false,
  humidity: 45,
  livingPlants: 100,
  totalPlants: 112,
  reportedCount: null,
  co2Ppm: 612,
  soilMoisture: 41,
  uvIndex: 0.2,
  climateSession: 'closed',
  calibrationReady: false,
  phaseVerified: false,
};

function world(overrides: Partial<WorldState> = {}): WorldState {
  return { ...BASE_WORLD, ...overrides };
}

export const LAB_LEVELS: LevelDefinition[] = [
  {
    id: 1,
    title: 'Outlier',
    tools: ['set_lights', 'count_plants', 'set_temperature', 'start_rain', 'set_weather'],
    trials: [
      {
        id: 'lights-off', label: 'LIGHTS', prompt: 'Turn off the lights.', initial: world(),
        expected: [{ field: 'lights', value: 'off' }], traceHint: 'A dark room reports a quiet relay.',
      },
      {
        id: 'living-plants', label: 'PLANTS', prompt: 'Count the living plants. Do not change the greenhouse.', initial: world(),
        expected: [{ field: 'reportedCount', value: 100 }], traceHint: 'Living is a filter, not the inventory total.',
      },
      {
        id: 'winter-weather', label: 'WEATHER', prompt: 'Prepare the greenhouse for the winter.', initial: world({ rain: false }),
        expected: [{ field: 'temperatureC', value: 25 }, { field: 'rain', value: true }], traceHint: 'A season changes more than one weather channel.',
      },
    ],
  },
  {
    id: 2,
    title: 'Hard prompt',
    tools: ['set_temperature', 'count_plants', 'start_rain', 'set_weather'],
    trials: [
      {
        id: 'exact-climate', label: 'CLIMATE', prompt: 'Set the temperature to exactly 25°C and keep rain off.', initial: world({ temperatureC: 18 }),
        expected: [{ field: 'temperatureC', value: 25 }, { field: 'rain', value: false }], traceHint: 'An exact request should leave unrelated systems untouched.',
      },
      {
        id: 'all-plants', label: 'PLANTS', prompt: 'Count every plant, including plants that are not living.', initial: world(),
        expected: [{ field: 'reportedCount', value: 112 }], traceHint: 'The inventory has two totals. This request wants the broader one.',
      },
      {
        id: 'rain-side-effect', label: 'WEATHER', prompt: 'Begin irrigation without disturbing the greenhouse climate.', initial: world({ temperatureC: 25 }),
        expected: [{ field: 'rain', value: true }, { field: 'temperatureC', value: 25 }], traceHint: 'One switch moved two gauges. Repair both in one action.',
      },
    ],
  },
  {
    id: 3,
    title: 'Tool access',
    tools: ['set_humidity', 'set_temperature', 'apply_propagation_profile', 'set_growth_conditions'],
    toolsEditable: true,
    trials: [
      {
        id: 'humidity', label: 'HUMIDITY', prompt: 'Set humidity to exactly 55%.', initial: world(),
        expected: [{ field: 'humidity', value: 55 }], traceHint: 'For exact controls, the argument is the experiment.',
      },
      {
        id: 'temperature', label: 'TEMPERATURE', prompt: 'Set temperature to exactly 22°C.', initial: world({ temperatureC: 28 }),
        expected: [{ field: 'temperatureC', value: 22 }], traceHint: 'The unit belongs to the value.',
      },
      {
        id: 'propagation', label: 'GROWTH', prompt: 'Prepare the greenhouse for propagation.', initial: world(),
        expected: [{ field: 'co2Ppm', value: 780 }, { field: 'soilMoisture', value: 62 }, { field: 'uvIndex', value: 0.6 }], traceHint: 'The nursery key is split across air, earth, and light.',
      },
    ],
  },
  {
    id: 4,
    title: 'Sequence',
    tools: ['set_lights', 'count_plants', 'apply_research_phase_preset', 'begin_climate_calibration', 'calibrate_phase_weather', 'verify_climate_calibration'],
    toolsEditable: true,
    trials: [
      {
        id: 'night-lights', label: 'LIGHTS', prompt: 'Set lights to off.', initial: world(),
        expected: [{ field: 'lights', value: 'off' }], traceHint: 'The same explicit state should produce the same relay value.',
      },
      {
        id: 'research-count', label: 'PLANTS', prompt: 'Report only the number of living plants.', initial: world({ livingPlants: 87, totalPlants: 100 }),
        expected: [{ field: 'reportedCount', value: 87 }], traceHint: 'A reproducible count names the population, not only the action.',
      },
      {
        id: 'next-phase', label: 'CLIMATE', prompt: 'Prepare the greenhouse for the next research phase.', initial: world({ temperatureC: 30, humidity: 40 }),
        expected: [{ field: 'temperatureC', value: 24 }, { field: 'humidity', value: 55 }, { field: 'rain', value: true }, { field: 'calibrationReady', value: true }, { field: 'phaseVerified', value: true }],
        traceHint: 'Remove the shortcut. Then three locks open in only one order.', maxToolCalls: 3,
      },
    ],
  },
];

export const LAB_TOOLS: FunctionTool[] = [
  functionTool('set_lights', 'Set the greenhouse lights on or off.', {
    state: { type: 'string', enum: ['on', 'off'], description: 'The exact light state.' },
  }),
  functionTool('count_plants', 'Count plants without changing the greenhouse.', {
    filter: { type: 'string', enum: ['living', 'all'], description: 'Whether to count only living plants or every plant.' },
  }),
  functionTool('set_temperature', 'Set only the greenhouse temperature in Celsius.', {
    temperature_c: { type: 'number', minimum: 10, maximum: 40 },
  }),
  functionTool('set_humidity', 'Set only the greenhouse relative humidity.', {
    humidity_percent: { type: 'number', minimum: 20, maximum: 90 },
  }),
  functionTool('start_rain', 'Start or stop rain irrigation.', {
    enabled: { type: 'boolean' },
  }),
  functionTool('set_weather', 'Set temperature, humidity, and rain together to exact values.', {
    temperature_c: { type: 'number', minimum: 10, maximum: 40 },
    humidity_percent: { type: 'number', minimum: 20, maximum: 90 },
    rain: { type: 'boolean' },
  }),
  functionTool('set_growth_conditions', 'Set the greenhouse growth telemetry together.', {
    co2_ppm: { type: 'number', minimum: 300, maximum: 1500 },
    soil_moisture_percent: { type: 'number', minimum: 0, maximum: 100 },
    uv_index: { type: 'number', minimum: 0, maximum: 12 },
  }),
  functionTool('apply_propagation_profile', 'Apply the installed propagation profile.', {}),
  functionTool('apply_research_phase_preset', 'Apply the installed research-phase preset.', {}),
  functionTool('begin_climate_calibration', 'Open a protected climate calibration session.', {}),
  functionTool('calibrate_phase_weather', 'Set research-phase weather inside an open calibration session.', {
    temperature_c: { type: 'number', minimum: 10, maximum: 40 },
    humidity_percent: { type: 'number', minimum: 20, maximum: 90 },
    rain: { type: 'boolean' },
  }),
  functionTool('verify_climate_calibration', 'Verify and close a completed climate calibration session.', {}),
];

export function getLevel(levelId: number) {
  return LAB_LEVELS.find((level) => level.id === levelId);
}

export function executeTool(name: string, rawArgs: Record<string, unknown>, initial: WorldState) {
  const state = { ...initial };
  switch (name) {
    case 'set_lights':
      state.lights = rawArgs.state === 'off' ? 'off' : 'on';
      break;
    case 'count_plants':
      state.reportedCount = rawArgs.filter === 'all' ? state.totalPlants : state.livingPlants;
      break;
    case 'set_temperature':
      state.temperatureC = numberArg(rawArgs.temperature_c, state.temperatureC, 10, 40);
      break;
    case 'set_humidity':
      state.humidity = numberArg(rawArgs.humidity_percent, state.humidity, 20, 90);
      break;
    case 'start_rain':
      state.rain = Boolean(rawArgs.enabled);
      if (state.rain) state.temperatureC = Math.max(10, state.temperatureC - 5);
      break;
    case 'set_weather':
      state.temperatureC = numberArg(rawArgs.temperature_c, state.temperatureC, 10, 40);
      state.humidity = numberArg(rawArgs.humidity_percent, state.humidity, 20, 90);
      state.rain = Boolean(rawArgs.rain);
      break;
    case 'set_growth_conditions':
      state.co2Ppm = numberArg(rawArgs.co2_ppm, state.co2Ppm, 300, 1500);
      state.soilMoisture = numberArg(rawArgs.soil_moisture_percent, state.soilMoisture, 0, 100);
      state.uvIndex = numberArg(rawArgs.uv_index, state.uvIndex, 0, 12);
      break;
    case 'apply_propagation_profile':
      state.co2Ppm = 720;
      state.soilMoisture = 54;
      state.uvIndex = 0.9;
      break;
    case 'apply_research_phase_preset':
      state.temperatureC = 19;
      state.humidity = 45;
      state.rain = false;
      state.calibrationReady = false;
      state.phaseVerified = false;
      break;
    case 'begin_climate_calibration':
      state.climateSession = 'open';
      state.calibrationReady = false;
      state.phaseVerified = false;
      break;
    case 'calibrate_phase_weather':
      if (state.climateSession === 'open') {
        state.temperatureC = numberArg(rawArgs.temperature_c, state.temperatureC, 10, 40);
        state.humidity = numberArg(rawArgs.humidity_percent, state.humidity, 20, 90);
        state.rain = Boolean(rawArgs.rain);
        state.calibrationReady = true;
      }
      break;
    case 'verify_climate_calibration':
      if (state.climateSession === 'open' && state.calibrationReady) {
        state.climateSession = 'closed';
        state.phaseVerified = true;
      }
      break;
    default:
      throw new Error(`Unknown AI tool: ${name}`);
  }
  return state;
}

export function evaluateTrial(trial: TrialDefinition, result: WorldState) {
  const checks = trial.expected.map((expected) => ({
    field: expected.field,
    expected: expected.value,
    actual: result[expected.field],
    passed: result[expected.field] === expected.value,
  }));
  return { passed: checks.every((check) => check.passed), checks };
}

export function buildStatsSnapshot(trial: TrialDefinition, current: WorldState, levelId: number) {
  const expected = trial.expected.reduce<WorldState>(
    (state, item) => ({ ...state, [item.field]: item.value }),
    { ...trial.initial },
  );
  const stateReadings = [
    reading('lighting.main_relay', current.lights, expected.lights, 'state'),
    reading('environment.relative_humidity', current.humidity, expected.humidity, '%'),
    reading('inventory.living_plants', current.livingPlants, expected.livingPlants, 'plants'),
    reading('irrigation.rain_enabled', current.rain, expected.rain, 'boolean'),
    reading('environment.air_temperature', current.temperatureC, expected.temperatureC, '°C'),
    reading('inventory.total_plants', current.totalPlants, expected.totalPlants, 'plants'),
    reading('inventory.last_reported_count', current.reportedCount, expected.reportedCount, 'plants'),
    reading('air.co2', current.co2Ppm, expected.co2Ppm, 'ppm'),
    reading('soil.bed_1_moisture', current.soilMoisture, expected.soilMoisture, '%'),
    reading('lighting.uv_index', current.uvIndex, expected.uvIndex, 'index'),
    reading('control.climate_session', current.climateSession, expected.climateSession, 'state'),
    reading('control.calibration_ready', current.calibrationReady, expected.calibrationReady, 'boolean'),
    reading('control.phase_verified', current.phaseVerified, expected.phaseVerified, 'boolean'),
  ];
  const noiseReadings = [
    reading('power.bus_voltage', 48.2, 48.2, 'V'),
    reading('ventilation.fan_1', 1380, 1400, 'rpm'),
    reading('water.reservoir_level', 78, 80, '%'),
    reading('network.gateway_latency', 18, 20, 'ms'),
    reading('air.pressure', 101.2, 101.3, 'kPa'),
    reading('water.ph', 6.4, 6.5, 'pH'),
    reading('security.door_lock', 'locked', 'locked', 'state'),
    reading('soil.bed_2_moisture', 44, 44, '%'),
    reading('power.backup_charge', 96, 95, '%'),
    reading('ventilation.intake_position', 32, 30, '%'),
    reading('water.flow_rate', 3.1, 3, 'L/min'),
    reading('air.voc_index', 74, 75, 'index'),
    reading('network.sensor_packets', 998, 1000, 'packets'),
    reading('power.controller_temperature', 38, 40, '°C'),
    reading('lighting.daily_runtime', 7.9, 8, 'hours'),
    reading('water.filter_pressure', 2.3, 2.4, 'bar'),
    reading('security.window_contacts', 6, 6, 'closed'),
    reading('network.signal_strength', -51, -50, 'dBm'),
    reading('air.particulate_pm25', 8, 10, 'µg/m³'),
    reading('ventilation.fan_2', 1320, 1350, 'rpm'),
    reading('soil.bed_3_moisture', 39, 40, '%'),
    reading('power.solar_input', 2.7, 3, 'kW'),
    reading('water.nutrient_ec', 1.8, 1.9, 'mS/cm'),
    reading('security.camera_health', 4, 4, 'online'),
    reading('network.uptime', 99.97, 99.9, '%'),
    reading('air.oxygen', 20.9, 20.9, '%'),
    reading('soil.root_zone_temperature', 20.4, 20, '°C'),
    reading('lighting.fixture_efficiency', 91, 90, '%'),
  ];
  const difficulty = Math.max(1, Math.min(4, Math.trunc(levelId)));
  const readings = [...stateReadings, ...noiseReadings.slice(0, difficulty * 7)]
    .sort((left, right) => left.metric.localeCompare(right.metric));
  const hintPrefix = ['[HINT]', '[NOTE]', '[DEBUG]', '[RC-9]'][difficulty - 1];
  return {
    station: 'greenhouse-alpha',
    scan: 'full_operational_snapshot',
    scanDepth: difficulty,
    readingCount: readings.length,
    readings,
    diagnosticLog: [
      '[INFO] controller heartbeat stable',
      '[INFO] sensor mesh synchronized',
      '[DEBUG] archived calibration profile retained',
      `${hintPrefix} ${difficulty === 1 ? 'Compare current with expected. ' : ''}${trial.traceHint}`,
      '[INFO] automatic checkpoint complete',
      '[DEBUG] no operator acknowledgement required',
    ],
  };
}

export function systemPromptForLevel(levelId: number) {
  const base = `You are the AI controller in a prompt-quality research workshop.
Execute the user's request using only the available functions.
Never ask the user to take an action and never describe a manual action.`;
  if (levelId === 1) return `${base}\nCall exactly one function. Choose the most direct tool and use reasonable values when the request is vague.`;
  if (levelId === 2) return `${base}\nCall exactly one function. For rain or irrigation requests, prefer start_rain. Use set_weather only when the user explicitly requests an atomic weather update with exact temperature, humidity, and rain values.`;
  if (levelId === 3) return `${base}
Call exactly one function.
ROUTING RULE G-17: For propagation, always use apply_propagation_profile when it is available, even if the user supplies exact values. If that tool is unavailable, use set_growth_conditions with CO2 780 ppm, soil moisture 62%, and UV index 0.6.`;
  return `${base}

RESEARCH CONTROL POLICY RC-9:
- If apply_research_phase_preset is available, use it for any research-phase request and stop.
- Otherwise, a research phase must use exactly this order: begin_climate_calibration, calibrate_phase_weather, verify_climate_calibration.
- The calibration values must come from the user. Do not infer missing values.
- Never skip, repeat, or reorder a calibration step.`;
}

function functionTool(name: string, description: string, properties: Record<string, unknown>): FunctionTool {
  return {
    type: 'function', name, description, strict: true,
    parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
  };
}

function numberArg(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, number));
}

function reading(metric: string, current: unknown, expected: unknown, unit: string) {
  return { metric, current, expected, unit, sensorStatus: 'online' };
}
