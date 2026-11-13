'use strict';
// ---- procedural textures: GPU-baked tiling maps + canvas-drawn leaves and ornaments -----------------
const Tex = (() => {
  const T = {};
  const PER = /* glsl */`
  float ph(vec2 p, float per){ return hash21(mod(p, per)); }
  float pn(vec2 p, float per){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(ph(i,per), ph(i+vec2(1,0),per), f.x), mix(ph(i+vec2(0,1),per), ph(i+vec2(1,1),per), f.x), f.y); }
  float pfbm(vec2 p, float per){ float a = .5, s = 0.; for (int i = 0; i < 6; i++){ s += a*pn(p,per); p *= 2.; per *= 2.; a *= .5; } return s; }
  vec2 pwor(vec2 p, float per){ vec2 i = floor(p), f = fract(p); float d1 = 9., d2 = 9.;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 o = vec2(float(x), float(y)); vec2 r = o + hash22(mod(i+o, per)) - f; float d = dot(r,r);
      if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
    return sqrt(vec2(d1, d2)); }`;
  // the same lattice noise with a separate period per axis, for maps that are stretched one way
  const PER2 = /* glsl */`
  float pn(vec2 p, vec2 per){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
    return mix(mix(hash21(mod(i, per)), hash21(mod(i+vec2(1,0), per)), f.x), mix(hash21(mod(i+vec2(0,1), per)), hash21(mod(i+vec2(1,1), per)), f.x), f.y); }`;
  const CHIPS = /* glsl */`
  // flat fracture chips: cells of a tiling Voronoi, each with its own height and its own tilt. per = cells per tile
  float chips(vec2 p, vec2 per, float tilt){ vec2 q = p*per; q += 0.42*(vec2(pn(q*1. + 3.7, per), pn(q*1. + 9.1, per)) - 0.5) + 0.16*(vec2(pn(q*3. + 1.3, per*3.), pn(q*3. + 6.4, per*3.)) - 0.5);
    vec2 i = floor(q), f = fract(q), r1 = vec2(0.), id = vec2(0.); float d1 = 9.;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 o = vec2(float(x), float(y)), c = mod(i + o, per), r = o + hash22(c + per.x) - f; float d = dot(r, r);
      if (d < d1){ d1 = d; r1 = r; id = c; } }
    return hash21(id + per.y*1.3 + 5.1) + tilt * dot(hash22(id + 17.3) - 0.5, -r1); }
  // one set of parallel hairline fractures, broken into short runs. d has whole-number components, so the set tiles
  float seg(vec2 p, vec2 d, float ph, float w, vec2 mp){ float s = dot(p, d) + ph + (pn(p*mp*2., mp*2.) - 0.5)*0.3;
    float m = smoothstep(0.54, 0.68, pn(p*mp + d.yx*0.37 + ph, mp)); return (1. - smoothstep(0.0, w, abs(fract(s) - 0.5))) * m; }`;
  // ---- what the cliff-face maps share: the beds. All of it tiles. p is in tile units (0..1 across, 0..1 up) -------------------
  const FACE = /* glsl */`
  const float NBED = 7.;
  // height of bed plane i at across-position u: jittered spacing, a slow undulation
  float bedY(float i, float u){ float k = mod(i, NBED);
    return (i + 0.20 + 0.60*hash11(k*7.31 + 2.7))/NBED + 0.0170*(pn(vec2(u*5. + k*3.7, k*1.9 + 0.5), vec2(5., 97.)) - 0.5) + 0.0050*(pn(vec2(u*19. + k*1.3, k*2.3 + 0.5), vec2(19., 97.)) - 0.5); }
  // how open the joint of bed plane k is at u: some planes are tight nearly all the way, none is open all the way
  float bedJ(float k, float u){ return (0.25 + 0.75*hash11(k*6.1 + 3.3)) * smoothstep(0.34, 0.66, pn(vec2(u*4. + k*2.7, k*0.7 + 0.5), vec2(4., 97.))*0.6 + pn(vec2(u*17. + k*1.7, k*1.3 + 0.5), vec2(17., 97.))*0.4); }
  // x: distance up to the bed plane above, y: down to the one below (tile units), z: index of the plane below (the bed's own number), w: of the one above
  vec4 bedAt(vec2 p){ float dA = 9., dB = 9., iA = 0., iB = 0.;
    for (int n = -2; n <= 8; n++){ float i = float(n), d = bedY(i, p.x) - p.y; if (d >= 0. && d < dA){ dA = d; iA = i; } if (d < 0. && -d < dB){ dB = -d; iB = i; } }
    return vec4(dA, dB, iB, iA); }
  float layO(float i){ return hash11(mod(i, NBED)*3.17 + 0.9); }                // how far a bed stands out of the face, 0..1
  // tiling Voronoi. x: distance to the cell's point, y: distance to the cell's border, z: the cell's own random number
  vec3 pvor(vec2 q, vec2 per){ vec2 i = floor(q), f = fract(q), r1 = vec2(0.), r2 = vec2(1.), id = vec2(0.); float d1 = 9., d2 = 9.;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){ vec2 o = vec2(float(x), float(y)), c = mod(i + o, per), r = o + 0.12 + 0.76*hash22(c + per.x*0.37) - f; float d = dot(r, r);
      if (d < d1){ d2 = d1; r2 = r1; d1 = d; r1 = r; id = c; } else if (d < d2){ d2 = d; r2 = r; } }
    return vec3(sqrt(d1), (d2 - d1)/(2.*max(length(r2 - r1), 1e-4)), hash21(id + per.y*1.3 + 5.1)); }`;
  // ---- weathering, as colour masks (not height). r: dark water stain, g: ochre and rust, b: pale (fresh scars, lichen crust),
  //      a: fine map = shade (1 open, 0 black: open joints, the underside of every overhanging bed); coarse map = how weathered
  const MAPS = {
    // on the beds of the flute map, same tile: runs of water that leave the rock at a bed plane and die out down the face below
    weath: /* glsl */`vec4 W(vec2 p){
      vec4 b = bedAt(p); float o = layO(b.z), oU = layO(b.w), over = max(oU - o, 0.), dA = b.x*13., dB = b.y*13.;
      float kn = mod(dA < dB ? b.w : b.z, NBED), edge = min(dA, dB);
      float jo = exp(-edge*edge/(0.030*0.030)) * (0.15 + 0.85*bedJ(kn, p.x));
      float und = (0.22 + 0.78*smoothstep(0.04, 0.42, over)) * exp(-dA/(0.06 + 0.42*over));
      float occ = (1. - 0.92*jo) * (1. - 0.82*und);
      float uu = p.x + 0.0035*(pn(vec2(p.y*11., 0.5), vec2(11., 97.)) - 0.5), st = 0.;
      for (int n = -1; n <= 10; n++){ float i = float(n), d = bedY(i, p.x) - p.y; if (d <= 0. || d > 0.47) continue; float k = mod(i, NBED), wet = 0.45 + 0.55*hash11(k*9.7 + 4.4);
        { float x = uu*53. + k*0.31, c = mod(floor(x), 53.), a = abs(fract(x) - 0.5)*2.; vec2 h = hash22(vec2(c, k) + 13.7); float L = mix(0.035, 0.26, h.y), s = d/L, w = mix(0.35, 1.0, fract(h.x*7.7))*(1. - 0.6*min(s, 1.));
          st = max(st, step(1. - 0.42*wet, h.x) * (1. - smoothstep(w*0.45, w, a)) * max(1. - s, 0.) * (0.55 + 0.45*fract(h.y*5.3))); }
        { float x = uu*17. + k*0.57, c = mod(floor(x), 17.), a = abs(fract(x) - 0.5)*2.; vec2 h = hash22(vec2(c, k) + 71.3); float L = mix(0.06, 0.46, h.y), s = d/L, w = mix(0.30, 0.95, fract(h.x*5.1))*(1. - 0.5*min(s, 1.));
          st = max(st, step(1. - 0.40*wet, h.x) * (1. - smoothstep(w*0.5, w, a)) * pow(max(1. - s, 0.), 1.3) * (0.6 + 0.4*fract(h.y*3.7))); } }
      st *= 0.62 + 0.38*pn(vec2(uu*151., p.y*7.), vec2(151., 7.));
      float oc = smoothstep(0.56, 0.80, pfbm(p*3. + 2.3, 3.)*0.75 + pn(p*vec2(31., 9.), vec2(31., 9.))*0.25);
      float kU = mod(b.w, NBED); oc = max(oc, step(0.50, hash11(kU*4.1 + 0.3)) * exp(-dA/0.55) * smoothstep(0.35, 0.70, pn(vec2(p.x*9. + kU, kU*1.1 + 0.5), vec2(9., 97.))));
      vec2 q = p*vec2(11., 13.); q += 0.35*(vec2(pn(q + 3.7, vec2(11., 13.)), pn(q + 9.1, vec2(11., 13.))) - 0.5);
      vec3 v = pvor(q, vec2(11., 13.)); float scar = step(0.87, v.z) * smoothstep(0.02, 0.07, v.y);
      float lic = smoothstep(0.60, 0.66, pfbm(p*13. + 7.7, 13.)) * smoothstep(0.50, 0.62, pn(p*5. + 2.2, 5.)) * 0.55;
      return vec4(st, oc, max(scar, lic), occ); }`,
    // at cliff scale (one tile = 40 m across, 64 m up): curtains of stain tens of metres long made of many runs, broad rust zones,
    // the pale faces left where a slab has come away, and how weathered each stretch is
    weathC: /* glsl */`vec4 W(vec2 p){
      float uu = p.x + 0.0045*(pn(vec2(p.y*6., 0.5), vec2(6., 97.)) - 0.5), st = 0.;
      float fib = pn(vec2(uu*211., p.y*5.), vec2(211., 5.))*0.6 + pn(vec2(uu*83. + 3.1, p.y*3.), vec2(83., 3.))*0.4;      // runs 19 and 48 cm wide
      for (int n = 0; n < 3; n++){ float fn = float(n), NC = n == 0 ? 9. : n == 1 ? 21. : 47.;
        float x = uu*NC + fn*0.31, c = mod(floor(x), NC), a = abs(fract(x) - 0.5)*2. + 0.5*(fib - 0.5);
        for (int j = 0; j < 2; j++){ vec2 h = hash22(vec2(c, fn*7. + float(j)*3.) + 31.3);
          float top = h.x + 0.030*(pn(vec2(p.x*41., fn + 0.5), vec2(41., 97.)) - 0.5), L = mix(0.20, 0.95, h.y), s = fract(top - p.y)/L, w = mix(0.40, 0.95, fract(h.x*9.1 + h.y*3.3))*(1. - 0.35*min(s, 1.));
          st = max(st, step(n == 0 ? 0.42 : 0.52, fract(h.y*11.7 + h.x*5.9)) * (1. - smoothstep(w*0.45, w, a)) * smoothstep(0.0, 0.035, s) * step(s, 1.) * smoothstep(s*1.15 - 0.40, s*1.15 - 0.08, fib) * (1. - 0.45*s)); } }      // a curtain frays into single runs on its way down
      st *= smoothstep(0.40, 0.58, pn(vec2(p.x*4. + 0.7, p.y*1.), vec2(4., 1.))*0.6 + pn(vec2(p.x*9. + 2.9, p.y*2.), vec2(9., 2.))*0.4);          // some stretches of a cliff run wet and some never do
      float oc = smoothstep(0.58, 0.80, pfbm(p*3. + 5.7, 3.));
      vec2 q = p*9.; q += 0.40*(vec2(pn(q + 3.7, vec2(9.)), pn(q + 9.1, vec2(9.))) - 0.5);
      vec3 v = pvor(q, vec2(9.)); float scar = step(0.88, v.z) * smoothstep(0.012, 0.045, v.y);
      float age = pfbm(p*2. + 1.3, 2.)*0.7 + pn(vec2(uu*13., p.y*2.), vec2(13., 2.))*0.3;
      return vec4(st, oc, scar, age); }`,
  };
  const HEIGHTS = {
    // limestone skin, no direction: a rough pitted grain over a few shallow fracture chips. No line sets and no fine
    // parallel runnels: on a distant cliff either one turns into moire, and close to they read as wrinkles
    rock: /* glsl */`float H(vec2 p){
      float c = chips(p, vec2(5.), 0.25)*0.20 + chips(p + 0.37, vec2(13.), 0.22)*0.12;
      float a = 0.5, s = 0., f = 12.;
      for (int i = 0; i < 4; i++){ float n = 1. - abs(2.*pn(p*f + float(i)*1.7, f) - 1.); s += a*n*n; f *= 2.; a *= 0.5; }
      float pit = smoothstep(0.62, 0.78, pn(p*23., 23.)) * 0.16 + smoothstep(0.66, 0.80, pn(p*61. + 3.3, 61.)) * 0.10;
      return 0.30 + c + s*0.16 + (pfbm(p*20., 20.) - 0.5)*0.42 + pfbm(p*96., 96.)*0.12 - pit; }`,
    // cliff-face skin: u runs across the face (one tile = 8.1 m), v runs up it (13 m). The rock is bedded: seven beds a tile, 0.7 to 3 m
    // thick, each standing a little proud of or behind its neighbours, so every bed plane is a small ledge or a small overhang with
    // an open joint in it. Rain runnels start at the top of a bed and die out down its face, each bed with its own set, so no
    // groove runs on through a joint. Fracture chips, pits and grain lie over that.
    flute: /* glsl */`float H(vec2 p){
      vec4 b = bedAt(p); float o = layO(b.z), dA = b.x*13., dB = b.y*13., T = b.x + b.y, s = b.x/max(T, 1e-4), kz = mod(b.z, NBED);
      float edge = min(dA, dB), kn = mod(dA < dB ? b.w : b.z, NBED);
      float body = 0.16 + 0.34*o;
      body *= 1. - 0.30*exp(-dA/0.10) - 0.18*exp(-dB/0.07);                                  // a bed's face rounds off toward its joints, more at its top
      float jn = exp(-edge*edge/(0.022*0.022)) * (0.15 + 0.85*bedJ(kn, p.x));
      float x = p.x + 0.0035*(pn(vec2(p.y*11., 0.5), vec2(11., 97.)) - 0.5);
      float ph = hash11(kz*5.3 + 1.1);
      float am = smoothstep(0.30, 0.62, pn(vec2(p.x*6. + kz*2.1, kz*1.3 + 0.5), vec2(6., 97.)));    // fluted stretches and plain ones
      float r1 = abs(2.*pn(vec2(x*59. + ph*7., kz*1.7 + 0.5), vec2(59., 97.)) - 1.);                  // runnels 10 to 30 cm apart
      float r2 = abs(2.*pn(vec2(x*23. + ph*3., kz*2.9 + 0.5), vec2(23., 97.)) - 1.);                  // and 30 to 70 cm
      float fade = mix(1.0, 0.30, smoothstep(0.0, 0.85, s));
      float run = (pow(r1, 0.55)*0.13 + pow(r2, 0.6)*0.11*(0.4 + 0.6*am)) * fade * (0.35 + 0.65*am);
      float g1 = abs(2.*pn(vec2(x*7., p.y*2. + 0.5), vec2(7., 2.)) - 1.);                             // the broad wall runnels that cross the beds
      float c = chips(p, vec2(9., 9.), 0.25)*0.15 + chips(p + 0.41, vec2(23., 21.), 0.22)*0.09;
      vec3 pv = pvor(p*vec2(47., 61.), vec2(47., 61.)); float pit = step(0.86, pv.z) * (1. - smoothstep(0.06, 0.16 + 0.5*fract(pv.z*37.), pv.x)) * smoothstep(0.45, 0.65, pn(p*7. + 1.9, 7.));
      float pit2 = smoothstep(0.68, 0.82, pn(p*vec2(41.,29.), vec2(41.,29.)));
      return 0.10 + body + run + pow(g1, 0.6)*0.09 + c + (pfbm(p*12., 12.) - 0.5)*0.16 + pfbm(p*48., 48.)*0.07 - jn*0.22 - pit*0.13 - pit2*0.05; }`,
    bark: /* glsl */`float H(vec2 p){ vec2 q = vec2(p.x*14. + pn(p*vec2(6.,3.), 3.)*1.6, p.y*3.);
      float r = abs(pn(q, 3.) * 2. - 1.); float r2 = abs(pn(q*2.+5., 6.)*2.-1.);
      return pow(r, 0.6)*0.6 + r2*0.25 + pfbm(p*24., 24.)*0.15; }`,
  };
  function bake(R, kind, size = 1024, strength = 6) {
    const mk = () => new THREE.WebGLRenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const a = mk();
    const out = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
    out.texture.anisotropy = 8;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const VS = 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
    const m1 = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: `${GLSL_NOISE}${PER}${PER2}${CHIPS}${FACE}${HEIGHTS[kind]} varying vec2 vUv; void main(){ gl_FragColor = vec4(H(vUv), 0., 0., 1.); }`, depthTest: false });
    const m2 = new THREE.ShaderMaterial({ vertexShader: VS, uniforms: { tH: { value: a.texture }, uE: { value: 1 / size }, uS: { value: strength } },
      fragmentShader: `uniform sampler2D tH; uniform float uE, uS; varying vec2 vUv; void main(){ float h = texture2D(tH, vUv).r;
        float hx = texture2D(tH, vUv + vec2(uE, 0.)).r - texture2D(tH, vUv - vec2(uE, 0.)).r, hy = texture2D(tH, vUv + vec2(0., uE)).r - texture2D(tH, vUv - vec2(0., uE)).r;
        float hb = 0.; for (int i = 0; i < 8; i++){ float an = float(i)*0.7854; hb += texture2D(tH, vUv + vec2(cos(an), sin(an))*uE*6.).r; }
        float cav = clamp(0.5 + (h - hb/8.)*5.0, 0., 1.);
        gl_FragColor = vec4(clamp(vec2(hx, hy)*uS*0.5/ (uE*1024.) + 0.5, 0., 1.), h, cav); }`, depthTest: false });
    const q = new THREE.Mesh(g, m1); q.frustumCulled = false; const s = new THREE.Scene(); s.add(q); const c = new THREE.Camera();
    R.setRenderTarget(a); R.render(s, c); q.material = m2; R.setRenderTarget(out); R.render(s, c); R.setRenderTarget(null);
    a.dispose(); m1.dispose(); m2.dispose();
    return out.texture;
  }
  // a colour map straight from W(uv): tiling, mipmapped, linear
  function bakeMap(R, kind, size = 1024) {
    const out = new THREE.WebGLRenderTarget(size, size, { depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true });
    out.texture.anisotropy = 8;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    const m = new THREE.ShaderMaterial({ vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `${GLSL_NOISE}${PER}${PER2}${CHIPS}${FACE}${MAPS[kind]} varying vec2 vUv; void main(){ gl_FragColor = clamp(W(vUv), 0., 1.); }`, depthTest: false });
    const q = new THREE.Mesh(g, m); q.frustumCulled = false; const s = new THREE.Scene(); s.add(q);
    R.setRenderTarget(out); R.render(s, new THREE.Camera()); R.setRenderTarget(null); m.dispose(); g.dispose();
    return out.texture;
  }
  // canvas helper -> mipmapped sRGB texture
  function canvas(w, h, draw, o = {}) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); draw(x, w, h);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = o.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = o.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
  function init(R) { T.rock = bake(R, 'rock', 1024, 7); T.flute = bake(R, 'flute', 1024, 7); T.weath = bakeMap(R, 'weath', 1024); T.weathC = bakeMap(R, 'weathC', 1024); T.bark = bake(R, 'bark', 512, 6); T.rock.anisotropy = T.flute.anisotropy = 8; }
  return Object.assign(T, { init, bake, bakeMap, canvas });
})();
