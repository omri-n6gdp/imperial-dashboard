/* ---------------------------------------------------------------- flashcards (Revision → Flashcards)
   Cards are made from revision/topics.md for every topic that has been lectured:
     - each key equation: its name on the front, the equation on the back
     - each main point with maths in it: the point with its main formula hidden, then the whole point
   Spaced repetition (like Anki's SM-2): Again / Hard / Good / Easy set when a card comes back; up to 15 new cards
   a day, reviews as they fall due. The schedule is kept in revision/flashcards.json.
   Keys while studying: Space shows the answer, 1-4 grade it. */
(() => {
  const NEW_PER_DAY = 15, DAYMS = 864e5;
  const C = { store: null, loading: false, queue: null, cur: null, shown: false, done: 0, mod: '' };
  const hash = s => { let h = 5381; for (const c of String(s)) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
  const today = () => iso(new Date());
  const addD = (isoDay, n) => iso(addDays(ymd(isoDay), n));

  async function ensure() {
    if (C.store || C.loading || !state.tcontent) return;
    C.loading = true;
    const s = await storeLoad('flashcards');
    s.cards = s.cards || {}; s.days = s.days || {};
    C.store = s; C.loading = false;
    try { C.mod = localStorage.getItem('icd-cards-mod') || ''; } catch (e) { /* storage off */ }
    render();
  }

  /* every card that can be studied now: topics lectured so far, with content */
  function allCards() {
    const out = [], T = state.tcontent || {};
    for (const t of state.tp || []) {
      const c = T[t.id];
      if (!c || topicAhead(t)) continue;
      for (const e of c.eqs) out.push({ id: `${t.id}/e/${hash(e.label)}`, t, kind: 'eq', front: e.label, back: e.tex });
      for (const p of c.points) {
        const ms = [...p.matchAll(/\$([^$]+)\$/g)];
        if (!ms.length) continue;
        const m = ms.reduce((a, b) => (b[1].length > a[1].length ? b : a));      // hide the biggest formula
        out.push({ id: `${t.id}/p/${hash(p)}`, t, kind: 'gap', front: p.slice(0, m.index) + '@@GAP@@' + p.slice(m.index + m[0].length), back: p, gap: m[0] });
      }
    }
    return out;
  }
  const inMod = c => !C.mod || c.t.module === C.mod;
  function counts(cards) {
    const d = today(), S = C.store.cards, newToday = C.store.days[d] || 0;
    const due = cards.filter(c => S[c.id] && S[c.id].due <= d).length, fresh = cards.filter(c => !S[c.id]).length;
    return { due, fresh, newLeft: Math.max(0, Math.min(fresh, NEW_PER_DAY - newToday)), seen: cards.filter(c => S[c.id]).length, total: cards.length };
  }
  function buildQueue() {
    const d = today(), S = C.store.cards, cards = allCards().filter(inMod), n = counts(cards);
    const due = cards.filter(c => S[c.id] && S[c.id].due <= d).sort((a, b) => S[a.id].due.localeCompare(S[b.id].due));
    /* new cards in teaching order (topics as listed), a few from each module so one course doesn't take the whole day */
    const fresh = cards.filter(c => !S[c.id]), byMod = new Map();
    for (const c of fresh) { if (!byMod.has(c.t.module)) byMod.set(c.t.module, []); byMod.get(c.t.module).push(c); }
    const picked = [];
    while (picked.length < n.newLeft && [...byMod.values()].some(l => l.length)) for (const l of byMod.values()) if (l.length && picked.length < n.newLeft) picked.push(l.shift());
    /* mix new cards in among the reviews */
    const q = [];
    while (due.length || picked.length) { if (due.length) q.push(due.shift()); if (due.length) q.push(due.shift()); if (picked.length) q.push(picked.shift()); }
    return q;
  }

  /* SM-2 style: ease starts at 2.5; Again resets and comes back in this session */
  function next(st, g) {
    st = Object.assign({ ivl: 0, ease: 2.5, reps: 0, lapses: 0 }, st || {});
    if (g === 1) { st.lapses++; st.reps = 0; st.ivl = 0; st.ease = Math.max(1.3, st.ease - .2); }
    else {
      if (g === 2) { st.ivl = Math.max(1, Math.round((st.ivl || 1) * 1.2)); st.ease = Math.max(1.3, st.ease - .15); }
      if (g === 3) st.ivl = st.reps === 0 ? 1 : st.reps === 1 ? 3 : Math.round(st.ivl * st.ease);
      if (g === 4) { st.ivl = st.reps === 0 ? 3 : Math.round(Math.max(st.ivl, 1) * st.ease * 1.3); st.ease += .15; }
      st.reps++;
    }
    st.due = addD(today(), st.ivl);
    st.last = today();
    return st;
  }
  const ivlTxt = n => n === 0 ? 'now' : n === 1 ? '1 day' : n < 30 ? n + ' days' : n < 365 ? Math.round(n / 30) + ' mo' : Math.round(n / 365) + ' y';

  function grade(g) {
    const c = C.cur; if (!c || !C.shown) return;
    const wasNew = !C.store.cards[c.id];
    C.store.cards[c.id] = next(C.store.cards[c.id], g);
    if (wasNew) C.store.days[today()] = (C.store.days[today()] || 0) + 1;
    if (g === 1) C.queue.splice(Math.min(C.queue.length, 4), 0, c);        // see it again in a few cards
    C.done++;
    C.cur = C.queue.shift() || null; C.shown = false;
    storeSave('flashcards', C.store, false);
    if (window.icdStudy) icdStudy.activity('c');
    draw(document.querySelector('.rv-tabview[data-tab="cards"]'));
  }

  /* ---- drawing */
  const face = (c, side) => {
    const mod = `<span class="fc-from"><a href="${revHash(c.t.id)}">${esc(modOf(c.t.module)[0])} · ${esc(c.t.topic)}</a></span>`;
    if (c.kind === 'eq') return side === 'front' ? `<div class="fc-q">${esc(c.front)}</div><div class="fc-hint">Write it down, then show the answer</div>${mod}`
      : `<div class="fc-q small">${esc(c.front)}</div><div class="fc-a">$$${esc(c.back)}$$</div>${mod}`;
    if (side === 'front') return `<div class="fc-p">${mdHTML(c.front).replace('@@GAP@@', '<span class="fc-gap">?</span>')}</div><div class="fc-hint">What goes in the gap?</div>${mod}`;
    return `<div class="fc-p">${mdHTML(c.back.replace(c.gap, '@@HL@@')).replace('@@HL@@', `<mark class="fc-hl">${esc(c.gap)}</mark>`)}</div>${mod}`;
  };
  function home(box) {
    const all = allCards(), cards = all.filter(inMod), n = counts(cards), streak = (() => { let k = 0; for (let d = today(); C.store.days[d] || Object.values(C.store.cards).some(s => s.last === d); d = addD(d, -1)) k++; return k; })();
    const mods = [...new Set(all.map(c => c.t.module))];
    const left = n.due + n.newLeft;
    const learned = Object.values(C.store.cards).filter(s => s.ivl >= 21).length;
    return `<article class="w wide fc-home"><div class="wk-head"><div class="k"><span>Flashcards</span><span>${n.total} cards from ${new Set(cards.map(c => c.t.id)).size} lectured topics</span></div>
        <div class="pill-switch fc-mods">${[['', 'All'], ...mods.map(m => [m, modOf(m)[0]])].map(([k, l]) => `<button data-fcmod="${k}" class="${C.mod === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div></div>
      <div class="fc-stats"><div><b>${n.due}</b><span>due for review</span></div><div><b>${n.newLeft}</b><span>new today</span></div><div><b>${n.seen}</b><span>seen so far</span></div><div><b>${learned}</b><span>solid (21+ days)</span></div><div><b>${streak}</b><span>day streak</span></div></div>
      ${left ? `<button class="btn solid fc-start" data-fcgo="start">Start · about ${Math.max(1, Math.round(left * 12 / 60))} min</button>` : `<div class="empty">All done for today${n.fresh ? ` (${n.fresh} new cards wait for tomorrow)` : ''}.</div>`}
      <p class="tt-note">Cards come from the key equations and main points in <code>revision/topics.md</code>, for topics that have been lectured. Up to ${NEW_PER_DAY} new cards a day; each card comes back when you're about to forget it.</p></article>`;
  }
  function draw(box) {
    if (!box) return;
    if (!C.queue) { setHTML(box, home(box)); return; }
    const c = C.cur, total = C.done + C.queue.length + (c ? 1 : 0);
    if (!c) { C.queue = null; toast(`Done: ${C.done} card${C.done === 1 ? '' : 's'}.`); return draw(box); }
    const st = C.store.cards[c.id];
    const btns = [[1, 'Again'], [2, 'Hard'], [3, 'Good'], [4, 'Easy']].map(([g, l]) => `<button class="btn fc-g g${g}" data-fcgrade="${g}"><b>${l}</b><small>${ivlTxt(next(st, g).ivl)}</small><kbd>${g}</kbd></button>`).join('');
    box._html = null;
    box.innerHTML = `<article class="w wide fc-study"><div class="fc-top"><button class="btn" data-fcgo="stop">&#8592; Stop</button>
        <div class="fc-prog"><i style="width:${100 * C.done / Math.max(1, total)}%"></i></div><span>${C.done} / ${total}</span></div>
      <div class="fc-card${C.shown ? ' shown' : ''}">${!st ? '<span class="fc-new">New</span>' : ''}${face(c, C.shown ? 'back' : 'front')}</div>
      <div class="fc-acts">${C.shown ? btns : '<button class="btn solid fc-show" data-fcgo="show">Show answer <kbd>Space</kbd></button>'}</div></article>`;
    typeset(box);
  }

  window.icdRevTabs = Object.assign(window.icdRevTabs || {}, {
    cards(box) {
      if (!C.store) { ensure(); setHTML(box, '<article class="w wide"><div class="empty pad">Shuffling your cards…</div></article>'); return; }
      if (C.queue) return;            // studying: the card stays put while the page refreshes around it
      draw(box);
      $('#subtitle').textContent = 'Year 2 · flashcards';
    }
  });
  /* for the heads-up strip on Home */
  window.icdCardsDue = () => {
    if (!C.store) { if (state.tcontent) ensure(); return 0; }
    const n = counts(allCards());
    return n.due + n.newLeft;
  };

  document.addEventListener('click', e => {
    const box = e.target.closest('.rv-tabview[data-tab="cards"]');
    if (!box) return;
    const m = e.target.closest('[data-fcmod]');
    if (m) { C.mod = m.dataset.fcmod; try { localStorage.setItem('icd-cards-mod', C.mod); } catch (err) { /* storage off */ } return draw(box); }
    const g = e.target.closest('[data-fcgrade]');
    if (g) return grade(+g.dataset.fcgrade);
    const go = e.target.closest('[data-fcgo]');
    if (!go) return;
    if (go.dataset.fcgo === 'start') { C.queue = buildQueue(); C.cur = C.queue.shift() || null; C.shown = false; C.done = 0; }
    if (go.dataset.fcgo === 'show') C.shown = true;
    if (go.dataset.fcgo === 'stop') { C.queue = null; C.cur = null; }
    draw(box);
  });
  document.addEventListener('keydown', e => {
    if (!C.queue || !C.cur || /^(input|textarea|select)$/i.test(e.target.tagName) || e.metaKey || e.ctrlKey) return;
    const box = document.querySelector('.rv-tabview[data-tab="cards"]');
    if (!box) return;
    if (e.key === ' ' && !C.shown) { e.preventDefault(); C.shown = true; draw(box); }
    else if (C.shown && /^[1-4]$/.test(e.key)) { e.preventDefault(); grade(+e.key); }
  });
  /* leaving the tab ends the session (what you graded is already saved) */
  addEventListener('hashchange', () => { if (!/^#revision\/cards/.test(location.hash)) { C.queue = null; C.cur = null; } });
})();
