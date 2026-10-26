import crypto from 'node:crypto';

// Sessions are a stateless signed cookie: base64url(JSON payload) + "." + HMAC-SHA256.
export const COOKIE_NAME = 'fw_session';
export const SESSION_MS = 180 * 24 * 60 * 60 * 1000;

export function signSession(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body, secret)}`;
}

export function verifySession(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;

  const given = Buffer.from(sig);
  const expected = Buffer.from(hmac(body, secret));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload?.exp !== 'number' || payload.exp <= now) return null;
  return payload;
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const name = part.slice(0, i).trim();
    if (!name || name in cookies) continue;
    try {
      cookies[name] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // Ignore malformed values rather than failing the whole request.
    }
  }
  return cookies;
}

function hmac(body, secret) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64url');
}
