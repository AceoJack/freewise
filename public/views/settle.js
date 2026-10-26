import { api } from '../api.js';
import { el } from '../dom.js';
import { paymentSentence, plural } from './components.js';
import { openSheet } from './sheet.js';

// Confirms and records a settle-up of the group ledger the user is looking at.
// onSettled runs after success; onConflict runs if the ledger changed meanwhile.
export function openSettleUp({ me, group, ledger, onSettled, onConflict }) {
  const people = Object.fromEntries(group.members.map((m) => [m.id, m]));
  const { transfers } = ledger;
  const question = transfers.length === 0
    ? 'Nobody owes anything. Clear the ledger?'
    : transfers.length === 1
      ? `Record that ${paymentSentence(transfers[0], people, me.id).replace(/^You paid/, 'you paid')}?`
      : 'Record these payments?';

  const formError = el('p', { class: 'error', role: 'alert', hidden: true });
  const confirmButton = el('button', { type: 'submit', class: 'primary' }, 'Settle up');

  const form = el('form', { onsubmit: settle },
    el('h2', { id: 'settle-title' }, 'Settle up'),
    el('p', { class: 'settle-question' }, question),
    transfers.length > 1 && el('ul', { class: 'payments' },
      transfers.map((t) => el('li', {}, paymentSentence(t, people, me.id)))),
    el('p', { class: 'muted' }, `${plural(ledger.expenses.length, 'expense')} will move to History and the ledger will start fresh.`),
    formError,
    el('div', { class: 'actions' },
      el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      confirmButton,
    ),
  );
  const dialog = openSheet('settle-title', form);

  async function settle(event) {
    event.preventDefault();
    formError.hidden = true;
    confirmButton.disabled = true;
    try {
      await api('POST', `/groups/${group.id}/settle`, { balanceToken: ledger.balanceToken });
      dialog.close();
      onSettled();
    } catch (err) {
      if (err.status === 401) return dialog.close();
      if (err.body?.error === 'ledger_changed' || err.body?.error === 'nothing_to_settle') {
        dialog.close();
        return onConflict(err.body.message);
      }
      formError.textContent = err.body?.message || "Couldn't settle up. Check your connection and try again.";
      formError.hidden = false;
    } finally {
      confirmButton.disabled = false;
    }
  }
}
