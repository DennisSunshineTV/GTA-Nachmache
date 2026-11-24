// Höhenfeld der Welt (rein analytisch + Küsten-Distanzfeld), ohne Three.js.
import { clamp, lerp, smoothstep, fbm2, ridged2, noise2, pointInPoly, distPointSeg } from '../util.js';

export const SEA_LEVEL = 0;

export class HeightField {
  constructor(coast, { ridges, wetlands, plateaus = [] }) {
    this.coast = coast;
    this.ridges = ridges.map((r) => {
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (const [x, z] of r.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      const m = r.sigma * 3.2;
      return { pts: r.pts, sigma: r.sigma, bb: [x0 - m, z0 - m, x1 + m, z1 + m] };
    });
    this.plateaus = [];
    this.carve = null; // wird vom Straßennetz gesetzt: (x, z, h) => h
    this._buildWet(wetlands);
    for (const p of plateaus) this.addPlateau(p.x, p.z, p.r, p.blend);
  }

  // Ebene Fläche (Flughafen, große Anlagen): Höhe = Geländehöhe in der Mitte
  addPlateau(x, z, r, blend = 60, h = null) {
    const hh = h ?? this.base(x, z);
    this.plateaus.push({ x, z, r, blend, h: hh });
    return hh;
  }

  _buildWet(wetlands) {
    this.wet = wetlands.map((w) => {
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (const [x, z] of w.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      x0 -= 80; z0 -= 80; x1 += 80; z1 += 80;
      const cell = 12;
      const nx = Math.ceil((x1 - x0) / cell) + 1, nz = Math.ceil((z1 - z0) / cell) + 1;
      const data = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const x = x0 + i * cell, z = z0 + j * cell;
          let d = 1e9;
          for (let a = 0, n = w.pts.length; a < n; a++) {
            const p = w.pts[a], q = w.pts[(a + 1) % n];
            d = Math.min(d, distPointSeg(x, z, p[0], p[1], q[0], q[1]));
          }
          const inside = pointInPoly(x, z, w.pts);
          data[j * nx + i] = inside ? smoothstep(0, 120, d) : 0;
        }
      }
      return { ...w, x0, z0, x1, z1, cell, nx, nz, data };
    });
  }

  // Wasserfläche/Feuchtgebiet-Maske (0..1)
  wetMask(x, z) {
    for (const w of this.wet) {
      if (x < w.x0 || x > w.x1 || z < w.z0 || z > w.z1) continue;
      let fx = (x - w.x0) / w.cell, fz = (z - w.z0) / w.cell;
      const i = Math.min(w.nx - 2, fx | 0), j = Math.min(w.nz - 2, fz | 0);
      fx -= i; fz -= j;
      const k = j * w.nx + i, d = w.data;
      const v = d[k] + (d[k + 1] - d[k]) * fx + (d[k + w.nx] - d[k]) * fz + (d[k] - d[k + 1] - d[k + w.nx] + d[k + w.nx + 1]) * fx * fz;
      if (v > 0.001) return { m: v, w };
    }
    return null;
  }

  // Gebirgshöhe in Metern (0 = keine Berge)
  mountain(x, z) {
    let best = 0;
    for (const r of this.ridges) {
      const bb = r.bb;
      if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
      const pts = r.pts, sg = r.sigma;
      if (pts.length === 2 && pts[0][0] === pts[1][0] && pts[0][1] === pts[1][1]) continue;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ex = b[0] - a[0], ez = b[1] - a[1];
        const l2 = ex * ex + ez * ez || 1;
        let t = ((x - a[0]) * ex + (z - a[1]) * ez) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - (a[0] + ex * t), dz = z - (a[1] + ez * t);
        const q = (dx * dx + dz * dz) / (sg * sg);
        if (q > 10) continue;
        const hp = a[2] + (b[2] - a[2]) * t;
        const v = hp * Math.exp(-q);
        if (v > best) best = v;
      }
    }
    if (best < 0.5) return best;
    // Felsige Struktur
    const rg = ridged2(x / 340, z / 340, 4, 7);
    const n = fbm2(x / 90, z / 90, 3, 3);
    return best * (0.72 + 0.5 * rg) + (n - 0.5) * 5 * smoothstep(5, 60, best);
  }

  // Höhe ohne Straßen (für Straßenprofile und Platzierung)
  base(x, z) {
    const sd = this.coast.sdAt(x, z);
    if (sd < 0) {
      const d = -sd;
      return -(2.6 * (1 - Math.exp(-d / 26)) + d * 0.05);
    }
    const mh = this.mountain(x, z);
    let cliff = smoothstep(22, 110, mh);
    const plain = 3.5 + 11 * fbm2(x / 1100, z / 1100, 3, 21) + 2.6 * fbm2(x / 150, z / 150, 2, 4);
    let inland = plain + mh;
    // Plateaus (Siedlungen, Flughafen): Binnenhöhe wird auf feste Höhe gezogen
    for (const p of this.plateaus) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + p.blend) {
        const w = 1 - smoothstep(p.r, p.r + p.blend, d);
        inland = lerp(inland, p.h, w);
        cliff *= 1 - w;
      }
    }
    const ramp = lerp(95, 48, cliff);
    const k = smoothstep(0, ramp, sd);
    const beach = Math.min(sd, 42) * 0.046;
    let h = beach + (inland - beach) * k;
    // Felsige Küste: Kleine Stufen
    if (cliff > 0.4 && sd < 60) h += (noise2(x / 14, z / 14, 5) - 0.5) * 3.2 * cliff * (1 - sd / 60);
    // Feuchtgebiete: flach, teilweise unter Wasser
    const wm = this.wet.length ? this.wetMask(x, z) : null;
    if (wm) {
      const n = fbm2(x / 38, z / 38, 3, 55);
      const wetH = (n - wm.w.water) * 1.6 - 0.1;
      h = lerp(h, Math.min(h, wetH), wm.m);
    }
    return h;
  }

  // Endgültige Höhe (Straßen eingearbeitet)
  h(x, z) {
    const h = this.base(x, z);
    return this.carve ? this.carve(x, z, h) : h;
  }

  slope(x, z, e = 4) {
    const dx = (this.h(x + e, z) - this.h(x - e, z)) / (2 * e);
    const dz = (this.h(x, z + e) - this.h(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  baseSlope(x, z, e = 6) {
    const dx = (this.base(x + e, z) - this.base(x - e, z)) / (2 * e);
    const dz = (this.base(x, z + e) - this.base(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }
}
