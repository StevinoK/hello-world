// Tests for the reminder worker and the service worker's message builder.  Run: node reminders/test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import worker, { getVapid, isDue, runSchedule } from './worker.js';

// ---- In-memory KV + fake push service ----
function makeEnv() {
  const store = new Map();
  return {
    ALLOWED_ORIGIN: 'https://example.github.io',
    KV: {
      get: async (k, type) => (store.has(k) ? (type === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null),
      put: async (k, v) => void store.set(k, v),
      delete: async (k) => void store.delete(k),
      list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
    },
    store,
  };
}
const pushes = [];
let pushStatus = 201;
globalThis.fetch = async (url, init) => { pushes.push({ url, init }); return new Response(null, { status: pushStatus }); };
const call = (env, path, body, method = body ? 'POST' : 'GET') =>
  worker.fetch(new Request(`https://w.test${path}`, { method, headers: { Origin: 'https://example.github.io', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }), env);
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

const env = makeEnv();
const endpoint = 'https://fcm.googleapis.com/fcm/send/abc123';

// 1. VAPID key is generated once and is stable
const k1 = await (await call(env, '/vapid')).json();
const k2 = await (await call(env, '/vapid')).json();
assert.equal(k1.publicKey, k2.publicKey);
assert.equal(unb64u(k1.publicKey).length, 65, 'uncompressed P-256 point');

// 2. Subscribe validates input and stores the record
assert.equal((await call(env, '/subscribe', { subscription: { endpoint }, times: ['25:00'], tz: 'America/New_York' })).status, 400);
const sres = await call(env, '/subscribe', { subscription: { endpoint, keys: { p256dh: 'x', auth: 'y' } }, times: ['08:30', '21:00', 'junk'], tz: 'America/New_York' });
assert.equal(sres.status, 200);
assert.deepEqual((await sres.json()).times, ['08:30', '21:00']);
assert.equal(sres.headers.get('Access-Control-Allow-Origin'), 'https://example.github.io');

// 3. /test sends a payload-less push with a valid ES256 VAPID JWT
const tres = await (await call(env, '/test', { endpoint })).json();
assert.equal(tres.ok, true);
const p = pushes.at(-1);
assert.equal(p.url, endpoint);
assert.equal(p.init.headers.TTL, '1800');
const m = p.init.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
assert.ok(m, 'vapid header format');
const [h, pl, sig] = m[1].split('.');
const claims = JSON.parse(new TextDecoder().decode(unb64u(pl)));
assert.equal(claims.aud, 'https://fcm.googleapis.com');
assert.equal(claims.sub, 'https://example.github.io');
assert.ok(claims.exp > Date.now() / 1000);
const pub = await crypto.subtle.importKey('raw', unb64u(m[2]), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
assert.ok(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(sig), new TextEncoder().encode(`${h}.${pl}`)), 'JWT signature verifies');

// 4. Scheduling is time-zone aware and bucketed to 5 minutes
// 2026-11-16 13:32 UTC = 08:32 in New York (EST, UTC-5)
assert.equal(isDue(['08:30'], 'America/New_York', new Date('2026-11-16T13:32:00Z')), true);
assert.equal(isDue(['08:30'], 'America/New_York', new Date('2026-11-16T13:36:00Z')), false);
assert.equal(isDue(['21:00'], 'Europe/London', new Date('2026-07-01T20:01:00Z')), true); // BST
pushes.length = 0;
assert.deepEqual(await runSchedule(env, new Date('2026-11-16T13:31:00Z')), { sent: 1 });
assert.deepEqual(await runSchedule(env, new Date('2026-11-16T15:00:00Z')), { sent: 0 });

// 5. Dead subscriptions (410 Gone) are cleaned up
pushStatus = 410;
await runSchedule(env, new Date('2026-11-17T02:02:00Z')); // 21:02 New York
assert.equal([...env.store.keys()].filter((k) => k.startsWith('sub:')).length, 0);
pushStatus = 201;

// 6. Unsubscribe
await call(env, '/subscribe', { subscription: { endpoint }, times: ['09:00'], tz: 'UTC' });
await call(env, '/unsubscribe', { endpoint });
assert.equal((await (await call(env, '/test', { endpoint })).json()).error, 'this device is not subscribed');

// 7. Service worker message builder
const sandbox = { self: { addEventListener() {} }, location: { origin: 'x' }, caches: {}, console };
vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), sandbox);
const build = sandbox.self.buildReminder;
const at = (iso) => new Date(iso);
const base = { date: '2026-11-16', streak: 8, activeToday: true, perfect: false, remaining: ['Water', 'Workout', 'Tidy up 10 min', 'Dishes'], loggedIds: ['steps'], hasSleep: true };
let r = build(base, at('2026-11-16T21:00:00'));
assert.equal(r.title, '4 goals left today');
assert.match(r.body, /Water, Workout, Tidy up 10 min \+1 more · 🔥 8-day streak/);
r = build({ ...base, todos: 2 }, at('2026-11-16T21:00:00'));
assert.match(r.body, /🔥 8-day streak · 📝 2 to-dos open$/);
r = build({ ...base, perfect: true, todos: 1 }, at('2026-11-16T21:00:00'));
assert.equal(r.body, 'Every goal hit — 1 to-do still open.');
r = build({ ...base, date: '2026-11-15' }, at('2026-11-16T21:00:00'));
assert.equal(r.title, '🔥 Your 8-day streak ends at midnight');
r = build({ ...base, date: '2026-11-13' }, at('2026-11-16T21:00:00'));
assert.equal(r.title, 'Nothing logged today yet');
r = build(base, at('2026-11-16T08:30:00'));
assert.equal(r.title, 'How did you sleep? 😴');
r = build({ ...base, perfect: true }, at('2026-11-16T21:00:00'));
assert.equal(r.title, '⭐ Perfect day locked in');
r = build(null, at('2026-11-16T08:30:00'));
assert.equal(r.title, 'Good morning ☀️');

console.log('All reminder tests passed ✓');
