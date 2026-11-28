// Kartenzeichner: Satellitenbild, darüber Boote, Pools, Straßen, Bäume, Gebäude und Straßennamen.
// Wird von der Minikarte, der 2D-Ansicht und für die Bodentextur der 3D-Ansicht benutzt.
import { clamp } from '../util.js';
import { WORLD } from '../world/map.js';
import { PAL, MAP_FONT, ROAD_STYLE, ROAD_ORDER, ROOFS } from './mapstyle.js';
import { SatelliteRenderer, buildSatelliteDataSync, SAT_CELL } from './satellite.js';
import { highwayThrough } from '../world/hwroute.js';

export const MPP = SAT_CELL;   // Meter pro Zelle des Höhenrasters

// Kleinteile aus der Welt, die man im Luftbild sieht: Typ → [Farbe, Radius in Metern]
const TREES = { olive: ['#46562a', 2.3], palm: ['#2f5a27', 2.5], cypress: ['#1d3519', 1.5], bougainvillea: ['#a83574', 1.4], parasol: ['#efe7d6', 1.6], windmill: ['#ece7dc', 4], lighthouse: ['#f4f1ea', 4] };

// Einmalige Vorberechnung: Satellitenbild-Zeichner, Höhenraster (für die 3D-Ansicht) und Straßenliste
export function buildMapCache(game) {
  const ctx = game.ctx;
  const data = ctx.satData || (ctx.satData = buildSatelliteDataSync(ctx));   // sonst schon beim Laden erzeugt
  let sat = null;
  try { sat = new SatelliteRenderer(ctx.coast, data); } catch (e) { console.error('Satellitenbild nicht verfügbar:', e); }
  const roads = ctx.net.roads.filter((r) => ROAD_STYLE[r.kind]);
  for (const r of roads) {
    let a = 1e9, b = 1e9, c2 = -1e9, e = -1e9;
    for (const p of r.pts) { if (p[0] < a) a = p[0]; if (p[0] > c2) c2 = p[0]; if (p[1] < b) b = p[1]; if (p[1] > e) e = p[1]; }
    r._mbb = [a, b, c2, e];
  }
  // Ortsstraßen, über die eine Autobahn durch einen Ort weiterführt: auf der Karte wie Autobahn zeichnen
  const { through, side } = highwayThrough(ctx.net, ctx.highwayLinks || []);
  return { W: data.W, H: data.H, hgrid: data.hgrid, sat, roads, through, side };
}

// Höhe (Meter, ≥ 0) aus dem Raster, bilinear
export function mapHeight(cache, x, z) {
  const fx = (x - WORLD.x0) / MPP, fz = (z - WORLD.z0) / MPP;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= cache.W - 1 || j >= cache.H - 1) return 0;
  const tx = fx - i, tz = fz - j, W = cache.W, g = cache.hgrid;
  const a = g[j * W + i], b = g[j * W + i + 1], c = g[(j + 1) * W + i], d = g[(j + 1) * W + i + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

function coastPath(poly) {
  if (!poly._mapPath) {
    const p = new Path2D();
    poly.pts.forEach(([x, z], i) => (i ? p.lineTo(x, z) : p.moveTo(x, z)));
    p.closePath();
    poly._mapPath = p;
  }
  return poly._mapPath;
}

// Eckpunkte eines gedrehten Rechtecks (Gebäudekonvention) in den laufenden Pfad
function rect(c, x, z, w, d, rot, dx = 0, dz = 0) {
  const cs = Math.cos(rot), sn = Math.sin(rot), hw = w / 2, hd = d / 2;
  c.moveTo(x + dx + cs * -hw + sn * -hd, z + dz - sn * -hw + cs * -hd);
  c.lineTo(x + dx + cs * hw + sn * -hd, z + dz - sn * hw + cs * -hd);
  c.lineTo(x + dx + cs * hw + sn * hd, z + dz - sn * hw + cs * hd);
  c.lineTo(x + dx + cs * -hw + sn * hd, z + dz - sn * -hw + cs * hd);
  c.closePath();
}

function drawBuildings(c, ctx, box, s, zoom) {
  const [x0, z0, x1, z1] = box;
  const list = [];
  ctx.buildingHash.query(x0 - 30, z0 - 30, x1 + 30, z1 + 30, (b) => { if (b.style) list.push(b); });
  if (zoom < 0.16) {   // weit weg: nur helle Punkte, sie geben den Städten Körnung
    c.beginPath();
    const min = 1.1 / s;
    for (const b of list) { const w = Math.max(min, b.w * 0.8), d = Math.max(min, b.d * 0.8); c.rect(b.x - w / 2, b.z - d / 2, w, d); }
    c.fillStyle = `rgba(228,222,208,${clamp(zoom * 5, 0.28, 0.6)})`;
    c.fill();
    return;
  }
  // Schlagschatten (Sonne im Nordwesten)
  c.beginPath();
  for (const b of list) { const h = Math.min(30, b.h || 7); rect(c, b.x, b.z, b.w, b.d, b.rot, h * 0.42, h * 0.32); }
  c.fillStyle = 'rgba(6,10,16,.40)'; c.fill();
  // Dächer, nach Farbe gebündelt
  const groups = new Map();
  for (const b of list) {
    const cols = ROOFS[b.style] || ROOFS.apt;
    const col = cols[Math.abs(b.seed | 0) % cols.length];
    let g = groups.get(col); if (!g) groups.set(col, (g = []));
    g.push(b);
  }
  for (const [col, g] of groups) {
    c.beginPath();
    for (const b of g) rect(c, b.x, b.z, b.w, b.d, b.rot);
    c.fillStyle = col; c.fill();
  }
  if (zoom < 0.34) return;
  // Dachfirst (helle Hälfte) bzw. Dachaufbauten
  c.beginPath();
  for (const b of list) {
    if (b.roof === 'gable' || b.roof === 'hip') { const sn = Math.sin(b.rot), cs = Math.cos(b.rot); rect(c, b.x - sn * b.d / 4, b.z - cs * b.d / 4, b.w, b.d / 2, b.rot); }
    else if (b.w > 9 && b.d > 9) rect(c, b.x, b.z, b.w * 0.32, b.d * 0.28, b.rot);
  }
  c.fillStyle = 'rgba(255,246,230,.22)'; c.fill();
  c.beginPath();
  for (const b of list) rect(c, b.x, b.z, b.w, b.d, b.rot);
  c.strokeStyle = 'rgba(30,24,20,.45)'; c.lineWidth = 0.8 / s; c.stroke();
}

function drawBoats(c, ctx, box, s) {
  c.beginPath();
  for (const b of ctx.boats) {
    if (b.x < box[0] || b.x > box[2] || b.z < box[1] || b.z > box[3]) continue;
    const L = b.len || 8, w = L * 0.3, fx = Math.sin(b.rot), fz = Math.cos(b.rot);
    const P = (f, l) => [b.x + fx * f + fz * l, b.z + fz * f - fx * l];
    const pts = [P(L / 2, 0), P(L / 6, w / 2), P(-L / 2, w / 2.3), P(-L / 2, -w / 2.3), P(L / 6, -w / 2)];
    c.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) c.lineTo(...pts[i]);
    c.closePath();
  }
  c.fillStyle = '#eef2f3'; c.fill();
  c.strokeStyle = 'rgba(10,30,40,.55)'; c.lineWidth = 0.8 / s; c.stroke();
}

function drawProps(c, ctx, box, s) {
  const inside = (p, m) => p.x > box[0] - m && p.x < box[2] + m && p.z > box[1] - m && p.z < box[3] + m;
  const byType = {};
  const walls = [], jets = [], boxes = [];
  for (const p of ctx.props) {
    if (!inside(p, 30)) continue;
    if (TREES[p.t]) (byType[p.t] ||= []).push(p);
    else if (p.t === 'wallseg') walls.push(p);
    else if (p.t === 'parkedjet') jets.push(p);
    else if (p.t === 'container') boxes.push(p);
  }
  // Finca-Mauern
  c.beginPath();
  for (const p of walls) rect(c, p.x, p.z, 4, 0.9, p.r);
  c.fillStyle = '#c3b89c'; c.fill();
  c.beginPath();
  for (const p of boxes) rect(c, p.x, p.z, 6, 2.5, p.r);
  c.fillStyle = '#a8584a'; c.fill();
  for (const [t, list] of Object.entries(byType)) {
    const [col, r] = TREES[t];
    c.beginPath();
    for (const p of list) { const rr = r * (p.s || 1); c.moveTo(p.x + 1.3 + rr, p.z + 1.1); c.arc(p.x + 1.3, p.z + 1.1, rr, 0, Math.PI * 2); }
    c.fillStyle = 'rgba(5,10,8,.38)'; c.fill();
    c.beginPath();
    for (const p of list) { const rr = r * (p.s || 1); c.moveTo(p.x + rr, p.z); c.arc(p.x, p.z, rr, 0, Math.PI * 2); }
    c.fillStyle = col; c.fill();
  }
  // Geparkte Flugzeuge
  c.beginPath();
  for (const p of jets) {
    const fx = Math.cos(p.r || 0), fz = -Math.sin(p.r || 0);
    const P = (f, l) => [p.x + fx * f - fz * l, p.z + fz * f + fx * l];
    const pts = [P(19, 0), P(14, 2), P(4, 2.2), P(-3, 17), P(-6, 17), P(-3, 2.2), P(-13, 2), P(-17, 7), P(-19, 7), P(-17, 0)];
    c.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) c.lineTo(...pts[i]);
    for (let i = pts.length - 2; i > 0; i--) { const [f, l] = [(pts[i][0] - p.x) * fx + (pts[i][1] - p.z) * fz, -(pts[i][0] - p.x) * fz + (pts[i][1] - p.z) * fx]; c.lineTo(...P(f, -l)); }
    c.closePath();
  }
  c.fillStyle = '#e9edf0'; c.fill();
  c.strokeStyle = 'rgba(10,20,30,.4)'; c.lineWidth = 0.8 / s; c.stroke();
}

// Zeichnet die Karte (ohne Symbole und Ortsnamen) für den Ausschnitt v = { x, z, scale (Bildpunkte pro Meter) } auf c (Größe W×H).
// opts.names: Straßennamen entlang der Straßen (nur 2D); opts.px: Bildpunkte je CSS-Pixel (scharfe Minikarte)
export function drawBase(c, W, H, v, cache, game, opts = {}) {
  const ctx = game.ctx, s = v.scale, px = opts.px || 1;
  const zoom = s / px;                 // Zoomstufe in CSS-Pixeln pro Meter
  const hw = W / 2 / s, hh = H / 2 / s;
  const box = [v.x - hw, v.z - hh, v.x + hw, v.z + hh];
  const [x0, z0, x1, z1] = box;
  const hit = (b, m = 0) => !(b[2] < x0 - m || b[0] > x1 + m || b[3] < z0 - m || b[1] > z1 + m);

  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  if (cache.sat) c.drawImage(cache.sat.render(v, W, H), 0, 0, W, H);
  else { c.fillStyle = PAL.water; c.fillRect(0, 0, W, H); }
  c.translate(W / 2 - v.x * s, H / 2 - v.z * s);
  c.scale(s, s);
  c.lineJoin = 'round'; c.lineCap = 'round';
  if (!cache.sat) { c.fillStyle = PAL.land; for (const p of ctx.coast.polys) if (hit(p.bbox)) c.fill(coastPath(p)); }

  // --- Stege, Boote, Pools ---
  if (zoom >= 0.09) {
    c.fillStyle = '#8d7455';
    ctx.buildingHash.query(x0, z0, x1, z1, (b) => {
      if (b.style || b.kind !== 'pier') return;
      c.save(); c.translate(b.x, b.z); c.rotate(-b.rot); c.fillRect(-b.w / 2, -b.d / 2, b.w, b.d); c.restore();
    });
    drawBoats(c, ctx, box, s);
  }
  if (zoom >= 0.14) {
    c.beginPath();
    for (const p of ctx.pools) if (p.x > x0 - 20 && p.x < x1 + 20 && p.z > z0 - 20 && p.z < z1 + 20) rect(c, p.x, p.z, p.w, p.d, p.rot || 0);
    c.strokeStyle = '#e9e4d6'; c.lineWidth = 1.6; c.stroke();
    c.fillStyle = '#38c6da'; c.fill();
  }

  // --- Straßen ---
  const st = Math.max(1, Math.round(0.8 / (s * 10)));
  const byKind = {};
  const labels = [];
  for (const r of cache.roads) {
    const kind = cache.through.has(r.id) ? 'highway' : cache.side.has(r.id) ? 'main' : r.kind;
    if (zoom < ROAD_STYLE[kind].minScale || !hit(r._mbb, 40)) continue;
    (byKind[kind] ||= []).push(r);
  }
  const trace = (list) => {
    c.beginPath();
    for (const r of list) {
      const p = r.pts;
      if (r.kind === 'runway') { c.moveTo(p[0][0], p[0][1]); c.lineTo(p[p.length - 1][0], p[p.length - 1][1]); continue; }
      c.moveTo(p[0][0], p[0][1]);
      for (let i = st; i < p.length - 1; i += st) c.lineTo(p[i][0], p[i][1]);
      const l = p[p.length - 1]; c.lineTo(l[0], l[1]);
    }
  };
  // Breite in Bildpunkten: aus der Nähe maßstäblich, aus der Ferne eine feine Mindestbreite
  const widthPx = (sty) => clamp(Math.max(sty.minPx * clamp(zoom / 0.12, sty.minor ? 0.4 : 0.7, 1), sty.w * zoom * 1.08), 0.6, 110) * px;
  const fade = (sty) => (sty.minor ? clamp(0.16 + zoom * 3.8, 0.28, 1) : 1);
  for (const pass of [0, 1]) {
    for (const k of ROAD_ORDER) {
      const list = byKind[k]; if (!list) continue;
      const sty = ROAD_STYLE[k], w = widthPx(sty);
      if (pass === 0 && sty.minor && zoom < 0.12) continue;   // aus der Ferne ohne dunklen Rand
      trace(list);
      c.globalAlpha = fade(sty);
      if (pass === 1 && sty.dash) { c.lineCap = 'butt'; c.setLineDash([Math.max(6 * px, w * 1.7) / s, Math.max(4 * px, w * 0.9) / s]); }
      if (pass === 0) { c.strokeStyle = sty.casing; c.lineWidth = (w + 2 * clamp(w * 0.2, 0.7 * px, 2.8 * px)) / s; }
      else { c.strokeStyle = sty.color; c.lineWidth = w / s; }
      c.stroke();
      c.setLineDash([]); c.lineCap = 'round';
    }
  }
  c.globalAlpha = 1;
  // Mittellinie der Autobahn und der großen Straßen bei starkem Zoom
  for (const k of ['highway', 'avenue', 'main']) {
    const list = byKind[k]; if (!list) continue;
    const w = widthPx(ROAD_STYLE[k]);
    if (w < 8 * px) continue;
    trace(list);
    c.strokeStyle = k === 'highway' ? 'rgba(255,255,255,.7)' : 'rgba(214,160,40,.85)'; c.lineWidth = Math.max(px, w * 0.1) / s;
    c.setLineDash([w * 1.2 / s, w / s]);
    c.stroke(); c.setLineDash([]);
  }
  // Landebahn-Markierung
  if (byKind.runway) { trace(byKind.runway); c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.4 * px / s; c.setLineDash([22 * px / s, 16 * px / s]); c.stroke(); c.setLineDash([]); }

  // --- Bäume und Kleinteile, dann Häuser ---
  if (zoom >= 0.26) drawProps(c, ctx, box, s);
  if (zoom >= 0.045) drawBuildings(c, ctx, box, s, zoom);
  if (opts.names && zoom >= 0.3) {
    for (const k of ['highway', 'main', 'avenue', 'promenade', 'street', 'rural', 'scenic']) {
      for (const r of byKind[k] || []) if (r.name && r.len > 90) labels.push(r);
    }
  }
  c.restore();

  // --- Straßennamen (Bildschirmraum, entlang der Straße gedreht) ---
  if (labels.length) {
    c.save();
    c.font = `600 ${12.5 * px}px ${MAP_FONT}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = 3.4 * px; c.strokeStyle = PAL.halo; c.fillStyle = '#fff';
    const placed = [];
    let n = 0;
    for (const r of labels) {
      if (n >= 90) break;
      const m = r.pts.length >> 1;
      const a = r.pts[Math.max(0, m - 1)], b = r.pts[Math.min(r.pts.length - 1, m + 1)];
      const sx = W / 2 + (r.pts[m][0] - v.x) * s, sy = H / 2 + (r.pts[m][1] - v.z) * s;
      if (sx < 20 || sy < 20 || sx > W - 20 || sy > H - 20) continue;
      const tw = c.measureText(r.name).width;
      if (r.len * s < tw * 1.15) continue;
      if (placed.some((q) => (q[0] - sx) ** 2 + (q[1] - sy) ** 2 < (tw * 0.6 + 14) ** 2)) continue;
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      placed.push([sx, sy]); n++;
      c.save(); c.translate(sx, sy); c.rotate(ang);
      c.strokeText(r.name, 0, 0); c.fillText(r.name, 0, 0);
      c.restore();
    }
    c.restore();
  }
}

// Weltkoordinate → Bildschirm (2D)
export function projector2D(v, W, H) {
  return (x, z) => [W / 2 + (x - v.x) * v.scale, H / 2 + (z - v.z) * v.scale, true];
}
