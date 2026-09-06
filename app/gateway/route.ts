import {
  gatewayAccessCode,
  gatewayCookie,
  safeReturnTo,
} from '@/lib/gateway-auth';

export async function GET(request: Request) {
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
  return gatewayPage(returnTo);
}

export async function POST(request: Request) {
  const form = await request.formData();
  const returnTo = safeReturnTo(text(form.get('returnTo')));
  if (text(form.get('accessCode')) !== gatewayAccessCode()) {
    return gatewayPage(returnTo, 'That phrase did not match. Please try again.', 401);
  }

  return new Response(null, {
    status: 303,
    headers: {
      'Cache-Control': 'private, no-store',
      Location: returnTo,
      'Set-Cookie': gatewayCookie(),
    },
  });
}

function gatewayPage(returnTo: string, error?: string, status = 200) {
  const escapedReturnTo = escapeHtml(returnTo);
  const errorMarkup = error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : '';
  return new Response(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Greenhouse Workshop Access</title>
  <style>
    :root { color-scheme: dark; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 24px; background: #07140f; color: #ebfff5; }
    main { width: min(100%, 460px); padding: 36px; border: 1px solid #285442; border-radius: 18px; background: #0c2018; box-shadow: 0 24px 80px #0008; }
    .eyebrow { margin: 0 0 14px; color: #71e6ad; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; font: 700 clamp(28px, 7vw, 42px)/1.05 system-ui, sans-serif; letter-spacing: -.04em; }
    .intro { margin: 16px 0 28px; color: #b7d7c8; font: 16px/1.55 system-ui, sans-serif; }
    label { display: block; margin-bottom: 9px; color: #d8f7e7; font-size: 14px; }
    input { width: 100%; border: 1px solid #39745a; border-radius: 10px; padding: 13px 14px; background: #06110d; color: white; font: inherit; outline: none; }
    input:focus { border-color: #71e6ad; box-shadow: 0 0 0 3px #71e6ad22; }
    button { width: 100%; margin-top: 14px; border: 0; border-radius: 10px; padding: 13px 16px; background: #71e6ad; color: #062016; font: 700 15px system-ui, sans-serif; cursor: pointer; }
    button:hover { background: #93f4c4; }
    .error { margin: 0 0 16px; color: #ff9e9e; font: 14px/1.4 system-ui, sans-serif; }
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Botanica · Prompt Lab</p>
    <h1>Workshop access</h1>
    <p class="intro">Women in tech shape the future. Enter the workshop phrase to continue.</p>
    ${errorMarkup}
    <form method="post" action="/gateway">
      <input type="hidden" name="returnTo" value="${escapedReturnTo}">
      <label for="accessCode">Access phrase</label>
      <input id="accessCode" name="accessCode" type="password" autocomplete="current-password" required autofocus>
      <button type="submit">Enter the workshop</button>
    </form>
  </main>
</body>
</html>`, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Content-Type': 'text/html; charset=utf-8',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    },
  });
}

function text(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value : '';
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}
