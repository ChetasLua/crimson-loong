'use strict';
// ---- karst world: spires, cliff walls, terraces. Also records planting sites for flora/buildings ----
// The rock is jointed limestone: vertical joints cut it into columns, bedding planes cut the columns into blocks, and every
// block sits a little proud of or behind its neighbours with its face tilted its own way. That block field is one
// function, written twice with the same integer hash: on the CPU it displaces the mesh (silhouette, shadows, AO), in the
// fragment shader it is evaluated per pixel at the vertex's undisplaced position (attribute aB), so every joint the
// shader draws sits exactly on the step the mesh makes, and a facet is flat and its edge crisp at any distance.
const Rock = (() => {
  const geos = [], sites = [];
  const P = new THREE.Vector3();
  // ---------- the block field (keep in step with GLSL_BLOCKS below) ----------
  const hI = (i, j, k) => { let n = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1); n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return (n ^ (n >>> 15)) >>> 0; };
  // S: column width, H: bed thickness (metres). LV0 lives in the mesh only (buttresses), LV1 in mesh and shader, LV2 mostly in the shader
  const LV0 = { S: 12, H: 30, seed: 5 }, LV1 = { S: 3.6, H: 9, seed: 11 }, LV2 = { S: 1.15, H: 2.7, seed: 23 };
  const A1 = 0.80, T1 = 0.20, A2 = 0.20, T2 = 0.26;       // nominal step height (m) and face tilt (slope) the shader assumes
  const dipF = (x, z) => 0.07 * x - 0.04 * z + 1.6 * Math.sin(x * 0.043 + 0.5) + 1.3 * Math.sin(z * 0.051 + 2.1);   // the beds dip gently
  let lBt = 0, lBb = 0, tX = 0, tZ = 0;
  function lyr(cx, cz, yd, H, seed) {                      // bed index of column (cx,cz) at height yd; distances to its bed planes in lBt/lBb
    const n = hI(cx, cz, seed + 1), Hc = H * (0.7 + 0.6 * (n & 0xffff) / 65536), ly = yd / Hc + (n >>> 16) / 65536 * 7, fl = Math.floor(ly), lf = ly - fl;
    lBt = (1 - lf) * Hc; lBb = lf * Hc; return fl;
  }
  function cOff(cx, cz, li, seed) { const n = hI(cx + li * 57, cz + li * 113, seed + 3); tX = ((n >>> 10) & 2047) / 1023.5 - 1; tZ = (n >>> 21) / 1023.5 - 1; const v = (n & 1023) / 511.5 - 1; return v < 0 ? v * (1 + 0.5 * v) : v; }
  // displacement (metres, along the surface normal) of one level at an undisplaced point. Steps ramp over `band` metres. dip = dipF(x, z)
  function blk(x, y, z, L, sc, A, T, band, dip) {
    const S = L.S * sc, H = L.H * sc, seed = L.seed, wy = y * 0.4 / S, ax = x / S, az = z / S;
    const qx = ax + 0.35 * Math.sin(wy + 1.7) + 0.07 * Math.sin(az * 4.1 + wy * 6.1 + 1.0 + 1.9 * Math.sin(wy * 2.3 + az * 1.3));       // joints lean and wander
    const qz = az + 0.35 * Math.sin(wy * 1.13 + 4.1) + 0.07 * Math.sin(ax * 3.7 - wy * 5.3 + 2.0 + 1.9 * Math.sin(wy * 2.9 - ax * 1.1));
    const X = Math.floor(qx), Z = Math.floor(qz), fx = qx - X, fz = qz - Z;
    let d1 = 1e9, d2 = 1e9, r1x = 0, r1z = 0, r2x = 1, r2z = 1, c1x = X, c1z = Z, c2x = X, c2z = Z;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const n = hI(X + i, Z + j, seed), rx = i + 0.15 + 0.7 * (n & 0xffff) / 65536 - fx, rz = j + 0.15 + 0.7 * (n >>> 16) / 65536 - fz, d = rx * rx + rz * rz;
      if (d < d1) { d2 = d1; r2x = r1x; r2z = r1z; c2x = c1x; c2z = c1z; d1 = d; r1x = rx; r1z = rz; c1x = X + i; c1z = Z + j; }
      else if (d < d2) { d2 = d; r2x = rx; r2z = rz; c2x = X + i; c2z = Z + j; }
    }
    const dl = Math.max(Math.hypot(r2x - r1x, r2z - r1z), 1e-4), e = (d2 - d1) / (2 * dl) * S, yd = y + dip + S * 0.07 * Math.sin(ax * 3.3 + az * 2.1), TS = T * S;
    const li = lyr(c1x, c1z, yd, H, seed), bt = lBt, bb = lBb;
    const dS = A * cOff(c1x, c1z, li, seed) - TS * (tX * r1x + tZ * r1z);
    let d = dS;
    if (bt < band) d += 0.5 * (1 - bt / band) * (A * cOff(c1x, c1z, li + 1, seed) - TS * (tX * r1x + tZ * r1z) - dS);
    if (bb < band) d += 0.5 * (1 - bb / band) * (A * cOff(c1x, c1z, li - 1, seed) - TS * (tX * r1x + tZ * r1z) - dS);
    if (e < band) { const l2 = lyr(c2x, c2z, yd, H, seed); d += 0.5 * (1 - e / band) * (A * cOff(c2x, c2z, l2, seed) - TS * (tX * r2x + tZ * r2z) - dS); }
    return d;
  }
  const f3 = x => x.toFixed(4);
  const GLSL_BLOCKS = /* glsl */`
    uint rkH(int x, int y, int z){ uint n = uint(x)*0x27d4eb2du ^ uint(y)*0x165667b1u ^ uint(z)*0x9e3779b1u; n = (n ^ (n >> 15u)) * 0x2c1b3c6du; n = (n ^ (n >> 12u)) * 0x297a2d39u; return n ^ (n >> 15u); }
    float rkDip(vec2 p){ return 0.07 * p.x - 0.04 * p.y + 1.6 * sin(p.x * 0.043 + 0.5) + 1.3 * sin(p.y * 0.051 + 2.1); }
    int rkLyr(ivec2 c, float yd, float H, int seed, out float bt, out float bb){ uint n = rkH(c.x, c.y, seed + 1); float Hc = H * (0.7 + 0.6 * float(n & 0xffffu) / 65536.0);
      float ly = yd / Hc + float(n >> 16u) / 65536.0 * 7.0, fl = floor(ly), lf = ly - fl; bt = (1.0 - lf) * Hc; bb = lf * Hc; return int(fl); }
    float rkOff(ivec2 c, int li, int seed, out vec2 tilt){ uint n = rkH(c.x + li * 57, c.y + li * 113, seed + 3);
      tilt = vec2(float((n >> 10u) & 2047u), float(n >> 21u)) / 1023.5 - 1.0; float v = float(n & 1023u) / 511.5 - 1.0; return v < 0.0 ? v * (1.0 + 0.5 * v) : v; }
    struct RkL { float e; float bt; float bb; float off; float offN; float offU; float offD; float id; vec2 g; vec2 tilt; };
    RkL rkLevel(vec3 p, float dip, float S, float H, int seed){
      RkL o; float wy = p.y * 0.4 / S; vec2 a = p.xz / S;
      vec2 q = a + 0.35 * vec2(sin(wy + 1.7), sin(wy * 1.13 + 4.1)) + 0.07 * vec2(sin(a.y * 4.1 + wy * 6.1 + 1.0 + 1.9 * sin(wy * 2.3 + a.y * 1.3)), sin(a.x * 3.7 - wy * 5.3 + 2.0 + 1.9 * sin(wy * 2.9 - a.x * 1.1)));
      vec2 fl = floor(q), f = q - fl; ivec2 ic = ivec2(fl), c1 = ic, c2 = ic; float d1 = 1e9, d2 = 1e9; vec2 r1 = vec2(0.0), r2 = vec2(1.0);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
        ivec2 c = ic + ivec2(i, j); uint n = rkH(c.x, c.y, seed);
        vec2 r = vec2(float(i), float(j)) + 0.15 + 0.7 * vec2(float(n & 0xffffu), float(n >> 16u)) / 65536.0 - f; float d = dot(r, r);
        if (d < d1){ d2 = d1; r2 = r1; c2 = c1; d1 = d; r1 = r; c1 = c; } else if (d < d2){ d2 = d; r2 = r; c2 = c; } }
      vec2 dr = r2 - r1; float dl = max(length(dr), 1e-4); o.e = (d2 - d1) / (2.0 * dl) * S; o.g = dr / dl;
      float yd = p.y + dip + S * 0.07 * sin(a.x * 3.3 + a.y * 2.1), t0, t1; vec2 tn;
      int li = rkLyr(c1, yd, H, seed, o.bt, o.bb);
      o.off = rkOff(c1, li, seed, o.tilt); o.offU = rkOff(c1, li + 1, seed, tn); o.offD = rkOff(c1, li - 1, seed, tn);
      o.offN = rkOff(c2, rkLyr(c2, yd, H, seed, t0, t1), seed, tn);
      o.id = fract((o.off + o.tilt.x) * 5.37 + 0.5);
      return o; }
    // what one level of blocks does to the shading. gAcc: tangent-plane offset added to the normal; gCrack: joint line;
    // gAO: shade at the foot of a taller neighbour and under an overhanging bed; gStain: water running down from an overhang
    vec3 gAcc; float gCrack, gAO, gStain, gGroove;
    void rkShade(RkL b, vec3 n0, float A, float T, float wb0, float wc0, float fw, float S, float H, float kTop, float wgt, float kc){
      float lod = 1.0 - smoothstep(S * 0.06, S * 0.22, fw);                     // blocks fade out before they are a few pixels wide: lit and shaded ribs that fine turn into pinstripes
      float wb = max(wb0, fw * 1.2), wc = max(wc0, fw * 0.7);                   // a step or a crack is never drawn thinner than a pixel
      vec3 tl = vec3(b.tilt.x, 0.0, b.tilt.y) * T; gAcc -= (tl - n0 * dot(tl, n0)) * lod;
      vec3 g3 = vec3(b.g.x, 0.0, b.g.y); g3 -= n0 * dot(g3, n0);
      vec3 up = vec3(0.0, 1.0, 0.0) - n0 * n0.y;
      float dv = A * (b.off - b.offN), dU = A * (b.off - b.offU), dD = A * (b.off - b.offD), k = 0.5 / wb;
      float bn = 1.0 - smoothstep(wb * 0.55, wb, b.e), bT = 1.0 - smoothstep(wb * 0.55, wb, b.bt), bB = 1.0 - smoothstep(wb * 0.55, wb, b.bb);
      float gt = smoothstep(0.30, 0.70, length(g3));                                // a joint lying nearly in the face makes no step or line on it
      // neighbours that sit nearly in one plane share a face, so the joint between them closes; and no two joints are one width
      float jf = smoothstep(0.03, 0.24, abs(b.off - b.offN)), jw = 0.55 + 1.1 * fract((b.off + b.offN) * 7.31 + 0.3);
      float jU = smoothstep(0.03, 0.24, abs(b.off - b.offU)), jD = smoothstep(0.03, 0.24, abs(b.off - b.offD));
      gAcc += (g3 * clamp(dv * k, -kc, kc) * bn * kTop * gt + up * (clamp(dU * k, -1.0, kc) * bT - clamp(dD * k, -kc, 1.0) * bB)) * lod;      // an underside turns down 45 degrees at most: shade, not a black slot
      float rb = max(1.0 - b.e / (S * 0.42), 0.0);                                  // column faces bulge between their joints: runnelled ribs
      gAcc += g3 * rb * rb * 0.55 * kTop * gt * lod * (0.35 + 0.65 * jf); gGroove += exp(-b.e / (S * 0.085)) * kTop * gt * lod * wgt * (0.25 + 0.75 * jf);
      float cj = (1.0 - smoothstep(0.0, wc * jw, b.e)) * kTop * gt * jf;
      float cb = (1.0 - smoothstep(0.0, wc, b.bt)) * jU + (1.0 - smoothstep(0.0, wc, b.bb)) * jD;
      gCrack = max(gCrack, min(cj + cb, 1.0) * (wc0 / wc) * lod * wgt);
      float ov = clamp(-dU / A, 0.0, 1.0), lw = clamp(-dv / A, 0.0, 1.6);
      gAO += (0.6 * lw * exp(-b.e / (S * 0.10 + 0.5 * abs(dv))) * kTop * gt + 0.8 * ov * exp(-b.bt / (H * 0.04 + 0.6 * abs(dU))) + clamp(dD / A, 0.0, 1.6) * exp(-b.bb / (H * 0.02 + 0.3 * abs(dD)))) * lod * wgt;
      gStain += ov * exp(-b.bt / (H * 0.42)) * lod * wgt;
    }`;
  // ---------- mesh displacement in undisplaced space, so neighbouring pieces agree. Leaves the smooth part in dMac ----------
  let dMac = 0;
  function disp(x, y, z, amp, o) {
    const big = NZ.ridged(x * 0.014 + 3, y * 0.009, z * 0.014, 3), s0 = o.s0 || 1, dip = dipF(x, z);
    dMac = amp * (big - 0.45) * 0.8 + blk(x, y, z, LV0, s0, amp * 0.62, 0.07, 2.6 * s0, dip);       // rounded buttresses and big setbacks
    let d = dMac;
    const ak = Math.min(1, amp / 1.9);
    if (o.l1 !== false) d += blk(x, y, z, LV1, 1, amp * (A1 / 1.9), T1 * ak, o.band ?? 0.35, dip);       // jointed blocks with hard steps
    if (o.l2) d += blk(x, y, z, LV2, 1, A2 * ak, T2 * ak, 0.14, dip);
    return d;
  }
  // monotonic remap s -> u that spends mesh rows where den() is high
  function remap(den, n = 256) {
    const c = new Float32Array(n + 1); for (let i = 0; i < n; i++) c[i + 1] = c[i] + den((i + 0.5) / n);
    const tot = c[n];
    return s => { const t = clamp(s) * tot; let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= t) lo = m; else hi = m; } return (lo + (t - c[lo]) / (c[lo + 1] - c[lo])) / n; };
  }
  // param surface -> displaced, coloured geometry. f(u,v,out) gives the base point
  function surf(nu, nv, f, o = {}) {
    const amp = o.amp ?? 2.4, wrapU = !!o.wrapU, W = nu + 1, N = W * (nv + 1), yk = o.yk ?? 0.35;
    const base = new Float32Array(N * 3), pos = new Float32Array(N * 3), posM = new Float32Array(N * 3), col = new Float32Array(N * 3), dsp = new Float32Array(N);
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { f(i / nu, j / nv, P); const k = (j * W + i) * 3; base[k] = P.x; base[k + 1] = P.y; base[k + 2] = P.z; }
    if (wrapU) for (let j = 0; j <= nv; j++) { const a = (j * W) * 3, b = (j * W + nu) * 3; base[b] = base[a]; base[b + 1] = base[a + 1]; base[b + 2] = base[a + 2]; }
    const A = new THREE.Vector3(), B = new THREE.Vector3(), Nn = new THREE.Vector3();
    const at = (i, j, out) => { if (wrapU) i = (i + nu) % nu; else i = clamp(i, 0, nu); j = clamp(j, 0, nv); const k = (j * W + i) * 3; return out.set(base[k], base[k + 1], base[k + 2]); };
    const C = new THREE.Vector3(), D = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      at(i + 1, j, A); at(i - 1, j, B); A.sub(B); at(i, j + 1, C); at(i, j - 1, D); C.sub(D);
      Nn.crossVectors(A, C); if (o.flip) Nn.negate(); const l = Nn.length(); if (l > 1e-9) Nn.multiplyScalar(1 / l); else Nn.set(0, 1, 0);
      const k = (j * W + i) * 3, x = base[k], y = base[k + 1], z = base[k + 2];
      let d = disp(x, y, z, amp, o), dm = dMac; if (o.mask) { const m = o.mask(i / nu, j / nv, x, y, z); d *= m; dm *= m; }
      if (o.bias) { const b = o.bias(i / nu, j / nv, x, y, z); d += b; dm += b; }
      dsp[j * W + i] = d;
      pos[k] = x + Nn.x * d; pos[k + 1] = y + Nn.y * d * yk; pos[k + 2] = z + Nn.z * d;
      posM[k] = x + Nn.x * dm; posM[k + 1] = y + Nn.y * dm * yk; posM[k + 2] = z + Nn.z * dm;
    }
    if (wrapU) for (let j = 0; j <= nv; j++) { const a = (j * W) * 3, b = (j * W + nu) * 3; for (let c = 0; c < 3; c++) { pos[b + c] = pos[a + c]; posM[b + c] = posM[a + c]; } }
    const idx = new Uint32Array(nu * nv * 6); let q = 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; if (o.flip) { idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; } else { idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c; } }
    const seam = nor => { if (wrapU) for (let j = 0; j <= nv; j++) { const a = (j * W) * 3, b = (j * W + nu) * 3; for (let c = 0; c < 3; c++) { const s = nor[a + c] + nor[b + c]; nor[a + c] = nor[b + c] = s; } const l = Math.hypot(nor[a], nor[a + 1], nor[a + 2]) || 1; for (let c = 0; c < 3; c++) { nor[a + c] /= l; nor[b + c] /= l; } } };
    // true normals of the stepped mesh: where plants stand and where moss settles
    const g = new THREE.BufferGeometry(), ia = new THREE.BufferAttribute(idx, 1); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(ia); g.computeVertexNormals();
    const nor = g.attributes.normal.array; seam(nor);
    for (let n = 0; n < N; n++) {
      const k = n * 3, x = pos[k], y = pos[k + 1], z = pos[k + 2], ny = nor[k + 1];
      const cav = clamp(0.5 + dsp[n] / (amp * 1.6 + 0.6) * 0.9);
      const mossN = NZ.fbm(x * 0.07, y * 0.07, z * 0.07, 2);
      col[k] = cav; col[k + 1] = clamp(sm(0.42, 0.80, ny + mossN * 0.45)); col[k + 2] = clamp(0.5 + NZ.n3(x * 0.03 + 5, y * 0.03, z * 0.03) * 0.9);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aB', new THREE.BufferAttribute(base, 3));
    const id = nPiece++; if (o.ld !== false) ldAdd(pos, W, nu, nv, wrapU, id);
    if (o.site !== false) pend.push({ g, tag: o.tag || 'rock', n: o.siteN ?? 400, byArea: o.siteArea, id });      // sampled in build(), once every piece is known
    // shading normals: the smooth form only. The shader lays the block facets on top of these, per pixel
    const gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.BufferAttribute(posM, 3)); gm.setIndex(ia); gm.computeVertexNormals();
    const nm = gm.attributes.normal.array; seam(nm); g.setAttribute('aN', new THREE.BufferAttribute(nor.slice(), 3)); nor.set(nm); gm.dispose();     // aN keeps the true normal: detail maps are projected along it
    g.userData.ord = o.ord ?? 5; geos.push(g); return g;
  }
  // ---------- which rock lies over which: every near piece rasterised into vertical columns, for planting ----------
  // Sites are sampled piece by piece, and the pieces run through one another (a terrace block sits in the valley wall,
  // the spires stand in the gate plateau), so a sample can lie inside a neighbour: its tree would hang on the neighbour's
  // face with the trunk buried. LD keeps, for columns 0.5 m apart, the heights at which each piece's skin crosses the
  // column (every second mesh row and column is enough for this). A point is inside a piece when an odd number of that
  // piece's crossings lie above it.
  const LX0 = -100.0371, LZ0 = -190.0113, LC = 0.5, LNX = 400, LNZ = 620;
  const LD = { n: 0, col: new Int32Array(1 << 18), y: new Float32Array(1 << 18), id: new Uint8Array(1 << 18), start: null, sy: null, sid: null };
  let nPiece = 0, nomSites = 0, nLow = 0; const pend = [];
  function ldTri(ax, ay, az, bx, by, bz, cx, cy, cz, id) {
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - LX0) / LC - 0.5)), i1 = Math.min(LNX - 1, Math.floor((Math.max(ax, bx, cx) - LX0) / LC - 0.5)); if (i0 > i1) return;
    const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - LZ0) / LC - 0.5)), j1 = Math.min(LNZ - 1, Math.floor((Math.max(az, bz, cz) - LZ0) / LC - 0.5)); if (j0 > j1) return;
    const ux = bx - ax, uz = bz - az, vx = cx - ax, vz = cz - az, det = ux * vz - vx * uz; if (Math.abs(det) < 1e-9) return;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = LX0 + (i + 0.5) * LC - ax, pz = LZ0 + (j + 0.5) * LC - az, u = (px * vz - vx * pz) / det, v = (ux * pz - px * uz) / det;
      if (u < 0 || v < 0 || u + v > 1) continue;
      if (LD.n === LD.col.length) { const m = LD.n * 2, c = new Int32Array(m), yy = new Float32Array(m), ii = new Uint8Array(m); c.set(LD.col); yy.set(LD.y); ii.set(LD.id); LD.col = c; LD.y = yy; LD.id = ii; }
      LD.col[LD.n] = j * LNX + i; LD.y[LD.n] = ay + u * (by - ay) + v * (cy - ay); LD.id[LD.n++] = id;
    }
  }
  function ldAdd(pos, W, nu, nv, wrapU, id) {
    const t = (a, b, c) => { a *= 3; b *= 3; c *= 3; ldTri(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], pos[c], pos[c + 1], pos[c + 2], id); };
    for (let j = 0; j < nv; j += 2) { const j2 = Math.min(j + 2, nv); for (let i = 0; i < nu; i += 2) { const i2 = Math.min(i + 2, nu), a = j * W + i, b = j * W + i2, c = j2 * W + i, d = j2 * W + i2; t(a, b, c); t(b, d, c); } }
    if (wrapU) for (const j of [0, nv]) {                    // close both ends of a tube, so a terrace block or a spire is a solid
      let mx = 0, my = 0, mz = 0; for (let i = 0; i < nu; i++) { const k = (j * W + i) * 3; mx += pos[k]; my += pos[k + 1]; mz += pos[k + 2]; } mx /= nu; my /= nu; mz /= nu;
      for (let i = 0; i < nu; i += 2) { const a = (j * W + i) * 3, b = (j * W + Math.min(i + 2, nu)) * 3; ldTri(pos[a], pos[a + 1], pos[a + 2], pos[b], pos[b + 1], pos[b + 2], mx, my, mz, id); }
    }
  }
  function ldSort() {
    const nc = LNX * LNZ, st = new Uint32Array(nc + 1), n = LD.n; for (let q = 0; q < n; q++) st[LD.col[q] + 1]++;
    for (let k = 0; k < nc; k++) st[k + 1] += st[k];
    const fill = st.slice(0, nc), sy = new Float32Array(n), sid = new Uint8Array(n);
    for (let q = 0; q < n; q++) { const d = fill[LD.col[q]]++; sy[d] = LD.y[q]; sid[d] = LD.id[q]; }
    LD.start = st; LD.sy = sy; LD.sid = sid; LD.col = LD.y = LD.id = null;
  }
  const par = new Uint8Array(256);
  // true when the point lies inside a piece other than `self`, or has another piece's rock less than `roof` metres overhead
  function under(x, y, z, self, roof) {
    const i = Math.floor((x - LX0) / LC), j = Math.floor((z - LZ0) / LC); if (i < 0 || j < 0 || i >= LNX || j >= LNZ) return false;
    const k = j * LNX + i, a = LD.start[k], b = LD.start[k + 1]; let hit = false;
    for (let q = a; q < b; q++) { const p = LD.sid[q]; if (p === self) continue; const dy = LD.sy[q] - y; if (dy > 0) { par[p] ^= 1; if (dy < roof) hit = true; } }
    for (let q = a; q < b; q++) { const p = LD.sid[q]; if (par[p]) { hit = true; par[p] = 0; } }
    return hit;
  }
  // A planting site is no good when it is inside another piece, when another piece's rock hangs within a tree's height
  // above it, when it stands so close to another piece's face that a trunk would grow into it, or when another piece
  // stands within a few metres between it and the lens at trunk height: then only the crown would show, as pads hanging
  // beside that piece's cliff
  const LENS = [-3.5, 72.5];                                 // x, z of the film camera, mid-film
  function buried(p, self) {
    if (under(p.x, p.y + 0.3, p.z, self, 8) || under(p.x + 1.2, p.y + 2.5, p.z, self, 0) || under(p.x - 1.2, p.y + 2.5, p.z, self, 0) || under(p.x, p.y + 2.5, p.z + 1.2, self, 0) || under(p.x, p.y + 2.5, p.z - 1.2, self, 0)) return true;
    let dx = LENS[0] - p.x, dz = LENS[1] - p.z; const k = 1 / (Math.hypot(dx, dz) || 1); dx *= k; dz *= k;
    return under(p.x + dx * 2.4, p.y + 2.5, p.z + dz * 2.4, self, 0) || under(p.x + dx * 3.8, p.y + 2.5, p.z + dz * 3.8, self, 0) || under(p.x + dx * 5.2, p.y + 2.5, p.z + dz * 5.2, self, 0);
  }
  // ---------- sight lines: no tall tree between the lens and what the film is about ----------
  // The film camera hardly moves, so a maple that takes root on a terrace rim between the lens and a hall hides that hall
  // for the whole film, and flora chooses among the sites at random. A site inside one of these cones stays, but is made
  // to lean (n.y 0.58): shrubs and grass still take it, no tree does (40_flora.js plants trees on n.y above 0.6, cliff pines below 0.55).
  const EYES = [[-5.5, 8, 81], [-1.5, 13.2, 64]];                                      // the lens at the start and at the end of the film
  const SIGHTS = [[-26.5, 30, -5, 7], [32, 25, 6, 8.5], [0, 27, -17, 12], [0, 11, -8, 5.5], [-9.5, 12, -9, 3], [-15.5, 9, 29, 4]];   // left hall, right hall, gate, falls, isle pavilion: x, y, z, radius
  function inSight(p) {
    for (const e of EYES) {
      const ax = p.x - e[0], ay = p.y + 4.5 - e[1], az = p.z - e[2], da = Math.hypot(ax, ay, az);          // a tree is about 9 m of trunk and crown above its site
      for (const t of SIGHTS) {
        const bx = t[0] - e[0], by = t[1] - e[1], bz = t[2] - e[2], db = Math.hypot(bx, by, bz); if (da > db - t[3]) continue;
        if (Math.acos(clamp((ax * bx + ay * by + az * bz) / (da * db), -1, 1)) < Math.atan(2.2 / da) + Math.atan(t[3] / db)) return true;
      }
    }
    return false;
  }
  // random surface samples with normals for planting. byArea: uniform over the surface even where the mesh is denser.
  // A buried sample is drawn again from a second stream, so every other site stays exactly where it was
  function collect(g, tag, n, byArea, id) {
    const pos = g.attributes.position.array, nor = g.attributes.aN.array, idx = g.index.array, r = rng(nomSites * 7 + 13), r2 = rng(nomSites * 31 + 977), nt = idx.length / 3;
    nomSites += n;
    let cum = null, moved = 0;
    if (byArea) { cum = new Float32Array(nt + 1); for (let t = 0; t < nt; t++) { const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3, ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2]; cum[t + 1] = cum[t] + Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); } }
    const draw = (r, s) => {
      let t = (r() * nt) | 0;
      if (cum) { const x = r() * cum[nt]; let lo = 0, hi = nt; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= x) lo = m; else hi = m; } t = lo; }
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3; let u = r(), v = r(); if (u + v > 1) { u = 1 - u; v = 1 - v; } const w = 1 - u - v;
      s.p.set(pos[a] * w + pos[b] * u + pos[c] * v, pos[a + 1] * w + pos[b + 1] * u + pos[c + 1] * v, pos[a + 2] * w + pos[b + 2] * u + pos[c + 2] * v);
      s.n.set(nor[a] * w + nor[b] * u + nor[c] * v, nor[a + 1] * w + nor[b + 1] * u + nor[c + 1] * v, nor[a + 2] * w + nor[b + 2] * u + nor[c + 2] * v).normalize(); s.r = r();
    };
    for (let k = 0; k < n; k++) {
      const s = { tag, p: new THREE.Vector3(), n: new THREE.Vector3(), r: 0 }; draw(r, s);
      let tries = 0; while (buried(s.p, id) && ++tries <= 30) draw(r2, s);
      if (tries > 30) continue;                              // a piece that is buried nearly everywhere gives fewer sites
      if (tries) moved++;
      if (s.n.y > 0.58 && inSight(s.p)) { const h = Math.hypot(s.n.x, s.n.z), c = 0.8146; if (h > 1e-4) s.n.set(s.n.x / h * c, 0.58, s.n.z / h * c); else s.n.set(c, 0.58, 0); nLow++; }
      sites.push(s);
    }
    return moved;
  }
  // ---- pieces ----
  function spire(cx, cz, y0, y1, r0, r1, seed, nu, nv, o = {}) {
    const lean = o.lean || [0, 0], crown = o.crown ?? r1 * 0.55;
    return surf(nu, nv, (u, v, out) => {
      const th = u * TAU, cap = 0.90, h = Math.min(v / cap, 1), y = lerp(y0, y1, h);
      const c = Math.cos(th), s = Math.sin(th);
      // stepped pillar: shoulders drop away in a few setbacks, deeper on one side than the other
      let r = lerp(r0, r1, Math.pow(h, 0.7)) * (1 + 0.30 * Math.pow(1 - h, 6));
      for (let k = 0; k < 4; k++) { const hk = 0.30 + 0.17 * k + 0.07 * NZ.n3(seed * 3.1 + k, c * 0.8, s * 0.8); r *= 1 - (0.085 + 0.07 * NZ.n3(seed * 5.3 + k * 2.7, c * 1.1, s * 1.1)) * sm(hk - 0.008, hk + 0.008, h); }
      // angular plan: soft polygon that turns slowly with height
      const sides = 5 + ((seed * 7) | 0) % 3, pa = th * sides + seed * 9 + y * 0.012; r *= 1 - 0.07 * Math.pow(Math.abs(Math.sin(pa * 0.5)), 0.7) + 0.035;
      r *= 1 + 0.16 * NZ.n3(c * 1.2 + seed, y * 0.014, s * 1.2) + 0.08 * NZ.n3(c * 2.9 + seed, y * 0.04, s * 2.9 + 4);
      const ax = cx + lean[0] * h * h + NZ.n3(seed, y * 0.012, 3) * 3.0 * h, az = cz + lean[1] * h * h + NZ.n3(seed + 9, y * 0.012, 7) * 3.0 * h;
      let yy = y;
      if (v > cap) {
        // crown: the columns end at different heights, so the summit is a cluster of flat-topped stubs, not a dome
        const k = (v - cap) / (1 - cap); r *= 1 - k; const px = ax + c * r, pz = az + s * r;
        const dp = dipF(px, pz), cw = 0.7 * blk(px, y1, pz, LV1, 1, 1, 0, 0.18, dp) + 0.3 * blk(px, y1, pz, LV0, 0.5, 1, 0, 0.5, dp);
        yy = y1 + crown * (cw * 0.92 + 0.08) * sm(0, 0.10, k);
      }
      out.set(ax + c * r, yy, az + s * r);
    }, { ord: o.ord ?? 3, wrapU: true, flip: true, amp: o.amp ?? 1.9, tag: o.tag || 'spire', siteN: o.siteN ?? 500, site: o.site, ld: o.ld, l1: o.l1, l2: o.l2, s0: o.s0, band: o.band });
  }
  // wall following a ground polyline; receding terraces with height. side = +1 faces +x-ish (left wall), -1 faces -x
  function wall(path, y0, y1, nu, nv, o = {}) {
    const pts = path.map(p => new THREE.Vector2(p[0], p[1])), curve = new THREE.SplineCurve(pts), t2 = new THREE.Vector2(), tg = new THREE.Vector2();
    const lean = o.lean ?? 0.20, side = o.side ?? 1;
    const um = remap(o.uDen || (() => 1)), vm = remap(o.vDen || (() => 1));
    return surf(nu, nv, (su, sv, out) => {
      const u = um(su), v = vm(sv);
      curve.getPoint(u, t2); curve.getTangent(u, tg); const nx = -tg.y * side, nz = tg.x * side;      // outward (toward valley)
      const y1v = o.top ? o.top(u) : y1, y = lerp(y0, y1v, v), h = y - y0;
      let back = h * lean + 7.0 * sm(0.30, 0.38, v + 0.05 * NZ.n3(u * 9, 2, 0)) + 9.0 * sm(0.58, 0.66, v + 0.05 * NZ.n3(u * 7, 5, 0)) + 14 * sm(0.86, 1.0, v);
      back += 6 * NZ.n3(u * 3.1 + (o.seed || 0), v * 2.2, 1.7) + (o.bulge ? o.bulge(u, v) : 0);
      out.set(t2.x - nx * back, y, t2.y - nz * back);
    }, { ord: 2, flip: side < 0 ? !o.rev : !!o.rev, amp: o.amp ?? 2.8, tag: o.tag || 'wall', siteN: o.siteN ?? 1400, siteArea: true, band: 0.5 });
  }
  // flat-topped rock mass (terrace / bank): squashed superellipsoid, top clamped to topY. ev < e makes the sides above the waist near-vertical
  function mass(cx, cy, cz, rx, ry, rz, topY, seed, nu = 90, nv = 60, o = {}) {
    return surf(nu, nv, (u, v, out) => {
      const th = u * TAU, ph = (v - 0.5) * Math.PI * 0.999, cp = Math.cos(ph), sp = Math.sin(ph), e = o.e ?? 0.5;
      const sx = Math.cos(th), sz = Math.sin(th), px = Math.sign(sx) * Math.pow(Math.abs(sx), e), pz = Math.sign(sz) * Math.pow(Math.abs(sz), e), pc = Math.pow(cp, sp > 0 ? (o.ev ?? e) : e);
      const k = 1 + 0.16 * NZ.n3(sx * 1.3 + seed, sp * 1.1, sz * 1.3);
      let y = cy + ry * Math.sign(sp) * Math.pow(Math.abs(sp), 0.8);
      if (y > topY) y = topY + (y - topY) * 0.04 + 0.5 * NZ.n3(px * rx * 0.1 + seed, 0, pz * rz * 0.1) * pc;
      out.set(cx + rx * px * pc * k, y, cz + rz * pz * pc * k);
    }, { ord: 0, wrapU: true, flip: true, amp: o.amp ?? 1.6, yk: 0.15, tag: o.tag || 'mass', siteN: o.siteN ?? 500, l1: o.l1, l2: o.l2, band: o.band, mask: (u, v, x, y) => y > topY - 0.6 ? 0.25 : 1, bias: o.rim ? (u, v, x, y) => o.rim * sm(topY - 3.2, topY - 0.9, y) : null });
  }

  let mat;
  function material() {
    mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, vertexColors: true });
    const DBG = +(Q.get('rk') || 0);                        // QA: &rk=1..4 fine weathering map r g b a, 5..8 cliff-scale map, 9 the rock's colour unlit, 10 the grain
    const L1 = `${f3(LV1.S)}, ${f3(LV1.H)}, ${LV1.seed}`, L2 = `${f3(LV2.S)}, ${f3(LV2.H)}, ${LV2.seed}`;
    patch(mat, s => {
      s.sh.uniforms.tRock = { value: Tex.rock }; s.sh.uniforms.tFlute = { value: Tex.flute }; s.sh.uniforms.tWea = { value: Tex.weath }; s.sh.uniforms.tWeaC = { value: Tex.weathC };
      s.vHead('attribute vec3 aB; attribute vec3 aN; varying vec3 vRW; varying vec3 vRN; varying vec3 vRC; varying vec3 vRB; varying vec3 vRT;');
      s.v('#include <begin_vertex>', '#include <begin_vertex>\n vRW = position; vRN = normal; vRC = color; vRB = aB; vRT = aN;');
      s.fHead(`varying vec3 vRW; varying vec3 vRN; varying vec3 vRC; varying vec3 vRB; varying vec3 vRT; uniform sampler2D tRock; uniform sampler2D tFlute; uniform sampler2D tWea; uniform sampler2D tWeaC; ${GLSL_NOISE} ${GLSL_BLOCKS}
        vec4 gTA, gTB, gWF, gWC, gGr; vec3 gNW;
        // The skin of the rock. Cliff faces take three maps laid up the face, with the beds following the dip: the bedded, runnelled
        // relief (8 m across, 13 m tall), the weathering that sits on those beds, and the weathering at cliff scale (40 m by 64 m).
        // Ground and ledge tops take the grain map at two fixed scales. Over everything lies a grain that keeps its size on the
        // screen: two octaves of the grain map picked by the pixel's footprint, so there are pits and chips a few pixels across
        // whether the face is 8 m from the lens or 200 m
        void triRock(vec3 p, vec3 n, vec3 nf, float fw, float dipW, float fl, float soft, float soft2){
          vec3 an = abs(n), bw = pow(an, vec3(6.0)); bw /= (bw.x + bw.y + bw.z);
          vec2 fs = vec2(0.123, 0.077), cs = vec2(0.0251, 0.0157); float yb = p.y + dipW;
          vec2 ux = vec2(p.z, yb), uz = vec2(p.x, yb);
          vec4 ax = texture2D(tFlute, ux * fs, 0.5), az = texture2D(tFlute, uz * fs + vec2(0.37, 0.0), 0.5), ay = texture2D(tRock, p.xz * 0.151);
          vec4 by = texture2D(tRock, p.xz * 0.53 + 0.3);
          vec2 bf = vec2(bw.x, bw.z) / (bw.x + bw.z + 1e-4);
          gWF = texture2D(tWea, ux * fs) * bf.x + texture2D(tWea, uz * fs + vec2(0.37, 0.0)) * bf.y;
          gWC = texture2D(tWeaC, ux * cs + vec2(0.11, 0.30)) * bf.x + texture2D(tWeaC, uz * cs + vec2(0.53, 0.30)) * bf.y;
          float lg = log2(max(fw, 0.003) * 88.0), k = floor(lg), f = lg - k, t0 = exp2(-k), l0 = 3.54 + f;
          vec2 gp; vec3 e1, e2;
          if (an.y > an.x && an.y > an.z) { gp = p.xz; e1 = vec3(1.0, 0.0, 0.0); e2 = vec3(0.0, 0.0, 1.0); } else if (an.x > an.z) { gp = p.zy; e1 = vec3(0.0, 0.0, 1.0); e2 = vec3(0.0, 1.0, 0.0); } else { gp = p.xy; e1 = vec3(1.0, 0.0, 0.0); e2 = vec3(0.0, 1.0, 0.0); }
          vec4 g0 = textureLod(tRock, gp * t0 + fract(vec2(0.618, 0.377) * k), l0), g1 = textureLod(tRock, gp * (t0 * 0.5) + fract(vec2(0.618, 0.377) * (k + 1.0)), l0 - 1.0);
          gGr = (mix(g0, g1, f) - vec4(0.5, 0.5, 0.47, 0.5)) * inversesqrt(f * f + (1.0 - f) * (1.0 - f));      // two patterns half and half would lose contrast
          vec2 dx = (ax.rg - 0.5) * vec2(2.0, 1.5) * fl, dy = (ay.rg - 0.5) * 2.0 * (1.0 - 0.7 * soft) + (by.rg - 0.5) * 1.6 * (1.0 - 0.25 * soft), dz = (az.rg - 0.5) * vec2(2.0, 1.5) * fl;
          vec3 gr = vec3(0.0, dx.y, dx.x) * bw.x + vec3(dy.x, 0.0, dy.y) * bw.y + vec3(dz.x, dz.y, 0.0) * bw.z + (e1 * gGr.r + e2 * gGr.g) * (2.3 * (1.0 - 0.75 * bw.y));
          gNW = normalize(nf - gr * (1.9 * soft2));
          gTA = ax * bw.x + ay * bw.y + az * bw.z; gTB = ax * bw.x + by * bw.y + az * bw.z;
        }
        // where falling water wets the rock: x, y of the lip, half width, z of the middle of the reach; and half the reach in z.
        // (the main fall leaves the sluice lip under the gate; the three side falls leave the terrace rims)
        const vec4 RK_FALLS[4] = vec4[4](vec4(0.0, ${f3(L.gateY - 3.1)}, 2.7, ${f3(L.gateZ + 7.5)}), vec4(-9.5, ${f3(L.gateY - 1.0)}, 0.8, ${f3(L.gateZ + 6)}), vec4(-27.3, ${f3(L.leftLedge.y - 1.5)}, 1.0, ${f3(L.leftLedge.z + 13)}), vec4(23.2, ${f3(L.rightTer.y - 1.5)}, 0.9, ${f3(L.rightTer.z + 19)}));
        const vec4 RK_FALLR = vec4(11.0, 8.0, 8.0, 9.0);
        // one fallen leaf per cell of a jittered grid: an ellipse lying its own way, in one of the maples' colours
        vec4 rkLeaf(vec2 q, float seed, float dens){ vec2 ci = floor(q), h = hash22(ci + seed), r = q - ci - 0.5 - (h - 0.5) * 0.56;
          float a = h.x * 12.566, c = cos(a), s = sin(a); vec2 v = vec2(r.x * c - r.y * s, r.x * s + r.y * c) * vec2(2.5, 4.3);
          float pick = fract(h.x * 9.7 + h.y * 3.1); vec3 lc = pick < 0.46 ? vec3(0.46, 0.040, 0.018) : pick < 0.80 ? vec3(0.58, 0.17, 0.022) : vec3(0.56, 0.36, 0.06);
          return vec4(lc * (0.50 + 0.75 * fract(h.y * 13.3)), (1.0 - smoothstep(0.55, 1.0, dot(v, v))) * step(1.0 - dens, h.y)); }`);
      s.f('#include <map_fragment>', `
        vec3 nW0 = normalize(vRN);
        float fw = max(length(dFdx(vRB)), length(dFdy(vRB)));
        gAcc = vec3(0.0); gCrack = 0.0; gAO = 0.0; gStain = 0.0; gGroove = 0.0;
        float kTop = 1.0 - 0.8 * smoothstep(0.70, 0.95, nW0.y);
        float dip = rkDip(vRB.xz), id1 = 0.5, id2 = 0.5;
        if (fw < ${f3(LV1.S * 0.5)}){ RkL b1 = rkLevel(vRB, dip, ${L1}); rkShade(b1, nW0, ${f3(A1)}, ${f3(T1 * 1.6)}, 0.24, 0.040, fw, ${f3(LV1.S)}, ${f3(LV1.H)}, kTop, 1.0, 2.6); id1 = b1.id; }
        if (fw < ${f3(LV2.S * 0.5)}){ RkL b2 = rkLevel(vRB, dip, ${L2}); rkShade(b2, nW0, ${f3(A2)}, ${f3(T2 * 1.35)}, 0.07, 0.020, fw, ${f3(LV2.S)}, ${f3(LV2.H)}, kTop, 0.6, 1.5); id2 = b2.id; }
        vec3 nF = normalize(nW0 + gAcc);
        // far off, or on a face seen edge-on, the runnels are a pixel wide: the map's own mip levels flatten them, and the relief is eased as well
        float fl = 1.0 - 0.45 * smoothstep(0.05, 0.16, fw), flat1 = abs(normalize(vRT).y);
        float cav = vRC.r, moss = vRC.g, vari = vRC.b;
        float topK = smoothstep(0.62, 0.92, nW0.y) * smoothstep(0.35, 0.80, moss);         // level ground that carries soil
        float face = 1.0 - smoothstep(0.3, 0.7, nW0.y);
        triRock(vRW, normalize(vRT), nF, fw, rkDip(vRW.xz), fl, topK, mix(0.62, 1.0, smoothstep(0.004, 0.016, fw)));      // a hand's width from the lens the grain would be embossed wallpaper
        float hA = gTA.b, cA = gTA.a, hB = gTB.b, cB = gTB.a;
        // limestone seen from across a valley: grey, blue-grey where it has stood in the weather longest, pale only where a slab
        // has come away or lichen has crusted it, rust and ochre where iron bleeds out of a bed
        float age = smoothstep(0.26, 0.70, mix(0.5, gWC.a, face) * 0.50 + vari * 0.34 + (id1 - 0.5) * 0.40 + (hA - 0.45) * 0.20);
        vec3 rock = mix(vec3(0.385, 0.385, 0.375), vec3(0.200, 0.220, 0.255), age);
        float och = clamp(gWC.g * (0.55 + 0.9 * (id2 - 0.2)) + gWF.g * 0.80, 0.0, 1.0) * face;
        rock = mix(rock, rock * vec3(1.36, 0.92, 0.56) + vec3(0.025, 0.006, 0.0), och * 0.55);
        float scar = clamp(max(gWC.b * smoothstep(0.40, 0.62, vari + (id1 - 0.5) * 0.5), gWF.b * 0.85), 0.0, 1.0) * face;
        rock = mix(rock, mix(vec3(0.56, 0.535, 0.47), vec3(0.40, 0.44, 0.33), smoothstep(0.45, 0.75, age) * step(gWC.b, 0.5)), scar * 0.80);
        rock *= (0.80 + 0.40 * id1) * (0.88 + 0.24 * id2);
        // relief of the skin: runnels, pits and joints fall dark, worn crests go pale; the screen-sized grain does the same a few pixels across
        rock *= mix(0.92, mix(0.40, 1.14, smoothstep(0.12, 0.62, cA * 0.60 + hA * 0.40)), mix(fl, 1.0, smoothstep(0.5, 0.8, flat1))) * mix(0.66, 1.06, cav);
        rock *= clamp(1.0 + gGr.a * 2.1 + gGr.b * 0.9, 0.36, 1.5);
        // water: blue-black stain. Short runs below every bed plane, curtains tens of metres long where a face has run with
        // water for centuries, thin runs under each overhanging block and drips below every rim that carries soil
        float cu = dot(vRW.xz, vec2(0.83, 0.55));
        float run = vnoise(vec2(cu * 1.9, vRW.y * 0.05)) * 0.75 + (1.0 - cA) * 0.25;
        float thin = vnoise(vec2(cu * 5.3 + 1.7, vRW.y * 0.09));
        float rimD = smoothstep(0.03, 0.40, moss) * (1.0 - smoothstep(0.55, 0.92, moss));
        float st = clamp(max(gWF.r * (0.60 + 0.55 * age), gWC.r * (0.50 + 0.70 * age) * (0.60 + 0.40 * thin))
          + 0.85 * gStain * smoothstep(0.34, 0.74, run * 0.45 + thin * 0.55 + (1.0 - hA) * 0.15)
          + 0.60 * rimD * smoothstep(0.30, 0.66, thin * 0.6 + run * 0.4), 0.0, 1.0);
        st = smoothstep(0.08, 0.62, st) * face * (1.0 - 0.75 * scar);
        rock = mix(rock, vec3(0.034, 0.041, 0.056) * (0.75 + 0.9 * cA), st * 0.90);
        float cbrk = 0.30 + 0.70 * smoothstep(0.34, 0.60, hA * 0.6 + 0.4 * (0.5 + gGr.b * 2.0));     // a joint opens and closes along its length
        // open joints, the foot of every step, and the underside of every overhanging bed: truly dark
        rock *= (1.0 - 0.66 * gCrack * cbrk) * (1.0 - 0.58 * clamp(gAO, 0.0, 1.0)) * (1.0 - 0.16 * min(gGroove, 1.0)) * mix(1.0, gWF.a, face);
        // the side of a tower turned from the sun sees only the dark half of the valley and the cold sky: deep blue-grey
        rock *= mix(vec3(0.50, 0.58, 0.76), vec3(1.0), max(smoothstep(-0.25, 0.50, dot(nW0, SUN_DIR)), 1.0 - face));
        vec2 mp = vRW.xz * 0.9 + vRW.y * 0.37; float mN = vnoise(mp) * 0.62 + vnoise(mp * 2.7 + 5.1) * 0.38;
        // ---- where the water is: the spray round each fall, and the lake's edge (the lake stands at y = 0.05)
        float wy = vRW.y - 0.05, wetK = 0.0, slime = 0.0;
        for (int i = 0; i < 4; i++) { vec4 f = RK_FALLS[i]; float dy = f.y - vRW.y, hw = f.z * 1.3 + 0.7 + (0.03 + 0.065 * f.z) * max(dy, 0.0);       // the stain is wider than the water and spreads on its way down
          wetK = max(wetK, (1.0 - smoothstep(hw * 0.72, hw * 1.30, abs(vRW.x - f.x) + hw * (0.55 * (thin - 0.5) + 0.35 * (run - 0.5)))) * smoothstep(-1.6, 2.6, dy + 2.0 * (thin - 0.5)) * (1.0 - smoothstep(RK_FALLR[i] * 0.7, RK_FALLR[i], abs(vRW.z - f.w)))); }
        float sprayK = wetK;                                                                            // the falls' share of the wet
        slime = wetK * smoothstep(0.26, 0.58, mN * 0.55 + (1.0 - hB) * 0.45) * 0.85;                   // black-green algae where it never dries
        rock = mix(rock, vec3(0.70, 0.68, 0.60), wetK * (1.0 - wetK) * 1.6 * smoothstep(0.62, 0.80, thin) * face);       // lime crust at the edge of the spray
        if (wy < 3.4) {
          float soak = 1.0 - smoothstep(0.20, 0.75 + 1.25 * mN, wy);                               // the splash line: wet and dark, its upper edge uneven
          float alg = (1.0 - smoothstep(0.05, 0.34 + 0.62 * mN, wy)) * smoothstep(-1.6, -0.2, wy);  // slime at the waterline; deeper down the stones are silted and pale again
          float ring = exp(-pow((wy - 0.95 - 1.25 * mN) / 0.12, 2.0));                              // the dried lime line of the spring level
          rock = mix(rock, vec3(0.66, 0.64, 0.57), ring * 0.34 * face);
          rock = mix(rock, rock * vec3(0.62, 0.74, 0.66), smoothstep(0.0, -0.6, wy) * 0.8);
          wetK = max(wetK, soak * 0.92); slime = max(slime, alg * 0.9);
        }
        rock = mix(rock, vec3(0.026, 0.044, 0.024) * (0.6 + 0.9 * hB), slime * 0.82);
        // ---- what lies on the rock where anything can settle: soil in the hollows, moss cushions, drifts of fallen leaves, and
        //      here and there the bare limestone showing through. Moss also takes the joints and the wet rock round the water
        float mk = smoothstep(0.50, 0.72, gNW.y * 0.75 + moss * 0.45 + (mN - 0.5) * 0.5 + (hB - 0.5) * 0.25 + gCrack * 0.10 * face + wetK * 0.22 * (1.0 - face * 0.5));
        mk = max(mk, 0.9 * sprayK * smoothstep(0.50, 0.68, (1.0 - mN) * 0.45 + hB * 0.30 + gNW.y * 0.40));       // in the spray every bump and ledge carries a green cushion
        float litK = 0.0;
        if (mk > 0.004) {
          float gP = vnoise(vRW.xz * 0.21 + 11.0), gQ = vnoise(vRW.xz * 0.47 + 4.0);                   // patches a few metres across
          float soilK = smoothstep(0.40, 0.60, gP * 0.62 + (1.0 - hA) * 0.38) * topK;                  // bare earth in the hollows of level ground
          litK = smoothstep(0.46, 0.68, gQ * 0.62 + cB * 0.38);                                          // where the wind drops its leaves
          float slab = smoothstep(0.690, 0.725, hA * 0.72 + cA * 0.18 + gP * 0.10) * topK;             // limestone pavement breaking the surface
          vec3 mossC = mix(vec3(0.026, 0.074, 0.024), vec3(0.105, 0.175, 0.040), smoothstep(0.25, 0.75, hB * 0.6 + mN * 0.4)) * (0.55 + 0.85 * cB) * (1.0 - 0.45 * face * (1.0 - sprayK));   // cushions: dark in their pits, yellow-green on their crowns
          vec3 soil = mix(vec3(0.050, 0.032, 0.022), vec3(0.135, 0.090, 0.056), hB) * (0.45 + 0.95 * cB);
          vec3 grd = mix(mossC, soil, soilK * 0.88);
          grd = mix(grd, vec3(0.23, 0.070, 0.026) * (0.55 + 0.9 * cB), litK * 0.42);                    // seen from far, the leaf drifts are a russet tint
          rock = mix(rock, grd, mk * 0.94 * (1.0 - slab * 0.85));
        }
        float lfK = (1.0 - smoothstep(0.035, 0.10, fw)) * smoothstep(0.62, 0.86, gNW.y) * smoothstep(0.25, 0.9, wy) * (1.0 - 0.8 * face) * (1.0 - 0.7 * sprayK);
        if (lfK > 0.01) {                                                                          // close enough to tell one leaf from the next
          float dn = 0.07 + 0.50 * litK * mk + 0.10 * mk;
          vec4 l1 = rkLeaf(vRW.xz * 5.3, 17.0, dn), l2 = rkLeaf(vec2(vRW.x * 0.8 - vRW.z * 0.6, vRW.x * 0.6 + vRW.z * 0.8) * 7.1 + 3.3, 48.0, dn * 0.8);
          rock = mix(rock, l1.rgb, l1.a * lfK); rock = mix(rock, l2.rgb, l2.a * lfK);
        }
        float wet = max(0.40 * smoothstep(3.0, 0.3, wy), wetK);
        rock *= mix(vec3(1.0), vec3(0.40, 0.42, 0.44), wet);                                                  // wet stone is darker and loses its dusty warmth
        diffuseColor.rgb = rock;
        ${DBG ? `vec3 rkDbg = ${['', 'gWF.rrr', 'gWF.ggg', 'gWF.bbb', 'gWF.aaa', 'gWC.rrr', 'gWC.ggg', 'gWC.bbb', 'gWC.aaa', 'rock * 2.0', 'vec3(0.5) + gGr.aaa', 'vec3(st)', 'vec3(scar)', 'vec3(age)', 'vec3(och)'][DBG]} * 0.45; diffuseColor.rgb = vec3(0.0);` : ''}`);
      if (DBG) s.f('#include <emissivemap_fragment>', 'totalEmissiveRadiance = rkDbg;');
      s.f('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gNW, 0.0)).xyz);');
      s.f('#include <color_fragment>', '');
      s.f('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n material.specularColor *= mix(0.25, 1.0, wet); material.specularF90 = mix(0.20, 1.0, wet);');      // dry weathered stone has no sheen: its dark stains stay dark
      s.f('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.95 - 0.12 * cB, 0.36, wet * (1.0 - 0.85 * mk) * (1.0 - 0.5 * slime));');      // wet stone shines, wet moss does not
    }, 'rock');
    return mat;
  }

  // world layout (metres). Valley runs along -z; camera travels from z=80 to z=47 looking at -z.
  const L = {
    main: { x: 10, z: -66, top: 102, r0: 12.5, r1: 5.8 },      // the dragon's spire
    gateY: 21.5, gateZ: -14, leftLedge: { x: -27, y: 25, z: -5 }, rightTer: { x: 33, y: 19, z: 8 },
    bankY: 6.0,
  };
  async function build(scene, prog, tick) {
    material();
    const S = L.main;
    spire(S.x, S.z, -6, S.top, S.r0, S.r1, 1.3, 290, 390, { siteN: 4500, tag: 'main', lean: [-2, 3], l2: true, crown: 1.9, ord: 4 }); prog(0.12); await tick();
    spire(-18, -54, -6, 72, 9.0, 4.4, 5.1, 180, 270, { siteN: 2600, lean: [2, -2], l2: true });
    spire(-3, -41, -6, 45, 5.2, 2.7, 9.4, 130, 190, { siteN: 1500, l2: true });
    spire(39, -80, -6, 86, 11.5, 5.2, 14.2, 160, 240, { siteN: 2400, lean: [3, 0] });
    spire(-45, -96, -6, 120, 14, 6.2, 21.7, 150, 230, { siteN: 2400 }); prog(0.3); await tick();
    // far, hazy peaks: too coarse a mesh for single blocks, so only the big buttresses, scaled up
    const fr = rng(77);
    for (let i = 0; i < 14; i++) { const a = lerp(-1.15, 1.15, (i + fr() * 0.7) / 14), d = 230 + fr() * 420; spire(Math.sin(a) * d, -Math.cos(a) * d - 40, -8, 70 + fr() * 150, 16 + fr() * 22, 6 + fr() * 6, 30 + i * 3.3, 56, 80, { site: false, ld: false, amp: 3.5, l1: false, s0: 2.2, ord: 6 }); }
    prog(0.4); await tick();
    // valley walls: the mesh is finest low down and beside the lens
    const vDen = v => 1 + 1.6 * Math.exp(-(v / 0.30) * (v / 0.30));
    wall([[-21, 112], [-23, 70], [-27, 30], [-36, -8], [-44, -50], [-62, -110], [-80, -180]], -5, 150, 470, 260, { side: 1, seed: 2.2, siteN: 12000, tag: 'wallL', vDen, uDen: u => 1 + 1.7 * Math.exp(-Math.pow((u - 0.22) / 0.15, 2)) }); prog(0.6); await tick();
    wall([[26, 112], [30, 74], [43, 36], [54, 4], [58, -40], [70, -100], [90, -180]], -5, 132, 390, 220, { side: -1, seed: 8.8, siteN: 9000, tag: 'wallR', vDen, uDen: u => 1 + 1.3 * Math.exp(-Math.pow((u - 0.24) / 0.16, 2)), top: u => lerp(30, 98, sm(0.18, 0.66, u)) + 10 * NZ.n3(u * 6, 1, 2) }); prog(0.75); await tick();
    // gate terrace: cliff across the valley + plateau behind it, notched for the waterfall
    surf(300, 170, (u, v, out) => {
      const x = lerp(-52, 60, u), face = 0.52, notch = Math.exp(-(x * x) / 26), zf = L.gateZ + 10 - 0.004 * x * x + 4.2 * NZ.n3(x * 0.05, 1, 4) - notch * 5.5;
      if (v < face) { const h = v / face; out.set(x, lerp(-5, L.gateY - notch * 1.0, Math.pow(h, 0.9)), zf - h * 3.2 - 2.4 * sm(0.4, 0.5, h)); }
      else { const k = (v - face) / (1 - face); out.set(x, L.gateY - notch * 1.0 * (1 - k * 3 > 0 ? 1 : 0) + 0.6 * NZ.n3(x * 0.08, 3, k * 5) + 5 * sm(0.55, 1, k), zf - 5.6 - k * 62); }
    }, { ord: 1, amp: 2.0, flip: false, tag: 'gate', siteN: 5000, mask: (u, v, x) => v > 0.52 ? 0.3 : 1 - 0.7 * Math.exp(-x * x / 200) * sm(0.30, 0.46, v), bias: (u, v, x) => v > 0.52 ? 0 : 0.9 * Math.exp(-x * x / 200) * sm(0.30, 0.46, v) - 1.5 * Math.exp(-Math.pow((x + 9.5) / 1.5, 2)) * sm(0.10, 0.30, v) * (1 - sm(0.40, 0.47, v)) }); prog(0.85); await tick();
    // terraces and banks
    mass(L.leftLedge.x, 12, L.leftLedge.z, 15, 14, 15, L.leftLedge.y, 3.1, 240, 120, { tag: 'ledgeL', siteN: 1600, ev: 0.26, amp: 2.3, l2: true });
    mass(L.rightTer.x, 8, L.rightTer.z, 22, 12, 24, L.rightTer.y, 6.7, 240, 110, { tag: 'terR', siteN: 2600, ev: 0.30, amp: 2.1 });
    mass(-14, -1, 88, 24, 8, 21, L.bankY, 11.9, 170, 90, { tag: 'bank', siteN: 3600, amp: 1.0 });
    mass(-15.5, 0, 29, 6.5, 6.5, 6.5, 5.4, 15.2, 90, 56, { tag: 'isle', siteN: 500, amp: 0.45, l2: true, rim: 0.55 });
    mass(30, -1, 46, 9, 7, 10, 4.2, 19.5, 90, 56, { tag: 'root', siteN: 800, amp: 1.1 });
    mass(9.5, -4, 39, 6.5, 5, 6.5, -1.4, 23.5, 60, 40, { tag: 'pad', siteN: 60, amp: 0.6, rim: 0.5 });
    const br = rng(5);
    for (let i = 0; i < 26; i++) { const x = lerp(-20, 24, br()), z = lerp(-18, 74, br()), s = 0.8 + br() * 2.4; mass(x, -0.6, z, s * 1.4, s, s * 1.2, 9, 40 + i, 26, 18, { site: false, amp: 0.5, e: 0.8 }); }
    prog(0.95); await tick();
    // planting sites, now that every piece is known
    ldSort(); let moved = 0; for (const p of pend) moved += collect(p.g, p.tag, p.n, p.byArea, p.id); pend.length = 0; LD.start = LD.sy = LD.sid = null; G.info.sitesMoved = moved; G.info.sitesLow = nLow;
    // The rock shader is the most expensive in the film. Nearest pieces go first in the index buffer and the mesh is drawn
    // after every other opaque object, so a rock pixel hidden by a tree, a hall or nearer rock fails the depth test unshaded
    geos.forEach((g, i) => { g.userData.i = i; }); geos.sort((a, b) => a.userData.ord - b.userData.ord || a.userData.i - b.userData.i);
    const all = mergeGeos(geos); const m = new THREE.Mesh(all, mat); m.castShadow = true; m.receiveShadow = true; m.renderOrder = 3; scene.add(m);
    G.info.rockTris = all.index.count / 3 | 0; geos.length = 0;
    prog(1);
  }
  return { build, sites, L, get mat() { return mat; } };
})();
