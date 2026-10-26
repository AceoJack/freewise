import express from 'express';
import path from 'node:path';
import { openDb } from './db.js';
import { parseUsersConfig, syncUsers } from './users.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const db = openDb();
syncUsers(db, parseUsersConfig(process.env.FREEWISE_USERS));

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use(express.static(path.join(import.meta.dirname, '..', 'public')));

app.listen(PORT, HOST, () => {
  console.log(`Freewise running at http://${HOST}:${PORT}`);
});
