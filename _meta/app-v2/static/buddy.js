/* ---------------------------------------------------------------- study buddy
   A chat beside each revision topic, about that topic only. It is given the topic's main points and key
   equations, the notes pages the topic covers, the lecture summary, the linked problem-sheet questions,
   matching past-paper pages and the module's assessment details, and is told to do two things well:
   make it click (plain, intuitive explanations, the physical picture before the maths) and make it
   exam-ready (exactly what to be able to state, derive and calculate). Uses the same engine as Ask
   (Claude on your Pro plan, or Groq). Each topic keeps its own conversation while the page is open. */
(() => {
  let K = null;                                   // Ask's shared engine and helpers (window.icdAsk)
  const B = { chats: new Map(), busy: null, ctrl: null, tick: null, assess: new Map() };
  const IDX = () => window.icdIndex;

  /* viva: five questions, one at a time, each marked out of 2, ending in a line the page turns into a status button */
  const VIVA = 'Give me a viva on this topic. Ask exactly five questions, one at a time, going from easy to exam level (state a result, explain the physics, derive or calculate). Wait for my answer each time. After each answer, start with "Q<n>: <mark>/2" (2 = right, 1 = partly, 0 = wrong or missing) and a one- or two-line correction, then ask the next question. After my fifth answer, give the total and a short verdict on what to go over, and end with this exact last line: VIVA RESULT: <total>/10 · <Know it|Shaky|Don\'t know> (Know it for 8 to 10, Shaky for 5 to 7, Don\'t know for 0 to 4). Start with question 1 now.';
  const VIVA_RE = /VIVA RESULT:\s*(\d+)\s*\/\s*10\s*[·\-–—:]?\s*(Know it|Shaky|Don['’]t know)/i;
  /* the same viva read out loud, answered by voice (voice.js) */
  const SPOKEN = VIVA.replace('Start with question 1 now.', 'This is a SPOKEN viva: your questions and corrections are read aloud to me and I answer out loud through speech recognition. So keep every question to one or two short spoken sentences with as little notation as possible, write any maths in words ("h-bar omega over two"), read my answers generously (spoken maths, transcription slips like "sigh" for psi), and keep each correction to one or two sentences. Start with question 1 now.');
  const STARTERS = [
    ['Viva me (5 questions)', VIVA],
    ...(window.icdVoice && icdVoice.canSpeak ? [['Spoken viva (answer out loud)', SPOKEN]] : []),
    ['Explain it simply', 'Explain this topic simply and intuitively, as if I\'m seeing it for the first time. Big idea first, then the picture, then the maths.'],
    ['What do I need for the exam?', 'Exactly what do I need to know and be able to do for the exam on this topic? Give me a checklist: what to state, what to derive, what to calculate, and the typical question types.'],
    ['Give me the intuition', 'What is the intuitive physical picture behind the key equations here? What does each term actually mean?'],
    ['Walk me through an exam question', 'Walk me through a typical exam question on this topic step by step, the way I should write it in the exam.'],
    ['Common mistakes', 'What are the most common mistakes and traps on this topic, and how do I avoid them?'],
    ['Quiz me', 'Quiz me on this topic: ask me one short question at a time, wait for my answer, then tell me how I did before the next one.'],
  ];

  /* ---------------- what the buddy reads */
  const dirOf = t => ((t.notes || t.summary || '').match(/^modules\/([^/]+)\//) || [])[1];
  async function assessment(t) {
    const dir = dirOf(t);
    if (!dir) return '';
    if (!B.assess.has(dir)) {
      B.assess.set(dir, fetch(fileUrl(`modules/${dir}/assessment.md`), { cache: 'no-store' })
        .then(r => r.ok ? r.text() : '').then(x => x.replace(/^---\n[\s\S]*?\n---\n/, '').trim()).catch(() => ''));
    }
    const txt = await B.assess.get(dir);
    return txt.length > 1800 ? txt.slice(0, 1800) + '…' : txt;
  }
  const fileOf = p => IDX().files.find(f => f.orig === p);
  /* the notes pages this topic covers: from its page up to where the next topic in the same notes starts (at most 4 pages) */
  function notesPages(t) {
    const f = t.notes && fileOf(t.notes);
    if (!f) return [];
    const pages = f.pages ? f.raw.split('\f') : [f.raw];
    const from = Math.max(1, t.page || 1);
    const nexts = (state.tp || []).filter(x => x.notes === t.notes && (x.page || 1) > from).map(x => x.page);
    const to = Math.min(pages.length, from + 3, nexts.length ? Math.max(from, Math.min(...nexts)) : from + 3);
    const out = [];
    let used = 0;
    for (let p = from; p <= to; p++) {
      let text = (pages[p - 1] || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) continue;
      if (text.length > 2600) text = text.slice(0, 2600) + '…';
      if (used + text.length > 8000) break;
      used += text.length;
      out.push({ page: p, text, f });
    }
    return out;
  }
  function pastPapers(t, T) {
    if (!T.length) return [];
    const scored = K.chunks().filter(c => c.f.code === t.module && /Past paper/.test(c.f.kind))
      .map(c => { let n = 0, hit = 0; for (const x of T) { const k = K.count(c.low, x, 5); if (k) { n += 1 + Math.log(k); hit++; } } return { c, n: hit >= Math.min(2, T.length) ? n : 0 }; })
      .filter(o => o.n).sort((a, b) => b.n - a.n);
    const out = [], seen = new Set();
    for (const { c } of scored) {
      const k = c.f.orig + '#' + c.page;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(c);
      if (out.length >= 3) break;
    }
    return out;
  }
  async function sources(t, C, q, engine) {
    const big = engine === 'claude', S = [];
    const st = tStatus(t.confidence)[1];
    S.push({ label: `This revision topic: ${t.topic} (${modOf(t.module)[1]}, ${t.course} ${t.block}; ${t.lectured && !topicAhead(t) ? 'lectured ' + t.lectured : 'not lectured yet' + (t.upcoming ? ', expected ' + t.upcoming : '')}; how well he knows it: ${st})`,
      short: `Topic: ${t.topic}`, href: revHash(t.id), topicId: t.id,
      text: [C.points.length ? 'Main points:\n' + C.points.map(p => '- ' + p).join('\n') : '(no main points written yet)',
        C.eqs.length ? 'Key equations:\n' + C.eqs.map(e => `- ${e.label}: $${e.tex}$`).join('\n') : ''].filter(Boolean).join('\n\n') });
    for (const p of notesPages(t)) {
      const cv = K.canvasFor(t.notes);
      S.push({ label: `Lecture notes: ${p.f.title}, page ${p.page} (file ${t.notes}${cv ? '; on Canvas: ' + (cv.file || cv.page) : ''})`, short: `${p.f.title} · p.${p.page}`,
        href: pdfAt(t.notes, p.page), ext: true, canvas: cv && (cv.file || cv.page), path: t.notes, page: p.page, text: p.text });
    }
    const sf = t.summary && fileOf(t.summary);
    if (sf) S.push({ label: `Lecture summary: ${sf.title} (file ${t.summary})`, short: `Summary: ${sf.title}`, href: fileUrl(t.summary), ext: true,
      text: sf.raw.replace(/^---\n[\s\S]*?\n---\n/, '').slice(0, big ? 4500 : 3000) });
    for (const ref of (C.qs || []).slice(0, big ? 4 : 3)) {
      const [sid, n] = ref.split('/');
      const hit = y => y.id === sid && String(y.key).replace(/[a-h]$/, '') === n;
      const x = IDX().qs.find(y => hit(y) && y.code === t.module) || IDX().qs.find(hit);
      if (x) S.push({ label: `Problem sheet question on this topic: ${x.mod} ${x.sheet}, question ${String(x.label).replace(/[a-h]$/, '')} "${x.topic}"${x.status ? ' (his status: ' + (Q_WORD[x.status] || x.status) + ')' : ''}`,
        short: `${x.mod} ${x.sheet} Q${String(x.label).replace(/[a-h]$/, '')}`, href: sheetHash(x.code, x.id, String(x.key).replace(/[a-h]$/, '')), q: x,
        text: x.md.length > 800 ? x.md.slice(0, 800) + '…' : x.md });
    }
    const T = K.qTerms(`${t.topic} ${C.eqs.map(e => e.label).join(' ')}`).slice(0, 8);
    for (const c of pastPapers(t, T)) {
      const cv = K.canvasFor(c.f.orig);
      S.push({ label: `Past exam paper: ${c.f.title}${c.page ? ', page ' + c.page : ''} (${c.f.kind}; file ${c.f.orig})`, short: `${c.f.title}${c.page ? ' · p.' + c.page : ''}`,
        href: pdfAt(c.f.orig, c.page), ext: true, canvas: cv && (cv.file || cv.page), text: c.text.length > 1100 ? c.text.slice(0, 1100) + '…' : c.text });
    }
    const as = await assessment(t);
    if (as) S.push({ label: `How ${modOf(t.module)[1]} is assessed (assessment.md)`, short: 'Assessment', href: fileUrl(`modules/${dirOf(t)}/assessment.md`), ext: true, text: as });
    /* a follow-up that wanders a little: a couple of extra passages that match the question itself */
    const QT = K.qTerms(q);
    if (QT.length) {
      const have = new Set(S.map(s => (s.path || '') + '#' + (s.page || '')));
      const used = S.reduce((a, s) => a + s.text.length, 0);
      K.fileSources(QT, 3, Math.max(1500, (big ? 20000 : 14000) - used)).filter(s => !have.has(s.path + '#' + s.page)).forEach(s => S.push(s));
    }
    S.forEach((s, i) => { s.id = 'S' + (i + 1); });
    S.practice = K.practice(T, S);
    return S;
  }

  /* ---------------- how it talks */
  const SYSTEM = t => (engine, web) => `You are Omri's study buddy for ONE revision topic in his Year 2 MSci Physics course at Imperial College London (2026–27): "${t.topic}" (${modOf(t.module)[1]}, ${t.course}, ${t.block}). Today is ${K.dateLong(new Date())}. He has the topic page open with the notes beside you, and has marked this topic as "${tStatus(t.confidence)[1]}".

# Your two jobs
1. Make it click. Explain in simple, intuitive terms, like a friend who's great at physics: the big idea in one or two plain sentences first; then the physical picture or an everyday analogy; then the maths, one small step at a time, defining every symbol and saying what each term means physically. Use limiting cases, sanity checks ("what if $m\\to0$?") and "the trick is…" moments. Never hide a hard step behind "it can be shown".
2. Make him exam-ready. Be concrete about what he must be able to DO: definitions and statements to write down, results to derive (and from what), standard calculations, the typical question types and how they're phrased (use the past papers and problem-sheet questions in the sources), where marks are usually lost, and quick checks. When he asks what he needs for the exam, give a checklist with "Be able to…" items, most important first, each linked to where it is in his notes.

# Sources and honesty
- The numbered SOURCES [S1], [S2]… are his own notes, summary, questions, past papers and assessment details${engine === 'claude' ? ' (you can open more of his files too)' : ''}. Use the course's notation and results; cite straight after the claim, like [S2]. Never cite a source that doesn't say it.
- You may use your own physics knowledge to explain, but mark anything beyond his notes "(beyond your notes)". ${web ? 'You may search the web for a clearer explanation or a good resource; cite web facts as [title](URL).' : ''}
- If the past papers don't show how this topic is examined, say so and base exam advice on the problem sheets and notes. Never invent course facts, dates or mark schemes.
- Check equations for dimensions, signs and factors of 2 and π before you answer.
- For problem-sheet questions: hints and method first; full answers only if he asks or the solutions are out. Marked work (APS): hints only.

# Personality
Warm, relaxed and encouraging, like a friend explaining over coffee; natural sentences, "you" and "we", his name now and then. Say honestly when something is genuinely tricky. A light touch of humour or an analogy is welcome; no filler openings ("Great question!"), no sign-offs, rarely an emoji.

# Style
British English. Lead with the answer. Short paragraphs with **bold mini-headings** when the answer has parts; lists only when they help. LaTeX: $…$ inline, $$…$$ displayed. Usually 150–300 words; longer only for a derivation or worked question he asked for. If he's being quizzed, ask one question at a time and wait. End with a one-line **Try next:** pointing to the best question to practise (by name, from the sources) or a quick self-check question, unless you're mid-quiz.`;

  function promptFor(chat, q, S) {
    const hist = chat.msgs.filter(m => m.done && !m.err).slice(chat.viva ? -12 : -6).map(m => (m.role === 'user' ? 'Omri: ' : 'You: ') + m.text.replace(/\[(S\d+|file:[^\]]*)\]/g, '').slice(0, 900)).join('\n');
    const P = S.practice || { qs: [], papers: [] };
    const rel = P.qs.map(x => `- ${x.label}: ${x.topic}${x.status ? ' (' + (Q_WORD[x.status] || x.status) + ')' : ''}`).concat(P.papers.map(x => '- ' + x.label));
    return `SOURCES\n\n${S.map(s => `[${s.id}] ${s.label}\n${s.text}`).join('\n\n')}\n\n---\nQUESTIONS TO PRACTISE (for "Try next")\n${rel.length ? rel.join('\n') : '(none found)'}\n\n---\n${hist ? 'The conversation so far (context; cite the sources above, not this):\n' + hist + '\n---\n' : ''}OMRI: ${q}`;
  }

  /* ---------------- asking */
  const chatFor = id => { if (!B.chats.has(id)) B.chats.set(id, { msgs: [] }); return B.chats.get(id); };
  function ready() {
    if (!K) return 'loading';
    const A = K.A;
    if (A.engine === 'groq' && !K.groqKey()) return 'groq';
    if (A.engine === 'claude' && A.claude && A.claude.state !== 'ok') return 'claude';
    return 'ok';
  }
  async function ask(box, q) {
    q = String(q || '').trim();
    const t = topicOf(box);
    if (!q || !t || B.busy || !K) return;
    const A = K.A;
    if (A.engine === 'claude' && (!A.claude || A.claude.state !== 'ok')) await K.claudeStatus(true);
    if (ready() !== 'ok') { const qa = box.querySelector('.bd-q'); if (qa && q !== VIVA && q !== SPOKEN) { qa.value = q; fit(qa); } return draw(box); }      // keep the question for when it can answer
    const chat = chatFor(t.id), C = state.tcontent[t.id] || { points: [], eqs: [], qs: [] };
    if (q === VIVA || q === SPOKEN) chat.viva = true;
    if (q === SPOKEN) chat.voice = true;
    chat.msgs.push({ role: 'user', text: q === VIVA ? 'Viva me: five questions on this topic, marked as we go.' : q === SPOKEN ? 'Spoken viva: five questions read out loud, I answer out loud.' : q, done: true });
    const m = { role: 'ai', engine: A.engine, text: '', live: '', steps: ['Reading this topic\'s notes'], read: [], sources: [], done: false, t0: Date.now() };
    chat.msgs.push(m);
    B.busy = t.id; B.ctrl = new AbortController();
    const qa = box.querySelector('.bd-q'); if (qa) { qa.value = ''; fit(qa); }
    draw(box, true);
    B.tick = setInterval(() => { const el = curBox() && curBox().querySelector('.ap-secs'); if (el) el.textContent = Math.round((Date.now() - m.t0) / 1000) + ' s'; }, 1000);
    const redraw = () => { const b = curBox(); if (b && b.dataset.id === t.id) draw(b); };
    let soonT = null;
    const soon = () => { if (!soonT) soonT = setTimeout(() => { soonT = null; redraw(); }, 90); };
    try {
      await IDX().ready();
      m.sources = await sources(t, C, q, m.engine);
      m.claudeModel = 'sonnet';
      m.steps.push(`${m.sources.length} sources; asking ${m.engine === 'claude' ? 'Claude' : 'Groq'}`);
      redraw();
      const prompt = promptFor(chat, q, m.sources), o = { system: SYSTEM(t), signal: B.ctrl.signal, draw: redraw, soon };
      if (m.engine === 'claude') await K.runClaude(m, prompt, new Date(), o); else await K.runGroq(m, prompt, new Date(), o);
      m.secs = m.secs || Math.round((Date.now() - m.t0) / 100) / 10;
    } catch (e) {
      if (e.name === 'AbortError') m.err = 'Stopped.';
      else if (e.message === 'nokey' || e.message === 'badkey') m.err = 'Groq needs a key: open Ask (top left) to add one, or switch to Claude.';
      else if (e.message === 'restart') m.err = 'The dashboard server needs a restart: click Imperial Dashboard in your Dock, then refresh.';
      else if (e.message === 'billing') m.err = 'Not asked: Claude Code on this Mac would have used paid API credits. Open Ask (top left) to see how to switch it to your Pro plan, or use Groq.';
      else m.err = /not logged in|login|authenticat|invalid api key|credential/i.test(e.message) ? 'Claude Code isn\'t logged in on this Mac. Open Terminal, run claude, log in, then /exit and try again.' : e.message;
    } finally {
      clearInterval(B.tick);
      m.done = true; B.busy = null; B.ctrl = null;
      if (!m.text) m.text = m.live;
      const b = curBox();
      if (b && b.dataset.id === t.id) { draw(b, true); b.querySelector('.bd-q').focus({ preventScroll: true }); }
      /* spoken viva: read the answer out, then listen for his */
      if (chat.voice && b && b.dataset.id === t.id && window.icdVoice) {
        const over = !m.text || !!m.err || VIVA_RE.test(m.text);
        if (over) chat.voice = false;
        if (m.text && !m.err) icdVoice.speak(m.text, () => { const c = curBox(); if (!over && c && c.dataset.id === t.id) listenIn(c, true); });
        voiceBar(b);
      }
    }
  }
  function listenIn(box, auto) {
    const qa = box.querySelector('.bd-q');
    const ok = window.icdVoice && icdVoice.listen(qa, { autoSend: auto, onSend: txt => ask(box, txt),
      onError: () => toast('Allow the microphone for this page (Safari → Settings for This Website), or type your answer.', null, true) });
    if (!ok) toast(window.icdVoice && icdVoice.canListen ? "Couldn't start the microphone. Type your answer instead." : "This browser can't listen. Type your answer, or open the dashboard in Safari.", null, true);
    voiceBar(box);
  }
  /* the strip above the box: what the voice is doing, and the controls */
  function voiceBar(box) {
    if (!box || !window.icdVoice) return;
    const el = box.querySelector('.bd-voice'), chat = chatFor(box.dataset.id);
    const sp = icdVoice.speaking(), li = icdVoice.listening();
    const mic = box.querySelector('.bd-mic');
    if (mic) { mic.classList.toggle('on', li); mic.setAttribute('aria-pressed', li); mic.title = li ? 'Stop listening' + (chat.voice ? ' and send' : '') : 'Answer by voice'; }
    if (!el) return;
    el.hidden = !(sp || li || chat.voice);
    el.innerHTML = sp ? `<span class="bd-vdot sp"></span><span>Reading it out…</span><button type="button" class="linkbtn" data-bdv="answer">Answer now</button><button type="button" class="linkbtn" data-bdv="off">Stop voice</button>`
      : li ? `<span class="bd-vdot li"></span><span>${chat.voice ? 'Listening… pause, or say “that\'s my answer”, to send' : 'Listening…'}</span><button type="button" class="linkbtn" data-bdv="send">${chat.voice ? 'Send' : 'Done'}</button><button type="button" class="linkbtn" data-bdv="off">Stop</button>`
      : `<span class="bd-vdot"></span><span>Spoken viva</span><button type="button" class="linkbtn" data-bdv="again">Read it again</button><button type="button" class="linkbtn" data-bdv="answer">Answer</button><button type="button" class="linkbtn" data-bdv="off">Stop voice</button>`;
  }

  /* ---------------- drawing */
  const curBox = () => document.querySelector('.rv-buddy[data-id]');
  const topicOf = box => box && (state.tp || []).find(x => x.id === box.dataset.id);
  const fit = qa => { qa.style.height = 'auto'; qa.style.height = Math.min(qa.scrollHeight, 140) + 'px'; };
  function shell(box, t) {
    box.innerHTML = `
      <button type="button" class="bd-tab" data-bdtoggle aria-label="Open the study buddy" title="Study buddy"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/></svg><span>Study buddy</span></button>
      <div class="bd-card">
        <div class="bd-head"><div class="bd-title"><b>Study buddy</b><span>Ask anything about this topic</span></div>
          <button type="button" class="bd-vivab" data-bdsugg="${esc(VIVA)}" title="Five questions on this topic, marked as you go">Viva</button>
          ${window.icdVoice && icdVoice.canSpeak ? `<button type="button" class="ap-icon bd-spk" data-bdsugg="${esc(SPOKEN)}" title="Spoken viva: questions read out, you answer out loud" aria-label="Spoken viva"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>` : ''}
          <button type="button" class="ap-icon" data-bdclear title="New chat about this topic" aria-label="New chat">⟲</button>
          <button type="button" class="ap-icon bd-hide" data-bdtoggle title="Hide the study buddy" aria-label="Hide the study buddy">→</button></div>
        <div class="bd-body" aria-live="polite"></div>
        <form class="bd-form" autocomplete="off"><textarea class="bd-q" rows="1" placeholder="Ask about this topic…" title="Ask about ${esc(t.topic)}" aria-label="Your question about ${esc(t.topic)}"></textarea>${window.icdVoice && icdVoice.canListen ? '<button type="button" class="bd-mic" data-bdmic aria-pressed="false" title="Answer by voice" aria-label="Speak instead of typing"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>' : ''}<button type="submit" class="ap-send" aria-label="Ask">↑</button></form>
        <div class="bd-voice" hidden></div>
        <div class="bd-foot"><span class="bd-eng"></span><span>Explains simply · exam-focused · cites your notes</span></div>
      </div>`;
  }
  function draw(box, final) {
    const t = topicOf(box);
    if (!t) return;
    const chat = chatFor(t.id), body = box.querySelector('.bd-body');
    let html = '';
    if (!chat.msgs.length) html = `<div class="bd-empty"><p>Hi Omri! I've read the notes for <b>${esc(t.topic)}</b>. Ask me anything, or start with one of these:</p>
      <div class="ap-sugg">${STARTERS.map(([l, q]) => `<button type="button" data-bdsugg="${esc(q)}">${esc(l)}</button>`).join('')}</div></div>`;
    for (const m of chat.msgs) {
      if (m.role === 'user') { html += `<div class="ap-msg u">${esc(m.text)}</div>`; continue; }
      html += `<div class="ap-msg ai${m.err ? ' err' : ''}">`;
      if (!m.done) html += `<div class="ap-steps"><span class="ap-spin" aria-hidden="true"></span><span>${esc(m.steps[m.steps.length - 1])}…</span><span class="ap-secs">${Math.round((Date.now() - m.t0) / 1000)} s</span><button type="button" class="linkbtn" data-bdstop>Stop</button></div>`;
      if (m.text || m.live) html += `<div class="ap-ans md">${K.answerHTML(m)}</div>`;
      if (m.err) html += `<div class="ap-err">${esc(m.err)}</div>`;
      const vr = m.done && !m.err && String(m.text || '').match(VIVA_RE);
      if (vr) {
        const v = /know it/i.test(vr[2]) ? [5, 'ok', 'Know it'] : /shaky/i.test(vr[2]) ? [3, 'sh', 'Shaky'] : [1, 'dk', "Don't know"], cur = tStatus(t.confidence)[0];
        html += `<div class="bd-viva t-${v[1]}"><div><b>Viva: ${esc(vr[1])}/10</b><span>${cur === v[1] ? `Already marked ${esc(v[2])}` : `Suggests: ${esc(v[2])}`}</span></div>${cur === v[1] ? '' : `<button class="btn solid" data-ts="${v[0]}">Set topic to ${esc(v[2])}</button>`}</div>`;
      }
      if (m.done && !m.err) html += (chat.viva && !vr ? '' : K.practiceHTML(m) + K.sourcesHTML(m)) + `<div class="ap-meta">${esc(K.metaTxt(m))}</div>`;
      html += '</div>';
    }
    const r = ready();
    if (r === 'groq' || r === 'claude') html += `<div class="ap-setup"><b>${r === 'groq' ? 'Groq needs a free key first' : K.A.claude && K.A.claude.state === 'billing' ? 'Claude is off: it would use API credits' : 'Claude isn\'t ready on this Mac yet'}</b><p>${K.A.claude && K.A.claude.state === 'billing' ? 'Ask (top left) shows how to switch Claude Code to your Pro plan. Groq works meanwhile.' : 'Set it up once in Ask (it\'s shared with the study buddy).'}</p><button type="button" class="btn" data-bdsetup>Open Ask</button></div>`;
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
    body.innerHTML = html;
    body.querySelectorAll('.ap-ans').forEach(typeset);
    if (atBottom || final) body.scrollTop = body.scrollHeight;
    box.querySelector('.ap-send').disabled = !!B.busy;
    const A = K && K.A;
    box.querySelector('.bd-eng').innerHTML = A ? `<button type="button" class="linkbtn" data-bdeng title="Switch who answers (shared with Ask)">${A.engine === 'claude' ? 'Claude · Pro' : 'Groq · fast'} ⇄</button>` : '';
  }

  /* called by the revision page each time it draws a topic */
  function mount(box, t) {
    if (!box || !t) return;
    if (box.dataset.id === t.id && box.firstElementChild) return;
    if (window.icdVoice) icdVoice.stopAll();                     // another topic: stop talking or listening
    box.dataset.id = t.id;
    shell(box, t);
    if (K) draw(box, true); else box.querySelector('.bd-body').innerHTML = '<div class="bd-empty"><p>Getting ready…</p></div>';
  }
  function refresh() {
    const box = document.querySelector('.rv-buddy');
    const id = typeof revRoute === 'function' && revRoute(), t = id && (state.tp || []).find(x => x.id === id);
    if (box && t) { box.dataset.id = ''; mount(box, t); }
  }

  /* ---------------- clicks and keys (one listener for whichever topic is open) */
  document.addEventListener('click', async e => {
    const box = e.target.closest('.rv-buddy');
    if (!box) return;
    if (e.target.closest('[data-bdtoggle]')) {
      const off = !box.closest('.rv-body').classList.contains('buddy-off');
      box.closest('.rv-body').classList.toggle('buddy-off', off);
      save('icd-buddy', off ? 'off' : 'on');
      if (!off) setTimeout(() => box.querySelector('.bd-q').focus({ preventScroll: true }), 60);
      return;
    }
    if (!K) return;
    const sg = e.target.closest('[data-bdsugg]');
    if (sg) { if (sg.dataset.bdsugg === SPOKEN && window.icdVoice) icdVoice.unlock(); return ask(box, sg.dataset.bdsugg); }
    if (e.target.closest('[data-bdmic]')) {
      if (icdVoice.listening()) icdVoice.stopListening(chatFor(box.dataset.id).voice); else listenIn(box, !!chatFor(box.dataset.id).voice);
      return voiceBar(box);
    }
    const vb = e.target.closest('[data-bdv]');
    if (vb) {
      const chat = chatFor(box.dataset.id), v = vb.dataset.bdv, last = chat.msgs.filter(m => m.role === 'ai' && m.done && m.text).pop();
      if (v === 'off') { chat.voice = false; icdVoice.stopAll(); }
      if (v === 'send') icdVoice.stopListening(true);
      if (v === 'answer') listenIn(box, !!chat.voice);
      if (v === 'again' && last) icdVoice.speak(last.text, () => { if (chat.voice && curBox() === box) listenIn(box, true); });
      return voiceBar(box);
    }
    if (e.target.closest('[data-bdstop]')) { if (B.ctrl) B.ctrl.abort(); return; }
    if (e.target.closest('[data-bdclear]')) { if (window.icdVoice) icdVoice.stopAll(); if (B.ctrl && B.busy === box.dataset.id) B.ctrl.abort(); B.chats.delete(box.dataset.id); draw(box, true); return box.querySelector('.bd-q').focus(); }
    if (e.target.closest('[data-bdsetup]')) return K.openAsk();
    if (e.target.closest('[data-bdeng]')) {
      K.A.engine = K.A.engine === 'claude' ? 'groq' : 'claude'; save('icd-ask-engine', K.A.engine);
      if (K.A.engine === 'claude') await K.claudeStatus(true);
      return draw(box);
    }
    const a = e.target.closest('a[href^="#"]');
    if (a && a.dataset.qgo) state.pending = { q: a.dataset.qgo };
  });
  document.addEventListener('submit', e => {
    const box = e.target.closest('.rv-buddy');
    if (!box) return;
    e.preventDefault();
    ask(box, box.querySelector('.bd-q').value);
  });
  document.addEventListener('keydown', e => {
    if (!e.target.classList || !e.target.classList.contains('bd-q')) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(e.target.closest('.rv-buddy'), e.target.value); }
  });
  document.addEventListener('input', e => { if (e.target.classList && e.target.classList.contains('bd-q')) fit(e.target); });

  function start() {
    K = window.icdAsk;
    if (window.icdVoice) icdVoice.onState(() => voiceBar(curBox()));
    const A = K.A;
    if (A.engine === 'claude' && !A.claude) K.claudeStatus(false).then(() => { const b = curBox(); if (b) draw(b); });
    refresh();
  }
  /* used by highlight-to-ask (highlight.js): ask about a passage, or put it in the box to add your own question */
  function openBox() {
    const box = curBox(); if (!box) return null;
    const body = box.closest('.rv-body');
    if (body && body.classList.contains('buddy-off')) { body.classList.remove('buddy-off'); save('icd-buddy', 'on'); }
    return box;
  }
  function askHere(q) { const box = openBox(); if (box) ask(box, q); return !!box; }
  function fillHere(q) {
    const box = openBox(); if (!box) return false;
    const qa = box.querySelector('.bd-q'); qa.value = q; fit(qa); qa.focus(); qa.setSelectionRange(q.length, q.length);
    return true;
  }
  window.icdBuddy = { mount, refresh, askHere, fillHere, here: () => !!curBox() };
  if (window.icdAsk) start(); else document.addEventListener('icd:ask-ready', start, { once: true });
})();
