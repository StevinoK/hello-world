// Offline support: cache the app shell, serve it cache-first, refresh in the background.
const CACHE = 'lifequest-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // Quick-log URLs carry query strings; serve the shell for any navigation.
  const key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(
    caches.match(key).then((cached) => {
      const fresh = fetch(req).then((res) => {
        if (res.ok && req.mode !== 'navigate') caches.open(CACHE).then((c) => c.put(req, res.clone()));
        if (res.ok && req.mode === 'navigate') caches.open(CACHE).then((c) => c.put('index.html', res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
