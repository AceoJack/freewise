import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';

const BASE = {
  GOOGLE_CLIENT_ID: 'client',
  SESSION_SECRET: 'x'.repeat(64),
  FREEWISE_USERS: 'Jack:jack@example.com;Jaime:jaime@example.com',
};

test('loads defaults', () => {
  const config = loadConfig(BASE);
  assert.equal(config.port, 3000);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.devLogin, false);
  assert.equal(config.secureCookies, false);
});

test('production uses secure cookies and refuses dev login', () => {
  assert.equal(loadConfig({ ...BASE, NODE_ENV: 'production' }).secureCookies, true);
  assert.throws(() => loadConfig({ ...BASE, NODE_ENV: 'production', DEV_LOGIN: 'true' }), /DEV_LOGIN/);
});

test('requires a client id and a long session secret', () => {
  assert.throws(() => loadConfig({ ...BASE, GOOGLE_CLIENT_ID: '' }), /GOOGLE_CLIENT_ID/);
  assert.throws(() => loadConfig({ ...BASE, SESSION_SECRET: 'short' }), /SESSION_SECRET/);
});
