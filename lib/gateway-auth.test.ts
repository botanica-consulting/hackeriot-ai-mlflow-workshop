import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_GATEWAY_ACCESS_CODE,
  gatewayCookie,
  isGatewayAuthorized,
  safeReturnTo,
} from './gateway-auth.ts';

void test('accepts only the configured fixed-value access cookie', () => {
  const env = { GATEWAY_ACCESS_CODE: 'builders-belong-here', GATEWAY_ALLOWED_IPS: '' };
  assert.equal(isGatewayAuthorized({ cookieHeader: 'greenhouse_access=builders-belong-here' }, env), true);
  assert.equal(isGatewayAuthorized({ cookieHeader: 'greenhouse_access=wrong' }, env), false);
  assert.equal(isGatewayAuthorized({}, env), false);
});

void test('uses the women-in-tech phrase and secure cookie attributes by default', () => {
  assert.equal(DEFAULT_GATEWAY_ACCESS_CODE, 'women-in-tech-shape-the-future');
  assert.match(gatewayCookie({}), /^greenhouse_access=women-in-tech-shape-the-future;/);
  assert.match(gatewayCookie({}), /HttpOnly; Secure; SameSite=Lax$/);
});

void test('allows only exact IPs from the comma-separated bypass list', () => {
  const env = { GATEWAY_ALLOWED_IPS: '203.0.113.8, 2001:db8::12' };
  assert.equal(isGatewayAuthorized({ clientIp: '203.0.113.8' }, env), true);
  assert.equal(isGatewayAuthorized({ clientIp: '2001:db8::12' }, env), true);
  assert.equal(isGatewayAuthorized({ clientIp: '203.0.113.9' }, env), false);
});

void test('keeps post-login redirects on the same origin', () => {
  assert.equal(safeReturnTo('/mlflow?view=traces'), '/mlflow?view=traces');
  assert.equal(safeReturnTo('https://example.com'), '/');
  assert.equal(safeReturnTo('//example.com'), '/');
});
