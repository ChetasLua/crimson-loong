'use strict';
// ---- render pipeline: MSAA HDR scene -> AO -> soft FX layer -> bloom (4 steps) -> sun shafts through the haze (quarter size) -> grade --
const Post = (() => {
  let R, W = 0, H = 0, rtMain, rtFx, rtAO, rtAO2, rtGod, rtGod2, rtSh, blooms = [];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(g, null); quad.frustumCulled = false; const qs = new THREE.Scene(); qs.add(quad); const qc = new THREE.Camera();
  const VS = 'varying vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const mk = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, fog: false });
  const DEPTH = /* glsl */`uniform sampler2D tDepth; uniform float uNear, uFar; uniform vec2 uIP;
    float vz(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
    vec3 vpos(vec2 uv){ float z = vz(texture2D(tDepth, uv).x); return vec3((uv * 2.0 - 1.0) * uIP * -z, z); }`;
  const cu = { tDepth: { value: null }, uNear: { value: 0.3 }, uFar: { value: 4000 }, uIP: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2() } };
  // FX materials (mist, sprites) share these for manual soft depth testing; tScene is the resolved scene colour, for the few that refract it
  const fxU = { tDepth: cu.tDepth, uNear: cu.uNear, uFar: cu.uFar, uRes: cu.uRes, tScene: { value: null } };
  const GLSL_FXDEPTH = /* glsl */`uniform sampler2D tDepth; uniform float uNear, uFar; uniform vec2 uRes;
    float sceneZ(){ float d = texture2D(tDepth, gl_FragCoord.xy / uRes).x; return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
    float softZ(float myViewZ, float soft){ return clamp((myViewZ - sceneZ()) / soft, 0.0, 1.0); }`;

  const mAO = mk(/* glsl */`${DEPTH} uniform vec2 uTexel; varying vec2 vUv;
    void main(){
      float d0 = texture2D(tDepth, vUv).x; if (d0 >= 0.99999) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
      vec3 p = vpos(vUv);
      vec3 px1 = vpos(vUv + vec2(uTexel.x, 0.0)), px0 = vpos(vUv - vec2(uTexel.x, 0.0)), py1 = vpos(vUv + vec2(0.0, uTexel.y)), py0 = vpos(vUv - vec2(0.0, uTexel.y));
      vec3 dx = abs(px1.z - p.z) < abs(p.z - px0.z) ? px1 - p : p - px0, dy = abs(py1.z - p.z) < abs(p.z - py0.z) ? py1 - p : p - py0;
      vec3 n = normalize(cross(dx, dy));
      float rw = clamp(-p.z * 0.035, 0.5, 5.0);                 // world radius grows with distance
      float rs = rw / (-p.z * uIP.y) * 0.5;                     // -> uv units (vertical)
      float ang = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
      float occ = 0.0;
      for (int i = 0; i < 12; i++) {
        float fi = (float(i) + 0.5) / 12.0, a = ang + fi * 6.2831853 * 3.7, r = rs * sqrt(fi);
        vec2 o = vec2(cos(a), sin(a)) * r * vec2(uIP.y / uIP.x, 1.0);
        vec3 v = vpos(vUv + o) - p; float l2 = dot(v, v);
        occ += max(dot(v, n) - 0.02 * -p.z * 0.02 - 0.03, 0.0) / (l2 + 0.02) * smoothstep(rw * rw * 2.5, rw * rw * 0.6, l2);
      }
      float ao = clamp(1.0 - occ * (2.0 / 12.0) * rw * 0.75, 0.0, 1.0);
      ao = mix(ao, 1.0, smoothstep(180.0, 420.0, -p.z));
      gl_FragColor = vec4(ao, 1.0 - d0, 0.0, 1.0); }`, { ...cu, uTexel: { value: new THREE.Vector2() } });
  const mAOBlur = mk(/* glsl */`uniform sampler2D tA; uniform vec2 uDir; varying vec2 vUv;
    void main(){ vec2 c = texture2D(tA, vUv).xy; float s = c.x * 0.30, w = 0.30;
      for (int i = 1; i <= 3; i++) { for (int k = -1; k <= 1; k += 2) { vec2 q = texture2D(tA, vUv + uDir * float(i * k) * 1.35).xy;
        float ww = (i == 1 ? 0.22 : i == 2 ? 0.10 : 0.03) * step(abs(q.y - c.y), 0.035 * c.y + 1e-7); s += q.x * ww; w += ww; } }
      gl_FragColor = vec4(s / w, c.y, 0.0, 1.0); }`, { tA: { value: null }, uDir: { value: new THREE.Vector2() } });
  const mCopy = mk(/* glsl */`uniform sampler2D tC, tA; uniform float uAO; varying vec2 vUv;
    void main(){ vec3 c = texture2D(tC, vUv).rgb; float ao = texture2D(tA, vUv).x; c *= mix(1.0, ao, uAO);
      gl_FragColor = vec4(min(c, vec3(250.0)), 1.0); }`, { tC: { value: null }, tA: { value: null }, uAO: { value: 0.9 } });
  const mDown = mk(/* glsl */`uniform sampler2D tC; uniform vec2 uT; uniform float uFirst; varying vec2 vUv;
    vec3 S(vec2 o){ vec3 c = texture2D(tC, vUv + o * uT).rgb; return c; }
    float kw(vec3 c){ return 1.0 / (1.0 + max(c.r, max(c.g, c.b)) * uFirst); }
    void main(){
      vec3 a = S(vec2(-2, 2)), b = S(vec2(0, 2)), c = S(vec2(2, 2)), d = S(vec2(-2, 0)), e = S(vec2(0, 0)), f = S(vec2(2, 0)), g = S(vec2(-2, -2)), h = S(vec2(0, -2)), i = S(vec2(2, -2));
      vec3 j = S(vec2(-1, 1)), k = S(vec2(1, 1)), l = S(vec2(-1, -1)), m = S(vec2(1, -1));
      vec3 g0 = (j + k + l + m) * 0.25, g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25, g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
      float w0 = kw(g0) * 0.5, w1 = kw(g1) * 0.125, w2 = kw(g2) * 0.125, w3 = kw(g3) * 0.125, w4 = kw(g4) * 0.125;
      vec3 o = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
      gl_FragColor = vec4(max(o, vec3(0.0)), 1.0); }`, { tC: { value: null }, uT: { value: new THREE.Vector2() }, uFirst: { value: 0 } });
  // first step of the bloom chain (full resolution -> half): four bilinear taps, each weighted against fireflies. The wide 13-tap
  // kernel above is kept for every later step, where it costs a quarter and less
  const mDown0 = mk(/* glsl */`uniform sampler2D tC; uniform vec2 uT; varying vec2 vUv;
    void main(){ vec3 a = texture2D(tC, vUv + vec2(-1.0, 1.0) * uT).rgb, b = texture2D(tC, vUv + vec2(1.0, 1.0) * uT).rgb, c = texture2D(tC, vUv + vec2(-1.0, -1.0) * uT).rgb, d = texture2D(tC, vUv + vec2(1.0, -1.0) * uT).rgb;
      float wa = 1.0 / (1.0 + max(a.r, max(a.g, a.b))), wb = 1.0 / (1.0 + max(b.r, max(b.g, b.b))), wc = 1.0 / (1.0 + max(c.r, max(c.g, c.b))), wd = 1.0 / (1.0 + max(d.r, max(d.g, d.b)));
      gl_FragColor = vec4(max((a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd), vec3(0.0)), 1.0); }`, { tC: { value: null }, uT: { value: new THREE.Vector2() } });
  const mUp = mk(/* glsl */`uniform sampler2D tC, tB; uniform vec2 uT; uniform float uMix; varying vec2 vUv;
    void main(){ vec3 s = vec3(0.0);
      s += texture2D(tC, vUv + vec2(-1, 1) * uT).rgb + texture2D(tC, vUv + vec2(1, 1) * uT).rgb + texture2D(tC, vUv + vec2(-1, -1) * uT).rgb + texture2D(tC, vUv + vec2(1, -1) * uT).rgb;
      s += 2.0 * (texture2D(tC, vUv + vec2(0, 1) * uT).rgb + texture2D(tC, vUv + vec2(0, -1) * uT).rgb + texture2D(tC, vUv + vec2(1, 0) * uT).rgb + texture2D(tC, vUv + vec2(-1, 0) * uT).rgb);
      s += 4.0 * texture2D(tC, vUv).rgb; s /= 16.0;
      gl_FragColor = vec4(mix(texture2D(tB, vUv).rgb, s, uMix), 1.0); }`, { tC: { value: null }, tB: { value: null }, uT: { value: new THREE.Vector2() }, uMix: { value: 0.6 } });
  const mGodMask = mk(/* glsl */`uniform sampler2D tC, tDepth; uniform vec2 uSun; uniform float uAsp; varying vec2 vUv;
    void main(){ float d = texture2D(tDepth, vUv).x; vec3 c = texture2D(tC, vUv).rgb;
      float l = dot(c, vec3(0.3, 0.5, 0.2)); vec2 q = (vUv - uSun) * vec2(uAsp, 1.0);
      float near = exp(-dot(q, q) * 1.6);
      float sky = step(0.99999, d);
      gl_FragColor = vec4(c * sky * near * smoothstep(0.9, 3.0, l), 1.0); }`, { tC: { value: null }, tDepth: cu.tDepth, uSun: { value: new THREE.Vector2() }, uAsp: { value: 1 } });
  const mGodBlur = mk(/* glsl */`uniform sampler2D tC; uniform vec2 uSun; uniform float uLen; varying vec2 vUv;
    void main(){ vec2 dir = (uSun - vUv) * uLen; vec3 s = vec3(0.0); float w = 0.0;
      for (int i = 0; i < 8; i++) { float f = (float(i) + 0.5) / 8.0; vec2 u = vUv + dir * f; float inb = step(0.0, u.x) * step(u.x, 1.0) * step(0.0, u.y) * step(u.y, 1.0);
        float ww = 1.0 - f * 0.35; s += texture2D(tC, u).rgb * ww * inb; w += ww; }
      gl_FragColor = vec4(s / w, 1.0); }`, { tC: { value: null }, uSun: { value: new THREE.Vector2() }, uLen: { value: 1 } });
  // sun shafts: the light the air itself scatters, marched at quarter resolution through the valley haze. Each step asks the sun's
  // shadow map (spires, halls, trees) and the drifting cloud-shadow field of the shared light chunk, so beams stand between the
  // shadows and move with the clouds. Output r = lit haze on the line of sight (the grade adds it in the sun's colour of the moment).
  const BEAM = Q.has('beam') ? +Q.get('beam') : 7.0;                    // strength of the beam under the tear in the storm (QA: &beam=0)
  const mShaft = mk(/* glsl */`#include <packing>
    ${GLSL_NOISE}${GLSL_FOG}
    uniform sampler2D tDepth, tShadow; uniform mat4 uCW, uShadowM; uniform float uNear, uFar, uShadowOn, uBeam; uniform vec2 uIP, uTexel; varying vec2 vUv;
    float vz(float d){ return (uNear * uFar) / ((uFar - uNear) * d - uFar); }
    void main(){
      // the farthest of four depths in the block: haze spills a hair onto near edges (reads as glow) instead of leaving a dark rim round them
      float d = max(max(texture2D(tDepth, vUv + uTexel * vec2(-1.0, -1.0)).x, texture2D(tDepth, vUv + uTexel * vec2(1.0, -1.0)).x), max(texture2D(tDepth, vUv + uTexel * vec2(-1.0, 1.0)).x, texture2D(tDepth, vUv + uTexel * vec2(1.0, 1.0)).x));
      float zmax = d >= 0.99999 ? 110.0 : min(-vz(d), 240.0);                          // against the open sky only the air near the lens counts
      vec3 rv = vec3((vUv * 2.0 - 1.0) * uIP, -1.0), ro = uCW[3].xyz, rd = mat3(uCW) * rv;      // world step per metre of view depth
      float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float acc = 0.0;
      for (int i = 0; i < 14; i++) {
        float s = (float(i) + jit) / 14.0, z = zmax * s * (0.35 + 0.65 * s);                     // closer steps near the lens
        vec3 p = ro + rd * z;
        float dens = exp(-max(p.y, 0.0) * 0.030) + 0.10, ray, sto, beam, lit = clSunCore(p, ray, sto, beam), sm = 1.0;
        if (uShadowOn > 0.5) { vec4 sc = uShadowM * vec4(p, 1.0);
          if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) sm = step(sc.z - 0.0015, unpackRGBAToDepth(texture2D(tShadow, sc.xy))); }
        // what the analytic haze of the materials does not know: the dark lanes behind spires and halls (-), the beams at a cloud's rim (+)
        // and the one column of lit air under the tear in the storm: the beam the two loongs fight in
        acc += dens * (lit * (sm * (1.0 + 4.5 * ray) - 1.0) + beam * sm * uBeam) * (zmax * (0.35 + 1.30 * s) / 14.0);
      }
      gl_FragColor = vec4(acc * 0.004, 0.0, 0.0, 1.0); }`, { tDepth: cu.tDepth, uNear: cu.uNear, uFar: cu.uFar, uIP: cu.uIP, uTexel: { value: new THREE.Vector2() }, tShadow: { value: null }, uShadowM: { value: new THREE.Matrix4() }, uShadowOn: { value: 0 }, uCW: { value: new THREE.Matrix4() }, uBeam: { value: BEAM }, ...Daylight.U });
  const fin = { tC: { value: null }, tB: { value: null }, tG: { value: null }, uBloom: { value: 0.085 }, uGod: { value: 0.55 }, uExp: { value: 1.0 }, uFade: { value: 1 }, uTime: G.uTime, uRes: { value: new THREE.Vector2() }, uShake: { value: 0 }, uFlash: { value: 0 }, uKick: { value: 0 }, tS: { value: null }, uShaftC: { value: new THREE.Vector3() } };
  const mFinal = mk(/* glsl */`uniform sampler2D tC, tB, tG, tS; uniform vec3 uShaftC; uniform float uBloom, uGod, uExp, uFade, uTime, uShake, uFlash, uKick; uniform vec2 uRes; varying vec2 vUv;
    vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 c){
      const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      c = I * (c / 0.6); c = RRTAndODTFit(c); return clamp(O * c, 0.0, 1.0); }
    void main(){
      vec2 uv = vUv, q = uv - 0.5; float r2 = dot(q, q);
      uv -= q * (r2 * uKick * 0.20);                                                // the kick: a radial punch toward the lens (exactly neutral at 0)
      vec2 ca = q * r2 * (0.006 + min(uShake * 0.02 + uKick * 0.012, 0.010));        // colour split, capped: past ~8 px in the corners every fine edge turns into rainbow stripes
      vec3 c = vec3(texture2D(tC, uv - ca).r, texture2D(tC, uv).g, texture2D(tC, uv + ca).b);
      vec3 b = texture2D(tB, uv).rgb, g = texture2D(tG, uv).rgb;
      { vec2 st = 4.0 / uRes;                                                         // the quarter-size shaft target, averaged over 4 x 4 of its texels by four bilinear taps (the size of the march's dither)
        float sh = texture2D(tS, uv + st).r + texture2D(tS, uv - st).r + texture2D(tS, uv + st * vec2(1.0, -1.0)).r + texture2D(tS, uv + st * vec2(-1.0, 1.0)).r;
        c = max(mix(c, b, uBloom) + g * uGod * vec3(1.0, 0.72, 0.46) + sh * 0.25 * uShaftC, 0.0); }
      c += b * uFlash * 0.25;
      c *= uExp * (1.0 - 0.42 * smoothstep(0.10, 0.75, r2 * 1.25));
      c = aces(c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.06);                                                   // saturation
      c += (vec3(-0.002, 0.003, 0.012) * (1.0 - l) + vec3(0.014, 0.006, -0.010) * l); // split tone: the shade leans to blue, the lit side to amber
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.44);                                    // S-curve: the density of a print
      c = pow(max(c, 0.0), vec3(1.0 / 2.2));
      float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.018;
      gl_FragColor = vec4(c * uFade, 1.0); }`, fin);
  // lens: screen-space extras the effects drive (FX.update writes them every frame; all zero = the plain lens, bit for bit)
  //   fringe  0..1  the colour split of a HIT (gone inside 0.3 s); a sustained shake only ever adds a sliver
  //   ring    xy = centre (uv), z = radius (in screen heights), w = strength: a pressure front that bends the picture as it passes
  //   ringS   x = squash along its own x axis, y/z = cos/sin of its turn on screen, w = width (in screen heights)
  const lens = { fringe: { value: 0 }, ring: { value: new THREE.Vector4(0.5, 0.5, 0, 0) }, ringS: { value: new THREE.Vector4(1, 1, 0, 0.05) } };
  // the same grade with the lens extras in it. It only runs on frames that need one of them (a hit, a hard shake, a shock front, a wet lens):
  // every other frame goes through mFinal above, whose code is untouched, so those frames stay bit-identical
  const finX = { ...fin, uFringe: lens.fringe, uRing: lens.ring, uRingS: lens.ringS };
  const mFinalFx = mk(/* glsl */`uniform sampler2D tC, tB, tG, tS; uniform vec3 uShaftC; uniform float uBloom, uGod, uExp, uFade, uTime, uShake, uFlash, uKick, uFringe; uniform vec2 uRes; uniform vec4 uRing, uRingS; varying vec2 vUv;
    vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
    vec3 aces(vec3 c){
      const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
      const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
      c = I * (c / 0.6); c = RRTAndODTFit(c); return clamp(O * c, 0.0, 1.0); }
    void main(){
      vec2 uv = vUv, q = uv - 0.5; float r2 = dot(q, q);
      uv -= q * (r2 * uKick * 0.20);                                                // the kick: a radial punch toward the lens (exactly neutral at 0)
      float asp = uRes.x / uRes.y;
      if (uRing.w > 0.0) {                                                          // a shock front crossing the frame: the picture is squeezed ahead of it and stretched behind, like air seen through a lens
        vec2 d = (vUv - uRing.xy) * vec2(asp, 1.0), e = vec2(d.x * uRingS.y + d.y * uRingS.z, -d.x * uRingS.z + d.y * uRingS.y); e.x /= uRingS.x;
        float rr = length(e), x = (rr - uRing.z) / uRingS.w, face = abs(e.x) / max(rr, 1e-4);
        vec2 dir = d / max(length(d), 1e-4); dir.x /= asp;
        uv -= dir * (x * exp(-x * x) * uRing.w * (0.25 + 0.75 * face)); }
      vec2 ca = q * r2 * (0.006 + min(uShake * 0.02, 0.0015) + 0.004 * uFringe);    // colour split: a sliver more while the frame shakes, the full split only on a hit and only for a quarter second
      vec3 c = vec3(texture2D(tC, uv - ca).r, texture2D(tC, uv).g, texture2D(tC, uv + ca).b);
      if (uKick > 0.2) {                                                            // the rest of a hit's punch: a short radial smear that grows toward the corners (only while the hit is fresh)
        vec2 rb = q * (r2 * min(uKick - 0.2, 1.4) * 0.020);
        c = (c * 1.4 + texture2D(tC, uv - rb).rgb * 1.2 + texture2D(tC, uv - rb * 2.0).rgb * 0.9 + texture2D(tC, uv - rb * 3.0).rgb * 0.5) / 4.0; }
      vec3 b = texture2D(tB, uv).rgb, g = texture2D(tG, uv).rgb;
      { vec2 st = 4.0 / uRes;                                                         // the quarter-size shaft target, averaged over 4 x 4 of its texels by four bilinear taps (the size of the march's dither)
        float sh = texture2D(tS, uv + st).r + texture2D(tS, uv - st).r + texture2D(tS, uv + st * vec2(1.0, -1.0)).r + texture2D(tS, uv + st * vec2(-1.0, 1.0)).r;
        c = max(mix(c, b, uBloom) + g * uGod * vec3(1.0, 0.72, 0.46) + sh * 0.25 * uShaftC, 0.0); }
      c += b * uFlash * 0.25;
      c *= uExp * (1.0 - 0.42 * smoothstep(0.10, 0.75, r2 * 1.25));
      c = aces(c);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.06);                                                   // saturation
      c += (vec3(-0.002, 0.003, 0.012) * (1.0 - l) + vec3(0.014, 0.006, -0.010) * l); // split tone: the shade leans to blue, the lit side to amber
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.44);                                    // S-curve: the density of a print
      c = pow(max(c, 0.0), vec3(1.0 / 2.2));
      float n = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      c += (n - 0.5) * 0.018;
      gl_FragColor = vec4(c * uFade, 1.0); }`, finX);

  const SHAFT = Q.has('shaft') ? +Q.get('shaft') : 0.24;                // strength of the sun shafts (QA: &shaft=0 switches them off)
  const BLV = 4;                                                         // bloom steps (was 7: the three smallest, 74 to 18 px wide, carried 15 % of the glow, cost six passes, and no frame shows them missing)
  let msaa = 4;                                    // MSAA samples of the scene target (the low quality tier asks for 2)
  function size(w, h, ms = 4) {
    ms = ms === 2 || ms === 0 ? ms : 4;
    if (w === W && h === H && ms === msaa) return; W = w; H = h; msaa = ms;
    for (const t of [rtMain, rtFx, rtAO, rtAO2, rtGod, rtGod2, rtSh, ...blooms.flat()]) if (t && t.dispose) t.dispose();      // blooms holds PAIRS of targets
    if (rtMain && rtMain.depthTexture) rtMain.depthTexture.dispose();
    const hf = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    const dt = new THREE.DepthTexture(W, H); dt.minFilter = dt.magFilter = THREE.NearestFilter;
    rtMain = new THREE.WebGLRenderTarget(W, H, { ...hf, samples: Q.has('nomsaa') ? 0 : msaa, depthTexture: dt });
    rtFx = new THREE.WebGLRenderTarget(W, H, { ...hf, depthBuffer: false });
    const hw = Math.max(2, W >> 1), hh = Math.max(2, H >> 1);
    rtAO = new THREE.WebGLRenderTarget(hw, hh, { ...hf, depthBuffer: false }); rtAO2 = new THREE.WebGLRenderTarget(hw, hh, { ...hf, depthBuffer: false });
    rtGod = new THREE.WebGLRenderTarget(Math.max(2, W >> 2), Math.max(2, H >> 2), { ...hf, depthBuffer: false }); rtGod2 = rtGod.clone(); rtSh = rtGod.clone();
    blooms = []; let bw = hw, bh = hh;
    for (let i = 0; i < BLV && bw > 8 && bh > 8; i++) { blooms.push([new THREE.WebGLRenderTarget(bw, bh, { ...hf, depthBuffer: false }), new THREE.WebGLRenderTarget(bw, bh, { ...hf, depthBuffer: false })]); bw >>= 1; bh >>= 1; }
    cu.uRes.value.set(W, H); fin.uRes.value.set(W, H);
  }
  const run = (mat, target) => { quad.material = mat; R.setRenderTarget(target); R.render(qs, qc); };
  const sunV = new THREE.Vector3();

  function render(scene, fxScene, camera, o) {
    cu.uNear.value = camera.near; cu.uFar.value = camera.far; cu.tDepth.value = rtMain.depthTexture; fxU.tScene.value = rtMain.texture;
    cu.uIP.value.set(1 / camera.projectionMatrix.elements[0], 1 / camera.projectionMatrix.elements[5]);
    R.setRenderTarget(rtMain); R.clear(); R.render(scene, camera);
    // AO at half res
    mAO.uniforms.uTexel.value.set(1 / rtAO.width, 1 / rtAO.height); run(mAO, rtAO);
    mAOBlur.uniforms.tA.value = rtAO.texture; mAOBlur.uniforms.uDir.value.set(1 / rtAO.width, 0); run(mAOBlur, rtAO2);
    mAOBlur.uniforms.tA.value = rtAO2.texture; mAOBlur.uniforms.uDir.value.set(0, 1 / rtAO.height); run(mAOBlur, rtAO);
    mCopy.uniforms.tC.value = rtMain.texture; mCopy.uniforms.tA.value = rtAO.texture; run(mCopy, rtFx);
    // soft FX layer straight onto the resolved image
    if (fxScene) { const ac = R.autoClear; R.autoClear = false; R.setRenderTarget(rtFx); R.render(fxScene, camera); R.autoClear = ac; }
    // bloom
    let src = rtFx.texture, sw = W, sh = H;
    for (let i = 0; i < blooms.length; i++) { const t = blooms[i][0], m = i === 0 ? mDown0 : mDown; m.uniforms.tC.value = src; m.uniforms.uT.value.set(1 / sw, 1 / sh); if (m === mDown) mDown.uniforms.uFirst.value = 0; run(m, t); src = t.texture; sw = t.width; sh = t.height; }
    let up = blooms[blooms.length - 1][0];
    for (let i = blooms.length - 2; i >= 0; i--) { const t = blooms[i][1]; mUp.uniforms.tC.value = up.texture; mUp.uniforms.tB.value = blooms[i][0].texture; mUp.uniforms.uT.value.set(1 / up.width, 1 / up.height); mUp.uniforms.uMix.value = 0.62; run(mUp, t); up = t; }
    // light shafts from the sun's screen position
    sunV.copy(camera.position).addScaledVector(SUN, 1000).project(camera);
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).dot(SUN);
    const sx = sunV.x * 0.5 + 0.5, sy = sunV.y * 0.5 + 0.5;
    let god = facing > 0.15 ? 1 : 0;
    if (god) {
      mGodMask.uniforms.tC.value = rtFx.texture; mGodMask.uniforms.uSun.value.set(sx, sy); mGodMask.uniforms.uAsp.value = W / H; run(mGodMask, rtGod);
      let a = rtGod, b = rtGod2;
      for (const len of [0.06, 0.2, 0.62]) { mGodBlur.uniforms.tC.value = a.texture; mGodBlur.uniforms.uSun.value.set(sx, sy); mGodBlur.uniforms.uLen.value = len; run(mGodBlur, b); const t = a; a = b; b = t; }
      fin.tG.value = a.texture;
    } else fin.tG.value = null;
    // sun shafts through the haze (quarter resolution, two blur passes)
    { const u = mShaft.uniforms, ss = G.sun && G.sun.shadow, L = Daylight.S, k = SHAFT * (o.shaft ?? 1) * L.shaft;
      if (k > 0) {
        u.uTexel.value.set(1 / W, 1 / H); u.uCW.value.copy(camera.matrixWorld);
        if (ss && ss.map) { u.tShadow.value = ss.map.texture; u.uShadowM.value.copy(ss.matrix); u.uShadowOn.value = 1; } else u.uShadowOn.value = 0;
        run(mShaft, rtSh);
        fin.tS.value = rtSh.texture;
      } else fin.tS.value = null;
      fin.uShaftC.value.set(SUN_COL.r * L.tint[0] * k, SUN_COL.g * L.tint[1] * k, SUN_COL.b * L.tint[2] * k); }
    fin.tC.value = rtFx.texture; fin.tB.value = up.texture;
    fin.uGod.value = god * (o.god ?? 0.55); fin.uFade.value = o.fade ?? 1; fin.uExp.value = (o.exposure ?? 1) * Daylight.S.lift; fin.uShake.value = o.shake ?? 0; fin.uFlash.value = o.flash ?? 0; fin.uBloom.value = o.bloom ?? 0.085; fin.uKick.value = o.kick ?? 0;
    // the lens extras need the second program; a frame without any of them takes the original one
    const L = lens, fx2 = L.fringe.value > 0 || L.ring.value.w > 0 || fin.uKick.value > 1e-4 || fin.uShake.value > 0.075;
    run(fx2 ? mFinalFx : mFinal, null);
  }
  // compile the extras program behind the loader (FX.build calls this): its first use is on a hit, where a compile stall would show
  function warm() { const t = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false }); run(mFinalFx, t); R.setRenderTarget(null); t.dispose(); }
  return { init(r) { R = r; }, size, render, warm, fxU, GLSL_FXDEPTH, lens, get W() { return W; }, get H() { return H; }, mCopy };
})();
