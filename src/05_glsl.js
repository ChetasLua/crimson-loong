'use strict';
// ---- palette + shared GLSL (noise, sky, fog, wind) -------------------------------------------------
const SUN = new THREE.Vector3(0.558, 0.423, 0.714).normalize();   // the last low sun, from the right of the lens (the side the cloud towers are lit from): cliffs and halls get a lit face and a shaded one
const SUN_COL = new THREE.Color(1.0, 0.66, 0.38);                 // the key at the start of the film: low gold (Daylight tints it toward ember as the take runs)
const glv = v => `vec3(${v.x !== undefined ? [v.x, v.y, v.z].map(x => x.toFixed(5)).join(',') : v.map(x => x.toFixed(5)).join(',')})`;

const GLSL_NOISE = /* glsl */`
#ifndef CL_NOISE
#define CL_NOISE
#define SUN_DIR ${glv(SUN)}
float hash11(float p){ p = fract(p*.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3,p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float hash31(vec3 p3){ p3 = fract(p3*.1031); p3 += dot(p3,p3.zyx+31.32); return fract((p3.x+p3.y)*p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); p3 += dot(p3,p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
vec3 hash33(vec3 p3){ p3 = fract(p3*vec3(.1031,.1030,.0973)); p3 += dot(p3,p3.yxz+33.33); return fract((p3.xxy+p3.yxx)*p3.zyx); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x), mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x), f.y); }
float vnoise3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x), mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x), mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x), f.y), f.z); }
float fbm2(vec2 p){ float a=.5,s=0.; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.2); a*=.5; } return s; }
float fbm3(vec3 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*vnoise3(p); p=p*2.03+vec3(17.1,9.2,5.3); a*=.5; } return s; }
#endif
`;

// analytic dusk sky (no clouds). d = unit view dir (world). Red lives in the low sky; above it the evening is blue.
const GLSL_SKY = /* glsl */`
#ifndef CL_SKY
#define CL_SKY
vec3 skyBase(vec3 d, float disc){
  float h = clamp(d.y, -0.05, 1.0);
  float sd = max(dot(d, SUN_DIR), 0.0);
  float az = dot(normalize(d.xz + 1e-5), normalize(SUN_DIR.xz)) * 0.5 + 0.5;
  vec3 zen = vec3(0.066, 0.092, 0.235);
  vec3 mid = mix(vec3(0.205, 0.235, 0.395), vec3(0.350, 0.300, 0.400), az);       // evening blue away from the sun, mauve on its side
  vec3 low = mix(vec3(0.980, 0.430, 0.330), vec3(1.280, 0.600, 0.260), az);       // the red belt above the horizon
  vec3 hor = mix(vec3(1.150, 0.400, 0.230), vec3(1.650, 0.740, 0.220), az * az);
  float k = 1.0 - h;
  vec3 c = mix(zen, mid, pow(k, 2.0)); c = mix(c, low, pow(k, 4.6)); c = mix(c, hor, pow(k, 14.0));
  c = mix(c, vec3(0.300, 0.230, 0.400), (1.0 - az) * pow(k, 30.0) * 0.55);         // earth-shadow band under the glow, away from the sun
  { vec2 cu = d.xz / max(d.y + 0.10, 0.05);                                       // high cirrus combed by the wind: the last thing the sun still reaches
    float ci = fbm2(cu * vec2(0.50, 1.7) + vec2(4.0, 1.0)) * 0.7 + fbm2(cu * vec2(1.3, 4.6)) * 0.3;
    ci = smoothstep(0.50, 0.78, ci) * smoothstep(0.03, 0.28, d.y);
    c = mix(c, vec3(1.40, 0.56, 0.36), ci * 0.72); }
  c += vec3(1.3, 0.52, 0.18) * pow(sd, 6.0) * 0.42;
  c += vec3(2.4, 1.25, 0.46) * pow(sd, 48.0) * 0.8;
  c += vec3(6.0, 3.6, 1.6) * pow(sd, 700.0) * disc;
  c += vec3(60.0, 38.0, 17.0) * smoothstep(0.99962, 0.99982, sd) * disc;
  if (d.y < 0.0) c = mix(c, vec3(0.17, 0.13, 0.15), smoothstep(0.0, -0.25, d.y));
  return c;
}
#endif
`;

// ---- the light of the day: one moving state every material reads ------------------------------------------------------------
//   Daylight.U            shared uniforms of the chunk below (clT, clA, clB, clC). Built-in materials and plain ShaderMaterials get
//                         them by themselves (Material.prototype.onBeforeCompile); patch() adds them too.
//   Daylight.apply(t)     sets every value for film time t (pure in t): cloud-shadow drift, the storm's shadow, the dusk line, sun tint
//   Daylight.sunAt(x,y,z,t)  CPU copy of clSunAt: the share of direct sun (0..1) that reaches a world point at film time t
//   GLSL, in every shader that includes GLSL_FOG (all built-in materials do):
//     float clSunAt(vec3 wp)   0..1 share of the direct sun at a world point: drifting cloud shadows, the storm's shadow, the dusk line
//     vec3  clSun(vec3 wp)     the same times the sun's tint of the moment (1,1,1 at the start of the film): multiply your sun colour by it
//   Cloud shadows live on the ground plane and are carried up along the sun's rays, so a shadow slides down a cliff as it arrives.
const Daylight = (() => {
  const tBake = performance.now();
  const N = 256, P = 704, VX = -5.6, VZ = 2.2;             // texels, metres per tile, drift of the clouds (m/s): with the valley wind of GLSL_WIND
  const SLX = SUN.x / SUN.y, SLZ = SUN.z / SUN.y, AZL = Math.hypot(SUN.x, SUN.z), AZX = SUN.x / AZL, AZZ = SUN.z / AZL;
  const F = new Float32Array(N * N), RG = new Float32Array(N * N), MI = new Float32Array(N * N), RIM = new Float32Array(N * N), RAY = new Float32Array(N * N), px = new Uint8Array(N * N * 4);
  const WL = Math.hypot(VX, VZ), WX = VX / WL, WZ = VZ / WL;
  // metres inside the outline of a blob { u, v, r (tile units), e (stretch along the wind) } at tile point (u, v); negative outside
  const inside = (q, u, v) => { let du = u - q.u, dv = v - q.v; du -= Math.round(du); dv -= Math.round(dv); if (Math.abs(du) > 0.2 || Math.abs(dv) > 0.2) return -1e3;
    const al = du * WX + dv * WZ, ac = -du * WZ + dv * WX; return (1 - Math.hypot(al / q.e, ac) / q.r) * q.r * P; };
  // texel k from its stored fields: r = share of sun, g = ragged noise for the storm and dusk edges, b = beams at a cloud's rim (for the shafts)
  const texel = k => { const edge = Math.max(MI[k], -80) + RIM[k];                     // metres inside the outline, with a ragged rim
    F[k] = 1 - sm(-4.5, 4.5, edge);
    px[k * 4] = Math.round(F[k] * 255); px[k * 4 + 1] = Math.round(clamp(RG[k]) * 255); px[k * 4 + 2] = Math.round(255 * sm(-70, -16, edge) * (1 - sm(-3, 5, edge)) * RAY[k]); px[k * 4 + 3] = 255; };
  { const hs = (x, y, s) => { let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 1274126177); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
    const vn = (u, v, f, s) => { const x = u * f, y = v * f, xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const x0 = ((xi % f) + f) % f, x1 = (x0 + 1) % f, y0 = ((yi % f) + f) % f, y1 = (y0 + 1) % f;
      return lerp(lerp(hs(x0, y0, s), hs(x1, y0, s), fx), lerp(hs(x0, y1, s), hs(x1, y1, s), fx), fy); };
    // the shadows of single cumulus: one ragged blob in most cells of a jittered grid, a little longer along the wind
    const C = 7, cell = 1 / C, blobs = [];
    for (let cj = 0; cj < C; cj++) for (let ci = 0; ci < C; ci++) { if (hs(ci, cj, 31) < 0.14) continue;
      blobs.push({ u: (ci + 0.5 + (hs(ci, cj, 32) - 0.5) * 0.62) * cell, v: (cj + 0.5 + (hs(ci, cj, 33) - 0.5) * 0.62) * cell, r: lerp(19, 38, hs(ci, cj, 34)) / P, e: lerp(1.0, 1.45, hs(ci, cj, 35)) }); }
    // and of the small low puffs between them (the sky's fast layer): many short shadows, so an edge is always crossing something
    const C2 = 15;
    for (let cj = 0; cj < C2; cj++) for (let ci = 0; ci < C2; ci++) { if (hs(ci, cj, 51) < 0.42) continue;
      blobs.push({ u: (ci + 0.5 + (hs(ci, cj, 52) - 0.5) * 0.8) / C2, v: (cj + 0.5 + (hs(ci, cj, 53) - 0.5) * 0.8) / C2, r: lerp(8, 15, hs(ci, cj, 54)) / P, e: lerp(1.0, 1.6, hs(ci, cj, 55)) }); }
    for (let j = 0, k = 0; j < N; j++) for (let i = 0; i < N; i++, k++) { const u = (i + 0.5) / N, v = (j + 0.5) / N;
      let m = -1e3; for (const q of blobs) m = Math.max(m, inside(q, u, v));
      MI[k] = m; RIM[k] = (0.55 * vn(u, v, 22, 1) + 0.30 * vn(u, v, 45, 2) + 0.15 * vn(u, v, 90, 3) - 0.5) * 22;
      RG[k] = 0.6 * vn(u, v, 4, 11) + 0.4 * vn(u, v, 9, 12);
      RAY[k] = sm(0.60, 0.72, 0.65 * vn(u, v, 29, 41) + 0.35 * vn(u, v, 61, 42));
      texel(k); } }
  const bakeMs = Math.round(performance.now() - tBake);
  const tex = new THREE.DataTexture(px, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  const U = { clT: { value: tex }, clA: { value: new THREE.Vector4() }, clB: { value: new THREE.Vector4() }, clC: { value: new THREE.Vector4() }, clTear: { value: [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector4()) }, clTearR: { value: new THREE.Vector2(-70, -70) }, clGloom: { value: new THREE.Vector4(58, 0, 0, 0) } };
  const feed = u => { u.clT = U.clT; u.clA = U.clA; u.clB = U.clB; u.clC = U.clC; u.clTear = U.clTear; u.clTearR = U.clTearR; u.clGloom = U.clGloom; };
  const tap = (A, u, v) => { u = (u - Math.floor(u)) * N - 0.5; v = (v - Math.floor(v)) * N - 0.5; const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j, i0 = (i + N) % N, i1 = (i + 1) % N, j0 = (j + N) % N, j1 = (j + 1) % N;
    return lerp(lerp(A[j0 * N + i0], A[j0 * N + i1], fx), lerp(A[j1 * N + i0], A[j1 * N + i1], fx), fy); };
  // the state of the light at film time t (pure). Written into S and the uniforms.
  const rec = () => ({ t: -1, lift: 1, shaft: 1, offU: 0, offV: 0, cloud: 0, dusk: 0, stormC: 0, storm: 0, duskC: 0, duskK: 0, tint: [1, 1, 1], flash: 0, key: 1, cool: 0, gloom: 0, bolt: 0, ceil: 58, tear: new Float32Array(24), tearR: [-70, -70] });
  const S = rec();
  const DBG = Q.get('light') ? Q.get('light').split(',').map(Number) : null;      // QA: &light=cloudDepth,stormDepth,duskLine (a negative value keeps the film's own)
  const DK = [76, 520, 79, 70, 82.5, -40, 85.5, -165, 87, -250, 88.2, -350, 89.2, -600];      // dusk line: time, position along the sun's azimuth (ground-projected metres)
  const OFF = [0.0, 0.0];                                  // where the field sits at t = 0 (chosen once at load by plan())
  // the storm: its front stands at ground-plane z = STORM.z at film time STORM.at and moves toward the lens at STORM.v m/s; k = share of the
  // sun it takes; ceil = top of the dark layer (m); tear = radius of the gap a diving loong tears in it (m); bolt = strength of a strike as a
  // key; lift = how far the camera opens under it
  const SQP = Q.get('storm') ? Q.get('storm').split(',').map(Number) : [];      // QA: &storm=k,tear,bolt,lift,v,tearT0,ceil
  const STORM = { z: -42, at: 26.6, edge: 10, ceil: SQP[6] > 0 ? SQP[6] : 84, v: SQP[4] > 0 ? SQP[4] : 27, t0: 17.5, t1: 24.5, k: SQP[0] >= 0 ? SQP[0] : 0.90, tear: SQP[1] >= 0 ? SQP[1] : 40, tearT0: SQP[5] > 0 ? SQP[5] : 30.4, tearT1: SQP[5] > 0 ? SQP[5] + 1.2 : 31.6, bolt: SQP[2] >= 0 ? SQP[2] : 0.55, lift: SQP[3] >= 0 ? SQP[3] : 0.06 };
  // a loong in the plane of the shadows (carried down the sun's rays to the ground): its head, the points a third and two thirds down its
  // body and its tail, each averaged over 2.4 s of its flight, written to out[o..o+11] as three segments; returns the height of the lowest
  const hv = new THREE.Vector3(), HT = [-1.2, -0.6, 0, 0.6, 1.2], HW = [1 / 9, 2 / 9, 3 / 9, 2 / 9, 1 / 9], BP = [0, 0.33, 0.66, 0.97], bq = new Float64Array(12);
  const bodyG = (d, t, out, o) => { bq.fill(0);
    for (let k = 0; k < 5; k++) { const w = HW[k], tk = t + HT[k], s0 = d.sOf(tk);
      for (let j = 0; j < 4; j++) { if (j) d.pathAt(s0 - d.LEN * BP[j], hv); else d.headAt(tk, hv); bq[j * 3] += (hv.x - SLX * hv.y) * w; bq[j * 3 + 1] += hv.y * w; bq[j * 3 + 2] += (hv.z - SLZ * hv.y) * w; } }
    for (let j = 0; j < 3; j++) { out[o + j * 4] = bq[j * 3]; out[o + j * 4 + 1] = bq[j * 3 + 2]; out[o + j * 4 + 2] = bq[j * 3 + 3]; out[o + j * 4 + 3] = bq[j * 3 + 5]; }
    return Math.min(bq[1], bq[4], bq[7], bq[10]); };
  function state(t, S) {
    const T = Film.T;
    S.t = t;
    S.offU = OFF[0] - VX * t / P; S.offV = OFF[1] - VZ * t / P;
    // the splash is the costliest second of the film: while the lens is down on the lake (56.9 to 58.6 s) the shaft march is faded out
    // and skipped, so the frame pays nothing for it there (the cloud shadows on the land stay)
    S.shaft = 1 - sm(56.0, 56.85, t) * (1 - sm(58.6, 59.7, t));
    S.cloud = 0.80;
    // the sun sinks through the take: gold, then ember; the haze follows
    S.dusk = sm(0, 86, t) * 0.75 + 0.25 * sm(T.GONG - 2, 88.2, t);
    // THE STORM. The shadow of its low outflow comes down the valley toward the lens at the speed of the cloud (STORM.v, 27 m/s on the
    // ground; down a wall at 16 m/s): thin over the far ranges while the red loong leaps, on the main spire from 20 s, down the gate from
    // its roof at 25.1 s while the roar still stands, over the terraces by 27.5 s and at the lens by 30.5 s. Under it nine tenths of the
    // sun are gone and what is left is the grey-blue of the cloud's base; it holds until the BLAST. The layer is low (STORM.ceil, a ragged
    // 44 m): the floor of the valley, the halls and the feet of the spires stand in it, the tops and whatever flies above still have the
    // last sun, so the two loongs fight in gold light over a dark valley and go dim when they dive into it.
    const sIn = sm(STORM.t0, STORM.t1, t);
    S.stormC = STORM.z + STORM.v * (t - STORM.at);
    S.storm = STORM.k * sIn * (1 - sm(T.BLAST + 0.9, T.BLAST + 3.2, t));
    // how much of the sky over the valley the cloud has taken (0..1): the fill light, the bounce off the rock and the haze follow it
    S.gloom = sIn * sm(-330, 95, S.stormC) * (1 - sm(T.BLAST + 0.25, T.BLAST + 2.7, t));
    S.ceil = STORM.ceil + 4.0 * Math.sin(0.37 * t + 1.0) + 1.5 * Math.sin(0.93 * t);       // the top of the layer heaves slowly: the line of the light on every spire is never quite still
    // the tear: from the moment the white loong breaks out of the cloud, a loong that dives into the dark layer tears it open and the sun
    // follows it down (the first pass at the lens, the knot above the gate, the plunge into the lake and the climb out of it). Per loong
    // two ragged capsules in the plane of the shadows, head to a third of the body to two thirds of it, each point smoothed over 2.4 s,
    // so the pool of light on the valley floor drifts instead of twitching. The BLAST throws them open at 150 m/s: the sun comes
    // back to the valley as a ring racing outward.
    for (let k = 0; k < 24; k += 2) { S.tear[k] = -12; S.tear[k + 1] = 20; } S.tearR[0] = S.tearR[1] = -70;
    if (S.storm > 0 && t > STORM.tearT0 && typeof Dragon !== 'undefined' && Dragon.red && Dragon.white && Dragon.red.ready && Dragon.white.ready) {
      const on = sm(STORM.tearT0, STORM.tearT1, t), grow = 150 * Math.max(0, t - T.BLAST - 0.04);
      for (let k = 0; k < 2; k++) { const d = k ? Dragon.white : Dragon.red, yl = bodyG(d, t, S.tear, k * 12);
        S.tearR[k] = lerp(-70, STORM.tear, on * (1 - sm(S.ceil - 12, S.ceil + 6, yl))) + grow; }
    }
    // the end: the ridge behind the lens takes the sun; its shadow climbs from the lake to the gate, the cliffs and at last the tops
    { let k = 0; while (k < DK.length - 4 && t > DK[k + 2]) k += 2; S.duskC = lerp(DK[k + 1], DK[k + 3], clamp((t - DK[k]) / (DK[k + 2] - DK[k]))); }
    S.duskK = sm(75.0, 76.5, t);
    // the sun's tint moves in steps of a quarter second (each under a thousandth): between steps no material has to be told a new value
    const tq = Math.floor(t * 4) / 4, e = sm(0, 86, tq) * 0.75 + 0.25 * sm(T.GONG - 2, 88.2, tq);
    S.key = lerp(1, 0.66, e);
    S.tint[0] = S.key; S.tint[1] = S.key * lerp(1, 0.70, e * e); S.tint[2] = S.key * lerp(1, 0.52, e * e);
    S.flash = typeof Film.flashAt === 'function' ? Math.min(Film.flashAt(t), 1.6) : 0;
    // lightning as a KEY: a strike lights the valley from the sun's side for a tenth of a second, so it throws the sun's own hard
    // shadows (the beam's flicker between BEAM and BLAST is a light in the valley, not in the cloud: it stays out of this)
    S.bolt = t >= T.BEAM && t < T.BLAST ? 0 : STORM.bolt * S.flash;
    if (DBG) { if (DBG[0] >= 0) S.cloud = DBG[0]; if (DBG[1] >= 0) { S.storm = DBG[1]; S.gloom *= DBG[1] > 0 ? 1 : 0; } if (DBG[2] >= 0) S.duskK = DBG[2]; if (DBG[3] >= 0) S.tearR[0] = S.tearR[1] = DBG[3] > 0 ? DBG[3] : -70; if (DBG[4] >= 0) S.bolt *= DBG[4]; }
    S.cool = 0.30 * S.gloom + 0.35 * sm(T.DESCENT, T.DESCENT + 4, t) * (1 - sm(T.BLAST, T.BLAST + 3, t));
    // the camera's own answer: it holds its stop under the storm (the valley is meant to go dark), and opens up a good deal when the sun has left
    S.lift = (1 + STORM.lift * S.gloom) * (1 + 1.5 * sm(82.0, 88.2, t));
    return S;
  }
  function apply(t) {
    state(t, S);
    U.clA.value.set(S.offU, S.offV, S.cloud, S.dusk);
    U.clB.value.set(S.stormC, S.storm, S.duskC, S.duskK);
    U.clC.value.set(S.tint[0] - 1, S.tint[1] - 1, S.tint[2] - 1, S.flash);
    for (let k = 0; k < 6; k++) U.clTear.value[k].set(S.tear[k * 4], S.tear[k * 4 + 1], S.tear[k * 4 + 2], S.tear[k * 4 + 3]);
    U.clTearR.value.set(S.tearR[0], S.tearR[1]);
    U.clGloom.value.set(S.ceil, S.gloom, S.bolt, 0);
    return S;
  }
  const SQ = rec();                                         // the record sunAt works in: a query for another time never disturbs the frame's own S
  const capD = (gx, gz, q, o) => { const pax = gx - q[o], paz = gz - q[o + 1], bax = q[o + 2] - q[o], baz = q[o + 3] - q[o + 1], h = clamp((pax * bax + paz * baz) / Math.max(bax * bax + baz * baz, 1e-3)); return Math.hypot(pax - bax * h, paz - baz * h); };
  function sunAt(x, y, z, t) {
    if (t !== SQ.t) state(t, SQ);
    const gx = x - SLX * y, gz = z - SLZ * y, u = gx / P + SQ.offU, v = gz / P + SQ.offV;
    let s = 1 - SQ.cloud * (1 - tap(F, u, v)); const rag = (tap(RG, u, v) - 0.5) * 70;
    { const rg = rag * 0.45, q = SQ.tear, open = 1 - Math.min(sm(SQ.tearR[0] - 14, SQ.tearR[0] + 14, Math.min(capD(gx, gz, q, 0), capD(gx, gz, q, 4), capD(gx, gz, q, 8)) + rg), sm(SQ.tearR[1] - 14, SQ.tearR[1] + 14, Math.min(capD(gx, gz, q, 12), capD(gx, gz, q, 16), capD(gx, gz, q, 20)) + rg));
      s *= 1 - SQ.storm * (1 - sm(SQ.stormC - STORM.edge, SQ.stormC + STORM.edge, gz + rag)) * (1 - sm(SQ.ceil - 9, SQ.ceil + 9, y + rag * 0.3)) * (1 - open); }
    s *= 1 - SQ.duskK * sm(SQ.duskC - 20, SQ.duskC + 20, gx * AZX + gz * AZZ + rag);
    return s;
  }
  // Where the field sits at t = 0 is chosen once at load (pure arithmetic, the same on every machine): the heads of the two loongs are
  // in the sun at the moments the film is about and the gate opens the film in the sun; everywhere else the land should be crossed by
  // shadow edges as often as the field allows, with about two thirds of it in the sun.
  const SPOTS = [[0, 24, -12], [-26, 30, -5], [32, 25, 6], [-48, 40, 22], [-52, 78, 0], [46, 44, 26], [10, 60, -62], [10, 96, -66], [-18, 60, -54], [39, 70, -80], [-45, 100, -96], [-15, 6, 29], [9, 4, 39], [-5, 1, 48]];
  function plan() {
    const tPlan = performance.now();
    const hero = [], v = new THREE.Vector3(), T = Film.T, win = (t, a, b, up, dn) => sm(a, a + up, t) * (1 - sm(b - dn, b, t));
    const gu = (x, y, t) => (x - SLX * y - VX * t) / P, gv = (z, y, t) => (z - SLZ * y - VZ * t) / P;
    const add = (x, y, z, t, w) => hero.push(gu(x, y, t), gv(z, y, t), w);
    for (let t = 1.5; t <= 19; t += 0.5) { add(0, 24, -12, t, 1.2); add(0, 8, -5, t, 0.6); }
    for (let t = 1.5; t <= 6.0; t += 0.5) { add(-30, 40, 10, t, 0.8); add(10, 80, -64, t, 1.2); }
    for (let t = 85; t <= 87; t += 0.5) add(10, 96, -66, t, 2.0);                                     // the last light on the dragon's spire
    if (typeof Dragon !== 'undefined' && Dragon.red && Dragon.white && Dragon.red.headAt) {
      const hot = t => 0.35 + 3 * (win(t, 21.0, 22.2, 0.3, 0.3) + win(t, T.ROAR, T.ROAR_END, 0.3, 0.3) + win(t, 31.8, 32.6, 0.3, 0.3) + win(t, T.FACEOFF, T.WROAR_END, 0.5, 0.5) + win(t, T.CLASH1 - 0.6, T.CLASH1 + 0.4, 0.2, 0.2)
        + win(t, T.CLASH2 - 0.6, T.SPLASH, 0.3, 0.3) + win(t, T.BEAM, T.BLAST, 0.5, 0.2) + 0.5 * win(t, T.FINALE, T.GONG, 1, 1));
      for (let t = 6; t < T.GONG; t += 0.25) { const w = hot(t) + 0.8 * (1 - sm(17, 21, t)); Dragon.red.headAt(t, v); add(v.x, v.y, v.z, t, w); if (t > T.DESCENT) { Dragon.white.headAt(t, v); add(v.x, v.y, v.z, t, w); } }
    }
    const NT = 172, land = new Float32Array(SPOTS.length * NT * 2);                                   // every spot, every half second to 86 s
    for (let a = 0, k = 0; a < SPOTS.length; a++) for (let i = 0; i < NT; i++) { const q = SPOTS[a], t = i * 0.5; land[k++] = gu(q[0], q[1], t); land[k++] = gv(q[2], q[1], t); }
    let best = -1e9, bu = 0, bv = 0, bInfo = null; const M = 40;
    for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) { const ou = i / M, ov = j / M; let sc = 0, hs = 0, hw = 0, cross = 0, mean = 0;
      for (let k = 0; k < hero.length; k += 3) { const s = tap(F, hero[k] + ou, hero[k + 1] + ov) * hero[k + 2]; hs += s; if (hero[k + 2] > 0) hw += hero[k + 2]; }
      for (let a = 0, k = 0; a < SPOTS.length; a++) { let prev = -1, n = 0, m = 0;
        for (let q = 0; q < NT; q++, k += 2) { const s = tap(F, land[k] + ou, land[k + 1] + ov); m += s; const st = s > 0.5 ? 1 : 0; if (prev >= 0 && st !== prev) n++; prev = st; }
        cross += Math.min(n, 9); mean += m / NT; }
      mean /= SPOTS.length;
      sc = hs / hw * 10 + cross / SPOTS.length * 0.8 - Math.abs(mean - 0.66) * 9;
      if (sc > best) { best = sc; bu = ou; bv = ov; bInfo = [+(hs / hw).toFixed(3), +(cross / SPOTS.length).toFixed(2), +mean.toFixed(3)]; } }
    OFF[0] = bu; OFF[1] = bv; S.t = SQ.t = -1;
    // What must hold is then written into the field itself (it moves as one piece, so a place in the tile follows from where a thing is at
    // a time): the sky is clear over the gate when the film opens and over the two heads at the moments the film is about, and one cumulus
    // is put where its shadow reaches the gate at 8 s, covers gate and cliff at 10.3 s and has left by 14 s.
    const clear = (u, v, rad) => { const i0 = Math.floor((u - Math.floor(u)) * N), j0 = Math.floor((v - Math.floor(v)) * N), R = Math.ceil(rad / P * N) + 1;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const i = (i0 + di + N) % N, j = (j0 + dj + N) % N, k = j * N + i; let du = (i + 0.5) / N - u, dv = (j + 0.5) / N - v; du -= Math.round(du); dv -= Math.round(dv);
        const m = Math.hypot(du, dv) * P - rad; if (m < MI[k]) MI[k] = m; } };
    for (let t = 1.0; t <= 19; t += 0.5) if (t < 6.6 || t > 15.4) for (const q of [[0, 24, -12], [0, 8, -5], [14, 24, -10], [-14, 24, -10]]) clear(gu(q[0], q[1], t) + bu, gv(q[2], q[1], t) + bv, 38);
    for (let k = 0; k < hero.length; k += 3) if (hero[k + 2] >= 2.4) clear(hero[k] + bu, hero[k + 1] + bv, 36);
    { const q = { u: gu(0, 18, 10.3) + bu, v: gv(-9, 18, 10.3) + bv, r: 33 / P, e: 0.62 }, i0 = Math.floor((q.u - Math.floor(q.u)) * N), j0 = Math.floor((q.v - Math.floor(q.v)) * N), R = 26;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) { const i = (i0 + di + N) % N, j = (j0 + dj + N) % N, k = j * N + i, m = inside(q, (i + 0.5) / N, (j + 0.5) / N); if (m > MI[k]) MI[k] = m; } }
    for (let k = 0; k < N * N; k++) texel(k);
    tex.needsUpdate = true;
    let hl = 0, hw = 0; for (let k = 0; k < hero.length; k += 3) if (hero[k + 2] > 0) { hl += tap(F, hero[k] + bu, hero[k + 1] + bv) * hero[k + 2]; hw += hero[k + 2]; }
    G.info.light = { off: [+bu.toFixed(3), +bv.toFixed(3)], heroLit: +(hl / hw).toFixed(3), crossingsPerSpot: bInfo[1], landLit: bInfo[2], bakeMs, planMs: Math.round(performance.now() - tPlan) };
  }
  return { U, S, feed, apply, state, sunAt, plan, OFF, P, VX, VZ, SLX, SLZ, AZX, AZZ, tex, STORM, rec };
})();

const FOGP = { H: 28, A: 0.0023, B: 0.00060 };
const FILL_STORM = (Q.get('fills') || '0.56,0.62,0.76').split(',').map(x => (+x).toFixed(3));      // the fill inside the storm's layer, per unit of its depth (QA: &fills=r,g,b)
const GLSL_FOG = /* glsl */`
#ifndef CL_FOG
#define CL_FOG
uniform sampler2D clT; uniform vec4 clA; uniform vec4 clB; uniform vec4 clC; uniform vec4 clTear[6]; uniform vec2 clTearR; uniform vec4 clGloom;
float clCap(vec2 g, vec4 q){ vec2 pa = g - q.xy, ba = q.zw - q.xy; return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0)); }
// share of the direct sun at a world point (1 = full sun): cloud shadows drifting with the clouds, the storm's shadow, the dusk line.
// sto = how deep the point lies in the storm's shadow (0..clB.y); beam = the sun that comes down through the tear in the storm (0..1)
float clSunCore(vec3 wp, out float ray, out float sto, out float beam){
  vec2 g = wp.xz - vec2(${Daylight.SLX.toFixed(5)}, ${Daylight.SLZ.toFixed(5)}) * wp.y;
  vec4 n = texture2D(clT, g * ${(1 / Daylight.P).toFixed(7)} + clA.xy);
  float rag = (n.g - 0.5) * 70.0;
  float s = 1.0 - clA.z * (1.0 - n.r);
  float rg = rag * 0.45;
  float open = 1.0 - min(smoothstep(clTearR.x - 14.0, clTearR.x + 14.0, min(clCap(g, clTear[0]), min(clCap(g, clTear[1]), clCap(g, clTear[2]))) + rg),
                         smoothstep(clTearR.y - 14.0, clTearR.y + 14.0, min(clCap(g, clTear[3]), min(clCap(g, clTear[4]), clCap(g, clTear[5]))) + rg));
  float under = clB.y * (1.0 - smoothstep(clB.x - ${Daylight.STORM.edge.toFixed(1)}, clB.x + ${Daylight.STORM.edge.toFixed(1)}, g.y + rag)) * (1.0 - smoothstep(clGloom.x - 9.0, clGloom.x + 9.0, wp.y + rag * 0.3));
  sto = under * (1.0 - open); beam = under * open * s;
  s *= 1.0 - sto;
  s *= 1.0 - clB.w * smoothstep(clB.z - 20.0, clB.z + 20.0, dot(g, vec2(${Daylight.AZX.toFixed(5)}, ${Daylight.AZZ.toFixed(5)})) + rag);
  ray = n.b * clA.z;
  return s;
}
float clSunTap(vec3 wp, out float ray){ float so, be; return clSunCore(wp, ray, so, be); }
float clSunAt(vec3 wp){ float ray, so, be; return clSunCore(wp, ray, so, be); }
// the sun's colour of the moment at a world point. What a storm cloud lets through has lost the sun's gold: it is the grey-blue of the
// cloud's base. A lightning strike is added as a white key from the same side, so it falls through the sun's shadow map.
vec3 clSunK(vec3 wp, out float so){
  float ray, be; float s = clSunCore(wp, ray, so, be);
  vec3 c = mix((vec3(1.0) + clC.rgb) * s, vec3(0.50, 0.75, 1.36) * (s * (1.0 + clC.r)), so);
  return c + vec3(0.70, 1.08, 2.10) * clGloom.z;
}
vec3 clSun(vec3 wp){ float so; return clSunK(wp, so); }
// the fill light (sky above, bounce below, the environment) inside the storm's layer: the sky there is the underside of the cloud, a good
// deal darker and colder, and the warm bounce off sunlit rock is gone. Set once per fragment by the sun's hook in the light chunk.
vec3 clFill = vec3(1.0);
// aerial perspective: two media. The valley mist lies low and takes the sun's colour where the sun reaches it; the air itself is
// blue and stacks up with distance, so every rank of spires stands lighter, bluer and flatter than the one in front of it.
vec3 clFog(vec3 col, vec3 wp, vec3 cam){
  vec3 v = wp - cam; float d = length(v); v /= max(d, 1e-4);
  float b = ${(1 / FOGP.H).toFixed(5)};
  float y0 = max(cam.y, -10.0), y1 = max(wp.y, -10.0), dy = y1 - y0;
  float e0 = exp(-b * y0), e1 = exp(-b * y1);
  float avg = abs(dy) > 0.02 ? (e0 - e1) / (b * dy) : e0;
  float tm = ${FOGP.A.toFixed(5)} * d * avg, ta = ${FOGP.B.toFixed(5)} * d;
  float fw = max(dot(v, SUN_DIR), 0.0);
  float lit = clSunAt(cam + v * min(d * 0.6, 160.0));                      // the sun on the haze part way down the line of sight
  vec3 key = ${glv([SUN_COL.r, SUN_COL.g, SUN_COL.b])} * (vec3(1.0) + clC.rgb);
  float dusk = clA.w, f2 = fw * fw, f14 = f2 * f2 * f2; f14 *= f14 * f2; float ph = 0.42 + 0.50 * f2 + 1.3 * f14;
  vec3 sky = mix(vec3(0.33, 0.38, 0.54), vec3(0.17, 0.22, 0.42), dusk);     // what the haze scatters of the sky above it
  sky = mix(sky, vec3(0.150, 0.180, 0.250), clGloom.y * 0.85);              // under the storm that sky is the grey-blue base of the cloud
  vec3 mist = sky * 0.92 + key * (lit * ph * 0.86) + vec3(0.40, 0.50, 0.85) * clC.w;
  vec3 air = sky * mix(1.04, 0.90, smoothstep(40.0, 260.0, wp.y)) + key * (lit * (0.10 + 0.55 * f2 + 1.2 * f14)) + vec3(0.26, 0.33, 0.55) * clC.w;
  vec3 fc = (mist * tm + air * ta) / max(tm + ta, 1e-6);
  return mix(col, fc, 1.0 - exp(-(tm + ta)));
}
#endif
`;

const GLSL_WIND = /* glsl */`
#ifndef CL_WIND
#define CL_WIND
uniform float uWind; uniform float uGust;
vec3 clWind(vec3 wp, float w){
  float ph = uWind, g = 0.30 + 1.5 * uGust;
  float a = sin(ph * 1.25 + wp.x * 0.11 + wp.z * 0.07) * 0.55 + sin(ph * 2.9 + wp.z * 0.33 + wp.y * 0.21) * 0.28;
  float fl = sin(ph * 7.3 + wp.x * 2.1 + wp.y * 1.7 + wp.z * 1.3) * 0.06 * (0.6 + 2.0 * uGust);
  return w * (vec3(-0.80, 0.06, 0.32) * (a * g + 0.35 * uGust) + vec3(fl, fl * 0.6, -fl));
}
#endif
`;

// every built-in material gets our aerial perspective instead of three's fog
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG\n varying vec3 vFogW;\n#endif\n`;
THREE.ShaderChunk.fog_vertex = /* glsl */`#ifdef USE_FOG
  vec4 clFogW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    clFogW = instanceMatrix * clFogW;
  #endif
  vFogW = (modelMatrix * clFogW).xyz;
#endif
`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG\n varying vec3 vFogW;\n${GLSL_NOISE}\n${GLSL_FOG}\n#endif\n`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG\n gl_FragColor.rgb = clFog(gl_FragColor.rgb, vFogW, cameraPosition);\n#endif\n`;
// the sun (directional light 0: shadow casters sort first) is cut by the cloud shadows, the storm and the dusk line in every lit material
{ const a = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (!THREE.ShaderChunk.lights_fragment_begin.includes(a)) console.warn('light chunk: the sun hook did not land');
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(a, a + '\n#if defined( USE_FOG ) && ( UNROLLED_LOOP_INDEX == 0 )\n { float clSo; directLight.color *= clSunK( vFogW, clSo ); clFill = mix( vec3( 1.0 ), vec3( ' + FILL_STORM.join(', ') + ' ), clSo ); }\n#endif\n');
  // ... and the fill: hemisphere and environment are scaled by clFill (1 outside the storm's layer)
  const hook = (chunk, b) => { if (!THREE.ShaderChunk[chunk].includes(b)) console.warn('light chunk: the fill hook did not land', b); THREE.ShaderChunk[chunk] = THREE.ShaderChunk[chunk].replace(b, '\n#ifdef USE_FOG\n' + b.replace(';', ' * clFill;') + '\n#else\n' + b + '\n#endif\n'); };
  hook('lights_fragment_begin', 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );');
  hook('lights_fragment_maps', 'iblIrradiance += getIBLIrradiance( geometryNormal );');
  hook('lights_fragment_maps', 'radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );'); }
// every material that is compiled gets the light's uniforms: built-in ones, plain ShaderMaterials, and (below) patched ones
THREE.Material.prototype.onBeforeCompile = function (sh) { Daylight.feed(sh.uniforms); };

// patch helper: m.onBeforeCompile with ordered string replacements; shares time/wind uniforms
function patch(mat, fn, key) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = G.uTime; sh.uniforms.uWind = G.uWind; sh.uniforms.uGust = G.uGust; Daylight.feed(sh.uniforms);
    const api = {
      sh,
      v: (a, b) => { if (!sh.vertexShader.includes(a)) console.warn('patch miss (v)', key, a); sh.vertexShader = sh.vertexShader.replace(a, b); },
      f: (a, b) => { if (!sh.fragmentShader.includes(a)) console.warn('patch miss (f)', key, a); sh.fragmentShader = sh.fragmentShader.replace(a, b); },
      vHead: s => { sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + s); },
      fHead: s => { sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + s); },
    };
    fn(api);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}
