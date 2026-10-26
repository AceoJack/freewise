import { el } from '../dom.js';

// Shows content in a bottom-sheet <dialog>. Tapping the dimmed backdrop closes
// it, and it removes itself from the page once closed.
export function openSheet(labelId, content) {
  const dialog = el('dialog', { class: 'sheet', 'aria-labelledby': labelId }, content);
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    dialog.remove();
    document.body.classList.remove('modal-open');
  });
  document.body.append(dialog);
  document.body.classList.add('modal-open');
  dialog.showModal();
  return dialog;
}
