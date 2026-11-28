// Straßenverkehr: Fahrzeuge folgen Fahrspuren, halten Abstand, bremsen für Hindernisse; geparkte Autos.
import { Character } from '../entities/character.js';
import { Router, laneTarget } from './router.js';
import { newRail, laneOffset, plan, poseAhead, curveLimit, attachRail } from './rail.js';

const URBAN = new Set(['street', 'avenue', 'promenade', 'alley', 'quay']);
const pickW = (rnd, table) => { let t = 0; for (const [, w] of table) t += w; let r = rnd() * t; for (const [k, w] of table) { r -= w; if (r <= 0) return k; } return table[0][0]; };

const TABLES = {
  highway: [['compact', 0.16], ['sports', 0.12], ['luxury', 0.1], ['suv', 0.14], ['van', 0.12], ['truck', 0.14], ['coupe', 0.08], ['pickup', 0.08], ['taxi', 0.03], ['bus', 0.03]],
  urban: [['compact', 0.22], ['taxi', 0.12], ['suv', 0.1], ['luxury', 0.08], ['sports', 0.07], ['coupe', 0.08], ['van', 0.07], ['econelo', 0.05], ['moto', 0.1], ['pickup', 0.04], ['bus', 0.08], ['truck', 0.04]],
  avenue: [['compact', 0.18], ['taxi', 0.14], ['suv', 0.1], ['luxury', 0.1], ['sports', 0.08], ['coupe', 0.07], ['van', 0.08], ['econelo', 0.03], ['moto', 0.08], ['bus', 0.12], ['truck', 0.05]],
  rural: [['compact', 0.2], ['suv', 0.16], ['pickup', 0.14], ['truck', 0.08], ['moto', 0.1], ['van', 0.1], ['tractor', 0.1], ['coupe', 0.06], ['sports', 0.06]],
  scenic: [['sports', 0.2], ['moto', 0.2], ['luxury', 0.12], ['coupe', 0.1], ['suv', 0.14], ['compact', 0.14], ['pickup', 0.06], ['bus', 0.04]],
};
const LOT_TYPES = [['compact', 0.3], ['suv', 0.18], ['sports', 0.07], ['luxury', 0.09], ['coupe', 0.1], ['van', 0.08], ['pickup', 0.07], ['taxi', 0.03], ['econelo', 0.08]];
const PARK_TYPES = [['compact', 0.3], ['suv', 0.16], ['sports', 0.1], ['luxury', 0.1], ['coupe', 0.1], ['van', 0.07], ['econelo', 0.05], ['pickup', 0.05], ['taxi', 0.05], ['moto', 0.04]];

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
    this.lotCars = []; this.lotT = 0;
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
    const lanes = laneOffset(r);
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
    // nie schneller als das Fahrzeug kann (Econelo: 45 km/h)
    const limit = Math.min(v.T.maxSpeed * 0.95, r.speed * (0.8 + Math.random() * 0.25) * (type === 'bus' || type === 'truck' ? 0.85 : type === 'sports' ? 1.1 : 1));
    v.ai = { kind: 'traffic', limit, panic: 0, moving: true, blocked: 0, ghost: 0, pass: 0, loose: 0, group: grp, police };
    v.rail = newRail(r, fwd, s, lanes, limit * 0.5);
    if (type === 'bus') g.buses?.onSpawn(v);           // Linienbus mit Fahrgästen
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
    v.ai = null; v.rail = null;
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
    this._lots(dt, px, pz);
    // KI + Entfernen
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const v = this.cars[i];
      if (!v.alive || !v.ai) { this.cars.splice(i, 1); continue; }
      const d = Math.hypot(v.x - px, v.z - pz);
      // weit weg, ausgebrannt oder nach einem Unfall lange abseits der Straße liegen geblieben
      if (d > 340 || (v.exploded && v.wreckT > 45) || (v.ai.loose > 30 && d > 90) || v.ai.gone) { this._remove(v); this.cars.splice(i, 1); continue; }
      if (v.exploded || v.burning > 0) { v.ai.moving = false; continue; }
      if (!v.driver || !v.driver.alive) { v.ai.moving = false; v.rail = null; v.ctl.throttle = 0; v.ctl.brake = 1; continue; }
      this._drive(v, dt);
    }
    for (let i = this.parked.length - 1; i >= 0; i--) {
      const v = this.parked[i];
      if (!v.alive || v.owner !== 'parked' || v.driver) { this.parked.splice(i, 1); continue; }
      const d = Math.hypot(v.x - px, v.z - pz);
      if (d > 260 || (v.exploded && v.wreckT > 45)) { g.vehicles.remove(v); this.parked.splice(i, 1); }
    }
  }

  // Parkplätze: in der Nähe des Spielers parken Autos in gut der Hälfte der Buchten; weit weg wird geräumt
  _lots(dt, px, pz) {
    this.lotT -= dt;
    if (this.lotT > 0) return;
    this.lotT = 1;
    const g = this.game;
    for (const lot of g.ctx.parkingLots || []) {
      const d = Math.hypot(lot.x - px, lot.z - pz);
      if (!lot.filled && d < 220 && d > 50) {
        lot.filled = true;
        for (const b of lot.bays) {
          if (Math.random() > 0.55) continue;
          if (g.vehicles.list.some((v) => Math.abs(v.x - b.x) < 3 && Math.abs(v.z - b.z) < 3)) continue;
          const v = g.vehicles.spawn(pickW(Math.random, LOT_TYPES), b.x, b.z, b.h + (Math.random() - 0.5) * 0.05, { owner: 'parked', paint: Math.floor(Math.random() * 12) });
          v.lotId = lot.id;
          this.lotCars.push(v);
        }
      } else if (lot.filled && d > 340) {
        lot.filled = false;
        for (let i = this.lotCars.length - 1; i >= 0; i--) {
          const v = this.lotCars[i];
          if (v.lotId !== lot.id) continue;
          this.lotCars.splice(i, 1);
          if (v.owner === 'parked' && !v.driver && v.alive) g.vehicles.remove(v);
        }
      }
    }
  }

  _remove(v) {
    if (v.driver && v.driver.noHuman) { this.game.removeCharacter(v.driver); }
    for (const p of [...v.passengers]) if (!p.isPlayer) this.game.removeCharacter(p);   // Fahrgäste (Bus) verschwinden mit
    this.game.vehicles.remove(v);
  }

  _drive(v, dt) {
    const net = this.game.ctx.net, a = v.ai, ctl = v.ctl, r = v.rail;
    if (!r) { this._offRoad(v, dt); return; }
    a.loose = 0;
    a.redWait = false;
    plan(net, r, (rail) => this._chooseNext(rail));
    // Zielgeschwindigkeit
    const long = v.type === 'bus' || v.type === 'truck';
    let limit = Math.min(a.limit * (a.panic > 0 ? 1.5 : 1), curveLimit(net, r, v.T.brake) * (long ? 0.8 : 1));
    // Hindernisse entlang der Spur (beim Vorbeifahren zählt das umfahrene Fahrzeug nicht)
    a.ghost = Math.max(0, a.ghost - dt); a.pass = Math.max(0, a.pass - dt);
    // Ampel: bei Rot und Rot-Gelb an der Haltelinie warten, bei Gelb nur, wenn das Anhalten bequem reicht.
    // Polizei mit Blaulicht und flüchtende Fahrer fahren durch.
    const lights = this.game.lights;
    if (!r.curve && lights && !(a.panic > 0)) {
      const ls = lights.stateFor(r.road, r.fwd ? 'b' : 'a');
      if (ls && ls.state !== 'g') {
        const dist = r.road.len - ls.arm.stopFromNode - r.s - v.hl;
        const v0 = Math.max(0, r.speed);
        if (dist > -0.8 && (ls.state !== 'y' || (v0 * v0) / 7 < dist)) { limit = Math.min(limit, dist < 0.4 ? 0 : Math.sqrt(5.2 * dist)); a.redWait = true; }
      }
    }
    if (v.busSeats && this.game.buses) limit = this.game.buses.drive(v, r, limit, dt);   // Linienbus: an Haltestellen halten
    const block = this.blocker(v, 7 + Math.max(0, r.speed) * 1.4, a.ghost > 0, a.pass > 0 ? a.passing : null);
    if (block) limit = block.gap < 2 ? 0 : Math.min(limit, (block.gap - 1.5) * 1.1);
    // in der Schlange vor einer roten Ampel: geduldig warten (nicht durchmogeln, nicht verschwinden)
    if (block && block.vehicle && block.vehicle.ai?.redWait) { a.redWait = true; a.blocked = 0; a.waited = 0; }
    // Blockade lösen: unter geführten Fahrzeugen klärt die Nummer die Vorfahrt, an stehenden Hindernissen wird vorbeigefahren
    a.blocked = block && Math.abs(r.speed) < 0.6 && !a.redWait ? a.blocked + dt : Math.max(0, a.blocked - dt * 2);
    if (block && a.blocked > 4) {
      const o = block.vehicle;
      if (o && o.rail) { if (v.id < o.id || a.blocked > 10) { a.ghost = 3; a.blocked = 0; } }
      else if (o && a.blocked > 5) { a.pass = 9; a.passing = o; a.ghost = 0; a.blocked = 0; v.horn = 0.3; }
      else if (!o) {
        // Hupen: Passanten gehen aus dem Weg; um alle anderen wird nach längerem Warten herumgefahren
        const c = block.person;
        v.horn = 0.3;
        if (c.kind === 'ped' && c.ai) { this.game.peds.scare(c, v, 3); a.blocked = 2; }
        else if (a.blocked > 9) { a.pass = 9; a.passing = null; a.blocked = 0; }
      }
    }
    // Hoffnungslos festgefahren und weit weg vom Spieler: Das Fahrzeug verschwindet, damit kein Dauerstau bleibt
    a.waited = a.redWait ? 0 : block && Math.abs(r.speed) < 0.6 ? (a.waited || 0) + dt : Math.abs(r.speed) > 2 ? 0 : a.waited || 0;
    if (a.waited > 30 && Math.hypot(v.x - this.game.player.x, v.z - this.game.player.z) > 70) a.gone = true;
    a.panic = Math.max(0, a.panic - dt);
    r.offTarget = a.panic > 0 ? r.lane * 0.4 : r.lane;
    r.want = Math.max(0, limit);
    if (a.pass > 7) r.want = -2.2;                                   // erst ein Stück zurücksetzen …
    else if (a.pass > 0) { r.offTarget = r.lane > 0 ? -r.lane : -2.5; r.want = Math.min(r.want, 5); }   // … dann ausscheren
    // Pedale nur für Bremslichter und Geräusch
    ctl.throttle = r.want > r.speed + 0.3 ? 0.6 : 0;
    ctl.brake = r.speed > r.want + 1 || Math.abs(r.want) < 0.1 ? 0.7 : 0;
    ctl.steer = 0; ctl.handbrake = false;
    v.sirenOn = a.police && a.panic > 0;
  }

  // Nach einem Stoß: ausrollen lassen, dann zurück auf die Straße – wer weit abseits gelandet ist, bleibt dort stehen
  _offRoad(v, dt) {
    const a = v.ai, ctl = v.ctl;
    ctl.throttle = 0; ctl.steer = 0; ctl.brake = 0.7; ctl.handbrake = false;
    a.loose += dt;
    if (a.loose > 2.5 && Math.abs(v.speed) < 1 && v.grounded && attachRail(this.game.ctx.net, v, 14, (r) => this.trafficable(r))) a.panic = 4;
  }

  // Erstes Hindernis auf den nächsten Metern der Spur: { gap, vehicle } bzw. { gap, vehicle: null, person } oder null
  blocker(v, reach, ignoreGuided = false, skip = null) {
    const g = this.game, net = g.ctx.net, D = reach + v.hl;
    const near = (o) => Math.abs(o.x - v.x) < D + 10 && Math.abs(o.z - v.z) < D + 10 && Math.abs(o.y - v.y) < 3;
    const cars = g.vehicles.list.filter((o) => o !== v && o !== skip && o.alive && !(ignoreGuided && o.rail) && near(o));
    const people = g.allCharacters().filter((c) => c.alive && c.state !== 'vehicle' && near(c));
    if (!cars.length && !people.length) return null;
    for (let d = v.hl + 0.6; d <= D; d += 1.6) {
      const p = poseAhead(net, v.rail, d);
      for (const o of cars) {
        const dx = p.x - o.x, dz = p.z - o.z, s = Math.sin(o.h), c = Math.cos(o.h);
        if (Math.abs(dx * c - dz * s) < o.hw + v.hw * 0.75 && Math.abs(dx * s + dz * c) < o.hl + 0.6) return { gap: d - v.hl, vehicle: o };
      }
      for (const c of people) if (Math.hypot(p.x - c.x, p.z - c.z) < v.hw + 0.7) return { gap: d - v.hl, vehicle: null, person: c };
    }
    return null;
  }

  _chooseNext(rail) {
    const road = rail.road;
    const node = rail.fwd ? road.b : road.a;
    const last = road.pts[rail.fwd ? road.pts.length - 1 : 0], prev = road.pts[rail.fwd ? road.pts.length - 2 : 1];
    const dx = last[0] - prev[0], dz = last[1] - prev[1], l = Math.hypot(dx, dz) || 1;
    const e = this.router.pickNext(node, road, { x: dx / l, z: dz / l });
    return e ? { road: e.road, fwd: e.fwd } : null;
  }

  // Auf Gefahr reagieren (Beschuss, Rammen): Fahrer flieht / hupt
  panic(v, secs = 8) { if (v.ai) v.ai.panic = Math.max(v.ai.panic, secs); }
}
