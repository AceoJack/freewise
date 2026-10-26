import { MAX_NAME_LENGTH } from '../shared/ledger.js';
import { invalid } from './errors.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// FREEWISE_USERS lists people who can always sign in, e.g.
//   Jack:jack@gmail.com;Jaime:jaime@gmail.com,jaime.alt@gmail.com
// Each person is "Name:email[,email...]", people are separated by ";".
// Anyone else gets in by being added as a friend by email.
export function parseUsersConfig(str) {
  if (!str) throw new Error('FREEWISE_USERS is not set');

  const users = str.split(';').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const [name, emails] = entry.split(':').map((s) => s?.trim());
    const list = (emails || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!name || list.length === 0) throw new Error(`Invalid FREEWISE_USERS entry: "${entry}"`);
    return { name, emails: list };
  });

  if (users.length === 0) throw new Error('FREEWISE_USERS must list at least one person');
  const all = users.flatMap((u) => u.emails);
  if (new Set(all).size !== all.length) throw new Error('FREEWISE_USERS lists the same email twice');
  return users;
}

// Makes sure everyone in the config exists with all their emails. Existing
// people are matched by email; nothing is ever removed.
export function seedUsers(db, users) {
  const addEmail = db.prepare('INSERT INTO user_emails (email, user_id) VALUES (?, ?) ON CONFLICT(email) DO NOTHING');
  const ownerOf = db.prepare('SELECT user_id FROM user_emails WHERE email = ?').pluck();

  db.transaction(() => {
    for (const { name, emails } of users) {
      const owners = new Set(emails.map((e) => ownerOf.get(e)).filter(Boolean));
      if (owners.size > 1) throw new Error(`FREEWISE_USERS: ${emails.join(', ')} belong to different people`);
      const id = owners.size ? [...owners][0] : createUser(db, name);
      for (const email of emails) addEmail.run(email, id);
    }
  })();
}

export function normaliseEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return EMAIL_PATTERN.test(email) && email.length <= 254 ? email : null;
}

export function validateName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw invalid('name', 'Enter a name.');
  if (name.length > MAX_NAME_LENGTH) throw invalid('name', `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`);
  return name;
}

export function createUser(db, name, email = null) {
  const id = Number(db.prepare('INSERT INTO users (name) VALUES (?)').run(name).lastInsertRowid);
  if (email) db.prepare('INSERT INTO user_emails (email, user_id) VALUES (?, ?)').run(email, id);
  return id;
}

export function findUserByEmail(db, email) {
  return db.prepare(`
    SELECT u.id, u.name, e.email, e.google_sub AS googleSub
    FROM user_emails e JOIN users u ON u.id = e.user_id
    WHERE e.email = ?`).get(email) ?? null;
}

export function getUser(db, id) {
  const user = db.prepare('SELECT id, name, picture_url AS pictureUrl FROM users WHERE id = ?').get(id);
  if (!user) return null;
  user.emails = db.prepare('SELECT email FROM user_emails WHERE user_id = ? ORDER BY rowid').pluck().all(id);
  return user;
}

export function updateUserName(db, id, name) {
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
}

export function listUsers(db) {
  return db.prepare('SELECT id, name FROM users ORDER BY id').all();
}

// { [id]: { id, name, pictureUrl } } for the given user ids.
export function peopleById(db, ids) {
  const unique = [...new Set([...ids].filter((id) => id != null).map(Number))];
  const rows = db.prepare(`
    SELECT id, name, picture_url AS pictureUrl FROM users
    WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(unique));
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

export function primaryEmail(db, userId) {
  return db.prepare('SELECT email FROM user_emails WHERE user_id = ? ORDER BY rowid LIMIT 1')
    .pluck().get(userId) ?? null;
}

// Links an email to the Google account that first signs in with it and keeps
// the profile picture up to date. Returns false if a different Google account
// later presents the same email.
export function recordGoogleSignIn(db, email, sub, pictureUrl) {
  if (typeof sub !== 'string' || !sub) return false;
  const row = db.prepare('SELECT user_id AS userId, google_sub AS googleSub FROM user_emails WHERE email = ?').get(email);
  if (!row) return false;
  if (row.googleSub && row.googleSub !== sub) return false;
  if (!row.googleSub) db.prepare('UPDATE user_emails SET google_sub = ? WHERE email = ?').run(sub, email);
  if (typeof pictureUrl === 'string' && pictureUrl.startsWith('https://')) {
    db.prepare('UPDATE users SET picture_url = ? WHERE id = ?').run(pictureUrl, row.userId);
  }
  return true;
}
