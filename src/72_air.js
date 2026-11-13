'use strict';
// ---- moving air and small life: what the valley does between the dragons' beats ----------------------------------------
//   mist      a sea of cloud between the spires, banner clouds streaming off the summits, tatters crossing the open valley, spray
//             rolling off the foot of the falls and thin wisps on the lake: puffs that TRAVEL along baked stream lines on the wind
//             clock (G.uWind), flow round the spires, are parted and dragged by the two bodies (Wake.U), thrown outward by every
//             pressure front (roar, clashes, bolt, splash, blast) and surge when a gust front crosses them. Their erosion noise lives
//             in stream space, so a stream is one torn body. Cloud FALLS over the lip of the gate cliff and off the left ledge are
//             sheets draped on the real rock, their texture running down them. Where a body cuts through a bank it drags torn
//             streamers after it (a table of the rails, built once).
//   gusts     Air.GUSTS: plane fronts that cross the valley every 4 to 5 s, rows [t0, heading x, heading z, speed, strength]; front k
//             reaches (x, z) at t0 + (x * hx + z * hz - Air.G_S0) / speed, G_S0 = -125. Mist, leaves, litter, dust, seeds, smoke and
//             (40_flora / 66_wake of the living round) the plants read this one table, so one front can be followed through all of them.
//             Air.gustAt(x, z, t) -> seconds since the newest front passed that point (JS, pure)
//   leaves    tied to the maples in world space, never to the lens: a thin calm fall under each crown (10 to 50 in frame), one plume
//             off one crown in three as a front reaches it, litter on the open ground that hops when the front arrives with a puff of
//             dust. Nothing above a crown, nothing in open sky. All of it is swept by a passing body and thrown by the blast.
//   shells    every pressure shell (the ROAR's ring, the clashes, the bolt, the blast) punches the mist clear behind a bright packed
//             rim and raises a wall of dust and shredded leaf that races outward over the open ground, the crown tops and the roofs
//   birds     real birds (body, S neck, bill, trailing legs, bent shaded wings, each on its own phase): ten egrets cross the opening
//             shot once 32 m or more from the lens, a few wheel at the gate, cranes round the spires, a skein far off, swallows low
//             over the lake, doves on the roof ridges that burst off when the red loong stirs (EMERGE) and flee at the ROAR, small
//             birds flushed out of a far crown as a body passes (never during the leap, the dive and the lake hit, 16.3 to 21.6 s),
//             a flight driven across the valley as the white loong comes down, egrets back in the air when it is over
//   light     the effects' light (fire, frost, the beam's star) tints the mist through a knee (it never burns out to a white pad),
//             the bodies throw their shadows on it, and under the BEAM the bank is ember on the red side and ice on the white side;
//             under the storm (Daylight.S.gloom, when the light module has it) the sky's fill on mist, smoke, dust, leaves and
//             birds goes slate
//   small     dust and seeds glittering where the sun reaches, incense smoke off the two burners laid over by the fronts,
//             fireflies over the lake in the dark closing seconds
// Everything is a pure function of film time (any t, any order); all tables are built once in build(); a frame allocates nothing.
// Reads:   G, Film (T, flashAt; the wind clock through G.uWind), Wake (U, GLSL, rails, groups), Dragon (headAt), Rock.L / Rock.sites,
//          Arch.burners (if exported), G.info.archBoxes + the roof mesh (perches), G.info.waterFalls (feet of the falls), FX.U (tPuff,
//          tNoise), FX.S.birds, FX.light, Post.fxU / GLSL_FXDEPTH, Flora.T.leaf; clSun / clSunAt of GLSL_FOG when the build has them
// Hides:   the old mist bank, falling leaves, motes and cranes of 70_fx.js (their meshes are switched invisible from here; 70_fx.js is untouched)
// SPLASH:  from 55.4 to 61 s the lake has the frame: the falls, the low streams and the gust dust are off, leaves drop to the old 2600 and
//          motes to 500 (they shrink away before and grow back after: pure in t), so this module costs no more there than the old air did
// URL:     air=0 leaves the old effects as they were; airx=mist,trail,leaf,bird,mote,smoke,fly drops single systems. Air.S.off = true (run time) puts the old air back for a cost probe.
const Air = (() => {
  const ON = Q.get('air') !== '0', DROP = (Q.get('airx') || '').split(',');
  const has = k => DROP.indexOf(k) < 0;
  // ONE WIND: toward -x (as GLSL_WIND, the cloud shadows and the sky have it) and down the valley toward the lens. The table below is the
  // master: the plants' module reads Air.GUSTS at its build (rows [t0, hx, hz, speed, strength], arrival = t0 + (x*hx + z*hz + 125) / speed),
  // so a crown heaves, sheds and the mist surges on the same front. Keep the row format and the 125.
  // (LW: only if a wake module ever exports a periodic train of its own as Wake.WIND { d, D2, L2, C2, S2 } does this module follow that instead.)
  const LW = (typeof Wake !== 'undefined' && Wake.WIND && Wake.WIND.D2 && Wake.WIND.L2 > 0) ? Wake.WIND : null;
  const WX = LW ? (LW.d[0] < 0 ? -1 : 1) : -1;
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), V4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);
  const PMB = m => { m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendEquation = THREE.AddEquation; return m; };
  const f3 = x => (+x).toFixed(4), info = {}, S = {}, NG = 4;
  const MSH = GLSL_FOG.includes('clSunAt') ? [0.42, 0.44, 0.58] : [0.50, 0.33, 0.45];        // mist out of the sun (the sky's fill) in fair weather
  const HAS_SUN = GLSL_FOG.includes('clSunAt');                                    // the light builder's moving cloud shadows
  const SUNC = `vec3(${f3(SUN_COL.r)}, ${f3(SUN_COL.g)}, ${f3(SUN_COL.b)})`, sunAt = p => HAS_SUN ? `clSun(${p})` : 'vec3(1.0)';
  // ---- gust fronts: [t0 (s) the front enters at the upwind corner, heading x, heading z, speed (m/s), strength] ----
  // A front needs about 4.3 s from the upwind corner to the gate and 5.5 s to the near downwind wall.
  const G_S0 = -125, G_LIFE = 15;                 // dot(p.xz, heading) at the upwind corner; seconds a front keeps a slot
  const WOB = LW ? 0.22 * LW.L2 / LW.C2 : 0, WSEED = LW ? LW.S2 : 0, frac = x => x - Math.floor(x);     // the plants' fronts are not ruled lines: they run ahead here and hang back there
  const OWN = [[-3.1, 0.90, 0.44, 30, 0.9], [1.4, 0.97, 0.24, 31, 0.9], [5.9, 0.82, 0.57, 31, 1.25] /* crosses the gate at 10.2: EMERGE */, [10.6, 0.93, 0.37, 32, 1.1] /* 14.9: DRUMS */, [16.0, 0.86, 0.51, 30, 1.0],
    [20.2, 0.95, 0.31, 33, 1.2] /* behind the ROAR */, [24.6, 0.80, 0.60, 30, 0.9], [28.9, 0.92, 0.39, 32, 1.2] /* 33.2: the white loong is down */, [33.4, 0.88, 0.47, 29, 0.9], [38.0, 0.96, 0.28, 32, 1.0],
    [43.3, 0.84, 0.54, 31, 1.1], [47.4, 0.93, 0.37, 30, 0.9], [52.0, 0.89, 0.46, 30, 0.8], [57.5, 0.95, 0.31, 31, 1.0], [62.0, 0.85, 0.53, 30, 0.9],
    [66.4, 0.92, 0.39, 30, 1.1], [70.9, 0.97, 0.24, 30, 1.0], [75.4, 0.86, 0.51, 29, 0.9], [79.9, 0.93, 0.37, 28, 0.8]];
  for (const g of OWN) { const l = Math.hypot(g[1], g[2]); g[1] *= WX / l; g[2] /= l; }
  const GUSTS = !LW ? OWN : (() => { const out = []; for (let n = Math.ceil(LW.S2 + (-8 * LW.C2 - G_S0) / LW.L2); out.length < 40; n++) { const t0 = ((n - LW.S2) * LW.L2 + G_S0) / LW.C2; if (t0 > 90) break;
    out.push([t0, LW.D2[0], LW.D2[1], LW.C2, 1.3 * (0.35 + 0.65 * frac(n * 0.6180339 + LW.S2 * 3.7))]); } return out; })();
  const gArr = (g, x, z) => g[0] + (x * g[1] + z * g[2] - G_S0) / g[3] - WOB * Math.abs(frac((-x * g[2] + z * g[1]) * 0.0069 + WSEED) - 0.5);           // when front g reaches (x, z)
  function gustAt(x, z, t) { let best = 1e9; for (const g of GUSTS) { const tau = t - gArr(g, x, z); if (tau >= 0 && tau < best) best = tau; } return best; }
  const U = {
    uAT: { value: 0 },                                                             // film time
    uACam: { value: V() },                                                         // the film camera (the lake's mirror pass has another: wrap boxes must not follow it)
    uAGu: { value: Array.from({ length: NG }, () => V4(1, 0, 1e9, 30)) },          // heading x, heading z, arrival time at the origin, speed
    uAGa: { value: Array.from({ length: NG }, () => V4()) },                       // strength, age of the slot, index mod 3, index mod 2
    uAShift: { value: new THREE.Vector2() },                                       // what the fronts that are over have carried every loose thing (in strengths: times metres per strength)
    uAK: { value: V4(0, 0, 1, 0) },                                                // x: 1 while the lake is torn up (SPLASH: detail is dropped), y: dusk 0..1 (OUT), z: master, w: lightning 0..1+
    uALp: { value: V4() }, uALc: { value: V() },                                   // the effects' one point light: position + intensity, colour
    uABm: { value: V4() }, uABx: { value: V(1, 0, 0) },                            // the BEAM: its meeting point + how much it is on (0..1), the unit line from the red mouth to the white one
    uAE: { value: V4() },                                                          // x: the storm's gloom 0..1 (the light module's Daylight.S.gloom when the build has it): everything here that is lit by the sky goes darker and colder under it
    uMShade: { value: V() },      // mist out of the sun (the sky's fill)
    uMSun: { value: HAS_SUN ? 1.05 : 0.98 },                                       // mist in the sun: times SUN_COL
  };
  const GLSL_U = /* glsl */`
    uniform float uAT, uWind; uniform vec3 uACam; uniform vec4 uAGu[${NG}], uAGa[${NG}], uAK, uALp, uAE, uABm; uniform vec3 uALc, uABx; uniform vec2 uAShift;`;
  // tau since front k passed p (<= 0: not yet), and the two answers built on it:
  //   airSurge  soft bodies (mist, smoke): carried along, then let go          airCarry  loose things (leaves, seeds): carried along and left there
  const GLSL_GUST = /* glsl */`
    float airTau(int k, vec3 p){ vec4 g = uAGu[k]; return uAT - g.z - dot(p.xz, g.xy) / g.w${LW ? ` + ${f3(WOB)} * abs(fract(dot(p.xz, vec2(-g.y, g.x)) * 0.0069 + ${f3(WSEED)}) - 0.5)` : ''}; }
    vec3 airSurge(vec3 p, out float band){ vec3 d = vec3(0.0); band = 0.0;
      for (int k = 0; k < ${NG}; k++){ float A = uAGa[k].x; if (A <= 0.0) continue; float tau = airTau(k, p); if (tau <= 0.0) continue;
        d += vec3(uAGu[k].x, 0.10, uAGu[k].y) * (A * (1.0 - exp(-tau / 0.45)) * exp(-tau / 3.2));
        band += A * exp(-(tau - 0.3) * (tau - 0.3) / 0.10); }
      return d; }
    // the newest front of class cls (index mod 3; cls < 0: any) that has reached o, delay seconds ago: seconds since, its heading and strength
    float airFront(vec3 o, float cls, float delay, out vec2 hd, out float A){ hd = vec2(1.0, 0.0); A = 0.0; float best = -1.0;
      for (int k = 0; k < ${NG}; k++){ if (uAGa[k].x > 0.0 && (cls < 0.0 || abs(uAGa[k].z - cls) < 0.5)){ float tk = airTau(k, o) - delay; if (tk > 0.0 && (best < 0.0 || tk < best)){ best = tk; hd = uAGu[k].xy; A = uAGa[k].x; } } }
      return best; }
    vec3 airCarry(vec3 p, out float kick){ vec3 d = vec3(uAShift.x, 0.0, uAShift.y); kick = 0.0;
      for (int k = 0; k < ${NG}; k++){ float A = uAGa[k].x; if (A <= 0.0) continue; float tau = airTau(k, p); if (tau <= 0.0) continue;
        float e = exp(-tau / 0.7); d += vec3(uAGu[k].x, 0.0, uAGu[k].y) * (A * (1.0 - e)); d.y += A * 0.6 * tau * e; kick += A * e; }
      return d; }`;
  // the wake of the two bodies as soft and loose things feel it: shoved off the body's line, dragged along it, thinned to nothing right at it;
  // and the pressure fronts (roar, clashes, bolt, splash, blast): thrown outward as the shell passes, drifting back over seconds
  const wakeGLSL = () => Wake.GLSL.split('#ifndef CL_WAKE')[0] + /* glsl */`
    vec3 airWake(vec3 p, out float hole){ vec3 dsp = vec3(0.0); hole = 0.0;
      for (int o = 0; o < ${2 * Wake.NS}; o += ${Wake.NS}){ if (uWkP[o].w <= 0.0) continue;
        float best = 1e9, br = 0.0; vec3 bv = vec3(0.0), bc = vec3(0.0);
        for (int j = 0; j < ${Wake.NS - 1}; j++){ vec4 A = uWkP[o + j], B = uWkP[o + j + 1]; vec3 ab = B.xyz - A.xyz; float h = clamp(dot(p - A.xyz, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
          vec3 q = A.xyz + ab * h, d = p - q; float dd = dot(d, d);
          if (dd < best){ best = dd; bv = mix(uWkV[o + j].xyz, uWkV[o + j + 1].xyz, h); br = mix(A.w, B.w, h); bc = q; } }
        float dist = sqrt(best), gap = max(dist - br, 0.0), mv = clamp(length(bv) / 14.0, 0.0, 1.0);
        dsp += bv * (0.20 * exp(-gap / 8.0)) + (p - bc) / max(dist, 0.05) * (6.5 * mv * exp(-gap / 5.0));
        hole = max(hole, mv * exp(-gap / 4.5)); }
      float l = length(dsp); return dsp * min(1.0, 17.0 / max(l, 1e-3)); }
    float airRim;                                                                    // set by airFronts: the compressed rim of a shell as it crosses p (0..1.6)
    vec3 airFronts(vec3 p, float reach, out float thin){ vec3 dsp = vec3(0.0); thin = 0.0; airRim = 0.0;
      for (int k = 0; k < ${Wake.NF}; k++){ vec4 H = uWkH[k]; float age = uWkT - uWkE[k].w;
        if (H.x > 0.0 && age > 0.0){ vec3 d = p - uWkE[k].xyz; float dist = length(d), tau = age - dist / H.y;
          if (tau > 0.0){ float a = H.x * H.w / (H.w + dist), rise = 1.0 - exp(-tau / 0.32), L = min(10.0, H.z + 3.6 + 150.0 / H.y), back = 1.0 - smoothstep(0.5 * L, 0.94 * L, age);      // (all the way back before the front gives up its slot, whichever wake module is in the build)
            dsp += d / max(dist, 0.5) * (reach * min(a, 2.0) * rise * (0.25 + 0.75 * exp(-tau / 3.2)) * back);
            thin = max(thin, min(a * 1.15, 0.96) * rise * exp(-tau / 2.6) * back);
            float q = (tau - 0.12) / 0.16; airRim += min(a, 1.6) * exp(-q * q); } } }
      return dsp; }
    // the newest shell that has reached o: seconds since (< 0: none), the way it throws things (outward), its strength there
    float airShell(vec3 o, out vec3 dir, out float a){ dir = vec3(1.0, 0.0, 0.0); a = 0.0; float best = -1.0;
      for (int k = 0; k < ${Wake.NF}; k++){ vec4 H = uWkH[k]; float age = uWkT - uWkE[k].w;
        if (H.x > 0.0 && age > 0.0){ vec3 d = o - uWkE[k].xyz; float dist = length(d), tau = age - dist / H.y;
          if (tau > 0.0 && (best < 0.0 || tau < best)){ best = tau; dir = d / max(dist, 0.5); a = H.x * H.w / (H.w + dist); } } }
      return best; }`;
  // the two bodies as the MIST feels them: airWake's shove and hole (a resting body keeps a clear skin of air too), and with them
  //   sight  0..1: this point lies between the lens and a body: mist thins to a haze there, it never veils the animal
  //   shade  0..1: a body stands between this point and the sun, or hangs close above it: the bank darkens under the loongs
  //   lsh    0..1: a body stands between this point and the effects' light (fire, frost, the beam's star): its shadow lies on the lit mist
  const bodyGLSL = () => /* glsl */`
    vec3 airBody(vec3 p, vec3 cam, out float hole, out float sight, out float shade, out float lsh){ vec3 dsp = vec3(0.0); hole = 0.0; sight = 0.0; shade = 0.0; lsh = 0.0;
      vec3 u = p - cam; float dp = length(u); u /= max(dp, 1e-3); vec3 Ld = uALp.xyz - p; float Ll = length(Ld); Ld /= max(Ll, 1e-3);
      for (int o = 0; o < ${2 * Wake.NS}; o += ${Wake.NS}){ if (uWkP[o].w <= 0.0) continue;
        float best = 1e9, br = 0.0; vec3 bv = vec3(0.0), bc = vec3(0.0);
        for (int j = 0; j < ${Wake.NS - 1}; j++){ vec4 A = uWkP[o + j], B = uWkP[o + j + 1]; vec3 ab = B.xyz - A.xyz; float h = clamp(dot(p - A.xyz, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
          vec3 q = A.xyz + ab * h, d = p - q; float dd = dot(d, d);
          if (dd < best){ best = dd; bv = mix(uWkV[o + j].xyz, uWkV[o + j + 1].xyz, h); br = mix(A.w, B.w, h); bc = q; }
          float on = step(0.01, min(A.w, B.w));
          vec3 a3 = A.xyz - cam, b3 = B.xyz - cam, ap = a3 - u * dot(a3, u), e = (b3 - u * dot(b3, u)) - ap; float hs = clamp(-dot(ap, e) / max(dot(e, e), 1e-4), 0.0, 1.0), rr = mix(A.w, B.w, hs);
          sight = max(sight, on * (1.0 - smoothstep(rr + 1.5, rr + 8.0, length(ap + e * hs))) * smoothstep(0.0, 5.0, mix(dot(a3, u), dot(b3, u), hs) - dp) * (j == 0 ? 1.0 : 0.75));
          vec3 sa = A.xyz - p, sb = B.xyz - p, aq = sa - SUN_DIR * dot(sa, SUN_DIR), es = (sb - SUN_DIR * dot(sb, SUN_DIR)) - aq; float h2 = clamp(-dot(aq, es) / max(dot(es, es), 1e-4), 0.0, 1.0), al = mix(dot(sa, SUN_DIR), dot(sb, SUN_DIR), h2), r2 = mix(A.w, B.w, h2);
          shade = max(shade, on * (1.0 - smoothstep(r2 * 0.6, r2 * 1.5 + 2.5 + 0.10 * al, length(aq + es * h2))) * step(0.0, al) * (1.0 - smoothstep(60.0, 130.0, al)));
          vec3 aw = sa - Ld * dot(sa, Ld), ew = (sb - Ld * dot(sb, Ld)) - aw; float hL = clamp(-dot(aw, ew) / max(dot(ew, ew), 1e-4), 0.0, 1.0), aL = mix(dot(sa, Ld), dot(sb, Ld), hL), rL = mix(A.w, B.w, hL);
          lsh = max(lsh, on * (1.0 - smoothstep(rL * 0.7, rL * 1.5 + 2.0 + 0.07 * aL, length(aw + ew * hL))) * step(0.5, aL) * step(aL, Ll)); }
        float dist = sqrt(best), gap = max(dist - br, 0.0), mv = clamp(length(bv) / 14.0, 0.0, 1.0);
        dsp += bv * (0.20 * exp(-gap / 8.0)) + (p - bc) / max(dist, 0.05) * ((6.5 * mv + 2.5) * exp(-gap / 5.0));
        hole = max(hole, max(mv, 0.5) * exp(-gap / 4.5));
        shade = max(shade, 0.6 * exp(-gap / 16.0) * smoothstep(0.0, 5.0, bc.y - p.y)); }
      float l = length(dsp); return dsp * min(1.0, 17.0 / max(l, 1e-3)); }`;
  // instanced quads: attrs = { name: [itemSize, Float32Array] }
  function quads(n, attrs, seg = 1) {
    const g = new THREE.InstancedBufferGeometry(); g.instanceCount = n;
    if (seg > 1) { const pg = new THREE.PlaneGeometry(1, 1, seg, seg); g.setAttribute('position', pg.attributes.position); g.setIndex(pg.index); }
    else { g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3)); g.setIndex([0, 1, 2, 1, 3, 2]); }
    for (const k of Object.keys(attrs)) g.setAttribute(k, new THREE.InstancedBufferAttribute(attrs[k][1], attrs[k][0]));
    return g;
  }
  const fxMat = (o, add) => { const m = new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false, ...o }); if (add) m.blending = THREE.AdditiveBlending; else PMB(m); return m; };

  // ================= mist =================
  const PW = 40;                                  // samples along a stream line
  // a stream: keys [u, x, y, z, half width, puff size, opacity, half height]; u is the puff's clock (0..1), so the spacing of the
  // keys in u IS the speed. T = seconds for one run in calm air. mode 0 = faces the lens, 1 = lies flat (ground mist on the lake).
  function streams() {
    const L = Rock.L, out = [], X = -WX;                  // X: the upwind side
    const add = (name, T, n, o, keys) => out.push({ name, T, n, keys, a: o.a ?? 0.4, stretch: o.stretch ?? 1, soft: o.soft ?? 6, mode: o.mode || 0, nowrap: o.nowrap ? 1 : 0, detail: o.detail ? 1 : 0, gap: o.gap || 0, lit: o.lit ?? 0, torn: o.torn || 0 });
    // far valley behind the spires: slow, huge, a second layer of parallax
    add('seaBack', 34, 26, { a: 0.78, soft: 14, nowrap: 1 }, [[0, 150 * X, 62, -178, 46, 70, 0, 20], [0.1, 120 * X, 60, -176, 46, 70, 1, 20], [0.5, 0, 56, -182, 50, 72, 1, 22], [0.9, -118 * X, 60, -186, 46, 70, 1, 20], [1, -150 * X, 62, -190, 46, 70, 0, 20]]);
    // the sea of cloud between the spires (behind the main spire's front face)
    add('seaFar', 22, 62, { a: 0.85, soft: 9 }, [[0, 96 * X, 46, -102, 34, 34, 0, 9], [0.08, 76 * X, 45, -101, 36, 34, 1, 9], [0.5, 0, 43, -100, 38, 36, 1, 10], [0.92, -76 * X, 46, -104, 36, 34, 1, 9], [1, -96 * X, 47, -106, 34, 34, 0, 9]]);
    // wisps streaming through the gaps in front of the main spire, behind the gate
    add('seaNear', 15, 38, { a: 0.36, soft: 6, stretch: 1.7 }, [[0, 66 * X, 41, -46, 17, 15, 0, 9], [0.1, 52 * X, 41, -45, 19, 16, 1, 9], [0.5, 0, 42, -42, 20, 17, 1, 10], [0.9, -52 * X, 43, -41, 19, 16, 1, 9], [1, -66 * X, 44, -40, 17, 15, 0, 9]]);
    // tatters crossing the open valley between the lens and the gate: few, thin, fast (the widest motion in the frame); never down on the lake
    add('drift', 12, 10, { a: 0.15, soft: 5, stretch: 2.0, nowrap: 1, detail: 1 }, [[0, 50 * X, 16, 27, 13, 12, 0, 4.5], [0.12, 38 * X, 16, 28, 14, 13, 1, 4.5], [0.5, 0, 17, 30, 15, 13, 1, 5], [0.88, -34 * X, 18, 32, 14, 13, 1, 4.5], [1, -46 * X, 19, 33, 13, 12, 0, 4.5]]);
    // banner clouds: torn off the lee of each summit
    for (const s of S.summits) { const d = [WX * 0.92, 0.10, 0.37], p = (k, lift) => [s.x + d[0] * k, s.y - 3 + d[1] * k + lift, s.z + d[2] * k];
      // (thin, sheared down the wind, off the LEE shoulder a little below the top: wisps, never a white sausage with an opaque core)
      add('banner', 7.5, 26, { a: 0.50, soft: 4, stretch: 2.6, nowrap: 1, lit: 0.15, torn: 0.16 }, [[0, ...p(2, -2), 1.4, 4.5, 0, 1.2], [0.07, ...p(7, -1.5), 2.0, 6, 1, 1.6], [0.35, ...p(26, 0), 4.5, 10, 0.85, 3], [0.7, ...p(50, 3), 8, 15, 0.5, 4.5], [1, ...p(74, 8), 12, 20, 0, 6]]); }
    // cloud banked up behind the lip of the gate cliff and of the left ledge, where the cloud falls start (buildFalls drapes the falls themselves)
    const gy = L.gateY, le = L.leftLedge, PO = { a: 0.15, soft: 3, nowrap: 1, detail: 1, torn: 0.10 };
    add('gateBank', 15, 22, PO, [[0, 15.5 * X, gy + 2.2, -11.0, 2.0, 7, 0, 0.9], [0.12, 12 * X, gy + 2.0, -10.6, 2.0, 8, 1, 0.9], [0.5, 0, gy + 1.9, -10.2, 2.0, 8, 1, 0.9], [0.88, -12 * X, gy + 2.0, -10.6, 2.0, 8, 1, 0.9], [1, -15.5 * X, gy + 2.2, -11.0, 2.0, 7, 0, 0.9]]);
    // spray billowing from the foot of each fall: it rolls out over the water, is taken by the wind and lifts as it thins
    const feet = (G.info.waterFalls || []).filter(q => !/dry/.test(q)).map(q => q.split(' ').map(Number)).map(q => [q[4], q[5]]); if (!feet.length) feet.push([0, -3.8], [-26.5, 14.1], [22.2, 33.8]);
    for (const [fx, fz] of feet) if (fz < 20) add('spray', 8, Math.abs(fx) < 4 ? 14 : 8, { a: 0.36, soft: 2.2, nowrap: 1, detail: 1, lit: 0.1, torn: 0.08 }, [[0, fx, 1.3, fz + 0.5, 2.0, 4.5, 0, 0.6], [0.12, fx + WX * 1.2, 1.6, fz + 1.6, 2.6, 5.5, 1, 0.7], [0.45, fx + WX * 5.5, 4.0, fz + 4.0, 3.6, 7.5, 0.75, 1.4], [0.8, fx + WX * 11, 8.5, fz + 6, 4.8, 9.5, 0.3, 2.0], [1, fx + WX * 15, 12, fz + 7, 5.5, 10.5, 0, 2.4]]);      // (the fall beside the lake pavilion is left bare: its spray would veil the pavilion)
    // ground mist on the lake: thick only at the foot of the falls, thin streaks running down the valley past the lens
    add('lakeWisps', 20, 26, { a: 0.30, soft: 1.2, stretch: 2.3, mode: 1, nowrap: 1, detail: 1 }, [[0, 0, 1.1, -3, 15, 9, 0, 0.35], [0.08, 0, 1.1, 2, 15, 9, 1, 0.35], [0.2, 0, 1.0, 10, 16, 9, 0.6, 0.3], [0.55, -2, 0.95, 36, 14, 10, 0.5, 0.3], [0.88, -4, 0.95, 60, 9, 10, 0.42, 0.3], [1, -5, 0.95, 70, 8, 10, 0, 0.3]]);
    return out;
  }
  function bakePaths(st) {
    const data = new Float32Array(PW * st.length * 2 * 4), tmp = new Float32Array(PW * 7);
    st.forEach((s, r) => {
      const ks = s.keys;
      for (let j = 0; j < PW; j++) { const u = j / (PW - 1); let i = 1; while (i < ks.length - 1 && u > ks[i][0]) i++; const a = ks[i - 1], b = ks[i], k = clamp((u - a[0]) / (b[0] - a[0])); for (let c = 0; c < 7; c++) tmp[j * 7 + c] = lerp(a[c + 1], b[c + 1], k); }
      for (let pass = 0; pass < 2; pass++) { const o = tmp.slice(); for (let j = 1; j < PW - 1; j++) for (let c = 0; c < 7; c++) tmp[j * 7 + c] = 0.25 * o[(j - 1) * 7 + c] + 0.5 * o[j * 7 + c] + 0.25 * o[(j + 1) * 7 + c]; }
      for (let j = 0; j < PW; j++) { data.set([tmp[j * 7], tmp[j * 7 + 1], tmp[j * 7 + 2], tmp[j * 7 + 3]], ((r * 2) * PW + j) * 4); data.set([tmp[j * 7 + 4], tmp[j * 7 + 5], tmp[j * 7 + 6], 0], ((r * 2 + 1) * PW + j) * 4); }
    });
    const tex = new THREE.DataTexture(data, PW, st.length * 2, THREE.RGBAFormat, THREE.FloatType); tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true; return tex;
  }
  // the five spires the mist flows round: x, z, radius at the foot, radius at the top, top (m). (30_rock.js builds them from these numbers.)
  const spires = () => { const m = Rock.L.main; return [[m.x, m.z, m.r0, m.r1, m.top], [-18, -54, 9.0, 4.4, 72], [-3, -41, 5.2, 2.7, 45], [39, -80, 11.5, 5.2, 86], [-45, -96, 14, 6.2, 120]]; };
  // what a puff of mist looks like, shared by the streams and the torn streamers: vL = which side the sun is on, vSunC = the sun that reaches it
  const MIST_FS = () => /* glsl */`${Post.GLSL_FXDEPTH} uniform sampler2D tPuff, tNoise; uniform vec3 uMShade; uniform vec4 uAK;
    varying vec2 vUv, vNuv; varying float vVZ, vA, vL, vSoft, vFogK, vShade, vTorn; varying vec3 vFogC, vAdd, vSunC;
    void main(){ vec4 tx = texture2D(tPuff, vUv); vec3 nz = texture2D(tNoise, vNuv).rgb;
      float a = tx.a * smoothstep(0.30 + vTorn, 0.58 + 2.2 * vTorn, nz.r * 0.60 + nz.b * 0.40 + tx.g * 0.34 - 0.10) * vA * softZ(vVZ, vSoft);
      if (a < 0.003) discard;
      float sh = clamp(0.56 + 0.24 * vL + (tx.r - 0.5) * 0.7 + (nz.g - 0.5) * 0.6, 0.0, 1.0);      // mist is thin: its far side is nearly as bright as its near one
      vec3 c = (uMShade * (0.80 + 0.20 * sh) * (1.0 - 0.35 * vShade) + vSunC * (sh * (1.0 - 0.85 * vShade)) + vAdd) * vFogK + vFogC;
      gl_FragColor = vec4(c * a, a); }`;
  // the end of a mist vertex stage: wp = the vertex in the world, off = its offset from the puff's centre, size, a = opacity so far
  const MIST_TAIL = /* glsl */`
      vec4 mv = viewMatrix * vec4(wp, 1.0); vVZ = mv.z; gl_Position = projectionMatrix * mv; vA = a;
      vec3 f0 = clFog(vec3(0.0), wp, cameraPosition), f1 = clFog(vec3(1.0), wp, cameraPosition); vFogC = f0; vFogK = f1.r - f0.r;
      vSunC = ${SUNC} * uMSun * ${sunAt('wp')} * (1.0 - ${HAS_SUN ? '0.0' : '0.62'} * uAK.y);
      // the effects' light on the mist: it never burns out to a white pad (a knee), a body between the light and the mist throws its shadow
      // on it, and under the BEAM the bank is ember on the red loong's side and ice on the white one's, meeting under the star
      vec3 ld = uALp.xyz - wp; float lk = uALp.w * 0.010 / (1.0 + dot(ld, ld) / 500.0); lk /= 1.0 + 0.32 * lk;
      vec3 lc = mix(uALc, mix(vec3(1.0, 0.40, 0.09), vec3(0.36, 0.62, 1.0), smoothstep(-13.0, 13.0, dot(wp - uABm.xyz, uABx))), uABm.w);
      vAdd = lc * (lk * (1.0 - 0.82 * lSh)) + vec3(0.55, 0.66, 1.0) * (uAK.w * 0.55);
      if (a < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`;
  function buildMist(fx) {
    const st = streams(), NSr = st.length, sp = spires(), r = rng(7201);
    let n = 0; for (const s of st) n += s.n;
    const aP = new Float32Array(n * 4), aQ = new Float32Array(n * 4); let o = 0;
    st.forEach((s, row) => { for (let i = 0; i < s.n; i++, o++) {
      let lat = r() * 2 - 1; if (s.gap) lat = (s.gap + (1 - s.gap) * Math.abs(lat)) * (lat < 0 ? -1 : 1);        // (the main fall is left clear)
      aP.set([row, (i + r()) / s.n, lat, (r() + r() + r()) / 1.5 - 1], o * 4); aQ.set([0.72 + 0.62 * r(), r(), 0.5 + 0.5 * r(), r()], o * 4); } });
    const uSt = st.map(s => V4(1 / (1.15 * s.T), s.stretch, s.soft, s.mode)), uSu = st.map(s => V4(s.a, s.nowrap, s.detail, s.lit));
    // the erosion noise lives in the stream's own space (metres across, metres along) and rides with it: puffs that overlap erode alike, so a stream is one torn body, not a pile of discs
    const uSv = st.map(s => { let len = 0, sz = 0; for (let i = 1; i < s.keys.length; i++) { const a = s.keys[i - 1], b = s.keys[i]; len += Math.hypot(b[1] - a[1], b[2] - a[2], b[3] - a[3]); sz += b[5]; } sz /= s.keys.length - 1; return V4(len, 1 / (1.5 * sz + 5), 0, 0); });
    const m = fxMat({
      uniforms: { ...Post.fxU, ...Wake.U, ...U, uWind: G.uWind, tPath: { value: bakePaths(st) }, tPuff: FX.U.tPuff, tNoise: FX.U.tNoise, uSt: { value: uSt }, uSu: { value: uSu }, uSv: { value: uSv }, uATorn: { value: st.map(q => q.torn) } },
      vertexShader: /* glsl */`${GLSL_NOISE}${GLSL_FOG}${GLSL_U}${GLSL_GUST}${wakeGLSL()}${bodyGLSL()}
        attribute vec4 aP, aQ; uniform sampler2D tPath; uniform vec4 uSt[${NSr}], uSu[${NSr}], uSv[${NSr}]; uniform float uMSun;
        varying vec2 vUv, vNuv; varying float vVZ, vA, vL, vSoft, vFogK, vShade, vTorn; varying vec3 vFogC, vAdd, vSunC;
        uniform float uATorn[${NSr}];
        const vec4 SP[5] = vec4[5](${sp.map(s => `vec4(${f3(s[0])}, ${f3(s[1])}, ${f3(s[2])}, ${f3(s[3])})`).join(', ')}); const float ST[5] = float[5](${sp.map(s => f3(s[4])).join(', ')});
        vec4 pathA(int row, float u, out vec4 B, out vec3 tg){ float f = clamp(u, 0.0, 1.0) * ${f3(PW - 1)}, i = min(floor(f), ${f3(PW - 2)}), k = f - i; ivec2 a = ivec2(int(i), row * 2);
          vec4 A0 = texelFetch(tPath, a, 0), A1 = texelFetch(tPath, a + ivec2(1, 0), 0); B = mix(texelFetch(tPath, a + ivec2(0, 1), 0), texelFetch(tPath, a + ivec2(1, 1), 0), k); tg = A1.xyz - A0.xyz; return mix(A0, A1, k); }
        void main(){ int row = int(aP.x + 0.5); vec4 K = uSt[row], K2 = uSu[row]; float sd = aQ.y;
          float u = fract(aP.y + uWind * K.x * (0.96 + 0.08 * aQ.w)); vec4 B; vec3 tg; vec4 A = pathA(row, u, B, tg);
          vec3 th = vec3(tg.x, 0.0, tg.z); float thl = length(th); th = thl > 1e-4 ? th / thl : vec3(0.0, 0.0, 1.0); vec3 side = vec3(th.z, 0.0, -th.x);
          float size = B.x * aQ.x;
          vec3 c = A.xyz + side * (aP.z * A.w) + vec3(0.0, aP.w * B.z, 0.0);
          c += vec3(sin(uWind * 0.21 + sd * 40.0), 0.4 * sin(uWind * 0.17 + sd * 71.0), cos(uWind * 0.19 + sd * 53.0)) * (0.05 * size + 0.3);
          if (K2.y < 0.5) for (int k = 0; k < 5; k++){ vec4 s = SP[k]; vec2 d = c.xz - s.xy; float l = length(d), R = mix(s.z, s.w, clamp((c.y + 6.0) / (ST[k] + 6.0), 0.0, 1.0)) + 0.30 * size;
            if (l < R && c.y < ST[k] + 3.0) c.xz = s.xy + d / max(l, 0.01) * mix(l, R, 0.85); }
          // the quad: across the lens (turned along the stream where the stream stretches it), or lying flat on the lake
          vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]), ex, ey;
          if (K.w > 0.5) { ex = th; ey = side; }
          else { vec2 tv = vec2(dot(tg, cr), dot(tg, cu)); float tl = length(tv); float ra = sd * 6.283 + uAT * 0.03 * (aQ.w - 0.5);
            vec2 ax = K.y > 1.05 && tl > 0.05 * length(tg) ? tv / tl : vec2(cos(ra), sin(ra)); ex = cr * ax.x + cu * ax.y; ey = cu * ax.x - cr * ax.y; }
          vec2 q = position.xy; vec3 off = (ex * (q.x * K.y) + ey * q.y) * size; vec3 wp = c + off;
          vL = dot(off, SUN_DIR) / (0.5 * size) + K2.w;
          float hole, thin, band, sight, shade, lSh; vec3 dsp = airBody(wp, uACam, hole, sight, shade, lSh) + airFronts(wp, 13.0, thin) + airSurge(wp, band) * 7.0; wp += dsp;
          float rim = airRim; vShade = shade; vTorn = uATorn[row];
          vUv = position.xy + 0.5; float hv = (aP.w * B.z + off.y) * 0.7;
          vNuv = vec2(aP.z * A.w + dot(off, side) + hv, aP.y * uSv[row].x + dot(off, th) + hv * 0.7) * uSv[row].y + vec2(uAT * 0.004, -uAT * 0.003) + dsp.xz * 0.004;
          float ends = smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.92, 1.0, u));
          float a = K2.x * B.y * ends * aQ.z * (0.78 + 0.22 * sin(uWind * 0.13 + sd * 31.0)) * (1.0 - 0.9 * hole) * (1.0 - 0.82 * sight) * (1.0 - thin) * (1.0 + 0.4 * band + 2.6 * rim) * uAK.z;
          a *= 1.0 - K2.z * uAK.x;                                                        // SPLASH: the lake's own spray has the frame
          float dc = length(c - cameraPosition); a *= smoothstep(0.30 * size + 3.0, 1.1 * size + 9.0, dc); vSoft = K.z;
          a *= 1.0 - smoothstep(2.7, 4.0, projectionMatrix[1][1]) * (1.0 - smoothstep(35.0, 80.0, dc));      // a long lens (the face close-ups): no veil between it and its subject
          ${MIST_TAIL}
          vAdd += vec3(0.36, 0.34, 0.31) * rim * (1.0 - 0.4 * uAE.x); }`,
      fragmentShader: MIST_FS() });
    m.uniforms.uMSun = U.uMSun;
    const me = new THREE.Mesh(quads(n, { aP: [4, aP], aQ: [4, aQ] }, 4), m); me.frustumCulled = false; me.renderOrder = 0; me.name = 'airMist'; fx.add(me); S.mist = me;
    info.mist = n; info.streams = NSr; S.streams = st;
  }
  // ---- torn streamers: where a body cuts through a bank of mist it drags pieces of it along its line ----
  // One puff = one closed-form drift from its birth (thrown along the body's travel, slowing, widening, thinning). Built once from the rails.
  function buildTrail(fx) {
    const rails = Wake.rails, F = Film.T; if (!rails) return;
    const sum = S.summits, inMist = p => {
      if (p.y > 30 && p.y < 62 && p.z < -22 && p.z > -150) return 1;                     // the sea between the spires
      if (p.y < 5 && p.z > -8 && p.z < 75) return 0.7;                                    // ground mist on the lake
      for (const s of sum) { const k = (p.x - s.x) * WX; if (k > -6 && k < 60 && Math.abs(p.y - s.y) < 12 && Math.abs(p.z - s.z - 0.4 * k) < 14) return 0.8; }      // a banner cloud
      return 0; };
    const ev = [], p = V(), cv = V(), r = rng(7203);
    for (const D of rails) { const d = D.d;
      for (let j = D.j0; j <= D.j1; j += 2) { p.set(D.q[j * 3], D.q[j * 3 + 1], D.q[j * 3 + 2]); const w = inMist(p); if (!w) continue;
        for (let a = 14; a < d.LEN - 20; a += 26) { const t = D.tOfS(j * 2 + a + r() * 20); if (!(t > 0.3 && t < Film.DUR - 4) || (t > F.SPLASH - 0.8 && t < F.SPLASH + 2.4)) continue;
          const i = Math.min(D.NT - 1, Math.round(t * 60)), v = D.vT[i]; if (v < 8 || D.Wt[i] <= 0) continue;
          ev.push({ t, x: p.x, y: p.y, z: p.z, tx: D.tg[j * 3], ty: D.tg[j * 3 + 1], tz: D.tg[j * 3 + 2], v, w, R: d.RMAX }); } } }
    info.trailEv = ev.length; if (!ev.length) return;
    const N = Math.min(900, ev.length), aO = new Float32Array(N * 4), aV = new Float32Array(N * 4), aR = new Float32Array(N * 4); let tA = 1e9, tB = -1;
    for (let k = 0; k < N; k++) { const e = ev[Math.floor((k + r()) * ev.length / N)], th = r() * TAU, rr = e.R * (0.8 + 1.6 * r()), life = 2.6 + 2.2 * r(), kv = Math.min(e.v, 60) * (0.16 + 0.22 * r());
      // a frame across the body's line
      let nx = -e.tz, nz = e.tx; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl; const bx = e.ty * nz, by = e.tz * nx - e.tx * nz, bz = -e.ty * nx, c = Math.cos(th), s = Math.sin(th);
      let ox = (nx * c + bx * s), oy = by * s, oz = (nz * c + bz * s);
      Film.camAt(e.t, cv).sub(p.set(e.x, e.y, e.z)); if (ox * cv.x + oy * cv.y + oz * cv.z > 0) { ox = -ox; oy = -oy; oz = -oz; }        // (on the far side of the body from the lens)
      aO.set([e.x + ox * rr, e.y + oy * rr, e.z + oz * rr, e.t + 0.3 * r()], k * 4);
      aV.set([e.tx * kv + ox * 2.5, e.ty * kv + oy * 2.5 + 0.4, e.tz * kv + oz * 2.5, (2.6 + 3.4 * r()) * (0.7 + 0.5 * e.w)], k * 4);
      aR.set([r(), r(), life, (0.30 + 0.22 * r()) * e.w], k * 4); if (e.t < tA) tA = e.t; if (e.t + life + 0.4 > tB) tB = e.t + life + 0.4; }
    const m = fxMat({
      uniforms: { ...Post.fxU, ...Wake.U, ...U, uWind: G.uWind, tPuff: FX.U.tPuff, tNoise: FX.U.tNoise },
      vertexShader: /* glsl */`${GLSL_NOISE}${GLSL_FOG}${GLSL_U} attribute vec4 aO, aV, aR; uniform float uMSun;
        varying vec2 vUv, vNuv; varying float vVZ, vA, vL, vSoft, vFogK, vShade, vTorn; varying vec3 vFogC, vAdd, vSunC;
        void main(){ float tau = uAT - aO.w, lf = tau / aR.z, k = step(0.0, tau) * step(tau, aR.z), lSh = 0.0; vShade = 0.0; vTorn = 0.10;
          vec3 c = aO.xyz + aV.xyz * (1.0 - exp(-1.3 * tau)) / 1.3 + vec3(${f3(WX * 1.6)}, 0.25, 0.6) * tau;
          float size = aV.w * (0.6 + 2.4 * sqrt(max(lf, 0.0))), rot = aR.x * 6.283 + tau * (aR.y - 0.5) * 1.4; vec2 q = position.xy, rq = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
          vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 off = (cr * rq.x + cu * rq.y) * size, wp = c + off; vL = dot(off, SUN_DIR) / (0.5 * size);
          vUv = position.xy + 0.5; vNuv = position.xy * 0.5 + vec2(aR.x * 7.3, aR.y * 3.1 + tau * 0.05); vSoft = 2.5;
          float a = k * aR.w * smoothstep(0.0, 0.10, lf) * (1.0 - smoothstep(0.30, 1.0, lf)) * smoothstep(4.0, 14.0, length(c - cameraPosition)) * uAK.z;
          ${MIST_TAIL} }`,
      fragmentShader: MIST_FS() });
    m.uniforms.uMSun = U.uMSun;
    const me = new THREE.Mesh(quads(N, { aO: [4, aO], aV: [4, aV], aR: [4, aR] }), m); me.frustumCulled = false; me.renderOrder = 1; me.visible = false; me.name = 'airTrail'; fx.add(me);
    S.trail = me; S.trailT = [tA, tB]; info.trail = N;
  }

  // ---- cloud falls: cloud spilling over the lip of the gate cliff (either side of the waterfall) and off the left ledge, sinking down the
  // face like slow water and dissolving before it reaches the lake. A sheet draped over the real rock (its planting sites, read once);
  // the cloud's texture runs down it on the wind clock, stretching as it falls.
  function buildFalls(fx) {
    const st = Rock.sites || [], L = Rock.L, pos = [], uv = [], aS = [], idx = []; if (!st.length) return;
    const drape = (x0, x1, yTop, yBot, zLo, zHi, NX, NY) => {
      const cand = []; for (const q of st) { const p = q.p; if (p.x > x0 - 2.5 && p.x < x1 + 2.5 && p.y > yBot - 2.5 && p.y < yTop + 2.5 && p.z > zLo && p.z < zHi) cand.push(p); }
      if (cand.length < 20) return; const W1 = NX + 1, Z = new Float32Array(W1 * (NY + 1));
      for (let i = 0; i <= NX; i++) { const x = lerp(x0, x1, i / NX); let prev = null;
        for (let j = 0; j <= NY; j++) { const y = lerp(yTop, yBot, j / NY); let mz = -1e9; for (const p of cand) if (Math.abs(p.x - x) < 1.8 && Math.abs(p.y - y) < 1.8 && p.z > mz) mz = p.z; if (mz < -1e8) mz = prev === null ? zLo + 2 : prev; prev = mz; Z[j * W1 + i] = mz; } }
      for (let i = 0; i <= NX; i++) for (let j = 1; j <= NY; j++) { const k = j * W1 + i; Z[k] = Math.max(Z[k], Z[k - W1] - 0.5); }      // it falls free past an undercut
      for (let pass = 0; pass < 2; pass++) { const o = Z.slice(); for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { const a = o[j * W1 + Math.max(0, i - 1)], b = o[j * W1 + Math.min(NX, i + 1)], c = o[Math.max(0, j - 1) * W1 + i], d = o[Math.min(NY, j + 1) * W1 + i]; Z[j * W1 + i] = 0.4 * o[j * W1 + i] + 0.15 * (a + b + c + d); } }
      const base = pos.length / 3;
      for (let i = 0; i <= NX; i++) { let len = 0, px = 0, py = 0, pz = 0;
        for (let j = -2; j <= NY; j++) { const v = Math.max(j, 0) / NY, x = lerp(x0, x1, i / NX);        // two rows run in over the terrace before the lip
          const y = j < 0 ? yTop + 0.25 : lerp(yTop, yBot, v), z = j < 0 ? Z[i] + 2.2 * j : Z[Math.max(j, 0) * W1 + i] + 0.7 + 1.5 * sm(0, 0.5, v);
          if (j > -2) len += Math.hypot(y - py, z - pz); px = x; py = y; pz = z; pos.push(x, y, z); uv.push(i / NX, (j + 2) / (NY + 2)); aS.push(len); } }
      const H1 = NY + 3; for (let i = 0; i < NX; i++) for (let j = 0; j < H1 - 1; j++) { const a = base + i * H1 + j, b = a + H1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    };
    const gy = L.gateY, le = L.leftLedge;
    drape(-16.5, -4.8, gy + 0.4, 4, -16, 4, 14, 20); drape(4.8, 16.5, gy + 0.4, 4, -16, 4, 14, 20); drape(le.x + 2.6, le.x + 10, le.y + 0.2, 4, le.z - 2, le.z + 22, 9, 20);
    if (!idx.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1)); g.setIndex(idx);
    // the real waterfalls (wet or dry: a dry one may run in another build): the cloud keeps off them
    const wf = (G.info.waterFalls || []).map(q => parseFloat(q)).filter(Number.isFinite); while (wf.length < 4) wf.push(1e4); wf.length = 4;
    const m = fxMat({ uniforms: { ...Post.fxU, ...Wake.U, ...U, uWind: G.uWind, tNoise: FX.U.tNoise },
      vertexShader: /* glsl */`${GLSL_NOISE}${GLSL_FOG}${GLSL_U}${GLSL_GUST}${wakeGLSL()} attribute float aS; uniform float uMSun;
        varying vec2 vUv; varying vec3 vP, vFogC, vAdd, vSunC; varying float vVZ, vS, vK, vFogK;
        void main(){ vec3 wp = position; float v = uv.y, hole, thin, band;
          wp.z += (sin(wp.x * 0.5 + uWind * 0.6 + v * 5.0) * 0.5 + sin(wp.x * 1.3 - uWind * 0.9) * 0.25) * v;                   // it billows as it falls
          wp += (airSurge(wp, band) * 2.2 + airFronts(wp, 7.0, thin)) * smoothstep(0.1, 0.6, v) + airWake(wp, hole) * 0.4;
          vK = (1.0 - 0.9 * hole) * (1.0 - thin) * (1.0 + 0.4 * band) * (1.0 - uAK.x) * uAK.z;
          vUv = uv; vS = aS; vP = wp; vec4 mv = viewMatrix * vec4(wp, 1.0); vVZ = mv.z; gl_Position = projectionMatrix * mv;
          vec3 f0 = clFog(vec3(0.0), wp, cameraPosition), f1 = clFog(vec3(1.0), wp, cameraPosition); vFogC = f0; vFogK = f1.r - f0.r;
          vSunC = ${SUNC} * uMSun * ${sunAt('wp')} * (1.0 - ${HAS_SUN ? '0.0' : '0.62'} * uAK.y);
          vec3 ld = uALp.xyz - wp; float lk = uALp.w * 0.010 / (1.0 + dot(ld, ld) / 500.0); vAdd = uALc * (lk / (1.0 + 0.32 * lk)) + vec3(0.55, 0.66, 1.0) * (uAK.w * 0.55); }`,
      fragmentShader: /* glsl */`${Post.GLSL_FXDEPTH} uniform sampler2D tNoise; uniform vec3 uMShade; uniform float uWind;
        varying vec2 vUv; varying vec3 vP, vFogC, vAdd, vSunC; varying float vVZ, vS, vK, vFogK;
        const vec4 FALLX = vec4(${wf.map(f3).join(', ')});
        void main(){ float v = vUv.y, s = pow(vS + 0.5, 0.78);                                           // the texture stretches as the cloud picks up speed
          vec2 q = vec2(vP.x * 0.060, s * 0.105 - uWind * 0.215);
          float n = texture2D(tNoise, q).r * 0.62 + texture2D(tNoise, q * vec2(2.3, 1.9) + vec2(0.37, -uWind * 0.11)).g * 0.38;
          // STRANDS: 1 to 3 m across, many metres long, each pouring at its own pace; rock shows between them
          float st = texture2D(tNoise, vec2(vP.x * 0.150, s * 0.014 - uWind * 0.030)).b * 0.62 + texture2D(tNoise, vec2(vP.x * 0.37 + 0.3, s * 0.030 - uWind * 0.062)).r * 0.38;
          float strand = smoothstep(0.50, 0.63, st);
          float eu = smoothstep(0.0, 0.26, vUv.x) * (1.0 - smoothstep(0.74, 1.0, vUv.x)), top = smoothstep(0.0, 0.17, v);          // ragged sides, a soft start behind the lip
          vec4 fd = abs(vec4(vP.x) - FALLX); float keep = smoothstep(2.4, 4.6, min(min(fd.x - 2.6, fd.y), min(fd.z, fd.w)));      // (the sluice is 2.6 m wider than the side falls)
          float thr = mix(0.28, 0.66, smoothstep(0.06, 0.70, v)) + (1.0 - eu) * 0.30 + (1.0 - top) * 0.22;
          float a = smoothstep(thr, thr + 0.24, n) * mix(1.0, strand, smoothstep(0.10, 0.24, v)) * top * (1.0 - smoothstep(0.28, 0.66, v)) * (0.25 + 0.75 * eu) * 0.50 * keep * vK * softZ(vVZ, 1.6);
          if (a < 0.003) discard;
          float sh = clamp(0.30 + (n - thr) * 2.4, 0.0, 1.0);
          vec3 c = (uMShade * (0.72 + 0.28 * sh) + vSunC * sh + vAdd) * vFogK + vFogC;
          gl_FragColor = vec4(c * a, a); }` });
    m.uniforms.uMSun = U.uMSun;
    const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.renderOrder = 0; me.name = 'airFalls'; fx.add(me); S.falls = me; info.falls = idx.length / 3;
  }

  // ================= leaves (opaque, in the scene: the lake mirrors them) =================
  // A camera in an autumn gorge records leaves only where a tree sheds them. Three kinds, every one tied to the valley, none to the lens:
  //   calm    now and then a leaf lets go of a maple: 1 to 1.5 m/s down on a side-to-side zigzag, drifting with the wind, landing under
  //           its own crown; a front that crosses while it is in the air carries it off down the wind
  //   plume   when a front reaches a crown, one crown in three throws a burst that streams 15 to 25 m down the wind, tapers, sinks, lands
  //   litter  lying on open ground: it hops when a front arrives, and every pressure shell (the ROAR's ring) throws it outward in a low wall
  // No leaf is higher than its crown plus the few metres a gust lifts it, none hangs in open sky, and near the lens they shrink away.
  function buildLeaves(scene) {
    const NA = 560, NS = 1500, NL = 700, n = NA + NS + NL, r = rng(7204), aA = new Float32Array(n * 4), aB = new Float32Array(n * 4), aC = new Float32Array(n * 4);
    // the maples that shed: crowns from the wake tables, weighted toward the ones the lens stands among
    const trees = []; for (const g of (Wake.groups || [])) { if (!g.tear) continue; for (let i = 0; i < g.n; i++) { const x = g.ctr[i * 3], y = g.ctr[i * 3 + 1], z = g.ctr[i * 3 + 2], dz = z - clamp(z, 45, 81), d = Math.hypot(x + 3, y - 14, dz); trees.push({ x, y, z, R: g.R[i] / 0.75, w: 1 / (1 + (d / 45) * (d / 45)) }); } }
    const gnd = S.ground;
    // where a leaf of each crown comes to rest: the highest open ground under it, else the lake, else 8 m down the cliff it grows on
    for (const t of trees) { let gy = -1e9; for (const q of gnd) if (q.y < t.y && Math.abs(q.x - t.x) < 5 && Math.abs(q.z - t.z) < 5 && q.y > gy) gy = q.y; t.gy = gy > -1e8 ? gy + 0.1 : Math.max(0.1, t.y - t.R - 8); }
    // one crown in three answers a front (its class = the front's index mod 3); the crowns nearest the lens take classes 1, 2, 0 in turn,
    // so the nearest one sheds as the second front of the film crosses the opening shot
    trees.slice().sort((p, q) => q.w - p.w).forEach((t, k) => { t.cls = (k + 1) % 3; t.w1 = Math.pow(t.w, 1.5); t.w2 = Math.pow(t.w, 3); });      // (far crowns shed too, a few leaves: at 90 m a leaf is two pixels)
    let wsum = 0, w2sum = 0; for (const t of trees) { wsum += t.w1; w2sum += t.w2; }
    const pickT = (key, sum) => { let pick = r() * sum, t = trees[0]; for (const q of trees) { pick -= q[key]; if (pick <= 0) { t = q; break; } } return t; };
    const per = new Map();
    for (let i = 0; i < n; i++) {
      if (i >= NA + NS || !trees.length) { const q = gnd.length ? gnd[Math.floor(r() * gnd.length)] : (trees[0] || { x: 0, y: 1, z: 30 }); aA.set([q.x + (r() - .5) * 2.4, q.y + 0.1, q.z + (r() - .5) * 2.4, 3], i * 4); aB.set([r(), r(), r(), ((i % 3) + 0.5) / 3], i * 4); continue; }
      if (i < NA) { const t = pickT('w1', wsum), u = -0.9 + 1.1 * r(), th = r() * TAU, rr = (0.55 + 0.45 * Math.sqrt(r())) * t.R, sq = Math.sqrt(1 - u * u), y = t.y + u * rr * 0.8;
        const vs = 1.0 + 0.5 * (aB[i * 4] = r()), H = clamp(y - t.gy, 2.5, 16), fall = H / vs;
        aA.set([t.x + Math.cos(th) * sq * rr, y, t.z + Math.sin(th) * sq * rr, 0], i * 4); aB.set([r(), r(), r()], i * 4 + 1); aC.set([H, fall + 5 + 10 * r(), r(), (r() - .5) * 1.3], i * 4); continue; }
      const t = pickT('w2', w2sum), u = r() * 1.6 - 1, th = r() * TAU, rr = Math.cbrt(r()) * t.R, sq = Math.sqrt(1 - u * u); per.set(t, (per.get(t) || 0) + 1);
      aA.set([t.x + Math.cos(th) * sq * rr, t.y + u * rr * 0.8, t.z + Math.sin(th) * sq * rr, 1], i * 4); aB.set([r(), r(), r(), r()], i * 4); aC.set([t.gy, t.cls, (r() - .5) * 0.7, 0], i * 4);
    }
    const m = new THREE.ShaderMaterial({ side: THREE.DoubleSide, fog: false, alphaToCoverage: true,
      uniforms: { ...Wake.U, ...U, uWind: G.uWind, tLeaf: { value: Flora.T.leaf } },
      vertexShader: /* glsl */`${GLSL_U}${GLSL_GUST}${wakeGLSL()} attribute vec4 aA, aB, aC; varying vec2 vUv; varying vec3 vW, vN; varying float vHue;
        const vec2 WD = vec2(${f3(WX * 0.929)}, 0.370);
        vec2 rot2(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }
        void main(){ float kind = floor(aA.w + 0.1), sc = 0.0, spin = 0.0; vec3 p = aA.xyz;
          if (kind < 0.5) {                           // calm: one fall from the crown to the ground under it, then a wait
            float P = aC.y, tau = mod(uAT + aC.z * P, P), vs = 1.0 + 0.5 * aB.x, fall = aC.x / vs;
            if (tau < fall + 0.5) { vec2 hd = rot2(WD, aC.w); float zf = 6.283 * (1.0 + aB.y), ramp = min(tau * 1.5, 1.0), zz = sin(zf * tau + aB.z * 6.283);
              p += vec3(hd.x, 0.0, hd.y) * ((0.8 + 0.9 * aB.w) * tau) + vec3(-hd.y, 0.0, hd.x) * (0.5 * zz * ramp) + vec3(0.0, -vs * tau + 0.12 * ramp * cos(2.0 * zf * tau + aB.z * 12.566), 0.0);
              for (int k = 0; k < ${NG}; k++){ float A = uAGa[k].x; if (A <= 0.0) continue; float tk = airTau(k, aA.xyz); if (tk <= 0.0) continue;        // a front that crosses while it is in the air
                float g = A * (exp(-max(tk - tau, 0.0) / 1.3) - exp(-tk / 1.3)); p += vec3(uAGu[k].x * 11.0, 1.3, uAGu[k].y * 11.0) * g; }
              sc = smoothstep(0.0, 0.25, tau) * (1.0 - smoothstep(fall - 0.15, fall + 0.4, tau)); spin = tau * (1.8 + 2.2 * aB.w) + 2.0 * zz; } }
          else if (kind < 1.5) {                      // plume: torn off its crown as a front of its class passes: thrown down the wind, lifted, sinking, landing
            vec2 hd; float A, tau = airFront(aA.xyz, aC.y, aB.x * aB.x * 1.6, hd, A);
            if (tau > 0.0 && tau < 8.0) { hd = rot2(hd, aC.z); float e = 1.0 - exp(-1.1 * tau), v0 = (8.0 + 10.0 * aB.y) * A;
              p += vec3(hd.x, 0.0, hd.y) * (v0 * e / 1.1 + 1.6 * tau) + vec3(0.0, (0.5 + 3.0 * aB.z) * (1.0 - exp(-1.3 * tau)) / 1.3 - (1.1 + 0.6 * aB.w) * tau, 0.0);
              p += vec3(-hd.y, 0.0, hd.x) * (0.5 * sin(tau * (5.0 + 5.0 * aB.w) + aB.x * 19.0) * min(tau, 1.0));
              sc = smoothstep(0.0, 0.12, tau) * smoothstep(aC.x, aC.x + 0.5, p.y) * (1.0 - smoothstep(6.5, 8.0, tau)); spin = tau * (2.5 + 4.0 * aB.z) * (0.5 + e); } }
          else { vec3 sd; float sa, ts = airShell(aA.xyz, sd, sa);
            if (ts > 0.0 && ts < 3.4 && sa > 0.35) {  // litter under a pressure shell: thrown outward, a low wall that races over the ground with the shell
              float T = 1.1 + 0.9 * aB.y, s = clamp(ts / T, 0.0, 1.0), k = min(sa, 1.6); vec2 h2 = normalize(sd.xz + vec2(1e-4));
              p += vec3(h2.x, 0.0, h2.y) * ((5.0 + 9.0 * aB.z) * k * (1.0 - (1.0 - s) * (1.0 - s))) + vec3(0.0, (1.0 + 3.0 * aB.x) * k * 4.0 * s * (1.0 - s), 0.0);
              sc = smoothstep(0.0, 0.06, ts) * (1.0 - smoothstep(T + 0.5, T + 1.5, ts)); spin = min(ts, T) * (8.0 + 6.0 * aB.z); }
            else {                                    // litter in the valley's wind: lying until a front lifts it, tumbles it a few metres and drops it
              vec2 hd; float A, tau = airFront(aA.xyz, floor(aB.w * 3.0), aB.x * 0.8, hd, A), T = 1.3 + 1.3 * aB.y, s = clamp(tau / T, 0.0, 1.0);
              p += vec3(hd.x, 0.0, hd.y) * ((5.0 + 9.0 * aB.z) * A * (1.0 - (1.0 - s) * (1.0 - s))) + vec3(0.0, (1.0 + 2.2 * aB.y) * A * 4.0 * s * (1.0 - s), 0.0);
              sc = tau > 0.0 ? smoothstep(0.0, 0.10, tau) * (1.0 - smoothstep(T + 0.4, T + 1.4, tau)) : 0.0; spin = min(tau, T) * (5.0 + 5.0 * aB.z); } }
          float sz = 0.0;
          if (sc > 0.001) { float hole, thin; p += airWake(p, hole) * 1.2 + airFronts(p, 15.0, thin);
            sz = (0.15 + 0.08 * aB.z) * sc * (1.0 - smoothstep(0.86, 0.95, thin)) * smoothstep(3.0, 7.0, distance(uACam, p)); }      // (the blast sweeps the air clean; a leaf never crosses right in front of the lens)
          float a1 = spin + aB.w * 6.283, a2 = spin * 0.65 + aB.y * 6.283;
          vec3 ax = normalize(vec3(cos(a1), sin(a1) * 0.6, sin(a1))), ay = normalize(cross(ax, vec3(sin(a2), cos(a2), 0.3))); vN = normalize(cross(ax, ay));
          vec3 w = p + (ax * position.x + ay * position.y) * sz; vW = w; vUv = position.xy + 0.5; vHue = fract(aB.x * 7.13 + aB.z * 3.7);
          gl_Position = sz > 0.001 ? projectionMatrix * viewMatrix * vec4(w, 1.0) : vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: /* glsl */`${GLSL_NOISE}${GLSL_FOG} uniform sampler2D tLeaf; uniform vec4 uAK, uAE; varying vec2 vUv; varying vec3 vW, vN; varying float vHue;
        void main(){ vec4 t = texture2D(tLeaf, vUv); if (t.a < 0.4) discard; float lum = dot(t.rgb, vec3(0.6, 0.3, 0.1)) * 2.4 + 0.15;
          vec3 c = mix(vec3(0.40, 0.016, 0.028), vec3(0.64, 0.045, 0.020), smoothstep(0.0, 0.35, vHue)); c = mix(c, vec3(0.76, 0.18, 0.022), smoothstep(0.35, 0.62, vHue)); vec3 base = mix(c, vec3(0.80, 0.43, 0.045), smoothstep(0.62, 0.92, vHue)) * lum;
          float nl = abs(dot(normalize(vN), SUN_DIR));
          c = base * (${SUNC} * ${sunAt('vW')} * (1.7 * (0.3 + 0.7 * nl)) * (1.0 - ${HAS_SUN ? '0.0' : '0.6'} * uAK.y) + vec3(0.30, 0.27, 0.40) * (1.0 - 0.45 * uAE.x) + vec3(0.5, 0.6, 1.0) * uAK.w * 0.6);
          gl_FragColor = vec4(clFog(c, vW, cameraPosition), 1.0); }` });
    const me = new THREE.Mesh(quads(n, { aA: [4, aA], aB: [4, aB], aC: [4, aC] }), m); me.frustumCulled = false; me.name = 'airLeaves'; scene.add(me); S.leaves = me;
    let pm = 0; for (const v of per.values()) if (v > pm) pm = v;
    info.leaves = n; info.leafKinds = [NA, NS, NL]; info.trees = trees.length; info.litter = NL; info.plumeMax = pm; info.plumeCrowns = per.size; S.leafN = [n, n];
  }

  // ================= dust and seeds in the sun, fireflies, incense =================
  function buildMotes(fx) {
    const n = 600, r = rng(7205), aA = new Float32Array(n * 4), aB = new Float32Array(n * 4); for (let i = 0; i < n * 4; i++) { aA[i] = r(); aB[i] = r(); }
    const m = fxMat({ uniforms: { ...Post.fxU, ...U, uWind: G.uWind },
      vertexShader: /* glsl */`${GLSL_NOISE}${HAS_SUN ? GLSL_FOG : ''}${GLSL_U}${GLSL_GUST} attribute vec4 aA, aB; uniform vec2 uRes; varying vec2 vUv; varying float vA, vVZ;
        const vec3 BOX = vec3(48.0, 28.0, 48.0);
        void main(){ float ph = uWind * (0.5 + 0.7 * aB.x), seed = step(0.92, aA.w);                    // one in twelve is a seed: larger, it rides the warm air up
          vec3 q = aA.xyz * BOX + vec3(${f3(WX * 1.7)} * ph, (seed > 0.5 ? 0.35 : -0.10) * ph, 0.55 * ph) + vec3(sin(ph * 0.31 + aB.y * 6.283), 0.7 * sin(ph * 0.23 + aB.z * 6.283), cos(ph * 0.27 + aB.w * 6.283)) * 1.3;
          vec3 base = uACam + vec3(0.0, 5.0, -20.0), rel = mod(q - base + 0.5 * BOX, BOX) - 0.5 * BOX; float kick; vec3 cy = airCarry(base + rel, kick) * 7.0;
          rel = mod(q + cy - base + 0.5 * BOX, BOX) - 0.5 * BOX; vec3 p = base + rel;
          vec3 e = 0.5 - abs(rel) / BOX; float edge = smoothstep(0.0, 0.06, min(e.x, min(e.y, e.z)));
          vec4 mv = viewMatrix * vec4(p, 1.0); vVZ = mv.z;
          // shafts: the sun reaches the valley floor in bands (and, with the light module, only where no cloud shadow lies)
          vec3 e1 = normalize(cross(SUN_DIR, vec3(0.0, 1.0, 0.0))), e2 = cross(SUN_DIR, e1);
          float sh = smoothstep(0.46, 0.66, vnoise(vec2(dot(p, e1), dot(p, e2)) * 0.10 + vec2(uAT * 0.02, 0.0)))${HAS_SUN ? ' * clSunAt(p)' : ''};
          float tw = 0.5 + 0.5 * sin(uAT * (1.5 + 3.0 * aB.x) + aB.y * 40.0);
          vA = edge * (gl_InstanceID >= 300 ? 1.0 - uAK.x : 1.0) * (1.0 - smoothstep(15.0, 24.0, p.y)) * (0.04 + 0.96 * sh) * (0.35 + 0.65 * tw) * smoothstep(1.5, 6.0, -mv.z) * (1.0 + 1.5 * kick) * mix(1.0, 0.55, seed) * (1.0 - 0.7 * uAK.y);
          float sz = mix(0.012 + 0.022 * aB.z, 0.030 + 0.025 * aB.z, seed), px = -mv.z / (projectionMatrix[1][1] * uRes.y * 0.5) * 1.1, su = max(sz, px);      // never thinner than a pixel: it dims instead
          vA *= (sz / su) * (sz / su); mv.xy += position.xy * su * 2.0; vUv = position.xy * 2.0;
          gl_Position = vA > 0.01 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: `${Post.GLSL_FXDEPTH} varying vec2 vUv; varying float vA, vVZ; void main(){ float z = sceneZ(); if (z > vVZ || z < -0.9 * uFar) discard; float a = 1.0 - min(length(vUv), 1.0); gl_FragColor = vec4(${SUNC} * 2.6 * a * a * vA, 1.0); }` }, true);      // (lit dust shows against rock, trees and water; against the sky it would read as stars)
    const me = new THREE.Mesh(quads(n, { aA: [4, aA], aB: [4, aB] }), m); me.frustumCulled = false; me.renderOrder = 2; me.name = 'airMotes'; fx.add(me); S.motes = me; info.motes = n;
  }
  // dust and chaff lifted where a front arrives: every patch of open ground answers it in turn, so the front can be seen racing across the valley
  function buildGustDust(fx) {
    // Besides the open ground: the tops of the maple crowns and the roof ridges (aO.w >= 2). Only a pressure shell (the ROAR's ring, a
    // clash, the bolt, the blast) shakes dust, dew and leaf litter off those, so its wall is seen racing over the canopy and the roofs
    // from any lens, also one that looks over the terraces and never sees their floor.
    const gnd = S.ground, ng = Math.min(620, gnd.length), r = rng(7209), r2 = rng(7211), tops = []; if (!ng) return;
    for (const g of (Wake.groups || [])) { if (!g.tear) continue; for (let i = 0; i < g.n; i++) for (let k = 0; k < 5; k++) { const th = r2() * TAU, rr = 0.85 * g.R[i] * Math.sqrt(r2()); tops.push([g.ctr[i * 3] + Math.cos(th) * rr, g.ctr[i * 3 + 1] + (0.25 + 0.3 * r2()) * g.R[i], g.ctr[i * 3 + 2] + Math.sin(th) * rr]); } }
    { const bx = G.info.archBoxes || {}; for (const tag of ['gate', 'hallL', 'hallR', 'pavL', 'pavR']) { const b = bx[tag]; if (!b) continue; const [x0, , z0] = b.wmin, [x1, y1, z1] = b.wmax, m = tag === 'gate' ? 20 : 12;
      for (let k = 0; k < m; k++) tops.push([lerp(x0, x1, 0.12 + 0.76 * r2()), y1 - 1.0 - 4.5 * r2(), lerp(z0, z1, 0.2 + 0.6 * r2())]); } }
    const n = ng + tops.length, aO = new Float32Array(n * 4), aR = new Float32Array(n * 4);
    for (let i = 0; i < ng; i++) { const q = gnd[Math.floor((i + r()) * gnd.length / ng)]; aO.set([q.x, q.y + 0.4, q.z, r()], i * 4); aR.set([r(), r(), r(), r()], i * 4); }
    for (let i = ng; i < n; i++) { const q = tops[i - ng]; aO.set([q[0], q[1], q[2], 2], i * 4); aR.set([r2(), r2(), r2(), r2()], i * 4); }
    const m = fxMat({ uniforms: { ...Post.fxU, ...Wake.U, ...U, uWind: G.uWind, tPuff: FX.U.tPuff },
      vertexShader: /* glsl */`${GLSL_NOISE}${GLSL_FOG}${GLSL_U}${GLSL_GUST}${wakeGLSL()} attribute vec4 aO, aR; varying vec2 vUv; varying float vVZ, vA, vFogK; varying vec3 vFogC, vCol;
        void main(){ vec2 hd; float A, top = step(1.5, aO.w), tau = airFront(aO.xyz, -1.0, aR.x * 0.5, hd, A), life = 1.8 + 0.9 * aR.y, wall = 0.0;
          if (top > 0.5) tau = -1.0;                  // (the valley's wind raises nothing off a crown or a roof)
          vec3 sd; float sa, ts = airShell(aO.xyz, sd, sa);
          if (ts > 0.0 && ts < 2.6 && sa > 0.3) { tau = ts; A = min(sa, 1.6) * 1.5; hd = normalize(sd.xz + vec2(1e-4)); life = 1.3 + 0.9 * aR.y; wall = 1.0; }      // a pressure shell: a wall racing outward with it, 3 to 4 m high on open ground, torn off the canopy and the tiles in its path
          float lf = tau / life, tp = max(tau, 0.0), wt = wall * top;
          // thrown outward hard for the first third of a second (the shell itself carries it), then it hangs, climbs a little and is left to the wind
          vec3 p = aO.xyz + vec3(hd.x, 0.0, hd.y) * (mix(6.0 + 7.0 * aR.z, 11.0 + 12.0 * aR.z, wall) * A * (1.0 - exp(-mix(1.4, 2.6, wall) * tp))) + vec3(0.0, (0.5 + 1.1 * aR.w) * tp * (1.0 + wall + 0.8 * wt), 0.0)
            + vec3(${f3(WX * 0.93)}, 0.0, 0.37) * (1.6 * wall * tp * tp / (1.0 + tp));
          float size = (0.8 + 0.9 * aR.z) * (0.7 + 0.7 * wt + 2.3 * sqrt(max(lf, 0.0))) * (1.0 + 0.45 * wall + 0.35 * wt), rot = aR.x * 6.283 + tau * (aR.y - 0.5); vec2 q = position.xy, rq = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
          vec4 mv = viewMatrix * vec4(p, 1.0); mv.xy += rq * size * vec2(2.6, 1.6); vVZ = mv.z; gl_Position = projectionMatrix * mv; vUv = position.xy + 0.5;
          vA = tau > 0.0 && lf < 1.0 ? mix(0.13, 0.34 - 0.15 * top, wall) * A * smoothstep(0.0, mix(0.10, 0.05, wall), lf) * (1.0 - lf) * (1.0 - lf) * smoothstep(5.0, 16.0, -mv.z) * (1.0 - uAK.x) : 0.0;
          vec3 f0 = clFog(vec3(0.0), p, cameraPosition), f1 = clFog(vec3(1.0), p, cameraPosition); vFogC = f0; vFogK = f1.r - f0.r;
          // dust off the ground; off a crown or a roof: bark dust, dew and shredded leaf, many thin puffs that run together into one low wall
          vCol = (mix(vec3(0.26, 0.21, 0.21), vec3(0.29, 0.23, 0.22), wt) + ${SUNC} * ${sunAt('p')} * ((0.55 - 0.08 * wt) * (1.0 - ${HAS_SUN ? '0.0' : '0.6'} * uAK.y))) * (1.0 - 0.45 * uAE.x) + vec3(0.5, 0.6, 1.0) * uAK.w * 0.4;
          if (vA < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: /* glsl */`${Post.GLSL_FXDEPTH} uniform sampler2D tPuff; varying vec2 vUv; varying float vVZ, vA, vFogK; varying vec3 vFogC, vCol;
        void main(){ vec4 tx = texture2D(tPuff, vUv); float a = tx.a * vA * softZ(vVZ, 1.5); if (a < 0.003) discard;
          vec3 c = vCol * (0.6 + 0.6 * tx.r) * vFogK + vFogC; gl_FragColor = vec4(c * a, a); }` });
    const me = new THREE.Mesh(quads(n, { aO: [4, aO], aR: [4, aR] }), m); me.frustumCulled = false; me.renderOrder = 1; me.name = 'airGustDust'; fx.add(me); S.gdust = me; info.gustDust = n;
  }
  function buildFlies(fx) {
    const n = 460, r = rng(7206), aA = new Float32Array(n * 4), aB = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { aA.set([lerp(-23, 21, r()), 0.5 + 9 * r() * r(), lerp(6, 78, Math.sqrt(r())), r()], i * 4); aB.set([r(), r(), r(), r()], i * 4); }
    const m = fxMat({ uniforms: { ...Post.fxU, ...U, uFly: { value: 0 } },
      vertexShader: /* glsl */`${GLSL_U} attribute vec4 aA, aB; uniform float uFly; varying vec2 vUv; varying float vA, vVZ;
        void main(){ vec3 p = aA.xyz + vec3(sin(uAT * (0.23 + 0.2 * aB.x) + aB.y * 6.283) * 2.2, sin(uAT * (0.37 + 0.2 * aB.z) + aB.w * 6.283) * 0.7, cos(uAT * (0.19 + 0.2 * aB.y) + aB.x * 6.283) * 2.2);
          vec4 mv = viewMatrix * vec4(p, 1.0); vVZ = mv.z;
          float bl = pow(max(sin(uAT * (1.1 + 1.3 * aB.z) + aA.w * 6.283), 0.0), 4.0);
          vA = bl * uFly * smoothstep(2.0, 6.0, -mv.z); mv.xy += position.xy * (0.24 + 0.009 * -mv.z); vUv = position.xy * 2.0;
          gl_Position = vA > 0.01 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: Post.GLSL_FXDEPTH + 'varying vec2 vUv; varying float vA, vVZ; void main(){ if (sceneZ() > vVZ) discard; float r2 = dot(vUv, vUv), a = exp(-r2 * 26.0) + 0.16 * exp(-r2 * 5.0) * step(r2, 1.0); gl_FragColor = vec4(vec3(0.42, 1.0, 0.10) * a * vA, 1.0); }' }, true);
    const me = new THREE.Mesh(quads(n, { aA: [4, aA], aB: [4, aB] }), m); me.frustumCulled = false; me.renderOrder = 2; me.visible = false; me.name = 'airFlies'; fx.add(me); S.flies = me; info.flies = n;
  }
  // the tips of the incense sticks: Arch.burners when the halls export them, else the same arithmetic the halls are built with
  function burners() {
    if (typeof Arch !== 'undefined' && Arch.burners && Arch.burners.length) return Arch.burners.map(b => b.clone());
    const L = Rock.L, out = [], one = (x, y, z, w, d, yaw) => { const s = clamp(w / 11, 0.85, 1.15), zl = d / 2 + 2.2; out.push(V(x + Math.sin(yaw) * zl, y + 1.14 + 1.62 * s, z + Math.cos(yaw) * zl)); };
    one(L.leftLedge.x + 0.5, L.leftLedge.y - 0.3, L.leftLedge.z, 9.5, 7.5, 0.42); one(L.rightTer.x - 1, L.rightTer.y - 0.3, L.rightTer.z - 2, 15, 8.5, -0.45); return out;
  }
  function buildSmoke(fx) {
    const B = burners(), per = 48, n = B.length * per, r = rng(7208), aO = new Float32Array(n * 4), aR = new Float32Array(n * 4); if (!n) return;
    for (let i = 0; i < n; i++) { const b = B[Math.floor(i / per)]; aO.set([b.x, b.y, b.z, ((i % per) + r()) / per], i * 4); aR.set([r(), r(), r(), r()], i * 4); }
    const m = fxMat({ uniforms: { ...Post.fxU, ...Wake.U, ...U, uWind: G.uWind, tPuff: FX.U.tPuff },
      vertexShader: /* glsl */`${GLSL_NOISE}${GLSL_FOG}${GLSL_U}${GLSL_GUST}${wakeGLSL()} attribute vec4 aO, aR; varying vec2 vUv; varying float vVZ, vA, vFogK; varying vec3 vFogC, vCol;
        void main(){ float life = 7.5, a = fract(uAT / life + aO.w) * life, lf = a / life;
          // it rises straight for a hand's breadth, then the valley wind takes it; a front lays the whole column over
          vec3 p = aO.xyz + vec3(0.0, 1.15 * a - 0.04 * a * a, 0.0) + vec3(${f3(WX * 0.92)}, 0.0, 0.37) * (1.05 * (a - 2.2 * (1.0 - exp(-a / 2.2))));
          p += vec3(sin(a * 1.1 - uAT * 1.3 + aR.x * 1.5), 0.0, cos(a * 0.9 - uAT * 1.1 + aR.y * 1.5)) * (0.03 + 0.26 * a) + vec3(sin(aR.x * 40.0 + a), 0.3 * sin(aR.z * 40.0 + a * 1.3), cos(aR.y * 40.0 + a)) * (0.13 * a);      // it snakes as it climbs
          float band, hole, thin; p += airSurge(p, band) * (0.6 + 1.1 * a) + (airWake(p, hole) + airFronts(p, 12.0, thin)) * min(a * 0.5, 1.0);
          float size = (0.24 + 0.36 * a) * (0.7 + 0.6 * aR.w), rot = aR.z * 6.283 + a * (aR.w - 0.5) * 0.9; vec2 q = position.xy, rq = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
          vec4 mv = viewMatrix * vec4(p, 1.0); mv.xy += rq * size * 2.0; vVZ = mv.z; gl_Position = projectionMatrix * mv; vUv = position.xy + 0.5;
          vA = 0.46 * smoothstep(0.0, 0.03, lf) * pow(1.0 - lf, 1.4) * (0.45 + 0.55 * aR.x) * (1.0 - 0.8 * hole);
          vec3 f0 = clFog(vec3(0.0), p, cameraPosition), f1 = clFog(vec3(1.0), p, cameraPosition); vFogC = f0; vFogK = f1.r - f0.r;
          vCol = vec3(0.34, 0.36, 0.48) * (1.0 - 0.45 * uAE.x) + ${SUNC} * ${sunAt('p')} * (0.50 * (1.0 - ${HAS_SUN ? '0.0' : '0.6'} * uAK.y)) + vec3(1.0, 0.45, 0.16) * (0.5 * exp(-a * 0.9)) + vec3(0.5, 0.6, 1.0) * uAK.w * 0.5;
          if (vA < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: /* glsl */`${Post.GLSL_FXDEPTH} uniform sampler2D tPuff; varying vec2 vUv; varying float vVZ, vA, vFogK; varying vec3 vFogC, vCol;
        void main(){ vec4 tx = texture2D(tPuff, vUv); float a = tx.a * vA * softZ(vVZ, 1.2); if (a < 0.003) discard;
          vec3 c = vCol * (0.62 + 0.55 * tx.r) * vFogK + vFogC; gl_FragColor = vec4(c * a, a); }` });
    const me = new THREE.Mesh(quads(n, { aO: [4, aO], aR: [4, aR] }), m); me.frustumCulled = false; me.renderOrder = 1; me.name = 'airSmoke'; fx.add(me); S.smoke = me; info.smoke = B.map(b => [+b.x.toFixed(1), +b.y.toFixed(1), +b.z.toFixed(1)]);
  }

  // ================= birds =================
  // One mesh drawn once per bird: a lathed body with the neck, head and bill of a heron (the species stretches or tucks the neck), two
  // legs trailing behind the tail, and two broad cambered wings with a rounded tip that hinge at the shoulder, the wrist and the hand:
  // the wing arches down through the downstroke and folds back on the upstroke. Lit like everything else: sun on the back, the
  // valley's blue fill underneath, so a wing goes light and dark through each beat.
  //   egret   0.95 m long, 1.35 m across, neck folded in an S with the head back on the shoulders, yellow dagger bill, black legs
  //   crane   2.3 m across, neck straight out, black neck, flight feathers and legs       dove, swallow: short neck, no legs showing
  // Two kinds of flight:
  //   circuit  a closed loop round a centre (an ellipse or a figure of eight), a place in the flock beside the leader's line, a time the flock
  //            arrives over the wall and a time it leaves the valley for good, each flock on its own heading
  //   event    a perch, a first flight (the doves on the gate roof burst off as the red loong stirs, wheel once and are gone) and a flight
  //            at the ROAR as its shell reaches the roof; or a single flight out of a tree crown at the moment a body passes it
  // Heading and bank come from the path itself (position a fifth of a second before and after).
  // Where birds are allowed: the one near flock crosses the opening shot once, 32 m or more from the lens (measured on the film's own
  // crane at load); everything round the main spire and over the lake has left before the loong leaps, so nothing white crosses the
  // animal in the dive, the lake hit and the face close-up (15 to 23 s); birds flushed out of a crown are kept only far from the lens.
  function perchSites(r) {
    const out = [], boxes = G.info.archBoxes || {}, want = { gate: 16, hallL: 5, hallR: 5, pavL: 4, pavR: 4 };
    const roof = G.scene.children.find(o => o.isMesh && o.geometry && o.geometry.index && G.info.arch_roof && Math.round(o.geometry.index.count / 3) === G.info.arch_roof);
    const P = roof ? roof.geometry.attributes.position.array : null;
    for (const tag of Object.keys(want)) { const b = boxes[tag]; if (!b) continue; const [x0, , z0] = b.wmin, [x1, y1, z1] = b.wmax, list = [];
      if (P) { let lo = 1e9, hi = -1e9; const idx = []; for (let i = 0; i < P.length; i += 3) if (P[i] >= x0 && P[i] <= x1 && P[i + 2] >= z0 && P[i + 2] <= z1) { idx.push(i); if (P[i + 1] < lo) lo = P[i + 1]; if (P[i + 1] > hi) hi = P[i + 1]; }
        const cut = hi - (tag[0] === 'p' ? 0.55 : 0.24) * (hi - lo), cand = idx.filter(i => P[i + 1] > cut);
        for (let tries = 0; tries < 4000 && list.length < want[tag] && cand.length; tries++) { const i = cand[Math.floor(r() * cand.length)]; let ok = true; for (const q of list) if (Math.hypot(q.x - P[i], q.y - P[i + 1], q.z - P[i + 2]) < 0.6) { ok = false; break; } if (ok) list.push(V(P[i], P[i + 1] + 0.10, P[i + 2])); } }
      while (list.length < want[tag]) list.push(V(lerp(x0, x1, 0.3 + 0.4 * r()), y1 - 0.3, lerp(z0, z1, 0.3 + 0.4 * r())));
      for (const p of list) { p.tag = tag; out.push(p); } }
    return out;
  }
  // the bird: x = along the span (-1..1 = wing tip to wing tip), y up, z forward. Returns position, normal and aK = part:
  // 0 body and tail, 1 neck and head, 2 bill, 3 legs, 4 wing (its normal carries only the camber: the hinges turn it in the shader)
  function birdMesh() {
    const pos = [], nor = [], part = [], NSD = 6;
    const tri = (a, b, c, na, nb, nc, pt) => { pos.push(...a, ...b, ...c); nor.push(...na, ...nb, ...nc); part.push(pt, pt, pt); };
    // rings: z, half width, half height, y of the centre, part of the stretch that follows
    const R = [[-0.62, 0.014, 0.007, 0.012, 0], [-0.44, 0.066, 0.036, 0.006, 0], [-0.22, 0.102, 0.094, 0, 0], [0.02, 0.120, 0.124, 0, 0], [0.20, 0.104, 0.120, -0.014, 1], [0.31, 0.070, 0.108, -0.050, 1], [0.37, 0.048, 0.074, -0.022, 1],
      [0.40, 0.038, 0.046, 0.030, 1], [0.47, 0.039, 0.041, 0.046, 1], [0.545, 0.024, 0.026, 0.040, 2], [0.80, 0.003, 0.003, 0.022, 2]];
    const rp = (k, j) => { const a = j / NSD * TAU, q = R[k]; return [Math.cos(a) * q[1], q[3] + Math.sin(a) * q[2], q[0]]; };
    const rn = (k, j) => { const a = j / NSD * TAU, q = R[k], x = Math.cos(a) * q[2], y = Math.sin(a) * q[1], l = Math.hypot(x, y) || 1; return [x / l, y / l, q[3]]; };      // (z: the ring's centre height, for the shader; a ring's normal has no z)
    for (let k = 0; k < R.length - 1; k++) for (let j = 0; j < NSD; j++) { const pt = R[k][4];
      tri(rp(k, j), rp(k + 1, j), rp(k + 1, j + 1), rn(k, j), rn(k + 1, j), rn(k + 1, j + 1), pt); tri(rp(k, j), rp(k + 1, j + 1), rp(k, j + 1), rn(k, j), rn(k + 1, j + 1), rn(k, j + 1), pt); }
    // legs: two thin blades from under the tail to 0.3 m behind it
    for (const sx of [-1, 1]) { const x = sx * 0.022, u = [0, 1, 0], A = [x - 0.008, -0.030, -0.36], B = [x + 0.008, -0.030, -0.36], C = [x + 0.006, -0.012, -1.06], D = [x - 0.006, -0.012, -1.06], E = [x, -0.046, -0.36], F = [x, -0.024, -1.06];
      tri(A, B, C, u, u, u, 3); tri(A, C, D, u, u, u, 3); tri(E, A, D, [sx, 0, 0], [sx, 0, 0], [sx, 0, 0], 3); tri(E, D, F, [sx, 0, 0], [sx, 0, 0], [sx, 0, 0], 3); }
    // wings: stations along the span: s, leading edge z, trailing edge z. Three lines (leading edge, a raised quarter chord, trailing edge)
    // give the section its camber; the normal's z says which way the surface tips (the hinges add the rest)
    const W = [[0.085, 0.17, -0.19], [0.20, 0.21, -0.21], [0.35, 0.24, -0.215], [0.50, 0.255, -0.20], [0.63, 0.235, -0.21], [0.76, 0.19, -0.22], [0.87, 0.125, -0.22], [0.95, 0.035, -0.19], [1.0, -0.06, -0.135]];
    for (const sx of [-1, 1]) for (let k = 0; k < W.length - 1; k++) { const a = W[k], b = W[k + 1], qa = lerp(a[1], a[2], 0.3), qb = lerp(b[1], b[2], 0.3), ca = 0.045 * (a[1] - a[2]), cb = 0.045 * (b[1] - b[2]);
      const L0 = [sx * a[0], 0, a[1]], L1 = [sx * b[0], 0, b[1]], M0 = [sx * a[0], ca, qa], M1 = [sx * b[0], cb, qb], T0 = [sx * a[0], 0, a[2]], T1 = [sx * b[0], 0, b[2]], nf = [0, 1, 0.42], nm = [0, 1, 0.0], nt = [0, 1, -0.16];
      tri(L0, L1, M1, nf, nf, nm, 4); tri(L0, M1, M0, nf, nm, nm, 4); tri(M0, M1, T1, nm, nm, nt, 4); tri(M0, T1, T0, nm, nt, nt, 4); }
    return { pos, nor, part };
  }
  function buildBirds(scene) {
    const r = rng(7207), F = Film.T, rows = [], M = Rock.L.main, cam = V(), look = V(), tv = V();
    const roarO = Dragon.red.headAt(F.ROAR + 0.1, V()), roarAt = (x, y, z) => F.ROAR + 0.1 + Math.hypot(x - roarO.x, y - roarO.y, z - roarO.z) / 55;
    const EGRET = 0, CRANE = 1, SWALLOW = 2, DOVE = 3;
    // ---- circuits: c0 = centre, yaw | c1 = Rx, Rz, omega, phase | c2 = Ay, z harmonic, lag (s), lateral (m) | c3 = vertical (m), tIn, tOut, phase of the height
    //      e = 0, 0, the way it leaves (azimuth, climb)
    const flock = (n, o) => { for (let i = 0; i < n; i++) { const k = Math.ceil(i / 2), sgn = i % 2 ? 1 : -1, sk = o.skein;
      const lag = sk ? k * sk[0] + 0.1 * r() : r() * (o.lag ?? 1.5), lat = sk ? sgn * k * sk[1] : (r() * 2 - 1) * (o.lat ?? 5), tOut = o.tOut === undefined ? 1e9 : o.tOut === 'roar' ? roarAt(o.c[0], o.c[1], o.c[2]) + 0.7 * r() : o.tOut + (o.tSpread ?? 0.8) * r();
      rows.push({ c0: [o.c[0], o.c[1], o.c[2], o.yaw || 0], c1: [o.Rx, o.Rz, TAU / o.T * (o.dir || 1), o.ph], c2: [o.Ay || 0, o.m || 1, lag, lat], c3: [sk ? 0.3 * (r() - .5) : (r() * 2 - 1) * (o.vert ?? 1.6), o.tIn ?? -1e9, tOut, o.aY || 0],
        d: [o.span * (0.92 + 0.16 * r()), r(), o.hz * (0.9 + 0.2 * r()), o.kind + (o.glide ?? 0.3)], e: [0, 0, (o.flee ?? FLEE0) + 0.5 * (r() - .5), 0.16 + 0.12 * r()] }); } };
    const FLEE0 = Math.atan2(-0.76, WX * 0.62);                // up the valley and off to the lee wall
    // the near flock: ten egrets cross the opening shot once, right to left, then leave over the lee wall as the red loong stirs. The
    // crossing is laid on the film's own crane: 40 m out along the lens's line at 5.2 s, level with the gate cliff, never nearer than 32 m
    { const tX = 5.2; Film.camAt(tX, cam); Film.lookAt(tX, look); const fx = look.x - cam.x, fz = look.z - cam.z, fl = Math.hypot(fx, fz) || 1, f = [fx / fl, fz / fl], d = [f[1], -f[0]];      // d: toward the lens's left
      const D0 = 37, Rx = 46, Rz = 30, T = TAU * Rx / 12.6, w = TAU / T, X0 = [cam.x + f[0] * D0, cam.y + D0 * 0.27, cam.z + f[1] * D0];
      flock(10, { c: [X0[0] + f[0] * Rz, X0[1], X0[2] + f[1] * Rz], yaw: Math.atan2(-d[1], d[0]), Rx, Rz, T, ph: -Math.PI / 2 - w * tX, Ay: 2.2, aY: -Math.PI / 2 - 0.5, span: 1.35, hz: 2.75, kind: EGRET, tOut: Math.min(F.EMERGE - 0.4, 8.6), tSpread: 0.9, lag: 1.25, lat: 3.6, vert: 1.4, glide: 0.2 });
      info.nearFlock = [+X0[0].toFixed(1), +X0[1].toFixed(1), +X0[2].toFixed(1)]; }
    flock(9, { c: [-4, 34, 2], Rx: 26, Rz: 13, T: 15, ph: 2.2, Ay: 3, span: 1.35, hz: 2.9, kind: EGRET, tOut: F.DRUMS + 0.15, tSpread: 0.6, lat: 4, vert: 1.5, glide: 0.2 });               // wheels in front of the gate at roof height until the loong roars from the summit (DRUMS)
    flock(9, { c: [M.x - 8, 66, M.z + 14], Rx: 42, Rz: 26, yaw: 0.2, T: 28, ph: 0.6, Ay: 8, span: 2.3, hz: 1.9, kind: CRANE, tOut: F.EMERGE + 0.2, tSpread: 1.2, lat: 7, vert: 2.5, glide: 0.5, flee: Math.atan2(-0.5, -WX * 0.85) });      // cranes round the spires: they peel away upwind the moment the loong moves
    flock(15, { c: [0, 108, -235], Rx: 270, Rz: 40, T: TAU / 0.052, dir: -WX, ph: WX < 0 ? 0.90 : Math.PI - 0.90, Ay: 5, span: 6.2, hz: 1.25, kind: CRANE, skein: [0.42, 5.2], glide: 0.15 });   // a skein far off, crossing with the wind
    flock(12, { c: [8, 50, 6], Rx: 18, Rz: 12, T: 13, ph: 3.6, Ay: 5, span: 1.4, hz: 3.0, kind: EGRET, tIn: 29.5, tOut: 37.0, lat: 6, vert: 3, glide: 0.1 });              // driven across the valley as the white loong comes down
    flock(10, { c: [-12, 62, -8], Rx: 13, Rz: 12, T: 15, ph: 1.0, Ay: 7, span: 1.4, hz: 2.7, kind: EGRET, tIn: 67.6, lat: 5, vert: 3, glide: 0.55 });                                 // back over the far spire when it is over
    for (let i = 0; i < 14; i++) { const c = [-2 + 14 * (r() - .5), 2.4 + 2.6 * r(), 24 + 18 * (r() - .5)];                                                                             // swallows low over the lake, gone at the summit roar
      flock(1, { c, Rx: 9 + 8 * r(), Rz: 11 + 12 * r(), yaw: r() * TAU, T: 6 + 3.5 * r(), dir: r() < 0.5 ? 1 : -1, ph: r() * TAU, Ay: 1.4 + 1.2 * r(), aY: r() * TAU, m: 2, span: 0.46, hz: 7.5, kind: SWALLOW, tOut: F.DRUMS + 0.2, tSpread: 0.7, lat: 0, vert: 0, lag: 0, glide: 0.75, flee: Math.atan2(0.2, WX) }); }
    info.circuit = rows.length;
    // ---- events: c0 = perch, t0 (first flight) | c1 = heading, turn (1/m), speed, climb | c2 = landing time (< 0: it does not come back), t0 of the flight out, its heading, seconds before it heads for the wall | c3 = seed
    const sites = perchSites(r), gate = sites.filter(p => p.tag === 'gate'), gc = V(); for (const p of gate) gc.add(p); if (gate.length) gc.multiplyScalar(1 / gate.length);
    const tSide = r() < 0.5 ? 1 : -1;
    for (const p of sites) { const awayR = Math.atan2(p.z - roarO.z, p.x - roarO.x), isG = p.tag === 'gate';
      // the gate roof: one tight burst toward the lens as the loong stirs behind it, one wheel together, gone over the lee wall in four seconds
      const t0 = isG ? F.EMERGE + 0.08 + 0.022 * Math.hypot(p.x - gc.x, p.z - gc.z) + 0.25 * r() : 1e9;
      rows.push({ c0: [p.x, p.y, p.z, t0], c1: [Math.PI / 2 + (r() - .5) * 0.7, tSide * (0.045 + 0.02 * r()), 12 + 3 * r(), 5 + 5 * r()], c2: [isG ? -1 : 1e9, isG ? 1e9 : roarAt(p.x, p.y, p.z) + 0.35 * r(), awayR + (r() - .5) * 1.2, isG ? 2.0 + 0.9 * r() : 1.2 + 1.6 * r()], c3: [r(), 0, 0, 0],
        d: [0.72 * (0.9 + 0.2 * r()), r(), 5.6 * (0.9 + 0.2 * r()), DOVE + 0.12], e: [1, 0, Math.atan2(-0.3, WX) + 0.4 * (r() - .5), 0.14 + 0.1 * r()] }); }
    info.perched = sites.length;
    // out of the crowns as a body passes: the strongest passes of the wake tables, spread over the film, only where the lens is far away
    // (60 m while the red loong dives and stands in the lake, 45 m otherwise); they scatter ACROSS the body's line, off both sides
    const ev = []; for (const g of (Wake.groups || [])) { if (!g.tear || !g.ev) continue; for (let i = 0; i < g.n; i++) { const l = g.ev[i]; if (!l) continue; for (const e of l) if (e.S > 0.16 && e.t0 > 8.5 && e.t0 < 84) {
      const x = g.ctr[i * 3], y = g.ctr[i * 3 + 1], z = g.ctr[i * 3 + 2]; Film.camAt(e.t0, cam); if (e.t0 > 16.3 && e.t0 < 21.6) continue;      /* the leap, the dive, the lake hit, the face: no bird anywhere near the animal */ if (cam.distanceTo(tv.set(x, y, z)) < (e.t0 > 15 && e.t0 < 23.5 ? 60 : 45)) continue; ev.push({ e, x, y, z, R: g.R[i] }); } } }
    ev.sort((a, b) => b.e.S - a.e.S); const pick = [];
    for (const c of ev) { if (pick.length >= 10) break; let ok = true; for (const q of pick) if (Math.abs(q.e.t0 - c.e.t0) < 1.0 || (Math.hypot(q.x - c.x, q.z - c.z) < 14 && Math.abs(q.e.t0 - c.e.t0) < 14)) { ok = false; break; } if (ok) pick.push(c); }
    for (const c of pick) { const hd = Math.atan2(c.e.fz, c.e.fx); for (let k = 0; k < 7; k++) { const u = r() * 2 - 1, th = r() * TAU, rr = c.R * 0.7 * Math.cbrt(r()), sq = Math.sqrt(1 - u * u), side = k % 2 ? 1 : -1;
      rows.push({ c0: [c.x + Math.cos(th) * sq * rr, c.y + u * rr * 0.6, c.z + Math.sin(th) * sq * rr, c.e.t0 - 0.35 + 0.55 * r()], c1: [hd + side * (1.25 + 0.6 * r()), side * (0.012 + 0.03 * r()), 13 + 5 * r(), 6 + 8 * r()], c2: [-1, 1e9, 0, 1.4 + 1.8 * r()], c3: [r(), 0, 0, 0],
        d: [0.66 * (0.9 + 0.2 * r()), r(), 6.4 * (0.9 + 0.2 * r()), DOVE + 0.05], e: [1, 1, hd + side * 1.4, 0.2 + 0.1 * r()] }); } }
    info.flushed = pick.map(c => +c.e.t0.toFixed(1)).sort((a, b) => a - b);
    const n = rows.length, at = {}; for (const k of ['c0', 'c1', 'c2', 'c3', 'd', 'e']) { at[k] = new Float32Array(n * 4); rows.forEach((o, i) => at[k].set(o[k], i * 4)); }
    const bm = birdMesh();
    const g = new THREE.InstancedBufferGeometry(); g.instanceCount = n; g.setAttribute('position', new THREE.Float32BufferAttribute(bm.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(bm.nor, 3)); g.setAttribute('aK', new THREE.Float32BufferAttribute(bm.part, 1));
    g.setAttribute('aC0', new THREE.InstancedBufferAttribute(at.c0, 4)); g.setAttribute('aC1', new THREE.InstancedBufferAttribute(at.c1, 4)); g.setAttribute('aC2', new THREE.InstancedBufferAttribute(at.c2, 4));
    g.setAttribute('aC3', new THREE.InstancedBufferAttribute(at.c3, 4)); g.setAttribute('aD', new THREE.InstancedBufferAttribute(at.d, 4)); g.setAttribute('aE', new THREE.InstancedBufferAttribute(at.e, 4));
    const m = new THREE.ShaderMaterial({ side: THREE.DoubleSide, fog: false, uniforms: { ...U },
      vertexShader: /* glsl */`${GLSL_U} attribute float aK; attribute vec4 aC0, aC1, aC2, aC3, aD, aE; varying vec3 vW, vN; varying float vTint, vTip, vPart, vRnd, vCh;
        float run(float x, float k){ return x - (1.0 - exp(-k * x)) / k; }
        vec3 fleeV(){ float ce = cos(aE.w); return vec3(cos(aE.z) * ce, sin(aE.w), sin(aE.z) * ce); }
        vec3 orbitP(float t){ float a = aC1.z * (t - aC2.z) + aC1.w, cy = cos(aC0.w), sy = sin(aC0.w), zc = aC1.y * aC2.y * cos(aC2.y * a);
          vec3 l = vec3(aC1.x * cos(a), aC2.x * cos(a - aC3.w), aC1.y * sin(aC2.y * a));
          vec3 p = aC0.xyz + vec3(l.x * cy + l.z * sy, l.y, -l.x * sy + l.z * cy);
          vec3 tg = vec3(-aC1.x * sin(a) * cy + zc * sy, 0.0, aC1.x * sin(a) * sy + zc * cy) * sign(aC1.z); tg /= max(length(tg), 1e-3); vec3 sd = vec3(tg.z, 0.0, -tg.x);
          p += sd * (aC2.w * (1.0 + 0.25 * sin(t * 0.7 + aD.y * 17.0))) + vec3(0.0, aC3.x + 0.5 * sin(t * 0.9 + aD.y * 29.0), 0.0);
          float i = 1.0 - smoothstep(aC3.y, aC3.y + 6.5, t), o = max(t - aC3.z, 0.0);
          return p + vec3(${f3(-WX * 105)}, 26.0, -70.0) * (i * i) + fleeV() * (25.0 * run(o, 1.1)) + vec3(0.0, 1.0, 0.0) * (6.0 * (1.0 - exp(-o * 0.8))); }
        vec3 flightP(float tau, float th0, float seed){ float s = aC1.z * run(tau, 1.6), k = aC1.y, th = th0 + k * s;
          vec3 p = aC0.xyz + vec3((sin(th) - sin(th0)) / k, 0.0, -(cos(th) - cos(th0)) / k);
          p.y += aC1.w * (1.0 - exp(-tau / 2.4)) + 0.5 * sin(tau * 1.3 + seed * 30.0) * min(tau, 1.0); return p; }
        vec3 eventP(float t, out float air, out float gone){ float ta = t - aC0.w, tb = t - aC2.y; air = 0.0; gone = 0.0; vec3 p = aC0.xyz;
          if (tb > 0.0) { float fo = max(tb - aC2.w, 0.0); p = flightP(tb, aC2.z, aC3.x) + fleeV() * (24.0 * run(fo, 1.1)); air = 1.0; gone = fo; }
          else if (ta > 0.0) {
            if (aC2.x < 0.0) { float fo = max(ta - aC2.w, 0.0); p = flightP(ta, aC1.x, aD.y) + fleeV() * (24.0 * run(fo, 1.1)); air = 1.0; gone = fo; }
            else { p = mix(flightP(ta, aC1.x, aD.y), aC0.xyz, smoothstep(aC2.x - 3.6, aC2.x, t)); air = 1.0 - smoothstep(aC2.x - 0.3, aC2.x, t); } }
          return p; }
        void main(){ float h = 0.20, air = 1.0, gone = 0.0, sc = 1.0, g0; vec3 p0, p1, p2;      // (a wide step: the GPU's sin and cos are too coarse for a second difference over a twentieth of a second)
          if (aE.x < 0.5) { p0 = orbitP(uAT - h); p1 = orbitP(uAT); p2 = orbitP(uAT + h); sc = step(aC3.y - 0.3, uAT) * (1.0 - smoothstep(6.0, 9.0, uAT - aC3.z)); }
          else { float a0; p0 = eventP(uAT - h, a0, g0); p1 = eventP(uAT, air, gone); p2 = eventP(uAT + h, a0, g0); sc = (1.0 - smoothstep(6.0, 9.0, gone)) * (aE.y > 0.5 ? step(aC0.w, uAT) : 1.0); }
          vec3 vel = (p2 - p0) / (2.0 * h), acc = (p2 - 2.0 * p1 + p0) / (h * h); float sp = length(vel);
          vec3 rest = vec3(cos(aC1.x), 0.0, sin(aC1.x)), f = normalize(mix(aE.x < 0.5 ? vec3(0.0, 0.0, 1.0) : rest, vel / max(sp, 1e-3), clamp(sp / 2.5, 0.0, 1.0)) + vec3(0.0, 1e-4, 0.0));
          vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), f)), up = cross(f, rt); float roll = atan(dot(acc, rt) / 9.8) * 0.9 * air, cr = cos(roll), sr = sin(roll);
          vec3 r2 = rt * cr - up * sr, u2 = up * cr + rt * sr;
          // the beat: down slower than up, each bird on its own phase; a glide between beats; folded on the perch
          float kind = floor(aD.w), gl = fract(aD.w), fl = uAT * aD.z * 6.283 + aD.y * 40.0; fl += 0.35 * sin(fl);
          float beat = air * mix(1.0, smoothstep(-0.25, 0.35, sin(uAT * (0.5 + 0.5 * aD.y) + aD.y * 50.0)), gl) * (1.0 + 0.4 * exp(-max(uAT - aC0.w, 0.0)) * aE.x);
          float amp = kind < 1.5 ? 0.66 : 0.56, upst = max(cos(fl), 0.0) * beat;
          float th1 = mix(-1.25, amp * beat * sin(fl) + 0.10, air), th2 = mix(-0.35, 0.42 * beat * sin(fl - 0.9) - 0.15 * beat - 0.04, air), th3 = th2 * 0.8;
          vec3 lp = position, ln = normal; float s = abs(lp.x), sg = sign(lp.x);
          if (aK > 3.5) {                             // a wing: three spans, hinged at the shoulder, the wrist and the hand
            float a1 = th1, a2 = th1 + th2, a3 = a2 + th3, l1 = min(s, 0.5) - 0.085, l2 = clamp(s - 0.5, 0.0, 0.26), l3 = max(s - 0.76, 0.0), an = s > 0.77 ? a3 : s > 0.51 ? a2 : a1;
            float shr = kind > 1.5 ? 0.92 : 1.0;      // (small birds: a narrower wing)
            lp.z = lp.z * shr - (l2 + l3) * (0.55 * upst + (1.0 - air) * 0.5) - (kind > 1.5 ? 0.35 * (l2 + l3) : 0.0);
            lp.x = sg * (0.085 + (l1 * cos(a1) + (l2 * cos(a2) + l3 * cos(a3)) * (1.0 - 0.28 * upst)) * mix(0.30, 1.0, air)); lp.y += (l1 * sin(a1) + l2 * sin(a2) + l3 * sin(a3)) * mix(0.22, 1.0, air);
            ln = normalize(vec3(-sg * sin(an), cos(an), normal.z)); }
          else {                                      // the body: each species wears the same skin its own way
            float nk = kind < 0.5 ? 1.0 : kind < 1.5 ? 3.0 : 0.25, zs = kind < 0.5 ? 1.0 : kind < 1.5 ? 0.74 : 0.86, fat = kind > 1.5 ? 1.35 : 1.0;
            if (aK < 2.5) { float cy = normal.z, wn = smoothstep(0.20, 0.31, lp.z); ln = vec3(normal.xy, 0.0);
              if (kind > 0.5 && kind < 1.5) { float thin = mix(1.0, 0.50, wn * (1.0 - smoothstep(0.38, 0.47, lp.z))); lp.x *= thin; lp.y = mix(cy, 0.015, wn) + (lp.y - cy) * thin; }      // crane: a thin neck held straight out
              lp.z += (nk - 1.0) * (clamp(lp.z, 0.20, 0.40) - 0.20); if (aK > 1.5 && kind > 1.5) lp.z -= (lp.z - 0.395) * 0.6; }
            if (aK > 2.5) { if (kind > 1.5) lp = vec3(0.0, 0.0, -0.36); }
            lp.z *= zs; lp.xy *= fat; if (aK < 0.5 && lp.z < -0.3 && kind > 1.5) lp.x *= 2.2; }
          vN = r2 * ln.x + u2 * ln.y + f * ln.z;
          float span = aD.x * sc; p1 += u2 * (-0.05 * aD.x * beat * sin(fl));
          vec3 w = p1 + (r2 * lp.x + u2 * lp.y + f * lp.z) * (0.5 * span); vW = w; vTint = kind; vTip = s; vPart = aK; vRnd = aD.y; vCh = position.z;
          gl_Position = sc > 0.001 ? projectionMatrix * viewMatrix * vec4(w, 1.0) : vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: /* glsl */`${GLSL_NOISE}${GLSL_FOG} uniform vec4 uAK, uAE; varying vec3 vW, vN; varying float vTint, vTip, vPart, vRnd, vCh;
        void main(){ vec3 N = normalize(vN); if (dot(N, cameraPosition - vW) < 0.0) N = -N;
          vec3 alb;
          if (vTint < 0.5) alb = vPart > 3.5 ? mix(vec3(0.93, 0.92, 0.88), vec3(0.86, 0.86, 0.86), smoothstep(0.55, 1.0, vTip)) : vec3(0.93, 0.92, 0.88);                                           // egret
          else if (vTint < 1.5) alb = vPart > 3.5 ? mix(vec3(0.84, 0.84, 0.86), vec3(0.05, 0.05, 0.06), max(smoothstep(0.60, 0.74, vTip), 1.0 - smoothstep(-0.15, -0.07, vCh))) : vPart > 0.5 ? vec3(0.07, 0.07, 0.08) : vec3(0.86, 0.86, 0.88);      // crane: black neck and flight feathers
          else if (vTint < 2.5) alb = mix(vec3(0.030, 0.036, 0.065), vec3(0.62, 0.56, 0.50), (1.0 - smoothstep(-0.55, 0.15, N.y)) * step(vTip, 0.3));                                                   // swallow
          else alb = mix(vec3(0.86, 0.85, 0.83), vec3(0.42, 0.44, 0.50), step(0.6, vRnd)) * (vPart > 3.5 ? mix(1.0, 0.62, smoothstep(0.7, 1.0, vTip)) : 1.0);                                           // dove: white ones and blue-grey ones
          if (vTint < 1.5) { if (vPart > 1.5 && vPart < 2.5) alb = vTint < 0.5 ? vec3(0.92, 0.62, 0.08) : vec3(0.55, 0.50, 0.30); if (vPart > 2.5 && vPart < 3.5) alb = vec3(0.035, 0.035, 0.04); }          // bill, legs
          if (vPart > 3.5) alb *= 1.0 - 0.16 * (1.0 - smoothstep(-0.16, -0.02, vCh)) * (0.5 + 0.5 * sin(vTip * 88.0));       // the flight feathers lie in rows behind the coverts
          float nl = max(dot(N, SUN_DIR) * 0.75 + 0.25, 0.0), bk = max(dot(-N, SUN_DIR), 0.0) * step(3.5, vPart);
          vec3 c = alb * (${SUNC} * ${sunAt('vW')} * (2.3 * (nl * nl + 0.22 * bk)) * (1.0 - ${HAS_SUN ? '0.0' : '0.6'} * uAK.y) + vec3(0.36, 0.36, 0.56) * ((0.62 + 0.38 * N.y) * (1.0 - 0.45 * uAE.x)) + vec3(0.5, 0.6, 1.0) * uAK.w * 0.8);
          gl_FragColor = vec4(clFog(c, vW, cameraPosition), 1.0); }` });
    const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.name = 'airBirds'; scene.add(me); S.birds = me; info.birds = n; info.birdTris = bm.pos.length / 9;
  }

  // ================= build / per frame =================
  let built = false, gSum = null; const bA = V(), bB = V();
  function summits() {                             // the real top of each spire: the highest planting site near its axis
    const st = Rock.sites || [], out = [];
    for (const s of spires()) { let by = -1e9, bx = s[0], bz = s[1]; for (let i = 0; i < st.length; i++) { const p = st[i].p; if (p.y > by && Math.hypot(p.x - s[0], p.z - s[1]) < s[2] + 4) { by = p.y; bx = p.x; bz = p.z; } } out.push(by > 0 ? { x: bx, y: by, z: bz } : { x: s[0], y: s[4], z: s[1] }); }
    return out.filter((s, i) => i !== 2);          // (the low spire in front stays bare: a banner there would hang across the gate)
  }
  function build(scene, fx) {
    if (built) return true; built = true; if (!ON) return true;
    const t0 = performance.now();
    scene = scene || G.scene; fx = fx || G.fx;
    if (typeof Wake !== 'undefined' && Wake.build) Wake.build(scene, fx);        // (a no-op when 90_main.js has already called it)
    S.summits = summits();
    // open ground the lens can see: flat rock in the valley (terraces, ledges, banks), thinned to one site in every 2.5 m cell
    { const seen = new Set(), out = [], st = Rock.sites || []; for (let i = 0; i < st.length; i++) { const q = st[i], p = q.p; if (q.n.y < 0.80 || p.y < 0.6 || p.y > 46 || p.z < -34 || p.z > 84 || Math.abs(p.x - 4) > 50) continue; const k = Math.floor(p.x / 2.5) * 4096 + Math.floor(p.z / 2.5); if (seen.has(k)) continue; seen.add(k); out.push(p); } S.ground = out; info.ground = out.length; }
    // the old air of 70_fx.js: found by what the meshes are, switched off
    const find = (sc, key) => sc.children.find(o => o.material && o.material.vertexShader && o.material.vertexShader.includes(key));
    S.old = [has('mist') && find(fx, 'uShockK'), has('mote') && find(fx, '0.035 + 0.05 * aR.z'), has('leaf') && find(scene, 'c.y - ph * 1.25')].filter(Boolean); for (const o of S.old) o.visible = false;
    info.hidden = S.old.length + (has('bird') && FX.S.birds ? 1 : 0);
    if (has('mist')) { buildMist(fx); buildFalls(fx); }
    if (has('trail')) buildTrail(fx);
    if (has('smoke')) buildSmoke(fx);
    if (has('leaf')) buildGustDust(fx);
    if (has('mote')) buildMotes(fx);
    if (has('fly')) buildFlies(fx);
    if (has('leaf') && typeof Flora !== 'undefined' && Flora.T.leaf) buildLeaves(scene);
    if (has('bird')) buildBirds(scene);
    // compile behind the loader: a first-use compile would stall a live frame
    try { for (const k of ['mist', 'falls', 'trail', 'smoke', 'gdust', 'motes', 'flies']) if (S[k]) { const v = S[k].visible; S[k].visible = true; G.R.compile(S[k], G.camera, fx); S[k].visible = v; }
      for (const k of ['leaves', 'birds']) if (S[k]) G.R.compile(S[k], G.camera, scene); } catch (e) { console.warn('air precompile skipped', e && e.message); }
    info.ms = Math.round(performance.now() - t0); G.info.air = info;
    G.tick.push(update); return true;
  }
  const MINE = ['mist', 'falls', 'trail', 'smoke', 'gdust', 'motes', 'flies', 'leaves', 'birds'];
  function update(t) {
    const F = Film.T;
    if (S.off) { S.wasOff = true; for (const k of MINE) if (S[k]) S[k].visible = false; for (const o of S.old) o.visible = true; return; }      // cost probe: Air.S.off = true puts the old air back
    if (S.wasOff) { S.wasOff = false; for (const k of MINE) if (S[k]) S[k].visible = true; for (const o of S.old) o.visible = false; }
    U.uAT.value = t; U.uACam.value.copy(G.camera.position);
    if (S.birds && FX.S.birds) FX.S.birds.visible = false;
    // gust slots: the newest NG fronts that have entered; the ones that are over have left their carry in uAShift
    if (!gSum) { gSum = new Float32Array(GUSTS.length * 2 + 2); for (let i = 0; i < GUSTS.length; i++) { gSum[i * 2 + 2] = gSum[i * 2] + GUSTS[i][1] * GUSTS[i][4]; gSum[i * 2 + 3] = gSum[i * 2 + 1] + GUSTS[i][2] * GUSTS[i][4]; } }
    let last = -1; for (let i = 0; i < GUSTS.length; i++) if (t >= GUSTS[i][0]) last = i;
    let done = -1;
    for (let k = 0; k < NG; k++) { const i = last - k, u = U.uAGu.value[k], a = U.uAGa.value[k];
      if (i >= 0 && t - GUSTS[i][0] < G_LIFE) { const g = GUSTS[i]; u.set(g[1], g[2], g[0] - G_S0 / g[3], g[3]); a.set(g[4], t - g[0], i % 3, i % 2); } else { u.set(1, 0, 1e9, 30); a.set(0, 0, -1, -1); if (i >= 0 && i > done) done = i; } }
    if (last - NG > done) done = last - NG;
    U.uAShift.value.set(gSum[(done + 1) * 2], gSum[(done + 1) * 2 + 1]);
    U.uAK.value.x = sm(F.SPLASH - 1.6, F.SPLASH - 0.5, t) * (1 - sm(F.SPLASH + 1.9, F.SPLASH + 4.0, t));
    U.uAK.value.y = sm(F.OUT, 88.2, t);
    U.uAK.value.w = Math.min(Film.flashAt(t), 2.2);
    // the storm (R6): while it holds the sky the fill that lights mist, smoke, dust, leaves and birds is slate, darker and colder
    { const gl = clamp(+(typeof Daylight !== 'undefined' && Daylight.S && Daylight.S.gloom) || 0); U.uAE.value.x = gl; U.uMShade.value.set(MSH[0] * (1 - 0.54 * gl), MSH[1] * (1 - 0.50 * gl), MSH[2] * (1 - 0.40 * gl)); }
    const lt = FX.light; if (lt && lt.intensity > 0.01) { U.uALp.value.set(lt.position.x, lt.position.y, lt.position.z, lt.intensity); U.uALc.value.set(lt.color.r, lt.color.g, lt.color.b); } else U.uALp.value.w = 0;
    { const bk = sm(F.BEAM - 0.15, F.BEAM + 0.45, t) * (1 - sm(F.BLAST - 0.05, F.BLAST + 0.3, t)), m = U.uABm.value;      // the BEAM: ember on the red loong's side of the bank, ice on the white one's
      if (bk > 0.001) { Film.beamMidAt(t, bA); m.set(bA.x, bA.y, bA.z, bk); Dragon.red.headAt(t, bA); Dragon.white.headAt(t, bB); bB.sub(bA); if (bB.lengthSq() > 1e-6) U.uABx.value.copy(bB.normalize()); } else m.w = 0; }
    if (S.trail) S.trail.visible = t >= S.trailT[0] && t <= S.trailT[1];
    const spl = U.uAK.value.x > 0.999;
    if (S.falls) S.falls.visible = !spl; if (S.gdust) S.gdust.visible = !spl;
    if (S.leaves) S.leaves.geometry.instanceCount = S.leafN[spl ? 1 : 0]; if (S.motes) S.motes.geometry.instanceCount = spl ? 300 : info.motes;
    if (S.flies) { const k = sm(83.2, 86.2, t) + (1 - sm(0.2, 2.6, t)) * 0.2; S.flies.visible = k > 0.004; S.flies.material.uniforms.uFly.value = 30 * k; }
  }
  // until 90_main.js calls Air.build after FX.build (one line), the first frame does: build() appends update to G.tick, so it still runs in this frame
  const boot = () => { if (!built && typeof FX !== 'undefined' && FX.S && FX.U.tPuff.value) build(G.scene, G.fx); };
  G.tick.push(boot);
  return { build, boot, U, S, GUSTS, G_S0, gustAt, info, WX, GLSL_U, GLSL_GUST };
})();
