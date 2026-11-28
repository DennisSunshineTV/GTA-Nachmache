// Gebäudespezifikation -> Geometrie (Fassaden, Dächer, Balkone, Schilder, Dachaufbauten).
import { mulberry32, clamp } from '../util.js';
import { SignList } from '../world/signs.js';
import { FACADE_COLS, FACADE_ROWS } from './textures.js';
import { addBeachPart } from './beachgeom.js';
import { addServicePart } from './servicegeom.js';

const STYLE = {
  apt: { mat: 'plaster', bay: 4.0, fl: 3.1 },
  house: { mat: 'plaster', bay: 3.8, fl: 3.0 },
  old: { mat: 'old', bay: 3.6, fl: 3.2 },
  hotel: { mat: 'hotel', bay: 4.2, fl: 3.2 },
  tower: { mat: 'glass', bay: 3.2, fl: 3.7 },
  office: { mat: 'glass', bay: 3.4, fl: 3.7 },
  shop: { mat: 'shop', bay: 5, fl: 4.4 },
  club: { mat: 'club', bay: 5, fl: 3.8 },
  ware: { mat: 'metal', bay: 5, fl: 4 },
  finca: { mat: 'finca', bay: 4.5, fl: 3.2 },
  church: { mat: 'old', bay: 4.5, fl: 5 },
  terminal: { mat: 'glass', bay: 4, fl: 4.5 },
};
const SHOP_H = 4.4;

// Eine Wandfläche (Außenansicht: von A nach B nach rechts), UV in Zelleneinheiten der Atlas-Textur
function wallQuad(mb, ax, az, bx, bz, yb, yt, nx, nz, bays, floors, uo, vo, r, g, b) {
  mb.quad([ax, yb, az], [bx, yb, bz], [bx, yt, bz], [ax, yt, az], nx, 0, nz,
    uo / FACADE_COLS, vo / FACADE_ROWS, (uo + bays) / FACADE_COLS, (vo + floors) / FACADE_ROWS, r, g, b);
}

// Vier Fassaden eines Quaders
function facadeBox(B, st, cx, cz, w, d, rot, yb, h, tint, seed, opts = {}) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const hw = w / 2, hd = d / 2;
  const P = (lx, lz) => [cx + c * lx + s * lz, cz - s * lx + c * lz];
  const walls = [
    [[-hw, hd], [hw, hd], [0, 1], w], [[hw, hd], [hw, -hd], [1, 0], d],
    [[hw, -hd], [-hw, -hd], [0, -1], w], [[-hw, -hd], [-hw, hd], [-1, 0], d],
  ];
  const mb = B[st.mat];
  for (let k = 0; k < 4; k++) {
    const [A, Bq, n, len] = walls[k];
    const pa = P(A[0], A[1]), pb = P(Bq[0], Bq[1]);
    const nx = c * n[0] + s * n[1], nz = -s * n[0] + c * n[1];
    const shade = k === 0 ? 1 : k === 1 ? 0.96 : k === 2 ? 0.92 : 0.95; // leichte Variation je Seite
    const uo = (seed + k * 3) & 3, vo = (seed >> 3) & 3;
    let y0 = yb;
    if (opts.shop) {
      const sb = Math.max(1, Math.round(len / 5));
      wallQuad(B.shop, pa[0], pa[1], pb[0], pb[1], y0, y0 + SHOP_H, nx, nz, sb, 1, (seed >> 4) + k & 3, (seed >> 6) & 3, tint[0] * 0 + 1, 1, 1);
      y0 += SHOP_H;
    }
    const hh = yb + h - y0;
    if (hh <= 0.2) continue;
    const bays = Math.max(1, Math.round(len / st.bay));
    const floors = Math.max(1, Math.round(hh / st.fl));
    wallQuad(mb, pa[0], pa[1], pb[0], pb[1], y0, yb + h, nx, nz, bays, floors, uo, vo, tint[0] * shade, tint[1] * shade, tint[2] * shade);
  }
}

function flatRoof(B, cx, cz, w, d, rot, y, tint, rnd, opts = {}) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const hw = w / 2, hd = d / 2;
  const P = (lx, lz) => [cx + c * lx + s * lz, y, cz - s * lx + c * lz];
  const f = B.flat;
  const rc = opts.roofColor || [0.58, 0.57, 0.55];
  f.quadAuto(P(-hw, hd), P(hw, hd), P(hw, -hd), P(-hw, -hd), rc[0], rc[1], rc[2]);
  // Brüstung
  const pr = opts.parapet ?? 0.55, t = 0.28;
  const pc = [tint[0] * 0.92, tint[1] * 0.92, tint[2] * 0.92];
  const edge = (lx, lz, sx, sz) => { const p = P(lx, lz); f.box(p[0], y, p[2], sx, pr, sz, rot, pc[0], pc[1], pc[2], { noBottom: true }); };
  edge(0, hd - t / 2, w, t); edge(0, -hd + t / 2, w, t); edge(hw - t / 2, 0, t, d - 2 * t); edge(-hw + t / 2, 0, t, d - 2 * t);
  // Aufbauten
  if (!opts.noClutter && w > 8 && d > 8) {
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const lx = (rnd() - 0.5) * (w - 5), lz = (rnd() - 0.5) * (d - 5);
      const p = P(lx, lz);
      const kind = rnd();
      if (kind < 0.5) f.box(p[0], y, p[2], 1.5 + rnd() * 1.2, 0.9 + rnd() * 0.5, 1 + rnd() * 0.8, rot, 0.66, 0.68, 0.7);
      else if (kind < 0.75) { f.cylinder(p[0], y, p[2], 0.95, 0.95, 1.7, 8, 0.6, 0.6, 0.64); f.cylinder(p[0], y + 1.7, p[2], 0.95, 0.15, 0.5, 8, 0.5, 0.5, 0.54, false); }
      else f.box(p[0], y, p[2], 3.2, 2.5, 3.2, rot, tint[0] * 0.95, tint[1] * 0.95, tint[2] * 0.95);
    }
    if (rnd() < 0.5) { const p = P((rnd() - 0.5) * (w - 4), (rnd() - 0.5) * (d - 4)); f.box(p[0], y, p[2], 0.15, 6 + rnd() * 5, 0.15, rot, 0.7, 0.7, 0.72); }
  }
}

function hotelBalconies(B, b, yF, c, s) {
  const f = B.flat;
  const long = b.w >= b.d;
  const faces = long ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
  const hh = 1.4;
  for (const [fx, fz] of faces) {
    const len = (long ? b.w : b.d) - 1.6;
    const off = (long ? b.d : b.w) / 2 + hh / 2 - 0.1;
    const cx = b.x + c * fx * off + s * fz * off, cz = b.z - s * fx * off + c * fz * off;
    // Platten und Geländer je Geschoss
    for (let k = 1; k < b.floors; k++) {
      const y = yF + k * 3.2 - 0.16;
      const rot = long ? b.rot : b.rot + Math.PI / 2;
      f.box(cx, y, cz, len, 0.22, hh, long ? b.rot : b.rot + Math.PI / 2, 0.93, 0.92, 0.88, { noBottom: false });
      const ro = off + hh / 2 - 0.08;
      const rx = b.x + c * fx * ro + s * fz * ro, rz = b.z - s * fx * ro + c * fz * ro;
      f.box(rx, y + 0.22, rz, len, 1.0, 0.07, rot, 0.66, 0.84, 0.9);
    }
  }
}

// Fügt ein Gebäude den Mesh-Buildern B hinzu. front: Wandindex (0..3) mit Schild
export function addBuilding(b, B, front = 0) {
  if (b.style === 'beach') { addBeachPart(b, B); return; }
  if (b.style === 'service') { addServicePart(b, B); return; }
  const st = STYLE[b.style] || STYLE.apt;
  const tint = b.tint;
  const rnd = mulberry32(b.seed);
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const yF = b.base + 0.12, yT = yF + b.h;
  const yB = b.y0 - 0.5;
  const hw = b.w / 2, hd = b.d / 2;
  const P = (lx, lz) => [b.x + c * lx + s * lz, b.z - s * lx + c * lz];
  // Sockel unter der Fassade
  if (yF - yB > 0.05) {
    const fc = [tint[0] * 0.7, tint[1] * 0.68, tint[2] * 0.64];
    const corners = [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]];
    const ns = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    for (let k = 0; k < 4; k++) {
      const A = P(...corners[k]), Bq = P(...corners[(k + 1) % 4]);
      B.flat.quad([A[0], yB, A[1]], [Bq[0], yB, Bq[1]], [Bq[0], yF, Bq[1]], [A[0], yF, A[1]], c * ns[k][0] + s * ns[k][1], 0, -s * ns[k][0] + c * ns[k][1], 0, 0, 1, 1, fc[0], fc[1], fc[2]);
    }
  }
  const shopBand = b.shop && st.mat !== 'shop' && st.mat !== 'club' && b.h > SHOP_H + 3;
  facadeBox(B, st, b.x, b.z, b.w, b.d, b.rot, yF, b.h, tint, b.seed, { shop: shopBand });

  // Dach
  const style = b.style;
  if (style === 'church') {
    B.roof.gable(b.x, yT, b.z, b.w, b.d, b.rot, 7, 0.6, 0.95, 0.78, 0.7, tint[0], tint[1], tint[2], B.flat);
    // Glockenturm
    const tp = P(0, hd + 1.5 - 0.5);
    facadeBox(B, st, tp[0], tp[1], 7, 7, b.rot, yF, b.h + 16, [tint[0] * 0.97, tint[1] * 0.97, tint[2] * 0.97], b.seed + 5);
    B.roof.hip(tp[0], yF + b.h + 16, tp[1], 7, 7, b.rot, 7, 0.3, 0.7, 0.45, 0.38);
    B.flat.box(tp[0], yF + b.h + 23, tp[1], 0.35, 3, 0.35, 0, 0.8, 0.7, 0.4);
    return;
  }
  const rf = b.roof;
  if (rf === 'gable' || rf === 'hip') {
    const rise = clamp(Math.min(b.w, b.d) * 0.3, 1.3, 4.6);
    const rv = 0.88 + rnd() * 0.22;
    const rr = 1.0 * rv, rg = (0.9 + rnd() * 0.12) * rv, rb = (0.86 + rnd() * 0.14) * rv;
    if (rf === 'gable') B.roof.gable(b.x, yT, b.z, b.w, b.d, b.rot, rise, style === 'finca' ? 0.7 : 0.45, rr, rg, rb, tint[0] * 0.96, tint[1] * 0.96, tint[2] * 0.96, B.flat);
    else B.roof.hip(b.x, yT, b.z, b.w, b.d, b.rot, rise, 0.45, rr, rg, rb);
    // Kamin
    if (style === 'house' || style === 'finca') {
      const p = P(b.w * 0.25, 0);
      B.flat.box(p[0], yT + 0.5, p[1], 0.7, rise + 1, 0.7, b.rot, 0.72, 0.6, 0.5);
    }
  } else {
    const roofColor = style === 'ware' ? [0.7, 0.72, 0.74] : style === 'tower' || style === 'office' ? [0.5, 0.52, 0.55] : [0.6, 0.59, 0.57];
    flatRoof(B, b.x, b.z, b.w, b.d, b.rot, yT, tint, rnd, { roofColor, parapet: style === 'tower' ? 0.9 : 0.55, noClutter: style === 'terminal' });
    if (style === 'tower') {
      // Aufsatz und Antenne
      const tp = P(0, 0);
      const stories = 2 + Math.floor(rnd() * 3);
      facadeBox(B, st, tp[0], tp[1], b.w * 0.62, b.d * 0.62, b.rot, yT, stories * 3.7, [tint[0] * 0.92, tint[1] * 0.94, tint[2] * 0.96], b.seed + 1);
      flatRoof(B, tp[0], tp[1], b.w * 0.62, b.d * 0.62, b.rot, yT + stories * 3.7, tint, rnd, { noClutter: true, parapet: 0.5, roofColor });
      if (b.spire) {
        B.flat.cylinder(tp[0], yT + stories * 3.7, tp[1], 0.9, 0.12, 24 + rnd() * 10, 6, 0.75, 0.75, 0.78);
      } else B.flat.box(tp[0], yT + stories * 3.7, tp[1], 0.3, 9 + rnd() * 6, 0.3, 0, 0.72, 0.72, 0.74);
    }
    if (style === 'terminal') B.flat.box(b.x, yT - 0.4, b.z, b.w + 8, 0.8, b.d + 8, b.rot, 0.85, 0.88, 0.92);
  }

  // Balkone (3D) bei Hotels
  if (style === 'hotel' && b.balconies && b.floors > 1) hotelBalconies(B, b, yF, c, s);

  // Schild
  if (b.signIdx !== undefined) {
    const [u0, v0, u1, v1] = SignList.uv(b.signIdx);
    const k = front & 3;
    const lens = [b.w, b.d, b.w, b.d];
    const nloc = [[0, 1], [1, 0], [0, -1], [-1, 0]][k];
    const len = lens[k];
    const big = style === 'hotel' || style === 'tower' || style === 'office';
    const sw = Math.min(len * 0.82, big ? 13 : 8.5), sh = sw / 4;
    const ySign = big ? yT - sh - 1.6 : yF + (b.shop ? SHOP_H + 0.35 : 3.2);
    const off = (k % 2 === 0 ? hd : hw) + 0.14;
    const cxs = b.x + c * nloc[0] * off + s * nloc[1] * off, czs = b.z - s * nloc[0] * off + c * nloc[1] * off;
    const right = [c * nloc[1] + s * -nloc[0], -s * nloc[1] + c * -nloc[0]]; // (nz, -nx) in lokal -> Welt
    const nx = c * nloc[0] + s * nloc[1], nz = -s * nloc[0] + c * nloc[1];
    const rx = nz, rz = -nx;
    void right;
    const a = [cxs - rx * sw / 2, ySign, czs - rz * sw / 2], bb = [cxs + rx * sw / 2, ySign, czs + rz * sw / 2];
    B.sign.quad(a, bb, [bb[0], ySign + sh, bb[2]], [a[0], ySign + sh, a[2]], nx, 0, nz, u0, v0, u1, v1, 1, 1, 1);
    // Rückseite weglassen; Rahmen
    B.flat.box(cxs - nx * 0.07, ySign - 0.12, czs - nz * 0.07, sw + 0.3, sh + 0.24, 0.1, Math.atan2(rx, -rz) * 0 + (k % 2 === 0 ? b.rot : b.rot + Math.PI / 2), 0.1, 0.1, 0.12, { noTop: false });
  }
}
