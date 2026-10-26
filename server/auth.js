import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { COOKIE_NAME, SESSION_MS, parseCookies, signSession, verifySession } from './session.js';
import { findUserByEmail, listUsers, primaryEmail, recordGoogleSub } from './users.js';

const GOOGLE_JWKS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// Returns a function that checks a Google ID token's signature, issuer, audience
// and expiry, and resolves to its claims.
export function googleVerifier(clientId) {
  const jwks = createRemoteJWKSet(GOOGLE_JWKS_URL);
  return async (idToken) => {
    const { payload } = await jwtVerify(idToken, jwks, { issuer: GOOGLE_ISSUERS, audience: clientId });
    return payload;
  };
}

export function authRouter({ db, config, verifyGoogleToken }) {
  const router = express.Router();

  function startSession(res, email) {
    const token = signSession({ email, exp: Date.now() + SESSION_MS }, config.sessionSecret);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'lax',
      maxAge: SESSION_MS,
      path: '/',
    });
  }

  router.get('/config', (req, res) => {
    res.json({
      googleClientId: config.googleClientId,
      devUsers: config.devLogin ? listUsers(db) : null,
    });
  });

  // Google Identity Services (redirect mode) POSTs the ID token here as a form.
  router.post('/google/callback', express.urlencoded({ extended: false }), async (req, res) => {
    const fail = (reason) => res.redirect(303, `/?login_error=${reason}`);

    // Google sets g_csrf_token as a cookie and posts the same value; they must match.
    const posted = req.body?.g_csrf_token;
    if (!posted || posted !== parseCookies(req.headers.cookie).g_csrf_token) return fail('csrf');

    let claims;
    try {
      claims = await verifyGoogleToken(req.body.credential);
    } catch {
      return fail('invalid_token');
    }
    if (claims.email_verified !== true || typeof claims.email !== 'string') return fail('unverified');

    const user = findUserByEmail(db, claims.email);
    if (!user) return fail('not_allowed');
    if (!recordGoogleSub(db, user.email, claims.sub)) return fail('account_mismatch');

    startSession(res, user.email);
    res.redirect(303, '/');
  });

  if (config.devLogin) {
    router.post('/dev-login', (req, res) => {
      const email = primaryEmail(db, Number(req.body?.userId));
      if (!email) return res.status(400).json({ error: 'unknown_user' });
      startSession(res, email);
      res.status(204).end();
    });
  }

  router.post('/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.status(204).end();
  });

  return router;
}

// Rejects the request unless it carries a valid session for an email that is
// still allowed. Looking the email up each time means removing it from
// FREEWISE_USERS signs that account out on the next request.
export function requireUser({ db, config }) {
  return (req, res, next) => {
    const session = verifySession(parseCookies(req.headers.cookie)[COOKIE_NAME], config.sessionSecret);
    const user = session && findUserByEmail(db, session.email);
    if (!user) return res.status(401).json({ error: 'not_signed_in' });
    req.user = { id: user.id, name: user.name };
    next();
  };
}
