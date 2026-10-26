import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(import.meta.dirname, 'migrations');

export function openDb(file = process.env.DB_PATH || './data/freewise.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

// Applies migrations/NNN_*.sql in order, tracking progress in PRAGMA user_version.
export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = parseInt(file, 10);
    if (version <= current) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
  }
}
