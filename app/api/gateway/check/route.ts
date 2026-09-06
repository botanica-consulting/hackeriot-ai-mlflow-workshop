import { isGatewayAuthorized, safeReturnTo } from '@/lib/gateway-auth';

function check(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0];
  const clientIp = request.headers.get('cf-connecting-ip')
    ?? forwardedFor
    ?? request.headers.get('x-real-ip');

  if (isGatewayAuthorized({
    cookieHeader: request.headers.get('cookie'),
    clientIp,
  })) {
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const returnTo = safeReturnTo(request.headers.get('x-forwarded-uri'));
  return new Response(null, {
    status: 302,
    headers: {
      'Cache-Control': 'private, no-store',
      Location: `/gateway?returnTo=${encodeURIComponent(returnTo)}`,
    },
  });
}

export const GET = check;
export const HEAD = check;
export const POST = check;
export const PUT = check;
export const PATCH = check;
export const DELETE = check;
export const OPTIONS = check;
