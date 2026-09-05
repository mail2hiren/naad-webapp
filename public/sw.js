// Minimal service worker -- its only job is to satisfy the "installable PWA"
// requirement (Chrome/Android's install prompt and "Add to Home Screen" both
// check for a registered service worker with a fetch handler) so doctors can
// install this to their home screen. It deliberately does NOT cache the app
// shell: this is an active pilot the user is iterating on, and a caching
// service worker is the classic way testers get stuck on stale code after a
// deploy. skipWaiting/clients.claim make a new deploy take over immediately
// instead of waiting for every open tab to close first.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
