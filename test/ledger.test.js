import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_AMOUNT_CENTS, expenseImpact, netBalances, parseAmount, simplifyDebts, splitShares } from '../shared/ledger.js';

test('parseAmount accepts the ways people type money', () => {
  const cases = {
    '12': 1200, '12.5': 1250, '12.50': 1250, '12.': 1200, '.99': 99, '0.01': 1,
    '$7.25': 725, '1,234.56': 123456, ' 3.10 ': 310,
  };
  for (const [input, cents] of Object.entries(cases)) assert.equal(parseAmount(input), cents, input);
  assert.equal(parseAmount(19.99), 1999);
  // Float noise (0.30000000000000004) is rejected rather than silently rounded.
  assert.equal(parseAmount(0.1 + 0.2), null);
});

test('parseAmount rejects anything that is not a positive amount in cents', () => {
  for (const input of ['', '.', '0', '0.00', '-5', '1.234', 'abc', '1e3', '12.3.4', '$', null, undefined, {}, NaN, 1e21]) {
    assert.equal(parseAmount(input), null, String(input));
  }
  assert.equal(parseAmount(String(MAX_AMOUNT_CENTS / 100)), MAX_AMOUNT_CENTS);
  assert.equal(parseAmount(String(MAX_AMOUNT_CENTS / 100 + 0.01)), null);
});

test('splitShares: equal split between two, payer keeps the odd cent', () => {
  assert.deepEqual(splitShares(1000, { split: 'equal', paidBy: 1, participants: [1, 2] }), { 1: 500, 2: 500 });
  assert.deepEqual(splitShares(1001, { split: 'equal', paidBy: 2, participants: [1, 2] }), { 1: 500, 2: 501 });
  assert.deepEqual(splitShares(1, { split: 'equal', paidBy: 1, participants: [1, 2] }), { 1: 1, 2: 0 });
});

test('splitShares: equal split between several people always adds up', () => {
  const shares = splitShares(1000, { split: 'equal', paidBy: 2, participants: [3, 1, 2] });
  assert.deepEqual(shares, { 1: 333, 2: 334, 3: 333 });

  // Payer not taking part: leftover cents go to participants in id order.
  assert.deepEqual(splitShares(1001, { split: 'equal', paidBy: 9, participants: [3, 1, 2] }), { 1: 334, 2: 334, 3: 333 });

  for (const amount of [1, 2, 7, 999, 1000, 123457]) {
    for (const n of [1, 2, 3, 4, 7]) {
      const ids = Array.from({ length: n }, (_, i) => i + 1);
      const total = Object.values(splitShares(amount, { split: 'equal', paidBy: 1, participants: ids })).reduce((a, b) => a + b, 0);
      assert.equal(total, amount, `${amount} between ${n}`);
    }
  }
  assert.throws(() => splitShares(1000, { split: 'equal', paidBy: 1, participants: [] }), /at least one/);
});

test('splitShares: full puts the whole amount on one person', () => {
  assert.deepEqual(splitShares(1001, { split: 'full', paidBy: 1, owedBy: 2 }), { 2: 1001 });
  assert.throws(() => splitShares(1000, { split: 'thirds' }), /Unknown split/);
});

test('netBalances and expenseImpact', () => {
  const expenses = [
    { paidBy: 1, amountCents: 3000, shares: { 1: 1000, 2: 1000, 3: 1000 } }, // trip dinner
    { paidBy: 2, amountCents: 1200, shares: { 1: 1200 } }, // 1 owes 2 in full
  ];
  assert.deepEqual(netBalances(expenses), { 1: 800, 2: 200, 3: -1000 });
  assert.equal(Object.values(netBalances(expenses)).reduce((a, b) => a + b, 0), 0);

  assert.equal(expenseImpact(expenses[0], 1), 2000); // lent 20
  assert.equal(expenseImpact(expenses[0], 3), -1000); // borrowed 10
  assert.equal(expenseImpact(expenses[1], 3), 0); // not involved
});

test('simplifyDebts settles everyone with few payments', () => {
  assert.deepEqual(simplifyDebts({ 1: 1500, 2: -1500 }), [{ fromUserId: 2, toUserId: 1, amountCents: 1500 }]);
  assert.deepEqual(simplifyDebts({ 1: 0, 2: 0 }), []);

  const net = { 1: 800, 2: 200, 3: -1000 };
  const transfers = simplifyDebts(net);
  assert.deepEqual(transfers, [
    { fromUserId: 3, toUserId: 1, amountCents: 800 },
    { fromUserId: 3, toUserId: 2, amountCents: 200 },
  ]);

  // Applying the transfers zeroes every balance, and never needs more than n-1 payments.
  const big = { 1: 4500, 2: -2000, 3: -1500, 4: 2500, 5: -3500 };
  const result = simplifyDebts(big);
  const after = { ...big };
  for (const t of result) {
    after[t.fromUserId] += t.amountCents;
    after[t.toUserId] -= t.amountCents;
  }
  assert.ok(Object.values(after).every((c) => c === 0));
  assert.ok(result.length <= 4);
});
