// Spiel-Kern: verbindet Welt, Spieler, Fahrzeuge, KI, Kampf, UI, Audio und Missionen.
import * as THREE from 'three';
import { Physics } from './core/physics.js';
import { Input } from './core/input.js';
import { Effects } from './combat/effects.js';
import { Combat } from './combat/combat.js';
import { Player } from './entities/player.js';
import { Character } from './entities/character.js';
import { VehicleManager } from './entities/vehicle.js';
import { TrafficManager } from './ai/traffic.js';
import { PedManager } from './ai/peds.js';
import { PoliceManager } from './ai/police.js';
import { Markers, Pickups } from './world/interactives.js';
import { HomeBase } from './world/homebase.js';
import { Services } from './world/servicesrt.js';
import { clamp, wrapPi, fmtMoney } from './util.js';
import { WEATHER_NAMES } from './render/sky.js';
import { WeatherFx } from './render/weatherfx.js';

const VISIBLE_DRIVER = new Set(['moto', 'tractor', 'forklift', 'speedboat', 'jetski', 'excavator']);
const QUALITY_POP = { low: { traffic: 10, parked: 6, peds: 22 }, medium: { traffic: 18, parked: 10, peds: 38 }, high: { traffic: 26, parked: 14, peds: 54 }, ultra: { traffic: 34, parked: 18, peds: 72 } };

export class Game {
  constructor(parts, opts = {}) {
    Object.assign(this, parts); // engine, atm, sea, chunks, ctx, mats, props
    this.scene = this.engine.scene;
    this.camera = this.engine.camera;
    this.opts = opts;
    this.quality = QUALITY_POP[this.engine.qualityKey] || QUALITY_POP.high;
    this.time = 0;
    this.paused = false;
    this.controlsEnabled = true;
    this.characters = [];
    this.money = opts.money ?? 5000;
    this.stats = { kills: 0, distance: 0, crimes: 0, playMs: 0, missionsDone: 0, days: 0, maxWanted: 0 };
    this.timeScale = 1 / 100;   // Spielstunden pro Sekunde (1 Std = 100 s)
    this.god = false; this.godVehicles = false;
    this.wreckMat = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.9, metalness: 0.2 });
    this.owned = { vehicles: [], properties: {}, weapons: {} };

    this.physics = new Physics(this.ctx, this.chunks);
    this.input = new Input(this.engine.canvas);
    this.vehicles = new VehicleManager(this);
    this.effects = new Effects(this);
    this.combat = new Combat(this);
    this.markers = new Markers(this);
    this.pickups = new Pickups(this);

    // Detail-Chunks → Kollider registrieren
    this.chunks.onDetailLoaded = (chunk) => this.physics.addColliders(chunk.detail.colliders);
    this.chunks.onDetailUnloaded = (chunk) => this.physics.removeColliders(chunk.detail.colliders);
    this.physics.addPlatforms(this.ctx.platforms);   // Stege tragen von Anfang an, auch außerhalb geladener Kacheln
    this.home = new HomeBase(this);                  // Strandhaus: Böden, Haustür, Garagentor, eigene Fahrzeuge
    this.services = new Services(this);              // Tankstellen (Zapfpistole) und Werkstätten (Tor, Reparatur)

    this.fx = new WeatherFx(this);
    this.traffic = new TrafficManager(this);
    this.peds = new PedManager(this);
    this.police = new PoliceManager(this);
    this.player = null;
    this.ui = null; this.audio = null; this.radio = null; this.missions = null;
    this._ctxChars = null;
    this._frame = 0;
    this.lastRegion = '';
  }

  // ---------- Start ----------
  // Neues Spiel: Start am eigenen Strandhaus (auf der Terrasse vor der Tür, Blick aufs Meer);
  // ohne Strandhaus am Hafen von Palma. Spielstände starten dort, wo gespeichert wurde.
  startPosition() {
    const home = this.ctx.home;
    if (home) return { x: home.door.x, z: home.door.z, heading: home.rot, road: null };
    const poi = this.ctx.pois.find((p) => p.id === 'palma.harbor') || this.ctx.pois.find((p) => p.type === 'city');
    const nr = this.ctx.net.nearest(poi.x, poi.z, 250, (r) => r.kind === 'promenade' || r.kind === 'street');
    const x = nr ? nr.x : poi.x, z = nr ? nr.z : poi.z;
    return { x, z, heading: nr ? Math.atan2(nr.road.pts[Math.min(nr.i + 1, nr.road.pts.length - 1)][0] - nr.road.pts[nr.i][0], nr.road.pts[Math.min(nr.i + 1, nr.road.pts.length - 1)][1] - nr.road.pts[nr.i][1]) : 0, road: nr };
  }

  // Multiplayer: Start am Hafen von Palma, jeder Spieler an einer eigenen Stelle entlang der Promenade
  mpStartPosition(id = 0) {
    const poi = this.ctx.pois.find((p) => p.id === 'palma.harbor') || this.ctx.pois.find((p) => p.type === 'city');
    const nr = this.ctx.net.nearest(poi.x, poi.z, 250, (r) => r.kind === 'promenade' || r.kind === 'street');
    if (!nr) return { x: poi.x, z: poi.z, heading: 0, road: null };
    const r = nr.road, s = Math.max(5, Math.min(r.len - 5, r.cum[nr.i] + ((id % 9) - 4) * 3.5));
    const p = this.ctx.net.pointAt(r, s, {});
    const side = (r.w / 2 + Math.max(1, r.sw) * 0.5);
    return { x: p.x - p.dz * side, z: p.z + p.dx * side, heading: Math.atan2(p.dx, p.dz), road: nr };
  }

  createPlayer(who, pos) {
    const p = new Player(this, pos.x, pos.z, who);
    p.h = pos.heading || 0;
    p.camYaw = p.h;
    p.ensureHuman();
    this.player = p;
    this.addCharacter(p);
    return p;
  }

  addCharacter(c) { this.characters.push(c); this._ctxChars = null; }
  removeCharacter(c) {
    const i = this.characters.indexOf(c);
    if (i >= 0) this.characters.splice(i, 1);
    c.dispose?.();
    this._ctxChars = null;
  }
  allCharacters() { return this.characters; }

  roadNear(x, z, r) { const n = this.ctx.net.nearest(x, z, r); return n; }

  rayFirst(origin, dir, maxT, ignore = null) {
    const o = { x: origin.x, y: origin.y, z: origin.z }, d = { x: dir.x, y: dir.y, z: dir.z };
    const r = this.combat.castRay(ignore || this.player, o, d, maxT);
    return r.kind ? r : null;
  }

  addMoney(n) { this.money = Math.max(0, this.money + n); this.ui?.moneyChanged?.(n); }
  spend(n) { if (this.money < n) return false; this.money -= n; this.ui?.moneyChanged?.(-n); return true; }

  // ---------- Fahrzeuge betreten / verlassen ----------
  enterVehicle(ch, v, seat = 0) {
    if (!v.alive || v.exploded || v.burning > 0) return false;
    if (ch.isPlayer && ch.nozzle) this.services.release();
    // Eigene Fahrzeuge (in der Garage geparkt oder gekauft) lösen nie eine Fahndung aus
    const own = ch.isPlayer && v.ownedIdx != null;
    if (seat === 0 && v.driver && v.driver !== ch) {
      this.ejectDriver(v, true);
      if (ch.isPlayer && !own) this.police.crime('carjack', ch, v.x, v.z);
    }
    ch.state = 'vehicle'; ch.vehicle = v; ch.seat = seat;
    ch.intent.mx = ch.intent.mz = 0;
    if (seat === 0) v.driver = ch; else v.passengers.push(ch);
    if (ch.isPlayer) {
      this.traffic.release(v);
      v.owner = 'player'; v.engineOn = true; v.ai = null; v.locked = false;
      v.ctl.throttle = 0; v.ctl.brake = 0;
      ch.showInVehicle = VISIBLE_DRIVER.has(v.type);
      ch.camYaw = v.h; ch.idleCam = 10;
      ch.lastVehicle = v;
      ch.aiming = false;
      this.ui?.vehicleEntered?.(v);
      this.audio?.enterVehicle(v);
      this.radio?.onEnter(v);
      if (v.type === 'police' && !own) this.police.crime('copCar', ch, v.x, v.z);
      if (own) this.ui?.notify('Dein eigenes Fahrzeug', 'info');
      if (v.cls === 'plane') v.airSpeed = Math.max(v.airSpeed || 0, 0);
    } else ch.showInVehicle = false;
    this.missions?.onEnterVehicle?.(ch, v);
    return true;
  }

  // Beifahrer-/Fahrer-Platz für Nicht-Spieler hinzufügen (Missionen)
  seatNpc(ch, v, seat = 1) {
    ch.state = 'vehicle'; ch.vehicle = v; ch.seat = seat; ch.showInVehicle = false; ch.ai = null;
    if (seat === 0) v.driver = ch; else v.passengers.push(ch);
  }

  _freeSpot(v, side) {
    const d = v.doorWorld(side, {});
    for (let k = 0; k < 4; k++) {
      const pos = { x: d.x + (k - 1) * Math.sin(v.h) * 0.8, z: d.z + (k - 1) * Math.cos(v.h) * 0.8 };
      const g0 = this.physics.groundHeight(pos.x, pos.z);
      if (g0 < -1.2 && v.cls !== 'boat') continue;
      const test = { x: pos.x, z: pos.z };
      const hit = this.physics.pushCircle(test, 0.4, g0 + 0.2, g0 + 1.8);
      if (!hit) return pos;
    }
    return { x: d.x, z: d.z };
  }

  exitVehicle(ch, forced = false) {
    const v = ch.vehicle;
    if (!v) return;
    if (ch.isPlayer && !forced) {
      // In der Luft/zu schnell: nur Schaden beim Abspringen, Flugzeuge in der Luft nicht verlassen
      if ((v.cls === 'plane' || v.cls === 'heli') && v.y > this.physics.groundHeight(v.x, v.z) + 4) { this.ui?.notify('Du kannst in der Luft nicht aussteigen', 'warn'); return; }
    }
    const spot = this._freeSpot(v, 1);
    if (v.cls === 'boat') {
      // Aus dem Boot ins Wasser/aufs Dock
    }
    ch.state = 'ground'; ch.vehicle = null;
    ch.x = spot.x; ch.z = spot.z; ch.y = Math.max(this.physics.groundHeight(spot.x, spot.z), v.cls === 'boat' ? -1 : -9);
    ch.vx = v.vx * 0.3; ch.vz = v.vz * 0.3;
    if (v.driver === ch) v.driver = null; else { const i = v.passengers.indexOf(ch); if (i >= 0) v.passengers.splice(i, 1); }
    if (ch.noHuman) { ch.noHuman = false; ch.ensureHuman(); }
    if (Math.abs(v.speed) > 12 && !forced) ch.hurt((Math.abs(v.speed) - 11) * 4);
    if (ch.isPlayer) {
      v.ctl.throttle = 0; v.ctl.steer = 0; v.ctl.brake = 0.6; v.engineOn = false; v.sirenOn = false;
      v.owner = 'abandoned';
      ch.holsterSidearm();
      this.ui?.vehicleExited?.(v);
      this.audio?.exitVehicle(v);
      this.radio?.onExit();
      ch.camYaw = ch.h = v.h; ch.showInVehicle = false;
    }
    ch.h = v.h;
  }

  // Fahrer wird aus dem Wagen geholt (Carjacking) oder flieht
  ejectDriver(v, carjack) {
    const d = v.driver;
    if (!d) return;
    v.driver = null;
    d.vehicle = null; d.state = 'ground';
    const spot = this._freeSpot(v, 1);
    d.x = spot.x; d.z = spot.z; d.y = this.physics.groundHeight(spot.x, spot.z);
    d.noHuman = false; d.isDriver = false; d.showInVehicle = false;
    d.ensureHuman();
    d.outfitKind === 'cop' || d.kind === 'cop' ? null : this.peds.adopt(d);
    if (d.kind !== 'cop') {
      d.ai.mode = Math.random() < 0.3 && carjack ? 'fight' : 'flee';
      d.ai.target = this.player; d.ai.from = this.player; d.ai.t = 12;
      d.say(carjack ? ['¡Mi coche!', 'Hey! Mein Auto!', 'Du Dieb!', '¡Ladrón!'][Math.floor(Math.random() * 4)] : '¡Ayuda!', 3);
    }
    this.traffic.release(v);
    v.owner = 'abandoned';
  }

  eject(v, driver) { // wegen Zerstörung
    if (driver && driver.vehicle === v) this.exitVehicle(driver, true);
  }

  // ---------- Interaktion ----------
  interact() {
    const p = this.player;
    if (!p.alive) return;
    if (this.services.interact(p)) return;
    const m = this.markers.interactable(p);
    if (m) { m.onInteract(m); return; }
    const v = this.vehicles.nearest(p.x, p.z, 3.7, (q) => q.alive && !q.exploded && q.burning <= 0 && !(q.driver && q.driver.isPlayer) && (q.cls !== 'plane' || q.y < this.physics.groundHeight(q.x, q.z) + 4));
    if (v) {
      if (v.locked) { this.ui?.notify('Das Fahrzeug ist verschlossen', 'warn'); return; }
      this.enterVehicle(p, v);
      return;
    }
    // Passanten ansprechen
    for (const c of this.peds.list) {
      if (!c.alive || Math.hypot(c.x - p.x, c.z - p.z) > 2.4) continue;
      this.ui?.bubble(c, ['Hallo!', 'Buenos días!', 'Schönen Tag!', '¡Hola, guapo!', 'Haben Sie Feuer?', 'Entschuldigung, wie spät ist es?'][Math.floor(Math.random() * 6)], 3);
      return;
    }
  }

  // Figuren aus Fahrzeugen schieben / von Fahrzeugen getroffen werden
  collideCharacter(ch) {
    if (ch.state === 'vehicle') return;
    for (const v of this.vehicles.list) {
      if (!v.alive) continue;
      const dx = ch.x - v.x, dz = ch.z - v.z;
      const R = Math.max(v.hw, v.hl) + 1;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      if (ch.y > v.y + v.height + 0.4 || ch.y + 1.8 < v.y) continue;
      const fx = Math.sin(v.h), fz = Math.cos(v.h);
      const lf = dx * fx + dz * fz, ll = dx * Math.cos(v.h) - dz * Math.sin(v.h);
      const px = clamp(ll, -v.hw, v.hw), pf = clamp(lf, -v.hl, v.hl);
      const ex = ll - px, ef = lf - pf;
      const d2 = ex * ex + ef * ef;
      const r = ch.radius;
      if (d2 >= r * r && !(Math.abs(ll) < v.hw && Math.abs(lf) < v.hl)) continue;
      // Normale (lokal) → Welt
      let nl, nf, pen;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); nl = ex / d; nf = ef / d; pen = r - d; }
      else { const o1 = v.hw - Math.abs(ll), o2 = v.hl - Math.abs(lf); if (o1 < o2) { nl = Math.sign(ll) || 1; nf = 0; pen = o1 + r; } else { nl = 0; nf = Math.sign(lf) || 1; pen = o2 + r; } }
      const nx = nl * Math.cos(v.h) + nf * fx, nz = -nl * Math.sin(v.h) + nf * fz;
      const rel = (v.vx - ch.vx) * nx * -1 + (v.vz - ch.vz) * nz * -1; // Annäherung des Fahrzeugs
      const sp = Math.hypot(v.vx, v.vz);
      if (sp > 2.8 && ch.alive && !(v === this.player.lastVehicle && ch === this.player && this.player.vehicle)) {
        const dmg = Math.min(220, (sp - 2) * 7);
        ch.vx += v.vx * 0.55 + nx * 3; ch.vz += v.vz * 0.55 + nz * 3;
        if (ch.state === 'ground') { ch.state = 'air'; ch.vy = 2.5 + sp * 0.12; }
        const drv = v.driver;
        ch.hurt(dmg, drv || null);
        v.vx *= 0.94; v.vz *= 0.94;
        if (drv && drv.isPlayer && ch.kind !== 'cop') this.police.crime('hitrun', drv, ch.x, ch.z);
        if (drv && drv.isPlayer && ch.kind === 'cop') this.police.crime('copHit', drv, ch.x, ch.z, true);
        this.audio?.thud(ch.x, ch.y, ch.z);
        if (ch.kind === 'ped' && ch.alive && ch.ai) this.peds.scare(ch, v, 12);
      } else {
        ch.x += nx * pen; ch.z += nz * pen;
        if (ch.kind === 'ped' && v.driver?.isPlayer) this.peds.bump(ch, this.player);
      }
    }
  }

  // ---------- Ereignisse ----------
  onGunshot(shooter, W, loud = 75) {
    const l = W && W.id === 'sniper' ? 130 : W && W.id === 'shotgun' ? 90 : loud;
    this.peds.hearShot(shooter.x, shooter.z, W && !W.melee ? l : 12, shooter);
    if (shooter === this.player) { this.police.crime('shoot', shooter, shooter.x, shooter.z); this.stats.shots = (this.stats.shots || 0) + 1; }
  }

  onCharacterHurt(ch, dmg, source, head) {
    if (ch.kind === 'ped') {
      if (source === this.player) this.police.crime('assault', source, ch.x, ch.z);
      this.peds.hurtReact(ch, source);
    } else if (ch.kind === 'cop') this.police.onCopHurt(ch, source);
    else if (ch.isPlayer) { this.ui?.damaged?.(dmg); this.effects.addShake(Math.min(0.5, dmg / 60)); this.audio?.hurt(); }
    // Einsatz: Feindliche Gruppen reagieren
    if (source === this.player && ch.hostileGroup) this.missions?.onEnemyHurt?.(ch);
  }

  onCharacterKilled(ch, source) {
    if (ch.isPlayer) { this.wasted(); return; }
    if (ch.kind === 'ped') {
      if (ch.cash > 0) this.pickups.spawn('cash', ch.x + (Math.random() - 0.5), ch.z + (Math.random() - 0.5), Math.max(5, Math.floor(ch.cash)));
      if (source === this.player) { this.police.crime('murder', source, ch.x, ch.z); this.stats.kills++; }
    } else if (ch.kind === 'cop') {
      this.police.onCopKilled(ch, source);
      if (source === this.player) this.stats.kills++;
      if (Math.random() < 0.5) this.pickups.spawn('weapon', ch.x, ch.z, 24, { weapon: ch.cur === 'fists' ? 'pistol' : ch.cur });
    } else if (ch.kind === 'enemy') {
      if (source === this.player) this.stats.kills++;
      if (Math.random() < 0.5) this.pickups.spawn('cash', ch.x, ch.z, 40 + Math.floor(Math.random() * 160));
      if (Math.random() < 0.18) this.pickups.spawn('ammo', ch.x + 0.5, ch.z, 40, { weapon: ch.cur });
    }
    this.missions?.onKill?.(ch, source);
  }

  // Harter Unfall: Insassen (Spieler) verlieren etwas Gesundheit – ein Unfall allein tötet nie (Untergrenze 25)
  crashHurt(v, speed) {
    const p = this.player;
    if (!p || !p.alive || (v.driver !== p && !v.passengers.includes(p)) || speed < 7.5 || this.god) return;
    const prot = v.cls === 'bike' ? 1.6 : v.cls === 'tank' ? 0.3 : 1;
    const dmg = Math.min(70, Math.pow(speed - 7.5, 1.25) * 2.2 * prot);
    const floor = Math.min(p.hp, 25);
    p.hp = Math.max(floor, p.hp - dmg);
    this.ui?.damaged(dmg);
  }

  onVehicleCrash(v, speed, other) {
    const p = this.player;
    this.crashHurt(v, speed);
    if (v.driver === p && other && other.owner === 'traffic') {
      if (speed > 6) { this.traffic.panic(other, 8); if (Math.random() < 0.5) this.police.crime('vandal', p, v.x, v.z); }
    }
    if (v.driver === p) { this.effects.addShake(Math.min(0.8, speed / 18)); this.audio?.crash(speed); }
    else if (p.vehicle) { const d = Math.hypot(v.x - p.vehicle.x, v.z - p.vehicle.z); if (d < 40) this.audio?.crash(speed * (1 - d / 60)); }
  }

  onExplosion(x, z, r, source) { if (source === this.player || source?.driver === this.player) this.police.crime('explosion', this.player, x, z, true); this.peds.hearShot(x, z, 110, source); this.missions?.onExplosion?.(x, z, r, source); }

  onWantedChanged(w, up) { if (w > (this.stats.maxWanted || 0)) this.stats.maxWanted = w; this.ui?.wantedChanged?.(w, up); this.missions?.onWanted?.(w); }

  onHeadshot(shooter, target) { if (shooter === this.player) this.ui?.notify('Kopfschuss!', 'info'); }

  // ---------- Tod / Festnahme ----------
  wasted() {
    if (this.dying) return;
    this.dying = true;
    const drowned = this.player?.drowned;
    if (this.player) this.player.drowned = false;
    this.ui?.showOverlay('WASTED', drowned ? 'Ertrunken' : 'Du bist gestorben', 4200);
    this.audio?.wastedSound();
    this.missions?.onPlayerDied?.();
    setTimeout(() => this.respawn('home'), 4300);   // nach dem Tod wacht man im eigenen Haus auf
  }

  busted() {
    if (this.dying) return;
    this.dying = true;
    this.ui?.showOverlay('BUSTED', 'Festgenommen', 3800);
    this.missions?.onPlayerBusted?.();
    setTimeout(() => this.respawn('police'), 4000);
  }

  respawn(where) {
    const p = this.player;
    const fine = Math.min(this.money, where === 'police' ? 500 + Math.floor(this.money * 0.04) : Math.min(2500, Math.floor(this.money * 0.05)));
    this.money -= fine;
    const home = where === 'home' ? this.ctx.home : null;
    let x, z;
    if (home) { x = home.door.x; z = home.door.z; }
    else {
      const poi = this.ctx.pois.find((q) => q.type === (where === 'police' ? 'police' : 'clinic') && q.id.startsWith('palma')) || this.ctx.pois.find((q) => q.type === 'city');
      const nr = this.ctx.net.nearest(poi.x, poi.z, 120);
      x = (nr ? nr.x : poi.x) + 2; z = (nr ? nr.z : poi.z) + 2;
    }
    this.police.clear(true);
    if (p.vehicle) this.exitVehicle(p, true);
    p.alive = true; p.hp = p.maxHp; p.armor = 0; p.state = 'ground'; p.deadT = 0; p.climb = null;
    p.stamina = 1; p.exhausted = false; p.o2 = 1; p.diveDepth = 0;
    this.combat.swings.length = 0;
    p.x = x; p.z = z; p.y = this.physics.groundHeight(x, z); p.vx = p.vz = 0;
    if (home) { p.h = home.rot; p.camYaw = p.h; }   // Blick aufs Meer
    if (p.human) p.human.deadT = 0;
    p.invuln = 2;
    p.camInit = false;
    this.dying = false;
    this.ui?.hideOverlay();
    this.ui?.notify(where === 'police' ? `Strafe bezahlt: ${fmtMoney(fine)}` : home ? `Zu Hause aufgewacht – Behandlungskosten: ${fmtMoney(fine)}` : `Behandlungskosten: ${fmtMoney(fine)}`, 'warn');
    this.missions?.onRespawn?.();
  }

  // Schlafen im eigenen Bett bis zur gewählten Uhrzeit: Bild wird schwarz, die Uhr läuft vor, danach volle Gesundheit.
  // Geht der Schlaf über Mitternacht, beginnt ein neuer Spieltag (Statistik „Tage im Spiel“).
  sleep(hour) {
    if (this.net || this.sleeping) return false;
    const p = this.player, from = this.atm.hour;
    let dh = ((hour - from) % 24 + 24) % 24;
    if (dh < 0.5) dh += 24;
    this.sleeping = true;
    this.controlsEnabled = false;
    this.ui?.sleepOverlay(from, dh, () => {
      if (from + dh >= 24) this.stats.days = (this.stats.days || 0) + 1;
      this.atm.hour = (from + dh) % 24;
      p.hp = p.maxHp; p.stamina = 1; p.exhausted = false;
      this.shops?.advanceHours?.(dh);
      this.weatherT = 0;                 // nach dem Aufwachen kann sich das Wetter geändert haben
      this.controlsEnabled = true;
      this.sleeping = false;
      const hh = Math.floor(this.atm.hour), mm = Math.round((this.atm.hour - hh) * 60);
      this.ui?.banner(hour < 12 ? 'Guten Morgen!' : hour < 18 ? 'Ausgeschlafen' : 'Guten Abend!', `Tag ${(this.stats.days || 0) + 1} · ${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')} Uhr`, 3.2);
      this.ui?.notify('Gut geschlafen – Gesundheit aufgefüllt', 'good');
    });
    return true;
  }

  teleport(x, z, y = null) {
    const p = this.player;
    const v = p.vehicle;
    const gy = y ?? this.physics.groundHeight(x, z);
    p.climb = null;
    if (v) { v.x = x; v.z = z; v.y = gy + 1; v.vx = v.vz = 0; v.speed = 0; if (v.cls === 'plane' || v.cls === 'heli') { v.y = gy + 120; } }
    else { p.x = x; p.z = z; p.y = Math.max(gy, 0); p.vx = p.vz = 0; p.state = 'ground'; }
    p.camInit = false;
    this.chunks.update(this.camera.position.set(x, gy + 5, z));
  }

  // ---------- Hauptschleife ----------
  update(dt) {
    this._frame++;
    const input = this.input;
    input.pollPad();
    const real = Math.min(dt, 0.05);
    this.ui?.padui?.update(real);                 // Controller-Bedienung der Oberfläche (verbraucht ihre Tasten zuerst)
    dt = real * (this.ui?.padui?.slowmo ?? 1);    // Waffenrad und Fahrzeugmenü bremsen die Welt ab
    if (!this.paused) {
      this.time += dt;
      this.physics.time += dt;
      this.stats.playMs += dt * 1000;
      if (this.net) this.net.applyClock(this.atm);        // Multiplayer: Uhrzeit und Wetter kommen vom Server
      else {
        // Spieluhr: um Mitternacht beginnt ein neuer Spieltag (Statistik „Tage im Spiel“)
        let nh = this.atm.hour + dt * this.timeScale * (this.timeFrozen ? 0 : 1);
        if (nh >= 24) { nh -= 24; this.stats.days = (this.stats.days || 0) + 1; }
        this.atm.hour = nh;
        this._weather(dt);
      }
      this.player.update(dt, input);
      // Zurückgelegte Strecke (zu Fuß und im Fahrzeug; Sprünge durch Teleport zählen nicht)
      { const o = this.player.vehicle || this.player; if (this._lp) { const d = Math.hypot(o.x - this._lp.x, o.z - this._lp.z); if (d < 40) this.stats.distance = (this.stats.distance || 0) + d; } this._lp = { x: o.x, z: o.z }; }
      this.vehicles.update(dt);
      this.player.resyncSeat();                       // Spielfigur sitzt auf dem bereits bewegten Fahrzeug
      // Figuren (Spieler aktualisiert sich selbst)
      for (let i = this.characters.length - 1; i >= 0; i--) {
        const c = this.characters[i];
        if (c === this.player) continue;
        c.update(dt);
      }
      this.traffic.update(dt);
      this.peds.update(dt);
      this.police.update(dt);
      this.enemies?.update(dt);
      this.shops?.update(dt);
      this.home.update(dt);
      this.services.update(dt);
      this.combat.update(dt);
      this.markers.update(dt);
      this.pickups.update(dt);
      this.missions?.update(dt);
      this.effects.update(dt);
      this._housekeeping(dt);
      this.audio?.update(dt);
      this.radio?.update(dt);
    } else this.audio?.updatePaused?.(real);   // im Menü laufen die Hintergrundgeräusche weiter
    this.net?.update(real);                         // Mitspieler bewegen sich auch, während das eigene Menü offen ist
    this.player.updateCamera(this.paused ? 0 : dt);
    this.ui?.update(real);
    input.endFrame();
  }

  // Wetterwechsel alle paar Minuten (gewichtet)
  _weather(dt) {
    this.weatherT = (this.weatherT ?? 200) - dt;
    if (this.weatherT > 0 || this.weatherLock) return;
    this.weatherT = 200 + Math.random() * 260;
    const table = [['sunny', 0.38], ['clear', 0.26], ['cloudy', 0.16], ['overcast', 0.08], ['rain', 0.07], ['storm', 0.025], ['fog', 0.025]];
    let r = Math.random();
    for (const [k, w] of table) { r -= w; if (r <= 0) { this.atm.setWeather(k); return; } }
  }

  _housekeeping(dt) {
    // Verlassene Fahrzeuge aufräumen
    if (this._frame % 120 === 0) {
      const p = this.player;
      for (const v of [...this.vehicles.list]) {
        if (v.owner === 'abandoned' && !v.keep) {
          const d = Math.hypot(v.x - p.x, v.z - p.z);
          if (d > 600 && v !== p.lastVehicle) this.vehicles.remove(v);
        }
        if (v.exploded && v.wreckT > 90 && !v.keep) this.vehicles.remove(v);
      }
    }
    // Leere Charaktere entfernen
    this.player.fovCheck;
  }

  // Fotomodus/Debug: Kamera frei platzieren (die Landschaft lädt um diese Position nach)
  setCam(x, y, z, yaw, pitch) {
    this.freeCam = x === null ? null : { x, y, z, yaw, pitch };
    if (this.freeCam) this.teleport(x, z);
  }

  render(dt) {
    const cam = this.camera;
    if (this.freeCam) { const f = this.freeCam; cam.position.set(f.x, f.y, f.z); cam.rotation.set(f.pitch, f.yaw, 0, 'YXZ'); cam.updateMatrixWorld(); }
    this.atm.update(dt, cam.position, cam);
    this.sea.update(dt, cam);
    // Pools in der Nähe: Loch im Gelände über dem Becken (die nächsten zuerst)
    this._poolT = (this._poolT ?? 0) - dt;
    if (this._poolT <= 0) {
      this._poolT = 0.3;
      const cx = cam.position.x, cz = cam.position.z, near = [];
      for (const p of this.ctx.pools) { const d2 = (p.x - cx) ** 2 + (p.z - cz) ** 2; if (d2 < 240 * 240) near.push([d2, p]); }
      near.sort((a, b) => a[0] - b[0]);
      this.mats.setPools(near.map((e) => e[1]));
    }
    this.under?.update(dt, cam);
    this.mats.setNight(this.atm.night, this.atm.w.rain);
    this.props.setNight(this.atm.night);
    this.engine.renderer.toneMappingExposure = this.atm.exposure;
    this.chunks.update(this.player.vehicle ? this.player.vehicle : this.player);
    this.chunks.step(this._frame < 5 ? 40 : 4.5);
    const fk = this.chunks.focusChunk[0] * 100003 + this.chunks.focusChunk[1];
    if (fk !== this._fk || this.chunks.stats.detail !== this._detN) { this._fk = fk; this._detN = this.chunks.stats.detail; this.props.setNear(this.chunks.nearKeys(cam.position, 300)); }
    this.props.rebuild();
    if (this.props.lampsDirty) { this.fx.setLamps({ lamps: this.props.getLampPositions() }); this.props.lampsDirty = false; }
    this.fx.update(dt, cam);
    this.engine.render(dt);
  }

  // ---------- Speichern ----------
  serialize() {
    const p = this.player;
    const x = p.vehicle ? p.vehicle.x : p.x, z = p.vehicle ? p.vehicle.z : p.z;
    return {
      v: 1, who: p.who, x, z, h: p.h, hp: p.hp, armor: p.armor, money: this.money,
      weapons: p.weapons, cur: p.cur, hour: this.atm.hour, weather: this.atm.weatherKey,
      stats: this.stats, owned: this.owned,
      missions: this.missions?.serialize?.() ?? null,
      friends: this.friends ?? null,
      vehicle: p.vehicle && p.vehicle.owner === 'player' ? { type: p.vehicle.type, paint: p.vehicle.paintIdx, ownedIdx: p.vehicle.ownedIdx } : null,
      savedAt: Date.now(),
    };
  }

  restore(d) {
    if (!d) return;
    const p = this.player;
    this.money = d.money ?? this.money;
    p.weapons = d.weapons || p.weapons; p.cur = d.cur || 'pistol'; p._applyWeaponModel();
    p.hp = d.hp ?? p.hp; p.armor = d.armor ?? 0;
    this.atm.hour = d.hour ?? this.atm.hour;
    if (d.weather) this.atm.setWeather(d.weather, true);
    this.stats = { ...this.stats, ...(d.stats || {}) };
    this.owned = d.owned || this.owned;
    this.friends = d.friends || this.friends;
    this.missions?.restore?.(d.missions);
    this.teleport(d.x, d.z);
    p.h = d.h || 0; p.camYaw = p.h;
    if (d.vehicle) {
      const v = this.vehicles.spawn(d.vehicle.type, d.x + Math.sin(p.h) * 4, d.z + Math.cos(p.h) * 4, p.h, { owner: 'abandoned', paint: d.vehicle.paint });
      v.keep = true;
      if (d.vehicle.ownedIdx != null && this.owned.vehicles[d.vehicle.ownedIdx]) v.ownedIdx = d.vehicle.ownedIdx;
    }
  }

  // ---------- Admin / Menü-Hilfen ----------
  adminSpawn(typeKey) {
    const p = this.player;
    const T = this.vehicles.list.length >= 0 && typeKey;
    const f = { x: Math.sin(p.camYaw), z: Math.cos(p.camYaw) };
    let x = p.x + f.x * 7, z = p.z + f.z * 7, h = p.camYaw;
    const cls = (this.constructor.TYPES || {})[typeKey];
    void T; void cls;
    const water = ['speedboat', 'yacht', 'jetski'].includes(typeKey);
    if (water) {
      // nächstes Wasser suchen
      let best = null;
      for (let r = 10; r < 400 && !best; r += 15) for (let a = 0; a < 6.28; a += 0.4) { const qx = p.x + Math.cos(a) * r, qz = p.z + Math.sin(a) * r; if (this.physics.groundHeight(qx, qz) < -3) { best = [qx, qz]; break; } }
      if (best) { x = best[0]; z = best[1]; }
    }
    if (typeKey === 'plane') { const rw = this.ctx.runway; if (rw) { x = rw.x - rw.ux * rw.L * 0.42; z = rw.z - rw.uz * rw.L * 0.42; h = Math.atan2(rw.ux, rw.uz); } }
    const v = this.vehicles.spawn(typeKey, x, z, h, { owner: 'abandoned', paint: Math.floor(Math.random() * 6) });
    if (typeKey === 'heli') v.y = this.physics.groundHeight(x, z) + 1;
    v.keep = true;
    this.enterVehicle(p, v);
    if (typeKey === 'heli') { v.y += 2; }
    return v;
  }

  // Auto-Save nach jeder geschafften Mission; der Spieler kann ihn unter Optionen → Speichern ausschalten
  get autoSaveOn() { return this.ui?.panels?.settings?.autosave !== false; }
  async autoSave() {
    if (!this.autoSaveOn) return false;
    return this.saveToServer(true);
  }

  // Speicherplatz 0 = Auto-Save, 1–10 = eigene Speicherstände
  async saveToServer(auto = false, slot = null) {
    const target = auto ? 0 : (slot ?? this.saveSlot ?? 1);
    try {
      const r = await fetch('/api/save?slot=' + target, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ save: this.serialize() }) });
      const reply = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(reply.error || 'Fehler');
      // Alte Server-Version ohne Speicherplätze: Der Stand liegt nur in einem einzigen Platz
      if (reply.slot === undefined) this.ui?.notify('Der Server kennt noch keine Speicherplätze. Bitte api/index.php und api/lib.php aktualisieren.', 'warn');
      this.lastSaveAt = Date.now(); this.lastSaveAuto = !!auto;
      if (!auto) this.saveSlot = target;
      this.ui?.notify(auto ? 'Automatisch gespeichert' : `Gespeichert: Speicherstand ${target}`, 'good');
      return true;
    } catch (e) { this.ui?.notify('Speichern fehlgeschlagen: ' + e.message, 'warn'); return false; }
  }

  async loadFromServer(slot) {
    try {
      const r = await fetch('/api/save' + (slot === undefined ? '' : '?slot=' + slot));
      const d = await r.json();
      if (!d.save) { this.ui?.notify('Kein Speicherstand vorhanden', 'warn'); return false; }
      if (this.player.vehicle) this.exitVehicle(this.player, true);
      this.restore(d.save);
      if (slot > 0) this.saveSlot = slot;
      this.ui?.notify(slot === 0 ? 'Auto-Save geladen' : 'Speicherstand geladen', 'good');
      return true;
    } catch (e) { this.ui?.notify('Laden fehlgeschlagen', 'warn'); return false; }
  }

  exitToMenu() { this.opts.onExit?.(); }

  onQualityChanged() {
    const q = QUALITY_POP[this.engine.qualityKey] || QUALITY_POP.high;
    this.quality = q; this.traffic.target = q.traffic; this.traffic.targetParked = q.parked; this.peds.target = q.peds;
    this.atm.shadowRange = this.engine.q.shadowRange;
    const sc = this.atm.sun.shadow.camera; sc.left = -this.atm.shadowRange; sc.right = this.atm.shadowRange; sc.top = this.atm.shadowRange; sc.bottom = -this.atm.shadowRange; sc.updateProjectionMatrix();
    const sz = this.engine.q.shadow || 1024;
    if (this.atm.sun.shadow.mapSize.x !== sz) { this.atm.sun.shadow.mapSize.set(sz, sz); this.atm.sun.shadow.map?.dispose(); this.atm.sun.shadow.map = null; }
    // Schatten aus (Optionen → Grafik oder Qualitätsstufe ohne Schatten): Sonne wirft keine Schatten, die Shader werden neu gebaut
    this.atm.sun.castShadow = this.engine.shadowsOn;
    this.chunks.detailBuilder.density = this.engine.q.detail >= 1 ? 1 : this.engine.q.detail;
  }

  dispose() {
    this.stopped = true;
    this.net?.dispose(); this.net = null;
    this.under?.dispose?.();
    this.input.dispose();
    this.audio?.dispose?.();
    this.radio?.dispose?.();
  }
}
