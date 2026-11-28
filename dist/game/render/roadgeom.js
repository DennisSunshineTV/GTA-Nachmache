// Straßen-Geometrie: Fahrbahnbänder, Bürgersteige, Kreuzungsflächen, Zebrastreifen.
// Die Form der Kreuzungen (Ränder, Rundungen, Zurücknahme der Arme) steckt in world/junction.js.
import { ROAD_COLS, ROAD_TILE_M, ROAD_STRIP } from './textures.js';
import { junctionOf, armTrim, nodePadRadius } from '../world/junction.js';

export { armTrim, nodePadRadius, junctionOf };

const STRIP_OF = {
  highway: 'hw', main: 'main', rural: 'rural', scenic: 'scenic', avenue: 'avenue', street: 'street', alley: 'alley',
  promenade: 'prom', track: 'track', taxiway: 'taxi', runway: 'runway', quay: 'quay', deck: 'deck', forecourt: 'apron',
};
// Überlandstraßen bekommen ein Bankett (Kies, dann Gras) neben dem Asphalt
const SHOULDER_KINDS = new Set(['highway', 'main', 'rural', 'scenic']);
export const SHOULDER_W = 1.1;
const Y_ROAD = 0.06, Y_WALK = 0.1, Y_PAD = 0.06, Y_ZEBRA = 0.068, Y_SHOULDER = 0.045;
// Vertexfarbe = Shader-Parameter (siehe roadshader.js): r = Breite/32 m, g = 1 im Band, 0 auf Flächen
const P_PAD = [1, 0, 1];
const pBand = (w) => [w / 32, 1, 1];

// Stoß an Knoten mit genau zwei Straßen ohne Kreuzungsfläche (Knick unter ~25°): Beide Bänder enden auf derselben
// Winkelhalbierenden. Vorher endete jedes Band rechtwinklig zur eigenen Richtung – außen klaffte ein Keil (Gras
// zwischen den Gehwegen), innen überlappten Fahrbahn und Gehweg.
const AIR = new Set(['runway', 'taxiway']);
function endTangent(net, r, end) {
  const key = end === 'a' ? '_ta' : '_tb';
  if (r[key] !== undefined) return r[key];
  r[key] = null;
  const node = net.nodes[end === 'a' ? r.a : r.b];
  if (!node || r.a === r.b || junctionOf(net, node)) return null;
  const others = node.roads.filter((id) => id !== r.id && !AIR.has(net.roads[id].kind));
  if (others.length !== 1 || AIR.has(r.kind)) return null;
  const o = net.roads[others[0]];
  if (o.a === o.b) return null;
  const away = (road, atA) => {
    const p = road.pts, n = p.length, a = atA ? p[0] : p[n - 1], b = atA ? p[1] : p[n - 2];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };
  const uA = away(r, end === 'a'), uB = away(o, o.a === node.id);
  let tx = uA[0] - uB[0], tz = uA[1] - uB[1];
  const l = Math.hypot(tx, tz);
  if (l < 1e-6) return null;
  const sg = end === 'a' ? 1 : -1;
  r[key] = [(tx / l) * sg, (tz / l) * sg];
  return r[key];
}

// Gehwegplatten: 0,5 m (wie im Straßen-Shader). Jede Straße wird minimal gestreckt, sodass ihre Länge ein Vielfaches
// der Platte ist – dann liegt an beiden Enden eine Fuge und das Muster läuft an Stößen und Ecken bündig weiter.
const SLAB = 0.5;
const slabK = (r) => (Math.max(1, Math.round(r.len / SLAB)) * SLAB) / r.len;

function uRange(strip) {
  const c = ROAD_STRIP[strip];
  const pad = 0.0015;
  return [c / ROAD_COLS + pad, (c + 1) / ROAD_COLS - pad];
}

// Ein Band entlang der Straßenpunkte von Index i (Segment i -> i+1), seitlich von off0 bis off1 (negativ = links)
// trimA/trimB: Strecke (Bogenlänge) vom Straßenanfang bzw. -ende, die für die Kreuzungsfläche frei bleibt.
// flip: Querkoordinate umdrehen (linke Gehwege/Bankette: Kante zur Fahrbahn liegt dann immer bei u0)
function ribbon(mb, r, i, off0, off1, strip, y, trimA, trimB, vScale = 1, flip = false) {
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
  const last = r.pts.length - 1;
  const t0 = i === 0 && r._ta ? r._ta : tang(i), t1 = i + 1 === last && r._tb ? r._tb : tang(i + 1);
  // Beschneiden (Kreuzungsfläche)
  const s0 = Math.min(Math.max(trimA - r.cum[i], 0), L), s1 = Math.min(Math.max(r.cum[i + 1] - (r.len - trimB), 0), L);
  const f0 = s0 / L, f1 = 1 - s1 / L;
  if (f1 <= f0 + 0.002) return;
  const lerp = (a, b, t) => a + (b - a) * t;
  const A = [lerp(p0[0], p1[0], f0), lerp(p0[1], p1[1], f0)], Bp = [lerp(p0[0], p1[0], f1), lerp(p0[1], p1[1], f1)];
  const yA = lerp(r.ys[i], r.ys[i + 1], f0) + y, yB = lerp(r.ys[i], r.ys[i + 1], f1) + y;
  const tA = f0 === 0 ? t0 : [dx, dz], tB = f1 === 1 ? t1 : [dx, dz];
  // links = (tz, -tx)·(-1)?  Links der Fahrtrichtung in (x,z): (tz, -tx) ist rechts. Wir definieren rechts positiv.
  const nA = [-tA[1], tA[0]], nB = [-tB[1], tB[0]];
  const mA = Math.min(1.45, 1 / Math.max(0.5, nA[0] * -dz + nA[1] * dx)), mB = Math.min(1.45, 1 / Math.max(0.5, nB[0] * -dz + nB[1] * dx));
  let [u0, u1] = uRange(strip);
  if (flip) [u0, u1] = [u1, u0];
  const v0 = (r.cum[i] + s0) / ROAD_TILE_M * vScale, v1 = (r.cum[i] + L - s1) / ROAD_TILE_M * vScale;
  const a0 = [A[0] + nA[0] * off0 * mA, yA, A[1] + nA[1] * off0 * mA], a1 = [A[0] + nA[0] * off1 * mA, yA, A[1] + nA[1] * off1 * mA];
  const b0 = [Bp[0] + nB[0] * off0 * mB, yB, Bp[1] + nB[1] * off0 * mB], b1 = [Bp[0] + nB[0] * off1 * mB, yB, Bp[1] + nB[1] * off1 * mB];
  // Reihenfolge links-Start, rechts-Start, rechts-Ende, links-Ende ergibt (von oben gesehen) eine nach oben zeigende Fläche
  const p = pBand(off1 - off0);
  mb.quad(a0, a1, b1, b0, 0, 1, 0, u0, v0, u1, v1, p[0], p[1], p[2]);
}

// Baut alle Straßenelemente für eine Liste von Segmenten { r, i }
export function buildRoads(ctx, segs, mb) {
  const net = ctx.net;
  for (const { r, i } of segs) {
    if (r.hidden) continue;   // z. B. Holzflächen am Strandhaus: eigene, durchgehende Geometrie (beachgeom.js)
    const strip = STRIP_OF[r.kind] || 'street';
    const trimA = armTrim(net, r, 'a');
    const trimB = armTrim(net, r, 'b');
    if (i === 0) endTangent(net, r, 'a');
    if (i === r.pts.length - 2) endTangent(net, r, 'b');
    const hw = r.w / 2;
    ribbon(mb, r, i, -hw, hw, strip, Y_ROAD, trimA, trimB, 1);
    if (r.sw > 0) {
      const k = slabK(r);
      ribbon(mb, r, i, hw, hw + r.sw, 'sidewalk', Y_WALK, trimA, trimB, k);
      ribbon(mb, r, i, -hw - r.sw, -hw, 'sidewalk', Y_WALK, trimA, trimB, k, true);
    } else if (SHOULDER_KINDS.has(r.kind) && !r.urban) {
      ribbon(mb, r, i, hw, hw + SHOULDER_W, 'shoulder', Y_SHOULDER, trimA, trimB, 1);
      ribbon(mb, r, i, -hw - SHOULDER_W, -hw, 'shoulder', Y_SHOULDER, trimA, trimB, 1, true);
    }
  }
}

// Gepflasterter Weg (Einfahrt, Gartenweg) als Band über das Gelände: pts = [[x,z],…], Breite w, hAt = Geländehöhe
export function pavedPath(mb, pts, w, hAt, strip = 'pavers') {
  const [u0, u1] = uRange(strip);
  const p = pBand(w);
  let s = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k], b = pts[k + 1];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.01) continue;
    const nx = -dz / L * w / 2, nz = dx / L * w / 2;
    const n = Math.max(1, Math.ceil(L / 1.0));
    for (let q = 0; q < n; q++) {
      const t0 = q / n, t1 = (q + 1) / n;
      const x0 = a[0] + dx * t0, z0 = a[1] + dz * t0, x1 = a[0] + dx * t1, z1 = a[1] + dz * t1;
      const y = (x, z) => hAt(x, z) + 0.05;
      const v0 = (s + L * t0) / ROAD_TILE_M, v1 = (s + L * t1) / ROAD_TILE_M;
      mb.quad([x0 - nx, y(x0 - nx, z0 - nz), z0 - nz], [x0 + nx, y(x0 + nx, z0 + nz), z0 + nz], [x1 + nx, y(x1 + nx, z1 + nz), z1 + nz], [x1 - nx, y(x1 - nx, z1 - nz), z1 - nz], 0, 1, 0, u0, v0, u1, v1, p[0], p[1], p[2]);
    }
    s += L;
  }
}

// Fahrbahnbelag der Kreuzung: der der breitesten Straße (damit Helligkeit und Farbe zu den Armen passen)
function padLook(jn) {
  let best = null;
  for (const a of jn.arms) if (a.r.kind !== 'track' && (!best || a.r.w > best.r.w)) best = a;
  if (!best) return ['track', 0.3];
  const strip = STRIP_OF[best.r.kind] || 'street';
  return [strip === 'prom' || strip === 'quay' ? 'plain' : strip, 0.4];
}

// Bürgersteig-Ecke als Band entlang der (gerundeten) Bordsteinkante. Querkoordinate = Abstand vom Bordstein,
// Längskoordinate = Fortsetzung der Plattenreihen von Arm A, minimal gestreckt, damit die Fugen auch an Arm B treffen.
// Vorher lag hier ein Fächer mit starrem Weltraster – das Muster kippte an jeder Ecke.
function walkCorner(mb, w, s0, s1) {
  const up = (p) => [p[0], p[1] + Y_WALK, p[2]];
  const ch = w.chain.map(up), n = ch.length;
  if (n < 2 || !w.A || !w.B) return;
  const sA = up(w.sA), sB = up(w.sB), co = up(w.co), A = w.A, B = w.B;
  // Echte Ecke (Arme nicht fast gegenüber): Bordstein entlang der Rundung, Platten geradlinig aus beiden Armen mit
  // Gehrungsfuge auf der Winkelhalbierenden. Fast gerade Fortführung: Band mit angeglichener Fugenteilung (unten).
  if (A.u[0] * B.u[0] + A.u[1] * B.u[1] > -0.85) { walkMiter(mb, ch, sA, sB, co, A, B, s0, s1); return; }
  const S = [0];
  for (let q = 1; q < n; q++) S.push(S[q - 1] + Math.hypot(ch[q][0] - ch[q - 1][0], ch[q][2] - ch[q - 1][2]));
  const L = S[n - 1] || 1;
  const vA = (A.end === 'a' ? A.trim : A.r.len - A.trim) * slabK(A.r);
  const vB = (B.end === 'a' ? B.trim : B.r.len - B.trim) * slabK(B.r);
  const dirA = A.end === 'a' ? -1 : 1;
  const raw = vA + dirA * L;
  let e = (((vB - raw) % SLAB) + SLAB) % SLAB;
  if (e > SLAB / 2) e -= SLAB;
  const along = (s) => vA + (dirA * L + e) * (s / L);
  // Außenpunkte: Strahl senkrecht zum Bordstein nach außen, geschnitten mit dem Außenrand sA – Ecke – sB
  const outerLine = [sA, co, sB];
  const hit = (P, N) => {
    let best = null;
    for (let k = 0; k < 2; k++) {
      const Q0 = outerLine[k], Q1 = outerLine[k + 1], ex = Q1[0] - Q0[0], ez = Q1[2] - Q0[2];
      const den = N[0] * ez - N[1] * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = Q0[0] - P[0], wz = Q0[2] - P[2];
      const t = (wx * ez - wz * ex) / den, u = (wx * N[1] - wz * N[0]) / den;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && (!best || t < best.t)) best = { t, k, p: [Q0[0] + ex * u, Q0[1] + (Q1[1] - Q0[1]) * u, Q0[2] + ez * u] };
    }
    return best;
  };
  const out = [], seg = [];
  for (let q = 0; q < n; q++) {
    if (q === 0) { out.push(sA); seg.push(0); continue; }
    if (q === n - 1) { out.push(sB); seg.push(1); continue; }
    const a = ch[q - 1], b = ch[q + 1];
    let nx = -(b[2] - a[2]), nz = b[0] - a[0];
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    if (nx * (co[0] - ch[q][0]) + nz * (co[2] - ch[q][2]) < 0) { nx = -nx; nz = -nz; }
    const h = hit(ch[q], [nx, nz]);
    if (h) { out.push(h.p); seg.push(h.k); } else { out.push(co); seg.push(0.5); }
  }
  const across = out.map((p, q) => Math.hypot(p[0] - ch[q][0], p[2] - ch[q][2]));
  const tris = [];
  for (let q = 0; q < n - 1; q++) {
    tris.push([[ch[q], 0, S[q]], [ch[q + 1], 0, S[q + 1]], [out[q + 1], across[q + 1], S[q + 1]]]);
    tris.push([[ch[q], 0, S[q]], [out[q + 1], across[q + 1], S[q + 1]], [out[q], across[q], S[q]]]);
    if (seg[q] === 0 && seg[q + 1] === 1) {
      const sm = (S[q] + S[q + 1]) / 2, mx = (ch[q][0] + ch[q + 1][0]) / 2, mz = (ch[q][2] + ch[q + 1][2]) / 2;
      tris.push([[out[q], across[q], S[q]], [out[q + 1], across[q + 1], S[q + 1]], [co, Math.hypot(co[0] - mx, co[2] - mz), sm]]);
    }
  }
  let W = 0.3;
  for (const t of tris) for (const v of t) W = Math.max(W, v[1]);
  W *= 1.01;
  const col = pBand(W);
  const uv = (v) => [s0 + (s1 - s0) * (v[1] / W), along(v[2]) / ROAD_TILE_M];
  for (const [a, b, c] of tris) mb.triUp(a[0], b[0], c[0], ...col, uv(a), uv(b), uv(c));
}

// Ecke mit Gehrung: Das Plattenraster jeder Hälfte ist die gerade Fortsetzung des Gehwegs von Arm A bzw. B
// (affine Abbildung -> Reihen bleiben gerade, Fugen treffen exakt auf die des Arms); nur der Bordstein folgt dem Bogen.
const CURB = 0.2;
function walkMiter(mb, ch, sA, sB, co, A, B, s0, s1) {
  const n = ch.length;
  // Bordsteinband entlang der Rundung (nach außen um CURB versetzt)
  const cOut = ch.map((p, q) => {
    const a = ch[Math.max(0, q - 1)], b = ch[Math.min(n - 1, q + 1)];
    let nx = -(b[2] - a[2]), nz = b[0] - a[0];
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    if (nx * (co[0] - p[0]) + nz * (co[2] - p[2]) < 0) { nx = -nx; nz = -nz; }
    return [p[0] + nx * CURB, p[1], p[2] + nz * CURB];
  });
  const cCol = pBand(1), cu = (t) => [s0 + (s1 - s0) * t, 0];
  for (let q = 0; q < n - 1; q++) {
    mb.triUp(ch[q], ch[q + 1], cOut[q + 1], ...cCol, cu(0), cu(0), cu(CURB));
    mb.triUp(ch[q], cOut[q + 1], cOut[q], ...cCol, cu(0), cu(CURB), cu(CURB));
  }
  // Plattenflächen der beiden Hälften
  const half = (arm, E, S, pts) => {
    let nx = S[0] - E[0], nz = S[2] - E[2];
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const k = slabK(arm.r), v0 = (arm.end === 'a' ? arm.trim : arm.r.len - arm.trim) * k, dir = arm.end === 'a' ? -1 : 1;
    const map = (p) => { const dx = p[0] - E[0], dz = p[2] - E[2]; return [dx * nx + dz * nz, v0 + dir * k * -(dx * arm.u[0] + dz * arm.u[1])]; };
    const m = pts.map(map);
    let W = 0.3;
    for (const [acr] of m) W = Math.max(W, acr);
    W *= 1.01;
    const col = pBand(W), uv = (q) => [s0 + (s1 - s0) * Math.max(0, m[q][0]) / W, m[q][1] / ROAD_TILE_M];
    // Fächer vom äußeren Eckpunkt (Index 0)
    for (let q = 1; q < pts.length - 1; q++) mb.triUp(pts[0], pts[q], pts[q + 1], ...col, uv(0), uv(q), uv(q + 1));
  };
  const mid = Math.floor((n - 1) / 2) + ((n - 1) % 2 ? 1 : 0);
  half(A, ch[0], sA, [co, sA, ...cOut.slice(0, mid + 1)]);
  half(B, ch[n - 1], sB, [co, ...cOut.slice(mid), sB]);
}

// Kreuzungsflächen und Zebrastreifen für Knoten im Rechteck
export function buildNodes(ctx, nodes, mb) {
  const net = ctx.net;
  const [z0, z1] = uRange('zebra'), [s0, s1] = uRange('sidewalk');
  for (const n of nodes) {
    if (n.roads.some((id) => net.roads[id].hidden)) continue;
    const jn = junctionOf(net, n);
    if (jn) {
      const [strip, uf] = padLook(jn);
      const [pu0, pu1] = uRange(strip);
      const uv = [pu0 + (pu1 - pu0) * uf, 0.3];
      const c = [n.x, n.y + Y_PAD, n.z];
      const ring = jn.road;
      // Holzbohlen: Textur quer zur breitesten Straße über die Fläche ziehen, damit die Kreuzung nicht einfarbig wirkt
      let uvOf = () => uv;
      if (strip === 'deck') {
        let wide = jn.arms[0];
        for (const a of jn.arms) if (a.r.w > wide.r.w) wide = a;
        const ax = wide.u[0], az = wide.u[1], W = Math.max(8, wide.r.w * 1.6);
        uvOf = (p) => { const dx = p[0] - n.x, dz = p[2] - n.z; return [pu0 + (pu1 - pu0) * Math.min(1, Math.max(0, 0.5 + (-dx * az + dz * ax) / W)), (dx * ax + dz * az) / ROAD_TILE_M]; };
      }
      for (let q = 0; q < ring.length; q++) {
        const a = ring[q], b = ring[(q + 1) % ring.length];
        mb.triUp(c, [a[0], a[1] + Y_PAD, a[2]], [b[0], b[1] + Y_PAD, b[2]], ...P_PAD, uvOf(c), uvOf(a), uvOf(b));
      }
      // Bürgersteig-Ecken: Plattenreihen laufen um die Ecke weiter
      for (const w of jn.walks) walkCorner(mb, w, s0, s1);
    } else {
      // Rückfall: kleine runde Fläche (Knoten mit Flug- oder Sonderstraßen)
      const R = nodePadRadius(net, n);
      if (R > 0) {
        const [u0, u1] = uRange('plain'), um = (u0 + u1) / 2, segs = 14;
        const c = [n.x, n.y + Y_PAD, n.z];
        for (let k = 0; k < segs; k++) {
          const a0 = (k / segs) * Math.PI * 2, a1 = ((k + 1) / segs) * Math.PI * 2;
          mb.triUp(c, [n.x + Math.cos(a0) * R * 1.04, n.y + Y_PAD, n.z + Math.sin(a0) * R * 1.04], [n.x + Math.cos(a1) * R * 1.04, n.y + Y_PAD, n.z + Math.sin(a1) * R * 1.04], ...P_PAD, [um, 0.3], [um, 0.3], [um, 0.3]);
        }
      }
    }
    // Zebrastreifen an städtischen Armen (nicht an reinen Ecken zweier Straßen)
    for (const id of n.roads.length >= 3 ? n.roads : []) {
      const r = net.roads[id];
      if (r.sw <= 0 || r.kind === 'promenade' || r.kind === 'quay' || r.len < 28) continue;
      const atStart = r.a === n.id && r.pts.length > 1;
      const R = armTrim(net, r, atStart ? 'a' : 'b');
      if (R <= 0) continue;
      const s = atStart ? R + 1.6 : r.len - R - 4.6;
      const hw = r.w / 2;
      // In Scheiben, damit der Streifen dem Höhenverlauf (Knicke zwischen den Straßenpunkten) folgt und nicht unter den Belag taucht
      const SL = 4;
      let p = net.pointAt(r, s, {});
      for (let k = 1; k <= SL; k++) {
        const q = net.pointAt(r, s + (3 * k) / SL, {});
        const nx = -p.dz, nz = p.dx;
        const mkv = (pp, off) => [pp.x + nx * off, pp.y + Y_ZEBRA, pp.z + nz * off];
        mb.quad(mkv(p, -hw), mkv(p, hw), mkv(q, hw), mkv(q, -hw), 0, 1, 0, z0, 0.1 + 0.2 * (k - 1) / SL, z1, 0.1 + 0.2 * k / SL, ...pBand(r.w));
        p = q;
      }
    }
  }
}
