import { peopleById } from './users.js';

// Activity types and their data:
//   expense_added / expense_updated / expense_deleted  { expenseId, description, amountCents, paidBy, split, shares, spentOn }
//   settled        { settlementId, payments: [{ fromUserId, toUserId, amountCents }], expenseCount }
//   group_created  { name, memberIds }
//   member_added   (target_user_id is the new member)
//   friend_added   (target_user_id is the new friend)
export function recordActivity(db, { type, actorId, groupId = null, targetUserId = null, data = {} }) {
  db.prepare('INSERT INTO activity (type, actor_id, group_id, target_user_id, data) VALUES (?, ?, ?, ?, ?)')
    .run(type, actorId, groupId, targetUserId, JSON.stringify(data));
}

// Newest-first feed for one user: everything in their groups, plus non-group
// events they took part in. Pass the last item's id as `before` to page back.
export function listActivity(db, userId, { before = null, limit = 30 } = {}) {
  const rows = db.prepare(`
    SELECT a.id, a.type, a.actor_id AS actorId, a.group_id AS groupId, g.name AS groupName,
           a.target_user_id AS targetUserId, a.data, a.created_at AS createdAt
    FROM activity a LEFT JOIN groups g ON g.id = a.group_id
    WHERE (a.group_id IN (SELECT group_id FROM group_members WHERE user_id = @userId)
           OR (a.group_id IS NULL AND @userId IN (a.actor_id, a.target_user_id)))
      AND (@before IS NULL OR a.id < @before)
    ORDER BY a.id DESC
    LIMIT @limit`).all({ userId, before, limit: limit + 1 });

  const items = rows.slice(0, limit).map((row) => ({ ...row, data: JSON.parse(row.data) }));
  const ids = items.flatMap((a) => [
    a.actorId, a.targetUserId, a.data.paidBy,
    ...Object.keys(a.data.shares ?? {}),
    ...(a.data.payments ?? []).flatMap((p) => [p.fromUserId, p.toUserId]),
    ...(a.data.memberIds ?? []),
  ]);
  return {
    items,
    people: peopleById(db, ids),
    nextBefore: rows.length > limit ? items.at(-1).id : null,
  };
}
