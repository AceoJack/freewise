import { createApp } from '../server/app.js';
import { openDb } from '../server/db.js';
import { parseUsersConfig, seedUsers } from '../server/users.js';

export const USERS = 'Jack:jack@example.com;Jaime:jaime@example.com,jaime.alt@example.com';

// Starts the app on a random port with an in-memory database; shuts down when the test ends.
export async function startServer(t, { devLogin = false, verifyGoogleToken = async () => { throw new Error('no Google in tests'); } } = {}) {
  const db = openDb(':memory:');
  seedUsers(db, parseUsersConfig(USERS));
  const config = { googleClientId: 'test-client', sessionSecret: 'x'.repeat(64), devLogin, secureCookies: false };
  const server = createApp({ db, config, verifyGoogleToken }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.close(); db.close(); });
  return { db, base: `http://127.0.0.1:${server.address().port}` };
}

export function sessionCookie(res) {
  return res.headers.getSetCookie().find((c) => c.startsWith('fw_session='))?.split(';')[0];
}
