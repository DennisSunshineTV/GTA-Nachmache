// Prop-Modelle (Bäume, Straßenmöbel, Boote ...) und Instancing mit Aufteilung nahe/fern (Schatten).
import * as THREE from 'three';
import { MeshBuilder } from '../world/meshbuilder.js';
import { toGeometry } from './geom.js';
import { mulberry32 } from '../util.js';
import { boatPropParts } from '../entities/vehicle_models.js';
import { cardCrown, LEAF } from './foliage.js';

// ---------- Geometrie-Helfer ----------

function icoBase() {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((p) => { const l = Math.hypot(...p); return p.map((q) => q / l); });
  const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  return { v, f };
}
const ICO = icoBase();
function icoSub(level) {
  let v = ICO.v.map((p) => p.slice()), f = ICO.f.map((q) => q.slice());
  for (let l = 0; l < level; l++) {
    const cache = new Map(); const nf = [];
    const mid = (a, b) => {
      const k = a < b ? a * 1000 + b : b * 1000 + a;
      if (cache.has(k)) return cache.get(k);
      const m = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2]; const len = Math.hypot(...m);
      v.push(m.map((q) => q / len)); cache.set(k, v.length - 1); return v.length - 1;
    };
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { v, f };
}
const ICO1 = icoSub(1);

// Facettierter "Blob" (Baumkrone, Busch, Fels)
function blob(mb, cx, cy, cz, rx, ry, rz, col, seed = 1, jit = 0.14, level = 1, var_ = 0.12) {
  const rnd = mulberry32(seed);
  const base = level === 1 ? ICO1 : ICO;
  const vv = base.v.map((p) => { const k = 1 + (rnd() - 0.5) * jit * 2; return [cx + p[0] * rx * k, cy + p[1] * ry * k, cz + p[2] * rz * k]; });
  for (const [a, b, c] of base.f) {
    const k = 1 + (rnd() - 0.5) * var_ * 2;
    mb.triFace(vv[a], vv[b], vv[c], vv[a][0] - cx + vv[b][0] - cx + vv[c][0] - cx, (vv[a][1] + vv[b][1] + vv[c][1]) / 3 - cy, vv[a][2] - cz + vv[b][2] - cz + vv[c][2] - cz, col[0] * k, col[1] * k, col[2] * k);
  }
}

// Röhre entlang eines Pfades (horizontale Ringe)
function tube(mb, pts, radii, segs, colA, colB = colA) {
  const rings = [];
  for (let i = 0; i < pts.length; i++) {
    const ring = [];
    for (let j = 0; j < segs; j++) { const a = (j / segs) * Math.PI * 2; ring.push([pts[i][0] + Math.cos(a) * radii[i], pts[i][1], pts[i][2] + Math.sin(a) * radii[i], Math.cos(a), Math.sin(a)]); }
    rings.push(ring);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const c = i % 2 ? colB : colA;
    for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % segs;
      const a = rings[i][j], b = rings[i][j2], cc = rings[i + 1][j2], d = rings[i + 1][j];
      mb.quad([a[0], a[1], a[2]], [d[0], d[1], d[2]], [cc[0], cc[1], cc[2]], [b[0], b[1], b[2]], 0, 0, 0, 0, 0, 1, 1, c[0], c[1], c[2]);
      // Normale nachträglich setzen (radial)
      const n = mb.n;
      const set = (vi, nx, nz) => { mb.nor[vi * 3] = nx; mb.nor[vi * 3 + 1] = 0.15; mb.nor[vi * 3 + 2] = nz; };
      set(n - 4, a[3], a[4]); set(n - 3, d[3], d[4]); set(n - 2, cc[3], cc[4]); set(n - 1, b[3], b[4]);
    }
  }
}

// ---------- Modelle ----------

function palmModel(variant) {
  const trunk = new MeshBuilder(), fronds = new MeshBuilder();
  const rnd = mulberry32(100 + variant);
  const H = 6.6 + variant * 1.6 + rnd() * 0.8;
  const bend = (rnd() - 0.5) * 1.6;
  const n = 9;
  const pts = [], rad = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([bend * t * t, H * t, bend * 0.4 * t * t]);
    rad.push(0.3 - 0.1 * t + (i === 0 ? 0.08 : 0));
  }
  tube(trunk, pts, rad, 7, [0.46, 0.39, 0.31], [0.38, 0.32, 0.26]);
  const top = pts[n];
  blob(trunk, top[0], top[1], top[2], 0.38, 0.42, 0.38, [0.42, 0.36, 0.22], 7 + variant, 0.1, 0);
  // Datteln
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rnd();
    blob(trunk, top[0] + Math.cos(a) * 0.5, top[1] - 0.45, top[2] + Math.sin(a) * 0.5, 0.2, 0.34, 0.2, [0.86, 0.5, 0.14], 30 + k, 0.2, 0, 0.15);
  }
  // Wedel
  const NF = 15;
  for (let f = 0; f < NF; f++) {
    const yaw = (f / NF) * Math.PI * 2 + rnd() * 0.4;
    const up = f < 5 ? 1 : f < 10 ? 0.45 : 0.0; // obere, mittlere, untere Kranzreihe
    const pitch = 0.95 - up * 0.65 + rnd() * 0.25;  // Winkel über der Waagerechten
    const len = 3.1 + rnd() * 0.9 - (f < 5 ? 0.5 : 0);
    const dx = Math.cos(yaw), dz = Math.sin(yaw);
    const segs = 6;
    const pxz = [-dz, dx];
    const strip = [];
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const out = t * len * Math.cos(pitch * (1 - t * 0.7));
      const hgt = t * len * Math.sin(pitch) - 1.6 * t * t * len * 0.28 * (1.1 - up * 0.5);
      const wd = 0.95 * Math.pow(1 - t, 0.45) * (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.25 + 0.15)));
      const cx = top[0] + dx * out, cy = top[1] + 0.1 + hgt, cz = top[2] + dz * out;
      strip.push([[cx - pxz[0] * wd, cy, cz - pxz[1] * wd], [cx + pxz[0] * wd, cy, cz + pxz[1] * wd]]);
    }
    const tone = 0.82 + rnd() * 0.2;
    for (let s = 0; s < segs; s++) {
      const a = strip[s][0], b = strip[s][1], c = strip[s + 1][1], d = strip[s + 1][0];
      // Blattoberseite (Normale ungefähr nach oben)
      fronds.quadUp(a, b, c, d, tone * 0.85, tone, tone * 0.78, 0, s / segs, 1, (s + 1) / segs);
    }
  }
  return { parts: [{ geo: toGeometry(trunk), mat: 'prop' }, { geo: toGeometry(fronds), mat: 'frond' }], collider: { r: 0.42, h: H } };
}

// Krone für nah (alle Karten) und fern (weniger, größere Karten): gleiche Form, gleiche Farben
function crownPair(near, far, c, o, seed) {
  cardCrown(near, c[0], c[1], c[2], c[3], c[4], c[5], o, mulberry32(seed));
  cardCrown(far, c[0], c[1], c[2], c[3], c[4], c[5], { ...o, n: Math.max(4, Math.round(o.n * 0.38)), size: [o.size[0] * 1.35, o.size[1] * 1.35] }, mulberry32(seed + 1));
}
const treeParts = (wood, near, far, collider) => ({ parts: [{ geo: toGeometry(wood), mat: 'prop' }, { geo: toGeometry(near), mat: 'leafCard' }], far: [{ geo: null, mat: 'prop' }, { geo: toGeometry(far), mat: 'leafCard' }], collider });

// Pinien: Schirmpinie (Pinus pinea, flache Schirmkrone auf hohem Stamm) und Aleppo-Kiefer (locker, mehrere Büschel)
function pineModel(kind) {
  const wood = new MeshBuilder(), near = new MeshBuilder(), far = new MeshBuilder();
  const rnd = mulberry32(300 + kind);
  const bark = [0.42, 0.31, 0.22], bark2 = [0.36, 0.26, 0.19];
  if (kind === 0) {
    const H = 6.6;
    tube(wood, [[0, 0, 0], [0.25, 2.4, 0.08], [0.45, 4.6, 0.18], [0.5, H, 0.2]], [0.34, 0.27, 0.22, 0.17], 8, bark, bark2);
    // Äste fächern sich unter der Schirmkrone auf
    for (let b = 0; b < 6; b++) {
      const a = (b / 6) * Math.PI * 2 + rnd() * 0.5, r = 2.0 + rnd() * 1.2;
      tube(wood, [[0.45, H - 0.6, 0.18], [0.45 + Math.cos(a) * r * 0.5, H + 0.35, 0.18 + Math.sin(a) * r * 0.5], [0.45 + Math.cos(a) * r, H + 0.75, 0.18 + Math.sin(a) * r]], [0.15, 0.09, 0.05], 5, bark2);
    }
    const o = { n: 64, size: [1.7, 2.6], tile: LEAF.pine, tone: [0.74, 1.02], flat: 0.6, shell: 0.35, bottomCut: -0.25, up: 0.6 };
    crownPair(near, far, [0.45, H + 1.0, 0.2, 3.9, 1.05, 3.7], o, 311);
    crownPair(near, far, [-1.2, H + 0.55, 1.1, 2.3, 0.8, 2.2], { ...o, n: 22 }, 313);
    crownPair(near, far, [2.1, H + 0.5, -0.9, 2.2, 0.75, 2.1], { ...o, n: 22 }, 315);
  } else {
    const H = 5.6, lean = 0.45;
    tube(wood, [[0, 0, 0], [0.2, 2.2, 0.1], [lean, H * 0.8, 0.15], [lean * 1.1, H + 1.6, 0.18]], [0.3, 0.22, 0.15, 0.08], 7, bark, bark2);
    const clumps = [[lean, H + 0.4, 0.15, 2.0, 1.3, 1.9, 24], [lean * 1.1, H + 2.1, 0.18, 1.45, 1.1, 1.4, 16], [-0.9, H - 0.4, 0.8, 1.5, 0.95, 1.4, 14], [1.6, H - 0.1, -0.6, 1.3, 0.9, 1.3, 12], [lean, H + 3.1, 0.2, 0.85, 0.85, 0.85, 8]];
    clumps.forEach(([x, y, z, rx, ry, rz, n], i) => {
      tube(wood, [[lean * 0.7, y - 1.2, 0.12], [x, y - 0.2, z]], [0.09, 0.05], 5, bark2);
      crownPair(near, far, [x, y, z, rx, ry, rz], { n, size: [1.3, 2.0], tile: LEAF.pine, tone: [0.76, 1.04], tilt: 1.4, shell: 0.4 }, 330 + i * 3);
    });
  }
  return treeParts(wood, near, far, { r: 0.4, h: 9 });
}

// Olivenbaum: knorriger, geteilter Stamm, silbrig-grüne, lockere Krone aus mehreren Büscheln
function oliveModel() {
  const wood = new MeshBuilder(), near = new MeshBuilder(), far = new MeshBuilder();
  const rnd = mulberry32(400);
  const bark = [0.47, 0.43, 0.38], bark2 = [0.38, 0.35, 0.31];
  tube(wood, [[0, 0, 0], [0.15, 0.5, 0.05], [0.05, 0.95, 0.1]], [0.42, 0.34, 0.3], 8, bark, bark2);
  const tops = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4, r = 0.9 + rnd() * 0.4;
    const top = [Math.cos(a) * r, 2.0 + rnd() * 0.4, Math.sin(a) * r];
    tube(wood, [[0.05, 0.9, 0.1], [top[0] * 0.45 + (rnd() - 0.5) * 0.3, 1.45, top[2] * 0.45], top], [0.2, 0.14, 0.08], 6, bark, bark2);
    tops.push(top);
  }
  tops.forEach((t, i) => crownPair(near, far, [t[0] * 1.15, t[1] + 0.55, t[2] * 1.15, 1.25, 0.95, 1.25], { n: 17, size: [1.1, 1.7], tile: LEAF.olive, tone: [0.82, 1.08], shell: 0.45 }, 410 + i * 3));
  crownPair(near, far, [0, 2.95, 0, 1.4, 0.9, 1.4], { n: 16, size: [1.1, 1.7], tile: LEAF.olive, tone: [0.85, 1.1], shell: 0.45 }, 420);
  return treeParts(wood, near, far, { r: 0.45, h: 3.8 });
}

// Zypresse: schlanke Säule aus dichten, fast senkrechten Schuppenzweig-Karten
function cypressModel() {
  const wood = new MeshBuilder(), near = new MeshBuilder(), far = new MeshBuilder();
  tube(wood, [[0, 0, 0], [0, 0.7, 0], [0, 6.5, 0]], [0.2, 0.18, 0.06], 6, [0.35, 0.28, 0.2]);
  const o = { size: [0.9, 1.5], tile: LEAF.cypress, tone: [0.72, 1.0], tilt: 0.35, shell: 0.3, up: 0.15 };
  crownPair(near, far, [0, 2.9, 0, 0.88, 2.7, 0.88], { ...o, n: 40 }, 501);
  crownPair(near, far, [0, 5.4, 0, 0.66, 1.5, 0.66], { ...o, n: 18 }, 503);
  crownPair(near, far, [0, 6.9, 0, 0.36, 0.7, 0.36], { ...o, n: 6, size: [0.7, 1.0] }, 505);
  return treeParts(wood, near, far, { r: 0.4, h: 7.5 });
}

// Busch (Strauch/Oleander) bzw. Bougainvillea (magenta Hochblätter): Halbkugel aus Blattkarten
function bushModel(flower) {
  const wood = new MeshBuilder(), near = new MeshBuilder(), far = new MeshBuilder();
  for (let k = 0; k < 4; k++) { const a = k * 1.6; tube(wood, [[0, 0, 0], [Math.cos(a) * 0.35, 0.55, Math.sin(a) * 0.35]], [0.05, 0.03], 4, [0.33, 0.27, 0.2]); }
  const o = { n: 18, size: [0.8, 1.25], tiles: flower ? [LEAF.bougain, LEAF.bougain, LEAF.shrub] : [LEAF.shrub, LEAF.shrub, LEAF.oleander], tone: [0.8, 1.06], shell: 0.5, bottomCut: -0.35, up: 0.5 };
  crownPair(near, far, [0, 0.68, 0, 0.98, 0.66, 0.98], o, flower ? 611 : 601);
  crownPair(near, far, [0.35, 1.0, -0.2, 0.55, 0.45, 0.55], { ...o, n: 6 }, flower ? 613 : 603);
  return treeParts(wood, near, far, null);
}

function agaveModel() {
  const mb = new MeshBuilder();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2, r = 0.9 + (i % 3) * 0.2, up = 0.7 + (i % 2) * 0.4;
    const tip = [Math.cos(a) * r, up, Math.sin(a) * r], px = -Math.sin(a) * 0.2, pz = Math.cos(a) * 0.2;
    mb.triUp([px, 0.15, pz], [-px, 0.15, -pz], tip, 0.38, 0.55, 0.45);
    mb.triUp([-px, 0.12, -pz], [px, 0.12, pz], [tip[0], tip[1] - 0.05, tip[2]], 0.3, 0.46, 0.38);
  }
  return { parts: [{ geo: toGeometry(mb), mat: 'prop' }] };
}

function reedModel() {
  const mb = new MeshBuilder();
  const rnd = mulberry32(5);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * 6.283, r = rnd() * 0.9, h = 1.6 + rnd() * 1.4;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, lean = (rnd() - 0.5) * 0.7;
    const c = 0.82 + rnd() * 0.3;
    mb.triUp([x - 0.06, 0, z], [x + 0.06, 0, z], [x + lean, h, z + lean * 0.5], 0.5 * c, 0.58 * c, 0.28 * c);
    mb.triUp([x, 0, z - 0.06], [x, 0, z + 0.06], [x + lean, h, z + lean * 0.5], 0.46 * c, 0.54 * c, 0.26 * c);
  }
  return { parts: [{ geo: toGeometry(mb), mat: 'prop' }] };
}

function rockModel(v) {
  const mb = new MeshBuilder();
  blob(mb, 0, 0.35, 0, 1.0 + v * 0.2, 0.7, 0.85, [0.55, 0.51, 0.45], 90 + v, 0.28, 1, 0.12);
  return { parts: [{ geo: toGeometry(mb), mat: 'prop' }], collider: { r: 0.9, h: 1.2 } };
}

function lampModel() {
  const pole = new MeshBuilder(), head = new MeshBuilder();
  pole.cylinder(0, 0, 0, 0.14, 0.09, 7.2, 8, 0.22, 0.24, 0.26);
  pole.cylinder(0, 0, 0, 0.26, 0.2, 0.45, 8, 0.2, 0.22, 0.24);
  pole.box(0.65, 7.1, 0, 1.4, 0.1, 0.14, 0, 0.22, 0.24, 0.26);
  head.box(1.2, 6.95, 0, 0.7, 0.14, 0.34, 0, 1, 1, 1, { shade: false });
  return { parts: [{ geo: toGeometry(pole), mat: 'propMetal' }, { geo: toGeometry(head), mat: 'lampHead' }], collider: { r: 0.18, h: 7 } };
}

function parasolModel() {
  const mb = new MeshBuilder();
  mb.cylinder(0, 0, 0, 0.04, 0.04, 2.5, 5, 0.75, 0.72, 0.68);
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const c = i % 2 ? [0.97, 0.96, 0.93] : [0.93, 0.92, 0.88];
    mb.triUp([0, 2.95, 0], [Math.cos(a0) * 1.65, 2.35, Math.sin(a0) * 1.65], [Math.cos(a1) * 1.65, 2.35, Math.sin(a1) * 1.65], c[0], c[1], c[2]);
  }
  return { parts: [{ geo: toGeometry(mb), mat: 'prop' }], collider: null };
}

function loungerModel() {
  const frame = new MeshBuilder(), towel = new MeshBuilder();
  frame.box(0, 0.22, 0, 0.7, 0.07, 1.25, 0, 0.94, 0.94, 0.92);
  frame.box(0, 0.3, -0.85, 0.7, 0.07, 0.62, 0, 0.94, 0.94, 0.92);
  // Rückenlehne geneigt
  frame.quadAuto([-0.35, 0.28, -0.62], [0.35, 0.28, -0.62], [0.33, 0.7, -1.15], [-0.33, 0.7, -1.15], 0.94, 0.94, 0.92);
  frame.box(-0.33, 0, 0.55, 0.05, 0.22, 0.05, 0, 0.7, 0.7, 0.7); frame.box(0.33, 0, 0.55, 0.05, 0.22, 0.05, 0, 0.7, 0.7, 0.7);
  frame.box(-0.33, 0, -0.55, 0.05, 0.22, 0.05, 0, 0.7, 0.7, 0.7); frame.box(0.33, 0, -0.55, 0.05, 0.22, 0.05, 0, 0.7, 0.7, 0.7);
  towel.box(0, 0.295, 0.05, 0.56, 0.02, 1.0, 0, 1, 1, 1);
  return { parts: [{ geo: toGeometry(frame), mat: 'prop' }, { geo: toGeometry(towel), mat: 'prop', color: true }], collider: null };
}

function wallModel() {
  const mb = new MeshBuilder();
  mb.box(0, 0, 0, 4.1, 0.95, 0.55, 0, 0.8, 0.72, 0.58);
  mb.box(0, 0.95, 0, 4.15, 0.12, 0.65, 0, 0.88, 0.8, 0.66);
  const rnd = mulberry32(8);
  for (let i = 0; i < 12; i++) mb.box(-1.9 + i * 0.35 + rnd() * 0.1, 0.1 + rnd() * 0.7, 0.28, 0.3, 0.2, 0.05, 0, 0.7 + rnd() * 0.15, 0.62 + rnd() * 0.12, 0.5);
  return { parts: [{ geo: toGeometry(mb), mat: 'prop' }], collider: { box: [2.05, 0.28], h: 1.1 } };
}

function containerModel() {
  const mb = new MeshBuilder();
  mb.box(0, 0, 0, 12.2, 2.6, 2.44, 0, 1, 1, 1);
  for (let i = 0; i < 18; i++) mb.box(-5.7 + i * 0.67, 0.1, 1.23, 0.14, 2.4, 0.05, 0, 0.82, 0.82, 0.82);
  return { parts: [{ geo: toGeometry(mb), mat: 'prop', color: true }], collider: { box: [6.1, 1.22], h: 2.6 } };
}

function windmillModel() {
  const mb = new MeshBuilder();
  mb.cylinder(0, 0, 0, 3.6, 2.4, 8.5, 12, 0.93, 0.9, 0.82);
  mb.cylinder(0, 8.5, 0, 3.0, 0.2, 3.2, 12, 0.5, 0.3, 0.2, false);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.3;
    const dx = Math.cos(a), dy = Math.sin(a);
    // Flügel (Rahmen + Segel) vor dem Turm (+z)
    mb.box(0, 7.4, 3.0, 0.2, 0.2, 0.2, 0, 0.3, 0.2, 0.15);
    const L = 8.8;
    mb.quadAuto([dx * 0.4 - dy * 0.0, 7.4 + dy * 0.4, 3.2], [dx * L, 7.4 + dy * L, 3.2], [dx * L - dy * 1.1, 7.4 + dy * L + dx * 1.1, 3.2], [dx * 0.4 - dy * 1.1, 7.4 + dy * 0.4 + dx * 1.1, 3.2], 0.9, 0.88, 0.8);
    mb.quadAuto([dx * 0.4 - dy * 1.1, 7.4 + dy * 0.4 + dx * 1.1, 3.2], [dx * L - dy * 1.1, 7.4 + dy * L + dx * 1.1, 3.2], [dx * L, 7.4 + dy * L, 3.2], [dx * 0.4, 7.4 + dy * 0.4, 3.2], 0.9, 0.88, 0.8);
    mb.box(dx * L * 0.5, 7.4 + dy * L * 0.5 - 0.1, 3.18, Math.abs(dx) > Math.abs(dy) ? L : 0.18, 0.18, 0.12, 0, 0.35, 0.25, 0.18, { noTop: false });
  }
  return { parts: [{ geo: toGeometry(mb), mat: 'prop' }], collider: { r: 3.6, h: 9 } };
}

function lighthouseModel() {
  const mb = new MeshBuilder(), glow = new MeshBuilder();
  for (let k = 0; k < 6; k++) mb.cylinder(0, k * 4.2, 0, 3.4 - k * 0.22, 3.4 - (k + 1) * 0.22, 4.2, 14, k % 2 ? 0.8 : 0.95, k % 2 ? 0.18 : 0.95, k % 2 ? 0.16 : 0.93);
  mb.cylinder(0, 25.2, 0, 3.4, 3.4, 0.5, 14, 0.2, 0.2, 0.22);
  glow.cylinder(0, 25.7, 0, 1.5, 1.5, 2.4, 12, 1, 0.9, 0.5);
  mb.cylinder(0, 28.1, 0, 2.0, 0.3, 1.5, 12, 0.7, 0.2, 0.18);
  return { parts: [{ geo: toGeometry(mb), mat: 'prop' }, { geo: toGeometry(glow), mat: 'lampHead' }], collider: { r: 3.4, h: 29 } };
}

function beachbarModel() {
  const mb = new MeshBuilder();
  mb.box(0, 0, 0, 9, 0.4, 6, 0, 0.62, 0.48, 0.32);
  mb.box(0, 0.4, -2.2, 8, 1.2, 1.2, 0, 0.8, 0.6, 0.4);       // Theke
  mb.box(0, 1.6, -2.2, 8.3, 0.12, 1.5, 0, 0.5, 0.36, 0.22);
  for (const [x, z] of [[-4.2, -2.8], [4.2, -2.8], [-4.2, 2.8], [4.2, 2.8]]) mb.box(x, 0.4, z, 0.2, 2.6, 0.2, 0, 0.5, 0.36, 0.22);
  mb.cylinder(0, 3.0, 0, 5.8, 0.4, 1.7, 10, 0.82, 0.7, 0.38, false); // Strohdach
  for (let i = 0; i < 3; i++) mb.cylinder(-2.6 + i * 2.6, 0.4, 2.2, 0.35, 0.35, 0.8, 8, 0.78, 0.6, 0.35);
  return { parts: [{ geo: toGeometry(mb), mat: 'prop' }], collider: { box: [4.5, 3], h: 3 } };
}

function jetModel() {
  const mb = new MeshBuilder();
  const W = [0.96, 0.97, 0.98];
  // Rumpf entlang +x
  const L = 38;
  const segs = 12;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const r = (t) => 2.1 * Math.min(1, Math.sin(Math.PI * Math.min(1, t * 1.2 + 0.02)) * 1.3 + 0.1) * (t > 0.85 ? 1 - (t - 0.85) * 3.2 : 1);
    mb.cylinder(0, 0, 0, 0.001, 0.001, 0.001, 3, 0, 0, 0); // dummy
    void r;
  }
  // Rumpf als Zylinder + Nase/Heck
  const body = new MeshBuilder();
  body.cylinder(0, 0, 0, 2.1, 2.1, L * 0.78, 14, W[0], W[1], W[2]);
  void body;
  const f = new MeshBuilder();
  // Zylinder liegt entlang y -> wir drehen durch Vertauschen: baue ihn manuell entlang x
  const rings = 14, seg = 12;
  const prof = (t) => (t < 0.12 ? 0.55 + (t / 0.12) * 0.45 : t > 0.82 ? Math.max(0.12, 1 - (t - 0.82) / 0.18 * 0.88) : 1) * 2.1;
  for (let i = 0; i < rings; i++) {
    const t0 = i / rings, t1 = (i + 1) / rings;
    const x0 = -L / 2 + t0 * L, x1 = -L / 2 + t1 * L, r0 = prof(t0), r1 = prof(t1);
    const yc = 2.7;
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
      const pa = [x0, yc + Math.cos(a0) * r0, Math.sin(a0) * r0], pb = [x0, yc + Math.cos(a1) * r0, Math.sin(a1) * r0];
      const pc = [x1, yc + Math.cos(a1) * r1, Math.sin(a1) * r1], pd = [x1, yc + Math.cos(a0) * r1, Math.sin(a0) * r1];
      const belly = Math.cos((a0 + a1) / 2) < -0.2;
      const col = belly ? [0.62, 0.66, 0.72] : [0.96, 0.97, 0.98];
      const cx = (pa[0] + pc[0]) / 2, cy = (pa[1] + pc[1]) / 2 - yc, cz = (pa[2] + pc[2]) / 2;
      f.triFace(pa, pb, pc, 0, cy, cz, col[0], col[1], col[2]);
      f.triFace(pa, pc, pd, 0, cy, cz, col[0], col[1], col[2]);
      void cx;
    }
  }
  // Streifen (Airline-Farbe)
  f.box(-L * 0.12, 2.7 - 0.1, 0, L * 0.5, 0.35, 4.3, 0, 0.1, 0.35, 0.7, { noTop: true, noBottom: true });
  // Tragflächen
  const wing = (s) => { f.quadAuto([2, 1.7, 0], [-6, 1.7, s * 18], [-9.5, 1.7, s * 18], [-6, 1.7, 0], 0.93, 0.94, 0.96); f.quadAuto([-6, 1.62, 0], [-9.5, 1.62, s * 18], [-6, 1.62, s * 18], [2, 1.62, 0], 0.7, 0.72, 0.76); };
  wing(1); wing(-1);
  for (const s of [-1, 1]) { f.cylinder(-1, 0.5 + 0.0, s * 8, 1.15, 1.0, 3.4, 10, 0.75, 0.77, 0.8, true); }
  // Seitenleitwerk
  f.quadAuto([-L / 2 + 3, 3.5, 0.01], [-L / 2 + 8, 3.5, 0.01], [-L / 2 + 6.5, 10.5, 0.01], [-L / 2 + 2.2, 10.5, 0.01], 0.12, 0.4, 0.75);
  f.quadAuto([-L / 2 + 2.2, 10.5, -0.01], [-L / 2 + 6.5, 10.5, -0.01], [-L / 2 + 8, 3.5, -0.01], [-L / 2 + 3, 3.5, -0.01], 0.12, 0.4, 0.75);
  for (const s of [-1, 1]) { f.quadAuto([-L / 2 + 3, 3.0, 0], [-L / 2 + 8, 3.0, s * 6], [-L / 2 + 9.5, 3.0, s * 6], [-L / 2 + 8, 3.0, 0], 0.9, 0.92, 0.95); f.quadAuto([-L / 2 + 8, 2.95, 0], [-L / 2 + 9.5, 2.95, s * 6], [-L / 2 + 8, 2.95, s * 6], [-L / 2 + 3, 2.95, 0], 0.7, 0.72, 0.76); }
  void mb;
  return { parts: [{ geo: toGeometry(f), mat: 'prop' }], collider: { box: [19, 18], h: 12 } };
}

// Leitpfosten (weiß, schwarzes Band mit Rückstrahler). Lokal +x zeigt zur Fahrbahn.
function delineatorModel() {
  const mb = new MeshBuilder();
  const W = [0.93, 0.93, 0.9], K = [0.06, 0.06, 0.07];
  mb.box(0, 0, 0, 0.1, 0.72, 0.12, 0, ...W);
  mb.box(0, 0.72, 0, 0.1, 0.24, 0.12, 0, ...K);
  mb.box(0, 0.96, 0, 0.1, 0.06, 0.12, 0, ...W);
  // schräge Kappe
  mb.quadAuto([-0.05, 1.02, -0.06], [-0.05, 1.02, 0.06], [0.05, 1.07, 0.06], [0.05, 1.07, -0.06], ...W);
  mb.quadAuto([0.05, 1.02, -0.06], [0.05, 1.07, -0.06], [0.05, 1.07, 0.06], [0.05, 1.02, 0.06], ...W);
  mb.triFace([-0.05, 1.02, 0.06], [0.05, 1.02, 0.06], [0.05, 1.07, 0.06], 0, 0, 1, ...W);
  mb.triFace([-0.05, 1.02, -0.06], [0.05, 1.02, -0.06], [0.05, 1.07, -0.06], 0, 0, -1, ...W);
  mb.box(0.052, 0.78, 0, 0.01, 0.12, 0.05, 0, 0.95, 0.62, 0.12);   // Rückstrahler
  return { parts: [{ geo: toGeometry(mb), mat: 'prop' }], collider: null };
}

// Grasbüschel mit Wildblumen: drei gekreuzte Karten mit Alpha-Textur; Normalen nach oben (helle, gleichmäßige Beleuchtung)
function grassTuftModel(v) {
  const mb = new MeshBuilder();
  const rnd = mulberry32(700 + v);
  const W = [1.25, 1.0, 0.8][v], H = [0.62, 0.5, 0.85][v];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI + rnd() * 0.4, c = Math.cos(a) * W / 2, s = Math.sin(a) * W / 2;
    const ox = (rnd() - 0.5) * 0.25, oz = (rnd() - 0.5) * 0.25, t = 0.85 + rnd() * 0.25;
    mb.quad([ox - c, 0, oz - s], [ox + c, 0, oz + s], [ox + c, H, oz + s], [ox - c, H, oz - s], 0, 1, 0, 0, 0, 1, 1, t, t, t * 0.95);
  }
  return { parts: [{ geo: toGeometry(mb), mat: 'grass' }], collider: null };
}

// Laubbaum (Platane/Linde): Stamm mit Ästen, Krone aus vielen Blattkarten; Normalen zeigen von der Kronenmitte weg
function broadleafModel(v) {
  const wood = new MeshBuilder(), near = new MeshBuilder(), far = new MeshBuilder();
  const rnd = mulberry32(900 + v * 17);
  const H = [7.5, 9.5, 6.2][v], R = [3.6, 4.4, 3.0][v];
  const lean = (rnd() - 0.5) * 0.6;
  const bark = [0.4, 0.35, 0.29], bark2 = [0.35, 0.31, 0.26];
  tube(wood, [[0, 0, 0], [lean * 0.3, H * 0.3, 0.1], [lean * 0.6, H * 0.55, 0.15], [lean, H * 0.75, 0.2]], [0.34, 0.27, 0.2, 0.13], 8, bark, bark2);
  const cy = H * 0.72 + R * 0.45, cx = lean, cz = 0.2;
  const tiles = v === 1 ? [LEAF.broad2, LEAF.broad2, LEAF.broad] : [LEAF.broad, LEAF.broad, LEAF.broad2];
  // Hauptkrone und 4 Büschel an den Astenden
  crownPair(near, far, [cx, cy, cz, R * 0.85, R * 0.7, R * 0.85], { n: [30, 38, 24][v], size: [1.6, 2.5], tiles, tone: [0.74, 1.04], shell: 0.5 }, 910 + v * 7);
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2 + rnd(), up = H * (0.45 + rnd() * 0.25);
    const ex = cx + Math.cos(a) * R * 0.72, ez = cz + Math.sin(a) * R * 0.72, ey = cy + (rnd() - 0.35) * R * 0.55;
    tube(wood, [[lean * 0.5, up, 0.12], [(lean * 0.5 + ex) / 2, (up + ey) / 2 + 0.4, (0.12 + ez) / 2], [ex, ey, ez]], [0.13, 0.08, 0.04], 5, bark2);
    crownPair(near, far, [ex, ey + 0.3, ez, R * 0.5, R * 0.42, R * 0.5], { n: [9, 11, 7][v], size: [1.4, 2.2], tiles, tone: [0.8, 1.08], shell: 0.5 }, 930 + v * 11 + b * 3);
  }
  return treeParts(wood, near, far, { r: 0.35, h: H });
}

// Bushaltestelle: Wartehäuschen mit Glaswänden, Flachdach, Sitzbank, beleuchteter Werbevitrine und Haltestellenschild.
// Offene Seite (+z) zur Fahrbahn.
function busStopModel() {
  const metal = new MeshBuilder(), body = new MeshBuilder(), glass = new MeshBuilder(), lit = new MeshBuilder();
  const W = 3.6, D = 1.5, H = 2.45, anth = [0.2, 0.21, 0.23];
  for (const [x, z] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2 - 0.05], [W / 2, D / 2 - 0.05]]) metal.box(x, 0, z, 0.08, H, 0.08, 0, ...anth);
  metal.box(0, H, -0.05, W + 0.3, 0.1, D + 0.25, 0, ...anth);
  body.box(0, H + 0.1, -0.05, W + 0.2, 0.03, D + 0.15, 0, 0.85, 0.86, 0.88);
  // Rahmen der Glasflächen
  for (const y of [0.12, H - 0.05]) { metal.box(0, y, -D / 2, W, 0.05, 0.05, 0, ...anth); for (const sx of [-1, 1]) metal.box(sx * W / 2, y, -0.05, 0.05, 0.05, D - 0.1, 0, ...anth); }
  glass.quadAuto([W / 2, 0.15, -D / 2 + 0.01], [-W / 2, 0.15, -D / 2 + 0.01], [-W / 2, H - 0.06, -D / 2 + 0.01], [W / 2, H - 0.06, -D / 2 + 0.01], 1, 1, 1);
  glass.quadAuto([-W / 2 + 0.01, 0.15, -D / 2], [-W / 2 + 0.01, 0.15, 0.35], [-W / 2 + 0.01, H - 0.06, 0.35], [-W / 2 + 0.01, H - 0.06, -D / 2], 1, 1, 1);
  // Sitzbank (Holzlatten auf Metallträgern)
  for (const x of [-1.2, 0, 1.2]) metal.box(x, 0, -0.42, 0.06, 0.44, 0.38, 0, ...anth);
  for (let k = 0; k < 3; k++) body.box(0, 0.44, -0.55 + k * 0.13, 2.9, 0.04, 0.1, 0, 0.62, 0.42, 0.25);
  // Werbevitrine an der rechten Stirnseite (leuchtet nachts) und Fahrplan-Aushang
  metal.box(W / 2 + 0.02, 0.2, -0.15, 0.14, 2.0, 1.25, 0, ...anth);
  lit.box(W / 2 + 0.095, 0.32, -0.15, 0.01, 1.76, 1.05, 0, 1, 1, 1);
  body.box(W / 2 + 0.096, 0.4, -0.15, 0.012, 1.5, 0.9, 0, 0.95, 0.55, 0.2);
  body.box(-0.9, 1.15, -D / 2 + 0.04, 0.6, 0.8, 0.02, 0, 0.96, 0.96, 0.92);
  // Haltestellenschild: Mast mit gelbem „H“-Schild
  metal.cylinder(-W / 2 - 0.45, 0, D / 2 - 0.1, 0.045, 0.045, 2.75, 8, ...anth);
  body.cylinder(-W / 2 - 0.45, 2.55, D / 2 - 0.1, 0.3, 0.3, 0.04, 20, 0.12, 0.5, 0.22);
  body.cylinder(-W / 2 - 0.45, 2.6, D / 2 - 0.1, 0.26, 0.26, 0.05, 20, 0.98, 0.82, 0.1);
  for (const [x, w] of [[-0.09, 0.05], [0.09, 0.05]]) body.box(-W / 2 - 0.45 + x, 2.66, D / 2 - 0.1, w, 0.2, 0.002, 0, 0.12, 0.5, 0.22);
  return { parts: [{ geo: toGeometry(metal), mat: 'propMetal' }, { geo: toGeometry(body), mat: 'prop' }, { geo: toGeometry(glass), mat: 'glassClear' }, { geo: toGeometry(lit), mat: 'lampHead' }], collider: { box: [1.85, 0.8], h: 2.6 } };
}

// Boote (statisch, Häfen): echte Rumpfformen aus den Fahrzeugmodellen. Bug zeigt nach +z
function boatModel(kind) {
  const { body, glass } = boatPropParts(kind);
  return { parts: [{ geo: body, mat: 'prop', color: true }, { geo: glass, mat: 'glassFlat' }], collider: null };
}

// ---------- Registrierung ----------

export const PROP_DEFS = {
  palm: { make: () => [palmModel(0), palmModel(1), palmModel(2)], cap: 7000 },
  pine: { make: () => [pineModel(0), pineModel(1)], cap: 12000 },
  olive: { make: () => [oliveModel()], cap: 9000 },
  cypress: { make: () => [cypressModel()], cap: 2500 },
  bush: { make: () => [bushModel(false)], cap: 14000 },
  bougainvillea: { make: () => [bushModel(true)], cap: 1500 },
  agave: { make: () => [agaveModel()], cap: 3000 },
  reed: { make: () => [reedModel()], cap: 9000 },
  rock: { make: () => [rockModel(0), rockModel(1)], cap: 4000 },
  lamp: { make: () => [lampModel()], cap: 7000 },
  parasol: { make: () => [parasolModel()], cap: 5000 },
  lounger: { make: () => [loungerModel()], cap: 7000, colors: [[0.95, 0.45, 0.1], [0.15, 0.5, 0.85], [0.97, 0.97, 0.95], [0.9, 0.2, 0.3]] },
  wallseg: { make: () => [wallModel()], cap: 9000 },
  container: { make: () => [containerModel()], cap: 1500, colors: [[0.7, 0.12, 0.1], [0.1, 0.3, 0.6], [0.12, 0.45, 0.25], [0.85, 0.5, 0.1], [0.85, 0.85, 0.85], [0.35, 0.35, 0.4]] },
  windmill: { make: () => [windmillModel()], cap: 100 },
  lighthouse: { make: () => [lighthouseModel()], cap: 10 },
  beachbar: { make: () => [beachbarModel()], cap: 80 },
  parkedjet: { make: () => [jetModel()], cap: 30 },
  yacht: { make: () => [boatModel('yacht')], cap: 600, colors: [[1, 1, 1], [0.92, 0.92, 0.95], [0.85, 0.9, 1]] },
  sail: { make: () => [boatModel('sail')], cap: 600, colors: [[1, 1, 1], [0.92, 0.95, 1], [1, 0.95, 0.9]] },
  boat: { make: () => [boatModel('boat')], cap: 600, colors: [[1, 1, 1], [0.9, 0.6, 0.2], [0.2, 0.5, 0.8], [0.85, 0.85, 0.9]] },
  delineator: { make: () => [delineatorModel()], cap: 6000, noShadow: true },
  grasstuft: { make: () => [grassTuftModel(0), grassTuftModel(1), grassTuftModel(2)], cap: 60000, noShadow: true },
  tree: { make: () => [broadleafModel(0), broadleafModel(1), broadleafModel(2)], cap: 6000 },
  busstop: { make: () => [busStopModel()], cap: 1200 },
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();

export class PropSystem {
  constructor(scene, mats) {
    this.scene = scene;
    this.mats = mats;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.6), fog: true });
    this.matMap = { prop: mats.prop, propMetal: mats.propMetal, frond: mats.frond, lampHead: this.lampMat, glassFlat: mats.glassFlat, grass: mats.grassCard, leaf: mats.leaf, leafCard: mats.leafCard,
      glassClear: new THREE.MeshStandardMaterial({ color: 0xc4d6dc, transparent: true, opacity: 0.26, roughness: 0.05, metalness: 0.1, depthWrite: false, side: THREE.DoubleSide }) };
    this.types = {};
    this.lampChunks = new Map(); this.lampsDirty = false;
    this.chunks = new Map();   // key -> { type: {mats: Float32Array, cols: Float32Array|null, n, models: [] } }
    this.near = new Set();
    this.dirty = true;
    this.models = {};          // type -> [ {parts, collider} ]
    for (const [name, def] of Object.entries(PROP_DEFS)) {
      const variants = def.make();
      this.models[name] = variants;
      // pro Variante und Teil ein Paar (nah / fern) InstancedMesh
      const entries = [];
      variants.forEach((m, vi) => {
        m.parts.forEach((part, pi) => {
          const mat = this.matMap[part.mat];
          const cap = Math.ceil(def.cap / variants.length);
          // Fern-Variante (weniger Blattkarten): eigene Geometrie; geo null = wie nah (z. B. der Stamm)
          const farGeo = m.far && m.far[pi] && m.far[pi].geo ? m.far[pi].geo : part.geo;
          const mk = (shadow, geo = part.geo) => {
            const im = new THREE.InstancedMesh(geo, mat, cap);
            im.count = 0; im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = true;
            if (part.color || def.colors) { im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3); }
            this.group.add(im);
            return im;
          };
          entries.push({ variant: vi, part, near: mk(!def.noShadow), far: mk(false, farGeo), cap, color: !!(part.color || def.colors) });
        });
      });
      this.types[name] = { def, entries, variants: variants.length };
    }
  }

  // list: [{t,x,y,z,r,s,v,sx?,sz?}]  (y = Bodenhöhe)
  addChunk(key, list) {
    const lp = [];
    for (const q of list) if (q.t === 'lamp') lp.push(q.x + Math.cos(q.r || 0) * 1.2, q.y + 6.95, q.z - Math.sin(q.r || 0) * 1.2);
    if (lp.length) this.lampChunks.set(key, lp); else this.lampChunks.delete(key);
    this.lampsDirty = true;
    const byType = {};
    for (const p of list) {
      const T = this.types[p.t];
      if (!T) continue;
      (byType[p.t] || (byType[p.t] = [])).push(p);
    }
    const data = {};
    for (const [t, arr] of Object.entries(byType)) {
      const T = this.types[t];
      const nv = T.variants;
      const perVar = Array.from({ length: nv }, () => []);
      for (const p of arr) perVar[(p.v ?? 0) % nv].push(p);
      data[t] = perVar.map((items) => {
        const m = new Float32Array(items.length * 16);
        const c = T.def.colors ? new Float32Array(items.length * 3) : null;
        items.forEach((p, i) => {
          _p.set(p.x, p.y + (p.dy || 0), p.z);
          _q.setFromEuler(_e.set(0, p.r || 0, 0));
          const s = p.s || 1;
          _s.set((p.sx ?? 1) * s, (p.sy ?? 1) * s, (p.sz ?? 1) * s);
          _m.compose(_p, _q, _s);
          _m.toArray(m, i * 16);
          if (c) {
            const pal = T.def.colors, col = pal[(p.c ?? p.v ?? 0) % pal.length];
            _c.setRGB(Math.pow(col[0], 2.2), Math.pow(col[1], 2.2), Math.pow(col[2], 2.2));
            c[i * 3] = _c.r; c[i * 3 + 1] = _c.g; c[i * 3 + 2] = _c.b;
          }
        });
        return { m, c, n: items.length };
      });
    }
    this.chunks.set(key, data);
    this.dirty = true;
  }

  removeChunk(key) { if (this.chunks.delete(key)) this.dirty = true; if (this.lampChunks.delete(key)) this.lampsDirty = true; }

  getLampPositions() { const out = []; for (const a of this.lampChunks.values()) for (const n of a) out.push(n); return new Float32Array(out); }

  setNear(keys) { this.near = keys; this.dirty = true; }

  rebuild() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const [name, T] of Object.entries(this.types)) {
      for (const e of T.entries) { e.nn = 0; e.nf = 0; }
      for (const [key, data] of this.chunks) {
        const d = data[name];
        if (!d) continue;
        const isNear = this.near.has(key);
        for (const e of T.entries) {
          const v = d[e.variant];
          if (!v || !v.n) continue;
          const im = isNear ? e.near : e.far;
          const cnt = isNear ? e.nn : e.nf;
          const room = e.cap - cnt;
          const n = Math.min(v.n, room);
          if (n <= 0) continue;
          im.instanceMatrix.array.set(v.m.subarray(0, n * 16), cnt * 16);
          if (e.color && im.instanceColor) {
            if (v.c) im.instanceColor.array.set(v.c.subarray(0, n * 3), cnt * 3);
            else im.instanceColor.array.fill(1, cnt * 3, (cnt + n) * 3);
          }
          if (isNear) e.nn += n; else e.nf += n;
        }
      }
      for (const e of T.entries) {
        e.near.count = e.nn; e.far.count = e.nf;
        e.near.instanceMatrix.needsUpdate = true; e.far.instanceMatrix.needsUpdate = true;
        if (e.near.instanceColor) e.near.instanceColor.needsUpdate = true;
        if (e.far.instanceColor) e.far.instanceColor.needsUpdate = true;
      }
    }
  }

  // Nachtbeleuchtung der Lampen
  setNight(n) {
    const k = n > 0.25 ? 1 : 0.0;
    this.lampMat.color.setRGB(0.6 + k * 2.2, 0.55 + k * 1.7, 0.45 + k * 0.9);
  }
}
