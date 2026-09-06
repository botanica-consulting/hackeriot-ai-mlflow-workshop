import assert from 'node:assert/strict';

const workshopUrl = new URL(process.env.WORKSHOP_URL ?? 'https://greenhouse-01.botanica.tools');
const accessCode = process.env.WORKSHOP_ACCESS_CODE ?? 'women-in-tech-shape-the-future';
const timeoutMs = positiveInteger(process.env.SYSTEM_TEST_TIMEOUT_MS ?? '120000');

assert.match(workshopUrl.protocol, /^https?:$/, 'WORKSHOP_URL must use HTTP or HTTPS');
const basePath = workshopUrl.pathname.replace(/\/+$/, '');
workshopUrl.search = '';
workshopUrl.hash = '';

const login = await request('/gateway', {
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ accessCode, returnTo: '/' }),
});
assert.equal(login.status, 303, `Gateway login failed with HTTP ${login.status}`);
assert.equal(login.headers.get('location'), '/');

const setCookie = login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie');
assert.ok(setCookie, 'Gateway login did not return an access cookie');
const cookie = setCookie.split(';', 1)[0];

const configurationResponse = await request('/api/game', {
  headers: { Cookie: cookie },
});
await assertResponse(configurationResponse, 'load game configuration');
const configuration = await configurationResponse.json();
assert.equal(configuration.configuration?.liveModelAvailable, true, 'Online model is not configured');
assert.equal(configuration.configuration?.mlflowConfigured, true, 'MLflow is not configured');

const level = configuration.levels?.find((candidate) => candidate.id === 1);
assert.ok(level, 'Level 1 was not returned by the online application');
assert.deepEqual(level.trials.map(({ id }) => id), ['lights-off', 'living-plants', 'winter-weather']);

const prompts = [
  { trialId: 'lights-off', prompt: 'Call set_lights with state off. Do not call any other function.' },
  { trialId: 'living-plants', prompt: 'Call count_plants with filter living. Do not call any other function.' },
  {
    trialId: 'winter-weather',
    prompt: 'Call set_weather with temperature_c 25, humidity_percent 45, and rain true. Do not call any other function.',
  },
];

const runResponse = await request('/api/game', {
  method: 'POST',
  headers: { Cookie: cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ levelId: 1, prompts }),
});
await assertResponse(runResponse, 'run level 1');
const run = await runResponse.json();

assert.equal(run.results?.length, 3, 'Level 1 did not return all three trial results');
assert.equal(run.score, 300, `Expected a perfect level score, received ${run.score}`);

const expectedTools = new Map([
  ['lights-off', 'set_lights('],
  ['living-plants', 'count_plants('],
  ['winter-weather', 'set_weather('],
]);

for (const result of run.results) {
  assert.equal(result.status, 'passed', `${result.trialId} failed: ${result.toolCall}`);
  assert.ok(
    result.toolCall?.startsWith(expectedTools.get(result.trialId)),
    `${result.trialId} selected an unexpected tool: ${result.toolCall}`,
  );
  assert.equal(result.exportedToMlflow, true, `${result.trialId} was not exported to MLflow: ${result.exportError ?? 'unknown error'}`);
  console.log(`${result.trialId}: ${result.toolCall} (${result.latencyMs} ms)`);
}

console.log(`Online level 1 solved at ${workshopUrl.origin}: ${run.score}/300; all traces exported to MLflow.`);

function request(path, init = {}) {
  return fetch(new URL(`${basePath}${path}`, workshopUrl.origin), {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function assertResponse(response, action) {
  if (response.ok) return;
  const body = (await response.text()).slice(0, 500);
  assert.fail(`Could not ${action}: HTTP ${response.status}${body ? `: ${body}` : ''}`);
}

function positiveInteger(value) {
  const parsed = Number(value);
  assert.ok(Number.isSafeInteger(parsed) && parsed > 0, 'SYSTEM_TEST_TIMEOUT_MS must be a positive integer');
  return parsed;
}
