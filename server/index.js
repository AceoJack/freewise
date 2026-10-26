import { createApp } from './app.js';
import { googleVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { syncUsers } from './users.js';

const config = loadConfig();
const db = openDb(config.dbPath);
syncUsers(db, config.users);

const app = createApp({ db, config, verifyGoogleToken: googleVerifier(config.googleClientId) });

app.listen(config.port, config.host, () => {
  const host = ['127.0.0.1', '::1'].includes(config.host) ? 'localhost' : config.host;
  console.log(`Freewise running at http://${host}:${config.port}`);
  if (config.devLogin) console.log('DEV_LOGIN is on: anyone who can reach this server can sign in as anyone');
});
