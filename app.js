/* LifeQuest — a personal daily tracker with a dashboard and gamification.
 * Plain JS, no build step. Data lives on-device in localStorage (export/import for backup). */
'use strict';

/* ======================= Utilities ======================= */
const KEY = 'lifequest.v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dkey(d); };
const todayKey = () => dkey(new Date());
const weekStart = (k) => { const d = parseKey(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dkey(d); };
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const round = (x, p = 2) => Math.round(x * 10 ** p) / 10 ** p;
const fmt = (n, unit) => {
  if (n == null || Number.isNaN(n)) return '—';
  const s = Math.abs(n) >= 1000 ? Math.round(n).toLocaleString() : String(round(n, 2));
  return unit ? `${s} ${unit}` : s;
};
const fmtShort = (n) => (n >= 10000 ? `${round(n / 1000, 1)}k` : fmt(n));
const dayLabel = (k, opts = { weekday: 'short', month: 'short', day: 'numeric' }) => parseKey(k).toLocaleDateString(undefined, opts);
const vibrate = (p = 10) => { try { navigator.vibrate && navigator.vibrate(p); } catch (_) {} };

/* ======================= State ======================= */
const SNACKS = { id: 'snacks', name: 'Snacks', icon: '🍪', unit: 'snacks', goal: 2, dir: 'max', mode: 'add', step: 1, presets: [1, 2], on: true };
const DEFAULT_MEALS = ['Breakfast', 'Lunch', 'Dinner'];

function defaults() {
  return {
    v: 2,
    meals: [...DEFAULT_MEALS],
    strength: true,    // show the Strength card on Today
    wUnit: 'lb',
    exercises: ['Bench press', 'Squat', 'Deadlift', 'Overhead press', 'Barbell row', 'Pull-up', 'Lat pulldown', 'Dumbbell curl', 'Leg press', 'Push-up'],
    todos: [],         // open ad-hoc to-dos: { id, text, created: 'YYYY-MM-DD' } — removed when done
    created: todayKey(),
    trackers: [
      { id: 'sleep', name: 'Sleep', icon: '😴', unit: 'h', goal: 7.5, dir: 'min', mode: 'set', step: 0.25, presets: [6, 6.5, 7, 7.5, 8, 8.5], on: true },
      { id: 'steps', name: 'Steps', icon: '👟', unit: 'steps', goal: 8000, dir: 'min', mode: 'set', step: 500, presets: [3000, 5000, 8000, 10000, 12000], on: true },
      { id: 'workout', name: 'Workout', icon: '💪', unit: 'min', goal: 30, dir: 'min', mode: 'add', step: 5, presets: [10, 20, 30, 45, 60], on: true },
      { id: 'water', name: 'Water', icon: '💧', unit: 'glasses', goal: 8, dir: 'min', mode: 'add', step: 1, presets: [1, 2, 3], on: true },
      { ...SNACKS },
      { id: 'weight', name: 'Weight', icon: '⚖️', unit: 'lb', goal: null, dir: 'none', mode: 'set', step: 0.2, presets: [], on: true },
    ],
    chores: [
      { id: 'c-bed', name: 'Make bed', freq: 'daily', pts: 10 },
      { id: 'c-dishes', name: 'Dishes', freq: 'daily', pts: 15 },
      { id: 'c-tidy', name: 'Tidy up 10 min', freq: 'daily', pts: 10 },
      { id: 'c-laundry', name: 'Laundry', freq: 'weekly', pts: 30 },
      { id: 'c-vacuum', name: 'Vacuum', freq: 'weekly', pts: 30 },
      { id: 'c-groceries', name: 'Groceries', freq: 'weekly', pts: 25 },
    ],
    days: {},          // { 'YYYY-MM-DD': { v: { trackerId: number }, c: { choreId: 1 } } }
    seenBadges: [],
    lastLevel: 1,
    theme: 'auto',
    reminders: { server: '', times: ['08:30', '21:00'], enabled: false },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const s = migrate({ ...defaults(), ...parsed, v: parsed.v || 1 });
      if (s.v !== parsed.v) localStorage.setItem(KEY, JSON.stringify(s));
      return s;
    }
  } catch (_) {}
  return defaults();
}
/** Bring older saved data up to date without touching anything the user has customised. */
function migrate(s) {
  if ((s.v || 1) < 2) {
    if (!s.trackers.some((t) => t.id === 'snacks')) {
      const i = s.trackers.findIndex((t) => t.id === 'water');
      s.trackers.splice(i < 0 ? s.trackers.length : i + 1, 0, { ...SNACKS });
    }
    if (!Array.isArray(s.meals)) s.meals = [...DEFAULT_MEALS];
    s.v = 2;
  }
  return s;
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('⚠️ Could not save — storage full or blocked'); }
  queueStatus();
  queueSync();
}
const day = (k) => (S.days[k] ||= { v: {}, c: {} });
const peekDay = (k) => S.days[k] || { v: {}, c: {} };
const activeTrackers = () => S.trackers.filter((t) => t.on);

/* ======================= Scoring & gamification ======================= */
const XP = { log: 10, goal: 20, perfect: 50, streakPer: 5, streakCap: 10, pr: 25 };

function goalMet(t, val) {
  if (val == null) return false;
  if (t.dir === 'none' || t.goal == null) return true; // goal is simply "log it"
  return t.dir === 'max' ? val <= t.goal : val >= t.goal;
}
function progress(t, val) {
  if (val == null) return 0;
  if (t.dir === 'none' || t.goal == null) return 1;
  if (t.dir === 'max') return val <= t.goal ? 1 : clamp(t.goal / val, 0, 1);
  return clamp(val / t.goal, 0, 1);
}

const mealEntries = (d) => Object.entries(d.m || {}).filter(([, v]) => v && String(v).trim());
const doneSets = (e) => (e.sets || []).filter((x) => x.done);
const strengthDone = (d) => (d.w || []).some((e) => doneSets(e).length);
const rawActive = (d) => Object.keys(d.v).length > 0 || Object.keys(d.c).length > 0 || mealEntries(d).length > 0 || (d.t || []).length > 0 || strengthDone(d);
/** Goal check for a tracker on a day. Any logged strength exercise also counts as a workout. */
function trackerMet(t, d) {
  return goalMet(t, effVal(t, d)) || (t.id === 'workout' && strengthDone(d));
}
/** Value used for goals. A daily-limit counter (e.g. snacks) you never tapped counts as 0 on any day you used the app. */
function effVal(t, d) {
  const v = d.v[t.id];
  return v == null && t.dir === 'max' && t.mode === 'add' && rawActive(d) ? 0 : v;
}

/** Who completed which weekly chore during the week containing k (any day Mon–Sun). */
function weeklyDoneOn(choreId, k) {
  const ws = weekStart(k);
  for (let i = 0; i < 7; i++) {
    const dk = addDays(ws, i);
    if (S.days[dk]?.c?.[choreId]) return dk;
  }
  return null;
}

function dayStats(k) {
  const d = peekDay(k);
  let goals = 0, hit = 0, logged = 0, xp = 0, choresDone = 0;
  for (const t of activeTrackers()) {
    const val = d.v[t.id];
    if (val != null) { logged++; xp += XP.log; }
    if (t.dir === 'none' || t.goal == null) continue; // "just log" trackers are optional
    goals++;
    if (trackerMet(t, d)) { hit++; xp += XP.goal; }
  }
  for (const c of S.chores) {
    const done = !!d.c[c.id];
    if (done) { xp += c.pts; choresDone++; }
    if (c.freq === 'daily') { goals++; if (done) hit++; }
  }
  const meals = mealEntries(d).length;
  xp += meals * XP.log;
  const todosDone = (d.t || []).length;
  xp += todosDone * XP.log;
  const exercisesDone = (d.w || []).filter((e) => doneSets(e).length).length;
  const setsDone = (d.w || []).reduce((n, e) => n + doneSets(e).length, 0);
  xp += exercisesDone * XP.log;
  const perfect = goals > 0 && hit === goals;
  if (perfect) xp += XP.perfect;
  return { goals, hit, score: goals ? hit / goals : 0, xp, perfect, logged, choresDone, meals, todosDone, exercisesDone, setsDone, prList: [], active: logged + choresDone + meals + todosDone + exercisesDone > 0 };
}

const levelFloor = (L) => 50 * L * (L - 1); // XP needed to reach level L (L2=100, L3=300, L4=600…)
const levelOf = (xp) => { let L = 1; while (xp >= levelFloor(L + 1)) L++; return L; };
const TITLES = [[1, 'Novice'], [3, 'Apprentice'], [5, 'Regular'], [8, 'Committed'], [12, 'Disciplined'], [16, 'Machine'], [22, 'Legend'], [30, 'Mythic']];
const titleOf = (L) => TITLES.filter(([l]) => L >= l).pop()[1];

/** One pass over every day since the first entry: XP, streaks, per-tracker aggregates. */
function computeAll() {
  const today = todayKey();
  const keys = Object.keys(S.days).sort();
  const first = keys.length && keys[0] < today ? keys[0] : today;
  const perDay = {};
  const agg = { total: 0, streak: 0, best: 0, perfect: 0, bestPerfectRun: 0, activeDays: 0, chores: 0, meals: 0, todos: 0, sets: 0, prs: 0, trackers: {} };
  const bests = {}; // `${exercise}|w` or `${exercise}|r` → best so far (for personal records)
  for (const t of S.trackers) agg.trackers[t.id] = { logged: 0, goalDays: 0, max: -Infinity, sum: 0, run: 0, bestRun: 0 };
  let streak = 0, perfectRun = 0;
  for (let k = first; k <= today; k = addDays(k, 1)) {
    const st = dayStats(k);
    const d = peekDay(k);
    if (st.active) { streak++; agg.activeDays++; } else if (k !== today) streak = 0;
    if (st.perfect) { perfectRun++; agg.perfect++; } else if (k !== today) perfectRun = 0;
    for (const e of d.w || []) {
      const top = topOf(doneSets(e));
      if (!top) continue;
      const bk = `${e.ex.toLowerCase()}|${top.kind}`;
      if (bests[bk] != null && top.value > bests[bk]) { st.prList.push({ ex: e.ex, ...top }); st.xp += XP.pr; }
      bests[bk] = Math.max(bests[bk] ?? -Infinity, top.value);
    }
    const bonus = st.active ? Math.min(streak, XP.streakCap) * XP.streakPer : 0;
    st.streakBonus = bonus; st.xp += bonus; st.streak = streak;
    perDay[k] = st;
    agg.total += st.xp;
    agg.chores += st.choresDone;
    agg.meals += st.meals;
    agg.todos += st.todosDone;
    agg.sets += st.setsDone;
    agg.prs += st.prList.length;
    agg.best = Math.max(agg.best, streak);
    agg.bestPerfectRun = Math.max(agg.bestPerfectRun, perfectRun);
    for (const t of S.trackers) {
      const a = agg.trackers[t.id], val = d.v[t.id], ev = effVal(t, d);
      if (val != null) { a.logged++; a.sum += val; a.max = Math.max(a.max, val); }
      if (t.dir !== 'none' && ((ev != null && goalMet(t, ev)) || trackerMet(t, d))) { a.goalDays++; a.run++; a.bestRun = Math.max(a.bestRun, a.run); }
      else if (k !== today) a.run = 0;
    }
  }
  agg.streak = streak;
  agg.level = levelOf(agg.total);
  agg.perDay = perDay;
  return agg;
}

/** Best set of a session: heaviest weight, or most reps if no weight was used (bodyweight). */
function topOf(sets) {
  const weighted = sets.filter((x) => x.w > 0);
  if (weighted.length) return { kind: 'w', value: Math.max(...weighted.map((x) => x.w)) };
  const reps = sets.filter((x) => x.r > 0);
  return reps.length ? { kind: 'r', value: Math.max(...reps.map((x) => x.r)) } : null;
}

/* ---- Badges: each returns [current, target] so locked ones show progress ---- */
const tr = (a, id) => a.trackers[id] || { logged: 0, goalDays: 0, max: 0, sum: 0, bestRun: 0 };
const BADGES = [
  { id: 'first', ico: '🌱', name: 'First Step', desc: 'Log anything', p: (a) => [a.activeDays, 1] },
  { id: 'streak3', ico: '🔥', name: 'Warming Up', desc: '3-day streak', p: (a) => [a.best, 3] },
  { id: 'streak7', ico: '📆', name: 'Full Week', desc: '7-day streak', p: (a) => [a.best, 7] },
  { id: 'streak30', ico: '🗓️', name: 'Habit Formed', desc: '30-day streak', p: (a) => [a.best, 30] },
  { id: 'streak100', ico: '💯', name: 'Centurion', desc: '100-day streak', p: (a) => [a.best, 100] },
  { id: 'perfect1', ico: '⭐', name: 'Perfect Day', desc: 'Hit every goal in a day', p: (a) => [a.perfect, 1] },
  { id: 'perfect10', ico: '🌟', name: 'Ten Stars', desc: '10 perfect days', p: (a) => [a.perfect, 10] },
  { id: 'perfectweek', ico: '👑', name: 'Flawless Week', desc: '7 perfect days in a row', p: (a) => [a.bestPerfectRun, 7] },
  { id: 'steps10k', ico: '🚶', name: '10K Day', desc: '10,000 steps in a day', p: (a) => [Math.max(0, tr(a, 'steps').max), 10000] },
  { id: 'steps1m', ico: '🌍', name: 'Million Stepper', desc: '1,000,000 total steps', p: (a) => [tr(a, 'steps').sum, 1e6] },
  { id: 'sleep7', ico: '🛌', name: 'Well Rested', desc: 'Sleep goal 7 nights in a row', p: (a) => [tr(a, 'sleep').bestRun, 7] },
  { id: 'work10', ico: '🏋️', name: 'Gym Regular', desc: 'Workout goal on 10 days', p: (a) => [tr(a, 'workout').goalDays, 10] },
  { id: 'work50', ico: '🦾', name: 'Iron Will', desc: 'Workout goal on 50 days', p: (a) => [tr(a, 'workout').goalDays, 50] },
  { id: 'snack7', ico: '🍎', name: 'Snack Control', desc: 'Under your snack limit 7 days in a row', p: (a) => [tr(a, 'snacks').bestRun, 7] },
  { id: 'sets100', ico: '🏋️‍♂️', name: 'Iron Logger', desc: 'Log 100 sets', p: (a) => [a.sets, 100] },
  { id: 'pr10', ico: '🥇', name: 'PR Hunter', desc: 'Set 10 personal records', p: (a) => [a.prs, 10] },
  { id: 'todo25', ico: '🗡️', name: 'Task Slayer', desc: 'Finish 25 to-dos', p: (a) => [a.todos, 25] },
  { id: 'meals50', ico: '🍽️', name: 'Food Diary', desc: 'Log 50 meals', p: (a) => [a.meals, 50] },
  { id: 'water30', ico: '🌊', name: 'Hydrated', desc: 'Water goal on 30 days', p: (a) => [tr(a, 'water').goalDays, 30] },
  { id: 'weigh14', ico: '📉', name: 'On the Scale', desc: 'Log weight 14 times', p: (a) => [tr(a, 'weight').logged, 14] },
  { id: 'chores50', ico: '🧹', name: 'Clean Machine', desc: '50 chores done', p: (a) => [a.chores, 50] },
  { id: 'chores250', ico: '🏠', name: 'Home Hero', desc: '250 chores done', p: (a) => [a.chores, 250] },
  { id: 'lvl5', ico: '🎖️', name: 'Level 5', desc: 'Reach level 5', p: (a) => [a.level, 5] },
  { id: 'lvl10', ico: '🏅', name: 'Level 10', desc: 'Reach level 10', p: (a) => [a.level, 10] },
  { id: 'lvl20', ico: '🏆', name: 'Level 20', desc: 'Reach level 20', p: (a) => [a.level, 20] },
];
const unlocked = (a) => BADGES.filter((b) => { const [c, t] = b.p(a); return c >= t; });

/** After any change: celebrate new goals, perfect days, level-ups and badges. */
function afterChange(k, before) {
  save();
  const a = computeAll();
  const now = a.perDay[k] || dayStats(k);
  if (before && now.prList.length > (before.prList || []).length) {
    const pr = now.prList[now.prList.length - 1];
    toast(`🏆 New PR! ${pr.ex}: ${pr.kind === 'w' ? fmt(pr.value, S.wUnit) : `${pr.value} reps`} (+${XP.pr} XP)`);
    confetti(180); vibrate([30, 50, 30]);
  }
  if (before) {
    if (now.perfect && !before.perfect) { toast('⭐ Perfect day! +50 XP'); confetti(160); vibrate([20, 40, 20]); }
    else if (now.hit > before.hit) { confetti(40); vibrate(15); }
  }
  if (a.level > S.lastLevel) {
    toast(`🎉 Level up! You're level ${a.level} — ${titleOf(a.level)}`); confetti(200);
  }
  S.lastLevel = Math.max(S.lastLevel, a.level);
  const newOnes = unlocked(a).filter((b) => !S.seenBadges.includes(b.id));
  for (const b of newOnes) { toast(`${b.ico} Badge unlocked: ${b.name}`); S.seenBadges.push(b.id); }
  if (newOnes.length) confetti(120);
  save();
  render();
}

/* ======================= Mutations ======================= */
function setValue(k, id, val, { add = false } = {}) {
  const before = (computeAll().perDay[k]) || dayStats(k);
  const d = day(k);
  if (val == null || val === '' || Number.isNaN(val)) delete d.v[id];
  else d.v[id] = round(add ? (d.v[id] || 0) + val : val, 3);
  afterChange(k, before);
}
function toggleChore(k, id) {
  const before = (computeAll().perDay[k]) || dayStats(k);
  const c = S.chores.find((x) => x.id === id);
  if (c?.freq === 'weekly') {
    const doneOn = weeklyDoneOn(id, k);
    if (doneOn) delete S.days[doneOn].c[id]; else day(k).c[id] = 1;
  } else {
    const d = day(k);
    if (d.c[id]) delete d.c[id]; else d.c[id] = 1;
  }
  vibrate(8);
  afterChange(k, before);
}

/* ======================= UI: toast, confetti, sheet, tooltip ======================= */
function toast(msg, action) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  if (action) {
    $$('.toast.has-action').forEach((t) => t.remove()); // only the latest action stays undoable
    const b = document.createElement('button');
    b.className = 'toast-action'; b.textContent = action.label;
    b.onclick = () => { el.remove(); action.fn(); };
    el.append(b); el.classList.add('has-action');
  }
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, action ? 4500 : 2600);
}

function confetti(n = 80) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = $('#confetti'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.scale(dpr, dpr);
  const colors = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'];
  const parts = Array.from({ length: n }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 80, y: innerHeight * .35,
    vx: (Math.random() - .5) * 12, vy: -Math.random() * 12 - 4,
    r: Math.random() * 6 + 4, c: colors[(Math.random() * colors.length) | 0], a: Math.random() * 6, va: (Math.random() - .5) * .4,
  }));
  let frame = 0;
  (function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += .35; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.a += p.va;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c;
      ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore();
    }
    if (++frame < 120) requestAnimationFrame(tick); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })();
}

function openSheet(html, onMount) {
  const sh = $('#sheet'), bd = $('#sheet-backdrop');
  sh.innerHTML = `<div class="grab"></div>${html}`;
  sh.hidden = false; bd.hidden = false;
  bd.onclick = closeSheet;
  onMount && onMount(sh);
}
function closeSheet() { $('#sheet').hidden = true; $('#sheet-backdrop').hidden = true; $('#sheet').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheet(); hideTip(); } });

function showTip(html, x, y) {
  const t = $('#tooltip');
  t.innerHTML = html; t.hidden = false;
  const w = t.offsetWidth;
  t.style.left = `${clamp(x, w / 2 + 8, innerWidth - w / 2 - 8)}px`;
  t.style.top = `${Math.max(y, t.offsetHeight + 20)}px`;
}
function hideTip() { $('#tooltip').hidden = true; }
document.addEventListener('pointerdown', (e) => { if (!e.target.closest('[data-tip-host]')) hideTip(); });
addEventListener('scroll', hideTip, { passive: true });

/* ======================= Views ======================= */
let tab = 'today';
let viewDay = todayKey();
let range = 30;

function render() {
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  hideTip();
  ({ today: renderToday, dash: renderDash, rewards: renderRewards, settings: renderSettings })[tab]();
}

/* ---------- Today ---------- */
function ringSVG(frac, color = 'var(--accent)') {
  const r = 44, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 104 104" aria-hidden="true">
    <circle cx="52" cy="52" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="10"/>
    <circle cx="52" cy="52" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" style="transition: stroke-dashoffset .5s"/>
  </svg>`;
}

function renderToday() {
  const a = computeAll();
  const k = viewDay, isToday = k === todayKey();
  const st = a.perDay[k] || dayStats(k);
  const d = peekDay(k);
  const L = a.level, lo = levelFloor(L), hi = levelFloor(L + 1);
  const title = isToday ? 'Today' : daysBetween(k, todayKey()) === 1 ? 'Yesterday' : dayLabel(k, { weekday: 'long' });

  const tiles = activeTrackers().map((t) => {
    const hasGoal = t.dir !== 'none' && t.goal != null;
    const isLimit = hasGoal && t.dir === 'max';
    // Limit counters (snacks) always show a number: not tapping means zero.
    const val = isLimit && t.mode === 'add' ? (d.v[t.id] ?? 0) : d.v[t.id];
    const met = !isLimit && hasGoal && trackerMet(t, d);
    const over = isLimit && val != null && !goalMet(t, val);
    const goalTxt = !hasGoal ? '' : ` <small>/ ${fmt(t.goal)}${isLimit ? ' max' : ''}</small>`;
    const barW = isLimit ? clamp((val ?? 0) / (t.goal || 1), 0, 1) : met ? 1 : progress(t, val);
    return `<button class="tile ${met ? 'met' : ''} ${over ? 'over' : ''}" data-log="${t.id}" aria-label="Log ${esc(t.name)}">
      ${met ? '<span class="badge-met">✓ goal</span>' : ''}
      ${over ? '<span class="badge-met badge-over">over limit</span>' : ''}
      ${isLimit && !over && val > 0 ? `<span class="badge-met badge-left">${round(t.goal - val, 2)} left</span>` : ''}
      <span class="name">${esc(t.icon)} ${esc(t.name)}</span>
      ${val == null ? `<span class="val empty">${met ? 'Strength ✓' : 'Tap to log'}</span>` : `<span class="val">${fmt(val)}${goalTxt}</span>`}
      ${t.unit && val != null ? `<span class="small muted">${esc(t.unit)}</span>` : ''}
      ${t.mode === 'add' ? `<span class="quick" data-quick="${t.id}" role="button" aria-label="Add ${t.step} ${esc(t.unit)}">+</span>` : ''}
      <span class="bar"><i style="width:${barW * 100}%"></i></span>
    </button>`;
  }).join('');

  const daily = S.chores.filter((c) => c.freq === 'daily');
  const weekly = S.chores.filter((c) => c.freq === 'weekly');
  const choreRow = (c) => {
    const doneOn = c.freq === 'weekly' ? weeklyDoneOn(c.id, k) : (d.c[c.id] ? k : null);
    const when = c.freq === 'weekly' && doneOn && doneOn !== k ? `<span class="when">done ${dayLabel(doneOn, { weekday: 'short' })}</span>` : '';
    return `<button class="chore ${doneOn ? 'done' : ''}" data-chore="${c.id}" role="checkbox" aria-checked="${!!doneOn}">
      <span class="box">${doneOn ? '✓' : ''}</span><span><span class="cname">${esc(c.name)}</span>${when ? `<br>${when}` : ''}</span>
      <span class="pts">+${c.pts}</span></button>`;
  };

  $('#view').innerHTML = `
    <div class="datebar">
      <button class="iconbtn" data-nav="-1" aria-label="Previous day">‹</button>
      <h1>${title}<span class="sub">${dayLabel(k)}</span></h1>
      <button class="iconbtn" data-nav="1" aria-label="Next day" ${isToday ? 'disabled' : ''}>›</button>
    </div>

    <section class="card hero">
      <div class="ring">${ringSVG(st.score, st.perfect ? 'var(--good)' : 'var(--accent)')}
        <div class="label"><div><div class="pct tnum">${Math.round(st.score * 100)}%</div><div class="cap">${st.hit}/${st.goals} goals</div></div></div>
      </div>
      <div class="hero-stats">
        <div class="stat-line"><span style="font-size:22px">🔥</span><b class="tnum">${a.streak}</b><span class="muted">day streak${a.streak && isToday && !st.active ? ' — log to keep it!' : ''}</span></div>
        <div class="stat-line"><span style="font-size:22px">✨</span><b class="tnum">+${st.xp}</b><span class="muted">XP ${isToday ? 'today' : 'this day'}</span></div>
        <div>
          <div class="row small" style="white-space:nowrap;gap:6px"><b>Lv ${L}</b><span class="muted" style="overflow:hidden;text-overflow:ellipsis">${titleOf(L)}</span><span class="spacer"></span><span class="muted tnum">${a.total - lo}/${hi - lo}</span></div>
          <div class="xpbar" style="margin-top:4px"><i style="width:${((a.total - lo) / (hi - lo)) * 100}%"></i></div>
        </div>
      </div>
    </section>

    <h2>Track</h2>
    <section class="tiles">${tiles || '<p class="muted">No trackers enabled — add some in Settings.</p>'}</section>

    ${strengthHTML(k, d)}

    ${todosHTML(k, isToday, d)}

    ${S.meals.length ? `<h2>Meals</h2><section class="card meals">${S.meals.map((m, i) => `
      <label class="meal"><span class="mname">${esc(m)}</span>
        <input data-meal="${esc(m)}" value="${esc(d.m?.[m] ?? '')}" placeholder="What did you have?" list="ml-${i}" enterkeyhint="done" autocomplete="off" autocapitalize="sentences"></label>
      <datalist id="ml-${i}">${pastMeals(m).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`).join('')}</section>` : ''}

    ${daily.length ? `<h2>Daily chores</h2><section class="card chores">${daily.map(choreRow).join('')}</section>` : ''}
    ${weekly.length ? `<h2>This week</h2><section class="card chores">${weekly.map(choreRow).join('')}</section>` : ''}
  `;

  $$('[data-nav]').forEach((b) => b.onclick = () => { viewDay = addDays(viewDay, +b.dataset.nav); if (viewDay > todayKey()) viewDay = todayKey(); render(); });
  $$('[data-log]').forEach((b) => b.onclick = (e) => {
    if (e.target.closest('[data-quick]')) return;
    openLogSheet(b.dataset.log, k);
  });
  $$('[data-quick]').forEach((b) => b.onclick = (e) => {
    e.stopPropagation();
    const t = S.trackers.find((x) => x.id === b.dataset.quick);
    setValue(k, t.id, t.step, { add: true });
    toast(`${t.icon} +${t.step} ${t.unit}`);
  });
  $$('[data-chore]').forEach((b) => b.onclick = () => toggleChore(k, b.dataset.chore));
  bindMeals(k);
  bindTodos(k);
  bindStrength(k);
}

/* ---------- Strength training ---------- */
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Most recent earlier session of an exercise with at least one completed set. */
function lastSession(ex, beforeKey) {
  for (const dk of Object.keys(S.days).sort().reverse()) {
    if (dk >= beforeKey) continue;
    const e = (S.days[dk].w || []).find((x) => sameName(x.ex, ex) && doneSets(x).length);
    if (e) return { date: dk, sets: doneSets(e) };
  }
  return null;
}
function summarizeSets(sets, unit = S.wUnit) {
  if (!sets.length) return '';
  const same = sets.every((x) => x.w === sets[0].w && x.r === sets[0].r);
  if (same) return `${sets.length}×${sets[0].r ?? '?'}${sets[0].w > 0 ? ` @ ${fmt(sets[0].w, unit)}` : ''}`;
  return sets.map((x) => (x.w > 0 ? `${fmt(x.w)}×${x.r ?? '?'}` : `${x.r ?? '?'} reps`)).join(', ') + (sets.some((x) => x.w > 0) ? ` ${unit}` : '');
}
function allExerciseNames() {
  const names = [...(S.exercises || [])];
  for (const d of Object.values(S.days)) for (const e of d.w || []) if (!names.some((n) => sameName(n, e.ex))) names.push(e.ex);
  return names;
}

function strengthHTML(k, d) {
  if (!S.strength) return '';
  const u = S.wUnit;
  const cards = (d.w || []).map((e, ei) => {
    const last = lastSession(e.ex, k);
    const lastTxt = last ? `Last time (${dayLabel(last.date, { month: 'short', day: 'numeric' })}): ${summarizeSets(last.sets)}` : 'First time — this sets your baseline';
    const rows = e.sets.map((x, si) => `
      <div class="set ${x.done ? 'done' : ''}">
        <span class="sn">${si + 1}</span>
        <input class="inp" data-sw="${ei}.${si}" type="number" inputmode="decimal" step="any" value="${x.w ?? ''}" placeholder="—" aria-label="${esc(e.ex)} set ${si + 1} weight (${u})">
        <input class="inp" data-sr="${ei}.${si}" type="number" inputmode="numeric" value="${x.r ?? ''}" placeholder="—" aria-label="${esc(e.ex)} set ${si + 1} reps">
        <button class="setok" data-setdone="${ei}.${si}" aria-pressed="${!!x.done}" aria-label="${esc(e.ex)} set ${si + 1} done">${x.done ? '✓' : ''}</button>
      </div>`).join('');
    return `<div class="exercise">
      <div class="exhead"><b>${esc(e.ex)}</b><span class="spacer"></span><button class="x" data-exdel="${ei}" aria-label="Remove ${esc(e.ex)}">✕</button></div>
      <div class="small muted">${lastTxt}</div>
      <div class="set sethead"><span>Set</span><span>${u}</span><span>Reps</span><span>Done</span></div>
      ${rows}
      <button class="btn addset" data-addset="${ei}">+ Set</button>
    </div>`;
  }).join('');
  return `<h2>Strength <span class="muted small" style="text-transform:none;letter-spacing:0">+${XP.log} XP per exercise · +${XP.pr} per PR</span></h2>
    <section class="card strength">${cards}<button class="btn block" id="addex">+ Add exercise</button></section>`;
}

function addExercise(k, name) {
  name = String(name).trim().slice(0, 60);
  if (!name) return;
  const d = day(k);
  d.w ||= [];
  const existing = d.w.findIndex((e) => sameName(e.ex, name));
  if (existing < 0) {
    const last = lastSession(name, k);
    // Pre-fill with exactly what you did last time — just tick each set as you go.
    const sets = last ? last.sets.map((x) => ({ w: x.w ?? null, r: x.r ?? null, done: false })) : [{ w: null, r: null, done: false }];
    d.w.push({ ex: last ? (S.days[last.date].w.find((e) => sameName(e.ex, name))?.ex || name) : name, sets });
  }
  if (!(S.exercises ||= []).some((n) => sameName(n, name))) S.exercises.push(name);
  save(); render();
  const ex = $$('.exercise')[existing < 0 ? d.w.length - 1 : existing];
  ex?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function openExercisePicker(k) {
  // Most recently trained first, then the rest alphabetically.
  const lastDate = {};
  for (const dk of Object.keys(S.days).sort()) for (const e of S.days[dk].w || []) if (doneSets(e).length) lastDate[e.ex.toLowerCase()] = dk;
  const names = allExerciseNames().sort((a, b) => (lastDate[b.toLowerCase()] || '').localeCompare(lastDate[a.toLowerCase()] || '') || a.localeCompare(b));
  const row = (n) => {
    const last = lastSession(n, addDays(k, 1));
    return `<button class="pick" data-pick="${esc(n)}"><b>${esc(n)}</b>${last ? `<span class="small muted">${dayLabel(last.date, { month: 'short', day: 'numeric' })} · ${summarizeSets(last.sets)}</span>` : ''}</button>`;
  };
  openSheet(`
    <h3>Add exercise</h3>
    <input class="inp" id="exsearch" placeholder="Search or type a new exercise" autocomplete="off" autocapitalize="words" enterkeyhint="done" style="margin:10px 0">
    <div class="picklist" id="picklist">${names.map(row).join('')}</div>`, (sh) => {
    const inp = $('#exsearch', sh), list = $('#picklist', sh);
    const draw = () => {
      const q = inp.value.trim().toLowerCase();
      const hits = names.filter((n) => n.toLowerCase().includes(q));
      const exact = names.some((n) => n.toLowerCase() === q);
      const addNew = q && !exact ? `<button class="pick new" data-pick="${esc(inp.value.trim())}"><b>+ Add “${esc(inp.value.trim())}”</b></button>` : '';
      list.innerHTML = hits.map(row).join('') + addNew;
    };
    inp.oninput = draw;
    // Enter picks the best existing match; only creates a new exercise when nothing matches.
    inp.onkeydown = (e) => { if (e.key === 'Enter') { const first = $('[data-pick]', list); if (first) first.click(); } };
    list.onclick = (e) => { const b = e.target.closest('[data-pick]'); if (!b) return; closeSheet(); addExercise(k, b.dataset.pick); };
    inp.focus();
  });
}

function bindStrength(k) {
  const sec = $('.strength');
  if (!sec) return;
  const at = (ref) => { const [ei, si] = ref.split('.').map(Number); return { e: day(k).w[ei], x: day(k).w[ei].sets[si] }; };
  const num = (v) => (v === '' || v == null || Number.isNaN(parseFloat(v)) ? null : round(parseFloat(v), 2));
  $('#addex').onclick = () => openExercisePicker(k);
  $$('[data-sw]', sec).forEach((inp) => inp.onchange = () => { at(inp.dataset.sw).x.w = num(inp.value); save(); });
  $$('[data-sr]', sec).forEach((inp) => inp.onchange = () => { at(inp.dataset.sr).x.r = num(inp.value); save(); });
  $$('[data-setdone]', sec).forEach((b) => b.onclick = () => {
    const ref = b.dataset.setdone, { x } = at(ref);
    // Read the boxes directly so a value typed just before tapping ✓ is never lost.
    x.w = num($(`[data-sw="${ref}"]`, sec).value);
    x.r = num($(`[data-sr="${ref}"]`, sec).value);
    if (!x.done && !(x.r > 0)) { toast('Enter reps first'); $(`[data-sr="${ref}"]`, sec).focus(); return; }
    const before = computeAll().perDay[k] || dayStats(k);
    x.done = !x.done;
    vibrate(10);
    afterChange(k, before);
  });
  $$('[data-addset]', sec).forEach((b) => b.onclick = () => {
    const e = day(k).w[+b.dataset.addset];
    const prev = e.sets[e.sets.length - 1];
    e.sets.push({ w: prev?.w ?? null, r: prev?.r ?? null, done: false });
    save(); render();
  });
  $$('[data-exdel]', sec).forEach((b) => b.onclick = () => {
    const d = day(k), i = +b.dataset.exdel, e = d.w[i];
    if (doneSets(e).length && !confirm(`Remove ${e.ex} and its ${doneSets(e).length} logged set(s) from this day?`)) return;
    const before = computeAll().perDay[k] || dayStats(k);
    d.w.splice(i, 1);
    if (!d.w.length) delete d.w;
    afterChange(k, before);
  });
}

/* ---------- Ad-hoc to-dos ---------- */
function todosHTML(k, isToday, d) {
  const done = d.t || [];
  const doneList = done.length
    ? `<details class="table todo-done"><summary>${done.length} done ${isToday ? 'today' : 'this day'} · +${done.length * XP.log} XP</summary><ul>${done.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`
    : '';
  if (!isToday) return done.length ? `<h2>To-dos</h2><section class="card todos">${doneList}</section>` : '';
  const items = S.todos.map((t) => `
    <div class="todo" data-todo="${t.id}">
      <button class="box" data-todo-done="${t.id}" role="checkbox" aria-checked="false" aria-label="Mark done: ${esc(t.text)}"></button>
      <span class="ttext">${esc(t.text)}${t.created < k ? `<span class="when">from ${dayLabel(t.created, { weekday: 'short' })}</span>` : ''}</span>
      <button class="x" data-todo-del="${t.id}" aria-label="Delete ${esc(t.text)}">✕</button>
    </div>`).join('');
  return `<h2>To-dos <span class="muted small" style="text-transform:none;letter-spacing:0">+${XP.log} XP each</span></h2>
    <section class="card todos">
      <form class="todo-add" autocomplete="off">
        <input id="todo-new" placeholder="Add a to-do…" enterkeyhint="send" autocapitalize="sentences" aria-label="New to-do">
        <button class="btn primary" aria-label="Add to-do">Add</button>
      </form>
      ${items}${doneList}
    </section>`;
}

function addTodo(text, created = todayKey()) {
  text = String(text).trim().slice(0, 200);
  if (!text) return false;
  (S.todos ||= []).push({ id: 't-' + uid(), text, created });
  return true;
}

function bindTodos(k) {
  const form = $('.todo-add');
  if (form) form.onsubmit = (e) => {
    e.preventDefault();
    const inp = $('#todo-new');
    if (!addTodo(inp.value)) return;
    save(); render();
    $('#todo-new').focus(); // ready for the next one
  };
  $$('[data-todo-done]').forEach((b) => b.onclick = () => {
    const i = S.todos.findIndex((t) => t.id === b.dataset.todoDone);
    if (i < 0) return;
    const row = b.closest('.todo');
    row.classList.add('done'); b.textContent = '✓'; vibrate(10);
    setTimeout(() => {
      const before = computeAll().perDay[k] || dayStats(k);
      const [t] = S.todos.splice(i, 1);
      (day(k).t ||= []).push(t.text);
      afterChange(k, before);
      toast(`✓ ${t.text}  +${XP.log} XP`, { label: 'Undo', fn: () => {
        const d = day(k), j = (d.t || []).lastIndexOf(t.text);
        if (j >= 0) d.t.splice(j, 1);
        if (d.t && !d.t.length) delete d.t;
        S.todos.splice(Math.min(i, S.todos.length), 0, t);
        afterChange(k, null);
      } });
    }, 280);
  });
  $$('[data-todo-del]').forEach((b) => b.onclick = () => {
    const i = S.todos.findIndex((t) => t.id === b.dataset.todoDel);
    if (i < 0) return;
    const [t] = S.todos.splice(i, 1);
    save(); render();
    toast('To-do deleted', { label: 'Undo', fn: () => { S.todos.splice(Math.min(i, S.todos.length), 0, t); save(); render(); } });
  });
}

/** Most recent distinct entries for a meal, for one-tap autocomplete. */
function pastMeals(meal) {
  const out = [];
  for (const dk of Object.keys(S.days).sort().reverse()) {
    const v = S.days[dk].m?.[meal]?.trim();
    if (v && !out.some((x) => x.toLowerCase() === v.toLowerCase())) out.push(v);
    if (out.length >= 20) break;
  }
  return out;
}

function bindMeals(k) {
  const sec = $('.meals');
  if (!sec) return;
  let before = null, timer = null;
  const storeAll = () => {
    const d = day(k);
    d.m ||= {};
    for (const inp of $$('[data-meal]', sec)) {
      const v = inp.value.trim();
      if (v) d.m[inp.dataset.meal] = v; else delete d.m[inp.dataset.meal];
    }
    if (!Object.keys(d.m).length) delete d.m;
    save();
  };
  let snap = null;
  sec.addEventListener('focusin', () => {
    if (before) return;
    before = computeAll().perDay[k] || dayStats(k);
    snap = JSON.stringify(peekDay(k).m || {});
  });
  sec.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(storeAll, 600); });
  sec.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-meal]')) e.target.blur(); });
  // Only re-render once focus has left the meals card, so moving between fields never loses your place.
  sec.addEventListener('focusout', () => setTimeout(() => {
    if (sec.contains(document.activeElement)) return;
    clearTimeout(timer);
    storeAll();
    const b = before; before = null;
    if (JSON.stringify(peekDay(k).m || {}) !== snap) afterChange(k, b);
  }, 0));
}

function lastValue(id, before) {
  for (let i = 1; i <= 60; i++) { const v = S.days[addDays(before, -i)]?.v?.[id]; if (v != null) return v; }
  return null;
}

function openLogSheet(id, k) {
  const t = S.trackers.find((x) => x.id === id);
  const cur = peekDay(k).v[id];
  const isAdd = t.mode === 'add';
  const last = lastValue(id, k);
  const presets = [...new Set([...(isAdd ? [] : last != null ? [last] : []), ...(t.presets || [])])];
  openSheet(`
    <h3>${esc(t.icon)} ${esc(t.name)}</h3>
    <div class="small muted">${isAdd ? `Today's total: <b>${fmt(cur ?? 0, t.unit)}</b> — enter an amount to add` : `${t.goal != null && t.dir !== 'none' ? `Goal: ${t.dir === 'max' ? '≤' : '≥'} ${fmt(t.goal, t.unit)}` : 'Just log it'}${last != null ? ` · last: ${fmt(last, t.unit)}` : ''}`}</div>
    <div class="stepper">
      <button class="btn" data-step="-1" aria-label="Decrease">−</button>
      <input class="bigin" id="logval" type="number" inputmode="decimal" step="any" placeholder="${isAdd ? t.step : (last ?? '0')}" value="${isAdd ? '' : (cur ?? '')}" aria-label="${esc(t.name)} value">
      <button class="btn" data-step="1" aria-label="Increase">+</button>
    </div>
    ${presets.length ? `<div class="chips">${presets.map((p) => `<button class="chip" data-preset="${p}">${isAdd ? '+' : ''}${fmtShort(p)}${p === last && !isAdd ? ' ↺' : ''}</button>`).join('')}</div>` : ''}
    <div class="actions">
      <button class="btn danger" id="clear">${cur != null ? 'Clear' : 'Cancel'}</button>
      <button class="btn primary" id="saveval">${isAdd ? 'Add' : 'Save'}</button>
    </div>`, (sh) => {
    const inp = $('#logval', sh);
    inp.focus(); inp.select?.();
    const commit = (v) => {
      if (v == null || Number.isNaN(v)) { closeSheet(); return; }
      closeSheet();
      setValue(k, id, v, { add: isAdd });
    };
    $$('[data-step]', sh).forEach((b) => b.onclick = () => {
      const base = inp.value === '' ? (isAdd ? 0 : (last ?? 0)) : parseFloat(inp.value);
      inp.value = round(Math.max(0, base + (+b.dataset.step) * (t.step || 1)), 3);
    });
    $$('[data-preset]', sh).forEach((b) => b.onclick = () => commit(parseFloat(b.dataset.preset)));
    $('#saveval', sh).onclick = () => commit(inp.value === '' ? NaN : parseFloat(inp.value));
    inp.onkeydown = (e) => { if (e.key === 'Enter') $('#saveval', sh).click(); };
    $('#clear', sh).onclick = () => { closeSheet(); if (cur != null) setValue(k, id, null); };
  });
}

/* ---------- Dashboard ---------- */
function renderDash() {
  const a = computeAll();
  const today = todayKey();
  const keys = Array.from({ length: range }, (_, i) => addDays(today, i - range + 1));
  const prevKeys = keys.map((k) => addDays(k, -range));
  const stOf = (k) => a.perDay[k] || dayStats(k);
  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : null);
  const avgScore = avg(keys.map((k) => stOf(k).score));
  const prevScore = avg(prevKeys.map((k) => stOf(k).score));
  const perfect = keys.filter((k) => stOf(k).perfect).length;
  const xpRange = keys.reduce((s, k) => s + stOf(k).xp, 0);
  const activeDays = keys.filter((k) => stOf(k).active).length;
  const delta = prevScore ? Math.round((avgScore - prevScore) * 100) : null;

  const trackerCards = activeTrackers().map((t, i) => {
    const vals = keys.map((k) => effVal(t, peekDay(k)) ?? null);
    const got = vals.filter((v) => v != null);
    const met = keys.filter((k, j) => vals[j] != null && goalMet(t, vals[j]) && t.dir !== 'none').length;
    const meta = t.id === 'weight' || t.dir === 'none'
      ? (got.length >= 2 ? `${fmt(got[got.length - 1], t.unit)} · ${got[got.length - 1] - got[0] >= 0 ? '+' : ''}${fmt(round(got[got.length - 1] - got[0], 1))} over ${range}d` : got.length ? fmt(got[0], t.unit) : 'no data yet')
      : `avg ${fmt(round(avg(got) ?? 0, 1))} · ${t.dir === 'max' ? 'within limit' : 'goal hit'} ${met}/${range}d`;
    const isLine = t.dir === 'none' || t.id === 'weight';
    return `<section class="card chart-card">
      <div class="head"><span class="title">${esc(t.icon)} ${esc(t.name)}</span><span class="meta">${meta}</span></div>
      <div data-chart="${i}" data-tip-host></div>
      ${!isLine && t.goal != null ? `<div class="legend"><span><i style="background:var(--series-1);height:10px;width:10px"></i>${t.dir === 'max' ? 'Within limit' : 'Goal met'}</span><span><i style="background:var(--series-1-soft);height:10px;width:10px"></i>${t.dir === 'max' ? 'Over limit' : 'Below goal'}</span><span><i style="background:none;border-top:2px dashed var(--text-secondary);height:0"></i>${t.dir === 'max' ? 'Limit' : 'Goal'} ${fmt(t.goal, t.unit)}</span></div>` : ''}
      ${isLine ? `<div class="legend"><span><i style="background:var(--series-1)"></i>Daily</span><span><i style="background:var(--series-2)"></i>7-day average</span></div>` : ''}
      ${tableHTML(keys, vals, t)}
    </section>`;
  }).join('');

  const chores = S.chores.map((c) => {
    let done, of;
    if (c.freq === 'weekly') {
      const weeks = [...new Set(keys.map(weekStart))];
      done = weeks.filter((w) => weeklyDoneOn(c.id, w)).length; of = weeks.length;
    } else { done = keys.filter((k) => peekDay(k).c[c.id]).length; of = range; }
    return `<span>${esc(c.name)} <span class="muted small">${c.freq}</span></span><span class="small tnum">${done}/${of}</span>
      <div class="track"><i style="width:${(done / of) * 100}%"></i></div>`;
  }).join('');

  $('#view').innerHTML = `
    <div class="row" style="margin-bottom:12px"><h1 style="margin:0">Dashboard</h1><span class="spacer"></span>
      <div class="seg" role="group" aria-label="Date range">${[7, 30, 90].map((r) => `<button data-range="${r}" class="${r === range ? 'on' : ''}">${r}d</button>`).join('')}</div>
    </div>
    <section class="kpis">
      <div class="card kpi"><div class="k">Avg daily score</div><div class="v">${Math.round((avgScore ?? 0) * 100)}%</div><div class="d">${delta == null ? 'vs previous period: —' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} pts vs previous ${range}d`}</div></div>
      <div class="card kpi"><div class="k">Current streak</div><div class="v">🔥 ${a.streak}</div><div class="d">best ever: ${a.best} days</div></div>
      <div class="card kpi"><div class="k">Perfect days</div><div class="v">${perfect}</div><div class="d">of last ${range} days</div></div>
      <div class="card kpi"><div class="k">XP earned</div><div class="v">${xpRange.toLocaleString()}</div><div class="d">${activeDays} active days</div></div>
    </section>

    <h2>Consistency · last 15 weeks</h2>
    <section class="card" data-tip-host>${heatmapHTML(a)}</section>

    <h2>Trackers · last ${range} days</h2>
    ${trackerCards}

    ${strengthDashHTML(keys)}

    ${mealsLogHTML(keys)}

    ${S.chores.length ? `<h2>Chore completion · last ${range} days</h2><section class="card hbar">${chores}</section>` : ''}
  `;

  $$('[data-range]').forEach((b) => b.onclick = () => { range = +b.dataset.range; render(); });
  drawStrengthChart(keys);
  activeTrackers().forEach((t, i) => {
    const host = $(`[data-chart="${i}"]`);
    const vals = keys.map((k) => effVal(t, peekDay(k)) ?? null);
    (t.dir === 'none' || t.id === 'weight' ? lineChart : barChart)(host, keys, vals, t);
  });
  $$('.heat .cell[data-k]').forEach((c) => {
    const tip = (e) => {
      const k = c.dataset.k, st = stOf(k);
      const r = c.getBoundingClientRect();
      showTip(`<b>${dayLabel(k)}</b><br>${st.active ? `${Math.round(st.score * 100)}% · ${st.hit}/${st.goals} goals${st.perfect ? ' ⭐' : ''}<br>+${st.xp} XP` : 'Nothing logged'}`, r.left + r.width / 2, r.top);
    };
    c.addEventListener('pointerenter', tip); c.addEventListener('pointerdown', tip);
    c.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hideTip());
  });
}

function mealsLogHTML(keys) {
  const days = keys.slice().reverse().filter((k) => mealEntries(peekDay(k)).length);
  if (!days.length) return '';
  const row = (k) => `<div class="meal-day"><div class="small muted">${dayLabel(k)}</div>
    ${mealEntries(peekDay(k)).map(([n, v]) => `<div><span class="muted">${esc(n)}:</span> ${esc(v)}</div>`).join('')}</div>`;
  return `<h2>Meals · last ${range} days</h2><section class="card meal-log">
    ${days.slice(0, 5).map(row).join('')}
    ${days.length > 5 ? `<details class="table"><summary>Show ${days.length - 5} more days</summary>${days.slice(5).map(row).join('')}</details>` : ''}
  </section>`;
}

let dashEx = null;
function strengthHistory() {
  // exercise (display name) → [{ date, sets }] oldest first
  const map = new Map();
  for (const dk of Object.keys(S.days).sort()) {
    for (const e of S.days[dk].w || []) {
      const sets = doneSets(e);
      if (!sets.length) continue;
      const key = [...map.keys()].find((n) => sameName(n, e.ex)) || e.ex;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ date: dk, sets });
    }
  }
  return map;
}
function strengthDashHTML(keys) {
  const hist = strengthHistory();
  if (!hist.size) return '';
  const byRecent = [...hist.entries()].sort((a, b) => b[1].at(-1).date.localeCompare(a[1].at(-1).date));
  if (!dashEx || !hist.has(dashEx)) dashEx = byRecent[0][0];
  const rows = byRecent.map(([ex, sessions]) => {
    const last = sessions.at(-1), best = topOf(sessions.flatMap((x) => x.sets));
    const inRange = sessions.filter((x) => x.date >= keys[0]).length;
    return `<tr><td>${esc(ex)}</td><td>${dayLabel(last.date, { month: 'short', day: 'numeric' })}<br><span class="muted">${summarizeSets(last.sets)}</span></td>
      <td style="white-space:nowrap">${best ? (best.kind === 'w' ? fmt(best.value, S.wUnit) : `${best.value} reps`) : '—'}</td><td>${inRange}</td></tr>`;
  }).join('');
  return `<h2>Strength · last ${range} days</h2>
    <section class="card chart-card">
      <div class="head"><select class="inp" id="dashex" aria-label="Exercise" style="width:auto;max-width:60%;padding:6px 10px">${byRecent.map(([ex]) => `<option ${ex === dashEx ? 'selected' : ''}>${esc(ex)}</option>`).join('')}</select>
        <span class="meta" id="dashexmeta"></span></div>
      <div id="strengthchart" data-tip-host></div>
      <details class="table" open><summary>All exercises</summary><table>
        <tr><th>Exercise</th><th>Last session</th><th>Best</th><th>${range}d</th></tr>${rows}</table></details>
    </section>`;
}
function drawStrengthChart(keys) {
  const host = $('#strengthchart');
  if (!host) return;
  const sessions = strengthHistory().get(dashEx) || [];
  const byDate = Object.fromEntries(sessions.map((x) => [x.date, x.sets]));
  const weighted = sessions.some((x) => x.sets.some((y) => y.w > 0));
  const vals = keys.map((k) => { const top = byDate[k] && topOf(byDate[k]); return top ? top.value : null; });
  const unit = weighted ? S.wUnit : 'reps';
  const n = vals.filter((v) => v != null).length;
  $('#dashexmeta').textContent = `${n} session${n === 1 ? '' : 's'} · top set ${weighted ? 'weight' : 'reps'}`;
  lineChart(host, keys, vals, { name: dashEx, unit, goal: null, dir: 'none' }, { avg: false, extra: (i) => (byDate[keys[i]] ? `<br>${summarizeSets(byDate[keys[i]])}` : '') });
  $('#dashex').onchange = (e) => { dashEx = e.target.value; drawStrengthChart(keys); };
}

function heatmapHTML(a) {
  const today = todayKey();
  const start = addDays(weekStart(today), -14 * 7);
  const cells = [];
  for (let i = 0; i < 15 * 7; i++) {
    const k = addDays(start, i);
    if (k > today) { cells.push('<div class="cell future"></div>'); continue; }
    const st = a.perDay[k];
    const lvl = !st || !st.active ? 0 : st.perfect ? 5 : 1 + Math.min(3, Math.floor(st.score * 4));
    cells.push(`<div class="cell ${k === today ? 'today' : ''}" data-k="${k}" style="background:var(--seq-${lvl})" aria-label="${dayLabel(k)}: ${st?.active ? Math.round(st.score * 100) + '%' : 'nothing logged'}"></div>`);
  }
  return `<div style="display:grid;grid-template-columns:auto 1fr;gap:6px;align-items:stretch">
      <div class="heat small muted" style="gap:3px;font-size:10px;line-height:1">${['M', '', 'W', '', 'F', '', 'S'].map((l) => `<div style="display:flex;align-items:center">${l}</div>`).join('')}</div>
      <div class="heat">${cells.join('')}</div>
    </div>
    <div class="heat-legend">None ${[0, 1, 2, 3, 4].map((l) => `<i style="background:var(--seq-${l})"></i>`).join('')} <i style="background:var(--seq-5)"></i> Perfect</div>`;
}

function tableHTML(keys, vals, t) {
  const rows = keys.map((k, i) => [k, vals[i]]).filter(([, v]) => v != null).reverse();
  if (!rows.length) return '';
  return `<details class="table"><summary>Table view (${rows.length} entries)</summary><table>
    <tr><th>Date</th><th>${esc(t.name)}${t.unit ? ` (${esc(t.unit)})` : ''}</th><th>Goal</th></tr>
    ${rows.map(([k, v]) => `<tr><td>${dayLabel(k)}</td><td>${fmt(v)}</td><td>${t.dir === 'none' ? '—' : goalMet(t, v) ? '✓' : '·'}</td></tr>`).join('')}
  </table></details>`;
}

/* ---- Charts: hand-built SVG, single y-axis, recessive grid, thin marks, hover/tap tooltip ---- */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function chartFrame(w, h, yMin, yMax, keys, pad) {
  const ticks = [0, .5, 1].map((f) => yMin + (yMax - yMin) * f);
  const y = (v) => pad.t + (h - pad.t - pad.b) * (1 - (v - yMin) / (yMax - yMin || 1));
  const grid = ticks.map((tv) => `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(tv)}" y2="${y(tv)}" stroke="var(--grid)" stroke-width="1"/>
    <text x="${pad.l - 6}" y="${y(tv) + 3}" text-anchor="end">${fmtShort(round(tv, 1))}</text>`).join('');
  const n = keys.length, every = n <= 7 ? 1 : n <= 30 ? 7 : 14;
  const xc = (i) => pad.l + ((w - pad.l - pad.r) / n) * (i + .5);
  const xl = keys.map((k, i) => ((n - 1 - i) % every === 0 ? `<text x="${xc(i)}" y="${h - 6}" text-anchor="middle">${n <= 7 ? dayLabel(k, { weekday: 'short' }) : dayLabel(k, { month: 'numeric', day: 'numeric' })}</text>` : '')).join('');
  return { y, xc, grid: grid + xl };
}
function attachHover(host, svg, keys, w, pad, tipFor, guideEl) {
  const pick = (e) => {
    const r = svg.getBoundingClientRect();
    const xv = ((e.clientX - r.left) / r.width) * w;
    const i = clamp(Math.floor(((xv - pad.l) / (w - pad.l - pad.r)) * keys.length), 0, keys.length - 1);
    const html = tipFor(i);
    if (!html) { hideTip(); guideEl && guideEl.setAttribute('opacity', 0); return; }
    const cx = r.left + (((w - pad.l - pad.r) / keys.length) * (i + .5) + pad.l) / w * r.width;
    if (guideEl) { const gx = pad.l + ((w - pad.l - pad.r) / keys.length) * (i + .5); guideEl.setAttribute('x1', gx); guideEl.setAttribute('x2', gx); guideEl.setAttribute('opacity', 1); }
    showTip(html, cx, r.top + 8);
  };
  svg.addEventListener('pointermove', pick);
  svg.addEventListener('pointerdown', pick);
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hideTip(); guideEl && guideEl.setAttribute('opacity', 0); } });
}

function barChart(host, keys, vals, t) {
  const w = 340, h = 150, pad = { t: 10, r: 6, b: 20, l: 34 };
  const maxV = niceMax(Math.max(t.goal || 0, ...vals.filter((v) => v != null), 1) * 1.05);
  const { y, xc, grid } = chartFrame(w, h, 0, maxV, keys, pad);
  const bw = Math.max(2, ((w - pad.l - pad.r) / keys.length) - 2);
  const r = Math.min(4, bw / 2);
  const bars = vals.map((v, i) => {
    if (v == null || v <= 0) return '';
    const x = xc(i) - bw / 2, top = y(v), base = y(0), hh = base - top, rr = Math.min(r, hh);
    const fill = goalMet(t, v) ? 'var(--series-1)' : 'var(--series-1-soft)';
    return `<path d="M${x},${base} V${top + rr} Q${x},${top} ${x + rr},${top} H${x + bw - rr} Q${x + bw},${top} ${x + bw},${top + rr} V${base} Z" fill="${fill}"/>`;
  }).join('');
  const goal = t.goal != null && t.dir !== 'none'
    ? `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t.goal)}" y2="${y(t.goal)}" stroke="var(--text-secondary)" stroke-width="1.5" stroke-dasharray="4 3"/>` : '';
  host.innerHTML = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(t.name)} per day, bar chart">${grid}${bars}${goal}
    <line class="guide" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--text-muted)" stroke-width="1" opacity="0"/></svg>`;
  const svg = $('svg', host);
  attachHover(host, svg, keys, w, pad, (i) => `<b>${dayLabel(keys[i])}</b><br>${vals[i] == null ? 'not logged' : `${fmt(vals[i], t.unit)}${t.dir !== 'none' && t.goal != null ? (goalMet(t, vals[i]) ? (t.dir === 'max' ? ' · within limit ✓' : ' · goal met ✓') : (t.dir === 'max' ? ' · over limit' : ' · below goal')) : ''}`}`, $('.guide', svg));
}

function lineChart(host, keys, vals, t, opts = {}) {
  const w = 340, h = 150, pad = { t: 12, r: 8, b: 20, l: 38 };
  const got = vals.filter((v) => v != null);
  if (!got.length) { host.innerHTML = `<p class="muted small" style="margin:20px 0;text-align:center">Log ${esc(t.name.toLowerCase())} to see your trend.</p>`; return; }
  // 7-day trailing average over logged values only
  const ma = vals.map((_, i) => { const win = vals.slice(Math.max(0, i - 6), i + 1).filter((v) => v != null); return win.length ? win.reduce((s, v) => s + v, 0) / win.length : null; });
  const firstIdx = vals.findIndex((v) => v != null);
  for (let i = 0; i < firstIdx; i++) ma[i] = null;
  if (opts.avg === false) ma.fill(null);
  let lo = Math.min(...got, ...(t.goal != null ? [t.goal] : [])), hi = Math.max(...got, ...(t.goal != null ? [t.goal] : []));
  const span = Math.max(hi - lo, 2); lo = Math.floor(lo - span * .2); hi = Math.ceil(hi + span * .2);
  const { y, xc, grid } = chartFrame(w, h, lo, hi, keys, pad);
  const path = (arr) => { let d = '', pen = false; arr.forEach((v, i) => { if (v == null) return; d += `${pen ? 'L' : 'M'}${xc(i)},${y(v)} `; pen = true; }); return d; };
  const dots = vals.map((v, i) => (v == null ? '' : `<circle cx="${xc(i)}" cy="${y(v)}" r="${keys.length > 45 ? 2.5 : 4}" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2"/>`)).join('');
  const goal = t.goal != null ? `<line x1="${pad.l}" x2="${w - pad.r}" y1="${y(t.goal)}" y2="${y(t.goal)}" stroke="var(--text-secondary)" stroke-width="1.5" stroke-dasharray="4 3"/>
    <text x="${pad.l + 4}" y="${y(t.goal) - 4}" style="fill:var(--text-secondary)">goal ${fmt(t.goal)}</text>` : '';
  host.innerHTML = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(t.name)} trend, line chart">${grid}${goal}
    <path d="${path(vals)}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" opacity=".55"/>
    <path d="${path(ma)}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round"/>
    ${dots}
    <line class="guide" y1="${pad.t}" y2="${h - pad.b}" stroke="var(--text-muted)" stroke-width="1" opacity="0"/>
  </svg>`;
  const svg = $('svg', host);
  attachHover(host, svg, keys, w, pad, (i) => `<b>${dayLabel(keys[i])}</b><br>${vals[i] == null ? 'not logged' : fmt(vals[i], t.unit)}${ma[i] != null ? `<br>7-day avg: ${fmt(round(ma[i], 1), t.unit)}` : ''}${opts.extra ? opts.extra(i) : ''}`, $('.guide', svg));
}

/* ---------- Rewards ---------- */
function renderRewards() {
  const a = computeAll();
  const L = a.level, lo = levelFloor(L), hi = levelFloor(L + 1);
  const next = TITLES.find(([l]) => l > L);
  const badges = BADGES.map((b) => {
    const [c, t] = b.p(a), done = c >= t;
    return `<div class="badge ${done ? '' : 'locked'}" title="${esc(b.desc)}">
      <div class="ico">${b.ico}</div><div class="bn">${esc(b.name)}</div><div class="bd">${esc(b.desc)}</div>
      ${done ? '' : `<div class="prog"><i style="width:${clamp(c / t, 0, 1) * 100}%"></i></div><div class="bd tnum">${fmtShort(Math.max(0, Math.floor(c)))}/${fmtShort(t)}</div>`}
    </div>`;
  }).join('');
  const got = BADGES.filter((b) => { const [c, t] = b.p(a); return c >= t; }).length;

  $('#view').innerHTML = `
    <h1>Rewards</h1>
    <section class="card levelcard">
      <div class="muted small">LEVEL</div>
      <div class="lvl">${L}</div>
      <div class="ttl">${titleOf(L)}</div>
      <div class="xpbar"><i style="width:${((a.total - lo) / (hi - lo)) * 100}%"></i></div>
      <div class="row small muted" style="margin-top:6px"><span class="tnum">${(a.total - lo).toLocaleString()} / ${(hi - lo).toLocaleString()} XP to level ${L + 1}</span><span class="spacer"></span>${next ? `<span>“${next[1]}” at Lv ${next[0]}</span>` : ''}</div>
    </section>
    <section class="kpis" style="margin-top:10px">
      <div class="card kpi"><div class="k">Total XP</div><div class="v">${a.total.toLocaleString()}</div></div>
      <div class="card kpi"><div class="k">Streak</div><div class="v">🔥 ${a.streak}</div><div class="d">best ${a.best}</div></div>
      <div class="card kpi"><div class="k">Perfect days</div><div class="v">⭐ ${a.perfect}</div></div>
      <div class="card kpi"><div class="k">Badges</div><div class="v">${got}/${BADGES.length}</div></div>
    </section>
    <h2>Badges</h2>
    <section class="badges">${badges}</section>
    <h2>How XP works</h2>
    <section class="card small"><ul class="rules" style="margin:0;padding-left:18px">
      <li><b>+${XP.log}</b> for each thing you log</li>
      <li><b>+${XP.goal}</b> for each goal you hit</li>
      <li><b>+points</b> shown next to each chore</li>
      <li><b>+${XP.perfect}</b> perfect-day bonus (every goal + daily chore)</li>
      <li><b>+${XP.streakPer}×streak</b> daily streak bonus (up to +${XP.streakPer * XP.streakCap}/day)</li>
      <li>Log <i>anything</i> each day to keep your 🔥 streak alive. You can backfill missed days with ‹ on the Today screen.</li>
    </ul></section>
  `;
}

/* ---------- Settings ---------- */
function renderSettings() {
  const base = location.href.split(/[?#]/)[0];
  const trackers = S.trackers.map((t, i) => `
    <details class="tracker" data-ti="${i}">
      <summary><span style="font-size:22px">${esc(t.icon)}</span><span>${esc(t.name)} <span class="muted">${t.goal != null && t.dir !== 'none' ? `${t.dir === 'max' ? '≤' : '≥'} ${fmt(t.goal, t.unit)}` : esc(t.unit)}</span></span><span class="spacer"></span>
        <input type="checkbox" class="switch" data-on="${i}" ${t.on ? 'checked' : ''} aria-label="Enable ${esc(t.name)}"></summary>
      <div class="grid3">
        <div class="field"><label>Icon</label><input data-f="icon" value="${esc(t.icon)}"></div>
        <div class="field" style="grid-column: span 2"><label>Name</label><input data-f="name" value="${esc(t.name)}"></div>
      </div>
      <div class="grid3">
        <div class="field"><label>Unit</label><input data-f="unit" value="${esc(t.unit)}"></div>
        <div class="field"><label>Goal type</label><select data-f="dir">
          <option value="min" ${t.dir === 'min' ? 'selected' : ''}>At least</option>
          <option value="max" ${t.dir === 'max' ? 'selected' : ''}>At most</option>
          <option value="none" ${t.dir === 'none' ? 'selected' : ''}>Just log</option></select></div>
        <div class="field"><label>Goal</label><input data-f="goal" type="number" inputmode="decimal" step="any" value="${t.goal ?? ''}"></div>
      </div>
      <div class="grid3">
        <div class="field"><label>Entry</label><select data-f="mode">
          <option value="set" ${t.mode === 'set' ? 'selected' : ''}>One value/day</option>
          <option value="add" ${t.mode === 'add' ? 'selected' : ''}>Adds up</option></select></div>
        <div class="field"><label>Step</label><input data-f="step" type="number" inputmode="decimal" step="any" value="${t.step ?? 1}"></div>
        <div class="field"><label>Quick picks</label><input data-f="presets" value="${esc((t.presets || []).join(', '))}"></div>
      </div>
      <div class="row small muted">Quick-log key: <code>${esc(t.id)}</code><span class="spacer"></span><button class="btn danger" data-deltracker="${i}">Delete</button></div>
    </details>`).join('');

  const chores = S.chores.map((c, i) => `
    <div class="chore-edit" data-ci="${i}">
      <input class="inp" data-cf="name" value="${esc(c.name)}" aria-label="Chore name">
      <select class="inp" data-cf="freq" aria-label="Frequency"><option value="daily" ${c.freq === 'daily' ? 'selected' : ''}>Daily</option><option value="weekly" ${c.freq === 'weekly' ? 'selected' : ''}>Weekly</option></select>
      <input class="inp" data-cf="pts" type="number" inputmode="numeric" value="${c.pts}" aria-label="XP points">
      <button class="x" data-delchore="${i}" aria-label="Delete ${esc(c.name)}">✕</button>
    </div>`).join('');

  $('#view').innerHTML = `
    <h1>Settings</h1>

    <h2>Trackers</h2>
    <section class="card">${trackers}
      <button class="btn block" id="addtracker" style="margin-top:10px">+ Add tracker</button>
    </section>

    <h2>Chores <span class="muted small" style="text-transform:none;letter-spacing:0">name · how often · XP</span></h2>
    <section class="card">${chores}
      <button class="btn block" id="addchore" style="margin-top:8px">+ Add chore</button>
    </section>

    <h2>Meals</h2>
    <section class="card small">
      <div class="field" style="margin-top:0"><label for="mealnames">Meals to log (comma-separated, leave empty to hide)</label>
        <input id="mealnames" value="${esc(S.meals.join(', '))}" placeholder="Breakfast, Lunch, Dinner"></div>
      <p class="muted" style="margin:0">Each logged meal earns +${XP.log} XP. Past entries show up as suggestions, so repeat meals take one tap.</p>
    </section>

    <h2>Strength training</h2>
    <section class="card small">
      <div class="row"><b>Show on the Today screen</b><span class="spacer"></span><input type="checkbox" class="switch" id="strengthon" ${S.strength ? 'checked' : ''} aria-label="Show strength training"></div>
      <div class="field"><label for="wunit">Weight unit</label><select id="wunit"><option ${S.wUnit === 'lb' ? 'selected' : ''}>lb</option><option ${S.wUnit === 'kg' ? 'selected' : ''}>kg</option></select></div>
      <p class="muted" style="margin:0">Each exercise starts pre-filled with your last session. Logging any exercise also counts as hitting your Workout goal for the day.</p>
    </section>

    <h2>Google Sheets</h2>
    <section class="card small" id="sheetscard">${sheetsHTML()}</section>

    <h2>Automatic logging</h2>
    <section class="card small">
      <p style="margin-top:0">Open a link like this to log without tapping through the app — perfect for an <b>iOS Shortcut</b> or <b>Android automation</b> that reads your step count / sleep from Health and runs every night:</p>
      <span class="code" id="qlurl">${esc(base)}?steps=8500&amp;sleep=7.5&amp;add_water=1&amp;chore=Dishes</span>
      <ul style="padding-left:18px;margin:6px 0">
        <li><code>tracker=value</code> sets a value (e.g. <code>weight=172.4</code>)</li>
        <li><code>add_tracker=value</code> adds to it (e.g. <code>add_workout=30</code>)</li>
        <li><code>chore=Name</code> ticks a chore (comma-separate several)</li>
        <li><code>lunch=Chicken salad</code> logs a meal by its name</li>
        <li><code>todo=Call dentist</code> adds a to-do (repeat for several)</li>
        <li><code>date=yesterday</code> or <code>date=2026-11-14</code> to log a past day</li>
      </ul>
      <button class="btn" id="copyurl">Copy example link</button>
    </section>

    <h2>Reminders</h2>
    <section class="card small">${remindersHTML()}</section>

    <h2>Appearance</h2>
    <section class="card"><div class="seg" role="group" aria-label="Theme">${['auto', 'light', 'dark'].map((m) => `<button data-theme-set="${m}" class="${S.theme === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div></section>

    <h2>Your data</h2>
    <section class="card small">
      <p style="margin-top:0">Everything is stored privately on this device. Export a backup now and then (or to move to a new phone).</p>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn" id="export">⬇️ Export backup</button>
        <label class="btn" style="display:inline-block">⬆️ Import<input type="file" id="import" accept="application/json,.json" hidden></label>
        <span class="spacer"></span>
        <button class="btn danger" id="reset">Reset all</button>
      </div>
    </section>

    <h2>Install on your phone</h2>
    <section class="card small">
      <p style="margin:0"><b>iPhone:</b> open this page in Safari → Share → <i>Add to Home Screen</i>.<br>
      <b>Android:</b> open in Chrome → ⋮ menu → <i>Install app</i> / <i>Add to Home screen</i>.</p>
    </section>
    <p class="muted small" style="text-align:center;margin-top:20px">LifeQuest · data never leaves your device</p>
  `;

  const commitTrackers = () => { save(); };
  $$('details.tracker').forEach((el) => {
    const t = S.trackers[+el.dataset.ti];
    $$('[data-f]', el).forEach((inp) => inp.onchange = () => {
      const f = inp.dataset.f, v = inp.value.trim();
      if (f === 'goal') t.goal = v === '' ? null : parseFloat(v);
      else if (f === 'step') t.step = parseFloat(v) || 1;
      else if (f === 'presets') t.presets = v.split(/[,\s]+/).map(parseFloat).filter((n) => !Number.isNaN(n));
      else t[f] = v;
      if (t.dir === 'none') t.goal = t.goal ?? null;
      commitTrackers();
      const summary = $('summary span:nth-child(2)', el);
      summary.innerHTML = `${esc(t.name)} <span class="muted">${t.goal != null && t.dir !== 'none' ? `${t.dir === 'max' ? '≤' : '≥'} ${fmt(t.goal, t.unit)}` : esc(t.unit)}</span>`;
      $('summary span', el).textContent = t.icon;
    });
  });
  $$('[data-on]').forEach((cb) => { cb.onclick = (e) => e.stopPropagation(); cb.onchange = () => { S.trackers[+cb.dataset.on].on = cb.checked; save(); }; });
  $$('[data-deltracker]').forEach((b) => b.onclick = () => {
    const t = S.trackers[+b.dataset.deltracker];
    if (confirm(`Delete “${t.name}”? Its history stays in your backup data but won't be shown.`)) { S.trackers.splice(+b.dataset.deltracker, 1); save(); render(); }
  });
  $('#addtracker').onclick = () => {
    const name = prompt('Tracker name (e.g. Meditation, Reading, Calories)');
    if (!name) return;
    let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || uid();
    while (S.trackers.some((t) => t.id === id)) id += '_2';
    S.trackers.push({ id, name, icon: '📌', unit: 'min', goal: 10, dir: 'min', mode: 'add', step: 5, presets: [5, 10, 15, 30], on: true });
    save(); render();
    const last = $$('details.tracker').pop(); last.open = true; last.scrollIntoView({ behavior: 'smooth' });
  };
  $$('.chore-edit').forEach((row) => {
    const c = S.chores[+row.dataset.ci];
    $$('[data-cf]', row).forEach((inp) => inp.onchange = () => {
      const f = inp.dataset.cf;
      c[f] = f === 'pts' ? Math.max(0, parseInt(inp.value, 10) || 0) : inp.value.trim() || c[f];
      save();
    });
  });
  $$('[data-delchore]').forEach((b) => b.onclick = () => { S.chores.splice(+b.dataset.delchore, 1); save(); render(); });
  $('#addchore').onclick = () => {
    S.chores.push({ id: 'c-' + uid(), name: 'New chore', freq: 'daily', pts: 10 });
    save(); render();
    const inp = $$('.chore-edit .inp[data-cf="name"]').pop(); inp.focus(); inp.select();
  };
  $('#copyurl').onclick = async () => {
    try { await navigator.clipboard.writeText($('#qlurl').textContent); toast('📋 Link copied'); } catch (_) { toast('Copy failed — long-press the link to copy'); }
  };
  $$('[data-theme-set]').forEach((b) => b.onclick = () => { S.theme = b.dataset.themeSet; applyTheme(); save(); render(); });
  $('#export').onclick = () => {
    const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `lifequest-backup-${todayKey()}.json`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#import').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || typeof data.days !== 'object' || !Array.isArray(data.trackers)) throw new Error('bad file');
      if (!confirm('Replace all current data with this backup?')) return;
      S = { ...defaults(), ...data }; save(); applyTheme(); toast('✅ Backup restored'); render();
    } catch (_) { toast('⚠️ That file isn\'t a LifeQuest backup'); }
  };
  bindReminders();
  bindSheets();
  $('#strengthon').onchange = (e) => { S.strength = e.target.checked; save(); };
  $('#wunit').onchange = (e) => { S.wUnit = e.target.value; save(); };
  $('#mealnames').onchange = (e) => {
    S.meals = [...new Set(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))];
    save(); toast('🍽️ Meals updated');
  };
  $('#reset').onclick = () => {
    if (confirm('Erase ALL data and settings on this device? Export a backup first if unsure.') && confirm('Really erase everything?')) {
      S = defaults(); save(); applyTheme(); render();
    }
  };
}

/* ======================= Google Sheets sync ======================= */
const SYNC_KEY = 'lifequest.sync';
const SHEET_URL_RE = /^https:\/\/script\.google(usercontent)?\.com\/macros\/(s|u\/\d+\/s)\/[\w-]+\/exec$/;
let syncMeta = (() => { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (_) { return {}; } })();
const saveSyncMeta = () => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncMeta)); } catch (_) {} };
let syncTimer = null, syncing = false, syncAgain = false, changeCount = 0;

function queueSync() {
  if (!syncMeta.url) return;
  changeCount++;
  if (!syncMeta.dirty) { syncMeta.dirty = true; saveSyncMeta(); }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), 4000);
}

/** Turn app data into plain tables: one row per day, one row per strength set. Newest first. */
function buildSheetsPayload() {
  const a = computeAll();
  const trackers = activeTrackers();
  const daily = S.chores.filter((c) => c.freq === 'daily');
  const weekly = S.chores.filter((c) => c.freq === 'weekly');
  const header = ['Date', 'Score %', 'Goals hit', 'Goals', 'XP', 'Streak',
    ...trackers.map((t) => `${t.name}${t.unit ? ` (${t.unit})` : ''}`),
    ...daily.map((c) => c.name), 'Weekly chores done', ...S.meals, 'To-dos done', 'Strength'];
  const keys = Object.keys(S.days).filter((k) => rawActive(peekDay(k))).sort().reverse();
  const rows = keys.map((k) => {
    const d = peekDay(k), st = a.perDay[k] || dayStats(k);
    return [k, Math.round(st.score * 100), st.hit, st.goals, st.xp, st.streak ?? '',
      ...trackers.map((t) => effVal(t, d) ?? ''),
      ...daily.map((c) => (d.c[c.id] ? '✓' : '')),
      weekly.filter((c) => d.c[c.id]).map((c) => c.name).join(', '),
      ...S.meals.map((m) => d.m?.[m] ?? ''),
      (d.t || []).join('; '),
      (d.w || []).filter((e) => doneSets(e).length).map((e) => `${e.ex} ${summarizeSets(doneSets(e))}`).join('; ')];
  });
  const wRows = [];
  for (const k of keys) {
    const prs = (a.perDay[k]?.prList || []);
    for (const e of peekDay(k).w || []) {
      const sets = doneSets(e);
      const pr = prs.find((x) => sameName(x.ex, e.ex));
      let marked = false;
      sets.forEach((x, i) => {
        const isPr = pr && !marked && (pr.kind === 'w' ? x.w === pr.value : x.r === pr.value);
        if (isPr) marked = true;
        wRows.push([k, e.ex, i + 1, x.w ?? '', x.w > 0 ? S.wUnit : '', x.r ?? '', x.w > 0 && x.r > 0 ? round(x.w * x.r, 1) : '', isPr ? '🏆 PR' : '']);
      });
    }
  }
  return {
    sheets: {
      Daily: { header, rows },
      Workouts: { header: ['Date', 'Exercise', 'Set', 'Weight', 'Unit', 'Reps', 'Volume', 'PR'], rows: wRows },
    },
    backup: JSON.stringify(S),
  };
}

async function postToSheet(url, body) {
  try {
    const res = await fetch(url, { method: 'POST', body }); // text/plain: no CORS preflight
    const out = await res.json();
    if (!out.ok) throw new Error(out.error || 'The Sheet rejected the update');
    return out;
  } catch (e) {
    if (!(e instanceof TypeError || e instanceof SyntaxError)) throw e;
    // Response unreadable (e.g. a CORS quirk): send again without reading the reply.
    await fetch(url, { method: 'POST', body, mode: 'no-cors' });
    return { ok: true, unconfirmed: true };
  }
}

const localDayCount = () => Object.keys(S.days).filter((k) => rawActive(peekDay(k))).length;

async function syncNow({ manual = false, force = false } = {}) {
  if (!syncMeta.url) return false;
  // Never let an empty phone (fresh install, cleared data) overwrite a Sheet automatically.
  if (!force && !localDayCount()) return false;
  if (syncing) { syncAgain = true; return false; }
  if (!navigator.onLine) { if (manual) toast('📴 Offline — will sync when you’re back online'); return false; }
  clearTimeout(syncTimer);
  syncing = true;
  const startedAt = changeCount;
  let ok = false;
  try {
    const out = await postToSheet(syncMeta.url, JSON.stringify(buildSheetsPayload()));
    syncMeta.lastSync = Date.now(); syncMeta.lastError = null; syncMeta.unconfirmed = !!out.unconfirmed;
    if (changeCount === startedAt) syncMeta.dirty = false;
    ok = true;
  } catch (e) {
    syncMeta.lastError = e.message || 'Could not reach the Sheet';
    if (manual) toast(`⚠️ Sheets sync failed: ${syncMeta.lastError}`);
  }
  syncing = false;
  saveSyncMeta();
  if ($('#sheetscard')) { $('#sheetscard').innerHTML = sheetsHTML(); bindSheets(); }
  if (syncAgain) { syncAgain = false; syncNow(); }
  return ok;
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

function sheetsHTML() {
  const m = syncMeta;
  const status = !m.url ? ''
    : m.lastError ? `<p style="color:var(--critical);margin-top:0">⚠️ Last sync failed: ${esc(m.lastError)}${m.lastSync ? ` · last success ${ago(m.lastSync)}` : ''}</p>`
    : m.lastSync ? `<p style="color:var(--good);margin-top:0;font-weight:600">✓ Connected · saved ${ago(m.lastSync)}${m.dirty ? ' · changes pending' : ''}</p>`
    : '<p class="muted" style="margin-top:0">Connected — first sync pending.</p>';
  const base = location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');
  return `
    ${status}
    <p style="margin-top:0">Saves everything to your own Google Sheet a few seconds after each change: a <b>Daily</b> tab (one row per day), a <b>Workouts</b> tab (one row per set) and a hidden full backup you can restore from.</p>
    ${m.url ? `
      <div class="small muted" style="word-break:break-all;margin-bottom:8px">${esc(m.url)}</div>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn primary" id="sheetsync">Sync now</button>
        <button class="btn" id="sheetrestore">Restore from Sheet</button>
        <span class="spacer"></span>
        <button class="btn danger" id="sheetoff">Disconnect</button>
      </div>` : `
      <div class="field"><label for="sheeturl">Sheet web app URL</label>
        <input id="sheeturl" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></div>
      <button class="btn primary block" id="sheetconnect">Connect</button>
      <details class="table" style="margin-top:10px"><summary>How to set it up (about 3 minutes, easiest on a computer)</summary>
        <ol style="padding-left:18px">
          <li>Create a new Google Sheet (<a href="https://sheets.new" target="_blank" rel="noopener">sheets.new</a>).</li>
          <li>In the Sheet: <b>Extensions → Apps Script</b>. Delete what’s there and paste the script (button below, or <a href="${esc(base)}google-sheets/Code.gs" target="_blank" rel="noopener">open it</a>). Click 💾 Save.</li>
          <li><b>Deploy → New deployment</b> → gear ⚙ → <b>Web app</b>. Set <i>Execute as</i>: <b>Me</b>, <i>Who has access</i>: <b>Anyone</b>. Click <b>Deploy</b> and allow access when Google asks (choose <i>Advanced → Go to project</i> if it warns that the app is unverified — it’s your own script).</li>
          <li>Copy the <b>Web app URL</b> (ends in <code>/exec</code>), paste it above and tap <b>Connect</b>.</li>
        </ol>
        <button class="btn" id="copyscript">📋 Copy the script</button>
      </details>`}`;
}

function bindSheets() {
  const card = $('#sheetscard');
  if (!card) return;
  const busy = async (btn, fn) => {
    const label = btn.textContent; btn.disabled = true; btn.textContent = '…';
    try { await fn(); } catch (e) { toast(`⚠️ ${e.message}`); }
    btn.disabled = false; btn.textContent = label;
  };
  $('#copyscript', card) && ($('#copyscript', card).onclick = () => busy($('#copyscript', card), async () => {
    const code = await (await fetch('google-sheets/Code.gs', { cache: 'no-store' })).text();
    await navigator.clipboard.writeText(code);
    toast('📋 Script copied — paste it into Apps Script');
  }));
  $('#sheetconnect', card) && ($('#sheetconnect', card).onclick = (e) => busy(e.currentTarget, async () => {
    const url = $('#sheeturl', card).value.trim();
    if (!SHEET_URL_RE.test(url)) throw new Error('That doesn’t look like an Apps Script web app URL (it should end in /exec).');
    let info;
    try { info = await (await fetch(url)).json(); } catch (_) { info = null; }
    if (info && info.service !== 'lifequest-sheets') throw new Error('That URL isn’t the LifeQuest script — check you pasted the right deployment.');
    const remote = await fetchSheetBackup(url).catch(() => null);
    syncMeta = { url };
    saveSyncMeta();
    const remoteDays = remote ? Object.keys(remote.days).length : 0;
    if (!remoteDays) {
      if (await syncNow({ manual: true, force: true })) toast('✅ Connected — your Sheet is up to date');
      render();
      return;
    }
    // The Sheet already holds data (e.g. setting up a new phone): ask which copy wins.
    const localDays = localDayCount();
    openSheet(`
      <h3>This Sheet already has data</h3>
      <p class="small muted">The Sheet has <b>${remoteDays}</b> day${remoteDays === 1 ? '' : 's'} of history; this phone has <b>${localDays}</b>.</p>
      <button class="btn primary block" id="usesheet" style="margin-top:8px">Use the Sheet’s data on this phone</button>
      <button class="btn block" id="usephone" style="margin-top:8px">Replace the Sheet with this phone’s data</button>
      <button class="btn block" id="usecancel" style="margin-top:8px">Cancel</button>`, (sh) => {
      $('#usesheet', sh).onclick = () => { closeSheet(); applyBackup(remote); syncMeta.lastSync = Date.now(); syncMeta.dirty = false; saveSyncMeta(); toast('✅ Connected — loaded your data from the Sheet'); render(); };
      $('#usephone', sh).onclick = async () => {
        if (!confirm(`Overwrite the Sheet’s ${remoteDays} days with this phone’s ${localDays}?`)) return;
        closeSheet();
        if (await syncNow({ manual: true, force: true })) toast('✅ Connected — Sheet replaced with this phone’s data');
        render();
      };
      $('#usecancel', sh).onclick = () => { closeSheet(); syncMeta = {}; saveSyncMeta(); render(); };
    });
  }));
  $('#sheetsync', card) && ($('#sheetsync', card).onclick = (e) => busy(e.currentTarget, async () => {
    if (!localDayCount()) throw new Error('This phone has no data yet — use “Restore from Sheet” instead.');
    if (await syncNow({ manual: true })) toast(syncMeta.unconfirmed ? '📤 Sent to your Sheet' : '✅ Sheet updated');
  }));
  $('#sheetoff', card) && ($('#sheetoff', card).onclick = () => {
    if (!confirm('Stop syncing to this Sheet? Your Sheet keeps everything already saved.')) return;
    syncMeta = {}; saveSyncMeta(); render();
  });
  $('#sheetrestore', card) && ($('#sheetrestore', card).onclick = (e) => busy(e.currentTarget, async () => {
    const data = await fetchSheetBackup(syncMeta.url);
    if (!data) throw new Error('No backup found in the Sheet yet.');
    const n = Object.keys(data.days).length;
    if (!confirm(`Replace the data on this phone with the Sheet’s copy (${n} day${n === 1 ? '' : 's'} of history)?`)) return;
    applyBackup(data);
    toast('✅ Restored from your Sheet'); render();
  }));
}

/** The full backup stored in the Sheet, or null if there isn't one yet. */
async function fetchSheetBackup(url) {
  const out = await (await fetch(`${url}?action=backup`)).json();
  if (!out.ok || !out.backup) return null;
  const data = JSON.parse(out.backup);
  if (!data || typeof data.days !== 'object' || !Array.isArray(data.trackers)) throw new Error('The backup in the Sheet is unreadable.');
  return data;
}
function applyBackup(data) {
  S = migrate({ ...defaults(), ...data, v: data.v || 1 });
  save(); applyTheme();
}

addEventListener('online', () => { if (syncMeta.dirty) syncNow(); });
document.addEventListener('visibilitychange', () => {
  // Leaving the app: push pending changes now rather than waiting for the timer.
  if (document.visibilityState === 'hidden' && syncMeta.dirty) syncNow();
});

/* ======================= Push reminders ======================= */
// Set this to your deployed reminder worker URL to pre-fill it for new installs.
const DEFAULT_REMINDER_SERVER = '';
const STATUS_CACHE = 'lifequest-status';
const remCfg = () => (S.reminders ||= { server: '', times: ['08:30', '21:00'], enabled: false });
const remServer = () => (remCfg().server || DEFAULT_REMINDER_SERVER).replace(/\/+$/, '');

/** Snapshot of today's progress for the service worker, which writes reminder text from it. */
let statusTimer = null;
function queueStatus() { clearTimeout(statusTimer); statusTimer = setTimeout(writeStatus, 300); }
async function writeStatus() {
  if (!('caches' in window)) return;
  try {
    const k = todayKey(), a = computeAll(), st = a.perDay[k] || dayStats(k), d = peekDay(k);
    const remaining = [
      ...activeTrackers().filter((t) => t.dir === 'min' && t.goal != null && !trackerMet(t, d)).map((t) => t.name),
      ...S.chores.filter((c) => c.freq === 'daily' && !d.c[c.id]).map((c) => c.name),
    ];
    const status = {
      date: k, streak: a.streak, activeToday: st.active, perfect: st.perfect, hit: st.hit, goals: st.goals,
      remaining, todos: (S.todos || []).length, loggedIds: Object.keys(d.v), hasSleep: activeTrackers().some((t) => t.id === 'sleep'),
    };
    await (await caches.open(STATUS_CACHE)).put('status', new Response(JSON.stringify(status), { headers: { 'Content-Type': 'application/json' } }));
  } catch (_) {}
}

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function pushSupport() {
  if (isIOS() && !isStandalone()) return 'On iPhone, notifications only work after you Add to Home Screen and open LifeQuest from that icon.';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'This browser doesn’t support push notifications.';
  if (Notification.permission === 'denied') return 'Notifications are blocked for this app — allow them in your phone’s settings, then come back.';
  return null;
}
const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function api(path, body) {
  const res = await fetch(remServer() + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}
async function currentSub() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function enableReminders() {
  const problem = pushSupport();
  if (problem) throw new Error(problem);
  if (!remServer()) throw new Error('Enter your reminder server URL first.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not granted.');
  const { publicKey } = await api('/vapid');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // If the server's key changed (e.g. redeployed), resubscribe with the new one.
  if (sub && sub.options?.applicationServerKey) {
    const cur = new Uint8Array(sub.options.applicationServerKey), want = b64uToBytes(publicKey);
    if (cur.length !== want.length || cur.some((b, i) => b !== want[i])) { await sub.unsubscribe(); sub = null; }
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
  await writeStatus();
  await syncReminderTimes(sub);
  remCfg().enabled = true; save();
}
async function syncReminderTimes(sub) {
  sub ||= await currentSub();
  if (!sub) throw new Error('This device isn’t subscribed yet.');
  const times = [...new Set(remCfg().times.filter(Boolean))].sort();
  await api('/subscribe', { subscription: sub.toJSON(), times, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
}
async function disableReminders() {
  const sub = await currentSub().catch(() => null);
  if (sub) { await api('/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  remCfg().enabled = false; save();
}

function remindersHTML() {
  const r = remCfg(), problem = pushSupport();
  const timeRow = (t, i) => `<div class="row" style="margin:6px 0"><input class="inp" type="time" data-remtime="${i}" value="${esc(t)}" aria-label="Reminder time ${i + 1}" style="flex:1">
      <button class="iconbtn" data-remdel="${i}" aria-label="Remove reminder time">✕</button></div>`;
  return `
    <p style="margin-top:0">A nudge at the times you pick. The text is written on your phone from your progress — e.g. <i>“🔥 Your 8-day streak ends at midnight”</i> or <i>“3 goals left: Water, Workout, Tidy up”</i>.</p>
    ${problem ? `<p style="color:var(--critical)">${esc(problem)}</p>` : ''}
    <div class="field"><label for="remserver">Reminder server URL</label>
      <input id="remserver" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://lifequest-reminders.<you>.workers.dev" value="${esc(r.server || DEFAULT_REMINDER_SERVER)}"></div>
    <label class="small" style="font-weight:600;color:var(--text-secondary)">Remind me at</label>
    ${r.times.map(timeRow).join('')}
    ${r.times.length < 4 ? '<button class="btn" id="remadd" style="margin-bottom:10px">+ Add a time</button>' : ''}
    <div class="row" style="flex-wrap:wrap">
      ${r.enabled
        ? '<span style="color:var(--good);font-weight:700">✓ Reminders on</span><span class="spacer"></span><button class="btn" id="remtest">Send test</button><button class="btn danger" id="remoff">Turn off</button>'
        : '<button class="btn primary block" id="remon">🔔 Turn on reminders</button>'}
    </div>`;
}

function bindReminders() {
  const r = remCfg();
  const busy = async (btn, fn, okMsg) => {
    const label = btn.textContent; btn.disabled = true; btn.textContent = '…';
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { toast(`⚠️ ${e.message}`); }
    btn.disabled = false; btn.textContent = label; render();
  };
  const resync = () => { if (r.enabled) syncReminderTimes().then(() => toast('🔔 Reminder times updated')).catch((e) => toast(`⚠️ ${e.message}`)); };
  $('#remserver').onchange = (e) => { r.server = e.target.value.trim(); save(); };
  $$('[data-remtime]').forEach((inp) => inp.onchange = () => { r.times[+inp.dataset.remtime] = inp.value; save(); resync(); });
  $$('[data-remdel]').forEach((b) => b.onclick = () => { r.times.splice(+b.dataset.remdel, 1); save(); render(); resync(); });
  $('#remadd') && ($('#remadd').onclick = () => { r.times.push('12:30'); save(); render(); resync(); });
  $('#remon') && ($('#remon').onclick = (e) => busy(e.currentTarget, enableReminders, '🔔 Reminders on — you can send a test'));
  $('#remoff') && ($('#remoff').onclick = (e) => busy(e.currentTarget, disableReminders, 'Reminders off'));
  $('#remtest') && ($('#remtest').onclick = (e) => busy(e.currentTarget, async () => {
    await writeStatus();
    const sub = await currentSub();
    if (!sub) { r.enabled = false; save(); throw new Error('Subscription expired — turn reminders on again.'); }
    const out = await api('/test', { endpoint: sub.endpoint });
    if (!out.ok) throw new Error(`Push service said ${out.pushStatus}`);
  }, '📨 Test sent — it should arrive in a few seconds'));
}

/* ======================= Quick-log via URL ======================= */
function handleQuickLog() {
  const q = new URLSearchParams(location.search);
  if (q.has('tab')) tab = ['today', 'dash', 'rewards', 'settings'].includes(q.get('tab')) ? q.get('tab') : tab;
  let k = todayKey();
  const dq = q.get('date');
  if (dq === 'yesterday') k = addDays(k, -1);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(dq || '') && dq <= k) k = dq;
  const done = [];
  const find = (key) => S.trackers.find((t) => t.id === key.toLowerCase() || t.name.toLowerCase() === key.toLowerCase());
  for (const [rawKey, rawVal] of q) {
    if (['date', 'tab'].includes(rawKey)) continue;
    if (rawKey === 'chore') {
      for (const name of rawVal.split(',').map((s) => s.trim()).filter(Boolean)) {
        const c = S.chores.find((x) => x.id === name || x.name.toLowerCase() === name.toLowerCase());
        if (!c) continue;
        const already = c.freq === 'weekly' ? weeklyDoneOn(c.id, k) : peekDay(k).c[c.id];
        if (!already) { day(k).c[c.id] = 1; done.push(`✓ ${c.name}`); }
      }
      continue;
    }
    if (rawKey === 'todo') {
      if (addTodo(rawVal)) done.push(`📝 ${String(rawVal).trim()}`);
      continue;
    }
    const meal = S.meals.find((m) => m.toLowerCase() === rawKey.toLowerCase());
    if (meal) {
      const v = String(rawVal).trim();
      if (v) { (day(k).m ||= {})[meal] = v; done.push(`🍽️ ${meal}`); }
      continue;
    }
    const add = rawKey.startsWith('add_');
    const t = find(add ? rawKey.slice(4) : rawKey);
    const v = parseFloat(String(rawVal).replace(/,/g, ''));
    if (!t || Number.isNaN(v)) continue;
    const d = day(k);
    d.v[t.id] = round(add ? (d.v[t.id] || 0) + v : v, 3);
    done.push(`${t.icon} ${fmt(d.v[t.id], t.unit)}`);
  }
  if (location.search) history.replaceState(null, '', location.pathname);
  if (done.length) {
    viewDay = k;
    setTimeout(() => { toast(`Logged ${k === todayKey() ? '' : dayLabel(k) + ': '}${done.join(' · ')}`); }, 50);
    afterChange(k, null);
    return true;
  }
  return false;
}

/* ======================= Boot ======================= */
function applyTheme() {
  if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', S.theme);
}

$$('.tabbar button').forEach((b) => b.onclick = () => {
  tab = b.dataset.tab;
  if (tab === 'today') viewDay = todayKey();
  render(); scrollTo(0, 0);
});

// Roll over to the new day if the app was left open overnight / resumed from background.
let lastSeenDay = todayKey();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && todayKey() !== lastSeenDay) {
    if (viewDay === lastSeenDay) viewDay = todayKey();
    lastSeenDay = todayKey(); render();
    writeStatus();
  }
});

applyTheme();
if (!handleQuickLog()) render();
// Mark existing badges as seen on first run so we don't spam toasts.
if (!S.seenBadges.length) { S.seenBadges = unlocked(computeAll()).map((b) => b.id); save(); }
navigator.storage?.persist?.();
writeStatus();
if (syncMeta.dirty) setTimeout(() => syncNow(), 1500); // finish any sync that was interrupted
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  // When a new version installs, reload once (unless you're mid-typing) so new features show up.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const reload = () => { if (!document.activeElement?.matches('input, textarea')) location.reload(); else setTimeout(reload, 5000); };
    reload();
  });
}
