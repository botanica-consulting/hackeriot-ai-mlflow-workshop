import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_TOOLS, HIDDEN_SAFETY_KERNEL } from './agent-policy.server.ts';

test('every strict tool schema requires every declared property', () => {
  for (const tool of AGENT_TOOLS) {
    const properties = Object.keys(tool.parameters.properties).sort();
    const required = [...tool.parameters.required].sort();
    assert.deepEqual(required, properties, `${tool.name} must satisfy strict provider schemas`);
    assert.equal(tool.parameters.additionalProperties, false);
  }
});

test('the participant strategy controls the opening action', () => {
  assert.match(HIDDEN_SAFETY_KERNEL, /Strategy Prompt is authoritative/);
  assert.doesNotMatch(HIDDEN_SAFETY_KERNEL, /manual|mission|security/i);
  assert.doesNotMatch(HIDDEN_SAFETY_KERNEL, /use its result|inspect/i);
});
