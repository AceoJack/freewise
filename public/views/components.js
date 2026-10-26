import { expenseImpact } from '/shared/ledger.js';
import { el } from '../dom.js';
import { dayParts, formatMoney, formatMonthYear } from '../format.js';

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// "You" for the signed-in user, otherwise the person's name.
export const nameOf = (people, id, meId) => (id === meId ? 'You' : people[id]?.name ?? 'Someone');

// "Jack", "Jack & Jaime", "Jack, Jaime & Sam"
export function joinNames(names) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;
}

// Screen title with an optional back link and an optional action on the right.
export function pageHeader(title, { back, action } = {}) {
  return el('header', { class: 'page-header' },
    back && el('a', { class: 'back', href: back.href }, `‹ ${back.label}`),
    el('div', { class: 'page-title-row' }, el('h1', {}, title), action),
  );
}

// Round "+" button for page headers.
export function addButton(label, onclick) {
  return el('button', { class: 'icon-button', 'aria-label': label, title: label, onclick },
    svg('<path d="M12 5v14M5 12h14"/>'));
}

// Profile picture, or a coloured circle with the person's initial.
export function avatar(person, size = 40) {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`;
  if (person?.pictureUrl) {
    return el('img', { class: 'avatar', src: person.pictureUrl, alt: '', referrerpolicy: 'no-referrer', style });
  }
  const hue = ((person?.id ?? 0) * 67) % 360;
  return el('span', { class: 'avatar', 'aria-hidden': 'true', style: `${style};--hue:${hue}` },
    (person?.name ?? '?').trim().charAt(0).toUpperCase());
}

// "Jaime owes you $15.00" / "You owe Jack $10.00" / "Sam owes Jack $40.00"
export function transferSentence(t, people, meId) {
  const amount = formatMoney(t.amountCents);
  if (t.toUserId === meId) return `${people[t.fromUserId]?.name ?? 'Someone'} owes you ${amount}`;
  if (t.fromUserId === meId) return `You owe ${people[t.toUserId]?.name ?? 'someone'} ${amount}`;
  return `${people[t.fromUserId]?.name} owes ${people[t.toUserId]?.name} ${amount}`;
}

// "Jaime paid you $15.00" for a settle-up payment.
export function paymentSentence(p, people, meId) {
  const amount = formatMoney(p.amountCents);
  if (p.toUserId === meId) return `${people[p.fromUserId]?.name ?? 'Someone'} paid you ${amount}`;
  if (p.fromUserId === meId) return `You paid ${people[p.toUserId]?.name ?? 'someone'} ${amount}`;
  return `${people[p.fromUserId]?.name} paid ${people[p.toUserId]?.name} ${amount}`;
}

// A balance as a short coloured phrase: "you are owed $5.00" / "you owe $5.00" / "settled up".
export function balancePhrase(cents) {
  if (cents > 0) return el('span', { class: 'positive' }, `you are owed ${formatMoney(cents)}`);
  if (cents < 0) return el('span', { class: 'negative' }, `you owe ${formatMoney(-cents)}`);
  return el('span', { class: 'muted' }, 'settled up');
}

// How an expense was split, for the row underneath its description.
export function splitSummary(e, people, meId, memberCount) {
  const ids = Object.keys(e.shares).map(Number);
  if (e.split === 'full') return `owed by ${nameOf(people, ids[0], meId).replace(/^You$/, 'you')}`;
  if (e.split === 'percent') return 'split by percentage';
  if (e.split === 'exact') return 'split by exact amounts';
  return ids.length === memberCount ? 'split equally' : `split ${ids.length} ways`;
}

// Expenses grouped under month headings. Pass onSelect to make rows tappable.
export function expenseList(expenses, { people, meId, memberCount, onSelect }) {
  const groups = new Map();
  for (const e of expenses) {
    const month = e.spentOn.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(e);
  }
  return [...groups.values()].map((items) => el('div', { class: 'month' },
    el('h2', { class: 'section-heading' }, formatMonthYear(items[0].spentOn)),
    el('ul', { class: 'list' }, items.map((e) => el('li', {}, expenseRow(e, { people, meId, memberCount, onSelect })))),
  ));
}

function expenseRow(e, { people, meId, memberCount, onSelect }) {
  const impact = expenseImpact(e, meId);
  const { day, month } = dayParts(e.spentOn);
  const share = impact === 0
    ? el('span', { class: 'share muted' }, el('span', { class: 'share-label' }, e.paidBy === meId ? 'no balance' : 'not involved'))
    : el('span', { class: `share ${impact > 0 ? 'positive' : 'negative'}` },
      el('span', { class: 'share-label' }, impact > 0 ? 'you lent' : 'you borrowed'),
      el('span', { class: 'share-amount' }, formatMoney(Math.abs(impact))),
    );

  const children = [
    el('span', { class: 'date muted' }, el('span', { class: 'date-month' }, month), el('span', { class: 'date-day' }, day)),
    el('span', { class: 'main' },
      el('span', { class: 'title' }, e.description),
      el('span', { class: 'detail muted' },
        `${nameOf(people, e.paidBy, meId)} paid ${formatMoney(e.amountCents)} · ${splitSummary(e, people, meId, memberCount)}`),
    ),
    share,
  ];
  return onSelect
    ? el('button', { type: 'button', class: 'row expense', onclick: () => onSelect(e) }, children)
    : el('div', { class: 'row expense' }, children);
}

export function loadError(message, retry) {
  return el('div', { class: 'error' }, el('p', {}, message), el('button', { onclick: retry }, 'Try again'));
}

// Inline SVG icon drawn with the current text colour.
export function svg(paths) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', '0 0 24 24');
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('class', 'icon');
  node.innerHTML = paths;
  return node;
}
