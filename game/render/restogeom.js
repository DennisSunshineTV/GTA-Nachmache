// Geometrie der Restaurants (Stil 'resto', Daten aus world/restaurants.js): Fassade mit Glasfront, Markise und Leuchtschild,
// innen Fliesenboden, Theke mit Kasse, Küchenzeile mit Speisetafeln, Tische mit Stühlen, Hängeleuchten. Je nach Küche
// kommen Pizzaofen, Dönerspieß, Fritteuse oder Grillplatte dazu. Die Schiebetür baut world/restort.js (sie bewegt sich).
import { SignList } from '../world/signs.js';
import { RESTO, KINDS, TABLES } from '../world/restaurants.js';

const DARK = [0.12, 0.12, 0.13], STEEL = [0.72, 0.74, 0.77], WOOD = [0.5, 0.33, 0.2], WOOD_D = [0.34, 0.22, 0.13], CREAM = [0.95, 0.92, 0.85];

export function addRestoPart(b, B) {
  const K = KINDS[b.kind] || KINDS.burger;
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const yF = b.base + 0.12, H = RESTO.H, yT = yF + H;
  const f = B.flat;
  const W = (lx, lz) => [b.x + c * lx + s * lz, b.z - s * lx + c * lz];
  const P = (lx, ly, lz) => { const q = W(lx, lz); return [q[0], ly, q[1]]; };
  const NV = (nx, nz) => [c * nx + s * nz, -s * nx + c * nz];
  const box = (lx, y0, lz, sx, sy, sz, col, mb = f, opts) => { const q = W(lx, lz); mb.box(q[0], y0, q[1], sx, sy, sz, b.rot, col[0], col[1], col[2], opts); };
  const hw = b.w / 2, hd = b.d / 2, T = 0.24;
  // Wandfläche (Putz-UV in Metern / 2); Normale = links von A→B
  const wall = (ax, az, bx, bz, y0, y1, col, mb = B.hPlaster) => {
    const len = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / len, nz = (bx - ax) / len, n = NV(nx, nz);
    mb.quad(P(ax, y0, az), P(bx, y0, bz), P(bx, y1, bz), P(ax, y1, az), n[0], 0, n[1], 0, y0 / 2, len / 2, y1 / 2, ...col);
  };
  const quadN = (mb, a, bq, cq, d, nx, ny, nz, col) => { const n = NV(nx, nz); mb.quad(P(...a), P(...bq), P(...cq), P(...d), n[0], ny, n[1], 0, 0, 1, 1, ...col); };
  const sign = (idx, lx, y0, lz, sw, nz) => {
    if (idx === undefined) return;
    const [u0, v0, u1, v1] = SignList.uv(idx), sh = sw / 4;
    const a = P(lx - (sw / 2) * nz, y0, lz), bq = P(lx + (sw / 2) * nz, y0, lz);
    const n = NV(0, nz);
    B.sign.quad(a, bq, [bq[0], y0 + sh, bq[2]], [a[0], y0 + sh, a[2]], n[0], 0, n[1], u0, v0, u1, v1, 1, 1, 1);
  };
  const wallC = K.wall, inC = [0.97, 0.95, 0.9];
  const door = RESTO.door, g0 = door.x - door.w / 2, g1 = door.x + door.w / 2;
  const sill = 0.55, top = 2.6;

  // --- Sockel und Außenwände (außen in der Grundfarbe, innen hell) ---
  box(0, b.y0 - 0.3, 0, b.w + 0.1, yF - b.y0 + 0.28, b.d + 0.1, [0.62, 0.6, 0.56]);
  wall(hw, -hd, hw, hd, yF, yT, wallC); wall(hw, hd, -hw, hd, yF, yT, wallC); wall(-hw, hd, -hw, -hd, yF, yT, wallC);
  wall(hw - T, hd, hw - T, -hd + T, yF, yT, inC); wall(-hw + T, hd - T, hw - T, hd - T, yF, yT, inC); wall(-hw + T, -hd + T, -hw + T, hd - T, yF, yT, inC);
  // Front: Brüstung unter den Fenstern, Sturz darüber, Pfeiler, Türöffnung
  const fz = -hd;
  for (const [x0, x1] of [[-hw, g0], [g1, hw]]) {
    wall(x0, fz, x1, fz, yF, yF + sill, wallC); wall(x1, fz + T, x0, fz + T, yF, yF + sill, inC);
    box((x0 + x1) / 2, yF + sill - 0.04, fz + T / 2, x1 - x0, 0.06, T + 0.08, [0.85, 0.85, 0.83]);
  }
  wall(-hw, fz, hw, fz, yF + top, yT, wallC); wall(hw, fz + T, -hw, fz + T, yF + top, yT, inC);
  for (const x of [-hw + 0.2, g0 - 0.1, g1 + 0.1, hw - 0.2]) box(x, yF, fz + T / 2, 0.22, top, T + 0.02, wallC);
  // Glasfront mit Sprossen (klares Glas, man sieht hinein)
  const glassAt = (x0, x1) => {
    quadN(B.bglass, [x1, yF + sill, fz + 0.06], [x0, yF + sill, fz + 0.06], [x0, yF + top, fz + 0.06], [x1, yF + top, fz + 0.06], 0, 0, -1, [1, 1, 1]);
    for (let x = x0 + 2.1; x < x1 - 0.5; x += 2.1) box(x, yF + sill, fz + 0.06, 0.06, top - sill, 0.08, DARK);
    box((x0 + x1) / 2, yF + sill, fz + 0.06, x1 - x0, 0.05, 0.09, DARK); box((x0 + x1) / 2, yF + top - 0.05, fz + 0.06, x1 - x0, 0.05, 0.09, DARK);
  };
  glassAt(-hw + 0.31, g0 - 0.21); glassAt(g1 + 0.21, hw - 0.31);
  box(door.x, yF + 2.5, fz + T / 2, door.w + 0.2, 0.1, T + 0.05, DARK);       // Türrahmen oben
  quadN(B.bglass, [g1, yF + 2.5, fz + 0.06], [g0, yF + 2.5, fz + 0.06], [g0, yF + top, fz + 0.06], [g1, yF + top, fz + 0.06], 0, 0, -1, [1, 1, 1]);

  // --- Dach mit Attika, innen Decke mit Lichtfeldern ---
  box(0, yT, 0, b.w + 0.3, 0.32, b.d + 0.3, [0.8, 0.79, 0.76]);
  for (const [lx, lz, sx, sz] of [[0, -hd - 0.1, b.w + 0.3, 0.12], [0, hd + 0.1, b.w + 0.3, 0.12], [-hw - 0.1, 0, 0.12, b.d + 0.3], [hw + 0.1, 0, 0.12, b.d + 0.3]]) box(lx, yT + 0.32, lz, sx, 0.5, sz, wallC);
  quadN(f, [-hw + T, yT - 0.05, -hd + T], [hw - T, yT - 0.05, -hd + T], [hw - T, yT - 0.05, hd - T], [-hw + T, yT - 0.05, hd - T], 0, -1, 0, [0.93, 0.92, 0.9]);
  for (const [x, z] of [[-4.2, -2], [-0.8, -2], [2.6, -2], [-4.2, 1.2], [-0.8, 1.2], [2.6, 1.2]]) box(x, yT - 0.07, z, 1.1, 0.02, 0.5, [1, 0.97, 0.88], B.led);

  // --- Schild über der Glasfront, Markise in den Farben der Küche ---
  box(0, yF + 2.72, fz - 0.06, 6.4, 1.6, 0.1, DARK);
  sign(b.signIdx, 0, yF + 2.78, fz - 0.12, 6.0, -1);
  for (const [x0, x1] of [[-hw + 0.3, g0 - 0.2], [g1 + 0.2, hw - 0.3]]) {
    const n = Math.max(2, Math.round((x1 - x0) / 0.55));
    for (let i = 0; i < n; i++) {
      const xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n, col = i % 2 ? CREAM : K.accent;
      quadN(f, [xa, yF + 2.66, fz - 0.02], [xb, yF + 2.66, fz - 0.02], [xb, yF + 2.32, fz - 1.15], [xa, yF + 2.32, fz - 1.15], 0, 0.9, -0.45, col);
      box((xa + xb) / 2, yF + 2.05, fz - 1.15, xb - xa, 0.28, 0.03, col);
    }
  }
  // Leuchtschrift auch an der Seite (Würfelschild an der Ecke)
  box(hw + 0.08, yF + 2.9, fz + 1.2, 0.12, 1.0, 1.0, K.accent);
  sign(b.signIdx, hw + 0.15, yF + 3.05, fz + 1.2, 2.4, 1);

  // --- Fliesenboden (Schachbrett) ---
  const tile = 0.6, colA = b.kind === 'pizza' || b.kind === 'schnitzel' ? [0.62, 0.45, 0.32] : [0.9, 0.89, 0.86], colB = b.kind === 'burger' ? [0.16, 0.16, 0.17] : b.kind === 'pizza' ? [0.85, 0.82, 0.76] : [0.72, 0.7, 0.66];
  for (let ix = 0; ix * tile < b.w - 2 * T; ix++) for (let iz = 0; iz * tile < b.d - 2 * T; iz++) {
    const x0 = -hw + T + ix * tile, z0 = -hd + T + iz * tile, x1 = Math.min(hw - T, x0 + tile), z1 = Math.min(hd - T, z0 + tile);
    quadN(f, [x0, yF + 0.012, z0], [x0, yF + 0.012, z1], [x1, yF + 0.012, z1], [x1, yF + 0.012, z0], 0, 1, 0, (ix + iz) % 2 ? colA : colB);
  }
  // Fußmatte innen an der Tür
  box(door.x, yF, fz + T + 0.6, door.w, 0.015, 1.0, [0.2, 0.2, 0.22]);

  // --- Theke mit Kasse und Auslage ---
  const cz = RESTO.counterZ;
  box(-1.4, yF, cz, 7.2, 1.0, 0.84, K.accent);
  box(-1.4, yF + 1.0, cz, 7.35, 0.06, 0.95, [0.88, 0.88, 0.86]);
  box(-1.4, yF + 0.1, cz - 0.43, 7.1, 0.12, 0.02, K.accent2);
  box(RESTO.orderX, yF + 1.06, cz - 0.15, 0.4, 0.3, 0.3, DARK);                         // Kasse
  box(RESTO.orderX, yF + 1.36, cz - 0.15, 0.32, 0.22, 0.04, [0.3, 0.55, 0.8], B.led);   // Kassenbildschirm
  box(-3.6, yF + 1.06, cz, 1.6, 0.42, 0.7, [0.85, 0.92, 0.95], B.bglass);               // Glasvitrine
  for (let i = 0; i < 4; i++) box(-4.2 + i * 0.4, yF + 1.1, cz, 0.3, 0.1, 0.3, i % 2 ? K.accent2 : [0.85, 0.55, 0.3]);
  // --- Küchenzeile, Dunstabzug, Speisetafeln an der Rückwand ---
  box(-1.4, yF, hd - 0.7, 9.2, 0.95, 0.75, STEEL);
  box(-1.4, yF + 0.95, hd - 0.7, 9.3, 0.04, 0.8, [0.6, 0.62, 0.64]);
  box(-1.4, yT - 0.7, hd - 0.6, 6.0, 0.5, 0.9, STEEL);
  for (let i = 0; i < 3; i++) {
    const x = -4.3 + i * 2.9;
    box(x, yF + 2.0, hd - T - 0.03, 2.6, 0.95, 0.05, DARK);
    box(x, yF + 2.06, hd - T - 0.06, 2.48, 0.83, 0.02, i === 1 ? K.accent2 : [0.95, 0.93, 0.85], B.led);
    for (let r = 0; r < 4; r++) box(x - 0.4, yF + 2.2 + r * 0.17, hd - T - 0.075, 1.4, 0.05, 0.01, K.accent);
    box(x + 0.8, yF + 2.35, hd - T - 0.075, 0.5, 0.4, 0.01, [0.85, 0.5, 0.25]);
  }
  // je nach Küche: Pizzaofen, Dönerspieß, Fritteuse, Grillplatte, Schnitzelpfanne
  if (b.kind === 'pizza') {
    const q = W(2.4, hd - 0.75);
    B.flat.cylinder(q[0], yF + 0.95, q[1], 0.75, 0.2, 0.85, 16, 0.75, 0.32, 0.2);
    box(2.4, yF + 1.05, hd - 1.45, 0.5, 0.35, 0.1, [0.95, 0.4, 0.05], B.led);
  } else if (b.kind === 'doner') {
    for (const x of [-4.6, -3.8]) { const q = W(x, cz + 0.05); B.flat.cylinder(q[0], yF + 1.06, q[1], 0.17, 0.22, 0.75, 10, 0.55, 0.32, 0.16); B.flat.cylinder(q[0], yF + 1.8, q[1], 0.02, 0.02, 0.2, 6, 0.7, 0.7, 0.72); }
    box(-4.2, yF + 1.06, cz + 0.3, 1.4, 0.8, 0.08, [1, 0.45, 0.12], B.led);
  } else if (b.kind === 'pommes') {
    for (const x of [-3.2, -2.2]) { box(x, yF + 0.95, hd - 0.7, 0.8, 0.25, 0.6, STEEL); box(x, yF + 1.2, hd - 0.7, 0.6, 0.02, 0.45, [0.95, 0.75, 0.2], B.led); }
  } else if (b.kind === 'burger') {
    box(-2.6, yF + 0.99, hd - 0.7, 1.8, 0.05, 0.6, [0.15, 0.15, 0.15]);
    box(-2.6, yF + 1.04, hd - 0.7, 1.6, 0.01, 0.5, [1, 0.35, 0.08], B.led);
  } else {
    for (const x of [-3, -1.8, -0.6]) { const q = W(x, hd - 0.7); B.flat.cylinder(q[0], yF + 0.99, q[1], 0.22, 0.22, 0.06, 12, 0.15, 0.15, 0.16); }
  }

  // --- Tische mit Stühlen und Hängeleuchten ---
  for (const [x, z] of TABLES) {
    box(x, yF, z, 0.1, 0.72, 0.1, DARK);
    box(x, yF, z, 0.5, 0.03, 0.4, DARK);
    box(x, yF + 0.72, z, 1.0, 0.05, 0.8, b.kind === 'schnitzel' || b.kind === 'pizza' ? WOOD : [0.92, 0.92, 0.9]);
    for (const sx of [-1, 1]) {
      const cx = x + sx * 0.75;
      for (const [ox, oz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) box(cx + ox, yF, z + oz, 0.04, 0.44, 0.04, DARK);
      box(cx, yF + 0.44, z, 0.42, 0.05, 0.42, b.kind === 'schnitzel' ? WOOD_D : K.accent);
      box(cx + sx * 0.2, yF + 0.49, z, 0.04, 0.45, 0.42, b.kind === 'schnitzel' ? WOOD_D : K.accent);
    }
    const q = W(x, z);
    f.cylinder(q[0], yF + 2.1, q[1], 0.005, 0.005, yT - yF - 2.1, 4, 0.1, 0.1, 0.1);
    B.led.cylinder(q[0], yF + 1.95, q[1], 0.18, 0.08, 0.16, 12, 1, 0.85, 0.55);
  }
  // Pflanze an der Tür, Mülleimer
  { const q = W(hw - 0.7, -hd + 0.9); f.cylinder(q[0], yF, q[1], 0.25, 0.2, 0.45, 10, 0.25, 0.25, 0.27); f.cylinder(q[0], yF + 0.45, q[1], 0.35, 0.05, 0.9, 8, 0.2, 0.45, 0.2); }
  box(hw - 0.5, yF, hd - 1.8, 0.4, 0.8, 0.4, STEEL);
}
