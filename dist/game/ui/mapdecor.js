// Schmuck der Vollbildkarte: Wolken über dem Meer, Insel- und Ortsnamen.
import { RNG, fbm2, smoothstep, clamp } from '../util.js';
import { MAP_FONT } from './mapstyle.js';

// ---------- Wolken ----------
// Lage in Weltmetern (x, z), Breite in Metern, Deckkraft. Sie liegen rund um die Inseln über dem offenen Meer.
const CLOUDS = [
  [-12300, -2300, 7000, 0.80], [-12600, 2300, 4200, 0.52], [-9300, -5500, 4800, 0.42], [-4200, 9200, 4200, 0.48],
  [5600, 7300, 8800, 0.82], [9400, 8600, 5200, 0.55], [11300, -6000, 6000, 0.60], [14600, 3000, 6200, 0.55],
];
let sprites = null;

// Haufenwolke von oben: viele weiche Ballen, mit feinem Rauschen ausgefranst, Licht von Nordwesten
function makeCloud(seed) {
  const W = 384, H = 240, rng = new RNG(seed);
  const dens = new Float32Array(W * H);
  for (let i = 0; i < 70; i++) {
    const a = rng.next() * Math.PI * 2, d = Math.pow(rng.next(), 0.75);
    const px = W / 2 + Math.cos(a) * d * W * 0.37, py = H / 2 + Math.sin(a) * d * H * 0.32 + (d < 0.5 ? 0 : Math.sin(a * 3) * 14);
    const r = (1 - d * 0.55) * (10 + rng.next() * 34), power = 0.25 + rng.next() * 0.5;
    for (let y = Math.max(0, (py - r) | 0); y < Math.min(H, py + r); y++) {
      for (let x = Math.max(0, (px - r) | 0); x < Math.min(W, px + r); x++) {
        const q = 1 - ((x - px) ** 2 + (y - py) ** 2) / (r * r);
        if (q > 0) dens[y * W + x] += q * q * power;
      }
    }
  }
  const alpha = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      const n = fbm2(x / 19, y / 19, 5, seed), wisps = fbm2(x / 62, y / 62, 3, seed + 7);
      const edge = 1 - smoothstep(0.74, 0.99, Math.max(Math.abs((x / W) * 2 - 1), Math.abs((y / H) * 2 - 1)));
      alpha[k] = smoothstep(0.0, 1.3, dens[k] * (0.35 + wisps * 1.2) + (n - 0.52) * 1.2 * Math.min(1, dens[k] * 2.5)) * edge;
    }
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H), d = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x;
      const toSun = alpha[Math.max(0, y - 7) * W + Math.max(0, x - 7)];
      const v = 208 + clamp((alpha[k] - toSun) * 1.6 + 0.35 + (fbm2(x / 9, y / 9, 3, seed + 31) - 0.5) * 0.9, 0, 1) * 47;
      d[k * 4] = v - 5; d[k * 4 + 1] = v - 1; d[k * 4 + 2] = Math.min(255, v + 4); d[k * 4 + 3] = alpha[k] * 232;
    }
  }
  ctx.putImageData(img, 0, 0);
  const soft = document.createElement('canvas'); soft.width = W; soft.height = H;   // Ränder weichzeichnen
  const sc = soft.getContext('2d');
  sc.filter = 'blur(2px)';
  sc.drawImage(cv, 0, 0);
  return soft;
}

// Beim Heranzoomen lösen sich die Wolken auf
export function drawClouds(c, W, H, proj, scale, time) {
  const fade = 1 - smoothstep(0.09, 0.2, scale);
  if (fade <= 0.01) return;
  sprites ||= [makeCloud(11), makeCloud(41), makeCloud(77)];
  c.save();
  for (let i = 0; i < CLOUDS.length; i++) {
    const [x, z, wm, alpha] = CLOUDS[i];
    let [sx, sy, ok] = proj(x + Math.sin(time * 0.03 + i * 1.7) * 260, z + Math.cos(time * 0.021 + i) * 110);
    if (!ok && !(Math.abs(sx - W / 2) < W && Math.abs(sy - H / 2) < H)) continue;
    sx = W / 2 + (sx - W / 2) * 1.05; sy = H / 2 + (sy - H / 2) * 1.05;   // leichte Parallaxe: Wolken schweben höher
    const w = wm * scale, h = w * 0.625;
    if (sx + w / 2 < 0 || sy + h / 2 < 0 || sx - w / 2 > W || sy - h / 2 > H) continue;
    c.globalAlpha = alpha * fade;
    c.drawImage(sprites[i % sprites.length], sx - w / 2, sy - h / 2, w, h);
  }
  c.restore();
}

// ---------- Beschriftungen ----------
const ISLAND_NAMES = [
  { text: 'Menorca', x: 7650, z: -2930 }, { text: 'Eivissa', x: -8750, z: 4200 }, { text: 'Formentera', x: -8280, z: 7330 },
  { text: 'Cabrera', x: 520, z: 4620 }, { text: 'Sa Dragonera', x: -5650, z: -150, align: 'right' },
];
const MALLORCA_NAME = { x: 900, z: -330 };
const MAIN_TOWNS = ['palma', 'inca', 'manacor', 'soller', 'alcudia'];   // schon in der Übersicht, in dieser Rangfolge
const MORE_TOWNS = new Set(['arenal', 'magaluf', 'muro', 'andratx', 'calamillor', 'pollenca', 'calaratjada', 'santanyi', 'llucmajor', 'mao', 'ciutadella', 'santantoni']);
const LINES = { palma: ['Palma', 'de Mallorca'] };

// obstacles: [[x, y, Radius]] der Symbole auf dem Bildschirm – Namen weichen ihnen aus
export function drawLabels(c, W, H, proj, scale, settlements, obstacles = []) {
  const k = clamp(H / 880, 0.78, 1.35);
  const placed = [];
  c.save();
  c.textBaseline = 'middle'; c.lineJoin = 'round';
  c.shadowColor = 'rgba(0,0,0,.85)';
  // Überdeckte Fläche eines Namensfelds (0 = frei)
  const blocked = (b) => {
    let n = 0;
    for (const q of placed) n += Math.max(0, Math.min(b[2], q[2]) - Math.max(b[0], q[0])) * Math.max(0, Math.min(b[3], q[3]) - Math.max(b[1], q[1]));
    for (const [x, y, r] of obstacles) {
      const dx = x - clamp(x, b[0], b[2]), dy = y - clamp(y, b[1], b[3]);
      if (dx * dx + dy * dy < r * r) n += r * r;
    }
    return n;
  };
  // keep: wichtige Namen erscheinen auch dann, wenn nirgends ganz frei ist
  // fixed: der Name bleibt genau an seiner Stelle
  const write = (lines, wx, wz, { size, style = '700', italic = false, spacing = 0, color = '#fff', align = 'center', alpha = 1, keep = false, fixed = false }) => {
    const [x, y, ok] = proj(wx, wz);
    if (!ok || x < -150 || y < -40 || x > W + 150 || y > H + 40) return;
    c.font = `${italic ? 'italic ' : ''}${style} ${size}px ${MAP_FONT}`;
    c.letterSpacing = `${spacing}px`;
    c.textAlign = align;
    const w = Math.max(...lines.map((t) => c.measureText(t).width)), lh = size * 1.1, h = lh * lines.length;
    const side = w / 2 + 20;
    let best = null, least = Infinity;
    const tries = fixed ? [[0, 0]] : [[0, 0], [0, -h / 2 - 16], [0, h / 2 + 16], [side, 0], [-side, 0], [0, -h - 30], [0, h + 30], [side, -h / 2 - 12], [-side, -h / 2 - 12], [0, -h - 52], [0, h + 52], [side + 30, 0], [-side - 30, 0]];
    for (const [dx, dy] of tries) {
      const left = (align === 'right' ? x - w : x - w / 2) + dx, box = [left, y + dy - h / 2, left + w, y + dy + h / 2];
      const n = blocked(box);
      if (n < least) { least = n; best = { x: x + dx, y: y + dy, box }; }
      if (n === 0) break;
    }
    if (least > 0 && !keep) return;
    placed.push(best.box);
    c.globalAlpha = alpha;
    for (let i = 0; i < lines.length; i++) {
      const ly = best.y - h / 2 + lh * (i + 0.5);
      c.shadowBlur = 8; c.strokeStyle = 'rgba(6,12,18,.6)'; c.lineWidth = Math.max(2.5, size * 0.17);
      c.strokeText(lines[i], best.x, ly);
      c.shadowBlur = 0; c.fillStyle = color; c.fillText(lines[i], best.x, ly);
    }
    c.globalAlpha = 1;
  };
  const rank = (s) => { const i = MAIN_TOWNS.indexOf(s.id); return i < 0 ? (MORE_TOWNS.has(s.id) ? 10 : 20) : i; };
  const towns = settlements.filter((s) => s.pos).sort((a, b) => rank(a) - rank(b));
  const townName = (s) => {
    const main = rank(s) < 10;
    if (!main && scale < 0.075) return;
    if (!main && rank(s) === 20 && scale < 0.115) return;
    if (s.tiny && scale < 0.16) return;
    const lines = (LINES[s.id] || [s.name]).map((t) => t.toUpperCase());
    write(lines, s.pos[0], s.pos[1], main
      ? { size: Math.round((s.id === 'palma' ? 21 : 19) * k), spacing: 0.5, keep: true }
      : { size: Math.round(15 * k), style: '600', spacing: 0.5 });
  };
  // Schriftgröße von "MALLORCA" mit der Insel wachsen lassen, damit sie auch in kleinen Fenstern hineinpasst
  const big = Math.round(Math.min(31 * k, 14 + scale * 290));
  if (scale < 0.12) write(['MALLORCA'], MALLORCA_NAME.x, MALLORCA_NAME.z, { size: big, spacing: big * 0.1, color: '#d6d8d6', alpha: 0.92, keep: true, fixed: true });
  for (const s of towns) if (rank(s) < 10) townName(s);
  if (scale < 0.14) for (const i of ISLAND_NAMES) write([i.text], i.x, i.z, { size: Math.round(21 * k), italic: true, align: i.align || 'center', keep: true });
  for (const s of towns) if (rank(s) >= 10) townName(s);
  c.restore();
}
