import { MAX_NAME_LENGTH } from '/shared/ledger.js';
import { api } from '../api.js';
import { el } from '../dom.js';
import { addButton, balancePhrase, joinNames, loadError, pageHeader, svg } from './components.js';
import { openSheet } from './sheet.js';

// Groups tab: every group you're in, with your balance in each.
export function mountGroups(root, session) {
  const list = el('section', {}, el('p', { class: 'muted' }, 'Loading…'));
  root.replaceChildren(pageHeader('Groups', { action: addButton('Create a group', () => openCreateGroup(session)) }), list);

  async function load() {
    try {
      const groups = await api('GET', '/groups');
      list.replaceChildren(groups.length
        ? el('ul', { class: 'list' }, groups.map((g) => el('li', {}, groupRow(g, session.me))))
        : el('div', { class: 'empty' },
          el('p', {}, 'No groups yet.'),
          el('p', { class: 'muted' }, 'A group is a shared ledger — like “Home” with your partner, or a trip away with friends.'),
          el('button', { class: 'primary', onclick: () => openCreateGroup(session) }, 'Create a group'),
        ));
    } catch (err) {
      if (err.status !== 401) list.replaceChildren(loadError("Couldn't load your groups.", load));
    }
  }

  load();
  return load;
}

function groupRow(g, me) {
  const others = g.members.filter((m) => m.id !== me.id).map((m) => m.name);
  return el('a', { class: 'row', href: `#/groups/${g.id}` },
    el('span', { class: 'group-icon', style: `--hue:${(g.id * 47) % 360}` }, svg('<circle cx="9" cy="8" r="3.2"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M14.5 14.6c2.6-.4 4.9 1 5.5 4.4"/>')),
    el('span', { class: 'main' },
      el('span', { class: 'title' }, g.name),
      el('span', { class: 'detail muted' }, others.length ? `with ${joinNames(others)}` : 'Just you so far'),
    ),
    el('span', { class: 'row-end' }, balancePhrase(g.balanceCents)),
  );
}

async function openCreateGroup(session) {
  let friends;
  try {
    friends = await api('GET', '/friends');
  } catch {
    return;
  }

  const name = el('input', { id: 'group-name', type: 'text', maxlength: MAX_NAME_LENGTH, autocomplete: 'off', placeholder: 'e.g. Home, Bali trip' });
  const checkboxes = friends.map((f) => el('input', { type: 'checkbox', value: f.id }));
  const nameError = el('p', { class: 'field-error', hidden: true });
  const formError = el('p', { class: 'error', role: 'alert', hidden: true });
  const createButton = el('button', { type: 'submit', class: 'primary' }, 'Create');

  const form = el('form', { novalidate: true, onsubmit: create },
    el('h2', { id: 'create-group-title' }, 'Create a group'),
    el('div', { class: 'field' }, el('label', { for: 'group-name' }, 'Group name'), name, nameError),
    friends.length
      ? el('fieldset', { class: 'participants' },
        el('legend', {}, 'Who’s in it?'),
        friends.map((f, i) => el('label', { class: 'check' }, checkboxes[i], el('span', {}, f.name))))
      : el('p', { class: 'muted' }, 'You can add people later. To add someone, first add them as a friend in the Friends tab.'),
    formError,
    el('div', { class: 'actions' },
      el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      createButton,
    ),
  );
  const dialog = openSheet('create-group-title', form);
  name.focus();

  async function create(event) {
    event.preventDefault();
    nameError.hidden = true;
    formError.hidden = true;
    createButton.disabled = true;
    try {
      const group = await api('POST', '/groups', {
        name: name.value,
        memberIds: checkboxes.filter((c) => c.checked).map((c) => Number(c.value)),
      });
      dialog.close();
      location.hash = `#/groups/${group.id}`;
    } catch (err) {
      if (err.status === 401) return dialog.close();
      const target = err.body?.field === 'name' ? nameError : formError;
      target.textContent = err.body?.message || "Couldn't create the group. Check your connection and try again.";
      target.hidden = false;
    } finally {
      createButton.disabled = false;
    }
  }
}
