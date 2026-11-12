/* ---------------------------------------------------------------- search
   The pill beside the nav. One box finds:
     - revision topics (title, course, main points, key equations)       -> the topic on the Revision page
     - problem-sheet questions (the question text itself)                 -> that question on its sheet
     - deadlines (marked work, as on the Deadlines page)                  -> that deadline, opened
     - text inside your files: lecture notes, slides, summaries, past papers, sheets and readings
       (the .txt copy beside each PDF, so a hit opens the PDF at its page)
   It all runs in the page: topics, deadlines and the sheet list are already loaded; the question files and
   the text copies are fetched the first time you open search (about 9 MB, read from this Mac).
   Keys: / or Cmd-K to search, Up/Down to move, Enter to open, Esc to close. */
(() => {
  const S = { qs: null, qsAt: 0, files: null, filesP: null, qsP: null, q: '', rows: [], act: -1, more: false, open: false, vocab: null, vocabKey: '', exact: null };
  const bar = $('.navbar'), box = $('.search'), input = $('#q'), panel = $('#sr');

  /* lower-case and drop accents without changing the length, so positions in the folded text match the original */
  const fold = s => String(s || '').toLowerCase().replace(/[À-ɏ]/g, c => c.normalize('NFD')[0]);
  const termsOf = q => fold(q).split(/\s+/).filter(Boolean);
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const plain = md => String(md || '').replace(/\$\$([\s\S]+?)\$\$/g, ' $1 ').replace(/\*\*|__|`/g, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ');

  /* ---------------- what there is to search */
  async function loadQuestions() {
    const sheets = ((state.ov && state.ov.sheets) || []).filter(s => s.questions && s.questions.total);
    const out = [];
    await Promise.all(sheets.map(async s => {
      try {
        const r = await getJSON(`/api/sheet/${encodeURIComponent(s.module)}/${encodeURIComponent(s.id)}`);
        const secs = r.sections || [];
        secs.forEach((sec, i) => {
          const q = sec.q || (secs.slice(i + 1).find(x => x.q && String(x.q.n).startsWith(sec.key)) || {}).q;
          if (!q) return;
          const label = String(sec.q ? (q.label || q.n) : String(q.label || q.n).replace(/[a-h]$/, ''));
          const topic = q.topic || '';
          out.push({ code: s.module, id: s.id, key: sec.key, label, topic, md: sec.md || '', status: sec.q ? q.status : null,
            sheet: sheetLabel(s), mod: modOf(s.module)[0], tl: fold(topic), text: fold(`${topic} ${label} ${plain(sec.md)}`) });
        });
      } catch (e) { /* a sheet that won't open is simply left out */ }
    }));
    S.qs = out; S.qsAt = Date.now();
  }

  const KIND = [[/lecture-summaries\//, 'Lecture summary', 0], [/\/notes\//, 'Notes', 0], [/\/slides\//, 'Slides', 1], [/\/lectures\//, 'Lecture', 1],
    [/past-papers\/.*(solution|answer|feedback)/i, 'Past paper solutions', 2], [/past-papers\//, 'Past paper', 2], [/problem-sheets\//, 'Problem sheet PDF', 2],
    [/\/experiments\//, 'Lab', 3], [/readings\//, 'Reading', 3], [/^year\//, 'Year info', 3], [/./, 'File', 3]];
  const kindOf = p => KIND.find(([re]) => re.test(p));
  /* a readable name: the lecture's topic where the notes or slides belong to one, else the tidied file name */
  function niceName(p, code) {
    const base = p.split('/').pop().replace(/\.(pdf|txt|md|docx|xlsx|pptx|html)$/i, '');
    const tps = (state.tp || []).filter(t => t.notes === p);
    const lec = (base.match(/(?:Lecture|\bL)\s?0?(\d{1,2})\b/i) || [])[1];
    const byBlock = lec && (state.tp || []).filter(t => t.module === code && new RegExp('^L' + lec + '$').test(t.block));
    const kind = /slides/i.test(base) ? 'slides' : /notes|handout|chapter/i.test(base) ? 'notes' : '';
    if (/^notes$/i.test(base)) return `${modOf(code)[1]}: complete notes`;
    if (tps.length) {
      const blocks = [...new Set(tps.map(t => t.block))];
      if (blocks.length > 3) return `${tps[0].course}: complete ${kind || 'notes'}`;
      if (blocks.length > 1) return `${tps[0].course} ${kind || 'notes'} · ${blocks.join(', ')}`;
      return `${blocks[0]} ${kind || 'notes'} · ${tps.length <= 2 ? tps.map(t => t.topic).join('; ') : tps[0].course}`;
    }
    if (byBlock && byBlock.length) return `${byBlock[0].block}${kind ? ' ' + kind : ''} · ${byBlock.map(t => t.topic).join('; ')}`;
    return base.replace(/[_]+/g, ' ').replace(/\b(PDF|handout)\b/gi, '').replace(p.startsWith('year/') ? /$^/ : /\b2026[-– ](20)?27\b/g, '')
      .replace(/\bweek\s?\d+\b/gi, '').replace(/([a-z])(\d)/g, '$1 $2').replace(/\s*-\s*/g, ' ').replace(/\s{2,}/g, ' ').trim() || base;
  }

  async function loadFiles() {
    const ov = state.ov;
    const mods = (ov.modules || []).map(m => m.code);
    const lists = await Promise.all(mods.map(c => getJSON('/api/module/' + encodeURIComponent(c)).then(m => ({ code: c, m })).catch(() => null))
      .concat([getJSON('/api/year').then(y => ({ code: 'year', m: { tree: y.tree || [] } })).catch(() => null)]));
    const wanted = [];
    for (const it of lists.filter(Boolean)) {
      const walk = nodes => (nodes || []).forEach(n => {
        (n.files || []).forEach(f => { if (f.text && !/timetable/i.test(f.name)) wanted.push({ code: it.code, orig: f.path, txt: f.text }); });
        if (n.children) walk(n.children);
      });
      walk(it.m.tree);
      (it.m.summaries || []).forEach(s => wanted.push({ code: it.code, orig: s.path, txt: s.path, title: s.title }));
    }
    const files = [];
    let i = 0;
    const worker = async () => {
      while (i < wanted.length) {
        const w = wanted[i++];
        try {
          const r = await fetch(fileUrl(w.txt), { cache: 'no-store' });
          if (!r.ok) continue;
          let raw = await r.text();
          if (w.txt.endsWith('.md')) raw = raw.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^#+\s*/gm, '').replace(/\*\*|__|`/g, '').replace(/^\s*[-*>]\s+/gm, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1');
          const k = kindOf(w.orig);
          const title = w.title || niceName(w.orig, w.code);
          files.push(Object.assign(w, { raw, low: fold(raw), title, tl: fold(title), kind: k[1], rank: k[2], pages: raw.includes('\f') }));
        } catch (e) { /* skip */ }
      }
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(worker));
    S.files = files;
  }

  function ensureIndex() {
    if (!state.ov) return;
    if (!S.qsP || (S.qsAt && Date.now() - S.qsAt > 60e3)) S.qsP = loadQuestions().then(() => { if (S.open) run(); });
    if (!S.filesP) S.filesP = loadFiles().then(() => { if (S.open) run(); }, () => { S.filesP = null; });
  }

  /* ---------------- matching */
  function score(text, title, T, phrase) {
    let sc = 0;
    for (const t of T) {
      if (!text.includes(t)) return 0;
      if (title.includes(t)) sc += new RegExp('(^|[^a-z0-9])' + reEsc(t)).test(title) ? 5 : 3;
      else sc += 1;
    }
    if (phrase && title.includes(phrase)) sc += 4;
    return sc;
  }
  /* highlight the search words in a piece of plain text */
  function hl(raw, T) {
    const f = fold(raw);
    if (f.length !== raw.length) return esc(raw);
    const marks = [];
    for (const t of T) for (let p = f.indexOf(t); p >= 0 && marks.length < 40; p = f.indexOf(t, p + t.length)) marks.push([p, p + t.length]);
    marks.sort((a, b) => a[0] - b[0]);
    let out = '', i = 0;
    for (const [a, b] of marks) { if (a < i) continue; out += esc(raw.slice(i, a)) + '<mark>' + esc(raw.slice(a, b)) + '</mark>'; i = b; }
    return out + esc(raw.slice(i));
  }
  /* a window of text around a hit, cut at spaces */
  function windowAt(s, pos, before, after) {
    let a = Math.max(0, pos - before), b = Math.min(s.length, pos + after);
    if (a > 0) { const sp = s.indexOf(' ', a); if (sp > 0 && sp < pos) a = sp + 1; }
    if (b < s.length) { const sp = s.lastIndexOf(' ', b); if (sp > pos) b = sp; }
    return [a, b];
  }
  /* a question's text around the hit, keeping $…$ maths whole so it can be typeset */
  function mathSnip(md, T) {
    const s = String(md || '').replace(/\$\$([\s\S]+?)\$\$/g, (m, x) => '$' + x.replace(/\s+/g, ' ').trim() + '$').replace(/\*\*|__/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/^\s*(\d+\.|[-*]|\(\w\))\s+/gm, '').replace(/^>\s*/gm, '').replace(/\s+/g, ' ').trim();
    const spans = [];
    s.replace(/\$[^$]+\$/g, (m, off) => { spans.push([off, off + m.length]); return m; });
    const f = fold(s);
    let pos = -1;
    for (const t of T) { const p = f.indexOf(t); if (p >= 0 && (pos < 0 || p < pos)) pos = p; }
    let [a, b] = windowAt(s, Math.max(0, pos), 50, 170);
    for (const [x, y] of spans) { if (a > x && a < y) a = x; if (b > x && b < y) b = y; }
    let html = '', i = a;
    for (const [x, y] of spans) {
      if (y <= a || x >= b) continue;
      if (x > i) html += hl(s.slice(i, x), T);
      html += y - x > 160 ? '…' : esc(s.slice(x, y));
      i = y;
    }
    if (i < b) html += hl(s.slice(i, b), T);
    return (a > 0 ? '…' : '') + html + (b < s.length ? '…' : '');
  }

  /* ---------------- the four groups */
  function findTopics(T, phrase) {
    const C = state.tcontent || {};
    return (state.tp || []).map(t => {
      const c = C[t.id] || { points: [], eqs: [] };
      const text = fold([t.topic, t.course, t.block, modOf(t.module)[0], ...c.points, ...c.eqs.map(e => e.label)].join(' '));
      const sc = score(text, fold(t.topic), T, phrase);
      if (!sc) return null;
      const st = tStatus(t.confidence);
      const point = c.points.find(p => T.some(x => fold(p).includes(x)));
      return { sc, href: revHash(t.id), title: hl(t.topic, T), meta: [modOf(t.module)[0], t.course !== modOf(t.module)[1] ? t.course : '', t.block, t.upcoming && topicAhead(t) ? 'lecture ' + t.upcoming : ''].filter(Boolean).map(esc).join(' · '),
        snip: point ? mathSnip(point, T) : '', math: true, chip: !C[t.id] && topicAhead(t) ? 'Upcoming' : st[1], chipCls: 'st-' + st[0] };
    }).filter(Boolean).sort((a, b) => b.sc - a.sc);
  }
  function findQuestions(T, phrase) {
    return (S.qs || []).map(x => {
      const sc = score(x.text, x.tl, T, phrase);
      if (!sc) return null;
      const name = (/^\d/.test(x.label) ? 'Q' : '') + x.label;
      return { sc, href: sheetHash(x.code, x.id, x.key), go: { sheet: true, q: x.key }, title: `${esc(name)} · ${hl(x.topic, T)}`,
        meta: `${esc(x.mod)} · ${esc(x.sheet)}`, snip: mathSnip(x.md, T), math: true,
        chip: x.status ? Q_WORD[x.status] || x.status : '', chipCls: 'qs-' + (x.status || 'none'), grp: `${x.code}/${x.id}/${String(x.key).replace(/[a-h]$/, '')}` };
    }).filter(Boolean).sort((a, b) => b.sc - a.sc)
      .filter((r, i, all) => all.findIndex(o => o.grp === r.grp) === i);      // one row per question, not one per part
  }
  function findDeadlines(T, phrase, now) {
    if (!state.gr) return [];
    let M;
    try { M = dlModel(now); } catch (e) { return []; }
    return M.list.map(x => {
      const text = fold([x.title, x.item, x.about, modLong(x.module), modShort(x.module)].join(' '));
      const sc = score(text, fold(x.title), T, phrase);
      if (!sc) return null;
      return { sc: sc + (x.done ? 0 : 1), href: '#deadlines', go: { dl: x.index }, title: hl(x.title, T),
        meta: [modShort(x.module), dueTxt(x), x.done ? x.doneLabel : relTxt(x, now)].map(esc).join(' · '),
        snip: x.about && T.some(t => fold(x.about).includes(t)) ? hl(x.about, T) : '', chip: x.worth.short, chipCls: x.done ? 'dl-done' : x.late ? 'dl-late' : '' };
    }).filter(Boolean).sort((a, b) => b.sc - a.sc);
  }
  function findInFiles(T, phrase) {
    const out = [];
    for (const f of S.files || []) {
      if (!T.every(t => f.low.includes(t))) continue;
      let pos = phrase ? f.low.indexOf(phrase) : -1;
      if (pos < 0) pos = f.low.indexOf(T[0]);
      /* a hit in a contents page ("Entropy . . . . . . 12") makes a useless snippet: move on to the first hit in real text */
      const key = phrase && f.low.includes(phrase) ? phrase : T[0], dots = /(\.\s?){6,}/;
      for (let p = pos, tries = 0; p >= 0 && tries < 12 && dots.test(f.raw.slice(p, p + 160)); tries++) { p = f.low.indexOf(key, p + 1); if (p >= 0 && !dots.test(f.raw.slice(p, p + 160))) pos = p; }
      let n = 0;
      for (let p = f.low.indexOf(T[0]); p >= 0 && n < 500; p = f.low.indexOf(T[0], p + 1)) n++;
      const page = f.pages ? f.raw.slice(0, pos).split('\f').length : null;
      const [a, b] = windowAt(f.raw, pos, 80, 150);
      const snipRaw = f.raw.slice(a, b).replace(/\s+/g, ' ').replace(/(\. ?){4,}/g, '… ').trim();
      const inTitle = T.every(t => f.tl.includes(t));
      out.push({ f, n, page, sc: (inTitle ? 1000 : 0) - f.rank * 100 + Math.min(n, 99), snip: (a > 0 ? '…' : '') + hl(snipRaw, T) + (b < f.raw.length ? '…' : '') });
    }
    out.sort((a, b) => b.sc - a.sc);
    return out.map(h => {
      const f = h.f;
      const isSum = f.kind === 'Lecture summary';
      const topic = isSum && (state.tp || []).find(t => t.summary === f.orig);
      return { href: isSum ? (topic ? revHash(topic.id) : fileUrl(f.orig)) : pdfAt(f.orig, h.page), ext: !isSum || !topic, go: topic ? { tab: [topic.id, 'summary'] } : null,
        title: hl(f.title, T), meta: [f.code === 'year' ? 'Year 2' : modOf(f.code)[0], f.kind, h.page ? 'page ' + h.page : '', h.n > 1 ? `${h.n >= 500 ? '500+' : h.n} matches` : ''].filter(Boolean).map(esc).join(' · '),
        snip: h.snip, chip: isSum ? 'Open' : 'PDF ↗' };
    });
  }

  /* ---------------- spelling: a word that appears nowhere is swapped for the nearest real word
     The vocabulary is every word in the topics, questions, deadlines and text copies, counted (titles count
     extra). A typed word that isn't found anywhere, even inside a longer word, is compared with words of
     similar length (one slip allowed in 4–7 letters, two in 8+; a swap of two letters counts as one) and
     with the start of longer words, so a half-typed word with a slip still finds its match. */
  const WORD = /[a-z][a-z0-9]{2,}/g;
  function buildVocab() {
    const key = `${S.qs ? S.qs.length : 0}/${S.files ? S.files.length : 0}/${(state.tp || []).length}`;
    if (S.vocab && S.vocabKey === key) return S.vocab;
    const n = new Map();
    const add = (text, w) => { for (const m of String(text).matchAll(WORD)) n.set(m[0], (n.get(m[0]) || 0) + w); };
    const C = state.tcontent || {};
    for (const t of state.tp || []) { const c = C[t.id] || { points: [], eqs: [] }; add(fold([t.topic, t.course, ...c.points, ...c.eqs.map(e => e.label)].join(' ')), 20); }
    for (const x of S.qs || []) add(x.text, 20);
    for (const x of (state.ov && state.ov.deadlines) || []) add(fold(`${x.item} ${x.about || ''}`), 20);
    for (const f of S.files || []) { add(f.tl, 20); add(f.low, 1); }
    const words = [...n.keys()].sort();
    const byLen = new Map();
    for (const w of words) { if (!byLen.has(w.length)) byLen.set(w.length, []); byLen.get(w.length).push(w); }
    S.vocab = { n, words, byLen }; S.vocabKey = key;
    return S.vocab;
  }
  /* optimal string alignment distance, giving up once it passes max */
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let p2 = null, p1 = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let low = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(p1[j] + 1, cur[j - 1] + 1, p1[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
        cur.push(v);
        if (v < low) low = v;
      }
      if (low > max) return max + 1;
      p2 = p1; p1 = cur;
    }
    return p1[b.length];
  }
  const foundAnywhere = t => (S.files || []).some(f => f.low.includes(t)) || (S.qs || []).some(x => x.text.includes(t))
    || (state.tp || []).some(x => fold(x.topic).includes(t)) || ((state.ov && state.ov.deadlines) || []).some(x => fold(`${x.item} ${x.about || ''}`).includes(t));
  /* also: a spelling that is there but rare (e.g. "tunneling" in one reading) gives way to a far more common
     word one slip away ("tunnelling"), so the main results aren't missed */
  function correct(t) {
    if (t.length < 4 || /\d/.test(t)) return t;
    const V = buildVocab(), have = V.n.get(t) || 0;
    const found = have > 0 || foundAnywhere(t);
    if (found && have >= 5) return t;
    const max = found ? 1 : t.length >= 8 ? 2 : 1;
    let best = null;
    const consider = (w, d, prefix) => {
      if (d > max || w === t || (found && (w.startsWith(t) || t.startsWith(w)))) return;
      const sc = d * 10 + (prefix ? 3 : 0) - Math.min(Math.log10(V.n.get(w)), 5) - (w[0] === t[0] ? 1 : 0);
      if (!best || sc < best.sc) best = { w, sc };
    };
    for (let L = t.length - max; L <= t.length + max; L++) for (const w of V.byLen.get(L) || []) consider(w, dist(t, w, max), false);
    if (found) return best && V.n.get(best.w) >= Math.max(20, 10 * have) ? best.w : t;
    /* half-typed words: compare with the start of longer words */
    if (!best || best.sc > 0) for (const [L, ws] of V.byLen) if (L > t.length + max) for (const w of ws) consider(w, dist(t, w.slice(0, t.length), max), true);
    return best ? best.w : t;
  }

  /* ---------------- drawing the panel */
  const GROUPS = [['topics', 'Revision topics', 4], ['questions', 'Problem-sheet questions', 5], ['deadlines', 'Deadlines', 4], ['files', 'In your notes, slides & papers', 6]];
  function run() {
    const q = input.value.trim();
    S.q = q;
    if (!q || q.length < 2) return drawHint();
    let T = termsOf(q), fixed = null;
    if (S.exact !== q && (S.files || S.qs)) {
      const C2 = T.map(correct);
      if (C2.some((w, i) => w !== T[i])) { fixed = C2; T = C2; }
    }
    const phrase = T.length > 1 ? T.join(' ') : null;
    const now = new Date();
    const res = { topics: findTopics(T, phrase), questions: findQuestions(T, phrase), deadlines: findDeadlines(T, phrase, now), files: findInFiles(T, phrase) };
    const loadingQ = !S.qs, loadingF = !S.files;
    S.rows = [];
    let html = '';
    for (const [k, label, n] of GROUPS) {
      const all = res[k], show = S.more === k ? all.slice(0, 40) : all.slice(0, n);
      const loading = (k === 'questions' && loadingQ) || (k === 'files' && loadingF);
      if (!all.length && !loading) continue;
      html += `<section class="sr-g"><div class="sr-h"><span>${esc(label)}</span><span>${loading ? 'Loading…' : all.length}</span></div>`;
      for (const r of show) {
        const i = S.rows.push(r) - 1;
        html += `<a class="sr-row" data-sri="${i}" href="${esc(r.href)}"${r.ext ? ' target="_blank" rel="noopener"' : ''} role="option">
          <span class="sr-main"><span class="sr-t">${r.title}</span><span class="sr-m">${r.meta}</span>${r.snip ? `<span class="sr-s${r.math ? ' sr-math' : ''}">${r.snip}</span>` : ''}</span>
          ${r.chip ? `<span class="sr-c ${esc(r.chipCls || '')}">${esc(r.chip)}</span>` : ''}</a>`;
      }
      if (all.length > show.length) html += `<button class="sr-more" data-srmore="${k}">Show all ${all.length > 40 ? '40 of ' + all.length : all.length}</button>`;
      html += '</section>';
    }
    if (fixed) html = `<div class="sr-fix"><span>Showing results for <b>${esc(fixed.join(' '))}</b></span><button data-srexact>Search for “${esc(q)}” instead</button></div>` + html;
    if (!html) html = `<div class="sr-empty">Nothing matches “${esc(q)}”.<small>Search looks at topic titles and points, question text, deadlines, and the text of every PDF that has a .txt copy.</small></div>`;
    panel.innerHTML = html + footer();
    panel.querySelectorAll('.sr-math').forEach(typeset);
    S.act = S.rows.length ? 0 : -1;
    paintAct(false);
  }
  const footer = () => '<div class="sr-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>';
  function drawHint() {
    S.rows = []; S.act = -1;
    panel.innerHTML = `<div class="sr-hint"><b>Search everything</b><span>Revision topics, problem-sheet questions, deadlines, and the words inside your lecture notes, slides, summaries, past papers and readings.</span>
      <span class="sr-try">Try ${['entropy', 'Frobenius', 'Eddington', 'tunnelling', 'radioactivity report'].map(w => `<button data-srtry="${w}">${w}</button>`).join('')}</span></div>` + footer();
  }
  function paintAct(scroll = true) {
    panel.querySelectorAll('.sr-row').forEach(el => { const on = +el.dataset.sri === S.act; el.classList.toggle('act', on); el.setAttribute('aria-selected', on); if (on) el.id = 'sr-act'; else el.removeAttribute('id'); });
    const el = panel.querySelector('.sr-row.act');
    if (el && scroll) el.scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', el ? 'sr-act' : '');
  }

  /* ---------------- open, close, go */
  function openPanel() {
    if (S.open) return;
    S.open = true; S.more = false;
    bar.classList.add('searching');
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('on'));
    input.setAttribute('aria-expanded', 'true');
    ensureIndex();
    run();
  }
  function closePanel(blur = true) {
    if (!S.open) return;
    S.open = false;
    bar.classList.remove('searching');
    panel.classList.remove('on');
    input.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (!S.open) panel.hidden = true; }, 180);
    if (blur) input.blur();
  }
  function go(r, e) {
    closePanel();
    const g = r.go || {};
    if (g.tab) state.rvTab[g.tab[0]] = g.tab[1];
    if (g.sheet) state.pending = { q: g.q };
    if (g.dl != null) {
      e && e.preventDefault();
      state.dlOpenIdx = g.dl;
      if (state.view === 'deadlines') render(); else location.hash = 'deadlines';
      setTimeout(() => accTo(g.dl), 140);
      return;
    }
    if (!r.ext && location.hash === r.href) { e && e.preventDefault(); showView(true); }
  }

  input.addEventListener('focus', openPanel);
  input.addEventListener('input', () => { box.classList.toggle('has-text', !!input.value); S.more = false; clearTimeout(S.t); S.t = setTimeout(run, 70); });
  input.addEventListener('keyup', () => { if (S.open && input.value.trim() !== S.q) { box.classList.toggle('has-text', !!input.value); clearTimeout(S.t); S.t = setTimeout(run, 70); } });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!S.rows.length) return;
      S.act = (S.act + (e.key === 'ArrowDown' ? 1 : -1) + S.rows.length) % S.rows.length;
      paintAct();
    } else if (e.key === 'Enter') {
      const el = panel.querySelector('.sr-row.act');
      if (el) { e.preventDefault(); el.click(); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (input.value && S.open) { input.value = ''; box.classList.remove('has-text'); run(); } else closePanel();
    }
  });
  box.addEventListener('mousedown', e => { if (e.target !== input) { e.preventDefault(); input.focus(); } });
  panel.addEventListener('mousedown', e => { if (!e.target.closest('a')) e.preventDefault(); });   // keep the box focused while clicking the panel
  panel.addEventListener('mousemove', e => { const el = e.target.closest('.sr-row'); if (el && +el.dataset.sri !== S.act) { S.act = +el.dataset.sri; paintAct(false); } });
  panel.addEventListener('click', e => {
    const more = e.target.closest('[data-srmore]');
    if (more) { S.more = more.dataset.srmore; run(); input.focus(); return; }
    if (e.target.closest('[data-srexact]')) { S.exact = input.value.trim(); run(); input.focus(); return; }
    const tr = e.target.closest('[data-srtry]');
    if (tr) { input.value = tr.dataset.srtry; box.classList.add('has-text'); run(); input.focus(); return; }
    const row = e.target.closest('.sr-row');
    if (row) { e.stopPropagation(); go(S.rows[+row.dataset.sri], e); }
  });
  document.addEventListener('mousedown', e => { if (S.open && !e.target.closest('.navbar')) closePanel(); });
  addEventListener('hashchange', () => closePanel());
  document.addEventListener('keydown', e => {
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
      e.preventDefault();
      if (scrollY > 40) scrollTo({ top: 0, behavior: 'smooth' });
      input.focus({ preventScroll: true });
      input.select();
    }
  });

  /* ---------------- fit the pill to the space beside the nav */
  function layout() {
    bar.classList.remove('sb-wide', 'sb-compact', 'sb-phone');
    if (innerWidth <= 720) return bar.classList.add('sb-phone');
    const nav = $('.nav-main').getBoundingClientRect(), date = $('#today').getBoundingClientRect();
    const room = date.left - nav.right - 8 - 24;
    if (room >= 200) { bar.classList.add('sb-wide'); bar.style.setProperty('--sw', Math.min(330, room) + 'px'); }
    else bar.classList.add('sb-compact');
    requestAnimationFrame(() => bar.classList.add('sb-ready'));   // no width animation on first paint
  }
  layout();
  addEventListener('resize', layout);
  document.fonts.ready.then(layout);
  window.searchLayout = layout;

  /* shared with ask.js: the same files and question index, spelling correction, and opening/closing */
  window.icdIndex = {
    async ready() {
      while (!state.ov) await new Promise(r => setTimeout(r, 200));
      ensureIndex();
      await Promise.all([S.qsP, S.filesP].filter(Boolean));
      return true;
    },
    get files() { return S.files || []; },
    get qs() { return S.qs || []; },
    fold, termsOf, correct: t => (S.files || S.qs ? correct(t) : t),
    closeSearch: () => closePanel(),
  };
  input.addEventListener('focus', () => document.dispatchEvent(new CustomEvent('icd:search-open')));
})();
