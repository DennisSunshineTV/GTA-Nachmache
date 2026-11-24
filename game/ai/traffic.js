// Straßenverkehr: Fahrzeuge folgen Fahrspuren, halten Abstand, bremsen für Hindernisse; geparkte Autos.
import { clamp, wrapPi, lerp } from '../util.js';
import { Character } from '../entities/character.js';
import { Router, laneTarget, projectOnRoad } from './router.js';

const URBAN = new Set(['street', 'avenue', 'promenade', 'alley', 'quay']);
const pickW = (rnd, table) => { let t = 0; for (const [, w] of table) t += w; let r = rnd() * t; for (const [k, w] of table) { r -= w; if (r <= 0) return k; } return table[0][0]; };

const TABLES = {
  highway: [['compact', 0.16], ['sports', 0.12], ['luxury', 0.1], ['suv', 0.14], ['van', 0.12], ['truck', 0.14], ['coupe', 0.08], ['pickup', 0.08], ['taxi', 0.03], ['bus', 0.03]],
  urban: [['compact', 0.22], ['taxi', 0.12], ['suv', 0.1], ['luxury', 0.08], ['sports', 0.07], ['coupe', 0.08], ['van', 0.1], ['moto', 0.1], ['pickup', 0.04], ['bus', 0.05], ['truck', 0.04]],
  avenue: [['compact', 0.18], ['taxi', 0.14], ['suv', 0.1], ['luxury', 0.1], ['sports', 0.08], ['coupe', 0.07], ['van', 0.08], ['moto', 0.08], ['bus', 0.12], ['truck', 0.05]],
  rural: [['compact', 0.2], ['suv', 0.16], ['pickup', 0.14], ['truck', 0.08], ['moto', 0.1], ['van', 0.1], ['tractor', 0.1], ['coupe', 0.06], ['sports', 0.06]],
  scenic: [['sports', 0.2], ['moto', 0.2], ['luxury', 0.12], ['coupe', 0.1], ['suv', 0.14], ['compact', 0.14], ['pickup', 0.06], ['bus', 0.04]],
};
const PARK_TYPES = [['compact', 0.3], ['suv', 0.16], ['sports', 0.1], ['luxury', 0.1], ['coupe', 0.1], ['van', 0.1], ['pickup', 0.05], ['taxi', 0.05], ['moto', 0.04]];

export class TrafficManager {
  constructor(game) {
    this.game = game;
    this.router = new Router(game.ctx.net);
    this.cars = [];
    this.parked = [];
    this.target = game.quality.traffic;
    this.targetParked = game.quality.parked;
    this.spawnT = 0;
    this.parkT = 0;
    this._tmp = {};
    this._tmp2 = {};
    this.rnd = Math.random;
  }

  roadKindGroup(r) { return r.kind === 'highway' ? 'highway' : r.kind === 'avenue' ? 'avenue' : URBAN.has(r.kind) ? 'urban' : r.kind === 'scenic' ? 'scenic' : 'rural'; }

  trafficable(r) { return !r.noTraffic && r.kind !== 'track' && r.kind !== 'quay'; }

  // Zufälligen Verkehrspunkt in der Nähe des Spielers suchen
  _findSpot(px, pz, rMin, rMax) {
    const net = this.game.ctx.net;
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, d = rMin + Math.random() * (rMax - rMin);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const nr = net.nearest(x, z, 70, (r) => this.trafficable(r));
      if (!nr) continue;
      const dist = Math.hypot(nr.x - px, nr.z - pz);
      if (dist < rMin * 0.9 || dist > rMax * 1.1) continue;
      return nr;
    }
    return null;
  }

  spawnCar(px, pz, rMin = 120, rMax = 270) {
    const g = this.game;
    const nr = this._findSpot(px, pz, rMin, rMax);
    if (!nr) return null;
    const r = nr.road;
    const grp = this.roadKindGroup(r);
    const fwd = Math.random() < 0.5;
    const s = fwd ? r.cum[nr.i] + (r.cum[nr.i + 1] - r.cum[nr.i]) * nr.t : r.len - (r.cum[nr.i] + (r.cum[nr.i + 1] - r.cum[nr.i]) * nr.t);
    const lanes = r.lanes >= 4 ? (Math.random() < 0.5 ? 0.14 : 0.37) * r.w : r.lanes >= 2 ? r.w * 0.25 : 0;
    const t = laneTarget(g.ctx.net, r, fwd, s, lanes, {});
    // Platz prüfen
    for (const v of g.vehicles.list) if (Math.hypot(v.x - t.px, v.z - t.pz) < 14) return null;
    if (g.player && Math.hypot(t.px - g.player.x, t.pz - g.player.z) < rMin * 0.8) return null;
    let type = pickW(Math.random, TABLES[grp]);
    const night = g.atm.night > 0.5;
    if (grp !== 'highway' && night && Math.random() < 0.3) return null;
    let owner = 'traffic', police = false;
    if ((grp === 'urban' || grp === 'avenue') && Math.random() < 0.06 && g.police) { type = 'police'; owner = 'police'; police = true; }
    const v = g.vehicles.spawn(type, t.px, t.pz, Math.atan2(t.tx, t.tz), { owner, paint: Math.floor(Math.random() * 12) });
    const drv = new Character(g, 'ped', v.x, v.z, { noHuman: true, outfit: police ? 'cop' : 'local' });
    drv.noHuman = true; drv.state = 'vehicle'; drv.vehicle = v; drv.seat = 0; drv.isDriver = true;
    v.driver = drv; v.engineOn = true;
    g.addCharacter(drv);
    const limit = r.speed * (0.8 + Math.random() * 0.25) * (type === 'bus' || type === 'truck' ? 0.85 : type === 'sports' ? 1.1 : 1);
    v.ai = { kind: 'traffic', road: r, fwd, s, lane: lanes, limit, next: null, panic: 0, moving: true, blocked: 0, group: grp, police };
    v.speed = limit * 0.5; v.vx = Math.sin(v.h) * limit * 0.5; v.vz = Math.cos(v.h) * limit * 0.5;
    this.cars.push(v);
    return v;
  }

  spawnParked(px, pz) {
    const g = this.game, net = g.ctx.net;
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, d = 25 + Math.random() * 140;
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const nr = net.nearest(x, z, 50, (r) => (r.kind === 'street' || r.kind === 'avenue' || r.kind === 'alley') && r.sw > 0);
      if (!nr) continue;
      const r = nr.road;
      const s = r.cum[nr.i] + (r.cum[nr.i + 1] - r.cum[nr.i]) * nr.t;
      if (s < 18 || s > r.len - 18) continue;
      const side = Math.random() < 0.5 ? 1 : -1;
      const p = net.pointAt(r, s, {});
      const off = (r.w / 2 - 1.15) * side;
      const px2 = p.x + (-p.dz) * off, pz2 = p.z + p.dx * off;
      if (g.physics.groundHeight(px2, pz2) < 0.2) continue;
      let bad = false;
      for (const v of g.vehicles.list) if (Math.hypot(v.x - px2, v.z - pz2) < 6) { bad = true; break; }
      if (bad) continue;
      const type = pickW(Math.random, PARK_TYPES);
      const hd = Math.atan2(p.dx * side, p.dz * side);
      const v = g.vehicles.spawn(type, px2, pz2, hd, { owner: 'parked', paint: Math.floor(Math.random() * 12) });
      v.locked = Math.random() < 0.0;
      this.parked.push(v);
      return v;
    }
    return null;
  }

  // Fahrzeug gehört nicht mehr dem Verkehr (Spieler übernimmt)
  release(v) {
    let i = this.cars.indexOf(v); if (i >= 0) this.cars.splice(i, 1);
    i = this.parked.indexOf(v); if (i >= 0) this.parked.splice(i, 1);
    v.ai = null;
  }

  update(dt) {
    const g = this.game, p = g.player;
    const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
    // Spawnen
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.35;
      if (this.cars.length < this.target) this.spawnCar(px, pz);
    }
    this.parkT -= dt;
    if (this.parkT <= 0) {
      this.parkT = 0.6;
      if (this.parked.length < this.targetParked) this.spawnParked(px, pz);
    }
    // KI + Entfernen
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (!v.alive || !v.ai) { this.cars.splice(i, 1); continue; }
      const d = Math.hypot(v.x - px, v.z - pz);
      if (d > 340 || (v.exploded && v.wreckT > 45)) { this._remove(v); this.cars.splice(i, 1); continue; }
      if (v.exploded || v.burning > 0) { v.ai.moving = false; continue; }
      if (!v.driver || !v.driver.alive) { v.ai.moving = false; v.ctl.throttle = 0; v.ctl.brake = 1; continue; }
      this._drive(v, dt);
    }
    for (let i = this.parked.length - 1; i >= 0; i--) {
      const v = this.parked[i];
      if (!v.alive || v.owner !== 'parked' || v.driver) { this.parked.splice(i, 1); continue; }
      const d = Math.hypot(v.x - px, v.z - pz);
      if (d > 260 || (v.exploded && v.wreckT > 45)) { g.vehicles.remove(v); this.parked.splice(i, 1); }
    }
  }

  _remove(v) {
    if (v.driver && v.driver.noHuman) { this.game.removeCharacter(v.driver); }
    this.game.vehicles.remove(v);
  }

  _drive(v, dt) {
    const g = this.game, net = g.ctx.net, a = v.ai, ctl = v.ctl;
    // Straße wählen, falls keine
    if (!a.road) return;
    a.s = projectOnRoad(net, a.road, v.x, v.z, a.s, a.fwd);
    // Ende erreicht → nächste Straße
    if (a.road.len - a.s < 4) {
      if (!a.next) a.next = this._chooseNext(a);
      if (a.next) { a.road = a.next.road; a.fwd = a.next.fwd; a.s = 0.5; a.next = null; a.lane = this._laneFor(a.road, a.lane); }
      else { a.s = a.road.len; }
    }
    // Zielpunkt voraus
    const speed = Math.max(0, v.speed);
    const look = 6 + speed * 0.6;
    let road = a.road, fwd = a.fwd, sT = a.s + look;
    if (sT > road.len) {
      if (!a.next) a.next = this._chooseNext(a);
      if (a.next) { sT -= road.len; road = a.next.road; fwd = a.next.fwd; sT = Math.min(sT, road.len); }
      else sT = road.len;
    }
    const off = a.panic > 0 ? 0 : a.lane;
    const t = laneTarget(net, road, fwd, sT, off, this._tmp);
    const desired = Math.atan2(t.px - v.x, t.pz - v.z);
    const err = wrapPi(desired - v.h);
    ctl.steer = clamp(err * 2.2, -1, 1);
    // Zielgeschwindigkeit
    let limit = a.limit * (a.panic > 0 ? 1.5 : 1);
    limit = Math.min(limit, 7 + 26 / (1 + Math.abs(err) * 5) * (a.limit / 20));
    if (a.road.len - a.s < 25 && a.next === null) limit = Math.min(limit, 9);
    // Hindernisse voraus
    const fx = Math.sin(v.h), fz = Math.cos(v.h), lx = Math.cos(v.h), lz = -Math.sin(v.h);
    const D = 8 + speed * 1.5;
    let stopDist = 1e9;
    for (const o of g.vehicles.list) {
      if (o === v || !o.alive) continue;
      const rx = o.x - v.x, rz = o.z - v.z;
      if (Math.abs(rx) > D + 6 || Math.abs(rz) > D + 6) continue;
      const ah = rx * fx + rz * fz, la = rx * lx + rz * lz;
      if (ah < 0 || ah > D + v.hl + o.hl) continue;
      const wide = v.hw + Math.max(o.hw, 0.9) + 0.5;
      if (Math.abs(la) < wide) {
        const gap = ah - v.hl - o.hl;
        // Entgegenkommende in der Nachbarspur ignorieren (gleiche Richtung des Fahrzeugs prüfen)
        const dot = fx * Math.sin(o.h) + fz * Math.cos(o.h);
        if (dot < -0.5 && Math.abs(la) > 1.6) continue;
        stopDist = Math.min(stopDist, gap - (Math.max(0, o.speed) * 0.6));
      }
    }
    for (const c of g.allCharacters()) {
      if (!c.alive || c.state === 'vehicle' || c === g.player && g.player.vehicle) continue;
      const rx = c.x - v.x, rz = c.z - v.z;
      if (Math.abs(rx) > D || Math.abs(rz) > D) continue;
      const ah = rx * fx + rz * fz, la = rx * lx + rz * lz;
      if (ah > 0 && ah < D && Math.abs(la) < v.hw + 1.0) stopDist = Math.min(stopDist, ah - v.hl - 1.2);
    }
    if (stopDist < 1e8) {
      limit = Math.min(limit, Math.max(0, (stopDist - 2.5) * 1.1));
      if (stopDist < 3) limit = 0;
    }
    // Blockade lösen
    if (speed < 0.6 && limit > 2) { a.blocked += dt; } else a.blocked = Math.max(0, a.blocked - dt);
    if (a.blocked > 7) { a.panic = Math.max(a.panic, 2.5); a.lane += (Math.random() < 0.5 ? 1 : -1) * 0.0; ctl.throttle = -0.8; ctl.steer = -ctl.steer; if (a.blocked > 10) a.blocked = 0; if (stopDist < 1e8 && a.blocked > 8.5) { v.horn = 0.3; } return; }
    a.panic = Math.max(0, a.panic - dt);
    const diff = limit - speed;
    ctl.throttle = diff > 0.5 ? clamp(diff * 0.5, 0.15, 1) * (limit < 1 ? 0 : 1) : 0;
    ctl.brake = diff < -1.2 ? clamp(-diff * 0.12, 0.1, 1) : 0;
    if (limit <= 0.1) { ctl.throttle = 0; ctl.brake = 0.8; }
    ctl.handbrake = false;
    v.sirenOn = a.police && a.panic > 0;
  }

  _laneFor(r, prev) {
    return r.lanes >= 4 ? (Math.random() < 0.5 ? 0.14 : 0.37) * r.w : r.lanes >= 2 ? r.w * 0.25 : 0;
  }

  _chooseNext(a) {
    const net = this.game.ctx.net;
    const road = a.road;
    const node = a.fwd ? road.b : road.a;
    const last = road.pts[a.fwd ? road.pts.length - 1 : 0], prev = road.pts[a.fwd ? road.pts.length - 2 : 1];
    let dx = last[0] - prev[0], dz = last[1] - prev[1]; const l = Math.hypot(dx, dz) || 1;
    const e = this.router.pickNext(node, road, { x: dx / l, z: dz / l });
    return e ? { road: e.road, fwd: e.fwd } : null;
  }

  // Auf Gefahr reagieren (Beschuss, Rammen): Fahrer flieht / hupt
  panic(v, secs = 8) { if (v.ai) v.ai.panic = Math.max(v.ai.panic, secs); }
}
