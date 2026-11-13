'use strict';
// ---- water: the lake (a true mirror of the valley, depth and shore from a baked bed map, wind, the dragons' wakes) and the waterfalls -------
// Every picture here is a pure function of film time t. Everything is allocated once in build().
//   Water.build(scene, fx, tick)   awaited by FX.build in place of the old lake plane and fall() cards
//   Water.fxU                      the uniforms the effects module drives: uRipA, uRipB, uRipC, uRipD (vec4 x, z, front radius m, amplitude),
//                                  uFoamA, uRipOn, uFall, uTime, uCol[6] (vec4 x, z, radius m, strength: where a body crosses the surface)
//   Water.update(t)                registers itself LAST in G.tick (it draws the mirror, which must see this frame's lights and leaves)
//   Water.WY, Water.bedAt(x, z)    lake level; { h, d } = bed or land height and signed metres to the waterline (CPU copy of the bed map)
//   Water.K                        run-time switches for cost probes ({ mirror, prox }); URL: wm=scale of the mirror, wdbg=1..5, wnomir, wnoprox, wwet (wet-rock overlays)
// Reads: Rock.L, Rock.mat, Arch.sluice (the lip the main fall leaves), Film.T / Film.A.splash, Dragon.list[i] { spine(t), C, NS, LEN, RMAX, rProf,
//        pathAt, sOf, st, meshes } at build (the event table) and C, st each frame (collars), G.sun (shadow map), G.storm, FX.light (the effects
//        module's one point light), Sky.update(camera, t), Flora.T.leaf, Post.W / Post.H / Post.fxU / Post.GLSL_FXDEPTH (read only).
// Touches: R.shadowMap.autoUpdate / needsUpdate in capture mode (the shadow map is refreshed inside the mirror's render call, once a frame as before);
//        onBeforeRender / onAfterRender of big static instanced meshes (they skip the mirror's colour pass; a stand-in with the near-lake instances is drawn).
const Water = (() => {
  const WY = 0.05;                                              // lake level (the effects module's splash anchors use the same)
  const X0 = -56, X1 = 62, Z0 = -18, Z1 = 100, BN = 1024;       // the lake rectangle the bed map covers (118 m square, 11.5 cm a texel)
  const NEV = 40;                                               // surface events alive at once (rings, wave trains, foam, gust footprints)
  const NSK = 12;                                               // points of skim tracks alive at once (where a body drags along the surface)
  const f4 = x => (+x).toFixed(4);
  const KN = (k, d) => (Q.has(k) ? +Q.get(k) : d);
  const MSCALE = KN('wm', 0.42), DBG = KN('wdbg', 0), NOMIR = Q.has('wnomir');
  const V4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);
  // the valley's wind: the plants' module owns it when it exports it (heading, and gust fronts that cross the valley); else the old steady heading
  const HASGUST = typeof Wake !== 'undefined' && !!Wake && typeof Wake.GLSL_GUST === 'string' && !!Wake.U && !!Wake.U.uWkT && !Q.has('wnogust');
  const CLS = typeof GLSL_FOG === 'string' && /\bclSun\s*\(/.test(GLSL_FOG) ? 1 : 0;      // the light module's drifting cloud shadows and sun tint (clSun, clSunAt), when the build has them
  const WDV = (() => { const d = (typeof Wake !== 'undefined' && Wake && Wake.WIND && Wake.WIND.d) || [-0.93, 0.37], l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; })();
  const fxU = { uTime: G.uTime, uFall: { value: new THREE.Vector3(0, 0, -7.5) }, uRipA: { value: V4() }, uRipB: { value: V4() }, uRipC: { value: V4() }, uRipD: { value: V4() },
    uFoamA: { value: 0 }, uRipOn: { value: 0 }, uCol: { value: [V4(), V4(), V4(), V4(), V4(), V4()] } };
  const U = { ...(HASGUST ? Wake.U : {}), ...fxU, uWind: G.uWind, uGust: G.uGust,
    tWave: { value: null }, tBed: { value: null }, tBedC: { value: null }, tMirror: { value: null }, tMirrorZ: { value: null }, tShadow: { value: null }, tLeaf: { value: null }, tFlow: { value: null }, tStream: { value: null },
    uTexM: { value: new THREE.Matrix4() }, uMPI: { value: new THREE.Matrix4() }, uShadowM: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 }, uShadowPx: { value: new THREE.Vector2(1 / 4096, KN('wsh', 1.6)) }, uMirPx: { value: new THREE.Vector2(1, 1) },
    uCamPI: { value: new THREE.Matrix4() }, uCamW: { value: new THREE.Matrix4() },
    uNE: { value: 0 }, uEA: { value: new Float32Array(NEV * 4) }, uEB: { value: new Float32Array(NEV * 4) }, uColW: { value: new Float32Array(24) }, uPress: { value: new Float32Array(16) },
    uNS: { value: 0 }, uSkA: { value: new Float32Array(NSK * 4) }, uSkB: { value: new Float32Array(NSK * 4) }, uBow: { value: V4() },
    uSpl: { value: V4(0, 0, -1, 0) }, uRain: { value: V4() }, uFalls: { value: new Float32Array(16) }, uFallL: { value: new Float32Array(16) }, uFallD: { value: new Float32Array(16) },
    uLight: { value: V4() }, uLightC: { value: new THREE.Vector3() }, uStorm: { value: V4(0, 1, 0, 0) }, uMirTop: { value: 1 }, uMirW: { value: 0 }, uMirK: { value: new THREE.Vector2(1, 1) }, uDbg: { value: DBG } };
  const S = { skip: [], skipV: [], ev: null, nev: 0, falls: [], low: [], splash: null, lights0: [], pts: null, prox: [], only: [], dskip: [false, false, false, false], tracks: [], sk: null, nsk: 0, lt: -1 };
  const K = { mirror: !NOMIR, prox: !Q.has('wnoprox'), rope: !Q.has('wnr'), bead: !Q.has('wnb'), puff: !Q.has('wnp') };                                   // run-time switches (cost probes)
  let R, lake, rtM, mcam, bedCPU = null, light = null, mirrorOK = false, mirT = -9, mirF = -9, fc = 0, registered = false;

  // ================= shared GLSL =================
  const GL_BEDUV = `vec2 bedUV(vec2 p){ return vec2((p.x - (${f4(X0)})) / ${f4(X1 - X0)}, (${f4(Z1)} - p.y) / ${f4(Z1 - Z0)}); }`;
  const GL_FLOWUV = `vec2 flowUV(vec2 p){ return (p - vec2(${f4(X0)}, ${f4(Z0)})) / ${f4(X1 - X0)}; }`;
  const rotW = a => { const c = Math.cos(a), s = Math.sin(a); return `vec2(${f4(WDV[0] * c - WDV[1] * s)}, ${f4(WDV[0] * s + WDV[1] * c)})`; };
  // three long swells running down the wind (deep-water speeds for their lengths), in groups: xy = slope, z = height (m)
  const GL_SWELL = /* glsl */`
    vec3 wkSwell(vec2 p){ vec3 o = vec3(0.0); float amp = 0.70 + 0.60 * min(uGust, 1.3), ph, a, k; vec2 d;
      d = ${rotW(0.18)}; k = 0.9106; ph = dot(p, d) * k - uTime * 2.99; a = 0.036 * amp * (0.60 + 0.40 * sin(dot(p, vec2(-d.y, d.x)) * 0.23 + uTime * 0.21)); o.z += a * sin(ph); o.xy += d * (a * k * cos(ph));
      d = ${rotW(-0.44)}; k = 1.5325; ph = dot(p, d) * k - uTime * 3.87 + 1.3; a = 0.022 * amp * (0.60 + 0.40 * sin(dot(p, vec2(-d.y, d.x)) * 0.31 - uTime * 0.17 + 2.0)); o.z += a * sin(ph); o.xy += d * (a * k * cos(ph));
      d = ${rotW(0.78)}; k = 2.5133; ph = dot(p, d) * k - uTime * 4.96 + 4.1; a = 0.013 * amp * (0.60 + 0.40 * sin(dot(p, vec2(-d.y, d.x)) * 0.43 + uTime * 0.29 + 4.0)); o.z += a * sin(ph); o.xy += d * (a * k * cos(ph));
      return o; }`;
  // The large-scale surface: everything big enough to move real vertices. Height (m), gradient, foam, and (roughness, churn) at lake point p (x, z).
  const GL_MACRO = /* glsl */`
    #define NEV ${NEV}
    #define NSK ${NSK}
    uniform float uTime, uFoamA, uGust; uniform vec4 uRipA, uRipB, uRipC, uRipD; uniform vec4 uCol[6]; uniform vec4 uColW[6];
    uniform int uNE; uniform vec4 uEA[NEV]; uniform vec4 uEB[NEV]; uniform vec4 uSpl; uniform vec4 uFalls[4]; uniform vec4 uPress[4];
    uniform int uNS; uniform vec4 uSkA[NSK]; uniform vec4 uSkB[NSK]; uniform vec4 uBow; uniform sampler2D tWave, tBed;
    ${GL_BEDUV}
    ${GL_SWELL}
    // a ring packet whose crest is at radius R: wavelength lam, width sig. Unit amplitude; dr = d(height)/d(radius)
    float wkPacket(float r, float R, float lam, float sig, out float dr){ float x = r - R, k = 6.2832 / lam, e = exp(-x * x / (sig * sig)), c = cos(k * x), s = sin(k * x);
      dr = e * (-2.0 * x / (sig * sig) * c - k * s); return e * c; }
    // a bore: a steep face in front (x > 0 is ahead of the crest), a long back behind. Unit height
    float wkBore(float x, float sf, float sb, out float dr){ float e; if (x > 0.0) { e = exp(-x / sf); dr = -e / sf; } else { e = exp(x / sb); dr = e / sb; } return e; }
    // one of the effects module's rings: ru = x, z, front radius, amplitude. A bore that runs out of the splash: steep in front, ragged in height
    // and never quite a circle, shorter waves trailing behind it, white on the crest and thinning behind
    void wkFx(vec2 p, vec4 ru, float lam, float hgt, inout float h, inout vec2 g, inout float foam, inout float rough){
      if (ru.w < 0.002) return; vec2 q = p - ru.xy; float r = length(q) + 1e-3; vec2 n = q / r; float dr, an = atan(q.y, q.x);
      float jag = 0.70 + 0.30 * sin(an * 3.0 + ru.x) + 0.17 * sin(an * 7.0 - ru.y * 0.7) + 0.10 * sin(an * 17.0 + ru.z * 0.31), rw = r * (1.0 + 0.045 * sin(an * 5.0 + 1.7) + 0.025 * sin(an * 11.0 + ru.x));
      float grow = smoothstep(2.5, 11.0, ru.z);                                   // it rises out of the crater's rim: nothing appears already six metres wide
      float a = ru.w * hgt * jag * grow * pow(10.0 / (10.0 + r), 0.7), x = rw - ru.z, w = wkBore(x, lam * 0.13, lam * 0.50, dr); h += a * w; g += n * (a * dr);
      float tr = step(x, 0.0) * exp(x / (lam * 2.6)), k2 = 6.2832 / (lam * 0.42), a2 = a * 0.15 * tr * smoothstep(0.0, -lam * 0.5, x);
      h += a2 * sin(k2 * x); g += n * (a2 * k2 * cos(k2 * x));
      foam += ru.w * grow * (1.25 * (x > 0.0 ? exp(-x / (lam * 0.10)) : exp(x / (lam * 0.75))) * (0.55 + 0.45 * jag) + 0.16 * tr) * (16.0 / (16.0 + r)); rough += ru.w * tr * 0.9; }
    void wkCollar(vec2 p, vec4 c, inout float h, inout vec2 g, inout float foam, inout float rough){
      if (c.w < 0.002) return; vec2 q = p - c.xy; float r = length(q) + 1e-3; vec2 n = q / r; float x = (r - c.z - 0.4) / 1.3, e = exp(-x * x);
      h += c.w * 0.55 * e; g += n * (c.w * 0.55 * e * (-2.0 * x / 1.3)); float o = max(r - c.z, 0.0) / 2.0; foam += c.w * 1.15 * exp(-o * o); rough += c.w * exp(-max(r - c.z, 0.0) / 7.0); }
    float wkMacro(vec2 p, out vec2 g, out float foam, out vec2 rc){
      float h = 0.0, dr, rough = 0.0, churn = 0.0; g = vec2(0.0); foam = 0.0;
      // the SPLASH's ring: it leaves the crater's rim as the rim falls back and runs out at 8 m/s (a wave a metre high on three metres of water),
      // so islets, plinths and cliffs are met one after another. The effects module's own front (25 m in the first second) is not used for it
      vec4 ra = uRipA; if (uSpl.w > 0.0) { float d = uSpl.z; ra = vec4(uSpl.xy, 10.3 + 8.0 * max(d - 0.5, 0.0), 1.25 * smoothstep(0.30, 0.75, d) * exp(-d / 3.4) * (1.0 - smoothstep(7.5, 9.0, d))); }
      if (uFoamA > 0.002) { vec2 q = p - ra.xy; float rf = min(ra.z, 30.0) * 0.38 + 2.5, e = uFoamA * exp(-dot(q, q) / (rf * rf)); foam += 0.75 * e; churn += 0.8 * e; }      // the effects module's churn patch at the splash
      wkFx(p, ra, 5.0, 1.55, h, g, foam, rough); wkFx(p, uRipB, 9.0, 0.38, h, g, foam, rough); wkFx(p, uRipC, 3.2, 0.8, h, g, foam, rough); wkFx(p, uRipD, 3.2, 0.8, h, g, foam, rough);
      for (int i = 0; i < 6; i++) { wkCollar(p, uCol[i], h, g, foam, rough); wkCollar(p, uColW[i], h, g, foam, rough); }
      for (int i = 0; i < 4; i++) { vec4 c = uPress[i]; if (c.w < 0.002) continue; vec2 q = p - c.xy; float e = c.w * exp(-dot(q, q) / (c.z * c.z)); h -= e; g += q * (2.0 * e / (c.z * c.z)); rough += 2.0 * e; }   // a body hanging just over the water presses a furrow
      if (uBow.w > 0.002) { vec2 q = p - uBow.xy; float e = uBow.w * exp(-dot(q, q) / (uBow.z * uBow.z)); h += e; g -= q * (2.0 * e / (uBow.z * uBow.z)); foam += 1.6 * e; rough += 1.5 * e; churn += 0.9 * e; }      // the water a ploughing head pushes ahead of itself
      for (int i = 0; i < NEV; i++) { if (i >= uNE) break; vec4 a = uEA[i], b = uEB[i]; vec2 q = p - a.xy; float r = length(q) + 1e-3; vec2 n = q / r; float age = a.z;
        if (a.w < 0.5) {            // a ring: b = amplitude m, speed m/s, wavelength m, life s
          float u = age / b.w, env = smoothstep(0.0, 0.10, u) * (1.0 - u) * (1.0 - u), sig = b.z * (0.8 + 0.22 * age);
          float amp = b.x * env * sqrt(3.0 / (3.0 + r)), w = wkPacket(r, b.z * 0.5 + b.y * age, b.z, sig, dr); h += amp * w; g += n * (amp * dr); }
        else if (a.w < 1.5) {       // a wave train from a steady source: b = amplitude m, speed m/s, wavelength m, seconds it ran
          float k = 6.2832 / b.z, front = b.y * age, tail = b.y * (age - b.w);
          float amp = b.x * smoothstep(front, front - 1.5 * b.z, r) * smoothstep(tail - 1.5 * b.z, tail, r) * exp(-r / 26.0) / sqrt(1.0 + r * 0.5), ph = k * (r - front);
          h += amp * sin(ph); g += n * (amp * k * cos(ph)); }
        else if (a.w < 2.5) {       // churned foam left behind: b = strength, spread m/s, radius m, life s
          float u = age / b.w, rad = b.z + b.y * age, e = exp(-r * r / (rad * rad)) * smoothstep(0.0, 0.05, u) * (1.0 - u); foam += b.x * e; rough += 0.6 * b.x * e; churn += 0.5 * b.x * e * (1.0 - u); }
        else {                      // a gust footprint (air shoved down by a body passing overhead): b = strength, spread m/s, radius m, life s
          float u = age / b.w, rad = b.z + b.y * age; rough += b.x * exp(-r * r / (rad * rad)) * smoothstep(0.0, 0.2, u) * (1.0 - u); } }
      // SKIM: a body dragging along the surface. Each stretch of its track (a = x, z, when the body reached it, when the last of it left;
      // b = strength, half width) sends a crest sideways from the moment the body arrives: the crests line up as the two arms of a V. Between
      // them the furrow it ploughs, shorter waves for as long as it keeps ploughing, and the white water left behind, spreading and thinning.
      for (int i = 0; i < NSK - 1; i++) { if (i >= uNS - 1) break; vec4 a = uSkA[i], b = uSkA[i + 1], sa = uSkB[i], sb = uSkB[i + 1]; if (sa.x < 0.001 || sb.x < 0.001) continue;
        vec2 ab = b.xy - a.xy, ap = p - a.xy; float f = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0); vec2 q = ap - ab * f; float lat = length(q) + 1e-3; vec2 n = q / lat;
        float age = uTime - mix(a.z, b.z, f); if (age <= 0.0 || lat > 60.0) continue;
        float td = mix(a.w, b.w, f), S = mix(sa.x, sb.x, f), rb = mix(sa.y, sb.y, f), on = 1.0 - smoothstep(td, td + 0.3, uTime), gone = max(uTime - td, 0.0), act = sa.z;      // act: how fast the body is sliding through the furrow now
        float R = rb + 6.5 * age + 6.0 * (1.0 - exp(-age / 0.30)), env = min(S, 1.0) * smoothstep(0.0, 0.45, age) * exp(-age / 2.6) * (1.0 - smoothstep(7.0, 9.0, age)), x = lat - R, w = wkBore(x, 0.9, 2.8, dr);          // the surge: a metre of water leaving both sides at 6.5 m/s (it rises out of the spray: nothing stands up beside the body at once)
        h += 1.00 * env * w; g += n * (1.00 * env * dr);
        float tr = step(x, 0.0) * exp(x / 9.0) * smoothstep(0.0, -1.2, x), k2 = 6.2832 / 2.3, a2 = 0.20 * S * tr * on * (0.12 + 0.88 * min(act, 1.0)) * smoothstep(0.0, 0.5, age), ph2 = k2 * (lat - 3.0 * uTime);
        h += a2 * sin(ph2); g += n * (a2 * k2 * cos(ph2));
        float ft = lat / (rb + 0.4), ef = exp(-ft * ft), lip = exp(-(ft - 1.25) * (ft - 1.25) * 3.0) * (0.25 + 0.5 * min(act, 1.2));
        h += S * on * (0.42 * lip - 0.60 * ef); g += n * (S * on * (0.60 * ef * 2.0 * ft - 0.42 * lip * 6.0 * (ft - 1.25)) / (rb + 0.4));
        float wt = rb * 1.25 + 0.7 + 0.5 * gone + 0.22 * min(age, 6.0) * (0.3 + 0.7 * min(act, 1.0)), ew = exp(-lat * lat / (wt * wt)), busy = 0.22 + 0.78 * min(act, 1.0);
        foam += S * ew * (1.3 * on * busy + 1.05 * (1.0 - on) * exp(-gone / 6.5)) + (1.25 * env + 0.9 * min(S, 1.0) * exp(-age / 0.5)) * (x > 0.0 ? exp(-x / 0.45) : exp(x / 2.2)) + 0.5 * S * exp(-age / 5.0) * step(x, 0.0) * exp(x / 14.0); rough += S * ew * 1.5 * exp(-gone / 3.0) * busy; churn += S * ew * (0.9 * on * busy + 0.5 * (1.0 - on) * exp(-gone / 3.0)); }
      if (uSpl.w > 0.0) {           // SPLASH: the crater and the wall of water thrown up round it, the hole closing into a rebound column, then the whole lake sloshing
        float d = uSpl.z; vec2 q = p - uSpl.xy; float r = length(q) + 1e-3; vec2 n = q / r;
        if (r < 48.0) { float an = atan(q.y, q.x) * 0.159155;
          // a slow noise round the rim that drifts with the water: the collar of water heaped round the crater is lumpy, never a row of teeth
          // (what is THROWN from the rim is the wall sheet, a mesh of its own: a height field can only swell)
          float rag = textureLod(tWave, vec2(an * 2.0 + 0.11, 0.37 + d * 0.09), 0.0).b * 0.75 + textureLod(tWave, vec2(an * 5.0 + 0.53, 0.71 - d * 0.13), 0.0).b * 0.25;
          float open = smoothstep(0.0, 0.14, d) * (1.0 - smoothstep(0.55, 1.20, d)), Rc = 1.0 + 9.2 * (1.0 - exp(-d / 0.21));
          float e1 = exp(-1.6 * r * r / (Rc * Rc)); h -= 4.3 * open * e1; g += n * (4.3 * open * e1 * 3.2 * r / (Rc * Rc));
          float Rw = Rc * 1.06 + 0.35, sw = 1.0 + 0.9 * smoothstep(0.0, 0.8, d), Hw = 2.0 * smoothstep(0.0, 0.09, d) * (1.0 - smoothstep(0.35, 1.25, d)), xr = (r - Rw) / sw, e2 = exp(-xr * xr);
          float top = Hw * (0.45 + 1.1 * rag); h += top * e2; g += n * (top * e2 * (-2.0 * xr / sw));
          float jet = 5.2 * smoothstep(0.85, 1.22, d) * (1.0 - smoothstep(1.40, 2.3, d)) * (0.75 + 0.5 * rag), e3 = exp(-r * r / 3.6); h += jet * e3; g -= n * (jet * e3 * r / 1.8);
          float dip = 0.9 * smoothstep(2.3, 2.8, d) * (1.0 - smoothstep(3.0, 3.8, d)), e4 = exp(-r * r / 16.0); h -= dip * e4; g += n * (dip * e4 * r / 8.0);
          // white water: everything inside the wall is churned to milk as the crater opens, and stays so while the foam drifts apart
          // for the first half second the hole itself is dark glassy water (its walls are the lake's own depth); it turns white as it closes
          float Rf = Rc * 1.30 + 2.6 * d, hole = (1.0 - smoothstep(0.42, 0.75, d)) * (1.0 - smoothstep(Rc * 0.62, Rc * 0.98, r)), wh = smoothstep(0.03, 0.22, d) * smoothstep(Rf + 1.0 + 3.5 * rag, Rf - 2.5, r) * (1.0 - hole);
          foam += 1.45 * wh * exp(-d / 3.4) + 0.9 * e2 * min(top, 1.5) * (0.35 + 0.65 * smoothstep(0.10, 0.35, d)); churn += wh * exp(-d / 2.6); rough += wh * exp(-d / 4.0); }
        float sl = uSpl.w * smoothstep(1.0, 3.0, d) * exp(-max(d - 1.0, 0.0) / 6.5);
        h += sl * (0.20 * cos(3.14159 * (p.x + 30.0) / 72.0) * sin(6.2832 * d / 6.2) + 0.12 * cos(3.14159 * (p.y + 6.0) / 100.0) * sin(6.2832 * d / 8.7 + 1.0)); }
      for (int i = 0; i < 4; i++) { vec4 f = uFalls[i]; if (f.w < 0.01) continue;       // plunge pools: boiling water, rings that never stop
        vec2 q = p - f.xy; float r = length(q) + 1e-3; if (r > 40.0) continue; vec2 n = q / r; float bo = f.w * exp(-r * r / (f.z * f.z));
        float b1x = p.x * 3.1 + uTime * 7.3, b1z = p.y * 2.7 - uTime * 6.1, b2x = p.x * 5.3 - uTime * 9.1 + 1.0, b2z = p.y * 4.9 + uTime * 8.3;
        h += bo * 0.13 * (sin(b1x) * sin(b1z) + 0.6 * sin(b2x) * sin(b2z));
        g += bo * 0.13 * vec2(3.1 * cos(b1x) * sin(b1z) + 3.18 * cos(b2x) * sin(b2z), 2.7 * sin(b1x) * cos(b1z) + 2.94 * sin(b2x) * cos(b2z));
        float k = 6.2832 / 2.1, amp = f.w * 0.085 * smoothstep(f.z * 0.4, f.z * 1.2, r) * exp(-r / 20.0) / sqrt(1.0 + r * 0.3), ph = k * (r - 2.0 * uTime);
        h += amp * sin(ph); g += n * (amp * k * cos(ph)); foam += f.w * (1.25 * exp(-r * r / (f.z * f.z * 1.3)) + 0.5 * amp / 0.085 * smoothstep(0.55, 1.0, sin(ph)) * exp(-r / 9.0)); rough += f.w * exp(-r / (f.z * 2.5)); churn += f.w * exp(-r * r / (f.z * f.z * 0.8)); }
      // waves shoal where the lake runs out: they rise against every shore, pile and island (what climbs the rock is the surface itself)
      if (abs(h) > 0.02) { float sdv = textureLod(tBed, bedUV(p), 0.0).g, k = 1.0 + 0.8 * exp(-max(sdv, 0.0) / 2.2) * step(0.0, h); h *= k; g *= k; }
      h += wkSwell(p).z;                                    // the swell lifts the surface here; its slope is worked out per pixel
      rc = vec2(rough, min(churn, 1.5)); return h; }`;

  const SUNC = `vec3(${f4(SUN_COL.r)}, ${f4(SUN_COL.g)}, ${f4(SUN_COL.b)})`;
  // the sun's shadow map, read by hand: the dragons' shadows cross the foam, the murk and the falls. The map holds packed depth, so the
  // card cannot filter it. SUNB (the lake): four compares on the map's own texel grid with bilinear weights, so a shadow edge is a smooth
  // ramp at any magnification and never a mosaic of texels (w_water's fix for the judge's blocky leaf shadows, cut from nine taps to four).
  // Otherwise (small moving things): four spread compares.
  const GL_SUN = /* glsl */`
    uniform sampler2D tShadow; uniform mat4 uShadowM; uniform float uShadowOn; uniform vec2 uShadowPx;
    float sunTap(vec2 uv, float z){ return step(z, unpackRGBAToDepth(texture2D(tShadow, uv))); }
    float sunAt(vec3 w){ if (uShadowOn < 0.5) return 1.0; vec4 sc = uShadowM * vec4(w, 1.0); sc.xyz /= sc.w; if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
      float z = sc.z - 0.0007;
      #ifdef SUNB
      float e = uShadowPx.x * uShadowPx.y; vec2 q = sc.xy / e - 0.5, f = fract(q), b = (floor(q) + 0.5) * e;
      return mix(mix(sunTap(b, z), sunTap(b + vec2(e, 0.0), z), f.x), mix(sunTap(b + vec2(0.0, e), z), sunTap(b + vec2(e, e), z), f.x), f.y);
      #else
      float e = 1.3 * uShadowPx.x;
      return 0.25 * (sunTap(sc.xy + vec2(e, e * 0.4), z) + sunTap(sc.xy + vec2(-e * 0.4, e), z) + sunTap(sc.xy + vec2(-e, -e * 0.4), z) + sunTap(sc.xy + vec2(e * 0.4, -e), z));
      #endif
      }`;

  // ================= build-time helpers =================
  const triGeo = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)); return g; };
  const PASS_VS = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  let pq, ps, pc;
  function pass(fs, uniforms, target) {
    if (!pq) { pq = new THREE.Mesh(triGeo(), null); pq.frustumCulled = false; ps = new THREE.Scene(); ps.add(pq); pc = new THREE.Camera(); }
    const m = new THREE.ShaderMaterial({ vertexShader: PASS_VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, fog: false });
    pq.material = m; R.setRenderTarget(target); R.render(ps, pc); R.setRenderTarget(null); m.dispose();
  }
  // tiling wave map. RG: slope of a field of wind ripples (many small sine waves fanned round one direction), B: its height,
  // A: a lacy cell pattern (foam, caustics, the tearing of a waterfall). Layers of it at different sizes slide over each other.
  function waveTex() {
    const rt = new THREE.WebGLRenderTarget(512, 512, { depthBuffer: false, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
    rt.texture.anisotropy = 8;
    pass(/* glsl */`varying vec2 vUv;
      float h1(float n){ return fract(sin(n * 127.1 + 31.7) * 43758.5453); }
      vec2 h2(vec2 p, float per){ p = mod(p, per); return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
      float lace(vec2 uv, float per){ vec2 x = uv * per, i = floor(x), f = fract(x); float d1 = 9.0, d2 = 9.0;
        for (int b = -1; b <= 1; b++) for (int a = -1; a <= 1; a++) { vec2 o = vec2(float(a), float(b)); vec2 q = o + h2(i + o, per) - f; float d = dot(q, q); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
        return sqrt(d2) - sqrt(d1); }
      void main(){ float h = 0.0; vec2 g = vec2(0.0);
        for (int i = 0; i < 40; i++) { float fi = float(i), km = 2.0 + 14.0 * pow(h1(fi * 1.7 + 0.3), 1.5), an = (h1(fi * 3.1 + 7.0) - 0.5) * 2.5;
          vec2 k = floor(vec2(cos(an), sin(an)) * km + 0.5); if (dot(k, k) < 0.5) k = vec2(1.0, 0.0);
          float a = pow(length(k), -1.25), s = dot(k, vUv) * 6.2832 + h1(fi * 5.3 + 1.1) * 6.2832; h += a * sin(s); g += a * cos(s) * k; }
        float l = 1.0 - smoothstep(0.0, 0.22, lace(vUv, 11.0)), l2 = 1.0 - smoothstep(0.0, 0.30, lace(vUv + 0.37, 23.0));
        gl_FragColor = vec4(clamp(g / 5.2, -1.0, 1.0) * 0.5 + 0.5, clamp(h / 3.6, -1.0, 1.0) * 0.5 + 0.5, clamp(l * 0.62 + l2 * 0.38, 0.0, 1.0)); }`, {}, rt);
    return rt.texture;
  }
  // The bed map. The world is static, so the rock (and whatever the halls stand on) is rendered ONCE from straight above:
  //   tBed  R = height of the bed, or of the land where there is land (m)   G = signed metres to the waterline (+ in water, - on land; jump flooding)
  //         BA = unit direction toward the land. The valley has no modelled floor in open water: there the bed slopes away from every shore.
  //   tBedC the same view in colour with the real rock material (alpha 0 where nothing was drawn): what you see through shallow water
  function bedMaps(scene) {
    const hf = { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
    const rtH = new THREE.WebGLRenderTarget(BN, BN, { ...hf, depthBuffer: true }), rtC = new THREE.WebGLRenderTarget(BN, BN, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
    const rtB = new THREE.WebGLRenderTarget(BN, BN, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
    const jt = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(BN, BN, hf));
    const oc = new THREE.OrthographicCamera(-(X1 - X0) / 2, (X1 - X0) / 2, (Z1 - Z0) / 2, -(Z1 - Z0) / 2, 1, 700);
    oc.position.set((X0 + X1) / 2, 520, (Z0 + Z1) / 2); oc.up.set(0, 0, -1); oc.lookAt((X0 + X1) / 2, 0, (Z0 + Z1) / 2); oc.updateMatrixWorld(true);
    // only the solid world: no instanced plants, no dragons, no sky. The rock goes in whole. Everything else that is solid (the halls'
    // stone) goes in only below 2.5 m above the lake: a plinth standing in the water is shore, a roof hanging over it is not
    const hid = [], rock = [], other = []; scene.traverse(o => { if (!o.isMesh) return; const keep = !o.isInstancedMesh && o.frustumCulled && !o.material.transparent && o !== Sky.mesh; if (!keep) { if (o.visible) { hid.push(o); o.visible = false; } } else (o.material === Rock.mat ? rock : other).push(o); });
    const VSH = 'varying float vY; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }';
    const hm = new THREE.ShaderMaterial({ side: THREE.DoubleSide, fog: false, uniforms: { uTop: { value: 1e5 } }, vertexShader: VSH, fragmentShader: 'uniform float uTop; varying float vY; void main(){ if (vY > uTop) discard; gl_FragColor = vec4(vY, 1.0, 0.0, 1.0); }' });
    const cm = new THREE.ShaderMaterial({ side: THREE.DoubleSide, fog: false, uniforms: { uTop: { value: WY + 2.5 } }, vertexShader: VSH, fragmentShader: 'uniform float uTop; varying float vY; void main(){ if (vY > uTop) discard; gl_FragColor = vec4(0.36, 0.33, 0.30, 1.0); }' });
    const show = (list, v) => { for (const o of list) o.visible = v; };
    const cc = new THREE.Color(), ca = R.getClearAlpha(), ac = R.autoClear; R.getClearColor(cc);
    R.setClearColor(new THREE.Color(-9, 0, 0), 1); scene.overrideMaterial = hm; R.setRenderTarget(rtH); R.clear(); show(other, false); R.render(scene, oc);
    R.autoClear = false; show(other, true); show(rock, false); hm.uniforms.uTop.value = WY + 2.5; R.render(scene, oc); R.autoClear = ac; show(rock, true);
    R.setClearColor(new THREE.Color(0, 0, 0), 0); scene.overrideMaterial = null; R.setRenderTarget(rtC); R.clear(); show(other, false); R.render(scene, oc);
    R.autoClear = false; show(other, true); show(rock, false); scene.overrideMaterial = cm; R.render(scene, oc); scene.overrideMaterial = null; R.autoClear = ac; show(rock, true);
    R.setRenderTarget(null); R.setClearColor(cc, ca);
    for (const o of hid) o.visible = true; hm.dispose(); cm.dispose();
    // jump flooding, twice: every water texel learns its nearest land texel, every land texel its nearest water texel
    const flood = (landSeeds, out) => { let a = jt[0], b = out;
      pass(`uniform sampler2D tH; varying vec2 vUv; void main(){ bool land = texture2D(tH, vUv).r > ${f4(WY + 0.03)}; gl_FragColor = land == ${landSeeds ? 'true' : 'false'} ? vec4(gl_FragCoord.xy, 0.0, 1.0) : vec4(-9000.0, -9000.0, 0.0, 0.0); }`, { tH: { value: rtH.texture } }, a);
      let n = 0; for (let st = BN / 2; st >= 1; st /= 2) n++;
      if (n % 2 === 0) { const t = a; a = b; b = t; pass('uniform sampler2D tJ; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tJ, vUv); }', { tJ: { value: b.texture } }, a); }   // so the last step lands in `out`
      for (let st = BN / 2; st >= 1; st /= 2) {
        pass(`uniform sampler2D tJ; uniform float uS; varying vec2 vUv; void main(){ vec2 best = vec2(-9000.0); float bd = 1e12;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 s = texture2D(tJ, vUv + vec2(float(i), float(j)) * uS / ${f4(BN)}).xy; if (s.x > -8000.0) { vec2 dv = s - gl_FragCoord.xy; float d = dot(dv, dv); if (d < bd) { bd = d; best = s; } } }
          gl_FragColor = vec4(best, 0.0, 1.0); }`, { tJ: { value: a.texture }, uS: { value: st } }, b);
        const t = a; a = b; b = t; }
      return a; };
    const jl = flood(true, jt[1]), jw = flood(false, jt[2]);
    pass(`uniform sampler2D tH, tJ, tK; varying vec2 vUv;
      float bh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float bn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(bh(i), bh(i + vec2(1.0, 0.0)), f.x), mix(bh(i + vec2(0.0, 1.0)), bh(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){ vec4 hh = texture2D(tH, vUv); float h = hh.r; bool land = h > ${f4(WY + 0.03)};
      vec2 sl = texture2D(tJ, vUv).xy, sw = texture2D(tK, vUv).xy, dl = sl - gl_FragCoord.xy, dw = sw - gl_FragCoord.xy; float px = ${f4((X1 - X0) / BN)};
      float dOut = sl.x > -8000.0 ? length(dl) * px : 40.0, dIn = sw.x > -8000.0 ? length(dw) * px : 40.0;
      vec2 dir = land ? (dIn > 1e-4 && sw.x > -8000.0 ? -normalize(dw) : vec2(0.0)) : (dOut > 1e-4 && sl.x > -8000.0 ? normalize(dl) : vec2(0.0));
      // The valley has no modelled floor in open water, so one is made here the way a karst pool lies: the bank carries on under water
      // at the slope it has above it (a cliff, a boulder or a plinth drops straight in; a low bank shelves), and it levels out into a
      // floor of bars and pools. Nothing here depends on the distance to the shore alone, so no shore wears a band of constant width. [w_water]
      float bedY = -9.0;
      if (!land) { vec2 inl = dOut > 1e-4 && sl.x > -8000.0 ? normalize(dl) : vec2(0.0); float rise = 0.0;
        for (int k = 0; k < 3; k++) { float m = k == 0 ? 0.6 : (k == 1 ? 1.3 : 2.6); rise = max(rise, (texture2D(tH, (sl + inl * (m / px)) / ${f4(BN)}).r - ${f4(WY)}) / m); }
        vec2 wp = vec2(${f4(X0)} + vUv.x * ${f4(X1 - X0)}, ${f4(Z1)} - vUv.y * ${f4(Z1 - Z0)});
        float n1 = bn(wp / 21.0 + 3.7), n2 = bn(wp / 8.3 + 11.1), n3 = bn(wp / 2.9), n4 = bn(wp / 0.9 + 5.0);
        float slope = clamp(rise, 0.30, 3.5) * mix(0.55, 1.8, n2), deep = mix(1.4, 4.6, smoothstep(0.22, 0.78, n1 * 0.65 + n2 * 0.35));
        float dep = deep * (1.0 - exp(-slope * dOut / deep)); dep += (0.22 * (n3 - 0.5) + 0.08 * (n4 - 0.5)) * min(dep * 1.6, 1.0);
        bedY = ${f4(WY - 0.05)} - max(dep, 0.0); }
      float bed = land ? h : max(hh.g > 0.5 ? h : -9.0, bedY);
      gl_FragColor = vec4(bed, clamp(land ? -dIn : dOut, -40.0, 40.0), dir.x, -dir.y); }`, { tH: { value: rtH.texture }, tJ: { value: jl.texture }, tK: { value: jw.texture } }, rtB);
    // CPU copy (512 x 512): where the falls can run, where leaves can float, where a body is over open water
    const cn = 512, rtS = new THREE.WebGLRenderTarget(cn, cn, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    pass('uniform sampler2D tB; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tB, vUv); }', { tB: { value: rtB.texture } }, rtS);
    const px = new Float32Array(cn * cn * 4); R.readRenderTargetPixels(rtS, 0, 0, cn, cn, px); bedCPU = { n: cn, px };
    rtH.dispose(); for (const t of jt) t.dispose(); rtS.dispose();
    return { bed: rtB.texture, col: rtC.texture };
  }
  const bedOut = { h: 0, d: 0 };
  function bedAt(x, z) { if (!bedCPU) return bedOut; const n = bedCPU.n, i = clamp(Math.floor((x - X0) / (X1 - X0) * n), 0, n - 1), j = clamp(Math.floor((Z1 - z) / (Z1 - Z0) * n), 0, n - 1), k = (j * n + i) * 4;
    bedOut.h = bedCPU.px[k]; bedOut.d = bedCPU.px[k + 1]; return bedOut; }
  const overLake = (x, z) => x > X0 + 1 && x < X1 - 1 && z > Z0 + 1 && z < Z1 - 1 && bedAt(x, z).d > 0;

  // ================= the current =================
  // Water enters at the foot of every fall that lands in the lake and leaves at the lake's open end (z = Z1): a potential flow round the
  // islands and piles, solved once on a coarse grid of the bed map. From it two tables:
  //   tFlow   (grid, x by z)        r = which streamline a point lies on (its source's number + the angle it left the plunge pool at, in turns),
  //                                 g = seconds the water took to get here, b = speed here (m/s), a = 1 where the current runs
  //   tStream (FLOW_NT by rows)     the same streamlines walked forward, a column every FLOW_DT seconds: x, z, alive, speed. Leaves ride these.
  const FLOW_N = 128, FLOW_NT = 256, FLOW_DT = 0.3;
  function flowBake() {
    const FN = FLOW_N, cs = (X1 - X0) / FN, NN = FN * FN, wat = new Uint8Array(NN), phi = new Float32Array(NN), qs = new Float32Array(NN), fix = new Uint8Array(NN), srcOf = new Int8Array(NN).fill(-1);
    const cx = i => X0 + (i + 0.5) * cs, cz = j => Z0 + (j + 0.5) * cs, out = new Float32Array(NN * 4), blank = () => { const t = new THREE.DataTexture(new Uint16Array(NN * 4), FN, FN, THREE.RGBAFormat, THREE.HalfFloatType); t.needsUpdate = true; return t; };
    const srcs = S.falls.filter(f => f.wet); S.flow = { rows: 0, NT: FLOW_NT, long: [0] };
    if (!srcs.length) { U.tFlow.value = blank(); return; }
    for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) wat[j * FN + i] = bedAt(cx(i), cz(j)).d > 0.35 ? 1 : 0;
    // only the water joined to the main pool
    { const seen = new Uint8Array(NN), st = []; for (const f of srcs) { const i = clamp(Math.floor((f.fx - X0) / cs), 0, FN - 1), j = clamp(Math.floor((f.fz - Z0) / cs), 0, FN - 1); for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const k = clamp(j + dj, 0, FN - 1) * FN + clamp(i + di, 0, FN - 1); if (wat[k] && !seen[k]) { seen[k] = 1; st.push(k); } } }
      while (st.length) { const k = st.pop(), i = k % FN, j = (k - i) / FN; if (i > 0 && wat[k - 1] && !seen[k - 1]) { seen[k - 1] = 1; st.push(k - 1); } if (i < FN - 1 && wat[k + 1] && !seen[k + 1]) { seen[k + 1] = 1; st.push(k + 1); } if (j > 0 && wat[k - FN] && !seen[k - FN]) { seen[k - FN] = 1; st.push(k - FN); } if (j < FN - 1 && wat[k + FN] && !seen[k + FN]) { seen[k + FN] = 1; st.push(k + FN); } }
      for (let k = 0; k < NN; k++) wat[k] = seen[k]; }
    // sources (their share of the flow spread over the plunge pool) and the sink (the lake's far end)
    srcs.forEach((f, si) => { const rs = Math.max(1.9, f.w1 * 0.5 + 0.4), cells = []; f.rs = rs;
      for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) { const k = j * FN + i; if (wat[k] && Math.hypot(cx(i) - f.fx, cz(j) - f.fz) < rs && srcOf[k] < 0) { srcOf[k] = si; cells.push(k); } }
      const q = (si === 0 ? 1 : 0.20) / Math.max(1, cells.length); for (const k of cells) qs[k] = q; });
    { let zmax = -1; for (let k = 0; k < NN; k++) if (wat[k]) zmax = Math.max(zmax, (k / FN) | 0); let nf = 0; for (let k = 0; k < NN; k++) if (wat[k] && ((k / FN) | 0) >= zmax - 1) { fix[k] = 1; nf++; } }
    const cells = []; for (let k = 0; k < NN; k++) if (wat[k] && !fix[k]) cells.push(k);
    for (let it = 0; it < 520; it++) { const w = it < 12 ? 1.0 : 1.93; for (let c = 0; c < cells.length; c++) { const k = cells[c], i = k % FN, j = (k - i) / FN; let sm0 = qs[k], n = 0;
      if (i > 0 && wat[k - 1]) { sm0 += phi[k - 1]; n++; } if (i < FN - 1 && wat[k + 1]) { sm0 += phi[k + 1]; n++; } if (j > 0 && wat[k - FN]) { sm0 += phi[k - FN]; n++; } if (j < FN - 1 && wat[k + FN]) { sm0 += phi[k + FN]; n++; }
      if (n) phi[k] += w * (sm0 / n - phi[k]); } }
    // velocity = downhill of phi; its speed squeezed into what reads as a mountain lake's current (slow in coves, quick in narrows)
    const gx = new Float32Array(NN), gz = new Float32Array(NN), spd = new Float32Array(NN); let gs = 0, gn = 0;
    for (let k = 0; k < NN; k++) { if (!wat[k]) continue; const i = k % FN, j = (k - i) / FN, a = i > 0 && wat[k - 1] ? phi[k - 1] : phi[k], b = i < FN - 1 && wat[k + 1] ? phi[k + 1] : phi[k], c = j > 0 && wat[k - FN] ? phi[k - FN] : phi[k], d = j < FN - 1 && wat[k + FN] ? phi[k + FN] : phi[k];
      gx[k] = (b - a) * 0.5; gz[k] = (d - c) * 0.5; const m = Math.hypot(gx[k], gz[k]); spd[k] = m; if (srcOf[k] < 0) { gs += m; gn++; } }
    const gref = 1.15 * gs / Math.max(1, gn) + 1e-12;
    for (let k = 0; k < NN; k++) { if (!wat[k]) continue; const m = spd[k]; spd[k] = 0.24 + 1.75 * (1 - Math.exp(-m / gref)); if (m > 1e-12) { gx[k] /= m; gz[k] /= m; } }
    // seconds of travel and the streamline's name, handed down the flow: cells in order of falling phi, each looking one cell upstream
    const tau = new Float32Array(NN).fill(-1), lab = new Float32Array(NN), order = cells.slice().sort((a, b) => phi[b] - phi[a]);
    srcs.forEach((f, si) => { for (let k = 0; k < NN; k++) if (srcOf[k] === si) { const i = k % FN, j = (k - i) / FN, qx = cx(i) - f.fx, qz = cz(j) - f.fz;
      lab[k] = si + 0.5 + Math.atan2(f.dx * qz - f.dz * qx, f.dx * qx + f.dz * qz) / TAU; tau[k] = Math.hypot(qx, qz) / 2.2; } });
    for (const k of order) { if (srcOf[k] >= 0) continue; const i = k % FN, j = (k - i) / FN, ux = i + gx[k], uz = j + gz[k], i0 = Math.floor(ux), j0 = Math.floor(uz), fx = ux - i0, fz = uz - j0;
      let bw = 0, bl = 0, ws = 0, ts = 0, ls = 0, ss = 0;
      for (let c = 0; c < 4; c++) { const ii = i0 + (c & 1), jj = j0 + (c >> 1); if (ii < 0 || jj < 0 || ii >= FN || jj >= FN) continue; const kk = jj * FN + ii; if (tau[kk] < 0) continue; const w = ((c & 1) ? fx : 1 - fx) * ((c >> 1) ? fz : 1 - fz); if (w > bw) { bw = w; bl = lab[kk]; } }
      for (let c = 0; c < 4; c++) { const ii = i0 + (c & 1), jj = j0 + (c >> 1); if (ii < 0 || jj < 0 || ii >= FN || jj >= FN) continue; const kk = jj * FN + ii; if (tau[kk] < 0) continue; const w = ((c & 1) ? fx : 1 - fx) * ((c >> 1) ? fz : 1 - fz) + 1e-4;
        if (Math.abs(lab[kk] - bl) > 0.2) continue; ws += w; ts += w * tau[kk]; ls += w * lab[kk]; ss += w * spd[kk]; }       // streamlines from another fall, or from the far side of an island, are not blended in
      if (ws <= 0) { let best = -1; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= FN || jj >= FN) continue; const kk = jj * FN + ii; if (tau[kk] >= 0 && (best < 0 || phi[kk] > phi[best])) best = kk; }
        if (best < 0) { tau[k] = 150; lab[k] = 0.37; continue; } ws = 1; ts = tau[best]; ls = lab[best]; ss = spd[best]; }
      tau[k] = Math.min(ts / ws + cs / (0.5 * (spd[k] + ss / ws)), 400); lab[k] = ls / ws; }
    for (let k = 0; k < NN; k++) if (wat[k] && tau[k] < 0) { tau[k] = 150; lab[k] = 0.37; }
    // the shore's pixels read the water next to them
    const val = new Uint8Array(NN); for (let k = 0; k < NN; k++) val[k] = wat[k];
    for (let pass = 0; pass < 4; pass++) { const add = []; for (let k = 0; k < NN; k++) { if (val[k]) continue; const i = k % FN, j = (k - i) / FN; let n = 0, t = 0, l = 0, sp = 0, l0 = -1;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= FN || jj >= FN) continue; const kk = jj * FN + ii; if (!val[kk]) continue; if (l0 < 0) l0 = lab[kk]; if (Math.abs(lab[kk] - l0) > 0.2) continue; n++; t += tau[kk]; l += lab[kk]; sp += spd[kk]; }
        if (n) add.push(k, t / n, l / n, sp / n); }
      for (let a = 0; a < add.length; a += 4) { const k = add[a]; val[k] = 1; tau[k] = add[a + 1]; lab[k] = add[a + 2]; spd[k] = add[a + 3]; } }
    const hf = new Uint16Array(NN * 4), H = THREE.DataUtils.toHalfFloat;
    for (let k = 0; k < NN; k++) { hf[k * 4] = H(lab[k]); hf[k * 4 + 1] = H(val[k] ? Math.min(tau[k], 400) : 400); hf[k * 4 + 2] = H(spd[k]); hf[k * 4 + 3] = H(val[k] && tau[k] < 380 ? 1 : 0); }
    const tf = new THREE.DataTexture(hf, FN, FN, THREE.RGBAFormat, THREE.HalfFloatType); tf.minFilter = tf.magFilter = THREE.LinearFilter; tf.wrapS = tf.wrapT = THREE.ClampToEdgeWrapping; tf.needsUpdate = true; U.tFlow.value = tf;
    // the streamlines walked forward (leaves ride them)
    const vel = (x, z, o) => { const fi = (x - X0) / cs - 0.5, fj = (z - Z0) / cs - 0.5, i0 = Math.floor(fi), j0 = Math.floor(fj), fx = fi - i0, fz = fj - j0; let vx = 0, vz = 0, ws = 0;
      for (let c = 0; c < 4; c++) { const ii = i0 + (c & 1), jj = j0 + (c >> 1); if (ii < 0 || jj < 0 || ii >= FN || jj >= FN) continue; const kk = jj * FN + ii; if (!wat[kk]) continue; const w = ((c & 1) ? fx : 1 - fx) * ((c >> 1) ? fz : 1 - fz); vx -= w * gx[kk] * spd[kk]; vz -= w * gz[kk] * spd[kk]; ws += w; }
      if (ws < 0.2) return false; o[0] = vx / ws; o[1] = vz / ws; return true; };
    const rowsOf = srcs.map((f, si) => (si === 0 ? 44 : 10)), NR = rowsOf.reduce((a, b) => a + b, 0), st = new Float32Array(FLOW_NT * NR * 4), v0 = [0, 0], v1 = [0, 0], lens = []; let row = 0;
    srcs.forEach((f, si) => { for (let q = 0; q < rowsOf[si]; q++, row++) { const a = (((q + 0.5) / rowsOf[si]) * 2 - 1) * 0.44 * Math.PI, ca = Math.cos(a), sa = Math.sin(a); let x = f.fx + (f.dx * ca - f.dz * sa) * f.rs * 0.55, z = f.fz + (f.dz * ca + f.dx * sa) * f.rs * 0.55, stop = FLOW_NT;
        for (let c = 0; c < FLOW_NT; c++) { const o = (row * FLOW_NT + c) * 4; st[o] = x; st[o + 1] = z; st[o + 2] = 1; st[o + 3] = 1; if (stop < FLOW_NT) continue;
          if (!vel(x, z, v0) || z > Z1 - 3) { stop = c; continue; } const mx = x + v0[0] * FLOW_DT * 0.5, mz = z + v0[1] * FLOW_DT * 0.5; if (!vel(mx, mz, v1)) { stop = c; continue; }
          st[o + 3] = Math.hypot(v1[0], v1[1]); x += v1[0] * FLOW_DT; z += v1[1] * FLOW_DT; if (bedAt(x, z).d < 0.3) { x -= v1[0] * FLOW_DT; z -= v1[1] * FLOW_DT; stop = c; } }
        for (let c = 0; c < FLOW_NT; c++) st[(row * FLOW_NT + c) * 4 + 2] = clamp((stop - c) / 8);
        lens.push([row, stop]); } });
    const ts = new THREE.DataTexture(st, FLOW_NT, NR, THREE.RGBAFormat, THREE.FloatType); ts.minFilter = ts.magFilter = THREE.NearestFilter; ts.needsUpdate = true; U.tStream.value = ts;
    lens.sort((a, b) => b[1] - a[1]); S.flow = { rows: NR, NT: FLOW_NT, long: lens.slice(0, Math.max(6, NR >> 1)).map(l => l[0]), wat, phi, FN };
    G.info.waterFlow = { cells: cells.length, rows: NR, longest: lens[0][1], median: lens[lens.length >> 1][1] };
  }

  // ================= the lake =================
  function lakeMesh() {
    // a grid that is finest in the open pool in front of the lens (14 cm) and coarse against the cliffs (90 cm)
    const NX = 300, NZ_ = 340, cx = 3, hx = 59, cz = 47, hz = 66, pos = new Float32Array((NX + 1) * (NZ_ + 1) * 3), idx = new Uint32Array(NX * NZ_ * 6);
    const w = v => v * (0.35 + 0.65 * v * v); let o = 0;
    for (let j = 0; j <= NZ_; j++) for (let i = 0; i <= NX; i++) { pos[o++] = cx + hx * w(i / NX * 2 - 1); pos[o++] = 0; pos[o++] = cz + hz * w(j / NZ_ * 2 - 1); }
    o = 0; for (let j = 0; j < NZ_; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    const A0 = Math.atan2(-WDV[1], WDV[0]);                           // the ripple map turned so its waves run down the wind
    const m = new THREE.ShaderMaterial({ uniforms: U, fog: false,
      vertexShader: /* glsl */`${GL_MACRO}
        varying vec3 vW; varying vec4 vMac; varying vec2 vRough;
        void main(){ vec2 p = position.xz, g, rc; float foam, h = wkMacro(p, g, foam, rc);
          vW = vec3(p.x, ${f4(WY)} + h, p.y); vMac = vec4(g, h, foam); vRough = rc; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
      fragmentShader: /* glsl */`${GLSL_NOISE}${GLSL_FOG}
        #include <packing>
        #define SUNB
        ${GL_SUN}
        ${HASGUST ? Wake.GLSL_GUST : ''}
        uniform sampler2D tWave, tBed, tBedC, tMirror, tMirrorZ, tFlow; uniform mat4 uTexM, uMPI;
        uniform float uTime, uWind, uGust, uDbg, uMirTop, uMirW; uniform vec2 uMirK, uMirPx; uniform vec4 uLight, uStorm, uRain, uSpl; uniform vec3 uLightC; uniform vec4 uFalls[4];
        varying vec3 vW; varying vec4 vMac; varying vec2 vRough;
        ${GL_BEDUV}
        ${GL_FLOWUV}
        ${GL_SWELL}
        const vec2 WD = vec2(${f4(WDV[0])}, ${f4(WDV[1])});                  // the way the wind blows (the trees lean the same way)
        // metres from the lake to the thing the mirror shows at uvm. Near the lens the mirror's depth is read with bilinear weights by hand (a
        // depth texture is not filtered by the card, and a nearest read cuts a reflected outline into steps the size of a mirror texel) [w_water];
        // far off, where a mirror texel is under a pixel, one read
        float mirS(vec2 uvm, float dist){ float z;
          if (dist < 26.0) { vec2 st = uvm * uMirK / uMirPx - 0.5, f = fract(st), b = (floor(st) + 0.5) * uMirPx;
            z = mix(mix(texture2D(tMirrorZ, b).x, texture2D(tMirrorZ, b + vec2(uMirPx.x, 0.0)).x, f.x), mix(texture2D(tMirrorZ, b + vec2(0.0, uMirPx.y)).x, texture2D(tMirrorZ, b + uMirPx).x, f.x), f.y); }
          else z = texture2D(tMirrorZ, uvm * uMirK).x;
          vec4 vp = uMPI * vec4(uvm * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); return clamp(length(vp.xyz / vp.w) - dist, 0.3, 140.0); }
        // one layer of wind ripples: the map turned by ang, travelling the way its own crests face
        vec4 wv(vec2 p, float tile, float ang, float spd){ float c = cos(ang), s = sin(ang); vec2 q = p - vec2(c, -s) * (uTime * spd);
          vec4 t = texture2D(tWave, vec2(c * q.x - s * q.y, s * q.x + c * q.y) / tile); vec2 gr = t.rg * 2.0 - 1.0; t.rg = vec2(c * gr.x + s * gr.y, -s * gr.x + c * gr.y); return t; }
        void main(){
          vec2 p = vW.xz; vec3 toC = cameraPosition - vW; float dist = length(toC); vec3 V = toC / dist;
          float fwp = max(length(dFdx(p)), length(dFdy(p)));                  // metres of lake under this pixel (long at grazing angles)
          // ---- wind: ripples in three sizes crossing each other on top of the swell; gusts cross the lake as fronts of fine ripple (cat's paws)
          vec4 w1 = wv(p, 13.1, ${f4(A0 - 0.35)}, 1.55), w2 = wv(p, 4.7, ${f4(A0 + 0.60)}, 1.05), w3 = wv(p, 1.63, ${f4(A0 - 0.15)}, 0.62);
          #ifdef CL_WKGUST
          float gst = wkGust(p), cat = smoothstep(0.30, 1.0, gst + 0.5 * (w1.b - 0.5));
          #else
          float gp = texture2D(tWave, (p - WD * (uWind * 4.0)) / 83.0).b * 0.62 + w1.b * 0.38, cat = smoothstep(0.50, 0.70, gp + 0.26 * min(uGust, 1.0) - 0.10);
          #endif
          float churn = min(vRough.y, 1.0);
          float ruf = clamp(0.16 + cat * (0.34 + 0.9 * uGust) + 0.22 * uGust + vRough.x, 0.0, 2.6);
          vec3 swl = wkSwell(p);
          vec2 sl = swl.xy + w1.rg * (0.016 + 0.024 * ruf) + w2.rg * (0.030 + 0.085 * ruf) + w3.rg * (0.030 + 0.11 * ruf);
          float wh = w1.b * 0.45 + w2.b * 0.35 + w3.b * 0.20;                  // where the ripples stand high
          // ---- the bed map: depth of water here, and how far the nearest shore, pile or boulder is
          vec4 bed = texture2D(tBed, bedUV(p)); float sds = bed.g, sd = max(sds, 0.0), h = vMac.z;
          float depth = sds < 0.0 ? 1.6 * smoothstep(0.0, -1.0, sds) : ${f4(WY)} + h - bed.r;       // under an overhang the map holds the rock above, not the bed
          // ---- the current: tFlow holds, for every point of the lake, which streamline it lies on (r), how many seconds the water took to
          //      get here from the foot of its fall (g), how fast it runs (b). Anything drawn in (streamline, seconds - time) rides the flow.
          vec4 fl = texture2D(tFlow, flowUV(p)); float tau = fl.g, fsp = fl.b;
          vec2 fuv = vec2(fl.r * 16.0, (tau - uTime) * 0.078);
          vec4 fa = texture2D(tWave, fuv), fb = texture2D(tWave, fuv * vec2(3.0, 2.0) + vec2(0.37, 0.11));
          // the flow drags fine lines along itself: a faint grain in the mirror that travels with the water
          sl += (fb.rg * 2.0 - 1.0).yx * (0.010 * clamp(fsp, 0.0, 1.5)) * (1.0 - churn);
          // wavelets run in to every waterline and die on it
          float lapK = exp(-sd / 1.9) * step(-0.5, sds), lph = sd * 5.4 + uTime * 2.6 + w1.b * 9.0;
          sl -= bed.ba * (cos(lph) * 0.060 * lapK * (0.6 + 0.4 * ruf));
          // rings where spray rains back down
          float plip = 0.0;
          if (uRain.w > 0.01) { float rr = uRain.w * smoothstep(uRain.z, uRain.z * 0.3, length(p - uRain.xy));
            if (rr > 0.02) for (int k = 0; k < 2; k++) { float cs = k == 0 ? 1.9 : 1.1; vec2 q = p / cs + float(k) * 7.3, ce = floor(q), f = fract(q) - 0.5;
              float hsh = hash21(ce + 3.1), per = 0.7 + 0.5 * hash21(ce + 9.7), cyc = floor(uTime / per + hsh), ph = fract(uTime / per + hsh), on = step(hash21(ce + cyc * 0.37 + 1.9), rr);
              vec2 dv = f - (hash22(ce + cyc * 1.31) - 0.5) * 0.5; float r = length(dv) * cs, x = (r - ph * 0.85 * cs) / 0.07;
              sl += normalize(dv + 1e-5) * (exp(-x * x) * (1.0 - ph) * on * 0.45 * sin(x * 2.2)); plip += on * smoothstep(0.12, 0.0, ph) * smoothstep(0.11, 0.02, r); } }
          vec2 gs = vMac.xy + sl; vec3 N = normalize(vec3(-gs.x, 1.0, -gs.y));
          float nv = max(dot(N, V), 0.0);
          float far = smoothstep(0.08, 1.6, fwp);                             // ripples too small for the pixel: they blur the mirror instead of bending it
          float F = 0.024 + 0.976 * pow(1.0 - max(nv, 0.10 * far), 5.0);
          // ---- the mirror: the valley as the reflected lens sees it, bent by the waves. The bend is scaled by how far away the
          //      reflected thing is (read from the mirror's own depth), so a pile stays joined to its reflection and far cliffs shiver
          vec3 Rv = reflect(-V, N); Rv.y = max(Rv.y, 0.02); Rv = normalize(Rv);
          vec4 pc0 = uTexM * vec4(vW.x, ${f4(WY)}, vW.z, 1.0); vec2 uv0 = pc0.xy / pc0.w;
          // Ripples smaller than the pixel cannot bend the mirror pixel by pixel: that shreds every reflected edge into dashes. Summed over
          // the pixel they smear the picture along the line of sight. So they are faded out of the bend as the pixel outgrows them, and
          // their slope is handed to a three-tap smear of the same reach (the glitter and the Fresnel term keep every ripple). [w_water]
          float a2 = smoothstep(0.90, 0.10, fwp), a3 = smoothstep(0.30, 0.035, fwp), k2 = 0.030 + 0.085 * ruf, k3 = 0.030 + 0.11 * ruf, lost = 0.5 * (k2 * (1.0 - a2) + k3 * (1.0 - a3));
          vec2 gr = gs - w2.rg * (k2 * (1.0 - a2)) - w3.rg * (k3 * (1.0 - a3)); vec3 Rm = reflect(-V, normalize(vec3(-gr.x, 1.0, -gr.y))); Rm.y = max(Rm.y, 0.02); Rm = normalize(Rm);
          // what stands in for the mirror where none is drawn (the lake a sliver at the frame's edge; white water): cliff below, haze above
          vec3 refl = mix(vec3(0.150, 0.085, 0.070), clFog(vec3(0.0), vW + Rv * 600.0, vW), smoothstep(0.22, 0.70, Rv.y));
          float mirK = uMirW * (1.0 - smoothstep(0.80, 0.98, churn));
          if (mirK > 0.004) {
            float s = mirS(uv0, dist);
            vec4 pc = uTexM * vec4(vW + Rm * s, 1.0); vec2 uv = pc.w > 0.01 ? clamp(pc.xy / pc.w, vec2(0.004), vec2(0.985, uMirTop)) : uv0;
            float s1 = mirS(uv, dist);                                          // the bent ray landed on something nearer than the first guess: bend it only as far as that thing is
            if (s1 < s) { s = s1; pc = uTexM * vec4(vW + Rm * s, 1.0); if (pc.w > 0.01) uv = clamp(pc.xy / pc.w, vec2(0.004), vec2(0.985, uMirTop)); }
            float mlod = far * (0.8 + 1.6 * ruf) + 0.35 * ruf; vec3 rm = textureLod(tMirror, uv * uMirK, mlod).rgb;
            if (lost > 0.003 && F > 0.07) { vec2 hd = normalize(V.xz + 1e-5) * lost; vec3 Ra = reflect(-V, normalize(vec3(-gr.x - hd.x, 1.0, -gr.y - hd.y))), Rb = reflect(-V, normalize(vec3(-gr.x + hd.x, 1.0, -gr.y + hd.y)));
              Ra.y = max(Ra.y, 0.02); Rb.y = max(Rb.y, 0.02); vec4 pa = uTexM * vec4(vW + normalize(Ra) * s, 1.0), pb = uTexM * vec4(vW + normalize(Rb) * s, 1.0);
              if (pa.w > 0.01 && pb.w > 0.01) rm = 0.5 * rm + 0.25 * (textureLod(tMirror, clamp(pa.xy / pa.w, vec2(0.004), vec2(0.985, uMirTop)) * uMirK, mlod + 0.7).rgb + textureLod(tMirror, clamp(pb.xy / pb.w, vec2(0.004), vec2(0.985, uMirTop)) * uMirK, mlod + 0.7).rgb); }
            refl = mix(refl, rm, mirK); }
          // a thin breath of mist on the water, only round the foot of the falls and only in still air. The mirror looks through it too
          float nearFall = 0.0; for (int i = 0; i < 4; i++) { vec4 ff = uFalls[i]; nearFall += ff.w * exp(-length(p - ff.xy) / 9.0); }
          float mistA = min(nearFall, 1.0) * (0.55 + 0.45 * fa.b) * (1.0 - 0.6 * min(uGust, 1.0));
          vec3 mistC = vec3(0.86, 0.55, 0.49);
          refl = mix(refl, mistC, 1.0 - exp(-0.016 * mistA / max(Rv.y, 0.05)));
          // ---- the light on the water: the sun through the trees and the dragons (shadow map), and the clouds' shadows when the light module carries them
          float sun = sunAt(vW);
          #if ${CLS}
          vec3 sunC = ${SUNC} * clSun(vW) * sun; float sunL = sun * clSunAt(vW);
          #else
          vec3 sunC = ${SUNC} * sun; float sunL = sun;
          #endif
          // ---- into the water: jade where it is deep, the stony bed in the shallows (bent by refraction), paler on the backs of waves
          float dz = clamp(depth, 0.0, 6.0), lit = 0.36 + 0.64 * sunL;
          vec3 scat = mix(vec3(0.010, 0.046, 0.050), vec3(0.030, 0.118, 0.096), clamp(0.22 + 1.5 * (wh - 0.5) + 13.0 * swl.z + 0.30 * exp(-dz * 0.45), 0.0, 1.0)) * lit, body = scat;
          if (dz < 3.4 && churn < 0.9) { vec3 T = refract(-V, N, 0.752); float ty = max(-T.y, 0.30);
            float dz2 = sds < 0.0 ? dz : clamp(${f4(WY)} + h - texture2D(tBed, bedUV(p + T.xz / ty * dz)).r, 0.0, 6.0), dzz = 0.5 * (dz + dz2);
            vec2 pb = p + T.xz / ty * dzz; vec4 bc = texture2D(tBedC, bedUV(pb));
            vec4 cb = texture2D(tWave, pb / 2.9); vec3 silt = mix(vec3(0.10, 0.09, 0.062), vec3(0.27, 0.24, 0.17), (1.0 - cb.a) * 0.55 + cb.b * 0.45) * (0.45 + 0.55 * sunL);     // where no rock was modelled: cobbles and silt
            vec3 bedC = mix(silt, bc.rgb, bc.a * smoothstep(-0.9, -0.2, sds)) * mix(vec3(1.0), vec3(0.58, 0.70, 0.56), smoothstep(0.0, 0.22, dzz)) * (0.72 + 0.28 * sunL);     // rock under water is wet and a little green
            if (dzz < 1.9) bedC *= 1.0 + 1.25 * pow(clamp(wv(pb, 3.1, 0.6, 0.55).a * 0.6 + wv(pb, 2.3, 2.1, -0.42).a * 0.6, 0.0, 1.0), 1.6) * sunL * exp(-dzz * 1.0);        // the ripples' net of light on the bed, only where it is shallow
            vec3 tr = exp(-vec3(0.80, 0.27, 0.36) * (dzz / ty + dzz * 1.2)) * smoothstep(3.4, 2.3, max(dz, dzz)); body = bedC * tr + scat * (1.0 - tr); }
          // churned water is full of air: milky jade under the foam
          body = mix(body, vec3(0.30, 0.42, 0.36) * (0.40 + 0.60 * sunL), clamp(vMac.w * 0.40 + churn * 0.55, 0.0, 0.88));
          float film = smoothstep(0.0, 0.12, depth);                          // the last centimetres of water over rock are only a wet shine
          vec3 col = mix(body, refl, F * film * (1.0 - 0.75 * churn));        // white water does not mirror
          // the faces of waves turned toward the lens look up past the cliffs into the sky, the faces turned away look down at the dark
          // foot of the far shore: bands of sky light that travel with the swell and the wind (what a lake in a gorge looks like at dusk)
          { float tilt = dot(swl.xy + w1.rg * (0.016 + 0.024 * ruf), -normalize(V.xz + 1e-5));
            col += clFog(vec3(0.0), vW + vec3(Rv.x, max(Rv.y, 0.35), Rv.z) * 600.0, vW) * (F * film * (1.0 - churn) * 0.55 * smoothstep(0.004, 0.075, tilt)); }
          // ---- lights on the ripples: the sun's glitter path, the storm light, the fire and lightning of the fight
          float sdn = max(dot(Rv, SUN_DIR), 0.0); col += sunC * F * (60.0 * pow(sdn, 1800.0 / (1.0 + 5.0 * ruf)) + 2.0 * pow(sdn, 140.0));
          if (uStorm.w > 0.001) { float ss = max(dot(Rv, uStorm.xyz), 0.0); col += vec3(0.62, 0.78, 1.0) * uStorm.w * F * (3.0 * pow(ss, 260.0) + 0.25 * pow(ss, 24.0)); }
          if (uLight.w > 0.001) { vec3 lv = uLight.xyz - vW; float ld = length(lv); lv /= ld; float ls = max(dot(Rv, lv), 0.0);
            col += uLightC * (uLight.w / (ld * ld + 80.0)) * F * (40.0 * pow(ls, 420.0) + 2.2 * pow(ls, 36.0)); }
          // ---- foam. Four kinds, one look.
          // (1) the current's: born white in the plunge pools, drawn out along the streamlines into rafts and long threads, thinner with every
          //     second it has travelled. It is a picture in (streamline, seconds - time), so every patch keeps its shape and rides the flow.
          float born = exp(-tau / 6.0), raft = smoothstep(0.55, 0.72, fa.b + 0.10 * born) * (0.40 + 0.60 * smoothstep(0.40, 0.64, fb.b)), fmFlow = fl.a * (0.95 * born + (0.85 * exp(-tau / 34.0) + 0.40 * exp(-tau / 170.0)) * raft) * (0.35 + 0.65 * smoothstep(0.25, 0.9, fsp));      // dead water in the coves gathers none
          // (2) the shore's: a thin broken line that washes in and out, heavy only where wavelets arrive, gone in sheltered water
          float wash = 0.5 + 0.5 * sin(uTime * 0.85 + w1.b * 12.0), seg = smoothstep(0.42, 0.66, texture2D(tWave, p / 9.7 + vec2(0.13, 0.57)).b + 0.10 * ruf);
          float fmShore = (0.25 + 0.75 * seg) * 0.85 * smoothstep(0.10 + 0.40 * wash * seg, 0.0, abs(sds) - 0.02) * step(-0.5, sds) + 1.1 * smoothstep(0.05, 0.30, abs(h)) * exp(-sd / 0.8) * step(-0.4, sds);      // and a wave running up a shore breaks on it
          // (3) the events' (rings, collars, the splash, a skim: worked out per vertex), and (4) the crests of waves tall enough to break
          float fm = min(fmFlow + fmShore + vMac.w + 0.9 * smoothstep(0.42, 1.1, h), 1.25);
          // the splash's white water is thrown outward: it lies in fingers and streaks that point away from the entry and thin as they spread
          if (uSpl.w > 0.0 && uSpl.z < 14.0) { vec2 qs = p - uSpl.xy; float rs = length(qs), an1 = atan(qs.y, qs.x) * 0.159155;
            float anw = an1 + (w1.b - 0.5) * 0.06;                               // never a comb: the fingers are short, bent by the swell and broken by the ripples
            float fing = texture2D(tWave, vec2(anw * 5.0, rs * 0.11 - uSpl.z * 0.22)).b * 0.42 + texture2D(tWave, vec2(anw * 13.0 + 0.3, rs * 0.19 - uSpl.z * 0.31)).b * 0.22 + w2.b * 0.36;
            fm *= mix(1.0, 0.30 + 1.1 * smoothstep(0.28, 0.70, fing), smoothstep(46.0, 30.0, rs) * smoothstep(0.0, 0.5, uSpl.z) * exp(-uSpl.z / 7.0)); }
          if (fm + plip > 0.015) {
            // bubbles: lace in two sizes that slide over each other (the lake's own in the lake's frame, the current's in the current's), so no two metres match
            vec2 pw = p + w1.rg * 1.3 + w2.rg * 0.5; float lA = texture2D(tWave, pw / 2.7 + 0.31).a, lB = texture2D(tWave, vec2(pw.x * 0.62 + pw.y * 0.78, pw.y * 0.62 - pw.x * 0.78) / 4.3 + 0.67).a;
            float inFlow = clamp(fmFlow / max(fm, 1e-3), 0.0, 1.0), lace = mix(max(lA * 0.85, lB), max(fa.a, fb.a * 0.9), inFlow * 0.85), bl = mix(w2.b * 0.50 + w3.b * 0.30 + w1.b * 0.20, fb.b * 0.6 + w3.b * 0.4, inFlow);
            float fs = min(fm, 1.04), solid = smoothstep(1.12 - 0.62 * fs, 1.36 - 0.62 * fs, bl + 0.12), fk = 0.74 * min(fs, 1.0);      // even the thickest white water keeps holes
            float fv = clamp(solid + (1.0 - solid) * 0.85 * smoothstep(0.95 - fk, 1.30 - fk, lace) + plip, 0.0, 1.0);
            // far off a bubble is smaller than a pixel: the foam is then a share of the pixel, not a pattern
            fv = mix(fv, clamp(fs * (0.60 + 0.40 * bl), 0.0, 1.0), max(smoothstep(0.06, 0.40, fwp), 0.55 * inFlow)) * film;
            // white water is not paint: it is heaped (lit by the slope of the heap it lies on and of every ripple), it is bubbles
            // (the lace again, as shade), and where it is thin the jade shows through it
            float heap = clamp(dot(N, SUN_DIR) / ${SUN.y.toFixed(3)}, 0.20, 1.9), thick = clamp(fs - 0.35, 0.0, 1.0) * solid;
            vec3 foamC = vec3(0.86, 0.87, 0.86) * (sunC * 0.90 * heap + vec3(0.36, 0.33, 0.40) * (0.75 + 0.5 * wh)) * (0.44 + 0.38 * lace + 0.30 * bl) * (0.82 + 0.18 * thick);
            foamC = mix(mix(body, foamC, 0.55), foamC, clamp(0.35 + 0.65 * thick + 0.5 * lace, 0.0, 1.0));
            col = mix(col, foamC, fv); }
          col = mix(col, mistC * (0.6 + 0.4 * sunL), 1.0 - exp(-0.016 * mistA / max(V.y, 0.05)));
          if (uDbg > 0.5) { if (uDbg < 1.5) col = vec3(sd * 0.1, depth * 0.2, -sds); else if (uDbg < 2.5) col = texture2D(tMirror, uv0 * uMirK).rgb; else if (uDbg < 3.5) col = texture2D(tBedC, bedUV(p)).rgb; else if (uDbg < 4.5) col = vec3(sun); else if (uDbg < 5.5) col = vec3(fm, ruf * 0.4, cat); else if (uDbg < 6.5) col = vec3(fract(fl.r * 8.0), fract(tau * 0.1), fsp * 0.4); else col = vec3(fmFlow, fmShore, vMac.w); }
          gl_FragColor = vec4(clFog(col, vW, cameraPosition), 1.0); }` });
    const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.renderOrder = 4; return me;
  }

  // ================= waterfalls =================
  // Each fall is water leaving a lip at v0 and falling free: a point that left tau seconds ago is v0 tau out and g tau^2 / 2 down.
  // The mesh is laid out in tau, and the pattern on it is fixed to the moment each strand left the lip, so it speeds up and stretches
  // exactly as falling water does: a glassy tongue at the lip, torn into strands, into spray, into mist at the foot.
  const GRAV = 9.8;
  function placeFalls(L) {
    const out = [], mk = (x, y, z, dx, dz, v0, w0, w1, k, run = 0) => { const T = Math.sqrt(2 * (y - WY) / GRAV); return { x, y, z, dx, dz, v0, w0, w1, k, run, T, wet: true, fx: x + dx * v0 * T, fz: z + dz * v0 * T }; };
    // the main fall: out of the sluice under the gate (35_arch.js builds the arch). It runs 3 m along the culvert floor in the dark,
    // leaves the lip stone (Arch.sluice = { x0, x1, y, z, back } when the hall builder exports it) and falls free
    const sl = (typeof Arch !== 'undefined' && Arch.sluice) || { x0: -2.3, x1: 2.3, y: L.gateY - 4.3, z: L.gateZ + 5.13, back: L.gateZ + 3.1 };
    out.push(mk((sl.x0 + sl.x1) / 2, sl.y, sl.z, 0, 1, 2.6, sl.x1 - sl.x0 - 0.1, 7.0, 1.0, Math.max(0, sl.z - sl.back)));
    // the side falls are put where water would run: walk out from a spot on the terrace to the edge the ground drops away from,
    // start there, and keep the stream only if it clears the rock all the way down and lands in the lake
    for (const c of [{ x: -9.5, z: L.gateZ + 1.5, dx: 0.0, dz: 1.0, w0: 1.1, w1: 1.9, k: 0.55 }, { x: -27.5, z: L.leftLedge.z + 9, dx: 0.10, dz: 0.995, w0: 1.5, w1: 2.5, k: 0.6 }, { x: 24, z: L.rightTer.z + 17, dx: -0.20, dz: 0.98, w0: 1.2, w1: 2.1, k: 0.55 }]) {
      let lip = null, y0 = 0;
      for (let s = 0; s <= 16 && !lip; s += 0.25) { const hh = bedAt(c.x + c.dx * s, c.z + c.dz * s).h, hn = bedAt(c.x + c.dx * (s + 1.3), c.z + c.dz * (s + 1.3)).h; if (hh > 5 && hn < hh - 3.0) { let e = s; while (e < s + 1.4 && bedAt(c.x + c.dx * (e + 0.1), c.z + c.dz * (e + 0.1)).h > hh - 0.7) e += 0.1; lip = e + 0.12; y0 = hh - 0.25; } }
      if (!lip) continue;
      const lx = c.x + c.dx * lip, lz = c.z + c.dz * lip; let ok = null;
      for (let v0 = 1.6; v0 <= 5.2 && !ok; v0 += 0.4) { const f = mk(lx, y0, lz, c.dx, c.dz, v0, c.w0, c.w1, c.k); let clear = true;
        for (let k = 2; k <= 17 && clear; k++) { const tau = f.T * k / 20, b = bedAt(lx + c.dx * v0 * tau, lz + c.dz * v0 * tau); if (b.h > y0 - 0.5 * GRAV * tau * tau + 0.45) clear = false; }
        if (clear) { f.wet = bedAt(f.fx, f.fz).d > 0.2; ok = f; } }                 // wet: it lands in the lake (else on a rock bench: no plunge pool)
      if (ok) out.push(ok);
    }
    return out.slice(0, 4);
  }
  function fallMeshes(scene, fx) {
    const F = S.falls, NU = 22, NV = 46, NL = 3;
    // ---- the sheets ----
    { const nv = F.length * NL * (NU + 1) * (NV + 1), aP = new Float32Array(nv * 3), aO = new Float32Array(nv * 4), aD = new Float32Array(nv * 4), aK = new Float32Array(nv * 4), idx = []; let o = 0;
      F.forEach((f, fi) => { for (let ly = 0; ly < NL; ly++) { const base = o;
        for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) { aP[o * 3] = i / NU * 2 - 1; aP[o * 3 + 1] = Math.pow(j / NV, 0.8); aP[o * 3 + 2] = f.run / f.v0; aO.set([f.x, f.y, f.z, f.w0], o * 4); aD.set([f.dx, f.dz, f.v0, f.T], o * 4); aK.set([f.w1, ly, f.k, fi * 0.37 + ly * 0.11], o * 4); o++; }
        for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const a = base + j * (NU + 1) + i, b = a + 1, c = a + NU + 1, d = c + 1; idx.push(a, c, b, b, c, d); } } });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nv * 3), 3)); g.setAttribute('aP', new THREE.BufferAttribute(aP, 3)); g.setAttribute('aO', new THREE.BufferAttribute(aO, 4)); g.setAttribute('aD', new THREE.BufferAttribute(aD, 4)); g.setAttribute('aK', new THREE.BufferAttribute(aK, 4)); g.setIndex(idx);
      // The falls are drawn on the soft effects layer, after the wet-rock overlay (which would darken them too) and tested by hand against
      // the scene depth. A second copy in the main scene is switched on only while the mirror is drawn, so the lake reflects them.
      const mat = soft => new THREE.ShaderMaterial({ uniforms: soft ? { ...U, ...Post.fxU } : U, fog: false, transparent: true, depthWrite: false, depthTest: !soft, side: THREE.DoubleSide,
        vertexShader: (soft ? '#define SOFT\n' : '') + /* glsl */`attribute vec3 aP; attribute vec4 aO, aD, aK; uniform float uTime, uGust; varying vec3 vW; varying vec4 vQ; varying vec3 vK; varying float vVZ;
          void main(){ float ly = aK.y, tau = aP.y * (aD.w * 1.03 + aP.z) - aP.z, tf = max(tau, 0.0), vf = aD.z * (1.0 + 0.24 * (ly - 1.0) * step(0.0, tau));        // tau < 0: still in the channel behind the lip. Each layer leaves the lip at its own speed: the sheets part as they fall
            float sf = tf / aD.w, wd = mix(aO.w, aK.x, smoothstep(0.0, 1.0, sf)) * (1.0 - 0.10 * ly * step(0.0, tau)), lat = aP.x * 0.5 * wd;
            float wob = (sin(aP.x * 5.0 + tau * 2.3 - uTime * 3.1 + aK.w * 20.0) * 0.10 + sin(aP.x * 11.0 - uTime * 4.3 + tau * 5.0 + ly) * 0.05) * sf;
            vec2 dir = aD.xy, hz = aO.xz + dir * (vf * tau + wob + 0.22 * (1.0 - aP.x * aP.x) * smoothstep(-0.2, 0.3, tau)) + vec2(-dir.y, dir.x) * lat + vec2(${f4(WDV[0])}, ${f4(WDV[1])}) * (uGust * 1.3 * sf * sf * (0.7 + 0.3 * ly));      // a gust leans the whole plume down the wind, the foot most
            vW = vec3(hz.x, max(aO.y + 0.16 - 0.03 * ly - 4.9 * tf * tf, ${f4(WY - 0.05)}), hz.y); vQ = vec4(aP.x, sf, tau, ly); vK = vec3(aP.x * 0.5 * aO.w, aK.z, aK.w);
            vec4 mv = viewMatrix * vec4(vW, 1.0); vVZ = mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: (soft ? '#define SOFT\n' : '') + /* glsl */`${GLSL_NOISE}${GLSL_FOG}
          #include <packing>
          ${GL_SUN}
          #ifdef SOFT
          ${Post.GLSL_FXDEPTH}
          #endif
          uniform sampler2D tWave; uniform float uTime; varying vec3 vW; varying vec4 vQ; varying vec3 vK; varying float vVZ;
          float nz(vec2 uv){ return clamp((texture2D(tWave, uv).b - 0.5) * 2.6 + 0.5, 0.0, 1.0); }
          void main(){ float u = vQ.x, s = vQ.y, ly = vQ.w, tau = vQ.z, k = vK.y, te = uTime - tau * (1.0 + 0.06 * ly) + vK.z * 3.0;
            // ROPES. A lip is never level, so the sheet gathers into ropes that keep their places along it; each rope wanders, splits and
            // thins as it falls and the wet wall shows dark between them. CLOTS ride down every rope. Both are drawn in (metres along the
            // lip, the moment the water left it), so they fall with the water, speed up and stretch as it does. [f_water]
            float x = vK.x + 0.55 * (nz(vec2(vK.x * 0.11 + vK.z * 5.0, te * 0.19 + ly * 0.31)) - 0.5) * s;       // a rope wanders more the farther it has fallen
            float rope = nz(vec2(x * 0.43 + vK.z * 9.0, te * 0.040)), rope2 = nz(vec2(x * 1.21 + 0.37, te * 0.13 + ly * 0.4));
            float clot = nz(vec2(x * 0.62 + ly * 0.43, te * 3.1)), clot2 = nz(vec2(x * 2.1 + ly * 0.17, te * 7.3 + 0.5));
            float edge = 1.0 - pow(abs(u), 2.0 + 4.0 * (1.0 - s)), sun = sunAt(vW), a, white;
            if (tau < 0.0) { a = ly < 0.5 ? 0.93 : 0.0; white = 0.30 * smoothstep(0.55, 0.85, clot2) * smoothstep(-0.9, 0.0, tau); }       // still in the channel: smooth dark water, a few streaks as it gathers speed
            else { float torn = smoothstep(0.04, 0.30, s);                                // 0 = the glassy tongue over the lip (its first metre), 1 = torn water
              float body = rope * 0.60 + rope2 * 0.40 + 0.34 * (clot - 0.5) * torn;
              float th = mix(0.06, mix(0.40, 0.55, s), torn) + 0.06 * ly + (1.0 - edge) * 0.55 + (1.0 - k) * 0.42;      // a thin side fall is a few threads on wet rock
              a = smoothstep(th, th + 0.10, body);
              a *= mix(1.0, smoothstep(0.28, 0.56, clot2 * 0.6 + clot * 0.4), 0.85 * smoothstep(0.50, 1.0, s));              // in the last third the ropes break into beads
              if (ly > 1.5) a += (1.0 - a) * 0.30 * smoothstep(0.30, 1.0, s) * edge * (0.25 + 0.75 * clot) * k;              // one thin veil of spray behind them, thicker toward the foot
              white = torn * clamp(0.50 + 1.5 * (clot - 0.45) + 0.6 * (clot2 - 0.5), 0.22, 1.0); }
            #ifdef SOFT
            a *= softZ(vVZ, 0.4);
            #endif
            if (a < 0.004) discard;
            vec3 sk = ${SUNC} * sun;
            #if ${CLS}
            sk *= clSun(vW);
            #endif
            vec3 lit = sk * (0.80 + 0.55 * clot2) + vec3(0.40, 0.34, 0.37);
            vec3 glass = (vec3(0.030, 0.052, 0.042) + vec3(0.20, 0.155, 0.16) * (0.2 + 0.8 * rope2) * smoothstep(-1.2, 0.3, tau)) * (0.25 + 0.75 * sun);          // the smooth tongue at the lip: dark jade water with the sky on it
            vec3 col = mix(glass, vec3(0.93, 0.93, 0.92) * lit, white);
            gl_FragColor = vec4(clFog(col, vW, cameraPosition), a * mix(0.66, 0.97, white) * mix(0.82, 1.0, k)); }` });
      const me = new THREE.Mesh(g, mat(true)); me.frustumCulled = false; me.renderOrder = 0; fx.add(me); S.sheet = me;
      const mm = new THREE.Mesh(g, mat(false)); mm.frustumCulled = false; mm.renderOrder = 5; mm.visible = false; scene.add(mm); S.only.push(mm); }
    // ---- drops torn off the sheets, and the spray thrown back up at the foot ----
    { const list = []; const r = rng(4107);
      F.forEach((f, fi) => { const nd = Math.round(2000 * f.k * f.w0 / 4.5 + 200), ns = Math.round(800 * f.k * f.w1 / 7 + 80); for (let i = 0; i < nd + ns; i++) list.push([f, i < nd ? 0 : 1]); });
      const n = list.length, g = new THREE.InstancedBufferGeometry(); g.instanceCount = n;
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3)); g.setIndex([0, 1, 2, 1, 3, 2]);
      const aO = new Float32Array(n * 4), aD = new Float32Array(n * 4), aK = new Float32Array(n * 4), aR = new Float32Array(n * 4);
      list.forEach(([f, ty], i) => { aO.set([f.x, f.y, f.z, f.w0], i * 4); aD.set([f.dx, f.dz, f.v0, f.T], i * 4); aK.set([f.w1, f.k, r(), ty], i * 4); aR.set([r(), r(), r(), r()], i * 4); });
      for (const [k, a] of [['aO', aO], ['aD', aD], ['aK', aK], ['aR', aR]]) g.setAttribute(k, new THREE.InstancedBufferAttribute(a, 4));
      const mat = soft => new THREE.ShaderMaterial({ uniforms: soft ? { ...U, ...Post.fxU } : U, fog: false, transparent: true, depthWrite: false, depthTest: !soft, side: THREE.DoubleSide,
        vertexShader: /* glsl */`attribute vec4 aO, aD, aK, aR; uniform float uTime, uGust; varying vec2 vUv; varying float vA, vVZ; varying vec3 vW;
          void main(){ vec2 dir = aD.xy; vec3 d3 = vec3(dir.x, 0.0, dir.y), s3 = vec3(-dir.y, 0.0, dir.x); float T = aD.w, v0 = aD.z, uL = aR.y * 2.0 - 1.0; vec3 p, vel; float al;
            if (aK.w < 0.5) {          // a drop: it leaves the lip with the water and falls free, drifting out of the curtain
              float life = T * (1.0 + 0.10 * aR.w), a = fract(uTime / life + aR.x) * life, wd = mix(aO.w, aK.x, smoothstep(0.0, 1.0, a / T));
              vec3 v = d3 * (v0 * (0.75 + 0.9 * aR.z)) + s3 * ((aR.w - 0.5) * 1.5) + vec3(0.0, (aK.z - 0.35) * 1.3, 0.0);
              p = aO.xyz + s3 * (uL * 0.5 * wd) + v * a; p.y -= 4.9 * a * a; p.xz += vec2(${f4(WDV[0])}, ${f4(WDV[1])}) * (uGust * 1.5 * a * a / (T * T)); vel = v; vel.y -= 9.8 * a;
              al = smoothstep(0.16, 0.50, a / T) * (1.0 - smoothstep(0.97, 1.0, a / life)) * step(${f4(WY)}, p.y);
            } else {                   // the foot: spray thrown back up where the water lands
              float life = 0.55 + 0.75 * aR.w, a = fract(uTime / life + aR.x) * life, an = aR.z * 6.2832;
              vec3 v = vec3(cos(an), 0.0, sin(an)) * (0.6 + 2.8 * aR.w) + d3 * 1.3 + vec3(0.0, 2.2 + 5.8 * aK.z, 0.0);
              p = vec3(aO.x, ${f4(WY)}, aO.z) + d3 * (v0 * T) + s3 * (uL * 0.5 * aK.x) + v * a; p.y -= 4.9 * a * a; vel = v; vel.y -= 9.8 * a;
              al = smoothstep(0.0, 0.05, a) * (1.0 - a / life) * step(${f4(WY - 0.02)}, p.y); }
            // a streak along its flight: what a 1/60 s shutter records
            vec4 mv = viewMatrix * vec4(p, 1.0); vec2 d2 = (viewMatrix * vec4(vel, 0.0)).xy; float sp = length(d2); vec2 dn = sp > 1e-4 ? d2 / sp : vec2(0.0, 1.0);
            float sz = max(0.012 + 0.030 * aR.w * aR.w, -mv.z * 0.00042), len = sz + sp * 0.0085;
            mv.xy += dn * (position.y * 2.0 * len) + vec2(-dn.y, dn.x) * (position.x * 2.0 * sz);
            vUv = position.xy * 2.0; vA = al * aK.y * (0.55 + 0.45 * aR.x); vW = p; vVZ = mv.z; gl_Position = al > 0.003 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0); }`,
        fragmentShader: (soft ? '#define SOFT\n' : '') + /* glsl */`${GLSL_NOISE}${GLSL_FOG}
          #include <packing>
          ${GL_SUN}
          #ifdef SOFT
          ${Post.GLSL_FXDEPTH}
          #endif
          varying vec2 vUv; varying float vA, vVZ; varying vec3 vW;
          void main(){ float d = 1.0 - clamp(length(vUv), 0.0, 1.0), a = d * vA * 1.1;
            #ifdef SOFT
            a *= softZ(vVZ, 0.4);
            #endif
            if (a < 0.01) discard;
            vec3 sk = ${SUNC} * sunAt(vW);
            #if ${CLS}
            sk *= clSun(vW);
            #endif
            gl_FragColor = vec4(clFog(vec3(0.94, 0.93, 0.92) * (sk + vec3(0.42, 0.33, 0.35)), vW, cameraPosition), min(a, 0.9)); }` });
      const me = new THREE.Mesh(g, mat(true)); me.frustumCulled = false; me.renderOrder = 0.5; fx.add(me); S.drops = me;
      const mm = new THREE.Mesh(g, mat(false)); mm.frustumCulled = false; mm.renderOrder = 6; mm.visible = false; scene.add(mm); S.only.push(mm); }
    // ---- spray off the plunge pools: soft puffs born in the boil that climb, travel down the wind and thin out (the soft effects layer).
    //      Each fall keeps a plume standing off its foot; in a gust the plume lies over and runs.
    { const list = []; const r = rng(977); F.forEach(f => { const n = Math.round(64 * f.k * f.w1 / 8 + 10); for (let i = 0; i < n; i++) list.push(f); });
      const n = list.length, g = new THREE.InstancedBufferGeometry(); g.instanceCount = n;
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3)); g.setIndex([0, 1, 2, 1, 3, 2]);
      const aO = new Float32Array(n * 4), aR = new Float32Array(n * 4); list.forEach((f, i) => { aO.set([f.fx, f.fz, f.w1 * 0.5 + 0.8, f.k], i * 4); aR.set([r(), r(), r(), r()], i * 4); });
      g.setAttribute('aO', new THREE.InstancedBufferAttribute(aO, 4)); g.setAttribute('aR', new THREE.InstancedBufferAttribute(aR, 4));
      const m = new THREE.ShaderMaterial({ uniforms: { ...U, ...Post.fxU }, fog: false, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
        vertexShader: /* glsl */`attribute vec4 aO, aR; uniform float uTime, uGust; varying vec2 vUv; varying float vA, vVZ; varying vec3 vR, vW;
          void main(){ float life = 4.2 + 3.2 * aR.w, a = fract(uTime / life + aR.x) * life, lf = a / life, an = aR.y * 6.2832, gk = 0.55 + 1.3 * min(uGust, 1.3);
            vec3 c = vec3(aO.x, ${f4(WY)}, aO.y) + vec3(cos(an), 0.0, sin(an)) * (aO.z * 0.7 * sqrt(aR.z)) + vec3(${f4(WDV[0])}, 0.0, ${f4(WDV[1])}) * (a * (0.9 + 1.5 * aR.w) * gk + 0.10 * a * a * gk)
              + vec3(0.0, 0.4 + a * (0.55 + 0.75 * aR.z) / (1.0 + 0.5 * gk), 0.0) + vec3(sin(a * 1.3 + aR.x * 40.0), 0.0, cos(a * 1.1 + aR.y * 40.0)) * (0.35 * lf);
            float sz = (1.1 + 4.6 * lf) * (0.7 + 0.6 * aR.y) * (0.5 + aO.z * 0.2);
            vec4 mv = viewMatrix * vec4(c, 1.0); mv.xy += position.xy * (2.0 * sz); vVZ = mv.z; vUv = position.xy * 2.0; vR = aR.xyz; vW = c;
            vA = smoothstep(0.0, 0.07, lf) * (1.0 - smoothstep(0.30, 1.0, lf)) * aO.w; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */`${GLSL_NOISE}${GLSL_FOG}${Post.GLSL_FXDEPTH} uniform sampler2D tWave; varying vec2 vUv; varying float vA, vVZ; varying vec3 vR, vW;
          void main(){ float r = length(vUv); if (r > 1.0) discard; float n = texture2D(tWave, vUv * 0.16 + vR.xy).b * 0.6 + texture2D(tWave, vUv * 0.37 + vR.yz).b * 0.4;
            float a = smoothstep(1.0, 0.15, r + (n - 0.5) * 1.1) * (1.0 - r) * vA * softZ(vVZ, 2.5) * smoothstep(3.0, 12.0, -vVZ) * 0.40;
            vec3 c = mix(vec3(0.74, 0.46, 0.44), vec3(1.25, 0.86, 0.70), n);
            #if ${CLS}
            c *= 0.45 + 0.55 * clSun(vW);
            #endif
            gl_FragColor = vec4(c * a, a); }` });
      const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.renderOrder = 1; fx.add(me); S.mist = me; }
  }

  // ================= thrown water =================
  // The lake's own surface can only swell (it is a height field). What LEAVES it is drawn here, and all of it is one kind of thing, a ROPE:
  // water let go from one place over a short time, the first of it fastest. A rope is a ribbon turned to the lens whose every point flies
  // free from the moment it left (its launch speed spent against the air, then gravity), so it is a curve at every instant: thick where it
  // is still leaving the lake, thinner toward its tip, torn across into beads there and everywhere with age. A wall of water is ropes side
  // by side, four to the metre, whose feet overlap; a crown is ropes round a rim; water dragged up a body is ropes round its waterline.
  // BEADS are the drops the tips break into (streaks along their flight); PUFFS are the fine spray that hangs after the water has fallen.
  // Every row of the three tables is made once at load (throwAll); the shaders are closed forms of film time. No mesh edge is ever seen:
  // a rope's outline is cut per pixel from noise that rides the water.
  const TH = { rope: [], bead: [], puff: [], win: [] }, HEADR = 2.3;
  // a rope: from (x, z), from t0 for Te seconds; (vx, vy, vz) the first water's velocity and k its drag (1/s); W its width at the foot (m);
  // tone 0 = white torn water .. 1 = thick jade water; f0 = the last water's share of that velocity; (ox, oz) = how fast its mouth moves
  function mkRope(r, x, z, t0, Te, vx, vy, vz, k, W, tone, f0, ox, oz, y0) { const life = Te + Math.sqrt(Math.max(vy, 2) / (4.9 * k)) + 0.3;
    TH.rope.push(x, z, t0, Te, vx, vy, vz, k, W, r(), tone, f0, ox || 0, oz || 0, y0 || 0.12, life); TH.win.push(t0, t0 + life); return life; }
  function mkBead(r, x, z, t0, vx, vy, vz, k, size, al, y0) { const life = Math.sqrt(Math.max(vy, 1) / (4.9 * k)) + 0.25; TH.bead.push(x, z, t0, size, vx, vy, vz, al, k, y0 || 0.1, r(), life); TH.win.push(t0, t0 + life); }
  function mkPuff(r, x, z, t0, vx, vy, vz, k, size, life, al, y0) { TH.puff.push(x, z, t0, size, vx, vy, vz, k, life, al, y0 || 0.5, r()); TH.win.push(t0, t0 + life); }
  const instGeo = (quad, rows, per, names) => { const n = rows.length / per, g = new THREE.InstancedBufferGeometry(); g.instanceCount = n; g.setAttribute('position', new THREE.Float32BufferAttribute(quad.pos, 3)); g.setIndex(quad.idx);
    names.forEach((k, i) => { const a = new Float32Array(n * 4); for (let q = 0; q < n; q++) for (let c = 0; c < 4; c++) a[q * 4 + c] = rows[q * per + i * 4 + c]; g.setAttribute(k, new THREE.InstancedBufferAttribute(a, 4)); }); return g; };
  const QUAD = { pos: [-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], idx: [0, 1, 2, 1, 3, 2] };
  // Light and haze on thrown water are worked out per VERTEX (it is soft-edged everywhere, nothing in it needs them per pixel; per pixel
  // they were five texture reads on every layer of spray): vS = the sun on white water there (the shadow map and the clouds' shadows in
  // it), vAm = the sky's share, vHz = what the haze does (rgb is added, a multiplies). [f_water]
  const GL_LITV = /* glsl */`${GLSL_NOISE}${GLSL_FOG}
    #include <packing>
    ${GL_SUN}
    varying vec3 vS, vAm; varying vec4 vHz;
    void thLight(vec3 w){ vec3 sc = mix(${SUNC}, vec3(1.0), 0.40) * (0.22 + 0.78 * sunAt(w)); float cs = 1.0;        // thrown water scatters the whole sky: whiter than the foam lying on the lake
      #if ${CLS}
      cs = clSunAt(w); sc *= clSun(w);
      #endif
      vS = sc; vAm = vec3(0.38, 0.35, 0.40) * (0.60 + 0.40 * cs);
      vec3 f0 = clFog(vec3(0.0), w, cameraPosition); vHz = vec4(f0, clFog(vec3(1.0), w, cameraPosition).g - f0.g); }`;
  function ropeMesh(fx) {
    const n = TH.rope.length / 16; G.info.waterRopes = n; if (!n) return;
    const NSEG = 18, pos = [], idx = []; for (let j = 0; j <= NSEG; j++) for (const sd of [-1, 1]) pos.push(sd, j / NSEG, 0);
    for (let j = 0; j < NSEG; j++) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = instGeo({ pos, idx }, TH.rope, 16, ['aO', 'aV', 'aK', 'aM']);
    const m = new THREE.ShaderMaterial({ uniforms: { ...U, ...Post.fxU }, fog: false, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`${GL_LITV}
        attribute vec4 aO, aV, aK, aM; uniform float uTime; varying vec4 vQ; varying vec3 vW, vK; varying float vVZ, vL;
        // where the water that left the mouth at place s of the rope (1 = the first of it, 0 = the last) is now. The first water is the
        // fastest and leans out the most, so a rope is a curve at every instant: steep at its foot, flaring at its top, and all of it falling
        vec3 ropeAt(float s, out float tau, out float tl){ tl = min(aO.z + (1.0 - s) * aO.w, uTime); tau = uTime - tl;          // not let go yet: it is still at the mouth
          float f = mix(aK.w, 1.0, s * s), e = (1.0 - exp(-aV.w * tau)) / aV.w, dt = tl - aO.z, fh = f * mix(0.50, 1.0, s);
          return vec3(aO.x + aM.x * dt + aV.x * fh * e, ${f4(WY)} + aM.z + aV.y * f * e - 4.9 * tau * tau, aO.y + aM.y * dt + aV.z * fh * e); }
        void main(){ float age = uTime - aO.z, tau, tl, t2, l2; if (age <= 0.0 || age >= aM.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float s = position.y; vec3 p = ropeAt(s, tau, tl), q = ropeAt(s + 0.06, t2, l2);
          vec4 mv = viewMatrix * vec4(p, 1.0); vec2 d2 = (viewMatrix * vec4(q - p, 0.0)).xy; float dl = length(d2); vec2 dn = dl > 1e-4 ? d2 / dl : vec2(0.0, 1.0);
          float w = aK.x * (0.55 + 0.45 * pow(1.0 - s, 0.8)) * (1.0 + 1.25 * tau); w = max(w, -mv.z * 0.0010);          // a sheet, not a spike: nearly as wide at its rim as at its foot; it spreads as it flies
          // the air wrings it: a meander that grows as it flies, its own for every rope
          float mea = (sin(s * 5.1 + aK.y * 37.0) + 0.6 * sin(s * 11.3 - aK.y * 61.0)) * 0.30 * aK.x * smoothstep(0.03, 0.5, tau) * s;
          mv.xy += vec2(-dn.y, dn.x) * (position.x * w + mea);
          vec2 sv = (viewMatrix * vec4(${f4(SUN.x)}, ${f4(SUN.y)}, ${f4(SUN.z)}, 0.0)).xy; vL = dot(vec2(-dn.y, dn.x), sv);                 // which side of the rope the sun is on
          vW = p; vQ = vec4(position.x, s, tau, age / aM.w); vK = vec3(aK.z, aK.y, tl - aO.z); vVZ = mv.z; thLight(p); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`${Post.GLSL_FXDEPTH}
        uniform sampler2D tWave; varying vec4 vQ, vHz; varying vec3 vW, vK, vS, vAm; varying float vVZ, vL;
        float nb(vec2 uv){ return clamp((texture2D(tWave, uv).b - 0.5) * 2.3 + 0.5, 0.0, 1.0); }
        void main(){ float u = vQ.x, s = vQ.y, tau = vQ.z, af = vQ.w, tone = vK.x, sd = vK.y; if (vW.y < ${f4(WY - 0.05)}) discard;
          // The picture belongs to the water: it is laid out in the rope's own coordinates (place across it, place along it), so it stretches
          // as the rope does. A rope is a SHEET of water: whole where it leaves the lake; holes open in it toward its rim and everywhere as
          // it flies; its rim is fingers and beads. Its outline is cut from this noise and is never a straight line.
          float p = 1.0 - u * u, n1 = nb(vec2(u * 0.30 + sd * 9.1, s * 0.85 + sd * 5.3)), n2 = nb(vec2(u * 0.85 + sd * 3.3, s * 2.4 - sd * 1.7)), n3 = nb(vec2(u * 1.9 + sd * 2.9, s * 6.5 + sd * 3.7));
          float body = n1 * 0.58 + n2 * 0.42, tear = clamp(0.03 + 0.46 * s * s + 0.80 * smoothstep(0.08, 1.1, tau) + 0.5 * af * af, 0.0, 1.3);
          float a = smoothstep(tear * 0.66 - 0.03, tear * 0.66 + 0.22, body + 0.24 * p);
          a *= mix(1.0, smoothstep(0.34, 0.64, n3 * 0.6 + n2 * 0.4), smoothstep(0.55, 1.0, s + 0.6 * af));                    // its rim is beads
          a *= smoothstep(0.0, 0.34, p + (n2 - 0.5) * 0.40) * (1.0 - smoothstep(0.80, 1.0, s + (n1 - 0.5) * 0.34));           // feathered at the sides, ragged at the end
          a *= smoothstep(0.0, 0.02, tau) * (1.0 - smoothstep(0.80, 1.0, af)) * smoothstep(${f4(WY - 0.05)}, ${f4(WY + 0.25)}, vW.y);
          if (a < 0.015) discard; a *= softZ(vVZ, 1.2); if (a < 0.004) discard;
          float thick = (1.0 - smoothstep(0.0, 0.20, tau + 0.4 * s)) * smoothstep(0.35, 0.8, body) * 0.75 * (1.0 - tone);       // the thick water at the foot is jade against the light for a moment
          // a sheet of water in the air is round and full of drops: its sunward side is lit, the other holds the blue of the shade
          float side = clamp(0.5 + 0.9 * u * vL, 0.0, 1.0);
          vec3 lit = (vS * (0.22 + 0.40 * n2 + 0.46 * side) + vAm) * (0.80 + 0.20 * side);
          vec3 col = mix(vec3(0.84, 0.86, 0.87) * lit, vec3(0.15, 0.33, 0.28) * (0.55 + 0.45 * lit), thick);
          gl_FragColor = vec4(col * vHz.a + vHz.rgb, a * mix(0.93, 0.32, tone)); }` });
    const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.renderOrder = 0.6; me.visible = false; fx.add(me); S.rope = me;
  }
  // drops: each a streak along its flight (what a 1/60 s shutter records), spent against the air like the rope it broke from
  function beadMesh(fx) {
    const n = TH.bead.length / 12; G.info.waterBeads = n; if (!n) return;
    const g = instGeo(QUAD, TH.bead, 12, ['aO', 'aV', 'aD']);
    const m = new THREE.ShaderMaterial({ uniforms: { ...U, ...Post.fxU }, fog: false, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
      vertexShader: /* glsl */`${GL_LITV}
        attribute vec4 aO, aV, aD; uniform float uTime; varying vec2 vUv; varying float vA, vVZ;
        void main(){ float a = uTime - aO.z, life = aD.w; if (a <= 0.0 || a >= life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float ex = exp(-aD.x * a), e = (1.0 - ex) / aD.x; vec3 vel = vec3(aV.x * ex, aV.y * ex - 9.8 * a, aV.z * ex);
          vec3 p = vec3(aO.x + aV.x * e, ${f4(WY)} + aD.y + aV.y * e - 4.9 * a * a, aO.y + aV.z * e);
          float al = smoothstep(0.0, 0.03, a) * (1.0 - smoothstep(life * 0.8, life, a)) * step(${f4(WY)}, p.y);
          vec4 mv = viewMatrix * vec4(p, 1.0); vec2 d2 = (viewMatrix * vec4(vel, 0.0)).xy; float sp = length(d2); vec2 dn = sp > 1e-4 ? d2 / sp : vec2(0.0, 1.0);
          float sz = max(aO.w * (0.55 + 0.5 * a), -mv.z * 0.00065), len = sz + sp * 0.0125;
          mv.xy += dn * (position.y * 2.0 * len) + vec2(-dn.y, dn.x) * (position.x * 2.0 * sz);
          vUv = position.xy * 2.0; vA = al * aV.w * (0.7 + 0.3 * aD.z); vVZ = mv.z; thLight(p); gl_Position = al > 0.003 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0); }`,
      fragmentShader: /* glsl */`${Post.GLSL_FXDEPTH}
        varying vec2 vUv; varying float vA, vVZ; varying vec3 vS, vAm; varying vec4 vHz;
        void main(){ float d = 1.0 - clamp(length(vUv), 0.0, 1.0), a = d * d * (3.0 - 2.0 * d) * vA; if (a < 0.01) discard; a *= softZ(vVZ, 0.4); if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.94, 0.93, 0.92) * (vS + vAm) * vHz.a + vHz.rgb, min(a, 0.88)); }` });
    const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.renderOrder = 0.7; me.visible = false; fx.add(me); S.bead = me;
  }
  // the spray that hangs: soft torn puffs that slow, swell, lean down the wind and thin
  function puffMesh(fx) {
    const n = TH.puff.length / 12; G.info.waterPuffs = n; if (!n) return;
    const g = instGeo(QUAD, TH.puff, 12, ['aO', 'aV', 'aD']);
    const m = new THREE.ShaderMaterial({ uniforms: { ...U, ...Post.fxU }, fog: false, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
      vertexShader: /* glsl */`${GL_LITV}
        attribute vec4 aO, aV, aD; uniform float uTime; varying vec2 vUv; varying float vA, vVZ; varying vec3 vR;
        void main(){ float a = uTime - aO.z, life = aD.x; if (a <= 0.0 || a >= life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float lf = a / life, e = (1.0 - exp(-aV.w * a)) / aV.w;
          vec3 c = vec3(aO.x + aV.x * e, ${f4(WY)} + aD.z + aV.y * e - 0.55 * a * a, aO.y + aV.z * e) + vec3(${f4(WDV[0])}, 0.0, ${f4(WDV[1])}) * (0.9 * a + 0.25 * a * a);
          c.y = max(c.y, ${f4(WY + 0.3)}); float sz = aO.w * (0.45 + 1.5 * pow(lf, 0.6));
          vec4 mv = viewMatrix * vec4(c, 1.0); mv.xy += position.xy * (2.0 * sz); vVZ = mv.z; vUv = position.xy * 2.0; vR = vec3(aD.w, fract(aD.w * 7.31), lf); thLight(c);
          vA = smoothstep(0.0, 0.10, lf) * pow(1.0 - lf, 1.4) * aD.y; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */`${Post.GLSL_FXDEPTH}
        uniform sampler2D tWave; varying vec2 vUv; varying float vA, vVZ; varying vec3 vR, vS, vAm; varying vec4 vHz;
        void main(){ float r = length(vUv); if (r > 1.0) discard; float n = texture2D(tWave, vUv * 0.19 + vR.xy).b * 0.6 + texture2D(tWave, vUv.yx * 0.43 + vR.yx + vR.z * 0.2).b * 0.4;
          float a = smoothstep(1.0, 0.10, r + (n - 0.5) * 1.5) * (1.0 - r) * vA * 0.6 * smoothstep(2.0, 8.0, -vVZ); if (a < 0.004) discard; a *= softZ(vVZ, 2.0);
          vec3 c = vec3(0.90, 0.90, 0.89) * (vS * (0.55 + 0.6 * n) + vAm) * vHz.a + vHz.rgb;
          gl_FragColor = vec4(c * a, a); }` });
    const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.renderOrder = 0.65; me.visible = false; fx.add(me); S.puff = me;
  }
  // The thrown-water meshes are drawn once here, behind the loader, into a target of the effects layer's format: the card builds a
  // mesh's pipeline at its first draw, and that first draw can differ from every later one in the last bit of a few pixels (and stalls
  // a live frame). After this their first frame in the film is like any other.
  function warmThrown(fx) {
    const list = [S.rope, S.bead, S.puff].filter(Boolean); if (!list.length || !G.camera) return;
    const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false }), sc = new THREE.Scene();
    const vis = list.map(m => m.visible), rt0 = R.getRenderTarget(), ac = R.autoClear;
    for (const m of list) { sc.add(m); m.visible = true; }
    try { R.autoClear = true; R.setRenderTarget(rt); R.render(sc, G.camera); R.render(sc, G.camera); } catch (e) { console.warn('water warm skipped', e && e.message); }
    R.setRenderTarget(rt0); R.autoClear = ac;
    list.forEach((m, i) => { fx.add(m); m.visible = vis[i]; }); rt.dispose();
  }
  // ---- what is thrown, and when: built once from the skim tracks (a body ploughing the lake) and the SPLASH ----
  // the plough, column by column: the rail walked at 25 cm steps from where the head comes within reach of the water to where the body
  // leaves it. ta = the moment the HEAD passes (the walls are born at the head), from the rail's own clock, not from the scan's steps
  function ploughCols(d, tr) {
    const v = new THREE.Vector3(), w = new THREE.Vector3(), nd = tr.nodes, cols = []; let s0 = 1e9, s1 = -1e9, ta0 = 1e9; for (const q of nd) { if (q.sr === undefined) return cols; s0 = Math.min(s0, q.sr); s1 = Math.max(s1, q.sr); ta0 = Math.min(ta0, q.ta); }
    const tOf = s => { let lo = ta0 - 3, hi = ta0 + 0.8; if (d.sOf(lo) > s || d.sOf(hi) < s) return -1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (d.sOf(m) < s) lo = m; else hi = m; } return (lo + hi) / 2; };
    const near = s => { d.pathAt(s, v); return v.y - WY - HEADR < 2.2 && overLake(v.x, v.z); };
    let a = s0, b = s1; while (a > s0 - 24 && near(a - 0.25)) a -= 0.25; while (b < s1 + 24 && near(b + 0.25)) b += 0.25;
    for (let s = a; s <= b + 1e-3; s += 0.25) { const ta = tOf(s); if (ta < 0) continue; d.pathAt(s, v); d.pathAt(s + 0.6, w); const hx = w.x - v.x, hz = w.z - v.z, hl = Math.hypot(hx, hz) || 1;
      let rr = HEADR * 0.85, td = ta + 0.35; for (const q of nd) if (Math.abs(q.sr - s) <= 1.3) { rr = Math.max(rr, q.r); td = Math.max(td, q.td); }
      cols.push({ s, x: v.x, y: v.y - WY, z: v.z, ta, td, hx: hx / hl, hz: hz / hl, v: Math.abs(d.sOf(ta + 0.01) - d.sOf(ta - 0.01)) / 0.02, imm: clamp((d.RMAX + 0.3 - (v.y - WY)) / (1.25 * d.RMAX), 0, 1), r: rr }); }
    return cols;
  }
  // the first shore, pile or plinth a wave from (x, z) meets going (dx, dz): metres to it, or -1
  function shoreHit(x, z, dx, dz, L0, L1) { for (let L = L0; L <= L1; L += 0.25) { const px = x + dx * L, pz = z + dz * L; if (px < X0 + 1 || px > X1 - 1 || pz < Z0 + 1 || pz > Z1 - 1) return -1; if (bedAt(px, pz).d < 0.25) return L; } return -1; }
  // how long after a body ploughs past the surge it sends sideways has run L metres (it leaves like a shock and settles to a wave's pace: the
  // lake shader's skim loop holds the same law)
  const surgeR = a => 6.5 * a + 6.0 * (1 - Math.exp(-a / 0.30));
  const surgeT = L => { let lo = 0, hi = 12; for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (surgeR(m) < L) lo = m; else hi = m; } return (lo + hi) / 2; };
  function throwAll(push) {
    const r = rng(5519), seen = new Set();
    // water that slaps a shore: it jumps up the rock and falls back
    const slap = (x, z, nx, nz, t, st) => { const key = Math.round(x / 1.3) + ',' + Math.round(z / 1.3); if (seen.has(key) || st < 0.12) return; seen.add(key);
      const tx = -nz, tz = nx; for (let i = 0; i < 5; i++) { const o = (r() - 0.5) * 1.8, H = (1.0 + 3.6 * r() * r()) * st * 1.7, k = 2.6 + r(), vy = k * (H + 0.4), back = 0.6 + 2.2 * r();
        mkRope(r, x - nx * 0.25 + tx * o, z - nz * 0.25 + tz * o, t + 0.10 * r(), 0.14 + 0.2 * r(), -nx * back + tx * (r() - 0.5) * 3, vy, -nz * back + tz * (r() - 0.5) * 3, k, 0.7 + 0.7 * r(), 0, 0.3);
        for (let b = 0; b < 3; b++) mkBead(r, x - nx * 0.3 + tx * o, z - nz * 0.3 + tz * o, t + 0.16 * r(), -nx * back * 1.5 + tx * (r() - 0.5) * 5, vy * (0.7 + 0.6 * r()), -nz * back * 1.5 + tz * (r() - 0.5) * 5, k * 1.1, 0.05 + 0.08 * r(), 0.9); }
      mkPuff(r, x - nx * 0.6, z - nz * 0.6, t + 0.05, -nx * 1.5, 3.5 * st, -nz * 1.5, 2.0, 1.1 + 1.3 * st, 1.6 + r(), 0.42 * Math.min(1, st * 1.5));
      push(t, 5, 2, x - nx * 0.8, z - nz * 0.8, 0.75 * Math.min(1, st * 1.4), 0.5, 1.3, 5); };
    // ---- a body ploughing the lake ----
    for (const tr of S.tracks) { const C = tr.cols; if (!C || C.length < 10) continue; const n = C.length, ph = r() * 10; let iE = n - 1; while (iE > 4 && C[iE].imm < 0.08) iE--; const E = C[iE];
      let iT = 0; while (iT < n - 6 && C[iT].y > HEADR + 0.05) iT++;                          // the column where the chin meets the water: nothing is thrown before it
      tr.touch = C[iT].ta;
      for (let i = iT; i < n; i++) { const c = C[i], wet = clamp((HEADR + 0.25 - c.y) / 0.5), end = sm(iT - 1, iT + 2, i) * sm(0, 3, n - 1 - i), kv = clamp(c.v / 60, 0.35, 1.2) * (0.75 + 0.25 * c.imm) * end;
        for (const sd of [-1, 1]) { const px = -c.hz * sd, pz = c.hx * sd, ox = c.x + px * c.r * 0.8, oz = c.z + pz * c.r * 0.8;
          // the BOW WALL: thrown up, out and FORWARD as the head passes (water struck at 70 m/s leaves at that speed and is stopped by the air
          // within ten metres), so it stands beside the head as a V and is left hanging behind it. Neighbouring columns throw alike (their
          // ropes lie side by side as one sheet); along the wall the sheet rises and falls in LOBES
          const lob = clamp(0.5 + 0.30 * Math.sin(i * 0.19 + ph + sd) + 0.22 * Math.sin(i * 0.47 + 1.7 * ph - 2 * sd) + 0.10 * (r() - 0.5), 0, 1), H = (7.0 + 8.0 * lob) * kv * wet;
          if (H > 0.9) { const k = 3.8 + 0.5 * r(), vy = k * (H + 0.9), vo = vy * (0.85 + 0.28 * Math.sin(i * 0.31 + 2.3 * ph + sd) + 0.06 * r()), fw = c.v * (0.30 + 0.12 * Math.sin(i * 0.27 + ph) + 0.05 * r()), Te = 0.16 + 0.08 * r(), t0 = c.ta + 0.01 * r(), vx = px * vo + c.hx * fw, vz = pz * vo + c.hz * fw;
            if ((i + (sd > 0 ? 1 : 0)) % 2 === 0) { mkRope(r, ox, oz, t0, Te, vx, vy, vz, k, 1.7 + 0.8 * r(), 0, 0.15 + 0.1 * r(), px * 4, pz * 4);
              const nb = 11 + Math.floor(5 * r()); for (let b = 0; b < nb; b++) { const q = 0.72 + 0.45 * r(); mkBead(r, ox, oz, t0 + Te * r() * 0.7, vx * q + (r() - 0.5) * 6, vy * q * (0.85 + 0.3 * r()), vz * q + (r() - 0.5) * 6, k * (0.8 + 0.5 * r()), 0.05 + 0.12 * r() * r(), 0.9); } }
            if (i % 3 === 1) { const k2 = 7.5 + 1.0 * r(), vo2 = (58 + 22 * Math.sin(i * 0.41 + ph - sd) + 10 * r()) * kv, fw2 = c.v * (0.75 + 0.2 * r()), vy2 = k2 * (1.3 + 2.4 * lob) * kv;                 // the BOW SHEET: low, flat and fast, thrown wide and level with the head: the lens sees the head inside it
              mkRope(r, ox, oz, t0, 0.05 + 0.05 * r(), px * vo2 + c.hx * fw2, vy2, pz * vo2 + c.hz * fw2, k2, 1.6 + 1.0 * r(), 0, 0.15);
              for (let b = 0; b < 5; b++) { const q = 0.75 + 0.4 * r(); mkBead(r, ox, oz, t0 + 0.03 * r(), (px * vo2 + c.hx * fw2) * q + (r() - 0.5) * 6, vy2 * q * (0.8 + 0.6 * r()), (pz * vo2 + c.hz * fw2) * q + (r() - 0.5) * 6, k2 * (0.8 + 0.5 * r()), 0.05 + 0.10 * r() * r(), 0.9); } }
            if (i % 4 === 2) mkPuff(r, ox + px, oz + pz, t0 + 0.08 + 0.15 * r(), vx * 0.25, vy * 0.16, vz * 0.25, 3.0, 1.6 + 1.8 * r(), 1.7 + 0.9 * r(), 0.50 * Math.min(1, kv * 1.3), 1.0); }
          // while the body keeps streaming down the furrow it keeps throwing: lower, thinner, as hard as it slides
          const end2 = sm(0, 5, i) * sm(0, 3, n - 1 - i);
          for (let q = 0; q < 3; q++) { const t = c.ta + 0.10 + 1.6 * r(), vb = tr.speedAt(t); if (r() * 75 > vb || t > c.td) continue; const H2 = (1.0 + 4.6 * r() * r()) * clamp(vb / 60, 0.1, 1.2) * (0.45 + 0.55 * c.imm) * end2; if (H2 < 0.5) continue;
            const k = 4.0 + 1.6 * r(), vy = k * (H2 + 0.5), vo = vy * (0.4 + 0.7 * r()), fw = vb * (0.25 + 0.35 * r());
            mkRope(r, ox, oz, t, 0.08 + 0.10 * r(), px * vo + c.hx * fw, vy, pz * vo + c.hz * fw, k, 0.7 + 0.6 * r(), 0, 0.25);
            for (let b = 0; b < 2; b++) mkBead(r, ox, oz, t + 0.03, (px * vo + c.hx * fw) * 0.9 + (r() - 0.5) * 4, vy * (0.7 + 0.5 * r()), (pz * vo + c.hz * fw) * 0.9 + (r() - 0.5) * 4, k, 0.05 + 0.09 * r(), 0.85); }
          // the surge meets a plinth, a pile, the bank
          if (i % 5 === 3) { const L = shoreHit(c.x, c.z, px, pz, c.r + 1.0, 24); if (L > 0) slap(c.x + px * L, c.z + pz * L, px, pz, c.ta + surgeT(Math.max(0, L - c.r)), clamp(c.v / 60, 0.35, 1.2) * end2 * 1.35 * Math.exp(-L / 15)); } } }
      // FIRST TOUCH: the instant the chin meets the lake a burst leaves flat and very fast to both sides (wider than the head within
      // three frames) and as a fan ahead
      { const c = C[iT], kv = clamp(c.v / 60, 0.35, 1.2);
        for (let i = 0; i < 64; i++) { const wing = i < 40, sd = i & 1 ? 1 : -1, an = wing ? sd * rad(52 + 50 * ((i >> 1) + r()) / 20) : (r() - 0.5) * 3.2, ca = Math.cos(an), sa = Math.sin(an), dx = c.hx * ca - c.hz * sa, dz = c.hz * ca + c.hx * sa, k = wing ? 7.0 + 1.5 * r() : 5.0 + 1.6 * r();
          const H = (wing ? 1.6 + 3.2 * r() : 2.4 + 5.0 * r()) * kv, vy = k * (H + 0.6), vo = (wing ? 62 + 40 * r() : (18 + 34 * r()) * (0.45 + 0.55 * ca)) * kv;
          mkRope(r, c.x + dx * 1.2, c.z + dz * 1.2, c.ta + 0.02 * r(), 0.05 + 0.07 * r(), dx * vo + c.hx * c.v * (wing ? 0.8 : 0.3), vy, dz * vo + c.hz * c.v * (wing ? 0.8 : 0.3), k, (wing ? 1.5 : 0.9) + 0.9 * r(), wing && i % 5 === 0 ? 1 : 0, 0.2);
          for (let b = 0; b < 4; b++) mkBead(r, c.x + dx, c.z + dz, c.ta + 0.04 * r(), (dx * vo + c.hx * c.v * 0.3) * (0.8 + 0.5 * r()) + (r() - 0.5) * 5, vy * (0.6 + 0.6 * r()), (dz * vo + c.hz * c.v * 0.3) * (0.8 + 0.5 * r()) + (r() - 0.5) * 5, k, 0.05 + 0.10 * r() * r(), 0.9); }
        mkPuff(r, c.x, c.z, c.ta + 0.05, c.hx * 14, 6, c.hz * 14, 3.0, 2.6, 1.8, 0.5, 0.8); push(c.ta, 6, 2, c.x + c.hx * 2, c.z + c.hz * 2, 0.9, 1.2, 3.2, 6); }
      // WHERE THE BODY LEAVES THE WATER it drags water up round itself for as long as it keeps sliding: a fountain round its waterline
      // (what the body then sheds higher up is the effects module's)
      for (let i = 0; i < 210; i++) { let t = 0, vb = 0, ok = false; for (let q = 0; q < 5 && !ok; q++) { t = E.ta + 0.02 + 11.8 * Math.pow(r(), 2.4); vb = tr.speedAt(t); ok = r() * 62 < vb + 1; } if (!ok) continue;
        const an = r() * TAU, ca = Math.cos(an), sa = Math.sin(an), R0 = Math.max(1.6, E.r) * (0.85 + 0.3 * r()), H = 0.8 + vb * (0.04 + 0.09 * r()), k = 3.6 + 1.4 * r(), vy = k * (H + 0.4), vo = (2.0 + 6.0 * r()) * clamp(vb / 40, 0.3, 1.2) * k / 3.4;
        mkRope(r, E.x + ca * R0, E.z + sa * R0, t, 0.12 + 0.20 * r(), ca * vo + E.hx * vb * 0.04, vy, sa * vo + E.hz * vb * 0.04, k, 0.6 + 0.6 * r(), 0, 0.3, E.hx * 1.0, E.hz * 1.0);
        for (let b = 0; b < 3; b++) mkBead(r, E.x + ca * R0, E.z + sa * R0, t + 0.08 * r(), ca * vo * 1.2 + (r() - 0.5) * 4, vy * (0.6 + 0.6 * r()), sa * vo * 1.2 + (r() - 0.5) * 4, k, 0.05 + 0.10 * r() * r(), 0.9);
        if (i % 9 === 0) mkPuff(r, E.x + ca * R0, E.z + sa * R0, t + 0.1, ca * 2.5, 2.5 + vb * 0.05, sa * 2.5, 2.2, 1.4 + 1.4 * r(), 1.6 + r(), 0.40 * clamp(vb / 30, 0.25, 1), 1.0); } }
    // ---- the SPLASH: one mass of water. A crown of sheets off the crater's rim as it opens (neighbours alike, so they stand as one wall whose
    //      top is lobes; each leans out, tears and falls back), lower water inside it, a column off the entry, the rebound when the hole closes ----
    const sp = S.splash;
    if (sp) { const T0 = sp.t, NC = 44, ph = [r() * 6, r() * 6, r() * 6];
      for (let i = 0; i < NC; i++) { const th = (i + 0.5 * (r() - 0.5)) / NC * TAU, dx = Math.cos(th), dz = Math.sin(th);
        const rg = clamp(0.5 + 0.30 * Math.sin(th * 3 + ph[0]) + 0.22 * Math.sin(th * 5 + ph[1]) + 0.14 * Math.sin(th * 9 + ph[2]) + 0.12 * (r() - 0.5), 0, 1), H = 7 + 15 * rg;
        const k = 2.5 + 0.4 * r(), vy = k * (H + 2.2), vo = vy * Math.tan(rad(36 - 20 * rg + 5 * (r() - 0.5))), Te = 0.24 + 0.10 * r(), t0 = T0 + 0.015 + 0.05 * r(), r0 = 2.6 + 0.8 * r(), dr = 15 + 4 * r();
        mkRope(r, sp.x + dx * r0, sp.z + dz * r0, t0, Te, dx * vo, vy, dz * vo, k, 2.0 + 0.9 * r(), 0, 0.18 + 0.12 * r(), dx * dr, dz * dr);
        const nb = 12 + Math.floor(6 * r()); for (let b = 0; b < nb; b++) { const q = 0.70 + 0.42 * r(), tb = t0 + Te * 0.7 * r(); mkBead(r, sp.x + dx * (r0 + dr * (tb - t0)), sp.z + dz * (r0 + dr * (tb - t0)), tb, dx * vo * q + (r() - 0.5) * 5, vy * q * (0.85 + 0.3 * r()), dz * vo * q + (r() - 0.5) * 5, k * (0.85 + 0.5 * r()), 0.06 + 0.15 * r() * r(), 0.9); }
        if (i % 2 === 0) mkPuff(r, sp.x + dx * (r0 + 4), sp.z + dz * (r0 + 4), T0 + 0.12 + 0.3 * r(), dx * vo * 0.22, vy * 0.20, dz * vo * 0.22, 2.2, 2.2 + 2.2 * r(), 2.0 + 1.2 * r(), 0.50, 1.2); }
      for (let i = 0; i < 30; i++) { const th = r() * TAU, dx = Math.cos(th), dz = Math.sin(th), H = 2.5 + 9 * r() * r(), k = 3.0 + 1.2 * r(), vy = k * (H + 0.8), vo = vy * Math.tan(rad(16 + 32 * r())), r0 = 4 + 5.5 * r();
        mkRope(r, sp.x + dx * r0, sp.z + dz * r0, T0 + 0.06 + 0.30 * r(), 0.12 + 0.16 * r(), dx * vo, vy, dz * vo, k, 0.9 + 0.8 * r(), 0, 0.25, dx * 5, dz * 5); }
      for (let i = 0; i < 26; i++) { const th = (i + r()) / 26 * TAU, dx = Math.cos(th), dz = Math.sin(th), H = 13 + 17 * r() * r(), k = 2.5 + 0.7 * r(), vy = k * (H + 3.0), vo = vy * Math.tan(rad(2 + 8 * r())), r0 = 0.4 + 2.8 * r(), Te = 0.26 + 0.22 * r(), t0 = T0 + 0.03 + 0.10 * r();
        mkRope(r, sp.x + dx * r0, sp.z + dz * r0, t0, Te, dx * vo, vy, dz * vo, k, 1.5 + 1.1 * r(), 0, 0.26 + 0.14 * r(), dx * 3, dz * 3);
        for (let b = 0; b < 10; b++) { const q = 0.7 + 0.42 * r(); mkBead(r, sp.x + dx * r0, sp.z + dz * r0, t0 + Te * 0.6 * r(), dx * vo * q + (r() - 0.5) * 6, vy * q, dz * vo * q + (r() - 0.5) * 6, k * (0.85 + 0.5 * r()), 0.06 + 0.16 * r() * r(), 0.9); }
        if (i % 2 === 0) mkPuff(r, sp.x + dx * r0, sp.z + dz * r0, t0 + 0.10 + 0.25 * r(), dx * 2, vy * (0.12 + 0.2 * r()), dz * 2, 2.2, 2.6 + 2.2 * r(), 2.2 + 1.2 * r(), 0.50, 2.0); }
      for (let i = 0; i < 14; i++) { const th = r() * TAU, dx = Math.cos(th), dz = Math.sin(th), H = 5 + 8 * r(), k = 2.6 + 0.8 * r(), vy = k * (H + 1.2), vo = vy * Math.tan(rad(8 * r())), r0 = 1.4 * r();
        mkRope(r, sp.x + dx * r0, sp.z + dz * r0, T0 + 0.82 + 0.25 * r(), 0.22 + 0.16 * r(), dx * vo, vy, dz * vo, k, 1.1 + 0.8 * r(), 0, 0.3); }                 // the hole closes: the rebound
      // the ring leaves the rim and meets every islet, pile and shore in turn (8 m/s once it is clear of the crater)
      for (let i = 0; i < 90; i++) { const th = (i + r()) / 90 * TAU, dx = Math.cos(th), dz = Math.sin(th), L = shoreHit(sp.x, sp.z, dx, dz, 3, 38); if (L < 0) continue;
        slap(sp.x + dx * L, sp.z + dz * L, dx, dz, T0 + (L < 10.3 ? 0.06 + 0.043 * L : 0.5 + (L - 10.3) / 8), 1.5 * Math.exp(-L / 24)); } }
    // the windows in which anything is in the air, merged
    const w = []; for (let i = 0; i < TH.win.length; i += 2) w.push([TH.win[i] - 0.05, TH.win[i + 1] + 0.05]); w.sort((a, b) => a[0] - b[0]); const out = [];
    for (const q of w) { if (out.length && q[0] <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], q[1]); else out.push(q); } S.thWin = out;
    G.info.waterThrown = [TH.rope.length / 16, TH.bead.length / 12, TH.puff.length / 12, out.map(q => q[0].toFixed(1) + '-' + q[1].toFixed(1)).join(' ')];
  }

  // ================= small things =================
  // maple leaves on the lake. Two in three ride the current: each has a streamline and a place along it, and is carried from the foot
  // of a fall down the lake at the water's own speed (the streamline table, tStream). The rest lie in still water and turn slowly.
  // All of them ride whatever wave passes under them.
  function floatLeaves(scene) {
    const r = rng(6021), FL = S.flow, nDrift = FL && FL.rows ? 640 : 0, nStill = 300, n = nDrift + nStill, aC = new Float32Array(n * 4), aD = new Float32Array(n * 4), aR = new Float32Array(n * 4); let k = 0;
    // rafts: leaves gather, so they are dealt out in clusters along the streamlines that run longest
    if (nDrift) { let cr = 0, cc = 0; for (let i = 0; i < nDrift; i++) { if (i % 9 === 0) { cr = FL.long[Math.floor(r() * FL.long.length)]; cc = r() * (FL.NT - 1); }
      const row = clamp(Math.round(cr + (r() + r() - 1) * 1.6), 0, FL.rows - 1), col = (cc + (r() + r() - 1) * 9 + FL.NT - 1) % (FL.NT - 1);
      aC.set([0, 0, r(), 0.17 + 0.17 * r()], k * 4); aD.set([1, row, col, 0], k * 4); k++; } }
    let tries = 0; while (k < n && tries++ < 20000) { const x = lerp(-38, 54, r()), z = lerp(-8, 84, r()), b = bedAt(x, z); if (b.d < 0.5) continue; if (r() > (b.d < 5 ? 0.9 : 0.12)) continue; aC.set([x, z, r(), 0.15 + 0.14 * r()], k * 4); aD.set([0, 0, 0, 0], k * 4); k++; }
    const g = new THREE.InstancedBufferGeometry(); g.instanceCount = k;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3)); g.setIndex([0, 1, 2, 1, 3, 2]);
    for (let i = 0; i < n * 4; i++) aR[i] = r();
    g.setAttribute('aC', new THREE.InstancedBufferAttribute(aC, 4)); g.setAttribute('aD', new THREE.InstancedBufferAttribute(aD, 4)); g.setAttribute('aR', new THREE.InstancedBufferAttribute(aR, 4));
    const m = new THREE.ShaderMaterial({ uniforms: U, fog: false, side: THREE.DoubleSide, alphaToCoverage: true,
      vertexShader: /* glsl */`${GL_MACRO}
        uniform sampler2D tStream; attribute vec4 aC, aD, aR; varying vec2 vUv; varying vec3 vW; varying float vT;
        void main(){ float ph = aC.z, vis = 1.0; vec2 p0;
          if (aD.x > 0.5) {         // riding the current: its place along its streamline moves on one column every ${f4(FLOW_DT)} s
            float c = mod(aD.z + uTime * ${f4(1 / FLOW_DT)}, ${f4(FLOW_NT - 1)}), c0 = floor(c); ivec2 i0 = ivec2(int(c0), int(aD.y + 0.5));
            vec4 s0 = texelFetch(tStream, i0, 0), s1 = texelFetch(tStream, i0 + ivec2(1, 0), 0); vec2 dv = s1.xy - s0.xy; float dl = length(dv);
            p0 = mix(s0.xy, s1.xy, c - c0) + (dl > 1e-4 ? vec2(-dv.y, dv.x) / dl : vec2(0.0)) * ((aR.z - 0.5) * 2.6 * smoothstep(0.0, 24.0, c))
               + vec2(cos(uTime * 0.31 * (0.5 + aR.x) + ph * 6.283), sin(uTime * 0.27 * (0.5 + aR.y) + ph * 9.1)) * 0.22;
            vis = mix(s0.z, s1.z, c - c0) * smoothstep(2.0, 12.0, c); }
          else p0 = aC.xy + vec2(cos(uTime * 0.07 * (0.5 + aR.x) + ph * 6.283), sin(uTime * 0.06 * (0.5 + aR.y) + ph * 9.1)) * (0.25 + 0.9 * aR.z);
          vec2 g, rc; float foam, h = wkMacro(p0, g, foam, rc); p0 -= g * 0.6;                    // it slides down the face of a passing wave
          float ang = ph * 6.283 + uTime * 0.11 * (aR.w - 0.5) + 0.4 * sin(uTime * 0.23 + ph * 20.0), sz = aC.w * vis * (1.0 - smoothstep(0.5, 1.2, rc.y));      // white water swallows it
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y)), ax = normalize(cross(N, vec3(sin(ang), 0.0, cos(ang)))), az = cross(ax, N);
          vec3 w = vec3(p0.x, ${f4(WY + 0.02)} + h + 0.05 * dot(position.xy, position.xy) * sz, p0.y) + (ax * position.x + az * position.y) * sz;
          vW = w; vUv = position.xy + 0.5; vT = aR.x; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
      fragmentShader: /* glsl */`${GLSL_NOISE}${GLSL_FOG}
        #include <packing>
        ${GL_SUN}
        uniform sampler2D tLeaf; varying vec2 vUv; varying vec3 vW; varying float vT;
        void main(){ vec4 t = texture2D(tLeaf, vUv); if (t.a < 0.4) discard;
          vec3 base = t.rgb * mix(vec3(0.85, 0.62, 0.55), vec3(1.15, 1.10, 0.62), step(0.72, vT)) * 0.82;      // wet: a shade darker than on the tree
          vec3 sc = ${SUNC} * sunAt(vW);
          #if ${CLS}
          sc *= clSun(vW);
          #endif
          gl_FragColor = vec4(clFog(base * (sc * 0.80 + vec3(0.30, 0.25, 0.32)), vW, cameraPosition), 1.0); }` });
    const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.renderOrder = 5; scene.add(me); S.leaves = me; S.skip.push(me);
  }
  // the rock just above the waterline is wet: a dark band drawn over the finished picture, placed with the scene depth and the bed map
  function wetBand(fx) {
    const g = new THREE.BoxGeometry(X1 - X0, 1.2, Z1 - Z0); g.translate((X0 + X1) / 2, WY + 0.5, (Z0 + Z1) / 2);
    const m = new THREE.ShaderMaterial({ uniforms: { ...U, ...Post.fxU }, fog: false, transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
      blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendEquation: THREE.AddEquation,
      vertexShader: 'void main(){ gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`uniform sampler2D tDepth, tBed, tWave; uniform vec2 uRes; uniform mat4 uCamPI, uCamW; uniform vec4 uSpl;
        ${GL_BEDUV}
        void main(){ vec2 suv = gl_FragCoord.xy / uRes; float d = texture2D(tDepth, suv).x; if (d >= 1.0) discard;
          vec4 v = uCamPI * vec4(suv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec3 wp = (uCamW * vec4(v.xyz / v.w, 1.0)).xyz; float y = wp.y - ${f4(WY)};
          if (y < 0.012 || y > 1.1) discard; vec4 bed = texture2D(tBed, bedUV(wp.xz)); if (bed.g > 0.22 || bed.g < -3.0) discard;       // open water is not rock; rock far from any water stays dry
          float n = texture2D(tWave, wp.xz / 3.3 + wp.y * 0.21).b, top = 0.20 + 0.30 * n + 0.45 * uSpl.w * smoothstep(0.6, 3.0, uSpl.z) * exp(-uSpl.z / 9.0);
          float band = (1.0 - smoothstep(top * 0.45, top, y)) * smoothstep(-3.0, -1.5, bed.g);
          gl_FragColor = vec4(mix(vec3(1.0), vec3(0.50, 0.52, 0.57), band * 0.85), 1.0); }` });
    const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.renderOrder = -5; fx.add(me); S.wet = me;
    // the rock a fall wets: dark behind and beside the stream, darker toward the foot where the spray is thick (same kind of overlay)
    const boxes = S.falls.map(f => { const reach = f.v0 * f.T, b = new THREE.BoxGeometry(f.w1 + 7, f.y - WY + 1.5, reach + 14); b.translate(f.x + f.dx * (reach - 10) / 2, (f.y + WY) / 2 + 0.6, f.z + f.dz * (reach - 10) / 2); return b; });
    if (!boxes.length) return;
    const fl = U.uFallL.value, fd = U.uFallD.value; S.falls.forEach((f, i) => { fl.set([f.x, f.y, f.z, f.w0], i * 4); fd.set([f.dx, f.dz, f.v0, f.T], i * 4); });
    const m2 = new THREE.ShaderMaterial({ uniforms: { ...U, ...Post.fxU }, fog: false, transparent: true, depthTest: false, depthWrite: false, side: THREE.BackSide,
      blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendEquation: THREE.AddEquation,
      vertexShader: 'void main(){ gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`uniform sampler2D tDepth, tWave, tBed; uniform vec2 uRes; uniform mat4 uCamPI, uCamW; uniform vec4 uFallL[4], uFallD[4];
        ${GL_BEDUV}
        void main(){ vec2 suv = gl_FragCoord.xy / uRes; float d = texture2D(tDepth, suv).x; if (d >= 1.0) discard;
          vec4 v = uCamPI * vec4(suv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec3 wp = (uCamW * vec4(v.xyz / v.w, 1.0)).xyz; float wet = 0.0;
          if (wp.y < 1.5 && texture2D(tBed, bedUV(wp.xz)).g > 0.22) discard;                    // the lake itself is not rock
          for (int i = 0; i < 4; i++) { vec4 l = uFallL[i], dd = uFallD[i]; if (dd.w < 0.01) continue; vec2 q = wp.xz - l.xz; float along = dot(q, dd.xy), lat = abs(dot(q, vec2(-dd.y, dd.x))), drop = l.y - wp.y;
            if (drop < -0.2 || wp.y < ${f4(WY + 0.02)}) continue; float reach = dd.z * sqrt(2.0 * max(drop, 0.0) / 9.8), wd = l.w * 0.5 + 0.8 + 0.13 * drop;       // where the stream is at this height
            wet = max(wet, smoothstep(wd, wd * 0.4, lat) * smoothstep(reach + 2.2, reach + 0.2, along) * smoothstep(-11.0, -5.0, along) * smoothstep(-0.2, 1.2, drop) * (0.50 + 0.50 * smoothstep(0.0, l.y, drop))); }
          if (wet < 0.01) discard; wet *= 0.62 + 0.38 * texture2D(tWave, vec2(wp.x + wp.z, wp.y * 0.12) * 0.35).b;
          gl_FragColor = vec4(mix(vec3(1.0), vec3(0.47, 0.50, 0.55), wet * 0.85), 1.0); }` });
    const me2 = new THREE.Mesh(mergeGeos(boxes), m2); me2.frustumCulled = false; me2.renderOrder = -5; fx.add(me2); S.wet2 = me2;
  }

  // ================= the dragons in the water: an event table built once =================
  // Both bodies are posed through the whole film at load (Dragon.spine(t) is pure and touches no mesh). Wherever a body crosses the
  // surface, hangs just over it or passes low above it, a row goes into the table: t0, life, kind, x, z and four numbers.
  // update(t) hands the rows alive at t to the lake shader with their ages; every wave is a closed form of that age.
  // a skim track for the lake shader: at most ten points along it (x, z, when the body reached it, when the last of it left, strength,
  // half width), plus every node as found, for the spray
  function mkTrack(run, name, sks, d) {
    const n = run.length, K = Math.min(10, n); let pts = [];
    for (let i = 0; i < K; i++) { const a = Math.round(i * (n - 1) / (K - 1)), lo = Math.max(0, a - 1), hi = Math.min(n - 1, a + 1); let sv = 0, rv = 0; for (let q = lo; q <= hi; q++) { sv = Math.max(sv, run[q].s); rv = Math.max(rv, run[q].r); }
      pts.push([run[a].x, run[a].z, run[a].ta, run[a].td, clamp(sv * clamp((run[a].v || 30) / 30, 0.6, 1.8), 0.12, 1.8), Math.max(rv, 0.4)]); }
    let t0 = 1e9, t1 = -1e9; for (const q of run) { t0 = Math.min(t0, q.ta); t1 = Math.max(t1, q.td); }
    // how fast the body was sliding through the furrow, moment by moment (it may plough, slow, lie still and be torn out again)
    const sp = []; for (let i = 0; i < sks.length; i += 2) if (sks[i] >= t0 - 0.1 && sks[i] <= t1 + 0.1) sp.push(sks[i], sks[i + 1]);
    const speedAt = t => { if (sp.length < 2 || t < sp[0] - 0.15 || t > sp[sp.length - 2] + 0.15) return 0; let lo = 0, hi = sp.length / 2 - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (sp[m * 2] <= t) lo = m; else hi = m; }
      if (sp[hi * 2] - sp[lo * 2] > 0.35) return t - sp[lo * 2] < 0.1 ? sp[lo * 2 + 1] : 0; return lerp(sp[lo * 2 + 1], sp[hi * 2 + 1], clamp((t - sp[lo * 2]) / Math.max(1e-3, sp[hi * 2] - sp[lo * 2]))); };
    // the plough column by column (when the body's rail is known): the lake's wake is then laid along it with the head's own clock
    const cols = d ? ploughCols(d, { nodes: run }) : []; let spd = speedAt;
    if (cols.length >= 10) { const c0 = cols[0], c1 = cols[cols.length - 1], KP = 8; pts = []; t0 = Math.min(t0, c0.ta);
      for (let i = 0; i < KP; i++) { const c = cols[Math.round(i * (cols.length - 1) / (KP - 1))]; pts.push([c.x, c.z, c.ta, c.td, clamp((0.40 + 0.60 * c.imm) * clamp(c.v / 30, 0.6, 1.8), 0.12, 1.8), Math.max(c.r, 0.4)]); }
      spd = t => Math.max(speedAt(t), t >= c0.ta && t <= c1.ta + 0.25 ? c0.v : 0); }                 // the head is already ploughing before the scan's first sample
    return { name, t0, t1: t1 + 12.5, pts, nodes: run, sp, speedAt: spd, cols };
  }
  function fillSkim(t) {
    const A = U.uSkA.value, B = U.uSkB.value; let n = 0;
    for (let k = S.tracks.length - 1; k >= 0; k--) { const tr = S.tracks[k]; if (t < tr.t0 || t > tr.t1 || n + 3 > NSK) continue;
      if (n > 0) { for (let c = 0; c < 4; c++) { A[n * 4 + c] = 0; B[n * 4 + c] = 0; } n++; }                       // a gap between two tracks
      const pts = tr.pts, room = NSK - n, K = Math.min(pts.length, room), act = clamp(tr.speedAt(t) / 24, 0, 1.4);
      for (let i = 0; i < K; i++) { const q = pts[K === pts.length ? i : Math.round(i * (pts.length - 1) / (K - 1))]; A[n * 4] = q[0]; A[n * 4 + 1] = q[1]; A[n * 4 + 2] = q[2]; A[n * 4 + 3] = q[3]; B[n * 4] = q[4]; B[n * 4 + 1] = q[5]; B[n * 4 + 2] = act; B[n * 4 + 3] = 0; n++; } }
    U.uNS.value = n;
  }
  function scanDragons() {
    const ev = [], push = (t0, life, kind, x, z, b0, b1, b2, b3) => { ev.push(t0, life, kind, x, z, b0, b1, b2, b3); };
    const F = Film.T, A = Film.A; S.low = []; S.splash = null; S.tracks = [];
    if (typeof Dragon === 'undefined' || !Dragon.list) { S.splash = { t: F.SPLASH, x: A.splash.x, z: A.splash.z }; return ev; }
    const v = new THREE.Vector3(), heads = [], all = []; let fine = 0;
    for (const d of Dragon.list) { const low = new Float32Array(Math.ceil(Film.DUR * 10) + 2).fill(99); S.low.push(low);
      if (!d.spine || !d.C || !d.pathAt || !d.sOf || !d.rProf) continue;
      // 1. coarse: the rail alone, ten times a second
      for (let i = 0; i < low.length; i++) { const s0 = d.sOf(i / 10); let mn = 99;
        for (let a = 0; a <= d.LEN; a += 5) { d.pathAt(s0 - a, v); if (v.x > X0 && v.x < X1 && v.z > Z0 && v.z < Z1) mn = Math.min(mn, v.y - d.RMAX * d.rProf(a) - WY); } low[i] = mn; }
      // 2. fine: the posed spine, twenty times a second, wherever the body comes within reach of the lake
      const srcs = [], skim = new Map(), sks = []; let lastGust = -9, lastHover = -9;
      for (let i = 0; i < low.length && fine < 2200; i++) { const lo = Math.min(low[i], low[Math.min(low.length - 1, i + 1)], low[Math.max(0, i - 1)]); if (lo > 44) continue;
        for (let k = 0; k < (lo < 14 ? 2 : 1); k++) { const t = i / 10 + k * 0.05; d.spine(t); fine++; if (d.st.vis < 0.5) continue;
          const C = d.C, NS = d.NS; let py = C[1] - WY, lowB = 99, lx = 0, lz = 0, lr = 0, cross = false;
          for (let j = 1; j <= NS; j++) { const y = C[j * 3 + 1] - WY, r = d.RMAX * d.rProf(d.LEN * j / NS);
            if (py * y < 0 && r > 0.3) { const f = py / (py - y), k3 = (j - 1) * 3, x = lerp(C[k3], C[k3 + 3], f), z = lerp(C[k3 + 2], C[k3 + 5], f);
              if (overLake(x, z)) { let s = null; for (const q of srcs) if (t - q.te < 0.3 && Math.hypot(q.x - x, q.z - z) < 5) { s = q; break; }
                if (!s) { s = { x, z, r, ts: t, te: t, head: j < NS * 0.07 ? (py < 0 ? 1 : 2) : 0 }; srcs.push(s); } cross = true; s.te = t; s.x = lerp(s.x, x, 0.15); s.z = lerp(s.z, z, 0.15); s.r = Math.max(s.r, r); } }
            if ((j & 3) === 0 && y - r > 0.05 && y - r < lowB && overLake(C[j * 3], C[j * 3 + 2])) { lowB = y - r; lx = C[j * 3]; lz = C[j * 3 + 2]; lr = r; }
            py = y; }
          // a body DRAGGING along the surface: partly in the water, its line near level there (a dive goes through steeply and is a crossing
          // above). The rail is fixed in the world and the body slides along it, so the place is named by its distance along the rail.
          if (lo < 6) { const sH = d.sOf(t), vNow = Math.abs(d.st.speed); let any = false; for (let j = 2; j < NS; j += 2) { const y = C[j * 3 + 1] - WY, r = d.RMAX * d.rProf(d.LEN * j / NS); if (r < 0.22 || y > r + 0.3 || y < -1.2 * r) continue;
            const dx = C[j * 3 + 3] - C[j * 3 - 3], dy = C[j * 3 + 4] - C[j * 3 - 2], dz = C[j * 3 + 5] - C[j * 3 - 1], hl = Math.hypot(dx, dz); if (Math.abs(dy) > 0.45 * hl) continue;
            const x = C[j * 3], z = C[j * 3 + 2]; if (!overLake(x, z)) continue;
            // how much of it is in the water (0 just touching .. 1 half under or more), and how wide a channel it cuts at the waterline
            const key = Math.round((sH - d.LEN * j / NS) / 2.5), imm = clamp((r + 0.3 - y) / (1.25 * r), 0.08, 1), hw = Math.abs(y) < r ? Math.sqrt(r * r - y * y) : 0.6 * r; let nd = skim.get(key);
            if (!nd) { nd = { x, z, ta: t, td: t, s: 0, r: 0, hx: -dx / (hl || 1), hz: -dz / (hl || 1), v: vNow, sr: key * 2.5 }; skim.set(key, nd); }
            nd.td = t + 0.05; nd.s = Math.max(nd.s, 0.30 + 0.70 * imm); nd.r = Math.max(nd.r, hw); any = true; }
            if (any) sks.push(t, vNow); }
          // air shoved down onto the water by a body passing low: a gust footprint that lands a moment later, spreads and fades
          if (!cross && lowB < 40 && t - lastGust >= 0.25) { lastGust = t; const kk = Math.pow(1 - lowB / 40, 1.5) * clamp(Math.abs(d.st.speed) / 45, 0.15, 1.5); if (kk > 0.03) push(t + lowB / 30, 3.2, 3, lx, lz, 1.9 * kk, 3.0, 4 + lowB * 0.45 + lr, 3.2); }
          // a tail or belly hanging within a metre and a half of the surface: small rings, twice a second
          if (!cross && lowB < 1.6 && t - lastHover >= 0.4) { lastHover = t; push(t, 3.5, 0, lx, lz, 0.035 + 0.02 * lr, 1.3, 0.9, 3.5); }
        } }
      for (const s of srcs) { all.push(s); if (s.head === 1) heads.push(s); }
      G.info['water_' + d.name] = srcs.length;
      // SKIM tracks: every place along this dragon's rail where the body dragged along the surface (see the fine pass), in rail order
      { const keys = Array.from(skim.keys()).sort((a, b) => a - b); let run = [];
        const close = () => { if (run.length >= 2) { const len = Math.hypot(run[run.length - 1].x - run[0].x, run[run.length - 1].z - run[0].z); if (len > 3) S.tracks.push(mkTrack(run, d.name, sks, d)); } else if (run.length === 1) push(run[0].ta, 6, 0, run[0].x, run[0].z, 0.22 * run[0].s, 3.6, 2.6, 6); run = []; };
        for (let q = 0; q < keys.length; q++) { if (q > 0 && keys[q] - keys[q - 1] > 2) close(); run.push(skim.get(keys[q])); } close(); }
    }
    // SPLASH: the crater sits between the two heads as they go in (no dive, no crater)
    const hs = heads.filter(s => Math.abs(s.ts - F.SPLASH) < 1.2);
    if (hs.length) { let x = 0, z = 0, t = 1e9; for (const s of hs) { x += s.x; z += s.z; t = Math.min(t, s.ts); } const sp = S.splash = { t: Math.abs(t - F.SPLASH) < 0.35 ? F.SPLASH - 0.045 : t, x: x / hs.length, z: z / hs.length };
      // the ring reaches the cliffs and comes back: a ring from the splash's mirror image behind each wall (the wall is found on the bed map),
      // started early enough that its front meets the outgoing one at the rock
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { let run = 0, hit = -1; for (let q = 2; q < 90 && hit < 0; q += 0.5) { run = bedAt(sp.x + dx * q, sp.z + dz * q).h > 5.5 ? run + 0.5 : 0; if (run >= 3) hit = q - 3; }
        if (hit > 4) push(sp.t - 3.2, 15, 0, sp.x + dx * 2 * hit, sp.z + dz * 2 * hit, 2.4, 6.0, 5.0, 15); } }
    for (const s of all) { const dur = s.te - s.ts, big = s.head ? 1.1 : 0.6, rr = clamp(s.r / 3.4, 0.2, 1.2), sp = S.splash;
      if (!(sp && Math.abs(s.ts - sp.t) < 1.0 && Math.hypot(s.x - sp.x, s.z - sp.z) < 14)) push(s.ts, 7, 0, s.x, s.z, 0.42 * big * rr, 4.4, 4.2, 7);     // it breaks the surface: one ring leaves (at the SPLASH itself the crater and the effects module's ring are that ring)
      if (dur > 0.2) push(s.ts + 0.15, dur + 9, 1, s.x, s.z, 0.085 * rr, 3.0, 2.3, dur);           // while it slides through: a steady train of rings
      push(s.te, 6, 0, s.x, s.z, 0.24 * rr, 3.6, 3.0, 6);                                          // the hole closes behind it
      push(s.ts + 0.1, dur + 11, 2, s.x, s.z, 0.62, 0.40, s.r + 1.8, dur + 11); }                  // churned foam, spreading and thinning for ten seconds after
    if (Q.has('wskim')) { const T0 = +Q.get('wskim') || 6, run = [], ax = -15, az = 70, bx = 10, bz = 24, L = Math.hypot(bx - ax, bz - az), v = 36;
      for (let q = 0; q <= L; q += 2.5) { const f = q / L, x = lerp(ax, bx, f) + 3.5 * Math.sin(f * 3.1), z = lerp(az, bz, f); if (overLake(x, z)) run.push({ x, z, ta: T0 + q / v, td: T0 + q / v + 2.4, s: 1.0 * sm(0, 0.12, f) * (1 - sm(0.85, 1, f)) + 0.15, r: 2.1, hx: (bx - ax) / L, hz: (bz - az) / L, v }); }
      if (run.length > 2) { const sk = []; for (let q = 0; q <= 80; q++) sk.push(T0 + q * 0.05, v * (q < 30 ? 1 : Math.max(0.1, 1 - (q - 30) / 30))); S.tracks.push(mkTrack(run, 'test', sk)); } }
    // what a skim does besides its wake: the first touch and the last send a ring each, and the air it drags ruffles the water ahead
    for (const tr of S.tracks) { const a = tr.nodes[0], b = tr.nodes[tr.nodes.length - 1]; push(a.ta, 7, 0, a.x, a.z, 0.30 * a.s + 0.08, 4.2, 3.4, 7); push(b.td, 7, 0, b.x, b.z, 0.26 * b.s + 0.06, 3.8, 3.0, 7); }
    G.info.waterSkim = S.tracks.map(tr => [tr.name, +tr.t0.toFixed(2), +(tr.t1 - 12.5).toFixed(2), tr.nodes.length, +tr.pts[0][0].toFixed(1), +tr.pts[0][1].toFixed(1), +tr.pts[tr.pts.length - 1][0].toFixed(1), +tr.pts[tr.pts.length - 1][1].toFixed(1)].join(' '));
    throwAll(push);
    G.info.waterFine = fine; return ev;
  }
  function fillEvents(t) {
    const ev = S.ev, ea = U.uEA.value, eb = U.uEB.value; let n = 0;
    for (let i = 0; i < S.nev; i++) { const o = i * 9, age = t - ev[o]; if (age < 0 || age >= ev[o + 1]) continue;
      let k = n;
      if (n >= NEV) { let wi = -1, wv = ev[o + 5] * (1 - age / ev[o + 1]) * (ev[o + 2] === 1 ? 4 : 1);                // full: the faintest row gives way
        for (let j = 0; j < NEV; j++) { const u = eb[j * 4] * (1 - ea[j * 4 + 2] / S.lifeOf[j]) * (ea[j * 4 + 3] === 1 ? 4 : 1); if (u < wv) { wv = u; wi = j; } }
        if (wi < 0) continue; k = wi; } else n++;
      ea[k * 4] = ev[o + 3]; ea[k * 4 + 1] = ev[o + 4]; ea[k * 4 + 2] = age; ea[k * 4 + 3] = ev[o + 2]; eb[k * 4] = ev[o + 5]; eb[k * 4 + 1] = ev[o + 6]; eb[k * 4 + 2] = ev[o + 7]; eb[k * 4 + 3] = ev[o + 8]; S.lifeOf[k] = ev[o + 1]; }
    U.uNE.value = n;
  }
  // where a body crosses the surface THIS frame (foam collar and a raised rim round it), and where one hangs just over it (a pressed furrow)
  function collars(t) {
    const cw = U.uColW.value, pr = U.uPress.value; cw.fill(0); pr.fill(0); let nc = 0, np = 0;
    if (typeof Dragon === 'undefined' || !Dragon.list) return;
    for (let i = 0; i < 6; i++) if (fxU.uCol.value[i].w > 0.002) nc = 6;                       // the effects module is drawing the collars this frame: not twice
    const li = clamp(Math.round(t * 10), 0, Math.ceil(Film.DUR * 10));
    for (let di = 0; di < Dragon.list.length; di++) { const d = Dragon.list[di], low = S.low[di]; if (!low || !d.C || d.st.vis < 0.05 || low[li] > 9) continue;
      const C = d.C, NS = d.NS; let py = C[1] - WY, b1 = 99, x1 = 0, z1 = 0, r1 = 0;
      for (let j = 1; j <= NS; j++) { const y = C[j * 3 + 1] - WY, r = d.RMAX * d.rProf(d.LEN * j / NS);
        if (py * y < 0 && r > 0.2 && nc < 6) { const f = py / (py - y), k3 = (j - 1) * 3, x = lerp(C[k3], C[k3 + 3], f), z = lerp(C[k3 + 2], C[k3 + 5], f); if (overLake(x, z)) { cw[nc * 4] = x; cw[nc * 4 + 1] = z; cw[nc * 4 + 2] = r * 1.05; cw[nc * 4 + 3] = d.st.vis; nc++; } }
        if ((j & 7) === 0 && y - r > 0.05 && y - r < b1 && overLake(C[j * 3], C[j * 3 + 2])) { b1 = y - r; x1 = C[j * 3]; z1 = C[j * 3 + 2]; r1 = r; }
        py = y; }
      if (b1 < 4.5 && np < 4) { const k = 1 - b1 / 4.5; pr[np * 4] = x1; pr[np * 4 + 1] = z1; pr[np * 4 + 2] = r1 * 1.6 + 1.5; pr[np * 4 + 3] = 0.45 * k * k * clamp(r1 / 2, 0.1, 1) * d.st.vis; np++; }
    }
  }

  // ================= the mirror =================
  const mP = new THREE.Vector3(), mL = new THREE.Vector3(), mRot = new THREE.Matrix4(), mPlane = new THREE.Plane(), mClip = new THREE.Vector4(), mQ = new THREE.Vector4(), mN = new THREE.Vector3(0, 1, 0), mO = new THREE.Vector3(0, WY, 0);
  const mBias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  const lv = new THREE.Vector4();
  // how far up the picture the lake reaches (0 = bottom edge, 1 = top), from a few hundred points of open water; < 0 when none is in frame
  function lakeTop(cam, lift) { const pts = S.pts; let top = -1; lv.w = 1;
    for (let i = 0; i < pts.length; i += 2) { lv.set(pts[i], WY + lift, pts[i + 1], 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix); if (lv.w < 0.3) continue;
      const x = lv.x / lv.w, y = lv.y / lv.w; if (x < -1.1 || x > 1.1 || y < -1.0) continue; if (y > top) top = y; }
    return top < -1 ? -1 : top * 0.5 + 0.5; }
  function renderMirror(t) {
    const cam = G.camera, scene = G.scene;
    const lt = lakeTop(cam, U.uSpl.value.w > 0 && U.uSpl.value.z < 4 ? 1.2 : 0.5), sd = U.uSpl.value.w > 0 ? U.uSpl.value.z : -1;
    // while the pool is white water seen from above (the splash, a lens more than 6 to 11 m up) there is nothing for the valley to be mirrored
    // in: the mirror fades out over the first half second, is not drawn at all, and fades back in as the foam drifts apart. A lens low
    // over the water keeps its mirror throughout
    const wgt = sm(0.03, 0.07, lt) * (1 - (sd >= 0 ? sm(0.10, 0.50, sd) * (1 - sm(2.6, 3.3, sd)) * sm(6, 11, cam.position.y - WY) : 0)); U.uMirW.value = wgt; S.lt = lt;
    if (wgt <= 0.002) { U.uMirW.value = 0; return false; }                                  // no water in frame, or a sliver at its edge: no mirror this frame (the shader fades to haze)
    const top = Math.min(1, lt + 0.09), k = clamp(1.3 - 2.0 * top, 0.55, 1) * (U.uSpl.value.w > 0 && U.uSpl.value.z < 3.5 ? 0.85 : 1);       // looking down on the lake the mirror is faint (Fresnel) and fills the frame, and at the splash the surface is torn up: draw it smaller
    const W0 = Math.max(2, Math.round(Post.W * MSCALE)), H0 = Math.max(2, Math.round(Post.H * MSCALE)); if (rtM.width !== W0 || rtM.height !== H0) rtM.setSize(W0, H0);
    const w = Math.max(2, Math.round(W0 * k)), h = Math.max(2, Math.round(H0 * k)); U.uMirK.value.set(w / W0, h / H0); U.uMirPx.value.set(1 / W0, 1 / H0);
    // the lens, reflected in the lake
    mP.setFromMatrixPosition(cam.matrixWorld); mRot.extractRotation(cam.matrixWorld);
    mL.set(0, 0, -1).applyMatrix4(mRot).add(mP); mL.y = 2 * WY - mL.y;
    mcam.position.set(mP.x, 2 * WY - mP.y, mP.z); mcam.up.set(0, 1, 0).applyMatrix4(mRot); mcam.up.y = -mcam.up.y; mcam.lookAt(mL);
    mcam.near = cam.near; mcam.far = cam.far; mcam.updateMatrixWorld(true); mcam.matrixWorldInverse.copy(mcam.matrixWorld).invert(); mcam.projectionMatrix.copy(cam.projectionMatrix);
    U.uTexM.value.multiplyMatrices(mBias, mcam.projectionMatrix).multiply(mcam.matrixWorldInverse);
    // its near plane becomes the water surface (Lengyel's oblique frustum): nothing under the lake gets into the mirror
    mPlane.setFromNormalAndCoplanarPoint(mN, mO).applyMatrix4(mcam.matrixWorldInverse); mClip.set(mPlane.normal.x, mPlane.normal.y, mPlane.normal.z, mPlane.constant);
    const pe = mcam.projectionMatrix.elements; mQ.x = (Math.sign(mClip.x) + pe[8]) / pe[0]; mQ.y = (Math.sign(mClip.y) + pe[9]) / pe[5]; mQ.z = -1; mQ.w = (1 + pe[10]) / pe[14];
    mClip.multiplyScalar(2 / mClip.dot(mQ)); pe[2] = mClip.x; pe[6] = mClip.y; pe[10] = mClip.z + 1 - 0.003; pe[14] = mClip.w;
    mcam.projectionMatrixInverse.copy(mcam.projectionMatrix).invert(); U.uMPI.value.copy(mcam.projectionMatrixInverse);
    // which dragons can be in the rows of the mirror the lake reads (their posed spines against the reflected lens)
    if (typeof Dragon !== 'undefined' && Dragon.list) { const me = mcam.matrixWorldInverse.elements, yTop = 2 * top - 1;
      for (let di = 0; di < Dragon.list.length; di++) { const d = Dragon.list[di]; let seen = false;
        if (d.C && d.st.vis >= 0.05) { const C = d.C, NS = d.NS, pad = d.RMAX * 2.4 + 2.5;
          for (let j = 0; j <= NS && !seen; j += 3) { const x = C[j * 3], y = C[j * 3 + 1], z = C[j * 3 + 2]; if (y < WY - pad) continue;
            const vx = me[0] * x + me[4] * y + me[8] * z + me[12], vy = me[1] * x + me[5] * y + me[9] * z + me[13], vz = me[2] * x + me[6] * y + me[10] * z + me[14], w = -vz; if (w < 0.3 - pad) continue;
            const ww = Math.max(w, 0.3), mx = pad * pe[0] / ww, my = pad * pe[5] / ww, nx = (pe[0] * vx + pe[8] * vz) / ww, ny = (pe[5] * vy + pe[9] * vz) / ww;
            if (w < pad || (Math.abs(nx) < 1 + mx && ny > -1 - my && ny < yTop + my)) seen = true; } }
        S.dskip[di] = !seen || (U.uSpl.value.w > 0 && U.uSpl.value.z > 0.12 && U.uSpl.value.z < 3.2 && top > 0.45); } }      // while the pool is white water seen from above there is nothing to mirror them in
    for (let i = 0; i < S.skip.length; i++) { S.skipV[i] = S.skip[i].visible; S.skip[i].visible = false; }
    for (let i = 0; i < S.only.length; i++) S.only[i].visible = true;
    // while the pool is white water seen from above (the splash) the trees have nothing to be mirrored in: only the rock, the halls and the sky are drawn
    const torn = U.uSpl.value.w > 0 && U.uSpl.value.z > 0.12 && U.uSpl.value.z < 3.2 && top > 0.45;
    if (K.prox) for (let i = 0; i < S.prox.length; i++) S.prox[i].visible = !torn || !!S.prox[i].userData.wStand;
    Sky.update(mcam, t);                                         // the sky draws itself from the lens it is given: handed back to the real one right after
    // A point of the lake sits at the same height in the mirror's picture as in the lens's: only the rows up to the lake's far shore
    // (plus room for the waves' bend) are ever read, so only those are drawn. The rest of the target is cleared, never stale.
    const rows = Math.min(h, Math.ceil(h * top)); U.uMirTop.value = Math.max(0.01, rows / h - 0.035);
    const rt0 = R.getRenderTarget(); rtM.scissorTest = false; R.setRenderTarget(rtM); R.clear(); rtM.scissorTest = true; rtM.scissor.set(0, 0, w, rows); rtM.viewport.set(0, 0, w, h); R.setRenderTarget(rtM); R.render(scene, mcam); R.setRenderTarget(rt0); Sky.update(cam, t);
    for (let i = 0; i < S.skip.length; i++) S.skip[i].visible = S.skipV[i];
    for (let i = 0; i < S.only.length; i++) S.only[i].visible = false;
    for (let i = 0; i < S.prox.length; i++) S.prox[i].visible = false;
    mirrorOK = true; mirT = t; return true;
  }

  // Trees far up the valley cannot be seen in the lake. For every big instanced mesh the mirror draws a stand-in that holds only the
  // instances standing near the water (same geometry, same material), and the original is skipped for that one draw: its instance count
  // is set to zero in onBeforeRender and put back in onAfterRender, so its shadow pass, which runs in the same render call, is untouched.
  function mirrorProxies(scene) {
    const jobs = [], live = new Set(); let n0 = 0, n1 = 0;
    if (typeof Dragon !== 'undefined' && Dragon.list) for (const d of Dragon.list) for (const m of d.meshes || []) m.traverse(o => live.add(o));
    // an instance can show in the lake only if it stands near the water, or low enough over it that a ray leaving the surface at a
    // shallow angle meets it (seen from above, where steep rays reach high things, the mirror is a few percent of the picture)
    const near = (x, y, z) => { if (x < X0 - 16 || x > X1 + 16 || z < Z0 - 34 || z > Z1 + 6) return false; const d = -bedAt(clamp(x, X0 + 0.5, X1 - 0.5), clamp(z, Z0 + 0.5, Z1 - 0.5)).d + Math.max(0, X0 - x, x - X1, Z0 - z, z - Z1);
      return d < 9 ? y < 46 : d < 30 && y - WY < 5 + 0.75 * d; };
    scene.traverse(o => { if (!o.isInstancedMesh || !o.visible || o.count < 2 || live.has(o) || S.skip.indexOf(o) >= 0 || o.instanceMatrix.usage === THREE.DynamicDrawUsage) return; const g = o.geometry, per = (g.index ? g.index.count : g.attributes.position.count) / 3; if (per * o.count < 6000) return;
      const m = o.instanceMatrix.array, keep = []; o.updateMatrixWorld(); const e = o.matrixWorld.elements;
      for (let i = 0; i < o.count; i++) { const k = i * 16, x = m[k + 12] + e[12], y = m[k + 13] + e[13], z = m[k + 14] + e[14]; if (near(x, y, z)) keep.push(i); }
      n0 += o.count * per; n1 += keep.length * per; if (keep.length > o.count * 0.85) return; jobs.push([o, keep]); });
    for (const [o, keep] of jobs) {
      if (keep.length) { let g = o.geometry; const sub = (a, sz) => { const out = new a.array.constructor(keep.length * sz); for (let j = 0; j < keep.length; j++) for (let c = 0; c < sz; c++) out[j * sz + c] = a.array[keep[j] * sz + c]; return out; };
        if (Object.values(g.attributes).some(a => a.isInstancedBufferAttribute)) { const g2 = new THREE.BufferGeometry(); g2.setIndex(g.index); for (const k of Object.keys(g.attributes)) { const a = g.attributes[k]; g2.setAttribute(k, a.isInstancedBufferAttribute ? new THREE.InstancedBufferAttribute(sub(a, a.itemSize), a.itemSize, a.normalized, a.meshPerAttribute) : a); } g2.groups = g.groups; g2.boundingSphere = g.boundingSphere; g = g2; }
        const p = new THREE.InstancedMesh(g, o.material, keep.length); p.instanceMatrix.array.set(sub(o.instanceMatrix, 16)); if (o.instanceColor) p.instanceColor = new THREE.InstancedBufferAttribute(sub(o.instanceColor, o.instanceColor.itemSize), o.instanceColor.itemSize);
        p.position.copy(o.position); p.quaternion.copy(o.quaternion); p.scale.copy(o.scale); p.frustumCulled = false; p.castShadow = false; p.receiveShadow = o.receiveShadow; p.renderOrder = o.renderOrder; p.visible = false; (o.parent || scene).add(p); S.prox.push(p); }
      const ob = o.onBeforeRender, oa = o.onAfterRender;
      o.onBeforeRender = function (r, sc, cam) { if (cam === mcam && K.prox) { this.userData.wCount = this.count; this.count = 0; } ob.apply(this, arguments); };
      o.onAfterRender = function (r, sc, cam) { if (cam === mcam && K.prox) this.count = this.userData.wCount; oa.apply(this, arguments); }; }
    // The rock is one mesh of 1.35 M triangles. The lens in the lake (always under the water, somewhere under the lake's rectangle) can
    // never see a face that looks up or away from the lake, nor one under water: the mirror draws a stand-in with only the faces it can see
    // (same vertices and material, its own index list), and the rock itself skips the mirror's colour pass.
    let rk0 = 0, rk1 = 0;
    scene.traverse(o => { if (!o.isMesh || o.isInstancedMesh || o.material !== Rock.mat || !o.geometry.index || o.userData.wStand) return; const g = o.geometry, ix = g.index.array, P = g.attributes.position.array, nt = ix.length / 3; if (nt < 200000) return;
      o.updateMatrixWorld(); const e = o.matrixWorld.elements; if (Math.abs(e[0] - 1) + Math.abs(e[5] - 1) + Math.abs(e[10] - 1) + Math.abs(e[12]) + Math.abs(e[13]) + Math.abs(e[14]) > 1e-6) return;
      const out = new Uint32Array(ix.length), bx0 = X0 - 6, bx1 = X1 + 6, bz0 = Z0 - 6, bz1 = Z1 + 14, by0 = -75, by1 = WY; let n = 0;
      const tri = (i0, i1, i2) => { const a = i0 * 3, b = i1 * 3, c = i2 * 3, ax = P[a], ay = P[a + 1], az = P[a + 2];
        if (ay < WY - 0.4 && P[b + 1] < WY - 0.4 && P[c + 1] < WY - 0.4) return;
        const ux = P[b] - ax, uy = P[b + 1] - ay, uz = P[b + 2] - az, vx = P[c] - ax, vy = P[c + 1] - ay, vz = P[c + 2] - az, nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        // the farthest corner of the lens's box along the face normal: in front of the face, or the face is never seen
        if (nx * ((nx > 0 ? bx1 : bx0) - ax) + ny * ((ny > 0 ? by1 : by0) - ay) + nz * ((nz > 0 ? bz1 : bz0) - az) <= 0) return;
        out[n++] = i0; out[n++] = i1; out[n++] = i2; };
      // The rock is laid out as grids (30_rock.js surf(): rows of quads, six indices each). Each grid is found again in the index list and
      // thinned for the mirror: full detail only in the band the waterline cuts, a quarter of the faces above it, a sixteenth high up
      let q = 0; const L = ix.length;
      while (q < L) { const a0 = ix[q], flip = q + 5 < L && ix[q + 1] !== a0 + 1, W = q + 5 < L ? (flip ? ix[q + 1] : ix[q + 2]) - a0 : 0, nu = W - 1; let nq = 0;
        if (nu >= 2 && (flip ? ix[q + 2] : ix[q + 1]) === a0 + 1) while (q + 6 * nq + 5 < L && ix[q + 6 * nq] === a0 + Math.floor(nq / nu) * W + (nq % nu) && ix[q + 6 * nq + (flip ? 1 : 2)] === ix[q + 6 * nq] + W) nq++;
        const nv = nu >= 2 ? Math.floor(nq / nu) : 0;
        if (nv < 2) { tri(ix[q], ix[q + 1], ix[q + 2]); q += 3; continue; }                 // not a grid: the face as it is
        const vy = (i, j) => P[(a0 + j * W + i) * 3 + 1];
        const quad = (i, j, di, dj) => { const a = a0 + j * W + i, b = a + di, c = a + dj * W, d = c + di; if (flip) { tri(a, c, b); tri(b, c, d); } else { tri(a, b, c); tri(b, d, c); } };
        const lowest = (i, j, di, dj) => { let m = 1e9; for (let jj = j; jj <= j + dj; jj++) for (let ii = i; ii <= i + di; ii++) m = Math.min(m, vy(ii, jj)); return m; };
        for (let j = 0; j < nv; j += 4) for (let i = 0; i < nu; i += 4) { const di = Math.min(4, nu - i), dj = Math.min(4, nv - j);
          if (lowest(i, j, di, dj) > WY + 16) { quad(i, j, di, dj); continue; }
          for (let j2 = j; j2 < j + dj; j2 += 2) for (let i2 = i; i2 < i + di; i2 += 2) { const d2i = Math.min(2, i + di - i2), d2j = Math.min(2, j + dj - j2);
            if (lowest(i2, j2, d2i, d2j) > WY + 3.2) quad(i2, j2, d2i, d2j); else for (let j3 = j2; j3 < j2 + d2j; j3++) for (let i3 = i2; i3 < i2 + d2i; i3++) quad(i3, j3, 1, 1); } }
        q += nu * nv * 6; }
      rk0 += nt; rk1 += n / 3; if (n > ix.length * 0.9) return;
      const g2 = new THREE.BufferGeometry(); for (const k of Object.keys(g.attributes)) g2.setAttribute(k, g.attributes[k]); g2.setIndex(new THREE.BufferAttribute(out.slice(0, n), 1)); g2.boundingSphere = g.boundingSphere; g2.boundingBox = g.boundingBox;
      const p = new THREE.Mesh(g2, o.material); p.userData.wStand = true; p.frustumCulled = false; p.castShadow = false; p.receiveShadow = o.receiveShadow; p.renderOrder = o.renderOrder; p.visible = false; (o.parent || scene).add(p); S.prox.push(p);
      const ob = o.onBeforeRender, oa = o.onAfterRender;
      o.onBeforeRender = function (r, sc, cam, geo) { if (cam === mcam && K.prox) geo.setDrawRange(0, 0); ob.apply(this, arguments); };
      o.onAfterRender = function (r, sc, cam, geo) { if (cam === mcam && K.prox) geo.setDrawRange(0, Infinity); oa.apply(this, arguments); }; });
    // a dragon whose body is nowhere in the rows of the mirror the lake reads skips the mirror's colour pass (its shadow pass, in the
    // same render call, is untouched); S.dskip[i] is set each frame from its posed spine
    if (typeof Dragon !== 'undefined' && Dragon.list) Dragon.list.forEach((d, di) => { for (const m of d.meshes || []) m.traverse(o => { if (!o.isMesh) return; const ob = o.onBeforeRender, oa = o.onAfterRender;
      if (o.isInstancedMesh) { o.onBeforeRender = function (r, sc, cam) { if (cam === mcam && S.dskip[di]) { this.userData.wCount = this.count; this.count = 0; } ob.apply(this, arguments); };
        o.onAfterRender = function (r, sc, cam) { if (cam === mcam && S.dskip[di]) this.count = this.userData.wCount; oa.apply(this, arguments); }; }
      else { o.onBeforeRender = function (r, sc, cam, geo) { if (cam === mcam && S.dskip[di]) geo.setDrawRange(0, 0); ob.apply(this, arguments); };
        o.onAfterRender = function (r, sc, cam, geo) { if (cam === mcam && S.dskip[di]) geo.setDrawRange(0, Infinity); oa.apply(this, arguments); }; } }); });
    G.info.waterMirrorTris = [Math.round(n0 / 1000), Math.round(n1 / 1000), jobs.length, Math.round(rk0 / 1000), Math.round(rk1 / 1000)];
  }

  // ================= build =================
  async function build(scene, fx, tick) {
    const t0 = performance.now(); R = G.R; const L = Rock.L;
    fxU.uFall.value.set(0, 0, L.gateZ + 6.5);
    scene.traverse(o => { if (o.isPointLight) S.lights0.push(o); });
    U.tWave.value = waveTex(); U.tLeaf.value = (typeof Flora !== 'undefined' && Flora.T && Flora.T.leaf) || null;
    const bm = bedMaps(scene); U.tBed.value = bm.bed; U.tBedC.value = bm.col;
    { const pts = []; for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) { const x = lerp(X0, X1, (i + 0.5) / 40), z = lerp(Z0, Z1, (j + 0.5) / 40); if (bedAt(x, z).d > 0) pts.push(x, z); } S.pts = new Float32Array(pts); }
    G.info.waterBake = Math.round(performance.now() - t0); if (tick) await tick();
    const t1 = performance.now();
    const ev = scanDragons(); S.ev = new Float32Array(ev); S.nev = ev.length / 9; S.lifeOf = new Float32Array(NEV).fill(1);
    G.info.waterScan = Math.round(performance.now() - t1); G.info.waterEvents = S.nev; if (tick) await tick();
    rtM = new THREE.WebGLRenderTarget(Math.max(2, Math.round(Post.W * MSCALE)), Math.max(2, Math.round(Post.H * MSCALE)), { type: THREE.HalfFloatType, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, depthTexture: new THREE.DepthTexture(4, 4) });
    rtM.depthTexture.minFilter = rtM.depthTexture.magFilter = THREE.NearestFilter;
    U.tMirror.value = rtM.texture; U.tMirrorZ.value = rtM.depthTexture; mcam = new THREE.PerspectiveCamera();
    lake = lakeMesh(); scene.add(lake); S.skip.push(lake);
    S.falls = placeFalls(L); const uf = U.uFalls.value; S.falls.forEach((f, i) => { uf[i * 4] = f.fx; uf[i * 4 + 1] = f.fz; uf[i * 4 + 2] = f.w1 * 0.5 + 0.9; uf[i * 4 + 3] = f.wet ? f.k : 0; });
    G.info.waterFalls = S.falls.map(f => [f.x, f.y, f.z, f.v0, f.fx, f.fz].map(x => +x.toFixed(1)).join(' ') + (f.wet ? '' : ' dry'));
    { const tf = performance.now(); flowBake(); G.info.waterFlowMs = Math.round(performance.now() - tf); }
    fallMeshes(scene, fx); if (U.tLeaf.value) floatLeaves(scene); ropeMesh(fx); beadMesh(fx); puffMesh(fx); warmThrown(fx);
    if (Q.has('wwet')) wetBand(fx);            // the rock's own shader now draws the wet band at the waterline and the spray stains under the falls (30_rock.js); this overlay is for a rock without them
    // what the mirror leaves out: big instanced ground cover that casts no shadow (the grass). Everything that casts a shadow stays,
    // because the shadow map is refreshed inside the mirror's render call
    scene.traverse(o => { if (o.isInstancedMesh && !o.castShadow && (o.userData.thin || o.count * (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3 > 60000)) S.skip.push(o); });
    mirrorProxies(scene);
    G.info.waterMs = Math.round(performance.now() - t0);
    if (!registered) { registered = true; G.tick.push(() => { if (registered === true) { registered = 2; G.tick.push(update); } }); }
  }

  // ================= per frame =================
  const lw = new THREE.Vector3(); let lightTries = 0;
  function update(t) {
    fillEvents(t); fillSkim(t); collars(t);
    const sp = S.splash;
    if (sp && t >= sp.t && t < sp.t + 20) { const d = t - sp.t; U.uSpl.value.set(sp.x, sp.z, d, 1); U.uRain.value.set(sp.x, sp.z, 28, sm(0.5, 1.3, d) * (1 - sm(4.0, 8.0, d))); } else { U.uSpl.value.w = 0; U.uRain.value.w = 0; }
    { let on = false; const w = S.thWin; if (w) for (let i = 0; i < w.length && !on; i++) on = t >= w[i][0] && t <= w[i][1]; if (S.rope) S.rope.visible = on && K.rope; if (S.bead) S.bead.visible = on && K.bead; if (S.puff) S.puff.visible = on && K.puff; }
    { const bw = U.uBow.value; bw.w = 0; for (const tr of S.tracks) { const C = tr.cols; if (!C || C.length < 10 || t < C[0].ta || t > C[C.length - 1].ta + 0.12) continue; let i = 0; while (i < C.length - 1 && C[i + 1].ta <= t) i++;
        const c = C[i], c2 = C[Math.min(C.length - 1, i + 1)], f = c2.ta > c.ta ? clamp((t - c.ta) / (c2.ta - c.ta)) : 0, kv = clamp(c.v / 60, 0.3, 1.2) * sm(C[0].ta, C[0].ta + 0.05, t) * (1 - sm(C[C.length - 1].ta, C[C.length - 1].ta + 0.12, t));
        bw.set(lerp(c.x, c2.x, f) + c.hx * 3.2, lerp(c.z, c2.z, f) + c.hz * 3.2, 3.4, 1.35 * kv); } }
    U.uCamPI.value.copy(G.camera.projectionMatrixInverse); U.uCamW.value.copy(G.camera.matrixWorld);
    // lights the ripples catch: the storm, and the effects module's one point light (fire, lightning, the beam, the blast)
    if (!light && lightTries < 4) { lightTries++; light = (typeof FX !== 'undefined' && FX.light) || null; if (!light) G.scene.traverse(o => { if (o.isPointLight && !light && S.lights0.indexOf(o) < 0) light = o; }); }
    if (light && light.intensity > 0.01) { light.getWorldPosition(lw); U.uLight.value.set(lw.x, lw.y, lw.z, light.intensity); U.uLightC.value.set(light.color.r, light.color.g, light.color.b); } else U.uLight.value.w = 0;
    if (G.storm && G.storm.intensity > 0.001) { lw.copy(G.storm.position).sub(G.storm.target.position).normalize(); U.uStorm.value.set(lw.x, lw.y, lw.z, G.storm.intensity); } else U.uStorm.value.w = 0;
    // the mirror. Capture mode: every frame, and the sun's shadow map is refreshed inside this render call (the main pass then reuses it).
    // Live: at most every other frame, and on frames the shadow map rests, so the two never land on the same frame.
    if (K.mirror) { const sh = R.shadowMap; fc++;
      if (CAPTURE || sh.autoUpdate) { sh.autoUpdate = false; sh.needsUpdate = true; renderMirror(t); }
      else if ((!sh.needsUpdate && fc - mirF >= 2) || !mirrorOK || Math.abs(t - mirT) > 0.09) { if (renderMirror(t)) mirF = fc; } }
    const ss = G.sun && G.sun.shadow; if (ss && ss.map) { U.tShadow.value = ss.map.texture; U.uShadowM.value.copy(ss.matrix); U.uShadowOn.value = 1; U.uShadowPx.value.x = 1 / ss.map.width; }
  }
  return { build, update, fxU, WY, bedAt, U, S, K, throws: !Q.has('wnothrow'), get mirror() { return rtM; } };
})();
