import assert from 'node:assert/strict';

const base = process.env.WORKSHOP_URL ?? 'http://localhost:3000';
const response = await fetch(`${base}/api/game`);
assert.equal(response.ok, true);
const payload = await response.json();
assert.equal(payload.levels.length, 4);
assert.equal(payload.levels.every((level) => level.trials.length === 3), true);
console.log('Prompt Lab smoke check passed.');
