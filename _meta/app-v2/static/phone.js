/* ---------------------------------------------------------------- snapshot for the phone page
   window.icdPhoneSnapshot() gathers what the "on the go" page (a private claude.ai page) shows, worked out by the same
   code as the dashboard: marked deadlines and to-dos, the next 14 days (classes, revision sessions, deadlines),
   marks, progress and the heads-up items. _meta/dev/make_phone_page.py turns it into the page; see
   _meta/app-v2/phone/README.md for how it is refreshed. Nothing here changes any file. */
(() => {
  const isoT = d => d ? `${iso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}` : null;
  const text = html => { const t = document.createElement('template'); t.innerHTML = html; return t.content.textContent.replace(/\s+/g, ' ').trim(); };
  window.icdPhoneSnapshot = () => {
    const now = new Date(), ov = state.ov;
    if (!ov || !state.gr || !state.tp) throw new Error('the dashboard has not finished loading');
    /* deadlines: marked work, plus to-dos that aren't marked */
    const M = dlModel(now);
    const deadlines = M.list.map(x => ({ title: x.title, mod: modShort(x.module), due: isoT(x.d), timed: x.timed, end: isoT(x.end), done: x.done, doneLabel: x.doneLabel,
      worth: x.worth.short, worthLong: x.worth.parts.join(' · '), hours: x.hours || null, about: x.about || null, url: x.url || null }));
    const todos = (ov.deadlines || []).filter(x => !isMarked(x) && !isDone(x) && parseDue(x.due) && x.status !== 'prep')
      .map(x => ({ title: (/^[A-Z]{4}\d{5}$/.test(x.module) ? '' : modShort(x.module) + ': ') + tidy(x.item), due: isoT(parseDue(x.due)), timed: hasTime(x.due), url: x.url || null, about: x.about || null }));
    /* the next 14 days, exactly as the week ahead shows them */
    const days = [];
    for (let i = 0; i < 14; i++) {
      const d = addDays(dayStart(now), i);
      days.push({ date: iso(d), events: eventsOn(ov, d, now).map(e => ({ kind: e.kind, a: e.a, b: e.b ?? null, time: e.time, name: e.name, maybe: !!e.maybe, done: !!e.done })) });
    }
    /* marks */
    const Y = yearModel(buildMarks(state.gr));
    const waiting = marksWaiting(Y).map(x => { const rd = returnDate(x.it); return { name: tidyMark(x.it.name), mod: x.mod.short, back: rd && rd.d ? iso(rd.d) : null, est: !!(rd && rd.est), worth: PASS_FAIL.has(x.mod.code) ? 'pass/fail' : `${pc(x.yw, 1)}% of the year` }; });
    const marked = Y.counted.filter(x => x.frac != null).sort((a, b) => b.when - a.when).slice(0, 8).map(x => ({ name: tidyMark(x.it.name), mod: x.mod.short, pct: Math.round(100 * x.frac) }));
    /* progress */
    const S = sheetsModel(now), R = revModel(now), P = buildPlan(now);
    const cur = S.cur ? (() => { const r = sheetData(S.cur.code, S.cur.id), xs = entriesOf(questionGroups(r)), x = xs.length ? pickEntry(xs) : null; return `${modOf(S.cur.code)[0]} ${S.cur.label}${x ? ', ' + entryName(x) : ''}`; })() : null;
    const nx = P && P.sessions[0], nt = nx && R.byId.get(nx.id);
    return {
      generated: isoT(now), version: 1,
      deadlines, todos, days,
      marks: { avg: Y.avg, banked: Y.banked, markedW: Y.markedW, waiting, recent: marked, need: [60, 70, 85].map(g => ({ g, need: Y.need(g) })) },
      sheets: { done: S.total.done, total: S.total.total, mods: S.mods.map(m => ({ short: m.short, done: m.c.done, total: m.c.total })), cont: cur },
      revision: { ok: R.tot.ok, total: R.tot.total, mods: R.mods.map(m => ({ short: m.short, ok: m.c.ok, total: m.c.total })),
        next: nt ? { when: isoT(nx.t0), topic: nt.topic, mod: modOf(nt.module)[0] } : null, cards: window.icdCardsDue ? icdCardsDue(now) : 0 },
      heads: window.icdHeadsItems ? icdHeadsItems(now) : [],
      synced: ov.last_sync || null,
    };
  };
})();
