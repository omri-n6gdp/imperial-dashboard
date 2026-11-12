/* ---------------------------------------------------------------- ask a question
   The pill to the left of the nav opens a chat about your course. Each question is answered only from
   your own files: the page first finds the sources that match (notes, slides, summaries, past papers,
   readings, revision topics, problem-sheet questions, and the dashboard's own deadlines, marks,
   timetable and key dates), numbers them [S1], [S2]…, and the AI must cite them for every claim and say
   when your files don't have the answer. Two engines, switchable in the panel:
     - Claude (your Pro plan): runs Claude Code on this Mac through the dashboard server
       (POST /api/ask-claude). It also gets read-only access to the dashboard folder, so it can open
       more of your notes before answering. Slower (10–60 s), best answers.
     - Groq (free API key, openai/gpt-oss-120b, falling back to llama-3.3-70b): answers in a second or
       two from the sources the page found. The key is kept in this browser only.
   Keys: Enter sends, Shift+Enter for a new line, Esc closes. */
(() => {
  const IDX = window.icdIndex;
  const A = { open: false, engine: saved('icd-ask-engine', 'claude'), web: saved('icd-ask-web', 'on') === 'on', msgs: [], busy: false, ctrl: null, claude: null, chunks: null, tick: null, canvas: null, serverV: null };
  const groqKey = () => saved('icd-groq-key', '');
  const GROQ_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'];
  const UGC_PAPERS = 'https://canvas.imperial.ac.uk/courses/8024/pages/past-papers-and-model-solutions';
  /* Canvas copies of your files (made in the 9 Nov sync by matching file sizes): path -> {file, page} */
  fetch('/static/canvas-links.json', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).then(j => { A.canvas = j; }).catch(() => { A.canvas = {}; });
  const canvasFor = path => (A.canvas && A.canvas[path]) || (/\/past-papers\//.test(path) ? { page: UGC_PAPERS } : null);

  /* ---------------- the pill and the panel */
  const bar = $('.navbar');
  const pill = document.createElement('button');
  pill.className = 'ask'; pill.type = 'button';
  pill.setAttribute('aria-haspopup', 'dialog'); pill.setAttribute('aria-expanded', 'false'); pill.setAttribute('aria-controls', 'ap');
  pill.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/><path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" opacity=".75"/></svg><span>Ask</span>';
  bar.insertBefore(pill, bar.firstChild);
  const panel = document.createElement('div');
  panel.className = 'ap'; panel.id = 'ap'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Ask a question about your course');
  panel.innerHTML = `
    <div class="ap-head">
      <div class="ap-title"><b>Ask about your course</b><span class="ap-sub">Answers only from your files, with sources</span></div>
      <div class="pill-switch ap-eng" role="radiogroup" aria-label="Who answers">
        <button type="button" data-eng="claude" role="radio">Claude <small>Pro</small></button>
        <button type="button" data-eng="groq" role="radio">Groq <small>fast</small></button>
      </div>
      <button type="button" class="ap-web" data-apweb title="Let the AI search the web too" aria-pressed="true">Web</button>
      <button type="button" class="ap-icon" data-apclear title="New chat" aria-label="New chat">⟲</button>
      <button type="button" class="ap-icon" data-apclose title="Close (Esc)" aria-label="Close">✕</button>
    </div>
    <div class="ap-body" id="ap-body" aria-live="polite"></div>
    <form class="ap-form" autocomplete="off">
      <textarea id="ap-q" rows="1" placeholder="Ask anything: a concept from the notes, what's due, how a module is marked…" aria-label="Your question"></textarea>
      <button type="submit" class="ap-send" aria-label="Ask">↑</button>
    </form>
    <div class="ap-foot"><span class="ap-engine-note"></span><span>Check the cited source for anything that matters.</span></div>`;
  document.body.appendChild(panel);
  const body = $('#ap-body'), qa = $('#ap-q'), form = $('.ap-form', panel);

  /* ---------------- where things are */
  const STOP = new Set(('a an and are as at be been but by can could did do does doing for from had has have how i if in into is it its me my of on or our so than that the their them then there these they this to too was we were what when where which who why will with would you your yours about explain tell give show find need needs please any some much many more most should does whats im ive whens wheres hows also just like get got go going want know mean means does do did make made use used using say said work works one two').split(' '));
  function qTerms(q) {
    return IDX.termsOf(q).map(t => t.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')).filter(t => t.length > 1 && !STOP.has(t)).map(IDX.correct);
  }
  /* the text copies, cut into passages of roughly a paragraph or two, each knowing its file and page */
  function chunks() {
    if (A.chunks && A.chunks.n === IDX.files.length) return A.chunks.list;
    const list = [];
    for (const f of IDX.files) {
      const pages = f.pages ? f.raw.split('\f') : [f.raw];
      pages.forEach((pg, i) => {
        let buf = '';
        const flush = () => { const t = buf.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim(); if (t.length > 40) list.push({ f, page: f.pages ? i + 1 : null, text: t, low: IDX.fold(t) }); buf = ''; };
        for (const para of pg.split(/\n\s*\n/)) {
          if (buf.length + para.length > 1100 && buf) flush();
          buf += (buf ? '\n\n' : '') + para;
        }
        flush();
      });
    }
    A.chunks = { n: IDX.files.length, list };
    return list;
  }
  const KIND_W = { 'Lecture summary': 1.35, Notes: 1.3, Slides: 1.1, Lecture: 1.1, 'Problem sheet PDF': 1, 'Past paper solutions': 0.95, 'Past paper': 0.9, Lab: 1, Reading: 0.8, 'Year info': 1, File: 0.85 };
  const count = (s, t, cap) => { let n = 0; for (let p = s.indexOf(t); p >= 0 && n < cap; p = s.indexOf(t, p + t.length)) n++; return n; };

  function fileSources(T, max, budget) {
    if (!T.length) return [];
    const L = chunks(), N = L.length;
    const idf = {};
    for (const t of T) { let df = 0; for (const c of L) if (c.low.includes(t)) df++; idf[t] = Math.log((N + 1) / (df + 1)); }
    const scored = [];
    for (const c of L) {
      let sc = 0, hit = 0;
      for (const t of T) { const n = count(c.low, t, 6); if (n) { sc += (1 + Math.log(n)) * idf[t]; hit++; } }
      if (!sc) continue;
      if (hit === T.length && T.length > 1) sc *= 1.6;
      if (T.some(t => c.f.tl.includes(t))) sc *= 1.25;
      sc *= KIND_W[c.f.kind] || 1;
      scored.push([sc, c]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    const out = [], perFile = new Map();
    let used = 0;
    for (const [, c] of scored) {
      if (out.length >= max) break;
      const k = perFile.get(c.f) || 0, pk = c.f.orig + '#' + c.page;
      if (k >= 2 || perFile.has(pk)) continue;
      const text = c.text.length > 1100 ? c.text.slice(0, 1100) + '…' : c.text;
      if (used + text.length > budget) continue;
      perFile.set(c.f, k + 1); perFile.set(pk, 1); used += text.length;
      const isSum = c.f.kind === 'Lecture summary', topic = isSum && (state.tp || []).find(t => t.summary === c.f.orig);
      const cv = canvasFor(c.f.orig);
      out.push({ label: `${c.f.title} (${c.f.kind}${c.page ? ', page ' + c.page : ''}; ${modOf(c.f.code)[0] || ''}; file ${c.f.orig}${cv ? '; on Canvas: ' + (cv.file || cv.page) : ''})`, short: `${c.f.title}${c.page ? ' · p.' + c.page : ''}`,
        href: topic ? revHash(topic.id) : pdfAt(c.f.orig, c.page), ext: !topic, canvas: cv && (cv.file || cv.page), kind: c.f.kind, path: c.f.orig, page: c.page, text });
    }
    return out;
  }
  function topicSources(T, max) {
    if (!T.length) return [];
    const C = state.tcontent || {};
    return (state.tp || []).map(t => {
      const c = C[t.id] || { points: [], eqs: [] };
      const text = IDX.fold([t.topic, t.course, t.block, ...c.points, ...c.eqs.map(e => e.label)].join(' '));
      const hit = T.filter(x => text.includes(x)).length;
      const inTitle = T.filter(x => IDX.fold(t.topic).includes(x)).length;
      return { t, c, sc: hit + 2 * inTitle };
    }).filter(x => x.sc >= Math.max(2, Math.ceil(T.length * 0.75))).sort((a, b) => b.sc - a.sc).slice(0, max).map(({ t, c }) => ({
      label: `Revision topic: ${t.topic} (${modOf(t.module)[1]}, ${t.course} ${t.block}${t.lectured ? (topicAhead(t) ? ', lecture expected ' : ', lectured ') + t.lectured : ', not lectured yet'}; your status: ${tStatus(t.confidence)[1]})`,
      short: `Topic: ${t.topic}`, href: revHash(t.id), topicId: t.id,
      text: [c.points.length ? 'Main points: ' + c.points.join(' ') : '', c.eqs.length ? 'Key equations: ' + c.eqs.map(e => `${e.label}: $${e.tex}$`).join('; ') : ''].filter(Boolean).join('\n') || '(no notes summarised yet)',
    }));
  }
  function questionSources(T, max) {
    if (!T.length) return [];
    const seen = new Set();
    return IDX.qs.map(x => ({ x, sc: T.filter(t => x.text.includes(t)).length + T.filter(t => x.tl.includes(t)).length }))
      .filter(o => o.sc >= Math.max(2, T.length) && T.filter(t => o.x.text.includes(t)).length >= Math.ceil(T.length * 0.8)).sort((a, b) => b.sc - a.sc)
      .filter(o => { const g = `${o.x.code}/${o.x.id}/${String(o.x.key).replace(/[a-h]$/, '')}`; if (seen.has(g)) return false; seen.add(g); return true; })
      .slice(0, max).map(({ x }) => ({
        label: `Problem sheet question: ${x.mod} ${x.sheet}, question ${x.label} "${x.topic}"${x.status ? ' (your status: ' + (Q_WORD[x.status] || x.status) + ')' : ''}`,
        short: `${x.mod} ${x.sheet} Q${x.label}`, href: sheetHash(x.code, x.id, x.key), go: { sheet: true, q: x.key }, q: x,
        text: x.md.length > 900 ? x.md.slice(0, 900) + '…' : x.md,
      }));
  }

  /* questions to practise: the ones listed under the matching revision topics, sheet questions whose text matches,
     and past-paper pages that match; shown under every answer and offered to the AI for its Practise line */
  function practice(T, S) {
    const out = [], seen = new Set(), C = state.tcontent || {};
    const add = x => { const g = `${x.code}/${x.id}/${String(x.key).replace(/[a-h]$/, '')}`; if (seen.has(g)) return; seen.add(g);
      out.push({ label: `${x.mod} ${x.sheet} Q${String(x.label).replace(/[a-h]$/, '')}`, topic: x.topic, status: x.status, href: sheetHash(x.code, x.id, String(x.key).replace(/[a-h]$/, '')), go: { sheet: true, q: String(x.key).replace(/[a-h]$/, '') } }); };
    const topicIds = S.filter(s => s.topicId).map(s => s.topicId);
    for (const id of topicIds) for (const ref of (C[id] || {}).qs || []) {
      const [sid, n] = ref.split('/'), code = ((state.tp || []).find(t => t.id === id) || {}).module, hit = q => q.id === sid && String(q.key).replace(/[a-h]$/, '') === n;
      const x = IDX.qs.find(q => hit(q) && q.code === code) || IDX.qs.find(hit);      // the topic's own module first: sheet names can repeat across modules
      if (x) add(x);
    }
    for (const s of S) if (s.q) add(s.q);
    if (T.length) IDX.qs.map(x => ({ x, n: T.filter(t => x.text.includes(t)).length + T.filter(t => x.tl.includes(t)).length }))
      .filter(o => o.n >= Math.max(2, T.length)).sort((a, b) => b.n - a.n).slice(0, 6).forEach(o => add(o.x));
    const papers = [];
    if (T.length) {
      const pp = chunks().filter(c => /Past paper/.test(c.f.kind)).map(c => ({ c, n: T.filter(t => c.low.includes(t)).length }))
        .filter(o => o.n === T.length).sort((a, b) => b.n - a.n || (b.c.f.title > a.c.f.title ? 1 : -1));
      const seenP = new Set();
      for (const { c } of pp) { const k = c.f.orig; if (seenP.has(k)) continue; seenP.add(k);
        papers.push({ label: `${modOf(c.f.code)[0]} past paper: ${c.f.title}${c.page ? ', p.' + c.page : ''}`, href: pdfAt(c.f.orig, c.page), ext: true, canvas: (canvasFor(c.f.orig) || {}).page });
        if (papers.length >= 3) break; }
    }
    return { qs: out.slice(0, 6), papers };
  }

  /* the dashboard's own records, written out plainly */
  function dateLong(d) { return `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]} ${d.getDate()} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()]} ${d.getFullYear()}`; }
  function deadlinesText(now) {
    let M;
    try { M = dlModel(now); } catch (e) { return null; }
    const lines = M.list.map(x => `- ${x.title} | ${modLong(x.module)} | due ${dueTxt(x)} | ${x.done ? x.doneLabel : x.late ? 'OVERDUE' : relTxt(x, now)} | worth: ${x.worth.parts.join(', ')}${x.hours ? ' | about ' + hoursTxt(x.hours) + ' of work' : ''}${x.about ? ' | ' + x.about : ''}`);
    const other = ((state.ov && state.ov.deadlines) || []).filter(x => !isMarked(x)).map(x => `- (not marked) ${tidy(x.item)} | due ${x.due} | ${x.status}`);
    return 'Marked work, in date order:\n' + lines.join('\n') + (other.length ? '\nOther to-dos (not marked):\n' + other.join('\n') : '');
  }
  function marksText() {
    const out = [];
    for (const m of state.gr || []) {
      let got = 0, of = 0;
      const rows = (m.items || []).map(it => {
        const sc = it.score != null ? [it.score, it.points] : it.mark != null ? [it.mark, it.out_of] : null;
        if (sc && sc[1]) { got += sc[0]; of += sc[1]; return `  - ${it.name}: ${sc[0]}/${sc[1]} (${pc(100 * sc[0] / sc[1], 1)}%)`; }
        return `  - ${it.name}: ${it.status === 'submitted' ? 'submitted, waiting for the mark' : it.status || 'not marked yet'}${it.due ? ' (due ' + it.due + ')' : ''}`;
      });
      out.push(`${m.short} (${modLong(m.code)})${of ? `: ${got}/${of} points marked so far = ${pc(100 * got / of, 1)}%` : ': no marks yet'}\n` + rows.join('\n'));
    }
    const mods = ((state.ov && state.ov.modules) || []).map(m => `- ${m.short}: ${m.title}, ${m.ects || '?'} ECTS, assessment ${JSON.stringify(m.assessment || {})}`);
    return 'Marks by module (from Canvas):\n' + out.join('\n') + '\nModule credits and assessment weights (%):\n' + mods.join('\n');
  }
  function timetableText() {
    const ov = state.ov || {}, tt = ov.timetable || {};
    const rec = (tt.recurring_term1 || []).map(c => `- ${c.day} ${c.start}–${c.end}: ${c.what}${c.room ? ' (' + c.room + ')' : ''}${c.weeks ? ' weeks ' + c.weeks : ''}`);
    const cycles = (ov.lab_cycles || []).map(c => `- Lab cycle ${c.cycle}: ${c.name}, ${c.start} to ${c.end}`);
    const exact = typeof classesText === 'function' ? classesText(new Date(), 14) : '';
    return `Lab group ${tt.lab_group || '?'}; seminar group ${tt.seminar_group || '?'}; default room ${tt.default_room || '?'}.\n${exact ? `Exact classes for the next two weeks (from the department timetable grids; lectures in ${tt.default_room || 'Lecture Theatre 1'} unless a room is given):\n${exact}\n` : ''}Usual weekly pattern (Term 1):\n${rec.join('\n')}\nLab cycles:\n${cycles.join('\n')}`;
  }
  function yearText() {
    const ov = state.ov || {};
    const kd = JSON.stringify(ov.key_dates || {}), ex = JSON.stringify(ov.exams || {});
    return `Key dates: ${kd.slice(0, 1600)}\nExams: ${ex.slice(0, 1200)}\nThings flagged for Omri:\n${String(ov.needs || '').replace(/\n{2,}/g, '\n').slice(0, 1400)}`;
  }

  function buildSources(q, engine) {
    const big = engine === 'claude';
    const prev = A.msgs.filter(m => m.role === 'user').slice(-2, -1).map(m => m.text).join(' ');
    const T = qTerms(q.split(/\s+/).length < 6 && prev ? q + ' ' + prev : q);
    const now = new Date(), ql = q.toLowerCase(), S = [];
    const want = re => re.test(ql);
    if (want(/due|deadline|submit|hand(ed)? in|this week|next week|today|tonight|tomorrow|overdue|late|worth|assignment|report|aps|pitch|deck|log|agreement|when is|when's|what's next|to do|todo|busy/))
      S.push({ label: 'Deadlines (dashboard, from deadlines.md)', short: 'Deadlines', href: '#deadlines', text: deadlinesText(now) });
    if (want(/mark|grade|score|percent|%|average|first|2:1|2\.1|dean|result|how am i doing|feedback|weight|credit|ects|count/))
      S.push({ label: 'Marks and module weights (dashboard, from Canvas and module.md)', short: 'Marks', href: '#marks', text: marksText() });
    if (want(/timetable|lecture|lab|seminar|class|room|where|what time|tomorrow|today|monday|tuesday|wednesday|thursday|friday|week|cycle|partner|group/))
      S.push({ label: 'Timetable and lab cycles (dashboard, from calendar/timetable.md)', short: 'Timetable', href: '#home', text: timetableText() });
    if (want(/exam|term|holiday|closure|break|reading week|key date|when does|start|end|christmas|easter|summer|need to do|flagged|student essentials/))
      S.push({ label: 'Key dates, exams and flagged items (dashboard, year/ folder)', short: 'Key dates', href: '#home', text: yearText() });
    S.push(...topicSources(T, 3));
    S.push(...questionSources(T, big ? 3 : 2));
    const used = S.reduce((a, s) => a + s.text.length, 0);
    S.push(...fileSources(T, big ? 8 : 6, Math.max(3000, (big ? 16000 : 12000) - used)));
    S.forEach((s, i) => { s.id = 'S' + (i + 1); });
    S.practice = practice(T, S);
    return S;
  }

  /* ---------------- the instructions both engines work from */
  const SYSTEM = (now, engine, web) => `You are Omri's study assistant, built into his dashboard for Year 2 MSci Physics at Imperial College London (2026–27). Today is ${dateLong(now)}. Think of yourself as a friendly, switched-on study buddy who happens to know his course inside out: warm, encouraging and a bit relaxed, but always exact. He is a strong student, so be correct, clear and useful for exams, never padded or patronising.

# Sources and honesty
- Each question comes with numbered SOURCES [S1], [S2]… taken from his own files and his dashboard${engine === 'claude' ? ', and you can open more files yourself' : ''}. For anything about his course (dates, deadlines, times, rooms, marks, weightings, what has been lectured, notation, conventions, which questions exist) they are the authority: copy such facts exactly and cite them straight after the claim, like [S2] or [S1][S4]. Never cite a source that doesn't say it.
- For physics and maths you may use your own knowledge to explain well, but follow the course's notation and results where the sources give them, cite the notes for the course's version, and mark anything that goes beyond his notes with "(beyond your notes)".
- ${web ? 'You can search the web. Use it when his files don\'t cover something (current Imperial or department pages, wider context, a clearer explanation or a good external resource), preferring imperial.ac.uk, official and textbook-quality sources. Cite each web fact with a markdown link [short title](URL) right after it. Never let a web source override his course\'s own dates, rules or notation.' : 'You have no web access this time.'}
- If the answer isn't in the sources${web ? ' or on reliable web pages' : ''} and isn't standard physics, say "I can't find that in your files" and where it is likely to be (module, Canvas page, person). Never invent course facts.
- Before you answer, check equations for dimensions, signs and factors of 2 and π, and check dates against today.

# Shape the answer to the question
- Concept or "explain": a one-line answer first; then the physical picture; then the key equations with every symbol defined; a short derivation or worked step if it helps; common mistakes or the exam angle.
- Help with a problem-sheet or past-paper question: start with the key idea and a hint, then the method step by step. Only give the final answer if he asks for it or the solutions are already out (then point to the solution page). If the sheet is marked work (APS), give hints and explanations only, never the worked answer.
- Logistics (deadlines, marks, timetable, exams): the direct answer first, then a short list in date order with exact dates and times and how far away each is ("in 4 days"); flag anything overdue, clashing or not yet set.
- Revision or exam prep: what to know, the key equations, and which questions to practise.

# Always finish with
- **Read more:** the best 1–3 places in his notes (cite the source; give the page). If a source header has an "on Canvas" link, add it as a markdown link [Canvas](URL).
- **Practise:** 2–4 of the most relevant questions from RELATED QUESTIONS by name (e.g. "SSP Sheet 3 Q8: Eddington luminosity"), with a few words on why each fits. Skip this line for pure logistics questions or if none fit.

# Personality
- Talk to him like a friend explaining over coffee: natural, conversational sentences, "you" and "we", contractions are fine. Use his name now and then (not every answer).
- Be encouraging without gushing: if something is genuinely tricky, say so ("this one trips everyone up"); when a deadline is close, be calm and practical, not alarming. A light touch of humour or a quick analogy is welcome when it helps the idea stick; never at the expense of accuracy.
- Keep the friendliness in the wording, not the length: no filler openings ("Great question!"), no sign-offs, at most one emoji and usually none. Facts, dates, equations and citations stay exactly as strict as below.

# Style
British English. Lead with the answer. Markdown with short paragraphs; bold the key result; lists only when they help; headings only for long answers. LaTeX: $…$ inline, $$…$$ displayed. Usually 150–350 words; longer only for a derivation he asked for.`;
  const CLAUDE_EXTRA = `

# Tools
You are in his dashboard folder with read-only tools (Read, Grep, Glob${'${WEB}'}). Layout: modules/<CODE-name>/ with notes/, slides/, lecture-summaries/, problem-sheets/ (questions/<SHEET>.md has each sheet question by question with its status), past-papers/, module.md, assessment.md, schedule.md; deadlines.md; year/; calendar/; revision/. Every PDF has a .txt copy beside it with the same name; pages in the .txt are separated by form-feed characters. Use tools only when the numbered sources don't answer the question, and then at most two or three targeted searches or reads (Grep with a precise pattern, Read with offset and limit, never whole long files)${'${WEB_RULE}'}. When you rely on a file you opened, cite it as [file: relative/path/to/file.pdf p.N] using the PDF's path (not .txt) and the page if you know it. Never change anything. Reply with the answer only; no preamble about what you searched.`;

  function promptFor(q, S) {
    const hist = A.msgs.filter(m => m.done && !m.err).slice(-4).map(m => (m.role === 'user' ? 'Q: ' : 'A: ') + m.text.replace(/\[(S\d+|file:[^\]]*)\]/g, '').slice(0, 700)).join('\n');
    const P = S.practice || { qs: [], papers: [] };
    const rel = P.qs.map(x => `- ${x.label}: ${x.topic}${x.status ? ' (' + (Q_WORD[x.status] || x.status) + ')' : ''}`).concat(P.papers.map(x => '- ' + x.label));
    return `SOURCES\n\n${S.map(s => `[${s.id}] ${s.label}\n${s.text}`).join('\n\n')}\n\n---\nRELATED QUESTIONS (for the Practise line)\n${rel.length ? rel.join('\n') : '(none found)'}\n\n---\n${hist ? 'Earlier in this conversation (context only; cite sources above, not this):\n' + hist + '\n---\n' : ''}QUESTION: ${q}`;
  }

  /* ---------------- the two engines */
  async function claudeStatus(force) {
    try {
      const r = await fetch('/api/ask-claude/status' + (force ? '?force=1' : ''), { cache: 'no-store' });
      if (r.status === 404) return (A.claude = { state: 'restart' });
      const j = await r.json();
      if (!j.found) return (A.claude = { state: 'missing' });
      /* older servers don't report the login; the server checks it again before every question anyway */
      if (j.auth && !j.auth.ok) return (A.claude = { state: 'billing', auth: j.auth, version: j.version });
      return (A.claude = { state: 'ok', version: j.version, auth: j.auth || null });
    } catch (e) { return (A.claude = { state: 'restart' }); }
  }
  async function runClaude(m, prompt, now, o) {
    o = o || {};
    const draw_ = o.draw || draw, soon_ = o.soon || drawSoon;
    const r = await fetch('/api/ask-claude', { method: 'POST', signal: o.signal || A.ctrl.signal, headers: { 'Content-Type': 'application/json', 'X-ICD-Ask': '1' },
      body: JSON.stringify({ prompt, system: (o.system ? o.system('claude', A.web) : SYSTEM(now, 'claude', A.web)) + CLAUDE_EXTRA.replace('${WEB}', A.web ? ', WebSearch, WebFetch' : '').replace('${WEB_RULE}', A.web ? '; search the web only if neither the sources nor his files cover it' : ''),
        system_mode: 'replace', web: A.web, model: m.claudeModel, effort: 'low' }) });
    if (r.status === 404) { A.claude = { state: 'restart' }; throw new Error('restart'); }
    if (r.status === 409) { const j = await r.json().catch(() => ({})); A.claude = { state: 'billing', auth: j.auth || {} }; throw new Error('billing'); }
    if (!r.ok) throw new Error(`The dashboard server said ${r.status}.`);
    const rd = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let e; try { e = JSON.parse(line); } catch (x) { continue; }
        if (e.t === 'tool') { m.steps.push(`${{ Read: 'Reading', Grep: 'Searching your files for', Glob: 'Looking for', WebSearch: 'Searching the web for', WebFetch: 'Reading' }[e.name] || e.name} ${e.what}`); if (e.name === 'Read' && e.path) m.read.push(e.path); if (/^Web/.test(e.name)) m.usedWeb = true; m.live = ''; draw_(); }
        else if (e.t === 'model') { m.model = e.model; }
        else if (e.t === 'turn') { m.live = ''; }
        else if (e.t === 'delta') { m.live += e.text; soon_(); }
        else if (e.t === 'done') { m.text = e.text || m.live; m.secs = e.seconds; m.usage = e.usage || null; if (m.usage && m.usage.model) m.model = m.usage.model; }
        else if (e.t === 'error') { if (e.billing) { A.claude = { state: 'billing', auth: { why: e.text } }; throw new Error('billing'); } throw new Error(e.text); }
      }
    }
    if (!m.text) m.text = m.live;
    if (!m.text) throw new Error('Claude Code ended without an answer.');
  }
  async function runGroq(m, prompt, now, o) {
    o = o || {};
    const soon_ = o.soon || drawSoon;
    const key = groqKey();
    if (!key) throw new Error('nokey');
    let lastErr;
    /* gpt-oss-120b with Groq's built-in browser search when Web is on; then without the web; then Llama 3.3 */
    const tries = (A.web ? [[GROQ_MODELS[0], true]] : []).concat(GROQ_MODELS.map(x => [x, false]));
    for (const [model, web] of tries) {
      const req = { model, temperature: 0.2, stream: true, messages: [{ role: 'system', content: o.system ? o.system('groq', web) : SYSTEM(now, 'groq', web) }, { role: 'user', content: prompt }] };
      if (model.startsWith('openai/')) { req.reasoning_effort = 'low'; req.max_completion_tokens = 1800; } else req.max_tokens = 1400;
      if (web) { req.tools = [{ type: 'browser_search' }]; req.tool_choice = 'auto'; }
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', signal: o.signal || A.ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(req) });
      if (r.status === 401) throw new Error('badkey');
      if (r.status === 400 || r.status === 403 || r.status === 404) {          // model or tool not available on this key: try the next option
        const j = await r.json().catch(() => ({}));
        lastErr = (j.error && j.error.message) || `Groq said ${r.status}.`;
        if (web) m.webFail = true;
        continue;
      }
      if (r.status === 429 || r.status === 413 || r.status >= 500) {
        const ra = r.headers.get('retry-after');
        lastErr = r.status === 429 ? `Groq's free limit is used up for now${ra ? `; try again in about ${Math.ceil(+ra)} s` : ''}.` : r.status === 413 ? 'The question plus sources was too long for Groq.' : `Groq is having trouble (${r.status}).`;
        continue;
      }
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j.error && j.error.message) || `Groq said ${r.status}.`); }
      m.model = model; m.usedWeb = web;
      const rd = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const d = line.slice(5).trim();
          if (d === '[DONE]') continue;
          try { const j = JSON.parse(d); const t = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content; if (t) { m.live += t; soon_(); } } catch (x) { /* partial line */ }
        }
      }
      m.text = m.live;
      if (!m.text.trim()) throw new Error('Groq sent back an empty answer.');
      return;
    }
    throw new Error(lastErr || 'Groq could not answer.');
  }

  /* ---------------- asking */
  async function ask(q) {
    q = q.trim();
    if (!q || A.busy) return;
    const keep = () => { qa.value = q; fit(); return draw(); };      // can't answer yet: leave the question in the box
    if (A.engine === 'groq' && !groqKey()) return keep();
    if (A.engine === 'claude' && (!A.claude || A.claude.state !== 'ok')) { await claudeStatus(true); if (A.claude.state !== 'ok') return keep(); }
    A.msgs.push({ role: 'user', text: q, done: true });
    const m = { role: 'ai', engine: A.engine, text: '', live: '', steps: ['Finding sources in your files'], read: [], sources: [], done: false, t0: Date.now() };
    A.msgs.push(m);
    A.busy = true; A.ctrl = new AbortController();
    qa.value = ''; fit();
    draw();
    A.tick = setInterval(() => { const el = panel.querySelector('.ap-secs'); if (el) el.textContent = Math.round((Date.now() - m.t0) / 1000) + ' s'; }, 1000);
    try {
      await IDX.ready();
      const now = new Date();
      m.sources = buildSources(q, m.engine);
      /* the lightest model that fits: Haiku for logistics (deadlines, marks, timetable), Sonnet for everything else */
      m.claudeModel = LOGISTICS.test(q.toLowerCase()) && !/explain|derive|why|how does|prove|show that/i.test(q) ? 'haiku' : 'sonnet';
      m.steps.push(`${m.sources.length} sources found` + (m.engine === 'claude' ? '; asking Claude' : '; asking Groq'));
      draw();
      const prompt = promptFor(q, m.sources);
      if (m.engine === 'claude') await runClaude(m, prompt, now); else await runGroq(m, prompt, now);
      m.secs = m.secs || Math.round((Date.now() - m.t0) / 100) / 10;
    } catch (e) {
      if (e.name === 'AbortError') { m.err = 'Stopped.'; }
      else if (e.message === 'nokey' || e.message === 'badkey') { m.err = e.message === 'badkey' ? 'Groq rejected the key. Paste a new one below.' : 'Add a Groq key first.'; if (e.message === 'badkey') save('icd-groq-key', ''); }
      else if (e.message === 'restart') m.err = 'The dashboard server needs a restart first (see below).';
      else if (e.message === 'billing') m.err = 'Not asked: Claude Code on this Mac would have used paid API credits (see below). Nothing was charged.';
      else m.err = /not logged in|login|authenticat|invalid api key|credential/i.test(e.message) ? 'Claude Code isn\'t logged in on this Mac. Open Terminal, run claude, log in with your Pro account, then type /exit and ask again.' : e.message;
    } finally {
      clearInterval(A.tick);
      m.done = true; A.busy = false; A.ctrl = null;
      if (!m.text) m.text = m.live;
      draw(true);
      if (A.open) qa.focus();
    }
  }

  /* ---------------- drawing */
  let soonT = null;
  function drawSoon() { if (!soonT) soonT = setTimeout(() => { soonT = null; draw(); }, 90); }
  const fileForPath = p => { p = String(p || '').trim().replace(/^\.\//, ''); const f = IDX.files.find(f => f.orig === p || f.txt === p || f.orig.endsWith('/' + p) || f.txt.endsWith('/' + p)); return f ? f.orig : p.replace(/\.txt$/, '.pdf'); };
  /* the answer, with [S2] and [file: …] turned into small linked chips */
  function answerHTML(m) {
    const store = [];
    const put = html => { store.push(html); return `@@CITE${store.length - 1}@@`; };
    let src = String(m.text || m.live || '');
    src = src.replace(/\[((?:S\d+\s*[,;]?\s*)+)\]/g, (all, ids) => ids.match(/S\d+/g).map(id => {
      const s = m.sources.find(x => x.id === id);
      if (!s) return '';
      s.cited = true;
      return put(`<a class="cite" href="${esc(s.href)}"${s.ext ? ' target="_blank" rel="noopener"' : ''} data-sid="${id}" title="${esc(s.short)}">${id.slice(1)}</a>`);
    }).join(''));
    src = src.replace(/\[file:\s*([^\]\s][^\]]*?)(?:\s+p\.?\s*(\d+))?\s*\]/gi, (all, p, page) => {
      const path = fileForPath(p);
      return put(`<a class="cite file" href="${esc(pdfAt(path, page))}" target="_blank" rel="noopener" title="${esc(path)}">${esc(path.split('/').pop().replace(/\.(pdf|md|txt)$/i, ''))}${page ? ' p.' + page : ''}</a>`);
    });
    return mdHTML(src, '').replace(/@@CITE(\d+)@@/g, (_, i) => store[+i]);
  }
  function sourcesHTML(m) {
    const list = m.sources.filter(s => s.cited);
    const read = [...new Set(m.read)].map(p => p.replace(/^.*?\/(modules|year|calendar|revision)\//, '$1/')).filter(p => !/\.md$/.test(p) || /lecture-summaries/.test(p));
    if (!list.length && !read.length) return m.sources.length && m.done && !m.err ? `<div class="ap-src"><span class="ap-src-h">Sources checked</span>${m.sources.slice(0, 6).map(s => srcLink(s)).join('')}</div>` : '';
    return `<div class="ap-src"><span class="ap-src-h">Sources</span>${list.map(s => srcLink(s)).join('')}${read.map(p => { const o = fileForPath(p); return `<a href="${esc(fileUrl(o))}" target="_blank" rel="noopener" class="ap-s"><b>file</b>${esc(o.split('/').pop())}</a>`; }).join('')}</div>`;
  }
  const MODEL_NAMES = [[/opus/i, 'Opus'], [/sonnet/i, 'Sonnet'], [/haiku/i, 'Haiku'], [/fable/i, 'Fable'], [/compound/i, 'Groq Compound (web)'], [/gpt-oss/i, 'Groq · gpt-oss-120b'], [/llama/i, 'Groq · Llama 3.3 70B']];
  const kTok = n => n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
  function metaTxt(m) {
    const name = m.model ? ((MODEL_NAMES.find(([re]) => re.test(m.model)) || [, m.model])[1]) : (m.engine === 'claude' ? 'Claude' : 'Groq');
    const bits = [m.engine === 'claude' ? `Claude ${name}` : name, `${m.secs} s`];
    const u = m.usage;
    if (u) {
      const tok = (u.input || 0) + (u.cache_read || 0) + (u.cache_write || 0) + (u.output || 0);
      if (tok) bits.push(`${kTok(tok)} tokens${u.turns > 1 ? ` over ${u.turns} steps` : ''}`);
      if (u.cost_usd != null) bits.push(`≈ $${u.cost_usd.toFixed(3)} if it were billed at API prices (it isn't: Claude subscription${A.claude && A.claude.auth && A.claude.auth.plan ? ', ' + A.claude.auth.plan : ''})`);
    }
    if (m.usedWeb) bits.push(m.engine === 'groq' ? 'web on' : 'used the web');
    if (m.webFail) bits.push("Groq's web search isn't available on this key, so it answered without it");
    return bits.join(' · ');
  }
  function practiceHTML(m) {
    const P = m.sources && m.sources.practice;
    if (!P || (!P.qs.length && !P.papers.length)) return '';
    return `<div class="ap-src ap-prac"><span class="ap-src-h">Practise</span>${P.qs.slice(0, 5).map(x => `<a href="${esc(x.href)}" class="ap-s q-${esc(x.status || 'none')}" data-qgo="${esc(x.go.q)}" title="${esc(x.topic)}"><b>${esc(Q_WORD[x.status] || 'Q')}</b>${esc(x.label)}</a>`).join('')}${P.papers.map(x => `<a href="${esc(x.href)}" target="_blank" rel="noopener" class="ap-s"><b>paper</b>${esc(x.label.replace(/^.*?past paper: /, ''))}</a>`).join('')}</div>`;
  }
  const srcLink = s => `<a href="${esc(s.href)}"${s.ext ? ' target="_blank" rel="noopener"' : ''} class="ap-s" data-sid="${s.id}"><b>${s.id.slice(1)}</b>${esc(s.short)}</a>${s.canvas ? `<a href="${esc(s.canvas)}" target="_blank" rel="noopener" class="ap-cv" title="Open on Canvas">Canvas ↗</a>` : ''}`;

  function setupHTML() {
    if (A.engine === 'groq' && !groqKey()) return `<div class="ap-setup"><b>Add a free Groq key (one time, no card)</b>
      <ol><li>Open <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> and sign in (Google works).</li>
      <li>Click <i>Create API Key</i>, give it any name, and copy it.</li><li>Paste it here and save.</li></ol>
      <div class="ap-keyrow"><input type="password" id="ap-key" placeholder="gsk_…" autocomplete="off" spellcheck="false" aria-label="Groq API key"><button type="button" class="btn solid" data-apkey>Save</button></div>
      <small>The key stays in this browser on your Mac. Each question and the matching bits of your notes are sent to Groq to write the answer.</small></div>`;
    if (A.engine === 'claude' && A.claude && A.claude.state === 'restart') return `<div class="ap-setup"><b>One restart to switch Claude on</b>
      <p>The dashboard server on your Mac is still the old version. Click <i>Imperial Dashboard</i> in your Dock (it restarts the server by itself), or quit and reopen it, then refresh this page.</p>
      <button type="button" class="btn" data-apcheck>Check again</button></div>`;
    if (A.engine === 'claude' && A.claude && A.claude.state === 'billing') { const a = A.claude.auth || {};
      return `<div class="ap-setup inline"><b>Claude is switched off: it would use API credits</b>
      <p>${esc(a.why || 'Claude Code on this Mac is not signed in with your Claude subscription.')} The dashboard now checks this before every question and won't ask Claude until it's on your Pro plan.</p>
      <ol><li>Open <i>Terminal</i> and run <code>claude auth logout</code>, then <code>claude auth login</code>. In the browser, sign in with your <strong>Claude account</strong> (the one with Pro), not the Anthropic Console.</li>
      <li>Run <code>claude auth status</code>. It should say <code>"authMethod": "claude.ai"</code> and <code>"subscriptionType": "pro"</code>, with no <code>apiKeySource</code> line.</li>
      <li>Still shows an <code>apiKeySource</code>? Something sets a key: run <code>echo $ANTHROPIC_API_KEY</code>, and look in <code>~/.claude/settings.json</code> for <code>ANTHROPIC_API_KEY</code> or <code>apiKeyHelper</code>, and remove it.</li>
      <li>Press <i>Check again</i>.</li></ol>
      <button type="button" class="btn" data-apcheck>Check again</button>
      <small>Groq (free key) still works in the meantime.</small></div>`; }
    if (A.engine === 'claude' && A.claude && A.claude.state === 'missing') return `<div class="ap-setup"><b>Set up Claude Code on this Mac (one time, ~2 minutes)</b>
      <ol><li>Open <i>Terminal</i> and run:<code>curl -fsSL https://claude.ai/install.sh | bash</code></li>
      <li>Then run <code>claude</code>, choose to log in with your Claude account (subscription), sign in with your Pro account, and type <code>/exit</code>.</li>
      <li>Come back and press <i>Check again</i>.</li></ol>
      <button type="button" class="btn" data-apcheck>Check again</button>
      <small>Answers then use your Pro plan's usage (the same limits as your chats), never paid API credits. Claude can only read your dashboard folder, not change it.</small></div>`;
    return '';
  }
  const LOGISTICS = /\b(due|deadline|submit|hand(ed)? in|when is|when's|when are|what's next|this week|next week|today|tomorrow|overdue|mark|marks|grade|score|average|timetable|lecture times?|room|where is|exam dates?|key dates?|term|lab group|partner)\b/;
  const SUGGEST = ["What's due in the next two weeks?", 'Explain the Eddington luminosity', 'How is the Lab module marked?', 'What do I need for DE Problem Sheet 5?', 'When are my exams?', "What's the difference between phase and group velocity?"];
  function draw(final) {
    $('.ap-eng', panel).querySelectorAll('button').forEach(b => { const on = b.dataset.eng === A.engine; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    const wb = $('.ap-web', panel); wb.classList.toggle('on', A.web); wb.setAttribute('aria-pressed', A.web);
    $('.ap-engine-note', panel).textContent = A.engine === 'claude' ? (A.claude && A.claude.state === 'billing' ? 'Claude is off: it would bill API credits' : A.serverV && A.serverV < '2026-11-09-ask3' ? 'Click Imperial Dashboard in your Dock once more for the lowest token use' : `Claude (Haiku or Sonnet) · ${A.claude && A.claude.auth && A.claude.auth.ok ? 'checked: your ' + (A.claude.auth.plan ? A.claude.auth.plan[0].toUpperCase() + A.claude.auth.plan.slice(1) + ' ' : '') + 'plan' : 'Claude subscription only'}${A.web ? ' · web on' : ''}`) : `Groq · ${groqKey() ? 'free key saved' : 'no key yet'}${A.web ? ' · web on' : ''}`;
    const setup = setupHTML();
    let html = '';
    if (!A.msgs.length) html = `<div class="ap-empty"><p>Ask anything about your modules, notes, problem sheets, deadlines, marks or timetable. Each answer cites the files it came from, and says so when your files don't cover it.</p>
      <div class="ap-sugg">${SUGGEST.map(s => `<button type="button" data-apsugg="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
    for (const m of A.msgs) {
      if (m.role === 'user') { html += `<div class="ap-msg u">${esc(m.text)}</div>`; continue; }
      const working = !m.done;
      html += `<div class="ap-msg ai${m.err ? ' err' : ''}">`;
      if (working) html += `<div class="ap-steps"><span class="ap-spin" aria-hidden="true"></span><span>${esc(m.steps[m.steps.length - 1])}…</span><span class="ap-secs">${Math.round((Date.now() - m.t0) / 1000)} s</span><button type="button" class="linkbtn" data-apstop>Stop</button></div>`;
      if (m.text || m.live) html += `<div class="ap-ans md">${answerHTML(m)}</div>`;
      if (m.err) html += `<div class="ap-err">${esc(m.err)}</div>`;
      if (m.done && !m.err) html += practiceHTML(m) + sourcesHTML(m) + `<div class="ap-meta">${esc(metaTxt(m))}</div>`;
      html += '</div>';
    }
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
    body.innerHTML = html + setup;
    body.querySelectorAll('.ap-ans').forEach(typeset);
    if (atBottom || final) body.scrollTop = body.scrollHeight;
    $('.ap-send', panel).disabled = A.busy;
  }

  /* ---------------- open, close, keys */
  function openAsk() {
    if (A.open) return qa.focus();
    if (IDX.closeSearch) IDX.closeSearch();
    A.open = true;
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('on'));
    pill.setAttribute('aria-expanded', 'true'); bar.classList.add('asking');
    IDX.ready();
    fetch('/api/server-version', { cache: 'no-store' }).then(r => r.json()).then(j => { A.serverV = j.version; draw(); }).catch(() => {});
    if (A.engine === 'claude' && (!A.claude || A.claude.state !== 'ok')) claudeStatus(true).then(() => draw());
    draw(true);
    setTimeout(() => qa.focus(), 30);
  }
  function closeAsk() {
    if (!A.open) return;
    A.open = false;
    panel.classList.remove('on');
    pill.setAttribute('aria-expanded', 'false'); bar.classList.remove('asking');
    setTimeout(() => { if (!A.open) panel.hidden = true; }, 200);
  }
  const fit = () => { qa.style.height = 'auto'; qa.style.height = Math.min(qa.scrollHeight, 160) + 'px'; };
  pill.addEventListener('click', () => (A.open ? closeAsk() : openAsk()));
  form.addEventListener('submit', e => { e.preventDefault(); ask(qa.value); });
  qa.addEventListener('input', fit);
  qa.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(qa.value); } });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeAsk(); pill.focus(); } });
  panel.addEventListener('click', async e => {
    const eng = e.target.closest('[data-eng]');
    if (e.target.closest('[data-apweb]')) { A.web = !A.web; save('icd-ask-web', A.web ? 'on' : 'off'); draw(); return qa.focus(); }
    if (eng) { A.engine = eng.dataset.eng; save('icd-ask-engine', A.engine); if (A.engine === 'claude') await claudeStatus(true); draw(true); return qa.focus(); }
    if (e.target.closest('[data-apclose]')) return closeAsk();
    if (e.target.closest('[data-apclear]')) { if (A.ctrl) A.ctrl.abort(); A.msgs = []; draw(); return qa.focus(); }
    if (e.target.closest('[data-apstop]')) { if (A.ctrl) A.ctrl.abort(); return; }
    const sg = e.target.closest('[data-apsugg]');
    if (sg) return ask(sg.dataset.apsugg);
    if (e.target.closest('[data-apcheck]')) { await claudeStatus(true); return draw(true); }
    if (e.target.closest('[data-apkey]')) {
      const v = ($('#ap-key', panel).value || '').trim();
      if (!/^gsk_\w{20,}/.test(v)) { toast("That doesn't look like a Groq key (they start with gsk_).", null, true); return; }
      save('icd-groq-key', v); toast('Groq key saved in this browser.'); draw(true); return qa.focus();
    }
    const a = e.target.closest('a[href^="#"]');
    if (a) {                                   // a source inside the dashboard: go there, keep the chat for later
      const s = A.msgs.flatMap(m => m.sources || []).find(x => x.href === a.getAttribute('href') && x.go);
      if (s && s.go.sheet) state.pending = { q: s.go.q };
      if (a.dataset.qgo) state.pending = { q: a.dataset.qgo };
      closeAsk();
    }
  });
  document.addEventListener('mousedown', e => { if (A.open && !e.target.closest('.ap') && !e.target.closest('.ask') && !e.target.closest('.toast')) closeAsk(); });
  document.addEventListener('icd:search-open', closeAsk);
  addEventListener('hashchange', closeAsk);

  /* fit the pill into the space left of the nav (icon only when it's tight; phones put it at the start of the nav row) */
  function layout() {
    bar.classList.remove('ab-wide', 'ab-compact');
    if (innerWidth <= 720) return;
    const nav = $('.nav-main').getBoundingClientRect(), name = $('.top .name').getBoundingClientRect();
    bar.classList.add(nav.left - name.right - 8 - 24 >= 92 ? 'ab-wide' : 'ab-compact');
  }
  layout();
  addEventListener('resize', layout);
  document.fonts.ready.then(layout);

  /* shared with the study buddy on the revision pages (buddy.js) */
  window.icdAsk = { A, saved, claudeStatus, groqKey, runClaude, runGroq, answerHTML, sourcesHTML, practiceHTML, metaTxt, qTerms, chunks, fileSources,
    practice, dateLong, canvasFor, CLAUDE_EXTRA, openAsk, count,
    askNow(q) { openAsk(); ask(q); },
    fill(q) { openAsk(); qa.value = q; fit(); setTimeout(() => { qa.focus(); qa.setSelectionRange(q.length, q.length); }, 40); } };
  document.dispatchEvent(new Event('icd:ask-ready'));
})();
