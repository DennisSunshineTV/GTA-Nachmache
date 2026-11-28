// Das Strandhaus des Spielers („Wohnung“): Holzhaus mit Strohdach mitten im Sand, Terrasse zum Meer, Garage mit
// befahrbarer Holz-Zufahrt zur nächsten Straße. Reine Weltdaten (ohne Three.js).
import { RNG, SpatialHash } from '../util.js';
import { LU } from './landuse.js';

// Abmessungen im Hausraster (x entlang der Küste, z zum Meer)
const MAIN = { w: 11, d: 13, h: 8.4 };
const GARAGE = { w: 9, d: 8, h: 3.7, cx: 12.2, cz: -2.2 };
const GATE = { x: GARAGE.cx, z: GARAGE.cz - GARAGE.d / 2 - 3.2 };         // Vorplatz vor dem Garagentor
const DECK = { x0: -9.6, x1: 8.4, z: 10.6, w: 7.4 };
const WALK_W = 2.5;                                                          // Breite des Holzstegs ums Haus
const ROAD_KINDS_OK = new Set(['street', 'rural', 'main', 'scenic', 'avenue', 'highway']);

// Begehbares Haus und befahrbare Garage (lokale Maße im jeweiligen Gebäude; Haupthaus: +z zum Meer, Garage: −z zum Tor).
// Wird von der Geometrie (render/beachgeom.js) und der Laufzeit (world/homebase.js) gemeinsam genutzt.
export const HOUSE = {
  door: { x: 0, w: 1.24, h: 2.28 },                      // Haustür mitten in der Rückwand (Landseite)
  porch: { d: 2.0, w: 3.0, step: 0.7 },                  // Holzpodest vor der Tür
  bed: { x: -3.9, z: -3.2 },
  marker: { x: -1.8, z: -3.2 },                          // „Speichern & Garage“ neben dem Bett
  spawn: { x: 0.6, z: 1.2 },                             // Aufwachen/Start: Wohnzimmer, Blick aufs Meer
};
export const GARAGE_IN = {
  door: { w: 6.2, h: 2.7 },
  slots: [{ x: -1.75, z: 0.3 }, { x: 1.75, z: 0.3 }],    // Stellplätze (Fahrzeug schaut zum Tor)
};
// Kollisionswände (lokal: [lx, lz, hx, hz, Höhe über Boden oder ganze Wandhöhe]) mit Öffnungen für Tür und Tor
const MAIN_COLLIDERS = (() => {
  const hw = MAIN.w / 2, hd = MAIN.d / 2, g = HOUSE.door.w / 2 + 0.08, side = (hw - g) / 2;
  return [
    [-hw + 0.15, 0, 0.15, hd], [hw - 0.15, 0, 0.15, hd], [0, hd - 0.05, hw, 0.14],
    [-g - side, -hd + 0.15, side, 0.15], [g + side, -hd + 0.15, side, 0.15],
    // Möbel
    [HOUSE.bed.x, HOUSE.bed.z, 1.15, 0.95, 0.65], [-3.6, -5.85, 1.1, 0.32, 2.3], [-4.75, -4.65, 0.27, 0.27, 0.6],
    [4.8, -3.35, 0.4, 1.85, 0.95], [4.8, -5.75, 0.42, 0.42, 2.0], [2.0, -0.4, 0.8, 0.45, 0.78],
    [-1.6, 2.4, 1.5, 0.48, 0.85], [-3.55, 3.45, 0.48, 0.6, 0.85], [-1.6, 3.95, 0.65, 0.35, 0.42],
  ];
})();
const GARAGE_COLLIDERS = (() => {
  const hw = GARAGE.w / 2, hd = GARAGE.d / 2, g = GARAGE_IN.door.w / 2, side = (hw - g) / 2;
  return [
    [-hw + 0.15, 0, 0.15, hd], [hw - 0.15, 0, 0.15, hd], [0, hd - 0.15, hw, 0.15],
    [-g - side, -hd + 0.15, side, 0.15], [g + side, -hd + 0.15, side, 0.15],
    [0, hd - 0.62, 1.5, 0.32, 0.95], [-hw + 0.5, 1.6, 0.2, 1.6, 2.0], [hw - 0.5, 1.6, 0.2, 1.6, 2.0], [-hw + 0.75, -hd + 1.0, 0.34, 0.34, 1.0],
  ];
})();

const local = (x, z, rot, lx, lz) => { const c = Math.cos(rot), s = Math.sin(rot); return [x + c * lx + s * lz, z - s * lx + c * lz]; };

// Liegt die Fläche (lokales Rechteck) frei: Sand, kein Wasser, keine Straße, kein Gebäude?
function areaFree(ctx, bh, x, z, rot, x0, x1, z0, z1, step = 4) {
  const { coast, landuse, hf, net } = ctx;
  for (let lz = z0; lz <= z1; lz += step) for (let lx = x0; lx <= x1; lx += step) {
    const [px, pz] = local(x, z, rot, lx, lz);
    if (coast.sdAt(px, pz) < 5) return false;
    if (landuse.get(px, pz) !== 0) return false;
    if (hf.wet.length && hf.wetMask(px, pz)) return false;
    if (net.nearest(px, pz, 9)) return false;
    let hit = false;
    bh.query(px - 8, pz - 8, px + 8, pz + 8, (b) => { if (!hit && Math.hypot(b.x - px, b.z - pz) < b.rad + 8) hit = true; });
    if (hit) return false;
  }
  return true;
}

// Sucht einen Sandstrand in der Nähe des Startpunkts, an dem das Haus samt Zufahrt Platz hat
export function findSpot(ctx, bh, ref, st = {}) {
  const bump = (k) => { st[k] = (st[k] || 0) + 1; };
  const { coast, hf, net } = ctx;
  const cands = [];
  const R = 8000, step = 10;
  for (let z = ref.z - R; z <= ref.z + R; z += step) {
    for (let x = ref.x - R; x <= ref.x + R; x += step) {
      const sd = coast.sdAt(x, z);
      if (sd < 22 || sd > 34) continue;
      cands.push({ x, z, d: Math.hypot(x - ref.x, z - ref.z) });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  st.cands = cands.length;
  for (const c of cands.slice(0, 20000)) {
    if (coast.islandAt(c.x, c.z) !== 'mallorca') { bump('insel'); continue; }
    const h = hf.base(c.x, c.z);
    if (h < 0.1 || h > 6 || hf.baseSlope(c.x, c.z, 12) > 0.09) { bump('hoehe'); continue; }
    const sea = coast.seaDir(c.x, c.z, {});
    const rot = Math.atan2(sea.x, sea.z);                       // lokales +z zeigt zum Meer
    // Haus, Terrasse, Garage und Vorplatz frei?
    if (!areaFree(ctx, bh, c.x, c.z, rot, -13, 21, -13, 16)) { bump('flaeche'); continue; }
    // Straße für die Zufahrt: nächste befahrbare Straße zum Vorplatz
    const [gx, gz] = local(c.x, c.z, rot, GATE.x, GATE.z);
    const near = net.nearest(gx, gz, 1500, (r) => ROAD_KINDS_OK.has(r.kind) && !r.noTraffic);
    if (!near || near.d < 30) { bump('keineStrasse'); continue; }
    // Strecke muss über Land führen und darf keine Gebäude oder anderen Straßen queren
    const road = near.road;
    const hw = road.w / 2 + road.sw + 0.4;
    const dx = near.x - gx, dz = near.z - gz, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L;
    const ex = near.x - ux * hw, ez = near.z - uz * hw;
    let ok = true;
    for (let t = 6; t < L - hw - 4 && ok; t += 7) {
      const px = gx + ux * t, pz = gz + uz * t;
      if (coast.sdAt(px, pz) < 8 || hf.baseSlope(px, pz, 8) > 0.14) { ok = false; break; }
      const other = net.nearest(px, pz, 7);
      if (other) { ok = false; break; }
      bh.query(px - 12, pz - 12, px + 12, pz + 12, (b) => { if (ok && Math.hypot(b.x - px, b.z - pz) < b.rad + 6) ok = false; });
    }
    if (!ok) { bump('weg'); continue; }
    return { x: c.x, z: c.z, rot, gate: [gx, gz], end: [ex, ez], near };
  }
  return null;
}

export function generateBeachHouse(ctx) {
  const { net, hf, landuse } = ctx;
  const ref = ctx.pois.find((p) => p.id === 'palma.harbor') || ctx.pois.find((p) => p.type === 'city') || { x: 0, z: 0 };
  const bh = new SpatialHash(64);
  for (const b of ctx.buildings) { b.rad = Math.hypot(b.w, b.d) / 2; bh.insert(b, b.x - b.rad, b.z - b.rad, b.x + b.rad, b.z + b.rad); }
  const spot = findSpot(ctx, bh, ref);
  if (!spot) { ctx.home = null; return; }
  const { x, z, rot } = spot;
  const rng = new RNG(4242);
  const L = (lx, lz) => local(x, z, rot, lx, lz);

  // --- Straßen: Terrasse zum Meer, Vorplatz, Zufahrt (Holzbohlen, befahrbar) ---
  const nearY = spot.near.y;
  const deckA = L(DECK.x0, DECK.z), deckB = L(DECK.x1, DECK.z);
  net.addLate('deck', [deckA, deckB], { hf, name: 'Terrasse', noTraffic: true, w: DECK.w, flat: true });
  const gate = L(GATE.x, GATE.z);
  net.addLate('deck', [L(GARAGE.cx - 5.4, GATE.z), gate], { hf, name: 'Vorplatz', noTraffic: true, w: 5.4, flat: true });
  net.addLate('deck', [gate, L(GARAGE.cx + 5.4, GATE.z)], { hf, name: 'Vorplatz', noTraffic: true, w: 5.4, flat: true });
  const mid = [(gate[0] + spot.end[0]) / 2 + rng.range(-3, 3), (gate[1] + spot.end[1]) / 2 + rng.range(-3, 3)];
  net.addLate('deck', [gate, mid, spot.end], { hf, name: 'Beach-House-Zufahrt', noTraffic: true, yB: nearY, w: 6.4 });
  // Holzsteg: vom Vorplatz bis an die Stufe der Haustür und um die Hausseite herum bis zur Terrasse (alles verbunden)
  const walkZ = -MAIN.d / 2 - HOUSE.porch.d - HOUSE.porch.step - WALK_W / 2;
  const corner = L(-MAIN.w / 2 - 1.9, walkZ);
  net.addLate('deck', [L(GARAGE.cx - 5.4, GATE.z), L(GARAGE.cx - 7.4, walkZ), corner], { hf, name: 'Steg', noTraffic: true, w: WALK_W });
  net.addLate('deck', [corner, L(-MAIN.w / 2 - 1.9, DECK.z - DECK.w / 2)], { hf, name: 'Steg', noTraffic: true, w: WALK_W });

  // Boden des Grundstücks: höchster Punkt unter Haus, Garage und Podest. Haus und Garage bekommen einen gemeinsamen,
  // durchgehenden Fußboden darüber – sonst ragt das ansteigende Dünengelände durch den Boden der Innenräume.
  let Y = -1e9;
  const sample = (cx, cz, w, d) => {
    for (let lz = -d / 2; lz <= d / 2 + 1e-6; lz += d / 8) for (let lx = -w / 2; lx <= w / 2 + 1e-6; lx += w / 8) {
      const [px, pz] = L(cx + lx, cz + lz); Y = Math.max(Y, hf.h(px, pz));
    }
  };
  sample(0, 0, MAIN.w, MAIN.d);
  sample(GARAGE.cx, GARAGE.cz, GARAGE.w, GARAGE.d);
  sample(0, -MAIN.d / 2 - HOUSE.porch.d / 2, HOUSE.porch.w, HOUSE.porch.d);
  const floorY = Y + 0.04;
  const deck = net.nearest(...L(0, DECK.z), 6, (r) => r.kind === 'deck');
  const deckY = deck ? deck.y : hf.h(...L(0, DECK.z));

  // --- Gebäude (Teile mit eigener Geometrie in render/beachgeom.js) ---
  const add = (part, lx, lz, w, d, h, o = {}) => {
    const [px, pz] = L(lx, lz);
    const b = { id: ctx.buildings.length, x: px, z: pz, w, d, rot, style: 'beach', part, floors: 2, h, roof: 'gable', tint: [1, 1, 1], seed: Math.floor(rng.next() * 1e9), ...o };
    ctx.buildings.push(b);
    return b;
  };
  // fixBase: Bodenplatte (Fußboden = base + 0.12) für beide auf derselben Höhe
  const main = add('main', 0, 0, MAIN.w, MAIN.d, MAIN.h, { name: 'Beach House', fixBase: floorY - 0.12, deckY, colliders: MAIN_COLLIDERS });
  const garage = add('garage', GARAGE.cx, GARAGE.cz, GARAGE.w, GARAGE.d, GARAGE.h, { fixBase: floorY - 0.12, colliders: GARAGE_COLLIDERS });
  const signIdx = ctx.signs.add('BEACH HOUSE', 'beach');
  add('sign', GATE.x - 8.2, -MAIN.d / 2 - HOUSE.porch.d - HOUSE.porch.step - WALK_W - 0.9, 3.4, 0.3, 1.9, { signIdx, nocollide: false });   // neben dem Steg

  // Sandfläche unter dem Grundstück (kein Bewuchs, helle Bodenfarbe)
  landuse.fillRect(...L(6, -1), 38, 36, -rot, LU.BEACHCLUB);

  // --- Dekoration: Palmen, Liegen, Sonnenschirm ---
  const palms = [[-12.5, 9], [-11.5, -3.5], [-8.2, -10.5], [14.5, 11], [21.5, 4], [4.5, 18], [-5, 18.5], [-12.8, 2]];
  for (const [lx, lz] of palms) {
    const [px, pz] = L(lx, lz);
    if (ctx.coast.sdAt(px, pz) < 3) continue;
    ctx.props.push({ t: 'palm', x: px, z: pz, r: rng.next() * 6.28, s: 0.95 + rng.next() * 0.35, v: rng.int(0, 2) });
  }
  const lg = L(-6.4, 11.8); ctx.props.push({ t: 'lounger', x: lg[0], z: lg[1], r: rot, s: 1, v: 3 });
  const lg2 = L(-3.8, 12.2); ctx.props.push({ t: 'lounger', x: lg2[0], z: lg2[1], r: rot, s: 1, v: 2 });
  const ps = L(-5.2, 13.2); ctx.props.push({ t: 'parasol', x: ps[0], z: ps[1], r: 0, s: 1, v: 0 });

  // --- Eingang, Innenraum und Fahrzeug-Abstellplatz ---
  // door: Start-/Aufwachpunkt im Wohnzimmer (Blick aufs Meer); entry: vor der Haustür; inside: Speichern & Garage
  const door = L(HOUSE.spawn.x, HOUSE.spawn.z);
  const entry = L(HOUSE.door.x, -MAIN.d / 2 - 1.2);
  const inside = L(HOUSE.marker.x, HOUSE.marker.z);
  const fwd = L(0, -1);                       // Richtung "landeinwärts" (lokal −z) als Weltvektor
  const dirX = fwd[0] - x, dirZ = fwd[1] - z;
  const spawn = L(GARAGE.cx, GATE.z - 0.8);
  ctx.home = {
    x, z, rot,
    door: { x: door[0], z: door[1] },
    entry: { x: entry[0], z: entry[1] },
    inside: { x: inside[0], z: inside[1] },
    garage: { x: L(GARAGE.cx, GARAGE.cz)[0], z: L(GARAGE.cx, GARAGE.cz)[1] },
    spawn: { x: spawn[0], z: spawn[1], h: Math.atan2(dirX, dirZ) },
    baseY: Y, floorY,
    mainB: main, garageB: garage,
  };
  ctx.pois.push({ id: 'home', type: 'home', x: inside[0], z: inside[1], label: 'Beach House' });
}
