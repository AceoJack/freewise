import { MAX_NAME_LENGTH } from '../shared/ledger.js';
import { recordActivity } from './activity.js';
import { conflict, invalid, notFound } from './errors.js';
import { groupBalanceFor, hasUnsettledExpenses, isInUnsettledExpenses } from './expenses.js';
import { areFriends } from './friends.js';

const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;

// The user's groups, most recently active first, with their balance in each.
export function listGroups(db, userId) {
  const groups = db.prepare(`
    SELECT g.id, g.name
    FROM groups g JOIN group_members m ON m.group_id = g.id AND m.user_id = ?
    WHERE g.deleted_at IS NULL
    ORDER BY coalesce((SELECT max(a.id) FROM activity a WHERE a.group_id = g.id), 0) DESC, g.id DESC`).all(userId);
  for (const g of groups) {
    g.members = groupMembers(db, g.id);
    g.balanceCents = groupBalanceFor(db, g.id, userId);
  }
  return groups;
}

// A group the user belongs to. Non-members get the same 404 as a missing or deleted group.
export function getGroup(db, userId, groupId) {
  const group = db.prepare(`
    SELECT g.id, g.name, g.created_by AS createdBy, g.created_at AS createdAt
    FROM groups g JOIN group_members m ON m.group_id = g.id AND m.user_id = ?
    WHERE g.id = ? AND g.deleted_at IS NULL`).get(userId, groupId);
  if (!group) throw notFound('That group does not exist.');
  group.members = groupMembers(db, groupId);
  return group;
}

export function isMember(db, groupId, userId) {
  return !!db.prepare(`
    SELECT 1 FROM group_members m JOIN groups g ON g.id = m.group_id
    WHERE m.group_id = ? AND m.user_id = ? AND g.deleted_at IS NULL`).get(groupId, userId);
}

// { name, memberIds: [friend ids] }. The creator is always a member.
export function createGroup(db, userId, body) {
  const name = validateGroupName(body?.name);
  const memberIds = body.memberIds ?? [];
  if (!Array.isArray(memberIds) || !memberIds.every((id) => Number.isInteger(id) && areFriends(db, userId, id))) {
    throw invalid('memberIds', 'You can only add your friends to a group.');
  }

  return db.transaction(() => {
    const groupId = Number(db.prepare('INSERT INTO groups (name, created_by) VALUES (?, ?)').run(name, userId).lastInsertRowid);
    const addMember = db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, added_by) VALUES (?, ?, ?)');
    for (const id of [userId, ...memberIds]) addMember.run(groupId, id, userId);
    recordActivity(db, { type: 'group_created', actorId: userId, groupId, data: { name, memberIds } });
    return getGroup(db, userId, groupId);
  })();
}

export function renameGroup(db, userId, groupId, body) {
  const group = getGroup(db, userId, groupId);
  const name = validateGroupName(body?.name);
  if (name === group.name) return group;

  return db.transaction(() => {
    db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, groupId);
    recordActivity(db, { type: 'group_renamed', actorId: userId, groupId, data: { from: group.name, to: name } });
    return getGroup(db, userId, groupId);
  })();
}

// Hides the group for everyone. Only allowed once nothing is left unsettled,
// so no money owed disappears with it.
export function deleteGroup(db, userId, groupId) {
  const group = getGroup(db, userId, groupId);
  if (hasUnsettledExpenses(db, groupId)) {
    throw conflict('unsettled', 'Settle up or delete the remaining expenses before deleting this group.');
  }
  db.transaction(() => {
    db.prepare(`UPDATE groups SET deleted_at = ${NOW} WHERE id = ?`).run(groupId);
    recordActivity(db, { type: 'group_deleted', actorId: userId, groupId, data: { name: group.name } });
  })();
}

export function addMember(db, userId, groupId, newMemberId) {
  getGroup(db, userId, groupId);
  if (!Number.isInteger(newMemberId) || !areFriends(db, userId, newMemberId)) {
    throw invalid('userId', 'You can only add your friends to a group.');
  }
  if (isMember(db, groupId, newMemberId)) throw conflict('already_member', 'They are already in this group.');

  return db.transaction(() => {
    db.prepare('INSERT INTO group_members (group_id, user_id, added_by) VALUES (?, ?, ?)').run(groupId, newMemberId, userId);
    recordActivity(db, { type: 'member_added', actorId: userId, groupId, targetUserId: newMemberId });
    return getGroup(db, userId, groupId);
  })();
}

// Removes someone from a group, or lets the user leave it. Not allowed while
// they're part of anything unsettled, so the group's balances stay correct.
// Returns the updated group, or null if the user left.
export function removeMember(db, userId, groupId, memberId) {
  const group = getGroup(db, userId, groupId);
  const member = group.members.find((m) => m.id === memberId);
  if (!member) throw notFound('They are not in this group.');
  const leaving = memberId === userId;

  if (group.members.length === 1) {
    throw conflict('last_member', 'You’re the only one in this group. Delete the group instead.');
  }
  if (isInUnsettledExpenses(db, groupId, memberId)) {
    throw conflict('has_unsettled_expenses', leaving
      ? 'You’re part of expenses that haven’t been settled. Settle up or change those expenses before leaving.'
      : `${member.name} is part of expenses that haven’t been settled. Settle up or change those expenses first.`);
  }

  return db.transaction(() => {
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, memberId);
    recordActivity(db, leaving
      ? { type: 'member_left', actorId: userId, groupId }
      : { type: 'member_removed', actorId: userId, groupId, targetUserId: memberId });
    return leaving ? null : getGroup(db, userId, groupId);
  })();
}

function validateGroupName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw invalid('name', 'Give the group a name.');
  if (name.length > MAX_NAME_LENGTH) throw invalid('name', `Keep the name to ${MAX_NAME_LENGTH} characters or fewer.`);
  return name;
}

function groupMembers(db, groupId) {
  return db.prepare(`
    SELECT u.id, u.name, u.picture_url AS pictureUrl
    FROM group_members m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ?
    ORDER BY m.added_at, u.id`).all(groupId);
}
