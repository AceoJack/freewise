import { MAX_NAME_LENGTH } from '/shared/ledger.js';
import { api } from '../api.js';
import { el } from '../dom.js';
import { formatMoney } from '../format.js';
import { addButton, avatar, loadError, pageHeader } from './components.js';
import { openSheet } from './sheet.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Friends tab: everyone you've added, with what's owed across all groups.
export function mountFriends(root) {
  const notice = el('p', { class: 'notice', role: 'status', hidden: true });
  const search = el('input', {
    type: 'search', class: 'search', placeholder: 'Search friends', 'aria-label': 'Search friends',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
  });
  const list = el('section', {}, el('p', { class: 'muted' }, 'Loading…'));
  root.replaceChildren(
    pageHeader('Friends', { action: addButton('Add a friend', () => openAddFriend(onAdded)) }),
    notice,
    search,
    list,
  );

  let friends = [];
  search.addEventListener('input', render);

  function onAdded(friend) {
    notice.textContent = `${friend.name} is now your friend.`;
    notice.hidden = false;
    load();
  }

  function render() {
    if (friends.length === 0) {
      search.hidden = true;
      return list.replaceChildren(el('div', { class: 'empty' },
        el('p', {}, 'No friends yet.'),
        el('p', { class: 'muted' }, 'Add someone by their email address. They sign in with that Google account.'),
        el('button', { class: 'primary', onclick: () => openAddFriend(onAdded) }, 'Add a friend'),
      ));
    }
    search.hidden = false;
    const query = search.value.trim().toLowerCase();
    const matches = friends.filter((f) => !query || f.name.toLowerCase().includes(query) || f.email?.includes(query));
    list.replaceChildren(matches.length
      ? el('ul', { class: 'list' }, matches.map((f) => el('li', {}, friendRow(f))))
      : el('p', { class: 'empty muted' }, `No friends match “${search.value.trim()}”.`));
  }

  async function load() {
    try {
      friends = await api('GET', '/friends');
      render();
    } catch (err) {
      if (err.status !== 401) list.replaceChildren(loadError("Couldn't load your friends.", load));
    }
  }

  load();
  return load;
}

function friendRow(f) {
  const balance = f.balanceCents > 0
    ? el('span', { class: 'share positive' }, el('span', { class: 'share-label' }, 'owes you'), el('span', { class: 'share-amount' }, formatMoney(f.balanceCents)))
    : f.balanceCents < 0
      ? el('span', { class: 'share negative' }, el('span', { class: 'share-label' }, 'you owe'), el('span', { class: 'share-amount' }, formatMoney(-f.balanceCents)))
      : el('span', { class: 'share muted' }, el('span', { class: 'share-label' }, 'settled up'));
  return el('div', { class: 'row' },
    avatar(f),
    el('span', { class: 'main' }, el('span', { class: 'title' }, f.name), el('span', { class: 'detail muted' }, f.email)),
    balance,
  );
}

// Add-friend sheet: type an email, see whether they're already on Freewise,
// and give a name if they're not.
function openAddFriend(onAdded) {
  const email = el('input', {
    id: 'friend-email', type: 'email', inputmode: 'email', autocomplete: 'off', autocapitalize: 'off',
    spellcheck: 'false', placeholder: 'name@gmail.com',
  });
  const name = el('input', { id: 'friend-name', type: 'text', maxlength: MAX_NAME_LENGTH, autocomplete: 'off', placeholder: 'What should we call them?' });
  const nameField = el('div', { class: 'field', hidden: true }, el('label', { for: 'friend-name' }, 'Their name'), name);
  const status = el('p', { class: 'lookup muted', 'aria-live': 'polite' });
  const formError = el('p', { class: 'error', role: 'alert', hidden: true });
  const addBtn = el('button', { type: 'submit', class: 'primary', disabled: true }, 'Add friend');

  const form = el('form', { novalidate: true, onsubmit: add },
    el('h2', { id: 'add-friend-title' }, 'Add a friend'),
    el('div', { class: 'field' }, el('label', { for: 'friend-email' }, 'Email address'), email),
    status,
    nameField,
    formError,
    el('div', { class: 'actions' },
      el('button', { type: 'button', onclick: () => dialog.close() }, 'Cancel'),
      addBtn,
    ),
  );
  const dialog = openSheet('add-friend-title', form);
  email.focus();

  let lookup = null; // result for the email currently typed
  let timer = null;
  let seq = 0;

  email.addEventListener('input', () => {
    clearTimeout(timer);
    lookup = null;
    formError.hidden = true;
    update();
    if (EMAIL_PATTERN.test(email.value.trim())) timer = setTimeout(check, 300);
  });
  name.addEventListener('input', update);

  async function check() {
    const mine = ++seq;
    status.textContent = 'Checking…';
    try {
      const result = await api('GET', `/friends/lookup?email=${encodeURIComponent(email.value.trim())}`);
      if (mine !== seq) return; // a newer keystroke has taken over
      lookup = result;
    } catch {
      if (mine === seq) status.textContent = '';
    }
    update();
  }

  function update() {
    const valid = EMAIL_PATTERN.test(email.value.trim());
    if (!valid || !lookup) {
      status.textContent = valid ? status.textContent : '';
      nameField.hidden = true;
      addBtn.disabled = true;
      return;
    }
    if (lookup.isYou) {
      status.textContent = "That's your own email address.";
    } else if (lookup.isFriend) {
      status.textContent = `${lookup.user.name} is already your friend.`;
    } else if (lookup.user) {
      status.textContent = `${lookup.user.name} is on Freewise.`;
    } else {
      status.textContent = 'Not on Freewise yet. Once added, they can sign in with Google using this email.';
    }
    nameField.hidden = !!lookup.user || lookup.isYou;
    addBtn.disabled = lookup.isYou || lookup.isFriend || (!lookup.user && !name.value.trim());
  }

  async function add(event) {
    event.preventDefault();
    if (addBtn.disabled) return;
    addBtn.disabled = true;
    try {
      const friend = await api('POST', '/friends', { email: email.value.trim(), name: name.value });
      dialog.close();
      onAdded(friend);
    } catch (err) {
      if (err.status === 401) return dialog.close();
      formError.textContent = err.body?.message || "Couldn't add them. Check your connection and try again.";
      formError.hidden = false;
      addBtn.disabled = false;
    }
  }
}
