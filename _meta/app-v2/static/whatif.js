/* ---------------------------------------------------------------- grade what-if (Marks page)
   Uses the same year model as the rest of the Marks page (yearModel in app.js): every piece of work with its share
   of the year, what is already marked, and what still counts. For each module there is a slider for the coursework
   still to be marked and one for its exam (Maths Methods: assumed all exam until its assessment is published).
   Work that scores 100% for taking part (Quantum seminars) is counted at 100%, and pass/fail Space Mining never counts.
   Shows the year mark those guesses give, each module's mark, and the average you'd need across your exams for each
   boundary given the coursework guesses. Slider positions are kept in this browser. */
(() => {
  const KEY = 'icd-whatif';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const store = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* storage off */ } };
  let vals = load();
  const isExam = x => x.it.kind === 'exam' || /assessment TBC/.test(x.it.name || '');

  /* one row per module and part that still has marks to come */
  function rows(Y) {
    const by = new Map();
    for (const x of Y.counted) {
      if (x.frac != null || x.auto) continue;
      const code = x.mod.code, part = isExam(x) ? 'exam' : 'cw', key = code + '/' + part;
      if (!by.has(key)) by.set(key, { key, code, part, short: (MOD_NAMES[code] || [x.mod.short])[0], w: 0, n: 0 });
      const r = by.get(key); r.w += x.yw; r.n++;
    }
    const order = Object.keys(ECTS);
    return [...by.values()].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code) || (a.part === 'cw' ? -1 : 1));
  }
  /* a sensible starting guess: your average in that module so far, else your overall average, else 70 */
  function guess(Y, code) {
    const m = Y.counted.filter(x => x.mod.code === code && x.frac != null && !x.auto);
    const w = m.reduce((a, x) => a + x.yw, 0);
    if (w) return Math.round(100 * m.reduce((a, x) => a + x.yw * x.frac, 0) / w);
    return Y.avg != null ? Math.round(Y.avg) : 70;
  }
  function model(Y, R) {
    const autoLeft = Y.counted.filter(x => x.frac == null && x.auto).reduce((a, x) => a + x.yw, 0);
    let year = Y.banked + autoLeft, cwW = 0, cwPts = 0, exW = 0;
    for (const r of R) {
      const v = vals[r.key] ?? r.def;
      year += r.w * v / 100;
      if (r.part === 'exam') exW += r.w; else { cwW += r.w; cwPts += r.w * v / 100; }
    }
    /* each module's mark: banked + automatic + guesses, over the module's share */
    const mods = {};
    for (const code of Object.keys(ECTS)) {
      const xs = Y.counted.filter(x => x.mod.code === code), share = xs.reduce((a, x) => a + x.yw, 0);
      if (!share) continue;
      let got = xs.filter(x => x.frac != null).reduce((a, x) => a + x.yw * x.frac, 0) + xs.filter(x => x.frac == null && x.auto).reduce((a, x) => a + x.yw, 0);
      for (const r of R.filter(r => r.code === code)) got += r.w * (vals[r.key] ?? r.def) / 100;
      mods[code] = 100 * got / share;
    }
    const examNeed = g => exW ? 100 * (g - Y.banked - autoLeft - cwPts) / exW : null;
    return { year, mods, examNeed, exW, cwW };
  }
  const band = v => v >= 85 ? "Dean's List" : v >= 70 ? 'First' : v >= 60 ? '2:1' : v >= 50 ? '2:2' : 'Below a 2:2';
  const needTxt = n => n == null ? '—' : n > 100 ? 'out of reach' : n <= 0 ? 'secured' : pc(n, 0) + '%';

  function html(Y) {
    const R = rows(Y).map(r => Object.assign(r, { def: guess(Y, r.code) }));
    if (!R.length) return '';
    const M = model(Y, R);
    const slider = r => {
      const v = vals[r.key] ?? r.def;
      return `<div class="wi-row" data-wi="${esc(r.key)}">
        <div class="wi-l"><b>${esc(r.short)}</b><span>${r.part === 'exam' ? (r.code === 'PHYS50007' ? 'Exam (assessment TBC)' : r.n > 1 ? `${r.n} exams` : 'Exam') : `Coursework left · ${r.n} piece${r.n > 1 ? 's' : ''}`} · ${pc(r.w, 1)}% of the year</span></div>
        <input type="range" min="0" max="100" step="1" value="${v}" aria-label="${esc(r.short)} ${r.part === 'exam' ? 'exam' : 'coursework'} mark">
        <output>${v}%</output></div>`;
    };
    const modRows = Object.entries(M.mods).map(([c, v]) => `<div class="wi-m" data-wim="${c}"><span>${esc((MOD_NAMES[c] || [c])[0])}</span><b>${pc(v, 0)}%</b></div>`).join('');
    return `<article class="w wide wi" id="whatif">
      <div class="wk-head"><div class="k"><span>What if…</span><span>Drag to try out marks for everything still to come</span></div>
        <div class="pills"><button class="btn" data-wireset="avg">My averages</button><button class="btn" data-wireset="70">All 70%</button></div></div>
      <div class="wi-grid">
        <div class="wi-sliders">${R.map(slider).join('')}</div>
        <div class="wi-out">
          <div class="wi-year"><span>Your year mark would be</span><b data-wiyear>${pc(M.year, 1)}%</b><em data-wiband>${band(M.year)}</em></div>
          <div class="wi-mods">${modRows}</div>
          <div class="wi-need"><div class="need-h">With that coursework, your exams would need to average</div>
            ${[[60, '2:1'], [70, 'First'], [85, "Dean's List"]].map(([g, n]) => `<div class="need-c r${g}"><span>${esc(n)} · ${g}%</span><b data-wineed="${g}">${needTxt(M.examNeed(g))}</b></div>`).join('')}</div>
          <p class="wi-note">Exams are ${pc(M.exW, 0)}% of the year and the coursework still to come is ${pc(M.cwW, 0)}%. Already marked: ${pc(Y.markedW, 1)}%. Space Mining is pass/fail and doesn't count.</p>
        </div>
      </div></article>`;
  }
  /* live update while dragging, without redrawing the page */
  function update(card) {
    const Y = yearModel(buildMarks(state.gr)), R = rows(Y).map(r => Object.assign(r, { def: guess(Y, r.code) })), M = model(Y, R);
    card.querySelector('[data-wiyear]').textContent = pc(M.year, 1) + '%';
    card.querySelector('[data-wiband]').textContent = band(M.year);
    for (const [c, v] of Object.entries(M.mods)) { const el = card.querySelector(`[data-wim="${c}"] b`); if (el) el.textContent = pc(v, 0) + '%'; }
    card.querySelectorAll('[data-wineed]').forEach(el => { el.textContent = needTxt(M.examNeed(+el.dataset.wineed)); });
  }
  document.addEventListener('input', e => {
    const row = e.target.closest('.wi-row');
    if (!row) return;
    vals[row.dataset.wi] = +e.target.value;
    row.querySelector('output').textContent = e.target.value + '%';
    store(vals);
    update(row.closest('.wi'));
  });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-wireset]');
    if (!b) return;
    if (b.dataset.wireset === 'avg') vals = {};
    else { const Y = yearModel(buildMarks(state.gr)); vals = {}; rows(Y).forEach(r => { vals[r.key] = +b.dataset.wireset; }); }
    store(vals);
    render();
  });
  window.icdWhatIf = Y => html(Y);
})();
