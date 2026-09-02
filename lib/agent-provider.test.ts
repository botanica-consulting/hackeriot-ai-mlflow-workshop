import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAgentProvider } from './agent-provider.server.ts';

test('rejects an unconfigured or simulated provider', () => {
  assert.throws(() => resolveAgentProvider({}), /openai or openrouter/);
  assert.throws(() => resolveAgentProvider({ AI_PROVIDER: 'demo' }), /openai or openrouter/);
});

test('configures OpenRouter with its Responses endpoint and attribution headers', () => {
  const config = resolveAgentProvider({
    AI_PROVIDER: 'openrouter',
    OPENROUTER_API_KEY: 'test-key',
    OPENROUTER_MODEL: 'openai/gpt-4.1-mini',
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1/',
    OPENROUTER_SITE_URL: 'http://localhost:3000',
    OPENROUTER_APP_NAME: 'Greenhouse Lockdown',
  });

  assert.equal(config.provider, 'openrouter');
  assert.equal(config.live, true);
  assert.equal(config.responsesUrl, 'https://openrouter.ai/api/v1/responses');
  assert.equal(config.extraHeaders['HTTP-Referer'], 'http://localhost:3000');
  assert.equal(config.extraHeaders['X-Title'], 'Greenhouse Lockdown');
});

test('keeps direct OpenAI configuration separate from OpenRouter', () => {
  const config = resolveAgentProvider({
    AI_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-key',
    OPENAI_MODEL: 'gpt-5.6-luna',
    AI_MAX_OUTPUT_TOKENS: '800',
    AI_REASONING_EFFORT: 'medium',
  });

  assert.equal(config.provider, 'openai');
  assert.equal(config.model, 'gpt-5.6-luna');
  assert.equal(config.responsesUrl, 'https://api.openai.com/v1/responses');
  assert.equal(config.maxOutputTokens, 800);
  assert.equal(config.reasoningEffort, 'medium');
});
