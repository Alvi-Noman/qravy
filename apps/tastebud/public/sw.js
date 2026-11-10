// apps/tastebud/public/sw.js — the restaurant's app (home-screen install) works offline only as far as saying so:
// pages always come from the network (the newest app, today's menu, live orders); with no connection, a small
// "you're offline" page. Nothing else is stored — no menus, no API answers, no orders.
const CACHE = 'qravy-offline-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add('/offline.html')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // (everything else: straight to the network, untouched)
  e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')));
});
