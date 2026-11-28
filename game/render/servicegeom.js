// Geometrie der Tankstellen und Werkstätten (Stil 'service', Teile aus world/services.js).
// Teile: canopy (Tankdach), island (Zapfsäuleninsel), shop (Tankstellenshop), totem (Preissäule), hall (Werkstatthalle).
import { SignList } from '../world/signs.js';
import { SHOP } from '../world/services.js';

const WHITE = [0.93, 0.93, 0.91], GREEN = [0.06, 0.42, 0.24], YELLOW = [0.98, 0.82, 0.12], DARK = [0.16, 0.17, 0.18];
const GRAY = [0.6, 0.6, 0.58], STEEL = [0.55, 0.57, 0.6], BLUE = [0.16, 0.32, 0.6], RED = [0.72, 0.14, 0.12];

export function addServicePart(b, B) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const yF = b.base + 0.12;
  const f = B.flat;
  const W = (lx, lz) => [b.x + c * lx + s * lz, b.z - s * lx + c * lz];
  const P = (lx, ly, lz) => { const q = W(lx, lz); return [q[0], ly, q[1]]; };
  const NV = (nx, nz) => [c * nx + s * nz, -s * nx + c * nz];
  const box = (lx, y0, lz, sx, sy, sz, col, mb = f, opts) => { const q = W(lx, lz); mb.box(q[0], y0, q[1], sx, sy, sz, b.rot, col[0], col[1], col[2], opts); };
  const hw = b.w / 2, hd = b.d / 2;
  // Schild als Quad (beidseitig, wenn two): Mitte lx/lz, Breite sw, Normale nz (±1 lokal z)
  const sign = (idx, lx, y0, lz, sw, nz) => {
    if (idx === undefined) return;
    const [u0, v0, u1, v1] = SignList.uv(idx), sh = sw / 4;
    const a = P(lx - (sw / 2) * nz, y0, lz), bq = P(lx + (sw / 2) * nz, y0, lz);
    const n = NV(0, nz);
    B.sign.quad(a, bq, [bq[0], y0 + sh, bq[2]], [a[0], y0 + sh, a[2]], n[0], 0, n[1], u0, v0, u1, v1, 1, 1, 1);
  };
  // Wand mit Putz-UV (Meter / 2)
  const wall = (ax, az, bx, bz, y0, y1, col, mb = B.hPlaster) => {
    const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len, n = NV(nx, nz);
    mb.quad(P(ax, y0, az), P(bx, y0, bz), P(bx, y1, bz), P(ax, y1, az), n[0], 0, n[1], 0, y0 / 2, len / 2, y1 / 2, ...col);
  };

  if (b.part === 'canopy') {
    const top = yF + 5.0;
    for (const [px, pz] of [[-6.6, -3], [6.6, -3], [-6.6, 3], [6.6, 3]]) { box(px, yF, pz, 0.45, top - yF, 0.45, WHITE); box(px, yF, pz, 0.6, 0.5, 0.6, GRAY); }
    box(0, top, 0, b.w, 0.55, b.d, WHITE);
    // Blende rundum: grün mit gelbem Streifen
    box(0, top + 0.05, -hd - 0.02, b.w + 0.1, 0.7, 0.08, GREEN); box(0, top + 0.05, hd + 0.02, b.w + 0.1, 0.7, 0.08, GREEN);
    box(-hw - 0.02, top + 0.05, 0, 0.08, 0.7, b.d + 0.1, GREEN); box(hw + 0.02, top + 0.05, 0, 0.08, 0.7, b.d + 0.1, GREEN);
    box(0, top + 0.05, -hd - 0.08, b.w + 0.12, 0.12, 0.05, YELLOW); box(0, top + 0.05, hd + 0.08, b.w + 0.12, 0.12, 0.05, YELLOW);
    sign(b.signIdx, 0, top + 0.08, -hd - 0.12, 5.6, -1);
    sign(b.signIdx, 0, top + 0.08, hd + 0.12, 5.6, 1);
    // Leuchtfelder unter dem Dach (nachts hell)
    for (let x = -8; x <= 8; x += 4) for (const z of [-4.5, -1.5, 1.5, 4.5]) box(x, top - 0.04, z, 1.6, 0.04, 0.7, [1, 1, 1], B.hGlassLit);
    return;
  }

  if (b.part === 'island') {
    // Sockel mit Rammschutz, zwei Zapfsäulen, Bügel
    box(0, yF, 0, b.w, 0.2, b.d, [0.78, 0.77, 0.74]);
    for (const sx of [-1, 1]) { box(sx * (hw - 0.35), yF + 0.2, 0, 0.18, 0.9, 0.18, YELLOW); box(sx * (hw - 0.35), yF + 0.75, 0, 0.19, 0.12, 0.19, DARK); }
    for (const px of [-4, 4]) {
      box(px, yF + 0.2, 0, 1.15, 1.45, 0.72, WHITE);
      box(px, yF + 1.65, 0, 1.25, 0.32, 0.8, GREEN);
      box(px, yF + 1.97, 0, 1.0, 0.06, 0.6, YELLOW);
      for (const sz of [-1, 1]) {
        // Anzeige, Zapfpistole im Halter, Schlauch
        const n = NV(0, sz), a = P(px - 0.35, yF + 1.05, sz * 0.365), bq = P(px + 0.35, yF + 1.05, sz * 0.365);
        B.hGlassLit.quad(sz > 0 ? a : bq, sz > 0 ? bq : a, [(sz > 0 ? bq : a)[0], yF + 1.45, (sz > 0 ? bq : a)[2]], [(sz > 0 ? a : bq)[0], yF + 1.45, (sz > 0 ? a : bq)[2]], n[0], 0, n[1], 0.504, 0.504, 0.996, 0.996, 0.55, 0.85, 0.7);
        box(px + 0.38, yF + 0.6, sz * 0.4, 0.14, 0.3, 0.1, DARK);
        box(px + 0.38, yF + 0.82, sz * 0.45, 0.08, 0.16, 0.16, [0.15, 0.15, 0.16]);
        box(px - 0.42, yF + 0.25, sz * 0.38, 0.05, 0.75, 0.05, [0.08, 0.08, 0.09]);
      }
    }
    return;
  }

  if (b.part === 'shop') {
    const h = 3.6, top = yF + h;
    wall(-hw, -hd, hw, -hd, yF, top, [0.95, 0.94, 0.9]); wall(hw, -hd, hw, hd, yF, top, [0.95, 0.94, 0.9]);
    wall(hw, hd, -hw, hd, yF, top, [0.95, 0.94, 0.9]); wall(-hw, hd, -hw, -hd, yF, top, [0.95, 0.94, 0.9]);
    // Glasfront zum Vorplatz (lokal −z) mit Tür
    const n = NV(0, -1), gz = -hd - 0.03;
    B.hGlassLit.quad(P(hw - 0.6, yF + 0.3, gz), P(-hw + 0.6, yF + 0.3, gz), P(-hw + 0.6, top - 0.5, gz), P(hw - 0.6, top - 0.5, gz), n[0], 0, n[1], 0.004, 0.504, 0.496, 0.996, 1, 1, 1);
    for (let x = -hw + 0.6; x <= hw - 0.6 + 0.01; x += 2.3) box(x, yF, -hd - 0.06, 0.12, top - 0.5 - yF, 0.12, DARK);
    box(0, yF + 0.3, -hd - 0.06, b.w - 1.2, 0.1, 0.1, DARK);
    box(0, top - 0.6, -hd - 0.06, b.w - 1.2, 0.1, 0.1, DARK);
    box(0, top, 0, b.w + 0.6, 0.35, b.d + 0.6, [0.88, 0.88, 0.86]);
    box(0, top + 0.35, -hd - 0.31, b.w + 0.6, 0.6, 0.06, GREEN);
    sign(b.signIdx, 0, top + 0.37, -hd - 0.36, 3.8, -1);
    // Getränkeautomat und Eistruhe draußen
    box(hw - 1.2, yF, -hd - 0.6, 0.9, 1.9, 0.7, RED);
    box(-hw + 1.4, yF, -hd - 0.55, 1.6, 0.9, 0.7, [0.85, 0.88, 0.95]);
    return;
  }

  if (b.part === 'totem') {
    box(0, yF, 0, b.w, b.h, b.d, [0.94, 0.94, 0.92]);
    box(0, yF + b.h - 1.9, 0, b.w + 0.1, 1.5, b.d + 0.1, GREEN);
    sign(b.signIdx, 0, yF + b.h - 1.75, -hd - 0.06, b.w - 0.2, -1);
    sign(b.signIdx, 0, yF + b.h - 1.75, hd + 0.06, b.w - 0.2, 1);
    box(0, yF + b.h - 3.6, 0, b.w + 0.05, 1.5, b.d + 0.05, DARK);
    sign(b.priceIdx, 0, yF + b.h - 3.35, -hd - 0.04, b.w - 0.25, -1);
    sign(b.priceIdx, 0, yF + b.h - 3.35, hd + 0.04, b.w - 0.25, 1);
    return;
  }

  if (b.part === 'hall') {
    const H = b.h, dw = SHOP.door.w, dh = SHOP.door.h, g = dw / 2, t = 0.4;
    const wallCol = [0.86, 0.87, 0.88];
    // Wände (hohl), vorne Toröffnung
    const slab = (lx, lz, sx, sz, y0, y1) => {
      const q = W(lx, lz);
      f.box(q[0], y0, q[1], sx, y1 - y0, sz, b.rot, ...wallCol);
    };
    slab(-hw + t / 2, 0, t, b.d, yF, yF + H); slab(hw - t / 2, 0, t, b.d, yF, yF + H); slab(0, hd - t / 2, b.w, t, yF, yF + H);
    for (const sg of [-1, 1]) slab(sg * (g + (hw - g) / 2), -hd + t / 2, hw - g, t, yF, yF + H);
    slab(0, -hd + t / 2, dw, t, yF + dh, yF + H);
    // Sockel außen, Wellblech-Band oben, Dach mit Blende
    for (const [ax, az, bx, bz] of [[-hw, -hd, -g, -hd], [g, -hd, hw, -hd], [hw, -hd, hw, hd], [hw, hd, -hw, hd], [-hw, hd, -hw, -hd]]) {
      const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len, n = NV(nx, nz);
      f.quad(P(ax + nx * 0.02, yF - 0.6, az + nz * 0.02), P(bx + nx * 0.02, yF - 0.6, bz + nz * 0.02), P(bx + nx * 0.02, yF + 0.5, bz + nz * 0.02), P(ax + nx * 0.02, yF + 0.5, az + nz * 0.02), n[0], 0, n[1], 0, 0, 1, 1, 0.45, 0.46, 0.48);
    }
    box(0, yF + H, 0, b.w + 0.5, 0.3, b.d + 0.5, [0.5, 0.52, 0.55]);
    box(0, yF + H - 0.9, -hd - 0.12, b.w + 0.5, 1.2, 0.2, BLUE);
    for (let x = -hw; x <= hw; x += 0.5) box(x, yF + H - 0.88, -hd - 0.24, 0.08, 1.16, 0.04, [0.12, 0.25, 0.5]);
    sign(b.signIdx, 0, yF + dh + 0.25, -hd - 0.27, 4.6, -1);
    // Torrahmen (gelb-schwarz) und Lampen
    for (const sg of [-1, 1]) {
      box(sg * (g + 0.15), yF, -hd - 0.1, 0.3, dh + 0.1, 0.2, DARK);
      for (let k = 0; k < 5; k++) box(sg * (g + 0.15), yF + 0.25 + k * 0.5, -hd - 0.21, 0.31, 0.22, 0.02, YELLOW);
      box(sg * (g + 1.1), yF + dh + 0.6, -hd - 0.35, 0.3, 0.2, 0.5, DARK);
    }
    box(0, yF + dh, -hd - 0.1, dw + 0.6, 0.25, 0.2, DARK);
    // Oberlichter an den Seiten
    for (const sg of [-1, 1]) for (let z = -hd + 2; z < hd - 1.5; z += 3) {
      const n = NV(sg, 0), xx = sg * (hw + 0.02);
      B.hGlass.quad(P(xx, yF + 3.6, z + (sg > 0 ? 1.1 : -1.1)), P(xx, yF + 3.6, z + (sg > 0 ? -1.1 : 1.1)), P(xx, yF + 4.6, z + (sg > 0 ? -1.1 : 1.1)), P(xx, yF + 4.6, z + (sg > 0 ? 1.1 : -1.1)), n[0], 0, n[1], 0.004, 0.504, 0.496, 0.996, 1, 1, 1);
    }
    // Innen: Decke, Lichtbänder, Bodenmarkierung, Hebebühne, Werkbank, Werkzeugwand, Reifen, Fässer, Kompressor
    const ceil = yF + H - 0.05;
    f.quadAuto(P(-hw + t, ceil, hd - t), P(hw - t, ceil, hd - t), P(hw - t, ceil, -hd + t), P(-hw + t, ceil, -hd + t), 0.72, 0.73, 0.75);
    for (const x of [-4, 0, 4]) box(x, ceil - 0.12, 0, 0.3, 0.1, b.d - 2, [1, 1, 1], B.hGlassLit);
    for (const sx of [-1, 1]) box(sx * 1.6, yF + 0.005, 0.5, 0.12, 0.012, 9, YELLOW);
    box(0, yF + 0.005, -4.2, 3.32, 0.012, 0.12, YELLOW);
    for (const sx of [-1, 1]) {
      box(sx * 1.9, yF, 2.2, 0.35, 3.4, 0.35, RED);
      box(sx * 1.9, yF, 2.2, 0.7, 0.12, 0.7, DARK);
      box(sx * 1.25, yF + 0.45, 1.2, 1.2, 0.1, 0.18, STEEL); box(sx * 1.25, yF + 0.45, 3.2, 1.2, 0.1, 0.18, STEEL);
    }
    box(0, yF + 3.3, 2.2, 4.2, 0.25, 0.4, RED);
    // Werkbank und Werkzeugwand hinten
    box(0, yF, hd - 1.0, 6, 0.9, 0.9, [0.35, 0.36, 0.38]); box(0, yF + 0.9, hd - 1.0, 6.1, 0.06, 0.95, [0.55, 0.42, 0.28]);
    box(0, yF + 1.2, hd - t - 0.03, 6, 1.6, 0.04, [0.28, 0.3, 0.33]);
    for (let k = 0; k < 14; k++) box(-2.6 + k * 0.4, yF + 1.5 + (k % 3) * 0.35, hd - t - 0.08, 0.07, 0.3 + (k % 2) * 0.15, 0.05, k % 4 === 0 ? RED : STEEL);
    // Regale mit Reifen (links) und Ölfässer/Kompressor (rechts)
    for (let k = 0; k < 6; k++) for (let j = 0; j < 3; j++) { const q = W(-hw + 0.9, -1 + k * 1.2); f.cylinder(q[0], yF + j * 0.27, q[1], 0.38, 0.38, 0.25, 12, 0.08, 0.08, 0.09); }
    for (let k = 0; k < 4; k++) { const q = W(hw - 0.9, -2 + k * 0.9); f.cylinder(q[0], yF, q[1], 0.3, 0.3, 0.9, 12, k % 2 ? 0.15 : 0.7, k % 2 ? 0.3 : 0.12, k % 2 ? 0.6 : 0.1); }
    box(hw - 0.9, yF, 3.5, 0.8, 1.1, 1.4, [0.85, 0.3, 0.12]);
    return;
  }
}
