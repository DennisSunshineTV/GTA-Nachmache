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

// Rad (Achse x, Außenseite +x): Reifen mit Profil und Flankenschrift, Felge mit Speichen (bzw. Stahlfelge mit Löchern),
// dahinter dunkles Felgenbett mit Bremsscheibe. Die Speichen heben sich deutlich ab – so sieht man, dass sich das Rad dreht.
// style: Anzahl Speichen (z. B. 5, 6, 10) oder 'steel'. Rückgabe: Geometry
const wheelCache = new Map();
export const WHEEL_SYMMETRY = (style) => (style === 'steel' ? 8 : Number(style) || 5);
export function wheelGeometry(r, w, rim = [0.78, 0.8, 0.84], style = 5) {
  const key = `${r}|${w}|${rim.join(',')}|${style}`;
  if (wheelCache.has(key)) return wheelCache.get(key);
  const mb = new MeshBuilder();
  const TAU2 = Math.PI * 2;
  const segs = 32;
  const tire = [0.055, 0.055, 0.06], tread = [0.085, 0.085, 0.09], wall = [0.07, 0.07, 0.075], letter = [0.5, 0.5, 0.52];
  const dark = [0.07, 0.07, 0.08], disc = [0.36, 0.35, 0.34], rimD = [rim[0] * 0.62, rim[1] * 0.62, rim[2] * 0.62];
  const P = (x, rad, a) => [x, Math.sin(a) * rad, Math.cos(a) * rad];
  // Fläche senkrecht zur Achse: Vorderseite zeigt nach sx (±x)
  const flat = (a, b, c, d, sx, col) => {
    const ux = c[1] - a[1], uz = c[2] - a[2], vx = d[1] - b[1], vz = d[2] - b[2];
    const nX = ux * vz - uz * vx;   // x-Anteil der Normale aus den Diagonalen (y,z-Ebene)
    if (nX * sx >= 0) mb.quad(a, b, c, d, sx, 0, 0, 0, 0, 1, 1, ...col);
    else mb.quad(d, c, b, a, sx, 0, 0, 0, 0, 1, 1, ...col);
  };
  // Kreisring(-ausschnitt) in der Ebene x
  const ring = (x, r0, r1, a0, a1, n, sx, colFn) => {
    for (let i = 0; i < n; i++) {
      const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n;
      flat(P(x, r0, t0), P(x, r1, t0), P(x, r1, t1), P(x, r0, t1), sx, colFn(i, (t0 + t1) / 2));
    }
  };
  // Lauffläche mit Profilblöcken (abwechselnd heller), glatte Normalen nach außen
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * TAU2, a1 = ((i + 1) / segs) * TAU2;
    const col = i % 2 ? tread : tire;
    const A = P(-w / 2, r, a0), B = P(-w / 2, r, a1), C = P(w / 2, r, a1), D = P(w / 2, r, a0);
    const i0 = mb.n;
    mb.vert(A[0], A[1], A[2], 0, Math.sin(a0), Math.cos(a0), 0, 0, ...col);
    mb.vert(D[0], D[1], D[2], 0, Math.sin(a0), Math.cos(a0), 0, 0, ...col);
    mb.vert(C[0], C[1], C[2], 0, Math.sin(a1), Math.cos(a1), 0, 0, ...col);
    mb.vert(B[0], B[1], B[2], 0, Math.sin(a1), Math.cos(a1), 0, 0, ...col);
    mb.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }
  const rr = r * 0.68;                         // Felgenradius
  for (const sx of [-1, 1]) {
    const x = (w / 2) * sx;
    // Reifenflanke; außen mit drei hellen „Schriftzügen“ (gut sichtbar beim Drehen)
    ring(x, rr, r * 0.83, 0, TAU2, segs, sx, () => wall);
    ring(x, r * 0.9, r, 0, TAU2, segs, sx, () => wall);
    ring(x, r * 0.83, r * 0.9, 0, TAU2, segs * 2, sx, (i, a) => (sx > 0 && (((a / TAU2) * 3) % 1) < 0.34 ? letter : wall));
  }
  const xo = w / 2;                             // Außenseite
  // Viereck, dessen Vorderseite in Richtung dir zeigt
  const toward = (a, b, c, d, dir, col) => {
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] >= 0) mb.quadAuto(a, b, c, d, ...col); else mb.quadAuto(d, c, b, a, ...col);
  };
  // Felgenhorn (heller Ring) und tiefes, dunkles Felgenbett mit Bremsscheibe
  ring(xo + 0.006, rr * 0.87, rr, 0, TAU2, segs, 1, () => rim);
  ring(xo - Math.min(0.07, w * 0.4), 0, rr * 0.9, 0, TAU2, segs, 1, () => dark);
  ring(xo - Math.min(0.05, w * 0.3), rr * 0.35, rr * 0.8, 0, TAU2, segs, 1, () => disc);
  if (style === 'steel') {
    // Stahlfelge: Scheibe mit 8 Lüftungslöchern (dunkel), Radkappe in der Mitte
    const n = 8;
    for (let k = 0; k < n * 4; k++) {
      const a0 = (k / (n * 4)) * TAU2, a1 = ((k + 1) / (n * 4)) * TAU2;
      const hole = k % 4 === 1 || k % 4 === 2;
      flat(P(xo + 0.003, rr * 0.3, a0), P(xo + 0.003, hole ? rr * 0.52 : rr * 0.88, a0), P(xo + 0.003, hole ? rr * 0.52 : rr * 0.88, a1), P(xo + 0.003, rr * 0.3, a1), 1, rim);
      if (hole) flat(P(xo + 0.003, rr * 0.74, a0), P(xo + 0.003, rr * 0.88, a0), P(xo + 0.003, rr * 0.88, a1), P(xo + 0.003, rr * 0.74, a1), 1, rim);
    }
    ring(xo + 0.008, 0, rr * 0.3, 0, TAU2, 12, 1, () => rimD);
    ring(xo + 0.01, 0, rr * 0.1, 0, TAU2, 10, 1, () => rim);
  } else {
    // Speichenfelge: N Speichen von der Nabe zum Horn, jede verjüngt sich nach außen
    const n = Number(style) || 5;
    const wHub = Math.min(0.42, 2.1 / n), wRim = Math.min(0.26, 1.25 / n);
    const depth = Math.min(0.032, w * 0.18);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU2;
      const r0 = rr * 0.24, r1 = rr * 0.885;
      flat(P(xo + 0.003, r0, a - wHub / 2), P(xo + 0.003, r1, a - wRim / 2), P(xo + 0.003, r1, a + wRim / 2), P(xo + 0.003, r0, a + wHub / 2), 1, rim);
      // Flanken der Speiche (geben Tiefe, wenn man schräg auf das Rad schaut)
      for (const sg of [-1, 1]) {
        const am = a + (sg * (wHub + wRim)) / 4;
        const e0 = P(xo + 0.003, r0, a + (sg * wHub) / 2), e1 = P(xo + 0.003, r1, a + (sg * wRim) / 2);
        const f0 = P(xo + 0.003 - depth, r0, a + (sg * wHub) / 2), f1 = P(xo + 0.003 - depth, r1, a + (sg * wRim) / 2);
        toward(e0, e1, f1, f0, [0, sg * Math.cos(am), -sg * Math.sin(am)], rimD);
      }
    }
    // Nabe mit Radkappe und Radmuttern
    ring(xo + 0.008, 0, rr * 0.26, 0, TAU2, 16, 1, () => rimD);
    ring(xo + 0.01, 0, rr * 0.1, 0, TAU2, 10, 1, () => rim);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU2 + Math.PI / n, c = P(xo + 0.011, rr * 0.17, a), s = rr * 0.035;
      flat([c[0], c[1] - s, c[2] - s], [c[0], c[1] - s, c[2] + s], [c[0], c[1] + s, c[2] + s], [c[0], c[1] + s, c[2] - s], 1, dark);
    }
  }
  // Innenseite: dunkle Scheibe
  ring(-w / 2 - 0.002, 0, rr, 0, TAU2, 16, -1, () => dark);
  const g = toGeometry(mb);
  wheelCache.set(key, g);
  return g;
}

// ---------- Materialien ----------
// Klare Scheiben: leicht getönt und durchsichtig (man sieht die Insassen), unter flachem Blickwinkel spiegelnd (Fresnel)
const clearGlass = new THREE.MeshStandardMaterial({ color: 0x24343d, metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 });
clearGlass.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
  { float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 3.0);
    gl_FragColor.a = clamp(mix(gl_FragColor.a, 0.9, fr), 0.0, 1.0); }`);
};
export const VMAT = {
  body: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.3 }),
  trim: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.2, roughness: 0.6 }),
  // Innenraum (Armaturen, Sitze, Dachhimmel): matt
  cabin: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.85 }),
  glass: clearGlass,
  // Fahrzeuge ohne Innenraum (LKW, Bus, Boote, Flugzeug): undurchsichtig, aber spiegelnd statt schwarz
  glassTint: new THREE.MeshStandardMaterial({ color: 0x334552, metalness: 0.8, roughness: 0.06, envMapIntensity: 1.4 }),
  wheel: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.42 }),
  head: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1) }),
  tail: new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1) }),
};

export const PAINTS = [
  [0.75, 0.05, 0.06], [0.05, 0.18, 0.55], [0.95, 0.95, 0.95], [0.04, 0.04, 0.05], [0.7, 0.72, 0.76], [0.95, 0.72, 0.05], [0.9, 0.35, 0.05],
  [0.05, 0.4, 0.22], [0.5, 0.05, 0.4], [0.2, 0.2, 0.22], [0.55, 0.45, 0.32], [0.1, 0.5, 0.75],
];

// ---------- Auto-Karosserie ----------

// Innenraum-Farben
const INTERIOR = [0.075, 0.075, 0.085];     // Armaturen, Boden auf Höhe der Gürtellinie
const SEAT_COL = [0.27, 0.24, 0.21];        // Sitze (dunkles Leder)
const HEADLINER = [0.45, 0.43, 0.4];        // Dachhimmel
const PILLAR_IN = [0.2, 0.2, 0.21];         // Innenverkleidung der Säulen

// Viereck so ausrichten, dass seine Vorderseite von center weg (out) bzw. zu center hin (!out) zeigt
function quadFrom(mb, a, b, c, d, center, col, out = true) {
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const mx = (a[0] + b[0] + c[0] + d[0]) / 4 - center[0], my = (a[1] + b[1] + c[1] + d[1]) / 4 - center[1], mz = (a[2] + b[2] + c[2] + d[2]) / 4 - center[2];
  if ((nx * mx + ny * my + nz * mz >= 0) === out) mb.quadAuto(a, b, c, d, ...col); else mb.quadAuto(d, c, b, a, ...col);
}

// Quader um die x-Achse geneigt (tilt > 0: Oberkante nach hinten), Grundmitte (cx, y0, cz)
function tiltBox(mb, cx, y0, cz, w, h, d, tilt, col) {
  const s = Math.sin(tilt), c = Math.cos(tilt);
  const P = (lx, ly, lz) => [cx + lx, y0 + ly * c + lz * s, cz - ly * s + lz * c];
  const v = [P(-w / 2, 0, -d / 2), P(w / 2, 0, -d / 2), P(w / 2, 0, d / 2), P(-w / 2, 0, d / 2), P(-w / 2, h, -d / 2), P(w / 2, h, -d / 2), P(w / 2, h, d / 2), P(-w / 2, h, d / 2)];
  const ctr = P(0, h / 2, 0);
  for (const [a, b, cc, dd] of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]]) quadFrom(mb, v[a], v[b], v[cc], v[dd], ctr, col);
}

// Lenkrad: Ring um die Achse n (zeigt zum Fahrer), Mittelpunkt C
function steeringWheel(mb, C, tilt, R, col) {
  const n = [0, Math.sin(tilt), -Math.cos(tilt)], u = [1, 0, 0], v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const S = 18, T = 4, tr = 0.017;
  const pt = (i, j) => {
    const a = (i / S) * Math.PI * 2, b = (j / T) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    const rx = u[0] * ca + v[0] * sa, ry = u[1] * ca + v[1] * sa, rz = u[2] * ca + v[2] * sa;
    return [C[0] + rx * (R + tr * cb) + n[0] * tr * sb, C[1] + ry * (R + tr * cb) + n[1] * tr * sb, C[2] + rz * (R + tr * cb) + n[2] * tr * sb];
  };
  for (let i = 0; i < S; i++) for (let j = 0; j < T; j++) {
    const a = (i + 0.5) / S * Math.PI * 2, b = (j + 0.5) / T * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    const o = [(u[0] * ca + v[0] * sa) * cb + n[0] * sb, (u[1] * ca + v[1] * sa) * cb + n[1] * sb, (u[2] * ca + v[2] * sa) * cb + n[2] * sb];
    const p0 = pt(i, j), p1 = pt(i + 1, j), p2 = pt(i + 1, j + 1), p3 = pt(i, j + 1);
    const mid = [(p0[0] + p2[0]) / 2 - o[0], (p0[1] + p2[1]) / 2 - o[1], (p0[2] + p2[2]) / 2 - o[2]];
    quadFrom(mb, p0, p1, p2, p3, mid, col);
  }
  // Speichen und Nabe (Prallplatte)
  for (const ang of [Math.PI * 0.5, Math.PI * 1.2, Math.PI * 1.8]) {
    const e = [C[0] + (u[0] * Math.cos(ang) + v[0] * Math.sin(ang)) * R, C[1] + (u[1] * Math.cos(ang) + v[1] * Math.sin(ang)) * R, C[2] + (u[2] * Math.cos(ang) + v[2] * Math.sin(ang)) * R];
    const w = 0.022, side = [u[0] * -Math.sin(ang) + v[0] * Math.cos(ang), u[1] * -Math.sin(ang) + v[1] * Math.cos(ang), u[2] * -Math.sin(ang) + v[2] * Math.cos(ang)];
    const q = (p, k) => [p[0] + side[0] * k, p[1] + side[1] * k, p[2] + side[2] * k];
    const back = [C[0] + n[0], C[1] + n[1], C[2] + n[2]];
    quadFrom(mb, q(C, -w), q(e, -w), q(e, w), q(C, w), [C[0] - n[0], C[1] - n[1], C[2] - n[2]], col);
    quadFrom(mb, q(C, -w), q(e, -w), q(e, w), q(C, w), back, col);
  }
}

// Sitz- und Kopfposition in der Kabine (für die Figur und den Innenraum). Die Figuren sind recht groß (Spielfigur ~1,9 m);
// sie sitzen so, dass der Kopf unter dem Dach bleibt und Kopf und Schultern durch die Seitenscheibe zu sehen sind.
export function cabinLayout(p) {
  const hl = p.L / 2, hw = p.W / 2;
  const zc0 = lerp(-hl, hl, p.cabin[0]), zc1 = lerp(-hl, hl, p.cabin[1]);
  const yB = p.belt - 0.04, yR = p.roof;
  const recline = p.recline ?? 0.12;
  const hips = Math.min(yR - 0.06 - Math.cos(recline), p.belt - 0.2);          // Hüfthöhe über Grund
  const dash = Math.min(0.5, 0.25 * (zc1 - zc0));
  const zHead = Math.min(zc1 - p.rakeF - 0.25, zc1 - dash - 0.4);
  const seatZ = zHead + 0.75 * Math.sin(recline);
  const seatX = hw * 0.44;
  return { zc0, zc1, yB, yR, recline, hips, dash, zHead, seatZ, seatX };
}

// Parametrische Karosserie. p: { L, W, bottom, belt, hood, trunk, roof, cabin:[t0,t1], rakeF, rakeR, wheelR, wheelBase, track, ... }
// Die Kabine ist offen: Säulen und Dach als Karosserie, dazwischen klare Scheiben; innen Armaturenbrett, Sitze, Lenkrad.
function carBody(p, paint) {
  const body = new MeshBuilder(), glass = new MeshBuilder(), head = new MeshBuilder(), tail = new MeshBuilder(), cabin = new MeshBuilder();
  const hl = p.L / 2, hw = p.W / 2;
  const dark = [0.05, 0.05, 0.06], chrome = [0.72, 0.74, 0.78];
  const roofCol = p.roofCol || paint;
  const lay = cabinLayout(p);
  const { zc0, zc1, yB, yR } = lay;
  const yBelt = yB;
  // Unterbau: Stationen von hinten (t=0) nach vorn (t=1); die Oberseite innerhalb der Kabine ist dunkel (Innenraum)
  const N_LOW = 7;
  const lower = stationsFrom(15, -hl, hl, (t) => {
    // Höhenprofile: Heck bis Gürtel, Haube fällt zur Front ab
    const yt = t < 0.15 ? lerp(p.trunk - 0.05, p.trunk, sm(0, 0.15, t)) : t < 0.55 ? lerp(p.trunk, p.belt, sm(0.15, 0.55, t)) : lerp(p.belt, p.hood, sm(0.55, 0.85, t)) - (t > 0.92 ? (t - 0.92) * 1.1 : 0);
    const w = hw * (t < 0.04 ? 0.9 + t * 2.5 : t > 0.94 ? 1 - (t - 0.94) * 2.4 : 1);
    const yb = p.bottom + (t < 0.04 || t > 0.96 ? 0.1 : 0);
    const bh = yt - yb;
    return [[0, yb, 0], [w * 0.92, yb, 0], [w, yb + bh * 0.28, 0], [w * 0.985, yb + bh * 0.72, 0], [w * 0.9, yt, 0], [w * 0.84, yt + 0.004, 0], [0, yt + 0.006, 0]];
  });
  gridLoft(body, lower, paint, { colorFn: (pt, r, j) => { const i = j < N_LOW ? j : 2 * (N_LOW - 1) - j; return i >= 5 && pt[2] > zc0 + 0.05 && pt[2] < zc1 - 0.05 ? INTERIOR : paint; } });
  // Kabine: Ebenen von der Gürtellinie bis zum Dach; jede Ebene hat ihre eigene Länge (Front- und Heckscheibe sind geneigt)
  const hb = hw * 0.9;
  const levels = [{ y: yB - 0.12, w: 1 }, { y: yB, w: 1 }, { y: lerp(yB, yR, 0.55), w: 0.88 }, { y: yR - 0.025, w: 0.74 }, { y: yR, w: 0 }];
  for (const L of levels) L.f = Math.min(1, Math.max(0, (L.y - yB) / (yR - yB)));
  const N = 8;   // Stationen: Abschnitt 0 = C-Säule, N-2 = A-Säule
  const P = (k, i, sx) => {
    const L = levels[k], t = i / (N - 1);
    const z0 = zc0 + p.rakeR * L.f, z1 = zc1 - p.rakeF * L.f;
    const e = Math.min(t, 1 - t) * 2;
    return [sx * hb * L.w * (0.92 + 0.08 * Math.min(1, e * 3)), L.y, lerp(z0, z1, t)];
  };
  const ctr = [0, lerp(yB, yR, 0.4), (zc0 + zc1) / 2];
  const glassSide = (k, i) => (k === 1 || k === 2) && i > 0 && i < N - 2 && !(p.doors4 && i === 3);
  const panel = (a, b, c, d, k) => {
    const top = k === levels.length - 2;
    quadFrom(body, a, b, c, d, ctr, top ? roofCol : paint);                // außen
    quadFrom(cabin, a, b, c, d, ctr, top ? HEADLINER : PILLAR_IN, false);  // innen (Dachhimmel, Säulenverkleidung)
  };
  for (const sx of [-1, 1]) {
    for (let k = 0; k < levels.length - 1; k++) {
      for (let i = 0; i < N - 1; i++) {
        const a = P(k, i, sx), b = P(k, i + 1, sx), c = P(k + 1, i + 1, sx), d = P(k + 1, i, sx);
        if (glassSide(k, i)) quadFrom(glass, a, b, c, d, ctr, [1, 1, 1]); else panel(a, b, c, d, k);
      }
    }
  }
  // Front- und Heckscheibe (Enden der Kabine), darunter Windlauf, darüber Dachkante
  for (const i of [0, N - 1]) {
    for (let k = 0; k < levels.length - 1; k++) {
      const a = P(k, i, -1), b = P(k, i, 1), c = P(k + 1, i, 1), d = P(k + 1, i, -1);
      if (k === 1 || k === 2) quadFrom(glass, a, b, c, d, ctr, [1, 1, 1]); else panel(a, b, c, d, k);
    }
  }
  // Innenraum: Armaturenbrett (folgt der Frontscheibe), Lenkrad, Vordersitze, Rückbank
  const zWs = (y) => zc1 - p.rakeF * Math.min(1, Math.max(0, (y - yB) / (yR - yB)));
  const zRw = (y) => zc0 + p.rakeR * Math.min(1, Math.max(0, (y - yB) / (yR - yB)));
  const dashTop = yB + 0.11, dashBack = zc1 - lay.dash, dashFront = Math.min(zc1 - 0.02, zWs(dashTop) - 0.03);
  if (dashFront > dashBack + 0.08) cabin.box(0, yB - 0.04, (dashBack + dashFront) / 2, hb * 1.84, dashTop - yB + 0.04, dashFront - dashBack, 0, ...INTERIOR);
  steeringWheel(cabin, [lay.seatX, yB - 0.01, dashBack - 0.07], 0.5, 0.17, [0.05, 0.05, 0.055]);
  const tilt = lay.recline + 0.08;
  for (const sx of [1, -1]) {
    const bz = lay.seatZ - 0.17;
    const h = Math.min(0.72, (yR - 0.12) - (lay.hips - 0.06));
    tiltBox(cabin, sx * lay.seatX, lay.hips - 0.06, bz, 0.5, h, 0.1, tilt, SEAT_COL);
    const top = [sx * lay.seatX, lay.hips - 0.06 + h * Math.cos(tilt) + 0.03, bz - h * Math.sin(tilt)];
    tiltBox(cabin, top[0], top[1], top[2], 0.27, 0.19, 0.11, tilt, SEAT_COL);
  }
  // Rückbank, wenn hinter den Vordersitzen genug Platz ist
  const benchY = yB + 0.36, benchZ = Math.max(zRw(benchY) + 0.16, lay.zHead - 0.95);
  if (benchZ < lay.seatZ - 0.75 && benchZ > zc0) {
    tiltBox(cabin, 0, Math.min(lay.hips, yB - 0.2), benchZ, hb * 1.7, benchY - Math.min(lay.hips, yB - 0.2), 0.12, 0.18, SEAT_COL);
    for (const sx of [1, -1]) tiltBox(cabin, sx * hb * 0.5, benchY + 0.02, benchZ - 0.05, 0.25, 0.17, 0.1, 0.18, SEAT_COL);
  }
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
  return { body, glass, head, tail, cabin, lay };
}

// Sitz für Fahrer (links) und Beifahrer: Hüfte auf lay.hips; Character setzt die Figur 0,55 m unter seat.y,
// die Fahrhaltung hebt die Hüfte 0,62 m über den Ursprung der Figur → seat.y = Hüfte − 0,07
const seatFrom = (lay) => ({ x: -lay.seatX, y: lay.hips - 0.07, z: lay.seatZ });

// recline: Sitzneigung (Sportwagen liegen flacher); doors4: B-Säule zwischen vorderer und hinterer Tür; rims: Felgenart
const CAR_DEFS = {
  sports: { L: 4.5, W: 1.94, bottom: 0.13, belt: 0.74, hood: 0.7, trunk: 0.86, roof: 1.27, cabin: [0.27, 0.69], rakeF: 0.72, rakeR: 0.55, wheelR: 0.35, wb: 2.64, track: 1.66, spoiler: true, bPillar: 0, recline: 0.3, rims: 10 },
  coupe: { L: 4.75, W: 1.92, bottom: 0.15, belt: 0.86, hood: 0.78, trunk: 0.95, roof: 1.36, cabin: [0.3, 0.64], rakeF: 0.6, rakeR: 0.45, wheelR: 0.36, wb: 2.75, track: 1.64, spoiler: false, stripes: true, bPillar: 0, recline: 0.25, rims: 5 },
  luxury: { L: 5.05, W: 1.9, bottom: 0.17, belt: 0.92, hood: 0.92, trunk: 1.0, roof: 1.48, cabin: [0.24, 0.72], rakeF: 0.7, rakeR: 0.5, wheelR: 0.37, wb: 3.0, track: 1.62, chromeGrille: true, bPillar: 0, doors4: true, rims: 10 },
  limo: { L: 6.9, W: 1.95, bottom: 0.17, belt: 0.94, hood: 0.92, trunk: 1.0, roof: 1.5, cabin: [0.2, 0.74], rakeF: 0.65, rakeR: 0.4, wheelR: 0.37, wb: 4.4, track: 1.66, chromeGrille: true, bPillar: 0, doors4: true, rims: 10 },
  suv: { L: 4.75, W: 2.02, bottom: 0.26, belt: 1.12, hood: 1.1, trunk: 1.2, roof: 1.84, cabin: [0.2, 0.9], rakeF: 0.5, rakeR: 0.12, wheelR: 0.43, wb: 2.85, track: 1.7, roofRails: true, bPillar: 0, doors4: true, rims: 6 },
  compact: { L: 3.75, W: 1.72, bottom: 0.17, belt: 0.82, hood: 0.84, trunk: 0.98, roof: 1.46, cabin: [0.2, 0.86], rakeF: 0.55, rakeR: 0.18, wheelR: 0.31, wb: 2.4, track: 1.48, bPillar: 0, doors4: true, rims: 5 },
  taxi: { L: 4.9, W: 1.85, bottom: 0.17, belt: 0.9, hood: 0.9, trunk: 0.98, roof: 1.46, cabin: [0.24, 0.72], rakeF: 0.7, rakeR: 0.5, wheelR: 0.36, wb: 2.85, track: 1.58, bPillar: 0, doors4: true, rims: 'steel' },
  police: { L: 4.95, W: 1.9, bottom: 0.17, belt: 0.92, hood: 0.92, trunk: 1.0, roof: 1.46, cabin: [0.24, 0.72], rakeF: 0.7, rakeR: 0.5, wheelR: 0.37, wb: 2.9, track: 1.62, bPillar: 0, doors4: true, rims: 'steel' },
  van: { L: 5.3, W: 2.04, bottom: 0.25, belt: 1.0, hood: 1.0, trunk: 2.2, roof: 2.45, cabin: [0.62, 0.95], rakeF: 0.4, rakeR: 0, wheelR: 0.38, wb: 3.2, track: 1.72, bPillar: 0, rims: 'steel' },
};

// ---------- Typbeschreibungen ----------
// Einheitliches Ergebnis: { parts: {body, glass, head, tail, cabin?}, wheels:[{x,y,z,r,w,steer}], hw, hl, h, seat:{x,y,z}, extras, clear?, recline? }
function buildCar(type, paint, rng) {
  const p = CAR_DEFS[type];
  const { body, glass, head, tail, cabin, lay } = carBody(p, paint);
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
    // Streifen auf den Türen (unter der Gürtellinie, damit er nicht in die durchsichtige Kabine ragt)
    body.box(0, p.belt - 0.33, -0.3, p.W * 1.004, 0.26, 1.5, 0, 0.95, 0.95, 0.97, { shade: false, noTop: true, noBottom: true });
  }
  if (type === 'van') body.box(0, 1.2, -hl * 0.3, p.W * 1.003, 0.5, 1.9, 0, 0.95, 0.95, 0.95, { shade: false, noTop: true, noBottom: true });
  return { parts: { body, glass, head, tail, cabin }, wheels, hw: p.W / 2, hl, h: p.roof + (type === 'police' ? 0.1 : 0), seat: seatFrom(lay), extras, wheelR: p.wheelR, clear: true, recline: lay.recline, rims: p.rims ?? 5 };
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
  return { parts: { body, glass, head, tail }, wheels, hw: 1.3, hl: 3.8, h: 3.7, seat: { x: -0.5, y: 1.55, z: 3.35 }, extras: {}, wheelR: 0.5, rims: 'steel' };
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
  return { parts: { body, glass, head, tail }, wheels, hw: W / 2, hl: L / 2, h: H + 0.4, seat: { x: -0.6, y: 1.6, z: 4.6 }, extras: {}, wheelR: 0.52, rims: 'steel' };
}

function pickup(paint) {
  const p = { L: 5.4, W: 2.0, bottom: 0.25, belt: 1.05, hood: 1.05, trunk: 1.0, roof: 1.85, cabin: [0.3, 0.6], rakeF: 0.5, rakeR: 0.05, wheelR: 0.42, wb: 3.3, track: 1.7, roofRails: false, bPillar: 0 };
  const { body, glass, head, tail, cabin, lay } = carBody(p, paint);
  // Ladefläche: dunkle Wanne
  body.box(0, 0.95, -1.4, 1.7, 0.04, 1.9, 0, 0.1, 0.1, 0.1);
  for (const sx of [-1, 1]) body.box(sx * 0.95, 0.95, -1.4, 0.08, 0.3, 2.1, 0, ...paint);
  body.box(0, 0.95, -2.35, 1.9, 0.3, 0.08, 0, ...paint);
  const wheels = [];
  for (const [x, z, s] of [[-0.85, 1.65, true], [0.85, 1.65, true], [-0.85, -1.65, false], [0.85, -1.65, false]]) wheels.push({ x, y: 0.42, z, r: 0.42, w: 0.3, steer: s, left: x < 0 });
  return { parts: { body, glass, head, tail, cabin }, wheels, hw: 1.0, hl: 2.7, h: 1.9, seat: seatFrom(lay), extras: {}, wheelR: 0.42, clear: true, recline: lay.recline, rims: 6 };
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
  return { parts: { body, glass, head, tail }, wheels, hw: 0.4, hl: 1.1, h: 1.4, seat: { x: 0, y: 0.8, z: -0.2 }, extras: { bike: true }, wheelR: 0.33, clear: true, rims: 6 };
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
  return { parts: { body, glass, head, tail }, wheels, hw: 1.3, hl: 2.0, h: 3.0, seat: { x: 0, y: 1.3, z: -0.95 }, extras: { rim: [0.8, 0.15, 0.1] }, wheelR: 0.85, clear: true, rims: 'steel' };
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
  return { parts: { body, glass, head, tail }, wheels: [], hw: 1.25, hl: 3.6, h: 1.5, seat: { x: 0.45, y: 1.0, z: -0.9 }, extras: { boat: true }, wheelR: 0.3, clear: true };
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
  return { parts: { body, glass, head, tail }, wheels: [], hw: 0.55, hl: 1.5, h: 1.1, seat: { x: 0, y: 0.6, z: -0.4 }, extras: { boat: true }, wheelR: 0.3, clear: true };
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
  heli: { name: 'Helicóptero', cls: 'heli', build: (c) => helicopter(c), maxSpeed: 55.6, accel: 10, brake: 8, steer: 0.5, grip: 3, mass: 1800, hp: 1100, price: 0, paint: [3, 2, 1] },
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
      cabin: m.parts.cabin && !m.parts.cabin.empty ? toGeometry(m.parts.cabin) : null,
    };
    bodyGeoCache.set(ck, entry);
  }
  const m = entry.def;
  const group = new THREE.Group();
  const mk = (geo, mat, cast = true) => { const o = new THREE.Mesh(geo, mat); o.castShadow = cast; o.receiveShadow = true; return o; };
  const bodyMesh = mk(entry.body, VMAT.body);
  // Klare Scheiben (durchsichtig, Insassen sichtbar) bei Autos mit Innenraum und offenen Kabinen; sonst spiegelnd getönt
  const glassMesh = mk(entry.glass, m.clear ? VMAT.glass : VMAT.glassTint, false);
  glassMesh.renderOrder = 2;
  const headMat = VMAT.head.clone();
  const headMesh = mk(entry.head, headMat, false);
  const tailMat = VMAT.tail.clone();
  const tailMesh = mk(entry.tail, tailMat, false);
  group.add(bodyMesh, glassMesh, headMesh, tailMesh);
  let cabinMesh = null;
  if (entry.cabin) { cabinMesh = mk(entry.cabin, VMAT.cabin, false); group.add(cabinMesh); }
  const wheels = [];
  const rimCol = m.extras.rim || [0.78, 0.8, 0.84];
  const rimStyle = m.rims ?? 5;
  for (const w of m.wheels) {
    const geo = wheelGeometry(w.r, w.w, rimCol, rimStyle);
    const pivot = new THREE.Group();
    pivot.position.set(w.x, w.y, w.z);
    const mesh = mk(geo, VMAT.wheel);
    if (w.left) mesh.rotation.y = Math.PI; // Felgenseite nach außen
    pivot.add(mesh);
    group.add(pivot);
    wheels.push({ pivot, mesh, steer: w.steer, r: w.r, spin: 0, vis: 0, last: 0 });
  }
  const refs = { group, bodyMesh, glassMesh, cabinMesh, headMesh, headMat, tailMesh, tailMat, wheels, def: m, paint: pi, wheelSym: WHEEL_SYMMETRY(rimStyle) };
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
  // cabin: geschlossenes Auto mit Innenraum (Insassen sitzen sichtbar hinter klaren Scheiben)
  return { hw: m.hw, hl: m.hl, h: m.h, seat: m.seat, wheelR: m.wheelR, wheels: m.wheels, cabin: !!m.parts.cabin, recline: m.recline || 0 };
};
