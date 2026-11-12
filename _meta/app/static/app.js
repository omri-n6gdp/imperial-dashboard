/* Imperial Dashboard front end. Plain JS, no build step. Data comes from server.py's /api. */
'use strict';

const NAME = 'Omri';
const $ = (s, el = document) => el.querySelector(s);
const main = document.getElementById('main');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KNOWN = ['PHYS50001', 'PHYS50002', 'PHYS50003', 'PHYS50004', 'PHYS50006', 'PHYS50007', 'EART60031'];
const MODCOL = c => { const code = String(c || '').split('+')[0]; return KNOWN.includes(code) ? `var(--m-${code})` : 'var(--m-other)'; };
const ABBR = { PHYS50001: 'LAB', PHYS50002: 'TP', PHYS50003: 'DE', PHYS50004: 'QP', PHYS50006: 'SSP', PHYS50007: 'MM', EART60031: 'SM' };
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STATUS_TEXT = { 'not-started': 'Not started', 'in-progress': 'In progress', done: 'Done', submitted: 'Submitted', locked: 'Locked' };
const CONF_WORDS = ['Lost', 'Shaky', 'Getting there', 'Solid', 'Exam-ready'];
const ARROW = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 17L17 7M9 7h8v8"/></svg>';

let OV = null;      // overview cache
let TIMERS = [];    // intervals owned by the current page

/* ---------------------------------------------------------------- data */
async function api(path) {
  const r = await fetch(path, { cache: 'no-store' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function overview(force) {
  if (!OV || force) OV = await api('/api/overview');
  return OV;
}
function toast(msg, err) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast on' + (err ? ' err' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = 'toast' + (err ? ' err' : ''); }, err ? 5000 : 2200);
}
function every(ms, fn) { TIMERS.push(setInterval(fn, ms)); }

/* ---------------------------------------------------------------- dates */
function parseDue(v) {
  if (!v) return null;
  const m = String(v).replace(/^~/, '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 23, m[5] ? +m[5] : 59);
  d.allDay = !m[4];
  return d;
}
const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fmtDay = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fmtTime = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const hm = s => { const [h, m] = String(s).split(':').map(Number); return h + (m || 0) / 60; };
const hText = h => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
function relDays(d, now) {
  const n = Math.round((dayStart(d) - dayStart(now)) / 864e5);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
function whenWord(d, now) {
  const n = Math.round((dayStart(d) - dayStart(now)) / 864e5);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 1 && n < 7) return 'on ' + DAYS_LONG[d.getDay()];
  return 'on ' + fmtDay(d);
}
function mondayOf(d) { const x = dayStart(d); const k = (x.getDay() + 6) % 7; return addDays(x, -k); }

function termInfo(ov, d) {
  const terms = (ov.key_dates || {}).terms || {};
  for (const [name, t] of Object.entries(terms)) {
    const a = parseDue(t.teaching_starts), b = parseDue(t.end);
    if (a && b && d >= dayStart(a) && d <= b) return { name, week: Math.floor((dayStart(d) - dayStart(a)) / (7 * 864e5)) + 1 };
  }
  return null;
}
function termLine(ov, d) {
  const t = termInfo(ov, d);
  if (t) return `week ${t.week} of ${t.name} term`;
  const c = closed(ov, d);
  return c ? c.split('(')[0].trim() : 'outside term time';
}
function closed(ov, d) {
  for (const c of (ov.key_dates || {}).closures || []) {
    const a = parseDue(c.from), b = parseDue(c.to);
    if (a && b && d >= dayStart(a) && d <= b) return c.what;
  }
  return null;
}
/* Classes that actually run on day d: autumn timetable, lab only in lab weeks, listed-week slots only in those weeks. */
function classesOn(ov, d) {
  const t = termInfo(ov, d);
  if (!t || t.name !== 'autumn' || closed(ov, d)) return [];
  const dn = DAYS[d.getDay()];
  return ((ov.timetable || {}).recurring_term1 || [])
    .filter(c => c.day === dn && labRuns(ov, c, d) && listedWeek(c, t.week))
    .sort((a, b) => a.start.localeCompare(b.start));
}
function listedWeek(c, wk) {
  const m = `${c.what || ''} ${c.weeks || ''}`.match(/weeks?\s+((?:\d+\s*,\s*)+\d+)/i);
  return !m || m[1].split(',').map(Number).includes(wk);
}
function labRuns(ov, c, d) {
  const cycles = (ov.lab_cycles || []).filter(x => x.module === c.module);
  if (!cycles.length) return true;
  const only = String(c.what || '').match(/cycle (\d+) only/i);
  return cycles.some(x => {
    if (only && String(x.cycle) !== only[1]) return false;
    const a = dayStart(parseDue(x.start));
    const b = /cycle weeks 1-4/i.test(c.weeks || '') ? addDays(a, 28) : addDays(dayStart(parseDue(x.end)), 1);
    return d >= a && d < b;
  });
}
const cleanWhat = s => String(s || '').replace(/\s*\([^)]*\)/g, '').replace(/,.*$/, '').trim();
function sessionsOn(ov, d) { const k = iso(d); return ((ov.plan || {}).sessions || []).filter(s => s.date === k); }
function deadlinesOn(ov, d) { return ov.deadlines.filter(x => { const t = parseDue(x.due); return t && iso(t) === iso(d); }); }
function dayEvents(ov, d) {
  const ev = [];
  for (const c of classesOn(ov, d)) {
    const note = /some weeks|alternates/i.test(`${c.what} ${c.weeks || ''}`) ? (c.what.match(/\(([^)]*(?:some weeks|alternates)[^)]*)\)/i) || [])[1] : '';
    ev.push({ a: hm(c.start), b: hm(c.end), start: c.start, end: c.end, what: cleanWhat(c.what), sub: c.room || note || (ov.short || {})[c.module] || '', module: c.module, kind: 'class', maybe: !!note });
  }
  for (const s of sessionsOn(ov, d)) ev.push({ a: hm(s.start), b: hm(s.end), start: s.start, end: s.end, what: s.topic, sub: 'Revision', module: s.module, kind: 'rev', s });
  return ev.sort((x, y) => x.a - y.a);
}
function worth(x) {
  if (x.weight != null) return `${x.weight}%`;
  if (x.points != null) return `${x.points} pts`;
  return '';
}
const modName = (code, ov) => String(code || '').split('+').map(c => (ov.short || {})[c] || c).join(' + ');
function modTag(code, ov) { return `<span class="tag"><span class="mk" style="--c:${MODCOL(code)}"></span>${esc(modName(code, ov))}</span>`; }
const isDone = x => ['done', 'submitted', 'graded'].includes(String(x.status));
const openDeadlines = ov => ov.deadlines.filter(x => !isDone(x) && parseDue(x.due) && x.module !== 'all').sort((a, b) => parseDue(a.due) - parseDue(b.due));
function staleSince(ov, now) { const m = (ov.last_sync || '').match(/\d{4}-\d{2}-\d{2}/); return m && (now - parseDue(m[0])) > 4 * 864e5 ? parseDue(m[0]) : null; }
function sheetTodo(ov, now) {
  const order = s => (parseDue(s.released) || new Date(0)).getTime();
  return ov.sheets.filter(s => ['not-started', 'in-progress'].includes(s.status) && s.assessed !== true && (!parseDue(s.released) || parseDue(s.released) <= now))
    .sort((a, b) => (a.status === 'in-progress' ? -1 : 0) - (b.status === 'in-progress' ? -1 : 0) || order(a) - order(b));
}

/* ---------------------------------------------------------------- markdown */
function renderMd(md, baseDir) {
  const store = [];
  const src = String(md || '').replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, m => { store.push(m); return `@@MATH${store.length - 1}@@`; })
    .replace(/(!\[[^\]]*\]\()([^)\s]+)/g, (m, a, h) => /^(https?:|data:|\/)/.test(h) ? m : a + fileUrl(resolvePath(baseDir || '', decodeURIComponent(h))));
  let html = marked.parse(src, { gfm: true, breaks: false });
  html = html.replace(/@@MATH(\d+)@@/g, (_, i) => esc(store[+i]));
  const wrap = document.createElement('div');
  wrap.className = 'md';
  wrap.innerHTML = html;
  wrap.querySelectorAll('a[href]').forEach(a => {
    const h = a.getAttribute('href');
    if (/^(https?:|mailto:|#)/.test(h)) { if (/^https?:/.test(h)) { a.target = '_blank'; a.rel = 'noopener'; } return; }
    const p = resolvePath(baseDir || '', decodeURIComponent(h.split('#')[0]));
    if (p.endsWith('.md')) a.href = '#/doc?path=' + encodeURIComponent(p);
    else { a.href = fileUrl(p); a.target = '_blank'; }
  });
  wrap.querySelectorAll('code').forEach(c => {
    const t = c.textContent.trim();
    if (c.closest('pre, a') || !/^[\w.\-/ ]+\.(pdf|md|xlsx|docx|txt)$/i.test(t) || /\s{2}/.test(t)) return;
    const p = /^(year|modules|calendar|revision|_meta)\//.test(t) ? t : resolvePath(baseDir || '', t);
    const a = document.createElement('a'); a.className = 'pathlink';
    if (p.endsWith('.md')) a.href = '#/doc?path=' + encodeURIComponent(p); else { a.href = '/open?' + new URLSearchParams({ p: t, base: baseDir || '' }); a.target = '_blank'; }
    c.replaceWith(a); a.appendChild(c);
  });
  try {
    renderMathInElement(wrap, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false });
  } catch (e) { /* leave raw TeX */ }
  return wrap;
}
function resolvePath(base, p) {
  if (p.startsWith('/')) return p.slice(1);
  const parts = (base ? base.split('/') : []).concat(p.split('/'));
  const out = [];
  for (const x of parts) { if (x === '..') out.pop(); else if (x && x !== '.') out.push(x); }
  return out.join('/');
}
const fileUrl = p => '/file/' + p.split('/').map(encodeURIComponent).join('/');
const stripTables = md => String(md || '').split('\n').filter(l => !l.trim().startsWith('|')).join('\n');

/* ================================================================
   One page. Every part of the dashboard is a section you scroll to;
   anything long (a sheet's questions, a summary, a note, search)
   opens in a panel over the page, so you never lose your place.
   ================================================================ */

const pdfAt = (path, page) => fileUrl(path) + (page ? '#page=' + page : '');
const Q_STATES = [['not-started', 'To do'], ['attempted', 'Attempted'], ['stuck', 'Stuck'], ['done', 'Done']];
const Q_WORD = Object.fromEntries(Q_STATES);
const lambdaUrl = (r, q) => q && q.lambda && r.lambda_set ? `${r.lambda_set}?question_id=${encodeURIComponent(q.lambda)}` : null;
const sheetLink = (s, mod) => `#/sheet/${encodeURIComponent(mod || s.module)}/${encodeURIComponent(s.id)}`;
const qProgress = c => c ? `${c.done} of ${c.total} done${c.stuck ? `, ${c.stuck} stuck` : ''}` : '';
const dropH1 = md => String(md || '').replace(/^\s*# [^\n]*\n+/, '');
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const STATE = { weekOff: 0, dlMod: '', dlDone: false, dlAll: false, staleRatings: 0 };
let DATA = null;          // { ov, grades, topics, plan }

function qBar(c) {
  if (!c || !c.total) return '<span class="qbar empty" aria-hidden="true"><span></span></span>';
  const seg = (k, n) => n ? `<span class="s-${k}" style="flex:${n}"></span>` : '';
  return `<span class="qbar" aria-hidden="true">${seg('done', c.done)}${seg('attempted', c.attempted)}${seg('stuck', c.stuck)}${seg('not-started', c['not-started'])}</span>`;
}
function moduleQs(ov, code) {
  const c = { done: 0, attempted: 0, stuck: 0, 'not-started': 0, total: 0 };
  for (const s of ov.sheets) if ((!code || s.module === code) && s.questions) for (const k in c) c[k] += s.questions[k] || 0;
  return c;
}
/* the question to pick up next: the first sheet in progress with questions, else the oldest released one */
function nextQuestion(ov, now) {
  const s = sheetTodo(ov, now).find(x => x.questions && x.questions.next_n);
  return s ? { s, n: s.questions.next_n, label: s.questions.next_label } : null;
}
function countText(ms) {
  if (ms <= 0) return 'due now';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 2) return `${d} days`;
  if (h >= 1) return `${h} h ${m % 60} min`;
  return `${m} min`;
}

/* ---------------------------------------------------------------- loading and refreshing */
async function load(force) {
  const ov = await overview(force);
  const [grades, topics, plan] = await Promise.all([api('/api/grades'), api('/api/topics'), api('/api/plan')]);
  DATA = { ov, grades, topics: topics.topics, plan };
  return DATA;
}
async function refresh() {
  try { await load(true); renderAll(); } catch (e) { toast(e.message, true); }
}
function renderAll() {
  TIMERS.forEach(clearInterval); TIMERS = [];
  const now = new Date();
  for (const [id, fn] of SECTIONS) {
    const el = document.getElementById(id);
    if (!el) continue;
    try { el.innerHTML = fn(DATA, now); } catch (e) { el.innerHTML = `<div class="wrap"><p class="muted">This part didn't load: ${esc(e.message)}</p></div>`; console.error(e); }
  }
  bindAll();
  const sync = (DATA.ov.last_sync || '').match(/\d{4}-\d{2}-\d{2}/);
  const f = $('#syncLine'); if (f) f.textContent = sync ? `Canvas data from ${fmtDay(parseDue(sync[0]))}. Everything you tick is saved straight into your files.` : '';
  try { renderMathInElement(main, { delimiters: [{ left: '$', right: '$', display: false }], throwOnError: false }); } catch (e) { /* raw TeX */ }
  spy();
}

/* ---------------------------------------------------------------- 1. Today (the first screen) */
function secToday({ ov }, now) {
  const nowH = now.getHours() + now.getMinutes() / 60;
  const t = termInfo(ov, now);
  const events = dayEvents(ov, now);
  const later = events.filter(e => e.b > nowH);
  const nq = nextQuestion(ov, now);
  const open = openDeadlines(ov);
  const upcoming = open.filter(x => parseDue(x.due) >= now);
  const overdue = open.filter(x => parseDue(x.due) < now && now - parseDue(x.due) < 21 * 864e5);
  const nd = upcoming[0];

  // one plain sentence about the day
  const parts = [];
  if (later.length) {
    const cur = later.find(e => e.a <= nowH);
    const nxt = later.find(e => e.a > nowH);
    if (cur) parts.push(`${cur.what} until ${cur.end}`);
    if (nxt) parts.push(`${cur ? 'then ' : ''}${nxt.what} at ${nxt.start}`);
    const rest = later.filter(e => e !== cur && e !== nxt).length;
    if (rest) parts.push(`${rest} more after that`);
  } else parts.push(events.length ? 'No more classes today' : 'No classes today');
  const lead = `${cap(parts.join(', '))}.${nd ? ` ${esc(nd.item)} is due ${whenWord(parseDue(nd.due), now)}${parseDue(nd.due).allDay ? '' : ' at ' + fmtTime(parseDue(nd.due))}.` : ''}`;

  // the day, as a timeline card
  const gaps = freeGaps(events, nowH);
  const rows = [];
  for (const e of events) rows.push({ a: e.a, html: `<li class="tl ${e.b <= nowH ? 'past' : ''} ${e.a <= nowH && nowH < e.b ? 'now' : ''}" style="--c:${e.kind === 'rev' ? 'var(--rev)' : MODCOL(e.module)}"><span class="tm">${e.start}</span><span class="what"><b>${esc(e.what)}</b><span>${esc([e.end ? 'until ' + e.end : '', e.kind === 'class' ? e.sub : 'revision'].filter(Boolean).join(', '))}${e.maybe && !/week|altern/i.test(e.sub || '') ? ', some weeks' : ''}</span></span></li>` });
  for (const g of gaps) rows.push({ a: g.a - 0.001, html: `<li class="tl free"><span class="tm">${g.start}</span><span class="what"><b>Free until ${g.end}</b><span>${nq ? `Good time for <a href="${sheetLink(nq.s)}?q=${encodeURIComponent(nq.n)}">${esc(nq.s.id)} question ${esc(nq.label)}</a>` : 'Nothing waiting'}</span></span></li>` });
  rows.sort((x, y) => x.a - y.a);
  const nowIdx = rows.findIndex(r => r.a > nowH);
  if (rows.length && nowH >= 7 && nowH <= 21) rows.splice(nowIdx < 0 ? rows.length : nowIdx, 0, { html: `<li class="nowmark" aria-label="Now"><span class="tm">${fmtTime(now)}</span><span class="line"></span></li>` });

  // four numbers
  const kd = ov.key_dates || {};
  const yStart = parseDue(((kd.terms || {}).autumn || {}).teaching_starts) || parseDue(kd.teaching_week_1);
  const exam = (kd.exam_periods || []).find(e => /main/i.test(e.what || ''));
  const examFrom = exam ? parseDue(exam.from) : null;
  const examDays = examFrom ? Math.ceil((dayStart(examFrom) - dayStart(now)) / 864e5) : null;
  const qc = moduleQs(ov);
  let pts = 0, ptsOf = 0;
  for (const g of DATA.grades) for (const i of g.items) if (i.score != null && i.points) { pts += +i.score; ptsOf += +i.points; }
  const facts = [
    [`${qc.done}<small>/${qc.total}</small>`, 'sheet questions done', '#sheets'],
    [examDays != null && examDays >= 0 ? `${examDays}` : '–', examFrom ? `days until exams start, ${examFrom.getDate()} ${MONTHS[examFrom.getMonth()]}` : 'days until exams', '#year'],
    [ptsOf ? `${Math.round(pts / ptsOf * 100)}%` : '–', ptsOf ? `of marked lab points (${pts}/${ptsOf})` : 'nothing marked yet', '#marks'],
    [`${open.filter(x => parseDue(x.due) >= now && parseDue(x.due) < addDays(now, 14)).length}`, 'deadlines in the next 14 days', '#deadlines'],
  ];

  return `<div class="wrap hero-grid">
    <div class="hero-text">
      <p class="hero-meta">${t ? esc(cap(`week ${t.week} of ${t.name} term`)) : esc(termLine(ov, now))}</p>
      <h1>${DAYS_LONG[now.getDay()]} ${now.getDate()} ${MONTHS_LONG[now.getMonth()]}</h1>
      <p class="hero-lead">${lead}</p>
      <div class="btn-row">
        ${nq ? `<a class="btn btn--primary" href="${sheetLink(nq.s)}?q=${encodeURIComponent(nq.n)}">Continue ${esc(nq.s.id)}, question ${esc(nq.label)}</a>` : ''}
        <a class="btn btn--secondary" href="#week">See this week</a>
      </div>
      ${overdue.length ? `<p class="hero-warn">${overdue.length} past due and not ticked off: ${overdue.slice(0, 2).map(x => esc(x.item)).join('; ')}. <a href="#deadlines">Tick off in Deadlines</a></p>` : ''}
    </div>
    <div class="hero-card" aria-labelledby="dayH">
      <div class="hc-head"><h2 id="dayH" class="hc-title">Today</h2><span class="muted small">${events.length} item${events.length === 1 ? '' : 's'}</span></div>
      ${rows.length ? `<ol class="timeline">${rows.map(r => r.html).join('')}</ol>` : `<p class="empty">No classes or revision today.${nq ? ` A good day for <a href="${sheetLink(nq.s)}?q=${encodeURIComponent(nq.n)}">${esc(nq.s.id)}</a>.` : ''}</p>`}
      ${nd ? `<div class="hc-due"><span class="muted small">Next deadline</span><b>${esc(nd.item)}</b><span class="countdown num" id="cd" data-due="${parseDue(nd.due).getTime()}">in ${countText(parseDue(nd.due) - now)}</span></div>` : ''}
    </div>
    <dl class="facts">${facts.map(([v, l, h]) => `<a href="${h}"><dt class="num">${v}</dt><dd>${esc(l)}</dd></a>`).join('')}</dl>
  </div>`;
}
function freeGaps(events, nowH) {
  const classes = events.filter(e => e.kind === 'class' && !e.maybe);
  const gaps = [];
  for (let i = 1; i < classes.length; i++) {
    const a = Math.max(...classes.slice(0, i).map(e => e.b)), b = classes[i].a;
    if (b - a >= 1.5 && b > nowH) gaps.push({ a, b, start: hText(a), end: hText(b) });
  }
  return gaps;
}

/* ---------------------------------------------------------------- 2. This week */
function secWeek({ ov }, now) {
  const mon = addDays(mondayOf(now), STATE.weekOff * 7);
  const H0 = 8, H1 = 20, PX = 36;
  const days = [...Array(7)].map((_, i) => addDays(mon, i));
  const t2 = termInfo(ov, addDays(mon, 2));
  let headRow = '<div class="dh"></div>', body = '<div class="hours">';
  for (let h = H0; h < H1; h++) body += `<div class="hcell">${h}:00</div>`;
  body += '</div>';
  for (const d of days) {
    const today = iso(d) === iso(now);
    const dls = deadlinesOn(ov, d).filter(x => !isDone(x) && x.module !== 'all');
    headRow += `<div class="dh ${today ? 'today' : ''}"><b>${DAYS[d.getDay()]} ${d.getDate()}</b>
      <div class="allday">${dls.map(x => { const t = parseDue(x.due); return `<a class="due-chip" href="#deadlines" title="${esc(x.item)}">${t.allDay ? '' : fmtTime(t) + ' '}${esc(x.item)}</a>`; }).join('')}</div></div>`;
    let col = `<div class="day ${today ? 'today' : ''}">`;
    for (let h = H0; h < H1; h++) col += '<div class="hl"></div>';
    for (const e of dayEvents(ov, d)) {
      const top = (e.a - H0) * PX, hgt = Math.max(18, (e.b - e.a) * PX - 3);
      const tag = e.kind === 'rev' ? 'a' : 'div';
      col += `<${tag} class="ev ${e.kind === 'rev' ? 'rev' : ''} ${hgt < 34 ? 'short' : ''}" ${e.kind === 'rev' ? 'href="#revision"' : ''} style="--c:${e.kind === 'rev' ? 'var(--rev)' : MODCOL(e.module)};top:${top}px;height:${hgt}px" title="${esc(e.what)}, ${e.start}–${e.end}${e.sub ? ', ' + esc(e.sub) : ''}"><b>${esc(e.what)}</b><small>${e.start}–${e.end}${e.sub && e.kind === 'class' ? ', ' + esc(e.sub) : ''}</small></${tag}>`;
    }
    for (const x of dls.filter(x => !parseDue(x.due).allDay)) {
      const tt = parseDue(x.due), h = tt.getHours() + tt.getMinutes() / 60;
      if (h >= H0 && h < H1) col += `<div class="dueline" style="top:${(h - H0) * PX}px" title="Due ${fmtTime(tt)}: ${esc(x.item)}"></div>`;
    }
    const nh = now.getHours() + now.getMinutes() / 60;
    if (today && nh >= H0 && nh < H1) col += `<div class="nowline" style="top:${(nh - H0) * PX}px"></div>`;
    body += col + '</div>';
  }
  const agenda = days.map(d => {
    const evs = dayEvents(ov, d), dls = deadlinesOn(ov, d).filter(x => !isDone(x) && x.module !== 'all');
    const today = iso(d) === iso(now);
    return `<div class="agday ${today ? 'today' : ''}"><h3>${DAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}</h3>
      ${dls.map(x => { const tt = parseDue(x.due); return `<a class="agrow due" href="#deadlines"><span class="tm">${tt.allDay ? 'Due' : fmtTime(tt)}</span><span><b>${esc(x.item)}</b><span class="muted small">Deadline, ${esc(modName(x.module, ov))}</span></span></a>`; }).join('')}
      ${evs.map(e => `<div class="agrow" style="--c:${e.kind === 'rev' ? 'var(--rev)' : MODCOL(e.module)}"><span class="tm">${e.start}</span><span><b>${esc(e.what)}</b><span class="muted small">until ${e.end}${e.sub ? ', ' + esc(e.sub) : ''}</span></span></div>`).join('')}
      ${!evs.length && !dls.length ? '<p class="muted small">Nothing on.</p>' : ''}</div>`;
  }).join('');
  const label = STATE.weekOff === 0 ? 'This week' : STATE.weekOff === 1 ? 'Next week' : STATE.weekOff === -1 ? 'Last week' : `Week of ${mon.getDate()} ${MONTHS[mon.getMonth()]}`;
  return `<div class="wrap">
    <div class="sec-head"><div><h2>${label}</h2><p class="sec-sub">${mon.getDate()} ${MONTHS[mon.getMonth()]} to ${addDays(mon, 6).getDate()} ${MONTHS[addDays(mon, 6).getMonth()]}${t2 ? `, ${t2.name} term week ${t2.week}` : ', outside teaching weeks'}.</p></div>
      <div class="seg" role="group" aria-label="Choose week"><button type="button" data-wk="-1">Previous</button><button type="button" data-wk="0" ${STATE.weekOff === 0 ? 'aria-pressed="true"' : ''}>This week</button><button type="button" data-wk="1">Next</button></div></div>
    <div class="card wk-grid"><div class="week" style="--px:${PX}px">${headRow}${body}</div>
      <p class="legend small muted"><span><i class="lg-due"></i>Deadline</span><span><i class="lg-rev"></i>Revision from your plan</span><span><i class="lg-now"></i>Now</span>Lab sessions only show in lab weeks.</p></div>
    <div class="card wk-list">${agenda}</div>
  </div>`;
}

/* ---------------------------------------------------------------- 3. Deadlines */
function deadlineRow(x, ov, now) {
  const d = parseDue(x.due);
  const done = isDone(x);
  const cls = done ? 'done' : (d && d < now ? 'overdue' : (d && (d - now) < 3 * 864e5 ? 'soon' : ''));
  return `<li class="drow ${cls}">
    <input class="tick" type="checkbox" ${done ? 'checked' : ''} data-dl="${x.index}" aria-label="Done: ${esc(x.item)}">
    <div class="d-main"><span class="t">${esc(x.item)}</span><span class="d-meta"><span class="mk" style="--c:${MODCOL(x.module)}"></span>${esc(modName(x.module, ov))}${worth(x) ? `, ${esc(worth(x))}` : ''}</span></div>
    <div class="when">${d ? `<b>${fmtDay(d)}${d.allDay ? '' : ', ' + fmtTime(d)}</b><span>${relDays(d, now)}</span>` : esc(x.due)}</div></li>`;
}
function secDeadlines({ ov }, now) {
  const mods = [...new Set(ov.deadlines.flatMap(x => x.modules))].filter(m => m !== 'all');
  const items = ov.deadlines.filter(x => x.module !== 'all' && parseDue(x.due) && (STATE.dlDone || !isDone(x)) && (!STATE.dlMod || x.modules.includes(STATE.dlMod)))
    .sort((a, b) => parseDue(a.due) - parseDue(b.due));
  const left = ov.deadlines.filter(x => !isDone(x) && x.module !== 'all' && parseDue(x.due) && parseDue(x.due) >= now).length;
  const late = ov.deadlines.filter(x => !isDone(x) && x.module !== 'all' && parseDue(x.due) && parseDue(x.due) < now).length;
  const CAP = 12;
  const shown = STATE.dlAll ? items : items.slice(0, CAP);
  const half = Math.ceil(shown.length / 2);
  return `<div class="wrap">
    <div class="sec-head"><div><h2>Deadlines</h2><p class="sec-sub">${left} coming up${late ? `, ${late} past due and not ticked off` : ''}. Tick the circle when one is done.</p></div></div>
    <div class="chips" role="group" aria-label="Filter deadlines">
      <button type="button" class="chip" data-dlmod="" aria-pressed="${!STATE.dlMod}">All modules</button>
      ${mods.map(m => `<button type="button" class="chip" data-dlmod="${m}" aria-pressed="${STATE.dlMod === m}"><span class="mk" style="--c:${MODCOL(m)}"></span>${esc(ov.short[m] || m)}</button>`).join('')}
      <button type="button" class="chip" data-dldone="1" aria-pressed="${STATE.dlDone}">Include done</button>
    </div>
    ${shown.length ? `<div class="dl-cols"><ul class="dlist">${shown.slice(0, half).map(x => deadlineRow(x, ov, now)).join('')}</ul><ul class="dlist">${shown.slice(half).map(x => deadlineRow(x, ov, now)).join('')}</ul></div>` : '<p class="empty">Nothing here.</p>'}
    ${items.length > CAP ? `<button type="button" class="link more" data-dlall="1">${STATE.dlAll ? 'Show the next 12 only' : `Show all ${items.length}`}</button>` : ''}
  </div>`;
}

/* ---------------------------------------------------------------- 4. Problem sheets */
function secSheets({ ov }, now) {
  const byMod = {};
  for (const s of ov.sheets) {
    if (s.assessed === true) continue;
    (byMod[s.module] = byMod[s.module] || []).push(s);
  }
  const all = moduleQs(ov);
  const nq = nextQuestion(ov, now);
  const cards = Object.entries(byMod).map(([code, list]) => {
    const qc = moduleQs(ov, code);
    const rows = list.map(s => {
      const rel = parseDue(s.released);
      const locked = s.status === 'locked' || (rel && rel > now);
      const c = s.questions;
      const href = c ? sheetLink(s, code) : (s.path ? fileUrl(s.path) : null);
      const status = c ? qProgress(c) : (locked ? (rel ? 'Out ' + fmtDay(rel) : 'Not out yet') : (STATUS_TEXT[s.status] || s.status));
      const inner = `<span class="sh-id">${esc(s.id)}</span>${c ? qBar(c) : '<span class="qbar none"></span>'}<span class="sh-st">${esc(c ? `${c.done}/${c.total}` : (locked ? 'locked' : (s.status === 'done' ? 'done' : 'PDF')))}</span>`;
      return `<li class="${locked ? 'locked' : ''}">${href && !locked ? `<a class="shrow" href="${href}" ${c ? '' : 'target="_blank"'} title="${esc(s.id)}: ${esc(status)}">${inner}</a>` : `<span class="shrow">${inner}</span>`}</li>`;
    }).join('');
    return `<section class="card sheetcard" style="--c:${MODCOL(code)}" aria-label="${esc(modName(code, ov))} sheets">
      <div class="sc-head"><span class="mk lg"></span><h3>${esc(modName(code, ov))}</h3><span class="muted small">${qc.total ? `${qc.done}/${qc.total}` : ''}</span></div>
      <ul class="shlist">${rows}</ul></section>`;
  }).join('');
  return `<div class="wrap">
    <div class="sec-head"><div><h2>Problem sheets</h2><p class="sec-sub">${all.done} of ${all.total} questions done across ${ov.sheets.filter(s => s.questions).length} sheets${all.stuck ? `, ${all.stuck} marked stuck` : ''}. Open a sheet to work through it question by question.</p></div>
      ${nq ? `<a class="btn btn--primary" href="${sheetLink(nq.s)}?q=${encodeURIComponent(nq.n)}">Continue ${esc(nq.s.id)}, question ${esc(nq.label)}</a>` : ''}</div>
    <div class="sheetgrid">${cards}</div>
    <p class="legend small muted"><span><i class="lg-done"></i>Done</span><span><i class="lg-att"></i>Attempted</span><span><i class="lg-stuck"></i>Stuck</span><span><i class="lg-todo"></i>To do</span></p>
  </div>`;
}

/* ---------------------------------------------------------------- 5. Revision */
function secRevision({ ov, topics, plan }, now) {
  const sess = (plan.sessions || []).filter(s => parseDue(s.date + 'T' + s.end) > now).slice(0, 4);
  const byMod = {};
  for (const s of plan.sessions || []) byMod[s.module] = (byMod[s.module] || 0) + s.minutes / 60;
  const tot = Object.values(byMod).reduce((a, b) => a + b, 0) || 1;
  const rated = topics.filter(x => x.confidence != null);
  const groups = {};
  for (const x of topics) (groups[x.module] = groups[x.module] || []).push(x);
  const topicRow = x => `<li class="topic" data-id="${esc(x.id)}" style="--c:${MODCOL(x.module)}">
      <span class="tp-name">${x.summary ? `<a href="#/module/${encodeURIComponent(x.module)}/notes?s=${encodeURIComponent(x.summary)}" title="Open the summary">${esc(x.topic)}</a>` : esc(x.topic)}</span>
      <span class="scale5" role="group" aria-label="Confidence: ${esc(x.topic)}">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-c="${n}" aria-pressed="${x.confidence === n}" title="${n}: ${CONF_WORDS[n - 1]}">${n}</button>`).join('')}</span></li>`;
  return `<div class="wrap">
    <div class="sec-head"><div><h2>Revision</h2><p class="sec-sub">${Math.round(tot)} hours planned until the exams. ${rated.length} of ${topics.length} topics rated: weak topics in heavily weighted modules get the most time. <a class="link" href="#/doc?path=revision%2Fplan-settings.md">Change weekly hours</a></p></div>
      <button type="button" class="btn ${STATE.staleRatings ? 'btn--primary' : 'btn--secondary'}" id="regen">${STATE.staleRatings ? `Update plan with ${STATE.staleRatings} new rating${STATE.staleRatings === 1 ? '' : 's'}` : 'Regenerate plan'}</button></div>
    ${sess.length ? `<ol class="sess">${sess.map(s => `<li style="--c:${MODCOL(s.module)}"><span class="when">${fmtDay(parseDue(s.date))}, ${s.start}–${s.end}, ${esc(modName(s.module, ov))}</span><b>${esc(s.topic)}</b></li>`).join('')}</ol>` : '<p class="empty">No sessions coming up. Regenerate the plan.</p>'}
    <div class="card rev-topics">
      <div class="rt-head"><h3>How confident are you with each topic?</h3><p class="conf-key">${CONF_WORDS.map((w, i) => `<span><b>${i + 1}</b> ${w}</span>`).join('')}</p></div>
      <ul class="tplist">${Object.entries(groups).map(([m, xs]) => `<li class="tp-group"><span class="mk" style="--c:${MODCOL(m)}"></span>${esc(modName(m, ov))}</li>${xs.map(topicRow).join('')}`).join('')}</ul>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- 6. Modules */
function secModules({ ov }, now) {
  const rows = ov.modules.map(m => {
    const next = openDeadlines(ov).filter(x => x.modules.includes(m.code) && parseDue(x.due) >= dayStart(now))[0];
    const qc = moduleQs(ov, m.code);
    const a = m.assessment && typeof m.assessment === 'object' ? m.assessment : {};
    const parts = Object.entries(a).filter(([, v]) => typeof v === 'number');
    const href = `#/module/${m.code}`;
    return `<li><a class="modrow" href="${href}" style="--c:${MODCOL(m.code)}">
      <span class="badge">${ABBR[m.code] || esc(m.short).slice(0, 3)}</span>
      <span class="mr-name"><b>${esc(m.title.replace(/\s*\(.*\)\s*$/, ''))}</b><span>${esc(m.code)}${m.ects ? `, ${m.ects} ECTS` : ''}${parts.length ? `, ${esc(parts.map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}%`).join(', '))}` : (m.grading ? ', ' + esc(m.grading) : '')}</span></span>
      <span class="mr-next"><span class="muted small">Next</span>${next ? `<span>${esc(next.item)}, ${fmtDay(parseDue(next.due))}</span>` : '<span class="muted">Nothing due</span>'}</span>
      <span class="mr-prog">${qc.total ? `${qBar(qc)}<span class="muted small">${qc.done}/${qc.total} questions</span>` : ''}</span>
      <span class="mr-go" aria-hidden="true">${ARROW}</span></a></li>`;
  }).join('');
  return `<div class="wrap">
    <div class="sec-head"><div><h2>Modules</h2><p class="sec-sub">Lecture summaries, schedules, assessment and files for each module. Open one to read without leaving this page.</p></div></div>
    <ul class="modlist">${rows}</ul>
  </div>`;
}

/* ---------------------------------------------------------------- 7. Marks */
function secMarks({ ov, grades }, now) {
  const hasMark = i => i.score != null || i.mark != null;
  const waiting = [], upcoming = [];
  for (const m of grades) for (const i of m.items) {
    if (hasMark(i)) continue;
    const d = parseDue(i.due || i.date);
    if (['submitted', 'done'].includes(String(i.status))) waiting.push(Object.assign({ code: m.code, d }, i));
    else if (d && d >= dayStart(now)) upcoming.push(Object.assign({ code: m.code, d }, i));
  }
  upcoming.sort((a, b) => a.d - b.d);
  const worthOf = i => i.weight != null ? i.weight + '%' : (i.points != null ? i.points + ' pts' : '');
  const marked = grades.filter(m => m.items.some(hasMark)).map(m => {
    const its = m.items.filter(hasMark);
    const pts = its.filter(i => i.score != null && i.points);
    const got = pts.reduce((s, i) => s + i.score, 0), of = pts.reduce((s, i) => s + i.points, 0);
    return `<div class="mk-mod" style="--c:${MODCOL(m.code)}"><div class="mm-head"><span class="mk lg"></span><h3>${esc(modName(m.code, ov))}</h3>${of ? `<span class="stat num">${Math.round(got / of * 100)}%</span>` : ''}</div>
      ${of ? `<p class="small muted">${got} of ${of} points so far</p>` : ''}
      <ul class="rows">${its.map(i => `<li><span>${esc(i.name || i.id)}</span><span class="num"><b>${esc(i.score != null ? i.score : i.mark)}</b> / ${esc(i.points || i.out_of || '–')}</span></li>`).join('')}</ul></div>`;
  }).join('');
  const li = (i, right) => `<li><span class="mk" style="--c:${MODCOL(i.code)}"></span><span class="grow"><b>${esc(i.name || i.id)}</b><span class="muted small">${esc(modName(i.code, ov))}${worthOf(i) ? ', ' + esc(worthOf(i)) : ''}</span></span><span class="r">${right}</span></li>`;
  return `<div class="wrap">
    <div class="sec-head"><div><h2>Marks</h2><p class="sec-sub">From Canvas, as of the last sync. Most physics marks come from the summer exams.</p></div></div>
    <div class="marks-grid">
      <div class="card">${marked || '<p class="empty">No marks yet.</p>'}</div>
      <div class="card"><h3>Waiting for marks</h3>${waiting.length ? `<ul class="plain">${waiting.map(i => li(i, i.marks_back ? `back ${fmtDay(parseDue(i.marks_back))}` : 'handed in')).join('')}</ul>` : '<p class="empty">Nothing waiting.</p>'}</div>
      <div class="card"><h3>Marked work coming up</h3>${upcoming.length ? `<ul class="plain">${upcoming.slice(0, 5).map(i => li(i, `${fmtDay(i.d)}<br><span class="muted small">${relDays(i.d, now)}</span>`)).join('')}</ul>` : '<p class="empty">Nothing coming up.</p>'}</div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------------- 8. The year (closing) */
function secYear({ ov }, now) {
  const kd = ov.key_dates || {};
  const terms = kd.terms || {};
  const exams = (kd.exam_periods || []).filter(e => parseDue(e.to) >= now).slice(0, 3);
  const needs = (ov.needs.split(/^## /m).find(p => /^Open/.test(p)) || '').replace(/^Open\s*/, '').trim();
  const needItems = needs.split(/\n(?=\d+\.\s)/).map(x => x.replace(/^\d+\.\s*/, '').trim()).filter(Boolean);
  const docs = [['year/key-dates.md', 'Key dates'], ['year/exams.md', 'Exams'], ['year/programme.md', 'Programme'], ['year/policies.md', 'Policies'], ['year/contacts.md', 'Contacts'], ['year/student-essentials.md', 'Student Essentials']];
  const termRow = (k, t) => t ? `<li><span>${cap(k)} term</span><span class="num">${t.teaching_starts ? fmtDay(parseDue(t.teaching_starts)) : ''}${t.ends ? ' to ' + fmtDay(parseDue(t.ends)) : ''}</span></li>` : '';
  return `<div class="wrap">
    <div class="close-top">
      <div class="close-col"><h2>The year</h2><p class="sec-sub">Year 2 Physics, 2026–27.</p>
        <ul class="rows">${['autumn', 'spring', 'summer'].map(k => termRow(k, terms[k])).join('')}${exams.map(e => `<li><span>${esc(e.what)}</span><span class="num">${fmtDay(parseDue(e.from))} to ${fmtDay(parseDue(e.to))}</span></li>`).join('')}</ul>
        <div class="doclinks">${docs.map(([p, l]) => `<a class="link" href="#/doc?path=${encodeURIComponent(p)}">${l}</a>`).join('')}</div>
      </div>
      <div class="close-col"><h3>Needs from you</h3>
        ${needItems.length ? `<ol class="needs">${needItems.map(x => `<li>${renderMd(x, '_meta').innerHTML}</li>`).join('')}</ol>` : '<p class="empty">Nothing waiting on you.</p>'}
      </div>
    </div>
    <p class="wordmark" aria-hidden="true">IMPERIAL</p>
    <p class="legal small" id="syncLine"></p>
  </div>`;
}

const SECTIONS = [['today', secToday], ['week', secWeek], ['deadlines', secDeadlines], ['sheets', secSheets], ['revision', secRevision], ['modules', secModules], ['marks', secMarks], ['year', secYear]];

/* ---------------------------------------------------------------- events */
function bindAll() {
  // deadlines
  main.querySelectorAll('input[data-dl]').forEach(cb => cb.addEventListener('change', async () => {
    const it = DATA.ov.deadlines.find(x => String(x.index) === cb.dataset.dl);
    cb.disabled = true;
    try {
      await post('/api/deadline', { index: it.index, item: it.item, status: cb.checked ? 'done' : 'open' });
      toast(cb.checked ? `Done: ${it.item}` : `Not done: ${it.item}`);
      await refresh();
    } catch (e) { cb.checked = !cb.checked; cb.disabled = false; toast(e.message, true); }
  }));
  main.querySelectorAll('[data-dlmod]').forEach(b => b.addEventListener('click', () => { STATE.dlMod = b.dataset.dlmod; rerender('deadlines'); }));
  main.querySelectorAll('[data-dldone]').forEach(b => b.addEventListener('click', () => { STATE.dlDone = !STATE.dlDone; rerender('deadlines'); }));
  main.querySelectorAll('[data-dlall]').forEach(b => b.addEventListener('click', () => { STATE.dlAll = !STATE.dlAll; rerender('deadlines'); }));
  // week
  main.querySelectorAll('[data-wk]').forEach(b => b.addEventListener('click', () => { const v = +b.dataset.wk; STATE.weekOff = v === 0 ? 0 : STATE.weekOff + v; rerender('week'); }));
  // revision ratings
  main.querySelectorAll('.topic button[data-c]').forEach(b => b.addEventListener('click', async () => {
    const row = b.closest('.topic'), id = row.dataset.id, t = DATA.topics.find(x => x.id === id);
    const val = t.confidence === +b.dataset.c ? null : +b.dataset.c;
    try {
      await post('/api/topic', { id, confidence: val });
      t.confidence = val; STATE.staleRatings++;
      toast(val ? `${t.topic}: ${val}, ${CONF_WORDS[val - 1].toLowerCase()}` : 'Rating cleared');
      rerender('revision');
    } catch (e) { toast(e.message, true); }
  }));
  const rg = $('#regen');
  if (rg) rg.addEventListener('click', async () => {
    rg.disabled = true; rg.textContent = 'Working…';
    try { await post('/api/plan/regenerate', {}); STATE.staleRatings = 0; toast('Plan updated'); await refresh(); }
    catch (e) { toast(e.message, true); rg.disabled = false; }
  });
  // live countdown
  const cd = $('#cd');
  if (cd) every(30000, () => { cd.textContent = 'in ' + countText(+cd.dataset.due - Date.now()); });
}
function rerender(id) {
  const fn = SECTIONS.find(s => s[0] === id)[1];
  document.getElementById(id).innerHTML = fn(DATA, new Date());
  bindAll();
}

/* scroll spy: underline the nav word of the section on screen */
function spy() {
  const links = [...document.querySelectorAll('.nav-words a')];
  const secs = links.map(a => document.getElementById(a.getAttribute('href').slice(1))).filter(Boolean);
  const y = window.scrollY + innerHeight * 0.4;
  let cur = secs[0];
  for (const s of secs) if (s.offsetTop <= y) cur = s;
  links.forEach(a => { if (cur && a.getAttribute('href') === '#' + cur.id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
}
window.addEventListener('scroll', () => { cancelAnimationFrame(spy._r); spy._r = requestAnimationFrame(spy); }, { passive: true });

/* ================================================================ the panel */
const panel = $('#panel'), panelBody = $('#panelBody'), panelTitle = $('#panelTitle');
let PANEL_OPEN = false, LAST_FOCUS = null;
function openPanel(title) {
  if (!PANEL_OPEN) { LAST_FOCUS = document.activeElement; panel.hidden = false; requestAnimationFrame(() => panel.classList.add('on')); document.body.classList.add('locked'); }
  PANEL_OPEN = true;
  panelTitle.textContent = title || '';
  panelBody.scrollTop = 0;
  $('.panel-box').focus({ preventScroll: true });
}
function closePanel(fromHash) {
  if (!PANEL_OPEN) return;
  PANEL_OPEN = false;
  panel.classList.remove('on');
  document.body.classList.remove('locked');
  setTimeout(() => { if (!PANEL_OPEN) { panel.hidden = true; panelBody.innerHTML = ''; } }, reduced() ? 0 : 220);
  if (!fromHash && location.hash.startsWith('#/')) history.pushState(null, '', location.pathname + (PANEL_FROM || ''));
  if (LAST_FOCUS && LAST_FOCUS.focus) LAST_FOCUS.focus({ preventScroll: true });
}
let PANEL_FROM = '';
$('#panelClose').addEventListener('click', () => closePanel());
$('#panelShade').addEventListener('click', () => closePanel());
document.addEventListener('keydown', e => { if (e.key === 'Escape' && PANEL_OPEN) closePanel(); });

/* hash routing: #section scrolls, #/thing opens the panel */
const LEGACY = { home: 'today', today: 'today', week: 'week', deadlines: 'deadlines', modules: 'modules', revision: 'revision', grades: 'marks', marks: 'marks', year: 'year', sheets: 'sheets' };
async function route() {
  const h = location.hash;
  if (!h.startsWith('#/')) { if (PANEL_OPEN) closePanel(true); return; }
  const [pathPart, query] = h.slice(2).split('?');
  const parts = pathPart.split('/').map(decodeURIComponent);
  const q = new URLSearchParams(query || '');
  if (LEGACY[parts[0]] && !(parts[0] === 'year' && q.get('d'))) {
    if (PANEL_OPEN) closePanel(true);
    history.replaceState(null, '', '#' + LEGACY[parts[0]]);
    document.getElementById(LEGACY[parts[0]]).scrollIntoView();
    return;
  }
  try {
    if (parts[0] === 'sheet') await panelSheet(parts[1], parts[2], q);
    else if (parts[0] === 'module') await panelModule(parts[1], parts[2], q);
    else if (parts[0] === 'doc') await panelDoc(q.get('path'));
    else if (parts[0] === 'year') await panelDoc(q.get('d'));
    else if (parts[0] === 'search') await panelSearch(q.get('q') || '');
    else { closePanel(true); }
  } catch (e) {
    openPanel('Not found');
    panelBody.innerHTML = `<p class="empty">That didn't load: ${esc(e.message)}</p>`;
  }
}
window.addEventListener('hashchange', route);
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#/"]');
  if (a && !PANEL_OPEN) PANEL_FROM = location.hash.startsWith('#/') ? '' : location.hash;
});
$('#searchForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('#searchQ').value.trim();
  if (v) location.hash = '#/search?q=' + encodeURIComponent(v);
});

/* ---------------------------------------------------------------- panel: a sheet, question by question */
async function panelSheet(code, sid, q) {
  const r = await api(`/api/sheet/${encodeURIComponent(code)}/${encodeURIComponent(sid)}`);
  const ov = DATA.ov;
  openPanel(`${modName(code, ov)}: ${sid}`);
  const qs = r.sections.filter(s => s.q);
  const extra = r.sections.filter(s => !s.q);
  const intro = extra.filter(s => /^intro/i.test(s.key));
  const after = extra.filter(s => !/^intro/i.test(s.key));
  const now = new Date();
  const solRel = parseDue(r.sheet.solutions_release);
  const links = [];
  if (r.source_path) links.push(`<a class="btn btn--secondary btn--sm" href="${fileUrl(r.source_path)}" target="_blank">Sheet PDF</a>`);
  if (r.solutions_path) links.push(`<a class="btn btn--secondary btn--sm" href="${fileUrl(r.solutions_path)}" target="_blank">Solutions PDF</a>`);
  if (r.lambda_set) links.push(`<a class="btn btn--secondary btn--sm" href="${esc(r.lambda_set)}" target="_blank" rel="noopener">Lambda Feedback</a>`);
  let solNote = '';
  if (!r.solutions_path) {
    if (r.lambda_set) solNote = 'Answers and worked solutions are on Lambda Feedback, under Help on each question.';
    else if (solRel && solRel > now) solNote = `Solutions come out ${fmtDay(solRel)}${solRel.allDay ? '' : ' at ' + fmtTime(solRel)}.`;
    else if (r.solutions_name) solNote = 'Solutions are out but not synced yet.';
    else solNote = 'No solutions posted yet.';
  }
  panelBody.innerHTML = `
    <div class="p-head"><h2>${esc(r.title)}</h2><p class="muted">${esc([r.note, solNote].filter(Boolean).join(' '))}</p>${links.length ? `<div class="btn-row">${links.join('')}</div>` : ''}</div>
    <div class="qhead"><div class="qhead-top"><b id="qprog"></b><span class="muted small" id="qprog2"></span></div><nav class="qstrip" aria-label="Questions" id="qstrip"></nav></div>
    <div id="qlist"></div>`;
  const list = $('#qlist');
  for (const s of intro) { const c = document.createElement('section'); c.className = 'qcard'; c.appendChild(renderMd(s.md, r.qdir)); list.appendChild(c); }
  for (const s of qs) {
    const x = s.q;
    const c = document.createElement('section');
    c.className = 'qcard'; c.id = 'q-' + x.n; c.dataset.status = x.status || 'not-started';
    const name = x.label ? (/^\d/.test(x.label) ? 'Question ' + x.label : x.label) : 'Question ' + x.n;
    const acts = [];
    if (r.source_path && x.page) acts.push(`<a class="link" href="${pdfAt(r.source_path, x.page)}" target="_blank">Sheet, page ${x.page}</a>`);
    if (r.solutions_path) acts.push(x.sol_page ? `<a class="link" href="${pdfAt(r.solutions_path, x.sol_page)}" target="_blank">Solution, page ${x.sol_page}</a>` : `<a class="link" href="${fileUrl(r.solutions_path)}" target="_blank">Solutions PDF</a>`);
    const lu = lambdaUrl(r, x);
    if (lu) acts.push(`<a class="link" href="${esc(lu)}" target="_blank" rel="noopener">Open on Lambda Feedback</a>`);
    if (x.answer) acts.push(`<button class="link" type="button" data-reveal aria-expanded="false">Show answer</button>`);
    c.innerHTML = `
      <div class="qtop"><div><p class="qnum">${esc(name)}</p>${x.topic ? `<h3 class="qtitle">${esc(x.topic)}</h3>` : ''}</div>
        <div class="qstate" role="group" aria-label="Status of ${esc(name)}">${Q_STATES.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${(x.status || 'not-started') === v}">${l}</button>`).join('')}</div></div>
      <div class="qbody"></div>
      ${x.answer ? `<div class="qans" hidden><span class="muted small">Answer printed on the sheet</span><div class="qans-v"></div></div>` : ''}
      ${acts.length ? `<div class="qacts">${acts.join('')}</div>` : ''}`;
    const m0 = s.md.match(/^\*\*([^*\n]+)\*\*\s*\n/);
    $('.qbody', c).appendChild(renderMd(m0 && m0[1].trim() === String(x.topic || '').trim() ? s.md.slice(m0[0].length) : s.md, r.qdir));
    if (x.answer) $('.qans-v', c).appendChild(renderMd(/\$/.test(x.answer) ? x.answer : `$${x.answer}$`, r.qdir));
    list.appendChild(c);
  }
  for (const s of after) { const d = document.createElement('details'); d.className = 'qextra'; d.innerHTML = `<summary>${esc(s.key)}</summary>`; d.appendChild(renderMd(s.md, r.qdir)); list.appendChild(d); }
  const paint = () => {
    const c = { 'not-started': 0, attempted: 0, stuck: 0, done: 0, total: qs.length };
    qs.forEach(s => { c[s.q.status in c ? s.q.status : 'not-started']++; });
    $('#qprog').textContent = c.done === c.total ? 'All done' : `${c.done} of ${c.total} done`;
    $('#qprog2').textContent = [c.attempted && `${c.attempted} attempted`, c.stuck && `${c.stuck} stuck`, c['not-started'] && `${c['not-started']} to do`].filter(Boolean).join(', ');
    $('#qstrip').innerHTML = qs.map(s => { const x = s.q, st = x.status || 'not-started'; return `<a href="#q-${esc(x.n)}" data-jump="${esc(x.n)}" class="seg s-${st}" title="${esc((x.label || x.n) + ': ' + Q_WORD[st])}"><span>${esc(x.label || x.n)}</span></a>`; }).join('');
  };
  paint();
  $('#qstrip').addEventListener('click', e => {
    const a = e.target.closest('[data-jump]'); if (!a) return;
    e.preventDefault();
    document.getElementById('q-' + a.dataset.jump).scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  });
  list.addEventListener('click', async e => {
    const rv = e.target.closest('[data-reveal]');
    if (rv) { const box = $('.qans', rv.closest('.qcard')); box.hidden = !box.hidden; rv.setAttribute('aria-expanded', String(!box.hidden)); rv.textContent = box.hidden ? 'Show answer' : 'Hide answer'; return; }
    const b = e.target.closest('.qstate button'); if (!b || b.getAttribute('aria-pressed') === 'true') return;
    const card = b.closest('.qcard'), n = card.id.slice(2);
    const item = qs.find(s => String(s.q.n) === n).q;
    card.querySelectorAll('.qstate button').forEach(x => { x.disabled = true; });
    try {
      const res = await post('/api/question', { module: code, sheet: sid, n, status: b.dataset.v });
      item.status = res.status; card.dataset.status = res.status;
      card.querySelectorAll('.qstate button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.v === res.status)));
      paint();
      toast(`${item.label || 'Question ' + n}: ${Q_WORD[res.status].toLowerCase()}${res.counts.done === res.counts.total ? '. Sheet done' : ''}`);
      load(true).then(renderAll);
    } catch (err) { toast(err.message, true); }
    card.querySelectorAll('.qstate button').forEach(x => { x.disabled = false; });
  });
  const jump = q.get('q');
  if (jump && document.getElementById('q-' + jump)) requestAnimationFrame(() => document.getElementById('q-' + jump).scrollIntoView({ block: 'start' }));
}

/* ---------------------------------------------------------------- panel: a module */
async function panelModule(code, tabIn, q) {
  const m = await api('/api/module/' + encodeURIComponent(code));
  const ov = DATA.ov;
  const mod = ov.modules.find(x => x.code === code) || {};
  const tabs = [['notes', 'Lecture summaries', m.summaries.length], ['experiments', 'Experiments', m.experiments.length], ['overview', 'About', m.module], ['schedule', 'Schedule', m.schedule],
    ['assessment', 'Assessment', m.assessment], ['files', 'Files', true]].filter(t => t[2]);
  const tab = tabs.some(t => t[0] === tabIn) ? tabIn : tabs[0][0];
  openPanel(mod.title ? mod.title.replace(/\s*\(.*\)\s*$/, '') : code);
  const links = [];
  if (mod.canvas_url) links.push(`<a class="btn btn--secondary btn--sm" href="${esc(mod.canvas_url)}" target="_blank" rel="noopener">Canvas</a>`);
  if (m.lambda_course) links.push(`<a class="btn btn--secondary btn--sm" href="${esc(m.lambda_course)}" target="_blank" rel="noopener">Lambda Feedback</a>`);
  if (m.sheets) links.push(`<a class="btn btn--secondary btn--sm" href="#sheets" data-close>Problem sheets</a>`);
  panelBody.innerHTML = `<div class="p-head"><p class="muted small"><span class="mk" style="--c:${MODCOL(code)}"></span> ${esc(code)}${mod.ects ? `, ${mod.ects} ECTS` : ''}</p>${links.length ? `<div class="btn-row">${links.join('')}</div>` : ''}</div>
    <nav class="ptabs" aria-label="Module sections">${tabs.map(([k, l]) => `<a href="#/module/${code}/${k}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav><div id="ptab"></div>`;
  panelBody.querySelectorAll('[data-close]').forEach(a => a.addEventListener('click', () => closePanel(true)));
  const box = $('#ptab');
  const mdInto = (r, strip) => { if (r) box.appendChild(renderMd(dropH1(strip ? stripTables(r.body) : r.body), r.dir)); };
  if (tab === 'overview') mdInto(m.module);
  else if (tab === 'schedule') mdInto(m.schedule);
  else if (tab === 'assessment') {
    const items = m.assessment.fm.items || [];
    box.innerHTML = `<div class="tablebox"><table class="t"><thead><tr><th>Item</th><th>Due</th><th>Worth</th><th>Status</th><th>Mark</th></tr></thead><tbody>${items.map(i => {
      const d = parseDue(i.due || i.date);
      const mark = i.score != null ? `${i.score} / ${i.points}` : (i.mark != null ? `${i.mark} / ${i.out_of || '?'}` : '–');
      return `<tr><td>${esc(i.name || i.id)}</td><td class="n">${d ? fmtDay(d) + (d.allDay ? '' : ', ' + fmtTime(d)) : esc(i.due || i.window || '–')}</td><td class="n">${esc(i.weight != null ? i.weight + '%' : (i.points != null ? i.points + ' pts' : (i.weight_note || '–')))}</td><td>${esc(cap(String(i.status || '').replace(/-/g, ' ')))}</td><td class="n">${esc(mark)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    if (stripTables(m.assessment.body).trim()) mdInto(m.assessment, true);
  } else if (tab === 'notes') {
    const sel = q.get('s') || m.summaries[0].path;
    const i = Math.max(0, m.summaries.findIndex(s => s.path === sel));
    const courses = new Set(m.summaries.map(s => s.course));
    const sub = s => [courses.size > 1 ? s.course : null, s.chapter != null ? 'Ch ' + s.chapter : null, (s.lectures || []).length ? 'L' + [].concat(s.lectures).join(', ').replace(/L/g, '') : null].filter(Boolean).join(', ');
    const prev = m.summaries[i - 1], nxt = m.summaries[i + 1];
    box.innerHTML = `<label class="sumpick"><span class="muted small">Summary</span><select id="sumSel">${m.summaries.map(s => `<option value="${esc(s.path)}" ${s.path === m.summaries[i].path ? 'selected' : ''}>${esc(s.title)}${sub(s) ? ' (' + esc(sub(s)) + ')' : ''}</option>`).join('')}</select></label><div id="sumBody"></div>`;
    $('#sumSel').addEventListener('change', e => { location.hash = `#/module/${code}/notes?s=${encodeURIComponent(e.target.value)}`; });
    const r = await api('/api/md?path=' + encodeURIComponent(m.summaries[i].path));
    const pl = [];
    for (const k of ['notes', 'slides']) for (const p of [].concat(r.fm[k] || [])) {
      const clean = String(p || '').replace(/\s*\(.*$/, '').trim();
      if (clean.endsWith('.pdf')) pl.push(`<a class="link" href="/open?${new URLSearchParams({ p: clean, base: 'modules/' + m.dir })}" target="_blank">${k === 'notes' ? 'Notes' : 'Slides'}: ${esc(clean.split('/').pop())}</a>`);
    }
    const sb = $('#sumBody');
    if (pl.length) sb.insertAdjacentHTML('beforeend', `<div class="linkrow">${pl.join('')}</div>`);
    sb.appendChild(renderMd(r.body, r.dir));
    sb.insertAdjacentHTML('beforeend', `<nav class="pager" aria-label="Other summaries">${prev ? `<a href="#/module/${code}/notes?s=${encodeURIComponent(prev.path)}"><span class="muted small">Previous</span>${esc(prev.title)}</a>` : '<span></span>'}${nxt ? `<a class="nx" href="#/module/${code}/notes?s=${encodeURIComponent(nxt.path)}"><span class="muted small">Next</span>${esc(nxt.title)}</a>` : ''}</nav>`);
  } else if (tab === 'experiments') {
    const cyc = (ov.lab_cycles || []).filter(c => c.module === code);
    const now = new Date();
    const curC = cyc.find(c => parseDue(c.start) <= now && now <= addDays(parseDue(c.end), 1)) || cyc.find(c => parseDue(c.start) > now);
    const name = e => ((e.body.match(/^# (.+)$/m) || [])[1] || e.dir.split('/').pop()).replace(/\s*\(.*\)\s*$/, '');
    let k = q.has('e') ? +q.get('e') : Math.max(0, m.experiments.findIndex(e => curC && e.dir.endsWith('/' + curC.name)));
    if (!(k >= 0 && k < m.experiments.length)) k = 0;
    box.innerHTML = `<div class="chips">${m.experiments.map((e, j) => { const c = cyc.find(c => e.dir.endsWith('/' + c.name)); return `<a class="chip" href="#/module/${code}/experiments?e=${j}" aria-pressed="${j === k}">${esc(name(e))}${c ? ` <span class="small muted">${fmtDay(parseDue(c.start))}${curC === c ? ', now' : ''}</span>` : ''}</a>`; }).join('')}</div>`;
    box.appendChild(renderMd(m.experiments[k].body, m.experiments[k].dir));
  } else if (tab === 'files') box.innerHTML = fileTree(m.tree);
  try { renderMathInElement(panelBody, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false }); } catch (e) { /* */ }
}
function fileTree(tree) {
  return `<div class="ftree">${tree.map(g => `<h3>${esc(g.folder || 'Top level')}</h3><ul>${g.files.map(f => {
    const isMd = f.name.endsWith('.md');
    return `<li><span>${isMd ? `<a href="#/doc?path=${encodeURIComponent(f.path)}">${esc(f.name)}</a>` : `<a href="${fileUrl(f.path)}" target="_blank">${esc(f.name)}</a>`}</span>
      <span class="acts">${f.text ? `<a href="${fileUrl(f.text)}" target="_blank">Text</a>` : ''}<span>${f.size > 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB'}</span></span></li>`;
  }).join('')}</ul>`).join('')}</div>`;
}

/* ---------------------------------------------------------------- panel: a note */
async function panelDoc(p) {
  const r = await api('/api/md?path=' + encodeURIComponent(p));
  const title = (r.body.match(/^# (.+)$/m) || [])[1] || r.fm.title || p.split('/').pop();
  openPanel(title);
  panelBody.innerHTML = `<p class="muted small">${esc(p)}. <a class="link" href="${fileUrl(p)}" target="_blank">View the file</a></p>`;
  panelBody.appendChild(renderMd(dropH1(r.body), r.dir));
}

/* ---------------------------------------------------------------- panel: search */
async function panelSearch(term) {
  openPanel('Search');
  $('#searchQ').value = term;
  panelBody.innerHTML = `<form class="psearch" id="psForm" role="search"><label class="sr" for="psQ">Search your notes</label><input id="psQ" type="search" value="${esc(term)}" placeholder="Wronskian, virial theorem, Compton"><button class="btn btn--primary">Search</button></form><div id="sres"></div>`;
  $('#psForm').addEventListener('submit', e => { e.preventDefault(); location.hash = '#/search?q=' + encodeURIComponent($('#psQ').value.trim()); });
  if (term.length < 2) { $('#psQ').focus(); return; }
  const r = await api('/api/search?q=' + encodeURIComponent(term));
  const ov = DATA.ov;
  const rx = new RegExp(esc(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const hl = s => String(s).split(/(\$[^$]+\$)/).map((part, i) => i % 2 ? esc(part) : esc(part).replace(rx, m => `<mark>${m}</mark>`)).join('');
  $('#sres').innerHTML = r.results.length ? `<p class="muted small">${r.total_files} file${r.total_files === 1 ? '' : 's'} match${r.total_files > r.results.length ? `. Showing the first ${r.results.length}` : ''}.</p>
    ${r.results.map(x => {
      const page = (x.hits[0] || {}).page;
      const sec = (x.hits.find(h => h.section) || {}).section;
      const lab = n => (x.labels || {})[n] || n;
      const acts = [];
      if (x.link) acts.push(`<a class="link" href="${x.link}${x.kind === 'Problem sheet' && sec ? '?q=' + encodeURIComponent(sec) : ''}">${x.kind === 'Problem sheet' ? (sec ? 'Open at question ' + esc(lab(sec)) : 'Open sheet') : 'Open'}</a>`);
      if (x.source) acts.push(`<a class="link" href="${fileUrl(x.source)}${x.source.endsWith('.pdf') && page ? '#page=' + page : ''}" target="_blank">Open ${x.source.split('.').pop().toUpperCase()}${page ? ` at page ${page}` : ''}</a>`);
      if (!x.link && !x.source) acts.push(`<a class="link" href="${fileUrl(x.path)}" target="_blank">Text version</a>`);
      const where = [x.module ? modName(x.module, ov) : x.path.split('/')[0], x.kind, `${x.count} match${x.count === 1 ? '' : 'es'}`].filter(Boolean).join(', ');
      return `<div class="hit"><b class="path">${esc(x.title || x.path.split('/').pop())}</b><span class="where">${x.module ? `<span class="mk" style="--c:${MODCOL(x.module)}"></span>` : ''}${esc(where)}</span>
        ${x.hits.map(h => `<div class="line">${h.page ? `<b>p.${h.page}</b> ` : ''}${h.section ? `<b>Q${esc(lab(h.section))}</b> ` : ''}${hl(h.line)}</div>`).join('')}
        <div class="acts">${acts.join('')}</div></div>`;
    }).join('')}` : `<p class="empty">No matches for “${esc(term)}”. Try a shorter word or a different spelling.</p>`;
  try { renderMathInElement($('#sres'), { delimiters: [{ left: '$', right: '$', display: false }], throwOnError: false }); } catch (e) { /* */ }
}

/* ---------------------------------------------------------------- start */
(async () => {
  try {
    await load();
    renderAll();
    const h = location.hash;
    if (h && !h.startsWith('#/')) { const el = document.getElementById(h.slice(1)); if (el) el.scrollIntoView(); }
    route();
    setInterval(() => { if (!PANEL_OPEN && !document.hidden) { const y = scrollY; renderAll(); scrollTo(0, y); } }, 60000);
  } catch (e) {
    main.innerHTML = `<div class="wrap" style="padding-top: 140px"><h2>The dashboard didn't load</h2><p class="muted">${esc(e.message)}</p><p>Check that it is still running in its Terminal window, then reload.</p></div>`;
  }
})();
