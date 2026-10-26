import express from 'express';
import { listActivity } from './activity.js';
import { requireUser } from './auth.js';
import { invalid, notFound } from './errors.js';
import {
  createExpense, deleteExpense, getEditableExpense, getGroupLedger, getSettlement, listGroupSettlements,
  settleGroup, updateExpense, validateExpense,
} from './expenses.js';
import { addFriend, listFriends, lookupEmail } from './friends.js';
import { addMember, createGroup, getGroup, isMember, listGroups } from './groups.js';
import { getUser, peopleById, updateUserName, validateName } from './users.js';

export function apiRouter({ db, config }) {
  const router = express.Router();
  router.use(requireUser({ db, config }));

  // Account
  router.get('/me', (req, res) => {
    res.json({ user: getUser(db, req.user.id) });
  });

  router.patch('/me', (req, res) => {
    updateUserName(db, req.user.id, validateName(req.body?.name));
    res.json({ user: getUser(db, req.user.id) });
  });

  // Friends
  router.get('/friends', (req, res) => {
    res.json(listFriends(db, req.user.id));
  });

  router.get('/friends/lookup', (req, res) => {
    res.json(lookupEmail(db, req.user.id, req.query.email));
  });

  router.post('/friends', (req, res) => {
    res.status(201).json(addFriend(db, req.user.id, req.body));
  });

  // Groups
  router.get('/groups', (req, res) => {
    res.json(listGroups(db, req.user.id));
  });

  router.post('/groups', (req, res) => {
    res.status(201).json(createGroup(db, req.user.id, req.body));
  });

  // The group page: the group, its members and its current ledger.
  router.get('/groups/:id', (req, res) => {
    const group = getGroup(db, req.user.id, idParam(req));
    res.json({ group, ledger: getGroupLedger(db, group.id) });
  });

  router.post('/groups/:id/members', (req, res) => {
    res.status(201).json(addMember(db, req.user.id, idParam(req), req.body?.userId));
  });

  router.post('/groups/:id/expenses', (req, res) => {
    const group = getGroup(db, req.user.id, idParam(req));
    const input = validateExpense(req.body, group.members.map((m) => m.id));
    res.status(201).json(createExpense(db, req.user.id, group.id, input));
  });

  router.post('/groups/:id/settle', (req, res) => {
    const group = getGroup(db, req.user.id, idParam(req));
    const token = req.body?.balanceToken;
    if (typeof token !== 'string') throw invalid('balanceToken', 'balanceToken is required.');
    res.status(201).json(settleGroup(db, req.user.id, group.id, token));
  });

  router.get('/groups/:id/history', (req, res) => {
    const group = getGroup(db, req.user.id, idParam(req));
    res.json({ group, settlements: listGroupSettlements(db, group.id) });
  });

  // Expenses
  router.put('/expenses/:id', (req, res) => {
    const expense = getEditableExpense(db, req.user.id, idParam(req));
    const group = getGroup(db, req.user.id, expense.groupId);
    const input = validateExpense(req.body, group.members.map((m) => m.id));
    res.json(updateExpense(db, req.user.id, expense, input));
  });

  router.delete('/expenses/:id', (req, res) => {
    deleteExpense(db, req.user.id, getEditableExpense(db, req.user.id, idParam(req)));
    res.status(204).end();
  });

  // Settlements
  router.get('/settlements/:id', (req, res) => {
    const settlement = getSettlement(db, idParam(req));
    if (!settlement || !isMember(db, settlement.groupId, req.user.id)) throw notFound('That settle-up does not exist.');
    const { members } = getGroup(db, req.user.id, settlement.groupId);
    const ids = [
      ...members.map((m) => m.id),
      ...settlement.payments.flatMap((p) => [p.fromUserId, p.toUserId]),
      ...settlement.expenses.flatMap((e) => [e.paidBy, ...Object.keys(e.shares)]),
      settlement.createdBy,
    ];
    res.json({ settlement, memberCount: members.length, people: peopleById(db, ids) });
  });

  // Activity
  router.get('/activity', (req, res) => {
    const before = req.query.before === undefined ? null : Number(req.query.before);
    if (before !== null && !Number.isSafeInteger(before)) throw invalid('before', 'Invalid cursor.');
    res.json(listActivity(db, req.user.id, { before }));
  });

  return router;
}

function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
  return id;
}
