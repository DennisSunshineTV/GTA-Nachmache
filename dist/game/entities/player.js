// Spieler: Steuerung zu Fuß und in Fahrzeugen (Tastatur/Maus und Xbox-Controller), Zielen, Klettern, Kamera.
import * as THREE from 'three';
import { charName } from '../story/characters.js';
import { Character } from './character.js';
import { WEAPON_ORDER, WEAPONS } from '../combat/weapons.js';
import { clamp, lerp, damp, dampAngle, wrapPi } from '../util.js';
import { PAD } from '../core/input.js';

const _v = new THREE.Vector3(), _d = new THREE.Vector3();
const HEAVY_HOLD = 0.35;                 // X so lange (s) halten = schwerer Angriff
const TAP = 0.22;                        // A kürzer gedrückt = Ausweichen/Kontern, länger = nur Blocken
const SIDEARMS = ['pistol', 'smg'];      // Waffen, mit denen man aus dem Fahrzeug schießen kann
// Ausdauer: Sprinten leert die Leiste in STAMINA_SPRINT s. Ist sie leer, ist die Figur erschöpft und geht normal,
// bis die Leiste wieder ganz voll ist (STAMINA_RECOVER s); sonst füllt sie sich in STAMINA_REGEN s.
const STAMINA_SPRINT = 7, STAMINA_REGEN = 5, STAMINA_RECOVER = 4.5, STAMINA_PAUSE = 0.8;
// Tauchen: C bzw. B (Controller) halten = abtauchen, Leertaste bzw. A = auftauchen; Luft reicht O2_TIME s
const O2_TIME = 30, O2_REFILL = 2.5, DIVE_DOWN = 1.9, DIVE_UP = 2.6, BUOYANCY = 0.45;

export class Player extends Character {
  constructor(game, x, z, who = 'jason') {
    super(game, 'player', x, z, { outfit: who === 'lucia' ? 'player_lucia' : 'player_jason', name: charName(who), hp: 200, heading: 0 });
    this.who = who;
    this.isPlayer = true;
    this.maxHp = 200; this.hp = 200;
    this.camYaw = 0; this.camPitch = -0.1; this.camDist = 3.8;
    this.aiming = false;
    this.recoil = 0;
    this.idleCam = 0;
    this.aimPoint = new THREE.Vector3();
    this.promptVehicle = null;
    this.sprinting = false;
    this.fov = 62;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.firstPerson = false;
    this.lastVehicle = null;
    this.money = 0;
    this.giveWeapon('pistol', 60);
    this.setWeapon('pistol');
    this.showInVehicle = false;
    this.smoothDist = 3.8;
    this.camInit = false;
    this.camShakeT = 0;
    this.sidearm = null; this.footWeapon = null;   // gezogene Seitenwaffe im Fahrzeug
    this.stamina = 1; this.exhausted = false; this.staminaWait = 0;
    this.o2 = 1; this.diveDepth = 0; this.diveDir = 0; this.diving = false;
    this._resetPadFoot();
  }

  // Zustände der Controller-Steuerung zu Fuß (LS rennen, B ducken, A/X gedrückt halten)
  _resetPadFoot() {
    this.padSprint = false; this.padCrouch = false;
    this.aT = null; this.xT = null;      // Haltedauer von A (Nahkampf) bzw. X
    this.blocking = false; this.faceLock = null;
  }

  update(dt, input) {
    const g = this.game;
    if (this.alive && g.controlsEnabled) this.handleInput(dt, input);
    else { this._resetPadFoot(); this.intent.mx = this.intent.mz = 0; this.intent.fire = false; this.intent.aim = false; this.intent.speed = 0; if (this.vehicle) { const c = this.vehicle.ctl; c.throttle = 0; c.brake = 0.6; c.steer = 0; } }
    super.update(dt);
    this.recoil = Math.max(0, this.recoil - dt * 0.35);
    this._stamina(dt);
    this._oxygen(dt);
  }

  // Sauerstoff: sinkt, solange der Kopf unter Wasser ist; bei 0 ertrinkt die Figur
  _oxygen(dt) {
    const g = this.game;
    const under = this.alive && this.state === 'swim' && this.diveDepth > 0.6;
    this.diving = under;
    if (this.state !== 'swim') this.diveDepth = 0;
    if (under) {
      this.o2 = Math.max(0, this.o2 - dt / O2_TIME);
      if (Math.random() < dt * 2.5) g.effects.bubbles?.(this.x + Math.sin(this.h) * 0.4, this.y + 1.2, this.z + Math.cos(this.h) * 0.4);
      if (this.o2 <= 0 && !g.god) { this.drowned = true; this.armor = 0; this.hurt(this.hp + 50); }
    } else this.o2 = Math.min(1, this.o2 + dt / O2_REFILL);
    if (this.state === 'swim' && !this._swimHint) { this._swimHint = true; g.ui?.setHint(g.input.device === 'pad' ? 'Im Wasser: B halten = tauchen · A = auftauchen' : 'Im Wasser: C halten = tauchen · Leertaste = auftauchen'); }
  }

  // Ausdauer verbrauchen bzw. auffüllen (nur echtes Sprinten zu Fuß zählt)
  _stamina(dt) {
    const running = this.sprinting && !this.vehicle && this.alive && this.state === 'ground' && this.speedH > 1.5;
    if (running && !this.game.god) {
      this.stamina = Math.max(0, this.stamina - dt / STAMINA_SPRINT);
      this.staminaWait = STAMINA_PAUSE;
      if (this.stamina <= 0) this.exhausted = true;
      return;
    }
    if (this.staminaWait > 0) { this.staminaWait -= dt; return; }
    this.stamina = Math.min(1, this.stamina + dt / (this.exhausted ? STAMINA_RECOVER : STAMINA_REGEN));
    if (this.exhausted && this.stamina >= 1) this.exhausted = false;
  }

  handleInput(dt, input) {
    const g = this.game;
    const I = this.intent;
    const m = input.mouse;
    const pad = input.pad;
    // Kamera: Maus + rechter Stick (der Stick wählt stattdessen aus, solange Waffenrad oder Fahrzeugmenü offen sind)
    const sens = 0.0023 * input.sens * (this.aiming ? (this.weapon?.zoom ? 0.35 : 0.7) : 1);
    let dyaw = -m.dx * sens, dpitch = (input.invertY ? m.dy : -m.dy) * sens;
    const look = pad.active && !g.ui?.padui?.usesRightStick;
    if (look) {
      const slow = this.aiming || this.sidearm ? (this.weapon?.zoom ? 0.35 : 0.65) : 1;   // beim Zielen feiner
      dyaw -= pad.rx * dt * 2.4 * slow; dpitch -= pad.ry * dt * 1.8 * slow * (input.invertY ? -1 : 1);
    }
    if (Math.abs(m.dx) + Math.abs(m.dy) > 0.5 || (look && (pad.rx || pad.ry))) this.idleCam = 0; else this.idleCam += dt;
    this.camYaw += dyaw;
    this.camPitch = clamp(this.camPitch + dpitch, -1.25, 1.2);
    if (this.camYaw > Math.PI) this.camYaw -= Math.PI * 2; else if (this.camYaw < -Math.PI) this.camYaw += Math.PI * 2;

    // Waffenwechsel
    if (!this.vehicle) {
      for (let i = 1; i <= 8; i++) if (input.hit('Digit' + i)) { const id = WEAPON_ORDER[i - 1]; if (this.hasWeapon(id)) this.setWeapon(id); }
      if (m.wheel) {
        const owned = WEAPON_ORDER.filter((id) => this.hasWeapon(id));
        const i = owned.indexOf(this.cur);
        this.setWeapon(owned[(i + (m.wheel > 0 ? 1 : -1) + owned.length) % owned.length]);
      }
    }

    if (this.vehicle) { this._resetPadFoot(); this.driveInput(dt, input); return; }
    if (this.climb) { this._resetPadFoot(); I.mx = I.mz = 0; I.speed = 0; I.aim = I.jump = false; this.aiming = false; return; }

    // ----- Zu Fuß -----
    const W = this.weapon;
    const gun = W && !W.melee && !W.thrown && W.model;
    let ix = (input.key('KeyD') ? 1 : 0) - (input.key('KeyA') ? 1 : 0), iz = (input.key('KeyW') ? 1 : 0) - (input.key('KeyS') ? 1 : 0);
    ix += pad.lx; iz -= pad.ly;
    const f = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
    const r = { x: -f.z, z: f.x };
    let mx = f.x * iz + r.x * ix, mz = f.z * iz + r.z * ix;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; }
    I.mx = mx; I.mz = mz;
    I.speed = Math.min(1, mag);
    // Rennen: LS drücken rastet ein, bis der Stick losgelassen oder gezielt wird
    if (input.padHit(PAD.LS)) { this.padSprint = true; this.padCrouch = false; }
    if (mag < 0.3 || this.aiming) this.padSprint = false;
    // Ducken: B schaltet um
    if (input.padHit(PAD.B)) { this.padCrouch = !this.padCrouch; this.padSprint = false; }
    I.sprint = (input.key('ShiftLeft') || input.key('ShiftRight') || this.padSprint) && mag > 0.1 && !this.aiming && !this.exhausted;
    if (I.sprint) this.padCrouch = false;
    I.jump = input.hit('Space');
    I.crouch = input.key('KeyC') || this.padCrouch;
    // Im Wasser: tauchen und auftauchen statt springen und ducken
    if (this.state === 'swim') {
      const down = input.key('KeyC') || input.key('ControlLeft') || input.padDown(PAD.B);
      const up = input.key('Space') || input.padDown(PAD.A);
      const maxD = Math.max(0, -1.0 - (g.physics.groundHeight(this.x, this.z) + 0.35));
      const d0 = this.diveDepth;
      if (down) this.diveDepth = Math.min(maxD, this.diveDepth + dt * DIVE_DOWN);
      else if (up) this.diveDepth = Math.max(0, this.diveDepth - dt * DIVE_UP);
      else this.diveDepth = Math.max(0, this.diveDepth - dt * BUOYANCY);
      this.diveDir = Math.sign(this.diveDepth - d0);
      I.jump = false; I.crouch = false; this.padCrouch = false;
    }
    // A: springen bzw. klettern – im Nahkampf stattdessen halten = blocken, kurz tippen = ausweichen/kontern
    if (input.padHit(PAD.A)) {
      if (this.state === 'ground' && !I.sprint && g.combat.opponent(this)) this.aT = 0;
      else if (this.state === 'ground' || this.state === 'swim') {
        if (this.tryClimb()) { I.mx = I.mz = 0; I.speed = 0; I.aim = false; this.aiming = false; return; }
        if (this.state === 'ground') { I.jump = true; this.padCrouch = false; I.crouch = input.key('KeyC'); }
      }
    }
    this.blocking = false; this.faceLock = null;
    if (this.aT !== null) {
      if (input.padDown(PAD.A)) { this.aT += dt; this.blocking = this.state === 'ground'; }
      else { if (this.aT < TAP) g.combat.evade(this, mx, mz); this.aT = null; }
    }
    if (this.blocking) {
      const foe = g.combat.opponent(this);
      if (foe) this.faceLock = Math.atan2(foe.x - this.x, foe.z - this.z);
      I.mx *= 0.5; I.mz *= 0.5; I.speed = Math.min(I.speed, 0.5); I.sprint = false; I.jump = false;
    }
    if (this.dodgeT > 0) { I.mx = this.dodgeDir.x; I.mz = this.dodgeDir.z; I.speed = 1; I.sprint = true; I.jump = false; this.faceLock = this.h; }
    // X: tippen = Schlag/Tritt, halten = schwerer Angriff
    if (input.padHit(PAD.X)) this.xT = 0;
    if (this.xT !== null) {
      if (input.padDown(PAD.X)) { this.xT += dt; if (this.xT >= HEAVY_HOLD) { g.combat.strike(this, 'heavy'); this.xT = null; } }
      else { g.combat.strike(this, 'light'); this.xT = null; }
    }
    // Zielen
    const guarded = this.blocking || this.dodgeT > 0;
    const trigger = input.padHit(PAD.RT);
    const wantAim = (input.mouseDown(2) || pad.lt > 0.4) && (gun || W?.thrown);
    const wantFire = (input.mouseDown(0) || input.padDown(PAD.RT)) && !guarded && !this.nozzle;
    this.aiming = !!(wantAim || (wantFire && gun)) && !guarded;
    I.aim = this.aiming;
    if (this.aiming) this.computeAim();
    else { I.ax = f.x; I.az = f.z; I.ay = 0; }
    // Schießen / Angreifen
    if (wantFire) {
      if (W.melee) { if (input.mouseHit(0) || input.mouse.buttons & 1 || trigger) g.combat.tryFire(this); }
      else if (W.thrown) { if (input.mouseHit(0) || input.mouseHit(2) || trigger) { I.aim = true; this.computeAim(); g.combat.tryFire(this); } }
      else if (W.auto || input.mouseHit(0) || trigger) g.combat.tryFire(this);
    }
    if (input.hit('KeyR')) this.reload();
    if (input.hit('KeyF') || input.padHit(PAD.Y)) g.interact();
    if (this.state === 'swim') { I.sprint = false; }
    // Sprint-Kamera
    this.sprinting = I.sprint;
  }

  // ----- Klettern -----
  // Niedrige Hindernisse (Mauern, Felsen, stehende Fahrzeuge, bis gut 2 m) überklettern oder auf eine Kante (Kai, Steg,
  // Geländeabsatz) steigen. Liefert true, wenn die Figur losklettert.
  tryClimb() {
    const g = this.game, phys = g.physics, I = this.intent;
    const m = Math.hypot(I.mx, I.mz);
    const dx = m > 0.3 ? I.mx / m : Math.sin(this.h), dz = m > 0.3 ? I.mz / m : Math.cos(this.h);
    const at = (d) => ({ x: this.x + dx * d, z: this.z + dz * d });
    // höchste Oberkante der Hindernisse an dieser Stelle (null = frei)
    const obstacle = ({ x, z }) => {
      let top = null;
      phys.pushCircle({ x, z }, 0.3, this.y + 0.35, this.y + 2.2, (c) => { top = Math.max(top ?? -1e9, c.y1); });
      for (const v of g.vehicles.list) {
        if (!v.alive || Math.abs(v.speed) > 1.5 || v.y > this.y + 2 || v.y + v.height < this.y + 0.35) continue;
        const ex = x - v.x, ez = z - v.z;
        const along = ex * Math.sin(v.h) + ez * Math.cos(v.h), side = ex * Math.cos(v.h) - ez * Math.sin(v.h);
        if (Math.abs(along) < v.hl + 0.25 && Math.abs(side) < v.hw + 0.25) top = Math.max(top ?? -1e9, v.y + v.height);
      }
      return top;
    };
    const standable = (p, y) => !phys.pushCircle({ x: p.x, z: p.z }, this.radius, y + 0.2, y + 1.8);

    // 1) Über ein Hindernis: dahinter muss Platz sein
    for (let d = 0.35; d <= 1.2; d += 0.2) {
      let peak = obstacle(at(d));
      if (peak === null) continue;
      for (let e = d + 0.3; e <= d + 3.4 && peak - this.y <= 2.2; e += 0.2) {
        const p = at(e), top = obstacle(p);
        if (top !== null) { peak = Math.max(peak, top); continue; }
        const y = phys.groundHeight(p.x, p.z);
        if (y - this.y > 1 || this.y - y > 2.5) return false;
        if (standable(p, y)) { this._startClimb({ x: p.x, y, z: p.z }, peak - 0.25, false); return true; }
      }
      return false;
    }
    // 2) Auf eine Kante: der Boden vor der Figur liegt deutlich höher
    for (let d = 0.5; d <= 1.35; d += 0.2) {
      const q = at(d);
      if (phys.groundHeight(q.x, q.z) - this.y < 0.7) continue;
      const p = at(d + 0.35), y = phys.groundHeight(p.x, p.z), rise = y - this.y;
      if (rise < 0.7 || rise > 2.4 || !standable(p, y)) return false;
      this._startClimb({ x: p.x, y, z: p.z }, y, true);
      return true;
    }
    return false;
  }

  _startClimb(to, peak, ledge) {
    const height = Math.max(0.6, (ledge ? to.y : peak) - this.y);
    this.climb = { t: 0, dur: 0.45 + height * 0.25, from: { x: this.x, y: this.y, z: this.z }, to, peak, ledge };
    this.h = Math.atan2(to.x - this.x, to.z - this.z);
    this.state = 'ground'; this.vy = 0; this.padCrouch = false; this.padSprint = false;
    this.game.audio?.throwSound(this);
  }

  // Zielpunkt aus der Bildmitte
  computeAim() {
    const g = this.game, cam = g.camera;
    cam.getWorldDirection(_d);
    const hit = g.rayFirst(cam.position, _d, 260, this);
    const dist = hit ? hit.t : 160;
    this.aimPoint.copy(cam.position).addScaledVector(_d, dist);
    const mp = this.muzzlePos({});
    // Richtung von der Waffe zum Zielpunkt
    const I = this.intent;
    let ax = this.aimPoint.x - mp.x, ay = this.aimPoint.y - mp.y, az = this.aimPoint.z - mp.z;
    const l = Math.hypot(ax, ay, az) || 1;
    ax /= l; ay /= l; az /= l;
    // Waffenursprung hängt von der intent-Richtung ab → zweite Näherung
    I.ax = ax; I.ay = ay; I.az = az;
    const mp2 = this.muzzlePos({});
    ax = this.aimPoint.x - mp2.x; ay = this.aimPoint.y - mp2.y; az = this.aimPoint.z - mp2.z;
    const l2 = Math.hypot(ax, ay, az) || 1;
    I.ax = ax / l2; I.ay = ay / l2; I.az = az / l2;
    this.aimTarget = hit && hit.kind === 'char' ? hit.target : null;
  }

  // ----- Fahrzeuge -----
  driveInput(dt, input) {
    const v = this.vehicle;
    const c = v.ctl;
    const pad = input.pad;
    const k = (code) => (input.key(code) ? 1 : 0);
    const b = (i) => (input.padDown(i) ? 1 : 0);
    const up = k('KeyW') + pad.rt, down = k('KeyS') + pad.lt;
    const left = k('KeyA') + Math.max(0, -pad.lx), right = k('KeyD') + Math.max(0, pad.lx);
    const cls = v.cls;
    c.handbrake = false; c.brake = 0;
    if (cls === 'plane') {
      c.pitch = clamp(k('KeyS') - k('KeyW') + pad.ly, -1, 1);
      c.roll = clamp(right - left, -1, 1);
      c.yaw = clamp(k('KeyQ') - k('KeyE') + b(PAD.LB) - b(PAD.RB), -1, 1);
      c.lift = clamp(k('ShiftLeft') - k('KeyX') + pad.rt - pad.lt, -1, 1);
      c.brake = input.key('Space') || b(PAD.A) ? 1 : 0;
      c.steer = left - right; // Bodenlenkung (positiv = links)
    } else if (cls === 'heli') {
      c.pitch = clamp(k('KeyW') - k('KeyS') - pad.ly, -1, 1);
      c.roll = clamp(k('KeyE') - k('KeyQ') + pad.lx, -1, 1);
      c.yaw = clamp(k('KeyD') - k('KeyA') + b(PAD.RB) - b(PAD.LB), -1, 1);
      c.lift = clamp(k('Space') - k('ShiftLeft') + pad.rt - pad.lt, -1, 1);
    } else {
      c.throttle = clamp(up - down, -1, 1);
      c.steer = clamp(left - right, -1, 1);
      c.handbrake = input.key('Space') || input.padDown(PAD.A);
      if (input.key('ShiftLeft') && cls === 'bike') c.throttle = Math.max(c.throttle, 0.9);
      // Ein abgestellter Motor (Fahrzeugmenü) springt beim Gasgeben wieder an
      if (!v.engineOn && Math.abs(c.throttle) > 0.1 && !v.burning && !v.exploded) v.engineOn = true;
    }
    if (input.hit('KeyH') || input.padHit(PAD.LS)) v.horn = 0.4;
    if (input.key('KeyH') || input.padDown(PAD.LS)) this.game.audio?.horn(v);
    if (input.hit('KeyL')) v.lightsOn = !v.lightsOn;
    if (input.hit('KeyF') || input.padHit(PAD.Y)) { this.game.exitVehicle(this); if (!this.vehicle) return; }
    // Radio
    if (cls !== 'plane' && cls !== 'heli') {
      if (input.hit('KeyE')) this.game.radio?.next(1);
      if (input.hit('KeyQ')) this.game.radio?.next(-1);
    }
    // Schießen aus dem Fahrzeug (Controller): LB zieht die Seitenwaffe (nochmal: wechseln bzw. wegstecken), RB schießt
    this.aiming = false; this.intent.aim = false;
    if (cls !== 'plane' && cls !== 'heli') {
      if (input.padHit(PAD.LB) || (input.padHit(PAD.RB) && !this.sidearm)) this.cycleSidearm();
      if (this.sidearm) this.driveBy(input.padDown(PAD.RB), input.padHit(PAD.RB));
    }
    if (input.hit('KeyV')) this.firstPerson = !this.firstPerson;
    if (input.hit('KeyX') && cls === 'car') { /* Rückblick */ }
    // Hupe/Sirene bei Polizei
    if (v.type === 'police' && input.hit('KeyG')) v.sirenOn = !v.sirenOn;
    // Gabelstapler: Gabeln heben mit Q/E
  }

  // Seitenwaffe im Fahrzeug: Pistole → Maschinenpistole → weggesteckt
  cycleSidearm() {
    const list = SIDEARMS.filter((id) => { const w = this.weapons[id]; return w && w.mag + w.reserve > 0; });
    if (!list.length && !this.sidearm) { this.game.ui?.notify('Keine Seitenwaffe mit Munition (Pistole oder Maschinenpistole)', 'warn'); return; }
    const next = list[list.indexOf(this.sidearm) + 1];
    if (!next) { this.holsterSidearm(); return; }
    if (!this.sidearm) this.footWeapon = this.cur;
    this.sidearm = next;
    this.setWeapon(next);
    this.game.ui?.notify(`Seitenwaffe: ${WEAPONS[next].name}`, 'info', 1600);
  }

  holsterSidearm() {
    if (!this.sidearm) return;
    this.sidearm = null; this.intent.aim = false; this.aimTarget = null;
    this.setWeapon(this.footWeapon || 'fists');
  }

  // Zielen über die Bildmitte; Dauerfeuer bei der Maschinenpistole, sonst ein Schuss je Tastendruck
  driveBy(fire, pressed) {
    if (fire) this.idleCam = 0;
    this.computeAim();
    this.intent.aim = true;
    if (fire && (this.weapon.auto || pressed)) this.game.combat.tryFire(this);
  }

  // ----- Kamera -----
  updateCamera(dt) {
    const g = this.game, cam = g.camera, phys = g.physics;
    const v = this.vehicle;
    let targetY = this.y + 1.55 - (this.crouch ? 0.35 : 0) - (this.state === 'swim' ? 0.2 : 0);
    let tx = this.x, tz = this.z;
    let dist = 3.9, shoulder = 0, fov = 62, pitchOff = 0;
    if (v) {
      const sp = Math.abs(v.speed);
      tx = v.x; tz = v.z;
      targetY = v.y + (v.cls === 'plane' || v.cls === 'heli' ? 1.8 : v.height * 0.55 + 0.4);
      dist = (v.hl * 1.35 + 3.4) * (v.cls === 'plane' ? 2.8 : v.cls === 'heli' ? 2.2 : v.cls === 'boat' ? 1.3 : 1);
      dist *= 1 + clamp(sp / 120, 0, 0.35);
      fov = 62 + clamp(sp / 70, 0, 1) * 18;
      // Nach kurzer Ruhe hinter das Fahrzeug zurückschwenken
      const behind = v.h;
      const follow = v.cls === 'plane' || v.cls === 'heli' ? 0.9 : clamp((this.idleCam - (this.sidearm ? 3 : 0.7)) * 1.2, 0, 1) * (Math.abs(v.speed) > 1.5 ? 1 : 0.15);
      if (follow > 0) {
        // Bei Rückwärtsfahrt hinter dem Fahrzeug bleiben (Kamera schaut in Fahrtrichtung der Karosserie)
        this.camYaw = dampAngle(this.camYaw, behind, 2.2 * follow, dt);
        this.camPitch = damp(this.camPitch, v.cls === 'plane' ? -0.05 : -0.16, 1.5 * follow, dt);
      }
    } else if (this.aiming) {
      dist = this.weapon?.zoom ? 0.6 : 1.9; shoulder = this.weapon?.zoom ? 0 : 0.62; fov = this.weapon?.zoom ? 62 / this.weapon.zoom : 50; targetY += 0.05;
    } else if (this.sprinting) { fov = 68; dist = 4.2; }
    this.smoothDist = damp(this.smoothDist, dist, 7, dt);
    this.fov = damp(this.fov, fov, 6, dt);
    const cy = this.camYaw, cp = this.camPitch + this.recoil * 1.2;
    const f = _v.set(Math.sin(cy) * Math.cos(cp), Math.sin(cp), Math.cos(cy) * Math.cos(cp));
    const right = { x: -Math.cos(cy), z: Math.sin(cy) };
    const target = new THREE.Vector3(tx + right.x * shoulder, targetY, tz + right.z * shoulder);
    const want = target.clone().addScaledVector(f, -this.smoothDist);
    // Kollisionsprüfung der Kamera
    const dir = want.clone().sub(target); const L = dir.length(); dir.normalize();
    let hitD = L;
    const s = phys.raycastStatic({ x: target.x, y: target.y, z: target.z }, { x: dir.x, y: dir.y, z: dir.z }, L + 0.4);
    if (s) hitD = Math.min(hitD, s.t - 0.35);
    const tt = phys.raycastTerrain({ x: target.x, y: target.y, z: target.z }, { x: dir.x, y: dir.y, z: dir.z }, L + 0.3, 1.0);
    if (tt !== null) hitD = Math.min(hitD, tt - 0.3);
    hitD = Math.max(0.5, hitD);
    // Kamera darf nicht durch Fahrzeug im Weg schauen: ignorieren
    const pos = target.clone().addScaledVector(dir, hitD);
    // Nicht unter den Boden / das Wasser
    const gh = phys.groundHeight(pos.x, pos.z);
    pos.y = Math.max(pos.y, gh + 0.45, this.diveDepth > 0.3 ? -60 : 0.4);   // beim Tauchen darf die Kamera mit unter Wasser
    if (!this.camInit) { this.camPos.copy(pos); this.camInit = true; } else {
      const k = 1 - Math.exp(-(hitD < L ? 30 : 16) * dt);
      this.camPos.lerp(pos, k);
    }
    // Schütteln
    const sh = g.effects.shake;
    cam.position.copy(this.camPos);
    if (sh > 0.01) cam.position.add(_d.set((Math.random() - 0.5) * sh * 0.35, (Math.random() - 0.5) * sh * 0.35, (Math.random() - 0.5) * sh * 0.35));
    this.camLook.copy(target).addScaledVector(f, 4);
    cam.lookAt(this.camLook.x, target.y + Math.tan(0) + (this.camLook.y - target.y), this.camLook.z);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
