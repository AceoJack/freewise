import { parseUsersConfig } from './users.js';

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const devLogin = env.DEV_LOGIN === 'true';
  if (devLogin && production) throw new Error('DEV_LOGIN must not be enabled when NODE_ENV=production');

  if (!env.GOOGLE_CLIENT_ID) throw new Error('GOOGLE_CLIENT_ID is not set');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }

  return {
    port: Number(env.PORT) || 3000,
    host: env.HOST || '127.0.0.1',
    dbPath: env.DB_PATH || './data/freewise.db',
    googleClientId: env.GOOGLE_CLIENT_ID,
    sessionSecret: env.SESSION_SECRET,
    users: parseUsersConfig(env.FREEWISE_USERS),
    devLogin,
    // Funnel terminates HTTPS in front of us, so the browser always sees https in production.
    secureCookies: production,
  };
}
