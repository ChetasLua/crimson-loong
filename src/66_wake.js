'use strict';
// ---- the world answers the dragons --------------------------------------------------------------------
// A loong is 150 to 172 m of body moving at up to 75 m/s. This module is everything the valley does about that.
//   Wake.U, Wake.GLSL          the live wake FIELD: 8 points down each body (position, radius, velocity) and the pressure fronts
//                              of the two roars, the clashes, the bolt, the splash and the blast, as uniforms, plus
//                              `vec3 clWake(vec3 wp)` = the wind (m/s) they add at a world point this frame: air shoved aside
//                              ahead of the head, dragged along beside the body, sucked in behind the tail, and each front as
//                              a shell travelling outward at its own finite speed
//   Wake.windAt(p, t, out)     the same field in JS, a pure function of film time (any t, any order)
//   Wake.plants(n, opts)       a plant set registers here and gets three per-instance attributes aE0..aE2 = its three
//                              strongest passes (t0, seconds, push x, push z). Wake.GLSL_BEND evaluates a damped spring's
//                              answer to each of them (and to the fronts, later with distance) in the vertex shader:
//                              the limb is pushed over, held while the body streams past, springs back, overshoots and rings down
//   the valley's own wind      Wake.WIND, GLSL_GUST (wkGusts, wkGust), Wake.gustAt(x, z, t): it blows toward -X and gusts cross
//                              as plane fronts. The fronts are the air builder's table (Air.GUSTS) when 72_air.js is present,
//                              so mist, loose leaves, smoke and trees answer the same front; a copy of it otherwise
//   torn leaves, dust, stones  leaves ripped out of a crown by a pass, by a pressure front (a ring of them crosses the valley
//                              with it) and by every gust (closed form per leaf from its birth: carried, tumbling, slowing,
//                              falling, lying where it lands); needles shaken out of pines; dust pouring off rock wherever a
//                              body lies on it, slides or pushes off, and stones that fall, strike, puff and bounce (arcs found
//                              once at load). ?nowake and ?nowind switch each cause off (QA)
// Nothing here remembers the last frame. Every time, place and strength comes from tables built ONCE at load by walking both
// rails through the whole film (Dragon.*.pathAt / sOf / headAt, Film.T, Film.A), so it follows whatever the choreography is.
const Wake = (() => {
  const NS = 8, NF = 4, DSR = 2;                 // body samples per loong, front slots, metres between rail samples in the tables
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), V4 = () => new THREE.Vector4();
  const U = {
    uWkT: { value: 0 },                                                                    // film time (s)
    uWkP: { value: Array.from({ length: 2 * NS }, V4) },                                   // xyz: a point on a body's centreline, w: body radius there (0 = no body)
    uWkV: { value: Array.from({ length: 2 * NS }, V4) },                                   // xyz: its velocity (m/s)
    uWkE: { value: Array.from({ length: NF }, () => new THREE.Vector4(0, 0, 0, 1e9)) },    // xyz: where a pressure front was born, w: when (s)
    uWkH: { value: Array.from({ length: NF }, V4) },                                       // x: strength (1 = a strong pass), y: front speed (m/s), z: seconds the push lasts, w: reference distance (m)
    uWkG: { value: new THREE.Vector4(0.8, 0.16, 1, 0) },                                   // the valley's own wind: x = how hard it blows now (0.78 calm evening .. 1.1 in a roar), y = the steady part, z = 1 while the dragons' wake is on
    uWkGu: { value: Array.from({ length: 4 }, () => new THREE.Vector4(1, 0, 1e9, 30)) },   // a gust front in the valley: heading x, heading z, when it reaches the origin (s), speed (m/s)
    uWkGa: { value: Array.from({ length: 4 }, V4) },                                       // x: its strength (0 = empty slot)
  };
  // ---- the valley's own wind. It blows toward -X and down the valley toward the lens, and gusts cross as plane FRONTS ----
  // ONE wind for the whole film: the fronts are the air builder's table (Air.GUSTS, 72_air.js: rows [t0 the front enters at the
  // upwind corner, heading x, heading z, speed, strength]; front g reaches (x, z) at t0 + (x*hx + z*hz + 125) / speed), so the mist
  // streams, the loose leaves, the smoke and the trees all answer the same front at the same moment. Without that module the copy
  // below (the same numbers) is used. Pure in film time.
  const WIND = { d: [-0.929, 0.370], S0: -125, rise: 0.55, fall: 2.6 };
  const NOWAKE = Q.has('nowake'), NOWIND = Q.has('nowind');
  const GUSTS0 = [[-3.1, 0.90, 0.44, 30, 0.9], [1.4, 0.97, 0.24, 31, 0.9], [5.9, 0.82, 0.57, 31, 1.25], [10.6, 0.93, 0.37, 32, 1.1], [16.0, 0.86, 0.51, 30, 1.0], [20.2, 0.95, 0.31, 33, 1.2], [24.6, 0.80, 0.60, 30, 0.9], [28.9, 0.92, 0.39, 32, 1.2], [33.4, 0.88, 0.47, 29, 0.9], [38.0, 0.96, 0.28, 32, 1.0],
    [43.3, 0.84, 0.54, 31, 1.1], [47.4, 0.93, 0.37, 30, 0.9], [52.0, 0.89, 0.46, 30, 0.8], [57.5, 0.95, 0.31, 31, 1.0], [62.0, 0.85, 0.53, 30, 0.9], [66.4, 0.92, 0.39, 30, 1.1], [70.9, 0.97, 0.24, 30, 1.0], [75.4, 0.86, 0.51, 29, 0.9], [79.9, 0.93, 0.37, 28, 0.8]]
    .map(g => { const l = Math.hypot(g[1], g[2]); return [g[0], -g[1] / l, g[2] / l, g[3], g[4]]; });
  let gTab = null;
  const gusts = () => { if (gTab) return gTab; const a = typeof Air !== 'undefined' && Air && Air.GUSTS; gTab = Array.isArray(a) && a.length && a.every(g => g && g.length >= 5 && [0, 1, 2, 3, 4].every(k => Number.isFinite(g[k])) && g[3] > 1) ? a : GUSTS0; info.gusts = gTab === GUSTS0 ? 'own table' : 'Air.GUSTS'; return gTab; };
  const gArr = (g, x, z) => g[0] + (x * g[1] + z * g[2] - WIND.S0) / g[3];                // when front g reaches (x, z)
  const windK = t => NOWIND ? 0 : 0.75 + 0.25 * Math.min(typeof Film !== 'undefined' ? Film.gust(t) : 0.1, 1.5);
  // how hard the valley's wind blows at (x, z) at film time t: about 0.13 between gusts .. 1 in a hard one
  function gustAt(x, z, t) { let n = 0; for (const g of gusts()) { const tau = t - gArr(g, x, z); if (tau > 0 && tau < 9) n += g[4] * sm(0, WIND.rise, tau) * Math.exp(-tau / WIND.fall); } return windK(t) * (0.16 + n); }
  // wkGusts(xz, w, z): xy = the lean the fronts ask of a sprung plant here (w rad/s, damping z; w = 0: no spring), z = how hard it blows now
  const GLSL_GUST = /* glsl */`
#ifndef CL_WKGUST
#define CL_WKGUST
uniform vec4 uWkG; uniform vec4 uWkGu[4]; uniform vec4 uWkGa[4];
const vec2 WK_WD = vec2(${WIND.d[0]}, ${WIND.d[1]});
float wkStep(float tau, float w, float z){ if (tau <= 0.0) return 0.0; float wd = w * sqrt(1.0 - z * z); return 1.0 - exp(-z * w * tau) * (cos(wd * tau) + z * w / wd * sin(wd * tau)); }
vec3 wkGusts(vec2 xz, float w, float z){
  vec2 L = vec2(0.0); float n = 0.0; bool first = w > 0.0;
  for (int k = 0; k < 4; k++){ float A = uWkGa[k].x; if (A <= 0.0) continue; vec4 g = uWkGu[k]; float tau = uWkT - g.z - dot(xz, g.xy) / g.w; if (tau <= 0.0 || tau > 9.0) continue;
    float dec = A * exp(-tau / ${WIND.fall.toFixed(2)}), e = dec * smoothstep(0.0, ${WIND.rise.toFixed(2)}, tau);
    n += e; if (first){ e = dec * wkStep(tau, w, z); first = false; }                // the newest front is answered as a sprung weight: over, past, back and ringing; older ones have rung down
    L += g.xy * e; }
  return vec3(L, n) * uWkG.x; }
float wkGust(vec2 xz){ return uWkG.x * uWkG.y + wkGusts(xz, 0.0, 0.0).z; }
#endif
`;
  const GLSL_U = /* glsl */`
#ifndef CL_WKU
#define CL_WKU
uniform float uWkT; uniform vec4 uWkP[${2 * NS}]; uniform vec4 uWkV[${2 * NS}]; uniform vec4 uWkE[${NF}]; uniform vec4 uWkH[${NF}];
#endif
`;
  // ---- the live field ----
  const GLSL = GLSL_U + /* glsl */`
#ifndef CL_WAKE
#define CL_WAKE
vec3 wkBody(vec3 p, int o){
  if (uWkP[o].w <= 0.0) return vec3(0.0);
  float best = 1e9, br = 0.0; vec3 bv = vec3(0.0);
  for (int j = 0; j < ${NS - 1}; j++){ vec4 A = uWkP[o + j], B = uWkP[o + j + 1]; vec3 ab = B.xyz - A.xyz; float h = clamp(dot(p - A.xyz, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    vec3 d = p - (A.xyz + ab * h); float dd = dot(d, d);
    if (dd < best){ best = dd; bv = mix(uWkV[o + j].xyz, uWkV[o + j + 1].xyz, h); br = mix(A.w, B.w, h); } }
  float gap = max(sqrt(best) - br, 0.0);
  vec3 w = bv * (0.6 * exp(-gap / (1.2 + 0.7 * br)));                                          // dragged along beside the body
  vec3 hp = p - uWkP[o].xyz, hv = uWkV[o].xyz; float hd = length(hp), hr = uWkP[o].w * 1.5, hs = length(hv);
  w += hp / max(hd, 0.01) * (hs * hr * hr / (hd * hd + hr * hr)) * (0.55 + 0.45 * dot(hp, hv) / max(hd * hs, 0.01));   // shoved aside ahead of the head
  vec3 tp = p - uWkP[o + ${NS - 1}].xyz, tv = uWkV[o + ${NS - 1}].xyz; float td = length(tp), ts = length(tv);
  w -= tp / max(td, 0.01) * (ts * 4.5 / (td * td + 9.0));                                      // sucked in behind the tail
  return w; }
vec3 clWake(vec3 p){
  vec3 w = wkBody(p, 0) + wkBody(p, ${NS});
  for (int k = 0; k < ${NF}; k++){ vec4 H = uWkH[k]; float age = uWkT - uWkE[k].w;
    if (H.x > 0.0 && age > 0.0){ vec3 d = p - uWkE[k].xyz; float dist = length(d), q = (dist - age * H.y) / 7.0;
      float sh = exp(-q * q) + 0.4 * step(q, 0.0) * (1.0 - smoothstep(H.z, H.z + 0.6, age - dist / H.y));
      w += d / max(dist, 0.01) * (30.0 * H.x * H.w / (H.w + dist) * sh); } }
  return w; }
#endif
`;
  // ---- a sprung plant's answer to its passes and to the fronts ----
  //   wkStep = unit step response of a damped spring (w rad/s, damping ratio z); a pass is a push that starts and stops, so the
  //   answer is the difference of two of them: lean over, hold, spring back past upright, ring down.
  //   wkBend(base, e0, e1, e2, w, z) -> xy: horizontal lean (1 = a strong pass), z: buffeting 0..1+ while air is streaming past
  const GLSL_BEND = GLSL_U + GLSL_GUST + /* glsl */`
#ifndef CL_WKBEND
#define CL_WKBEND
void wkPass(vec4 e, float w, float z, inout vec2 b, inout float tb){
  if (e.y <= 0.0) return; float tau = uWkT - e.x; if (tau <= 0.0 || tau > e.y + 5.0) return;
  b += e.zw * ((wkStep(tau, w, z) - wkStep(tau - e.y, w, z)) * (1.0 - smoothstep(e.y + 3.6, e.y + 5.0, tau)));
  tb += length(e.zw) * smoothstep(0.0, 0.12, tau) * (1.0 - smoothstep(e.y, e.y + 1.5, tau)); }
vec4 wkBend(vec3 base, vec4 e0, vec4 e1, vec4 e2, float w, float z){            // xy: lean, z: buffeting, w: the flash of a front arriving (leaves turn their pale side)
  vec2 b = vec2(0.0); float tb = 0.0, fl = 0.0;
  wkPass(e0, w, z, b, tb); wkPass(e1, w, z, b, tb); wkPass(e2, w, z, b, tb);
  for (int k = 0; k < ${NF}; k++){ vec4 H = uWkH[k];
    if (H.x > 0.0){ vec3 d = base - uWkE[k].xyz; float dist = length(d), tau = uWkT - uWkE[k].w - dist / H.y;
      if (tau > 0.0 && tau < H.z + 3.6){ float a = H.x * H.w / (H.w + dist) * (1.0 - smoothstep(H.z + 2.6, H.z + 3.6, tau));      // (three and a half seconds on a plant has rung down: nothing left to work out)
        b += d.xz / max(0.55 * length(d.xz) + 0.45 * dist, 1.0) * a * (wkStep(tau, w, z) - wkStep(tau - H.z, w, z));
        tb += a * smoothstep(0.0, 0.08, tau) * (1.0 - smoothstep(H.z, H.z + 1.5, tau));
        fl += a * smoothstep(0.0, 0.05, tau) * exp(-tau * 2.6); } } }
  return vec4(b, tb, fl) * uWkG.z; }
#endif
`;

  // ================= rails: pure samplers =================
  const pA = V(), pB = V(), pC = V(), pD = V();
  let drs = null, fronts = [];
  const scratchSt = d => { const o = {}; for (const k of Object.keys(d.st)) { const v = d.st[k]; o[k] = v && v.isVector3 ? v.clone() : v; } return o; };
  function visAt(D, t) { try { D.d.cfg.pose(t, D.sc); return clamp(D.sc.vis ?? 1); } catch (e) { return 1; } }
  // 8 points down a body at film time t -> P (x, y, z, radius) and Vl (velocity), 4 floats each from offset o
  function sample(D, t, P, Vl, o) {
    const d = D.d, vis = visAt(D, t), s = d.sOf(t), spd = (d.sOf(t + 0.03) - d.sOf(t - 0.03)) / 0.06;
    for (let j = 0; j < NS; j++) {
      const a = d.LEN * j / (NS - 1), k = o + j * 4, sj = Math.max(s - a, 0.7);
      d.pathAt(sj + 0.6, pA); d.pathAt(sj - 0.6, pB); pA.sub(pB); const l = pA.length() || 1;
      if (j === 0) d.headAt(t, pC); else d.pathAt(sj, pC);
      const on = vis > 0.02 && s - a > 0.5 ? 1 : 0;
      P[k] = pC.x; P[k + 1] = pC.y; P[k + 2] = pC.z; P[k + 3] = on * d.RMAX * Math.max(d.rProf(a), 0.25);
      const q = on * vis * spd / l; Vl[k] = pA.x * q; Vl[k + 1] = pA.y * q; Vl[k + 2] = pA.z * q; Vl[k + 3] = 0;
    }
  }
  // which fronts are in the air at t -> E (x, y, z, t0), H (strength, speed, seconds, reference distance)
  function frontsAt(t, E, H) {
    let n = 0; for (let k = fronts.length - 1; k >= 0 && n < NF; k--) { const f = fronts[k]; if (t >= f.t && t < f.t + f.dur + 3.6 + 150 / f.c) { E[n * 4] = f.o.x; E[n * 4 + 1] = f.o.y; E[n * 4 + 2] = f.o.z; E[n * 4 + 3] = f.t; H[n * 4] = f.S; H[n * 4 + 1] = f.c; H[n * 4 + 2] = f.dur; H[n * 4 + 3] = f.ref; n++; } }
    for (; n < NF; n++) { E[n * 4 + 3] = 1e9; H[n * 4] = 0; H[n * 4 + 1] = 1; }
  }
  // ---- JS twin of clWake ----
  const jP = new Float32Array(2 * NS * 4), jV = new Float32Array(2 * NS * 4), jE = new Float32Array(NF * 4), jH = new Float32Array(NF * 4); let jT = NaN;
  function bodyJS(p, o, out) {
    if (jP[o + 3] <= 0) return;
    let best = 1e9, br = 0, vx = 0, vy = 0, vz = 0;
    for (let j = 0; j < NS - 1; j++) { const a = o + j * 4, b = a + 4, abx = jP[b] - jP[a], aby = jP[b + 1] - jP[a + 1], abz = jP[b + 2] - jP[a + 2];
      const h = clamp(((p.x - jP[a]) * abx + (p.y - jP[a + 1]) * aby + (p.z - jP[a + 2]) * abz) / Math.max(abx * abx + aby * aby + abz * abz, 1e-4));
      const dx = p.x - jP[a] - abx * h, dy = p.y - jP[a + 1] - aby * h, dz = p.z - jP[a + 2] - abz * h, dd = dx * dx + dy * dy + dz * dz;
      if (dd < best) { best = dd; vx = lerp(jV[a], jV[b], h); vy = lerp(jV[a + 1], jV[b + 1], h); vz = lerp(jV[a + 2], jV[b + 2], h); br = lerp(jP[a + 3], jP[b + 3], h); } }
    const gap = Math.max(Math.sqrt(best) - br, 0), kd = 0.6 * Math.exp(-gap / (1.2 + 0.7 * br)); out.x += vx * kd; out.y += vy * kd; out.z += vz * kd;
    { const hx = p.x - jP[o], hy = p.y - jP[o + 1], hz = p.z - jP[o + 2], hd = Math.hypot(hx, hy, hz), hr = jP[o + 3] * 1.5, hs = Math.hypot(jV[o], jV[o + 1], jV[o + 2]);
      const k = hs * hr * hr / (hd * hd + hr * hr) * (0.55 + 0.45 * (hx * jV[o] + hy * jV[o + 1] + hz * jV[o + 2]) / Math.max(hd * hs, 0.01)) / Math.max(hd, 0.01); out.x += hx * k; out.y += hy * k; out.z += hz * k; }
    { const e = o + (NS - 1) * 4, tx = p.x - jP[e], ty = p.y - jP[e + 1], tz = p.z - jP[e + 2], td = Math.hypot(tx, ty, tz), ts = Math.hypot(jV[e], jV[e + 1], jV[e + 2]), k = ts * 4.5 / (td * td + 9) / Math.max(td, 0.01); out.x -= tx * k; out.y -= ty * k; out.z -= tz * k; }
  }
  function windAt(p, t, out) {
    out.set(0, 0, 0); if (!drs) return out;
    if (t !== jT) { jT = t; sample(drs[0], t, jP, jV, 0); sample(drs[1], t, jP, jV, NS * 4); frontsAt(t, jE, jH); }
    bodyJS(p, 0, out); bodyJS(p, NS * 4, out);
    for (let k = 0; k < NF; k++) { const S = jH[k * 4], age = t - jE[k * 4 + 3]; if (S > 0 && age > 0) { const dx = p.x - jE[k * 4], dy = p.y - jE[k * 4 + 1], dz = p.z - jE[k * 4 + 2], dist = Math.hypot(dx, dy, dz), c = jH[k * 4 + 1], q = (dist - age * c) / 7;
      const sh = Math.exp(-q * q) + (q < 0 ? 0.4 * (1 - sm(jH[k * 4 + 2], jH[k * 4 + 2] + 0.6, age - dist / c)) : 0), a = 30 * S * jH[k * 4 + 3] / (jH[k * 4 + 3] + dist) * sh / Math.max(dist, 0.01); out.x += dx * a; out.y += dy * a; out.z += dz * a; } }
    return out;
  }

  // ================= plant sets =================
  const groups = [];
  // opts: centre(i, outV3) = world centre of the part that catches the wind; R (number or i => number) = its radius (m);
  //       tear = leaves a strong pass rips out (0 = none); shed = the same for a pine (dead needles and twig ends: only a body or a
  //       front shakes them loose, never the wind); hue(i) = the palette position of what comes away
  function plants(n, o) {
    const g = { n, name: o.name || '', ctr: new Float32Array(n * 3), R: new Float32Array(n), tear: o.tear || 0, shed: o.shed || 0, hue: o.hue || null, e: [0, 1, 2].map(() => new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4)), ev: new Array(n) };
    for (let i = 0; i < n; i++) { o.centre(i, pA); g.ctr[i * 3] = pA.x; g.ctr[i * 3 + 1] = pA.y; g.ctr[i * 3 + 2] = pA.z; g.R[i] = typeof o.R === 'function' ? o.R(i) : (o.R ?? 1); }
    groups.push(g); return g;
  }

  // ================= clearance: nothing new may stand in a loong's way =================
  // Flora registers the plants it adds on the cliffs (their meshes, a centre and a radius each). When the rails are known, every
  // one whose centre lies within a body's radius + its own + 0.7 m of either rail is taken out: its instance shrinks to nothing.
  // So the cover follows whatever the choreography is: the coil on the spire, the slide, the leap and every pass stay clear.
  const clears = [];
  function clear(meshes, n, centre, R, wk) { clears.push({ meshes: meshes.filter(Boolean), n, centre, R, wk }); }
  function clearance() {
    if (!clears.length) return; const CL = 8, grid = new Map(), key = (i, j, k) => ((i + 128) * 256 + (j + 128)) * 256 + (k + 128), fl = Math.floor;
    drs.forEach((D, di) => { for (let j = D.j0; j <= D.j1; j++) { const k = key(fl(D.q[j * 3] / CL), fl(D.q[j * 3 + 1] / CL), fl(D.q[j * 3 + 2] / CL)); let l = grid.get(k); if (!l) grid.set(k, l = []); l.push(di, j); } });
    const Z = new THREE.Matrix4().compose(V(0, -900, 0), new THREE.Quaternion(), V(1e-4, 1e-4, 1e-4)); let gone = 0, tot = 0;
    for (const c of clears) { let any = false;
      for (let i = 0; i < c.n; i++) { const R = c.R(i); if (R < 0) continue; c.centre(i, pA); const ix = fl(pA.x / CL), iy = fl(pA.y / CL), iz = fl(pA.z / CL); let hit = false; tot++;
        for (let a = -2; a <= 2 && !hit; a++) for (let b = -2; b <= 2 && !hit; b++) for (let e = -2; e <= 2 && !hit; e++) { const l = grid.get(key(ix + a, iy + b, iz + e)); if (!l) continue;
          for (let q = 0; q < l.length; q += 2) { const D = drs[l[q]], j = l[q + 1], dx = D.q[j * 3] - pA.x, dy = D.q[j * 3 + 1] - pA.y, dz = D.q[j * 3 + 2] - pA.z, lim = D.d.RMAX + R + 1.2; if (dx * dx + dy * dy + dz * dz < lim * lim) { hit = true; break; } } }
        if (hit) { gone++; any = true; for (const m of c.meshes) m.setMatrixAt(i, Z); if (c.wk) (c.wk.gone || (c.wk.gone = new Uint8Array(c.n)))[i] = 1; } }
      if (any) for (const m of c.meshes) m.instanceMatrix.needsUpdate = true; }
    info.cleared = [gone, tot]; clears.length = 0;
  }

  // ================= the tables =================
  const info = {};
  function rails() {
    const NT = Math.round(Film.DUR * 60) + 1;
    drs = Dragon.list.map(d => {
      const D = { d, sc: scratchSt(d), NT, sT: new Float32Array(NT), vT: new Float32Array(NT), Wt: new Float32Array(NT) };
      for (let i = 0; i < NT; i++) D.sT[i] = d.sOf(i / 60);
      for (let i = 0; i < NT; i++) { const a = Math.max(0, i - 1), b = Math.min(NT - 1, i + 1), v = Math.max(0, (D.sT[b] - D.sT[a]) * 60 / (b - a)); D.vT[i] = v; D.Wt[i] = visAt(D, i / 60) * Math.min(1.7, Math.pow(v / 55, 1.3)); }
      // when the head reaches arclength s (0 = it is already past at the start, Infinity = never)
      D.tOfS = s => { const T = D.sT; if (s <= T[0]) return 0; if (s > T[NT - 1]) return Infinity; let lo = 0, hi = NT - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] < s) lo = m; else hi = m; } return (lo + (s - T[lo]) / Math.max(T[hi] - T[lo], 1e-6)) / 60; };
      const j0 = Math.max(0, Math.floor((D.sT[0] - d.LEN) / DSR)), j1 = Math.min(Math.floor((d.sTot - 1) / DSR), Math.ceil(D.sT[NT - 1] / DSR)); D.j0 = j0; D.j1 = j1;
      D.q = new Float32Array((j1 + 1) * 3); D.tg = new Float32Array((j1 + 1) * 3);
      for (let j = j0; j <= j1; j++) { const s = Math.max(j * DSR, 0.7); d.pathAt(s, pA); d.pathAt(s + 0.6, pB); d.pathAt(s - 0.6, pC); pB.sub(pC).normalize(); D.q.set([pA.x, pA.y, pA.z], j * 3); D.tg.set([pB.x, pB.y, pB.z], j * 3); }
      return D;
    });
    const F = Film.T, A = Film.A, h = (d, t) => d.headAt(t, V());
    fronts = [
      { t: F.ROAR + 0.1, o: h(Dragon.red, F.ROAR + 0.1), c: 55, S: 1.7, dur: Math.max(0.6, F.ROAR_END - F.ROAR - 0.5), ref: 55 },   // the same 55 m/s the mist's roar front runs at
      { t: F.WROAR + 0.1, o: h(Dragon.white, F.WROAR + 0.1), c: 55, S: 1.45, dur: Math.max(0.6, F.WROAR_END - F.WROAR - 0.4), ref: 55 },
      { t: F.CLASH1, o: A.clash1.clone(), c: 85, S: 1.5, dur: 0.35, ref: 50 },
      { t: F.BOLT + 0.12, o: A.boltHit.clone(), c: 85, S: 1.3, dur: 0.25, ref: 30 },
      { t: F.CLASH2, o: A.clash2.clone(), c: 85, S: 1.7, dur: 0.35, ref: 50 },
      { t: F.SPLASH, o: A.splash.clone(), c: 60, S: 1.5, dur: 0.50, ref: 40 },
      { t: F.BLAST, o: Film.beamMidAt(F.BLAST, V()), c: 85, S: 2.8, dur: 1.0, ref: 60 },                                             // the same 85 m/s the mist's blast front runs at
    ].sort((a, b) => a.t - b.t);
    if (NOWAKE) fronts = [];
  }
  // walk both rails past every registered plant: per plant the three strongest passes
  function passes() {
    const CELL = 19, REACH = 36, key = (ix, iz) => (ix + 512) * 2048 + (iz + 512), grid = new Map();
    let np = 0; for (const g of groups) np += g.n;
    const px = new Float32Array(np), py = new Float32Array(np), pz = new Float32Array(np), pr = new Float32Array(np), cand = new Array(np); let o = 0;
    for (const g of groups) { g.o = o; for (let i = 0; i < g.n; i++, o++) { px[o] = g.ctr[i * 3]; py[o] = g.ctr[i * 3 + 1]; pz[o] = g.ctr[i * 3 + 2]; pr[o] = g.R[i]; const k = key(Math.floor(px[o] / CELL), Math.floor(pz[o] / CELL)); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(o); } }
    let nEv = 0, sMax = 0;
    for (let di = 0; di < drs.length; di++) {
      const D = drs[di], d = D.d, lastJ = new Int32Array(np).fill(-99), minD = new Float32Array(np), minJ = new Int32Array(np), RB = d.RMAX * 0.9, NT = D.NT;
      const fin = pi => {
        const j = minJ[pi], sS = j * DSR, ta = D.tOfS(sS); if (ta === Infinity) return;
        const tb = D.tOfS(sS + d.LEN), ia = Math.floor(ta * 60), ib = tb === Infinity ? NT - 1 : Math.min(NT - 1, Math.ceil(tb * 60));
        let P = 0; for (let i = ia; i <= ib; i += 3) { const a = D.sT[i] - sS; if (a < 0 || a > d.LEN) continue; const w = D.Wt[i] * (0.3 + 0.7 * d.rProf(a)); if (w > P) P = w; }
        if (P < 0.03) return;
        let i1 = -1, i2 = -1, M = 0, n = 0; for (let i = ia; i <= ib; i += 3) { const a = D.sT[i] - sS; if (a < 0 || a > d.LEN) continue; const w = D.Wt[i] * (0.3 + 0.7 * d.rProf(a)); if (w >= 0.45 * P) { if (i1 < 0) i1 = i; i2 = i; } }
        for (let i = i1; i <= i2; i += 3) { const a = D.sT[i] - sS; M += D.Wt[i] * (0.3 + 0.7 * d.rProf(clamp(a, 0, d.LEN))); n++; } M /= Math.max(1, n);
        const gap = Math.max(0, minD[pi] - RB - pr[pi]), S = Math.exp(-gap / 13) * (0.55 * P + 0.45 * M); if (S < 0.035) return;
        const tx = D.tg[j * 3], ty = D.tg[j * 3 + 1], tz = D.tg[j * 3 + 2], rx = px[pi] - D.q[j * 3], rz = pz[pi] - D.q[j * 3 + 2], rl = Math.max(minD[pi], 0.5), kr = 0.6 * Math.exp(-gap / 7);
        let fx = tx * 0.8 + rx / rl * kr, fz = tz * 0.8 + rz / rl * kr; const fl = Math.hypot(fx, fz) || 1; fx *= S / fl; fz *= S / fl;
        (cand[pi] || (cand[pi] = [])).push({ S, t0: i1 / 60, dur: Math.max(0.3, (i2 - i1) / 60), fx, fz, tx, ty, tz, v: D.vT[Math.min(NT - 1, i1 + 6)], gap, di });
      };
      for (let j = D.j0; j <= D.j1; j++) {
        const qx = D.q[j * 3], qy = D.q[j * 3 + 1], qz = D.q[j * 3 + 2], ix = Math.floor(qx / CELL), iz = Math.floor(qz / CELL);
        for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const c = grid.get(key(ix + a, iz + b)); if (!c) continue;
          for (let k = 0; k < c.length; k++) { const pi = c[k], dx = px[pi] - qx, dy = py[pi] - qy, dz = pz[pi] - qz, lim = REACH + RB + pr[pi], d2 = dx * dx + dy * dy + dz * dz; if (d2 > lim * lim) continue;
            const dd = Math.sqrt(d2); if (j - lastJ[pi] > 4) { if (lastJ[pi] >= 0) fin(pi); minD[pi] = dd; minJ[pi] = j; } else if (dd < minD[pi]) { minD[pi] = dd; minJ[pi] = j; } lastJ[pi] = j; } }
      }
      for (let pi = 0; pi < np; pi++) if (lastJ[pi] >= 0) fin(pi);
    }
    for (const g of groups) for (let i = 0; i < g.n; i++) {
      const c = NOWAKE ? null : cand[g.o + i]; g.ev[i] = null; if (!c) continue; c.sort((a, b) => b.S - a.S); if (c.length > 3) c.length = 3; g.ev[i] = c;
      for (let k = 0; k < c.length; k++) { const e = c[k], a = g.e[k].array; a[i * 4] = e.t0; a[i * 4 + 1] = e.dur; a[i * 4 + 2] = e.fx; a[i * 4 + 3] = e.fz; nEv++; if (e.S > sMax) sMax = e.S; }
    }
    for (const g of groups) for (const a of g.e) a.needsUpdate = true;
    info.plants = np; info.passes = nEv; info.sMax = +sMax.toFixed(2);
  }


  // ================= what a pass tears loose =================
  const hsh = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const PMB = m => { m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendEquation = THREE.AddEquation; return m; };
  // the rock as the tables see it: its planting sites (about one a metre), in a coarse grid for "how near is rock", a fine one for
  // a pebble's bounces, and a map of the ground under a falling leaf
  let gCo = null, gFi = null, gGr = null; const CO = 10, FI = 2, GR = 1.6, k3 = (i, j, k) => ((i + 128) * 256 + (j + 128)) * 256 + (k + 128), k2 = (i, k) => (i + 512) * 2048 + (k + 512);
  function rockGrids() {
    gCo = new Map(); gFi = new Map(); gGr = new Map(); const S = Rock.sites, fl = Math.floor;
    for (let i = 0; i < S.length; i++) { const p = S[i].p; let k = k3(fl(p.x / CO), fl(p.y / CO), fl(p.z / CO)), l = gCo.get(k); if (!l) gCo.set(k, l = []); l.push(i);
      k = k3(fl(p.x / FI), fl(p.y / FI), fl(p.z / FI)); l = gFi.get(k); if (!l) gFi.set(k, l = []); l.push(i);
      if (S[i].n.y > 0.35) { k = k2(fl(p.x / GR), fl(p.z / GR)); l = gGr.get(k); if (!l) gGr.set(k, l = []); l.push(p.y); } }
  }
  // the first ground below yFrom at (x, z); where there is no rock it is the lake (y = 0.05)
  function groundAt(x, z, yFrom) { const l = gGr.get(k2(Math.floor(x / GR), Math.floor(z / GR))); let g = 0.05; if (l) for (let i = 0; i < l.length; i++) if (l[i] <= yFrom + 0.4 && l[i] > g) g = l[i]; return g; }

  // ---- torn leaves: every strong pass over a maple rips a burst out of it. One leaf = one closed-form flight from its birth ----
  // carried down the wake (decelerating), wound round the line of travel, lifted, then falling at its own speed, side-slipping;
  // it lies where it lands (on rock, or on the lake, where it drifts) until the film fades
  const LEAF_GLSL = /* glsl */`
    vec3 wkLeaf(float tau, vec4 O, vec4 C, vec4 Q, vec4 B){
      float e = 1.0 - exp(-C.w * tau); vec3 cd = normalize(C.xyz + vec3(1e-4, 2e-4, 0.0)), n1 = normalize(cross(cd, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0)), n2 = cross(cd, n1);
      float ph = B.y * 6.283 + 7.0 * e + 0.8 * tau, g = (1.0 - exp(-1.1 * tau)) / 1.1, fl = min(tau * 0.4, 1.0);
      vec3 p = O.xyz + C.xyz * e + (n1 * cos(ph) + n2 * sin(ph)) * (B.x * e);
      p.y += Q.y * g - B.z * (tau - g);
      p.x += 0.45 * sin(tau * 2.3 + B.y * 19.0) * fl + ${(0.9 * WIND.d[0]).toFixed(3)} * tau; p.z += 0.45 * cos(tau * 1.9 + B.y * 31.0) * fl + ${(0.9 * WIND.d[1]).toFixed(3)} * tau;
      return p; }`;
  const lf = V(), lc = V(), ln1 = V(), ln2 = V(), UPV = V(0, 1, 0);
  function leafAt(tau, O, C, kd, u0, rho, ph0, vt, out) {             // the same flight in JS (finds where and when it lands)
    const e = 1 - Math.exp(-kd * tau); lc.copy(C); lc.x += 1e-4; lc.y += 2e-4; lc.normalize(); ln1.crossVectors(lc, UPV); ln1.x += 1e-4; ln1.normalize(); ln2.crossVectors(lc, ln1);
    const ph = ph0 * 6.283 + 7 * e + 0.8 * tau, g = (1 - Math.exp(-1.1 * tau)) / 1.1, fl = Math.min(tau * 0.4, 1);
    out.copy(O).addScaledVector(C, e).addScaledVector(ln1, Math.cos(ph) * rho * e).addScaledVector(ln2, Math.sin(ph) * rho * e);
    out.y += u0 * g - vt * (tau - g); out.x += 0.45 * Math.sin(tau * 2.3 + ph0 * 19) * fl + +(0.9 * WIND.d[0]).toFixed(3) * tau; out.z += 0.45 * Math.cos(tau * 1.9 + ph0 * 31) * fl + +(0.9 * WIND.d[1]).toFixed(3) * tau; return out;
  }
  function tornLeaves(scene) {
    // three things tear leaves out of a crown: a body passing (the pass table), a pressure front arriving (a ring of leaves that
    // crosses the valley with it), and every big gust of the valley's own wind (a puff that streams off downwind)
    const B = [[], [], [], []], want = [0, 0, 0, 0], CAP = [12000, 7000, 5000, 2500];      // a body passing a maple, a pressure front, a gust of the valley's wind, a body passing a pine
    const add = (k, g, i, e, n) => { if (n < 0.5) return; B[k].push({ g, i, e, n }); want[k] += n; };
    for (const g0 of groups) { const tear = g0.tear || g0.shed; if (!tear || NOWAKE) continue; const g = g0; for (let i = 0; i < g.n; i++) {
      const ev = g.ev[i], cx = g.ctr[i * 3], cy = g.ctr[i * 3 + 1], cz = g.ctr[i * 3 + 2]; if (g.gone && g.gone[i]) continue;
      if (ev) for (const e of ev) { if (e.S < 0.10 || e.v < 6) continue; add(g.tear ? 0 : 3, g, i, e, Math.min(2400, tear * 1900 * e.S * e.S)); }      // (by the square: the pass that all but touches a crown takes most of the leaves)
      for (const f of fronts) { const dx = cx - f.o.x, dy = cy - f.o.y, dz = cz - f.o.z, dist = Math.hypot(dx, dy, dz), a = f.S * f.ref / (f.ref + dist); if (a < 0.28) continue;
        const hl = Math.max(Math.hypot(dx, dz), 1), ux = dx / hl, uz = dz / hl, k = hl / Math.max(dist, 1);
        add(1, g, i, { S: a, t0: f.t + dist / f.c, dur: 0.30, fx: ux, fz: uz, tx: ux * (0.5 + 0.5 * k), ty: 0.10 + 0.25 * (1 - k), tz: uz * (0.5 + 0.5 * k), v: 12 + 22 * Math.min(a, 1.2), gap: 0 }, tear * 140 * a); }
      if (!NOWIND && g.tear) for (const f of gusts()) { const t = gArr(f, cx, cz); if (t < 0.2 || t > Film.DUR - 6) continue; const a = f[4] * windK(t);
        add(2, g, i, { S: 0.3 * a, t0: t + 0.1, dur: 0.9, fx: f[1], fz: f[2], tx: f[1], ty: 0.05, tz: f[2], v: 9 + 9 * a, gap: 0, wind: 1 }, g.tear * 9 * a * a); }
    } }
    info.bursts = B.map(b => b.length); const tot = B.reduce((a, b) => a + b.length, 0); if (!tot || typeof Flora === 'undefined') return;
    const NK = B.map((b, k) => Math.min(CAP[k], Math.round(want[k]))), NL = NK[0] + NK[1] + NK[2] + NK[3], r = rng(606), aO = new Float32Array(NL * 4), aC = new Float32Array(NL * 4), aQ = new Float32Array(NL * 4), aB = new Float32Array(NL * 4), aF = new Float32Array(NL), O = V(), C = V(); let n = 0, tMin = 1e9, onWater = 0;
    let bMax = 0;
    for (let k = 0; k < 4; k++) { const kk = NK[k] / Math.max(want[k], 1), nEnd = n + NK[k]; let acc = 0;
     for (const b of B[k]) {
      acc += b.n * kk; const cnt = Math.min(nEnd - n, Math.floor(acc)); acc -= cnt; if (cnt > bMax) bMax = cnt; const g = b.g, e = b.e, R = g.R[b.i] / 0.75, hue = g.hue ? g.hue(b.i) : 0.35;
      for (let q = 0; q < cnt; q++, n++) {
        const u = r(), th = r() * TAU, rr = Math.cbrt(r()) * R; O.set(g.ctr[b.i * 3] + Math.cos(th) * rr * Math.sqrt(1 - u * u), g.ctr[b.i * 3 + 1] + (u - 0.45) * rr * 0.9, g.ctr[b.i * 3 + 2] + Math.sin(th) * rr * Math.sqrt(1 - u * u));
        const tb = e.t0 + Math.min(e.dur, 2.6) * Math.pow(r(), k === 1 || k === 2 ? 1.0 : 1.8) + 0.04 * r(), kd = 0.8 + 0.7 * r(), D = clamp(e.v * (0.12 + 0.38 * r()) / kd, 2.5, 34) * (0.5 + 0.5 * Math.min(1, e.S * 2.5));
        { const fl = Math.hypot(e.fx, e.fz) || 1; C.set(e.tx * 0.8 + e.fx / fl * 0.45 + (r() - .5) * 0.5, Math.max(e.ty * 0.6, -0.22) + (r() - .5) * 0.3, e.tz * 0.8 + e.fz / fl * 0.45 + (r() - .5) * 0.5).normalize().multiplyScalar(D); }
        const u0 = 1.0 + 3.4 * r(), rho = 0.5 + 2.6 * r(), ph0 = r(), vt = 0.9 + 0.9 * r(), sz = 0.20 + 0.15 * r();
        // where it comes down
        let tl = 15, water = 0, py = O.y, pd = 1; for (let tau = 0.3; tau < 15; tau += 0.3) { leafAt(tau, O, C, kd, u0, rho, ph0, vt, lf); const gy = groundAt(lf.x, lf.z, py), d = lf.y - gy - 0.04; if (d <= 0) { tl = tau - 0.3 * (-d) / Math.max(pd - d, 1e-3); water = gy < 0.06 ? 1 : 0; break; } py = lf.y; pd = d; }
        aO.set([O.x, O.y, O.z, tb], n * 4); aC.set([C.x, C.y, C.z, kd], n * 4); aQ.set([r(), u0, tl, hue + (r() - .5) * 0.16], n * 4); aB.set([rho, ph0, vt, sz], n * 4); aF[n] = water; onWater += water; if (tb < tMin) tMin = tb;
      }
     } }
    const g = new THREE.InstancedBufferGeometry(); g.instanceCount = n; g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2)); g.setIndex([0, 1, 2, 1, 3, 2]);
    for (const [k, a, sz] of [['aO', aO, 4], ['aC', aC, 4], ['aQ', aQ, 4], ['aB', aB, 4], ['aF', aF, 1]]) g.setAttribute(k, new THREE.InstancedBufferAttribute(a, sz));
    // a built-in Lambert material with the flight written into its vertex stage: the leaves take the sun through the shadow map, the sky fill and the haze like everything else
    const m = patch(new THREE.MeshLambertMaterial({ map: Flora.T.leaf, alphaTest: 0.4, side: THREE.DoubleSide, alphaToCoverage: true }), s => {
      Object.assign(s.sh.uniforms, U);
      s.vHead(`${GLSL_U}${LEAF_GLSL} attribute vec4 aO, aC, aQ, aB; attribute float aF; varying float vHue, vAir; vec3 lAx, lAy, lP; float lSz;`);
      s.v('#include <beginnormal_vertex>', /* glsl */`float lT = uWkT - aO.w, lTc = clamp(lT, 0.0, aQ.z), lLand = step(aQ.z, lT), lE = 1.0 - exp(-aC.w * lTc);
        lP = wkLeaf(lTc, aO, aC, aQ, aB);
        lP.xz += aF * lLand * (vec2(0.05, 0.11) * (lT - aQ.z) + 0.05 * vec2(sin(lT * 0.9 + aQ.x * 30.0), cos(lT * 0.7 + aQ.x * 17.0)));          // on the lake it drifts
        float lSp = aQ.x * 6.283 + (3.0 + 8.0 * aQ.x) * (lE * 2.2 + lTc * 1.3);
        lAx = normalize(vec3(cos(lSp), sin(lSp * 0.7) * 0.6, sin(lSp))); lAy = normalize(cross(lAx, vec3(sin(lSp * 0.61 + 1.0), cos(lSp * 0.61 + 1.0), 0.3)));
        vec3 lFx = vec3(cos(aQ.x * 40.0), 0.04, sin(aQ.x * 40.0)), lFy = vec3(-lFx.z, 0.03, lFx.x);
        lAx = normalize(mix(lAx, lFx, lLand)); lAy = normalize(mix(lAy, lFy, lLand)); lP.y += 0.03 * lLand;
        float lCd = distance(cameraPosition, lP), lAir = 1.0 - smoothstep(aQ.z - 0.4, aQ.z + 1.5, lT);
        lSz = max(aB.w, lAir * lCd * (9.6 / (projectionMatrix[1][1] * 1080.0))) * smoothstep(0.0, 0.10, lT) * (1.0 - smoothstep(86.3, 88.3, uWkT)) * smoothstep(1.2, 4.5, lCd); vHue = aQ.w; vAir = lAir;      // (a leaf never fills the lens; in the air it is never less than about 4.5 pixels of a 1080-line frame)
        vec3 objectNormal = normalize(cross(lAx, lAy));`);
      s.v('#include <begin_vertex>', 'vec3 transformed = lP + (lAx * position.x + lAy * position.y) * lSz;');
      s.fHead(`varying float vHue, vAir;\n${Flora.PAL}`);
      s.f('#include <map_fragment>', '{ vec4 sp = texture2D(map, vMapUv); diffuseColor = vec4(flPal(vHue, 0.0) * (dot(sp.rgb, vec3(0.6, 0.3, 0.1)) * 2.4 + 0.15), sp.a); }');
      s.f('#include <emissivemap_fragment>', 'totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.62, 0.40) * (0.85 + 1.15 * vAir);');      // a leaf in the air is lit through as much as on: it never goes black against the haze
    }, 'wkleaf');
    const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.receiveShadow = true; me.visible = false; me.name = 'wkLeaves'; scene.add(me);
    me.onBeforeRender = (rr, sc, cam) => { g.instanceCount = cam === G.camera ? n : 0; };                // only the lens sees them: a leaf is too small to find in the lake's mirror
    extra.push(t => { me.visible = t >= tMin; });
    info.leaves = n; info.onLake = onWater; info.burstMax = bMax;
  }

  // ---- dust and stones: wherever a body lies on, slides along or pushes off rock, and wherever a claw takes hold ----
  // The rails decide: every 2 m of each path the nearest rock is found once; while a part of the body within 2.6 m of it is moving,
  // dust pours off the face there (it billows out, then sinks down the wall and drifts with the wind) and stones come away: they
  // fall, strike the face, throw a puff at every strike and bounce on (each stone's arcs are found once, here; a frame only reads them).
  function scrapes(scene, fx) {
    const S = Rock.sites, fl = Math.floor, ev = []; let nBody = 0, nClaw = 0, cMin = 1e9; const REACH = 2.6;
    for (const D of drs) { const d = D.d, kA = 172 / d.LEN, legs = [23 / kA, 86 / kA];
      for (let j = D.j0; j <= D.j1; j++) {
        const qx = D.q[j * 3], qy = D.q[j * 3 + 1], qz = D.q[j * 3 + 2], ix = fl(qx / CO), iy = fl(qy / CO), iz = fl(qz / CO); let best = 1e9, bi = -1;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const l = gCo.get(k3(ix + a, iy + b, iz + c)); if (!l) continue; for (let k = 0; k < l.length; k++) { const p = S[l[k]].p, dx = p.x - qx, dy = p.y - qy, dz = p.z - qz, dd = dx * dx + dy * dy + dz * dz; if (dd < best) { best = dd; bi = l[k]; } } }
        if (bi < 0 || S[bi].p.y < 2.6) continue; const c = Math.sqrt(best); if (c - d.RMAX < cMin) cMin = c - d.RMAX; if (c > d.RMAX + 5.2) continue;                 // (rock in and just above the lake is wet: that is the water's business)
        const sS = j * DSR, add = (a, s, claw) => { const t = D.tOfS(sS + a); if (!(t > 0.05 && t < Film.DUR - 3)) return; const i = Math.min(D.NT - 1, Math.round(t * 60)), v = D.vT[i]; if (v < 1.2 || D.Wt[i] <= 0 && visAt(D, t) < 0.5) return;
          ev.push({ t, site: bi, tx: D.tg[j * 3], ty: D.tg[j * 3 + 1], tz: D.tg[j * 3 + 2], v, s: s * (0.35 + 0.65 * Math.min(1, v / 14)), claw }); if (claw) nClaw++; else nBody++; };
        for (let a = 2; a < d.LEN; a += 6) { const gap = c - d.RMAX * d.rProf(a); if (gap < REACH) add(a, 0.30 + 0.70 * clamp(1 - Math.max(gap, 0) / REACH), false); }
        for (const a of legs) { const gap = c - d.RMAX * d.rProf(a); if (gap < 5.0 && gap >= REACH) add(a, 0.6, true); }
      } }
    info.scrapes = [nBody, nClaw]; info.clearance = +cMin.toFixed(2); if (!ev.length || NOWAKE) return;
    ev.sort((a, b) => a.t - b.t); { const h = {}; for (const e of ev) { const k = Math.floor(e.t); h[k] = (h[k] || 0) + 1; } info.scrapeT = h; info.scrapeAt = [0.1, 0.3, 0.5, 0.7, 0.9].map(f => { const e = ev[Math.floor(ev.length * f)], p = S[e.site].p; return [+e.t.toFixed(2), +p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)]; }); }
    const r = rng(808), wsum = ev.reduce((a, e) => a + e.s, 0);
    // -- stones first: their strikes add to the dust --
    const NP = Math.min(520, Math.round(wsum * 7) + 40), MA = 7, aT = new Float32Array(NP * MA).fill(1e9), aP = new Float32Array(NP * MA * 3), aVl = new Float32Array(NP * MA * 3), aG = new Float32Array(NP * MA), nA = new Uint8Array(NP), tE = new Float32Array(NP), sz = new Float32Array(NP), ax = new Float32Array(NP * 3), sp = new Float32Array(NP);
    const p = V(), v = V(), nn = V(), hits = []; let np = 0, pa = 0, tP0 = 1e9, tP1 = -1;
    for (const e of ev) { pa += e.s / wsum * NP; const cnt = Math.min(NP - np, Math.floor(pa)); pa -= cnt; const s = S[e.site];
      for (let q = 0; q < cnt; q++, np++) {
        let t = e.t + 0.3 * r(); p.copy(s.p).addScaledVector(s.n, 0.45); p.x += (r() - .5) * 1.6; p.y += (r() - .5) * 1.6; p.z += (r() - .5) * 1.6; const big = 0.13 + 0.50 * r() * r();
        v.set(s.n.x * (1.5 + 3 * r()) + e.tx * Math.min(e.v, 30) * 0.12 + (r() - .5) * 2, s.n.y * (1.5 + 3 * r()) + 1.5 * r(), s.n.z * (1.5 + 3 * r()) + e.tz * Math.min(e.v, 30) * 0.12 + (r() - .5) * 2);
        const put = g => { const k = np * MA + nA[np]; aT[k] = t; aP.set([p.x, p.y, p.z], k * 3); aVl.set([v.x, v.y, v.z], k * 3); aG[k] = g; nA[np]++; };
        put(9.8); let nb = 0, end = t + 6;
        for (let st = 0; st < 420; st++) { v.y -= 9.8 / 60; p.addScaledVector(v, 1 / 60); t += 1 / 60;
          if (p.y < 0.05) { end = t; break; }                                                              // into the lake
          let hit = -1, hd = 0.5; const ix = fl(p.x / FI), iy = fl(p.y / FI), iz = fl(p.z / FI);
          for (let a = -1; a <= 1 && st > 4; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) { const l = gFi.get(k3(ix + a, iy + b, iz + c)); if (!l) continue; for (let k = 0; k < l.length; k++) { const o = S[l[k]], dx = p.x - o.p.x, dy = p.y - o.p.y, dz = p.z - o.p.z, h = dx * o.n.x + dy * o.n.y + dz * o.n.z, lat = dx * dx + dy * dy + dz * dz - h * h; if (h < 0.14 && h > -0.9 && lat < 0.85 && v.dot(o.n) < 0 && lat < hd + 0.35) { hit = l[k]; hd = lat; } } }
          if (hit >= 0) { nn.copy(S[hit].n); const vn = v.dot(nn); hits.push({ t, x: p.x, y: p.y, z: p.z, nx: nn.x, ny: nn.y, nz: nn.z, s: Math.min(1, -vn / 9) * (0.4 + big) }); v.addScaledVector(nn, -(1.42 + 0.1 * r()) * vn); v.multiplyScalar(0.78); p.addScaledVector(nn, 0.05); nb++;
            if (v.length() < 1.1 || nb >= MA - 2) { v.set(0, 0, 0); put(0); end = t + 2.5 + 2 * r(); break; } put(9.8); } }
        if (nA[np] < MA && aG[np * MA + nA[np] - 1] > 0 && p.y >= 0.05) { v.set(0, 0, 0); put(0); end = t; }
        tE[np] = end; sz[np] = big; nn.set(r() - .5, r() - .5, r() - .5).normalize(); ax.set([nn.x, nn.y, nn.z], np * 3); sp[np] = 3 + 9 * r(); if (aT[np * MA] < tP0) tP0 = aT[np * MA]; if (end > tP1) tP1 = end;
      } }
    if (np) {
      const ico = new THREE.IcosahedronGeometry(1, 0), pp = ico.attributes.position.array; for (let i = 0; i < pp.length; i += 3) { const k = 0.62 + 0.76 * hsh(Math.round(pp[i] * 31) + Math.round(pp[i + 1] * 57) * 3 + Math.round(pp[i + 2] * 91) * 7); pp[i] *= k; pp[i + 1] *= k * 0.75; pp[i + 2] *= k; } ico.computeVertexNormals();
      const me = new THREE.InstancedMesh(ico, new THREE.MeshLambertMaterial({ color: new THREE.Color(0.31, 0.26, 0.22), flatShading: true }), np); me.frustumCulled = false; me.receiveShadow = true; me.castShadow = false; me.visible = false; me.instanceMatrix.setUsage(THREE.DynamicDrawUsage); me.name = 'wkStones'; scene.add(me);
      const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), A = V(), P = V(), Sc = V();
      extra.push(t => { const on = t >= tP0 && t <= tP1; me.visible = on; if (!on) return; const cam = G.camera, kpx = cam ? 2.6 / (cam.projectionMatrix.elements[5] * 1080) : 0;      // a stone in the air is never less than about 2.5 pixels of a 1080-line frame
        for (let i = 0; i < np; i++) { const b = i * MA; let k = -1; if (t >= aT[b] && t <= tE[i]) for (let a = 0; a < nA[i]; a++) if (t >= aT[b + a]) k = a;
          if (k < 0) { Sc.set(0, 0, 0); P.set(0, -50, 0); Q.identity(); }
          else { const o = b + k, tau = t - aT[o], g = aG[o], fly = g > 0 ? t - aT[b] : aT[o] - aT[b]; P.set(aP[o * 3] + aVl[o * 3] * tau, aP[o * 3 + 1] + aVl[o * 3 + 1] * tau - 0.5 * g * tau * tau, aP[o * 3 + 2] + aVl[o * 3 + 2] * tau);
            Q.setFromAxisAngle(A.set(ax[i * 3], ax[i * 3 + 1], ax[i * 3 + 2]), sp[i] * fly); Sc.setScalar(Math.max(sz[i], g > 0 && cam ? cam.position.distanceTo(P) * kpx : 0) * (1 - sm(tE[i] - 0.5, tE[i], t))); }
          M.compose(P, Q, Sc); me.setMatrixAt(i, M); }
        me.instanceMatrix.needsUpdate = true; });
    }
    info.stones = np; info.strikes = hits.length;
    // -- dust: soft puffs on the effects layer (depth-tested by hand against the scene, like every puff in 70_fx.js) --
    const NH = Math.min(hits.length, 1400), ND = Math.min(3000, ev.length * 16) + NH, aO = new Float32Array(ND * 4), aV = new Float32Array(ND * 4), aR = new Float32Array(ND * 4); let n = 0, acc = 0, tA = 1e9, tB = -1;
    for (const e of ev) { acc += e.s / wsum * (ND - NH); const cnt = Math.min(ND - NH - n, Math.floor(acc)); acc -= cnt; const s = S[e.site];
      for (let q = 0; q < cnt; q++, n++) { const t = e.t + 0.25 * r(), life = 3.0 + 2.6 * r(), kn = 1.4 + 2.6 * r(), kv = Math.min(e.v, 40) * (0.05 + 0.10 * r());
        aO.set([s.p.x + s.n.x * 0.6 + (r() - .5) * 2.0, s.p.y + s.n.y * 0.6 + (r() - .5) * 2.0, s.p.z + s.n.z * 0.6 + (r() - .5) * 2.0, t], n * 4);
        aV.set([s.n.x * kn + e.tx * kv + (r() - .5), s.n.y * kn + e.ty * kv + 0.5 * r(), s.n.z * kn + e.tz * kv + (r() - .5), (1.1 + 1.5 * r()) * (0.55 + 0.6 * e.s)], n * 4);
        aR.set([r(), r(), life, (0.50 + 0.40 * r()) * (0.5 + 0.5 * e.s)], n * 4); if (t < tA) tA = t; if (t + life > tB) tB = t + life; } }
    for (let h = 0; h < NH; h++, n++) { const k = hits[Math.floor(h * hits.length / NH)], life = 1.3 + 1.2 * r(), kn = 1.0 + 1.6 * r();
      aO.set([k.x + (r() - .5) * 0.5, k.y + (r() - .5) * 0.5, k.z + (r() - .5) * 0.5, k.t], n * 4); aV.set([k.nx * kn + (r() - .5), k.ny * kn + 0.4 * r(), k.nz * kn + (r() - .5), (0.55 + 0.7 * r()) * (0.5 + k.s)], n * 4);
      aR.set([r(), r(), life, (0.55 + 0.35 * r()) * (0.45 + 0.55 * Math.min(1, k.s))], n * 4); if (k.t < tA) tA = k.t; if (k.t + life > tB) tB = k.t + life; }
    if (n) {
      const g = new THREE.InstancedBufferGeometry(); g.instanceCount = n; g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3)); g.setIndex([0, 1, 2, 1, 3, 2]);
      g.setAttribute('aO', new THREE.InstancedBufferAttribute(aO, 4)); g.setAttribute('aV', new THREE.InstancedBufferAttribute(aV, 4)); g.setAttribute('aR', new THREE.InstancedBufferAttribute(aR, 4));
      const tPuff = typeof FX !== 'undefined' && FX.U && FX.U.tPuff ? FX.U.tPuff : { value: Tex.canvas(64, 64, (x, w) => { const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); g.addColorStop(0, 'rgba(200,200,200,1)'); g.addColorStop(0.5, 'rgba(150,150,150,0.6)'); g.addColorStop(1, 'rgba(110,110,110,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); }) };      // (the effects' own puff; a plain soft disc without them)
      const m = PMB(new THREE.ShaderMaterial({ uniforms: { ...Post.fxU, uWkT: U.uWkT, tPuff }, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false,
        vertexShader: /* glsl */`attribute vec4 aO, aV, aR; uniform float uWkT; varying vec2 vUv; varying float vVZ, vA;
          void main(){ float tau = uWkT - aO.w, lf = tau / aR.z, k = step(0.0, tau) * step(tau, aR.z);
            vec3 p = aO.xyz + aV.xyz * (1.0 - exp(-1.5 * tau)) / 1.5 + vec3(${(0.8 * WIND.d[0]).toFixed(3)}, 0.0, ${(0.8 * WIND.d[1]).toFixed(3)}) * tau;
            p.y -= (1.3 + 2.2 * aR.y) * (tau - (1.0 - exp(-0.9 * tau)) / 0.9);                                  // it billows out, then pours down the face
            float sz = aV.w * (0.35 + 1.9 * sqrt(max(lf, 0.0))), rot = aR.x * 6.283 + tau * (aR.y - 0.5) * 1.2; vec2 q = position.xy, rq = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
            vec4 mv = viewMatrix * vec4(p, 1.0); mv.xy += rq * sz * 2.0; vVZ = mv.z; gl_Position = projectionMatrix * mv; vUv = position.xy + 0.5;
            vA = k * aR.w * smoothstep(0.0, 0.06, lf) * (1.0 - smoothstep(0.35, 1.0, lf));
            if (k < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
        fragmentShader: /* glsl */`${Post.GLSL_FXDEPTH} uniform sampler2D tPuff; varying vec2 vUv; varying float vVZ, vA;
          void main(){ vec4 tx = texture2D(tPuff, vUv); float a = tx.a * vA * softZ(vVZ, 2.5) * smoothstep(3.0, 12.0, -vVZ);
            gl_FragColor = vec4(mix(vec3(0.25, 0.17, 0.15), vec3(0.74, 0.54, 0.38), tx.r) * a, a); }` }));      // limestone dust: ochre in the sun, umber in its own shade (the mist is white: this must not be)
      const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.visible = false; me.renderOrder = 1; me.name = 'wkDust'; fx.add(me);
      extra.push(t => { me.visible = t >= tA && t <= tB; });
    }
    info.dust = n;
  }

  // ================= per frame =================
  const fP = new Float32Array(2 * NS * 4), fV = new Float32Array(2 * NS * 4), fE = new Float32Array(NF * 4), fH = new Float32Array(NF * 4), extra = [];
  function update(t) {
    U.uWkT.value = t; U.uWkG.value.set(windK(t), 0.16, NOWAKE ? 0 : 1, 0);
    { const T = gusts(); let last = -1; for (let i = 0; i < T.length; i++) if (t >= T[i][0]) last = i;                 // the newest four fronts that have entered the valley
      for (let k = 0; k < 4; k++) { const i = last - k, u = U.uWkGu.value[k], a = U.uWkGa.value[k]; if (i >= 0 && t - T[i][0] < 15) { const g = T[i]; u.set(g[1], g[2], g[0] - WIND.S0 / g[3], g[3]); a.set(g[4], 0, 0, 0); } else { u.set(1, 0, 1e9, 30); a.set(0, 0, 0, 0); } } }
    sample(drs[0], t, fP, fV, 0); sample(drs[1], t, fP, fV, NS * 4); frontsAt(t, fE, fH);
    for (let i = 0; i < 2 * NS; i++) { U.uWkP.value[i].set(fP[i * 4], fP[i * 4 + 1], fP[i * 4 + 2], fP[i * 4 + 3]); U.uWkV.value[i].set(fV[i * 4], fV[i * 4 + 1], fV[i * 4 + 2], 0); }
    for (let k = 0; k < NF; k++) { U.uWkE.value[k].set(fE[k * 4], fE[k * 4 + 1], fE[k * 4 + 2], fE[k * 4 + 3]); U.uWkH.value[k].set(fH[k * 4], fH[k * 4 + 1], fH[k * 4 + 2], fH[k * 4 + 3]); }
    for (const f of extra) f(t);
  }
  let built = false;
  // called by 90_main.js after Dragon.build (one line); until it is, the first frame calls it (Flora.build registers Wake.boot)
  function build(scene, fx) {
    if (built) return true; if (typeof Dragon === 'undefined' || !Dragon.red.ready || !Dragon.white.ready) return false;
    built = true; const t0 = performance.now();
    rails(); clearance(); passes(); const t1 = performance.now();
    if (typeof Rock !== 'undefined' && Rock.sites.length) { rockGrids(); tornLeaves(scene); scrapes(scene, fx); gCo = gFi = gGr = null; }
    info.ms = Math.round(performance.now() - t0); info.msPass = Math.round(t1 - t0); G.info.wake = info;
    G.tick.push(update); return true;
  }
  const boot = () => { if (!built) build(G.scene, G.fx); };          // build() appends update to G.tick, so it still runs in this same frame
  return { U, GLSL, GLSL_BEND, GLSL_GUST: GLSL_U + GLSL_GUST, WIND, gustAt, windK, get gusts() { return gusts(); }, windAt, plants, clear, build, boot, groups, info, get fronts() { return fronts; }, get rails() { return drs; }, NS, NF };
})();
