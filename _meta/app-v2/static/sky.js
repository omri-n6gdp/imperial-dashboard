/* ---------------------------------------------------------------- the sky (Revision → Sky)
   Every revision topic as a star. Each course is a constellation, its topics joined in teaching order; dashed lines
   join courses that lead into each other (Quantum Physics → Quantum Mechanics, Structure of Matter → Thermodynamics…).
   Brightness is how well you know a topic: know it = bright white, shaky = amber, don't know = coral,
   lectured but not looked at = dim, not lectured yet = faint. Click a star to open its topic. */
(() => {
  const LINKS = [['Quantum Physics', 'Quantum Mechanics'], ['Quantum Physics', 'Atomic Physics'], ['Structure of Matter', 'Thermodynamics'],
    ['Thermodynamics', 'Statistical Physics'], ['Differential Equations', 'Electromagnetism'], ['Sun & Stars', 'Planets']];
  const rng = seed => { let a = 0; for (const c of String(seed)) a = (a * 31 + c.charCodeAt(0)) | 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const LOOK = { ok: { r: 5.2, c: '#ffffff', o: 1, glow: 1 }, sh: { r: 4.4, c: '#ffd27a', o: .95, glow: .7 }, dk: { r: 3.8, c: '#ff9a80', o: .9, glow: .5 },
    none: { r: 3, c: '#dfe8ff', o: .55, glow: 0 }, up: { r: 1.8, c: '#c9d4ff', o: .3, glow: 0 } };

  function layout(M, wide) {
    const W = wide ? 1200 : 380, cols = wide ? M.mods.length : 1, colW = W / cols, STEP = wide ? 46 : 40, ROW = wide ? 72 : 62;
    const stars = [], groups = [], heads = [];
    let maxH = 0;
    M.mods.forEach((m, mi) => {
      const x0 = (wide ? mi : 0) * colW;
      let y = wide ? 64 : (groups.length ? groups[groups.length - 1].y1 + 70 : 64);
      heads.push({ x: x0 + colW / 2, y: y - 30, text: m.short, sub: m.long });
      const courses = [...new Set(m.list.map(t => t.course))].sort((a, b) => courseRank(a) - courseRank(b));
      for (const course of courses) {
        const list = m.list.filter(t => t.course === course), R = rng(course), per = Math.max(3, Math.floor((colW - 60) / STEP));
        const g = { course, y0: y, stars: [] };
        y += 34;
        list.forEach((t, i) => {
          const row = Math.floor(i / per), k = i % per, dir = row % 2 ? -1 : 1;
          const xi = dir > 0 ? k : per - 1 - k;
          const x = x0 + 34 + xi * ((colW - 68) / Math.max(1, per - 1)) + (R() - .5) * 30;
          const yy = y + row * ROW + Math.sin(i * 1.7 + R() * 3) * 16 + (R() - .5) * 18;
          const st = !t.past && !t.has ? 'up' : t.st[0];
          const s = { t, x, y: yy, st, course };
          stars.push(s); g.stars.push(s);
        });
        const rows = Math.ceil(list.length / per);
        y += rows * ROW + 16;
        g.y1 = y; g.x = x0 + 30;
        groups.push(g);
      }
      maxH = Math.max(maxH, y);
    });
    return { W, H: maxH + 20, stars, groups, heads };
  }

  function svg(M, wide) {
    const L = layout(M, wide), R = rng('sky'), dust = [];
    for (let i = 0; i < (wide ? 260 : 140); i++) dust.push(`<circle cx="${(R() * L.W).toFixed(1)}" cy="${(R() * L.H).toFixed(1)}" r="${(R() * .9 + .2).toFixed(2)}" opacity="${(R() * .35 + .05).toFixed(2)}"/>`);
    const lines = [];
    for (const g of L.groups) for (let i = 1; i < g.stars.length; i++) {
      const a = g.stars[i - 1], b = g.stars[i], lit = a.st !== 'up' && b.st !== 'up';
      lines.push(`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" class="sk-l${lit ? '' : ' dim'}"/>`);
    }
    for (const [from, to] of LINKS) {
      const A = L.groups.find(g => g.course === from), B = L.groups.find(g => g.course === to);
      if (!A || !B || !A.stars.length || !B.stars.length) continue;
      const a = A.stars.filter(s => s.st !== 'up').pop() || A.stars[A.stars.length - 1], b = B.stars[0];
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * .15, my = (a.y + b.y) / 2 - Math.abs(b.x - a.x) * .12;
      lines.push(`<path d="M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}" class="sk-link"/>`);
    }
    const labels = L.groups.map(g => `<text x="${g.x}" y="${g.y0 + 8}" class="sk-c">${esc(g.course.toUpperCase())}</text>`).join('')
      + L.heads.map(h => `<text x="${h.x}" y="${h.y}" class="sk-h" text-anchor="middle">${esc(h.text)}</text>`).join('');
    const stars = L.stars.map((s, i) => {
      const k = LOOK[s.st], d = (rng(s.t.id)() * 4).toFixed(2);
      const tip = `${s.t.topic} · ${s.st === 'up' ? 'lecture ' + (lectureWhen(s.t) || 'to come') : s.t.st[1]}`;
      const inner = `${k.glow ? `<circle r="${(k.r * 3.2).toFixed(1)}" fill="${k.c}" opacity="${(.16 * k.glow).toFixed(2)}" class="sk-halo" style="animation-delay:-${d}s"/>` : ''}<circle r="${k.r}" fill="${k.c}" opacity="${k.o}" class="${k.glow ? 'sk-tw' : ''}" style="animation-delay:-${d}s"/><circle r="12" class="sk-hit"/>`;
      return s.t.open ? `<a href="${revHash(s.t.id)}" class="sk-s s-${s.st}" transform="translate(${s.x.toFixed(1)},${s.y.toFixed(1)})" aria-label="${esc(tip)}"><title>${esc(tip)}</title>${inner}</a>`
        : `<g class="sk-s s-${s.st}" transform="translate(${s.x.toFixed(1)},${s.y.toFixed(1)})"><title>${esc(tip)}</title>${inner}</g>`;
    }).join('');
    return `<svg viewBox="0 0 ${L.W} ${L.H}" class="sky-svg" role="img" aria-label="Your revision topics as a star map">
      <g class="sk-dust">${dust.join('')}</g>${lines.join('')}${labels}${stars}</svg>`;
  }

  function panel(M, now) {
    const lect = M.ts.filter(t => t.has && !topicAhead(t, now)), c = { ok: 0, sh: 0, dk: 0, none: 0 };
    lect.forEach(t => c[t.st[0]]++);
    const dimmest = lect.filter(t => t.st[0] === 'dk' || t.st[0] === 'none').sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0) || (a.ld || 0) - (b.ld || 0)).slice(0, 3);
    const key = [['ok', 'Know it'], ['sh', 'Shaky'], ['dk', "Don't know"], ['none', 'Not looked at'], ['up', 'Not lectured yet']];
    return `<div class="sky-top"><div class="sky-count"><b>${c.ok}</b><span>of ${lect.length} lectured stars shining</span></div>
      <div class="sky-key">${key.map(([k, l]) => `<span class="s-${k}"><i></i>${l}${k !== 'up' ? ` · ${c[k] ?? ''}` : ''}</span>`).join('')}</div>
      ${dimmest.length ? `<div class="sky-next"><span>Light these up next</span>${dimmest.map(t => `<a href="${revHash(t.id)}">${esc(t.topic)}</a>`).join('')}</div>` : ''}</div>`;
  }

  window.icdRevTabs = Object.assign(window.icdRevTabs || {}, {
    sky(box, now, M) {
      const wide = innerWidth > 760;
      setHTML(box, `<article class="w wide sky">${panel(M, now)}<div class="sky-wrap">${svg(M, wide)}</div></article>`);
      $('#subtitle').textContent = `Year 2 · ${M.tot.ok} of ${M.tot.total} topics known`;
    }
  });
  let rz;
  addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (/^#revision\/sky/.test(location.hash)) render(); }, 200); });
})();
