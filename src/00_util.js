'use strict';
// ---- shared helpers ------------------------------------------------------------------------------
const Q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const CAPTURE = Q.has('capture');
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2, rad = d => d * Math.PI / 180;
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// piecewise-smooth keyed curve: keys [[x,y],...] sorted by x
const keyed = ks => x => { if (x <= ks[0][0]) return ks[0][1]; for (let i = 1; i < ks.length; i++) if (x <= ks[i][0]) return lerp(ks[i - 1][1], ks[i][1], sm(ks[i - 1][0], ks[i][0], x)); return ks[ks.length - 1][1]; };
const keyedLin = ks => x => { if (x <= ks[0][0]) return ks[0][1]; for (let i = 1; i < ks.length; i++) if (x <= ks[i][0]) return lerp(ks[i - 1][1], ks[i][1], (x - ks[i - 1][0]) / (ks[i][0] - ks[i - 1][0])); return ks[ks.length - 1][1]; };
const pulse = (t, t0, att, rel) => t < t0 ? 0 : t < t0 + att ? sm(t0, t0 + att, t) : Math.exp(-(t - t0 - att) / rel);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---- CPU noise (improved Perlin 3D) ---------------------------------------------------------------
const NZ = (() => {
  const p = new Uint8Array(512), r = rng(20261112), perm = [];
  for (let i = 0; i < 256; i++) perm.push(i);
  for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0, t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => { h &= 15; const u = h < 8 ? x : y, v = h < 4 ? y : (h === 12 || h === 14) ? x : z; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
  function n3(x, y, z) {
    let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); x -= X; y -= Y; z -= Z; X &= 255; Y &= 255; Z &= 255;
    const u = fade(x), v = fade(y), w = fade(z), A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), l(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      l(l(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), l(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v), w);
  }
  const fbm = (x, y, z, o = 5, lac = 2.03, g = .5) => { let a = .5, s = 0, f = 1; for (let i = 0; i < o; i++) { s += a * n3(x * f, y * f, z * f); f *= lac; a *= g; } return s; };
  const ridged = (x, y, z, o = 5) => { let a = .5, s = 0, f = 1, w = 1; for (let i = 0; i < o; i++) { let n = 1 - Math.abs(n3(x * f, y * f, z * f)); n *= n; s += n * a * w; w = clamp(n * 1.6); f *= 2.11; a *= .5; } return s; };
  // cellular: returns random value of the nearest feature point (blocky regions), edge distance in cell.e
  const h3 = (i, j, k) => { let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const cell = { e: 0 };
  function blocks(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); let d1 = 9, d2 = 9, id = 0;
    for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const a = X + i, b = Y + j, c = Z + k, r = h3(a, b, c), dx = a + r - x, dy = b + h3(a + 17, b - 5, c + 3) - y, dz = c + h3(a - 9, b + 31, c + 11) - z, d = dx * dx + dy * dy + dz * dz;
      if (d < d1) { d2 = d1; d1 = d; id = r; } else if (d < d2) d2 = d;
    }
    cell.e = Math.sqrt(d2) - Math.sqrt(d1); return id;
  }
  return { n3, fbm, ridged, blocks, cell };
})();

// ---- geometry helpers ----------------------------------------------------------------------------
// merge an array of {geo, matrix?} BufferGeometries (same attribute sets) into one
function mergeGeos(list) {
  let nv = 0, ni = 0; const names = Object.keys(list[0].attributes);
  for (const g of list) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const out = new THREE.BufferGeometry(), arrs = {};
  for (const n of names) arrs[n] = new Float32Array(nv * list[0].attributes[n].itemSize);
  const idx = new Uint32Array(ni); let vo = 0, io = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    for (const n of names) { const a = g.attributes[n]; if (!a) throw new Error('mergeGeos: missing ' + n); arrs[n].set(a.array, vo * a.itemSize); }
    if (g.index) { const ia = g.index.array; for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo; io += ia.length; }
    else { for (let i = 0; i < c; i++) idx[io + i] = vo + i; io += c; }
    vo += c;
  }
  for (const n of names) out.setAttribute(n, new THREE.BufferAttribute(arrs[n], list[0].attributes[n].itemSize));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
// bake a transform into a geometry clone and add a constant vertex colour (+ optional extra attr fill)
function xf(geo, m, col) {
  const g = geo.clone(); if (m) g.applyMatrix4(m);
  if (col) { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
  return g;
}
const M4 = (px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
// tube along sampled points with per-point radius; returns non-indexed-safe indexed geometry with uv (u along, v around)
function tubeGeo(pts, radii, sides = 8, capEnd = true, upHint) {
  const n = pts.length, pos = new Float32Array(n * (sides + 1) * 3), nor = new Float32Array(n * (sides + 1) * 3), uv = new Float32Array(n * (sides + 1) * 2), idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), tmp = new THREE.Vector3(); let len = 0;
  N.copy(upHint || new THREE.Vector3(0.13, 0.2, 0.97));
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; T.subVectors(b, a).normalize();
    N.addScaledVector(T, -N.dot(T)); if (N.lengthSq() < 1e-8) N.set(1, 0, 0).addScaledVector(T, -T.x); N.normalize(); B.crossVectors(T, N);
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    const r = typeof radii === 'function' ? radii(i / (n - 1)) : radii[i];
    for (let j = 0; j <= sides; j++) {
      const th = j / sides * TAU, c = Math.cos(th), s = Math.sin(th), o = (i * (sides + 1) + j) * 3;
      tmp.set(0, 0, 0).addScaledVector(N, c).addScaledVector(B, s);
      nor[o] = tmp.x; nor[o + 1] = tmp.y; nor[o + 2] = tmp.z;
      pos[o] = pts[i].x + tmp.x * r; pos[o + 1] = pts[i].y + tmp.y * r; pos[o + 2] = pts[i].z + tmp.z * r;
      uv[(i * (sides + 1) + j) * 2] = len; uv[(i * (sides + 1) + j) * 2 + 1] = j / sides;
    }
    if (i < n - 1) for (let j = 0; j < sides; j++) { const p0 = i * (sides + 1) + j, p1 = p0 + sides + 1; idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1); }      // wound so each side face points the way its vertex normal does: outward
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); return g;
}
function fillAttr(g, name, size, vals) { const n = g.attributes.position.count, a = new Float32Array(n * size); for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) a[i * size + k] = vals[k]; g.setAttribute(name, new THREE.BufferAttribute(a, size)); return g; }
// world state shared by every module
const G = { t: 0, uTime: { value: 0 }, uGust: { value: 0 }, uWind: { value: 0 }, mats: [], tick: [], info: {} };
