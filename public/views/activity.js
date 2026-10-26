import { expenseImpact } from '/shared/ledger.js';
import { api } from '../api.js';
import { el } from '../dom.js';
import { formatDateTime, formatMoney } from '../format.js';
import { avatar, loadError, nameOf, pageHeader, paymentSentence, plural } from './components.js';

// Activity tab: newest-first feed of what's happened in your groups.
export function mountActivity(root, session) {
  const me = session.me;
  const list = el('ul', { class: 'list feed' });
  const status = el('div', {}, el('p', { class: 'muted' }, 'Loading…'));
  root.replaceChildren(pageHeader('Activity'), list, status);

  async function load(before = null) {
    try {
      const page = await api('GET', `/activity${before ? `?before=${before}` : ''}`);
      const items = page.items.map((a) => el('li', {}, activityItem(a, page.people, me)));
      if (before) list.append(...items);
      else list.replaceChildren(...items);

      list.hidden = list.children.length === 0;
      status.replaceChildren(
        list.children.length === 0
          ? el('p', { class: 'empty muted' }, 'Nothing yet. When you or your friends add expenses, they show up here.')
          : page.nextBefore
            ? el('button', { class: 'load-more', onclick: () => load(page.nextBefore) }, 'Show older activity')
            : '',
      );
    } catch (err) {
      if (err.status !== 401) status.replaceChildren(loadError("Couldn't load activity.", () => load(before)));
    }
  }

  load();
  return () => load();
}

function activityItem(a, people, me) {
  const actor = nameOf(people, a.actorId, me.id);
  const target = nameOf(people, a.targetUserId, me.id);
  const d = a.data;
  let text;
  let impact = null;

  switch (a.type) {
    case 'expense_added':
    case 'expense_updated':
    case 'expense_deleted': {
      const verb = { expense_added: 'added', expense_updated: 'updated', expense_deleted: 'deleted' }[a.type];
      text = `${actor} ${verb} “${d.description}” ${a.type === 'expense_deleted' ? 'from' : 'in'} ${a.groupName}.`;
      const cents = expenseImpact(d, me.id);
      impact = a.type === 'expense_deleted'
        ? el('span', { class: 'muted' }, `${formatMoney(d.amountCents)} · no longer counts`)
        : cents > 0
          ? el('span', { class: 'positive' }, `You get back ${formatMoney(cents)}`)
          : cents < 0
            ? el('span', { class: 'negative' }, `You owe ${formatMoney(-cents)}`)
            : el('span', { class: 'muted' }, d.paidBy === me.id ? `You paid ${formatMoney(d.amountCents)} for yourself` : "You're not involved");
      break;
    }
    case 'settled': {
      text = `${actor} settled up ${a.groupName}.`;
      const mine = d.payments.filter((p) => p.fromUserId === me.id || p.toUserId === me.id);
      impact = el('span', { class: 'muted' }, mine.length
        ? mine.map((p) => paymentSentence(p, people, me.id)).join(' · ')
        : d.payments.length ? plural(d.payments.length, 'payment') + ' recorded' : 'Nobody owed anything');
      break;
    }
    case 'group_created':
      text = `${actor} created the group “${d.name}”.`;
      break;
    case 'group_renamed':
      text = `${actor} renamed “${d.from}” to “${d.to}”.`;
      break;
    case 'group_deleted':
      text = `${actor} deleted the group “${d.name}”.`;
      break;
    case 'member_added':
      text = `${actor} added ${target === 'You' ? 'you' : target} to ${a.groupName}.`;
      break;
    case 'member_removed':
      text = `${actor} removed ${target === 'You' ? 'you' : target} from ${a.groupName}.`;
      break;
    case 'member_left':
      text = `${actor} left ${a.groupName}.`;
      break;
    case 'friend_added':
      text = a.actorId === me.id ? `You added ${target} as a friend.` : `${actor} added you as a friend.`;
      break;
    default:
      text = `${actor} did something.`;
  }

  const content = [
    avatar(people[a.actorId] ?? { id: a.actorId, name: actor }, 36),
    el('span', { class: 'main' },
      el('span', { class: 'feed-text' }, text),
      impact && el('span', { class: 'feed-impact' }, impact),
      el('span', { class: 'detail muted' }, formatDateTime(a.createdAt)),
    ),
  ];
  return a.canOpen
    ? el('a', { class: 'row feed-item', href: `#/groups/${a.groupId}` }, content)
    : el('div', { class: 'row feed-item' }, content);
}
