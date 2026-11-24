// Ländliche Objekte: Fincas mit Pool und Steinmauern, Windmühlen, Feldwege.
import { RNG, TAU, noise2, pointInPoly } from '../util.js';
import { LU } from './landuse.js';
import { ZONES } from './map.js';

const FINCA_TINTS = [[0.9, 0.78, 0.58], [0.88, 0.72, 0.5], [0.93, 0.85, 0.68], [0.85, 0.7, 0.52]];

export function generateRural(ctx) {
  const { coast, hf, landuse, net } = ctx;
  const rng = new RNG(777);
  ctx.fincas = [];
  const placed = [];
  const settlementPts = ctx.settlements.filter((s) => s.pos).map((s) => ({ x: s.pos[0], z: s.pos[1], r: (s.r || 250) + 120, depth: s.depth }));

  // Zielanzahl je Insel (Fläche der Insel bestimmt die Menge)
  const targets = { mallorca: 150, menorca: 22, ibiza: 26, formentera: 6, cabrera: 0, dragonera: 0, conills: 0 };
  for (const poly of coast.polys) {
    const want = targets[poly.id] ?? 0;
    if (!want) continue;
    const [x0, z0, x1, z1] = poly.bbox;
    let tries = 0;
    let count = 0;
    while (count < want && tries++ < want * 80) {
      const x = x0 + rng.next() * (x1 - x0), z = z0 + rng.next() * (z1 - z0);
      if (poly.id === 'mallorca' && rng.next() < 0.8 && !pointInPoly(x, z, ZONES.plain)) continue;
      const sd = coast.sdAt(x, z);
      if (sd < 140) continue;
      if (coast.islandAt(x, z) !== poly.id) continue;
      if (landuse.get(x, z) !== 0) continue;
      if (hf.baseSlope(x, z, 10) > 0.1) continue;
      if (hf.mountain(x, z) > 25) continue;
      if (hf.wet.length && hf.wetMask(x, z)) continue;
      if (settlementPts.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 160)) continue;
      if (placed.some((p) => Math.hypot(x - p[0], z - p[1]) < 300)) continue;
      const near = net.nearest(x, z, 60);
      if (near) continue;
      const rot = Math.round((noise2(x / 400, z / 400, 3) * 2 + rng.next() * 0.2) * 4) / 4 * Math.PI / 2 + rng.range(-0.15, 0.15);
      buildFinca(ctx, rng, x, z, rot, count === 0 && poly.id === 'mallorca');
      placed.push([x, z]);
      count++;
    }
  }

  // Windmühlen in der Ebene
  const mills = [];
  let tries = 0;
  while (mills.length < 14 && tries++ < 4000) {
    const x = ctx.world.x0 + rng.next() * (ctx.world.x1 - ctx.world.x0), z = ctx.world.z0 + rng.next() * (ctx.world.z1 - ctx.world.z0);
    if (!pointInPoly(x, z, ZONES.plain) || coast.sdAt(x, z) < 400) continue;
    if (landuse.get(x, z) !== 0 || hf.baseSlope(x, z, 10) > 0.08) continue;
    if (mills.some((p) => Math.hypot(x - p[0], z - p[1]) < 700)) continue;
    if (net.nearest(x, z, 40) || placed.some((p) => Math.hypot(x - p[0], z - p[1]) < 120)) continue;
    mills.push([x, z]);
    ctx.props.push({ t: 'windmill', x, z, r: rng.next() * TAU, s: 1, v: 0 });
    landuse.fillCircle(x, z, 7, LU.FARMYARD);
  }
}

function localPos(x, z, rot, lx, lz) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [x + c * lx + s * lz, z - s * lx + c * lz];
}

function buildFinca(ctx, rng, x, z, rot, boss) {
  const { landuse, net, hf } = ctx;
  const tint = FINCA_TINTS[rng.int(0, FINCA_TINTS.length - 1)];
  const big = boss || rng.next() < 0.25;
  const W = big ? 21 : 15, D = big ? 12 : 9.5;
  const add = (lx, lz, w, d, o) => {
    const [px, pz] = localPos(x, z, rot, lx, lz);
    const b = {
      id: ctx.buildings.length, x: px, z: pz, w, d, rot, style: 'finca', floors: o.floors ?? 2, h: o.h ?? (o.floors ?? 2) * 3.2 + 0.4,
      roof: o.roof || 'gable', tint: o.tint || tint, seed: Math.floor(rng.next() * 1e9), name: o.name || null, tag: o.tag || null,
    };
    ctx.buildings.push(b);
    return b;
  };
  const main = add(0, 0, W, D, { floors: big ? 2 : 2, name: boss ? 'Finca Son Vidal' : null, tag: boss ? 'bossfinca' : null });
  add(-W / 2 - 5, 3, 8, 6, { floors: 1, roof: 'hip' });
  if (big) add(W / 2 + 6, -4, 9, 7, { floors: 1, roof: 'gable', tint: [0.88, 0.8, 0.66] });
  // Pool
  const [px, pz] = localPos(x, z, rot, W / 2 + (big ? 14 : 8), D / 2 + 6);
  const pool = { x: px, z: pz, rot, w: big ? 12 : 8.5, d: big ? 5.5 : 4, shape: 'rect', island: false };
  ctx.pools.push(pool);
  ctx.props.push({ t: 'lounger', x: px + Math.cos(rot) * -2, z: pz - Math.sin(rot) * -2 + 3.6, r: rot, s: 1, v: rng.int(0, 3) });
  ctx.props.push({ t: 'parasol', x: px + 3, z: pz + 4.4, r: rng.next() * TAU, s: 1, v: 0 });
  // Mauern (Terrasse)
  const WW = W + 26, DD = D + 24;
  const seg = 4;
  const gapSide = rng.int(0, 3);
  const wall = (side, cx, cz, len, along) => {
    const n = Math.floor(len / seg);
    for (let k = 0; k < n; k++) {
      if (side === gapSide && Math.abs(k - n / 2) < 1.6) continue;
      const t = -len / 2 + (k + 0.5) * seg;
      const [wx, wz] = along === 'x' ? localPos(x, z, rot, cx + t, cz) : localPos(x, z, rot, cx, cz + t);
      ctx.props.push({ t: 'wallseg', x: wx, z: wz, r: along === 'x' ? rot : rot + Math.PI / 2, s: 1, v: 0 });
    }
  };
  wall(0, 0, -DD / 2, WW, 'x'); wall(1, 0, DD / 2, WW, 'x'); wall(2, -WW / 2, 0, DD, 'z'); wall(3, WW / 2, 0, DD, 'z');
  // Zypressen am Tor, Bougainvillea, Palmen, Olivenhain
  for (const [lx, lz] of [[-4, -DD / 2 - 2], [4, -DD / 2 - 2], [-4, DD / 2 + 2], [4, DD / 2 + 2]]) {
    const [cx, cz] = localPos(x, z, rot, lx, lz);
    ctx.props.push({ t: 'cypress', x: cx, z: cz, r: 0, s: 0.9 + rng.next() * 0.4, v: 0 });
  }
  const [bx, bz] = localPos(x, z, rot, -W / 2 - 1, -D / 2 - 1);
  ctx.props.push({ t: 'bougainvillea', x: bx, z: bz, r: 0, s: 1.2, v: 0 });
  for (let k = 0; k < 3; k++) {
    const [qx, qz] = localPos(x, z, rot, rng.range(-W / 2, W / 2), rng.range(-D / 2 - 6, -D / 2 - 3));
    ctx.props.push({ t: 'palm', x: qx, z: qz, r: rng.next() * TAU, s: 0.8 + rng.next() * 0.3, v: rng.int(0, 2) });
  }
  const rows = big ? 5 : 3, cols = big ? 9 : 6;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [ox, oz] = localPos(x, z, rot, -cols * 3 + c * 6 + rng.range(-0.6, 0.6), -DD / 2 - 14 - r * 6 + rng.range(-0.6, 0.6));
      ctx.props.push({ t: 'olive', x: ox, z: oz, r: rng.next() * TAU, s: 0.8 + rng.next() * 0.5, v: rng.int(0, 2) });
    }
  }
  landuse.fillRect(x, z, WW - 4, DD - 4, -rot, LU.FARMYARD);
  ctx.pois.push({ id: 'finca' + ctx.fincas.length, type: boss ? 'bossfinca' : 'finca', x, z, label: boss ? 'Finca Son Vidal' : 'Finca' });
  ctx.fincas.push({ x, z, rot, boss: !!boss, main });

  // Feldweg zur nächsten Straße
  const gate = localPos(x, z, rot, 0, -DD / 2 - 2);
  const near = net.nearest(gate[0], gate[1], 650, (r) => r.kind !== 'track' && !r.noTraffic);
  if (near && near.d > 30) {
    const mid = [(gate[0] + near.x) / 2 + rng.range(-25, 25), (gate[1] + near.z) / 2 + rng.range(-25, 25)];
    net.addLate('track', [gate, mid, [near.x, near.z]], { yB: near.y, hf, name: 'Camí de Finca', noTraffic: true });
  }
}
