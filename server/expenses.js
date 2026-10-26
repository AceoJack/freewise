import {
  FULL_PERCENT, MAX_DESCRIPTION_LENGTH, SPLITS, formatPercent, netBalances, pairwiseDebts, parseAmount, parseCents,
  parsePercent, simplifyDebts, splitShares,
} from '../shared/ledger.js';
import { recordActivity } from './activity.js';
import { conflict, invalid, notFound } from './errors.js';

const ACTIVE = 'settlement_id IS NULL AND deleted_at IS NULL';
const NOW = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
const EXPENSE_COLUMNS = `
  id, group_id AS groupId, description, amount_cents AS amountCents, paid_by AS paidBy,
  split_type AS split, spent_on AS spentOn, created_by AS createdBy,
  created_at AS createdAt, updated_at AS updatedAt, settlement_id AS settlementId`;

// Checks an add/edit request against the group's members and works out the shares.
//   { description, amount, paidBy, split: 'equal', participants?: [ids], spentOn }
//   { description, amount, paidBy, split: 'full', owedBy: id, spentOn }
//   { description, amount, paidBy, split: 'percent', percents: { [id]: "33.33" }, spentOn }
//   { description, amount, paidBy, split: 'exact', amounts: { [id]: "12.50" }, spentOn }
// participants defaults to everyone in the group.
export function validateExpense(body, memberIds) {
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  if (!description) throw invalid('description', 'Enter what the expense was for.');
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw invalid('description', `Keep the description to ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
  }

  const amountCents = parseAmount(body.amount);
  if (amountCents === null) throw invalid('amount', 'Enter an amount like 12.50.');

  const { paidBy, split } = body;
  if (!memberIds.includes(paidBy)) throw invalid('paidBy', 'Choose who paid.');
  if (!SPLITS.includes(split)) throw invalid('split', 'Choose how to split it.');

  let shares;
  let splitValues = null;
  if (split === 'percent' || split === 'exact') {
    splitValues = parseSplitValues(body, split, memberIds, amountCents);
    shares = splitShares(amountCents, { split, paidBy, values: splitValues });
  } else if (split === 'equal') {
    const participants = body.participants ?? memberIds;
    if (!Array.isArray(participants) || participants.length === 0 || !participants.every((id) => memberIds.includes(id))) {
      throw invalid('participants', 'Choose who to split it between.');
    }
    shares = splitShares(amountCents, { split, paidBy, participants });
  } else {
    if (!memberIds.includes(body.owedBy) || body.owedBy === paidBy) {
      throw invalid('owedBy', 'Choose who owes the full amount.');
    }
    shares = splitShares(amountCents, { split, owedBy: body.owedBy });
  }

  const spentOn = body.spentOn ?? localDate();
  if (!isValidDate(spentOn)) throw invalid('spentOn', 'Enter a valid date.');

  return { description, amountCents, paidBy, split, shares, splitValues, spentOn };
}

// Reads each person's percentage or exact amount and checks they add up.
function parseSplitValues(body, split, memberIds, amountCents) {
  const field = split === 'percent' ? 'percents' : 'amounts';
  const raw = body[field];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalid(field, split === 'percent' ? 'Enter a percentage for each person.' : 'Enter an amount for each person.');
  }

  const values = {};
  for (const [key, input] of Object.entries(raw)) {
    const id = Number(key);
    if (!memberIds.includes(id)) throw invalid(field, 'Only people in the group can share an expense.');
    const value = split === 'percent' ? parsePercent(input) : parseCents(input);
    if (value === null) throw invalid(field, split === 'percent' ? 'Enter percentages like 25 or 33.33.' : 'Enter amounts like 12.50.');
    if (value > 0) values[id] = value;
  }

  const total = Object.values(values).reduce((a, b) => a + b, 0);
  if (split === 'percent' && total !== FULL_PERCENT) {
    throw invalid(field, `The percentages add up to ${formatPercent(total)}, not 100%.`);
  }
  if (split === 'exact' && total !== amountCents) {
    throw invalid(field, `The amounts add up to ${dollars(total)}, not ${dollars(amountCents)}.`);
  }
  return values;
}

const dollars = (cents) => `$${(cents / 100).toFixed(2)}`;

// The group's current ledger. balanceToken identifies exactly what the user is
// looking at, so a settle-up can be refused if anything changed in the meantime.
export function getGroupLedger(db, groupId) {
  const expenses = loadExpenses(db, `group_id = ? AND ${ACTIVE}`, groupId);
  const balances = netBalances(expenses);
  const token = Object.entries(balances).filter(([, c]) => c !== 0).sort(([a], [b]) => a - b)
    .map(([id, c]) => `${id}:${c}`).join(',');
  return {
    expenses,
    balances,
    transfers: simplifyDebts(balances),
    // How many payments it would take if everyone paid back each payer directly,
    // so the settle-up screen can show what simplifying saves.
    directPaymentCount: pairwiseDebts(expenses).length,
    balanceToken: `${expenses.length}|${token}`,
  };
}

export function groupBalanceFor(db, groupId, userId) {
  return netBalances(loadExpenses(db, `group_id = ? AND ${ACTIVE}`, groupId))[userId] ?? 0;
}

// What each person owes this user (positive) or is owed by them (negative),
// across every group, counting each expense directly between payer and participant.
export function balancesWithEveryone(db, userId) {
  const expenses = loadExpenses(db,
    `${ACTIVE} AND group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)`, userId);
  const owed = {};
  for (const debt of pairwiseDebts(expenses)) {
    if (debt.toUserId === userId) owed[debt.fromUserId] = (owed[debt.fromUserId] ?? 0) + debt.amountCents;
    if (debt.fromUserId === userId) owed[debt.toUserId] = (owed[debt.toUserId] ?? 0) - debt.amountCents;
  }
  return owed;
}

export function hasUnsettledExpenses(db, groupId) {
  return !!db.prepare(`SELECT 1 FROM expenses WHERE group_id = ? AND ${ACTIVE} LIMIT 1`).get(groupId);
}

// Whether someone paid for, or has a share in, anything on the group's current ledger.
export function isInUnsettledExpenses(db, groupId, userId) {
  return !!db.prepare(`
    SELECT 1 FROM expenses e
    WHERE e.group_id = ? AND e.settlement_id IS NULL AND e.deleted_at IS NULL
      AND (e.paid_by = ? OR EXISTS (SELECT 1 FROM expense_shares s WHERE s.expense_id = e.id AND s.user_id = ?))
    LIMIT 1`).get(groupId, userId, userId);
}

export function createExpense(db, userId, groupId, input) {
  return db.transaction(() => {
    const id = Number(db.prepare(`
      INSERT INTO expenses (group_id, description, amount_cents, paid_by, split_type, spent_on, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(groupId, input.description, input.amountCents, input.paidBy, input.split, input.spentOn, userId).lastInsertRowid);
    saveShares(db, id, input);
    const expense = getExpense(db, id);
    recordActivity(db, { type: 'expense_added', actorId: userId, groupId, data: snapshot(expense) });
    return expense;
  })();
}

export function updateExpense(db, userId, expense, input) {
  return db.transaction(() => {
    db.prepare(`
      UPDATE expenses
      SET description = ?, amount_cents = ?, paid_by = ?, split_type = ?, spent_on = ?, updated_at = ${NOW}
      WHERE id = ?`)
      .run(input.description, input.amountCents, input.paidBy, input.split, input.spentOn, expense.id);
    db.prepare('DELETE FROM expense_shares WHERE expense_id = ?').run(expense.id);
    saveShares(db, expense.id, input);
    const updated = getExpense(db, expense.id);
    recordActivity(db, { type: 'expense_updated', actorId: userId, groupId: expense.groupId, data: snapshot(updated) });
    return updated;
  })();
}

export function deleteExpense(db, userId, expense) {
  db.transaction(() => {
    db.prepare(`UPDATE expenses SET deleted_at = ${NOW} WHERE id = ?`).run(expense.id);
    recordActivity(db, { type: 'expense_deleted', actorId: userId, groupId: expense.groupId, data: snapshot(expense) });
  })();
}

// Loads an expense the user is allowed to change: it must exist, be in one of
// their groups, and still be on the current ledger.
export function getEditableExpense(db, userId, id) {
  const expense = loadExpenses(db, `id = ? AND deleted_at IS NULL
    AND group_id IN (SELECT m.group_id FROM group_members m JOIN groups g ON g.id = m.group_id
                     WHERE m.user_id = ? AND g.deleted_at IS NULL)`, id, userId)[0];
  if (!expense) throw notFound('That expense does not exist.');
  if (expense.settlementId) throw conflict('settled', 'That expense has been settled and can no longer be changed.');
  return expense;
}

// Archives the whole group ledger under one settlement, recording the payments
// that square everyone up.
export function settleGroup(db, userId, groupId, balanceToken) {
  return db.transaction(() => {
    const ledger = getGroupLedger(db, groupId);
    if (ledger.expenses.length === 0) throw conflict('nothing_to_settle', 'There is nothing to settle.');
    if (balanceToken !== ledger.balanceToken) {
      throw conflict('ledger_changed', 'The ledger changed since you opened it. Check the new balances and try again.');
    }

    const settlementId = Number(db.prepare('INSERT INTO settlements (group_id, created_by) VALUES (?, ?)')
      .run(groupId, userId).lastInsertRowid);
    const addPayment = db.prepare(`
      INSERT INTO settlement_payments (settlement_id, from_user_id, to_user_id, amount_cents) VALUES (?, ?, ?, ?)`);
    for (const t of ledger.transfers) addPayment.run(settlementId, t.fromUserId, t.toUserId, t.amountCents);
    db.prepare(`UPDATE expenses SET settlement_id = ? WHERE group_id = ? AND ${ACTIVE}`).run(settlementId, groupId);

    recordActivity(db, {
      type: 'settled', actorId: userId, groupId,
      data: { settlementId, payments: ledger.transfers, expenseCount: ledger.expenses.length },
    });
    return getSettlement(db, settlementId);
  })();
}

export function listGroupSettlements(db, groupId) {
  const settlements = db.prepare(`
    SELECT s.id, s.created_by AS createdBy, s.created_at AS createdAt,
           count(e.id) AS expenseCount, coalesce(sum(e.amount_cents), 0) AS totalCents
    FROM settlements s
    LEFT JOIN expenses e ON e.settlement_id = s.id AND e.deleted_at IS NULL
    WHERE s.group_id = ?
    GROUP BY s.id
    ORDER BY s.id DESC`).all(groupId);
  for (const s of settlements) s.payments = paymentsFor(db, s.id);
  return settlements;
}

// One settlement with its payments and expenses; null if it doesn't exist.
export function getSettlement(db, id) {
  const settlement = db.prepare(`
    SELECT s.id, s.group_id AS groupId, g.name AS groupName, s.created_by AS createdBy, s.created_at AS createdAt
    FROM settlements s JOIN groups g ON g.id = s.group_id
    WHERE s.id = ?`).get(id);
  if (!settlement) return null;
  settlement.payments = paymentsFor(db, id);
  settlement.expenses = loadExpenses(db, 'settlement_id = ? AND deleted_at IS NULL', id);
  return settlement;
}

function paymentsFor(db, settlementId) {
  return db.prepare(`
    SELECT from_user_id AS fromUserId, to_user_id AS toUserId, amount_cents AS amountCents
    FROM settlement_payments WHERE settlement_id = ? ORDER BY rowid`).all(settlementId);
}

// Expenses matching a WHERE clause, newest first, each with a shares map (and,
// for percentage and exact splits, splitValues: what each person was given).
function loadExpenses(db, where, ...params) {
  const expenses = db.prepare(`SELECT ${EXPENSE_COLUMNS} FROM expenses WHERE ${where} ORDER BY spent_on DESC, id DESC`)
    .all(...params);
  if (expenses.length === 0) return expenses;

  const byId = new Map(expenses.map((e) => [e.id, Object.assign(e, { shares: {} })]));
  const shares = db.prepare(`
    SELECT expense_id AS expenseId, user_id AS userId, share_cents AS cents, split_value AS value
    FROM expense_shares WHERE expense_id IN (SELECT value FROM json_each(?))`)
    .all(JSON.stringify([...byId.keys()]));
  for (const s of shares) {
    const expense = byId.get(s.expenseId);
    expense.shares[s.userId] = s.cents;
    if (s.value !== null) (expense.splitValues ??= {})[s.userId] = s.value;
  }
  return expenses;
}

function getExpense(db, id) {
  return loadExpenses(db, 'id = ?', id)[0];
}

function saveShares(db, expenseId, { shares, splitValues }) {
  const insert = db.prepare('INSERT INTO expense_shares (expense_id, user_id, share_cents, split_value) VALUES (?, ?, ?, ?)');
  for (const [userId, cents] of Object.entries(shares)) {
    insert.run(expenseId, Number(userId), cents, splitValues?.[userId] ?? null);
  }
}

function snapshot(e) {
  return {
    expenseId: e.id, description: e.description, amountCents: e.amountCents,
    paidBy: e.paidBy, split: e.split, shares: e.shares, spentOn: e.spentOn,
  };
}

function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

// Today's date in the server's time zone, as YYYY-MM-DD.
function localDate() {
  return new Date().toLocaleDateString('en-CA');
}
