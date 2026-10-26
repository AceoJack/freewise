import { el } from './dom.js';
import { mountAccount } from './views/account.js';
import { mountActivity } from './views/activity.js';
import { svg } from './views/components.js';
import { mountFriends } from './views/friends.js';
import { mountGroup } from './views/group.js';
import { mountGroups } from './views/groups.js';
import { mountGroupHistory, mountSettlement } from './views/history.js';
import { renderLogin } from './views/login.js';

const root = document.getElementById('app');
const view = el('div', { class: 'view' });

const TABS = [
  { id: 'friends', label: 'Friends', icon: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6"/>' },
  { id: 'groups', label: 'Groups', icon: '<circle cx="9" cy="8" r="3.2"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M14.5 14.6c2.6-.4 4.9 1 5.5 4.4"/>' },
  { id: 'activity', label: 'Activity', icon: '<path d="M3 12h4l3-7 4 14 3-7h4"/>' },
  { id: 'account', label: 'Account', icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5c1.3-2 3.2-3 5.5-3s4.2 1 5.5 3"/>' },
];
const tabLinks = TABS.map((t) => el('a', { href: `#/${t.id}`, class: 'tab' }, svg(t.icon), el('span', {}, t.label)));
const tabBar = el('nav', { class: 'tabbar', 'aria-label': 'Main' }, tabLinks);

// Signed-in state shared with the screens. session.me is { id, name, pictureUrl, emails }.
const session = { me: null };
// Reloads whatever screen is showing; called when the app comes back to the foreground.
let refresh = null;

async function main() {
  session.me = null;
  refresh = null;
  let res;
  try {
    res = await fetch('/api/me');
  } catch {
    return showError("Couldn't reach Freewise. Check your connection.");
  }
  if (res.status === 401) {
    document.body.classList.remove('signed-in');
    return renderLogin(root, { onSignedIn: main });
  }
  if (!res.ok) return showError('Something went wrong.');

  session.me = (await res.json()).user;
  document.body.classList.add('signed-in');
  root.replaceChildren(view, tabBar);
  route();
}

// #/friends, #/groups, #/groups/:id, #/groups/:id/history, #/settlements/:id, #/activity, #/account
function route() {
  if (!session.me) return;
  document.querySelector('dialog')?.close();

  const path = location.hash.replace(/^#\/?/, '');
  const [section, id, sub] = path.split('/');
  const num = Number(id);

  if (section === 'groups' && num && sub === 'history') refresh = mountGroupHistory(view, session, num);
  else if (section === 'groups' && num) refresh = mountGroup(view, session, num);
  else if (section === 'settlements' && num) refresh = mountSettlement(view, session, num);
  else if (section === 'friends') refresh = mountFriends(view, session);
  else if (section === 'activity') refresh = mountActivity(view, session);
  else if (section === 'account') refresh = mountAccount(view, session, { onSignOut: signOut });
  else if (section === 'groups') refresh = mountGroups(view, session);
  else return location.replace('#/groups');

  const activeTab = section === 'settlements' ? 'groups' : section;
  tabLinks.forEach((link, i) => {
    const active = TABS[i].id === activeTab;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

async function signOut() {
  await fetch('/auth/logout', { method: 'POST' });
  history.replaceState(null, '', '/');
  main();
}

function showError(message) {
  root.replaceChildren(el('div', { class: 'error' }, el('p', {}, message), el('button', { onclick: main }, 'Try again')));
}

window.addEventListener('hashchange', route);
window.addEventListener('freewise:signed-out', main);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refresh?.();
});

// Offline support: lets the app open without a connection. Needs HTTPS (or
// localhost), so it's silently skipped when testing over plain http on Wi-Fi.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

main();
