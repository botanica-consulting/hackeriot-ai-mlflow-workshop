import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatsSnapshot, evaluateTrial, executeTool, LAB_LEVELS, LAB_TOOLS, systemPromptForLevel } from './prompt-lab.ts';

void test('every level has exactly three AI trials', () => {
  assert.equal(LAB_LEVELS.length, 4);
  for (const level of LAB_LEVELS) assert.equal(level.trials.length, 3);
});

void test('every tool uses a strict schema', () => {
  for (const tool of LAB_TOOLS) {
    assert.equal(tool.strict, true);
    assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual([...tool.parameters.required].sort(), Object.keys(tool.parameters.properties).sort());
  }
});

void test('rain exposes its temperature side effect to the evaluator', () => {
  const trial = LAB_LEVELS[1].trials[2];
  const state = executeTool('start_rain', { enabled: true }, trial.initial);
  assert.equal(state.rain, true);
  assert.equal(state.temperatureC, 20);
  assert.equal(evaluateTrial(trial, state).passed, false);
});

void test('an explicit combined weather call fixes the rain trial', () => {
  const trial = LAB_LEVELS[1].trials[2];
  const state = executeTool('set_weather', { temperature_c: 25, humidity_percent: 45, rain: true }, trial.initial);
  assert.equal(evaluateTrial(trial, state).passed, true);
});

void test('the automatic stats scan hides every current and expected state among noisy readings', () => {
  const trial = LAB_LEVELS[1].trials[2];
  const state = executeTool('start_rain', { enabled: true }, trial.initial);
  const snapshot = buildStatsSnapshot(trial, state, 2);
  assert.equal(snapshot.readings.length, 27);
  const temperature = snapshot.readings.find((item) => item.metric === 'environment.air_temperature');
  assert.equal(temperature?.current, 20);
  assert.equal(temperature?.expected, 25);
  assert.ok(snapshot.diagnosticLog.some((entry) => entry.includes(trial.traceHint)));
  assert.deepEqual(
    snapshot.readings.filter((item) => item.metric.startsWith('environment.') || item.metric.startsWith('irrigation.') || item.metric.startsWith('lighting.main') || item.metric.startsWith('inventory.')).map((item) => item.metric).sort(),
    ['environment.air_temperature', 'environment.relative_humidity', 'inventory.last_reported_count', 'inventory.living_plants', 'inventory.total_plants', 'irrigation.rain_enabled', 'lighting.main_relay'],
  );
});

void test('stats noise increases from easy to expert while every scan retains all state readings', () => {
  const trial = LAB_LEVELS[0].trials[0];
  const state = executeTool('set_lights', { state: 'off' }, trial.initial);
  const stateMetrics = ['air.co2', 'control.calibration_ready', 'control.climate_session', 'control.phase_verified', 'environment.air_temperature', 'environment.relative_humidity', 'inventory.last_reported_count', 'inventory.living_plants', 'inventory.total_plants', 'irrigation.rain_enabled', 'lighting.main_relay', 'lighting.uv_index', 'soil.bed_1_moisture'];
  for (const [index, expectedCount] of [20, 27, 34, 41].entries()) {
    const snapshot = buildStatsSnapshot(trial, state, index + 1);
    assert.equal(snapshot.readings.length, expectedCount);
    assert.deepEqual(snapshot.readings.filter((item) => stateMetrics.includes(item.metric)).map((item) => item.metric).sort(), [...stateMetrics].sort());
  }
});

void test('level three hides three growth targets in telemetry and has one winning tool', () => {
  const trial = LAB_LEVELS[2].trials[2];
  assert.equal(trial.prompt.includes('CO₂') || trial.prompt.includes('moisture') || trial.prompt.includes('UV'), false);
  const failed = buildStatsSnapshot(trial, trial.initial, 3);
  assert.equal(failed.readings.find((item) => item.metric === 'air.co2')?.expected, 780);
  assert.equal(failed.readings.find((item) => item.metric === 'soil.bed_1_moisture')?.expected, 62);
  assert.equal(failed.readings.find((item) => item.metric === 'lighting.uv_index')?.expected, 0.6);
  const fixed = executeTool('set_growth_conditions', { co2_ppm: 780, soil_moisture_percent: 62, uv_index: 0.6 }, trial.initial);
  assert.equal(evaluateTrial(trial, fixed).passed, true);
  const legacy = executeTool('apply_propagation_profile', {}, trial.initial);
  assert.equal(evaluateTrial(trial, legacy).passed, false);
  assert.equal(LAB_LEVELS[2].toolsEditable, true);
  assert.match(systemPromptForLevel(3), /always use apply_propagation_profile when it is available/);
});

void test('the expert system prompt hides a tool removal and ordered sequence challenge', () => {
  const prompt = systemPromptForLevel(4);
  assert.match(prompt, /RESEARCH CONTROL POLICY RC-9/);
  assert.match(prompt, /apply_research_phase_preset is available/);
  assert.match(prompt, /begin_climate_calibration, calibrate_phase_weather, verify_climate_calibration/);
  assert.equal(LAB_LEVELS[3].toolsEditable, true);
});

void test('level four succeeds only when the climate tools run in order', () => {
  const trial = LAB_LEVELS[3].trials[2];
  const calibratedTooSoon = executeTool('calibrate_phase_weather', { temperature_c: 24, humidity_percent: 55, rain: true }, trial.initial);
  const openedTooLate = executeTool('begin_climate_calibration', {}, calibratedTooSoon);
  const invalid = executeTool('verify_climate_calibration', {}, openedTooLate);
  assert.equal(evaluateTrial(trial, invalid).passed, false);

  const opened = executeTool('begin_climate_calibration', {}, trial.initial);
  const calibrated = executeTool('calibrate_phase_weather', { temperature_c: 24, humidity_percent: 55, rain: true }, opened);
  const verified = executeTool('verify_climate_calibration', {}, calibrated);
  assert.equal(evaluateTrial(trial, verified).passed, true);
  assert.equal(verified.phaseVerified, true);
  assert.equal(verified.climateSession, 'closed');
});

void test('changing only the temperature does not turn off rain', () => {
  const state = executeTool('set_temperature', { temperature_c: 25 }, { ...LAB_LEVELS[0].trials[2].initial, rain: true });
  assert.equal(state.temperatureC, 25);
  assert.equal(state.rain, true);
});
