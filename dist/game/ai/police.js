// Polizei: Fahndungsstufe (1–6 Sterne), Streifenwagen, Beamte, SWAT, Hubschrauber, Straßensperren, Festnahme.
import { Character } from '../entities/character.js';
import { Router, laneTarget } from './router.js';
import { plan, curveLimit, attachRail, turnAround } from './rail.js';
import { clamp, wrapPi } from '../util.js';

// Fahndungswert pro Vergehen. Ein Mord vor Zeugen ergibt 1 Stern, ein Amoklauf mehrere.
const CRIME = { shoot: 0.15, assault: 0.25, murder: 0.55, copHit: 1.0, copKill: 2.2, explosion: 1.6, carjack: 0.7, hitrun: 0.4, copCar: 1.1, robbery: 1.5, vandal: 0.15 };
// Mindestabstand in Sekunden, bevor dasselbe Vergehen erneut zählt (sonst würde jede Kugel einen Stern geben)
// Höchste Stufe: Der 6. Stern kommt nur dazu, wenn man bei vollen 5 Sternen weiter gegen die Polizei eskaliert
// (Beamte töten, Explosionen, Streifenwagen zerstören). Alle anderen Vergehen halten bei 5 Sternen an.
const MAX_STARS = 6;
const SIX_KINDS = new Set(['copKill', 'explosion', 'copCar']);
// Gestaffelter Einsatz je Stufe
const swatChance = (w) => (w >= 6 ? 1 : w >= 5 ? 0.7 : w >= 4 ? 0.5 : 0);
// Fahndungsbereich (Radius in Metern je Stern) und Zeit, die man unentdeckt außerhalb bleiben muss, bis ein Stern verschwindet
// Bei 1–3 Sternen ist die Polizei bewusst nachsichtig: kleiner Bereich, kurze Abkühlzeit, wenige und langsamere Verfolger
const areaRadius = (w) => [0, 120, 160, 210, 300, 370, 440][Math.min(6, Math.max(0, w))];
const evadeTime = (w) => (w <= 3 ? 6 + w * 4 : 10 + w * 4);
const soft = (w) => w <= 3;
const CRIME_CD = { shoot: 8, assault: 3, murder: 1.5, copHit: 4, explosion: 3, hitrun: 3, vandal: 4, carjack: 2 };
const YELL = ['¡Alto! ¡Policía!', 'Stehen bleiben!', 'Waffe runter!', 'Hände hoch!', '¡Quieto!', 'Sie sind festgenommen!'];

export class PoliceManager {
  constructor(game) {
    this.game = game;
    this.router = new Router(game.ctx.net);
    this.heat = 0;
    this.wanted = 0;
    this.units = [];      // Streifenwagen
    this.foot = [];       // Beamte zu Fuß
    this.heli = null;
    this.heli2 = null;     // zweiter Hubschrauber ab 6 Sternen
    this.area = null;      // Fahndungsbereich { x, z, r }: zuletzt bekannte Position des Spielers
    this.evading = false;  // außerhalb des Bereichs und unentdeckt (Sterne blinken, Abkühlzeit läuft)
    this.blocks = [];
    this.evade = 0;
    this.spawnT = 0;
    this.seen = false;
    this.arrestT = 0;
    this.blockT = 20;
    this.disabled = false;
    this._last = {};       // Zeitpunkt des letzten gezählten Vergehens je Art
    this.standT = 0;       // Sekunden seit Ende der Fahndung
  }

  clear(silent = false) {
    this.heat = 0; this.wanted = 0; this.evade = 0; this.arrestT = 0;
    if (!silent) this.game.ui?.notify('Fahndung beendet', 'info');
    this.game.onWantedChanged?.(0, false);
  }

  setWanted(n) { n = Math.min(MAX_STARS, n); this.heat = n <= 0 ? 0 : n - 0.05; this._sync(); }

  // Verbrechen melden. source: Verursacher, (x,z): Tatort. always: auch ohne Zeugen
  crime(kind, source, x, z, always = false) {
    if (this.disabled || source !== this.game.player) return;
    const g = this.game;
    let seen = always || this.seen;
    if (!seen) {
      for (const c of g.allCharacters()) {
        if (!c.alive || c === source || (c.state === 'vehicle' && !c.isDriver)) continue;
        const lim = c.kind === 'cop' ? 90 : 38;
        if (Math.hypot(c.x - x, c.z - z) < lim) { seen = true; break; }
      }
    }
    if (!seen) return;
    this.evade = 0;
    const cd = CRIME_CD[kind] || 0, now = g.time;
    if (cd && this._last[kind] !== undefined && now - this._last[kind] < cd) return;
    this._last[kind] = now;
    const cap = SIX_KINDS.has(kind) ? MAX_STARS : 5;
    if (this.heat < cap) this.heat = Math.min(cap, this.heat + (CRIME[kind] ?? 0.3));
    this._sync();
  }

  _sync() {
    const w = this.heat <= 0 ? 0 : clamp(Math.ceil(this.heat - 0.001), 0, MAX_STARS);
    if (w !== this.wanted) {
      const up = w > this.wanted;
      this.wanted = w;
      this.game.onWantedChanged?.(w, up);
      if (up && w > 0) this.game.audio?.wantedUp();
    }
  }

  update(dt) {
    const g = this.game, p = g.player;
    if (!p.alive) return;
    // Sichtkontakt
    this.seen = false;
    if (this.wanted > 0) {
      const py = p.vehicle ? p.vehicle.y + 1 : p.y + 1.3;
      const check = (x, y, z) => g.physics.lineOfSight(x, y, z, p.x, py, p.z);
      for (const c of this.foot) if (c.alive && Math.hypot(c.x - p.x, c.z - p.z) < (soft(this.wanted) ? 38 + this.wanted * 6 : 80) && check(c.x, c.y + 1.5, c.z)) { this.seen = true; break; }
      if (!this.seen) for (const v of this.units) if (v.alive && !v.exploded && Math.hypot(v.x - p.x, v.z - p.z) < (soft(this.wanted) ? 36 + this.wanted * 6 : 75) && check(v.x, v.y + 1.4, v.z)) { this.seen = true; break; }
      for (const h of [this.heli, this.heli2]) if (!this.seen && h && h.alive && Math.hypot(h.x - p.x, h.z - p.z) < 160) this.seen = true;
      // Fahndungsbereich: folgt dem Spieler, solange die Polizei ihn sieht; sonst bleibt er an der letzten bekannten Stelle
      const ax = p.vehicle ? p.vehicle.x : p.x, az = p.vehicle ? p.vehicle.z : p.z;
      if (!this.area) this.area = { x: ax, z: az, r: areaRadius(this.wanted) };
      if (this.seen) { this.area.x = ax; this.area.z = az; }
      this.area.r += (areaRadius(this.wanted) - this.area.r) * Math.min(1, dt * 2);
      const inside = Math.hypot(ax - this.area.x, az - this.area.z) <= this.area.r;
      this.evading = !this.seen && !inside;
      if (this.evading) this.evade += dt; else this.evade = 0;
      if (this.evade > evadeTime(this.wanted)) {
        this.evade = 0;
        this.heat = Math.max(0, this.wanted - 1 - 0.01);
        this._sync();
        if (this.wanted === 0) g.ui?.notify('Du hast die Polizei abgehängt', 'good');
      }
    } else { this.area = null; this.evading = false; }
    // Verstärkung
    this.spawnT -= dt;
    if (this.wanted > 0 && this.spawnT <= 0) {
      this.spawnT = this.wanted >= 6 ? 0.7 : soft(this.wanted) ? 5.2 - this.wanted * 0.9 : 1.1;
      const unitCap = soft(this.wanted) ? Math.min(this.wanted, 2) : this.wanted + (this.wanted >= 6 ? 2 : 0);
      if (this.units.filter((v) => v.alive && !v.exploded).length < unitCap) this._spawnUnit();
      if (this.wanted >= 4 && (!this.heli || !this.heli.alive)) this._spawnHeli('heli');
      if (this.wanted >= 6 && (!this.heli2 || !this.heli2.alive)) this._spawnHeli('heli2');
      if (this.wanted >= 2) this._spawnFootCops();
    }
    this.blockT -= dt;
    if (this.wanted >= 4 && this.blockT <= 0 && p.vehicle && p.vehicle.speed > 14) { this.blockT = this.wanted >= 6 ? 22 : 45; this._roadblock(); }
    this._updateUnits(dt);
    this._updateFoot(dt);
    this._updateHeli(dt);
    this._updateBlocks(dt);
    // Festnahme
    if (this.wanted > 0 && !p.vehicle && p.speedH < 1.6) {
      let near = false;
      for (const c of this.foot) if (c.alive && Math.hypot(c.x - p.x, c.z - p.z) < 2.3) { near = true; break; }
      if (near && !p.aiming) { this.arrestT += dt; if (this.arrestT > 2.6) { this.arrestT = 0; g.busted(); } } else this.arrestT = Math.max(0, this.arrestT - dt * 2);
    } else this.arrestT = Math.max(0, this.arrestT - dt * 2);
    if (this.wanted > 0) this.standT = 0;
    else if (this.units.length || this.foot.length || this.heli || this.heli2) this._standDown(dt);
  }

  // Position, die die Polizei ansteuert
  knownPos() {
    const p = this.game.player, v = p.vehicle;
    const x = v ? v.x : p.x, z = v ? v.z : p.z;
    if (!this.area || !this.evading) return { x, z };
    return { x: this.area.x, z: this.area.z };
  }

  // ---------- Spawnen ----------
  _spawnPoint(rMin, rMax) {
    const g = this.game, net = g.ctx.net, p = g.player;
    const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * Math.PI * 2, d = rMin + Math.random() * (rMax - rMin);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const nr = net.nearest(x, z, 80, (r) => !r.noTraffic && r.kind !== 'track' && r.kind !== 'quay');
      if (!nr) continue;
      if (Math.hypot(nr.x - px, nr.z - pz) < rMin * 0.8) continue;
      const cam = g.camera;
      const dx = nr.x - cam.position.x, dz = nr.z - cam.position.z;
      const fx = -Math.sin(cam.rotation.y), fz = -Math.cos(cam.rotation.y);
      const cos = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1);
      if (cos > 0.55 && Math.hypot(dx, dz) < 200) continue;
      return nr;
    }
    return null;
  }

  _spawnUnit() {
    const g = this.game;
    const nr = soft(this.wanted) ? this._spawnPoint(220, 340) : this._spawnPoint(150, 260);
    if (!nr) return;
    const r = nr.road;
    const fwd = Math.random() < 0.5;
    const s = r.cum[nr.i] + (r.cum[nr.i + 1] - r.cum[nr.i]) * nr.t;
    const t = laneTarget(g.ctx.net, r, fwd, fwd ? s : r.len - s, r.w * 0.2, {});
    for (const v of g.vehicles.list) if (Math.hypot(v.x - t.px, v.z - t.pz) < 12) return;
    const v = g.vehicles.spawn('police', t.px, t.pz, Math.atan2(t.tx, t.tz), { owner: 'police' });
    v.sirenOn = true; v.engineOn = true; v.hp = v.maxHp = v.T.hp * (1 + this.wanted * 0.12);
    const swat = Math.random() < swatChance(this.wanted);
    const cop = new Character(g, 'cop', v.x, v.z, { outfit: swat ? 'swat' : 'cop', hp: this.wanted >= 6 ? 160 : 120, noHuman: true });
    cop.noHuman = false; cop.state = 'vehicle'; cop.vehicle = v; cop.seat = 0; cop.isDriver = true; cop.hostile = true; cop.accuracy = this.wanted >= 6 ? 1.6 : 2.2;
    cop.giveWeapon('pistol', 200); cop.setWeapon('pistol');
    v.driver = cop;
    g.addCharacter(cop);
    const pass = new Character(g, 'cop', v.x, v.z, { outfit: cop.outfitKind, hp: 120 });
    pass.state = 'vehicle'; pass.vehicle = v; pass.seat = 1; pass.hostile = true; pass.accuracy = this.wanted >= 6 ? 1.6 : 2.2;
    const wid = this.wanted >= 6 ? 'rifle' : this.wanted >= 3 ? 'smg' : 'pistol';
    pass.giveWeapon(wid, 200); pass.setWeapon(wid);
    v.passengers.push(pass);
    g.addCharacter(pass);
    v.ai = { kind: 'police', mode: 'chase', route: null, routeT: 0, stuck: 0, rev: 0, born: g.time };
    this.units.push(v);
  }

  _spawnFootCops() {
    const g = this.game, p = g.player;
    if (this.foot.length >= (soft(this.wanted) ? this.wanted - 1 : 2 + this.wanted * 2) || p.vehicle) return;
    const nr = this._spawnPoint(70, 140);
    if (!nr) return;
    const swat = Math.random() < swatChance(this.wanted);
    const c = new Character(g, 'cop', nr.x, nr.z, { outfit: swat ? 'swat' : 'cop', hp: swat ? (this.wanted >= 6 ? 280 : 220) : 120 });
    c.hostile = true; c.accuracy = swat ? (this.wanted >= 6 ? 1.0 : 1.3) : 2.2;
    c.giveWeapon(swat ? 'rifle' : 'pistol', 300); c.setWeapon(swat ? 'rifle' : 'pistol');
    c.ai = { kind: 'cop', strafe: 0, strafeT: 0, shootT: 0, lost: 0, swat };
    g.addCharacter(c);
    this.foot.push(c);
  }

  _spawnHeli(slot = 'heli') {
    const g = this.game, p = g.player;
    // Der zweite Hubschrauber kommt aus der Gegenrichtung des ersten
    const first = this.heli && this.heli.ai ? this.heli.ai.angle + Math.PI : null;
    const a = slot === 'heli2' && first !== null ? first : Math.random() * 6.28;
    const x = p.x + Math.cos(a) * 320, z = p.z + Math.sin(a) * 320;
    const v = g.vehicles.spawn('heli', x, z, a + Math.PI, { owner: 'police', paint: 0 });
    v.y = Math.max(g.physics.groundHeight(x, z), 0) + 70;
    v.engineOn = true; v.heliRotor = 1;
    v.ai = { kind: 'heli', angle: a, shootT: 1, moving: true };
    const pilot = new Character(g, 'cop', x, z, { noHuman: true }); pilot.noHuman = true; pilot.state = 'vehicle'; pilot.vehicle = v; pilot.isDriver = true; pilot.hostile = true;
    v.driver = pilot; g.addCharacter(pilot);
    this[slot] = v;
  }

  _roadblock() {
    const g = this.game, p = g.player, net = g.ctx.net, v = p.vehicle;
    const sp = Math.hypot(v.vx, v.vz) || 1;
    const dx = v.vx / sp, dz = v.vz / sp;
    const nr = net.nearest(p.x + dx * 330, p.z + dz * 330, 120, (r) => !r.noTraffic && r.kind !== 'track' && r.kind !== 'quay' && r.w >= 7);
    if (!nr || Math.hypot(nr.x - p.x, nr.z - p.z) < 200) return;
    const pt = net.pointAt(nr.road, nr.road.cum[nr.i] + (nr.road.cum[nr.i + 1] - nr.road.cum[nr.i]) * nr.t, {});
    const nx = -pt.dz, nz = pt.dx;
    const cars = [];
    for (const off of (this.wanted >= 6 ? [-nr.road.w * 0.3, 0, nr.road.w * 0.3] : [-nr.road.w * 0.22, nr.road.w * 0.22])) {
      const x = pt.x + nx * off, z = pt.z + nz * off;
      const c = g.vehicles.spawn('police', x, z, Math.atan2(pt.dx, pt.dz) + Math.PI / 2 + (off > 0 ? 0.2 : off < 0 ? -0.2 : 0), { owner: 'police' });
      c.sirenOn = true; c.engineOn = false; c.ai = { kind: 'block', moving: false };
      cars.push(c);
      const cop = new Character(g, 'cop', x + pt.dx * 5, z + pt.dz * 5, { outfit: 'cop', hp: 120 });
      cop.hostile = true; cop.accuracy = 2; cop.giveWeapon('pistol', 200); cop.setWeapon('pistol');
      cop.ai = { kind: 'cop', strafe: 0, strafeT: 0, shootT: 0, lost: 0, block: true };
      g.addCharacter(cop); this.foot.push(cop);
    }
    this.blocks.push({ cars, t: 70 });
    g.ui?.notify('Straßensperre voraus!', 'warn');
  }

  _standDown(dt = 0.016) {
    const g = this.game, p = g.player;
    this.standT += dt;
    // Nach einigen Sekunden ziehen sich die Einheiten zurück (verschwinden, sobald sie ein Stück entfernt sind)
    const late = this.standT > 10;
    for (const v of this.units) { if (v.ai) { v.sirenOn = false; v.rail = null; } }
    for (let i = this.units.length - 1; i >= 0; i--) {
      const v = this.units[i];
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      v.ctl.throttle = 0; v.ctl.brake = 0.6;
      if (d > (late ? 60 : 130) || !v.alive) { this._removeUnit(v); this.units.splice(i, 1); }
    }
    for (let i = this.foot.length - 1; i >= 0; i--) {
      const c = this.foot[i];
      c.hostile = false; c.intent.aim = false; c.intent.mx = c.intent.mz = 0;
      if (Math.hypot(c.x - p.x, c.z - p.z) > (late ? 45 : 110) || !c.alive) { g.removeCharacter(c); this.foot.splice(i, 1); }
    }
    if (this.heli) { g.vehicles.remove(this.heli); this.heli = null; }
    if (this.heli2) { g.vehicles.remove(this.heli2); this.heli2 = null; }
  }

  _removeUnit(v) {
    const g = this.game;
    if (v.driver) g.removeCharacter(v.driver);
    for (const c of v.passengers) g.removeCharacter(c);
    g.vehicles.remove(v);
  }

  // ---------- Fahrzeug-KI ----------
  _updateUnits(dt) {
    const g = this.game, p = g.player, net = g.ctx.net;
    const kp = this.knownPos();
    const tx = kp.x, tz = kp.z;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const v = this.units[i];
      if (!v.alive) { this.units.splice(i, 1); continue; }
      if (v.exploded) { if (v.wreckT > 40) { this._removeUnit(v); this.units.splice(i, 1); } continue; }
      if (this.wanted === 0) continue;
      const a = v.ai, ctl = v.ctl;
      if (!a || a.kind !== 'police' || a.stopped) continue;
      if (v.burning > 0 || !v.driver || !v.driver.alive) { v.rail = null; ctl.throttle = 0; ctl.brake = 1; continue; }
      const dx = tx - v.x, dz = tz - v.z, d = Math.hypot(dx, dz);
      // Beamte aussteigen lassen
      if (d < 16 && (!p.vehicle || Math.abs(p.vehicle.speed) < 3)) {
        a.stopped = true; v.rail = null;
        ctl.throttle = 0; ctl.brake = 1;
        const occupants = [v.driver, ...v.passengers];
        for (const c of occupants) if (c) g.exitVehicle(c);
        for (const c of occupants) { if (c) { c.ai = { kind: 'cop', strafe: 0, strafeT: 0, shootT: 0, lost: 0 }; if (!this.foot.includes(c)) this.foot.push(c); } }
        v.driver = null; v.passengers = [];
        continue;
      }
      const direct = d < 55 && g.physics.lineOfSight(v.x, v.y + 1.2, v.z, tx, p.vehicle ? p.vehicle.y + 1 : p.y + 1, tz);
      this.pursue(v, tx, tz, d, dt, direct);
    }
  }

  // Verfolgung (Polizei und Verfolger aus Missionen): Auf der Anfahrt fährt der Wagen geführt auf der Straße entlang der
  // Route. In Sichtweite, am Ende der Route oder wenn er festhängt, lenkt er frei auf das Ziel zu.
  pursue(v, tx, tz, d, dt, direct) {
    const g = this.game, net = g.ctx.net, a = v.ai;
    const drivable = (r) => !r.noTraffic && r.kind !== 'track';
    a.free = Math.max(0, (a.free || 0) - dt);
    if (direct || a.free > 0) { v.rail = null; this._steer(v, tx, tz, d, dt, true); return; }
    a.routeT -= dt;
    if (a.routeT <= 0 || !a.route) {
      a.routeT = 2.2;
      const usable = (n) => n.roads.some((id) => !net.roads[id].noTraffic);
      const here = v.rail ? net.nodes[v.rail.fwd ? v.rail.road.b : v.rail.road.a] : net.nearestNode(v.x, v.z, 140, usable);
      const to = net.nearestNode(tx, tz, 220, usable);
      a.route = here && to ? this.router.route(here.id, to.id) : null;
      if (a.route && !a.route.length && d < 120) a.free = 3;   // am Ende der Route: das letzte Stück frei fahren
      // führt die Route auf derselben Straße zurück, wird gleich gewendet und nicht erst an ihrem Ende
      if (v.rail && a.route?.[0]?.road === v.rail.road && v.rail.road.len - v.rail.s > 30) turnAround(net, v);
    }
    if (!v.rail && !attachRail(net, v, 9, drivable)) {
      // neben der Straße: frei zu ihr zurück, sonst auf das Ziel zuhalten
      const nr = net.nearest(v.x, v.z, 60, drivable);
      if (nr && nr.d > 6) this._steer(v, nr.x, nr.z, d, dt, false); else this._steer(v, tx, tz, d, dt, true);
      return;
    }
    const r = v.rail;
    plan(net, r, (rail) => this._routeNext(a, rail, tx, tz));
    let want = Math.min(v.T.maxSpeed * (this.wanted >= 6 ? 0.9 : 0.82), this.wanted >= 6 ? 33 : 28);
    if (soft(this.wanted)) want *= 0.58 + this.wanted * 0.08;
    want = Math.min(want, curveLimit(net, r, v.T.brake) * 1.8);
    // An Fahrzeugen schert der Wagen auf die Gegenspur aus; hängt er trotzdem fest, lenkt er kurz frei
    a.pass = Math.max(0, (a.pass || 0) - dt);
    const block = g.traffic.blocker(v, 8 + r.speed, false, a.pass > 0 ? a.passing : null);
    if (block?.vehicle) { a.pass = 2.5; a.passing = block.vehicle; }
    r.offTarget = a.pass > 0 ? (r.lane > 0 ? -r.lane * 0.6 : -2) : r.lane;
    if (block) want = Math.min(want, Math.max(0, block.gap - 1) * 2.4);
    a.stuck = block && r.speed < 3 ? a.stuck + dt : 0;
    if (a.stuck > 1.5) { a.stuck = 0; a.free = 2.5; }
    r.want = want;
    v.ctl.throttle = want > r.speed + 0.3 ? 0.8 : 0; v.ctl.brake = r.speed > want + 1 ? 0.7 : 0; v.ctl.handbrake = false;
    v.sirenOn = a.kind === 'police';
  }

  // Nächste Straße an einer Kreuzung: der Route folgen, sonst die, die dem Ziel am nächsten kommt
  _routeNext(a, rail, tx, tz) {
    const net = this.game.ctx.net, node = rail.fwd ? rail.road.b : rail.road.a;
    const step = a.route?.find((e) => (e.fwd ? e.road.a : e.road.b) === node);
    if (step) return step;
    const all = this.router.neighbors(node), ahead = all.filter((e) => e.road !== rail.road);
    const far = (e) => Math.hypot(net.nodes[e.to].x - tx, net.nodes[e.to].z - tz);
    return (ahead.length ? ahead : all).sort((p, q) => far(p) - far(q))[0] || null;
  }

  _steer(v, tx, tz, distPlayer, dt, direct) {
    const g = this.game, ctl = v.ctl, a = v.ai;
    const desired = Math.atan2(tx - v.x, tz - v.z);
    let err = wrapPi(desired - v.h);
    const feel = (ang, len) => {
      const dh = v.h + ang;
      const r = g.physics.raycastStatic({ x: v.x, y: v.y + 0.7, z: v.z }, { x: Math.sin(dh), y: 0, z: Math.cos(dh) }, len);
      return r ? r.t : len;
    };
    const L = 10 + Math.abs(v.speed) * 0.6;
    const c0 = feel(0, L), cl = feel(0.45, L * 0.8), cr = feel(-0.45, L * 0.8);
    if (c0 < L * 0.9 || cl < L * 0.5 || cr < L * 0.5) {
      err += clamp(((cl - cr) / L) * 1.2, -1.2, 1.2) + (c0 < L * 0.5 ? (cl > cr ? 0.7 : -0.7) : 0);
    }
    ctl.steer = clamp(err * 2.0, -1, 1);
    if (a.rev > 0) { a.rev -= dt; ctl.throttle = -0.9; ctl.steer = -ctl.steer; ctl.brake = 0; return; }
    if (Math.abs(v.speed) < 1.2 && distPlayer > 8) { a.stuck += dt; if (a.stuck > 1.8) { a.stuck = 0; a.rev = 1.2; } } else a.stuck = Math.max(0, a.stuck - dt);
    let want = Math.min(v.T.maxSpeed * (this.wanted >= 6 ? 0.9 : 0.82), direct ? (this.wanted >= 6 ? 40 : 34) : (this.wanted >= 6 ? 33 : 28));
    if (soft(this.wanted)) want *= 0.58 + this.wanted * 0.08;   // 1 ★ ≈ 66 %, 2 ★ ≈ 74 %, 3 ★ ≈ 82 % des Tempos
    want = Math.min(want, 8 + 40 / (1 + Math.abs(err) * 3.2));
    if (c0 < L * 0.5) want = Math.min(want, 6);
    if (distPlayer < 14) want = Math.min(want, 14);
    const diff = want - v.speed;
    ctl.throttle = diff > 0.4 ? clamp(diff * 0.35, 0.2, 1) : 0;
    ctl.brake = diff < -2 ? clamp(-diff * 0.1, 0.1, 0.9) : 0;
    ctl.handbrake = Math.abs(err) > 1.25 && v.speed > 10;
    v.sirenOn = true;
  }

  // ---------- Beamte zu Fuß ----------
  _updateFoot(dt) {
    const g = this.game, p = g.player;
    for (let i = this.foot.length - 1; i >= 0; i--) {
      const c = this.foot[i];
      if (!c.alive) { if (c.deadT > 30) { g.removeCharacter(c); this.foot.splice(i, 1); } continue; }
      if (c.state === 'vehicle' || this.wanted === 0) continue;
      const a = c.ai, I = c.intent;
      if (!a) continue;
      const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
      const dx = px - c.x, dz = pz - c.z, d = Math.hypot(dx, dz) || 1;
      const los = d < 90 && g.physics.lineOfSight(c.x, c.y + 1.5, c.z, px, p.vehicle ? p.vehicle.y + 1 : p.y + 1.3, pz);
      a.shootT -= dt; a.strafeT -= dt;
      if (los) a.lost = 0; else a.lost += dt;
      I.aim = false; I.sprint = false;
      if (a.block && d > 70) { I.mx = I.mz = 0; I.speed = 0; continue; }
      if (los && d < 38) {
        I.aim = true; I.ax = dx / d; I.az = dz / d; I.ay = ((p.y + 1.1) - (c.y + 1.4)) / d;
        c.accuracy = (a.swat ? 1.3 : 2.1) * (p.vehicle ? 1.2 : 1) * (soft(this.wanted) ? 1.5 : 1);
        if (d > 16) { I.mx = dx / d; I.mz = dz / d; I.speed = 0.9; I.sprint = d > 30 && !soft(this.wanted); }
        else if (d < 8 && !p.vehicle) { I.mx = dx / d; I.mz = dz / d; I.speed = 0.5; }
        else {
          if (a.strafeT <= 0) { a.strafeT = 1 + Math.random() * 1.5; a.strafe = Math.random() < 0.5 ? -1 : 1; }
          I.mx = (-dz / d) * a.strafe * 0.8; I.mz = (dx / d) * a.strafe * 0.8; I.speed = 0.5;
        }
        if (a.shootT <= 0 && (!p.vehicle || d < 30)) {
          a.shootT = a.swat ? 0.12 : 0.6 + Math.random() * 0.8;
          g.combat.tryFire(c);
          if (Math.random() < 0.03) c.say(YELL[Math.floor(Math.random() * YELL.length)], 2.5);
        }
      } else {
        // ohne Sichtkontakt zur letzten bekannten Stelle (Fahndungsbereich), nicht zum echten Standort des Spielers
        const kp = this.knownPos(), kx = kp.x - c.x, kz = kp.z - c.z, kd = Math.hypot(kx, kz) || 1;
        if (kd > 6) { I.mx = kx / kd; I.mz = kz / kd; I.speed = soft(this.wanted) ? 0.8 : 1; I.sprint = kd > 20 && !soft(this.wanted); c.face = Math.atan2(kx, kz); }
        else { I.mx = I.mz = 0; I.speed = 0; }
        if (a.lost > 20 && d > 130) { g.removeCharacter(c); this.foot.splice(i, 1); }
      }
    }
  }

  // ---------- Hubschrauber ----------
  _updateHeli(dt) {
    this._flyHeli('heli', dt);
    this._flyHeli('heli2', dt);
  }

  _flyHeli(slot, dt) {
    const h = this[slot], g = this.game, p = g.player;
    if (!h) return;
    if (!h.alive || h.exploded) { if (h.exploded && h.wreckT > 25) { g.vehicles.remove(h); this[slot] = null; } return; }
    const kp = this.knownPos();
    const px = kp.x, pz = kp.z;
    const a = h.ai;
    a.angle += dt * 0.35;
    const wx = px + Math.cos(a.angle) * 45, wz = pz + Math.sin(a.angle) * 45;
    const dx = wx - h.x, dz = wz - h.z, d = Math.hypot(dx, dz);
    const sp = Math.min(38, d * 0.8);
    h.vx += ((dx / (d || 1)) * sp - h.vx) * Math.min(1, dt * 1.2); h.vz += ((dz / (d || 1)) * sp - h.vz) * Math.min(1, dt * 1.2);
    const wantY = Math.max(0, g.physics.groundHeight(h.x, h.z), g.physics.groundHeight(px, pz)) + 55;
    h.vy += ((wantY - h.y) * 0.5 - h.vy) * Math.min(1, dt);
    h.h += wrapPi(Math.atan2(px - h.x, pz - h.z) - h.h) * Math.min(1, dt * 1.5);
    h.x += h.vx * dt; h.z += h.vz * dt; h.y += h.vy * dt;
    h.pitch = 0.12; h.roll = 0; h.speed = Math.hypot(h.vx, h.vz);
    h.heliRotor = 1;
    if (h.refs.rotor) h.refs.rotor.rotation.y += dt * 30;
    if (h.refs.tailRotor) h.refs.tailRotor.rotation.x += dt * 40;
    a.shootT -= dt;
    if (a.shootT <= 0 && this.seen && Math.hypot(px - h.x, pz - h.z) < 110) {
      a.shootT = (this.wanted >= 6 ? 0.35 : 0.5) + Math.random() * 0.4;
      const o = { x: h.x, y: h.y, z: h.z };
      const ty = p.vehicle ? p.vehicle.y + 1 : p.y + 1.2;
      const ddx = px - o.x + (Math.random() - 0.5) * 14, ddy = ty - o.y + (Math.random() - 0.5) * 6, ddz = pz - o.z + (Math.random() - 0.5) * 14;
      const l = Math.hypot(ddx, ddy, ddz);
      if (g.physics.lineOfSight(o.x, o.y, o.z, px, ty, pz)) {
        g.combat.hitscan(h.driver, o, { x: ddx / l, y: ddy / l, z: ddz / l }, { range: 250, dmg: this.wanted >= 6 ? 9 : 7, auto: true, id: 'heli' });
      }
    }
    h.syncVisual(dt);
  }

  _updateBlocks(dt) {
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      b.t -= dt;
      if (b.t <= 0 || this.wanted === 0) { this.blocks.splice(i, 1); }
    }
  }

  onCopHurt(cop, source) { if (source === this.game.player) this.crime('copHit', source, cop.x, cop.z, true); }
  onCopKilled(cop, source) { if (source === this.game.player) { this.crime('copKill', source, cop.x, cop.z, true); this.heat = Math.max(this.heat, 2.01); this._sync(); } }
}
