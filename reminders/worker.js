/**
 * LifeQuest reminder server — a Cloudflare Worker.
 *
 * Stores Web Push subscriptions + reminder times in KV, and a cron trigger "pokes" each
 * subscribed device at its chosen local times. Pushes carry NO payload: the app's service
 * worker builds the notification text from progress data that never leaves the phone.
 *
 * VAPID keys are generated on first use and kept in KV, so there are no secrets to set up.
 *
 * Bindings (see wrangler.toml):  KV namespace `KV`
 * Optional vars:  ALLOWED_ORIGIN (e.g. https://you.github.io), VAPID_SUBJECT (mailto: or https: URL)
 */

const MAX_SUBS = 10;          // personal app: a handful of devices is plenty
const MAX_TIMES = 4;
const BUCKET_MIN = 5;         // cron runs every 5 minutes

/* ---------------- encoding helpers ---------------- */
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const sha256hex = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/* ---------------- VAPID ---------------- */
export async function getVapid(env) {
  const saved = await env.KV.get('vapid', 'json');
  if (saved) return saved;
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const raw = await crypto.subtle.exportKey('raw', kp.publicKey); // 65-byte uncompressed point
  const vapid = { publicKey: b64u(raw), jwk };
  await env.KV.put('vapid', JSON.stringify(vapid));
  return vapid;
}

export async function vapidAuth(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin;
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })}`;
  const key = await crypto.subtle.importKey('jwk', vapid.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto returns the raw r||s (P1363) signature, which is exactly what ES256 JWTs use.
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${vapid.publicKey}`;
}

/** Send a payload-less push. Returns the HTTP status (404/410 = subscription is dead). */
export async function poke(sub, env, vapid) {
  const subject = env.VAPID_SUBJECT || env.ALLOWED_ORIGIN || 'https://github.com';
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidAuth(sub.endpoint, vapid, subject), TTL: '1800', Urgency: 'normal', 'Content-Length': '0' },
  });
  return res.status;
}

/* ---------------- scheduling ---------------- */
/** Local "HH:MM" bucket (floored to 5 min) for a given instant in a time zone. */
export function localBucket(date, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const h = +parts.find((p) => p.type === 'hour').value;
  const m = +parts.find((p) => p.type === 'minute').value;
  return h * 60 + Math.floor(m / BUCKET_MIN) * BUCKET_MIN;
}
export function isDue(times, tz, date) {
  const now = localBucket(date, tz);
  return times.some((t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + Math.floor(m / BUCKET_MIN) * BUCKET_MIN === now;
  });
}

async function runSchedule(env, date = new Date()) {
  const list = await env.KV.list({ prefix: 'sub:' });
  if (!list.keys.length) return { sent: 0 };
  const vapid = await getVapid(env);
  let sent = 0;
  for (const { name } of list.keys) {
    const rec = await env.KV.get(name, 'json');
    if (!rec || !isDue(rec.times, rec.tz, date)) continue;
    const status = await poke(rec.subscription, env, vapid).catch(() => 0);
    if (status === 404 || status === 410) await env.KV.delete(name);
    else if (status >= 200 && status < 300) sent++;
  }
  return { sent };
}

/* ---------------- HTTP API ---------------- */
function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN.split(',').map((s) => s.trim()) : ['*'];
  return {
    'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

function validTz(tz) { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (_) { return false; } }

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    const { pathname } = new URL(req.url);

    if (req.method === 'GET' && pathname === '/vapid') return json({ publicKey: (await getVapid(env)).publicKey }, 200, h);
    if (req.method === 'GET' && pathname === '/') return json({ ok: true, service: 'lifequest-reminders' }, 200, h);
    if (req.method !== 'POST') return json({ error: 'not found' }, 404, h);

    let body;
    try { body = await req.json(); } catch (_) { return json({ error: 'bad json' }, 400, h); }
    const endpoint = body?.subscription?.endpoint || body?.endpoint;
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint)) return json({ error: 'missing subscription endpoint' }, 400, h);
    const key = `sub:${await sha256hex(endpoint)}`;

    if (pathname === '/subscribe') {
      const times = (Array.isArray(body.times) ? body.times : []).filter((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, MAX_TIMES);
      const tz = validTz(body.tz) ? body.tz : 'UTC';
      if (!times.length) return json({ error: 'pick at least one reminder time' }, 400, h);
      if (!(await env.KV.get(key))) {
        const { keys } = await env.KV.list({ prefix: 'sub:' });
        if (keys.length >= MAX_SUBS) return json({ error: 'too many devices subscribed' }, 429, h);
      }
      await env.KV.put(key, JSON.stringify({ subscription: { endpoint }, times, tz, updated: Date.now() }));
      return json({ ok: true, times, tz }, 200, h);
    }
    if (pathname === '/unsubscribe') { await env.KV.delete(key); return json({ ok: true }, 200, h); }
    if (pathname === '/test') {
      const rec = await env.KV.get(key, 'json');
      if (!rec) return json({ error: 'this device is not subscribed' }, 404, h);
      const status = await poke(rec.subscription, env, await getVapid(env)).catch(() => 0);
      if (status === 404 || status === 410) await env.KV.delete(key);
      return json({ ok: status >= 200 && status < 300, pushStatus: status }, 200, h);
    }
    return json({ error: 'not found' }, 404, h);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runSchedule(env, new Date(_event?.scheduledTime || Date.now())));
  },
};

export { runSchedule };
