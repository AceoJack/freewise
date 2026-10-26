// Copies the database to a dated file and keeps the newest few.
//   node scripts/backup.js <database> <backup folder> [how many to keep, default 14]
// Safe to run while Freewise is running: SQLite's backup API takes a consistent copy.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const [source, folder, keepArg = '14'] = process.argv.slice(2);
const keep = Number(keepArg);
if (!source || !folder || !Number.isInteger(keep) || keep < 1) {
  console.error('Usage: node scripts/backup.js <database> <backup folder> [how many to keep]');
  process.exit(1);
}
if (!fs.existsSync(source)) {
  console.error(`No database at ${source}`);
  process.exit(1);
}

fs.mkdirSync(folder, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19); // 2026-10-26T03-00-00
const target = path.join(folder, `freewise-${stamp}.db`);

const db = new Database(source, { readonly: true, fileMustExist: true });
await db.backup(target);
db.close();

// The copy inherits WAL mode; switch it back so each backup is one self-contained file.
const check = new Database(target);
check.pragma('journal_mode = DELETE');
const result = check.pragma('integrity_check', { simple: true });
check.close();
if (result !== 'ok') {
  console.error(`Backup ${target} failed its integrity check: ${result}`);
  process.exit(1);
}

const old = fs.readdirSync(folder).filter((f) => /^freewise-.*\.db$/.test(f)).sort().reverse().slice(keep);
for (const f of old) fs.rmSync(path.join(folder, f));
console.log(`${new Date().toISOString()} backed up to ${target}${old.length ? `, removed ${old.length} old` : ''}`);
