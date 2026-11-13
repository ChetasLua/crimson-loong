'use strict';
// ---- score + foley: every sample is computed here ------------------------------------------------------
// Red loong: erhu, dizi, guzheng, taiko, gong in G minor pentatonic. White loong: bowed glass, xiao and bells
// on a four-note motif (B F# E D, the bright side of G). Thunder, two dragon voices, fire, frost, impacts.
// synth() is self-contained so it can run inside a Worker; P carries the film's own timeline constants,
// and every hit below is placed from P.T (the frozen beat sheet), on the 80 bpm grid.
function synth(P) {
  const SR = P.SR, DUR = P.DUR, N = Math.floor(SR * DUR), T = P.T, TAU = Math.PI * 2;
  const L = new Float32Array(N), R = new Float32Array(N), S = new Float32Array(N), S2 = new Float32Array(N), SW = 0.8;      // dry left, dry right, reverb send, and which side of the room that send enters from (+ right): a voice on the left echoes on the left first
  const prof = {}; let pt = Date.now(); const lap = k => { const n = Date.now(); prof[k] = (prof[k] || 0) + n - pt; pt = n; };
  let seed = 12345; const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let ns = 9781; const nz = () => { ns = (Math.imul(ns, 1664525) + 1013904223) | 0; return ns * 4.656612873077393e-10; };   // fast white noise
  const hz = m => 440 * Math.pow(2, (m - 69) / 12), clamp = (x, a, b) => x < a ? a : x > b ? b : x, sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const win = (t, a, b, at, rl) => sm(a, a + at, t) * (1 - sm(b - rl, b, t)), pulse = (t, t0, at, rl) => t < t0 ? 0 : t < t0 + at ? sm(t0, t0 + at, t) : Math.exp(-(t - t0 - at) / rl);
  const gustAt = t => { const x = clamp(t, 0, DUR) * 20, i = Math.min(P.gust.length - 2, x | 0); return P.gust[i] + (P.gust[i + 1] - P.gust[i]) * (x - i); };
  const ix = t => Math.round(t * SR);
  function saw(ph, dt) { let v = 2 * ph - 1; if (ph < dt) { const t = ph / dt; v -= t + t - t * t - 1; } else if (ph > 1 - dt) { const t = (ph - 1) / dt; v -= t * t + t + t + 1; } return v; }
  function bq(type, f, q) { const w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q), a0 = 1 + al; let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; } else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; } else { b0 = al; b1 = 0; b2 = -al; }
    if (type === 'hs') { const A = Math.pow(10, q / 40), be = s / 2 * Math.sqrt((A + 1 / A) * (1 / 0.8 - 1) + 2) * 2 * Math.sqrt(A), d0 = (A + 1) - (A - 1) * c + be;        // high shelf: q is the gain in dB
      return mk(A * ((A + 1) + (A - 1) * c + be) / d0, -2 * A * ((A - 1) + (A + 1) * c) / d0, A * ((A + 1) + (A - 1) * c - be) / d0, 2 * ((A - 1) - (A + 1) * c) / d0, ((A + 1) - (A - 1) * c - be) / d0); }
    return mk(b0 / a0, b1 / a0, b2 / a0, -2 * c / a0, (1 - al) / a0); }
  function mk(b0, b1, b2, a1, a2) { const o = { b0, b1, b2, a1, a2, x1: 0, x2: 0, y1: 0, y2: 0 };
    o.p = x => { const y = o.b0 * x + o.b1 * o.x1 + o.b2 * o.x2 - o.a1 * o.y1 - o.a2 * o.y2; o.x2 = o.x1; o.x1 = x; o.y2 = o.y1; o.y1 = y; return y; }; return o; }
  function svf() { const o = { a: 0, b: 0, lp: 0, bp: 0, hp: 0, g: 0, k: 1, f: -1 }; o.p = (x, f, q) => { if (f !== o.f) { o.g = Math.tan(Math.PI * Math.min(f, SR * 0.45) / SR); o.f = f; } const g = o.g, k = 1 / q, a1 = 1 / (1 + g * (g + k)), v3 = x - o.b, v1 = a1 * o.a + g * a1 * v3, v2 = o.b + g * a1 * o.a + g * g * a1 * v3; o.a = 2 * v1 - o.a; o.b = 2 * v2 - o.b; o.lp = v2; o.bp = v1; o.hp = x - k * v1 - v2; return v2; }; return o; }
  // a sound rendered once into a small buffer, then mixed wherever it is struck
  const memo = new Map(), cached = (k, make) => { let b = memo.get(k); if (b === undefined) { b = make(); memo.set(k, b); } return b; };
  function add(buf, t, g, pan, send) { const i0 = ix(t), gl = g * (1 - pan) * 1.2, gr = g * pan * 1.2, gs = g * send; let n = buf.length; if (i0 + n > N) n = N - i0; for (let i = i0 < 0 ? -i0 : 0; i < n; i++) { const v = buf[i], j = i0 + i; L[j] += v * gl; R[j] += v * gr; S[j] += v * gs; } }

  // the beat sheet
  const tE = T.EMERGE, tD = T.DRUMS, tC = T.CHARGE, R0 = T.ROAR, R1 = T.ROAR_END, tO = T.OMEN, tDe = T.DESCENT, tF = T.FACEOFF, W0 = T.WROAR, W1 = T.WROAR_END, tC1 = T.CLASH1, tFi = T.FIRE2, tBo = T.BOLT, tC2 = T.CLASH2, tS = T.SPLASH, tBe = T.BEAM, tBl = T.BLAST, tFn = T.FINALE, tG = T.GONG, tOut = T.OUT;
  const STR_DEF = [0.45, 1.2, 1.65, 2.55].map(d => tO + d), STR_IN = P.STRIKES ? Array.from(P.STRIKES).filter(s => s === +s && s > 0 && s < DUR).sort((a, b) => a - b) : [];
  const STR = STR_IN.length ? STR_IN : STR_DEF;                    // lightning strikes: the film's own list (any number, any spacing), else the four default ones
  const CUT = tBl - 0.12, END = Math.min(DUR - 2, tOut + 1.4);     // everything stops at CUT so the blast lands in silence; END = silence for the loop
  const B = 0.75, q = B / 4;                                       // one beat at 80 bpm, one sixteenth
  // the picture, as the page read it at load (P.pic, see Score.picture): where each head is on screen, when the lake and the cloud give the
  // two up. Every voice is panned from it. Without it (no dragons on the page): the film's usual staging, red on the left, white on the right.
  const PIC = P.pic || {}, HX = PIC.hx && PIC.hx.r && PIC.hx.w ? PIC.hx : null, AX = PIC.ax || {};
  const hxAt = (a, t) => { const x = clamp(t, 0, DUR) * (HX.hz || 20), i = Math.min(a.length - 2, x | 0); return a[i] + (a[i + 1] - a[i]) * (x - i); };
  const scrR = t => HX ? hxAt(HX.r, t) : t < tDe ? 0 : -0.3, scrW = t => HX ? hxAt(HX.w, t) : 0.3;        // screen x of each head: -1 left edge .. +1 right edge
  const panX = (x, side = 0) => clamp(0.5 + PANW * (x === x ? x : 0) + 0.05 * side, 0.12, 0.88), duo = t => sm(tDe - 1, tDe + 1, t), panR = t => panX(scrR(t), -duo(t)), panW = t => panX(scrW(t), 1);      // screen x to pan; once there are two, each leans a little to its own side
  const PANW = 0.62, axis = (k, d) => AX[k] === +AX[k] ? AX[k] : d;
  // what else the picture does (P.pic.ev, see Score.world): the leap, the lake, the fronts, the crowns, the birds. Without it (or with stem 'old') the film sounds as it did before
  const EV = P.stem === 'old' ? null : PIC.ev || null, EHz = EV && EV.hz || 50;
  const tab = (a, hz, t) => { if (!a) return 0; const x = t * hz; if (!(x > 0)) return a[0]; const i = x | 0; return i >= a.length - 1 ? a[a.length - 1] : a[i] + (a[i + 1] - a[i]) * (x - i); };
  const tLeap = EV && EV.tLeap > 0 ? EV.tLeap : -9, LAPS = []; if (EV && EV.laps) for (let j = 0; j + 5 < EV.laps.length; j += 6) LAPS.push(Array.from(EV.laps.subarray(j, j + 6)));
  let ssNew = 0; const LAP0 = LAPS.find(l => !l[5]), tHit = LAP0 ? LAP0[0] : -9;      // the red loong throws itself off the rock; its body goes into the lake

  // ================= instruments =================
  // bowed / blown lead with slurs, scoops and delayed vibrato. notes: [t, dur, midi, vel]
  function lead(notes, o) {
    const erhu = o.kind === 'erhu', xiao = o.kind === 'xiao', tr = o.tr === undefined ? -12 : o.tr, pont = o.pont || 0, vib = o.vib === undefined ? 1 : o.vib;
    notes = notes.map(n => [n[0], n[1], n[2] + tr, n[3]]);
    const last = notes[notes.length - 1], i0 = Math.max(0, ix(notes[0][0] - 0.03)), i1 = Math.min(N, ix(last[0] + last[1] + 0.6));
    const f1 = bq('bp', 470, 1.6), f2 = bq('bp', 1100, 3.0), f3 = bq('bp', 2400, 4.0), f4 = bq('bp', 3400, 3.0), lp = bq('lp', erhu ? 2300 : xiao ? 3800 : 7000, 0.7), bn = bq('bp', erhu ? 2100 : 2600, 1.2), air = bq('hp', 4500, 0.7), hp = bq('hp', erhu ? 180 : 300, 0.7), bz = bq('bp', 3100, 1.3), br = svf();
    const kg = erhu ? 0.00042 : xiao ? 0.0006 : 0.0009, kat = erhu ? 0.00045 : xiao ? 0.0003 : 0.0011, krl = xiao ? 0.0001 : 0.00016, vdep = erhu ? 0.0115 : xiao ? 0.004 : 0.006;
    const gl = o.gain * (1 - o.pan) * 1.2, gr = o.gain * o.pan * 1.2, gs = o.gain * o.send;
    let k = 0, lf = notes[0][2] - (erhu ? 1.6 : 0.4), a = 0, ph = 0, vph = rnd() * TAU, tin = 0, drift = 0, bf = 500;
    for (let i = i0; i < i1; i++) {
      const t = i / SR; while (k < notes.length - 1 && t >= notes[k + 1][0]) { const gap = notes[k + 1][0] - (notes[k][0] + notes[k][1]); k++; tin = 0; if (gap > 0.12) lf = notes[k][2] - (erhu ? 1.3 : 0.5); }
      const n = notes[k], gate = t >= n[0] && t < n[0] + n[1]; tin += 1 / SR;
      lf += (n[2] - lf) * kg; a += ((gate ? n[3] : 0) - a) * (gate ? kat : krl); drift += (nz() * 0.5 - drift) * 0.0004;
      const vd = vdep * vib * sm(0.16, 0.6, tin) * (0.6 + 0.4 * n[3]); vph += TAU * (5.4 + 0.5 * Math.sin(t * 0.9)) / SR;
      const sv = Math.sin(vph), f = 440 * Math.pow(2, (lf - 69) / 12) * (1 + vd * sv + drift * 0.004), dt = f / SR; ph += dt; if (ph >= 1) ph -= 1;
      const nn = nz(); let y;
      if (erhu) { const s = saw(ph, dt) * 0.7 + saw((ph * 2) % 1, dt * 2) * 0.18 + bn.p(nn) * 0.11 * (0.4 + a), sw = 1 + 0.12 * sv;       // snakeskin box: nasal formants, rosin on top
        y = (f1.p(s) + f2.p(s) * 0.52 * sw + f3.p(s) * (0.22 + 0.35 * pont) + f4.p(s) * (0.13 + 0.3 * pont) + lp.p(s) * (0.5 - 0.25 * pont)) * a * (1 + 0.05 * Math.sin(vph * 0.5)) + air.p(nn) * 0.035 * a; }
      else if (xiao) { if ((i & 15) === 0) bf = f; br.p(nn, bf, 7); const w = TAU * ph;                                                // end-blown flute: mostly breath round a soft tone
        y = lp.p((Math.sin(w) + 0.16 * Math.sin(2 * w) + 0.05 * Math.sin(3 * w)) * a * 0.5 + br.bp * 0.55 * a + air.p(nn) * 0.02 * a + bn.p(nn) * 0.2 * a * Math.exp(-tin * 14)); }
      else { const w = TAU * ph;                                                                                                       // dizi: bright, with the buzz of its reed membrane
        y = lp.p((Math.sin(w) + 0.30 * Math.sin(2 * w) + 0.10 * Math.sin(3 * w) + 0.04 * Math.sin(5 * w)) * a * 0.55 + bz.p(saw(ph, dt)) * 0.20 * a * a + bn.p(nn) * (0.05 * a + 0.25 * a * Math.exp(-tin * 30))); }
      y = hp.p(y); L[i] += y * gl; R[i] += y * gr; S[i] += y * gs;
    }
  }
  // bowed glass: near-pure partials in the ratios of a glass bowl, slow bloom, a breath of friction
  function glass(t, dur, m, vel, pan = 0.66, send = 0.6) {
    const f = hz(m), i0 = ix(t), len = Math.floor((dur + 1.6) * SR), nG = Math.floor(dur * SR), fr = bq('bp', Math.min(9000, f * 4.25), 2.5);
    const pt = [[1, 1], [1.0013, 0.75], [2.32, 0.10], [4.25, 0.03]].map(p => { const w = TAU * f * p[0] / SR, a0 = rnd() * TAU; return [Math.cos(w), Math.sin(w), Math.cos(a0), Math.sin(a0), p[1]]; });
    const g = vel * 0.15, gl = g * (1 - pan) * 1.2, gr = g * pan * 1.2, gs = g * send; let a = 0;
    for (let i = 0, j = i0; i < len && j < N; i++, j++) { a += ((i < nG ? 1 : 0) - a) * (i < nG ? 0.00018 : 0.00006); let y = 0;
      for (let k = 0; k < 4; k++) { const p = pt[k], x = p[2] * p[0] - p[3] * p[1]; p[3] = p[2] * p[1] + p[3] * p[0]; p[2] = x; y += p[3] * p[4]; }
      y = (y + fr.p(nz()) * 0.5) * a; if (j >= 0) { L[j] += y * gl; R[j] += y * gr; S[j] += y * gs; } }
  }
  function pluck(t, m, vel, pan, bright = 0.5, send = 0.30) {      // guzheng string (Karplus-Strong, plucked near the bridge)
    add(cached('pl' + m + '_' + bright, () => { const f = hz(m), wb = 0.42 - 0.22 * bright, D = SR / f - wb, n = Math.floor(D - 0.1), fd = D - n, C = (1 - fd) / (1 + fd), d = new Float32Array(n); let lpv = 0; for (let i = 0; i < n; i++) { lpv += (nz() - lpv) * (0.25 + bright * 0.6); d[i] = lpv; }
      const pk = Math.max(2, Math.floor(n * 0.18)); for (let i = n - 1; i >= pk; i--) d[i] -= d[i - pk] * 0.6;
      const damp = Math.pow(0.001, 1 / (f * (2.6 + 220 / f))), len = Math.floor(SR * Math.min(3.0, 0.8 * (2.6 + 220 / f))), o = new Float32Array(len); let c = 0, z = 0, ax = 0, ay = 0;
      for (let i = 0; i < len; i++) { const y = d[c], w = y * (1 - wb) + z * wb, ap = C * w + ax - C * ay; z = y; ax = w; ay = ap; d[c] = ap * damp; if (++c === n) c = 0; o[i] = y * Math.min(1, i / 60) * (i > len - 4000 ? (len - i) / 4000 : 1); }
      return o; }), t, vel * 0.5, pan, send);
  }
  function taiko(t, vel, pan, size = 1, send = 0.20) {             // skin: a falling sine and its overtone; stick: noise and a click
    const tier = vel < 0.5 ? 0 : vel < 0.85 ? 1 : 2, sz = Math.round(size * 20) / 20;
    add(cached('tk' + sz + '_' + tier, () => { const hard = tier / 2, len = Math.floor(SR * (sz < 0.8 ? 1.8 : 1.3)), o = new Float32Array(len), nl = bq('lp', 1100 + 800 * hard, 0.7), nb = bq('bp', 190 * sz, 1.0), ck = bq('hp', 2600, 0.7);
      const dF = Math.exp(-26 / SR), d1 = Math.exp(-(sz < 0.8 ? 2.5 : 3.4) / SR), d2 = Math.exp(-6.5 / SR), d3 = Math.exp(-48 / SR), d4 = Math.exp(-13 / SR), d5 = Math.exp(-170 / SR); let ph = 0, ph2 = 0, ph3 = 0, eF = 1, e1 = 1, e2 = 1, e3 = 1, e4 = 1, e5 = 1;
      for (let i = 0; i < len; i++) { const f = (60 + 50 * eF) * sz; ph += f / SR; ph2 += f * 1.59 / SR; ph3 += f * 2.31 / SR; const n = nz();
        const y = Math.sin(TAU * ph) * e1 * 0.9 + 0.55 * Math.sin(TAU * ph2) * e2 + 0.3 * Math.sin(TAU * ph3) * e4 + nl.p(n) * e3 * (0.65 + 0.5 * hard) + nb.p(nz()) * e4 * 0.5 + ck.p(n) * e5 * (0.2 + 0.7 * hard);
        o[i] = Math.tanh(y * 1.5) * (i > len - 1500 ? (len - i) / 1500 : 1); eF *= dF; e1 *= d1; e2 *= d2; e3 *= d3; e4 *= d4; e5 *= d5; }
      return o; }), t, vel * 0.72, pan, send);
  }
  function ka(t, vel, pan) { add(cached('ka', () => { const o = new Float32Array(Math.floor(SR * 0.13)), b = bq('bp', 1650, 2.2), b2 = bq('bp', 3900, 3), b3 = bq('hp', 6000, 0.7); for (let i = 0; i < o.length; i++) { const ti = i / SR, n = nz(); o[i] = (b.p(n) + b2.p(n) * 0.4 + b3.p(n) * 0.2 * Math.exp(-ti * 160)) * Math.exp(-ti * 55); } return o; }), t, vel * 1.1, pan, 0.18); }
  function shime(t, vel, pan, hi = 0) { add(cached('sh' + hi, () => { const o = new Float32Array(Math.floor(SR * 0.22)), b = bq('bp', 820 + 260 * hi, 1.2), c = bq('hp', 3800, 0.7); let ph = 0;   // small tight drum
      for (let i = 0; i < o.length; i++) { const ti = i / SR; ph += (300 + 60 * hi) * (1 + 0.5 * Math.exp(-ti * 70)) / SR; const n = nz(); o[i] = Math.tanh((Math.sin(TAU * ph) * Math.exp(-ti * 24) + b.p(n) * 0.8 * Math.exp(-ti * 38) + c.p(n) * 0.5 * Math.exp(-ti * 120)) * 1.4) * (1 - sm(0.17, 0.22, ti)); } return o; }), t, vel * 0.5, pan, 0.16); }
  // bronze: a dense cloud of inharmonic partials (the high ones die first) inside a wash of noise, struck hard at the edge
  function cym(t, vel, pan, long = 1) { add(cached('cy' + long, () => { const dur = long ? 1.9 : 0.09, n = Math.floor(SR * dur), o = new Float32Array(n), NP = long ? 96 : 40, k = long ? 2.6 : 60, h = bq('hp', 2400, 0.7), b1 = bq('bp', 3900, 0.5), b2 = bq('bp', 7600, 0.6);
      for (let p = 0; p < NP; p++) { const u = p / NP, f = 1900 * Math.pow(5.6, (p + rnd()) / NP), w = TAU * f / SR, c = Math.cos(w), s = Math.sin(w), a0 = rnd() * TAU, de = Math.exp(-k * (0.7 + 0.9 * u) * (0.75 + 0.5 * rnd()) / SR), amp = (0.5 + rnd()) * (1 - 0.45 * u) * 0.92 / Math.sqrt(NP); let x = Math.cos(a0) * amp, y = Math.sin(a0) * amp;
        for (let i = 0; i < n; i++) { const x2 = (x * c - y * s) * de; y = (x * s + y * c) * de; x = x2; o[i] += y; } }
      for (let i = 0; i < n; i++) { const ti = i / SR, nn = nz(), e = Math.exp(-ti * k), e6 = Math.exp(-ti * k * 6); o[i] = h.p(o[i] * (1 + 0.8 * e6) + (b1.p(nn) * 0.62 + b2.p(nn) * 0.4) * (e * 0.95 + e6 * 0.8)) * 1.42 * Math.min(1, ti * 900) * (1 - sm(dur * 0.8, dur, ti)); } return o; }), t, vel * 0.16, pan, 0.3); }
  function block(t, vel, pan, f = 1150) { add(cached('wb' + f, () => { const o = new Float32Array(Math.floor(SR * 0.09)); for (let i = 0; i < o.length; i++) { const ti = i / SR; o[i] = (Math.sin(TAU * f * ti) + 0.5 * Math.sin(TAU * f * 2.63 * ti + 1)) * Math.exp(-ti * 70) * Math.min(1, ti * 2000); } return o; }), t, vel * 0.22, pan, 0.25); }
  function gong(t, vel, dur = 9) {                                 // tam-tam: 22 beating partials, the high ones blooming late
    const g = cached('gong', () => { const len = Math.floor(SR * 10), l = new Float32Array(len), r = new Float32Array(len);
      for (let k = 0; k < 22; k++) { const f = 61 * Math.pow(1.205, k) * (1 + (rnd() - 0.5) * 0.04), amp = 1 / (1 + k * 0.30), de = Math.exp(-3 / (6.5 / (1 + k * 0.20) * SR)), da = Math.exp(-1 / ((0.004 + k * 0.013) * SR)), pn = rnd(), f2 = f + 0.3 + rnd() * 1.1, p0 = rnd() * TAU;
        const c1 = Math.cos(TAU * f / SR), s1 = Math.sin(TAU * f / SR), c2 = Math.cos(TAU * f2 / SR), s2 = Math.sin(TAU * f2 / SR), gl = amp * (1 - pn * 0.7), gr = amp * (0.3 + pn * 0.7); let x1 = Math.cos(p0), y1 = Math.sin(p0), x2 = 1, y2 = 0, e = 1, a = 0;
        for (let i = 0; i < len; i++) { let x = x1 * c1 - y1 * s1; y1 = x1 * s1 + y1 * c1; x1 = x; x = x2 * c2 - y2 * s2; y2 = x2 * s2 + y2 * c2; x2 = x; a = 1 - (1 - a) * da; const v = (y1 + 0.8 * y2) * e * a; l[i] += v * gl; r[i] += v * gr; e *= de; } }
      return [l, r]; });
    const i0 = ix(t), len = Math.min(g[0].length, Math.floor(dur * SR), N - i0), f0 = Math.floor(Math.max(0.2, dur - 1.5) * SR), a = vel * 0.085;
    for (let i = 0; i < len; i++) { const fd = i > f0 ? 1 - (i - f0) / (len - f0) : 1, j = i0 + i, l = g[0][i] * a * fd, r = g[1][i] * a * fd; L[j] += l; R[j] += r; S[j] += (l + r) * 0.35; }
  }
  function bell(t, m, vel, pan, send = 0.5) { add(cached('be' + m, () => { const f = hz(m), idx = 1.6 * Math.min(1, 1700 / f), o = new Float32Array(Math.floor(SR * 2.4)); for (let i = 0; i < o.length; i++) { const ti = i / SR; o[i] = Math.sin(TAU * f * ti + Math.sin(TAU * f * 3.51 * ti) * idx * Math.exp(-ti * 5)) * Math.exp(-ti * 2.6) * (1 - sm(2.0, 2.4, ti)); } return o; }), t, vel * 0.19, pan, send); }
  // a cloud of small bells struck at random over a held cluster
  function bellCloud(t0, t1, ms, vel, rate, shape) { for (let t = t0 + rnd() / rate; t < t1; t += (0.3 + 1.4 * rnd()) / rate) bell(t, ms[(rnd() * ms.length) | 0] + (rnd() < 0.35 ? 12 : 0), vel * (0.45 + 0.55 * rnd()) * (shape ? shape((t - t0) / (t1 - t0)) : 1), 0.2 + 0.6 * rnd(), 0.6); }
  // string bed: detuned saws under a slow low-pass. o: att, rel, trem (bow tremolo depth), from (level at the start, swelling to 1)
  function pad(t0, t1, ms, vel, bright = 1, o) {
    const at = o && o.att || 0.9, rl = o && o.rel || 1.2, trem = o && o.trem || 0, from = o && o.from !== undefined ? o.from : 1;
    const i0 = Math.max(0, ix(t0 - 0.05)), i1 = Math.min(N, ix(t1 + rl + 0.05)), fl = svf(), fr = svf(), nv = ms.length * 3, F = new Float64Array(nv), PH = new Float64Array(nv), PN = new Float64Array(nv);
    for (let k = 0; k < nv; k++) { const d = k % 3; F[k] = hz(ms[(k / 3) | 0] + (d === 0 ? -0.07 : d === 1 ? 0 : 0.08)) / SR; PH[k] = rnd(); PN[k] = d === 0 ? 0.2 : d === 1 ? 0.5 : 0.8; }
    let cut = 600, g = 0, tp = rnd(), aml = 1, amr = 1;
    for (let i = i0; i < i1; i++) {
      if ((i & 15) === 0) { const t = i / SR, env = sm(t0 - 0.05, t0 + at, t) * (1 - sm(t1 - 0.2, t1 + rl, t)) * (from + (1 - from) * clamp((t - t0) / (t1 - t0), 0, 1)); cut = (560 + 1500 * env * bright) * (1 + 0.15 * Math.sin(t * 0.7)); g = env * vel * 0.042;
        if (trem) { tp += 16 * (12.5 + 1.5 * Math.sin(t * 1.7)) / SR; aml = 1 - trem * (0.5 + 0.5 * Math.sin(TAU * tp)); amr = 1 - trem * (0.5 + 0.5 * Math.sin(TAU * tp * 1.06 + 1.3)); } }
      let l = 0, r = 0; for (let k = 0; k < nv; k++) { const dt = F[k]; let p = PH[k] + dt; if (p >= 1) p -= 1; PH[k] = p; const s = saw(p, dt); l += s * (1 - PN[k]); r += s * PN[k]; }
      l = fl.p(l, cut, 0.8) * g * aml; r = fr.p(r, cut, 0.8) * g * amr; L[i] += l; R[i] += r; S[i] += (l + r) * 0.35;
    }
  }
  // wordless voices: the same saws sung through an open vowel
  function choir(t0, t1, ms, vel, o) {
    const at = o && o.att || 1.0, rl = o && o.rel || 0.3, from = o && o.from !== undefined ? o.from : 1, i0 = Math.max(0, ix(t0)), i1 = Math.min(N, ix(t1 + rl)), nv = ms.length * 2, F = new Float64Array(nv), PH = new Float64Array(nv), VP = new Float64Array(nv), VR = new Float64Array(nv);
    for (let k = 0; k < nv; k++) { F[k] = hz(ms[k >> 1] + (k & 1 ? 0.09 : -0.08)) / SR; PH[k] = rnd(); VP[k] = rnd() * TAU; VR[k] = TAU * (4.8 + rnd() * 1.2) / SR; }
    const fm = [[720, 4, 1.0], [1150, 5, 0.6], [2750, 6, 0.34], [3500, 6, 0.22]], FL = fm.map(f => bq('bp', f[0], f[1])), FR = fm.map(f => bq('bp', f[0] * 1.04, f[1])), ll = bq('lp', 900, 0.7), lr = bq('lp', 900, 0.7); let g = 0;
    for (let i = i0; i < i1; i++) { if ((i & 15) === 0) { const t = i / SR, u = clamp((t - t0) / (t1 - t0), 0, 1); g = sm(t0, t0 + at, t) * (1 - sm(t1, t1 + rl, t)) * (from + (1 - from) * u * Math.sqrt(u)) * vel * 0.10; }
      let l = 0, r = 0; for (let k = 0; k < nv; k++) { VP[k] += VR[k]; const dt = F[k] * (1 + 0.006 * Math.sin(VP[k])); let p = PH[k] + dt; if (p >= 1) p -= 1; PH[k] = p; const s = saw(p, dt); if (k & 1) r += s; else l += s; }
      let yl = ll.p(l) * 0.45, yr = lr.p(r) * 0.45; for (let j = 0; j < 4; j++) { yl += FL[j].p(l) * fm[j][2]; yr += FR[j].p(r) * fm[j][2]; }
      yl *= g; yr *= g; L[i] += yl + yr * 0.3; R[i] += yr + yl * 0.3; S[i] += (yl + yr) * 0.45; }
  }
  function stac(t, m, dur, vel, pan) {                             // low strings, short hard bow strokes
    add(cached('st' + m + '_' + Math.round(dur * 1000), () => { const f = hz(m), dt = f / SR, len = Math.floor((dur + 0.16) * SR), o = new Float32Array(len), fl = svf(); let ph = rnd(), ph2 = rnd(), cut = 3000;
      for (let i = 0; i < len; i++) { const ti = i / SR; if ((i & 15) === 0) cut = 320 + 2600 * Math.exp(-ti / 0.075); ph += dt; if (ph >= 1) ph -= 1; ph2 += dt * 2.004; if (ph2 >= 1) ph2 -= 1;
        o[i] = fl.p(saw(ph, dt) * 0.8 + saw(ph2, dt * 2.004) * 0.3 + nz() * 0.3 * Math.exp(-ti / 0.01), cut, 1.4) * Math.min(1, ti / 0.005) * Math.exp(-ti / (dur * 0.6)) * (1 - sm(dur, dur + 0.16, ti)); }
      return o; }), t, vel * 0.34, pan, 0.22);
  }
  function drone(t0, t1, m, vel, fi = 3, fo = 3) { const f = hz(m), pr = [[1, 1], [2.003, 0.5], [3.0, 0.22]].map(p => { const w = TAU * f * p[0] / SR; return [Math.cos(w), Math.sin(w), 1, 0, p[1]]; }); let env = 0;
    for (let i = Math.max(0, ix(t0)), e = Math.min(N, ix(t1)); i < e; i++) { if ((i & 15) === 0) { const t = i / SR; env = sm(t0, t0 + fi, t) * (1 - sm(t1 - fo, t1, t)) * vel * (0.85 + 0.15 * Math.sin(t * 0.43)); }
      let y = 0; for (let k = 0; k < 3; k++) { const p = pr[k], x = p[2] * p[0] - p[3] * p[1]; p[3] = p[2] * p[1] + p[3] * p[0]; p[2] = x; y += p[3] * p[4]; }
      y *= env; L[i] += y * 0.5; R[i] += y * 0.5; S[i] += y * 0.12; } }

  // ================= the piece: 80 bpm, bars of 3 s =================
  const seq = (t, ns) => ns.map(n => [t + n[0], n[1], n[2], n[3]]);
  const ERHU = { kind: 'erhu', gain: 0.60, pan: 0.42, send: 0.36 }, DIZI = { kind: 'dizi', gain: 0.40, pan: 0.64, send: 0.5, tr: 0 }, XIAO = { kind: 'xiao', gain: 0.34, pan: 0.60, send: 0.55, tr: 0 };
  const chords = { Gm: [43, 50, 55, 58, 62], Eb: [39, 46, 55, 58, 63], F: [41, 48, 53, 57, 60], Dm: [38, 45, 53, 57, 62], Bb: [46, 53, 58, 62, 65], G: [43, 50, 55, 59, 62] };
  const WM = [83, 90, 88, 86];                                     // the white motif: B F# E D
  // the motif on glass with a bell on each attack (and the xiao an octave under it). r: [offset, dur] x 4
  function white(t, r, vel, o) { const ms = o && o.ms || WM, bo = o && o.bell !== undefined ? o.bell : 1, pb = o && o.pan !== undefined ? o.pan : 0.66; ms.forEach((m, k) => { if (!(o && o.noGlass)) glass(t + r[k][0], r[k][1], m, vel, pb + 0.06 * (k & 1), 0.6); if (!(o && o.noBell)) bell(t + r[k][0], m + 12 * bo, vel * (bo > 1 ? 0.4 : 0.55), pb + 0.04 - 0.1 * k * (pb > 0.5 ? 1 : -1), 0.6); });
    if (o && o.xiao) lead(ms.map((m, k) => [t + r[k][0], r[k][1], m - 12, 0.8]), Object.assign({}, XIAO, { gain: XIAO.gain * vel })); }
  const sideW = t => clamp(0.5 + 0.8 * (panW(t) - 0.5), 0.3, 0.72);      // where the white loong's instruments sit: its side of the frame at that moment
  const groove = (t, dense, vel, fill) => {
    taiko(t, vel, 0.5, 1); taiko(t + B * 1.5, vel * 0.78, 0.42, 1.1); taiko(t + B * 3, vel * 0.86, 0.58, 1.05); ka(t + B, 0.5 * vel, 0.3); ka(t + B * 2.5, 0.55 * vel, 0.7);
    if (dense) { taiko(t + B * 2.25, vel * 0.5, 0.45, 1.25); ka(t + B * 0.5, 0.4 * vel, 0.65); ka(t + B * 3.5, 0.5 * vel, 0.35); ka(t + B * 3.75, 0.6 * vel, 0.6); for (let k = 0; k < 8; k++) shime(t + k * B / 2, (k & 1 ? 0.3 : 0.45) * vel, k & 1 ? 0.7 : 0.32, k & 1); }
    if (fill) for (let k = 0; k < 4; k++) taiko(t + B * 3 + B * 0.25 * k, vel * (0.4 + 0.12 * k), 0.4 + 0.07 * k, 1.3 - 0.1 * k); };
  const bass = (t, m, vel) => { pluck(t, m, vel, 0.5, 0.35, 0.2); pluck(t + B * 1.5, m, vel * 0.7, 0.46, 0.35, 0.2); pluck(t + B * 2, m + 7, vel * 0.8, 0.54, 0.35, 0.2); pluck(t + B * 3, m, vel * 0.75, 0.5, 0.35, 0.2); };
  const strum = (t, c, vel, up = 12) => c.forEach((m, i) => pluck(t + i * 0.055, m + up, vel, 0.3 + i * 0.1, 0.7));
  const roll = (t0, t1, step, v0, v1, s0, s1) => { const n = Math.round((t1 - t0) / step); for (let k = 0; k < n; k++) { const u = k / n; if (t0 + k * step > t1 - q + 0.001) break; taiko(t0 + k * step, (v0 + (v1 - v0) * u * u) * (k % 4 === 0 ? 1.15 : 1), k & 1 ? 0.62 : 0.38, s0 + (s1 - s0) * u + (k & 1 ? 0.1 : 0)); } };

  // ---- dawn (0 to EMERGE): wind, water, eave bells, guzheng, a low drone; the erhu states the red theme quietly
  drone(0, R1 + 0.2, 31, 0.07, 3, 0.6); drone(0, R1 + 0.2, 43, 0.065, 3, 0.6); drone(tE + 1, R0, 38, 0.04, 3, 1);
  pad(0.5, tE, [43, 50, 62], 0.62, 0.6);
  lead(seq(tE - 6, [[0, 1.5, 79, 0.62], [1.5, 0.375, 77, 0.5], [1.875, 0.375, 74, 0.5], [2.25, 0.75, 77, 0.55], [3, 1.5, 74, 0.6], [4.5, 0.375, 72, 0.5], [4.875, 0.375, 70, 0.5], [5.25, 0.7, 72, 0.5]]), Object.assign({}, ERHU, { gain: 0.54, send: 0.45, pan: 0.5 }));
  [82, 79, 77, 74, 72, 70, 67, 65, 62].forEach((m, i) => pluck(tE - 7.8 + i * 0.085, m, 0.42 - i * 0.02, 0.25 + i * 0.06, 0.6));
  [55, 62, 67].forEach((m, i) => pluck(tE - 4.5 + i * 0.75, m, 0.34, 0.6 - i * 0.12, 0.5));
  [55, 58, 62, 65, 67, 70, 74, 77].forEach((m, i) => pluck(tE - 0.72 + i * 0.085, m, 0.34 + i * 0.025, 0.7 - i * 0.06, 0.6));
  for (const [dt, m, p] of [[-8.1, 86, 0.25], [-6.4, 91, 0.7], [-3.7, 84, 0.35], [-1.6, 89, 0.62]]) bell(tE + dt, m, 0.5, p);
  // ---- EMERGE: a deep drum under the growl, the bed swells, drums gather into the downbeat
  taiko(tE, 1.1, 0.5, 0.7); strum(tE + 0.1875, chords.Gm, 0.36, 0); strum(tE + 3, chords.Eb, 0.4);
  pad(tE, tE + 3, [31, 43, 50, 55, 58], 0.8, 0.7); pad(tE + 3, tD, [39, 46, 51, 55, 58, 63], 0.95, 1.0, { from: 0.6 });
  lead(seq(tD - 3, [[0, 0.75, 70, 0.62], [0.75, 0.75, 72, 0.7], [1.5, 0.75, 74, 0.8], [2.25, 0.72, 77, 0.9]]), Object.assign({}, ERHU, { pan: 0.5 }));
  for (let i = 0; i < 14; i++) { const u = i / 14; taiko(tD - 3 + 3 * (1 - Math.pow(1 - u, 1.7)), 0.18 + 0.62 * u * u, 0.4 + 0.2 * (i % 2), 1.0 + 0.2 * (i % 2)); }
  for (const [dt, m, p] of [[1.6, 79, 0.2], [2.1, 84, 0.3], [4.4, 86, 0.72]]) bell(tE + dt, m, 0.42, p);
  // ---- DRUMS: the theme in full on erhu, dizi answering over the long notes; then the line climbs through the inhale
  gong(tD, 0.9, 8); taiko(tD, 1.1, 0.5, 0.8); cym(tD, 0.8, 0.6);
  ['Gm', 'Bb'].forEach((c, k) => { const t = tD + 3 * k; pad(t, t + 3, chords[c], 1.0, 1.0); strum(t, chords[c], 0.42); pluck(t + B * 2, chords[c][2] + 12, 0.3, 0.7, 0.45); pluck(t + B * 3, chords[c][4] + 12, 0.3, 0.3, 0.45); groove(t, k === 1, 0.92, k === 1); bass(t, chords[c][0], 0.8); });
  lead(seq(tD, [[0, 1.5, 79, 1.0], [1.5, 0.375, 77, 0.85], [1.875, 0.375, 74, 0.85], [2.25, 0.75, 77, 0.9], [3, 1.5, 74, 0.95], [4.5, 0.375, 72, 0.8], [4.875, 0.375, 70, 0.8], [5.25, 0.75, 72, 0.85],
    [6, 0.75, 70, 0.85], [6.75, 0.75, 72, 0.88], [7.5, 0.75, 74, 0.92], [8.25, 0.72, 77, 0.98]]), Object.assign({}, ERHU, { pan: 0.5 }));      // red is alone in the middle of the frame: its voice sits in the middle
  lead(seq(tD, [[0.75, 0.375, 79, 0.5], [1.125, 0.375, 82, 0.55], [1.5, 1.35, 86, 0.6], [3.75, 0.1875, 82, 0.5], [3.9375, 0.1875, 84, 0.52], [4.125, 0.375, 86, 0.58], [4.5, 1.35, 89, 0.62],
    [6, 0.75, 82, 0.5], [6.75, 0.75, 84, 0.54], [7.5, 0.75, 86, 0.6], [8.25, 0.72, 89, 0.66]]), Object.assign({}, DIZI, { pan: 0.56 }));
  taiko(tD + 6, 0.8, 0.5, 1); pad(tD + 6, tC, chords.F, 0.8, 1.0, { rel: 0.5 });
  pad(tC - 0.4, R0, [43, 50, 57, 62, 69], 0.9, 1.4, { rel: 0.4 });
  for (const [dt, v] of [[2.25, 0.4], [1.5, 0.46], [0.9375, 0.52], [0.5625, 0.6], [0.375, 0.68], [0.1875, 0.76]]) taiko(R0 - dt, v, 0.5, 0.85);      // heartbeat quickening on the grid, a breath, then the roar
  for (let t = tC, k = 0; t < R0 - q - 0.01; t += q / 2, k++) { const u = (t - tC) / (R0 - tC); pluck(t, k & 1 ? 86 : 74, 0.14 + 0.36 * u, 0.6 + 0.1 * (k & 1), 0.75); }
  // ---- ROAR: gong, sub hit, a held low cluster that dies with the roar
  gong(R0, 1.25, R1 - R0 + 0.3); taiko(R0, 1.25, 0.5, 0.7); taiko(R0 + 0.09, 0.9, 0.35, 0.95); taiko(R0 + 0.17, 0.8, 0.65, 1.1); cym(R0, 1.0, 0.4);
  pad(R0, R1 - 0.5, [31, 38, 43, 50, 58, 62], 1.1, 0.7, { rel: 0.5 });
  // ---- OMEN: silence, thunder (foley), and a new colour: glass and bells high above the red valley
  drone(STR[0] + 0.6, CUT, 31, 0.07, 2.5, 0.03); drone(tDe, tF, 43, 0.05, 2, 1.5);
  bellCloud(STR[Math.min(1, STR.length - 1)] + 0.3, tDe, [83, 90, 95], 0.2, 3.0, u => 0.4 + 0.6 * u);
  glass(tDe - 2 * B, B, WM[0], 0.55); glass(tDe - B, B * 1.4, WM[1], 0.65); lead([[tDe - 2 * B, B, WM[0] - 12, 0.6], [tDe - B, B - 0.1, WM[1] - 12, 0.7]], Object.assign({}, XIAO, { gain: 0.26 }));
  // ---- DESCENT: the white motif over tremolo strings, taiko rolls building in the last bar
  white(tDe, [[0, 0.75], [0.75, 1.5], [2.25, 0.75], [3, 2.2]], 1.0, { xiao: 1 });
  white(tDe + 4.5, [[0, 0.375], [0.375, 0.375], [0.75, 0.375], [1.125, 0.5]], 0.8, { bell: 2, noGlass: 1 }); glass(tDe + 4.5, 1.4, WM[3], 0.5);
  pad(tDe, tDe + 3, [55, 62, 66, 71], 0.8, 1.3, { trem: 0.55 }); pad(tDe + 3, tF, [43, 55, 58, 62, 66], 1.0, 1.6, { trem: 0.6, from: 0.6, rel: 0.5 });
  bellCloud(tDe, tF, [83, 86, 90, 95], 0.26, 2.2);
  roll(tF - 3, tF - 0.75, q, 0.15, 0.5, 1.1, 0.95); roll(tF - 0.75, tF, q / 2, 0.45, 0.72, 0.95, 0.8); taiko(tF, 1.0, 0.5, 0.7); cym(tF, 0.6, 0.6);
  // ---- FACEOFF: heartbeat drum; erhu low and tense against the glass
  for (let k = 0; k < 4; k++) { taiko(tF + k * B + (k ? 0 : 0.14), k ? 0.56 : 0.36, 0.5, 0.9); if (k) taiko(tF + k * B + 0.15, 0.36, 0.5, 0.95); }
  pad(tF, W0, [43, 49, 55, 58, 66], 1.0, 1.5, { trem: 0.65, rel: 0.25 });
  lead(seq(tF, [[0.1, 0.6, 67, 0.85], [0.75, 0.375, 65, 0.75], [1.125, 0.36, 62, 0.75], [2.25, 0.7, 62, 0.8]]), Object.assign({}, ERHU, { pont: 0.8, gain: 0.55 }));
  white(tF + 1.5, [[0, 0.375], [0.375, 0.45]], 0.8, { ms: [WM[0], WM[1]] });
  white(tF + 2.4375, [[0, 0.1875], [0.1875, 0.3]], 0.7, { ms: [WM[2], WM[3]] });
  // ---- WROAR: the white roars over a glass cluster; a gathered pickup into the first collision
  taiko(W0, 0.9, 0.5, 0.7); cym(W0, 0.9, 0.62); [83, 86, 90, 95].forEach((m, i) => { glass(W0, W1 - W0 - 0.4, m, 0.5, 0.5 + 0.1 * i); bell(W0 + i * 0.03, m + 12, 0.5, 0.75 - 0.12 * i); });
  [[4, 0.4], [3, 0.5], [2, 0.62], [1.5, 0.5], [1, 0.75]].forEach(([k, v], i) => taiko(tC1 - k * q, v, 0.4 + 0.2 * (i & 1), 1.1 - 0.05 * i));
  // ---- CLASH1: the fight. Sixteenth-note taiko and a low string ostinato; red fragments on erhu, the white motif on dizi and glass, rising bar by bar
  const OST = [0, 0, 3, 0, 0, 0, 5, 0, 0, 0, 7, 5, 3, 0, -2, 0], DRUMS = 1.3;      // DRUMS: the fight's drums stand in front of its strings
  const fightBar = (t, root, v, n16 = 16) => { for (let s = 0; s < n16; s++) { const ts = t + s * q, j = s & 3, acc = j === 0 ? 1 : j === 2 ? 0.7 : 0.5;
      stac(ts, root + OST[s], q * 0.9, (0.55 + 0.4 * acc) * v, 0.4); stac(ts, root + OST[s] + 12, q * 0.9, (0.3 + 0.25 * acc) * v, 0.62);
      shime(ts, (0.3 + 0.5 * acc) * v * DRUMS, s & 1 ? 0.68 : 0.34, s & 1);
      if (j === 0) taiko(ts, 0.95 * v * DRUMS, 0.5, 0.85); else if (j === 2) taiko(ts, 0.5 * v * DRUMS, 0.4, 1.1); else if (j === 3) taiko(ts, 0.62 * v * DRUMS, 0.6, 1.0);
      if (j === 2) cym(ts, 0.55 * v, 0.7, 0); }
    ka(t + B * 1.5, 0.6 * v * DRUMS, 0.3); ka(t + B * 3.5, 0.65 * v * DRUMS, 0.7); block(t + B * 0.75, 0.7 * v, 0.25); block(t + B * 2.75, 0.7 * v, 0.75, 1380); };
  const RED = [[0, 0.375, 79, 1.0], [0.375, 0.1875, 77, 0.9], [0.5625, 0.1875, 74, 0.9], [0.75, 0.62, 77, 0.95]], WQ = [[0, 0.1875], [0.1875, 0.5625], [0.75, 0.1875], [0.9375, 0.5]];
  gong(tC1, 0.7, 5); taiko(tC1, 0.9, 0.5, 0.75); cym(tC1, 0.9, 0.5);
  [[43, 0], [46, 3], [48, 7]].forEach(([root, up], k) => { const t = tC1 + 3 * k, v = 0.8 + 0.1 * k;
    fightBar(t, root, v, k === 2 ? 12 : 16); pad(t, t + 3, [root - 12, root, root + 7, root + 12], 0.85 + 0.1 * k, 1.3, { att: 0.15, rel: 0.4 }); if (k) cym(t, 0.7, 0.4);
    lead(RED.map(n => [t + n[0], n[1], n[2] + up, n[3]]), Object.assign({}, ERHU, { gain: 0.66, pont: 0.25 })); });
  white(tC1 + 1.5, WQ, 0.9, { pan: sideW(tC1 + 2) }); lead(seq(tC1 + 1.5, WQ.map((r, k) => [r[0], r[1], WM[k], 0.85])), Object.assign({}, DIZI, { pan: sideW(tC1 + 2) }));
  white(tFi + 0.75, WQ.slice(0, 2), 0.9, { ms: [WM[0], WM[1]], pan: sideW(tFi + 1) }); lead(seq(tFi + 0.75, [[0, 0.1875, WM[0], 0.85], [0.1875, 0.5, WM[1], 0.9]]), Object.assign({}, DIZI, { pan: sideW(tFi + 1) }));
  white(tBo, WQ, 1.0); white(tBo, WQ, 0.9, { bell: 2, noGlass: 1 }); lead(seq(tBo, WQ.map((r, k) => [r[0], r[1], WM[k], 1.0])), Object.assign({}, DIZI, { gain: 0.48 }));
  roll(tC2 - B, tC2, q / 2, 0.4, 0.7, 1.1, 0.8);
  // ---- CLASH2: locked together and falling: a continuous roll, the ostinato sinking, both voices tangled
  gong(tC2, 0.9, 6); taiko(tC2, 1.05, 0.5, 0.7); taiko(tC2 + 0.08, 0.7, 0.36, 0.9); cym(tC2, 1.0, 0.45);
  roll(tC2 + q, tS, q / 2, 0.26 * DRUMS, 0.6 * DRUMS, 1.2, 0.8);
  for (let k = 0; k < 8; k++) { const t = tC2 + k * B, root = 50 - Math.round(k * 1.6), v = 0.75 + 0.03 * k; [0, 0, 3, 0].forEach((d, s) => { stac(t + s * q, root + d, q * 0.9, (s ? 0.6 : 0.95) * v, 0.4); stac(t + s * q, root + d + 12, q * 0.9, (s ? 0.35 : 0.55) * v, 0.62); shime(t + s * q, (s ? 0.35 : 0.7) * v * DRUMS, s & 1 ? 0.68 : 0.34, s & 1); }); }
  [[50, 57, 62, 65], [47, 54, 59, 62], [44, 51, 56, 59], [41, 48, 53, 56]].forEach((c, k) => pad(tC2 + 1.5 * k, tC2 + 1.5 * k + 1.5, c, 0.9, 1.5, { att: 0.12, rel: 0.3, trem: 0.5 }));
  { const down = [89, 86, 84, 82, 79, 77, 74, 72], ns = []; down.forEach((m, k) => { ns.push([tC2 + k * B, 0.5625, m, 0.95], [tC2 + k * B + 0.5625, 0.1875, m + (k & 1 ? 3 : 2), 0.8]); }); lead(ns, Object.assign({}, ERHU, { gain: 0.62, pont: 0.3 })); }
  [83, 81, 79, 77].forEach((s, k) => { const t = tC2 + 0.75 + 1.5 * k; lead([[t, q, s, 0.85], [t + q, 2 * q, s + 7, 0.9], [t + 3 * q, q, s + 5, 0.85], [t + 4 * q, 3 * q, s + 3, 0.85]], DIZI); glass(t + q, 0.5, s + 7, 0.7); bell(t + q, s + 19, 0.5, 0.7); });
  // ---- SPLASH: half-time for two bars: low drums, spent breath, a riser into the beam
  taiko(tS, 1.2, 0.5, 0.7); cym(tS, 0.9, 0.55);
  pad(tS + 0.4, tBe - 1.2, [31, 43, 50, 55], 0.7, 0.6, { att: 1.5 }); drone(tS, tBe, 43, 0.06, 1, 1);
  for (let k = 1; k < 4; k++) { taiko(tS + k * 1.5, 0.55 + 0.08 * k, 0.5, 0.88); taiko(tS + k * 1.5 + 0.17, 0.36, 0.5, 0.92); }
  lead(seq(tS + 1.5, [[0, 1.3, 67, 0.55], [1.5, 0.7, 65, 0.5], [2.25, 0.7, 62, 0.5]]), Object.assign({}, ERHU, { gain: 0.5, send: 0.5 }));
  glass(tS + 3, 1.3, WM[0], 0.5); glass(tS + 4.5, 1.2, WM[1], 0.5); pluck(tS + 1.5, 43, 0.4, 0.4, 0.4); pluck(tS + 3, 50, 0.36, 0.6, 0.4);
  pad(tBe - 3, tBe, [43, 50, 55, 58, 62, 66], 1.0, 1.8, { att: 2.6, from: 0.15, rel: 0.2, trem: 0.4 }); roll(tBe - 1.5, tBe, q, 0.2, 0.7, 1.1, 0.8);
  // ---- BEAM: both breaths meet. Both modes at once (G Bb D against B F#), voices rising, a roll that never lands, until everything stops
  gong(tBe, 0.8, 4.3); taiko(tBe, 1.15, 0.5, 0.7); cym(tBe, 0.9, 0.5);
  choir(tBe, CUT, [43, 55, 58, 62, 66], 0.9, { from: 0.55, rel: 0.02 }); choir(tBe + 2.25, CUT, [67, 70, 71, 74, 78], 0.9, { att: 1.4, from: 0.5, rel: 0.02 });
  lead(seq(tBe, [[0.05, 1.45, 79, 0.9], [1.5, 0.75, 82, 0.92], [2.25, 0.75, 84, 0.95], [3.0, 0.75, 86, 0.98], [3.75, CUT - tBe - 3.8, 89, 1.0]]), Object.assign({}, ERHU, { tr: 0, gain: 0.4, vib: 1.4 })); glass(tBe, CUT - tBe - 0.8, 83, 0.9); glass(tBe + 1.5, CUT - tBe - 2.3, 90, 0.9);
  for (let k = 0; k < 3; k++) taiko(tBe + (k + 1) * B, 0.7, 0.5, 0.75);
  roll(tBe + 2.25, CUT + q - 0.02, q / 2, 0.28, 0.8, 1.15, 0.75);
  // ---- BLAST: the biggest hit; the pearl is foley. Then the FINALE: the theme lifted over Eb F Gm Bb, the white motif woven through it in the red scale
  gong(tBl, 1.5, 10); taiko(tBl, 0.9, 0.5, 0.7); cym(tBl, 1.3, 0.4); cym(tBl + 0.02, 1.1, 0.65);
  drone(tFn - 1, tG + 2.4, 31, 0.07, 1.5, 2); drone(tFn - 1, tG + 2.4, 43, 0.065, 1.5, 2);
  const fin = ['Eb', 'F', 'Gm', 'Bb', 'Eb'];
  fin.forEach((c, k) => { const t = tFn + 3 * k, ch = k === 4 ? chords.Eb : chords[c]; pad(t, t + (k === 4 ? 1.5 : 3), ch.concat([ch[4] + 12]), 1.0 + 0.04 * k, 1.3 + 0.1 * k); if (k === 4) pad(t + 1.5, t + 3, chords.F.concat([72]), 1.2, 1.7);
    strum(t, ch, 0.5); for (let e = 1; e < 8; e++) { const cc = k === 4 && e >= 4 ? chords.F : ch; pluck(t + e * B / 2, cc[[1, 2, 3, 4, 3, 2, 1, 2][e]] + (e > 2 && e < 6 ? 24 : 12), 0.46, 0.75 - 0.07 * e, 0.7); }
    groove(t, true, 0.86 + 0.035 * k, k === 1 || k === 3); if (!(k & 1)) cym(t, 0.8, 0.5); bass(t, ch[0], 0.85); });
  roll(tG - B, tG, q / 2, 0.45, 0.72, 1.1, 0.8);
  const TH = [[0, 1.5, 79, 1.0], [1.5, 0.375, 77, 0.9], [1.875, 0.375, 74, 0.9], [2.25, 0.75, 77, 0.92], [3, 1.5, 74, 0.96], [4.5, 0.375, 72, 0.86], [4.875, 0.375, 70, 0.86], [5.25, 0.75, 72, 0.9],
    [6, 0.75, 70, 0.9], [6.75, 0.75, 72, 0.92], [7.5, 0.75, 74, 0.96], [8.25, 0.75, 77, 1.0], [9, 2.25, 79, 1.0], [11.25, 0.375, 77, 0.9], [11.625, 0.375, 79, 0.94], [12, 1.5, 82, 1.0], [13.5, 0.75, 79, 0.95], [14.25, 0.75, 77, 0.95], [15, 2.0, 79, 1.0]];
  lead(seq(tFn, TH), Object.assign({}, ERHU, { gain: 0.70 }));
  TH.forEach(n => pad(tFn + n[0], tFn + n[0] + n[1] - 0.06, [n[2] - 24, n[2] - 12], 0.62 * n[3], 2.0, { att: 0.14, rel: 0.3 }));
  lead(seq(tFn, [[0, 1.5, 79, 0.7], [1.5, 0.375, 77, 0.62], [1.875, 0.375, 74, 0.62], [2.25, 0.75, 77, 0.65], [3, 1.5, 74, 0.68], [4.5, 0.375, 72, 0.6], [4.875, 0.375, 70, 0.6], [5.25, 0.75, 72, 0.64],
    [6, 0.75, 74, 0.66], [6.75, 0.75, 77, 0.68], [7.5, 0.75, 79, 0.72], [8.25, 0.75, 82, 0.76], [9, 2.25, 82, 0.76], [11.25, 0.375, 84, 0.7], [11.625, 0.375, 86, 0.74], [12, 1.5, 86, 0.8], [13.5, 0.75, 84, 0.74], [14.25, 0.75, 81, 0.74], [15, 2.0, 83, 0.72]]), DIZI);
  const WG = [79, 86, 84, 82], WR = [[0, 0.375], [0.375, 1.125], [1.5, 0.375], [1.875, 1.0]];      // the white contour, sung in the red scale
  white(tFn + 0.75, WR, 0.85, { ms: WG }); white(tFn + 6, WR, 0.7, { ms: WG, bell: 2, noGlass: 1 }); white(tFn + 9, WR, 0.9, { ms: WG }); glass(tFn + 12, 2.6, 86, 0.7);
  // ---- GONG: one chord for both: red's G with white's B on top, the white motif falling through it
  gong(tG, 1.9, tOut - tG + 0.2); taiko(tG, 1.25, 0.5, 0.7); taiko(tG, 0.8, 0.36, 0.95); cym(tG, 0.9, 0.5); pad(tG, tOut - 1.1, [31, 43, 50, 59, 62, 67, 71, 74], 1.0, 0.9, { rel: 0.9 });
  [55, 59, 62, 64, 67, 71, 74, 79].forEach((m, i) => pluck(tG + 0.02 + i * 0.07, m, 0.5, 0.2 + i * 0.09, 0.7));
  white(tG + 0.375, [[0, 0.375], [0.375, 0.375], [0.75, 0.375], [1.125, 0.8]], 0.8);
  for (const [dt, m, p] of [[0.9, 91, 0.3], [1.3, 86, 0.7], [1.7, 95, 0.45]]) bell(tG + dt, m, 0.4, p);
  lap('music'); memo.clear();

  // the music makes room for the hero sounds and draws breath just before the big hits; stems are for analysis (P.stem is unset in the film)
  // The dawn (everything before EMERGE) is lifted 3 dB so the opening carries on a small speaker; the lift lets go inside the EMERGE drum hit.
  // The fight (CLASH1 to SPLASH) plays FIGHT dB over the theme; the finale opens FIN dB down and climbs bar by bar into the gong, which lands 1 dB over where it began.
  { const MT = 1.30, iDawn = ix(tE), FIGHT = 2.4, FIN = 6.6; let g = MT, dl = 1; for (let i = 0; i < N; i++) { if ((i & 31) === 0) { const t = i / SR; dl = 1 + 0.42 * (1 - sm(tE - 0.05, tE - 0.003, t));
        const sec = Math.pow(10, (FIGHT * win(t, tC1 - 0.03, tS + 0.1, 0.03, 0.6) + sm(tFn - 0.9, tFn - 0.1, t) * (-FIN + (FIN + 1) * Math.pow(clamp((t - tFn) / (tG - 0.05 - tFn), 0, 1), 0.8))) / 20);
        g = MT * dl * sec * (1 - 0.22 * win(t, R0 + 0.25, R1, 0.3, 0.3) - 0.4 * win(t, tFi - 0.01, tFi + 1.75, 0.02, 0.5) - 0.2 * win(t, tBo - 0.005, tBo + 1.4, 0.01, 0.8) - 0.3 * win(t, tBo + 0.14, tBo + 0.85, 0.02, 0.4) - 0.25 * win(t, tBe + 0.3, CUT, 0.8, 0.05)
        - 0.42 * win(t, tS - 0.17, tS, 0.12, 0.004) - 0.3 * win(t, tG - 0.15, tG, 0.11, 0.004) - 0.3 * win(t, tBe - 0.15, tBe, 0.11, 0.004) - 0.3 * win(t, tC2 - 0.15, tC2, 0.11, 0.004)
        - 0.2 * win(t, tLeap - 0.13, tLeap, 0.1, 0.004) - 0.36 * win(t, tHit - 0.16, tHit, 0.12, 0.004) - 0.22 * win(t, tHit, tHit + 1.3, 0.01, 0.9)); } L[i] *= g; R[i] *= g; if (i < iDawn) S[i] *= dl; } }      // (last line: a breath before the leap and before the lake, and room for the water)
  // how loud the music is, a hundred times a second: the falls sink under it and come back in its gaps
  const MH = 441, mEnv = new Float32Array(Math.ceil(N / MH) + 1); if (EV && EV.fallL) (() => { for (let i = 0, k = 0, a = 0; i < N; i++) { a += Math.abs(L[i]) + Math.abs(R[i]); if ((i + 1) % MH === 0) { mEnv[k++] = a / (2 * MH); a = 0; } } })();
  if (P.stem === 'sfx') { L.fill(0); R.fill(0); S.fill(0); }
  if (P.stem !== 'music') {
  // ================= foley =================
  // one band of noise swept in pitch, level and position: fc(u), amp(u), pan(u), u = 0..1
  function whoosh(t0, t1, fc, amp, pan, qq, gain, send, low = 0) { const b = svf(); let f = 300, a = 0, at = 0, p = 0.5;
    for (let i = Math.max(0, ix(t0)), e = Math.min(N, ix(t1)); i < e; i++) { if ((i & 31) === 0) { const u = (i / SR - t0) / (t1 - t0); f = fc(u); at = amp(u) * gain; p = pan(u); } a += (at - a) * 0.01; b.p(nz(), f, qq); const y = (b.bp + b.lp * low) * a; L[i] += y * (1 - p) * 1.2; R[i] += y * p * 1.2; S[i] += y * send; S2[i] += y * send * SW * (2 * p - 1); } }
  function tick(t, f, amp, pan, ring = 0.004, send = 0.3) { const i0 = ix(t), len = Math.floor(SR * ring * 7), w = TAU * f / SR, d = Math.exp(-1 / (ring * SR)), gl = (1 - pan) * 1.2, gr = pan * 1.2; let e = amp;
    for (let i = 0, j = i0; i < len && j < N; i++, j++) { const y = (Math.sin(w * i) * 0.8 + (i < 40 ? nz() * 0.5 * (1 - i / 40) : 0)) * e; e *= d; if (j >= 0) { L[j] += y * gl; R[j] += y * gr; S[j] += y * send; } } }
  // dragon voice: a rough source through moving formants. shape(t) -> [pitchHz, level, openness 0..1]. RED is throat and chest; WHT is a shriek with frost in it
  const RED_V = { f1: 300, f1o: 520, f2: 760, f2o: 620, f3: 2100, f3o: 500, nb: 1500, nbo: 1400, sub: 0.9, sub2: 0.55, r0: 27, r1: 16, lp: 3600, f3g: 0.24, nbg: 0.22, hiss: 0 },
    WHT_V = { f1: 560, f1o: 640, f2: 1650, f2o: 900, f3: 3500, f3o: 900, nb: 4600, nbo: 2600, sub: 0.10, sub2: 0.12, r0: 46, r1: 34, lp: 6800, f3g: 0.3, nbg: 0.2, hiss: 0.03 };
  function voice(t0, t1, shape, gain, pan, V = RED_V, send = 0.34) {
    const F1 = svf(), F2 = svf(), F3 = svf(), nb = svf(), lp = bq('lp', V.lp, 0.7), sub = bq('lp', 160, 0.8), hs = bq('hp', 5500, 0.7), cl = bq('hp', 36, 0.7), pf = typeof pan === 'function' ? pan : null, gs = gain * send;      // pan: a number, or a function of film time (the head it belongs to moves)
    let gl = gain * (1 - (pf ? 0.5 : pan)) * 1.2, gr = gain * (pf ? 0.5 : pan) * 1.2, g2 = pf ? 0 : gs * SW * (2 * pan - 1);
    let ph = 0, ph2 = 0, rph = 0, jit = 0, rj = 0, f0 = 60, lv = 0, lvT = 0, op = 0, a1 = V.f1, a2 = V.f2, a3 = V.f3, a4 = V.nb;
    for (let i = Math.max(0, ix(t0)), e = Math.min(N, ix(t1)); i < e; i++) {
      if ((i & 15) === 0) { const s = shape(i / SR); f0 = s[0]; lvT = s[1]; op = s[2]; a1 = V.f1 + V.f1o * op; a2 = V.f2 + V.f2o * op; a3 = V.f3 + V.f3o * op; a4 = V.nb + V.nbo * op; if (pf) { const p = pf(i / SR); gl = gain * (1 - p) * 1.2; gr = gain * p * 1.2; g2 = gs * SW * (2 * p - 1); } }
      lv += (lvT - lv) * 0.02; jit += (nz() - jit) * 0.004; rj += (nz() - rj) * 0.02;
      const f = f0 * (1 + jit * 0.9); ph += f / SR; if (ph >= 1) ph -= 1; ph2 += f * 0.5 / SR; if (ph2 >= 1) ph2 -= 1; rph += (V.r0 + V.r1 * op + rj * 60) / SR;
      const rough = 0.5 + 0.5 * Math.sin(TAU * rph), n = nz(), src = (saw(ph, f / SR) * 0.6 + (ph < 0.32 ? 1 : -0.47) * 0.5 + saw(ph2, f * 0.5 / SR) * V.sub2) * (0.35 + 0.65 * rough * rough) + n * 0.16 * op;
      F1.p(src, a1, 3.2); F2.p(src, a2, 4.0); F3.p(src, a3, 5.0); nb.p(n * rough, a4, 1.3);
      const y = cl.p(lp.p(Math.tanh((F1.bp + F2.bp * 0.8 + F3.bp * V.f3g * op + nb.bp * V.nbg * op * op + sub.p(src) * V.sub) * 1.6)) + hs.p(n) * V.hiss * op) * lv;
      L[i] += y * gl; R[i] += y * gr; S[i] += y * gs; S2[i] += y * g2; }
  }
  function bark(t, gain, pan, f = 520) { const i0 = ix(t), n = Math.floor(SR * 0.09), b1 = bq('bp', f, 1.0), b2 = bq('bp', f * 2.7, 1.2), d = Math.exp(-1 / (0.016 * SR)); let e = gain; for (let i = 0, j = i0; i < n && j < N; i++, j++) { const x = nz(), y = (b1.p(x) * 2.2 + b2.p(x) * 1.3) * e; e *= d; L[j] += y * (1 - pan) * 1.2; R[j] += y * pan * 1.2; S[j] += y * 0.3; S2[j] += y * 0.3 * SW * (2 * pan - 1); } }   // the plosive front of a roar
  // fire breath: an ignition thump, a roaring band of noise that flutters, hiss and sparks; it travels from pan p0 to p1
  function fire(t0, dur, gain, p0, p1) { const fl = svf(), fr = svf(), cr = bq('bp', 2600, 1.2), hi = bq('hp', 3200, 0.7), i0 = ix(t0), len = Math.floor((dur + 0.9) * SR); let sp = 0, c1 = 900, c2 = 950, a0 = 0, pn = p0, ph = 0;
    for (let i = 0, j = i0; i < len && j < N; i++, j++) { const u = i / SR;
      if ((i & 15) === 0) { c1 = 430 + 260 * Math.sin(u * 3.1) + 600 * Math.exp(-u * 7); c2 = 480 + 260 * Math.sin(u * 2.7 + 1) + 600 * Math.exp(-u * 7); a0 = sm(0, 0.006, u) * (0.75 + 0.7 * Math.exp(-u * 9)) * (1 - sm(dur - 0.3, dur + 0.5, u)) * (0.82 + 0.18 * Math.sin(u * 23)); pn = p0 + (p1 - p0) * clamp(u / dur, 0, 1); }
      const n1 = nz(), n2 = nz(); fl.p(n1, c1, 0.9); fr.p(n2, c2, 0.9); if (rnd() < 0.0011) sp = (0.5 + rnd()) * 0.5; sp *= 0.985; ph += (44 + 30 * Math.exp(-u * 8)) / SR;
      const ck = cr.p(n1) * sp * 0.3 * gain, h = hi.p(n2) * (0.09 + 1.2 * Math.exp(-u * 45)), th = Math.sin(TAU * ph) * Math.exp(-u * 6) * 0.9 * Math.min(1, u * 600) + Math.sin(TAU * (190 * u + 9 * (1 - Math.exp(-u * 30)))) * Math.exp(-u * 32) * 1.2, bd = gain * (0.7 + 0.3 * Math.exp(-u * 12)), yl = Math.tanh((fl.lp * 5.5 + h + th * 1.6) * a0) * bd, yr = Math.tanh((fr.lp * 5.5 + h + th * 1.6) * a0) * bd;      // whoomp, then the body of the flame
      L[j] += (yl + ck) * (1 - pn) * 1.2; R[j] += (yr + ck * 0.8) * pn * 1.2; const sv = (yl + yr) * 0.25 + ck * 0.4; S[j] += sv; S2[j] += sv * SW * (2 * pn - 1); } }
  // the tearing snap of lightning: an instant broadband edge and a scatter of smaller ones
  function crack(ts, pw, pan, tail = 0.016, nsub = 7, spread = 0.22, send = 0.5, re = 0) {      // re: a second, smaller edge this many seconds later (the re-strike the picture flashes)
    const i0 = ix(ts), len = Math.floor(SR * (Math.max(spread, re) + 0.3)), hl = bq('hp', 1500, 0.7), hr = bq('hp', 1700, 0.7), bl = bq('bp', 3300, 0.8), br = bq('bp', 2900, 0.8), lo = bq('lp', 380, 0.7), ev = [];
    for (let k = 0; k < nsub; k++) ev.push([Math.floor((0.014 + rnd() * spread) * SR), 0.2 + rnd() * 0.45]); if (re) ev.push([Math.floor(re * SR), 0.55]); ev.sort((a, b) => a[0] - b[0]);
    const d = Math.exp(-1 / (tail * SR)), d2 = Math.exp(-1 / (0.09 * SR)), gl = pw * (1 - pan) * 1.2, gr = pw * pan * 1.2; let e = 1, e2 = 1, p = 0;
    for (let i = 0, j = i0; i < len && j < N; i++, j++) { while (p < ev.length && i >= ev[p][0]) { e += ev[p][1]; e2 += ev[p][1] * 0.4; p++; }
      const n1 = nz(), n2 = nz(), low = lo.p(n1 + n2) * e2 * 0.9, yl = (hl.p(n1) * 0.6 + bl.p(n1) * 0.7) * e + low, yr = (hr.p(n2) * 0.6 + br.p(n2) * 0.7) * e + low;
      const sv = (yl + yr) * 0.5 * pw * send; L[j] += yl * gl; R[j] += yr * gr; S[j] += sv; S2[j] += sv * SW * (2 * pan - 1); e *= d; e2 *= d2; } }
  // two bodies meeting: sub thud, a punch of air, and scales clattering
  function slam(t, pw, pan) { const i0 = ix(t), len = Math.floor(SR * 0.9), lo = bq('lp', 520, 0.7), mid = svf(), hp = bq('hp', 1800, 0.7); let ph = 0, mc = 2200;
    for (let i = 0, j = i0; i < len && j < N; i++, j++) { const ti = i / SR, n = nz(); ph += (38 + 52 * Math.exp(-ti * 16)) / SR; if ((i & 15) === 0) mc = 700 + 1500 * Math.exp(-ti * 9); mid.p(n, mc, 0.8);
      const y = Math.tanh((Math.sin(TAU * ph) * Math.exp(-ti * 4.2) * sm(0.003, 0.03, ti) + lo.p(n) * Math.exp(-ti * 22) * 1.5) * 1.4) * 0.4 * pw, z = (mid.bp * (Math.exp(-ti * 7) * 0.55 + Math.exp(-ti * 60) * 0.8) + hp.p(n) * Math.exp(-ti * 45) * 0.6) * 0.45 * pw;
      L[j] += y + z * (1 - pan) * 1.6; R[j] += y + z * pan * 1.6; S[j] += y * 0.2 + z * 0.5; }
    for (let k = 0; k < 36; k++) tick(t + 0.003 + Math.pow(rnd(), 1.6) * 0.42, 1800 + rnd() * 5200, (0.10 + rnd() * 0.22) * pw, clamp(pan + (rnd() - 0.5) * 0.6, 0.05, 0.95)); }
  // rock shattering: a burst, a low boom, rubble rolling and two seconds of stones knocking down the face
  function rockBurst(t, pw, pan) { const i0 = ix(t), len = Math.floor(SR * 2.4), lo = bq('lp', 240, 0.7), md = bq('bp', 700, 0.6), hp = bq('hp', 2500, 0.7); let ph = 0, rm = 0;
    for (let i = 0, j = i0; i < len && j < N; i++, j++) { const ti = i / SR, n = nz(); ph += (42 + 30 * Math.exp(-ti * 14)) / SR; rm += (nz() - rm) * 0.002;
      const y = (Math.sin(TAU * ph) * Math.exp(-ti * 5) * Math.min(1, ti * 800) * 0.7 + md.p(n) * Math.exp(-ti * 16) * 1.3 + hp.p(n) * Math.exp(-ti * 50) * 0.6 + lo.p(n) * Math.exp(-ti * 1.7) * (0.3 + 22 * Math.abs(rm)) * 1.8 * sm(0.02, 0.2, ti)) * pw * 0.5;
      L[j] += y * (1 - pan) * 1.2; R[j] += y * pan * 1.2; S[j] += y * 0.4; S2[j] += y * 0.4 * SW * (2 * pan - 1); }
    for (let k = 0; k < 54; k++) { const dt = 0.03 + 2.0 * Math.pow(rnd(), 1.7); tick(t + dt, 420 + rnd() * rnd() * 4200, (0.10 + 0.26 * rnd()) * pw * (1 - dt / 2.2), clamp(pan + (rnd() - 0.5) * 0.6, 0.05, 0.95), 0.004 + rnd() * 0.012, 0.35); } }

  // the middle of an impact, where a small speaker can still hear it (300 Hz to 4 kHz): a crack (one broadband edge and four short knocks,
  // horn on horn) and a tear (a ratchet of noise grains, dense at first and running down, each grain somewhere else between the ears).
  // o: len (s), tear (level of the tear against the crack), knock (0..1), wet (1 = water: softer grains, lower band, no knocks), again (a second, smaller edge this many seconds later)
  function rip(t, pw, pan, o = {}) {
    const len = o.len || 0.42, tg = o.tear || 1, kn = o.knock === undefined ? 1 : o.knock, wet = o.wet ? 1 : 0, re = o.again ? Math.floor(o.again * SR) : -1, i0 = ix(t), n = Math.floor(SR * (len * 1.2 + 0.1));
    const hp = bq('hp', 320, 0.7), lp = bq('lp', wet ? 3300 : 4300, 0.7), gr = svf(), d1 = Math.exp(-1 / (0.012 * SR)), d2 = Math.exp(-1 / (0.11 * SR)), dg = Math.exp(-1 / ((wet ? 0.014 : 0.010) * SR));
    const K = [410, 730, 1180, 1990].map((f, k) => { const w = TAU * f * (0.94 + 0.12 * rnd()) / SR, r = Math.exp(-1 / ((0.036 - 0.006 * k) * SR)); return [2 * r * Math.cos(w), -r * r, 0, 0, Math.sin(w) / (1 + 0.5 * k)]; });
    let e1 = 1, e2 = 1, ge = 0, gf = 1500, gp = pan, next = Math.floor(0.003 * SR), gap = (wet ? 0.006 : 0.004) * SR;
    for (let i = 0, j = i0; i < n && j < N; i++, j++) { const n1 = nz(), n2 = nz(), hit = i === 0 ? 1 : i === re ? 0.6 : 0;
      if (hit && i) { e1 += 0.6; e2 += 0.3; }
      if (i >= next) { const u = i / SR / len; ge = (0.4 + 0.6 * rnd()) * Math.exp(-u * 1.8) * (1 - sm(0.85, 1.2, u)); gf = (wet ? 380 : 520) * Math.pow(wet ? 6.5 : 7.5, rnd()); gp = clamp(pan + (rnd() - 0.5) * 0.56, 0.06, 0.94); gap *= 1.03 + 0.07 * rnd(); next = i + Math.floor(gap * (0.6 + 0.8 * rnd())); }
      ge *= dg; e1 *= d1; e2 *= d2; gr.p(n2 * ge, gf, 2.0);
      let kk = 0; if (kn) for (let k = 0; k < 4; k++) { const m = K[k], y = m[0] * m[2] + m[1] * m[3] + hit; m[3] = m[2]; m[2] = y; kk += y * m[4]; }
      const y = Math.tanh((lp.p(hp.p(n1)) * (e1 * 1.5 + e2 * 0.9) * (i < 6 ? i / 6 : 1) + kk * 0.6 * kn) * 1.5) * pw, z = gr.bp * 2.6 * tg * pw;      // the edge is pressed here, so it arrives dense instead of driving the whole mix into the clipper
      L[j] += y * (1 - pan) * 1.2 + z * (1 - gp) * 1.2; R[j] += y * pan * 1.2 + z * gp * 1.2; S[j] += (y + z) * 0.3; }
  }
  // a body bursting out of water: a bright crown thrown up in an instant, the gulp of the hole it leaves, drops raining back. It moves from pan p0 to p1
  function gush(t, pw, p0, p1, f0) {
    const i0 = ix(t), n = Math.floor(SR * 0.95), h1 = bq('hp', 2500, 0.7), b1 = svf(), b2 = bq('bp', f0, 1.4); let g = 0, pn = p0, fc = 5000;
    for (let i = 0, j = i0; i < n && j < N; i++, j++) { const ti = i / SR, n1 = nz(), n2 = nz(); if ((i & 15) === 0) { pn = p0 + (p1 - p0) * sm(0.02, 0.8, ti); fc = 1300 + 4200 * Math.exp(-ti * 7); } g += (nz() - g) * 0.006; b1.p(n1, fc, 1.1);
      const on = ti < 0.0007 ? ti / 0.0007 : 1, y = (h1.p(n2) * (Math.exp(-ti * 30) * 1.4 + Math.exp(-ti * 6.5) * 0.5 * (0.4 + 9 * Math.abs(g))) + b1.bp * Math.exp(-ti * 11) * 1.3 + b2.p(n1) * Math.exp(-ti * 16) * 0.9) * on * (1 - sm(0.75, 0.95, ti)) * pw;
      L[j] += y * (1 - pn) * 1.2; R[j] += y * pn * 1.2; S[j] += y * 0.35; S2[j] += y * 0.35 * SW * (2 * pn - 1); }
    for (let k = 0; k < 16; k++) { const dt = 0.1 + 0.8 * Math.pow(rnd(), 1.3); tick(t + dt, 1500 + rnd() * 4500, (0.03 + 0.07 * rnd()) * pw * (1 - dt), clamp(p0 + (p1 - p0) * dt + (rnd() - 0.5) * 0.3, 0.05, 0.95), 0.002 + rnd() * 0.003, 0.4); }
  }

  // a group of sounds rendered on its own, pressed into a dense wall (soft clip) and put back into the mix
  function pressed(t0, t1, drive, level, fn, tone = 0) { const a = Math.max(0, ix(t0)), b = Math.min(N, ix(t1)), kl = L.slice(a, b), kr = R.slice(a, b), c = tone ? 1 - Math.exp(-TAU * tone / SR) : 1; let yl = 0, yr = 0; L.fill(0, a, b); R.fill(0, a, b); fn();
    for (let i = a; i < b; i++) { yl += (Math.tanh(L[i] * drive) * level - yl) * c; yr += (Math.tanh(R[i] * drive) * level - yr) * c; L[i] = yl + kl[i - a]; R[i] = yr + kr[i - a]; } }       // tone: a soft low-pass on the pressed sound (Hz)
  // levels, one per family of sound
  const X = { growl: 1.6, roar: 1.22, thunder: 1.8, air: 1.7, white: 1.75, slam: 1.9, rip: 1.9, fire: 1.65, bolt: 2.0, rock: 5.2, splash: 2.6, gush: 2.1, breath: 2.9, beam: 2.2, blast: 1.9, pearl: 1.6 };
  // ---- the valley: wind (the film's gusts plus the storm and the falls), waterfall, leaves
  { const wl = svf(), wr = svf(), fl = bq('lp', 4200, 0.7), fr = bq('lp', 4200, 0.7), fh = bq('hp', 240, 0.7), fh2 = bq('hp', 240, 0.7), rl = bq('bp', 4200, 0.8), rr = bq('bp', 4700, 0.8); let pl = 0, pr = 0, fc = 400, a = 0.1, wf = 0.03, ru = 0;
    for (let i = 0; i < N; i++) {
      if ((i & 63) === 0) { const t = i / SR, hush = 1 - 0.92 * win(t, R1 - 0.2, STR[0] + 0.06, 0.35, 0.06), l1 = Math.sin(t * 0.31) * 0.5 + Math.sin(t * 0.127 + 1) * 0.5;
        const dawn = 1 + 0.4 * (1 - sm(tE - 1.5, tE + 0.5, t)), g = Math.min(1.4, gustAt(t) + 0.5 * win(t, tDe - 0.5, tF + 1.2, 5, 1.5) + 0.95 * Math.pow(sm(tC2, tS - 0.1, t), 1.5) * (1 - sm(tS - 0.05, tS + 0.3, t)) + 1.0 * pulse(t, tBl + 0.04, 0.22, 1.4) + 0.2 * win(t, tFn, tG, 3, 3));
        fc = 330 + 170 * l1 + 620 * g; a = (0.14 + 0.50 * g) * hush * dawn; wf = 0.045 * (1 + 0.25 * Math.sin(t * 0.21)) * hush * dawn; ru = Math.max(0, g - 0.22) * (0.5 + 0.5 * Math.sin(t * 9.0 + Math.sin(t * 2.3) * 3)) * 0.075 * hush; }
      pl += (nz() - pl) * 0.2; pr += (nz() - pr) * 0.2; wl.p(pl, fc, 1.4); wr.p(pr, fc * 1.07, 1.4);
      const l = wl.bp * a + fh.p(fl.p(nz())) * wf + rl.p(nz()) * ru, r = wr.bp * a + fh2.p(fr.p(nz())) * wf + rr.p(nz()) * ru; L[i] += l; R[i] += r; S[i] += (l + r) * 0.12; } }
  lap('bed');
  // ---- EMERGE: a grunt on the beat that opens into a long growl, and the air the body moves
  bark(tE, 2.2 * X.growl, panR(tE), 240);
  voice(tE, tE + 4.8, t => { const u = t - tE; return [44 + 9 * Math.sin(u * 1.3) + 14 * Math.exp(-u * 5), (0.3 * Math.exp(-u * 3.5) + sm(0.05, 1.3, u)) * sm(0, 0.02, u) * (1 - sm(2.4, 4.8, u)) * 0.55, 0.12 + 0.12 * Math.sin(u * 2.1) + 0.2 * Math.exp(-u * 6)]; }, 1.75 * X.growl, panR);
  // (two cues were written for a loong that swept round the spire at EMERGE and hung in the air over it from DRUMS + 1.2 s. With the picture's own tables (EV) the body's air
  //  follows its real speed, and the long growl is a crouch that ends in the leap: both are under "the valley answers", below. They stay here for a page without that picture.)
  if (!(EV && EV.spd)) whoosh(tE + 0.15, tE + 4.4, u => 240 + 560 * Math.sin(Math.PI * u), u => Math.pow(Math.sin(Math.PI * u), 2), u => panR(tE + 0.15 + 4.25 * u), 1.2, 0.5 * X.air, 0.25, 0.5);
  if (tLeap < 0) voice(tD + 1.2, tD + 5.2, t => [50 + 10 * sm(tD + 1.2, tD + 4, t) - 8 * sm(tD + 4, tD + 5.2, t), win(t, tD + 1.2, tD + 5.2, 1.4, 1.8) * 0.42, 0.14 + 0.1 * Math.sin((t - tD) * 2.3)], 1.9 * X.growl, panR);
  // ---- CHARGE: air drawn in, pitch rising
  { const b = svf(), b2 = svf(), h = bq('hp', 3500, 0.7); let f1 = 260, f2 = 120; for (let i = ix(tC), e = ix(R0 + 0.05); i < e; i++) { const t = i / SR, u = (t - tC) / (R0 - tC), a = u * u * (1 - sm(0.965, 1.0, u)), n = nz(); if ((i & 15) === 0) { f1 = 260 + 2300 * u * u; f2 = 120 + 500 * u; } b.p(n, f1, 2.2); b2.p(n, f2, 1.5);
      const y = ((b.bp * 0.42 + b2.bp * 0.5 + h.p(n) * 0.05 * u) * a * 0.75 + Math.sin(TAU * (30 + 34 * u) * t) * a * 0.24) * 1.3; L[i] += y * 0.96; R[i] += y * 1.04; S[i] += y * 0.3; } }
  // ---- ROAR: attack bark, long open throat, falling growl; fire and a sub drop. It ends with the bar, so the valley can go quiet
  { const D = R1 - R0;
    pressed(R0 - 0.01, R1 + 0.4, 2.0, X.roar, () => {
    bark(R0, 3.2, panR(R0)); bark(R0, 2.0, panR(R0) + 0.05, 260);
    voice(R0, R1 + 0.3, t => { const u = t - R0, f = u < 0.2 ? 96 + 116 * sm(0, 0.2, u) : 212 - 70 * sm(0.35, 1.6, u) - 62 * sm(1.6, D + 0.3, u); return [f, sm(0, 0.008, u) * (1 - sm(D - 0.75, D + 0.05, u)) * (0.9 + 0.1 * Math.sin(u * 7)), 0.6 + 0.4 * sm(0, 0.15, u) * (1 - sm(D - 0.9, D + 0.2, u))]; }, 1.5, panR);
    voice(R0, R1 + 0.3, t => { const u = t - R0; return [(u < 0.2 ? 48 + 58 * sm(0, 0.2, u) : 106 - 35 * sm(0.35, 1.6, u) - 30 * sm(1.6, D + 0.3, u)) * 1.005, sm(0, 0.008, u) * (1 - sm(D - 0.6, D + 0.05, u)), 0.25 + 0.5 * sm(0, 0.4, u) * (1 - sm(2.0, D, u))]; }, 1.1, t => panR(t) - 0.07);
    fire(R0, D - 0.7, 0.7, panR(R0) - 0.03, panR(R1 - 0.7) + 0.03);
    for (let i = ix(R0), e = ix(R0 + 2.6); i < e; i++) { const u = i / SR - R0, y = Math.sin(TAU * (41 - 9 * sm(0, 1.5, u)) * u) * Math.exp(-u * 1.5) * 0.60 * sm(0, 0.01, u); L[i] += y; R[i] += y; } }); }
  lap('red');
  // ---- OMEN: thunder from high and far: a crack on each strike, a boom under it, and a roll that carries into the descent
  // It is built for whatever strike list the film exports. Flashes closer than 0.2 s are one bolt re-striking (one boom, one swell of the roll, a crack each);
  // crack power climbs to the last bolt; boom and roll are scaled so the passage is never louder than with the four default strikes; the roll is
  // kept out of the band the cracks live in, each crack's scatter ends before the next flash, and the roll is gone by DESCENT + 3 s whatever the list.
  { const keepSeed = seed, keepNs = ns; seed = 90210; ns = 4517;      // its own random stream: the rest of the film is the same sound for any strike list
    const nS = STR.length, PN = [0.56, 0.36, 0.64, 0.46], isHead = ts => ts.map((s, k) => k === 0 || s - ts[k - 1] >= 0.2);
    const plan = hd => { const nh = hd.filter(Boolean).length; let h = -1; return hd.map(b => { if (b) h++; return (nh > 1 ? 0.62 + 0.38 * h / (nh - 1) : 1) * (h > 0 && h < nh - 1 ? (h & 1 ? 1.12 : 0.9) : 1); }); };
    const head = isHead(STR), PW = plan(head), WR = PW.map((p, k) => head[k] ? p : p * 0.3), DW = plan(isHead(STR_DEF));
    const fadeR = t => 1 - sm(tDe + 0.4, tDe + 3, t), rollAt = (ts, ws, t) => { let ev = 0; for (let k = 0; k < ts.length; k++) ev += ws[k] * pulse(t, ts[k] + 0.03, 0.10, 1.5); return ev; };
    const measure = (ts, ws) => { let e = 0, pk = 0; for (let t = Math.min(ts[0], tO); t < tDe + 3; t += 0.02) { const v = rollAt(ts, ws, t) * fadeR(t); e += v * v; if (v > pk) pk = v; } return [e + 1e-9, pk + 1e-9]; };
    const sq = a => a.reduce((s, v) => s + v * v, 0), ref = measure(STR_DEF, DW), now = measure(STR, WR);
    const gRoll = Math.min(1, Math.sqrt(ref[0] / now[0]), ref[1] / now[1]), gBoom = Math.min(1, Math.sqrt(sq(DW) / sq(WR)));
    const capAt = t => { const w = sm(tDe - 0.4, tDe, t); return ref[1] * (1 - w) + rollAt(STR_DEF, DW, t) * w; };      // from DESCENT on, never above the roll of the default strikes
    const boom = (s, g) => { const i0 = ix(s); let ph = 0; for (let i = 0, n = Math.floor(SR * 1.4); i < n && i0 + i < N; i++) { const ti = i / SR; ph += (30 + 26 * Math.exp(-ti * 7)) / SR; const y = Math.sin(TAU * ph) * Math.exp(-ti * 3.2) * Math.min(1, ti * 300) * g; L[i0 + i] += y; R[i0 + i] += y; S[i0 + i] += y * 0.2; } };
    STR.forEach((s, k) => { const nx = k < nS - 1 ? STR[k + 1] : tDe > s + 0.05 ? tDe : s + 9, gap = nx - s, spread = clamp(gap - 0.13, 0.03, 0.22), late = 1 + 0.6 * sm(tDe - 1.2, tDe - 0.2, s) + (s > tDe - 0.05 ? 0.4 : 0);      // the scatter of small edges is over 0.1 s before the next flash; cracks grow as the white colour swells toward DESCENT
      crack(s, 0.56 * X.thunder * PW[k] * late, PN[k % 4], 0.016, Math.max(2, Math.round(7 * spread / 0.22)), spread, 0.5, gap >= 0.25 ? 0.11 : 0);
      boom(s, 0.42 * X.thunder * WR[k] * gBoom * (k ? Math.min(1, Math.sqrt((s - STR[k - 1]) / 0.45)) : 1)); });      // booms crowd less when the bolts come fast
    if (tDe > STR[nS - 1] + 0.05) { crack(tDe, 0.66 * X.thunder, 0.5, 0.016, 6, 0.2, 0.5, 0.11); if (tDe >= STR[nS - 1] + 0.4) boom(tDe, 0.2 * X.thunder * gBoom); }      // the cloud tears open: the picture's brightest flash
    const a = svf(), b = svf(), c = bq('bp', 330, 0.7), d = bq('bp', 290, 0.7), cl = bq('lp', 850, 0.7), dl = bq('lp', 850, 0.7), sh = bq('hp', 140, 0.7), t1 = Math.min(DUR, tDe + 3); let m1 = 0, m2 = 0, amp = 0, cut = 120;
    for (let i = Math.max(0, ix(STR[0])), e = ix(t1); i < e; i++) { if ((i & 63) === 0) { const t = i / SR, ev = Math.min(rollAt(STR, WR, t) * gRoll, capAt(t)); amp = ev * X.thunder * fadeR(t); cut = 80 + 170 * Math.min(1, ev); }
      m1 += (nz() - m1) * 0.0009; m2 += (nz() - m2) * 0.0009; const n1 = nz(), n2 = nz(); a.p(n1, cut, 0.9); b.p(n2, cut * 1.1, 0.9);
      // the weight of the roll is the same in both ears (it survives a mono speaker); its width is a side signal above 140 Hz and the two mid bands
      const g1 = amp * (0.45 + 42 * Math.abs(m1)), g2 = amp * (0.45 + 42 * Math.abs(m2)), lo = a.lp * 2.0 * g1, sd = sh.p(b.lp) * 2.1 * g2, l = lo + sd + cl.p(c.p(n1)) * 0.5 * g1, r = lo - sd + dl.p(d.p(n2)) * 0.5 * g2; L[i] += l * 1.05; R[i] += r * 0.95; S[i] += (l + r) * 0.3; }
    seed = keepSeed; ns = keepNs; }
  // ---- DESCENT: a far cry, and a long fall of air whose pitch drops as the white comes down
  voice(tDe + 0.15, tDe + 1.7, t => { const u = t - tDe - 0.15; return [240 + 170 * sm(0, 0.3, u) - 120 * sm(0.4, 1.5, u), sm(0, 0.08, u) * (1 - sm(0.5, 1.5, u)) * 0.5, 0.7]; }, 0.62, panW, WHT_V, 1.2);
  whoosh(tDe, tF - 0.05, u => 2600 * Math.pow(300 / 2600, u), u => Math.pow(sm(0, 0.9, u), 1.6) * (1 - sm(0.93, 1, u)), u => panW(tDe + u * (tF - 0.05 - tDe)), 3.4, 0.8 * X.air, 0.3, 0.2);
  whoosh(tDe + 1, tF - 0.05, u => 5200 * Math.pow(900 / 5200, u), u => Math.pow(sm(0, 0.9, u), 2) * (1 - sm(0.93, 1, u)), u => 0.5 + 0.5 * (panW(tDe + 1 + u * (tF - 1.05 - tDe)) - 0.5), 1.2, 0.22 * X.air, 0.3);
  // ---- FACEOFF: growls from both, left and right
  voice(tF + 0.2, tF + 1.9, t => [58 + 12 * Math.sin((t - tF) * 3.1), win(t, tF + 0.2, tF + 1.9, 0.4, 0.7) * 0.62, 0.2 + 0.15 * Math.sin((t - tF) * 5)], 0.9 * X.growl, panR);
  voice(tF + 1.3, tF + 2.95, t => [128 + 22 * Math.sin((t - tF) * 4.3), win(t, tF + 1.3, tF + 2.95, 0.4, 0.5) * 0.6, 0.3 + 0.2 * Math.sin((t - tF) * 6.1)], 1.1 * X.growl, panW, WHT_V);
  // ---- WROAR: a different animal: a rising shriek with ice in it, static crackling round it, frost hissing after; red snarls back
  { const D = W1 - W0, lvl = u => sm(0, 0.03, u) * (1 - sm(D - 0.5, D + 0.1, u)) * (0.88 + 0.12 * Math.sin(u * 11));
    pressed(W0 - 0.005, W1 + 0.25, 2.2, X.white, () => { bark(W0, 1.1, panW(W0), 1500);
    voice(W0, W1 + 0.2, t => { const u = t - W0; return [150 + 290 * sm(0, 0.3, u) - 130 * sm(0.5, 1.5, u) - 90 * sm(1.5, D, u), lvl(u), 0.4 + 0.6 * sm(0, 0.2, u) * (1 - sm(D - 0.6, D, u))]; }, 1.05, panW, WHT_V);
    voice(W0, W1 + 0.2, t => { const u = t - W0; return [(150 + 290 * sm(0, 0.3, u) - 130 * sm(0.5, 1.5, u) - 90 * sm(1.5, D, u)) * 1.498, lvl(u) * 0.8, 0.8]; }, 0.5, t => panW(t) + 0.06, WHT_V);
    voice(W0, W1, t => { const u = t - W0; return [70 + 40 * sm(0, 0.3, u) - 30 * sm(0.6, D, u), lvl(u) * (1 - sm(1.2, 1.5, u)), 0.3]; }, 0.5, t => 0.5 + 0.6 * (panW(t) - 0.5)); }, 3200);
    // ice: high partials that flicker independently; frost: a hiss that outlasts the cry
    const pIce = panW(W0 + 0.8), fq = [3120, 4270, 5230, 6610, 7930, 9340], ph = fq.map(() => rnd() * TAU), am = fq.map(() => rnd() * TAU), ar = fq.map(() => 9 + rnd() * 9), h1 = bq('hp', 6000, 0.7), h2 = bq('hp', 6500, 0.7);
    for (let i = ix(W0), e = ix(W1 + 0.9); i < e; i++) { const u = i / SR - W0, a = lvl(u), fa = (sm(0, 0.05, u) * (1 - sm(D - 0.2, D + 0.85, u))); let y = 0; for (let k = 0; k < 6; k++) { ph[k] += TAU * fq[k] * (1 + 0.02 * sm(0, 0.4, u)) / SR; am[k] += TAU * ar[k] / SR; y += Math.sin(ph[k]) * (0.5 + 0.5 * Math.sin(am[k])) / (1 + k * 0.35); }
      y *= a * 0.045 * X.white; const l = y + h1.p(nz()) * fa * 0.05 * X.white, r = y + h2.p(nz()) * fa * 0.05 * X.white; L[i] += l * (1 - pIce) * 2.1; R[i] += r * pIce * 2.1; S[i] += (l + r) * 0.4; }
    for (let t = W0; t < W1 + 0.3;) { const u = t - W0; tick(t, 3000 + rnd() * 5000, (0.05 + 0.12 * rnd()) * (0.7 + 0.6 * lvl(u)) * X.white, clamp(pIce + (rnd() - 0.5) * 0.5, 0.05, 0.95), 0.0012, 0.3); t += (0.3 + 1.4 * rnd()) / 85; }
    crack(W0, 0.5 * X.white, panW(W0), 0.012, 4, 0.1);
    voice(W0 + 1.6, W0 + 2.65, t => { const u = t - W0 - 1.6; return [88 + 60 * sm(0, 0.12, u) - 50 * sm(0.2, 0.95, u), sm(0, 0.03, u) * (1 - sm(0.5, 1.0, u)), 0.7 * sm(0, 0.1, u)]; }, 1.9 * X.growl, panR); bark(W0 + 1.6, 1.1 * X.growl, panR(W0 + 1.6), 300); }
  // a rush of air sucked into the first collision
  whoosh(tC1 - 0.85, tC1, u => 300 + 3000 * u * u, u => u * u * (1 - sm(0.9, 1, u)), u => 0.5, 1.6, 0.4 * X.air, 0.3);
  lap('white');
  // ---- CLASH1, FIRE2, BOLT, CLASH2
  slam(tC1, 0.74 * X.slam, panX(axis('clash1', 0))); rip(tC1, 1.9 * X.rip, panX(axis('clash1', 0)), { len: 0.4, tear: 2.8 });
  voice(tC1 + 0.05, tC1 + 0.9, t => { const u = t - tC1 - 0.05; return [96 + 50 * sm(0, 0.1, u) - 40 * sm(0.2, 0.8, u), sm(0, 0.03, u) * (1 - sm(0.35, 0.85, u)), 0.6]; }, 0.75 * X.growl, panR);
  voice(tC1 + 0.12, tC1 + 0.95, t => { const u = t - tC1 - 0.12; return [230 + 110 * sm(0, 0.1, u) - 90 * sm(0.2, 0.8, u), sm(0, 0.03, u) * (1 - sm(0.35, 0.8, u)), 0.7]; }, 0.5 * X.growl, panW, WHT_V);
  whoosh(tC1 + 1.4, tC1 + 4.3, u => 500 + 900 * Math.sin(Math.PI * u), u => Math.pow(Math.sin(Math.PI * u), 2), u => panR(tC1 + 1.4 + 2.9 * u), 1.3, 0.2 * X.air, 0.25, 0.4);    // the chase wheels round the spire: each body's air where that body is
  whoosh(tC1 + 1.5, tC1 + 4.4, u => 800 + 1300 * Math.sin(Math.PI * u), u => Math.pow(Math.sin(Math.PI * u), 2), u => panW(tC1 + 1.5 + 2.9 * u), 1.3, 0.16 * X.air, 0.25, 0.2);
  { const p0 = panR(tFi), p1 = panR(tFi + 1.6); fire(tFi, 1.6, X.fire, p0, clamp(p1 + 0.6 * (p1 - p0), 0.1, 0.9)); }      // the flame runs the way the head sweeps, and on past it
  voice(tFi - 0.02, tFi + 1.7, t => { const u = t - tFi; return [90 + 70 * sm(0, 0.2, u) - 50 * sm(0.5, 1.6, u), sm(-0.02, 0.05, u) * (1 - sm(1.1, 1.7, u)) * 0.8, 0.5 + 0.4 * sm(0, 0.2, u)]; }, 0.7 * X.growl, panR);
  const HITT = PIC.hit === +PIC.hit && PIC.hit > 0 && PIC.hit < 1 ? PIC.hit : 0.12, pB0 = panW(tBo), pB1 = panX(axis('boltHit', -0.5));      // the bolt's flight time in the picture (HIT in 70_fx.js: 0.12 s); it flies from white's mouth to the rock
  crack(tBo, 0.78 * X.bolt, pB0, 0.012, 5, 0.09, 0.4);
  { const i0 = ix(tBo), h = bq('hp', 900, 0.7); let ph = 0, p2 = 0;       // the bolt itself: a buzzing fall of pitch
    for (let i = 0, n = Math.floor(SR * 0.36); i < n; i++) { const ti = i / SR; ph += (180 + 3400 * Math.exp(-ti * 14)) / SR; if (ph >= 1) ph -= 1; p2 += 118 / SR; if (p2 >= 1) p2 -= 1;
      const y = h.p((ph < 0.5 ? 1 : -1) * (p2 < 0.35 ? 1 : 0.15) + nz() * 0.6) * Math.exp(-ti * 9) * Math.min(1, ti * 3000) * 0.21 * X.bolt, pn = pB0 + (pB1 - pB0) * Math.min(1, ti / HITT); L[i0 + i] += y * (1 - pn) * 1.2; R[i0 + i] += y * pn * 1.2; S[i0 + i] += y * 0.4; } }
  rockBurst(tBo + HITT, 1.0 * X.rock, pB1);
  slam(tC2, 1.15 * X.slam, panX(axis('clash2', 0))); rip(tC2, 1.7 * X.rip, panX(axis('clash2', 0)), { len: 0.62, again: 0.085, tear: 2.5 });      // the bite: two edges, and a longer tear as they lock
  voice(tC2 + 0.04, tC2 + 1.5, t => { const u = t - tC2 - 0.04; return [100 + 60 * sm(0, 0.12, u) - 50 * sm(0.3, 1.4, u) + 8 * Math.sin(u * 31), sm(0, 0.03, u) * (1 - sm(0.7, 1.45, u)), 0.75]; }, 0.9 * X.growl, panR);
  voice(tC2 + 0.1, tC2 + 1.6, t => { const u = t - tC2 - 0.1; return [250 + 130 * sm(0, 0.12, u) - 110 * sm(0.3, 1.4, u) + 14 * Math.sin(u * 37), sm(0, 0.03, u) * (1 - sm(0.7, 1.5, u)), 0.8]; }, 0.62 * X.growl, panW, WHT_V);
  // the fall: two bodies grinding together, snarls passing left and right
  whoosh(tC2 + 0.3, tS, u => 380 + 500 * u + 120 * Math.sin(u * 40), u => (0.35 + 0.65 * u) * sm(0, 0.1, u) * (1 - sm(0.985, 1, u)) * (0.6 + 0.4 * Math.sin(u * 150)), u => 0.5 + 0.2 * Math.sin(u * 9), 2.2, 0.5 * X.air, 0.2, 0.3);
  voice(tC2 + 2.2, tC2 + 3.6, t => [80 + 20 * Math.sin((t - tC2) * 9), win(t, tC2 + 2.2, tC2 + 3.6, 0.2, 0.6) * 0.8, 0.5], 1.1 * X.growl, panR);
  voice(tC2 + 3.6, tC2 + 5.0, t => [210 + 40 * Math.sin((t - tC2) * 11), win(t, tC2 + 3.6, tC2 + 5.0, 0.2, 0.6) * 0.8, 0.6], 0.85 * X.growl, panW, WHT_V);
  lap('fight');
  // ---- SPLASH: a low boom, the body of water thrown up, spray hissing down for three seconds
  { const i0 = ix(tS), len = Math.floor(SR * 3.8), bl = bq('bp', 900, 0.5), br = bq('bp', 1100, 0.5), hl = bq('hp', 3200, 0.7), hr = bq('hp', 3600, 0.7), ll = bq('lp', 300, 0.7), s1 = bq('hp', 300, 0.7), s2 = bq('hp', 330, 0.7), s3 = bq('lp', 4300, 0.7), s4 = bq('lp', 4000, 0.7); let ph = 0, g1 = 0, g2 = 0;
    const bal = clamp(0.5 + 0.5 * axis('splash', 0), 0.3, 0.7), wl = (1 - bal) * 2, wr = bal * 2;      // the water leans to where the knot goes in
    for (let i = 0, j = i0; i < len && j < N; i++, j++) { const ti = i / SR, n1 = nz(), n2 = nz(); ph += (30 + 34 * Math.exp(-ti * 5)) / SR; g1 += (nz() - g1) * 0.004; g2 += (nz() - g2) * 0.004;
      const boom = Math.tanh(((Math.sin(TAU * ph) * 0.85 + 0.4 * Math.sin(2 * TAU * ph + 0.6)) * Math.exp(-ti * 2.6) * Math.min(1, ti * 500) + ll.p(n1 + n2) * Math.exp(-ti * 6) * 1.2) * 1.3) * 0.4, eb = (Math.exp(-ti * 5.5) * Math.min(1, ti * 500) + 0.3 * Math.exp(-ti * 1.6) * sm(0, 0.15, ti)) * 1.5, sl = (Math.exp(-ti * 55) * 2.0 + Math.exp(-ti * 8) * 1.1) * (i < 8 ? i / 8 : 1);      // sl: the slap of the surface, the hard middle of the hit
      const es = (Math.exp(-ti * 1.15) * sm(0, 0.015, ti) * 0.8 + 0.5 * Math.exp(-Math.pow((ti - 0.75) / 0.45, 2))) * (1 - sm(3.2, 3.8, ti));
      const l = (boom + (bl.p(n1) * eb * 0.8 + s3.p(s1.p(n1)) * sl * 0.9 + hl.p(n1) * es * (0.5 + 9 * Math.abs(g1)) * 0.2) * wl) * X.splash, r = (boom + (br.p(n2) * eb * 0.8 + s4.p(s2.p(n2)) * sl * 0.9 + hr.p(n2) * es * (0.5 + 9 * Math.abs(g2)) * 0.2) * wr) * X.splash; L[j] += l; R[j] += r; S[j] += (l + r) * 0.22; }
    rip(tS, 1.3 * X.rip, bal, { len: 0.4, wet: 1, knock: 0, tear: 2.6 });      // a sheet of water tearing
    for (let k = 0; k < 40; k++) { const dt = 0.25 + 2.6 * Math.pow(rnd(), 1.4); tick(tS + dt, 1200 + rnd() * 3800, (0.04 + 0.1 * rnd()) * (1 - dt / 3) * X.splash, 0.1 + 0.8 * rnd(), 0.003 + rnd() * 0.004, 0.4); } }
  // the two burst out of the lake again (P.pic.exits: the picture's own crowns): shorter and brighter than the dive, one to each side, each dragging air up after it
  { const ex = PIC.exits || [], dflt = [tS + 0.66, tS + 0.61];
    for (let k = 0; k < 2; k++) { const sd = k ? 1 : -1, e = ex[k] && ex[k].t === +ex[k].t && ex[k].t > tS && ex[k].t < tBe - 1.6 ? ex[k] : HX ? null : { t: dflt[k], x: 0.02 * sd }; if (!e) continue;      // no dive in the picture: no burst in the sound
      const who = k ? panW : panR, p0 = clamp(panX(e.x === +e.x ? e.x : 0, sd) + 0.16 * sd, 0.12, 0.88), p1 = who(e.t + 0.9);
      gush(e.t, (k ? 0.85 : 1) * X.gush, p0, p1, k ? 980 : 620);
      whoosh(e.t + 0.03, e.t + 1.5, u => (k ? 900 : 520) * (1 + 1.6 * u), u => Math.pow(1 - u, 1.4) * sm(0, 0.06, u), u => who(e.t + 0.03 + 1.47 * u), 1.4, 0.3 * X.air, 0.3, k ? 0 : 0.3); } }
  // spent breath left and right, a growl each, and air drawn toward the beam
  const breath = (t, d, f, pan, g) => { whoosh(t, t + d * 0.42, u => f * (0.8 + 0.5 * u), u => Math.pow(Math.sin(Math.PI * u), 1.5) * 0.6, u => pan, 1.4, g, 0.3); whoosh(t + d * 0.45, t + d, u => f * (1.4 - 0.6 * u), u => Math.pow(Math.sin(Math.PI * Math.sqrt(u)), 1.5), u => pan, 1.2, g, 0.3, 0.2); };
  breath(tS + 0.9, 1.5, 520, panR(tS + 1.6), 0.2 * X.breath); breath(tS + 1.7, 1.4, 2300, panW(tS + 2.4), 0.13 * X.breath); breath(tS + 2.7, 1.5, 500, panR(tS + 3.4), 0.18 * X.breath); breath(tS + 3.5, 1.4, 2200, panW(tS + 4.2), 0.12 * X.breath);
  voice(tS + 2.3, tS + 4.1, t => [52 + 8 * Math.sin((t - tS) * 2.7), win(t, tS + 2.3, tS + 4.1, 0.5, 0.8) * 0.6, 0.16], 1.1 * X.growl, panR);
  voice(tS + 3.5, tS + 5.3, t => [118 + 16 * Math.sin((t - tS) * 3.3), win(t, tS + 3.5, tS + 5.3, 0.5, 0.8) * 0.6, 0.28], 0.78 * X.growl, panW, WHT_V);
  whoosh(tBe - 2.6, tBe, u => 260 * Math.pow(18, u), u => u * u * (1 - sm(0.9, 1, u)), u => 0.5, 2.0, 0.5 * X.air, 0.3);
  // ---- BEAM: fire from the left, frost and lightning from the right, and the ball between them humming upward
  { const E = CUT, D = E - tBe, sd = scrR(tBe + 2) <= scrW(tBe + 2) ? 0.4 : -0.4, fl = svf(), fr = svf(), jl = bq('bp', 3300, 0.5), jh = bq('hp', 6800, 0.7), bz = bq('hp', 1500, 0.7), hl = bq('lp', 1600, 0.7), rs = svf(), i0 = ix(tBe), i1 = ix(E); let a = 0, c1 = 600, c2 = 650, fk = 1, p1 = 0, p2 = 0, pb = 0, hc = 1000, pm = 0, rf = 300, thp = 0;
    for (let i = i0; i < i1; i++) { const ti = (i - i0) / SR, u = ti / D;
      if ((i & 15) === 0) { a = sm(0, 0.012, ti) * (0.62 + 0.38 * u * u + 0.5 * Math.exp(-ti * 8)) * (1 - sm(D - 0.008, D, ti)); c1 = 520 + 260 * Math.sin(ti * 3.1) + 500 * u; c2 = 570 + 260 * Math.sin(ti * 2.7 + 1) + 500 * u; if ((i & 1023) === 0) fk = 0.7 + 0.3 * rnd(); rf = 300 * Math.pow(9, u); }
      const n1 = nz(), n2 = nz(), n3 = nz(); fl.p(n1, c1, 0.9); fr.p(n2, c2, 0.9); pb += 118 / SR; if (pb >= 1) pb -= 1;
      const fireL = (fl.lp * 1.1 + fr.lp * 0.4) * (0.82 + 0.18 * Math.sin(ti * 23)), frostR = (jl.p(n3) * 0.4 + jh.p(n3) * 0.2) * fk + bz.p(pb < 0.3 ? 1 : -0.4) * 0.14 * fk;
      const hf = 82 * Math.pow(2, 2.25 * Math.pow(u, 1.3)); pm += TAU * (8 + 18 * u) / SR; const fmv = 1 + 0.012 * (1 + 3 * u) * Math.sin(pm); p1 += hf * fmv / SR; if (p1 >= 1) p1 -= 1; p2 += hf * 1.012 * fmv / SR; if (p2 >= 1) p2 -= 1;
      const hum = hl.p(saw(p1, hf / SR) + saw(p2, hf * 1.012 / SR)) * (0.15 + 0.85 * u) * 0.22; rs.p(n1 + n2, rf, 3.0); const ris = rs.bp * u * u * 0.22; thp += (40 + 30 * Math.exp(-ti * 9)) / SR; const th = Math.sin(TAU * thp) * Math.exp(-ti * 5) * 0.5 * Math.min(1, ti * 600);
      const l = (fireL * 0.55 * (1 + sd) + frostR * 0.13 * (1 - sd) + hum + ris + th) * a * X.beam, r = (fireL * 0.55 * (1 - sd) + frostR * 0.13 * (1 + sd) + hum + ris + th) * a * X.beam; L[i] += l; R[i] += r; S[i] += (l + r) * 0.22; }
    voice(tBe, E, t => { const u = (t - tBe) / D; return [120 + 60 * u, sm(0, 0.04, t - tBe) * (0.6 + 0.3 * u) * (1 - sm(E - 0.01, E, t)), 0.7 + 0.3 * u]; }, 0.75 * X.growl, panR);
    voice(tBe, E, t => { const u = (t - tBe) / D; return [290 + 150 * u, sm(0, 0.04, t - tBe) * (0.6 + 0.3 * u) * (1 - sm(E - 0.01, E, t)), 0.7 + 0.3 * u]; }, 0.5 * X.growl, panW, WHT_V);
    for (let t = tBe + 0.05; t < E - 0.02;) { const u = (t - tBe) / D; tick(t, 2200 + rnd() * 6000, (0.04 + 0.10 * rnd()) * (0.4 + 0.6 * u) * X.beam, 0.2 + 0.6 * rnd(), 0.0015 + rnd() * 0.002, 0.3); t += (0.3 + 1.4 * rnd()) / (6 + 110 * u * u); } }
  lap('beam');
  // ---- BLAST: sub drop, a wall of noise as wide as the room, a long tail; and what it leaves behind: the pearl, ringing high into the finale
  { const i0 = ix(tBl), len = Math.min(N - i0, Math.floor(SR * 7)), bl = svf(), br = svf(), tl = bq('lp', 1700, 0.7), tr2 = bq('lp', 1900, 0.7), ck1 = bq('hp', 3000, 0.7), ck2 = bq('hp', 3400, 0.7); let ph = 0, cut = 12000;
    for (let i = 0; i < len; i++) { const ti = i / SR, n1 = nz(), n2 = nz(); ph += (34 + 62 * Math.exp(-ti * 3.2)) / SR; if ((i & 15) === 0) cut = 420 + 4200 * Math.exp(-ti * 4.5) + 1700 * Math.exp(-ti * 1.2);
      const sub = (Math.sin(TAU * ph) * 0.8 + 0.4 * Math.sin(2 * TAU * ph) * Math.exp(-ti * 2.5)) * Math.exp(-ti * 2.0) * Math.min(1, ti * 900), eb = (Math.exp(-ti * 2.0) + 0.3 * Math.exp(-ti * 0.7)) * 1.6, et = Math.exp(-ti / 1.25) * sm(0.03, 0.4, ti) * 0.5, ec = Math.exp(-ti * 40) * 0.5, sb = Math.tanh(sub * 2.9) * 0.68;      // the low wave is pressed on its own, so it no longer gates the wall of noise
      bl.p(n1, cut, 0.8); br.p(n2, cut, 0.8); const j = i0 + i, l = (sb + Math.tanh((bl.lp * eb * 1.5 + ck1.p(n1) * ec) * 3.2) * 0.72 + tl.p(n1) * et) * X.blast, r = (sb + Math.tanh((br.lp * eb * 1.5 + ck2.p(n2) * ec) * 3.2) * 0.72 + tr2.p(n2) * et) * X.blast;
      L[j] += l; R[j] += r; S[j] += (l + r) * 0.2; }
    crack(tBl, 0.6 * X.thunder, 0.5, 0.02, 8, 0.3, 0.5); rip(tBl + 0.012, 0.75 * X.rip, 0.5, { len: 1.15, knock: 0.6, tear: 1.6 });      // the edge of the shock, and the air and stone it tears on its way out
    const t1 = Math.min(DUR, tG + 1.6), fqs = [1568, 1975.5, 2349.3, 3136, 3951, 4698.6], osc = [];
    fqs.forEach((f, k) => { for (const df of [0, 1.3 + k * 0.6]) { const w = TAU * (f + df) / SR, a0 = rnd() * TAU; osc.push([Math.cos(w), Math.sin(w), Math.cos(a0), Math.sin(a0), 1 / (1 + k * 0.45), k & 1 ? 0.35 : 0.65, k === 1 || k === 4 ? 1 : 0]); } });
    let env = 0, envB = 0, eA = 0, eB = 0; for (let i = i0, e = ix(t1); i < e; i++) { if ((i & 31) === 0) { const t = i / SR, u = t - tBl, bar = t < tFn ? 9 : (t - tFn) % 3, edge = sm(0, 0.004, u) * (1 - sm(tG - 0.5, t1, t)) * 0.018 * X.pearl, hit = 0.9 * Math.exp(-u * 1.3);
        env = (hit + 1.45 * sm(0.3, 2.2, u) * (0.8 + 0.2 * Math.sin(u * 2.1)) * (1 + 1.1 * Math.exp(-bar / 0.55))) * edge; envB = (hit + 0.9 * sm(tG - 1.5, tG + 0.2, t)) * edge; }
      eA += (env - eA) * 0.004; eB += (envB - eB) * 0.004; let l = 0, r = 0; for (let k = 0; k < osc.length; k++) { const o = osc[k], x = o[2] * o[0] - o[3] * o[1]; o[3] = o[2] * o[1] + o[3] * o[0]; o[2] = x; const v = o[3] * o[4] * (o[6] ? eB : eA); l += v * (1 - o[5]); r += v * o[5]; }
      L[i] += l; R[i] += r; S[i] += (l + r) * 0.6; } }
  // the air the pair move as they climb away, and the eaves ringing after each blow of wind
  whoosh(tFn + 0.4, tFn + 5, u => 420 + 700 * Math.sin(Math.PI * u), u => Math.pow(Math.sin(Math.PI * u), 2), u => 0.25 + 0.5 * u, 1.2, 0.2, 0.25, 0.4);
  whoosh(tG - 3.4, tG + 0.6, u => 500 + 1500 * u, u => Math.pow(Math.sin(Math.PI * u), 2), u => 0.6 - 0.2 * u, 1.3, 0.2, 0.3);
  // GONG: the cloud takes the two (P.pic.cloud: each loong's own vanishing): a soft breath drawn in after each and shut off as it goes; then the rift closes with one low thump
  { const c = PIC.cloud || {}, ok = a => a && a[0] === +a[0] && a[1] === +a[1] && a[0] > tG - 1.2 && a[1] < END - 0.3, cw = ok(c.w) ? c.w : [tG + 1.2, tG + 1.8], cr = ok(c.r) ? c.r : [tG + 1.2, tG + 1.8];
    const fadeAt = t => 1 - sm(tOut - 0.7, END - 0.05, t);      // the master's closing fade: what happens inside it is lifted by what the fade takes
    const inhale = (te, f0, f1, pan, g) => { const t0 = te - clamp(te - tG - 0.3, 0.6, 1.6); g /= Math.max(0.45, fadeAt(te - 0.1)); whoosh(t0, te, u => f0 * Math.pow(f1 / f0, u * u), u => Math.pow(u, 2.2) * (1 - sm(0.94, 1, u)), u => pan, 2.2, g, 0.5, 0.15); whoosh(t0 + (te - t0) * 0.35, te, u => 2.4 * f0 * Math.pow(f1 / f0, u), u => Math.pow(u, 3) * (1 - sm(0.95, 1, u)), u => pan, 1.2, g * 0.45, 0.5); };      // it lasts as long as the cloud takes to swallow the body (the heads go in at GONG) and shuts off when the tail is through
    let tw = cw[1]; const tr = cr[1]; if (Math.abs(tw - tr) < 0.35) tw = Math.min(tw, Math.max(cw[0] + 0.12, tr - 0.5));      // they go in side by side: white, who leads, is swallowed first
    inhale(tw, 620, 3000, panX(scrW(tw - 0.4), 1.6), 1.25 * X.air); inhale(tr, 300, 1500, panX(scrR(tr - 0.4), -1.6), 1.5 * X.air);
    const ts = clamp(c.shut === +c.shut ? c.shut : tG + 2.75, tG + 0.8, END - 0.75), comp = 1 / Math.max(0.3, fadeAt(ts + 0.06));
    whoosh(ts - 0.5, ts, u => 1100 * Math.pow(0.22, u), u => u * u * (1 - sm(0.93, 1, u)), u => 0.5, 1.6, 0.16 * X.air * comp, 0.4, 0.3);
    { const i0 = ix(ts), n = Math.floor(SR * 0.7), lo = bq('lp', 300, 0.7); let ph = 0;
      for (let i = 0, j = i0; i < n && j < N; i++, j++) { const ti = i / SR; ph += (44 + 34 * Math.exp(-ti * 20)) / SR;
        const y = ((Math.sin(TAU * ph) + 0.3 * Math.sin(TAU * ph * 3)) * Math.exp(-ti * 7.5) * Math.min(1, ti * 300) + lo.p(nz()) * Math.exp(-ti * 24) * 2.2) * 0.42 * comp; L[j] += y; R[j] += y; S[j] += y * 0.3; } } }
  for (const [t, m, p] of [[R0 + 0.9, 82, 0.75], [R0 + 1.3, 86, 0.2], [R0 + 1.9, 79, 0.6], [tC1 + 0.7, 86, 0.2], [tS + 0.9, 84, 0.7], [tS + 1.6, 79, 0.25], [tBl + 0.5, 91, 0.3], [tBl + 0.8, 86, 0.75], [tBl + 1.2, 94, 0.5]]) bell(t, m, 0.42, p);
  lap('blast');

  // ================= the valley answers =================
  // What the played picture does besides the two heads, each sound placed by the picture's own tables (EV = P.pic.ev, read once at load by
  // Score.world from the modules that draw these things): rock under the body, the leap, the air of the dive, crowns thrashed and blown
  // through, wings, the lake taking 170 m of body and giving it back, its rings on the shore, the falls, the fronts of the wind, hung
  // things, the sleeping breath, the storm's cold wind, the insects of the dusk.
  // (It is a function of its own, and so is each of its long loops: the engine compiles a function with a hot loop only while that function is small.)
  if (P.stem === 'new') { L.fill(0); R.fill(0); S.fill(0); S2.fill(0); }
  function valley() {
    let qa = 24680, qb = 1357911;      // these sounds have their own noise (nq) and their own dice (rq): nothing older moves when one of them changes
    const nq = () => { qa = (Math.imul(qa, 1664525) + 1013904223) | 0; return qa * 4.656612873077393e-10; }, rq = () => { qb = (qb + 0x6D2B79F5) | 0; let t = Math.imul(qb ^ qb >>> 15, 1 | qb); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    // In the long loops below the noise is a function of the sample's own number (nh: -1..1, uh: 0..1, k: which stream), not the next value of a stream:
    // a loop may then skip the stretches where its sound is silent, and what it plays afterwards is the same whatever it skipped
    const hs = (i, k) => { let x = Math.imul((i + Math.imul(k, 0x632BE5AB)) | 0, 0x9E3779B1 | 0); x ^= x >>> 15; x = Math.imul(x, 0x85EBCA6B | 0); x ^= x >>> 13; x = Math.imul(x, 0xC2B2AE35 | 0); return x ^ x >>> 16; };
    const nh = (i, k) => hs(i, k) * 4.656612873077393e-10, uh = (i, k) => (hs(i, k) >>> 0) / 4294967296;
    // levels, one per family of sound
    const Y = { scrape: 0.78, stone: 1.6, leap: 0.7, air: 0.7, rustle: 0.26, thrash: 0.6, dove: 0.75, egret: 1.1, hit: 0.42, rush: 0.85, shed: 0.16, slap: 1.0, rear: 0.8, wash: 0.75, falls: 1.0, gust: 0.32, storm: 0.12, bugs: 0.1, knock: 0.3, cloth: 1.0, breath: 0.7 };
    if (P.solo) { const keep = String(P.solo).split(','); for (const k of Object.keys(Y)) if (keep.indexOf(k) < 0) Y[k] = 0; }      // QA: one family of sound alone (?solo=rush,shed)
    const put = (i, y, p, send) => { L[i] += y * (1 - p) * 1.2; R[i] += y * p * 1.2; S[i] += y * send; S2[i] += y * send * SW * (2 * p - 1); };
    const rockPan = t => panX(tab(EV.scx, EHz, t));      // where on screen the rock is that the red loong lies on
    // ---- scales on stone: wherever the body lies on rock and moves. Each scale edge that lets go is a click (one every 0.32 m of slide: a slow
    //      ratchet while it creeps, a rasp as it slides, a zip when 170 m of it streams off the summit); under it the grind of its weight ----
    if (EV.spd && EV.seat) (() => { const b = svf(), lo = bq('lp', 190, 0.7), hp = bq('hp', 700, 0.7), dk = Math.exp(-1 / (0.004 * SR)); let a = 0, at = 0, ph = 0, rate = 10, fc = 1200, p = 0.5, tk = 0;
      for (let i = 0; i < N; i++) {
        if ((i & 31) === 0) { const t = i / SR, v = Math.abs(tab(EV.spd, EHz, t)), st = tab(EV.seat, EHz, t); fc = 1000 + 30 * Math.min(v, 60); at = st > 0.004 && v > 0.25 ? Math.min(1, Math.pow(v / 9, 0.6)) * Math.min(1, st * 1.6) * Math.sqrt(1400 / fc) * Y.scrape : 0; rate = v / 0.32 / SR; p = rockPan(t); }
        a += (at - a) * 0.003; if (a < 2e-5) continue;
        ph += rate; if (ph >= 1) { ph -= 1; tk = 0.35 + 0.65 * uh(i, 3); } tk *= dk;
        b.p(nh(i, 1), fc, 1.5); put(i, (hp.p(b.bp) * (0.42 + 1.9 * tk) + lo.p(nh(i, 2)) * 1.4) * a, p, 0.3); } })();
    // ---- the stones it looses: a second or two of fall, then they knock down the face (as many, second by second, as the picture's scrapes) ----
    if (EV.scrT) { let tot = 0; for (let k = 0; k < EV.scrT.length; k++) tot += EV.scrT[k]; const K = Math.min(1, (EV.stones > 0 ? Math.min(EV.stones, 320) : 260) / tot);
      for (let sec = 0; sec < EV.scrT.length; sec++) { const c = EV.scrT[sec] * K; let nk = Math.floor(c) + (rq() < c % 1 ? 1 : 0);
        for (; nk > 0; nk--) { let t = sec + rq() + 0.35 + 2.3 * Math.pow(rq(), 1.6), amp = (0.05 + 0.15 * rq() * rq()) * Y.stone; const f = 380 + 3600 * rq() * rq(), p = clamp(rockPan(t) + (rq() - 0.5) * 0.3, 0.05, 0.95);
          for (let k = 0; k < 4 && amp > 0.012 && t < END - 1; k++) { tick(t, f * (0.96 + 0.08 * rq()), amp, p, 0.004 + 0.012 * rq(), 0.4); t += 0.16 + 0.5 * rq(); amp *= 0.3 + 0.35 * rq(); } } } }
    // ---- the leap: a growl that tightens while it gathers itself on the summit, the kick against the rock, a cry the wind of the dive takes ----
    if (tLeap > 0 && Y.leap > 0) { const t0 = tLeap - 2.3;
      voice(t0, tLeap + 0.12, t => { const u = (t - t0) / 2.42; return [46 + 30 * u * u, win(t, t0, tLeap + 0.12, 1.1, 0.1) * (0.24 + 0.3 * u), 0.14 + 0.3 * u * u]; }, 1.9 * X.growl * Y.leap, panR);
      slam(tLeap, 0.34 * X.slam * Y.leap, rockPan(tLeap)); bark(tLeap, 0.9 * X.growl * Y.leap, panR(tLeap), 300);
      voice(tLeap, tLeap + 1.15, t => { const u = t - tLeap; return [104 + 78 * sm(0, 0.14, u) - 60 * sm(0.2, 1.1, u), sm(0, 0.02, u) * (1 - sm(0.3, 1.1, u)) * 0.85, 0.75 * sm(0, 0.1, u) * (1 - 0.5 * sm(0.4, 1.1, u))]; }, 1.5 * X.growl * Y.leap, panR); }
    // ---- the air its body tears, by its real speed and its distance from the lens (to FACEOFF: from there on the fight has its own): the dive at
    //      70 m/s, the whip over the bank, the launch out of the lake. A second, thin band is the edge of the tear when it is fast and near ----
    if (EV.spd && EV.hd) (() => { const b = svf(), b2 = svf(); let a = 0, at = 0, a2 = 0, at2 = 0, f1 = 400, f2 = 2600, p = 0.5, m = 0;
      for (let i = ix(1), e = ix(tF); i < e; i++) {
        if ((i & 31) === 0) { const t = i / SR, v = Math.abs(tab(EV.spd, EHz, t)), px = clamp(75 / Math.max(tab(EV.hd, EHz, t), 20), 0.35, 2.0), k = Math.min(1.3, Math.pow(v / 70, 1.6)) * (1 - sm(tF - 1.5, tF, t));
          at = k * (0.3 + 0.7 * Math.min(px, 1.4)) * Y.air; f1 = 280 + 700 * Math.min(v / 70, 1.2) + 420 * px; at2 = k * sm(40, 68, v) * px * 0.55 * Y.air; f2 = 2100 + 1500 * px; p = panR(t); }
        a += (at - a) * 0.004; a2 += (at2 - a2) * 0.004; if (a < 2e-5) continue; m += (nh(i, 4) - m) * 0.003;
        const n1 = nh(i, 5); b.p(n1, f1 * (1 + 4 * m), 1.3); b2.p(n1, f2, 2.4); put(i, (b.bp + b.lp * 0.35) * a + b2.bp * a2 * (0.6 + 14 * Math.abs(m)), p, 0.28); } })();
    // ---- crowns: leaves and boughs thrashed as a body goes over them (bright, torn, with the whump of the limbs), and the softer rush of each
    //      gust front crossing the trees of the valley, in the half of the frame where those trees stand ----
    if (EV.thL || EV.ruL) (() => { const E2 = EV.hz2 || 25, hL = bq('hp', 2300, 0.7), hR = bq('hp', 2500, 0.7), tL = svf(), tR = svf(), bo = bq('bp', 240, 0.8); let gl = 0, gr = 0, hl = 0, hr = 0, f1 = 0, f2 = 0, f3 = 0, f4 = 0;
      for (let i = 0; i < N; i++) {
        if ((i & 63) === 0) { const t = i / SR; const a = tab(EV.ruL, E2, t), b = tab(EV.ruR, E2, t), k = Math.pow(a + b + 1e-9, 0.6) * Y.rustle, c = tab(EV.thL, E2, t), d = tab(EV.thR, E2, t), k2 = Math.pow(c + d + 0.08, -0.6) * Y.thrash; gl = a * k; gr = b * k; hl = c * k2; hr = d * k2; }      // (the fronts stand out of the steady rustle; the passes are pressed together, so the far ones are still heard, but a crown that barely stirs stays silent)
        if (gl + gr + hl + hr < 2e-4) continue;
        const n1 = nh(i, 6), n2 = nh(i, 7); f1 += (n1 - f1) * 0.006; f2 += (n2 - f2) * 0.006; let l = hL.p(n1) * (0.35 + 9 * Math.abs(f1)) * gl, r = hR.p(n2) * (0.35 + 9 * Math.abs(f2)) * gr;
        if (hl + hr > 2e-4) { f3 += (n2 - f3) * 0.012; f4 += (n1 - f4) * 0.012; tL.p(n1, 3300, 0.8); tR.p(n2, 3700, 0.8); const w = bo.p(n1 + n2) * 0.5; l += (tL.bp * (0.3 + 12 * Math.abs(f3)) + tL.hp * 0.25 + w) * hl; r += (tR.bp * (0.3 + 12 * Math.abs(f4)) + tR.hp * 0.25 + w) * hr; }
        L[i] += l; R[i] += r; S[i] += (l + r) * 0.16; } })();
    // ---- wings: every downstroke near enough to hear. A dove off a roof claps (a crack of the primaries, the thud of air, a thin whistle); an egret passing the lens is a soft beat of air ----
    if (EV.wings) { const W = EV.wings;
      const dove = k => cached('wd' + k, () => { const o = new Float32Array(Math.floor(SR * 0.085)), b1 = bq('bp', 1700 + 190 * k, 0.9), b2 = bq('bp', 620, 0.8), h3 = bq('hp', 4200, 0.7), f0 = 1500 + 170 * k; let ph = 0;
        for (let i = 0; i < o.length; i++) { const ti = i / SR, n = nq(); ph += f0 * (1 + 3.5 * ti) / SR; o[i] = (b1.p(n) * Math.exp(-ti / 0.007) * 1.6 + h3.p(n) * Math.exp(-ti / 0.003) * 0.7 + b2.p(n) * Math.exp(-ti / 0.022) * Math.min(1, ti * 400) * 0.9 + Math.sin(TAU * ph) * Math.exp(-ti / 0.028) * Math.min(1, ti * 250) * 0.10) * (1 - sm(0.07, 0.085, ti)); } return o; });
      const heavy = k => cached('we' + k, () => { const o = new Float32Array(Math.floor(SR * 0.24)), b = bq('bp', 290 + 70 * k, 0.7), h = bq('bp', 1500, 0.6); for (let i = 0; i < o.length; i++) { const ti = i / SR, n = nq(); o[i] = (b.p(n) * 1.8 + h.p(n) * 0.9 * Math.exp(-ti / 0.05)) * sm(0, 0.035, ti) * Math.exp(-ti / 0.055) * (1 - sm(0.2, 0.24, ti)); } return o; });
      for (let j = 0; j + 3 < W.length; j += 4) { const p = clamp(panX(W[j + 1]) + (rq() - 0.5) * 0.08, 0.06, 0.94); if (W[j + 3] < 0.5) add(dove((rq() * 4) | 0), W[j], W[j + 2] * Y.dove * (0.7 + 0.6 * rq()), p, 0.35); else add(heavy((rq() * 3) | 0), W[j], W[j + 2] * Y.egret * (0.8 + 0.4 * rq()), p, 0.4); } }
    // ---- the lake. An entry (not the SPLASH, which has its own): the slap of the surface and the deep boom of the hole, a sheet of water torn.
    //      Then, as long as a body streams through the surface, white water by its speed: a torn hiss, a ratchet of grains, the weight underneath ----
    function plunge(t, pw, pan) { const i0 = ix(t), len = Math.floor(SR * 3.0), s1 = bq('hp', 260, 0.7), s2 = bq('lp', 3600, 0.7), s3 = bq('hp', 290, 0.7), s4 = bq('lp', 3900, 0.7), bl = bq('bp', 760, 0.5), br = bq('bp', 900, 0.5), ll = bq('lp', 240, 0.7), hl = bq('hp', 3000, 0.7), hr = bq('hp', 3400, 0.7), wl = (1 - pan) * 2, wr = pan * 2; let ph = 0, g1 = 0, g2 = 0;
      for (let i = 0, j = i0; i < len && j < N; i++, j++) { if (j < 0) continue; const ti = i / SR, n1 = nq(), n2 = nq(); ph += (26 + 52 * Math.exp(-ti * 6)) / SR; g1 += (n2 - g1) * 0.004; g2 += (n1 - g2) * 0.004;
        const es = (Math.exp(-ti * 1.5) * sm(0, 0.02, ti) * 0.6 + 0.5 * Math.exp(-Math.pow((ti - 0.7) / 0.4, 2))) * (1 - sm(2.4, 3.0, ti)) * 0.2;      // what it threw up comes down again: a hiss that swells as the spray lands
        const boom = Math.tanh(((Math.sin(TAU * ph) + 0.35 * Math.sin(2 * TAU * ph + 0.5)) * Math.exp(-ti * 2.3) * Math.min(1, ti * 450) + ll.p(n1 + n2) * Math.exp(-ti * 5) * 1.3) * 1.3) * 0.42;
        const sl = (Math.exp(-ti * 50) * 2.2 + Math.exp(-ti * 7.5) * 1.0) * (i < 8 ? i / 8 : 1), eb = (Math.exp(-ti * 5) + 0.25 * Math.exp(-ti * 1.5) * sm(0, 0.15, ti)) * 1.3 * Math.min(1, ti * 500);
        const l = (boom + (s2.p(s1.p(n1)) * sl * 0.9 + bl.p(n1) * eb * 0.75 + hl.p(n1) * es * (0.5 + 9 * Math.abs(g1))) * wl) * pw, r = (boom + (s4.p(s3.p(n2)) * sl * 0.9 + br.p(n2) * eb * 0.75 + hr.p(n2) * es * (0.5 + 9 * Math.abs(g2))) * wr) * pw; L[j] += l; R[j] += r; S[j] += (l + r) * 0.24; }
      for (let k = 0; k < 26; k++) { const dt = 0.3 + 2.2 * Math.pow(rq(), 1.4); tick(t + dt, 1200 + rq() * 3800, (0.03 + 0.08 * rq()) * (1 - dt / 2.6) * pw, clamp(pan + (rq() - 0.5) * 0.7, 0.08, 0.92), 0.003 + rq() * 0.004, 0.4); } }      // and the last heavy drops
    const slapB = k => cached('ws' + k, () => { const o = new Float32Array(Math.floor(SR * 0.2)), h = bq('hp', 2400, 0.7), b = bq('bp', 900, 0.8), f0 = 210 + 70 * k; let ph = 0;      // a wavelet against a flank: the gulp of a pocket of air, the slap, drops after it
      for (let i = 0; i < o.length; i++) { const ti = i / SR, n = nq(); ph += f0 * (1 + 1.5 * Math.min(1, ti / 0.07)) / SR; o[i] = (Math.sin(TAU * ph) * Math.exp(-ti / 0.022) * Math.min(1, ti * 300) * 0.45 + b.p(n) * Math.exp(-ti / 0.03) * 1.1 * Math.min(1, ti * 500) + h.p(n) * (Math.exp(-ti / 0.012) * 0.5 + 0.25 * Math.exp(-Math.pow((ti - 0.07) / 0.03, 2)))) * (1 - sm(0.16, 0.2, ti)); } return o; });
    for (const lp of LAPS) { if (lp[5] || !(Y.hit > 0)) continue; const p0 = clamp(panX(lp[2]), 0.25, 0.75), p1 = clamp(panX(lp[3]), 0.2, 0.8);
      plunge(lp[0], Y.hit * X.splash * lp[4], p0); rip(lp[0], 1.3 * X.rip * Y.hit * lp[4], p0, { len: 0.55, wet: 1, knock: 0, tear: 2.8 });
      gush(lp[1] - 0.12, 1.3 * X.gush * Y.hit * lp[4], p1 - 0.05, p1 + 0.08, 540); }      // the tail is torn out of the lake
    if (EV.wet) for (const lp of LAPS) if (!lp[5]) for (let t = lp[0] + 1.3 + rq(); t < lp[1] - 0.2; t += 0.22 + 0.75 * rq()) if (tab(EV.wet, EHz, t) < 12) add(slapB((rq() * 4) | 0), t, (0.35 + 0.65 * rq()) * Y.slap, clamp(panX(tab(EV.wetx, EHz, t)) + (rq() - 0.5) * 0.3, 0.08, 0.92), 0.2);      // while it lies in the water: wavelets against its flanks
    if (EV.wet) (() => { const hL = bq('hp', 520, 0.7), hR = bq('hp', 570, 0.7), lL = bq('lp', 6000, 0.7), lR = bq('lp', 6500, 0.7), lo = bq('lp', 150, 0.7), gr = svf(), sL = bq('hp', 2000, 0.7), sR = bq('hp', 2300, 0.7), dg = Math.exp(-1 / (0.012 * SR)), dd = Math.exp(-1 / (0.003 * SR));
      let a = 0, at = 0, sh = 0, shE = 0, p = 0.5, ge = 0, gf = 1500, gp = 0.5, next = 0, m1 = 0, m2 = 0, de = 0, dph = 0, dw = 0, dp = 0.5, rate = 0, live = false;
      for (let i = 0; i < N; i++) {
        if ((i & 31) === 0) { const t = i / SR, w = tab(EV.wet, EHz, t), rz = Math.min(tab(EV.rise, EHz, t), 45) / 30; at = w > 0.3 ? Math.pow(Math.min(w, 80) / 70, 0.85) * Y.rush : 0; shE += (rz - shE) * (rz > shE ? 0.06 : 0.0007); sh = shE * Y.shed; rate = (25 + 300 * Math.min(shE, 1)) / SR; p = panX(tab(EV.wetx, EHz, t)); live = at > 1e-5 || a > 2e-5 || shE > 2e-4; }      // shE: water sheeting off a body that rises out of the lake; it pours for a second after
        if (!live) continue;
        a += (at - a) * 0.004; const n1 = nh(i, 8), n2 = nh(i, 9); m1 += (n1 - m1) * 0.0025; m2 += (n2 - m2) * 0.004;
        if (i >= next) { ge = 0.35 + 0.65 * uh(i, 10); gf = 420 * Math.pow(7, uh(i, 11)); gp = clamp(p + (uh(i, 12) - 0.5) * 0.5, 0.06, 0.94); next = i + Math.floor((0.004 + 0.007 * uh(i, 13)) * SR); } ge *= dg; gr.p(n2 * ge, gf, 2.0);
        if (shE > 2e-4 && uh(i, 14) < rate) { de = (0.25 + 0.75 * uh(i, 15)) * Math.min(shE, 1.2); dw = TAU * (1700 + 4000 * uh(i, 16)) / SR; dph = 0; dp = clamp(p + (uh(i, 17) - 0.5) * 0.4, 0.06, 0.94); } dph += dw; de *= dd;      // drops
        const am = (0.55 + 9 * Math.abs(m1)) * a * 1.5, am2 = sh * (0.45 + 10 * Math.abs(m2)), low = lo.p(n1 + n2) * 2.2 * a, z = gr.bp * 2.4 * a, dr = Math.sin(dph) * de * 2.2 * Y.shed;
        const l = (lL.p(hL.p(n1)) * am + sL.p(n1) * am2 + low) * (1 - p) * 1.2 + z * (1 - gp) * 1.2 + dr * (1 - dp) * 1.2, r = (lR.p(hR.p(n2)) * am + sR.p(n2) * am2 + low) * p * 1.2 + z * gp * 1.2 + dr * dp * 1.2;
        L[i] += l; R[i] += r; S[i] += (l + r) * 0.2; } })();
    // its head comes up out of the lake: a blast of breath that clears the water from its throat, and a low growl held into the close-up
    if (EV.tRear > 0 && Y.rear > 0) { const tr = EV.tRear, pr = panR(tr + 0.3), t1 = Math.min(tC + 0.25, tr + 1.9);
      whoosh(tr - 0.05, tr + 0.85, u => 950 * (1.3 - 0.75 * u), u => sm(0, 0.07, u) * Math.pow(1 - u, 1.6), u => pr, 1.1, 0.34 * X.breath * Y.rear, 0.3, 0.3);
      if (t1 > tr + 0.9) voice(tr + 0.35, t1, t => [50 + 9 * Math.sin((t - tr) * 2.9), win(t, tr + 0.35, t1, 0.45, 0.5) * 0.5, 0.16 + 0.1 * Math.sin((t - tr) * 4.1)], 1.7 * X.growl * Y.rear, panR); }
    // ---- the rings of each entry reach the shore: a swash up the bank and its drain, a slap where it meets rock ----
    if (EV.wash) { const W = EV.wash, wb = k => cached('wv' + k, () => { const o = new Float32Array(Math.floor(SR * 1.5)), b = svf(), lo = bq('lp', 420, 0.7); let fc = 3000, m = 0;
        for (let i = 0; i < o.length; i++) { const ti = i / SR, n = nq(); if ((i & 15) === 0) fc = 850 + (2300 + 500 * k) * Math.exp(-ti / 0.35); m += (n - m) * 0.004; b.p(n, fc, 0.8);
          o[i] = (b.bp * 1.2 + b.hp * 0.15) * sm(0, 0.16, ti) * Math.exp(-ti / 0.42) * (1 - sm(1.2, 1.5, ti)) * (0.6 + 8 * Math.abs(m)) + lo.p(n) * Math.exp(-ti * 14) * sm(0, 0.01, ti) * 1.5; } return o; });
      for (let j = 0; j + 2 < W.length; j += 3) add(wb((rq() * 3) | 0), W[j], W[j + 2] * Y.wash * (0.7 + 0.6 * rq()), clamp(panX(W[j + 1]) + (rq() - 0.5) * 0.1, 0.08, 0.92), 0.3); }
    // ---- the falls: a steady bed, each fall on its side of the frame and by its distance, that sinks under the music and returns in its gaps ----
    if (EV.fallL) (() => { const f1 = bq('lp', 3600, 0.7), f2 = bq('lp', 3900, 0.7), h1 = bq('hp', 170, 0.7), h2 = bq('hp', 190, 0.7), lo = bq('bp', 105, 0.7); let gl = 0, gr = 0, dk = 1, m = 0;
      for (let i = 0; i < N; i++) {
        if ((i & 63) === 0) { const t = i / SR, want = 1 / (1 + 8 * mEnv[(i / MH) | 0]); dk += (want - dk) * (want < dk ? 0.02 : 0.0025); const k = Y.falls * dk * (1 - 0.92 * win(t, R1 - 0.2, STR[0] + 0.06, 0.35, 0.06)); gl = tab(EV.fallL, 20, t) * k; gr = tab(EV.fallR, 20, t) * k; }      // (it holds its breath with the valley before the thunder)
        const n1 = nh(i, 18), n2 = nh(i, 19); m += (n1 - m) * 0.0006; const am = 0.8 + 6 * Math.abs(m), rum = lo.p(n1 + n2) * 1.6, l = (h1.p(f1.p(n1)) + rum) * gl * am, r = (h2.p(f2.p(n2)) + rum) * gr * am; L[i] += l; R[i] += r; S[i] += (l + r) * 0.1; } })();
    // ---- the wind's fronts: each crosses the frame from the side it comes from, as the lens meets it ----
    if (EV.gf) for (let j = 0; j + 3 < EV.gf.length; j += 4) { const tR = EV.gf[j], tM = EV.gf[j + 1], tL = EV.gf[j + 2], s = EV.gf[j + 3], t0 = Math.max(0, Math.min(tR, tL, tM) - 0.5), t1 = Math.min(END, Math.max(tR, tL, tM) + 4.5), dir = tR < tL ? 1 : -1, fall = EV.gFall || 2.6; if (t1 - t0 < 1) continue;
      whoosh(t0, t1, u => { const tau = t0 + u * (t1 - t0) - tM; return 330 + 420 * sm(-0.6, 0.5, tau) * Math.exp(-Math.max(tau, 0) / 3); }, u => { const tau = t0 + u * (t1 - t0) - tM + 0.3; return s * sm(0, 0.9, tau) * Math.exp(-Math.max(tau - 0.9, 0) / fall); },
        u => clamp(0.5 + 0.34 * dir * (1 - 2 * sm(Math.min(tR, tL) - 0.3, Math.max(tR, tL) + 0.6, t0 + u * (t1 - t0))), 0.14, 0.86), 1.1, Y.gust * X.air, 0.2, 0.5); }
    // ---- OMEN: the storm's shadow comes over the lens and a thin cold wind with it ----
    if (EV.storm) { let k0 = -1, k1 = -1; for (let k = 0; k < EV.storm.length; k++) if (EV.storm[k] > 0.02) { if (k0 < 0) k0 = k; k1 = k; }
      if (k0 >= 0) { const t0 = Math.max(k0 / 20 - 0.2, 0), t1 = Math.min(k1 / 20 + 0.5, END), env = u => tab(EV.storm, 20, t0 + u * (t1 - t0)) * (0.75 + 0.25 * Math.sin(u * (t1 - t0) * 1.9));
        whoosh(t0, t1, u => 1250 + 320 * Math.sin(u * (t1 - t0) * 0.83) + 180 * Math.sin(u * (t1 - t0) * 2.3), env, u => 0.5 + 0.3 * Math.sin(u * (t1 - t0) * 0.6), 3.4, Y.storm * X.air * 1.25, 0.35);
        whoosh(t0, t1, u => 1900 + 420 * Math.sin(u * (t1 - t0) * 0.61 + 2), u => env(u) * 0.6, u => 0.5 - 0.3 * Math.sin(u * (t1 - t0) * 0.5), 4.2, Y.storm * X.air * 1.25, 0.35); } }
    // ---- insects: crickets in the grass of the bank while the loong sleeps, and again when the sun has left the lens (seven that chirp, two that trill) ----
    { const tD0 = EV.tDusk > 0 ? EV.tDusk : tG - 3, lvl = t => (1 - sm(tE - 2.2, tE - 0.2, t)) + sm(tD0 - 1, tD0 + 3, t), cb = (f, ms) => cached('ck' + f + '_' + ms, () => { const n = Math.floor(SR * ms / 1000), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = Math.sin(TAU * f * i / SR) * Math.pow(Math.sin(Math.PI * i / n), 2); return o; });
      for (let c = 0; c < 9; c++) { const trill = c >= 7, f = Math.round(trill ? 3050 + 260 * (c - 7) : 4250 + 150 * c + 90 * rq()), per = 0.42 + 0.33 * rq(), np = 3 + (rq() < 0.4 ? 1 : 0), gap = trill ? 1 / (38 + 6 * rq()) : 1 / (52 + 14 * rq()), pan = 0.1 + 0.8 * rq(), g = (0.5 + 0.5 * rq()) * Y.bugs, buf = cb(f, trill ? 9 : 13);
        for (const [a, b] of [[0.2, tE], [tD0 - 1, END]]) for (let t = a + rq(); t < b;) {
          if (trill) { const dur = 1.2 + 2.2 * rq(); for (let u = 0; u < dur && t + u < b; u += gap) add(buf, t + u, g * 0.6 * lvl(t + u) * sm(0, 0.3, u) * (1 - sm(dur - 0.4, dur, u)), pan, 0.25); t += dur + 1.5 + 3 * rq(); }
          else { const k = lvl(t); if (k > 0.02) for (let j = 0; j < np; j++) add(buf, t + j * gap, g * k * (0.7 + 0.3 * j / np), pan, 0.25); t += per * (0.97 + 0.06 * rq()); } } } }
    // ---- hung things: a lantern thrown against its post where its swing is fastest; cloth that fills and cracks as a gust front reaches its hall ----
    if (EV.knocks) { const W = EV.knocks, kb = k => cached('lk' + k, () => { const o = new Float32Array(Math.floor(SR * 0.08)), f1 = 640 + 90 * k, h = bq('hp', 3000, 0.7), b = bq('bp', 2600, 1.2); for (let i = 0; i < o.length; i++) { const ti = i / SR, n = nq(); o[i] = ((Math.sin(TAU * f1 * ti) * Math.exp(-ti / 0.012) + 0.6 * Math.sin(TAU * f1 * 2.76 * ti + 1) * Math.exp(-ti / 0.007)) * Math.min(1, ti * 3000) + h.p(n) * Math.exp(-ti / 0.004) * 0.4 + b.p(n) * Math.exp(-ti / 0.02) * 0.25) * (1 - sm(0.06, 0.08, ti)); } return o; });
      for (let j = 0; j + 2 < W.length; j += 3) add(kb((rq() * 3) | 0), W[j], W[j + 2] * Y.knock, panX(W[j + 1]), 0.3); }
    if (EV.cloth) { const W = EV.cloth, cl = cached('clo', () => { const o = new Float32Array(Math.floor(SR * 0.1)), b1 = bq('bp', 1000, 0.6), b2 = bq('bp', 280, 0.8); for (let i = 0; i < o.length; i++) { const ti = i / SR, n = nq(); o[i] = (b1.p(n) * Math.exp(-ti / 0.014) * 0.7 + b2.p(n) * Math.exp(-ti / 0.035) * 1.5) * Math.min(1, ti * 450) * (1 - sm(0.08, 0.1, ti)); } return o; });
      for (let j = 0; j + 2 < W.length; j += 3) for (let k = 0, n = 3 + ((rq() * 3) | 0), t = W[j] + 0.05; k < n; k++, t += 0.11 + 0.06 * rq()) add(cl, t, W[j + 2] * Y.cloth * Math.pow(0.75, k) * (0.6 + 0.4 * rq()), clamp(panX(W[j + 1]) + (rq() - 0.5) * 0.12, 0.08, 0.92), 0.3); }
    // ---- asleep on the spire: the breath that swells its coils in the picture. Air drawn in as the chest fills, let go lower and longer, with the purr of the throat ----
    if (EV.br) (() => { const bi = svf(), be = svf(), lo = bq('lp', 110, 0.7), mx = EV.brMax > 0 ? EV.brMax : 0.13; let ai = 0, ae = 0, ti = 0, te = 0, fi = 420, fe = 240, rp = 0, p = 0.5;
      for (let i = 0, e = Math.min(N, ix((EV.br.length - 1) / 20)); i < e; i++) {
        if ((i & 31) === 0) { const t = i / SR, d = (tab(EV.br, 20, t + 0.05) - tab(EV.br, 20, t - 0.05)) / 0.1 / (mx * 0.72), lv = tab(EV.br, 20, t) / mx; const k = Y.breath * (1 - sm(tE - 0.5, tE + 1.5, t)); ti = Math.max(0, d) * k; te = Math.max(0, -d) * k; fi = 360 + 260 * lv; fe = 190 + 110 * lv; p = panR(t); }      // (0.72 of its depth a second: how fast the chest of the picture fills)
        ai += (ti - ai) * 0.002; ae += (te - ae) * 0.002; if (ai + ae < 2e-5) continue; const n = nh(i, 20); bi.p(n, fi, 2.2); be.p(n, fe, 1.3); rp += 23 / SR;
        put(i, bi.bp * ai * 0.8 + (be.bp + lo.p(n) * 3 * (0.5 + 0.5 * Math.sin(TAU * rp))) * ae, p, 0.4); } })();
    if (EV.br && Y.breath > 0) for (let k = 2; k < EV.br.length - 2; k++) { const tp = k / 20; if (tp > tE - 1 || !(EV.br[k] > 0.6 * (EV.brMax || 0.13) && EV.br[k] >= EV.br[k - 1] && EV.br[k] > EV.br[k + 1])) continue;      // each time the chest is full: the out-breath rumbles in its throat
      voice(tp + 0.1, tp + 2.1, t => { const u = (t - tp - 0.1) / 2; return [41 - 7 * u, Math.pow(Math.sin(Math.PI * u), 1.5) * 0.2, 0.06 + 0.05 * u]; }, 1.2 * X.growl * Y.breath / 0.7, panR, RED_V, 0.4); }
  }
  if (EV) { const keep = [L.slice(), R.slice()], a = Math.max(0, ix(R1 - 0.3)), b = Math.min(N, ix(STR[0] + 0.12)), kS = [S.slice(a, b), S2.slice(a, b)];
    valley();
    // the valley holds its breath before the thunder: whatever was added inside that second is held back with the rest
    (() => { const h = i => 1 - 0.96 * win(i / SR, R1 - 0.2, STR[0] + 0.06, 0.35, 0.06); for (let i = a; i < b; i++) { const g = h(i); L[i] = keep[0][i] + (L[i] - keep[0][i]) * g; R[i] = keep[1][i] + (R[i] - keep[1][i]) * g; S[i] = kS[0][i - a] + (S[i] - kS[0][i - a]) * g; S2[i] = kS[1][i - a] + (S2[i] - kS[1][i - a]) * g; } })();
    // how much these sounds add to the film's energy, weighed as the master weighs it: the master's level is set by everything else, so the music plays exactly as loud as it did without them
    (() => { const ha = bq('hp', 27, 0.7), hb = bq('hp', 27, 0.7), sa = bq('hs', 3000, 4), sb = bq('hs', 3000, 4); for (let i = 0; i < N; i++) { const l = sa.p(ha.p(L[i] - keep[0][i])), r = sb.p(hb.p(R[i] - keep[1][i])); ssNew += l * l + r * r; } })();
    lap('world'); }
  }

  // ================= room + master =================
  // feedback delay network; its decay is pulled short twice so that the valley can truly fall silent: after the roar, and in the gap before the blast
  { const D = [1499, 1889, 2311, 2749, 3203, 3671, 4127, 4603], n = 8, bufs = D.map(d => new Float32Array(d)), ixs = new Int32Array(n), lpS = new Float32Array(n), v = new Float32Array(n), pre = Math.floor(0.028 * SR);
    const gset = rt => D.map(d => Math.pow(10, -3 * d / (SR * rt))), gN = gset(3.4), gO = gset(0.32), gB = gset(0.07), o0 = ix(R1 - 0.05), o1 = ix(STR[0] - 0.03), b0 = ix(CUT - 0.015), b1 = ix(tBl - 0.004), hpL = bq('hp', 150, 0.7), hpR = bq('hp', 150, 0.7);
    for (let i = 0; i < N; i++) { const inp = i >= pre ? S[i - pre] * 0.25 : 0, sdi = i >= pre ? S2[i - pre] * 0.25 : 0, g = i >= b0 && i < b1 ? gB : i >= o0 && i < o1 ? gO : gN; let sum = 0;
      for (let k = 0; k < n; k++) { const y = bufs[k][ixs[k]]; lpS[k] += (y - lpS[k]) * 0.55; v[k] = lpS[k]; sum += v[k]; }
      sum *= 2 / n; let l = 0, r = 0;
      for (let k = 0; k < n; k++) { bufs[k][ixs[k]] = (v[k] - sum) * g[k] + (k & 1 ? inp + sdi : inp - sdi); if (++ixs[k] >= D[k]) ixs[k] = 0; if (k & 1) r += v[k]; else l += v[k]; }      // odd lines feed the right ear, even lines the left
      L[i] += hpL.p(l) * 0.6; R[i] += hpR.p(r) * 0.6; } }
  lap('room');
  // DC block, a very gentle top roll-off, level, fades, the cut before the blast, look-ahead limiter
  { const a = bq('lp', 15000, 0.7), b = bq('lp', 15000, 0.7), ha = bq('hp', 27, 0.7), hb = bq('hp', 27, 0.7), sa = bq('hs', 3000, 4), sb = bq('hs', 3000, 4), look = Math.floor(0.004 * SR); let ss = 0;
    for (let i = 0; i < N; i++) { const l = sa.p(ha.p(a.p(L[i]))), r = sb.p(hb.p(b.p(R[i]))); L[i] = l; R[i] = r; ss += l * l + r * r; }
    const pre = P.pre || 0.205 / Math.sqrt(Math.max(ss - ssNew, 0.25 * ss) / (2 * N) + 1e-12); prof.pre = pre; const iE = ix(END), g0 = ix(CUT - 0.006), g1 = ix(tBl);
    for (let i = 0; i < N; i++) { const t = i / SR; let f = i >= iE ? 0 : sm(0.0, 1.4, t) * (1 - sm(tOut - 0.7, END - 0.05, t)) * pre; if (i >= g0 && i < g1) f *= t < tBl - 0.0035 ? 1 - sm(CUT - 0.006, CUT + 0.004, t) : sm(tBl - 0.0035, tBl - 0.0003, t); let l = L[i] * f, r = R[i] * f; const al = l < 0 ? -l : l, ar = r < 0 ? -r : r; if (al > 0.55) l = (l < 0 ? -1 : 1) * (0.55 + 0.45 * Math.tanh((al - 0.55) / 0.45)); if (ar > 0.55) r = (r < 0 ? -1 : 1) * (0.55 + 0.45 * Math.tanh((ar - 0.55) / 0.45)); L[i] = l; R[i] = r; }      // soft clip: only the tips of transients
    // limiter: gain = the smallest gain needed over the next 4 ms, released slowly, then box-smoothed over 4 ms so it never steps
    // It works on what the wave reaches BETWEEN samples too (four-times interpolation, computed only where it is loud; kept in S, which the room no longer needs),
    // so a player that resamples the buffer (a 48 kHz output device) is never driven over full scale by the densest hits.
    { const K = 8, ker = [0.25, 0.5, 0.75].map(f => { const h = new Float64Array(2 * K); let sum = 0; for (let k = 0; k < 2 * K; k++) { const x = k - (K - 1) - f; h[k] = Math.sin(Math.PI * x) / (Math.PI * x) * (0.5 + 0.5 * Math.cos(Math.PI * x / K)); sum += h[k]; } for (let k = 0; k < 2 * K; k++) h[k] /= sum; return h; });
      for (let i = 0; i < N; i++) { const a = L[i] < 0 ? -L[i] : L[i], b = R[i] < 0 ? -R[i] : R[i]; S[i] = a > b ? a : b; }
      for (let i = K; i < N - K - 1; i++) { if (S[i] > 0.45 || S[i + 1] > 0.45) { let pk = 0; for (let p = 0; p < 3; p++) { const h = ker[p]; let vl = 0, vr = 0; for (let k = 0, j = i - K + 1; k < 2 * K; k++, j++) { vl += h[k] * L[j]; vr += h[k] * R[j]; } if (vl < 0) vl = -vl; if (vr < 0) vr = -vr; if (vl > pk) pk = vl; if (vr > pk) pk = vr; }
          if (pk > S[i]) S[i] = pk; if (pk > S[i + 1]) S[i + 1] = pk; } } }
    const TH = 0.86, box = new Float32Array(look); let m = 1, bs = look, bi = 0; box.fill(1);
    for (let i = 0; i < N; i++) { const pk = S[i + look < N ? i + look : N - 1], want = pk > TH ? TH / pk : 1; m = want < m ? want : m + (1 - m) * 0.00025;
      bs += m - box[bi]; box[bi] = m; if (++bi >= look) bi = 0; let g = bs / look; const p0 = S[i] * g; if (p0 > 0.885) g *= 0.885 / p0; L[i] *= g; R[i] *= g; } }
  lap('master');
  return P.prof ? [L, R, prof] : [L, R];
}

const Score = (() => {
  const SR = 44100, mod = t => ((t % Film.DUR) + Film.DUR) % Film.DUR, wrap = e => e - Film.DUR * Math.round(e / Film.DUR), pnow = () => performance.now() / 1000;
  let ctx, src, gain, abuf = null, bufP = null, ready = null, going = null, playing = false, muted = false, live = false;
  // ---- the picture, read once at load from the film's own pure samplers, so every pan and every picture-timed sound follows the
  //      choreography as it was built (the thunder already follows Film.STRIKES the same way) ----
  //   hx.r, hx.w   screen x of each loong's head through the film camera at 16:9 (-1 left edge .. +1 right edge), 20 times a second
  //   exits        [red, white] { t, x }: when and where each head bursts out of the lake after SPLASH (FX's own crown time when it has one)
  //   cloud        when each loong is half gone and wholly gone into the cloud after GONG (Dragon.x.tGone when the choreography gives it, else its
  //                own pose.vis), and when the rift is half shut (the film's own Sky.fx.rift envelope)
  //   ax           screen x of the fixed marks: both clashes, the splash, the rock the bolt shatters
  // ---- the rest of the picture: what a loong's body does to rock, air and lake, the wind's fronts and every crown they or a body shake,
  //      the falls, the birds, the lanterns, the light. Read ONCE at load from the modules that DRAW these things (their pure samplers and the
  //      tables they built for themselves), so each sound keeps its place when the choreography, the wind, the water or the flocks are changed.
  //      CF: the film camera 20 times a second (see picture()); sxi(k, x, y, z): screen x of a world point through camera sample k.
  //      Every part stands alone: a module that is missing or has changed shape loses its own sounds only (ev.bad names the part).
  //   50 times a second: spd (the red loong's speed along its rail, m/s), seat (share of its body lying on rock), scx (screen x of that rock),
  //     hd (m from the lens to its head), wet (m/s at which a body is ploughing or streaming through the lake's surface), wetx (where on screen),
  //     rise (m/s a head climbs while its body stands in the lake: water sheeting off it)
  //   tLeap, tRear  when it throws itself off the rock; when its head is out of the lake again
  //   laps          [in, out, screen x in, screen x out, weight, 1 = the SPLASH (which has its own sound)] for every time a body lies in the lake
  //   scrT, stones  how many times a second a body scrapes rock (Wake.info.scrapeT) and how many stones that looses
  //   gf            the valley's gust fronts as the lens meets them: [when at 45 m to the right, at the lens, at 45 m to the left, strength]
  //   thL/R, ruL/R  25 times a second: how hard the crowns in the left and right of the frame are thrashed by a passing body (Wake's pass
  //     tables: strength squared x crown area, nearer = louder) and how hard the gust fronts blow through them
  //   fallL/R       20 times a second: the falls (Water.S.falls: power, distance to the lens, side of the frame)
  //   wings         [when, screen x, level, 0 = a dove's clap / 1 = the beat of an egret or crane] for every downstroke near enough to hear
  //   wash          [when, screen x, level]: the rings of each entry reaching the shore; knocks, cloth: lanterns thrown by a front, cloth filled by a gust
  //   br (20 a second: the sleeping loong's chest), storm (20 a second: the storm's shadow over the lens), tDusk (the sun leaves the lens)
  function world(CF, HZ, sxi) {
    const V = THREE.Vector3, T = Film.T, DUR = Film.DUR, EH = 50, n = DUR * EH + 1, nc = CF.length / 10, red = Dragon.red, h = new V(), q = new V(), ev = { hz: EH, hz2: 25, bad: [] };
    const ck = t => Math.max(0, Math.min(nc - 1, Math.round(t * HZ))), dcam = (k, x, y, z) => Math.hypot(x - CF[k * 10], y - CF[k * 10 + 1], z - CF[k * 10 + 2]);
    const part = (k, fn) => { try { fn(); } catch (e) { ev.bad.push(k); } }, flat = a => { const o = new Float32Array(a.length * a[0].length); a.forEach((r, i) => o.set(r, i * r.length)); return o; };
    const HASW = typeof Water !== 'undefined' && !!Water, WY = HASW && Water.WY === +Water.WY ? Water.WY : Film.A.splash.y, nearS = t => t > T.SPLASH - 1 && t < T.SPLASH + 5;
    const inLake = HASW && typeof Water.bedAt === 'function' ? (x, z) => { const b = Water.bedAt(x, z); return b && b.d === +b.d ? b.d : 1; } : () => 1;      // metres inside the lake's waterline (> 0: water)
    // ---- the bodies: rock under the red one, the air it moves, the lake under either ----
    part('body', () => {
      const spd = new Float32Array(n), seat = new Float32Array(n), scx = new Float32Array(n), hd = new Float32Array(n), wet = new Float32Array(n), wetx = new Float32Array(n), rise = new Float32Array(n), low = new Float32Array(n), laps = [];
      for (const d of [red, Dragon.white]) { if (!d || !d.sOf || !d.pathAt || !d.rProf) continue; const isRed = d === red, gone = d.tGone === +d.tGone ? d.tGone : 1e9; let py = d.headAt(0, h).y, cxs = 0, lx = 0, lz = 0; const lox = new Float32Array(n);
        for (let i = 0; i < n; i++) { const t = i / EH, s = d.sOf(t), k = ck(t), v = (d.sOf(t + 0.01) - d.sOf(t - 0.01)) * 50; let st = 0, m = 0, lo = 99, cx = 0, cy = 0, cz = 0, cw = 0;
          for (let a = 0; a <= d.LEN; a += 4) { const sa = s - a; if (sa < 0.7) break; const w = isRed && d.seatAt ? d.seatAt(sa) : 0; st += w; m++; d.pathAt(sa, q);
            if (w > 0.05) { cx += q.x * w; cy += q.y * w; cz += q.z * w; cw += w; }
            if (q.y < 9) { const y = q.y - d.RMAX * d.rProf(a) - WY; if (y < lo && inLake(q.x, q.z) > -1.5) { lo = y; lx = q.x; lz = q.z; } } }
          if (t > gone) lo = 99; low[i] = lo; lox[i] = sxi(k, lx, WY, lz); d.headAt(t, h);
          if (isRed) { spd[i] = t > gone ? 0 : v; seat[i] = m ? st / m : 0; if (cw > 0) cxs = sxi(k, cx / cw, cy / cw, cz / cw); scx[i] = cxs; hd[i] = dcam(k, h.x, h.y, h.z); }
          if (lo < 0.5 && i) rise[i] += Math.max(0, (h.y - py) * EH) * (nearS(t) ? 0.18 : 1); py = h.y;
          if (lo < 0) { wet[i] += Math.abs(v) * (nearS(t) ? 0.08 * sm(T.SPLASH + 0.7, T.SPLASH + 1.4, t) : 1); wetx[i] = lox[i]; } }      // (the SPLASH has its own sound: the bodies streaming out of the lake after it come in under that, once it has rung)
        // every time it lies in the lake: in, out (the belly's lowest point passes the surface)
        let tin = -1, iin = 0; for (let i = 1; i < n; i++) { const a = low[i - 1], b = low[i], x = (a < 20 && b < 20 && a !== b ? i - 1 + a / (a - b) : i) / EH;
          if (b < 0 && a >= 0) { tin = x; iin = i; } else if (b >= 0 && a < 0 && tin >= 0) { if (x - tin > 0.12) laps.push([tin, x, lox[iin], lox[i - 1], nearS(tin) ? 0.55 : 1, nearS(tin) ? 1 : 0]); tin = -1; } }
        if (isRed) {      // the leap: its speed along the rail passes 25 m/s with most of the body still on the rock; the push-off is where that surge began
          for (let i = EH; i < n; i++) if (spd[i] > 25 && spd[i - 1] <= 25 && seat[i] > 0.5) { let j = i; while (j > 1 && spd[j - 1] > 12) j--; ev.tLeap = j / EH; break; } } }
      // (the lake's own skim tracks say the same thing; where they know of a body dragging that the rail does not show, they are heard too)
      try { for (const tr of (HASW && Water.S && Water.S.tracks) || []) { if (typeof tr.speedAt !== 'function' || !tr.nodes || !tr.nodes.length) continue; const nd = tr.nodes, a = nd[nd.length >> 1]; let te = tr.t0; for (const o of nd) if (o.td > te) te = o.td;
          for (let i = Math.max(0, Math.floor(tr.t0 * EH)); i < n && i <= te * EH; i++) { const v = tr.speedAt(i / EH) * (nearS(i / EH) ? 0.08 : 1); if (v > wet[i]) { wet[i] = v; wetx[i] = sxi(ck(i / EH), a.x, WY, a.z); } } } } catch (e) {}
      laps.sort((a, b) => a[0] - b[0]); ev.spd = spd; ev.seat = seat; ev.scx = scx; ev.hd = hd; ev.wet = wet; ev.wetx = wetx; ev.rise = rise; if (laps.length) ev.laps = flat(laps);
      const L0 = laps.find(L => !L[5]); if (L0) for (let t = L0[0]; t < L0[1]; t += 0.01) if (red.headAt(t, h).y - WY > 8) { ev.tRear = t; break; } });
    part('stones', () => { const hs = Wake.info && Wake.info.scrapeT; if (!hs) return; const a = new Float32Array(DUR + 1); let s = 0; for (const k of Object.keys(hs)) { const i = +k; if (i >= 0 && i <= DUR && hs[k] > 0) { a[i] = hs[k]; s += hs[k]; } } if (s > 0) { ev.scrT = a; ev.stones = Wake.info.stones > 0 ? Wake.info.stones : 0; } });
    // ---- the valley's wind: its fronts (Wake.gusts is Air.GUSTS when the air module is there; a front reaches (x, z) at t0 + (x hx + z hz - S0) / speed) ----
    let gust = null;
    part('gust', () => { const g = (typeof Wake !== 'undefined' && Wake.gusts) || (typeof Air !== 'undefined' && Air.GUSTS), W = (typeof Wake !== 'undefined' && Wake.WIND) || {}, S0 = W.S0 === +W.S0 ? W.S0 : typeof Air !== 'undefined' && Air.G_S0 === +Air.G_S0 ? Air.G_S0 : -125; if (!g || !g.length) return;
      const arr = (r, x, z) => r[0] + (x * r[1] + z * r[2] - S0) / r[3], out = []; gust = { g, arr, rise: W.rise > 0 ? W.rise : 0.55, fall: W.fall > 0 ? W.fall : 2.6 };
      for (const r of g) { let tc = r[0] + 4; for (let it = 0; it < 3; it++) { const k = ck(tc) * 10; tc = arr(r, CF[k], CF[k + 2]); } if (!(tc > -4 && tc < DUR)) continue;
        const k = ck(tc) * 10, rx = CF[k + 6], rz = CF[k + 8]; out.push([arr(r, CF[k] + 45 * rx, CF[k + 2] + 45 * rz), tc, arr(r, CF[k] - 45 * rx, CF[k + 2] - 45 * rz), r[4]]); }
      if (out.length) { ev.gf = flat(out); ev.gRise = gust.rise; ev.gFall = gust.fall; } });
    // ---- crowns: thrashed by a body (each plant's own pass events) and blown through by each front ----
    part('trees', () => { const gr = Wake.groups; if (!gr || !gr.length) return; const E2 = ev.hz2, m = DUR * E2 + 1, thL = new Float32Array(m), thR = new Float32Array(m), ruL = new Float32Array(m), ruR = new Float32Array(m), big = [];
      const side = (k, x, y, z) => 0.5 + 0.5 * Math.max(-1, Math.min(1, sxi(k, x, y, z)));
      for (const g of gr) { if (!g || !g.ctr || !g.R) continue;
        for (let i = 0; i < g.n; i++) { const R = g.R[i]; if (!(R >= 1)) continue; const x = g.ctr[i * 3], y = g.ctr[i * 3 + 1], z = g.ctr[i * 3 + 2], ar = Math.min(R, 22) * Math.min(R, 22); if (R >= 2.2) big.push(x, y, z, Math.min(ar, 81));
          const l = g.ev && g.ev[i]; if (!l) continue;
          for (const e of l) { if (!e || !(e.S > 0.08) || !(e.t0 >= 0) || e.t0 > DUR - 1) continue; const k = ck(e.t0), d = dcam(k, x, y, z), w = e.S * e.S * ar / (1 + d * d / 1600) * (nearS(e.t0) ? 0.25 : 1), px = side(k, x, y, z), du = Math.min(e.dur > 0 ? e.dur : 0.3, 4);      // (the SPLASH has its own sound: its crowns come in under it)
            for (let j = Math.floor(e.t0 * E2), j1 = Math.min(m - 1, Math.ceil((e.t0 + du + 1.5) * E2)); j <= j1; j++) { const tau = j / E2 - e.t0, en = sm(0, 0.12, tau) * (1 - sm(du, du + 1.5, tau)) * w; thL[j] += en * (1 - px); thR[j] += en * px; } } } }      // (the same rise, hold and ring-down the plant's own bend has in 66_wake.js)
      if (gust) { const nb = big.length / 4, st = Math.max(1, Math.ceil(nb / 800));
        for (const r of gust.g) for (let b = 0; b < nb; b += st) { const x = big[b * 4], y = big[b * 4 + 1], z = big[b * 4 + 2], ta = gust.arr(r, x, z); if (!(ta > -8 && ta < DUR)) continue; const k = ck(ta), d = dcam(k, x, y, z), w = r[4] * big[b * 4 + 3] / (1 + d * d / 900), px = side(k, x, y, z);
          for (let j = Math.max(0, Math.floor(ta * E2)), j1 = Math.min(m - 1, Math.ceil((ta + 8) * E2)); j <= j1; j++) { const tau = j / E2 - ta; if (tau <= 0) continue; const en = sm(0, gust.rise, tau) * Math.exp(-tau / (0.5 * gust.fall)) * w; ruL[j] += en * (1 - px); ruR[j] += en * px; } } }      // (the leaves hiss for half as long as the bough sways)
      const norm = (a, b) => { let mx = 0; for (let j = 0; j < m; j++) if (a[j] + b[j] > mx) mx = a[j] + b[j]; if (mx > 0) for (let j = 0; j < m; j++) { a[j] /= mx; b[j] /= mx; } return mx; };      // 1 = the hardest moment of the film
      if (norm(thL, thR) > 0) { ev.thL = thL; ev.thR = thR; } if (norm(ruL, ruR) > 0) { ev.ruL = ruL; ev.ruR = ruR; } });
    // ---- the falls: power = share of the stream x root of (width x height), 11 for the main fall of this valley; it falls off with the distance to the lens ----
    part('falls', () => { const F = HASW && Water.S && Water.S.falls; if (!F || !F.length) return; const fl = new Float32Array(nc), fr = new Float32Array(nc); let any = 0;
      for (const w of F) { if (!w || w.wet === false || !(w.k > 0)) continue; const x = (w.x + w.fx) / 2, y = (w.y + WY) / 2, z = (w.z + w.fz) / 2, pw = w.k * Math.sqrt(Math.max(w.w1, 0.5) * Math.max(w.y - WY, 1)) / 11;
        for (let k = 0; k < nc; k++) { const g = pw * 60 / (60 + dcam(k, x, y, z)), px = 0.5 + 0.42 * Math.max(-1, Math.min(1, sxi(k, x, y, z))); fl[k] += g * (1 - px); fr[k] += g * px; any += g; } }
      if (any > 0) { ev.fallL = fl; ev.fallR = fr; } });
    // ---- birds (the bird mesh's own instance tables, 72_air.js buildBirds: c0 = perch and first flight or the centre of a circuit, c1 c2 c3 = the
    //      circuit or the flights, d = span, seed, wing beats a second, kind + glide, e = perched?, one flight only?). A wing is heard on its
    //      downstroke: the shader's wing phase is fl = t hz 2 pi + 40 seed, and the wing comes down fastest at fl = pi ----
    part('birds', () => { const A = Air.S.birds.geometry.attributes, c0 = A.aC0.array, c1 = A.aC1.array, c2 = A.aC2.array, c3 = A.aC3.array, dd = A.aD.array, ee = A.aE.array, nb = A.aC0.count, out = [], WX = Air.WX === +Air.WX ? Air.WX : -1;
      const push = (t, x, y, z, g, ref, kind) => { if (!(t > 0.05 && t < DUR - 2.3)) return; const k = ck(t), d = dcam(k, x, y, z), gg = g / (1 + d * d / ref); if (gg > 0.03) out.push([t, sxi(k, x, y, z), gg, kind]); };
      const run = (x, k) => x - (1 - Math.exp(-k * x)) / k;
      const orbit = (o, t) => { const a = c1[o + 2] * (t - c2[o + 2]) + c1[o + 3], cy = Math.cos(c0[o + 3]), sy = Math.sin(c0[o + 3]), zc = c1[o + 1] * c2[o + 1] * Math.cos(c2[o + 1] * a), lx = c1[o] * Math.cos(a), lz = c1[o + 1] * Math.sin(c2[o + 1] * a), sg = c1[o + 2] < 0 ? -1 : 1;      // orbitP of the bird shader
        let tx = (-c1[o] * Math.sin(a) * cy + zc * sy) * sg, tz = (c1[o] * Math.sin(a) * sy + zc * cy) * sg; const tl = Math.max(Math.hypot(tx, tz), 1e-3), lat = c2[o + 3] * (1 + 0.25 * Math.sin(t * 0.7 + dd[o + 1] * 17)), ii = 1 - sm(c3[o + 1], c3[o + 1] + 6.5, t), oo = Math.max(t - c3[o + 2], 0), fl = 25 * run(oo, 1.1);
        return q.set(c0[o] + lx * cy + lz * sy + tz / tl * lat - WX * 105 * ii * ii + WX * 0.62 * fl, c0[o + 1] + c2[o] * Math.cos(a - c3[o + 3]) + c3[o] + 0.5 * Math.sin(t * 0.9 + dd[o + 1] * 29) + 26 * ii * ii + 0.21 * fl + 6 * (1 - Math.exp(-oo * 0.8)), c0[o + 2] - lx * sy + lz * cy - tx / tl * lat - 70 * ii * ii - 0.76 * fl); };
      for (let i = 0; i < nb; i++) { const o = i * 4, hz = dd[o + 2], phs = dd[o + 1] * 40, kind = Math.floor(dd[o + 3]), gl = dd[o + 3] - kind; if (!(hz > 0.5)) continue;
        const first = tt => (Math.PI - phs + TAU * Math.ceil((tt * hz * TAU + phs - Math.PI) / TAU)) / (TAU * hz);      // the first downstroke at or after tt
        if (ee[o] > 0.5) { for (const t0 of ee[o + 1] > 0.5 ? [c0[o + 3]] : [c0[o + 3], c2[o + 1]]) if (t0 < 1e8) for (let t = first(t0), j = 0; j < 9; j++, t += 1 / hz) push(t, c0[o], c0[o + 1] + 0.6 * j, c0[o + 2], Math.pow(0.82, j), 2500, 0); }      // off a roof or out of a crown: nine claps, each softer
        else if (kind < 1.5) for (let t = first(Math.max(0, c3[o + 1] - 0.3)), t1 = Math.min(DUR - 2.3, c3[o + 2] + 9); t < t1; t += 1 / hz) { const flap = gl > 0 ? lerp(1, sm(-0.25, 0.35, Math.sin(t * (0.5 + 0.5 * dd[o + 1]) + dd[o + 1] * 50)), gl) : 1; if (flap < 0.3 || t < c3[o + 1] - 0.3) continue;
          orbit(o, t); push(t, q.x, q.y, q.z, 0.6 * flap * dd[o] * dd[o] / 2.4, 900, 1); } }      // egrets and cranes on their circuits (a gliding bird makes no sound; 2.4 = an egret's span squared)
      out.sort((a, b) => b[2] - a[2]); if (out.length > 4200) out.length = 4200; if (out.length) ev.wings = flat(out); });
    part('breath', () => { const sw = Dragon.Choreo && Dragon.Choreo.swell; if (typeof sw !== 'function') return; const b = new Float32Array(16 * HZ + 1); let mx = 0; for (let i = 0; i < b.length; i++) { b[i] = sw(i / HZ, 20) - 1; if (b[i] > mx) mx = b[i]; } if (mx > 0.01) { ev.br = b; ev.brMax = mx; } });      // the chest, 20 m behind the head
    // ---- the lake after an entry: its rings reach the shore (Water.bedAt finds the waterline). The SPLASH's ring is the effects module's: radius
    //      3 + 22 (1 - exp(-d / 0.45)) + 6 d metres after d seconds (70_fx.js, uRipA); a body going in or out sends the lake's own ring at 4.4 m/s (68_water.js, scanDragons) ----
    part('wash', () => { if (!HASW || typeof Water.bedAt !== 'function') return; const src = [], out = [], A = Film.A, sp = Water.S && Water.S.splash;
      const fxT = r => { let a = 0, b = 12; for (let k = 0; k < 24; k++) { const d = (a + b) / 2; if (3 + 22 * (1 - Math.exp(-d / 0.45)) + 6 * d < r) a = d; else b = d; } return b; };
      src.push([sp && sp.t === +sp.t ? sp.t : T.SPLASH, sp && sp.x === +sp.x ? sp.x : A.splash.x, sp && sp.z === +sp.z ? sp.z : A.splash.z, 1, fxT, 7]);
      const L = ev.laps || []; for (let j = 0; j < L.length; j += 6) if (!L[j + 5]) for (const e of [0, 1]) { const t = L[j + e], s = red.sOf(t); let best = 1e9, bx = 0, bz = 0; for (let a = 0; a <= red.LEN; a += 4) { if (s - a < 0.7) break; red.pathAt(s - a, q); const y = Math.abs(q.y - red.RMAX * red.rProf(a) - WY); if (y < best && inLake(q.x, q.z) > 0) { best = y; bx = q.x; bz = q.z; } } if (best < 4) src.push([t, bx, bz, e ? 0.3 : 0.6, r => r / 4.4, 3]); }
      for (const s of src) for (let a = 0; a < 20; a++) { const dx = Math.cos(a * TAU / 20 + 0.1), dz = Math.sin(a * TAU / 20 + 0.1); let r = 1.5; while (r < 70 && inLake(s[1] + dx * r, s[2] + dz * r) > 0.05) r += 0.75; if (r >= 70) continue; const x = s[1] + dx * r, z = s[2] + dz * r;
        for (let j = 0; j < s[5]; j++) { const t = s[0] + s[4](r) + j * 0.85; if (t > DUR - 3) break; const k = ck(t), d = dcam(k, x, WY, z), g = s[3] * Math.pow(0.72, j) / Math.sqrt(1 + r / 8) / (1 + d * d / 2500); if (g > 0.012) out.push([t, sxi(k, x, WY, z), g]); } }      // crest after crest, 0.85 s apart (a 5 m wave at 6 m/s: the lake's own numbers for the rings that come back off the cliffs), each lower: seven after the SPLASH, three after a body
      if (out.length) ev.wash = flat(out); });
    // ---- hung things: a lantern thrown by a front (Arch.swing: its baked pendulum; a knock where its swing is fastest), cloth filled as a gust front reaches a building ----
    part('lantern', () => { const Ls = Arch.lanterns; if (!Ls || !Ls.length || typeof Arch.swing !== 'function' || !Arch.swing(0, 1)) return; const out = [], HS = 15;
      for (let i = 0; i < Ls.length; i++) { const p = Ls[i].p; if (!p) continue; let p1 = Arch.swing(i, 0).deg, w1 = 0, w2 = 0, last = -9;
        for (let j = 1; j <= DUR * HS; j++) { const t = j / HS, d0 = Arch.swing(i, t).deg, w = Math.abs(d0 - p1) * HS; if (w1 > 20 && w1 >= w && w1 > w2 && t - last > 0.45) { const tt = t - 1 / HS, k = ck(tt), d = dcam(k, p.x, p.y, p.z); out.push([tt, sxi(k, p.x, p.y, p.z), Math.sqrt(Math.min(1, w1 / 160)) / (1 + d * d / 1600)]); last = tt; } w2 = w1; w1 = w; p1 = d0; } }
      out.sort((a, b) => b[2] - a[2]); if (out.length > 420) out.length = 420; if (out.length) ev.knocks = flat(out); });
    part('cloth', () => { const B = G.info.archBoxes; if (!gust || !B) return; const out = [];
      for (const tag of Object.keys(B)) { const b = B[tag]; if (!b || !b.wmin || !b.wmax) continue; const x = (b.wmin[0] + b.wmax[0]) / 2, y = b.wmax[1] - 2, z = (b.wmin[2] + b.wmax[2]) / 2;
        for (const r of gust.g) { const t = gust.arr(r, x, z); if (!(t > 0.3 && t < DUR - 3)) continue; const k = ck(t), d = dcam(k, x, y, z); out.push([t, sxi(k, x, y, z), r[4] / (1 + d * d / 2500)]); } }
      if (out.length) ev.cloth = flat(out); });
    // ---- the light: the storm's shadow over the lens (Daylight.state: its depth; sunAt: the share of sun that still reaches the lens), and the moment the dusk line takes the lens ----
    part('light', () => { if (typeof Daylight === 'undefined' || typeof Daylight.state !== 'function') return; const S = { tint: [1, 1, 1] }, st = new Float32Array(nc); let any = 0;
      for (let k = 0; k < nc; k++) { const t = k / HZ; Daylight.state(t, S); const sun = typeof Daylight.sunAt === 'function' ? Math.min(1, Daylight.sunAt(CF[k * 10], CF[k * 10 + 1], CF[k * 10 + 2], t)) : 1; st[k] = (S.storm || 0) * (1 - sun); if (st[k] > any) any = st[k]; if (!(ev.tDusk > 0) && t > T.FINALE && S.duskK > 0.5 && sun < 0.5) ev.tDusk = t; }
      if (any > 0.05) ev.storm = st; });
    return ev;
  }
  function picture() {
    try {
      if (typeof Dragon === 'undefined' || !Dragon.red || !Dragon.white || !Dragon.red.headAt || !Film.camAt || !Film.lookAt || !Film.fovAt) return null;
      const V = THREE.Vector3, cam = new V(), at = new V(), f = new V(), r = new V(), d = new V(), h = new V(), up = new V(0, 1, 0), T = Film.T, DUR = Film.DUR, A = Film.A, HZ = 20;
      let th = 1; const aim = t => { Film.camAt(t, cam); Film.lookAt(t, at); f.subVectors(at, cam).normalize(); r.crossVectors(f, up).normalize(); th = Math.tan(Film.fovAt(t) * Math.PI / 360) * 16 / 9; };
      const sx = p => { d.subVectors(p, cam); const z = d.dot(f), x = z > 1 ? d.dot(r) / (z * th) : 0; return x === x ? Math.max(-1.5, Math.min(1.5, x)) : 0; };
      const n = DUR * HZ + 1, hr = new Float32Array(n), hw = new Float32Array(n), CF = new Float32Array(n * 10);      // CF: the film camera at each of those moments (position, forward, right, tan of half its field)
      for (let i = 0; i < n; i++) { const t = i / HZ; aim(t); hr[i] = sx(Dragon.red.headAt(t, h)); hw[i] = sx(Dragon.white.headAt(t, h)); CF.set([cam.x, cam.y, cam.z, f.x, f.y, f.z, r.x, r.y, r.z, th], i * 10); }
      const sxi = (k, x, y, z) => { const o = k * 10, dx = x - CF[o], dy = y - CF[o + 1], dz = z - CF[o + 2], zz = dx * CF[o + 3] + dy * CF[o + 4] + dz * CF[o + 5], v = zz > 1 ? (dx * CF[o + 6] + dy * CF[o + 7] + dz * CF[o + 8]) / (zz * CF[o + 9]) : 0; return v === v ? Math.max(-1.5, Math.min(1.5, v)) : 0; };      // screen x of a world point through the camera of sample k
      let ev = null; try { ev = world(CF, HZ, sxi); } catch (e) {}
      const at1 = (t, p) => { aim(t); return sx(p); };
      // lake exits: the first moment after the dive that the head is back above the water plane
      const wy = A.splash ? A.splash.y : 0.05, crowns = typeof FX !== 'undefined' && FX.S && Array.isArray(FX.S.exits) ? FX.S.exits : [];
      const exits = [Dragon.red, Dragon.white].map(D => { let below = false, te = -1;
        for (let t = T.SPLASH - 0.3; t < T.SPLASH + 4.5 && te < 0; t += 0.01) { D.headAt(t, h); if (h.y < wy - 0.6) below = true; else if (below && h.y > wy) te = t; }
        if (te < 0) return null;
        let a = te - 0.01, b = te; for (let k = 0; k < 8; k++) { const m = (a + b) / 2; if (D.headAt(m, h).y > wy) b = m; else a = m; }
        let t = b; const p = D.headAt(b, h).clone(); p.y = wy;
        for (const e of crowns) if (e && e.t === +e.t && e.p && Math.hypot(e.p.x - p.x, e.p.z - p.z) < 4 && Math.abs(e.t - b) < 0.2) { t = e.t; p.copy(e.p); }      // the crown the picture throws up for this head
        return { t, x: at1(t, p) }; });
      // into the cloud: each loong's own visibility after GONG
      const cloud = { r: null, w: null, shut: null };
      [Dragon.red, Dragon.white].forEach((D, k) => { try { let half = -1, out = -1; const s = {}, tg = D.tGone;
        if (tg === +tg && tg > T.GONG - 1.2 && tg < DUR - 1.2) { cloud[k ? 'w' : 'r'] = [tg, tg]; return; }      // the choreography says when the tail tip is through the rift
        for (let t = T.GONG - 1; t < DUR - 1.2 && out < 0; t += 0.02) { D.cfg.pose(t, s); const v = s.vis; if (v !== +v) break; if (half < 0 && v < 0.5) half = t; if (half >= 0 && v < 0.02) out = t; }
        if (half >= 0) cloud[k ? 'w' : 'r'] = [half, out < 0 ? half + 0.7 : out]; } catch (e) {} });
      try { if (typeof Sky !== 'undefined' && Sky.fx && typeof Film.apply === 'function') { const c = new THREE.PerspectiveCamera(50, 16 / 9, 1, 1000); let open = 0, pk = 0;       // the film's own rift envelope; whatever this leaves in Sky.fx is rewritten by the next frame
        for (let t = T.GONG - 0.5; t < DUR - 1 && cloud.shut === null; t += 0.05) { Film.apply(t, c, null); const v = Sky.fx.rift; if (v !== +v) break; if (v > pk) pk = v; if (pk > 0.3 && v < pk * 0.5) cloud.shut = t; } } } catch (e) {}
      const ax = {}; for (const [k, t] of [['clash1', T.CLASH1], ['clash2', T.CLASH2], ['splash', T.SPLASH], ['boltHit', T.BOLT + 0.12]]) if (A[k]) ax[k] = at1(t, A[k]);
      return { hx: { r: hr, w: hw, hz: HZ }, exits, cloud, ax, hit: typeof FX !== 'undefined' && FX.HIT === +FX.HIT ? FX.HIT : null, ev };      // hit: the bolt's flight time, if FX ever exports it
    } catch (e) { return null; }
  }
  // QA: ?stem=music | sfx | new (only the sounds added for the played world) | old (the film without them), ?solo=family[,family] (see Y in synth) and ?pre=gain export one layer at a fixed level
  const params = () => { const g = new Float32Array(Film.DUR * 20 + 1); for (let i = 0; i < g.length; i++) g[i] = Film.gust(i / 20); const pic = picture(), e = pic && pic.ev;
    if (e) G.info.scoreEv = { leap: e.tLeap, rear: e.tRear, laps: e.laps ? Array.from(e.laps, v => +v.toFixed(2)) : [], fronts: e.gf ? e.gf.length / 4 : 0, wings: e.wings ? e.wings.length / 4 : 0, wash: e.wash ? e.wash.length / 3 : 0, knocks: e.knocks ? e.knocks.length / 3 : 0, cloth: e.cloth ? e.cloth.length / 3 : 0, dusk: e.tDusk, bad: e.bad };
    return { SR, DUR: Film.DUR, T: Film.T, gust: g, STRIKES: Film.STRIKES || null, pic, stem: Q.get('stem') || undefined, solo: Q.get('solo') || undefined, pre: +Q.get('pre') || undefined }; };
  // The playable buffer is filled when the Worker returns, a slice per task, so the click for sound only has to start it.
  const fill = d => new Promise(res => { let b; try { b = new AudioBuffer({ numberOfChannels: 2, length: d[0].length, sampleRate: SR }); } catch (e) { res(null); return; }
    const n = d[0].length, CH = 1 << 17; let i = 0;
    const step = () => { const t0 = performance.now(); while (i < n && performance.now() - t0 < 2.5) { const m = Math.min(CH, n - i); b.copyToChannel(d[0].subarray(i, i + m), 0, i); b.copyToChannel(d[1].subarray(i, i + m), 1, i); i += m; } if (i < n) setTimeout(step, 0); else res(b); };
    step(); });
  // The picture is read once the page has drawn its first frame: only then has the light been planned (Daylight.plan lays the cloud shadows) and the
  // lanterns' swing table been baked (on the first tick). The loader calls start() one step before that, so start() waits for it (three seconds at
  // most: a page that never draws still gets its score).
  const settled = () => (typeof Daylight === 'undefined' || !Daylight.S || Daylight.S.t >= 0) && (typeof Arch === 'undefined' || typeof Arch.swing !== 'function' || !Arch.lanterns || !Arch.lanterns.length || !!Arch.swing(0, 1));
  function start() {
    if (ready) return ready;
    ready = new Promise(res => { const tAsk = performance.now(), begin = () => { const t0 = performance.now(), P = params(), done = d => { G.info.scoreMs = Math.round(performance.now() - t0); res(d); };
        G.info.scorePic = Math.round(performance.now() - t0);
        try { const w = new Worker(URL.createObjectURL(new Blob(['onmessage=e=>{const r=(' + synth.toString() + ')(e.data);postMessage(r,[r[0].buffer,r[1].buffer]);};'], { type: 'text/javascript' })));
          w.onmessage = e => { done(e.data); w.terminate(); }; w.onerror = () => done(synth(P)); w.postMessage(P); }
        catch (e) { done(synth(P)); } };
      const wait = () => { let ok = true; try { ok = settled(); } catch (e) {} if (ok || performance.now() - tAsk > 3000) begin(); else setTimeout(wait, 25); }; wait(); });
    bufP = typeof CAPTURE !== 'undefined' && CAPTURE ? Promise.resolve(null) : ready.then(fill).then(b => (abuf = b));
    return ready;
  }
  // ---- the film clock while sound is on ----
  // The picture runs on the display's own frame clock (document.timeline.currentTime: the time of the frame being drawn, the same origin
  // as performance.now() and regular to the microsecond) from an anchor (base). The anchor is slewed toward the place in the score that
  // is leaving the loudspeaker right now (ctx.getOutputTimestamp), by at most 0.05 % of real time: the picture never steps and never
  // drifts from the sound. If the two are ever far apart (the context was suspended, the machine slept), the SOUND is
  // restarted at the picture's place; the picture is never moved to find the sound, and never waits for a context that does not run.
  let base = 0, lastP = 0, tOn = 0, aStart = 0, aOff = 0, lat = 0, err = 0, far = 0, relaunched = 0, nLaunch = 0, tsOk = false;
  const fnow = () => { const p = pnow(), tl = document.timeline ? document.timeline.currentTime : null; return typeof tl === 'number' && p - tl / 1000 < 0.25 && tl / 1000 <= p ? tl / 1000 : p; };      // the frame's time; the wall clock when no frame is being drawn
  let held = false, tHold = 0, arming = false;                     // held: paused by Score.pause() at film time tHold
  const stamp = () => { try { const s = ctx.getOutputTimestamp && ctx.getOutputTimestamp(); if (s && s.performanceTime > 0 && s.contextTime > 0 && Math.abs(pnow() - s.performanceTime / 1000) < 0.25) return s; } catch (e) {} return null; };      // only a fresh stamp: a suspended context keeps its last one
  // where in the score the loudspeaker is at performance time p (seconds), or null while that cannot be known
  function heard(p) { if (!live || held || !ctx || ctx.state !== 'running') return null; const s = stamp(); tsOk = !!s;
    const c = s ? s.contextTime + (p - s.performanceTime / 1000) : ctx.currentTime - lat; return c < aStart ? null : aOff + (c - aStart); }
  function launch(tf, p) {                                         // start the looped score so that what is heard matches the film time tf at performance time p
    if (src) { try { src.onended = null; src.stop(); src.disconnect(); } catch (e) {} }
    src = ctx.createBufferSource(); src.buffer = abuf; src.loop = true; src.connect(gain);
    const s = stamp(), lead = 0.05, when = ctx.currentTime + lead; lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);      // latency is read here, once
    const tWhen = s ? s.performanceTime / 1000 + (when - s.contextTime) : p + lead + lat;                                         // the performance time at which `when` reaches the loudspeaker
    aOff = mod(tf + (tWhen - p)); aStart = when; src.start(when, aOff); live = true; nLaunch++; far = 0;
    const g = gain.gain; g.cancelScheduledValues(ctx.currentTime); g.setValueAtTime(0, ctx.currentTime); g.setValueAtTime(0, when); g.linearRampToValueAtTime(muted ? 0 : 1, when + 0.35);
  }
  function play(nowFn) {
    if (going) return going;                                       // a second click while the first is still starting joins it: one context, one source
    return going = (async () => {
      const AC = window.AudioContext || window.webkitAudioContext; ctx = ctx || new AC();
      const run = ctx.resume(); if (run && run.catch) run.catch(() => {});
      const d = await start(); await bufP;
      if (!abuf) { abuf = ctx.createBuffer(2, d[0].length, SR); abuf.copyToChannel(d[0], 0); abuf.copyToChannel(d[1], 1); }
      gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination);
      if (ctx.state !== 'running') await Promise.race([run, new Promise(r => setTimeout(r, 400))]).catch(() => {});       // a context that will not run does not hold the film
      const p = pnow(), tf = nowFn(); base = p - tf; lastP = p; tOn = p; playing = true;                                          // the film goes on from exactly where it is
      ctx.onstatechange = () => { if (ctx.state === 'running') arm(); };
      await arm();
    })();
  }
  // start the source at the film's place as soon as the context runs and its output timestamps are fresh (they take a moment to appear); once
  async function arm() {
    if (arming || live || held || !playing || !ctx || ctx.state !== 'running') return; arming = true;
    try { for (let k = 0; k < 6 && ctx.state === 'running' && !stamp(); k++) await new Promise(r => setTimeout(r, 15));
      if (!live && !held && ctx.state === 'running') { const q = pnow(); launch(mod(q - base), q); } } finally { arming = false; }
  }
  // Space: pause() stops the sound where it is and holds Score.time(); resume(t) lets sound and Score.time() go on from film time t (or from where they stopped)
  function pause() { if (!playing || held) return; tHold = mod(fnow() - base); held = true; live = false;
    if (src) { try { src.onended = null; src.stop(); src.disconnect(); } catch (e) {} src = null; }
    try { const r = ctx.suspend(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
  function resume(t) { if (!playing) return; if (t === +t) tHold = mod(t); else if (!held) tHold = mod(fnow() - base);
    const p = fnow(); base = p - tHold; lastP = p; far = 0; err = 0;
    if (held || t === +t) { held = false; if (src) { try { src.onended = null; src.stop(); src.disconnect(); } catch (e) {} src = null; } live = false; }
    try { const r = ctx.resume(); if (r && r.then) r.then(arm, () => {}); } catch (e) {} arm(); }
  function time() {
    if (held) return tHold;
    const p = fnow(), dt = Math.min(0.1, Math.max(0, p - lastP)); lastP = p;
    const a = heard(p);
    if (a !== null) { err = wrap(a - (p - base));                  // + : the sound is ahead of the picture
      if (Math.abs(err) > 0.08) { far += dt; if (far > 0.25 && p - relaunched > 2) { relaunched = p; launch(mod(p - base), p); } }
      else { far = 0; base -= Math.max(-0.0005, Math.min(0.0005, err * 0.6)) * dt; } }
    return mod(p - base);
  }
  function toggle() { if (!gain || pnow() - tOn < 0.6) return;      // the second half of a double click that started the sound does not mute it again
    if (ctx.state !== 'running') { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); return; }      // a context that has not started yet: this click tries again and changes nothing else
    muted = !muted; const g = gain.gain, c = ctx.currentTime; g.cancelScheduledValues(c); g.setValueAtTime(g.value, c); g.linearRampToValueAtTime(muted ? 0 : 1, c + 0.2); }
  async function wav() { const d = await start(), n = d[0].length, b = new DataView(new ArrayBuffer(44 + n * 4)); const W = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
    W(0, 'RIFF'); b.setUint32(4, 36 + n * 4, true); W(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 2, true); b.setUint32(24, SR, true); b.setUint32(28, SR * 4, true); b.setUint16(32, 4, true); b.setUint16(34, 16, true); W(36, 'data'); b.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { b.setInt16(44 + i * 4, Math.max(-1, Math.min(1, d[0][i])) * 32767, true); b.setInt16(46 + i * 4, Math.max(-1, Math.min(1, d[1][i])) * 32767, true); }
    const u = new Uint8Array(b.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  window.__exportWav = wav;
  // sync: QA readout { err: seconds the sound is ahead of the picture, ts: output timestamps in use, launches, state, latency }
  return { start, play, time, toggle, pause, resume, params, get running() { return !!ctx && ctx.state === 'running'; }, get paused() { return held; }, get sync() { return { err, ts: tsOk, launches: nLaunch, state: ctx ? ctx.state : 'none', lat, live, ct: live ? mod(aOff + ctx.currentTime - aStart - lat) : -1 }; }, get playing() { return playing; }, get muted() { return muted; } };
})();
