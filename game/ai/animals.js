// Tiere: Hunde an der Leine von Passanten, Katzen auf den Gehwegen, Pferde auf grünen Wiesen, Vogelschwärme am Himmel und
// Tauben, die auf den Gehweg fliegen, picken und wieder auffliegen (manche bleiben sitzen, bis man auf sie zugeht).
// Modelle aus weichen Grundformen (zusammengefügt, Vertexfarben); Beine, Flügel, Kopf und Schwanz bewegen sich.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LU } from '../world/landuse.js';

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
const SPH = new THREE.SphereGeometry(1, 14, 10), CYL = new THREE.CylinderGeometry(1, 1, 1, 10), CONE = new THREE.ConeGeometry(1, 1, 10);
const LEG = new THREE.CylinderGeometry(1, 0.8, 1, 8); LEG.translate(0, -0.5, 0);
const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3();
const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Grundform gedreht, skaliert, verschoben und eingefärbt (sRGB → linear)
function S(base, col, pos, scl, rot = [0, 0, 0]) {
  const g = base.clone();
  _m.compose(_p.set(...pos), _q.setFromEuler(_e.set(...rot)), _s.set(...scl));
  g.applyMatrix4(_m);
  const n = g.attributes.position.count, c = new Float32Array(n * 3), L = col.map((v) => Math.pow(v, 2.2));
  for (let i = 0; i < n; i++) c.set(L, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const mesh = (parts, shadow = true) => { const m = new THREE.Mesh(mergeGeometries(parts), MAT); m.castShadow = shadow; m.receiveShadow = false; return m; };
const pivot = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
const shade = (c, k) => c.map((v) => Math.min(1, v * k));

// ---------- Modelle (Front = +z, Ursprung am Boden) ----------
function dogModel(col, k) {
  const root = new THREE.Group(), dark = shade(col, 0.55), nose = [0.05, 0.04, 0.04];
  const body = [
    S(SPH, col, [0, 0.46, 0], [0.16, 0.16, 0.36]), S(SPH, col, [0, 0.5, 0.22], [0.17, 0.18, 0.2]),
    S(SPH, col, [0, 0.62, 0.36], [0.09, 0.13, 0.1], [0.6, 0, 0]),
    S(SPH, col, [0, 0.72, 0.45], [0.1, 0.1, 0.13]), S(SPH, shade(col, 0.9), [0, 0.68, 0.58], [0.055, 0.05, 0.09]),
    S(SPH, nose, [0, 0.69, 0.66], [0.025, 0.022, 0.02]),
    S(SPH, dark, [0.07, 0.78, 0.43], [0.03, 0.08, 0.055], [0.2, 0, 0.5]), S(SPH, dark, [-0.07, 0.78, 0.43], [0.03, 0.08, 0.055], [0.2, 0, -0.5]),
    S(CYL, [0.75, 0.08, 0.08], [0, 0.6, 0.36], [0.085, 0.03, 0.085], [0.55, 0, 0]),
  ];
  root.add(mesh(body));
  const legs = [];
  for (const [x, z, ph] of [[0.09, 0.26, 0], [-0.09, 0.26, Math.PI], [0.09, -0.24, Math.PI], [-0.09, -0.24, 0]]) {
    const g = pivot(root, x, 0.42, z);
    g.add(mesh([S(LEG, col, [0, 0, 0], [0.04, 0.4, 0.04]), S(SPH, dark, [0, -0.4, 0.02], [0.045, 0.025, 0.06])], false));
    legs.push({ g, ph });
  }
  const tail = pivot(root, 0, 0.52, -0.33);
  tail.add(mesh([S(LEG, col, [0, 0, 0], [0.025, 0.26, 0.025], [-2.3, 0, 0])], false));
  root.scale.setScalar(k);
  return { root, legs, tail };
}

function catModel(col) {
  const root = new THREE.Group(), pink = [0.9, 0.6, 0.6];
  const body = [
    S(SPH, col, [0, 0.24, 0], [0.085, 0.09, 0.2]), S(SPH, col, [0, 0.33, 0.21], [0.075, 0.07, 0.07]),
    S(SPH, shade(col, 1.05), [0, 0.31, 0.27], [0.035, 0.03, 0.03]), S(SPH, pink, [0, 0.315, 0.3], [0.01, 0.008, 0.008]),
    S(CONE, col, [0.04, 0.4, 0.2], [0.025, 0.05, 0.02], [0, 0, -0.2]), S(CONE, col, [-0.04, 0.4, 0.2], [0.025, 0.05, 0.02], [0, 0, 0.2]),
    S(SPH, [0.6, 0.75, 0.2], [0.03, 0.345, 0.268], [0.011, 0.011, 0.006]), S(SPH, [0.6, 0.75, 0.2], [-0.03, 0.345, 0.268], [0.011, 0.011, 0.006]),
  ];
  root.add(mesh(body, false));
  const legs = [];
  for (const [x, z, ph] of [[0.045, 0.13, 0], [-0.045, 0.13, Math.PI], [0.045, -0.13, Math.PI], [-0.045, -0.13, 0]]) {
    const g = pivot(root, x, 0.2, z);
    g.add(mesh([S(LEG, col, [0, 0, 0], [0.018, 0.2, 0.018])], false));
    legs.push({ g, ph });
  }
  const tail = pivot(root, 0, 0.27, -0.18);
  tail.add(mesh([S(LEG, col, [0, 0, 0], [0.016, 0.28, 0.016], [-2.75, 0, 0])], false));
  return { root, legs, tail };
}

function horseModel(col, mane) {
  const root = new THREE.Group(), hoof = [0.12, 0.1, 0.08], light = shade(col, 1.15);
  root.add(mesh([
    S(SPH, col, [0, 1.3, 0], [0.33, 0.36, 0.78]), S(SPH, col, [0, 1.35, 0.5], [0.3, 0.34, 0.34]), S(SPH, col, [0, 1.36, -0.55], [0.31, 0.33, 0.3]),
  ]));
  // Hals mit Kopf (Gelenk am Widerrist: zum Grasen senkt sich der Kopf)
  const neck = pivot(root, 0, 1.38, 0.62);
  neck.add(mesh([
    S(SPH, col, [0, 0.3, 0.28], [0.15, 0.48, 0.2], [0.65, 0, 0]),
    S(SPH, col, [0, 0.64, 0.68], [0.12, 0.14, 0.32], [0.95, 0, 0]),
    S(SPH, light, [0, 0.44, 0.9], [0.09, 0.09, 0.12], [0.95, 0, 0]),
    S(SPH, [0.08, 0.06, 0.05], [0.05, 0.77, 0.63], [0.025, 0.025, 0.025]), S(SPH, [0.08, 0.06, 0.05], [-0.05, 0.77, 0.63], [0.025, 0.025, 0.025]),
    S(CONE, col, [0.06, 0.93, 0.52], [0.035, 0.12, 0.03], [-0.3, 0, -0.15]), S(CONE, col, [-0.06, 0.93, 0.52], [0.035, 0.12, 0.03], [-0.3, 0, 0.15]),
    S(SPH, mane, [0, 0.5, 0.12], [0.05, 0.5, 0.14], [0.6, 0, 0]),
  ]));
  const legs = [];
  for (const [x, z, ph] of [[0.18, 0.5, 0], [-0.18, 0.5, Math.PI], [0.18, -0.55, Math.PI * 0.5], [-0.18, -0.55, Math.PI * 1.5]]) {
    const g = pivot(root, x, 1.12, z);
    g.add(mesh([S(LEG, col, [0, 0, 0], [0.075, 0.55, 0.075]), S(LEG, col, [0, -0.55, 0], [0.05, 0.45, 0.05]), S(CYL, hoof, [0, -1.06, 0.01], [0.065, 0.1, 0.07])]));
    legs.push({ g, ph });
  }
  const tail = pivot(root, 0, 1.45, -0.82);
  tail.add(mesh([S(LEG, mane, [0, 0, 0], [0.07, 0.75, 0.05], [-2.75, 0, 0])], false));
  return { root, legs, tail, neck };
}

function birdModel(col, wingCol, size) {
  const root = new THREE.Group();
  root.add(mesh([
    S(SPH, col, [0, 0, 0], [0.06, 0.055, 0.17]), S(SPH, col, [0, 0.02, 0.14], [0.045, 0.045, 0.05]),
    S(CONE, [0.95, 0.7, 0.15], [0, 0.015, 0.2], [0.012, 0.05, 0.012], [Math.PI / 2, 0, 0]),
    S(SPH, wingCol, [0, 0.01, -0.17], [0.05, 0.01, 0.08]),
  ], false));
  const wings = [];
  for (const sg of [1, -1]) {
    const g = pivot(root, sg * 0.04, 0.02, 0.01);
    g.add(mesh([S(SPH, wingCol, [sg * 0.17, 0, 0], [0.17, 0.012, 0.07]), S(SPH, shade(wingCol, 0.6), [sg * 0.3, 0, -0.01], [0.06, 0.01, 0.05])], false));
    wings.push({ g, sg });
  }
  root.scale.setScalar(size);
  return { root, wings };
}

function pigeonModel() {
  const grey = [0.55, 0.57, 0.62], dark = [0.32, 0.34, 0.38], neckC = pick([[0.28, 0.5, 0.42], [0.45, 0.32, 0.55]]);
  const root = new THREE.Group();
  root.add(mesh([
    S(SPH, grey, [0, 0.13, 0], [0.065, 0.07, 0.12]), S(SPH, neckC, [0, 0.18, 0.08], [0.045, 0.05, 0.045]),
    S(SPH, dark, [0, 0.13, -0.13], [0.04, 0.012, 0.08], [0.3, 0, 0]),
  ], false));
  const head = pivot(root, 0, 0.2, 0.1);
  head.add(mesh([S(SPH, grey, [0, 0.02, 0.02], [0.034, 0.034, 0.04]), S(CONE, [0.25, 0.22, 0.22], [0, 0.015, 0.065], [0.008, 0.03, 0.008], [Math.PI / 2, 0, 0]), S(SPH, [0.9, 0.4, 0.1], [0.02, 0.03, 0.035], [0.007, 0.007, 0.004]), S(SPH, [0.9, 0.4, 0.1], [-0.02, 0.03, 0.035], [0.007, 0.007, 0.004])], false));
  for (const sg of [1, -1]) root.add(mesh([S(LEG, [0.85, 0.45, 0.45], [sg * 0.02, 0.07, 0], [0.006, 0.07, 0.006])], false));
  const wings = [];
  for (const sg of [1, -1]) {
    const g = pivot(root, sg * 0.05, 0.16, 0.0);
    g.add(mesh([S(SPH, grey, [sg * 0.12, 0, -0.02], [0.13, 0.01, 0.06]), S(SPH, dark, [sg * 0.22, 0, -0.04], [0.05, 0.008, 0.04])], false));
    wings.push({ g, sg });
  }
  return { root, wings, head };
}

const DOG_COLS = [[0.45, 0.3, 0.16], [0.12, 0.1, 0.09], [0.85, 0.7, 0.45], [0.92, 0.9, 0.86], [0.6, 0.42, 0.25], [0.3, 0.27, 0.25]];
const CAT_COLS = [[0.5, 0.48, 0.45], [0.1, 0.09, 0.09], [0.85, 0.5, 0.2], [0.92, 0.9, 0.88], [0.55, 0.4, 0.28]];
const HORSE_COLS = [[[0.42, 0.24, 0.12], [0.1, 0.07, 0.05]], [[0.6, 0.32, 0.15], [0.45, 0.22, 0.1]], [[0.78, 0.76, 0.72], [0.55, 0.53, 0.5]], [[0.12, 0.1, 0.09], [0.06, 0.05, 0.05]], [[0.55, 0.42, 0.28], [0.9, 0.85, 0.75]]];

// ---------- Verwaltung ----------
export class AnimalManager {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.dogs = []; this.cats = []; this.horses = []; this.flocks = []; this.pigeons = [];
    this.t = 0; this.scanT = 0;
    this.leashMat = new THREE.LineBasicMaterial({ color: 0x3a1f10 });
  }

  _add(model) { this.group.add(model.root); return model; }
  _remove(a) { this.group.remove(a.m.root); if (a.leash) this.group.remove(a.leash); a.dead = true; }
  gy(x, z) { return this.game.physics.groundHeight(x, z); }
  get daylight() { return (this.game.atm?.night ?? 0) < 0.55; }

  // Punkt auf einem Gehweg (oder der Promenade) in der Nähe
  _sidewalk(x, z, r = 40) {
    const net = this.game.ctx.net;
    const nr = net.nearest(x, z, r, (q) => q.sw >= 2 || q.kind === 'promenade');
    if (!nr) return null;
    const road = nr.road, s = road.cum[nr.i] + (road.cum[nr.i + 1] - road.cum[nr.i]) * nr.t;
    const p = net.pointAt(road, s + rnd(-6, 6), {}), side = Math.random() < 0.5 ? 1 : -1, off = road.w / 2 + Math.max(road.sw, 2) * rnd(0.35, 0.7);
    const px = p.x - p.dz * off * side, pz = p.z + p.dx * off * side;
    const g = this.game.physics;
    if (g.groundHeight(px, pz) < 0.2 || g.poolAt(px, pz) || g.pushCircle({ x: px, z: pz }, 0.3, g.groundHeight(px, pz) + 0.1, g.groundHeight(px, pz) + 0.6)) return null;
    return { x: px, z: pz };
  }

  populate(x, z) { for (let i = 0; i < 6; i++) this._spawnCycle(x, z, true); }

  // ---------- Ereignisse ----------
  scare(x, z, r = 60) {
    for (const c of this.cats) if (Math.hypot(c.x - x, c.z - z) < r) { c.mode = 'flee'; c.t = rnd(3, 5); c.from = { x, z }; }
    for (const h of this.horses) if (Math.hypot(h.x - x, h.z - z) < r * 1.5) { h.mode = 'flee'; h.t = rnd(4, 7); h.from = { x, z }; }
    for (const p of this.pigeons) if (Math.hypot(p.x - x, p.z - z) < r && (p.mode === 'peck' || p.mode === 'idle')) this._takeOff(p, { x, z });
  }

  // ---------- Spawnen ----------
  _spawnCycle(px, pz, initial = false) {
    const g = this.game, ctx = g.ctx;
    // Hunde: Passanten, die spazieren gehen, nehmen manchmal ihren Hund mit
    if (this.dogs.length < 7) {
      for (const c of g.peds.list) {
        if (c.dogChecked || !c.alive || !c.ai || c.ai.mode !== 'walk' || c.state !== 'ground') continue;
        c.dogChecked = true;
        if (Math.random() > 0.16 || !['local', 'elder', 'tourist', 'business'].includes(c.ai.outfit)) continue;
        if (Math.hypot(c.x - px, c.z - pz) < 25 && !initial) continue;
        const k = rnd(0.75, 1.25), m = this._add(dogModel(pick(DOG_COLS), k));
        const leash = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3)), this.leashMat);
        leash.frustumCulled = false; this.group.add(leash);
        this.dogs.push({ m, k, owner: c, x: c.x + 1, z: c.z, h: c.h, sp: 0, phase: 0, leash, sniff: 0, side: Math.random() < 0.5 ? 1 : -1 });
        c.dog = this.dogs[this.dogs.length - 1];
        if (this.dogs.length >= 7) break;
      }
    }
    // Katzen auf Gehwegen in den Orten
    if (this.cats.length < 4) {
      const a = rnd(0, TAU), d = initial ? rnd(15, 120) : rnd(60, 130);
      const s = this._sidewalk(px + Math.cos(a) * d, pz + Math.sin(a) * d, 30);
      if (s && ctx.landuse.get(s.x, s.z) !== LU.NONE) {
        const m = this._add(catModel(pick(CAT_COLS)));
        this.cats.push({ m, x: s.x, z: s.z, h: rnd(0, TAU), mode: 'idle', t: rnd(2, 8), tx: s.x, tz: s.z, sp: 0, phase: 0 });
      }
    }
    // Pferde: kleine Herden auf Wiesen fern von Straßen und Häusern
    if (this.horses.length < 6) {
      const a = rnd(0, TAU), d = initial ? rnd(60, 200) : rnd(140, 240);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      if (this._meadow(x, z)) {
        const n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) {
          const hx = x + rnd(-8, 8), hz = z + rnd(-8, 8);
          if (!this._meadow(hx, hz, 12)) continue;
          const [col, mane] = pick(HORSE_COLS);
          const m = this._add(horseModel(col, mane));
          this.horses.push({ m, x: hx, z: hz, h: rnd(0, TAU), mode: 'graze', t: rnd(3, 12), tx: hx, tz: hz, sp: 0, phase: rnd(0, TAU), head: 1, home: { x, z } });
        }
      }
    }
    // Vogelschwärme am Himmel (an der Küste Möwen)
    if (this.flocks.length < 3 && this.daylight) {
      const a = rnd(0, TAU), d = rnd(40, 220), cx = px + Math.cos(a) * d, cz = pz + Math.sin(a) * d;
      const gull = ctx.coast.sdAt(cx, cz) < 150;
      const n = 5 + Math.floor(Math.random() * 7), birds = [];
      for (let i = 0; i < n; i++) {
        const m = this._add(gull ? birdModel([0.95, 0.95, 0.95], [0.72, 0.74, 0.78], rnd(1.4, 1.8)) : birdModel([0.12, 0.12, 0.14], [0.1, 0.1, 0.12], rnd(0.9, 1.2)));
        birds.push({ m, r: rnd(10, 32), a: rnd(0, TAU), w: rnd(0.25, 0.45) * (Math.random() < 0.5 ? 1 : -1), y: rnd(-5, 5), flap: rnd(0, TAU), glide: 0 });
      }
      this.flocks.push({ x: cx, z: cz, y: this.gy(cx, cz) + rnd(25, 55), vx: rnd(-1.5, 1.5), vz: rnd(-1.5, 1.5), birds });
    }
    // Tauben: Gruppen auf Gehwegen und Plätzen; nah beim Spieler kommen sie aus der Luft angeflogen
    if (this.pigeons.length < 22 && this.daylight) {
      const a = rnd(0, TAU), d = initial ? rnd(12, 90) : rnd(25, 90);
      const s = this._sidewalk(px + Math.cos(a) * d, pz + Math.sin(a) * d, 35);
      if (s && ctx.landuse.get(s.x, s.z) !== LU.NONE) {
        const n = 3 + Math.floor(Math.random() * 6), fly = !initial && d < 60;
        for (let i = 0; i < n; i++) {
          const x = s.x + rnd(-2.2, 2.2), z = s.z + rnd(-2.2, 2.2);
          const m = this._add(pigeonModel());
          const p = { m, x, z, y: this.gy(x, z), h: rnd(0, TAU), mode: 'peck', t: rnd(8, 30), stay: Math.random() < 0.3, peck: 0, step: 0, flap: rnd(0, TAU), vx: 0, vz: 0, vy: 0 };
          if (fly) {   // Anflug: von schräg oben herabgleiten
            const b = rnd(0, TAU), r0 = rnd(18, 30);
            p.gx = x; p.gz = z; p.x = x + Math.cos(b) * r0; p.z = z + Math.sin(b) * r0; p.y = this.gy(x, z) + rnd(12, 20); p.mode = 'land';
          }
          this.pigeons.push(p);
        }
      }
    }
  }

  _meadow(x, z, road = 25) {
    const ctx = this.game.ctx;
    if (ctx.landuse.get(x, z) !== LU.NONE || ctx.coast.sdAt(x, z) < 60) return false;
    const h = ctx.hf.h(x, z);
    if (h < 3 || h > 260 || ctx.hf.baseSlope?.(x, z, 6) > 0.2) return false;
    if (ctx.net.nearest(x, z, road)) return false;
    let hit = false; ctx.buildingHash.query(x - 25, z - 25, x + 25, z + 25, () => { hit = true; });
    return !hit;
  }

  _takeOff(p, from) {
    const dx = p.x - (from?.x ?? p.x - 1), dz = p.z - (from?.z ?? p.z);
    const l = Math.hypot(dx, dz) || 1, a = Math.atan2(dx / l, dz / l) + rnd(-0.6, 0.6);
    p.mode = 'fly'; p.vx = Math.sin(a) * rnd(5, 8); p.vz = Math.cos(a) * rnd(5, 8); p.vy = rnd(3.5, 5.5); p.h = a; p.t = rnd(6, 10);
  }

  // ---------- Bewegung ----------
  update(dt) {
    const g = this.game, pl = g.player;
    const px = pl.vehicle ? pl.vehicle.x : pl.x, pz = pl.vehicle ? pl.vehicle.z : pl.z;
    this.t += dt;
    this.scanT -= dt;
    if (this.scanT <= 0) { this.scanT = 1.5; this._spawnCycle(px, pz); }
    const threats = [pl.vehicle || pl, ...g.vehicles.list.filter((v) => Math.abs(v.speed || 0) > 3 && Math.abs(v.x - px) < 150 && Math.abs(v.z - pz) < 150)];
    const near = (x, z, r) => threats.some((o) => Math.hypot(o.x - x, o.z - z) < r);
    this._dogs(dt, px, pz);
    this._cats(dt, px, pz, near);
    this._horses(dt, px, pz, near);
    this._flocks(dt, px, pz);
    this._pigeons(dt, px, pz, near);
  }

  _legs(m, phase, amp) { for (const L of m.legs) L.g.rotation.x = Math.sin(phase + L.ph) * amp; }

  _dogs(dt, px, pz) {
    for (let i = this.dogs.length - 1; i >= 0; i--) {
      const d = this.dogs[i], o = d.owner;
      const gone = !o || o.dropped || (!o.alive && o.deadT > 20) || Math.hypot(d.x - px, d.z - pz) > 200;
      if (gone) { this._remove(d); if (o) o.dog = null; this.dogs.splice(i, 1); continue; }
      // neben dem Besitzer, etwas dahinter; schnüffelt, wenn er steht
      const fx = Math.sin(o.h), fz = Math.cos(o.h), rx = Math.cos(o.h), rz = -Math.sin(o.h);
      const tx = o.x - rx * d.side * 0.9 - fx * 0.3, tz = o.z - rz * d.side * 0.9 - fz * 0.3;
      const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz);
      const want = o.alive ? Math.min(7, dist * 2.2) : 0;
      d.sp += (want - d.sp) * Math.min(1, dt * 5);
      if (dist > 0.05 && d.sp > 0.05) { d.x += (dx / dist) * d.sp * dt; d.z += (dz / dist) * d.sp * dt; d.h += wrap(Math.atan2(dx, dz) - d.h) * Math.min(1, dt * 7); }
      else d.h += wrap(o.h - d.h) * Math.min(1, dt * 2);
      if (dist > 8) { d.x = tx; d.z = tz; }
      d.phase += d.sp * dt * 6.5;
      const m = d.m, y = this.gy(d.x, d.z);
      m.root.position.set(d.x, y, d.z); m.root.rotation.y = d.h;
      this._legs(m, d.phase, Math.min(0.75, d.sp * 0.32));
      m.tail.rotation.x = 0.2 + Math.sin(this.t * (d.sp > 0.5 ? 14 : 6)) * 0.12;
      m.tail.rotation.z = Math.sin(this.t * 9) * 0.45;
      // Leine: von der Hand des Besitzers zum Halsband, leicht durchhängend
      const vis = !!(o.human && o.human.group.visible && o.alive);
      m.root.visible = vis || !o.human;
      d.leash.visible = vis;
      if (vis) {
        o.human.hand.getWorldPosition(_v);
        const cx = d.x + Math.sin(d.h) * 0.36 * d.k, cy = y + 0.6 * d.k, cz = d.z + Math.cos(d.h) * 0.36 * d.k;
        const arr = d.leash.geometry.attributes.position.array, len = Math.hypot(_v.x - cx, _v.y - cy, _v.z - cz);
        const sag = Math.max(0, 1.6 - len) * 0.35;
        for (let k = 0; k < 12; k++) { const t = k / 11; arr[k * 3] = _v.x + (cx - _v.x) * t; arr[k * 3 + 1] = _v.y + (cy - _v.y) * t - Math.sin(Math.PI * t) * sag; arr[k * 3 + 2] = _v.z + (cz - _v.z) * t; }
        d.leash.geometry.attributes.position.needsUpdate = true;
      }
    }
  }

  _cats(dt, px, pz, near) {
    for (let i = this.cats.length - 1; i >= 0; i--) {
      const c = this.cats[i];
      if (Math.hypot(c.x - px, c.z - pz) > 170) { this._remove(c); this.cats.splice(i, 1); continue; }
      c.t -= dt;
      if (c.mode !== 'flee' && near(c.x, c.z, 4.5)) { c.mode = 'flee'; c.t = rnd(2.5, 4); c.from = { x: px, z: pz }; }
      let sp = 0;
      if (c.mode === 'flee') {
        const dx = c.x - c.from.x, dz = c.z - c.from.z, l = Math.hypot(dx, dz) || 1;
        c.h += wrap(Math.atan2(dx / l, dz / l) - c.h) * Math.min(1, dt * 8); sp = 5;
        if (c.t <= 0) { c.mode = 'idle'; c.t = rnd(3, 8); }
      } else if (c.mode === 'walk') {
        const dx = c.tx - c.x, dz = c.tz - c.z, l = Math.hypot(dx, dz);
        if (l < 0.3 || c.t <= 0) { c.mode = Math.random() < 0.6 ? 'sit' : 'idle'; c.t = rnd(4, 14); }
        else { c.h += wrap(Math.atan2(dx, dz) - c.h) * Math.min(1, dt * 4); sp = 0.7; }
      } else if (c.t <= 0) {
        const s = this._sidewalk(c.x + rnd(-10, 10), c.z + rnd(-10, 10), 14);
        if (s) { c.tx = s.x; c.tz = s.z; c.mode = 'walk'; c.t = 15; } else c.t = 2;
      }
      c.sp += (sp - c.sp) * Math.min(1, dt * 6);
      const nx = c.x + Math.sin(c.h) * c.sp * dt, nz = c.z + Math.cos(c.h) * c.sp * dt;
      const ph = this.game.physics, ng = ph.groundHeight(nx, nz);
      if (ng > 0.1 && !ph.poolAt(nx, nz) && !ph.pushCircle({ x: nx, z: nz }, 0.15, ng + 0.05, ng + 0.4)) { c.x = nx; c.z = nz; } else { c.h += Math.PI * 0.6; }
      c.phase += c.sp * dt * 9;
      const m = c.m, sit = c.mode === 'sit' ? 1 : 0;
      c.sitK = (c.sitK ?? 0) + (sit - (c.sitK ?? 0)) * Math.min(1, dt * 4);
      m.root.position.set(c.x, this.gy(c.x, c.z) - c.sitK * 0.05, c.z); m.root.rotation.y = c.h; m.root.rotation.x = -c.sitK * 0.45;
      this._legs(m, c.phase, Math.min(0.8, c.sp * 0.3));
      m.legs[2].g.rotation.x += c.sitK * 1.2; m.legs[3].g.rotation.x += c.sitK * 1.2;
      m.tail.rotation.x = c.mode === 'flee' ? -0.9 : 0.15 + Math.sin(this.t * 1.3 + i) * 0.15;
    }
  }

  _horses(dt, px, pz, near) {
    const pl = this.game.player;
    for (let i = this.horses.length - 1; i >= 0; i--) {
      const h = this.horses[i];
      if (Math.hypot(h.x - px, h.z - pz) > 320) { this._remove(h); this.horses.splice(i, 1); continue; }
      h.t -= dt;
      if (h.mode !== 'flee' && near(h.x, h.z, 9)) { h.mode = 'flee'; h.t = rnd(3, 5); h.from = { x: px, z: pz }; }
      let sp = 0, headDown = 0;
      if (h.mode === 'flee') {
        const dx = h.x - h.from.x, dz = h.z - h.from.z, l = Math.hypot(dx, dz) || 1;
        h.h += wrap(Math.atan2(dx / l, dz / l) - h.h) * Math.min(1, dt * 3); sp = 4.5;
        if (h.t <= 0) { h.mode = 'graze'; h.t = rnd(4, 10); }
      } else if (h.mode === 'walk') {
        const dx = h.tx - h.x, dz = h.tz - h.z, l = Math.hypot(dx, dz);
        if (l < 0.6 || h.t <= 0) { h.mode = 'graze'; h.t = rnd(6, 16); }
        else { h.h += wrap(Math.atan2(dx, dz) - h.h) * Math.min(1, dt * 1.5); sp = 1.1; }
      } else {
        headDown = 1;
        if (h.t <= 0) {
          const a = rnd(0, TAU), r = rnd(4, 14), tx = h.home.x + Math.cos(a) * r, tz = h.home.z + Math.sin(a) * r;
          if (this._meadow(tx, tz, 15)) { h.tx = tx; h.tz = tz; h.mode = 'walk'; h.t = 20; } else h.t = 3;
        }
      }
      h.sp += (sp - h.sp) * Math.min(1, dt * 2.5);
      const nx = h.x + Math.sin(h.h) * h.sp * dt, nz = h.z + Math.cos(h.h) * h.sp * dt;
      if (this.game.ctx.net.nearest(nx, nz, 6) || this.game.ctx.coast.sdAt(nx, nz) < 20) h.h += Math.PI * 0.5; else { h.x = nx; h.z = nz; }
      // Spieler zu Fuß wird sanft weggeschoben (Pferde sind fest)
      if (!pl.vehicle) { const dx = pl.x - h.x, dz = pl.z - h.z, l = Math.hypot(dx, dz); if (l < 1.0 && l > 0.01) { pl.x = h.x + (dx / l) * 1.0; pl.z = h.z + (dz / l) * 1.0; } }
      h.phase += h.sp * dt * (h.sp > 2.5 ? 3.6 : 4.2);
      h.head += (headDown - h.head) * Math.min(1, dt * 1.2);
      const m = h.m, gy = this.gy(h.x, h.z);
      m.root.position.set(h.x, gy + (h.sp > 2.5 ? Math.abs(Math.sin(h.phase)) * 0.08 : 0), h.z); m.root.rotation.y = h.h;
      this._legs(m, h.phase, Math.min(0.55, h.sp * 0.18));
      m.neck.rotation.x = h.head * 1.45 + Math.sin(this.t * 0.7 + i) * 0.05 * h.head;
      m.tail.rotation.z = Math.sin(this.t * 1.7 + i * 2) * 0.25;
    }
  }

  _flocks(dt, px, pz) {
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const f = this.flocks[i];
      f.x += f.vx * dt; f.z += f.vz * dt;
      if (Math.hypot(f.x - px, f.z - pz) > 420 || (!this.daylight && Math.random() < dt * 0.2)) { for (const b of f.birds) this._remove(b); this.flocks.splice(i, 1); continue; }
      for (const b of f.birds) {
        b.a += b.w * dt;
        const x = f.x + Math.cos(b.a) * b.r, z = f.z + Math.sin(b.a) * b.r, y = f.y + b.y + Math.sin(this.t * 0.6 + b.flap) * 1.5;
        b.glide -= dt;
        if (b.glide < -2.5 && Math.random() < dt * 0.5) b.glide = rnd(1, 3);
        const flapping = b.glide <= 0;
        b.flap += dt * (flapping ? 11 : 0);
        const m = b.m;
        m.root.position.set(x, y, z);
        // Flugrichtung tangential zum Kreis (gegen bzw. mit dem Uhrzeigersinn), in die Kurve geneigt
        m.root.rotation.set(0, b.w > 0 ? -b.a : Math.PI - b.a, b.w > 0 ? 0.35 : -0.35);
        for (const w of m.wings) w.g.rotation.z = w.sg * (flapping ? Math.sin(b.flap) * 0.7 : 0.08);
      }
    }
  }

  _pigeons(dt, px, pz, near) {
    for (let i = this.pigeons.length - 1; i >= 0; i--) {
      const p = this.pigeons[i];
      const dist = Math.hypot(p.x - px, p.z - pz);
      if (dist > 150 || (p.mode === 'fly' && p.t <= 0)) { this._remove(p); this.pigeons.splice(i, 1); continue; }
      p.t -= dt;
      const m = p.m;
      if (p.mode === 'land') {
        // Anflug und Landung
        const gy = this.gy(p.gx, p.gz), dx = p.gx - p.x, dz = p.gz - p.z, l = Math.hypot(dx, dz);
        p.h = Math.atan2(dx, dz);
        const sp = Math.min(7, 1.5 + l * 0.6);
        if (l > 0.1) { p.x += (dx / l) * sp * dt; p.z += (dz / l) * sp * dt; }
        p.y += (gy + Math.min(l * 0.7, 20) - p.y) * Math.min(1, dt * 2.5);
        p.flap += dt * (l < 3 ? 20 : 10);
        if (l < 0.15 && p.y - gy < 0.15) { p.mode = 'peck'; p.y = gy; p.t = rnd(8, 25); }
      } else if (p.mode === 'fly') {
        p.vy = Math.max(1.2, p.vy - dt * 0.8);
        p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
        p.flap += dt * 18;
      } else {
        // am Boden: trippeln, picken; bei Annäherung auffliegen (sture Tauben erst ganz nah)
        if (near(p.x, p.z, p.stay ? 2.4 : 5.5)) { this._takeOff(p, { x: px, z: pz }); continue; }
        if (!p.stay && p.t <= 0) { this._takeOff(p, null); continue; }
        p.step -= dt;
        if (p.step <= 0) { p.step = rnd(0.6, 2.5); p.h += rnd(-1.2, 1.2); p.walk = Math.random() < 0.5 ? rnd(0.3, 0.8) : 0; }
        if (p.walk > 0) {
          const nx = p.x + Math.sin(p.h) * 0.35 * dt, nz = p.z + Math.cos(p.h) * 0.35 * dt;
          if (this.gy(nx, nz) > 0.1) { p.x = nx; p.z = nz; } p.walk -= dt;
        }
        p.y = this.gy(p.x, p.z);
        p.peck = Math.max(0, p.peck - dt * 3);
        if (p.peck <= 0 && Math.random() < dt * 1.2) p.peck = 1;
      }
      const air = p.mode === 'fly' || p.mode === 'land';
      m.root.position.set(p.x, p.y, p.z); m.root.rotation.y = p.h; m.root.rotation.x = air ? -0.15 : 0;
      // Flügel: am Boden angelegt, in der Luft schlagend
      for (const w of m.wings) { w.g.rotation.z = air ? w.sg * (0.2 + Math.sin(p.flap) * 0.9) : w.sg * -0.05; w.g.rotation.y = air ? 0 : w.sg * 1.25; }   // angelegt: nach hinten
      // Kopfnicken beim Laufen, Picken nach unten
      m.head.rotation.x = air ? -0.2 : Math.sin(Math.PI * p.peck) * 1.1;
      m.head.position.z = 0.1 + (air ? 0 : Math.sin(this.t * 9 + i) * 0.012 * (p.walk > 0 ? 1 : 0));
    }
  }

  dispose() { this.game.scene.remove(this.group); }
}
