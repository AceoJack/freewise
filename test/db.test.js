import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { parseUsersConfig, syncUsers, findUserByEmail, listUsers } from '../server/users.js';

const CONFIG = 'Jack:jack@example.com;Jaime:jaime@example.com,Jaime.Alt@example.com';

function setup() {
  const db = openDb(':memory:');
  syncUsers(db, parseUsersConfig(CONFIG));
  return db;
}

test('migrations create the schema and record the version', () => {
  const db = openDb(':memory:');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all();
  assert.deepEqual(tables, ['expenses', 'settlements', 'user_emails', 'users']);
  assert.equal(db.pragma('user_version', { simple: true }), 1);
});

test('parseUsersConfig handles multiple emails and normalises case', () => {
  assert.deepEqual(parseUsersConfig(CONFIG), [
    { name: 'Jack', emails: ['jack@example.com'] },
    { name: 'Jaime', emails: ['jaime@example.com', 'jaime.alt@example.com'] },
  ]);
});

test('parseUsersConfig rejects bad config', () => {
  assert.throws(() => parseUsersConfig(''), /not set/);
  assert.throws(() => parseUsersConfig('Jack:jack@example.com'), /exactly 2/);
  assert.throws(() => parseUsersConfig('Jack:;Jaime:j@example.com'), /Invalid/);
  assert.throws(() => parseUsersConfig('Jack:a@example.com;Jaime:a@example.com'), /same email/);
});

test('both of Jaime\'s emails map to the same person, case-insensitively', () => {
  const db = setup();
  const a = findUserByEmail(db, 'jaime@example.com');
  const b = findUserByEmail(db, 'JAIME.ALT@example.com');
  assert.equal(a.name, 'Jaime');
  assert.equal(a.id, b.id);
  assert.equal(findUserByEmail(db, 'stranger@example.com'), null);
});

test('removing an email from the config revokes it but keeps the person', () => {
  const db = setup();
  syncUsers(db, parseUsersConfig('Jack:jack@example.com;Jaime:jaime@example.com'));
  assert.equal(findUserByEmail(db, 'jaime.alt@example.com'), null);
  assert.ok(findUserByEmail(db, 'jaime@example.com'));
  assert.equal(listUsers(db).length, 2);
});

test('syncUsers is idempotent', () => {
  const db = setup();
  syncUsers(db, parseUsersConfig(CONFIG));
  assert.equal(listUsers(db).length, 2);
  assert.equal(db.prepare('SELECT count(*) FROM user_emails').pluck().get(), 3);
});

test('expense constraints reject bad data', () => {
  const db = setup();
  const [jack] = listUsers(db);
  const insert = db.prepare(`
    INSERT INTO expenses (description, amount_cents, paid_by, split_type, owed_cents, spent_on, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);

  insert.run('Groceries', 5000, jack.id, 'equal', 2500, '2026-10-26', jack.id);

  assert.throws(() => insert.run('  ', 5000, jack.id, 'equal', 2500, '2026-10-26', jack.id), /CHECK/);
  assert.throws(() => insert.run('Zero', 0, jack.id, 'equal', 0, '2026-10-26', jack.id), /CHECK/);
  assert.throws(() => insert.run('Over', 1000, jack.id, 'full', 1001, '2026-10-26', jack.id), /CHECK/);
  assert.throws(() => insert.run('Split', 1000, jack.id, 'thirds', 333, '2026-10-26', jack.id), /CHECK/);
  assert.throws(() => insert.run('Date', 1000, jack.id, 'equal', 500, '26/10/2026', jack.id), /CHECK/);
  assert.throws(() => insert.run('Nobody', 1000, 999, 'equal', 500, '2026-10-26', jack.id), /FOREIGN KEY/);
});
