// Offline support: cache the app shell, serve it cache-first, refresh in the background.
// Push reminders: the server sends an empty "poke"; we build the message from on-device progress.
const CACHE = 'lifequest-v6';
const STATUS_CACHE = 'lifequest-status';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lifequest-v') && k !== CACHE).map((k) => caches.delete(k))))
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

/* ---------------- Push reminders ---------------- */
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const listNames = (arr, n = 3) => (arr.length <= n ? arr.join(', ') : `${arr.slice(0, n).join(', ')} +${arr.length - n} more`);

/** Pure function: status snapshot written by the app + current time → notification content. */
function buildReminder(s, now) {
  const today = dkey(now);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const yesterday = dkey(y);
  const fresh = s && s.date === today;
  // A streak survives if the last snapshot was today, or yesterday while active.
  const streak = !s ? 0 : fresh ? s.streak : s.date === yesterday && s.activeToday ? s.streak : 0;
  const morning = now.getHours() < 12;
  const open = fresh && s.todos ? ` · 📝 ${s.todos} to-do${s.todos === 1 ? '' : 's'} open` : '';
  const tag = 'lifequest-reminder';

  if (!fresh || !s.activeToday) {
    if (morning) {
      return { title: 'Good morning ☀️', body: s && s.hasSleep ? 'How did you sleep? Log it in one tap.' : 'Start the day with a quick check-in.', tag };
    }
    if (streak > 0) {
      return { title: `🔥 Your ${streak}-day streak ends at midnight`, body: 'Log anything to keep it alive — it takes 10 seconds.', tag };
    }
    return { title: 'Nothing logged today yet', body: 'Log one thing tonight to start a new streak 🔥', tag };
  }
  if (s.perfect) return { title: '⭐ Perfect day locked in', body: s.todos ? `Every goal hit — ${s.todos} to-do${s.todos === 1 ? '' : 's'} still open.` : `Every goal hit. ${streak}-day streak — see you tomorrow!`, tag };
  if (morning && s.hasSleep && !s.loggedIds.includes('sleep')) {
    return { title: 'How did you sleep? 😴', body: `Log it to keep your ${streak}-day streak rolling.`, tag };
  }
  const left = s.remaining || [];
  return {
    title: `${left.length} goal${left.length === 1 ? '' : 's'} left today`,
    body: `${listNames(left)} · 🔥 ${streak}-day streak${open}`,
    tag,
  };
}
self.buildReminder = buildReminder;

async function readStatus() {
  try {
    const res = await (await caches.open(STATUS_CACHE)).match('status');
    return res ? await res.json() : null;
  } catch (_) { return null; }
}

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let msg;
    try { msg = e.data && e.data.json(); } catch (_) { msg = null; }
    if (!msg || !msg.title) msg = buildReminder(await readStatus(), new Date());
    // Every push must show a notification (browsers revoke silent pushes).
    await self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag || 'lifequest-reminder',
      renotify: true,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      data: { url: './?tab=today' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) { await w.focus(); return w.navigate ? w.navigate(url).catch(() => {}) : undefined; }
    }
    return self.clients.openWindow(url);
  })());
});
