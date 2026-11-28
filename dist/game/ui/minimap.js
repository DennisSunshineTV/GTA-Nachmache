// Minikarte (Kopf-nach-oben), Vollbildkarte in 2D und 3D, Wegpunkt und Routenlinie.
import { clamp, fmtMoney } from '../util.js';
import { renderQuests } from './quests.js';
import { BLIP, POI_ICONS, LEGEND_ITEMS, drawMarker, drawIcon, drawArrow, iconSvg } from './blips.js';
import { PAL, MAP_FONT, ROAD_STYLE, LEGEND_ROADS } from './mapstyle.js';
import { buildMapCache, drawBase, projector2D } from './map2d.js';
import { drawClouds, drawLabels } from './mapdecor.js';
import { Map3D } from './map3d.js';
import { PAD } from '../core/input.js';

const TAU = Math.PI * 2;
const MODE_KEY = 'msl_mapmode';
const LEGEND_KEY = 'msl_maplegend';
const MIN_SCALE = 0.018, MAX_SCALE = 0.9;   // Zoomgrenzen der Vollbildkarte (Bildpunkte pro Meter)
const MINI_MARGIN = 1.5;                    // die Minikarte hält ein Kartenstück vom 1,5-fachen des Sichtradius bereit
const VIEW3D = 0.77;                        // Kameraabstand der 3D-Karte = Fensterhöhe in Metern / VIEW3D (gleicher Ausschnitt wie 2D)
// Häfen, die schon in der Übersicht erscheinen (die übrigen beim Heranzoomen)
const BIG_HARBORS = new Set(['palma.harbor', 'colonia.harbor', 'eivissa.harbor', 'portalcudia.harbor']);
const SCALE_STEPS = [40, 100, 200, 400, 1000, 2000, 4000, 10000];

// Minikarte: abgerundetes Quadrat (Eckenradius in CSS-Pixeln, passend zum Rahmen in ui.js)
export const MINI_RADIUS = 22;
function roundRectPath(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r); c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

// Wegpunkt: Stecknadel mit Spitze auf der Position
function pin(c, x, y, r) {
  c.save();
  c.shadowColor = 'rgba(0,0,0,.65)'; c.shadowBlur = 10; c.shadowOffsetY = 3;
  const cy = y - r * 1.9;
  const drop = (grow, color, tip) => {
    c.fillStyle = color; c.beginPath(); c.arc(x, cy, r + grow, Math.PI * 0.82, Math.PI * 0.18, false); c.lineTo(x, y + tip); c.closePath(); c.fill();
  };
  drop(3.8, '#0c131c', 5);
  c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
  drop(1.9, '#fff', 2.5);
  drop(0, BLIP.waypoint.color, -1);
  c.restore();
  drawIcon(c, BLIP.waypoint.icon, x, cy, r * 1.25);
}

export class Minimap {
  constructor(game, canvas, fullEl) {
    this.game = game;
    this.canvas = canvas;
    this.size = canvas.width;                 // Kantenlänge in CSS-Pixeln
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = canvas.height = Math.round(this.size * this.dpr);
    this.c = canvas.getContext('2d');
    this.fullEl = fullEl;
    this.fullCanvas = fullEl.querySelector('canvas');
    this.fullCanvas.classList.add('mapov');
    this.fc = this.fullCanvas.getContext('2d');
    this.full = false;
    this.tab = 'map';          // 'map' | 'quests'
    this.fromPause = false;    // aus dem Pause-Menü geöffnet → Esc führt dorthin zurück
    this.zoom = 260;
    this.waypoint = null;
    this.route = null;
    this.routeT = 0;
    this.cache = null;         // Vorberechnung (Satellitenbild, Straßen), für Minikarte und Vollbildkarte
    this.mini = null;          // vorgezeichnetes Kartenstück der Minikarte
    this.view = { x: 0, z: 0, scale: 0.06 };
    this.drag = null;
    this.mode = '2d';          // '2d' | '3d'
    try { if (localStorage.getItem(MODE_KEY) === '3d') this.mode = '3d'; } catch { /* ohne Speicher */ }
    this.m3 = null;
    this.baseCv = document.createElement('canvas');
    this.baseKey = '';
    this.hud = {};
    this._buildLegend();
    this._setupFull();
  }

  _ensureCache() { return this.cache || (this.cache = buildMapCache(this.game)); }

  // Vollbildkarte öffnen. tab: 'map' | 'quests'; fromPause: kam aus dem Pause-Menü
  open(tab = 'map', fromPause = false) {
    const g = this.game;
    this.full = true;
    this.fromPause = fromPause;
    this.fullEl.style.display = 'block';
    g.input.unlock();
    g.paused = true;
    this._ensureCache();
    this._fitView();
    this.baseKey = '';
    this.setTab(tab);
    this.setMode(this.mode, true);
  }

  // Übersicht: alle Inseln im Bild, links neben der Legende
  _fitView() {
    const r = this.fullCanvas.getBoundingClientRect();
    const W = Math.floor(r.width) || 1280, H = Math.floor(r.height) || 720;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const p of this.game.ctx.coast.polys) { x0 = Math.min(x0, p.bbox[0]); z0 = Math.min(z0, p.bbox[1]); x1 = Math.max(x1, p.bbox[2]); z1 = Math.max(z1, p.bbox[3]); }
    const left = Math.min(70, W * 0.05), right = W - (this.legendOn && W > 980 ? clamp(W * 0.23, 300, 400) : 24);
    const top = Math.min(80, H * 0.1), bottom = H - Math.min(88, H * 0.11);
    const scale = clamp(Math.min((right - left) / (x1 - x0 + 500), (bottom - top) / (z1 - z0 + 500)), MIN_SCALE, MAX_SCALE);
    this.view.scale = scale;
    this.view.x = (x0 + x1) / 2 - ((left + right) / 2 - W / 2) / scale;
    this.view.z = (z0 + z1) / 2 - ((top + bottom) / 2 - H / 2) / scale;
  }

  // back = true: zurück ins Pause-Menü (falls von dort geöffnet); sonst weiter spielen
  close(back = false) {
    if (!this.full) return;
    this.full = false;
    this.drag = null;
    this.fullEl.style.display = 'none';
    const g = this.game, toPause = back && this.fromPause;
    this.fromPause = false;
    if (toPause) { g.ui.panels.pauseMenu(); return; }
    g.paused = false;
    g.input.lock();
  }

  toggleFull(force, tab = 'map') {
    const on = force ?? !this.full;
    if (on) this.open(tab, false); else this.close(false);
  }

  // 2D oder 3D. Beim Wechsel bleibt der betrachtete Ort erhalten
  setMode(mode, init = false) {
    mode = mode === '3d' ? '3d' : '2d';
    const H = Math.floor(this.fullCanvas.getBoundingClientRect().height) || 700;
    if (!init && mode !== this.mode) {
      if (mode === '3d' && this.m3) { this.m3.setTarget(this.view.x, this.view.z); this.m3.dist = clamp((H / this.view.scale) / VIEW3D, 160, 36000); }
      if (mode === '2d' && this.m3) { this.view.x = this.m3.target.x; this.view.z = this.m3.target.z; this.view.scale = clamp(H / (this.m3.dist * VIEW3D), MIN_SCALE, MAX_SCALE); }
    }
    this.mode = mode;
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* ohne Speicher */ }
    if (mode === '3d') {
      const fresh = !this.m3;
      if (fresh) this.m3 = new Map3D(this.game, this.fullEl, this._ensureCache());
      if (init || fresh) { this.m3.reset(this.view.x, this.view.z); this.m3.dist = clamp((H / this.view.scale) / VIEW3D, 160, 36000); }
    }
    this.baseKey = '';
    this._syncUi();
  }

  _syncUi() {
    const fe = this.fullEl, map = this.tab === 'map';
    fe.classList.toggle('in3d', this.mode === '3d');
    fe.querySelectorAll('.mm').forEach((b) => b.classList.toggle('on', b.dataset.m === this.mode));
    if (this.m3) this.m3.show(this.mode === '3d' && map);
    const lg = fe.querySelector('.maplegend');
    if (lg) lg.style.display = map && this.legendOn ? 'block' : 'none';
    this._buildBar();
    this._placeLegend();
  }

  // Die Legende sitzt über der Leiste – auch wenn diese in schmalen Fenstern zweizeilig wird
  _placeLegend() {
    const lg = this.fullEl.querySelector('.maplegend'), bar = this.fullEl.querySelector('.mapbar');
    if (!lg || !bar || !bar.offsetHeight) return;
    const bottom = bar.offsetHeight + 28;
    lg.style.bottom = bottom + 'px';
    lg.style.maxHeight = `calc(100% - ${bottom + 96}px)`;
  }

  // Leiste unten rechts: Tasten bzw. Controller-Knöpfe, anklickbar
  _buildBar() {
    const bar = this.fullEl.querySelector('.mapbar');
    if (!bar) return;
    const pad = this.game.input.device === 'pad', map = this.tab === 'map', d3 = this.mode === '3d';
    const key = (t) => `<b class="kc">${t}</b>`;
    const btn = (t) => `<b class="pb ${t.toLowerCase()}">${t}</b>`;
    const item = (label, keys, act) => `<span class="mbi"${act ? ` data-act="${act}"` : ''}>${label} ${keys}</span>`;
    const back = this.fromPause ? 'Zurück' : 'Schließen';
    let items;
    if (!map) {
      items = pad
        ? [item('Quest wählen', key('✚')), item('Wegpunkt setzen', btn('A')), item('Karte', key('LB') + key('RB'), 'tab'), item(back, btn('B'), 'close')]
        : [item('Karte', key('Tab'), 'tab'), item(back, key(this.fromPause ? 'Esc' : 'M'), 'close')];
    } else if (pad) {
      items = [item('Zoomen', key('LT') + key('RT')), item('Wegpunkt setzen', btn('A')), item('Entfernen', btn('X')),
        item('Legende ein/aus', btn('Y'), 'legend'), item(d3 ? '2D · Drehen: rechter Stick' : '3D', key('RS'), 'mode'), item('Quests', key('LB') + key('RB'), 'tab'), item(back, btn('B'), 'close')];
    } else {
      items = [item('Zoomen', key('Mausrad')), item('Wegpunkt setzen', key('Linksklick')), item('Entfernen', key('Rechtsklick')),
        item('Legende ein/aus', key('L'), 'legend'), item(d3 ? '2D' : '3D', key('V'), 'mode'), item('Quests', key('Tab'), 'tab'), item(back, key(this.fromPause ? 'Esc' : 'M'), 'close')];
      if (d3) items.unshift(item('Drehen', key('Rechts ziehen')));
    }
    bar.innerHTML = items.join('');
  }

  // Beschriftungen auffrischen (Wechsel zwischen Tastatur und Controller)
  refreshHints() { if (this.full) this._syncUi(); }

  // Controller auf der Karte: Stick/Steuerkreuz verschieben, Trigger zoomen, Fadenkreuz in der Mitte für den Wegpunkt
  padControl(input, dt) {
    const pad = input.pad, m3 = this.mode === '3d' && this.m3;
    const b = (i) => (input.padDown(i) ? 1 : 0);
    const mx = clamp(pad.lx + b(PAD.RIGHT) - b(PAD.LEFT), -1, 1), mz = clamp(pad.ly + b(PAD.DOWN) - b(PAD.UP), -1, 1);
    const step = 750 * dt;   // Bildschirmpixel
    if (mx || mz) {
      if (m3) this.m3.pan(-mx * step, -mz * step);
      else { this.view.x += (mx * step) / this.view.scale; this.view.z += (mz * step) / this.view.scale; }
    }
    const zoom = Math.exp((pad.rt - pad.lt) * 1.7 * dt);
    if (zoom !== 1) { if (m3) this.m3.zoom(1 / zoom); else this.view.scale = clamp(this.view.scale * zoom, MIN_SCALE, MAX_SCALE); }
    if (m3 && (pad.rx || pad.ry)) this.m3.orbit(pad.rx * step * 0.6, pad.ry * step * 0.6);
    if (input.padHit(PAD.Y)) this.toggleLegend();
    if (input.padHit(PAD.RS)) this.setMode(this.mode === '2d' ? '3d' : '2d');
    if (input.padHit(PAD.A)) this.setWaypoint(this.view.x, this.view.z);
    if (input.padHit(PAD.X)) this.clearWaypoint();
    if (input.padHit(PAD.LS)) this._control('me');
  }

  // Tab der Vollbildkarte: Karte oder Quests
  setTab(tab) {
    this.tab = tab === 'quests' ? 'quests' : 'map';
    const fe = this.fullEl;
    fe.querySelectorAll('.mtab').forEach((t) => t.classList.toggle('on', t.dataset.t === this.tab));
    fe.classList.toggle('inquests', this.tab === 'quests');
    const qp = fe.querySelector('.questpanel');
    qp.style.display = this.tab === 'quests' ? 'block' : 'none';
    this._syncUi();
    if (this.tab === 'quests') {
      qp.scrollTop = 0;
      renderQuests(this.game, qp, {
        onWaypoint: (t) => {
          this.setWaypoint(t.x, t.z, { quest: true });
          this.view.x = t.x; this.view.z = t.z; this.view.scale = Math.max(this.view.scale, 0.13);
          if (this.m3) { this.m3.setTarget(t.x, t.z); this.m3.dist = Math.min(this.m3.dist, 6000); }
          this.baseKey = '';
          this.setTab('map');
        },
      });
    }
  }

  _setupFull() {
    const cv = this.fullCanvas;
    const local = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)]; };
    const toWorld = (e) => {
      const [sx, sy] = local(e);
      if (this.mode === '3d' && this.m3) return this.m3.pick(sx, sy);
      return [this.view.x + (sx - cv.width / 2) / this.view.scale, this.view.z + (sy - cv.height / 2) / this.view.scale];
    };
    cv.addEventListener('mousedown', (e) => { this.drag = { x: e.clientX, y: e.clientY, moved: false, btn: e.button, shift: e.shiftKey }; });
    window.addEventListener('mouseup', (e) => {
      if (!this.drag) return;
      const d = this.drag; this.drag = null;
      this._lastMoved = d.moved;
      if (!this.full || d.moved || e.target !== cv) return;
      if (e.button === 0) { const w = toWorld(e); if (w) this.setWaypoint(w[0], w[1]); }
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.drag || !this.full) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
      if (!this.drag.moved) return;
      const r = cv.getBoundingClientRect();
      const kx = cv.width / r.width, ky = cv.height / r.height;
      if (this.mode === '3d' && this.m3) {
        if (this.drag.btn === 2 || this.drag.btn === 1 || this.drag.shift) this.m3.orbit(dx * kx, dy * ky);
        else this.m3.pan(dx * kx, dy * ky);
      } else if (this.drag.btn === 0 || this.drag.btn === 1) {
        this.view.x -= dx * kx / this.view.scale; this.view.z -= dy * ky / this.view.scale;
      }
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    });
    cv.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!this._lastMoved) this.clearWaypoint(); this._lastMoved = false; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (this.mode === '3d' && this.m3) { this.m3.zoom(e.deltaY < 0 ? 0.85 : 1.18); return; }
      // auf die Stelle unter dem Mauszeiger zoomen
      const v = this.view, [sx, sy] = local(e), ox = sx - cv.width / 2, oy = sy - cv.height / 2;
      const next = clamp(v.scale * (e.deltaY < 0 ? 1.18 : 0.85), MIN_SCALE, MAX_SCALE);
      v.x += ox / v.scale - ox / next; v.z += oy / v.scale - oy / next;
      v.scale = next;
    }, { passive: false });
    const fe = this.fullEl;
    fe.querySelector('.mapbar').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') this.close(true);
      else if (act === 'legend') this.toggleLegend();
      else if (act === 'mode') this.setMode(this.mode === '2d' ? '3d' : '2d');
      else if (act === 'tab') this.setTab(this.tab === 'map' ? 'quests' : 'map');
    });
    fe.querySelector('.mcompass').addEventListener('click', () => this._control('north'));
    fe.querySelectorAll('.mtab').forEach((t) => t.addEventListener('click', () => this.setTab(t.dataset.t)));
    fe.querySelectorAll('.mm').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.m)));
    fe.querySelectorAll('.mc').forEach((b) => b.addEventListener('click', () => this._control(b.dataset.c)));
  }

  // Knöpfe: Zoom, zu mir, Norden (Kompass)
  _control(kind) {
    const g = this.game, p = g.player, v = p.vehicle || p;
    const m3 = this.mode === '3d' && this.m3;
    if (kind === 'in') { if (m3) this.m3.zoom(0.7); else this.view.scale = clamp(this.view.scale * 1.4, MIN_SCALE, MAX_SCALE); }
    else if (kind === 'out') { if (m3) this.m3.zoom(1.4); else this.view.scale = clamp(this.view.scale / 1.4, MIN_SCALE, MAX_SCALE); }
    else if (kind === 'me') {
      this.view.x = v.x; this.view.z = v.z; this.view.scale = Math.max(this.view.scale, 0.2);
      if (this.m3) { this.m3.setTarget(v.x, v.z); this.m3.dist = Math.min(this.m3.dist, 3600); }
    } else if (kind === 'north' && m3) { this.m3.yaw = 0; this.m3.pitch = 0.95; this.m3.dirty = true; }
  }

  // opts.quest: Wegpunkt gehört zu einer Quest → nur dann wird die rosa Fahrstrecke berechnet und gezeichnet.
  // Ein selbst gesetzter Wegpunkt zeigt nur die Markierung.
  setWaypoint(x, z, opts = {}) {
    this.waypoint = { x, z, quest: !!opts.quest };
    this.route = null;
    this.routeT = 0;
    this.game.ui.notify('Wegpunkt gesetzt', 'info');
  }
  clearWaypoint() { this.waypoint = null; this.route = null; }

  // Aktuelles Ziel für Kompass, Entfernungsanzeige und Minikarte: Missions-/Quest-Wegpunkt, sonst eigener Wegpunkt,
  // sonst der Start der nächsten Quest. kind: 'quest' | 'wp'
  questTarget() {
    const w = this.waypoint;
    if (w) return { x: w.x, z: w.z, kind: w.mission || w.quest ? 'quest' : 'wp' };
    const sm = this.game.missions?.startMk;
    if (sm && sm.active) return { x: sm.x, z: sm.z, kind: 'quest' };
    return null;
  }

  // Entfernung zum Ziel für Kompass und Minikarte (gleicher Wert): bei Quests entlang der Route, sonst Luftlinie.
  // Höchstens 5× pro Sekunde neu berechnet.
  questDistance(t, px, pz) {
    const now = this.game.time, c = this._qd;
    if (c && c.t > now - 0.2 && c.x === t.x && c.z === t.z) return c.d;
    const along = t.kind === 'quest' ? this.routeLeft(px, pz) : null;
    const d = along ?? Math.hypot(t.x - px, t.z - pz);
    this._qd = { t: now, x: t.x, z: t.z, d };
    return d;
  }

  // Verbleibende Strecke entlang der rosa Route ab der Spielerposition (null ohne Route)
  routeLeft(px, pz) {
    const r = this.route;
    if (!r || r.length < 2) return null;
    let best = Infinity, bi = 0, bt = 0;
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1], ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1;
      const t = clamp(((px - a[0]) * ex + (pz - a[1]) * ez) / l2, 0, 1);
      const d2 = (a[0] + ex * t - px) ** 2 + (a[1] + ez * t - pz) ** 2;
      if (d2 < best) { best = d2; bi = i; bt = t; }
    }
    let len = Math.sqrt(best) + Math.hypot(r[bi + 1][0] - r[bi][0], r[bi + 1][1] - r[bi][1]) * (1 - bt);
    for (let i = bi + 1; i < r.length - 1; i++) len += Math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]);
    return len;
  }

  _updateRoute() {
    const g = this.game, net = g.ctx.net, p = g.player;
    const w = this.waypoint;
    if (!w) return;
    if (!w.quest && !w.mission) { this.route = null; return; }
    const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
    if (Math.hypot(w.x - px, w.z - pz) < 14) { this.clearWaypoint(); g.ui.notify('Ziel erreicht', 'good'); return; }
    const filt = (n) => n.roads.some((id) => !net.roads[id].noTraffic);
    const a = net.nearestNode(px, pz, 500, filt), b = net.nearestNode(w.x, w.z, 600, filt);
    if (!a || !b) { this.route = null; return; }
    const r = g.traffic.router.route(a.id, b.id, 20000);
    if (!r) { this.route = null; return; }
    const pts = [[px, pz], [a.x, a.z]];
    for (const s of r) {
      const road = s.road;
      const list = s.fwd ? road.pts : [...road.pts].reverse();
      for (const q of list) pts.push(q);
    }
    pts.push([w.x, w.z]);
    this.route = pts;
  }

  // ---------- Blips ----------
  _blips() {
    const g = this.game, out = [];
    for (const m of g.markers.list) if (m.active && m.blip) out.push({ x: m.x, z: m.z, color: m.blip.color || BLIP.target.color, icon: m.blip.icon || '', big: !!m.blip.big, pulse: !!m.blip.pulse });
    for (const b of g.extraBlips || []) out.push(b);
    return out;
  }

  // Orte (Bank, Hafen, Polizei …) – einmal aus den Weltdaten aufgebaut
  _poi() {
    if (!this._poiBlips) {
      this._poiBlips = this.game.ctx.pois.filter((p) => POI_ICONS[p.type]).map((p) => {
        const d = POI_ICONS[p.type];
        return { x: p.x, z: p.z, icon: d.icon, color: d.color, square: d.square, minScale: BIG_HARBORS.has(p.id) ? 0 : p.type === 'harbor' ? 0.085 : d.minScale, poi: true };
      });
    }
    return this._poiBlips;
  }

  // Legende (rechts in der Vollbildkarte): erklärt Symbole und Straßen. Quelle: blips.js und mapstyle.js
  _buildLegend() {
    let saved = null;
    try { saved = localStorage.getItem(LEGEND_KEY); } catch { /* ohne Speicher */ }
    this.legendOn = saved ? saved === 'open' : window.innerHeight >= 620;
    const box = this.fullEl.querySelector('.maplegend');
    if (!box) return;
    box.textContent = '';
    const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
    const lh = mk('div', 'lh', 'Legende');
    lh.title = 'Legende ausblenden';
    lh.addEventListener('click', () => this.toggleLegend(false));
    box.append(lh);
    const grid = mk('div', 'lg');
    for (const it of LEGEND_ITEMS) {
      const row = mk('div', 'li');
      const sym = mk('span', 'sym');
      sym.innerHTML = iconSvg(it);
      row.append(sym, mk('span', '', it.label));
      grid.append(row);
    }
    box.append(grid);
    const roads = mk('div', 'lr');
    for (const kind of LEGEND_ROADS) {
      const st = ROAD_STYLE[kind];
      const r = mk('span', 'lri');
      const bar = mk('i', st.dash ? 'dash' : '');
      if (!st.dash) bar.style.background = st.color;
      r.append(bar, document.createTextNode(st.label));
      roads.append(r);
    }
    box.append(roads);
    box.append(mk('div', 'ln', 'Läden und Lokale erscheinen beim Heranzoomen.'));
  }

  toggleLegend(force) {
    this.legendOn = force ?? !this.legendOn;
    try { localStorage.setItem(LEGEND_KEY, this.legendOn ? 'open' : 'off'); } catch { /* ohne Speicher */ }
    this._syncUi();
  }

  update(dt) {
    if (this.waypoint) { this.routeT -= dt; if (this.routeT <= 0) { this.routeT = 2.5; this._updateRoute(); } }
    if (this.full) { if (this.tab === 'map') this._drawFull(); return; }
    this._draw(dt);
  }

  // ---------- Minikarte ----------
  // Kartenstück rund um den Spieler (Satellitenbild, Straßen, Häuser). Neu gezeichnet erst, wenn der Rand naht oder sich der Zoom ändert.
  _miniBase(px, pz, R) {
    let m = this.mini;
    if (!m || Math.abs(R / m.R - 1) > 0.12 || Math.max(Math.abs(px - m.x), Math.abs(pz - m.z)) + R * 1.02 > m.half) {
      if (!m) m = this.mini = { cv: document.createElement('canvas') };
      const scale = (this.size / 2 / R) * this.dpr;
      const n = Math.ceil(R * MINI_MARGIN * 2 * scale);
      if (m.cv.width !== n) m.cv.width = m.cv.height = n;
      drawBase(m.cv.getContext('2d'), n, n, { x: px, z: pz, scale }, this._ensureCache(), this.game, { px: this.dpr });
      m.x = px; m.z = pz; m.R = R; m.half = n / 2 / scale;
    }
    return m;
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
    const base = this._miniBase(px, pz, R);
    c.save();
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, S, S);
    roundRectPath(c, 0, 0, S, S, MINI_RADIUS); c.clip();
    c.fillStyle = PAL.water; c.fillRect(0, 0, S, S);
    c.save();
    c.translate(half, half);
    c.rotate(yaw + Math.PI);
    c.scale(k, k);
    c.translate(-px, -pz);
    c.drawImage(base.cv, base.x - base.half, base.z - base.half, base.half * 2, base.half * 2);
    // Fahndungsbereich: transparenter roter Bereich, in dem die Polizei nach dir sucht
    if (g.police.wanted > 0 && g.police.area) {
      const pa = g.police.area, pulse = 0.5 + 0.5 * Math.sin(g.time * 3);
      c.beginPath(); c.arc(pa.x, pa.z, pa.r, 0, TAU);
      c.fillStyle = `rgba(255,35,50,${0.2 + pulse * 0.1})`; c.fill();
      c.lineWidth = 3 / k; c.strokeStyle = `rgba(255,80,90,${0.65 + pulse * 0.3})`; c.stroke();
    }
    // Route
    if (this.route) {
      c.lineJoin = 'round'; c.lineCap = 'round';
      c.beginPath(); this.route.forEach(([x, z], i) => (i ? c.lineTo(x, z) : c.moveTo(x, z)));
      c.strokeStyle = 'rgba(10,16,24,.85)'; c.lineWidth = 7.5 / k; c.stroke();
      c.strokeStyle = PAL.accent; c.lineWidth = 4.5 / k; c.stroke();
    }
    c.restore();
    // Leichte Abdunkelung zum Rand
    const shade = c.createRadialGradient(half, half, half * 0.7, half, half, half * 1.42);
    shade.addColorStop(0, 'rgba(3,10,18,0)'); shade.addColorStop(1, 'rgba(3,10,18,.4)');
    c.fillStyle = shade; c.fillRect(0, 0, S, S);
    // Blips (im Bildschirmraum)
    const toScreen = (x, z) => {
      const dx = (x - px) * k, dz = (z - pz) * k;
      const a = yaw + Math.PI, ca = Math.cos(a), sa = Math.sin(a);
      return [half + dx * ca - dz * sa, half + dx * sa + dz * ca];
    };
    // Abstand vom Mittelpunkt in der Form der Karte (abgerundetes Quadrat ≈ Superellipse)
    const rim = (dx, dy) => Math.pow(Math.pow(Math.abs(dx), 5) + Math.pow(Math.abs(dy), 5), 0.2);
    const drawBlip = (b, big, edge = true) => {
      let [sx, sy] = toScreen(b.x, b.z);
      const dx = sx - half, dy = sy - half, d = rim(dx, dy);
      let out = false;
      if (d > half - 11) { if (!edge) return; sx = half + (dx / d) * (half - 11); sy = half + (dy / d) * (half - 11); out = true; }
      const r = (big ? 9 : 7.5) - (out ? 1.5 : 0);
      drawMarker(c, sx, sy, r, b.color, b.icon, b.square);
      return { sx, sy, out };
    };
    // Quest-Ziel im Kartenausschnitt: pulsierender Kreis und Entfernung
    const qt = this.questTarget();
    if (qt) {
      const [qx, qy] = toScreen(qt.x, qt.z);
      if (rim(qx - half, qy - half) < half - 14) {
        const ph = (g.time * 0.9) % 1, col = qt.kind === 'quest' ? '255,93,230' : '216,115,245';
        c.fillStyle = `rgba(${col},.16)`; c.beginPath(); c.arc(qx, qy, 15, 0, TAU); c.fill();
        c.strokeStyle = `rgba(${col},${0.95 * (1 - ph)})`; c.lineWidth = 2.5; c.beginPath(); c.arc(qx, qy, 11 + ph * 17, 0, TAU); c.stroke();
        const dist = this.questDistance(qt, px, pz);
        const label = dist < 999.5 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1).replace('.', ',')} km`;
        c.font = `700 12px ${MAP_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
        const ly = qy > 30 ? qy - 24 : qy + 24, tw = c.measureText(label).width + 10;
        c.fillStyle = 'rgba(8,14,22,.82)'; roundRectPath(c, qx - tw / 2, ly - 8, tw, 16, 5); c.fill();
        c.fillStyle = '#fff'; c.fillText(label, qx, ly + 0.5);
      }
    }
    for (const b of this._poi()) if (Math.hypot(b.x - px, b.z - pz) < R * 1.05) drawBlip(b, false, false);
    for (const b of this._blips()) drawBlip(b, b.big);
    // Polizei
    const flash = Math.floor(g.time * 4) % 2;
    c.strokeStyle = '#fff'; c.lineWidth = 1.4;
    const dot = (u, r) => {
      const [sx, sy] = toScreen(u.x, u.z);
      if (rim(sx - half, sy - half) >= half - 6) return;
      c.fillStyle = flash ? '#ff3b4a' : '#3a7bff'; c.beginPath(); c.arc(sx, sy, r, 0, TAU); c.fill(); c.stroke();
    };
    for (const u of g.police.units) if (u.alive && !u.exploded) dot(u, 5);
    for (const u of g.police.foot) if (u.alive) dot(u, 3);
    for (const h of [g.police.heli, g.police.heli2]) if (h && h.alive) drawBlip({ x: h.x, z: h.z, color: flash ? '#ff5a66' : '#6a9dff', icon: 'heli' }, true);
    if (this.waypoint) drawBlip({ ...this.waypoint, color: BLIP.waypoint.color, icon: BLIP.waypoint.icon }, true);
    // Mitspieler (Multiplayer): grüne Punkte
    if (g.net) for (const b of g.net.blips()) {
      let [sx, sy] = toScreen(b.x, b.z);
      const dx = sx - half, dy = sy - half, d = rim(dx, dy);
      if (d > half - 9) { sx = half + (dx / d) * (half - 9); sy = half + (dy / d) * (half - 9); }
      c.fillStyle = '#22c55e'; c.strokeStyle = '#fff'; c.lineWidth = 1.8; c.beginPath(); c.arc(sx, sy, 5.5, 0, TAU); c.fill(); c.stroke();
    }
    // Letztes eigenes Fahrzeug
    const lv = p.lastVehicle;
    if (lv && lv.alive && !p.vehicle) drawBlip({ x: lv.x, z: lv.z, color: BLIP.vehicle.color, icon: BLIP.vehicle.icon }, false);
    // Spielerpfeil (Fahrtrichtung relativ zur Kamera)
    drawArrow(c, half, half, yaw - (p.vehicle ? p.vehicle.h : p.h), 10);
    // Nordmarke (auf dem Rand des abgerundeten Quadrats)
    const na = yaw + Math.PI, ndx = Math.sin(na), ndy = -Math.cos(na), nr = (half - 12) / rim(ndx, ndy);
    const nx = half + ndx * nr, ny = half + ndy * nr;
    c.fillStyle = 'rgba(8,14,22,.88)'; c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 1.2;
    c.beginPath(); c.arc(nx, ny, 9.5, 0, TAU); c.fill(); c.stroke();
    c.fillStyle = '#fff'; c.font = `700 13px ${MAP_FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', nx, ny + 0.8);
    c.restore();
  }

  // ---------- Vollbildkarte ----------
  _drawFull() {
    const g = this.game, cv = this.fullCanvas, c = this.fc;
    const r = cv.getBoundingClientRect();
    const W0 = Math.floor(r.width) || 800, H0 = Math.floor(r.height) || 600;
    if (cv.width !== W0 || cv.height !== H0) { cv.width = W0; cv.height = H0; this.baseKey = ''; this._placeLegend(); }
    const W = cv.width, H = cv.height, v = this.view;
    const is3d = this.mode === '3d' && this.m3;
    let proj, zoomScale;
    if (is3d) {
      this.m3.render(W, H);
      c.clearRect(0, 0, W, H);
      const m3 = this.m3;
      proj = (x, z) => m3.project(x, z, 4);
      zoomScale = 1 / m3.metersPerPixel();
      this.view.x = m3.target.x; this.view.z = m3.target.z;
    } else {
      // Karte nur neu zeichnen, wenn sich Ausschnitt oder Größe ändern
      const key = `${W}x${H}|${v.x.toFixed(1)}|${v.z.toFixed(1)}|${v.scale.toFixed(5)}`;
      if (key !== this.baseKey) {
        const b = this.baseCv;
        if (b.width !== W || b.height !== H) { b.width = W; b.height = H; }
        drawBase(b.getContext('2d'), W, H, v, this.cache, g, { names: true });
        this.baseKey = key;
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(this.baseCv, 0, 0);
      proj = projector2D(v, W, H);
      zoomScale = v.scale;
    }
    this._drawOverlay(c, W, H, proj, zoomScale);
    this._drawHud(1 / zoomScale);
  }

  // Wolken, Route, Ortsnamen, Symbole, Polizei und Spielerpfeil über der Karte
  _drawOverlay(c, W, H, proj, scale) {
    const g = this.game, now = performance.now() / 1000;
    const ui = clamp(H / 880, 0.85, 1.25);   // Symbolgröße passend zur Fensterhöhe
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    drawClouds(c, W, H, proj, scale, now);
    c.lineJoin = 'round'; c.lineCap = 'round';
    // Fahndungsbereich (auch in 3D als projizierter Kreis)
    if (g.police.wanted > 0 && g.police.area) {
      const pa = g.police.area, pulse = 0.5 + 0.5 * Math.sin(now * 3);
      const ring = new Path2D();
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * TAU, [sx, sy] = proj(pa.x + Math.cos(a) * pa.r, pa.z + Math.sin(a) * pa.r);
        if (i) ring.lineTo(sx, sy); else ring.moveTo(sx, sy);
      }
      ring.closePath();
      c.fillStyle = `rgba(255,35,50,${0.2 + pulse * 0.1})`; c.fill(ring);
      c.lineWidth = 3; c.strokeStyle = `rgba(255,80,90,${0.7 + pulse * 0.25})`; c.stroke(ring);
    }
    // Route
    if (this.route && this.route.length > 1) {
      const step = Math.max(1, Math.round(0.6 / (scale * 10)));
      const path = new Path2D();
      let started = false;
      for (let i = 0; i < this.route.length; i += step) {
        const [sx, sy, ok] = proj(this.route[i][0], this.route[i][1]);
        if (!ok) { started = false; continue; }
        if (!started) { path.moveTo(sx, sy); started = true; } else path.lineTo(sx, sy);
      }
      c.strokeStyle = 'rgba(10,16,32,.85)'; c.lineWidth = 9; c.stroke(path);
      c.strokeStyle = PAL.accent; c.lineWidth = 5.5; c.stroke(path);
      c.strokeStyle = 'rgba(255,255,255,.65)'; c.lineWidth = 1.6; c.setLineDash([2, 12]); c.lineDashOffset = -now * 40; c.stroke(path); c.setLineDash([]);
    }
    const onScreen = (x, y, m = 12) => x > -m && y > -m && x < W + m && y < H + m;
    // Symbole: Marker (Quests, Wohnung …) immer exakt an ihrer Position; Orte teils erst beim Heranzoomen, bei Platzmangel auseinandergerückt
    const lv = g.player.lastVehicle;
    const R = 12 * ui;
    const marks = this._blips().map((b) => ({ b, r: b.big ? R * 1.12 : R }));
    if (lv && lv.alive && !g.player.vehicle) marks.push({ b: { x: lv.x, z: lv.z, color: BLIP.vehicle.color, icon: BLIP.vehicle.icon }, r: R * 0.95 });
    const placed = [];
    for (const m of marks) { const [x, y, ok] = proj(m.b.x, m.b.z); m.x = x; m.y = y; m.ok = ok; if (ok) placed.push([x, y]); }
    const gap = (R * 2.3) ** 2;
    const free = (x, y) => placed.every((q) => (q[0] - x) ** 2 + (q[1] - y) ** 2 > gap);
    const spots = [];
    for (const b of this._poi()) {
      if (scale < b.minScale) continue;
      let [x, y, ok] = proj(b.x, b.z);
      if (!ok || !onScreen(x, y)) continue;
      if (!free(x, y)) {
        search: for (const rad of [R * 2.4, R * 4.2]) {
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * TAU + rad, qx = x + Math.cos(a) * rad, qy = y + Math.sin(a) * rad;
            if (free(qx, qy)) { x = qx; y = qy; break search; }
          }
        }
      }
      placed.push([x, y]);
      spots.push({ x, y, b });
    }
    // Ortsnamen zuerst (sie weichen den Symbolen und dem Spielerpfeil aus), Symbole darüber
    const p = g.player, vv = p.vehicle;
    const px = vv ? vv.x : p.x, pz = vv ? vv.z : p.z, hd = vv ? vv.h : p.h;
    const [ax, ay, aok] = proj(px, pz);
    const obstacles = placed.map(([x, y]) => [x, y, R * 1.15]);
    if (aok) obstacles.push([ax, ay, R * 1.5]);
    drawLabels(c, W, H, proj, scale, g.ctx.settlements, obstacles);
    for (const s of spots) drawMarker(c, s.x, s.y, R * 0.95, s.b.color, s.b.icon, s.b.square);
    for (const m of marks) {
      if (!m.ok || !onScreen(m.x, m.y)) continue;
      if (m.b.pulse) {
        const ph = (now * 0.9) % 1;
        c.strokeStyle = m.b.color; c.globalAlpha = 1 - ph; c.lineWidth = 3; c.beginPath(); c.arc(m.x, m.y, m.r + 4 + ph * 16, 0, TAU); c.stroke(); c.globalAlpha = 1;
      }
      drawMarker(c, m.x, m.y, m.r, m.b.color, m.b.icon, m.b.square);
    }
    // Wegpunkt
    if (this.waypoint) {
      const [x, y, ok] = proj(this.waypoint.x, this.waypoint.z);
      if (ok && onScreen(x, y, 30)) pin(c, x, y, R * 1.05);
    }
    // Polizei (blinkend)
    if (g.police.wanted > 0) {
      const flash = Math.floor(now * 4) % 2;
      const col = flash ? '#ff3b4a' : '#3a7bff';
      c.lineWidth = 2.5; c.strokeStyle = '#fff';
      const dot = (wx, wz, rad) => { const [sx, sy, ok] = proj(wx, wz); if (!ok || !onScreen(sx, sy)) return; c.fillStyle = col; c.beginPath(); c.arc(sx, sy, rad, 0, TAU); c.fill(); c.stroke(); };
      for (const u of g.police.units) if (u.alive && !u.exploded) dot(u.x, u.z, 7);
      for (const u of g.police.foot) if (u.alive) dot(u.x, u.z, 5);
      for (const h of [g.police.heli, g.police.heli2]) if (h && h.alive) dot(h.x, h.z, 9);
    }
    // Mitspieler (Multiplayer): grüner Punkt mit Namen
    if (g.net) {
      c.font = `700 ${Math.round(13 * ui)}px ${MAP_FONT}`; c.textAlign = 'center'; c.textBaseline = 'bottom';
      for (const b of g.net.blips()) {
        const [sx, sy, ok] = proj(b.x, b.z);
        if (!ok || !onScreen(sx, sy)) continue;
        c.fillStyle = '#22c55e'; c.strokeStyle = '#fff'; c.lineWidth = 2.2; c.beginPath(); c.arc(sx, sy, 7 * ui, 0, TAU); c.fill(); c.stroke();
        c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,.75)'; c.strokeText(b.name, sx, sy - 10 * ui); c.fillStyle = '#eafff1'; c.fillText(b.name, sx, sy - 10 * ui);
      }
    }
    // Spieler: Pfeil in Blickrichtung (auch in 3D relativ zur Kamera), mit pulsierendem Ring
    if (aok && onScreen(ax, ay, 40)) {
      const [bx, by] = proj(px + Math.sin(hd) * 25, pz + Math.cos(hd) * 25);
      const ang = Math.atan2(by - ay, bx - ax) + Math.PI / 2;
      const ph = (now * 0.8) % 1;
      c.fillStyle = 'rgba(255,255,255,.14)'; c.beginPath(); c.arc(ax, ay, 15 + ph * 14, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 2; c.globalAlpha = 1 - ph; c.beginPath(); c.arc(ax, ay, 15 + ph * 14, 0, TAU); c.stroke(); c.globalAlpha = 1;
      drawArrow(c, ax, ay, ang, 15 * ui);
    }
    // Controller: Fadenkreuz in der Bildmitte (dort setzt A den Wegpunkt)
    if (g.input.device === 'pad') {
      const cx = W / 2, cy = H / 2;
      for (const [col, w] of [['rgba(10,16,32,.85)', 5], ['#fff', 2]]) {
        c.strokeStyle = col; c.lineWidth = w; c.beginPath();
        c.arc(cx, cy, 11, 0, TAU);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(cx + dx * 15, cy + dy * 15); c.lineTo(cx + dx * 26, cy + dy * 26); }
        c.stroke();
      }
    }
    c.restore();
  }

  // Uhr, Geld, Kompass und Maßstabsleiste
  _drawHud(metersPerPixel) {
    const g = this.game, fe = this.fullEl, hud = this.hud;
    const set = (key, value, apply) => { if (hud[key] !== value) { hud[key] = value; apply(value); } };
    const h = g.atm.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    set('clock', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, (t) => { fe.querySelector('.mclock').textContent = t; });
    set('money', fmtMoney(g.money), (t) => { fe.querySelector('.mmoney').textContent = t; });
    const deg = Math.round(this.mode === '3d' && this.m3 ? (this.m3.yaw * 180) / Math.PI : 0);
    set('north', deg, (d) => fe.querySelector('.mcompass .needle').setAttribute('transform', `rotate(${d} 32 32)`));
    // Maßstab: die größte runde Strecke, die in 300 Bildpunkte passt
    let len = SCALE_STEPS[0];
    for (const s of SCALE_STEPS) if (s / metersPerPixel <= 300) len = s;
    const width = Math.round(len / metersPerPixel);
    set('scale', `${len}|${width}`, () => {
      const box = fe.querySelector('.mapscale'), km = len >= 1000;
      const fmt = (m) => (km ? m / 1000 : m).toLocaleString('de-DE');
      box.style.width = width + 'px';
      const spans = box.querySelectorAll('.nums span');
      [0, len / 4, len / 2, len].forEach((m, i) => { spans[i].textContent = fmt(m) + (i === 3 ? (km ? ' km' : ' m') : ''); });
    });
  }
}
