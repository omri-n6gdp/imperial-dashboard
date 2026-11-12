/* ---------------------------------------------------------------- try it: interactive physics on topic pages
   A small live demo under a topic's main points, for the topics where playing with the physics helps it click:
     wave packets and dispersion (qp-2b, qp-2c), two slits (qp-5a, qp-2a), the Lennard-Jones potential (som-1a, som-2a),
     the Carnot cycle (th-2c, th-up1), and the HR diagram (ssp-5b, ssp-4b).
   Canvas drawings that follow the window width; animations run only while the demo is on screen. */
(() => {
  const DEMO_OF = { 'qp-2b': 'packet', 'qp-2c': 'packet', 'qp-5a': 'slits', 'qp-2a': 'slits', 'som-1a': 'lj', 'som-2a': 'lj',
    'th-2c': 'carnot', 'th-up1': 'carnot', 'ssp-5b': 'hr', 'ssp-4b': 'hr' };
  const TITLE = { packet: 'Wave packets and dispersion', slits: 'Two slits, one photon at a time', lj: 'The Lennard-Jones potential',
    carnot: 'The Carnot cycle', hr: 'The Hertzsprung–Russell diagram' };
  const INK = 'rgba(255,255,255,.92)', DIM = 'rgba(255,255,255,.35)', FAINT = 'rgba(255,255,255,.12)', BLUE = 'rgb(150,210,255)', AMBER = '#ffd27a', CORAL = '#ff9a80';
  let live = null;            // the demo on screen: { stop }

  /* ---- shared drawing bits */
  function setup(root, controls, h) {
    root.innerHTML = `<canvas class="dm-cv"></canvas><div class="dm-ctl">${controls}</div><div class="dm-out"></div>`;
    const cv = root.querySelector('canvas'), ctx = cv.getContext('2d');
    const size = () => { const w = root.clientWidth, dpr = devicePixelRatio || 1; cv.width = w * dpr; cv.height = h * dpr; cv.style.height = h + 'px'; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return { w, h }; };
    return { cv, ctx, size, out: root.querySelector('.dm-out'), val: n => +root.querySelector(`[name="${n}"]`).value, sel: n => root.querySelector(`[name="${n}"]`).value, chk: n => root.querySelector(`[name="${n}"]`).checked };
  }
  const slider = (name, label, min, max, step, v, fmt) => `<label class="dm-s"><span><i>${label}</i><b data-for="${name}">${fmt ? fmt(v) : v}</b></span><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${v}"></label>`;
  function axes(ctx, w, h, pad, xl, yl) {
    ctx.strokeStyle = DIM; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, h - pad.b); ctx.lineTo(w - pad.r, h - pad.b); ctx.stroke();
    ctx.fillStyle = DIM; ctx.font = '600 11px Inter Tight, system-ui, sans-serif';
    if (xl) { ctx.textAlign = 'right'; ctx.fillText(xl, w - pad.r, h - pad.b + 16); }
    if (yl) { ctx.save(); ctx.translate(pad.l - 10, pad.t); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(yl, 0, 0); ctx.restore(); }
  }
  function loop(root, step) {
    let raf = 0, on = true, visible = true;
    const io = new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0 });
    io.observe(root);
    const tick = ts => { if (!on) return; if (!document.body.contains(root)) return stop(); if (visible && !document.hidden) step(ts); raf = requestAnimationFrame(tick); };
    const stop = () => { on = false; cancelAnimationFrame(raf); io.disconnect(); };
    raf = requestAnimationFrame(tick);
    return { stop };
  }
  /* black-body colour of a star at temperature T (approximate) */
  function starRGB(T) {
    const t = T / 100;
    let r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
    let g = t <= 66 ? 99.47 * Math.log(t) - 161.1 : 288.1 * Math.pow(t - 60, -0.0755);
    let b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5 * Math.log(t - 10) - 305;
    const c = v => Math.max(0, Math.min(255, Math.round(v)));
    return `rgb(${c(r)},${c(g)},${c(b)})`;
  }
  const wavelengthRGB = nm => { let r = 0, g = 0, b = 0; if (nm < 440) { r = (440 - nm) / 60; b = 1; } else if (nm < 490) { g = (nm - 440) / 50; b = 1; } else if (nm < 510) { g = 1; b = (510 - nm) / 20; } else if (nm < 580) { r = (nm - 510) / 70; g = 1; } else if (nm < 645) { r = 1; g = (645 - nm) / 65; } else r = 1; return `rgb(${Math.round(255 * r)},${Math.round(255 * g)},${Math.round(255 * b)})`; };

  /* ---- 1. wave packets: a sum of plane waves around k0; the crests move at ω/k, the envelope at dω/dk */
  function packet(root) {
    const D = { none: [k => k, 'ω = ck (light in vacuum): no dispersion, v_p = v_g'], matter: [k => k * k / 2, 'ω = ħk²/2m (a free particle): v_g = 2 v_p'], water: [k => Math.sqrt(k), 'ω = √(gk) (deep water): v_g = v_p / 2'] };
    const S = setup(root, slider('sk', 'Spread in k, σ<sub>k</sub>', .05, .6, .01, .2) + `<label class="dm-s"><span>Dispersion</span><select name="disp"><option value="matter">matter wave</option><option value="none">light in vacuum</option><option value="water">deep water</option></select></label>`
      + `<button class="btn dm-b" data-dm="pause">Pause</button>`, 230);
    let t = 0, last = 0, playing = true;
    root.addEventListener('click', e => { const b = e.target.closest('[data-dm="pause"]'); if (b) { playing = !playing; b.textContent = playing ? 'Pause' : 'Play'; } });
    return loop(root, ts => {
      const dt = last ? Math.min(.05, (ts - last) / 1000) : 0; last = ts;
      const { w, h } = S.size(), ctx = S.ctx, sk = S.val('sk'), [om, txt] = D[S.sel('disp')], k0 = 1.6, N = 81;
      const vp = om(k0) / k0, vg = (om(k0 + 1e-4) - om(k0 - 1e-4)) / 2e-4;
      if (playing) t += dt * 6;
      const x0 = -10, x1 = 70, X = x => (x - x0) / (x1 - x0) * w, Y = v => h / 2 - v * h * .36;
      if (vg * t > 55 || vp * t > 70) t = 0;
      const ks = [], as = [];
      for (let j = 0; j < N; j++) { const k = k0 + (j - (N - 1) / 2) / ((N - 1) / 2) * 3.2 * sk; ks.push(k); as.push(Math.exp(-((k - k0) ** 2) / (2 * sk * sk))); }
      const norm = as.reduce((a, b) => a + b, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = FAINT; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      const re = [], env = [];
      for (let px = 0; px <= w; px += 1.5) {
        const x = x0 + px / w * (x1 - x0); let c = 0, s = 0;
        for (let j = 0; j < N; j++) { const ph = ks[j] * x - om(ks[j]) * t; c += as[j] * Math.cos(ph); s += as[j] * Math.sin(ph); }
        re.push([px, c / norm]); env.push([px, Math.hypot(c, s) / norm]);
      }
      ctx.strokeStyle = 'rgba(150,210,255,.45)'; ctx.setLineDash([4, 4]); ctx.beginPath(); env.forEach(([p, v], i) => i ? ctx.lineTo(p, Y(v)) : ctx.moveTo(p, Y(v))); ctx.stroke();
      ctx.beginPath(); env.forEach(([p, v], i) => i ? ctx.lineTo(p, Y(-v)) : ctx.moveTo(p, Y(-v))); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.beginPath(); re.forEach(([p, v], i) => i ? ctx.lineTo(p, Y(v)) : ctx.moveTo(p, Y(v))); ctx.stroke(); ctx.lineWidth = 1;
      /* markers: one crest (moves at v_p) and the envelope's peak (moves at v_g) */
      const xc = vp * t, xg = vg * t;
      ctx.fillStyle = CORAL; ctx.beginPath(); ctx.arc(X(xc), Y(Math.max(0, Math.min(1, re[Math.round(X(xc) / 1.5)] ? re[Math.round(X(xc) / 1.5)][1] : 0))), 4.5, 0, 7); ctx.fill();
      ctx.fillStyle = BLUE; ctx.beginPath(); ctx.moveTo(X(xg), h - 10); ctx.lineTo(X(xg) - 6, h - 2); ctx.lineTo(X(xg) + 6, h - 2); ctx.fill();
      S.out.innerHTML = `<span class="dm-k" style="--c:${CORAL}">crest · v<sub>p</sub> = ω/k = ${vp.toFixed(2)}</span><span class="dm-k" style="--c:${BLUE}">envelope · v<sub>g</sub> = dω/dk = ${vg.toFixed(2)}</span><span>${txt}. Narrower in k → wider in x (Δx Δk ≳ ½).</span>`;
      root.querySelector('[data-for="sk"]').textContent = sk.toFixed(2);
    });
  }

  /* ---- 2. two slits: I(y) = cos²(πdy/λL) · sinc²(πay/λL), and photons landing one by one with that probability */
  function slits(root) {
    const S = setup(root, slider('d', 'Slit separation d', 50, 500, 10, 200, v => v + ' μm') + slider('a', 'Slit width a', 10, 120, 5, 40, v => v + ' μm')
      + slider('lam', 'Wavelength λ', 400, 700, 5, 550, v => v + ' nm') + `<label class="dm-c"><input type="checkbox" name="one"> Close one slit</label>`
      + `<label class="dm-c"><input type="checkbox" name="fire" checked> Photons one at a time</label><button class="btn dm-b" data-dm="clear">Clear</button>`, 260);
    let hits = [], key = '';
    root.addEventListener('click', e => { if (e.target.closest('[data-dm="clear"]')) hits = []; });
    return loop(root, () => {
      const { w, h } = S.size(), ctx = S.ctx, d = S.val('d') * 1e-6, a = S.val('a') * 1e-6, lam = S.val('lam') * 1e-9, one = S.chk('one'), L = 1, Ymax = .012;
      const k2 = `${d}|${a}|${lam}|${one}`; if (k2 !== key) { key = k2; hits = []; }
      const I = y => { const b = Math.PI * a * y / (lam * L), s = Math.abs(b) < 1e-9 ? 1 : Math.sin(b) / b; return (one ? 1 : Math.cos(Math.PI * d * y / (lam * L)) ** 2) * s * s; };
      const col = wavelengthRGB(S.val('lam')), top = 110;
      ctx.clearRect(0, 0, w, h);
      /* the curve */
      ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath();
      for (let px = 0; px <= w; px++) { const y = (px / w * 2 - 1) * Ymax, v = I(y); px ? ctx.lineTo(px, top - v * 92) : ctx.moveTo(px, top - v * 92); }
      ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = DIM; ctx.font = '600 11px Inter Tight, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('intensity on a screen 1 m away', 4, 12);
      ctx.textAlign = 'center'; ctx.fillText('−12 mm', 22, top + 14); ctx.fillText('0', w / 2, top + 14); ctx.fillText('+12 mm', w - 24, top + 14);
      /* the detector: photons land at random, more where I is larger */
      if (S.chk('fire') && hits.length < 4000) for (let n = 0; n < 6; n++) { for (let tries = 0; tries < 60; tries++) { const y = (Math.random() * 2 - 1) * Ymax; if (Math.random() < I(y)) { hits.push([y, Math.random()]); break; } } }
      ctx.fillStyle = '#05070f'; ctx.fillRect(0, top + 26, w, h - top - 30);
      ctx.fillStyle = col;
      for (const [y, r] of hits) { ctx.globalAlpha = .75; ctx.fillRect((y / Ymax + 1) / 2 * w, top + 30 + r * (h - top - 38), 1.6, 1.6); }
      ctx.globalAlpha = 1;
      const fringe = lam * L / d * 1e3;
      S.out.innerHTML = `<span>${hits.length} photons</span><span>${one ? 'One slit: just the single-slit envelope, width set by λ/a.' : `Fringe spacing λL/d = ${fringe.toFixed(2)} mm; the envelope (λ/a) sets how many fringes you see.`}</span><span class="muted">Each photon lands at one place; the pattern only appears as they add up (the Born rule).</span>`;
      for (const n of ['d', 'a', 'lam']) root.querySelector(`[data-for="${n}"]`).textContent = S.val(n) + (n === 'lam' ? ' nm' : ' μm');
    });
  }

  /* ---- 3. Lennard-Jones: V = 4ε[(σ/r)¹² − (σ/r)⁶]; at energy E the atoms swing between the turning points */
  function lj(root) {
    const S = setup(root, slider('E', 'Energy E / ε', -.98, .2, .01, -.7, v => (+v).toFixed(2)) + `<label class="dm-c"><input type="checkbox" name="F"> Show the force</label>`, 250);
    const V = r => 4 * (r ** -12 - r ** -6), F = r => 24 * (2 * r ** -13 - r ** -7), rmin = 2 ** (1 / 6);
    const turn = E => { /* inner turning point (r < rmin) and outer (r > rmin, ∞ if E ≥ 0) by bisection */
      const bis = (lo, hi) => { for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; ((V(lo) - E) * (V(m) - E) <= 0) ? hi = m : lo = m; } return (lo + hi) / 2; };
      return [bis(.8, rmin), E >= 0 ? Infinity : bis(rmin, 8)]; };
    let ph = 0;
    return loop(root, () => {
      const { w, h } = S.size(), ctx = S.ctx, E = S.val('E'), pad = { l: 34, r: 12, t: 12, b: 26 };
      const r0 = .85, r1 = 2.8, X = r => pad.l + (r - r0) / (r1 - r0) * (w - pad.l - pad.r), Y = v => pad.t + (1.3 - v) / 2.6 * (h - pad.t - pad.b);
      ctx.clearRect(0, 0, w, h);
      axes(ctx, w, h, pad, 'r / σ', 'V / ε');
      ctx.strokeStyle = FAINT; ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(w - pad.r, Y(0)); ctx.stroke();
      ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.beginPath();
      for (let r = .9; r <= r1; r += .005) { const v = Math.min(1.3, V(r)); r === .9 ? ctx.moveTo(X(r), Y(v)) : ctx.lineTo(X(r), Y(v)); }
      ctx.stroke(); ctx.lineWidth = 1;
      if (S.chk('F')) { ctx.strokeStyle = BLUE; ctx.setLineDash([4, 4]); ctx.beginPath(); for (let r = .95; r <= r1; r += .005) { const v = Math.max(-1.3, Math.min(1.3, F(r) / 10)); r === .95 ? ctx.moveTo(X(r), Y(v)) : ctx.lineTo(X(r), Y(v)); } ctx.stroke(); ctx.setLineDash([]); }
      const [a, b] = turn(E), bb = Math.min(b, r1);
      ctx.strokeStyle = AMBER; ctx.beginPath(); ctx.moveTo(X(a), Y(E)); ctx.lineTo(X(bb), Y(E)); ctx.stroke();
      ctx.fillStyle = DIM; ctx.font = '600 11px Inter Tight, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('r₀ = 2^{1/6}σ', X(rmin), Y(-1) + 16);
      ctx.strokeStyle = FAINT; ctx.beginPath(); ctx.moveTo(X(rmin), Y(-1)); ctx.lineTo(X(rmin), h - pad.b); ctx.stroke();
      /* the atom: at energy E it spends longest near the turning points, so move it like x = mid + half·cos */
      ph += .05;
      const mean = isFinite(b) ? (a + b) / 2 : null, pos = isFinite(b) ? mean + (b - a) / 2 * Math.cos(ph) : a + (ph % 6) / 6 * (r1 - a);
      ctx.fillStyle = AMBER; ctx.beginPath(); ctx.arc(X(Math.min(pos, r1)), Y(E), 6, 0, 7); ctx.fill();
      if (mean) { ctx.strokeStyle = 'rgba(255,210,122,.5)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(mean), Y(E) - 14); ctx.lineTo(X(mean), Y(E) + 14); ctx.stroke(); ctx.setLineDash([]); }
      S.out.innerHTML = isFinite(b) ? `<span>Turning points ${a.toFixed(3)}σ and ${b.toFixed(3)}σ</span><span class="dm-k" style="--c:${AMBER}">middle of the swing ${mean.toFixed(3)}σ (r₀ = ${rmin.toFixed(3)}σ)</span><span class="muted">The well is steeper inside than out, so more energy pushes the middle outwards: thermal expansion.</span>`
        : `<span>E ≥ 0: the pair is no longer bound and flies apart.</span>`;
      root.querySelector('[data-for="E"]').textContent = E.toFixed(2);
    });
  }

  /* ---- 4. Carnot: two isotherms and two adiabats of an ideal monatomic gas (γ = 5/3), one mole */
  function carnot(root) {
    const S = setup(root, slider('Th', 'Hot reservoir T<sub>h</sub>', 350, 1000, 10, 600, v => v + ' K') + slider('Tc', 'Cold reservoir T<sub>c</sub>', 200, 900, 10, 300, v => v + ' K')
      + slider('r', 'Isothermal expansion V<sub>B</sub>/V<sub>A</sub>', 1.5, 4, .1, 2.5, v => (+v).toFixed(1)), 260);
    const R = 8.314, g = 5 / 3;
    let s = 0;
    return loop(root, () => {
      const { w, h } = S.size(), ctx = S.ctx, pad = { l: 36, r: 14, t: 12, b: 26 };
      const Th = S.val('Th'), Tc = Math.min(S.val('Tc'), Th - 20), r = S.val('r');
      const VA = 1, VB = r, f = (Th / Tc) ** (1 / (g - 1)), VC = VB * f, VD = VA * f;
      const P = (T, V) => R * T / V, Pad = (V0, T0, V) => P(T0, V0) * (V0 / V) ** g;
      const path = [];
      for (let i = 0; i <= 60; i++) { const V = VA + (VB - VA) * i / 60; path.push([V, P(Th, V)]); }
      for (let i = 1; i <= 60; i++) { const V = VB + (VC - VB) * i / 60; path.push([V, Pad(VB, Th, V)]); }
      for (let i = 1; i <= 60; i++) { const V = VC + (VD - VC) * i / 60; path.push([V, P(Tc, V)]); }
      for (let i = 1; i <= 60; i++) { const V = VD + (VA - VD) * i / 60; path.push([V, Pad(VD, Tc, V)]); }
      const Vmax = VC * 1.08, Pmax = P(Th, VA) * 1.1, X = V => pad.l + V / Vmax * (w - pad.l - pad.r), Y = p => h - pad.b - p / Pmax * (h - pad.t - pad.b);
      ctx.clearRect(0, 0, w, h);
      axes(ctx, w, h, pad, 'V', 'P');
      ctx.fillStyle = 'rgba(150,210,255,.12)'; ctx.beginPath(); path.forEach(([V, p], i) => i ? ctx.lineTo(X(V), Y(p)) : ctx.moveTo(X(V), Y(p))); ctx.closePath(); ctx.fill();
      const seg = (from, to, c) => { ctx.strokeStyle = c; ctx.lineWidth = 2; ctx.beginPath(); for (let i = from; i <= to; i++) { const [V, p] = path[i]; i === from ? ctx.moveTo(X(V), Y(p)) : ctx.lineTo(X(V), Y(p)); } ctx.stroke(); ctx.lineWidth = 1; };
      seg(0, 60, CORAL); seg(60, 120, INK); seg(120, 180, BLUE); seg(180, 240, INK);
      ctx.fillStyle = DIM; ctx.font = '700 11px Inter Tight, system-ui, sans-serif'; ctx.textAlign = 'center';
      [['A', 0], ['B', 60], ['C', 120], ['D', 180]].forEach(([l, i]) => ctx.fillText(l, X(path[i][0]) + 10, Y(path[i][1]) - 6));
      s = (s + .6) % 240;
      const [Vn, pn] = path[Math.floor(s)];
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(Vn), Y(pn), 5, 0, 7); ctx.fill();
      const Qh = R * Th * Math.log(r), eta = 1 - Tc / Th, W = eta * Qh;
      S.out.innerHTML = `<span class="dm-k" style="--c:${CORAL}">A→B at T<sub>h</sub>: takes in Q<sub>h</sub> = RT<sub>h</sub> ln(V<sub>B</sub>/V<sub>A</sub>) = ${(Qh / 1000).toFixed(2)} kJ</span><span class="dm-k" style="--c:${BLUE}">C→D at T<sub>c</sub>: gives out ${((Qh - W) / 1000).toFixed(2)} kJ</span><span><b>η = 1 − T<sub>c</sub>/T<sub>h</sub> = ${(100 * eta).toFixed(1)}%</b> · work per cycle W = ${(W / 1000).toFixed(2)} kJ (the shaded area), per mole</span>`;
      root.querySelector('[data-for="Th"]').textContent = Th + ' K'; root.querySelector('[data-for="Tc"]').textContent = Tc + ' K'; root.querySelector('[data-for="r"]').textContent = r.toFixed(1);
    });
  }

  /* ---- 5. HR diagram: main-sequence stars from their mass (L ∝ M^3.5 above 0.43 M☉, R ∝ M^0.8 or M^0.57) */
  function hr(root) {
    const S = setup(root, slider('lm', 'Mass M', -1, 1.6, .01, 0, v => (10 ** v).toPrecision(2) + ' M☉'), 300);
    const L = M => M < .43 ? .23 * M ** 2.3 : M < 2 ? M ** 4 : M < 55 ? 1.4 * M ** 3.5 : 32000 * M, Rr = M => M < 1 ? M ** .8 : M ** .57, T = M => 5772 * (L(M) / Rr(M) ** 2) ** .25;
    return loop(root, () => {
      const { w, h } = S.size(), ctx = S.ctx, pad = { l: 38, r: 14, t: 12, b: 28 }, M = 10 ** S.val('lm');
      const lt0 = 4.7, lt1 = 3.4, X = lt => pad.l + (lt0 - lt) / (lt0 - lt1) * (w - pad.l - pad.r), Y = ll => pad.t + (6 - ll) / 10 * (h - pad.t - pad.b);
      ctx.clearRect(0, 0, w, h);
      axes(ctx, w, h, pad, '← hotter   log T   cooler →', 'log L / L☉');
      ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t, w - pad.l - pad.r, h - pad.t - pad.b); ctx.clip();
      /* lines of constant radius: L = R² (T/T☉)⁴ */
      ctx.font = '600 10px Inter Tight, system-ui, sans-serif'; ctx.textAlign = 'left';
      for (const R0 of [.01, .1, 1, 10, 100, 1000]) {
        ctx.strokeStyle = FAINT; ctx.setLineDash([2, 5]); ctx.beginPath();
        for (let lt = lt1; lt <= lt0; lt += .02) { const ll = 2 * Math.log10(R0) + 4 * (lt - Math.log10(5772)); lt === lt1 ? ctx.moveTo(X(lt), Y(ll)) : ctx.lineTo(X(lt), Y(ll)); }
        ctx.stroke(); ctx.setLineDash([]);
        const ll = 2 * Math.log10(R0) + 4 * (3.5 - Math.log10(5772)); if (ll > -4 && ll < 6) { ctx.fillStyle = DIM; ctx.fillText(R0 + ' R☉', X(3.5) + 2, Y(ll) - 3); }
      }
      /* the main sequence, coloured by temperature */
      for (let lm = -1; lm <= 1.6; lm += .02) { const m = 10 ** lm, lt = Math.log10(T(m)), ll = Math.log10(L(m)); ctx.fillStyle = starRGB(T(m)); ctx.globalAlpha = .55; ctx.beginPath(); ctx.arc(X(lt), Y(ll), 1.6, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
      ctx.restore();
      /* the Sun and your star */
      ctx.strokeStyle = DIM; ctx.beginPath(); ctx.arc(X(Math.log10(5772)), Y(0), 6, 0, 7); ctx.stroke(); ctx.fillStyle = DIM; ctx.fillText('Sun', X(Math.log10(5772)) + 9, Y(0) + 4);
      const Tm = T(M), Lm = L(M), Rm = Rr(M), x = X(Math.log10(Tm)), y = Y(Math.log10(Lm));
      const gr = ctx.createRadialGradient(x, y, 0, x, y, 18); gr.addColorStop(0, starRGB(Tm)); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 18, 0, 7); ctx.fill(); ctx.fillStyle = starRGB(Tm); ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill();
      const life = 1e10 * M / Lm;
      S.out.innerHTML = `<span><b>${M.toPrecision(2)} M☉</b> → L ≈ ${Lm < 10 ? Lm.toPrecision(2) : Math.round(Lm).toLocaleString('en-GB')} L☉, R ≈ ${Rm.toPrecision(2)} R☉, T ≈ ${Math.round(Tm / 100) * 100} K</span><span>Main-sequence life ≈ 10¹⁰ yr × (M/L) = ${life >= 1e9 ? (life / 1e9).toPrecision(2) + ' Gyr' : (life / 1e6).toPrecision(2) + ' Myr'}</span><span class="muted">Rough fits (L ∝ M^3.5, R ∝ M^0.8 or M^0.57); dashed lines are constant radius, from L = 4πR²σT⁴.</span>`;
      root.querySelector('[data-for="lm"]').textContent = M.toPrecision(2) + ' M☉';
    });
  }

  const MAKE = { packet, slits, lj, carnot, hr };
  window.icdDemo = {
    has: id => !!DEMO_OF[id],
    /* called each time a topic page is drawn; builds the demo once per topic */
    mount(host, t) {
      if (!host) return;
      const kind = DEMO_OF[t.id];
      if (host.dataset.id === t.id && (host.firstElementChild || !kind)) return;
      host.dataset.id = t.id;
      if (live) { live.stop(); live = null; }
      if (!kind) { host.innerHTML = ''; host.hidden = true; return; }
      host.hidden = false;
      host.innerHTML = `<section class="rv-sec dm"><h3>Try it · ${esc(TITLE[kind])}</h3><div class="dm-box"></div></section>`;
      requestAnimationFrame(() => { live = MAKE[kind](host.querySelector('.dm-box')); });
    }
  };
  document.addEventListener('input', e => { const s = e.target.closest('.dm-s input'); if (s) { const b = s.closest('.dm-s').querySelector('b'); if (b && !s.name) b.textContent = s.value; } });
})();
