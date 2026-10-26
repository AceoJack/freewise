import { api } from '../api.js';
import { el } from '../dom.js';
import { formatMoney, formatTimestamp } from '../format.js';
import { expenseList, loadError, pageHeader, paymentSentence, plural } from './components.js';

// A group's past settle-ups, newest first. Returns a function that reloads it.
export function mountGroupHistory(root, session, groupId) {
  const me = session.me;
  const header = el('div', {}, pageHeader('History', { back: { href: `#/groups/${groupId}`, label: 'Group' } }));
  const list = el('section', {}, el('p', { class: 'muted' }, 'Loading…'));
  root.replaceChildren(header, list);

  async function load() {
    try {
      const { group, settlements } = await api('GET', `/groups/${groupId}/history`);
      const people = Object.fromEntries(group.members.map((m) => [m.id, m]));
      header.replaceChildren(pageHeader('History', { back: { href: `#/groups/${groupId}`, label: group.name } }));
      list.replaceChildren(settlements.length
        ? el('ul', { class: 'list' }, settlements.map((s) => el('li', {},
          el('a', { class: 'row stacked', href: `#/settlements/${s.id}` },
            el('span', { class: 'title' }, summary(s.payments, people, me.id)),
            el('span', { class: 'detail muted' },
              `${formatTimestamp(s.createdAt)} · ${plural(s.expenseCount, 'expense')} · ${formatMoney(s.totalCents)} spent`),
          ),
        )))
        : el('p', { class: 'empty muted' }, 'Nothing settled yet. When you settle up, the expenses move here.'));
    } catch (err) {
      if (err.status === 401) return;
      list.replaceChildren(err.status === 404
        ? el('p', { class: 'empty muted' }, "That group doesn't exist, or you're not in it.")
        : loadError("Couldn't load history.", load));
    }
  }

  load();
  return load;
}

// One settle-up: the payments it recorded and the expenses it covered (read-only).
export function mountSettlement(root, session, id) {
  const me = session.me;
  const body = el('section', {}, el('p', { class: 'muted' }, 'Loading…'));
  root.replaceChildren(body);

  async function load() {
    try {
      const { settlement: s, people, memberCount } = await api('GET', `/settlements/${id}`);
      const recordedBy = s.createdBy === me.id ? 'you' : people[s.createdBy]?.name;
      body.replaceChildren(
        pageHeader('Settle-up', { back: { href: `#/groups/${s.groupId}/history`, label: 'History' } }),
        el('div', { class: 'card settlement-summary' },
          s.payments.length
            ? el('ul', { class: 'transfers' }, s.payments.map((p) => el('li', {}, paymentSentence(p, people, me.id))))
            : el('p', {}, 'Cleared with nothing owed'),
          el('p', { class: 'muted' }, `${s.groupName} · settled ${formatTimestamp(s.createdAt)} by ${recordedBy}`),
        ),
        ...expenseList(s.expenses, { people, meId: me.id, memberCount }),
      );
    } catch (err) {
      if (err.status === 401) return;
      body.replaceChildren(err.status === 404
        ? el('p', { class: 'empty muted' }, "That settle-up doesn't exist.")
        : loadError("Couldn't load this settle-up.", load));
    }
  }

  load();
  return load;
}

function summary(payments, people, meId) {
  if (payments.length === 0) return 'Cleared with nothing owed';
  const mine = payments.find((p) => p.fromUserId === meId || p.toUserId === meId);
  const first = paymentSentence(mine ?? payments[0], people, meId);
  return payments.length === 1 ? first : `${first} + ${plural(payments.length - 1, 'other payment')}`;
}
