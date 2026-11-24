// Straßen-Geometrie: Fahrbahnbänder, Bürgersteige, Kreuzungsflächen, Zebrastreifen.
import { ROAD_COLS, ROAD_TILE_M, ROAD_STRIP } from './textures.js';

const STRIP_OF = {
  highway: 'hw', main: 'main', rural: 'rural', scenic: 'scenic', avenue: 'avenue', street: 'street', alley: 'alley',
  promenade: 'prom', track: 'track', taxiway: 'taxi', runway: 'runway', quay: 'quay',
};
const Y_ROAD = 0.05, Y_WALK = 0.085, Y_PAD = 0.052, Y_ZEBRA = 0.058;

function uRange(strip) {
  const c = ROAD_STRIP[strip];
  const pad = 0.0015;
  return [c / ROAD_COLS + pad, (c + 1) / ROAD_COLS - pad];
}

export function nodePadRadius(net, node) {
  if (node._pad !== undefined) return node._pad;
  let r = 0;
  if (node.roads.length >= 3) {
    for (const id of node.roads) {
      const road = net.roads[id];
      if (road.kind === 'runway' || road.kind === 'taxiway') continue;
      r = Math.max(r, road.w * 0.5);
    }
    r *= 1.1;
  }
  node._pad = r;
  return r;
}

// Ein Band entlang der Straßenpunkte von Index i (Segment i -> i+1), seitlich von off0 bis off1 (negativ = links)
function ribbon(mb, r, i, off0, off1, strip, y, trimA, trimB, vScale = 1) {
  const p0 = r.pts[i], p1 = r.pts[i + 1];
  let dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const L = Math.hypot(dx, dz) || 1;
  dx /= L; dz /= L;
  // Tangenten an den Enden (Gehrung)
  const tang = (k) => {
    const a = r.pts[Math.max(0, k - 1)], b = r.pts[Math.min(r.pts.length - 1, k + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    return [tx / l, tz / l];
  };
  const t0 = tang(i), t1 = tang(i + 1);
  // Beschneiden (Kreuzungsfläche)
  const s0 = Math.min(trimA, L * 0.8), s1 = Math.min(trimB, L * 0.8);
  const f0 = s0 / L, f1 = 1 - s1 / L;
  if (f1 <= f0 + 0.02) return;
  const lerp = (a, b, t) => a + (b - a) * t;
  const A = [lerp(p0[0], p1[0], f0), lerp(p0[1], p1[1], f0)], Bp = [lerp(p0[0], p1[0], f1), lerp(p0[1], p1[1], f1)];
  const yA = lerp(r.ys[i], r.ys[i + 1], f0) + y, yB = lerp(r.ys[i], r.ys[i + 1], f1) + y;
  const tA = f0 === 0 ? t0 : [dx, dz], tB = f1 === 1 ? t1 : [dx, dz];
  // links = (tz, -tx)·(-1)?  Links der Fahrtrichtung in (x,z): (tz, -tx) ist rechts. Wir definieren rechts positiv.
  const nA = [-tA[1], tA[0]], nB = [-tB[1], tB[0]];
  const mA = Math.min(1.45, 1 / Math.max(0.5, nA[0] * -dz + nA[1] * dx)), mB = Math.min(1.45, 1 / Math.max(0.5, nB[0] * -dz + nB[1] * dx));
  const [u0, u1] = uRange(strip);
  const v0 = (r.cum[i] + s0) / ROAD_TILE_M * vScale, v1 = (r.cum[i] + L - s1) / ROAD_TILE_M * vScale;
  const a0 = [A[0] + nA[0] * off0 * mA, yA, A[1] + nA[1] * off0 * mA], a1 = [A[0] + nA[0] * off1 * mA, yA, A[1] + nA[1] * off1 * mA];
  const b0 = [Bp[0] + nB[0] * off0 * mB, yB, Bp[1] + nB[1] * off0 * mB], b1 = [Bp[0] + nB[0] * off1 * mB, yB, Bp[1] + nB[1] * off1 * mB];
  // Reihenfolge links-Start, rechts-Start, rechts-Ende, links-Ende ergibt (von oben gesehen) eine nach oben zeigende Fläche
  mb.quad(a0, a1, b1, b0, 0, 1, 0, u0, v0, u1, v1, 1, 1, 1);
}

// Baut alle Straßenelemente für eine Liste von Segmenten { r, i }
export function buildRoads(ctx, segs, mb) {
  const net = ctx.net;
  for (const { r, i } of segs) {
    const strip = STRIP_OF[r.kind] || 'street';
    const last = r.pts.length - 2;
    const trimA = i === 0 ? nodePadRadius(net, net.nodes[r.a]) : 0;
    const trimB = i === last ? nodePadRadius(net, net.nodes[r.b]) : 0;
    const hw = r.w / 2;
    ribbon(mb, r, i, -hw, hw, strip, Y_ROAD, trimA, trimB, 1);
    if (r.sw > 0) {
      ribbon(mb, r, i, hw, hw + r.sw, 'sidewalk', Y_WALK, trimA > 0 ? trimA * 0.92 : 0, trimB > 0 ? trimB * 0.92 : 0, 1.0 / (r.sw > 3 ? 1 : 1));
      ribbon(mb, r, i, -hw - r.sw, -hw, 'sidewalk', Y_WALK, trimA > 0 ? trimA * 0.92 : 0, trimB > 0 ? trimB * 0.92 : 0, 1.0);
    }
  }
}

// Kreuzungsflächen und Zebrastreifen für Knoten im Rechteck
export function buildNodes(ctx, nodes, mb) {
  const net = ctx.net;
  const [u0, u1] = uRange('plain'), [z0, z1] = uRange('zebra');
  for (const n of nodes) {
    const R = nodePadRadius(net, n);
    if (R <= 0) continue;
    const segs = 14;
    const c = [n.x, n.y + Y_PAD, n.z];
    for (let k = 0; k < segs; k++) {
      const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
      const um = (u0 + u1) / 2;
      mb.triUp(c, [n.x + Math.cos(a0) * R * 1.04, n.y + Y_PAD, n.z + Math.sin(a0) * R * 1.04], [n.x + Math.cos(a1) * R * 1.04, n.y + Y_PAD, n.z + Math.sin(a1) * R * 1.04], 1, 1, 1, [um, 0.3], [um, 0.3], [um, 0.3]);
    }
    // Zebrastreifen an städtischen Armen
    for (const id of n.roads) {
      const r = net.roads[id];
      if (r.sw <= 0 || r.kind === 'promenade' || r.kind === 'quay' || r.len < 28) continue;
      const atStart = r.a === n.id && r.pts.length > 1;
      const s = atStart ? R + 1.6 : r.len - R - 4.6;
      const p = net.pointAt(r, s, {});
      const q = net.pointAt(r, s + 3, {});
      const hw = r.w / 2;
      const nx = -p.dz, nz = p.dx;
      const mkv = (pp, off) => [pp.x + nx * off, pp.y + Y_ZEBRA, pp.z + nz * off];
      mb.quad(mkv(p, -hw), mkv(p, hw), mkv(q, hw), mkv(q, -hw), 0, 1, 0, z0, 0.1, z1, 0.3, 1, 1, 1);
    }
  }
}
