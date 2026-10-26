import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addFriend } from '../server/friends.js';
import { sessionCookie, startServer } from './helpers.js';

// Fake Google: each credential string maps to the claims Google would return.
const GOOGLE_TOKENS = {
  jack: { sub: 'g-jack', email: 'jack@example.com', email_verified: true, picture: 'https://example.com/jack.png' },
  jaime: { sub: 'g-jaime', email: 'jaime@example.com', email_verified: true },
  jaimeAlt: { sub: 'g-jaime-alt', email: 'Jaime.Alt@example.com', email_verified: true },
  impostor: { sub: 'g-other', email: 'jack@example.com', email_verified: true },
  unverified: { sub: 'g-x', email: 'jack@example.com', email_verified: false },
  stranger: { sub: 'g-s', email: 'stranger@example.com', email_verified: true },
};

const verifyGoogleToken = async (credential) => {
  if (!GOOGLE_TOKENS[credential]) throw new Error('invalid');
  return GOOGLE_TOKENS[credential];
};

const start = (t, options) => startServer(t, { verifyGoogleToken, ...options });

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

function me(base, cookie) {
  return fetch(`${base}/api/me`, { headers: cookie ? { cookie } : {} });
}

test('API requires a session', async (t) => {
  const { base } = await start(t);
  assert.equal((await me(base)).status, 401);
  assert.equal((await me(base, 'fw_session=forged.value')).status, 401);
});

test('Google sign-in creates a session and /api/me returns the account', async (t) => {
  const { base } = await start(t);
  const res = await googleLogin(base, 'jack');
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/');

  const raw = res.headers.getSetCookie().find((c) => c.startsWith('fw_session='));
  assert.match(raw, /HttpOnly/i);
  assert.match(raw, /SameSite=Lax/i);

  const body = await (await me(base, sessionCookie(res))).json();
  assert.equal(body.user.name, 'Jack');
  assert.deepEqual(body.user.emails, ['jack@example.com']);
  assert.equal(body.user.pictureUrl, 'https://example.com/jack.png');
});

test('both of Jaime\'s Google accounts sign in as Jaime', async (t) => {
  const { base } = await start(t);
  for (const credential of ['jaime', 'jaimeAlt']) {
    const res = await googleLogin(base, credential);
    const body = await (await me(base, sessionCookie(res))).json();
    assert.equal(body.user.name, 'Jaime');
    assert.deepEqual(body.user.emails, ['jaime@example.com', 'jaime.alt@example.com']);
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

test('removing an email from the database ends its existing sessions', async (t) => {
  const { base, db } = await start(t);
  const cookie = sessionCookie(await googleLogin(base, 'jaimeAlt'));
  assert.equal((await me(base, cookie)).status, 200);

  db.prepare('DELETE FROM user_emails WHERE email = ?').run('jaime.alt@example.com');
  assert.equal((await me(base, cookie)).status, 401);
});

test('someone added as a friend by email can then sign in with Google', async (t) => {
  const { base, db } = await start(t);
  assert.equal((await googleLogin(base, 'stranger')).headers.get('location'), '/?login_error=not_allowed');

  const jack = db.prepare("SELECT user_id FROM user_emails WHERE email = 'jack@example.com'").pluck().get();
  addFriend(db, jack, { email: 'stranger@example.com', name: 'Sam' });

  const res = await googleLogin(base, 'stranger');
  assert.equal(res.headers.get('location'), '/');
  assert.equal((await (await me(base, sessionCookie(res))).json()).user.name, 'Sam');
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
