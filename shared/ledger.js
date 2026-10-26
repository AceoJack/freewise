// Ledger rules shared by the server and the browser. Money is always integer cents.
// Expenses here look like { paidBy, amountCents, shares: { [userId]: cents } },
// where shares is each participant's portion of the cost (the payer's own included).

export const SPLITS = ['equal', 'full'];
export const MAX_AMOUNT_CENTS = 100_000_000; // $1,000,000
export const MAX_DESCRIPTION_LENGTH = 100;
export const MAX_NAME_LENGTH = 50;

// "12", "12.5", ".99", "$1,234.56" -> cents. Returns null unless it is a
// positive amount with at most two decimal places.
export function parseAmount(input) {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(input.trim().replace(/^\$/, '').replace(/,/g, ''));
  if (!match) return null;
  const cents = Number(match[1] || 0) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

// Works out each person's share of an expense.
//   equal: split between participants; leftover cents go to the payer first
//          (if they're a participant), then to participants in id order.
//   full:  owedBy owes the whole amount.
export function splitShares(amountCents, { split, paidBy, participants, owedBy }) {
  if (split === 'full') return { [owedBy]: amountCents };
  if (split !== 'equal') throw new Error(`Unknown split: ${split}`);

  const ids = [...new Set(participants)].sort((a, b) => a - b);
  if (ids.length === 0) throw new Error('An equal split needs at least one participant');
  const order = ids.includes(paidBy) ? [paidBy, ...ids.filter((id) => id !== paidBy)] : ids;
  const base = Math.floor(amountCents / ids.length);
  let leftover = amountCents - base * ids.length;
  const shares = {};
  for (const id of order) {
    shares[id] = base + (leftover > 0 ? 1 : 0);
    if (leftover > 0) leftover -= 1;
  }
  return shares;
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

// Turns net balances into a short list of payments that settles everyone:
// repeatedly match the biggest debtor with the biggest creditor.
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

// What one expense means for one person: positive = they lent that much,
// negative = they borrowed that much, 0 = not involved (or paid only for themselves).
export function expenseImpact(expense, userId) {
  const own = expense.shares[userId] ?? 0;
  return expense.paidBy === userId ? expense.amountCents - own : 0 - own; // 0 - own avoids -0
}
