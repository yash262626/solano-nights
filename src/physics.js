// Static collision world: axis-aligned boxes stored in a uniform spatial grid.
// Supports circle push-out (characters, vehicles), ground queries and a DDA raycast.
import { terrainHeight } from './config.js';

export class Physics {
  constructor(cell = 16) {
    this.cell = cell;
    this.boxes = [];
    this.grid = new Map();
    this.stamp = 1;
    this.marks = [];
  }
  key(ix, iz) { return (ix + 2048) * 4096 + (iz + 2048); }

  addBox(minX, minY, minZ, maxX, maxY, maxZ, tag = 'building') {
    const id = this.boxes.length;
    const b = { minX, minY, minZ, maxX, maxY, maxZ, tag, id };
    this.boxes.push(b); this.marks.push(0);
    const c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++)
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const k = this.key(ix, iz);
        let arr = this.grid.get(k);
        if (!arr) { arr = []; this.grid.set(k, arr); }
        arr.push(b);
      }
    return b;
  }

  query(minX, minZ, maxX, maxZ, out = []) {
    out.length = 0;
    const s = ++this.stamp, c = this.cell;
    for (let ix = Math.floor(minX / c); ix <= Math.floor(maxX / c); ix++)
      for (let iz = Math.floor(minZ / c); iz <= Math.floor(maxZ / c); iz++) {
        const arr = this.grid.get(this.key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const b = arr[i];
          if (this.marks[b.id] === s) continue;
          this.marks[b.id] = s;
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    return out;
  }

  // Push a circle (in XZ) out of boxes overlapping the vertical range [y0,y1].
  // pos: object with x,z (modified). Returns accumulated normal info or null.
  resolveCircle(pos, r, y0, y1, result = { hit: false, nx: 0, nz: 0, depth: 0 }) {
    result.hit = false; result.nx = 0; result.nz = 0; result.depth = 0;
    const list = this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, this._tmp || (this._tmp = []));
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.maxY <= y0 + 0.01 || b.minY >= y1) continue;
        const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
        let dx = pos.x - cx, dz = pos.z - cz;
        let d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let d = Math.sqrt(d2), nx, nz, pen;
        if (d < 1e-5) {
          // centre inside the box: push out along the smallest axis
          const l = pos.x - b.minX, rr = b.maxX - pos.x, t = pos.z - b.minZ, bt = b.maxZ - pos.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) { nx = -1; nz = 0; pen = l + r; } else if (m === rr) { nx = 1; nz = 0; pen = rr + r; }
          else if (m === t) { nx = 0; nz = -1; pen = t + r; } else { nx = 0; nz = 1; pen = bt + r; }
        } else { nx = dx / d; nz = dz / d; pen = r - d; }
        pos.x += nx * pen; pos.z += nz * pen;
        result.hit = true; result.nx += nx; result.nz += nz; result.depth = Math.max(result.depth, pen);
      }
    }
    if (result.hit) {
      const l = Math.hypot(result.nx, result.nz) || 1;
      result.nx /= l; result.nz /= l;
    }
    return result;
  }

  // Highest walkable surface under (x,z) that is not above footY+step.
  groundHeight(x, z, footY = 100, step = 0.45, r = 0.2) {
    let h = terrainHeight(x, z);
    const list = this.query(x - r, z - r, x + r, z + r, this._tmp2 || (this._tmp2 = []));
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (x < b.minX - r || x > b.maxX + r || z < b.minZ - r || z > b.maxZ + r) continue;
      if (b.maxY <= footY + step && b.maxY > h) h = b.maxY;
    }
    return h;
  }

  // Ray against static boxes. dir must be normalised. Returns {t, nx, ny, nz, box} or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out = {}, ignoreTag = null) {
    if (Math.abs(dx) < 1e-9) dx = 1e-9;
    if (Math.abs(dy) < 1e-9) dy = 1e-9;
    if (Math.abs(dz) < 1e-9) dz = 1e-9;
    const c = this.cell, s = ++this.stamp;
    let ix = Math.floor(ox / c), iz = Math.floor(oz / c);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tDX = dx !== 0 ? Math.abs(c / dx) : Infinity, tDZ = dz !== 0 ? Math.abs(c / dz) : Infinity;
    let tMX = dx !== 0 ? (dx > 0 ? (ix + 1) * c - ox : ox - ix * c) / Math.abs(dx) : Infinity;
    let tMZ = dz !== 0 ? (dz > 0 ? (iz + 1) * c - oz : oz - iz * c) / Math.abs(dz) : Infinity;
    let best = maxDist, hit = null, t = 0;
    const idx = 1 / dx, idy = 1 / dy, idz = 1 / dz;
    for (let guard = 0; guard < 512; guard++) {
      const arr = this.grid.get(this.key(ix, iz));
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          const b = arr[i];
          if (this.marks[b.id] === s) continue;
          this.marks[b.id] = s;
          if (ignoreTag && b.tag === ignoreTag) continue;
          // slab test
          let t1 = (b.minX - ox) * idx, t2 = (b.maxX - ox) * idx;
          let tmin = Math.min(t1, t2), tmax = Math.max(t1, t2), ax = 0;
          let axis = 0;
          t1 = (b.minY - oy) * idy; t2 = (b.maxY - oy) * idy;
          let tn = Math.min(t1, t2), tf = Math.max(t1, t2);
          if (tn > tmin) { tmin = tn; axis = 1; }
          tmax = Math.min(tmax, tf);
          t1 = (b.minZ - oz) * idz; t2 = (b.maxZ - oz) * idz;
          tn = Math.min(t1, t2); tf = Math.max(t1, t2);
          if (tn > tmin) { tmin = tn; axis = 2; }
          tmax = Math.min(tmax, tf);
          if (tmax < Math.max(tmin, 0) || tmin > best || tmin < 0) continue;
          best = tmin; hit = b; ax = axis;
          out.axis = ax;
        }
      }
      if (tMX < tMZ) { t = tMX; tMX += tDX; ix += stepX; } else { t = tMZ; tMZ += tDZ; iz += stepZ; }
      if (t > best || t > maxDist) break;
    }
    if (!hit) return null;
    out.t = best; out.box = hit;
    out.nx = out.axis === 0 ? -Math.sign(dx) : 0;
    out.ny = out.axis === 1 ? -Math.sign(dy) : 0;
    out.nz = out.axis === 2 ? -Math.sign(dz) : 0;
    return out;
  }

  // Line of sight between two points (static geometry only).
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz);
    if (d < 0.01) return true;
    return !this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.2, this._losOut || (this._losOut = {}), 'fence');
  }
}
