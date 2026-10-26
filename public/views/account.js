import { MAX_NAME_LENGTH } from '/shared/ledger.js';
import { api } from '../api.js';
import { el } from '../dom.js';
import { avatar, pageHeader } from './components.js';

// Account tab: who you're signed in as, your display name, and sign out.
export function mountAccount(root, session, { onSignOut }) {
  const nameInput = el('input', { id: 'account-name', type: 'text', maxlength: MAX_NAME_LENGTH, autocomplete: 'name' });
  const nameError = el('p', { class: 'field-error', hidden: true });
  const saved = el('p', { class: 'notice', role: 'status', hidden: true }, 'Name saved.');
  const saveButton = el('button', { type: 'submit', class: 'primary' }, 'Save name');

  function render() {
    const me = session.me;
    nameInput.value = me.name;
    root.replaceChildren(
      pageHeader('Account'),
      el('section', { class: 'card profile' },
        avatar(me, 72),
        el('div', {},
          el('p', { class: 'profile-name' }, me.name),
          el('p', { class: 'muted' }, me.emails.length > 1 ? 'Signs in with Google as:' : 'Signs in with Google as'),
          el('ul', { class: 'emails' }, me.emails.map((e) => el('li', {}, e))),
        ),
      ),
      el('form', { class: 'card account-form', novalidate: true, onsubmit: saveName },
        el('div', { class: 'field' },
          el('label', { for: 'account-name' }, 'Display name'),
          nameInput,
          el('p', { class: 'muted hint' }, 'This is how you appear to your friends.'),
          nameError),
        saved,
        saveButton,
      ),
      el('button', { class: 'sign-out', onclick: onSignOut }, 'Sign out'),
    );
  }

  async function saveName(event) {
    event.preventDefault();
    nameError.hidden = true;
    saved.hidden = true;
    saveButton.disabled = true;
    try {
      const { user } = await api('PATCH', '/me', { name: nameInput.value });
      session.me = user;
      render();
      saved.hidden = false;
    } catch (err) {
      if (err.status === 401) return;
      nameError.textContent = err.body?.message || "Couldn't save. Check your connection and try again.";
      nameError.hidden = false;
    } finally {
      saveButton.disabled = false;
    }
  }

  render();
  return null;
}
