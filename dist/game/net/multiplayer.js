// Multiplayer: 2 Server mit je höchstens 16 registrierten Spielern auf einer gemeinsamen Karte.
// Shared-Hosting (PHP) kennt keine dauerhaften Verbindungen: Das Spiel meldet seinen Zustand mehrmals pro Sekunde
// (/api/mp/sync) und bekommt dabei die Zustände der anderen zurück. Andere Spieler erscheinen als Figuren mit Namen,
// in ihren Fahrzeugen, auf Minikarte und Karte. Uhrzeit und Wetter kommen für alle gleich vom Server.
import * as THREE from 'three';
import { Character } from '../entities/character.js';
import { Vehicle } from '../entities/vehicle.js';
import { VEHICLE_TYPES } from '../entities/vehicle_models.js';
import { WEAPONS } from '../combat/weapons.js';
import { dampAngle } from '../util.js';

const VISIBLE_DRIVER = new Set(['moto', 'tractor', 'forklift', 'speedboat', 'jetski', 'excavator']);
const WEATHERS = ['sunny', 'clear', 'cloudy', 'sunny', 'overcast', 'clear', 'rain', 'sunny', 'cloudy', 'fog', 'clear', 'sunny', 'storm', 'clear'];
const EPOCH = Date.UTC(2026, 10, 28) / 1000;     // Server-Tag 1 beginnt am 28.11.2026 um 10:30 Spielzeit
const r2 = (v) => Math.round(v * 100) / 100;
const hashInt = (n) => { let h = (n | 0) * 2654435761; h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return h >>> 0; };

class Remote {
  constructor(mp, data) {
    this.mp = mp;
    this.game = mp.game;
    this.id = data.id;
    this.name = data.name;
    this.st = data.st;
    this.t = performance.now() - (data.age || 0);
    this.who = data.st.c === 'lucia' ? 'lucia' : 'jason';
    const g = this.game;
    this.ch = new Character(g, 'remote', data.st.x, data.st.z, { outfit: 'player_' + this.who, hp: 100 });
    this.ch.remote = true; this.ch.name = data.name;
    this.ch.y = data.st.y; this.ch.h = data.st.h;
    this.ch.ensureHuman();
    this.veh = null; this.vehKey = ''; this.vehIdle = 0;
    this.tag = document.createElement('div');
    this.tag.className = 'mptag';
    this.tag.textContent = data.name;
    mp.tagRoot.appendChild(this.tag);
  }

  setState(st, age) {
    this.st = st;
    this.t = performance.now() - (age || 0);
    const who = st.c === 'lucia' ? 'lucia' : 'jason';
    if (who !== this.who) { this.who = who; this.ch.setOutfit('player_' + who); }
  }

  _vehicle(v) {
    const key = v.t + '|' + v.p;
    if (this.veh && this.vehKey === key) return this.veh;
    if (this.veh) { this.veh.dispose(); this.veh = null; }
    if (!VEHICLE_TYPES[v.t]) return null;
    this.veh = new Vehicle(this.game, v.t, v.x, v.z, v.h, { owner: 'remote', paint: v.p });
    this.veh.remote = true; this.veh.y = v.y; this.veh.engineOn = true;
    this.vehKey = key;
    return this.veh;
  }

  update(dt) {
    const st = this.st, ch = this.ch, g = this.game;
    const ex = Math.min(0.5, (performance.now() - this.t) / 1000);   // so lange ist der letzte Stand alt: vorausrechnen
    const k = 1 - Math.exp(-dt * 9);
    if (st.v) {
      const sv = st.v, v = this._vehicle(sv);
      if (!v) return;
      this.vehIdle = 0;
      const tx = sv.x + Math.sin(sv.h) * sv.sp * ex, tz = sv.z + Math.cos(sv.h) * sv.sp * ex;
      if (Math.hypot(tx - v.x, tz - v.z) > 25) { v.x = tx; v.z = tz; v.y = sv.y; v.h = sv.h; }
      v.x += (tx - v.x) * k; v.z += (tz - v.z) * k; v.y += (sv.y - v.y) * k;
      v.h = dampAngle(v.h, sv.h, 9, dt);
      v.pitch += (sv.pi - v.pitch) * k; v.roll += (sv.ro - v.roll) * k; v.steerAngle += (sv.st - v.steerAngle) * k;
      v.speed = sv.sp; v.vx = Math.sin(v.h) * sv.sp; v.vz = Math.cos(v.h) * sv.sp;
      v.lightsOn = !!sv.l; v.sirenOn = !!sv.si; v.engineOn = true;
      v.ctl.brake = 0; v.ctl.throttle = 0;
      for (const w of v.refs.wheels) w.spin += (sv.sp * dt) / w.r;
      v.syncVisual(dt);
      ch.state = 'vehicle'; ch.vehicle = v; ch.seat = sv.seat || 0;
      if (ch.seat === 0) v.driver = ch;
      ch.showInVehicle = VISIBLE_DRIVER.has(sv.t);
      ch._followVehicle(dt);
      ch._updateVisual(dt);
      ch.resyncSeat();
    } else {
      // ausgestiegen: Fahrzeug bleibt noch eine Weile stehen
      if (this.veh) {
        this.veh.driver = null; this.veh.speed = 0; this.veh.vx = this.veh.vz = 0; this.veh.engineOn = false;
        this.vehIdle += dt;
        this.veh.syncVisual(dt);
        if (this.vehIdle > 45) { this.veh.dispose(); this.veh = null; this.vehKey = ''; }
      }
      if (ch.vehicle) { ch.vehicle = null; }
      const tx = st.x + Math.sin(st.h) * st.s * ex * (st.m === 'dead' ? 0 : 1), tz = st.z + Math.cos(st.h) * st.s * ex * (st.m === 'dead' ? 0 : 1);
      if (Math.hypot(tx - ch.x, tz - ch.z) > 15) { ch.x = tx; ch.z = tz; ch.y = st.y; }
      ch.x += (tx - ch.x) * k; ch.z += (tz - ch.z) * k; ch.y += (st.y - ch.y) * k;
      ch.h = dampAngle(ch.h, st.h, 10, dt);
      ch.speedH = st.s;
      ch.state = st.m === 'swim' ? 'swim' : st.m === 'dead' ? 'dead' : st.m === 'air' ? 'air' : 'ground';
      if (ch.state === 'dead') ch.deadT += dt; else ch.deadT = 0;
      ch.crouch = !!st.cr;
      ch.anim.phone = !!st.ph;
      if (st.w && WEAPONS[st.w] && ch.cur !== st.w) { if (st.w !== 'fists') ch.weapons[st.w] = { mag: 1, reserve: 0 }; ch.setWeapon(st.w); }
      ch.intent.aim = !!st.a; ch.intent.ay = st.ap || 0;
      ch.intent.ax = Math.sin(ch.h); ch.intent.az = Math.cos(ch.h);
      ch.showInVehicle = false;
      ch._updateVisual(dt);
    }
    // Namensschild über dem Kopf
    const cam = g.camera, W = g.ui.root.clientWidth, H = g.ui.root.clientHeight;
    const hx = ch.state === 'vehicle' && this.veh ? this.veh.x : ch.x, hz = ch.state === 'vehicle' && this.veh ? this.veh.z : ch.z;
    const hy = (ch.state === 'vehicle' && this.veh ? this.veh.y + this.veh.height + 0.6 : ch.y + 2.15);
    const d = Math.hypot(hx - cam.position.x, hz - cam.position.z);
    const v3 = this.mp._v.set(hx, hy, hz).project(cam);
    if (d > 140 || v3.z > 1 || v3.z < -1 || Math.abs(v3.x) > 1.1 || Math.abs(v3.y) > 1.1) this.tag.style.display = 'none';
    else {
      this.tag.style.display = 'block';
      this.tag.style.left = ((v3.x * 0.5 + 0.5) * W) + 'px';
      this.tag.style.top = ((-v3.y * 0.5 + 0.5) * H) + 'px';
      this.tag.style.opacity = String(Math.max(0.35, 1 - d / 160));
    }
  }

  get pos() { return this.st.v ? { x: this.st.v.x, z: this.st.v.z } : { x: this.st.x, z: this.st.z }; }

  dispose() {
    this.ch.dispose();
    if (this.veh) this.veh.dispose();
    this.tag.remove();
  }
}

export class Multiplayer {
  constructor(game, opts) {
    this.game = game;
    this.server = opts.server;
    this.serverName = 'Server ' + opts.server;
    this.token = opts.token;
    this.me = opts.you || { id: 0, name: game.userName };
    this.max = opts.max || 16;
    this.offset = (opts.now || Date.now()) - Date.now();
    this.remotes = new Map();
    this.count = 1 + (opts.players || []).length;
    this.stopped = false;
    this.fails = 0;
    this._v = new THREE.Vector3();
    this.tagRoot = document.createElement('div');
    this.tagRoot.className = 'mptags';
    // Namensschilder liegen unter den Menüs und der Karte
    const host = game.ui?.root || document.body;
    host.insertBefore(this.tagRoot, host.firstChild);
    this._apply(opts.players || [], true);
    this._timer = setTimeout(() => this._sync(), 150);
    this._onHide = () => this.leave(true);
    window.addEventListener('pagehide', this._onHide);
  }

  now() { return Date.now() + this.offset; }
  // Serveruhr → Spielzeit: 1 Spielstunde = 100 s (wie im Einzelspieler)
  gameHours() { return (this.now() / 1000 - EPOCH) / 100 + 10.5; }
  hour() { return ((this.gameHours() % 24) + 24) % 24; }
  serverDay() { return Math.max(1, Math.floor(this.gameHours() / 24) + 1); }

  // Uhrzeit und Wetter für alle gleich (Wetter wechselt alle 7 Minuten)
  applyClock(atm) {
    atm.hour = this.hour();
    const blk = Math.floor(this.now() / 1000 / 420);
    if (blk !== this._wb) {
      const first = this._wb === undefined;
      this._wb = blk;
      atm.setWeather(WEATHERS[hashInt(blk) % WEATHERS.length], first);
    }
  }

  countText() { return `${this.count} von ${this.max}`; }

  playerList() {
    const g = this.game, p = g.player;
    const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
    const info = (st) => (st.v ? (VEHICLE_TYPES[st.v.t]?.name || 'Fahrzeug') : st.m === 'swim' ? 'schwimmt' : 'zu Fuß');
    const list = [{ name: this.me.name, me: true, info: p.vehicle ? p.vehicle.T.name : 'zu Fuß' }];
    for (const r of this.remotes.values()) {
      const q = r.pos, d = Math.hypot(q.x - px, q.z - pz);
      list.push({ name: r.name, me: false, info: `${info(r.st)} · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1).replace('.', ',') + ' km'}` });
    }
    return list;
  }

  // Für Minikarte und Karte
  blips() { const out = []; for (const r of this.remotes.values()) { const q = r.pos; out.push({ x: q.x, z: q.z, name: r.name }); } return out; }
  vehicles() { const out = []; for (const r of this.remotes.values()) if (r.veh) out.push(r.veh); return out; }

  _state() {
    const p = this.game.player, v = p.vehicle;
    const st = {
      x: r2(p.x), y: r2(p.y), z: r2(p.z), h: r2(p.h), s: r2(p.speedH || 0),
      m: !p.alive ? 'dead' : p.state === 'swim' ? 'swim' : p.state === 'air' ? 'air' : 'walk',
      w: p.cur, c: p.who, a: p.aiming ? 1 : 0, cr: p.crouch ? 1 : 0, ph: p.anim.phone ? 1 : 0, ap: r2(p.intent.ay || 0),
    };
    if (v) st.v = { t: v.type, p: v.paintIdx, x: r2(v.x), y: r2(v.y), z: r2(v.z), h: r2(v.h), pi: r2(v.pitch), ro: r2(v.roll), st: r2(v.steerAngle), sp: r2(v.speed), l: v.lightsOn ? 1 : 0, si: v.sirenOn ? 1 : 0, seat: p.seat || 0 };
    return st;
  }

  _apply(players, initial = false) {
    const seen = new Set();
    for (const d of players) {
      if (!d || !d.st || d.id === this.me.id) continue;
      seen.add(d.id);
      const r = this.remotes.get(d.id);
      if (r) r.setState(d.st, d.age);
      else {
        this.remotes.set(d.id, new Remote(this, d));
        if (!initial) this.game.ui?.notify(`${d.name} ist dem ${this.serverName} beigetreten`, 'info');
      }
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) {
      r.dispose(); this.remotes.delete(id);
      this.game.ui?.notify(`${r.name} hat den Server verlassen`, 'info');
    }
  }

  async _sync() {
    if (this.stopped) return;
    const t0 = performance.now();
    let next = 1000;
    try {
      const res = await fetch('/api/mp/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ server: this.server, token: this.token, st: this._state() }) });
      const d = await res.json().catch(() => ({}));
      if (this.stopped) return;
      if (res.status === 409) { await this._rejoin(); return; }
      if (!res.ok) throw new Error(d.error || 'Fehler');
      const rtt = performance.now() - t0;
      const off = d.now + rtt / 2 - Date.now();
      this.offset += (off - this.offset) * (this.fails || !this._synced ? 1 : 0.2);
      this._synced = true;
      this.count = d.count || 1; this.max = d.max || this.max;
      this._apply(d.players || []);
      if (this.fails >= 4) this.game.ui?.notify('Verbindung zum Server wiederhergestellt', 'good');
      this.fails = 0;
      next = this.remotes.size ? Math.max(220, rtt * 1.15) : 1000;   // mit anderen Spielern ~4-mal pro Sekunde
    } catch {
      this.fails++;
      if (this.fails === 4) this.game.ui?.notify('Verbindung zum Server gestört – versuche es weiter …', 'warn');
      next = Math.min(4000, 400 * this.fails);
    }
    if (!this.stopped) this._timer = setTimeout(() => this._sync(), Math.max(30, next - (performance.now() - t0)));
  }

  // Verbindung abgelaufen (z. B. Tab lange im Hintergrund): neu beitreten, sonst zurück ins Hauptmenü
  async _rejoin() {
    try {
      const res = await fetch('/api/mp/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ server: this.server }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Der Server ist nicht erreichbar.');
      this.token = d.token;
      this._timer = setTimeout(() => this._sync(), 100);
    } catch (e) {
      this.stopped = true;
      this.game.ui?.notify(e.message + ' Zurück zum Hauptmenü …', 'warn', 6000);
      setTimeout(() => this.game.exitToMenu?.(), 3500);
    }
  }

  update(dt) {
    if (this.stopped) return;
    for (const r of this.remotes.values()) r.update(dt);
    // Berührungen: Spielfigur wird von anderen Spielern und ihren Fahrzeugen weggeschoben (kein Schaden)
    const g = this.game, p = g.player;
    if (!p.vehicle) {
      for (const r of this.remotes.values()) {
        const c = r.ch;
        if (c.state === 'vehicle') continue;
        const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
        if (d < 0.7 && d > 1e-4 && Math.abs(p.y - c.y) < 1.6) { p.x += (dx / d) * (0.7 - d); p.z += (dz / d) * (0.7 - d); }
      }
    }
    for (const v of this.vehicles()) {
      if (p.vehicle) { if (Math.abs(p.vehicle.x - v.x) < 14 && Math.abs(p.vehicle.z - v.z) < 14) g.vehicles._collide(p.vehicle, v, true); continue; }
      const dx = p.x - v.x, dz = p.z - v.z;
      const fx = Math.sin(v.h), fz = Math.cos(v.h);
      const lf = dx * fx + dz * fz, ll = dx * Math.cos(v.h) - dz * Math.sin(v.h);
      const ox = v.hw + p.radius - Math.abs(ll), oz = v.hl + p.radius - Math.abs(lf);
      if (ox > 0 && oz > 0 && p.y < v.y + v.height && p.y + 1.8 > v.y) {
        if (ox < oz) { const s = Math.sign(ll) || 1; p.x += Math.cos(v.h) * s * ox; p.z += -Math.sin(v.h) * s * ox; }
        else { const s = Math.sign(lf) || 1; p.x += fx * s * oz; p.z += fz * s * oz; }
      }
    }
  }

  leave(beacon = false) {
    if (this.stopped && this._left) return;
    this.stopped = true; this._left = true;
    clearTimeout(this._timer);
    const body = JSON.stringify({ server: this.server, token: this.token });
    try {
      if (beacon && navigator.sendBeacon) navigator.sendBeacon('/api/mp/leave', new Blob([body], { type: 'application/json' }));
      else fetch('/api/mp/leave', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    } catch { /* ignorieren */ }
  }

  dispose() {
    this.leave(true);
    window.removeEventListener('pagehide', this._onHide);
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.tagRoot.remove();
  }
}
