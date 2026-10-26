import { MAX_NAME_LENGTH } from '/shared/ledger.js';
import { api } from '../api.js';
import { el } from '../dom.js';
import { avatar, loadError, pageHeader } from './components.js';

// A group's settings: rename it, remove people or leave, and delete it.
// People in unsettled expenses can't be removed, and only a settled group can
// be deleted; the server enforces both, this page just explains why.
export function mountGroupSettings(root, session, groupId) {
  const me = session.me;
  const back = (label) => ({ href: `#/groups/${groupId}`, label });
  root.replaceChildren(pageHeader('Group settings', { back: back('Back') }), el('p', { class: 'muted' }, 'Loading…'));

  async function load() {
    let data;
    try {
      data = await api('GET', `/groups/${groupId}`);
    } catch (err) {
      if (err.status === 401) return;
      return root.replaceChildren(pageHeader('Group settings', { back: { href: '#/groups', label: 'Groups' } }), err.status === 404
        ? el('p', { class: 'empty muted' }, "That group doesn't exist, or you're not in it.")
        : loadError("Couldn't load this group.", load));
    }
    render(data);
  }

  function render({ group, ledger }, savedMessage) {
    const unsettled = ledger.expenses.length > 0;
    const involved = new Set(ledger.expenses.flatMap((e) => [e.paidBy, ...Object.keys(e.shares).map(Number)]));
    const onlyMember = group.members.length === 1;

    const nameInput = el('input', { id: 'group-name', type: 'text', maxlength: MAX_NAME_LENGTH, autocomplete: 'off', value: group.name });
    const nameError = el('p', { class: 'field-error', hidden: true });
    const saved = el('p', { class: 'notice', role: 'status', hidden: !savedMessage }, savedMessage);
    const saveButton = el('button', { type: 'submit', class: 'primary' }, 'Save name');
    const membersError = el('p', { class: 'error', role: 'alert', hidden: true });
    const deleteError = el('p', { class: 'error', role: 'alert', hidden: true });

    const showError = (target, err, fallback) => {
      if (err.status === 401) return;
      target.textContent = err.body?.message || fallback;
      target.hidden = false;
    };

    async function rename(event) {
      event.preventDefault();
      nameError.hidden = true;
      saved.hidden = true;
      saveButton.disabled = true;
      try {
        const updated = await api('PATCH', `/groups/${group.id}`, { name: nameInput.value });
        render({ group: updated, ledger }, 'Name saved.');
      } catch (err) {
        showError(nameError, err, "Couldn't save. Check your connection and try again.");
        saveButton.disabled = false;
      }
    }

    async function removeMember(member, button) {
      const leaving = member.id === me.id;
      const question = leaving
        ? `Leave “${group.name}”? You won’t see it or its history any more.`
        : `Remove ${member.name} from “${group.name}”?`;
      if (!confirm(question)) return;
      membersError.hidden = true;
      button.disabled = true;
      try {
        await api('DELETE', `/groups/${group.id}/members/${member.id}`);
        if (leaving) return location.assign('#/groups');
        load();
      } catch (err) {
        showError(membersError, err, "Couldn't do that. Check your connection and try again.");
        button.disabled = false;
      }
    }

    async function deleteGroup(button) {
      if (!confirm(`Delete “${group.name}” for everyone in it? This can’t be undone.`)) return;
      deleteError.hidden = true;
      button.disabled = true;
      try {
        await api('DELETE', `/groups/${group.id}`);
        location.assign('#/groups');
      } catch (err) {
        showError(deleteError, err, "Couldn't delete the group. Check your connection and try again.");
        button.disabled = false;
      }
    }

    const memberRow = (m) => {
      const isMe = m.id === me.id;
      const blocked = involved.has(m.id) || onlyMember;
      const button = el('button', { class: 'small', disabled: blocked }, isMe ? 'Leave' : 'Remove');
      button.addEventListener('click', () => removeMember(m, button));
      const detail = involved.has(m.id) ? 'In unsettled expenses' : onlyMember ? 'The only member' : null;
      return el('li', {}, el('div', { class: 'row' },
        avatar(m),
        el('span', { class: 'main' },
          el('span', { class: 'title' }, isMe ? `${m.name} (you)` : m.name),
          detail && el('span', { class: 'detail muted' }, detail)),
        el('span', { class: 'row-end' }, button)));
    };

    const deleteButton = el('button', { class: 'danger', disabled: unsettled }, 'Delete group');
    deleteButton.addEventListener('click', () => deleteGroup(deleteButton));

    root.replaceChildren(...[
      pageHeader('Group settings', { back: back(group.name) }),
      el('form', { class: 'card settings-form', novalidate: true, onsubmit: rename },
        el('div', { class: 'field' }, el('label', { for: 'group-name' }, 'Group name'), nameInput, nameError),
        saved,
        saveButton,
      ),

      el('h2', { class: 'section-heading' }, 'Members'),
      el('ul', { class: 'list' }, group.members.map(memberRow)),
      involved.size > 0 && el('p', { class: 'muted hint' },
        'People who paid for or share in an unsettled expense can be removed once the group is settled up.'),
      membersError,

      el('h2', { class: 'section-heading' }, 'Delete group'),
      el('section', { class: 'card danger-zone' },
        el('p', { class: 'muted' }, unsettled
          ? 'Settle up first. A group can only be deleted once there’s nothing left to settle.'
          : 'Removes the group and its history for everyone in it. The Activity feed keeps a note that it was deleted.'),
        deleteError,
        deleteButton,
      ),
    ].filter(Boolean));
  }

  load();
  return load;
}
