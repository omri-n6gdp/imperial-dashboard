/* ---------------------------------------------------------------- activity grid and term recap (Revision → Log)
   One square per day of the year, coloured by how much you did: minutes timed, question parts and topics marked,
   flashcards, mocks. Days before the study log existed are filled in from what the files already record (the day
   each topic was last marked, flashcard and mock dates). Below it, the term so far in numbers: hours, parts done,
   topics known, cards, mocks, best streak, top module, busiest day. Drawn into the Log tab (study.js). */
(() => {
  const DAYMS = 864e5, YEAR0 = new Date(2026, 8, 28), YEAR1 = new Date(2027, 6, 16);
  const R = { mocks: null, cards: null, loading: false };
  const monday = d => { const x = dayStart(d); return addDays(x, -((x.getDay() + 6) % 7)); };
  const fm = m => (window.icdStudy ? icdStudy.fmtMins(m) : Math.round(m) + 'm');

  function ensure() {
    if (R.loading || (R.mocks && R.cards)) return;
    R.loading = true;
    Promise.all([storeLoad('mocks'), storeLoad('flashcards')]).then(([m, c]) => { R.mocks = m || {}; R.cards = c || {}; R.loading = false; render(); });
  }

  /* what was done each day: { mins, q, t, c, m, by: {module: mins} } */
  function days(store) {
    const D = new Map(), at = k => { if (!D.has(k)) D.set(k, { mins: 0, q: 0, t: 0, c: 0, m: 0, by: {} }); return D.get(k); };
    for (const s of store.sessions || []) { const d = at(iso(new Date(s.end))); d.mins += s.mins; d.by[s.code] = (d.by[s.code] || 0) + s.mins; }
    for (const [k, a] of Object.entries(store.acts || {})) { const d = at(k); d.q += a.q || 0; d.t += a.t || 0; d.c += a.c || 0; d.m += a.m || 0; }
    /* filling in from the files: never more than the log already counted, so nothing is counted twice */
    const tN = {}, cN = {}, mN = {};
    (state.tp || []).forEach(t => { if (t.last_reviewed) tN[t.last_reviewed] = (tN[t.last_reviewed] || 0) + 1; });
    if (R.cards) {
      Object.values(R.cards.cards || {}).forEach(c => { if (c.last) cN[c.last] = (cN[c.last] || 0) + 1; });
      Object.entries(R.cards.days || {}).forEach(([k, n]) => { cN[k] = Math.max(cN[k] || 0, n); });
    }
    if (R.mocks) (R.mocks.attempts || []).forEach(a => { if (a.date) mN[a.date] = (mN[a.date] || 0) + 1; });
    for (const [k, n] of Object.entries(tN)) { const d = at(k); d.t = Math.max(d.t, n); }
    for (const [k, n] of Object.entries(cN)) { const d = at(k); d.c = Math.max(d.c, n); }
    for (const [k, n] of Object.entries(mN)) { const d = at(k); d.m = Math.max(d.m, n); }
    return D;
  }
  const score = d => !d ? 0 : d.mins + 4 * d.q + 6 * d.t + d.c + 30 * d.m;
  const level = s => s <= 0 ? 0 : s < 20 ? 1 : s < 50 ? 2 : s < 100 ? 3 : 4;
  function what(d) {
    if (!d || !score(d)) return 'nothing logged';
    return [d.mins && fm(d.mins) + ' timed', d.q && `${d.q} question part${d.q > 1 ? 's' : ''} marked`, d.t && `${d.t} topic${d.t > 1 ? 's' : ''} marked`,
      d.c && `${d.c} flashcard${d.c > 1 ? 's' : ''}`, d.m && `${d.m} mock${d.m > 1 ? 's' : ''}`].filter(Boolean).join(', ');
  }
  function streaks(D, now) {
    const today = dayStart(now);
    let best = 0, run = 0, bestEnd = null;
    for (let d = YEAR0; d <= today; d = addDays(d, 1)) {
      if (score(D.get(iso(d)))) { run++; if (run > best) { best = run; bestEnd = d; } } else run = 0;
    }
    let cur = 0, d = score(D.get(iso(today))) ? today : addDays(today, -1);       // today still counts until midnight
    while (score(D.get(iso(d)))) { cur++; d = addDays(d, -1); }
    return { cur, best, bestEnd };
  }

  function grid(D, now) {
    const w0 = monday(YEAR0), weeks = Math.ceil((YEAR1 - w0) / DAYMS / 7), today = dayStart(now), C = 13, G = 3, top = 18, left = 28;
    let cells = '', months = '';
    let lastM = -1;
    for (let w = 0; w < weeks; w++) {
      const ws = addDays(w0, w * 7);
      const firstOfMonth = [...Array(7)].map((_, i) => addDays(ws, i)).find(d => d.getDate() === 1);
      if (firstOfMonth && firstOfMonth.getMonth() !== lastM) { lastM = firstOfMonth.getMonth(); months += `<text class="hm-m" x="${left + w * (C + G)}" y="11">${MONTHS[lastM]}</text>`; }
      else if (w === 0) { lastM = ws.getMonth(); months += `<text class="hm-m" x="${left}" y="11">${MONTHS[YEAR0.getMonth()]}</text>`; }
      for (let i = 0; i < 7; i++) {
        const d = addDays(ws, i);
        if (d < YEAR0 || d > YEAR1) continue;
        const k = iso(d), x = D.get(k), fut = d > today, lv = fut ? 0 : level(score(x));
        cells += `<rect class="hm l${lv}${fut ? ' fut' : ''}${+d === +today ? ' now' : ''}" x="${left + w * (C + G)}" y="${top + i * (C + G)}" width="${C}" height="${C}" rx="3"><title>${dShort(d)}: ${fut ? 'to come' : what(x)}</title></rect>`;
      }
    }
    const lab = ['Mon', '', 'Wed', '', 'Fri', '', 'Sun'].map((l, i) => l ? `<text class="hm-d" x="0" y="${top + i * (C + G) + 10}">${l}</text>` : '').join('');
    const W = left + weeks * (C + G), H = top + 7 * (C + G);
    return `<svg class="hm-svg" viewBox="0 0 ${W} ${H}" style="min-width:${W}px" role="img" aria-label="Your study activity, one square per day">${months}${lab}${cells}</svg>`;
  }

  /* the term in numbers */
  function termOf(now) {
    const terms = [['Autumn term', new Date(2026, 8, 28), new Date(2026, 11, 11)], ['Spring term', new Date(2027, 0, 4), new Date(2027, 2, 19)],
      ['Summer term', new Date(2027, 3, 26), new Date(2027, 6, 16)]];
    const t = dayStart(now);
    return terms.find(x => t <= x[2]) || terms[terms.length - 1];
  }
  function recap(D, store, now) {
    const [name, from, to] = termOf(now), end = dayStart(now) < to ? dayStart(now) : to, over = dayStart(now) > to;
    const inT = k => { const d = ymd(k); return d && d >= from && d <= end; };
    let mins = 0, q = 0, cards = 0, active = 0, busiest = null;
    const by = {};
    for (const [k, d] of D) {
      if (!inT(k)) continue;
      mins += d.mins; q += d.q; cards += d.c;
      if (score(d)) active++;
      if (!busiest || score(d) > score(busiest[1])) busiest = [k, d];
      for (const [m, v] of Object.entries(d.by)) by[m] = (by[m] || 0) + v;
    }
    const topMod = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
    /* parts done across your sheets, topics by how well you know them */
    const qs = { done: 0, total: 0 };
    (state.ov && state.ov.sheets || []).forEach(s => { if (s.questions) { qs.done += s.questions.done || 0; qs.total += s.questions.total || 0; } });
    const M = typeof revModel === 'function' && state.tp ? revModel(now) : null;
    const marked = (state.tp || []).filter(t => inT(t.last_reviewed)).length;
    const mocks = (R.mocks && R.mocks.attempts || []).filter(a => inT(a.date));
    const bestMock = mocks.length ? Math.max(...mocks.map(a => a.of ? 100 * a.got / a.of : 0)) : null;
    const S = streaks(D, now), days = Math.round((end - from) / DAYMS) + 1;
    const tile = (big, label, sub) => `<div class="rc-t"><b>${big}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
    return `<article class="w span3 rc"><div class="k"><span>${esc(name)} ${over ? 'recap' : 'so far'}</span><span>${dShort(from)} – ${dShort(to)}${over ? '' : ` · ${Math.max(0, Math.round((to - dayStart(now)) / DAYMS))} days left`}</span></div>
      <div class="rc-grid">
        ${tile(mins ? fm(mins) : '0m', 'studied with the timer', mins ? `${fm(mins / Math.max(1, Math.ceil(days / 7)))} a week on average` : 'start the timer on a topic or sheet')}
        ${tile(`${qs.done}<small>/${qs.total}</small>`, 'question parts done', q ? `${q} marked since the log started` : '')}
        ${tile(M ? `${M.tot.ok}<small>/${M.tot.total}</small>` : '–', 'topics you know', M ? `${M.tot.sh} shaky · ${M.tot.dk} don't know${marked ? ` · ${marked} marked this term` : ''}` : '')}
        ${tile(`${active}<small>/${days}</small>`, 'days you studied', `best streak ${S.best} day${S.best === 1 ? '' : 's'}${S.cur > 1 ? ` · now on ${S.cur}` : ''}`)}
        ${tile(cards || 0, 'flashcards reviewed', R.cards ? `${Object.keys(R.cards.cards || {}).length} cards learnt so far` : '')}
        ${tile(mocks.length, `mock${mocks.length === 1 ? '' : 's'} done`, bestMock != null ? `best ${Math.round(bestMock)}%` : 'Revision → Past papers')}
        ${tile(topMod ? esc(modOf(topMod[0])[0]) : '–', 'most time on', topMod ? fm(topMod[1]) : 'nothing timed yet')}
        ${tile(busiest && score(busiest[1]) ? esc(dShort(ymd(busiest[0]))) : '–', 'busiest day', busiest && score(busiest[1]) ? esc(what(busiest[1])) : '')}
      </div></article>`;
  }

  window.icdLogExtra = (store, now) => {
    ensure();
    const D = days(store), S = streaks(D, now);
    let total = 0;
    for (const [k, d] of D) if (score(d) && ymd(k) >= YEAR0) total++;
    return `<article class="w span3 hm-card"><div class="k"><span>Your year, day by day</span><span>${S.cur ? `${S.cur}-day streak` : 'no streak yet'} · best ${S.best}</span></div>
      <div class="hm-wrap">${grid(D, now)}</div>
      <div class="hm-key"><span>${total} active day${total === 1 ? '' : 's'} so far</span><span class="hm-scale">Less ${[0, 1, 2, 3, 4].map(l => `<i class="l${l}"></i>`).join('')} More</span></div></article>` + recap(D, store, now);
  };
})();
