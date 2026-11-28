// Laub für Bäume und Büsche: prozeduraler Textur-Atlas (Blattbüschel mit Transparenz) und Kronen aus Blattkarten.
// Atlas 2048 × 1024, 4 × 2 Kacheln à 512²: jede Kachel ist ein Zweig mit Blättern, Nadeln oder Blüten, unten der Ansatz.
import * as THREE from 'three';
import { mulberry32 } from '../util.js';

export const LEAF = { broad: 0, pine: 1, olive: 2, shrub: 3, bougain: 4, cypress: 5, oleander: 6, broad2: 7 };
const COLS = 4, ROWS = 2, TS = 512;

// UV-Rechteck einer Kachel (CanvasTexture: v = 0 unten)
export function tileUV(tile) {
  const tx = tile % COLS, ty = Math.floor(tile / COLS);
  return [tx / COLS + 0.002, 1 - (ty + 1) / ROWS + 0.002, (tx + 1) / COLS - 0.002, 1 - ty / ROWS - 0.002];
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = (c, k = 1, a = 1) => `rgba(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0},${a})`;

// Zweigstruktur: rekursiv vom Ansatz (unten Mitte) nach außen; liefert Segmente und Spitzen
function branches(rnd, x0, y0, ang, len, depth, out) {
  const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
  out.segs.push([x0, y0, x1, y1, depth]);
  if (depth <= 0) { out.tips.push([x1, y1, ang]); return; }
  const n = 2 + (rnd() < 0.45 ? 1 : 0);
  for (let i = 0; i < n; i++) branches(rnd, x1, y1, ang + (rnd() - 0.5) * 1.5, len * (0.62 + rnd() * 0.2), depth - 1, out);
  if (rnd() < 0.5) out.tips.push([x1, y1, ang]);
}

function drawTwigs(g, segs, col, w0) {
  g.lineCap = 'round';
  for (const [x0, y0, x1, y1, d] of segs) { g.strokeStyle = col; g.lineWidth = Math.max(0.8, w0 * (0.45 + d * 0.28)); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
}

// Licht von oben links: oben heller, unten/innen dunkler (Eigenschatten der Krone)
const shadeAt = (x, y, cx, cy, R) => 0.62 + 0.55 * (1 - (y - (cy - R)) / (2 * R)) - 0.18 * Math.hypot(x - cx, y - cy) / R * 0 + (cx - x) / R * 0.06;

function leafPath(g, L, W, kind) {
  g.beginPath();
  if (kind === 'lobed') {               // Platane/Ahorn: gelappt
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2, r = L * (0.72 + 0.28 * Math.abs(Math.cos(a * 2.5))); const x = Math.cos(a) * r, y = Math.sin(a) * r * (W / L); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  } else if (kind === 'heart') {        // Bougainvillea-Hochblatt
    g.moveTo(0, -L * 0.1); g.bezierCurveTo(L * 0.9, -L * 0.9, L * 1.2, L * 0.4, 0, L); g.bezierCurveTo(-L * 1.2, L * 0.4, -L * 0.9, -L * 0.9, 0, -L * 0.1);
  } else {                              // spitz-oval (Laub, Olive, Oleander)
    g.moveTo(-L, 0); g.quadraticCurveTo(0, -W * 1.25, L, 0); g.quadraticCurveTo(0, W * 1.25, -L, 0);
  }
  g.closePath();
}

function drawLeaf(g, x, y, ang, L, W, col, shade, kind = 'oval', vein = true) {
  g.save(); g.translate(x, y); g.rotate(ang);
  leafPath(g, L, W, kind);
  const gr = g.createLinearGradient(0, -W, 0, W);
  gr.addColorStop(0, rgb(col, shade * 1.18)); gr.addColorStop(1, rgb(col, shade * 0.78));
  g.fillStyle = gr; g.fill();
  if (vein && L > 7) { g.strokeStyle = rgb(col, shade * 0.6, 0.55); g.lineWidth = Math.max(0.6, L * 0.05); g.beginPath(); g.moveTo(-L * 0.9, 0); g.lineTo(L * 0.85, 0); g.stroke(); }
  // Glanzlicht
  g.fillStyle = `rgba(255,255,230,${Math.max(0, (shade - 0.95) * 0.35)})`; g.beginPath(); g.ellipse(-L * 0.15, -W * 0.25, L * 0.45, W * 0.3, 0, 0, 7); g.fill();
  g.restore();
}

// ---------- Kacheln ----------
function tileBroad(g, rnd, variant) {
  const C = TS / 2, R = TS * 0.47;
  const out = { segs: [], tips: [] };
  for (let k = 0; k < 5; k++) branches(rnd, C + (rnd() - 0.5) * 30, TS - 6, -Math.PI / 2 + (k - 2) * 0.42 + (rnd() - 0.5) * 0.2, TS * 0.2, 3, out);
  drawTwigs(g, out.segs, '#4b3b2b', 3.2);
  const cols = variant ? ['#3f5d1f', '#4c6b25', '#5a7a2c', '#6a8a33', '#355219', '#78963c'].map(hex) : ['#2f4c1a', '#3a5a1f', '#466a25', '#53782b', '#2a4317', '#5f8431'].map(hex);
  const leaves = [];
  for (const [x, y] of out.tips) for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.6) * 46;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r * 0.85;
    if (Math.hypot(px - C, py - C) > R) continue;
    leaves.push([px, py]);
  }
  leaves.sort((a, b) => a[1] - b[1] < 0 ? 1 : -1);    // unten zuerst, oben liegt darüber (heller)
  for (const [px, py] of leaves) drawLeaf(g, px, py, rnd() * 6.28, 13 + rnd() * 9, 8 + rnd() * 4, cols[(rnd() * cols.length) | 0], shadeAt(px, py, C, C, R) + (rnd() - 0.5) * 0.16, variant ? 'lobed' : 'oval');
}

function tilePine(g, rnd) {
  const C = TS / 2, R = TS * 0.47;
  const out = { segs: [], tips: [] };
  for (let k = 0; k < 6; k++) branches(rnd, C + (rnd() - 0.5) * 40, TS - 6, -Math.PI / 2 + (k - 2.5) * 0.36, TS * 0.19, 3, out);
  drawTwigs(g, out.segs, '#5a4130', 3.4);
  const cols = ['#24401a', '#2d4c1f', '#375a24', '#41682a', '#1e3615', '#4e7431'].map(hex);
  // Nadelbüschel: viele dünne Nadeln strahlen von den Zweigspitzen aus
  const tufts = out.tips.slice().sort((a, b) => b[1] - a[1]);
  for (const [x, y, ang] of tufts) {
    for (let b = 0; b < 2; b++) {
      const tx = x + (rnd() - 0.5) * 24, ty = y + (rnd() - 0.5) * 20;
      if (Math.hypot(tx - C, ty - C) > R - 20) continue;
      const shade = shadeAt(tx, ty, C, C, R);
      for (let i = 0; i < 70; i++) {
        const a = ang + (rnd() - 0.5) * 3.4, L = 22 + rnd() * 26;
        const col = cols[(rnd() * cols.length) | 0];
        g.strokeStyle = rgb(col, shade * (0.8 + rnd() * 0.45)); g.lineWidth = 1.3 + rnd() * 0.9;
        g.beginPath(); g.moveTo(tx, ty); g.quadraticCurveTo(tx + Math.cos(a) * L * 0.5, ty + Math.sin(a) * L * 0.5 - 4, tx + Math.cos(a) * L, ty + Math.sin(a) * L); g.stroke();
      }
    }
  }
}

function tileOlive(g, rnd) {
  const C = TS / 2, R = TS * 0.47;
  const out = { segs: [], tips: [] };
  for (let k = 0; k < 5; k++) branches(rnd, C + (rnd() - 0.5) * 30, TS - 6, -Math.PI / 2 + (k - 2) * 0.45, TS * 0.2, 3, out);
  drawTwigs(g, out.segs, '#5b5146', 2.6);
  const top = hex('#6d7f4d'), top2 = hex('#5c6e40'), under = hex('#a7b09a');
  // schmale Blätter paarweise entlang der Zweige, Ober- und silbrige Unterseite
  for (const [x0, y0, x1, y1, d] of out.segs) {
    if (d > 1) continue;
    const L = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0);
    for (let t = 0.15; t <= 1; t += 0.11) {
      const px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
      if (Math.hypot(px - C, py - C) > R) continue;
      const shade = shadeAt(px, py, C, C, R);
      for (const sg of [-1, 1]) {
        const a = ang + sg * (0.55 + rnd() * 0.35), ll = 15 + rnd() * 8;
        const col = rnd() < 0.3 ? under : rnd() < 0.5 ? top : top2;
        drawLeaf(g, px + Math.cos(a) * ll * 0.9, py + Math.sin(a) * ll * 0.9, a, ll, 3.2 + rnd() * 1.2, col, shade + (rnd() - 0.5) * 0.15, 'oval', false);
      }
    }
    if (rnd() < 0.25) { g.fillStyle = '#2f2236'; g.beginPath(); g.ellipse(x1, y1 + 5, 4, 5, 0, 0, 7); g.fill(); }
    void L;
  }
}

function tileShrub(g, rnd, flowers) {
  const C = TS / 2, R = TS * 0.46;
  const cols = ['#2f5520', '#3a6326', '#45702c', '#527d33', '#28481b', '#5e8a3a'].map(hex);
  const out = { segs: [], tips: [] };
  for (let k = 0; k < 6; k++) branches(rnd, C + (rnd() - 0.5) * 60, TS - 6, -Math.PI / 2 + (k - 2.5) * 0.5, TS * 0.17, 3, out);
  drawTwigs(g, out.segs, '#4a3d2e', 2.4);
  const pts = [];
  for (let i = 0; i < (flowers ? 900 : 1500); i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R, px = C + Math.cos(a) * r, py = C + Math.sin(a) * r * 0.9 + 12;
    if (r > R * 0.86 && rnd() < 0.55) continue;
    pts.push([px, py]);
  }
  pts.sort((a, b) => b[1] - a[1]);
  for (const [px, py] of pts) drawLeaf(g, px, py, rnd() * 6.28, 8 + rnd() * 6, 4.5 + rnd() * 2.5, cols[(rnd() * cols.length) | 0], shadeAt(px, py, C, C, R) + (rnd() - 0.5) * 0.2, 'oval', false);
  if (!flowers) return;
  const fcols = flowers === 'bougain' ? ['#c2186a', '#d82a83', '#a50f58', '#e2449a', '#b81466'].map(hex) : ['#f2a6c4', '#f7c6d8', '#e8879f', '#ffffff', '#f5b3c9'].map(hex);
  for (let c = 0; c < 46; c++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R * 0.85, cx = C + Math.cos(a) * r, cy = C + Math.sin(a) * r * 0.85 - 10;
    const shade = shadeAt(cx, cy, C, C, R) + 0.1;
    for (let i = 0; i < 9; i++) {
      const px = cx + (rnd() - 0.5) * 30, py = cy + (rnd() - 0.5) * 26;
      for (let p = 0; p < 3; p++) drawLeaf(g, px, py, p * 2.09 + rnd() * 0.5, 6 + rnd() * 3, 5, fcols[(rnd() * fcols.length) | 0], shade, flowers === 'bougain' ? 'heart' : 'oval', false);
      g.fillStyle = '#f4f0d8'; g.beginPath(); g.arc(px, py, 1.4, 0, 7); g.fill();
    }
  }
}

function tileCypress(g, rnd) {
  const C = TS / 2, R = TS * 0.47;
  const cols = ['#1d3519', '#24401e', '#2c4b23', '#355629', '#18301a', '#3e622f'].map(hex);
  // fächerförmige Schuppenzweige, dicht, schmal-oval
  for (let i = 0; i < 420; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * R, px = C + Math.cos(a) * r * 0.82, py = C + Math.sin(a) * r;
    const shade = shadeAt(px, py, C, C, R) * 0.95;
    const ang = -Math.PI / 2 + (rnd() - 0.5) * 1.6, L = 16 + rnd() * 16;
    const col = cols[(rnd() * cols.length) | 0];
    g.strokeStyle = rgb(col, shade); g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(ang) * L, py + Math.sin(ang) * L); g.stroke();
    for (let s = 0; s < 6; s++) {
      const t = s / 6, bx = px + Math.cos(ang) * L * t, by = py + Math.sin(ang) * L * t;
      for (const sg of [-1, 1]) { const b = ang + sg * 0.7; g.lineWidth = 1.8; g.strokeStyle = rgb(col, shade * (0.85 + rnd() * 0.35)); g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(b) * L * 0.3 * (1 - t * 0.5), by + Math.sin(b) * L * 0.3 * (1 - t * 0.5)); g.stroke(); }
    }
  }
}

function tileOleander(g, rnd) {
  const C = TS / 2, R = TS * 0.46;
  const out = { segs: [], tips: [] };
  for (let k = 0; k < 6; k++) branches(rnd, C + (rnd() - 0.5) * 50, TS - 6, -Math.PI / 2 + (k - 2.5) * 0.4, TS * 0.2, 2, out);
  drawTwigs(g, out.segs, '#556240', 2.6);
  const cols = ['#3a5c2a', '#466b30', '#2f4f23', '#557a38'].map(hex);
  for (const [x, y, ang] of out.tips) for (let i = 0; i < 12; i++) {
    const a = ang + (rnd() - 0.5) * 2.6, L = 22 + rnd() * 10;
    drawLeaf(g, x + Math.cos(a) * L * 0.9, y + Math.sin(a) * L * 0.9, a, L, 4.2, cols[(rnd() * 4) | 0], shadeAt(x, y, C, C, R) + (rnd() - 0.5) * 0.15);
  }
  void R;
  const fcols = ['#f08cb0', '#f5a9c4', '#e5739b', '#fbd0de'].map(hex);
  for (const [x, y] of out.tips) for (let p = 0; p < 5; p++) {
    const px = x + (rnd() - 0.5) * 20, py = y - 8 + (rnd() - 0.5) * 16;
    for (let q = 0; q < 5; q++) drawLeaf(g, px, py, q * 1.256, 7, 4.5, fcols[(rnd() * 4) | 0], 1.0, 'oval', false);
  }
}

let atlas = null;
export function makeFoliageAtlas() {
  if (atlas) return atlas;
  const c = document.createElement('canvas'); c.width = TS * COLS; c.height = TS * ROWS;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const tiles = [
    (gg, r) => tileBroad(gg, r, 0), tilePine, tileOlive, (gg, r) => tileShrub(gg, r, false),
    (gg, r) => tileShrub(gg, r, 'bougain'), tileCypress, tileOleander, (gg, r) => tileBroad(gg, r, 1),
  ];
  tiles.forEach((fn, i) => {
    const tx = i % COLS, ty = Math.floor(i / COLS);
    g.save(); g.translate(tx * TS, ty * TS);
    g.beginPath(); g.rect(2, 2, TS - 4, TS - 4); g.clip();
    fn(g, mulberry32(4100 + i * 77));
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  atlas = t;
  return t;
}

// ---------- Kronen aus Blattkarten ----------
// Karten in einem Ellipsoid (Mitte c, Radien rx/ry/rz), außen dichter. Normalen zeigen von der Kronenmitte weg (weiche,
// kugelige Beleuchtung). opts: { n, size:[min,max], tile|tiles, tone:[min,max], tint:[r,g,b], tilt (0 = senkrecht,
// 1 = beliebig), flat (Anteil waagerechter Karten, Schirmpinie), shell (0..1, Dichte außen), seed, up (Normalen-Neigung) }
export function cardCrown(mb, cx, cy, cz, rx, ry, rz, opts, rnd) {
  const n = opts.n, tiles = opts.tiles || [opts.tile ?? 0];
  const [s0, s1] = opts.size, [t0, t1] = opts.tone || [0.8, 1.05], tint = opts.tint || [1, 1, 1];
  const shell = opts.shell ?? 0.45, up = opts.up ?? 0.35;
  for (let k = 0; k < n; k++) {
    const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), rr = Math.pow(rnd(), shell);
    let nx = Math.sin(ph) * Math.cos(th), ny = Math.cos(ph), nz = Math.sin(ph) * Math.sin(th);
    if (opts.bottomCut !== undefined && ny < opts.bottomCut) ny = opts.bottomCut + (ny - opts.bottomCut) * 0.3;
    const px = cx + nx * rx * rr, py = cy + ny * ry * rr, pz = cz + nz * rz * rr;
    const S = s0 + rnd() * (s1 - s0);
    let U, V;
    if (opts.flat && rnd() < opts.flat) {
      // fast waagerecht liegende Karte (Schirmkrone)
      const a = rnd() * Math.PI * 2, tl = (rnd() - 0.5) * 0.5;
      U = [Math.cos(a) * S / 2, 0, Math.sin(a) * S / 2];
      V = [-Math.sin(a) * S / 2 * Math.cos(tl), Math.sin(tl) * S / 2, Math.cos(a) * S / 2 * Math.cos(tl)];
    } else {
      // Karte zeigt grob nach außen, um die Hochachse gedreht und geneigt
      const a = Math.atan2(nz, nx) + Math.PI / 2 + (rnd() - 0.5) * 1.2, b = (rnd() - 0.5) * (opts.tilt ?? 1.2);
      const ux = Math.cos(a), uz = Math.sin(a);
      U = [ux * S / 2, 0, uz * S / 2];
      V = [-uz * Math.sin(b) * S / 2, Math.cos(b) * S / 2, ux * Math.sin(b) * S / 2];
    }
    const p = (su, sv) => [px + U[0] * su + V[0] * sv, py + U[1] * su + V[1] * sv, pz + U[2] * su + V[2] * sv];
    const tile = tiles[(rnd() * tiles.length) | 0];
    const [u0, v0, u1, v1] = tileUV(tile);
    // innen dunkler (Eigenschatten), außen und oben heller
    const tone = (t0 + rnd() * (t1 - t0)) * (0.7 + 0.3 * rr) * (1 + ny * 0.08);
    const i0 = mb.n;
    mb.quad(p(-1, -1), p(1, -1), p(1, 1), p(-1, 1), 0, 1, 0, u0, v0, u1, v1, tone * tint[0], tone * tint[1], tone * tint[2]);
    const ln = Math.hypot(nx, ny + up, nz) || 1;
    for (let q = i0; q < mb.n; q++) { mb.nor[q * 3] = nx / ln; mb.nor[q * 3 + 1] = (ny + up) / ln; mb.nor[q * 3 + 2] = nz / ln; }
  }
}
