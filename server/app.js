import express from 'express';
import path from 'node:path';
import { authRouter, requireUser } from './auth.js';
import { listUsers } from './users.js';

const PUBLIC_DIR = path.join(import.meta.dirname, '..', 'public');

export function createApp({ db, config, verifyGoogleToken }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/auth', authRouter({ db, config, verifyGoogleToken }));

  const api = express.Router();
  api.use(requireUser({ db, config }));
  api.get('/me', (req, res) => {
    const partner = listUsers(db).find((u) => u.id !== req.user.id);
    res.json({ user: req.user, partner });
  });
  app.use('/api', api);

  app.use(express.static(PUBLIC_DIR));

  return app;
}
