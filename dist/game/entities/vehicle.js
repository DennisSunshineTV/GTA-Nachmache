// Fahrzeug-Entität: Physik je Klasse (Auto/Motorrad/Kette/Boot/Flugzeug/Hubschrauber), Schaden, Verwaltung.
import * as THREE from 'three';
import { clamp, lerp, wrapPi, damp, TAU } from '../util.js';
import { createVehicleObject, VEHICLE_TYPES, vehicleDims, VMAT } from './vehicle_models.js';
import { waveHeight } from '../render/water.js';
import { pierBerth } from '../world/piers.js';
import { driveRail } from '../ai/rail.js';

let NEXT_ID = 1;
const BURN_TIME = 5;            // brennendes Fahrzeug explodiert nach 5 s
const FUEL_RANGE = 15000;       // Meter mit einer Tankfüllung
const FUEL_IDLE = 2400;         // Sekunden Leerlauf bis leer
const _contacts = [];

export class Vehicle {
  constructor(game, typeKey, x, z, heading, opts = {}) {
    this.game = game;
    this.id = NEXT_ID++;
    this.type = typeKey;
    this.T = VEHICLE_TYPES[typeKey];
    this.cls = this.T.cls;
    this.dims = vehicleDims(typeKey);
    this.owner = opts.owner || 'traffic';   // traffic | parked | player | police | mission | static
    this.origOwner = this.owner;            // bleibt beim Einsteigen erhalten (Missionsfahrzeuge kann man nicht behalten)
    this.ownedIdx = null;                   // Index in game.owned.vehicles, wenn es dem Spieler gehört
    this.paintIdx = opts.paint ?? Math.floor(Math.random() * 8);
    const refs = createVehicleObject(typeKey, this.paintIdx);
    this.refs = refs;
    this.group = refs.group;
    this.x = x; this.z = z; this.h = heading;
    this.y = game.physics.groundHeight(x, z) + 0.05;
    this.vx = 0; this.vz = 0; this.vy = 0; this.yawRate = 0;
    this.pitch = 0; this.roll = 0; this.steerAngle = 0;
    this.ctl = { throttle: 0, steer: 0, brake: 0, handbrake: false, pitch: 0, roll: 0, yaw: 0, lift: 0 };
    this.hp = this.T.hp; this.maxHp = this.T.hp;
    this.driver = opts.driver || null;
    this.passengers = [];
    this.locked = false;
    this.alive = true;
    this.burning = 0; this.exploded = false; this.wreck = false;
    // Tank (nur Landfahrzeuge): 0..1. Fremde Autos sind unterschiedlich voll, eigene/neue voll
    this.usesFuel = this.cls === 'car' || this.cls === 'bike' || this.cls === 'tank';
    this.fuel = opts.fuel ?? (this.owner === 'traffic' || this.owner === 'parked' ? 0.35 + Math.random() * 0.65 : 1);
    this.grounded = true;
    this.airborne = 0;
    this.throttleAir = 0;
    this.engineOn = this.owner === 'traffic' || this.owner === 'police';
    this.sirenOn = false;
    this.lightsOn = false;
    this.horn = 0;
    this.mission = null;
    this.speed = 0;
    this.lastHit = null;
    this.wheelSpin = 0;
    this.suspY = 0; this.suspV = 0;
    this.bobT = Math.random() * 10;
    this.hw = this.dims.hw; this.hl = this.dims.hl;
    this.height = this.dims.h;
    this.impactSpeed = 0;
    this.blip = null;
    this.stuckT = 0;
    this.submerged = 0;
    this.ai = null;
    this.rail = null;      // geführte Fahrt auf der Fahrbahn (KI), siehe ai/rail.js
    game.scene.add(this.group);
    this.syncVisual(0);
  }

  get speedKmh() { return Math.abs(this.speed) * 3.6; }
  get fwd() { return { x: Math.sin(this.h), z: Math.cos(this.h) }; }
  get lat() { return { x: Math.cos(this.h), z: -Math.sin(this.h) }; }

  setPaint(idx) { this.paintIdx = idx; }

  // Sitzposition (Weltkoordinaten) für Fahrer (i=0) oder Beifahrer (i=1,...)
  seatWorld(i = 0, out = {}) {
    const s = this.dims.seat;
    const side = i === 0 ? 1 : -1;
    const lx = this.cls === 'bike' || this.cls === 'tank' || this.type === 'tractor' || this.type === 'forklift' ? s.x : s.x * side;
    const ly = s.y, lz = s.z - (i >= 2 ? 1.0 : 0);
    const c = Math.cos(this.h), sn = Math.sin(this.h);
    // lokale +x = lateral (c,-s) ; lokale +z = vorwärts (s,c)
    out.x = this.x + c * (-lx) + sn * lz;
    out.z = this.z - sn * (-lx) + c * lz;
    out.y = this.y + ly;
    return out;
  }

  // Tür-Position (links) für Ein-/Ausstieg
  doorWorld(side = 1, out = {}) {
    const c = Math.cos(this.h), sn = Math.sin(this.h);
    const off = this.hw + 0.9;
    const lz = this.dims.seat.z;
    out.x = this.x + c * off * side + sn * lz;
    out.z = this.z - sn * off * side + c * lz;
    return out;
  }

  damage(amount, source = null) {
    if (!this.alive || this.exploded) return;
    if (this.game.godVehicles && this === this.game.player?.vehicle) return;
    this.hp -= amount;
    this.lastHit = source;
    if (this.hp <= 0 && !this.burning) {
      this.hp = 0;
      this.burning = BURN_TIME;
      const pl = this.game.player;
      if (pl && (this.driver === pl || this.passengers.includes(pl))) this.game.ui?.notify('Das Fahrzeug brennt – steig sofort aus, es explodiert gleich!', 'warn', 4500);
      this.engineOn = false;
      this.rail = null;
      if (this.driver && this.driver !== this.game.player) this.game.eject(this, this.driver);
    }
  }

  explode() {
    if (this.exploded) return;
    this.exploded = true; this.wreck = true; this.burning = 0; this.rail = null;
    this.game.effects.vehicleExplosion(this);
    // Insassen
    for (const o of [this.driver, ...this.passengers]) if (o && o.hurt) o.hurt(200, this.lastHit);
    this.driver = null; this.passengers = [];
    // Wrack: dunkel einfärben
    this.refs.group.traverse((m) => { if (m.isMesh && m !== this.refs.glassMesh) m.userData.wreck = true; });
    this.ctl.throttle = 0; this.ctl.brake = 1;
    this.vy = 6 + Math.random() * 3;
    this.vx += (Math.random() - 0.5) * 6; this.vz += (Math.random() - 0.5) * 6;
    this.yawRate += (Math.random() - 0.5) * 3;
    this.grounded = false;
    this.wreckT = 0;
    this.refs.bodyMesh.material = this.game.wreckMat;
  }

  // ---------- Physik ----------
  update(dt) {
    if (!this.alive) return;
    this.bobT += dt;
    const physics = this.game.physics;
    if (this.exploded) { this._updateWreck(dt); this.syncVisual(dt); return; }
    // Brand
    if (this.burning > 0) {
      this.burning -= dt;
      const fw = this.fwd, k = 1 - this.burning / BURN_TIME;
      if (Math.random() < dt * (16 + k * 30)) this.game.effects.fire(this.x + fw.x * this.hl * 0.55 + (Math.random() - 0.5) * this.hw, this.y + 0.9 + Math.random() * 0.3, this.z + fw.z * this.hl * 0.55 + (Math.random() - 0.5) * this.hw);
      if (Math.random() < dt * (6 + k * 18)) this.game.effects.fire(this.x + (Math.random() - 0.5) * this.hw * 1.6, this.y + 1.0, this.z + (Math.random() - 0.5) * this.hl * 1.6);
      if (Math.random() < dt * 5) this.game.effects.smoke(this.x + fw.x * this.hl * 0.5, this.y + 1.6, this.z + fw.z * this.hl * 0.5, 1.4);
      if (this.burning <= 0) this.explode();
    } else if (this.hp < this.maxHp * 0.3 && Math.random() < dt * 5) this.game.effects.smoke(this.x + this.fwd.x * this.hl * 0.6, this.y + 1.0, this.z + this.fwd.z * this.hl * 0.6, this.hp < this.maxHp * 0.15 ? 0.2 : 0.7);

    // Polizei-Hubschrauber wird von der KI direkt bewegt
    if (this.ai && this.ai.kind === 'heli') { this.syncVisual(dt); return; }
    if (this.rail) { this._guided(dt); this.syncVisual(dt); return; }
    // Ohne Fahrer: Motor aus, ausrollen
    const driven = !!this.driver || this.engineOn;
    if (!driven && this.cls !== 'plane' && this.cls !== 'heli') { this.ctl.throttle = 0; this.ctl.steer = 0; this.ctl.brake = 0.25; }
    if (!this.driver && this.owner === 'parked') { this.ctl.throttle = 0; this.ctl.brake = 1; this.ctl.handbrake = true; }

    switch (this.cls) {
      case 'boat': this._boat(dt); break;
      case 'plane': this._plane(dt); break;
      case 'heli': this._heli(dt); break;
      case 'tank': this._car(dt, true); break;
      default: this._car(dt, false);
    }
    this.speed = this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h);
    if (this.usesFuel && this.driver && this.driver.isPlayer && this.fuel > 0) this.fuel = Math.max(0, this.fuel - (Math.abs(this.speed) * dt) / FUEL_RANGE - (this.engineOn ? dt / FUEL_IDLE : 0));
    this.syncVisual(dt);
    void physics;
  }

  _car(dt, tank) {
    const T = this.T, physics = this.game.physics, ctl = this.ctl;
    const fx = Math.sin(this.h), fz = Math.cos(this.h), lx = Math.cos(this.h), lz = -Math.sin(this.h);
    let vLong = this.vx * fx + this.vz * fz, vLat = this.vx * lx + this.vz * lz;
    const wet = this.game.atm ? this.game.atm.w.rain : 0;
    const gx = this.x, gz = this.z;
    const ground = physics.groundHeight(gx, gz);
    const inWater = ground < -0.55;
    if (inWater && this.grounded) {
      this.submerged += dt;
      vLong *= Math.exp(-1.8 * dt); vLat *= Math.exp(-3 * dt);
      ctl.throttle *= 0.15;
      if (this.submerged > 1.2 && this.hp > 0 && this.owner !== 'mission') this.damage(dt * 260);
    } else this.submerged = Math.max(0, this.submerged - dt);
    const maxS = T.maxSpeed * (this.cls === 'bike' ? 1 : 1);
    // Antrieb (mit leerem Tank kein Gas)
    const t = this.usesFuel && this.fuel <= 0 && this.driver && this.driver.isPlayer ? Math.min(0, ctl.throttle) * 0.3 : ctl.throttle;
    let a = 0;
    const brakeAcc = T.brake;
    if (t > 0.02) {
      if (vLong < -0.6) a = brakeAcc * t;
      else { const k = clamp(vLong / maxS, 0, 1); a = T.accel * t * (1 - k * k * k); }
    } else if (t < -0.02) {
      if (vLong > 0.6) a = -brakeAcc * -t;
      else { const k = clamp(-vLong / (maxS * 0.3), 0, 1); a = T.accel * 0.7 * t * (1 - k * k); }
    }
    if (ctl.brake > 0.02) {
      const bk = brakeAcc * ctl.brake * Math.sign(vLong);
      const nv = vLong - bk * dt;
      vLong = Math.sign(nv) !== Math.sign(vLong) ? 0 : nv;
    }
    // Rollreibung + Luftwiderstand
    const drag = 0.12 + (Math.abs(vLong) * 0.018) * (1 + 0.0);
    a -= vLong * drag * (Math.abs(t) > 0.02 ? 0.6 : 1.0);
    if (!this.grounded) a = 0;
    // Steigung bremst/beschleunigt
    const hF = physics.groundHeight(this.x + fx * 1.5, this.z + fz * 1.5), hB = physics.groundHeight(this.x - fx * 1.5, this.z - fz * 1.5);
    const slope = (hF - hB) / 3;
    a -= 9.81 * slope * 0.8;
    vLong += a * dt;
    if (Math.abs(vLong) < 0.05 && Math.abs(t) < 0.02) vLong = 0;
    if (ctl.handbrake) vLong *= Math.exp(-0.9 * dt);

    // Seitliche Haftung
    let grip = T.grip * (1 - wet * 0.3) * (ctl.handbrake ? 0.12 : 1);
    if (this.cls === 'tank') grip = 14;
    // Gras/Gelände: Offroad-Fahrzeuge besser
    const lu = this.game.ctx.landuse.get(this.x, this.z);
    const onRoad = !!this.game.roadNear(this.x, this.z, 4.5);
    if (!onRoad && lu === 0 && !T.offroad && this.cls !== 'tank') { grip *= 0.8; vLong *= Math.exp(-0.18 * dt); }
    if (!this.grounded) grip = 0.2;
    vLat *= Math.exp(-grip * dt);
    // Lenkung
    // Bus und LKW lenken für den Spieler mit A/D deutlich stärker (großer Radeinschlag, schnelleres Einlenken); bei hohem Tempo
    // sinkt der Einschlag, damit er nicht ausbricht. Alle anderen Fahrzeuge und Busse/LKW im Verkehr lenken wie bisher.
    const playerBus = (this.type === 'bus' || this.type === 'truck') && !!this.driver && !!this.driver.isPlayer;
    const lock = playerBus ? 2.1 : 1;
    let maxSteer = (T.steer * lock) / (1 + Math.abs(vLong) * (this.cls === 'bike' ? 0.05 : playerBus ? 0.085 : 0.06));
    if (tank) maxSteer = T.steer;
    const steerTarget = ctl.steer * maxSteer;
    const steerRate = playerBus ? (Math.abs(steerTarget) > Math.abs(this.steerAngle) ? 11 : 13) : (Math.abs(steerTarget) > Math.abs(this.steerAngle) ? 7 : 11);
    this.steerAngle += (steerTarget - this.steerAngle) * (1 - Math.exp(-steerRate * dt));
    const wb = Math.max(1.4, this.hl * 1.15);
    let yawTarget;
    if (tank) yawTarget = this.steerAngle * (1.2 + Math.abs(vLong) * 0.05) * (this.grounded ? 1 : 0);
    else if (T.rearSteer) yawTarget = -(vLong * Math.tan(this.steerAngle)) / wb;
    else yawTarget = (vLong * Math.tan(this.steerAngle)) / wb;
    if (!this.grounded) yawTarget = this.yawRate;
    // Driften: bei Handbremse dreht das Heck stärker aus
    if (ctl.handbrake && Math.abs(vLong) > 5) yawTarget *= 1.45;
    this.yawRate += (yawTarget - this.yawRate) * (1 - Math.exp(-(tank ? 8 : 9) * dt));
    this.h += this.yawRate * dt;
    // Geschwindigkeit zurück in Weltkoordinaten (mit neuem Kurs)
    const nfx = Math.sin(this.h), nfz = Math.cos(this.h), nlx = Math.cos(this.h), nlz = -Math.sin(this.h);
    // Seitengeschwindigkeit bleibt beim Drehen erhalten (Impuls), Längsanteil folgt dem Kurs
    this.vx = nfx * vLong + nlx * vLat; this.vz = nfz * vLong + nlz * vLat;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this._terrainAndWheels(dt);
    this._collideStatics(dt);
    // Räder drehen
    const spin = (vLong * dt);
    for (const w of this.refs.wheels) w.spin += spin / w.r;
    // Die Vorderräder von Bus und LKW schlagen für den Spieler sichtbar stärker ein
    this.steerVisual = playerBus ? clamp(this.steerAngle * 1.25, -1.0, 1.0) : this.steerAngle;
    // Stehengebliebene Hupen etc.
    if (this.horn > 0) this.horn -= dt;
  }

  // Geführte Fahrt: Ort und Kurs kommen von der Spur, Höhe und Neigung vom Boden
  _guided(dt) {
    const o = driveRail(this.game.ctx.net, this, dt);
    const turn = wrapPi(Math.atan2(o.dx, o.dz) - this.h) * Math.min(1, dt * 12);
    this.h += turn;
    this.x = o.x; this.z = o.z;
    this.speed = this.rail.speed;
    this.vx = Math.sin(this.h) * this.speed; this.vz = Math.cos(this.h) * this.speed;
    this.yawRate = turn / Math.max(dt, 1e-3);
    this.steerAngle = clamp(Math.atan((this.yawRate * Math.max(1.4, this.hl * 1.15)) / Math.max(2, this.speed)), -0.6, 0.6);
    this.steerVisual = this.steerAngle;
    this.grounded = true;
    this._terrainAndWheels(dt);
    for (const w of this.refs.wheels) w.spin += (this.speed * dt) / w.r;
    if (this.horn > 0) this.horn -= dt;
  }

  // Höhe, Neigung und Sprünge
  _terrainAndWheels(dt) {
    const physics = this.game.physics;
    const fx = Math.sin(this.h), fz = Math.cos(this.h), lx = Math.cos(this.h), lz = -Math.sin(this.h);
    const L = this.hl * 0.78, Wd = this.hw * 0.85;
    const gF = physics.groundHeight(this.x + fx * L, this.z + fz * L), gB = physics.groundHeight(this.x - fx * L, this.z - fz * L);
    const gL = physics.groundHeight(this.x + lx * Wd, this.z + lz * Wd), gR = physics.groundHeight(this.x - lx * Wd, this.z - lz * Wd);
    const gC = physics.groundHeight(this.x, this.z);
    let g = (gF + gB + gL + gR) / 4 * 0.6 + gC * 0.4;
    g = Math.max(g, Math.max(gF, gB, gL, gR) - 0.35);
    const rideH = this.dims.wheelR * 0.18;
    const targetPitch = Math.atan2(gF - gB, 2 * L);
    const targetRoll = Math.atan2(gL - gR, 2 * Wd);
    if (this.grounded) {
      const ny = g + rideH;
      const dy = (ny - this.y) / Math.max(dt, 1e-3);
      if (dy < -9 && this.speed > 10 && !this.rail) { this.grounded = false; this.vy = dy * 0.6; this.airborne = 0; }
      else { this.y += (ny - this.y) * Math.min(1, dt * 22); this.vy = 0; }
      this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 12);
      this.roll += (targetRoll - this.roll) * Math.min(1, dt * 12);
    } else {
      this.vy -= 24 * dt;
      this.y += this.vy * dt;
      this.airborne += dt;
      this.pitch += (-this.vy * 0.01 - this.pitch) * Math.min(1, dt * 1.2);
      if (this.y <= g + rideH) {
        this.y = g + rideH;
        const impact = -this.vy;
        this.grounded = true;
        if (impact > 7) this.damage((impact - 7) * 25);
        if (impact > 5) this.game.effects.dust(this.x, this.y, this.z, 6);
        this.vy = 0;
        this.suspV = -impact * 0.04;
      }
    }
    // Federung (Nicken beim Bremsen/Beschleunigen)
    const long = this.speed;
    this.suspV += (-this.suspY * 90 - this.suspV * 9) * dt;
    this.suspY += this.suspV * dt;
    void long;
  }

  _collideStatics(dt) {
    const physics = this.game.physics;
    const rect = { x: this.x, z: this.z, hw: this.hw * 0.96, hl: this.hl * 0.96, h: this.h, y0: this.y - 0.1, y1: this.y + this.height };
    if (this.cls === 'tank') { rect.hw = this.hw * 0.9; rect.hl = this.hl * 0.92; }
    physics.vehicleContacts(rect, _contacts);
    let worst = 0;
    for (const c of _contacts) {
      if (c.soft) { this.vx *= 0.99; this.vz *= 0.99; continue; }
      // Auf Plattform fahren erlaubt (Piers): nur Statik
      this.x += c.nx * c.pen * 0.85; this.z += c.nz * c.pen * 0.85;
      const vn = this.vx * c.nx + this.vz * c.nz;
      if (vn < 0) {
        const e = 0.14;
        const dvx = -vn * (1 + e) * c.nx, dvz = -vn * (1 + e) * c.nz;
        this.vx += dvx; this.vz += dvz;
        // Tangentialreibung
        const tx = this.vx - (this.vx * c.nx + this.vz * c.nz) * c.nx, tz = this.vz - (this.vx * c.nx + this.vz * c.nz) * c.nz;
        this.vx -= tx * 0.06; this.vz -= tz * 0.06;
        // Drehimpuls
        const rx = clamp(c.px - this.x, -this.hl, this.hl) * 0.5, rz = clamp(c.pz - this.z, -this.hl, this.hl) * 0.5;
        const k2 = (this.hw * this.hw + this.hl * this.hl) / 3;
        this.yawRate += clamp((rz * dvx - rx * dvz) / k2, -2.2, 2.2);
        worst = Math.max(worst, -vn);
        if (c.c && c.c.prop === 'palm' || (c.c && c.c.prop === 'pine')) this.vx *= 0.8, this.vz *= 0.8;
      }
    }
    if (worst > 4) {
      this.impactSpeed = worst;
      const dmg = Math.pow(worst - 3, 1.35) * 22 * (this.cls === 'bike' ? 1.5 : 1);
      // Ein einzelner Aufprall macht den Wagen nie sofort kaputt (der zweite schon) – so bleibt Zeit zum Aussteigen
      this.damage(this.hp > this.maxHp * 0.3 ? Math.min(dmg, this.maxHp * 0.74) : dmg);
      this.game.onVehicleCrash(this, worst);
    }
  }

  _boat(dt) {
    const T = this.T, physics = this.game.physics, ctl = this.ctl;
    const fx = Math.sin(this.h), fz = Math.cos(this.h), lx = Math.cos(this.h), lz = -Math.sin(this.h);
    let vLong = this.vx * fx + this.vz * fz, vLat = this.vx * lx + this.vz * lz;
    const t = ctl.throttle;
    const driven = !!this.driver;
    let a = 0;
    if (driven && t > 0.02) a = T.accel * t * (1 - clamp(vLong / T.maxSpeed, 0, 1) ** 2);
    else if (driven && t < -0.02) a = T.accel * 0.5 * t * (vLong > 0 ? 1.6 : 1) * (1 - clamp(-vLong / (T.maxSpeed * 0.25), 0, 1));
    a -= vLong * (0.35 + Math.abs(vLong) * 0.012);
    if (ctl.brake > 0.02) a -= Math.sign(vLong) * T.brake * ctl.brake;
    vLong += a * dt;
    vLat *= Math.exp(-T.grip * dt);
    const steerT = ctl.steer * T.steer;
    this.steerAngle += (steerT - this.steerAngle) * (1 - Math.exp(-6 * dt));
    const turn = (this.steerAngle * (0.25 + clamp(Math.abs(vLong) / 8, 0, 1) * 0.9)) * Math.sign(vLong || 1) * (Math.abs(vLong) > 0.4 ? 1 : 0);
    const turnLow = this.steerAngle * (driven && Math.abs(t) > 0.02 ? 0.5 : 0);
    const yawT = turn + (Math.abs(vLong) <= 0.4 ? turnLow : 0);
    this.yawRate += (yawT - this.yawRate) * (1 - Math.exp(-5 * dt));
    this.h += this.yawRate * dt;
    const nfx = Math.sin(this.h), nfz = Math.cos(this.h), nlx = Math.cos(this.h), nlz = -Math.sin(this.h);
    this.vx = nfx * vLong + nlx * vLat; this.vz = nfz * vLong + nlz * vLat;
    const px = this.x, pz = this.z;
    this.x += this.vx * dt; this.z += this.vz * dt;
    // Ufer: Bug/Heck/Mitte prüfen
    const probe = [[0, 0], [this.hl * 0.9, 0], [-this.hl * 0.9, 0]];
    let hitShore = false;
    for (const [pl, pw] of probe) {
      const qx = this.x + nfx * pl + nlx * pw, qz = this.z + nfz * pl + nlz * pw;
      if (physics.groundHeight(qx, qz) > -0.45) { hitShore = true; break; }
    }
    if (hitShore) {
      // Zurück und abbremsen
      const gx = physics.groundHeight(this.x + 3, this.z) - physics.groundHeight(this.x - 3, this.z), gz = physics.groundHeight(this.x, this.z + 3) - physics.groundHeight(this.x, this.z - 3);
      let nx = -gx, nz = -gz; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
      const impact = -(this.vx * nx + this.vz * nz);
      this.x = px + nx * 0.05; this.z = pz + nz * 0.05;
      this.vx += nx * Math.max(impact, 0.5) * 1.3; this.vz += nz * Math.max(impact, 0.5) * 1.3;
      if (impact > 6) this.damage((impact - 5) * 12);
      this.yawRate *= 0.5;
    }
    this.statics(dt);
    // Wellen
    const wt = physics.time;
    const wF = waveHeight(this.x + nfx * this.hl * 0.6, this.z + nfz * this.hl * 0.6, wt), wB = waveHeight(this.x - nfx * this.hl * 0.6, this.z - nfz * this.hl * 0.6, wt);
    const wL = waveHeight(this.x + nlx * this.hw, this.z + nlz * this.hw, wt), wR = waveHeight(this.x - nlx * this.hw, this.z - nlz * this.hw, wt);
    const speedF = clamp(Math.abs(vLong) / T.maxSpeed, 0, 1);
    const targetY = (wF + wB + wL + wR) / 4 - 0.05 + speedF * 0.1;
    this.y += (targetY - this.y) * Math.min(1, dt * 9);
    const tp = Math.atan2(wF - wB, this.hl * 1.2) - speedF * 0.14 * (this.type === 'yacht' ? 0.2 : 1);
    const tr = Math.atan2(wL - wR, this.hw * 2) + this.yawRate * -0.18 * speedF * 1.8;
    this.pitch += (tp - this.pitch) * Math.min(1, dt * 5);
    this.roll += (tr - this.roll) * Math.min(1, dt * 5);
    if (speedF > 0.3 && Math.random() < dt * 20 * speedF) this.game.effects.wake(this.x - nfx * this.hl * 0.9, this.z - nfz * this.hl * 0.9, this.vx * 0.2, this.vz * 0.2);
    this.grounded = true;
  }

  statics(dt) { this._collideStatics(dt); }

  _plane(dt) {
    const T = this.T, physics = this.game.physics, ctl = this.ctl;
    // Gas
    this.throttleAir = clamp(this.throttleAir + ctl.lift * dt * 0.6, 0, 1);
    if (!this.driver) this.throttleAir = Math.max(0, this.throttleAir - dt);
    const ground = physics.groundHeight(this.x, this.z);
    const clearance = this.y - ground;
    const onGround = clearance < 1.1 && this.vy <= 0.5;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    let v = this.airSpeed || 0;
    const target = this.throttleAir * T.maxSpeed;
    const stall = 24;
    v += (target - v) * Math.min(1, dt * (target > v ? 0.35 : 0.2)) + (this.pitch > 0 ? -this.pitch * 12 * dt : -this.pitch * 12 * dt * 0.4);
    if (onGround && ctl.brake > 0.1) v -= 24 * ctl.brake * dt;
    v = Math.max(0, v);
    this.airSpeed = v;
    const lift = clamp((v - stall * 0.7) / (stall * 0.5), 0, 1);
    if (onGround) {
      // Rollen am Boden: Seitenruder lenkt, Nase hoch bei Fahrt über Abhebegeschwindigkeit
      this.yawRate += (ctl.steer * -1.0 * clamp(v / 8, 0, 1) - this.yawRate) * Math.min(1, dt * 4);
      this.h += this.yawRate * dt;
      this.roll += (0 - this.roll) * Math.min(1, dt * 5);
      const wantPitch = ctl.pitch > 0.1 && v > stall * 0.9 ? ctl.pitch * 0.35 : 0;
      this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 4);
      this.y += (ground + 1.0 - this.y) * Math.min(1, dt * 8);
      if (this.pitch > 0.12 && v > stall * 0.95) { this.vy = v * Math.sin(this.pitch); this.y += 0.2; }
      else this.vy = 0;
    } else {
      // Fluglage: Steuerknüppel
      this.pitch += ((ctl.pitch * 0.55) - this.pitch) * Math.min(1, dt * 1.8);
      this.roll += ((ctl.roll * 0.9) - this.roll) * Math.min(1, dt * 2.2);
      const turn = -this.roll * 0.9 * clamp(v / 40, 0, 1.2) + ctl.yaw * 0.35;
      this.h += turn * dt;
      this.yawRate = turn;
      const climb = Math.sin(this.pitch) * v * lift;
      const sink = (1 - lift) * 20;
      this.vy += ((climb - sink * (1 - lift)) - this.vy) * Math.min(1, dt * 1.6);
      if (lift < 0.5) this.pitch += (-0.25 - this.pitch) * Math.min(1, dt * 0.6);
      this.y += this.vy * dt;
    }
    const sp = v * Math.cos(this.pitch);
    this.vx = fx * sp; this.vz = fz * sp;
    this.x += this.vx * dt; this.z += this.vz * dt;
    // Landung / Absturz
    const g2 = physics.groundHeight(this.x, this.z);
    if (this.y < g2 + 1.0 && !onGround) {
      const vsink = -this.vy;
      if (vsink > 10 || Math.abs(this.roll) > 0.5 || this.pitch < -0.35) { this.damage(this.hp + 10); this.burning = 0.1; }
      else { this.y = g2 + 1.0; this.vy = 0; if (vsink > 4) this.damage(vsink * 30); }
    }
    if (g2 < -0.5 && this.y < 1.4) { this.damage(this.hp + 5); this.burning = 0.1; }
    this.statics(dt);
    this.grounded = onGround;
    this.speed = v;
    this.refs.prop && (this.refs.prop.rotation.z += dt * (6 + this.throttleAir * 70));
    // Räder
    for (const w of this.refs.wheels) w.spin += v * dt / w.r;
  }

  _heli(dt) {
    const ctl = this.ctl, physics = this.game.physics;
    const T = this.T;
    // Steuerung: lift = Steigen, pitch = vor/zurück, roll = seitlich, yaw
    const ground = physics.groundHeight(this.x, this.z);
    this.heliRotor = (this.heliRotor ?? 0);
    const power = this.driver || this.ai ? 1 : 0;
    this.heliRotor += ((power ? 1 : 0) - this.heliRotor) * Math.min(1, dt * 0.8);
    this.vy += ((ctl.lift * 9 * this.heliRotor) - this.vy) * Math.min(1, dt * 1.4);
    if (this.heliRotor < 0.8 && this.y > ground + 0.6) this.vy -= (1 - this.heliRotor) * 10 * dt;
    this.yawRate += ((-ctl.yaw * 1.4) - this.yawRate) * Math.min(1, dt * 2.5);
    this.h += this.yawRate * dt;
    const fx = Math.sin(this.h), fz = Math.cos(this.h), lx = Math.cos(this.h), lz = -Math.sin(this.h);
    const tvx = (fx * ctl.pitch + lx * ctl.roll * -1) * T.maxSpeed * 0.7 * this.heliRotor, tvz = (fz * ctl.pitch + lz * ctl.roll * -1) * T.maxSpeed * 0.7 * this.heliRotor;
    this.vx += (tvx - this.vx) * Math.min(1, dt * 0.9); this.vz += (tvz - this.vz) * Math.min(1, dt * 0.9);
    this.x += this.vx * dt; this.z += this.vz * dt; this.y += this.vy * dt;
    const g2 = physics.groundHeight(this.x, this.z);
    if (this.y < g2 + 0.9) { if (this.vy < -7) this.damage((-this.vy - 5) * 80); this.y = g2 + 0.9; this.vy = Math.max(0, this.vy); this.vx *= 0.9; this.vz *= 0.9; }
    this.pitch += ((ctl.pitch * 0.25) - this.pitch) * Math.min(1, dt * 3);
    this.roll += ((ctl.roll * 0.25) - this.roll) * Math.min(1, dt * 3);
    this.speed = Math.hypot(this.vx, this.vz);
    this.grounded = this.y < g2 + 1.2;
    this.statics(dt);
    if (this.refs.rotor) { this.refs.rotor.rotation.y += dt * 30 * this.heliRotor; }
    if (this.refs.tailRotor) this.refs.tailRotor.rotation.x += dt * 40 * this.heliRotor;
  }

  _updateWreck(dt) {
    this.wreckT += dt;
    const physics = this.game.physics;
    this.vy -= 24 * dt;
    this.y += this.vy * dt;
    const g = physics.groundHeight(this.x, this.z);
    if (this.y < g + 0.3) { this.y = g + 0.3; this.vy = Math.abs(this.vy) > 3 ? -this.vy * 0.25 : 0; this.vx *= Math.exp(-2 * dt); this.vz *= Math.exp(-2 * dt); this.yawRate *= Math.exp(-2 * dt); }
    this.x += this.vx * dt; this.z += this.vz * dt; this.h += this.yawRate * dt;
    if (Math.random() < dt * 6) this.game.effects.smoke(this.x, this.y + 0.8, this.z, 1.2);
    if (Math.random() < dt * 8 && this.wreckT < 40) this.game.effects.fire(this.x + (Math.random() - 0.5) * this.hw, this.y + 0.6, this.z + (Math.random() - 0.5) * this.hl);
    this.speed = 0;
  }

  syncVisual(dt) {
    const g = this.group;
    g.position.set(this.x, this.y + this.suspY * 0.5, this.z);
    // Reihenfolge: Kurs, dann Nicken (x) und Wanken (z) im lokalen System
    g.rotation.set(0, 0, 0);
    g.rotation.order = 'YXZ';
    let roll = this.roll;
    if (this.cls === 'bike') roll = -this.steerAngle * clamp(Math.abs(this.speed) / 12, 0, 1) * 1.2 + this.roll * 0.5;
    g.rotation.y = this.h;
    g.rotation.x = -this.pitch + (this.cls === 'car' ? this.suspY * 0.2 : 0);
    g.rotation.z = roll;
    // Räder
    const sv = this.steerVisual ?? this.steerAngle;
    for (const w of this.refs.wheels) {
      w.pivot.rotation.y = w.steer ? (this.T.rearSteer ? -sv : sv) : 0;
      w.mesh.rotation.x = w.spin;
    }
    // Lichter
    const night = this.game.atm ? this.game.atm.night : 0;
    const lightsOn = this.engineOn && (night > 0.25 || this.lightsOn) || (this.lightsOn);
    const hv = lightsOn ? 2.6 : 0.35;
    // Scheinwerfer: Basismaterial geteilt → nur Spieler/Nahe steuern über game.headMat
    const braking = this.ctl.brake > 0.1 || (this.ctl.throttle < -0.1 && this.speed > 0.5);
    this.refs.headMat.color.setRGB(hv, hv * 0.96, hv * 0.85);
    this.refs.tailMat.color.setRGB(braking ? 3.5 : lightsOn ? 1.4 : 0.35, braking ? 0.6 : 0.4, braking ? 0.6 : 0.4);
    if (this.refs.siren) {
      const on = this.sirenOn && !this.exploded;
      const ph = Math.floor((this.game.time * 5) % 2);
      this.refs.siren.red.color.setRGB(on && ph === 0 ? 3.5 : 0.25, 0.0, 0.0);
      this.refs.siren.blue.color.setRGB(0.0, on && ph === 1 ? 1.2 : 0.0, on && ph === 1 ? 3.5 : 0.25);
    }
    void hv; void dt;
  }

  setHeadlights(on) { this.lightsOn = on; }

  dispose() {
    this.alive = false;
    this.game.scene.remove(this.group);
    this.group.traverse((m) => { if (m.isMesh && m.material && m.material === this.refs.tailMat) m.material.dispose(); });
  }
}

// ---------- Verwaltung ----------
export class VehicleManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this._pairs = [];
  }

  spawn(typeKey, x, z, heading, opts = {}) {
    if (VEHICLE_TYPES[typeKey].cls === 'boat') {
      // an einem Steg liegt das Boot im Wasser hinter der Spitze, nicht auf den Planken
      const taken = (bx, bz) => this.list.some((v) => v.alive && Math.hypot(v.x - bx, v.z - bz) < 4);
      const berth = pierBerth(this.game.ctx, x, z, vehicleDims(typeKey).hl, taken);
      if (berth) ({ x, z, h: heading } = berth);
    }
    const v = new Vehicle(this.game, typeKey, x, z, heading, opts);
    this.list.push(v);
    return v;
  }

  remove(v) {
    const i = this.list.indexOf(v);
    if (i >= 0) this.list.splice(i, 1);
    v.dispose();
  }

  nearest(x, z, maxD, filter = null) {
    let best = null, bd = maxD;
    for (const v of this.list) {
      if (filter && !filter(v)) continue;
      const d = Math.hypot(v.x - x, v.z - z) - Math.max(v.hw, v.hl) * 0.6;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  update(dt) {
    const list = this.list;
    for (let i = 0; i < list.length; i++) list[i].update(dt);
    // Fahrzeug-Fahrzeug-Kollisionen (Spieler-/Polizei-/Parkfahrzeuge; Verkehr untereinander nicht)
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.cls === 'plane' && a.y > a.game.physics.groundHeight(a.x, a.z) + 3) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (Math.abs(a.x - b.x) > 14 || Math.abs(a.z - b.z) > 14) continue;
        if (a.cls === 'heli' || b.cls === 'heli' || a.exploded && b.exploded) continue;
        if ((a.cls === 'boat') !== (b.cls === 'boat')) continue;
        if (a.cls === 'plane' && b.cls !== 'plane' && a.y > b.y + 5) continue;
        const aMoving = a.driver || a.ai?.moving || Math.abs(a.speed) > 2, bMoving = b.driver || b.ai?.moving || Math.abs(b.speed) > 2;
        if (!aMoving && !bMoving) { this._separate(a, b, true); continue; }
        // Geführte Fahrzeuge halten untereinander selbst Abstand
        if (a.rail && b.rail) continue;
        this._collide(a, b);
      }
    }
  }

  _separate(a, b) { this._collide(a, b, true); }

  _collide(a, b, soft = false) {
    // SAT zweier Rechtecke
    const ax = Math.sin(a.h), az = Math.cos(a.h), alx = Math.cos(a.h), alz = -Math.sin(a.h);
    const bx = Math.sin(b.h), bz = Math.cos(b.h), blx = Math.cos(b.h), blz = -Math.sin(b.h);
    const dx = a.x - b.x, dz = a.z - b.z;
    const axes = [[ax, az], [alx, alz], [bx, bz], [blx, blz]];
    let best = 1e9, nx = 0, nz = 0;
    for (const [px, pz] of axes) {
      const rA = a.hl * Math.abs(px * ax + pz * az) + a.hw * Math.abs(px * alx + pz * alz);
      const rB = b.hl * Math.abs(px * bx + pz * bz) + b.hw * Math.abs(px * blx + pz * blz);
      const dist = dx * px + dz * pz;
      const ov = rA + rB - Math.abs(dist);
      if (ov <= 0) return;
      if (ov < best) { best = ov; const s = dist >= 0 ? 1 : -1; nx = px * s; nz = pz * s; }
    }
    if (Math.abs(a.y - b.y) > 2.5 && a.cls !== 'boat') return;
    const ma = a.T.mass, mb = b.T.mass;
    const wa = a.owner === 'parked' && !a.driver ? 0.15 : 1, wb = b.owner === 'parked' && !b.driver ? 0.15 : 1;
    const ia = (1 / ma) * wa, ib = (1 / mb) * wb;
    const tot = ia + ib;
    const push = Math.min(best, 1.5) * (soft ? 0.3 : 0.6);
    a.x += nx * push * (ia / tot); a.z += nz * push * (ia / tot);
    b.x -= nx * push * (ib / tot); b.z -= nz * push * (ib / tot);
    const rvx = a.vx - b.vx, rvz = a.vz - b.vz;
    const vn = rvx * nx + rvz * nz;
    if (vn < 0) {
      // Gerammt: ein geführtes Fahrzeug gerät aus der Spur (beim Spieler genügt ein leichter Stoß)
      if (-vn > (a.driver?.isPlayer || b.driver?.isPlayer ? 1.2 : 3)) a.rail = b.rail = null;
      const e = 0.2;
      const j = -(1 + e) * vn / tot;
      a.vx += j * ia * nx; a.vz += j * ia * nz;
      b.vx -= j * ib * nx; b.vz -= j * ib * nz;
      const imp = -vn;
      if (imp > 3 && !soft) {
        const dmgA = Math.pow(imp - 2, 1.3) * 20 * (mb / (ma + mb)) * 2, dmgB = Math.pow(imp - 2, 1.3) * 20 * (ma / (ma + mb)) * 2;
        // Gedeckelt: ein einzelner Crash zerstört einen gesunden Wagen nicht sofort (Spieler kann noch aussteigen)
        a.damage(a.hp > a.maxHp * 0.3 ? Math.min(dmgA, a.maxHp * 0.74) : dmgA, b.driver || b);
        b.damage(b.hp > b.maxHp * 0.3 ? Math.min(dmgB, b.maxHp * 0.74) : dmgB, a.driver || a);
        a.yawRate += clamp((Math.random() - 0.5) * imp * 0.12, -1.5, 1.5); b.yawRate += clamp((Math.random() - 0.5) * imp * 0.12, -1.5, 1.5);
        a.game.onVehicleCrash(a, imp, b);
        a.game.crashHurt(b, imp); a.game.effects.sparks((a.x + b.x) / 2, Math.min(a.y, b.y) + 0.6, (a.z + b.z) / 2, 6);
      }
    }
  }

  dispose() { for (const v of [...this.list]) this.remove(v); }
}
