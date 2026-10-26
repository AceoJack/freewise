import { el, loadScript } from './dom.js';

const root = document.getElementById('app');

const LOGIN_ERRORS = {
  not_allowed: "That Google account isn't allowed to use Freewise.",
  unverified: "That Google account's email address isn't verified.",
  account_mismatch: 'That email is linked to a different Google account.',
  csrf: 'Sign-in expired. Please try again.',
  invalid_token: 'Google sign-in failed. Please try again.',
};

function render(...nodes) {
  root.replaceChildren(...nodes);
}

async function main() {
  const res = await fetch('/api/me');
  if (res.ok) return renderHome(await res.json());
  if (res.status === 401) return renderLogin();
  render(el('p', { class: 'error' }, 'Something went wrong. Please reload.'));
}

async function renderLogin() {
  const params = new URLSearchParams(location.search);
  const error = LOGIN_ERRORS[params.get('login_error')];
  if (params.has('login_error')) history.replaceState(null, '', '/');

  const config = await fetch('/auth/config').then((r) => r.json());
  const googleButton = el('div', { class: 'google-button' });

  render(el('section', { class: 'login' },
    el('div', {},
      el('p', { class: 'brand' }, 'Freewise'),
      el('p', { class: 'muted' }, 'Shared expenses, settled simply.'),
    ),
    error && el('p', { class: 'error', role: 'alert' }, error),
    googleButton,
    config.devUsers && renderDevLogin(config.devUsers),
  ));

  try {
    await loadScript('https://accounts.google.com/gsi/client');
    google.accounts.id.initialize({
      client_id: config.googleClientId,
      // Redirect mode: popups are unreliable in iOS home-screen apps.
      ux_mode: 'redirect',
      login_uri: `${location.origin}/auth/google/callback`,
    });
    google.accounts.id.renderButton(googleButton, {
      theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280,
    });
  } catch {
    googleButton.replaceWith(el('p', { class: 'error' }, "Couldn't load Google sign-in. Check your connection."));
  }
}

function renderDevLogin(users) {
  const signInAs = async (user) => {
    await fetch('/auth/dev-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: user.id }),
    });
    main();
  };
  return el('div', { class: 'dev-login card' },
    el('span', { class: 'label muted' }, 'Dev login'),
    users.map((u) => el('button', { onclick: () => signInAs(u) }, `Sign in as ${u.name}`)),
  );
}

function renderHome({ user, partner }) {
  const signOut = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    main();
  };
  render(
    el('h1', {}, `Hi ${user.name}`),
    el('p', { class: 'muted' }, partner ? `Sharing a ledger with ${partner.name}.` : 'No partner set up yet.'),
    el('div', { class: 'card' }, el('p', {}, 'The ledger is coming next.')),
    el('p', {}, el('button', { onclick: signOut }, 'Sign out')),
  );
}

main();
