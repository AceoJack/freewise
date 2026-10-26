import { recordActivity } from './activity.js';
import { invalid } from './errors.js';
import { balancesWithEveryone } from './expenses.js';
import { createUser, findUserByEmail, normaliseEmail, primaryEmail, validateName } from './users.js';

export function areFriends(db, userId, otherId) {
  return !!db.prepare('SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ?').get(userId, otherId);
}

// Friends sorted by name, each with what they owe the user (negative: the user owes them).
export function listFriends(db, userId) {
  const friends = db.prepare(`
    SELECT u.id, u.name, u.picture_url AS pictureUrl
    FROM friendships f JOIN users u ON u.id = f.friend_id
    WHERE f.user_id = ?
    ORDER BY u.name COLLATE NOCASE, u.id`).all(userId);
  const balances = balancesWithEveryone(db, userId);
  for (const f of friends) {
    f.email = primaryEmail(db, f.id);
    f.balanceCents = balances[f.id] ?? 0;
  }
  return friends;
}

// Who an email belongs to, for the "add friend" preview.
export function lookupEmail(db, userId, rawEmail) {
  const email = normaliseEmail(rawEmail);
  if (!email) throw invalid('email', 'Enter a valid email address.');
  const user = findUserByEmail(db, email);
  return {
    email,
    user: user && { id: user.id, name: user.name },
    isYou: user?.id === userId,
    isFriend: !!user && areFriends(db, userId, user.id),
  };
}

// { email, name? }. If nobody has that email yet, a new person is created with
// the given name; they can then sign in with Google using that email.
export function addFriend(db, userId, body) {
  const email = normaliseEmail(body?.email);
  if (!email) throw invalid('email', 'Enter a valid email address.');

  return db.transaction(() => {
    const existing = findUserByEmail(db, email);
    if (existing?.id === userId) throw invalid('email', "That's your own email address.");
    const friendId = existing?.id ?? createUser(db, validateName(body.name), email);

    if (!areFriends(db, userId, friendId)) {
      const befriend = db.prepare('INSERT OR IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?)');
      befriend.run(userId, friendId);
      befriend.run(friendId, userId);
      recordActivity(db, { type: 'friend_added', actorId: userId, targetUserId: friendId });
    }
    return listFriends(db, userId).find((f) => f.id === friendId);
  })();
}
