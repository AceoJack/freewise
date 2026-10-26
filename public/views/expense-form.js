import {
  FULL_PERCENT, MAX_DESCRIPTION_LENGTH, expenseImpact, formatPercent, parseAmount, parseCents, parsePercent, splitShares,
} from '/shared/ledger.js';
import { api } from '../api.js';
import { el } from '../dom.js';
import { formatMoney, todayLocal } from '../format.js';
import { openSheet } from './sheet.js';

// Opens the add/edit expense sheet for a group. Pass an existing expense to
// edit or delete it. Calls onSaved after any change is stored.
//
// Two-person groups get the single "Paid by you, split equally" dropdown, with
// percentage and exact-amount splits as extra choices. Bigger groups pick who
// paid and how to split separately, and can untick people who weren't part of
// an equal split.
export function openExpenseForm({ me, group, expense = null, onSaved }) {
  const editing = expense !== null;
  const members = [...group.members].sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : 0));
  const label = (m) => (m.id === me.id ? 'You' : m.name);
  const nameById = Object.fromEntries(members.map((m) => [m.id, m.name]));

  // What the form currently says about who paid and who owes. values holds what
  // was typed for each person in a percentage or exact split.
  const state = editing
    ? {
      paidBy: expense.paidBy,
      split: expense.split,
      owedBy: expense.split === 'full' ? Number(Object.keys(expense.shares)[0]) : null,
      participants: new Set(Object.keys(expense.shares).map(Number)),
      values: { percent: {}, exact: {}, [expense.split]: typedValues(expense) },
    }
    : {
      paidBy: me.id, split: 'equal', owedBy: null, participants: new Set(members.map((m) => m.id)),
      values: { percent: {}, exact: {} },
    };

  const description = el('input', {
    id: 'expense-description', type: 'text', maxlength: MAX_DESCRIPTION_LENGTH, autocomplete: 'off',
    autocapitalize: 'sentences', enterkeyhint: 'next', placeholder: 'e.g. Groceries', value: expense?.description,
  });
  const amount = el('input', {
    id: 'expense-amount', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00', enterkeyhint: 'done',
    value: editing ? (expense.amountCents / 100).toFixed(2) : null,
  });
  const spentOn = el('input', { id: 'expense-date', type: 'date', value: expense?.spentOn ?? todayLocal() });
  const preview = el('p', { class: 'preview muted', 'aria-live': 'polite' });
  const formError = el('p', { class: 'error', role: 'alert', hidden: true });
  const saveButton = el('button', { type: 'submit', class: 'primary' }, editing ? 'Save changes' : 'Save');

  // Server errors name a field; map each to the control that sets it.
  const fieldErrors = {};
  const field = (labelText, input, names, wrapper) => {
    const error = el('p', { class: 'field-error', hidden: true });
    for (const name of names) fieldErrors[name] = { error, input };
    return el('div', { class: 'field' }, labelText && el('label', { for: input.id }, labelText), wrapper ?? input, error);
  };

  const paidBy = el('select', { id: 'expense-paid-by' }, members.map((m) => el('option', { value: m.id }, label(m))));
  paidBy.value = String(state.paidBy);
  const paidByField = field('Paid by', paidBy, ['paidBy']);
  const percentInputs = splitValuesField('percent');
  const exactInputs = splitValuesField('exact');

  const splitFields = members.length === 2 ? twoPersonSplit() : groupSplit();

  const form = el('form', { novalidate: true, onsubmit: save },
    // When editing, start focus on the heading so the browser doesn't focus the
    // first input and pop up the keyboard.
    el('h2', { id: 'expense-title', tabindex: editing ? '-1' : null, autofocus: editing }, editing ? 'Edit expense' : 'Add expense'),
    field('Description', description, ['description']),
    field('Amount', amount, ['amount'], el('div', { class: 'amount-input' }, el('span', { 'aria-hidden': 'true' }, '$'), amount)),
    ...splitFields,
    percentInputs.field,
    exactInputs.field,
    field('Date', spentOn, ['spentOn']),
    preview,
    formError,
    el('div', { class: 'actions' },
      el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      saveButton,
    ),
    editing && el('button', { type: 'button', class: 'danger-link', onclick: remove }, 'Delete expense'),
  );

  amount.addEventListener('input', updatePreview);
  // A field's error goes away once it's edited, so it can't contradict the live totals.
  form.addEventListener('input', (event) => {
    const error = event.target.closest('.field')?.querySelector(':scope > .field-error');
    if (error) error.hidden = true;
  });
  showSplitInputs();

  const dialog = openSheet('expense-title', form);
  if (!editing) description.focus();

  // One dropdown with the four common combinations, as in the original design,
  // plus percentage and exact splits, which also show who paid.
  function twoPersonSplit() {
    const other = members.find((m) => m.id !== me.id);
    const options = [
      { paidBy: me.id, split: 'equal', text: 'Paid by you, split equally' },
      { paidBy: me.id, split: 'full', owedBy: other.id, text: `Paid by you, ${other.name} owes the full amount` },
      { paidBy: other.id, split: 'equal', text: `Paid by ${other.name}, split equally` },
      { paidBy: other.id, split: 'full', owedBy: me.id, text: `Paid by ${other.name}, you owe the full amount` },
      { split: 'percent', text: 'Split by percentages…' },
      { split: 'exact', text: 'Split by exact amounts…' },
    ];
    const select = el('select', { id: 'expense-split' }, options.map((o, i) => el('option', { value: i }, o.text)));
    select.value = String(Math.max(0, options.findIndex((o) => o.split === state.split && (!o.paidBy || o.paidBy === state.paidBy))));
    const apply = () => {
      const o = options[select.value];
      Object.assign(state, { split: o.split, owedBy: o.owedBy ?? null, participants: new Set(members.map((m) => m.id)) });
      if (o.paidBy) state.paidBy = o.paidBy;
      paidBy.value = String(state.paidBy);
      paidByField.hidden = !['percent', 'exact'].includes(o.split);
      showSplitInputs();
    };
    select.addEventListener('change', apply);
    paidBy.addEventListener('change', () => {
      state.paidBy = Number(paidBy.value);
      updatePreview();
    });
    apply();
    return [field('Split', select, ['split', 'owedBy', 'participants']), paidByField];
  }

  // Separate "paid by" and "split" pickers, plus who's in an equal split.
  function groupSplit() {
    const split = el('select', { id: 'expense-split' });
    const checkboxes = members.map((m) => el('input', {
      type: 'checkbox', id: `expense-participant-${m.id}`, value: m.id, checked: state.participants.has(m.id),
    }));
    const participants = el('fieldset', { class: 'participants', id: 'expense-participants' },
      el('legend', {}, 'Split between'),
      members.map((m, i) => el('label', { class: 'check' }, checkboxes[i], el('span', {}, label(m)))),
    );
    const participantsField = field('', checkboxes[0], ['participants'], participants);

    const fillSplitOptions = () => {
      const owers = members.filter((m) => m.id !== state.paidBy);
      split.replaceChildren(
        el('option', { value: 'equal' }, 'Split equally'),
        el('option', { value: 'percent' }, 'Split by percentages'),
        el('option', { value: 'exact' }, 'Split by exact amounts'),
        ...owers.map((m) => el('option', { value: `full:${m.id}` }, m.id === me.id ? 'You owe the full amount' : `${m.name} owes the full amount`)),
      );
      const wanted = state.split === 'full' ? `full:${state.owedBy}` : state.split;
      split.value = [...split.options].some((o) => o.value === wanted) ? wanted : 'equal';
    };
    const readSplit = () => {
      const [kind, id] = split.value.split(':');
      state.split = kind;
      state.owedBy = id ? Number(id) : null;
    };
    const apply = () => {
      // Remember the chosen split before the options are rebuilt for the payer;
      // it falls back to "equally" if the payer was the one who owed in full.
      if (split.value) readSplit();
      state.paidBy = Number(paidBy.value);
      fillSplitOptions();
      readSplit();
      state.participants = new Set(checkboxes.filter((c) => c.checked).map((c) => Number(c.value)));
      participantsField.hidden = state.split !== 'equal';
      showSplitInputs();
    };
    paidBy.addEventListener('change', apply);
    split.addEventListener('change', apply);
    for (const c of checkboxes) c.addEventListener('change', apply);
    apply();

    return [paidByField, field('Split', split, ['split', 'owedBy']), participantsField];
  }

  // A box per person for their percentage or dollar amount, with a running
  // "left to assign" line underneath.
  function splitValuesField(kind) {
    const percent = kind === 'percent';
    const total = el('p', { class: 'split-total', 'aria-live': 'polite' });
    const rows = members.map((m) => {
      const input = el('input', {
        type: 'text', id: `expense-${kind}-${m.id}`, inputmode: 'decimal', autocomplete: 'off', placeholder: percent ? '0' : '0.00',
        'aria-label': `${label(m)}${percent ? ' (percent)' : ' (dollars)'}`, value: state.values[kind][m.id] ?? null,
      });
      input.addEventListener('input', () => {
        state.values[kind][m.id] = input.value;
        updatePreview();
      });
      const share = el('span', { class: 'split-share muted' });
      const box = el('div', { class: `split-input ${kind}` },
        !percent && el('span', { 'aria-hidden': 'true' }, '$'), input, percent && el('span', { 'aria-hidden': 'true' }, '%'));
      return { id: m.id, input, share, row: el('div', { class: 'split-row' }, el('span', { class: 'split-name' }, label(m)), share, box) };
    });
    const fieldset = el('fieldset', { class: 'participants split-values' },
      el('legend', {}, percent ? 'Percentages' : 'Amounts'), rows.map((r) => r.row), total);
    return { kind, rows, total, field: field('', rows[0].input, [percent ? 'percents' : 'amounts'], fieldset) };
  }

  function showSplitInputs() {
    percentInputs.field.hidden = state.split !== 'percent';
    exactInputs.field.hidden = state.split !== 'exact';
    updatePreview();
  }

  // Parses what's typed for the current percentage or exact split:
  // { values, total } in hundredths of a percent or cents, or null if a box is invalid.
  function typedSplitValues() {
    const values = {};
    for (const m of members) {
      const raw = state.values[state.split][m.id];
      const value = state.split === 'percent' ? parsePercent(raw) : parseCents(raw);
      if (value === null) return null;
      if (value > 0) values[m.id] = value;
    }
    return { values, total: Object.values(values).reduce((a, b) => a + b, 0) };
  }

  // Updates the per-person dollar amounts and the "left to assign" line.
  function updateSplitValues(cents) {
    const inputs = state.split === 'percent' ? percentInputs : state.split === 'exact' ? exactInputs : null;
    if (!inputs) return;
    const typed = typedSplitValues();
    const target = state.split === 'percent' ? FULL_PERCENT : cents;
    const show = (n) => (state.split === 'percent' ? formatPercent(n) : formatMoney(n));

    let message;
    let done = false;
    if (!typed) message = state.split === 'percent' ? 'Enter percentages like 25 or 33.33.' : 'Enter amounts like 12.50.';
    else if (target === null) message = `${formatMoney(typed.total)} assigned. Enter the total above.`;
    else if (typed.total < target) message = `${show(target - typed.total)} left to assign`;
    else if (typed.total > target) message = `${show(typed.total - target)} too much`;
    else [message, done] = [state.split === 'percent' ? 'Adds up to 100%' : `Adds up to ${formatMoney(cents)}`, true];
    inputs.total.textContent = message;
    inputs.total.classList.toggle('done', done);

    // For percentages, show what each person's share comes to once it adds up.
    const shares = done && cents !== null ? currentShares(cents) : null;
    for (const r of inputs.rows) r.share.textContent = state.split === 'percent' && shares?.[r.id] ? formatMoney(shares[r.id]) : '';
  }

  function currentShares(cents) {
    if (state.split === 'full') return state.owedBy ? splitShares(cents, { split: 'full', owedBy: state.owedBy }) : null;
    if (state.split === 'percent' || state.split === 'exact') {
      const typed = typedSplitValues();
      const target = state.split === 'percent' ? FULL_PERCENT : cents;
      return typed && typed.total === target
        ? splitShares(cents, { split: state.split, paidBy: state.paidBy, values: typed.values }) : null;
    }
    if (state.participants.size === 0) return null;
    return splitShares(cents, { split: 'equal', paidBy: state.paidBy, participants: [...state.participants] });
  }

  function updatePreview() {
    const cents = parseAmount(amount.value);
    updateSplitValues(cents);
    const shares = cents === null ? null : currentShares(cents);
    if (!shares) {
      preview.textContent = '';
      return;
    }
    const impact = expenseImpact({ paidBy: state.paidBy, amountCents: cents, shares }, me.id);
    const owers = Object.entries(shares).filter(([id, c]) => Number(id) !== state.paidBy && c > 0);
    const each = state.split === 'equal' && state.participants.size > 2
      ? ` · ${formatMoney(Math.floor(cents / state.participants.size))} each` : '';

    if (state.paidBy === me.id) {
      preview.textContent = owers.length === 1
        ? `${nameById[owers[0][0]]} owes you ${formatMoney(owers[0][1])}${each}`
        : impact > 0 ? `You get back ${formatMoney(impact)}${each}` : 'Nobody owes anything.';
    } else {
      preview.textContent = impact < 0
        ? `You owe ${nameById[state.paidBy]} ${formatMoney(-impact)}${each}`
        : `You're not involved${each}`;
    }
  }

  function clearErrors() {
    for (const { error } of Object.values(fieldErrors)) error.hidden = true;
    formError.hidden = true;
  }

  function showError(err) {
    if (err.status === 401) return dialog.close();
    const target = fieldErrors[err.body?.field];
    if (target) {
      target.error.textContent = err.body.message;
      target.error.hidden = false;
      target.input.focus();
    } else {
      formError.textContent = err.body?.message || "Couldn't save. Check your connection and try again.";
      formError.hidden = false;
    }
  }

  function splitBody() {
    const memberValues = (kind) => Object.fromEntries(members.map((m) => [m.id, state.values[kind][m.id] ?? '']));
    if (state.split === 'equal') return { participants: [...state.participants] };
    if (state.split === 'full') return { owedBy: state.owedBy };
    if (state.split === 'percent') return { percents: memberValues('percent') };
    return { amounts: memberValues('exact') };
  }

  async function save(event) {
    event.preventDefault();
    clearErrors();
    const body = {
      description: description.value,
      amount: amount.value,
      paidBy: state.paidBy,
      split: state.split,
      spentOn: spentOn.value,
      ...splitBody(),
    };
    saveButton.disabled = true;
    try {
      await (editing ? api('PUT', `/expenses/${expense.id}`, body) : api('POST', `/groups/${group.id}/expenses`, body));
      dialog.close();
      onSaved();
    } catch (err) {
      showError(err);
    } finally {
      saveButton.disabled = false;
    }
  }

  async function remove() {
    if (!confirm(`Delete “${expense.description}”?`)) return;
    clearErrors();
    try {
      await api('DELETE', `/expenses/${expense.id}`);
      dialog.close();
      onSaved();
    } catch (err) {
      showError(err);
    }
  }
}

// The boxes' starting text when editing a percentage or exact split:
// 3333 -> "33.33" for percentages, 1250 -> "12.50" for amounts.
function typedValues(expense) {
  if (!expense.splitValues) return {};
  return Object.fromEntries(Object.entries(expense.splitValues).map(([id, v]) => [id,
    expense.split === 'percent' ? formatPercent(v).replace('%', '') : (v / 100).toFixed(2)]));
}
