/* Background: one smooth blue-to-black fade whose contours follow a wedge
   (apex just above the middle of the screen, sides running to the bottom corners). */
(function () {
  const BLUE = [26, 48, 164], D0 = -330, D1 = 200, SPREAD = 1.45, APEX = 0.42;
  const cv = document.querySelector('canvas.bg');
  function ramp(u) {
    let t = (u - D0) / (D1 - D0); t = Math.min(1, Math.max(0, t));
    const s = t * t * (3 - 2 * t), f = Math.pow(1 - s, 1.35);
    return [BLUE[0] * f, BLUE[1] * f, BLUE[2] * f];
  }
  function draw() {
    const W = cv.width = innerWidth, H = cv.height = innerHeight;
    if (!W || !H) return;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), D = img.data;
    const k = 1440 / W, HH = H * k, ax = 720, ay = APEX * HH;
    const L = [-ax, HH - ay], R = [1440 - ax, HH - ay], nl = Math.hypot(L[0], L[1]), nr = Math.hypot(R[0], R[1]);
    const dl = [L[0] / nl, L[1] / nl], dr = [R[0] / nr, R[1] / nr];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const px = x * k - ax, py = y * k - ay, cl = px * dl[1] - py * dl[0], cr = px * dr[1] - py * dr[0];
      let d;
      if (cl >= 0 && cr <= 0) d = Math.min(cl, -cr);
      else {
        const tl = Math.max(0, px * dl[0] + py * dl[1]), tr = Math.max(0, px * dr[0] + py * dr[1]);
        d = -Math.min(Math.hypot(px - tl * dl[0], py - tl * dl[1]), Math.hypot(px - tr * dr[0], py - tr * dr[1]));
      }
      const c = ramp(d / SPREAD), i = (y * W + x) * 4;
      D[i] = c[0]; D[i + 1] = c[1]; D[i + 2] = c[2]; D[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  let t; draw();
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 120); });
})();
