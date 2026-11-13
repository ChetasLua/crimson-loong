'use strict';
// ---- effects: water, waterfalls, mist, leaves, cranes; both breath jets, lightning, the clashes, the bolt, the splash,
//      the beam ball, the blast, the pearl and the aftermath --------------------------------------------------------------
// Every picture here is a pure function of film time t (seekable, loops), and everything is allocated once in build().
// Reads each frame:  Dragon.red / Dragon.white  .st { head, fwd, up, mouth, neck, breath, charge, vis, speed }, .headAt(t, out), .spineAt(a, pos, tan), .LEN
//                    Film.T, Film.A { rift, clash1, boltHit, clash2, splash, beamMid, pearl }, Film.pearlAt, Film.beamMidAt, Sky.fx (if present), G
// Reads at build:    Film.STRIKES, Rock.L (falls, the main spire for the arcs), Rock.sites (cliff dust, the feet of the OMEN strikes), Flora.T.leaf,
//                    the lantern material; Film.apply(t) + Dragon.red/white.update(t) at a few sample times (the fire tables, the four strike
//                    moments, CLASH2): pure in t, and the first real frame overwrites everything they touched
// Writes:            Film.post.kick (0..1+, the screen-space punch Post.render reads), Post.lens { fringe, ring, ringS } (the colour split of a hit,
//                    the shock front that bends the picture), ONE point light (every glow shares it; FX.light), the lanterns' colour,
//                    the lake's uniforms (S.water: Water.fxU when the Water module exists, the lake built here otherwise): uRipA..D, uFoamA, uRipOn, uCol
// Layers:            additive / soft things go on the FX scene (no depth buffer: soft depth by hand against the scene depth texture);
//                    opaque things (leaves, rock chunks) go in the main scene. A system that is not in its time window is not drawn at all.
const FX = (() => {
  const U = { uMouth: { value: new THREE.Vector3() }, uDir: { value: new THREE.Vector3(0, 0, 1) }, uRoar: { value: 0 }, uRoarT: { value: -9 }, uShock: { value: new THREE.Vector4(0, 0, 0, -1) }, tPuff: { value: null }, uCharge: { value: 0 },
    uLen: { value: 1e4 }, uBeam: { value: 0 }, uShockK: { value: 7 }, uMistA: { value: 1 }, uFlee: { value: 0 }, tNoise: { value: null }, uReach: { value: 1 } };
  const S = {};                                    // handles to everything update() drives
  const HIT = 0.12;                                // seconds the bolt takes from white's mouth to the rock
  // a breath leaves the mouth along fwd - JET_DROP * up: about 32 degrees below the brow line. This is the axis the foundation's fire used and
  // the one the choreography tips the head back for (st.aim), so an aimed breath lands on the gaze target.
  const JET_DROP = 0.62;
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), V4 = (x = 0, y = 0, z = 0, w = 0) => new THREE.Vector4(x, y, z, w);
  const hsh = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  const env = (t, a, b, up = 0.3, dn = 0.4) => sm(a, a + up, t) * (1 - sm(b - dn, b, t));
  // premultiplied blending: alpha 0 = pure additive light, alpha = coverage for smoke, dust and spray (one mode for both)
  const PMB = m => { m.blending = THREE.CustomBlending; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendEquation = THREE.AddEquation; return m; };
  // ONE point light serves every glowing thing (two jets, flashes, the ball, the pearl): each frame the sources are blended by
  // intensity into one position, colour and range. A second light costs every lit pixel of the valley all film long; this costs nothing in calm shots.
  let breathLight, lI = 0, lR = 0, lG = 0, lB = 0, lD = 0; const lP = new THREE.Vector3();
  const lit = (I, p, r, g, b, dist = 150) => { if (I <= 0) return; lI += I; lP.addScaledVector(p, I); lR += r * I; lG += g * I; lB += b * I; lD += dist * I; };
  function puffTex(R) {
    const rt = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: false, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const m = new THREE.ShaderMaterial({ depthTest: false, vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `${GLSL_NOISE} varying vec2 vUv; void main(){ vec2 q = vUv * 2.0 - 1.0; float r = length(q); float n = fbm2(vUv * 5.0 + 3.0) * 0.9 + fbm2(vUv * 11.0) * 0.35;
        float a = smoothstep(1.0, 0.15, r + (n - 0.55) * 0.75); float soft = smoothstep(1.0, 0.0, r); gl_FragColor = vec4(n, soft, 0.0, a * soft); }` });
    const q = new THREE.Mesh(g, m); q.frustumCulled = false; const s = new THREE.Scene(); s.add(q); R.setRenderTarget(rt); R.render(s, new THREE.Camera()); R.setRenderTarget(null); m.dispose();
    return rt.texture;
  }
  // a tiling noise (R, G: two cloud fields, B: a finer one), baked once. The splash mist reads it at WORLD positions, so puffs that
  // overlap erode alike and the bank reads as one body instead of a pile of discs.
  function noiseTex(R) {
    const rt = new THREE.WebGLRenderTarget(256, 256, { depthBuffer: false, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const m = new THREE.ShaderMaterial({ depthTest: false, vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `varying vec2 vUv;
        float ph(vec2 p, float per, float s){ p = mod(p, per); return fract(sin(dot(p, vec2(127.1, 311.7)) + s * 17.31) * 43758.5453); }
        float pvn(vec2 x, float per, float s){ vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(ph(i, per, s), ph(i + vec2(1.0, 0.0), per, s), f.x), mix(ph(i + vec2(0.0, 1.0), per, s), ph(i + vec2(1.0, 1.0), per, s), f.x), f.y); }
        float pfbm(vec2 uv, float per, float s){ float a = 0.5, v = 0.0; for (int k = 0; k < 5; k++) { v += a * pvn(uv * per, per, s + float(k) * 3.7); per *= 2.0; a *= 0.5; } return v / 0.96875; }
        void main(){ gl_FragColor = vec4(pfbm(vUv, 4.0, 1.0), pfbm(vUv, 4.0, 9.0), pfbm(vUv, 8.0, 21.0), 1.0); }` });
    const q = new THREE.Mesh(g, m); q.frustumCulled = false; const s = new THREE.Scene(); s.add(q); R.setRenderTarget(rt); R.render(s, new THREE.Camera()); R.setRenderTarget(null); m.dispose(); g.dispose();
    return rt.texture;
  }
  // instanced camera-facing quads: attrs = {name:[itemSize, (i, r) => [..]]}
  function sprites(n, attrs, o) {
    const g = new THREE.InstancedBufferGeometry(); g.instanceCount = n;
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3)); g.setIndex([0, 1, 2, 1, 3, 2]);
    const r = rng(o.seed || 1);
    for (const k of Object.keys(attrs)) { const [sz, fn] = attrs[k], a = new Float32Array(n * sz); for (let i = 0; i < n; i++) { const v = fn(i, r); for (let c = 0; c < sz; c++) a[i * sz + c] = v[c]; } g.setAttribute(k, new THREE.InstancedBufferAttribute(a, sz)); }
    const m = new THREE.ShaderMaterial({ uniforms: { uTime: G.uTime, uWind: G.uWind, uGust: G.uGust, ...Post.fxU, ...U, ...(o.uniforms || {}) }, vertexShader: o.vs, fragmentShader: o.fs, transparent: !o.opaque, depthTest: !!o.opaque, depthWrite: !!o.opaque, blending: o.add ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide, fog: false });
    if (o.a2c) m.alphaToCoverage = true;
    if (o.pm) PMB(m);
    const me = new THREE.Mesh(g, m); me.frustumCulled = false; return me;
  }
  // one mesh on the FX layer with its own uniforms; hidden until update() switches it on
  function fxMesh(geo, vs, fs, uniforms, order = 2) {
    const m = PMB(new THREE.ShaderMaterial({ uniforms: { uTime: G.uTime, ...Post.fxU, tPuff: U.tPuff, tNoise: U.tNoise, ...uniforms }, vertexShader: vs, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const me = new THREE.Mesh(geo, m); me.frustumCulled = false; me.visible = false; me.renderOrder = order; G.fx.add(me); return { mesh: me, u: m.uniforms };
  }
  // a strip of n segments: aU = 0..1 along, aSide = -1 / +1 across; the lightning geometry adds forking branches (aBr = start on the channel, length, angle, id)
  function stripGeo(n, branches, bn) {
    const u = [], sd = [], br = [], idx = []; let o = 0;
    const strip = (k, b) => { for (let i = 0; i <= k; i++) for (const s of [-1, 1]) { u.push(i / k); sd.push(s); br.push(b[0], b[1], b[2], b[3]); } for (let i = 0; i < k; i++) { const p = o + i * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); } o += (k + 1) * 2; };
    strip(n, [0, 1, 0, 0]);
    const r = rng(77); for (let b = 1; b <= (branches || 0); b++) strip(bn, [0.10 + 0.72 * r(), 0.16 + 0.30 * r(), r() * TAU, b]);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(o * 3), 3));
    g.setAttribute('aU', new THREE.Float32BufferAttribute(u, 1)); g.setAttribute('aSide', new THREE.Float32BufferAttribute(sd, 1)); g.setAttribute('aBr', new THREE.Float32BufferAttribute(br, 4)); g.setIndex(idx); return g;
  }
  // direction tables about +Y (the shader turns +Y onto each burst's axis)
  const dCone = (a0, a1) => r => { const th = lerp(a0, a1, r()), a = r() * TAU, s = Math.sin(th); return [s * Math.cos(a), Math.cos(th), s * Math.sin(a)]; };
  const dSphere = r => { const y = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - y * y); return [s * Math.cos(a), y, s * Math.sin(a)]; };
  const dHemi = r => { const y = r(), a = r() * TAU, s = Math.sqrt(1 - y * y); return [s * Math.cos(a), y, s * Math.sin(a)]; };
  const dCrown = r => (r() < 0.16 ? dCone(0, 0.09) : dCone(0.15, 0.44))(r);

  async function build(scene, fx, prog, tick) {
    const R = G.R, L = Rock.L, F = Film.T; U.tPuff.value = puffTex(R); U.tNoise.value = noiseTex(R);
    const FXD = Post.GLSL_FXDEPTH;
    // ================= shared GLSL =================
    const GL_AX = /* glsl */`
      // one corner of a streak from pp (where the spark was a moment ago) to p (now), half width sz; position.xy = -0.5..0.5
      vec4 streakQuad(vec3 p, vec3 pp, float sz, out float vz){ vec4 a = viewMatrix * vec4(pp, 1.0), b = viewMatrix * vec4(p, 1.0); vec2 dd = b.xy - a.xy; float l = length(dd); vec2 dir = l > 1e-5 ? dd / l : vec2(1.0, 0.0);
        vec4 c = mix(a, b, position.x + 0.5); c.xy += (dir * position.x + vec2(-dir.y, dir.x) * position.y) * 2.0 * sz; vz = c.z; return projectionMatrix * c; }
      void axFrame(vec3 ax, out vec3 e1, out vec3 e2){ e1 = normalize(cross(ax, abs(ax.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))); e2 = cross(ax, e1); }`;
    // soft puff fragment (smoke, dust, vapour, spray): colour runs uC1 (shade) -> uC0 (lit) through the puff texture; uGain = opacity, uNorm 1 = covers, 0 = adds
    const PUFF_FS = /* glsl */`${FXD} uniform sampler2D tPuff; uniform vec3 uC0, uC1; uniform float uNorm, uGain; varying vec2 vUv; varying float vVZ, vA;
      void main(){ vec4 tx = texture2D(tPuff, vUv); float a = tx.a * vA * uGain * softZ(vVZ, 3.5) * smoothstep(4.0, 18.0, -vVZ);
        gl_FragColor = vec4(mix(uC1, uC0, tx.r) * a, a * uNorm); }`;
    // closed-form ballistic burst: uT = seconds since the event (or looping when uLoop = 1). uP1 = speed, drag, gravity, life   uP2 = size, streak seconds, emission spread seconds, swirl
    const BURST_VS = /* glsl */`${GL_AX} attribute vec4 aR; attribute vec3 aD;
      uniform float uTime, uT, uLoop, uFloor, uHv, uIn; uniform vec3 uO, uAx, uVel; uniform vec4 uP1, uP2;      // uHv 1 = a few fast pieces and many slow ones (debris); uIn = the share of its life a puff takes to appear
      varying vec2 vUv; varying float vVZ, vA, vL, vR;
      vec3 ball(float a, vec3 d, float v0){ float s = v0 * (1.0 - exp(-uP1.y * a)) / uP1.y; return uO + uVel * a + d * s + vec3(0.0, -0.5 * uP1.z * a * a, 0.0)
        + vec3(sin(a * 3.1 + aR.x * 40.0), cos(a * 2.3 + aR.y * 40.0), sin(a * 2.7 + aR.z * 40.0)) * uP2.w * a; }
      void main(){ float life = uP1.w * (0.45 + 0.55 * aR.w);
        float a = uLoop > 0.5 ? fract(uTime / life + aR.x) * life : uT - aR.x * uP2.z;
        float k = step(0.0, a) * step(a, life);
        vec3 e1, e2; axFrame(uAx, e1, e2); vec3 d = normalize(e1 * aD.x + uAx * aD.y + e2 * aD.z);
        float v0 = uP1.x * mix(0.3 + 0.7 * aR.y, 0.05 + 0.95 * aR.y * aR.y * aR.y, uHv), lf = a / life; vL = lf; vR = aR.z;
        vec3 p = ball(a, d, v0); k *= step(uFloor, p.y); float vz;
      #ifdef SPRAY
        // fine spray: a soft streak along its own flight, small, never more than a few percent opaque, thinning as it climbs.
        // Thousands of these make a curtain; no single one can be picked out.
        vec3 pp = ball(max(a - uP2.y, 0.0), d, v0);
        float sz = uP2.x * (0.5 + aR.z) * (0.45 + 1.9 * sqrt(lf));
        gl_Position = streakQuad(p, pp, sz, vz); vUv = position.xy * 2.0;
        vA = k * smoothstep(0.0, 0.05, lf) * (1.0 - smoothstep(0.18, 1.0, lf)) * (1.0 - 0.85 * smoothstep(8.0, 28.0, p.y - uO.y));
      #elif defined(WATER)
        // thrown water: a few clumps and a great deal of fine drops, each drawn as a streak one exposure long along its own flight.
        // A drop thinner than a pixel is drawn a pixel wide and that much fainter, so far spray is a haze of short dashes, not dots.
        float big = pow(aR.z, 5.0), szw = uP2.x * mix(0.14, 1.0, big); v0 *= mix(1.0, 0.6, big); p = ball(a, d, v0); k = step(0.0, a) * step(a, life) * step(uFloor, p.y);
        vec3 pp = ball(max(a - uP2.y, 0.0), d, v0); float sz = max(szw, -(viewMatrix * vec4(p, 1.0)).z * 0.00072);
        gl_Position = streakQuad(p, pp, sz, vz); vUv = position.xy * 2.0;
        vA = k * min(1.0, szw / sz) * smoothstep(0.0, 0.03, lf) * (1.0 - smoothstep(0.8, 1.0, lf));
      #elif defined(PUFF)
        float sz = uP2.x * (0.6 + 0.8 * aR.z) * (0.3 + 1.7 * sqrt(lf));
        float rot = aR.x * 6.283 + a * (aR.y - 0.5) * 1.5; vec2 q = position.xy; vec2 rq = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
        vec4 mv = viewMatrix * vec4(p, 1.0); mv.xy += rq * sz * 2.0; vz = mv.z; gl_Position = projectionMatrix * mv; vUv = position.xy + 0.5;
        vA = k * smoothstep(0.0, uIn, lf) * (1.0 - smoothstep(0.35, 1.0, lf));
      #elif defined(FLAKE)
        // a shed scale or a chip of ice: a small plate that tumbles as it falls. It narrows to a line as it turns edge-on and
        // flashes when its face turns to the light; it is opaque, it flutters, and the air slows it to a few metres a second.
        float spin = a * (5.0 + 13.0 * aR.x) + aR.z * 40.0, tw = aR.w * 6.283 + a * (aR.x - 0.5) * 3.0, cs = cos(tw), sn = sin(tw);
        vec4 mv = viewMatrix * vec4(p, 1.0); float szf = uP2.x * (0.30 + 1.5 * aR.z * aR.z), sz = max(szf, -mv.z * 0.00085);
        vec2 q = position.xy * vec2(1.0, 0.16 + 0.84 * abs(cos(spin)));
        mv.xy += vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs) * 2.0 * sz; vz = mv.z; gl_Position = projectionMatrix * mv; vUv = position.xy * 2.0;
        float gl = pow(abs(sin(spin + 0.6)), 8.0); vL = 1.0 - gl; vR = 0.5;
        vA = k * min(1.0, szf / sz) * smoothstep(0.0, 0.02, lf) * (1.0 - smoothstep(0.86, 1.0, lf)) * (0.75 + 1.6 * gl);
      #else
        vec3 pp = ball(max(a - uP2.y, 0.0), d, v0);
        float szs = uP2.x * (0.5 + aR.z) * (1.0 - 0.6 * lf), sz = max(szs, -(viewMatrix * vec4(p, 1.0)).z * 0.00062);      // a spark thinner than a pixel is drawn a pixel wide and that much fainter
        gl_Position = streakQuad(p, pp, sz, vz); vUv = position.xy * 2.0;
        vA = k * min(1.0, szs / sz) * (1.0 - lf) * (0.65 + 0.35 * sin(a * (17.0 + 23.0 * aR.x) + aR.z * 60.0));
      #endif
        vVZ = vz; if (k < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
    const BURST_FS = /* glsl */`${FXD} uniform vec3 uC0, uC1; uniform float uNorm, uGain; varying vec2 vUv; varying float vVZ, vA, vL, vR;
      void main(){ float d = 1.0 - clamp(length(vUv), 0.0, 1.0);
      #ifdef FLAKE
        float a = smoothstep(0.0, 0.25, 1.0 - (abs(vUv.x) * 0.8 + abs(vUv.y) * 1.25)) * min(vA, 1.0) * softZ(vVZ, 0.6); vec3 c = mix(uC0 * max(vA, 1.0), uC1, smoothstep(0.1, 0.9, vL)) * uGain;      // a plate with an edge: lit colour when it flashes, its shade otherwise
      #else
        float a = d * d * (0.55 + 0.45 * vUv.x) * vA * softZ(vVZ, 1.5);
        vec3 c = mix(uC0, uC1, smoothstep(0.0, 0.7, vL + (vR - 0.5) * 0.3)) * uGain;
      #endif
        gl_FragColor = vec4(c * a, a * uNorm); }`;
    function burst(n, dist, seed, kind) {                       // kind: falsy = spark streaks, true = puffs, 'spray' = fine spray, 'water' = thrown drops, 'flake' = tumbling plates (scales, ice chips)
      const puff = kind === true, flake = kind === 'flake';
      const me = sprites(n, { aR: [4, (i, r) => [r(), r(), r(), r()]], aD: [3, (i, r) => dist(r)] }, { seed, pm: true, vs: (puff ? '#define PUFF\n' : kind === 'spray' ? '#define SPRAY\n' : kind === 'water' ? '#define WATER\n' : flake ? '#define FLAKE\n' : '') + BURST_VS, fs: puff ? PUFF_FS : (flake ? '#define FLAKE\n' : '') + BURST_FS,
        uniforms: { uT: { value: 0 }, uLoop: { value: 0 }, uFloor: { value: -1e4 }, uHv: { value: 0 }, uIn: { value: 0.08 }, uO: { value: V() }, uAx: { value: V(0, 1, 0) }, uVel: { value: V() }, uP1: { value: V4(10, 1, 9.8, 2) }, uP2: { value: V4(0.2, 0.04, 0, 0) }, uC0: { value: V(1, 1, 1) }, uC1: { value: V(1, 1, 1) }, uNorm: { value: 0 }, uGain: { value: 1 } } });
      me.visible = false; me.renderOrder = puff ? 1 : 2; fx.add(me); return { mesh: me, u: me.material.uniforms, life: 2, spread: 0 };
    }
    const setB = (b, speed, drag, grav, life, size, streak, spread, swirl, c0, c1, gain, norm = 0, floor = -1e4) => { const u = b.u; u.uP1.value.set(speed, drag, grav, life); u.uP2.value.set(size, streak, spread, swirl); u.uC0.value.set(c0[0], c0[1], c0[2]); u.uC1.value.set(c1[0], c1[1], c1[2]); u.uGain.value = gain; u.uNorm.value = norm; u.uFloor.value = floor; b.life = life; b.spread = spread; return b; };
    // a glow card: core + halo + anamorphic streak + ring (uRing = radius, width, gain, rainbow); uS = half size in metres
    const quad = new THREE.BufferGeometry(); quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0], 3)); quad.setIndex([0, 1, 2, 1, 3, 2]);
    const CARD_VS = /* glsl */`uniform vec3 uP; uniform vec2 uS; uniform float uRot, uBias; varying vec2 vUv; varying float vVZ;
      void main(){ vec4 mv = viewMatrix * vec4(uP, 1.0); vec2 q = position.xy * uS * 2.0; float c = cos(uRot), s = sin(uRot); mv.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c); vVZ = mv.z + uBias; vUv = position.xy * 2.0; gl_Position = projectionMatrix * mv; }`;
    // uRing = radius, width, gain, rainbow; uWarp = how far the front wobbles off a true circle, a seed. The front is broken round its
    // circumference, hard on its leading edge, with a soft wake behind it: a pressure front, not a drawn circle.
    const GLOW_FS = /* glsl */`${FXD} uniform vec3 uC, uC2; uniform vec4 uK, uRing; uniform vec2 uWarp; uniform float uSoft; varying vec2 vUv; varying float vVZ;
      void main(){ float r = length(vUv); float edge = smoothstep(1.0, 0.8, r);
        float core = exp(-r * r * uK.x) * uK.y, halo = pow(max(1.0 - r, 0.0), 3.0) * uK.z;
        float streak = (exp(-abs(vUv.y) * 30.0) * exp(-abs(vUv.x) * 2.4) + 0.45 * exp(-abs(vUv.x) * 30.0) * exp(-abs(vUv.y) * 3.6)) * uK.w;
        float an = atan(vUv.y, vUv.x), sd = uWarp.y;
        float wob = uWarp.x * (0.5 * sin(an * 3.0 + sd * 5.1) + 0.3 * sin(an * 7.0 - sd * 3.3) + 0.2 * sin(an * 17.0 + sd * 9.7));
        float x = (r * (1.0 + wob) - uRing.x) / uRing.y;
        float brk = 0.30 + 0.70 * smoothstep(-0.55, 0.55, 0.6 * sin(an * 4.0 + sd * 7.0) + 0.4 * sin(an * 11.0 - sd * 4.0) + 0.25 * sin(an * 29.0 + sd));
        float ring = (exp(-x * x) * brk + 0.20 * exp(-x * x * 0.10) * step(x, 0.0)) * uRing.z;
        vec3 rb = 0.5 + 0.5 * cos(6.2832 * (x * 0.30 + vec3(0.0, 0.33, 0.67)));
        vec3 c = uC * (core + streak) + uC2 * halo + mix(uC2, rb * (uC2.r + uC2.g + uC2.b) * 0.6, uRing.w) * ring;
        float sft = uSoft > 0.0 ? softZ(vVZ, uSoft) : 1.0;
        gl_FragColor = vec4(c * edge * sft, 0.0); }`;
    const glow = () => fxMesh(quad, CARD_VS, GLOW_FS, { uP: { value: V() }, uS: { value: new THREE.Vector2(1, 1) }, uRot: { value: 0 }, uBias: { value: 0 }, uC: { value: V(1, 1, 1) }, uC2: { value: V(1, 1, 1) }, uK: { value: V4(8, 1, 0.3, 0) }, uRing: { value: V4(0.8, 0.06, 0, 0) }, uWarp: { value: new THREE.Vector2(0, 0) }, uSoft: { value: 0 } });
    // lightning: a jagged channel from uA to uB with forking branches, re-seeded by uSeed, revealed up to uRev (0..1 along the channel)
    const BOLT_VS = /* glsl */`attribute float aU, aSide; attribute vec4 aBr; uniform vec3 uA, uB; uniform float uSeed, uAmp, uWid, uRev, uBrn, uTap; varying float vS, vVZ, vI;
      float bh(float n){ return fract(sin(n * 127.1 + uSeed * 311.7) * 43758.5453); }
      float bs(float x, float s){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(bh(i + s), bh(i + 1.0 + s), f) * 2.0 - 1.0; }      // a slow sweep
      float bn(float x, float s){ float i = floor(x), f = fract(x); return mix(bh(i + s), bh(i + 1.0 + s), f) * 2.0 - 1.0; }                                    // straight runs between sharp corners
      vec3 chan(float u){ vec3 ab = uB - uA; float L = length(ab); vec3 d = ab / L; vec3 n1 = normalize(cross(d, vec3(0.31, 0.9, 0.29))), n2 = cross(d, n1);
        float e = pow(max(sin(3.14159 * clamp(u, 0.0, 1.0)), 0.0), 0.55);
        float o1 = 0.8 * bs(u * 2.3, 1.0) + 0.62 * bn(u * 7.0, 7.0) + 0.30 * bn(u * 19.0, 13.0), o2 = 0.8 * bs(u * 2.3, 31.0) + 0.62 * bn(u * 7.0, 37.0) + 0.30 * bn(u * 19.0, 43.0);
        return uA + ab * u + (n1 * o1 + n2 * o2) * (uAmp * L * e); }
      vec3 path(float s){ if (aBr.w < 0.5) return chan(s);
        vec3 ab = uB - uA; float L = length(ab); vec3 d = ab / L; vec3 n1 = normalize(cross(d, vec3(0.31, 0.9, 0.29))), n2 = cross(d, n1);
        vec3 lat = n1 * cos(aBr.z) + n2 * sin(aBr.z); float id = aBr.w * 17.0;
        return chan(aBr.x) + (d * 0.72 + lat * 0.62) * (s * aBr.y * L) + (n1 * bn(s * 5.0, id) + n2 * bn(s * 5.0, id + 5.0) + lat * 0.4 * bn(s * 13.0, id + 9.0)) * (uAmp * L * 0.55 * sqrt(max(s, 0.0))); }
      void main(){ vec3 p = path(aU), p2 = path(aU + 0.012);
        vec4 mv = viewMatrix * vec4(p, 1.0); vec3 tv = (viewMatrix * vec4(p2 - p, 0.0)).xyz; vec3 sd = normalize(cross(tv, mv.xyz) + vec3(1e-6, 0.0, 0.0));
        float isB = step(0.5, aBr.w), g = mix(aU, aBr.x + aU * aBr.y, isB);
        float tp = 1.0 - uTap * smoothstep(0.30, 1.0, aU);                                               // a channel that ends in open air thins and dies toward its tip
        float w = uWid * mix(0.25 + 0.75 * tp, 0.55 * (1.0 - 0.7 * aU), isB); w = max(w, -mv.z * mix(0.0016, 0.0007, uTap * smoothstep(0.6, 1.0, aU) * (1.0 - isB)));
        mv.xyz += sd * aSide * w; vS = aSide; vVZ = mv.z; vI = step(g, uRev) * mix(tp * tp, uBrn * (1.0 - aU) * (1.0 - 0.6 * uTap * smoothstep(0.3, 1.0, aBr.x)), isB);
        gl_Position = projectionMatrix * mv; }`;
    const BOLT_FS = /* glsl */`${FXD} uniform vec3 uC; uniform float uGain; varying float vS, vVZ, vI;
      void main(){ float x = vS * vS, core = exp(-x * 22.0), gl = exp(-x * 3.2) * (1.0 - x);
        gl_FragColor = vec4((vec3(2.2) * core + uC * gl * 0.55) * uGain * vI * softZ(vVZ, 2.0), 0.0); }`;
    const boltG = stripGeo(76, 6, 18);
    const bolt = () => fxMesh(boltG, BOLT_VS, BOLT_FS, { uA: { value: V() }, uB: { value: V(0, -1, 0) }, uSeed: { value: 0 }, uAmp: { value: 0.06 }, uWid: { value: 1 }, uRev: { value: 2 }, uBrn: { value: 1 }, uTap: { value: 0 }, uC: { value: V(0.5, 0.7, 1.6) }, uGain: { value: 1 } });
    // a straight beam core from uA to uB (billboarded about its axis), with pulses running down it
    const CORE_VS = /* glsl */`attribute float aU, aSide; uniform vec3 uA, uB; uniform vec2 uW; varying vec2 vUv; varying float vVZ;
      void main(){ vec3 a = (viewMatrix * vec4(uA, 1.0)).xyz, b = (viewMatrix * vec4(uB, 1.0)).xyz; vec3 pv = mix(a, b, aU); vec3 sd = normalize(cross(b - a, pv) + vec3(1e-6, 0.0, 0.0));
        pv += sd * aSide * mix(uW.x, uW.y, aU); vUv = vec2(aSide, aU); vVZ = pv.z; gl_Position = projectionMatrix * vec4(pv, 1.0); }`;
    // uTurb 0 = a tight straight jet (frost-lightning); 1 = flame: the centre line wanders, the edge licks out in tongues and the body tears into holes.
    // The noise is the tiling texture scrolled toward the far end, so the structure really travels down the beam.
    const CORE_FS = /* glsl */`${FXD} uniform sampler2D tNoise; uniform float uTime, uGain, uSpd, uRep, uTurb, uBody, uCover; uniform vec3 uC, uC2; varying vec2 vUv; varying float vVZ;
      void main(){ float x = vUv.x, u = vUv.y; float n = texture2D(tNoise, vec2(u * uRep * 0.35 - uTime * uSpd * 0.35, x * 0.16 + 0.5)).r, n2 = texture2D(tNoise, vec2(u * uRep * 0.8 - uTime * uSpd * 0.62, x * 0.27 + 0.2)).g;
        float n3 = texture2D(tNoise, vec2(u * uRep * 1.9 - uTime * uSpd * 1.1, x * 0.45 + 0.7)).b;
        float xw = x + uTurb * ((n2 - 0.5) * 0.85 + (n3 - 0.5) * 0.35);
        float wv = 1.0 + (0.5 + 1.3 * uTurb) * (n - 0.5); float xx = xw * xw / (wv * wv); float core = exp(-xx * mix(30.0, 44.0, uTurb)), body = exp(-xx * mix(5.0, 2.6, uTurb)) * (1.0 - x * x);
        body *= mix(1.0, 0.10 + 2.6 * smoothstep(0.34, 0.74, n3 * 0.55 + n2 * 0.6 + 0.2 * core), uTurb); core *= mix(1.0, 0.30 + 1.1 * n2, uTurb);
        float pul = pow(0.5 + 0.5 * sin(u * uRep * 9.0 - uTime * uSpd * 9.0), 6.0);
        vec3 c = uC * core * (1.0 + 1.8 * pul) + uC2 * body * (0.35 + 1.5 * n * n2 * 2.2 + 0.6 * pul); float cov = 0.0;
        if (uTurb > 0.5) {                                                           // flame: a ragged mask of tongues, deep orange at the edge, yellow where it is thick.
          float fl = exp(-xw * xw * 2.3) * (0.30 + 1.65 * (n2 * 0.55 + n3 * 0.55)), fm = smoothstep(0.44, 0.78, fl) * (1.0 - x * x);
          c = uC * core * (1.0 + pul) + (uC2 * (fm * (0.55 + 1.5 * fl) + 0.12 * body) + vec3(1.0, 0.72, 0.16) * smoothstep(0.95, 1.5, fl) * fm) * uBody;
          cov = uCover * fm * clamp(0.30 + 0.55 * fl, 0.0, 0.88); }                   // it also COVERS what is behind it (uCover): added light alone turns white over a bright sky or a sunlit cliff
        float ends = smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.90, 1.0, u)), kz = ends * softZ(vVZ, 2.0);
        gl_FragColor = vec4(c * kz * uGain, cov * kz); }`;
    const coreG = stripGeo(24);
    const core = () => fxMesh(coreG, CORE_VS, CORE_FS, { uA: { value: V() }, uB: { value: V(0, 1, 0) }, uW: { value: new THREE.Vector2(1, 1) }, uC: { value: V(1, 1, 1) }, uC2: { value: V(1, 1, 1) }, uGain: { value: 1 }, uSpd: { value: 2 }, uRep: { value: 2 }, uTurb: { value: 0 }, uBody: { value: 1 }, uCover: { value: 0 } });

    // a mark ON the world (scorch, rime): a card that reads the scene depth under each of its pixels, rebuilds that point of the valley and paints
    // it by its distance from the mark's centre. So the mark lies on whatever is there (rock, a pine, a roof ridge) and stays put as the lens moves.
    // uM = radius m, strength, heat, kind (0 = scorch with cracks running out of it, 1 = rime)
    const DECAL_VS = /* glsl */`uniform vec3 uP; uniform vec4 uM; varying vec3 vRay; void main(){ vec4 mv = viewMatrix * vec4(uP, 1.0); mv.xy += position.xy * uM.x * 2.7; vRay = mv.xyz / mv.z; gl_Position = projectionMatrix * mv; }`;
    const DECAL_FS = /* glsl */`${FXD} uniform sampler2D tNoise; uniform vec3 uP, uE; uniform vec4 uM; uniform float uSeed; varying vec3 vRay;
      void main(){ vec3 w = cameraPosition + (vec4(vRay * sceneZ(), 0.0) * viewMatrix).xyz, q = (w - uP) / uM.x; float r = length(q); if (r > 1.0) discard;
        float n = texture2D(tNoise, w.xy * 0.045 + w.z * 0.031 + uSeed).r, n2 = texture2D(tNoise, w.zy * 0.19 + w.x * 0.13 - uSeed).g, n3 = texture2D(tNoise, (w.xz + w.y * vec2(0.7, 0.4)) * 0.035 + uSeed * 1.7).b;
        if (uM.w > 0.5) {                                                     // rime: thick on what faces up, thin on walls, torn at its edge
          vec3 nr = normalize(cross(dFdx(w), dFdy(w))); if (dot(nr, cameraPosition - w) < 0.0) nr = -nr;
          float a = smoothstep(1.0, 0.25, r + (n - 0.5) * 0.7) * (0.30 + 0.70 * smoothstep(-0.25, 0.55, nr.y)) * smoothstep(0.22, 0.50, n2 * 0.6 + n * 0.5) * uM.y;
          gl_FragColor = vec4(vec3(0.80, 0.90, 1.04) * (0.75 + 0.35 * n2) * a, a * 0.92); return; }
        float burn = smoothstep(0.62, 0.18, r + (n - 0.5) * 0.5);                                               // the black heart of it
        float crk = smoothstep(0.90, 0.975, 1.0 - abs(2.0 * n3 - 1.0)) * smoothstep(1.0, 0.55, r) * (0.45 + 0.55 * n2);      // cracks run out past the burn
        float a = clamp(burn * (0.62 + 0.30 * n2) + crk * 0.85, 0.0, 0.93) * uM.y;
        gl_FragColor = vec4(uE * (uM.z * uM.y) * (exp(-r * r * 26.0) * (0.3 + 0.6 * n2) + 1.2 * crk * (1.0 - r) + 0.25 * burn * smoothstep(0.55, 0.75, n2)), a); }`;
    const decal = (kind, seed) => fxMesh(quad, DECAL_VS, DECAL_FS, { uP: { value: V() }, uM: { value: V4(5, 0, 0, kind) }, uE: { value: V(3.4, 0.95, 0.12) }, uSeed: { value: seed } }, 0);
    // hot air: what lies behind a flame is seen through it, bent (the resolved scene re-read with a shivering offset)
    S.heat = fxMesh(quad, CARD_VS, /* glsl */`${FXD} uniform sampler2D tScene, tNoise; uniform float uTime, uAmp; varying vec2 vUv; varying float vVZ;
        void main(){ float m = smoothstep(1.0, 0.2, length(vUv)) * uAmp * step(sceneZ(), vVZ - 2.0); if (m < 0.004) discard;
          vec2 n = texture2D(tNoise, vUv * 1.3 + vec2(-uTime * 0.7, -uTime * 1.3)).rg - 0.5 + (texture2D(tNoise, vUv * 3.7 + vec2(uTime * 1.9, -uTime * 2.9)).gb - 0.5) * 0.6;
          vec2 uv = gl_FragCoord.xy / uRes + n * 0.011 * m * vec2(uRes.y / uRes.x, 1.0);
          gl_FragColor = vec4(texture2D(tScene, uv).rgb, 1.0) * smoothstep(0.0, 0.12, m); }`,
      { uP: { value: V() }, uS: { value: new THREE.Vector2(1, 1) }, uRot: { value: 0 }, uBias: { value: 0 }, uAmp: { value: 0 } }, 0);

    // ---------- water (the splash and the blast send ring waves across it) ----------
    // The lake surface and the waterfalls belong to the Water module (68_water.js) when the build has one: it hands over the uniforms the effects
    // drive (Water.fxU: uRipA / uRipB = x, z, front radius m, amplitude; uFoamA; uRipOn; optional uRipC / uRipD for the two exits and uCol[6] =
    // x, z, radius m, strength where a body crosses the surface). Without it, the lake and falls below are built here as before.
    const hasWater = typeof Water !== 'undefined' && Water && Water.fxU;
    if (hasWater) { if (typeof Water.build === 'function') await Water.build(scene, fx, tick); S.water = Water.fxU; } else {
    const wg = new THREE.PlaneGeometry(220, 260, 1, 1); wg.rotateX(-Math.PI / 2);
    const wm = new THREE.ShaderMaterial({ uniforms: { uTime: G.uTime, uFall: { value: new THREE.Vector3(0, 0, L.gateZ + 6.5) }, uRipA: { value: V4() }, uRipB: { value: V4() }, uFoamA: { value: 0 }, uRipOn: { value: 0 } }, fog: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `${GLSL_NOISE}${GLSL_SKY}${GLSL_FOG} varying vec3 vW; uniform float uTime, uFoamA, uRipOn; uniform vec3 uFall; uniform vec4 uRipA, uRipB;   // ripples: x, z, front radius, amplitude
        float ripH(vec2 p, vec4 r, float wl){ float x = length(p - r.xy) - r.z; return r.w * (exp(-x * x / (wl * wl * 3.0)) * sin(x * 6.2832 / wl) + 0.4 * step(x, 0.0) * exp(x / (wl * 4.0)) * sin(x * 6.2832 / (wl * 0.55))); }
        float ripC(vec2 p, vec4 r, float wl){ float x = length(p - r.xy) - r.z; return r.w * exp(-x * x / (wl * wl * 0.8)); }
        void main(){ vec2 p = vW.xz; float d = length(p - uFall.xz);
          float rip = sin(d * 1.6 - uTime * 3.0) * exp(-d * 0.05) * 0.5;
          vec2 e = vec2(0.35, 0.0);
          float h0 = fbm2(p * 0.35 + uTime * vec2(0.10, 0.06)) + 0.5 * fbm2(p * 1.3 - uTime * vec2(0.13, 0.09)) + rip * 0.12;
          float hx = fbm2((p + e) * 0.35 + uTime * vec2(0.10, 0.06)) + 0.5 * fbm2((p + e) * 1.3 - uTime * vec2(0.13, 0.09));
          float hz = fbm2((p + e.yx) * 0.35 + uTime * vec2(0.10, 0.06)) + 0.5 * fbm2((p + e.yx) * 1.3 - uTime * vec2(0.13, 0.09));
          if (uRipOn > 0.5) { h0 += ripH(p, uRipA, 5.0) + ripH(p, uRipB, 9.0); hx += ripH(p + e, uRipA, 5.0) + ripH(p + e, uRipB, 9.0); hz += ripH(p + e.yx, uRipA, 5.0) + ripH(p + e.yx, uRipB, 9.0); }
          vec3 n = normalize(vec3(-(hx - h0) * 0.55, 1.0, -(hz - h0) * 0.55));
          vec3 v = normalize(vW - cameraPosition), r = reflect(v, n); r.y = abs(r.y);
          float fr = 0.03 + 0.97 * pow(1.0 - max(dot(-v, n), 0.0), 5.0);
          vec3 sky = skyBase(r, 0.0); float wall = smoothstep(0.42, 0.10, r.y);                 // low reflections catch cliffs and trees
          vec3 refl = mix(sky, vec3(0.34, 0.12, 0.09) * (0.6 + 0.8 * fbm2(p * 0.2 + r.xz * 3.0)), wall * 0.85);
          vec3 deep = vec3(0.018, 0.050, 0.058);
          vec3 c = mix(deep, refl, fr);
          c += vec3(8.0, 4.0, 1.6) * pow(max(dot(r, SUN_DIR), 0.0), 380.0);
          float foam = smoothstep(11.0, 2.0, d) * smoothstep(0.42, 0.75, fbm2(p * 1.6 - uTime * 0.5));
          c = mix(c, vec3(1.25, 1.0, 0.86), foam * 0.8);
          if (uRipOn > 0.5) { float dA = length(p - uRipA.xy), fo = fbm2(p * 2.7 - uTime * vec2(0.6, 0.9)) * 0.65 + fbm2(p * 7.0 + uTime * 0.8) * 0.35;
            float churn = uFoamA * smoothstep(min(uRipA.z, 30.0) + 3.0, min(uRipA.z, 30.0) * 0.35, dA) * smoothstep(0.38, 0.70, fo + 0.25 * smoothstep(12.0, 0.0, dA));
            float lace = (ripC(p, uRipA, 2.6) * 0.9 + ripC(p, vec4(uRipA.xy, uRipA.z - 7.0, uRipA.w * 0.6), 2.2) * 0.8) * (0.55 + 0.6 * fo);       // foam lines on the two leading crests
            c = mix(c, vec3(1.35, 1.12, 1.02), clamp(lace + ripC(p, uRipB, 3.6) * (0.45 + 0.7 * fo) + churn, 0.0, 0.9)); }
          gl_FragColor = vec4(clFog(c, vW, cameraPosition), 1.0); }` });
    const water = new THREE.Mesh(wg, wm); water.position.set(5, 0.05, 30); scene.add(water); S.water = wm.uniforms;
    // ---------- waterfalls (soft, on the FX layer) ----------
    const fallMat = new THREE.ShaderMaterial({ uniforms: { uTime: G.uTime, ...Post.fxU }, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: 'varying vec2 vUv; varying float vVZ; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w; vVZ = mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: `${GLSL_NOISE}${GLSL_FOG}${FXD} varying vec2 vUv; varying float vVZ; varying vec3 vW; uniform float uTime;
        void main(){ float t = uTime; vec2 u = vUv;
          float st = fbm2(vec2(u.x * 9.0, u.y * 2.2 - t * 1.9)) * 0.6 + fbm2(vec2(u.x * 26.0, u.y * 5.0 - t * 3.1)) * 0.4;
          float edge = smoothstep(0.0, 0.16, u.x) * smoothstep(1.0, 0.84, u.x);
          float a = smoothstep(0.28, 0.62, st + 0.22 * (1.0 - u.y)) * edge; a *= smoothstep(0.0, 0.03, u.y) * (0.75 + 0.25 * u.y);
          float soft = softZ(vVZ, 1.2); vec3 c = vec3(1.9, 1.5, 1.28) * (0.72 + 0.5 * st);
          gl_FragColor = vec4(clFog(c, vW, cameraPosition), a * soft * 0.92); }` });
    const fall = (x, z0, yTop, yBot, w0, w1, throwZ) => { const g = new THREE.PlaneGeometry(1, 1, 6, 36), p = g.attributes.position.array, uv = g.attributes.uv.array; for (let i = 0; i < p.length / 3; i++) { const u = uv[i * 2], v = 1 - uv[i * 2 + 1]; p[i * 3] = x + (u - 0.5) * lerp(w0, w1, v); p[i * 3 + 1] = lerp(yTop, yBot, Math.pow(v, 0.9)); p[i * 3 + 2] = z0 + throwZ * Math.pow(v, 1.7) + 0.5 * Math.sin(u * Math.PI); uv[i * 2 + 1] = v * (yTop - yBot) / 9; } const m = new THREE.Mesh(g, fallMat); m.frustumCulled = false; fx.add(m); };
    fall(0, L.gateZ + 0.9, L.gateY - 0.7, 0.1, 5.6, 8.5, 6.5);
    fall(-27.5, L.leftLedge.z + 13.2, L.leftLedge.y - 2.2, 0.5, 1.6, 2.6, 3.0); fall(24, L.rightTer.z + 21.5, L.rightTer.y - 3, 0.4, 1.2, 2.2, 2.5); fall(-9.5, L.gateZ + 3.6, L.gateY - 1.5, 0.2, 1.1, 1.9, 5.0);
    }
    prog(0.2); await tick();
    // (the valley mist, the falling leaves, the motes and the cranes live in 72_air.js)
    // ---------- maple leaf fragment (the grapple vortex below) ----------
    const LEAF_FS = `${GLSL_NOISE}${GLSL_FOG} uniform sampler2D tLeaf; varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying float vS;
        void main(){ vec4 t = texture2D(tLeaf, vUv); if (t.a < 0.4) discard;
          float nl = abs(dot(normalize(vN), SUN_DIR));
          vec3 base = t.rgb * mix(vec3(1.0, 0.75, 0.7), vec3(1.25, 1.3, 0.8), step(0.7, vS));
          vec3 c = base * (vec3(1.0, 0.56, 0.30) * 5.2 * (0.25 + 0.75 * nl) * 0.33 + vec3(0.30, 0.26, 0.40));
          gl_FragColor = vec4(clFog(c, vW, cameraPosition), 1.0); }`;
    // leaves caught in the vortex round the two locked bodies (the grapple): a helix about the knot's line of travel
    S.vortex = sprites(600, { aR: [4, (i, r) => [r(), r(), r(), r()]] }, {
      seed: 71, opaque: true, a2c: true, uniforms: { tLeaf: { value: Flora.T.leaf }, uVC: { value: V() }, uVAx: { value: V(0, -1, 0) }, uVK: { value: 0 } },
      vs: `${GL_AX} attribute vec4 aR; uniform float uTime, uVK; uniform vec3 uVC, uVAx; varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying float vS;
        void main(){ vec3 e1, e2; axFrame(uVAx, e1, e2);
          float ang = aR.x * 6.283 + uTime * (2.0 + 2.6 * aR.y), h = (aR.w - 0.25) * 46.0, rad = (6.0 + 10.0 * aR.z) * (1.0 + 0.012 * abs(h));
          vec3 c = uVC - uVAx * h + (e1 * cos(ang) + e2 * sin(ang)) * rad + vec3(sin(uTime * 1.7 + aR.x * 30.0), cos(uTime * 1.3 + aR.y * 30.0), sin(uTime * 1.1 + aR.z * 30.0)) * 1.3;
          float a1 = uTime * 5.2 + aR.w * 6.283, a2 = uTime * 3.4 + aR.y * 6.283;
          vec3 ax = normalize(vec3(cos(a1), sin(a1) * 0.6, sin(a1))), ay = normalize(cross(ax, vec3(sin(a2), cos(a2), 0.3))); vN = normalize(cross(ax, ay));
          float sz = (0.62 + 0.55 * aR.z) * clamp(uVK * 1.8 - aR.x * 0.8, 0.0, 1.0); vec3 w = c + (ax * position.x + ay * position.y) * sz; vW = w; vUv = position.xy + 0.5; vS = aR.y;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
      fs: LEAF_FS });
    S.vortex.visible = false; scene.add(S.vortex);
    prog(0.35); await tick();

    // ================= the red jet: fire =================
    // sprites: a hot white-gold core near the mouth, long licking tongues, a cooling red fringe. In beam mode (uBeam) the jet is a straight
    // sustained stream that ends uLen metres from the mouth, at Film.A.beamMid.
    S.fire = sprites(1100, { aR: [4, (i, r) => [r(), r(), r(), r()]] }, {
      seed: 11, add: true,
      vs: `attribute vec4 aR; uniform float uTime, uRoar, uLen, uBeam, uReach; uniform vec3 uMouth, uDir; varying vec2 vUv; varying float vVZ; varying float vLife; varying float vK; varying float vCore;
        void main(){ float life = (0.75 + 0.5 * aR.w) * mix(1.0, 0.6, uBeam), age = fract(uTime / life + aR.x), a = age * life;
          vec3 up = normalize(cross(uDir, vec3(0.37, 0.0, -0.93)) + vec3(0.0, 0.001, 0.0)), rt = cross(up, uDir);
          float ang = aR.y * 6.283, sp = sqrt(aR.z) * mix(0.20, 0.15, uBeam); vec3 d = normalize(uDir + (rt * cos(ang) + up * sin(ang)) * sp);
          float v0 = 70.0 * uReach * (0.6 + 0.4 * aR.w), dist = mix(v0 * (1.0 - exp(-a * 2.6)) / 2.6, age * uLen * 1.12, uBeam), wob = mix(1.0, 0.5, uBeam);            // a sustained beam is straighter, but it is still fire (uReach: 1 = the roar's 27 m plume; the chase breath throws it further)
          float lick = step(0.78, fract(aR.x * 7.31 + aR.z * 3.7));                                   // one sprite in five is a long tongue
          vec3 c = uMouth + d * dist; c += vec3(sin(a * 9.0 + aR.x * 40.0), cos(a * 7.0 + aR.y * 40.0), sin(a * 8.0 + aR.z * 40.0)) * age * age * 2.2 * wob; c.y += age * age * 4.5 * wob;
          c += (rt * sin(uTime * 13.0 + aR.y * 50.0) + up * cos(uTime * 11.0 + aR.x * 50.0)) * lick * age * mix(1.5, 2.6, uBeam);
          float sz = mix(0.9, 7.0, pow(age, 0.8)) * (0.7 + 0.6 * aR.z) * mix(1.0, 0.95, uBeam) * (1.0 + 0.10 * (uReach - 1.0));
          vec4 mv = viewMatrix * vec4(c, 1.0); vec2 fd = (viewMatrix * vec4(d, 0.0)).xy; float fl = length(fd); fd = fl > 1e-4 ? fd / fl : vec2(1.0, 0.0);
          float rot = aR.x * 6.283 + a * 2.0; vec2 q = position.xy; vec2 rq = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
          vec2 lq = fd * q.x * (2.4 + 1.2 * aR.w) * fl + vec2(-fd.y, fd.x) * q.y * 0.62;             // tongues stretch along the flow
          mv.xy += mix(rq, lq, lick) * sz; vVZ = mv.z; vUv = position.xy + 0.5; vLife = age;
          vK = uRoar * smoothstep(0.0, 0.06, age) * (1.0 - smoothstep(uLen * 0.90, uLen * 1.06, dist)) * mix(1.0, 0.26, uBeam) * (1.0 + mix(0.8, 3.0, uBeam) * lick);      // a beam packs the same sprites into a third of the room: dimmer each, or it burns out to a white bar
          vCore = (1.0 - smoothstep(0.0, 0.24, age)) * (1.0 - sqrt(aR.z)) * (1.0 - lick);
          gl_Position = projectionMatrix * mv; if (uRoar < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fs: `${FXD} uniform sampler2D tPuff; varying vec2 vUv; varying float vVZ; varying float vLife; varying float vK; varying float vCore;
        void main(){ vec4 t = texture2D(tPuff, vUv); float a = t.a * (1.0 - smoothstep(0.55, 1.0, vLife)) * vK * softZ(vVZ, 3.0);
          vec3 c = mix(vec3(4.2, 2.3, 0.7), vec3(3.0, 0.62, 0.06), smoothstep(0.0, 0.30, vLife)); c = mix(c, vec3(0.9, 0.06, 0.015), smoothstep(0.30, 0.85, vLife));
          c += vec3(7.0, 5.2, 2.6) * vCore;
          gl_FragColor = vec4(c * a * (0.10 + 2.3 * t.r * t.r * t.r) * 0.17, 1.0); }` });
    S.fire.renderOrder = 2; fx.add(S.fire);
    // Where the jet WAS: eight samples of red's mouth and aim across each breath, taken at build by posing the film at those times
    // (Film.apply + red.update are pure in t; the first real frame overwrites everything they touched). Embers and smoke are born from
    // these tables, so they stay where the fire left them while the dragon flies on.
    const tA = V(), tB = V(), tC = V();
    // Each sample also records how hard red was breathing (st.breath): an ember or a smoke puff is only born at a moment the mouth
    // really breathed, so the wake follows the breath wherever the choreography puts it inside the beat. [w0, w1] is the old fixed
    // window, used only by the fallback (no update()): there the breath is unknown.
    const NJ = 12;
    const jetTable = (t0, span, w0, w1) => { const P = [], D = [], Bw = [], red = Dragon.red;
      for (let k = 0; k < NJ; k++) { const te = t0 + k / (NJ - 1) * span; let ok = false;
        try { if (typeof red.update === 'function') { Film.apply(te, G.camera, null); red.update(te); const p = red.st.mouth.clone(), d = red.st.fwd.clone().addScaledVector(red.st.up, -JET_DROP).normalize(), b = clamp(red.st.breath * red.st.vis);
          if (isFinite(p.x + p.y + p.z + d.x + d.y + d.z + b)) { P.push(p); D.push(d); Bw.push(b); ok = true; } } } catch (e) { ok = false; }
        if (!ok) { const p = red.headAt(te, V()); red.headAt(te + 0.08, tA); red.headAt(te - 0.08, tB); tA.sub(tB); if (tA.lengthSq() < 1e-8) tA.set(0, 0, 1); P.push(p); D.push(tA.clone().normalize()); Bw.push(te >= w0 && te <= w1 ? 1 : 0); } }
      return { P, D, B: Bw }; };
    // embers: born along the jet, then they rain down
    const EMB_VS = /* glsl */`attribute vec4 aR; uniform float uTime, uT0, uSpan; uniform vec3 uEmP[12], uEmD[12]; uniform float uEmB[12]; uniform vec2 uFall; varying vec2 vUv; varying float vA, vVZ;
        void main(){ float a = uTime - uT0 - aR.x * uSpan; float life = 3.2 + 2.5 * aR.w; float k = step(0.0, a) * step(a, life);
          float x = aR.x * 11.0, fi = min(floor(x), 10.0); int i = int(fi); vec3 o = mix(uEmP[i], uEmP[i + 1], x - fi), dj = normalize(mix(uEmD[i], uEmD[i + 1], x - fi));
          k *= step(fract(aR.y * 7.77 + aR.w * 3.31) * 0.7 + 0.03, mix(uEmB[i], uEmB[i + 1], x - fi));                 // born only while the mouth breathes; fewer from a weak breath
          vec3 up = normalize(cross(dj, vec3(0.37, 0.0, -0.93)) + vec3(0.0, 0.001, 0.0)), rt = cross(up, dj); float ang = aR.y * 6.283, sp = sqrt(aR.z) * 0.55; vec3 d = normalize(dj + (rt * cos(ang) + up * sin(ang)) * sp);
          float v0 = 46.0 * (0.5 + 0.5 * aR.w), dist = v0 * (1.0 - exp(-a * 1.1)) / 1.1;
          vec3 c = o + d * dist + vec3(sin(a * 2.3 + aR.x * 30.0), 0.0, cos(a * 1.9 + aR.y * 30.0)) * a * 1.4; c.y += a * uFall.x - a * a * uFall.y;
          vec4 mv = viewMatrix * vec4(c, 1.0); vVZ = mv.z; mv.xy += position.xy * (0.10 + 0.22 * aR.z) * (1.0 + 0.5 * sin(a * 17.0 + aR.x * 50.0));
          vUv = position.xy; vA = k * (1.0 - a / life) * (0.6 + 0.4 * sin(a * 23.0 + aR.z * 60.0)); gl_Position = projectionMatrix * mv; if (k < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
    const EMB_FS = `${FXD} varying vec2 vUv; varying float vA, vVZ; void main(){ float d = length(vUv) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vec3(12.0, 3.2, 0.5) * a * a * vA * softZ(vVZ, 1.5), 1.0); }`;
    // smoke fringe: dark puffs that ride to the end of the flame, then hang and rise where it was (drawn under the fire)
    const SMK_VS = /* glsl */`attribute vec4 aR; uniform float uTime, uT0, uSpan, uSR; uniform vec3 uEmP[12], uEmD[12], uSK; uniform float uEmB[12]; varying vec2 vUv; varying float vVZ, vA;      // uSK = rise, buoyancy, life scale
        void main(){ float a = uTime - uT0 - aR.x * uSpan, life = (2.8 + 1.7 * aR.w) * uSK.z, lf = clamp(a / life, 0.0, 1.0);
          float x = aR.x * 11.0, fi = min(floor(x), 10.0); int i = int(fi); vec3 o = mix(uEmP[i], uEmP[i + 1], x - fi), dj = normalize(mix(uEmD[i], uEmD[i + 1], x - fi));
          vec3 up = normalize(cross(dj, vec3(0.37, 0.0, -0.93)) + vec3(0.0, 0.001, 0.0)), rt = cross(up, dj); float ang = aR.y * 6.283, sp = 0.08 + sqrt(aR.z) * 0.22; vec3 d = normalize(dj + (rt * cos(ang) + up * sin(ang)) * sp);
          float dist = 62.0 * uSR * (0.6 + 0.4 * aR.w) * (1.0 - exp(-a * 2.2)) / 2.2;
          vec3 c = o + d * dist + vec3(sin(a * 1.6 + aR.x * 40.0), 0.0, cos(a * 1.3 + aR.y * 40.0)) * a * 1.3; c.y += a * uSK.x + a * a * uSK.y;
          float sz = mix(1.6, 9.5, sqrt(lf)) * (0.7 + 0.6 * aR.z) * (1.0 + 0.25 * (uSR - 1.0)), rot = aR.x * 6.283 + a * 0.5 * (aR.z - 0.5); vec2 q = position.xy; vec2 rq = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
          vec4 mv = viewMatrix * vec4(c, 1.0); mv.xy += rq * sz; vVZ = mv.z; vUv = position.xy + 0.5;
          vA = step(0.0, a) * smoothstep(0.13, 0.30, lf) * (1.0 - smoothstep(0.5, 1.0, lf)) * smoothstep(0.05, 0.45, mix(uEmB[i], uEmB[i + 1], x - fi)); gl_Position = projectionMatrix * mv; if (vA <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
    const jetWake = (nE, nS, seed, t0, span, w0, w1, rise, fall, sr = 1, sg = 0.5, sc0 = [0.42, 0.19, 0.15], sc1 = [0.075, 0.03, 0.04], sk = [1.2, 0.9, 1]) => { const T = jetTable(t0, span, w0, w1), tu = () => ({ uT0: { value: t0 }, uSpan: { value: span }, uEmP: { value: T.P }, uEmD: { value: T.D }, uEmB: { value: T.B } });
      const e = sprites(nE, { aR: [4, (i, r) => [r(), r(), r(), r()]] }, { seed, add: true, uniforms: { ...tu(), uFall: { value: new THREE.Vector2(rise, fall) } }, vs: EMB_VS, fs: EMB_FS }); e.visible = false; e.renderOrder = 2; fx.add(e);
      const m = sprites(nS, { aR: [4, (i, r) => [r(), r(), r(), r()]] }, { seed: seed + 100, pm: true, uniforms: { ...tu(), uSR: { value: sr }, uSK: { value: V(sk[0], sk[1], sk[2]) }, uC0: { value: V(sc0[0], sc0[1], sc0[2]) }, uC1: { value: V(sc1[0], sc1[1], sc1[2]) }, uNorm: { value: 1 }, uGain: { value: sg } }, vs: SMK_VS, fs: PUFF_FS }); m.visible = false; m.renderOrder = 1; fx.add(m);
      // when the mouth first and last breathed inside the table (seconds): the chase flame runs out from the mouth at tOn
      let tOn = t0, tOff = t0 + span; { let a = -1, b = -1; for (let k = 0; k < NJ; k++) if (T.B[k] > 0.12) { if (a < 0) a = k; b = k; } if (a >= 0) { tOn = t0 + Math.max(0, a - 0.6) / (NJ - 1) * span; tOff = t0 + Math.min(NJ - 1, b + 0.6) / (NJ - 1) * span; } }
      return { emb: e, smoke: m, t0, span, T, endE: t0 + span + 5.8, endS: t0 + span + 4.5 * sk[2] + 0.1, tOn, tOff }; };
    S.wake = [jetWake(700, 300, 13, F.ROAR, F.ROAR_END - F.ROAR, F.ROAR + 0.15, F.ROAR + 2.75, 2.2, 0.45, 1.3, 0.9, [0.30, 0.17, 0.12], [0.05, 0.026, 0.03], [2.6, 1.1, 1.5]),                 // the challenge: the whole ROAR beat is sampled
      jetWake(620, 170, 14, F.FIRE2 - 0.1, 2.1, F.FIRE2 + 0.1, F.FIRE2 + 1.6, 0.6, 1.25, 1.55, 0.78, [0.25, 0.11, 0.095], [0.045, 0.018, 0.024])];                      // the chase: a 30 m flamethrower, so its smoke runs further and there is more of it (these embers fall)
    breathLight = new THREE.PointLight(new THREE.Color(1.0, 0.38, 0.10), 0, 150, 1.7); scene.add(breathLight);
    S.coreR = core(); S.coreR.u.uC.value.set(9.0, 6.6, 3.2); S.coreR.u.uC2.value.set(3.6, 0.95, 0.10); S.coreR.u.uTurb.value = 1;

    // ================= the white jet: frost-lightning =================
    // a tight blue-white core (S.coreW), forking filaments crawling along it (S.bolts 0..2), and this widening cone of vapour and ice crystals
    S.frost = sprites(900, { aR: [4, (i, r) => [r(), r(), r(), r()]] }, {
      seed: 21, pm: true, uniforms: { uMouthW: { value: V() }, uDirW: { value: V(0, 0, 1) }, uBreathW: { value: 0 }, uLenW: { value: 1e4 }, uMassW: { value: 0 } },
      vs: `attribute vec4 aR; uniform float uTime, uBreathW, uLenW, uBeam, uMassW; uniform vec3 uMouthW, uDirW; varying vec2 vUv; varying float vVZ, vLife, vK, vTy, vTw, vM;
        void main(){ float life = (0.9 + 0.6 * aR.w) * mix(1.0, 0.6, uBeam), age = fract(uTime / life + aR.x), a = age * life;
          vec3 up = normalize(cross(uDirW, vec3(0.37, 0.0, -0.93)) + vec3(0.0, 0.001, 0.0)), rt = cross(up, uDirW);
          float ty = step(0.64, fract(aR.y * 5.3 + aR.w * 3.1));                                    // 1 = ice crystal, 0 = vapour
          float ang = aR.y * 6.283, sp = sqrt(aR.z) * mix(0.25, 0.10, uBeam) * (1.0 + 0.5 * ty); vec3 d = normalize(uDirW + (rt * cos(ang) + up * sin(ang)) * sp);
          float v0 = 84.0 * (0.6 + 0.4 * aR.w), dist = mix(v0 * (1.0 - exp(-a * 2.2)) / 2.2, age * uLenW * 1.12, uBeam), wob = mix(1.0, 0.22, uBeam);
          vec3 c = uMouthW + d * dist + vec3(sin(a * 6.0 + aR.x * 40.0), cos(a * 5.0 + aR.y * 40.0), sin(a * 7.0 + aR.z * 40.0)) * age * age * 2.0 * wob; c.y -= age * age * (2.0 + 5.0 * ty) * wob;
          float sz = mix(mix(0.7, 8.0, pow(age, 0.9)) * (0.7 + 0.6 * aR.z) * mix(1.0, 0.8, uBeam) * (1.0 + 0.45 * uMassW), (0.045 + 0.10 * aR.z * aR.z) * (1.0 + 0.8 * uMassW), ty); vM = uMassW;
          float rot = aR.x * 6.283 + a * (1.2 + 5.0 * ty); vec2 q = position.xy; vec2 rq = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
          vec4 mv = viewMatrix * vec4(c, 1.0); float szc = max(sz, -mv.z * 0.0011 * ty), dimc = sz / szc; mv.xy += rq * szc; vVZ = mv.z; vUv = position.xy; vLife = age; vTy = ty;
          vTw = 0.35 + 0.65 * step(0.55, fract(sin(floor(uTime * 24.0 + aR.x * 9.0) * 12.9898 + aR.z * 78.233) * 43758.5453));    // sparkle
          vK = uBreathW * dimc * smoothstep(0.0, 0.05, age) * (1.0 - smoothstep(0.6, 1.0, age)) * (1.0 - smoothstep(uLenW * 0.90, uLenW * 1.06, dist));
          gl_Position = projectionMatrix * mv; if (uBreathW < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fs: `${FXD} uniform sampler2D tPuff; varying vec2 vUv; varying float vVZ, vLife, vK, vTy, vTw, vM;
        void main(){ float sft = softZ(vVZ, 3.0); vec2 q = vUv * 2.0;
          if (vTy > 0.5) { float st = exp(-dot(q, q) * 7.0);                                              // an ice crystal: a glint, never a drawn star
            gl_FragColor = vec4(vec3(4.2, 6.4, 9.6) * st * vTw * vK * sft, 0.0); return; }
          vec4 t = texture2D(tPuff, vUv + 0.5); float a = t.a * vK * sft;
          vec3 c = mix(vec3(1.5, 2.3, 3.6), vec3(0.50, 0.72, 1.05), smoothstep(0.0, 0.5, vLife));                 // glowing at the mouth, plain cold vapour further out
          gl_FragColor = vec4(c * a * (0.3 + 0.9 * t.r) * 0.27 * (1.0 + 0.45 * vM), a * 0.10 * (1.0 + 1.3 * vM) * smoothstep(0.15, 0.6, vLife)); }` });      // vM: the roar is a torrent with real body, not a haze
    S.frost.renderOrder = 2; S.frost.visible = false; fx.add(S.frost);
    S.coreW = core(); S.coreW.u.uC.value.set(7.5, 10.0, 14.0); S.coreW.u.uC2.value.set(0.9, 2.3, 6.0); S.coreW.u.uTurb.value = 0.12;
    S.bolts = []; for (let i = 0; i < 6; i++) S.bolts.push(bolt());
    S.muzR = glow(); S.muzW = glow();
    // ---- what the breaths and bolts leave on the world: the places are found once, here ----
    const rayRock = (o, d, maxL, rad, minL = 8) => { const st = (typeof Rock !== 'undefined' && Rock.sites) || []; let best = maxL, hit = null;      // the first rock a ray comes within rad of
      for (let i = 0; i < st.length; i++) { const s = st[i]; if (!s || !s.p || !s.n) continue; const x = s.p.x - o.x, y = s.p.y - o.y, z = s.p.z - o.z, tt = x * d.x + y * d.y + z * d.z; if (tt < minL || tt >= best) continue; if (x * x + y * y + z * z - tt * tt < rad * rad) { best = tt; hit = s; } }
      return hit ? { p: hit.p.clone(), n: hit.n.clone(), d: best } : null; };
    { const cam0 = G.camera.position.clone(), red = Dragon.red, W = Dragon.white;
      // FIRE2: where the chase flame washes over rock (a spire top and its pine), that place burns for five seconds and stays charred
      S.burns = []; { const w2 = S.wake[1], T2 = w2.T; for (let k = 0; k < NJ && S.burns.length < 2; k++) { if (T2.B[k] < 0.3) continue; const h = rayRock(T2.P[k], T2.D[k], 56, 6.5); if (!h || S.burns.some(b => b.p.distanceTo(h.p) < 12)) continue;
        h.t = w2.t0 + k / (NJ - 1) * w2.span + h.d / 70; h.scar = decal(0, 3.1 + S.burns.length); S.burns.push(h); } }
      // WROAR: where the frost breath sweeps rock or roof it leaves rime for ten seconds
      S.rimes = []; try { if (typeof W.spine === 'function') for (let te = F.WROAR + 0.25; te < F.WROAR_END - 0.1 && S.rimes.length < 3; te += 0.15) { Film.camAt(te, G.camera.position); red.spine(te); W.spine(te); if (W.st.breath * W.st.vis < 0.3) continue;
        tA.copy(W.st.fwd).addScaledVector(W.st.up, -JET_DROP).normalize(); const h = rayRock(W.st.mouth, tA, 110, 5.0); if (!h || S.rimes.some(b => b.p.distanceTo(h.p) < 11)) continue; h.t = te + h.d / 84; h.scar = decal(1, 5.3 + S.rimes.length); S.rimes.push(h); } } catch (e) { S.rimes = []; }
      // BEAM: the arcs it drops on the main spire leave that face cracked and black
      S.mScar = null; { Film.beamMidAt(F.BLAST, tA); const Sp = Rock.L.main; tB.set(Sp.x, clamp(tA.y - 8, 24, Sp.top - 2), Sp.z).sub(tA); const L = tB.length(); if (L > 1) { const h = rayRock(tA, tB.multiplyScalar(1 / L), L, 4.5, 1); if (h) { h.scar = decal(0, 2.2); S.mScar = h; } } }
      G.camera.position.copy(cam0);
      G.info.marks = { burns: S.burns.map(b => [b.p.toArray().map(x => Math.round(x)), +b.t.toFixed(2)]), rimes: S.rimes.map(b => [b.p.toArray().map(x => Math.round(x)), +b.t.toFixed(2)]), beam: S.mScar ? S.mScar.p.toArray().map(x => Math.round(x)) : null }; }
    // flames standing on what the chase fire lit (uB[2] = place, strength), and their smoke
    S.flame = sprites(150, { aR: [4, (i, r) => [r(), r(), r(), r()]] }, { seed: 87, add: true, uniforms: { uB: { value: [V4(), V4()] } },
      vs: `attribute vec4 aR; uniform float uTime; uniform vec4 uB[2]; varying vec2 vUv; varying float vVZ, vL, vK;
        void main(){ vec4 b = aR.w < 0.5 ? uB[0] : uB[1]; float life = 0.5 + 0.5 * aR.x, age = fract(uTime / life + aR.y), h = 4.5 + 5.5 * aR.x;
          vec3 c = b.xyz + vec3((aR.z - 0.5) * 7.5, 0.4 + age * h, (fract(aR.z * 7.31) - 0.5) * 7.5) + vec3(sin(uTime * 7.0 + aR.y * 40.0), 0.0, cos(uTime * 6.0 + aR.x * 40.0)) * 0.35 * age; c.x -= age * age * 1.4;
          float sz = mix(2.3, 0.6, age) * (0.7 + 0.6 * aR.y), rot = aR.x * 6.283 + uTime * (aR.y - 0.5) * 3.0; vec2 q = position.xy; vec2 rq = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
          vec4 mv = viewMatrix * vec4(c, 1.0); mv.xy += rq * sz * vec2(0.8, 1.5); vVZ = mv.z; vUv = position.xy + 0.5; vL = age; vK = b.w * sin(3.14159 * age);
          gl_Position = projectionMatrix * mv; if (b.w < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fs: `${FXD} uniform sampler2D tPuff; varying vec2 vUv; varying float vVZ, vL, vK;
        void main(){ vec4 t = texture2D(tPuff, vUv); float a = t.a * vK * softZ(vVZ, 1.0);
          vec3 c = mix(vec3(4.6, 2.6, 0.8), vec3(3.0, 0.62, 0.06), smoothstep(0.0, 0.6, vL));
          gl_FragColor = vec4(c * a * (0.25 + 1.6 * t.r * t.r) * 0.85, 1.0); }` });
    S.flame.renderOrder = 2; S.flame.visible = false; fx.add(S.flame);
    S.bSmoke = setB(burst(44, dCone(0, 0.4), 86, true), 7.5, 0.5, -3.4, 3.6, 3.3, 0, 0, 0.9, [0.17, 0.11, 0.095], [0.03, 0.02, 0.022], 0.7, 1); S.bSmoke.u.uLoop.value = 1;
    // steam where fire meets frost (the beam): white billows that boil up from the meeting point
    S.steam = setB(burst(90, dSphere, 84, true), 15, 1.0, -5.0, 2.7, 4.2, 0, 0, 1.3, [1.12, 1.08, 1.10], [0.55, 0.54, 0.64], 0.4, 0.7); S.steam.u.uLoop.value = 1;
    prog(0.5); await tick();

    // ================= OMEN and DESCENT: the storm =================
    S.EV = Film.STRIKES.map((s, i) => ({ t: s, k: i, big: 0 })).concat([{ t: F.DESCENT - 0.04, k: Film.STRIKES.length, big: 1 }]).sort((a, b) => a.t - b.t);
    S.strikeGlow = glow(); S.footFlash = glow(); S.footScorch = glow(); for (const e of S.EV) e.scar = e.big ? null : decal(0, 7.7 + e.k);
    S.sSpark = setB(burst(220, dHemi, 65), 58, 2.4, 14, 0.5, 0.16, 0.05, 0.03, 0.3, [5.5, 8.5, 14], [0.9, 1.9, 4.8], 1);
    // Every OMEN strike gets a foot on the rock: a bare face the lens sees at that moment, well above the halls and the gate, found once here.
    // Rock.sites (surface samples with normals all over the rock) are projected through the film camera posed at the strike; the nearest
    // sample in each screen cell stands for the visible surface, and the one closest to where that hit should land in the frame wins.
    { const st = (typeof Rock !== 'undefined' && Rock.sites) || [], cam = G.camera, GW = 64, GH = 36, cell = new Int32Array(GW * GH), cdist = new Float32Array(GW * GH), red = Dragon.red, body = [];
      const WANT = [[0.90, 0.34], [-0.56, 0.34], [0.10, -0.26], [-0.64, -0.06]];                             // ndc: right wall rim, left cliff high, the spire under the storm, left cliff low
      for (const e of S.EV) { e.tg = null; e.tn = null; if (e.big || !st.length) continue;
        try { Film.apply(e.t + 0.03, cam, null); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true); if (typeof red.update === 'function') red.update(e.t + 0.03); } catch (err) { continue; }
        cell.fill(-1); cdist.fill(1e9);
        for (let i = 0; i < st.length; i++) { const sI = st[i]; if (!sI || !sI.p || !sI.n) continue; tA.copy(sI.p).project(cam); if (!(tA.z < 1) || Math.abs(tA.x) > 0.97 || Math.abs(tA.y) > 0.97) continue;
          const k = Math.min(GW - 1, (tA.x * 0.5 + 0.5) * GW | 0) + Math.min(GH - 1, (tA.y * 0.5 + 0.5) * GH | 0) * GW, d = sI.p.distanceTo(cam.position); if (d < cdist[k]) { cdist[k] = d; cell[k] = i; } }
        body.length = 0; if (red.st.vis > 0.5) for (let a = 0; a <= (red.LEN || 170); a += 5) { red.spineAt(a, tA); const d = tA.distanceTo(cam.position); tA.project(cam); if (tA.z < 1) body.push(tA.x, tA.y, 11 / d); }      // red hides part of the valley
        const w = WANT[e.k % WANT.length], asp = cam.aspect; let best = -1, bc = 1e9;
        for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) { const k = gx + gy * GW, i = cell[k]; if (i < 0) continue; const sI = st[i], d = cdist[k];
          if (sI.p.y < 46 || d < 55 || d > 340 || sI.n.y > 0.8) continue;
          let near = d; for (let j = -1; j <= 1; j++) for (let ii = -1; ii <= 1; ii++) { const x2 = gx + ii, y2 = gy + j; if (x2 >= 0 && x2 < GW && y2 >= 0 && y2 < GH) near = Math.min(near, cdist[x2 + y2 * GW]); }
          if (d > near + 14) continue;                                                                       // something nearer stands beside it on screen: it may be hidden
          tA.copy(sI.p).project(cam); let hid = false; for (let b = 0; b < body.length; b += 3) if (Math.hypot((tA.x - body[b]) * asp, tA.y - body[b + 1]) < body[b + 2] + 0.05) { hid = true; break; }
          if (hid) continue;
          const c = Math.hypot((tA.x - w[0]) * asp, tA.y - w[1]) + 0.2 * Math.max(0, sI.n.y); if (c < bc) { bc = c; best = i; } }
        if (best >= 0) { e.tg = st[best].p.clone(); e.tn = st[best].n.clone(); } }
      G.info.strikeFeet = S.EV.filter(e => !e.big).map(e => e.tg ? e.tg.toArray().map(x => Math.round(x)) : null); }
    // the shaft of pale light from the rift down into the valley
    S.shaft = fxMesh(stripGeo(12), /* glsl */`attribute float aU, aSide; uniform vec3 uA, uB; uniform vec2 uW; varying vec2 vUv; varying float vVZ;
        void main(){ vec3 a = (viewMatrix * vec4(uA, 1.0)).xyz, b = (viewMatrix * vec4(uB, 1.0)).xyz; vec3 pv = mix(a, b, aU); vec3 sd = normalize(cross(b - a, pv) + vec3(1e-6, 0.0, 0.0));
          pv += sd * aSide * mix(uW.x, uW.y, aU); vUv = vec2(aSide, aU); vVZ = pv.z; gl_Position = projectionMatrix * vec4(pv, 1.0); }`,
      /* glsl */`${GLSL_NOISE}${FXD} uniform float uTime, uGain; uniform vec3 uC; varying vec2 vUv; varying float vVZ;
        void main(){ float x = vUv.x, u = vUv.y;
          float st = fbm2(vec2(x * 3.5 + 2.0, u * 1.1 - uTime * 0.05)) * 0.6 + fbm2(vec2(x * 11.0 + 5.0, u * 1.8 + uTime * 0.03)) * 0.4;
          float xe = abs(x) * (1.0 + 0.55 * (st - 0.5)), prof = exp(-xe * xe * 3.4) * pow(max(1.0 - x * x, 0.0), 1.5);            // soft sides, frayed by the rays
          float top = smoothstep(0.0, 0.62, u);                                                                                   // no edge at the rift: the light gathers over more than half its fall
          float a = prof * (0.30 + 1.2 * st) * top * top * (1.0 - smoothstep(0.62, 1.0, u)) * 1.35;
          gl_FragColor = vec4(uC * a * uGain * softZ(vVZ, 30.0), 0.0); }`,
      { uA: { value: V() }, uB: { value: V() }, uW: { value: new THREE.Vector2(20, 62) }, uC: { value: V(0.60, 0.82, 1.30) }, uGain: { value: 0 } }, 1);
    // motes drifting down inside the shaft
    S.smotes = sprites(520, { aR: [4, (i, r) => [r(), r(), r(), r()]] }, {
      seed: 33, pm: true, uniforms: { uA: { value: V() }, uB: { value: V() }, uW: { value: new THREE.Vector2(30, 52) }, uGain: { value: 0 } },
      vs: `${GL_AX} attribute vec4 aR; uniform float uTime, uGain; uniform vec3 uA, uB; uniform vec2 uW; varying vec2 vUv; varying float vA, vVZ;
        void main(){ float u = fract(aR.x + uTime * (0.012 + 0.014 * aR.w)); vec3 ax = normalize(uB - uA), e1, e2; axFrame(ax, e1, e2);
          float ang = aR.y * 6.283 + uTime * 0.2 * (aR.w - 0.5), rad = sqrt(aR.z) * mix(uW.x, uW.y, u) * 0.8;
          vec3 c = mix(uA, uB, u) + (e1 * cos(ang) + e2 * sin(ang)) * rad;
          vec4 mv = viewMatrix * vec4(c, 1.0); vVZ = mv.z; float sz = max(0.10 + 0.22 * aR.z, -mv.z * 0.0011); mv.xy += position.xy * sz * 2.0; vUv = position.xy * 2.0;
          vA = uGain * smoothstep(0.0, 0.3, u) * (1.0 - smoothstep(0.5, 0.95, u)) * (0.25 + 0.75 * step(0.5, fract(sin(floor(uTime * 12.0 + aR.x * 20.0) * 12.9898 + aR.y * 78.233) * 43758.5453)));
          gl_Position = projectionMatrix * mv; }`,
      fs: `${FXD} varying vec2 vUv; varying float vA, vVZ; void main(){ float a = smoothstep(1.0, 0.0, length(vUv)); gl_FragColor = vec4(vec3(1.6, 2.1, 3.0) * a * a * vA * softZ(vVZ, 3.0), 0.0); }` });
    S.smotes.renderOrder = 2; S.smotes.visible = false; fx.add(S.smotes);
    // cloud vapour torn along white's body as it leaves the cloud: puffs on white's own rail (headAt), each waking as the head passes it
    { const W = Dragon.white, N = 110, r = rng(41), aC = [], aV = [], aT = [], t0 = F.DESCENT - 1.0, span = 4.6; let tEnd = t0;
      for (let i = 0; i < N; i++) { const te = t0 + (i + r()) / N * span; W.headAt(te, tA); W.headAt(te + 0.06, tB).sub(tA); const sp = tB.length() / 0.06; tB.normalize();
        const dr = tA.distanceTo(Film.A.rift), w = sm(16, 42, dr) * (1 - sm(60, 135, dr)) * sm(F.DESCENT + 0.55, F.DESCENT + 0.95, te); const o = dSphere(r), rr = 2 + 4.5 * r();        // nothing pale at the mouth of the rift or in the first half second (the rift is a dark hole there): only wisps the body drags out with it afterwards
        aC.push(tA.x + o[0] * rr, tA.y + o[1] * rr, tA.z + o[2] * rr); aV.push(tB.x * sp * 0.10 + o[0] * 3, tB.y * sp * 0.10 + o[1] * 3, tB.z * sp * 0.10 + o[2] * 3); aT.push(te + 0.15 * r(), w, r(), r()); if (w > 0.02) tEnd = Math.max(tEnd, te); }
      let k = 0; S.vapour = sprites(N, { aC: [3, i => [aC[i * 3], aC[i * 3 + 1], aC[i * 3 + 2]]], aV: [3, i => [aV[i * 3], aV[i * 3 + 1], aV[i * 3 + 2]]], aT: [4, i => [aT[i * 4], aT[i * 4 + 1], aT[i * 4 + 2], aT[i * 4 + 3]]] }, {
        seed: 42, pm: true, uniforms: { uC0: { value: V(1.45, 1.20, 1.22) }, uC1: { value: V(0.62, 0.50, 0.66) }, uNorm: { value: 1 }, uGain: { value: 0.30 } },
        vs: `attribute vec3 aC, aV; attribute vec4 aT; uniform float uTime; varying vec2 vUv; varying float vVZ, vA;
          void main(){ float a = uTime - aT.x, life = 2.6 + 1.4 * aT.z, lf = clamp(a / life, 0.0, 1.0);
            vec3 c = aC + aV * (1.0 - exp(-a * 0.9)) / 0.9 * step(0.0, a); float sz = (2.4 + 6.0 * sqrt(lf)) * (0.7 + 0.6 * aT.w);
            vec2 fd = (viewMatrix * vec4(aV, 0.0)).xy; float fl = length(fd); fd = fl > 1e-4 ? fd / fl : vec2(1.0, 0.0); vec2 q = position.xy;
            vec2 rq = fd * q.x * (2.6 + 1.6 * aT.z) + vec2(-fd.y, fd.x) * q.y * (0.55 + 0.35 * aT.w);                 // a wisp: long along the way the body went, thin across it
            vec4 mv = viewMatrix * vec4(c, 1.0); mv.xy += rq * sz; vVZ = mv.z; vUv = position.xy + 0.5;
            vA = aT.y * step(0.0, a) * smoothstep(0.0, 0.05, lf) * (1.0 - smoothstep(0.25, 1.0, lf)); gl_Position = projectionMatrix * mv; if (vA <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
        fs: PUFF_FS });
      S.vapour.renderOrder = 1; S.vapour.visible = false; fx.add(S.vapour); S.vapT = [t0, tEnd + 4.3]; }
    // a faint cold mist that travels with white: soft puffs hung on ten points of its spine
    S.wmist = sprites(46, { aR: [4, (i, r) => [r(), r(), r(), r()]] }, {
      seed: 43, pm: true, uniforms: { uSp: { value: Array.from({ length: 10 }, () => V()) }, uC0: { value: V(0.78, 1.0, 1.42) }, uC1: { value: V(0.40, 0.52, 0.85) }, uNorm: { value: 0.35 }, uGain: { value: 0 } },
      vs: `attribute vec4 aR; uniform float uTime; uniform vec3 uSp[10]; varying vec2 vUv; varying float vVZ, vA;
        void main(){ float x = aR.x * 9.0, fi = min(floor(x), 8.0); int i = int(fi); vec3 c = mix(uSp[i], uSp[i + 1], x - fi);
          c += vec3(sin(uTime * 0.7 + aR.y * 40.0), cos(uTime * 0.5 + aR.z * 40.0), sin(uTime * 0.6 + aR.w * 40.0)) * (2.0 + 4.0 * aR.w); c.y -= 2.0 + 3.0 * aR.z;
          float sz = 9.0 + 9.0 * aR.z, rot = aR.y * 6.283 + uTime * 0.15 * (aR.w - 0.5); vec2 q = position.xy; vec2 rq = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
          vec4 mv = viewMatrix * vec4(c, 1.0); mv.xy += rq * sz; vVZ = mv.z; vUv = position.xy + 0.5; vA = 0.5 + 0.5 * aR.y; gl_Position = projectionMatrix * mv; }`,
      fs: PUFF_FS });
    S.wmist.renderOrder = 1; S.wmist.visible = false; fx.add(S.wmist);
    prog(0.62); await tick();

    // ================= CLASH1 / CLASH2 =================
    S.flash = glow(); S.ring = glow(); S.flash2 = glow();
    // the shock front of a clash: not a drawn line but a shell of torn mist. It is wide where its wall faces the lens (the near and the far
    // side of the ring) and thins to nothing where the wall is seen edge-on; the lens bends the picture as it passes (Post.lens.ring).
    S.shock = fxMesh(quad, CARD_VS, /* glsl */`${FXD} uniform sampler2D tNoise; uniform vec3 uC; uniform vec4 uRing; uniform float uSoft, uSeed, uTime, uLump; varying vec2 vUv; varying float vVZ;      // uRing = radius, width, gain, squash; uLump 1 = a shell of condensation in lumps (the blast)
        void main(){ float r = length(vUv), an = atan(vUv.y, vUv.x);
          float face = mix(clamp(abs(cos(an)) * sqrt(max(1.0 - uRing.w * uRing.w, 0.0)) / 0.89, 0.0, 1.0), 0.75, uLump);
          float n = texture2D(tNoise, vec2(an * 0.9549 + uSeed, r * 1.5 - uTime * 0.8)).r, n2 = texture2D(tNoise, vec2(an * 2.8648 - uSeed, r * 4.0 - uTime * 1.7)).g;
          float wd = uRing.y * (0.35 + 1.9 * face) * (0.7 + 0.6 * n), x = (r - uRing.x * (1.0 + (0.06 + 0.30 * uLump) * (n - 0.5) + 0.12 * uLump * (n2 - 0.5))) / wd;
          float lead = exp(-x * x * mix(1.7, 4.0, uLump)) * step(0.0, x) + exp(-x * x * 0.9) * step(x, 0.0);          // firm on its leading edge, a soft wake behind it
          float a = lead * smoothstep(0.36 + 0.16 * uLump, 0.66 + 0.10 * uLump, n2 * 0.85 + n * 0.30 + 0.18 * face) * smoothstep(0.06, 0.45, face) * uRing.z * softZ(vVZ, uSoft) * smoothstep(1.0, 0.9, r);
          gl_FragColor = vec4(uC * a, a * 0.30); }`,
      { uP: { value: V() }, uS: { value: new THREE.Vector2(1, 1) }, uRot: { value: 0 }, uBias: { value: 0 }, uC: { value: V(1.25, 1.12, 1.18) }, uRing: { value: V4(0.72, 0.05, 0, 0.5) }, uSoft: { value: 10 }, uSeed: { value: 0 }, uLump: { value: 0 } });
    // CLASH2: the burst belongs on the two bites. Each mouth is read at the beat (the film is posed there once, as for the fire tables) and
    // pulled 4 m toward the lens, so flash, sparks and scales stand in front of the knot instead of behind red's coil.
    S.bite = null; { const Tc = F.CLASH2, r = Dragon.red, w = Dragon.white;
      try { if (typeof r.update === 'function' && typeof w.update === 'function') { Film.apply(Tc, G.camera, null); r.update(Tc); w.update(Tc);
        const pr = r.st.mouth.clone(), pw = w.st.mouth.clone(), cm = G.camera.position.clone();
        if (isFinite(pr.x + pr.y + pr.z + pw.x + pw.y + pw.z) && pr.distanceTo(Film.A.clash2) < 45 && pw.distanceTo(Film.A.clash2) < 45) {
          const tc = cm.clone().sub(pr.clone().lerp(pw, 0.5)).normalize(); pr.addScaledVector(tc, 4); pw.addScaledVector(tc, 4);
          const out = pw.clone().sub(pr); if (out.lengthSq() < 1e-4) out.set(1, 0, 0); out.normalize();
          S.bite = { onW: pr, onR: pw, mid: pr.clone().lerp(pw, 0.5),                                     // red's mouth is on white's neck, white's mouth on red's
            axR: out.clone().multiplyScalar(0.55).addScaledVector(tc, 0.6).add(V(0, 0.45, 0)).normalize(),     // debris leaves each bite away from the other one, toward the lens and up
            axW: out.clone().multiplyScalar(-0.55).addScaledVector(tc, 0.6).add(V(0, 0.45, 0)).normalize() };
          G.info.bites = [pr.toArray().map(x => +x.toFixed(1)), pw.toArray().map(x => +x.toFixed(1))]; } } } catch (e) { S.bite = null; } }
    // What a clash throws is matter, not a drawn burst: a skirt of fine sparks off each jaw that arc over and fall (a few fast, most slow, so
    // there is no shell and no ball), torn scales that tumble down for four seconds, and one thin puff of displaced mist.
    const dSkirt = dCone(0.45, 1.55);
    S.cEmb = setB(burst(300, dSkirt, 51), 74, 1.5, 24, 1.5, 0.034, 0.045, 0.06, 0.25, [10, 3.6, 0.7], [3.0, 0.4, 0.04], 1.25); S.cEmb.u.uHv.value = 1;
    S.cIce = setB(burst(300, dSkirt, 52), 78, 1.5, 24, 1.4, 0.034, 0.045, 0.06, 0.2, [4.0, 6.2, 10], [0.6, 1.5, 4.4], 1.1); S.cIce.u.uHv.value = 1;
    S.cPuff = setB(burst(46, dSphere, 56, true), 44, 2.4, -0.4, 1.3, 3.4, 0, 0.05, 1.6, [1.05, 0.96, 1.0], [0.52, 0.44, 0.56], 0.10, 0.7); S.cPuff.u.uIn.value = 0.04;
    S.cScR = setB(burst(300, dCone(0.2, 1.7), 53, 'flake'), 52, 1.25, 4.6, 4.6, 0.13, 0, 0.14, 1.5, [1.75, 0.40, 0.16], [0.36, 0.055, 0.03], 1, 1); S.cScR.u.uHv.value = 0.45;
    S.cScW = setB(burst(300, dCone(0.2, 1.7), 54, 'flake'), 52, 1.25, 4.6, 4.6, 0.13, 0, 0.14, 1.5, [2.2, 2.3, 2.5], [0.50, 0.56, 0.78], 1, 1); S.cScW.u.uHv.value = 0.45;
    // the grapple: sparks where the two bodies grind (six contact slots down red's body, found on the CPU each frame)
    S.grind = sprites(900, { aR: [4, (i, r) => [r(), r(), r(), r()]], aD: [3, (i, r) => dSphere(r)] }, {
      seed: 55, pm: true, uniforms: { uCt: { value: Array.from({ length: 6 }, () => V4()) }, uVk: { value: V() } },
      vs: `${GL_AX} attribute vec4 aR; attribute vec3 aD; uniform float uTime; uniform vec4 uCt[6]; uniform vec3 uVk; varying vec2 vUv; varying float vVZ, vA, vTy, vL;
        vec3 gp(float a, vec4 ct, float v0){ return ct.xyz + (fract(aR.xyz * 7.3) - 0.5) * 5.0 - uVk * a + aD * (v0 * (1.0 - exp(-2.0 * a)) / 2.0) + vec3(0.0, -9.0 * a * a, 0.0); }
        void main(){ float life = 0.6 + 0.7 * aR.w, a = fract(uTime / life + aR.x) * life; int ci = int(min(floor(aR.y * 6.0), 5.0)); vec4 ct = uCt[ci];
          float v0 = 20.0 + 36.0 * aR.z, vz, far = -(viewMatrix * vec4(ct.xyz, 1.0)).z;                                             // never thinner than about a pixel and a half
          float gw = 0.030 + 0.045 * aR.z * aR.z, gs = max(gw, far * 0.00066); v0 *= 0.35 + 0.65 * aR.w * aR.w;
          gl_Position = streakQuad(gp(a, ct, v0), gp(max(a - 0.035, 0.0), ct, v0), gs, vz); vVZ = vz; vUv = position.xy * 2.0;
          vL = a / life; vTy = step(0.5, fract(aR.x * 13.7 + aR.w * 5.1)); vA = 2.0 * min(1.0, gw / gs) * ct.w * (1.0 - vL) * (0.6 + 0.4 * sin(a * 40.0 + aR.z * 60.0)); if (ct.w < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fs: `${FXD} varying vec2 vUv; varying float vVZ, vA, vTy, vL;
        void main(){ float d = 1.0 - clamp(length(vUv), 0.0, 1.0); float a = d * d * (0.55 + 0.45 * vUv.x) * vA * softZ(vVZ, 1.5);
          vec3 c = mix(mix(vec3(11.0, 3.4, 0.5), vec3(3.2, 0.42, 0.04), vL), mix(vec3(3.6, 6.6, 12.0), vec3(0.7, 1.6, 4.4), vL), vTy);
          gl_FragColor = vec4(c * a, 0.0); }` });
    S.grind.renderOrder = 2; S.grind.visible = false; fx.add(S.grind);

    // ================= BOLT: white's lightning shatters rock =================
    S.hitFlash = glow(); S.scorch = glow(); S.bScar = decal(0, 1.3);
    S.bSpark = setB(burst(240, dHemi, 61), 60, 2.6, 14, 0.55, 0.10, 0.025, 0.04, 0.3, [4.2, 7, 12], [0.8, 1.7, 4.4], 1);
    // the dust: out of the face 12 m inside a quarter of a second (it is the first thing a lens sees of a rock burst), then it pours down
    // the cliff under its own weight and drifts off down the wind. Lit sides pale, shaded sides brown: a cloud with a body, not a disc.
    S.bDust = setB(burst(170, dCone(0, 1.35), 62, true), 46, 3.4, 5.0, 4.8, 3.3, 0, 0.45, 1.5, [0.70, 0.61, 0.52], [0.17, 0.135, 0.125], 0.95, 1); S.bDust.u.uIn.value = 0.025; S.bDust.u.uHv.value = 0;
    S.bDust2 = setB(burst(60, dCone(0.2, 1.2), 66, true), 22, 2.6, 7.5, 4.2, 2.2, 0, 1.6, 1.0, [0.62, 0.54, 0.47], [0.16, 0.13, 0.12], 0.9, 1); S.bDust2.u.uIn.value = 0.04;      // what keeps coming off the broken face and falls with the blocks
    S.rubble = setB(burst(320, dCone(0.9, 1.75), 63), 4.0, 0.3, 11, 2.8, 0.12, 0.03, 2.5, 0.25, [0.62, 0.56, 0.52], [0.34, 0.29, 0.28], 1, 1);
    // rock chunks: 240 instanced lumps on closed-form arcs with spin. They are a built-in Lambert material with the flight written into
    // its vertex stage, so they take the scene's own light: the sun THROUGH the shadow map (dark where the struck cliff is in shade),
    // the sky fill, the cold flash of the hit (the shared point light) and the valley haze. Albedo is the dark, broken inside of the rock.
    { const ico = new THREE.IcosahedronGeometry(1, 0), p = ico.attributes.position.array; for (let i = 0; i < p.length; i += 3) { const k = 0.62 + 0.76 * hsh(Math.round(p[i] * 31) + Math.round(p[i + 1] * 57) * 3 + Math.round(p[i + 2] * 91) * 7); p[i] *= k; p[i + 1] *= k; p[i + 2] *= k; } ico.computeVertexNormals();
      const g = new THREE.InstancedBufferGeometry(); g.instanceCount = 420; g.setAttribute('position', ico.attributes.position); g.setAttribute('normal', ico.attributes.normal);
      const r = rng(64), aR = new Float32Array(420 * 4), aD = new Float32Array(420 * 3); for (let i = 0; i < 420; i++) { for (let c = 0; c < 4; c++) aR[i * 4 + c] = r(); const d = dCone(0, 1.25)(r); aD[i * 3] = d[0]; aD[i * 3 + 1] = d[1]; aD[i * 3 + 2] = d[2]; }
      g.setAttribute('aR', new THREE.InstancedBufferAttribute(aR, 4)); g.setAttribute('aD', new THREE.InstancedBufferAttribute(aD, 3));
      const cu = { uT: { value: 0 }, uO: { value: V() }, uAx: { value: V(0, 1, 0) } };
      const m = patch(new THREE.MeshLambertMaterial({ color: new THREE.Color(0.30, 0.255, 0.225), flatShading: true }), s => {
        Object.assign(s.sh.uniforms, cu);
        s.vHead(`${GL_AX} attribute vec4 aR; attribute vec3 aD; uniform float uT; uniform vec3 uO, uAx; varying float vTint;
          mat3 rotAx(vec3 a, float g){ float c = cos(g), s = sin(g), ic = 1.0 - c; return mat3(c + a.x * a.x * ic, a.y * a.x * ic + a.z * s, a.z * a.x * ic - a.y * s, a.x * a.y * ic - a.z * s, c + a.y * a.y * ic, a.z * a.y * ic + a.x * s, a.x * a.z * ic + a.y * s, a.y * a.z * ic - a.x * s, c + a.z * a.z * ic); }`);
        s.v('#include <beginnormal_vertex>', `float cA = uT - aR.x * 0.10, cK = step(0.0, cA) * (1.0 - smoothstep(3.6, 4.2, cA));
          float cBig = step(0.966, aR.w);                                                    // one lump in thirty is a block of the slab: slow, heavy, 2 to 5 m across
          mat3 cRm = rotAx(normalize(aR.xyz - 0.5 + vec3(0.013)), cA * mix(2.0 + 9.0 * aR.w, 1.3, cBig) + aR.x * 20.0);
          vec3 objectNormal = cRm * normal;`);
        s.v('#include <begin_vertex>', `vec3 cE1, cE2; axFrame(uAx, cE1, cE2); vec3 cD = normalize(cE1 * aD.x + uAx * aD.y + cE2 * aD.z);
          float cV0 = mix(6.0 + 26.0 * aR.y * aR.y, 3.5 + 6.0 * aR.y, cBig), cS = cV0 * (1.0 - exp(-0.35 * cA)) / 0.35;
          vec3 cC = uO + cD * (0.6 + cS) + (cE1 * (aR.x - 0.5) + cE2 * (aR.z - 0.5)) * mix(3.0, 9.0, cBig) + vec3(0.0, -7.0 * cA * cA, 0.0);      // the slab's pieces start side by side on the face
          float cSz = mix((0.16 + 0.62 * aR.z * aR.z) * (1.15 - 0.6 * aR.y), 0.8 + 1.2 * aR.z, cBig) * cK; vTint = aR.w * (1.0 - 0.55 * cBig);
          vec3 transformed = cC + cRm * (position * vec3(1.0, 0.6 + 0.5 * aR.y, 0.8)) * cSz;`);
        s.fHead('varying float vTint;');
        s.f('#include <color_fragment>', 'diffuseColor.rgb *= 0.72 + 0.62 * vTint;');
      }, 'fxchunk');
      const me = new THREE.Mesh(g, m); me.frustumCulled = false; me.visible = false; me.receiveShadow = true; scene.add(me); S.chunks = { mesh: me, u: cu }; }
    prog(0.72); await tick();

    // ================= SPLASH: the knot hits the lake =================
    // The water it throws is SURFACE, not sprites: sheets of white water, each a ring of the lake launched upward at once. A sheet is a grid
    // (aU round the ring, aV = when that row left the water); every vertex flies a closed-form path: out along its launch line as far as its
    // reach (drag stops it within a fifth of a second, so the column stands 30 m tall on the beat), then down under gravity. The fragment
    // stage tears the sheet into fingers toward its leading edge and into rain as it ages. One geometry, one program:
    //   burst mode  (uK2.w = 0)  rows leave over uK.w seconds from the event: the crown, the column, the two exit crowns
    //   steady mode (uK2.w = 1)  rows are ages 0..uLife of an endless fountain: the white-water collar where a body stands in the lake
    const sheetG = (nu, nv) => { const u = [], idx = []; for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) u.push(i / nu, j / nv);
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((nu + 1) * (nv + 1) * 3), 3)); g.setAttribute('aQ', new THREE.Float32BufferAttribute(u, 2)); g.setIndex(idx); return g; };
    const SHEET_GL = /* glsl */`
      float rn(float th, float s){ return 0.5 + 0.27 * sin(th * 2.0 + s * 1.7) + 0.16 * sin(th * 5.0 - s * 2.3) + 0.10 * sin(th * 11.0 + s * 4.1); }
      // the fingers of a splash: the same function shapes the sheet (where it reaches furthest) and tears it (what survives toward the tip)
      float fing(float th, float s){ return 0.5 + 0.20 * sin(th * 7.0 + s * 1.7) + 0.15 * sin(th * 13.0 - s * 2.3) + 0.11 * sin(th * 23.0 + s * 4.1) + 0.07 * sin(th * 41.0 + s * 0.6); }`;
    const SHEET_VS = /* glsl */`${GLSL_NOISE}${GL_AX}${SHEET_GL} attribute vec2 aQ; uniform float uT, uLife; uniform vec3 uO, uAx; uniform vec4 uK, uK2;      // uK = ring radius, reach, flare, emission seconds; uK2 = drag, gravity, seed, mode
      varying vec2 vQ; varying float vVZ, vAge, vLead, vLit, vF; varying vec3 vW;
      void main(){ float th = aQ.x * 6.2831853, sd = uK2.z, steady = step(0.5, uK2.w);
        float tau = aQ.y * aQ.y * uK.w, a = mix(uT - tau, aQ.y * uLife, steady), born = step(0.0, a); a = max(a, 0.0);      // most of a sheet leaves in the first instants
        float n1 = rn(th, sd), n2 = rn(th * 3.0 + 1.3, sd + 5.0), fg = clamp(fing(th, sd), 0.0, 1.0);
        float pw = mix(1.0 - 0.74 * aQ.y, 1.0, steady);                                             // what leaves later leaves with less
        float reach = uK.y * (0.46 + 0.28 * n1 + 0.50 * fg * fg) * pw, s = reach * (1.0 - exp(-uK2.x * a)), f = min(s / max(uK.y, 1e-3), 1.0);
        vec3 e1, e2; axFrame(uAx, e1, e2); vec3 rad = e1 * cos(th) + e2 * sin(th);
        float fl = uK.z * (0.55 + 0.45 * n2);
        vec3 dir = normalize(uAx + rad * fl * (0.45 + 1.05 * f));                                   // a tulip: it opens as it climbs
        vec3 p = uO + rad * (uK.x * (0.9 + 0.3 * n1)) + dir * s;
        p += rad * (sin(th * 9.0 + a * 5.0 + sd) * 0.035 + sin(th * 21.0 - a * 7.0) * 0.018) * s; p.y -= 0.5 * uK2.y * a * a;        // it wrinkles as it flies, then gravity has it
        p = mix(uO + rad * uK.x, p, born);
        vec4 mv = viewMatrix * vec4(p, 1.0); vVZ = mv.z; vW = p; vQ = aQ; vAge = a; vLead = mix(1.0 - aQ.y, aQ.y, steady); vF = fg;
        vec3 nrm = normalize(rad + uAx * 0.35); float nv = dot(nrm, normalize(cameraPosition - p));
        vLit = clamp(0.55 + 0.45 * dot(nrm * sign(nv + 1e-4), SUN_DIR), 0.0, 1.0);                 // the wall you look at is the one the low sun behind the lens lights
        gl_Position = projectionMatrix * mv; }`;
    const SHEET_FS = /* glsl */`${FXD}${SHEET_GL} uniform sampler2D tNoise; uniform float uT, uGain, uLife, uOld; uniform vec3 uO, uC0, uC1; uniform vec4 uK, uK2;
      varying vec2 vQ; varying float vVZ, vAge, vLead, vLit, vF; varying vec3 vW;
      void main(){ float h = vW.y - uO.y, steady = step(0.5, uK2.w), th = vQ.x * 6.2831853, w = mix(vQ.y * 1.25, (uT - vAge) * 0.9, steady);      // the pattern belongs to the water: a row keeps the look it left the lake with
        float st = texture2D(tNoise, vec2(vQ.x * 13.0 + uK2.z * 0.37, w * 0.25)).r, st2 = texture2D(tNoise, vec2(vQ.x * 37.0 - uK2.z * 0.21, w * 0.6 + 0.3)).g, hol = texture2D(tNoise, vec2(vQ.x * 9.0 + 0.5, w * 2.6 + 0.7)).b;
        float fg = clamp(fing(th, uK2.z), 0.0, 1.0), ridge = fg * 0.55 + st * 0.30 + st2 * 0.25;      // long streaks drawn out along the throw, strongest in the fingers
        float lead = pow(vLead, 1.25), old = uOld + 0.12 * steady;
        float tf = mix(0.16, 0.70, lead) + 0.50 * old, af = smoothstep(tf, tf + 0.10, ridge);       // fingers: they taper to a point and outlast what hangs between them
        float bk = lead * lead * 0.9 + 0.6 * old; if (af > 0.0 && bk > 0.05) af *= mix(1.0, smoothstep(0.34, 0.52, texture2D(tNoise, vec2(vQ.x * 31.0 + 0.2, w * 5.5 - uK2.z)).r), bk);      // toward its tip a finger breaks into beads
        float tm = 0.22 + 0.46 * lead + 0.60 * old, am = smoothstep(tm, tm + 0.24, hol * 0.75 + ridge * 0.35) * 0.80;      // the membrane between them, full of holes
        float a = max(af, am) * smoothstep(-0.4, 0.5, h);
        a *= mix(smoothstep(0.0, 0.02, vAge), smoothstep(1.0, 0.70, vQ.y) * smoothstep(0.0, 0.08, vQ.y), steady);
        float dense = clamp(af * (0.35 + 0.65 * smoothstep(tf, tf + 0.45, ridge)) + 0.5 * (1.0 - lead) * am, 0.0, 1.0);      // dense water is white; thin water takes the dusk and lets the valley through
        vec3 c = mix(uC1, uC0, clamp(vLit * (0.22 + 0.90 * dense) + 0.55 * (st2 - 0.45) + 0.25 * (st - 0.5), 0.0, 1.0)) * (0.80 + 0.30 * dense);
        a *= (0.50 + 0.50 * dense) * uGain * softZ(vVZ, 2.5) * smoothstep(7.0, 17.0, -vVZ);                    // nothing of it hangs right in front of the glass
        gl_FragColor = vec4(c * a, a); }`;
    const sheetGeo = sheetG(144, 26), collarGeo = sheetG(72, 10);
    const sheet = (geo, r0, reach, flare, E, drag, grav, seed, gain, order = 2) => { const o = fxMesh(geo, SHEET_VS, SHEET_FS, { uT: { value: 0 }, uLife: { value: 1 }, uOld: { value: 0 }, uO: { value: V() }, uAx: { value: V(0, 1, 0) }, uK: { value: V4(r0, reach, flare, E) }, uK2: { value: V4(drag, grav, seed, 0) },
      uC0: { value: V(1.70, 1.40, 1.26) }, uC1: { value: V(0.50, 0.37, 0.50) }, uGain: { value: gain } }, order); o.gain = gain; return o; };
    S.crown = sheet(sheetGeo, 5.6, 18, 0.50, 0.30, 8.5, 8.5, 1.0, 0.90);                               // the crown: a wide bowl thrown outward, its near wall at the lens
    S.column = sheet(sheetGeo, 2.6, 36, 0.10, 0.55, 9.0, 9.0, 4.0, 0.95);                              // the column in its middle
    // Where a body stands in or passes through the surface: a thin film of water climbs it (glassy, the body shows through), tears white
    // only along its top edge and falls back, over a low boil of broken water at its foot. Nothing here is a shape: the tongues of the film
    // are three waves running round the body at different speeds plus a jitter redrawn every other frame, and the white is cells of noise
    // re-read every frame. uK = ring radius, climb (m), strength, seed; uAx = the way the body leaves the water.
    const COLLAR_VS = /* glsl */`attribute vec2 aQ; uniform float uT; uniform vec3 uO, uAx; uniform vec4 uK; varying vec2 vQ; varying float vVZ, vLit, vTg;
      void main(){ float th = aQ.x * 6.2831853, v = aQ.y, sd = uK.w, f2 = floor(uT * 30.0);
        float tg = 0.52 + 0.22 * sin(th * 3.0 + uT * 9.0 + sd) + 0.16 * sin(th * 7.0 - uT * 15.0 + sd * 2.1) + 0.12 * sin(th * 13.0 + uT * 24.0 + sd * 0.7)
          + 0.22 * (fract(sin((floor(aQ.x * 36.0) + f2 * 7.13 + sd) * 12.9898) * 43758.5453) - 0.5);
        tg = clamp(tg, 0.06, 1.0); vTg = tg;
        vec3 rad = vec3(cos(th), 0.0, sin(th)); float skirt = 1.0 - smoothstep(0.0, 0.2, v);
        float R = uK.x * (1.03 + 0.34 * skirt * skirt + 0.02 * sin(th * 17.0 + uT * 31.0)), up = v * uK.y * tg;
        vec3 p = uO + uAx * up + rad * R; p.y += 0.04;
        vec4 mv = viewMatrix * vec4(p, 1.0); vVZ = mv.z; vQ = aQ;
        vec3 nrm = normalize(rad + vec3(0.0, 0.3, 0.0)); float nv = dot(nrm, normalize(cameraPosition - p));
        vLit = clamp(0.5 + 0.5 * dot(nrm * sign(nv + 1e-4), SUN_DIR), 0.0, 1.0);
        gl_Position = projectionMatrix * mv; }`;
    const COLLAR_FS = /* glsl */`${FXD} uniform sampler2D tNoise; uniform float uT, uGain; uniform vec4 uK; uniform vec3 uC0, uC1; varying vec2 vQ; varying float vVZ, vLit, vTg;
      void main(){ float v = vQ.y, f1 = floor(uT * 60.0), f2 = floor(uT * 30.0), m = v * uK.y * vTg;                // m: metres up the body
        float run = texture2D(tNoise, vec2(vQ.x * 11.0 + uK.w, m * 0.22 - uT * 2.9)).r, run2 = texture2D(tNoise, vec2(vQ.x * 29.0 - uK.w, m * 0.5 - uT * 4.6)).g;      // water running up the film
        float cell = texture2D(tNoise, vec2(vQ.x * 21.0 + f2 * 0.371, m * 0.9 + f2 * 0.619)).b, cel2 = texture2D(tNoise, vec2(vQ.x * 37.0 - f1 * 0.293, m * 2.1 + f1 * 0.557)).r;
        float top = smoothstep(0.50, 0.98, v + (run - 0.5) * 0.55);                                                 // the torn top edge
        float white = top * smoothstep(0.40, 0.56, cell * 0.6 + cel2 * 0.4 + 0.10 * top);
        float boil = (1.0 - smoothstep(0.08, 0.24, v)) * smoothstep(0.47, 0.55, cel2 * 0.65 + cell * 0.35);          // broken water at the foot: two fifths of it is holes
        float rill = smoothstep(0.60, 0.70, run2) * (1.0 - top) * 0.55;                                              // bright threads in the glass
        float film = 0.13 * (0.6 + 0.8 * run) * (1.0 - 0.6 * top);
        float wht = max(max(white, boil), rill), a = max(wht * 0.92, film) * smoothstep(1.0, 0.90, v) * smoothstep(0.0, 0.03, v);
        vec3 c = mix(uC1 * (0.55 + 0.9 * run), uC0 * (0.50 + 0.62 * vLit) * (0.85 + 0.3 * cel2), clamp(wht, 0.0, 1.0));
        a *= uGain * softZ(vVZ, 0.6) * smoothstep(5.0, 12.0, -vVZ);
        gl_FragColor = vec4(c * a, a); }`;
    S.collar = []; for (let i = 0; i < 6; i++) { const c = fxMesh(collarGeo, `${GLSL_NOISE}${COLLAR_VS}`, COLLAR_FS, { uT: { value: 0 }, uO: { value: V() }, uAx: { value: V(0, 1, 0) }, uK: { value: V4(3.4, 2, 1, 20 + i * 3.1) },
      uC0: { value: V(1.62, 1.50, 1.42) }, uC1: { value: V(0.20, 0.30, 0.30) }, uGain: { value: 1 } }); c.gain = 1; S.collar.push(c); }
    S.cross = Array.from({ length: 6 }, () => V4()); S.colAx = Array.from({ length: 6 }, () => V(0, 1, 0));
    // water on the lens: 28 drops, each one small quad drawn straight in screen space on top of everything. A drop lands, streaks away from
    // where the spray came from (thin where it started, a fat bead at its head) and dries; inside it the valley shows displaced, as through a lens.
    S.wet = sprites(28, { aH: [4, (i, r) => [r(), r(), r(), r()]], aG: [2, i => [i % 7, (i / 7) | 0]] }, { seed: 79, pm: true, uniforms: { uWet: { value: V4(0, 0, 0.5, 0.3) } },
      vs: `attribute vec4 aH; attribute vec2 aG; uniform vec4 uWet; uniform vec2 uRes; varying vec2 vL, vAx; varying vec4 vP;      // uWet = wetness, seconds since the water reached the glass, where it came from (uv)
        void main(){ float asp = uRes.x / uRes.y; vec2 c0 = (aG + 0.5 + (aH.xy - 0.5) * 0.8) / vec2(7.0, 4.0), away = (c0 - uWet.zw) * vec2(asp, 1.0); float al = length(away); away /= max(al, 1e-4);
          float a = uWet.y - (0.02 + 0.22 * aH.z + 0.10 * al);
          vec2 ax = normalize(away * 0.5 + vec2(0.0, -0.8)); float len = (0.012 + 0.05 * aH.y * aH.y) * (1.0 - exp(-max(a, 0.0) * 5.0)), rd = 0.006 + 0.012 * aH.x * aH.x;      // a bead lands, then creeps down the glass
          float along = mix(-rd, len + rd, position.x + 0.5), across = position.y * 2.0 * rd; vec2 p = c0 * vec2(asp, 1.0) + ax * along + vec2(-ax.y, ax.x) * across;
          vL = vec2(along, across); vAx = ax; vP = vec4(len, rd, a, aH.z);
          gl_Position = a < 0.0 || uWet.x <= 0.0 || aH.w > 0.72 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(p.x / asp * 2.0 - 1.0, p.y * 2.0 - 1.0, 0.0, 1.0); }`,
      fs: `uniform sampler2D tScene; uniform vec4 uWet; uniform vec2 uRes; varying vec2 vL, vAx; varying vec4 vP;
        void main(){ float len = vP.x, rd = vP.y, asp = uRes.x / uRes.y, tl = clamp(vL.x / max(len, 1e-4), 0.0, 1.0), wd = rd * (0.30 + 0.70 * tl * tl);
          vec2 nrm = vec2(vL.x - clamp(vL.x, 0.0, len), vL.y) / wd; float dd = length(nrm);
          float k = (1.0 - smoothstep(0.70, 1.0, dd)) * (1.0 - smoothstep(0.40, 0.80, vP.z + 0.2 * vP.w)) * (0.25 + 0.75 * tl) * uWet.x;
          vec2 off = (vAx * nrm.x + vec2(-vAx.y, vAx.x) * nrm.y) * wd * vec2(1.0 / asp, 1.0), uv = gl_FragCoord.xy / uRes - off * (1.0 + 1.5 * dd * dd);      // the picture inside is the valley upside down and small, as in any drop
          vec3 c = texture2D(tScene, uv).rgb * (1.0 - 0.16 * smoothstep(0.75, 1.0, dd)) + vec3(1.6, 1.5, 1.4) * tl * (smoothstep(0.40, 0.05, length(nrm - vec2(0.2, 0.42))) * 0.5 + 0.10 * smoothstep(0.55, 0.9, dd) * smoothstep(-0.2, 0.8, nrm.y));
          gl_FragColor = vec4(c * k, k); }` });
    S.wet.renderOrder = 9; S.wet.visible = false; fx.add(S.wet);
    S.drops = setB(burst(2300, dCrown, 71, 'water'), 150, 2.3, 12.5, 3.7, 0.16, 0.034, 0.30, 0.25, [1.75, 1.62, 1.55], [1.05, 1.02, 1.10], 1, 0.6);      // thrown 20 to 65 m up: they are still raining back two and a half seconds later
    // the spray the crown throws up: fine soft streaks
    S.sheet = setB(burst(1200, dCrown, 72, 'spray'), 128, 4.4, 11.5, 2.7, 0.72, 0.026, 0.30, 0.6, [1.55, 1.30, 1.26], [0.80, 0.58, 0.64], 0.30, 0.30);
    // the body of the column: aerated water, soft and eroded, rising inside the sheets and sinking back as rain
    S.plume = setB(burst(60, dCone(0, 0.30), 76, true), 150, 4.8, 9.0, 2.2, 2.6, 0, 0.42, 0.5, [1.50, 1.25, 1.16], [0.56, 0.42, 0.52], 0.36, 1);
    // the mist that rolls out across the lake: ONE low bank. Wide flat puffs with no outline of their own (a smooth hill of density),
    // each only a few percent opaque, all eroded by the same noise field read at world positions, cut off by height above the water.
    S.bank = sprites(330, { aR: [4, (i, r) => [r(), r(), r(), r()]] }, {
      seed: 73, pm: true, uniforms: { uO: { value: V() }, uT: { value: 0 }, uBk: { value: V4(12, 0.6, 4.0, 10.0) }, uC0: { value: V(1.32, 1.04, 1.0) }, uC1: { value: V(0.62, 0.43, 0.50) }, uGain: { value: 0.055 } },
      vs: `attribute vec4 aR; uniform vec3 uO; uniform float uT; uniform vec4 uBk; varying vec2 vUv; varying float vVZ, vA; varying vec3 vW;      // uBk = reach (m), birth spread (s), life (s), top (m)
        void main(){ float a = uT - aR.x * uBk.y, life = uBk.z * (0.72 + 0.4 * aR.w), lf = clamp(a / life, 0.0, 1.0);
          float ang = aR.y * 6.283 + 0.3 * sin(a * 0.35 + aR.w * 9.0), rad = 1.5 + uBk.x * (1.0 - exp(-a * 0.5)) * (0.14 + 0.92 * sqrt(aR.z));      // the front rolls out and slows; the bank fills in behind it
          float hw = (2.2 + 4.2 * sqrt(lf)) * (0.75 + 0.5 * aR.w), hh = hw * 0.62;
          vec3 c = uO + vec3(cos(ang) * rad - 2.6 * a, 0.2 + hh * 0.5 + 1.1 * a * aR.x, sin(ang) * rad + 0.7 * a);
          vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), cu = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          vec3 w = c + cr * (position.x * 2.0 * hw) + cu * (position.y * 2.0 * hh); vW = w; vec4 mv = viewMatrix * vec4(w, 1.0); vVZ = mv.z; vUv = position.xy * 2.0;
          vA = step(0.0, a) * smoothstep(0.0, 0.08, lf) * (1.0 - smoothstep(0.30, 1.0, lf));
          gl_Position = projectionMatrix * mv; if (vA <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
      fs: `${FXD} uniform sampler2D tNoise; uniform vec3 uC0, uC1, uO; uniform vec4 uBk; uniform float uGain, uT; varying vec2 vUv; varying float vVZ, vA; varying vec3 vW;
        void main(){ float prof = max(1.0 - dot(vUv, vUv), 0.0); prof *= prof; float h = vW.y - uO.y;
          float n = texture2D(tNoise, vW.xz * 0.021 + vec2(uT * 0.010, -uT * 0.006)).r * 0.62 + texture2D(tNoise, vec2(vW.x + vW.z, vW.y * 1.8) * 0.043 + vec2(-uT * 0.017, uT * 0.012)).g * 0.38;
          float ero = smoothstep(0.34, 0.62, n + 0.30 * prof - 0.36 * (1.0 - vA));                                   // it thins by tearing into wisps, not by fading evenly
          float hk = (1.0 - smoothstep(uBk.w * 0.22, uBk.w * (0.35 + 1.35 * n), h)) * smoothstep(-0.8, 0.6, h);     // a billowing top a few metres up; nothing below the water
          float a = prof * ero * hk * vA * uGain * softZ(vVZ, 4.0) * smoothstep(7.0, 26.0, -vVZ);
          vec3 c = mix(uC1, uC0, clamp(0.22 + 0.55 * smoothstep(0.0, uBk.w, h) + 0.6 * (n - 0.45), 0.0, 1.0));
          gl_FragColor = vec4(c * a, a); }` });
    S.bank.renderOrder = 1; S.bank.visible = false; fx.add(S.bank);
    // where each loong bursts out of the lake again: found on its own head rail (the first moment after SPLASH that the head is back above
    // the water), so the two exit crowns follow whatever the choreography does. No dive, no crown.
    S.exits = []; { const wy = Film.A.splash.y; let sd = 74;
      for (const d of [Dragon.red, Dragon.white]) { let below = false, te = -1;
        for (let k = 0; k <= 90 && te < 0; k++) { const tt = F.SPLASH - 0.3 + k * 0.05; d.headAt(tt, tA); if (tA.y < wy - 0.6) below = true; else if (below && tA.y > wy + 0.3) te = tt; }
        if (te < 0) continue;
        d.headAt(te, tA); d.headAt(te + 0.1, tB).sub(tA).multiplyScalar(10);                              // the head's velocity as it breaks the surface
        const ax = tB.clone().multiplyScalar(0.012).add(V(0, 1, 0)).normalize(), p = V(tA.x, wy, tA.z);
        S.exits.push({ t: te - 0.04, p, ax, crown: sheet(sheetGeo, 3.3, 17, 0.42, 0.40, 8.0, 9.0, 7 + sd, 0.9),
          drops: setB(burst(800, dCrown, sd++, 'water'), 112, 4.4, 12.5, 2.8, 0.15, 0.034, 0.8, 0.25, [1.75, 1.62, 1.55], [1.05, 1.02, 1.10], 1, 0.6),
          spray: setB(burst(520, dCrown, sd++, 'spray'), 100, 4.6, 11.5, 2.4, 0.60, 0.030, 0.9, 0.6, [1.55, 1.30, 1.26], [0.80, 0.58, 0.64], 0.20, 0.20) }); } }

    // ================= water shed by a body that has just left the lake =================
    // For three seconds after any part of a loong comes up out of the water it pours: veils off the belly plates and the flanks, strings
    // off the beard, the jaw, the mane and the whiskers, all of it flung the way the body is going and then left to gravity. Each body is
    // posed through every wet stretch of the film once, here (Dragon.spine(t) is pure and touches no mesh); a drop takes its birth place,
    // birth velocity and birth time from that pose, and after that it is a closed-form fall. Nothing is remembered between frames.
    const SHED_VS = /* glsl */`${GL_AX} attribute vec3 aP, aV; attribute vec4 aT; uniform float uTime, uFloor; varying vec2 vUv; varying float vVZ, vA;      // aT = birth time, life, 1 = veil, random
      vec3 at(float a){ return aP + aV * ((1.0 - exp(-1.3 * a)) / 1.3) + vec3(0.0, -4.9 * a * a, 0.0); }
      void main(){ float a = uTime - aT.x, kd = aT.z, k = step(0.0, a) * step(a, aT.y), lf = a / aT.y;
        float spd = length(aV) * exp(-1.3 * a) + 9.8 * a; vec3 p = at(a), pp = at(max(a - min(mix(0.085, 0.30, kd), mix(0.7, 2.2, kd) / max(spd, 1.0)), 0.0)); k *= step(uFloor, p.y);      // a bead's streak is longer than the gap to the bead behind it: near the hair they join into a string, lower down they part into drops
        float w0 = mix(0.009 + 0.030 * aT.w * aT.w * aT.w, 0.10 + 0.20 * aT.w, kd), sz = max(w0, -(viewMatrix * vec4(p, 1.0)).z * 0.00072), vz;
        gl_Position = streakQuad(p, pp, sz, vz); vUv = position.xy * 2.0; vVZ = vz;
        vA = k * min(1.0, w0 / sz) * smoothstep(0.0, 0.03, a) * mix(1.0 - 0.5 * lf, 0.46 * (1.0 - lf) * smoothstep(0.0, 0.15, lf), kd);
        if (k < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`;
    const SHED_FS = /* glsl */`${FXD} uniform vec3 uC0; uniform float uNorm; varying vec2 vUv; varying float vVZ, vA;
      void main(){ float d = 1.0 - clamp(length(vUv), 0.0, 1.0); float a = d * (0.4 + 0.6 * d) * vA * softZ(vVZ, 0.15);
        gl_FragColor = vec4(uC0 * a, a * uNorm); }`;
    S.shed = []; { const tS0 = performance.now(), wy = Film.A.splash.y, cam0 = G.camera.position.clone(), DT = 1 / 30, X = V(), T = V(), Dn = V(), Sd = V(), hp = V(), hPrev = V();
      // emitters on the head, in metres right / up / forward of the mouth for red (white: times its scale), read off the sculpt in 58_dlook.js:
      // the chin beard hangs 3 to 6 m down and back from the jaw, the cheek mane stands 3 to 6 m out to each side, the barbels run out and down
      const HEADPTS = []; { const r = rng(331); for (let i = 0; i < 48; i++) { const k = i % 4, sg = r() < 0.5 ? -1 : 1, s = 0.45 + 0.55 * r(), L = 2.75 + 3.2 * r();
        HEADPTS.push(k < 2 ? [(r() * 2 - 1) * 0.85, -1.25 - 0.86 * L * s, 0.6 - 2.2 * r() - 0.5 * L * s]           // along the beard, most of it from the tips
          : k === 2 ? (r() < 0.5 ? [sg * (0.5 + 0.9 * r()), -0.35 - 0.6 * r(), 0.2 - 2.6 * r()]                     // teeth, lips and jaw line
            : [sg * (1.0 + 5.5 * s), -0.3 - 2.6 * s * s, 1.2 + 0.8 * s])                                            // the barbels
          : [sg * (2.4 + 3.4 * r()), 0.4 - 3.6 * r(), -1.2 - 2.8 * r()]); } }                                       // the cheek mane
      const mk = (dr, tA0, tA1, N, seed, rateB, rateH) => {
        if (!dr || typeof dr.spine !== 'function' || !dr.C || !dr.rProf) return null;
        const r = rng(seed), NS = dr.NS, C = dr.C, st = dr.st, STEP = 3, M = Math.floor(NS / STEP) + 1, K = dr.K || 1;
        const last = new Float32Array(M).fill(-1e9), prev = new Float32Array(M * 3), out = []; let hLast = -1e9, first = true;      // out: 10 numbers a drop (place, velocity, birth, life, veil, random)
        const steps = Math.ceil((tA1 - tA0) / DT);
        for (let i = 0; i <= steps; i++) { const t = tA0 + i * DT; Film.camAt(t, G.camera.position); dr.spine(t); const vis = st.vis > 0.5;      // (red's gaze follows the lens)
          for (let m = 0; m < M; m++) { const j = Math.min(NS, m * STEP), k3 = j * 3, rr = dr.RMAX * dr.rProf(dr.LEN * j / NS), x = C[k3], y = C[k3 + 1], z = C[k3 + 2];
            if (y - rr < wy + 1.5) last[m] = t;                                                      // in the water, or low enough over it to be drenched by its own spray
            const tau = t - last[m];
            if (!first && vis && rr > 0.12 && tau > 0.03 && tau < 3.4 && y - 0.45 * rr > wy) { const cnt = Math.floor(rateB * rr * Math.exp(-tau / 1.15) * DT + r());
              if (cnt > 0) { const jn = Math.min(NS, j + 1) * 3, jp = Math.max(0, j - 1) * 3; T.set(C[jn] - C[jp], C[jn + 1] - C[jp + 1], C[jn + 2] - C[jp + 2]).normalize();
                Dn.set(0, -1, 0).addScaledVector(T, T.y); const dl = Dn.length(), col = dl < 0.35;         // col: this stretch stands like a column, so water runs down it all round
                if (col) Dn.set(1, 0, 0).addScaledVector(T, -T.x).normalize(); else Dn.multiplyScalar(1 / dl);
                Sd.crossVectors(T, Dn);
                const vx = (x - prev[m * 3]) / DT, vy = (y - prev[m * 3 + 1]) / DT, vz = (z - prev[m * 3 + 2]) / DT;
                for (let q = 0; q < cnt; q++) { const ph = col ? r() * TAU : (r() * 2 - 1) * 1.25, cs = Math.cos(ph), sn = Math.sin(ph), al = (r() - 0.5) * 1.7, veil = tau < 1.6 && r() < 0.42 ? 1 : 0, f = r() * DT;
                  const ox = Dn.x * cs + Sd.x * sn, oy = Dn.y * cs + Sd.y * sn, oz = Dn.z * cs + Sd.z * sn, ko = 0.4 + 1.1 * r();
                  out.push(x + ox * rr * 1.07 + T.x * al - vx * f, y + oy * rr * 1.07 + T.y * al - vy * f, z + oz * rr * 1.07 + T.z * al - vz * f,
                    vx * 0.5 + ox * ko, vy * (vy > 0 ? 0.3 : 0.6) + oy * ko - (col ? 2.2 : 0.6), vz * 0.5 + oz * ko, t - f, veil ? 0.5 + 0.45 * r() : 0.9 + 1.0 * r(), veil, r()); } } }
            prev[m * 3] = x; prev[m * 3 + 1] = y; prev[m * 3 + 2] = z; }
          hp.copy(st.mouth); if (st.mouth.y - 5.0 * K < wy) hLast = t;                                   // this low over the lake the beard trails in it and the bow spray drenches the rest
          const tauH = t - hLast;
          if (!first && vis && tauH > 0.03 && tauH < 3.8) { X.crossVectors(st.up, st.fwd).normalize();
            const vx = (hp.x - hPrev.x) / DT, vy = (hp.y - hPrev.y) / DT, vz = (hp.z - hPrev.z) / DT, nH = rateH * Math.exp(-tauH / 1.5) * DT;
            for (let e = 0; e < HEADPTS.length; e++) { const cnt = Math.floor(nH * (0.5 + hsh(e * 3.3 + seed)) + r()); if (!cnt) continue; const h = HEADPTS[e], lx = h[0] * K, ly = h[1] * K, lz = h[2] * K;
              const bx = hp.x + X.x * lx + st.up.x * ly + st.fwd.x * lz, by = hp.y + X.y * lx + st.up.y * ly + st.fwd.y * lz, bz = hp.z + X.z * lx + st.up.z * ly + st.fwd.z * lz;
              for (let q = 0; q < cnt; q++) { const f = r() * DT; out.push(bx - vx * f + (r() - 0.5) * 0.05, by - vy * f, bz - vz * f + (r() - 0.5) * 0.05, vx * 0.6 + (r() - 0.5) * 0.28, vy * (vy > 0 ? 0.35 : 0.6) - 0.3 * r(), vz * 0.6 + (r() - 0.5) * 0.28, t - f, 1.0 + 0.9 * r(), 0, r()); } } }
          hPrev.copy(hp); first = false; }
        const total = out.length / 10, n = Math.min(N, total); if (!n) return null;
        const pick = new Int32Array(n); for (let i = 0; i < n; i++) pick[i] = Math.min(total - 1, Math.floor((i + r()) * total / n));      // more candidates than instances: an even sample of them
        const me = sprites(n, { aP: [3, i => { const o = pick[i] * 10; return [out[o], out[o + 1], out[o + 2]]; }], aV: [3, i => { const o = pick[i] * 10; return [out[o + 3], out[o + 4], out[o + 5]]; }], aT: [4, i => { const o = pick[i] * 10; return [out[o + 6], out[o + 7], out[o + 8], out[o + 9]]; }] },
          { seed, pm: true, uniforms: { uFloor: { value: wy }, uC0: { value: V(3.3, 3.1, 2.9) }, uNorm: { value: 0.45 } }, vs: SHED_VS, fs: SHED_FS });
        me.renderOrder = 2; me.visible = false; fx.add(me); return { mesh: me, t0: tA0, t1: tA1 + 2.0, n, total }; };
      try { S.shed = [mk(Dragon.red, 19.45, 26.0, 22000, 301, 105, 96), mk(Dragon.red, F.SPLASH - 0.15, F.SPLASH + 6.0, 6000, 302, 60, 46), mk(Dragon.white, F.SPLASH - 0.15, F.SPLASH + 6.0, 6000, 303, 60, 46)].filter(Boolean); } catch (e) { console.warn('shed water skipped', e && e.message); S.shed = []; }
      G.camera.position.copy(cam0); G.info.shed = { ms: Math.round(performance.now() - tS0), drops: S.shed.map(s => [s.n, s.total]) }; }

    // ================= BEAM: the two jets meet =================
    // the ball where they meet: a white-hot core, fire on red's side and ice on white's, boiling outward
    const ballM = () => fxMesh(quad, CARD_VS, /* glsl */`${GLSL_NOISE}${FXD} uniform float uTime, uRad, uHeat, uMono; uniform vec2 uSide; varying vec2 vUv; varying float vVZ;
        void main(){ vec2 q = vUv; float r = length(q), t = uTime; vec2 nq = q / max(r, 1e-4); float sd = dot(nq, uSide);
          vec2 w = vec2(fbm2(q * 2.3 + vec2(0.0, t * 1.7)), fbm2(q * 2.3 + vec2(5.2, -t * 1.4))) - 0.5; vec2 qq = q + w * 0.34; float rr = length(qq);       // the whole thing boils
          float n = fbm2(qq * 3.4 - nq * t * 2.2 + 11.0), m = fbm2(qq * 7.5 - nq * t * 3.8 + 3.0);
          float rc = uRad * (0.82 + 0.55 * n), cr = smoothstep(rc, rc * 0.45, rr);
          float reach = 0.15 + 0.48 * pow(vnoise(nq * 2.2 + vec2(t * 0.9, -t * 0.7) + 4.0) * 0.62 + vnoise(nq * 4.7 - vec2(t * 1.1, t * 0.8)) * 0.38, 1.6) + 0.13 * m;      // broad tongues: flames reach further in some directions
          float fl = clamp(1.0 - (rr - rc) / reach, 0.0, 1.0); fl = fl * fl * (0.30 + 1.3 * m);
          float sw = max(smoothstep(-0.5, 0.5, sd + (n - 0.5) * 1.1), uMono);                                       // uMono 1 = all fire (the rolling head of the chase flame)
          vec3 fire = mix(vec3(3.0, 0.50, 0.04), vec3(6.4, 2.7, 0.45), fl), ice = mix(vec3(0.20, 0.75, 2.9), vec3(1.6, 3.6, 6.8), fl);
          vec3 hot = mix(vec3(4.6, 7.4, 11.5), vec3(11.5, 7.6, 3.4), sw);                                                       // even the core keeps its two sides: frost-white against gold-white
          vec3 c = mix(hot, vec3(9.5, 9.0, 8.4), smoothstep(0.6, 1.0, cr) * 0.4) * cr + mix(ice, fire, sw) * fl * 1.7 * (1.0 - 0.6 * cr) + mix(vec3(0.5, 0.9, 1.7), vec3(1.7, 0.8, 0.3), sw) * exp(-r * 4.5) * 0.5;
          gl_FragColor = vec4(c * smoothstep(1.0, 0.8, r) * uHeat * softZ(vVZ, 4.0), 0.0); }`,
      { uP: { value: V() }, uS: { value: new THREE.Vector2(1, 1) }, uRot: { value: 0 }, uBias: { value: 0 }, uRad: { value: 0.3 }, uHeat: { value: 1 }, uMono: { value: 0 }, uSide: { value: new THREE.Vector2(-1, 0) } });
    S.ball = ballM(); S.fhead = ballM(); S.fhead.u.uMono.value = 1;
    // rime: the cold fog that rolls off whatever white's breath lands on (a loop of soft puffs born at the hit)
    S.rime = setB(burst(64, dSphere, 83, true), 13, 1.5, -1.2, 1.5, 2.3, 0, 0, 0.9, [1.25, 1.55, 2.1], [0.50, 0.66, 1.0], 0.5, 0.5); S.rime.u.uLoop.value = 1;
    S.frostHit = glow();
    S.dEmb = setB(burst(190, dSphere, 81), 36, 1.3, 2, 1.5, 0.12, 0.06, 0, 1.2, [10, 3.0, 0.45], [3, 0.4, 0.04], 1); S.dEmb.u.uLoop.value = 1;
    S.dIce = setB(burst(190, dSphere, 82), 36, 1.3, 2, 1.5, 0.11, 0.06, 0, 1.2, [3.4, 6.4, 12], [0.6, 1.5, 4.4], 1); S.dIce.u.uLoop.value = 1;

    // ================= BLAST =================
    S.bEmb = setB(burst(800, dSphere, 91), 170, 2.6, 13, 5.5, 0.10, 0.026, 0.45, 1.6, [9, 2.8, 0.45], [2.6, 0.30, 0.03], 0.8); S.bEmb.u.uHv.value = 1;
    S.bIce = setB(burst(700, dSphere, 92, 'flake'), 150, 2.4, 5.5, 5.2, 0.15, 0, 0.45, 1.6, [3.4, 5.4, 8.5], [0.42, 0.62, 1.05], 1, 0.85); S.bIce.u.uHv.value = 0.6;      // chips of ice: they tumble down through the valley and glint
    // dust shaken off the cliffs: puffs that start on steep rock faces (Rock.sites) as the front reaches them, then sift down
    if (Rock.sites && Rock.sites.length) { const r = rng(93), pick = [], st = Rock.sites; for (let n = 0; n < 60000 && pick.length < 170; n++) { const s = st[(r() * st.length) | 0]; if (!s || !s.p || !s.n) continue; if (Math.abs(s.n.y) < 0.55 && s.p.y > 14 && s.p.y < 108 && Math.abs(s.p.x) < 62 && s.p.z > -105 && s.p.z < 45) pick.push(s); }
      if (pick.length) { S.cliff = sprites(pick.length, { aC: [3, i => [pick[i].p.x, pick[i].p.y, pick[i].p.z]], aN: [3, i => [pick[i].n.x, pick[i].n.y, pick[i].n.z]], aR: [4, (i, r2) => [r2(), r2(), r2(), r2()]] }, {
        seed: 94, pm: true, uniforms: { uO: { value: V() }, uT: { value: 0 }, uC0: { value: V(1.10, 0.84, 0.76) }, uC1: { value: V(0.42, 0.29, 0.31) }, uNorm: { value: 1 }, uGain: { value: 0.40 } },
        vs: `attribute vec3 aC, aN; attribute vec4 aR; uniform vec3 uO; uniform float uT; varying vec2 vUv; varying float vVZ, vA;
          void main(){ float a = uT - length(aC - uO) / 150.0 - aR.x * 0.9, life = 4.0 + 3.0 * aR.y, lf = clamp(a / life, 0.0, 1.0);
            vec3 c = aC + aN * (1.0 + 3.0 * sqrt(lf)) + vec3(-0.7 * a, -(1.1 * a + 0.32 * a * a), 0.0) * step(0.0, a);
            float sz = (1.6 + 5.2 * sqrt(lf)) * (0.6 + 0.8 * aR.z), rot = aR.w * 6.283 + a * (aR.z - 0.5); vec2 q = position.xy; vec2 rq = vec2(q.x * cos(rot) - q.y * sin(rot), q.x * sin(rot) + q.y * cos(rot));
            vec4 mv = viewMatrix * vec4(c, 1.0); mv.xy += rq * sz * vec2(1.0, 1.5); vVZ = mv.z; vUv = position.xy + 0.5;
            vA = step(0.0, a) * smoothstep(0.0, 0.08, lf) * (1.0 - smoothstep(0.4, 1.0, lf)); gl_Position = projectionMatrix * mv; if (vA <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }`,
        fs: PUFF_FS });
        S.cliff.renderOrder = 1; S.cliff.visible = false; fx.add(S.cliff); } }
    scene.traverse(o => { const m = o.material; if (o.isInstancedMesh && m && m.customProgramCacheKey && m.customProgramCacheKey() === 'lantern') S.lan = { m, base: m.color.clone() }; });

    // ================= the pearl =================
    S.pearl = fxMesh(quad, CARD_VS, /* glsl */`${FXD} uniform float uPK, uTime; varying vec2 vUv; varying float vVZ;
        void main(){ float r = length(vUv), ro = 0.105, x = r / ro; vec2 hq = vUv - vec2(-0.032, 0.036);
          float body = smoothstep(1.0, 0.82, x); vec3 orb = mix(vec3(10.5, 7.4, 3.0), vec3(5.4, 2.3, 0.34), x * x) * body;                       // white-gold centre, deep gold limb
          float hl = exp(-dot(hq, hq) / (ro * ro * 0.07)) * 8.0;
          float halo = exp(-max(r - ro, 0.0) * 8.0) * 1.5 + pow(max(1.0 - r, 0.0), 3.0) * 0.26;
          vec3 c = orb * 1.5 + vec3(1.0, 0.92, 0.74) * hl + vec3(2.25, 1.22, 0.34) * halo * 0.7;
          gl_FragColor = vec4(c * uPK * smoothstep(1.0, 0.85, r) * softZ(vVZ, 3.0), 0.0); }`,
      { uP: { value: V() }, uS: { value: new THREE.Vector2(1, 1) }, uRot: { value: 0 }, uBias: { value: 0 }, uPK: { value: 0 } });
    S.pearlStar = glow(); S.tail = core(); S.tail.u.uC.value.set(3.0, 1.9, 0.55); S.tail.u.uC2.value.set(2.2, 1.05, 0.22);
    S.trail = sprites(460, { aR: [4, (i, r) => [r(), r(), r(), r()]] }, {
      seed: 95, pm: true, uniforms: { uTr: { value: Array.from({ length: 12 }, () => V()) }, uPK: { value: 0 }, uT0p: { value: F.BLAST } },
      vs: `attribute vec4 aR; uniform float uTime, uPK, uT0p; uniform vec3 uTr[12]; varying vec2 vUv; varying float vA, vL, vVZ;
        void main(){ float a = fract(uTime / 2.75 + aR.x) * 2.75, x = a / 0.25, fi = min(floor(x), 10.0); int i = int(fi); vec3 o = mix(uTr[i], uTr[i + 1], min(x - fi, 1.0));      // born where the pearl was a seconds ago
          vec3 c = o + (aR.yzw - 0.5) * (0.3 + 1.25 * a) + vec3(0.0, -0.55 * a * a, 0.0);
          vec4 mv = viewMatrix * vec4(c, 1.0); vVZ = mv.z; float sz = max(0.07 + 0.11 * aR.z, -mv.z * 0.0014); mv.xy += position.xy * sz * 2.0; vUv = position.xy * 2.0; vL = a / 2.75;
          vA = uPK * step(uT0p + 0.25, uTime - a) * smoothstep(0.0, 0.05, vL) * pow(1.0 - vL, 1.5) * (0.5 + 0.5 * sin(a * 31.0 + aR.w * 60.0)); gl_Position = projectionMatrix * mv; }`,
      fs: `${FXD} varying vec2 vUv; varying float vA, vL, vVZ; void main(){ float a = smoothstep(1.0, 0.0, length(vUv)); gl_FragColor = vec4(mix(vec3(6.0, 3.3, 0.8), vec3(2.4, 0.62, 0.06), vL) * a * a * vA * softZ(vVZ, 1.5), 0.0); }` });
    S.trail.renderOrder = 2; S.trail.visible = false; fx.add(S.trail);
    // ================= aftermath: fine ice crystals drifting down among the leaves =================
    S.ice = sprites(760, { aC: [3, (i, r) => [lerp(-46, 50, r()), r() * 112, lerp(-72, 84, r())]], aR: [4, (i, r) => [r(), r(), r(), r()]] }, {
      seed: 97, pm: true, uniforms: { uIce: { value: 0 } },
      vs: `attribute vec3 aC; attribute vec4 aR; uniform float uTime, uWind, uIce; varying vec2 vUv; varying float vA, vVZ;
        void main(){ vec3 c = aC; c.y = mod(c.y - uTime * (0.9 + 1.4 * aR.x), 112.0); c.x += sin(uTime * 0.5 + aR.y * 6.283) * 1.6 - uWind * 0.12; c.x = mod(c.x + 46.0, 96.0) - 46.0; c.z += cos(uTime * 0.4 + aR.z * 6.283) * 1.6;
          vec4 mv = viewMatrix * vec4(c, 1.0); vVZ = mv.z; float sz = max(0.05 + 0.07 * aR.z, -mv.z * 0.0011); mv.xy += position.xy * sz * 2.0; vUv = position.xy * 2.0;
          float tw = step(0.62, fract(sin(floor(uTime * 9.0 + aR.w * 30.0) * 12.9898 + aR.x * 78.233) * 43758.5453));
          vA = uIce * (0.18 + 0.82 * tw) * smoothstep(2.0, 9.0, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fs: `${FXD} varying vec2 vUv; varying float vA, vVZ; void main(){ float a = exp(-dot(vUv, vUv) * 5.0) * smoothstep(1.0, 0.6, length(vUv)); gl_FragColor = vec4(vec3(2.2, 3.0, 4.4) * a * vA * softZ(vVZ, 1.5), 0.0); }` });
    S.ice.renderOrder = 2; S.ice.visible = false; fx.add(S.ice);
    prog(0.9); await tick();

    // compile every effect's program now, behind the loader: most effects stay undrawn until their beat, and a first-use compile would stall a live frame right on it
    try { if (Post.warm) Post.warm(); } catch (e) { console.warn('post warm skipped', e && e.message); }
    try { if (R.compileAsync) { await R.compileAsync(fx, G.camera); await R.compileAsync(S.chunks.mesh, G.camera, scene); await R.compileAsync(S.vortex, G.camera, scene); } } catch (e) { console.warn('fx precompile skipped', e && e.message); }
    G.tick.push(update); prog(1);
  }

  // ---- per frame: everything below is a pure function of t and of this frame's dragon state ----
  const dR = V(), dW = V(), v1 = V(), v2 = V(), v3 = V(), axR = V(), axW = V(), hitN = V(), ctr = V(), kv = V(), pA = V(), pB = V(), rdir = V(), anc = V();
  const SR = Array.from({ length: 18 }, () => V()), SW = Array.from({ length: 18 }, () => V());
  const show = (o, on) => { if (o.mesh.visible !== on) o.mesh.visible = on; return on; };
  const hitE = (d, a) => d < 0 || d > 0.28 ? 0 : d < 0.025 ? a * d / 0.025 : a * Math.pow(1 - (d - 0.025) / 0.255, 2);
  const fire = (b, dt, o, ax, vel) => { const on = dt >= 0 && dt <= b.life + b.spread + 0.05; if (b.mesh.visible !== on) b.mesh.visible = on; if (!on) return false; b.u.uT.value = dt; b.u.uO.value.copy(o); if (ax) b.u.uAx.value.copy(ax); if (vel) b.u.uVel.value.copy(vel); return true; };
  // tap = 1: the channel ends in open air, so it thins and dies toward its tip; 0: it lands on something
  const setBolt = (b, a, c, seed, amp, wid, gain, rev, brn, col, tap = 0) => { b.mesh.visible = true; const u = b.u; u.uA.value.copy(a); u.uB.value.copy(c); u.uSeed.value = seed; u.uAmp.value = amp; u.uWid.value = wid; u.uGain.value = gain; u.uRev.value = rev; u.uBrn.value = brn; u.uTap.value = tap; u.uC.value.set(col[0], col[1], col[2]); };
  const setGlow = (g, p, sx, sy, c, c2, k0, k1, k2, k3) => { g.mesh.visible = true; const u = g.u; u.uP.value.copy(p); u.uS.value.set(sx, sy); u.uC.value.set(c[0], c[1], c[2]); u.uC2.value.set(c2[0], c2[1], c2[2]); u.uK.value.set(k0, k1, k2, k3); u.uRing.value.z = 0; u.uWarp.value.set(0, 0); u.uSoft.value = 0; u.uBias.value = 0; u.uRot.value = 0; return u; };
  const setDecal = (o, p, S0, k, hot) => { const on = k > 0.004; if (o.mesh.visible !== on) o.mesh.visible = on; if (on) { o.u.uP.value.copy(p); o.u.uM.value.x = S0; o.u.uM.value.y = k; o.u.uM.value.z = hot; } };
  // every colour update() hands to a glow or a bolt is a constant up here: a frame of the film allocates nothing
  // the cliff face nearest a point: the normal of the closest steep planting site within 9 m (Rock.sites), looked up once per point
  const faceN = V(), faceP = V(1e9, 0, 0); let faceOK = false;
  const faceAt = p => { if (faceP.distanceToSquared(p) < 1e-4) return faceOK; faceP.copy(p); faceOK = false; const st = typeof Rock !== 'undefined' && Rock.sites; if (!st || !st.length) return false;
    let best = 81; for (let i = 0; i < st.length; i++) { const s = st[i]; if (!s || !s.p || !s.n || s.n.y > 0.75) continue; const d = s.p.distanceToSquared(p); if (d < best) { best = d; faceN.copy(s.n); faceOK = true; } }
    return faceOK; };
  const COLD = [0.50, 0.72, 1.7], BOLTC = [0.45, 0.85, 1.8], WARM = [1.6, 0.75, 0.35], FLK = [1, 0.55, 1, 0.75, 1, 0.6, 0.9, 1, 0.5, 0.9, 0.7, 0.4];
  const C_0 = [0, 0, 0], C_MZR = [9, 4.2, 1.0], C_MZR2 = [2.6, 0.6, 0.08], C_MZW = [5, 8, 13], C_MZW2 = [0.4, 1.0, 2.6], C_STK = [0.6, 0.8, 1.5], C_STK2 = [0.35, 0.5, 1.1], C_FL = [22, 21, 20], C_FL2 = [4, 4.4, 5.6],
    C_RING = [1.3, 1.15, 1.2], C_HIT = [16, 19, 24], C_HIT2 = [2.0, 3.2, 6.5], C_BFL = [30, 29, 28], C_BFL2 = [8, 8, 9], C_BRING = [1.7, 1.5, 1.5], C_STAR = [9, 6.2, 2.5], C_SC = [0, 0, 0], C_SC2 = [0, 0, 0];

  function update(t) {
    const F = Film.T, A = Film.A, red = Dragon.red, white = Dragon.white, rs = red.st, ws = white.st, cam = G.camera.position;
    const n60 = Math.floor(t * 60 + 0.5), both = rs.vis > 0.5 && ws.vis > 0.5;
    const beam = sm(F.BEAM, F.BEAM + 0.45, t) * (1 - sm(F.BLAST - 0.02, F.BLAST + 0.1, t)), bk = clamp((t - F.BEAM) / (F.BLAST - F.BEAM));
    const dBlast = t - F.BLAST;
    for (const b of S.bolts) b.mesh.visible = false;
    lI = lR = lG = lB = lD = 0; lP.set(0, 0, 0);

    // ---- red jet ----
    const bR = rs.breath * rs.vis; let lenR = 1e4;
    dR.copy(rs.fwd).addScaledVector(rs.up, -JET_DROP).normalize();
    if (beam > 0) { v1.subVectors(A.beamMid, rs.mouth); lenR = Math.max(2, v1.length()); dR.lerp(v1.multiplyScalar(1 / lenR), beam).normalize(); }
    // FIRE2, the chase: a flamethrower three times the roar's reach. Its head runs out from the mouth when the breath starts (tOn, read from the
    // fire table at build), then rolls at the far end; the light it throws sits well down the jet, so white's flank catches an orange rim.
    // Seen end-on the long flame strip would fan into rays, so it fades as the jet turns toward the lens: there the sprites and the head carry it.
    const w2 = S.wake[1], f2 = beam > 0 ? 0 : sm(F.FIRE2 - 0.5, F.FIRE2 - 0.15, t) * (1 - sm(w2.tOff + 0.5, w2.tOff + 1.1, t)), LF2 = 33, run2 = sm(w2.tOn - 0.02, w2.tOn + 0.42, t), headD = LF2 * run2;
    if (f2 > 0 && run2 < 1) lenR = Math.max(2.5, headD);
    const rk = (1 - f2) * (1 - beam);                                                // 1 = a free roar (the challenge at 24 s): thick rolling fire, as the chase flame is
    U.uMouth.value.copy(rs.mouth); U.uDir.value.copy(dR); U.uRoar.value = bR * (1 - 0.72 * f2) * (1 - 0.62 * (1 - f2) * (1 - beam)); U.uLen.value = lenR; U.uBeam.value = beam; U.uCharge.value = rs.charge; U.uReach.value = 1 + 0.95 * f2;
    S.fire.visible = bR > 0.01;
    for (const w of S.wake) { w.emb.visible = t >= w.t0 && t <= w.endE; w.smoke.visible = t >= w.t0 && t <= w.endS; }
    if (show(S.coreR, bR > 0.02)) { const u = S.coreR.u, len = lerp(f2 > 0 ? lerp(11, Math.max(4, Math.min(LF2, headD)), f2) : lerp(11, 25, rk), Math.min(lenR, 400), beam), side = sm(0.22, 0.6, v1.subVectors(rs.mouth, cam).normalize().cross(dR).length());
      u.uA.value.copy(rs.mouth); u.uB.value.copy(rs.mouth).addScaledVector(dR, len); u.uW.value.set(lerp(0.75 + 0.75 * f2 + 0.75 * rk, 2.3, beam), lerp(2.4 + 3.8 * f2 + 4.4 * rk, 5.2, beam));
      u.uGain.value = bR * lerp(0.55 - 0.05 * f2, 0.42, beam) * lerp(1, side, Math.max(f2, rk)); u.uBody.value = lerp(1.0 + 1.1 * f2 + 1.25 * rk, 1.15, beam); u.uCover.value = Math.max(beam, 0.8 * f2, 0.74 * rk * side) * bR;
      u.uSpd.value = lerp(2.2 + 1.4 * f2 + 1.0 * rk, 3.4, beam); u.uRep.value = lerp(1.2 + 1.4 * f2 + 1.0 * rk, Math.max(1.5, len / 14), beam); }
    { const fk = 0.74 + 0.15 * Math.sin(t * 37) + 0.11 * Math.sin(t * 61 + 2) + 0.24 * (hsh(Math.floor(t * 30)) - 0.5);      // a fluttering source well down the plume: the cliffs and the gate take it
      lit(lerp(480 * (0.8 + 0.2 * Math.sin(t * 37)), 5600 * fk, rk) * bR + 90 * rs.charge * rs.vis, v1.copy(rs.mouth).addScaledVector(dR, Math.min(lerp(7, 27, rk), lenR * 0.5)), 1.0, 0.40, 0.10, lerp(150, 330, rk)); }
    const hk = Math.max(f2, 0.5 * rk) * bR;
    if (show(S.fhead, hk > 0.03)) { const u = S.fhead.u, roll = 0.93 + 0.05 * Math.sin(t * 11) + 0.03 * Math.sin(t * 23 + 1), rad = (f2 > 0 ? lerp(3.0, 6.6, run2) : 4.4) * (0.9 + 0.1 * Math.sin(t * 17)), hd = f2 > 0 ? Math.max(3, headD * roll) : 24 * roll * sm(0, 0.35, bR);
      v1.copy(rs.mouth).addScaledVector(dR, hd); u.uP.value.copy(v1); u.uS.value.set(rad * 3.2, rad * 3.2); u.uRad.value = 0.085; u.uHeat.value = 0.36 * hk; u.uSide.value.set(1, 0);
      if (f2 > 0) lit(1500 * f2 * bR * (0.8 + 0.2 * Math.sin(t * 31 + 2)), v2.copy(rs.mouth).addScaledVector(dR, Math.max(3, headD * 0.72)), 1.0, 0.42, 0.10, 210); }
    { const hot = Math.max(bR * Math.max(rk, f2), beam), on = hot > 0.03, bm = beam > 0.01; if (S.heat.mesh.visible !== on) S.heat.mesh.visible = on;      // hot air over the flame bends what is behind it
      if (on) { const u = S.heat.u, L = f2 > 0 ? Math.max(6, headD) : 25; if (bm) v1.copy(A.beamMid); else v1.copy(rs.mouth).addScaledVector(dR, L * 0.62); v1.y += bm ? 9 : 5;
        v2.copy(dR).transformDirection(G.camera.matrixWorldInverse); u.uP.value.copy(v1); u.uS.value.set(bm ? 26 : L * 0.75 + 6, bm ? 24 : 13); u.uRot.value = bm ? 0 : Math.atan2(v2.y, v2.x); u.uAmp.value = Math.min(1, hot); } }
    if (show(S.muzR, rs.vis > 0.01 && rs.charge + bR > 0.03)) setGlow(S.muzR, rs.mouth, 5, 5, C_MZR, C_MZR2, 26, 0.5 * rs.charge + 1.1 * bR, 0.18 * rs.charge + 0.3 * bR, 0).uSoft.value = 2.5;

    // ---- white jet ----
    const dB = t - F.BOLT, boltOn = dB > -0.4 && dB < 0.7, bW = ws.breath * ws.vis * (boltOn ? 0.4 : 1); let lenW = 1e4;
    dW.copy(ws.fwd).addScaledVector(ws.up, -JET_DROP).normalize();
    if (boltOn) dW.subVectors(A.boltHit, ws.mouth).normalize();
    // WROAR, a torrent that LANDS: when red's muzzle is inside the cone of the breath the jet closes on it
    // (the choreography aims the head; this takes up the last few degrees) and ends there in a frost burst and a roll of rime.
    // roarW = 1 for a free breath, 0 in the beam.
    let hitW = 0; const roarW = (boltOn || bW < 0.02 || (t > F.BEAM - 0.5 && t < F.BLAST + 0.5)) ? 0 : 1;
    if (roarW > 0 && rs.vis > 0.5) { v1.lerpVectors(rs.mouth, rs.head, 0.4).sub(ws.mouth); const dn = v1.length(); if (dn > 6 && dn < 60) { v1.multiplyScalar(1 / dn); hitW = sm(0.90, 0.972, v1.dot(dW));      // inside about 14 degrees: full; outside 26: none
        if (hitW > 0) { dW.lerp(v1, hitW).normalize(); lenW = lerp(1e4, Math.max(8, dn - 0.8), sm(0.5, 1, hitW)); } } }
    if (beam > 0) { v1.subVectors(A.beamMid, ws.mouth); lenW = Math.max(2, v1.length()); dW.lerp(v1.multiplyScalar(1 / lenW), beam).normalize(); }
    { const u = S.frost.material.uniforms; S.frost.visible = bW > 0.01; u.uMouthW.value.copy(ws.mouth); u.uDirW.value.copy(dW); u.uBreathW.value = bW; u.uLenW.value = lenW; u.uMassW.value = roarW; }
    const jetW = bW > 0.02 && !boltOn, lenJ = lerp(roarW > 0 ? Math.min(lenW, 38) : 27, Math.min(lenW, 400), beam);
    if (show(S.coreW, jetW)) { const u = S.coreW.u; u.uA.value.copy(ws.mouth); u.uB.value.copy(ws.mouth).addScaledVector(dW, lenJ); u.uW.value.set(lerp(0.55 + 1.0 * roarW, 1.1, beam), lerp(1.7 + 3.4 * roarW, 2.0, beam)); u.uGain.value = bW * lerp(1.0 - 0.38 * roarW, 1.6, beam); u.uSpd.value = lerp(3.0, 4.2, beam); u.uRep.value = Math.max(1.5, lenJ / 12); }
    if (jetW) { v1.copy(ws.mouth).addScaledVector(dW, lenJ * (beam > 0 || hitW > 0.5 ? 1 : 1.25)); const sd = Math.floor(t * 30);                          // forking filaments crawl along the jet, a new path every two frames
      for (let i = 0; i < 3; i++) setBolt(S.bolts[i], ws.mouth, v1, sd * 1.37 + i * 7.1, lerp(0.045 + 0.03 * roarW, 0.030, beam) * (1 + 0.5 * i), (0.20 + 0.05 * i) * (1 + 2.1 * roarW), bW * (0.9 + 0.8 * hsh(sd + i * 3.3)) * (i === 0 ? 1.5 : 0.9), 2, 0.9 + 0.6 * roarW, COLD, (1 - beam) * (hitW > 0.5 ? 0.25 : 1)); }
    lit(430 * bW * (0.8 + 0.2 * Math.sin(t * 43 + 1)) + 80 * ws.charge * ws.vis, v1.copy(ws.mouth).addScaledVector(dW, Math.min(7, lenW * 0.5)), 0.55, 0.76, 1.0, 170);
    { const kH = bW * sm(0.5, 1, hitW) * roarW, on = kH > 0.03; S.rime.mesh.visible = on; S.frostHit.mesh.visible = false;
      if (on) { v1.copy(ws.mouth).addScaledVector(dW, lenW); const fk = 0.75 + 0.25 * Math.sin(t * 41) + 0.2 * (hsh(Math.floor(t * 30)) - 0.5);
        const u = setGlow(S.frostHit, v1, 7, 7, C_MZW, C_MZW2, 20, 0.95 * kH * fk, 0.40 * kH, 0.45 * kH * fk); u.uSoft.value = 4; u.uBias.value = 2.5;
        S.rime.u.uO.value.copy(v1); S.rime.u.uAx.value.copy(dW); S.rime.u.uVel.value.copy(dW).multiplyScalar(5); S.rime.u.uGain.value = 0.36 * kH; S.rime.u.uP1.value.x = 13; S.rime.u.uP2.value.x = 2.3; S.rime.u.uC0.value.set(1.25, 1.55, 2.1); S.rime.u.uC1.value.set(0.50, 0.66, 1.0);
        S.dIce.mesh.visible = true; S.dIce.u.uO.value.copy(v1); S.dIce.u.uAx.value.copy(dW).negate(); S.dIce.u.uGain.value = 1.1 * kH; S.wHit = true;
        lit(700 * kH * fk, v2.copy(v1).addScaledVector(dW, -3), 0.55, 0.78, 1.0, 150); } else S.wHit = false; }
    if (show(S.muzW, ws.vis > 0.01 && ws.charge + bW > 0.03)) setGlow(S.muzW, ws.mouth, 5, 5, C_MZW, C_MZW2, 26, 0.5 * ws.charge + 1.1 * bW, 0.18 * ws.charge + 0.3 * bW, 0.25 * bW).uSoft.value = 2.5;

    // ---- OMEN / DESCENT: sky lightning near the rift, the shaft, the vapour, the cold mist ----
    { let ev = null; for (const e of S.EV) if (t >= e.t) ev = e;
      const d = ev ? t - ev.t : 9, sI = d < 0.6 ? Math.exp(-d / 0.07) + (d > 0.11 ? 0.6 * Math.exp(-(d - 0.11) / 0.05) : 0) : 0;
      S.strikeGlow.mesh.visible = S.footFlash.mesh.visible = S.footScorch.mesh.visible = false;
      const foot = ev && !ev.big && ev.tg ? ev.tg : null;
      if (sI > 0.03) { const k = ev.k, R = cam.distanceTo(A.rift), sc = R / 262, fl = 0.55 + 0.45 * hsh(n60 * 1.7 + k);      // sc: every offset below was set for a rift 262 m away
        rdir.subVectors(A.rift, cam).normalize();
        if (ev.big) anc.copy(A.rift); else { const sf = typeof Sky !== 'undefined' && Sky.fx; if (sf && sf.flash > 0.05 && sf.flashDir.dot(rdir) > 0.8) v1.copy(sf.flashDir); else v1.copy(rdir).add(v2.set(0.22 * Math.sin(k * 2.4 + 1), 0.10 * Math.sin(k * 4.1), 0.05 * Math.cos(k * 3.3))).normalize(); anc.copy(cam).addScaledVector(v1, R); }
        pA.copy(anc); pA.y += (30 + 20 * hsh(k * 3.1)) * sc; pA.x += (hsh(k * 5.7) - 0.5) * 40 * sc;
        // the main channel: out of the cloud and down onto its target on the rock (found at build); without one it dies in the air above the valley
        if (ev.big) pB.lerpVectors(A.rift, A.clash1, 0.5); else if (foot) pB.copy(foot); else pB.set(anc.x + (hsh(k * 7.3) - 0.5) * 130 * sc, Math.max(anc.y - (105 + 70 * hsh(k * 9.1)) * sc, 58), anc.z + (hsh(k * 11.9) - 0.5) * 60 * sc);
        setBolt(S.bolts[0], pA, pB, k * 7.3 + 1, foot ? 0.060 : 0.085, ev.big ? 2.0 : 1.55, sI * fl * 3.2, 2, 1, COLD, foot ? 0 : 1);
        // the cloud-to-cloud flickers stay inside the tower
        if (d < 0.09 || (d > 0.11 && d < 0.17)) { v1.set(anc.x + (hsh(k * 13.3) - 0.5) * 190 * sc, anc.y + (10 + 30 * hsh(k * 2.9)) * sc, anc.z); v2.set(v1.x + (hsh(k * 17.1) - 0.5) * 90 * sc, v1.y - (60 + 50 * hsh(k * 19.3)) * sc, v1.z + 20 * sc); setBolt(S.bolts[1], v1, v2, k * 3.9 + 5, 0.10, 0.8, sI * fl * 1.8, 2, 0.8, COLD, 1); }
        if (d < 0.07) { v1.set(anc.x - 95 * sc, anc.y + 26 * sc, anc.z - 10 * sc); v2.set(anc.x + 105 * sc, anc.y + (44 - 30 * hsh(k)) * sc, anc.z - 30 * sc); setBolt(S.bolts[2], v1, v2, k * 5.3 + 9, 0.11, 0.7, sI * fl * 1.1, 2, 0.5, COLD, 1); }
        // a glow at the root of the bolt only (28 m): the tower keeps its lit and shaded lobes; the sky's own flash lights the cloud from inside
        setGlow(S.strikeGlow, pA, 28, 28, C_STK, C_STK2, 5, 0.65 * sI * fl, 0.5 * sI * fl, 0).uSoft.value = 30; }
      // the foot: a hard flash on the rock, its light on the face for a fifth of a second, sparks thrown off the face, a spot that glows on
      if (foot && d < 1.4) { const n = ev.tn, fI = d < 0.6 ? Math.exp(-d / 0.05) + (d > 0.11 ? 0.55 * Math.exp(-(d - 0.11) / 0.045) : 0) : 0, far = Math.max(1, cam.distanceTo(foot) / 110);
        v1.copy(foot).addScaledVector(n, 1.2);
        if (fI > 0.01) { const u = setGlow(S.footFlash, v1, 13 * far, 13 * far, C_HIT, C_HIT2, 60, fI, 0.32 * fI, 0.6 * fI); u.uBias.value = 4; u.uSoft.value = 5; lit(1900 * (Math.exp(-d / 0.07) + 0.12 * Math.exp(-d / 0.3)), v2.copy(foot).addScaledVector(n, 4), 0.6, 0.8, 1.0, 180); }
        v3.copy(n).multiplyScalar(0.8); v3.y += 0.6; v3.normalize(); fire(S.sSpark, d, v1, v3);
      } else S.sSpark.mesh.visible = false;
      // the shaft opens and closes with the sky's own rift whenever the sky has one (Film drives Sky.fx.rift); the formula is only for a build without that sky
      const sf = typeof Sky !== 'undefined' && Sky.fx, kS = sf ? sf.rift : sm(F.OMEN + 1.5, F.DESCENT - 0.2, t) * (1 - sm(F.DESCENT + 3, F.FACEOFF, t));
      const on = kS > 0.005; S.shaft.mesh.visible = on; S.smotes.visible = on;
      // it falls from the rift to the valley floor between the gate and the main spire (Rock.L), where the lens sees it from the side
      if (on) { const Lr = Rock.L; pB.set(Lr.main.x * 0.5, Lr.gateY, lerp(Lr.gateZ, Lr.main.z, 0.45)); const g = kS * (1.0 + 0.5 * Math.min(sI, 1.5));
        S.shaft.u.uA.value.copy(A.rift); S.shaft.u.uB.value.copy(pB); S.shaft.u.uGain.value = g;
        const u = S.smotes.material.uniforms; u.uA.value.copy(A.rift); u.uB.value.copy(pB); u.uGain.value = kS * 1.5; }
      S.vapour.visible = t >= S.vapT[0] && t <= S.vapT[1];
      const wm = ws.vis * (0.45 + 0.55 * (1 - sm(F.DESCENT + 4, F.FACEOFF + 2, t))) * (1 - sm(F.GONG - 2, F.GONG + 1, t)) * sm(F.DESCENT + 0.6, F.DESCENT + 1.8, t);      // and no cold mist round it while it is still in the mouth of the rift
      S.wmist.visible = wm > 0.01 && ws.vis > 0.02;                                             // white.spineAt is stale while white is hidden: gate on vis
      if (S.wmist.visible) { const u = S.wmist.material.uniforms, sp = u.uSp.value; for (let i = 0; i < 10; i++) white.spineAt(4 + i / 9 * ((white.LEN || 150) * 0.82), sp[i]); u.uGain.value = 0.22 * wm; } }

    // ---- CLASH1 / CLASH2: flash, shock ring, embers from red's side, ice from white's, falling scales ----
    let ringOn = false, flashOn = false;
    S.shock.mesh.visible = false; Post.lens.ring.value.w = 0;
    { const c2 = t >= F.CLASH2, Tc = c2 ? F.CLASH2 : F.CLASH1, P = c2 ? A.clash2 : A.clash1, d = t - Tc, on = d >= 0 && d < 5.5;
      if (on) { red.headAt(Tc - 0.35, axR).sub(P); if (axR.lengthSq() < 1e-4) axR.set(-1, 0.2, 0); axR.normalize(); white.headAt(Tc - 0.35, axW).sub(P); if (axW.lengthSq() < 1e-4) axW.set(1, 0.2, 0); axW.normalize();
        const B = c2 ? S.bite : null, fI = d < 0.03 ? 1 : 0.4 * Math.exp(-(d - 0.03) / 0.04);     // a hard two-frame flash, then a short afterglow
        S.flash2.mesh.visible = false;
        if (B) {                                                                                // CLASH2: two bites, two bursts. Embers and red scales off red's neck, ice and white scales off white's
          fire(S.cEmb, d, B.onR, B.axR); fire(S.cScR, d, B.onR, B.axR); fire(S.cIce, d, B.onW, B.axW); fire(S.cScW, d, B.onW, B.axW); fire(S.cPuff, d, B.mid, B.axR);
          if (fI > 0.01) { flashOn = true; let u = setGlow(S.flash, B.onR, 16, 16, C_FL, C_FL2, 60, fI, 0.22 * fI, 0); u.uSoft.value = 8; u.uBias.value = 6;
            u = setGlow(S.flash2, B.onW, 16, 16, C_FL, C_FL2, 60, fI, 0.22 * fI, 0); u.uSoft.value = 8; u.uBias.value = 6; lit(2100 * fI, B.mid, 1, 0.95, 0.9, 220); }
        } else {
        fire(S.cEmb, d, P, axR); fire(S.cIce, d, P, axW); fire(S.cScR, d, P, axR); fire(S.cScW, d, P, axW); fire(S.cPuff, d, P, axR);
        if (fI > 0.01) { flashOn = true; const u = setGlow(S.flash, P, 20, 20, C_FL, C_FL2, 60, fI, 0.22 * fI, 0); u.uSoft.value = 8; u.uBias.value = 7; lit(1700 * fI, P, 1, 0.95, 0.9, 220); } }
        // the shock front spreads square to the line the two came in on, so from the side it is an ellipse, thick and broken, never a drawn circle
        if (d < 1.1) { const Rr = 4 + 95 * (1 - Math.exp(-d * 3.0)), Pc = B ? B.mid : P;
          v1.subVectors(axR, axW); if (v1.lengthSq() < 1e-6) v1.set(1, 0, 0); v1.normalize(); v2.subVectors(Pc, cam).normalize(); const sq = Math.max(0.46, Math.abs(v1.dot(v2)));
          v1.transformDirection(G.camera.matrixWorldInverse);
          const rot = Math.atan2(v1.y, v1.x), u = S.shock.u; S.shock.mesh.visible = true; u.uP.value.copy(Pc); u.uS.value.set(Rr / 0.72 * sq, Rr / 0.72); u.uRot.value = rot;
          u.uRing.value.set(0.72, 0.075 + 0.060 * d, 0.80 * Math.exp(-d / 0.32) * sm(0.03, 0.13, d), sq); u.uSeed.value = Tc; u.uSoft.value = 10; u.uLump.value = 0;      // it is mist pushed aside: nothing of it in the two frames of the flash
          // the same front as a lens: centre, radius and width in screen terms
          v2.copy(Pc).project(G.camera); const Dc = cam.distanceTo(Pc), rs2 = Rr / (Dc * Math.tan(rad(G.camera.fov) * 0.5)) * 0.5, L = Post.lens;
          if (v2.z < 1) { L.ring.value.set(v2.x * 0.5 + 0.5, v2.y * 0.5 + 0.5, rs2, 0.016 * Math.exp(-d / 0.22) * sm(0, 0.03, d)); L.ringS.value.set(sq, Math.cos(rot), Math.sin(rot), Math.max(0.02, rs2 * (0.10 + 0.12 * d))); } }
      } else { S.cEmb.mesh.visible = S.cIce.mesh.visible = S.cScR.mesh.visible = S.cScW.mesh.visible = S.cPuff.mesh.visible = S.flash2.mesh.visible = false; }
      // the grapple: grinding sparks at the contacts, leaves in the vortex
      const gk = both ? Math.max(env(t, F.CLASH1 - 0.25, F.CLASH1 + 2.2, 0.2, 1.2), env(t, F.CLASH2 - 0.25, F.SPLASH - 0.06, 0.2, 0.3)) : 0;
      S.grind.visible = gk > 0.01;
      if (gk > 0.01) { const ct = S.grind.material.uniforms.uCt.value;
        for (let i = 0; i < 18; i++) { red.spineAt(2.5 + i * 5, SR[i]); white.spineAt(2.5 + i * 5.2, SW[i]); }
        for (let s = 0; s < 6; s++) { let best = 1e9, bi = 0, bj = 0; for (let i = s * 3; i < s * 3 + 3; i++) for (let j = 0; j < 18; j++) { const dd = SR[i].distanceToSquared(SW[j]); if (dd < best) { best = dd; bi = i; bj = j; } }
          v1.addVectors(SR[bi], SW[bj]).multiplyScalar(0.5); ct[s].set(v1.x, v1.y, v1.z, gk * (1 - sm(11, 30, Math.sqrt(best))) * sm(1.5, 7, v1.y - A.splash.y)); }      // nothing burns in the water
        red.headAt(t + 0.05, v1).sub(red.headAt(t - 0.05, v2)); white.headAt(t + 0.05, v2).sub(white.headAt(t - 0.05, v3)); kv.addVectors(v1, v2).multiplyScalar(5);      // how fast the knot travels
        S.grind.material.uniforms.uVk.value.copy(kv); }
      const vk = both ? env(t, F.CLASH2 + 0.2, F.SPLASH + 0.5, 1.2, 0.6) : 0; S.vortex.visible = vk > 0.005;
      if (vk > 0.005) { const u = S.vortex.material.uniforms; red.spineAt(22, v1); white.spineAt(22, v2); u.uVC.value.addVectors(v1, v2).multiplyScalar(0.5);
        red.headAt(t + 0.1, v1).sub(red.headAt(t - 0.1, v2)); white.headAt(t + 0.1, v2).sub(white.headAt(t - 0.1, v3)); v1.add(v2); if (v1.lengthSq() < 1e-6) v1.set(0, -1, 0); u.uVAx.value.copy(v1.normalize()); u.uVK.value = vk; } }

    // ---- BOLT: the lightning, then the rock it shatters ----
    { const dH = dB - HIT; S.hitFlash.mesh.visible = S.scorch.mesh.visible = false;
      white.headAt(F.BOLT, v1); hitN.subVectors(v1, A.boltHit).normalize();
      if (faceAt(A.boltHit)) hitN.multiplyScalar(0.30).addScaledVector(faceN, 0.85).y += 0.42; else hitN.multiplyScalar(0.6).y += 0.85;         // debris leaves along the face the bolt struck, up and a little back toward the bolt
      hitN.normalize();
      if (dB >= 0 && dB < 0.50 && ws.vis > 0.5) { const fr = Math.floor(dB * 60 + 0.001), live = dB < HIT + 0.07;
        const g = live ? FLK[Math.min(fr, 11)] : 0.42 * Math.exp(-(dB - HIT - 0.07) / 0.085);
        const sd = live ? fr : Math.floor((HIT + 0.07) * 60);
        // live, the bolt leaves white's mouth. Its afterglow hangs where the channel WAS: the head's place on its rail at the last live
        // moment plus this frame's head-to-mouth offset, so it does not trail after the mouth as white flies on
        if (live) pA.copy(ws.mouth); else white.headAt(F.BOLT + HIT + 0.07, pA).add(v2.subVectors(ws.mouth, ws.head));
        setBolt(S.bolts[0], pA, A.boltHit, 40 + sd * 2.3, 0.055, live ? 0.85 : 0.4, g * 3.6, dB / HIT, live ? 1 : 0.4, BOLTC);
        setBolt(S.bolts[2], pA, A.boltHit, 40 + sd * 2.3, 0.055, live ? 4.5 : 2.4, g * 0.30, dB / HIT, 0, BOLTC);                       // the same path, wide and dim: its glow sleeve
        if (live) setBolt(S.bolts[1], pA, A.boltHit, 77 + sd * 3.1, 0.09, 0.3, g * 1.8, dB / HIT, 0.6, BOLTC); }
      if (dH >= 0 && dH < 7.6) {
        const fI = Math.exp(-dH / 0.045);
        if (fI > 0.01) { const u = setGlow(S.hitFlash, A.boltHit, 10, 10, C_HIT, C_HIT2, 60, fI, 0.3 * fI, 0.7 * fI); u.uBias.value = 3; u.uSoft.value = 4; lit(1500 * Math.exp(-dH / 0.10) + 140 * Math.exp(-dH / 0.45), v1.copy(A.boltHit).addScaledVector(hitN, 2.5), 0.6, 0.8, 1.0, 170); }
        fire(S.bSpark, dH, A.boltHit, hitN); fire(S.bDust, dH, A.boltHit, hitN, v2.set(-2.6, 0, 0.7)); fire(S.bDust2, dH, v1.copy(A.boltHit).addScaledVector(hitN, 1.5), v3.set(hitN.x, hitN.y - 1.2, hitN.z).normalize(), v2); fire(S.rubble, dH, A.boltHit, hitN);
        S.chunks.mesh.visible = true; S.chunks.u.uT.value = dH; S.chunks.u.uO.value.copy(A.boltHit); S.chunks.u.uAx.value.copy(hitN);
      } else { S.bSpark.mesh.visible = S.bDust.mesh.visible = S.bDust2.mesh.visible = S.rubble.mesh.visible = S.chunks.mesh.visible = false; } }

    // ---- SPLASH: crown of droplets, the sheet, a wall of mist rolling out, ring waves on the lake ----
    // The water leaves the lake three frames before the beat (the noses are at the surface), so on the frame of the boom the column is
    // already standing: 12 m on the beat, 22 m four frames later, 30 m inside a third of a second.
    { const d = t - F.SPLASH, dS = d + 0.06, wu = S.water, wy = A.splash.y;
      const sheetOn = (o, dt, org, ax, last) => { const on = dt >= 0 && dt < last; if (o.mesh.visible !== on) o.mesh.visible = on; if (on) { o.u.uT.value = dt; o.u.uO.value.copy(org); o.u.uAx.value.copy(ax); o.u.uOld.value = sm(0.45, last, dt); o.u.uGain.value = o.gain * (1 - sm(last - 0.5, last, dt)); } return on; };
      v1.set(0, 1, 0); v2.subVectors(cam, A.splash); v2.y = 0; if (v2.lengthSq() > 1) v1.addScaledVector(v2.normalize(), 0.10).normalize();      // the whole eruption leans a little toward the lens
      // the lake module throws its own crown and column of water (Water.throws); the old light-streak sheets are drawn only without it
      if (typeof Water !== 'undefined' && Water && Water.throws) { if (S.crown.mesh.visible) S.crown.mesh.visible = false; if (S.column.mesh.visible) S.column.mesh.visible = false; }
      else { sheetOn(S.crown, dS, A.splash, v1, 2.0); sheetOn(S.column, dS, A.splash, v1, 2.5); }
      if (dS >= 0 && d < 9) { fire(S.drops, dS, A.splash, v1); fire(S.sheet, dS, A.splash, v1); fire(S.plume, dS, A.splash, v1); S.drops.u.uFloor.value = wy - 0.05; S.sheet.u.uFloor.value = wy - 1.5; S.plume.u.uFloor.value = wy - 2.5;
        S.bank.visible = d >= 0 && d < 5.2; const u = S.bank.material.uniforms; u.uO.value.copy(A.splash); u.uT.value = Math.max(d, 0);
        // one hard ring wave: across the pool and under the lens inside 0.6 s, then it runs on and dies
        wu.uRipA.value.set(A.splash.x, A.splash.z, 3 + 22 * (1 - Math.exp(-dS / 0.45)) + 6 * dS, 1.2 * sm(0, 0.08, dS) * Math.exp(-dS / 2.6) * (1 - sm(7.5, 9, d))); wu.uFoamA.value = 0.75 * sm(0, 0.10, dS) * Math.exp(-dS / 2.2) * (1 - sm(7.5, 9, d));
      } else { S.drops.mesh.visible = S.sheet.mesh.visible = S.plume.mesh.visible = S.bank.visible = false; wu.uRipA.value.w = 0; wu.uFoamA.value = 0; }
      let xi = 0; for (const e of S.exits) { const de = t - e.t; if (fire(e.drops, de, e.p, e.ax)) e.drops.u.uFloor.value = e.p.y - 0.05; if (fire(e.spray, de, e.p, e.ax)) e.spray.u.uFloor.value = e.p.y - 1.5; sheetOn(e.crown, de, e.p, e.ax, 1.7);
        const rp = xi === 0 ? wu.uRipC : wu.uRipD; xi++; if (rp) rp.value.set(e.p.x, e.p.z, 2 + 14 * (1 - Math.exp(-Math.max(de, 0) / 0.5)) + 5 * Math.max(de, 0), de >= 0 && de < 6 ? 0.8 * sm(0, 0.08, de) * Math.exp(-de / 2.0) : 0); }
      // collars: wherever a body stands in or passes through the lake a film of water climbs it and a boil works at its foot. After the
      // SPLASH the lake's own shader is told where they are (uCol); during red's time in the lake (19.5 to 32 s) the lake finds them itself.
      const cr = S.cross, inS = d > -0.15 && d < 9, inL = t > 19.45 && t < 32.3; let nc = 0;
      if (inS || inL) { const kw = inS ? sm(-0.15, 0.05, d) * (1 - sm(7.5, 9, d)) : sm(19.45, 19.6, t) * (1 - sm(31.8, 32.3, t));
        for (let di = 0; di < 2 && nc < 6; di++) { const dr = di ? white : red, ds = dr.st; if (ds.vis < 0.5) continue;
          const LEN = dr.LEN || (di ? 150 : 172), R0 = di ? 2.9 : 3.4; let py = 0, pa = 0;
          for (let a = 0, k = 0; a <= LEN && nc < 6; a += 3.2, k++) { dr.spineAt(a, v2, v3); const y = v2.y - wy;
            if (k > 0 && (y > 0) !== (py > 0)) { const f = py / (py - y), aa = pa + (a - pa) * f; dr.spineAt(aa, v2, v3);
              const rr = dr.rProf ? dr.RMAX * dr.rProf(aa) : R0 * Math.min(1, aa / 9 + 0.45) * (1 - 0.8 * sm(0.72, 1, aa / LEN)), flux = Math.abs(v3.y * (ds.speed || 30));
              const ax = S.colAx[nc].copy(v3); if (ax.y < 0) ax.negate(); ax.y += 0.75; ax.normalize();
              if (rr > 0.25) cr[nc++].set(v2.x, v2.z, rr, clamp(0.35 + flux / 28) * kw); }
            py = y; pa = a; } } }
      for (let i = 0; i < 6; i++) { const c = S.collar[i], on = i < nc && cr[i].w > 0.02; if (c.mesh.visible !== on) c.mesh.visible = on;
        if (on) { const u = c.u, w = cr[i].w; u.uT.value = t; u.uO.value.set(cr[i].x, wy, cr[i].y); u.uAx.value.copy(S.colAx[i]); u.uK.value.x = cr[i].z * 1.02; u.uK.value.y = 1.0 + 2.3 * w; u.uK.value.z = w; u.uGain.value = Math.min(1, w * 1.6); }
        if (i >= nc) cr[i].set(0, 0, 0, 0); if (wu.uCol && wu.uCol.value && wu.uCol.value[i]) { if (inS) wu.uCol.value[i].copy(cr[i]); else wu.uCol.value[i].set(0, 0, 0, 0); } }
      for (const s of S.shed) { const on = t >= s.t0 && t <= s.t1; if (s.mesh.visible !== on) s.mesh.visible = on; }
      // water on the lens: the near wall of the crown reaches the glass a fifth of a second after the hit
      { const shake = t > 21.4 && t < 23.2, dw = shake ? t - 21.62 : d - 0.20, wet = dw > 0 && dw < 1.0 ? sm(0, 0.04, dw) * (1 - sm(0.75, 1.0, dw)) * (shake ? 0.8 * rs.vis : 1) : 0; S.wet.visible = wet > 0;      // (and the wet head shaking a few metres from the glass)
        if (wet > 0) { if (shake) v2.copy(rs.head); else { v2.copy(A.splash); v2.y += 6; } v2.project(G.camera); S.wet.material.uniforms.uWet.value.set(wet, dw, clamp(v2.x * 0.5 + 0.5, 0.1, 0.9), clamp(v2.y * 0.5 + 0.5, 0.1, 0.9)); } } }

    // ---- BEAM: the ball where the jets meet, arcs to the rock, debris pushed outward ----
    S.ball.mesh.visible = false;
    if (beam > 0.01) { const M = A.beamMid, fk = 0.85 + 0.15 * Math.sin(t * 31) + 0.12 * (hsh(Math.floor(t * 24)) - 0.5), gap = rs.mouth.distanceTo(ws.mouth), rad = Math.min(lerp(2.4, 10.5, Math.pow(bk, 0.8)), 0.34 * gap) * fk * beam, u = S.ball.u;      // it swells all through the beat, not only in its last frames
      S.ball.mesh.visible = true; u.uP.value.copy(M); u.uS.value.set(rad * 3.2, rad * 3.2); u.uRad.value = 0.15; u.uHeat.value = beam * (0.78 + 0.34 * bk);
      v1.copy(rs.mouth).project(G.camera); v2.copy(M).project(G.camera); u.uSide.value.set((v1.x - v2.x) * G.camera.aspect, v1.y - v2.y); if (u.uSide.value.lengthSq() < 1e-8) u.uSide.value.set(-1, 0); u.uSide.value.normalize();
      lit(beam * (260 + 1500 * bk * bk) * fk, M, 1, 0.94, 0.86, 260);
      // arcs: a new target on the main spire five times a second, each arc alive for most of its slot
      const Sp = Rock.L.main;
      for (let i = 0; i < 3; i++) { const slot = Math.floor(t * 5 + i * 0.37), ph = t * 5 + i * 0.37 - slot, h1 = hsh(slot * 3.7 + i * 11.3), h2 = hsh(slot * 5.9 + i * 7.7), h3 = hsh(slot * 9.1 + i * 2.3);
        if (ph > 0.62 || h3 > 0.25 + 0.75 * bk) continue;
        if (i < 2) { const y = clamp(M.y + (h1 - 0.62) * 46, 30, Sp.top - 3), a0 = Math.atan2(M.z - Sp.z, M.x - Sp.x) + (h2 - 0.5) * 2.2, rr = lerp(Sp.r0, Sp.r1, y / Sp.top) * 0.82; v3.set(Sp.x + rr * Math.cos(a0), y, Sp.z + rr * Math.sin(a0)); }
        else { const o = h1 * TAU; v3.set(M.x + Math.cos(o) * 30 * (0.6 + h2), M.y - 22 - 30 * h2, M.z + Math.sin(o) * 22); }
        setBolt(S.bolts[3 + i], M, v3, slot * 1.9 + i * 13 + Math.floor(ph * 12) * 0.31, 0.085, 0.24, beam * (1.3 + 1.2 * bk) * (0.6 + 0.4 * hsh(n60 + i)), 2, 0.7, i === 1 ? WARM : COLD, i === 2 ? 1 : 0); }
      S.steam.mesh.visible = true; S.steam.u.uO.value.copy(M); S.steam.u.uGain.value = 0.22 * beam * (0.4 + 0.6 * bk);
      S.dEmb.mesh.visible = S.dIce.mesh.visible = true; S.dEmb.u.uO.value.copy(M); S.dIce.u.uO.value.copy(M); S.dEmb.u.uGain.value = S.dIce.u.uGain.value = beam * (0.5 + 0.8 * bk);
      v2.subVectors(rs.mouth, M).normalize(); S.dEmb.u.uAx.value.copy(v2); v2.subVectors(ws.mouth, M).normalize(); S.dIce.u.uAx.value.copy(v2);
    } else { S.dEmb.mesh.visible = S.steam.mesh.visible = false; if (!S.wHit) S.dIce.mesh.visible = false; }

    // ---- BLAST: flash, shock front, thousands of sparks, the leaves and the mist thrown outward, dust off the cliffs, a wave across the lake ----
    { const M = A.beamMid, on = dBlast >= 0 && dBlast < 10;
      if (on) { Film.beamMidAt(F.BLAST, ctr);
        v1.set(0, 1, 0); fire(S.bEmb, dBlast, ctr, v1); fire(S.bIce, dBlast, ctr, v1);
        const fI = dBlast < 0.034 ? 1 : Math.exp(-(dBlast - 0.034) / 0.055);                     // two hard frames, then it clears: the front and the two silhouettes are the picture, not the glare
        if (fI > 0.01) { flashOn = true; const u = setGlow(S.flash, ctr, 70, 70, C_BFL, C_BFL2, 14, fI, 0.6 * fI, 0); u.uSoft.value = 20; u.uBias.value = 14; lit(6000 * fI, ctr, 1, 0.96, 0.92, 260); }
        // the blast front: soft depth like the clash ring, so the cliffs and maples in front of the blast stand in front of it
        if (dBlast < 3.2) { const Rr = 12 + 300 * (1 - Math.exp(-dBlast * 1.25)), u = S.shock.u; S.shock.mesh.visible = true; u.uP.value.copy(ctr); u.uS.value.set(Rr / 0.72, Rr / 0.72); u.uRot.value = 0.6;
          u.uRing.value.set(0.72, 0.085 + 0.050 * dBlast, 0.95 * Math.exp(-dBlast / 0.75), 0.0); u.uSeed.value = 3.7; u.uSoft.value = 14; u.uLump.value = 1;
          v2.copy(ctr).project(G.camera); const Dc = cam.distanceTo(ctr), rs2 = Rr / (Dc * Math.tan(rad(G.camera.fov) * 0.5)) * 0.5, L = Post.lens;      // the same front as a lens: the cloud behind it bends as it passes
          if (v2.z < 1) { L.ring.value.set(v2.x * 0.5 + 0.5, v2.y * 0.5 + 0.5, rs2, 0.022 * Math.exp(-dBlast / 0.45) * sm(0, 0.03, dBlast)); L.ringS.value.set(1, 1, 0, Math.max(0.03, rs2 * (0.10 + 0.10 * dBlast))); } }
        if (S.cliff) { S.cliff.visible = dBlast < 9.5; S.cliff.material.uniforms.uO.value.copy(ctr); S.cliff.material.uniforms.uT.value = dBlast; }
        S.water.uRipB.value.set(ctr.x, ctr.z, 20 + 62 * dBlast, 0.7 * sm(0.05, 0.4, dBlast) * Math.exp(-dBlast / 1.6) * (1 - sm(4.5, 6, dBlast)));
      } else { S.bEmb.mesh.visible = S.bIce.mesh.visible = false; if (S.cliff) S.cliff.visible = false; S.water.uRipB.value.w = 0; }
      if (S.lan) { const f = dBlast > 0 && dBlast < 4 ? 1 - Math.exp(-dBlast / 1.1) * sm(0, 0.1, dBlast) * (0.55 + 0.4 * Math.sin(t * 47) * Math.sin(t * 29 + 1)) : 1; S.lan.m.color.copy(S.lan.base); if (f < 1) S.lan.m.color.multiplyScalar(Math.max(0.1, f));
        const up = t > F.OUT ? 1 + 1.6 * sm(F.OUT, F.OUT + 1.4, t) * (1 - sm(Film.DUR - 0.3, Film.DUR - 0.02, t)) : 1; if (up > 1) S.lan.m.color.multiplyScalar(up); } }      // and at the very end they come up as the daylight goes
    if (!flashOn) S.flash.mesh.visible = false; if (!ringOn) S.ring.mesh.visible = false;
    S.water.uRipOn.value = S.water.uRipA.value.w + S.water.uRipB.value.w + S.water.uFoamA.value + (S.water.uRipC ? S.water.uRipC.value.w : 0) + (S.water.uRipD ? S.water.uRipD.value.w : 0) > 0 ? 1 : 0;

    // ---- the pearl: small and intensely bright, a rainbow rim, a comet trail of sparks, its light on the two loongs ----
    { const pk = sm(F.BLAST + 0.12, F.BLAST + 0.7, t) * (1 - sm(F.GONG + 0.3, F.GONG + 1.8, t)); S.pearl.mesh.visible = S.pearlStar.mesh.visible = S.tail.mesh.visible = S.trail.visible = false;
      if (pk > 0.005) { const P = A.pearl, dist = cam.distanceTo(P), sc = Math.max(1, dist / 150), br = 0.85 + 0.15 * Math.sin(t * 9.4) + 0.06 * Math.sin(t * 23);
        S.pearl.mesh.visible = true; S.pearl.u.uP.value.copy(P); S.pearl.u.uS.value.set(5 * sc, 5 * sc); S.pearl.u.uPK.value = pk * br;
                const tu2 = S.tail.u; S.tail.mesh.visible = true; tu2.uA.value.copy(P); Film.pearlAt(t - 0.85, tu2.uB.value); tu2.uW.value.set(1.3 * sc, 0.15 * sc); tu2.uGain.value = 0.40 * pk * sm(F.BLAST + 0.9, F.BLAST + 2.2, t); tu2.uSpd.value = 1.6; tu2.uRep.value = 1.2;
        lit(1250 * pk * br, P, 1.0, 0.88, 0.62, 130); }
      // GONG: cloud vapour bursts from the mouth of the rift for as long as a body is still passing through it (Dragon.x.tGone when the choreography says so)
      { const tg = Math.max(red.tGone || F.GONG + 1.5, white.tGone || F.GONG + 1.5), kg = t > F.GONG - 0.1 && t < tg + 0.4 ? sm(F.GONG - 0.05, F.GONG + 0.12, t) * (1 - sm(tg - 0.1, tg + 0.35, t)) : 0;
        if (kg > 0.01) { const u = S.rime.u; S.rime.mesh.visible = true; u.uO.value.copy(A.rift); v1.subVectors(cam, A.rift).normalize(); u.uAx.value.copy(v1); u.uVel.value.copy(v1).multiplyScalar(4); u.uP1.value.x = 12; u.uP2.value.x = 3.4; u.uGain.value = 0.20 * kg; u.uC0.value.set(0.70, 1.0, 1.75); u.uC1.value.set(0.26, 0.40, 0.85); } }
      // when it is all over and the choreography leaves the pearl hanging still (the evening star above the spire), it is drawn small and steady until the last frame
      if (t > F.GONG + 1.9 && Film.pearlAt(t, v1).distanceToSquared(Film.pearlAt(t - 0.4, v2)) < 1e-6) { const ks = sm(F.GONG + 1.9, F.GONG + 3.2, t) * (1 - sm(Film.DUR - 0.25, Film.DUR - 0.05, t)), sc = Math.max(1, cam.distanceTo(v1) / 150), tw = 0.88 + 0.12 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1);
        if (ks > 0.005) { const u = setGlow(S.pearlStar, v1, 5.5 * sc, 5.5 * sc, C_STAR, C_0, 420, 0.75 * ks * tw, 0, 0); u.uRot.value = 0.35; u.uSoft.value = 3; } } }

    // ---- aftermath: ice crystals drifting down ----
    { const ik = sm(F.BLAST + 0.7, F.BLAST + 4, t) * (1 - sm(F.OUT - 1, F.OUT + 1.5, t)); S.ice.visible = ik > 0.005; S.ice.material.uniforms.uIce.value = ik;
    }

    // ---- marks left on the world: scars under every strike and the bolt (to the end of the film), char and flames where the chase fire
    //      washed rock, rime where the frost breath swept, the cracked face of the spire under the beam, chips falling from it ----
    for (const e of S.EV) if (e.scar) { const d = t - e.t; setDecal(e.scar, e.tg || cam, 4.6, e.tg && d >= 0 ? sm(0, 0.05, d) : 0, 1.0 * Math.exp(-Math.max(d, 0) / 0.35)); }
    { const dH = t - F.BOLT - HIT; setDecal(S.bScar, A.boltHit, 13, dH >= 0 ? sm(0, 0.05, dH) : 0, 1.9 * Math.exp(-Math.max(dH, 0) / 0.8) + 0.22 * Math.exp(-Math.max(dH, 0) / 3.0)); }
    { const ub = S.flame.material.uniforms.uB.value; let any = false;
      for (let i = 0; i < 2; i++) { const b = S.burns[i]; if (!b) { ub[i].w = 0; continue; } const d = t - b.t, k = d > 0 && d < 6.2 ? sm(0, 0.35, d) * (1 - sm(4.4, 6.2, d)) : 0; ub[i].set(b.p.x, b.p.y, b.p.z, k); if (k > 0.01) any = true;
        setDecal(b.scar, b.p, 6.5, d > 0 ? sm(0, 0.8, d) : 0, 0.9 * k);
        if (k > 0.01) lit(420 * k * (0.75 + 0.25 * Math.sin(t * 29 + i) + 0.2 * (hsh(Math.floor(t * 30) + i) - 0.5)), v1.copy(b.p).addScaledVector(b.n, 4), 1.0, 0.45, 0.12, 110); }
      S.flame.visible = any; const b0 = S.burns[0], d0 = b0 ? t - b0.t : -1, ks = b0 && d0 > 0.3 && d0 < 9 ? sm(0.3, 1.2, d0) * (1 - sm(6, 9, d0)) : 0; S.bSmoke.mesh.visible = ks > 0.01;
      if (ks > 0.01) { S.bSmoke.u.uO.value.copy(b0.p); S.bSmoke.u.uO.value.y += 2.5; S.bSmoke.u.uAx.value.set(-0.3, 1, 0.1).normalize(); S.bSmoke.u.uVel.value.set(-1.6, 0, 0.4); S.bSmoke.u.uGain.value = 0.55 * ks; } }
    for (const b of S.rimes) { const d = t - b.t; setDecal(b.scar, b.p, 7.5, d > 0 && d < 10.5 ? sm(0, 0.5, d) * (1 - sm(7, 10.5, d)) : 0, 0); }
    if (S.mScar) { const d = t - F.BEAM, b = S.mScar; setDecal(b.scar, b.p, 8.5, d > 0.7 ? sm(0.7, 2.6, d) : 0, 0.55 * beam * (0.4 + 0.6 * bk) + 0.7 * (dBlast > 0 ? Math.exp(-dBlast / 1.0) : 0));
      const dc = d - 1.3; if (dc >= 0 && dc < 4.3) { S.chunks.mesh.visible = true; S.chunks.u.uT.value = dc; S.chunks.u.uO.value.copy(b.p); S.chunks.u.uAx.value.copy(b.n).multiplyScalar(0.8); S.chunks.u.uAx.value.y += 0.5; S.chunks.u.uAx.value.normalize(); } }

    // ---- the one light: intensity-weighted blend of every source this frame (exactly the old breath light when only red breathes) ----
    if (lI > 1e-4) { const k = 1 / lI; breathLight.position.copy(lP).multiplyScalar(k); breathLight.color.setRGB(lR * k, lG * k, lB * k); breathLight.distance = lD * k; breathLight.intensity = lI; }
    else breathLight.intensity = 0;
    // ---- the screen-space punch Post reads (pure in t) ----
    Film.post.kick = 0.9 * pulse(t, F.CLASH1, 0.02, 0.16) + 1.0 * pulse(t, F.CLASH2, 0.02, 0.18) + 0.55 * pulse(t, F.BOLT + HIT, 0.02, 0.14) + 0.6 * pulse(t, F.SPLASH, 0.03, 0.22) + 1.6 * pulse(t, F.BLAST, 0.03, 0.4);
    // the colour split of a hit: full on the frame it lands, gone a quarter of a second later (the lens keeps only a sliver for a sustained shake)
    { let fr = hitE(t - F.ROAR, 0.55) + hitE(t - F.CLASH1, 1) + hitE(t - F.CLASH2, 1) + hitE(t - F.BOLT - HIT, 0.6) + hitE(t - F.SPLASH, 0.8) + hitE(t - F.BLAST, 1) + hitE(t - F.DESCENT + 0.04, 0.4);
      for (const sT of Film.STRIKES) fr += hitE(t - sT, 0.4);
      Post.lens.fringe.value = Math.min(fr, 1); }
  }
  return { build, U, S, get light() { return breathLight; } };                 // FX.light: the one point light every glow is blended into (the lake reads it for its glitter)
})();
