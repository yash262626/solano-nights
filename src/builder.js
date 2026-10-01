// Geometry builder that batches boxes / quads per material key into merged meshes.
import * as THREE from 'three';

class Bucket {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.n = 0; }
}

export const SIDES = {
  px: { n: [1, 0, 0], r: [0, 0, -1] },
  nx: { n: [-1, 0, 0], r: [0, 0, 1] },
  pz: { n: [0, 0, 1], r: [1, 0, 0] },
  nz: { n: [0, 0, -1], r: [-1, 0, 0] },
};
const UP = [0, 1, 0];
const WHITE = [1, 1, 1];

export class Builder {
  constructor() { this.buckets = new Map(); }
  bucket(k) {
    let b = this.buckets.get(k);
    if (!b) { b = new Bucket(); this.buckets.set(k, b); }
    return b;
  }
  // Generic rectangle: centre c, right r, up u (unit vectors), half sizes, normal n.
  face(k, c, r, u, hw, hh, n, u0, u1, v0, v1, col = WHITE) {
    const b = this.bucket(k), base = b.n;
    const px = [
      [c[0] - r[0] * hw - u[0] * hh, c[1] - r[1] * hw - u[1] * hh, c[2] - r[2] * hw - u[2] * hh],
      [c[0] + r[0] * hw - u[0] * hh, c[1] + r[1] * hw - u[1] * hh, c[2] + r[2] * hw - u[2] * hh],
      [c[0] + r[0] * hw + u[0] * hh, c[1] + r[1] * hw + u[1] * hh, c[2] + r[2] * hw + u[2] * hh],
      [c[0] - r[0] * hw + u[0] * hh, c[1] - r[1] * hw + u[1] * hh, c[2] - r[2] * hw + u[2] * hh],
    ];
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (let i = 0; i < 4; i++) {
      b.pos.push(px[i][0], px[i][1], px[i][2]);
      b.nor.push(n[0], n[1], n[2]);
      b.uv.push(uvs[i][0], uvs[i][1]);
      b.col.push(col[0], col[1], col[2]);
    }
    b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    b.n += 4;
  }
  // Arbitrary polygon (3 or 4 points, CCW seen from the front). Normal is computed.
  poly(k, pts, uvs, col = WHITE, flipIfDown = false) {
    const b = this.bucket(k), base = b.n;
    const ax = pts[1][0] - pts[0][0], ay = pts[1][1] - pts[0][1], az = pts[1][2] - pts[0][2];
    const bx = pts[2][0] - pts[0][0], by = pts[2][1] - pts[0][1], bz = pts[2][2] - pts[0][2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    if (flipIfDown && ny < 0) { pts = pts.slice().reverse(); uvs = uvs.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
    for (let i = 0; i < pts.length; i++) {
      b.pos.push(pts[i][0], pts[i][1], pts[i][2]);
      b.nor.push(nx, ny, nz);
      b.uv.push(uvs[i][0], uvs[i][1]);
      b.col.push(col[0], col[1], col[2]);
    }
    if (pts.length === 3) b.idx.push(base, base + 1, base + 2);
    else b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    b.n += pts.length;
  }
  // Axis-aligned box with world-scaled UVs.
  box(x0, y0, z0, x1, y1, z1, o = {}) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2, sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
    const tw = o.tw || 4, th = o.th || tw, vb = o.vBase !== undefined ? o.vBase : y0, uo = o.uOff || 0, col = o.col || WHITE;
    if (o.side) {
      for (const name in SIDES) {
        if (o.skip && o.skip[name]) continue;
        const s = SIDES[name];
        const isX = s.n[0] !== 0, w = isX ? sz : sx;
        const c = [cx + s.n[0] * sx / 2, cy, cz + s.n[2] * sz / 2];
        this.face(o.side, c, s.r, UP, w / 2, sy / 2, s.n, uo, uo + w / tw, (y0 - vb) / th, (y1 - vb) / th, col);
      }
    }
    const t = o.ttw || tw;
    if (o.top) this.face(o.top, [cx, y1, cz], [1, 0, 0], [0, 0, -1], sx / 2, sz / 2, [0, 1, 0], x0 / t, x1 / t, -z1 / t, -z0 / t, col);
    if (o.bottom) this.face(o.bottom, [cx, y0, cz], [1, 0, 0], [0, 0, 1], sx / 2, sz / 2, [0, -1, 0], x0 / t, x1 / t, z0 / t, z1 / t, col);
  }
  // Rotated box (around Y) – used for props like cranes / pier details. All faces same material.
  obox(k, cx, cy, cz, sx, sy, sz, rotY, col = WHITE, t = 4) {
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const rot = (v) => [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
    const faces = [
      [[1, 0, 0], [0, 0, -1], [0, 1, 0], sz, sy, sx],
      [[-1, 0, 0], [0, 0, 1], [0, 1, 0], sz, sy, sx],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0], sx, sy, sz],
      [[0, 0, -1], [-1, 0, 0], [0, 1, 0], sx, sy, sz],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1], sx, sz, sy],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1], sx, sz, sy],
    ];
    for (const [n, r, u, w, h, d] of faces) {
      const nn = rot(n), rr = rot(r), uu = rot(u);
      const cc = [cx + nn[0] * d / 2, cy + nn[1] * d / 2, cz + nn[2] * d / 2];
      this.face(k, cc, rr, uu, w / 2, h / 2, nn, 0, w / t, 0, h / t, col);
    }
  }
  isEmpty() { return this.buckets.size === 0; }
  build(materials, opts = {}) {
    const meshes = [];
    for (const [k, b] of this.buckets) {
      if (!b.n) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setIndex(b.n > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere(); g.computeBoundingBox();
      const mat = materials[k];
      if (!mat) { console.warn('missing material', k); continue; }
      const m = new THREE.Mesh(g, mat);
      m.castShadow = mat.userData.noShadow ? false : (opts.castShadow !== false);
      m.receiveShadow = opts.receiveShadow !== false;
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.name = k;
      meshes.push(m);
    }
    return meshes;
  }
}
