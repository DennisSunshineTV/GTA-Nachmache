// Gegner (Gangs, Wachen, Verfolger) für Missionen und Zufallsereignisse.
import { Character } from '../entities/character.js';
import { clamp, wrapPi } from '../util.js';

const LINES = ['¡Ahí está!', 'Da ist er!', 'Macht ihn fertig!', 'Hier entlang!', 'Du bist tot!', '¡Mátalos!', 'Wer hat euch geschickt?!'];

export class EnemyManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.vehicles = [];
  }

  // n Gangster rund um (x,z). opts: { weapon, hp, radius, alert, group, outfit }
  spawnGang(x, z, n, opts = {}) {
    const g = this.game, out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * (opts.radius ?? 9);
      let px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (g.physics.groundHeight(px, pz) < 0.1) { px = x; pz = z; }
      const c = new Character(g, 'enemy', px, pz, { outfit: opts.outfit || 'gangster', hp: opts.hp ?? 110 });
      c.hostile = true; c.hostileGroup = opts.group || 'gang';
      const wid = opts.weapon || ['pistol', 'smg', 'pistol', 'rifle'][Math.floor(Math.random() * 4)];
      c.giveWeapon(wid, 300); c.setWeapon(wid);
      c.accuracy = opts.accuracy ?? 2.0;
      c.ai = { kind: 'gang', home: { x: px, z: pz }, alert: !!opts.alert, shootT: Math.random(), strafe: 0, strafeT: 0, lost: 0, roamT: 0, sight: opts.sight ?? 42, boss: !!opts.boss };
      c.say && 0;
      g.addCharacter(c);
      this.list.push(c);
      out.push(c);
    }
    return out;
  }

  // Verfolgerfahrzeug mit Schützen
  spawnChaser(type, x, z, heading, opts = {}) {
    const g = this.game;
    const v = g.vehicles.spawn(type, x, z, heading, { owner: 'enemy', paint: opts.paint ?? 3 });
    v.engineOn = true;
    const drv = new Character(g, 'enemy', x, z, { outfit: 'gangster', hp: 90, noHuman: true });
    drv.noHuman = true; drv.state = 'vehicle'; drv.vehicle = v; drv.seat = 0; drv.isDriver = true; drv.hostile = true; drv.hostileGroup = opts.group || 'chaser'; drv.accuracy = 2.4;
    drv.giveWeapon('smg', 400); drv.setWeapon('smg');
    v.driver = drv; g.addCharacter(drv); this.list.push(drv);
    if (v.cls === 'car' && opts.shooter !== false && v.type !== 'moto') {
      const pas = new Character(g, 'enemy', x, z, { outfit: 'gangster', hp: 90 });
      pas.state = 'vehicle'; pas.vehicle = v; pas.seat = 1; pas.hostile = true; pas.hostileGroup = opts.group || 'chaser'; pas.accuracy = 2.2;
      pas.giveWeapon('smg', 400); pas.setWeapon('smg');
      v.passengers.push(pas); g.addCharacter(pas); this.list.push(pas);
    }
    v.ai = { kind: 'enemy', route: null, routeT: 0, stuck: 0, rev: 0, moving: true, shootT: 0.5, group: opts.group || 'chaser' };
    this.vehicles.push(v);
    return v;
  }

  update(dt) {
    const g = this.game, p = g.player;
    const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
    const py = p.vehicle ? p.vehicle.y + 1 : p.y + 1.3;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      if (c.dropped) { this.list.splice(i, 1); continue; }
      if (!c.alive) { if (c.deadT > 60) { c.dropped = true; g.removeCharacter(c); this.list.splice(i, 1); } continue; }
      const a = c.ai;
      if (!a || a.kind !== 'gang' || c.state === 'vehicle') continue;
      const I = c.intent;
      const dx = px - c.x, dz = pz - c.z, d = Math.hypot(dx, dz) || 1;
      a.shootT -= dt; a.strafeT -= dt;
      const los = d < 90 && g.physics.lineOfSight(c.x, c.y + 1.5, c.z, px, py, pz);
      if (los && d < a.sight) a.alert = true;
      if (a.alert) { if (los) a.lost = 0; else a.lost += dt; if (a.lost > 25 && d > 80) a.alert = false; }
      I.aim = false; I.sprint = false;
      if (!p.alive) { I.mx = I.mz = 0; I.speed = 0; continue; }
      if (a.alert) {
        if (los && d < 60) {
          I.aim = true; I.ax = dx / d; I.az = dz / d; I.ay = ((py - 0.1) - (c.y + 1.4)) / d;
          const W = c.weapon;
          const ideal = W && W.id === 'shotgun' ? 8 : W && W.id === 'rifle' ? 28 : 16;
          if (d > ideal + 4) { I.mx = dx / d; I.mz = dz / d; I.speed = 0.9; I.sprint = d > ideal + 18; }
          else if (d < ideal - 5) { I.mx = -dx / d; I.mz = -dz / d; I.speed = 0.6; }
          else { if (a.strafeT <= 0) { a.strafeT = 1 + Math.random() * 1.5; a.strafe = Math.random() < 0.5 ? -1 : 1; } I.mx = -dz / d * a.strafe * 0.7; I.mz = dx / d * a.strafe * 0.7; I.speed = 0.55; }
          if (a.shootT <= 0 && !p.invuln) { a.shootT = (W && W.auto ? 0.1 : 0.5) + Math.random() * 0.5; g.combat.tryFire(c); if (Math.random() < 0.02) c.say(LINES[Math.floor(Math.random() * LINES.length)], 2.5); }
        } else { I.mx = dx / d; I.mz = dz / d; I.speed = 1; I.sprint = d > 25; c.face = Math.atan2(dx, dz); }
      } else {
        // Wache: gelegentlich umherlaufen
        a.roamT -= dt;
        const hx = a.home.x - c.x, hz = a.home.z - c.z, hd = Math.hypot(hx, hz);
        if (a.roamT <= 0) { a.roamT = 3 + Math.random() * 5; a.tx = a.home.x + (Math.random() - 0.5) * 8; a.tz = a.home.z + (Math.random() - 0.5) * 8; }
        if (a.tx !== undefined) { const ex = a.tx - c.x, ez = a.tz - c.z, ed = Math.hypot(ex, ez); if (ed > 1) { I.mx = ex / ed; I.mz = ez / ed; I.speed = 0.35; } else { I.mx = I.mz = 0; I.speed = 0; } }
        void hd;
      }
    }
    // Verfolgerfahrzeuge
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (!v.alive) { this.vehicles.splice(i, 1); continue; }
      if (v.exploded || v.burning > 0 || !v.driver || !v.driver.alive) { v.rail = null; v.ctl.throttle = 0; v.ctl.brake = 1; continue; }
      const d = Math.hypot(px - v.x, pz - v.z);
      if (d > 600) { this._removeVehicle(v); this.vehicles.splice(i, 1); continue; }
      const a = v.ai;
      if (v.cls === 'boat') this._steerBoat(v, px, pz, d, dt);
      else g.police.pursue(v, px, pz, d, dt, d < 55 && g.physics.lineOfSight(v.x, v.y + 1.2, v.z, px, py, pz));
      // Schützen
      a.shootT -= dt;
      if (a.shootT <= 0 && d < 40) {
        a.shootT = 0.18 + Math.random() * 0.25;
        const shooter = v.passengers[0]?.alive ? v.passengers[0] : v.driver;
        if (shooter && shooter.alive && g.physics.lineOfSight(v.x, v.y + 1.4, v.z, px, py, pz)) {
          const I = shooter.intent;
          const ddx = px - v.x, ddz = pz - v.z, dd = Math.hypot(ddx, ddz) || 1;
          I.ax = ddx / dd; I.az = ddz / dd; I.ay = (py - (v.y + 1.4)) / dd; I.aim = true;
          shooter.x = v.x; shooter.z = v.z; shooter.y = v.y;
          shooter.muzzlePos = (out = {}) => { out.x = v.x + I.ax * 1.5; out.y = v.y + 1.3; out.z = v.z + I.az * 1.5; return out; };
          g.combat.tryFire(shooter);
        }
      }
    }
  }

  _steerBoat(v, tx, tz, d, dt) {
    const ctl = v.ctl;
    const err = wrapPi(Math.atan2(tx - v.x, tz - v.z) - v.h);
    ctl.steer = clamp(err * 2, -1, 1);
    const want = d > 25 ? v.T.maxSpeed * 0.8 : 8;
    ctl.throttle = v.speed < want ? 1 : 0; ctl.brake = v.speed > want + 6 ? 0.5 : 0;
  }

  _removeVehicle(v) {
    const g = this.game;
    if (v.driver) g.removeCharacter(v.driver);
    for (const c of v.passengers) g.removeCharacter(c);
    g.vehicles.remove(v);
  }

  // Alle Gegner einer Gruppe
  group(name) { return this.list.filter((c) => c.hostileGroup === name); }
  aliveCount(name) { return this.list.filter((c) => c.alive && c.hostileGroup === name).length; }

  clearGroup(name) {
    for (const c of this.list.filter((q) => q.hostileGroup === name)) { c.dropped = true; this.game.removeCharacter(c); }
    this.list = this.list.filter((c) => c.hostileGroup !== name);
    for (const v of this.vehicles.filter((q) => q.ai?.group === name)) this._removeVehicle(v);
    this.vehicles = this.vehicles.filter((v) => v.ai?.group !== name);
  }
}
