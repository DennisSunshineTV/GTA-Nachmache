// Geometrie des Strandhauses (moderner Stil nach Bildvorlage): Anthrazit mit Holzlamellen, raumhohe Glasfront,
// Flachdach mit Dachterrasse, warme LED-Bänder, Wandbild mit Palme, Terrasse mit Sofa, Liegen, Sonnenschirm und
// Feuerschale, dunkler Dielenboden mit LED-Kanten, Pollerleuchten und Pflanzkübeln. Teile werden von addBuilding
// aufgerufen, der Holzboden vom Chunk-Aufbau (render/detail.js).
// Eigene Netze: led (leuchtet, abends stärker), glow (Lichtschein, additiv), bglass (klares Glas), leaf (angestrahlte
// Blätter), hDeck (dunkles Holz, seidig).
import { mulberry32 } from '../util.js';
import { SignList } from '../world/signs.js';
import { HOUSE, GARAGE_IN } from '../world/beachhouse.js';

const ANTH = [0.205, 0.205, 0.222], ANTH_L = [0.32, 0.31, 0.31], FRAME = [0.1, 0.1, 0.11];
const SLAT = [0.82, 0.59, 0.41];                       // Holzlamellen (Tönung der Holztextur)
const DECKC = [0.72, 0.5, 0.35];                       // Dielen (Tönung der Holztextur, warmer Nussbaumton)
const LED = [1.0, 0.72, 0.4], LED_HOT = [1.0, 0.84, 0.6], PANE = [0.36, 0.24, 0.13];
const GLOW = [1.0, 0.6, 0.26];
const CREAM = [0.88, 0.84, 0.76], CREAM_D = [0.76, 0.71, 0.63];
const STONE = [0.72, 0.68, 0.61], PEBBLE = [0.86, 0.84, 0.79];
const WOOD_D = [0.3, 0.2, 0.14], WOOD = [0.45, 0.31, 0.2];

export const DECK_LIFT = 0.07;   // Oberkante der Dielen über dem Gelände
const BOARD = 0.17, BGAP = 0.012;

// Viereck mit Normale in Richtung h (Windung wird passend gewählt)
function quadFacing(mb, a, b, c, d, h, col, uv = [0, 0, 1, 1]) {
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
  const vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * h[0] + ny * h[1] + nz * h[2] >= 0) mb.quadAuto(a, b, c, d, col[0], col[1], col[2], uv[0], uv[1], uv[2], uv[3]);
  else mb.quadAuto(d, c, b, a, col[0], col[1], col[2], uv[0], uv[3], uv[2], uv[1]);
}
const hash2 = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// Werkzeugkasten mit lokalen Koordinaten (Ursprung ox/oz, Drehung rot; Konvention wie bei Gebäuden)
function kit(ox, oz, rot, B) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const W = (lx, lz) => [ox + c * lx + s * lz, oz - s * lx + c * lz];
  const P = (lx, y, lz) => { const q = W(lx, lz); return [q[0], y, q[1]]; };
  const D = (lx, ly, lz) => [c * lx + s * lz, ly, -s * lx + c * lz];                    // Richtungsvektor
  const k = { W, P, D, B, rot };
  k.box = (mb, lx, y0, lz, sx, sy, sz, col, opts, ang = 0) => { const q = W(lx, lz); mb.box(q[0], y0, q[1], sx, sy, sz, rot + ang, col[0], col[1], col[2], opts); };
  k.cyl = (mb, lx, y0, lz, r0, r1, h, seg, col) => { const q = W(lx, lz); mb.cylinder(q[0], y0, q[1], r0, r1, h, seg, col[0], col[1], col[2]); };
  // Leuchtfläche (LED-Band, Fensterlicht): Viereck aus lokalen Punkten [lx, y, lz] mit Blickrichtung dir
  k.led = (pts, dir, col = LED) => quadFacing(B.led, P(...pts[0]), P(...pts[1]), P(...pts[2]), P(...pts[3]), D(...dir), col);
  // waagerechtes LED-Band von a nach b (Breite w), oben (up=1) oder unten (up=-1) sichtbar
  k.strip = (ax, az, bx, bz, y, w, up = 1, col = LED) => {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * w / 2, nz = (dx / l) * w / 2;
    k.led([[ax + nx, y, az + nz], [bx + nx, y, bz + nz], [bx - nx, y, bz - nz], [ax - nx, y, az - nz]], [0, up, 0], col);
  };
  // Band auf einer senkrechten Fläche: von (ax,az) nach (bx,bz), Höhe y0..y1, sichtbar Richtung (nx,nz)
  k.band = (ax, az, bx, bz, y0, y1, nx, nz, col = LED) => k.led([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [nx, 0, nz], col);
  // weicher Lichtschein auf dem Boden (Mittelpunkt, halbe Ausdehnung)
  k.glow = (lx, y, lz, rx, rz, col = GLOW) => B.glow.quadUp(P(lx - rx, y, lz - rz), P(lx + rx, y, lz - rz), P(lx + rx, y, lz + rz), P(lx - rx, y, lz + rz), col[0], col[1], col[2], 0, 0, 1, 1);
  // gleichmäßiger Schein entlang eines Bandes (Verlauf nur quer)
  k.glowLine = (a0, a1, b1, b0, col = GLOW) => B.glow.quadUp(a0, a1, b1, b0, col[0], col[1], col[2], 0.5, 0, 0.5, 1);
  // Lichtkegel an einer senkrechten Fläche bzw. einem Stamm: unten hell, nach oben auslaufend
  k.glowUp = (lx, y0, lz, w, h, nx, nz, col = GLOW) => {
    const tx = -nz * w / 2, tz = nx * w / 2;
    quadFacing(B.glow, P(lx - tx, y0, lz - tz), P(lx + tx, y0, lz + tz), P(lx + tx, y0 + h, lz + tz), P(lx - tx, y0 + h, lz - tz), D(nx, 0, nz), col, [0, 0.5, 1, 1]);
  };
  // Pflanze mit geschwungenen Blättern (Palmwedel/Farn), von unten angestrahlt (uv.y = Höhe im Blatt)
  k.plant = (lx, y, lz, R, H, n, seed) => {
    const rng = mulberry32(seed || 5);
    n = Math.round(n * 1.55);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.6, reach = R * (0.6 + rng() * 0.6), height = H * (0.55 + rng() * 0.75), wMax = 0.038 + rng() * 0.034;
      const g = 0.85 + rng() * 0.3, col = [0.27 * g, 0.5 * g, 0.16 * g];
      const ca = Math.cos(a), sa = Math.sin(a);
      let prev = null;
      for (let q = 0; q <= 6; q++) {
        const t = q / 6, r = reach * t, yy = y + height * (2.2 * t - 1.55 * t * t), w = wMax * Math.sin(Math.PI * Math.min(1, t * 0.92 + 0.05)) + 0.004;
        const cur = [P(lx + ca * r - sa * w, yy, lz + sa * r + ca * w), P(lx + ca * r + sa * w, yy, lz + sa * r - ca * w), t];
        if (prev) B.leaf.quadAuto(prev[0], prev[1], cur[1], cur[0], col[0], col[1], col[2], 0, prev[2], 1, cur[2]);
        prev = cur;
      }
    }
  };
  // Pflanzkübel aus hellem Stein mit Kieseln, Pflanze und Lichtschein
  k.planter = (lx, y, lz, sx, sz, h, ang, pr, ph, seed) => {
    k.box(B.flat, lx, y, lz, sx, h, sz, STONE, undefined, ang);
    const rng = mulberry32((seed || 3) * 13);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const n = Math.round(sx * sz * 22);
    for (let i = 0; i < n; i++) {
      const u = (rng() - 0.5) * (sx - 0.14), v = (rng() - 0.5) * (sz - 0.14);
      k.box(B.flat, lx + ca * u + sa * v, y + h - 0.015, lz - sa * u + ca * v, 0.07 + rng() * 0.05, 0.05, 0.06 + rng() * 0.04, PEBBLE, undefined, rng() * 3);
    }
    k.plant(lx, y + h - 0.02, lz, pr, ph, 14, seed);
    k.glow(lx, y + 0.014, lz, Math.max(sx, sz) * 0.5 + 0.6, Math.max(sx, sz) * 0.5 + 0.6, [0.75, 0.52, 0.2]);
    k.glowUp(lx, y + h - 0.05, lz, pr * 1.5, ph * 0.9, 0, 1, [0.4, 0.3, 0.1]);
  };
  // Pollerleuchte
  k.bollard = (lx, y, lz) => {
    k.box(B.flat, lx, y - 0.1, lz, 0.19, 0.66, 0.19, ANTH);
    k.box(B.led, lx, y + 0.56, lz, 0.165, 0.15, 0.165, LED_HOT, { shade: false, noTop: true });
    k.box(B.flat, lx, y + 0.71, lz, 0.21, 0.06, 0.21, ANTH);
    k.glow(lx, y + 0.016, lz, 1.15, 1.15, [0.85, 0.52, 0.2]);
  };
  // senkrechte Holzlamellen auf einer Wand: von (ax,az) nach (bx,bz), nach außen (nx,nz)
  k.slats = (ax, az, bx, bz, y0, h, nx, nz) => {
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.15) return;
    const n = Math.max(1, Math.round(len / 0.17));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, lx = ax + (bx - ax) * t + nx * 0.04, lz = az + (bz - az) * t + nz * 0.04;
      const tint = 0.88 + hash2(i, Math.round((ax + az) * 10)) * 0.2;
      k.box(B.hWood, lx, y0, lz, Math.abs(nz) > 0.5 ? 0.085 : 0.07, h, Math.abs(nz) > 0.5 ? 0.07 : 0.085, [SLAT[0] * tint, SLAT[1] * tint, SLAT[2] * tint]);
    }
  };
  // geneigte Platte von (z0, y0) nach (z1, y1), Breite w (quer), Dicke t
  k.slab = (mb, lx, y0, z0, y1, z1, w, t, col) => {
    const dz = z1 - z0, dy = y1 - y0, l = Math.hypot(dz, dy) || 1, oz = (dy / l) * t, oy = (-dz / l) * t;   // Normale zur Oberseite (nach hinten oben)
    const sgn = oy < 0 ? -1 : 1;
    const V = (x, y, z) => k.P(x, y, z);
    const a = [lx - w / 2, y0, z0], b2 = [lx + w / 2, y0, z0], c2 = [lx + w / 2, y1, z1], d = [lx - w / 2, y1, z1];
    const up = (p) => [p[0], p[1] + oy * sgn, p[2] + oz * sgn];
    const face = (p1, p2, p3, p4, dir) => quadFacing(mb, V(...p1), V(...p2), V(...p3), V(...p4), k.D(...dir), col);
    face(up(a), up(b2), up(c2), up(d), [0, oy * sgn, oz * sgn]);
    face(a, b2, c2, d, [0, -oy * sgn, -oz * sgn]);
    face(a, d, up(d), up(a), [-1, 0, 0]); face(b2, c2, up(c2), up(b2), [1, 0, 0]);
    face(d, c2, up(c2), up(d), [0, dy, dz]); face(a, b2, up(b2), up(a), [0, -dy, -dz]);
  };
  return k;
}

// Ringleuchte (leuchtender Kreis an dünnen Seilen)
function ringLamp(k, lx, y, lz, R, ceil) {
  const N = 30;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const p = (a, r, yy) => [lx + Math.cos(a) * r, yy, lz + Math.sin(a) * r];
    const am = (a0 + a1) / 2;
    k.led([p(a0, R, y), p(a1, R, y), p(a1, R + 0.1, y), p(a0, R + 0.1, y)], [0, -1, 0], LED_HOT);
    k.led([p(a0, R + 0.1, y), p(a1, R + 0.1, y), p(a1, R + 0.1, y + 0.06), p(a0, R + 0.1, y + 0.06)], [Math.cos(am), 0, Math.sin(am)], LED_HOT);
    k.led([p(a0, R, y), p(a1, R, y), p(a1, R, y + 0.06), p(a0, R, y + 0.06)], [-Math.cos(am), 0, -Math.sin(am)], LED_HOT);
  }
  for (const a of [0.5, 2.6, 4.7]) k.cyl(k.B.flat, lx + Math.cos(a) * (R + 0.05), y + 0.06, lz + Math.sin(a) * (R + 0.05), 0.008, 0.008, ceil - y - 0.06, 4, FRAME);
}

// Einrichtung des Haupthauses (lokal: +z Glasfront zum Meer, −z Rückwand mit Haustür). Maße passen zu den
// Möbel-Kollidern in world/beachhouse.js (MAIN_COLLIDERS).
function interior(k, b, yF, wallH, hw, hd) {
  const iw = hw - 0.3, id = hd - 0.3, f = k.B.flat;
  const box = (lx, y0, lz, sx, sy, sz, col) => k.box(f, lx, y0, lz, sx, sy, sz, col);
  const cyl = (lx, lz, y, r0, r1, h, seg, r, g, bl) => k.cyl(f, lx, y, lz, r0, r1, h, seg, [r, g, bl]);
  // Dielenboden und Decke
  box(0, yF - 0.04, 0.1, 2 * iw, 0.04, 2 * id + 0.2, [0.5, 0.35, 0.23]);
  for (let lx = -iw + 0.45; lx < iw; lx += 0.45) box(lx, yF, 0.1, 0.02, 0.004, 2 * id + 0.2, [0.34, 0.23, 0.15]);
  quadFacing(f, k.P(-iw, yF + wallH - 0.06, -id), k.P(iw, yF + wallH - 0.06, -id), k.P(iw, yF + wallH - 0.06, hd - 0.1), k.P(-iw, yF + wallH - 0.06, hd - 0.1), [0, -1, 0], [0.9, 0.85, 0.76]);
  // helle Wandflächen innen (Seiten- und Rückwand ohne Türöffnung)
  const WALL = [0.84, 0.78, 0.68], dg = HOUSE.door.w / 2 + 0.08;
  for (const sg of [-1, 1]) {
    quadFacing(f, k.P(sg * (iw - 0.006), yF, -id), k.P(sg * (iw - 0.006), yF, hd - 0.12), k.P(sg * (iw - 0.006), yF + wallH - 0.06, hd - 0.12), k.P(sg * (iw - 0.006), yF + wallH - 0.06, -id), k.D(-sg, 0, 0), WALL);
    quadFacing(f, k.P(sg * dg, yF, -id + 0.006), k.P(sg * iw, yF, -id + 0.006), k.P(sg * iw, yF + wallH - 0.06, -id + 0.006), k.P(sg * dg, yF + wallH - 0.06, -id + 0.006), k.D(0, 0, 1), WALL);
    for (const lz of [-3.6, 1.2]) { for (const o of [-1.12, -0.37, 0.37, 1.12]) box(sg * (iw - 0.025), yF + 1.05, lz + o, 0.03, 1.6, 0.05, FRAME); for (const yy of [1.05, 2.6]) box(sg * (iw - 0.025), yF + yy, lz, 0.03, 0.05, 2.3, FRAME); }
  }
  quadFacing(f, k.P(-dg, yF + HOUSE.door.h, -id + 0.006), k.P(dg, yF + HOUSE.door.h, -id + 0.006), k.P(dg, yF + wallH - 0.06, -id + 0.006), k.P(-dg, yF + wallH - 0.06, -id + 0.006), k.D(0, 0, 1), WALL);
  // Lichtfugen an Decke und Wänden, Ringleuchten im Wohnbereich
  for (const lz of [-3, 0.5]) k.strip(-iw + 0.2, lz, iw - 0.2, lz, yF + wallH - 0.07, 0.08, -1);
  for (const sg of [-1, 1]) k.band(sg * (iw - 0.012), -id + 0.2, sg * (iw - 0.012), hd - 0.5, yF + wallH - 0.34, yF + wallH - 0.28, -sg, 0);
  ringLamp(k, -2.3, yF + 3.35, 3.1, 0.78, yF + wallH - 0.06);
  ringLamp(k, 2.4, yF + 3.55, 2.4, 0.6, yF + wallH - 0.06);
  // Innenseiten der Seitenfenster (warm erleuchtet)
  for (const sg of [-1, 1]) for (const lz of [-3.6, 1.2]) k.band(sg * (iw - 0.015), lz - 1.1, sg * (iw - 0.015), lz + 1.1, yF + 1.1, yF + 2.6, -sg, 0, PANE);
  // Schlafbereich: Doppelbett mit Kopfteil, Nachttisch mit Lampe, Kleiderschrank
  const bd = HOUSE.bed;
  box(bd.x, yF, bd.z, 2.3, 0.32, 1.9, WOOD_D);
  box(bd.x + 0.05, yF + 0.32, bd.z, 2.15, 0.24, 1.8, [0.95, 0.94, 0.9]);
  box(bd.x + 0.45, yF + 0.57, bd.z, 1.3, 0.05, 1.84, [0.2, 0.36, 0.42]);                   // Decke
  for (const sz of [-0.45, 0.45]) box(bd.x - 0.8, yF + 0.56, bd.z + sz, 0.45, 0.16, 0.75, [1, 1, 0.97]);
  box(-iw + 0.06, yF, bd.z, 0.12, 1.25, 2.1, ANTH);
  k.band(-iw + 0.125, bd.z - 1.0, -iw + 0.125, bd.z + 1.0, yF + 1.18, yF + 1.23, 1, 0);
  box(-4.75, yF, -4.65, 0.5, 0.55, 0.5, WOOD);
  cyl(-4.75, -4.65, yF + 0.55, 0.08, 0.08, 0.3, 8, 0.2, 0.2, 0.2);
  k.cyl(k.B.led, -4.75, yF + 0.82, -4.65, 0.2, 0.12, 0.24, 10, LED_HOT);
  box(-3.6, yF, -5.85, 2.2, 2.3, 0.62, ANTH_L);
  box(-3.6, yF + 0.05, -5.52, 0.02, 2.2, 0.03, FRAME);
  for (const sx of [-0.12, 0.12]) box(-3.6 + sx, yF + 1.1, -5.51, 0.03, 0.3, 0.03, [0.75, 0.6, 0.35]);
  // Küche an der rechten Wand: Zeile mit Arbeitsplatte, Kochfeld, Spüle, Kühlschrank, Hängeregal
  box(4.8, yF, -3.35, 0.8, 0.88, 3.7, ANTH_L);
  box(4.78, yF + 0.88, -3.35, 0.86, 0.06, 3.74, [0.85, 0.83, 0.78]);
  box(4.75, yF + 0.94, -2.3, 0.56, 0.01, 0.62, [0.08, 0.08, 0.09]);
  box(4.75, yF + 0.9, -4.1, 0.5, 0.05, 0.5, [0.7, 0.72, 0.75]);
  for (let q = 0; q < 4; q++) box(4.39, yF + 0.1, -4.9 + q * 0.92, 0.02, 0.7, 0.86, [0.2, 0.2, 0.21]);
  k.band(4.385, -5.2, 4.385, -1.5, yF + 0.82, yF + 0.85, -1, 0);
  box(4.8, yF, -5.75, 0.84, 2.0, 0.84, [0.55, 0.57, 0.6]);
  box(4.37, yF + 0.9, -5.4, 0.03, 0.5, 0.04, FRAME);
  box(5.0, yF + 1.65, -3.35, 0.36, 0.04, 2.4, WOOD);
  k.strip(4.9, -4.5, 4.9, -2.2, yF + 1.645, 0.05, -1);
  for (let q = 0; q < 5; q++) box(5.0, yF + 1.69, -4.3 + q * 0.45, 0.2, 0.22 + (q % 2) * 0.08, 0.2, q % 2 ? CREAM : [0.2, 0.34, 0.42]);
  // Esstisch mit vier Stühlen
  box(2.0, yF, -0.4, 1.6, 0.74, 0.9, WOOD_D);
  box(2.0, yF + 0.74, -0.4, 1.7, 0.05, 1.0, WOOD);
  for (const [cx, cz] of [[1.55, -1.15], [2.45, -1.15], [1.55, 0.35], [2.45, 0.35]]) {
    box(cx, yF, cz, 0.44, 0.46, 0.44, CREAM_D);
    box(cx, yF + 0.46, cz + (cz < -0.4 ? -0.19 : 0.19), 0.44, 0.5, 0.06, CREAM_D);
  }
  // Wohnbereich vor der Glasfront: Teppich, Sofa mit Blick aufs Meer, Sessel, Couchtisch, Leuchte, Pflanzen
  box(-1.6, yF, 3.4, 3.8, 0.012, 2.8, [0.46, 0.42, 0.37]);
  box(-1.6, yF, 2.45, 3.0, 0.42, 0.95, CREAM_D);
  box(-1.6, yF, 2.03, 3.0, 0.88, 0.2, CREAM_D);
  for (const sx of [-1.45, 1.45]) box(-1.6 + sx, yF, 2.45, 0.2, 0.62, 0.95, CREAM_D);
  for (const sx of [-0.68, 0.68]) box(-1.6 + sx, yF + 0.42, 2.5, 1.3, 0.12, 0.8, CREAM);
  for (const sx of [-1.0, 0.1, 1.0]) box(-1.6 + sx, yF + 0.5, 2.18, 0.5, 0.42, 0.14, [0.78, 0.5, 0.28]);
  box(-3.55, yF, 3.45, 0.95, 0.42, 1.2, CREAM_D);
  box(-3.95, yF, 3.45, 0.2, 0.85, 1.2, CREAM_D);
  box(-3.5, yF + 0.42, 3.45, 0.8, 0.12, 1.0, CREAM);
  box(-1.6, yF, 3.95, 1.3, 0.36, 0.7, ANTH);
  box(-1.6, yF + 0.36, 3.95, 1.36, 0.05, 0.76, WOOD);
  k.box(k.B.led, -1.35, yF + 0.41, 3.95, 0.14, 0.2, 0.14, LED_HOT, { shade: false });
  cyl(-3.9, 2.05, yF, 0.03, 0.03, 1.6, 6, 0.15, 0.15, 0.16);
  k.cyl(k.B.led, -3.9, yF + 1.45, 2.05, 0.3, 0.18, 0.32, 12, LED_HOT);
  for (const [px, pz, s] of [[4.6, 5.8, 1], [-4.7, 5.8, 0.85], [4.6, 1.4, 0.7]]) {
    cyl(px, pz, yF, 0.26 * s, 0.2 * s, 0.45 * s, 10, 0.2, 0.2, 0.21);
    k.plant(px, yF + 0.43 * s, pz, 0.55 * s, 1.0 * s, 13, Math.round(px * 7 + pz * 3));
  }
  // Bild an der Rückwand mit Lichtleiste
  box(2.6, yF + 1.4, -id - 0.02, 1.6, 1.0, 0.04, FRAME);
  box(2.6, yF + 1.46, -id + 0.0, 1.46, 0.88, 0.02, [0.95, 0.55, 0.35]);
  box(2.6, yF + 1.46, -id + 0.01, 1.46, 0.36, 0.02, [0.2, 0.5, 0.68]);
  k.band(1.8, -id + 0.03, 3.4, -id + 0.03, yF + 2.45, yF + 2.49, 0, 1);
  const lamp = [0, 0.5];
  k.cyl(f, lamp[0], yF + wallH - 0.7, lamp[1], 0.02, 0.02, 0.65, 6, FRAME);
  k.cyl(k.B.led, lamp[0], yF + wallH - 0.95, lamp[1], 0.4, 0.2, 0.26, 14, LED_HOT);
}

// Terrasse zum Meer: Sofa-Ecke, Couchtisch mit Laterne, Liegen, großer Sonnenschirm, Feuerschale, Kübel, Wandbild
function terrace(k, dy, yF, stairs, fz0) {
  const f = k.B.flat;
  let shift = fz0;                                    // Möbel hinter den Stufen (Kübel und Wandbild bleiben an der Hauswand)
  const box = (lx, y0, lz, sx, sy, sz, col, ang) => k.box(f, lx, y0, lz + shift, sx, sy, sz, col, undefined, ang);
  // breite Stufen von der Terrasse hinauf zur Glasfront, mit Lichtkanten
  if (stairs) {
    const x0 = -4.35, x1 = 3.9, cx = (x0 + x1) / 2, front = 6.55;
    for (let j = 1; j < stairs.n; j++) {
      const top = dy + j * stairs.rise, d = (stairs.n - j) * 0.3;
      k.box(k.B.hDeck, cx, dy - 0.15, front + d / 2, x1 - x0, top - dy + 0.15, d, [DECKC[0] * (1 - j * 0.015), DECKC[1] * (1 - j * 0.015), DECKC[2]]);
      k.band(x0 + 0.05, front + d + 0.004, x1 - 0.05, front + d + 0.004, top - 0.06, top - 0.025, 0, 1);
    }
    k.band(x0 + 0.05, front + 0.004, x1 - 0.05, front + 0.004, yF - 0.06, yF - 0.025, 0, 1);
    k.glow(cx, dy + 0.02, front + (stairs.n - 1) * 0.3 + 0.35, (x1 - x0) / 2 + 0.2, 0.55, [0.75, 0.46, 0.18]);
  }
  // Eck-Sofa (Lehne zur Glasfront, Blick aufs Meer)
  box(1.5, dy, 7.9, 3.8, 0.16, 1.0, ANTH);
  box(2.9, dy, 8.95, 1.0, 0.16, 1.1, ANTH);
  k.strip(-0.35, 8.42 + shift, 2.35, 8.42 + shift, dy + 0.02, 0.05);
  for (let i = 0; i < 4; i++) {
    const x = -0.4 + 0.475 + i * 0.95;
    box(x, dy + 0.16, 7.97, 0.92, 0.26, 0.86, CREAM);
    box(x, dy + 0.42, 7.55, 0.88, 0.42, 0.22, CREAM);
  }
  box(2.9, dy + 0.16, 8.96, 0.96, 0.26, 1.08, CREAM);
  box(3.46, dy + 0.16, 8.45, 0.18, 0.52, 2.1, CREAM_D);
  box(-0.46, dy + 0.16, 7.9, 0.16, 0.46, 0.98, CREAM_D);
  for (const [x, z, a] of [[-0.05, 7.76, 0.25], [1.2, 7.74, -0.18], [2.9, 7.76, 0.1]]) box(x, dy + 0.44, z, 0.46, 0.38, 0.16, [0.8, 0.66, 0.48], a);
  // Couchtisch mit Lichtfuge, Laterne und Pflanze
  box(0.8, dy + 0.04, 9.5, 1.5, 0.08, 0.82, FRAME);
  box(0.8, dy + 0.12, 9.5, 1.65, 0.3, 0.95, WOOD_D);
  k.strip(0.05, 9.99 + shift, 1.55, 9.99 + shift, dy + 0.11, 0.04);
  box(1.25, dy + 0.42, 9.5, 0.24, 0.03, 0.24, FRAME);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(1.25 + sx * 0.1, dy + 0.45, 9.5 + sz * 0.1, 0.025, 0.34, 0.025, FRAME);
  box(1.25, dy + 0.79, 9.5, 0.26, 0.05, 0.26, FRAME);
  k.box(k.B.led, 1.25, dy + 0.46, 9.5 + shift, 0.1, 0.22, 0.1, LED_HOT, { shade: false });
  k.cyl(f, 0.4, dy + 0.42, 9.5 + shift, 0.1, 0.13, 0.17, 10, [0.9, 0.88, 0.84]);
  k.plant(0.4, dy + 0.57, 9.5 + shift, 0.28, 0.34, 11, 91);
  k.glow(1.25, dy + 0.43, 9.5 + shift, 0.7, 0.45, [0.8, 0.5, 0.2]);
  // zwei Liegen mit schrägem Kopfteil (Fußende zum Meer)
  for (const [lx, lz] of [[-3.0, 10.7], [-5.3, 10.9]]) {
    for (const [ex, ez] of [[-0.36, -0.9], [0.36, -0.9], [-0.36, 0.9], [0.36, 0.9]]) box(lx + ex, dy, lz + ez, 0.06, 0.26, 0.06, ANTH);
    box(lx, dy + 0.24, lz, 0.82, 0.07, 1.95, ANTH);
    box(lx, dy + 0.31, lz + 0.28, 0.76, 0.13, 1.36, CREAM);
    // schräge Rückenlehne mit Nackenrolle
    k.slab(f, lx, dy + 0.31, lz - 0.38 + shift, dy + 0.8, lz - 0.98 + shift, 0.76, 0.13, CREAM);
    k.slab(f, lx, dy + 0.78, lz - 0.86 + shift, dy + 0.9, lz - 1.01 + shift, 0.5, 0.12, CREAM_D);
  }
  // großer Sonnenschirm
  const px = -1.9, pz = 10.4, ph = 2.75, r = 1.85;
  box(px, dy, pz, 0.55, 0.05, 0.55, ANTH);
  k.cyl(f, px, dy, pz + shift, 0.04, 0.04, ph + 0.28, 8, [0.3, 0.3, 0.32]);
  const corner = [[-r, -r], [0, -r * 1.08], [r, -r], [r * 1.08, 0], [r, r], [0, r * 1.08], [-r, r], [-r * 1.08, 0]];
  for (let i = 0; i < 8; i++) {
    const a = corner[i], c = corner[(i + 1) % 8];
    const zz = pz + shift, A = k.P(px + a[0], dy + ph - 0.32, zz + a[1]), C = k.P(px + c[0], dy + ph - 0.32, zz + c[1]), T = k.P(px, dy + ph + 0.28, zz);
    f.triUp(A, C, T, 0.94, 0.92, 0.87);
    f.triFace(A, C, T, 0, -1, 0, 0.72, 0.68, 0.6);
  }
  k.box(k.B.led, px, dy + ph - 0.36, pz + shift, 0.2, 0.07, 0.2, LED_HOT, { shade: false });
  k.glow(px, dy + 0.02, pz + shift, 1.7, 1.7, [0.4, 0.27, 0.12]);
  // Feuerschale mit Kieselring
  const fx = 5.4, fz = 11.2, fzs = fz + shift;
  k.cyl(f, fx, dy, fzs, 0.98, 0.92, 0.44, 22, ANTH);
  k.cyl(f, fx, dy + 0.44, fzs, 0.76, 0.76, 0.03, 22, [0.07, 0.05, 0.04]);
  for (let i = 0; i < 46; i++) { const a = (i / 46) * Math.PI * 2, rr = 1.14 + hash2(i, 5) * 0.17; box(fx + Math.cos(a) * rr, dy, fz + Math.sin(a) * rr, 0.1 + hash2(i, 9) * 0.07, 0.07, 0.09, PEBBLE, a); }
  for (let i = 0; i < 6; i++) { const a = i * 1.05; box(fx + Math.cos(a) * 0.3, dy + 0.47, fz + Math.sin(a) * 0.3, 0.5, 0.09, 0.1, [0.18, 0.1, 0.05], -a); }
  for (const [ox, oz, s, col] of [[0, 0, 1, [1.0, 0.5, 0.08]], [0.22, 0.12, 0.7, [1.0, 0.62, 0.12]], [-0.2, -0.1, 0.62, [1.0, 0.75, 0.25]], [-0.05, 0.24, 0.5, [1.0, 0.4, 0.05]], [0.14, -0.22, 0.45, [1.0, 0.82, 0.35]]]) k.cyl(k.B.led, fx + ox, dy + 0.46, fzs + oz, 0.17 * s, 0.001, 0.62 * s, 7, col);
  k.strip(fx - 0.72, fzs, fx + 0.72, fzs, dy + 0.475, 1.1, 1, [0.55, 0.16, 0.03]);
  k.glow(fx, dy + 0.025, fzs, 3.1, 3.1, [0.85, 0.4, 0.12]);
  k.glowUp(fx, dy + 0.4, fzs, 1.8, 1.7, 0, 1, [0.7, 0.34, 0.08]);
  shift = 0;
  // Kübel an der Glasfront
  k.planter(-5.0, dy, 7.25, 0.9, 0.9, 0.78, 0, 0.85, 1.25, 11);
  k.planter(4.62, dy, 7.25, 0.9, 0.9, 0.78, 0, 0.85, 1.25, 23);
  k.planter(8.0, dy, 7.75, 0.62, 0.62, 0.62, 0, 0.55, 0.85, 37);
  // Wandbild: helle Fläche mit Lichtrahmen und leuchtender Palme, rechts Lamellen
  const wz = 6.9, front = wz + 0.14;
  box(7.07, dy - 0.2, wz, 2.7, 3.25, 0.26, ANTH);
  quadFacing(f, k.P(5.84, dy + 0.12, front - 0.004), k.P(7.78, dy + 0.12, front - 0.004), k.P(7.78, dy + 2.86, front - 0.004), k.P(5.84, dy + 2.86, front - 0.004), k.D(0, 0, 1), [0.9, 0.82, 0.68]);
  for (const x of [5.86, 7.76]) k.band(x - 0.025, front, x + 0.025, front, dy + 0.12, dy + 2.86, 0, 1);
  k.band(5.84, front, 7.78, front, dy + 2.84, dy + 2.89, 0, 1);
  k.band(5.84, front, 7.78, front, dy + 0.1, dy + 0.15, 0, 1);
  k.slats(7.85, wz + 0.12, 8.4, wz + 0.12, dy, 3.0, 0, 1);
  const logoZ = front + 0.006, cxl = 6.78;
  const leafQ = (pts) => k.led(pts.map((p) => [p[0], p[1], logoZ]), [0, 0, 1], LED_HOT);
  for (let i = 0; i < 6; i++) { const t0 = i / 6, t1 = (i + 1) / 6, x = (t) => cxl + 0.1 * (1 - t) * (1 - t) - 0.01, y = (t) => dy + 0.95 + t * 0.85, w = (t) => 0.055 - t * 0.018; leafQ([[x(t0) - w(t0), y(t0)], [x(t0) + w(t0), y(t0)], [x(t1) + w(t1), y(t1)], [x(t1) - w(t1), y(t1)]]); }
  for (const a of [-0.25, 0.45, 1.15, 1.9, 2.65, 3.35]) {
    const L = 0.46, at = (t) => [cxl - 0.01 + Math.cos(a) * L * t, dy + 1.82 + Math.sin(a) * L * t - 0.26 * t * t];
    for (let i = 0; i < 5; i++) {
      const t0 = i / 5, t1 = (i + 1) / 5, p = at(t0), q = at(t1), w = (t) => 0.075 * Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.12)) * (1 - t * 0.35);
      const dx = q[0] - p[0], dyy = q[1] - p[1], l = Math.hypot(dx, dyy) || 1, nx = -dyy / l, ny = dx / l;
      leafQ([[p[0] + nx * w(t0), p[1] + ny * w(t0)], [p[0] - nx * w(t0), p[1] - ny * w(t0)], [q[0] - nx * w(t1), q[1] - ny * w(t1)], [q[0] + nx * w(t1), q[1] + ny * w(t1)]]);
    }
  }
  k.glow(6.8, dy + 0.02, 7.6, 1.8, 0.9, [0.75, 0.48, 0.2]);
}

export function addBeachPart(b, B) {
  const k = kit(b.x, b.z, b.rot, B);
  const f = B.flat;
  const yF = b.base + 0.12;
  const hw = b.w / 2, hd = b.d / 2;
  const box = (lx, y0, lz, sx, sy, sz, col, opts) => k.box(f, lx, y0, lz, sx, sy, sz, col, opts);
  const yB = b.y0 - 0.6;

  if (b.part === 'sign') {
    const [u0, v0, u1, v1] = SignList.uv(b.signIdx);
    for (const px of [-hw + 0.25, hw - 0.25]) box(px, yF - 0.6, 0, 0.16, 2.3, 0.16, ANTH);
    box(0, yF + 0.62, 0, b.w - 0.1, 1.0, 0.12, ANTH);
    for (const sg of [-1, 1]) {
      const sw = b.w - 0.5, sh = sw / 4, y0 = yF + 0.62 + (1.0 - sh) / 2, lz = sg * (0.06 + 0.012);
      const a = k.P(-sw / 2 * sg, y0, lz), bb = k.P(sw / 2 * sg, y0, lz), cc = k.P(sw / 2 * sg, y0 + sh, lz), dd = k.P(-sw / 2 * sg, y0 + sh, lz);
      const n = k.D(0, 0, sg);
      B.sign.quad(a, bb, cc, dd, n[0], 0, n[2], u0, v0, u1, v1, 1, 1, 1);
      k.band(-hw + 0.15, sg * 0.065, hw - 0.15, sg * 0.065, yF + 0.56, yF + 0.6, 0, sg);
    }
    k.glow(0, yF - 0.2, 0, 2.2, 1.1, [0.6, 0.38, 0.16]);
    return;
  }

  // Sockel bis zum Gelände (Haupthaus: dunkel, es steht zum Strand hin erhöht)
  box(0, yB, 0, b.w + 0.1, yF - yB - 0.01, b.d + 0.1, b.part === 'main' ? ANTH : ANTH_L, { noTop: true });

  if (b.part === 'garage') {
    const wallH = 3.15;
    const dw = GARAGE_IN.door.w, dh = GARAGE_IN.door.h, g = dw / 2, wt = 0.3;
    // Wände (hohl, vorn mit Toröffnung; das Tor selbst bewegt sich und liegt in world/homebase.js)
    box(-hw + wt / 2, yF, 0, wt, wallH, b.d, ANTH_L);
    box(hw - wt / 2, yF, 0, wt, wallH, b.d, ANTH_L);
    box(0, yF, hd - wt / 2, b.w, wallH, wt, ANTH_L);
    for (const sg of [-1, 1]) box(sg * (g + (hw - g) / 2), yF, -hd + wt / 2, hw - g, wallH, wt, ANTH_L);
    box(0, yF + dh, -hd + wt / 2, dw, wallH - dh, wt, ANTH_L);
    k.slats(-hw, hd, hw, hd, yF, wallH, 0, 1);
    k.slats(hw, -hd, hw, hd, yF, wallH, 1, 0);
    k.slats(-hw, -hd, -hw, hd, yF, wallH, -1, 0);
    for (const sg of [-1, 1]) k.slats(sg * (g + 0.75), -hd, sg * hw, -hd, yF, wallH, 0, -1);
    // Torrahmen und senkrechte Wandleuchten (Richtung Zufahrt: lokal −z)
    const dz = -hd - 0.04;
    for (const sg of [-1, 1]) box(sg * (g + 0.12), yF, dz, 0.24, dh + 0.22, 0.12, FRAME);
    box(0, yF + dh, dz, dw + 0.48, 0.22, 0.12, FRAME);
    for (const sx of [-dw / 2 - 0.5, dw / 2 + 0.5]) {
      box(sx, yF + 0.3, dz - 0.03, 0.2, 2.5, 0.1, ANTH);
      k.band(sx - 0.035, dz - 0.085, sx + 0.035, dz - 0.085, yF + 0.4, yF + 2.7, 0, -1);
      k.glow(sx, yF + 0.012, -hd - 0.7, 0.9, 0.9, [0.8, 0.5, 0.2]);
      k.glowUp(sx, yF + 0.2, dz - 0.1, 1.2, 2.6, 0, -1, [0.35, 0.22, 0.08]);
    }
    // Innen: Betonboden mit Markierungen, Decke, Werkbank, Regale, Reifen, Deckenleuchten
    box(0, yF - 0.06, 0, b.w - 2 * wt, 0.06, b.d - 2 * wt, [0.5, 0.5, 0.52]);
    for (const s of GARAGE_IN.slots) for (const sg of [-1, 1]) box(s.x + sg * 1.25, yF, s.z, 0.08, 0.005, 3.6, [0.86, 0.78, 0.3]);
    quadFacing(f, k.P(-hw + wt, yF + wallH - 0.04, -hd + wt), k.P(hw - wt, yF + wallH - 0.04, -hd + wt), k.P(hw - wt, yF + wallH - 0.04, hd - wt), k.P(-hw + wt, yF + wallH - 0.04, hd - wt), [0, -1, 0], [0.55, 0.54, 0.54]);
    for (const lx of [-1.75, 1.75]) k.box(B.led, lx, yF + wallH - 0.09, 0, 0.14, 0.05, 2.4, LED_HOT, { shade: false });
    const wb = hd - 0.62;
    box(0, yF, wb, 3.0, 0.88, 0.64, ANTH);
    box(0, yF + 0.88, wb, 3.1, 0.07, 0.7, WOOD);
    box(0, yF + 1.2, hd - wt - 0.03, 2.6, 0.9, 0.04, [0.33, 0.34, 0.36]);              // Lochwand für Werkzeug
    for (let q = 0; q < 7; q++) box(-1.1 + q * 0.36, yF + 1.35 + (q % 3) * 0.22, hd - wt - 0.08, 0.06, 0.28, 0.06, [0.75, 0.2 + (q % 2) * 0.4, 0.15]);
    for (const sg of [-1, 1]) {
      const sx = sg * (hw - 0.5);
      for (const lz of [0.05, 3.15]) box(sx, yF, lz, 0.4, 2.0, 0.06, FRAME);
      for (const yy of [0.35, 0.95, 1.55]) {
        box(sx, yF + yy, 1.6, 0.42, 0.05, 3.2, [0.36, 0.37, 0.4]);
        for (let q = 0; q < 3; q++) box(sx, yF + yy + 0.05, 0.6 + q * 0.95 + (sg > 0 ? 0.2 : 0), 0.34, 0.3, 0.42, q === 1 ? [0.75, 0.3, 0.18] : [0.62, 0.52, 0.36]);
      }
    }
    for (let q = 0; q < 4; q++) k.cyl(f, -hw + 0.75, yF + q * 0.24, -hd + 1.0, 0.34, 0.34, 0.23, 12, [0.08, 0.08, 0.09]);
    // Flachdach mit dunkler Blende und LED-Bändern
    const r0 = yF + wallH, r1 = r0 + 0.55, x0 = -hw - 0.5, x1 = hw + 0.5, z0 = -hd - 0.95, z1 = hd + 0.45;
    box(0, r0, (z0 + z1) / 2, x1 - x0, r1 - r0, z1 - z0, ANTH);
    k.strip(x0 + 0.2, z0 + 0.2, x1 - 0.2, z0 + 0.2, r0 - 0.004, 0.08, -1);
    k.band(x0 + 0.1, z0 - 0.004, x1 - 0.1, z0 - 0.004, r0 + 0.05, r0 + 0.1, 0, -1);
    for (const sg of [-1, 1]) k.strip(sg * (x1 - 0.2), z0 + 0.2, sg * (x1 - 0.2), z1 - 0.2, r0 - 0.004, 0.06, -1);
    return;
  }

  // ---- Haupthaus ----
  const wallH = 4.5;
  // Seitenwände und Rückwand mit Türöffnung (die Tür selbst schwingt auf und liegt in world/homebase.js)
  for (const sg of [-1, 1]) box(sg * (hw - 0.15), yF, 0, 0.3, wallH, b.d, ANTH_L);
  const Dr = HOUSE.door, dg = Dr.w / 2 + 0.08, side = hw - dg;
  for (const sg of [-1, 1]) {
    box(sg * (dg + side / 2), yF, -hd + 0.15, side, wallH, 0.3, ANTH_L);
    k.slats(sg * (dg + 0.42), -hd, sg * hw, -hd, yF, wallH, 0, -1);
    box(sg * (dg + 0.07), yF, -hd - 0.02, 0.16, Dr.h + 0.16, 0.36, FRAME);                      // Türzarge
    k.band(sg * (dg + 0.24) - 0.025, -hd - 0.05, sg * (dg + 0.24) + 0.025, -hd - 0.05, yF + 0.02, yF + Dr.h + 0.55, 0, -1);
  }
  box(0, yF + Dr.h, -hd + 0.15, 2 * dg, wallH - Dr.h, 0.3, ANTH_L);
  box(0, yF + Dr.h, -hd - 0.02, 2 * dg + 0.3, 0.16, 0.36, FRAME);
  k.band(-dg - 0.2, -hd - 0.21, dg + 0.2, -hd - 0.21, yF + Dr.h + 0.04, yF + Dr.h + 0.09, 0, -1);
  box(0, yF + Dr.h + 0.55, -hd - 0.1, 2 * dg + 0.5, 0.1, 0.22, ANTH);
  k.band(-dg - 0.2, -hd - 0.215, dg + 0.2, -hd - 0.215, yF + Dr.h + 0.57, yF + Dr.h + 0.62, 0, -1);
  k.glow(0, yF + 0.012, -hd - 1.0, 1.9, 1.2, [0.75, 0.48, 0.2]);
  // Holzpodest mit Stufe vor der Tür (Lichtkante an den Stufen)
  const PO = HOUSE.porch;
  k.box(B.hDeck, 0, yB, -hd - PO.d / 2, PO.w, yF - yB, PO.d, DECKC);
  k.box(B.hDeck, 0, yB, -hd - PO.d - PO.step / 2, PO.w, yF - 0.2 - yB, PO.step, [DECKC[0] * 0.9, DECKC[1] * 0.9, DECKC[2] * 0.9]);
  k.band(-PO.w / 2, -hd - PO.d - 0.004, PO.w / 2, -hd - PO.d - 0.004, yF - 0.09, yF - 0.055, 0, -1);
  k.band(-PO.w / 2, -hd - PO.d - PO.step - 0.004, PO.w / 2, -hd - PO.d - PO.step - 0.004, yF - 0.29, yF - 0.255, 0, -1);
  // Seitenwände: Holzlamellen zwischen raumhohen, warm erleuchteten Fenstern
  for (const sg of [-1, 1]) {
    let z = -hd;
    for (const lz of [-3.6, 1.2]) {
      k.slats(sg * hw, z, sg * hw, lz - 1.3, yF, wallH, sg, 0);
      box(sg * (hw + 0.02), yF + 0.45, lz, 0.1, 3.2, 2.6, FRAME);
      k.band(sg * (hw + 0.076), lz - 1.2, sg * (hw + 0.076), lz + 1.2, yF + 0.55, yF + 3.55, sg, 0, PANE);
      for (const o of [-0.4, 0.4]) box(sg * (hw + 0.09), yF + 0.5, lz + o, 0.04, 3.1, 0.05, FRAME);
      box(sg * (hw + 0.09), yF + 2.75, lz, 0.04, 0.05, 2.5, FRAME);
      z = lz + 1.3;
    }
    k.slats(sg * hw, z, sg * hw, hd - 0.28, yF, wallH, sg, 0);
    k.band(sg * (hw + 0.095), hd - 0.24, sg * (hw + 0.095), hd - 0.18, yF + 0.05, yF + 4.35, sg, 0);
    k.glow(sg * (hw + 0.7), yF - 0.55, -1.2, 1.1, 4.0, [0.4, 0.27, 0.12]);
  }
  // Glasfront zum Meer: raumhohe, klare Scheiben in schlanken dunklen Rahmen, dahinter das Wohnzimmer
  const fz = hd - 0.06;
  const xs = [-hw + 0.14, -2.7, 0, 2.7, hw - 0.14];
  for (let i = 0; i < 4; i++) quadFacing(B.bglass, k.P(xs[i], yF + 0.08, fz), k.P(xs[i + 1], yF + 0.08, fz), k.P(xs[i + 1], yF + 3.98, fz), k.P(xs[i], yF + 3.98, fz), k.D(0, 0, 1), [1, 1, 1]);
  for (const x of xs) box(x, yF, fz + 0.02, 0.13, 4.0, 0.16, FRAME);
  for (const x of [-0.75, 0.75]) box(x, yF, fz + 0.02, 0.07, 3.0, 0.12, FRAME);                 // Schiebetüren
  box(0, yF + 3.0, fz + 0.02, b.w - 0.2, 0.07, 0.12, FRAME);
  box(0, yF, fz + 0.02, b.w - 0.2, 0.09, 0.18, FRAME);
  box(0, yF + 3.97, fz + 0.02, b.w, 0.5, 0.2, ANTH);
  for (const x of [-hw + 0.05, hw - 0.05]) { box(x, yF, hd + 0.02, 0.22, 4.5, 0.18, ANTH); k.band(x - 0.03, hd + 0.115, x + 0.03, hd + 0.115, yF + 0.05, yF + 4.4, 0, 1); }
  k.strip(-hw + 0.3, hd + 0.2, hw - 0.3, hd + 0.2, yF + 0.004, 0.06);

  interior(k, b, yF, wallH, hw, hd);

  // Flachdach: breite dunkle Blende, weit vorgezogen zum Meer, LED-Bänder und Einbaustrahler in der Untersicht
  const r0 = yF + wallH - 0.05, r1 = r0 + 0.72, x0 = -hw - 0.9, x1 = hw + 0.9, z0 = -hd - 0.9, z1 = hd + 2.4;
  box(0, r0, (z0 + z1) / 2, x1 - x0, r1 - r0, z1 - z0, ANTH);
  k.strip(x0 + 0.22, z1 - 0.22, x1 - 0.22, z1 - 0.22, r0 - 0.004, 0.09, -1, LED_HOT);
  k.strip(x0 + 0.22, z0 + 0.22, x1 - 0.22, z0 + 0.22, r0 - 0.004, 0.07, -1);
  for (const x of [x0 + 0.22, x1 - 0.22]) k.strip(x, z0 + 0.22, x, z1 - 0.22, r0 - 0.004, 0.07, -1);
  k.band(x0 + 0.1, z1 + 0.004, x1 - 0.1, z1 + 0.004, r0 + 0.05, r0 + 0.11, 0, 1);
  k.band(x0 + 0.1, z0 - 0.004, x1 - 0.1, z0 - 0.004, r0 + 0.05, r0 + 0.09, 0, -1);
  for (const sg of [-1, 1]) k.band(sg * (x1 + 0.004), z0 + 0.1, sg * (x1 + 0.004), z1 - 0.1, r0 + 0.05, r0 + 0.1, sg, 0);
  for (let x = -5.2; x <= 5.21; x += 1.3) {
    k.strip(x - 0.07, hd + 1.25, x + 0.07, hd + 1.25, r0 - 0.006, 0.14, -1, LED_HOT);
    k.glow(x, (b.deckY ?? yF - 0.2) + DECK_LIFT + 0.03, hd + 1.3, 0.8, 0.8, [0.36, 0.24, 0.1]);
  }
  // Dachterrasse: Glasgeländer, Kübel und ein zurückgesetzter Glaspavillon
  const rx0 = x0 + 0.18, rx1 = x1 - 0.18, rz0 = z0 + 0.18, rz1 = z1 - 0.18;
  const rail = (ax, az, bx, bz, nx, nz) => {
    quadFacing(B.bglass, k.P(ax, r1 + 0.06, az), k.P(bx, r1 + 0.06, bz), k.P(bx, r1 + 1.02, bz), k.P(ax, r1 + 1.02, az), k.D(nx, 0, nz), [1, 1, 1]);
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 1.9));
    for (let i = 0; i <= n; i++) box(ax + ((bx - ax) * i) / n, r1, az + ((bz - az) * i) / n, 0.07, 1.06, 0.07, FRAME);
    box((ax + bx) / 2, r1 + 1.04, (az + bz) / 2, Math.abs(bx - ax) + 0.07, 0.05, Math.abs(bz - az) + 0.07, FRAME);
  };
  rail(rx0, rz1, rx1, rz1, 0, 1); rail(rx0, rz0, rx1, rz0, 0, -1); rail(rx0, rz0, rx0, rz1, -1, 0); rail(rx1, rz0, rx1, rz1, 1, 0);
  for (const [px, pz, s] of [[-5.3, 7.6, 1], [5.3, 7.6, 1], [4.9, -5.9, 0.85], [-5.3, 3.4, 0.8], [3.9, 2.4, 0.75]]) k.planter(px, r1, pz, 0.85 * s, 0.85 * s, 0.55 * s, 0, 0.85 * s, 1.15 * s, Math.round(px * 11 + pz * 5) + 200);
  const gx0 = -4.4, gx1 = 2.6, gz0 = -5.8, gz1 = 0.4, gh = 2.35;
  box((gx0 + gx1) / 2, r1, gz0 + 0.1, gx1 - gx0, gh, 0.2, ANTH_L);
  k.slats(gx0, gz0, gx1, gz0, r1, gh, 0, -1);
  for (const [ax, az, bx, bz, nx, nz] of [[gx0, gz1, gx1, gz1, 0, 1], [gx0, gz0, gx0, gz1, -1, 0], [gx1, gz0, gx1, gz1, 1, 0]]) {
    quadFacing(B.bglass, k.P(ax, r1, az), k.P(bx, r1, bz), k.P(bx, r1 + gh, bz), k.P(ax, r1 + gh, az), k.D(nx, 0, nz), [1, 1, 1]);
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 1.75));
    for (let i = 0; i <= n; i++) box(ax + ((bx - ax) * i) / n, r1, az + ((bz - az) * i) / n, 0.09, gh, 0.09, FRAME);
  }
  box(-0.9, r1, -4.9, 3.0, 0.45, 0.9, CREAM_D);
  box(-0.9, r1 + 0.45, -5.25, 3.0, 0.45, 0.2, CREAM);
  k.band(gx0 + 0.3, gz0 + 0.215, gx1 - 0.3, gz0 + 0.215, r1 + gh - 0.28, r1 + gh - 0.2, 0, 1, LED_HOT);
  box((gx0 + gx1) / 2, r1 + gh, (gz0 + gz1) / 2 + 0.2, gx1 - gx0 + 0.8, 0.3, gz1 - gz0 + 1.0, ANTH);
  k.strip(gx0 - 0.2, gz1 + 0.52, gx1 + 0.2, gz1 + 0.52, r1 + gh - 0.004, 0.07, -1);

  terrace(k, (b.deckY ?? yF - 0.12) + DECK_LIFT + 0.004, yF, b.stairs, b.furnZ || 0);
}

// ---------- Holzflächen am Strandhaus ----------
// Terrasse, Stege, Vorplatz und die Zufahrt: dunkle Dielen quer zur Laufrichtung, außen eine dunkle Randdiele mit
// eingelassenem LED-Band, daneben Pollerleuchten und Pflanzkübel; Palmen werden von unten angestrahlt.
// Die Wege darunter (Straßenart deck, hidden) formen nur das Gelände.
export function buildHomeDeck(ctx, hAt, B, colliders) {
  const home = ctx.home;
  if (!home || !home.deck) return;
  const k = kit(home.x, home.z, home.rot, B);
  const wk = kit(0, 0, 0, B);                          // Weltkoordinaten (Zufahrt, Palmen)
  const c = Math.cos(home.rot), s = Math.sin(home.rot);
  const Y = (lx, lz) => { const [x, z] = k.W(lx, lz); return hAt(x, z) + DECK_LIFT; };
  const rects = home.deck.rects;
  const wood = B.hDeck, under = B.flat;
  const BORDER = [DECKC[0] * 0.62, DECKC[1] * 0.62, DECKC[2] * 0.62];
  const shadeOf = (a, b2) => { const t = 0.84 + hash2(a, b2) * 0.28; return [DECKC[0] * t, DECKC[1] * t * 0.99, DECKC[2] * t * 0.97]; };

  // Dielen je Fläche: Richtung 'x' = Bretter laufen in x (quer zu einem Weg in z), 'z' umgekehrt; versetzte Stöße
  rects.forEach((r, ri) => {
    const [x0, x1, z0, z1, dir] = r;
    const alongX = dir === 'x';
    const across = alongX ? z1 - z0 : x1 - x0, a0 = alongX ? z0 : x0, l0 = alongX ? x0 : z0, l1 = alongX ? x1 : z1;
    const n = Math.max(1, Math.round(across / BOARD)), pitch = across / n;
    for (let i = 0; i < n; i++) {
      const a = a0 + i * pitch + BGAP / 2, b2 = a0 + (i + 1) * pitch - BGAP / 2;
      let l = l0, j = 0;
      while (l < l1 - 0.02) {
        let le = Math.min(l1, l + (j === 0 ? 0.7 + hash2(i + ri * 97, 3) * 2.4 : 1.9 + hash2(i + ri * 97, j * 7) * 2.2));
        if (l1 - le < 0.5) le = l1;
        const p0 = l + (j ? BGAP / 2 : 0), p1 = le - (le < l1 ? BGAP / 2 : 0);
        const col = shadeOf(i * 7 + ri * 331, j * 13 + 1), uo = hash2(i, j + ri) * 0.6;
        const m = Math.max(1, Math.ceil((p1 - p0) / 1.0));
        for (let q = 0; q < m; q++) {
          const s0 = p0 + ((p1 - p0) * q) / m, s1 = p0 + ((p1 - p0) * (q + 1)) / m;
          const pt = (lng, acr) => { const lx = alongX ? lng : acr, lz = alongX ? acr : lng, w = k.W(lx, lz); return [w[0], Y(lx, lz), w[1]]; };
          wood.quadUp(pt(s0, a), pt(s0, b2), pt(s1, b2), pt(s1, a), col[0], col[1], col[2], uo, s0, uo + (b2 - a) / 0.5, s1);
        }
        l = le; j++;
      }
    }
    // dunkle Unterlage (in den Fugen sichtbar)
    const nx = Math.max(1, Math.ceil((x1 - x0) / 1.2)), nz = Math.max(1, Math.ceil((z1 - z0) / 1.2));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const P = (u, v) => { const lx = x0 + ((x1 - x0) * u) / nx, lz = z0 + ((z1 - z0) * v) / nz, q = k.W(lx, lz); return [q[0], Y(lx, lz) - 0.03, q[1]]; };
      under.quadUp(P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1), 0.09, 0.06, 0.045);
    }
  });

  // Außenkanten der gesamten Fläche: Randdiele, LED-Band, Lichtschein, Stirnbrett (nicht an Übergängen und Hauswänden)
  const drive = home.deck.drive != null ? ctx.net.roads[home.deck.drive] : null;
  const fore = rects[home.deck.forecourt ?? 3];
  const blocked = [[-5.5, 5.5, -6.5, 6.5], [7.7, 16.7, -6.2, 1.8], [-1.56, 1.56, -9.2, -6.4]];
  const dc = home.deck.driveX ?? 12.2, dhw = drive ? drive.w / 2 : 3.2;
  const insideOther = (px, pz, self) => rects.some((o, i) => i !== self && px > o[0] - 0.001 && px < o[1] + 0.001 && pz > o[2] - 0.001 && pz < o[3] + 0.001)
    || blocked.some((o) => px > o[0] && px < o[1] && pz > o[2] && pz < o[3])
    || (drive && Math.abs(px - dc) < dhw - 0.05 && pz < fore[2] && pz > fore[2] - 0.8);
  rects.forEach((r, ri) => {
    const [x0, x1, z0, z1] = r;
    for (const [ax, az, bx, bz, ox, oz] of [[x0, z0, x1, z0, 0, -1], [x0, z1, x1, z1, 0, 1], [x0, z0, x0, z1, -1, 0], [x1, z0, x1, z1, 1, 0]]) {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 0.1));
      let start = null;
      for (let i = 0; i <= n; i++) {
        const t = (i + 0.5) / n, outer = i < n && !insideOther(ax + (bx - ax) * t + ox * 0.07, az + (bz - az) * t + oz * 0.07, ri);
        if (outer && start === null) start = i / n;
        if (!outer && start !== null) {
          const t0 = start, t1 = i / n;
          start = null;
          if ((t1 - t0) * len < 0.3) continue;
          const m = Math.max(1, Math.ceil((t1 - t0) * len / 0.9));
          for (let q = 0; q < m; q++) {
            const u0 = t0 + ((t1 - t0) * q) / m, u1 = t0 + ((t1 - t0) * (q + 1)) / m;
            const at = (u, inset, lift) => { const lx = ax + (bx - ax) * u - ox * inset, lz = az + (bz - az) * u - oz * inset, w = k.W(lx, lz); return [w[0], Y(lx, lz) + lift, w[1]]; };
            wood.quadUp(at(u0, 0, 0.004), at(u0, 0.2, 0.004), at(u1, 0.2, 0.004), at(u1, 0, 0.004), ...BORDER, 0, u0 * len, 0.4, u1 * len);
            const lq = [at(u0, 0.215, 0.007), at(u1, 0.215, 0.007), at(u1, 0.27, 0.007), at(u0, 0.27, 0.007)];
            B.led.quadUp(lq[0], lq[1], lq[2], lq[3], ...LED_HOT);
            k.glowLine(at(u0, -0.28, 0.012), at(u1, -0.28, 0.012), at(u1, 0.78, 0.012), at(u0, 0.78, 0.012), [0.8, 0.46, 0.17]);
            // Stirnbrett nach außen
            const a2 = at(u0, 0, 0.004), b3 = at(u1, 0, 0.004);
            quadFacing(wood, a2, b3, [b3[0], b3[1] - DECK_LIFT - 0.12, b3[2]], [a2[0], a2[1] - DECK_LIFT - 0.12, a2[2]], k.D(ox, 0, oz), BORDER);
          }
        }
      }
    }
  });

  // Zufahrt: Bretter quer zur Fahrtrichtung, Randdielen mit LED-Band an beiden Seiten, Leuchten und Kübel daneben
  if (drive) {
    const net = ctx.net, hw = drive.w / 2, p = {}, q = {};
    const local = (x, z) => { const dx = x - home.x, dz = z - home.z; return [c * dx - s * dz, s * dx + c * dz]; };
    let s0 = 0;
    for (; s0 < drive.len; s0 += 0.05) { net.pointAt(drive, s0, p); if (local(p.x, p.z)[1] <= fore[2] + 0.005) break; }
    let s1 = s0;
    while (s1 < drive.len) {
      net.pointAt(drive, s1, p);
      const other = net.nearest(p.x, p.z, 14, (r) => r.kind !== 'deck' && !r.hidden);
      if (other && other.d < other.road.w / 2 + other.road.sw + 0.1) break;
      s1 += 0.25;
    }
    s1 = Math.min(s1, drive.len);
    const at = (pp, lat, lift) => { const x = pp.x - pp.dz * lat, z = pp.z + pp.dx * lat; return [x, Math.max(hAt(x, z) + 0.05, pp.y + 0.065) + lift, z]; };
    let i = 0;
    for (let sp = s0; sp < s1 - 0.02; sp += BOARD, i++) {
      net.pointAt(drive, sp, p); net.pointAt(drive, Math.min(s1, sp + BOARD - BGAP), q);
      const inner = hw - 0.27, j = -inner + (0.25 + hash2(i, 17) * 0.5) * 2 * inner;
      for (const [la, lb, n] of [[-inner, j - BGAP / 2, 0], [j + BGAP / 2, inner, 1]]) {
        const col = shadeOf(i * 3 + 5000, n);
        const m = Math.max(1, Math.ceil((lb - la) / 1.6));
        for (let e = 0; e < m; e++) {
          const u = la + ((lb - la) * e) / m, v = la + ((lb - la) * (e + 1)) / m;
          wood.quadUp(at(p, u, 0), at(q, u, 0), at(q, v, 0), at(p, v, 0), col[0], col[1], col[2], 0.1 * n, u, 0.1 * n + 0.32, v);
        }
      }
    }
    for (let sp = s0; sp < s1 - 0.05; sp += 0.9) {
      const e = Math.min(s1, sp + 0.9);
      net.pointAt(drive, sp, p); net.pointAt(drive, e, q);
      for (const sg of [-1, 1]) {
        wood.quadUp(at(p, sg * hw, 0.004), at(p, sg * (hw - 0.2), 0.004), at(q, sg * (hw - 0.2), 0.004), at(q, sg * hw, 0.004), ...BORDER, 0, sp, 0.4, e);
        B.led.quadUp(at(p, sg * (hw - 0.215), 0.007), at(q, sg * (hw - 0.215), 0.007), at(q, sg * (hw - 0.27), 0.007), at(p, sg * (hw - 0.27), 0.007), ...LED_HOT);
        wk.glowLine(at(p, sg * (hw + 0.28), 0.012), at(q, sg * (hw + 0.28), 0.012), at(q, sg * (hw - 0.78), 0.012), at(p, sg * (hw - 0.78), 0.012), [0.8, 0.46, 0.17]);
        const a2 = at(p, sg * hw, 0.004), b3 = at(q, sg * hw, 0.004);
        quadFacing(wood, a2, b3, [b3[0], b3[1] - 0.2, b3[2]], [a2[0], a2[1] - 0.2, a2[2]], [-p.dz * sg, 0, p.dx * sg], BORDER);
        // Unterlage
        under.quadUp(at(p, 0, -0.025), at(q, 0, -0.025), at(q, sg * hw, -0.025), at(p, sg * hw, -0.025), 0.09, 0.06, 0.045);
      }
    }
    const freeSpot = (x, z) => { const o = net.nearest(x, z, 12, (r) => r !== drive && !r.hidden); return !o || o.d > o.road.w / 2 + o.road.sw + 0.6; };
    for (let sp = s0 + 3; sp < s1 - 3; sp += 5.5) {
      net.pointAt(drive, sp, p);
      for (const sg of [-1, 1]) {
        const x = p.x - p.dz * sg * (hw + 0.38), z = p.z + p.dx * sg * (hw + 0.38), y = hAt(x, z);
        if (!freeSpot(x, z)) continue;
        wk.bollard(x, y, z);
        colliders.push({ k: 'c', x, z, r: 0.13, y0: y - 1, y1: y + 0.8, soft: true });
      }
    }
    let side = 1;
    for (let sp = s0 + 6.8; sp < s1 - 5; sp += 11, side = -side) {
      for (const sg of [side, -side]) {
        net.pointAt(drive, sp + (sg === side ? 0 : 5.5), p);
        const x = p.x - p.dz * sg * (hw + 1.15), z = p.z + p.dx * sg * (hw + 1.15), y = hAt(x, z), ang = Math.atan2(p.dx, p.dz);
        if (!freeSpot(x, z)) continue;
        wk.planter(x, y, z, 0.62, 1.5, 0.52, ang, 0.9, 1.15, Math.round(sp * 3 + sg));
        colliders.push({ k: 'b', x, z, hx: 0.31, hz: 0.75, c: Math.cos(ang), s: Math.sin(ang), y0: y - 1, y1: y + 0.62 });
      }
    }
  }

  // Leuchten und Kübel rund um Stege und Terrasse (lokal; das Schild vor dem Haus bleibt frei)
  const ground = (lx, lz) => { const w = k.W(lx, lz); return hAt(w[0], w[1]); };
  const bollards = [[-8.0, -12.1], [-4.4, -12.1], [-0.8, -12.1], [1.5, -12.1], [6.2, -12.5], [18.0, -11.6], [18.0, -8.2],
    [-9.05, -9.4], [-9.05, -5.2], [-9.05, -1.2], [-9.05, 2.8], [-10.0, 7.2], [-10.0, 10.6], [-10.0, 14.0], [8.8, 9.4], [8.8, 13.0], [-6.6, 14.7], [-1.8, 14.7], [3.0, 14.7], [7.4, 14.7]];
  for (const [lx, lz] of bollards) {
    const y = ground(lx, lz);
    k.bollard(lx, y, lz);
    const w = k.W(lx, lz);
    colliders.push({ k: 'c', x: w[0], z: w[1], r: 0.13, y0: y - 1, y1: y + 0.8, soft: true });
  }
  const planters = [[-9.8, -7.3, 0.62, 1.5, 21], [-9.8, 0.8, 0.62, 1.5, 33], [-9.8, 4.9, 0.62, 1.3, 41], [-6.2, -12.65, 1.5, 0.62, 55], [-2.6, -12.65, 1.5, 0.62, 61],
    [-4.2, 15.2, 1.5, 0.62, 73], [0.6, 15.2, 1.5, 0.62, 87], [5.2, 15.2, 1.5, 0.62, 99], [18.3, -9.9, 0.62, 1.4, 111]];
  for (const [lx, lz, sx, sz, seed] of planters) {
    const y = ground(lx, lz);
    k.planter(lx, y, lz, sx, sz, 0.55, 0, 0.9, 1.2, seed);
    const w = k.W(lx, lz);
    colliders.push({ k: 'b', x: w[0], z: w[1], hx: sx / 2, hz: sz / 2, c, s, y0: y - 1, y1: y + 0.65 });
  }

  // Bodenstrahler an den Palmen: kleine Leuchte und warmer Schein den Stamm hinauf
  for (const p of ctx.props) {
    if (p.t !== 'palm' || Math.hypot(p.x - home.x, p.z - home.z) > 40) continue;
    const x = p.x + 0.65, z = p.z + 0.35, y = hAt(x, z);
    wk.cyl(B.flat, x, y - 0.05, z, 0.17, 0.15, 0.14, 8, ANTH);
    wk.cyl(B.led, x, y + 0.09, z, 0.1, 0.09, 0.03, 8, LED_HOT);
    wk.glow(p.x + 0.2, y + 0.02, p.z + 0.1, 1.5, 1.5, [0.75, 0.46, 0.18]);
    const py = hAt(p.x, p.z);
    wk.glowUp(p.x + 0.3, py + 0.1, p.z, 1.3, 4.2, 1, 0, [0.5, 0.31, 0.11]);
    wk.glowUp(p.x, py + 0.1, p.z + 0.3, 1.3, 4.2, 0, 1, [0.5, 0.31, 0.11]);
  }
}
