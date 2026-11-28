// Unterwasserwelt: Muscheln, Seesterne, Steine, Seegraswiesen und hohe Wasserpflanzen am Meeresboden, dazu Fischschwärme.
// Alles nur rund um die Kamera, nur im Meer (nicht in Pools) und nur, wenn die Kamera in der Nähe des Wassers ist.
// Instanz-Meshes: wenige Draw-Calls; Pflanzen wiegen und Fische schlagen mit der Schwanzflosse im Vertex-Shader.
import * as THREE from 'three';
import { ihash, noise2 } from '../util.js';

const CELL = 10;          // Raster der Bodenobjekte (m)
const R = 62;             // Radius um die Kamera
const MAX = { shell: 1100, grass: 1600, kelp: 320, rock: 260, urchin: 220 };
const SCHOOLS = 8, PER_SCHOOL = 14, LONERS = 6;

// ---------- Geometrien ----------
function geo(pos, col, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Jakobsmuschel: gerippter Fächer, leicht gewölbt (Radius ~1, wird skaliert)
function shellGeo() {
  const pos = [0, 0.05, -0.55], col = [0.85, 0.8, 0.72], idx = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const a = -1.25 + (2.5 * i) / N, rib = i % 2 ? 1 : 0.93;
    for (const [r, y] of [[0.5, 0.22], [1.0, 0.06]]) {
      pos.push(Math.sin(a) * r * rib, y * (i % 2 ? 1.25 : 1), -0.55 + Math.cos(a) * r * rib);
      const k = i % 2 ? 1 : 0.8;
      col.push(k, k * 0.92, k * 0.85);
    }
  }
  for (let i = 0; i < N; i++) {
    const a0 = 1 + i * 2, a1 = 1 + (i + 1) * 2;
    idx.push(0, a1, a0, a0, a1, a1 + 1, a0, a1 + 1, a0 + 1);
  }
  return geo(pos, col, idx);
}

// Seestern: fünf flache Arme
function starGeo() {
  const pos = [0, 0.12, 0], col = [1, 1, 1], idx = [];
  const N = 10;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, r = i % 2 ? 0.32 : 1;
    pos.push(Math.sin(a) * r, i % 2 ? 0.06 : 0.02, Math.cos(a) * r);
    col.push(i % 2 ? 0.85 : 1, i % 2 ? 0.85 : 1, i % 2 ? 0.85 : 1);
  }
  for (let i = 0; i < N; i++) idx.push(0, 1 + ((i + 1) % N), 1 + i);
  return geo(pos, col, idx);
}

// Stein: verbeultes Ikosaeder, unten flach
function rockGeo() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  const col = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.75 + 0.35 * ihash(Math.round(x * 7), Math.round(z * 7), Math.round(y * 7) + 11);
    p.setXYZ(i, x * k, Math.max(-0.2, y * k * 0.62), z * k);
    const moss = y > 0.3 ? 0.35 : 0;
    col.push(0.42 - moss * 0.15, 0.4 + moss * 0.12, 0.36 - moss * 0.12);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Seeigel: dunkle Kugel mit Stacheln
function urchinGeo() {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const spike = ihash(Math.round(x * 50), Math.round(z * 50), Math.round(y * 50) + 3) > 0.55 ? 1.9 : 0.85;
    p.setXYZ(i, x * spike, Math.max(-0.3, y * spike * 0.8), z * spike);
    col.push(0.22, 0.08, 0.2);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Pflanzenbüschel: mehrere schmale, nach oben spitz zulaufende Blätter (Höhe 1, wird skaliert)
function bladesGeo(n, seed, curl = 0.25) {
  const pos = [], col = [], idx = [];
  for (let b = 0; b < n; b++) {
    const a = ihash(b, seed, 3) * Math.PI * 2, off = 0.12 * ihash(b, seed, 4);
    const ox = Math.cos(a) * off, oz = Math.sin(a) * off, lean = 0.1 + ihash(b, seed, 5) * curl;
    const w = 0.045 + ihash(b, seed, 6) * 0.03, hgt = 0.65 + ihash(b, seed, 7) * 0.35;
    const base = pos.length / 3;
    const S = 4;
    for (let s = 0; s <= S; s++) {
      const t = s / S, ww = w * (1 - t * 0.85);
      const cx = ox + Math.cos(a) * lean * t * t, cz = oz + Math.sin(a) * lean * t * t;
      const px = -Math.sin(a) * ww, pz = Math.cos(a) * ww;
      pos.push(cx - px, t * hgt, cz - pz, cx + px, t * hgt, cz + pz);
      const k = 0.55 + t * 0.45;
      col.push(k, k, k, k, k, k);
    }
    for (let s = 0; s < S; s++) { const i = base + s * 2; idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); }
  }
  return geo(pos, col, idx);
}

// Fisch (Länge 1, schaut nach +z): Körper als Spindel, Schwanzflosse, Rücken- und Brustflossen; Rücken dunkel, Bauch hell
function fishGeo() {
  const pos = [], col = [], idx = [];
  const ST = 9, RS = 8;
  for (let i = 0; i <= ST; i++) {
    const t = i / ST, z = -0.5 + t;
    const prof = Math.sin(Math.PI * Math.min(1, t * 1.08)) ** 0.75;
    const h = 0.17 * prof + 0.012, w = 0.065 * prof + 0.008;
    for (let j = 0; j < RS; j++) {
      const a = (j / RS) * Math.PI * 2, y = Math.cos(a) * h, x = Math.sin(a) * w;
      pos.push(x, y, z);
      const k = y > 0 ? 0.45 + 0.25 * (1 - y / h) : 0.95;
      col.push(k, k, k);
    }
  }
  for (let i = 0; i < ST; i++) for (let j = 0; j < RS; j++) {
    const a = i * RS + j, b = i * RS + ((j + 1) % RS), c = a + RS, d = b + RS;
    idx.push(a, c, b, b, c, d);
  }
  const tri = (p1, p2, p3, k) => { const i = pos.length / 3; pos.push(...p1, ...p2, ...p3); col.push(k, k, k, k, k, k, k, k, k); idx.push(i, i + 1, i + 2); };
  tri([0, 0, -0.46], [0, 0.2, -0.74], [0, 0.02, -0.6], 0.5);
  tri([0, 0, -0.46], [0, 0.02, -0.6], [0, -0.2, -0.74], 0.5);
  tri([0, 0.15, -0.05], [0, 0.27, -0.2], [0, 0.13, 0.15], 0.45);
  tri([0.05, -0.05, 0.18], [0.16, -0.12, 0.05], [0.05, -0.07, 0.08], 0.8);
  tri([-0.05, -0.05, 0.18], [-0.05, -0.07, 0.08], [-0.16, -0.12, 0.05], 0.8);
  return geo(pos, col, idx);
}

// Shader-Zusätze: Pflanzen wiegen in der Strömung, Fische schlagen mit dem Schwanz
function sway(mat, uTime, amp) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float uph = instanceMatrix[3][0] * 0.31 + instanceMatrix[3][2] * 0.47;
#else
  float uph = 0.0;
#endif
  float uh = max(position.y, 0.0);
  transformed.x += sin(uTime * 1.3 + uph + uh * 2.2) * ${amp.toFixed(3)} * uh * uh;
  transformed.z += cos(uTime * 1.05 + uph * 1.3 + uh * 1.7) * ${(amp * 0.6).toFixed(3)} * uh * uh;`);
  };
}
function wiggle(mat, uTime) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  float fph = instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 2.3 + instanceMatrix[3][1] * 3.1;
#else
  float fph = 0.0;
#endif
  float tail = smoothstep(0.25, -0.75, position.z);
  transformed.x += sin(uTime * 10.0 + fph - position.z * 7.0) * 0.07 * (0.25 + tail);`);
  };
}

export class Underwater {
  constructor(game) {
    this.game = game;
    this.uTime = { value: 0 };
    this.group = new THREE.Group();
    game.scene.add(this.group);
    const std = (o = {}) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, ...o });
    const mk = (g, m, n) => { const im = new THREE.InstancedMesh(g, m, n); im.count = 0; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.setColorAt(0, new THREE.Color(1, 1, 1)); this.group.add(im); return im; };
    const plantMat = std({ side: THREE.DoubleSide, roughness: 0.9 });
    sway(plantMat, this.uTime, 0.12);
    const kelpMat = std({ side: THREE.DoubleSide, roughness: 0.9 });
    sway(kelpMat, this.uTime, 0.07);
    const fishMat = std({ side: THREE.DoubleSide, roughness: 0.32, metalness: 0.35 });
    wiggle(fishMat, this.uTime);
    this.m = {
      shell: mk(shellGeo(), std({ roughness: 0.55 }), MAX.shell),
      star: mk(starGeo(), std({ roughness: 0.7 }), Math.floor(MAX.shell / 2)),
      rock: mk(rockGeo(), std({ roughness: 0.95, flatShading: true }), MAX.rock),
      urchin: mk(urchinGeo(), std({ roughness: 0.6, flatShading: true }), MAX.urchin),
      grass: mk(bladesGeo(9, 1), plantMat, MAX.grass),
      kelp: mk(bladesGeo(5, 2, 0.55), kelpMat, MAX.kelp),
      fish: mk(fishGeo(), fishMat, SCHOOLS * PER_SCHOOL + LONERS),
    };
    this.cellKey = '';
    this.schools = [];
    this.fish = [];
    this.visible = false;
    this.group.visible = false;
    this._o = new THREE.Object3D();
    this._c = new THREE.Color();
  }

  // Meeresboden an (x,z): Höhe, wenn dort Meer ist (nicht Pool, nicht Land), sonst null
  _seabed(x, z) {
    const g = this.game, ph = g.physics;
    if (g.ctx.coast.sdAt(x, z) > -1) return null;
    if (ph.poolAt(x, z)) return null;
    const y = ph.groundHeight(x, z);
    return y < -0.7 && y > -45 ? y : null;
  }

  update(dt, cam) {
    const g = this.game, p = g.player;
    this.uTime.value += dt;
    const cx = cam.position.x, cz = cam.position.z;
    // Nur in der Nähe des Meeres und nicht hoch darüber (z. B. Flugzeug)
    const sd = g.ctx.coast.sdAt(cx, cz);
    const near = cam.position.y < 35 && sd < 45;
    if (near !== this.visible) { this.visible = near; this.group.visible = near; }
    if (!near) return;
    // Bodenobjekte neu verteilen, wenn die Kamera in eine andere Rasterzelle wechselt
    const kx = Math.floor(cx / CELL), kz = Math.floor(cz / CELL), key = kx + ',' + kz;
    if (key !== this.cellKey) { this.cellKey = key; this._layout(kx, kz); }
    this._fishUpdate(Math.min(dt, 0.05), cam, p);
  }

  _layout(kx, kz) {
    const o = this._o, col = this._c;
    const n = { shell: 0, star: 0, rock: 0, grass: 0, kelp: 0, urchin: 0 };
    const put = (name, x, y, z, s, ry, tilt, c) => {
      const im = this.m[name];
      if (n[name] >= im.instanceMatrix.count) return;
      o.position.set(x, y, z); o.rotation.set(tilt, ry, tilt * 0.6); o.scale.set(s, s, s); o.updateMatrix();
      im.setMatrixAt(n[name], o.matrix);
      col.setRGB(c[0], c[1], c[2]);
      im.setColorAt(n[name], col);
      n[name]++;
    };
    const cr = Math.ceil(R / CELL);
    for (let i = -cr; i <= cr; i++) for (let j = -cr; j <= cr; j++) {
      const ix = kx + i, iz = kz + j;
      if (i * i + j * j > cr * cr + 1) continue;
      const x0 = ix * CELL, z0 = iz * CELL;
      const h = (k) => ihash(ix * 31 + k, iz * 17 - k, 901 + k);
      // Seegraswiese (Posidonia) in Flecken, sonst vereinzelt
      const meadow = Math.max(0, Math.min(1, (noise2(x0 / 46, z0 / 46, 5) - 0.36) * 3.2));
      const nGrass = Math.round(meadow * 18 + 1 + h(1) * 2.5);
      for (let k = 0; k < nGrass; k++) {
        const x = x0 + h(10 + k) * CELL, z = z0 + h(40 + k) * CELL, y = this._seabed(x, z);
        if (y === null) continue;
        const tint = 0.75 + h(70 + k) * 0.3;
        put('grass', x, y - 0.03, z, 0.55 + h(100 + k) * 0.7 + (y < -6 ? 0.3 : 0), h(130 + k) * 6.28, 0, [0.24 * tint, 0.6 * tint, 0.2 * tint]);
      }
      // hohe Wasserpflanzen in tieferem Wasser
      if (h(2) < 0.45) {
        const x = x0 + h(3) * CELL, z = z0 + h(4) * CELL, y = this._seabed(x, z);
        if (y !== null && y < -3) put('kelp', x, y - 0.05, z, Math.min(-y - 0.8, 1.4 + h(5) * 1.8), h(6) * 6.28, 0, [0.42, 0.45, 0.2]);
      }
      // Muscheln (hell, rosa, orange) und Seesterne
      const nShell = 2 + Math.floor(h(7) * 5);
      for (let k = 0; k < nShell; k++) {
        const x = x0 + h(200 + k) * CELL, z = z0 + h(230 + k) * CELL, y = this._seabed(x, z);
        if (y === null) continue;
        const pal = [[0.98, 0.92, 0.84], [0.98, 0.72, 0.7], [0.95, 0.66, 0.4], [0.86, 0.84, 0.95], [0.9, 0.86, 0.7]][Math.floor(h(260 + k) * 5)];
        put('shell', x, y + 0.01, z, 0.09 + h(290 + k) * 0.09, h(320 + k) * 6.28, (h(350 + k) - 0.5) * 0.5, pal);
      }
      if (h(8) < 0.65) {
        const x = x0 + h(9) * CELL, z = z0 + h(11) * CELL, y = this._seabed(x, z);
        if (y !== null) put('star', x, y + 0.01, z, 0.13 + h(12) * 0.1, h(13) * 6.28, 0, [[0.95, 0.4, 0.18], [0.85, 0.22, 0.25], [0.6, 0.3, 0.75], [0.98, 0.62, 0.2]][Math.floor(h(14) * 4)]);
      }
      // Seeigel (gern an Steinen)
      if (h(20) < 0.45) {
        const x = x0 + h(21) * CELL, z = z0 + h(22) * CELL, y = this._seabed(x, z);
        if (y !== null) put('urchin', x, y + 0.02, z, 0.05 + h(23) * 0.04, h(24) * 6.28, 0, [1, 1, 1]);
      }
      // Steine
      if (h(15) < 0.5) {
        const x = x0 + h(16) * CELL, z = z0 + h(17) * CELL, y = this._seabed(x, z);
        if (y !== null) put('rock', x, y - 0.05, z, 0.25 + h(18) * 0.7, h(19) * 6.28, 0, [0.95, 0.95, 0.95]);
      }
    }
    for (const k of Object.keys(n)) {
      const im = this.m[k];
      im.count = n[k];
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  // ---------- Fische ----------
  _spawnSchool(s, cam, first) {
    const g = this.game;
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, r = first ? 4 + Math.random() * 16 : 16 + Math.random() * 14;
      const x = cam.position.x + Math.cos(a) * r, z = cam.position.z + Math.sin(a) * r;
      const y = this._seabed(x, z);
      if (y === null || y > -1.6) continue;
      s.x = x; s.z = z; s.y = Math.max(y + 0.8, Math.min(-0.8, y * (0.35 + Math.random() * 0.4)));
      s.ok = true;
      s.tx = s.x; s.tz = s.z; s.ty = s.y; s.retarget = 0;
      for (const f of s.fish) { f.x = s.x + (Math.random() - 0.5) * 2; f.y = s.y + (Math.random() - 0.5) * 0.6; f.z = s.z + (Math.random() - 0.5) * 2; f.vx = f.vy = f.vz = 0; }
      return;
    }
    s.ok = false;
  }

  _fishUpdate(dt, cam, p) {
    const g = this.game;
    if (!this.schools.length) {
      const species = [
        { col: [0.8, 0.85, 0.92], size: 0.32, speed: 1.6 },   // Brasse (silbern)
        { col: [1.0, 0.82, 0.25], size: 0.26, speed: 1.9 },   // Goldstrieme
        { col: [0.4, 0.62, 1.0], size: 0.36, speed: 1.4 },    // Meerbrasse (bläulich)
        { col: [1.0, 0.55, 0.3], size: 0.24, speed: 2.1 },    // Meerjunker (orange)
        { col: [0.62, 0.68, 0.58], size: 0.42, speed: 1.2 },  // Meeräsche
        { col: [0.9, 0.9, 0.96], size: 0.28, speed: 1.8 },
        { col: [0.95, 0.4, 0.5], size: 0.22, speed: 2.0 },    // Rotbarbe
        { col: [0.5, 0.95, 0.75], size: 0.2, speed: 2.2 },    // Lippfisch (grünlich)
      ];
      for (let i = 0; i < SCHOOLS; i++) {
        const sp = species[i % species.length];
        const s = { sp, fish: [], ok: false };
        for (let k = 0; k < PER_SCHOOL; k++) s.fish.push({ ox: (Math.random() - 0.5) * 3.2, oy: (Math.random() - 0.5) * 1.0, oz: (Math.random() - 0.5) * 3.2, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: sp.size * (0.85 + Math.random() * 0.3) });
        this.schools.push(s);
      }
      // Einzelgänger (größer: Zackenbarsch, Oktopus-Ersatz)
      const lone = { sp: { col: [0.55, 0.42, 0.32], size: 0.55, speed: 0.9 }, fish: [], ok: false, loner: true };
      for (let k = 0; k < LONERS; k++) lone.fish.push({ ox: (Math.random() - 0.5) * 30, oy: 0, oz: (Math.random() - 0.5) * 30, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0.45 + Math.random() * 0.25 });
      this.schools.push(lone);
      for (const s of this.schools) this._spawnSchool(s, cam, true);
    }
    const o = this._o, col = this._c, im = this.m.fish;
    const px = p.vehicle ? p.vehicle.x : p.x, py = p.vehicle ? p.vehicle.y : p.y + 1, pz = p.vehicle ? p.vehicle.z : p.z;
    let n = 0;
    for (const s of this.schools) {
      const far = Math.hypot(s.x - cam.position.x, s.z - cam.position.z);
      if (!s.ok || far > 70) { this._spawnSchool(s, cam, false); if (!s.ok) continue; }
      // Ziel des Schwarms: ab und zu neu, im Wasser zwischen Boden und Oberfläche; vor dem Spieler weichen sie aus
      s.retarget -= dt;
      const dp = Math.hypot(s.x - px, s.z - pz);
      if (s.retarget <= 0 || Math.hypot(s.tx - s.x, s.tz - s.z) < 1.5 || (dp < 5 && !s.fled)) {
        for (let t = 0; t < 6; t++) {
          let a = Math.random() * Math.PI * 2;
          if (dp < 5) a = Math.atan2(s.z - pz, s.x - px) + (Math.random() - 0.5);
          const r = 8 + Math.random() * 14, tx = s.x + Math.cos(a) * r, tz = s.z + Math.sin(a) * r, y = this._seabed(tx, tz);
          if (y === null || y > -1.4) continue;
          s.tx = tx; s.tz = tz; s.ty = Math.max(y + 0.7, Math.min(-0.7, y * (0.3 + Math.random() * 0.45)));
          break;
        }
        s.retarget = 6 + Math.random() * 8;
        s.fled = dp < 5;
      }
      if (dp > 7) s.fled = false;
      const sp = s.sp.speed * (s.fled ? 2.4 : 1);
      const dx = s.tx - s.x, dy = s.ty - s.y, dz = s.tz - s.z, L = Math.hypot(dx, dy, dz) || 1;
      s.x += (dx / L) * sp * dt; s.y += (dy / L) * sp * 0.5 * dt; s.z += (dz / L) * sp * dt;
      const hdg = Math.atan2(dx, dz);
      for (const f of s.fish) {
        // Platz im Schwarm (dreht mit der Schwimmrichtung), dazu etwas Eigenleben
        const c = Math.cos(hdg), sn = Math.sin(hdg);
        const wob = Math.sin(this.uTime.value * 0.7 + f.ox * 3) * 0.4;
        const tx = s.loner ? s.x + f.ox : s.x + f.ox * c + f.oz * sn + wob, ty = s.y + f.oy, tz = s.loner ? s.z + f.oz : s.z - f.ox * sn + f.oz * c;
        f.vx += ((tx - f.x) * 2.2 - f.vx * 1.6) * dt; f.vy += ((ty - f.y) * 2.2 - f.vy * 1.6) * dt; f.vz += ((tz - f.z) * 2.2 - f.vz * 1.6) * dt;
        // Spieler zu nah: wegschnellen
        const ex = f.x - px, ey = f.y - py, ez = f.z - pz, ed = Math.hypot(ex, ey, ez);
        if (ed < 3.2 && ed > 0.01) { f.vx += (ex / ed) * 14 * dt; f.vy += (ey / ed) * 6 * dt; f.vz += (ez / ed) * 14 * dt; }
        f.x += f.vx * dt + (s.x - (s.px ?? s.x)) * 0; f.y += f.vy * dt; f.z += f.vz * dt;
        if (!s.loner) { f.x += (dx / L) * sp * dt; f.z += (dz / L) * sp * dt; }
        // zwischen Boden und Oberfläche bleiben
        const gy = g.physics.groundHeight(f.x, f.z);
        if (f.y < gy + 0.3) { f.y = gy + 0.3; f.vy = Math.abs(f.vy) * 0.3; }
        if (f.y > -0.35) { f.y = -0.35; f.vy = -Math.abs(f.vy) * 0.3; }
        const vx = f.vx + (s.loner ? 0 : (dx / L) * sp), vz = f.vz + (s.loner ? 0 : (dz / L) * sp);
        const yaw = Math.atan2(vx, vz);
        o.position.set(f.x, f.y, f.z);
        o.rotation.set(-Math.atan2(f.vy, Math.hypot(vx, vz) + 0.3) * 0.6, yaw, 0, 'YXZ');
        o.scale.setScalar(f.s);
        o.updateMatrix();
        im.setMatrixAt(n, o.matrix);
        col.setRGB(...s.sp.col);
        im.setColorAt(n, col);
        n++;
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.game.scene.remove(this.group);
    for (const im of Object.values(this.m)) { im.geometry.dispose(); im.material.dispose(); im.dispose?.(); }
  }
}
