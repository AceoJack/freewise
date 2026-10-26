import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate, openDb } from '../server/db.js';
import { findUserByEmail, parseUsersConfig, seedUsers } from '../server/users.js';

const CONFIG = 'Jack:jack@example.com;Jaime:jaime@example.com,Jaime.Alt@example.com';

test('a fresh database gets the full schema', () => {
  const db = openDb(':memory:');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all();
  assert.deepEqual(tables, [
    'activity', 'expense_shares', 'expenses', 'friendships', 'group_members', 'groups',
    'settlement_payments', 'settlements', 'user_emails', 'users',
  ]);
  assert.equal(db.pragma('user_version', { simple: true }), 3);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
});

test('upgrading a v1 database moves the two-person ledger into a group', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db, { upTo: 1 });
  db.exec(`
    INSERT INTO users (id, name) VALUES (1, 'Jack'), (2, 'Jaime');
    INSERT INTO user_emails (email, user_id, google_sub) VALUES ('jack@example.com', 1, 'g-jack'), ('jaime@example.com', 2, NULL);
    INSERT INTO settlements (id, from_user_id, to_user_id, amount_cents, created_by) VALUES (1, 2, 1, 1500, 1), (2, 1, 2, 0, 2);
    INSERT INTO expenses (id, description, amount_cents, paid_by, split_type, owed_cents, spent_on, created_by, settlement_id)
    VALUES (1, 'Groceries', 3001, 1, 'equal', 1500, '2026-10-01', 1, 1),
           (2, 'Her lunch', 1200, 1, 'full', 1200, '2026-10-02', 1, NULL),
           (3, 'Dinner', 3000, 2, 'equal', 1500, '2026-10-03', 2, NULL);`);

  migrate(db);

  assert.equal(db.pragma('user_version', { simple: true }), 3);
  assert.deepEqual(db.prepare('SELECT id, name, created_by FROM groups').all(), [{ id: 1, name: 'Jack & Jaime', created_by: 1 }]);
  assert.equal(db.prepare('SELECT count(*) FROM group_members WHERE group_id = 1').pluck().get(), 2);
  assert.equal(db.prepare('SELECT count(*) FROM friendships').pluck().get(), 2);
  assert.equal(findUserByEmail(db, 'jack@example.com').googleSub, 'g-jack');

  const shares = db.prepare('SELECT expense_id, user_id, share_cents FROM expense_shares ORDER BY expense_id, user_id').all();
  assert.deepEqual(shares.map((s) => [s.expense_id, s.user_id, s.share_cents]), [
    [1, 1, 1501], [1, 2, 1500], // equal: payer keeps the odd cent
    [2, 2, 1200], // full: only the person who owes
    [3, 1, 1500], [3, 2, 1500],
  ]);
  assert.equal(db.prepare('SELECT count(*) FROM expenses WHERE group_id = 1').pluck().get(), 3);
  assert.equal(db.prepare('SELECT settlement_id FROM expenses WHERE id = 1').pluck().get(), 1);

  const payments = db.prepare('SELECT settlement_id, from_user_id, to_user_id, amount_cents FROM settlement_payments').all();
  assert.deepEqual(payments, [{ settlement_id: 1, from_user_id: 2, to_user_id: 1, amount_cents: 1500 }]);
  assert.equal(db.prepare('SELECT count(*) FROM settlements WHERE group_id = 1').pluck().get(), 2);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('upgrading a v1 database with nobody in it creates no group', () => {
  const db = new Database(':memory:');
  migrate(db, { upTo: 1 });
  migrate(db);
  assert.equal(db.prepare('SELECT count(*) FROM groups').pluck().get(), 0);
});

test('parseUsersConfig handles multiple emails and normalises case', () => {
  assert.deepEqual(parseUsersConfig(CONFIG), [
    { name: 'Jack', emails: ['jack@example.com'] },
    { name: 'Jaime', emails: ['jaime@example.com', 'jaime.alt@example.com'] },
  ]);
  assert.deepEqual(parseUsersConfig('Jack:jack@example.com'), [{ name: 'Jack', emails: ['jack@example.com'] }]);
});

test('parseUsersConfig rejects bad config', () => {
  assert.throws(() => parseUsersConfig(''), /not set/);
  assert.throws(() => parseUsersConfig(';'), /at least one/);
  assert.throws(() => parseUsersConfig('Jack:;Jaime:j@example.com'), /Invalid/);
  assert.throws(() => parseUsersConfig('Jack:a@example.com;Jaime:a@example.com'), /same email/);
});

test('seedUsers maps several emails to one person and is idempotent', () => {
  const db = openDb(':memory:');
  seedUsers(db, parseUsersConfig(CONFIG));
  seedUsers(db, parseUsersConfig(CONFIG));
  assert.equal(db.prepare('SELECT count(*) FROM users').pluck().get(), 2);
  const a = findUserByEmail(db, 'jaime@example.com');
  const b = findUserByEmail(db, 'JAIME.ALT@example.com');
  assert.equal(a.name, 'Jaime');
  assert.equal(a.id, b.id);
  assert.equal(findUserByEmail(db, 'stranger@example.com'), null);
});

test('seedUsers adds a new email to an existing person and never removes anyone', () => {
  const db = openDb(':memory:');
  seedUsers(db, parseUsersConfig(CONFIG));
  seedUsers(db, parseUsersConfig('Jaime:jaime@example.com,jaime.third@example.com'));
  assert.equal(findUserByEmail(db, 'jaime.third@example.com').id, findUserByEmail(db, 'jaime@example.com').id);
  assert.ok(findUserByEmail(db, 'jack@example.com'));
  assert.throws(() => seedUsers(db, parseUsersConfig('X:jack@example.com,jaime@example.com')), /different people/);
});

test('upgrading a v2 database keeps expenses and allows the new split types', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db, { upTo: 2 });
  db.exec(`
    INSERT INTO users (id, name) VALUES (1, 'Jack'), (2, 'Jaime');
    INSERT INTO groups (id, name, created_by) VALUES (1, 'Home', 1);
    INSERT INTO group_members (group_id, user_id) VALUES (1, 1), (1, 2);
    INSERT INTO expenses (id, group_id, description, amount_cents, paid_by, split_type, spent_on, created_by)
    VALUES (1, 1, 'Groceries', 1000, 1, 'equal', '2026-10-01', 1);
    INSERT INTO expense_shares (expense_id, user_id, share_cents) VALUES (1, 1, 500), (1, 2, 500);`);

  migrate(db);

  assert.equal(db.pragma('user_version', { simple: true }), 3);
  assert.deepEqual(db.prepare('SELECT user_id, share_cents, split_value FROM expense_shares ORDER BY user_id').all(), [
    { user_id: 1, share_cents: 500, split_value: null }, { user_id: 2, share_cents: 500, split_value: null },
  ]);
  assert.equal(db.prepare('SELECT deleted_at FROM groups').pluck().get(), null);
  db.prepare(`INSERT INTO expenses (group_id, description, amount_cents, paid_by, split_type, spent_on, created_by)
              VALUES (1, 'Rent', 1000, 1, 'percent', '2026-10-02', 1)`).run();
  db.prepare('DELETE FROM expenses WHERE id = 1').run(); // shares still follow the rebuilt table
  assert.equal(db.prepare('SELECT count(*) FROM expense_shares').pluck().get(), 0);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
