'use strict';
// ---- signed-distance sculpting kit + surface-nets mesher (no three.js dependency) ------------------
const SD = (() => {
  const sq = Math.sqrt, ab = Math.abs, mx = Math.max, mn = Math.min;
  const smin = (a, b, k) => { const h = mx(k - ab(a - b), 0) / k; return mn(a, b) - h * h * k * .25; };
  const smax = (a, b, k) => -smin(-a, -b, k);
  const sph = (cx, cy, cz, r) => (x, y, z) => { x -= cx; y -= cy; z -= cz; return sq(x * x + y * y + z * z) - r; };
  const ell = (cx, cy, cz, rx, ry, rz) => {
    const a = 1 / (rx * rx), b = 1 / (ry * ry), c = 1 / (rz * rz), m = mn(rx, ry, rz);
    return (x, y, z) => { x -= cx; y -= cy; z -= cz; const k0 = sq(x * x * a + y * y * b + z * z * c), k1 = sq(x * x * a * a + y * y * b * b + z * z * c * c); return k1 < 1e-9 ? -m : k0 * (k0 - 1) / k1; };
  };
  // capsule with linearly varying radius
  const cone = (ax, ay, az, bx, by, bz, ra, rb = ra) => {
    const ux = bx - ax, uy = by - ay, uz = bz - az, il = 1 / (ux * ux + uy * uy + uz * uz + 1e-12);
    return (x, y, z) => { x -= ax; y -= ay; z -= az; let h = (x * ux + y * uy + z * uz) * il; h = h < 0 ? 0 : h > 1 ? 1 : h; x -= ux * h; y -= uy * h; z -= uz * h; return sq(x * x + y * y + z * z) - (ra + (rb - ra) * h); };
  };
  const box = (cx, cy, cz, hx, hy, hz, r = 0) => (x, y, z) => { const qx = ab(x - cx) - hx + r, qy = ab(y - cy) - hy + r, qz = ab(z - cz) - hz + r; const a = mx(qx, 0), b = mx(qy, 0), c = mx(qz, 0); return sq(a * a + b * b + c * c) + mn(mx(qx, qy, qz), 0) - r; };
  const U = (...f) => { const n = f.length; return (x, y, z) => { let d = f[0](x, y, z); for (let i = 1; i < n; i++) { const e = f[i](x, y, z); if (e < d) d = e; } return d; }; };
  const SU = (k, ...f) => { const n = f.length; return (x, y, z) => { let d = f[0](x, y, z); for (let i = 1; i < n; i++) d = smin(d, f[i](x, y, z), k); return d; }; };
  const SUB = (a, b, k = 0) => k ? (x, y, z) => smax(a(x, y, z), -b(x, y, z), k) : (x, y, z) => mx(a(x, y, z), -b(x, y, z));
  const INT = (a, b, k = 0) => k ? (x, y, z) => smax(a(x, y, z), b(x, y, z), k) : (x, y, z) => mx(a(x, y, z), b(x, y, z));
  const mirX = f => (x, y, z) => f(ab(x), y, z);
  const off = (f, d) => (x, y, z) => f(x, y, z) - d;
  const tr = (f, dx, dy, dz) => (x, y, z) => f(x - dx, y - dy, z - dz);
  // rotate a shape by Euler XYZ (radians) about a pivot
  const rot = (f, rx, ry, rz, px = 0, py = 0, pz = 0) => {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Rx*Ry*Rz ; we need R^T * p
    const m00 = cy * cz, m01 = -cy * sz, m02 = sy, m10 = cx * sz + sx * sy * cz, m11 = cx * cz - sx * sy * sz, m12 = -sx * cy, m20 = sx * sz - cx * sy * cz, m21 = sx * cz + cx * sy * sz, m22 = cx * cy;
    return (x, y, z) => { x -= px; y -= py; z -= pz; return f(m00 * x + m10 * y + m20 * z + px, m01 * x + m11 * y + m21 * z + py, m02 * x + m12 * y + m22 * z + pz); };
  };
  // skip an expensive shape when far outside its bounding sphere
  const bound = (f, cx, cy, cz, R, m = .22) => (x, y, z) => { const a = x - cx, b = y - cy, c = z - cz, d = sq(a * a + b * b + c * c) - R; return d > m ? d : f(x, y, z); };
  // tapered lock / spike along a quadratic bezier (exact curve distance, radius eased along it)
  const lock = (A, B, C, r0, r1, _n = 0, pw = 1) => {
    let bx = A[0] - 2 * B[0] + C[0], by = A[1] - 2 * B[1] + C[1], bz = A[2] - 2 * B[2] + C[2];
    if (bx * bx + by * by + bz * bz < 1e-5) { B = [B[0] + .01, B[1] + .013, B[2] + .007]; bx = A[0] - 2 * B[0] + C[0]; by = A[1] - 2 * B[1] + C[1]; bz = A[2] - 2 * B[2] + C[2]; }
    const ax = B[0] - A[0], ay = B[1] - A[1], az = B[2] - A[2], kk = 1 / (bx * bx + by * by + bz * bz), kx = kk * (ax * bx + ay * by + az * bz), aa2 = 2 * (ax * ax + ay * ay + az * az), cl = t => t < 0 ? 0 : t > 1 ? 1 : t;
    const rr = pw === 1 ? t => r0 + (r1 - r0) * t : t => r1 + (r0 - r1) * Math.pow(1 - t, pw);
    const f = (x, y, z) => {
      const dx = A[0] - x, dy = A[1] - y, dz = A[2] - z, ky = kk * (aa2 + dx * bx + dy * by + dz * bz) / 3, kz = kk * (dx * ax + dy * ay + dz * az);
      const p = ky - kx * kx, q = kx * (2 * kx * kx - 3 * ky) + kz; let h = q * q + 4 * p * p * p, t, d2;
      const ev = t => { const qx = dx + (2 * ax + bx * t) * t, qy = dy + (2 * ay + by * t) * t, qz = dz + (2 * az + bz * t) * t; return qx * qx + qy * qy + qz * qz; };
      if (h >= 0) { h = sq(h); t = cl(Math.cbrt((h - q) / 2) + Math.cbrt((-h - q) / 2) - kx); d2 = ev(t); }
      else { const zz = sq(-p), v = Math.acos(mx(-1, mn(1, q / (p * zz * 2)))) / 3, m = Math.cos(v), n = Math.sin(v) * 1.7320508, t1 = cl((m + m) * zz - kx), t2 = cl((-n - m) * zz - kx), e1 = ev(t1), e2 = ev(t2); if (e1 < e2) { t = t1; d2 = e1; } else { t = t2; d2 = e2; } }
      return sq(d2) - rr(t);
    };
    const cx = (A[0] + B[0] + C[0]) / 3, cy = (A[1] + B[1] + C[1]) / 3, cz = (A[2] + B[2] + C[2]) / 3; let R = 0;
    for (const P of [A, B, C]) R = mx(R, Math.hypot(P[0] - cx, P[1] - cy, P[2] - cz));
    return bound(f, cx, cy, cz, R + mx(r0, r1));
  };
  // first surface hit looking down -z from the front
  const zfront = (f, x, y, z0 = 2.2, zmin = -.2) => { let z = z0; for (let i = 0; i < 90; i++) { const d = f(x, y, z); if (d < 4e-4) return z; z -= mx(d * .85, 2e-4); if (z < zmin) return null; } return z; };
  // raised conforming part: 2-D outline g(x,y) pressed onto the front of `base`, top face h above it
  const piece = (base, g, h = .02, k = .012, zmin = .12, inner = .09) => (x, y, z) => { const b = base(x, y, z); return mx(smax(b - h, g(x, y), k), -(b + inner), zmin - z); };
  const pieceBB = (base, bb2, h, zmin = .12) => { let lo = 9, hi = -9; for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) { const z = zfront(base, lerp(bb2[0], bb2[2], i / 6), lerp(bb2[1], bb2[3], j / 6)); if (z !== null) { lo = mn(lo, z); hi = mx(hi, z); } } if (lo > hi) { lo = .3; hi = 1; } return [bb2[0], bb2[1], mx(zmin, lo - .1), bb2[2], bb2[3], hi + h + .03]; };

  // ---- mesher: naive surface nets with a coarse-block skip, Newton snap and gradient normals -------
  function mesh(f, bb, n) {
    const x0 = bb[0], y0 = bb[1], z0 = bb[2], h = mx(bb[3] - x0, bb[4] - y0, bb[5] - z0) / n;
    const nx = Math.ceil((bb[3] - x0) / h) + 2, ny = Math.ceil((bb[4] - y0) / h) + 2, nz = Math.ceil((bb[5] - z0) / h) + 2, nxy = nx * ny;
    const g = new Float32Array(nxy * nz).fill(NaN), ex = new Uint8Array(nxy * nz);
    const ST = 4, far = ST * h * .87 * 2 + h;
    for (let k0 = 0; k0 < nz - 1; k0 += ST) for (let j0 = 0; j0 < ny - 1; j0 += ST) for (let i0 = 0; i0 < nx - 1; i0 += ST) {
      const i1 = mn(i0 + ST, nx - 1), j1 = mn(j0 + ST, ny - 1), k1 = mn(k0 + ST, nz - 1);
      const d = f(x0 + (i0 + i1) * .5 * h, y0 + (j0 + j1) * .5 * h, z0 + (k0 + k1) * .5 * h), near = ab(d) <= far;
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) { let p = i0 + nx * j + nxy * k; for (let i = i0; i <= i1; i++, p++) { if (near) { if (!ex[p]) { g[p] = f(x0 + i * h, y0 + j * h, z0 + k * h); ex[p] = 1; } } else if (g[p] !== g[p]) g[p] = d; } }
    }
    const vi = new Int32Array(nxy * nz).fill(-1), P = [], I = [];
    const co = [0, 1, nx, nx + 1, nxy, nxy + 1, nxy + nx, nxy + nx + 1], cx_ = [0, 1, 0, 1, 0, 1, 0, 1], cy_ = [0, 0, 1, 1, 0, 0, 1, 1], cz_ = [0, 0, 0, 0, 1, 1, 1, 1];
    const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]], v = new Float64Array(8);
    for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const p = i + nx * j + nxy * k; let m = 0;
      for (let c = 0; c < 8; c++) { v[c] = g[p + co[c]]; if (v[c] < 0) m |= 1 << c; }
      if (m === 0 || m === 255) continue;
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (let e = 0; e < 12; e++) { const a = E[e][0], b = E[e][1]; if ((v[a] < 0) === (v[b] < 0)) continue; const t = v[a] / (v[a] - v[b]); sx += cx_[a] + (cx_[b] - cx_[a]) * t; sy += cy_[a] + (cy_[b] - cy_[a]) * t; sz += cz_[a] + (cz_[b] - cz_[a]) * t; cnt++; }
      vi[p] = P.length / 3; P.push(x0 + (i + sx / cnt) * h, y0 + (j + sy / cnt) * h, z0 + (k + sz / cnt) * h);
    }
    const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) I.push(a, d, c, a, c, b); else I.push(a, b, c, a, c, d); };
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
      const p = i + nx * j + nxy * k, a = g[p] < 0;
      if (a !== (g[p + 1] < 0)) quad(vi[p - nx - nxy], vi[p - nxy], vi[p], vi[p - nx], !a);
      if (a !== (g[p + nx] < 0)) quad(vi[p - 1 - nxy], vi[p - nxy], vi[p], vi[p - 1], a);
      if (a !== (g[p + nxy] < 0)) quad(vi[p - 1 - nx], vi[p - nx], vi[p], vi[p - 1], !a);
    }
    const pos = new Float32Array(P), nor = new Float32Array(P.length), e = h * .55;
    for (let q = 0; q < pos.length; q += 3) {
      let x = pos[q], y = pos[q + 1], z = pos[q + 2], gx = 0, gy = 0, gz = 1;
      for (let it = 0; it < 3; it++) {
        gx = f(x + e, y, z) - f(x - e, y, z); gy = f(x, y + e, z) - f(x, y - e, z); gz = f(x, y, z + e) - f(x, y, z - e);
        const l = sq(gx * gx + gy * gy + gz * gz) || 1; gx /= l; gy /= l; gz /= l;
        if (it === 2) break;
        const d = mx(-h, mn(h, f(x, y, z))); x -= gx * d; y -= gy * d; z -= gz * d;
      }
      pos[q] = x; pos[q + 1] = y; pos[q + 2] = z; nor[q] = gx; nor[q + 1] = gy; nor[q + 2] = gz;
    }
    return { pos, nor, idx: new Uint32Array(I) };
  }

  // ---- 2-D outlines (negative inside) ---------------------------------------------------------------
  const D2 = {
    circ: (cx, cy, r) => (x, y) => sq((x - cx) * (x - cx) + (y - cy) * (y - cy)) - r,
    ell: (cx, cy, rx, ry) => { const a = 1 / (rx * rx), b = 1 / (ry * ry), m = mn(rx, ry); return (x, y) => { x -= cx; y -= cy; const k0 = sq(x * x * a + y * y * b), k1 = sq(x * x * a * a + y * y * b * b); return k1 < 1e-9 ? -m : k0 * (k0 - 1) / k1; }; },
    box: (cx, cy, hx, hy, r = 0) => (x, y) => { const qx = ab(x - cx) - hx + r, qy = ab(y - cy) - hy + r, a = mx(qx, 0), b = mx(qy, 0); return sq(a * a + b * b) + mn(mx(qx, qy), 0) - r; },
    seg: (ax, ay, bx, by, ra, rb = ra) => { const ux = bx - ax, uy = by - ay, il = 1 / (ux * ux + uy * uy + 1e-12); return (x, y) => { x -= ax; y -= ay; let h = (x * ux + y * uy) * il; h = h < 0 ? 0 : h > 1 ? 1 : h; x -= ux * h; y -= uy * h; return sq(x * x + y * y) - (ra + (rb - ra) * h); }; },
    path: (pts, ra, rb = ra, mid) => { const fs = [], n = pts.length - 1; const r = t => mid === undefined ? ra + (rb - ra) * t : (t < .5 ? ra + (mid - ra) * (t * 2) : mid + (rb - mid) * (t * 2 - 1)); for (let i = 0; i < n; i++) fs.push(D2.seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r(i / n), r((i + 1) / n))); return D2.U(...fs); },
    bez: (p0, p1, p2, ra, rb = ra, mid, n = 12) => { const pts = []; for (let i = 0; i <= n; i++) { const t = i / n, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t; pts.push([a * p0[0] + b * p1[0] + c * p2[0], a * p0[1] + b * p1[1] + c * p2[1]]); } return D2.path(pts, ra, rb, mid); },
    arc: (cx, cy, R, a0, a1, ra, rb = ra, mid, n = 12) => { const pts = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); } return D2.path(pts, ra, rb, mid); },
    poly: (v, r = 0) => (x, y) => { let d = (x - v[0][0]) * (x - v[0][0]) + (y - v[0][1]) * (y - v[0][1]), s = 1; for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) { const ex = v[j][0] - v[i][0], ey = v[j][1] - v[i][1], wx = x - v[i][0], wy = y - v[i][1]; let t = (wx * ex + wy * ey) / (ex * ex + ey * ey); t = t < 0 ? 0 : t > 1 ? 1 : t; const bx = wx - ex * t, by = wy - ey * t; d = mn(d, bx * bx + by * by); const c1 = y >= v[i][1], c2 = y < v[j][1], c3 = ex * wy > ey * wx; if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s; } return s * sq(d) - r; },
    U: (...f) => (x, y) => { let d = f[0](x, y); for (let i = 1; i < f.length; i++) d = mn(d, f[i](x, y)); return d; },
    SU: (k, ...f) => (x, y) => { let d = f[0](x, y); for (let i = 1; i < f.length; i++) d = smin(d, f[i](x, y), k); return d; },
    INT: (a, b, k = 0) => k ? (x, y) => smax(a(x, y), b(x, y), k) : (x, y) => mx(a(x, y), b(x, y)),
    SUB: (a, b, k = 0) => k ? (x, y) => smax(a(x, y), -b(x, y), k) : (x, y) => mx(a(x, y), -b(x, y)),
    off: (g, d) => (x, y) => g(x, y) - d,
    rot: (g, a, cx = 0, cy = 0) => { const c = Math.cos(a), s = Math.sin(a); return (x, y) => { x -= cx; y -= cy; return g(c * x + s * y + cx, -s * x + c * y + cy); }; },
    mirX: g => (x, y) => g(ab(x), y),
    flipX: g => (x, y) => g(-x, y),
    // pointed lens between a and b with different bulge on each side (up = left of a->b)
    vesica: (a, b, wu, wd, k = .05) => { const mxp = (a[0] + b[0]) / 2, myp = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) / 2, px = -dy / (2 * L), py = dx / (2 * L); const R1 = (L * L + wu * wu) / (2 * wu), R2 = (L * L + wd * wd) / (2 * wd); return D2.INT(D2.circ(mxp - px * (R1 - wu), myp - py * (R1 - wu), R1), D2.circ(mxp + px * (R2 - wd), myp + py * (R2 - wd), R2), k); },
  };
  return { smin, smax, sph, ell, cone, box, U, SU, SUB, INT, mirX, off, tr, rot, bound, lock, zfront, piece, pieceBB, mesh, D2 };
})();
if (typeof module !== 'undefined') module.exports = { SD };
