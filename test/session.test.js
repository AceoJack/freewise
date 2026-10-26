import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, signSession, verifySession } from '../server/session.js';

const SECRET = 's'.repeat(64);

test('a signed session verifies and round-trips its payload', () => {
  const token = signSession({ email: 'a@example.com', exp: Date.now() + 60_000 }, SECRET);
  assert.equal(verifySession(token, SECRET).email, 'a@example.com');
});

test('tampered, wrongly signed, expired or malformed sessions are rejected', () => {
  const exp = Date.now() + 60_000;
  const token = signSession({ email: 'a@example.com', exp }, SECRET);
  const [, sig] = token.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ email: 'b@example.com', exp })).toString('base64url');

  assert.equal(verifySession(`${forgedBody}.${sig}`, SECRET), null);
  assert.equal(verifySession(token, 'x'.repeat(64)), null);
  assert.equal(verifySession(signSession({ email: 'a@example.com', exp: Date.now() - 1 }, SECRET), SECRET), null);
  assert.equal(verifySession(signSession({ email: 'a@example.com' }, SECRET), SECRET), null);
  assert.equal(verifySession('garbage', SECRET), null);
  assert.equal(verifySession(`${token}.extra`, SECRET), null);
  assert.equal(verifySession(undefined, SECRET), null);
});

test('parseCookies reads multiple cookies and tolerates junk', () => {
  assert.deepEqual(parseCookies('a=1; b=hello%20world; junk; =x; c=%E0%A4%A'), { a: '1', b: 'hello world' });
  assert.deepEqual(parseCookies(undefined), {});
});
