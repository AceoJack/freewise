// Service worker: makes the app open even without a connection.
//
// App files (HTML, JS, CSS, icons) are fetched from the network first and the
// cache is only a fallback, so a new version is picked up as soon as you're
// online. API and sign-in requests are never cached, so balances are always live.

const CACHE = 'freewise-v1';
const SHELL = ['/', '/styles.css', '/app.js', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => (await caches.match(request))
        ?? (request.mode === 'navigate' ? caches.match('/') : Response.error())),
  );
});
