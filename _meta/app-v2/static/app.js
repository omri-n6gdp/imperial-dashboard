/* Imperial Dashboard v2: home page.
   Reads the same API as the original app (/api/overview, /api/grades) and writes
   deadline ticks back through /api/deadline. */
'use strict';

/* ---------------------------------------------------------------- helpers */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = s => { const [h, m] = String(s).split(':').map(Number); return h + (m || 0) / 60; };
const sameDay = (a, b) => iso(a) === iso(b);

/* "2026-11-09T16:00" or "2026-11-09" -> local Date (null if neither) */
function parseDue(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}
const hasTime = s => /T\d{2}:\d{2}/.test(String(s || ''));
/* a date-only deadline counts as due at the end of that day */
const dueEnd = x => { const t = parseDue(x.due); return hasTime(x.due) ? t : addDays(t, 1); };

function niceDate(d) {
  const n = d.getDate(), suf = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return d.toLocaleDateString('en-GB', { weekday: 'long' }) + ' ' + n + suf + ' ' + MONTHS[d.getMonth()];
}
/* short date for lists: today / tomorrow / Tue 10 / Sun 6 Dec */
function shortDate(d, now) {
  const n = Math.round((dayStart(d) - dayStart(now)) / 864e5);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  const base = `${DAYS[d.getDay()]} ${d.getDate()}`;
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() ? base : `${base} ${MONTHS[d.getMonth()]}`;
}
/* drop bracketed notes (Canvas dates, page counts, partners) but keep short labels like "(DE part)" */
const tidy = s => String(s || '').replace(/\s*\(([^)]*)\)/g, (m, inner) => /[:;]|canvas|brief|pages?\b|\bwith\b|\bonly\b|\d/i.test(inner) || inner.length > 24 ? '' : m)
  .replace(/\s{2,}/g, ' ').trim();
const isDone = x => ['done', 'submitted', 'graded'].includes(String(x.status));
/* only marked work counts as a deadline (items linked to assessment.md); class prep and unmarked trainings are left out */
const isMarked = x => Array.isArray(x.ids) && x.ids.length > 0;

/* ---------------------------------------------------------------- state */
function saved(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (e) { return fallback; } }
function save(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* storage off: keep it for this visit */ } }
const state = { ov: null, gr: null, weekShift: 0, view: 'home', chartMode: saved('icd-marks-chart', 'run'), chartRange: saved('icd-marks-range', 'sofar'),
  dlOpenIdx: null, sheetCache: new Map(), sheetLoading: new Set(),
  revealed: new Set(), eqCache: new Map(), eqLoading: new Set(), eqOpen: new Set(), pending: null, noRestore: false, lastHash: '',
  tp: null, tcontent: null, settings: null, tpErr: null, plan: null, planKey: '', sumCache: new Map(), rvTab: {}, ttAll: false, det: new Map() };
/* write a block of the page only when it has changed, so a timed refresh doesn't close what you opened, drop the
   keyboard focus or your text selection, or typeset the maths again for nothing */
function setHTML(el, html) { if (el._html === html) return false; el._html = html; el.innerHTML = html; return true; }
/* sections you fold open or shut (courses on Revision, extra notes on a sheet) stay how you left them */
const detOpen = (key, dflt) => (state.det.has(key) ? state.det.get(key) : dflt);
document.addEventListener('toggle', e => { const k = e.target && e.target.dataset && e.target.dataset.dk; if (k) state.det.set(k, e.target.open); }, true);

async function getJSON(url, opts) {
  const r = await fetch(url, Object.assign({ cache: 'no-store' }, opts));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
async function load() {
  try {
    const [ov, gr, ses] = await Promise.all([getJSON('/api/overview'), getJSON('/api/grades'),
      getJSON('/api/md?path=' + encodeURIComponent('calendar/sessions.md')).catch(() => null)]);
    state.ov = ov; state.gr = gr; state.sessions = sessionsIndex(ses);
    render();
    loadTopics();
    for (const k of [...state.sheetCache.keys()]) { const [c, i] = k.split('/'); ensureSheet(c, i, true); }
  } catch (e) {
    toast(`Couldn't load your data (${e.message}). Is the dashboard server running?`, null, true);
  }
}

/* the revision topics, their content and the timetable settings */
async function loadTopics() {
  try {
    const text = async p => { const r = await fetch(fileUrl(p), { cache: 'no-store' }); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.text(); };
    const [tp, content, settings] = await Promise.all([getJSON('/api/topics'), text('revision/topics.md'), text('revision/plan-settings.md')]);
    state.tp = tp.topics || []; state.tcontent = parseTopicContent(content); state.settings = parseSettings(settings); state.tpErr = null;
  } catch (e) { state.tpErr = e.message; }
  render();
}

/* ---------------------------------------------------------------- header + title */
function renderHeader(now) { $('#today').textContent = niceDate(now); }

/* Every page title uses the size at which IMPERIAL fills 80% of the width (90% on phones),
   so MARKS etc. have the same letter height as the home page. */
let probe;
function fitTitle() {
  const h = $('.lock h1'), p = $('.lock p');
  if (!probe) {
    probe = document.createElement('span');
    probe.textContent = 'IMPERIAL';
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:100px;letter-spacing:-.05em';
    h.appendChild(probe);
  }
  const sub = state.view !== 'home';
  const share = innerWidth <= 720 ? (sub ? .5 : .9) : (sub ? .34 : .8);
  const fs = 100 * innerWidth * share / probe.getBoundingClientRect().width;
  h.style.fontSize = fs + 'px';
  const pfs = Math.max(fs * .1365, 15);
  p.style.fontSize = pfs + 'px';
  const t = $('#title'), room = innerWidth * (innerWidth <= 720 ? .92 : .86), tw = t.getBoundingClientRect().width;
  const hfs = tw > room ? fs * room / tw : fs;
  if (tw > room) h.style.fontSize = hfs + 'px';
  /* the subtitle sits tight under the title, but never touches it: when the title is small (inner pages, narrow
     windows) the subtitle stops shrinking at 15px, so give it the few pixels of air it would otherwise lose */
  p.style.marginTop = Math.max(-.14 * pfs, 6 - .026 * hfs - .137 * pfs).toFixed(1) + 'px';
}

/* ---------------------------------------------------------------- deadlines */
function openDeadlines(ov) {
  return (ov.deadlines || []).filter(x => isMarked(x) && !isDone(x) && parseDue(x.due))
    .sort((a, b) => dueEnd(a) - dueEnd(b));
}
async function tickDeadline(row) {
  const ov = state.ov, i = +(row.dataset.index ?? row.dataset.tickdl);
  const x = (ov.deadlines || []).find(d => d.index === i);
  if (!x) return;
  const prev = ['open', 'upcoming', 'submitted'].includes(x.status) ? x.status : 'open';
  row.classList.add('leaving');
  try {
    await getJSON('/api/deadline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index: i, item: x.item, status: 'done' }) });
    x.status = 'done';
    setTimeout(render, 250);
    toast(`Ticked off: ${tidy(x.item)}`, async () => {
      await getJSON('/api/deadline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ index: i, item: x.item, status: prev }) });
      x.status = prev; render();
    });
  } catch (e) {
    row.classList.remove('leaving');
    toast(`Couldn't save that (${e.message})`, null, true);
  }
}

/* ---------------------------------------------------------------- home
   One card per page, in the nav's order, all built the same way: what it is, one headline number, a line
   explaining it, the detail, and a link at the foot that takes you to the next thing to do there. */
function homeCard(o) {
  return `<div class="k"><a class="hc-t" href="${o.href}">${esc(o.title)}</a><span class="kr${o.alert ? ' alert' : ''}">${esc(o.meta || '')}</span></div>
    <div class="hc-big">${o.big}</div><div class="hc-sub">${o.sub}</div>
    <div class="hc-body">${o.body}</div>
    <a class="hc-go" href="${o.goHref || o.href}"><span>${o.go}</span><i aria-hidden="true">&#8594;</i></a>`;
}
const hcRow = (label, bar, val, title) => `<div class="hc-row"${title ? ` title="${esc(title)}"` : ''}><span class="t">${esc(label)}</span><span class="r">${val}</span>${bar}</div>`;

function renderHomeSheets(now) {
  const M = sheetsModel(now), T = M.total, s = M.cur;
  let go = 'Every sheet that is out is done', goHref = '#sheets';
  if (s) {
    const r = sheetData(s.code, s.id);
    if (!r) ensureSheet(s.code, s.id);
    const xs = entriesOf(questionGroups(r)), x = xs.length ? pickEntry(xs) : null;
    go = `Continue: <b>${esc(modOf(s.code)[0])} ${esc(s.label)}</b>${x ? ', ' + esc(entryName(x)) : ''}`;
    goHref = x ? sheetHash(s.code, s.id, x.n) : sheetHash(s.code, s.id);
  }
  $('#w-sheets').innerHTML = homeCard({ title: 'Problem sheets', href: '#sheets', meta: `${M.sheets.filter(x => x.q).length} sheets`,
    big: `${pct(T)}<small>%</small>`, sub: `<b>${T.done}</b> of ${T.total} questions and parts done${T.stuck ? ` · ${T.stuck} stuck` : ''}`,
    body: M.mods.filter(m => m.c.total).map(m => hcRow(m.short, qBar(m.c), `${m.c.done}/${m.c.total}`,
      `${m.c.done} done, ${m.c.attempted + m.c.stuck} attempted or stuck, ${m.c.total - m.c.done - m.c.attempted - m.c.stuck} to do`)).join(''),
    go, goHref });
}
function renderHomeRevision(now) {
  const el = $('#w-revision');
  if (!state.tp || !state.tcontent) {
    el.innerHTML = homeCard({ title: 'Revision', href: '#revision', big: '—', sub: state.tpErr ? "Couldn't load the topics" : 'Loading your topics…', body: '', go: 'Open revision' });
    return;
  }
  const M = revModel(now), P = buildPlan(now), T = M.tot, nx = P && P.sessions[0], t = nx && M.byId.get(nx.id);
  el.innerHTML = homeCard({ title: 'Revision', href: '#revision', meta: `${T.total} topics`,
    big: `${T.total ? Math.round(100 * T.ok / T.total) : 0}<small>%</small>`,
    sub: `<b>${T.ok}</b> of ${T.total} lectured topics known${T.none ? ` · ${T.none} not looked at` : ''}`,
    body: M.mods.filter(m => m.c.total).map(m => hcRow(m.short, knowBar(m.c), `${m.c.ok}/${m.c.total}`,
      `${m.c.ok} known, ${m.c.sh} shaky, ${m.c.dk} don't know, ${m.c.none} not looked at`)).join(''),
    go: t ? `Next: <b>${esc(dayLabel(nx.d, now))} ${hhmm(nx.t0)}</b>, ${esc(t.topic)}` : 'Open the timetable', goHref: t ? revHash(t.id) : '#revision' });
}
function renderHomeDeadlines(now) {
  const ov = state.ov, open = openDeadlines(ov), over = open.filter(x => dueEnd(x) < now), next = open.find(x => dueEnd(x) >= now);
  let big = '—', sub = 'Nothing due. Enjoy it.';
  if (next) {
    const [[d], [h], [m]] = countParts(dueEnd(next) - now);
    big = d ? `${d}<small>d</small> ${h}<small>h</small>` : `${h}<small>h</small> ${pad(m)}<small>m</small>`;
    const due = parseDue(next.due);
    sub = `until <b>${esc(tidy(next.item).replace(/\s*\([^)]*\)\s*$/, ''))}</b>, ${esc(shortDate(due, now))}${hasTime(next.due) ? ' ' + hhmm(due) : ''}`;
  }
  const rows = open.slice(0, 5).map(x => {
    const late = dueEnd(x) < now, d = parseDue(x.due);
    const when = shortDate(d, now) + (hasTime(x.due) && sameDay(d, now) ? ` ${hhmm(d)}` : '');
    return `<div class="hc-dl${late ? ' over' : ''}" data-index="${x.index}" title="${esc(x.item)} · ${esc(modShort(x.module))}">
      <button class="tick" aria-label="Mark “${esc(tidy(x.item))}” as done"></button>
      <span class="t">${esc(tidy(x.item))}</span><span class="r">${esc(when)}</span></div>`;
  }).join('');
  $('#w-deadlines').innerHTML = homeCard({ title: 'Deadlines', href: '#deadlines', meta: over.length ? `${over.length} overdue` : `${open.length} open`, alert: over.length > 0,
    big, sub, body: rows, go: open.length > 5 ? `All ${open.length} deadlines` : 'All deadlines' });
}
function renderHomeMarks(now) {
  const Y = yearModel(buildMarks(state.gr)), up = marksWaiting(Y);
  const band = Y.avg == null ? '' : Y.avg >= 85 ? "Dean's List pace" : Y.avg >= 70 ? 'First-class pace' : Y.avg >= 60 ? '2:1 pace' : 'Below a 2:1';
  $('#w-marks').innerHTML = homeCard({ title: 'Marks', href: '#marks', meta: band,
    big: Y.avg != null ? `${pc(Y.avg, 0)}<small>%</small>` : '—',
    sub: Y.avg != null ? `average so far · <b>${pc(Y.banked, 1)}%</b> of the year banked` : 'No marks back yet',
    body: up.slice(0, 5).map(x => { const rd = returnDate(x.it), back = rd && rd.d;
      return `<div class="hc-li" title="${esc(tidyMark(x.it.name))}${rd && rd.why ? ' · ' + esc(rd.why) : ''}"><span class="t">${esc(tidyMark(x.it.name))}</span><span class="r">${back ? (rd.est ? '~' : '') + esc(shortDate(back, now)) : 'no date'}</span></div>`; }).join('')
      || '<div class="hc-li"><span class="t muted">Nothing waiting to be marked</span></div>',
    go: up.length ? `${up.length} waiting to be marked` : 'Marks and the year so far' });
}

/* ---------------------------------------------------------------- week ahead */
function termInfo(ov, d) {
  const terms = (ov.key_dates || {}).terms || {};
  for (const [name, t] of Object.entries(terms)) {
    const a = parseDue(t.teaching_starts), b = parseDue(t.end);
    if (a && b && d >= dayStart(a) && d <= b) return { name, week: Math.floor((dayStart(d) - dayStart(a)) / (7 * 864e5)) + 1 };
  }
  return null;
}
function closed(ov, d) {
  return ((ov.key_dates || {}).closures || []).some(c => { const a = parseDue(c.from), b = parseDue(c.to); return a && b && d >= dayStart(a) && d <= b; });
}
function listedWeek(c, wk) {
  const m = `${c.what || ''} ${c.weeks || ''}`.match(/weeks?\s+((?:\d+\s*,\s*)+\d+)/i);
  return !m || m[1].split(',').map(Number).includes(wk);
}
function labCycle(ov, c, d) {
  const cycles = (ov.lab_cycles || []).filter(x => x.module === c.module);
  if (!cycles.length) return true;
  const only = String(c.what || '').match(/cycle (\d+) only/i);
  return cycles.find(x => {
    if (only && String(x.cycle) !== only[1]) return false;
    const a = dayStart(parseDue(x.start));
    const b = /cycle weeks 1-4/i.test(c.weeks || '') ? addDays(a, 28) : addDays(dayStart(parseDue(x.end)), 1);
    return d >= a && d < b;
  }) || null;
}
/* calendar/sessions.md: every class by date for Terms 1 and 2, made from the department grids
   (_meta/dev/make_timetable_sessions.py). Outside the dates it covers, the week ahead falls back to the weekly pattern. */
function sessionsIndex(r) {
  const fm = r && r.fm, list = fm && fm.sessions;
  if (!Array.isArray(list) || !list.length) return null;
  const byDay = new Map();
  for (const x of list) { const k = String(x.date).slice(0, 10); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(x); }
  const cv = fm.covers || {};
  return { byDay, from: ymd(cv.from || list[0].date), to: ymd(cv.to || list[list.length - 1].date), room: fm.default_room || 'Lecture Theatre 1' };
}
function exactClasses(d) {
  const S = state.sessions;
  if (!S || d < S.from || d > S.to) return null;
  return (S.byDay.get(iso(d)) || []).map(x => ({ kind: 'class', a: hm(x.start), b: hm(x.end),
    time: x.start + (x.room && x.room !== S.room ? ` · ${x.room}` : ''), name: x.what, maybe: !!x.maybe, title: x.note || '' }));
}
/* the classes on the next few days, written out for Ask */
function classesText(now, days) {
  if (!state.sessions) return '';
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(dayStart(now), i), S = state.sessions;
    if (d < S.from || d > S.to) continue;
    const cs = S.byDay.get(iso(d)) || [];
    if (cs.length) out.push(`${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}: ` + cs.map(x => `${x.start}–${x.end} ${x.what}${x.room && x.room !== S.room ? ' (' + x.room + ')' : ''}${x.maybe ? ' (optional or not fixed)' : ''}`).join('; '));
  }
  return out.join('\n');
}
function classesOn(ov, d) {
  const exact = exactClasses(d);
  if (exact) return exact;
  const t = termInfo(ov, d);
  if (!t || t.name !== 'autumn' || closed(ov, d)) return [];
  const dn = DAYS[d.getDay()], out = [];
  for (const c of ((ov.timetable || {}).recurring_term1 || [])) {
    if (c.day !== dn || !listedWeek(c, t.week)) continue;
    const cyc = labCycle(ov, c, d);
    if (!cyc) continue;
    let name = String(c.what || '').replace(/\s*\([^)]*\)/g, '').replace(/,.*$/, '').replace(/\s+slot$/i, '').trim();
    if (/^lab$/i.test(name) && cyc !== true) name = `Lab: ${cyc.name[0].toUpperCase()}${cyc.name.slice(1)}`;
    out.push({ kind: 'class', a: hm(c.start), b: hm(c.end), time: c.start + (c.room ? ` · ${c.room}` : ''), name, maybe: /some weeks/i.test(`${c.what} ${c.weeks || ''}`) });
  }
  return out;
}
function eventsOn(ov, d, now) {
  const ev = classesOn(ov, d);
  const P = buildPlan(now);
  if (P) {
    for (const s of P.sessions) if (sameDay(s.d, d)) {
      const t = (state.tp || []).find(x => x.id === s.id);
      ev.push({ kind: 'rev', a: s.t0.getHours() + s.t0.getMinutes() / 60, b: s.t1.getHours() + s.t1.getMinutes() / 60, time: `${hhmm(s.t0)}–${hhmm(s.t1)}`, name: t ? t.topic : s.id, href: revHash(s.id) });
    }
  } else for (const s of (ov.plan || {}).sessions || []) {
    if (s.date === iso(d)) ev.push({ kind: 'rev', a: hm(s.start), b: hm(s.end), time: `${s.start}–${s.end}`, name: s.topic });
  }
  for (const x of ov.deadlines || []) {
    const t = parseDue(x.due);
    if (!t || x.module === 'all' || !isMarked(x) || !sameDay(t, d)) continue;
    const done = isDone(x), late = !done && dueEnd(x) < now;
    ev.push({ kind: 'dead', a: hasTime(x.due) ? t.getHours() + t.getMinutes() / 60 : -1, time: (hasTime(x.due) ? x.due.slice(11, 16) : 'due') + (late ? ' · overdue' : done ? ' · done' : ''), name: tidy(x.item), done });
  }
  const nowH = now.getHours() + now.getMinutes() / 60;
  for (const e of ev) e.past = e.kind !== 'dead' && sameDay(d, now) && e.b != null && e.b <= nowH;
  return ev.sort((x, y) => x.a - y.a || (x.kind === 'dead' ? -1 : 1));
}
function renderWeek(ov, now) {
  const el = $('#w-week'), start = addDays(dayStart(now), state.weekShift);
  const end = addDays(start, 6);
  $('.wk-title', el).textContent = state.weekShift === 0 ? 'Week ahead'
    : `${start.getDate()}${start.getMonth() !== end.getMonth() ? ' ' + MONTHS[start.getMonth()] : ''} – ${end.getDate()} ${MONTHS[end.getMonth()]}`;
  $('[data-shift="0"]', el).disabled = state.weekShift === 0;
  const html = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), today = sameDay(d, now), past = d < dayStart(now);
    const ev = eventsOn(ov, d, now);
    const items = ev.map(e => `<${e.href ? `a href="${e.href}"` : 'div'} class="ev ${e.kind}${e.maybe ? ' maybe' : ''}${e.past ? ' past' : ''}${e.done ? ' done' : ''}"${e.title ? ` title="${esc(e.title)}"` : ''}>
      <span class="tm">${esc(e.time)}</span><span class="nm">${esc(e.name)}</span></${e.href ? 'a' : 'div'}>`).join('');
    html.push(`<div class="day${today ? ' today' : ''}${past ? ' past' : ''}">
      <div class="dn"><b>${d.getDate()}</b><span>${DAYS[d.getDay()]}${today ? ' · today' : ''}${d.getDate() === 1 || i === 0 && !today ? ' ' + MONTHS[d.getMonth()] : ''}</span></div>
      ${items || '<div class="free">Free</div>'}</div>`);
  }
  $('.days', el).innerHTML = html.join('');
}

/* ---------------------------------------------------------------- marks page */
const MOD_NAMES = {
  PHYS50001: ['Lab', 'Advanced Practical Physics'], PHYS50002: ['TPSM', 'Thermal Physics & Structure of Matter'],
  PHYS50003: ['DE&EM', 'Differential Equations & Electromagnetism'], PHYS50004: ['Quantum', 'Quantum Physics'],
  PHYS50006: ['SSP', 'Suns, Stars & Planets'], PHYS50007: ['Maths Methods', 'Mathematical Methods'], EART60031: ['Space Mining', 'I-Explore']
};
const PART = { lab_continuous: 'Lab books & logs', lab_reports: 'Reports', computing: 'Computing', exam: 'Exam', aps: 'Assessed sheets',
  seminars: 'Seminars', aps_and_seminars: 'Sheets & seminars', A1_legal_framework: 'A1 Legal study', A2_startup_pitch: 'A2 Pitch' };
/* first YYYY-MM-DD in a field like "2026-11-25T16:00:00+00:00" or "w/c 2026-11-16" (no time = end of day) */
function anyDate(s) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59) : null;
}
const dayLabel = (d, now) => { const n = Math.round((dayStart(d) - dayStart(now)) / 864e5); return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const tidyMark = s => String(s || '').replace(/\s*\(([^)]*)\)/g, (m, i) => /[:;]|pages?|with|IEEE|\d/i.test(i) || i.length > 30 ? '' : m).trim();
const isScored = it => (it.score != null && it.points) || (it.mark != null && it.out_of);
const isWaiting = it => it.status === 'submitted' && !isScored(it);
const isPeer = it => /peer/.test(it.id || '');

function partOf(code, it) {
  const id = it.id || '', k = it.kind || '';
  if (code === 'PHYS50001') return /^comp/.test(id) ? 'computing' : /report|slides|present/.test(id) ? 'lab_reports' : 'lab_continuous';
  if (code === 'EART60031') return /^sm-a1/.test(id) ? 'A1_legal_framework' : 'A2_startup_pitch';
  if (k === 'exam') return 'exam';
  if (code === 'PHYS50004') return 'aps_and_seminars';
  return k === 'seminar' ? 'seminars' : 'aps';
}
function markStatus(it, now) {
  if (it.score != null && it.points) return { t: `${it.score}/${it.points}`, c: 'score' };
  if (it.mark != null && it.out_of) return { t: `${it.mark}/${it.out_of}`, c: 'score' };
  if (it.status === 'submitted') { const b = anyDate(it.marks_back); return { t: b ? `back ${dayLabel(b, now)}` : 'awaiting mark', c: 'wait' }; }
  if (it.kind === 'exam') return { t: 'Term 3', c: 'later' };
  if (it.kind === 'seminar') {
    if (it.sessions) return { t: `${it.sessions.filter(s => /✅/.test(s)).length} of ${it.sessions.length} done`, c: 'later' };
    if (it.sessions_so_far) return { t: `${it.sessions_so_far.length} so far`, c: 'later' };
  }
  const d = anyDate(it.due);
  if (d && d < now && it.status !== 'upcoming') return { t: 'not submitted', c: 'late' };
  return d ? { t: `due ${dayLabel(d, now)}`, c: 'later' } : { t: '—', c: 'later' };
}
function buildMarks(gr) {
  return (gr || []).filter(m => (m.items || []).length).map(m => {
    const parts = Object.entries(m.module || {}).map(([key, w]) => {
      const items = m.items.filter(it => partOf(m.code, it) === key);
      const pts = items.reduce((a, it) => a + (it.points || 0), 0), got = items.filter(isScored).reduce((a, it) => a + (it.points || 0), 0);
      let cls = 'todo', p = 0;
      if (items.length && items.every(isScored)) cls = 'marked';
      else if (items.some(isScored)) { cls = 'part'; p = pts ? Math.round(100 * got / pts) : 50; }
      else if (items.some(isWaiting)) cls = 'waiting';
      return { key, label: PART[key] || key, w, cls, p, items };
    });
    const g = m.items.filter(it => it.score != null && it.points);
    const got = g.reduce((a, it) => a + it.score, 0), of = g.reduce((a, it) => a + it.points, 0);
    const week = it => +((String(it.name).match(/Week (\d)/) || [])[1] || 0);
    const order = it => it.kind === 'exam' ? 9e15 : anyDate(it.due) ? anyDate(it.due).getTime() : isScored(it) ? 1 + week(it) : 9e14;
    const nm = MOD_NAMES[m.code] || [m.short, m.short];
    return { code: m.code, short: nm[0], long: nm[1], parts, got, of, pct: of ? Math.round(100 * got / of) : null,
      items: m.items.filter(it => !isPeer(it)).sort((a, b) => order(a) - order(b)) };
  });
}
/* ---- how the year counts (year/programme.md) ----
   Year mark = credit-weighted average of the graded modules. Space Mining (I-Explore) is pass/fail,
   so it is shown but never counted. Inside a module, each part (exam, APS, …) carries its stated
   weight; inside a part, work with points is weighted by points, otherwise split equally. */
const ECTS = { PHYS50001: 10, PHYS50002: 10, PHYS50003: 10, PHYS50004: 15, PHYS50006: 5, PHYS50007: 5 };
const PASS_FAIL = new Set(['EART60031']);
const YEAR_ECTS = Object.values(ECTS).reduce((a, b) => a + b, 0);
const fracOf = it => it.score != null && it.points ? it.score / it.points : it.mark != null && it.out_of ? it.mark / it.out_of : null;

/* Work that scores 100% just for taking part (from the assessment files). */
const AUTO_FULL = new Set(['qp-seminars']);
const TERMS = { autumn: [new Date(2026, 8, 28), new Date(2026, 11, 11, 23, 59)], spring: [new Date(2027, 0, 4), new Date(2027, 2, 19, 23, 59)] };
const YEAR_SPAN = [new Date(2026, 8, 28), new Date(2027, 6, 16, 23, 59)];
const RESULTS_DAY = new Date(2027, 6, 14, 12);        // exam results: after the UG exam boards, 9 Jun – 14 Jul 2027
/* ---- when marks come back ----
   Evidence in the files, used to estimate everything without a stated return date:
   - Lab: the Lab announcement (4 Nov) says all of Cycle 1 comes back together on Wed 25 Nov, 19 days after the
     Interferometry cycle ended (6 Nov). So a cycle's report, slides, presentation and reflective log come back
     the same gap after that cycle ends. Lab books are signed off and marked in the session; the partner agreement
     was already marked at the first sync, so it counts within a week of its deadline.
   - Assessed problem sheets: DE APS 1 (28 Oct -> 18 Nov) and TPSM APS 3 (27 Jan -> 17 Feb) take three weeks in term.
     Sheets from the same APS round (same deadline) come back together.
   - Seminars: TPSM seminars on 8 and 22 Oct were attended but no marks have appeared, so seminar marks are
     released once the series ends, then the usual three weeks.
   - Exams: results after the UG exam boards (9 Jun - 14 Jul).
   Anything landing in the Christmas closure moves to the first day back. */
const DAY = 864e5, IN_TERM = 21 * DAY;
const LAB_CYCLE_OF = { int: 'interferometry', rad: 'radioactivity', wav: 'waves' };
function afterClosure(d) {
  for (const c of ((state.ov || {}).key_dates || {}).closures || []) {
    const a = anyDate(c.from), b = anyDate(c.to);
    if (a && b && d >= dayStart(a) && d <= b) return new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1, 12);
  }
  return d;
}
function labCycleLag() {             // days from a cycle's end to its marks, learned from any cycle with a stated date
  const cycles = (state.ov || {}).lab_cycles || [];
  for (const m of state.gr || []) for (const it of m.items || []) {
    const c = cycles.find(c => c.name === LAB_CYCLE_OF[String(it.id).split('-')[0]]), back = anyDate(it.marks_back);
    if (c && back) return Math.round((dayStart(back) - dayStart(anyDate(c.end))) / DAY) * DAY;
  }
  return IN_TERM;
}
function returnDate(it) {
  const est = (d, why) => ({ d: afterClosure(d), est: true, why });
  const back = anyDate(it.marks_back);
  if (back) return { d: back, est: false, why: 'return date from Canvas' };
  if (it.kind === 'exam') return est(RESULTS_DAY, 'exam results after the UG exam boards');
  /* same APS round, already dated */
  if (it.kind === 'assessed-problem-sheet' && it.due) {
    for (const m of state.gr || []) for (const o of m.items || []) {
      if (o !== it && o.kind === 'assessed-problem-sheet' && String(o.due).slice(0, 10) === String(it.due).slice(0, 10) && anyDate(o.marks_back))
        return { d: anyDate(o.marks_back), est: true, why: `same APS round as ${tidyMark(o.name)}` };
    }
  }
  /* lab work */
  const cyc = ((state.ov || {}).lab_cycles || []).find(c => c.name === LAB_CYCLE_OF[String(it.id || '').split('-')[0]]);
  const due = anyDate(it.due);
  if (/Lab Book Week/i.test(it.name || '')) return due ? { d: due, est: false, why: 'marked in the session' } : null;
  if (cyc && /agree/.test(it.id)) return due ? est(new Date(due.getTime() + 7 * DAY), 'partner agreements are marked within a week') : null;
  if (cyc) return est(new Date(anyDate(cyc.end).getTime() + labCycleLag()), `with the rest of the ${cyc.name} cycle`);
  if (it.kind === 'seminar') return null;            // handled per series in yearModel
  if (!due) return null;
  return est(new Date(due.getTime() + IN_TERM), 'three weeks after hand-in, like the APS');
}
/* last session of a seminar series ("T2 wk5") + three weeks */
function seminarRelease(it) {
  const ds = (it.sessions || []).map(sessionDate).filter(Boolean);
  if (ds.length) return afterClosure(new Date(Math.max(...ds) + IN_TERM));
  return afterClosure(new Date(TERMS.spring[1].getTime() + IN_TERM));
}

/* when a mark landed: its due date, or for undated lab books, a week before the next one */
function markDate(it, siblings) {
  const d = anyDate(it.due);
  if (d) return d;
  const wk = +((String(it.name).match(/Week (\d)/) || [])[1] || 0);
  if (wk) for (const s of siblings) {
    const w2 = +((String(s.name).match(/Week (\d)/) || [])[1] || 0), d2 = anyDate(s.due);
    if (d2 && w2 > wk && String(s.name).replace(/Week \d/, '') === String(it.name).replace(/Week \d/, '')) return new Date(d2.getTime() - (w2 - wk) * 7 * 864e5);
  }
  return null;
}
/* "T1 wk8" -> Thursday of autumn-term week 8 */
function sessionDate(s) {
  const m = String(s).match(/T(\d)\s*wk\s*(\d+)/i);
  if (!m) return null;
  const start = m[1] === '1' ? TERMS.autumn[0] : TERMS.spring[0];
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * (+m[2] - 1) + 3, 12);
}
function yearModel(mods) {
  const items = [];                                  // one entry per piece of work, with its share of the year
  for (const m of mods) {
    m.share = PASS_FAIL.has(m.code) ? 0 : 100 * (ECTS[m.code] || 0) / YEAR_ECTS;
    for (const p of m.parts) {
      const its = p.items.filter(it => !isPeer(it));
      const pts = its.reduce((a, it) => a + (it.points || 0), 0);
      for (const it of its) {
        const yw = m.share * p.w / 100 * (pts ? (it.points || 0) / pts : 1 / its.length);
        const base = { it, mod: m, auto: AUTO_FULL.has(it.id), frac: fracOf(it) };
        if (it.kind === 'seminar' && Array.isArray(it.sessions) && it.sessions.length) {
          items.push(Object.assign(base, { yw, when: seminarRelease(it), why: 'seminar marks are released when the series ends' }));
          continue;
        }
        const rd = returnDate(it);
        let when = isScored(it) ? markDate(it, its) : rd && rd.d;
        if (!when && it.kind === 'seminar') { when = seminarRelease(it); base.why = 'seminar marks are released when the series ends'; }
        if (rd && !base.why) base.why = rd.why;
        items.push(Object.assign(base, { yw, when: when || YEAR_SPAN[1] }));
      }
    }
  }
  /* modules with no assessment published yet (Maths Methods): assume an exam in the exam period */
  for (const [code, ects] of Object.entries(ECTS)) {
    if (!mods.some(m => m.code === code)) items.push({ it: { id: code, name: (MOD_NAMES[code] || [code])[1] + ' (assessment TBC)' }, mod: { code, short: (MOD_NAMES[code] || [code])[0] }, auto: false, frac: null, yw: 100 * ects / YEAR_ECTS, when: RESULTS_DAY });
  }
  const counted = items.filter(x => x.yw > 0);
  const marked = counted.filter(x => x.frac != null);
  const markedW = marked.reduce((a, x) => a + x.yw, 0), banked = marked.reduce((a, x) => a + x.yw * x.frac, 0);
  const autoW = counted.filter(x => x.auto).reduce((a, x) => a + x.yw, 0);
  const left = counted.filter(x => x.frac == null);
  const autoLeft = left.filter(x => x.auto).reduce((a, x) => a + x.yw, 0), restW = left.filter(x => !x.auto).reduce((a, x) => a + x.yw, 0);
  /* what you'd need on everything not yet marked (automatic-100% work counted as 100) to finish on g */
  const need = g => restW ? 100 * (g - banked - autoLeft) / restW : null;
  /* the pace line for g: g% on every mark (automatic work at 100%, the rest scaled so the year ends exactly on g) */
  const paceRate = g => (g - autoW) / (100 - autoW);
  const timeline = counted.slice().sort((a, b) => a.when - b.when);
  const paceAt = (g, t) => timeline.filter(x => x.when <= t).reduce((a, x) => a + x.yw * (x.auto ? 1 : paceRate(g)), 0);
  const series = []; let w = 0, b = 0;
  for (const x of [...marked].sort((p, q) => p.when - q.when)) {
    w += x.yw; b += x.yw * x.frac;
    series.push({ when: x.when, avg: 100 * b / w, cum: b, name: tidyMark(x.it.name), got: x.frac });
  }
  return { items, counted, timeline, markedW, banked, total: counted.reduce((a, x) => a + x.yw, 0),
    avg: markedW ? 100 * banked / markedW : null, series, need, paceAt, autoW };
}
const pc = (x, dp = 1) => (Math.round(x * 10 ** dp) / 10 ** dp).toFixed(dp).replace(/\.0+$/, '');

function marksHeadline(Y) {
  const lost = Y.markedW - Y.banked, left = 100 - Y.markedW;
  return `
  <article class="w mk-so"><div class="k"><span>Mark so far</span><span>of the marks you've had</span></div>
    <div class="big">${Y.avg != null ? pc(Y.avg, 0) + '%' : '—'}</div>
    <div class="sub">${Y.avg != null ? `${pc(100 * Y.banked / Y.markedW, 1)}% across ${pc(Y.markedW, 2)}% of the year marked so far` : 'No marks back yet'}</div>
    <div class="band">${Y.avg == null ? '' : Y.avg >= 85 ? "Dean's List pace" : Y.avg >= 70 ? 'First-class pace' : Y.avg >= 60 ? '2:1 pace' : 'Below a 2:1'}</div></article>
  <article class="w mk-year"><div class="k"><span>Mark so far</span><span>of the whole year</span></div>
    <div class="big">${pc(Y.banked, 1)}%</div>
    <div class="sub">banked out of 100% · ${pc(left, 1)}% of the year still to be marked</div>
    <div class="yearbar" title="Banked ${pc(Y.banked, 2)}% · dropped ${pc(lost, 2)}% · still to come ${pc(left, 1)}%">
      <i class="banked" style="width:${Y.banked}%"></i><i class="lost" style="width:${lost}%"></i></div>
    <div class="yearkey"><span><i class="banked"></i>Banked</span><span><i class="lost"></i>Dropped</span><span><i></i>Still to come</span></div></article>`;
}
const marksWaiting = Y => Y.items.filter(x => isWaiting(x.it)).sort((a, b) => ((returnDate(a.it) || {}).d || 9e15) - ((returnDate(b.it) || {}).d || 9e15));
function marksUpcoming(Y, now) {
  const wait = marksWaiting(Y);
  const rows = wait.slice(0, 5).map(x => {
    const rd = returnDate(x.it), back = rd && rd.d;
    const worth = PASS_FAIL.has(x.mod.code) ? 'pass/fail' : `${pc(x.yw, 1)}% of the year`;
    return `<div class="up"><div><b>${esc(tidyMark(x.it.name))}</b><span>${esc(x.mod.short)} · ${esc(worth)}</span></div>
      <div class="r st wait" title="${rd ? (rd.est ? 'Estimate: ' : '') + esc(rd.why) : ''}">${back ? (rd.est ? 'back ~' : 'back ') + esc(dayLabel(back, now)) : 'no date yet'}</div></div>`;
  }).join('');
  return `<article class="w mk-up"><div class="k"><span>Upcoming marks</span><span>${wait.length} waiting</span></div>
    <div class="ups">${rows || '<div class="empty">Nothing waiting to be marked.</div>'}</div></article>`;
}
/* Running %: your average over what has been marked.
   Cumulative: how much of the year's 100% you have banked, against a pace line for each grade
   boundary (that % on every mark, automatic-100% work at 100%), so each line ends the year on its boundary. */
const BOUNDS = [[100, '100%'], [85, "Dean's List"], [70, 'First'], [60, '2:1']];
function niceStep(span) { const raw = span / 5, p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw); }
function marksChart(Y, now) {
  /* "So far": from the start of the year to today (plus a few days so today isn't on the edge) */
  const cum = state.chartMode === 'cum', term = state.chartRange !== 'year';
  const t0d = YEAR_SPAN[0], t1d = term ? new Date(now.getTime() + 5 * 864e5) : YEAR_SPAN[1], t0 = t0d.getTime(), t1 = t1d.getTime();
  const W = 1000, H = 320, L = 52, R = 170, T = 18, B = 34;
  const pts = Y.series.filter(s => s.when && s.when.getTime() <= t1), val = p => cum ? p.cum : p.avg;
  /* y range: running is always 55–100; cumulative is 0–100 for the year, or fitted to the term */
  let lo = 55, hi = 100;
  if (cum) {
    lo = 0;
    hi = term ? Math.max(Y.paceAt(100, t1d), ...pts.map(val), 0.5) * 1.12 : 100;
  }
  const x = t => L + (W - L - R) * (Math.min(t1, Math.max(t0, t)) - t0) / (t1 - t0);
  const y = v => T + (H - T - B) * (hi - Math.max(lo, Math.min(hi, v))) / (hi - lo);
  const parts = [];
  /* y-axis labels (cumulative mode only; running uses the boundary labels) */
  if (cum) {
    const st = niceStep(hi - lo);
    for (let v = 0; v <= hi + 1e-9; v += st) parts.push(`<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 10}" y="${y(v) + 4}" class="ylbl">${pc(v, st < 1 ? 1 : 0)}%</text>`);
  }
  /* months along the bottom */
  for (let d = new Date(t0d.getFullYear(), t0d.getMonth() + 1, 1); d.getTime() <= t1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1))
    parts.push(`<line x1="${x(d)}" x2="${x(d)}" y1="${H - B}" y2="${H - B + 5}" class="tick"/><text x="${x(d)}" y="${H - 10}" class="mlbl">${MONTHS[d.getMonth()]}</text>`);
  /* boundary lines: flat in running mode, pace curves in cumulative mode */
  const labels = [];
  for (const [g, name] of BOUNDS) {
    if (!cum) { parts.push(`<line x1="${L}" x2="${W - R}" y1="${y(g)}" y2="${y(g)}" class="ref r${g}"/>`); labels.push({ y: y(g), g, text: g === 100 ? '100%' : `${name} · ${g}%` }); continue; }
    const steps = Y.timeline.filter(it => it.when.getTime() > t0 && it.when.getTime() <= t1);
    let v = Y.paceAt(g, t0d), d = `M${x(t0).toFixed(1)},${y(v).toFixed(1)}`;
    for (const it of steps) { v = Y.paceAt(g, it.when); d += `H${x(it.when).toFixed(1)}V${y(v).toFixed(1)}`; }
    d += `H${x(t1).toFixed(1)}`;
    parts.push(`<path d="${d}" class="pace r${g}"/>`);
    labels.push({ y: y(v), g, text: `${name} · ${pc(v, term ? 1 : 0)}%` });
  }
  /* keep the right-hand labels from overlapping */
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
  for (const l of labels) parts.push(`<text x="${W - R + 10}" y="${l.y + 4}" class="reflbl r${l.g}">${esc(l.text)}</text>`);
  if (cum && !term) parts.push(`<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" class="grid base"/>`);
  /* today */
  const nowIn = now.getTime() >= t0 && now.getTime() <= t1, nowX = x(now.getTime());
  if (nowIn) parts.push(`<line x1="${nowX}" x2="${nowX}" y1="${T}" y2="${H - B}" class="now"/><text x="${nowX}" y="${T - 5}" class="nowlbl">today</text>`);
  /* your line */
  if (pts.length) {
    const xy = pts.map(p => [x(p.when.getTime()), y(val(p))]);
    const start = cum ? `M${x(t0).toFixed(1)},${y(0).toFixed(1)}H${xy[0][0].toFixed(1)}V${xy[0][1].toFixed(1)}` : `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
    const path = start + xy.slice(1).map(([a, b]) => `H${a.toFixed(1)}V${b.toFixed(1)}`).join('') + `H${(nowIn ? nowX : x(t1)).toFixed(1)}`;
    parts.push(`<path d="${path}V${H - B}H${(cum ? x(t0) : xy[0][0]).toFixed(1)}Z" fill="url(#fillg)"/><path d="${path}" class="line"/>`);
    for (const p of pts) parts.push(`<circle cx="${x(p.when.getTime())}" cy="${y(val(p))}" r="5" class="dot"><title>${esc(p.name)}: ${pc(100 * p.got, 0)}% · ${cum ? `banked ${pc(p.cum, 2)}% of the year` : `running ${pc(p.avg, 1)}%`}</title></circle>`);
    const lp = pts[pts.length - 1];
    parts.push(`<text x="${(nowIn ? nowX : x(t1)) + 8}" y="${y(val(lp)) - 10}" class="endlbl">${pc(val(lp), cum ? 2 : 1)}%</text>`);
  }
  /* what you need on everything left to finish on each boundary */
  const need = cum ? `<div class="need"><div class="need-h">To finish the year on…</div>${BOUNDS.slice().reverse().map(([g, name]) => {
    const n = Y.need(g);
    const txt = n == null ? '—' : n > 100 ? 'out of reach' : n <= 0 ? 'already secured' : `${pc(n, 1)}%`;
    return `<div class="need-c r${g}"><span>${esc(g === 100 ? '100%' : `${name} · ${g}%`)}</span><b>${txt}</b><small>${n != null && n > 0 && n <= 100 ? 'average needed on everything left' : ''}</small></div>`;
  }).join('')}</div>` : '';
  const pill = (attr, opts, cur) => `<div class="pill-switch" role="tablist">${opts.map(([v, l]) => `<button role="tab" ${attr}="${v}" class="${cur === v ? 'on' : ''}" aria-selected="${cur === v}">${l}</button>`).join('')}</div>`;
  return `<article class="w wide mk-chart"><div class="wk-head"><div class="k"><span>${cum ? 'Cumulative mark' : 'Running mark'}</span></div>
      <div class="pills">${pill('data-range', [['sofar', 'So far'], ['year', 'Whole year']], state.chartRange === 'year' ? 'year' : 'sofar')}${pill('data-chart', [['run', 'Running %'], ['cum', 'Cumulative mark']], state.chartMode)}</div></div>
    <div class="chart-note">${cum ? 'How much of the year you have banked, against the pace for each boundary: that percentage on every mark (automatic full-mark work at 100%), stepping up on the day each mark comes back and ending the year exactly on it.' : 'Your average over everything marked so far.'}</div>
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="${cum ? 'Cumulative mark against grade pace lines' : 'Running average mark'}">
      <defs><linearGradient id="fillg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
      ${parts.join('')}
    </svg>${pts.length ? '' : '<div class="empty">The line starts with your first mark.</div>'}${need}</article>`;
}
function marksWeightMap(mods, Y) {
  const mm = { code: 'PHYS50007', short: 'Maths Methods', long: 'Mathematical Methods', parts: [], share: 100 * ECTS.PHYS50007 / YEAR_ECTS, pct: null };
  const list = mods.some(m => m.code === 'PHYS50007') ? mods : [...mods.filter(m => !PASS_FAIL.has(m.code)), mm, ...mods.filter(m => PASS_FAIL.has(m.code))];
  const rows = list.map(m => {
    const segs = m.parts.length ? m.parts.map(p => {
      const its = p.items.filter(it => !isPeer(it)), done = its.filter(isScored).length, w8 = its.filter(isWaiting).length;
      const note = p.key === 'exam' ? 'Term 3' : done ? `${done} of ${its.length} marked` : w8 ? `${w8} waiting` : its.length ? `${its.length} to come` : '';
      return `<div class="${p.cls}" style="flex:${p.w};--p:${p.p}%" title="${esc(p.label)}${note ? ' · ' + esc(note) : ''}"><b>${p.w}%</b><small>${esc(p.label)}${note ? ' · ' + esc(note) : ''}</small></div>`;
    }).join('') : '<div style="flex:1"><b>TBC</b><small>Assessment published when the Spring course opens</small></div>';
    const pf = PASS_FAIL.has(m.code);
    return `<div class="wm"><div class="nm"><b>${esc(m.short)}</b><span>${esc(m.long)} · ${pf ? 'pass/fail, not counted' : pc(m.share, 1) + '% of the year'}</span></div>
      <div class="seg">${segs}</div>
      <div class="score">${m.pct != null ? `<b>${m.pct}%</b><span>so far</span>` : `<span>${pf ? 'pass/fail' : 'no marks yet'}</span>`}</div></div>`;
  }).join('');
  return `<article class="w wide"><div class="wk-head"><div class="k"><span>Where your marks come from</span></div>
    <div class="key"><span class="k1"><i></i>Marked</span><span class="k2"><i></i>Waiting</span><span class="k3"><i></i>Still to come</span></div></div>${rows}</article>`;
}
function renderMarksPage(now) {
  const mods = buildMarks(state.gr), Y = yearModel(mods);
  setHTML($('#view-marks'), marksHeadline(Y) + marksUpcoming(Y, now) + marksChart(Y, now) + (window.icdWhatIf ? icdWhatIf(Y) : '') + marksWeightMap(mods, Y));
}

/* ---------------------------------------------------------------- deadlines page
   Marked work only (items in deadlines.md with ids pointing at assessment.md), each with what the task is
   (about), where to hand it in (url), the files that explain it (docs), a time estimate (hours; hours_note
   when the course says how long) and what it is worth, from the same year model as the Marks page.
   Layout: a big countdown to the next deadline, then a horizontal accordion of every deadline in date
   order (done ones to the left), scrolled so the next one is first; click a panel to open it. */
const MOD_LONG = Object.assign({}, MOD_NAMES, { 'student-essentials': ['Student Essentials', 'Student Essentials'], all: ['All modules', 'All modules'], EART60031: ['Space Mining', 'Space Mining (I-Explore)'] });
const modShort = code => String(code || '').split('+').map(c => (MOD_LONG[c] || [c])[0]).join(' + ');
const modLong = code => String(code || '').split('+').map(c => (MOD_LONG[c] || [c, c])[1]).join(' + ');
const DOC_LABEL = [[/Rubric/i, 'Lab rubric'], [/exemplar/i, 'Example report'], [/template/i, 'Report template'], [/Script/i, 'Lab script'],
  [/brief/i, 'Brief'], [/Succeeding/i, 'Presentation guide'], [/A3-sheets/i, 'Session 5 sheets'], [/exams\.md$/, 'Exam info'], [/student-essentials/, 'What the trainings are']];
const docLabel = p => (DOC_LABEL.find(([re]) => re.test(p)) || [, p.split('/').pop()])[1];
const fileUrl = p => '/file/' + String(p).split('/').map(encodeURIComponent).join('/');
const hoursTxt = h => h == null ? null : h < 1 ? `${Math.round(h * 60)} min` : `${pc(h, 1)} h`;
const timeTxt = x => x.hours ? (x.hours_note ? '' : '~') + hoursTxt(x.hours) : '';
const weekStart = d => addDays(dayStart(d), -((d.getDay() + 6) % 7));
const dueTxt = x => { const d = x.d; return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${x.timed ? ' · ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : ''}`; };

function dlModel(now) {
  const Y = yearModel(buildMarks(state.gr));
  const byId = new Map(Y.items.map(y => [y.it.id, y]));
  const list = (state.ov.deadlines || []).filter(isMarked).map(x => {
    const d = parseDue(x.due);
    if (!d) return null;
    const end = dueEnd(x), done = isDone(x);
    const doneLabel = x.status === 'submitted' ? 'submitted' : 'done';
    const hits = (x.ids || []).map(id => byId.get(id)).filter(Boolean);
    /* what it is worth */
    let worth = { short: '—', parts: ['—'], year: 0 };
    if (x.part_of) worth = { short: `part of ${x.part_of}`, parts: [`Marked as part of ${x.part_of}`], year: 0 };
    else if (hits.length) {
      const year = hits.reduce((a, y) => a + y.yw, 0), mod = hits[0].mod, pf = PASS_FAIL.has(mod.code);
      const parts = [];
      if (x.points) parts.push(`${x.points} pts`);
      if (hits.length > 1 && hits.every(y => y.it.kind === 'exam')) parts.push(`${hits.length} exams`);
      else if (pf) parts.push(`${hits.reduce((a, y) => a + (y.it.weight || 0), 0)}% of ${mod.short}`);
      else if (mod.share) parts.push(`${pc(100 * year / mod.share, 1)}% of ${mod.short}`);
      parts.push(pf ? 'pass/fail module' : `${pc(year, year < 1 ? 2 : 1)}% of the year`);
      const others = (x.modules || []).filter(c => !hits.some(y => y.mod.code === c));
      if (others.length && !pf) parts.push(`+ ${modShort(others.join('+'))} part`);
      worth = { short: pf ? `${hits.reduce((a, y) => a + (y.it.weight || 0), 0)}% · pass/fail` : `${pc(year, year < 1 ? 2 : 1)}% of year`, parts, year: pf ? 0 : year };
    }
    return Object.assign({}, x, { d, end, done, doneLabel, timed: hasTime(x.due), late: !done && end < now, title: tidy(x.item), worth });
  }).filter(Boolean).sort((a, b) => a.end - b.end);
  const open = list.filter(x => !x.done);
  return { list, open, next: open.find(x => x.end >= now), late: open.filter(x => x.late) };
}

/* live countdown: render() writes the target, tickCount() keeps the numbers moving every second */
function countParts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [[Math.floor(s / 86400), 'd'], [Math.floor(s / 3600) % 24, 'h'], [Math.floor(s / 60) % 60, 'm'], [s % 60, 's']];
}
const countHTML = ms => countParts(ms).map(([v, u], i) => `<span class="cd-u"><b>${i ? pad(v) : v}</b><i>${u}</i></span>`).join('');
function tickCount() {
  document.querySelectorAll('[data-count]').forEach(el => { el.innerHTML = countHTML(+el.dataset.count - Date.now()); });
}
const relTxt = (x, now) => {
  if (x.done) return x.doneLabel;
  if (x.late) return 'overdue';
  const days = Math.round((dayStart(x.d) - dayStart(now)) / DAY);
  return days === 0 ? 'today' : days === 1 ? 'tomorrow' : days < 14 ? `in ${days} days` : `in ${Math.round(days / 7)} weeks`;
};

function dlButtons(x) {
  const canvas = x.url ? `<a class="btn solid" href="${esc(x.url)}" target="_blank" rel="noopener">${/assignments\/\d+/.test(x.url) ? 'Submit on Canvas' : /assignments$/.test(x.url) ? 'Canvas assignments' : 'Canvas course'} ↗</a>` : '';
  const docs = (x.docs || []).map(p => `<a class="btn" href="${esc(fileUrl(p))}" target="_blank" rel="noopener">${esc(docLabel(p))}</a>`).join('');
  const tick = x.done ? '' : `<button class="btn tick-btn" data-tickdl="${x.index}">Mark done</button>`;
  return canvas || docs || tick ? `<div class="dl-btns">${canvas}${docs}${tick}</div>` : '';
}
function dlFacts(x) {
  const h = hoursTxt(x.hours);
  return `<div class="dl-facts">
    <div><span>Due</span><b>${esc(dueTxt(x))}</b></div>
    <div><span>Worth</span><b>${esc(x.worth.parts.join(' · '))}</b></div>
    <div><span>Time</span><b title="${x.hours_note ? esc(x.hours_note) : 'Rough estimate. Change hours in deadlines.md'}">${h ? esc(timeTxt(x)) + (x.hours_note ? '' : ' <small>estimate</small>') : '—'}</b></div>
  </div>`;
}

/* big countdown to the next marked deadline */
function dlHero(M, now) {
  const n = M.next;
  const late = M.late.length ? `<div class="dl-late small">${M.late.length} overdue: ${M.late.map(x => esc(x.title)).join(', ')}. Within 24 hours the mark is capped at the pass mark; after that it is zero.</div>` : '';
  if (!n) return `<article class="w wide dl-hero"><div class="k"><span>Next up</span></div><div class="empty">Nothing left to hand in.</div>${late}</article>`;
  return `<article class="w wide dl-hero"><div class="k"><span>Next up · ${esc(modShort(n.module))}</span><span>${esc(dueTxt(n))}</span></div>
    <div class="cd huge" data-count="${n.end.getTime()}">${countHTML(n.end - now)}</div><div class="nx-t big2">${esc(n.title)}</div>
    <div class="sub">${esc(n.worth.parts.join(' · '))}${n.hours ? ' · ' + esc(timeTxt(n)) : ''}</div>${dlButtons(n)}${late}</article>`;
}

/* the accordion: a slim panel per deadline (date, title, worth), one open panel with everything,
   and a slim label where each week starts */
function dlPanel(x, now, open) {
  const d = x.d;
  return `<section class="acc-p${open ? ' open' : ''}${x.late ? ' over' : ''}${x.done ? ' is-done' : ''}" data-index="${x.index}" data-acc="${x.index}" tabindex="0" aria-expanded="${open}" aria-label="${esc(x.title)}, ${esc(dueTxt(x))}">
    <div class="acc-shut">
      <div class="acc-date"><b>${d.getDate()}</b><span>${MONTHS[d.getMonth()]}</span><small>${DAYS[d.getDay()]}${x.timed ? ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) : ''}</small></div>
      <div class="acc-title"><span>${esc(x.title)}</span></div>
      <div class="acc-foot"><span>${esc(modShort(x.module))}</span><b>${esc(x.done ? x.doneLabel : x.worth.short)}</b></div>
    </div>
    <div class="acc-open">
      <div class="k"><span>${esc(modLong(x.module))}</span><span class="${x.late ? 'alert' : ''}">${esc(relTxt(x, now))}</span></div>
      <h3>${esc(x.title)}</h3>
      ${dlFacts(x)}
      ${x.about ? `<p class="dl-about">${esc(x.about)}</p>` : ''}
      ${dlButtons(x)}
    </div>
  </section>`;
}
function dlAccordion(M, now) {
  const ws = weekStart(now), out = [];
  let lastWeek = null;
  const weekHours = new Map();
  for (const x of M.open) { const k = x.late ? 'late' : iso(weekStart(x.d)); weekHours.set(k, (weekHours.get(k) || 0) + (x.hours || 0)); }
  for (const x of M.list) {
    const key = x.done ? 'done' : x.late ? 'late' : iso(weekStart(x.d));
    if (key !== lastWeek) {
      const n = key.length === 10 ? Math.round((weekStart(x.d) - ws) / (7 * DAY)) : null;
      const label = key === 'done' ? 'Done' : key === 'late' ? 'Overdue' : n === 0 ? 'This week' : n === 1 ? 'Next week' : `Week of ${weekStart(x.d).getDate()} ${MONTHS[weekStart(x.d).getMonth()]}`;
      const h = weekHours.get(key);
      out.push(`<div class="acc-sep${key === 'late' ? ' late' : ''}${key === 'done' ? ' done' : ''}" aria-hidden="true"><span>${esc(label)}${h ? ' · ~' + esc(hoursTxt(h)) : ''}</span></div>`);
      lastWeek = key;
    }
    out.push(dlPanel(x, now, x.index === state.dlOpenIdx));
  }
  return `<article class="w wide dl-acc"><div class="wk-head"><div class="k"><span>Every deadline</span><span>${M.open.length} to go · marked work only</span></div>
      <div class="nav"><button class="btn icon" data-accmove="-1" aria-label="Earlier">&#8592;</button><button class="btn" data-accmove="0">Next up</button><button class="btn icon" data-accmove="1" aria-label="Later">&#8594;</button></div></div>
    <div class="acc">${out.join('')}</div></article>`;
}

function renderDeadlinesPage(now) {
  const M = dlModel(now);
  if (state.dlOpenIdx == null || !M.list.some(x => x.index === state.dlOpenIdx)) state.dlOpenIdx = (M.next || M.open[0] || M.list[M.list.length - 1] || {}).index;
  const old = $('#view-deadlines .acc'), left = old ? old.scrollLeft : null;
  $('#view-deadlines').innerHTML = dlHero(M, now) + dlAccordion(M, now);
  $('#subtitle').textContent = `Year 2 · ${M.open.length} to go`;
  const acc = $('#view-deadlines .acc');
  if (left != null && !state.dlAccReset) acc.scrollLeft = left;   // a re-render keeps where you had scrolled to
  else { accTo(M.next ? M.next.index : state.dlOpenIdx, false); state.dlAccReset = false; }
}

/* scroll the strip (never the page) so a panel sits at its left edge, just after its week label */
function accTo(i, smooth = true) {
  const acc = $('#view-deadlines .acc'), p = acc && acc.querySelector(`[data-acc="${i}"]`);
  if (!p) return;
  const sep = p.previousElementSibling && p.previousElementSibling.classList.contains('acc-sep') ? p.previousElementSibling : null;
  acc.scrollTo({ left: (sep || p).offsetLeft - acc.offsetLeft - 4, behavior: smooth ? 'smooth' : 'auto' });
}
function accOpen(i, reveal = true) {
  i = +i;
  if (i === state.dlOpenIdx) return;
  state.dlOpenIdx = i;
  document.querySelectorAll('#view-deadlines .acc-p').forEach(p => {
    const on = +p.dataset.acc === i;
    p.classList.toggle('open', on);
    p.setAttribute('aria-expanded', on);
  });
  /* once the panel has widened, bring all of it into view */
  if (reveal) setTimeout(() => {
    const acc = $('#view-deadlines .acc'), p = acc && acc.querySelector(`[data-acc="${i}"]`);
    if (!p) return;
    const a = p.offsetLeft - acc.offsetLeft, b = a + p.offsetWidth;
    if (a < acc.scrollLeft || b > acc.scrollLeft + acc.clientWidth) acc.scrollTo({ left: Math.max(0, b > acc.scrollLeft + acc.clientWidth ? b - acc.clientWidth + 8 : a - 8), behavior: 'smooth' });
  }, 380);
}
function accMove(dir) {
  const acc = $('#view-deadlines .acc');
  if (!acc) return;
  if (+dir === 0) { const M = dlModel(new Date()); if (M.next) { const was = state.dlOpenIdx === M.next.index; accOpen(M.next.index, false); setTimeout(() => accTo(M.next.index), was ? 0 : 380); } return; }
  acc.scrollBy({ left: +dir * acc.clientWidth * .8, behavior: 'smooth' });
}

/* ---------------------------------------------------------------- problem sheets page
   Reads the sheet list from /api/overview (each module's problem-sheets/index.md, with counts) and a sheet's
   questions from /api/sheet/<code>/<id> (problem-sheets/questions/<id>.md). Questions with parts are stored
   one entry per part (n: "4a", "4b", ...), with the shared text under "## 4" and each part under "## 4a";
   every entry has its own status, saved with POST /api/question.
   Layout: progress by module and in total, with the question to continue from beside it; then every sheet,
   one column per module. A sheet opens in place, question by question, part by part. */
const Q_STATES = [['not-started', 'To do'], ['attempted', 'Attempted'], ['stuck', 'Stuck'], ['done', 'Done']];
const Q_WORD = Object.fromEntries(Q_STATES);

function sheetLabel(s) {
  const id = String(s.id), n = (id.match(/(\d+)$/) || [])[1] || id;
  if (/APS/i.test(id)) return `APS ${n}`;
  if (/SEM/i.test(id)) return `Seminar ${n}`;
  if (/^SoM/i.test(id)) return `SoM ${n}`;
  if (/^Th/i.test(id)) return `Thermo ${n}`;
  return `Sheet ${n}`;
}
const modOf = code => (MOD_NAMES[code] || [code, code]);
const sheetHash = (code, id, q) => `#sheets/${encodeURIComponent(code)}/${encodeURIComponent(id)}${q ? '/' + encodeURIComponent(q) : ''}`;
function sheetRoute() {
  const p = location.hash.slice(1).split('/');
  return p[0] === 'sheets' && p.length >= 3 ? { code: decodeURIComponent(p[1]), id: decodeURIComponent(p[2]), q: p[3] ? decodeURIComponent(p[3]) : null } : null;
}

/* when the solutions for a sheet can be read */
function solState(s, now, r) {
  const rel = parseDue(s.solutions_release);
  if (rel && rel > now) return { t: `Solutions ${dayLabel(rel, now)}${hasTime(s.solutions_release) ? ' ' + pad(rel.getHours()) + ':' + pad(rel.getMinutes()) : ''}`, cls: 'wait' };
  if (s.platform === 'lambda-feedback' && !s.solutions) return { t: 'Answers on Lambda Feedback', cls: 'ok' };
  if (s.solutions) return r && !r.solutions_path ? { t: 'Solutions out, not synced yet', cls: 'wait' } : { t: 'Solutions out', cls: 'ok' };
  return { t: 'No solutions yet', cls: 'none' };
}

function sheetsModel(now) {
  const ov = state.ov, order = (ov.modules || []).map(m => m.code);
  const sheets = (ov.sheets || []).map(s => {
    const relTxt = String(s.released || '');
    const rel = parseDue(relTxt.replace(/^~/, ''));
    const kind = s.assessed === true ? 'assessed' : s.assessed === 'participation' ? 'seminar' : 'sheet';
    const q = s.questions && s.questions.total ? s.questions : null;
    return Object.assign({}, s, { code: s.module, course: s.course || sheetCourse(s.module, s.id), rel, approx: relTxt.startsWith('~'), kind, q, label: sheetLabel(s), out: !rel || rel <= now,
      key: s.module + '/' + s.id, sol: solState(s, now) });
  });
  const mods = [...new Set(sheets.map(s => s.code))].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(code => {
    const list = sheets.filter(s => s.code === code).sort((a, b) => (a.kind === 'sheet' ? 0 : 1) - (b.kind === 'sheet' ? 0 : 1) || (a.rel || 0) - (b.rel || 0));
    const c = { done: 0, attempted: 0, stuck: 0, total: 0 };
    for (const s of list) if (s.q) for (const k in c) c[k] += s.q[k] || 0;
    return { code, short: modOf(code)[0], long: modOf(code)[1], sheets: list, c };
  });
  /* where you left off: the newest sheet you have started but not finished, else the oldest one not started */
  const started = sheets.filter(s => s.q && s.q.done < s.q.total && (s.q.done || s.q.attempted || s.q.stuck)).sort((a, b) => (b.rel || 0) - (a.rel || 0));
  const fresh = sheets.filter(s => s.q && s.out && !s.q.done && !s.q.attempted && !s.q.stuck && s.kind === 'sheet').sort((a, b) => (a.rel || 0) - (b.rel || 0));
  const total = mods.reduce((a, m) => { for (const k in a) a[k] += m.c[k]; return a; }, { done: 0, attempted: 0, stuck: 0, total: 0 });
  return { sheets, mods, started, cur: started[0] || fresh[0] || null, total };
}
const findSheet = (M, code, id) => M.sheets.find(s => s.code === code && String(s.id) === String(id));

/* ---- question files: fetched when needed, kept for the visit */
async function ensureSheet(code, id, force) {
  const key = code + '/' + id;
  if (!force && (state.sheetCache.has(key) || state.sheetLoading.has(key))) return;
  state.sheetLoading.add(key);
  try {
    const r = await getJSON(`/api/sheet/${encodeURIComponent(code)}/${encodeURIComponent(id)}`);
    state.sheetCache.set(key, r);
    if (r && r.qdir) ensureEquations(code, id, r.qdir, force);
  } catch (e) {
    state.sheetCache.set(key, { error: e.message });
  } finally {
    state.sheetLoading.delete(key);
    if (state.view === 'sheets' || state.view === 'revision' || state.view === 'home') render();
  }
}
const sheetData = (code, id) => state.sheetCache.get(code + '/' + id);

/* ---- the equations each question needs: problem-sheets/questions/equations/<sheet>.md
   ("## 4" then lines "- [Ch 3] what it is :: LaTeX"; sources in the frontmatter link each label to the notes) */
async function ensureEquations(code, id, qdir, force) {
  const key = code + '/' + id;
  if (!force && (state.eqCache.has(key) || state.eqLoading.has(key))) return;
  state.eqLoading.add(key);
  try {
    const r = await fetch(fileUrl(`${qdir}/equations/${id}.md`), { cache: 'no-store' });
    state.eqCache.set(key, r.ok ? parseEquations(await r.text()) : {});
  } catch (e) { state.eqCache.set(key, {}); }
  state.eqLoading.delete(key);
  if (state.view === 'sheets') render();
}
function parseEquations(text) {
  const out = { sources: {}, q: {} };
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  const unq = v => { v = v.trim(); try { return v.startsWith('"') ? JSON.parse(v) : v; } catch (e) { return v; } };
  if (fm) {
    let inSrc = false;
    for (const l of fm[1].split('\n')) {
      if (/^sources:\s*$/.test(l)) { inSrc = true; continue; }
      if (!inSrc) continue;
      const m = l.match(/^\s+("(?:[^"\\]|\\.)*"|[^:]+):\s*(.+)$/);
      if (m) out.sources[unq(m[1])] = unq(m[2]); else if (!/^\s/.test(l)) inSrc = false;
    }
  }
  const body = fm ? text.slice(fm[0].length) : text;
  const parts = body.split(/^## (\d+)\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    out.q[parts[i]] = parts[i + 1].split('\n').map(l => l.match(/^- \[([^\]]+)\] (.+?) :: (.+)$/)).filter(Boolean)
      .map(m => ({ src: m[1], label: m[2], tex: m[3] }));
  }
  return out;
}
function equationsBlock(s, g) {
  const E = state.eqCache.get(s.key), list = E && E.q && E.q[g.n];
  if (!list || !list.length) return '';
  const key = `${s.key}/${g.n}`, open = state.eqOpen.has(key);
  const rows = list.map(e => {
    const path = E.sources[e.src];
    const src = path ? `<a class="eq-s" href="${esc(fileUrl(path.split('#')[0]) + (path.includes('#') ? '#' + path.split('#')[1] : ''))}" target="_blank" rel="noopener" title="Open the notes">${esc(e.src)} ↗</a>`
      : `<span class="eq-s gen" title="Standard maths or physics that the module notes don't state">${esc(e.src)}</span>`;
    return `<div class="eq"><div class="eq-l"><span>${esc(e.label)}</span>${src}</div><div class="eq-m">$$${esc(e.tex)}$$</div></div>`;
  }).join('');
  return `<div class="eqs${open ? ' open' : ''}"><button class="eq-t" data-eqs="${esc(key)}" aria-expanded="${open}">
      <span>Equations you need</span><small>${list.length}</small><i class="chev" aria-hidden="true"></i></button>
    ${open ? `<div class="eq-list">${rows}</div>` : ''}</div>`;
}

/* group a sheet's entries into questions: "## 4" is the shared text, "## 4a", "## 4b"... are its parts */
function questionGroups(r) {
  if (!r || !r.sections) return [];
  const stems = new Map(r.sections.filter(s => !s.q).map(s => [s.key, s.md]));
  const groups = [], by = new Map();
  for (const s of r.sections) {
    if (!s.q) continue;
    const m = String(s.q.n).match(/^(\d+)([a-h])$/);
    const key = m ? m[1] : String(s.q.n);
    let g = by.get(key);
    if (!g) {
      const lab = String(s.q.label || s.q.n);
      g = { n: key, label: m ? lab.replace(/[a-h]$/, '') : lab, topic: s.q.topic, page: s.q.page, lambda: s.q.lambda,
        stem: m ? (stems.get(key) || '') : '', parts: [], whole: null };
      by.set(key, g); groups.push(g);
    }
    const x = Object.assign({ md: s.md, group: g }, s.q);
    if (m) { x.letter = m[2]; g.parts.push(x); } else g.whole = x;
  }
  return groups;
}
/* the things you tick off: each part, or the whole question when it has no parts */
const entriesOf = groups => groups.flatMap(g => g.parts.length ? g.parts : g.whole ? [g.whole] : []);
const qName = g => (/^\d/.test(g.label) ? 'Question ' : '') + g.label;
const entryName = x => x.letter ? `${qName(x.group)}(${x.letter})` : qName(x.group);
/* the one to pick up: something attempted, else the first not done */
const pickEntry = xs => xs.find(x => x.status === 'attempted') || xs.find(x => x.status !== 'done') || xs[0];

/* ---- markdown with maths: protect $…$ from the markdown parser, then let KaTeX typeset it */
function mdHTML(md, baseDir) {
  const store = [];
  const src = String(md || '').replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, m => { store.push(m); return `@@MATH${store.length - 1}@@`; })
    .replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (m, a, h) => /^(https?:|data:|\/)/.test(h) ? m : a + fileUrl(resolvePath(baseDir || '', decodeURIComponent(h))));
  const html = cleanHTML(window.marked ? marked.parse(src, { gfm: true, breaks: false }) : `<p>${esc(src)}</p>`);
  /* a full stop or comma straight after short inline maths stays on the same line as it */
  return html.replace(/@@MATH(\d+)@@([.,;:!?)]{1,2})?/g, (_, i, tail) => {
    const m = store[+i];
    return tail && !m.startsWith('$$') && m.length <= 42 ? `<span class="nb">${esc(m)}${tail}</span>` : esc(m) + (tail || '');
  });
}
/* Markdown may carry raw HTML. Your own notes are trusted, but the AI's answers go through here too (and with Web on
   they can quote pages from the internet), so scripts, frames, forms and inline event handlers are always removed. */
function cleanHTML(html) {
  if (!/<\s*(script|iframe|object|embed|style|link|meta|form|base)\b|\son\w+\s*=|(java|vb)script:|data:text\/html/i.test(html)) return html;
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content.querySelectorAll('script,iframe,object,embed,style,link,meta,form,base').forEach(n => n.remove());
  t.content.querySelectorAll('*').forEach(n => {
    for (const a of [...n.attributes]) {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action|formaction|srcdoc)$/i.test(a.name) && /^\s*((java|vb)script:|data:text\/html)/i.test(a.value))) n.removeAttribute(a.name);
    }
  });
  return t.innerHTML;
}
function resolvePath(base, p) {
  const out = [];
  for (const x of (base ? base.split('/') : []).concat(p.split('/'))) { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); }
  return out.join('/');
}
function typeset(el) {
  if (!el || !window.renderMathInElement) return;
  try { renderMathInElement(el, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false }); } catch (e) { /* leave raw TeX */ }
  el.querySelectorAll('.md a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
}
const pdfAt = (p, page) => fileUrl(p) + (page ? '#page=' + page : '');
const lambdaUrl = (r, id) => id && r.lambda_set ? `${r.lambda_set}?question_id=${encodeURIComponent(id)}` : null;
/* the bold topic line some sheets repeat at the top of the text */
const dropTopic = (md, topic) => { const m0 = String(md || '').match(/^\s*\*\*([^*\n]+?)\.?\*\*\.?\s*(\n|$)/); return m0 && topic && m0[1].trim().replace(/\.$/, '') === String(topic).trim().replace(/\.$/, '') ? md.slice(m0[0].length) : md; };

function qBar(c) {
  if (!c || !c.total) return '<span class="bar ghost"></span>';
  const d = 100 * c.done / c.total, a = 100 * ((c.attempted || 0) + (c.stuck || 0)) / c.total;
  return `<span class="bar"><i class="att" style="left:${d}%;width:${a}%"></i><i style="width:${d}%"></i></span>`;
}
const pct = c => c.total ? Math.round(100 * c.done / c.total) : 0;

/* ---- the top row: how much is done, and where to carry on */
function progressCard(M) {
  const T = M.total;
  return `<article class="w span2 pr-card"><div class="k"><span>Problem sheets done</span><span>${T.stuck ? `${T.stuck} stuck · ` : ''}${T.attempted ? `${T.attempted} attempted` : ''}</span></div>
    <div class="pr-top"><div class="big">${pct(T)}<small>%</small></div><div class="pr-tot"><b>${T.done}</b> of ${T.total} questions and parts done</div></div>
    <div class="pr-mods">${M.mods.map(m => `<a class="pr-mod" href="#sheets" data-colto="${esc(m.code)}">
      <span class="pr-n"><b>${esc(m.short)}</b><small>${m.c.done}/${m.c.total}</small></span>${qBar(m.c)}<span class="pr-p">${pct(m.c)}%</span></a>`).join('')}</div></article>`;
}
function continueCard(M) {
  const s = M.cur;
  if (!s) return `<article class="w ct-card"><div class="k"><span>Continue</span></div><div class="empty">Every sheet that's out is done.</div></article>`;
  const r = sheetData(s.code, s.id);
  if (!r) ensureSheet(s.code, s.id);
  const xs = entriesOf(questionGroups(r)), x = xs.length ? pickEntry(xs) : null;
  const go = x ? sheetHash(s.code, s.id, x.n) : sheetHash(s.code, s.id);
  return `<a class="w ct-card" href="${go}"><div class="k"><span>Continue from</span><span>${esc(modOf(s.code)[0])} · ${esc(s.label)}</span></div>
    <div class="ct-q">${x ? esc(entryName(x)) : '…'}</div>
    <div class="ct-t">${x ? esc(x.group.topic || '') : ''}${x && x.status === 'attempted' ? ' <em>attempted</em>' : ''}</div>
    <div class="ct-f"><span>${qBar(s.q)}</span><span>${s.q.done}/${s.q.total} on this sheet</span><b class="ct-go">Continue &#8594;</b></div></a>`;
}

/* ---- every sheet, one column per module */
function sheetTile(s, now) {
  const go = s.q ? `href="${sheetHash(s.code, s.id)}"` : s.path ? `href="${esc(fileUrl(s.path))}" target="_blank" rel="noopener"` : '';
  const sub = s.q ? `${s.q.done}/${s.q.total}${s.q.stuck ? ` · ${s.q.stuck} stuck` : ''}`
    : s.kind === 'assessed' ? (s.status === 'submitted' ? 'Submitted' : 'Assessed')
    : s.kind === 'seminar' ? (s.status === 'done' ? 'Done' : 'Seminar')
    : s.out ? 'Out · not synced yet' : `Out ${dayLabel(s.rel, now)}`;
  return `<a class="tile${s.q && s.q.done === s.q.total ? ' all' : ''}${!s.q ? ' noq' : ''}" ${go}>
    <span class="tile-t"><b>${esc(s.label)}</b><small>${esc(s.covers || (s.rel ? 'Out ' + (s.approx ? '~' : '') + s.rel.getDate() + ' ' + MONTHS[s.rel.getMonth()] : ''))}</small></span>
    ${s.q ? qBar(s.q) : ''}
    <span class="tile-f"><span>${esc(sub)}</span>${s.q || s.kind === 'sheet' ? `<span class="sol ${s.sol.cls}">${esc(s.sol.t)}</span>` : ''}</span></a>`;
}
/* which course a sheet belongs to (an index.md entry can say so itself with course:) */
function sheetCourse(code, id) {
  id = String(id);
  if (code === 'PHYS50004') return /^QM/i.test(id) ? 'Quantum Mechanics' : /^AT/i.test(id) ? 'Atomic Physics' : 'Quantum Physics';
  if (code === 'PHYS50002') return /^SoM/i.test(id) ? 'Structure of Matter' : /^SP/i.test(id) ? 'Statistical Physics' : 'Thermodynamics';
  if (code === 'PHYS50003') return /^EM/i.test(id) ? 'Electromagnetism' : 'Differential Equations';
  if (code === 'PHYS50006') return +((id.match(/(\d+)$/) || [])[1] || 0) >= 4 ? 'Planets' : 'Sun & Stars';
  return modOf(code)[1];
}
function courseGroups(code, sheets) {
  const tps = (state.tp || []).filter(t => t.module === code);
  const names = [...new Set(tps.map(t => t.course).concat(sheets.map(s => s.course)))].sort((a, b) => courseRank(a) - courseRank(b));
  return names.map(n => {
    const list = sheets.filter(s => s.course === n), c = { done: 0, attempted: 0, stuck: 0, total: 0 };
    list.forEach(s => { if (s.q) for (const k in c) c[k] += s.q[k] || 0; });
    const mine = tps.filter(t => t.course === n), later = mine.length && mine.every(t => !t.lectured && t.upcoming);
    return { course: n, sheets: list, c, empty: later ? `Starts ${mine[0].upcoming}` : 'No sheets yet' };
  });
}
function moduleColumns(M, now) {
  return `<div class="mod-cols">${M.mods.map(m => `<section class="w mod-col" id="col-${esc(m.code)}">
    <div class="mc-h"><b>${esc(m.short)}</b><span>${esc(m.long)}</span></div>
    <div class="mc-p">${qBar(m.c)}<span>${m.c.done}/${m.c.total}</span></div>
    ${courseGroups(m.code, m.sheets).map(g => `<div class="mc-course">
      <div class="mc-ch"><b>${esc(g.course)}</b><span>${g.c.total ? `${g.c.done}/${g.c.total}` : ''}</span></div>
      ${g.sheets.length ? `<div class="mc-tiles">${g.sheets.map(s => sheetTile(s, now)).join('')}</div>` : `<div class="mc-none">${esc(g.empty)}</div>`}
    </div>`).join('')}</section>`).join('')}</div>`;
}

/* ---- a sheet, question by question, part by part */
function statusButtons(x) {
  const st = x.status || 'not-started';
  return `<div class="qstate" role="group" aria-label="Status of ${esc(entryName(x))}">${Q_STATES.map(([v, l]) => `<button data-qs="${v}" class="q-${v}${st === v ? ' on' : ''}" aria-pressed="${st === v}">${l}</button>`).join('')}</div>`;
}
function answerBlock(s, r, x) {
  if (!x.answer) return '';
  const key = `${s.key}/${x.n}`, shown = state.revealed.has(key);
  return `<button class="linkbtn" data-reveal="${esc(key)}" aria-expanded="${shown}">${shown ? 'Hide answer' : 'Show answer'}</button>
    ${shown ? `<div class="qc-ans"><span>Answer printed on the sheet</span><div class="md">${mdHTML(x.answer, r.qdir)}</div></div>` : ''}`;
}
function solLink(r, x, sol) {
  if (r.solutions_path && sol.cls === 'ok') return `<a href="${esc(x.sol_page ? pdfAt(r.solutions_path, x.sol_page) : fileUrl(r.solutions_path))}" target="_blank" rel="noopener">${x.sol_page ? `Solution, page ${x.sol_page}` : 'Solutions PDF'}</a>`;
  return sol.cls === 'wait' ? `<span class="muted">${esc(sol.t)}</span>` : '';
}
function questionCard(s, r, g, now) {
  const sol = solState(s, now, r);
  const links = [];
  if (r.source_path && g.page) links.push(`<a href="${esc(pdfAt(r.source_path, g.page))}" target="_blank" rel="noopener">Sheet, page ${g.page}</a>`);
  const lu = lambdaUrl(r, g.lambda);
  if (lu) links.push(`<a href="${esc(lu)}" target="_blank" rel="noopener">Lambda Feedback ↗</a>`);
  const done = g.parts.length ? g.parts.every(p => p.status === 'done') : g.whole && g.whole.status === 'done';
  const stuck = (g.parts.length ? g.parts : [g.whole]).some(p => p && p.status === 'stuck');
  if (!g.parts.length) {
    const x = g.whole, sl = solLink(r, x, sol);
    return `<section class="qc${done ? ' s-done' : ''}${stuck ? ' s-stuck' : ''}" id="q-${esc(x.n)}" data-qkey="${esc(s.code)}|${esc(s.id)}|${esc(x.n)}">
      <div class="qc-top"><div><span class="qc-n">${esc(qName(g))}</span>${g.topic ? `<h3>${esc(g.topic)}</h3>` : ''}</div>${statusButtons(x)}</div>
      <div class="qc-body md">${mdHTML(dropTopic(x.md, g.topic), r.qdir)}</div>
      ${equationsBlock(s, g)}
      <div class="qc-acts">${[sl, ...links].filter(Boolean).join('<span class="dot">·</span>')}${x.answer ? '<span class="dot">·</span>' : ''}${answerBlock(s, r, x)}</div>
    </section>`;
  }
  return `<section class="qc grouped${done ? ' s-done' : ''}" id="q-${esc(g.n)}">
    <div class="qc-top"><div><span class="qc-n">${esc(qName(g))}</span>${g.topic ? `<h3>${esc(g.topic)}</h3>` : ''}</div>
      <span class="qc-count">${g.parts.filter(p => p.status === 'done').length}/${g.parts.length} parts</span></div>
    ${g.stem.trim() ? `<div class="qc-body md">${mdHTML(dropTopic(g.stem, g.topic), r.qdir)}</div>` : ''}
    ${equationsBlock(s, g)}
    <div class="parts">${g.parts.map(x => {
      const sl = solLink(r, x, sol);
      return `<div class="qp s-${esc(x.status || 'not-started')}" id="q-${esc(x.n)}" data-qkey="${esc(s.code)}|${esc(s.id)}|${esc(x.n)}">
        <div class="qp-l">${esc(x.letter)}</div>
        <div class="qp-main"><div class="qp-body md">${mdHTML(x.md, r.qdir)}</div>
          <div class="qc-acts">${sl}${sl && x.answer ? '<span class="dot">·</span>' : ''}${answerBlock(s, r, x)}</div></div>
        ${statusButtons(x)}</div>`;
    }).join('')}</div>
    ${links.length ? `<div class="qc-acts foot">${links.join('<span class="dot">·</span>')}</div>` : ''}
  </section>`;
}
function sheetView(s, now) {
  const r = sheetData(s.code, s.id);
  if (!r) { ensureSheet(s.code, s.id); return `<div class="empty pad">Opening ${esc(s.label)}…</div>`; }
  if (r.error) return `<div class="empty pad">Couldn't open this sheet (${esc(r.error)}).</div>`;
  const sol = solState(s, now, r), groups = questionGroups(r), xs = entriesOf(groups);
  const c = { done: 0, attempted: 0, stuck: 0, total: xs.length };
  xs.forEach(x => { if (x.status in c) c[x.status]++; });
  const links = [];
  if (r.source_path) links.push(`<a class="btn" href="${esc(fileUrl(r.source_path))}" target="_blank" rel="noopener">Sheet PDF</a>`);
  if (r.solutions_path && sol.cls === 'ok') links.push(`<a class="btn" href="${esc(fileUrl(r.solutions_path))}" target="_blank" rel="noopener">Solutions PDF</a>`);
  if (r.lambda_set) links.push(`<a class="btn" href="${esc(r.lambda_set)}" target="_blank" rel="noopener">Lambda Feedback ↗</a>`);
  const strip = groups.map(g => `<span class="sg">${(g.parts.length ? g.parts : [g.whole]).filter(Boolean).map(x =>
    `<a href="${sheetHash(s.code, s.id, x.n)}" class="seg s-${esc(x.status || 'not-started')}" title="${esc(entryName(x) + ': ' + Q_WORD[x.status || 'not-started'])}">${esc(x.letter ? g.label + x.letter : g.label)}</a>`).join('')}</span>`).join('');
  const extra = (r.sections || []).filter(x => !x.q && !/^\d+$/.test(x.key) && !/^intro/i.test(x.key));
  return `<div class="sh-head">
      <a class="btn back" href="#sheets">&#8592; All sheets</a>
      <div class="k"><span>${esc(modOf(s.code)[1])}</span><span class="sol ${sol.cls}">${esc(sol.t)}</span></div>
      <h2>${esc(s.label)}${s.covers ? ` <small>${esc(s.covers)}</small>` : ''}</h2>
      ${r.note ? `<p class="sh-note">${esc(r.note)}</p>` : ''}
      <div class="sh-prog">${qBar(c)}<span>${c.done === c.total ? 'All done' : `${c.done} of ${c.total} done`}${c.stuck ? ` · ${c.stuck} stuck` : ''}</span></div>
      <nav class="qstrip" aria-label="Questions">${strip}</nav>
      <div class="dl-btns">${links.join('')}${window.icdStudy ? icdStudy.startBtn({ kind: 'sheet', ref: s.code + '/' + s.id, code: s.code, label: `${modOf(s.code)[0]} · ${s.label}`, href: sheetHash(s.code, s.id) }) : ''}</div>
    </div>
    <div class="qlist">${groups.map(g => questionCard(s, r, g, now)).join('')}</div>
    ${extra.map(x => `<details class="qextra" data-dk="${esc('qx/' + s.key + '/' + x.key)}"${detOpen('qx/' + s.key + '/' + x.key, false) ? ' open' : ''}><summary>${esc(x.key)}</summary><div class="md">${mdHTML(x.md, r.qdir)}</div></details>`).join('')}`;
}

function renderSheetsPage(now) {
  const M = sheetsModel(now), route = sheetRoute();
  const sel = route ? findSheet(M, route.code, route.id) : null;
  const el = $('#view-sheets');
  if (setHTML(el, sel ? `<article class="w wide sheet-open">${sheetView(sel, now)}</article>`
    : progressCard(M) + continueCard(M) + moduleColumns(M, now))) typeset(el);
  $('#subtitle').textContent = `Year 2 · ${M.total.done} of ${M.total.total} done`;
  /* opening a sheet or a question: once it has loaded, bring it into view (the page's scroll is not restored) */
  const p = state.pending;
  if (p) {
    const target = p.q ? document.getElementById('q-' + p.q) : p.col ? document.getElementById('col-' + p.col) : (el.querySelector('.empty.pad') ? null : el);
    if (target) {
      state.pending = null; state.noRestore = true;
      setTimeout(() => {
        const get = () => p.q ? document.getElementById('q-' + p.q) : p.col ? document.getElementById('col-' + p.col) : $('#view-sheets');
        glideTo(get);
        const t = get();
        if (t && (p.q || p.col)) { t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); }
      }, 0);
    }
  }
}

/* smooth-scroll the page to an element; if something cut the glide short (fonts or maths settling), finish the move */
function glideTo(get) {
  /* page position from layout offsets, which stay correct while the page is still scrolling */
  const absTop = el => { let y = 0; for (; el; el = el.offsetParent) y += el.offsetTop; return y; };
  const top = () => { const t = get(); return t ? Math.max(0, Math.min(absTop(t) - 24, document.documentElement.scrollHeight - innerHeight)) : null; };
  const y = top();
  if (y == null) return;
  scrollTo({ top: y, behavior: 'smooth' });
  setTimeout(() => { const y2 = top(); if (y2 != null && Math.abs(scrollY - y2) > 30) scrollTo({ top: y2, behavior: 'smooth' }); }, 700);
  setTimeout(() => { const y3 = top(); if (y3 != null && Math.abs(scrollY - y3) > 30) scrollTo({ top: y3 }); }, 1500);
}

/* moving inside the Problem sheets page (opening a sheet or a question) instead of arriving from another page */
function sheetsSubRoute() {
  const r = sheetRoute();
  state.pending = r && r.q ? { q: r.q } : { top: true };
  render();
  if (!r || !r.q) enter($('#view-sheets'));
}

/* saving the status of a question or a part */
async function setQuestion(btn) {
  const card = btn.closest('[data-qkey]'), [code, id, n] = card.dataset.qkey.split('|'), v = btn.dataset.qs;
  if (btn.classList.contains('on')) return;
  card.querySelectorAll('.qstate button').forEach(b => { b.disabled = true; });
  try {
    const res = await getJSON('/api/question', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module: code, sheet: id, n, status: v }) });
    const r = sheetData(code, id);
    const sec = r && r.sections.find(x => x.q && String(x.q.n) === n);
    if (sec) sec.q.status = res.status;
    const sh = (state.ov.sheets || []).find(x => x.module === code && String(x.id) === id);
    if (sh && sh.questions) Object.assign(sh.questions, res.counts);
    if (sh && res.sheet_status) sh.status = res.sheet_status;
    if (window.icdStudy) icdStudy.activity('q');
    render();
    const xs = entriesOf(questionGroups(r)), x = xs.find(e => String(e.n) === n);
    toast(`${x ? entryName(x) : 'Question ' + n}: ${Q_WORD[res.status].toLowerCase()}${res.counts.total === res.counts.done ? '. Sheet done!' : ''}`);
  } catch (e) {
    toast(`Couldn't save that (${e.message})`, null, true);
    card.querySelectorAll('.qstate button').forEach(b => { b.disabled = false; });
  }
}

/* ---------------------------------------------------------------- revision page
   Topics come from revision/topic-tracker.md (status, review dates, lecture dates, notes page) and their content
   from revision/topics.md. Status is saved as confidence: 1 = don't know, 3 = shaky, 5 = know it.
   The timetable is worked out here from plan-settings.md, starting from zero: a topic nobody has marked counts as
   "don't know", and nothing is planned before its lecture. It is redone whenever a topic is marked. */
const TSTAT = [[1, 'dk', "Don't know"], [3, 'sh', 'Shaky'], [5, 'ok', 'Know it']];
const tStatus = c => c == null ? ['none', 'Not looked at'] : c <= 2 ? ['dk', "Don't know"] : c < 4 ? ['sh', 'Shaky'] : ['ok', 'Know it'];
const INTERVAL = { 1: 3, 2: 5, 3: 9, 4: 16, 5: 30 };       // days before a topic is due again, by how well you know it
const EXAM_START = new Date(2027, 3, 26);                  // main exam period (provisional); no exam dates yet
const PIECE = 60;                                          // a two-hour slot covers two topics, an hour each
const COURSE_SHORT = { 'Structure of Matter': 'SoM', Thermodynamics: 'Thermo', 'Sun & Stars': 'Stars', Planets: 'Planets' };
const revHash = id => '#revision' + (id ? '/' + encodeURIComponent(id) : '');
function revRoute() { const p = location.hash.slice(1).split('/'); return p[0] === 'revision' && p[1] ? decodeURIComponent(p[1]) : null; }
const ymd = s => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dShort = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const hoursOf = mins => pc(mins / 60, 1) + ' h';
/* is this topic's lecture still to come? Goes by its date ("~w/c 9 Nov" or "from ~16 Nov" means some time that week,
   so it counts as lectured once that week is over); a topic with no date yet is always still to come */
function topicAhead(t, now) {
  const ld = ymd(t.lectured);
  if (!ld) return true;
  const loose = /~|w\/c|from/i.test(String(t.upcoming || ''));
  return (loose ? addDays(ld, 6) : ld) > dayStart(now || new Date());
}

/* revision/topics.md: "## id", then "### Main points", "### Key equations" (label :: LaTeX), "### Problem-sheet questions" */
function parseTopicContent(text) {
  const out = {}, body = String(text || '').replace(/^---\n[\s\S]*?\n---\n/, '');
  const parts = body.split(/^## (\S+)\s*$/m);
  for (let i = 1; i < parts.length; i += 2) {
    const c = { points: [], eqs: [], qs: [] };
    let sec = null;
    for (const l of parts[i + 1].split('\n')) {
      const h = l.match(/^### (.+)$/);
      if (h) { sec = /point/i.test(h[1]) ? 'points' : /equation/i.test(h[1]) ? 'eqs' : /question/i.test(h[1]) ? 'qs' : null; continue; }
      const m = l.match(/^- (.+)$/);
      if (!m || !sec) continue;
      if (sec === 'eqs') { const e = m[1].match(/^(.+?) :: (.+)$/); if (e) c.eqs.push({ label: e[1], tex: e[2] }); }
      else c[sec].push(m[1]);
    }
    out[parts[i]] = c;
  }
  return out;
}
function parseSlots(spec) {
  const WD = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }, out = [];
  for (const part of String(spec || '').split(';')) {
    const m = part.trim().match(/^(\w+)(?:-(\w+))?\s+(\d{1,2}):(\d{2})\s+(\d+)$/);
    if (!m) continue;
    let days = [];
    if (/^daily$/i.test(m[1])) days = [0, 1, 2, 3, 4, 5, 6];
    else {
      const a = WD[m[1].slice(0, 3).toLowerCase()], b = m[2] ? WD[m[2].slice(0, 3).toLowerCase()] : a;
      if (a == null || b == null) continue;
      for (let d = a; ; d = (d + 1) % 7) { days.push(d); if (d === b) break; }
    }
    for (const wd of days) out.push({ wd, h: +m[3], mi: +m[4], mins: +m[5] });
  }
  return out.sort((x, y) => x.h - y.h || x.mi - y.mi);
}
function parseSettings(text) {
  const S = { phases: [], skip: new Set(), before: 1, pmin: 1000, wmin: 30 };
  const t = String(text || '');
  for (const m of t.matchAll(/^\s*-\s*\{name:\s*"([^"]+)",\s*from:\s*([\d-]+),\s*to:\s*([\d-]+),\s*slots:\s*"([^"]*)"\s*\}/gm))
    S.phases.push({ name: m[1], from: ymd(m[2]), to: ymd(m[3]), slots: parseSlots(m[4]) });
  const sk = t.match(/^skip_dates:\s*\[([^\]]*)\]/m);
  if (sk) sk[1].split(',').forEach(x => { const d = ymd(x.trim()); if (d) S.skip.add(iso(d)); });
  const b = t.match(/^skip_days_before_big_deadlines:\s*(\d+)/m); if (b) S.before = +b[1];
  const bd = t.match(/^big_deadline:\s*\{([^}]*)\}/m);
  if (bd) { const p = bd[1].match(/points_at_least:\s*(\d+)/), w = bd[1].match(/weight_at_least:\s*(\d+)/); if (p) S.pmin = +p[1]; if (w) S.wmin = +w[1]; }
  return S;
}
const activityFor = (conf, first) => first ? 'First look: read the summary and the notes, then try the problem-sheet questions'
  : conf < 2.5 ? 'Go back over the notes, then redo the problem-sheet questions'
  : conf < 3.5 ? 'Problem-sheet questions from memory, then check the solutions'
  : conf < 4.5 ? 'One past-paper question on this topic, timed'
  : 'Quick recall: write out the key results from memory';

/* the timetable, from now to the end of the exam period */
function buildPlan(now) {
  const S = state.settings, topics = state.tp, C = state.tcontent;
  if (!S || !topics || !C || !state.ov) return null;
  const key = iso(now) + now.getHours() + '|' + topics.map(t => `${t.id}:${t.confidence}:${t.last_reviewed}`).join(',') + '|' + Object.keys(C).length;
  if (state.planKey === key) return state.plan;
  const today = dayStart(now);
  const pool = topics.filter(t => C[t.id] && ymd(t.lectured));
  const nMod = {};
  pool.forEach(t => { nMod[t.module] = (nMod[t.module] || 0) + 1; });
  /* each module gets time in proportion to its ECTS; a topic nobody has marked counts as "don't know" */
  const sumE = Object.keys(nMod).reduce((a, m) => a + (ECTS[m] || 10), 0), share = {}, used = {};
  Object.keys(nMod).forEach(m => { share[m] = (ECTS[m] || 10) / sumE; used[m] = 0; });
  let total = 0;
  const st = pool.map(t => ({ id: t.id, mod: t.module, avail: ymd(t.lectured),
    conf: t.confidence == null ? 1 : +t.confidence, marked: t.confidence != null, last: ymd(t.last_reviewed), seen: !!t.last_reviewed, n: 0 }));
  const big = new Map();
  for (const d of state.ov.deadlines || []) {
    const pts = +d.points || 0, w = +d.weight || 0, due = parseDue(d.due);
    if (!due || isDone(d) || !(pts >= S.pmin || w >= S.wmin)) continue;
    for (let k = 0; k <= S.before; k++) big.set(iso(addDays(dayStart(due), -k)), tidy(d.item));
  }
  const sessions = [], skipped = [];
  for (const ph of S.phases) {
    for (let d = ph.from < today ? today : ph.from; d <= ph.to; d = addDays(d, 1)) {
      const slots = ph.slots.filter(s => s.wd === d.getDay());
      if (!slots.length || S.skip.has(iso(d))) continue;
      if (big.has(iso(d))) { skipped.push({ d, why: big.get(iso(d)) }); continue; }
      const toExam = Math.round((EXAM_START - d) / DAY);
      for (const s of slots) for (let off = 0; off < s.mins; off += PIECE) {
        const mins = Math.min(PIECE, s.mins - off);
        const t0 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), s.h, s.mi + off);
        if (t0 <= now) continue;
        const prev = sessions[sessions.length - 1];
        /* three queues, in order: topics you have marked that are due again (don't know: 3 days, shaky: 9, know it: 30),
           then a first look at everything lectured, then going back over the rest */
        const pick = [[null, -1], [null, -1], [null, -1]];
        for (const x of st) {
          if (x.avail > d) continue;
          const gap = x.last ? (d - x.last) / DAY : 60;
          const iv = INTERVAL[Math.max(1, Math.min(5, Math.round(x.conf)))];
          const bal = Math.min(4, Math.max(.25, (total + 1) * share[x.mod] / (used[x.mod] + share[x.mod])));   // behind its share of time → sooner
          const fresh = !x.seen && !x.n, q = x.marked && gap >= iv ? 0 : fresh ? 1 : 2;
          let sc = q === 1 ? bal : bal * (6 - x.conf) / 5 * (q === 0 ? gap / iv : Math.min(1.5, Math.max(.05, gap / iv)));
          if (q !== 1 && toExam > 0 && toExam <= 10) sc *= 3;
          if (prev && prev.id === x.id) sc *= .1;
          else if (prev && prev.mod === x.mod) sc *= .6;   // mix the modules up
          if (sc > pick[q][1]) pick[q] = [x, sc];
        }
        const best = (pick.find(p => p[0]) || [null])[0];
        if (!best) continue;
        const first = !best.seen && best.n === 0;
        sessions.push({ d, t0, t1: new Date(+t0 + mins * 6e4), mins, id: best.id, mod: best.mod, phase: ph.name, first, act: activityFor(best.conf, first) });
        best.n++; best.last = d; used[best.mod]++; total++; best.conf = Math.min(5, best.conf + .5);
      }
    }
  }
  /* when everything lectured so far will have had a first look */
  const waiting = new Set(pool.filter(t => !t.last_reviewed && ymd(t.lectured) <= today).map(t => t.id));
  let coverBy = null;
  for (const s of sessions) { if (waiting.delete(s.id) && !waiting.size) { coverBy = s.d; break; } }
  const nextOf = new Map();
  for (const s of sessions) if (!nextOf.has(s.id)) nextOf.set(s.id, s);
  state.planKey = key;
  state.plan = { sessions, skipped, coverBy, nextOf, unseen: pool.filter(t => !t.last_reviewed && ymd(t.lectured) <= today).length,
    mins: sessions.reduce((a, s) => a + s.mins, 0), end: S.phases.length ? S.phases[S.phases.length - 1].to : null };
  return state.plan;
}

/* when a topic that is still to come will be lectured: its date, or the rough wording from the file ("w/c 9 Nov") */
const lectureWhen = t => { const u = String(t.upcoming || ''), ld = ymd(t.lectured); return /~|w\/c|from/i.test(u) ? u.replace(/~/g, '') : ld ? dShort(ld) : u; };
function revModel(now) {
  const C = state.tcontent || {}, today = dayStart(now);
  const ts = (state.tp || []).map(t => {
    const ld = ymd(t.lectured), has = !!C[t.id];
    return Object.assign({}, t, { ld, has, open: has || !!t.notes || !!t.summary, past: has || (!!ld && !topicAhead(t, now)), st: tStatus(t.confidence) });
  });
  const order = (state.ov && state.ov.modules || []).map(m => m.code);
  const codes = [...new Set(ts.map(t => t.module))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const count = list => { const c = { ok: 0, sh: 0, dk: 0, none: 0, total: list.length }; list.forEach(t => c[t.st[0]]++); return c; };
  const mods = codes.map(code => {
    const list = ts.filter(t => t.module === code), lec = list.filter(t => t.has);
    /* where the lectures are up to, per course in the module */
    const courses = [...new Set(list.map(t => t.course))];
    const upTo = courses.map(c => {
      const done = list.filter(t => t.course === c && t.past && t.ld).sort((a, b) => a.ld - b.ld).pop();
      return done ? { course: c, short: COURSE_SHORT[c] || c, t: done } : null;
    }).filter(Boolean);
    if (upTo.length === 1) upTo[0].short = '';
    const next = list.filter(t => !t.past && t.ld && t.ld > today).sort((a, b) => a.ld - b.ld)[0];
    return { code, short: modOf(code)[0], long: modOf(code)[1], list, c: count(lec), upTo, next };
  });
  const all = ts.filter(t => t.has);
  return { ts, mods, tot: count(all), byId: new Map(ts.map(t => [t.id, t])) };
}

function knowBar(c) {
  if (!c || !c.total) return '<span class="bar ghost"></span>';
  const k = 100 * c.ok / c.total, s = 100 * c.sh / c.total, d = 100 * c.dk / c.total;
  return `<span class="bar kb"><i style="width:${k}%"></i><i class="att" style="left:${k}%;width:${s}%"></i><i class="dk" style="left:${k + s}%;width:${d}%"></i></span>`;
}
const knowTxt = c => `${c.ok}/${c.total} known`;

/* ---- one column of topics per module */
/* the courses inside a module, in teaching order (Quantum Physics before Quantum Mechanics, and so on) */
const COURSE_ORDER = ['Quantum Physics', 'Quantum Mechanics', 'Atomic Physics', 'Structure of Matter', 'Thermodynamics', 'Statistical Physics',
  'Differential Equations', 'Electromagnetism', 'Sun & Stars', 'Planets'];
const courseRank = c => { const i = COURSE_ORDER.indexOf(c); return i < 0 ? 99 : i; };
const countKnow = list => { const c = { ok: 0, sh: 0, dk: 0, none: 0, total: list.length }; list.forEach(t => c[t.st[0]]++); return c; };
function revColumn(m, now) {
  const today = dayStart(now);
  const names = [...new Set(m.list.map(t => t.course))].sort((a, b) => courseRank(a) - courseRank(b));
  const groups = names.map(n => {
    const list = m.list.filter(t => t.course === n);
    const done = list.filter(t => t.past && t.ld).sort((a, b) => a.ld - b.ld).pop();
    const next = list.find(t => !t.past && t.ld && t.ld > today);
    const later = list.every(t => !t.past && !t.ld);
    let lastBlock = null;
    const rows = list.map(t => {
      const b = t.block === lastBlock ? '' : t.block;
      lastBlock = t.block;
      const when = lectureWhen(t);
      const sub = !t.past ? `${when}${t.open ? ' · notes out' : ''}` : t.has ? '' : t.open ? 'Notes out · no summary yet' : (t.note || 'Notes not out yet');
      const inner = `<span class="tp-b">${esc(b)}</span><span class="tp-t">${esc(t.topic)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
      const cls = `tp${t.past ? '' : ' up'}${t.open ? '' : ' bare'}`;
      return t.open ? `<a class="${cls} s-${t.st[0]}" href="${revHash(t.id)}" title="${esc(t.past ? t.st[1] : 'Not lectured yet · ' + when)}">${inner}<i class="tp-s" aria-label="${esc(t.st[1])}"></i></a>`
        : `<div class="${cls}">${inner}</div>`;
    }).join('');
    const lec = list.filter(t => t.has), c = countKnow(lec);
    const state_ = done ? `Up to ${done.block} · ${dShort(done.ld)}` : next ? `Starts ${dShort(next.ld)}` : later ? (list[0].upcoming || 'Later') : '';
    return `<details class="rv-course" data-dk="${esc('rv/' + m.code + '/' + n)}"${detOpen('rv/' + m.code + '/' + n, !later) ? ' open' : ''}>
      <summary class="rv-ch"><b>${esc(n)}</b><span>${esc(state_)}${lec.length ? ` · ${c.ok}/${c.total} known` : ''}</span></summary>
      <div class="tp-list">${rows}</div></details>`;
  }).join('');
  return `<section class="w mod-col rv-col" id="col-${esc(m.code)}">
    <div class="mc-h"><b>${esc(m.short)}</b><span>${esc(m.long)}</span></div>
    <div class="mc-p">${knowBar(m.c)}<span>${knowTxt(m.c)}</span></div>
    ${groups}
  </section>`;
}

/* ---- the timetable */
function timetableCard(P, M, now) {
  if (!P) return `<article class="w wide tt"><div class="k"><span>Revision timetable</span></div><div class="empty pad">Working it out…</div></article>`;
  const name = id => (M.byId.get(id) || {}).topic || id;
  const nx = P.sessions[0];
  const weeks = [];
  const items = P.sessions.map(s => ({ d: s.d, s })).concat(P.skipped.map(k => ({ d: k.d, k }))).sort((a, b) => a.d - b.d || (a.s ? a.s.t0 : 0) - (b.s ? b.s.t0 : 0));
  for (const it of items) {
    const ws = iso(weekStart(it.d));
    let w = weeks[weeks.length - 1];
    if (!w || w.key !== ws) { w = { key: ws, start: weekStart(it.d), items: [], mins: 0, phase: it.s ? it.s.phase : '' }; weeks.push(w); }
    w.items.push(it);
    if (it.s) { w.mins += it.s.mins; w.phase = w.phase || it.s.phase; }
  }
  const thisWk = iso(weekStart(now)), nextWk = iso(addDays(weekStart(now), 7));
  const show = state.ttAll ? weeks : weeks.slice(0, 3);
  const wkName = w => w.key === thisWk ? 'This week' : w.key === nextWk ? 'Next week' : `w/c ${w.start.getDate()} ${MONTHS[w.start.getMonth()]}`;
  const weekHTML = w => {
    let lastDay = '';
    const rows = w.items.map(it => {
      const dk = iso(it.d), dl = dk === lastDay ? '' : `${DAYS[it.d.getDay()]} <b>${it.d.getDate()}</b>`;
      lastDay = dk;
      if (it.k) return `<div class="tt-s skip"><span class="tt-d">${dl}</span><span class="tt-tm"></span><span class="tt-n">No revision: close to <em>${esc(it.k.why)}</em></span></div>`;
      const s = it.s, t = M.byId.get(s.id) || {}, stt = tStatus(t.confidence);
      return `<a class="tt-s${s === nx ? ' nx' : ''}" href="${revHash(s.id)}"><span class="tt-d">${dl}</span><span class="tt-tm">${hhmm(s.t0)}</span>
        <span class="tt-n"><span class="tt-m">${esc(modOf(t.module)[0])}</span>${esc(name(s.id))}</span>
        <span class="tt-tag s-${stt[0]}">${s.first ? 'First look' : 'Review'}</span></a>`;
    }).join('');
    return `<div class="tt-wk"><div class="tt-wh"><b>${esc(wkName(w))}</b><span>${hoursOf(w.mins)}${w.phase ? ' · ' + esc(w.phase) : ''}</span></div><div class="tt-rows">${rows}</div></div>`;
  };
  const nt = nx && M.byId.get(nx.id);
  const nextCard = nx ? `<a class="tt-next" href="${revHash(nx.id)}">
      <span class="k"><span>Next session</span><span>${esc(dayLabel(nx.d, now))} · ${hhmm(nx.t0)}–${hhmm(nx.t1)}</span></span>
      <b>${esc(nt.topic)}</b><small>${esc(modOf(nt.module)[1])} · ${esc(nt.block)}</small>
      <span class="tt-act">${esc(nx.act)}</span><span class="ct-go">Open topic &#8594;</span></a>` : '<div class="empty">Nothing left to plan.</div>';
  const facts = [
    `<div><b>${P.unseen}</b><span>lectured topics you haven't looked at yet</span></div>`,
    `<div><b>${P.coverBy ? esc(dShort(P.coverBy)) : P.unseen ? '—' : 'Done'}</b><span>${P.unseen ? 'when they will all have had a first look' : 'every lectured topic has had a look'}</span></div>`,
    `<div><b>${Math.round(P.mins / 60)} h</b><span>planned to ${P.end ? esc(dShort(P.end)) : 'the exams'}</span></div>`];
  return `<article class="w wide tt" id="rv-tt">
    <div class="k"><span>Revision timetable</span><span>From zero · redone each time you mark a topic</span></div>
    <div class="tt-top">${nextCard}<div class="tt-facts">${facts.join('')}</div></div>
    <div class="tt-weeks">${show.map(weekHTML).join('')}</div>
    ${weeks.length > 3 ? `<button class="btn tt-more" data-ttall>${state.ttAll ? 'Show the next three weeks only' : `Show all ${weeks.length} weeks`}</button>` : ''}
    <p class="tt-note">Hours come from <code>revision/plan-settings.md</code>. A topic only goes in once it has been lectured, the most you don't know comes first, and topics come back round on spaced intervals: about 3 days if you don't know it, 9 if shaky, 30 if you know it.</p>
  </article>`;
}

/* ---- a topic: summary, equations and questions beside the notes */
function topicQuestions(C, now, code) {
  if (!C.qs.length) return '<div class="muted small">No problem-sheet questions on this yet.</div>';
  const SM = sheetsModel(now);
  return C.qs.map(ref => {
    const [sid, n] = ref.split('/'), s = SM.sheets.find(x => String(x.id) === sid && x.code === code) || SM.sheets.find(x => String(x.id) === sid);
    if (!s) return '';
    const r = s.q ? sheetData(s.code, s.id) : null;
    if (s.q && !r) ensureSheet(s.code, s.id);
    const g = r && !r.error ? questionGroups(r).find(x => String(x.n) === n) : null;
    const xs = g ? (g.parts.length ? g.parts : [g.whole]).filter(Boolean) : [];
    const done = xs.filter(x => x.status === 'done').length;
    const txt = !s.q ? 'Not synced yet' : !g ? '…' : xs.length > 1 ? `${done}/${xs.length} parts done` : Q_WORD[xs[0].status || 'not-started'];
    const cls = !xs.length ? 'none' : done === xs.length ? 'done' : xs.some(x => x.status === 'stuck') ? 'stuck' : xs.some(x => x.status === 'attempted' || x.status === 'done') ? 'att' : 'todo';
    const href = s.q ? sheetHash(s.code, s.id, n) : s.path ? fileUrl(s.path) : '#sheets';
    return `<a class="tq q-${cls}" href="${esc(href)}"${s.q ? '' : ' target="_blank" rel="noopener"'}><span class="tq-n">${esc(s.label)} · Q${esc(n)}</span>
      <span class="tq-t">${esc(g && g.topic || '')}</span><span class="tq-s">${esc(txt)}</span></a>`;
  }).join('');
}
function topicHead(t, M, P, now) {
  const mod = M.mods.find(m => m.code === t.module), list = mod ? mod.list.filter(x => x.open) : [], i = list.findIndex(x => x.id === t.id);
  const prev = list[i - 1], next = list[i + 1], nx = P && P.nextOf.get(t.id);
  const btns = TSTAT.map(([v, c, l]) => `<button data-ts="${v}" class="t-${c}${t.st[0] === c ? ' on' : ''}" aria-pressed="${t.st[0] === c}">${l}</button>`).join('');
  const rev = ymd(t.last_reviewed);
  return `<div class="rv-nav"><a class="btn back" href="#revision">&#8592; All topics</a>
      <span class="rv-navr">${window.icdStudy ? icdStudy.startBtn({ kind: 'topic', ref: t.id, code: t.module, label: `${modOf(t.module)[0]} · ${t.topic}`, href: revHash(t.id) }) : ''}${prev ? `<a class="btn icon" href="${revHash(prev.id)}" title="${esc(prev.topic)}" aria-label="Previous topic">&#8592;</a>` : ''}${next ? `<a class="btn icon" href="${revHash(next.id)}" title="${esc(next.topic)}" aria-label="Next topic">&#8594;</a>` : ''}</span></div>
    <div class="k"><span>${esc(modOf(t.module)[1])}${t.course !== modOf(t.module)[1] ? ' · ' + esc(t.course) : ''} · ${esc(t.block)}</span><span>${t.past ? 'Lectured ' + (t.ld ? esc(dShort(t.ld)) : '') : 'Lecture ' + esc(lectureWhen(t) || 'to come')}</span></div>
    <h2>${esc(t.topic)}</h2>
    <div class="rv-know"><span class="rv-q">How well do you know it?</span>
      <div class="qstate tstate" role="group" aria-label="How well you know this topic">${btns}</div>
      <small>${rev ? `Looked over ${esc(dayLabel(rev, now))}` : 'Not looked at yet'}${nx ? ` · next in your timetable ${esc(dayLabel(nx.d, now))} ${hhmm(nx.t0)}` : ''}</small></div>`;
}
function topicInfo(t, C, now, code) {
  if (!C.points.length && !C.eqs.length && !C.qs.length) return `<section class="rv-sec"><h3>${t.past ? 'Not summarised yet' : 'Not lectured yet'}</h3>
    <p class="rv-none">${t.past ? 'There are no main points for this topic yet.' : 'The notes are already out, so you can read ahead.'} The notes are on the right${t.page > 1 ? `, from page ${t.page}` : ''}. You can still mark how well you know it, and the study buddy can explain anything in them.</p></section>`;
  const eqs = C.eqs.map(e => `<div class="eq"><div class="eq-l"><span>${esc(e.label)}</span></div><div class="eq-m">$$${esc(e.tex)}$$</div></div>`).join('');
  return `<section class="rv-sec"><h3>Main points</h3><div class="md">${mdHTML(C.points.map(p => '- ' + p).join('\n'))}</div></section>
    ${eqs ? `<section class="rv-sec"><h3>Key equations</h3><div class="eqs open rv-eqs"><div class="eq-list">${eqs}</div></div></section>` : ''}
    <section class="rv-sec"><h3>Problem-sheet questions</h3><div class="tq-list">${topicQuestions(C, now, code)}</div></section>`;
}
function topicPane(t, tab) {
  const tabs = [t.notes ? `<button data-rvtab="notes" class="${tab === 'notes' ? 'on' : ''}">Notes${t.page > 1 ? `, page ${t.page}` : ''}</button>` : '',
    t.summary ? `<button data-rvtab="summary" class="${tab === 'summary' ? 'on' : ''}">Lecture summary</button>` : ''].join('');
  const open = tab === 'notes' ? pdfAt(t.notes, t.page) : fileUrl(t.summary);
  let body;
  if (tab === 'notes') body = `<iframe class="rv-pdf" src="${esc(fileUrl(t.notes) + '#page=' + (t.page || 1) + '&navpanes=0&view=FitH')}" title="Notes for ${esc(t.topic)}"></iframe>`;
  else {
    const h = state.sumCache.get(t.summary);
    if (h === undefined) loadSummary(t.summary);
    body = h ? `<div class="rv-sum md">${h}</div>` : '<div class="empty pad">Opening the lecture summary…</div>';
  }
  const clip = tab === 'notes' ? `<button type="button" class="linkbtn" data-hlclip title="Copy a passage in the notes (⌘C), then press this">Explain copied text</button>` : '';
  return `<div class="rv-tabs"><div class="pill-switch">${tabs}</div><span class="rv-tlinks">${clip}<a class="linkbtn" href="${esc(open)}" target="_blank" rel="noopener">Open in a new tab ↗</a></span></div>${body}`;
}
async function loadSummary(path) {
  if (!path || state.sumCache.has(path)) return;
  state.sumCache.set(path, null);
  try {
    const r = await fetch(fileUrl(path), { cache: 'no-store' });
    const md = (await r.text()).replace(/^---\n[\s\S]*?\n---\n/, '');
    state.sumCache.set(path, mdHTML(md, path.split('/').slice(0, -1).join('/')));
  } catch (e) { state.sumCache.set(path, `<p>Couldn't open the summary (${esc(e.message)}).</p>`); }
  if (state.view === 'revision') render();
}

/* ---- the Revision page's own tabs: Topics (the list and the timetable), Sky (sky.js), Flashcards (cards.js),
   Past papers (papers.js). Each tab file registers a drawing function in window.icdRevTabs. */
const RV_TABS = [['', 'Topics'], ['sky', 'Sky'], ['cards', 'Flashcards'], ['papers', 'Past papers'], ['log', 'Log']];
function rvTab() { const p = location.hash.slice(1).split('/'); return p[0] === 'revision' && RV_TABS.some(([k]) => k && k === p[1]) ? p[1] : ''; }
const rvTabBar = cur => `<nav class="rv-tabbar" aria-label="Revision views"><div class="pill-switch">${RV_TABS.map(([k, l]) =>
  `<a href="#revision${k ? '/' + k : ''}" class="${cur === k ? 'on' : ''}"${cur === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</div></nav>`;

/* small JSON files the pages keep in revision/ (POST /api/store). If the server is too old to have that address
   yet, the data is kept in this browser and saved to the file once the server has been restarted. */
const storeCache = new Map();
async function storeLoad(name) {
  if (storeCache.has(name)) return storeCache.get(name);
  let file = {};
  try { const r = await fetch(fileUrl(`revision/${name}.json`), { cache: 'no-store' }); if (r.ok) file = await r.json(); } catch (e) { /* none yet */ }
  let local = null;
  try { local = JSON.parse(localStorage.getItem('icd-store-' + name) || 'null'); } catch (e) { /* storage off */ }
  const data = local && (local._saved || 0) > (file._saved || 0) ? local : file;
  storeCache.set(name, data);
  if (data === local) storeSave(name, data, true);         // a copy made while the server couldn't save: try again now
  return data;
}
let storeWarned = false;
async function storeSave(name, data, quiet) {
  data._saved = Date.now();
  storeCache.set(name, data);
  try { localStorage.setItem('icd-store-' + name, JSON.stringify(data)); } catch (e) { /* storage off */ }
  try {
    await getJSON('/api/store', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, data }) });
    try { localStorage.removeItem('icd-store-' + name); } catch (e) { /* storage off */ }
    return true;
  } catch (e) {
    if (!quiet && !storeWarned) { storeWarned = true; toast('Saved in this browser for now. Click Imperial Dashboard in your Dock once, and it will be saved to your files.', null, true); }
    return false;
  }
}

function renderRevisionPage(now) {
  const el = $('#view-revision');
  if (!state.tp || !state.tcontent) { setHTML(el, `<article class="w wide"><div class="empty pad">${state.tpErr ? `Couldn't load the topics (${esc(state.tpErr)}).` : 'Loading your topics…'}</div></article>`); return; }
  const M = revModel(now), P = buildPlan(now), id = revRoute(), t = id ? M.byId.get(id) : null;
  $('#subtitle').textContent = `Year 2 · ${M.tot.ok} of ${M.tot.total} topics known`;
  const tab = rvTab();
  if (tab) {
    let box = el.querySelector('.rv-tabview');
    if (!box || box.dataset.tab !== tab) {
      el._html = null;
      el.innerHTML = rvTabBar(tab) + `<div class="rv-tabview" data-tab="${tab}"></div>`;
      box = el.querySelector('.rv-tabview');
    }
    const draw = (window.icdRevTabs || {})[tab];
    if (draw) draw(box, now, M); else setHTML(box, '<article class="w wide"><div class="empty pad">Loading…</div></article>');
    if (state.pending) { state.pending = null; state.noRestore = true; setTimeout(() => glideTo(() => $('#view-revision')), 0); }
    return;
  }
  if (t && t.open) {
    const C = state.tcontent[id] || { points: [], eqs: [], qs: [] }, tab = state.rvTab[id] || (t.notes ? 'notes' : 'summary');
    let box = el.querySelector('.rv-topic');
    if (!box || box.dataset.id !== id) {
      el._html = null;
      el.innerHTML = `<article class="w wide rv-topic" data-id="${esc(id)}"><div class="rv-head"></div><div class="rv-body${saved('icd-buddy', 'on') === 'off' ? ' buddy-off' : ''}"><div class="rv-info"><div class="rv-info-c"></div><div class="rv-demo" hidden></div></div><div class="rv-pane"></div><div class="rv-buddy"></div></div></article>`;
      box = el.querySelector('.rv-topic');
    }
    const head = $('.rv-head', box), info = $('.rv-info-c', box), pane = $('.rv-pane', box);
    setHTML(head, topicHead(t, M, P, now));
    if (setHTML(info, topicInfo(t, C, now, t.module))) typeset(info);
    /* the notes stay put while you mark the topic (rebuilding the frame would reload the PDF) */
    const pk = `${id}|${tab}|${tab === 'summary' ? !!state.sumCache.get(t.summary) : ''}`;
    if (pane.dataset.key !== pk) { pane.dataset.key = pk; pane.innerHTML = topicPane(t, tab); typeset(pane); }
    if (window.icdBuddy) icdBuddy.mount($('.rv-buddy', box), t);
    if (window.icdDemo) icdDemo.mount($('.rv-demo', box), t);         // "Try it" physics (demos.js), built once per topic      // the study buddy (buddy.js) keeps its chat while you mark the topic
  } else {
    setHTML(el, rvTabBar('') + `<div class="mod-cols rv-cols">${M.mods.map(m => revColumn(m, now)).join('')}</div>` + timetableCard(P, M, now));
  }
  if (state.pending) {
    const p = state.pending;
    state.pending = null; state.noRestore = true;
    setTimeout(() => glideTo(() => p.tt ? document.getElementById('rv-tt') : $('#view-revision')), 0);
  }
}
function revisionSubRoute() {
  state.pending = { top: true };
  render();
  enter($('#view-revision'));
}

/* marking a topic: saves the status and today's date, and the timetable is redone straight away */
async function setTopic(btn) {
  const id = revRoute(), v = +btn.dataset.ts, t = (state.tp || []).find(x => x.id === id);
  if (!t) return;
  const before = { confidence: t.confidence, last_reviewed: t.last_reviewed };
  t.confidence = v; t.last_reviewed = iso(new Date());
  render();
  try {
    await getJSON('/api/topic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, confidence: v, reviewed: true }) });
    if (window.icdStudy) icdStudy.activity('t');
    const P = buildPlan(new Date()), nx = P && P.nextOf.get(id);
    toast(`${t.topic}: ${tStatus(v)[1].toLowerCase()}. ${nx ? `Back in your timetable ${dayLabel(nx.d, new Date())}.` : 'Timetable updated.'}`, async () => {
      /* a mis-click: put the topic back exactly as it was (status and the date you last looked at it) */
      await getJSON('/api/topic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, confidence: before.confidence ?? null, last_reviewed: before.last_reviewed || null }) });
      Object.assign(t, before);
      await loadTopics();
    });
  } catch (e) {
    Object.assign(t, before);
    render();
    toast(`Couldn't save that (${e.message})`, null, true);
  }
}

/* ---------------------------------------------------------------- pages */
const VIEWS = {
  home: { title: 'IMPERIAL', sub: 'Year 2 Physics Dashboard' },
  sheets: { title: 'PROBLEM SHEETS', sub: 'Year 2' },
  deadlines: { title: 'DEADLINES', sub: 'Year 2' },
  marks: { title: 'MARKS', sub: 'Year 2 · six modules' },
  revision: { title: 'REVISION', sub: 'Year 2' }
};
const viewFromHash = () => { const h = location.hash.slice(1).split('/')[0]; return VIEWS[h] ? h : 'home'; };
function showView(scrollTop) {
  const v = viewFromHash(), prev = state.view, prevHash = state.lastHash;
  state.lastHash = location.hash;
  if (scrollTop && prev === v && v === 'sheets') return sheetsSubRoute();
  if (scrollTop && prev === v && v === 'revision') return revisionSubRoute();
  state.view = v;
  document.body.classList.toggle('subpage', v !== 'home');
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== 'view-' + v; });
  document.querySelectorAll('.nav-main a[data-view]').forEach(a => {
    const on = a.dataset.view === v;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#title').textContent = VIEWS[v].title;
  $('#subtitle').textContent = VIEWS[v].sub;
  document.title = v === 'home' ? 'Imperial · Year 2 Physics Dashboard' : `${VIEWS[v].title[0]}${VIEWS[v].title.slice(1).toLowerCase()} · Imperial`;
  fitTitle();
  if (v === 'deadlines') state.dlAccReset = true;
  renderView();
  if (scrollTop) scrollTo(0, 0);
  moveNavPill(!navPillReady);
  enter($('.hero'));
  enter($('#view-' + v));
}

/* ---------------------------------------------------------------- motion
   Small, quick movements so the site responds to you: the nav's white pill slides to the page you pick,
   a page's title and cards rise in when you arrive, the week ahead slides the way you moved. */
let navPillReady = false;
function moveNavPill(instant) {
  const nav = $('.nav-main'), on = $('.nav-main a.on');
  let pill = $('.nav-pill', nav);
  if (!pill) { pill = document.createElement('span'); pill.className = 'nav-pill'; pill.setAttribute('aria-hidden', 'true'); nav.prepend(pill); }
  if (!on) { pill.style.opacity = 0; return; }
  if (instant) pill.style.transition = 'none';
  pill.style.width = on.offsetWidth + 'px';
  pill.style.height = on.offsetHeight + 'px';
  pill.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
  pill.style.opacity = 1;
  if (instant) { void pill.offsetWidth; pill.style.transition = ''; }
  nav.classList.add('has-pill');
  navPillReady = true;
  /* phones: the nav scrolls sideways, so keep the current page's link in view */
  if (nav.scrollWidth > nav.clientWidth) nav.scrollTo({ left: on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2, behavior: instant ? 'auto' : 'smooth' });
}
/* play the arrival animation once; it is taken off afterwards so later re-draws don't replay it */
function enter(el) {
  if (!el) return;
  clearTimeout(el._enterT);
  el.classList.remove('enter');
  void el.offsetWidth;
  el.classList.add('enter');
  el._enterT = setTimeout(() => el.classList.remove('enter'), state.ov ? 900 : 2500);
}
function slide(el, cls) {
  if (!el) return;
  el.classList.remove('slide-l', 'slide-r', 'slide-0');
  void el.offsetWidth;
  el.classList.add(cls);
}

/* ---------------------------------------------------------------- toast */
let toastTimer;
function toast(msg, undo, err) {
  const t = $('.toast');
  t.classList.toggle('err', !!err);
  t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button class="btn">Undo</button>' : '');
  if (undo) $('.btn', t).onclick = async () => { t.classList.remove('show'); try { await undo(); } catch (e) { toast(`Couldn't undo (${e.message})`, null, true); } };
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), err ? 7000 : 5000);
}

/* ---------------------------------------------------------------- wiring */
function render() {
  const y = scrollY;
  renderView();
  if (state.noRestore) { state.noRestore = false; return; }      // the page asked to move (opening a question)
  if (Math.abs(scrollY - y) > 1) scrollTo(0, y);
  requestAnimationFrame(() => { if (Math.abs(scrollY - y) > 1) scrollTo(0, y); });
}
function renderView() {
  const now = new Date();
  renderHeader(now);
  if (!state.ov) return;
  if (state.view === 'marks') return renderMarksPage(now);
  if (state.view === 'deadlines') return renderDeadlinesPage(now);
  if (state.view === 'sheets') return renderSheetsPage(now);
  if (state.view === 'revision') return renderRevisionPage(now);
  renderHomeSheets(now);
  renderHomeRevision(now);
  renderHomeDeadlines(now);
  renderHomeMarks(now);
  if (window.renderHeadsUp) renderHeadsUp(now);
  renderWeek(state.ov, now);
}

/* nav: until each section has its own page, the links jump to the matching widget */
function goTo(link) {
  const id = link.dataset.to;
  const jump = () => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1100);
  };
  if (state.view !== 'home') { location.hash = 'home'; setTimeout(jump, 60); } else jump();
}

document.addEventListener('click', e => {
  const link = e.target.closest('.nav-main a');
  if (link) {
    e.preventDefault();
    if (link.dataset.to) return goTo(link);
    if (link.dataset.view === state.view && !location.hash.slice(1).includes('/')) return scrollTo({ top: 0, behavior: 'smooth' });
    location.hash = link.dataset.view;      // also from inside a sheet or a topic: back to that section's front page
    return;
  }
  const tick = e.target.closest('button.tick');
  if (tick) return tickDeadline(tick.closest('[data-index]'));
  const tb = e.target.closest('[data-tickdl]');
  if (tb) return tickDeadline(document.querySelector(`#view-deadlines [data-index="${tb.dataset.tickdl}"]`) || tb);
  const col = e.target.closest('[data-colto]');
  if (col) { e.preventDefault(); const t = document.getElementById('col-' + col.dataset.colto); if (t) { glideTo(() => document.getElementById('col-' + col.dataset.colto)); t.classList.add('flash'); setTimeout(() => t.classList.remove('flash'), 1200); } return; }
  const ts = e.target.closest('button[data-ts]');
  if (ts) return setTopic(ts);
  const rt = e.target.closest('[data-rvtab]');
  if (rt) { state.rvTab[revRoute()] = rt.dataset.rvtab; return render(); }
  const tta = e.target.closest('[data-ttall]');
  if (tta) { state.ttAll = !state.ttAll; return render(); }
  const qs = e.target.closest('button[data-qs]');
  if (qs) return setQuestion(qs);
  const eqb = e.target.closest('[data-eqs]');
  if (eqb) { const k = eqb.dataset.eqs; state.eqOpen.has(k) ? state.eqOpen.delete(k) : state.eqOpen.add(k); return render(); }
  const rv = e.target.closest('[data-reveal]');
  if (rv) { const k = rv.dataset.reveal; state.revealed.has(k) ? state.revealed.delete(k) : state.revealed.add(k); return render(); }
  if (e.target.closest('a[href]')) return;
  const mv = e.target.closest('[data-accmove]');
  if (mv) return accMove(mv.dataset.accmove);
  const ap = e.target.closest('[data-acc]');
  if (ap && !ap.classList.contains('open')) return accOpen(ap.dataset.acc);
  const shift = e.target.closest('[data-shift]');
  if (shift) {
    const n = +shift.dataset.shift;
    if (n === 0 && state.weekShift === 0) return;
    const back = n === 0 ? state.weekShift > 0 : n < 0;
    state.weekShift = n === 0 ? 0 : state.weekShift + n;
    render();
    return slide($('#w-week .days'), back ? 'slide-r' : 'slide-l');
  }
  const ch = e.target.closest('[data-chart]');
  if (ch) { state.chartMode = ch.dataset.chart; save('icd-marks-chart', state.chartMode); return render(); }
  const rg = e.target.closest('[data-range]');
  if (rg) { state.chartRange = rg.dataset.range; save('icd-marks-range', state.chartRange); return render(); }
});

/* keyboard: Enter or Space on the clickable rows and dots */
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-acc]:not(.open)')) { e.preventDefault(); e.target.click(); }
});

renderHeader(new Date());
setInterval(tickCount, 1000);            // live countdowns on the Deadlines page
addEventListener('hashchange', () => showView(true));
showView(false);
document.fonts.ready.then(() => { fitTitle(); moveNavPill(true); });
addEventListener('resize', () => { fitTitle(); moveNavPill(true); });
load();
setInterval(render, 60 * 1000);          // keep "today", overdue flags and past classes current
setInterval(load, 5 * 60 * 1000);        // pick up changes made in the files or the old app
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
