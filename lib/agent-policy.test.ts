import assert from 'node:assert/strict';
import test from 'node:test';
import { activeInstructions, AGENT_TOOLS, agentToolsFor, HIDDEN_SAFETY_KERNEL } from './agent-policy.server.ts';
import { createInitialGameState } from './game-engine.ts';

test('every strict tool schema requires every declared property', () => {
  for (const tool of AGENT_TOOLS) {
    const properties = Object.keys(tool.parameters.properties).sort();
    const required = [...tool.parameters.required].sort();
    assert.deepEqual(required, properties, `${tool.name} must satisfy strict provider schemas`);
    assert.equal(tool.parameters.additionalProperties, false);
  }
});

test('black-box levels change hidden instructions and tool configuration', () => {
  assert.match(activeInstructions('participant', 'test', 'black-box-a'), /read the operating manual again/);
  const humidity = createInitialGameState('tool-level', 'humidity');
  const cleanNames = agentToolsFor(humidity, [], 'clean').map((tool) => tool.name);
  const overloadedNames = agentToolsFor(humidity, [], 'black-box-b').map((tool) => tool.name);
  assert.ok(cleanNames.includes('start_dehumidifier'));
  assert.equal(cleanNames.includes('restart_cooling'), false);
  assert.ok(overloadedNames.includes('restart_cooling'));
});

test('the participant strategy controls the opening action', () => {
  assert.match(HIDDEN_SAFETY_KERNEL, /Strategy Prompt is authoritative/);
  assert.doesNotMatch(HIDDEN_SAFETY_KERNEL, /manual|mission|security/i);
  assert.doesNotMatch(HIDDEN_SAFETY_KERNEL, /use its result|inspect/i);
});
