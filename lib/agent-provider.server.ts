export type AgentProvider = 'openai' | 'openrouter';
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface AgentProviderEnvironment {
  AI_PROVIDER?: string;
  AI_MAX_OUTPUT_TOKENS?: string;
  AI_REASONING_EFFORT?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_APP_NAME?: string;
}

export interface AgentProviderConfig {
  provider: AgentProvider;
  model: string;
  apiKey?: string;
  responsesUrl?: string;
  extraHeaders: Record<string, string>;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  live: boolean;
}

const DEFAULT_OPENAI_MODEL = 'gpt-5.6-terra';
const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4.1-mini';

export function resolveAgentProvider(source: AgentProviderEnvironment): AgentProviderConfig {
  const provider = normalizeProvider(source.AI_PROVIDER);
  const maxOutputTokens = boundedInteger(source.AI_MAX_OUTPUT_TOKENS, 300, 64, 4096);
  const reasoningEffort = normalizeReasoningEffort(source.AI_REASONING_EFFORT);

  if (provider === 'openrouter') {
    const apiKey = clean(source.OPENROUTER_API_KEY);
    return {
      provider,
      model: clean(source.OPENROUTER_MODEL) ?? DEFAULT_OPENROUTER_MODEL,
      apiKey,
      responsesUrl: responsesUrl(source.OPENROUTER_BASE_URL, 'https://openrouter.ai/api/v1'),
      extraHeaders: compactHeaders({
        'HTTP-Referer': clean(source.OPENROUTER_SITE_URL),
        'X-Title': clean(source.OPENROUTER_APP_NAME),
      }),
      maxOutputTokens,
      reasoningEffort,
      live: Boolean(apiKey),
    };
  }

  if (provider === 'openai') {
    const apiKey = clean(source.OPENAI_API_KEY);
    return {
      provider,
      model: clean(source.OPENAI_MODEL) ?? DEFAULT_OPENAI_MODEL,
      apiKey,
      responsesUrl: responsesUrl(source.OPENAI_BASE_URL, 'https://api.openai.com/v1'),
      extraHeaders: {},
      maxOutputTokens,
      reasoningEffort,
      live: Boolean(apiKey),
    };
  }

  throw new Error('AI_PROVIDER must be set to openai or openrouter');
}

function normalizeProvider(value?: string): AgentProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'openrouter') return normalized;
  throw new Error('AI_PROVIDER must be set to openai or openrouter');
}

function normalizeReasoningEffort(value?: string): ReasoningEffort {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'none' || normalized === 'medium' || normalized === 'high' ? normalized : 'low';
}

function responsesUrl(value: string | undefined, fallback: string) {
  return `${clean(value) ?? fallback}/responses`.replace(/\/+responses$/, '/responses');
}

function clean(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized.replace(/\/+$/, '') : undefined;
}

function compactHeaders(headers: Record<string, string | undefined>) {
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}
