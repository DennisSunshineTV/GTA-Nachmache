// Spieler: Steuerung zu Fuß und in Fahrzeugen, Zielen, Kamera.
import * as THREE from 'three';
import { Character } from './character.js';
import { WEAPON_ORDER, WEAPONS } from '../combat/weapons.js';
import { clamp, lerp, damp, dampAngle, wrapPi } from '../util.js';

const _v = new THREE.Vector3(), _d = new THREE.Vector3();

export class Player extends Character {
  constructor(game, x, z, who = 'jason') {
    super(game, 'player', x, z, { outfit: who === 'lucia' ? 'player_lucia' : 'player_jason', name: who === 'lucia' ? 'Lucia' : 'Jason', hp: 200, heading: 0 });
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
  }

  update(dt, input) {
    const g = this.game;
    if (this.alive && g.controlsEnabled) this.handleInput(dt, input);
    else { this.intent.mx = this.intent.mz = 0; this.intent.fire = false; this.intent.aim = false; this.intent.speed = 0; if (this.vehicle) { const c = this.vehicle.ctl; c.throttle = 0; c.brake = 0.6; c.steer = 0; } }
    super.update(dt);
    this.recoil = Math.max(0, this.recoil - dt * 0.35);
  }

  handleInput(dt, input) {
    const g = this.game;
    const I = this.intent;
    const m = input.mouse;
    const pad = input.pad;
    // Kamera: Maus + rechter Stick
    const sens = 0.0023 * input.sens * (this.aiming ? (this.weapon?.zoom ? 0.35 : 0.7) : 1);
    let dyaw = -m.dx * sens, dpitch = (input.invertY ? m.dy : -m.dy) * sens;
    if (pad.active) { dyaw -= pad.rx * dt * 2.4; dpitch -= pad.ry * dt * 1.8 * (input.invertY ? -1 : 1); }
    if (Math.abs(m.dx) + Math.abs(m.dy) > 0.5 || (pad.active && (pad.rx || pad.ry))) this.idleCam = 0; else this.idleCam += dt;
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
      if (pad.active && pad.btnPressed.has(5)) { const owned = WEAPON_ORDER.filter((id) => this.hasWeapon(id)); const i = owned.indexOf(this.cur); this.setWeapon(owned[(i + 1) % owned.length]); }
    }

    if (this.vehicle) { this.driveInput(dt, input); return; }

    // ----- Zu Fuß -----
    const W = this.weapon;
    const gun = W && !W.melee && !W.thrown && W.model;
    let ix = (input.key('KeyD') ? 1 : 0) - (input.key('KeyA') ? 1 : 0), iz = (input.key('KeyW') ? 1 : 0) - (input.key('KeyS') ? 1 : 0);
    if (pad.active) { ix += pad.lx; iz -= pad.ly; }
    const f = { x: Math.sin(this.camYaw), z: Math.cos(this.camYaw) };
    const r = { x: -f.z, z: f.x };
    let mx = f.x * iz + r.x * ix, mz = f.z * iz + r.z * ix;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; }
    I.mx = mx; I.mz = mz;
    I.speed = Math.min(1, mag);
    I.sprint = (input.key('ShiftLeft') || input.key('ShiftRight') || (pad.active && pad.btn.has(10))) && mag > 0.1 && !this.aiming;
    I.jump = input.hit('Space') || (pad.active && pad.btnPressed.has(0));
    I.crouch = input.key('KeyC');
    // Zielen
    const wantAim = (input.mouseDown(2) || (pad.active && pad.lt > 0.4)) && (gun || W?.thrown);
    const wantFire = input.mouseDown(0) || (pad.active && pad.rt > 0.4);
    this.aiming = !!(wantAim || (wantFire && gun));
    I.aim = this.aiming;
    if (this.aiming) this.computeAim();
    else { I.ax = f.x; I.az = f.z; I.ay = 0; }
    // Schießen / Angreifen
    if (wantFire) {
      if (W.melee) { if (input.mouseHit(0) || input.mouse.buttons & 1) g.combat.tryFire(this); }
      else if (W.thrown) { if (input.mouseHit(0) || input.mouseHit(2)) { I.aim = true; this.computeAim(); g.combat.tryFire(this); } }
      else if (W.auto || input.mouseHit(0) || (pad.active && pad.rt > 0.4)) g.combat.tryFire(this);
    }
    if (input.hit('KeyR')) this.reload();
    if (input.hit('KeyF')) g.interact();
    if (this.state === 'swim') { I.sprint = false; }
    // Sprint-Kamera
    this.sprinting = I.sprint;
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
    const up = k('KeyW') + (pad.active ? pad.rt : 0), down = k('KeyS') + (pad.active ? pad.lt : 0);
    const left = k('KeyA') + (pad.active ? Math.max(0, -pad.lx) : 0), right = k('KeyD') + (pad.active ? Math.max(0, pad.lx) : 0);
    const cls = v.cls;
    c.handbrake = false; c.brake = 0;
    if (cls === 'plane') {
      c.pitch = (k('KeyS') - k('KeyW')) + (pad.active ? -pad.ly : 0) * -1;
      c.roll = right - left;
      c.yaw = k('KeyQ') - k('KeyE');
      c.lift = (input.key('ShiftLeft') ? 1 : 0) - (input.key('KeyX') ? 1 : 0);
      c.brake = input.key('Space') ? 1 : 0;
      c.steer = left - right; // Bodenlenkung (positiv = links)
    } else if (cls === 'heli') {
      c.pitch = k('KeyW') - k('KeyS');
      c.roll = k('KeyE') - k('KeyQ');
      c.yaw = right - left;
      c.lift = (input.key('Space') ? 1 : 0) - (input.key('ShiftLeft') ? 1 : 0) + 0.0;
    } else {
      c.throttle = clamp(up - down, -1, 1);
      c.steer = clamp(left - right, -1, 1);
      c.handbrake = input.key('Space');
      if (cls === 'tank') { c.throttle = clamp(up - down, -1, 1); }
      if (input.key('ShiftLeft') && cls === 'bike') c.throttle = Math.max(c.throttle, 0.9);
    }
    if (input.hit('KeyH')) v.horn = 0.4;
    if (input.key('KeyH')) this.game.audio?.horn(v);
    if (input.hit('KeyL')) v.lightsOn = !v.lightsOn;
    if (input.hit('KeyF')) this.game.exitVehicle(this);
    // Radio
    if (cls !== 'plane' && cls !== 'heli') {
      if (input.hit('KeyE')) this.game.radio?.next(1);
      if (input.hit('KeyQ')) this.game.radio?.next(-1);
    }
    // Waffen aus dem Fahrzeug (Beifahrer-Stil: Pistole/Smg nach vorne bei Bike nicht)
    this.aiming = false; this.intent.aim = false;
    if (input.hit('KeyV')) this.firstPerson = !this.firstPerson;
    if (input.hit('KeyX') && cls === 'car') { /* Rückblick */ }
    // Hupe/Sirene bei Polizei
    if (v.type === 'police' && input.hit('KeyG')) v.sirenOn = !v.sirenOn;
    // Gabelstapler: Gabeln heben mit Q/E
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
      const follow = v.cls === 'plane' || v.cls === 'heli' ? 0.9 : clamp((this.idleCam - 0.7) * 1.2, 0, 1) * (Math.abs(v.speed) > 1.5 ? 1 : 0.15);
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
    pos.y = Math.max(pos.y, gh + 0.45, 0.4);
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
