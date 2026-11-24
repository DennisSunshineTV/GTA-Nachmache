// Küstenlinie: glatte Polygone + exaktes vorzeichenbehaftetes Distanzfeld (positiv = Land).
import { catmull, resample, polyArea, fbm2, clamp, pointInPoly } from '../util.js';

const BUCKET = 160;
export const SD_MAX = 300;

export class Coast {
  constructor(islands, world, cell = 10) {
    this.world = world;
    this.cell = cell;
    this.polys = []; // { id, name, pts:[[x,z]...], bbox }
    for (const isl of islands) this.polys.push(this._buildPoly(isl));

    // Segmente + Buckets
    const segs = [];
    for (const p of this.polys) {
      const n = p.pts.length;
      for (let i = 0; i < n; i++) {
        const a = p.pts[i], b = p.pts[(i + 1) % n];
        segs.push(a[0], a[1], b[0], b[1]);
      }
    }
    this.segs = new Float32Array(segs);
    this.nseg = segs.length / 4;
    this.bx0 = Math.floor(world.x0 / BUCKET) - 3;
    this.bz0 = Math.floor(world.z0 / BUCKET) - 3;
    this.bnx = Math.ceil((world.x1 - world.x0) / BUCKET) + 7;
    this.bnz = Math.ceil((world.z1 - world.z0) / BUCKET) + 7;
    this.buckets = new Array(this.bnx * this.bnz);
    for (let s = 0; s < this.nseg; s++) {
      const ax = segs[s * 4], az = segs[s * 4 + 1], bx = segs[s * 4 + 2], bz = segs[s * 4 + 3];
      const x0 = Math.floor(Math.min(ax, bx) / BUCKET) - this.bx0, x1 = Math.floor(Math.max(ax, bx) / BUCKET) - this.bx0;
      const z0 = Math.floor(Math.min(az, bz) / BUCKET) - this.bz0, z1 = Math.floor(Math.max(az, bz) / BUCKET) - this.bz0;
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = iz * this.bnx + ix;
          (this.buckets[k] || (this.buckets[k] = [])).push(s);
        }
      }
    }
    this._buildRaster();
  }

  _buildPoly(isl) {
    const big = !!isl.big;
    let pts = catmull(isl.poly, 10, true);
    pts = resample(pts.concat([pts[0]]), 24);
    pts.pop();
    if (polyArea(pts) < 0) pts.reverse();
    // Natürliche Buchten und Landzungen: Verschiebung entlang der Normalen
    const n = pts.length;
    const out = new Array(n);
    const seed = isl.id.length * 13;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i + n - 1) % n], p1 = pts[(i + 1) % n];
      let tx = p1[0] - p0[0], tz = p1[1] - p0[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      // Normale zeigt nach außen (Innenseite liegt links der Laufrichtung)
      const nx = tz, nz = -tx;
      const [x, z] = pts[i];
      const a1 = big ? 26 : 9, a2 = big ? 55 : 14;
      const off = (fbm2(x / 160, z / 160, 3, seed) - 0.5) * a1 + (fbm2(x / 700, z / 700, 2, seed + 5) - 0.5) * a2;
      out[i] = [x + nx * off, z + nz * off];
    }
    const poly = { id: isl.id, name: isl.name, pts: out, bbox: [Infinity, Infinity, -Infinity, -Infinity] };
    for (const [x, z] of out) {
      poly.bbox[0] = Math.min(poly.bbox[0], x); poly.bbox[1] = Math.min(poly.bbox[1], z);
      poly.bbox[2] = Math.max(poly.bbox[2], x); poly.bbox[3] = Math.max(poly.bbox[3], z);
    }
    return poly;
  }

  // Ist (x,z) Land? (Strahlverfahren über alle Polygone)
  insideAny(x, z) {
    for (const p of this.polys) {
      const b = p.bbox;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      if (pointInPoly(x, z, p.pts)) return true;
    }
    return false;
  }

  islandAt(x, z) {
    for (const p of this.polys) {
      const b = p.bbox;
      if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
      if (pointInPoly(x, z, p.pts)) return p.id;
    }
    return null;
  }

  // Exakte Distanz (nur für den Raster-Aufbau)
  _exact(x, z) {
    const bix = Math.floor(x / BUCKET) - this.bx0, biz = Math.floor(z / BUCKET) - this.bz0;
    let best = 1e18, sgn = 1;
    const segs = this.segs;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const ix = bix + dx, iz = biz + dz;
        if (ix < 0 || iz < 0 || ix >= this.bnx || iz >= this.bnz) continue;
        const arr = this.buckets[iz * this.bnx + ix];
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const s = arr[k] * 4;
          const ax = segs[s], az = segs[s + 1], bx = segs[s + 2], bz = segs[s + 3];
          const ex = bx - ax, ez = bz - az;
          const l2 = ex * ex + ez * ez;
          let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + ex * t - x, qz = az + ez * t - z;
          const d2 = qx * qx + qz * qz;
          if (d2 < best) {
            best = d2;
            sgn = ex * (z - az) - ez * (x - ax) >= 0 ? 1 : -1;
          }
        }
      }
    }
    if (best > SD_MAX * SD_MAX) return null;
    return Math.sqrt(best) * sgn;
  }

  _buildRaster() {
    const { world, cell } = this;
    this.nx = Math.ceil((world.x1 - world.x0) / cell) + 1;
    this.nz = Math.ceil((world.z1 - world.z0) / cell) + 1;
    const sd = (this.sd = new Float32Array(this.nx * this.nz));
    const per = BUCKET / cell; // Zellen pro Bucket-Kante (16)
    // Für jeden Bucket: nahe an der Küste?
    for (let biz = 0; biz < this.bnz; biz++) {
      for (let bix = 0; bix < this.bnx; bix++) {
        const wx0 = (bix + this.bx0) * BUCKET, wz0 = (biz + this.bz0) * BUCKET;
        let near = false;
        for (let dz = -2; dz <= 2 && !near; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ix = bix + dx, iz = biz + dz;
            if (ix < 0 || iz < 0 || ix >= this.bnx || iz >= this.bnz) continue;
            if (this.buckets[iz * this.bnx + ix]) { near = true; break; }
          }
        }
        // Rasterzellen dieses Buckets
        const i0 = Math.max(0, Math.ceil((wx0 - world.x0) / cell)), i1 = Math.min(this.nx - 1, Math.floor((wx0 + BUCKET - 1e-6 - world.x0) / cell));
        const j0 = Math.max(0, Math.ceil((wz0 - world.z0) / cell)), j1 = Math.min(this.nz - 1, Math.floor((wz0 + BUCKET - 1e-6 - world.z0) / cell));
        if (i0 > i1 || j0 > j1) continue;
        if (!near) {
          const v = this.insideAny(wx0 + BUCKET / 2, wz0 + BUCKET / 2) ? SD_MAX : -SD_MAX;
          for (let j = j0; j <= j1; j++) sd.fill(v, j * this.nx + i0, j * this.nx + i1 + 1);
          continue;
        }
        for (let j = j0; j <= j1; j++) {
          const z = world.z0 + j * cell;
          for (let i = i0; i <= i1; i++) {
            const x = world.x0 + i * cell;
            let d = this._exact(x, z);
            if (d === null) d = this.insideAny(x, z) ? SD_MAX : -SD_MAX;
            sd[j * this.nx + i] = d > SD_MAX ? SD_MAX : d < -SD_MAX ? -SD_MAX : d;
          }
        }
      }
    }
    void per;
  }

  // Bilineare Abfrage des Distanzfelds (Meter, positiv = Land)
  sdAt(x, z) {
    const { world, cell, nx, nz, sd } = this;
    let fx = (x - world.x0) / cell, fz = (z - world.z0) / cell;
    if (fx < 0 || fz < 0 || fx >= nx - 1 || fz >= nz - 1) return -SD_MAX;
    const i = fx | 0, j = fz | 0;
    fx -= i; fz -= j;
    const k = j * nx + i;
    const a = sd[k], b = sd[k + 1], c = sd[k + nx], d = sd[k + nx + 1];
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  }

  centroid(id) {
    const p = this.polys.find((q) => q.id === id);
    let sx = 0, sz = 0;
    for (const [x, z] of p.pts) { sx += x; sz += z; }
    return [sx / p.pts.length, sz / p.pts.length];
  }

  // Schnittpunkt eines Strahls vom Inselmittelpunkt (Winkel in Grad, ab Osten, z nach Süden) mit der Küste
  rayHit(id, deg) {
    const p = this.polys.find((q) => q.id === id);
    const [cx, cz] = this.centroid(id);
    const a = (deg * Math.PI) / 180, dx = Math.cos(a), dz = Math.sin(a);
    let best = null;
    const n = p.pts.length;
    for (let i = 0; i < n; i++) {
      const [ax, az] = p.pts[i], [bx, bz] = p.pts[(i + 1) % n];
      const ex = bx - ax, ez = bz - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((ax - cx) * ez - (az - cz) * ex) / den;
      const u = ((ax - cx) * dz - (az - cz) * dx) / den;
      if (t > 0 && u >= 0 && u <= 1 && (best === null || t > best)) best = t;
    }
    if (best === null) return null;
    return { x: cx + dx * best, z: cz + dz * best, dx, dz };
  }

  // Richtung zum Meer (normierter Vektor), aus dem Gradienten
  seaDir(x, z, out = {}) {
    const e = 12;
    let gx = this.sdAt(x + e, z) - this.sdAt(x - e, z);
    let gz = this.sdAt(x, z + e) - this.sdAt(x, z - e);
    const l = Math.hypot(gx, gz) || 1;
    out.x = -gx / l; out.z = -gz / l; // zeigt Richtung Wasser
    return out;
  }

  // Küstenpfad nahe einem Punkt: liefert Punktliste (Reihenfolge der Polygonlaufrichtung),
  // verschoben um `offset` Meter landeinwärts.
  pathNear(x, z, length, offset = 0) {
    let best = null, bd = 1e18;
    for (const p of this.polys) {
      for (let i = 0; i < p.pts.length; i++) {
        const d = (p.pts[i][0] - x) ** 2 + (p.pts[i][1] - z) ** 2;
        if (d < bd) { bd = d; best = { p, i }; }
      }
    }
    if (!best) return [];
    const { p, i } = best, n = p.pts.length;
    const step = 24;
    const half = Math.round(length / 2 / step);
    const out = [];
    for (let k = -half; k <= half; k++) {
      const idx = (((i + k) % n) + n) % n;
      const a = p.pts[(idx + n - 1) % n], b = p.pts[(idx + 1) % n], c = p.pts[idx];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l; tz /= l;
      // Innenseite liegt links der Laufrichtung: Normale nach innen = (-tz, tx)... (x,z)-Kreuzprodukt
      out.push({ x: c[0] - tz * offset, z: c[1] + tx * offset, nx: -tz, nz: tx, tx, tz });
    }
    return out;
  }
}
