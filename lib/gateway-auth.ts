export const GATEWAY_COOKIE_NAME = 'greenhouse_access';
export const DEFAULT_GATEWAY_ACCESS_CODE = 'women-in-tech-shape-the-future';

type GatewayEnvironment = {
  GATEWAY_ACCESS_CODE?: string;
  GATEWAY_ALLOWED_IPS?: string;
};

export function gatewayAccessCode(env: GatewayEnvironment = process.env as GatewayEnvironment) {
  return env.GATEWAY_ACCESS_CODE?.trim() || DEFAULT_GATEWAY_ACCESS_CODE;
}

export function isGatewayAuthorized(
  input: { cookieHeader?: string | null; clientIp?: string | null },
  env: GatewayEnvironment = process.env as GatewayEnvironment,
) {
  const clientIp = normalizeIp(input.clientIp);
  if (clientIp && allowedIps(env).has(clientIp)) return true;
  return readCookie(input.cookieHeader, GATEWAY_COOKIE_NAME) === gatewayAccessCode(env);
}

export function gatewayCookie(env: GatewayEnvironment = process.env as GatewayEnvironment) {
  return [
    `${GATEWAY_COOKIE_NAME}=${encodeURIComponent(gatewayAccessCode(env))}`,
    'Path=/',
    'Max-Age=43200',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}

export function safeReturnTo(value: string | null | undefined) {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\r\n]/.test(value)) return '/';
  return value;
}

function allowedIps(env: GatewayEnvironment) {
  return new Set(
    (env.GATEWAY_ALLOWED_IPS ?? '')
      .split(',')
      .map(normalizeIp)
      .filter((value): value is string => Boolean(value)),
  );
}

function normalizeIp(value: string | null | undefined) {
  return value?.trim().replace(/^\[|\]$/g, '') || undefined;
}

function readCookie(header: string | null | undefined, name: string) {
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
