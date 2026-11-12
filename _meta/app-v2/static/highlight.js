/* ---------------------------------------------------------------- highlight to ask
   Select any text on the site (a lecture summary, a topic's main points, a problem-sheet question, a flashcard,
   an earlier answer) and a small bar appears: "Explain" sends it to the study buddy when a topic is open, or to
   Ask anywhere else; "Ask about it" puts it in the box so you can add your own question. Maths is sent as its
   LaTeX. The notes PDF can't be read from the page, so its tab has an "Explain copied text" button instead:
   copy a passage in the PDF (⌘C), then press it. */
(() => {
  const MAX = 1500;
  const bar = document.createElement('div');
  bar.id = 'hl-bar'; bar.hidden = true; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Ask about the selected text');
  bar.innerHTML = `<button type="button" data-hl="explain"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9z"/></svg>Explain</button><button type="button" data-hl="ask">Ask about it</button>`;
  document.body.appendChild(bar);
  let cur = null;

  /* the selected text, with KaTeX maths turned back into $LaTeX$ */
  function textOf(range) {
    const frag = range.cloneContents();
    frag.querySelectorAll('.katex-display, .katex').forEach(k => {
      if (!k.isConnected && !frag.contains(k)) return;
      const tex = k.querySelector('annotation[encoding="application/x-tex"]');
      const disp = k.classList.contains('katex-display');
      k.replaceWith(document.createTextNode(tex ? (disp ? ` $$${tex.textContent.trim()}$$ ` : `$${tex.textContent.trim()}$`) : k.textContent));
    });
    frag.querySelectorAll('button, .fc-hint, .ap-src, .ap-meta').forEach(x => x.remove());
    let s = frag.textContent.replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
    if (!s) s = String(window.getSelection()).trim();
    return s.length > MAX ? s.slice(0, MAX) + '…' : s;
  }
  /* where the text came from, so the answer knows what it's looking at */
  function sourceOf(el) {
    const q = el.closest('[data-qkey]');
    if (q) {
      const [, , n] = q.dataset.qkey.split('|'), h = document.querySelector('.sh-head h2');
      return `problem sheet ${h ? h.firstChild.textContent.trim() : ''}, question ${n}`.replace(/\s+/g, ' ');
    }
    if (el.closest('.rv-sum')) return 'the lecture summary';
    if (el.closest('.rv-info')) return "this topic's main points";
    if (el.closest('.rv-tabview[data-tab="cards"]')) return 'a flashcard';
    if (el.closest('.rv-tabview[data-tab="papers"]')) return 'a past paper';
    if (el.closest('.ap-msg.ai')) return 'your earlier answer';
    if (el.closest('.qextra, .sh-head')) return 'a problem sheet';
    return 'my dashboard';
  }
  const allowed = el => el && !el.closest('input, textarea, select, .nav-main, #hl-bar, #study-pill, .toast, header, .ap-msg.u')
    && !!el.closest('main.view, #ap, .rv-buddy');

  function hide() { bar.hidden = true; cur = null; }
  function check() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hide();
    const range = sel.getRangeAt(0), node = range.commonAncestorContainer, el = node.nodeType === 1 ? node : node.parentElement;
    if (!allowed(el)) return hide();
    const text = textOf(range);
    if (text.replace(/\s/g, '').length < 3) return hide();
    cur = { text, src: sourceOf(el), inBuddy: !!el.closest('.rv-buddy') };
    const rs = range.getClientRects(), r = rs.length ? rs[0] : range.getBoundingClientRect();
    const last = rs.length ? rs[rs.length - 1] : r;
    bar.hidden = false;
    const w = bar.offsetWidth, h = bar.offsetHeight, touch = matchMedia('(pointer: coarse)').matches;
    let top = touch ? last.bottom + 12 : r.top - h - 10;
    if (top < 70) top = last.bottom + 10;
    if (top + h > innerHeight - 8) top = innerHeight - h - 8;
    const left = Math.max(8, Math.min(innerWidth - w - 8, (touch ? last.left : r.left) + (touch ? 0 : Math.min(r.width, 400) / 2 - w / 2)));
    bar.style.top = top + 'px'; bar.style.left = left + 'px';
  }
  let t;
  const soon = ms => { clearTimeout(t); t = setTimeout(check, ms); };
  document.addEventListener('mouseup', e => { if (!(e.target.closest && e.target.closest('#hl-bar'))) soon(10); });
  document.addEventListener('keyup', e => { if (e.shiftKey || e.key === 'Shift') soon(10); });
  document.addEventListener('selectionchange', () => { if (!bar.hidden || matchMedia('(pointer: coarse)').matches) soon(250); });
  addEventListener('scroll', () => { if (!bar.hidden) hide(); }, { passive: true, capture: true });
  addEventListener('resize', hide);
  bar.addEventListener('mousedown', e => e.preventDefault());           // keep the selection when the bar is clicked

  const onTopic = () => window.icdBuddy && icdBuddy.here();
  function send(kind, text, src) {
    const quote = `"${text}"`;
    const explain = `Explain this from ${src} simply and intuitively: what it means, the physical picture, and why it matters${onTopic() ? '' : ' (and which topic and module it belongs to)'}.\n\n${quote}`;
    const about = `About this from ${src}:\n${quote}\n\n`;
    if (onTopic()) return kind === 'explain' ? icdBuddy.askHere(explain) : icdBuddy.fillHere(about);
    if (!window.icdAsk) return toast('Ask is still loading, try again in a moment.', null, true);
    if (kind === 'explain') icdAsk.askNow(explain); else icdAsk.fill(about);
  }
  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-hl]');
    if (!b || !cur) return;
    const c = cur;
    window.getSelection().removeAllRanges(); hide();
    send(b.dataset.hl, c.text, c.src);
  });

  /* the notes PDF: read what was copied from it */
  document.addEventListener('click', async e => {
    if (!e.target.closest('[data-hlclip]')) return;
    let text = '';
    try { text = (await navigator.clipboard.readText()).trim(); } catch (err) { /* refused */ }
    if (!text) return toast('Select a passage in the notes and copy it (⌘C) first, then press this again.', null, true);
    if (text.length > MAX) text = text.slice(0, MAX) + '…';
    send('explain', text.replace(/[ \t]+/g, ' '), 'the lecture notes');
  });
})();
