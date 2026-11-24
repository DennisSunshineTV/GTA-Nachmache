// Kampfsystem: Schüsse (Hitscan), Nahkampf, Granaten, Explosionsschaden.
import * as THREE from 'three';
import { clamp } from '../util.js';
import { WEAPONS } from './weapons.js';

function rayCyl(o, d, cx, cz, r, y0, y1, maxT) {
  const dx = o.x - cx, dz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (dx * d.x + dz * d.z), c = dx * dx + dz * dz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0 || t > maxT) return null;
  const y = o.y + d.y * t;
  if (y < y0 || y > y1) return null;
  return t;
}

function rayRect(o, d, cx, cz, hw, hl, h, y0, y1, maxT) {
  // lokale Achsen: vorwärts (sin h, cos h), seitlich (cos h, -sin h)
  const s = Math.sin(h), c = Math.cos(h);
  const dx = o.x - cx, dz = o.z - cz;
  const lf = dx * s + dz * c, ll = dx * c - dz * s;
  const df = d.x * s + d.z * c, dl = d.x * c - d.z * s;
  let t0 = 0, t1 = maxT;
  for (const [p, dd, hh] of [[lf, df, hl], [ll, dl, hw]]) {
    if (Math.abs(dd) < 1e-9) { if (Math.abs(p) > hh) return null; continue; }
    let a = (-hh - p) / dd, b = (hh - p) / dd;
    if (a > b) { const t = a; a = b; b = t; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  const y = o.y + d.y * t0;
  if (y < y0 || y > y1) return null;
  return t0;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.grenades = [];
    this.gMat = new THREE.MeshStandardMaterial({ color: 0x3d4a2f, roughness: 0.6 });
    this.gGeo = new THREE.SphereGeometry(0.06, 8, 6);
  }

  // Versuch zu feuern. Rückgabe true, wenn ein Schuss/Angriff ausgelöst wurde
  tryFire(ch) {
    const W = ch.weapon;
    if (!W) return false;
    if (W.melee) return this.melee(ch);
    if (ch.fireCd > 0 || ch.reloadT > 0 || ch.state === 'swim') return false;
    const w = ch.weapons[ch.cur];
    if (W.thrown) {
      if (!w || w.mag + w.reserve <= 0) return false;
      if (w.mag > 0) w.mag--; else w.reserve--;
      ch.fireCd = W.rate; ch.throwT = 1;
      this.throwGrenade(ch, W);
      if (w.mag + w.reserve <= 0) { delete ch.weapons[ch.cur]; ch.setWeapon('fists'); }
      return true;
    }
    if (!w) return false;
    if (w.mag <= 0) {
      if (w.reserve > 0) ch.reload(); else if (ch.isPlayer) this.game.audio?.click();
      return false;
    }
    w.mag--;
    ch.fireCd = W.rate;
    const o = ch.muzzlePos({});
    const I = ch.intent;
    const base = new THREE.Vector3(I.ax, I.ay, I.az).normalize();
    const pellets = W.pellets || 1;
    const spread = W.spread * (ch.isPlayer ? (I.aim ? 0.6 : 1.4) : (ch.accuracy ?? 1.6)) * (ch.speedH > 2 ? 1.6 : 1);
    let firstHit = null;
    for (let i = 0; i < pellets; i++) {
      const d = base.clone();
      d.x += (Math.random() - 0.5) * spread * 2; d.y += (Math.random() - 0.5) * spread * 2; d.z += (Math.random() - 0.5) * spread * 2;
      d.normalize();
      const hit = this.hitscan(ch, o, d, W);
      if (!firstHit) firstHit = hit;
    }
    this.game.effects.muzzle(o.x, o.y, o.z, base.x, base.y, base.z);
    this.game.audio?.shot(ch, W);
    this.game.onGunshot?.(ch, W);
    if (ch.isPlayer) { this.game.effects.addShake(W.id === 'shotgun' ? 0.25 : W.id === 'sniper' ? 0.35 : 0.06); this.game.player.recoil = Math.min(0.12, (this.game.player.recoil || 0) + (W.id === 'sniper' ? 0.09 : W.id === 'shotgun' ? 0.08 : 0.016)); }
    if (w.mag === 0 && w.reserve > 0) setTimeout(() => ch.alive && ch.reload(), 250);
    return true;
  }

  melee(ch) {
    const W = ch.weapon;
    if (ch.fireCd > 0 || ch.meleeT > 0.2) return false;
    ch.fireCd = W.rate; ch.meleeT = 1;
    const f = ch.fwd;
    const I = ch.intent;
    const fx = I.aim ? I.ax : f.x, fz = I.aim ? I.az : f.z;
    const l = Math.hypot(fx, fz) || 1;
    let best = null, bd = W.range + 0.4;
    for (const c of this.game.allCharacters()) {
      if (c === ch || !c.alive || c.state === 'vehicle') continue;
      const dx = c.x - ch.x, dz = c.z - ch.z, d = Math.hypot(dx, dz);
      if (d > W.range + 0.4 || Math.abs(c.y - ch.y) > 1.5) continue;
      if ((dx * fx + dz * fz) / (l * (d || 1)) < 0.35) continue;
      if (d < bd) { bd = d; best = c; }
    }
    this.game.audio?.punch(ch);
    if (best) {
      best.hurt(W.dmg * (0.85 + Math.random() * 0.3), ch);
      best.vx += (best.x - ch.x) / (bd || 1) * 3.5; best.vz += (best.z - ch.z) / (bd || 1) * 3.5;
      this.game.effects.puff(best.x, best.y + 1.4, best.z, [0.9, 0.9, 0.9]);
      this.game.onGunshot?.(ch, null, 12);
    }
    return true;
  }

  // Nächster Treffer entlang eines Strahls (ohne Schaden): { t, kind, target }
  castRay(shooter, org, d, maxT) {
    const game = this.game;
    let bestT = maxT, kind = null, target = null;
    // Figuren
    for (const c of game.allCharacters()) {
      if (c === shooter || !c.alive || c.state === 'vehicle') continue;
      if (Math.abs(c.x - org.x) > maxT || Math.abs(c.z - org.z) > maxT) continue;
      const t = rayCyl(org, d, c.x, c.z, 0.38, c.y, c.y + (c.state === 'swim' ? 0.9 : 1.82), bestT);
      if (t !== null && t < bestT) { bestT = t; kind = 'char'; target = c; }
    }
    // Fahrzeuge
    for (const v of game.vehicles.list) {
      if (!v.alive || v === shooter.vehicle) continue;
      if (Math.abs(v.x - org.x) > maxT + 8 || Math.abs(v.z - org.z) > maxT + 8) continue;
      const t = rayRect(org, d, v.x, v.z, v.hw, v.hl, v.h, v.y, v.y + v.height, bestT);
      if (t !== null && t < bestT) { bestT = t; kind = 'veh'; target = v; }
    }
    // Statik
    const s = game.physics.raycastStatic(org, d, bestT);
    if (s && s.t < bestT) { bestT = s.t; kind = 'static'; target = s.collider; }
    // Gelände
    const tt = game.physics.raycastTerrain(org, d, bestT, 3);
    if (tt !== null && tt < bestT) { bestT = tt; kind = 'terrain'; target = null; }
    // Wasserebene
    if (kind !== 'char' && kind !== 'veh' && d.y < 0 && org.y > 0.2) {
      const tw = -org.y / d.y;
      if (tw > 0 && tw < bestT) { bestT = tw; kind = 'water'; }
    }
    return { t: bestT, kind, target };
  }

  hitscan(shooter, o, d, W) {
    const game = this.game;
    const org = { x: o.x, y: o.y, z: o.z };
    const r = this.castRay(shooter, org, d, W.range);
    const bestT = r.t, kind = r.kind, target = r.target;
    const hx = org.x + d.x * bestT, hy = org.y + d.y * bestT, hz = org.z + d.z * bestT;
    if (kind === 'water') game.effects.impact(hx, 0.1, hz, 'water');
    // Leuchtspur
    if (shooter.isPlayer || W.auto || Math.random() < 0.5) game.effects.tracer(org.x, org.y - 0.05, org.z, org.x + d.x * bestT, org.y + d.y * bestT, org.z + d.z * bestT, shooter.hostile || shooter.kind === 'cop' ? [1, 0.45, 0.3] : [1, 0.9, 0.6]);
    const falloff = W.pellets ? clamp(1.15 - bestT / 45, 0.2, 1) : W.id === 'pistol' ? clamp(1.2 - bestT / 150, 0.5, 1) : 1;
    if (kind === 'char') {
      const head = hy > target.y + 1.5;
      target.hurt(W.dmg * falloff * (head ? 2.4 : 1), shooter, head);
      game.effects.impact(hx, hy, hz, 'flesh');
      if (head && !target.alive) game.onHeadshot?.(shooter, target);
    } else if (kind === 'veh') {
      target.damage(W.dmg * falloff * (W.pellets ? 1.1 : 1.3), shooter);
      game.effects.impact(hx, hy, hz, 'metal');
      if (target.driver && target.driver.alive && Math.random() < 0.22) target.driver.hurt(W.dmg * falloff * 0.6, shooter);
      if (target.hp < target.maxHp * 0.25 && !target.burning && Math.random() < 0.08 * (W.pellets || 1)) { target.burning = 3; }
    } else if (kind === 'static' || kind === 'terrain') {
      game.effects.impact(hx, hy, hz, 'default');
    }
    return { kind, t: bestT, target, x: hx, y: hy, z: hz };
  }

  throwGrenade(ch, W) {
    const I = ch.intent;
    const f = new THREE.Vector3(I.ax || Math.sin(ch.h), (I.ay || 0) + 0.35, I.az || Math.cos(ch.h)).normalize();
    const m = new THREE.Mesh(this.gGeo, this.gMat);
    const o = ch.muzzlePos({});
    m.position.set(o.x, o.y, o.z);
    this.game.scene.add(m);
    this.grenades.push({ m, x: o.x, y: o.y, z: o.z, vx: f.x * 17 + ch.vx * 0.5, vy: f.y * 17, vz: f.z * 17 + ch.vz * 0.5, t: W.fuse, W, owner: ch });
    this.game.audio?.throwSound(ch);
  }

  update(dt) {
    const physics = this.game.physics;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      g.t -= dt;
      g.vy -= 14 * dt;
      g.x += g.vx * dt; g.y += g.vy * dt; g.z += g.vz * dt;
      const gh = physics.groundHeight(g.x, g.z);
      if (g.y < gh + 0.06) { g.y = gh + 0.06; if (g.vy < -2) { g.vy = -g.vy * 0.4; g.vx *= 0.6; g.vz *= 0.6; } else { g.vy = 0; g.vx *= 0.9; g.vz *= 0.9; } if (gh < -0.3) { g.vx *= 0.2; g.vz *= 0.2; } }
      const pos = { x: g.x, z: g.z };
      if (physics.pushCircle(pos, 0.08, g.y - 0.1, g.y + 0.1)) { g.vx = -g.vx * 0.4; g.vz = -g.vz * 0.4; g.x = pos.x; g.z = pos.z; }
      g.m.position.set(g.x, g.y, g.z);
      if (g.t <= 0) {
        this.game.scene.remove(g.m);
        this.grenades.splice(i, 1);
        this.game.effects.explosion(g.x, g.y + 0.2, g.z, g.W.radius, g.W.dmg, g.owner);
      }
    }
  }

  // Schaden und Rückstoß im Umkreis
  explosionDamage(x, y, z, radius, dmg, source) {
    const game = this.game;
    for (const c of game.allCharacters()) {
      if (!c.alive || c.state === 'vehicle') continue;
      const d = Math.hypot(c.x - x, c.y + 1 - y, c.z - z);
      if (d > radius) continue;
      const k = 1 - d / radius;
      c.hurt(dmg * k * k * 1.4, source);
      const l = d || 1;
      c.vx += ((c.x - x) / l) * 7 * k; c.vz += ((c.z - z) / l) * 7 * k;
      if (c.alive && k > 0.5 && c.state === 'ground') { c.state = 'air'; c.vy = 4.5 * k; }
    }
    for (const v of game.vehicles.list) {
      if (!v.alive) continue;
      const d = Math.hypot(v.x - x, v.y - y, v.z - z);
      if (d > radius * 1.2) continue;
      const k = 1 - d / (radius * 1.2);
      if (v.exploded) { v.vy += 4 * k; continue; }
      v.damage(dmg * k * 2.2, source);
      const l = d || 1;
      v.vx += ((v.x - x) / l) * 9 * k; v.vz += ((v.z - z) / l) * 9 * k;
      if (k > 0.5) { v.grounded = false; v.vy = 3 + 5 * k; v.yawRate += (Math.random() - 0.5) * 3; }
    }
    game.onExplosion?.(x, z, radius, source);
  }
}
