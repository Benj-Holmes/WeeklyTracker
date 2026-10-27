'use strict';

/* =========================================================
   Week — a local-only weekly habit tracker
   Data lives in localStorage under "week.v1".
   ========================================================= */

const STORE = 'week.v1';
const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];           // Monday-first
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KCAL_PER_KG = 7700;

/* ---------------- dates ---------------- */

const pad = n => String(n).padStart(2, '0');
const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseKey(k) {
  const parts = k.split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function midnight() {
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  return x;
}
function weekDays(start) {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
function isToday(d) {
  return dkey(d) === dkey(midnight());
}
function weekLabel(start) {
  const end = addDays(start, 6);
  const a = MONTHS[start.getMonth()];
  const b = MONTHS[end.getMonth()];
  return a === b
    ? `${start.getDate()} \u2013 ${end.getDate()} ${a}`
    : `${start.getDate()} ${a} \u2013 ${end.getDate()} ${b}`;
}

/* ---------------- formatting ---------------- */

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function fmtMin(m) {
  m = Math.max(0, Math.round(m));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h ${pad(mm)}m` : `${mm}m`;
}
function fmtHours(h) {
  const r = Math.round(h * 10) / 10;
  return `${r}h`;
}
function fmtKg(kg) {
  return `${kg.toFixed(1)} kg`;
}

/* ---------------- defaults ---------------- */

const DEFAULT_TASKS = [
  { id: 'brush',    name: 'Brush teeth',   emoji: '\u{1F9B7}', target: 14, maxDay: 2, work: false, daily: true,  kind: 'normal' },
  { id: 'japanese', name: 'Japanese',      emoji: '\u{1F1EF}\u{1F1F5}', target: 7, maxDay: 1, work: false, daily: true,  kind: 'normal' },
  { id: 'fast',     name: 'Fast',          emoji: '\u23F3', target: 7,  maxDay: 1, work: false, daily: true,  kind: 'fast' },
  { id: 'meals',    name: 'Healthy meals', emoji: '\u{1F957}', target: 14, maxDay: 2, work: false, daily: true,  kind: 'meals' },
  { id: 'startby',  name: 'Start by',      emoji: '\u23F0', target: 5,  maxDay: 1, work: true,  daily: true,  kind: 'start' },
  { id: 'workout',  name: 'Workout',       emoji: '\u{1F3CB}\uFE0F', target: 4, maxDay: 1, work: false, daily: false, kind: 'normal' },
  { id: 'walk',     name: 'Cardio walk',   emoji: '\u{1F6B6}', target: 3, maxDay: 1, work: false, daily: false, kind: 'normal' },
  { id: 'read',     name: 'Read book',     emoji: '\u{1F4D6}', target: 3, maxDay: 1, work: false, daily: false, kind: 'normal' },
  { id: 'weigh',    name: 'Weigh-in',      emoji: '\u2696\uFE0F', target: 1,  maxDay: 1, work: false, daily: false, kind: 'weigh' }
];

function defSettings() {
  return {
    tdee: 2500,
    calGoal: 1900,
    fastStart: '20:00',
    fastEnd: '13:00',
    workDaily: 120,
    workWeekly: 600,
    weighDay: 0,
    weighTime: '08:00',
    startBy: '09:00',
    lockTime: '23:00'
  };
}
function defState() {
  return {
    v: 1,
    settings: defSettings(),
    tasks: DEFAULT_TASKS.map(t => ({ ...t })),
    days: {}
  };
}

/* ---------------- persistence ---------------- */

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.v === 1 && Array.isArray(s.tasks)) {
        s.settings = Object.assign(defSettings(), s.settings || {});
        if (!s.days) s.days = {};
        return s;
      }
    }
  } catch (e) {
    console.warn('load failed', e);
  }
  return defState();
}
function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch (e) {
    console.warn('save failed', e);
    toast('Could not save');
  }
}

let state = load();
let tab = 'today';
let weekOffset = 0;
let editingTask = null;
let toastTimer = null;

const initialTab = (location.hash || '').replace('#', '');
if (initialTab === 'week' || initialTab === 'health' || initialTab === 'totals') tab = initialTab;

/* ---------------- day accessors ---------------- */

const rec = k => state.days[k] || null;
const ensure = k => (state.days[k] = state.days[k] || {});
const checksOf = k => { const r = rec(k); return (r && r.checks) || {}; };
const workOf = k => { const r = rec(k); return (r && r.work) || 0; };
const isOff = k => !!(rec(k) && rec(k).off);
const isDrought = k => !!(rec(k) && rec(k).drought);
const isLocked = k => !!(rec(k) && rec(k).locked);

function allDays() {
  return Object.keys(state.days).sort();
}

/* ---------------- settings-derived ---------------- */

function fastHours() {
  const a = state.settings.fastStart.split(':').map(Number);
  const b = state.settings.fastEnd.split(':').map(Number);
  let m = (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
  if (m <= 0) m += 1440;
  return m / 60;
}
function taskByKind(kind) {
  return state.tasks.find(t => t.kind === kind) || null;
}
function cutPerDay() {
  return Math.max(0, state.settings.tdee - state.settings.calGoal);
}
function cutForDay(k) {
  if (isOff(k)) return 0;
  const t = taskByKind('meals');
  if (!t) return 0;
  const meals = checksOf(k)[t.id] || 0;
  const full = cutPerDay();
  if (meals >= 2) return full;
  if (meals === 1) return Math.round(full / 2);
  return 0;
}

/* ---------------- weekly maths ---------------- */

function taskTotal(task, start) {
  let t = 0;
  for (const d of weekDays(start)) t += (checksOf(dkey(d))[task.id] || 0);
  return t;
}
function workTotal(start) {
  let t = 0;
  for (const d of weekDays(start)) t += workOf(dkey(d));
  return t;
}
function exemptCount(task, start) {
  let n = 0;
  for (const d of weekDays(start)) {
    const k = dkey(d);
    if (isOff(k)) n++;
    else if (task.work && isDrought(k)) n++;
  }
  return n;
}
function effTarget(task, start) {
  const n = exemptCount(task, start);
  if (task.daily || task.work) return Math.max(0, task.target - n * task.maxDay);
  return task.target;
}
function effWorkWeek(start) {
  let n = 0;
  for (const d of weekDays(start)) {
    const k = dkey(d);
    if (isOff(k) || isDrought(k)) n++;
  }
  return Math.max(0, state.settings.workWeekly - n * state.settings.workDaily);
}
function weekStats(start) {
  let met = 0;
  let total = 0;
  for (const t of state.tasks) {
    const e = effTarget(t, start);
    const g = taskTotal(t, start);
    total++;
    if (e === 0 || g >= e) met++;
  }
  const we = effWorkWeek(start);
  const wg = workTotal(start);
  total++;
  if (we === 0 || wg >= we) met++;
  return { met, total, won: met === total };
}
function isClean(k) {
  if (isOff(k)) return false;
  const c = checksOf(k);
  for (const t of state.tasks) {
    if (!t.daily) continue;          // weekly quotas don't gate a clean day
    if ((c[t.id] || 0) < t.maxDay) return false;
  }
  return workOf(k) > 0;
}

/* ---------------- points & streaks ---------------- */

function dayPoints(k) {
  if (isOff(k)) return 0;
  let p = 0;
  const c = checksOf(k);
  for (const t of state.tasks) p += (c[t.id] || 0) * 10;
  const w = workOf(k);
  if (w >= state.settings.workDaily && w > 0) p += 15;
  else if (w > 0) p += 5;
  if (isClean(k)) p += 25;
  return p;
}
function totalPoints() {
  return allDays().reduce((a, k) => a + dayPoints(k), 0);
}

function activity(k) {
  if (isOff(k)) return null;
  if (workOf(k) > 0) return true;
  const c = checksOf(k);
  for (const id in c) if (c[id] > 0) return true;
  return false;
}
function currentStreak() {
  let n = 0;
  let d = midnight();
  if (activity(dkey(d)) !== true) d = addDays(d, -1);
  for (let i = 0; i < 4000; i++) {
    const a = activity(dkey(d));
    if (a === null) { d = addDays(d, -1); continue; }
    if (a === true) { n++; d = addDays(d, -1); } else break;
  }
  return n;
}
function bestStreak() {
  const keys = allDays();
  if (!keys.length) return 0;
  let best = 0;
  let cur = 0;
  const last = midnight();
  for (let d = parseKey(keys[0]); d <= last; d = addDays(d, 1)) {
    const a = activity(dkey(d));
    if (a === null) continue;
    if (a === true) { cur++; if (cur > best) best = cur; }
    else cur = 0;
  }
  return best;
}
function streakOf(ok) {
  let n = 0;
  let d = midnight();
  if (ok(dkey(d)) !== true) d = addDays(d, -1);
  for (let i = 0; i < 4000; i++) {
    const a = ok(dkey(d));
    if (a === null) { d = addDays(d, -1); continue; }
    if (a === true) { n++; d = addDays(d, -1); } else break;
  }
  return n;
}
function taskStreak(t) {
  return streakOf(k => {
    if (isOff(k)) return null;
    if (t.work && isDrought(k)) return null;
    return (checksOf(k)[t.id] || 0) >= t.maxDay;
  });
}
function workStreak() {
  return streakOf(k => {
    if (isOff(k) || isDrought(k)) return null;
    return workOf(k) > 0;
  });
}

/* ---------------- history helpers ---------------- */

function allWeeks() {
  const keys = allDays();
  if (!keys.length) return [];
  const out = [];
  const last = startOfWeek(midnight());
  let d = startOfWeek(parseKey(keys[0]));
  let guard = 0;
  while (d <= last && guard < 1040) {
    out.push(new Date(d));
    d = addDays(d, 7);
    guard++;
  }
  return out;
}
function thisWeekKey() {
  return dkey(startOfWeek(midnight()));
}
function completedWeeks() {
  return allWeeks().filter(w => dkey(w) !== thisWeekKey());
}
function weeksWon() {
  return completedWeeks().filter(w => weekStats(w).won).length;
}
function workWeeksAbove() {
  return completedWeeks().filter(w => {
    const e = Math.max(1, effWorkWeek(w));
    return workTotal(w) >= e;
  }).length;
}
function bestWorkWeek() {
  return allWeeks().reduce((m, w) => Math.max(m, workTotal(w)), 0);
}
function lifetimeTask(id) {
  return allDays().reduce((a, k) => a + (checksOf(k)[id] || 0), 0);
}
function weighEntries() {
  return allDays()
    .map(k => ({ k, kg: rec(k) && rec(k).weigh }))
    .filter(x => typeof x.kg === 'number');
}
function cutTotal(excludeThisWeek) {
  return allDays().reduce((a, k) => {
    if (excludeThisWeek && dkey(startOfWeek(parseKey(k))) === thisWeekKey()) return a;
    return a + cutForDay(k);
  }, 0);
}

/* =========================================================
   RENDER
   ========================================================= */

function render() {
  const now = midnight();
  const pts = totalPoints();
  document.getElementById('topDate').textContent =
    `${DAY_LONG[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
  document.getElementById('topSub').textContent = `${pts} pts \u00B7 Lv ${Math.floor(pts / 500) + 1}`;
  document.getElementById('topStreak').textContent = `\u{1F525} ${currentStreak()}`;

  const main = document.getElementById('main');
  if (tab === 'today') main.innerHTML = viewToday();
  else if (tab === 'week') main.innerHTML = viewWeek();
  else if (tab === 'health') main.innerHTML = viewHealth();
  else main.innerHTML = viewTotals();

  document.querySelectorAll('#nav button').forEach(b => {
    b.classList.toggle('on', b.dataset.tab === tab);
  });
}

/* ---------------- today ---------------- */

function taskLabel(t) {
  if (t.kind === 'start') return `${t.name} ${state.settings.startBy}`;
  return t.name;
}

function dailyRow(t, k, locked) {
  const c = checksOf(k)[t.id] || 0;
  const done = c >= t.maxDay;
  const dis = locked ? 'disabled' : '';

  let taps = '';
  if (t.maxDay === 1) {
    taps = `<button class="tap ${done ? 'on' : ''}" data-act="check" data-task="${t.id}" data-date="${k}" data-idx="1" ${dis}>${done ? '\u2713' : ''}</button>`;
  } else {
    let inner = '';
    for (let i = 1; i <= t.maxDay; i++) {
      inner += `<button class="tap ${c >= i ? 'on' : ''}" data-act="check" data-task="${t.id}" data-date="${k}" data-idx="${i}" ${dis}>${c >= i ? '\u2713' : ''}</button>`;
    }
    taps = inner;
  }

  let meta = `${c}/${t.maxDay}`;
  if (t.kind === 'meals' && c >= 2) meta += ` \u00B7 cut ${cutForDay(k).toLocaleString()} kcal`;
  else if (t.kind === 'fast') meta += ` \u00B7 ${fmtHours(fastHours())} fast`;

  return `<div class="task ${done ? 'done' : ''}">
    <div class="label">
      <div class="name">${t.emoji} ${esc(taskLabel(t))}</div>
      <div class="meta">${meta}</div>
    </div>
    <div class="taps">${taps}</div>
  </div>`;
}

function droughtRow(t) {
  return `<div class="task" style="opacity:.4">
    <div class="label">
      <div class="name">${t.emoji} ${esc(taskLabel(t))}</div>
      <div class="meta">work drought</div>
    </div>
    <div class="taps"></div>
  </div>`;
}

function workCard(k, locked) {
  const w = workOf(k);
  const goal = state.settings.workDaily;
  const pct = goal > 0 ? Math.min(100, (w / goal) * 100) : 0;
  const ws = startOfWeek(midnight());
  const wt = workTotal(ws);
  const we = effWorkWeek(ws);
  const drought = isDrought(k);
  const dis = locked || isOff(k);

  return `<div class="card">
    <h2>Work</h2>
    <div class="workTop">
      <div>
        <div class="workToday">${fmtMin(w)}</div>
        <div class="workGoal">day goal ${fmtMin(goal)}${drought ? ' \u00B7 drought' : ''}</div>
      </div>
      <div class="stepper">
        <button class="step" data-act="work" data-date="${k}" data-delta="-15" ${dis || w <= 0 ? 'disabled' : ''}>\u221215</button>
        <button class="step" data-act="work" data-date="${k}" data-delta="15" ${dis ? 'disabled' : ''}>+15</button>
      </div>
    </div>
    <div class="workBar"><i style="width:${pct}%"></i></div>
    <div class="workFoot">
      <span>week ${fmtMin(wt)} / ${fmtMin(we)}</span>
      <span>${goal > 0 && w >= goal ? 'goal hit' : ''}</span>
    </div>
  </div>`;
}

function weeklyRow(t, k, locked) {
  const ws = startOfWeek(midnight());
  const got = taskTotal(t, ws);
  const eff = effTarget(t, ws);
  const c = checksOf(k)[t.id] || 0;
  const maxed = c >= t.maxDay;
  return `<div class="task ${maxed ? 'done' : ''}">
    <div class="label">
      <div class="name">${t.emoji} ${esc(t.name)}</div>
      <div class="meta">${got}/${eff} this week</div>
    </div>
    <div class="taps">
      <button class="tap ${maxed ? 'on' : ''}" data-act="check" data-task="${t.id}" data-date="${k}" data-idx="1" ${locked ? 'disabled' : ''}>${maxed ? '\u2713' : ''}</button>
    </div>
  </div>`;
}

function weighDue() {
  const t = state.settings.weighTime.split(':').map(Number);
  const now = new Date();
  return (now.getHours() * 60 + now.getMinutes()) >= (t[0] * 60 + t[1]);
}

function weighRow(t, k, locked) {
  const d = parseKey(k);
  if (d.getDay() !== state.settings.weighDay) return '';

  const c = checksOf(k)[t.id] || 0;
  const kg = rec(k) && rec(k).weigh;
  const due = weighDue();

  let meta;
  if (c > 0) meta = kg ? `${fmtKg(kg)} \u00B7 ${state.settings.weighTime}` : `logged \u00B7 ${state.settings.weighTime}`;
  else meta = due ? `due now \u00B7 ${state.settings.weighTime}` : `at ${state.settings.weighTime}`;

  const dis = locked || (c === 0 && !due);

  return `<div class="task ${c > 0 ? 'done' : ''}">
    <div class="label">
      <div class="name">${t.emoji} ${esc(t.name)}</div>
      <div class="meta">${meta}</div>
    </div>
    <div class="taps">
      <button class="tap ${c > 0 ? 'on' : ''}" data-act="weigh" data-date="${k}" ${dis ? 'disabled' : ''}>${c > 0 ? '\u2713' : ''}</button>
    </div>
  </div>`;
}

function lockStr(k) {
  const r = rec(k);
  if (!r || !r.lockedAt) return '';
  return ' at ' + new Date(r.lockedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function viewToday() {
  const k = dkey(midnight());
  const locked = isLocked(k);
  const off = isOff(k);
  const drought = isDrought(k);

  const daily = state.tasks.filter(t => t.daily && t.kind !== 'weigh');
  const weekly = state.tasks.filter(t => !t.daily && t.kind !== 'weigh');
  const weigh = state.tasks.find(t => t.kind === 'weigh');

  let html = '';

  if (off) html += `<div class="lockedNote">\u{1F334} Day off \u2014 nothing is due today.</div>`;
  else if (locked) html += `<div class="lockedNote">\u{1F512} Locked in${lockStr(k)}.</div>`;

  html += `<div class="card"><h2>Today</h2>`;
  if (!daily.length) html += `<p class="dim">No daily tasks.</p>`;
  for (const t of daily) {
    html += (t.work && drought) ? droughtRow(t) : dailyRow(t, k, locked || off);
  }
  html += `</div>`;

  html += workCard(k, locked || off);

  html += `<div class="card"><h2>This week</h2>`;
  for (const t of weekly) html += weeklyRow(t, k, locked || off);
  if (weigh) html += weighRow(weigh, k, locked || off);
  html += `</div>`;

  if (!locked && !off) {
    html += `<button class="primary" data-act="lock">Lock in day \u00B7 ${state.settings.lockTime}</button>`;
  }

  return html;
}

/* ---------------- week ---------------- */

function weekCell(t, d, k) {
  if (t.kind === 'weigh' && d.getDay() !== state.settings.weighDay) {
    return `<div class="gc blank"></div>`;
  }
  const c = checksOf(k)[t.id] || 0;
  const off = isOff(k) || (t.work && isDrought(k));
  const cls = ['gc'];
  if (off) cls.push('off');
  else if (c >= t.maxDay) cls.push('full');
  else if (c > 0) cls.push('part');
  if (isToday(d)) cls.push('today');
  const label = off ? '' : (c >= t.maxDay ? '\u2713' : (c > 0 ? String(c) : ''));
  return `<button class="${cls.join(' ')}" data-act="check" data-task="${t.id}" data-date="${k}">${label}</button>`;
}

function workCell(d, k) {
  const w = workOf(k);
  const off = isOff(k) || isDrought(k);
  const cls = ['gc'];
  if (off) cls.push('off');
  else if (w > 0) cls.push('full');
  if (isToday(d)) cls.push('today');
  return `<button class="${cls.join(' ')}" data-act="work-add" data-date="${k}" ${off ? 'disabled' : ''}>${w > 0 && !off ? '\u2713' : ''}</button>`;
}

function weekHasData(w) {
  for (const d of weekDays(w)) {
    const k = dkey(d);
    if (workOf(k) > 0) return true;
    const c = checksOf(k);
    for (const id in c) if (c[id] > 0) return true;
  }
  return false;
}

function weekOffsetOf(w) {
  const ms = startOfWeek(w).getTime() - startOfWeek(midnight()).getTime();
  return Math.round(ms / (7 * 24 * 3600 * 1000));
}

function viewWeek() {
  const start = addDays(startOfWeek(midnight()), weekOffset * 7);
  const days = weekDays(start);
  const st = weekStats(start);
  const wt = workTotal(start);
  const we = effWorkWeek(start);

  let cut = 0;
  for (const d of days) cut += cutForDay(dkey(d));

  let rows = `<div class="grid">
    <div class="gh"></div>${days.map(d => `<div class="gh ${isToday(d) ? 'today' : ''}">${WD[(d.getDay() + 6) % 7]}</div>`).join('')}`;

  for (const t of state.tasks) {
    const got = taskTotal(t, start);
    const eff = effTarget(t, start);
    rows += `<div class="gr-name"><span class="tn">${t.emoji} ${esc(t.name)}</span><span class="tv">${got}/${eff}</span></div>`;
    rows += days.map(d => weekCell(t, d, dkey(d))).join('');
  }

  rows += `<div class="gr-name"><span class="tn">\u{1F4BC} Work</span><span class="tv">${fmtMin(wt)}/${fmtMin(we)}</span></div>`;
  rows += days.map(d => workCell(d, dkey(d))).join('');

  rows += `</div>`;

  const past = allWeeks()
    .filter(w => dkey(w) !== thisWeekKey())
    .filter(weekHasData)
    .reverse()
    .slice(0, 80);

  let listHtml = '';
  for (const w of past) {
    const s2 = weekStats(w);
    const sel = weekOffsetOf(w) === weekOffset;
    listHtml += `<button class="wrow ${sel ? 'sel' : ''}" data-act="goto-week" data-week="${dkey(w)}">
      <span class="wdate">${weekLabel(w)}</span>
      <span class="wmeta">${s2.won ? '\u2713 won' : s2.met + '/' + s2.total}</span>
      <span class="wload">${fmtMin(workTotal(w))}</span>
    </button>`;
  }

  return `<div class="card">
    <div class="wkhead">
      <div class="lbl">${weekLabel(start)}</div>
      <div class="wknav">
        ${weekOffset !== 0 ? `<button class="icon" data-act="this-week" title="This week">\u25CF</button>` : ''}
        <button class="icon" data-act="prev" aria-label="Previous week">\u2039</button>
        <button class="icon" data-act="next" aria-label="Next week">\u203A</button>
      </div>
    </div>
    <div class="won">${st.won ? '<span class="yes">\u2713 Week won</span>' : `Won? <b>${st.met}</b> of <b>${st.total}</b> targets met`}</div>
    ${rows}
    <div class="weekfoot">
      <span>Work <b>${fmtMin(wt)}</b></span>
      <span>${cut.toLocaleString()} kcal cut</span>
      <span>${st.met}/${st.total}</span>
    </div>
  </div>

  <div class="card">
    <h2>Previous weeks</h2>
    <div class="weeklist">${listHtml || '<p class="dim">Nothing yet \u2014 this one is your first.</p>'}</div>
  </div>`;
}

/* ---------------- health ---------------- */

function shortDate(k) {
  const d = parseKey(k);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function weightChart(entries) {
  if (!entries.length) return '';
  const W = 320, H = 150, PL = 36, PR = 12, PT = 14, PB = 26;
  const xs = entries.map(e => parseKey(e.k).getTime());
  const ys = entries.map(e => e.kg);
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const padY = Math.max(0.4, (yMax - yMin) * 0.3);
  const lo = yMin - padY, hi = yMax + padY;
  const X = t => (x1 === x0 ? PL + (W - PL - PR) / 2 : PL + ((t - x0) / (x1 - x0)) * (W - PL - PR));
  const Y = v => PT + ((hi - v) / (hi - lo)) * (H - PT - PB);

  const pts = entries.map((e, i) => [X(xs[i]), Y(e.kg)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = line + ' L ' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - PB) +
    ' L ' + pts[0][0].toFixed(1) + ' ' + (H - PB) + ' Z';
  const dots = pts.map((p, i) =>
    `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === pts.length - 1 ? 3.6 : 2.4}" fill="${i === pts.length - 1 ? '#4ade80' : '#60a5fa'}"/>`
  ).join('');
  const grid = [0, 0.5, 1].map(f => {
    const y = PT + f * (H - PT - PB);
    const v = hi - f * (hi - lo);
    return `<line x1="${PL}" y1="${y.toFixed(1)}" x2="${W - PR}" y2="${y.toFixed(1)}" stroke="#232c3b"/>` +
      `<text x="${PL - 6}" y="${(y + 3).toFixed(1)}" font-size="9" fill="#5d6b80" text-anchor="end">${v.toFixed(1)}</text>`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight over time">
    ${grid}
    <path d="${area}" fill="rgba(74,222,128,0.10)"/>
    <path d="${line}" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
    <text x="${PL}" y="${H - 6}" font-size="9" fill="#5d6b80">${shortDate(entries[0].k)}</text>
    <text x="${W - PR}" y="${H - 6}" font-size="9" fill="#5d6b80" text-anchor="end">${shortDate(entries[entries.length - 1].k)}</text>
  </svg>`;
}

function viewHealth() {
  const we = weighEntries();
  const cutAll = cutTotal(false);
  const cutWeek = cutTotal(false) - cutTotal(true);
  const fastTask = taskByKind('fast');
  const fastDays = fastTask ? lifetimeTask(fastTask.id) : 0;
  const fastTotal = fastDays * fastHours();
  const mealTask = taskByKind('meals');
  const mealDays = mealTask
    ? allDays().filter(k => !isOff(k) && (checksOf(k)[mealTask.id] || 0) >= 2).length
    : 0;
  const mealTicks = mealTask ? lifetimeTask(mealTask.id) : 0;
  const firstDay = allDays()[0];
  const span = firstDay ? Math.max(1, Math.round((midnight() - parseKey(firstDay)) / 86400000) + 1) : 1;
  const avgCut = Math.round(cutAll / span);

  let html = '';

  if (we.length) {
    const first = we[0];
    const last = we[we.length - 1];
    const delta = last.kg - first.kg;
    const expected = cutAll / KCAL_PER_KG;
    let verdict = '';
    if (expected > 0.15) {
      if (delta >= 0) verdict = 'Weight is up while the deficit predicts a loss \u2014 worth checking intake.';
      else if (delta < -expected) verdict = 'Losing faster than the deficit predicts.';
      else verdict = 'Tracking roughly with the deficit.';
    }
    html += `<div class="card">
      <h2>Weight</h2>
      <div class="bignum">${fmtKg(last.kg)}</div>
      <div class="bigsub">${delta <= 0 ? '\u2193' : '\u2191'} ${Math.abs(delta).toFixed(1)} kg since ${shortDate(first.k)} \u00B7 ${we.length} weigh-in${we.length === 1 ? '' : 's'}</div>
      ${weightChart(we)}
      <p class="hint">The deficit predicts \u2193 ${expected.toFixed(1)} kg.${verdict ? ' ' + verdict : ''}</p>
    </div>`;
  } else {
    html += `<div class="card"><h2>Weight</h2><p class="dim">No weigh-ins yet. The first one sets the baseline.</p></div>`;
  }

  html += `<div class="card">
    <h2>Calories</h2>
    <div class="bignum">${cutAll.toLocaleString()}</div>
    <div class="bigsub">kcal cut all time \u00B7 \u2248 ${(cutAll / KCAL_PER_KG).toFixed(2)} kg</div>
    <div class="split" style="margin-top:12px">
      <div class="stat"><div class="k">This week</div><div class="v">${cutWeek.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Avg / day</div><div class="v">${avgCut.toLocaleString()}</div></div>
    </div>
  </div>`;

  html += `<div class="card">
    <h2>Fasting</h2>
    <div class="split">
      <div class="stat"><div class="k">Days fasted</div><div class="v">${fastDays}</div></div>
      <div class="stat"><div class="k">Hours total</div><div class="v">${fastTotal.toFixed(0)}h</div></div>
    </div>
    <p class="hint">${fmtHours(fastHours())} window \u00B7 ${fmtHours(fastHours())} per completed fast.</p>
  </div>`;

  html += `<div class="card">
    <h2>Healthy meals</h2>
    <div class="split">
      <div class="stat"><div class="k">Days at 2/2</div><div class="v">${mealDays}</div></div>
      <div class="stat"><div class="k">Meals logged</div><div class="v">${mealTicks}</div></div>
    </div>
  </div>`;

  return html;
}

/* ---------------- totals ---------------- */

function viewTotals() {
  const pts = totalPoints();
  const lvl = Math.floor(pts / 500) + 1;
  const cur = currentStreak();
  const best = bestStreak();
  const completed = completedWeeks();
  const won = weeksWon();
  const above = workWeeksAbove();
  const fastTask = taskByKind('fast');
  const fastTotal = fastTask ? lifetimeTask(fastTask.id) * fastHours() : 0;
  const we = weighEntries();

  let html = '';

  html += `<div class="card">
    <h2>Streak</h2>
    <div class="split">
      <div class="stat"><div class="k">Current</div><div class="v">\u{1F525} ${cur}d</div></div>
      <div class="stat"><div class="k">Best</div><div class="v">\u{1F3C6} ${best}d</div></div>
    </div>
    <div class="split" style="margin-top:12px">
      <div class="stat"><div class="k">Points</div><div class="v">${pts.toLocaleString()}</div></div>
      <div class="stat"><div class="k">Level</div><div class="v">${lvl}</div></div>
    </div>
  </div>`;

  // per-activity streaks
  let srows = `<div class="task"><div class="label"><div class="name">\u{1F4BC} Work</div><div class="meta">any minutes</div></div><div class="v">${workStreak()}d</div></div>`;
  for (const t of state.tasks) {
    if (!t.daily || t.kind === 'weigh') continue;
    srows += `<div class="task"><div class="label"><div class="name">${t.emoji} ${esc(taskLabel(t))}</div></div><div class="v">${taskStreak(t)}d</div></div>`;
  }
  html += `<div class="card"><h2>Activity streaks</h2>${srows}</div>`;

  html += `<div class="card">
    <h2>Weeks</h2>
    <div class="split">
      <div class="stat"><div class="k">Weeks won</div><div class="v">${won}<span style="font-size:14px;color:var(--dim2)"> / ${completed.length}</span></div></div>
      <div class="stat"><div class="k">\u2265 ${fmtMin(state.settings.workWeekly)} work</div><div class="v">${above}</div></div>
    </div>
    <p class="hint">Best work week: ${fmtMin(bestWorkWeek())}</p>
  </div>`;

  // badges
  const FAST_TOTAL = 100;
  const BADGES = [
    { e: '\u{1F331}', n: 'First day', got: allDays().length > 0 },
    { e: '\u{1F525}', n: '7-day streak', got: best >= 7 },
    { e: '\u{1F525}', n: '30-day streak', got: best >= 30 },
    { e: '\u{1F3C6}', n: 'First week won', got: won >= 1 },
    { e: '\u{1F947}', n: '4 weeks won', got: won >= 4 },
    { e: '\u{1F4BC}', n: '10h work week', got: bestWorkWeek() >= 600 },
    { e: '\u{1F1EF}\u{1F1F5}', n: '30 Japanese', got: lifetimeTask('japanese') >= 30 },
    { e: '\u2696', n: '8 weigh-ins', got: we.length >= 8 },
    { e: '\u23F3', n: '100h fasted', got: fastTotal >= FAST_TOTAL },
    { e: '\u{1F4AF}', n: '1000 pts', got: pts >= 1000 }
  ];
  const badgeHtml = BADGES.map(b =>
    `<div class="badge ${b.got ? 'got' : ''}"><span class="e">${b.e}</span>${b.n}</div>`
  ).join('');
  html += `<div class="card"><h2>Badges</h2><div class="badgeRow">${badgeHtml}</div></div>`;

  return html;
}

/* =========================================================
   ACTIONS
   ========================================================= */

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function handleCheck(el) {
  const k = el.dataset.date;
  const t = state.tasks.find(x => x.id === el.dataset.task);
  if (!t) return;
  if (isLocked(k)) { toast('That day is locked'); return; }
  if (isOff(k)) { toast('Day off'); return; }
  if (t.work && isDrought(k)) { toast('Work drought'); return; }

  const r = ensure(k);
  if (!r.checks) r.checks = {};
  const cur = r.checks[t.id] || 0;
  let next;
  if (t.maxDay > 1 && el.dataset.idx) {
    const i = Number(el.dataset.idx);
    next = cur >= i ? i - 1 : i;
  } else {
    next = cur >= t.maxDay ? 0 : cur + 1;
  }
  if (next <= 0) delete r.checks[t.id];
  else r.checks[t.id] = next;

  if (t.kind === 'weigh' && next > 0 && typeof r.weigh !== 'number') {
    const v = window.prompt('Weight today (kg)?');
    const n = parseFloat(v);
    if (!isNaN(n) && n > 0) r.weigh = Math.round(n * 10) / 10;
  }
  save();
  render();
}

function addWork(k, delta) {
  if (isLocked(k)) { toast('That day is locked'); return; }
  if (isOff(k) || isDrought(k)) { toast('Exempt day'); return; }
  const r = ensure(k);
  const next = Math.max(0, (r.work || 0) + delta);
  if (next === 0) delete r.work;
  else r.work = next;
  save();
  render();
}

function lockDay(k) {
  const r = ensure(k);
  r.locked = true;
  r.lockedAt = Date.now();
  save();
  render();
  toast('Day locked in');
}

function openWeigh(k) {
  if (isLocked(k)) { toast('That day is locked'); return; }
  if (isOff(k)) { toast('Day off'); return; }
  const d = parseKey(k);
  if (d.getDay() !== state.settings.weighDay) {
    toast(`Weigh-in is on ${DAY_LONG[state.settings.weighDay]}`);
    return;
  }
  const t = state.tasks.find(x => x.kind === 'weigh');
  if (!t) return;
  const r = ensure(k);
  if (!r.checks) r.checks = {};
  const cur = r.checks[t.id] || 0;
  if (cur > 0) {
    delete r.checks[t.id];
    save();
    render();
    return;
  }
  if (!weighDue()) { toast(`Weigh-in is at ${state.settings.weighTime}`); return; }
  const v = window.prompt('Weight today (kg)?');
  const n = parseFloat(v);
  if (isNaN(n) || n <= 0) return;
  r.checks[t.id] = 1;
  r.weigh = Math.round(n * 10) / 10;
  save();
  render();
}

/* ---------------- settings ---------------- */

function updateHints() {
  const s = state.settings;
  const cut = Math.max(0, s.tdee - s.calGoal);
  const hint = document.getElementById('sCutHint');
  if (hint) hint.textContent = `2 healthy meals = ${cut.toLocaleString()} kcal cut that day. 1 meal = ${Math.round(cut / 2).toLocaleString()}.`;
  const fh = document.getElementById('sFastHint');
  if (fh) fh.textContent = `That is a ${fmtHours(fastHours())} fast. Tick "Fast" on the day it ends.`;
}

function fillSettings() {
  const s = state.settings;
  document.getElementById('sTdee').value = s.tdee;
  document.getElementById('sCalGoal').value = s.calGoal;
  document.getElementById('sFastStart').value = s.fastStart;
  document.getElementById('sFastEnd').value = s.fastEnd;
  document.getElementById('sWorkDaily').value = s.workDaily;
  document.getElementById('sWorkWeekly').value = s.workWeekly;
  document.getElementById('sStartBy').value = s.startBy;
  document.getElementById('sWeighDay').value = String(s.weighDay);
  document.getElementById('sWeighTime').value = s.weighTime;
  document.getElementById('sLockTime').value = s.lockTime;

  const todayKey = dkey(midnight());
  const r = rec(todayKey);
  document.getElementById('btnOff').classList.toggle('on', !!(r && r.off));
  document.getElementById('btnDrought').classList.toggle('on', !!(r && r.drought));
  const lockBtn = document.getElementById('btnLock');
  lockBtn.textContent = (r && r.locked) ? 'Unlock today' : 'Lock today';
  lockBtn.classList.toggle('on', !!(r && r.locked));

  renderTaskList();
  updateHints();
}

function renderTaskList() {
  const el = document.getElementById('taskList');
  if (!el) return;
  el.innerHTML = state.tasks.map(t => `
    <div class="trow">
      <div class="tinfo">
        <div class="tname">${t.emoji} ${esc(t.name)}</div>
        <div class="tmeta">${t.target}/wk \u00B7 max ${t.maxDay}/day${t.daily ? ' \u00B7 daily' : ' \u00B7 weekly'}${t.work ? ' \u00B7 work' : ''}</div>
      </div>
      <button class="icon" data-act="task-edit" data-task="${t.id}" aria-label="Edit">\u270E</button>
      <button class="icon" data-act="task-del" data-task="${t.id}" aria-label="Delete">\u2715</button>
    </div>`).join('');
}

function openSettings() {
  fillSettings();
  document.getElementById('settingsDlg').showModal();
}

function openTaskDlg(id) {
  editingTask = id || null;
  const t = id ? state.tasks.find(x => x.id === id) : { name: '', emoji: '', target: 7, maxDay: 1, work: false, daily: true, kind: 'normal' };
  document.getElementById('taskDlgTitle').textContent = id ? 'Edit task' : 'New task';
  document.getElementById('tName').value = t.name;
  document.getElementById('tEmoji').value = t.emoji || '';
  document.getElementById('tTarget').value = t.target;
  document.getElementById('tMaxDay').value = t.maxDay;
  document.getElementById('tWork').checked = !!t.work;
  document.getElementById('tDaily').checked = t.daily !== false;
  document.getElementById('taskDlg').showModal();
}

function saveTask() {
  const name = document.getElementById('tName').value.trim();
  if (!name) { toast('Name required'); return; }
  const emoji = document.getElementById('tEmoji').value.trim();
  const target = Math.max(1, parseInt(document.getElementById('tTarget').value, 10) || 1);
  const maxDay = Math.max(1, parseInt(document.getElementById('tMaxDay').value, 10) || 1);
  const work = document.getElementById('tWork').checked;
  const daily = document.getElementById('tDaily').checked;

  if (editingTask) {
    const t = state.tasks.find(x => x.id === editingTask);
    if (t) Object.assign(t, { name, emoji, target, maxDay, work, daily });
  } else {
    state.tasks.push({ id: 't' + Date.now().toString(36), name, emoji, target, maxDay, work, daily, kind: 'normal' });
  }
  save();
  document.getElementById('taskDlg').close();
  renderTaskList();
  render();
}

function deleteTask() {
  if (!editingTask) { document.getElementById('taskDlg').close(); return; }
  if (!window.confirm('Delete this task?')) return;
  state.tasks = state.tasks.filter(t => t.id !== editingTask);
  save();
  document.getElementById('taskDlg').close();
  renderTaskList();
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `week-backup-${dkey(midnight())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

/* =========================================================
   EVENTS
   ========================================================= */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  switch (act) {
    case 'tab':
      tab = el.dataset.tab;
      try { history.replaceState(null, '', '#' + tab); } catch (e) {}
      render();
      break;
    case 'check':
      handleCheck(el);
      break;
    case 'work':
      addWork(el.dataset.date, Number(el.dataset.delta));
      break;
    case 'work-add':
      addWork(el.dataset.date, 15);
      break;
    case 'lock':
      lockDay(dkey(midnight()));
      break;
    case 'prev':
      weekOffset -= 1;
      render();
      break;
    case 'next':
      weekOffset += 1;
      render();
      break;
    case 'this-week':
      weekOffset = 0;
      render();
      break;
    case 'goto-week':
      weekOffset = weekOffsetOf(parseKey(el.dataset.week));
      render();
      break;
    case 'weigh':
      openWeigh(el.dataset.date);
      break;
    case 'open-settings':
      openSettings();
      break;
    case 'close-settings':
      document.getElementById('settingsDlg').close();
      break;
    case 'close-task':
      document.getElementById('taskDlg').close();
      break;
    case 'task-add':
      openTaskDlg(null);
      break;
    case 'task-edit':
      openTaskDlg(el.dataset.task);
      break;
    case 'task-del':
      editingTask = el.dataset.task;
      deleteTask();
      break;
    case 'task-save':
      saveTask();
      break;
    case 'toggle-off': {
      const k = dkey(midnight());
      const r = ensure(k);
      r.off = !r.off;
      save(); render(); fillSettings();
      toast(r.off ? 'Day off set' : 'Day off removed');
      break;
    }
    case 'toggle-drought': {
      const k = dkey(midnight());
      const r = ensure(k);
      r.drought = !r.drought;
      save(); render(); fillSettings();
      toast(r.drought ? 'Work drought set' : 'Work drought removed');
      break;
    }
    case 'lock-today': {
      const k = dkey(midnight());
      const r = ensure(k);
      if (r.locked) {
        delete r.locked;
        delete r.lockedAt;
        toast('Day unlocked');
      } else {
        r.locked = true;
        r.lockedAt = Date.now();
        toast('Day locked');
      }
      save(); render(); fillSettings();
      break;
    }
    case 'export':
      exportData();
      break;
    case 'import':
      document.getElementById('importFile').click();
      break;
    case 'reset':
      if (window.confirm('Erase all data on this device? Export a backup first if unsure.')) {
        localStorage.removeItem(STORE);
        state = defState();
        weekOffset = 0;
        save(); render(); fillSettings();
        toast('Reset');
      }
      break;
    default:
      break;
  }
});

/* settings changes */
document.getElementById('settingsDlg').addEventListener('input', e => {
  const s = state.settings;
  const num = v => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
  switch (e.target.id) {
    case 'sTdee': s.tdee = num(e.target.value); break;
    case 'sCalGoal': s.calGoal = num(e.target.value); break;
    case 'sFastStart': s.fastStart = e.target.value || s.fastStart; break;
    case 'sFastEnd': s.fastEnd = e.target.value || s.fastEnd; break;
    case 'sWorkDaily': s.workDaily = num(e.target.value); break;
    case 'sWorkWeekly': s.workWeekly = num(e.target.value); break;
    case 'sStartBy': s.startBy = e.target.value || s.startBy; break;
    case 'sWeighDay': s.weighDay = Number(e.target.value); break;
    case 'sWeighTime': s.weighTime = e.target.value || s.weighTime; break;
    case 'sLockTime': s.lockTime = e.target.value || s.lockTime; break;
    default: return;
  }
  save();
  updateHints();
  render();
});

/* import */
document.getElementById('importFile').addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(String(reader.result));
      if (!s || s.v !== 1 || !Array.isArray(s.tasks)) throw new Error('bad file');
      s.settings = Object.assign(defSettings(), s.settings || {});
      if (!s.days) s.days = {};
      state = s;
      save();
      render();
      fillSettings();
      toast('Imported');
    } catch (err) {
      toast('That file did not look like a backup');
    }
    e.target.value = '';
  };
  reader.readAsText(f);
});

/* backdrop click closes dialogs */
document.querySelectorAll('dialog').forEach(d => {
  d.addEventListener('click', e => {
    if (e.target === d) d.close();
  });
});

/* =========================================================
   BOOT
   ========================================================= */

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});
