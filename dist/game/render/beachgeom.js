// Geometrie des Strandhauses (Holzwände, Strohdach, Glasfront, Garage, Schild). Teile werden von addBuilding aufgerufen.
import { mulberry32 } from '../util.js';
import { SignList } from '../world/signs.js';
import { HOUSE, GARAGE_IN } from '../world/beachhouse.js';

const WOOD = [0.6, 0.43, 0.27], WOOD_D = [0.42, 0.29, 0.18], WOOD_L = [0.74, 0.57, 0.38];
const THATCH = [0.66, 0.52, 0.3];
const GLASS = [0.46, 0.64, 0.72], FRAME = [0.1, 0.1, 0.11], DOOR = [0.26, 0.26, 0.28];

// Viereck mit Normale in Richtung h (Windung wird passend gewählt)
function quadFacing(mb, a, b, c, d, h, col) {
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
  const vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * h[0] + ny * h[1] + nz * h[2] >= 0) mb.quadAuto(a, b, c, d, col[0], col[1], col[2]);
  else mb.quadAuto(d, c, b, a, col[0], col[1], col[2]);
}
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// Strohdach über einem Firstverlauf: Reihen aus leicht abstehenden Strohlagen
// o: { axis: 'x'|'z' (Richtung des Firsts im Teil), half: halbe Breite am Traufrand, eaveY, rise, t0, t1 (Firstbereich), wallTopY, wallHalf }
function thatch(mb, P, rng, o, WV) {
  const R = 9, n = Math.max(1, Math.round((o.t1 - o.t0) / 1.6));
  const L = Math.hypot(o.rise, o.half);
  const nOut = [o.rise / L, o.half / L];            // Plattennormale (quer, hoch) für sgn = +1
  const pt = (sgn, u, t, lip) => {
    const across = sgn * o.half * (1 - u) + sgn * nOut[0] * lip, y = o.eaveY + o.rise * u + nOut[1] * lip;
    return o.axis === 'z' ? P(across, y, t) : P(t, y, across);
  };
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < R; i++) {
      const u0 = i / R, u1 = (i + 1) / R, row = 0.93 + (i % 2) * 0.09;
      for (let k = 0; k < n; k++) {
        const t0 = o.t0 + ((o.t1 - o.t0) * k) / n, t1 = o.t0 + ((o.t1 - o.t0) * (k + 1)) / n;
        const v = (0.9 + rng() * 0.2) * row;
        const h = o.axis === 'z' ? WV(sgn * nOut[0], nOut[1], 0) : WV(0, nOut[1], sgn * nOut[0]);
        quadFacing(mb, pt(sgn, u0, t0, 0.17), pt(sgn, u0, t1, 0.17), pt(sgn, u1, t1, 0), pt(sgn, u1, t0, 0), h, shade(THATCH, v));
      }
    }
    // Unterseite der Dachüberstände (Holzverkleidung), damit man nicht durch das Dach sieht
    const a = o.axis === 'z' ? P(sgn * o.half, o.eaveY, o.t0) : P(o.t0, o.eaveY, sgn * o.half);
    const b = o.axis === 'z' ? P(sgn * o.half, o.eaveY, o.t1) : P(o.t1, o.eaveY, sgn * o.half);
    const c = o.axis === 'z' ? P(sgn * o.wallHalf, o.wallTopY, o.t1) : P(o.t1, o.wallTopY, sgn * o.wallHalf);
    const d = o.axis === 'z' ? P(sgn * o.wallHalf, o.wallTopY, o.t0) : P(o.t0, o.wallTopY, sgn * o.wallHalf);
    quadFacing(mb, a, b, c, d, [0, -1, 0], shade(WOOD_D, 0.9));
  }
  // Firstkappe
  const ridgeY = o.eaveY + o.rise;
  const mid = o.axis === 'z' ? P(0, 0, (o.t0 + o.t1) / 2) : P((o.t0 + o.t1) / 2, 0, 0);
  const len = o.t1 - o.t0 + 0.6;
  mb.box(mid[0], ridgeY - 0.12, mid[2], o.axis === 'z' ? 0.9 : len, 0.5, o.axis === 'z' ? len : 0.9, o.rot, 0.46, 0.34, 0.2);
}

// Senkrechte Leisten auf einer Wandfläche (Holzoptik)
function battens(mb, P, lxA, lzA, lxB, lzB, y0, h, nx, nz, step, col, rot) {
  const len = Math.hypot(lxB - lxA, lzB - lzA), n = Math.max(1, Math.round(len / step));
  for (let k = 0; k <= n; k++) {
    const t = k / n, lx = lxA + (lxB - lxA) * t + nx * 0.03, lz = lzA + (lzB - lzA) * t + nz * 0.03, p = P(lx, y0, lz);
    mb.box(p[0], y0, p[2], Math.abs(nx) > 0 ? 0.06 : 0.12, h, Math.abs(nz) > 0 ? 0.06 : 0.12, rot, col[0], col[1], col[2]);
  }
}

// Einrichtung des Haupthauses (lokal: +z Glasfront zum Meer, −z Rückwand mit Haustür). Maße passen zu den
// Möbel-Kollidern in world/beachhouse.js (MAIN_COLLIDERS).
function interior(f, box, P, W, b, yF, wallH, hw, hd) {
  const iw = hw - 0.3, id = hd - 0.3;
  const cyl = (lx, lz, y, ...a) => { const q = W(lx, lz); f.cylinder(q[0], y, q[1], ...a); };
  // Dielenboden und Decke
  box(0, yF - 0.04, 0.1, 2 * iw, 0.04, 2 * id + 0.2, [0.7, 0.53, 0.36]);
  for (let lx = -iw + 0.45; lx < iw; lx += 0.45) box(lx, yF, 0.1, 0.025, 0.004, 2 * id + 0.2, [0.55, 0.4, 0.26]);
  quadFacing(f, P(-iw, yF + wallH - 0.03, -id), P(iw, yF + wallH - 0.03, -id), P(iw, yF + wallH - 0.03, hd - 0.1), P(-iw, yF + wallH - 0.03, hd - 0.1), [0, -1, 0], [0.86, 0.8, 0.7]);
  for (const lz of [-3, 0.5, 3.5]) box(0, yF + wallH - 0.3, lz, 2 * iw, 0.27, 0.22, WOOD_D);       // Deckenbalken
  // Innenseiten der Seitenfenster
  for (const sg of [-1, 1]) for (const lz of [-3.6, 1.2]) box(sg * (iw - 0.01), yF + 1.1, lz, 0.04, 1.5, 2.2, GLASS);
  // Schlafbereich: Doppelbett mit Kopfteil, Nachttisch mit Lampe, Kleiderschrank
  const bd = HOUSE.bed;
  box(bd.x, yF, bd.z, 2.3, 0.32, 1.9, WOOD_D);
  box(bd.x + 0.05, yF + 0.32, bd.z, 2.15, 0.24, 1.8, [0.95, 0.94, 0.9]);
  box(bd.x + 0.45, yF + 0.57, bd.z, 1.3, 0.05, 1.84, [0.25, 0.55, 0.62]);                   // Decke
  for (const sz of [-0.45, 0.45]) box(bd.x - 0.8, yF + 0.56, bd.z + sz, 0.45, 0.16, 0.75, [1, 1, 0.97]);
  box(-iw + 0.06, yF, bd.z, 0.12, 1.15, 2.0, WOOD_L);
  box(-4.75, yF, -4.65, 0.5, 0.55, 0.5, WOOD_L);
  cyl(-4.75, -4.65, yF + 0.55, 0.08, 0.08, 0.3, 8, 0.2, 0.2, 0.2);
  cyl(-4.75, -4.65, yF + 0.82, 0.2, 0.12, 0.24, 10, 1.0, 0.9, 0.7);
  box(-3.6, yF, -5.85, 2.2, 2.3, 0.62, WOOD_L);
  box(-3.6, yF + 0.05, -5.52, 0.02, 2.2, 0.03, WOOD_D);
  for (const sx of [-0.12, 0.12]) box(-3.6 + sx, yF + 1.1, -5.51, 0.03, 0.3, 0.03, FRAME);
  // Küche an der rechten Wand: Zeile mit Arbeitsplatte, Kochfeld, Spüle, Kühlschrank, Hängeregal
  box(4.8, yF, -3.35, 0.8, 0.88, 3.7, [0.93, 0.93, 0.92]);
  box(4.78, yF + 0.88, -3.35, 0.86, 0.06, 3.74, [0.22, 0.22, 0.24]);
  box(4.75, yF + 0.94, -2.3, 0.56, 0.01, 0.62, [0.08, 0.08, 0.09]);
  box(4.75, yF + 0.9, -4.1, 0.5, 0.05, 0.5, [0.7, 0.72, 0.75]);
  for (let k = 0; k < 4; k++) box(4.39, yF + 0.1, -4.9 + k * 0.92, 0.02, 0.7, 0.86, [0.86, 0.86, 0.85]);
  box(4.8, yF, -5.75, 0.84, 2.0, 0.84, [0.82, 0.84, 0.86]);
  box(4.37, yF + 0.9, -5.4, 0.03, 0.5, 0.04, FRAME);
  box(5.0, yF + 1.65, -3.35, 0.36, 0.04, 2.4, WOOD_L);
  for (let k = 0; k < 5; k++) box(5.0, yF + 1.69, -4.3 + k * 0.45, 0.2, 0.22 + (k % 2) * 0.08, 0.2, k % 2 ? [0.9, 0.9, 0.86] : [0.2, 0.45, 0.6]);
  // Esstisch mit vier Stühlen
  box(2.0, yF, -0.4, 1.6, 0.74, 0.9, WOOD_L);
  box(2.0, yF + 0.74, -0.4, 1.7, 0.05, 1.0, WOOD);
  for (const [cx, cz] of [[1.55, -1.15], [2.45, -1.15], [1.55, 0.35], [2.45, 0.35]]) {
    box(cx, yF, cz, 0.44, 0.46, 0.44, WOOD_D);
    box(cx, yF + 0.46, cz + (cz < -0.4 ? -0.19 : 0.19), 0.44, 0.5, 0.06, WOOD_D);
  }
  // Wohnbereich vor der Glasfront: Teppich, Sofa mit Blick aufs Meer, Sessel, Couchtisch, Leuchte, Pflanzen
  box(-1.6, yF, 3.4, 3.8, 0.012, 2.8, [0.82, 0.74, 0.62]);
  const SOFA = [0.32, 0.44, 0.5], SOFA_L = [0.4, 0.53, 0.6];
  box(-1.6, yF, 2.45, 3.0, 0.42, 0.95, SOFA);
  box(-1.6, yF, 2.03, 3.0, 0.88, 0.2, SOFA);
  for (const sx of [-1.45, 1.45]) box(-1.6 + sx, yF, 2.45, 0.2, 0.62, 0.95, SOFA);
  for (const sx of [-0.68, 0.68]) box(-1.6 + sx, yF + 0.42, 2.5, 1.3, 0.12, 0.8, SOFA_L);
  for (const sx of [-1.0, 0.1, 1.0]) box(-1.6 + sx, yF + 0.5, 2.18, 0.5, 0.42, 0.14, [0.92, 0.84, 0.6]);
  box(-3.55, yF, 3.45, 0.95, 0.42, 1.2, SOFA);
  box(-3.95, yF, 3.45, 0.2, 0.85, 1.2, SOFA);
  box(-3.5, yF + 0.42, 3.45, 0.8, 0.12, 1.0, SOFA_L);
  box(-1.6, yF, 3.95, 1.3, 0.36, 0.7, WOOD_D);
  box(-1.6, yF + 0.36, 3.95, 1.36, 0.05, 0.76, WOOD_L);
  cyl(-1.9, 3.95, yF + 0.41, 0.12, 0.09, 0.16, 8, 0.95, 0.95, 0.92);
  cyl(-3.9, 2.05, yF, 0.03, 0.03, 1.6, 6, 0.15, 0.15, 0.16);
  cyl(-3.9, 2.05, yF + 1.45, 0.3, 0.18, 0.32, 12, 1.0, 0.92, 0.75);
  for (const [px, pz, s] of [[4.6, 5.8, 1], [-4.7, 5.8, 0.85], [4.6, 1.4, 0.7]]) {
    const q = W(px, pz);
    f.cylinder(q[0], yF, q[1], 0.26 * s, 0.2 * s, 0.45 * s, 10, 0.85, 0.82, 0.76);
    f.cylinder(q[0], yF + 0.45 * s, q[1], 0.12, 0.5 * s, 0.8 * s, 9, 0.22, 0.48, 0.24);
    f.cone(q[0], yF + 1.25 * s, q[1], 0.42 * s, 0.7 * s, 9, 0.28, 0.56, 0.28);
  }
  // Bilder an der Rückwand und eine Deckenleuchte
  box(2.6, yF + 1.4, -id - 0.02, 1.6, 1.0, 0.04, FRAME);
  box(2.6, yF + 1.46, -id + 0.0, 1.46, 0.88, 0.02, [0.95, 0.55, 0.35]);
  box(2.6, yF + 1.46, -id + 0.01, 1.46, 0.36, 0.02, [0.2, 0.55, 0.75]);
  const lamp = W(0, 0.5);
  f.cylinder(lamp[0], yF + wallH - 1.0, lamp[1], 0.02, 0.02, 0.7, 6, 0.1, 0.1, 0.1);
  f.cylinder(lamp[0], yF + wallH - 1.25, lamp[1], 0.5, 0.25, 0.28, 14, 1.0, 0.9, 0.7);
}

export function addBeachPart(b, B) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const rng = mulberry32(b.seed || 7);
  const yF = b.base + 0.12;
  const f = B.flat;
  const W = (lx, lz) => [b.x + c * lx + s * lz, b.z - s * lx + c * lz];
  const P = (lx, ly, lz) => { const q = W(lx, lz); return [q[0], ly, q[1]]; };
  const WV = (lx, ly, lz) => [c * lx + s * lz, ly, -s * lx + c * lz];
  const hw = b.w / 2, hd = b.d / 2;
  const box = (lx, y0, lz, sx, sy, sz, col, opts) => { const q = W(lx, lz); f.box(q[0], y0, q[1], sx, sy, sz, b.rot, col[0], col[1], col[2], opts); };

  // Sockel bis zum Gelände (Haupthaus: dunkles Holz, es steht zum Strand hin erhöht)
  const yB = b.y0 - 0.6;
  if (b.part !== 'sign') box(0, yB, 0, b.w + 0.1, yF - yB, b.d + 0.1, b.part === 'main' ? WOOD_D : [0.52, 0.47, 0.4], { noTop: true });
  if (b.part === 'main') {
    battens(f, P, -hw, hd, hw, hd, yB, yF - yB, 0, 1, 0.55, shade(WOOD_D, 0.75), b.rot);
    battens(f, P, -hw, -hd, -hw, hd, yB, yF - yB, -1, 0, 0.55, shade(WOOD_D, 0.75), b.rot);
    battens(f, P, hw, -hd, hw, hd, yB, yF - yB, 1, 0, 0.55, shade(WOOD_D, 0.75), b.rot);
  }

  if (b.part === 'sign') {
    const [u0, v0, u1, v1] = SignList.uv(b.signIdx);
    for (const px of [-hw + 0.25, hw - 0.25]) box(px, yF - 0.2, 0, 0.22, 1.9, 0.22, WOOD_D);
    box(0, yF + 0.62, 0, b.w - 0.1, 1.0, 0.12, WOOD);
    for (const sg of [-1, 1]) {
      const sw = b.w - 0.5, sh = sw / 4, y0 = yF + 0.62 + (1.0 - sh) / 2, lz = sg * (0.06 + 0.012);
      const a = P(-sw / 2 * sg, y0, lz), bb = P(sw / 2 * sg, y0, lz), cc = P(sw / 2 * sg, y0 + sh, lz), dd = P(-sw / 2 * sg, y0 + sh, lz);
      const n = W(0, sg);
      B.sign.quad(a, bb, cc, dd, n[0] - b.x, 0, n[1] - b.z, u0, v0, u1, v1, 1, 1, 1);
    }
    return;
  }

  if (b.part === 'garage') {
    const wallH = 3.15, eaveY = yF + 2.75, rise = 2.0, half = hd + 1.0;
    const dw = GARAGE_IN.door.w, dh = GARAGE_IN.door.h, g = dw / 2, wt = 0.3;
    // Wände (hohl, vorn mit Toröffnung; das Tor selbst bewegt sich und liegt in world/homebase.js)
    box(-hw + wt / 2, yF, 0, wt, wallH, b.d, WOOD);
    box(hw - wt / 2, yF, 0, wt, wallH, b.d, WOOD);
    box(0, yF, hd - wt / 2, b.w, wallH, wt, WOOD);
    for (const sg of [-1, 1]) box(sg * (g + (hw - g) / 2), yF, -hd + wt / 2, hw - g, wallH, wt, WOOD);
    box(0, yF + dh, -hd + wt / 2, dw, wallH - dh, wt, WOOD);
    battens(f, P, -hw, hd, hw, hd, yF, wallH, 0, 1, 0.9, WOOD_D, b.rot);
    battens(f, P, hw, -hd, hw, hd, yF, wallH, 1, 0, 0.9, WOOD_D, b.rot);
    battens(f, P, -hw, -hd, -hw, hd, yF, wallH, -1, 0, 0.9, WOOD_D, b.rot);
    for (const sg of [-1, 1]) battens(f, P, sg * (g + 0.35), -hd, sg * hw, -hd, yF, wallH, 0, -1, 0.9, WOOD_D, b.rot);
    // Torrahmen und Wandleuchten (Richtung Zufahrt: lokal −z)
    const dz = -hd - 0.04;
    for (const sg of [-1, 1]) box(sg * (g + 0.12), yF, dz, 0.24, dh + 0.22, 0.12, FRAME);
    box(0, yF + dh, dz, dw + 0.48, 0.22, 0.12, FRAME);
    for (const sx of [-dw / 2 - 0.55, dw / 2 + 0.55]) box(sx, yF + 2.3, dz - 0.04, 0.22, 0.34, 0.16, [0.95, 0.85, 0.6]);
    // Innen: Betonboden mit Markierungen, Decke, Werkbank, Regale, Reifen, Deckenleuchten
    box(0, yF - 0.06, 0, b.w - 2 * wt, 0.06, b.d - 2 * wt, [0.56, 0.56, 0.57]);
    for (const s of GARAGE_IN.slots) for (const sg of [-1, 1]) box(s.x + sg * 1.25, yF, s.z, 0.08, 0.005, 3.6, [0.86, 0.78, 0.3]);
    quadFacing(f, P(-hw + wt, yF + wallH - 0.04, -hd + wt), P(hw - wt, yF + wallH - 0.04, -hd + wt), P(hw - wt, yF + wallH - 0.04, hd - wt), P(-hw + wt, yF + wallH - 0.04, hd - wt), [0, -1, 0], shade(WOOD_L, 0.85));
    for (const lx of [-1.75, 1.75]) box(lx, yF + wallH - 0.1, 0, 0.16, 0.06, 2.4, [1, 0.97, 0.88]);
    const wb = hd - 0.62;
    box(0, yF, wb, 3.0, 0.88, 0.64, WOOD_D);
    box(0, yF + 0.88, wb, 3.1, 0.07, 0.7, WOOD_L);
    box(0, yF + 1.2, hd - wt - 0.03, 2.6, 0.9, 0.04, [0.33, 0.34, 0.36]);              // Lochwand für Werkzeug
    for (let k = 0; k < 7; k++) box(-1.1 + k * 0.36, yF + 1.35 + (k % 3) * 0.22, hd - wt - 0.08, 0.06, 0.28, 0.06, [0.75, 0.2 + (k % 2) * 0.4, 0.15]);
    for (const sg of [-1, 1]) {
      const sx = sg * (hw - 0.5);
      for (const lz of [0.05, 3.15]) box(sx, yF, lz, 0.4, 2.0, 0.06, FRAME);
      for (const yy of [0.35, 0.95, 1.55]) {
        box(sx, yF + yy, 1.6, 0.42, 0.05, 3.2, [0.36, 0.37, 0.4]);
        for (let k = 0; k < 3; k++) box(sx, yF + yy + 0.05, 0.6 + k * 0.95 + (sg > 0 ? 0.2 : 0), 0.34, 0.3, 0.42, k === 1 ? [0.75, 0.3, 0.18] : [0.62, 0.52, 0.36]);
      }
    }
    const tire = W(-hw + 0.75, -hd + 1.0);
    for (let k = 0; k < 4; k++) f.cylinder(tire[0], yF + k * 0.24, tire[1], 0.34, 0.34, 0.23, 12, 0.08, 0.08, 0.09);
    // Dach
    thatch(f, P, rng, { axis: 'x', half, eaveY, rise, t0: -hw - 1.0, t1: hw + 1.0, wallTopY: yF + wallH, wallHalf: hd, rot: b.rot }, WV);
    const t = rise * (1 - hd / half), apex = eaveY + rise;
    for (const sg of [-1, 1]) {
      f.triFace(P(sg * hw, yF + wallH, -hd), P(sg * hw, yF + wallH, hd), P(sg * hw, eaveY + t + 0.4, 0), ...WV(sg, 0, 0), WOOD[0], WOOD[1], WOOD[2]);
    }
    void apex;
    return;
  }

  // ---- Haupthaus: Holzsockel und -wände, Glasfront zum Meer, Balkon, steiles Strohdach mit Giebelverglasung ----
  const wallH = 4.5, half = hw + 1.5, rise = 6.2, eaveY = yF + wallH - rise * (1 - hw / half), ridgeY = eaveY + rise;
  // Seiten- und Rückwand
  box(-hw + 0.15, yF, 0, 0.3, wallH, b.d, WOOD);
  box(hw - 0.15, yF, 0, 0.3, wallH, b.d, WOOD);
  // Rückwand mit Türöffnung (die Tür selbst schwingt auf und liegt in world/homebase.js)
  const D = HOUSE.door, dg = D.w / 2 + 0.08, side = hw - dg;
  for (const sg of [-1, 1]) {
    box(sg * (dg + side / 2), yF, -hd + 0.15, side, wallH, 0.3, WOOD);
    battens(f, P, sg * (dg + 0.45), -hd, sg * hw, -hd, yF, wallH, 0, -1, 0.9, WOOD_D, b.rot);
    box(sg * (dg + 0.06), yF, -hd - 0.02, 0.14, D.h + 0.14, 0.36, WOOD_L);           // Türzarge
  }
  box(0, yF + D.h, -hd + 0.15, 2 * dg, wallH - D.h, 0.3, WOOD);
  box(0, yF + D.h, -hd - 0.02, 2 * dg + 0.26, 0.14, 0.36, WOOD_L);
  box(0, yF + D.h + 0.5, -hd - 0.12, 0.24, 0.3, 0.14, [0.95, 0.85, 0.6]);               // Außenleuchte über der Tür
  // Holzpodest mit Stufe vor der Tür
  const PO = HOUSE.porch;
  box(0, yB, -hd - PO.d / 2, PO.w, yF - yB, PO.d, WOOD_L);
  box(0, yB, -hd - PO.d - PO.step / 2, PO.w, yF - 0.2 - yB, PO.step, shade(WOOD_L, 0.92));
  for (let k = 1; k < 5; k++) box(0, yF, -hd - (PO.d * k) / 5, PO.w, 0.006, 0.03, WOOD_D);
  battens(f, P, hw, -hd, hw, hd, yF, wallH, 1, 0, 0.9, WOOD_D, b.rot);
  battens(f, P, -hw, -hd, -hw, hd, yF, wallH, -1, 0, 0.9, WOOD_D, b.rot);
  // Fenster in den Seitenwänden
  for (const sg of [-1, 1]) for (const lz of [-3.6, 1.2]) {
    box(sg * (hw + 0.03), yF + 1.0, lz, 0.1, 1.7, 2.4, FRAME);
    box(sg * (hw + 0.08), yF + 1.1, lz, 0.06, 1.5, 2.2, GLASS);
  }
  // Rückgiebel (Holz)
  f.triFace(P(-hw, yF + wallH, -hd), P(hw, yF + wallH, -hd), P(0, ridgeY - 0.35, -hd), ...WV(0, 0, -1), WOOD[0], WOOD[1], WOOD[2]);
  // Glasfront zum Meer (lokal +z): unten Schiebetüren zwischen Holzpfosten, oben Giebelverglasung
  const fz = hd - 0.05;
  box(0, yF, fz, b.w - 0.6, 3.15, 0.08, GLASS);
  for (const lx of [-hw + 0.2, -hw / 2, 0, hw / 2, hw - 0.2]) box(lx, yF, fz + 0.04, 0.34, 3.2, 0.34, WOOD_L);
  box(0, yF + 3.15, fz + 0.1, b.w, 0.4, 0.5, WOOD_L);                    // Querbalken
  box(0, yF + 0.9, fz + 0.14, b.w - 0.9, 0.05, 0.05, FRAME);
  // Balkon mit Glasbrüstung
  box(0, yF + 3.05, hd, b.w + 0.2, 0.22, 2.0, WOOD_L);
  box(0, yF + 3.27, hd + 1.9, b.w + 0.2, 0.06, 0.06, FRAME);
  box(0, yF + 3.27, hd + 1.93, b.w + 0.1, 1.0, 0.04, [0.55, 0.72, 0.78]);
  for (const lx of [-hw, -hw / 2, 0, hw / 2, hw]) box(lx, yF + 3.27, hd + 1.9, 0.07, 1.06, 0.07, FRAME);
  // Obergeschoss und Giebel verglast: Rechteck + Dreieck
  const gy0 = yF + 3.55, gy1 = yF + wallH, tip = ridgeY - 0.35;
  f.quadAuto(P(-hw, gy0, hd - 0.04), P(hw, gy0, hd - 0.04), P(hw, gy1, hd - 0.04), P(-hw, gy1, hd - 0.04), GLASS[0], GLASS[1], GLASS[2]);
  f.triFace(P(-hw, gy1, hd - 0.04), P(hw, gy1, hd - 0.04), P(0, tip, hd - 0.04), ...WV(0, 0, 1), GLASS[0] * 1.08, GLASS[1] * 1.08, GLASS[2] * 1.08);
  for (const lx of [-hw, -hw / 2, 0, hw / 2, hw]) {
    const top = lx === 0 ? tip : gy1 + (tip - gy1) * (1 - Math.abs(lx) / hw);
    box(lx, gy0, hd - 0.02, 0.12, top - gy0, 0.14, FRAME);
  }
  box(0, gy0, hd - 0.02, b.w, 0.1, 0.14, FRAME);
  box(0, gy1 - 0.05, hd - 0.02, b.w, 0.1, 0.14, FRAME);
  // Dach
  thatch(f, P, rng, { axis: 'z', half, eaveY, rise, t0: -hd - 1.2, t1: hd + 2.0, wallTopY: yF + wallH, wallHalf: hw, rot: b.rot }, WV);

  interior(f, box, P, W, b, yF, wallH, hw, hd);

  // ---- Terrasse zum Meer: Feuerschale, Sofa und Tisch ----
  const dy = (b.deckY ?? yF - 0.12) + 0.02;
  const fire = W(3.6, 11.0);
  f.cylinder(fire[0], dy, fire[1], 0.95, 0.75, 0.5, 10, 0.2, 0.17, 0.15);
  f.cylinder(fire[0], dy + 0.5, fire[1], 0.68, 0.68, 0.04, 10, 1.0, 0.5, 0.12);
  f.cone(fire[0], dy + 0.54, fire[1], 0.4, 0.55, 7, 1.0, 0.72, 0.2);
  box(-1.2, dy, 9.4, 3.0, 0.45, 1.0, [0.86, 0.8, 0.7]);
  box(-1.2, dy + 0.45, 9.0, 3.0, 0.5, 0.22, [0.82, 0.76, 0.66]);
  for (const lx of [-2.2, -1.2, -0.2]) box(lx, dy + 0.45, 9.55, 0.7, 0.2, 0.4, [0.95, 0.9, 0.8]);
  box(-1.2, dy, 11.0, 1.4, 0.4, 0.8, WOOD_D);
}
