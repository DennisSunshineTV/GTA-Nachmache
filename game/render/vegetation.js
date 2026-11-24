// Prozedurale Vegetation pro Chunk: deterministisch aus Küste, Höhe, Landnutzung und Feldparzellen.
import { ihash, fbm2, smoothstep, pointInPoly, TAU } from '../util.js';
import { LU } from '../world/landuse.js';
import { ZONES } from '../world/map.js';
import { parcelAt, FIELD_GROVE_MIN, FIELD_GROVE_MAX, CHUNK } from './terrain.js';

const CELL = 9;
const _parcel = {};

// Liegt der Punkt in/nahe einem Gebäude oder Pier?
export function nearBuilding(ctx, x, z, margin) {
  let hit = false;
  ctx.buildingHash.query(x - 30, z - 30, x + 30, z + 30, (b) => {
    if (hit) return;
    const dx = x - b.x, dz = z - b.z;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    if (Math.abs(lx) < b.w / 2 + margin && Math.abs(lz) < b.d / 2 + margin) hit = true;
  });
  return hit;
}

export function nearPool(ctx, x, z, margin) {
  for (const p of ctx.pools) {
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz > 900) continue;
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    if (Math.abs(lx) < p.w / 2 + margin && Math.abs(lz) < p.d / 2 + margin) return true;
  }
  return false;
}

export function* vegetation(ctx, cx, cz, hAt, density = 1) {
  const { coast, landuse, hf, net } = ctx;
  const out = [];
  const x0 = cx * CHUNK, z0 = cz * CHUNK;
  const gx0 = Math.floor(x0 / CELL), gx1 = Math.floor((x0 + CHUNK) / CELL), gz0 = Math.floor(z0 / CELL), gz1 = Math.floor((z0 + CHUNK) / CELL);
  let n = 0;
  for (let gz = gz0; gz < gz1; gz++) {
    for (let gx = gx0; gx < gx1; gx++) {
      const x = (gx + 0.12 + 0.76 * ihash(gx, gz, 1)) * CELL, z = (gz + 0.12 + 0.76 * ihash(gx, gz, 2)) * CELL;
      if (x < x0 || x >= x0 + CHUNK || z < z0 || z >= z0 + CHUNK) continue;
      if ((++n & 127) === 0) yield;
      const sd = coast.sdAt(x, z);
      if (sd < 2.5) continue;
      const u = ihash(gx, gz, 3);
      if (u > 0.9 * density + 0.1) continue; // Grobe Auslese (Qualität)
      const lu = landuse.get(x, z);
      if (lu !== 0 && lu !== LU.GARDEN) continue;
      const r2 = ihash(gx, gz, 4), r3 = ihash(gx, gz, 5);
      let t = null, s = 1, v = 0;
      const h = hAt(x, z);
      if (lu === LU.GARDEN) {
        if (r2 < 0.2) { t = r3 < 0.35 ? 'palm' : r3 < 0.65 ? 'olive' : 'bush'; s = 0.8 + r3 * 0.5; }
        else continue;
      } else {
        const wm = hf.wet.length ? hf.wetMask(x, z) : null;
        if (wm && wm.m > 0.12) {
          if (h > -0.2 && r2 < 0.75 * wm.m) { t = 'reed'; s = 0.8 + r3 * 0.7; }
          else if (r2 > 0.985 && h > 0.1) { t = 'palm'; s = 0.8; }
          else continue;
        } else {
          const slope = Math.hypot(hAt(x + 3, z) - hAt(x - 3, z), hAt(x, z + 3) - hAt(x, z - 3)) / 6;
          if (sd < 26 && h < 5 && slope < 0.3) {
            if (r2 < 0.045) { t = r3 < 0.5 ? 'agave' : 'bush'; s = 0.7 + r3 * 0.6; }
            else if (r2 > 0.992) { t = 'palm'; s = 0.9; }
            else continue;
          } else if (slope > 1.1) continue;
          else {
            const farm = h < 70 && slope < 0.2 && pointInPoly(x, z, ZONES.plain);
            if (farm) {
              const p = parcelAt(x, z, _parcel);
              if (p.hs >= FIELD_GROVE_MIN && p.hs < FIELD_GROVE_MAX) {
                if (p.edge > 3.5 && r2 < 0.55) { t = 'olive'; s = 0.8 + r3 * 0.5; v = 0; }
                else continue;
              } else if (p.edge < 2.2) {
                if (r2 < 0.32) { t = r3 < 0.7 ? 'bush' : 'olive'; s = 0.8 + r3 * 0.5; } else continue;
              } else if (r2 < 0.018) { t = r3 < 0.5 ? 'olive' : 'pine'; s = 0.9 + r3 * 0.4; v = 0; }
              else continue;
            } else {
              const forest = smoothstep(0.5, 0.62, fbm2(x / 160, z / 160, 3, 14)) * (h > 1.5 ? 1 : 0);
              const hill = h > 50 || slope > 0.25;
              if (forest > 0.1 && r2 < 0.5 * forest + 0.03) { t = 'pine'; v = (hill || sd > 500) ? 1 : (r3 < 0.7 ? 0 : 1); s = 0.8 + r3 * 0.55; }
              else if (slope > 0.55 && r2 < 0.12) { t = 'rock'; v = r3 < 0.5 ? 0 : 1; s = 0.6 + r3 * 1.6; }
              else if (r2 < 0.16 + 0.1 * (1 - forest)) { t = r3 < 0.1 ? 'agave' : 'bush'; s = 0.7 + r3 * 0.8; }
              else continue;
            }
          }
        }
      }
      if (!t) continue;
      // Ausschlüsse: Straße, Gebäude, Pool
      const rn = net.nearest(x, z, 16);
      if (rn && rn.d < rn.road.w / 2 + rn.road.sw + 2.6) continue;
      if (nearBuilding(ctx, x, z, 3.5)) continue;
      out.push({ t, x, y: h, z, r: r3 * TAU, s, v });
    }
  }
  return out;
}
