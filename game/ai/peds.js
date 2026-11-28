// Passanten: spazieren auf Gehwegen, Strand, Joggen, Sonnenbaden, Tanzen, Reaktionen auf Gewalt.
import { Character } from '../entities/character.js';
import { Router, laneTarget, projectOnRoad } from './router.js';
import { clamp, wrapPi, mulberry32 } from '../util.js';
import { LU } from '../world/landuse.js';

const SAY_FLEE = ['¡Ay Dios mío!', 'Hilfe!', '¡Policía!', 'Nicht schießen!', 'Neeeein!', '¡Socorro!', 'Lauft weg!'];
const SAY_BUMP = ['¡Oye!', 'Hey, pass auf!', '¡Cuidado!', 'Spinnst du?!', 'Idiot!', '¡Imbécil!'];
const SAY_CHILL = ['Wunderschön hier!', '¡Qué calor!', 'Mallorca ist einfach top!', 'Wo ist der Strand?', 'Hast du Sonnencreme?', '¡Qué bonito!', 'Ein Eis wäre jetzt gut.', '¿Dónde está el hotel?', 'Das Meer ist traumhaft!'];
const SAY_CLUB = ['¡Fiesta!', 'Noch eine Runde!', '¡Vamos!', 'Hier geht die Party ab!'];
const NAMES_M = ['Carlos', 'Miguel', 'Jonas', 'Luca', 'Tomeu', 'Pere', 'Hans', 'Jaume', 'David', 'Marc'];
const NAMES_F = ['Maria', 'Carmen', 'Anna', 'Sophie', 'Catalina', 'Laura', 'Elena', 'Marta', 'Julia', 'Isabel'];

export class PedManager {
  constructor(game) {
    this.game = game;
    this.router = new Router(game.ctx.net);
    this.list = [];
    this.target = game.quality.peds;
    this.spawnT = 0;
    this.clubs = game.ctx.pois.filter((p) => p.type === 'club');
  }

  // ---------- Spawnen ----------
  spawnNear(px, pz, rMin = 30, rMax = 150) {
    const g = this.game, net = g.ctx.net, coast = g.ctx.coast, lu = g.ctx.landuse;
    for (let k = 0; k < 10; k++) {
      const a = Math.random() * Math.PI * 2, d = rMin + Math.random() * (rMax - rMin);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      const sd = coast.sdAt(x, z);
      const land = lu.get(x, z);
      const night = g.atm.night > 0.5;
      // Strandkontext
      if (land === LU.BEACHCLUB || (sd > -30 && sd < 24 && g.ctx.net.nearest(x, z, 90, (r) => r.kind === 'promenade'))) {
        const roll = Math.random();
        if (night && Math.random() < 0.6) continue;
        if (sd < 0 && sd > -35 && roll < 0.35) return this._make('beach', x, z, { mode: 'swim' });
        if (sd > 1 && roll < 0.55) return this._make('beach', x, z, { mode: 'lie' });
        if (sd > 1) return this._make(Math.random() < 0.5 ? 'beach' : 'tourist', x, z, { mode: 'wander' });
        continue;
      }
      // Gehweg-Kontext
      const nr = net.nearest(x, z, 40, (r) => r.sw > 0 || r.kind === 'promenade');
      if (nr) {
        const r = nr.road;
        const nearClub = this.clubs.some((c) => Math.hypot(c.x - nr.x, c.z - nr.z) < 70);
        let outfit = 'local';
        const q = Math.random();
        const dCore = Math.hypot(nr.x - (g.ctx.settlements[0].core?.[0] ?? 0), nr.z - (g.ctx.settlements[0].core?.[1] ?? 0));
        if (night && nearClub) outfit = q < 0.7 ? 'clubber' : 'local';
        else if (night && Math.random() < 0.55) continue;
        else if (r.kind === 'promenade') outfit = q < 0.5 ? 'tourist' : q < 0.7 ? 'jogger' : q < 0.8 ? 'vendor' : q < 0.9 ? 'beach' : 'local';
        else if (dCore < 380) outfit = q < 0.4 ? 'business' : q < 0.65 ? 'tourist' : 'local';
        else outfit = q < 0.2 ? 'elder' : q < 0.4 ? 'tourist' : q < 0.5 ? 'worker' : 'local';
        const side = Math.random() < 0.5 ? 1 : -1;
        const s = r.cum[nr.i] + (r.cum[nr.i + 1] - r.cum[nr.i]) * nr.t;
        const off = (r.w / 2 + Math.max(r.sw, 2) * 0.5) * side;
        const t = laneTarget(net, r, true, s, off, {});
        if (g.physics.groundHeight(t.px, t.pz) < 0.1 || g.physics.poolAt(t.px, t.pz)) continue;
        if (Math.hypot(t.px - px, t.pz - pz) < rMin * 0.8) continue;
        const p = this._make(outfit, t.px, t.pz, { mode: outfit === 'vendor' ? 'idle' : nearClub && night && Math.random() < 0.45 ? 'dance' : 'walk' }, { road: r, fwd: Math.random() < 0.5, s, side, off });
        return p;
      }
      // Land: wenige Wanderer/Bauern
      if (sd > 60 && land === 0 && Math.random() < 0.08 && !night) return this._make(Math.random() < 0.5 ? 'worker' : 'tourist', x, z, { mode: 'wander' });
    }
    return null;
  }

  _make(outfit, x, z, ai, route = null) {
    const g = this.game;
    const gy = g.physics.groundHeight(x, z);
    if (ai.mode !== 'swim' && gy < 0.1) return null;
    if (ai.mode === 'swim' && gy > -0.5) return null;
    const lieH = ai.mode === 'lie' ? this._lieHeading(x, z) : null;
    if (ai.mode === 'lie' && lieH === null) return null;   // kein freier Liegeplatz
    const female = Math.random() < 0.46;
    const ch = new Character(g, 'ped', x, z, { outfit, heading: Math.random() * 6.28, hp: 60 + Math.random() * 40 });
    ch.name = (female ? NAMES_F : NAMES_M)[Math.floor(Math.random() * 10)];
    ch.armed = Math.random() < 0.04;
    ch.ai = { mode: ai.mode, t: 5 + Math.random() * 20, route, tx: x, tz: z, outfit, fear: 0, moodT: 6 + Math.random() * 20, bumpT: 0 };
    if (ai.mode === 'lie') { ch.anim.lie = true; ch.h = lieH; }
    if (ai.mode === 'dance') ch.anim.dance = true;
    if (ai.mode === 'swim') ch.ai.tx = x, ch.ai.tz = z;
    g.addCharacter(ch);
    this.list.push(ch);
    return ch;
  }

  // Liegeplatz zum Sonnenbaden: Der ganze Körper (Füße am Ursprung, Kopf knapp 2 m hinter der Blickrichtung) muss auf
  // freiem, ebenem Sand liegen – nie halb auf Holzterrasse, Steg, Straße, Mauer oder im Wasser. Liefert die Richtung oder null.
  _lieHeading(x, z) {
    const y0 = this.game.physics.groundHeight(x, z);
    const start = Math.random() * 6.28;
    for (let k = 0; k < 8; k++) {
      const h = start + (k / 8) * 6.28, fx = Math.sin(h), fz = Math.cos(h);
      let free = true;
      for (let i = 0; i <= 6 && free; i++) {
        const t = -0.4 + i * 0.45;   // entlang des Körpers: knapp vor den Füßen bis hinter den Kopf
        free = [-0.7, 0, 0.7].every((s) => this._freeSand(x - fx * t + fz * s, z - fz * t - fx * s, y0));
      }
      if (free) return h;
    }
    return null;
  }

  _freeSand(x, z, y0) {
    const g = this.game, phys = g.physics;
    if (g.ctx.coast.sdAt(x, z) < 1) return false;
    if (Math.abs(phys.groundHeight(x, z) - y0) > 0.14) return false;
    if (phys.platformHeight(x, z) > -Infinity || g.ctx.net.covers(x, z, 0.6)) return false;
    return !phys.pushCircle({ x, z }, 0.25, y0 + 0.05, y0 + 0.5);
  }

  // ---------- Update ----------
  update(dt) {
    const g = this.game, p = g.player;
    const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 0.22;
      if (this.list.length < this.target) this.spawnNear(px, pz);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i];
      if (c.dropped) { this.list.splice(i, 1); continue; }
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d > 190 || (!c.alive && c.deadT > 40)) { this._drop(c); this.list.splice(i, 1); continue; }
      if (!c.alive) { c.intent.mx = c.intent.mz = 0; continue; }
      if (c.state === 'vehicle') continue;
      this._think(c, dt, px, pz);
    }
  }

  _drop(c) { c.dropped = true; this.game.removeCharacter(c); }

  _think(c, dt, px, pz) {
    const a = c.ai, I = c.intent, g = this.game;
    I.aim = false; I.fire = false; I.sprint = false;
    a.t -= dt; a.bumpT = Math.max(0, a.bumpT - dt);
    a.fear = Math.max(0, a.fear - dt);
    // Gelegentliche Sprüche
    a.moodT -= dt;
    if (a.moodT <= 0) {
      a.moodT = 12 + Math.random() * 25;
      const d = Math.hypot(c.x - px, c.z - pz);
      if (d < 18 && a.mode !== 'flee' && g.player.alive) c.say(a.mode === 'dance' ? SAY_CLUB[Math.floor(Math.random() * SAY_CLUB.length)] : SAY_CHILL[Math.floor(Math.random() * SAY_CHILL.length)], 3);
    }
    switch (a.mode) {
      case 'walk': this._walk(c, dt); break;
      case 'wander': this._wander(c, dt); break;
      case 'idle': I.mx = I.mz = 0; I.speed = 0; c.anim.phone = a.outfit !== 'vendor'; if (a.t <= 0) { c.anim.phone = false; a.mode = a.route ? 'walk' : 'wander'; } break;
      case 'lie': I.mx = I.mz = 0; I.speed = 0; break;
      case 'sit': I.mx = I.mz = 0; I.speed = 0; break;
      case 'dance': I.mx = I.mz = 0; I.speed = 0; break;
      case 'swim': this._swim(c, dt); break;
      case 'flee': this._flee(c, dt); break;
      case 'cower': I.mx = I.mz = 0; I.speed = 0; c.crouch = true; I.crouch = true; if (a.t <= 0) { I.crouch = false; a.mode = a.route ? 'walk' : 'wander'; } break;
      case 'fight': this._fight(c, dt); break;
      default: break;
    }
  }

  _walk(c, dt) {
    const g = this.game, net = g.ctx.net, a = c.ai, I = c.intent, r = a.route;
    if (!r) { a.mode = 'wander'; return; }
    r.s = projectOnRoad(net, r.road, c.x, c.z, r.s, r.fwd);
    if (r.road.len - r.s < 2.5) {
      const node = r.fwd ? r.road.b : r.road.a;
      const e = this.router.pickNext(node, r.road, null);
      if (e) { r.road = e.road; r.fwd = e.fwd; r.s = 0.5; r.off = (e.road.w / 2 + Math.max(e.road.sw, 2) * 0.5) * r.side; }
      else r.fwd = !r.fwd;
    }
    const t = laneTarget(net, r.road, r.fwd, Math.min(r.road.len, r.s + 3.5), r.off, {});
    const dx = t.px - c.x, dz = t.pz - c.z, l = Math.hypot(dx, dz) || 1;
    I.mx = dx / l; I.mz = dz / l;
    I.speed = a.outfit === 'jogger' ? 1 : a.outfit === 'elder' ? 0.35 : 0.5;
    I.sprint = false;
    // gelegentlich stehen bleiben
    if (a.t <= 0) {
      a.t = 8 + Math.random() * 25;
      if (Math.random() < 0.18 && a.outfit !== 'jogger') { a.mode = 'idle'; a.t = 4 + Math.random() * 8; }
    }
  }

  _wander(c, dt) {
    const g = this.game, a = c.ai, I = c.intent;
    const d = Math.hypot(a.tx - c.x, a.tz - c.z);
    if (d < 1.5 || a.t <= 0) {
      for (let k = 0; k < 6; k++) {
        const an = Math.random() * 6.28, rr = 6 + Math.random() * 22;
        const tx = c.x + Math.cos(an) * rr, tz = c.z + Math.sin(an) * rr;
        const gh = g.physics.groundHeight(tx, tz);
        // nicht in einen Pool hinein (auch nicht quer hindurch)
        if (g.physics.poolAt(tx, tz) || g.physics.poolAt((tx + c.x) / 2, (tz + c.z) / 2)) continue;
        if (gh > 0.3 && gh < c.y + 1.2) { a.tx = tx; a.tz = tz; break; }
      }
      a.t = 6 + Math.random() * 12;
    }
    const dx = a.tx - c.x, dz = a.tz - c.z, l = Math.hypot(dx, dz) || 1;
    I.mx = dx / l; I.mz = dz / l; I.speed = 0.5;
    // vor einem Pool stehen bleiben und ein neues Ziel suchen
    if (!c.inPool && g.physics.poolAt(c.x + I.mx * 1.1, c.z + I.mz * 1.1)) { I.mx = I.mz = 0; a.t = 0; a.tx = c.x; a.tz = c.z; }
  }

  _swim(c, dt) {
    const g = this.game, a = c.ai, I = c.intent;
    const d = Math.hypot(a.tx - c.x, a.tz - c.z);
    if (d < 2 || a.t <= 0) {
      for (let k = 0; k < 6; k++) {
        const an = Math.random() * 6.28, rr = 5 + Math.random() * 14;
        const tx = c.x + Math.cos(an) * rr, tz = c.z + Math.sin(an) * rr;
        if (g.physics.groundHeight(tx, tz) < -1.6 && !g.physics.poolAt(tx, tz)) { a.tx = tx; a.tz = tz; break; }
      }
      a.t = 5 + Math.random() * 8;
    }
    const dx = a.tx - c.x, dz = a.tz - c.z, l = Math.hypot(dx, dz) || 1;
    I.mx = dx / l; I.mz = dz / l; I.speed = 0.5;
    if (c.state !== 'swim' && g.physics.groundHeight(c.x, c.z) > -1.2) { I.mx = -dx / l; I.mz = -dz / l; }
  }

  _flee(c, dt) {
    const a = c.ai, I = c.intent, g = this.game;
    const src = a.from;
    let dx = c.x - (src ? src.x : g.player.x), dz = c.z - (src ? src.z : g.player.z);
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // Seitliches Ausweichen vor Hindernissen: kleine Zufallsabweichung
    a.jit = (a.jit || 0) + (Math.random() - 0.5) * dt * 3;
    a.jit = clamp(a.jit, -0.8, 0.8);
    const cx = Math.cos(a.jit), sx = Math.sin(a.jit);
    I.mx = dx * cx - dz * sx; I.mz = dx * sx + dz * cx;
    I.speed = 1; I.sprint = true;
    if (a.t <= 0 && l > 40) { a.mode = a.route ? 'walk' : 'wander'; a.t = 5; }
    else if (a.t <= 0) a.t = 3;
  }

  _fight(c, dt) {
    const a = c.ai, I = c.intent, g = this.game;
    const tgt = a.target || g.player;
    if (!tgt.alive) { a.mode = 'flee'; a.from = tgt; a.t = 8; return; }
    const dx = tgt.x - c.x, dz = tgt.z - c.z, d = Math.hypot(dx, dz) || 1;
    c.hostile = true;
    if (c.armed) {
      if (!c.weapons.pistol) { c.giveWeapon('pistol', 40); c.setWeapon('pistol'); }
      I.aim = d < 40; I.ax = dx / d; I.az = dz / d; I.ay = ((tgt.y + 1.2) - (c.y + 1.4)) / d; c.accuracy = 2.4;
      I.mx = 0; I.mz = 0; I.speed = 0;
      if (d < 40 && Math.random() < dt * 1.6) g.combat.tryFire(c);
      if (d > 28) { I.mx = dx / d; I.mz = dz / d; I.speed = 0.8; }
    } else {
      I.mx = dx / d; I.mz = dz / d; I.speed = 1; I.sprint = d > 4;
      if (d < 1.7) { I.aim = false; c.face = Math.atan2(dx, dz); c.h = Math.atan2(dx, dz); g.combat.tryFire(c); I.mx = I.mz = 0; }
    }
    if (a.t <= 0 || d > 60) { a.mode = 'flee'; a.from = tgt; a.t = 6; c.hostile = false; }
  }

  // ---------- Reaktionen ----------
  scare(c, from, secs = 10) {
    if (!c.alive || c.ai?.mode === 'fight') return;
    const a = c.ai; if (!a) return;
    a.mode = 'flee'; a.from = from; a.t = secs; a.fear = secs;
    c.anim.lie = false; c.anim.dance = false; c.anim.phone = false; c.anim.sit = false;
    if (c.state !== 'swim') c.crouch = false;
    if (Math.random() < 0.35) c.say(SAY_FLEE[Math.floor(Math.random() * SAY_FLEE.length)], 2.5);
  }

  hearShot(x, z, radius, source) {
    for (const c of this.list) {
      if (!c.alive || !c.ai || c.state === 'vehicle') continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d > radius) continue;
      const p = 1 - d / radius;
      if (c.armed && source === this.game.player && d < 30 && Math.random() < 0.4) { c.ai.mode = 'fight'; c.ai.target = source; c.ai.t = 14; continue; }
      if (Math.random() < 0.35 + p * 0.65) {
        if (d < 14 && Math.random() < 0.3) { c.ai.mode = 'cower'; c.ai.t = 5 + Math.random() * 5; c.say(SAY_FLEE[Math.floor(Math.random() * SAY_FLEE.length)], 2); }
        else this.scare(c, { x, z }, 7 + Math.random() * 8);
      }
    }
    // Fahrer panisch
    for (const v of this.game.traffic?.cars || []) {
      if (Math.hypot(v.x - x, v.z - z) < radius * 0.6) this.game.traffic.panic(v, 6);
    }
  }

  hurtReact(c, source) {
    if (!c.ai || !c.alive) return;
    if (c.armed && Math.random() < 0.6) { c.ai.mode = 'fight'; c.ai.target = source || this.game.player; c.ai.t = 15; return; }
    if (source && Math.random() < 0.18 && !c.armed) { c.ai.mode = 'fight'; c.ai.target = source; c.ai.t = 10; return; }
    this.scare(c, source || { x: c.x - 1, z: c.z }, 12);
  }

  bump(c, from) {
    if (!c.ai || !c.alive || c.ai.bumpT > 0) return;
    c.ai.bumpT = 3;
    if (Math.random() < 0.5) c.say(SAY_BUMP[Math.floor(Math.random() * SAY_BUMP.length)], 2);
    if (from && from.isPlayer && Math.random() < 0.12) { c.ai.mode = 'fight'; c.ai.target = from; c.ai.t = 8; }
  }

  adopt(ch) {
    ch.ai = ch.ai || { mode: 'flee', t: 12, route: null, tx: ch.x, tz: ch.z, outfit: 'local', fear: 8, moodT: 10, bumpT: 0 };
    this.list.push(ch);
  }
}
