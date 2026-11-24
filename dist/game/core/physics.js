// Physik-Welt: statische Kollider (Kreise/Rechtecke), Bodenhöhe (inkl. Piers), Raycasts, Kollisionshilfen.
import { SpatialHash, clamp } from '../util.js';
import { waveHeight } from '../render/water.js';

const _tmp = { nx: 0, nz: 0, depth: 0 };

export class Physics {
  constructor(ctx, chunkMgr) {
    this.ctx = ctx;
    this.cm = chunkMgr;
    this.statics = new SpatialHash(40);
    this.platforms = new SpatialHash(64);
    this.time = 0;
    this._list = [];
  }

  addColliders(list) {
    for (const c of list) {
      const r = c.k === 'c' ? c.r : Math.hypot(c.hx, c.hz);
      this.statics.insert(c, c.x - r, c.z - r, c.x + r, c.z + r);
    }
  }
  removeColliders(list) { for (const c of list) this.statics.remove(c); }
  addPlatforms(list) { for (const p of list) { if (p._hk) continue; this.platforms.insert(p, p.x - p.rad, p.z - p.rad, p.x + p.rad, p.z + p.rad); } }
  removePlatforms(list) { for (const p of list) this.platforms.remove(p); }

  terrainHeight(x, z) { return this.cm.heightAt(x, z); }

  // Plattform (Pier) unter (x,z)? Liefert Oberkante oder -Infinity
  platformHeight(x, z) {
    let best = -Infinity;
    this.platforms.query(x - 1, z - 1, x + 1, z + 1, (p) => {
      const dx = x - p.x, dz = z - p.z;
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      const lx = c * dx - s * dz, lz = s * dx + c * dz;
      if (Math.abs(lx) <= p.w / 2 && Math.abs(lz) <= p.d / 2 && p.top > best) best = p.top;
    });
    return best;
  }

  // Begehbare Bodenhöhe (Gelände oder Pier)
  groundHeight(x, z) {
    const t = this.cm.heightAt(x, z);
    const p = this.platformHeight(x, z);
    return p > t ? p : t;
  }

  waterLevel(x, z) { return waveHeight(x, z, this.time, 0.7); }
  waterDepth(x, z) { const g = this.groundHeight(x, z); return g < 0 ? -g : 0; }

  // Kreis (Figur) gegen alle Kollider. Verschiebt (pos) und liefert Treffer.
  // y0/y1: Höhenbereich der Figur (Füße/Kopf)
  pushCircle(pos, r, y0, y1, cb = null) {
    let hit = false;
    this.statics.query(pos.x - r - 1, pos.z - r - 1, pos.x + r + 1, pos.z + r + 1, (c) => {
      if (y1 < c.y0 || y0 > c.y1) return;
      if (c.k === 'c') {
        const dx = pos.x - c.x, dz = pos.z - c.z, rr = r + c.r;
        const d2 = dx * dx + dz * dz;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 0.001;
          pos.x = c.x + (dx / d) * rr; pos.z = c.z + (dz / d) * rr;
          hit = true; cb?.(c, dx / d, dz / d);
        }
      } else {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const lx = c.c * dx - c.s * dz, lz = c.s * dx + c.c * dz;
        const px = clamp(lx, -c.hx, c.hx), pz = clamp(lz, -c.hz, c.hz);
        let ex = lx - px, ez = lz - pz;
        const d2 = ex * ex + ez * ez;
        if (d2 < r * r) {
          let nx, nz, pen;
          if (d2 > 1e-8) { const d = Math.sqrt(d2); nx = ex / d; nz = ez / d; pen = r - d; }
          else {
            // Mittelpunkt liegt im Rechteck: kürzesten Weg nach außen
            const ox = c.hx - Math.abs(lx), oz = c.hz - Math.abs(lz);
            if (ox < oz) { nx = Math.sign(lx) || 1; nz = 0; pen = ox + r; } else { nx = 0; nz = Math.sign(lz) || 1; pen = oz + r; }
          }
          // Normale zurück in Weltkoordinaten (Inverse der Drehung)
          const wx = c.c * nx + c.s * nz, wz = -c.s * nx + c.c * nz;
          pos.x += wx * pen; pos.z += wz * pen;
          hit = true; cb?.(c, wx, wz);
        }
      }
    });
    return hit;
  }

  // Fahrzeug-Rechteck (Mitte, Halbmaße, Kurs) gegen Kollider: gibt kürzeste Verschiebung zurück
  // veh: { x, z, hw, hl, h (Heading), y0, y1 }
  vehicleContacts(veh, out) {
    out.length = 0;
    const fx = Math.sin(veh.h), fz = Math.cos(veh.h); // vorwärts
    const rx = Math.cos(veh.h), rz = -Math.sin(veh.h); // seitlich
    const R = Math.hypot(veh.hw, veh.hl) + 1;
    this.statics.query(veh.x - R, veh.z - R, veh.x + R, veh.z + R, (c) => {
      if (veh.y1 < c.y0 || veh.y0 > c.y1) return;
      if (c.k === 'c') {
        // Kreis-OBB
        const dx = c.x - veh.x, dz = c.z - veh.z;
        const lf = dx * fx + dz * fz, lr = dx * rx + dz * rz;
        const px = clamp(lr, -veh.hw, veh.hw), pf = clamp(lf, -veh.hl, veh.hl);
        const ex = lr - px, ef = lf - pf;
        const d2 = ex * ex + ef * ef;
        if (d2 < c.r * c.r) {
          let nr, nf, pen;
          if (d2 > 1e-8) { const d = Math.sqrt(d2); nr = ex / d; nf = ef / d; pen = c.r - d; }
          else { const o1 = veh.hw - Math.abs(lr), o2 = veh.hl - Math.abs(lf); if (o1 < o2) { nr = Math.sign(lr) || 1; nf = 0; pen = o1 + c.r; } else { nr = 0; nf = Math.sign(lf) || 1; pen = o2 + c.r; } }
          // Normale zeigt vom Kollider zum Fahrzeug: -(nr*right + nf*fwd)
          out.push({ nx: -(nr * rx + nf * fx), nz: -(nr * rz + nf * fz), pen, c, px: c.x, pz: c.z, soft: c.prop === 'bush' });
        }
      } else {
        // SAT zwischen zwei Rechtecken
        const bx = c.c, bz = -c.s;          // lokale x-Achse des Kolliders in Welt
        const ux = c.s, uz = c.c;           // lokale z-Achse
        const dx = veh.x - c.x, dz = veh.z - c.z;
        const axes = [[fx, fz, veh.hl, veh.hw], [rx, rz, veh.hw, veh.hl], [bx, bz, c.hx, c.hz], [ux, uz, c.hz, c.hx]];
        let best = 1e9, bnx = 0, bnz = 0;
        for (let i = 0; i < 4; i++) {
          const [ax, az] = axes[i];
          // Projektionsradius beider Rechtecke auf Achse
          const rA = veh.hl * Math.abs(ax * fx + az * fz) + veh.hw * Math.abs(ax * rx + az * rz);
          const rB = c.hx * Math.abs(ax * bx + az * bz) + c.hz * Math.abs(ax * ux + az * uz);
          const dist = dx * ax + dz * az;
          const ov = rA + rB - Math.abs(dist);
          if (ov <= 0) return;
          if (ov < best) { best = ov; const sgn = dist >= 0 ? 1 : -1; bnx = ax * sgn; bnz = az * sgn; }
        }
        out.push({ nx: bnx, nz: bnz, pen: best, c, px: c.x, pz: c.z });
      }
    });
    return out;
  }

  // Strahl gegen Statik: liefert nächste Trefferdistanz oder null.
  // o: Ursprung {x,y,z}, d: Richtung (normiert) {x,y,z}
  raycastStatic(o, d, maxDist) {
    let best = maxDist, bc = null;
    const x1 = o.x + d.x * maxDist, z1 = o.z + d.z * maxDist;
    const minx = Math.min(o.x, x1) - 2, maxx = Math.max(o.x, x1) + 2, minz = Math.min(o.z, z1) - 2, maxz = Math.max(o.z, z1) + 2;
    this.statics.query(minx, minz, maxx, maxz, (c) => {
      let t = null;
      if (c.k === 'c') t = rayCircle(o, d, c.x, c.z, c.r, best);
      else t = rayObb(o, d, c, best);
      if (t !== null && t >= 0 && t < best) {
        // Höhencheck am Trefferpunkt
        const y = o.y + d.y * t;
        if (y >= c.y0 && y <= c.y1) { best = t; bc = c; }
      }
    });
    return bc ? { t: best, collider: bc } : null;
  }

  // Strahl gegen Gelände (marschiert in Schritten)
  raycastTerrain(o, d, maxDist, step = 2.5) {
    let prev = 0;
    for (let t = step; t <= maxDist; t += step) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < this.groundHeight(x, z)) {
        // Verfeinern
        let lo = prev, hi = t;
        for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (o.y + d.y * m < this.groundHeight(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
        return hi;
      }
      prev = t;
    }
    return null;
  }

  // Sichtlinie zwischen zwei Punkten (nur Statik + Gelände grob)
  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz);
    if (L < 0.5) return true;
    const d = { x: dx / L, y: dy / L, z: dz / L }, o = { x: ax, y: ay, z: az };
    if (this.raycastStatic(o, d, L)) return false;
    if (L > 20 && this.raycastTerrain(o, d, L, 6) !== null) return false;
    return true;
  }
}

function rayCircle(o, d, cx, cz, r, maxT) {
  const dx = o.x - cx, dz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (dx * d.x + dz * d.z), c = dx * dx + dz * dz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  return t < 0 || t > maxT ? null : t;
}

function rayObb(o, d, c, maxT) {
  const dx = o.x - c.x, dz = o.z - c.z;
  const lx = c.c * dx - c.s * dz, lz = c.s * dx + c.c * dz;
  const ldx = c.c * d.x - c.s * d.z, ldz = c.s * d.x + c.c * d.z;
  let t0 = 0, t1 = maxT;
  for (const [p, dd, h] of [[lx, ldx, c.hx], [lz, ldz, c.hz]]) {
    if (Math.abs(dd) < 1e-9) { if (Math.abs(p) > h) return null; continue; }
    let a = (-h - p) / dd, b = (h - p) / dd;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}
