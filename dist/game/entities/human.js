// Menschliche Figur: Low-Poly-Mesh mit Skelett (Skinned), prozedurale Animation, Outfits.
import * as THREE from 'three';
import { MeshBuilder } from '../world/meshbuilder.js';
import { clamp, lerp, mulberry32, damp } from '../util.js';

const BONE = { hips: 0, spine: 1, head: 2, armL: 3, armR: 4, foreL: 5, foreR: 6, legL: 7, legR: 8, shinL: 9, shinR: 10 };

// ---------- Farbpaletten ----------
const SKIN = [[0.96, 0.8, 0.68], [0.9, 0.72, 0.56], [0.8, 0.6, 0.44], [0.62, 0.43, 0.3], [0.45, 0.3, 0.2], [0.98, 0.86, 0.76]];
const HAIR = [[0.1, 0.07, 0.05], [0.25, 0.15, 0.08], [0.5, 0.32, 0.14], [0.85, 0.7, 0.4], [0.15, 0.1, 0.08], [0.6, 0.6, 0.6], [0.55, 0.12, 0.08]];
const SHIRTS = [[0.9, 0.9, 0.88], [0.1, 0.35, 0.7], [0.85, 0.2, 0.2], [0.95, 0.75, 0.2], [0.2, 0.6, 0.4], [0.9, 0.5, 0.15], [0.12, 0.12, 0.14], [0.6, 0.3, 0.7], [0.45, 0.75, 0.85], [0.95, 0.45, 0.6], [0.8, 0.78, 0.6]];
const PANTS = [[0.12, 0.17, 0.3], [0.2, 0.2, 0.22], [0.75, 0.68, 0.52], [0.9, 0.9, 0.88], [0.32, 0.4, 0.55], [0.25, 0.2, 0.15], [0.7, 0.2, 0.2]];

export function randomOutfit(rng, kind = 'local') {
  const p = (a) => a[Math.floor(rng() * a.length)];
  const female = kind === 'player_lucia' ? true : kind.startsWith('player') ? false : rng() < 0.46;
  const o = { skin: p(SKIN), hair: p(HAIR), shirt: p(SHIRTS), pants: p(PANTS), shoes: [0.15, 0.15, 0.17], female, sleeves: rng() < 0.6 ? 0 : 1, shorts: false, glasses: rng() < 0.25, hat: false, hairStyle: female ? (rng() < 0.7 ? 'long' : 'bob') : rng() < 0.15 ? 'bald' : 'short', build: 1, height: 0.94 + rng() * 0.12 };
  switch (kind) {
    case 'tourist': o.shorts = true; o.sleeves = 0; o.shirt = p([[0.95, 0.45, 0.3], [0.2, 0.7, 0.85], [0.95, 0.85, 0.3], [0.95, 0.6, 0.75], [0.85, 0.95, 0.9]]); o.pants = p([[0.85, 0.8, 0.65], [0.3, 0.45, 0.7], [0.9, 0.9, 0.9]]); o.shoes = [0.9, 0.9, 0.85]; o.hat = rng() < 0.4; o.glasses = rng() < 0.6; break;
    case 'beach': o.shorts = true; o.sleeves = 0; o.bare = true; o.pants = p([[0.1, 0.5, 0.8], [0.9, 0.3, 0.2], [0.95, 0.8, 0.2], [0.2, 0.2, 0.25], [0.85, 0.2, 0.55]]); o.shirt = o.pants; o.shoes = o.skin; break;
    case 'business': o.shirt = p([[0.15, 0.17, 0.25], [0.3, 0.3, 0.33], [0.9, 0.9, 0.92]]); o.pants = [0.14, 0.15, 0.2]; o.sleeves = 1; o.shoes = [0.08, 0.06, 0.05]; break;
    case 'clubber': o.shirt = p([[0.9, 0.1, 0.6], [0.1, 0.9, 0.9], [0.95, 0.9, 0.2], [0.15, 0.15, 0.2], [0.7, 0.2, 0.95]]); o.pants = p([[0.1, 0.1, 0.12], [0.85, 0.85, 0.9], [0.2, 0.3, 0.7]]); o.glasses = rng() < 0.4; break;
    case 'jogger': o.shorts = true; o.sleeves = 0; o.shirt = p([[0.2, 0.9, 0.4], [0.95, 0.4, 0.1], [0.2, 0.5, 0.95]]); o.pants = [0.1, 0.1, 0.12]; o.shoes = [0.95, 0.95, 0.95]; break;
    case 'worker': o.shirt = [0.95, 0.5, 0.1]; o.pants = [0.2, 0.25, 0.4]; o.hat = true; o.hatColor = [0.95, 0.85, 0.1]; break;
    case 'cop': o.shirt = [0.18, 0.28, 0.5]; o.pants = [0.1, 0.13, 0.2]; o.sleeves = 1; o.hat = true; o.hatColor = [0.12, 0.17, 0.3]; o.shoes = [0.05, 0.05, 0.06]; o.hairStyle = 'short'; o.female = false; break;
    case 'swat': o.shirt = [0.1, 0.11, 0.13]; o.pants = [0.1, 0.11, 0.13]; o.sleeves = 1; o.hat = true; o.hatColor = [0.07, 0.07, 0.08]; o.shoes = [0.05, 0.05, 0.05]; o.female = false; o.build = 1.15; o.vest = true; break;
    case 'gangster': o.shirt = p([[0.12, 0.12, 0.14], [0.55, 0.1, 0.1], [0.9, 0.9, 0.9], [0.15, 0.3, 0.15]]); o.pants = p([[0.1, 0.1, 0.12], [0.25, 0.3, 0.45]]); o.glasses = rng() < 0.5; o.female = false; o.build = 1.08; break;
    case 'elder': o.hair = [0.75, 0.75, 0.75]; o.height = 0.9; o.shirt = p([[0.8, 0.78, 0.6], [0.6, 0.7, 0.8], [0.8, 0.75, 0.85]]); o.pants = p([[0.35, 0.3, 0.25], [0.5, 0.5, 0.55]]); o.hat = rng() < 0.3; o.hatColor = [0.85, 0.8, 0.6]; break;
    case 'vendor': o.shirt = p([[0.95, 0.9, 0.7], [0.3, 0.6, 0.3]]); o.hat = true; o.hatColor = [0.9, 0.8, 0.5]; break;
    case 'sailor': o.shirt = [0.95, 0.95, 0.95]; o.pants = [0.1, 0.18, 0.35]; o.hat = true; o.hatColor = [0.95, 0.95, 0.95]; break;
    case 'player_jason': o.skin = SKIN[1]; o.hair = [0.14, 0.09, 0.06]; o.shirt = [0.1, 0.1, 0.12]; o.pants = [0.25, 0.3, 0.42]; o.sleeves = 0; o.hairStyle = 'short'; o.shoes = [0.9, 0.9, 0.9]; o.glasses = false; o.height = 1.04; o.build = 1.1; break;
    case 'player_lucia': o.skin = SKIN[2]; o.hair = [0.08, 0.05, 0.04]; o.shirt = [0.9, 0.25, 0.4]; o.pants = [0.12, 0.13, 0.16]; o.sleeves = 0; o.hairStyle = 'long'; o.shoes = [0.1, 0.1, 0.1]; o.glasses = false; o.height = 0.96; o.build = 0.95; break;
    default: break;
  }
  return o;
}

// ---------- Geometrie ----------
const geoCache = new Map();

function buildGeometry(o) {
  const key = JSON.stringify(o);
  if (geoCache.has(key)) return geoCache.get(key);
  const parts = []; // { bone, mb }
  const mk = (bone) => { const mb = new MeshBuilder(); parts.push({ bone, mb }); return mb; };
  const S = o.build, shirt = o.shirt, pants = o.pants, skin = o.skin;
  const dark = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

  const b = (mb, cx, cy, cz, rx, ry, rz, col, lvl = 1) => blobBox(mb, cx, cy, cz, rx, ry, rz, col, lvl);
  // Becken (abgerundet statt Quader)
  const hips = mk(BONE.hips);
  b(hips, 0, 0.9, 0, 0.19 * S, 0.14, 0.12, pants, 1);
  // Oberkörper: Bauch, Brust und Schultern als weiche Ellipsoide
  const sp = mk(BONE.spine);
  const torsoCol = o.bare ? skin : shirt;
  b(sp, 0, 1.07, 0, 0.168 * S, 0.2, 0.1, torsoCol, 1);
  b(sp, 0, 1.31, 0, 0.2 * S, 0.17, 0.12, torsoCol, 2);
  b(sp, 0, 1.42, 0, 0.215 * S, 0.055, 0.095, torsoCol, 1);
  if (o.female) { b(sp, -0.06 * S, 1.29, 0.075, 0.075, 0.07, 0.065, torsoCol, 1); b(sp, 0.06 * S, 1.29, 0.075, 0.075, 0.07, 0.065, torsoCol, 1); }
  if (o.vest) sp.box(0, 1.2, 0, 0.42 * S, 0.36, 0.28, 0, 0.08, 0.09, 0.1);
  if (o.id === 'cop' || (!o.bare && shirt[0] < 0.2 && shirt[2] > 0.4)) sp.box(0.12 * S, 1.3, 0.115, 0.07, 0.07, 0.01, 0, 0.9, 0.8, 0.3); // Abzeichen
  // Gürtel
  hips.box(0, 0.98, 0, 0.35 * S, 0.045, 0.2, 0, 0.1, 0.08, 0.07);
  // Kopf + Hals
  const hd = mk(BONE.head);
  hd.cylinder(0, 1.5, 0, 0.055, 0.05, 0.1, 8, ...skin);
  b(hd, 0, 1.66, 0.005, 0.105, 0.125, 0.115, skin, 2);
  // Augen/Nase
  hd.box(-0.04, 1.675, 0.112, 0.022, 0.02, 0.012, 0, 0.08, 0.06, 0.05); hd.box(0.04, 1.675, 0.112, 0.022, 0.02, 0.012, 0, 0.08, 0.06, 0.05);
  hd.box(0, 1.64, 0.118, 0.025, 0.04, 0.03, 0, ...dark(skin, 0.95));
  hd.box(0, 1.6, 0.11, 0.05, 0.012, 0.01, 0, 0.6, 0.25, 0.25);
  if (o.glasses) hd.box(0, 1.678, 0.118, 0.19, 0.04, 0.03, 0, 0.04, 0.04, 0.05);
  // Haare
  if (o.hairStyle !== 'bald') {
    b(hd, 0, 1.72, -0.01, 0.112, 0.085, 0.12, o.hair);
    if (o.hairStyle === 'long') { b(hd, 0, 1.6, -0.075, 0.125, 0.19, 0.085, o.hair); b(hd, 0, 1.45, -0.07, 0.1, 0.12, 0.06, o.hair); }
    else if (o.hairStyle === 'bob') b(hd, 0, 1.62, -0.06, 0.128, 0.1, 0.1, o.hair);
  }
  if (o.hat) {
    const hc = o.hatColor || dark(o.shirt, 0.8);
    hd.cylinder(0, 1.76, 0, 0.125, 0.12, 0.07, 10, ...hc);
    hd.box(0, 1.755, 0.12, 0.2, 0.012, 0.12, 0, ...hc);
  }
  // Arme
  for (const side of [1, -1]) {
    const ua = mk(side > 0 ? BONE.armL : BONE.armR), fa = mk(side > 0 ? BONE.foreL : BONE.foreR);
    const sx = 0.235 * S * side;
    const sleeveCol = o.bare ? skin : shirt;
    ua.cylinder(sx, 1.18, 0, 0.056, 0.062, 0.27, 7, ...(o.sleeves ? sleeveCol : (o.bare ? skin : dark(shirt, 0.98))));
    if (!o.sleeves) ua.cylinder(sx, 1.18, 0, 0.056, 0.062, 0.11, 7, ...skin);
    blobBox(ua, sx, 1.425, 0, 0.06, 0.062, 0.06, torsoCol, 1);
    fa.cylinder(sx, 0.9, 0, 0.042, 0.052, 0.27, 7, ...(o.sleeves ? sleeveCol : skin));
    blobBox(fa, sx, 0.88, 0.0, 0.05, 0.055, 0.05, skin, 0);
  }
  // Beine
  for (const side of [1, -1]) {
    const th = mk(side > 0 ? BONE.legL : BONE.legR), sh = mk(side > 0 ? BONE.shinL : BONE.shinR);
    const lx = 0.095 * S * side;
    const thCol = o.shorts ? (o.bare ? pants : pants) : pants;
    th.cylinder(lx, 0.5, 0, 0.072, 0.092, 0.45, 8, ...thCol);
    blobBox(th, lx, 0.5, 0, 0.075, 0.075, 0.075, thCol, 0);
    sh.cylinder(lx, 0.09, 0, 0.05, 0.068, 0.42, 8, ...(o.shorts ? skin : pants));
    sh.box(lx, 0.0, 0.05, 0.105, 0.085, 0.27, 0, ...o.shoes);
    sh.box(lx, 0.075, -0.0, 0.1, 0.03, 0.2, 0, ...dark(o.shoes, 1.1));
  }

  // Zusammenführen mit Skin-Daten
  const pos = [], nor = [], col = [], idx = [], si = [], sw = [];
  let off = 0;
  for (const { bone, mb } of parts) {
    for (let i = 0; i < mb.n; i++) {
      pos.push(mb.pos[i * 3], mb.pos[i * 3 + 1] * o.height, mb.pos[i * 3 + 2]);
      nor.push(mb.nor[i * 3], mb.nor[i * 3 + 1], mb.nor[i * 3 + 2]);
      col.push(Math.pow(mb.col[i * 3], 2.2), Math.pow(mb.col[i * 3 + 1], 2.2), Math.pow(mb.col[i * 3 + 2], 2.2));
      si.push(bone, 0, 0, 0); sw.push(1, 0, 0, 0);
    }
    for (const j of mb.idx) idx.push(j + off);
    off += mb.n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.boundingSphere.radius = 1.6;
  geoCache.set(key, g);
  return g;
}

// Facettierter Ellipsoid (Kopf, Gelenke)
function blobBox(mb, cx, cy, cz, rx, ry, rz, col, level = 1) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...p); return p.map((q) => q / l); });
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) {
    const cache = new Map(); const nf = [];
    const mid = (a, b2) => { const k = a < b2 ? a * 1000 + b2 : b2 * 1000 + a; if (cache.has(k)) return cache.get(k); const m = [(v[a][0] + v[b2][0]) / 2, (v[a][1] + v[b2][1]) / 2, (v[a][2] + v[b2][2]) / 2]; const le = Math.hypot(...m); v.push(m.map((q) => q / le)); cache.set(k, v.length - 1); return v.length - 1; };
    for (const [a, b2, c] of f) { const ab = mid(a, b2), bc = mid(b2, c), ca = mid(c, a); nf.push([a, ab, ca], [b2, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  const vv = v.map((p) => [cx + p[0] * rx, cy + p[1] * ry, cz + p[2] * rz]);
  for (const [a, b2, c] of f) {
    // glatte Normalen (Ellipsoid)
    const n = (i) => { const p = v[i]; const q = [p[0] / rx, p[1] / ry, p[2] / rz]; const l = Math.hypot(...q) || 1; return [q[0] / l, q[1] / l, q[2] / l]; };
    const i0 = mb.n;
    for (const i of [a, b2, c]) { const nn = n(i); mb.vert(vv[i][0], vv[i][1], vv[i][2], nn[0], nn[1], nn[2], 0, 0, col[0], col[1], col[2]); }
    mb.idx.push(i0, i0 + 1, i0 + 2);
  }
}

// ---------- Rig ----------
function makeRig() {
  const B = {};
  const mk = (name, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); B[name] = b; return b; };
  const hips = mk('hips', 0, 0.95, 0);
  const spine = mk('spine', 0, 0.12, 0); hips.add(spine);
  const head = mk('head', 0, 0.4, 0); spine.add(head);
  const armL = mk('armL', 0.235, 0.32, 0); spine.add(armL);
  const armR = mk('armR', -0.235, 0.32, 0); spine.add(armR);
  const foreL = mk('foreL', 0, -0.27, 0); armL.add(foreL);
  const foreR = mk('foreR', 0, -0.27, 0); armR.add(foreR);
  const legL = mk('legL', 0, 0, 0); hips.add(legL);
  const legR = mk('legR', 0, 0, 0); hips.add(legR);
  const shinL = mk('shinL', 0, -0.45, 0); legL.add(shinL);
  const shinR = mk('shinR', 0, -0.45, 0); legR.add(shinR);
  // Bindpose liegt in Modellkoordinaten (Gelenke bei absoluten Positionen): Knochen sitzen an den Gelenken
  // Arme/Beine: Gelenkposition = Schulter bzw. Hüfte → Knoten x
  legL.position.set(0.095, 0, 0); legR.position.set(-0.095, 0, 0);
  return { B, bones: [hips, spine, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR] };
}

const humanMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });

export class Human {
  constructor(outfit) {
    this.outfit = outfit;
    const geo = buildGeometry(outfit);
    const { B, bones } = makeRig();
    this.B = B;
    // Knochen liegen an den Gelenken; die Geometrie nutzt absolute Koordinaten → Bindpose über Inverse
    this.mesh = new THREE.SkinnedMesh(geo, humanMat);
    this.mesh.add(B.hips);
    this.mesh.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);
    this.mesh.bind(skeleton, new THREE.Matrix4());
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    // Waffen-Haltepunkt (rechte Hand)
    this.hand = new THREE.Group();
    this.hand.position.set(0, -0.27, 0.02);
    B.foreR.add(this.hand);
    this.phase = Math.random() * 6;
    this.lastSpeed = 0;
    this.stateT = 0;
    this.deadT = 0;
    this.pose = { lean: 0 };
  }

  setWeapon(obj) {
    while (this.hand.children.length) this.hand.remove(this.hand.children[0]);
    if (obj) this.hand.add(obj);
  }

  // st: { speed, aim, aimPitch, sit, driving, dead, swim, dance, punch, phone, lie, wheel(-1..1), crouch, throw }
  update(dt, st) {
    const B = this.B;
    const spd = st.speed || 0;
    const targetPhase = spd * dt * (spd > 3.2 ? 1.45 : 2.2);
    this.phase += targetPhase;
    const ph = this.phase;
    this.stateT += dt;
    const reset = () => {
      for (const k in B) { B[k].rotation.set(0, 0, 0); }
      B.hips.position.set(0, 0.95, 0);
      B.armL.rotation.z = -0.08; B.armR.rotation.z = 0.08;
    };
    reset();
    this.group.rotation.x = 0;
    this.mesh.position.set(0, 0, 0);

    if (st.dead) {
      this.deadT = Math.min(1, this.deadT + dt * 2.2);
      const k = this.deadT;
      this.group.rotation.x = -k * 1.5;
      this.mesh.position.set(0, k * 0.12, -0.1 * k);
      B.legL.rotation.x = 0.1 * k; B.legR.rotation.x = -0.15 * k; B.armL.rotation.z = -0.9 * k; B.armR.rotation.z = 0.7 * k;
      return;
    }
    this.deadT = 0;

    if (st.driving) {
      B.hips.position.y = 0.62;
      B.legL.rotation.x = -1.45; B.legR.rotation.x = -1.45; B.shinL.rotation.x = 1.5; B.shinR.rotation.x = 1.5;
      const w = st.wheel || 0;
      B.armL.rotation.x = -1.05; B.armR.rotation.x = -1.05; B.foreL.rotation.x = -0.4; B.foreR.rotation.x = -0.4;
      B.armL.rotation.y = -w * 0.5; B.armR.rotation.y = -w * 0.5;
      B.spine.rotation.x = -0.05;
      B.head.rotation.y = clamp(w * 0.4, -0.5, 0.5);
      return;
    }
    if (st.lie) {
      this.group.rotation.x = -Math.PI / 2;
      this.mesh.position.set(0, 0.2, 0);
      B.armL.rotation.z = -0.3; B.armR.rotation.z = 0.3; B.legL.rotation.z = -0.1; B.legR.rotation.z = 0.1;
      B.spine.rotation.x = Math.sin(this.stateT * 1.3) * 0.015;
      return;
    }
    if (st.sit) {
      B.hips.position.y = 0.5;
      B.legL.rotation.x = -1.5; B.legR.rotation.x = -1.5; B.shinL.rotation.x = 1.5; B.shinR.rotation.x = 1.5;
      B.armL.rotation.x = -0.5; B.armR.rotation.x = -0.5; B.foreL.rotation.x = -0.9; B.foreR.rotation.x = -0.9;
      B.head.rotation.y = Math.sin(this.stateT * 0.6) * 0.3;
      return;
    }
    if (st.swim) {
      const t = this.stateT * 4.5;
      this.group.rotation.x = 1.1;
      this.mesh.position.set(0, -0.05, 0);
      B.armL.rotation.x = Math.sin(t) * 2.6 - 1.4; B.armR.rotation.x = Math.sin(t + Math.PI) * 2.6 - 1.4;
      B.legL.rotation.x = Math.sin(t * 2) * 0.5; B.legR.rotation.x = Math.sin(t * 2 + Math.PI) * 0.5;
      B.head.rotation.x = -0.9;
      return;
    }
    if (st.dance) {
      const t = this.stateT * 6;
      B.hips.position.y = 0.95 + Math.abs(Math.sin(t)) * 0.05;
      B.hips.rotation.y = Math.sin(t * 0.5) * 0.4;
      B.armL.rotation.x = -2.6 + Math.sin(t) * 0.5; B.armR.rotation.x = -2.6 + Math.sin(t + 1.6) * 0.5;
      B.armL.rotation.z = -0.4; B.armR.rotation.z = 0.4; B.foreL.rotation.x = -0.5; B.foreR.rotation.x = -0.5;
      B.legL.rotation.x = Math.sin(t) * 0.35; B.legR.rotation.x = Math.sin(t + Math.PI) * 0.35; B.shinL.rotation.x = Math.max(0, -Math.sin(t)) * 0.6; B.shinR.rotation.x = Math.max(0, Math.sin(t)) * 0.6;
      return;
    }

    // Gehen / Rennen / Stehen
    const run = clamp((spd - 1.2) / 4.5, 0, 1.2);
    const amp = clamp(spd / 2.2, 0, 1) * (0.5 + run * 0.62);
    const s = Math.sin(ph), c = Math.cos(ph);
    B.legL.rotation.x = -s * amp;
    B.legR.rotation.x = s * amp;
    B.shinL.rotation.x = Math.max(0, c * s > 0 ? 0 : -s) * amp * 0.95 + (spd > 0.2 ? 0.08 : 0);
    B.shinR.rotation.x = Math.max(0, s) * amp * 0.95 + (spd > 0.2 ? 0.08 : 0);
    // Arme gegenphasig
    const armAmp = amp * 0.85;
    B.armL.rotation.x = s * armAmp; B.armR.rotation.x = -s * armAmp;
    B.foreL.rotation.x = -0.15 - run * 0.9; B.foreR.rotation.x = -0.15 - run * 0.9;
    B.hips.position.y = 0.95 - (st.crouch ? 0.28 : 0) + Math.abs(c) * 0.03 * amp * 1.6;
    B.spine.rotation.x = run * 0.22 + (st.crouch ? 0.25 : 0);
    B.spine.rotation.y = s * 0.12 * amp;
    B.hips.rotation.y = -s * 0.1 * amp;
    if (st.crouch) { B.legL.rotation.x -= 0.7; B.legR.rotation.x -= 0.7; B.shinL.rotation.x += 1.3; B.shinR.rotation.x += 1.3; }
    if (spd < 0.2) {
      const br = Math.sin(this.stateT * 1.6) * 0.012;
      B.spine.rotation.x += br; B.armL.rotation.x = br * 2; B.armR.rotation.x = -br * 2;
      B.head.rotation.y = Math.sin(this.stateT * 0.4) * 0.05;
    }
    // Zielen / Waffe halten
    if (st.aim) {
      const p = st.aimPitch || 0;
      B.armR.rotation.set(-(Math.PI / 2 + p) + 0.04, 0.12, 0.05);
      B.foreR.rotation.set(-0.05, 0, 0);
      if (st.twoHanded) { B.armL.rotation.set(-(Math.PI / 2 + p) + 0.1, -0.5, 0.1); B.foreL.rotation.set(-0.45, 0, 0); }
      else { B.armL.rotation.x = s * armAmp * 0.3; }
      B.spine.rotation.y = -0.2; B.head.rotation.x = -p * 0.5;
    } else if (st.holding) {
      B.armR.rotation.set(-0.5, 0, 0.1); B.foreR.rotation.set(-0.9, 0, 0);
    }
    if (st.phone) { B.armR.rotation.set(-2.2, 0, 0.3); B.foreR.rotation.set(-1.6, 0, 0); B.head.rotation.x = 0.1; }
    if (st.punch > 0) {
      const k = st.punch; // 1 → 0
      const sw = Math.sin((1 - k) * Math.PI);
      B.armR.rotation.set(-1.5 * sw - 0.2, 0.2, 0); B.foreR.rotation.set(-0.2 - 0.4 * (1 - sw), 0, 0);
      B.spine.rotation.y = -0.45 * sw;
    }
    if (st.throw > 0) {
      const k = st.throw; const sw = Math.sin((1 - k) * Math.PI);
      B.armR.rotation.set(-2.6 + (1 - k) * 3.2, 0, 0.2); B.spine.rotation.x += 0.2 * sw;
    }
  }
}
