// Prozedurale Texturen (Canvas), alle ohne externe Dateien.
import * as THREE from 'three';
import { mulberry32 } from '../util.js';
import { SIGN_COLS, SIGN_ROWS, SIGN_STYLES } from '../world/signs.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(c, { srgb = true, repeat = true, aniso = 8, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = mip;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

function grain(ctx, w, h, amt, rnd, alpha = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  void alpha;
}

// ---------- Gelände-Detail ----------
export function makeDetailTexture() {
  const S = 256;
  const c = canvas(S, S), g = c.getContext('2d');
  const rnd = mulberry32(11);
  const img = g.createImageData(S, S);
  // Mehrere Oktaven kachelbares Wertrauschen
  const grid = (n) => { const a = new Float32Array(n * n); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const octs = [[8, 0.5], [16, 0.28], [32, 0.15], [64, 0.07]].map(([n, w]) => ({ n, w, a: grid(n) }));
  const sm = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const o of octs) {
        const fx = (x / S) * o.n, fy = (y / S) * o.n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
        const a = o.a[(y0 % o.n) * o.n + (x0 % o.n)], b = o.a[(y0 % o.n) * o.n + ((x0 + 1) % o.n)];
        const cc = o.a[((y0 + 1) % o.n) * o.n + (x0 % o.n)], d = o.a[((y0 + 1) % o.n) * o.n + ((x0 + 1) % o.n)];
        v += o.w * ((a + (b - a) * tx) * (1 - ty) + (cc + (d - cc) * tx) * ty);
      }
      const k = (y * S + x) * 4;
      const l = 188 + v * 62 + (rnd() - 0.5) * 12;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = l;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c);
}

// ---------- Fassaden ----------
// Jede Textur: 4×4 Zellen à 128 px (eine Fensterachse × ein Geschoss).
export const FACADE_COLS = 4, FACADE_ROWS = 4;
const CELL = 128;

function facadeBase(kind, seed) {
  const W = CELL * FACADE_COLS, H = CELL * FACADE_ROWS;
  const map = canvas(W, H), emi = canvas(W, H);
  const g = map.getContext('2d'), e = emi.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const rnd = mulberry32(seed);
  return { W, H, map, emi, g, e, rnd };
}

function litColor(rnd) {
  const r = rnd();
  if (r < 0.62) return `rgb(255,${200 + Math.floor(rnd() * 40)},${120 + Math.floor(rnd() * 50)})`; // warm
  if (r < 0.82) return 'rgb(255,244,220)';
  if (r < 0.92) return 'rgb(190,215,255)'; // Fernseher
  return 'rgb(255,170,110)';
}

function windowCell(g, e, x, y, rnd, o = {}) {
  const lit = rnd() < (o.litChance ?? 0.38);
  const wx = x + (o.wx ?? 34), wy = y + (o.wy ?? 26), ww = o.ww ?? 60, wh = o.wh ?? 70;
  // Rahmen
  g.fillStyle = o.frame || '#4a4640';
  g.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
  // Glas
  const grad = g.createLinearGradient(wx, wy, wx + ww * 0.3, wy + wh);
  grad.addColorStop(0, o.glassA || '#3d5265'); grad.addColorStop(1, o.glassB || '#1a2631');
  g.fillStyle = grad; g.fillRect(wx, wy, ww, wh);
  // Spiegelung
  g.fillStyle = 'rgba(255,255,255,0.13)';
  g.beginPath(); g.moveTo(wx, wy + wh * 0.5); g.lineTo(wx + ww * 0.6, wy); g.lineTo(wx + ww, wy); g.lineTo(wx, wy + wh * 0.9); g.fill();
  // Sprossen
  g.fillStyle = o.frame || '#4a4640';
  g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
  if (o.cross !== false) g.fillRect(wx, wy + wh * 0.42, ww, 3);
  // Fensterbank
  g.fillStyle = '#c9c3b6'; g.fillRect(wx - 6, wy + wh + 3, ww + 12, 6);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(wx - 5, wy + wh + 9, ww + 10, 4);
  // Sturz-Schatten
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(wx - 3, wy - 7, ww + 6, 5);
  if (lit) {
    e.fillStyle = litColor(rnd);
    e.globalAlpha = 0.55 + rnd() * 0.45;
    e.fillRect(wx, wy, ww, wh);
    e.globalAlpha = 1;
    e.fillStyle = 'rgba(0,0,0,0.9)';
    e.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
  }
}

function shutters(g, x, y, rnd, col) {
  g.fillStyle = col;
  for (const sx of [x + 12, x + 94]) {
    g.fillRect(sx, y + 22, 22, 78);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let k = 0; k < 8; k++) g.fillRect(sx + 2, y + 26 + k * 9, 18, 2);
    g.fillStyle = col;
  }
}

function noiseWall(g, W, H, base, amt, rnd) {
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  grain(g, W, H, amt, rnd);
}

export function makePlasterFacade() {
  const { W, H, map, emi, g, e, rnd } = facadeBase('plaster', 101);
  noiseWall(g, W, H, '#f6f3ec', 12, rnd);
  for (let r = 0; r < FACADE_ROWS; r++) {
    for (let c = 0; c < FACADE_COLS; c++) {
      const x = c * CELL, y = r * CELL;
      const v = (c + r * 2) % 4;
      // Geschossband
      g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x, y + CELL - 4, CELL, 4);
      if (v === 0) windowCell(g, e, x, y, rnd);
      else if (v === 1) { shutters(g, x, y, rnd, ['#4f7a52', '#5b7f9c', '#7a5535', '#4f7a52'][(c + r) % 4]); windowCell(g, e, x, y, rnd, { wx: 40, ww: 48, cross: false }); }
      else if (v === 2) {
        // Balkon-Tür + Geländer
        windowCell(g, e, x, y, rnd, { wx: 30, wy: 16, ww: 68, wh: 76, cross: false });
        g.fillStyle = '#d8d3c6'; g.fillRect(x + 14, y + 96, 100, 9);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 14, y + 105, 100, 5);
        g.fillStyle = '#3a3a3a'; g.fillRect(x + 16, y + 78, 96, 3);
        for (let k = 0; k < 16; k++) g.fillRect(x + 18 + k * 6, y + 78, 2, 18);
      } else windowCell(g, e, x, y, rnd, { wx: 26, ww: 76, wh: 62, wy: 34 });
    }
  }
  return { map: tex(map), emissive: tex(emi) };
}

export function makeOldFacade() {
  const { W, H, map, emi, g, e, rnd } = facadeBase('old', 202);
  noiseWall(g, W, H, '#efe6d2', 26, rnd);
  // verwitterte Flecken
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${90 + rnd() * 40},${70 + rnd() * 30},50,${0.03 + rnd() * 0.06})`;
    g.beginPath(); g.arc(rnd() * W, rnd() * H, 6 + rnd() * 26, 0, 7); g.fill();
  }
  const cols = ['#4c7a55', '#6b4a2f', '#3f6a87', '#4c7a55'];
  for (let r = 0; r < FACADE_ROWS; r++) {
    for (let c = 0; c < FACADE_COLS; c++) {
      const x = c * CELL, y = r * CELL;
      shutters(g, x, y, rnd, cols[(c * 3 + r) % 4]);
      windowCell(g, e, x, y, rnd, { wx: 44, ww: 40, wh: 64, wy: 28, cross: false, frame: '#5b4636', litChance: 0.3 });
      // Putz-Rahmen
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 3; g.strokeRect(x + 38, y + 22, 52, 78);
      if ((c + r) % 2 === 0) { g.fillStyle = '#2f2a24'; g.fillRect(x + 20, y + 100, 88, 3); for (let k = 0; k < 9; k++) g.fillRect(x + 22 + k * 10, y + 92, 2, 10); }
    }
  }
  return { map: tex(map), emissive: tex(emi) };
}

export function makeHotelFacade() {
  const { W, H, map, emi, g, e, rnd } = facadeBase('hotel', 303);
  noiseWall(g, W, H, '#fbfaf6', 8, rnd);
  for (let r = 0; r < FACADE_ROWS; r++) {
    for (let c = 0; c < FACADE_COLS; c++) {
      const x = c * CELL, y = r * CELL;
      // Balkonplatte
      g.fillStyle = '#e9e6dc'; g.fillRect(x, y + 100, CELL, 14);
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, y + 114, CELL, 8);
      // Brüstung aus Glas
      g.fillStyle = 'rgba(120,170,190,0.55)'; g.fillRect(x + 4, y + 70, CELL - 8, 30);
      g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.strokeRect(x + 4, y + 70, CELL - 8, 30);
      // Schiebetür
      windowCell(g, e, x, y, rnd, { wx: 18, wy: 12, ww: 92, wh: 56, cross: false, frame: '#d2d0c8', litChance: 0.3, glassA: '#4e6f86', glassB: '#22323f' });
      g.fillStyle = '#f08c2c'; if ((c * 5 + r * 3) % 7 === 0) g.fillRect(x + 4, y + 66, CELL - 8, 5); // orange Akzent
    }
  }
  return { map: tex(map), emissive: tex(emi) };
}

export function makeGlassFacade() {
  const { W, H, map, emi, g, e, rnd } = facadeBase('glass', 404);
  for (let r = 0; r < FACADE_ROWS; r++) {
    for (let c = 0; c < FACADE_COLS; c++) {
      const x = c * CELL, y = r * CELL;
      const grad = g.createLinearGradient(x, y, x + CELL, y + CELL);
      const k = ((c + r) % 3);
      grad.addColorStop(0, ['#cfe6f3', '#c2dcea', '#d6ecf0'][k]); grad.addColorStop(0.5, ['#7fb0cb', '#6fa2bf', '#86b9c3'][k]); grad.addColorStop(1, ['#3c6a88', '#335f7d', '#40747f'][k]);
      g.fillStyle = grad; g.fillRect(x, y, CELL, CELL);
      // Spiegelungs-Streifen
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.beginPath(); g.moveTo(x, y + CELL * 0.8); g.lineTo(x + CELL * 0.55, y); g.lineTo(x + CELL * 0.75, y); g.lineTo(x, y + CELL); g.fill();
      // Pfosten & Brüstungsband
      g.fillStyle = '#566069'; g.fillRect(x, y, 5, CELL); g.fillRect(x + CELL - 5, y, 5, CELL);
      g.fillStyle = '#3b444c'; g.fillRect(x, y + CELL - 26, CELL, 26);
      g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(x, y + CELL - 26, CELL, 2);
      if (rnd() < 0.42) {
        e.fillStyle = litColor(rnd); e.globalAlpha = 0.5 + rnd() * 0.5;
        e.fillRect(x + 6, y + 4, CELL - 12, CELL - 34); e.globalAlpha = 1;
      }
    }
  }
  return { map: tex(map), emissive: tex(emi) };
}

export function makeShopFacade() {
  // Ladenfronten: 4 Zellen nebeneinander (Breite je 128 = 5 m), 4 Reihen Varianten
  const { W, H, map, emi, g, e, rnd } = facadeBase('shop', 505);
  noiseWall(g, W, H, '#e9e4d8', 10, rnd);
  const awn = ['#c0392b', '#2c6fb5', '#2e8b57', '#e0a030', '#7d3c98', '#d35400'];
  for (let r = 0; r < FACADE_ROWS; r++) {
    for (let c = 0; c < FACADE_COLS; c++) {
      const x = c * CELL, y = r * CELL;
      // Schaufenster
      const grad = g.createLinearGradient(x, y + 24, x, y + 108);
      grad.addColorStop(0, '#9fb8c8'); grad.addColorStop(1, '#4b6577');
      g.fillStyle = '#383838'; g.fillRect(x + 6, y + 20, CELL - 12, 92);
      g.fillStyle = grad; g.fillRect(x + 10, y + 24, CELL - 20, 84);
      // Tür
      g.fillStyle = '#2b2b2b'; g.fillRect(x + 84, y + 40, 28, 68);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 87, y + 43, 22, 62);
      // Markise
      const col = awn[(c * 2 + r) % awn.length];
      for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#f4f1e8' : col; g.fillRect(x + 4 + k * 15, y + 6, 15, 18); }
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 4, y + 24, 120, 3);
      // Beleuchtung nachts
      e.fillStyle = `rgb(255,${210 + Math.floor(rnd() * 30)},${150 + Math.floor(rnd() * 60)})`; e.globalAlpha = 0.75;
      e.fillRect(x + 10, y + 24, CELL - 20 - 30, 84); e.fillRect(x + 87, y + 43, 22, 62); e.globalAlpha = 1;
    }
  }
  return { map: tex(map), emissive: tex(emi) };
}

export function makeMetalFacade() {
  const { W, H, map, emi, g, e, rnd } = facadeBase('metal', 606);
  g.fillStyle = '#e8eaec'; g.fillRect(0, 0, W, H);
  // Trapezblech
  for (let x = 0; x < W; x += 8) {
    const gr = g.createLinearGradient(x, 0, x + 8, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.22)');
    g.fillStyle = gr; g.fillRect(x, 0, 8, H);
  }
  grain(g, W, H, 14, rnd);
  for (let r = 0; r < FACADE_ROWS; r++) for (let c = 0; c < FACADE_COLS; c++) {
    const x = c * CELL, y = r * CELL;
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + CELL - 3, CELL, 3);
    if (r % 2 === 0) { // Fensterband
      g.fillStyle = '#2a3238'; g.fillRect(x + 10, y + 14, CELL - 20, 22);
      g.fillStyle = 'rgba(170,200,220,0.4)'; g.fillRect(x + 10, y + 14, CELL - 20, 8);
      if (rnd() < 0.3) { e.fillStyle = 'rgb(255,235,190)'; e.fillRect(x + 10, y + 14, CELL - 20, 22); }
    }
    if (c % 2 === 1 && r === FACADE_ROWS - 1) { // Rolltor
      g.fillStyle = '#9aa2a8'; g.fillRect(x + 14, y + 20, 100, 100);
      for (let k = 0; k < 10; k++) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(x + 14, y + 20 + k * 10, 100, 2); }
    }
  }
  return { map: tex(map), emissive: tex(emi) };
}

export function makeClubFacade() {
  const { W, H, map, emi, g, e, rnd } = facadeBase('club', 707);
  g.fillStyle = '#d8d4de'; g.fillRect(0, 0, W, H); grain(g, W, H, 20, rnd);
  for (let r = 0; r < FACADE_ROWS; r++) for (let c = 0; c < FACADE_COLS; c++) {
    const x = c * CELL, y = r * CELL;
    g.fillStyle = '#1b1624'; g.fillRect(x + 12, y + 14, CELL - 24, CELL - 30);
    // Neon-Streifen
    const cols = ['#ff2fd2', '#2ff0ff', '#ffa02f', '#a06bff'];
    const nc = cols[(c + r * 3) % 4];
    g.fillStyle = nc; g.fillRect(x + 12, y + 14, CELL - 24, 4); g.fillRect(x + 12, y + CELL - 20, CELL - 24, 4);
    e.fillStyle = nc; e.fillRect(x + 12, y + 14, CELL - 24, 4); e.fillRect(x + 12, y + CELL - 20, CELL - 24, 4);
    e.globalAlpha = 0.25; e.fillRect(x + 14, y + 20, CELL - 28, CELL - 42); e.globalAlpha = 1;
  }
  return { map: tex(map), emissive: tex(emi) };
}

export function makeFincaFacade() {
  const { W, H, map, emi, g, e, rnd } = facadeBase('finca', 808);
  noiseWall(g, W, H, '#ead9b4', 30, rnd);
  // Steinquader
  g.strokeStyle = 'rgba(90,60,30,0.28)'; g.lineWidth = 2;
  for (let y = 0; y < H; y += 16) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    for (let x = ((y / 16) % 2) * 20; x < W; x += 40 + Math.floor(rnd() * 14)) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 16); g.stroke(); }
  }
  for (let r = 0; r < FACADE_ROWS; r++) for (let c = 0; c < FACADE_COLS; c++) {
    const x = c * CELL, y = r * CELL;
    shutters(g, x, y, rnd, '#8db5c9');
    windowCell(g, e, x, y, rnd, { wx: 42, ww: 44, wh: 64, wy: 28, cross: false, frame: '#6a4a2e', litChance: 0.4 });
  }
  return { map: tex(map), emissive: tex(emi) };
}

// ---------- Dachziegel ----------
export function makeRoofTexture() {
  const S = 256, c = canvas(S, S), g = c.getContext('2d');
  const rnd = mulberry32(55);
  g.fillStyle = '#d9a07e'; g.fillRect(0, 0, S, S);
  const rows = 16, tw = 16;
  for (let r = 0; r < rows; r++) {
    for (let x = -tw; x < S + tw; x += tw) {
      const ox = (r % 2) * (tw / 2);
      const v = 0.86 + rnd() * 0.2;
      g.fillStyle = `rgb(${Math.min(255, 214 * v)},${Math.min(255, 128 * v)},${Math.min(255, 88 * v)})`;
      g.fillRect(x + ox, r * (S / rows), tw - 1, S / rows - 1);
      const gr = g.createLinearGradient(x + ox, 0, x + ox + tw, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0.18)');
      g.fillStyle = gr; g.fillRect(x + ox, r * (S / rows), tw - 1, S / rows - 1);
    }
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, (r + 1) * (S / rows) - 2, S, 2);
  }
  grain(g, S, S, 18, rnd);
  return tex(c);
}

// ---------- Straßen-Atlas ----------
// 16 Streifen × 128 px, Höhe 256 px (entspricht 12 m Straßenlänge)
export const ROAD_COLS = 16;
export const ROAD_TILE_M = 12;
export const ROAD_STRIP = { street: 0, main: 1, rural: 2, scenic: 3, hw: 4, avenue: 5, alley: 6, track: 7, sidewalk: 8, zebra: 9, plain: 10, prom: 11, taxi: 12, runway: 13, quay: 14, apron: 15 };

export function makeRoadAtlas() {
  const W = 128 * ROAD_COLS, H = 256;
  const c = canvas(W, H), g = c.getContext('2d');
  const rnd = mulberry32(909);
  const asphalt = (x, w, base = 60) => {
    g.fillStyle = `rgb(${base},${base},${base + 3})`; g.fillRect(x, 0, w, H);
    const img = g.getImageData(x, 0, w, H);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 20; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, x, 0);
    // Spurrillen (dunkler/heller)
    for (const f of [0.28, 0.72]) { const gr = g.createLinearGradient(x + w * (f - 0.09), 0, x + w * (f + 0.09), 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, 'rgba(0,0,0,0.12)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x + w * (f - 0.09), 0, w * 0.18, H); }
    // Risse / Flicken
    for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(0,0,0,${0.08 + rnd() * 0.1})`; g.fillRect(x + rnd() * w, rnd() * H, 8 + rnd() * 30, 4 + rnd() * 14); }
  };
  const line = (x, w, u, wid, col, dash = null, ypos = 0) => {
    g.fillStyle = col;
    const px = x + w * u - wid / 2;
    if (!dash) { g.fillRect(px, 0, wid, H); return; }
    for (let y = ypos; y < H; y += dash[0] + dash[1]) g.fillRect(px, y, wid, dash[0]);
  };
  const strip = (name, fn) => { const i = ROAD_STRIP[name]; g.save(); g.beginPath(); g.rect(i * 128, 0, 128, H); g.clip(); fn(i * 128, 128); g.restore(); };
  const edge = (x, w, m = 0.045) => { line(x, w, m, 3, '#e8e8e0'); line(x, w, 1 - m, 3, '#e8e8e0'); };
  strip('street', (x, w) => { asphalt(x, w, 70); edge(x, w); line(x, w, 0.5, 4, '#ecebe3', [64, 64], 0); });
  strip('main', (x, w) => { asphalt(x, w, 58); edge(x, w, 0.05); line(x, w, 0.5, 4, '#ecebe3', [64, 96], 0); });
  strip('rural', (x, w) => { asphalt(x, w, 78); edge(x, w, 0.04); line(x, w, 0.5, 4, '#ecebe3', [48, 112], 0); });
  strip('scenic', (x, w) => { asphalt(x, w, 62); edge(x, w, 0.045); line(x, w, 0.485, 3, '#ecebe3'); line(x, w, 0.515, 3, '#ecebe3'); });
  strip('hw', (x, w) => { asphalt(x, w, 52); edge(x, w, 0.04); line(x, w, 0.485, 3, '#ecebe3'); line(x, w, 0.515, 3, '#ecebe3'); line(x, w, 0.27, 3, '#ecebe3', [40, 90]); line(x, w, 0.73, 3, '#ecebe3', [40, 90]); });
  strip('avenue', (x, w) => { asphalt(x, w, 66); edge(x, w, 0.04); line(x, w, 0.485, 3, '#f2c94c'); line(x, w, 0.515, 3, '#f2c94c'); line(x, w, 0.27, 3, '#ecebe3', [40, 90]); line(x, w, 0.73, 3, '#ecebe3', [40, 90]); });
  strip('alley', (x, w) => { asphalt(x, w, 84); edge(x, w, 0.06); });
  strip('track', (x, w) => {
    g.fillStyle = '#8c7a5e'; g.fillRect(x, 0, w, H);
    const img = g.getImageData(x, 0, w, H); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 40; d[i] += n; d[i + 1] += n * 0.9; d[i + 2] += n * 0.7; }
    g.putImageData(img, x, 0);
    for (const f of [0.34, 0.66]) { const gr = g.createLinearGradient(x + w * (f - 0.1), 0, x + w * (f + 0.1), 0); gr.addColorStop(0, 'rgba(60,45,30,0)'); gr.addColorStop(0.5, 'rgba(60,45,30,0.35)'); gr.addColorStop(1, 'rgba(60,45,30,0)'); g.fillStyle = gr; g.fillRect(x + w * (f - 0.1), 0, w * 0.2, H); }
    const gr2 = g.createLinearGradient(x, 0, x + w, 0); gr2.addColorStop(0, 'rgba(90,110,50,0.55)'); gr2.addColorStop(0.15, 'rgba(90,110,50,0)'); gr2.addColorStop(0.85, 'rgba(90,110,50,0)'); gr2.addColorStop(1, 'rgba(90,110,50,0.55)'); g.fillStyle = gr2; g.fillRect(x, 0, w, H);
  });
  strip('sidewalk', (x, w) => {
    g.fillStyle = '#c9c4b8'; g.fillRect(x, 0, w, H);
    const img = g.getImageData(x, 0, w, H); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, x, 0);
    g.strokeStyle = 'rgba(70,65,55,0.45)'; g.lineWidth = 2;
    for (let y = 0; y <= H; y += 42) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); }
    for (let k = 1; k < 3; k++) { g.beginPath(); g.moveTo(x + k * w / 3, 0); g.lineTo(x + k * w / 3, H); g.stroke(); }
    // Bordstein
    g.fillStyle = '#a9a69d'; g.fillRect(x, 0, 6, H); g.fillRect(x + w - 6, 0, 6, H);
  });
  strip('zebra', (x, w) => {
    asphalt(x, w, 62);
    for (let k = 0; k < 9; k++) { g.fillStyle = '#efeee6'; g.fillRect(x + 6 + k * 13.6, 0, 7.6, H); }
  });
  strip('plain', (x, w) => asphalt(x, w, 64));
  strip('prom', (x, w) => {
    g.fillStyle = '#e2d6bd'; g.fillRect(x, 0, w, H);
    // Wellenmuster (schwarz-weiß-beige)
    for (let y = -20; y < H + 20; y += 32) {
      g.strokeStyle = '#6b5f4e'; g.lineWidth = 7; g.beginPath();
      for (let u = 0; u <= w; u += 4) { const yy = y + Math.sin((u / w) * Math.PI * 4) * 9; if (u === 0) g.moveTo(x + u, yy); else g.lineTo(x + u, yy); }
      g.stroke();
    }
    grain(g, 1, 1, 0, rnd);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 5, H); g.fillRect(x + w - 5, 0, 5, H);
  });
  strip('taxi', (x, w) => { asphalt(x, w, 70); line(x, w, 0.5, 5, '#f2c94c'); });
  strip('runway', (x, w) => {
    asphalt(x, w, 40);
    line(x, w, 0.5, 6, '#f0f0ea', [60, 60]);
    line(x, w, 0.03, 4, '#f0f0ea'); line(x, w, 0.97, 4, '#f0f0ea');
    for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + w * (0.3 + 0.07 * k), 0, 3, H); }
  });
  strip('quay', (x, w) => {
    g.fillStyle = '#b9b3a4'; g.fillRect(x, 0, w, H);
    const img = g.getImageData(x, 0, w, H); const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(img, x, 0);
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
    for (let y = 0; y <= H; y += 64) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); }
    g.fillStyle = '#f2c94c'; g.fillRect(x + 4, 0, 4, H);
  });
  strip('apron', (x, w) => { asphalt(x, w, 118); g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2; for (let y = 0; y <= H; y += 128) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); } });
  const t = tex(c, { aniso: 8 });
  t.wrapS = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------- Palmwedel ----------
export function makeFrondTexture() {
  const W = 128, H = 256;
  const c = canvas(W, H), g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  // Mittelrippe
  g.strokeStyle = '#8fb057'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 0); g.stroke();
  // Fiedern
  for (let y = 6; y < H - 6; y += 5) {
    const t = y / H;
    const len = (W / 2 - 4) * (0.35 + 0.65 * Math.sin(Math.PI * (1 - t) * 0.92 + 0.1));
    for (const s of [-1, 1]) {
      const gr = g.createLinearGradient(W / 2, y, W / 2 + s * len, y + 22);
      gr.addColorStop(0, '#c4e17f'); gr.addColorStop(1, '#6f9a3a');
      g.strokeStyle = gr; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(W / 2, y); g.quadraticCurveTo(W / 2 + s * len * 0.6, y + 2, W / 2 + s * len, y + 22 * (1 - t * 0.4)); g.stroke();
    }
  }
  const t = tex(c, { repeat: false });
  return t;
}

// ---------- Weicher Kreis (Glühen, Rauch) ----------
export function makeGlowTexture() {
  const S = 64, c = canvas(S, S), g = c.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  return tex(c, { repeat: false, mip: false });
}

// ---------- Schilder-Atlas ----------
export function makeSignAtlas(list) {
  const CW = 512, CH = 128;
  const c = canvas(CW * SIGN_COLS, CH * SIGN_ROWS), g = c.getContext('2d');
  const e = canvas(CW * SIGN_COLS, CH * SIGN_ROWS), ge = e.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, e.width, e.height);
  g.fillStyle = '#222'; g.fillRect(0, 0, c.width, c.height);
  list.items.forEach((it, i) => {
    const st = SIGN_STYLES[it.style] || SIGN_STYLES.shop;
    const col = i % SIGN_COLS, row = Math.floor(i / SIGN_COLS);
    const x = col * CW, y = row * CH;
    g.fillStyle = st.bg; g.fillRect(x, y, CW, CH);
    g.strokeStyle = st.edge; g.lineWidth = 6; g.strokeRect(x + 5, y + 5, CW - 10, CH - 10);
    g.fillStyle = st.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 72;
    g.font = `800 ${fs}px "Segoe UI", Arial, sans-serif`;
    while (g.measureText(it.text).width > CW - 44 && fs > 18) { fs -= 4; g.font = `800 ${fs}px "Segoe UI", Arial, sans-serif`; }
    g.fillText(it.text, x + CW / 2, y + CH / 2 + 3);
    // Leuchtmaske
    ge.fillStyle = st.fg; ge.textAlign = 'center'; ge.textBaseline = 'middle'; ge.font = g.font;
    ge.fillText(it.text, x + CW / 2, y + CH / 2 + 3);
    ge.strokeStyle = st.edge; ge.lineWidth = 6; ge.strokeRect(x + 5, y + 5, CW - 10, CH - 10);
  });
  return { map: tex(c, { repeat: false, aniso: 4 }), emissive: tex(e, { repeat: false, aniso: 4 }) };
}

// ---------- Pool-Wasser (Kaustik) ----------
export function makePoolTexture() {
  const S = 256, c = canvas(S, S), g = c.getContext('2d');
  const rnd = mulberry32(31);
  g.fillStyle = '#2bb8d6'; g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(190,255,255,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, 7); g.fill(); }
  }
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(230,255,255,0.35)'; g.lineWidth = 1.5;
  for (let i = 0; i < 40; i++) {
    g.beginPath(); const x = rnd() * S, y = rnd() * S; g.moveTo(x, y);
    g.bezierCurveTo(x + 20, y - 12, x + 40, y + 18, x + 60, y + 4); g.stroke();
  }
  return tex(c);
}

// ---------- Himmel/Wolken ----------
export function makeNoiseTexture(size = 256, seed = 7) {
  const c = canvas(size, size), g = c.getContext('2d');
  const rnd = mulberry32(seed);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) { const v = rnd() * 255; img.data[i * 4] = v; img.data[i * 4 + 1] = rnd() * 255; img.data[i * 4 + 2] = rnd() * 255; img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  return t;
}
