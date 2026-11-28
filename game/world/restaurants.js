// Restaurants (reine Weltdaten): Burger, Pizza, Döner, Schnitzel, Pommes. Eingeschossige Lokale an Ortsstraßen mit
// Glasfront, Schiebetür, Theke, Tischen und Küche (gezeichnet in render/restogeom.js). Man geht durch die Tür hinein und
// bestellt an der Theke (world/restort.js); das Essen füllt die Gesundheit auf.
//
// Lokales Raster: x entlang der Straße, z von der Straße weg (z = −D/2 = Front zur Straße).
import { RNG, SpatialHash } from '../util.js';
import { LU } from './landuse.js';

export const RESTO = { W: 13, D: 10.5, H: 4.3, door: { x: 3.5, w: 1.8 }, counterZ: 2.65, orderX: -1.0 };

export const KINDS = {
  burger: { name: 'Burger Bay', sign: 'BURGER BAY', style: 'burger', wall: [0.97, 0.93, 0.86], accent: [0.78, 0.08, 0.1], accent2: [1, 0.78, 0.1],
    menu: [['Cheeseburger', 6, 40], ['Double Burger', 9, 70], ['Burger-Menü mit Pommes', 12, 100], ['Milchshake', 4, 20]] },
  pizza: { name: 'Pizzeria Napoli', sign: 'PIZZERIA NAPOLI', style: 'pizza', wall: [0.96, 0.92, 0.84], accent: [0.05, 0.42, 0.2], accent2: [0.8, 0.1, 0.1],
    menu: [['Pizza Margherita', 8, 55], ['Pizza Salami', 10, 70], ['Pizza Quattro Formaggi', 12, 85], ['Tiramisu', 5, 25]] },
  doner: { name: 'Döner Palast', sign: 'DÖNER PALAST', style: 'doner', wall: [0.95, 0.9, 0.82], accent: [0.5, 0.06, 0.06], accent2: [0.95, 0.72, 0.25],
    menu: [['Döner Kebab', 7, 60], ['Dürüm', 8, 65], ['Döner-Teller', 11, 90], ['Ayran', 2, 10]] },
  schnitzel: { name: 'Schnitzelhaus', sign: 'SCHNITZELHAUS', style: 'schnitzel', wall: [0.93, 0.88, 0.78], accent: [0.36, 0.2, 0.09], accent2: [0.95, 0.88, 0.7],
    menu: [['Wiener Schnitzel', 15, 90], ['Jägerschnitzel', 14, 85], ['Schnitzel mit Pommes', 16, 110], ['Apfelstrudel', 6, 25]] },
  pommes: { name: 'Pommes & Co', sign: 'POMMES & CO', style: 'pommes', wall: [0.98, 0.95, 0.85], accent: [1, 0.78, 0.05], accent2: [0.8, 0.1, 0.08],
    menu: [['Pommes klein', 3, 20], ['Pommes groß', 5, 35], ['Currywurst mit Pommes', 8, 60], ['Frikadelle', 4, 25]] },
};
const ORDER = ['burger', 'pizza', 'doner', 'pommes', 'schnitzel'];
const ROAD_KINDS = new Set(['street', 'avenue', 'promenade', 'main']);
const TARGET = { mallorca: 15, ibiza: 5, menorca: 4, formentera: 2 };

// Tische (lokal): [x, z]; je zwei Stühle links/rechts (±x)
export const TABLES = [[-4.6, -2.3], [-4.6, 0.3], [-1.6, -2.3], [-1.6, 0.3]];

const local = (x, z, rot, lx, lz) => { const c = Math.cos(rot), s = Math.sin(rot); return [x + c * lx + s * lz, z - s * lx + c * lz]; };

// Kollisionswände und Möbel (lokal zum Gebäude: [lx, lz, hx, hz, Höhe?]), Türöffnung vorne
function colliders() {
  const { W, D, door } = RESTO, hw = W / 2, hd = D / 2;
  const g0 = door.x - door.w / 2 - 0.05, g1 = door.x + door.w / 2 + 0.05;
  const list = [
    [-hw + 0.12, 0, 0.12, hd], [hw - 0.12, 0, 0.12, hd], [0, hd - 0.12, hw, 0.12],
    [(-hw + g0) / 2, -hd + 0.12, (g0 + hw) / 2, 0.12], [(g1 + hw) / 2, -hd + 0.12, (hw - g1) / 2, 0.12],
    [-1.4, RESTO.counterZ, 3.6, 0.42, 1.1],                    // Theke
    [-1.4, hd - 0.7, 4.6, 0.45, 1.6],                          // Küchenzeile
  ];
  for (const [x, z] of TABLES) list.push([x, z, 0.45, 0.4, 0.78], [x - 0.75, z, 0.22, 0.22, 0.5], [x + 0.75, z, 0.22, 0.22, 0.5]);
  return list;
}

export function generateRestaurants(ctx) {
  const { net, coast, hf, landuse } = ctx;
  const rng = new RNG(7373);
  ctx.restaurants = [];
  const bh = new SpatialHash(64);
  for (const b of ctx.buildings) { b.rad = Math.hypot(b.w, b.d) / 2; bh.insert(b, b.x - b.rad, b.z - b.rad, b.x + b.rad, b.z + b.rad); }
  const { W, D } = RESTO;
  const avoid = [...(ctx.services || []).map((s) => [s.x, s.z, 45]), ...(ctx.parkingLots || []).map((l) => [l.x, l.z, 35]), ...(ctx.home ? [[ctx.home.x, ctx.home.z, 100]] : [])];
  const free = (cx, cz, rot, road) => {
    let lo = Infinity, hi = -Infinity;
    for (let lz = -D / 2; lz <= D / 2 + 1.01; lz += 2.5) for (let lx = -W / 2 - 1; lx <= W / 2 + 1.01; lx += 2.5) {
      const [px, pz] = local(cx, cz, rot, lx, lz);
      if (coast.sdAt(px, pz) < 10) return null;
      const lu = landuse.get(px, pz);
      if (lu !== 0 && lu !== LU.GARDEN && lu !== LU.URBAN && lu !== LU.BEACHCLUB) return null;
      if (hf.wet.length && hf.wetMask(px, pz)) return null;
      const nr = net.nearest(px, pz, 16);
      if (nr && nr.d < nr.road.w / 2 + nr.road.sw + (nr.road === road ? 0.3 : 2.5)) return null;
      let hit = false;
      bh.query(px - 12, pz - 12, px + 12, pz + 12, (b) => {
        if (hit) return;
        const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = px - b.x, dz = pz - b.z;
        if (Math.abs(c * dx - s * dz) < b.w / 2 + 1.5 && Math.abs(s * dx + c * dz) < b.d / 2 + 1.5) hit = true;
      });
      if (hit) return null;
      const h = hf.h(px, pz); lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    if (hi - lo > 2.0 || lo < 0.6) return null;
    return true;
  };
  const cands = [];
  for (const r of net.roads) {
    if (!r || !ROAD_KINDS.has(r.kind) || r.noTraffic || r.hidden || r.len < W + 40) continue;
    for (let s = 20 + W / 2; s < r.len - 20 - W / 2; s += 14) {
      const p = net.pointAt(r, s, {}), a = net.pointAt(r, s - W / 2, {}), b = net.pointAt(r, s + W / 2, {});
      if (a.dx * b.dx + a.dz * b.dz < 0.985) continue;
      for (const side of [-1, 1]) {
        const nx = -p.dz * side, nz = p.dx * side;
        const edge = r.w / 2 + (r.sw > 0 ? r.sw : 1.0) + 0.05;
        cands.push({ r, s, p, edge, cx: p.x + nx * (edge + D / 2), cz: p.z + nz * (edge + D / 2), rot: Math.atan2(nx, nz) });
      }
    }
  }
  const town = (x, z) => { let k = 9; for (const st of ctx.settlements) { if (!st.pos) continue; k = Math.min(k, Math.hypot(st.pos[0] - x, st.pos[1] - z) / (st.r || 250)); } return k; };
  for (const c of cands) c.score = town(c.cx, c.cz) + (c.r.kind === 'promenade' || c.r.kind === 'avenue' ? -0.25 : 0) + rng.next() * 0.35;
  cands.sort((a, b) => a.score - b.score);
  const count = {};
  let next = 0;
  for (const c of cands) {
    if (c.score > 1.3) break;
    const isl = coast.islandAt(c.cx, c.cz);
    if ((count[isl] || 0) >= (TARGET[isl] || 0)) continue;
    const kind = ORDER[next % ORDER.length];
    if (ctx.restaurants.some((q) => Math.hypot(q.x - c.cx, q.z - c.cz) < (q.kind === kind ? 900 : 160))) continue;
    if (avoid.some(([x, z, r]) => Math.hypot(x - c.cx, z - c.cz) < r)) continue;
    if (!free(c.cx, c.cz, c.rot, c.r)) continue;
    if (!build(ctx, c, kind)) continue;
    next++;
    count[isl] = (count[isl] || 0) + 1;
    const b = ctx.buildings[ctx.buildings.length - 1];
    b.rad = Math.hypot(b.w, b.d) / 2; bh.insert(b, b.x - b.rad, b.z - b.rad, b.x + b.rad, b.z + b.rad);
  }
  return ctx.restaurants.length;
}

function build(ctx, c, kind) {
  const K = KINDS[kind], { W, D, H, door, counterZ, orderX } = RESTO;
  const site = { kind, name: K.name, x: c.cx, z: c.cz, rot: c.rot, roadId: c.r.id };
  const L = (lx, lz) => local(site.x, site.z, site.rot, lx, lz);
  // Gelände eben einschneiden (unsichtbarer Vorplatz von der Gehwegkante bis hinter das Haus); Fußboden = dessen Höhe
  const r = ctx.net.addLate('forecourt', [L(-W / 2 - 0.5, 0.25), L(W / 2 + 0.5, 0.25)], { hf: ctx.hf, name: K.name, noTraffic: true, flat: true, w: D + 1.0, hidden: true });
  if (!r) return null;
  site.y = r.ys[0] + 0.06;
  const signIdx = ctx.signs.add(K.sign, K.style);
  const b = { id: ctx.buildings.length, x: site.x, z: site.z, w: W, d: D, rot: site.rot, style: 'resto', part: 'resto', kind, floors: 1, h: H, roof: 'flat', tint: [1, 1, 1], seed: (ctx.buildings.length * 2654435761) >>> 0, fixBase: site.y - 0.12, signIdx, colliders: colliders(), name: K.name };
  ctx.buildings.push(b);
  site.building = b;                         // Verweis statt Index (clearRoads entfernt Häuser, die Indizes verschieben sich)
  const [dx, dz] = L(door.x, -D / 2 - 1.0), [ix, iz] = L(door.x, -D / 2 + 1.0), [ox, oz] = L(orderX, counterZ - 1.0);
  site.door = { x: dx, z: dz };           // vor der Tür (draußen)
  site.inner = { x: ix, z: iz };          // hinter der Tür (drinnen)
  site.order = { x: ox, z: oz };          // vor der Theke: hier wird bestellt
  site.doorL = { x: door.x, z: -D / 2, w: door.w };
  ctx.pois.push({ id: 'resto' + ctx.restaurants.length, type: 'restaurant', x: dx, z: dz, label: K.name });
  // Bäume/Möbel auf dem Grundstück entfernen
  const co = Math.cos(site.rot), si = Math.sin(site.rot);
  ctx.props = ctx.props.filter((p) => { const ddx = p.x - site.x, ddz = p.z - site.z; return !(Math.abs(co * ddx - si * ddz) < W / 2 + 1.5 && Math.abs(si * ddx + co * ddz) < D / 2 + 1.5); });
  ctx.restaurants.push(site);
  return site;
}
