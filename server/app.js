import express from 'express';
import path from 'node:path';
import { apiRouter } from './api.js';
import { authRouter } from './auth.js';
import { ClientError } from './errors.js';

const ROOT = path.join(import.meta.dirname, '..');

export function createApp({ db, config, verifyGoogleToken }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/auth', authRouter({ db, config, verifyGoogleToken }));
  app.use('/api', apiRouter({ db, config }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'Not found.' }));

  app.use('/shared', express.static(path.join(ROOT, 'shared')));
  app.use(express.static(path.join(ROOT, 'public')));

  app.use((err, req, res, next) => {
    if (err instanceof ClientError) {
      return res.status(err.status).json({ error: err.code, message: err.message, field: err.field });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON.' });
    }
    console.error(err);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
  });

  return app;
}
