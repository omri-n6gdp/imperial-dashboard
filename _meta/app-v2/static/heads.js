/* ---------------------------------------------------------------- heads-up strip (Home)
   One slim card above the four Home cards with what needs you now and what has changed, so nothing that isn't
   marked work (and so isn't on the Deadlines page) slips past:
     - to-dos that aren't marked work: Student Essentials, pre-lab tasks (from deadlines.md items with no ids);
       tick them off here (saved to deadlines.md, with undo)
     - "things I need from you" (_meta/needs-from-you.md, ## Open), minus anything already shown as a deadline;
       ✕ hides one in this browser
     - new in the last week: sheets that came out, solutions that unlocked, marks that came back
     - coming in the next three days: sheets and solutions about to unlock
     - flashcards due today (cards.js), and a note when the data hasn't been synced for a few days
   Hidden when there's nothing to say. */
(() => {
  const DAYMS = 864e5;
  const dismissed = () => { try { return new Set(JSON.parse(localStorage.getItem('icd-hu-dismiss') || '[]')); } catch (e) { return new Set(); } };
  const hash = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return 'h' + (h >>> 0).toString(36); };
  const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 3);
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const plainMd = s => String(s || '').replace(/\*\*|`/g, '');

  /* "## Open" in needs-from-you.md: "1. **Title.** detail" */
  function needs() {
    const body = String((state.ov && state.ov.needs) || ''), m = body.match(/^## Open\s*\n([\s\S]*?)(?=^## |\s*$(?![\s\S]))/m);
    if (!m) return [];
    return m[1].split('\n').map(l => l.match(/^\s*\d+\.\s+(.+)$/)).filter(Boolean).map(x => {
      const t = x[1], b = t.match(/^\*\*(.+?)\*\*\s*(.*)$/);
      return { title: plainMd(b ? b[1] : t.split(/[.:;]/)[0]).replace(/\.$/, ''), detail: b ? b[2] : '', full: plainMd(t) };
    });
  }

  function items(now) {
    const ov = state.ov, out = [], gone = dismissed();
    const open = (ov.deadlines || []).filter(x => !isDone(x) && parseDue(x.due));
    /* to-dos that aren't marked work */
    for (const x of open.filter(x => !isMarked(x))) {
      const due = dueEnd(x), days = (due - now) / DAYMS;
      if (days > 35) continue;
      if (days < 0 && x.status === 'prep') continue;           // class prep is pointless once the class has happened
      const course = /^[A-Z]{4}\d{5}$/.test(x.module), name = course ? tidy(x.item) : modShort(x.module), what = course ? '' : tidy(x.item) + ' · ';
      out.push({ k: days < 0 ? 'late' : 'todo', p: days < 0 ? 0 : days < 3 ? 1 : 3, index: x.index, url: x.url,
        html: `<b>${esc(name)}</b><span>${esc(what)}${esc(days < 0 ? 'overdue' : 'due ' + shortDate(parseDue(x.due), now))}${hasTime(x.due) ? ' ' + hhmm(parseDue(x.due)) : ''}</span>`, title: `${tidy(x.item)}: ${x.about || ''}` });
    }
    /* things I need from you, unless a deadline already covers it */
    const dlText = open.map(x => (modShort(x.module) + ' ' + x.item).toLowerCase());
    for (const n of needs()) {
      const w = words(n.title), id = hash(n.title);
      if (gone.has(id) || (w.length && dlText.some(t => w.every(x => t.includes(x))))) continue;
      out.push({ k: 'need', p: 2, id, html: `<b>${esc(n.title)}</b><span class="hu-more">${inline(n.detail)}</span>`, title: n.full });
    }
    /* sheets and solutions: just out, and about to come out */
    let M = null;
    try { M = sheetsModel(now); } catch (e) { /* no sheets yet */ }
    const fresh = [], sols = [], soon = [];
    const when = (d, raw) => `${dayLabel(d, now)}${hasTime(raw) ? ' ' + hhmm(d) : ''}`;
    for (const s of (M ? M.sheets : [])) {
      const name = `${modOf(s.code)[0]} ${s.label}`, href = s.q ? sheetHash(s.code, s.id) : s.path ? fileUrl(s.path) : '#sheets';
      if (s.rel && s.rel <= now && now - s.rel < 7 * DAYMS && !(s.q && s.q.done === s.q.total)) fresh.push({ name, href, left: s.q ? s.q.total - s.q.done : null });
      if (s.rel && s.rel > now && s.rel - now < 3 * DAYMS) soon.push({ t: s.rel, txt: `${name} (${when(s.rel, s.released)})` });
      const sr = parseDue(s.solutions_release);
      if (sr && sr <= now && now - sr < 3 * DAYMS && s.kind !== 'seminar') sols.push({ name, href });
      if (sr && sr > now && sr - now < 3 * DAYMS && +sr !== +(s.rel || 0)) soon.push({ t: sr, txt: `${name} solutions (${when(sr, s.solutions_release)})` });
    }
    if (fresh.length === 1) out.push({ k: 'new', p: 4, href: fresh[0].href, html: `<b>New: ${esc(fresh[0].name)}</b><span>${fresh[0].left != null ? fresh[0].left + ' to do' : 'out this week'}</span>` });
    else if (fresh.length) out.push({ k: 'new', p: 4, href: '#sheets', html: `<b>${fresh.length} new sheets this week</b><span>${esc(fresh.map(x => x.name).join(', '))}</span>` });
    if (sols.length) out.push({ k: 'new', p: 4, href: sols.length === 1 ? sols[0].href : '#sheets', html: `<b>Solutions out</b><span>${esc(sols.map(x => x.name).join(', '))}</span>` });
    if (soon.length) out.push({ k: 'soon', p: 5, html: `<b>Coming out</b><span>${esc(soon.sort((a, b) => a.t - b.t).map(x => x.txt).join(', '))}</span>` });
    /* marks that came back this week */
    for (const m of state.gr || []) for (const it of m.items || []) {
      const back = anyDate(it.marks_back), f = fracOf(it);
      if (f != null && back && back <= now && now - back < 7 * DAYMS)
        out.push({ k: 'new', p: 3, href: '#marks', html: `<b>Mark back: ${esc(tidyMark(it.name))}</b><span>${pc(100 * f, 0)}%</span>` });
    }
    /* flashcards due (cards.js) */
    const due = window.icdCardsDue ? icdCardsDue(now) : 0;
    if (due) out.push({ k: 'cards', p: 4, href: '#revision/cards', html: `<b>${due} flashcard${due > 1 ? 's' : ''} due</b><span>about ${Math.max(1, Math.round(due * 12 / 60))} min</span>` });
    /* stale data */
    const ls = ymd(ov.last_sync), age = ls ? Math.floor((dayStart(now) - ls) / DAYMS) : null;
    if (age != null && age >= 3) out.push({ k: 'stale', p: 6, html: `<b>Canvas data is ${age} days old</b><span>last synced ${esc(dShort(ls))}</span>`, title: 'New files, marks and announcements since then are not in the dashboard yet.' });
    return out.sort((a, b) => a.p - b.p);
  }

  function chip(x) {
    const tag = x.href ? `a href="${esc(x.href)}"${/^\/file\//.test(x.href) ? ' target="_blank" rel="noopener"' : ''}` : 'div';
    const acts = [];
    if (x.url) acts.push(`<a class="hu-b" href="${esc(x.url)}" target="_blank" rel="noopener" title="Open on Canvas">Canvas ↗</a>`);
    if (x.index != null) acts.push(`<button class="tick hu-tick" aria-label="Mark as done" title="Mark as done"></button>`);
    if (x.id) acts.push(`<button class="hu-x" data-hudis="${x.id}" aria-label="Hide this" title="Hide this">✕</button>`);
    const tip = x.title || x.html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    return `<${tag} class="hu-i k-${x.k}"${x.index != null ? ` data-index="${x.index}"` : ''} title="${esc(tip)}">
      <i class="hu-dot" aria-hidden="true"></i><span class="hu-t">${x.html}</span>${acts.length ? `<span class="hu-acts">${acts.join('')}</span>` : ''}</${tag.split(' ')[0]}>`;
  }

  /* the same items as plain text, for the phone page (phone.js) */
  window.icdHeadsItems = now => items(now).map(x => {
    const t = document.createElement('template'); t.innerHTML = x.html;
    const b = t.content.querySelector('b'), sp = t.content.querySelector('span');
    return { k: x.k, title: b ? b.textContent.trim() : '', detail: sp ? sp.textContent.replace(/\s+/g, ' ').trim() : '', url: x.url || null };
  });

  window.renderHeadsUp = now => {
    const el = $('#w-heads');
    if (!el || !state.ov) return;
    const xs = items(now), show = xs.slice(0, 8);
    el.hidden = !xs.length;
    if (!xs.length) return;
    setHTML(el, `<div class="k"><span>Heads-up</span><span>${xs.length > show.length ? `${show.length} of ${xs.length}` : ''}</span></div>
      <div class="hu-list">${show.map(chip).join('')}</div>`);
  };

  document.addEventListener('click', e => {
    const x = e.target.closest('[data-hudis]');
    if (!x) return;
    e.preventDefault(); e.stopPropagation();
    const s = dismissed(); s.add(x.dataset.hudis);
    try { localStorage.setItem('icd-hu-dismiss', JSON.stringify([...s])); } catch (err) { /* storage off */ }
    render();
  }, true);
  /* the chip's own buttons shouldn't follow the chip's link */
  document.addEventListener('click', e => { if (e.target.closest('.hu-i .tick, .hu-i .hu-b')) { const a = e.target.closest('a.hu-i'); if (a && !e.target.closest('.hu-b')) e.preventDefault(); } }, true);
})();
