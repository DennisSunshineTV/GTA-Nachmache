// Siedlungsgeneratoren: Städte, Resort-Streifen, Dörfer, Häfen, Industrie, Flughafen.
// Erzeugt Straßen, Gebäude-Spezifikationen, Landnutzung, Pools, Props und POIs (ohne Three.js).
import { RNG, clamp, lerp, smoothstep, noise2, fbm2, ihash, TAU, wrapPi, strSeed } from '../util.js';
import { LU } from './landuse.js';
import { SETTLEMENTS, PADS } from './map.js';

const STREET_NAMES = ['Carrer Major', 'Carrer del Sol', 'Avinguda Jaume III', 'Carrer de la Mar', 'Passeig des Born', 'Carrer Sant Miquel',
  'Carrer de la Rosa', 'Avinguda Gabriel Roca', 'Carrer del Palau', 'Plaça Major', 'Carrer Blanquerna', 'Carrer de Colom',
  'Avinguda Argentina', 'Carrer de Sant Jaume', 'Carrer Nou', 'Carrer dels Oms', 'Carrer del Mirador', 'Carrer Calvari',
  'Avinguda Joan Miró', 'Carrer de Sa Font', 'Carrer del Vent', 'Carrer Llevant', 'Carrer Tramuntana', 'Carrer de les Palmeres',
  'Carrer Marina', 'Carrer dels Pins', 'Carrer Santa Catalina', 'Carrer Bellavista'];

const HOTEL_A = ['Playa', 'Gran', 'Bahía', 'Sol', 'Mar', 'Palma', 'Costa', 'Cala', 'Azul', 'Mirador', 'Royal', 'Sunset', 'Bella', 'Es', 'Son'];
const HOTEL_B = ['Sol', 'Dorada', 'Marina', 'Palmira', 'Blau', 'Vista', 'Paraíso', 'Vell', 'Pins', 'Sirena', 'Luna', 'Riviera', 'Esmeralda', 'Playa'];

const TINT_WHITE = [[0.96, 0.95, 0.91], [0.95, 0.93, 0.88], [0.93, 0.9, 0.82], [0.97, 0.96, 0.94], [0.92, 0.9, 0.84], [0.94, 0.88, 0.76]];
const TINT_OLD = [[0.93, 0.84, 0.62], [0.9, 0.74, 0.52], [0.86, 0.64, 0.46], [0.94, 0.8, 0.72], [0.95, 0.9, 0.72], [0.8, 0.84, 0.7], [0.92, 0.88, 0.8], [0.88, 0.78, 0.6]];
const TINT_TOWER = [[0.55, 0.78, 0.9], [0.45, 0.65, 0.85], [0.62, 0.85, 0.82], [0.75, 0.85, 0.95], [0.5, 0.7, 0.78], [0.85, 0.9, 0.95]];
const TINT_IND = [[0.78, 0.8, 0.82], [0.7, 0.75, 0.8], [0.85, 0.82, 0.75], [0.62, 0.7, 0.75], [0.82, 0.55, 0.5], [0.6, 0.72, 0.6]];

const pick = (rng, a) => a[Math.floor(rng.next() * a.length)];

export function generateSettlements(ctx) {
  ctx.settlements = SETTLEMENTS.map((s) => ({ ...s, seed: strSeed(s.id) }));
  ctx.buildings = []; ctx.props = []; ctx.pools = []; ctx.platforms = []; ctx.boats = []; ctx.pois = []; ctx.parks = [];
  ctx.streetNames = STREET_NAMES;

  for (const s of ctx.settlements) resolvePos(ctx, s);

  // Talböden / Plateaus
  for (const s of ctx.settlements) {
    if (!s.pos) continue;
    const p = PADS[s.id];
    if (p) ctx.hf.addPlateau(s.pos[0], s.pos[1], p.r, p.blend, p.h);
    else if (s.kind === 'city' || s.kind === 'village' || s.kind === 'industrial') ctx.hf.addPlateau(s.pos[0], s.pos[1], (s.r || 200) * 0.7, (s.r || 200) * 0.5);
  }

  const GEN = { airport: genAirport, city: genCity, industrial: genIndustrial, resort: genStrip, fishing: genFishing, village: genVillage };
  for (const kind of ['airport', 'city', 'industrial', 'resort', 'fishing', 'village']) {
    for (const s of ctx.settlements) {
      if (s.kind !== kind || !s.pos) continue;
      ctx.rng = new RNG(s.seed);
      try { GEN[kind](ctx, s); } catch (e) { console.warn('Siedlung fehlgeschlagen:', s.id, e); }
      if (!s.gates || !s.gates.length) {
        // Notfall: einzelner Knoten
        const id = ctx.net.addNode(s.pos[0], s.pos[1], 3);
        s.gates = [id];
      }
    }
  }
}

function resolvePos(ctx, s) {
  const { coast } = ctx;
  let x, z;
  if (Array.isArray(s.at)) [x, z] = s.at;
  else {
    const hit = coast.rayHit(s.at.isl, s.at.deg);
    if (!hit) return;
    x = hit.x - hit.dx * s.at.in; z = hit.z - hit.dz * s.at.in;
  }
  if (s.kind === 'resort' || s.kind === 'fishing') {
    // an die nächste Küste legen
    const c = coast.pathNear(x, z, 0, 0)[0];
    if (!c) return;
    s.coastPt = c;
    const inl = s.kind === 'fishing' ? (s.r || 200) * 0.5 : (s.depth || 200) * 0.5;
    s.pos = [c.x + c.nx * inl, c.z + c.nz * inl];
    return;
  }
  // Landesinneres: ggf. von der Küste wegschieben
  const need = Math.min((s.r || 200) * 0.7, 260);
  for (let k = 0; k < 40; k++) {
    const sd = coast.sdAt(x, z);
    if (sd >= need) break;
    const d = coast.seaDir(x, z, {});
    if (!d.x && !d.z) break;
    x -= d.x * 25; z -= d.z * 25;
  }
  s.pos = [x, z];
}

// ---------- Hilfen ----------

function okPoint(ctx, x, z, minSd, maxSlope = 0.3) {
  const { coast, landuse, hf } = ctx;
  if (coast.sdAt(x, z) < minSd) return false;
  if (landuse.get(x, z) !== 0) return false;
  if (maxSlope && hf.baseSlope(x, z, 8) > maxSlope) return false;
  const w = hf.wet.length ? hf.wetMask(x, z) : null;
  if (w && w.m > 0.05) return false;
  return true;
}

function newTint(rng, palette) {
  const t = pick(rng, palette);
  const k = 0.96 + rng.next() * 0.08;
  return [clamp(t[0] * k, 0, 1), clamp(t[1] * k, 0, 1), clamp(t[2] * k, 0, 1)];
}

function hotelName(rng) { return `Hotel ${pick(rng, HOTEL_A)} ${pick(rng, HOTEL_B)}`; }

// Gebäude hinzufügen (Position im Block-Koordinatensystem a (u), b (v))
function addB(ctx, blk, a, b, w, d, o) {
  const rng = ctx.rng;
  const x = blk.cx + blk.ux * a + blk.vx * b, z = blk.cz + blk.uz * a + blk.vz * b;
  const style = o.style;
  const floorH = style === 'tower' || style === 'office' ? 3.7 : style === 'ware' ? 1 : 3.1;
  const floors = o.floors ?? 3;
  const h = o.h ?? (style === 'ware' ? o.height : floors * floorH + (o.shop ? 1.1 : 0.5));
  const spec = {
    id: ctx.buildings.length, x, z, w, d, rot: blk.rot, style, floors, h,
    roof: o.roof || 'flat', tint: o.tint || newTint(rng, TINT_WHITE), seed: Math.floor(rng.next() * 1e9),
    shop: !!o.shop, balconies: !!o.balconies, tag: o.tag || null, name: o.name || null, sign: o.sign || null, neon: o.neon || null,
    rise: o.rise, tower: style === 'tower',
  };
  if (o.sign) spec.signIdx = ctx.signs.add(o.sign.text, o.sign.style);
  ctx.buildings.push(spec);
  return spec;
}

function addPool(ctx, x, z, rot, w, d, shape = 'rect', island = false) {
  const pool = { x, z, rot, w, d, shape, island };
  ctx.pools.push(pool);
  // Liegen & Sonnenschirme rund um den Pool
  const rng = ctx.rng;
  const c = Math.cos(rot), s = Math.sin(rot);
  const loc = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
  const n = Math.max(2, Math.floor(w / 3.2));
  for (let k = 0; k < n; k++) {
    const lx = -w / 2 + ((k + 0.5) / n) * w;
    for (const side of [-1, 1]) {
      if (rng.next() < 0.22) continue;
      const [px, pz] = loc(lx, side * (d / 2 + 2.0));
      ctx.props.push({ t: 'lounger', x: px, z: pz, r: rot + (side > 0 ? Math.PI : 0) + Math.PI / 2 * 0, s: 1, v: rng.int(0, 3) });
      if (k % 3 === 1 && rng.next() < 0.85) {
        const [qx, qz] = loc(lx + 1.3, side * (d / 2 + 3.9));
        ctx.props.push({ t: 'parasol', x: qx, z: qz, r: rng.next() * TAU, s: 1, v: 0 });
      }
    }
  }
  return pool;
}

function addPalm(ctx, x, z, s = 1) { ctx.props.push({ t: 'palm', x, z, r: ctx.rng.next() * TAU, s: s * (0.85 + ctx.rng.next() * 0.35), v: ctx.rng.int(0, 2) }); }

// ---------- Gitter (Lattice) ----------

function runLattice(ctx, s, o) {
  const { net, rng, landuse } = ctx;
  const key = (i, j) => (i + 512) * 1024 + (j + 512);
  const nodes = new Map(), posMap = new Map();
  for (let j = o.J0; j <= o.J1; j++) {
    for (let i = o.I0; i <= o.I1; i++) {
      const p = o.P(i, j);
      if (o.valid(i, j, p[0], p[1])) {
        nodes.set(key(i, j), net.addNode(p[0], p[1], 3));
        posMap.set(key(i, j), p);
      }
    }
  }
  const eI = new Map(), eJ = new Map();
  const deg = new Map();
  const bump = (id) => deg.set(id, (deg.get(id) || 0) + 1);
  const sub = o.sub || 1;
  const makeEdge = (map, i0, j0, i1, j1, kind, isI) => {
    const a = nodes.get(key(i0, j0)), b = nodes.get(key(i1, j1));
    if (a === undefined || b === undefined || a === b) return;
    const mid = o.P((i0 + i1) / 2, (j0 + j1) / 2);
    if (!o.valid((i0 + i1) / 2, (j0 + j1) / 2, mid[0], mid[1], true)) return;
    if (rng.next() < (o.removeProb ?? 0.03)) return;
    const pts = [];
    for (let k = 0; k <= sub; k++) pts.push(o.P(i0 + ((i1 - i0) * k) / sub, j0 + ((j1 - j0) * k) / sub));
    const road = net.addRoad(kind, pts, a, b, { urban: true, name: STREET_NAMES[Math.floor(rng.next() * STREET_NAMES.length)] });
    if (!road) return;
    map.set(key(i0, j0), road);
    bump(a); bump(b);
  };
  for (let j = o.J0; j <= o.J1; j++) {
    for (let i = o.I0; i <= o.I1; i++) {
      if (!o.noI) makeEdge(eI, i, j, i + 1, j, o.kindI(i, j), true);
      if (!o.noJ) makeEdge(eJ, i, j, i, j + 1, o.kindJ(i, j), false);
    }
  }
  // Blöcke
  const blocks = [];
  for (let j = o.J0; j < o.J1; j++) {
    for (let i = o.I0; i < o.I1; i++) {
      const n = [nodes.get(key(i, j)), nodes.get(key(i + 1, j)), nodes.get(key(i + 1, j + 1)), nodes.get(key(i, j + 1))];
      if (n.some((q) => q === undefined)) continue;
      const roads = [eI.get(key(i, j)), eI.get(key(i, j + 1)), eJ.get(key(i, j)), eJ.get(key(i + 1, j))];
      const c = [posMap.get(key(i, j)), posMap.get(key(i + 1, j)), posMap.get(key(i + 1, j + 1)), posMap.get(key(i, j + 1))];
      const cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, cz = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4;
      if (roads.some((r) => !r)) {
        // Park / Brachfläche
        landuse.fillPoly(c, LU.GARDEN);
        ctx.parks.push({ x: cx, z: cz, c });
        continue;
      }
      let ux = (c[1][0] - c[0][0] + c[2][0] - c[3][0]) / 2, uz = (c[1][1] - c[0][1] + c[2][1] - c[3][1]) / 2;
      const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      const vx = -uz, vz = ux;
      const m = Math.min(...roads.map((r) => r.w / 2 + r.sw)) + 1.6;
      const d01 = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]), d32 = Math.hypot(c[2][0] - c[3][0], c[2][1] - c[3][1]);
      const d03 = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1]), d12 = Math.hypot(c[2][0] - c[1][0], c[2][1] - c[1][1]);
      const lu = (d01 + d32) / 2 - 2 * m, lv = (d03 + d12) / 2 - 2 * m;
      const blk = { i, j, cx, cz, ux, uz, vx, vz, rot: Math.atan2(-uz, ux), lu, lv, c, m, roads };
      blocks.push(blk);
    }
  }
  for (const blk of blocks) {
    const mode = o.mode(blk);
    const code = LU_FOR_MODE[mode] ?? LU.URBAN;
    landuse.fillPoly(blk.c, code);
    if (blk.lu < 12 || blk.lv < 10) continue;
    o.fill(blk, mode);
  }
  // Tore: Randknoten
  const gates = [];
  for (const [k, id] of nodes) if ((deg.get(id) || 0) > 0 && (deg.get(id) || 0) <= 3) gates.push(id);
  const all = [...nodes.values()].filter((id) => deg.get(id));
  s.nodeIds = all;
  s.gates = gates.length ? gates : all;
  return { nodes, blocks, gates: s.gates };
}

const LU_FOR_MODE = {
  downtown: LU.URBAN, commercial: LU.URBAN, residential: LU.URBAN, old: LU.URBAN, suburb: LU.GARDEN, industrial: LU.INDUSTRIAL,
  hotelBig: LU.HOTEL, hotelPool: LU.HOTEL, hotelMid: LU.HOTEL, night: LU.URBAN, harbor: LU.HARBOR, villa: LU.GARDEN,
};

// Jitter-Gitter: integer jitter, bilinear interpoliert
function jitterFn(seed, amp) {
  const j = (i, k) => [(ihash(i, k, seed) - 0.5) * 2 * amp, (ihash(i, k, seed + 91) - 0.5) * 2 * amp];
  return (fi, fj) => {
    const i0 = Math.floor(fi), j0 = Math.floor(fj), tx = fi - i0, tz = fj - j0;
    const a = j(i0, j0), b = j(i0 + 1, j0), c = j(i0, j0 + 1), d = j(i0 + 1, j0 + 1);
    return [lerp(lerp(a[0], b[0], tx), lerp(c[0], d[0], tx), tz), lerp(lerp(a[1], b[1], tx), lerp(c[1], d[1], tx), tz)];
  };
}

// ---------- Block-Füllung ----------

// Teilt [-lu/2, lu/2] in Abschnitte
function segments(lu, target, rng, gap = 1.2) {
  const n = Math.max(1, Math.round(lu / target));
  const w = lu / n;
  const out = [];
  for (let k = 0; k < n; k++) out.push([-lu / 2 + k * w + gap / 2, -lu / 2 + (k + 1) * w - gap / 2]);
  return out;
}

function frontSign(ctx, blk) {
  const sea = ctx.coast.seaDir(blk.cx, blk.cz, {});
  return blk.vx * sea.x + blk.vz * sea.z >= 0 ? 1 : -1;
}

function fillBlock(ctx, s, blk, mode) {
  const rng = ctx.rng;
  const { lu, lv } = blk;
  const dcore = Math.hypot(blk.cx - (s.core ? s.core[0] : s.pos[0]), blk.cz - (s.core ? s.core[1] : s.pos[1]));
  switch (mode) {
    case 'downtown': {
      if (rng.next() < 0.62 && lu > 26 && lv > 22) {
        const f = Math.round(lerp(46, 20, clamp(dcore / 260, 0, 1)) * (0.7 + rng.next() * 0.7));
        const w = clamp(lu - rng.range(4, 12), 24, 48), d = clamp(lv - rng.range(4, 12), 22, 40);
        const b = addB(ctx, blk, rng.range(-2, 2), rng.range(-2, 2), w, d, { style: 'tower', floors: f, tint: newTint(rng, TINT_TOWER), roof: 'flat' });
        if (f > 30 && rng.next() < 0.5) b.spire = true;
        if (f > 28 && rng.next() < 0.6) b.sign = { text: pick(rng, ['BANCA MARCH', 'CAIXA', 'GRUP ILLES', 'SOL TELECOM', 'MALLORCA INVEST', 'IBERO AIR']), style: 'bank' }, b.signIdx = ctx.signs.add(b.sign.text, b.sign.style);
      } else {
        for (const [a0, a1] of segments(lu, 24, rng)) {
          addB(ctx, blk, (a0 + a1) / 2, 0, a1 - a0, lv - 3, { style: 'office', floors: rng.int(6, 14), tint: newTint(rng, TINT_TOWER), roof: 'flat' });
        }
      }
      break;
    }
    case 'commercial': {
      const rows = lv > 38 ? 2 : 1;
      for (let r = 0; r < rows; r++) {
        const d = rows === 2 ? (lv - 2) / 2 - 1 : lv - 2;
        const b0 = rows === 2 ? (r === 0 ? -lv / 4 : lv / 4) : 0;
        for (const [a0, a1] of segments(lu, 17, rng)) {
          const front = rows === 1 || r === 0;
          const style = rng.next() < 0.18 && front ? 'office' : 'apt';
          addB(ctx, blk, (a0 + a1) / 2, b0, a1 - a0, d, {
            style, floors: rng.int(4, style === 'office' ? 10 : 7), shop: front, tint: newTint(rng, style === 'office' ? TINT_TOWER : TINT_WHITE),
            roof: rng.next() < 0.75 ? 'flat' : 'gable', balconies: style === 'apt' && rng.next() < 0.5,
            sign: front && rng.next() < 0.28 ? { text: pick(rng, ['MODA', 'Souvenirs', 'Bazar', 'Farmàcia', 'Supermercat', 'Boutique', 'Calzados', 'Tapas']), style: 'shop' } : null,
          });
        }
      }
      break;
    }
    case 'residential': {
      const rows = lv > 34 ? 2 : 1;
      for (let r = 0; r < rows; r++) {
        const d = rows === 2 ? (lv - 6) / 2 : lv - 4;
        const b0 = rows === 2 ? (r === 0 ? -(lv / 4 + 1.5) : lv / 4 + 1.5) : 0;
        for (const [a0, a1] of segments(lu, 19, rng, 3)) {
          addB(ctx, blk, (a0 + a1) / 2, b0, a1 - a0, d, {
            style: 'apt', floors: rng.int(3, 6), tint: newTint(rng, TINT_WHITE), roof: rng.next() < 0.5 ? 'flat' : rng.next() < 0.6 ? 'gable' : 'hip',
            balconies: rng.next() < 0.6, shop: false,
          });
        }
      }
      break;
    }
    case 'suburb': {
      const n = Math.max(1, Math.round(lu / 22));
      for (let r = 0; r < 2; r++) {
        for (let k = 0; k < n; k++) {
          if (rng.next() < 0.12) continue;
          const w = rng.range(10, 15), d = rng.range(9, 13);
          const a = -lu / 2 + ((k + 0.5) / n) * lu + rng.range(-2, 2);
          const b = (r === 0 ? -1 : 1) * (lv / 2 - d / 2 - rng.range(3, 6));
          addB(ctx, blk, a, b, w, d, { style: 'house', floors: rng.int(1, 2), tint: newTint(rng, TINT_WHITE), roof: rng.next() < 0.7 ? 'gable' : 'hip' });
          if (rng.next() < 0.4) {
            const px = blk.cx + blk.ux * (a + w / 2 + 5) + blk.vx * (b + (r === 0 ? 1 : -1) * (d / 2 + 4)), pz = blk.cz + blk.uz * (a + w / 2 + 5) + blk.vz * (b + (r === 0 ? 1 : -1) * (d / 2 + 4));
            addPool(ctx, px, pz, blk.rot, 8, 4, 'rect');
          }
          if (rng.next() < 0.8) {
            const px = blk.cx + blk.ux * (a - w / 2 - 2.5) + blk.vx * b, pz = blk.cz + blk.uz * (a - w / 2 - 2.5) + blk.vz * b;
            addPalm(ctx, px, pz, 0.8);
          }
        }
      }
      break;
    }
    case 'old': {
      const rows = lv > 30 ? 2 : 1;
      const church = !s._church && dcore < 160 && lu > 22 && lv > 30;
      if (church) {
        s._church = true;
        addB(ctx, blk, 0, 0, Math.min(24, lu - 4), Math.min(40, lv - 4), { style: 'church', floors: 5, h: 20, roof: 'gable', tint: [0.9, 0.82, 0.64], name: 'Església' });
        ctx.pois.push({ id: s.id + '.church', type: 'church', x: blk.cx, z: blk.cz, label: s.name + ' Kirche' });
        break;
      }
      for (let r = 0; r < rows; r++) {
        const d = rows === 2 ? (lv - 3) / 2 : lv - 2;
        const b0 = rows === 2 ? (r === 0 ? -(lv / 4 + 0.7) : lv / 4 + 0.7) : 0;
        for (const [a0, a1] of segments(lu, 9.5, rng, 0.2)) {
          const front = r === 0 || rows === 1;
          addB(ctx, blk, (a0 + a1) / 2, b0, a1 - a0, d, {
            style: 'old', floors: rng.int(2, 5), tint: newTint(rng, TINT_OLD), roof: rng.next() < 0.8 ? 'gable' : 'hip', shop: front && rng.next() < 0.5,
            sign: front && rng.next() < 0.18 ? { text: pick(rng, ['Café', 'Bar Es Pla', 'Restaurant', 'Panaderia', 'Cervecería', 'Tapas', 'Heladería', 'Ferretería']), style: rng.next() < 0.5 ? 'cafe' : 'bar' } : null,
          });
        }
      }
      break;
    }
    case 'industrial': {
      const n = lv > 70 ? 2 : 1;
      for (let r = 0; r < n; r++) {
        const d = n === 2 ? lv / 2 - 6 : lv * 0.55;
        const b0 = n === 2 ? (r === 0 ? -lv / 4 : lv / 4) : -lv * 0.2;
        for (const [a0, a1] of segments(lu, rng.range(40, 60), rng, 5)) {
          addB(ctx, blk, (a0 + a1) / 2, b0, a1 - a0, d, { style: 'ware', floors: 1, height: rng.range(8, 13), tint: newTint(rng, TINT_IND), roof: 'flat' });
        }
      }
      // Containerstapel / Tanks
      const k = rng.int(2, 6);
      for (let q = 0; q < k; q++) {
        const px = blk.cx + blk.ux * rng.range(-lu / 2, lu / 2) + blk.vx * lv * 0.38, pz = blk.cz + blk.uz * rng.range(-lu / 2, lu / 2) + blk.vz * lv * 0.38;
        ctx.props.push({ t: 'container', x: px, z: pz, r: blk.rot + (rng.next() < 0.5 ? 0 : Math.PI / 2), s: 1, v: rng.int(0, 5) });
      }
      break;
    }
    case 'hotelBig': case 'hotelPool': case 'hotelMid': hotelComplex(ctx, s, blk, mode, dcore); break;
    case 'night': nightBlock(ctx, s, blk); break;
    case 'harbor': {
      for (const [a0, a1] of segments(lu, 12, rng, 1)) {
        addB(ctx, blk, (a0 + a1) / 2, 0, a1 - a0, lv - 2, { style: 'old', floors: rng.int(2, 3), tint: newTint(rng, TINT_OLD), roof: 'gable', shop: true,
          sign: rng.next() < 0.4 ? { text: pick(rng, ['Restaurante Marinero', 'Pescados', 'Bar Port', 'Mariscos', 'Café del Port']), style: 'bar' } : null });
      }
      break;
    }
    default: break;
  }
  // Straßenbäume: Palmen an den Blockecken
  if (mode !== 'industrial' && mode !== 'downtown' && rng.next() < 0.5) {
    const k = rng.int(0, 3);
    const px = blk.cx + blk.ux * (k % 2 ? lu / 2 : -lu / 2) + blk.vx * (k < 2 ? lv / 2 + 1 : -lv / 2 - 1);
    const pz = blk.cz + blk.uz * (k % 2 ? lu / 2 : -lu / 2) + blk.vz * (k < 2 ? lv / 2 + 1 : -lv / 2 - 1);
    addPalm(ctx, px, pz);
  }
}

// Hotelanlage rund um einen Pool (Innenhof)
function hotelComplex(ctx, s, blk, mode, dcore) {
  const rng = ctx.rng;
  const { lu, lv } = blk;
  const fs = frontSign(ctx, blk);
  const big = mode === 'hotelBig', pool = mode === 'hotelPool';
  const name = hotelName(rng);
  const slabD = big ? 17 : 15;
  const floorsMain = big ? rng.int(6, 9) : pool ? rng.int(4, 5) : rng.int(3, 5);
  const tint = rng.next() < 0.8 ? [0.97, 0.96, 0.93] : newTint(rng, TINT_WHITE);
  const common = { style: 'hotel', tint, roof: 'flat', balconies: true };
  const mainSign = { text: name, style: 'hotel' };
  if (lv < 46) {
    // kleiner Block: einfacher Riegel
    addB(ctx, blk, 0, 0, lu - 2, lv - 4, { ...common, floors: floorsMain, sign: mainSign });
    return;
  }
  const front = fs * (lv / 2 - slabD / 2 - 1);
  const slab = addB(ctx, blk, 0, front, lu - 2, slabD, { ...common, floors: floorsMain, sign: mainSign, name });
  slab.hotel = name;
  const wingD = lv - slabD - 4;
  const wingW = pool ? 17 : 15;
  const wingB = -fs * (lv / 2 - wingD / 2 - 1);
  const wf = Math.max(3, floorsMain - rng.int(1, 2));
  addB(ctx, blk, -(lu / 2 - wingW / 2 - 1), wingB, wingW, wingD, { ...common, floors: wf });
  addB(ctx, blk, lu / 2 - wingW / 2 - 1, wingB, wingW, wingD, { ...common, floors: wf });
  // Innenhof: Pool
  const cw = lu - 2 * wingW - 8, cd = wingD - 8;
  if (cw > 12 && cd > 8) {
    const px = blk.cx + blk.ux * 0 + blk.vx * (wingB - 0), pz = blk.cz + blk.uz * 0 + blk.vz * (wingB - 0);
    addPool(ctx, px, pz, blk.rot, Math.min(cw * 0.82, 46), Math.min(cd * 0.62, pool ? 26 : 18), pool || rng.next() < 0.45 ? 'kidney' : 'rect', pool);
    for (const k of [-1, 1]) {
      addPalm(ctx, px + blk.ux * k * (cw / 2 - 2), pz + blk.uz * k * (cw / 2 - 2));
      addPalm(ctx, px + blk.ux * k * (cw / 2 - 2) + blk.vx * cd * 0.4, pz + blk.uz * k * (cw / 2 - 2) + blk.vz * cd * 0.4, 1.1);
    }
  }
  if (big) {
    // Eingangsgebäude
    addB(ctx, blk, 0, front + fs * (slabD / 2 + 5), Math.min(22, lu * 0.3), 9, { style: 'shop', floors: 1, h: 5.4, tint: [0.92, 0.9, 0.84], roof: 'flat' });
  }
}

// Nachtleben-Block: Clubs & Bars mit Neonschildern
function nightBlock(ctx, s, blk) {
  const rng = ctx.rng;
  const { lu, lv } = blk;
  const fs = frontSign(ctx, blk);
  const n = Math.max(1, Math.round(lu / 26));
  const names = ['CLUB NEON', 'SUNSET BAR', 'LA NOCHE', 'BAMBOO', 'PLAYA CLUB', 'MOJITO', 'ROCKET', 'AFTERGLOW', 'TROPICANA', 'PARADISE', 'Pacha Beach', 'Sky Lounge', 'DISCO 92', 'Cocktails'];
  for (let k = 0; k < n; k++) {
    const a = -lu / 2 + ((k + 0.5) / n) * lu;
    const w = lu / n - 2;
    const club = rng.next() < 0.55;
    const nm = pick(rng, names);
    const b = addB(ctx, blk, a, fs * (lv / 2 - (lv * 0.55) / 2), w, lv * 0.55, {
      style: club ? 'club' : 'apt', floors: club ? rng.int(2, 3) : rng.int(3, 5), shop: !club, tint: club ? [0.18, 0.15, 0.25] : newTint(rng, TINT_WHITE),
      roof: 'flat', neon: club ? pick(rng, [[1, 0.2, 0.9], [0.1, 0.9, 1], [1, 0.5, 0.1], [0.6, 0.3, 1]]) : null,
      sign: { text: nm, style: club ? 'club' : 'bar' }, tag: club ? 'club' : null, name: nm,
    });
    if (club) ctx.pois.push({ id: s.id + '.club' + k, type: 'club', x: b.x, z: b.z, label: nm, bid: b.id });
    // Hotel dahinter
    addB(ctx, blk, a, -fs * (lv / 2 - (lv * 0.4) / 2), w, lv * 0.4 - 2, { style: 'hotel', floors: rng.int(4, 7), tint: [0.96, 0.94, 0.9], roof: 'flat', balconies: true });
  }
}

// ---------- Stadt ----------

function genCity(ctx, s) {
  const { coast, hf, rng } = ctx;
  s._firstB = ctx.buildings.length;
  const [cx, cz] = s.pos, th = s.angle || 0, [bw, bd] = s.block;
  const ux = Math.cos(th), uz = Math.sin(th), vx = -uz, vz = ux;
  const R = s.r;
  const NI = Math.ceil(R / bw) + 1, NJ = Math.ceil(R / bd) + 1;
  const jit = jitterFn(s.seed, 5);
  const P = (i, j) => { const [jx, jz] = jit(i, j); return [cx + ux * i * bw + vx * j * bd + jx, cz + uz * i * bw + vz * j * bd + jz]; };
  const isPalma = s.id === 'palma';
  const minSd = s.port ? 92 : 40;
  // Kern: bei Küstenstädten nahe dem Wasser
  if (s.port) {
    const cp = coast.pathNear(cx, cz, 0, 0)[0];
    s.coastPt = cp;
    s.core = [cp.x + cp.nx * 330, cp.z + cp.nz * 330];
  } else s.core = [cx, cz];
  const oldC = s.core;
  ctx.cityOf = ctx.cityOf || [];
  const ring = (x, z) => Math.hypot(x - cx, z - cz) / R;
  const valid = (i, j, x, z) => {
    const d = Math.hypot(x - cx, z - cz);
    if (d > R * (0.82 + 0.3 * noise2(x / 280, z / 280, s.seed))) return false;
    return okPoint(ctx, x, z, minSd, 0.26);
  };
  const dOld = (x, z) => Math.hypot(x - oldC[0], z - oldC[1]);
  const res = runLattice(ctx, s, {
    I0: -NI, I1: NI, J0: -NJ, J1: NJ, P, valid, removeProb: 0.035,
    kindI: (i, j) => (j % 5 === 0 ? 'avenue' : 'street'),
    kindJ: (i, j) => (i % 5 === 0 ? 'avenue' : 'street'),
    mode: (blk) => {
      const d = dOld(blk.cx, blk.cz);
      const t = ring(blk.cx, blk.cz);
      const big = s.towers > 0;
      if (big && d < 250) return d < 150 || ihash(blk.i, blk.j, 3) < 0.4 ? 'downtown' : 'commercial';
      if (big && d < 430 && ihash(blk.i, blk.j, 4) < 0.5) return 'old';
      if (d < 120) return 'old';
      if (d < (big ? 560 : 300)) return ihash(blk.i, blk.j, 5) < 0.55 ? 'commercial' : 'residential';
      if (t < 0.75) return 'residential';
      return ihash(blk.i, blk.j, 6) < 0.8 ? 'suburb' : 'residential';
    },
    fill: (blk, mode) => fillBlock(ctx, s, blk, mode),
  });
  void hf; void rng;
  // Küstenpromenade + Hafen
  if (s.port && s.coastPt) {
    promenade(ctx, s, s.coastPt, 1500, 46, res);
    harbor(ctx, s, s.coastPt, 520, { piers: 7, big: true });
  }
  // POIs
  ctx.pois.push({ id: s.id + '.center', type: 'city', x: s.core[0], z: s.core[1], label: s.name });
  tagLandmarks(ctx, s, res);
}

// Besondere Gebäude (Bank, Juwelier, Autohaus, Waffenladen, Polizei, Klinik) in Städten
function tagLandmarks(ctx, s, res) {
  const rng = ctx.rng;
  const here = ctx.buildings.filter((b) => b.id >= (s._firstB ?? 0) && Math.hypot(b.x - (s.core?.[0] ?? s.pos[0]), b.z - (s.core?.[1] ?? s.pos[1])) < (s.r || 300) * 0.8 && (b.style === 'apt' || b.style === 'office' || b.style === 'old') && b.w > 14 && b.w < 28 && !b.tag);
  const take = (tag, label, style, text, pred) => {
    const c = here.filter((b) => !b.tag && pred(b));
    if (!c.length) return;
    const core = s.core || s.pos;
    c.sort((a, b) => Math.hypot(a.x - core[0], a.z - core[1]) - Math.hypot(b.x - core[0], b.z - core[1]));
    const b = c[Math.min(c.length - 1, rng.int(0, 2))];
    b.tag = tag; b.name = label; b.shop = true; b.sign = { text, style }; b.signIdx = ctx.signs.add(text, style);
    ctx.pois.push({ id: s.id + '.' + tag, type: tag, x: b.x, z: b.z, label, bid: b.id });
  };
  take('bank', 'Banco de Mallorca', 'bank', 'BANCO DE MALLORCA', (b) => b.floors >= 4);
  take('jewelry', 'Joyería Oro', 'jewel', 'JOYERÍA ORO', (b) => b.floors <= 5);
  take('gunshop', 'Armería Cala', 'gun', 'ARMERÍA CALA', (b) => b.floors <= 4);
  take('carshop', 'Auto Luxe Palma', 'cars', 'AUTO LUXE', (b) => b.w > 17);
  take('police', 'Policía Local', 'police', 'POLICÍA', (b) => true);
  take('clinic', 'Clínica', 'clinic', 'CLÍNICA', (b) => b.floors >= 3);
}

// Küstenpromenade (Straße entlang des Strandes) mit Anschlüssen an das Gitter
function promenade(ctx, s, cp, len, off, res) {
  const { net, coast, landuse } = ctx;
  const path = smoothPath(coast.pathNear(cp.x, cp.z, len, off));
  const keep = [];
  for (let i = 0; i < path.length; i += 3) {
    const p = path[i];
    const lu = landuse.get(p.x, p.z);
    if (coast.sdAt(p.x, p.z) > 12 && (lu === 0 || lu === LU.HARBOR)) keep.push([p.x, p.z]);
  }
  if (keep.length < 3) return null;
  const ids = [];
  for (let i = 0; i < keep.length; i += 4) ids.push(i);
  if (ids[ids.length - 1] !== keep.length - 1) ids.push(keep.length - 1);
  const nodeIds = ids.map((k) => net.addNode(keep[k][0], keep[k][1], 4));
  for (let q = 0; q < ids.length - 1; q++) {
    const seg = keep.slice(ids[q], ids[q + 1] + 1);
    if (seg.length < 2 || nodeIds[q] === nodeIds[q + 1]) continue;
    net.addRoad('promenade', seg, nodeIds[q], nodeIds[q + 1], { urban: true, name: 'Passeig Marítim' });
  }
  // Anschlüsse ans Stadtgitter
  for (const id of nodeIds) {
    const n = net.nodes[id];
    const g = net.nearestNode(n.x, n.z, 210, (m) => m.id !== id && s.nodeIds && s.nodeIds.includes(m.id));
    if (g && Math.hypot(g.x - n.x, g.z - n.z) > 18) net.connect('street', [n.x, n.z], [g.x, g.z], { urban: true, merge: 1 });
  }
  // Pflaster zwischen Wasser und Stadt
  for (let i = 0; i < path.length - 1; i++) {
    const A = path[i], B = path[i + 1];
    landuse.fillPoly([[A.x - A.nx * 14, A.z - A.nz * 14], [B.x - B.nx * 14, B.z - B.nz * 14], [B.x + B.nx * 40, B.z + B.nz * 40], [A.x + A.nx * 40, A.z + A.nz * 40]], LU.PLAZA);
  }
  // Palmen
  for (const p of path) {
    if (coast.sdAt(p.x + p.nx * 7.5, p.z + p.nz * 7.5) > 10) addPalm(ctx, p.x + p.nx * 7.5, p.z + p.nz * 7.5, 1.15);
  }
  return { path, nodeIds };
}

function smoothPath(path, win = 4) {
  const n = path.length;
  return path.map((p, i) => {
    let x = 0, z = 0, nx = 0, nz = 0, c = 0;
    for (let k = -win; k <= win; k++) {
      const q = path[clamp(i + k, 0, n - 1)];
      x += q.x; z += q.z; nx += q.nx; nz += q.nz; c++;
    }
    const nl = Math.hypot(nx, nz) || 1;
    return { x: x / c, z: z / c, nx: nx / nl, nz: nz / nl };
  });
}

// ---------- Hafen ----------

function harbor(ctx, s, cp, len, o) {
  const { coast, net, rng, landuse } = ctx;
  const path = smoothPath(coast.pathNear(cp.x, cp.z, len, 0));
  const piers = o.piers ?? 4;
  const step = Math.max(1, Math.floor(path.length / piers));
  for (let k = 0; k < piers; k++) {
    const idx = Math.min(path.length - 1, Math.floor(step * (k + 0.5)));
    const p = path[idx];
    const L = o.big ? rng.range(70, 120) : rng.range(35, 70);
    const w = 5.5;
    const sx = -p.nx, sz = -p.nz;            // seewärts
    const startX = p.x + p.nx * 6, startZ = p.z + p.nz * 6;
    const cx = startX + sx * (L / 2), cz = startZ + sz * (L / 2);
    const rot = Math.atan2(p.nz, -p.nx);      // lokale x-Achse zeigt seewärts
    ctx.platforms.push({ x: cx, z: cz, w: L, d: w, rot, top: 1.15, kind: 'pier' });
    const tx = -sz, tz = sx;                  // quer zum Pier
    const nb = Math.floor((L - 10) / 11);
    for (let q = 0; q < nb; q++) {
      for (const side of [-1, 1]) {
        if (rng.next() < 0.25) continue;
        const kind = o.big ? pick(rng, ['yacht', 'yacht', 'sail', 'boat']) : pick(rng, ['boat', 'boat', 'sail', 'yacht']);
        const len2 = kind === 'yacht' ? rng.range(11, 22) : kind === 'sail' ? rng.range(8, 13) : rng.range(5, 8);
        const dist = 10 + q * 11;
        const bx = startX + sx * dist + tx * side * (w / 2 + 2.2 + len2 * 0.14);
        const bz = startZ + sz * dist + tz * side * (w / 2 + 2.2 + len2 * 0.14);
        if (coast.sdAt(bx, bz) > -4) continue;
        ctx.boats.push({ kind, x: bx, z: bz, rot: Math.atan2(sx, sz) + (rng.next() < 0.5 ? 0 : Math.PI), len: len2, v: rng.int(0, 3) });
      }
    }
    ctx.pois.push({ id: s.id + '.pier' + k, type: 'pier', x: startX + sx * (L - 8), z: startZ + sz * (L - 8), label: 'Anlegestelle' });
  }
  // Kai-Straße entlang der Küste
  const pts = path.filter((_, i) => i % 3 === 0).map((p) => [p.x + p.nx * 9, p.z + p.nz * 9]).filter((p) => coast.sdAt(p[0], p[1]) > 4);
  if (pts.length >= 3) {
    const a = net.addNode(pts[0][0], pts[0][1], 4), b = net.addNode(pts[pts.length - 1][0], pts[pts.length - 1][1], 4);
    if (a !== b) net.addRoad('quay', pts, a, b, { urban: true, name: 'Moll' });
    for (const id of [a, b]) {
      const n = net.nodes[id];
      const g = net.nearestNode(n.x, n.z, 170, (m) => m.id !== a && m.id !== b && s.nodeIds && s.nodeIds.includes(m.id));
      if (g) net.connect('street', [n.x, n.z], [g.x, g.z], { urban: true, merge: 1 });
    }
    for (let i = 0; i < path.length - 1; i++) {
      const A = path[i], B = path[i + 1];
      landuse.fillPoly([[A.x + A.nx * 3, A.z + A.nz * 3], [B.x + B.nx * 3, B.z + B.nz * 3], [B.x + B.nx * 22, B.z + B.nz * 22], [A.x + A.nx * 22, A.z + A.nz * 22]], LU.HARBOR);
    }
  }
  const mid = path[Math.floor(path.length / 2)];
  ctx.pois.push({ id: s.id + '.harbor', type: 'harbor', x: mid.x, z: mid.z, label: s.name + ' Hafen' });
}

// ---------- Resort-Streifen ----------

function genStrip(ctx, s) {
  const { coast, rng } = ctx;
  const cp = s.coastPt;
  const rawPath = smoothPath(coast.pathNear(cp.x, cp.z, s.len, 0), 5);
  const step = 5; // Gitterschritt in Pfadpunkten (~120 m)
  const NI = Math.floor(rawPath.length / step) - 1;
  const rows = s.hotels === 'big' || s.hotels === 'pool' ? [40, 40 + s.depth * 0.5, 40 + s.depth * 0.78, 40 + s.depth * 1.02] : [38, 38 + s.depth * 0.5, 38 + s.depth * 0.85];
  const P = (fi, fj) => {
    const t = clamp(fi * step, 0, rawPath.length - 1);
    const i0 = Math.floor(t), i1 = Math.min(rawPath.length - 1, i0 + 1), f = t - i0;
    const a = rawPath[i0], b = rawPath[i1];
    const x = lerp(a.x, b.x, f), z = lerp(a.z, b.z, f);
    let nx = lerp(a.nx, b.nx, f), nz = lerp(a.nz, b.nz, f);
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const j0 = Math.floor(fj), j1 = Math.min(rows.length - 1, j0 + 1), jf = fj - j0;
    const o = lerp(rows[clamp(j0, 0, rows.length - 1)], rows[j1], jf);
    return [x + nx * o, z + nz * o];
  };
  const valid = (i, j, x, z) => okPoint(ctx, x, z, 14, 0.3);
  const mode = (blk) => {
    if (blk.j === 0) return s.hotels === 'night' ? (ihash(blk.i, 1, s.seed) < 0.65 ? 'night' : 'hotelMid') : s.hotels === 'big' ? 'hotelBig' : s.hotels === 'pool' ? 'hotelPool' : 'hotelMid';
    if (blk.j === 1) return ihash(blk.i, 2, s.seed) < 0.5 ? 'commercial' : 'residential';
    return 'residential';
  };
  const res = runLattice(ctx, s, {
    I0: 0, I1: NI, J0: 0, J1: rows.length - 1, P, valid, sub: 4, removeProb: 0,
    kindI: (i, j) => (j === 0 ? 'promenade' : 'street'),
    kindJ: () => 'street',
    mode, fill: (blk, m) => fillBlock(ctx, s, blk, m),
  });
  // Strand: Liegen und Sonnenschirme zwischen Wasser und Promenade
  for (let i = 0; i < rawPath.length - 1; i++) {
    const a = rawPath[i], b = rawPath[i + 1];
    ctx.landuse.fillPoly([[a.x + a.nx * 1.5, a.z + a.nz * 1.5], [b.x + b.nx * 1.5, b.z + b.nz * 1.5], [b.x + b.nx * 28, b.z + b.nz * 28], [a.x + a.nx * 28, a.z + a.nz * 28]], LU.BEACHCLUB);
  }
  // Palmen entlang der Promenade
  for (let i = 0; i < rawPath.length; i += 1) {
    const p = rawPath[i];
    const x = p.x + p.nx * 31, z = p.z + p.nz * 31;
    if (coast.sdAt(x, z) > 12) addPalm(ctx, x, z, 1.2);
  }
  ctx.pois.push({ id: s.id + '.center', type: 'resort', x: s.pos[0], z: s.pos[1], label: s.name });
  ctx.pois.push({ id: s.id + '.beach', type: 'beach', x: cp.x + cp.nx * 12, z: cp.z + cp.nz * 12, label: s.name + ' Strand' });
  if (s.marina) harbor(ctx, s, cp, 400, { piers: 5, big: true });
  // Strandbar
  const mid = rawPath[Math.floor(rawPath.length / 2)];
  const bar = { x: mid.x + mid.nx * 24, z: mid.z + mid.nz * 24 };
  ctx.props.push({ t: 'beachbar', x: bar.x, z: bar.z, r: Math.atan2(mid.nz, mid.nx), s: 1, v: 0 });
  ctx.pois.push({ id: s.id + '.beachbar', type: 'bar', x: bar.x, z: bar.z, label: 'Strandbar ' + s.name });
  void rng;
}

// ---------- Fischerdorf ----------

function genFishing(ctx, s) {
  const { coast, rng } = ctx;
  const cp = s.coastPt;
  const R = s.r;
  // Gitter parallel zur Küste
  const tx = cp.tx, tz = cp.tz;
  const th = Math.atan2(tz, tx);
  const ux = Math.cos(th), uz = Math.sin(th), vx = -uz, vz = ux;
  // Innen-Normale: (nx,nz)
  const inward = vx * cp.nx + vz * cp.nz >= 0 ? 1 : -1;
  const bw = 52, bd = 44;
  const NI = Math.ceil(R / bw) + 1;
  const NJ = Math.ceil(R / bd);
  const jit = jitterFn(s.seed, 4);
  const base = [cp.x + cp.nx * 36, cp.z + cp.nz * 36];
  const P = (i, j) => { const [jx, jz] = jit(i, j); return [base[0] + ux * i * bw + vx * inward * j * bd + jx, base[1] + uz * i * bw + vz * inward * j * bd + jz]; };
  s.core = [cp.x + cp.nx * (R * 0.4), cp.z + cp.nz * (R * 0.4)];
  const valid = (i, j, x, z) => Math.hypot(x - s.core[0], z - s.core[1]) < R * (0.85 + 0.2 * noise2(x / 120, z / 120, s.seed)) && okPoint(ctx, x, z, 22, 0.3);
  const res = runLattice(ctx, s, {
    I0: -NI, I1: NI, J0: 0, J1: NJ, P, valid, removeProb: 0.05,
    kindI: (i, j) => (j === 0 ? 'street' : 'alley'),
    kindJ: () => 'alley',
    mode: (blk) => (blk.j === 0 ? 'harbor' : ihash(blk.i, blk.j, 9) < 0.78 ? 'old' : 'residential'),
    fill: (blk, mode) => fillBlock(ctx, s, blk, mode),
  });
  if (!s.tiny) harbor(ctx, s, cp, Math.min(2 * R, 460), { piers: Math.max(2, Math.round(R / 90)), big: false });
  else harbor(ctx, s, cp, 120, { piers: 1, big: false });
  ctx.pois.push({ id: s.id + '.center', type: 'village', x: s.core[0], z: s.core[1], label: s.name });
  void rng;
}

// ---------- Dorf im Binnenland ----------

function genVillage(ctx, s) {
  const { rng } = ctx;
  const [cx, cz] = s.pos;
  const th = rng.next() * Math.PI;
  const ux = Math.cos(th), uz = Math.sin(th), vx = -uz, vz = ux;
  const bw = 50, bd = 42, R = s.r;
  if (s.tiny) {
    const id = ctx.net.addNode(cx, cz, 3);
    s.gates = [id];
    ctx.pois.push({ id: s.id + '.center', type: 'village', x: cx, z: cz, label: s.name });
    if (s.id === 'formentor') formentorSite(ctx, s);
    return;
  }
  const NI = Math.ceil(R / bw) + 1, NJ = Math.ceil(R / bd) + 1;
  const jit = jitterFn(s.seed, 7);
  const P = (i, j) => { const [jx, jz] = jit(i, j); return [cx + ux * i * bw + vx * j * bd + jx, cz + uz * i * bw + vz * j * bd + jz]; };
  s.core = [cx, cz];
  const valid = (i, j, x, z) => Math.hypot(x - cx, z - cz) < R * (0.78 + 0.35 * noise2(x / 140, z / 140, s.seed)) && okPoint(ctx, x, z, 36, 0.3);
  const plaza = { i: 0, j: 0 };
  runLattice(ctx, s, {
    I0: -NI, I1: NI, J0: -NJ, J1: NJ, P, valid, removeProb: 0.08,
    kindI: (i, j) => (Math.hypot(i * bw, j * bd) < R * 0.5 ? 'alley' : 'street'),
    kindJ: (i, j) => (Math.hypot(i * bw, j * bd) < R * 0.5 ? 'alley' : 'street'),
    mode: (blk) => {
      const d = Math.hypot(blk.cx - cx, blk.cz - cz) / R;
      if (d < 0.45) return 'old';
      return ihash(blk.i, blk.j, 8) < 0.45 ? 'old' : ihash(blk.i, blk.j, 9) < 0.6 ? 'suburb' : 'residential';
    },
    fill: (blk, mode) => fillBlock(ctx, s, blk, mode),
  });
  void plaza;
  ctx.pois.push({ id: s.id + '.center', type: 'village', x: cx, z: cz, label: s.name });
  // Windmühle am Ortsrand (typisch Mallorca)
  if (rng.next() < 0.5) {
    const a = rng.next() * TAU, x = cx + Math.cos(a) * R * 1.05, z = cz + Math.sin(a) * R * 1.05;
    if (okPoint(ctx, x, z, 60, 0.15)) ctx.props.push({ t: 'windmill', x, z, r: rng.next() * TAU, s: 1, v: 0 });
  }
}

function formentorSite(ctx, s) {
  const { coast, rng } = ctx;
  // Leuchtturm an der Spitze und Hotel
  const tip = coast.pathNear(...ll2(ctx, 3.212, 39.968), 0, 0)[0];
  if (tip) {
    ctx.props.push({ t: 'lighthouse', x: tip.x + tip.nx * 30, z: tip.z + tip.nz * 30, r: 0, s: 1, v: 0 });
    ctx.pois.push({ id: 'formentor.lighthouse', type: 'landmark', x: tip.x + tip.nx * 30, z: tip.z + tip.nz * 30, label: 'Far de Formentor' });
  }
  void rng;
}
function ll2(ctx, lon, lat) { return [((lon - 2.95) * 85.5 * 1000) / 12.5, (-(lat - 39.6) * 111 * 1000) / 12.5]; }

// ---------- Industriegebiet ----------

function genIndustrial(ctx, s) {
  const { rng } = ctx;
  const [cx, cz] = s.pos;
  const th = rng.next() * 0.6, ux = Math.cos(th), uz = Math.sin(th), vx = -uz, vz = ux;
  const bw = 120, bd = 92, R = s.r;
  const NI = Math.ceil(R / bw) + 1, NJ = Math.ceil(R / bd) + 1;
  const P = (i, j) => [cx + ux * i * bw + vx * j * bd, cz + uz * i * bw + vz * j * bd];
  s.core = [cx, cz];
  const valid = (i, j, x, z) => Math.hypot(x - cx, z - cz) < R * 0.95 && okPoint(ctx, x, z, 60, 0.2);
  runLattice(ctx, s, {
    I0: -NI, I1: NI, J0: -NJ, J1: NJ, P, valid, removeProb: 0.05,
    kindI: () => 'street', kindJ: () => 'street',
    mode: () => 'industrial', fill: (blk, mode) => fillBlock(ctx, s, blk, mode),
  });
  ctx.pois.push({ id: s.id + '.center', type: 'industrial', x: cx, z: cz, label: s.name });
}

// ---------- Flughafen ----------

function genAirport(ctx, s) {
  const { net, hf, landuse, rng } = ctx;
  const { coast } = ctx;
  const [cx, cz] = s.pos;
  // Piste parallel zur Küste ausrichten; Terminal/Vorfeld auf der Landseite
  const cpt = coast.pathNear(cx, cz, 0, 0)[0];
  const th = cpt ? Math.atan2(cpt.tz, cpt.tx) : (s.angle || 0);
  const ux = Math.cos(th), uz = Math.sin(th);
  const sea = coast.seaDir(cx, cz, {});
  const sgn = (-uz * sea.x + ux * sea.z) > 0 ? -1 : 1;
  const vx = -uz * sgn, vz = ux * sgn;
  let L = 1100;
  while (L > 500 && (coast.sdAt(cx - ux * L / 2, cz - uz * L / 2) < 120 || coast.sdAt(cx + ux * L / 2, cz + uz * L / 2) < 120)) L -= 100;
  const y = hf.addPlateau(cx, cz, 420, 140);
  void y;
  const A = [cx - ux * L / 2, cz - uz * L / 2], B = [cx + ux * L / 2, cz + uz * L / 2];
  const na = net.addNode(A[0], A[1], 2), nb = net.addNode(B[0], B[1], 2);
  net.addRoad('runway', [A, B], na, nb, { flat: true, name: 'Pista 06/24', noTraffic: true });
  landuse.fillRect(cx, cz, L + 80, 120, -th, LU.AIRPORT);
  landuse.fillRect(cx + vx * 190, cz + vz * 190, L * 0.8, 240, -th, LU.AIRPORT);
  landuse.fillRect(cx, cz, L, 52, -th, LU.RUNWAY);
  // Rollweg + Vorfeld
  const off = 105;
  const tA = [A[0] + vx * off + ux * 120, A[1] + vz * off + uz * 120], tB = [B[0] + vx * off - ux * 120, B[1] + vz * off - uz * 120];
  const ta = net.addNode(tA[0], tA[1], 2), tb = net.addNode(tB[0], tB[1], 2);
  net.addRoad('taxiway', [tA, tB], ta, tb, { flat: true, name: 'Rollweg', noTraffic: true });
  // Verbindungen Runway <-> Taxiway
  for (const f of [0.18, 0.5, 0.82]) {
    const p = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f];
    const n1 = net.addNode(p[0], p[1], 2);
    // Knoten auf der Piste erzeugt zusätzliche Teilung nicht nötig: Rollverbindung endet an der Pistenkante
    const q = [p[0] + vx * 28, p[1] + vz * 28], r = [p[0] + vx * off, p[1] + vz * off];
    void n1;
    const nq = net.addNode(q[0], q[1], 2), nr = net.addNode(r[0], r[1], 2);
    net.addRoad('taxiway', [q, r], nq, nr, { flat: true, noTraffic: true });
  }
  // Terminal
  const tx = cx + vx * 215, tz = cz + vz * 215;
  const term = { id: ctx.buildings.length, x: tx, z: tz, w: 190, d: 38, rot: Math.atan2(-uz, ux), style: 'terminal', floors: 3, h: 16, roof: 'flat', tint: [0.9, 0.93, 0.96], seed: 5, name: 'Terminal', signIdx: ctx.signs.add('AEROPUERTO DE PALMA', 'harbor') };
  ctx.buildings.push(term);
  for (let k = -1; k <= 1; k++) {
    const hx = cx + vx * 255 + ux * (k * 150 + 30), hz = cz + vz * 255 + uz * (k * 150 + 30);
    ctx.buildings.push({ id: ctx.buildings.length, x: hx, z: hz, w: 55, d: 44, rot: Math.atan2(-uz, ux), style: 'ware', floors: 1, h: 12, roof: 'flat', tint: TINT_IND[k + 1], seed: 7 + k });
  }
  ctx.buildings.push({ id: ctx.buildings.length, x: cx + vx * 190 + ux * 120, z: cz + vz * 190 + uz * 120, w: 8, d: 8, rot: 0, style: 'tower', floors: 9, h: 34, roof: 'flat', tint: [0.9, 0.92, 0.95], seed: 9, name: 'Tower' });
  // Zufahrt
  const road = [cx + vx * 285, cz + vz * 285];
  const nRoad = net.addNode(road[0], road[1], 3), nTerm = net.addNode(tx + vx * 30, tz + vz * 30, 3);
  net.addRoad('main', [[tx + vx * 30, tz + vz * 30], [road[0], road[1]]], nTerm, nRoad, { urban: true, flat: true, name: 'Autovia Aeroport' });
  s.gates = [nRoad];
  // Parkende Flugzeuge auf dem Vorfeld und Startpunkte
  ctx.pois.push({ id: 'airport.runway', type: 'runway', x: cx - ux * L * 0.4, z: cz - uz * L * 0.4, rot: Math.atan2(uz, ux), label: 'Flughafen' });
  ctx.pois.push({ id: 'airport.apron', type: 'airport', x: cx + vx * 140, z: cz + vz * 140, label: 'Flughafen Palma' });
  for (let k = 0; k < 4; k++) {
    ctx.props.push({ t: 'parkedjet', x: cx + vx * 150 + ux * (k * 60 - 90), z: cz + vz * 150 + uz * (k * 60 - 90), r: -th + Math.PI / 2 * 0, s: 1, v: k });
  }
  s.runway = { x: cx, z: cz, ux, uz, L, th };
  ctx.runway = s.runway;
  void rng;
}
