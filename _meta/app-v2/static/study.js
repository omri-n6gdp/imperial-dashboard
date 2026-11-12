/* ---------------------------------------------------------------- study timer and log (Revision → Log)
   Start the timer on a topic, a problem sheet or a module; a pill in the corner shows it while you move around the
   site, and it keeps running through a reload. Stop saves the session to revision/studylog.json (POST /api/store).
   The Log tab compares the hours you actually studied with the hours in your revision timetable (plan-settings.md),
   split between the modules the same way the timetable splits them (by ECTS).
   The log also counts what you did each day (question parts marked, topics marked, flashcards, mocks) for the
   activity grid. */
(() => {
  const KEY = 'icd-timer', LONG = 3 * 3600e3, DAYMS = 864e5;
  const L = { store: null, loading: false, form: false };
  const pad2 = n => String(n).padStart(2, '0');
  const fmtClock = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + pad2(m) : m) + ':' + pad2(s % 60); };
  const fmtMins = m => { m = Math.round(m); const h = Math.floor(m / 60); return h ? `${h}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`; };
  const monday = d => { const x = dayStart(d); return addDays(x, -((x.getDay() + 6) % 7)); };
  const getT = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } };
  const putT = t => { try { t ? localStorage.setItem(KEY, JSON.stringify(t)) : localStorage.removeItem(KEY); } catch (e) { /* storage off */ } };
  const elapsed = t => t ? t.spent + (t.from ? Date.now() - t.from : 0) : 0;
  const MODS = () => Object.keys(MOD_NAMES);

  async function ensure() {
    if (L.store) return L.store;
    if (L.loading) return L.loading;
    L.loading = storeLoad('studylog').then(s => { s.sessions = s.sessions || []; s.acts = s.acts || {}; L.store = s; L.loading = false; return s; });
    return L.loading;
  }
  let saveT;
  function save(now) { clearTimeout(saveT); saveT = setTimeout(() => storeSave('studylog', L.store, true), now ? 0 : 1500); }

  /* ---- what you did each day: called by the pages when you mark a question, a topic, a card or save a mock */
  async function activity(kind) {
    const s = await ensure(), d = iso(new Date());
    const a = s.acts[d] = s.acts[d] || {};
    a[kind] = (a[kind] || 0) + 1;
    save();
  }

  /* ---- the timer */
  function start(o) {
    const cur = getT();
    if (cur && elapsed(cur) > 60e3) finish(true);           // starting something else saves what was running
    putT({ from: Date.now(), spent: 0, started: Date.now(), kind: o.kind, ref: o.ref || '', code: o.code || '', label: o.label || '', href: o.href || '' });
    pill(); render();
  }
  function pause() { const t = getT(); if (!t) return; if (t.from) { t.spent = elapsed(t); t.from = null; } else t.from = Date.now(); putT(t); pill(); render(); }
  async function finish(quiet, mins) {
    const t = getT(); if (!t) return;
    const ms = mins != null ? mins * 6e4 : elapsed(t);
    if (mins == null && ms > LONG && !quiet) { askLong(t, ms); return; }
    putT(null); pill(); render();
    if (ms < 60e3) { if (!quiet) toast('Under a minute, so nothing was logged.'); return; }
    const s = await ensure(), end = Date.now();
    const x = { id: end.toString(36), start: end - ms, end, mins: Math.round(ms / 6e4), kind: t.kind, ref: t.ref, code: t.code, label: t.label, href: t.href };
    s.sessions.push(x);
    save(true);
    if (!quiet) toast(`Logged ${fmtMins(x.mins)} on ${x.label || modOf(x.code)[0]}.`, async () => { s.sessions = s.sessions.filter(y => y.id !== x.id); save(true); render(); });
    render();
  }
  function discard() {
    const t = getT(); if (!t) return;
    putT(null); pill(); render();
    toast('Timer cleared, nothing logged.', () => { putT(t); pill(); render(); });
  }
  /* left running for hours: probably forgotten, so ask how long it really was */
  function askLong(t, ms) {
    const p = pillEl();
    p.classList.add('ask');
    p.innerHTML = `<span class="sp-q">That was ${fmtMins(ms / 6e4)}. How long did you actually study?</span>
      <input type="number" min="1" max="${Math.ceil(ms / 6e4)}" value="${Math.min(120, Math.round(ms / 6e4))}" aria-label="Minutes studied"><span class="sp-u">min</span>
      <button class="btn solid" data-sp="savelong">Log it</button><button class="btn" data-sp="discard">Discard</button>`;
    $('input', p).focus();
  }

  function pillEl() {
    let p = document.getElementById('study-pill');
    if (!p) { p = document.createElement('div'); p.id = 'study-pill'; p.setAttribute('role', 'status'); document.body.appendChild(p); }
    return p;
  }
  function pill() {
    const t = getT(), p = pillEl();
    p.classList.remove('ask');
    p.hidden = !t;
    if (!t) { p.innerHTML = ''; return; }
    p.classList.toggle('paused', !t.from);
    const lab = t.label || modOf(t.code)[0] || 'Studying';
    p.innerHTML = `<span class="sp-dot" aria-hidden="true"></span><span class="sp-time">${fmtClock(elapsed(t))}</span>
      ${t.href ? `<a class="sp-lab" href="${esc(t.href)}" title="${esc(lab)}">${esc(lab)}</a>` : `<span class="sp-lab">${esc(lab)}</span>`}
      <button class="sp-b" data-sp="pause" aria-label="${t.from ? 'Pause' : 'Carry on'}" title="${t.from ? 'Pause' : 'Carry on'}">${t.from ? '❚❚' : '▶'}</button>
      <button class="sp-b" data-sp="stop" aria-label="Stop and log it" title="Stop and log it">■</button>
      <button class="sp-b x" data-sp="discard" aria-label="Clear without logging" title="Clear without logging">✕</button>`;
  }
  setInterval(() => { const t = getT(), el = document.querySelector('#study-pill .sp-time'); if (t && el && t.from) el.textContent = fmtClock(elapsed(t)); }, 1000);
  addEventListener('storage', e => { if (e.key === KEY) { pill(); render(); } });     // another tab started or stopped it

  /* the Start button the topic and sheet pages show */
  function startBtn(o) {
    const t = getT(), here = t && t.kind === o.kind && t.ref === o.ref;
    if (here) return `<button class="btn sp-start on" data-sp="pause">${t.from ? 'Timing this · pause' : 'Paused · carry on'}</button>`;
    return `<button class="btn sp-start" data-sp="start" data-k="${esc(o.kind)}" data-r="${esc(o.ref)}" data-c="${esc(o.code)}" data-l="${esc(o.label)}" data-h="${esc(o.href || '')}">Start timer</button>`;
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-sp]');
    if (!b) return;
    const a = b.dataset.sp;
    if (a === 'start') start({ kind: b.dataset.k, ref: b.dataset.r, code: b.dataset.c, label: b.dataset.l, href: b.dataset.h });
    if (a === 'pause') pause();
    if (a === 'stop') finish(false);
    if (a === 'discard') discard();
    if (a === 'savelong') { const v = +$('#study-pill input').value; if (v > 0) finish(false, v); }
    if (a === 'go') {
      const box = b.closest('.lg-start'), code = $('select', box).value, what = $('input', box).value.trim();
      start({ kind: 'module', ref: code + '/' + what, code, label: what ? `${modOf(code)[0]} · ${what}` : modOf(code)[0], href: '#revision/log' });
    }
    if (a === 'add') { L.form = !L.form; render(); }
    if (a === 'addsave') {
      const f = b.closest('.lg-add'), code = $('[name=code]', f).value, what = $('[name=what]', f).value.trim(), mins = +$('[name=mins]', f).value, day = ymd($('[name=day]', f).value);
      if (!(mins > 0) || !day) return toast('Give the minutes and the day.', null, true);
      const end = Math.min(Date.now(), +new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18));
      L.store.sessions.push({ id: Date.now().toString(36), start: end - mins * 6e4, end, mins: Math.round(mins), kind: 'module', ref: code, code, label: what ? `${modOf(code)[0]} · ${what}` : modOf(code)[0], added: true });
      L.form = false; save(true); render();
      toast(`Added ${fmtMins(mins)} on ${dShort(day)}.`);
    }
    if (a === 'del') {
      const id = b.dataset.id, x = L.store.sessions.find(y => y.id === id); if (!x) return;
      L.store.sessions = L.store.sessions.filter(y => y.id !== id); save(true); render();
      toast(`Removed ${fmtMins(x.mins)} on ${x.label || modOf(x.code)[0]}.`, () => { L.store.sessions.push(x); save(true); render(); });
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('#study-pill.ask')) { const v = +e.target.value; if (v > 0) finish(false, v); } });

  /* ---- planned time: the timetable's slots for each day, split between modules by ECTS like the timetable does */
  function plannedMins(d) {
    const S = state.settings; if (!S) return 0;
    if (S.skip.has(iso(d))) return 0;
    const ph = S.phases.find(p => p.from <= d && d <= p.to);
    return ph ? ph.slots.filter(s => s.wd === d.getDay()).reduce((a, s) => a + s.mins, 0) : 0;
  }
  function shares() {
    const C = state.tcontent || {}, mods = [...new Set((state.tp || []).filter(t => C[t.id] && ymd(t.lectured)).map(t => t.module))];
    const sum = mods.reduce((a, m) => a + (ECTS[m] || 10), 0), out = {};
    mods.forEach(m => { out[m] = (ECTS[m] || 10) / sum; });
    return out;
  }
  function weekModel(w0, now) {
    const w1 = addDays(w0, 7), ss = L.store.sessions.filter(x => x.end >= +w0 && x.end < +w1);
    let plan = 0;
    for (let d = w0; d < w1; d = addDays(d, 1)) plan += plannedMins(d);
    const done = ss.reduce((a, x) => a + x.mins, 0), by = {};
    ss.forEach(x => { by[x.code] = (by[x.code] || 0) + x.mins; });
    return { w0, plan, done, by, ss };
  }

  function weekCard(now) {
    const W = weekModel(monday(now), now), sh = shares(), t = getT();
    const mods = [...new Set([...Object.keys(sh), ...Object.keys(W.by)])].sort((a, b) => MODS().indexOf(a) - MODS().indexOf(b));
    const pct = W.plan ? Math.min(100, 100 * W.done / W.plan) : 0;
    const max = Math.max(1, ...mods.map(m => Math.max(W.plan * (sh[m] || 0), W.by[m] || 0)));      // one scale for every module
    const rows = mods.map(m => {
      const p = W.plan * (sh[m] || 0), d = W.by[m] || 0;
      return `<div class="lg-row"><span class="lg-m">${esc(modOf(m)[0])}</span>
        <span class="lg-bar"><i style="width:${100 * d / max}%"></i>${p ? `<b style="left:${100 * p / max}%" title="Planned ${fmtMins(p)}"></b>` : ''}</span>
        <span class="lg-v">${fmtMins(d)}<small> / ${p ? fmtMins(p) : '–'}</small></span></div>`;
    }).join('');
    const opts = MODS().map(c => `<option value="${c}">${esc(modOf(c)[0])}</option>`).join('');
    return `<article class="w span2 lg-week"><div class="k"><span>This week · from ${esc(dShort(W.w0))}</span><span>${W.ss.length} session${W.ss.length === 1 ? '' : 's'}</span></div>
      <div class="lg-big"><span class="num">${fmtMins(W.done)}</span><span class="lg-of">of ${W.plan ? fmtMins(W.plan) : 'no time'} planned</span></div>
      <span class="bar lg-total"><i style="width:${pct}%"></i></span>
      <div class="lg-rows">${rows || '<div class="muted small">Nothing in the timetable this week.</div>'}</div>
      <p class="lg-key"><i></i> studied <b></b> planned, split by ECTS like your revision timetable</p>
      ${t ? '' : `<div class="lg-start"><span>Start the timer on</span><select aria-label="Module">${opts}</select><input type="text" placeholder="what (optional)" aria-label="What you're doing"><button class="btn solid" data-sp="go">Start</button></div>`}
    </article>`;
  }
  function weeksCard(now) {
    const n = 8, w0 = monday(now), W = [];
    for (let i = n - 1; i >= 0; i--) W.push(weekModel(addDays(w0, -7 * i), now));
    const max = Math.max(60, ...W.map(w => Math.max(w.plan, w.done))), H = 230;
    const bars = W.map((w, i) => {
      const x = 14 + i * 46, h = H * w.done / max, ph = H * w.plan / max;
      return `<g><title>${dShort(w.w0)}: ${fmtMins(w.done)} studied${w.plan ? ' of ' + fmtMins(w.plan) + ' planned' : ''}</title>
        <rect class="lg-b${i === n - 1 ? ' cur' : ''}" x="${x}" y="${H - h + 10}" width="28" height="${Math.max(h, 1)}" rx="5"/>
        ${w.plan ? `<line class="lg-p" x1="${x - 3}" x2="${x + 31}" y1="${H - ph + 10}" y2="${H - ph + 10}"/>` : ''}
        <text x="${x + 14}" y="${H + 28}">${w.w0.getDate()} ${MONTHS[w.w0.getMonth()]}</text></g>`;
    }).join('');
    const avg = W.slice(0, -1).filter(w => w.done).map(w => w.done);
    return `<article class="w lg-weeks"><div class="k"><span>Last 8 weeks</span><span>${avg.length ? 'avg ' + fmtMins(avg.reduce((a, b) => a + b, 0) / avg.length) + '/wk' : ''}</span></div>
      <svg viewBox="0 0 380 ${H + 36}" class="lg-svg" role="img" aria-label="Hours studied each week">${bars}</svg></article>`;
  }
  function recentCard(now) {
    const ss = L.store.sessions.slice().sort((a, b) => b.end - a.end).slice(0, 12);
    const opts = MODS().map(c => `<option value="${c}">${esc(modOf(c)[0])}</option>`).join('');
    const list = ss.map(x => {
      const d = new Date(x.end);
      return `<div class="lg-s"><span class="lg-sd">${esc(dayLabel(d, now))}${x.added ? '' : ' ' + hhmm(new Date(x.start))}</span>
        ${x.href ? `<a href="${esc(x.href)}">${esc(x.label || modOf(x.code)[0])}</a>` : `<span>${esc(x.label || modOf(x.code)[0])}</span>`}
        <b>${fmtMins(x.mins)}</b><button class="hu-x" data-sp="del" data-id="${esc(x.id)}" aria-label="Remove this session" title="Remove">✕</button></div>`;
    }).join('');
    return `<article class="w span3 lg-recent"><div class="k"><span>Sessions</span><button class="linkbtn" data-sp="add">${L.form ? 'Cancel' : '+ Add time you didn\'t time'}</button></div>
      ${L.form ? `<div class="lg-add"><select name="code" aria-label="Module">${opts}</select><input name="what" type="text" placeholder="what (optional)" aria-label="What">
        <input name="mins" type="number" min="1" value="60" aria-label="Minutes"><span>min on</span><input name="day" type="date" value="${iso(now)}" max="${iso(now)}" aria-label="Day">
        <button class="btn solid" data-sp="addsave">Add</button></div>` : ''}
      <div class="lg-list">${list || '<div class="muted small pad">No sessions yet. Press Start timer on a topic or a problem sheet, or start one above.</div>'}</div></article>`;
  }

  window.icdRevTabs = Object.assign(window.icdRevTabs || {}, {
    log(box, now) {
      if (!L.store) { ensure().then(() => render()); setHTML(box, '<article class="w wide"><div class="empty pad">Opening your study log…</div></article>'); return; }
      setHTML(box, `<div class="grid lg-grid">${weekCard(now)}${weeksCard(now)}${(window.icdLogExtra ? icdLogExtra(L.store, now) : '')}${recentCard(now)}</div>`);
      const W = weekModel(monday(now), now);
      $('#subtitle').textContent = `Year 2 · ${fmtMins(W.done)} studied this week`;
    }
  });
  window.icdStudy = { startBtn, activity, ensure, fmtMins, weekModel: now => L.store ? weekModel(monday(now), now) : null, plannedMins, store: () => L.store };
  pill();
  ensure();
})();
