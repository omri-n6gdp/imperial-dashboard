/* ---------------------------------------------------------------- past papers (Revision → Past papers)
   revision/past-papers.json (made by _meta/dev/make_past_papers.py): every paper, question by question, with marks,
   pages and the topics each question most likely tests. Attempts are kept in revision/mocks.json.
     #revision/papers                    every paper, one column per module, with your last mock score
     #revision/papers/<module>/<year>    sit it as a timed mock: the paper beside a timer, a mark box per question,
                                         then save it and (if you like) update those topics' status from how you did */
(() => {
  const P = { data: null, loading: false, mocks: null, tick: null };
  const DRAFT = k => 'icd-mock-draft-' + k, RUN = 'icd-mock-run';
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } };
  const put = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off */ } };
  const route = () => { const p = location.hash.slice(1).split('/').map(decodeURIComponent); return p[2] && p[3] ? { code: p[2], year: +p[3] } : null; };
  const paperHash = (code, year) => `#revision/papers/${encodeURIComponent(code)}/${year}`;
  const tname = id => ((state.tp || []).find(t => t.id === id) || {}).topic || id;
  const fmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + pad(m) : m) + ':' + pad(x); };

  async function ensure() {
    if (P.data || P.loading) return;
    P.loading = true;
    try {
      const [d, m] = await Promise.all([fetch(fileUrl('revision/past-papers.json'), { cache: 'no-store' }).then(r => r.ok ? r.json() : null), storeLoad('mocks')]);
      P.data = d || { modules: [] }; P.mocks = m; if (!P.mocks.attempts) P.mocks.attempts = [];
    } catch (e) { P.data = { modules: [], error: e.message }; P.mocks = { attempts: [] }; }
    P.loading = false;
    render();
  }
  const attemptsOf = (code, year) => (P.mocks.attempts || []).filter(a => a.code === code && a.year === year).sort((a, b) => b.at - a.at);

  /* ---- every paper */
  function index(now) {
    const all = P.mocks.attempts || [];
    const avg = all.length ? all.reduce((a, x) => a + 100 * x.got / x.of, 0) / all.length : null;
    /* how each topic has gone in mocks, worst first */
    const byT = new Map();
    for (const a of all) for (const q of a.qs || []) if (q.topic && q.of) { const r = byT.get(q.topic) || { got: 0, of: 0 }; r.got += q.got; r.of += q.of; byT.set(q.topic, r); }
    const weak = [...byT.entries()].map(([id, r]) => ({ id, p: 100 * r.got / r.of })).sort((a, b) => a.p - b.p).slice(0, 4);
    const top = `<article class="w wide pp-top"><div class="k"><span>Mock exams</span><span>${all.length ? `${all.length} sat` : 'none yet'}</span></div>
      <div class="pp-top-g"><div><div class="big${avg != null ? '' : ' pp-none'}">${avg != null ? pc(avg, 0) + '<small>%</small>' : '0'}</div><div class="sub">${avg != null ? 'average across your mocks' : 'Sit a paper under exam conditions: the timer runs to the real time allowed, then you mark it from the solutions.'}</div></div>
      <div class="pp-weak">${weak.length ? `<div class="need-h">Weakest topics in mocks</div>${weak.map(w => `<a class="pp-w" href="${revHash(w.id)}"><span>${esc(tname(w.id))}</span><b>${pc(w.p, 0)}%</b></a>`).join('')}` : `<div class="need-h">How it works</div><p class="muted small">Pick a year below and press <b>Sit as mock</b>. Each question is matched to the revision topics it tests; after marking you can update those topics in one go.</p>`}</div></div></article>`;
    const cols = (P.data.modules || []).map(m => {
      const papers = m.papers.map(p => {
        const last = attemptsOf(m.code, p.year)[0], sol = p.solutions, fb = p.feedback || [];
        return `<div class="pp-row">
          <div class="pp-y"><b>${p.year}</b><span>${p.qs.length} questions · ${p.marks || '?'} marks · ${pc(p.minutes / 60, 1)} h</span></div>
          <div class="pp-links"><a href="${esc(fileUrl(p.questions))}" target="_blank" rel="noopener">Paper</a>${sol ? `<a href="${esc(fileUrl(sol))}" target="_blank" rel="noopener">Solutions</a>` : '<span class="pp-nosol">no solutions</span>'}${fb.map((f, i) => `<a href="${esc(fileUrl(f))}" target="_blank" rel="noopener">Feedback${fb.length > 1 ? ' ' + (i + 1) : ''}</a>`).join('')}</div>
          <a class="btn pp-sit${last ? '' : ' solid'}" href="${paperHash(m.code, p.year)}">${last ? `${pc(100 * last.got / last.of, 0)}% · again` : 'Sit as mock'}</a></div>`;
      }).join('');
      return `<section class="w mod-col pp-col"><div class="mc-h"><b>${esc(modOf(m.code)[0])}</b><span>${esc(modOf(m.code)[1])}</span></div>${papers || '<div class="mc-none">No papers yet</div>'}</section>`;
    }).join('');
    return top + `<div class="mod-cols">${cols}</div>`;
  }

  /* ---- one paper as a mock */
  function mockShell(m, p) {
    const key = `${m.code}/${p.year}`, d = get(DRAFT(key), { scores: {}, topics: {} });
    const opts = code => (state.tp || []).filter(t => t.module === code);
    const qrow = q => {
      const cur = d.topics[q.n] !== undefined ? d.topics[q.n] : (q.topics[0] || '');
      return `<div class="pp-q" data-n="${q.n}">
        <div class="pp-qh"><b>Question ${q.n}</b><span>${q.total != null ? q.total + ' marks' : ''} · <a href="${esc(fileUrl(p.questions))}#page=${q.page}" target="pp-pdf">page ${q.page}</a>${p.solutions ? ` · <a href="${esc(fileUrl(p.solutions))}" target="_blank" rel="noopener">solutions</a>` : ''}</span></div>
        <p class="pp-qt">${esc(q.text.replace(/^\d+\.\s*/, '').slice(0, 220))}${q.text.length > 220 ? '…' : ''}</p>
        <div class="pp-qf"><label>Topic <select data-pptopic="${q.n}"><option value="">—</option>${opts(m.code).map(t => `<option value="${esc(t.id)}"${t.id === cur ? ' selected' : ''}>${esc(t.course !== modOf(t.module)[1] ? t.course + ': ' : '')}${esc(t.topic)}</option>`).join('')}</select></label>
          <label class="pp-score">Mark <input type="number" inputmode="numeric" min="0" max="${q.total || 100}" step="1" data-ppscore="${q.n}" value="${d.scores[q.n] ?? ''}" placeholder="–"><span>/ ${q.total ?? '?'}</span></label></div></div>`;
    };
    return `<article class="w wide pp-mock" data-key="${esc(key)}">
      <div class="rv-nav"><a class="btn back" href="#revision/papers">&#8592; All papers</a><span class="muted small">${esc(p.instructions || '')}</span></div>
      <div class="k"><span>${esc(modOf(m.code)[1])} · mock exam</span><span>${p.marks} marks · time allowed ${fmt(p.minutes * 60)}</span></div>
      <h2>${esc(modOf(m.code)[0])} ${p.year} paper</h2>
      <div class="pp-timer"><div class="pp-clock" data-ppclock>${fmt(p.minutes * 60)}</div><div class="pp-tbtns"></div><div class="pp-tbar"><i></i></div></div>
      <div class="pp-body"><iframe class="rv-pdf pp-pdf" name="pp-pdf" src="${esc(fileUrl(p.questions))}#view=FitH&navpanes=0" title="${esc(modOf(m.code)[0])} ${p.year} paper"></iframe>
        <div class="pp-side"><div class="pp-qs">${p.qs.map(qrow).join('')}</div><div class="pp-sum"></div></div></div></article>`;
  }
  function runOf(key) { const r = get(RUN, null); return r && r.key === key ? r : null; }
  const elapsed = r => r ? (r.spent || 0) + (r.from ? (Date.now() - r.from) / 1000 : 0) : 0;
  function drawTimer(box, p) {
    const key = box.querySelector('.pp-mock').dataset.key, r = runOf(key), left = p.minutes * 60 - elapsed(r);
    const clock = box.querySelector('[data-ppclock]');
    clock.textContent = left >= 0 ? fmt(left) : '+' + fmt(-left);
    clock.classList.toggle('over', left < 0);
    box.querySelector('.pp-tbar i').style.width = Math.min(100, 100 * elapsed(r) / (p.minutes * 60)) + '%';
    const state_ = !r ? 'new' : r.from ? 'running' : r.done ? 'done' : 'paused';
    const btns = { new: '<button class="btn solid" data-ppgo="start">Start the clock</button>',
      running: '<button class="btn" data-ppgo="pause">Pause</button><button class="btn solid" data-ppgo="finish">Pens down</button>',
      paused: '<button class="btn solid" data-ppgo="start">Carry on</button><button class="btn" data-ppgo="finish">Pens down</button><button class="btn" data-ppgo="reset">Start again</button>',
      done: `<span class="muted small">Finished in ${fmt(elapsed(r))}. Mark it from the solutions, then save.</span><button class="btn" data-ppgo="reset">Start again</button>` }[state_];
    const tb = box.querySelector('.pp-tbtns');
    if (tb.dataset.s !== state_) { tb.dataset.s = state_; tb.innerHTML = btns; }
  }
  /* the result so far, and what it would do to your topics */
  function drawSum(box, m, p) {
    const key = `${m.code}/${p.year}`, d = get(DRAFT(key), { scores: {}, topics: {} });
    const marked = p.qs.filter(q => d.scores[q.n] !== undefined && d.scores[q.n] !== '' && q.total);
    const got = marked.reduce((a, q) => a + Math.min(q.total, +d.scores[q.n]), 0), of = marked.reduce((a, q) => a + q.total, 0);
    const per = new Map();
    for (const q of marked) {
      const t = d.topics[q.n] !== undefined ? d.topics[q.n] : q.topics[0];
      if (!t) continue;
      const r = per.get(t) || { got: 0, of: 0 }; r.got += Math.min(q.total, +d.scores[q.n]); r.of += q.total; per.set(t, r);
    }
    const to = pct => pct >= 70 ? 5 : pct >= 40 ? 3 : 1;
    const chg = [...per.entries()].map(([id, r]) => ({ id, pct: 100 * r.got / r.of, v: to(100 * r.got / r.of), cur: ((state.tp || []).find(t => t.id === id) || {}).confidence }));
    box.querySelector('.pp-sum').innerHTML = `<div class="pp-total"><span>Your mark</span><b>${of ? pc(100 * got / of, 0) + '%' : '—'}</b><small>${of ? `${got} / ${of}${marked.length < p.qs.length ? ` · ${marked.length} of ${p.qs.length} questions marked` : ''}` : 'Enter your marks from the solutions'}</small></div>
      ${chg.length ? `<div class="pp-chg"><div class="need-h">Update your topics</div>${chg.map(c => `<label class="pp-c"><input type="checkbox" data-ppchg="${esc(c.id)}" data-v="${c.v}" ${c.cur === c.v ? '' : 'checked'}><span>${esc(tname(c.id))}</span><em class="t-${tStatus(c.v)[0]}">${pc(c.pct, 0)}% → ${esc(tStatus(c.v)[1])}</em></label>`).join('')}</div>` : ''}
      <div class="dl-btns"><button class="btn solid" data-ppgo="save"${marked.length ? '' : ' disabled'}>Save this attempt${chg.length ? ' and update ticked topics' : ''}</button></div>`;
  }
  function mock(box, now) {
    const r = route(), m = (P.data.modules || []).find(x => x.code === r.code), p = m && m.papers.find(x => x.year === r.year);
    if (!p) { setHTML(box, `<article class="w wide"><div class="empty pad">That paper isn't in your folder. <a href="#revision/papers">All papers</a></div></article>`); return; }
    const key = `${m.code}/${p.year}`;
    if (!box.querySelector(`.pp-mock[data-key="${CSS.escape(key)}"]`)) { box._html = null; box.innerHTML = mockShell(m, p); drawSum(box, m, p); }
    drawTimer(box, p);
    clearInterval(P.tick);
    P.tick = setInterval(() => { if (!document.body.contains(box) || !route()) return clearInterval(P.tick); drawTimer(box, p); }, 1000);
    $('#subtitle').textContent = `Mock · ${modOf(m.code)[0]} ${p.year}`;
  }

  window.icdRevTabs = Object.assign(window.icdRevTabs || {}, {
    papers(box, now) {
      if (!P.data) { ensure(); setHTML(box, '<article class="w wide"><div class="empty pad">Opening your past papers…</div></article>'); return; }
      if (route()) return mock(box, now);
      clearInterval(P.tick);
      setHTML(box, index(now));
      $('#subtitle').textContent = `Year 2 · ${(P.data.modules || []).reduce((a, m) => a + m.papers.length, 0)} past papers`;
    }
  });

  /* ---- clicks and typing */
  const cur = () => { const r = route(); const m = r && P.data && P.data.modules.find(x => x.code === r.code); return m ? { m, p: m.papers.find(x => x.year === r.year), key: `${r.code}/${r.year}` } : null; };
  document.addEventListener('input', e => {
    const s = e.target.closest('[data-ppscore]'), t = e.target.closest('[data-pptopic]');
    if (!s && !t) return;
    const c = cur(); if (!c) return;
    const d = get(DRAFT(c.key), { scores: {}, topics: {} });
    if (s) { const q = c.p.qs.find(q => String(q.n) === s.dataset.ppscore), v = s.value === '' ? '' : Math.max(0, Math.min(q.total || 100, Math.round(+s.value))); if (v === '') delete d.scores[q.n]; else d.scores[q.n] = v; }
    if (t) d.topics[t.dataset.pptopic] = t.value;
    put(DRAFT(c.key), d);
    drawSum(e.target.closest('.rv-tabview'), c.m, c.p);
  });
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-ppgo]');
    if (!b) return;
    const c = cur(); if (!c) return;
    const box = b.closest('.rv-tabview'), r = runOf(c.key) || { key: c.key, spent: 0, from: null };
    const go = b.dataset.ppgo;
    if (go === 'start') { r.from = Date.now(); r.done = false; put(RUN, r); }
    if (go === 'pause') { r.spent = elapsed(r); r.from = null; put(RUN, r); }
    if (go === 'finish') { r.spent = elapsed(r); r.from = null; r.done = true; put(RUN, r); }
    if (go === 'reset') { put(RUN, null); }
    if (go === 'save') {
      const d = get(DRAFT(c.key), { scores: {}, topics: {} });
      const qs = c.p.qs.filter(q => d.scores[q.n] !== undefined && q.total).map(q => ({ n: q.n, got: Math.min(q.total, +d.scores[q.n]), of: q.total, topic: (d.topics[q.n] !== undefined ? d.topics[q.n] : q.topics[0]) || null }));
      const got = qs.reduce((a, q) => a + q.got, 0), of = qs.reduce((a, q) => a + q.of, 0);
      const run = runOf(c.key);
      P.mocks.attempts.push({ at: Date.now(), date: iso(new Date()), code: c.m.code, year: c.p.year, seconds: Math.round(elapsed(run)), minutes: c.p.minutes, got, of, qs });
      await storeSave('mocks', P.mocks);
      if (window.icdStudy) icdStudy.activity('m');
      const ticks = [...box.querySelectorAll('[data-ppchg]:checked')];
      let n = 0;
      for (const x of ticks) {
        try { await getJSON('/api/topic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: x.dataset.ppchg, confidence: +x.dataset.v, reviewed: true }) }); n++; } catch (err) { /* left as it was */ }
      }
      put(DRAFT(c.key), null); put(RUN, null);
      toast(`Saved: ${modOf(c.m.code)[0]} ${c.p.year}, ${pc(100 * got / of, 0)}%${n ? ` · ${n} topic${n > 1 ? 's' : ''} updated` : ''}`);
      if (n) loadTopics();
      location.hash = 'revision/papers';
      return;
    }
    drawTimer(box, c.p);
  });
})();
