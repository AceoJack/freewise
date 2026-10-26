// FREEWISE_USERS defines who can sign in, e.g.
//   Jack:jack@gmail.com;Jaime:jaime@gmail.com,jaime.alt@gmail.com
// Each person is "Name:email[,email...]", people are separated by ";".
export function parseUsersConfig(str) {
  if (!str) throw new Error('FREEWISE_USERS is not set');

  const users = str.split(';').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const [name, emails] = entry.split(':').map((s) => s?.trim());
    const list = (emails || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!name || list.length === 0) throw new Error(`Invalid FREEWISE_USERS entry: "${entry}"`);
    return { name, emails: list };
  });

  if (users.length !== 2) throw new Error(`FREEWISE_USERS must list exactly 2 people, got ${users.length}`);
  const all = users.flatMap((u) => u.emails);
  if (new Set(all).size !== all.length) throw new Error('FREEWISE_USERS lists the same email twice');
  return users;
}

// Makes the users/user_emails tables match the config. Emails dropped from the
// config lose access; people are never deleted so their history stays intact.
export function syncUsers(db, users) {
  const insertUser = db.prepare('INSERT INTO users (name) VALUES (?) ON CONFLICT(name) DO NOTHING');
  const getUser = db.prepare('SELECT id FROM users WHERE name = ?');
  const upsertEmail = db.prepare(`
    INSERT INTO user_emails (email, user_id) VALUES (?, ?)
    ON CONFLICT(email) DO UPDATE SET user_id = excluded.user_id`);

  db.transaction(() => {
    for (const { name, emails } of users) {
      insertUser.run(name);
      const { id } = getUser.get(name);
      for (const email of emails) upsertEmail.run(email, id);
    }
    const keep = users.flatMap((u) => u.emails);
    db.prepare(`DELETE FROM user_emails WHERE email NOT IN (${keep.map(() => '?').join(',')})`).run(...keep);
  })();
}

export function findUserByEmail(db, email) {
  return db.prepare(`
    SELECT u.id, u.name, e.email, e.google_sub
    FROM user_emails e JOIN users u ON u.id = e.user_id
    WHERE e.email = ?`).get(email) ?? null;
}

export function listUsers(db) {
  return db.prepare('SELECT id, name FROM users ORDER BY id').all();
}

export function primaryEmail(db, userId) {
  return db.prepare('SELECT email FROM user_emails WHERE user_id = ? ORDER BY rowid LIMIT 1')
    .pluck().get(userId) ?? null;
}

// Links an email to the Google account that first signs in with it. Returns
// false if a different Google account later presents the same email.
export function recordGoogleSub(db, email, sub) {
  if (typeof sub !== 'string' || !sub) return false;
  const row = db.prepare('SELECT google_sub FROM user_emails WHERE email = ?').get(email);
  if (!row) return false;
  if (row.google_sub) return row.google_sub === sub;
  db.prepare('UPDATE user_emails SET google_sub = ? WHERE email = ?').run(sub, email);
  return true;
}
