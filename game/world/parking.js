// Parkplätze (reine Weltdaten): ebene Asphaltflächen direkt an Ortsstraßen mit markierten Buchten in zwei Reihen,
// Fahrgasse dazwischen und Einfahrten an beiden Enden der vorderen Reihe. Gezeichnet wird die Fläche als Straßenart
// 'forecourt' (Vorplatz), die Markierungen und das P-Schild in render/detail.js; Autos parken zur Laufzeit (parkingrt.js).
//
// Lokales Raster: x entlang der Straße, z von der Straße weg (z = −D/2 liegt an der Straße).
import { RNG, SpatialHash } from '../util.js';
import { LU } from './landuse.js';

export const LOT = { W: 36, D: 19, bay: 2.5, len: 5.0, aisle: 6.5, front: 1.2, entry: 7 };
const KINDS = new Set(['street', 'avenue', 'main', 'promenade']);
const SPACING = 420;
const TARGET = { mallorca: 16, ibiza: 4, menorca: 3, formentera: 1 };

const local = (x, z, rot, lx, lz) => { const c = Math.cos(rot), s = Math.sin(rot); return [x + c * lx + s * lz, z - s * lx + c * lz]; };

export function generateParking(ctx) {
  const { net, coast, hf, landuse } = ctx;
  const rng = new RNG(5151);
  ctx.parkingLots = [];
  const bh = new SpatialHash(64);
  for (const b of ctx.buildings) { b.rad = Math.hypot(b.w, b.d) / 2; bh.insert(b, b.x - b.rad, b.z - b.rad, b.x + b.rad, b.z + b.rad); }
  const avoid = [...(ctx.services || []).map((s) => [s.x, s.z, 60]), ...(ctx.home ? [[ctx.home.x, ctx.home.z, 110]] : [])];
  const { W, D } = LOT;

  const free = (cx, cz, rot, road) => {
    let lo = Infinity, hi = -Infinity;
    for (let lz = -D / 2 + 1; lz <= D / 2 + 1.01; lz += 3) for (let lx = -W / 2 - 1; lx <= W / 2 + 1.01; lx += 3) {
      const [px, pz] = local(cx, cz, rot, lx, lz);
      if (coast.sdAt(px, pz) < 12) return null;
      const lu = landuse.get(px, pz);
      if (lu !== 0 && lu !== LU.GARDEN && lu !== LU.URBAN && lu !== LU.BEACHCLUB) return null;
      if (hf.wet.length && hf.wetMask(px, pz)) return null;
      const nr = net.nearest(px, pz, 18);
      if (nr && nr.d < nr.road.w / 2 + nr.road.sw + (nr.road === road ? 0.4 : 3)) return null;
      let hit = false;
      bh.query(px - 12, pz - 12, px + 12, pz + 12, (b) => {
        if (hit) return;
        const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = px - b.x, dz = pz - b.z;
        if (Math.abs(c * dx - s * dz) < b.w / 2 + 2 && Math.abs(s * dx + c * dz) < b.d / 2 + 2) hit = true;
      });
      if (hit) return null;
      const h = hf.h(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (hi - lo > 2.6 || lo < 0.6) return null;
    return { lo, hi };
  };

  // Kandidaten: gerade Abschnitte passender Straßen in und am Rand der Orte, beidseitig
  const cands = [];
  for (const r of net.roads) {
    if (!r || !KINDS.has(r.kind) || r.noTraffic || r.hidden || r.len < W + 50) continue;
    for (let s = 25 + W / 2; s < r.len - 25 - W / 2; s += 18) {
      const p = net.pointAt(r, s, {}), a = net.pointAt(r, s - W / 2, {}), b = net.pointAt(r, s + W / 2, {});
      if (a.dx * b.dx + a.dz * b.dz < 0.985) continue;
      for (const side of [-1, 1]) {
        const nx = -p.dz * side, nz = p.dx * side;
        const edge = r.w / 2 + (r.sw > 0 ? r.sw : 1.0) + 0.1;
        cands.push({ r, s, p, side, edge, cx: p.x + nx * (edge + D / 2), cz: p.z + nz * (edge + D / 2), rot: Math.atan2(nx, nz) });
      }
    }
  }
  const town = (x, z) => { let k = 9; for (const st of ctx.settlements) { if (!st.pos) continue; k = Math.min(k, Math.hypot(st.pos[0] - x, st.pos[1] - z) / (st.r || 250)); } return k; };
  for (const c of cands) c.score = Math.abs(town(c.cx, c.cz) - 0.7) + (c.r.kind === 'promenade' ? -0.3 : 0) + rng.next() * 0.4;
  cands.sort((a, b) => a.score - b.score);
  const count = {};
  for (const c of cands) {
    if (c.score > 1.2) break;
    const isl = coast.islandAt(c.cx, c.cz);
    if ((count[isl] || 0) >= (TARGET[isl] || 0)) continue;
    if (ctx.parkingLots.some((l) => Math.hypot(l.x - c.cx, l.z - c.cz) < SPACING)) continue;
    if (avoid.some(([x, z, r]) => Math.hypot(x - c.cx, z - c.cz) < r)) continue;
    if (!free(c.cx, c.cz, c.rot, c.r)) continue;
    const lot = build(ctx, c);
    if (!lot) continue;
    count[isl] = (count[isl] || 0) + 1;
  }
  return ctx.parkingLots.length;
}

function build(ctx, c) {
  const { W, D, bay, len, aisle, front, entry } = LOT;
  const lot = { id: ctx.parkingLots.length, x: c.cx, z: c.cz, rot: c.rot, W, D, roadId: c.r.id, bays: [], lines: [] };
  const L = (lx, lz) => local(lot.x, lot.z, lot.rot, lx, lz);
  // Fläche: ein breiter, ebener Vorplatz (x entlang der Straße), reicht bis an die Gehwegkante
  const r = ctx.net.addLate('forecourt', [L(-W / 2, 0), L(W / 2, 0)], { hf: ctx.hf, name: 'Parkplatz', noTraffic: true, flat: true, w: D });
  if (!r) return null;
  lot.y = r.ys[0] + 0.06;
  const zf = -D / 2 + front, zFront1 = zf + len, zBack0 = zFront1 + aisle, zBack1 = zBack0 + len;
  // vordere Reihe (Autos mit der Front zur Straße hin geparkt), Einfahrten links und rechts frei
  const fx0 = -W / 2 + entry, fx1 = W / 2 - entry;
  const nF = Math.floor((fx1 - fx0) / bay);
  for (let i = 0; i < nF; i++) {
    const x = fx0 + (i + 0.5) * bay + ((fx1 - fx0) - nF * bay) / 2;
    lot.bays.push({ lx: x, lz: (zf + zFront1) / 2, front: true });
  }
  const nB = Math.floor((W - 2) / bay);
  for (let i = 0; i < nB; i++) lot.bays.push({ lx: -W / 2 + 1 + (i + 0.5) * bay + ((W - 2) - nB * bay) / 2, lz: (zBack0 + zBack1) / 2, front: false });
  // Weltkoordinaten der Buchten; Fahrzeug-Kurs: vordere Reihe Front zur Straße (−z), hintere Reihe Front nach hinten (+z)
  for (const b of lot.bays) { const [x, z] = L(b.lx, b.lz); b.x = x; b.z = z; b.h = b.front ? Math.atan2(-Math.sin(lot.rot), -Math.cos(lot.rot)) : lot.rot; }
  // Markierungen (lokal): Trennlinien der Buchten und Abschlusslinien
  const rowLines = (x0, n, z0, z1) => { for (let i = 0; i <= n; i++) lot.lines.push([x0 + i * bay, z0, x0 + i * bay, z1]); lot.lines.push([x0, z1, x0 + n * bay, z1]); };
  rowLines(fx0 + ((fx1 - fx0) - nF * bay) / 2, nF, zFront1, zf + 0.3);
  rowLines(-W / 2 + 1 + ((W - 2) - nB * bay) / 2, nB, zBack0, zBack1);
  // Schild „P“ an der Einfahrt
  const [sx, sz] = L(-W / 2 + 1.0, -D / 2 + 0.6);
  lot.sign = { x: sx, z: sz };
  lot.entries = [L(-W / 2 + entry / 2, -D / 2 + 2), L(W / 2 - entry / 2, -D / 2 + 2)];
  ctx.pois.push({ id: 'parking' + lot.id, type: 'parking', x: lot.x, z: lot.z, label: 'Parkplatz' });
  // Bäume/Möbel auf der Fläche entfernen
  const co = Math.cos(lot.rot), si = Math.sin(lot.rot);
  ctx.props = ctx.props.filter((p) => { const dx = p.x - lot.x, dz = p.z - lot.z; return !(Math.abs(co * dx - si * dz) < W / 2 + 1.5 && Math.abs(si * dx + co * dz) < D / 2 + 1.5); });
  ctx.parkingLots.push(lot);
  return lot;
}
