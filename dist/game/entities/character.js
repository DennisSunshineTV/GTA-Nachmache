// Basisklasse für alle Figuren: Bewegung, Kollision, Waffen, Schaden, Animation.
import * as THREE from 'three';
import { Human, randomOutfit } from './human.js';
import { WEAPONS, makeWeaponModel, MUZZLE } from '../combat/weapons.js';
import { clamp, lerp, wrapPi, damp, dampAngle, mulberry32 } from '../util.js';
import { waveHeight } from '../render/water.js';

let NEXT_ID = 1;
const WALK = 1.9, RUN = 4.3, SPRINT = 6.9, SWIM = 2.0;
const _seatV = new THREE.Vector3();

export class Character {
  constructor(game, kind, x, z, opts = {}) {
    this.game = game;
    this.id = NEXT_ID++;
    this.kind = kind;                 // ped | cop | enemy | player
    this.name = opts.name || '';
    this.x = x; this.z = z; this.h = opts.heading ?? Math.random() * Math.PI * 2;
    this.y = game.physics.groundHeight(x, z);
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.state = 'ground';
    this.hp = opts.hp ?? 100; this.maxHp = this.hp; this.armor = opts.armor ?? 0;
    this.alive = true;
    this.intent = { mx: 0, mz: 0, speed: 0, aim: false, ax: 0, az: 1, ay: 0, fire: false, jump: false, crouch: false, sprint: false };
    this.vehicle = null; this.seat = 0;
    this.weapons = {};
    this.cur = 'fists';
    this.isPlayer = false;
    this.hostile = false;
    this.ai = null;
    this.outfitKind = opts.outfit || 'local';
    this.human = null;
    this.visible = false;
    this.anim = {};
    this.fireCd = 0;
    this.reloadT = 0;
    this.meleeT = 0; this.throwT = 0;
    // Nahkampf und Klettern: Tritt, Ausholen (angekündigter Schlag), Blocken, Ausweichen
    this.kickT = 0; this.windT = 0; this.heavyHit = false;
    this.blocking = false; this.dodgeT = 0; this.dodgeSide = 1;
    this.faceLock = null;             // feste Blickrichtung (Blocken, Ausweichen)
    this.climb = null;                // laufendes Klettern: { t, dur, from, to, peak }
    this.aimPitch = 0;
    this.speedH = 0;
    this.radius = 0.36;
    this.deadT = 0;
    this.swimming = false;
    this.lastDamager = null;
    this.invuln = 0;
    this.crouch = false;
    this.headingTarget = this.h;
    this.seed = Math.floor(Math.random() * 1e9);
    this.cash = opts.cash ?? Math.floor(Math.random() * 40);
    this.sayT = 0;
    this.noHuman = !!opts.noHuman;
  }

  get fwd() { return { x: Math.sin(this.h), z: Math.cos(this.h) }; }
  get weapon() { return WEAPONS[this.cur]; }
  get inVehicle() { return this.state === 'vehicle'; }
  get speed() { return Math.hypot(this.vx, this.vz); }

  // force: auch Figuren ohne eigenes Modell (Fahrer im Verkehr) bekommen eines, wenn man sie im Auto sehen kann
  ensureHuman(force = false) {
    if (this.human || (this.noHuman && !force)) return this.human;
    const rng = mulberry32(this.seed);
    const outfit = randomOutfit(rng, this.outfitKind);
    outfit.id = this.outfitKind;
    this.human = new Human(outfit);
    this.human.group.visible = true;
    this.game.scene.add(this.human.group);
    this._applyWeaponModel();
    return this.human;
  }

  setOutfit(kind) { this.outfitKind = kind; if (this.human) { this.game.scene.remove(this.human.group); this.human = null; this.ensureHuman(); } }

  dropHuman() {
    if (!this.human) return;
    this.game.scene.remove(this.human.group);
    this.human = null;
  }

  // ---------- Waffen ----------
  giveWeapon(id, ammo = null) {
    const W = WEAPONS[id];
    if (!W) return;
    let w = this.weapons[id];
    if (!w) w = this.weapons[id] = { mag: W.mag || 0, reserve: W.reserve ? Math.floor(W.reserve * 0.5) : 0 };
    if (ammo !== null && W.mag) w.reserve += ammo;
    else if (W.mag && ammo === null && this.weapons[id] !== w) w.reserve += W.reserve || 0;
    return w;
  }
  addAmmo(id, n) { const w = this.weapons[id]; if (w) w.reserve += n; }
  hasWeapon(id) { return id === 'fists' || !!this.weapons[id]; }

  setWeapon(id) {
    if (id !== 'fists' && !this.weapons[id]) return false;
    if (this.cur === id) return true;
    this.cur = id;
    this.reloadT = 0;
    this._applyWeaponModel();
    return true;
  }

  _applyWeaponModel() {
    if (!this.human) return;
    const W = this.weapon;
    this.human.setWeapon(W && W.model ? makeWeaponModel(W.id) : null);
  }

  reload() {
    const W = this.weapon, w = this.weapons[this.cur];
    if (!W || !W.mag || !w || this.reloadT > 0 || w.mag >= W.mag || w.reserve <= 0) return;
    this.reloadT = W.reload;
    this.game.audio?.reloadSound(this);
  }

  // ---------- Schaden ----------
  hurt(dmg, source = null, head = false) {
    if (!this.alive || this.invuln > 0 || dmg <= 0) return;
    if (this.isPlayer && this.game.god) return;
    this.lastDamager = source;
    let d = dmg;
    if (this.armor > 0) { const a = Math.min(this.armor, d * 0.7); this.armor -= a; d -= a; }
    this.hp -= d;
    this.game.onCharacterHurt?.(this, d, source, head);
    if (this.hp <= 0) this.die(source);
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  die(source) {
    if (!this.alive) return;
    this.alive = false;
    this.hp = 0;
    this.climb = null; this.blocking = false; this.windT = 0; this.dodgeT = 0;
    if (this.vehicle) this.game.exitVehicle(this, true);
    this.state = 'dead';
    this.deadT = 0;
    this.vx *= 0.3; this.vz *= 0.3;
    this.ensureHuman();
    this.game.onCharacterKilled?.(this, source);
  }

  say(text, dur = 3) { if (this.alive) this.game.ui?.bubble(this, text, dur); }

  // ---------- Bewegung ----------
  update(dt) {
    const g = this.game;
    this.invuln = Math.max(0, this.invuln - dt);
    this.fireCd = Math.max(0, this.fireCd - dt);
    this.meleeT = Math.max(0, this.meleeT - dt * 2.6);
    this.throwT = Math.max(0, this.throwT - dt * 2.2);
    this.kickT = Math.max(0, this.kickT - dt * 2.2);
    this.windT = Math.max(0, this.windT - dt);
    this.dodgeT = Math.max(0, this.dodgeT - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const W = this.weapon, w = this.weapons[this.cur];
        if (W && w) { const need = W.mag - w.mag; const take = Math.min(need, w.reserve); w.mag += take; w.reserve -= take; }
      }
    }
    if (this.state === 'dead') { this.deadT += dt; this._updateVisual(dt); return; }
    if (this.state === 'vehicle') { this._followVehicle(dt); this._updateVisual(dt); return; }
    if (this.climb) { this._climb(dt); this._updateVisual(dt); return; }
    const I = this.intent;
    const physics = g.physics;
    const px = this.x, pz = this.z;
    // Wasser? (Meer: Höhe 0; Schwimmbecken: eigene Wasserhöhe)
    const ground = physics.groundHeight(this.x, this.z);
    const pool = physics.poolAt(this.x, this.z);
    const surf = pool ? physics.poolLevel(pool) : 0;
    const depth = surf - ground;
    const wasSwim = this.state === 'swim';
    if (depth > 1.35) this.state = 'swim';
    else if (this.state === 'swim') { this.state = 'ground'; }
    this.swimming = this.state === 'swim';
    this.inPool = pool;

    // Wunschgeschwindigkeit
    let top = I.sprint ? SPRINT : I.speed > 0.6 ? RUN : WALK;
    if (I.speed > 0 && I.speed <= 0.6) top = WALK;
    if (I.crouch) top = 1.4;
    if (this.swimming) top = SWIM;
    else if (depth > 0.35) top *= 0.62;
    if (I.aim && !this.isPlayer) top *= 0.7;
    if (this.reloadT > 0) top *= 0.85;
    const mag = Math.hypot(I.mx, I.mz);
    const wx = mag > 0.01 ? (I.mx / mag) * top * Math.min(1, mag) : 0, wz = mag > 0.01 ? (I.mz / mag) * top * Math.min(1, mag) : 0;
    const accel = this.state === 'air' ? 2.2 : 13;
    this.vx = damp(this.vx, wx, accel, dt);
    this.vz = damp(this.vz, wz, accel, dt);

    // Blickrichtung
    if (this.faceLock !== null) this.h = dampAngle(this.h, this.faceLock, 20, dt);
    else if (I.aim && (I.ax || I.az)) this.h = dampAngle(this.h, Math.atan2(I.ax, I.az), 16, dt);
    else if (mag > 0.01 && this.speed > 0.3) this.h = dampAngle(this.h, Math.atan2(this.vx, this.vz), 11, dt);
    else if (I.face !== undefined && I.face !== null) this.h = dampAngle(this.h, I.face, 8, dt);

    // Bewegung mit Hangprüfung
    let nx = this.x + this.vx * dt, nz = this.z + this.vz * dt;
    const ng = physics.groundHeight(nx, nz);
    const onGround = this.state === 'ground';
    // Schwimmer gleiten nicht unter einen Steg (und werden nicht hinaufgehoben): hinauf geht es nur durch Klettern.
    // Ebenso der Beckenrand eines Pools: hinaus geht es nur durch Klettern (der Spieler klettert automatisch, siehe player.js)
    const atPier = this.state === 'swim' && physics.platformHeight(nx, nz) - this.y > 0.7;
    const atRim = !!pool && (this.state === 'swim' || this.state === 'ground') && physics.poolAt(nx, nz) !== pool && ng - this.y > 0.7;
    this.atPoolRim = atRim;
    // Passanten und Polizisten steigen nach kurzer Zeit von selbst aus dem Becken
    if (atRim && !this.isPlayer) { this.rimT = (this.rimT || 0) + dt; if (this.rimT > 1.2) { this.rimT = 0; this.x = nx; this.z = nz; this.y = ng; this.state = 'ground'; this._updateVisual(dt); return; } }
    if (atPier || atRim || (onGround && ng - this.y > 0.7 && ng > -1)) {
      // zu steil/hoch: seitlich gleiten versuchen
      const gx = physics.groundHeight(nx, this.z), gz = physics.groundHeight(this.x, nz);
      nx = gx - this.y <= 0.7 ? nx : this.x; nz = gz - this.y <= 0.7 ? nz : this.z;
      if (nx === this.x) this.vx = 0; if (nz === this.z) this.vz = 0;
    }
    this.x = nx; this.z = nz;
    // Kollision mit Statik
    const pos = { x: this.x, z: this.z };
    physics.pushCircle(pos, this.radius, this.y + 0.2, this.y + 1.8);
    this.x = pos.x; this.z = pos.z;
    g.collideCharacter?.(this);

    // Höhe
    const gh = physics.groundHeight(this.x, this.z);
    if (this.swimming) {
      const wave = this.inPool ? physics.poolLevel(this.inPool) : waveHeight(this.x, this.z, physics.time, 0.6);
      // Tauchen (nur Spieler): diveDepth Meter unter der Schwimmlage, nie unter den Grund
      // Beim Kraulen liegt der Körper flach an der Oberfläche (Rücken und Arme sichtbar)
      const crawl = (this.diveDepth || 0) > 0.3 ? 0 : clamp(this.speedH / 2.4, 0, 1) * 0.62;
      const target = Math.max(wave - 1.0 + crawl - (this.diveDepth || 0), gh + 0.35);
      this.y += (target - this.y) * Math.min(1, dt * 8);
      this.vy = 0;
    } else if (this.state === 'air') {
      this.vy -= 17 * dt;
      this.y += this.vy * dt;
      if (this.y <= gh) {
        const impact = -this.vy;
        this.y = gh; this.state = 'ground';
        if (impact > 13) this.hurt((impact - 13) * 9, null);
        this.vy = 0;
      }
    } else {
      if (I.jump && !this.noJump) { this.vy = 5.4; this.state = 'air'; this.y += 0.05; }
      else if (gh < this.y - 0.14) { this.state = 'air'; this.vy = 0; }
      else this.y += (gh - this.y) * Math.min(1, dt * 26);
    }
    I.jump = false;
    this.speedH = Math.hypot(this.vx, this.vz);
    this.crouch = I.crouch && this.state === 'ground';
    // Fuß-Staub / Schritte
    this._updateVisual(dt);
    void px; void pz; void wasSwim;
  }

  // Klettern: auf einer festen Bahn über das Hindernis bzw. auf die Kante (ohne Kollision, Ziel ist vorher geprüft)
  _climb(dt) {
    const c = this.climb;
    c.t += dt;
    const k = Math.min(1, c.t / c.dur);
    const ease = (v) => v * v * (3 - 2 * v);
    // Erst hoch, dann hinüber; beim Überklettern anschließend wieder hinunter
    const along = ease(c.ledge ? clamp((k - 0.4) / 0.6, 0, 1) : clamp((k - 0.15) / 0.75, 0, 1));
    this.x = lerp(c.from.x, c.to.x, along); this.z = lerp(c.from.z, c.to.z, along);
    if (c.ledge) this.y = lerp(c.from.y, c.to.y, ease(Math.min(1, k / 0.65)));
    else this.y = lerp(c.from.y, c.to.y, k) + Math.max(0, c.peak - (c.from.y + c.to.y) / 2) * Math.sin(Math.PI * k);
    this.vx = this.vz = this.vy = 0; this.speedH = 0;
    this.intent.jump = false;
    if (k >= 1) { this.climb = null; this.y = c.to.y; this.state = 'ground'; }
  }

  _followVehicle(dt) {
    const v = this.vehicle;
    if (!v || !v.alive) return;
    const s = v.seatWorld(this.seat, {});
    this.x = s.x; this.z = s.z; this.y = s.y - 0.55;
    if (v.cls === 'bike') this.y = v.y + 0.35;
    this.h = v.h;
    this.vx = v.vx; this.vz = v.vz;
  }

  // ---------- Visuals ----------
  _updateVisual(dt) {
    const g = this.game;
    // Weit entfernte Figuren nicht darstellen
    const cam = g.camera.position;
    const d2 = (this.x - cam.x) ** 2 + (this.z - cam.z) ** 2;
    const far = d2 > (this.isPlayer ? 1e12 : 220 * 220);
    if (far && !this.isPlayer) { if (this.human) this.human.group.visible = false; this.visible = false; return; }
    // Im geschlossenen Auto sitzen die Insassen sichtbar hinter den klaren Scheiben (Gesichter erkennt man aus der Nähe)
    const veh = this.state === 'vehicle' ? this.vehicle : null;
    const seated = !!(veh && veh.dims.cabin && veh.alive && !veh.exploded);
    if (veh && !this.showInVehicle && !seated) { if (this.human) this.human.group.visible = false; this.visible = false; return; }
    if (seated && !this.isPlayer && d2 > 85 * 85) {
      if (this.human) { this.human.group.visible = false; if (this.noHuman && d2 > 130 * 130) this.dropHuman(); }
      this.visible = false; return;
    }
    if (!this.human) this.ensureHuman(seated);
    if (!this.human) return;
    const H = this.human;
    H.group.visible = true; this.visible = true;
    H.group.position.set(this.x, this.y, this.z);
    H.group.rotation.y = this.h;
    if (seated) this._seatPose(H, veh);
    const W = this.weapon;
    const gun = W && !W.melee && !W.thrown && W.model;
    const I = this.intent;
    const st = {
      speed: this.state === 'swim' ? this.speedH * 1.6 : this.speedH,
      aim: !!(I.aim && gun && this.state !== 'swim'),
      aimPitch: I.ay || 0,
      twoHanded: !!(W && W.twoHanded),
      holding: !!gun && !I.aim,
      dead: this.state === 'dead',
      swim: this.state === 'swim',
      dive: this.state === 'swim' && (this.diveDepth || 0) > 0.6,
      diveDir: this.diveDir || 0,
      driving: this.state === 'vehicle',
      crouch: this.crouch,
      punch: this.meleeT,
      heavy: this.heavyHit,
      kick: this.kickT,
      windup: this.windT,
      block: this.blocking,
      dodge: this.dodgeT,
      dodgeSide: this.dodgeSide,
      climb: this.climb ? Math.min(1, this.climb.t / this.climb.dur) : null,
      throw: this.throwT,
      wheel: this.vehicle ? this.vehicle.steerAngle : 0,
      carSeat: seated,
      recline: seated ? veh.dims.recline || 0 : 0,
      passenger: seated && veh.driver !== this,
      sit: !!this.anim.sit,
      lie: !!this.anim.lie,
      dance: !!this.anim.dance,
      phone: !!this.anim.phone,
    };
    if (this.state === 'air') { st.speed = 0; }
    H.update(dt, st);
    if (seated) H.group.rotation.set(this._tiltX || 0, veh.h, this._tiltZ || 0);   // Neigung des Autos (nach dem Zurücksetzen in update)
    if (this.state === 'dead' && this.deadT > 0) H.group.position.y = this.y;
  }

  // Nach der Fahrzeugphysik aufrufen (der Spieler rechnet vor den Fahrzeugen): Figur sitzt sonst ein Bild hinter dem Sitz
  resyncSeat() {
    const v = this.state === 'vehicle' ? this.vehicle : null;
    if (!v || !this.human || !this.human.group.visible) return;
    if (v.dims.cabin) { this._seatPose(this.human, v); this.human.group.rotation.set(this._tiltX || 0, v.h, this._tiltZ || 0); }
    else { this._followVehicle(0); this.human.group.position.set(this.x, this.y, this.z); this.human.group.rotation.y = this.h; }
  }

  // Sitzplatz im Auto mit der vollen Lage des Fahrzeugs (Nicken, Wanken, Federung): so bleibt der Kopf immer unter dem Dach
  _seatPose(H, v) {
    const grp = v.group, s = v.dims.seat, i = this.seat || 0;
    grp.updateMatrix();
    const side = i === 0 ? 1 : -1;
    _seatV.set(-s.x * side, s.y - 0.55, s.z - (i >= 2 ? 1.0 : 0)).applyMatrix4(grp.matrix);
    H.group.position.copy(_seatV);
    this._tiltX = grp.rotation.x; this._tiltZ = grp.rotation.z;
  }

  // Position der Mündung / Schussursprung
  muzzlePos(out = {}) {
    const W = this.weapon;
    const len = (MUZZLE[W?.model] || 0.2) * 0.9;
    const I = this.intent;
    const dx = I.ax, dy = I.ay, dz = I.az;
    const l = Math.hypot(dx, dz) || 1;
    out.x = this.x + (-Math.cos(this.h)) * 0.2 * 0 + (I.ax / l) * (0.45 + len);
    out.z = this.z + (I.az / l) * (0.45 + len);
    out.y = this.y + 1.42 + (this.state === 'swim' ? -0.5 : 0) + dy * 0.4;
    return out;
  }

  dispose() {
    this.alive = false;
    if (this.human) { this.game.scene.remove(this.human.group); this.human = null; }
  }
}
