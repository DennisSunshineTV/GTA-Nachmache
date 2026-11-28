// Hochauflösende, kachelbare Detailtexturen (prozedural, ohne Dateien): Asphalt-Körnung, Straßenabnutzung,
// Kies, Rasen, Grasbüschel, Blätter, Putz, Dachziegel, Holz, Naturstein, Hecke, Zaunstäbe.
// Höhenfelder werden zu Normalenkarten umgerechnet (R = x, G = y, B = z; linear, nicht sRGB).
import * as THREE from 'three';
import { mulberry32 } from '../util.js';

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function tex(c, { srgb = true, aniso = 16, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

// Ganzzahl-Hash -> [0,1)
function h2(i, j, s) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Periodisches Wertrauschen (Periode P Zellen), x,y in Zelleinheiten
function vnoise(x, y, P, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const i0 = ((xi % P) + P) % P, j0 = ((yi % P) + P) % P, i1 = (i0 + 1) % P, j1 = (j0 + 1) % P;
  const a = h2(i0, j0, s), b = h2(i1, j0, s), c = h2(i0, j1, s), d = h2(i1, j1, s);
  return (a + (b - a) * ux) * (1 - uy) + (c + (d - c) * ux) * uy;
}

// fbm über eine kachelbare Fläche (u,v in [0,1)), Grundperiode base Zellen
function fbm(u, v, base, oct, s) {
  let sum = 0, amp = 0.5, norm = 0, P = base;
  for (let o = 0; o < oct; o++) { sum += amp * vnoise(u * P, v * P, P, s + o * 31); norm += amp; amp *= 0.5; P *= 2; }
  return sum / norm;
}

// Höhenfeld -> Normalenkarte (Kanvas, gekachelt)
function normalCanvas(hgt, W, H, strength) {
  const c = canvas(W, H), g = c.getContext('2d');
  const img = g.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    const ym = ((y - 1 + H) % H) * W, yp = ((y + 1) % H) * W, y0 = y * W;
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      const dx = (hgt[y0 + xp] - hgt[y0 + xm]) * strength, dy = (hgt[yp + x] - hgt[ym + x]) * strength;
      // Kanvas-y zeigt nach unten, Textur-v nach oben: dy umdrehen
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const k = (y0 + x) * 4;
      d[k] = (nx * 0.5 + 0.5) * 255; d[k + 1] = (ny * 0.5 + 0.5) * 255; d[k + 2] = (nz * 0.5 + 0.5) * 255; d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Farb- und Höhenpuffer mit gekachelten Ellipsen (Steine, Körner, Blätter)
function surface(W, H) {
  return { W, H, col: new Float32Array(W * H * 3), hgt: new Float32Array(W * H) };
}
function blot(S, cx, cy, rx, ry, ang, rgb, hTop, opts = {}) {
  const { W, H, col, hgt } = S;
  const ca = Math.cos(ang), sa = Math.sin(ang), R = Math.ceil(Math.max(rx, ry)) + 1;
  for (let oy = -R; oy <= R; oy++) {
    for (let ox = -R; ox <= R; ox++) {
      const lx = (ox * ca + oy * sa) / rx, ly = (-ox * sa + oy * ca) / ry;
      const q = lx * lx + ly * ly;
      if (q >= 1) continue;
      const x = ((Math.round(cx) + ox) % W + W) % W, y = ((Math.round(cy) + oy) % H + H) % H, i = y * W + x;
      const dome = Math.sqrt(1 - q);
      const hh = hTop * (opts.flat ? Math.min(1, dome * 3) : dome);
      if (hh < hgt[i] && !opts.paint) continue;
      if (!opts.paint) hgt[i] = hh;
      const sh = opts.shade === false ? 1 : 0.84 + 0.16 * dome;
      const e = opts.edge && q > 0.7 ? opts.edge : 1;
      col[i * 3] = rgb[0] * sh * e; col[i * 3 + 1] = rgb[1] * sh * e; col[i * 3 + 2] = rgb[2] * sh * e;
    }
  }
}
function toCanvas(S, gain = 1) {
  const { W, H, col } = S;
  const c = canvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  for (let i = 0; i < W * H; i++) {
    d[i * 4] = Math.min(255, col[i * 3] * gain); d[i * 4 + 1] = Math.min(255, col[i * 3 + 1] * gain); d[i * 4 + 2] = Math.min(255, col[i * 3 + 2] * gain); d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------- Asphalt: Bitumen mit Gesteinskörnung (1024², 2,5 m je Kachel ≈ 4 mm pro Pixel) ----------
export function makeAsphaltDetail() {
  const W = 1024, S = surface(W, W), rnd = mulberry32(4401);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const n = fbm(x / W, y / W, 16, 4, 7);
      const v = 60 + (n - 0.5) * 18 + (rnd() - 0.5) * 8;
      const i = y * W + x;
      S.col[i * 3] = v; S.col[i * 3 + 1] = v; S.col[i * 3 + 2] = v * 1.03;
      S.hgt[i] = 0.18 + n * 0.1;
    }
  }
  // Körnung: viele kleine, unterschiedlich helle Steine
  for (let k = 0; k < 34000; k++) {
    const r = 1.2 + Math.pow(rnd(), 2.2) * 3.6, asp = 0.65 + rnd() * 0.35;
    const tone = rnd();
    let c;
    if (tone < 0.6) { const v = 70 + rnd() * 32; c = [v, v * (0.98 + rnd() * 0.04), v * (0.97 + rnd() * 0.07)]; }
    else if (tone < 0.93) { const v = 96 + rnd() * 36; c = [v * 1.02, v, v * 0.96]; }
    else { const v = 128 + rnd() * 46; c = [v, v * 0.98, v * 0.94]; }
    blot(S, rnd() * W, rnd() * W, r, r * asp, rnd() * 6.28, c, 0.45 + rnd() * 0.55, { edge: 0.78 });
  }
  // feine helle Quarzpunkte und dunkle Poren
  for (let k = 0; k < 9000; k++) {
    const x = (rnd() * W) | 0, y = (rnd() * W) | 0, i = y * W + x;
    if (rnd() < 0.3) { const v = 150 + rnd() * 50; S.col[i * 3] = v; S.col[i * 3 + 1] = v; S.col[i * 3 + 2] = v; }
    else { S.col[i * 3] *= 0.55; S.col[i * 3 + 1] *= 0.55; S.col[i * 3 + 2] *= 0.55; S.hgt[i] *= 0.4; }
  }
  return { map: tex(toCanvas(S)), normal: tex(normalCanvas(S.hgt, W, W, 1.8), { srgb: false }) };
}

// ---------- Abnutzung im Straßenraum (512 × 1024 = 8 m quer × 32 m längs) ----------
// R: Risse/Fugenverguss (dunkel), G: Flicken (0.5 neutral), B: Farbabrieb der Markierung (1 = intakt)
export function makeRoadWear() {
  const W = 512, H = 1024, rnd = mulberry32(5150);
  const mk = () => { const c = canvas(W, H), g = c.getContext('2d'); return [c, g]; };
  const [cr, gr] = mk(), [cp, gp] = mk(), [cw, gw] = mk();
  gr.fillStyle = '#000'; gr.fillRect(0, 0, W, H);
  gp.fillStyle = 'rgb(128,128,128)'; gp.fillRect(0, 0, W, H);
  gw.fillStyle = '#fff'; gw.fillRect(0, 0, W, H);
  // Risse: verzweigte, zittrige Linien (gekachelt: an allen Rändern wiederholt zeichnen)
  const wrap = (g, fn) => { for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) { g.save(); g.translate(ox, oy); fn(g); g.restore(); } };
  const crack = (x, y, ang, len, w, depth) => {
    const pts = [[x, y]];
    for (let s = 0; s < len; s += 4) { ang += (rnd() - 0.5) * 0.28; x += Math.cos(ang) * 4; y += Math.sin(ang) * 4; pts.push([x, y]); if (depth < 2 && rnd() < 0.025) crack(x, y, ang + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd()), len * 0.4, w * 0.8, depth + 1); }
    wrap(gr, (g) => { g.strokeStyle = `rgba(255,255,255,${0.35 + rnd() * 0.3})`; g.lineWidth = w; g.lineJoin = 'round'; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.stroke(); });
  };
  for (let k = 0; k < 5; k++) crack(rnd() * W, rnd() * H, Math.PI / 2 + (rnd() - 0.5) * 0.3, 100 + rnd() * 300, 0.9 + rnd() * 0.8, 0);   // Längsrisse
  for (let k = 0; k < 3; k++) crack(rnd() * W, rnd() * H, (rnd() - 0.5) * 0.4, 50 + rnd() * 160, 0.8 + rnd() * 0.6, 0);                       // Querrisse
  // Vergossene Fugen (breiter, bitumenschwarz, leicht glänzend)
  for (let k = 0; k < 2; k++) {
    let x = rnd() * W, y = rnd() * H, ang = Math.PI / 2 + (rnd() - 0.5) * 0.3;
    const pts = [[x, y]];
    for (let s = 0; s < 300 + rnd() * 400; s += 6) { ang += (rnd() - 0.5) * 0.25; x += Math.cos(ang) * 6; y += Math.sin(ang) * 6; pts.push([x, y]); }
    wrap(gr, (g) => { g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 3 + rnd() * 2; g.lineCap = 'round'; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.stroke(); });
  }
  // Flicken: dunklere, neuere Asphaltrechtecke mit Fugenrand
  for (let k = 0; k < 5; k++) {
    const w = 40 + rnd() * 140, h = 60 + rnd() * 260, x = rnd() * W, y = rnd() * H, v = rnd() < 0.7 ? 92 + rnd() * 20 : 150 + rnd() * 20;
    wrap(gp, (g) => { g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, w, h); });
    wrap(gr, (g) => { g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 2; g.strokeRect(x, y, w, h); });
  }
  // großflächige Tönung (ausgeblichene/ölige Zonen)
  for (let k = 0; k < 40; k++) {
    const x = rnd() * W, y = rnd() * H, r = 20 + rnd() * 90, v = rnd() < 0.5 ? 108 : 148;
    wrap(gp, (g) => { const gg = g.createRadialGradient(x, y, 0, x, y, r); gg.addColorStop(0, `rgba(${v},${v},${v},0.35)`); gg.addColorStop(1, `rgba(${v},${v},${v},0)`); g.fillStyle = gg; g.fillRect(x - r, y - r, 2 * r, 2 * r); });
  }
  // Farbabrieb: Sprenkel und abgefahrene Stellen
  for (let k = 0; k < 2600; k++) {
    const x = rnd() * W, y = rnd() * H, r = 0.6 + Math.pow(rnd(), 3) * 9, a = 0.25 + rnd() * 0.65;
    wrap(gw, (g) => { g.fillStyle = `rgba(0,0,0,${a})`; g.beginPath(); g.ellipse(x, y, r, r * (0.4 + rnd() * 0.6), rnd() * 3, 0, 7); g.fill(); });
  }
  const dr = gr.getImageData(0, 0, W, H).data, dp = gp.getImageData(0, 0, W, H).data, dw = gw.getImageData(0, 0, W, H).data;
  const out = canvas(W, H), go = out.getContext('2d'), img = go.createImageData(W, H), d = img.data;
  for (let i = 0; i < W * H * 4; i += 4) { d[i] = dr[i]; d[i + 1] = dp[i]; d[i + 2] = dw[i]; d[i + 3] = 255; }
  go.putImageData(img, 0, 0);
  return tex(out, { srgb: false, aniso: 8 });
}

// ---------- Weiches Rauschen (RGB: drei Frequenzen) für großflächige Variation ----------
export function makeSoftNoise() {
  const W = 256, c = canvas(W, W), g = c.getContext('2d'), img = g.createImageData(W, W), d = img.data;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / W, k = (y * W + x) * 4;
    d[k] = fbm(u, v, 4, 4, 11) * 255; d[k + 1] = fbm(u, v, 8, 4, 23) * 255; d[k + 2] = fbm(u, v, 16, 3, 37) * 255; d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false, aniso: 4 });
}

// ---------- Kies/Feldweg (512², 1,6 m) ----------
export function makeGravel() {
  const W = 512, S = surface(W, W), rnd = mulberry32(6262);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const n = fbm(x / W, y / W, 8, 4, 3), i = y * W + x;
    const v = 0.82 + (n - 0.5) * 0.35 + (rnd() - 0.5) * 0.06;
    S.col[i * 3] = 166 * v; S.col[i * 3 + 1] = 144 * v; S.col[i * 3 + 2] = 110 * v; S.hgt[i] = 0.1 + n * 0.15;
  }
  const pal = [[196, 180, 150], [178, 166, 146], [206, 196, 174], [156, 134, 104], [140, 128, 112], [188, 168, 134]];
  for (let k = 0; k < 15000; k++) {
    const r = 1 + Math.pow(rnd(), 2.4) * 5.5, c = pal[(rnd() * pal.length) | 0], t = 0.85 + rnd() * 0.25;
    blot(S, rnd() * W, rnd() * W, r, r * (0.6 + rnd() * 0.4), rnd() * 6.28, [c[0] * t, c[1] * t, c[2] * t], 0.35 + rnd() * 0.65, { edge: 0.8 });
  }
  return { map: tex(toCanvas(S)), normal: tex(normalCanvas(S.hgt, W, W, 3), { srgb: false }) };
}

// ---------- Rasen von oben (512², 1,2 m) ----------
export function makeGrassGround() {
  const W = 512, c = canvas(W, W), g = c.getContext('2d'), rnd = mulberry32(7373);
  g.fillStyle = '#41592a'; g.fillRect(0, 0, W, W);
  const img = g.getImageData(0, 0, W, W), d = img.data;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const n = fbm(x / W, y / W, 6, 3, 9), k = (y * W + x) * 4, f = 0.75 + n * 0.5; d[k] *= f; d[k + 1] *= f; d[k + 2] *= f; }
  g.putImageData(img, 0, 0);
  const cols = ['#5d7d34', '#6f9140', '#86a54b', '#4c6a2a', '#a5b65e', '#7c9a3c', '#b8ad6b', '#93a856'];
  for (let k = 0; k < 26000; k++) {
    const x = rnd() * W, y = rnd() * W, a = rnd() * 6.28, l = 3 + rnd() * 11;
    g.strokeStyle = cols[(rnd() * cols.length) | 0]; g.globalAlpha = 0.55 + rnd() * 0.45; g.lineWidth = 0.8 + rnd() * 1.1;
    for (const ox of [-W, 0, W]) for (const oy of [-W, 0, W]) { if (x + ox < -20 || x + ox > W + 20 || y + oy < -20 || y + oy > W + 20) continue; g.beginPath(); g.moveTo(x + ox, y + oy); g.quadraticCurveTo(x + ox + Math.cos(a) * l * 0.5 + 2, y + oy + Math.sin(a) * l * 0.5, x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); g.stroke(); }
  }
  g.globalAlpha = 1;
  for (let k = 0; k < 160; k++) { g.fillStyle = rnd() < 0.6 ? '#f2f0e4' : rnd() < 0.6 ? '#f0d23c' : '#b58ad8'; g.beginPath(); g.arc(rnd() * W, rnd() * W, 1.2 + rnd() * 1.4, 0, 7); g.fill(); }
  // Höhe aus Helligkeit (Halme heller = höher)
  const dd = g.getImageData(0, 0, W, W).data, hgt = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) hgt[i] = (dd[i * 4 + 1] / 255);
  return { map: tex(c), normal: tex(normalCanvas(hgt, W, W, 1.6), { srgb: false }) };
}

// ---------- Grasbüschel mit Wildblumen (Alpha, 512 × 256) ----------
export function makeGrassCard() {
  const W = 512, H = 256, c = canvas(W, H), g = c.getContext('2d'), rnd = mulberry32(8484);
  g.clearRect(0, 0, W, H);
  const cols = ['#566f2c', '#617a31', '#6c8638', '#78903e', '#86994a', '#93a055', '#a3a565', '#5a7530', '#8a8a52'];
  // Horste: Halme fächern von einem Fußpunkt aus; meist kurz, einzelne lange – ergibt eine zerzauste Silhouette
  const clumps = 11;
  for (let q = 0; q < clumps; q++) {
    const bx = 24 + (q + rnd() * 0.8) * (W - 48) / clumps, tallK = 0.55 + rnd() * 0.45;
    const n = 18 + (rnd() * 16) | 0;
    for (let k = 0; k < n; k++) {
      const u = rnd(), h = H * (0.18 + Math.pow(u, 2.3) * 0.78) * tallK, w = 1.6 + rnd() * 2.6;
      const ang = (rnd() - 0.5) * 1.1, tipX = bx + Math.sin(ang) * h * 0.9, tipY = H - Math.cos(ang) * h;
      const col = cols[(rnd() * cols.length) | 0];
      const grd = g.createLinearGradient(0, H, 0, tipY);
      grd.addColorStop(0, '#26331a'); grd.addColorStop(0.3, col); grd.addColorStop(1, col);
      g.fillStyle = grd;
      const bend = (rnd() - 0.5) * 30;
      g.beginPath(); g.moveTo(bx - w, H);
      g.quadraticCurveTo(bx - w * 0.5 + (tipX - bx) * 0.4 + bend, H - h * 0.55, tipX, tipY);
      g.quadraticCurveTo(bx + w * 0.5 + (tipX - bx) * 0.4 + bend, H - h * 0.55, bx + w, H);
      g.closePath(); g.fill();
    }
  }
  // Rispen/Ähren an einzelnen langen Halmen
  for (let k = 0; k < 14; k++) {
    const x = 20 + rnd() * (W - 40), y = 20 + rnd() * 70;
    g.strokeStyle = '#7c8645'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + (rnd() - 0.5) * 30, H); g.quadraticCurveTo(x, (H + y) / 2, x, y); g.stroke();
    g.fillStyle = rnd() < 0.5 ? '#b2a46a' : '#8f8a5a';
    for (let p = 0; p < 6; p++) { g.beginPath(); g.ellipse(x + (rnd() - 0.5) * 3, y + p * 4, 1.6, 3, 0, 0, 7); g.fill(); }
  }
  // Blüten (Margeriten, Hahnenfuß, Klee, Glockenblumen)
  const flower = (x, y, kind) => {
    g.strokeStyle = '#5b7a2e'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x + (rnd() - 0.5) * 14, H); g.quadraticCurveTo(x + (rnd() - 0.5) * 20, (H + y) / 2, x, y); g.stroke();
    if (kind === 0) { g.fillStyle = '#f4f2e8'; for (let p = 0; p < 9; p++) { const a = p / 9 * 6.28; g.beginPath(); g.ellipse(x + Math.cos(a) * 4.5, y + Math.sin(a) * 2.6, 4, 1.6, a, 0, 7); g.fill(); } g.fillStyle = '#e2b11b'; g.beginPath(); g.arc(x, y, 2.3, 0, 7); g.fill(); }
    else if (kind === 1) { g.fillStyle = '#eccb22'; for (let p = 0; p < 5; p++) { const a = p / 5 * 6.28; g.beginPath(); g.arc(x + Math.cos(a) * 2.3, y + Math.sin(a) * 2, 2.3, 0, 7); g.fill(); } }
    else if (kind === 2) { g.fillStyle = '#b9578a'; g.beginPath(); g.ellipse(x, y, 3.5, 4.5, 0, 0, 7); g.fill(); g.fillStyle = '#d67aa8'; g.beginPath(); g.ellipse(x - 1, y - 1, 1.8, 2.2, 0, 0, 7); g.fill(); }
    else { g.fillStyle = '#7562c0'; for (let p = 0; p < 3; p++) { g.beginPath(); g.ellipse(x + (p - 1) * 3.5, y + p * 4.5, 2.2, 3.2, 0, 0, 7); g.fill(); } }
  };
  for (let k = 0; k < 13; k++) flower(20 + rnd() * (W - 40), 40 + rnd() * 110, (rnd() * 4) | 0);
  const t = tex(c, { repeat: false, aniso: 4 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------- Blattwerk (Alpha, 512²) für Laubbaum-Kronen ----------
export function makeLeafCard() {
  const W = 512, c = canvas(W, W), g = c.getContext('2d'), rnd = mulberry32(9595);
  g.clearRect(0, 0, W, W);
  const cols = ['#2a4419', '#33521e', '#3d5c22', '#476627', '#52702d', '#385a20', '#5c7a34', '#243c15'];
  // Zweige
  g.strokeStyle = '#4a3a2a'; g.lineWidth = 3;
  for (let k = 0; k < 7; k++) { g.beginPath(); g.moveTo(W / 2, W - 10); g.quadraticCurveTo(W / 2 + (rnd() - 0.5) * 200, W / 2, 60 + rnd() * (W - 120), 60 + rnd() * (W - 200)); g.stroke(); }
  for (let k = 0; k < 1700; k++) {
    // Blätter in einer lockeren, runden Wolke
    const a = rnd() * 6.28, r = Math.sqrt(rnd()) * (W * 0.46), x = W / 2 + Math.cos(a) * r, y = W / 2 + Math.sin(a) * r * 0.92;
    const edge = r / (W * 0.46);
    if (edge > 0.85 && rnd() < 0.5) continue;
    const L = 9 + rnd() * 9, ang = rnd() * 6.28;
    const shade = 0.75 + (1 - y / W) * 0.35 + (rnd() - 0.5) * 0.2;
    const col = cols[(rnd() * cols.length) | 0];
    g.save(); g.translate(x, y); g.rotate(ang);
    g.fillStyle = col; g.globalAlpha = 1;
    g.beginPath(); g.ellipse(0, 0, L, L * 0.48, 0, 0, 7); g.fill();
    g.fillStyle = `rgba(220,235,180,${Math.max(0, (shade - 0.95) * 0.3)})`; g.beginPath(); g.ellipse(-L * 0.2, -L * 0.1, L * 0.6, L * 0.25, 0, 0, 7); g.fill();
    g.fillStyle = `rgba(0,0,0,${Math.max(0, (1 - shade) * 0.5)})`; g.beginPath(); g.ellipse(0, 0, L, L * 0.48, 0, 0, 7); g.fill();
    g.strokeStyle = 'rgba(20,35,10,0.45)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
    g.restore();
  }
  const t = tex(c, { repeat: false, aniso: 4 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------- Putz (512², 2 m): feiner Kratzputz, wird per Vertexfarbe getönt ----------
export function makePlaster() {
  const W = 512, S = surface(W, W), rnd = mulberry32(1212);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const n = fbm(x / W, y / W, 4, 4, 5), m = fbm(x / W, y / W, 32, 2, 6), i = y * W + x;
    const v = 238 + (n - 0.5) * 14 + (m - 0.5) * 10 + (rnd() - 0.5) * 8;
    S.col[i * 3] = v; S.col[i * 3 + 1] = v * 0.995; S.col[i * 3 + 2] = v * 0.98; S.hgt[i] = m * 0.3 + rnd() * 0.08;
  }
  for (let k = 0; k < 22000; k++) { const r = 0.6 + rnd() * 1.6; const v = 225 + rnd() * 30; blot(S, rnd() * W, rnd() * W, r, r, 0, [v, v, v * 0.98], 0.4 + rnd() * 0.5); }
  return { map: tex(toCanvas(S)), normal: tex(normalCanvas(S.hgt, W, W, 2.4), { srgb: false }) };
}

// ---------- Dachziegel (512² = 4 × 4 Pfannen à 0,3 m): Graustufen, Tönung per Vertexfarbe ----------
export function makeRoofTiles() {
  const W = 512, T = 128, S = surface(W, W), rnd = mulberry32(3434);
  const tone = [];
  for (let r = 0; r < 4; r++) for (let q = 0; q < 4; q++) tone.push(0.86 + rnd() * 0.24);
  for (let y = 0; y < W; y++) {
    const row = Math.floor(y / T), fy = (y % T) / T;     // fy: 0 = oben (zum First), 1 = unten (Traufe)
    for (let x = 0; x < W; x++) {
      const shift = (row % 2) * T / 2;
      const xx = (x + shift) % W, col = Math.floor(xx / T), fx = (xx % T) / T;
      // Profil quer: große Welle + kleiner Wulst (Frankfurter Pfanne)
      const prof = 0.55 * Math.pow(Math.sin(Math.PI * fx), 0.7) + 0.18 * Math.max(0, Math.sin(Math.PI * (fx * 2.2 - 1.2)));
      // längs: Pfanne wird zur unteren Kante hin dicker, darunter Schatten der nächsten Reihe
      const lip = fy > 0.9 ? 1 - (fy - 0.9) / 0.1 * 0.6 : 1;
      const h = (prof * 0.8 + fy * 0.6) * lip;
      const i = y * W + x, t = tone[(row * 4 + col) % 16];
      let v = 150 * t * (0.78 + prof * 0.42);
      if (fy < 0.14) v *= 0.32 + (fy / 0.14) * 0.68;    // Schatten unter der darüberliegenden Reihe
      else if (fy > 0.84) v *= 1.12;                    // helle Unterkante (Wulst)
      if (fx < 0.03 || fx > 0.97) v *= 0.7;           // Stoßfuge
      v *= 0.93 + rnd() * 0.12;
      S.col[i * 3] = v; S.col[i * 3 + 1] = v; S.col[i * 3 + 2] = v; S.hgt[i] = h;
    }
  }
  // Flechten/Moos-Sprenkel und Verschmutzung
  for (let k = 0; k < 900; k++) { const r = 0.8 + rnd() * 2.6, v = 120 + rnd() * 70; blot(S, rnd() * W, rnd() * W, r, r * 0.8, rnd() * 3, [v * 1.02, v * 1.05, v * 0.9], 0, { paint: true, shade: false }); }
  return { map: tex(toCanvas(S)), normal: tex(normalCanvas(S.hgt, W, W, 5), { srgb: false }) };
}

// ---------- Holz (256 × 512, 0,5 × 1 m): Maserung längs v ----------
export function makeWood() {
  const W = 256, H = 512, c = canvas(W, H), g = c.getContext('2d'), rnd = mulberry32(5656);
  const img = g.createImageData(W, H), d = img.data, hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const ring = Math.sin((u * 26 + fbm(u, v, 4, 3, 2) * 6) * Math.PI * 2) * 0.5 + 0.5;
    const n = fbm(u, v * 0.25, 16, 3, 8);
    const k = 0.78 + ring * 0.16 + (n - 0.5) * 0.18 + (rnd() - 0.5) * 0.05;
    const i = (y * W + x);
    d[i * 4] = 190 * k; d[i * 4 + 1] = 150 * k; d[i * 4 + 2] = 108 * k; d[i * 4 + 3] = 255; hgt[i] = ring * 0.3;
  }
  g.putImageData(img, 0, 0);
  return { map: tex(c), normal: tex(normalCanvas(hgt, W, H, 1.2), { srgb: false }) };
}

// ---------- Naturstein-Mauerwerk (512², 1,2 m) ----------
export function makeStoneWall() {
  const W = 512, S = surface(W, W), rnd = mulberry32(7878);
  for (let i = 0; i < W * W; i++) { S.col[i * 3] = 112; S.col[i * 3 + 1] = 108; S.col[i * 3 + 2] = 100; S.hgt[i] = 0; }   // Fuge
  let y = 0;
  while (y < W) {
    const rh = 34 + rnd() * 30;
    let x = rnd() * 40;
    while (x < W + 60) {
      const sw = 50 + rnd() * 70, t = 0.8 + rnd() * 0.35, hue = rnd();
      const base = hue < 0.4 ? [178, 170, 156] : hue < 0.75 ? [160, 156, 150] : [190, 176, 150];
      const cx = x + sw / 2, cy = y + rh / 2;
      // abgerundetes Rechteck als Ellipsen-Stapel (gekachelt)
      for (let oy = -rh / 2 + 3; oy < rh / 2 - 3; oy++) {
        for (let ox = -sw / 2 + 3; ox < sw / 2 - 3; ox++) {
          const qx = Math.abs(ox) / (sw / 2 - 3), qy = Math.abs(oy) / (rh / 2 - 3);
          const q = Math.pow(qx, 4) + Math.pow(qy, 4);
          if (q > 1) continue;
          const px = ((Math.round(cx + ox) % W) + W) % W, py = ((Math.round(cy + oy) % W) + W) % W, i = py * W + px;
          const dome = Math.pow(1 - q, 0.35);
          const v = t * (0.86 + dome * 0.14) * (0.94 + rnd() * 0.12);
          S.col[i * 3] = base[0] * v; S.col[i * 3 + 1] = base[1] * v; S.col[i * 3 + 2] = base[2] * v; S.hgt[i] = 0.4 + dome * 0.6;
        }
      }
      x += sw + 4 + rnd() * 4;
    }
    y += rh + 4;
  }
  return { map: tex(toCanvas(S)), normal: tex(normalCanvas(S.hgt, W, W, 3.2), { srgb: false }) };
}

// ---------- Hecke (256², 0,8 m) ----------
export function makeHedge() {
  const W = 256, S = surface(W, W), rnd = mulberry32(2323);
  for (let i = 0; i < W * W; i++) { S.col[i * 3] = 22; S.col[i * 3 + 1] = 38; S.col[i * 3 + 2] = 16; }
  const pal = [[52, 86, 34], [64, 100, 40], [78, 112, 46], [44, 74, 30], [92, 124, 56]];
  for (let k = 0; k < 5200; k++) { const c = pal[(rnd() * pal.length) | 0], t = 0.8 + rnd() * 0.4, L = 3 + rnd() * 4; blot(S, rnd() * W, rnd() * W, L, L * 0.5, rnd() * 6.28, [c[0] * t, c[1] * t, c[2] * t], 0.2 + rnd() * 0.8); }
  return { map: tex(toCanvas(S)), normal: tex(normalCanvas(S.hgt, W, W, 2.5), { srgb: false }) };
}

// ---------- Zaunfelder aus Metallstäben (Alpha, 256 × 128 = 1 m × 0,5 m) ----------
export function makeFenceBars() {
  const W = 256, H = 128, c = canvas(W, H), g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#3a3c3e';
  g.fillRect(0, 6, W, 7); g.fillRect(0, H - 14, W, 7);
  for (let k = 0; k < 8; k++) g.fillRect(k * 32 + 13, 0, 6, H);
  const t = tex(c, { aniso: 8 });
  return t;
}

// ---------- Fensterglas-Atlas (2 × 2): drei Fenster mit Spiegelung und Gardinen, ein Solarmodul ----------
// Zelle (i, j): u = i/2 … (i+1)/2, v = j/2 … (j+1)/2. Zelle 3 (1,1) = Solarmodul.
export const WINDOW_CELLS = 4;
export function makeWindowAtlas() {
  const S = 256, c = canvas(S * 2, S * 2), g = c.getContext('2d'), rnd = mulberry32(4646);
  for (let k = 0; k < 4; k++) {
    const x = (k % 2) * S, y = (1 - Math.floor(k / 2)) * S;      // v nach oben: Zelle 0/1 unten im Bild
    g.save(); g.beginPath(); g.rect(x, y, S, S); g.clip();
    if (k === 3) {
      g.fillStyle = '#1b2a4a'; g.fillRect(x, y, S, S);
      g.strokeStyle = 'rgba(160,180,210,0.45)'; g.lineWidth = 2;
      for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(x + i * S / 6, y); g.lineTo(x + i * S / 6, y + S); g.stroke(); }
      for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(x, y + i * S / 10); g.lineTo(x + S, y + i * S / 10); g.stroke(); }
      const gr = g.createLinearGradient(x, y, x + S, y + S); gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x, y, S, S);
      g.restore(); continue;
    }
    // Spiegelung: oben heller Himmel, unten dunkel
    const gr = g.createLinearGradient(x, y, x, y + S);
    gr.addColorStop(0, '#9db3c4'); gr.addColorStop(0.35, '#58707f'); gr.addColorStop(0.62, '#2c3a44'); gr.addColorStop(1, '#1e2830');
    g.fillStyle = gr; g.fillRect(x, y, S, S);
    // Innenraum: dunkle Formen
    g.fillStyle = 'rgba(10,12,14,0.35)'; g.fillRect(x + S * 0.2, y + S * 0.55, S * 0.5, S * 0.45);
    // Gardinen
    if (k === 0) {
      for (const side of [0, 1]) {
        const w = S * (0.22 + rnd() * 0.08), sx = side ? x + S - w : x;
        for (let f = 0; f < 10; f++) { g.fillStyle = `rgba(${236 - f % 2 * 18},${230 - f % 2 * 18},${218 - f % 2 * 18},0.82)`; g.fillRect(sx + (f * w) / 10, y, w / 10 + 1, S); }
      }
    } else if (k === 1) {
      g.fillStyle = 'rgba(240,238,230,0.55)'; g.fillRect(x, y + S * 0.42, S, S * 0.58);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2;
      for (let i = 0; i < 18; i++) { g.beginPath(); g.moveTo(x + i * S / 18, y + S * 0.42); g.lineTo(x + i * S / 18 + 6, y + S); g.stroke(); }
    } else {
      g.fillStyle = 'rgba(222,214,196,0.9)'; g.fillRect(x, y, S, S * 0.16);                 // halb heruntergelassenes Rollo
      for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, y + i * S * 0.027, S, 2); }
    }
    // Lichtreflex
    g.fillStyle = 'rgba(255,255,255,0.13)';
    g.beginPath(); g.moveTo(x + S * 0.1, y + S); g.lineTo(x + S * 0.55, y); g.lineTo(x + S * 0.78, y); g.lineTo(x + S * 0.33, y + S); g.fill();
    g.restore();
  }
  return tex(c, { aniso: 8, repeat: false });
}
