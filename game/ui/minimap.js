// Minikarte (Kopf-nach-oben), Vollbildkarte, Wegpunkt und Routenlinie.
import { clamp, lerp } from '../util.js';
import { WORLD } from '../world/map.js';

const KIND_W = { highway: 5.5, main: 4.2, rural: 3.2, scenic: 3.2, avenue: 4.6, street: 3.4, alley: 2.2, promenade: 3.6, track: 1.6, taxiway: 3, runway: 6, quay: 2.6 };
const KIND_COL = { highway: '#ffb347', main: '#fff3b0', rural: '#ffffff', scenic: '#ff9ad9', avenue: '#ffffff', street: '#f4f4f4', alley: '#e0e0e0', promenade: '#fff', track: '#c9a67a', taxiway: '#9aa', runway: '#555', quay: '#cfd' };

export class Minimap {
  constructor(game, canvas, fullEl) {
    this.game = game;
    this.canvas = canvas;
    this.c = canvas.getContext('2d');
    this.size = canvas.width;
    this.fullEl = fullEl;
    this.fullCanvas = fullEl.querySelector('canvas');
    this.fc = this.fullCanvas.getContext('2d');
    this.full = false;
    this.zoom = 260;
    this.waypoint = null;
    this.route = null;
    this.routeT = 0;
    this.world = null;       // vorgerenderte Weltkarte
    this.view = { x: 0, z: 0, scale: 0.06 };
    this.drag = null;
    this._ang = 0;
    this._setupFull();
  }

  toggleFull(force) {
    const on = force ?? !this.full;
    this.full = on;
    this.fullEl.style.display = on ? 'block' : 'none';
    const g = this.game;
    if (on) {
      g.input.unlock();
      g.paused = true;
      if (!this.world) this._renderWorld();
      const p = g.player;
      this.view.x = p.vehicle ? p.vehicle.x : p.x; this.view.z = p.vehicle ? p.vehicle.z : p.z;
      this.view.scale = 0.1;
      this.fullEl.querySelector('.legend').innerHTML = 'Linksklick: Wegpunkt setzen · Rechtsklick: Wegpunkt entfernen · Mausrad: Zoom · Ziehen: Verschieben';
    } else {
      g.paused = false;
      g.input.lock();
    }
  }

  _setupFull() {
    const cv = this.fullCanvas;
    const toWorld = (e) => {
      const r = cv.getBoundingClientRect();
      const sx = (e.clientX - r.left) * (cv.width / r.width), sy = (e.clientY - r.top) * (cv.height / r.height);
      return [this.view.x + (sx - cv.width / 2) / this.view.scale, this.view.z + (sy - cv.height / 2) / this.view.scale];
    };
    cv.addEventListener('mousedown', (e) => { this.drag = { x: e.clientX, y: e.clientY, moved: false }; });
    window.addEventListener('mouseup', (e) => {
      if (!this.drag) return;
      const d = this.drag; this.drag = null;
      if (!this.full || d.moved || e.target !== cv) return;
      if (e.button === 0) { const [x, z] = toWorld(e); this.setWaypoint(x, z); }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag || !this.full) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
      const r = cv.getBoundingClientRect();
      this.view.x -= dx * (cv.width / r.width) / this.view.scale; this.view.z -= dy * (cv.height / r.height) / this.view.scale;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); this.clearWaypoint(); });
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.view.scale = clamp(this.view.scale * (e.deltaY < 0 ? 1.18 : 0.85), 0.012, 0.5); }, { passive: false });
    this.fullEl.querySelector('.close').addEventListener('click', () => this.toggleFull(false));
    window.addEventListener('keydown', (e) => { if (this.full && (e.code === 'Escape' || e.code === 'KeyM')) { e.preventDefault(); this.toggleFull(false); } });
  }

  setWaypoint(x, z) {
    this.waypoint = { x, z };
    this.routeT = 0;
    this.game.ui.notify('Wegpunkt gesetzt', 'info');
  }
  clearWaypoint() { this.waypoint = null; this.route = null; }

  _updateRoute() {
    const g = this.game, net = g.ctx.net, p = g.player;
    const w = this.waypoint;
    if (!w) return;
    const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
    if (Math.hypot(w.x - px, w.z - pz) < 14) { this.clearWaypoint(); g.ui.notify('Ziel erreicht', 'good'); return; }
    const filt = (n) => n.roads.some((id) => !net.roads[id].noTraffic);
    const a = net.nearestNode(px, pz, 500, filt), b = net.nearestNode(w.x, w.z, 600, filt);
    if (!a || !b) { this.route = null; return; }
    const r = g.traffic.router.route(a.id, b.id, 20000);
    if (!r) { this.route = null; return; }
    const pts = [[px, pz], [a.x, a.z]];
    let node = a.id;
    for (const s of r) {
      const road = s.road;
      const list = s.fwd ? road.pts : [...road.pts].reverse();
      for (const q of list) pts.push(q);
      node = s.fwd ? road.b : road.a;
    }
    pts.push([w.x, w.z]);
    this.route = pts;
  }

  // Vorgerenderte Weltkarte
  _renderWorld() {
    const g = this.game, ctx = g.ctx;
    const mpp = 14;
    const W = Math.ceil((WORLD.x1 - WORLD.x0) / mpp), H = Math.ceil((WORLD.z1 - WORLD.z0) / mpp);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const sx = (x) => (x - WORLD.x0) / mpp, sz = (z) => (z - WORLD.z0) / mpp;
    c.fillStyle = '#17588f'; c.fillRect(0, 0, W, H);
    // Flachwasser-Hof
    c.lineJoin = 'round';
    for (const p of ctx.coast.polys) {
      c.beginPath();
      p.pts.forEach(([x, z], i) => (i ? c.lineTo(sx(x), sz(z)) : c.moveTo(sx(x), sz(z))));
      c.closePath();
      c.strokeStyle = 'rgba(80,190,215,0.45)'; c.lineWidth = 16; c.stroke();
      c.strokeStyle = 'rgba(120,215,225,0.55)'; c.lineWidth = 8; c.stroke();
      c.fillStyle = '#cfd8b4'; c.fill();
      c.strokeStyle = '#f2ead0'; c.lineWidth = 1.2; c.stroke();
    }
    // Höhenschummerung (grob)
    const img = c.getImageData(0, 0, W, H);
    const d = img.data;
    for (let j = 1; j < H - 1; j += 1) {
      for (let i = 1; i < W - 1; i += 1) {
        const x = WORLD.x0 + i * mpp, z = WORLD.z0 + j * mpp;
        if (ctx.coast.sdAt(x, z) < 8) continue;
        const h = ctx.hf.base(x, z);
        const hl = ctx.hf.base(x + mpp, z), hu = ctx.hf.base(x, z + mpp);
        const sh = clamp(1 + ((h - hl) * 0.6 + (h - hu) * 0.5) / mpp * 1.2, 0.72, 1.3);
        const k = (j * W + i) * 4;
        const g1 = clamp(h / 220, 0, 1);
        d[k] = clamp((205 - g1 * 40) * sh, 0, 255); d[k + 1] = clamp((216 - g1 * 40) * sh, 0, 255); d[k + 2] = clamp((178 - g1 * 20) * sh, 0, 255);
        const lu = ctx.landuse.get(x, z);
        if (lu) { d[k] = 175 * sh; d[k + 1] = 170 * sh; d[k + 2] = 165 * sh; }
        if (ctx.hf.wet.length && ctx.hf.wetMask(x, z)) { d[k] = 150; d[k + 1] = 190; d[k + 2] = 150; }
      }
    }
    c.putImageData(img, 0, 0);
    // Straßen
    const order = ['alley', 'street', 'promenade', 'avenue', 'rural', 'scenic', 'main', 'highway'];
    for (const kind of order) {
      c.strokeStyle = KIND_COL[kind]; c.lineWidth = Math.max(0.7, (KIND_W[kind] || 2) * 0.28); c.lineCap = 'round';
      c.beginPath();
      for (const r of ctx.net.roads) {
        if (r.kind !== kind) continue;
        c.moveTo(sx(r.pts[0][0]), sz(r.pts[0][1]));
        for (let i = 1; i < r.pts.length; i += 2) c.lineTo(sx(r.pts[i][0]), sz(r.pts[i][1]));
        const l = r.pts[r.pts.length - 1]; c.lineTo(sx(l[0]), sz(l[1]));
      }
      c.stroke();
    }
    // Landebahn
    c.strokeStyle = '#444'; c.lineWidth = 2;
    for (const r of ctx.net.roads) if (r.kind === 'runway') { c.beginPath(); c.moveTo(sx(r.pts[0][0]), sz(r.pts[0][1])); c.lineTo(sx(r.pts[r.pts.length - 1][0]), sz(r.pts[r.pts.length - 1][1])); c.stroke(); }
    this.world = { cv, mpp };
  }

  // ---------- Blips ----------
  _blips() {
    const g = this.game, out = [];
    for (const m of g.markers.list) if (m.active && m.blip) out.push({ x: m.x, z: m.z, color: m.blip.color || '#ffd24a', icon: m.blip.icon || '', big: !!m.blip.big, pulse: !!m.blip.pulse });
    for (const b of g.extraBlips || []) out.push(b);
    if (!this._poiBlips) {
      const icons = { bank: ['$', '#6bdc7a'], jewelry: ['◆', '#d8a6ff'], gunshop: ['⌖', '#ffb347'], carshop: ['🚗', '#6ad1ff'], police: ['P', '#4d8bff'], clinic: ['+', '#ff5d6c'], harbor: ['⚓', '#6ad1ff'], airport: ['✈', '#ffffff'], club: ['♪', '#ff5de6'], bar: ['🍹', '#ffd24a'] };
      this._poiBlips = g.ctx.pois.filter((p) => icons[p.type]).map((p) => ({ x: p.x, z: p.z, icon: icons[p.type][0], color: icons[p.type][1], poi: true }));
    }
    return out;
  }

  update(dt) {
    const g = this.game;
    if (this.waypoint) { this.routeT -= dt; if (this.routeT <= 0) { this.routeT = 2.5; this._updateRoute(); } }
    if (this.full) { this._drawFull(); return; }
    this._draw(dt);
  }

  _draw(dt) {
    const g = this.game, p = g.player, c = this.c, S = this.size, half = S / 2;
    const v = p.vehicle;
    const px = v ? v.x : p.x, pz = v ? v.z : p.z;
    const sp = v ? Math.abs(v.speed) : p.speedH;
    const targetZoom = v ? (v.cls === 'plane' || v.cls === 'heli' ? 900 : 230 + clamp(sp / 45, 0, 1) * 260) : 200;
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dt * 2);
    const R = this.zoom, k = half / R;
    // Dreh-Winkel aus Kamerarichtung
    const yaw = p.camYaw;
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath(); c.arc(half, half, half, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#1c5d96'; c.fillRect(0, 0, S, S);
    c.translate(half, half);
    c.rotate(yaw + Math.PI);
    c.scale(k, k);
    c.translate(-px, -pz);
    // Land
    c.lineJoin = 'round';
    const lim = R * 1.6;
    for (const poly of g.ctx.coast.polys) {
      const b = poly.bbox;
      if (px < b[0] - lim || px > b[2] + lim || pz < b[1] - lim || pz > b[3] + lim) continue;
      c.beginPath();
      const pts = poly.pts;
      for (let i = 0; i < pts.length; i += 1) i ? c.lineTo(pts[i][0], pts[i][1]) : c.moveTo(pts[i][0], pts[i][1]);
      c.closePath();
      c.strokeStyle = 'rgba(110,205,225,.55)'; c.lineWidth = 26 / 1; c.stroke();
      c.fillStyle = '#d9d3bd'; c.fill();
    }
    // Gebäude
    c.fillStyle = '#b9b5ab';
    g.ctx.buildingHash.query(px - R * 1.25, pz - R * 1.25, px + R * 1.25, pz + R * 1.25, (b) => {
      if (!b.style) { if (b.kind === 'pier') { c.fillStyle = '#8a6a48'; c.save(); c.translate(b.x, b.z); c.rotate(-b.rot); c.fillRect(-b.w / 2, -b.d / 2, b.w, b.d); c.restore(); c.fillStyle = '#b9b5ab'; } return; }
      const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
      c.beginPath();
      const hw = b.w / 2, hd = b.d / 2;
      for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) { const x = b.x + cs * lx + sn * lz, z = b.z - sn * lx + cs * lz; c.lineTo(x, z); }
      c.closePath(); c.fill();
    });
    // Straßen: erst Rand, dann Füllung
    const segs = [];
    g.ctx.net.segHash.query(px - R * 1.25, pz - R * 1.25, px + R * 1.25, pz + R * 1.25, (s) => segs.push(s));
    c.lineCap = 'round';
    for (const pass of [0, 1]) {
      for (const s of segs) {
        const r = s.r;
        if (r.kind === 'track' && R > 400) continue;
        const a = r.pts[s.i], b = r.pts[s.i + 1];
        c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
        const w = (KIND_W[r.kind] || 3) * (R / 200) * 0.85 + 2.2;
        if (pass === 0) { c.strokeStyle = 'rgba(40,40,55,.9)'; c.lineWidth = w + 1.8; } else { c.strokeStyle = KIND_COL[r.kind] || '#fff'; c.lineWidth = w; }
        c.stroke();
      }
    }
    // Route
    if (this.route) {
      c.strokeStyle = '#ff4fd8'; c.lineWidth = 5 * (R / 200) + 1; c.lineJoin = 'round'; c.globalAlpha = 0.9;
      c.beginPath(); this.route.forEach(([x, z], i) => (i ? c.lineTo(x, z) : c.moveTo(x, z))); c.stroke(); c.globalAlpha = 1;
    }
    c.restore();
    // Blips (im Bildschirmraum)
    c.save();
    c.beginPath(); c.arc(half, half, half, 0, Math.PI * 2); c.clip();
    const toScreen = (x, z) => {
      const dx = (x - px) * k, dz = (z - pz) * k;
      const a = yaw + Math.PI, ca = Math.cos(a), sa = Math.sin(a);
      return [half + dx * ca - dz * sa, half + dx * sa + dz * ca];
    };
    const drawBlip = (x, z, color, icon, big, edge = true) => {
      let [sx, sy] = toScreen(x, z);
      const dx = sx - half, dy = sy - half, d = Math.hypot(dx, dy);
      let out = false;
      if (d > half - 9) { if (!edge) return; sx = half + (dx / d) * (half - 9); sy = half + (dy / d) * (half - 9); out = true; }
      c.fillStyle = color; c.strokeStyle = 'rgba(0,0,0,.8)'; c.lineWidth = 2;
      const r = big ? 8 : 6;
      c.beginPath(); c.arc(sx, sy, out ? r - 1.5 : r, 0, Math.PI * 2); c.fill(); c.stroke();
      if (icon && !out) { c.fillStyle = '#111'; c.font = `bold ${big ? 12 : 10}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(icon, sx, sy + 0.5); }
    };
    const blips = this._blips();
    for (const b of this._poiBlips || []) if (Math.hypot(b.x - px, b.z - pz) < R * 1.05) drawBlip(b.x, b.z, b.color, b.icon, false, false);
    for (const b of blips) drawBlip(b.x, b.z, b.color, b.icon, b.big);
    // Polizei
    const flash = Math.floor(g.time * 4) % 2;
    for (const u of g.police.units) if (u.alive && !u.exploded) { const [sx, sy] = toScreen(u.x, u.z); if (Math.hypot(sx - half, sy - half) < half - 6) { c.fillStyle = flash ? '#ff3b4a' : '#3a7bff'; c.beginPath(); c.arc(sx, sy, 4.5, 0, 7); c.fill(); } }
    for (const u of g.police.foot) if (u.alive) { const [sx, sy] = toScreen(u.x, u.z); if (Math.hypot(sx - half, sy - half) < half - 6) { c.fillStyle = flash ? '#ff3b4a' : '#3a7bff'; c.beginPath(); c.arc(sx, sy, 3, 0, 7); c.fill(); } }
    if (g.police.heli && g.police.heli.alive) drawBlip(g.police.heli.x, g.police.heli.z, flash ? '#ff3b4a' : '#3a7bff', '✱', true);
    if (this.waypoint) drawBlip(this.waypoint.x, this.waypoint.z, '#ff4fd8', '⚑', true);
    // Letztes eigenes Fahrzeug
    const lv = p.lastVehicle;
    if (lv && lv.alive && !p.vehicle) drawBlip(lv.x, lv.z, '#6ad1ff', '▣', false);
    c.restore();
    // Spielerpfeil (Fahrtrichtung relativ zur Kamera)
    c.save();
    c.translate(half, half);
    c.rotate(p.vehicle ? (p.vehicle.h - yaw) * -1 + 0 : (p.h - yaw) * -1);
    c.fillStyle = '#ffffff'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(7, 8); c.lineTo(0, 4); c.lineTo(-7, 8); c.closePath(); c.fill(); c.stroke();
    c.restore();
    // Nordmarke
    const na = yaw + Math.PI;
    c.save(); c.fillStyle = '#fff'; c.font = 'bold 13px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#000'; c.shadowBlur = 4;
    c.fillText('N', half + Math.sin(na) * (half - 13), half - Math.cos(na) * (half - 13));
    c.restore();
  }

  _drawFull() {
    const g = this.game, cv = this.fullCanvas, c = this.fc;
    const r = cv.getBoundingClientRect();
    if (cv.width !== Math.floor(r.width) || cv.height !== Math.floor(r.height)) { cv.width = Math.floor(r.width) || 800; cv.height = Math.floor(r.height) || 600; }
    const W = cv.width, H = cv.height, v = this.view;
    c.fillStyle = '#10477a'; c.fillRect(0, 0, W, H);
    if (!this.world) return;
    const { cv: wc, mpp } = this.world;
    const sc = v.scale * mpp; // Weltkarten-Pixel → Bildschirm
    c.imageSmoothingEnabled = true;
    c.save();
    c.translate(W / 2 - v.x * v.scale, H / 2 - v.z * v.scale);
    c.scale(v.scale, v.scale);
    c.drawImage(wc, WORLD.x0, WORLD.z0, wc.width * mpp, wc.height * mpp);
    // Route
    if (this.route) { c.strokeStyle = '#ff4fd8'; c.lineWidth = 3 / v.scale; c.beginPath(); this.route.forEach(([x, z], i) => (i ? c.lineTo(x, z) : c.moveTo(x, z))); c.stroke(); }
    c.restore();
    const ws = (x, z) => [W / 2 + (x - v.x) * v.scale, H / 2 + (z - v.z) * v.scale];
    c.textAlign = 'center'; c.textBaseline = 'middle';
    // Ortsnamen
    c.font = 'bold 13px sans-serif';
    c.fillStyle = '#fff'; c.shadowColor = '#000'; c.shadowBlur = 5;
    for (const s of g.ctx.settlements) {
      if (!s.pos) continue;
      const big = s.kind === 'city' || s.id === 'arenal' || s.id === 'muro' || s.id === 'magaluf' || s.id === 'eivissa';
      if (!big && v.scale < 0.05) continue;
      const [x, y] = ws(s.pos[0], s.pos[1]);
      if (x < -50 || y < -20 || x > W + 50 || y > H + 20) continue;
      c.font = big ? 'bold 15px sans-serif' : '12px sans-serif';
      c.fillText(s.name, x, y - 12);
    }
    c.font = 'italic 17px serif'; c.fillStyle = '#e8f6ff';
    for (const isl of [['Mallorca', 0, 0], ['Menorca', 7800, -3000], ['Ibiza', -8800, 4400], ['Formentera', -8300, 7300], ['Cabrera', 500, 4600], ['Sa Dragonera', -5150, -30]]) {
      const [x, y] = ws(isl[1], isl[2]);
      if (isl[0] === 'Mallorca') { const [mx, my] = ws(-200, -300); c.fillText(isl[0].toUpperCase(), mx, my); } else c.fillText(isl[0], x, y + (isl[0] === 'Menorca' || isl[0] === 'Formentera' ? 26 : 0));
    }
    c.shadowBlur = 0;
    // Blips
    for (const b of [...this._blips()]) {
      const [x, y] = ws(b.x, b.z);
      if (x < 0 || y < 0 || x > W || y > H) continue;
      c.fillStyle = b.color; c.strokeStyle = '#000'; c.lineWidth = 2;
      c.beginPath(); c.arc(x, y, b.poi ? 7 : 9, 0, 7); c.fill(); c.stroke();
      c.fillStyle = '#111'; c.font = 'bold 11px sans-serif'; c.fillText(b.icon || '', x, y + 0.5);
    }
    if (this.waypoint) { const [x, y] = ws(this.waypoint.x, this.waypoint.z); c.fillStyle = '#ff4fd8'; c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 9, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#111'; c.fillText('⚑', x, y); }
    // Spieler
    const p = g.player, vv = p.vehicle;
    const [px, py] = ws(vv ? vv.x : p.x, vv ? vv.z : p.z);
    c.save(); c.translate(px, py); c.rotate(-(vv ? vv.h : p.h) + Math.PI); c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, -11); c.lineTo(8, 9); c.lineTo(0, 5); c.lineTo(-8, 9); c.closePath(); c.fill(); c.stroke(); c.restore();
    void sc;
  }
}
