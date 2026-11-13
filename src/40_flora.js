'use strict';
// ---- flora: red maples, Huangshan pines, plum blossom, shrubs, ferns, grass, spider lilies, leaf litter, cliff plants ------
// PLANTING IS FROZEN: every tree and shrub stands where the first film put it (same sites, same yaw, same scale: the random
// stream that places them is consumed in the old order), and every crown is rebuilt INSIDE its old one: the old generators
// still run to give the skeleton and the old leaf cards, the new foliage is fitted to within `margin` of those old cards
// (Flora.fit reports the worst case in metres).
//   leaves     one material family (foliage): sprays of small leaves on a data atlas (R shade, G each leaf's own hue shift,
//              B twig, A cover), coloured per tree from a palette (aTree), lit on the near face and THROUGH the leaf from the
//              far face (a leaf between the lens and the sun glows), shaded inside the crown, in the sun's shadow map
//   pines      a red trunk, a few long limbs, each carrying a flat-topped cloud of needle clumps with sky between them, lit as
//              domes (yellow-green toward the sun, dark below). Every tree keeps its own choice of boughs, swept to the lee side
//              of the valley's wind, in the vertex stage (FL_PINE): 560 trees from 4 skeletons, no two alike
//   cliffs     grass tufts, cushions, ferns and creepers (all under a metre) where the rock is recessed or shelved AND wet:
//              relief() reads the gullies from the rock's own sites, moist() gives the seepage; bare faces stay bare
//   motion     every vertex leans on a sprung answer to the dragons (66_wake.js: per-instance pass table aE0..aE2 and the
//              travelling pressure fronts) and to the valley's own wind and its gust fronts (wkGusts): the whole crown heaves
//              as a front arrives, overshoots and rings down, boughs bob, leaves flutter and turn their pale side to the lens
//              (vGs), grass lies over in a pale band. The shadow pass leans with it
//   cost       instance groups with a tight bound are culled against the frustum (hero trees); the cliff plants and the far
//              grass use a lighter vertex stage (FL_LITE: the valley's wind only)
// Interface kept: Flora.build(scene, prog, tick), Flora.T.leaf (one maple leaf, the falling leaves of 70_fx.js), Flora.mats,
// Flora.barkMat, userData.thin on every mesh that may be thinned.
const Flora = (() => {
  const T = {}, V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), fit = { maple: 0, pine: 0, shrunk: 0, dropped: 0 };
  const CV1 = [0, 0, 0.25, 1], CV2 = [0.25, 0, 0.5, 1], CSP = [0.5, 0, 1, 0.5], CMS = [0.5, 0.5, 1, 1];      // cells of the cliff atlas: two creeper curtains, the spilling mat, the cushion
  const AS = 1024, CELL = [[0, 0, 0.5, 0.5], [0.5, 0, 1, 0.5], [0, 0.5, 0.5, 1], [0.5, 0.5, 1, 1]];        // atlas cells: u0, v0 (top), u1, v1 (bottom)
  // ======================= drawing =======================
  function lobe(x, ang, L, w) {
    x.save(); x.rotate(ang); x.beginPath(); x.moveTo(0, 0);
    const pts = [[-w * 0.9, L * 0.34], [-w * 0.45, L * 0.47], [-w * 0.78, L * 0.62], [-w * 0.26, L * 0.76], [0, L], [w * 0.26, L * 0.76], [w * 0.78, L * 0.62], [w * 0.45, L * 0.47], [w * 0.9, L * 0.34]];
    for (const p of pts) x.lineTo(p[0], -p[1]); x.closePath(); x.fill(); x.restore();
  }
  const LOBES = [[0, 1, .27], [.95, .86, .25], [-.95, .86, .25], [1.95, .55, .21], [-1.95, .55, .21]];
  function mapleLeaf(x, cx, cy, s, rot, c0, c1) {                      // a coloured leaf (the one the falling leaves use)
    x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(s, s);
    const g = x.createRadialGradient(0, 0, 0.05, 0, -0.3, 1.0); g.addColorStop(0, c0); g.addColorStop(1, c1); x.fillStyle = g;
    for (const [a, L, w] of LOBES) lobe(x, a, L, w);
    x.strokeStyle = 'rgba(255,225,170,.38)'; x.lineWidth = 0.022; x.beginPath();
    for (const [a, L] of LOBES) { x.moveTo(0, 0); x.lineTo(Math.sin(a) * L * 0.88, -Math.cos(a) * L * 0.88); }
    x.moveTo(0, 0); x.lineTo(0, 0.45); x.stroke(); x.restore();
  }
  // data colours: R = shade, G = this leaf's hue shift, B = 1 on wood
  const dc = (s, h, w = 0) => `rgb(${clamp(s) * 255 | 0},${clamp(h) * 255 | 0},${clamp(w) * 255 | 0})`;
  function dMaple(x, cx, cy, s, rot, sh, hu) {                         // a palmate leaf pointing along `rot` (0 = up the canvas) from its base
    x.save(); x.translate(cx, cy); x.rotate(rot); x.scale(s, s);
    const g = x.createRadialGradient(0, -0.1, 0.08, 0, -0.2, 0.95); g.addColorStop(0, dc(sh + 0.10, hu)); g.addColorStop(1, dc(sh * 0.62, hu)); x.fillStyle = g;
    for (const [a, L, w] of LOBES) lobe(x, a, L, w);
    x.strokeStyle = dc(sh + 0.22, hu); x.lineWidth = 0.035; x.beginPath(); for (const [a, L] of LOBES) { x.moveTo(0, 0); x.lineTo(Math.sin(a) * L * 0.8, -Math.cos(a) * L * 0.8); } x.stroke();
    x.restore();
  }
  function dOvate(x, cx, cy, L, w, rot, sh, hu) {                      // a pointed oval leaf
    x.save(); x.translate(cx, cy); x.rotate(rot); x.fillStyle = dc(sh, hu); x.beginPath(); x.moveTo(0, 0); x.bezierCurveTo(w, -L * 0.25, w * 0.8, -L * 0.8, 0, -L); x.bezierCurveTo(-w * 0.8, -L * 0.8, -w, -L * 0.25, 0, 0); x.fill();
    x.strokeStyle = dc(sh + 0.14, hu); x.lineWidth = Math.max(1, L * 0.035); x.beginPath(); x.moveTo(0, 0); x.lineTo(0, -L * 0.9); x.stroke(); x.restore();
  }
  const twig = (x, a, b, w, sh = 0.3) => { x.strokeStyle = dc(sh, 0.5, 1); x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke(); };
  // a maple spray: a twig, side twigs, leaves in opposite pairs at every node
  function dMapleSpray(x, ox, oy, S, r) {
    const bend = (r() - 0.5) * 0.16, N = 9, tw = t => [ox + S * (0.5 + bend * Math.sin(t * 2.6)), oy + S * (0.955 - 0.79 * t)], lv = [];
    let prev = tw(0); for (let i = 1; i <= 24; i++) { const p = tw(i / 24); twig(x, prev, p, S * (0.015 - 0.010 * i / 24)); prev = p; }
    for (let i = 0; i < N; i++) {
      const t = 0.08 + 0.92 * i / (N - 1), p = tw(t), q = tw(Math.min(1, t + 0.03)), ta = Math.atan2(q[0] - p[0], -(q[1] - p[1])), sz = S * (0.068 + 0.026 * r()) * (1 - 0.22 * t);
      for (const sd of [-1, 1]) lv.push([p[0], p[1], ta + sd * (0.95 + 0.5 * r()), sz * (0.85 + 0.3 * r())]);
      if (i < N - 1) { const sd = i % 2 ? 1 : -1, a = ta + sd * (0.80 + 0.35 * r()), L = S * (0.15 + 0.17 * r()) * (1 - 0.42 * t), M = 3 + (r() * 2 | 0); let pp = p;
        for (let k = 1; k <= M; k++) { const u = k / M, aa = a + sd * 0.3 * u, e = [p[0] + Math.sin(aa) * L * u, p[1] - Math.cos(aa) * L * u]; twig(x, pp, e, S * 0.006); pp = e; const ss = sz * (0.8 + 0.3 * r());
          if (k < M) for (const s2 of [-1, 1]) lv.push([e[0], e[1], aa + s2 * (0.9 + 0.5 * r()), ss]); else lv.push([e[0], e[1], aa + (r() - .5) * 0.5, ss * 1.1]); } }
    }
    const tip = tw(1); lv.push([tip[0], tip[1], (r() - .5) * 0.4, S * 0.078]);
    for (let i = lv.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0, t = lv[i]; lv[i] = lv[j]; lv[j] = t; }
    const m = S * 0.055, x0 = ox + m, x1 = ox + S - m, y0 = oy + m, y1 = oy + S - m;
    for (const [lx, ly, a, s] of lv) { const pet = s * 0.42, cx = clamp(lx + Math.sin(a) * pet, x0 + s, x1 - s), cy = clamp(ly - Math.cos(a) * pet, y0 + s, y1 - s * 0.6); twig(x, [lx, ly], [cx, cy], S * 0.004); dMaple(x, cx, cy, s, a + (r() - .5) * 0.5, 0.30 + 0.70 * r(), r()); }
  }
  // fallen leaves lying flat: no twig, every way up, some gone brown
  function dLitter(x, ox, oy, S, r) {
    for (let i = 0; i < 58; i++) { const a = r() * TAU, d = Math.pow(r(), 0.7) * S * 0.38, s = S * (0.060 + 0.035 * r()), brown = r() < 0.3; dMaple(x, ox + S * 0.5 + Math.cos(a) * d, oy + S * 0.5 + Math.sin(a) * d, s, r() * TAU, brown ? 0.22 + 0.2 * r() : 0.42 + 0.5 * r(), brown ? r() * 0.2 : r()); }
  }
  function dShrubSpray(x, ox, oy, S, r, round) {
    const bend = (r() - 0.5) * 0.2, tw = t => [ox + S * (0.5 + bend * Math.sin(t * 2.4)), oy + S * (0.95 - 0.80 * t)], lv = [], N = round ? 12 : 10;
    let prev = tw(0); for (let i = 1; i <= 20; i++) { const p = tw(i / 20); twig(x, prev, p, S * (0.013 - 0.008 * i / 20), 0.26); prev = p; }
    for (let i = 0; i < N; i++) { const t = 0.05 + 0.95 * i / (N - 1), p = tw(t), sd = i % 2 ? 1 : -1, L0 = S * (round ? 0.085 : 0.115) * (1 - 0.2 * t);
      lv.push([p[0], p[1], sd * (0.75 + 0.4 * r()), L0 * (0.85 + 0.3 * r())]);
      if (i % 2 === 0 && i < N - 1) { const a = -sd * (0.75 + 0.35 * r()), L = S * (0.16 + 0.16 * r()) * (1 - 0.4 * t), M = round ? 5 : 4; let pp = p;
        for (let k = 1; k <= M; k++) { const u = k / M, e = [p[0] + Math.sin(a) * L * u, p[1] - Math.cos(a) * L * u]; twig(x, pp, e, S * 0.005, 0.26); pp = e; lv.push([e[0], e[1], a + (k % 2 ? 1 : -1) * (0.7 + 0.4 * r()), L0 * (0.8 + 0.3 * r())]); if (k === M) lv.push([e[0], e[1], a, L0]); } } }
    const tip = tw(1); lv.push([tip[0], tip[1], 0, S * 0.1]);
    for (const [lx, ly, a, L] of lv) dOvate(x, lx, ly, L, L * (round ? 0.42 : 0.30), a + (r() - .5) * 0.3, 0.42 + 0.58 * r(), r());
  }
  function dFern(x, ox, oy, S, r) {
    const tw = t => [ox + S * (0.5 + 0.03 * Math.sin(t * 3)), oy + S * (0.96 - 0.90 * t)]; let prev = tw(0);
    for (let i = 1; i <= 30; i++) { const p = tw(i / 30); twig(x, prev, p, S * 0.008, 0.3); prev = p; }
    for (let i = 0; i < 26; i++) { const t = 0.10 + 0.90 * i / 25, p = tw(t), L = S * 0.27 * Math.pow(Math.sin(Math.PI * Math.pow(1 - t * 0.93, 0.75)), 0.8) + S * 0.02;
      for (const sd of [-1, 1]) dOvate(x, p[0], p[1], L, L * 0.13, sd * (1.25 - 0.35 * t), 0.5 + 0.5 * r(), r()); }
  }
  function dBlossom(x, ox, oy, S, r) {
    const bend = (r() - 0.5) * 0.2, tw = t => [ox + S * (0.5 + bend * Math.sin(t * 2.4)), oy + S * (0.95 - 0.80 * t)], fl = [];
    let prev = tw(0); for (let i = 1; i <= 20; i++) { const p = tw(i / 20); twig(x, prev, p, S * (0.016 - 0.010 * i / 20), 0.22); prev = p; }
    for (let i = 0; i < 9; i++) { const t = 0.08 + 0.92 * i / 8, p = tw(t), sd = i % 2 ? 1 : -1, a = sd * (0.8 + 0.4 * r()), L = S * (0.14 + 0.2 * r()) * (1 - 0.4 * t); let pp = p;
      for (let k = 1; k <= 4; k++) { const u = k / 4, e = [p[0] + Math.sin(a) * L * u, p[1] - Math.cos(a) * L * u]; twig(x, pp, e, S * 0.006, 0.22); pp = e; fl.push(e, [e[0] + (r() - .5) * S * 0.06, e[1] + (r() - .5) * S * 0.06]); } fl.push(p); }
    for (const p of fl) { const R = S * (0.026 + 0.014 * r()), sh = 0.7 + 0.3 * r(), hu = r(), a0 = r() * TAU; x.fillStyle = dc(sh, hu);
      for (let k = 0; k < 5; k++) { const a = a0 + k * TAU / 5; x.beginPath(); x.ellipse(p[0] + Math.cos(a) * R * 0.75, p[1] + Math.sin(a) * R * 0.75, R * 0.62, R * 0.48, a, 0, TAU); x.fill(); }
      x.fillStyle = dc(0.35, 0.0); x.beginPath(); x.arc(p[0], p[1], R * 0.28, 0, TAU); x.fill(); }
  }
  // pine needles: bursts of fine strokes
  function burst(x, cx, cy, R, r, a0, spread, n, lw, dark = 0) {
    for (let i = 0; i < n; i++) { const a = a0 + (r() - 0.5) * 2 * spread, L = R * (0.55 + 0.45 * r()); x.strokeStyle = dc(0.30 + 0.70 * r() - dark, r()); x.lineWidth = lw; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.sin(a) * L, cy - Math.cos(a) * L); x.stroke(); }
  }
  function dPinePlate(x, ox, oy, S, r) {                                // a bough seen from above: shoots fanning from the centre, a starburst of needles on every tip
    const c = [ox + S * 0.5, oy + S * 0.5], tips = []; x.lineCap = 'round';
    for (let k = 0; k < 9; k++) { const a = k / 9 * TAU + (r() - .5) * 0.5, L = S * (0.24 + 0.14 * r()); let pp = c;
      for (let j = 1; j <= 4; j++) { const u = j / 4, e = [c[0] + Math.cos(a + 0.2 * u) * L * u, c[1] + Math.sin(a + 0.2 * u) * L * u]; twig(x, pp, e, S * (0.012 - 0.007 * u), 0.2); pp = e; tips.push([e[0], e[1], u]);
        if (j >= 2) { const sa = a + (j % 2 ? 1 : -1) * (0.7 + 0.4 * r()), sl = S * (0.07 + 0.07 * r()), f = [e[0] + Math.cos(sa) * sl, e[1] + Math.sin(sa) * sl]; twig(x, e, f, S * 0.005, 0.2); tips.push([f[0], f[1], u]); } } }
    tips.push([c[0], c[1], 0]); for (let i = 0; i < 10; i++) { const a = r() * TAU, d = S * 0.20 * Math.sqrt(r()); tips.push([c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, 0.3]); }
    for (const t of tips) burst(x, t[0], t[1], S * (0.062 + 0.03 * r()), r, 0, Math.PI, 46, S * 0.0038, 0.12 * (1 - t[2]));
  }
  function dPineSide(x, ox, oy, W, H, r) {                              // a bough seen from the side: flat-topped, bristling upward, branchlets showing underneath
    const root = [ox + W * 0.5, oy + H * 0.97], tips = []; x.lineCap = 'round';
    for (let i = 0; i <= 26; i++) { const u = i / 26, px = ox + W * (0.07 + 0.86 * u + (r() - .5) * 0.02), k = (u - 0.5) * 2, py = oy + H * (0.40 + 0.26 * k * k + (r() - .5) * 0.10); tips.push([px, py, 1 - Math.abs(k) * 0.3]); }
    for (let i = 0; i <= 16; i++) { const u = i / 16, px = ox + W * (0.14 + 0.72 * u + (r() - .5) * 0.03), k = (u - 0.5) * 2, py = oy + H * (0.62 + 0.14 * k * k + (r() - .5) * 0.08); tips.push([px, py, 0.55]); }
    for (const t of tips) { const m = [lerp(root[0], t[0], 0.55), lerp(root[1], t[1], 0.35) + H * 0.10]; x.strokeStyle = dc(0.2, 0.5, 1); x.lineWidth = W * 0.0045; x.beginPath(); x.moveTo(root[0], root[1]); x.quadraticCurveTo(m[0], m[1], t[0], t[1]); x.stroke(); }
    for (const t of tips) burst(x, t[0], t[1], W * (0.050 + 0.02 * r()), r, (r() - .5) * 0.5, 1.25, 40, W * 0.0036, 0.25 * (1 - t[2]));
  }
  function dPineTuft(x, ox, oy, S, r) {                                 // a few upturned shoot ends
    const root = [ox + S * 0.5, oy + S * 0.96]; x.lineCap = 'round';
    for (let k = 0; k < 5; k++) { const a = (k - 2) * 0.42 + (r() - .5) * 0.25, L = S * (0.42 + 0.2 * r()), e = [root[0] + Math.sin(a) * L, root[1] - Math.cos(a) * L]; twig(x, root, e, S * 0.016, 0.2); burst(x, e[0], e[1], S * (0.24 + 0.08 * r()), r, a * 0.7, 1.5, 60, S * 0.012, 0); burst(x, lerp(root[0], e[0], 0.6), lerp(root[1], e[1], 0.6), S * 0.2, r, a, 1.4, 34, S * 0.012, 0.15); }
  }
  // ---- what hangs on a cliff: curtains of creeper, a mat of grass and fern spilling over a lip, a cushion of small leaves ----
  function dVines(x, ox, oy, W, H, r) {                                  // roots along the bottom edge (the top of the curtain in the world), strands of different length
    x.lineCap = 'round'; const lv = [];
    for (let v = 0; v < 9; v++) {
      const x0 = ox + W * (0.10 + 0.80 * (v + r()) / 9), len = H * (v < 5 ? 0.62 + 0.36 * r() : 0.16 + 0.34 * r()), amp = W * (0.03 + 0.06 * r()), f = 1.5 + 2.5 * r(), ph = r() * TAU, dr = (r() - .5) * W * 0.16;
      const at = t => [clamp(x0 + amp * Math.sin(ph + t * f * 4) + dr * t, ox + W * 0.07, ox + W * 0.93), oy + H * 0.99 - len * t], N = Math.round(len / (W * 0.085));
      let prev = at(0); for (let i = 1; i <= 40; i++) { const p = at(i / 40); twig(x, prev, p, W * (0.014 - 0.008 * i / 40), 0.24); prev = p; }
      for (let i = 0; i < N; i++) { const t = (i + 0.3 + 0.4 * r()) / N, p = at(t), sd = i % 2 ? 1 : -1, L = W * (0.085 + 0.05 * r()) * (1 - 0.25 * t); lv.push([p[0], p[1], sd * (0.5 + 0.7 * r()), L]); if (r() < 0.55) lv.push([p[0], p[1], -sd * (0.3 + 0.8 * r()), L * 0.8]); }
    }
    for (let i = lv.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0, t = lv[i]; lv[i] = lv[j]; lv[j] = t; }
    for (const [lx, ly, a, L] of lv) dOvate(x, lx, ly, L, L * 0.46, a, 0.36 + 0.64 * r(), r());
  }
  function dSpill(x, ox, oy, S, r) {                                     // a mat seen flat: roots along the bottom, grass blades and fern fronds running up and out, thick at the root
    x.lineCap = 'round';
    for (let i = 0; i < 60; i++) dOvate(x, ox + S * (0.05 + 0.9 * r()), oy + S * (0.99 - 0.15 * r()), S * (0.05 + 0.04 * r()), S * 0.024, (r() - .5) * 1.6, 0.3 + 0.5 * r(), r());
    for (let b = 0; b < 130; b++) { const x0 = ox + S * (0.04 + 0.92 * r()), len = S * (0.30 + 0.66 * r() * (0.5 + 0.5 * r())), a0 = (x0 - ox - S * 0.5) / S * 0.9 + (r() - .5) * 0.5, cv = (r() - .5) * 0.9, sh = 0.35 + 0.65 * r(), hu = r(), w0 = S * (0.007 + 0.007 * r()); let px = x0, py = oy + S * 0.995;
      for (let k = 1; k <= 7; k++) { const u = k / 7, a = a0 + cv * u, nx = clamp(px + Math.sin(a) * len / 7, ox + 2, ox + S - 2), ny = Math.max(oy + 2, py - Math.cos(a) * len / 7); x.strokeStyle = dc(sh * (0.55 + 0.45 * u), hu); x.lineWidth = w0 * (1.15 - u); x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke(); px = nx; py = ny; } }
    for (let f = 0; f < 7; f++) { const x0 = ox + S * (0.12 + 0.76 * (f + r()) / 7), len = S * (0.45 + 0.4 * r()), a0 = (x0 - ox - S * 0.5) / S * 1.0 + (r() - .5) * 0.3, tw = t => [clamp(x0 + Math.sin(a0) * len * t, ox + S * 0.06, ox + S * 0.94), oy + S * 0.98 - Math.cos(a0) * len * t]; let prev = tw(0);
      for (let i = 1; i <= 16; i++) { const p = tw(i / 16); twig(x, prev, p, S * 0.006, 0.3); prev = p; }
      for (let i = 0; i < 18; i++) { const t = 0.10 + 0.90 * i / 17, p = tw(t), L = len * 0.22 * Math.pow(Math.sin(Math.PI * Math.pow(1 - t * 0.93, 0.75)), 0.8) + S * 0.012; for (const sd of [-1, 1]) dOvate(x, p[0], p[1], L, L * 0.16, a0 + sd * (1.25 - 0.35 * t), 0.5 + 0.5 * r(), r()); } }
  }
  function dMass(x, ox, oy, S, r) {                                      // a cushion of small leaves: thick in the middle, ragged at the rim, brighter toward its top
    for (let i = 0; i < 560; i++) { const a = r() * TAU, d = Math.pow(r(), 0.6) * S * 0.44, L = S * (0.035 + 0.035 * r()), cx = ox + S * 0.5 + Math.cos(a) * d, cy = oy + S * 0.5 + Math.sin(a) * d * 0.92;
      dOvate(x, cx, cy + L * 0.5, L, L * 0.42, r() * TAU, (0.28 + 0.72 * r()) * (0.60 + 0.40 * clamp((oy + S * 0.8 - cy) / (S * 0.6))), r()); }
  }
  // canvas -> data texture. Empty texels take a mid value so the mips never smear black into a leaf's edge
  function atlas(S, draw) {
    const cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d', { willReadFrequently: true }); draw(x, S);
    const d = x.getImageData(0, 0, S, S).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 8) { d[i] = 150; d[i + 1] = 128; d[i + 2] = 0; d[i + 3] = 0; }
    const t = new THREE.DataTexture(new Uint8Array(d.buffer, d.byteOffset, d.length), S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true; return t;
  }
  function textures() {
    T.leaf = Tex.canvas(256, 256, (x, w) => { mapleLeaf(x, w * .5, w * .56, w * .44, 0, '#c21f1b', '#f2581f'); });      // one leaf, in colour: the falling leaves (70_fx.js) and the torn ones (66_wake.js)
    const H = AS / 2;
    T.maple = atlas(AS, x => { const r = rng(11); dMapleSpray(x, 0, 0, H, r); dMapleSpray(x, H, 0, H, r); dMapleSpray(x, 0, H, H, r); dLitter(x, H, H, H, r); });
    T.bush = atlas(AS, x => { const r = rng(8); dShrubSpray(x, 0, 0, H, r, false); dShrubSpray(x, H, 0, H, r, true); dFern(x, 0, H, H, r); dBlossom(x, H, H, H, r); });
    T.cliff = atlas(AS, x => { const r = rng(17); dVines(x, 0, 0, AS / 4, AS, r); dVines(x, AS / 4, 0, AS / 4, AS, r); dSpill(x, H, 0, H, r); dMass(x, H, H, H, r); });
    T.pine = atlas(AS, x => { const r = rng(5); dPinePlate(x, 0, 0, H, r); dPinePlate(x, H, 0, H, r); dPineSide(x, 0, H, H, H / 2, r); dPineSide(x, 0, H + H / 2, H, H / 2, r); for (let k = 0; k < 4; k++) dPineTuft(x, H + (k % 2) * H / 2, H + (k >> 1) * H / 2, H / 2, r); });
    T.lily = Tex.canvas(256, 256, (x, w) => {                             // red spider lily: an umbel of recurved petals and long stamens; the corner is stem green
      x.fillStyle = '#3d5a22'; x.fillRect(0, 0, 20, 20); x.fillRect(0, w - 20, 20, 20); const r = rng(21); x.lineCap = 'round'; const c = w * 0.5;
      for (let f = 0; f < 6; f++) { const a0 = f / 6 * TAU + r() * 0.3, fx = c + Math.cos(a0) * w * 0.07, fy = c + Math.sin(a0) * w * 0.07;
        for (let p = 0; p < 6; p++) { const a = a0 + (p - 2.5) * 0.42, L = w * (0.20 + 0.06 * r()); x.strokeStyle = r() < 0.5 ? '#e0241a' : '#c4130f'; x.lineWidth = 5.5; x.beginPath(); x.moveTo(fx, fy); x.quadraticCurveTo(fx + Math.cos(a) * L, fy + Math.sin(a) * L, fx + Math.cos(a + 1.0) * L * 0.9, fy + Math.sin(a + 1.0) * L * 0.9); x.stroke(); }
        for (let p = 0; p < 5; p++) { const a = a0 + (p - 2) * 0.3, L = w * (0.36 + 0.06 * r()); x.strokeStyle = '#ff5a30'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(fx, fy); x.quadraticCurveTo(fx + Math.cos(a) * L * 0.7, fy + Math.sin(a) * L * 0.7, fx + Math.cos(a - 0.35) * L, fy + Math.sin(a - 0.35) * L); x.stroke(); x.fillStyle = '#ffb040'; x.beginPath(); x.arc(fx + Math.cos(a - 0.35) * L, fy + Math.sin(a - 0.35) * L, 2.2, 0, TAU); x.fill(); } }
    });
    T.blob = Tex.canvas(64, 64, (x, w) => { const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.35, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); });
  }
  // ======================= materials =======================
  // one foliage program for every leaf in the valley; the kind picks the palette (uFo3.w: 0 maple, 1 shrub and blossom, 2 pine, 3 colour straight from the map)
  //   maple  0 maroon, .25 crimson, .45 scarlet, .62 orange, .78 gold, 1 the odd one still green
  //   shrub  0 dark green .. .45 olive, .6 crimson, .78 orange, .95 gold, beyond 1.05 blossom pink to white
  const PAL = /* glsl */`
    vec3 flPal(float h, float kind){
      if (kind < 0.5){ vec3 c = mix(vec3(0.150, 0.012, 0.022), vec3(0.400, 0.016, 0.028), smoothstep(0.0, 0.25, h)); c = mix(c, vec3(0.640, 0.045, 0.020), smoothstep(0.25, 0.45, h));
        c = mix(c, vec3(0.760, 0.180, 0.022), smoothstep(0.45, 0.62, h)); c = mix(c, vec3(0.800, 0.430, 0.045), smoothstep(0.62, 0.78, h)); return mix(c, vec3(0.240, 0.300, 0.040), smoothstep(0.84, 1.0, h)); }
      if (kind < 1.5){ vec3 c = mix(vec3(0.030, 0.085, 0.022), vec3(0.070, 0.180, 0.034), smoothstep(0.0, 0.25, h)); c = mix(c, vec3(0.185, 0.250, 0.045), smoothstep(0.25, 0.46, h));
        c = mix(c, vec3(0.460, 0.040, 0.026), smoothstep(0.50, 0.60, h)); c = mix(c, vec3(0.700, 0.185, 0.026), smoothstep(0.66, 0.78, h)); c = mix(c, vec3(0.740, 0.470, 0.050), smoothstep(0.84, 0.95, h));
        c = mix(c, vec3(0.800, 0.330, 0.400), smoothstep(1.02, 1.10, h)); return mix(c, vec3(0.900, 0.700, 0.700), smoothstep(1.14, 1.34, h)); }
      vec3 c = mix(vec3(0.026, 0.062, 0.034), vec3(0.062, 0.138, 0.042), smoothstep(0.0, 0.5, h)); return mix(c, vec3(0.210, 0.270, 0.052), smoothstep(0.5, 1.05, h)); }
    vec3 flPalT(float h, float kind){
      if (kind < 0.5) return flPal(h + 0.10, kind) * vec3(1.35, 1.9, 1.2) + vec3(0.05, 0.012, 0.0);
      if (kind < 1.5) return flPal(h, kind) * vec3(1.3, 1.6, 0.9) + vec3(0.012, 0.03, 0.0) * step(h, 0.5);
      return flPal(h, kind) * 1.2; }`;
  // the vertex stage every plant shares: world-space lean, turned back into the instance's own frame
  // uFo1 = spring (rad/s), damping ratio, lean (m at the tip per unit push), thrash in a wake (m)
  // uFo2 = how far it goes over in the valley's wind, bough bob (m at the tip in a gust), sag, cover given back per mip
  // uFo4 = under-face dimming, shyness of the lens (m), how far it goes over for a dragon, leaf flutter in the wind (m)
  // The valley's wind (66_wake.js: wkGusts) blows toward -X and gusts cross as plane fronts. A plant answers each front
  // as a sprung weight: the whole crown heaves over as the front arrives, overshoots, rings at its own pace and comes back as the
  // gust dies; between fronts it rolls gently across the wind. Boughs bob on top of that, leaves flutter on top of the boughs.
  // The dragons reach a plant through its pass table and the travelling pressure fronts, at the time each would really arrive.
  // fGs (out): how hard the air is on this plant now: the fragment stage turns the leaves' pale side to the lens with it
  const BEND_HEAD = o => `${Wake.GLSL_BEND}\nattribute vec3 aW; attribute vec4 aE0, aE1, aE2; uniform vec4 uFo1, uFo2, uFo4; float fGs = 0.0;${o && o.pal === 'pine' ? '\n#define FL_PINE\nattribute vec4 aBr; attribute vec3 aBq;' : ''}${o && o.lite ? '\n#define FL_LITE' : ''}`;
  const BEND_VS = /* glsl */`
    { mat3 fIm = mat3(instanceMatrix); vec3 fIo = instanceMatrix[3].xyz;
      if (uFo4.y > 0.0) transformed *= smoothstep(uFo4.y * 0.4, uFo4.y, distance(cameraPosition, fIo));      // a small plant never stands against the lens
      float fSd = fract(fIo.x * 0.137 + fIo.z * 0.291 + fIo.y * 0.071);
      #ifdef FL_PINE
        // no two pines alike: every tree keeps its own choice of boughs. Those that point downwind are full, those that face the
        // wind are stunted or gone (one in five is missing anyway), and what is left of each is swept to the lee side of where it
        // grew. aBr = pivot (xyz) and reach (w; below 0 on a limb: it shortens to a stub when its bough is gone); aBq = bough number, its heading (x, z)
        if (aBq.x > 0.5) {
          float pH = fract(aBq.x * 0.6180339 + fSd * 13.71 + fIo.y * 0.317 + fIo.x * 0.731), pH2 = fract(pH * 57.31 + fSd * 11.3 + aBq.x * 0.37);
          vec2 pWo = vec2(dot(fIm[0].xz, WK_WD), dot(fIm[2].xz, WK_WD)); pWo /= max(length(pWo), 1e-4);            // the wind's heading in the tree's own frame
          float pLee = dot(aBq.yz, pWo), pTop = step(99.5, aBq.x);
          float pK = clamp(0.92 + 0.46 * pLee + (pH - 0.5) * 0.9, 0.0, 1.0);
          pK = mix(pH2 < 0.06 || pK < 0.10 ? 0.0 : mix(0.62, 1.0, pK), 0.85 + 0.15 * pH, pTop);
          vec3 pR = transformed - aBr.xyz; float pRe = max(aBr.w, 0.0);
          transformed = aBr.xyz + pR * (aBr.w < 0.0 ? (pK < 0.05 ? 0.2 : 1.0) : pK) + vec3(pWo.x, 0.0, pWo.y) * ((1.0 - pK) * pRe * 0.8 * clamp(length(pR.xz) / (0.45 * pRe + 1e-3), 0.0, 1.0));
        }
      #endif
      float fW0 = uFo1.x * (0.8 + 0.4 * fSd);
      #ifdef FL_LITE
        vec4 fB = vec4(0.0);                                                                                  // (the small plants of the cliffs answer the valley's wind only)
      #else
        vec4 fB = wkBend(fIo, aE0, aE1, aE2, fW0, uFo1.y);
      #endif
      vec3 fD = vec3(0.0); vec2 fL = fB.xy * uFo4.z;
      vec2 fXz = fIo.xz + (fIm * transformed).xz * 0.5;                                                        // the windward side of a big crown goes first
      #ifdef FL_DEPTH
        vec3 fG = wkGusts(fXz, 0.0, 0.0);                                                                      // (the shadow goes over with the gust; it leaves out the ringing, the boughs and the leaves)
        fL += (WK_WD * (uWkG.x * uWkG.y) + fG.xy) * uFo2.x; fGs = fG.z + fB.w;
      #else
        vec3 fG = wkGusts(fXz, fW0, uFo1.y); float fGn = fG.z; fGs = fGn + fB.w;
        { fL += (WK_WD * (uWkG.x * uWkG.y) + fG.xy + vec2(-WK_WD.y, WK_WD.x) * (sin(uWkT * fW0 * 0.42 + fSd * 31.0) * (0.05 * uWkG.x + 0.20 * fGn))) * uFo2.x;
          float fBp = dot(transformed, vec3(0.83, 0.57, 1.07)) + fSd * 20.0, fSw = sin(uWkT * 2.3 + fBp), fSv = sin(uWkT * 1.7 + fBp * 1.31);         // a phase that runs smoothly through the crown: a bough moves as one, its neighbours do not
          fD += vec3(WK_WD.x * fSw, 0.75 * fSv, WK_WD.y * fSw + 0.4 * fSv) * (aW.x * uFo2.y * (0.18 * uWkG.x + fGn));
          if (distance(cameraPosition, fIo) < 70.0) {                                                          // (a leaf's own flutter is a few centimetres: beyond 70 m it is less than a pixel)
            float fFt = uWkT * (5.0 + 4.0 * fract(aW.z * 7.31)) + aW.z * 6.283 + fBp, fF1 = sin(fFt), fF2 = sin(fFt * 1.37 + 2.0);
            fD += vec3(fF1, fF2, 0.3 * fF2 - 0.7 * fF1) * (aW.y * uFo4.w * (0.35 * uWkG.x + 1.6 * fGn)); } }
      #endif
      float fBu = min(fB.z, 1.5);
      if (fBu > 0.002) {                                                                                    // while air streams past, the limb is buffeted and the leaves thrash
        fL += (vec2(sin(uWkT * 5.3 + fSd * 40.0), cos(uWkT * 4.1 + fSd * 23.0)) * 0.26 + vec2(sin(uWkT * 11.0 + aW.z * 9.0), cos(uWkT * 9.3 + aW.z * 7.0)) * 0.12) * fBu;
        float fTh = uWkT * (7.0 + 6.0 * fract(aW.z * 7.31)) + aW.z * 6.283;
        fD += vec3(sin(fTh), cos(fTh * 1.31), sin(fTh * 0.83 + 1.7)) * (aW.y * uFo1.w * fBu); }
      { float fMx = length(fL); fL *= min(1.0, 1.5 / max(fMx, 1e-4)); }                                      // a crown goes over so far and no further
      fL *= aW.x * uFo1.z; float fLl = length(fL);
      fD.xz += fL; fD.y -= min(fLl * fLl * uFo2.z, fLl * 0.6);
      transformed += vec3(dot(fIm[0], fD) / dot(fIm[0], fIm[0]), dot(fIm[1], fD) / dot(fIm[1], fIm[1]), dot(fIm[2], fD) / dot(fIm[2], fIm[2])); }`;
  const foU = o => ({ uFo1: { value: new THREE.Vector4(o.w0, o.z, o.flex, o.flut) }, uFo2: { value: new THREE.Vector4(o.wind ?? 1, o.bob ?? 0.2, o.sag ?? 0.10, o.far ?? 1.5) },
    uFo3: { value: new THREE.Vector4(o.transl ?? 0.6, o.glow ?? 1.3, o.cardK ?? 0.35, { maple: 0, bush: 1, pine: 2, map: 3 }[o.pal] ?? 0) }, uFo4: { value: new THREE.Vector4(o.under ?? 0.8, o.shy ?? 0, o.wake ?? 1, o.flutW ?? 0.04) } });
  function depthFor(o, map) {                                             // the shadow of a bent tree bends with it
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), u = foU(o); if (map) { m.map = map; m.alphaTest = 0.5; }
    patch(m, s => { Object.assign(s.sh.uniforms, Wake.U, u); s.vHead('#define FL_DEPTH\n' + BEND_HEAD(o)); s.v('#include <begin_vertex>', '#include <begin_vertex>\n' + BEND_VS);
      s.f('#include <map_fragment>', '#ifdef USE_MAP\n { float a = texture2D(map, vMapUv).a, h = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))); if (a < 0.10 + 0.62 * h) discard; }\n#endif'); }, 'fdep' + (o.pal === 'pine' ? 'P' : ''));
    return m;
  }
  // light through a thin leaf: whatever lands on the far face comes out of the near one, tinted, strongest looking toward the light.
  // Plants are Lambert surfaces (no gloss, no reflection probe per fragment); FL_SKY adds what the sky and the valley floor send, by the
  // normal's height: violet-rose from above, warm rock bounce from below, the dusk band from the side (matched to the scene's environment light)
  const RE_LEAF = (transl, glow) => /* glsl */`
    void RE_Direct_Leaf(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight){
      RE_Direct_Lambert(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
      float back = saturate(dot(-flFaceN, directLight.direction)), toward = saturate(dot(-geometryViewDir, directLight.direction));
      reflectedLight.directDiffuse += directLight.color * flTr * (back * (0.6 + ${glow} * toward * toward) * ${transl} * RECIPROCAL_PI); }
    #undef RE_Direct
    #define RE_Direct RE_Direct_Leaf`;
  const FL_SKY = /* glsl */`#include <lights_fragment_end>
    { float ny = dot(normal, vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
      reflectedLight.indirectDiffuse += diffuseColor.rgb * (mix(vec3(0.110, 0.066, 0.066), vec3(0.300, 0.165, 0.210), ny * 0.5 + 0.5) + vec3(0.060, 0.012, 0.0) * (1.0 - ny * ny)); }`;
  function foliage(map, o) {
    const m = new THREE.MeshLambertMaterial({ map, alphaTest: o.alphaTest ?? 0.36, side: THREE.DoubleSide, vertexColors: true, alphaToCoverage: true }), u = foU(o);
    patch(m, s => {
      Object.assign(s.sh.uniforms, Wake.U, u);
      s.vHead(`${BEND_HEAD(o)}\nattribute vec4 aTree; varying vec4 vTree; varying float vGs;`);
      s.v('#include <begin_vertex>', `#include <begin_vertex>\nvTree = aTree;\n${BEND_VS}\nvGs = min(fGs, 1.6);`);
      s.fHead(`varying vec4 vTree; varying float vGs; uniform vec4 uFo2, uFo3, uFo4; vec3 flFaceN, flTr; float flLod = 0.0;\n${PAL}`);
      // vColor is data here: r = shade inside the crown, g = this spray's hue shift, b = its brightness
      s.f('#include <color_fragment>', '');
      s.f('#include <map_fragment>', /* glsl */`
        { vec4 sp = texture2D(map, vMapUv);
          flFaceN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));                // the card's own plane, facing the lens
          sp.a *= smoothstep(0.05, 0.26, abs(dot(flFaceN, normalize(vViewPosition))));           // a card seen edge-on is a streak: let it go
          if (uFo3.w > 2.5) { diffuseColor = vec4(sp.rgb * vColor.r, sp.a); flTr = sp.rgb * vColor.r; }
          else { vec2 fx = dFdx(vMapUv) * ${AS}.0, fy = dFdy(vMapUv) * ${AS}.0;
            float lod = max(0.0, 0.5 * log2(max(dot(fx, fx), dot(fy, fy)))); flLod = lod;
            float gsK = vGs * (uFo3.w > 1.5 ? 0.35 : 1.0);                                           // in a gust the leaves turn their pale side to the lens
            float hue = vTree.x + vColor.g + (sp.g - 0.5) * vTree.y + 0.045 * gsK, lum0 = (0.46 + 0.86 * sp.r) * vColor.b * vTree.z * (1.0 + 0.42 * gsK);
            float lum = lum0 * mix(uFo4.x, 1.0, smoothstep(-0.25, 0.25, dot(normalize(vNormal), normalize(vViewPosition))));     // the face turned away from the sky is the duller one
            vec3 leaf = flPal(hue, uFo3.w) * lum, wood = vec3(0.060, 0.040, 0.030);
            diffuseColor = vec4(mix(leaf, wood, sp.b) * vColor.r, sp.a);
            flTr = flPalT(hue, uFo3.w) * lum0 * (1.0 - sp.b) * mix(vColor.r, 1.0, 0.35); } }`);
      // near, a leaf has an edge; far away a spray is so many leaves a pixel that its cover is a fraction: hand that fraction to the multisampler
      s.f('#include <alphatest_fragment>', /* glsl */`{ float a = diffuseColor.a, sharp = smoothstep(alphaTest, alphaTest + max(fwidth(a), 1e-4), a);
          diffuseColor.a = mix(sharp, clamp(a * uFo2.w, 0.0, 1.0), clamp(flLod * 0.6 - 0.3, 0.0, 1.0)); if (diffuseColor.a < 0.03) discard; }`);
      s.f('#include <normal_fragment_begin>', /* glsl */`#include <normal_fragment_begin>
        {
          #ifdef DOUBLE_SIDED
            normal *= faceDirection;                                                         // vNormal is the crown's soft normal: the same on both faces
          #endif
          normal = normalize(mix(normal, flFaceN, uFo3.z)); nonPerturbedNormal = normal; }`);
      s.f('#include <lights_lambert_pars_fragment>', '#include <lights_lambert_pars_fragment>\n' + RE_LEAF('uFo3.x', 'uFo3.y'));
      s.f('#include <lights_fragment_end>', FL_SKY);
    }, 'fol' + (o.pal === 'pine' ? 'P' : '') + (o.lite ? 'L' : ''));
    m.userData.depth = depthFor(o, map);
    return m;
  }
  function bark(o) {
    const m = new THREE.MeshLambertMaterial({ color: 0x4a3024, bumpMap: Tex.bark, bumpScale: 4.0, vertexColors: true }), u = foU(o);
    patch(m, s => {
      Object.assign(s.sh.uniforms, Wake.U, u);
      s.vHead(BEND_HEAD(o)); s.v('#include <begin_vertex>', '#include <begin_vertex>\n' + BEND_VS);
      const UV = '(vBumpMapUv.yx * vec2(2.0, 0.30))';
      s.f('#include <bumpmap_pars_fragment>', THREE.ShaderChunk.bumpmap_pars_fragment.replace(/\)\s*\.x/g, ').z').replace(/vBumpMapUv/g, UV));
      s.f('#include <map_fragment>', '{ float bk = texture2D(bumpMap, ' + UV + ').b; diffuseColor.rgb *= 0.30 + 1.45 * bk * bk; }');
      s.f('#include <lights_fragment_end>', FL_SKY);
    }, 'bark2' + (o.pal === 'pine' ? 'P' : ''));
    m.userData.depth = depthFor(o, null);
    return m;
  }
  const MP = { key: 'm', pal: 'maple', transl: 0.9, glow: 1.5, cardK: 0.40, w0: 4.3, z: 0.17, flex: 2.1, flut: 0.20, wind: 0.5, bob: 0.34, flutW: 0.05, wake: 2.0, sag: 0.09 };
  const PP = { key: 'p', pal: 'pine', under: 0.62, transl: 0.30, glow: 0.9, cardK: 0.12, rough: 0.78, alphaTest: 0.30, far: 1.35, w0: 5.2, z: 0.20, flex: 1.0, flut: 0.06, wind: 0.45, bob: 0.42, flutW: 0.02, wake: 1.8, sag: 0.06 };
  const BP = { key: 'b', pal: 'bush', shy: 3.2, transl: 0.55, glow: 1.0, cardK: 0.35, w0: 9.0, z: 0.24, flex: 0.75, flut: 0.09, wind: 0.45, bob: 0.12, flutW: 0.035, wake: 1.6, sag: 0.22 };
  const LP = { key: 'l', pal: 'map', shy: 3.0, transl: 0.4, glow: 0.8, cardK: 0.6, alphaTest: 0.3, w0: 11, z: 0.3, flex: 0.35, flut: 0.03, wind: 0.5, bob: 0.05, flutW: 0.02, wake: 1.3, sag: 0.3 };
  let barkM, barkP, mats = {}; const LITE = new Set();
  function materials() {
    barkM = bark(MP); barkP = bark(PP);
    mats.maple = foliage(T.maple, MP); mats.mapleF = foliage(T.maple, Object.assign({}, MP, { far: 2.3 })); /* far maples: fewer sprays, each giving back more cover */ mats.pine = foliage(T.pine, PP); mats.bush = foliage(T.bush, BP); mats.lily = foliage(T.lily, LP);
    // grass: a blade is hinged at its root. It lies down along the push, comes back up past upright and settles
    const grassMat = lite => patch(new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, vertexColors: true }), s => {
      Object.assign(s.sh.uniforms, Wake.U);
      s.vHead(`${BEND_HEAD({ lite })}\nattribute vec2 aSide; varying float vGs;`);
      s.v('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        { mat3 fIm = mat3(instanceMatrix); vec3 fIo = instanceMatrix[3].xyz; float fSc = length(fIm[1]);
          float fDist = distance(cameraPosition, fIo);
          transformed.xz += aSide * (max(1.0, fDist / 15.0) - 1.0);                              // a blade never gets thinner than about a pixel
          transformed.y *= smoothstep(1.3, 3.6, fDist);                                          // and never stands against the lens
          vec3 fWp = fIm * transformed + fIo;
          float fSd = fract(fIo.x * 3.137 + fIo.z * 2.291);
          #ifdef FL_LITE
            vec4 fB = vec4(0.0);
          #else
            vec4 fB = wkBend(fIo, aE0, aE1, aE2, 15.0 * (0.8 + 0.4 * fSd), 0.42);
          #endif
          vec3 fG = wkGusts(fIo.xz, 0.0, 0.0); float fGn = fG.z;                                     // the gust front lays the grass over as it crosses, blade after blade
          vec2 fL = fB.xy * 2.2 + WK_WD * (uWkG.x * uWkG.y) + fG.xy * 1.05 + vec2(sin(uWkT * 5.1 + fSd * 40.0 + aW.z * 6.283 + fIo.x * 1.3), cos(uWkT * 4.3 + fSd * 31.0 + fIo.z * 1.1)) * (0.05 * uWkG.x + 0.12 * fGn + 0.10 * min(fB.z, 1.5));
          vGs = min(fGn + fB.w, 1.6) * aW.x;
          float fA = length(fL), fTh = min(fA, 1.38) * pow(aW.x, 0.75), fHt = transformed.y * fSc; vec2 fDir = fL / max(fA, 1e-4);
          vec3 fD = vec3(fDir.x * sin(fTh), cos(fTh) - 1.0, fDir.y * sin(fTh)) * fHt;
          transformed += vec3(dot(fIm[0], fD) / dot(fIm[0], fIm[0]), dot(fIm[1], fD) / dot(fIm[1], fIm[1]), dot(fIm[2], fD) / dot(fIm[2], fIm[2])); }`);
      s.fHead('vec3 flFaceN, flTr; varying float vGs;');
      s.f('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 1.0 + 0.75 * vGs;');                 // grass lying over shows its sheen: the gust is a pale band running through it
      s.f('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n{ flFaceN = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));\n#ifdef DOUBLE_SIDED\n normal *= faceDirection;\n#endif\n flTr = diffuseColor.rgb * vec3(1.2, 1.5, 0.8); }');
      s.f('#include <lights_lambert_pars_fragment>', '#include <lights_lambert_pars_fragment>\n' + RE_LEAF('0.7', '1.2'));
      s.f('#include <lights_fragment_end>', FL_SKY);
    }, 'grass2' + (lite ? 'L' : ''));
    mats.grass = grassMat(false); mats.grassL = grassMat(true); mats.bushL = foliage(T.bush, Object.assign({}, BP, { lite: true }));
    mats.cliffL = foliage(T.cliff, Object.assign({}, BP, { lite: true, shy: 0, wind: 0.6, bob: 0.2, flex: 0.9, sag: 0.10, under: 0.72 }));
    LITE.add(mats.grassL).add(mats.bushL).add(mats.cliffL);
    mats.blob = new THREE.MeshBasicMaterial({ map: T.blob, color: 0x000000, transparent: true, opacity: 0.62, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  }
  // ======================= geometry =======================
  // sprays: {b: base, ax: along the twig, n: card normal, L, W, dr: droop of the tip (m), cell, ao, hu, br, sn: shading normal, wb: [lean weight at base, at tip], fl: flutter, ph, seg}
  const sR = V(), sP = V();
  function sprayVerts(k, out) {                                          // the 2 * (seg + 1) corners, into out[]
    sR.crossVectors(k.ax, k.n).normalize(); let o = 0;
    for (let i = 0; i <= k.seg; i++) { const t = i / k.seg; sP.copy(k.b).addScaledVector(k.ax, k.L * t).addScaledVector(k.n, -k.dr * t * t); const w = k.W * 0.5 * (k.taper ? 1 - k.taper * t : 1);
      out[o++].copy(sP).addScaledVector(sR, -w); out[o++].copy(sP).addScaledVector(sR, w); }
    return o;
  }
  const sv = Array.from({ length: 12 }, () => V());
  function sprayGeo(list) {
    let nv = 0, ni = 0; for (const k of list) { nv += (k.seg + 1) * 2; ni += k.seg * 6; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Float32Array(nv * 3), aw = new Float32Array(nv * 3), idx = new Uint32Array(ni); let v = 0, q = 0;
    const tagged = list.some(k => k.tag), br = tagged ? new Float32Array(nv * 4) : null, bq = tagged ? new Float32Array(nv * 3) : null;
    for (const k of list) {
      const n = sprayVerts(k, sv), c = k.cell, v0 = v;
      for (let j = 0; j < n; j++, v++) { const p = sv[j], t = (j >> 1) / k.seg, sn = k.snf ? k.snf(p, sR, t) : !k.sn2 || t < 0.25 ? k.sn : t > 0.75 ? k.sn2 : sR.copy(k.sn).add(k.sn2).addScaledVector(k.n, 0.5).normalize();
        if (tagged && k.tag) { br[v * 4] = k.tag[0]; br[v * 4 + 1] = k.tag[1]; br[v * 4 + 2] = k.tag[2]; br[v * 4 + 3] = k.tag[3]; bq[v * 3] = k.tag[4]; bq[v * 3 + 1] = Math.cos(k.tag[5]); bq[v * 3 + 2] = Math.sin(k.tag[5]); }
        pos[v * 3] = p.x; pos[v * 3 + 1] = p.y; pos[v * 3 + 2] = p.z; nor[v * 3] = sn.x; nor[v * 3 + 1] = sn.y; nor[v * 3 + 2] = sn.z;
        uv[v * 2] = (j & 1) ? c[2] : c[0]; uv[v * 2 + 1] = lerp(c[3], c[1], t);
        col[v * 3] = k.ao * (k.ao2 !== undefined ? lerp(k.ao2, 1, t) : 1); col[v * 3 + 1] = k.hu; col[v * 3 + 2] = k.br;
        aw[v * 3] = lerp(k.wb[0], k.wb[1], t); aw[v * 3 + 1] = k.fl * (0.25 + 0.75 * t); aw[v * 3 + 2] = k.ph; }
      for (let i = 0; i < k.seg; i++) { const a = v0 + i * 2; idx[q++] = a; idx[q++] = a + 1; idx[q++] = a + 2; idx[q++] = a + 1; idx[q++] = a + 3; idx[q++] = a + 2; }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aW', new THREE.BufferAttribute(aw, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    if (tagged) { g.setAttribute('aBr', new THREE.BufferAttribute(br, 4)); g.setAttribute('aBq', new THREE.BufferAttribute(bq, 3)); }
    return g;
  }
  // branches [{pts, radii, sides}] -> one bark geometry; wbOf(p) = how far a point leans with the crown, tint = bark tint
  // lean: the same wood for a tree far from the lens (every other ring, fewer sides, no twigs)
  function woodGeo(brs, wbOf, tint, base, lean) {
    const gs = [], tagged = brs.some(b => b.tag);
    for (const b0 of brs) { let b = b0; if (lean) { if (b0.twig) continue; const keep = b0.pts.map((_, i) => i % 2 === 0 || i === b0.pts.length - 1); b = Object.assign({}, b0, { pts: b0.pts.filter((_, i) => keep[i]), radii: b0.radii.filter((_, i) => keep[i]), sides: b0.sides >= 8 ? 5 : b0.sides >= 5 ? 3 : b0.sides }); }
      const g = tubeGeo(b.pts, b.radii, b.sides), p = g.attributes.position.array, n = g.attributes.position.count, col = new Float32Array(n * 3), aw = new Float32Array(n * 3);
      if (tagged) { const t = b.tag || [0, 0, 0, 0, 0, 0]; fillAttr(g, 'aBr', 4, t); fillAttr(g, 'aBq', 3, [t[4], Math.cos(t[5]), Math.sin(t[5])]); }
      for (let i = 0; i < n; i++) { sP.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]); const foot = 0.45 + 0.55 * sm(0.0, 0.9, sP.y - base), k = foot * (b.ao ?? 1); col[i * 3] = tint[0] * k; col[i * 3 + 1] = tint[1] * k; col[i * 3 + 2] = tint[2] * k; aw[i * 3] = wbOf(sP); }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aW', new THREE.BufferAttribute(aw, 3)); gs.push(g); }
    return mergeGeos(gs);
  }
  // the old cards of a crown as oriented squares, and the distance from a point to the nearest of them
  function oldQuad(k) { const up = Math.abs(k.f.y) > 0.95 ? V(1, 0, 0) : V(0, 1, 0), R = V().crossVectors(up, k.f).normalize(), U = V().crossVectors(k.f, R), cr = Math.cos(k.roll || 0), sr = Math.sin(k.roll || 0);
    return { c: k.c, n: k.f, a: R.clone().multiplyScalar(cr).addScaledVector(U, sr), b: R.clone().multiplyScalar(-sr).addScaledVector(U, cr), h: k.s * 0.5, s: k.s, p: k.p }; }
  const qd = V(), quadDist = (q, p) => { qd.subVectors(p, q.c); const x = Math.abs(qd.dot(q.a)) - q.h, y = Math.abs(qd.dot(q.b)) - q.h; return Math.hypot(x > 0 ? x : 0, y > 0 ? y : 0, qd.dot(q.n)); };
  function envelope(quads, cell = 2.4) {
    const m = new Map(), key = (i, j, k) => ((i + 256) * 512 + (j + 256)) * 512 + (k + 256), fl = Math.floor, d = V();
    for (const q of quads) { const e = q.h * 1.42 + 0.45, c = q.c;
      for (let i = fl((c.x - e) / cell); i <= fl((c.x + e) / cell); i++) for (let j = fl((c.y - e) / cell); j <= fl((c.y + e) / cell); j++) for (let k = fl((c.z - e) / cell); k <= fl((c.z + e) / cell); k++) { const kk = key(i, j, k); let l = m.get(kk); if (!l) m.set(kk, l = []); l.push(q); } }
    return p => { const l = m.get(key(fl(p.x / cell), fl(p.y / cell), fl(p.z / cell))); if (!l) return 9; let best = 9;
      for (let i = 0; i < l.length; i++) { const q = l[i]; d.subVectors(p, q.c); const x = Math.abs(d.dot(q.a)) - q.h, y = Math.abs(d.dot(q.b)) - q.h, z = d.dot(q.n), dd = Math.hypot(x > 0 ? x : 0, y > 0 ? y : 0, z); if (dd < best) best = dd; }
      return best; };
  }
  // shade inside a crown: how much foliage stands between a spray and the sky
  function skyShade(list, cell = 1.3) {
    const m = new Map(), key = (i, k) => (i + 512) * 2048 + (k + 512), fl = Math.floor, cs = list.map(k => V().copy(k.b).addScaledVector(k.ax, k.L * 0.5));
    cs.forEach((c, i) => { const kk = key(fl(c.x / cell), fl(c.z / cell)); let l = m.get(kk); if (!l) m.set(kk, l = []); l.push(i); });
    cs.forEach((c, i) => { let n = 0; const ix = fl(c.x / cell), iz = fl(c.z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = m.get(key(ix + a, iz + b)); if (!l) continue; for (let q = 0; q < l.length; q++) { const o = cs[l[q]], dy = o.y - c.y; if (dy > 0.25 && Math.hypot(o.x - c.x, o.z - c.z) < cell + dy * 0.35) n += list[l[q]].area ?? list[l[q]].L * list[l[q]].W; } }
      list[i].over = n; });
  }
  // ---------- tree skeletons ----------
  function perp(d, a, out) { const u = Math.abs(d.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0); const x = new THREE.Vector3().crossVectors(d, u).normalize(), y = new THREE.Vector3().crossVectors(d, x); return out.copy(x).multiplyScalar(Math.cos(a)).addScaledVector(y, Math.sin(a)); }
  // o.keep: share of the old cards that carry sprays, o.sub: each old square is cut into sub x sub sprays; o.margin: metres outside the old square a spray may reach
  function maple(seed, o = {}) {
    const r = rng(seed), brs = [], cards = [], H = o.h ?? (5 + r() * 3), spread = o.spread ?? 1, ls = o.leaf ?? 1.25, dens = o.dens ?? 1;
    const tintOf = () => { const b = 0.72 + r() * 0.5, w = r(); return [b * (1.0 + 0.1 * w), b * (0.80 + 0.35 * w), b * (0.80 + 0.2 * w)]; };
    // (the old skeleton, kept to the letter: it draws its random numbers in the old order)
    function branch(p0, dir, len, rad, depth) {
      const n = Math.max(3, Math.round(len / 0.7)), pts = [p0.clone()], radii = [rad], d = dir.clone(); let p = p0.clone(); const tmp = new THREE.Vector3();
      for (let i = 1; i <= n; i++) {
        const wnd = depth === 0 ? 0.16 : 0.34; d.x += (r() - .5) * wnd; d.z += (r() - .5) * wnd; d.y += (r() - .5) * wnd * 0.5 + (depth === 0 ? 0.03 : depth === 1 ? -0.03 : -0.01); d.normalize();
        p = p.clone().addScaledVector(d, len / n); pts.push(p); radii.push(rad * (1 - 0.6 * i / n));
        if (depth < 3 && i > n * (depth === 0 ? 0.42 : 0.25) && r() < (depth === 0 ? 0.85 : 0.6)) {
          perp(d, r() * TAU, tmp); if (depth === 0) tmp.y = Math.abs(tmp.y) * 0.3; const cd = d.clone().multiplyScalar(depth === 0 ? 0.45 : 0.8).addScaledVector(tmp, spread).normalize(); if (depth === 0) cd.y = Math.max(cd.y, 0.12);
          branch(p, cd, len * (depth === 0 ? 0.85 + r() * 0.3 : 0.55 + r() * 0.25), radii[i] * 0.72, depth + 1);
        }
        if (depth >= 2 || (depth === 1 && i > n * 0.6)) { const m = Math.round((1 + r() * 2) * dens); for (let q = 0; q < m; q++) { perp(d, r() * TAU, tmp); const f = new THREE.Vector3(tmp.x * 0.5, 0.75 + r() * 0.3, tmp.z * 0.5).normalize(); cards.push({ p, c: p.clone().addScaledVector(tmp, r() * 0.9).add(new THREE.Vector3(0, (r() - .3) * 0.5, 0)), f, s: ls * (0.75 + r() * 0.6), roll: r() * TAU, tint: tintOf(), w: 0.5 + r() * 0.6 }); } }
      }
      brs.push({ pts, radii, depth });
    }
    const base = new THREE.Vector3(0, -0.3, 0), dir = new THREE.Vector3((r() - .5) * 0.5 + (o.lean ? o.lean[0] : 0), 1, (r() - .5) * 0.5 + (o.lean ? o.lean[1] : 0)).normalize(), rad0 = o.rad ?? (0.20 + H * 0.022);
    branch(base, dir, H, rad0, 0);
    // ---- the new crown, inside the old one ----
    const quads = cards.map(oldQuad), margin = o.margin ?? 0.20, r2 = rng(seed * 7919 + 17), keep = o.keep ?? 1, sub = o.sub ?? 2, rib = !!o.rib, seg = o.seg ?? 1, list = [], cells = o.cells || [CELL[0], CELL[1], CELL[2]];
    const cc = V(); for (const q of quads) cc.add(q.c); cc.multiplyScalar(1 / quads.length); let Rc = 0; for (const q of quads) Rc = Math.max(Rc, q.c.distanceTo(cc) + q.h);
    const out = V(), ax = V(), nn = V(), ce = V(), wbOf = p => Math.pow(clamp(Math.hypot(p.x, p.y, p.z) / (H * 1.05), 0, 1.25), 1.6);
    const e1 = V(), e2 = V(), sqs = [];
    for (const q of quads) {
      if (r2() > keep) continue;
      // twigs run out along the side of the old square that points away from its branch; the square is cut into sub x sub sprays,
      // each tilted its own way and set a little above or below the plane, so the layer has leaves at the size of leaves
      out.subVectors(q.c, q.p); out.addScaledVector(q.n, -out.dot(q.n)); if (out.lengthSq() < 0.01) out.copy(q.a);
      { const da = out.dot(q.a), db = out.dot(q.b); if (Math.abs(da) > Math.abs(db)) e1.copy(q.a).multiplyScalar(Math.sign(da) || 1); else e1.copy(q.b).multiplyScalar(Math.sign(db) || 1); } e2.crossVectors(q.n, e1);
      const sq = { b: q.c, ax: e1.clone(), L: 0, W: q.s, over: 0, area: q.s * q.s }; sqs.push(sq);
      for (let i = 0; i < sub; i++) for (let jj = 0; jj < sub; jj++) {
        if (sub > 1 && r2() < 0.08) continue;                                                             // three of the four: the layer keeps its gaps
        const tl = sub > 1 ? 0.56 : 0.34; nn.copy(q.n).addScaledVector(q.a, (r2() - .5) * tl).addScaledVector(q.b, (r2() - .5) * tl).normalize();
        const a = (r2() - 0.5) * (sub > 1 ? 0.9 : 0.5); ax.copy(e1).multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a)); ax.addScaledVector(nn, -ax.dot(nn)).normalize();
        ce.copy(q.c).addScaledVector(e1, ((i + 0.5) / sub * 2 - 1) * q.h + (r2() - .5) * 0.1 * q.s).addScaledVector(e2, ((jj + 0.5) / sub * 2 - 1) * q.h + (r2() - .5) * 0.1 * q.s).addScaledVector(q.n, sub > 1 ? (r2() - .5) * 0.24 : 0);
        const k = { b: V(), ax: ax.clone(), n: nn.clone(), L: q.s / sub * (1.04 + 0.22 * r2()), W: 0, dr: 0, cell: cells[(r2() * cells.length) | 0], seg: sub > 1 ? 1 : seg, ph: r2(), fl: 0.7 + 0.6 * r2(), taper: 0, sq };
        k.W = k.L * (0.76 + 0.22 * r2()); k.dr = k.L * (0.05 + 0.12 * r2());
        let ok = false, ex = 0;
        for (let it = 0; it < 6 && !ok; it++) { k.b.copy(ce).addScaledVector(k.ax, -k.L * 0.5); const n = sprayVerts(k, sv); ex = 0; for (let v = 0; v < n; v++) ex = Math.max(ex, quadDist(q, sv[v]));
          if (ex <= margin) ok = true; else { k.L *= 0.84; k.W *= 0.84; k.dr *= 0.5; ce.lerp(q.c, 0.4); fit.shrunk++; } }
        if (!ok) { fit.dropped++; continue; }
        fit.maple = Math.max(fit.maple, ex); list.push(k);
      }
      if (rib) for (let i = 0; i < 2; i++) {                                                                                                  // the same twigs seen from the side: two short bands of leaves standing on edge, each leaning its own way
        const c = cells[(r2() * cells.length) | 0], w = c[2] - c[0], hgt = c[3] - c[1], L = q.s * (0.46 + 0.1 * r2()), W = Math.min(0.42, margin * 1.9), th = (r2() - .5) * 1.1, fr = clamp(W / L, 0.2, 0.6), u0 = c[0] + w * (0.5 - fr / 2 + (r2() - .5) * 0.2), v1 = c[3] - hgt * 0.1 * r2();
        list.push({ b: V().copy(q.c).addScaledVector(e1, (i ? 0.02 : -0.96) * q.h).addScaledVector(e2, (r2() - .5) * q.h * 0.9), ax: e1.clone(), n: V().copy(e2).multiplyScalar(Math.cos(th)).addScaledVector(q.n, Math.sin(th)), L, W, dr: 0, cell: [u0, v1 - hgt * 0.62, u0 + w * fr * 0.62, v1], seg: 1, ph: r2(), fl: 0.7 + 0.6 * r2(), taper: 0, sq }); }
    }
    skyShade(sqs);
    for (const k of list) { k.over = k.sq.over; ce.copy(k.b).addScaledVector(k.ax, k.L * 0.5); out.subVectors(ce, cc); const rr = out.length() / Rc; out.normalize();
      k.ao = (0.40 + 0.60 / (1 + 0.20 * k.over)) * (0.80 + 0.20 * sm(0.2, 0.9, rr)) * (0.9 + 0.2 * r2()); k.hu = 0.085 * (sm(0.35, 1.0, rr) - 0.5) + 0.05 * (1 / (1 + 0.3 * k.over) - 0.5) + (r2() - .5) * 0.10; k.br = 0.80 + 0.40 * r2();
      k.sn = V().copy(k.n).multiplyScalar(0.5).addScaledVector(out, 0.62).add(V(0, 0.16, 0)).normalize(); k.wb = [wbOf(k.b), wbOf(sP.copy(k.b).addScaledVector(k.ax, k.L))]; }
    // wood: the trunk flares into the ground; fine twigs are in the spray texture
    const wood = []; for (const b of brs) { if (b.radii[0] <= 0.045) continue; const rr = b.radii.slice(); if (b.depth === 0) for (let i = 0; i < 3 && i < rr.length; i++) rr[i] *= 1 + 0.55 * Math.exp(-i * 1.1);
      wood.push({ pts: b.pts, radii: rr, sides: b.depth === 0 ? 10 : b.depth === 1 ? 6 : 3, ao: b.depth === 0 ? 1 : 0.8, twig: b.depth > 1 }); }
    shuffle(list, rng(seed * 31 + 5));                                                                         // any leading share of the sprays is an even thinning of the crown (the far trees and the shadow pass draw fewer)
    return { wood: woodGeo(wood, wbOf, o.tint || [0.95, 0.9, 0.86], -0.3), woodF: woodGeo(wood, wbOf, o.tint || [0.95, 0.9, 0.86], -0.3, true), leaves: sprayGeo(list), n: list.length, cc, Rc, H };
  }
  function pine(seed, o = {}) {
    const r = rng(seed), brs = [], pads = [], H = o.h ?? (8 + r() * 5), cliff = !!o.cliff;
    // (the old skeleton and the old pads, to the letter)
    function pad(c, R, bp) {
      const cards = [], m = Math.round(22 + R * 14);
      for (let i = 0; i < m; i++) { const a = r() * TAU, e = Math.sqrt(r()), x = Math.cos(a) * e, z = Math.sin(a) * e, up = Math.sqrt(Math.max(0, 1 - e * e)); const b = 0.55 + r() * 0.7;
        cards.push({ p: c, c: new THREE.Vector3(c.x + x * R * 0.98, c.y + up * R * 0.30 + 0.12, c.z + z * R * 0.98), f: new THREE.Vector3(x * 0.9 + (r() - .5) * 0.5, 0.55 + up * 0.5, z * 0.9 + (r() - .5) * 0.5).normalize(), s: 1.0 + r() * 0.75, roll: (r() - .5) * 0.7 + (r() < .5 ? 0 : Math.PI), tint: [0.75 * b, 1.0 * b, 0.72 * b], w: 0.4 + r() * 0.5, sn: null }); }
      pads.push({ c, R, cards, bp });
    }
    const pts = [], radii = [], d = cliff ? new THREE.Vector3(0, 0.50, 1).normalize() : new THREE.Vector3((r() - .5) * 0.5, 1, (r() - .5) * 0.5).normalize(); let p = new THREE.Vector3(0, cliff ? -0.25 : -0.4, cliff ? -0.5 : 0); const n = 16, rad0 = 0.055 + H * 0.0095;      // a trunk 0.25 to 0.45 m through at the root, 0.1 m at the top
    // a cliff pine roots in a crack, leans 30 to 60 degrees out of the face and then turns up: the crown stands clear of the rock, above its own root
    for (let i = 0; i <= n; i++) {
      pts.push(p.clone()); radii.push(rad0 * (1 - 0.72 * i / n));
      d.x += (r() - .5) * (cliff ? 0.26 : 0.5); d.z += (r() - .5) * (cliff ? 0.20 : 0.5); d.y += cliff ? (i < 7 ? 0.085 : 0.26) : 0.12; d.normalize(); p = p.clone().addScaledVector(d, H / n);
      if (i >= 5 && (i % 2 === 1 || i === n)) {
        const a = r() * TAU, len = (2.2 + r() * 2.6) * (1 - 0.45 * i / n) * (o.reach ?? 1), bd = new THREE.Vector3(Math.cos(a), 0.10 + r() * 0.15, Math.sin(a)).normalize(), bp = [], br = []; let q = pts[i].clone();
        for (let k = 0; k <= 5; k++) { bp.push(q.clone()); br.push(radii[i] * 0.55 * (1 - 0.7 * k / 5)); q = q.clone().addScaledVector(bd, len / 5); bd.y += 0.05; bd.normalize(); }
        brs.push({ pts: bp, radii: br, sides: 5, ao: 0.75 }); pad(bp[5], (1.5 + r() * 1.3) * (1 - 0.3 * i / n) * (o.padK ?? 1), bp);
      }
    }
    { const rr = radii.slice(); for (let i = 0; i < 3; i++) rr[i] *= 1 + 0.45 * Math.exp(-i * 1.1); brs.push({ pts, radii: rr, sides: 8 }); }
    pad(pts[n].clone().add(new THREE.Vector3(0, 0.3, 0)), (1.7 + r() * 0.8) * (o.padK ?? 1), null);
    // ---- the new crown, inside the old pads. A Huangshan pine from 80 to 200 m: a red trunk and a few long limbs, each carrying a
    // flat-topped CLOUD of needles. A cloud is several clumps of different size with sky between them, set on the limb's forks:
    // every clump is a low dome (a plate of needle fans on top, a smaller dark one underneath, two upright cards through the middle,
    // shoot ends bristling on top), lit as a dome: yellow-green where it faces the sun, dark below. Rim clumps hang lower and tip
    // outward. Which boughs a tree keeps, and how far each is swept to leeward, is decided per tree in the vertex stage (FL_PINE).
    const r2 = rng(seed * 7919 + 29), margin = o.margin ?? 0.30, list = [], UP = V(0, 1, 0), ax = V(), nn = V(), ce = V(), rad = V(), dv = V();
    const root = pts[0], wbOf = q => Math.pow(clamp(q.distanceTo(root) / (H * 1.1), 0, 1.25), 1.5), nLimb = pads.length - 1, twigs = [];
    for (let b = 0; b < nLimb; b++) { const L = brs[b], az = Math.atan2(L.pts[5].z - L.pts[0].z, L.pts[5].x - L.pts[0].x); L.radii = L.radii.map(x => x * 1.2 + 0.015); L.tag = [L.pts[0].x, L.pts[0].y, L.pts[0].z, -1, b + 1, az]; pads[b].id = b + 1; pads[b].az = az; }
    pads[nLimb].id = 100; pads[nLimb].az = r2() * TAU; { const tr = brs[nLimb]; tr.radii = tr.radii.map(x => x * 0.92 + 0.02); }
    for (const pd of pads) {
      const c = pd.c, R = pd.R, env = envelope(pd.cards.map(oldQuad)), tag = [c.x, c.y, c.z, R, pd.id, pd.az];
      // a point may lie inside the old pad (taken at its thinnest: 0.78 of nominal) or within `margin` of an old card
      const exc = q => { dv.subVectors(q, c); const yy = dv.y / (dv.y > 0 ? 0.281 * R : 0.125 * R), qq = Math.sqrt((dv.x * dv.x + dv.z * dv.z) / (0.6084 * R * R) + yy * yy); return Math.min(qq <= 1 ? 0 : dv.length() * (1 - 1 / qq), env(q)); };
      const push = (k, soft) => { let ok = false, ex = 0;
        for (let it = 0; it < 7 && !ok; it++) { const n = sprayVerts(k, sv); ce.copy(k.b).addScaledVector(k.ax, k.L * 0.5); ex = 0; for (let v = 0; v < n; v++) { if (soft) sv[v].lerp(ce, 0.14); ex = Math.max(ex, exc(sv[v])); }                 // (soft: the texture leaves the corners empty; the silhouette is a little inside them)
          if (ex <= margin) ok = true; else { const f = 0.86; k.L *= f; k.W *= f; k.dr *= f; k.b.copy(ce).addScaledVector(k.ax, -k.L * 0.5); fit.shrunk++; } }
        if (!ok) { fit.dropped++; return false; } fit.pine = Math.max(fit.pine, ex); k.wb = [wbOf(k.b), wbOf(sP.copy(k.b).addScaledVector(k.ax, k.L))]; k.ph = r2(); k.seg = k.seg || 1; k.taper = 0; k.tag = tag; list.push(k); return true; };
      // the clumps of this cloud: one over the limb's end, the rest on its forks
      const cl = [{ x: 0, z: 0, r: (0.52 + 0.10 * r2()) * R, y: 0.09 * R, d: 0 }], a0 = r2() * TAU, nC = 5 + (r2() * 3 | 0);
      for (let k = 0; k < nC; k++) { if (r2() < 0.12) continue; const a = a0 + k * TAU / nC + (r2() - .5) * 0.8, rr = (0.30 + 0.16 * r2()) * R, d = Math.min(0.99 * R - rr, (0.50 + 0.17 * r2()) * R);
        cl.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: rr, y: (0.05 - 0.14 * d / R + (r2() - .5) * 0.05) * R, d }); }
      for (const q of cl) {
        const cc = V(c.x + q.x, c.y + q.y, c.z + q.z), rr = q.r, ox = q.d > 0 ? q.x / q.d : 0, oz = q.d > 0 ? q.z / q.d : 0, lean = 0.55 * q.d / R;
        // the dome's own normal at a point: up over the middle, outward at the rim, the whole cloud's rim leaning out as well
        const dome = (up, k) => (p, out) => out.set((p.x - cc.x) / rr * k + ox * lean, up, (p.z - cc.z) / rr * k + oz * lean).normalize();
        const hu0 = (r2() - .5) * 0.16, ya = r2() * TAU, tilt = 0.10 + 0.36 * q.d / R;
        // the top plate: it tips outward and down toward the rim of the cloud
        nn.set(ox * tilt, 1, oz * tilt).normalize(); ax.set(Math.cos(ya), 0, Math.sin(ya)); ax.addScaledVector(nn, -ax.dot(nn)).normalize();
        push({ b: V().copy(cc).addScaledVector(UP, 0.10 * rr).addScaledVector(ax, -rr * 1.06), ax: ax.clone(), n: nn.clone(), L: rr * 2.12, W: rr * 2.12, dr: 0, cell: CELL[r2() < 0.5 ? 0 : 1], ao: 1.0, hu: hu0 + 0.16, br: 0.95 + 0.25 * r2(), snf: dome(0.85, 0.75), fl: 0.6, plate: 1 }, true);
        // the underside: smaller, darker, the branchlets' colour
        if (q.d === 0) { const yb = r2() * TAU; ax.set(Math.cos(yb), 0, Math.sin(yb)); push({ b: V().copy(cc).addScaledVector(UP, -0.10 * rr).addScaledVector(ax, -rr * 0.80), ax: ax.clone(), n: UP.clone(), L: rr * 1.6, W: rr * 1.6, dr: 0, cell: CELL[r2() < 0.5 ? 0 : 1], ao: 0.50, hu: hu0 - 0.22, br: 0.8, snf: dome(-0.55, 0.9), fl: 0.6 }, true); }
        // two upright cards through the middle: the clump from the side, bright along its top, dark where it hangs
        const nS = q.d > 0 ? 2 : 3, s0 = r2() * Math.PI;
        for (let k = 0; k < nS; k++) { const a = s0 + k * Math.PI / nS + (r2() - .5) * 0.35, hw = rr * (0.98 - 0.08 * k), hh = 0.58 * rr + 0.14; rad.set(Math.cos(a), 0, Math.sin(a)); nn.set(-rad.z, 0, rad.x);
          const lo = dome(-0.30, 0.95), hi = dome(0.95, 0.55);
          push({ b: V(cc.x, cc.y - 0.20 * rr, cc.z), ax: UP.clone(), n: nn.clone(), L: hh, W: hw * 2, dr: 0, cell: r2() < 0.5 ? [0, 0.5, 0.5, 0.75] : [0, 0.75, 0.5, 1], ao: 0.95, ao2: 0.50, hu: hu0 + 0.04, br: 0.9 + 0.2 * r2(),
            snf: (p, out, t) => t < 0.5 ? lo(p, out) : hi(p, out), fl: 0.5, seg: 1 }, true); }
        // shoot ends standing out of the top
        const nT = 1 + (r2() * 1.8 | 0) + (q.d > 0 ? 0 : 2);
        for (let k = 0; k < nT; k++) { const a = r2() * TAU, d = Math.sqrt(r2()) * 0.72 * rr, L = (0.34 + 0.20 * r2()) * rr + 0.22, fa = r2() * TAU, px = cc.x + Math.cos(a) * d, pz = cc.z + Math.sin(a) * d;
          nn.set(Math.cos(fa), 0, Math.sin(fa)); ax.set(Math.cos(a) * 0.25 * d / rr, 1, Math.sin(a) * 0.25 * d / rr).normalize(); nn.addScaledVector(ax, -nn.dot(ax)).normalize();
          push({ b: V(px, cc.y + 0.02 * rr, pz), ax: ax.clone(), n: nn.clone(), L, W: L * (0.95 + 0.3 * r2()), dr: 0, cell: [0.5 + (k % 2) * 0.25, 0.5 + ((k >> 1) % 2) * 0.25, 0.75 + (k % 2) * 0.25, 0.75 + ((k >> 1) % 2) * 0.25], ao: 1.0, ao2: 0.62, hu: hu0 + 0.22 + 0.2 * r2(), br: 1.0 + 0.3 * r2(), snf: dome(0.9, 0.6), fl: 1.0 }, false); }
        // the fork that carries it
        if (q.d > 0 && rr > 0.34 * R) { const e = V(cc.x, cc.y - 0.10 * rr, cc.z); twigs.push({ pts: [V(c.x, c.y - 0.04 * R, c.z), e], radii: [0.075, 0.035], sides: 3, ao: 0.7, tag, twig: true }); }
      }
    }
    for (const t of twigs) brs.push(t);
    let cc = V(), Rc = 0; for (const pd of pads) cc.add(pd.c); cc.multiplyScalar(1 / pads.length); for (const pd of pads) Rc = Math.max(Rc, pd.c.distanceTo(cc) + pd.R);
    list.sort((a, b) => (b.plate || 0) - (a.plate || 0)); const nPlate = list.filter(k => k.plate).length;      // the top plates lead: they are all a far pine's shadow needs
    const tint = [1.6, 2.15, 2.5];                                                                              // grey-brown plated bark
    return { wood: woodGeo(brs, wbOf, tint, cliff ? -9 : -0.4), woodF: woodGeo(brs, wbOf, tint, cliff ? -9 : -0.4, true), leaves: sprayGeo(list), n: list.length, nPlate, cc, Rc, H };
  }
  // a shrub: three shells of small sprays lying on a dome, the inner ones in shade. Unit size; cell picks the leaf form
  function shrub(seed, n, cells, o = {}) {
    const r = rng(seed), list = [], dir = V(), nn = V(), ax = V(), UP = V(0, 1, 0), big = o.big ?? 1;
    for (let i = 0; i < n; i++) {
      const sh = o.shells ? o.shells[i % o.shells.length] : i % 5 === 0 ? 0.52 : i % 5 < 3 ? 0.78 : 1.0, az = r() * TAU, el = Math.asin(Math.pow(r(), 0.75)) * 0.96 + 0.04; dir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
      nn.copy(dir).add(V((r() - .5) * 0.7, (r() - .2) * 0.5, (r() - .5) * 0.7)).normalize(); ax.copy(UP).addScaledVector(dir, 0.35 * (r() - .5)); ax.x += (r() - .5) * 0.9; ax.z += (r() - .5) * 0.9; ax.addScaledVector(nn, -ax.dot(nn)).normalize();
      const L = (0.50 + 0.22 * r()) * (1.18 - 0.28 * sh) * big, c = V(dir.x * sh, dir.y * sh * 0.85, dir.z * sh), b = c.clone().addScaledVector(ax, -L * 0.5); if (b.y < 0.02) b.y = 0.02;
      list.push({ b, ax: ax.clone(), n: nn.clone(), L, W: L * (0.78 + 0.2 * r()), dr: L * 0.12 * r(), cell: cells[(r() * cells.length) | 0], ao: (0.34 + 0.66 * Math.pow(sh, 1.6)) * (0.62 + 0.38 * dir.y), ao2: 0.75, hu: (r() - .5) * 0.10 + 0.05 * (sh - 0.8), br: 0.85 + 0.3 * r(),
        sn: V().copy(dir).multiplyScalar(0.8).add(V(0, 0.35, 0)).normalize(), wb: [0.25 + 0.5 * sh * dir.y, 0.45 + 0.6 * sh * (0.4 + dir.y)], fl: 0.6 + 0.6 * r(), ph: r(), seg: 1, taper: 0 });
    }
    return sprayGeo(list);
  }
  // a fern: fronds arching out of one crown
  function fern(seed) {
    const r = rng(seed), list = [], n = 7;
    for (let i = 0; i < n; i++) { const a = i / n * TAU + r() * 0.5, e = 0.55 + 0.5 * r(), ax = V(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)), nn = V(-Math.cos(a) * Math.sin(e), Math.cos(e), -Math.sin(a) * Math.sin(e)), L = 0.34 + 0.20 * r();
      list.push({ b: V(0, 0.01, 0), ax, n: nn, L, W: L * 0.50, dr: L * (0.30 + 0.2 * r()), cell: CELL[2], ao: 1.0, ao2: 0.7, hu: (r() - .5) * 0.12, br: 0.9 + 0.25 * r(), sn: V(nn.x * 0.5, 0.85, nn.z * 0.5).normalize(), wb: [0.05, 1.0], fl: 0.8, ph: r(), seg: 2, taper: 0 }); }
    return sprayGeo(list);
  }
  // a clump of fine grass: each blade 5 vertices, 2 cm wide, curving out from the root
  function clump(seed, nb, o = {}) {
    const r = rng(seed), P = [], N = [], C = [], W = [], S = [], I = [], sp = o.spread ?? 0.24, far = !!o.far;
    for (let b = 0; b < nb; b++) {
      const a = r() * TAU, d = sp * Math.sqrt(r()), x0 = Math.cos(a) * d, z0 = Math.sin(a) * d, ya = r() * TAU, ox = Math.cos(ya), oz = Math.sin(ya), h = (o.h0 ?? 0.14) + (o.h1 ?? 0.26) * r() * r() + (b < 2 ? (o.h0 ?? 0.14) * 0.6 : 0), lean = (0.10 + 0.42 * r()) * (o.lean ?? 1), w = (0.008 + 0.005 * r()) * (o.w ?? 1) * (far ? 1.7 : 1), sx = -oz, sz = ox;
      const dry = r() < (o.dry ?? 0.24), g = dry ? [0.36 + 0.2 * r(), 0.27 + 0.1 * r(), 0.08] : [0.085 + 0.06 * r(), 0.19 + 0.13 * r(), 0.032], v0 = P.length / 3, ph = r();
      for (let i = 0; i < 3; i++) { if (far && i === 1) continue; const t = i / 2, px = x0 + ox * lean * h * t * t, pz = z0 + oz * lean * h * t * t, py = h * t * (1 - 0.12 * lean * t), ww = i === 2 ? 0 : w * (1 - 0.3 * t), sh = 0.30 + 0.70 * t;
        for (const sd of (i === 2 ? [0] : [-1, 1])) { P.push(px + sx * ww * sd, py, pz + sz * ww * sd); N.push(ox * 0.45, 0.85, oz * 0.45); C.push(g[0] * sh, g[1] * sh, g[2] * sh); W.push(t, 0, ph); S.push(sx * ww * sd, sz * ww * sd); } }
      if (far) I.push(v0, v0 + 1, v0 + 2); else I.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(W, 3)); g.setAttribute('aSide', new THREE.Float32BufferAttribute(S, 2)); g.setIndex(I); return g;
  }
  // a creeper hanging over a lip of rock: a few strands of leaves, fixed at the top, free to swing
  function creeper(seed) {
    const r = rng(seed), list = [];
    for (let k = 0; k < 5; k++) { const L = 0.50 + 0.45 * r(), x = (k - 2) * 0.17 + (r() - .5) * 0.10, ax = V((r() - .5) * 0.30, -1, 0.04 + 0.10 * r()).normalize(), n = V((r() - .5) * 0.5, 0.12, 1).normalize(); n.addScaledVector(ax, -n.dot(ax)).normalize();
      list.push({ b: V(x, 0.04, 0.04 + 0.10 * r()), ax, n, L, W: 0.24 + 0.10 * r(), dr: 0, cell: CELL[k % 2], ao: 1.0, ao2: 0.8, hu: (r() - .5) * 0.10, br: 0.9 + 0.25 * r(), sn: V(n.x * 0.6, 0.45, n.z * 0.6).normalize(), wb: [0.0, 1.0], fl: 1.0, ph: r(), seg: 2, taper: 0 }); }
    return sprayGeo(list);
  }
  // a mat of grass and fern rooted on a ledge and spilling over its lip (local +z points out of the cliff): tongues of different
  // length that start flat on the shelf and droop over the edge, narrowing to their tips, and cushions standing where it roots
  function spill(seed, o = {}) {
    const r = rng(seed), list = [], n = o.n ?? 9;
    for (let k = 0; k < n; k++) { const x0 = ((k + 0.5) / n * 2 - 1) * 1.1 + (r() - .5) * 0.3, a = x0 * 0.45 + (r() - .5) * 0.5, L = 0.7 + 1.6 * r() * r(), ax = V(Math.sin(a), 0.10 + 0.14 * r(), Math.cos(a)).normalize(), nn = V((r() - .5) * 0.6, 1, (r() - .5) * 0.2).normalize(); nn.addScaledVector(ax, -nn.dot(ax)).normalize();
      const u0 = 0.5 + 0.30 * r();
      list.push({ b: V(x0, 0.05 + 0.08 * r(), -0.50 - 0.25 * r()), ax, n: nn, L, W: 0.55 + 0.40 * r(), dr: L * (0.50 + 0.50 * r()), cell: [u0, 0.5 - 0.5 * Math.min(1, L / 1.9), u0 + 0.20, 0.5], ao: 1.0, ao2: 0.62, hu: (r() - .5) * 0.14, br: 0.85 + 0.3 * r(), sn: V(nn.x * 0.4, 0.8, 0.45).normalize(), wb: [0.0, 1.0], fl: 0.9, ph: r(), seg: o.seg ?? 3, taper: 0.45 }); }
    for (let k = 0; k < (o.tufts ?? 4); k++) { const x0 = ((k + 0.5) / 4 * 2 - 1) * 0.95 + (r() - .5) * 0.3, a = r() * TAU, ax = V(Math.sin(a) * 0.3, 1, 0.2 + Math.cos(a) * 0.3).normalize(), nn = V(Math.cos(a), -0.2, Math.sin(a)).normalize(); nn.addScaledVector(ax, -nn.dot(ax)).normalize(); const L = 0.55 + 0.35 * r();
      list.push({ b: V(x0, -0.04, -0.15 - 0.35 * r()), ax, n: nn, L, W: L * 1.25, dr: 0.05, cell: CMS, ao: 0.9, ao2: 0.6, hu: (r() - .5) * 0.14, br: 0.9 + 0.3 * r(), sn: V(0, 0.8, 0.55).normalize(), wb: [0.05, 0.8], fl: 0.9, ph: r(), seg: 1, taper: 0 }); }
    return sprayGeo(list);
  }
  // creepers hanging down a face: local +y runs up the face, +z out of it, unit length (the instance stretches it). A knot of
  // leaves where they root, then separate strands of different length, each narrowing to its tip. Fixed at the top, free below
  function curtain(seed, o = {}) {
    const r = rng(seed), list = [], n = o.n ?? 6;
    for (let k = 0; k < n; k++) { const x0 = ((k + 0.5) / n * 2 - 1) * 0.50 + (r() - .5) * 0.16, L = 0.30 + 0.70 * Math.pow(r(), 0.8), ax = V((r() - .5) * 0.26, -1, 0).normalize(), nn = V((r() - .5) * 0.7, 0, 1).normalize(); nn.addScaledVector(ax, -nn.dot(ax)).normalize();
      const u0 = (k % 2 ? 0.25 : 0) + 0.02 + 0.13 * r(), w = 0.075 + 0.02 * r();
      list.push({ b: V(x0, 0.06 * r(), 0.06 + 0.08 * r()), ax, n: nn, L, W: 0.20 + 0.10 * r(), dr: -0.03 * r(), cell: [u0, 1 - 0.62 * L, u0 + w, 1], ao: 1.0, ao2: 0.8, hu: (r() - .5) * 0.12, br: 0.8 + 0.35 * r(), sn: V(nn.x * 0.5, 0.5, 0.75).normalize(), wb: [0.0, 1.0], fl: 1.0, ph: r(), seg: o.seg ?? 3, taper: 0.8 }); }
    for (let k = 0; k < 2; k++) { const x0 = (k - 0.5) * 0.45 + (r() - .5) * 0.2, ax = V((r() - .5) * 0.5, -1, 0.3).normalize(), nn = V((r() - .5) * 0.4, 0.3, 1).normalize(); nn.addScaledVector(ax, -nn.dot(ax)).normalize();
      list.push({ b: V(x0, 0.10, 0.05), ax, n: nn, L: 0.16 + 0.05 * r(), W: 0.50 + 0.12 * r(), dr: 0, cell: CMS, ao: 0.95, ao2: 0.75, hu: (r() - .5) * 0.12, br: 0.85 + 0.3 * r(), sn: V(0, 0.6, 0.7).normalize(), wb: [0.0, 0.15], fl: 0.6, ph: r(), seg: 1, taper: 0 }); }
    return sprayGeo(list);
  }
  // how deep in a recess every site of the rock lies: the mean cosine between its normal and the way to its neighbours within 3 m
  // (0 on a flat face, about +0.2 in a gully or a crack, negative on a rib, a bulge or the lip of a ledge)
  function relief(S) {
    const cell = 3, m = new Map(), key = (i, j, k) => ((i + 128) * 256 + (j + 128)) * 256 + (k + 128), fl = Math.floor, cav = new Float32Array(S.length); cav.out = new Float32Array(S.length * 2); cav.den = new Float32Array(S.length);      // out: the way the rock faces round a site (mean normal of its neighbours, level); den: sites per square metre there
    for (let i = 0; i < S.length; i++) { const p = S[i].p, k = key(fl(p.x / cell), fl(p.y / cell), fl(p.z / cell)); let l = m.get(k); if (!l) m.set(k, l = []); l.push(i); }
    for (let i = 0; i < S.length; i++) { const p = S[i].p, n = S[i].n, ix = fl(p.x / cell), iy = fl(p.y / cell), iz = fl(p.z / cell); let sum = 0, cnt = 0, ox = n.x, oz = n.z;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const l = m.get(key(ix + a, iy + b, iz + c)); if (!l) continue;
        for (let q = 0; q < l.length; q++) { const o = S[l[q]].p, dx = o.x - p.x, dy = o.y - p.y, dz = o.z - p.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > 9 || d2 < 0.04) continue; sum += (dx * n.x + dy * n.y + dz * n.z) / Math.sqrt(d2); cnt++; ox += S[l[q]].n.x; oz += S[l[q]].n.z; } }
      cav[i] = cnt > 3 ? sum / cnt : 0; cav.out[i * 2] = ox / (cnt + 1); cav.out[i * 2 + 1] = oz / (cnt + 1); cav.den[i] = (cnt + 1) / 28.3; }
    return cav;
  }
  // ---------- instancing ----------
  const dummy = new THREE.Object3D(), colr = new THREE.Color(), YAX = V(0, 1, 0), qN = new THREE.Quaternion(), qY = new THREE.Quaternion();
  // list: [{p, yaw, s, sy, rx, rz, col, tree: [hue, spread, bright, seed], nrm: stand on this normal instead of upright}]
  // the same vertex data under a new geometry object, so each group of instances can carry its own per-instance attributes
  const share = geo => { const g = new THREE.BufferGeometry(); for (const k in geo.attributes) if (!geo.attributes[k].isInstancedBufferAttribute) g.setAttribute(k, geo.attributes[k]); g.setIndex(geo.index); return g; };
  // split a list into up to K compact groups (k-means from farthest-point seeds: the same every load)
  function split(list, K) {
    if (K < 2 || list.length < 16) return [list];
    const c = [list[0].p.clone()]; while (c.length < K) { let best = null, bd = -1; for (const k of list) { let d = 1e9; for (const q of c) d = Math.min(d, q.distanceToSquared(k.p)); if (d > bd) { bd = d; best = k; } } c.push(best.p.clone()); }
    const asg = new Int32Array(list.length), sum = c.map(() => V()), cnt = new Int32Array(K);
    for (let it = 0; it < 7; it++) { for (let i = 0; i < list.length; i++) { let b = 0, bd = 1e18; for (let j = 0; j < K; j++) { const d = c[j].distanceToSquared(list[i].p); if (d < bd) { bd = d; b = j; } } asg[i] = b; }
      sum.forEach(v => v.set(0, 0, 0)); cnt.fill(0); for (let i = 0; i < list.length; i++) { sum[asg[i]].add(list[i].p); cnt[asg[i]]++; } for (let j = 0; j < K; j++) if (cnt[j]) c[j].copy(sum[j]).multiplyScalar(1 / cnt[j]); }
    const out = c.map(() => []); for (let i = 0; i < list.length; i++) out[asg[i]].push(list[i]); return out.filter(l => l.length);
  }
  function inst(scene, geo0, mat, list, o = {}) {
    if (!list.length) return null;
    const geo = share(geo0), m = new THREE.InstancedMesh(geo, mat, list.length); m.castShadow = o.cast !== false; m.receiveShadow = true;
    for (let i = 0; i < list.length; i++) { const k = list[i]; dummy.position.copy(k.p);
      if (k.q) dummy.quaternion.copy(k.q); else if (k.nrm) dummy.quaternion.copy(qN.setFromUnitVectors(YAX, k.nrm)).multiply(qY.setFromAxisAngle(YAX, k.yaw || 0)); else dummy.rotation.set(k.rx || 0, k.yaw || 0, k.rz || 0, 'YXZ');
      dummy.scale.setScalar(k.s || 1); if (k.sy) dummy.scale.y *= k.sy; dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); if (k.col) m.setColorAt(i, colr.setRGB(k.col[0], k.col[1], k.col[2])); }
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    if (o.tree !== false && mat !== mats.grass && mat !== mats.grassL && mat !== mats.blob && mat !== barkM && mat !== barkP) { const a = new Float32Array(list.length * 4); for (let i = 0; i < list.length; i++) { const t = list[i].tree || [0.3, 0.2, 1, 0]; a.set(t, i * 4); } geo.setAttribute('aTree', new THREE.InstancedBufferAttribute(a, 4)); }
    if (mat !== mats.blob && !LITE.has(mat)) { const e = o.wake ? o.wake.e : [0, 1, 2].map(() => new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4)); geo.setAttribute('aE0', e[0]); geo.setAttribute('aE1', e[1]); geo.setAttribute('aE2', e[2]); }
    if (m.castShadow && mat.userData.depth) m.customDepthMaterial = mat.userData.depth;
    if (o.range) geo.setDrawRange(0, o.range);
    if (o.shRange !== undefined && m.castShadow) { const full = o.range || Infinity, sh = o.shRange; m.onBeforeShadow = () => { geo.setDrawRange(0, sh); }; m.onAfterShadow = () => { geo.setDrawRange(0, full); }; }      // the shadow pass draws a thinner tree
    if (o.name) m.name = o.name; if (o.thin) m.userData.thin = true;          // instances are in random order: 90_main.js may draw only the first half on a slow machine
    if (o.reach) { const c = V(); for (const k of list) c.add(k.p); c.multiplyScalar(1 / list.length); let r = 0; for (const k of list) r = Math.max(r, c.distanceTo(k.p)); m.boundingSphere = new THREE.Sphere(c, r + o.reach); m.frustumCulled = true; nGroups++; }
    else m.frustumCulled = false;
    scene.add(m); return m;
  }
  let nGroups = 0;
  // world centre of a crown: the variant's own centre, through the instance's yaw and scale
  const ctr = (list, cc) => (i, out) => { const k = list[i]; return out.copy(cc).multiplyScalar(k.s || 1).applyAxisAngle(YAX, k.yaw || 0).add(k.p); };
  // choose well-spaced sites
  function pick(filter, count, minD, seed) {
    const r = rng(seed), c = Rock.sites.filter(filter), out = []; const keep = G.keepOut || [];
    for (let i = c.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0, t = c[i]; c[i] = c[j]; c[j] = t; }
    for (const s of c) { if (out.length >= count) break; let ok = true;
      for (const k of keep) if (Math.hypot(s.p.x - k.x, s.p.z - k.z) < k.r && s.p.y > k.y0 && s.p.y < k.y1) { ok = false; break; }
      if (ok) for (const q of out) if (q.p.distanceToSquared(s.p) < minD * minD) { ok = false; break; }
      if (ok) out.push(s); }
    return out;
  }
  // metres from a point to the crane's whole path
  const camPts = [];
  function camDist(p) { if (!camPts.length && typeof Film !== 'undefined') for (let t = 0; t <= Film.DUR; t += 0.75) camPts.push(Film.camAt(t, V())); let b = 1e9; for (const c of camPts) { const d = c.distanceToSquared(p); if (d < b) b = d; } return Math.sqrt(b); }
  const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0, t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const flatTags = new Set(['ledgeL', 'terR', 'gate', 'bank', 'isle', 'root', 'mass']);
  async function build(scene, prog, tick) {
    const tm = {}; let tl = performance.now(); const lap = n => { const t = performance.now(); tm[n] = Math.round(t - tl); tl = t; };
    textures(); lap('tex'); materials();
    const r = rng(404), rh = rng(9090), blobs = [], treeAt = [], t1 = V(), t2 = V();
    // --- variants
    const maples = [maple(1, { h: 5.5 }), maple(2, { h: 7, spread: 1.2, keep: 0.84 }), maple(3, { h: 4.5, spread: 1.3, leaf: 1.1 })];      // (the big one carries 4 800 sprays in the old crown: one old card in six is left bare, sky shows through)
    lap('mapleV'); prog(0.12); await tick(); tl = performance.now();
    const pinesV = [pine(11), pine(12, { h: 11 }), pine(13, { cliff: true, h: 6.4 }), pine(14, { cliff: true, h: 7.6, reach: 1.2 })];
    lap('pineV'); prog(0.25); await tick(); tl = performance.now();
    // --- maples on terraces, ledges and wall shelves
    const inView = s => s.p.z > -150 && s.p.z < 100 && Math.abs(s.p.x) < 90;
    const lair = s => s.tag === 'main' && s.p.y > 30;        // keep the dragon's coil clear of trunks
    const corridor = s => s.p.z > 6 && Math.abs(s.p.x + 2) < 21;
    const nearCam = s => s.p.z > 56 && Math.abs(s.p.x + 3.5) < 8;
    const mSites = pick(s => inView(s) && !corridor(s) && !lair(s) && s.n.y > 0.72 && s.p.y > 1.5 && s.p.y < 78 && (flatTags.has(s.tag) || s.tag.startsWith('wall') || s.tag === 'spire' || s.tag === 'main'), 84, 6.5, 1);
    // the old tint draw, kept (it is part of the frozen random stream); its three classes become three families of colour
    const tintM = () => { const q = r(); if (q < 0.55) r(); return q; };
    const hueM = q => { const u = rh(); return q < 0.55 ? (u < 0.72 ? 0.27 + 0.20 * rh() : u < 0.90 ? 0.10 + 0.12 * rh() : 0.92 + 0.08 * rh()) : q < 0.8 ? (u < 0.7 ? 0.50 + 0.14 * rh() : 0.68 + 0.10 * rh()) : 0.06 + 0.16 * rh(); };
    const treeOf = h => [h, 0.40 + 0.18 * rh(), 0.9 + 0.25 * rh(), rh()];
    // trees are drawn by how far they stand from the crane's whole path. Near: everything. Middle: the shadow pass draws a
    // thinner crown. Far: lean wood that casts no shadow, a thinner crown (maples) and only the pines' top plates in the shadow pass
    const six = n => Math.max(6, Math.round(n) * 6);
    const addTree = (v, all, bm, lm, tear, name, K = 1) => { const made = [], pn = lm === mats.pine, mp = lm === mats.maple, cls = [[], [], []], D1 = pn ? 70 : mp ? 60 : 1e9;
      for (const k of all) cls[camDist(k.p) < D1 ? 0 : 2].push(k);
      cls.forEach((part, c) => { if (part.length) for (const list of split(part, K)) { const wk = Wake.plants(list.length, { name, centre: ctr(list, v.cc), R: i => v.Rc * 0.75 * (list[i].s || 1), tear, shed: pn ? 0.3 : 0, hue: pn ? i => 0.93 + 0.07 * list[i].tree[3] : i => list[i].tree[0] });
        const reach = (v.cc.length() + v.Rc) * list.reduce((a, k) => Math.max(a, k.s || 1), 0) + 5, far = c === 2 && v.woodF;
        const lo = pn ? { shRange: far ? six(v.nPlate) : undefined } : mp ? { shRange: far ? six(v.n * 0.4) : undefined } : {};
        made.push({ list, wk, meshes: [inst(scene, far ? v.woodF : v.wood, bm, list, { wake: wk, reach, cast: !far }), inst(scene, v.leaves, lm, list, Object.assign({ wake: wk, reach }, lo))] }); } });
      for (const k of all) { if (k.late) continue; blobs.push({ p: k.p.clone().addScaledVector(k.site ? k.site.n : YAX, 0.05), nrm: k.site ? k.site.n : YAX, s: (k.s || 1) * v.H * (lm === mats.pine ? 0.22 : 0.42), yaw: 0 }); if (tear) treeAt.push({ p: k.p, R: v.Rc * (k.s || 1), hue: k.tree[0] }); }
      return made;
    };
    maples.forEach((v, i) => { const list = mSites.filter((_, k) => k % maples.length === i).map(s => ({ site: s, p: s.p, yaw: r() * TAU, s: 0.7 + r() * 0.55, tree: treeOf(hueM(tintM())) })); addTree(v, list, barkM, mats.maple, 1, 'maple' + i); });
    // --- plum blossom
    const pl = maple(7, { h: 4, spread: 1.4, leaf: 1.5, dens: 0.8, tint: [0.7, 0.62, 0.6], cells: [CELL[3]] }), pSites = pick(s => inView(s) && !corridor(s) && s.n.y > 0.75 && s.p.y > 2 && s.p.y < 45 && flatTags.has(s.tag), 18, 9, 2).map(s => ({ site: s, p: s.p, yaw: r() * TAU, s: 0.8 + r() * 0.5, tree: [1.16 + 0.14 * rh(), 0.30, 1.0, rh()] }));
    addTree(pl, pSites, barkM, mats.bush, 0.25, 'plum');
    lap('maples'); prog(0.45); await tick(); tl = performance.now();
    // --- how the rock lies round every site (recess, the way it faces, how thick the sites are), where seepage keeps it green,
    // and which sites the lens can ever see: the far side of a spire grows nothing new
    const cav = relief(Rock.sites), cavOf = new Map(); Rock.sites.forEach((s, i) => cavOf.set(s, cav[i]));
    const moist = p => sm(-0.16, 0.20, NZ.fbm(p.x * 0.035, p.y * 0.05, p.z * 0.035, 3));                           // gully systems tens of metres across
    const camS = []; if (typeof Film !== 'undefined') for (let t = 0; t <= Film.DUR; t += 4.5) camS.push(Film.camAt(t, V()));
    const seen = i => { const ox = cav.out[i * 2], oz = cav.out[i * 2 + 1], ol = Math.hypot(ox, oz); if (ol < 0.2 || !camS.length) return true; const p = Rock.sites[i].p;
      for (const c of camS) { const dx = c.x - p.x, dz = c.z - p.z; if ((dx * ox + dz * oz) / (Math.hypot(dx, dz) * ol) > -0.3) return true; } return false; };
    const cleared = (made, R, cc) => { if (!Wake.clear) return; for (const m of made) Wake.clear(m.meshes, m.list.length, cc ? ctr(m.list, cc) : (j, out) => out.copy(m.list[j].p), j => R(m.list[j]), m.wk); };
    // --- Huangshan pines: upright on shelves and tops, cliff-hangers on the faces
    const upS = pick(s => inView(s) && !lair(s) && !(s.p.z > 30 && Math.abs(s.p.x + 2) < 16) && s.n.y > 0.6 && s.p.y > 8 && (s.tag === 'spire' || s.tag === 'main' || s.tag.startsWith('wall') || s.tag === 'gate'), 230, 3.6, 3);
    const clS = pick(s => inView(s) && !lair(s) && s.n.y > -0.15 && s.n.y < 0.55 && s.p.y > 6 && (s.tag === 'spire' || s.tag === 'main' || s.tag.startsWith('wall')), 330, 3.8, 4);
    const pineT = () => [0.30 + 0.40 * rh(), 0.55, 0.85 + 0.35 * rh(), rh()];
    const pineL = [[], [], [], []];
    for (let i = 0; i < 2; i++) pineL[i] = upS.filter((_, k) => k % 2 === i).map(s => ({ site: s, p: s.p, yaw: r() * TAU, s: 0.55 + r() * 0.6 + sm(60, 140, s.p.distanceTo(new THREE.Vector3(0, 10, 60))) * 0.25, tree: pineT() }));
    for (let i = 0; i < 2; i++) pineL[2 + i] = clS.filter((_, k) => k % 2 === i).map(s => ({ site: s, p: s.p, yaw: Math.atan2(s.n.x, s.n.z), s: 0.55 + r() * 0.65, tree: pineT() }));
    // more pines where the lens can see them: the shoulders, ledges and cracks of the spires first, then the walls and the gate
    // cliff (their own random stream; none within 3.4 m of another pine; a site the halls are seen across takes no tree). Any
    // that would stand in a loong's way is taken out when the rails are known (Wake.clear)
    { const rp = rng(7771), S = Rock.sites, cand = [], cellP = 4, gp = new Map(), kp = (i, j, k) => ((i + 256) * 512 + (j + 256)) * 512 + (k + 256), fl = Math.floor;
      const put = p => { const k = kp(fl(p.x / cellP), fl(p.y / cellP), fl(p.z / cellP)); let l = gp.get(k); if (!l) gp.set(k, l = []); l.push(p); };
      const free = (p, d) => { const ix = fl(p.x / cellP), iy = fl(p.y / cellP), iz = fl(p.z / cellP); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const l = gp.get(kp(ix + a, iy + b, iz + c)); if (l) for (const q of l) if (q.distanceToSquared(p) < d * d) return false; } return true; };
      for (const s of upS) put(s.p); for (const s of clS) put(s.p); for (const s of mSites) put(s.p);
      for (let i = 0; i < S.length; i++) { const s = S[i], ny = s.n.y, sp = s.tag === 'spire' || s.tag === 'main'; if (!(sp || s.tag.startsWith('wall') || s.tag === 'gate') || !inView(s) || s.p.y < 9 || ny < -0.1 || (ny > 0.55 && ny <= 0.6)) continue;
        if ((s.tag === 'gate' && ny > 0.8) || (s.p.z > 30 && Math.abs(s.p.x + 2) < 16) || !seen(i)) continue; const cd = camDist(s.p); if (cd < 18 || cd > 235) continue;
        const w = (0.30 + 0.70 * sm(0.25, 0.7, ny)) * (0.55 + 0.45 * sm(0.0, 0.1, cav[i])) * (sp ? 1.7 : 1.0) * (0.4 + 0.6 * moist(s.p)) / Math.max(cav.den[i], 0.08);
        cand.push({ s, k: Math.pow(rp(), 1 / Math.max(w, 1e-3)) }); }
      cand.sort((a, b) => b.k - a.k); const up = [[], []], hang = [[], []], NX = +(Q.get('pinex') ?? 300); let n = 0;
      for (const c of cand) { if (n >= NX) break; const s = c.s; if (!free(s.p, 3.4)) continue; put(s.p); const flat = s.n.y > 0.6, e = { site: s, p: s.p, yaw: flat ? rp() * TAU : Math.atan2(s.n.x, s.n.z), s: (flat ? 0.50 : 0.62) + rp() * 0.5, tree: [0.30 + 0.40 * rp(), 0.55, 0.85 + 0.35 * rp(), rp()], late: 1 }; (flat ? up : hang)[n & 1].push(e); n++; }
      for (let i = 0; i < 2; i++) { for (const e of up[i]) pineL[i].push(e); for (const e of hang[i]) pineL[2 + i].push(e); }
      G.info.pinesX = [up[0].length + up[1].length, hang[0].length + hang[1].length]; }
    for (let i = 0; i < 4; i++) cleared(addTree(pinesV[i], pineL[i], barkP, mats.pine, 0, 'pine' + i), k => k.late ? pinesV[i].Rc * 0.7 * k.s : -1, pinesV[i].cc);      // (only the late ones are tested against the rails: the first planting keeps its trees)
    lap('pines'); prog(0.62); await tick(); tl = performance.now();
    // --- shrubs: green, crimson, orange, gold. Near the crane's path they get twice the sprays
    const bS = pick(s => inView(s) && !nearCam(s) && s.n.y > 0.45 && s.p.y > 0.8, 2600, 1.5, 5);
    // (the old colour draw, kept for the random stream: class 0 green, 1 crimson, 2 orange, 3 was pink and is gold now)
    const bcol = () => { const q = r(); if (q < 0.72) { r(); r(); } else if (q < 0.9) r(); return q < 0.42 ? 0 : q < 0.72 ? 1 : q < 0.9 ? 2 : 3; };
    const hueB = c => c === 0 ? 0.02 + 0.44 * rh() : c === 1 ? 0.56 + 0.07 * rh() : c === 2 ? 0.70 + 0.10 * rh() : 0.86 + 0.10 * rh();
    const bush = (geoSeed, n, cells, all, name, cast = true, K = 1) => { if (!all.length) return; const geo = shrub(geoSeed, n, cells);
      for (const list of split(all, K)) { const wk = Wake.plants(list.length, { name, centre: (i, out) => out.copy(list[i].p).setY(list[i].p.y + 0.5 * list[i].s), R: i => 0.6 * list[i].s, tear: 0, hue: i => 0.3 }); inst(scene, geo, mats.bush, list, { wake: wk, thin: true, cast, name, reach: 6, shRange: six(n * 0.5) }); } };
    const bAll = [[], []], bNear = [], bFar = []; bS.forEach((s, k) => bAll[k % 2].push(s));
    bAll.forEach((ss, i) => { const list = ss.map(s => ({ p: s.p, yaw: r() * TAU, s: 0.7 + r() * 1.3, sy: 0.7 + r() * 0.4, c: bcol() })).map(k => (k.tree = [hueB(k.c), 0.22, 0.9 + 0.3 * rh(), rh()], k));
      for (const k of list) (camDist(k.p) < 62 ? bNear : bFar).push(k); });
    bush(31, 44, [CELL[0], CELL[1]], bNear, 'shrubN'); bush(41, 18, [CELL[0], CELL[1]], bFar, 'shrubF', false);
    // cliff-face tufts so the walls are never bare
    const tS = pick(s => inView(s) && s.n.y > -0.2 && s.n.y <= 0.45 && s.p.y > 3, 1500, 2.2, 6);
    { const list = tS.map(s => { const k = { p: s.p.clone().addScaledVector(s.n, 0.2), yaw: r() * TAU, s: 0.6 + r() * 0.9 }, g = r() < 0.7; if (g) r(); k.tree = [g ? 0.03 + 0.38 * rh() : 0.56 + 0.2 * rh(), 0.22, 0.85 + 0.3 * rh(), rh()];
        k.s *= 0.45 + 0.75 * Math.max(sm(0.03, 0.16, cavOf.get(s)), 0.4 * moist(s.p)) * (0.35 + 0.65 * moist(s.p)); k.nrm = V().copy(s.n).multiplyScalar(0.8).add(YAX).normalize(); return k; }); bush(51, 16, [CELL[0], CELL[1]], list, 'tuft', false); }
    // --- the cliffs' own cover: what a karst face carries wherever water and a foothold meet. Shrubs 1.5 to 3 m across on every
    // shelf, shoulder and crack (dark green, some rust and gold); mats of grass and fern that root on a ledge and spill over its
    // lip; creepers hanging down the wet streaks as chains of curtains, each lying on the rock where it hangs; tufts and cushions
    // near the lens only. A face that overhangs or sheds its water stays bare. It grows on the side of the rock the lens can see,
    // by AREA (plants per square metre, whatever the mesh's own density of sites), and anything in a loong's way is taken out
    // when the rails are known (Wake.clear).
    { const rc = rng(4242), tufts = [], cush = [], shN = [], shF = [], spl = [], cur = [], S = Rock.sites, fl = Math.floor, LAM = +(Q.get('cover') ?? 0.30);
      const g3 = new Map(), k3 = (i, j, k) => ((i + 256) * 512 + (j + 256)) * 512 + (k + 256); for (let i = 0; i < S.length; i++) { const p = S[i].p, k = k3(fl(p.x / 2), fl(p.y / 2), fl(p.z / 2)); let l = g3.get(k); if (!l) g3.set(k, l = []); l.push(i); }
      // the face just below a point: the nearest site about dy lower (a curtain's next length hangs from it)
      const below = (p, dy) => { const tx = p.x, ty = p.y - dy, tz = p.z, ix = fl(tx / 2), iy = fl(ty / 2), iz = fl(tz / 2); let bi = -1, bd = 2.6;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const l = g3.get(k3(ix + a, iy + b, iz + c)); if (!l) continue; for (let q = 0; q < l.length; q++) { const o = S[l[q]]; if (o.n.y > 0.72 || o.n.y < -0.3) continue; const d2 = (o.p.x - tx) * (o.p.x - tx) + (o.p.y - ty) * (o.p.y - ty) + (o.p.z - tz) * (o.p.z - tz); if (d2 < bd) { bd = d2; bi = l[q]; } } }
        return bi; };
      const hueC = () => { const q = rc(); return q < 0.68 ? 0.02 + 0.30 * rc() : q < 0.82 ? 0.55 + 0.08 * rc() : q < 0.92 ? 0.70 + 0.10 * rc() : 0.86 + 0.10 * rc(); };
      const mB = new THREE.Matrix4(), ex = V(), ey = V(), ez = V();
      // the frame of a face: +y up the slope, +z out of the rock
      const faceQ = (n, twist) => { ez.copy(n); if (ez.y < 0) { ez.y = 0; } if (ez.y > 0.85) ez.set(Math.cos(twist * 9), 0.85, Math.sin(twist * 9)); ez.normalize(); ey.set(0, 1, 0).addScaledVector(ez, -ez.y).normalize(); ex.crossVectors(ey, ez); ey.addScaledVector(ex, twist).normalize(); ex.crossVectors(ey, ez).normalize(); ez.crossVectors(ex, ey); return new THREE.Quaternion().setFromRotationMatrix(mB.makeBasis(ex, ey, ez)); };
      for (let i = 0; i < S.length; i++) { const s = S[i], p = s.p, ny = s.n.y, tag = s.tag; if (p.y < 1.6 || !inView(s) || p.z < -135 || tag === 'bank' || tag === 'pad') continue;
        const cd = camDist(p); if (cd < 7) continue;
        const cv = cav[i], wet = moist(p), steep = ny < 0.5, gully = sm(0.025, 0.12, cv), lip = ny > 0.15 && ny < 0.85 && cv < -0.05;
        t1.set(1, 0, 0).addScaledVector(s.n, -s.n.x).normalize(); t2.crossVectors(s.n, t1);
        // (the cover itself)
        if (p.y < 2.4 || ny < -0.12 || cd < 10 || tag === 'isle' || tag === 'root' || (flatTags.has(tag) && ny > 0.8) || !seen(i)) continue;
        const shelf = sm(0.42, 0.72, ny), Cq = (0.22 + 0.78 * wet) * Math.max(0.95 * shelf, 0.85 * gully, lip ? 0.75 : 0, 0.06 + 0.34 * wet * wet);
        const tk = tag === 'wallL' || tag === 'wallR' || tag === 'gate' ? 1.25 : 1.0, want = Cq * tk * LAM / Math.max(cav.den[i], 0.06), cnt = Math.min(4, fl(want + rc())), jr = Math.min(1.5, 0.45 / Math.sqrt(Math.max(cav.den[i], 0.06)));
        const oh = Math.hypot(cav.out[i * 2], cav.out[i * 2 + 1]), oy = oh > 0.15 ? Math.atan2(cav.out[i * 2], cav.out[i * 2 + 1]) : Math.atan2(s.n.x, s.n.z);
        for (let k = 0; k < cnt; k++) { const a = rc() * TAU, d = k ? jr * (0.5 + 0.5 * rc()) : jr * 0.4 * rc(), q = rc(), pos = V().copy(p).addScaledVector(t1, Math.cos(a) * d).addScaledVector(t2, Math.sin(a) * d), big = 0.85 + 0.3 * sm(60, 170, cd);
          const kind = !steep ? (lip && q < 0.45 ? 1 : q < 0.80 ? 0 : 1) : gully > 0.3 ? (q < 0.52 ? 0 : q < 0.78 ? 2 : 1) : (q < 0.46 ? 0 : q < 0.76 ? 2 : 1);
          if (kind === 0) (cd < 85 ? shN : shF).push({ p: pos.addScaledVector(s.n, steep ? 0.22 : -0.06), yaw: rc() * TAU, s: (0.72 + 0.78 * rc() * (0.5 + 0.5 * wet)) * big, sy: 0.72 + 0.3 * rc(), nrm: V().copy(s.n).multiplyScalar(steep ? 0.85 : 1).add(YAX).normalize(), tree: [hueC(), 0.24, 0.85 + 0.35 * rc(), rc()] });
          else if (kind === 1) spl.push({ p: pos.addScaledVector(s.n, steep ? 0.12 : 0.0), yaw: oy + (rc() - .5) * 0.7, s: (0.85 + 0.75 * rc()) * big, nrm: V().copy(s.n).addScaledVector(YAX, steep ? 1.1 : 2.5).normalize(), tree: [rc() < 0.75 ? 0.04 + 0.34 * rc() : 0.70 + 0.22 * rc(), 0.26, 0.9 + 0.35 * rc(), rc()] });
          else { const hq = rc(), hue = hq < 0.72 ? 0.03 + 0.30 * rc() : hq < 0.90 ? 0.52 + 0.06 * rc() : 0.74 + 0.16 * rc(), br = (hq < 0.72 ? 0.9 : hq < 0.9 ? 0.62 : 0.85) + 0.3 * rc(), nP = 1 + (rc() < 0.3 + 0.5 * wet ? 1 : 0) + (rc() < 0.5 * wet ? 1 : 0); let at = s, ap = pos;
            for (let j = 0; j < nP; j++) { const len = 2.3 + 1.5 * rc(), w = (1.5 + 0.9 * rc()) * big; cur.push({ p: V().copy(ap).addScaledVector(at.n, 0.10), q: faceQ(at.n, (rc() - .5) * 0.24), s: w, sy: len / w, tree: [hue + (rc() - .5) * 0.06, 0.26, br, rc()] });
              const nx = below(ap, len * 0.78); if (nx < 0) break; at = S[nx]; ap = at.p; } } } }
      shuffle(shN, rc); shuffle(shF, rc); shuffle(spl, rc); shuffle(cur, rc);
      const cap = (l, n) => { if (l.length > n) l.length = n; return l; };
      const lay = (name, geo, mat, all, K, R, cast) => { for (const list of split(all, K)) cleared([{ list, meshes: [inst(scene, geo, mat, list, { cast, thin: true, name })] }], k => R * (k.s || 1)); };
      lay('cshrub', shrub(93, 24, [CELL[0], CELL[1]]), mats.bushL, cap(shN, 2200), 1, 1.0, false);
      lay('cshrubF', shrub(94, 10, [CELL[0], CELL[1]], { shells: [1.0, 1.0, 0.74], big: 1.45 }), mats.bushL, cap(shF, 2600), 1, 1.0, false);
      lay('cspill', spill(95), mats.cliffL, cap(spl, 2400), 1, 1.2, false);
      lay('ccurtain', curtain(96), mats.cliffL, cap(cur, 3200), 1, 0.6, false);
      G.info.cliff = { shrubs: [shN.length, shF.length], spills: spl.length, curtains: cur.length }; }
    lap('shrubs'); prog(0.74); await tick(); tl = performance.now();
    // --- ferns and small plants where rock meets soil (new; they stand clear of the crane)
    const fS = pick(s => { if (!(inView(s) && s.n.y > 0.30 && s.n.y < 0.86 && s.p.y > 0.6 && s.p.z > -30 && s.r < 0.4)) return false; const d = camDist(s.p); return d < 80 && d > 5; }, 620, 1.4, 71);
    { const list = fS.map(s => ({ p: s.p, yaw: rh() * TAU, s: 0.55 + 0.5 * rh(), nrm: V().copy(s.n).add(YAX).normalize(), tree: [0.10 + 0.26 * rh(), 0.25, 1.0 + 0.3 * rh(), rh()] }));
      const fg = fern(77); for (const l of split(list, 1)) { const wk = Wake.plants(l.length, { name: 'fern', centre: (i, out) => out.copy(l[i].p), R: 0.4 }); inst(scene, fg, mats.bush, l, { wake: wk, cast: false, thin: true, reach: 5 }); } }
    // --- grass in fine clumps on the banks and terraces; red spider lilies among it
    const keep = G.keepOut || [], clear = p => { for (const k of keep) if (Math.hypot(p.x - k.x, p.z - k.z) < k.r - 1.5 && p.y > k.y0 && p.y < k.y1) return false; return true; };
    const gS = Rock.sites.filter(s => s.n.y > 0.55 && (s.tag === 'bank' || s.tag === 'isle' || s.tag === 'root' || (s.tag === 'terR' && s.p.z > -5))), gX = Rock.sites.filter(s => s.n.y > 0.8 && (s.tag === 'ledgeL' || s.tag === 'gate' || (s.tag === 'terR' && s.p.z <= -5)) && s.p.z > -40 && clear(s.p) && s.r < 0.5), gl = [];
    const glF = [];
    const glM = [];
    for (const s of gS.concat(gX)) { const cd = camDist(s.p); if (cd < 2.6) continue; const near = cd < 32, nC = near ? 9 : cd < 60 ? 4 : 2, nrm = V().copy(s.n).add(YAX).normalize();
      t1.set(1, 0, 0).addScaledVector(s.n, -s.n.x).normalize(); t2.crossVectors(s.n, t1);
      for (let k = 0; k < nC; k++) { const a = rh() * TAU, d = k ? 0.62 * Math.sqrt(rh()) : 0, g = rh(), sc = (0.6 + 0.55 * rh()) * (0.5 + 0.5 * sm(2.6, 7.5, cd));
        (cd < 11.5 ? gl : near ? glM : glF).push({ p: V().copy(s.p).addScaledVector(t1, Math.cos(a) * d).addScaledVector(t2, Math.sin(a) * d).addScaledVector(s.n, -0.04), nrm, yaw: rh() * TAU, s: sc, col: g < 0.75 ? [0.8 + 0.5 * rh(), 0.8 + 0.5 * rh(), 0.8] : [1.5, 1.05, 0.7] }); } }
    shuffle(gl, rh); shuffle(glF, rh); shuffle(glM, rh);
    { const sets = [[gl, clump(61, 12, { w: 1.1 })], [[], null], [glM, clump(64, 11, { far: true, w: 0.85 })], [glF, clump(63, 12, { far: true })]];
      sets.forEach(([all, geo], i) => { if (all.length) for (const list of split(all, 1)) { if (i === 3) { inst(scene, geo, mats.grassL, list, { cast: false, thin: true, reach: 5 }); continue; }      // (the far grass answers the valley's wind only)
        const wk = Wake.plants(list.length, { name: 'grass' + i, centre: (j, out) => out.copy(list[j].p), R: 0.3 }); inst(scene, geo, mats.grass, list, { cast: false, wake: wk, thin: true, reach: 5 }); } }); }
    G.info.grass = gl.length * 12 + glM.length * 11 + glF.length * 12; G.info.grassTiers = [gl.length, glM.length, glF.length];
    // reeds stand in the shallows, well away from the crane: they are what a low pass over the lake lays flat
    { const rS = pick(s => s.p.y > 0.08 && s.p.y < 1.1 && s.n.y > 0.25 && inView(s) && s.p.z > -12 && camDist(s.p) > 13, 420, 1.3, 81), list = [];
      for (const s of rS) for (let k = 0; k < 3; k++) { const a = rh() * TAU, d = k ? 0.25 + 0.5 * rh() : 0; list.push({ p: V(s.p.x + Math.cos(a) * d, s.p.y - 0.12, s.p.z + Math.sin(a) * d), yaw: rh() * TAU, s: 0.75 + 0.5 * rh(), col: rh() < 0.6 ? [1.0, 1.0, 0.8] : [1.5, 1.1, 0.7] }); }
      shuffle(list, rh); const rg = clump(67, 9, { h0: 0.9, h1: 0.9, lean: 0.45, w: 1.5, dry: 0.45 });
      for (const l of split(list, 1)) { const wk = Wake.plants(l.length, { name: 'reed', centre: (j, out) => out.copy(l[j].p).setY(l[j].p.y + 0.8), R: 0.5 }); inst(scene, rg, mats.grass, l, { cast: false, wake: wk, thin: true, reach: 6 }); } G.info.reeds = list.length; }
    { const lv = sprayGeo([0, 1, 2].map(k => { const a = k * Math.PI / 2, n = k < 2 ? V(Math.cos(a + 1.57), 0.25, Math.sin(a + 1.57)).normalize() : V(0, 1, 0), ax = k < 2 ? V(0, 1, 0) : V(1, 0, 0); ax.addScaledVector(n, -ax.dot(n)).normalize();
        return { b: k < 2 ? V(0, 0.36, 0) : V(-0.09, 0.455, 0), ax, n, L: 0.19, W: 0.19, dr: 0, cell: [0.1, 0.1, 0.9, 0.9], ao: 1.15, hu: 0, br: 1, sn: V(0, 1, 0), wb: [0.6, 1.0], fl: 0.6, ph: 0.3, seg: 1, taper: 0 }; })
        .concat([{ b: V(0, 0, 0), ax: V(0, 1, 0), n: V(0, 0, 1), L: 0.44, W: 0.014, dr: 0, cell: [0.01, 0.01, 0.06, 0.06], ao: 1, hu: 0, br: 1, sn: V(0, 0.8, 0.6).normalize(), wb: [0, 0.6], fl: 0, ph: 0, seg: 1, taper: 0 }, { b: V(0, 0, 0), ax: V(0, 1, 0), n: V(1, 0, 0), L: 0.44, W: 0.014, dr: 0, cell: [0.01, 0.01, 0.06, 0.06], ao: 1, hu: 0, br: 1, sn: V(0.6, 0.8, 0).normalize(), wb: [0, 0.6], fl: 0, ph: 0, seg: 1, taper: 0 }]));
      const lS = shuffle(gS.filter(s => r() < 0.33 && camDist(s.p) > 6).map(s => ({ p: new THREE.Vector3(s.p.x, s.p.y - 0.04, s.p.z), yaw: r() * TAU, s: 0.7 + r() * 0.7 })), rh);
      for (const l of split(lS, 1)) { const wk = Wake.plants(l.length, { name: 'lily', centre: (j, out) => out.copy(l[j].p), R: 0.3 }); inst(scene, lv, mats.lily, l, { cast: false, wake: wk, tree: false, thin: true, reach: 5 }); } }
    lap('ground'); prog(0.86); await tick(); tl = performance.now();
    // --- hero maple over the right of frame, and its neighbour framing the left
    const hero = maple(99, { h: 12, spread: 1.1, leaf: 1.0, dens: 1.7, rad: 0.58, lean: [-0.20, 0.04], keep: 0.36, seg: 1, margin: 0.25 });
    addTree(hero, [{ p: V(30.5, 3.0, 45), yaw: 0.5, s: 1.05, tree: [0.36, 0.52, 1.05, 0.3] }], barkM, mats.maple, 2.2, 'hero');
    const h2 = maple(98, { h: 9, spread: 1.3, leaf: 1.0, dens: 2.0, rad: 0.4, lean: [0.5, 0.1], keep: 0.38, seg: 1, margin: 0.25 });
    addTree(h2, [{ p: V(-27.5, 4.6, 46), yaw: 2.1, s: 1, tree: [0.50, 0.52, 1.05, 0.7] }], barkM, mats.maple, 1.8, 'hero2');
    lap('hero');
    // --- what lies under the trees: fallen leaves below every maple and drifted against the foot of rocks; a dark foot at every trunk
    { const cell = 8, grid = new Map(), key = (i, k) => (i + 512) * 2048 + (k + 512), fl = Math.floor; for (const t of treeAt) { const kk = key(fl(t.p.x / cell), fl(t.p.z / cell)); let l = grid.get(kk); if (!l) grid.set(kk, l = []); l.push(t); }
      const lit = [], quad = sprayGeo([{ b: V(-0.5, 0, 0), ax: V(1, 0, 0), n: V(0, 1, 0), L: 1, W: 1, dr: 0, cell: CELL[3], ao: 1, hu: 0, br: 1, sn: V(0, 1, 0), wb: [0, 0], fl: 0, ph: 0, seg: 1, taper: 0 }]);
      const sg = new Map(), sc = 1.6; let nDrift = 0; for (const s of Rock.sites) if (s.n.y < 0.4) { const kk = key(fl(s.p.x / sc), fl(s.p.z / sc)); let l = sg.get(kk); if (!l) sg.set(kk, l = []); l.push(s.p.y); }
      const foot = s => { const ix = fl(s.p.x / sc), iz = fl(s.p.z / sc); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = sg.get(key(ix + a, iz + b)); if (l) for (const y of l) if (y > s.p.y + 0.2 && y < s.p.y + 2.4) return true; } return false; };
      for (const s of Rock.sites) { if (s.n.y < 0.55 || s.p.y < 0.4 || !inView(s)) continue; let best = null, bd = 1e9; const ix = fl(s.p.x / cell), iz = fl(s.p.z / cell);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = grid.get(key(ix + a, iz + b)); if (!l) continue; for (const t of l) { const dy = t.p.y - s.p.y; if (dy < -1.5 || dy > 14) continue; const d = Math.hypot(t.p.x - s.p.x, t.p.z - s.p.z) / (t.R * 1.25 + dy * 0.25); if (d < bd) { bd = d; best = t; } } }
        if (!best) continue; const under = bd <= 1 && s.r <= 1.05 - 0.75 * bd * bd, drift = !under && bd <= 2.8 && s.r < 0.85 && foot(s);            // under the crown, or blown against the foot of a step nearby
        if (!(under || drift) || camDist(s.p) < 3) continue; if (drift) nDrift++;
        lit.push({ p: V().copy(s.p).addScaledVector(s.n, 0.045), nrm: s.n, yaw: s.r * 50, s: drift ? 0.8 + 0.6 * rh() : 1.0 + 0.9 * rh(), tree: [best.hue - 0.06 + 0.1 * rh() - (drift ? 0.06 : 0), 0.42, (drift ? 0.52 : 0.62) + 0.25 * rh(), 0] }); }
      for (const l of split(lit, 1)) inst(scene, quad, mats.maple, l, { cast: false, reach: 4 }); G.info.litter = lit.length; G.info.drift = nDrift; }
    { const q = new THREE.PlaneGeometry(1, 1); q.rotateX(-Math.PI / 2); inst(scene, q, mats.blob, blobs, { cast: false, tree: false }).renderOrder = 4; }
    G.info.heroLeaves = hero.n; G.info.sites = Rock.sites.length; G.info.maples = mSites.length; G.info.pines = upS.length + clS.length; G.info.shrubs = bS.length + tS.length;
    G.info.flora = { sprayM: maples.map(v => v.n), sprayP: pinesV.map(v => v.n), hero: [hero.n, h2.n], fitMaple: +fit.maple.toFixed(3), fitPine: +fit.pine.toFixed(3), shrunk: fit.shrunk, dropped: fit.dropped, ferns: fS.length, clumps: gl.length, groups: nGroups };
    lap('litter'); G.info.flora.ms = tm;
    where.maple = mSites.slice(0, 84).map(s => s.p); where.pine = upS.map(s => s.p); where.cliff = clS.map(s => s.p); where.shrub = bS.map(s => s.p); where.grass = gS.map(s => s.p);
    G.tick.push(Wake.boot);                 // until 90_main.js calls Wake.build after Dragon.build, the first frame does
    prog(1);
  }
  const where = {};
  return { build, T, mats, fit, where, PAL, get barkMat() { return barkM; } };
})();
