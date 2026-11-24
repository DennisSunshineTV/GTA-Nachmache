// Prozedurale Fahrzeugmodelle (Loft-Karosserien, Räder, Lichter). Modell: Ursprung am Boden, Front = +z.
import * as THREE from 'three';
import { MeshBuilder } from '../world/meshbuilder.js';
import { toGeometry } from '../render/geom.js';
import { mulberry32 } from '../util.js';

// ---------- Hilfsfunktionen ----------

// Gitter-Loft mit glatten Normalen. stations: [{ z, pts:[[x,y,dz?], ...] }], pts = rechte Hälfte von unten-Mitte nach oben-Mitte
function gridLoft(mb, stations, col, opts = {}) {
  const n = stations[0].pts.length;
  const loopIdx = [];
  for (let i = 0; i < n; i++) loopIdx.push([i, 1]);
  for (let i = n - 2; i >= 1; i--) loopIdx.push([i, -1]);
  const cols = loopIdx.length, rows = stations.length;
  const P = [];
  for (let r = 0; r < rows; r++) {
    const st = stations[r];
    const row = [];
    for (const [i, sx] of loopIdx) { const p = st.pts[i]; row.push([p[0] * sx, p[1], st.z + (p[2] || 0)]); }
    P.push(row);
  }
  const nrm = P.map((row) => row.map(() => [0, 0, 0]));
  const faceN = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  };
  // Orientierung prüfen (Normale soll nach außen zeigen): Testquad in der Mitte, rechte Seite
  const mid = Math.floor(rows / 2), j0 = Math.max(1, Math.floor(n / 2));
  const t = faceN(P[mid][j0], P[Math.min(rows - 1, mid + 1)][j0], P[mid][(j0 + 1) % cols]);
  const out = [P[mid][j0][0] - 0, 0, 0];
  const flip = t[0] * out[0] < 0 ? -1 : 1;
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % cols;
      const a = P[r][j], b = P[r + 1][j], c = P[r + 1][j2], d = P[r][j2];
      const fn = faceN(a, b, c);
      const fn2 = faceN(a, c, d);
      for (const [rr, jj] of [[r, j], [r + 1, j], [r + 1, j2]]) { nrm[rr][jj][0] += fn[0]; nrm[rr][jj][1] += fn[1]; nrm[rr][jj][2] += fn[2]; }
      for (const [rr, jj] of [[r, j], [r + 1, j2], [r, j2]]) { nrm[rr][jj][0] += fn2[0]; nrm[rr][jj][1] += fn2[1]; nrm[rr][jj][2] += fn2[2]; }
    }
  }
  const base = mb.n;
  const vid = (r, j) => base + r * cols + j;
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j < cols; j++) {
      const p = P[r][j], q = nrm[r][j];
      const l = Math.hypot(q[0], q[1], q[2]) || 1;
      const c = opts.colorFn ? opts.colorFn(p, r, j) : col;
      mb.vert(p[0], p[1], p[2], flip * q[0] / l, flip * q[1] / l, flip * q[2] / l, 0, 0, c[0], c[1], c[2]);
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % cols;
      if (flip > 0) mb.idx.push(vid(r, j), vid(r + 1, j), vid(r + 1, j2), vid(r, j), vid(r + 1, j2), vid(r, j2));
      else mb.idx.push(vid(r, j), vid(r + 1, j2), vid(r + 1, j), vid(r, j), vid(r, j2), vid(r + 1, j2));
    }
  }
  // Endkappen (Fächer)
  const cap = (r, sign) => {
    const row = P[r];
    let cx = 0, cy = 0, cz = 0;
    for (const p of row) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= cols; cy /= cols; cz /= cols;
    const c0 = mb.vert(cx, cy, cz, 0, 0, sign, 0, 0, col[0], col[1], col[2]);
    const first = mb.n;
    for (const p of row) mb.vert(p[0], p[1], p[2], 0, 0, sign, 0, 0, col[0], col[1], col[2]);
    for (let j = 0; j < cols; j++) {
      const j2 = (j + 1) % cols;
      // Reihenfolge so wählen, dass die Normale ±z zeigt
      const a = row[j], b = row[j2];
      const cr = (a[0] - cx) * (b[1] - cy) - (a[1] - cy) * (b[0] - cx);
      if ((cr > 0) === (sign > 0)) mb.idx.push(c0, first + j, first + j2); else mb.idx.push(c0, first + j2, first + j);
    }
  };
  if (!opts.noCaps) { cap(0, -1); cap(rows - 1, 1); }
}

// Interpolierte Stationen aus Funktionen
function stationsFrom(n, zA, zB, fn) {
  const out = [];
  for (let i = 0; i < n; i++) { const t = i / (n - 1); out.push({ z: zA + (zB - zA) * t, pts: fn(t, i) }); }
  return out;
}
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// Rad (Achse x): Reifen + Felge. Rückgabe: Geometry
const wheelCache = new Map();
export function wheelGeometry(r, w, rim = [0.78, 0.8, 0.84], spokes = 5) {
  const key = `${r}|${w}|${rim.join(',')}|${spokes}`;
  if (wheelCache.has(key)) return wheelCache.get(key);
  const mb = new MeshBuilder();
  const segs = 18;
  // Zylinder um x-Achse: Seitenfläche + beide Flächen
  const ring = (rad, x) => Array.from({ length: segs }, (_, i) => { const a = (i / segs) * Math.PI * 2; return [x, Math.sin(a) * rad, Math.cos(a) * rad, Math.sin(a), Math.cos(a)]; });
  const tireCol = [0.06, 0.06, 0.065];
  const rin = ring(r, -w / 2), rout = ring(r, w / 2);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs;
    const a = rin[i], b = rin[j], c = rout[j], d = rout[i];
    const i0 = mb.n;
    mb.vert(a[0], a[1], a[2], 0, a[3], a[4], 0, 0, ...tireCol);
    mb.vert(d[0], d[1], d[2], 0, d[3], d[4], 0, 0, ...tireCol);
    mb.vert(c[0], c[1], c[2], 0, c[3], c[4], 0, 0, ...tireCol);
    mb.vert(b[0], b[1], b[2], 0, b[3], b[4], 0, 0, ...tireCol);
    mb.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }
  // Außen-/Innenflächen mit Felge
  for (const sx of [-1, 1]) {
    const x = (w / 2) * sx + sx * 0.002;
    const c0 = mb.vert(x, 0, 0, sx, 0, 0, 0, 0, ...rim);
    const rr = r * 0.74;
    const first = mb.n;
    for (let i = 0; i < segs; i++) { const a = (i / segs) * Math.PI * 2; mb.vert(x, Math.sin(a) * rr, Math.cos(a) * rr, sx, 0, 0, 0, 0, ...(i % 2 ? rim : [rim[0] * 0.8, rim[1] * 0.8, rim[2] * 0.8])); }
    for (let i = 0; i < segs; i++) { const j = (i + 1) % segs; if (sx > 0) mb.idx.push(c0, first + j, first + i); else mb.idx.push(c0, first + i, first + j); }
    // Reifenflanke
    const f2 = mb.n;
    for (let i = 0; i < segs; i++) { const a = (i / segs) * Math.PI * 2; mb.vert(x, Math.sin(a) * rr, Math.cos(a) * rr, sx, 0, 0, 0, 0, ...tireCol); mb.vert(x, Math.sin(a) * r, Math.cos(a) * r, sx, 0, 0, 0, 0, ...tireCol); }
    for (let i = 0; i < segs; i++) { const j = (i + 1) % segs; const a = f2 + i * 2, b = f2 + j * 2; if (sx > 0) mb.idx.push(a, b, a + 1, b, b + 1, a + 1); else mb.idx.push(a, a + 1, b, b, a + 1, b + 1); }
  }
  void spokes;
  const g = toGeometry(mb);
  wheelCache.set(key, g);
  return g;
}

// ---------- Materialien ----------
export const VMAT = {
  body: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.3 }),
  trim: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x0d141c, metalness: 0.95, roughness: 0.06, transparent: false }),
  wheel: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.55 }),
  head: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1) }),
  tail: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1) }),
};

export const PAINTS = [
  [0.75, 0.05, 0.06], [0.05, 0.18, 0.55], [0.95, 0.95, 0.95], [0.04, 0.04, 0.05], [0.7, 0.72, 0.76], [0.95, 0.72, 0.05], [0.9, 0.35, 0.05],
  [0.05, 0.4, 0.22], [0.5, 0.05, 0.4], [0.2, 0.2, 0.22], [0.55, 0.45, 0.32], [0.1, 0.5, 0.75],
];

// ---------- Auto-Karosserie ----------

// Parametrische Karosserie. p: { L, W, bottom, belt, hood, trunk, roof, cabin:[t0,t1], rakeF, rakeR, wheelR, wheelBase, track, ... }
function carBody(p, paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  const hl = p.L / 2, hw = p.W / 2;
  const dark = [0.05, 0.05, 0.06], chrome = [0.72, 0.74, 0.78];
  const roofCol = p.roofCol || paint;
  // Unterbau: Stationen von hinten (t=0) nach vorn (t=1)
  const lower = stationsFrom(15, -hl, hl, (t) => {
    // Höhenprofile: Heck bis Gürtel, Haube fällt zur Front ab
    const yt = t < 0.15 ? lerp(p.trunk - 0.05, p.trunk, sm(0, 0.15, t)) : t < 0.55 ? lerp(p.trunk, p.belt, sm(0.15, 0.55, t)) : lerp(p.belt, p.hood, sm(0.55, 0.85, t)) - (t > 0.92 ? (t - 0.92) * 1.1 : 0);
    const w = hw * (t < 0.04 ? 0.9 + t * 2.5 : t > 0.94 ? 1 - (t - 0.94) * 2.4 : 1);
    const yb = p.bottom + (t < 0.04 || t > 0.96 ? 0.1 : 0);
    const bh = yt - yb;
    return [[0, yb, 0], [w * 0.92, yb, 0], [w, yb + bh * 0.28, 0], [w * 0.985, yb + bh * 0.72, 0], [w * 0.9, yt, 0], [0, yt + 0.006, 0]];
  });
  gridLoft(body, lower, paint);
  // Kabine (Greenhouse)
  const [c0, c1] = p.cabin;
  const zc0 = lerp(-hl, hl, c0), zc1 = lerp(-hl, hl, c1);
  const yBelt = p.belt - 0.04;
  const cab = stationsFrom(9, zc0, zc1, (t) => {
    const e = Math.min(t, 1 - t) * 2; // 0 an den Enden, 1 in der Mitte
    const hwb = hw * 0.9 * (0.92 + 0.08 * Math.min(1, e * 3));
    const roofY = p.roof - (1 - Math.min(1, e * 2.2)) * 0.06;
    const rakeF = p.rakeF, rakeR = p.rakeR;
    const dz = (t < 0.5 ? rakeR : -rakeF);
    const dzMid = dz * 0.5;
    return [[0, yBelt - 0.12, 0], [hwb, yBelt - 0.12, 0], [hwb, yBelt, 0], [hwb * 0.88, lerp(yBelt, roofY, 0.55), dzMid * (t < 0.5 ? 1 : 1) * Math.max(0, 1 - e * 4)], [hwb * 0.74, roofY - 0.02, dz * Math.max(0, 1 - e * 5)], [0, roofY, dz * Math.max(0, 1 - e * 5)]];
  });
  gridLoft(body, cab, roofCol);
  // Glasflächen: Seiten
  const gz0 = zc0 + 0.32, gz1 = zc1 - 0.32;
  const hwb = hw * 0.9;
  const yg0 = yBelt + 0.04, yg1 = p.roof - 0.1;
  for (const sx of [-1, 1]) {
    const pillar = (p.pillar ?? 0.1);
    const mid = (gz0 + gz1) / 2 + p.bPillar * 0 ;
    const x0 = hwb * 1.006, x1 = hwb * 0.83;
    const seg = (za, zb) => { glass.quadAuto([sx * x0, yg0, za], [sx * x0, yg0, zb], [sx * x1, yg1, zb - 0.06], [sx * x1, yg1, za + 0.06], 0.1, 0.12, 0.16); };
    if (sx > 0) { glass.quadAuto([x0 * sx, yg0, gz1], [x0 * sx, yg0, gz0], [x1 * sx, yg1, gz0 + 0.06], [x1 * sx, yg1, gz1 - 0.06], 1, 1, 1); }
    else glass.quadAuto([x0 * sx, yg0, gz0], [x0 * sx, yg0, gz1], [x1 * sx, yg1, gz1 - 0.06], [x1 * sx, yg1, gz0 + 0.06], 1, 1, 1);
    void seg; void mid; void pillar;
  }
  // Frontscheibe / Heckscheibe (Neigung aus den Rakes)
  const wf = hwb * 0.7;
  const yfb = lerp(yBelt, p.roof, 0.04), yft = p.roof - 0.03;
  glass.quadAuto([-wf, yfb, zc1 + 0.003], [wf, yfb, zc1 + 0.003], [wf * 0.82, yft, zc1 - p.rakeF - 0.01], [-wf * 0.82, yft, zc1 - p.rakeF - 0.01], 1, 1, 1);
  glass.quadAuto([wf, yfb, zc0 - 0.003], [-wf, yfb, zc0 - 0.003], [-wf * 0.82, yft, zc0 + p.rakeR + 0.01], [wf * 0.82, yft, zc0 + p.rakeR + 0.01], 1, 1, 1);
  // Stoßfänger, Grill, Lichter
  const bf = p.bottom + 0.02;
  body.box(0, bf, hl - 0.12, p.W * 0.97, 0.22, 0.26, 0, ...dark, { shade: false });
  body.box(0, bf, -hl + 0.12, p.W * 0.97, 0.22, 0.26, 0, ...dark, { shade: false });
  body.box(0, p.hood - 0.32, hl - 0.03, p.W * 0.42, 0.18, 0.06, 0, ...(p.chromeGrille ? chrome : dark));
  body.box(0, p.bottom + 0.14, hl - 0.015, p.W * 0.5, 0.1, 0.05, 0, ...dark);
  // Kennzeichen
  body.box(0, p.bottom + 0.34, hl + 0.02, 0.5, 0.12, 0.012, 0, 0.9, 0.9, 0.86, { noBottom: true });
  body.box(0, p.bottom + 0.36, -hl - 0.02, 0.5, 0.12, 0.012, 0, 0.9, 0.9, 0.86, { noBottom: true });
  for (const sx of [-1, 1]) {
    head.box(sx * hw * 0.68, p.hood - 0.22, hl - 0.05, hw * 0.4, 0.12, 0.08, 0, 1, 0.95, 0.85, { shade: false });
    tail.box(sx * hw * 0.7, p.trunk - 0.22, -hl + 0.04, hw * 0.46, 0.11, 0.07, 0, 0.9, 0.04, 0.04, { shade: false });
    // Spiegel
    body.box(sx * (hw * 0.93 + 0.08), yBelt + 0.05, zc1 - 0.15, 0.14, 0.1, 0.18, 0, ...paint);
    // Auspuff
    body.cylinder(sx * hw * 0.5, p.bottom + 0.02, -hl - 0.04, 0.045, 0.045, 0.14, 8, ...chrome);
  }
  if (p.spoiler) {
    for (const sx of [-1, 1]) body.box(sx * hw * 0.6, p.trunk - 0.02, -hl + 0.26, 0.05, 0.2, 0.12, 0, ...dark);
    body.box(0, p.trunk + 0.17, -hl + 0.24, p.W * 0.9, 0.04, 0.32, 0, ...(p.spoilerCol || dark));
  }
  if (p.roofRails) for (const sx of [-1, 1]) body.box(sx * hw * 0.72, p.roof + 0.0, (zc0 + zc1) / 2, 0.05, 0.05, (zc1 - zc0) * 0.8, 0, ...chrome);
  if (p.stripes) {
    body.box(-0.2, p.hood + 0.005, hl * 0.45, 0.12, 0.01, hl, 0, 0.95, 0.95, 0.95, { noBottom: true }); body.box(0.2, p.hood + 0.005, hl * 0.45, 0.12, 0.01, hl, 0, 0.95, 0.95, 0.95, { noBottom: true });
  }
  return { body, glass, head, tail };
}

const CAR_DEFS = {
  sports: { L: 4.5, W: 1.94, bottom: 0.13, belt: 0.74, hood: 0.7, trunk: 0.86, roof: 1.2, cabin: [0.27, 0.69], rakeF: 0.72, rakeR: 0.55, wheelR: 0.35, wb: 2.64, track: 1.66, spoiler: true, bPillar: 0 },
  coupe: { L: 4.75, W: 1.92, bottom: 0.15, belt: 0.86, hood: 0.78, trunk: 0.95, roof: 1.31, cabin: [0.3, 0.64], rakeF: 0.6, rakeR: 0.45, wheelR: 0.36, wb: 2.75, track: 1.64, spoiler: false, stripes: true, bPillar: 0 },
  luxury: { L: 5.05, W: 1.9, bottom: 0.17, belt: 0.92, hood: 0.92, trunk: 1.0, roof: 1.48, cabin: [0.24, 0.72], rakeF: 0.7, rakeR: 0.5, wheelR: 0.37, wb: 3.0, track: 1.62, chromeGrille: true, bPillar: 0 },
  limo: { L: 6.9, W: 1.95, bottom: 0.17, belt: 0.94, hood: 0.92, trunk: 1.0, roof: 1.5, cabin: [0.2, 0.74], rakeF: 0.65, rakeR: 0.4, wheelR: 0.37, wb: 4.4, track: 1.66, chromeGrille: true, bPillar: 0 },
  suv: { L: 4.75, W: 2.02, bottom: 0.26, belt: 1.12, hood: 1.1, trunk: 1.2, roof: 1.84, cabin: [0.2, 0.9], rakeF: 0.5, rakeR: 0.12, wheelR: 0.43, wb: 2.85, track: 1.7, roofRails: true, bPillar: 0 },
  compact: { L: 3.75, W: 1.72, bottom: 0.17, belt: 0.82, hood: 0.84, trunk: 0.98, roof: 1.46, cabin: [0.2, 0.86], rakeF: 0.55, rakeR: 0.18, wheelR: 0.31, wb: 2.4, track: 1.48, bPillar: 0 },
  taxi: { L: 4.9, W: 1.85, bottom: 0.17, belt: 0.9, hood: 0.9, trunk: 0.98, roof: 1.46, cabin: [0.24, 0.72], rakeF: 0.7, rakeR: 0.5, wheelR: 0.36, wb: 2.85, track: 1.58, bPillar: 0 },
  police: { L: 4.95, W: 1.9, bottom: 0.17, belt: 0.92, hood: 0.92, trunk: 1.0, roof: 1.46, cabin: [0.24, 0.72], rakeF: 0.7, rakeR: 0.5, wheelR: 0.37, wb: 2.9, track: 1.62, bPillar: 0 },
  van: { L: 5.3, W: 2.04, bottom: 0.25, belt: 1.0, hood: 1.0, trunk: 2.2, roof: 2.45, cabin: [0.62, 0.95], rakeF: 0.4, rakeR: 0, wheelR: 0.38, wb: 3.2, track: 1.72, bPillar: 0 },
};

// ---------- Typbeschreibungen ----------
// Einheitliches Ergebnis: { parts: {body, glass, head, tail}, wheels:[{x,y,z,r,w,steer}], hw, hl, h, seat:{x,y,z}, extras }
function buildCar(type, paint, rng) {
  const p = CAR_DEFS[type];
  const { body, glass, head, tail } = carBody(p, paint);
  const hl = p.L / 2;
  const wheels = [];
  const wz = p.wb / 2, tx = p.track / 2;
  const ww = type === 'suv' ? 0.3 : type === 'sports' ? 0.34 : 0.24;
  const shiftF = type === 'van' ? 0.15 : 0.0;
  for (const [x, z, steer] of [[-tx, wz + shiftF, true], [tx, wz + shiftF, true], [-tx, -wz + shiftF * -1, false], [tx, -wz - shiftF, false]]) wheels.push({ x, y: p.wheelR, z, r: p.wheelR, w: ww, steer, left: x < 0 });
  const extras = {};
  if (type === 'taxi') {
    body.box(0, p.roof + 0.0, 0, 0.55, 0.16, 0.2, 0, 0.98, 0.85, 0.1);
    head.box(0, p.roof + 0.08, 0.11, 0.4, 0.07, 0.02, 0, 1, 1, 0.9, { shade: false });
  }
  if (type === 'police') {
    // Lichtbalken (eigene Teile für rotes/blaues Blinken)
    body.box(0, p.roof, -0.05, 1.05, 0.08, 0.3, 0, 0.1, 0.1, 0.12);
    extras.lightbar = { y: p.roof + 0.09, z: -0.05, w: 1.05 };
    // Streifen (weißer Mittelstreifen, Türen)
    body.box(0, p.belt + 0.003, -0.3, p.W * 1.002, 0.28, 1.5, 0, 0.95, 0.95, 0.97, { shade: false, noTop: true, noBottom: true });
  }
  if (type === 'van') body.box(0, 1.2, -hl * 0.3, p.W * 1.003, 0.5, 1.9, 0, 0.95, 0.95, 0.95, { shade: false, noTop: true, noBottom: true });
  return { parts: { body, glass, head, tail }, wheels, hw: p.W / 2, hl, h: p.roof + (type === 'police' ? 0.1 : 0), seat: { x: -0.4, y: p.belt - 0.25, z: type === 'van' ? 0.9 : 0.1 }, extras, wheelR: p.wheelR };
}

function boxTruck(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  const dark = [0.06, 0.06, 0.07];
  // Fahrerhaus
  const cab = { L: 2.2, W: 2.45, H: 2.9 };
  body.box(0, 0.55, 3.4, 2.4, 0.55, 2.0, 0, ...paint);
  gridLoft(body, stationsFrom(7, 2.3, 4.4, (t) => [[0, 0.5, 0], [1.2, 0.5, 0], [1.22, 1.3, 0], [1.2, 2.2 + 0.15 * (1 - t), 0], [1.05, 2.9 - t * 0.5, -t * 0.0], [0, 2.9 - t * 0.5, 0]]), paint);
  glass.quadAuto([-0.95, 1.7, 4.41], [0.95, 1.7, 4.41], [0.95, 2.6, 4.25], [-0.95, 2.6, 4.25], 1, 1, 1);
  for (const sx of [-1, 1]) glass.quadAuto([sx * 1.24, 1.75, 3.9], [sx * 1.24, 1.75, 2.9], [sx * 1.15, 2.55, 2.95], [sx * 1.15, 2.55, 3.85], 1, 1, 1);
  // Kasten
  body.box(0, 0.75, 0.15, 2.55, 2.8, 6.3, 0, 0.92, 0.92, 0.9);
  body.box(0, 0.75, 0.15, 2.57, 0.18, 6.32, 0, 0.2, 0.2, 0.22);
  body.box(0, 1.8, 0.15, 2.58, 0.3, 6.1, 0, ...paint, { noTop: true, noBottom: true });
  body.box(0, 0.3, 4.62, 2.5, 0.3, 0.3, 0, ...dark);
  body.box(0, 0.3, -3.06, 2.5, 0.3, 0.3, 0, ...dark);
  for (const sx of [-1, 1]) { head.box(sx * 0.85, 0.85, 4.45, 0.4, 0.2, 0.06, 0, 1, 0.95, 0.85, { shade: false }); tail.box(sx * 1.1, 0.7, -3.07, 0.2, 0.3, 0.06, 0, 0.9, 0.05, 0.05, { shade: false }); }
  const wheels = [];
  for (const [x, z, s] of [[-1.05, 3.5, true], [1.05, 3.5, true], [-1.05, -1.7, false], [1.05, -1.7, false], [-1.05, -2.7, false], [1.05, -2.7, false]]) wheels.push({ x, y: 0.5, z, r: 0.5, w: 0.32, steer: s, left: x < 0 });
  return { parts: { body, glass, head, tail }, wheels, hw: 1.3, hl: 3.8, h: 3.7, seat: { x: -0.5, y: 1.55, z: 3.35 }, extras: {}, wheelR: 0.5 };
}

function bus(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  const L = 11.5, W = 2.55, H = 3.2;
  body.box(0, 0.35, 0, W, H - 0.35, L, 0, 0.95, 0.95, 0.95);
  body.box(0, 0.35, 0, W + 0.01, 1.0, L + 0.01, 0, ...paint, { noTop: true });
  body.box(0, H - 0.5, 0, W + 0.01, 0.5, L + 0.01, 0, ...paint, { noBottom: true });
  for (const sx of [-1, 1]) {
    glass.quadAuto([sx * (W / 2 + 0.006), 1.45, L / 2 - 0.4].map((v, i) => v), [sx * (W / 2 + 0.006), 1.45, -L / 2 + 0.4], [sx * (W / 2 + 0.006), H - 0.55, -L / 2 + 0.4], [sx * (W / 2 + 0.006), H - 0.55, L / 2 - 0.4], 1, 1, 1);
  }
  glass.quadAuto([-1.1, 1.5, L / 2 + 0.006], [1.1, 1.5, L / 2 + 0.006], [1.1, H - 0.5, L / 2 + 0.006], [-1.1, H - 0.5, L / 2 + 0.006], 1, 1, 1);
  glass.quadAuto([1.1, 1.5, -L / 2 - 0.006], [-1.1, 1.5, -L / 2 - 0.006], [-1.1, H - 0.8, -L / 2 - 0.006], [1.1, H - 0.8, -L / 2 - 0.006], 1, 1, 1);
  head.box(-0.85, 0.85, L / 2, 0.4, 0.2, 0.05, 0, 1, 0.95, 0.85, { shade: false }); head.box(0.85, 0.85, L / 2, 0.4, 0.2, 0.05, 0, 1, 0.95, 0.85, { shade: false });
  tail.box(-1.0, 0.9, -L / 2, 0.3, 0.4, 0.05, 0, 0.9, 0.05, 0.05, { shade: false }); tail.box(1.0, 0.9, -L / 2, 0.3, 0.4, 0.05, 0, 0.9, 0.05, 0.05, { shade: false });
  body.box(0, H, 0, 1.2, 0.35, 2.2, 0, 0.9, 0.9, 0.92); // Klimaanlage
  const wheels = [];
  for (const [x, z, s] of [[-1.05, 3.7, true], [1.05, 3.7, true], [-1.05, -3.4, false], [1.05, -3.4, false]]) wheels.push({ x, y: 0.5, z, r: 0.52, w: 0.32, steer: s, left: x < 0 });
  return { parts: { body, glass, head, tail }, wheels, hw: W / 2, hl: L / 2, h: H + 0.4, seat: { x: -0.6, y: 1.6, z: 4.6 }, extras: {}, wheelR: 0.52 };
}

function pickup(paint) {
  const p = { L: 5.4, W: 2.0, bottom: 0.25, belt: 1.05, hood: 1.05, trunk: 1.0, roof: 1.85, cabin: [0.3, 0.6], rakeF: 0.5, rakeR: 0.05, wheelR: 0.42, wb: 3.3, track: 1.7, roofRails: false, bPillar: 0 };
  const { body, glass, head, tail } = carBody(p, paint);
  // Ladefläche: dunkle Wanne
  body.box(0, 0.95, -1.4, 1.7, 0.04, 1.9, 0, 0.1, 0.1, 0.1);
  for (const sx of [-1, 1]) body.box(sx * 0.95, 0.95, -1.4, 0.08, 0.3, 2.1, 0, ...paint);
  body.box(0, 0.95, -2.35, 1.9, 0.3, 0.08, 0, ...paint);
  const wheels = [];
  for (const [x, z, s] of [[-0.85, 1.65, true], [0.85, 1.65, true], [-0.85, -1.65, false], [0.85, -1.65, false]]) wheels.push({ x, y: 0.42, z, r: 0.42, w: 0.3, steer: s, left: x < 0 });
  return { parts: { body, glass, head, tail }, wheels, hw: 1.0, hl: 2.7, h: 1.9, seat: { x: -0.4, y: 0.85, z: 0.45 }, extras: {}, wheelR: 0.42 };
}

function motorbike(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  const dark = [0.06, 0.06, 0.07], chrome = [0.75, 0.77, 0.8];
  gridLoft(body, stationsFrom(6, -0.2, 0.55, (t) => [[0, 0.62, 0], [0.12, 0.62, 0], [0.16, 0.8, 0], [0.12, 0.98 - t * 0.1, 0], [0, 1.02 - t * 0.1, 0]]), paint);
  body.box(0, 0.72, -0.5, 0.2, 0.15, 0.8, 0, ...dark);   // Heck
  body.box(0, 0.86, -0.4, 0.24, 0.1, 0.7, 0, 0.08, 0.08, 0.09); // Sitz
  body.box(0, 0.38, 0.0, 0.2, 0.34, 0.6, 0, 0.12, 0.12, 0.13); // Motor
  body.box(0, 0.25, 0.0, 0.16, 0.1, 0.55, 0, ...chrome);
  // Gabel + Lenker
  for (const sx of [-1, 1]) { body.box(sx * 0.1, 0.35, 0.85, 0.04, 0.8, 0.05, 0, ...chrome); body.box(sx * 0.35, 1.2, 0.72, 0.5, 0.04, 0.04, 0, ...dark); }
  body.box(0, 0.95, 0.6, 0.3, 0.3, 0.3, 0, ...paint);
  glass.quadAuto([-0.15, 1.05, 0.7], [0.15, 1.05, 0.7], [0.12, 1.4, 0.5], [-0.12, 1.4, 0.5], 1, 1, 1);
  head.box(0, 1.1, 0.78, 0.2, 0.15, 0.06, 0, 1, 0.95, 0.85, { shade: false });
  tail.box(0, 0.88, -0.93, 0.18, 0.06, 0.05, 0, 0.9, 0.05, 0.05, { shade: false });
  body.cylinder(0.18, 0.24, -0.5, 0.05, 0.06, 0.8, 8, ...chrome);
  const wheels = [{ x: 0, y: 0.33, z: 0.88, r: 0.33, w: 0.14, steer: true, left: false }, { x: 0, y: 0.33, z: -0.7, r: 0.34, w: 0.18, steer: false, left: false }];
  return { parts: { body, glass, head, tail }, wheels, hw: 0.4, hl: 1.1, h: 1.4, seat: { x: 0, y: 0.8, z: -0.2 }, extras: { bike: true }, wheelR: 0.33 };
}

function tractor(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  const dark = [0.08, 0.08, 0.09];
  body.box(0, 0.7, 0.5, 1.0, 0.9, 1.9, 0, ...paint); // Motorhaube
  body.box(0, 1.55, 0.5, 0.9, 0.06, 1.8, 0, ...paint);
  body.cylinder(0.25, 1.6, 1.35, 0.06, 0.06, 0.5, 6, 0.2, 0.2, 0.22);
  body.box(0, 0.9, -1.0, 1.5, 0.55, 1.5, 0, ...paint);
  // Kabine
  for (const [x, z] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, -1.7], [0.7, -1.7]]) body.box(x, 1.45, z, 0.07, 1.4, 0.07, 0, 0.1, 0.1, 0.12);
  body.box(0, 2.85, -1.0, 1.65, 0.07, 1.65, 0, ...paint);
  glass.quadAuto([-0.7, 1.5, -0.28], [0.7, 1.5, -0.28], [0.7, 2.8, -0.28], [-0.7, 2.8, -0.28], 1, 1, 1);
  glass.quadAuto([0.7, 1.5, -1.72], [-0.7, 1.5, -1.72], [-0.7, 2.8, -1.72], [0.7, 2.8, -1.72], 1, 1, 1);
  for (const sx of [-1, 1]) glass.quadAuto([sx * 0.71, 1.5, -1.7], [sx * 0.71, 1.5, -0.3], [sx * 0.71, 2.8, -0.3], [sx * 0.71, 2.8, -1.7], 1, 1, 1);
  head.box(-0.35, 0.95, 1.46, 0.2, 0.15, 0.05, 0, 1, 0.95, 0.8, { shade: false }); head.box(0.35, 0.95, 1.46, 0.2, 0.15, 0.05, 0, 1, 0.95, 0.8, { shade: false });
  tail.box(-0.6, 1.0, -1.76, 0.15, 0.1, 0.04, 0, 0.9, 0.05, 0.05, { shade: false }); tail.box(0.6, 1.0, -1.76, 0.15, 0.1, 0.04, 0, 0.9, 0.05, 0.05, { shade: false });
  body.box(0, 0.35, 1.5, 0.8, 0.25, 0.2, 0, ...dark);
  const wheels = [{ x: -0.85, y: 0.5, z: 1.1, r: 0.5, w: 0.3, steer: true, left: true }, { x: 0.85, y: 0.5, z: 1.1, r: 0.5, w: 0.3, steer: true }, { x: -1.0, y: 0.85, z: -1.0, r: 0.85, w: 0.5, steer: false, left: true }, { x: 1.0, y: 0.85, z: -1.0, r: 0.85, w: 0.5, steer: false }];
  return { parts: { body, glass, head, tail }, wheels, hw: 1.3, hl: 2.0, h: 3.0, seat: { x: 0, y: 1.3, z: -0.95 }, extras: { rim: [0.8, 0.15, 0.1] }, wheelR: 0.85 };
}

function forklift(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  const dark = [0.08, 0.08, 0.09];
  body.box(0, 0.4, -0.3, 1.1, 0.8, 1.8, 0, ...paint);
  body.box(0, 1.1, -0.7, 1.0, 0.2, 0.9, 0, 0.1, 0.1, 0.12);   // Sitz
  body.box(0, 0.9, -1.35, 1.0, 0.7, 0.3, 0, ...dark);          // Gegengewicht
  for (const [x, z] of [[-0.5, 0.2], [0.5, 0.2], [-0.5, -1.2], [0.5, -1.2]]) body.box(x, 1.2, z, 0.05, 1.1, 0.05, 0, 0.1, 0.1, 0.12);
  body.box(0, 2.35, -0.5, 1.1, 0.05, 1.5, 0, 0.1, 0.1, 0.12);
  // Mast
  for (const x of [-0.35, 0.35]) body.box(x, 0.1, 0.95, 0.08, 2.4, 0.1, 0, 0.12, 0.12, 0.14);
  body.box(0, 1.5, 0.95, 0.8, 0.06, 0.1, 0, 0.12, 0.12, 0.14);
  // Gabeln
  for (const x of [-0.3, 0.3]) { body.box(x, 0.18, 1.5, 0.1, 0.06, 1.1, 0, 0.55, 0.55, 0.58); body.box(x, 0.18, 0.98, 0.1, 0.8, 0.06, 0, 0.55, 0.55, 0.58); }
  head.box(-0.35, 0.95, 0.62, 0.15, 0.1, 0.04, 0, 1, 0.95, 0.8, { shade: false }); head.box(0.35, 0.95, 0.62, 0.15, 0.1, 0.04, 0, 1, 0.95, 0.8, { shade: false });
  tail.box(0, 0.9, -1.51, 0.3, 0.08, 0.04, 0, 0.9, 0.05, 0.05, { shade: false });
  body.box(0, 2.1, -0.5, 0.2, 0.2, 0.2, 0, 1, 0.6, 0.0);
  const wheels = [{ x: -0.55, y: 0.35, z: 0.4, r: 0.35, w: 0.22, steer: false, left: true }, { x: 0.55, y: 0.35, z: 0.4, r: 0.35, w: 0.22, steer: false }, { x: -0.5, y: 0.28, z: -1.05, r: 0.28, w: 0.2, steer: true, left: true }, { x: 0.5, y: 0.28, z: -1.05, r: 0.28, w: 0.2, steer: true }];
  return { parts: { body, glass, head, tail }, wheels, hw: 0.7, hl: 1.7, h: 2.4, seat: { x: 0, y: 0.95, z: -0.7 }, extras: { forks: true }, wheelR: 0.35 };
}

function excavator(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  const dark = [0.1, 0.1, 0.11];
  // Raupenfahrwerk
  for (const sx of [-1, 1]) {
    body.box(sx * 1.35, 0.0, 0, 0.8, 0.9, 4.0, 0, ...dark);
    body.box(sx * 1.35, 0.9, 0, 0.7, 0.1, 3.9, 0, 0.2, 0.2, 0.22);
    for (let k = -1.6; k <= 1.7; k += 0.6) body.cylinder(sx * 1.35, 0.1, k, 0.28, 0.28, 0.0, 8, 0.15, 0.15, 0.16, true);
  }
  body.box(0, 0.25, 0, 2.0, 0.6, 3.2, 0, 0.18, 0.18, 0.2);
  // Oberwagen
  body.box(0, 0.85, -0.2, 2.7, 0.9, 3.0, 0, ...paint);
  body.box(0, 1.75, -0.9, 2.5, 0.9, 1.4, 0, ...paint);   // Heck
  body.box(0.8, 1.75, 0.8, 1.2, 1.6, 1.4, 0, ...paint);  // Kabine
  glass.quadAuto([0.25, 2.0, 1.51], [1.35, 2.0, 1.51], [1.35, 3.2, 1.51], [0.25, 3.2, 1.51], 1, 1, 1);
  glass.quadAuto([1.41, 2.0, 1.45], [1.41, 2.0, 0.15], [1.41, 3.2, 0.15], [1.41, 3.2, 1.45], 1, 1, 1);
  // Ausleger (3 Teile)
  const A = [0, 1.4, 1.4];
  const boom = (a, b, th, col) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    const px = 0, py = -dz / Math.hypot(dy, dz), pz = dy / Math.hypot(dy, dz);
    void px;
    body.quadAuto([a[0] - th, a[1] + py * th, a[2] + pz * th], [b[0] - th, b[1] + py * th, b[2] + pz * th], [b[0] - th, b[1] - py * th, b[2] - pz * th], [a[0] - th, a[1] - py * th, a[2] - pz * th], ...col);
    body.quadAuto([a[0] + th, a[1] - py * th, a[2] - pz * th], [b[0] + th, b[1] - py * th, b[2] - pz * th], [b[0] + th, b[1] + py * th, b[2] + pz * th], [a[0] + th, a[1] + py * th, a[2] + pz * th], ...col);
    body.quadAuto([a[0] - th, a[1] + py * th, a[2] + pz * th], [a[0] + th, a[1] + py * th, a[2] + pz * th], [b[0] + th, b[1] + py * th, b[2] + pz * th], [b[0] - th, b[1] + py * th, b[2] + pz * th], ...col);
    body.quadAuto([b[0] - th, b[1] - py * th, b[2] - pz * th], [b[0] + th, b[1] - py * th, b[2] - pz * th], [a[0] + th, a[1] - py * th, a[2] - pz * th], [a[0] - th, a[1] - py * th, a[2] - pz * th], ...col);
    void L;
  };
  const B1 = [0, 3.3, 3.3], B2 = [0, 2.3, 5.9], B3 = [0, 0.4, 6.1];
  boom(A, B1, 0.2, paint); boom(B1, B2, 0.15, paint); boom(B2, B3, 0.14, [0.3, 0.3, 0.32]);
  body.box(0, 0.0, 6.2, 1.1, 0.7, 0.7, 0, 0.35, 0.35, 0.38); // Löffel
  head.box(-0.7, 3.25, 1.5, 0.4, 0.2, 0.06, 0, 1, 0.95, 0.8, { shade: false });
  tail.box(0, 1.9, -1.62, 0.5, 0.2, 0.05, 0, 0.9, 0.05, 0.05, { shade: false });
  return { parts: { body, glass, head, tail }, wheels: [], hw: 1.9, hl: 2.0, h: 3.4, seat: { x: 0.8, y: 1.8, z: 0.8 }, extras: { tracks: true }, wheelR: 0.5 };
}

// ---------- Boote ----------
function hullLoft(L, W, depth, deck, paint, trimCol = [0.95, 0.95, 0.96]) {
  const st = stationsFrom(13, -L / 2, L / 2, (t) => {
    const bow = sm(0.62, 1, t);
    const w = (W / 2) * (1 - 0.92 * Math.pow(bow, 1.6)) * (t < 0.06 ? 0.85 + t * 2.5 : 1);
    const dk = deck + bow * 0.35;
    const keel = -depth * (1 - 0.35 * bow);
    return [[0, keel, 0], [w * 0.32, keel + depth * 0.25, 0], [w * 0.82, deck * 0.35 - 0.02, 0], [w, deck * 0.7, 0], [w * 0.97, dk, 0], [0, dk + 0.03, 0]];
  });
  return st;
}

function speedboat(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  const L = 7.2, W = 2.5;
  gridLoft(body, hullLoft(L, W, 0.55, 0.75, paint), paint, { colorFn: (p, r, j) => (p[1] < 0.15 ? [0.12, 0.2, 0.4] : paint) });
  body.box(0, 0.74, -0.8, 1.9, 0.08, 2.6, 0, 0.82, 0.68, 0.46); // Deck
  // Windschutz + Sitze
  glass.quadAuto([-0.9, 0.85, 0.7], [0.9, 0.85, 0.7], [0.8, 1.45, 0.4], [-0.8, 1.45, 0.4], 1, 1, 1);
  body.box(0, 0.8, -0.9, 0.9, 0.25, 0.5, 0, 0.9, 0.9, 0.92);
  body.box(0, 0.8, -1.7, 1.5, 0.3, 0.5, 0, 0.9, 0.9, 0.92);
  body.box(0, 0.3, -L / 2 - 0.1, 0.4, 1.0, 0.4, 0, 0.15, 0.15, 0.17); // Außenborder
  head.box(0, 0.95, 2.2, 0.3, 0.1, 0.05, 0, 1, 1, 0.9, { shade: false });
  return { parts: { body, glass, head, tail }, wheels: [], hw: 1.25, hl: 3.6, h: 1.5, seat: { x: 0.45, y: 1.0, z: -0.9 }, extras: { boat: true }, wheelR: 0.3 };
}

function yacht(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  const L = 22, W = 5.8;
  gridLoft(body, hullLoft(L, W, 0.9, 1.45, paint), [0.97, 0.97, 0.97], { colorFn: (p) => (p[1] < 0.2 ? [0.1, 0.17, 0.35] : [0.97, 0.97, 0.97]) });
  body.box(0, 1.45, -1.5, 4.6, 0.12, 12, 0, 0.8, 0.66, 0.46);
  body.box(0, 1.55, -2.0, 4.2, 1.6, 7.0, 0, 0.97, 0.97, 0.97);
  body.box(0, 3.1, -2.4, 3.6, 1.2, 5.0, 0, 0.97, 0.97, 0.97);
  body.box(0, 4.35, -2.8, 3.0, 0.1, 3.8, 0, 0.9, 0.9, 0.9);
  glass.quadAuto([-1.8, 3.4, 0.11], [1.8, 3.4, 0.11], [1.8, 4.1, 0.11], [-1.8, 4.1, 0.11], 1, 1, 1);
  glass.quadAuto([-2.1, 1.9, 1.51], [2.1, 1.9, 1.51], [2.1, 2.8, 1.51], [-2.1, 2.8, 1.51], 1, 1, 1);
  for (const sx of [-1, 1]) { glass.quadAuto([sx * 2.11, 1.9, 1.4], [sx * 2.11, 1.9, -5.4], [sx * 2.11, 2.8, -5.4], [sx * 2.11, 2.8, 1.4], 1, 1, 1); glass.quadAuto([sx * 1.81, 3.4, 0.1], [sx * 1.81, 3.4, -4.9], [sx * 1.81, 4.1, -4.9], [sx * 1.81, 4.1, 0.1], 1, 1, 1); }
  body.box(0, 4.45, -2.4, 0.1, 2.2, 0.1, 0, 0.8, 0.8, 0.82);
  head.box(0, 1.2, 10.6, 0.5, 0.12, 0.05, 0, 1, 1, 0.9, { shade: false });
  return { parts: { body, glass, head, tail }, wheels: [], hw: 2.9, hl: 11, h: 5, seat: { x: 0, y: 3.4, z: 0.4 }, extras: { boat: true }, wheelR: 0.3 };
}

function jetski(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  gridLoft(body, hullLoft(3.0, 1.1, 0.3, 0.4, paint), paint);
  body.box(0, 0.42, -0.5, 0.45, 0.15, 1.2, 0, 0.1, 0.1, 0.12);
  body.box(0, 0.5, 0.45, 0.5, 0.2, 0.5, 0, ...paint);
  body.box(0, 0.72, 0.5, 0.65, 0.05, 0.05, 0, 0.1, 0.1, 0.12);
  glass.quadAuto([-0.25, 0.65, 0.65], [0.25, 0.65, 0.65], [0.2, 0.95, 0.5], [-0.2, 0.95, 0.5], 1, 1, 1);
  return { parts: { body, glass, head, tail }, wheels: [], hw: 0.55, hl: 1.5, h: 1.1, seat: { x: 0, y: 0.6, z: -0.4 }, extras: { boat: true }, wheelR: 0.3 };
}

function sailboat(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  gridLoft(body, hullLoft(11, 3.3, 0.85, 0.9, paint), paint, { colorFn: (p) => (p[1] < 0.1 ? [0.1, 0.17, 0.35] : [0.97, 0.97, 0.96]) });
  body.box(0, 0.88, -0.6, 1.9, 0.14, 4.5, 0, 0.8, 0.66, 0.46);
  body.box(0, 1.0, -0.4, 1.7, 0.55, 2.6, 0, 0.95, 0.95, 0.93);
  glass.quadAuto([-0.86, 1.2, 0.9], [0.86, 1.2, 0.9], [0.86, 1.5, 0.9], [-0.86, 1.5, 0.9], 1, 1, 1);
  body.box(0, 0.9, 1.4, 0.14, 12.5, 0.14, 0, 0.82, 0.82, 0.85);   // Mast
  body.box(0, 1.55, -1.2, 0.08, 0.08, 3.4, 0, 0.7, 0.7, 0.72);    // Baum
  // Großsegel + Fock (doppelseitig)
  const sail = (pts) => { body.quadAuto(pts[0], pts[1], pts[2], pts[3], 0.97, 0.97, 0.95); body.quadAuto(pts[3], pts[2], pts[1], pts[0], 0.95, 0.95, 0.93); };
  sail([[0, 1.7, -2.7], [0, 1.7, 1.2], [0, 6.5, 1.1], [0, 6.5, 0.9]]);
  sail([[0, 6.5, 0.9], [0, 6.5, 1.1], [0, 12.2, 1.4], [0, 12.2, 1.35]]);
  sail([[0.01, 1.6, 1.5], [0.01, 1.6, 4.8], [0.01, 10.5, 1.55], [0.01, 10.5, 1.5]]);
  return { parts: { body, glass, head, tail }, wheels: [], hw: 1.65, hl: 5.5, h: 12, seat: { x: 0, y: 1, z: -2 }, extras: { boat: true }, wheelR: 0.3 };
}

// Statische Boote (Häfen): Karosserie + Glas
export function boatPropParts(kind) {
  const w = [0.97, 0.97, 0.97];
  const m = kind === 'yacht' ? yacht(w) : kind === 'sail' ? sailboat(w) : speedboat(w);
  return { body: toGeometry(m.parts.body), glass: toGeometry(m.parts.glass) };
}
export const BOAT_REF = { yacht: 22, sail: 11, boat: 7.2 };

// ---------- Luft ----------
function plane(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  const white = [0.96, 0.96, 0.97];
  // Rumpf
  gridLoft(body, stationsFrom(11, -4.2, 3.0, (t) => {
    const r = 0.62 * (t > 0.85 ? 1 - (t - 0.85) * 2.6 : t < 0.45 ? 0.55 + t * 1 : 1.0) * (t < 0.15 ? 0.55 + t * 3 : 1);
    return [[0, 1.0 - r, 0], [r * 0.6, 1.0 - r * 0.9, 0], [r * 0.97, 1.0, 0], [r * 0.75, 1.0 + r * 0.8, 0], [0, 1.0 + r * 0.95, 0]];
  }), white, { colorFn: (p) => (p[1] < 0.75 ? [0.35, 0.45, 0.6] : white) });
  body.box(0, 0.98, 0.1, 1.3, 0.04, 3.8, 0, 0.15, 0.3, 0.7, { noBottom: true, noTop: true });
  // Flügel (oben, Hochdecker)
  body.box(0, 1.62, 0.3, 10.6, 0.12, 1.55, 0, ...white);
  for (const sx of [-1, 1]) { body.box(sx * 1.3, 0.95, 0.3, 0.07, 0.7, 0.25, 0, 0.85, 0.85, 0.88); body.box(sx * 5.3, 1.6, 0.3, 0.2, 0.14, 1.4, 0, 0.8, 0.1, 0.1); }
  // Leitwerk
  body.box(0, 1.0, -3.9, 3.8, 0.08, 0.9, 0, ...white);
  body.box(0, 1.0, -3.95, 0.1, 1.5, 1.0, 0, ...white);
  body.box(0, 2.1, -4.05, 0.12, 0.45, 0.6, 0, 0.8, 0.1, 0.1);
  // Nase / Motor
  body.cylinder(0, 0.75, 3.2, 0.42, 0.34, 0.5, 10, 0.88, 0.88, 0.9);
  body.cylinder(0, 0.75, 3.7, 0.12, 0.02, 0.2, 8, 0.2, 0.2, 0.22);
  glass.quadAuto([-0.55, 1.35, 1.8], [0.55, 1.35, 1.8], [0.4, 1.0, 2.4], [-0.4, 1.0, 2.4], 1, 1, 1);
  for (const sx of [-1, 1]) glass.quadAuto([sx * 0.63, 1.0, 1.7], [sx * 0.63, 1.0, -0.4], [sx * 0.55, 1.45, -0.3], [sx * 0.55, 1.45, 1.6], 1, 1, 1);
  for (const sx of [-1, 1]) { head.box(sx * 4.4, 1.55, 0.2, 0.1, 0.1, 0.1, 0, 1, 1, 0.9, { shade: false }); tail.box(sx * 5.25, 1.6, 0.25, 0.08, 0.08, 0.08, 0, sx > 0 ? 0.1 : 1, sx > 0 ? 1 : 0.1, 0.1, { shade: false }); }
  const wheels = [{ x: -0.9, y: 0.32, z: 1.2, r: 0.32, w: 0.16, steer: true, left: true }, { x: 0.9, y: 0.32, z: 1.2, r: 0.32, w: 0.16, steer: true }, { x: 0, y: 0.25, z: -3.5, r: 0.2, w: 0.1, steer: false }];
  for (const sx of [-1, 1]) body.box(sx * 0.9, 0.35, 1.2, 0.05, 0.7, 0.05, 0, 0.5, 0.5, 0.52);
  return { parts: { body, glass, head, tail }, wheels, hw: 5.4, hl: 4.5, h: 2.3, seat: { x: -0.3, y: 1.0, z: 0.9 }, extras: { prop: { z: 3.75, y: 0.75 } }, wheelR: 0.32 };
}

function helicopter(paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder();
  gridLoft(body, stationsFrom(9, -1.7, 2.0, (t) => { const r = 0.95 * (1 - Math.pow(Math.abs(t - 0.45) * 1.6, 2.2)) + 0.2; return [[0, 0.5, 0], [r * 0.7, 0.55, 0], [r, 1.2, 0], [r * 0.7, 1.9, 0], [0, 2.0, 0]]; }), paint);
  glass.quadAuto([-0.8, 1.2, 1.9], [0.8, 1.2, 1.9], [0.6, 1.9, 1.1], [-0.6, 1.9, 1.1], 1, 1, 1);
  body.box(0, 1.35, -4.5, 0.28, 0.35, 5.2, 0, ...paint);
  body.box(0, 1.35, -7.0, 0.05, 1.1, 0.7, 0, ...paint);
  body.box(0, 2.1, 0.0, 0.3, 0.4, 0.3, 0, 0.1, 0.1, 0.12);
  for (const sx of [-1, 1]) { body.box(sx * 0.7, 0.18, 0, 0.07, 0.07, 2.6, 0, 0.1, 0.1, 0.1); body.box(sx * 0.7, 0.2, 0.8, 0.05, 0.4, 0.05, 0, 0.1, 0.1, 0.1); body.box(sx * 0.7, 0.2, -0.7, 0.05, 0.4, 0.05, 0, 0.1, 0.1, 0.1); }
  head.box(0, 0.8, 2.0, 0.4, 0.2, 0.05, 0, 1, 1, 0.95, { shade: false });
  return { parts: { body, glass, head, tail }, wheels: [], hw: 1.1, hl: 3.2, h: 2.6, seat: { x: -0.4, y: 1.0, z: 0.9 }, extras: { rotor: { y: 2.4, r: 5.5 }, tailRotor: { z: -7.0, y: 1.7 } }, wheelR: 0.3 };
}

// ---------- Katalog ----------
export const VEHICLE_TYPES = {
  sports: { name: 'Veloce GT', cls: 'car', build: (c) => buildCar('sports', c), maxSpeed: 64, accel: 24, brake: 36, steer: 0.62, grip: 9.5, mass: 1350, hp: 1000, price: 185000, paint: [0, 1, 5, 6, 2, 3, 8] },
  coupe: { name: 'Fuego Coupé', cls: 'car', build: (c) => buildCar('coupe', c), maxSpeed: 56, accel: 21, brake: 32, steer: 0.58, grip: 8.5, mass: 1500, hp: 1000, price: 95000, paint: [0, 1, 3, 9, 6, 7, 5] },
  luxury: { name: 'Estrella L', cls: 'car', build: (c) => buildCar('luxury', c), maxSpeed: 52, accel: 17, brake: 30, steer: 0.52, grip: 8, mass: 1900, hp: 1100, price: 140000, paint: [3, 4, 2, 1, 9, 0] },
  limo: { name: 'Gran Limusina', cls: 'car', build: (c) => buildCar('limo', c), maxSpeed: 44, accel: 12, brake: 24, steer: 0.4, grip: 7, mass: 2600, hp: 1200, price: 210000, paint: [3, 2] },
  suv: { name: 'Sierra 4x4', cls: 'car', build: (c) => buildCar('suv', c), maxSpeed: 46, accel: 16, brake: 28, steer: 0.5, grip: 8.5, mass: 2200, hp: 1300, price: 70000, offroad: true, paint: [3, 9, 2, 7, 10, 4, 1] },
  compact: { name: 'Mini Ciudad', cls: 'car', build: (c) => buildCar('compact', c), maxSpeed: 38, accel: 12, brake: 24, steer: 0.62, grip: 8, mass: 1000, hp: 800, price: 18000, paint: [0, 1, 2, 5, 7, 11, 6, 4] },
  taxi: { name: 'Taxi', cls: 'car', build: () => buildCar('taxi', [0.98, 0.78, 0.05]), maxSpeed: 40, accel: 13, brake: 26, steer: 0.55, grip: 8, mass: 1600, hp: 1000, price: 0, fixedPaint: true },
  police: { name: 'Policía', cls: 'car', build: () => buildCar('police', [0.1, 0.18, 0.42]), maxSpeed: 56, accel: 20, brake: 32, steer: 0.58, grip: 9, mass: 1900, hp: 1300, price: 0, fixedPaint: true },
  van: { name: 'Furgón', cls: 'car', build: (c) => buildCar('van', c), maxSpeed: 36, accel: 10, brake: 22, steer: 0.5, grip: 7.5, mass: 2800, hp: 1100, price: 30000, paint: [2, 4, 1, 5, 0] },
  pickup: { name: 'Camioneta', cls: 'car', build: (c) => pickup(c), maxSpeed: 42, accel: 14, brake: 26, steer: 0.5, grip: 8, mass: 2300, hp: 1300, price: 45000, offroad: true, paint: [0, 2, 3, 10, 7, 11] },
  truck: { name: 'Camión', cls: 'car', build: (c) => boxTruck(c), maxSpeed: 30, accel: 7, brake: 18, steer: 0.36, grip: 6.5, mass: 9000, hp: 1800, price: 0, paint: [0, 1, 2, 5, 7] },
  bus: { name: 'Autobús EMT', cls: 'car', build: () => bus([0.08, 0.35, 0.7]), maxSpeed: 28, accel: 5.5, brake: 16, steer: 0.34, grip: 6, mass: 12000, hp: 2200, price: 0, fixedPaint: true },
  moto: { name: 'Corsa 600', cls: 'bike', build: (c) => motorbike(c), maxSpeed: 58, accel: 26, brake: 32, steer: 0.7, grip: 9, mass: 220, hp: 400, price: 22000, paint: [0, 1, 5, 6, 3, 2] },
  tractor: { name: 'Tractor Agrícola', cls: 'car', build: (c) => tractor(c), maxSpeed: 12, accel: 4, brake: 12, steer: 0.6, grip: 9, mass: 5000, hp: 1500, price: 0, offroad: true, paint: [7, 0, 1] },
  forklift: { name: 'Carretilla', cls: 'car', build: (c) => forklift(c), maxSpeed: 8, accel: 4, brake: 14, steer: 0.9, grip: 10, mass: 3000, hp: 800, price: 0, rearSteer: true, paint: [5, 6, 0] },
  excavator: { name: 'Excavadora', cls: 'tank', build: (c) => excavator(c), maxSpeed: 6, accel: 2.5, brake: 8, steer: 0.9, grip: 12, mass: 20000, hp: 3000, price: 0, paint: [5, 6] },
  speedboat: { name: 'Lancha Rápida', cls: 'boat', build: (c) => speedboat(c), maxSpeed: 32, accel: 10, brake: 8, steer: 0.5, grip: 2.5, mass: 1500, hp: 900, price: 120000, paint: [2, 0, 1, 5] },
  yacht: { name: 'Yate Lujo', cls: 'boat', build: (c) => yacht(c), maxSpeed: 17, accel: 3, brake: 4, steer: 0.28, grip: 1.8, mass: 60000, hp: 2500, price: 2400000, paint: [2] },
  jetski: { name: 'Jet-Ski', cls: 'boat', build: (c) => jetski(c), maxSpeed: 28, accel: 12, brake: 8, steer: 0.75, grip: 3, mass: 400, hp: 300, price: 15000, paint: [0, 5, 11, 6] },
  plane: { name: 'Avioneta Cessna', cls: 'plane', build: (c) => plane(c), maxSpeed: 70, accel: 8, brake: 6, steer: 0.4, grip: 8, mass: 1100, hp: 800, price: 340000, paint: [2, 0, 1] },
  heli: { name: 'Helicóptero', cls: 'heli', build: (c) => helicopter(c), maxSpeed: 50, accel: 10, brake: 8, steer: 0.5, grip: 3, mass: 1800, hp: 1100, price: 0, paint: [3, 2, 1] },
};

// ---------- Instanziierung ----------
const bodyGeoCache = new Map();

// Erzeugt ein Fahrzeug-Objekt (THREE.Group) + Referenzen auf bewegliche Teile
export function createVehicleObject(typeKey, paintIdx = 0, rng = Math.random) {
  const T = VEHICLE_TYPES[typeKey];
  const palette = T.paint || [0];
  const pi = palette[paintIdx % palette.length] ?? 0;
  const paint = T.fixedPaint ? null : PAINTS[pi];
  const ck = `${typeKey}|${T.fixedPaint ? 'f' : pi}`;
  let entry = bodyGeoCache.get(ck);
  if (!entry) {
    const m = T.build(paint || [0.5, 0.5, 0.5]);
    entry = {
      def: m,
      body: toGeometry(m.parts.body), glass: toGeometry(m.parts.glass), head: toGeometry(m.parts.head), tail: toGeometry(m.parts.tail),
    };
    bodyGeoCache.set(ck, entry);
  }
  const m = entry.def;
  const group = new THREE.Group();
  const mk = (geo, mat, cast = true) => { const o = new THREE.Mesh(geo, mat); o.castShadow = cast; o.receiveShadow = true; return o; };
  const bodyMesh = mk(entry.body, VMAT.body);
  const glassMesh = mk(entry.glass, VMAT.glass, false);
  const headMat = VMAT.head.clone();
  const headMesh = mk(entry.head, headMat, false);
  const tailMat = VMAT.tail.clone();
  const tailMesh = mk(entry.tail, tailMat, false);
  group.add(bodyMesh, glassMesh, headMesh, tailMesh);
  const wheels = [];
  const rimCol = m.extras.rim || [0.78, 0.8, 0.84];
  for (const w of m.wheels) {
    const geo = wheelGeometry(w.r, w.w, rimCol);
    const pivot = new THREE.Group();
    pivot.position.set(w.x, w.y, w.z);
    const mesh = mk(geo, VMAT.wheel);
    if (w.left) mesh.rotation.y = Math.PI; // Felgenseite nach außen
    pivot.add(mesh);
    group.add(pivot);
    wheels.push({ pivot, mesh, steer: w.steer, r: w.r, spin: 0 });
  }
  const refs = { group, bodyMesh, glassMesh, headMesh, headMat, tailMesh, tailMat, wheels, def: m, paint: pi };
  // Extras
  if (m.extras.lightbar) {
    const lb = m.extras.lightbar;
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0, 0) }), blue = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0.2) });
    const a = new THREE.Mesh(new THREE.BoxGeometry(lb.w * 0.46, 0.09, 0.26), red); a.position.set(-lb.w * 0.25, lb.y, lb.z);
    const b = new THREE.Mesh(new THREE.BoxGeometry(lb.w * 0.46, 0.09, 0.26), blue); b.position.set(lb.w * 0.25, lb.y, lb.z);
    group.add(a, b);
    refs.siren = { red, blue };
  }
  if (m.extras.rotor) {
    const r = m.extras.rotor;
    const rotor = new THREE.Group();
    rotor.position.set(0, r.y, 0);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(r.r * 2, 0.04, 0.22), new THREE.MeshStandardMaterial({ color: 0x111214 }));
    const blade2 = blade.clone(); blade2.rotation.y = Math.PI / 2;
    rotor.add(blade, blade2);
    group.add(rotor);
    refs.rotor = rotor;
    const tr = m.extras.tailRotor;
    const trot = new THREE.Group(); trot.position.set(0.12, tr.y, tr.z);
    const tb = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.4, 0.12), new THREE.MeshStandardMaterial({ color: 0x111214 })); trot.add(tb);
    group.add(trot); refs.tailRotor = trot;
  }
  if (m.extras.prop) {
    const pr = m.extras.prop;
    const prop = new THREE.Group(); prop.position.set(0, pr.y, pr.z);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.0, 0.04), new THREE.MeshStandardMaterial({ color: 0x1a1a1c }));
    prop.add(blade);
    group.add(prop);
    refs.prop = prop;
  }
  return refs;
}

export const vehicleDims = (typeKey) => {
  const ck = `${typeKey}|dims`;
  if (!bodyGeoCache.has(ck)) {
    const T = VEHICLE_TYPES[typeKey];
    const palette = T.paint || [0];
    const m = T.build(T.fixedPaint ? [0.5, 0.5, 0.5] : PAINTS[palette[0]]);
    bodyGeoCache.set(ck, m);
  }
  const m = bodyGeoCache.get(ck);
  return { hw: m.hw, hl: m.hl, h: m.h, seat: m.seat, wheelR: m.wheelR, wheels: m.wheels };
};
