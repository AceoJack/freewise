import os from 'node:os';
import { createApp } from './app.js';
import { googleVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { seedUsers } from './users.js';

const config = loadConfig();
const db = openDb(config.dbPath);
seedUsers(db, config.users);

const app = createApp({ db, config, verifyGoogleToken: googleVerifier(config.googleClientId) });

app.listen(config.port, config.host, () => {
  const host = ['127.0.0.1', '::1'].includes(config.host) ? 'localhost' : config.host;
  console.log(`Freewise running at http://${host}:${config.port}`);
  if (config.host === '0.0.0.0') {
    // Listening on every interface: print addresses a phone on the same Wi-Fi can use.
    const lan = Object.values(os.networkInterfaces()).flat()
      .filter((a) => a.family === 'IPv4' && !a.internal)
      .map((a) => `http://${a.address}:${config.port}`);
    if (lan.length) console.log(`On your network: ${lan.join(', ')}`);
  }
  if (config.devLogin) console.log('DEV_LOGIN is on: anyone who can reach this server can sign in as anyone');
});
