import { api } from '../api.js';
import { el } from '../dom.js';
import { formatMoney } from '../format.js';
import { expenseList, joinNames, loadError, pageHeader, svg, transferSentence } from './components.js';
import { openExpenseForm } from './expense-form.js';
import { openSettleUp } from './settle.js';
import { openSheet } from './sheet.js';

// A group's page: who's in it, the balances and its current ledger.
// Returns a function that reloads it.
export function mountGroup(root, session, groupId) {
  const me = session.me;
  const header = el('div', {}, pageHeader('', { back: { href: '#/groups', label: 'Groups' } }));
  const notice = el('p', { class: 'notice', role: 'status', hidden: true });
  const balance = el('section', { class: 'balance card' }, el('p', { class: 'muted' }, 'Loading…'));
  const list = el('section', {});
  const fab = el('button', { class: 'fab primary', hidden: true }, '+ Add expense');
  root.replaceChildren(header, notice, balance, list, fab);

  let current = null;
  fab.addEventListener('click', () => current && openExpenseForm({ me, group: current.group, onSaved: load }));

  function showNotice(message, kind = 'info') {
    notice.textContent = message;
    notice.className = `notice ${kind}`;
    notice.hidden = false;
  }

  async function load() {
    try {
      current = await api('GET', `/groups/${groupId}`);
    } catch (err) {
      if (err.status === 401) return;
      fab.hidden = true;
      balance.hidden = true;
      return list.replaceChildren(err.status === 404
        ? el('p', { class: 'empty muted' }, "That group doesn't exist, or you're not in it.")
        : loadError("Couldn't load this group.", load));
    }

    const { group, ledger } = current;
    const people = Object.fromEntries(group.members.map((m) => [m.id, m]));
    const others = group.members.filter((m) => m.id !== me.id).map((m) => m.name);

    header.replaceChildren(
      pageHeader(group.name, {
        back: { href: '#/groups', label: 'Groups' },
        action: el('span', { class: 'header-actions' },
          el('a', { class: 'link', href: `#/groups/${group.id}/history` }, 'History'),
          el('a', { class: 'icon-button', href: `#/groups/${group.id}/settings`, 'aria-label': 'Group settings', title: 'Group settings' },
            svg(GEAR))),
      }),
      el('p', { class: 'subtitle muted' },
        others.length ? `With ${joinNames(others)} · ` : 'Just you so far · ',
        el('button', { class: 'inline-link', onclick: () => openAddMember(group) }, 'Add people'),
      ),
    );

    balance.hidden = false;
    balance.replaceChildren(...balanceView(ledger, people));
    list.replaceChildren(...(ledger.expenses.length
      ? expenseList(ledger.expenses, {
        people, meId: me.id, memberCount: group.members.length,
        onSelect: (expense) => openExpenseForm({ me, group, expense, onSaved: load }),
      })
      : [el('p', { class: 'empty muted' }, 'No expenses yet. Tap “Add expense” to record one.')]));
    fab.hidden = false;
  }

  function balanceView(ledger, people) {
    const mine = ledger.transfers.filter((t) => t.fromUserId === me.id || t.toUserId === me.id);
    const theirs = ledger.transfers.filter((t) => !mine.includes(t));
    const myNet = ledger.balances[me.id] ?? 0;

    const headline = myNet === 0
      ? [el('p', { class: 'balance-label muted' }, ledger.expenses.length ? 'You’re all square' : 'All settled up'),
        el('p', { class: 'balance-amount' }, formatMoney(0))]
      : [el('p', { class: 'balance-label' }, myNet > 0 ? 'You are owed' : 'You owe'),
        el('p', { class: `balance-amount ${myNet > 0 ? 'positive' : 'negative'}` }, formatMoney(Math.abs(myNet)))];

    return [
      ...headline,
      mine.length > 0 && el('ul', { class: 'transfers' }, mine.map((t) => el('li', {}, transferSentence(t, people, me.id)))),
      theirs.length > 0 && el('ul', { class: 'transfers muted' }, theirs.map((t) => el('li', {}, transferSentence(t, people, me.id)))),
      ledger.expenses.length > 0 && el('button', { class: 'settle', onclick: () => settle() }, 'Settle up'),
    ].filter(Boolean);
  }

  function settle() {
    notice.hidden = true;
    openSettleUp({
      me,
      group: current.group,
      ledger: current.ledger,
      onSettled: () => {
        showNotice('Settled up. Those expenses are now in History.');
        load();
      },
      onConflict: (message) => {
        showNotice(message, 'warning');
        load();
      },
    });
  }

  async function openAddMember(group) {
    let friends;
    try {
      friends = await api('GET', '/friends');
    } catch {
      return;
    }
    const inGroup = new Set(group.members.map((m) => m.id));
    const candidates = friends.filter((f) => !inGroup.has(f.id));
    const formError = el('p', { class: 'error', role: 'alert', hidden: true });

    const add = async (friend, button) => {
      button.disabled = true;
      try {
        await api('POST', `/groups/${group.id}/members`, { userId: friend.id });
        button.textContent = 'Added';
        load();
      } catch (err) {
        button.disabled = false;
        formError.textContent = err.body?.message || "Couldn't add them. Check your connection and try again.";
        formError.hidden = false;
      }
    };

    const content = el('div', { class: 'sheet-body' },
      el('h2', { id: 'add-member-title' }, `Add people to ${group.name}`),
      candidates.length
        ? el('ul', { class: 'list' }, candidates.map((f) => {
          const button = el('button', { class: 'small' }, 'Add');
          button.addEventListener('click', () => add(f, button));
          return el('li', {}, el('div', { class: 'row' },
            el('span', { class: 'main' }, el('span', { class: 'title' }, f.name), el('span', { class: 'detail muted' }, f.email)),
            el('span', { class: 'row-end' }, button)));
        }))
        : el('p', { class: 'muted' }, 'All your friends are already in this group. Add more friends in the Friends tab first.'),
      formError,
      el('div', { class: 'actions single' }, el('button', { type: 'button', onclick: () => dialog.close() }, 'Done')),
    );
    const dialog = openSheet('add-member-title', content);
  }

  load();
  return load;
}

const GEAR = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>';
