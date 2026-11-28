// Tankstellen und Werkstätten: Plätze an passenden Straßen suchen (freie, ebene Fläche neben der Fahrbahn), Vorplatz als
// befahrbare Fläche (Straßenart 'forecourt', eben eingeschnitten), Gebäudeteile im Stil 'service' (gezeichnet in
// render/servicegeom.js) und Kartenorte. Reine Weltdaten (ohne Three.js).
//
// Lokales Raster eines Platzes: x entlang der Straße, z von der Straße weg (z = -D/2 liegt an der Straße).
import { RNG, SpatialHash } from '../util.js';
import { LU } from './landuse.js';

export const FUEL = { W: 36, D: 30, apron: [-15, 1.5] };        // Vorplatz z-Bereich (vorne bis hinten)
export const SHOP = { W: 26, D: 30, hall: { w: 17, d: 15, h: 6.2 }, door: { w: 8.2, h: 4.6 } };
export const PUMPS = { islands: [-7.5, -1.5], xs: [-4, 4] };    // Zapfsäulen-Inseln (z) und Säulen je Insel (x)
const FUEL_KINDS = new Set(['main', 'rural', 'scenic', 'highway', 'avenue', 'street']);
const SHOP_KINDS = new Set(['main', 'rural', 'avenue', 'street']);
const TARGET = { fuel: { mallorca: 10, ibiza: 2, menorca: 2, formentera: 1 }, repair: { mallorca: 7, ibiza: 1, menorca: 1 } };
const SPACING = { fuel: 1100, repair: 1300 };

const local = (x, z, rot, lx, lz) => { const c = Math.cos(rot), s = Math.sin(rot); return [x + c * lx + s * lz, z - s * lx + c * lz]; };

export function generateServices(ctx) {
  const { net, coast, hf, landuse } = ctx;
  const rng = new RNG(9191);
  ctx.services = [];
  const bh = new SpatialHash(64);
  for (const b of ctx.buildings) { b.rad = Math.hypot(b.w, b.d) / 2; bh.insert(b, b.x - b.rad, b.z - b.rad, b.x + b.rad, b.z + b.rad); }
  const home = ctx.home;
  const placed = [];

  // Prüft das Rechteck (Breite W entlang der Straße, Tiefe D) des Platzes
  const free = (cx, cz, rot, W, D, road) => {
    let lo = Infinity, hi = -Infinity;
    for (let lz = -D / 2 + 1.5; lz <= D / 2 + 0.01; lz += 3) {
      for (let lx = -W / 2; lx <= W / 2 + 0.01; lx += 3) {
        const [px, pz] = local(cx, cz, rot, lx, lz);
        if (coast.sdAt(px, pz) < 30) return null;
        const lu = landuse.get(px, pz);
        if (lu !== 0 && lu !== LU.GARDEN && lu !== LU.URBAN) return null;
        if (hf.wet.length && hf.wetMask(px, pz)) return null;
        const nr = net.nearest(px, pz, 16);
        if (nr && nr.d < nr.road.w / 2 + nr.road.sw + (nr.road === road ? 0.6 : 2.5)) return null;
        let hit = false;
        bh.query(px - 12, pz - 12, px + 12, pz + 12, (b) => {
          if (hit) return;
          const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = px - b.x, dz = pz - b.z;
          if (Math.abs(c * dx - s * dz) < b.w / 2 + 2.5 && Math.abs(s * dx + c * dz) < b.d / 2 + 2.5) hit = true;
        });
        if (hit) return null;
        const h = hf.h(px, pz);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
    }
    if (hi - lo > 3.2 || lo < 1) return null;
    if (home && Math.hypot(cx - home.x, cz - home.z) < 90) return null;
    return { lo, hi };
  };

  // Kandidaten: alle Abschnitte passender Straßen, beidseitig, mit Abstand zur nächsten Kreuzung
  const candidates = (kinds, W, D) => {
    const out = [];
    for (const r of net.roads) {
      if (!kinds.has(r.kind) || r.noTraffic || r.len < W + 40) continue;
      for (let s = 20 + W / 2; s < r.len - 20 - W / 2; s += 22) {
        const p = net.pointAt(r, s, {});
        // gerade genug: Richtung 12 m davor und danach ähnlich
        const a = net.pointAt(r, s - W / 2, {}), b = net.pointAt(r, s + W / 2, {});
        if (a.dx * b.dx + a.dz * b.dz < 0.97) continue;
        for (const side of [-1, 1]) {
          const nx = -p.dz * side, nz = p.dx * side;
          const edge = r.w / 2 + (r.sw > 0 ? r.sw : 1.1) + 0.15;
          const cx = p.x + nx * (edge + D / 2), cz = p.z + nz * (edge + D / 2);
          out.push({ r, s, cx, cz, rot: Math.atan2(nx, nz), edge, side, p });
        }
      }
    }
    return out;
  };

  const settlementNear = (x, z) => {
    let best = null;
    for (const s of ctx.settlements) {
      if (!s.pos) continue;
      const d = Math.hypot(s.pos[0] - x, s.pos[1] - z), R = s.r || 250;
      const k = d / R;
      if (!best || k < best.k) best = { s, k, d };
    }
    return best;
  };

  const place = (kind) => {
    const W = kind === 'fuel' ? FUEL.W : SHOP.W, D = kind === 'fuel' ? FUEL.D : SHOP.D;
    const cands = candidates(kind === 'fuel' ? FUEL_KINDS : SHOP_KINDS, W, D);
    // Bewertung: Tankstellen am Ortsrand an Durchgangsstraßen, Werkstätten am Rand der Orte
    for (const c of cands) {
      const sn = settlementNear(c.cx, c.cz);
      const ring = sn ? Math.abs(sn.k - (kind === 'fuel' ? 1.15 : 0.95)) : 3;
      c.score = ring + (c.r.kind === 'main' || c.r.kind === 'rural' ? -0.25 : 0) + (kind === 'repair' && c.r.kind === 'street' ? -0.1 : 0) + rng.next() * 0.35;
    }
    cands.sort((a, b) => a.score - b.score);
    const count = {};
    for (const c of cands) {
      const isl = coast.islandAt(c.cx, c.cz);
      const want = TARGET[kind][isl] || 0;
      if ((count[isl] || 0) >= want) continue;
      if (placed.some((p) => Math.hypot(p.x - c.cx, p.z - c.cz) < (p.kind === kind ? SPACING[kind] : 120))) continue;
      const fr = free(c.cx, c.cz, c.rot, W, D, c.r);
      if (!fr) continue;
      const site = kind === 'fuel' ? buildFuel(ctx, c, rng) : buildRepair(ctx, c, rng);
      if (!site) continue;
      placed.push({ x: c.cx, z: c.cz, kind });
      count[isl] = (count[isl] || 0) + 1;
      for (const b of site.parts) { b.rad = Math.hypot(b.w, b.d) / 2; bh.insert(b, b.x - b.rad, b.z - b.rad, b.x + b.rad, b.z + b.rad); }
    }
  };
  place('fuel');
  place('repair');
}

// Gebäudeteil anlegen (Stil 'service'); fixBase = Fußboden auf Höhe des Vorplatzes
function part(ctx, site, kind, lx, lz, w, d, h, o = {}) {
  const [px, pz] = local(site.x, site.z, site.rot, lx, lz);
  const b = { id: ctx.buildings.length, x: px, z: pz, w, d, rot: site.rot, style: 'service', part: kind, floors: 1, h, roof: 'flat', tint: [1, 1, 1], seed: (ctx.buildings.length * 2654435761) >>> 0, fixBase: site.y - 0.12, site, ...o };
  ctx.buildings.push(b);
  site.parts.push(b);
  return b;
}

// Vorplatz als ebene Fläche (Straßenart 'forecourt'), quer zur Straße x0..x1 bei z0..z1
function apron(ctx, site, x0, x1, z0, z1, alongX = true) {
  const L = (lx, lz) => local(site.x, site.z, site.rot, lx, lz);
  const pts = alongX ? [L(x0, (z0 + z1) / 2), L(x1, (z0 + z1) / 2)] : [L((x0 + x1) / 2, z0), L((x0 + x1) / 2, z1)];
  return ctx.net.addLate('forecourt', pts, { hf: ctx.hf, name: site.kind === 'fuel' ? 'Tankstelle' : 'Werkstatt', noTraffic: true, flat: true, w: alongX ? z1 - z0 : x1 - x0 });
}

function buildFuel(ctx, c, rng) {
  const site = { kind: 'fuel', x: c.cx, z: c.cz, rot: c.rot, parts: [], pumps: [], roadId: c.r.id, edge: c.edge };
  const D = FUEL.D;
  const zf = -D / 2;                                  // Vorderkante (Straßenseite)
  const [a0, a1] = FUEL.apron;
  const r = apron(ctx, site, -FUEL.W / 2 + 1, FUEL.W / 2 - 1, zf, zf + (a1 - a0) + 0.5, true);
  if (!r) return null;
  site.y = r.ys[0] + 0.06;
  const zc = zf + 7.5;                                // Mitte des Daches
  // Dach über den Säulen, Inseln mit Zapfsäulen, Shop, Preissäule
  part(ctx, site, 'canopy', 0, zc, 22, 12.5, 5.6, { colliders: [[-6.6, -3, 0.25, 0.25], [6.6, -3, 0.25, 0.25], [-6.6, 3, 0.25, 0.25], [6.6, 3, 0.25, 0.25]], signIdx: ctx.signs.add('SOL GAS', 'gas') });
  for (const iz of PUMPS.islands) {
    part(ctx, site, 'island', 0, zc + iz + 4.5, 12.5, 1.3, 1.95);
    for (const ix of PUMPS.xs) {
      for (const sg of [-1, 1]) {
        // Tankplatz auf beiden Seiten der Insel: Säule und Standplatz des Autos
        const [px, pz] = local(site.x, site.z, site.rot, ix, zc + iz + 4.5 + sg * 0.95);
        const [vx, vz] = local(site.x, site.z, site.rot, ix, zc + iz + 4.5 + sg * 2.8);
        site.pumps.push({ x: px, z: pz, carX: vx, carZ: vz, side: sg, rot: site.rot });
      }
    }
  }
  const shopZ = zf + (a1 - a0) + 0.5 + 5;
  part(ctx, site, 'shop', -4, shopZ, 15, 9, 4.4, { signIdx: ctx.signs.add('TANKSTELLE', 'gas') });
  part(ctx, site, 'totem', FUEL.W / 2 - 3, zf + 1.6, 2.2, 0.6, 6.5, { signIdx: ctx.signs.add('SOL GAS', 'gas'), priceIdx: ctx.signs.add('SUPER 1,79  DIESEL 1,69', 'gas') });
  ctx.pois.push({ id: 'fuel' + ctx.services.length, type: 'fuel', x: site.x, z: site.z, label: 'Tankstelle' });
  clearProps(ctx, site, FUEL.W, D);
  ctx.services.push(site);
  void rng;
  return site;
}

function buildRepair(ctx, c, rng) {
  const site = { kind: 'repair', x: c.cx, z: c.cz, rot: c.rot, parts: [], roadId: c.r.id, edge: c.edge };
  const D = SHOP.D, H = SHOP.hall;
  const zf = -D / 2, hz0 = zf + 9, hz1 = hz0 + H.d;      // Halle: z von hz0 bis hz1
  // Fahrfläche von der Straße bis an die Rückwand (bildet auch den Hallenboden)
  const r = apron(ctx, site, -H.w / 2 + 0.35, H.w / 2 - 0.35, zf, hz1 - 0.35, false);
  if (!r) return null;
  site.y = r.ys[0] + 0.06;
  const hall = part(ctx, site, 'hall', 0, (hz0 + hz1) / 2, H.w, H.d, H.h, { signIdx: ctx.signs.add('WERKSTATT', 'cars') });
  // Kollider: Wände mit Toröffnung (lokal zum Gebäude), Einrichtung
  const hw = H.w / 2, hd = H.d / 2, g = SHOP.door.w / 2, side = (hw - g) / 2;
  hall.colliders = [
    [-hw + 0.2, 0, 0.2, hd], [hw - 0.2, 0, 0.2, hd], [0, hd - 0.2, hw, 0.2],
    [-g - side, -hd + 0.2, side, 0.2], [g + side, -hd + 0.2, side, 0.2],
    [-hw + 0.9, 2.5, 0.5, 3.5, 1.8], [hw - 0.9, 1.0, 0.5, 4.5, 1.8], [0, hd - 1.0, 3.0, 0.5, 1.0],
  ];
  const [dx, dz] = local(site.x, site.z, site.rot, 0, hz0);
  const [ix, iz] = local(site.x, site.z, site.rot, 0, (hz0 + hz1) / 2 - 0.5);
  site.door = { x: dx, z: dz, w: SHOP.door.w, h: SHOP.door.h, hall };
  site.inside = { x: ix, z: iz, hw: hw - 1.6, hd: hd - 1.6 };
  ctx.pois.push({ id: 'repair' + ctx.services.length, type: 'repair', x: dx, z: dz, label: 'Werkstatt' });
  clearProps(ctx, site, SHOP.W, D);
  ctx.services.push(site);
  void rng;
  return site;
}

// Bäume/Möbel auf dem Gelände entfernen (Platz ist eben und frei)
function clearProps(ctx, site, W, D) {
  const c = Math.cos(site.rot), s = Math.sin(site.rot);
  ctx.props = ctx.props.filter((p) => {
    const dx = p.x - site.x, dz = p.z - site.z;
    return !(Math.abs(c * dx - s * dz) < W / 2 + 1 && Math.abs(s * dx + c * dz) < D / 2 + 1);
  });
}
