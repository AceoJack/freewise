// Ledger rules shared by the server and the browser. Money is always integer cents.
// Expenses here look like { paidBy, amountCents, shares: { [userId]: cents } },
// where shares is each participant's portion of the cost (the payer's own included).

export const SPLITS = ['equal', 'full', 'percent', 'exact'];
export const MAX_AMOUNT_CENTS = 100_000_000; // $1,000,000
export const MAX_DESCRIPTION_LENGTH = 100;
export const MAX_NAME_LENGTH = 50;
// Percentages are kept in hundredths of a percent: 33.33% is 3333.
export const FULL_PERCENT = 10_000;

// "12", "12.5", ".99", "$1,234.56" -> cents. Returns null unless it is a
// positive amount with at most two decimal places.
export function parseAmount(input) {
  const cents = toCents(input);
  return cents > 0 ? cents : null;
}

// Like parseAmount, but blank and zero are allowed (both mean 0). Used for
// each person's part of an exact split.
export function parseCents(input) {
  return isBlank(input) ? 0 : toCents(input);
}

// "25", "33.33", "12.5%" -> hundredths of a percent; blank means 0.
// Returns null unless it is between 0 and 100 with at most two decimals.
export function parsePercent(input) {
  if (isBlank(input)) return 0;
  const match = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(String(input).trim().replace(/%$/, ''));
  if (!match) return null;
  const value = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return value <= FULL_PERCENT ? value : null;
}

// 3333 -> "33.33%", 5000 -> "50%"
export function formatPercent(value) {
  return `${Number((value / 100).toFixed(2))}%`;
}

// Works out each person's share of an expense.
//   equal:   split between participants
//   full:    owedBy owes the whole amount
//   percent: values maps each person to hundredths of a percent; must total 100%
//   exact:   values maps each person to cents; must total the amount
// When cents don't divide evenly, the leftover cents go to the payer first (if
// they're taking part), then to the others in id order.
export function splitShares(amountCents, { split, paidBy, participants, owedBy, values }) {
  if (split === 'full') return { [owedBy]: amountCents };

  if (split === 'equal') {
    const ids = sortedIds(participants);
    if (ids.length === 0) throw new Error('An equal split needs at least one participant');
    const base = Math.floor(amountCents / ids.length);
    return withLeftover(Object.fromEntries(ids.map((id) => [id, base])), amountCents, paidBy);
  }

  const parts = Object.fromEntries(Object.entries(values ?? {}).filter(([, v]) => v > 0));
  if (split === 'exact') {
    if (total(parts) !== amountCents) throw new Error('Exact amounts must add up to the total');
    return parts;
  }
  if (split === 'percent') {
    if (total(parts) !== FULL_PERCENT) throw new Error('Percentages must add up to 100%');
    const shares = Object.fromEntries(Object.entries(parts)
      .map(([id, pct]) => [id, Math.floor((amountCents * pct) / FULL_PERCENT)]));
    return withLeftover(shares, amountCents, paidBy);
  }
  throw new Error(`Unknown split: ${split}`);
}

// Each person's net position: what they paid minus their shares.
// Positive means they are owed money, negative means they owe.
export function netBalances(expenses) {
  const net = {};
  for (const e of expenses) {
    net[e.paidBy] = (net[e.paidBy] ?? 0) + e.amountCents;
    for (const [id, cents] of Object.entries(e.shares)) net[id] = (net[id] ?? 0) - cents;
  }
  return net;
}

// Settles a group with as few payments as practical (greedy on net balances):
// work out what each person is up or down overall, then repeatedly have the
// person who owes the most pay the person who is owed the most. Each payment
// clears at least one person, so n people never need more than n - 1 payments.
export function simplifyDebts(net) {
  const debtors = [];
  const creditors = [];
  for (const [id, cents] of Object.entries(net)) {
    if (cents < 0) debtors.push({ id: Number(id), cents: -cents });
    if (cents > 0) creditors.push({ id: Number(id), cents });
  }
  const biggestFirst = (a, b) => b.cents - a.cents || a.id - b.id;
  const transfers = [];
  while (debtors.length && creditors.length) {
    debtors.sort(biggestFirst);
    creditors.sort(biggestFirst);
    const [debtor, creditor] = [debtors[0], creditors[0]];
    const amountCents = Math.min(debtor.cents, creditor.cents);
    transfers.push({ fromUserId: debtor.id, toUserId: creditor.id, amountCents });
    debtor.cents -= amountCents;
    creditor.cents -= amountCents;
    if (debtor.cents === 0) debtors.shift();
    if (creditor.cents === 0) creditors.shift();
  }
  return transfers;
}

// What everyone would pay if each person paid back every payer directly
// (netted per pair of people). Used for friend balances, and to show how many
// payments simplifyDebts saves.
export function pairwiseDebts(expenses) {
  const debts = {}; // "a:b" with a < b -> positive if a owes b
  for (const e of expenses) {
    for (const [key, cents] of Object.entries(e.shares)) {
      const id = Number(key);
      if (id === e.paidBy || cents === 0) continue;
      const [a, b, sign] = id < e.paidBy ? [id, e.paidBy, 1] : [e.paidBy, id, -1];
      debts[`${a}:${b}`] = (debts[`${a}:${b}`] ?? 0) + sign * cents;
    }
  }
  return Object.entries(debts).filter(([, c]) => c !== 0).map(([pair, c]) => {
    const [a, b] = pair.split(':').map(Number);
    return c > 0 ? { fromUserId: a, toUserId: b, amountCents: c } : { fromUserId: b, toUserId: a, amountCents: -c };
  });
}

// What one expense means for one person: positive = they lent that much,
// negative = they borrowed that much, 0 = not involved (or paid only for themselves).
export function expenseImpact(expense, userId) {
  const own = expense.shares[userId] ?? 0;
  return expense.paidBy === userId ? expense.amountCents - own : 0 - own; // 0 - own avoids -0
}

function toCents(input) {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(input.trim().replace(/^\$/, '').replace(/,/g, ''));
  if (!match || (!match[1] && !match[2])) return null;
  const cents = Number(match[1] || 0) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return cents <= MAX_AMOUNT_CENTS ? cents : null;
}

function isBlank(input) {
  return input == null || (typeof input === 'string' && input.trim() === '');
}

function sortedIds(ids) {
  return [...new Set(ids)].map(Number).sort((a, b) => a - b);
}

function total(map) {
  return Object.values(map).reduce((sum, v) => sum + v, 0);
}

// Hands out the cents lost to rounding down, one each: payer first, then by id.
function withLeftover(shares, amountCents, paidBy) {
  const ids = sortedIds(Object.keys(shares));
  const order = ids.includes(paidBy) ? [paidBy, ...ids.filter((id) => id !== paidBy)] : ids;
  let leftover = amountCents - total(shares);
  for (let i = 0; leftover > 0; i = (i + 1) % order.length, leftover--) shares[order[i]] += 1;
  return shares;
}
