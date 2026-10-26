import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_AMOUNT_CENTS, expenseImpact, formatPercent, netBalances, pairwiseDebts, parseAmount, parseCents, parsePercent,
  simplifyDebts, splitShares,
} from '../shared/ledger.js';

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

test('parsePercent reads hundredths of a percent; blank is 0', () => {
  assert.equal(parsePercent('25'), 2500);
  assert.equal(parsePercent('33.33'), 3333);
  assert.equal(parsePercent('12.5%'), 1250);
  assert.equal(parsePercent('100'), 10000);
  assert.equal(parsePercent(''), 0);
  for (const bad of ['100.01', '-5', 'abc', '1.234', '101']) assert.equal(parsePercent(bad), null, bad);
  assert.equal(formatPercent(3333), '33.33%');
  assert.equal(formatPercent(5000), '50%');
});

test('parseCents allows zero and blank for exact splits', () => {
  assert.equal(parseCents(''), 0);
  assert.equal(parseCents('0'), 0);
  assert.equal(parseCents('12.50'), 1250);
  assert.equal(parseCents('x'), null);
});

test('splitShares: percentages round down and hand leftover cents to the payer first', () => {
  // $100 at 33.33 / 33.33 / 33.34
  assert.deepEqual(splitShares(10000, { split: 'percent', paidBy: 2, values: { 1: 3333, 2: 3333, 3: 3334 } }),
    { 1: 3333, 2: 3333, 3: 3334 });
  // $10.01 at 50/50: 500.5 each, the payer gets the odd cent
  assert.deepEqual(splitShares(1001, { split: 'percent', paidBy: 2, values: { 1: 5000, 2: 5000 } }), { 1: 500, 2: 501 });
  // Zero percent means not involved
  assert.deepEqual(splitShares(1000, { split: 'percent', paidBy: 1, values: { 1: 0, 2: 10000 } }), { 2: 1000 });
  assert.throws(() => splitShares(1000, { split: 'percent', paidBy: 1, values: { 1: 5000, 2: 4000 } }), /100%/);
});

test('splitShares: exact amounts must add up to the total', () => {
  assert.deepEqual(splitShares(5000, { split: 'exact', paidBy: 1, values: { 1: 1250, 2: 3750, 3: 0 } }), { 1: 1250, 2: 3750 });
  assert.throws(() => splitShares(5000, { split: 'exact', paidBy: 1, values: { 1: 1250 } }), /add up/);
});

test('simplifying beats everyone paying each other back directly', () => {
  // Three housemates each pay a shared bill, split three ways.
  // Paying back directly: every pair owes something, so 3 payments.
  // Netted: Jack is up $30, Jaime is even, Sam is down $30, so 1 payment.
  const expenses = [
    { paidBy: 1, amountCents: 9000, shares: { 1: 3000, 2: 3000, 3: 3000 } },
    { paidBy: 2, amountCents: 6000, shares: { 1: 2000, 2: 2000, 3: 2000 } },
    { paidBy: 3, amountCents: 3000, shares: { 1: 1000, 2: 1000, 3: 1000 } },
  ];
  assert.equal(pairwiseDebts(expenses).length, 3);
  assert.deepEqual(simplifyDebts(netBalances(expenses)), [{ fromUserId: 3, toUserId: 1, amountCents: 3000 }]);
});

test('simplifyDebts always clears everyone in at most n - 1 payments', () => {
  // Random ledgers: the payments must zero every balance, never outnumber
  // n - 1, and never be more than paying each other back directly.
  let seed = 42;
  const random = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
  for (let run = 0; run < 200; run++) {
    const people = 2 + random(6);
    const expenses = Array.from({ length: 1 + random(10) }, () => {
      const paidBy = 1 + random(people);
      const participants = Array.from({ length: people }, (_, i) => i + 1).filter(() => random(3) > 0);
      if (participants.length === 0) participants.push(paidBy);
      const amountCents = 1 + random(50000);
      return { paidBy, amountCents, shares: splitShares(amountCents, { split: 'equal', paidBy, participants }) };
    });
    const net = netBalances(expenses);
    const transfers = simplifyDebts(net);
    for (const t of transfers) {
      assert.ok(t.amountCents > 0);
      net[t.fromUserId] += t.amountCents;
      net[t.toUserId] -= t.amountCents;
    }
    assert.ok(Object.values(net).every((c) => c === 0), `run ${run} leaves balances`);
    assert.ok(transfers.length <= people - 1, `run ${run}: ${transfers.length} payments for ${people} people`);
    assert.ok(transfers.length <= pairwiseDebts(expenses).length, `run ${run} is worse than paying directly`);
  }
});
