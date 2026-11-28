// Einfamilienhäuser in hoher Detailtiefe (Vorbild: Wohnhaus mit steilem Satteldach, Zwerchgiebel, Holzbalkon,
// angebauter Garage, Gartenmauer mit Pfeilern und Hecken).
// Lokales Hausraster: +z zeigt zur Straße (Frontseite), x quer dazu. Alle Teile werden aus b.seed abgeleitet.
import { mulberry32, clamp } from '../util.js';
import { pavedPath } from './roadgeom.js';

const STOREY = 2.75;
const ROOF_TINTS = [[0.52, 0.53, 0.55], [0.5, 0.51, 0.53], [0.46, 0.46, 0.48], [0.76, 0.42, 0.31], [1.0, 0.54, 0.36]];
const FRAME_COLS = [[0.93, 0.93, 0.91], [0.93, 0.93, 0.91], [0.2, 0.21, 0.23], [0.42, 0.28, 0.17]];
const SHUTTER_COLS = [[0.3, 0.42, 0.33], [0.42, 0.48, 0.52], [0.45, 0.3, 0.18]];
const GRAY = [0.62, 0.61, 0.59], DARK = [0.18, 0.19, 0.2], SILL = [0.78, 0.77, 0.74];
const WOOD_T = [0.62, 0.42, 0.28];
const cell = (k) => [(k % 2) / 2 + 0.004, Math.floor(k / 2) / 2 + 0.004, (k % 2) / 2 + 0.496, Math.floor(k / 2) / 2 + 0.496];
const SOLAR = cell(3);

// Quader mit Welt-UVs (Meter / k) für texturierte Teile (Stein, Holz, Hecke)
function tbox(mb, cx, y0, cz, sx, sy, sz, rot, col, k = 1, opts = {}) {
  const c = Math.cos(rot), s = Math.sin(rot), hx = sx / 2, hz = sz / 2, y1 = y0 + sy;
  const Q = (lx, y, lz) => [cx + c * lx + s * lz, y, cz - s * lx + c * lz];
  const n = (lx, lz) => [c * lx + s * lz, 0, -s * lx + c * lz];
  const [r, g, bl] = col;
  const f = (a, b, cc, d, nn, w) => mb.quad(a, b, cc, d, nn[0], nn[1], nn[2], 0, y0 / k, w / k, y1 / k, r, g, bl);
  f(Q(-hx, y0, hz), Q(hx, y0, hz), Q(hx, y1, hz), Q(-hx, y1, hz), n(0, 1), sx);
  f(Q(hx, y0, -hz), Q(-hx, y0, -hz), Q(-hx, y1, -hz), Q(hx, y1, -hz), n(0, -1), sx);
  f(Q(hx, y0, hz), Q(hx, y0, -hz), Q(hx, y1, -hz), Q(hx, y1, hz), n(1, 0), sz);
  f(Q(-hx, y0, -hz), Q(-hx, y0, hz), Q(-hx, y1, hz), Q(-hx, y1, -hz), n(-1, 0), sz);
  if (!opts.noTop) mb.quad(Q(-hx, y1, hz), Q(hx, y1, hz), Q(hx, y1, -hz), Q(-hx, y1, -hz), 0, 1, 0, 0, 0, sx / k, sz / k, r * 1.05, g * 1.05, bl * 1.05);
}

// Ikosaeder-Kugel (einmal unterteilt) für Büsche
const ICO = (() => {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((q) => q / l); });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const cache = new Map(), nf = [];
  const mid = (a, b) => { const k = a < b ? a * 100 + b : b * 100 + a; if (cache.has(k)) return cache.get(k); const m = v[a].map((q, i) => (q + v[b][i]) / 2), l = Math.hypot(...m); v.push(m.map((q) => q / l)); cache.set(k, v.length - 1); return v.length - 1; };
  for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
  const f0 = f.map((q) => q.slice()), v0 = v.slice(0, 12);
  f = nf;
  return { v, f, v0, f0 };
})();
function shrub(mb, x, y, z, rx, ry, col, rnd, k = 0.7, coarse = false) {
  const VV = coarse ? ICO.v0 : ICO.v, FF = coarse ? ICO.f0 : ICO.f;
  const vv = VV.map((p) => { const j = 1 + (rnd() - 0.5) * 0.3; return [x + p[0] * rx * j, y + p[1] * ry * j, z + p[2] * rx * j, p]; });
  const uv = (p) => [(Math.atan2(p[3][2], p[3][0]) + Math.PI) * rx / k, p[1] / k];
  for (const [a, b, c] of FF) {
    const A = vv[a];
    let Bq = vv[b], C = vv[c];
    if ((A[3][1] + Bq[3][1] + C[3][1]) / 3 < -0.6) continue;     // Unterseite weglassen
    // Reihenfolge so wählen, dass die Fläche nach außen zeigt
    const ux = Bq[0] - A[0], uy = Bq[1] - A[1], uz = Bq[2] - A[2], wx = C[0] - A[0], wy = C[1] - A[1], wz = C[2] - A[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    if (nx * (A[3][0] + Bq[3][0] + C[3][0]) + ny * (A[3][1] + Bq[3][1] + C[3][1]) + nz * (A[3][2] + Bq[3][2] + C[3][2]) < 0) [Bq, C] = [C, Bq];
    const t = 0.9 + rnd() * 0.2;
    mb.tri(A, Bq, C, col[0] * t, col[1] * t, col[2] * t, uv(A), uv(Bq), uv(C));
  }
}

export function addHouse(b, B, info) {
  const rnd = mulberry32(b.seed ^ 0x5bd1e995);
  const q = info.q & 3, R = b.rot + q * Math.PI / 2, c = Math.cos(R), s = Math.sin(R);
  const W = q % 2 ? b.d : b.w, D = q % 2 ? b.w : b.d;
  const L2W = (x, z) => [b.x + c * x + s * z, b.z - s * x + c * z];
  const P = (x, y, z) => { const p = L2W(x, z); return [p[0], y, p[1]]; };
  const NV = (nx, nz) => [c * nx + s * nz, -s * nx + c * nz];
  const hAt = info.hAt;
  const yF = b.base + 0.12, yB = b.y0 - 0.5;
  const tint = b.tint;
  const plaster = [tint[0], tint[1], tint[2]];

  // ---- Gestaltung ----
  const floors = clamp(b.floors || 1, 1, 2);
  const roofTint = ROOF_TINTS[(rnd() * ROOF_TINTS.length) | 0];
  const frameCol = FRAME_COLS[(rnd() * FRAME_COLS.length) | 0];
  const shutters = rnd() < 0.25 ? SHUTTER_COLS[(rnd() * SHUTTER_COLS.length) | 0] : null;
  const fasciaWood = rnd() < 0.55;
  const garage = W >= 11.2 && rnd() < 0.8;
  const gW = garage ? 3.5 : 0, gD = Math.min(6.6, D);
  const x0 = -W / 2, x1 = W / 2 - gW, z0 = -D / 2, z1 = D / 2;
  const mainW = x1 - x0, xc = (x0 + x1) / 2;
  const hip = b.roof === 'hip' && rnd() < 0.7;
  const axisX = mainW >= D * 0.9;                       // First parallel zur Straße
  const pitch = (hip ? 30 : 38 + rnd() * 8) * Math.PI / 180, tp = Math.tan(pitch);
  const yE = yF + floors * STOREY + 0.3;                // Traufe (Oberkante Wand)
  const oE = 0.55, oG = 0.4;                            // Dachüberstand Traufe / Giebel
  const cross = !hip && axisX && mainW >= 9 && rnd() < 0.7;
  const cw = cross ? clamp(mainW * 0.36, 3.4, 4.6) : 0;
  const cx = cross ? x0 + mainW * (rnd() < 0.5 ? 0.33 : 0.67) : 0;
  const pj = cross && rnd() < 0.5 ? 0.9 : 0;
  const doorX = cross ? (cx < xc ? x0 + mainW * 0.8 : x0 + mainW * 0.2) : x0 + mainW * (garage ? 0.78 : 0.5);
  const balcony = floors === 2 && rnd() < 0.6;
  const lit = () => rnd() < 0.35;

  // ---- Hilfen ----
  const wallQ = (mb, ax, az, bx, bz, ya, yb2, col, ao = 1) => {
    const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len, n = NV(nx, nz);
    mb.quad(P(ax, ya, az), P(bx, ya, bz), P(bx, yb2, bz), P(ax, yb2, az), n[0], 0, n[1], (ax * nz - az * nx) / 2, ya / 2, (ax * nz - az * nx + len) / 2, yb2 / 2, ...col);
    if (ao !== 1) for (let v = mb.n - 2; v < mb.n; v++) for (let ch = 0; ch < 3; ch++) mb.col[v * 3 + ch] *= ao;   // dunkler unter dem Dachüberstand
  };
  const gableTri = (mb, ax, az, bx, bz, ya, ytop, col) => {
    const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len, n = NV(nx, nz);
    const A = P(ax, ya, az), Bq = P(bx, ya, bz), T = P((ax + bx) / 2, ytop, (az + bz) / 2);
    const u0 = (ax * nz - az * nx) / 2;
    mb.tri(A, Bq, T, ...col, [u0, ya / 2], [u0 + len / 2, ya / 2], [u0 + len / 4, ytop / 2]);
    for (let ch = 0; ch < 3; ch++) mb.col[(mb.n - 1) * 3 + ch] *= 0.84;
    void n;
  };
  // Wand-ausgerichtete Box: u entlang der Wand A->B, out = Abstand vor der Wand
  const wallFrame = (ax, az, bx, bz) => {
    const len = Math.hypot(bx - ax, bz - az), dx = (bx - ax) / len, dz = (bz - az) / len, nx = -dz, nz = dx;
    const rot = R + Math.atan2(-dz, dx);
    const at = (u, out) => L2W(ax + dx * u + nx * out, az + dz * u + nz * out);
    const wbox = (mb, u, y0, out, sx, sy, sz, col) => { const p = at(u, out); mb.box(p[0], y0, p[1], sx, sy, sz, rot, col[0], col[1], col[2]); };
    const wquad = (mb, u0, u1, y0, y1, out, col, uvk = 0, rect = null) => {
      const a = at(u0, out), bq = at(u1, out), n = NV(nx, nz);
      if (rect) mb.quad([a[0], y0, a[1]], [bq[0], y0, bq[1]], [bq[0], y1, bq[1]], [a[0], y1, a[1]], n[0], 0, n[1], rect[0], rect[1], rect[2], rect[3], ...col);
      else if (uvk) mb.quad([a[0], y0, a[1]], [bq[0], y0, bq[1]], [bq[0], y1, bq[1]], [a[0], y1, a[1]], n[0], 0, n[1], u0 / uvk, y0 / uvk, u1 / uvk, y1 / uvk, ...col);
      else mb.quad([a[0], y0, a[1]], [bq[0], y0, bq[1]], [bq[0], y1, bq[1]], [a[0], y1, a[1]], n[0], 0, n[1], 0, 0, 1, 1, ...col);
    };
    return { len, at, wbox, wquad, rot, nx, nz, dx, dz };
  };

  // Fenster/Türen an einer Wand
  const glassMB = () => (lit() ? B.hGlassLit : B.hGlass);
  const pane = () => cell((rnd() * 3) | 0);
  const windowAt = (F, u, yb, w, h, o = {}) => {
    const fw = 0.075, fc = o.frame || frameCol;
    F.wquad(glassMB(), u - w / 2 + fw, u + w / 2 - fw, yb + fw, yb + h - fw, 0.012, [1, 1, 1], 0, pane());
    F.wbox(B.flat, u - w / 2 + fw / 2, yb, 0.035, fw, h, 0.08, fc);
    F.wbox(B.flat, u + w / 2 - fw / 2, yb, 0.035, fw, h, 0.08, fc);
    F.wbox(B.flat, u, yb + h - fw, 0.035, w, fw, 0.08, fc);
    F.wbox(B.flat, u, yb, 0.035, w, fw, 0.08, fc);
    if (w >= 0.95 && !o.noMullion) F.wbox(B.flat, u, yb + fw, 0.03, 0.06, h - 2 * fw, 0.06, fc);
    if (o.transom) F.wbox(B.flat, u, yb + h * 0.72, 0.03, w - 2 * fw, 0.055, 0.06, fc);
    if (!o.noSill) F.wbox(B.flat, u, yb - 0.055, 0.085, w + 0.16, 0.055, 0.17, SILL);
    // Faschen: helle Putzumrandung
    F.wbox(B.flat, u, yb + h, 0.008, w + 0.24, 0.12, 0.02, [plaster[0] * 1.02, plaster[1] * 1.02, plaster[2] * 1.02]);
    if (shutters && !o.noShutter) {
      for (const sg of [-1, 1]) {
        const su = u + sg * (w / 2 + w / 4 + 0.04);
        F.wbox(B.flat, su, yb + 0.02, 0.03, w / 2, h - 0.04, 0.035, shutters);
        for (let k = 1; k < 7; k++) F.wbox(B.flat, su, yb + (h * k) / 7, 0.05, w / 2 - 0.06, 0.02, 0.01, [shutters[0] * 0.7, shutters[1] * 0.7, shutters[2] * 0.7]);
      }
    }
  };
  const doorAt = (F, u, wd = 1.1, hd = 2.2) => {
    const fc = frameCol, yb = yF;
    F.wquad(B.hWood, u - wd / 2 + 0.06, u + wd / 2 - 0.06, yb, yb + hd - 0.06, 0.02, [0.62, 0.42, 0.27], 1);
    F.wquad(glassMB(), u + 0.12, u + 0.3, yb + 0.35, yb + 1.95, 0.03, [1, 1, 1], 0, pane());
    F.wbox(B.flat, u - wd / 2 + 0.03, yb, 0.04, 0.06, hd, 0.09, fc);
    F.wbox(B.flat, u + wd / 2 - 0.03, yb, 0.04, 0.06, hd, 0.09, fc);
    F.wbox(B.flat, u, yb + hd - 0.06, 0.04, wd, 0.06, 0.09, fc);
    F.wbox(B.flat, u - wd / 2 + 0.2, yb + 0.95, 0.07, 0.04, 0.4, 0.04, [0.7, 0.7, 0.72]);
    // Stufe(n) bis zum Gelände
    const g = F.at(u, 0.6), gy = hAt(g[0], g[1]);
    const p = F.at(u, 0.5);
    tbox(B.hStone, p[0], Math.min(gy, yF) - 0.3, p[1], 1.7, yF - Math.min(gy, yF) + 0.3, 1.0, F.rot, [0.86, 0.85, 0.82], 1.2);
    // Vordach auf zwei Holzpfosten mit kleinem Satteldach
    const dz = 1.35, cwid = 2.0, yc = yb + hd + 0.25;
    for (const sg of [-1, 1]) { const pp = F.at(u + sg * (cwid / 2 - 0.12), dz - 0.12); tbox(B.hWood, pp[0], yF, pp[1], 0.12, yc - yF, 0.12, F.rot, WOOD_T, 1); }
    const beam = F.at(u, dz - 0.12); tbox(B.hWood, beam[0], yc, beam[1], cwid, 0.14, 0.12, F.rot, WOOD_T, 1);
    const rise = 0.55, A0 = F.at(u - cwid / 2 - 0.15, 0), A1 = F.at(u - cwid / 2 - 0.15, dz + 0.1), C0 = F.at(u + cwid / 2 + 0.15, 0), C1 = F.at(u + cwid / 2 + 0.15, dz + 0.1), M0 = F.at(u, 0), M1 = F.at(u, dz + 0.1);
    const yr = yc + 0.14;
    const rt = roofTint;
    B.hRoof.quadUp([A0[0], yr, A0[1]], [A1[0], yr, A1[1]], [M1[0], yr + rise, M1[1]], [M0[0], yr + rise, M0[1]], ...rt, 0, 0, dz / 1.2, 1.1 / 1.2);
    B.hRoof.quadUp([C1[0], yr, C1[1]], [C0[0], yr, C0[1]], [M0[0], yr + rise, M0[1]], [M1[0], yr + rise, M1[1]], ...rt, 0, 0, dz / 1.2, 1.1 / 1.2);
    const nf = NV(F.nx, F.nz);
    B.flat.triFace([A1[0], yr, A1[1]], [C1[0], yr, C1[1]], [M1[0], yr + rise, M1[1]], nf[0], 0, nf[1], ...WOOD_T.map((v) => v * 0.9));
    // Wandleuchte
    F.wbox(B.flat, u - wd / 2 - 0.35, yb + 1.85, 0.07, 0.14, 0.24, 0.12, DARK);
    F.wbox(B.hGlassLit, u - wd / 2 - 0.35, yb + 1.9, 0.14, 0.09, 0.14, 0.02, [1, 1, 1]);
  };

  // Fensterreihe auf einem Wandabschnitt [ua, ub] (gleichmäßig verteilt)
  const row = (F, ua, ub, yb, w, h, o = {}) => {
    const len = ub - ua;
    if (len < w + 0.6) return [];
    const n = Math.max(1, Math.min(o.max ?? 9, Math.floor((len + 1.0) / (w + 1.5))));
    const out = [];
    for (let k = 0; k < n; k++) { const u = ua + (len * (k + 0.5)) / n; windowAt(F, u, yb, w, h, o); out.push(u); }
    return out;
  };

  // ---- Sockel ----
  const plinthTop = yF + 0.32, PL = [0.5, 0.49, 0.47];
  const plinth = (ax, az, bx, bz) => wallQ(B.flat, ax, az, bx, bz, yB, plinthTop, PL);
  plinth(x0 - 0.02, z1 + 0.02, x1 + 0.02, z1 + 0.02); plinth(x1 + 0.02, z1 + 0.02, x1 + 0.02, z0 - 0.02);
  plinth(x1 + 0.02, z0 - 0.02, x0 - 0.02, z0 - 0.02); plinth(x0 - 0.02, z0 - 0.02, x0 - 0.02, z1 + 0.02);

  // ---- Wände ----
  const fz = z1, bz = z0;
  wallQ(B.hPlaster, x0, fz, x1, fz, plinthTop, yE, plaster, 0.84);
  wallQ(B.hPlaster, x1, fz, x1, bz, plinthTop, yE, plaster, 0.84);
  wallQ(B.hPlaster, x1, bz, x0, bz, plinthTop, yE, plaster, 0.84);
  wallQ(B.hPlaster, x0, bz, x0, fz, plinthTop, yE, plaster, 0.84);
  const Ff = wallFrame(x0, fz, x1, fz), Fr = wallFrame(x1, fz, x1, bz), Fb = wallFrame(x1, bz, x0, bz), Fl = wallFrame(x0, bz, x0, fz);

  // ---- Zwerchgiebel (Front) ----
  if (cross) {
    const xa = cx - cw / 2, xb = cx + cw / 2, zf = fz + pj;
    if (pj > 0) {
      wallQ(B.hPlaster, xa, zf, xb, zf, plinthTop, yE, plaster, 0.84);
      wallQ(B.hPlaster, xb, zf, xb, fz, plinthTop, yE, plaster, 0.84);
      wallQ(B.hPlaster, xa, fz, xa, zf, plinthTop, yE, plaster, 0.84);
      plinth(xa - 0.02, zf + 0.02, xb + 0.02, zf + 0.02); plinth(xb + 0.02, zf + 0.02, xb + 0.02, fz); plinth(xa - 0.02, fz, xa - 0.02, zf + 0.02);
    }
    gableTri(B.hPlaster, xa, zf, xb, zf, yE, yE + (cw / 2) * tp, plaster);
    const Fc = wallFrame(xa, zf, xb, zf);
    windowAt(Fc, cw / 2, yF + 0.85, 1.6, 1.4, { transom: true });
    if (floors === 2) windowAt(Fc, cw / 2, yF + STOREY + 0.85, 1.4, 1.3);
    if ((cw / 2) * tp > 1.6) windowAt(Fc, cw / 2, yE + 0.3, 0.7, Math.min(1.0, (cw / 2) * tp - 0.9), { noShutter: true });
  }

  // ---- Fenster und Türen ----
  const skip = cross ? [cx - cw / 2 - 0.35, cx + cw / 2 + 0.35] : null;
  const segs = (a, bq, holes) => {
    // freie Abschnitte [a,b] ohne die Löcher [[h0,h1],…]
    let out = [[a, bq]];
    for (const [h0, h1] of holes) {
      const nx = [];
      for (const [p, qq] of out) { if (h1 <= p || h0 >= qq) nx.push([p, qq]); else { if (h0 > p) nx.push([p, h0]); if (h1 < qq) nx.push([h1, qq]); } }
      out = nx;
    }
    return out;
  };
  const toU = (x) => x - x0;                 // Front: u läuft von x0 nach x1
  const frontHoles = [[toU(doorX) - 1.0, toU(doorX) + 1.0]];
  if (skip) frontHoles.push([toU(skip[0]), toU(skip[1])]);
  for (const [a, bq] of segs(0.9, mainW - 0.9, frontHoles)) row(Ff, a, bq, yF + 0.85, 1.25, 1.4, { max: 3 });
  if (floors === 2) {
    const up = skip ? [[toU(skip[0]), toU(skip[1])]] : [];
    for (const [a, bq] of segs(0.9, mainW - 0.9, up)) row(Ff, a, bq, yF + STOREY + 0.85, 1.2, 1.3, { max: 3 });
  }
  doorAt(Ff, toU(doorX));
  // Rückseite: Terrassentür + Fenster
  const pat = mainW * 0.35;
  windowAt(Fb, pat, yF + 0.02, 2.3, 2.2, { noSill: true, noShutter: true });
  for (const [a, bq] of segs(0.9, mainW - 0.9, [[pat - 1.6, pat + 1.6]])) row(Fb, a, bq, yF + 0.85, 1.2, 1.4, { max: 2 });
  if (floors === 2) row(Fb, 0.9, mainW - 0.9, yF + STOREY + 0.85, 1.2, 1.3, { max: 3 });
  // Seiten
  const sideRows = (F, wallLen, hole) => {
    for (const [a, bq] of segs(1.0, wallLen - 1.0, hole ? [hole] : [])) row(F, a, bq, yF + 0.85, 1.15, 1.35, { max: 2 });
    if (floors === 2 && !(F === Fl && balcony)) row(F, 1.0, wallLen - 1.0, yF + STOREY + 0.85, 1.1, 1.25, { max: 2 });
  };
  sideRows(Fl, D, null);
  sideRows(Fr, D, garage ? [-0.1, gD + 0.2] : null);

  // ---- Balkon am linken Giebel (Holz) ----
  if (balcony) {
    const F = Fl, u = D / 2, yb = yF + STOREY, bw = 3.2, bd = 1.35;
    windowAt(F, u, yb + 0.02, 1.0, 2.15, { noSill: true, noShutter: true, noMullion: true });
    const ys = yb - 0.02;
    const c0 = F.at(u, bd / 2);
    tbox(B.hWood, c0[0], ys - 0.2, c0[1], bw, 0.2, bd, F.rot, WOOD_T, 1);
    // Geländer: Handlauf, Fußleiste, senkrechte Latten
    const rail = (u0, o0, u1, o1) => {
      const a = F.at(u0, o0), bq = F.at(u1, o1), L = Math.hypot(bq[0] - a[0], bq[1] - a[1]);
      const rot = Math.atan2(-(bq[1] - a[1]), bq[0] - a[0]);
      const m = [(a[0] + bq[0]) / 2, (a[1] + bq[1]) / 2];
      tbox(B.hWood, m[0], ys + 0.95, m[1], L + 0.08, 0.08, 0.1, rot, WOOD_T, 1);
      tbox(B.hWood, m[0], ys + 0.1, m[1], L, 0.06, 0.06, rot, WOOD_T, 1);
      const n = Math.max(2, Math.round(L / 0.13));
      for (let k = 0; k <= n; k++) {
        const t = k / n, px = a[0] + (bq[0] - a[0]) * t, pz = a[1] + (bq[1] - a[1]) * t;
        B.flat.box(px, ys, pz, 0.05, 0.95, 0.03, rot, ...WOOD_T.map((v) => v * 0.85));
      }
    };
    rail(u - bw / 2, bd, u + bw / 2, bd); rail(u - bw / 2, 0.05, u - bw / 2, bd); rail(u + bw / 2, bd, u + bw / 2, 0.05);
    for (const sg of [-1, 1]) { const p = F.at(u + sg * (bw / 2 - 0.1), bd - 0.1); tbox(B.hWood, p[0], hAt(p[0], p[1]) - 0.2, p[1], 0.14, ys - hAt(p[0], p[1]), 0.14, F.rot, WOOD_T, 1); }
  }

  // ---- Garage (Flachdach, Sektionaltor) ----
  const cols = [];
  if (garage) {
    const ga = x1, gb = W / 2, gz0 = fz - gD, gh = yF + 2.75;
    const PLc = [plaster[0] * 0.98, plaster[1] * 0.98, plaster[2] * 0.98];
    wallQ(B.hPlaster, ga, fz, gb, fz, plinthTop, gh, PLc, 0.9);
    wallQ(B.hPlaster, gb, fz, gb, gz0, plinthTop, gh, PLc, 0.9);
    wallQ(B.hPlaster, gb, gz0, ga, gz0, plinthTop, gh, PLc, 0.9);
    plinth(ga, fz + 0.02, gb + 0.02, fz + 0.02); plinth(gb + 0.02, fz + 0.02, gb + 0.02, gz0 - 0.02); plinth(gb + 0.02, gz0 - 0.02, ga, gz0 - 0.02);
    // Dachplatte mit Blende
    const rc = P((ga + gb) / 2, 0, (fz + gz0) / 2);
    B.flat.box(rc[0], gh, rc[2], gW + 0.3, 0.12, gD + 0.3, R, 0.55, 0.55, 0.56);
    B.flat.box(rc[0], gh + 0.12, rc[2], gW + 0.34, 0.2, gD + 0.34, R, ...DARK, { noTop: true });
    // Tor
    const F = wallFrame(ga, fz, gb, fz), u = gW / 2, dw = 2.6, dh = 2.15;
    const doorCol = [[0.62, 0.42, 0.27], [0.9, 0.9, 0.88], [0.25, 0.26, 0.28]][(rnd() * 3) | 0];
    const wood = doorCol[0] > 0.5 && doorCol[1] < 0.5;
    F.wquad(wood ? B.hWood : B.flat, u - dw / 2, u + dw / 2, yF, yF + dh, 0.02, doorCol, wood ? 1 : 0);
    for (let k = 1; k < 5; k++) F.wbox(B.flat, u, yF + (dh * k) / 5 - 0.012, 0.025, dw, 0.024, 0.012, doorCol.map((v) => v * 0.6));
    F.wbox(B.flat, u - dw / 2 - 0.04, yF, 0.04, 0.08, dh + 0.08, 0.1, frameCol);
    F.wbox(B.flat, u + dw / 2 + 0.04, yF, 0.04, 0.08, dh + 0.08, 0.1, frameCol);
    F.wbox(B.flat, u, yF + dh, 0.04, dw + 0.16, 0.08, 0.1, frameCol);
    cols.push([gb - gW / 2, fz - gD / 2, gW / 2, gD / 2, 3.1]);
  }

  // ---- Dach ----
  const RF = { roof: B.hRoof, soffit: B.flat, fascia: fasciaWood ? B.hWood : B.flat };
  const fasciaCol = fasciaWood ? [0.5, 0.33, 0.21] : [0.9, 0.9, 0.88];
  const ridgeY = (span) => yE + (span / 2) * tp;
  // Dachrahmen: a entlang des Firsts, b quer (b > 0 = Front bzw. rechts), Ursprung Mitte des Hauptkörpers
  const span = axisX ? D : mainW, len = axisX ? mainW : D;
  const RP = (a, bq, y) => (axisX ? P(xc + a, y, bq) : P(xc + bq, y, -a));
  const hb = span / 2, ha = len / 2, ry = ridgeY(span);
  const yAt = (bq) => yE + (hb - Math.abs(bq)) * tp;   // Dachhöhe über der Wand-/Traufenlinie
  const roofUV = (a, bq) => [a / 1.2, (hb + oE - Math.abs(bq)) / Math.cos(pitch) / 1.2];
  const tileTri = (p1, p2, p3) => RF.roof.triUp(RP(p1[0], p1[1], yAt(p1[1])), RP(p2[0], p2[1], yAt(p2[1])), RP(p3[0], p3[1], yAt(p3[1])), ...roofTint, roofUV(...p1), roofUV(...p2), roofUV(...p3));
  const tileQuad = (p1, p2, p3, p4) => { tileTri(p1, p2, p3); tileTri(p1, p3, p4); };
  const soffitQ = (p1, p2, p3, p4) => {
    const d = (p) => RP(p[0], p[1], yAt(p[1]) - 0.2 / Math.cos(pitch));
    RF.soffit.quadAuto(d(p4), d(p3), d(p2), d(p1), ...fasciaCol.map((v) => v * 0.92));
  };
  const fasciaEdge = (pa, pb) => {      // Stirnbrett unter einer Dachkante
    const A = RP(pa[0], pa[1], yAt(pa[1])), Bq = RP(pb[0], pb[1], yAt(pb[1]));
    const A2 = [A[0], A[1] - 0.24, A[2]], B2 = [Bq[0], Bq[1] - 0.24, Bq[2]];
    RF.fascia.quadAuto(A2, B2, Bq, A, ...fasciaCol, 0, 0, Math.hypot(Bq[0] - A[0], Bq[2] - A[2]), 0.24);
    RF.fascia.quadAuto(A, Bq, B2, A2, ...fasciaCol, 0, 0, Math.hypot(Bq[0] - A[0], Bq[2] - A[2]), 0.24);
  };
  const gutter = (pa, pb) => {
    const A = RP(pa[0], pa[1], yAt(pa[1]) - 0.3), Bq = RP(pb[0], pb[1], yAt(pb[1]) - 0.3);
    const L = Math.hypot(Bq[0] - A[0], Bq[2] - A[2]), rot = Math.atan2(-(Bq[2] - A[2]), Bq[0] - A[0]);
    B.flat.box((A[0] + Bq[0]) / 2, A[1], (A[2] + Bq[2]) / 2, L, 0.13, 0.13, rot, ...GRAY.map((v) => v * 0.7));
  };
  if (hip) {
    const L = Math.max(0, ha - hb);
    const e = [[-ha - oE, hb + oE], [ha + oE, hb + oE], [ha + oE, -hb - oE], [-ha - oE, -hb - oE]];
    const rA = [-L, 0], rB = [L, 0];
    tileQuad(e[0], e[1], rB, rA); tileQuad(e[2], e[3], rA, rB);
    tileTri(e[1], e[2], rB); tileTri(e[3], e[0], rA);
    for (let k = 0; k < 4; k++) { fasciaEdge(e[k], e[(k + 1) % 4]); gutter(e[k], e[(k + 1) % 4]); }
    soffitQ(e[0], e[1], rB, rA); soffitQ(e[2], e[3], rA, rB);
  } else {
    const aL = -ha - oG, aR = ha + oG;
    // Rückseite (b < 0) immer ganz, Front (b > 0) ggf. um den Zwerchgiebel geteilt
    tileQuad([aL, 0], [aR, 0], [aR, -hb - oE], [aL, -hb - oE]);
    soffitQ([aL, 0], [aR, 0], [aR, -hb - oE], [aL, -hb - oE]);
    fasciaEdge([aR, -hb - oE], [aL, -hb - oE]); gutter([aR, -hb - oE], [aL, -hb - oE]);
    const fe = hb + oE;
    if (cross) {
      const ca = cx - xc, ra = cw / 2 + oE;          // Zwerchgiebel im Dachrahmen (a = x - xc)
      tileQuad([aL, fe], [ca - ra, fe], [ca - ra, 0], [aL, 0]);
      tileQuad([ca + ra, fe], [aR, fe], [aR, 0], [ca + ra, 0]);
      // Fünfeck oberhalb der Kehlen
      const A = [ca - ra, fe], Bk = [ca, hb - cw / 2], C = [ca + ra, fe], Dd = [ca + ra, 0], E = [ca - ra, 0];
      tileTri(Bk, C, Dd); tileTri(Bk, Dd, E); tileTri(Bk, E, A);
      soffitQ([aL, fe], [ca - ra, fe], [ca - ra, 0], [aL, 0]); soffitQ([ca + ra, fe], [aR, fe], [aR, 0], [ca + ra, 0]);
      fasciaEdge([aL, fe], [ca - ra, fe]); fasciaEdge([ca + ra, fe], [aR, fe]);
      gutter([aL, fe], [ca - ra, fe]); gutter([ca + ra, fe], [aR, fe]);
      // Dachflächen des Zwerchgiebels (First quer zum Hauptfirst)
      const zf = hb + pj + (pj > 0 ? oG : oE), rC = yE + (cw / 2) * tp;
      const XP = (aa, bb, y) => RP(aa, bb, y);
      for (const sg of [-1, 1]) {
        const eA = [ca + sg * ra, zf], eB = [ca + sg * ra, fe], rF = [ca, zf], rBk = [ca, hb - cw / 2];
        const yE2 = yE - oE * tp;
        const pts = [XP(eA[0], eA[1], yE2), XP(rF[0], rF[1], rC), XP(rBk[0], rBk[1], rC), XP(eB[0], eB[1], yE2)];
        const uv = (p, d) => [p[1] / 1.2, d / Math.cos(pitch) / 1.2];
        RF.roof.triUp(pts[0], pts[1], pts[2], ...roofTint, uv(eA, 0), uv(rF, ra), uv(rBk, ra));
        RF.roof.triUp(pts[0], pts[2], pts[3], ...roofTint, uv(eA, 0), uv(rBk, ra), uv(eB, 0));
        const lo = (p) => [p[0], p[1] - 0.2 / Math.cos(pitch), p[2]];
        RF.soffit.triUp(lo(pts[0]), lo(pts[1]), lo(pts[2]), ...fasciaCol.map((v) => v * 0.92));
        // Ortgang-Brett an der Giebelseite des Zwerchgiebels
        const A2 = [pts[0][0], pts[0][1] - 0.24, pts[0][2]], R2 = [pts[1][0], pts[1][1] - 0.24, pts[1][2]];
        RF.fascia.quadAuto(A2, R2, pts[1], pts[0], ...fasciaCol);
        RF.fascia.quadAuto(pts[0], pts[1], R2, A2, ...fasciaCol);
        if (pj > 0) gutter([eA[0], eA[1]], [eB[0], eB[1]]);
      }
    } else {
      tileQuad([aL, fe], [aR, fe], [aR, 0], [aL, 0]);
      soffitQ([aL, fe], [aR, fe], [aR, 0], [aL, 0]);
      fasciaEdge([aL, fe], [aR, fe]); gutter([aL, fe], [aR, fe]);
    }
    // Giebeldreiecke und Ortgang-Bretter
    for (const sg of [-1, 1]) {
      const ae = sg * ha;
      const ax_ = axisX ? [xc + ae, -hb] : [xc - hb, -ae], bx_ = axisX ? [xc + ae, hb] : [xc + hb, -ae];
      if (sg > 0) gableTri(B.hPlaster, bx_[0], bx_[1], ax_[0], ax_[1], yE, ry, plaster);
      else gableTri(B.hPlaster, ax_[0], ax_[1], bx_[0], bx_[1], yE, ry, plaster);
      const ao = sg * (ha + oG);
      for (const sb of [-1, 1]) {
        const p0 = [ao, sb * fe], p1 = [ao, 0];
        const A = RP(p0[0], p0[1], yAt(p0[1])), T = RP(p1[0], p1[1], ry);
        const A2 = [A[0], A[1] - 0.24, A[2]], T2 = [T[0], T[1] - 0.24, T[2]], Lb = Math.hypot(T[0] - A[0], T[1] - A[1], T[2] - A[2]);
        RF.fascia.quadAuto(A2, T2, T, A, ...fasciaCol, 0, 0, Lb, 0.24); RF.fascia.quadAuto(A, T, T2, A2, ...fasciaCol, 0, 0, Lb, 0.24);
      }
      // Giebelfenster im Dachgeschoss
      if (ry - yE > 2.4) {
        const F = axisX ? (sg > 0 ? Fr : Fl) : (sg > 0 ? Fb : Ff);
        const uc = F.len / 2;
        const isBalcony = balcony && F === Fl;
        if (!isBalcony || floors === 1) {
          if (floors === 1) { windowAt(F, uc - 0.9, yE + 0.25, 0.9, 1.15); windowAt(F, uc + 0.9, yE + 0.25, 0.9, 1.15); }
          else windowAt(F, uc, yE + 0.35, 0.8, Math.min(1.1, ry - yE - 1.6), { noShutter: true });
        }
      }
    }
    // Firstkappe
    const r0 = RP(aL, 0, ry + 0.02), r1 = RP(aR, 0, ry + 0.02);
    const side = (bb) => [RP(aL, bb, yAt(bb) + 0.02), RP(aR, bb, yAt(bb) + 0.02)];
    const [s0a, s0b] = side(0.22), [s1a, s1b] = side(-0.22);
    const rcap = roofTint.map((v) => v * 0.85);
    const lift = (p) => [p[0], p[1] + 0.09, p[2]];
    B.flat.quadUp(s0a, s0b, lift(r1), lift(r0), ...rcap); B.flat.quadUp(s1b, s1a, lift(r0), lift(r1), ...rcap);
  }

  // ---- Kamin ----
  {
    const a = (rnd() - 0.5) * len * 0.5, bq = -0.7;
    const p = RP(a, bq, 0), top = ry + 0.9;
    tbox(B.hPlaster, p[0], yAt(bq) - 0.4, p[2], 0.6, top - yAt(bq) + 0.4, 0.6, R, plaster, 2);
    B.flat.box(p[0], top, p[2], 0.75, 0.08, 0.75, R, ...DARK);
    B.flat.box(p[0], top + 0.08, p[2], 0.3, 0.2, 0.3, R, ...DARK);
  }
  // ---- Dachfenster / Solaranlage auf der Rückseite ----
  if (!hip) {
    const sol = rnd() < 0.35;
    const lay = (a0, a1, b0, b1, mb, col, lift, rect = [0, 0, 1, 1]) => {
      const p = (aa, bb) => { const y = yAt(bb) + lift; return RP(aa, bb, y); };
      mb.quadUp(p(a0, b0), p(a1, b0), p(a1, b1), p(a0, b1), ...col, ...rect);
    };
    if (sol) {
      const n = Math.max(2, Math.min(5, Math.floor((len - 1.5) / 1.1)));
      for (let k = 0; k < n; k++) for (let r2 = 0; r2 < 2; r2++) {
        const a0 = -n * 0.55 + k * 1.1, b0 = -hb * 0.2 - r2 * 1.75;
        lay(a0, a0 + 1.04, b0 - 1.65, b0, B.flat, [0.62, 0.63, 0.65], 0.06);
        lay(a0 + 0.03, a0 + 1.01, b0 - 1.62, b0 - 0.03, B.hGlass, [1, 1, 1], 0.075, SOLAR);
      }
    } else {
      for (const a0 of len > 9 ? [-len * 0.25, len * 0.2] : [len * 0.1]) {
        lay(a0, a0 + 0.95, -hb * 0.55 - 1.25, -hb * 0.55, B.flat, DARK, 0.05);
        lay(a0 + 0.07, a0 + 0.88, -hb * 0.55 - 1.18, -hb * 0.55 - 0.07, B.hGlass, [1, 1, 1], 0.07, cell(1));
      }
    }
  }
  // Fallrohre an den vorderen Ecken
  for (const xx of [x0 + 0.12, x1 - 0.12]) { const p = P(xx, 0, fz + 0.12); B.flat.cylinder(p[0], yB, p[2], 0.055, 0.055, yE - yB - 0.25, 6, ...GRAY.map((v) => v * 0.75)); }

  // ---- Garten: Mauer mit Pfeilern und Zaunfeldern, Hecken, Büsche, Einfahrt, Weg ----
  const yard = info.yard;
  if (yard > 1.6) {
    const zw = fz + yard - 0.35, side = 2.4, xa = -W / 2 - side, xb = W / 2 + side;
    const gate = [doorX - 0.65, doorX + 0.65], drive = garage ? [W / 2 - gW / 2 - 1.6, W / 2 - gW / 2 + 1.6] : null;
    const holes = drive ? [gate, drive] : [gate];
    const wallSegs = segs(xa, xb, holes);
    const capCol = [0.82, 0.81, 0.78];
    const wcol = [0.92, 0.9, 0.86];
    for (const [a, bq] of wallSegs) {
      const n = Math.max(1, Math.round((bq - a) / 2.6));
      for (let k = 0; k <= n; k++) {
        const x = a + ((bq - a) * k) / n, p = P(x, 0, zw), gy = hAt(p[0], p[2]);
        tbox(B.hStone, p[0], gy - 0.25, p[2], 0.44, 1.4, 0.44, R, wcol, 1.2);
        B.flat.box(p[0], gy + 1.15, p[2], 0.54, 0.08, 0.54, R, ...capCol);
        if (k === n) break;
        const xm = a + ((bq - a) * (k + 0.5)) / n, pm = P(xm, 0, zw), L = (bq - a) / n - 0.44;
        const x2 = a + ((bq - a) * (k + 1)) / n, p2 = P(x2, 0, zw);
        const gy2 = hAt(p2[0], p2[2]), gb = Math.min(gy, gy2), gt = Math.max(gy, gy2);
        tbox(B.hStone, pm[0], gb - 0.25, pm[2], L, gt - gb + 0.8, 0.3, R, wcol, 1.2);
        B.flat.box(pm[0], gt + 0.55, pm[2], L, 0.06, 0.36, R, ...capCol);
        // Zaunfeld (Metallstäbe, Alpha) auf der Mauer
        const pa = P(x + 0.22, 0, zw), pb2 = P(x2 - 0.22, 0, zw), yb2 = gt + 0.61, yt = gt + 1.08, n2 = NV(0, 1);
        B.hFence.quad([pa[0], yb2, pa[2]], [pb2[0], yb2, pb2[2]], [pb2[0], yt, pb2[2]], [pa[0], yt, pa[2]], n2[0], 0, n2[1], 0, 0, L, 1, 1, 1, 1);
        cols.push([xm, zw, L / 2 + 0.22, 0.2, 1.2]);
      }
    }
    // Hecken an den Grundstücksseiten (vom Haus bis zur Mauer)
    const hedgeCol = [0.85, 0.95, 0.8];
    for (const sg of [-1, 1]) {
      if (sg > 0 && garage) continue;
      const hx = sg * (W / 2 + 1.3), za = fz + 0.4, zb = zw - 0.45;
      if (zb - za < 1.2) continue;
      const pm = P(hx, 0, (za + zb) / 2), gy = hAt(pm[0], pm[2]);
      tbox(B.hHedge, pm[0], gy - 0.2, pm[2], 0.75, 1.55, zb - za, R, hedgeCol, 0.8);
      cols.push([hx, (za + zb) / 2, 0.38, (zb - za) / 2, 1.3]);
    }
    // Heckenstreifen hinter der Mauer neben dem Tor
    {
      const ha0 = xa + 0.6, ha1 = gate[0] - 0.5;
      if (ha1 - ha0 > 1.5) { const pm = P((ha0 + ha1) / 2, 0, zw - 0.75), gy = hAt(pm[0], pm[2]); tbox(B.hHedge, pm[0], gy - 0.2, pm[2], ha1 - ha0, 1.35, 0.7, R, hedgeCol, 0.8); }
    }
    // Büsche und Blumen am Haus
    const bushes = [[x0 + 0.9, fz + 0.9], [doorX + 1.6, fz + 0.8], [x0 + mainW * 0.45, fz + 1.0]];
    for (const [bx, bz2] of bushes) {
      if (Math.abs(bx - doorX) < 0.9 || (cross && pj > 0 && bx > cx - cw / 2 - 0.6 && bx < cx + cw / 2 + 0.6)) continue;
      const p = P(bx, 0, bz2 + (cross && pj > 0 ? pj : 0)), gy = hAt(p[0], p[2]);
      shrub(B.hHedge, p[0], gy + 0.45, p[2], 0.75 + rnd() * 0.3, 0.6 + rnd() * 0.25, [0.9, 1, 0.85], rnd);
      const fl = [[0.85, 0.2, 0.35], [0.95, 0.75, 0.2], [0.75, 0.35, 0.75], [0.95, 0.95, 0.9]][(rnd() * 4) | 0];
      for (let k = 0; k < 5; k++) { const a = rnd() * 6.28, r2 = 0.75 + rnd() * 0.35; shrub(B.flat, p[0] + Math.cos(a) * r2, gy + 0.12, p[2] + Math.sin(a) * r2, 0.17 + rnd() * 0.06, 0.15, fl, rnd, 0.5, true); }
    }
    // Einfahrt und Gartenweg (Pflaster)
    if (B.road) {
      const edge = zw + 0.35;
      if (garage) { const gx = W / 2 - gW / 2; pavedPath(B.road, [L2W(gx, fz + 0.05), L2W(gx, edge + 0.2)], 3.1, hAt); }
      pavedPath(B.road, [L2W(doorX, fz + 1.0), L2W(doorX, edge + 0.2)], 1.25, hAt);
    }
  }

  // ---- Kollider (im Gebäuderaster von b, nicht im gedrehten Hausraster) ----
  const toB = (x, z) => (q === 0 ? [x, z] : q === 1 ? [z, -x] : q === 2 ? [-x, -z] : [-z, x]);
  const ext = (hx, hz) => (q % 2 ? [hz, hx] : [hx, hz]);
  const list = [];
  const mc = toB(xc, 0), me = ext(mainW / 2, D / 2);
  list.push([mc[0], mc[1], me[0], me[1]]);
  if (cross && pj > 0) { const cc = toB(cx, fz + pj / 2), ce = ext(cw / 2, pj / 2); list.push([cc[0], cc[1], ce[0], ce[1]]); }
  for (const [x, z, hx, hz, h] of cols) { const cc = toB(x, z), ce = ext(hx, hz); list.push([cc[0], cc[1], ce[0], ce[1], h]); }
  b.colliders = list;
}
