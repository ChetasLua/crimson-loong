'use strict';
// ---- sky: analytic dusk gradient + cloud ray-marched ONCE at load into four layers (torn tufts low over the valley, the storm
//      tower in a window of its own, the near towers, the far towers with the small cumulus), each a fisheye that drifts with the
//      wind at its own rate, so they slide against each other. At display time every layer flows along a velocity field baked
//      with it (two copies swapped in turn, so nothing runs away), the whole sky swells and sinks on standing waves, turrets climb
//      behind the storm tower, a shade wanders over it all, and the layers are composited front to back over streaming cirrus.
//      Every picture is a pure function of film time: nothing here remembers the frame before. Storm controls (Sky.fx) at display ----
const Sky = (() => {
  const FAST = Q.has('fast');
  const TH = rad(90.5);                                            // zenith angle at the rim of a whole-sky fisheye (equidistant, zenith in the centre)
  const LW = 1024, LH = 384, LE0 = rad(-10), LE1 = rad(90);        // small equirect copy of all layers, used only for the PMREM environment
  const NS = 128;                                                  // tiling 3D noise: billows in rgb, wisps in a
  const CB = 1.0;                                                  // cloud base in cloud units; the lens sits at the origin
  const HEART = new THREE.Vector3(-32, 287, -214).normalize();     // the storm tower's heart as seen from the lens, from OMEN on
  const OFF = new Set((Q.get('skyoff') || '').split(','));         // QA: &skyoff=drift,flow,swell,turret,cirrus,shade  &skyonly=0..3
  // ---- time. The sky goes with the valley wind, toward -X (to the left of frame): WX is the one sign that turns every layer and the
  //      cirrus the other way. Angles are radians about +Y, positive = to the right.
  const WX = Q.get('skywx') ? +Q.get('skywx') : -1;
  const WIND = { dir: new THREE.Vector3(0.93 * WX, 0, 0.37), sign: WX, puff: rad(2.0), storm: rad(0.50), near: rad(0.60), far: rad(0.27), cirrus: 0.013 };
  const T_REF = 80, T_TUFT = 45, CYC = Q.has('skycyc') ? +Q.get('skycyc') : 2.6, KCH = 1.1;        // towers stand as baked at T_REF (the finale keeps the sky it was staged against), tufts at T_TUFT; flow cycle (s); how much faster the storm's turrets climb from OMEN on
  const SPK = Q.has('skysp') ? +Q.get('skysp') : 1;                 // QA: &skysp= scales every surface speed, &skycyc= sets the flow cycle
  const smI = (a, b, t) => { const x = clamp((t - a) / (b - a)); return (b - a) * (x * x * x - 0.5 * x * x * x * x) + Math.max(t - b, 0); };   // integral of sm(a, b, .) up to t
  const NODRIFT = OFF.has('drift');
  // the storm tower rides in through the calm opening, slows from 18 s and stands on HEART from OMEN (27 s) to the end. The near
  // towers come up from the right all through the film and reach their baked places for the finale: the sky right of the storm is
  // open while the two fight there and chase the pearl, as it was staged
  const phiStorm = t => NODRIFT ? 0 : WX * WIND.storm * (t - smI(18, 27, t) - 22.5);
  const phiNear = t => NODRIFT ? 0 : WX * WIND.near * (t - T_REF);
  const phiFar = t => NODRIFT ? 0 : WX * WIND.far * (t - T_REF);
  const phiPuff = t => NODRIFT ? 0 : WX * WIND.puff * (t - T_TUFT);
  const churnAt = t => sm(26, 31, t);
  // storm controls, set by the film every frame
  const fx = { flash: 0, flashDir: new THREE.Vector3(0, 1, 0), rift: 0, riftDir: new THREE.Vector3(0, 1, 0), cool: 0, ring: 0, ringDir: new THREE.Vector3(0, 1, 0) };
  let rtLow, rtN, bakeMat, noiseMat, quad, qscene, qcam, jobs = [], total = 0, mesh, uni, envScene, envRT;

  // ---- the cloud towers. Each is a cluster of four lobes (main body, two shoulders, a crown turret) so the outline steps
  //      like real congestus. az: degrees right of -Z, d: distance, r: base radius, top: summit height, lean: shear to the
  //      right per unit of height, storm: 0..1, w0/w1: waist low/high
  const LOBE = [], CLU = [];
  const lobe = (x, z, r, top, lean, storm, w0, w1, ph) => LOBE.push({ x, z, r, top, lean, storm, w0, w1, ph });
  const close = (n, mid) => { const L = LOBE.slice(-n), m = L[0], h = (Math.max(...L.map(l => l.top)) - CB) / 2, cx = mid ? L.reduce((a, l) => a + l.x + l.lean * h, 0) / n : m.x + m.lean * h, cz = mid ? L.reduce((a, l) => a + l.z, 0) / n : m.z;
    CLU.push({ x: cx, z: cz, R: Math.max(...L.map(l => Math.hypot(l.x + l.lean * h - cx, l.z - cz) + l.r * 1.13 + Math.abs(l.lean) * h)), top: mid ? Math.max(...L.map(l => l.top)) + 0.75 : 99, hi: Math.max(...L.map(l => l.top)) }); };
  const tower = (az, d, r, top, lean, storm, w0, w1, seed) => {
    const a = rad(az), x = d * Math.sin(a), z = -d * Math.cos(a), R = rng(seed), H = top - CB, t1 = R() * TAU, t2 = t1 + rad(110 + 60 * R()), t3 = R() * TAU;
    lobe(x, z, r, top, lean, storm, w0, w1, R() * TAU);
    lobe(x + Math.cos(t1) * r * 0.78, z + Math.sin(t1) * r * 0.78, r * (0.56 + 0.12 * R()), CB + H * (0.52 + 0.16 * R()), lean, storm, 1.0, 0.70, R() * TAU);
    lobe(x + Math.cos(t2) * r * 0.85, z + Math.sin(t2) * r * 0.85, r * (0.48 + 0.12 * R()), CB + H * (0.34 + 0.14 * R()), lean, storm, 1.0, 0.72, R() * TAU);
    lobe(x + Math.cos(t3) * r * 0.30, z + Math.sin(t3) * r * 0.30, r * (0.44 + 0.10 * R()), CB + H * (1.0 + 0.07 * R()), lean, storm, 0.92, 0.80, R() * TAU);
    close(4);
  };
  { // THE storm tower: a stem on the left that leans right and swells into a head around the heart direction
    const hx = Math.hypot(HEART.x, HEART.z), dh = 4.7, yh = dh * HEART.y / hx, lean = 0.17;
    const x = HEART.x / hx * dh - lean * (yh - CB), z = HEART.z / hx * dh;
    lobe(x, z, 1.7, 9.4, lean, 1, 0.60, 1.0, 1.3);                  // stem and head
    lobe(x - 1.55, z + 0.25, 1.15, 5.2, lean, 0.9, 1.0, 0.66, 4.0);  // left shoulder
    lobe(x - 0.95, z - 1.85, 1.10, 8.3, lean, 1, 0.72, 1.0, 2.2);    // rear turret, behind and left of the stem
    lobe(x + 0.30, z - 0.35, 0.85, 10.0, lean, 1, 0.92, 0.84, 5.1);  // crown
    close(4);
    // the stem's foot: four turrets of different heights piled against the column on its sun side and its front. For the
    // first 27 s the lens looks straight at this foot from 4 units away: one broad column there reads as a wall of smoke,
    // a pile of domes reads as cumulus with a lit side, a shade side and a stepped outline
    lobe(x + 0.90, z + 0.62, 0.72, 3.50, 0.10, 1, 1.0, 0.74, 0.7);
    lobe(x - 0.30, z + 1.05, 0.66, 2.75, 0.10, 1, 1.0, 0.72, 3.1);
    lobe(x - 1.40, z + 1.05, 0.70, 2.95, 0.10, 1, 1.0, 0.70, 5.6);
    lobe(x + 0.80, z - 0.55, 0.62, 4.30, 0.12, 1, 0.95, 0.78, 2.4);
    close(4, true);
  }
  tower(44, 7.5, 2.1, 9.0, 0.14, 0, 1.0, 0.62, 11);                 // high on the right
  tower(-58, 7.2, 2.0, 8.2, 0.14, 0, 1.0, 0.64, 12);                // high on the left
  tower(96, 8.0, 2.1, 8.6, 0.14, 0, 1.0, 0.63, 21);                 // abeam right: the wind carries it into frame through the second half
  tower(152, 8.5, 2.2, 6.6, 0.12, 0, 1.0, 0.64, 18);                // behind, toward the sun: back-lit, for reflections
  tower(20, 13.5, 2.5, 7.9, 0.12, 0, 1.0, 0.66, 13);                // far, its head rising between the right-hand spires
  tower(-37, 17, 2.8, 6.6, 0.12, 0, 1.0, 0.64, 14);                 // far left
  tower(72, 13, 2.6, 7.4, 0.12, 0, 1.0, 0.62, 15);                  // far right
  tower(-93, 10, 2.3, 7.0, 0.12, 0, 1.0, 0.62, 16);                 // abeam left
  tower(112, 11, 2.2, 6.5, 0.12, 0, 1.0, 0.64, 17);                 // behind right
  tower(-140, 11, 2.6, 8.0, 0.12, 0, 1.0, 0.62, 19);                // behind left
  // ---- the four baked layers, front to back. c0..c1: its clusters; grid: the small far cumulus; W: texture size; th: zenith angle
  //      at the rim; ax: the fisheye's axis (the storm tower has a window of its own, so it gets the full detail in a small texture);
  //      fmax: the largest flow the 8-bit field can hold (uv per unit of speed); sp: surface speed (cloud units / s); sw: swell (cycles)
  const FARG = [3.7, 0.60, 9, 36, 1, 1];                            // the small cumulus: hash seed, share of cells that hold one, nearest, farthest, size, haze
  const dirAE = (az, el) => new THREE.Vector3(Math.sin(rad(az)) * Math.cos(rad(el)), Math.sin(rad(el)), -Math.cos(rad(az)) * Math.cos(rad(el)));
  const LAY = [
    // torn tufts low over the valley, the fastest: ragged, no flat base, seen from under and from the side
    { c0: 0, c1: 0, grid: 2, G: [+(Q.get('skyseed') || 6.7), 0.24, 1.2, 15, 1, 0.10], W: FAST ? 1280 : 2304, th: TH, ax: new THREE.Vector3(0, 1, 0), dmin: 3.0, sp: 0.0085 * SPK, sw: 1.0, roY: CB - 2.0, top: CB + 1.9, phi: phiPuff },
    { c0: 0, c1: 2, grid: 0, G: FARG, W: FAST ? 1216 : 2176, th: rad(54), ax: dirAE(-11, 34), dmin: 2.5, sp: 0.018 * SPK, sw: 1.0, roY: 0.03, top: 10.4, phi: phiStorm },      // the storm tower
    { c0: 2, c1: 6, grid: 0, G: FARG, W: FAST ? 1792 : 3072, th: TH, ax: new THREE.Vector3(0, 1, 0), dmin: 5.0, sp: 0.018 * SPK, sw: 1.0, roY: 0.03, top: 10.4, phi: phiNear },   // the near towers
    { c0: 6, c1: 12, grid: 1, G: FARG, W: FAST ? 1280 : 2304, th: TH, ax: new THREE.Vector3(0, 1, 0), dmin: 7.0, sp: 0.018 * SPK, sw: 1.0, roY: 0.03, top: 10.4, phi: phiFar }]; // the far towers and the small cumulus toward the horizon
  for (const L of LAY) {
    L.ex = new THREE.Vector3().crossVectors(L.ax, new THREE.Vector3(0, 0, 1)).normalize(); L.ez = new THREE.Vector3().crossVectors(L.ex, L.ax).normalize();
    L.B = new THREE.Matrix3().set(L.ex.x, L.ax.x, L.ez.x, L.ex.y, L.ax.y, L.ez.y, L.ex.z, L.ax.z, L.ez.z);      // columns: ex, axis, ez
    L.fmax = 0.5 / L.th / L.dmin * 1.3; L.M = new THREE.Matrix3(); L.K = new THREE.Vector4(0.5 / L.th, 0, 0, L.th);
    L.uvOf = d => { const x = d.dot(L.ex), y = d.dot(L.ax), z = d.dot(L.ez), th = Math.acos(clamp(y, -1, 1)), k = th / Math.max(Math.sqrt(1 - y * y), 1e-4) * 0.5 / L.th; return [0.5 + x * k, 0.5 + z * k]; };
    const un = Math.hypot(L.ex.y, L.ez.y) || 1; L.upx = L.ex.y / un; L.upy = L.ez.y / un;        // which way is up in this fisheye (exact at its centre)
  }
  const NHEADD = (d => new THREE.Vector3(d.dot(LAY[2].ex), d.dot(LAY[2].ax), d.dot(LAY[2].ez)))(dirAE(44, 37)), NHEAD = LAY[2].uvOf(dirAE(44, 37));     // the head of the near tower on the right, as baked
  const HEAD = LAY[1].uvOf(dirAE(-7, 55)), FOOT = LAY[1].uvOf(dirAE(-16, 24));     // the middle of the storm's head and of its foot in its own fisheye: turrets shrink toward one of them
  const v4 = a => `vec4(${a.map(x => x.toFixed(4)).join(',')})`;
  const arr = (list, f) => `vec4[${list.length}](${list.map(f).map(v4).join(',')})`;
  const NROT = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0.61, 0.33, 0.72).normalize(), 0.62).elements;
  const m3 = e => `mat3(${[e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]].map(x => x.toFixed(5)).join(',')})`;

  // tiling 3D noise, one slice per draw: r,g,b = billows (inverted Worley, 5 / 10 / 20 cells per period), a = soft fbm
  const NOISE = /* glsl */`
  ${GLSL_NOISE}
  uniform float uZ; varying vec2 vUv;
  float wly(vec3 p, float f){ p *= f; vec3 ip = floor(p), fp = fract(p); float d = 1.0;
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++){
      vec3 o = vec3(float(x), float(y), float(z)); vec3 r = o + hash33(mod(ip + o, f) + f * 1.37) - fp; d = min(d, dot(r, r)); }
    return 1.0 - min(d * 1.25, 1.0); }
  float lat(vec3 i, float f){ return hash31(mod(i, f) + f * 0.731); }
  float vnt(vec3 p, float f){ p *= f; vec3 i = floor(p), u = fract(p); u = u * u * (3.0 - 2.0 * u);
    return mix(mix(mix(lat(i, f), lat(i + vec3(1, 0, 0), f), u.x), mix(lat(i + vec3(0, 1, 0), f), lat(i + vec3(1, 1, 0), f), u.x), u.y),
               mix(mix(lat(i + vec3(0, 0, 1), f), lat(i + vec3(1, 0, 1), f), u.x), mix(lat(i + vec3(0, 1, 1), f), lat(i + vec3(1, 1, 1), f), u.x), u.y), u.z); }
  void main(){ vec3 p = vec3(vUv, uZ);
    float a = (vnt(p, 4.0) * 0.5 + vnt(p, 8.0) * 0.25 + vnt(p, 16.0) * 0.125 + vnt(p, 32.0) * 0.0625) / 0.9375;
    gl_FragColor = vec4(wly(p, 5.0), wly(p, 10.0), wly(p, 20.0), a); }`;

  const CLOUD = /* glsl */`
  ${GLSL_NOISE}
  ${GLSL_SKY}
  uniform highp sampler3D tN;
  uniform vec4 uPanel;                             // x: 0 fisheye / 1 equirect, y: coarseness 0..1, z: radians per texel, w: zenith angle at the rim
  uniform ivec3 uClu;                              // this layer: clusters x..y-1, z = 1 with the small far cumulus
  uniform mat3 uB;                                 // the fisheye's frame: columns ex, axis, ez
  uniform float uFmax; uniform vec2 uRo;           // x: height of the lens under this layer, y: the layer's ceiling
  uniform vec4 uG; uniform vec2 uG2;               // the small cumulus of this layer: hash seed, share of cells, nearest, farthest; size, haze
  varying vec2 vUv;
  layout(location = 0) out highp vec4 oCol;        // rgb = light scattered toward the lens, a = transmittance
  layout(location = 1) out highp vec4 oAux;        // r = cloud thickness behind the surface, g = puff (1) .. crease (0), 0 = no cloud anywhere near; ba = how the surface moves (uv per unit of speed)
  vec4 gL;                                         // set by field(): the winning lobe's axis x, z at the base, its lean, its top
  const float CB = ${CB.toFixed(2)}, TOPMAX = 10.4, GS = 4.8, SIGV = 85.0, ZF = 127.0 / 255.0;
  const int NC = ${CLU.length};
  const vec4 CA[NC] = ${arr(CLU, c => [c.x, c.z, c.R, c.top])};                                // cluster bounds: x, z, radius, ceiling (rays and light steps only climb: above it the cluster is never met again)
  const vec4 LA[NC * 4] = ${arr(LOBE, t => [t.x, t.z, t.r, t.top])};
  const vec4 LB[NC * 4] = ${arr(LOBE, t => [t.lean, t.storm, t.w0, t.w1])};
  const vec4 LC[NC * 4] = ${arr(LOBE, t => [clamp(t.r * 0.55, 0.5, 1.0), t.ph, 0, 0])};
  const mat3 NR = ${m3(NROT)};
  const vec3 LDIR = normalize(vec3(0.78, 0.40, 0.48));       // the cloud light: the dusk sun swung further to the right so the towers model
  const vec3 LDIRS = normalize(vec3(0.90, 0.40, 0.10));      // the storm tower's foot stands dead ahead, where that light is flat on: there it comes from the side
  // a cloud body: a solid of revolution on a flat base, bulging in tiers, positive inside
  float body(vec3 p, float rho, float r, float top, float w0, float w1, float ph, out float y){
    y = (p.y - CB) / (top - CB); float yc = clamp(y, 0.0, 1.0);
    float R = r * mix(w0, w1, smoothstep(0.12, 0.62, yc)) * sqrt(max(1.0 - yc * yc * yc, 0.0)) * (1.0 + 0.12 * sin(p.y * 2.4 + ph));
    return min(R - rho, (top - p.y) * 0.8); }
  // bare bodies (tower clusters + one small cumulus per far grid cell). o = (height 0..1, billow size, storm)
  float field(vec3 p, out vec3 o){
    float best = -40.0; o = vec3(0.0, 1.0, 0.0); gL = vec4(0.0);
    for (int i = uClu.x; i < uClu.y; i++) {
      vec4 cb = CA[i]; float ub = cb.z - length(p.xz - cb.xy);
      if (p.y > cb.w) continue;
      if (ub < -1.4) { best = max(best, ub); continue; }
      for (int k = 0; k < 4; k++) {
        int j = i * 4 + k; vec4 a = LA[j], b = LB[j];
        float y; float f = body(p, length(p.xz - a.xy - vec2(b.x, 0.0) * (p.y - CB)), a.z, a.w, b.z, b.w, LC[j].y, y);
        if (f > best) { best = f; o = vec3(y, LC[j].x, b.y); gL = vec4(a.xy, b.x, a.w); }
      }
    }
    if (uClu.z == 1 && p.y < CB + 3.6 && dot(p.xz, p.xz) > uG.z * uG.z * 0.444) {
      if (best < -1.9) { best = -1.9; o.y = 0.5; }
      vec2 ip = floor(p.xz / GS - 0.5);
      for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
        vec2 c = ip + vec2(float(i), float(j));
        vec3 h = hash33(vec3(c, uG.x)), h2 = hash33(vec3(c.yx, uG.x + 7.6));
        vec2 cc = (c + 0.5 + (h.xy - 0.5) * 0.6) * GS; float d0 = length(cc);
        if (h.z > uG.y * smoothstep(uG.z, uG.z * 1.3333, d0) * (1.0 - smoothstep(uG.w, uG.w * 1.2222, d0))) continue;
        float r = mix(0.7, 1.75, h2.x * h2.x) * uG2.x, top = CB + r * mix(0.7, 1.45, h2.y);
        float y; float f = body(p, length(p.xz - cc - vec2(0.13, 0.0) * (p.y - CB)), r, top, 1.0, 0.84, h2.z * 6.28, y);
        if (f > best) { best = f; o = vec3(y, clamp(r * 0.6, 0.5, 1.0), 0.0); gL = vec4(cc, 0.13, top); }
      }
    }
    if (uClu.z == 2 && p.y < CB + 1.9) {             // the fast low layer: one torn tuft per cell, a squashed ball that the billows eat into from every side
      if (best < -1.2) { best = -1.2; o.y = 0.5; }
      vec2 ip = floor(p.xz / 3.2 - 0.5);
      for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
        vec2 c = ip + vec2(float(i), float(j));
        vec3 h = hash33(vec3(c, uG.x)), h2 = hash33(vec3(c.yx, uG.x + 7.6));
        vec2 cc = (c + 0.5 + (h.xy - 0.5) * 0.6) * 3.2; float d0 = length(cc);
        if (h.z > uG.y * smoothstep(uG.z, uG.z * 1.5, d0) * (0.45 + 0.55 * smoothstep(2.5, 6.0, d0)) * (1.0 - smoothstep(uG.w, uG.w * 1.2667, d0))) continue;      // fewer high overhead: the fight needs open sky
        float r = mix(0.38, 0.85, h2.x * h2.x) * uG2.x, cy = CB + 0.75 + 0.5 * h2.y, sq = mix(1.5, 2.2, h2.z);
        float ql = length(vec3(p.x - cc.x, (p.y - cy) * sq, p.z - cc.y)), f = (r - ql) * (ql < r ? 0.8 : 1.0 / sq);
        if (f > best) { best = f; o = vec3(clamp((p.y - cy) * sq / r * 0.5 + 0.5, 0.0, 1.0), 1.0, 0.0); gL = vec4(cc, 0.0, cy + r / sq); }
      }
    }
    return best; }
  // how the surface of a cloud moves, in units of the layer's speed: it rises (hardly at the base, fastest high up), follows the lean
  // of its tower, and spreads outward where a head rolls over
  vec3 vel(vec3 p, vec3 o, vec4 L){
    vec2 rv = p.xz - L.xy - vec2(L.z, 0.0) * (p.y - CB); vec2 rh = rv / max(length(rv), 0.08);
    float up = 0.40 + 0.60 * smoothstep(CB, CB + 6.5, p.y), spread = 0.10 + 0.75 * smoothstep(0.55, 1.05, o.x);
    return vec3(rh.x * spread + L.z * up, up, rh.y * spread); }
  // a direction in this panel's fisheye
  vec2 fishP(vec3 d){ vec3 r = d * uB; float th = acos(clamp(r.y, -1.0, 1.0)); return 0.5 + r.xz * (th / max(sqrt(1.0 - r.y * r.y), 1e-4) * (0.5 / uPanel.w)); }
  // the underside: a soft, slightly uneven floor
  float baseCut(vec3 p, vec4 n1){ return ((p.y - CB) - 0.22 * (n1.r - 0.5) - 0.12 * (n1.a - 0.5)) * 0.42 - 0.01; }
  // sides of the cloud with the three big billow octaves
  float sides(vec3 p, float f, vec3 o, out vec4 n1){
    n1 = texture(tN, NR * p * 0.222);
    return f + o.y * (0.55 + 0.45 * smoothstep(0.0, 0.6, o.x)) * (0.56 * (n1.r - 0.5) + 0.26 * (n1.g - 0.5) + 0.11 * (n1.b - 0.5)); }
  float densLo(vec3 p){ vec3 o; float f = field(p, o); if (f + 0.47 * o.y < -0.12) return 0.0;
    vec4 n1; float s = sides(p, f, o, n1); return clamp(min(s, baseCut(p, n1)) * 8.0 + 0.2, 0.0, 1.0); }
  void main(){
    vec3 rd; float px = uPanel.z;
    if (uPanel.x < 0.5) {
      vec2 q = vUv * 2.0 - 1.0; float rr = length(q);
      if (rr > 1.0 || uPanel.y > 1.5) { oCol = vec4(0.0, 0.0, 0.0, 1.0); oAux = vec4(0.0, 0.0, ZF, ZF); return; }
      float th = rr * uPanel.w, s = sin(th); rd = uB * vec3(s * q.x / max(rr, 1e-5), cos(th), s * q.y / max(rr, 1e-5));
    } else {
      float az = (vUv.x * 2.0 - 1.0) * 3.14159265, el = mix(${LE0.toFixed(5)}, ${LE1.toFixed(5)}, vUv.y);
      rd = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
    }
    vec3 ro = vec3(0.0, uRo.x, 0.0);
    vec3 scat = vec3(0.0); float T = 1.0, wA = 0.0, tA = 0.0, pA = 0.0;
    vec3 vA = vec3(0.0), pN = ro + rd, oN = vec3(0.0, 1.0, 0.0); vec4 lN = vec4(0.0); float fN = -40.0;     // the surface's motion; the ray's closest pass by a cloud
    if (rd.y > 0.012) {
      float lq = max(uPanel.y, 0.6 * smoothstep(0.2, 0.7, rd.z));          // behind the lens the march is coarser
      float t = (CB - 0.22 - ro.y) / rd.y, t1 = min((uRo.y - ro.y) / rd.y, 46.0);
      float jit = hash21(gl_FragCoord.xy + 0.37), sd = dot(rd, LDIR);
      float ph = 0.82 + 0.18 * sd * sd + 1.5 * pow(max(sd, 0.0), 8.0);
      int nl = lq > 0.5 ? 4 : 5; float lg = lq > 0.5 ? 3.0 : 2.25;
      bool skipped = true;
      for (int i = 0; i < 230; i++) {
        if (t > t1 || T < 0.012) break;
        vec3 p = ro + rd * t; vec3 o; float f = field(p, o); vec4 L0 = gL;
        if (f > fN) { fN = f; pN = p; oN = o; lN = L0; }
        float fine = max(0.0045, t * px * 1.1) * (1.0 + 2.2 * lq);
        float ub = min(f + 0.47 * o.y + 0.07, (p.y - CB) * 0.42 + 0.09);
        if (ub < -0.16) { t += max(-(ub + 0.16) * 0.5, fine); skipped = true; continue; }
        if (skipped) { t += fine * jit; p = ro + rd * t; f = field(p, o); L0 = gL; skipped = false; }
        vec4 n1; float s = sides(p, f, o, n1), bc = baseCut(p, n1);
        if (min(s, bc) < -0.24) { t += max(fine, (-min(s, bc) - 0.20) * 0.35); continue; }
        vec4 n2 = texture(tN, (p * NR) * 1.18 + 0.37);
        float wpx = t * px, k1 = 1.0 - smoothstep(0.03, 0.09, wpx), k2 = 1.0 - smoothstep(0.008, 0.03, wpx);
        float k3 = 1.0 - smoothstep(0.004, 0.012, wpx);                                       // near towers get a finer grain still
        s += (0.075 * (n2.r - 0.5) + (0.036 * (n2.g - 0.5) + 0.018 * (n2.b - 0.5)) * k2) * k1;
        if (k3 > 0.0) { vec4 n3 = texture(tN, NR * p * 5.7 + 0.71); s += (0.015 * (n3.r - 0.5) + 0.008 * (n3.g - 0.5)) * k3; }
        s = min(s, bc);
        float hard = clamp(s / (0.012 + wpx * 0.9), 0.0, 1.0);
        float wisp = smoothstep(-0.13, 0.0, s) * smoothstep(0.52, 0.80, n1.a * 0.55 + n2.a * 0.45) * 0.05;
        float dens = max(hard, wisp);
        if (dens > 0.002) {
          float st = fine * (dens < 0.2 ? 2.2 : T < 0.35 ? 1.8 : 1.0);
          float a = 1.0 - exp(-dens * SIGV * st);
          if (T * a > 0.003) {
            float tau = 0.0, ls = 0.04, lam = 0.5; vec3 lp = p;
            vec3 dL = vec3(0.0); if (o.z > 0.0) dL = normalize(mix(LDIR, LDIRS, o.z * (1.0 - smoothstep(3.2, 6.2, p.y)))) - LDIR;     // added to LDIR, so every other cloud is lit exactly as before
            if (lq < 0.5) {                                                                      // fine relief: does the cloud thin out toward the light right here?
              lp = p + LDIR * 0.035 + dL * 0.035; vec3 ol; float fl = field(lp, ol); vec4 m1; float sl = sides(lp, fl, ol, m1);
              vec4 m2 = texture(tN, (lp * NR) * 1.18 + 0.37);
              sl += (0.075 * (m2.r - 0.5) + (0.036 * (m2.g - 0.5) + 0.018 * (m2.b - 0.5)) * k2) * k1;
              if (k3 > 0.0) { vec4 m3 = texture(tN, NR * lp * 5.7 + 0.71); sl += (0.015 * (m3.r - 0.5) + 0.008 * (m3.g - 0.5)) * k3; }
              sl = min(sl, baseCut(lp, m1));
              lam = clamp((s - sl) * (0.42 / 0.035) + 0.5, 0.0, 1.0); tau = clamp(sl * 8.0 + 0.2, 0.0, 1.0) * 0.035; ls = 0.07;
            }
            for (int j = 0; j < 7; j++) { if (j >= nl) break; lp += LDIR * ls + dL * ls; tau += densLo(lp) * ls; ls *= lg; }
            float tu = densLo(p + vec3(0.0, 0.10, 0.0)) * 0.10 + densLo(p + vec3(0.0, 0.36, 0.0)) * 0.30;
            float puff = clamp(n1.g * 0.55 + n2.r * 0.45, 0.0, 1.0), cr = smoothstep(0.22, 0.70, puff);
            // The light is stored as three shares, not as a colour: r = direct sun, g = fill from the sky, b = haze between the lens and
            // the cloud. The display colours them with the palette of the moment (day, storm, dusk), so one bake serves the whole film.
            float b1 = exp(-tau * 10.0), b2 = exp(-tau * 2.2), b3 = exp(-tau * 0.5);
            float lamS = smoothstep(0.12, 0.80, lam);                                           // a terminator, not a wash: a cauliflower head is in the sun or it is not
            float sunS = (b1 * ph * mix(0.13, 1.12, lamS) + b2 * 0.10 + b3 * 0.04) * mix(0.66, 1.0, cr);
            sunS += 0.22 * b1 * (1.0 - smoothstep(0.0, 0.35, dens));                            // thin fringes scatter forward: bright linings
            float ambS = (exp(-tu * 7.0) + 0.20 * (0.45 + 0.55 * exp(-max(p.y - CB, 0.0) * 0.4))) * mix(0.52, 1.0, cr) * (1.0 - 0.4 * lamS * b1);   // open to the sky above; a little comes up from the valley, so bases stay the darkest
            float dk = mix(1.0, 0.66, o.z * (1.0 - 0.7 * b1 * lamS)) * mix(1.0, mix(0.50, 1.0, smoothstep(0.92, 1.95, p.y + 0.5 * (n1.r - 0.5))), o.z);    // the storm tower is darker in its shade and stands on a dark floor
            float hz = 1.0 - exp(-max(t - 4.0, 0.0) * 0.05 * uG2.y);
            vec3 L = vec3(sunS * dk * (1.0 - hz), ambS * dk * (1.0 - hz), hz);
            float w = T * a; scat += w * L; wA += w; tA += w * t; pA += w * puff; vA += w * vel(p, o, L0); T *= 1.0 - a;
          }
          t += st;
        } else t += max(fine, -s * 0.35);
      }
    }
    float cov = 1.0 - T, tS = wA > 1e-4 ? tA / wA : 0.0, thick = 0.0;
    if (cov > 0.02) for (int k = 0; k < 4; k++) {
      vec3 pp = ro + rd * (tS + (k == 0 ? 0.2 : k == 1 ? 0.55 : k == 2 ? 1.1 : 2.0)); vec3 o; float f = field(pp, o);
      thick += clamp(min(f, (pp.y - CB) * 0.6) * 2.5 + 0.35, 0.0, 1.0) * 0.25; }
    oCol = vec4(scat, T);
    // the flow field reaches past the outline (from the ray's closest pass), so the edge of the cloud itself can move
    float kS = smoothstep(0.0, 0.6, cov);
    vec3 pF = mix(pN, ro + rd * max(tS, 0.5), kS), vF = mix(vel(pN, oN, lN) * smoothstep(-1.0, -0.15, fN), wA > 1e-4 ? vA / wA : vec3(0.0), kS);
    vec2 fl = (fishP(normalize(pF + vF * 0.02)) - vUv) * 50.0;
    float near = (fN > -1.15 || cov > 0.002) ? 1.0 : 0.0;
    oAux = vec4(thick * cov, near * max(wA > 1e-4 ? pA / wA : 0.5, 0.012), ZF + clamp(fl / uFmax, -1.0, 1.0) * ZF);
  }`;

  const dirQ = (k, d) => { const v = Q.get(k) ? Q.get(k).split(',').map(Number) : null; return v && v.length === 3 ? new THREE.Vector3(v[0], v[1], v[2]).normalize() : d.clone(); };
  const ovr = Q.get('skyfx') ? Q.get('skyfx').split(',').map(Number) : null;                  // &skyfx=flash,rift,cool,ring  (+ &skyfd= &skyrd= &skygd= x,y,z)
  const ovrDir = ovr ? [dirQ('skyfd', HEART), dirQ('skyrd', HEART), dirQ('skygd', new THREE.Vector3(0.07, 0.30, -0.95).normalize())] : null;

  // the swell's standing waves: wave vector (radians of phase per unit of direction), phase in space, rate and phase in time
  const NW = 10, WAVES = (() => { const R = rng(77), out = [];
    for (let i = 0; i < NW; i++) { const big = i < 5, az = R() * TAU, el = (R() - 0.5) * 1.6, m = big ? 14 + 5 * R() : 44 + 16 * R();
      out.push({ k: [m * Math.cos(el) * Math.sin(az), m * Math.sin(el), m * Math.cos(el) * Math.cos(az)], ph: R() * TAU, w: big ? 0.42 + 0.30 * R() : 0.95 + 0.6 * R(), ps: R() * TAU, a: big ? 0.00030 : 0.000032 }); }
    return out; })();                                                // five turret-sized waves (19 to 26 degrees, 9 to 15 s) and five billow-sized ones (6 to 8 degrees, 4 to 7 s); amplitudes keep the stretch of the picture under a third
  // the dusk gradient of 05_glsl.js with its cirrus set streaming: the same function under another name, the cirrus block swapped for
  // one that reads uCir (two sheets at different speeds, so the streaks slide through each other and change). If that block ever
  // changes shape upstream the swap does nothing and the cirrus simply stands still (G.info.skyCirrus says which).
  const CIR = /\{ vec2 cu = d\.xz[\s\S]*?ci \* 0\.72\); \}/;
  const cirLive = blk => { let n = 0; const out = blk.replace(/fbm2\(cu \*/g, () => n++ === 0 ? 'fbm2((cu - uCir.xy) *' : 'fbm2((cu - uCir.zw) *'); return n === 2 ? out : blk; };
  const SKY_LIVE = (OFF.has('cirrus') ? GLSL_SKY : GLSL_SKY.replace(CIR, cirLive)).replace('#ifndef CL_SKY', '#ifndef CL_SKY_LIVE').replace('#define CL_SKY', '#define CL_SKY_LIVE').replace('vec3 skyBase(', 'vec3 skyLive(');
  G.info.skyCirrus = SKY_LIVE.includes('uCir.zw') ? 'streams' : 'still';

  // which tiles of a whole-sky layer can hold cloud (or the flow field around one): everything else stays clear
  const need = (L, x, y, w, h, TS) => {
    const qx = (x + w / 2) / L.W * 2 - 1, qy = (y + h / 2) / L.W * 2 - 1, rr = Math.hypot(qx, qy), tr = TS * 0.7072 * 2 * L.th / L.W;
    if (rr * L.th - tr > L.th) return false;
    if (L.th < 1.5) return true;                                    // a window: all of it
    const th = Math.min(rr, 1) * L.th, sn = Math.sin(th), az = Math.atan2(sn * qx, -sn * qy), el = Math.PI / 2 - th;
    if (L.grid === 2) return el + tr > rad(4) && el - tr < rad(80);            // the tufts: from the horizon haze up to where the nearest stand
    if (L.grid && el - tr < rad(31)) return true;
    for (let i = L.c0; i < L.c1; i++) { const c = CLU[i], dh = Math.hypot(c.x, c.z), Rc = c.R + 1.0;
      if (dh <= Rc + 0.3) return true;
      if (el - tr > Math.atan2(c.hi + 1.0, dh - Rc)) continue;
      let da = Math.abs(az - Math.atan2(c.x, -c.z)); if (da > Math.PI) da = TAU - da;
      if (el + tr > rad(76) || da < Math.asin(Math.min(1, Rc / dh)) + tr / Math.max(Math.cos(Math.min(el + tr, 1.5)), 0.2)) return true; }
    return false; };

  function init(R) {
    const opt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, count: 2 };
    for (const L of LAY) L.rt = new THREE.WebGLRenderTarget(L.W, L.W, opt);
    rtLow = new THREE.WebGLRenderTarget(LW, LH, { ...opt, wrapS: THREE.RepeatWrapping });
    for (const t of [...LAY.map(L => L.rt.textures[1]), rtLow.textures[1]]) { t.type = THREE.UnsignedByteType; t.format = THREE.RGBAFormat; }       // thickness, puff, flow: four 8-bit channels
    rtN = new THREE.WebGL3DRenderTarget(NS, NS, NS, { depthBuffer: false });
    { const n = rtN.texture; n.format = THREE.RGBAFormat; n.type = THREE.UnsignedByteType; n.minFilter = n.magFilter = THREE.LinearFilter; n.wrapS = n.wrapT = n.wrapR = THREE.RepeatWrapping; n.generateMipmaps = false; }
    const VS = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    noiseMat = new THREE.ShaderMaterial({ uniforms: { uZ: { value: 0 } }, vertexShader: VS, fragmentShader: NOISE, depthTest: false, depthWrite: false });
    bakeMat = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: { uPanel: { value: new THREE.Vector4() }, tN: { value: rtN.texture }, uClu: { value: [0, 0, 0] }, uB: { value: new THREE.Matrix3() }, uFmax: { value: 1 }, uRo: { value: new THREE.Vector2(0.03, 10.4) }, uG: { value: new THREE.Vector4() }, uG2: { value: new THREE.Vector2() } }, vertexShader: VS, fragmentShader: CLOUD, depthTest: false, depthWrite: false });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    quad = new THREE.Mesh(g, bakeMat); quad.frustumCulled = false; qscene = new THREE.Scene(); qscene.add(quad); qcam = new THREE.Camera();
    // bake jobs: noise slices, the small environment copy (all layers in one), then each layer tile by tile
    const px = new Uint16Array(4), ID = new THREE.Matrix3();
    for (let z0 = 0; z0 < NS; z0 += 32) jobs.push(() => { quad.material = noiseMat; for (let z = z0; z < z0 + 32; z++) { noiseMat.uniforms.uZ.value = (z + 0.5) / NS; R.setRenderTarget(rtN, z); R.render(qscene, qcam); } });
    const tile = (rt, x, y, w, h, panel, c0, c1, grid, B, fmax, roY, top, Gp, wait) => () => {
      const u = bakeMat.uniforms; quad.material = bakeMat; u.uPanel.value.copy(panel); u.uClu.value[0] = c0; u.uClu.value[1] = c1; u.uClu.value[2] = grid; u.uB.value.copy(B); u.uFmax.value = fmax; u.uRo.value.set(roY, top); u.uG.value.set(Gp[0], Gp[1], Gp[2], Gp[3]); u.uG2.value.set(Gp[4], Gp[5]);
      rt.scissorTest = true; rt.scissor.set(x, y, w, h); rt.viewport.set(0, 0, rt.width, rt.height);
      R.setRenderTarget(rt); R.render(qscene, qcam);
      if (wait) R.readRenderTargetPixels(rt, x, y, 1, 1, px);        // force the GPU to finish so progress is honest
    };
    const TS = 256, pl = new THREE.Vector4(1, 1, TAU / LW, TH);
    for (let y = 0; y < LH; y += TS) for (let x = 0; x < LW; x += TS) jobs.push(tile(rtLow, x, y, Math.min(TS, LW - x), Math.min(TS, LH - y), pl, 0, CLU.length, 1, ID, 1, 0.03, 10.4, FARG, true));
    let nTile = 0, nAll = 0;
    for (const L of LAY) {
      const ph = new THREE.Vector4(0, 0, 2 * L.th / L.W, L.th), pe = new THREE.Vector4(0, 2, 2 * L.th / L.W, L.th);
      jobs.push(tile(L.rt, 0, 0, L.W, L.W, pe, L.c0, L.c1, L.grid, L.B, L.fmax, L.roY, L.top, L.G, false));       // the whole layer clear first
      for (let y = 0; y < L.W; y += TS) for (let x = 0; x < L.W; x += TS) { const w = Math.min(TS, L.W - x), h = Math.min(TS, L.W - y); nAll++;
        if (need(L, x, y, w, h, TS)) { nTile++; jobs.push(tile(L.rt, x, y, w, h, ph, L.c0, L.c1, L.grid, L.B, L.fmax, L.roY, L.top, L.G, true)); } }
    }
    G.info.skyTiles = nTile + '/' + nAll; G.info.skyMB = Math.round(LAY.reduce((a, L) => a + L.W * L.W * 12, 0) / 1048576);
    total = jobs.length;
    // display mesh: a full-screen triangle
    uni = { tN: { value: rtN.texture }, tLow: { value: rtLow.textures[0] }, uSw: { value: new Float32Array(NW) }, uAf: { value: new Float32Array(12) }, uTs: { value: new THREE.Vector3() }, uTnD: { value: NHEADD },
      uT: { value: new THREE.Vector4() }, uSt: { value: new THREE.Vector4() }, uCir: { value: new THREE.Vector4() }, uPal: { value: new Float32Array(NPAL * 3) },
      uAnv: { value: new THREE.Vector4() }, uAnv2: { value: new THREE.Vector4(ANV.h, 0.05, 0, 0) }, uRf: { value: new THREE.Vector4() },
      uPI: { value: new THREE.Matrix4() }, uCW: { value: new THREE.Matrix4() }, uEnv: { value: 0 }, uFxOn: { value: 0 }, uFx: { value: new THREE.Vector4() },
      uFlashDir: { value: new THREE.Vector3(0, 1, 0) }, uRiftDir: { value: new THREE.Vector3(0, 1, 0) }, uRingDir: { value: new THREE.Vector3(0, 1, 0) } };
    LAY.forEach((L, i) => { uni['tC' + i] = { value: L.rt.textures[0] }; uni['tA' + i] = { value: L.rt.textures[1] }; uni['uM' + i] = { value: L.M }; uni['uK' + i] = { value: L.K }; });
    const mkDisp = (uniforms, side) => new THREE.ShaderMaterial({
      uniforms, depthTest: true, depthWrite: false, fog: false, side,
      vertexShader: /* glsl */`uniform mat4 uPI, uCW; uniform float uEnv; varying vec3 vDir;
        void main(){ if (uEnv > 0.5) { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
          else { gl_Position = vec4(position.xy, 1.0, 1.0); vec4 v = uPI * vec4(position.xy, 1.0, 1.0); vDir = mat3(uCW) * (v.xyz / v.w); } }`,
      fragmentShader: /* glsl */`${GLSL_NOISE}
        uniform vec4 uCir;                               // how far the two cirrus sheets have streamed
        ${SKY_LIVE}
        uniform sampler2D tC0, tA0, tC1, tA1, tC2, tA2, tC3, tA3, tLow; uniform highp sampler3D tN;
        uniform mat3 uM0, uM1, uM2, uM3;                 // world direction -> each layer's fisheye frame, its drift included
        uniform vec4 uK0, uK1, uK2, uK3;                 // per layer: 0.5 / rim angle, flow reach (uv per cycle), swell, rim angle
        uniform vec4 uT;                                 // film time, flow phase, -, 1 = plain (the lake's mirror)
        uniform vec4 uSt;                                // storm churn 0..1, moving shade, share of the dusk sky, the storm tower's own rain shade
        uniform float uSw[${NW}];                           // the swell's waves: where each one stands in its rise and fall
        uniform vec3 uAf[4]; uniform vec3 uTs;           // pictures drawn a second time: scale and offset in the layer's fisheye (0 the storm tower as it grows, 1 2 its turrets, 3 the right tower's turret); how much of each turret is there
        uniform vec3 uTnD;                               // the head of the near tower on the right, as a direction in its layer
        uniform vec3 uPal[${NPAL}];                          // the colours of the moment: see PAL
        uniform vec4 uAnv, uAnv2;                        // the anvil: centre x z on its plane, radius, how much is there; height of the plane, pattern scale, drift
        uniform vec4 uRf;                                // the rift: bulge, stream phase (+ out of the hole, - into it), wisps drawn in after it shuts, shreds
        uniform float uEnv, uFxOn; uniform vec4 uFx; uniform vec3 uFlashDir, uRiftDir, uRingDir; varying vec3 vDir;
        const float ZF = 127.0 / 255.0;
        // one layer: where the lens looks in its fisheye and how the cloud surface moves there. The picture is taken three times along
        // that motion, a third of a cycle apart, each weighted by a raised cosine that is zero while the copy jumps back: the three
        // weights always sum to one and the summed motion is steady, so nothing swaps and nothing beats. Then the outline is drawn
        // tight again (the lit side hard, shaded hollows soft), on a picture nudged by small billows that drift, so it keeps changing
        vec4 lay(sampler2D tC, sampler2D tA, mat3 M, vec4 K, vec3 d, float ph, vec3 X, out vec2 ax){
          ax = vec2(0.0, 0.5);
          vec3 r = M * d; float th = acos(clamp(r.y, -1.0, 1.0));
          if (th >= K.w) return vec4(0.0, 0.0, 0.0, 1.0);
          vec2 uv = 0.5 + r.xz * (th / max(sqrt(1.0 - r.y * r.y), 1e-4) * K.x);
          uv = uv * X.x + X.yz;                                  // (the storm tower as it grows; a turret: the same picture smaller and lifted)
          vec4 a = textureLod(tA, uv, 0.0);
          if (a.g < 0.004) return vec4(0.0, 0.0, 0.0, 1.0);          // no cloud of this layer anywhere near
          ax = a.rg;
          if (uT.w > 0.5) return textureLod(tC, uv, 0.0);
          vec4 nz = textureLod(tN, r * 6.3 + uT.x * vec3(0.0040, 0.0130, -0.0060), 0.0);
          uv += (nz.gb - 0.5) * (${WARP.toFixed(2)} / float(textureSize(tC, 0).x));
          vec2 fl = (a.ba - ZF) * K.y; vec3 p = fract(ph + vec3(0.0, 0.33333, 0.66667)), w = (1.0 - cos(6.2831853 * p)) * 0.33333;
          vec4 e = textureLod(tC, uv - fl * (p.x - 0.5), 0.0) * w.x + textureLod(tC, uv - fl * (p.y - 0.5), 0.0) * w.y + textureLod(tC, uv - fl * (p.z - 0.5), 0.0) * w.z;
          float cov = 1.0 - e.a;
          if (cov > 0.006 && cov < 0.994) {
            float cs = mix(cov, smoothstep(0.30, 0.64, cov), ${SHARP.toFixed(2)} * (0.35 + 0.65 * smoothstep(0.22, 0.55, e.r / max(e.r + e.g, 1e-3))));
            e = vec4(e.rgb * (cs / cov), 1.0 - cs); }
          return e; }
        // the light shares of a layer in the colours of the moment
        vec3 shade(vec4 e, vec3 sunC, vec3 ambC, vec3 hz){ return e.r * sunC + e.g * ambC + e.b * hz; }
        // the swell: clouds inflate here and sink there. A potential of standing waves that cross at odd angles; the lens direction is
        // moved along its gradient, so the picture grows where the potential rises and shrinks where it falls, with no shear and
        // nothing that travels
        vec3 swell(vec3 d){ vec3 g = vec3(0.0);
          ${WAVES.map((w, i) => `g += vec3(${w.k.map(x => x.toFixed(2)).join(',')}) * (sin(dot(d, vec3(${w.k.map(x => x.toFixed(2)).join(',')})) + ${w.ph.toFixed(3)}) * uSw[${i}]);`).join('\n          ')}
          return g - d * dot(g, d); }
        // the layers front to back. rgb = light toward the lens, a = what is left of the sky behind; ax = (thickness, puff)
        vec4 clouds(vec3 d, float keep, vec3 hz, out vec2 ax){
          float pj = textureLod(tN, d * 0.60 + uT.x * vec3(0.0030, -0.0080, 0.0040), 0.0).a * 2.4;     // each place runs its cycle from its own moment
          vec3 sw = uT.w > 0.5 ? vec3(0.0) : swell(d); vec2 a; const vec3 X0 = vec3(1.0, 0.0, 0.0);
          vec4 e = lay(tC0, tA0, uM0, uK0, normalize(d + sw * uK0.z), uT.y + pj + 0.13, X0, a);
          vec4 c = vec4(shade(e, uPal[0], uPal[1], hz) * keep, mix(1.0, e.a, keep));                    // the tufts thin away round the opening rift
          ax = vec2(a.x, (1.0 - c.a) * a.y);
          if (c.a > 0.015) {
            vec3 dS = normalize(d + sw * uK1.z); float foot = mix(1.0, mix(0.46, 1.0, smoothstep(0.10, 0.66, d.y)), uSt.w);     // from OMEN the storm tower's lower half stands in its own rain
            vec3 sS = uPal[2] * foot, aS = uPal[3] * foot;
            e = lay(tC1, tA1, uM1, uK1, dS, uT.y + pj + 0.50, uAf[0], a);
            ax += c.a * vec2(a.x, (1.0 - e.a) * a.y); c.rgb += c.a * shade(e, sS, aS, hz); c.a *= e.a;
            // turrets: behind the head the tower stands a second and a third time, smaller and climbing. Each one comes up over the
            // outline, swells, thins away into the sky and starts again from behind, at another place
            for (int k = 0; k < 2; k++) { float f = uTs[k];
              if (c.a > 0.015 && f > 0.0 && uT.w < 0.5) {
                e = lay(tC1, tA1, uM1, uK1, dS, uT.y + pj + 0.87 + 0.29 * float(k), uAf[1 + k], a); e = vec4(e.rgb * (f * 0.94), mix(1.0, e.a, f));
                ax += c.a * vec2(a.x * f, (1.0 - e.a) * a.y); c.rgb += c.a * shade(e, sS, aS, hz); c.a *= e.a; } }
            if (c.a > 0.015) {
              vec3 dN = normalize(d + sw * uK2.z);
              e = lay(tC2, tA2, uM2, uK2, dN, uT.y + pj + 0.31, X0, a);
              ax += c.a * vec2(a.x, (1.0 - e.a) * a.y); c.rgb += c.a * shade(e, uPal[0], uPal[1], hz); c.a *= e.a;
              float fn = uTs.z * smoothstep(0.900, 0.951, dot(uM2 * dN, uTnD));                      // the near tower on the right grows turrets too: only round its own head
              if (c.a > 0.015 && fn > 0.0 && uT.w < 0.5) {
                e = lay(tC2, tA2, uM2, uK2, dN, uT.y + pj + 0.77, uAf[3], a); e = vec4(e.rgb * (fn * 0.95), mix(1.0, e.a, fn));
                ax += c.a * vec2(a.x * fn, (1.0 - e.a) * a.y); c.rgb += c.a * shade(e, uPal[0], uPal[1], hz); c.a *= e.a; }
              if (c.a > 0.015) {
                e = lay(tC3, tA3, uM3, uK3, normalize(d + sw * uK3.z), uT.y + pj + 0.67, X0, a);
                ax += c.a * vec2(a.x, (1.0 - e.a) * a.y); c.rgb += c.a * shade(e, uPal[0], uPal[1], hz); c.a *= e.a; } } }
          ax.y += c.a * 0.5;
          if (uSt.y > 0.0) {                                                                       // the shade of higher cloud wanders across the towers
            float sh = textureLod(tN, d * vec3(0.30, 0.55, 0.30) + uT.x * vec3(${(-0.0105 * WX).toFixed(4)}, 0.0010, 0.0040) + 0.37, 0.0).r;
            c.rgb *= 1.0 - uSt.y * smoothstep(0.52, 0.86, sh); }
          return c; }
        // the sky of the moment: blue overhead paling to gold by day, grey-violet under the storm, and at dusk the gradient of
        // 05_glsl.js itself (same belts, same earth shadow, same glow round the sun: its numbers are the dusk rows of PAL plus the
        // few terms below that only count as uSt.z goes to one). One function for the whole film, so no stretch pays for two skies
        vec3 skyDay(vec3 d, float disc, float az){
          float h = clamp(d.y, -0.05, 1.0), k = 1.0 - h, k2 = k * k, k4 = k2 * k2, k8 = k4 * k4, sd = max(dot(d, SUN_DIR), 0.0), kd = uSt.z, azc = (az - 0.5) * kd;
          vec3 c = mix(uPal[6], uPal[7] + azc * vec3(0.145, 0.065, 0.005), k2); c = mix(c, uPal[8] + azc * vec3(0.30, 0.17, -0.07), k4 * k); c = mix(c, mix(uPal[9], uPal[10], az * az), k8 * k4 * k2);
          c = mix(c, vec3(0.300, 0.230, 0.400), kd * (1.0 - az) * (k8 * k8 * k8 * k4 * k2) * 0.55);
          { vec2 cu = d.xz / max(d.y + 0.10, 0.05); float zc = cu.x * 0.031 + cu.y * 0.017;
            float ci = textureLod(tN, vec3((cu - uCir.xy) * vec2(0.125, 0.425) + vec2(0.50, 0.12), zc + 0.37), 0.0).a * 0.7 + textureLod(tN, vec3((cu - uCir.zw) * vec2(0.325, 1.15), zc + 0.71), 0.0).a * 0.3;
            ci = smoothstep(0.50, 0.74, ci) * smoothstep(0.03, 0.28, d.y);
            c = mix(c, uPal[11], ci * 0.70); }
          float s2 = sd * sd, s6 = s2 * s2 * s2, s24 = s6 * s6 * s6 * s6, s48 = s24 * s24;
          c += mix(uPal[10] * (s6 * 0.16 + s48 * 0.6), vec3(1.3, 0.52, 0.18) * (s6 * 0.42) + vec3(2.4, 1.25, 0.46) * (s48 * 0.8), kd);
          c += (vec3(6.0, 3.6, 1.6) * pow(sd, 700.0) + vec3(60.0, 38.0, 17.0) * smoothstep(0.99962, 0.99982, sd)) * disc;
          if (d.y < 0.0) c = mix(c, mix(uPal[9] * 0.30, vec3(0.17, 0.13, 0.15), kd), smoothstep(0.0, -0.25, d.y));
          return c; }
        void main(){ vec3 d = normalize(vDir); vec4 c = vec4(0.0, 0.0, 0.0, 1.0); vec3 col;
          float az = dot(normalize(d.xz + 1e-5), normalize(SUN_DIR.xz)) * 0.5 + 0.5; vec3 hz = mix(uPal[4], uPal[5], az);
          if (uEnv > 0.5) {
            float azi = atan(d.x, -d.z), el = asin(clamp(d.y, -1.0, 1.0));
            c = texture2D(tLow, vec2(azi / 6.2831853 + 0.5, clamp((el - (${LE0.toFixed(5)})) / (${(LE1 - LE0).toFixed(5)}), 0.002, 0.998)));
            col = skyLive(d, 0.0) * c.a + shade(c, uPal[0], uPal[1], hz);
          } else {
            // ---- storm: rift and ring move and clear the cloud, then cool grades it, then ring, rift and flash add light ----
            vec3 dl = d; float clr = 0.0;
            float rf = uFx.y, rang = 0.0, redge = 1.0, rR = 1.0, rx = 9.0, ropen = 0.0, rtat = 0.5, hole = 0.0; vec2 re = vec2(1.0, 0.0); vec3 rto = vec3(0.0, -1.0, 0.0);
            if (rf > 0.0 || uRf.z > 0.0) {
              vec3 c0 = uRiftDir; float ca = dot(d, c0), sa = sqrt(max(1.0 - ca * ca, 1e-8)); rang = acos(clamp(ca, -1.0, 1.0));
              vec3 ex = normalize(cross(vec3(0.0, 1.0, 0.0), c0) + vec3(1e-5, 0.0, 0.0)), ey = cross(c0, ex), tp = (d - c0 * ca) / sa;
              rto = (d * ca - c0) / sa; re = vec2(dot(tp, ex), dot(tp, ey));
              rR = (0.04 + 0.12 * rf) * (1.0 + uRf.x);                                            // (it bulges as a head breaks through)
            }
            if (rf > 0.0) {
              // The rift first shows as light in the cracks between the billows; past half open the cloud tears. Its lip is torn
              // cloud whose bays and tongues are carried outward with the stream (or drawn in, when the two leave through it)
              float x = rang / rR, st = uRf.y;
              float l1 = textureLod(tN, vec3(re * 0.30 + 0.21, x * 0.34 - st * 1.05), 0.0).r, l2 = textureLod(tN, vec3(re * 0.34 + 0.63, x * 0.50 - st * 1.6), 0.0).a;
              float l3 = textureLod(tN, vec3(re * 0.16 + 0.55, 0.3 + st * 0.2), 0.0).a;             // the hole is not round
              // a tear: twice as long as it is wide, lying aslant, with a few deep bays and long tongues (no scalloped rim)
              float gash = 1.0 + 0.34 * ((re.x * re.x - re.y * re.y) * 0.34 + 2.0 * re.x * re.y * 0.94);
              redge = rR * (0.60 + 0.62 * l3 + 0.30 * l1) / gash;
              ropen = smoothstep(0.50, 0.80, rf); rtat = l2;
              rx = rang / redge + ropen * 0.30 * (l2 - 0.5);
              dl = normalize(dl - rto * (rf * 0.5 * rR * 1.6487 * x * exp(-0.5 * x * x)));       // the cloud parts: it slides outward from the centre
            }
            float pr = uFx.w, gfront = 0.0, gwake = 0.0;
            if (pr > 0.0) {
              vec3 c0 = uRingDir; float ca = dot(d, c0), sa = sqrt(max(1.0 - ca * ca, 1e-8)), ang = acos(clamp(ca, -1.0, 1.0));
              vec3 ex = normalize(cross(vec3(0.0, 1.0, 0.0), c0) + vec3(1e-5, 0.0, 0.0)), ey = cross(c0, ex), tp = (d - c0 * ca) / sa;
              vec2 e = vec2(dot(tp, ex), dot(tp, ey));
              float env = 1.0 - smoothstep(0.5, 1.0, pr);
              // the front is a shock through cloud, not a compass line: its reach differs by a quarter from one side to the next and
              // it shows only where there is cloud to pile up, as broken bright heads; in clear sky it draws nothing
              float lump = vnoise(e * 1.7 + 3.0) * 0.62 + vnoise(e * 4.6 + 8.0) * 0.28 + vnoise(e * 11.0 + ang * 5.0) * 0.10;
              float s = pr * 2.9 * (1.0 + 0.50 * (lump - 0.5)) - ang;                             // radians behind the front
              float w = 0.030 + 0.070 * pr;
              gfront = env * (exp(-s * s / (w * w)) * smoothstep(0.34, 0.70, vnoise(e * 7.0 + ang * 9.0 + 1.7)) + 0.16 * smoothstep(0.0, 0.05, s) * exp(-s * 9.0));
              gwake = env * smoothstep(0.0, 0.11, s + 0.07 * (vnoise(e * 6.0 + ang * 13.0) - 0.5)) * exp(-s * 1.15);     // a ragged edge, not a compass line
              dl = normalize(dl - ((d * ca - c0) / sa) * (env * 0.085 * exp(-s * s / 0.012)));     // cloud piles up on the front
              clr = max(clr, gwake * 0.92);                                                         // is swept away behind it, then closes in again
            }
            vec2 ax = vec2(0.0, 0.5);
            if (dl.y > 0.0) c = clouds(dl, 1.0 - smoothstep(0.0, 0.5, rf) * (1.0 - smoothstep(0.26, 0.52, rang)), hz, ax);
            if (rf > 0.0) {
              // the lip is the cloud's own surface: every billow that stands proud of its neighbours reaches into the hole as a
              // rounded head, every crease between two opens back into a bay. The tear follows the cauliflower, so it is cut out of
              // this cloud and no other
              rx += ropen * 0.36 * (ax.y - 0.5) * (1.0 - smoothstep(1.05, 1.30, rx));
              clr = max(clr, (1.0 - smoothstep(mix(0.55, 0.88, ropen), mix(1.0, 0.96, ropen), rx)) * smoothstep(0.0, 0.2, rf)); }
            c.rgb *= 1.0 - clr; c.a = mix(c.a, 1.0, clr);
            float cloud = 1.0 - c.a, thick = ax.x * (1.0 - clr), puff = ax.y, disc = smoothstep(0.35, 0.95, c.a);
            vec3 sky = skyDay(d, disc, az);
            float anv = 0.0;
            if (uAnv.w > 0.0 && d.y > 0.03) {
              // the anvil: the storm's top spreading into a sheet high over the valley. Seen from under it is grey-violet with pouches
              // hanging from it; toward its rim it thins into fibres combed outward, and there the sun still comes through
              vec2 q = d.xz * (uAnv2.x / d.y) - uAnv.xy; float ql = length(q), r = ql / uAnv.z;
              vec4 n = textureLod(tN, vec3(q * uAnv2.y + uAnv2.zw, 0.21 + uT.x * 0.0050), 0.0), n2 = textureLod(tN, vec3(q * (uAnv2.y * 3.1) + uAnv2.zw * 2.0 + 0.37, 0.63 + uT.x * 0.0090), 0.0);
              float fib = textureLod(tN, vec3(q / max(ql, 1e-3) * 0.85 + 0.4, r * 0.40 - uT.x * 0.0040), 0.0).a;
              float rim = r + 0.30 * (n.a - 0.5) + 0.26 * (fib - 0.5) + 0.10 * (n2.a - 0.5);
              float mam = n.r * 0.58 + n.g * 0.27 + n2.r * 0.15, thin = smoothstep(0.62, 1.0, rim);
              anv = (1.0 - smoothstep(0.80, 1.0, rim)) * smoothstep(0.03, 0.14, d.y) * smoothstep(0.0, 0.30, uAnv.w * 1.3 - (1.0 - mam) * (1.0 - uAnv.w) * 1.3);
              anv *= 1.0 - gwake * 0.9;
              sky = mix(sky, mix(uPal[12] * (0.62 + 0.76 * mam), uPal[13] * (0.50 + 0.7 * fib), thin * thin), anv * (0.97 - 0.40 * thin));
              cloud = max(cloud, anv * 0.55 * c.a);
            }
            col = sky * c.a + c.rgb;
            if (uFxOn > 0.5) {
            if (uFx.z > 0.0) {
              float lum = dot(col, vec3(0.30, 0.52, 0.18));
              vec3 steel = mix(vec3(0.30, 0.42, 0.72), vec3(0.94, 1.0, 1.10), smoothstep(0.06, 1.1, lum)) * (lum * 1.05 + 0.16);
              col = mix(col, steel, uFx.z * 0.90 * smoothstep(0.02, 0.34, d.y));                    // the horizon keeps its own colour
            }
            if (pr > 0.0) col += vec3(1.7, 1.6, 1.5) * (gfront * 0.42 * cloud * cloud + gwake * 0.02);
            if (rf > 0.0) {
              vec3 rc = vec3(0.70, 0.86, 1.16); float x = rang / redge, st = uRf.y;
              hole = clr * ropen;
              if (hole > 0.0) {
                // through the tear: the throat of the storm. Walls of cloud that turn as they go in, billow behind billow crowding
                // toward the far end where the light is: dark slate at the lip, lit on their swells further in
                float xi = min(x, 1.3), zt = 0.42 / (xi * xi + 0.09), tw = zt * 0.16 + st * 0.5, cw = cos(tw), sw = sin(tw);
                vec2 rs = vec2(re.x * cw - re.y * sw, re.x * sw + re.y * cw);
                float w0 = textureLod(tN, vec3(rs * 0.36, zt * 0.30 + st * 1.2), 0.0).r, w2 = textureLod(tN, vec3(rs * 1.05 + 0.4, zt * 0.75 + st * 2.4), 0.0).g, bil = w0 * 0.62 + w2 * 0.38;
                float glow = exp(-xi * xi * 6.0), deep = smoothstep(0.42, 0.86, bil);
                // the near wall is the cut face of the cloud, in the shade of the moment (slate in the storm, violet at dusk) and darkest
                // right under the lip; only far in do the swells catch the light from the other side
                vec3 shd = mix(uPal[3], vec3(dot(uPal[3], vec3(0.36, 0.40, 0.24))), 0.55); vec3 wall = mix(shd * 0.50 + vec3(0.010, 0.014, 0.026), shd * 1.5 + vec3(0.045, 0.060, 0.095), bil) * (0.45 + 1.5 * glow) + rc * (glow * glow) * (0.06 + 0.62 * deep);
                wall += rc * 1.7 * exp(-xi * xi * 30.0) * (0.30 + 0.70 * deep);                     // the far end itself, seen between the inner billows
                col = mix(col, wall, hole);
              }
              // the torn lip stands in front of that light: dark, the light only touching the curls that lean into the hole
              float lipS = smoothstep(0.84, 0.96, rx) * (1.0 - smoothstep(1.00, 1.42, rx)) * ropen;
              col *= mix(vec3(1.0), vec3(0.30, 0.34, 0.48), lipS * 0.85 * cloud);
              float lip = smoothstep(0.86, 0.93, rx) * (1.0 - smoothstep(0.93, 1.02, rx)) * smoothstep(0.42, 0.78, rtat) * ropen * cloud;      // a lining here and there, never an outline
              float crack = (1.0 - ropen) * exp(-x * x * 1.1) * (1.0 - smoothstep(0.30, 0.62, puff)) * cloud;      // before it tears: light in the creases, not a disc
              float down = 1.0 - smoothstep(-0.80, -0.12, rto.y), streak = 0.0;                    // the light pours down in a fan of shafts
              if (down > 0.0) streak = smoothstep(0.50, 0.84, vnoise(re * 9.0 + 3.0) * 0.55 + vnoise(re * 23.0 + 9.0) * 0.45) * smoothstep(redge * 0.9, redge * 2.0, rang) * exp(-rang * 3.2) * (0.05 + 0.95 * down);
              float glint = cloud * ropen * exp(-max(rx - 1.0, 0.0) * 2.6) * smoothstep(0.56, 0.90, puff) * smoothstep(1.25, 1.60, rx);      // the face of the cloud next to the hole catches it on its swells only
              // shreds torn off the lip and carried out (or drawn back in): long along the way they go, dark against the light, pale where it reaches them
              float sx = (rang - redge) / rR;
              if (sx > -0.05 && sx < 1.6 && uRf.w > 0.0) {
                float s1 = textureLod(tN, vec3(re * 0.55 + 0.17, sx * 0.11 - st * 0.37), 0.0).a, s2 = textureLod(tN, vec3(re * 1.90 + 0.71, sx * 0.30 - st), 0.0).a;
                float shred = smoothstep(0.56, 0.72, s1 * 0.6 + s2 * 0.4) * smoothstep(-0.05, 0.10, sx) * (1.0 - smoothstep(0.25, 1.5, sx)) * ropen * uRf.w;
                col = mix(col, mix(col * 0.55, rc * 0.9, 0.25 + 0.6 * exp(-sx * 2.2)), shred * 0.7); }
              col += rc * rf * (1.5 * crack + 0.30 * lip + 0.16 * glint + 0.5 * streak);
            }
            if (uRf.z > 0.0) {                                                                      // the cloud closes over where they went: wisps are drawn in to the place for a second
              float x = rang / 0.15, st = uRf.y;
              float s1 = textureLod(tN, vec3(re * 0.55 + 0.17, x * 0.11 - st * 0.37), 0.0).a, s2 = textureLod(tN, vec3(re * 1.90 + 0.71, x * 0.30 - st), 0.0).a;
              float wsp = smoothstep(0.54, 0.70, s1 * 0.6 + s2 * 0.4) * (1.0 - smoothstep(0.25, 1.5, x)) * uRf.z * cloud;
              col = mix(col, col * 1.5 + vec3(0.05, 0.06, 0.08), wsp * 0.7) * (1.0 - 0.35 * uRf.z * cloud * exp(-x * x * 5.0));
            }
            if (uFx.x > 0.0) {
              float a2 = 1.0 - dot(d, uFlashDir), core = exp(-a2 * 70.0), wide = exp(-a2 * 5.5);
              float inner = (0.25 + 0.75 * thick) * mix(1.45, 0.52, smoothstep(0.28, 0.76, puff));    // thick cloud glows, the puffs in front of the bolt stay darker
              float k = uFx.x * core, m = min(k, 1.0) * cloud * 0.82; vec3 fc = vec3(0.60, 0.78, 1.30) * inner;
              col = col * (1.0 - m) + fc * (1.25 * m + 0.9 * max(k - 1.0, 0.0) * cloud)             // the bolt's light takes over from the daylight
                + uFx.x * (vec3(0.55, 0.74, 1.25) * cloud * wide * 0.20 * (0.4 + 0.6 * thick) + vec3(0.018, 0.026, 0.055) * (0.5 + 0.5 * wide) * (1.0 - 0.85 * hole));
            }
            }
          }
          gl_FragColor = vec4(col, 1.0); }`,
    });
    // drawn AFTER the opaque scene, at the far plane with the depth test on: pixels hidden by rock and trees never run the sky shader
    mesh = new THREE.Mesh(g, mkDisp(uni, THREE.FrontSide)); mesh.frustumCulled = false; mesh.renderOrder = 1000;
    // environment: same shader on an inverted sphere, captured to a cube (always the calm sky, all layers as baked)
    envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 48, 24), mkDisp({ ...uni, uEnv: { value: 1 }, uFxOn: { value: 0 } }, THREE.BackSide)));
    envRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    buildRain(); buildSleeve();
    update(null, 0);
  }
  // ---- rain at the lens: streaks in a box of air that rides with the camera. A streak's place is its seed plus its fall, wrapped
  //      into the box round the lens, so the rain is a pure function of film time and of where the lens is; nothing is stored.
  //      It falls from the moment the storm's shade reaches the lens until the BLAST blows it away
  const RAIN = { N: 16000, mesh: null, u: null, veil: null, vu: null, on: Q.get('rain') !== '0' && !OFF.has('rain') }, rainAt = t => sm(31.2, 34.5, t) * (1 - sm(67.55, 68.5, t));
  function buildRain() {
    const N = RAIN.N, Rn = rng(4242), pos = new Float32Array(N * 12), aQ = new Float32Array(N * 8), idx = new Uint16Array(N * 6);
    for (let i = 0; i < N; i++) { const x = Rn(), y = Rn(), z = Rn();
      for (let k = 0; k < 4; k++) { pos.set([x, y, z], (i * 4 + k) * 3); aQ[(i * 4 + k) * 2] = k >> 1; aQ[(i * 4 + k) * 2 + 1] = (k & 1) * 2 - 1; }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aQ', new THREE.BufferAttribute(aQ, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const u = RAIN.u = { uRt: { value: 0 }, uRk: { value: 0 }, uCamP: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3(WIND.dir.x * 4.6, -10.5, WIND.dir.z * 4.6) }, uBox: { value: new THREE.Vector3(46, 34, 46) }, uColR: { value: new THREE.Vector3() }, ...Post.fxU };
    const m = new THREE.ShaderMaterial({ uniforms: u, transparent: true, premultipliedAlpha: true, depthWrite: false, depthTest: false, fog: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`attribute vec2 aQ; uniform float uRt, uRk; uniform vec3 uCamP, uVel, uBox; uniform vec2 uRes; varying vec4 vK;
        void main(){ float h = fract(position.x * 91.7 + position.z * 57.3); vec3 vel = uVel * vec3(1.0, 0.80 + 0.45 * h, 1.0);
          vec3 rel = mod(position * uBox + vel * uRt - uCamP + 0.5 * uBox, uBox) - 0.5 * uBox; float dist = length(rel);
          vec3 w0 = uCamP + rel, w1 = w0 - vel * 0.042;                                             // what the shutter saw of one drop
          vec4 c0 = projectionMatrix * viewMatrix * vec4(w0, 1.0), c1 = projectionMatrix * viewMatrix * vec4(w1, 1.0);
          float a = uRk * smoothstep(1.2, 3.5, dist) * (1.0 - smoothstep(15.0, 23.0, dist)) * (0.50 + 0.50 * h);
          vK = vec4(0.0); gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          if (c0.w > 0.4 && c1.w > 0.4 && a > 0.004) {
            vec2 dir = (c1.xy / c1.w - c0.xy / c0.w) * uRes; float dl = length(dir); dir = dl > 1e-4 ? dir / dl : vec2(0.0, 1.0);
            float px = 0.0050 / c0.w * projectionMatrix[1][1] * uRes.y * 0.5, wpx = max(px, 1.5);     // a blurred drop is 4 to 5 mm wide, never drawn thinner than a pixel
            vec4 c = aQ.x < 0.5 ? c0 : c1; c.xy += vec2(-dir.y, dir.x) / uRes * (aQ.y * wpx * c.w);
            gl_Position = c; vK = vec4(aQ.y, aQ.x, a * clamp(px / 1.5, 0.35, 1.0), -c.w); } }`,
      fragmentShader: /* glsl */`${Post.GLSL_FXDEPTH} uniform vec3 uColR; varying vec4 vK;
        void main(){ if (sceneZ() > vK.w) discard; float a = vK.z * (1.0 - vK.x * vK.x) * smoothstep(0.0, 0.18, vK.y) * (1.0 - smoothstep(0.55, 1.0, vK.y)); gl_FragColor = vec4(uColR * a, a * 0.6); }` });
    RAIN.mesh = new THREE.Mesh(g, m); RAIN.mesh.frustumCulled = false; RAIN.mesh.visible = false; RAIN.mesh.renderOrder = 3; G.fx.add(RAIN.mesh);
    // and the rain further off, which no lens resolves into drops: three veils at 22, 58 and 150 m, drawn in one pass over the frame.
    // Each is a sheet of slanting striations that fall, thicker where a shaft of the storm is passing, hidden by whatever stands
    // nearer than it. So the far spires stand in grey rain, the near halls in thin rain, and shafts walk down the valley
    const g2 = new THREE.BufferGeometry(); g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const vu = RAIN.vu = { tN: { value: rtN.texture }, uPI: uni.uPI, uCW: uni.uCW, uRv: { value: new THREE.Vector4() }, uColV: { value: new THREE.Vector3() }, ...Post.fxU };
    const m2 = new THREE.ShaderMaterial({ uniforms: vu, transparent: true, premultipliedAlpha: true, depthWrite: false, depthTest: false, fog: false,
      vertexShader: /* glsl */`uniform mat4 uPI, uCW; varying vec3 vDir, vV;
        void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); vec4 v = uPI * vec4(position.xy, 1.0, 1.0); vV = v.xyz / v.w; vDir = mat3(uCW) * vV; }`,
      fragmentShader: /* glsl */`${Post.GLSL_FXDEPTH} uniform highp sampler3D tN; uniform vec4 uRv; uniform vec3 uColV; varying vec3 vDir, vV;
        void main(){ vec3 d = normalize(vDir); float cz = -normalize(vV).z, zs = -sceneZ(), az = atan(d.x, -d.z), acc = 0.0, upK = smoothstep(0.30, 0.62, d.y);      // looking up, the striations would comb toward the zenith: there the veil is plain
          for (int i = 0; i < 3; i++) { float D = i == 0 ? 22.0 : i == 1 ? 58.0 : 150.0, vis = clamp((zs - D * cz) / (D * 0.35), 0.0, 1.0);
            if (vis > 0.0) { float y = uRv.z + d.y * D, u = az * D + y * ${(0.42 * WX).toFixed(3)}, fu = 1.0 / (0.050 * D);
              float n = textureLod(tN, vec3(u * fu, (y + uRv.y * 10.5) * fu * 0.07, 0.13 + 0.31 * float(i)), 0.0).a;
              float m = textureLod(tN, vec3((u - uRv.y * ${(4.6 * WX).toFixed(2)}) * 0.0040, y * 0.0012, 0.71 + 0.17 * float(i)), 0.0).a;
              float a = (i == 0 ? 0.075 : i == 1 ? 0.13 : 0.24) * vis * mix(0.25 + 0.75 * smoothstep(0.40, 0.68, n), 0.55, upK) * (0.30 + 1.25 * smoothstep(0.36, 0.68, m));
              acc += (1.0 - acc) * a; } }
          acc *= uRv.x * (1.0 - 0.75 * smoothstep(0.50, 0.92, d.y));
          gl_FragColor = vec4(uColV * acc, acc); }` });
    RAIN.veil = new THREE.Mesh(g2, m2); RAIN.veil.frustumCulled = false; RAIN.veil.visible = false; RAIN.veil.renderOrder = -2; G.fx.add(RAIN.veil);
  }
  // ---- the vapour a loong drags through the rift. The cloud is a picture on the sky; where a body goes through it there must be
  //      cloud in the air around the body. Puffs are born where the rail crosses the mouth while the body streams through, are
  //      carried along the rail with it, swell, slow and thin away (white coming out); or stand round the rail in front of the
  //      mouth and are drawn in after the body, faster the closer they come (the two going in). Each puff is a closed formula
  //      of film time: its event's moment, its own delay, and the rail near the mouth sampled once at load
  const NP = 24, SPAN = 96, SLV = { N: 0, mesh: null, u: null, ready: false, on: Q.get('sleeve') !== '0', win: [[0, 0], [0, 0]] };
  function buildSleeve() {
    const Rn = rng(909), L = [], put = (e, tb, s0, s1, tau, life, r0, r1, z0, z1, spin) => L.push([e, tb, Rn() * TAU, Rn(), s0, s1, tau, life, r0, r1, z0, z1, spin]);
    for (let i = 0; i < 120; i++) { const q = Rn(); put(0, -0.05 + 2.9 * i / 120, -2, 26 + 62 * q, 0.55 + 0.35 * Rn(), 1.5 + 1.1 * Rn(), 2.4 + 1.2 * Rn(), 4.5 + 5 * Rn(), 2.1 + 1.0 * Rn(), 4.2 + 2.6 * Rn(), (Rn() - 0.5) * 2.4); }   // the sleeve white drags out
    for (let i = 0; i < 26; i++) put(0, -0.10 + 0.5 * Rn(), -3, 6 + 14 * Rn(), 0.50 + 0.3 * Rn(), 1.5 + 0.9 * Rn(), 5 + 3 * Rn(), 15 + 15 * Rn(), 2.6 + 1.4 * Rn(), 5.5 + 3.5 * Rn(), (Rn() - 0.5) * 1.2);                               // the lip thrown open as its head breaks through
    for (let e = 1; e < 3; e++) for (let i = 0; i < 64; i++) put(e, -0.5 + 3.4 * i / 64, -(18 + 46 * Rn()), 5, 0.45 + 0.25 * Rn(), 1.3 + 0.7 * Rn(), 7 + 7 * Rn(), 2.6 + 1.2 * Rn(), 4.2 + 2.2 * Rn(), 2.0 + 1.0 * Rn(), (Rn() - 0.5) * 3.0);   // cloud drawn in round each body
    const N = SLV.N = L.length, pos = new Float32Array(N * 12), aA = new Float32Array(N * 16), aB = new Float32Array(N * 16), aD = new Float32Array(N * 16), idx = new Uint16Array(N * 6);
    for (let i = 0; i < N; i++) { const p = L[i];
      for (let k = 0; k < 4; k++) { const o = i * 4 + k; pos.set([(k & 1) * 2 - 1, (k >> 1) * 2 - 1, p[12]], o * 3); aA.set(p.slice(0, 4), o * 4); aB.set(p.slice(4, 8), o * 4); aD.set(p.slice(8, 12), o * 4); }
      idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aA', new THREE.BufferAttribute(aA, 4)); g.setAttribute('aB', new THREE.BufferAttribute(aB, 4)); g.setAttribute('aD', new THREE.BufferAttribute(aD, 4)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const u = SLV.u = { ...Post.fxU, tN: { value: rtN.texture }, uP: { value: new Float32Array(3 * NP * 3) }, uEv: { value: new THREE.Vector3(1e3, 1e3, 1e3) }, uTt: { value: 0 }, uC0: { value: new THREE.Vector3() }, uC1: { value: new THREE.Vector3() } };
    const m = new THREE.ShaderMaterial({ uniforms: u, transparent: true, premultipliedAlpha: true, depthWrite: false, depthTest: false, fog: false,
      vertexShader: /* glsl */`attribute vec4 aA, aB, aD; uniform vec3 uP[${3 * NP}]; uniform vec3 uEv; uniform float uTt; varying vec4 vK; varying vec3 vC;
        void main(){ int e = int(aA.x + 0.5); float age = uTt - (e == 0 ? uEv.x : e == 1 ? uEv.y : uEv.z) - aA.y, life = aB.w;
          vK = vec4(0.0); vC = vec3(position.xy, 0.0); gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          if (age > 0.0 && age < life) {
            float k = 1.0 - exp(-age / aB.z), s = mix(aB.x, aB.y, k), f = clamp((s + ${SPAN.toFixed(1)}) / ${(2 * SPAN).toFixed(1)}, 0.0, 0.999) * ${(NP - 1).toFixed(1)}; int i0 = int(f);
            vec3 a = uP[e * ${NP} + i0], b = uP[e * ${NP} + i0 + 1], p = mix(a, b, f - float(i0)), tn = normalize(b - a);
            vec3 n1 = normalize(cross(tn, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0)), n2 = cross(tn, n1); float ang = aA.z + position.z * age;
            p += (n1 * cos(ang) + n2 * sin(ang)) * mix(aD.x, aD.y, k);
            vec4 mv = viewMatrix * vec4(p, 1.0); float rot = aA.w * 6.2831853 + position.z * 0.4 * age, cr = cos(rot), sr = sin(rot);
            mv.xy += mat2(cr, sr, -sr, cr) * position.xy * mix(aD.z, aD.w, k);
            gl_Position = projectionMatrix * mv; vC.z = mv.z;
            vK = vec4(smoothstep(0.0, 0.16, age) * (1.0 - smoothstep(0.45 * life, life, age)) * (e == 0 ? 1.0 : 1.0 - smoothstep(0.80, 0.98, k)), aA.w, age, float(e)); } }`,
      fragmentShader: /* glsl */`${Post.GLSL_FXDEPTH} uniform highp sampler3D tN; uniform vec3 uC0, uC1; varying vec4 vK; varying vec3 vC;
        void main(){ float r = length(vC.xy); if (r > 1.0 || vK.x < 0.003) discard;
          vec3 q = vec3(vC.xy * 0.21 + vK.y * 7.3, vK.y * 3.1 + vK.z * 0.10); vec4 n = texture(tN, q), m = texture(tN, q * 2.7 + 0.31);
          float body = n.r * 0.55 + m.g * 0.25 + n.a * 0.20;                                        // billows, eaten into from the edge
          float a = smoothstep(0.0, 0.50, body - r * r * 0.95 + 0.12) * vK.x * softZ(vC.z, 2.5);
          float lit = clamp(0.50 + 0.80 * (body - 0.45) + 0.28 * vC.y, 0.0, 1.0);
          a *= 0.60; gl_FragColor = vec4(mix(uC0, uC1, lit) * a, a); }` });
    SLV.mesh = new THREE.Mesh(g, m); SLV.mesh.frustumCulled = false; SLV.mesh.visible = false; SLV.mesh.renderOrder = 0.4; G.fx.add(SLV.mesh);
  }
  // bake a slice of jobs (at least 90 ms: fewer idle waits for the next animation frame while loading); returns progress 0..1
  function bakeStep(R, ms = 30) {
    const t0 = performance.now(), slice = Math.max(ms, 90);
    while (jobs.length && performance.now() - t0 < slice) jobs.shift()();
    R.setRenderTarget(null); G.info.skyBake = Math.round((G.info.skyBake || 0) + performance.now() - t0);
    return 1 - jobs.length / total;
  }
  // ---- the colours of the moment. The bake stores light as shares (sun, sky fill, haze); these rows colour them and the sky behind:
  //      0 sun and 1 sky fill on the calm layers, 2 and 3 the same on the storm tower, 4 and 5 haze away from and toward the sun, 6 zenith,
  //      7 mid sky, 8 low sky, 9 and 10 the horizon away from and toward the sun, 11 cirrus, 12 the anvil seen from under, 13 its sunlit rim.
  //      day: cream heads on slate shade under a blue sky that pales to gold. storm (OMEN to the BLAST): the tower slate, the sky
  //      grey-violet, the far cumulus still in the sun under the anvil. dusk (from 79 s): the peach and violet the finale was staged in;
  //      there the sky itself is the gradient of 05_glsl.js, so rows 6 to 11 only matter while the two cross-fade.
  const NPAL = 14, WARP = Q.has('skywarp') ? +Q.get('skywarp') : 2.6, SHARP = Q.has('skysharp') ? +Q.get('skysharp') : 0.9;
  const PAL = {
    day: [[1.70, 1.40, 0.98], [0.20, 0.255, 0.39], [1.70, 1.40, 0.98], [0.20, 0.255, 0.39], [0.72, 0.76, 0.84], [1.05, 0.92, 0.70], [0.060, 0.125, 0.330], [0.165, 0.275, 0.530], [0.46, 0.56, 0.72], [1.00, 0.88, 0.68], [1.35, 1.02, 0.60], [1.15, 1.06, 0.92], [0.10, 0.11, 0.16], [1.00, 0.88, 0.70]],
    storm: [[1.30, 1.08, 0.78], [0.13, 0.155, 0.235], [0.17, 0.18, 0.22], [0.045, 0.052, 0.085], [0.34, 0.37, 0.46], [0.70, 0.62, 0.50], [0.030, 0.034, 0.062], [0.060, 0.066, 0.110], [0.21, 0.23, 0.31], [0.86, 0.76, 0.60], [1.15, 0.88, 0.52], [0.40, 0.41, 0.48], [0.052, 0.056, 0.090], [0.78, 0.68, 0.54]],
    dusk: [[1.56, 0.68, 0.20], [0.150, 0.075, 0.230], [1.30, 0.58, 0.19], [0.135, 0.070, 0.225], [0.70, 0.29, 0.23], [1.08, 0.50, 0.195], [0.066, 0.092, 0.235], [0.2775, 0.2675, 0.3975], [1.13, 0.515, 0.295], [1.15, 0.40, 0.23], [1.65, 0.74, 0.22], [1.40, 0.56, 0.36], [0.10, 0.08, 0.14], [1.40, 0.60, 0.30]] };
  { const o = Q.get('skypal'); if (o) { const v = o.split(',').map(Number), P = PAL[['day', 'storm', 'dusk'][v[0]]]; for (let i = 1; i + 3 < v.length; i += 4) P[v[i]] = [v[i + 1], v[i + 2], v[i + 3]]; } }      // QA: &skypal=palette,row,r,g,b[,row,r,g,b...]
  const ONE = [1, 1, 1], DS = { t: -1, tint: [1, 1, 1], tear: new Float32Array(24), tearR: [-70, -70] };   // (lead, merge) the light module's state() also writes its storm-tear arrays into the record it is handed
  // kS: how far into the storm (0..1), kD: how far into dusk; tint: the sun's tint of the moment (the valley's own, from Daylight)
  function setPal(kS, kD, tint) { const v = uni.uPal.value, A = PAL.day, B = PAL.storm, C = PAL.dusk;
    for (let i = 0; i < NPAL; i++) for (let j = 0; j < 3; j++) { let x = A[i][j] + (B[i][j] - A[i][j]) * kS; if (i === 0 || i === 2) x *= tint[j]; v[i * 3 + j] = x + (C[i][j] - x) * kD; } }
  // how much of the sky the storm has taken: the light builder's own figure when the build has it (Daylight gloom: the shadow front reaches the
  // main spire at 20 s and the lens at 31 s, the BLAST clears it by 70 s), else the same curve from here
  const stormAt = t => (0.3 * sm(17.5, 24, t) + 0.7 * sm(24, 31, t)) * (1 - sm(67.7, 70.2, t)), duskAt = t => sm(69, 79, t);
  const gloomAt = t => { if (typeof Daylight === 'undefined' || typeof Film === 'undefined') return stormAt(t); const D = Daylight.state(t, DS); return D.gloom === +D.gloom ? clamp(D.gloom) : Daylight.S.t === t && Daylight.S.gloom === +Daylight.S.gloom ? clamp(Daylight.S.gloom) : stormAt(t); };
  // the anvil: a sheet at the storm's crown, in cloud units on a plane ANV.h above the lens. It spreads from OMEN, drifts downwind, and the BLAST tears it away
  const ANV = { h: 10.4, x: -0.2, z: -4.8 };
  function makeEnv(R) {
    // the environment every material is lit by stays the evening one they were tuned against: dusk colours, all layers as baked
    setPal(0, 1, ONE);
    const cc = new THREE.CubeCamera(0.1, 100, envRT); cc.update(R, envScene);
    const pm = new THREE.PMREMGenerator(R); const env = pm.fromCubemap(envRT.texture).texture; pm.dispose(); update(null, 0); return env;
  }
  // a layer's world-to-fisheye matrix when its clouds stand phi to the right of where they were baked
  const setM = (L, phi) => { const c = Math.cos(phi), s = -Math.sin(phi), x = L.ex, a = L.ax, z = L.ez;
    L.M.set(x.x * c + x.z * s, x.y, -x.x * s + x.z * c, a.x * c + a.z * s, a.y, -a.x * s + a.z * c, z.x * c + z.z * s, z.y, -z.x * s + z.z * c); };
  const hash1 = x => { const v = Math.sin(x * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  // the storm's turrets: period (s), phase, lift from..to (degrees), size from..to, how far to either side a new one may stand
  //   Through the calm opening the lens sees only the tower's foot, so there they climb behind the foot's domes; later behind the head
  const TUR = [{ P: 15, o: 0.10, h0: -3.0, h1: 5.2, s0: 0.70, s1: 0.86, side: 7 }, { P: 21, o: 0.62, h0: -3.5, h1: 4.4, s0: 0.60, s1: 0.78, side: 9 }], NOTUR = OFF.has('turret');
  const TURN = { P: 13, o: 0.45, h0: -2.5, h1: 4.6, s0: 0.72, s1: 0.88, side: 6 };
  const TURF = [{ P: 11, o: 0.82, h0: -2.0, h1: 5.6, s0: 0.76, s1: 0.90, side: 9 }, { P: 14, o: 0.50, h0: -2.5, h1: 5.0, s0: 0.70, s1: 0.86, side: 12 }];
  const FOOT_T = TURF.map(T => (Math.ceil(20 / T.P + T.o) - T.o) * T.P);        // each turret leaves the foot for the head at the end of a foot cycle (24 s, 21 s), when nothing of it shows
  const ONLY = Q.has('skyonly') ? +Q.get('skyonly') : -1;                                       // QA: draw one layer alone
  const NOFLOW = OFF.has('flow'), NOSWELL = OFF.has('swell'), flowK = L => NOFLOW ? 0 : L.fmax * (255 / 127) * L.sp * CYC;
  // when the loongs pass the rift (found once, from their own paths): white's head out of it, each head into it, the last tail tip gone
  let PASS = null;
  const passes = () => { const o = { out: 30.1, inR: 84.2, inW: 84.6, shut: 85.7 };
    try { const A = Film.A.rift, v = new THREE.Vector3(), near = (D, a, b) => { let bt = a, bd = 1e9; for (let t = a; t <= b; t += 0.02) { const dd = D.headAt(t, v).distanceTo(A); if (dd < bd) { bd = dd; bt = t; } } return bt; };
      o.out = near(Dragon.white, 29.0, 32.0); o.inR = near(Dragon.red, 81.5, 88.0); o.inW = near(Dragon.white, 81.5, 88.0);
      const g = Math.max(Dragon.red.tGone, Dragon.white.tGone) + 0.05; o.shut = g < 90 ? g : Film.T.GONG + 1.6;
      if (SLV.mesh) { const P = SLV.u.uP.value, W = Dragon.white, Rd = Dragon.red, ev = SLV.u.uEv.value;
        const when = (D, sM, a, b) => { let t = a; while (t < b && D.sOf(t) < sM) t += 1 / 240; return t; };
        const rail = (D, sM, e) => { for (let i = 0; i < NP; i++) { D.pathAt(sM + (i / (NP - 1) * 2 - 1) * SPAN, v); P[(e * NP + i) * 3] = v.x; P[(e * NP + i) * 3 + 1] = v.y; P[(e * NP + i) * 3 + 2] = v.z; } };
        const s0 = W.sIn > -1e8 ? W.sIn : W.sOf(o.out), s1 = Rd.sOut < 1e8 ? Rd.sOut : Rd.sOf(o.inR), s2 = W.sOut < 1e8 ? W.sOut : W.sOf(o.inW);
        rail(W, s0, 0); rail(Rd, s1, 1); rail(W, s2, 2);
        ev.set(when(W, s0, 28.5, 33), when(Rd, s1, 80, 89), when(W, s2, 80, 89));
        SLV.win = [[ev.x - 0.3, ev.x + 6.2], [Math.min(ev.y, ev.z) - 0.7, Math.max(ev.y, ev.z) + 5.4]]; SLV.ready = true; G.info.skySleeve = [ev.x, ev.y, ev.z].map(x => +x.toFixed(2)); }
    } catch (e) {}
    G.info.skyPass = [o.out, o.inR, o.inW, o.shut].map(x => +x.toFixed(2)); return o; };
  const bump = (t, a, b, c) => sm(a, b, t) * (1 - sm(b, c, t));
  // the storm tower grows: it surges up through OMEN and keeps climbing through the fight (the picture scaled about its foot)
  const growAt = t => 0.93 + 0.07 * sm(26.5, 30.5, t) + 0.10 * clamp((t - 30.5) / 37);
  function update(camera, t) {
    if (camera) { uni.uPI.value.copy(camera.projectionMatrixInverse); uni.uCW.value.copy(camera.matrixWorld); }
    const ch = churnAt(t), kS = gloomAt(t), kD = duskAt(t);
    for (let i = 0; i < LAY.length; i++) { const L = LAY[i]; setM(L, L.phi(t)); L.K.y = flowK(L); L.K.z = NOSWELL ? 0 : L.sw; L.K.w = ONLY >= 0 && ONLY !== i ? 0 : L.th; }
    LAY[1].K.y *= 1 + 0.6 * ch; LAY[1].K.z *= 1 + 0.8 * ch;                                     // the storm rolls and heaves harder on the same clock: no faster cycle
    uni.uT.value.set(t, t / CYC, 0, camera && camera !== G.camera ? 1 : 0);
    uni.uSt.value.set(ch, OFF.has('shade') ? 0 : 0.26, kD, kS);
    setPal(kS, kD, typeof Daylight !== 'undefined' && typeof Film !== 'undefined' ? DS.tint : ONE);
    uni.uCir.value.set(WX * WIND.cirrus * t, 0.05 * WIND.cirrus * t, WX * 1.7 * WIND.cirrus * t, -0.10 * WIND.cirrus * t);
    for (let i = 0; i < NW; i++) uni.uSw.value[i] = WAVES[i].a * Math.sin(WAVES[i].w * t + WAVES[i].ps);
    { const ts = Math.max(t - 17.5, 0), ph = phiStorm(t), cs = Math.cos(ph), sn = Math.sin(ph);       // it rides with the tower, then spreads downwind of it
      uni.uAnv.value.set(ANV.x * cs - ANV.z * sn + WX * 0.035 * ts, ANV.x * sn + ANV.z * cs + 0.010 * ts, 0.5 + 9.0 * sm(17.5, 27, t) + 10.0 * sm(26.6, 33, t) + 4.0 * clamp((t - 33) / 34), OFF.has('anvil') ? 0 : sm(17.5, 20.5, t) * (1 - sm(67.7, 70.6, t)));
      uni.uAnv2.value.set(ANV.h, 0.26, WX * 0.010 * t, 0.004 * t); }
    { const S = LAY[1], af = uni.uAf.value, tau = t + KCH * smI(26, 31, t), k = 0.5 / S.th, ig = 1 / growAt(t), F = FOOT;          // the turrets climb on the storm's own clock: faster from OMEN on
      af[0] = ig; af[1] = F[0] * (1 - ig); af[2] = F[1] * (1 - ig);
      for (let i = 0; i < 2; i++) { const foot = t < FOOT_T[i], T = foot ? TURF[i] : TUR[i], x = foot ? t / T.P + T.o : (tau - FOOT_T[i]) / T.P, n = Math.floor(x), u = x - n, h1 = hash1(n * 7.31 + i * 3.7 + (foot ? 5 : 0)), h2 = hash1(n * 3.17 + i * 9.1 + 0.5);
        const rise = rad(T.h0 + (T.h1 - T.h0) * (1 - (1 - u) * (1 - u))), side = rad((h1 - 0.5) * 2 * T.side), sc = T.s0 + (T.s1 - T.s0) * u + 0.06 * (h2 - 0.5), C = foot ? FOOT : HEAD, s = 1 / sc;
        const ox = C[0] * (1 - s) - (S.upx * rise + S.upy * side) * k, oy = C[1] * (1 - s) - (S.upy * rise - S.upx * side) * k;
        af[3 + i * 3] = s * ig; af[4 + i * 3] = (ox - F[0]) * ig + F[0]; af[5 + i * 3] = (oy - F[1]) * ig + F[1];
        uni.uTs.value.setComponent(i, NOTUR ? 0 : sm(0, 0.10, u) * (1 - sm(0.78, 1, u))); }
      const N = LAY[2], T = TURN, x = t / T.P + T.o, n = Math.floor(x), u = x - n, kn = 0.5 / N.th, rise = rad(T.h0 + (T.h1 - T.h0) * (1 - (1 - u) * (1 - u))), side = rad((hash1(n * 5.13 + 2.2) - 0.5) * 2 * T.side);
      // in a whole-sky fisheye up is toward the middle: from the tower's head that is the direction (0.5, 0.5) - NHEAD
      const ux = 0.5 - NHEAD[0], uy = 0.5 - NHEAD[1], ul = Math.hypot(ux, uy) || 1, vx = ux / ul, vy = uy / ul, s = 1 / (T.s0 + (T.s1 - T.s0) * u);
      af[9] = s; af[10] = NHEAD[0] * (1 - s) - (vx * rise + vy * side) * kn; af[11] = NHEAD[1] * (1 - s) - (vy * rise - vx * side) * kn;
      uni.uTs.value.z = NOTUR ? 0 : sm(0, 0.10, u) * (1 - sm(0.78, 1, u)); }
    const f = uni.uFx.value, rfv = uni.uRf.value;
    if (camera && !PASS && typeof Film !== 'undefined' && typeof Dragon !== 'undefined') PASS = passes();
    { const P = PASS || { out: 30.1, inR: 84.2, inW: 84.6, shut: 85.7 };
      rfv.set(0.26 * bump(t, P.out - 0.30, P.out + 0.12, P.out + 1.1) + 0.20 * bump(t, P.inR - 0.30, P.inR + 0.10, P.inR + 0.9) + 0.20 * bump(t, P.inW - 0.30, P.inW + 0.10, P.inW + 0.9),
        t < 60 ? 0.30 * (t - 28) : -0.30 * (t - 82), t > P.shut ? sm(P.shut, P.shut + 0.25, t) * (1 - sm(P.shut + 0.45, P.shut + 1.7, t)) : 0, 1); }
    if (ovr) { f.set(ovr[0] || 0, ovr[1] || 0, ovr[2] || 0, ovr[3] || 0); uni.uFlashDir.value.copy(ovrDir[0]); uni.uRiftDir.value.copy(ovrDir[1]); uni.uRingDir.value.copy(ovrDir[2]); rfv.z = 0; }
    else {
      f.set(Math.max(0, fx.flash || 0), clamp(fx.rift || 0), clamp(fx.cool || 0), clamp(fx.ring || 0));
      if (f.x > 0) uni.uFlashDir.value.copy(fx.flashDir).normalize();
      if (f.y > 0 || rfv.z > 0) uni.uRiftDir.value.copy(fx.riftDir).normalize();
      if (f.w > 0) uni.uRingDir.value.copy(fx.ringDir).normalize();
    }
    if (f.w >= 1) f.w = 0;                                                                        // the ring has passed: nothing left
    { const main = !!camera && camera === G.camera, fl = Math.min(f.x, 1.5);
      const k = RAIN.on ? rainAt(t) : 0, ru = RAIN.u, vu = RAIN.vu; RAIN.mesh.visible = RAIN.veil.visible = k > 0.003;       // (the effects layer is drawn with the film lens only)
      if (k > 0.003 && main) { ru.uRt.value = t; ru.uRk.value = k; ru.uCamP.value.setFromMatrixPosition(camera.matrixWorld);
        ru.uColR.value.set(0.42 + 0.9 * fl, 0.47 + 1.05 * fl, 0.60 + 1.3 * fl);
        vu.uRv.value.set(k, t, ru.uCamP.value.y, 0); vu.uColV.value.set(0.150 + 0.5 * fl, 0.168 + 0.6 * fl, 0.215 + 0.8 * fl); }
      const W = SLV.win, on = SLV.on && SLV.ready && ((t > W[0][0] && t < W[0][1]) || (t > W[1][0] && t < W[1][1])); SLV.mesh.visible = on;
      if (on && main) { const su = SLV.u, pv = uni.uPal.value, rk = clamp(f.y) * (t < 60 ? 1 : 0.55);        // the palette's storm-tower rows of the moment, plus the cold light out of the rift
        su.uTt.value = t; su.uC0.value.set(pv[9] + pv[6] * 0.36 + 0.02 * rk, pv[10] + pv[7] * 0.36 + 0.03 * rk, pv[11] + pv[8] * 0.36 + 0.05 * rk);
        su.uC1.value.set(pv[6] * 0.85 + pv[9] + 0.14 * rk + 0.4 * fl, pv[7] * 0.85 + pv[10] + 0.17 * rk + 0.5 * fl, pv[8] * 0.85 + pv[11] + 0.24 * rk + 0.7 * fl); } }
    uni.uFxOn.value = (f.x > 0 || f.y > 0 || f.z > 0 || f.w > 0 || rfv.z > 0) ? 1 : 0;
  }
  // where the storm tower's heart is at film time t (left of HEART in the calm opening, on it from 27 s); writes into out
  function stormDir(t, out) { const a = -phiStorm(t), cs = Math.cos(a), sn = Math.sin(a); return out.set(cs * HEART.x + sn * HEART.z, HEART.y, -sn * HEART.x + cs * HEART.z); }
  return { init, bakeStep, makeEnv, update, fx, stormDir, HEART, WIND, get mesh() { return mesh; }, get hero() { return LAY[2].rt; }, get low() { return rtLow; }, AZ: Math.PI, E0: 0, E1: Math.PI / 2, LE0, LE1 };
})();
