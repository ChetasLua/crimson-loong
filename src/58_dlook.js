'use strict';
// ---- how a loong LOOKS: palettes, the plate-scale shader, sculpted head, eyes, mouth, antlers, mane, whiskers, legs ----
// How it MOVES (rails, skinning, placement, state) lives in 60_dragon.js. Every colour here is palette data that reaches
// the GPU as a uniform or a vertex colour, so a new palette needs no new shader text and shares the compiled programs.
//
//   DragonLook.PAL = { red, white }
//   DragonLook.make(pal) -> { HS, bodyMat, bodyColor(a, phi, LEN, out), head: { group, world, mouthLocal, update(st, t) },
//                             leg: { right, left, mat }, mane: { geo, mat }, U, mats, pal }
// Sculpted geometry (SDF meshes, teeth, antlers, lids, frills, the mane tuft) is built once and shared between palettes:
// a palette only repaints the colour attributes. head.update(st, t) runs ALL head-internal animation from st and t alone
// (jaw, snarl, nostrils, blink, tongue, frills, whiskers, mane flow, eye glow, the st.vis fade), so it is seekable.
// Teeth, gums and antlers are tubeGeo() tubes: they rely on that helper winding its faces outward (00_util.js).
// Hair (mane.mat and the head's own mane) and whiskers are drawn with alpha to coverage: a strand is never narrower than
// about 1.2 px on screen and pays the difference in coverage, so far hair fades instead of breaking into dashes.
const DragonLook = (() => {
  const HS0 = 2.75;                                  // the head is sculpted at this scale; pal.HS scales the whole group
  const SH = { pxk: { value: 0.001 }, storm: { value: new THREE.Vector3() }, stormDir: { value: new THREE.Vector3(0, 1, 0) } };   // shared by every look
  const PAL = {
    // fire, earth and dusk
    red: { name: 'red', HS: 2.75, seed: 1425777218, env: 1.0,
      body: [0.55, 0.020, 0.022], deep: [0.30, 0.010, 0.014], flank: [0.66, 0.050, 0.026], belly: [0.86, 0.58, 0.30],   // scales, dorsal shade, low flank, belly plates
      crest: [0.82, 0.32, 0.05],                     // the raised shield plates: brow, nasal ridge, cheekbone
      skin: [0.34, 0.018, 0.016], pit: [0.012, 0.002, 0.002], lid: [0.40, 0.020, 0.018],          // nose leather and lips, nostril and socket, eyelids
      mouth: [0.34, 0.012, 0.020], gum: [0.50, 0.07, 0.08], tongue: [0.75, 0.12, 0.12],
      ivory: [0.92, 0.80, 0.56], ivoryRoot: [0.50, 0.30, 0.14], ivoryEmis: [0.10, 0.05, 0.01],
      horn0: [0.36, 0.09, 0.025], horn1: [0.96, 0.74, 0.40], claw: [0.10, 0.035, 0.02], clawTip: [0.55, 0.38, 0.20],
      groove: [0.30, 0.30, 0.30],                    // multiplies the base colour in the contact shadow under each plate
      accent: [0.90, 0.20, 0.03, 0.30],              // rgb + strength: the odd scale that catches the light
      rim: [1.0, 0.58, 0.16, 0.46],                  // rgb + strength: the gilded edge of each scale
      ember: [5.0, 0.85, 0.10], flesh: [2.6, 0.42, 0.05],   // HDR glow under the plates / inside the mouth (times st.glow)
      self: [0, 0, 0],                               // constant self-light, times the scale colour
      pearl: [1.0, 0.42, 0.10, 0.0],                 // rgb of the grazing sheen + strength of the iridescence
      mane: [[0.42, 0.030, 0.016], [0.98, 0.46, 0.10], [1.0, 0.74, 0.36]], maneEmis: 0.10, maneRim: [0.10, 0.045, 0.012], maneSelf: [0.15, 0.085, 0.055], maneSpec: 0.034, maneThru: 0.16, maneLen: 1.0, maneHang: 0.85,   // root, middle, tip; glow toward the tip, rim, self-light, strand highlight, light through the hair
      frill: [[0.36, 0.022, 0.018], [0.78, 0.16, 0.035], [1.0, 0.72, 0.30]], frillEmis: 0.04, frillSelf: [0, 0, 0], frillThru: 0.85, hornSelf: [0, 0, 0],   // frillThru: how much of the light on the far face comes through the membrane
      eye: [[0.90, 0.12, 0.0], [1.0, 0.62, 0.10]], eyeRing: [1.0, 0.86, 0.38], sclera: [0.10, 0.012, 0.006],
      whisker: [0.90, 0.26, 0.06], whiskerTip: [1.0, 0.72, 0.34], whiskerEmis: [0.20, 0.035, 0.008],
      fire: [9, 2.2, 0.3], fireCharge: [2.5, 0.4, 0.0], wetDark: 0.50, edgeThru: 0 },                // wetDark: what is left of the scale colour when soaked; edgeThru: sun through the free edges of the plates                                         // throat at full breath / full charge
    // sky, storm and moon
    white: { name: 'white', HS: 2.37, seed: 90210, env: 0.5,
      body: [0.86, 0.88, 0.92], deep: [0.50, 0.58, 0.72], flank: [0.90, 0.92, 0.96], belly: [0.60, 0.80, 0.96],
      crest: [0.60, 0.72, 0.94],
      skin: [0.42, 0.47, 0.62], pit: [0.02, 0.03, 0.07], lid: [0.80, 0.84, 0.95],
      mouth: [0.26, 0.07, 0.17], gum: [0.52, 0.26, 0.40], tongue: [0.60, 0.24, 0.42],
      ivory: [0.95, 0.96, 1.0], ivoryRoot: [0.62, 0.68, 0.82], ivoryEmis: [0.05, 0.06, 0.09],
      horn0: [0.46, 0.55, 0.80], horn1: [0.90, 0.94, 1.0], claw: [0.16, 0.20, 0.32], clawTip: [0.75, 0.82, 0.95],
      groove: [0.34, 0.43, 0.60],
      accent: [0.72, 0.86, 1.0, 0.28],
      rim: [1.0, 0.93, 0.74, 0.50],
      ember: [1.2, 2.6, 5.0], flesh: [0.7, 1.5, 2.8],
      self: [0.16, 0.26, 0.46],
      pearl: [0.62, 0.80, 1.0, 0.55],
      mane: [[0.40, 0.50, 0.82], [0.76, 0.86, 1.0], [0.96, 0.98, 1.0]], maneEmis: 0.10, maneRim: [0.16, 0.24, 0.42], maneSelf: [0.16, 0.24, 0.45], maneSpec: 0.040, maneThru: 0.10, maneLen: 1.12, maneHang: 0.95,
      frill: [[0.30, 0.44, 0.80], [0.58, 0.74, 0.98], [0.94, 0.98, 1.0]], frillEmis: 0.10, frillSelf: [0.07, 0.12, 0.24], frillThru: 0.55, hornSelf: [0.09, 0.15, 0.28],
      eye: [[0.02, 0.16, 0.85], [0.35, 0.75, 1.0]], eyeRing: [0.92, 0.98, 1.0], sclera: [0.05, 0.07, 0.16],
      whisker: [0.62, 0.74, 0.96], whiskerTip: [0.96, 0.98, 1.0], whiskerEmis: [0.12, 0.19, 0.34],
      fire: [2.6, 5.2, 9.0], fireCharge: [0.6, 1.3, 2.6], wetDark: 0.70, edgeThru: 0.5 },
  };
  const sy = (f, k, cy = 0) => (x, y, z) => f(x, cy + (y - cy) / k, z) * k;
  const mixc = (a, b, t, o) => { o[0] = lerp(a[0], b[0], t); o[1] = lerp(a[1], b[1], t); o[2] = lerp(a[2], b[2], t); };
  const mix3 = (o, b, t) => { o[0] += (b[0] - o[0]) * t; o[1] += (b[1] - o[1]) * t; o[2] += (b[2] - o[2]) * t; };       // toward b, in place
  const u3 = a => ({ value: new THREE.Vector3(a[0], a[1], a[2]) }), u4 = a => ({ value: new THREE.Vector4(a[0], a[1], a[2], a[3]) });
  const BA = (a, k) => new THREE.BufferAttribute(a, k);
  const share = {};                                  // palette-independent geometry, built on first use
  // ---------- the wet clock. A ring of the body is wet from the moment its place on the rail comes within reach of the lake
  // (under it, or low enough over it to be in the water it throws) and dries after it has left. make() builds, once, the list of
  // those moments for every two metres of body (pure rail arithmetic); each frame the age "seconds since this ring left the
  // water" goes to the shaders in NW slots along the body, and the head, the legs and all hair read the same clock ----------
  const NW = 64, WET_DA = 2, WET_DT = 1 / 24, WET_REACH = 2.2;
  const wetOf = age => 1 - sm(2.6, 7.0, age), flowOf = age => 1 - sm(0.15, 1.6, age), hairOf = age => 1 - sm(2.8, 7.5, age);
  const WET_GLSL = v => `1.0 - smoothstep(2.6, 7.0, ${v})`, FLOW_GLSL = v => `1.0 - smoothstep(0.15, 1.6, ${v})`, HAIR_GLSL = v => `1.0 - smoothstep(2.8, 7.5, ${v})`;
  const stamp = (k, t0) => { const o = G.info.look || (G.info.look = {}); o[k] = (o[k] || 0) + Math.round(performance.now() - t0); };

  // ---------- material: overlapping keeled plates. uv.x = "along" coordinate, the angle comes from uv.y (body tube) or from aQ
  // (sculpted parts, per pixel, so there is no seam); aK = belly 0..1; aMk = flesh, horn, bare skin, shield-plate weight ----------
  function scaleMat(kind, N, rowK, rowM, pal, U) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.12 }); m.envMapIntensity = pal.env;
    m.defines = { USE_UV: '' }; if (kind !== 'body') m.defines.DL_POLAR = ''; if (kind === 'head') m.defines.DL_HEAD = ''; if (kind === 'leg') m.defines.DL_LEG = '';
    const u = { uSc: { value: new THREE.Vector3(N, rowK, rowM) }, uGlow: U.glow, uPxK: SH.pxk, uGroove: u3(pal.groove), uAccent: u4(pal.accent), uRim: u4(pal.rim), uEmber: u3(pal.ember), uFlesh: u3(pal.flesh), uSelf: u3(pal.self), uPearl: u4(pal.pearl), uExpr: U.expr, uHS: { value: HS0 }, uWetAge: U.wetAge, uWetK: U.wetK, uWetH: U.wetH, uLegW: U.legW, uLegP0: U.legP0, uLegP1: U.legP1, uEdge: { value: pal.edgeThru || 0 }, uWetD: { value: pal.wetDark } };
    m.userData.u = u;
    patch(m, s => {
      Object.assign(s.sh.uniforms, u);
      s.vHead(`attribute vec3 aT; attribute float aK; attribute vec4 aMk; varying vec3 vT; varying float vK; varying vec4 vMk; varying float vVZ; varying vec2 vWet;
#ifdef DL_POLAR
attribute vec2 aQ; varying vec2 vQ;
#endif
#ifdef DL_HEAD
attribute vec3 aM; uniform vec4 uExpr; uniform float uHS; uniform vec2 uWetH;
#elif defined(DL_LEG)
uniform vec4 uLegW; uniform vec3 uLegP0, uLegP1;
#else
uniform float uWetAge[${NW}]; uniform float uWetK;
#endif`);
      s.v('#include <begin_vertex>', `#include <begin_vertex>
 vT = normalize(normalMatrix * aT); vK = aK; vMk = aMk;
#ifdef DL_POLAR
 vQ = aQ;
#endif
#ifdef DL_HEAD
 vWet = uWetH;                                       // x: how wet (dark, glossy), y: water still pouring off (the first second and a half)
#elif defined(DL_LEG)
 { vec3 lp = modelMatrix[3].xyz, d0 = lp - uLegP0, d1 = lp - uLegP1; vWet = dot(d0, d0) < dot(d1, d1) ? uLegW.xy : uLegW.zw; }
#else
 { float wa = clamp(uv.x * uWetK, 0.0, ${(NW - 1.001).toFixed(3)}); int wi = int(wa); float age = mix(uWetAge[wi], uWetAge[wi + 1], wa - float(wi));
   vWet = vec2(${WET_GLSL('age')}, ${FLOW_GLSL('age')}); }
#endif
#ifdef DL_HEAD
 { float sx = position.x < 0.0 ? -1.0 : 1.0;       // expression: the upper lip lifts, the brow lowers, the nostrils flare
   transformed += (vec3(sx * 0.04, 0.15, 0.03) * (aM.x * uExpr.x) + vec3(-sx * 0.05, -0.14, 0.10) * (aM.y * uExpr.y) + objectNormal * (0.035 * aM.z * uExpr.z)) * uHS; }
#endif`);
      s.v('#include <project_vertex>', '#include <project_vertex>\n vVZ = -mvPosition.z;');
      s.fHead(`varying vec3 vT; varying float vK; varying vec4 vMk; varying float vVZ; varying vec2 vWet; uniform vec3 uSc; uniform float uGlow, uPxK, uTime, uEdge, uWetD; uniform vec3 uGroove, uEmber, uFlesh, uSelf; uniform vec4 uAccent, uRim, uPearl;
#ifdef DL_POLAR
varying vec2 vQ;
#endif
        ${GLSL_NOISE}
        float dRough, dMetal, dRimT, dWetH = 0.0; vec3 dEmis; vec2 dGrad;
        // value noise that closes round the limb (period per in x): the water on a wet loong has no seam
        float wnz(vec2 x, float per){ vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); float i0 = mod(i.x, per), i1 = mod(i.x + 1.0, per);
          return mix(mix(hash21(vec2(i0, i.y)), hash21(vec2(i1, i.y)), f.x), mix(hash21(vec2(i0, i.y + 1.0)), hash21(vec2(i1, i.y + 1.0)), f.x), f.y); }
        // one plate lattice: height, analytic gradient g, the bevelled free edge (rim), a per-plate random (id), the contact
        // shadow cast by the plates lying on top (occ: 0 dark .. 1 open) and the position inside the plate (lq)
        float dScale(vec2 p, float per, out vec2 g, out float rim, out float id, out float occ, out vec2 lq){
          rim = 0.0; id = 0.5; occ = 1.0; g = vec2(0.0); lq = vec2(0.0); float em = 9.0, j0 = floor(p.y - 1.31);
          for (int k = (p.y - j0 > 1.58 ? 1 : 0); k < 4; k++){ float j = j0 + float(k), off = mod(j, 2.0) * 0.5, ix = floor(p.x - off);     // row 0 only ever casts its contact shadow
            for (int c = 0; c < 2; c++){ float cx = ix + float(c) + off; vec2 q = vec2((p.x - cx) / 0.575, (p.y - (j + 0.45)) / 0.86); float e = dot(q, q);
              if (e < 1.0){ float ty = clamp((p.y - (j - 0.41)) / 1.72, 0.0, 1.0), u = clamp((e - 0.72) / 0.28, 0.0, 1.0), s = u * u * (3.0 - 2.0 * u), ds = 6.0 * u * (1.0 - u) / 0.28;
                float kq = exp(-q.x * q.x * 18.0), kt = smoothstep(0.10, 0.50, ty) * 0.10, body = 0.30 + 0.70 * ty + kq * kt;
                g = -ds * body * vec2(q.x / 0.2875, q.y / 0.43) + (1.0 - s) * vec2(-36.0 * q.x * kq * kt / 0.575, 0.407);
                rim = s * smoothstep(0.25, 0.60, ty); id = hash21(vec2(mod(cx, per) * 7.0 + 0.5, j)); occ = smoothstep(1.0, 1.55, em); lq = q;
                return (1.0 - s) * body; }
              em = min(em, e); } }
          return 0.0; }`);
      s.f('#include <color_fragment>', `#include <color_fragment>
        {
#ifdef DL_POLAR
          float ang = atan(vQ.y, vQ.x) * 0.15915494 + 0.5;
#else
          float ang = vUv.y;
#endif
          vec2 p = vec2(ang * uSc.x, vUv.x * uSc.y);
          float rpx = uSc.z / max(vVZ * uPxK, 1e-5), lod = smoothstep(1.2, 4.5, rpx), fine = smoothstep(7.0, 24.0, rpx), rl = smoothstep(4.0, 12.0, rpx);
          // a scale under about six pixels cannot carry its own glint or its own gilded edge without twinkling as the body slides:
          // the plate pattern (lodA) and the relief, gloss and metal of each plate (lodS) melt into a satin mean before that
          float lodA = smoothstep(2.6, 6.5, rpx), lodS = smoothstep(3.2, 7.5, rpx);
          float kB = clamp(vK, 0.0, 1.0), kF = vMk.x, kH = vMk.y, kS = vMk.z, kN = clamp(kF + kH + kS, 0.0, 1.0);
          vec2 g, q; float rim, id, occ, h = dScale(p, uSc.x, g, rim, id, occ, q);
#ifdef DL_HEAD
          if (vMk.w > 0.004) { vec2 g2, q2; float r2, i2, o2, h2 = dScale(vec2(p.x * 0.5, p.y * 0.5 + 3.7), uSc.x * 0.5, g2, r2, i2, o2, q2), w = smoothstep(0.25, 0.75, vMk.w);
            h = mix(h, h2, w); g = mix(g, g2 * 0.6, w); rim = mix(rim, r2, w); id = mix(id, i2, w); occ = mix(occ, o2, w); q = mix(q, q2, w); }
#endif
          float e = dot(q, q), ring = sin(e * 24.0 + id * 31.0), open = occ * smoothstep(0.0, 0.30, h);
          vec3 base = diffuseColor.rgb;
          vec3 sc = base * (0.70 + 0.55 * id) * mix(0.72, 1.10, smoothstep(-0.8, 0.9, q.y)) * (1.0 - 0.06 * fine * (0.5 + 0.5 * ring));
          sc = mix(sc, uAccent.rgb, smoothstep(0.80, 0.98, id) * uAccent.a);
          sc = mix(sc, uRim.rgb, rim * uRim.a);
          sc *= mix(uGroove, vec3(1.0), open);
          sc = mix(base * 0.86, sc, max(lodA, 0.20));
          // belly plates lie like shingles: each has a shadowed strip where the plate in front overlaps it and a lit free edge. Both
          // strips are never narrower than about a pixel and a half, so the plates still read at 3 to 6 px each, and they melt into
          // their mean tone below that. On the body the free edge bows toward the tail at the keel and the tone falls off to the flank.
#ifdef DL_POLAR
#ifdef DL_HEAD
          float bf = smoothstep(4.3, 5.7, vUv.x);                                                                       // throat: the bands it had. The round chin stays smooth: there they closed into contour rings
#else
          float bf = 1.0;
#endif
          float pl = fract(p.y / 2.05), plh = mix(1.0, smoothstep(0.0, 0.10, pl) * smoothstep(1.0, 0.82, pl), bf);
          vec3 be = base * mix(0.42, 1.0, mix(1.0, plh, lod)) * (1.0 - 0.07 * fine * bf * (0.5 + 0.5 * sin(pl * 44.0)));
          float bGrad = (smoothstep(0.0, 0.10, pl) - smoothstep(0.84, 1.0, pl)) * 1.4 * lod * bf, bRough = mix(0.55, 0.46, lod);
#else
          float cb = clamp((ang - 0.75) / 0.176, -1.0, 1.0), py = p.y / 2.05 + 0.34 * cb * cb, pl = fract(py), pid = hash11(floor(py) * 0.731 + 3.1);
          float plh = smoothstep(0.0, 0.10, pl) * smoothstep(1.0, 0.82, pl), ppp = 2.05 * rpx, bAmp = smoothstep(1.4, 3.2, ppp);
          float e0 = clamp(2.4 / ppp, 0.24, 0.46), e1 = clamp(2.4 / ppp, 0.13, 0.40), ew = clamp(1.3 / ppp, 0.015, 0.20), bEnd = 1.0 - smoothstep(1.0 - ew, 1.0, pl);   // bEnd: the step down onto the next plate, at least a pixel wide (no dotted seam)
          float bSh = min(smoothstep(0.0, e0, pl), bEnd), bLip = smoothstep(1.0 - ew - e1, 1.0 - ew - 0.3 * e1, pl) * bEnd;
          float bTone = mix(0.40, 1.0, bSh) * (0.84 + 0.20 * pl) * (1.0 + 0.30 * bLip * smoothstep(2.5, 6.0, ppp)) * (0.93 + 0.14 * pid);
          vec3 be = base * mix(0.84, bTone, bAmp) * (1.0 - 0.07 * fine * (0.5 + 0.5 * sin(pl * 44.0))) * (1.0 - 0.24 * cb * cb) * (1.0 + 0.05 * exp(-cb * cb * 30.0));
          float bGrad = (1.0 * (1.0 - bSh) + 0.25 * bSh * (1.0 - bLip) - 1.5 * smoothstep(1.0 - 0.55 * e1, 1.0, pl)) * smoothstep(4.0, 11.0, ppp), bRough = mix(0.40, 0.28, bLip * smoothstep(4.0, 11.0, ppp));   // relief and the bright edge only while a plate is several pixels long (no sparkle far away); the tone carries it below that
#endif
          vec3 col = mix(sc, be, kB);
          float rph = p.y * 0.85 + 0.9 * sin(p.x * 0.55), rug = 1.0 - pow(abs(sin(rph)), 0.35);                                // palate ridges: broad, with narrow creases
#ifdef DL_POLAR
          vec2 pc = vQ * 52.0 + vUv.x * vec2(15.0, 23.0);                                                              // pebbled leather, free of the polar pinch at the nose
#else
          vec2 pc = p * 3.1;
#endif
#ifdef DL_HEAD
          float gul = 0.07 + 0.93 * smoothstep(3.4, 7.4, vUv.x), rgm = 1.0 - smoothstep(0.24, 0.40, abs(vQ.x));         // the mouth glows from the gullet forward; ridges on the roof only
#else
          float gul = 1.0, rgm = 1.0;
#endif
          float peb = 0.5; vec2 pbn = vec2(0.0); if (kS > 0.002) { peb = vnoise(pc); pbn = vec2(vnoise(pc + 7.0), vnoise(pc + 13.0)) - 0.5; }
          col = mix(col, base * (0.84 + 0.30 * abs(2.0 * peb - 1.0)), kS);
          if (kH > 0.002) col = mix(col, base * (0.86 + 0.28 * vnoise(vec2(p.x * 5.0, p.y * 0.5))), kH);
          col = mix(col, base * (1.0 - 0.45 * rug * rgm), kF);
          float nv = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);                                // pearl: a thin-film shift with the view angle
          if (uPearl.a > 0.0) { vec3 iri = 0.5 + 0.5 * cos(6.2832 * (nv * 1.15 + id * 0.55 + vec3(0.0, 0.33, 0.67)));
            col *= mix(vec3(1.0), 0.80 + 0.40 * iri, uPearl.a * lod * (1.0 - kN) * (1.0 - kB * 0.5)); }
          diffuseColor.rgb = col;
          vec2 gs = clamp(g, -3.0, 3.0) * (0.30 + 0.20 * rl) - 0.16 * q * cos(e * 24.0 + id * 31.0) * fine;
          dGrad = mix(gs * lodS, vec2(0.0, bGrad), kB) * (1.0 - kN)
                + vec2(0.0, 0.45 * rgm * sin(2.0 * rph) * (1.0 - rug)) * kF + pbn * (0.5 * kS * fine);
          dRough = mix(mix(0.46, 0.30, id), 0.24, rim); dRough = mix(0.52, dRough, lodS); dRough = mix(dRough, bRough, kB);
          dRough = mix(dRough, 0.44, kS); dRough = mix(dRough, 0.30, kH); dRough = mix(dRough, 0.24, kF);
          dMetal = mix(0.08 + 0.55 * rim * lodS * (0.4 + 0.6 * rl), 0.0, max(kB, kN)); dRimT = rim * lodS * (1.0 - max(kB, kN));
          float groove = (1.0 - open) * (1.0 - kB) + (1.0 - plh) * kB;
          float wave = 0.55 + 0.45 * sin(vUv.x * 0.22 + uTime * 5.5);
#ifdef DL_LEG
          const float gk = 0.14;                                                                                        // a leg's "along" is not metres behind the head: at full glow every groove lit up, a net over the leg
#else
          const float gk = 1.0;
#endif
          dEmis = uEmber * groove * groove * (0.75 * uGlow * gk * wave * smoothstep(120.0, 0.0, vUv.x) + 0.012) * mix(0.5, 1.0, lod) * (1.0 - kN)
                + uFlesh * kF * uGlow * gul + uSelf * col + uPearl.rgb * (uPearl.a * 0.30 * pow(1.0 - nv, 3.0)) * (1.0 - kF);
          // out of the lake: a stop darker, a tight gloss, and water running down it. The runs follow gravity over the surface (round
          // the limb where it lies level, along it where it rears), ride with the body, pour in sheets for the first second and thin
          // to threads; the film of water fills the relief between the plates.
          if (vWet.x > 0.004) { float wet = vWet.x, flw = vWet.y;
            vec3 wN = normalize(vNormal), wT = vT - wN * dot(vT, wN); wT /= max(length(wT), 1e-4); vec3 wB = cross(wN, wT), dnV = -viewMatrix[1].xyz;
            vec2 gt = vec2(dot(dnV, wB), dot(dnV, wT)); float sp = uTime * mix(1.3, 3.4, flw), thr = mix(0.68, 0.46, flw), me = 0.8 * sin(ang * 37.699 + p.y * 0.7);
            float nA = wnz(vec2(p.x * 0.25 - sign(gt.x) * sp, p.y * 5.0 + me), uSc.x * 0.25), nB = wnz(vec2(p.x * 5.0 + 0.8 * sin(p.y * 0.9), p.y * 0.25 - sign(gt.y) * sp), uSc.x * 5.0);
            float kA = smoothstep(0.03, 0.30, gt.x * gt.x), kT = smoothstep(0.03, 0.30, gt.y * gt.y), near = smoothstep(1.5, 4.0, rpx) * wet;
            float film = max(smoothstep(thr, thr + 0.10, nA) * kA, smoothstep(thr, thr + 0.10, nB) * kT) * near;                           // where a run of water lies
            float edge = max(smoothstep(thr, thr + 0.10, nA) * (1.0 - smoothstep(thr + 0.12, thr + 0.30, nA)) * kA, smoothstep(thr, thr + 0.10, nB) * (1.0 - smoothstep(thr + 0.12, thr + 0.30, nB)) * kT) * near;   // its thick, bright margin
            float lip = kB * flw * smoothstep(0.76, 0.96, pl) * (0.35 + 0.65 * nB) * near;                                                // it spills white over the free edge of every belly plate
            // beads left standing on the plates once the sheets have run off: each one a small lens for the sun
            vec2 bq = p * 2.0, bi = floor(bq); vec2 bh = hash22(vec2(mod(bi.x, uSc.x * 2.0), bi.y)); float bd = length(bq - bi - 0.5 - (bh - 0.5) * 0.50), br = 0.09 + 0.13 * bh.y;
            float bead = (1.0 - smoothstep(br * 0.55, br, bd)) * step(0.42, bh.x) * (1.0 - flw) * wet * smoothstep(7.0, 16.0, rpx) * (1.0 - kF);
            vec3 dc = diffuseColor.rgb * mix(1.0, uWetD, wet * (1.0 - 0.6 * kF));
            diffuseColor.rgb = mix(dc, vec3(0.66, 0.73, 0.78), clamp(edge * (0.07 + 0.50 * flw) + lip * 0.75, 0.0, 0.85));                // white water while it pours
            dRough = mix(dRough, mix(0.30, 0.14, lodS), wet); dRough = mix(dRough, 0.05, max(film, bead));
            dMetal = mix(dMetal, max(dMetal, 0.26), wet * (1.0 - kF));
            dWetH = (0.045 * film + 0.016 * lip + 0.030 * bead * (1.0 - bd / br)) * uSc.z;
            #if NUM_HEMI_LIGHTS > 0
            dEmis += hemisphereLights[0].skyColor * (0.13 * wet * pow(1.0 - nv, 3.0) * (1.0 - kF));                                       // the sky lies on a wet back
            #endif
            dGrad *= 1.0 - 0.62 * wet; dEmis *= 1.0 - 0.35 * wet; } }`);
      s.f('#include <normal_fragment_maps>', `{ vec3 Tn = vT - normal * dot(vT, normal); Tn /= max(length(Tn), 1e-4); vec3 Bn = cross(normal, Tn); normal = normalize(normal - (Bn * dGrad.x + Tn * dGrad.y)); }
        { float hx = dFdx(dWetH), hy = dFdy(dWetH);                                                                    // the relief of the water itself: runs, spills and beads
          if (vWet.x > 0.004) { vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), r1 = cross(sy, normal), r2 = cross(normal, sx); float det = dot(sx, r1);
            normal = normalize(max(abs(det), 1e-9) * normal - sign(det) * (hx * r1 + hy * r2) * smoothstep(0.12, 0.50, abs(dot(normal, normalize(vViewPosition)))));
            vec3 vd = normalize(vViewPosition); float nvd = dot(normal, vd); if (nvd < 0.0) normal = normalize(normal - nvd * vd); } }`);
      s.f('#include <roughnessmap_fragment>', 'float roughnessFactor = dRough;');
      s.f('#include <metalnessmap_fragment>', 'float metalnessFactor = dMetal;');
      s.f('#include <emissivemap_fragment>', `totalEmissiveRadiance += dEmis;
        #if NUM_DIR_LIGHTS > 0 && defined( USE_FOG )
          if (uEdge > 0.0 && dRimT > 0.004) { vec3 Ld = directionalLights[0].direction;                               // thin horn plates: the sun comes through their free edges
            totalEmissiveRadiance += uRim.rgb * directionalLights[0].color * clSun(vFogW) * (uEdge * dRimT * (0.30 * max(dot(-normal, Ld), 0.0) + pow(clamp(dot(normalize(vViewPosition), -Ld), 0.0, 1.0), 2.0))); }
        #endif`);
    }, 'dragon4' + kind);
    return m;
  }

  // ---------- the sculpt (sculpt units; z forward, y up; everything is written for x >= 0 and mirrored) ----------
  const EYE = [0.62, 0.42, 0.70], GAZE = [0.800, 0.080, 0.595], RE = 0.190, RS = 0.228, RL = 0.214;   // eye centre, gaze, radii: ball, socket, lid shell
  const NOS = [0.30, 0.19, 2.82];                                                                    // nostril
  const ymW = z => -0.36 - 0.03 * z + 0.028 * Math.sin(z * 2.7 + 0.6) * sm(0.0, 0.8, z);             // the lip line, with a slow wave
  const xU = z => lerp(0.61, 0.32, clamp((z - 0.2) / 2.22)), xL = z => lerp(0.47, 0.23, clamp((z - 0.3) / 1.9));   // tooth rows (upper, lower) along the sides
  const UF = [2.42, 0.32, 0.33], LF = [2.20, 0.23, 0.22];                                            // front arc of each row: z of its centre, x radius, z radius
  function sculpt() {
    if (share.sc) return share.sc;
    const { SU, SUB, U, sph, ell, cone, lock, rot, bound } = SD, ab = f => (x, y, z) => f(x < 0 ? -x : x, y, z);
    const brow = lock([0.20, 0.47, 1.22], [0.68, 1.00, 0.66], [1.08, 0.86, -0.42], 0.23, 0.13);                       // overhangs the eye
    const crest = lock([0.60, 0.84, 0.35], [0.56, 0.98, -0.20], [0.50, 0.82, -0.85], 0.15, 0.19);                     // brow -> antler base
    const ridge = bound(SU(0.05, cone(0, 0.45, 0.92, 0, 0.24, 2.32, 0.15, 0.11), sph(0, 0.58, 1.02, 0.125), sph(0, 0.53, 1.33, 0.115), sph(0, 0.47, 1.63, 0.105), sph(0, 0.41, 1.91, 0.095), sph(0, 0.36, 2.17, 0.085)), 0, 0.42, 1.6, 0.98);
    const zyg = lock([0.56, 0.04, 1.30], [0.98, 0.10, 0.48], [1.04, -0.02, -0.60], 0.15, 0.22);                       // cheekbone
    const orbit = sph(EYE[0] - GAZE[0] * 0.12, EYE[1] - GAZE[1] * 0.12, EYE[2] - GAZE[2] * 0.12, 0.31);
    const mound = ell(NOS[0], NOS[1] - 0.02, NOS[2] - 0.10, 0.17, 0.16, 0.23);
    const nostril = rot(ell(NOS[0] + 0.05, NOS[1], NOS[2] + 0.05, 0.058, 0.085, 0.14), 0, 0.6, 0, NOS[0], NOS[1], NOS[2]);
    const core = SU(0.22, ell(0, 0.10, -0.55, 1.00, 0.80, 1.18), sy(cone(0, -0.03, 0.15, 0, -0.12, 2.50, 0.74, 0.38), 0.80, -0.08), ell(0, 0.03, 2.72, 0.34, 0.24, 0.32),
      cone(0.50, -0.26, 0.15, 0.27, -0.33, 2.45, 0.22, 0.14), ell(0, -0.22, 2.60, 0.35, 0.23, 0.30), ell(0.84, -0.12, -0.25, 0.40, 0.48, 0.75));
    let up = SU(0.045, SU(0.10, core, brow, crest, zyg, orbit, mound), ridge);
    up = SUB(up, sph(EYE[0], EYE[1], EYE[2], RS), 0.03);
    up = SUB(up, nostril, 0.03);
    up = SUB(up, ell(0, -0.06, 3.07, 0.050, 0.20, 0.11), 0.06);                                                       // philtrum
    up = SUB(up, (x, y, z) => Math.max(y - ymW(z), -(z + 0.72)), 0.045);
    up = SUB(up, ell(0, -0.42, 0.90, 0.46, 0.27, 1.62), 0.05);
    let jw = SU(0.15, sy(cone(0, -0.50, -0.7, 0, -0.56, 2.25, 0.60, 0.29), 0.6, -0.55), sph(0, -0.70, 2.10, 0.24), ell(0.62, -0.42, -0.35, 0.30, 0.34, 0.5));
    jw = SU(0.05, jw, sph(0, -0.95, 1.96, 0.085), sph(0.15, -0.90, 2.17, 0.07), sph(0.13, -0.86, 1.72, 0.06), sph(0.30, -0.78, 1.30, 0.055));   // chin and barbel bumps
    jw = SUB(jw, (x, y, z) => -(y - (ymW(z) - 0.08)), 0.05);
    jw = SUB(jw, ell(0, -0.42, 0.80, 0.36, 0.20, 1.40), 0.05);
    // a leg: thigh, shank, paw, three toes and a hallux with knuckles, four curved talons, a fin behind the elbow
    const toe = (dx, l) => SU(0.06, lock([1.05, -3.05, 0.50], [1.05 + dx * 0.75, -2.98, 1.15 * l], [1.05 + dx * 1.2, -3.40, 1.62 * l], 0.21, 0.14), sph(1.05 + dx * 0.85, -3.04, 1.26 * l, 0.165));
    const talon = (dx, l) => lock([1.05 + dx * 1.2, -3.36, 1.58 * l], [1.05 + dx * 1.42, -3.60, 2.08 * l], [1.05 + dx * 1.36, -4.30, 1.90 * l], 0.125, 0.012, 0, 0.8);
    const talons = U(talon(-0.55, 0.92), talon(0, 1.05), talon(0.55, 0.92), lock([1.05, -3.30, -0.32], [1.05, -3.50, -0.78], [1.05, -4.15, -0.66], 0.11, 0.012, 0, 0.8));
    const fin = rot(ell(0.86, -1.30, -1.05, 0.055, 0.50, 0.72), 0.5, 0, 0, 0.86, -1.3, -0.6);
    let leg = SU(0.16, cone(0, 0, 0, 0.85, -1.5, -0.45, 0.74, 0.50), cone(0.85, -1.5, -0.45, 1.05, -3.0, 0.5, 0.46, 0.27), sph(1.05, -3.1, 0.55, 0.40), toe(-0.55, 0.92), toe(0, 1.05), toe(0.55, 0.92),
      lock([1.05, -3.1, 0.45], [1.05, -3.15, -0.10], [1.05, -3.34, -0.36], 0.17, 0.13));
    leg = SU(0.10, SU(0.045, leg, talons), fin);
    return share.sc = { up: ab(up), jaw: ab(jw), leg, brow, ridge, zyg, crest, nostril, talons, fin };
  }
  // surface nets on the right half only (the grid has a node plane exactly on x = 0), welded to its mirror image
  function meshSym(f, X, y0, z0, y1, z1, n) {
    const E = Math.max(y1 - y0, z1 - z0), h = E / n, m = SD.mesh(f, [-2 * h, y0, z0, Math.min(X, E - 2 * h), y1, z1], n), P = m.pos, Nn = m.nor, I = m.idx, nv = P.length / 3;
    for (let k = 0; k < nv * 3; k += 3) if (P[k] < 1e-5) { const l = Math.hypot(Nn[k + 1], Nn[k + 2]) || 1; P[k] = 0; Nn[k] = 0; Nn[k + 1] /= l; Nn[k + 2] /= l; }
    const map = new Int32Array(nv).fill(-1), tri = []; let nu = 0;
    for (let k = 0; k < I.length; k += 3) { const a = I[k], b = I[k + 1], c = I[k + 2]; if (P[a * 3] > 0 || P[b * 3] > 0 || P[c * 3] > 0) tri.push(a, b, c); }
    for (const v of tri) if (map[v] < 0) map[v] = nu++;
    const pos = new Float32Array(nu * 6), nor = new Float32Array(nu * 6), idx = new Uint32Array(tri.length * 2), nt = tri.length;
    for (let i = 0; i < nv; i++) { const j = map[i]; if (j < 0) continue; const a = j * 3, b = (nu + j) * 3, k = i * 3;
      pos[a] = P[k]; pos[a + 1] = P[k + 1]; pos[a + 2] = P[k + 2]; nor[a] = Nn[k]; nor[a + 1] = Nn[k + 1]; nor[a + 2] = Nn[k + 2];
      pos[b] = -P[k]; pos[b + 1] = P[k + 1]; pos[b + 2] = P[k + 2]; nor[b] = -Nn[k]; nor[b + 1] = Nn[k + 1]; nor[b + 2] = Nn[k + 2]; }
    for (let k = 0; k < nt; k += 3) { const a = map[tri[k]], b = map[tri[k + 1]], c = map[tri[k + 2]]; idx[k] = a; idx[k + 1] = b; idx[k + 2] = c; idx[nt + k] = nu + a; idx[nt + k + 1] = nu + c; idx[nt + k + 2] = nu + b; }
    return { pos, nor, idx };
  }
  // "along" coordinate with d(along) = dz / r(z): a lattice with a fixed count round the limb keeps its proportions while the
  // plates shrink where the limb narrows (the muzzle, the toes). Runs from b back to a.
  function alongTable(rOf, a, b, n = 120) { const tab = new Float32Array(n + 1), h = (b - a) / n; for (let i = 1; i <= n; i++) tab[i] = tab[i - 1] + h / rOf(b - (i - 0.5) * h);
    return v => { const f = clamp((b - v) / h, 0, n), i = Math.min(n - 1, Math.floor(f)); return lerp(tab[i], tab[i + 1], f - i); }; }
  const headAlong = alongTable(keyedLin([[-1.9, 0.80], [-0.55, 0.95], [0.4, 0.80], [1.2, 0.60], [2.2, 0.42], [2.8, 0.34], [3.3, 0.28]]), -1.9, 3.3);
  const legAlong = alongTable(keyedLin([[-4.5, 0.22], [-3.3, 0.26], [-3.0, 0.32], [-1.5, 0.50], [0.0, 0.72], [0.9, 0.74]]), -4.5, 0.9);
  const legAxis = (y, o) => { const u = clamp(-y / 1.5), w = clamp((-y - 1.5) / 1.5); o[0] = 0.85 * u + 0.20 * w; o[1] = -0.45 * u + 0.95 * w; };
  const HEADMAP = (x, y, z, o) => { o[0] = headAlong(z); o[1] = x; o[2] = y + 0.05; };
  const LEGMAP = (() => { const c = [0, 0]; return (x, y, z, o) => { legAxis(y, c); o[0] = legAlong(y); o[1] = x - c[0]; o[2] = c[1] - z; }; })();
  // meshed once (position / normal / aT / aQ / uv / index shared), colours and masks painted per palette
  function sdfShared(key, mesh, scale, map, tan) {
    if (share[key]) return share[key];
    const t0 = performance.now(), m = mesh(), nv = m.pos.length / 3, raw = new Float32Array(m.pos), aT = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), aQ = new Float32Array(nv * 2), o = [0, 0, 0];
    for (let i = 0; i < nv; i++) { map(raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2], o); uv[i * 2] = o[0]; aQ[i * 2] = o[1]; aQ[i * 2 + 1] = o[2];
      aT[i * 3] = tan[0]; aT[i * 3 + 1] = tan[1]; aT[i * 3 + 2] = tan[2]; m.pos[i * 3] *= scale; m.pos[i * 3 + 1] *= scale; m.pos[i * 3 + 2] *= scale; }
    stamp(key, t0);
    return share[key] = { nv, raw, nor: m.nor, position: BA(m.pos, 3), normal: BA(m.nor, 3), aT: BA(aT, 3), aQ: BA(aQ, 2), uv: BA(uv, 2), index: BA(m.idx, 1) };
  }
  // paint(x, y, z, nx, ny, nz, o) sees the unscaled sculpt and writes o = [r, g, b, belly, flesh, horn, skin, shield, lip, brow, nostril]
  function painted(s, paint, morph) {
    const nv = s.nv, col = new Float32Array(nv * 3), aK = new Float32Array(nv), aMk = new Float32Array(nv * 4), aM = morph ? new Float32Array(nv * 3) : null, o = new Float32Array(11), r = s.raw, n = s.nor;
    for (let i = 0, k = 0; i < nv; i++, k += 3) { o.fill(0); paint(r[k], r[k + 1], r[k + 2], n[k], n[k + 1], n[k + 2], o); col[k] = o[0]; col[k + 1] = o[1]; col[k + 2] = o[2]; aK[i] = o[3];
      aMk[i * 4] = o[4]; aMk[i * 4 + 1] = o[5]; aMk[i * 4 + 2] = o[6]; aMk[i * 4 + 3] = o[7]; if (aM) { aM[k] = o[8]; aM[k + 1] = o[9]; aM[k + 2] = o[10]; } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', s.position); g.setAttribute('normal', s.normal); g.setAttribute('color', BA(col, 3)); g.setAttribute('aT', s.aT); g.setAttribute('aQ', s.aQ);
    g.setAttribute('aK', BA(aK, 1)); g.setAttribute('aMk', BA(aMk, 4)); if (aM) g.setAttribute('aM', BA(aM, 3)); g.setAttribute('uv', s.uv); g.setIndex(s.index);
    return g;
  }
  const mirrorGeo = g => { const o = g.clone(), p = o.attributes.position.array, n = o.attributes.normal.array, ix = o.index.array; for (let i = 0; i < p.length; i += 3) { p[i] = -p[i]; n[i] = -n[i]; }
    for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } return o; };
  // merge tube pieces and keep, per vertex, a class and a 0..1 tone the palettes colour from: list = [{ g, cls, t0, t1 }], tone runs along uv.x
  function mergeToned(list) {
    const g = mergeGeos(list.map(e => e.g)), n = g.attributes.position.count, cls = new Uint8Array(n), tone = new Float32Array(n); let o = 0;
    for (const e of list) { const u = e.g.attributes.uv.array, c = e.g.attributes.position.count; let mx = 1e-6; for (let i = 0; i < c; i++) mx = Math.max(mx, u[i * 2]);
      for (let i = 0; i < c; i++) { cls[o + i] = e.cls; tone[o + i] = lerp(e.t0 === undefined ? 0 : e.t0, e.t1 === undefined ? 1 : e.t1, u[i * 2] / mx); } o += c; }
    return { g, cls, tone };
  }
  function toned(s, colour) {                         // share s.g's buffers, add a colour per vertex: colour(cls, tone, out)
    const n = s.cls.length, c = new Float32Array(n * 3), o = [0, 0, 0]; for (let i = 0; i < n; i++) { colour(s.cls[i], s.tone[i], o); c[i * 3] = o[0]; c[i * 3 + 1] = o[1]; c[i * 3 + 2] = o[2]; }
    const g = new THREE.BufferGeometry(); for (const k of Object.keys(s.g.attributes)) g.setAttribute(k, s.g.attributes[k]); g.setAttribute('color', BA(c, 3)); g.setIndex(s.g.index); return g;
  }
  // ---------- teeth and gums: curved teeth of many sizes on a gum ridge, four long fangs ----------
  function mouthShared() {
    if (share.mouth) return share.mouth;
    const t0 = performance.now(), HS = HS0, V = (x, y, z) => new THREE.Vector3(x, y, z), X = V(1, 0, 0), bas = new THREE.Matrix4(), Yd = V(), Zd = V(), Xd = V();
    const tooth = (len, r, bend) => { const n = 6, pts = [], rr = []; for (let i = 0; i <= n; i++) { const t = i / n; pts.push(V(0, len * t, -bend * len * t * t)); rr.push(r * Math.pow(1 - t, 0.8) * (1 + 0.14 * Math.sin(Math.PI * Math.min(1, t * 2.2))) + 0.003); } return tubeGeo(pts, rr, 7, false, X); };
    // base point p, tip direction, the way the tooth curves; all in sculpt units
    const place = (g, p, tip, curl) => { Yd.copy(tip).normalize(); Zd.copy(curl).multiplyScalar(-1).addScaledVector(Yd, Yd.dot(curl)).normalize(); Xd.crossVectors(Yd, Zd);
      bas.makeBasis(Xd, Yd, Zd).scale(V(HS, HS, HS)).setPosition(p.x * HS, p.y * HS, p.z * HS); return xf(g, bas); };
    const r = rng(7741), up = [], lo = [], gumU = [], gumL = [];
    const row = (list, F, xs, z0, z1, n, sgnY, y0, fangZ, fangLen) => {
      for (const sgn of [-1, 1]) {
        for (let i = 0; i < n; i++) { const z = lerp(z0, z1, i / (n - 1)), big = i % 3 === 1 ? 1.35 : 1, len = (0.15 + 0.07 * r()) * big * lerp(0.8, 1.1, i / (n - 1));
          list.push({ g: place(tooth(len, len * 0.24, 0.22), V(sgn * xs(z), y0(z), z), V(sgn * 0.14, sgnY, 0), V(-sgn * 0.3, 0, -1)), cls: 0 }); }
        list.push({ g: place(tooth(fangLen, fangLen * 0.135, 0.34), V(sgn * xs(fangZ) * 0.98, y0(fangZ) - sgnY * 0.03, fangZ), V(sgn * 0.16, sgnY, 0.10), V(-sgn * 0.25, 0, -1)), cls: 0 });
        for (let i = 0; i < 3; i++) { const th = rad(26 + i * 24), c = Math.cos(th), s2 = Math.sin(th), len = 0.17 - 0.02 * i + 0.03 * r();                      // incisors round the front
          list.push({ g: place(tooth(len, len * 0.24, 0.2), V(sgn * F[1] * c, y0(F[0]), F[0] + F[2] * s2), V(sgn * 0.12 * c, sgnY, 0.12 * s2), V(-sgn * c, 0, -s2)), cls: 0 }); }
      } };
    row(up, UF, xU, 0.20, 2.10, 10, -1, z => ymW(z) + 0.05, 2.36, 0.52);
    row(lo, LF, xL, 0.30, 1.78, 8, 1, z => ymW(z) - 0.13, 2.04, 0.43);
    // gum ridges: one tube from the back of one side, round the front, to the back of the other
    const gum = (F, xs, zb, y0, rr) => { const pts = [], rad2 = []; for (let i = 0; i <= 44; i++) { const u = i / 44 * 2 - 1, a = Math.abs(u), sgn = u < 0 ? -1 : 1; let x, z;
        if (a > 0.36) { z = lerp(F[0], zb, (a - 0.36) / 0.64); x = xs(z); } else { const th = (1 - a / 0.36) * Math.PI / 2; x = F[1] * Math.cos(th); z = F[0] + F[2] * Math.sin(th); }
        pts.push(V(sgn * x * HS, y0(z) * HS, z * HS)); rad2.push(rr * HS * (1 + 0.22 * Math.sin(i * 2.9))); } return tubeGeo(pts, rad2, 6, false, V(0, 1, 0)); };
    up.push({ g: gum(UF, xU, 0.05, z => ymW(z) + 0.030, 0.050), cls: 1, t0: 0.5, t1: 0.5 }); lo.push({ g: gum(LF, xL, 0.15, z => ymW(z) - 0.108, 0.046), cls: 1, t0: 0.5, t1: 0.5 });
    share.mouth = { up: mergeToned(up), lo: mergeToned(lo) }; stamp('mouth', t0); return share.mouth;
  }
  // ---------- antlers: branching tubes (exact length and angle coordinates for the growth rings and flutes), both sides in one mesh ----------
  function antlerShared() {
    if (share.antler) return share.antler;
    const t0 = performance.now(), HS = HS0, list = [], cub = (P, t, o) => { const a = (1 - t) ** 3, b = 3 * t * (1 - t) ** 2, c = 3 * t * t * (1 - t), d = t ** 3; return o.set(a * P[0][0] + b * P[1][0] + c * P[2][0] + d * P[3][0], a * P[0][1] + b * P[1][1] + c * P[2][1] + d * P[3][1], a * P[0][2] + b * P[1][2] + c * P[2][2] + d * P[3][2]).multiplyScalar(HS); };
    const branch = (segs, r0, r1, n, tA, tB, flare) => { const pts = [], rr = []; segs.forEach((P, k) => { for (let i = k ? 1 : 0; i <= n; i++) { pts.push(cub(P, i / n, new THREE.Vector3())); } });
      for (let i = 0; i < pts.length; i++) { const t = i / (pts.length - 1); rr.push((lerp(r0, r1, Math.pow(t, 0.85)) + flare * r0 * Math.exp(-t * 9)) * HS); }
      const g = tubeGeo(pts, rr, 9, false, new THREE.Vector3(0, 0, 1)); list.push({ g, cls: 0, t0: tA, t1: tB }); list.push({ g: mirrorGeo(g), cls: 0, t0: tA, t1: tB }); };
    branch([[[0.50, 0.58, -0.66], [0.62, 1.30, -0.72], [0.98, 1.95, -1.25], [1.08, 2.60, -2.05]], [[1.08, 2.60, -2.05], [1.18, 3.25, -2.85], [1.30, 3.75, -3.25], [1.10, 4.35, -3.55]]], 0.215, 0.018, 16, 0, 1, 0.25);   // the main beam
    branch([[[0.60, 1.10, -0.74], [0.52, 1.60, -0.40], [0.50, 2.05, 0.05], [0.66, 2.45, 0.30]]], 0.115, 0.014, 14, 0.25, 1, 0.5);     // brow tine
    branch([[[0.88, 1.83, -1.16], [1.30, 2.05, -1.00], [1.62, 2.55, -0.95], [1.80, 3.20, -1.20]]], 0.115, 0.014, 14, 0.40, 1, 0.5);   // outer tine
    branch([[[1.10, 2.72, -2.22], [1.02, 3.15, -2.05], [0.86, 3.60, -2.05], [0.70, 4.05, -2.35]]], 0.095, 0.012, 12, 0.60, 1, 0.5);   // inner tine
    branch([[[1.24, 3.48, -3.02], [1.50, 3.70, -3.10], [1.68, 4.05, -3.10], [1.72, 4.50, -2.95]]], 0.075, 0.010, 10, 0.78, 1, 0.5);   // top tine
    share.antler = mergeToned(list); stamp('antler', t0); return share.antler;
  }
  const BUMP = `{ vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition), r1 = cross(sy, normal), r2 = cross(normal, sx); float det = dot(sx, r1);
          vec3 gr = sign(det) * (dFdx(dlH) * r1 + dFdy(dlH) * r2) * smoothstep(0.12, 0.50, abs(dot(normal, normalize(vViewPosition))));   // none at the silhouette, where screen derivatives break
          normal = normalize(max(abs(det), 1e-9) * normal - gr);
          vec3 vd = normalize(vViewPosition); float nvd = dot(normal, vd); if (nvd < 0.0) normal = normalize(normal - nvd * vd); }`;   // edge samples must not light the far side
  // fin blades: rays fanning from the root, a midrib, a web that dips between the ray tips (cut out by coverage). uv = (signed
  // offset from the midrib in blade widths, 0 root .. 1 tip): the blade's outline is divided out per pixel, so the rays run true
  // from root to tip instead of zigzagging across the strip's triangles; they are filtered by their pixel footprint and melt
  // into their mean tone when a ray is under two pixels wide. The membrane is thin: light on the far face shows through it.
  const FRILL_HW = t => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.8) * (1 - 0.15 * t) + 0.024;
  function frillMat(pal) {
    const E = pal.frillEmis, F = pal.frill[1], S = pal.frillSelf;
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide, emissive: new THREE.Color(F[0] * E + S[0], F[1] * E + S[1], F[2] * E + S[2]) }); m.defines = { USE_UV: '' }; m.envMapIntensity = pal.env; m.alphaToCoverage = true;
    const u = { uFThru: { value: pal.frillThru } };
    patch(m, s => {
      Object.assign(s.sh.uniforms, u);
      s.fHead('float dlH; uniform float uFThru;');
      s.f('#include <color_fragment>', `#include <color_fragment>
        { float t = vUv.y, hn = pow(sin(3.14159265 * pow(clamp(t, 0.0, 1.0), 0.62)), 0.8) * (1.0 - 0.15 * t) + 0.024, un = vUv.x / hn, u = abs(un), rx = un * 3.0 + 0.5;
          float fr = fwidth(rx), keep = 1.0 - smoothstep(0.22, 0.55, fr), d = abs(fract(rx) - 0.5) * 2.0;
          float ray = mix(0.40, 1.0 - smoothstep(0.08, 0.42 + 1.5 * fr, d), keep), rib = 1.0 - smoothstep(0.0, 0.14 + fr * 0.3, u);
          float edge = 1.0 - 0.26 * (1.0 - ray) * smoothstep(0.15, 0.9, t), fu = clamp(fwidth(un), 0.02, 0.5);
          diffuseColor.a *= 1.0 - smoothstep(edge - fu, edge + 0.3 * fu, u); if (diffuseColor.a < 0.02) discard;
          dlH = (0.035 * ray + 0.05 * rib) * keep; diffuseColor.rgb *= 0.46 + 0.54 * ray + 0.30 * rib; }`);
      s.f('#include <normal_fragment_maps>', BUMP);
      s.f('#include <emissivemap_fragment>', `{ vec3 thru = vec3(0.0);
        #if NUM_DIR_LIGHTS > 0
          for (int i = 0; i < NUM_DIR_LIGHTS; i++) { vec3 Lc = directionalLights[i].color;
        #ifdef USE_FOG
            if (i == 0) Lc *= clSun(vFogW);                                                                          // the sun is light 0: cloud shadows, the storm and dusk cut it here as they do on every lit face
        #endif
            thru += Lc * max(dot(-normal, directionalLights[i].direction), 0.0); }
        #endif
        #if NUM_POINT_LIGHTS > 0
          for (int i = 0; i < NUM_POINT_LIGHTS; i++) { vec3 lv = pointLights[i].position + vViewPosition; float ld = length(lv);
            thru += pointLights[i].color * (getDistanceAttenuation(ld, pointLights[i].distance, pointLights[i].decay) * max(dot(-normal, lv / max(ld, 1e-4)), 0.0)); }
        #endif
          totalEmissiveRadiance += diffuseColor.rgb * thru * (uFThru * 0.3183); }`);
    }, 'dragon4frill');
    return m;
  }
  function hornMat(pal) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0, emissive: new THREE.Color(pal.ivoryEmis[0] * 0.6 + pal.hornSelf[0], pal.ivoryEmis[1] * 0.6 + pal.hornSelf[1], pal.ivoryEmis[2] * 0.6 + pal.hornSelf[2]) }); m.defines = { USE_UV: '' }; m.envMapIntensity = pal.env * 0.6;
    patch(m, s => {
      s.fHead('float dlH;');
      s.f('#include <color_fragment>', `#include <color_fragment>
        { float a = vUv.y * 6.2832, rings = sin(vUv.x * 4.5 + 1.3 * sin(a * 2.0) + 0.8 * sin(vUv.x * 1.3)), flute = sin(a * 7.0 + vUv.x * 0.5);
          dlH = 0.012 * rings + 0.008 * flute; diffuseColor.rgb *= 0.94 + 0.05 * rings + 0.03 * flute; }`);
      s.f('#include <normal_fragment_maps>', BUMP);
    }, 'dragon2horn');
    return m;
  }
  // ---------- eyes: a ball inside the socket. Refracted iris with fibres, a collarette ring, a dark limbal ring, a slit pupil,
  // two moving catch-lights (sun, sky), socket shade; lit by the sun, the sky and the storm light, plus its own glow ----------
  function eyeMat(pal, U) {
    return new THREE.ShaderMaterial({ fog: false,
      uniforms: { uGlow: U.eye, uVis: U.vis, uSlit: U.slit, uEye0: u3(pal.eye[0]), uEye1: u3(pal.eye[1]), uEye2: u3(pal.eyeRing), uSclera: u3(pal.sclera), uStorm: SH.storm, uStormDir: SH.stormDir },
      vertexShader: `varying vec3 vP, vWN, vWP, vVL;
        void main(){ vP = position; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vWN = mat3(modelMatrix) * normal; vVL = (cameraPosition - wp.xyz) * mat3(modelMatrix); gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `varying vec3 vP, vWN, vWP, vVL; uniform float uGlow, uVis, uSlit; uniform vec3 uEye0, uEye1, uEye2, uSclera, uStorm, uStormDir; ${GLSL_NOISE} ${GLSL_FOG}
        void main(){ vec3 sunK = clSun(vWP);
          vec3 n = normalize(vP), V = normalize(vVL), N = normalize(vWN), Vw = normalize(cameraPosition - vWP);
          const float ZI = 0.74, RI = 0.66;                                              // iris plane and radius on the unit ball
          vec3 rd = refract(-V, n, 0.75); vec2 ip = n.xy; if (n.z > ZI && rd.z < -0.05) ip += rd.xy * ((n.z - ZI) / -rd.z);
          float r = length(ip) / RI, a = atan(ip.y, ip.x);
          float fib = mix(0.5 + 0.5 * sin(a * 31.0 + 2.5 * sin(a * 5.0 + r * 4.0)), vnoise(vec2(a * 14.0, r * 3.0)), 0.5);
          vec3 iris = mix(uEye1, uEye0, smoothstep(0.18, 0.92, r)) * (0.50 + 0.80 * fib);
          iris = mix(iris, uEye2, (1.0 - smoothstep(0.0, 0.15, abs(r - 0.36))) * 0.50);
          iris *= 1.0 - 0.88 * smoothstep(0.78, 1.0, r);
          float py = ip.y / 0.50, hw = mix(0.105, 0.032, uSlit) * sqrt(max(0.0, 1.0 - py * py)), pup = (1.0 - smoothstep(hw, hw + 0.03, abs(ip.x))) * step(abs(py), 1.0);
          float isIris = 1.0 - smoothstep(0.96, 1.04, r);
          vec3 alb = mix(uSclera * (0.55 + 0.6 * vnoise(n.xy * 9.0)), iris, isIris) * (1.0 - pup);
          float sock = smoothstep(0.0, 0.55, n.z) * mix(0.45, 1.0, smoothstep(0.70, -0.15, n.y));
          vec3 c = alb * (vec3(2.6, 1.45, 0.78) * sunK * max(dot(N, SUN_DIR), 0.0) + vec3(0.34, 0.25, 0.38) + uStorm * max(dot(N, uStormDir), 0.0)) * sock;
          c += iris * isIris * (1.0 - pup) * (0.45 + 1.5 * uGlow) * (0.4 + 0.6 * sock) + uEye1 * (1.0 - smoothstep(hw, hw + 0.22, abs(ip.x))) * isIris * (1.0 - pup) * 0.9 * uGlow;
          vec3 R = reflect(-Vw, N); float F = 0.04 + 0.96 * pow(1.0 - max(dot(N, Vw), 0.0), 5.0);
          float s1 = pow(max(dot(N, normalize(SUN_DIR + Vw)), 0.0), 240.0) * 30.0, s2 = pow(max(dot(N, normalize(normalize(vec3(-0.35, 0.86, 0.36)) + Vw)), 0.0), 70.0) * 2.4;
          c += (vec3(1.0, 0.64, 0.38) * sunK * s1 + vec3(0.52, 0.50, 0.80) * s2) * sock
             + mix(vec3(0.50, 0.16, 0.20), vec3(0.20, 0.16, 0.42), smoothstep(0.0, 0.7, R.y)) * (0.10 + 1.2 * F) * smoothstep(-0.2, 0.3, R.y) * sock;
          gl_FragColor = vec4(c, uVis); }` });
  }
  // eyelid: a cap of the lid shell round one pole with a margin that turns in to the ball; tone 0 at the pole .. 1 at the margin
  function lidShared(pole) {
    const key = pole > 0 ? 'lidU' : 'lidL'; if (share[key]) return share[key];
    const R1 = RL * HS0, R0 = RE * HS0 * 1.012, thc = pole > 0 ? rad(80) : rad(44), rings = 6, segs = 28, P = [], T = [], I = [];
    for (let i = 0; i <= rings + 1; i++) { const th = i <= rings ? thc * i / rings : thc + 0.07, R = i <= rings ? R1 : R0;
      for (let j = 0; j <= segs; j++) { const ph = j / segs * TAU; P.push(R * Math.sin(th) * Math.cos(ph), pole * R * Math.cos(th), R * Math.sin(th) * Math.sin(ph)); T.push(sm(0.62, 1.0, i / (rings + 1))); } }
    for (let i = 0; i <= rings; i++) for (let j = 0; j < segs; j++) { const a = i * (segs + 1) + j, b = a + segs + 1; if (pole > 0) I.push(a, a + 1, b, a + 1, b + 1, b); else I.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3 * 2), 2)); g.setIndex(I); g.computeVertexNormals();
    const cls = new Uint8Array(P.length / 3); for (let i = 0; i < cls.length; i++) cls[i] = Math.floor(i / (segs + 1)) % 2;
    return share[key] = { g, cls, tone: new Float32Array(T) };
  }
  // ---------- jaw frill: a fan of six pointed fin blades, each with a raised midrib, curling outward (right side; the left is its mirror image) ----------
  function frillShared() {
    if (share.frill) return share.frill;
    const HS = HS0, AL = [62, 38, 14, -10, -34, -58], LN = [0.95, 1.40, 1.70, 1.60, 1.25, 0.85], K = 12, P = [], UVs = [], T = [], I = [];
    AL.forEach((deg, k) => { const al = rad(deg), L = LN[k], w = 0.17 * L, b0 = P.length / 3, ca = Math.cos(al), sa = Math.sin(al);
      for (let i = 0; i <= K; i++) { const t = i / K, hn = FRILL_HW(t), hw = w * hn, d = t * L, out = 0.24 * t * t * L + 0.025 * k;
        for (let j = -1; j <= 1; j++) { P.push((out + (j === 0 ? 0.32 * hw : 0)) * HS, (sa * d + j * hw * ca) * HS, (-ca * d + j * hw * sa) * HS); UVs.push(j * hn, t); T.push(t, j === 0 ? 1 : 0); }
        if (i < K) for (let j = 0; j < 2; j++) { const a = b0 + i * 3 + j, b = a + 3; I.push(a, b, a + 1, a + 1, b, b + 1); } } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UVs, 2)); g.setIndex(I); g.computeVertexNormals();
    return share.frill = { g, gm: mirrorGeo(g), tone: new Float32Array(T) };
  }
  // ---------- mane: one instance is a clump of flame-locks that share one flow. A lock is a ribbon carried as its centre line:
  // position = (root x, t * length, root z) in the clump's frame, uv = (across 0..1, t), aL = which lock of the clump,
  // aCv / aCt = the lock's own S-curve and curled tip (offset from the straight line and its slope, in lock lengths),
  // aLk = (length, half width, random). The vertex stage bends the line (sweep, gravity, wind, lag), carries the curl along
  // the bend and opens the ribbon toward the lens; it is never thinner than a pixel (the rest is paid in coverage) ----------
  function lockGeo(head) {
    const key = head ? 'lockH' : 'lockB';
    if (!share[key]) {
      const P = [], UVs = [], AL = [], CV = [], CT = [], LK = [], I = [], r = rng(head ? 5121 : 977), d = [0, 0, 0];
      // seg rings, relative length and half width, root offset, S-curve (amplitude, waves, phase), side sway, tip curl (radians,
      // negative flicks up and away from the skin) starting at tc
      const lock = (seg, len, hw, ox, oz, sA, sF, sP, sd, curl, tc, id) => {
        const b0 = P.length / 3, rn = r(), SUB = 10; let x = 0, y = 0, z = 0, tp = 0;
        const dirAt = t => { const th = sA * Math.sin(TAU * (sF * t + sP)) * sm(0, 0.22, t) + curl * Math.pow(clamp((t - tc) / (1 - tc)), 1.35), ps = sd * Math.sin(TAU * (0.85 * t + sP * 1.7 + 0.2)) * sm(0, 0.3, t) + 0.5 * sd * clamp((t - tc) / (1 - tc)), cp = Math.cos(ps);
          d[0] = Math.sin(ps); d[1] = cp * Math.cos(th); d[2] = cp * Math.sin(th); };
        for (let i = 0; i <= seg; i++) { const t = 1 - Math.pow(1 - i / seg, 1.45);                  // rings crowd toward the tip, where the curl is
          for (let k = 0; k < SUB && i > 0; k++) { const h = (t - tp) / SUB; dirAt(tp + (k + 0.5) * h); x += d[0] * h; y += d[1] * h; z += d[2] * h; }
          tp = t; dirAt(t);
          for (let j = 0; j < 3; j++) { P.push(ox, t * len, oz); UVs.push(j / 2, t); AL.push(id); CV.push(x, y - t, z); CT.push(d[0], d[1] - 1, d[2]); LK.push(len, hw, rn); }
          if (i < seg) for (let j = 0; j < 2; j++) { const a = b0 + i * 3 + j, b = a + 3; I.push(a, a + 1, b, a + 1, b + 1, b); } } };
      if (head) { lock(18, 1.00, 0.175, 0.00, 0.00, 0.30, 0.90, 0.10, 0.10, -2.0, 0.52, 0); lock(15, 0.80, 0.135, 0.22, -0.06, 0.34, 1.10, 0.45, -0.16, -2.5, 0.50, 1);
        lock(14, 0.66, 0.120, -0.20, 0.05, 0.28, 1.00, 0.70, 0.18, -1.5, 0.48, 2); lock(13, 0.90, 0.064, 0.08, 0.10, 0.42, 1.30, 0.25, -0.22, -2.4, 0.55, 3); lock(10, 0.52, 0.080, -0.09, -0.10, 0.36, 1.20, 0.85, 0.20, 1.1, 0.55, 4); }
      else { lock(15, 1.00, 0.190, 0.00, 0.00, 0.26, 0.90, 0.10, 0.08, -2.0, 0.52, 0); lock(12, 0.74, 0.135, 0.20, -0.05, 0.32, 1.10, 0.50, -0.16, -2.5, 0.50, 1); lock(11, 0.86, 0.068, -0.16, 0.06, 0.40, 1.25, 0.80, 0.20, -2.4, 0.55, 2); }
      const g = new THREE.BufferGeometry(), F = (a, k) => new THREE.Float32BufferAttribute(a, k); g.setAttribute('position', F(P, 3)); g.setAttribute('uv', F(UVs, 2)); g.setAttribute('aL', F(AL, 1)); g.setAttribute('aCv', F(CV, 3)); g.setAttribute('aCt', F(CT, 3)); g.setAttribute('aLk', F(LK, 3)); g.setIndex(I); share[key] = g;
    }
    const g = new THREE.BufferGeometry(), s = share[key]; for (const k of Object.keys(s.attributes)) g.setAttribute(k, s.attributes[k]); g.setIndex(s.index); return g;
  }
  function instLocks(list, mat) {                     // list items carry ph; the caller sets the matrices
    const g = lockGeo(true), ph = new Float32Array(list.length); list.forEach((m, i) => ph[i] = m.ph); g.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));
    const me = new THREE.InstancedMesh(g, mat, list.length); me.frustumCulled = false; return me;
  }
  // A clump's frame: +Y the way the lock leaves the skin, +Z the way it is combed (back along the neck or the spine). Each lock
  // turns from +Y toward the pull on it: the comb, plus gravity in a hover (never into the skin), plus the air and the head's own
  // acceleration for the head mane (uAir, uLag), plus a slow travelling billow. Shading is a round combed lock: strand streaks,
  // root-to-tip colour, two strand highlights per directional light, light through the hair when it is behind, a feathered edge.
  function maneMat(pal, U, head) {
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }); mat.defines = { USE_UV: '' }; mat.alphaToCoverage = true;   // diffuse light only from the engine (hair pixels are many and overlap): the strand highlights are added below
    const u = { uM0: u3(pal.mane[0]), uM1: u3(pal.mane[1]), uM2: u3(pal.mane[2]), uMSelf: u3(pal.maneSelf), uMRim: u3(pal.maneRim), uMK: u4([pal.maneEmis, pal.maneSpec, pal.maneThru, 0]), uFlow: U.flow, uPxK: SH.pxk,
      uMShape: u4(head ? [0.50, 1.05, pal.maneHang, 0.20] : [0.42, 1.0, pal.maneHang * 0.8, 0.17]), uMBend: { value: new THREE.Vector3(head ? 0.74 : 0.56, head ? 0.97 : 0.86, head ? 0.50 : 0.80) },   // comb in a hover / in flight, gravity, billow; how far a lock turns hover / flight, skin slope
      uAir: head ? U.air : { value: new THREE.Vector4(0, 0, 1, 0) }, uLag: head ? U.lag : { value: new THREE.Vector3() }, uWetAge: U.wetAge, uWetM: head ? U.wetMH : U.wetMB }; mat.userData.u = u;
    patch(mat, s => {
      Object.assign(s.sh.uniforms, u);
      s.vHead(`${GLSL_WIND}
        attribute float aPh, aL, aArc; attribute vec3 aCv, aCt, aLk; uniform float uFlow, uPxK; uniform vec4 uMShape, uAir; uniform vec3 uMBend, uLag, uWetM; uniform float uWetAge[${NW}];
        varying float vPh, vCov, vWetM; varying vec3 vTv; vec3 dlPw, dlNv; float dlWet;
        vec3 dlDir(float tau, vec3 ex, vec3 ey, vec3 ez, vec3 nn, vec3 Fb, float ph, float bend){
          float k = bend * (1.0 - exp(-mix(2.6, 4.6, uFlow) * (1.0 + 2.6 * dlWet) * tau)), w = uWind * 2.3 + ph * 6.283 - tau * 3.4;
          vec3 F = Fb + (ex * sin(w) + ez * (0.55 * cos(w * 0.83 + 1.7))) * (uMShape.w * (0.45 + 1.3 * uGust) * (0.5 + 0.5 * uFlow + tau) * (1.0 - 0.8 * dlWet));
          F -= nn * (min(dot(F, nn), 0.0) * 0.92);
          return normalize(ey * (1.0 - k) + F * k); }`);
      s.v('#include <beginnormal_vertex>', `vec3 objectNormal = vec3(0.0, 1.0, 0.0);
        { mat4 IM = modelMatrix * instanceMatrix; float lx = length(IM[0].xyz), ly = length(IM[1].xyz), t = uv.y, L = ly * aLk.x;
          vec3 ex = IM[0].xyz / lx, ey = IM[1].xyz / ly, ez = normalize(IM[2].xyz), nn = normalize(ey - ez * uMBend.z), root = (IM * vec4(position.x, 0.0, position.z, 1.0)).xyz;
          float ph = aPh + aL * 0.37, hv = 1.0 - uFlow; vPh = ph;
          // wet hair (uWetM: x = the head's own wetness; y > 0: this is the dorsal crest, read the body's wet clock at the clump's
          // place aArc, z = that place is known): heavy, so it hangs and lies on the skin, is drawn into narrow locks, loses its curl and its flutter
          dlWet = uWetM.x; if (uWetM.y > 0.0) { float wa = clamp(aArc * uWetM.y, 0.0, ${(NW - 1.001).toFixed(3)}); int wi = int(wa); float age = mix(uWetAge[wi], uWetAge[wi + 1], wa - float(wi)); dlWet = (${HAIR_GLSL('age')}) * uWetM.z; }
          vWetM = dlWet;
          vec3 comb = normalize(mix(ez, uAir.xyz, uAir.w * (1.0 - 0.9 * dlWet)));
          vec3 Fb = comb * mix(mix(uMShape.x, uMShape.y, uFlow), 1.25, dlWet) + vec3(0.0, -1.0, 0.0) * (uMShape.z * (0.18 + 0.82 * hv) + dlWet * (0.9 - 0.4 * uFlow)) + uLag * (1.0 - 0.8 * dlWet);
          Fb -= nn * (min(dot(Fb, nn), 0.0) * 0.92); Fb /= max(length(Fb), 0.35);
          float bend = mix(mix(uMBend.x, uMBend.y, uFlow) * (0.86 + 0.28 * fract(ph * 5.7)), 0.97, (uWetM.y > 0.0 ? 0.6 : 0.9) * dlWet), h = t / 6.0; vec3 acc = vec3(0.0);
          for (int i = 0; i < 6; i++) acc += dlDir((float(i) + 0.5) * h, ex, ey, ez, nn, Fb, ph, bend);
          vec3 d = dlDir(t, ex, ey, ez, nn, Fb, ph, bend), ax = cross(ey, d); float c = dot(ey, d), kk = 1.0 / max(1.0 + c, 0.08);
          float sg = fract(aPh * 13.7) < 0.5 ? -1.0 : 1.0, kc = (0.62 + 0.62 * fract(aPh * 29.3)) * (1.0 - 0.30 * uFlow) * (1.0 - 0.45 * dlWet);
          vec3 q = (ex * (aCv.x * sg) + ey * aCv.y + ez * aCv.z) * kc, qd = (ex * (aCt.x * sg) + ey * aCt.y + ez * aCt.z) * kc;
          q = q * c + cross(ax, q) + ax * (dot(ax, q) * kk); qd = qd * c + cross(ax, qd) + ax * (dot(ax, qd) * kk);
          vec3 C = root + (acc * h + q) * L, Tg = normalize(d + qd), Vw = normalize(cameraPosition - C), sd = cross(Tg, Vw); float sl = length(sd);
          // seen end-on a lens-facing ribbon has no side to open toward (it would spin): lean on the clump's own side axis there, and narrow
          { vec3 sx = ex - Tg * dot(ex, Tg); sx = normalize(sx) * (dot(sx, sd) < 0.0 ? -1.0 : 1.0); sd = normalize(sd + sx * (0.55 * (1.0 - smoothstep(0.0, 0.55, sl)))); }
          vec4 mvC = viewMatrix * vec4(C, 1.0);
          float hw = lx * aLk.y * (0.30 + 0.70 * sin(min(1.0, t / 0.26) * 1.5708)) * pow(max(1.0 - t, 0.0), 0.62) * (0.45 + 0.55 * smoothstep(0.05, 0.45, sl)) * (1.0 - (uWetM.y > 0.0 ? 0.22 : 0.40) * dlWet), hmin = 0.62 * max(-mvC.z, 0.1) * uPxK;
          vCov = clamp(hw / hmin, 0.0, 1.0); hw = max(hw, hmin);
          dlPw = C + sd * ((uv.x * 2.0 - 1.0) * hw); vTv = mat3(viewMatrix) * Tg; dlNv = normalize(mat3(viewMatrix) * cross(sd, Tg)); }`);
      s.v('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n transformedNormal = dlNv;');
      s.v('#include <project_vertex>', 'vec4 mvPosition = viewMatrix * vec4(dlPw, 1.0); gl_Position = projectionMatrix * mvPosition;');
      s.v('#include <fog_vertex>', '#include <fog_vertex>\n#ifdef USE_FOG\n vFogW = dlPw;\n#endif');
      s.fHead(`varying float vPh, vCov, vWetM; varying vec3 vTv; uniform vec3 uM0, uM1, uM2, uMSelf, uMRim; uniform vec4 uMK; float dlSt; vec3 dlT;
        ${GLSL_NOISE}`);
      s.f('#include <color_fragment>', `#include <color_fragment>
        { float t = vUv.y, u = vUv.x * 2.0 - 1.0, au = abs(u), fw = min(fwidth(vUv.x) * 2.0, 0.6);
          // the lock is a bundle of strands that wander a little along it: each strand has its own round back (a tilt of the normal),
          // its own tone and its own length, and the bundle opens into separate strand tips toward the end. All of it melts into a
          // smooth feathered lock once a strand is narrower than about two pixels.
          float su = u * 3.3 + 0.38 * sin(u * 4.7 + vPh * 23.0) + 0.50 * sin(t * 4.3 + vPh * 31.0) * (0.35 + 0.65 * t) + vPh * 13.0, keep = 1.0 - smoothstep(0.28, 0.62, fwidth(u) * 3.3);
          float sid = floor(su), sf = fract(su) - 0.5, h1 = hash11(sid * 1.31 + floor(vPh * 977.0) * 0.173), gap = smoothstep(0.22, 0.5, abs(sf)) * keep * (0.55 + 0.45 * h1);
          float sn = 0.5 + 0.5 * sin(u * 3.9 + vPh * 41.0 + 1.7 * sin(t * 2.3 + vPh * 7.0)), fn = 0.5 + 0.5 * sin(u * 29.0 + vPh * 13.0 + 2.0 * sin(t * 6.0 + u * 5.0));   // sines, not noise: this runs on every hair pixel
          dlSt = sf * 1.5 * keep + (sn - 0.5) * 0.6 + (fn - 0.5) * 0.7 * keep;
          vec3 c = mix(uM0, uM1, smoothstep(0.0, 0.32, t)); c = mix(c, uM2, smoothstep(0.50, 1.0, t));
          c *= (0.58 + 0.30 * fract(vPh * 7.31)) * (1.0 + 0.30 * (sn - 0.5) + 0.30 * (h1 - 0.5) * keep) * (1.0 - 0.38 * gap) * (0.64 + 0.36 * smoothstep(0.0, 0.22, t)) * (1.0 - 0.20 * au * au);
          float notch = 0.5 + 0.35 * sin(t * 21.0 + vPh * 19.0 + (u > 0.0 ? 0.0 : 2.3)) + 0.15 * sin(t * 53.0 + vPh * 7.0), edge = 1.0 - (0.08 + 0.40 * smoothstep(0.20, 1.0, t)) * notch;      // a feathered edge, cut deeper toward the tip
          float te = 1.0 - 0.36 * h1 * h1, cut = max(smoothstep(te - 0.06, te, t), gap * smoothstep(0.42, 0.92, t));                               // each strand's own end; the gaps open toward the tip
          c *= 1.0 - 0.66 * vWetM;                                                                                                             // soaked: dark
          diffuseColor.rgb = c; diffuseColor.a *= (1.0 - smoothstep(edge - clamp(fw, 0.07, 0.24), edge, au)) * (1.0 - keep * cut) * vCov * vCov;
          if (diffuseColor.a < 0.06) discard; }`);
      s.f('#include <normal_fragment_maps>', `{ vec3 Vv = normalize(vViewPosition), Tt = normalize(vTv), sd = cross(Tt, Vv); float sl = length(sd); sd = sl > 1e-4 ? sd / sl : vec3(1.0, 0.0, 0.0);
          float a = (vUv.x * 2.0 - 1.0) * 1.05 + dlSt * 0.55; normal = normalize(normalize(cross(sd, Tt)) * cos(a) + sd * sin(a)); dlT = normalize(Tt + normal * (0.30 * dlSt)); }`);
      s.f('#include <emissivemap_fragment>', `{ vec3 Vv = normalize(vViewPosition), hl = vec3(0.0), thru = vec3(0.0); float nv = clamp(dot(normal, Vv), 0.0, 1.0), t = vUv.y, thin = 0.35 + 0.65 * smoothstep(0.2, 1.0, max(abs(vUv.x * 2.0 - 1.0), t));
        #if NUM_DIR_LIGHTS > 0
          for (int i = 0; i < NUM_DIR_LIGHTS; i++) { vec3 Ld = directionalLights[i].direction, Lc = directionalLights[i].color, H = normalize(Ld + Vv);
        #ifdef USE_FOG
            if (i == 0) Lc *= clSun(vFogW);
        #endif
            float th = dot(dlT, H), th2 = dot(normalize(dlT - normal * 0.22), H), wrap = clamp(dot(normal, Ld) * 0.6 + 0.4, 0.0, 1.0);
            hl += Lc * (wrap * (pow(max(1.0 - th * th, 0.0), 40.0) + 0.35 * pow(max(1.0 - th2 * th2, 0.0), 9.0)));
            thru += Lc * (pow(clamp(dot(Vv, -Ld), 0.0, 1.0), 2.5) * thin); }
        #endif
          totalEmissiveRadiance += diffuseColor.rgb * (uMSelf + smoothstep(0.3, 1.0, t) * uMK.x * (1.0 - 0.8 * vWetM)) + uMRim * pow(1.0 - nv, 3.0) * (1.0 - 0.5 * vWetM)
            + hl * mix(vec3(1.0), diffuseColor.rgb, 0.8 - 0.5 * vWetM) * (uMK.y * (1.0 + 5.0 * vWetM)) + thru * diffuseColor.rgb * (uMK.z * (1.0 - 0.6 * vWetM)); }`);
    }, 'mane4');
    return mat;
  }

  function make(pal) {
    const tAll = performance.now(), HS = HS0, KH = pal.HS / HS0;               // HS: sculpt units inside the group; KH: the group's scale
    const U = { glow: { value: 0 }, vis: { value: 1 }, expr: { value: new THREE.Vector4() }, flow: { value: 0 }, eye: { value: 0 }, slit: { value: 0 }, air: { value: new THREE.Vector4(0, 0, -1, 0) }, lag: { value: new THREE.Vector3() },
      wetAge: { value: new Float32Array(NW).fill(99) }, wetK: { value: 0 }, wetH: { value: new THREE.Vector2() }, legW: { value: new THREE.Vector4() }, legP0: { value: new THREE.Vector3() }, legP1: { value: new THREE.Vector3() },
      wetMH: { value: new THREE.Vector3() }, wetMB: { value: new THREE.Vector3() } }, mats = [];
    const SC = sculpt();
    const bodyMat = scaleMat('body', 44, 1 / 0.56, 0.56, pal, U), headMat = scaleMat('head', 48, 48 / 6.85, 0.24, pal, U), legMat = scaleMat('leg', 24, 24 / 6.85, 0.28, pal, U);
    const ivoryMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.2, emissive: new THREE.Color(pal.ivoryEmis[0], pal.ivoryEmis[1], pal.ivoryEmis[2]) }); ivoryMat.envMapIntensity = pal.env;
    const antlerMat = hornMat(pal), finMat = frillMat(pal), mane = maneMat(pal, U, false), maneH = maneMat(pal, U, true);   // the dorsal crest (clumps placed by the motion side) and the head's own mane
    const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.56, metalness: 0.0, side: THREE.DoubleSide, emissive: new THREE.Color(0, 0, 0) }); skinMat.envMapIntensity = pal.env;   // lids, frills, tongue
    // ----- head -----
    const sUp = sdfShared('up', () => meshSym(SC.up, 1.50, -0.80, -1.85, 1.30, 3.20, 190), HS, HEADMAP, [0, 0, -1]);
    const gUp = painted(sUp, (x, y, z, nx, ny, nz, o) => {
      const ax = Math.abs(x), lip = y - ymW(z), dE = Math.hypot(ax - EYE[0], y - EYE[1], z - EYE[2]), nh = SC.nostril(ax, y, z);
      const pe = (ax / 0.46) ** 2 + ((y + 0.42) / 0.27) ** 2 + ((z - 0.90) / 1.62) ** 2;
      const inMouth = (ny < -0.5 && lip < 0.07 && z > -0.72) || pe < 1.04;
      const gold = Math.min(SC.brow(ax, y, z), SC.ridge(ax, y, z), SC.crest(ax, y, z)), sh = clamp(1 - sm(-0.03, 0.09, Math.min(gold, SC.zyg(ax, y, z))));   // the raised shield plates
      mixc(pal.body, pal.deep, sm(0.40, 0.95, y) * 0.7, o); mix3(o, pal.crest, clamp(1 - sm(-0.04, 0.07, gold)) * 0.70); o[7] = sh;
      if (ny < -0.25 && z < -0.5) { const b = sm(-0.25, -0.7, ny); mix3(o, pal.belly, b); o[3] = b; }
      const skin = Math.max(sm(2.78, 2.98, z), 0.9 * sm(0.25, 0.13, Math.hypot(ax - NOS[0], y - NOS[1], z - NOS[2])), sm(0.12, 0.03, lip) * sm(-0.80, -0.55, z), sm(0.33, 0.25, dE)) * (1 - o[3]);
      mix3(o, pal.skin, skin); o[6] = skin; o[7] *= 1 - skin;
      if (nh < 0.04) mix3(o, pal.pit, sm(0.04, -0.015, nh));
      if (dE < RS + 0.006) mix3(o, pal.pit, 0.8);
      if (inMouth) { const tl = Math.abs(ax - (z > UF[0] ? UF[1] * Math.sqrt(Math.max(0, 1 - ((z - UF[0]) / UF[2]) ** 2)) : xU(z))); mixc(pal.mouth, pal.gum, sm(0.16, 0.04, tl) * sm(0.10, 0.0, lip), o); o[3] = 0; o[4] = 1; o[6] = 0; o[7] = 0; }
      o[8] = sm(0.36, 0.04, lip) * sm(0.45, 1.3, z) * (1 - 0.55 * sm(2.5, 2.95, z));
      o[9] = sm(0.20, -0.02, SC.brow(ax, y, z));
      o[10] = sm(0.22, 0.08, Math.hypot(ax - NOS[0], y - NOS[1], z - NOS[2]));
    }, true);
    const sJaw = sdfShared('jaw', () => meshSym(SC.jaw, 1.05, -1.15, -1.50, -0.20, 2.65, 140), HS, HEADMAP, [0, 0, -1]);
    const gJaw = painted(sJaw, (x, y, z, nx, ny, nz, o) => {
      const ax = Math.abs(x), top = y - (ymW(z) - 0.08), b = sm(0.15, -0.45, ny), je = (ax / 0.36) ** 2 + ((y + 0.42) / 0.20) ** 2 + ((z - 0.80) / 1.40) ** 2;
      mixc(pal.body, pal.belly, b, o); o[3] = b;
      const lipS = sm(-0.13, -0.03, top) * (1 - b); mix3(o, pal.skin, lipS); o[6] = lipS;
      if ((ny > 0.5 && top > -0.06) || je < 1.04) { const tl = Math.abs(ax - (z > LF[0] ? LF[1] * Math.sqrt(Math.max(0, 1 - ((z - LF[0]) / LF[2]) ** 2)) : xL(z))); mixc(pal.mouth, pal.gum, sm(0.14, 0.03, tl) * sm(-0.10, 0.0, top), o); o[0] *= 1.25; o[1] *= 1.4; o[2] *= 1.4; o[3] = 0; o[4] = 1; o[6] = 0; }
    }, true);
    const an = antlerShared(), gHorn = toned(an, (c, t, o) => mixc(pal.horn0, pal.horn1, sm(0.12, 0.95, t), o));
    const mo = mouthShared(), toothCol = (c, t, o) => { if (c === 1) { o[0] = pal.gum[0]; o[1] = pal.gum[1]; o[2] = pal.gum[2]; } else mixc(pal.ivoryRoot, pal.ivory, sm(0.02, 0.45, t), o); };
    const group = new THREE.Group(), jawG = new THREE.Group(); group.scale.setScalar(KH);
    const mk = (g, mat) => { const me = new THREE.Mesh(g, mat); me.castShadow = true; me.receiveShadow = true; me.frustumCulled = false; return me; };
    const tu = mk(toned(mo.up, toothCol), ivoryMat); tu.receiveShadow = false; group.add(mk(gUp, headMat), mk(gHorn, antlerMat), tu);
    const jm = mk(gJaw, headMat), jt = mk(toned(mo.lo, toothCol), ivoryMat); jt.receiveShadow = false;
    jawG.position.set(0, -0.30 * HS, -0.55 * HS); jm.position.copy(jawG.position).negate(); jt.position.copy(jm.position); jawG.add(jm, jt); group.add(jawG);
    // tongue: a pointed, grooved blade rebuilt every frame from st (lifts and curls in the roar)
    const TN = 14, TS = 14, tgX = new Float32Array(TS + 1), tgY = new Float32Array(TS + 1), tgP = new Float32Array((TN + 1) * (TS + 1) * 3), tgN = new Float32Array(tgP.length), tgC = new Float32Array(tgP.length), tgI = [];
    for (let i = 0; i <= TN; i++) for (let j = 0; j <= TS; j++) { const o = (i * (TS + 1) + j) * 3, k = 0.72 + 0.40 * i / TN; tgC[o] = pal.tongue[0] * k; tgC[o + 1] = pal.tongue[1] * k; tgC[o + 2] = pal.tongue[2] * k; if (i < TN && j < TS) { const a = i * (TS + 1) + j, b = a + TS + 1; tgI.push(a, a + 1, b, a + 1, b + 1, b); } }
    const tgG = new THREE.BufferGeometry(), tgPos = BA(tgP, 3), tgNor = BA(tgN, 3); tgPos.setUsage(THREE.DynamicDrawUsage); tgNor.setUsage(THREE.DynamicDrawUsage); tgG.setAttribute('position', tgPos); tgG.setAttribute('normal', tgNor); tgG.setAttribute('color', BA(tgC, 3)); tgG.setIndex(tgI);
    const tongue = mk(tgG, skinMat); tongue.castShadow = false; tongue.position.copy(jm.position); jawG.add(tongue);
    function tongueUpdate(lift, wag, t) {
      let py = -0.545, pz = -0.15; const ds = 2.0 / TN;
      for (let i = 0; i <= TN; i++) { const f = i / TN, th = 0.02 + lift * (0.95 * f * f + 0.22 * f) + wag * 0.20 * f * Math.sin(f * 5.0 - t * 11.0), ct = Math.cos(th), sn = Math.sin(th);
        if (i > 0) { py += sn * ds; pz += ct * ds; }
        const w = 0.25 * Math.pow(Math.min(1, (1 - f) * 3.0), 0.75) * (0.70 + 0.30 * sm(0, 0.25, f)) + 0.004, hh = 0.085 * Math.pow(Math.min(1, (1 - f) * 3.5), 0.7) + 0.004;
        // the section: a full rounded edge (not a blade) and a groove down the middle of the upper face; the normals follow the section
        for (let j = 0; j <= TS; j++) { const a = j / TS * TAU, c = Math.cos(a), s = Math.sin(a), x = Math.sign(c) * Math.pow(Math.abs(c), 0.8) * w; let ry = Math.sign(s) * Math.pow(Math.abs(s), 0.62) * hh * 1.15; if (s > 0) ry -= 0.62 * hh * Math.exp(-((x / (0.34 * w)) ** 2)) * s; tgX[j] = x; tgY[j] = ry; }
        for (let j = 0; j <= TS; j++) { const o = (i * (TS + 1) + j) * 3, jp = j === TS ? 1 : j + 1, jm = j === 0 ? TS - 1 : j - 1, ry = tgY[j]; let nx = tgY[jp] - tgY[jm], nn = -(tgX[jp] - tgX[jm]); const l = 1 / (Math.hypot(nx, nn) || 1); nx *= l; nn *= l;
          tgP[o] = tgX[j] * HS; tgP[o + 1] = (py + ry * ct) * HS; tgP[o + 2] = (pz - ry * sn) * HS; tgN[o] = nx; tgN[o + 1] = nn * ct; tgN[o + 2] = -nn * sn; } }
      tgPos.needsUpdate = true; tgNor.needsUpdate = true;
    }
    // eyes: ball, upper lid (blinks, squints), lower lid, all inside the sculpted socket
    const eyeM = eyeMat(pal, U), lidCol = (c, t, o) => { mixc(pal.lid, pal.pit, t * 0.85, o); if (c) { o[0] *= 0.74; o[1] *= 0.74; o[2] *= 0.74; } }, gLidU = toned(lidShared(1), lidCol), gLidL = toned(lidShared(-1), lidCol), lids = [];
    if (!share.eye) share.eye = new THREE.SphereGeometry(RE * HS, 28, 20);
    for (const sgn of [-1, 1]) { const eg = new THREE.Group(); eg.position.set(sgn * EYE[0] * HS, EYE[1] * HS, EYE[2] * HS); eg.lookAt(eg.position.clone().add(new THREE.Vector3(sgn * GAZE[0], GAZE[1], GAZE[2])));
      const ball = new THREE.Mesh(share.eye, eyeM), lu = mk(gLidU, skinMat), ll = mk(gLidL, skinMat); ball.frustumCulled = false; lu.castShadow = ll.castShadow = false; eg.add(ball, lu, ll); group.add(eg); lids.push(lu, ll); }
    // throat glow (black until the breath)
    if (!share.throat) share.throat = new THREE.SphereGeometry(0.23 * HS, 14, 10);
    const throat = new THREE.Mesh(share.throat, new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), fog: false })); throat.position.set(0, -0.41 * HS, -0.70 * HS); group.add(throat);
    // jaw frills: flare with the snarl. They take no shadow-map shadow: a thin two-sided sheet shadows its own far face (the
    // normal bias points the wrong way there), which turned the fan black from behind
    const fr = frillShared(), frCol = new Float32Array(fr.tone.length / 2 * 3), fc = [0, 0, 0];
    for (let i = 0; i < fr.tone.length / 2; i++) { const ro = fr.tone[i * 2], sp = fr.tone[i * 2 + 1]; mixc(pal.frill[0], pal.frill[1], sm(0.0, 0.6, ro), fc); mix3(fc, pal.frill[2], Math.min(1, 0.75 * sm(0.55, 1.0, ro) + 0.40 * sp)); frCol[i * 3] = fc[0]; frCol[i * 3 + 1] = fc[1]; frCol[i * 3 + 2] = fc[2]; }
    const frills = [];
    for (const sgn of [1, -1]) { const src = sgn > 0 ? fr.g : fr.gm, g = new THREE.BufferGeometry(); for (const k of Object.keys(src.attributes)) g.setAttribute(k, src.attributes[k]); g.setAttribute('color', BA(frCol, 3)); g.setIndex(src.index);
      const pv = new THREE.Group(), me = mk(g, finMat); me.receiveShadow = false; pv.position.set(sgn * 1.04 * HS, -0.16 * HS, -0.12 * HS); pv.add(me); group.add(pv); frills.push(pv); }
    // head mane (rigid to the skull, moves in the shader): every tuft curls toward the neck and back, so it sweeps like flame instead of bristling
    const r = rng(pal.seed), hl = [], jl = [], d = new THREE.Object3D(), dir = new THREE.Vector3(), ML = pal.maneLen;
    const tuft = (L, x, y, z, dx, dy, dz, len, w) => L.push({ p: [x * HS, y * HS, z * HS], d: [dx, dy, dz], len: len * ML * HS, w: w * HS, ph: r() });
    for (const [zz, n, l0, l1] of [[-0.50, 34, 0.8, 1.3], [-0.80, 42, 1.2, 2.0], [-1.12, 48, 1.8, 3.0], [-1.46, 44, 2.3, 3.8]]) { const rr = Math.sqrt(Math.max(0.1, 1 - ((zz + 0.55) / 1.18) ** 2));      // the ruff: four rows round the back of the skull, longest at the back (about one head length)
      for (let i = 0; i < n; i++) { const a = lerp(-0.80, Math.PI + 0.80, (i + r()) / n), ad = a + 0.22 * Math.sin(a * 7 + zz * 9), c = Math.cos(a), s = Math.sin(a);
        tuft(hl, c * 0.99 * rr, 0.10 + s * 0.79 * rr, zz, Math.cos(ad) * 0.60, Math.sin(ad) * 0.48 + 0.10, -0.66, lerp(l0, l1, r()) * (0.75 + 0.35 * Math.max(0, s)), (0.75 + r() * 0.7) * (zz > -0.6 ? 0.6 : 1)); } }
    for (const sgn of [-1, 1]) {
      for (let i = 0; i < 16; i++) tuft(hl, sgn * (1.02 + r() * 0.16), -0.42 + r() * 0.70, -0.15 - r() * 0.60, sgn * 0.72, -0.30 + r() * 0.35, -0.78, 1.2 + r() * 1.2, 0.85);        // cheek ruff
      for (let i = 0; i < 9; i++) { const u = 0.22 + 0.78 * i / 8, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;                                                     // eyebrows along the brow ridge
        tuft(hl, sgn * (a * 0.20 + b * 0.68 + c * 1.08), a * 0.47 + b * 1.00 + c * 0.86 + 0.15, a * 1.22 + b * 0.66 - c * 0.42, sgn * (0.25 + 0.3 * u), 0.62, -0.72, 0.45 + 1.0 * u + 0.3 * r(), 0.50 + 0.2 * u); }
      for (let i = 0; i < 7; i++) tuft(hl, sgn * (0.10 + 0.08 * r()), 0.86 - 0.02 * i, 0.30 - i * 0.20, sgn * 0.14, 0.78, -0.62, 0.9 + 0.16 * i + 0.4 * r(), 0.6);                    // crest between the antlers
      for (let i = 0; i < 10; i++) { const z = lerp(1.35, -0.45, i / 9); tuft(jl, sgn * lerp(0.36, 0.60, i / 9), -0.74 - 0.03 * r(), z, sgn * 0.42, -0.60, -0.70, 0.55 + 0.085 * i + 0.3 * r(), 0.55); }   // fringe along the jaw line
    }
    for (let i = 0; i < 18; i++) tuft(jl, (r() - 0.5) * 0.46, -0.84 - 0.05 * r(), 1.25 + r() * 0.95, (r() - 0.5) * 0.34, -0.86, -0.50, 1.0 + r() * 1.2, 0.62);                           // chin beard
    const bz = new THREE.Vector3(), bx = new THREE.Vector3(), bas = new THREE.Matrix4();
    const setLocks = (list, me) => list.forEach((m, i) => { dir.set(m.d[0], m.d[1], m.d[2]).normalize(); bz.set(-m.p[0] * 0.22 / HS, -m.p[1] * 0.22 / HS - 0.30, -1); bz.addScaledVector(dir, -bz.dot(dir)).normalize(); bx.crossVectors(dir, bz).normalize();
      bas.makeBasis(bx, dir, bz); d.position.set(m.p[0], m.p[1], m.p[2]); d.quaternion.setFromRotationMatrix(bas); d.scale.set(m.w, m.len, m.w); d.updateMatrix(); me.setMatrixAt(i, d.matrix); });
    const hm = instLocks(hl, maneH); setLocks(hl, hm); group.add(hm);
    const bm = instLocks(jl, maneH); bm.position.copy(jm.position); setLocks(jl, bm); jawG.add(bm);
    // whiskers: world-space tubes. Two long barbels and two short ones; each hangs in a slow S in a hover and streams along
    // the line the head has flown when it moves (so they lag every turn), with a travelling ripple
    const wm = new THREE.MeshStandardMaterial({ vertexColors: true, alphaToCoverage: true, roughness: 0.4, emissive: new THREE.Color(pal.whiskerEmis[0], pal.whiskerEmis[1], pal.whiskerEmis[2]) }); wm.envMapIntensity = pal.env;
    const whisk = [], world = [];
    for (const [sx, len, rr, by, bz2, amp, curl] of [[1, 17, 0.085, -0.10, 2.50, 1.0, 3.3], [-1, 17, 0.085, -0.10, 2.50, 1.0, 2.7], [1, 8, 0.050, 0.10, 2.66, 0.45, -2.4], [-1, 8, 0.050, 0.10, 2.66, 0.45, -3.0]]) {
      const n = 46, sides = 7, g = new THREE.BufferGeometry(), pos = BA(new Float32Array((n + 1) * (sides + 1) * 3), 3), nor = BA(new Float32Array((n + 1) * (sides + 1) * 3), 3), ix = []; pos.setUsage(THREE.DynamicDrawUsage); nor.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) for (let j = 0; j < sides; j++) { const p0 = i * (sides + 1) + j, p1 = p0 + sides + 1; ix.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1); }
      const wc = new Float32Array((n + 1) * (sides + 1) * 4), c3 = [0, 0, 0], col = BA(wc, 4); col.setUsage(THREE.DynamicDrawUsage); for (let i = 0; i <= n; i++) { const f = i / n, k = 0.62 + 0.38 * sm(0, 0.12, f); mixc(pal.whisker, pal.whiskerTip, Math.pow(f, 0.8), c3); for (let j = 0; j <= sides; j++) { const o = (i * (sides + 1) + j) * 4; wc[o] = c3[0] * k; wc[o + 1] = c3[1] * k; wc[o + 2] = c3[2] * k; wc[o + 3] = 1; } }   // darker at the lip, lighter toward the tip; alpha = coverage, set every frame
      g.setAttribute('position', pos); g.setAttribute('normal', nor); g.setAttribute('color', col); g.setIndex(ix); const me = new THREE.Mesh(g, wm); me.frustumCulled = false; me.castShadow = true; world.push(me);
      whisk.push({ pos, nor, col, n, sides, sx, amp, curl, len: len * KH, r: rr, ph: sx * 1.7 + len, base: new THREE.Vector3(sx * (len > 12 ? 0.41 : 0.32) * HS, by * HS, bz2 * HS), dir: (len > 12 ? new THREE.Vector3(sx * 0.74, sx > 0 ? -0.16 : -0.34, sx > 0 ? 0.66 : 0.54) : new THREE.Vector3(sx * 0.70, sx > 0 ? 0.50 : 0.40, 0.55)).normalize() });   // they leave the lip forward and outward, then sweep back
    }
    const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), vA = new THREE.Vector3(), vB = new THREE.Vector3(), vD = new THREE.Vector3(), vT = new THREE.Vector3(), vN = new THREE.Vector3(), vS = new THREE.Vector3();
    let own;                                             // the dragon wearing this look (for the line it has flown): found on first use
    const BO = (pal.seed % 97) * 0.37, hash1 = i => { const x = Math.sin(i * 127.1 + BO) * 43758.5453; return x - Math.floor(x); };
    // ----- the wet clock of this loong (see the top of the file) -----
    let wet = null, arcOn = 0, hooked = false;
    const findOwn = () => { if (own === undefined) own = (typeof Dragon !== 'undefined' && Dragon.list && Dragon.list.find(q => q.look === api)) || null; return own; };
    function wetPlan() {
      const t0 = performance.now(), LEN = own.LEN, na = Math.floor(LEN / WET_DA) + 1, iv = [], open = new Uint8Array(na), WY = typeof Water !== 'undefined' ? Water.WY : 0.05, T1 = typeof Film !== 'undefined' ? Film.DUR : 90, v = new THREE.Vector3();
      for (let i = 0; i < na; i++) iv.push([]);
      for (let k = 0, n = Math.round(T1 / WET_DT); k <= n; k++) { const t = k * WET_DT, sh = own.sOf(t);
        for (let i = 0; i < na; i++) { const a = i * WET_DA; own.pathAt(sh - a, v);
          if (v.y - Math.max(0.85 * own.RMAX * own.rProf(a), WET_REACH) < WY) { if (open[i]) iv[i][iv[i].length - 1] = t; else { open[i] = 1; iv[i].push(t, t); } } else open[i] = 0; } }
      wet = { na, iv: iv.map(q => new Float32Array(q)), age: new Float32Array(na).fill(99) };
      const o = G.info.look || (G.info.look = {}), f2 = x => +x.toFixed(2); o['wet_' + pal.name] = { head: Array.from(wet.iv[0], f2), mid: Array.from(wet.iv[na >> 1], f2), tail: Array.from(wet.iv[na - 1], f2), ms: Math.round(performance.now() - t0) };
    }
    const ringAge = (i, t) => { const L = wet.iv[i]; let age = 99; for (let k = 0; k < L.length; k += 2) { if (t < L[k]) break; age = t <= L[k + 1] ? 0 : t - L[k + 1]; } return age; };
    // seconds since the ring a metres behind the head left the water at film time t: 0 while it is in it, 99 if it has never been (pure; other modules may read it)
    function wetAge(a, t) { if (!wet) { if (!findOwn() || !own.pathAt) return 99; wetPlan(); } const f = clamp(a / WET_DA, 0, wet.na - 1), i = Math.min(wet.na - 2, Math.floor(f)); return lerp(ringAge(i, t), ringAge(i + 1, t), f - i); }
    // the dorsal crest's clumps are placed by the motion side: where each sits along the body is read once from the first frame that
    // draws them (its instance matrices and the spine belong to the same frame there), and kept as the instanced attribute aArc
    function hookCrest() {
      const me = own.meshes.find(m => m.isInstancedMesh && m.material === mane); if (!me) return;
      const n = me.count, at = new THREE.InstancedBufferAttribute(new Float32Array(n), 1), keep = me.onBeforeRender; me.geometry.setAttribute('aArc', at);
      me.onBeforeRender = function () { const M = me.instanceMatrix.array, C = own.C, NS = own.NS, R2 = (own.RMAX * 1.3) ** 2; let kp = 0;
        const near = (x, y, z, k0, k1) => { let b = 1e9, bk = k0; for (let k = k0; k <= k1; k++) { const dx = C[k * 3] - x, dy = C[k * 3 + 1] - y, dz = C[k * 3 + 2] - z, q = dx * dx + dy * dy + dz * dz; if (q < b) { b = q; bk = k; } } near.d = b; return bk; };
        for (let i = 0; i < n; i++) { const x = M[i * 16 + 12], y = M[i * 16 + 13], z = M[i * 16 + 14]; let k = near(x, y, z, Math.max(0, kp - 6), Math.min(NS, kp + 14)); if (near.d > R2) k = near(x, y, z, 0, NS); else kp = k; at.array[i] = own.LEN * k / NS; }
        at.needsUpdate = true; arcOn = 1; me.onBeforeRender = keep; if (keep) keep.apply(this, arguments); };   // (lead, merge) run the hook this one stood in for: the lake's mirror wrapper pairs it with an onAfterRender that restores the instance count
    }
    // ALL head-internal animation, and this look's per-frame uniforms (skin glow, fade). Reads st.jaw, st.charge, st.roar, st.breath, st.glow, st.vis, st.lid (optional),
    // st.speed, st.s (and group.matrixWorld, st.fwd, st.up for the whiskers). The motion side calls it once per frame after it has placed the head.
    function update(st, t) {
      U.glow.value = st.glow; SH.pxk.value = 2 * Math.tan(rad(G.camera.fov) / 2) / Post.H;
      if (G.storm) { const L = G.storm; SH.storm.value.set(L.color.r, L.color.g, L.color.b).multiplyScalar(L.intensity); SH.stormDir.value.subVectors(L.position, L.target.position).normalize(); }
      const vis = clamp(st.vis), bl = vis < 0.999 ? THREE.NormalBlending : THREE.NoBlending; U.vis.value = vis;
      for (const m of mats) { m.opacity = vis; if (m.blending !== bl) m.blending = bl; }
      const flow = sm(3, 26, st.speed), snarl = clamp(Math.max(st.charge, 0.55 * st.roar)); U.flow.value = flow;
      if (!hooked && findOwn() && own.meshes) { hooked = true; hookCrest(); }
      // wet: the clock of every ring, then what the head, the legs, the hair and the head's plain materials make of it
      let wHead = 0, wHair = 0;
      if (own && own.pathAt) { if (!wet) wetPlan();
        const A = wet.age, na = wet.na, WA = U.wetAge.value, LEN = own.LEN, kq = LEN / (NW - 1) / WET_DA; for (let i = 0; i < na; i++) A[i] = ringAge(i, t);
        for (let j = 0; j < NW; j++) { const f = Math.min(j * kq, na - 1), i = Math.min(na - 2, Math.floor(f)); WA[j] = lerp(A[i], A[i + 1], f - i); }
        const at = a => { const f = clamp(a / WET_DA, 0, na - 1), i = Math.min(na - 2, Math.floor(f)); return lerp(A[i], A[i + 1], f - i); }, aF = LEN * 23 / 172, aH = LEN * 86 / 172, gF = at(aF), gH = at(aH), g0 = Math.min(A[0], A[1]);
        U.wetK.value = (NW - 1) / LEN; wHead = wetOf(g0); wHair = hairOf(g0); U.wetH.value.set(wHead, flowOf(g0)); U.legW.value.set(wetOf(gF), flowOf(gF), wetOf(gH), flowOf(gH));
        if (own.spineAt) { own.spineAt(aF, U.legP0.value); own.spineAt(aH, U.legP1.value); }
        U.wetMH.value.set(wHair, 0, 0); U.wetMB.value.set(0, (NW - 1) / LEN, arcOn); }
      ivoryMat.roughness = lerp(0.3, 0.10, wHead); antlerMat.roughness = lerp(0.62, 0.20, wHead); antlerMat.color.setScalar(1 - 0.40 * wHead); finMat.roughness = lerp(0.5, 0.16, wHead); finMat.color.setScalar(1 - 0.42 * wHead);
      skinMat.roughness = lerp(0.56, 0.20, wHead); wm.roughness = lerp(0.4, 0.14, wHair); wm.color.setScalar(1 - 0.45 * wHair);
      // the head mane streams down the air the head is moving through and swings against the head's own acceleration (both from the rail: pure in t)
      if (own && own.headAt) { own.headAt(t - 0.1, vA); own.headAt(t + 0.1, vB); own.headAt(t, v0); vD.subVectors(vA, vB); const sp = vD.length() / 0.2, A4 = U.air.value;
        if (sp > 0.5) { vD.normalize(); A4.x = vD.x; A4.y = vD.y; A4.z = vD.z; } A4.w = 0.75 * flow * sm(0.5, 4, sp);
        vT.copy(vA).add(vB).addScaledVector(v0, -2).multiplyScalar(-100); const al = vT.length(); U.lag.value.copy(vT).multiplyScalar(Math.min(0.75, al / 45) / (al || 1)); }
      jawG.rotation.x = st.jaw * 0.66;
      // expression: lip and brow follow the snarl, the nostrils breathe and flare, the lids squint and (rarely) blink
      const bk = t / 4.7 + BO, bi = Math.floor(bk), bd = (bk - bi - (0.15 + 0.6 * hash1(bi))) * 4.7, blink = bd > 0 && bd < 0.26 ? sm(0, 0.08, bd) * (1 - sm(0.12, 0.26, bd)) * (1 - snarl) : 0;
      U.expr.value.set(clamp(0.95 * st.charge + 0.45 * st.roar + 0.05 * Math.sin(t * 1.3)), clamp(st.charge + 0.35 * st.roar), clamp(0.22 + 0.22 * Math.sin(t * 1.9 + BO) + 0.8 * st.charge + 0.6 * st.roar), 0);
      const shut = Math.max(blink, clamp(st.lid || 0));                                                        // st.lid (optional, 0..1): the motion side holds the eyes shut (asleep on the spire)
      for (let i = 0; i < lids.length; i += 2) { lids[i].rotation.set(lerp(rad(-36), rad(52), clamp(0.14 + 0.24 * snarl + shut)), 0, (i ? 1 : -1) * (0.30 + 0.12 * snarl) * (1 - shut)); lids[i + 1].rotation.x = -0.02 - 0.26 * snarl - 0.08 * shut; }
      U.eye.value = Math.max(st.glow, st.charge); U.slit.value = clamp(0.25 + 0.75 * Math.max(st.charge, st.roar));
      const fire = Math.max(st.roar, st.breath), F = pal.fire, C = pal.fireCharge;
      throat.material.color.setRGB(F[0] * fire + C[0] * st.charge, F[1] * fire + C[1] * st.charge, F[2] * fire + C[2] * st.charge);
      skinMat.emissive.setRGB(pal.flesh[0] * 0.03 * st.glow + pal.self[0] * 0.7, pal.flesh[1] * 0.03 * st.glow + pal.self[1] * 0.7, pal.flesh[2] * 0.03 * st.glow + pal.self[2] * 0.7);
      tongueUpdate(clamp(1.1 * st.roar + 0.25 * st.breath + 0.4 * st.jaw), st.roar, t);
      for (let i = 0; i < 2; i++) { const sgn = i ? -1 : 1, a = 0.62 + 0.45 * snarl + 0.05 * Math.sin(t * 2.3 + i) - 0.16 * flow; frills[i].rotation.y = -sgn * a; frills[i].rotation.z = sgn * 0.10 * snarl; }
      const s0 = st.s, hasPath = !!(own && own.pathAt), cam = G.camera.position, pxw = SH.pxk.value;
      for (const w of whisk) {
        const P2 = w.pos.array, N2 = w.nor.array, C2 = w.col.array, n = w.n, sd = w.sides, seg = w.len / n;
        v0.copy(w.base).applyMatrix4(group.matrixWorld); v1.copy(w.dir).applyQuaternion(group.quaternion); vS.crossVectors(st.up, st.fwd).multiplyScalar(w.sx);
        let px = v0.x, py = v0.y, pz = v0.z; vN.copy(st.up);
        for (let i = 0; i <= n; i++) {
          const f = i / n, e = sm(0.0, 0.15, f);
          // where the air goes: the head's own axis near the root, the line it has flown further out
          if (hasPath) { const l = f * w.len; own.pathAt(s0 - l - 2, vA); own.pathAt(s0 - l + 2, vB); vD.subVectors(vA, vB); if (vD.lengthSq() < 1e-6) vD.copy(st.fwd).multiplyScalar(-1); else vD.normalize(); } else vD.copy(st.fwd).multiplyScalar(-1);
          vD.multiplyScalar(0.35 + 0.65 * f).addScaledVector(st.fwd, -0.65 * (1 - f)).normalize();
          // hover: out to the side, down, back, the tip lifting
          const dn = w.amp * (0.95 * Math.sin(Math.PI * Math.min(1, f / 0.62)) * (1 + 1.1 * wHair) - 0.60 * sm(0.62, 1.0, f) * (1 - wHair));     // wet: a heavy rope, no lifted tip
          vA.copy(vS).multiplyScalar(1 - 0.85 * sm(0, 0.6, f)).addScaledVector(st.fwd, -(0.15 + 0.75 * sm(0.1, 0.7, f))); vA.y -= dn;
          // flight: a streamer
          vT.copy(vS).multiplyScalar(0.45 * (1 - f) * (1 - f)).add(vD); vT.y -= 0.10 * Math.sin(Math.PI * f);
          vT.normalize().multiplyScalar(flow).addScaledVector(vA.normalize(), 1 - flow).normalize().multiplyScalar(e).addScaledVector(v1, 1 - e);
          vT.y += e * w.amp * (0.10 + 0.10 * flow) * f * Math.sin(f * 4.4 - t * (1.7 + 1.6 * flow) + w.ph);
          vT.addScaledVector(vS, e * w.amp * 0.10 * f * Math.sin(f * 3.6 - t * (1.3 + 1.2 * flow) + w.ph * 2)).normalize();
          // a standing S the pose cannot iron out (when the head rears, "back" and "down" are one line), and a curled tip
          vT.addScaledVector(vS, e * (0.26 + 0.30 * f) * Math.sin(f * 5.4 + w.ph * 0.7)).addScaledVector(st.up, e * (0.24 + 0.16 * f) * Math.sin(f * 4.1 + 1.1 + w.ph)).normalize();
          if (f > 0.70) { const cu = w.curl * Math.pow((f - 0.70) / 0.30, 1.6); vA.copy(st.up).addScaledVector(vS, 0.55); vA.addScaledVector(vT, -vA.dot(vT)); if (vA.lengthSq() > 1e-6) vT.multiplyScalar(Math.cos(cu)).addScaledVector(vA.normalize(), Math.sin(cu)); }
          if (i > 0) { px += vT.x * seg; py += vT.y * seg; pz += vT.z * seg; }
          vN.addScaledVector(vT, -vN.dot(vT)); if (vN.lengthSq() < 1e-6) vN.copy(st.fwd).addScaledVector(vT, -st.fwd.dot(vT)); vN.normalize(); vB.crossVectors(vT, vN);
          // swells at the lip, thins to a hair; never under 1.2 px wide on screen: what it lacks in width it gives up in coverage, so the far end fades instead of breaking into dashes
          const rt = w.r * (0.10 + 0.90 * Math.pow(1 - f, 1.4)) * (1 + 0.5 * Math.exp(-f * 10)) * KH * (1 - sm(0.94, 1.0, f)), rmin = 0.6 * pxw * Math.hypot(px - cam.x, py - cam.y, pz - cam.z), rr = Math.max(rt, rmin), cov = Math.min(1, rt / rmin);
          for (let j = 0; j <= sd; j++) { const a = j / sd * TAU, c = Math.cos(a), s = Math.sin(a), o2 = (i * (sd + 1) + j) * 3, nx = vN.x * c + vB.x * s, ny = vN.y * c + vB.y * s, nz = vN.z * c + vB.z * s;
            P2[o2] = px + nx * rr; P2[o2 + 1] = py + ny * rr; P2[o2 + 2] = pz + nz * rr; N2[o2] = nx; N2[o2 + 1] = ny; N2[o2 + 2] = nz; C2[(i * (sd + 1) + j) * 4 + 3] = cov; }
        }
        w.pos.needsUpdate = true; w.nor.needsUpdate = true; w.col.needsUpdate = true;
      }
    }
    // ----- legs (right-hand sculpt, mirrored for the left) -----
    const sLeg = sdfShared('leg', () => SD.mesh(SC.leg, [-0.9, -4.45, -1.95, 2.1, 0.85, 2.30], 108), 2.25, LEGMAP, [0, -1, 0]);
    const legR = painted(sLeg, (x, y, z, nx, ny, nz, o) => {
      const tk = sm(0.035, -0.012, SC.talons(x, y, z)), toeS = sm(-2.92, -3.18, y) * (1 - tk), fn = sm(0.06, -0.02, SC.fin(x, y, z));
      mixc(pal.body, pal.deep, 0.35 * sm(-0.2, 0.7, -nx), o); mix3(o, pal.frill[1], fn * 0.75); mix3(o, pal.skin, toeS * 0.75); o[6] = toeS * 0.85;
      if (tk > 0) { mix3(o, pal.claw, tk); mix3(o, pal.clawTip, tk * sm(-3.75, -4.3, y)); o[5] = tk; o[6] *= 1 - tk; }
    });
    if (!share.legM) { const p = new Float32Array(sLeg.position.array), nn = new Float32Array(sLeg.normal.array), ix = sLeg.index.array.slice(), q = new Float32Array(sLeg.aQ.array);
      for (let i = 0; i < p.length; i += 3) { p[i] = -p[i]; nn[i] = -nn[i]; } for (let i = 0; i < q.length; i += 2) q[i] = -q[i]; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
      share.legM = { position: BA(p, 3), normal: BA(nn, 3), aQ: BA(q, 2), index: BA(ix, 1) }; }
    const legL = new THREE.BufferGeometry(); legL.setAttribute('position', share.legM.position); legL.setAttribute('normal', share.legM.normal); legL.setAttribute('aQ', share.legM.aQ); for (const k of ['color', 'aT', 'aK', 'aMk', 'uv']) legL.setAttribute(k, legR.attributes[k]); legL.setIndex(share.legM.index);
    // ----- body tube colour: a = metres behind the head, phi = ring angle (sin > 0 is the back); returns the belly flag aK -----
    function bodyColor(a, phi, LEN, out) {
      const s = Math.sin(phi), belly = sm(-0.45, -0.80, s), dors = sm(0.72, 0.98, s);
      mixc(pal.body, pal.deep, dors * 0.8 + 0.25 * (0.5 + 0.5 * Math.sin(a * 0.31)) * (1 - belly), out);
      mix3(out, pal.flank, 0.45 * sm(0.10, -0.40, s) * (1 - belly)); mix3(out, pal.belly, belly);
      return belly;
    }
    mats.push(bodyMat, headMat, legMat, ivoryMat, antlerMat, skinMat, finMat, mane, maneH, wm, eyeM, throat.material);
    // st.vis fades the whole loong: every material lives in the transparent pass (same compiled program at any vis), drawn with
    // NoBlending while vis is 1 (identical to an opaque draw) and alpha-blended with opacity = vis while it is fading
    for (const m of mats) { m.transparent = true; m.forceSinglePass = true; m.blending = THREE.NoBlending; }
    const api = { pal, HS: pal.HS, U, mats, bodyMat, bodyColor, wetAge,
      head: { group, world, mouthLocal: new THREE.Vector3(0, -0.42 * HS, 1.9 * HS), update },
      leg: { right: legR, left: legL, mat: legMat },
      mane: { geo: lockGeo(false), mat: mane } };
    stamp('make_' + pal.name, tAll);
    return api;
  }
  return { PAL, make, HS0, SH };
})();
