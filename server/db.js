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
// upTo stops at a given version (used by tests to build an older database).
export function migrate(db, { upTo = Infinity } = {}) {
  const current = db.pragma('user_version', { simple: true });
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = parseInt(file, 10);
    if (version <= current || version > upTo) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    // Rebuilding tables needs foreign keys off (SQLite can't toggle them inside a
    // transaction), so check them by hand before committing instead.
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        db.exec(sql);
        const broken = db.pragma('foreign_key_check');
        if (broken.length) throw new Error(`Migration ${file} broke foreign keys: ${JSON.stringify(broken.slice(0, 5))}`);
        db.pragma(`user_version = ${version}`);
      })();
    } finally {
      db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    }
  }
}
