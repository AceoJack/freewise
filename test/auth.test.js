import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { parseUsersConfig, syncUsers } from '../server/users.js';

const USERS = 'Jack:jack@example.com;Jaime:jaime@example.com,jaime.alt@example.com';

// Fake Google: each credential string maps to the claims Google would return.
const GOOGLE_TOKENS = {
  jack: { sub: 'g-jack', email: 'jack@example.com', email_verified: true },
  jaime: { sub: 'g-jaime', email: 'jaime@example.com', email_verified: true },
  jaimeAlt: { sub: 'g-jaime-alt', email: 'Jaime.Alt@example.com', email_verified: true },
  impostor: { sub: 'g-other', email: 'jack@example.com', email_verified: true },
  unverified: { sub: 'g-x', email: 'jack@example.com', email_verified: false },
  stranger: { sub: 'g-s', email: 'stranger@example.com', email_verified: true },
};

async function start(t, { devLogin = false } = {}) {
  const db = openDb(':memory:');
  syncUsers(db, parseUsersConfig(USERS));
  const config = { googleClientId: 'test-client', sessionSecret: 'x'.repeat(64), devLogin, secureCookies: false };
  const verifyGoogleToken = async (credential) => {
    if (!GOOGLE_TOKENS[credential]) throw new Error('invalid');
    return GOOGLE_TOKENS[credential];
  };
  const server = createApp({ db, config, verifyGoogleToken }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  return { db, base: `http://127.0.0.1:${server.address().port}` };
}

function googleLogin(base, credential, { csrf = 'abc', cookieCsrf = csrf } = {}) {
  return fetch(`${base}/auth/google/callback`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(cookieCsrf && { cookie: `g_csrf_token=${cookieCsrf}` }),
    },
    body: new URLSearchParams({ credential, g_csrf_token: csrf }),
  });
}

function sessionCookie(res) {
  return res.headers.getSetCookie().find((c) => c.startsWith('fw_session='))?.split(';')[0];
}

function me(base, cookie) {
  return fetch(`${base}/api/me`, { headers: cookie ? { cookie } : {} });
}

test('API requires a session', async (t) => {
  const { base } = await start(t);
  assert.equal((await me(base)).status, 401);
  assert.equal((await me(base, 'fw_session=forged.value')).status, 401);
});

test('Google sign-in creates a session and /api/me returns user and partner', async (t) => {
  const { base } = await start(t);
  const res = await googleLogin(base, 'jack');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');

  const raw = res.headers.getSetCookie().find((c) => c.startsWith('fw_session='));
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /SameSite=Lax/i);

  const body = await (await me(base, sessionCookie(res))).json();
  assert.equal(body.user.name, 'Jack');
  assert.equal(body.partner.name, 'Jaime');
});

test('both of Jaime\'s Google accounts sign in as Jaime', async (t) => {
  const { base } = await start(t);
  for (const credential of ['jaime', 'jaimeAlt']) {
    const res = await googleLogin(base, credential);
    const body = await (await me(base, sessionCookie(res))).json();
    assert.equal(body.user.name, 'Jaime');
    assert.equal(body.partner.name, 'Jack');
  }
});

test('sign-in failures redirect with a reason and set no session', async (t) => {
  const { base } = await start(t);
  const cases = [
    [googleLogin(base, 'jack', { cookieCsrf: 'different' }), 'csrf'],
    [googleLogin(base, 'jack', { cookieCsrf: null }), 'csrf'],
    [googleLogin(base, 'not-a-real-token'), 'invalid_token'],
    [googleLogin(base, 'unverified'), 'unverified'],
    [googleLogin(base, 'stranger'), 'not_allowed'],
  ];
  for (const [request, reason] of cases) {
    const res = await request;
    assert.equal(res.headers.get('location'), `/?login_error=${reason}`);
    assert.equal(sessionCookie(res), undefined);
  }
});

test('an email is pinned to the first Google account that uses it', async (t) => {
  const { base } = await start(t);
  await googleLogin(base, 'jack');
  const res = await googleLogin(base, 'impostor');
  assert.equal(res.headers.get('location'), '/?login_error=account_mismatch');
});

test('removing an email from the allowlist ends its existing sessions', async (t) => {
  const { base, db } = await start(t);
  const cookie = sessionCookie(await googleLogin(base, 'jaimeAlt'));
  assert.equal((await me(base, cookie)).status, 200);

  syncUsers(db, parseUsersConfig('Jack:jack@example.com;Jaime:jaime@example.com'));
  assert.equal((await me(base, cookie)).status, 401);
});

test('logout clears the session cookie', async (t) => {
  const { base } = await start(t);
  const res = await fetch(`${base}/auth/logout`, { method: 'POST' });
  assert.equal(res.status, 204);
  assert.match(res.headers.getSetCookie().join(), /fw_session=;.*Expires=Thu, 01 Jan 1970/);
});

test('dev login only exists when enabled', async (t) => {
  const off = await start(t);
  assert.equal((await fetch(`${off.base}/auth/config`).then((r) => r.json())).devUsers, null);
  const blocked = await fetch(`${off.base}/auth/dev-login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"userId":1}',
  });
  assert.equal(blocked.status, 404);

  const on = await start(t, { devLogin: true });
  const { devUsers } = await fetch(`${on.base}/auth/config`).then((r) => r.json());
  const jaime = devUsers.find((u) => u.name === 'Jaime');
  const res = await fetch(`${on.base}/auth/dev-login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId: jaime.id }),
  });
  assert.equal(res.status, 204);
  assert.equal((await (await me(on.base, sessionCookie(res))).json()).user.name, 'Jaime');
});
