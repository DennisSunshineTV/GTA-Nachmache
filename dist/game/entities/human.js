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
    // Mann (player_jason): schlank-athletisch, enges schwarzes Rundhals-Shirt, dunkelblaue Jeans (gerader Schnitt), weiße Sneaker, Kette mit Plättchen, Armband rechts, Smartwatch links, Handy in der rechten Hand
    case 'player_jason': o.skin = [0.9, 0.72, 0.58]; o.hair = [0.09, 0.06, 0.045]; o.shirt = [0.06, 0.06, 0.07]; o.pants = [0.16, 0.25, 0.44]; o.sleeves = 0; o.hairStyle = 'quiff'; o.shoes = [0.95, 0.95, 0.94]; o.glasses = false; o.height = 1.07; o.build = 1.04; o.fit = true; o.jeans = 'straight'; o.sneakers = true; o.necklace = true; o.armband = true; o.watch = true; o.phone = true; break;
    // Frau (player_lucia): schmal, enges schwarzes Shirt mit Bootsausschnitt, dunkelblaue Bootcut-Jeans, weiße Sneaker, Kette, Armband rechts, Handy in der rechten Hand, dunkles Haar hochgesteckt
    case 'player_lucia': o.skin = [0.93, 0.76, 0.64]; o.hair = [0.07, 0.05, 0.05]; o.shirt = [0.06, 0.06, 0.07]; o.pants = [0.17, 0.26, 0.46]; o.sleeves = 0; o.hairStyle = 'updo'; o.shoes = [0.95, 0.95, 0.94]; o.glasses = false; o.height = 0.97; o.build = 0.93; o.fit = true; o.boatneck = true; o.jeans = 'bootcut'; o.sneakers = true; o.necklace = true; o.armband = true; o.phone = true; break;
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
  const wAb = o.fit ? (o.female ? 0.136 : 0.15) : 0.168, wCh = o.fit ? (o.female ? 0.168 : 0.206) : 0.2, wSh = o.fit ? (o.female ? 0.19 : 0.228) : 0.215;
  b(sp, 0, 1.07, 0, wAb * S, 0.2, o.fit ? 0.088 : 0.1, torsoCol, 1);
  b(sp, 0, 1.31, 0, wCh * S, 0.17, o.fit ? 0.112 : 0.12, torsoCol, 2);
  b(sp, 0, 1.42, 0, wSh * S, 0.055, 0.095, torsoCol, 1);
  if (o.boatneck) {
    // Bootsausschnitt: Schlüsselbeine und Schultern frei
    b(sp, 0, 1.425, 0.09, 0.112, 0.03, 0.034, skin, 1);
    b(sp, 0, 1.425, -0.09, 0.112, 0.03, 0.034, skin, 1);
  } else if (o.fit) {
    sp.cylinder(0, 1.455, 0, 0.068, 0.064, 0.04, 9, shirt[0] * 1.6, shirt[1] * 1.6, shirt[2] * 1.6);   // Kragen (Rundhals)
  }
  if (o.female) { b(sp, -0.06 * S, 1.29, 0.075, 0.075, 0.07, 0.065, torsoCol, 1); b(sp, 0.06 * S, 1.29, 0.075, 0.075, 0.07, 0.065, torsoCol, 1); }
  // Kette mit Plättchen (Silber): Ring um den Hals, V nach vorn, Anhänger
  if (o.necklace) {
    const sv = [0.82, 0.84, 0.88];
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; sp.box(Math.sin(a) * 0.062, 1.468, Math.cos(a) * 0.062 + (Math.cos(a) > 0 ? 0.008 : 0), 0.009, 0.009, 0.009, 0, ...sv); }
    for (const t of [0.25, 0.5, 0.75]) for (const sg of [-1, 1]) sp.box(sg * 0.058 * (1 - t), 1.465 - 0.1 * t, 0.082 + 0.03 * t + (o.boatneck ? 0.006 : 0), 0.011, 0.011, 0.011, 0, ...sv);
    sp.box(0, 1.352, 0.123, 0.034, 0.034, 0.008, 0, 0.9, 0.91, 0.95);
  }
  if (o.vest) sp.box(0, 1.2, 0, 0.42 * S, 0.36, 0.28, 0, 0.08, 0.09, 0.1);
  if (o.id === 'cop' || (!o.bare && shirt[0] < 0.2 && shirt[2] > 0.4)) sp.box(0.12 * S, 1.3, 0.115, 0.07, 0.07, 0.01, 0, 0.9, 0.8, 0.3); // Abzeichen
  // Gürtel
  if (o.fit) {
    // Jeans: Bund in Jeansfarbe, Knopf, Reißverschluss, Taschen
    hips.box(0, 0.975, 0, 0.352 * S, 0.04, 0.2, 0, pants[0] * 1.15, pants[1] * 1.15, pants[2] * 1.15);
    hips.box(0, 0.952, 0.118, 0.014, 0.075, 0.012, 0, ...dark(pants, 0.62));
    hips.box(0, 0.975, 0.121, 0.02, 0.02, 0.01, 0, 0.85, 0.85, 0.88);
    for (const sg of [-1, 1]) {
      hips.box(sg * 0.105 * S, 0.945, 0.111, 0.07, 0.012, 0.012, 0, ...dark(pants, 0.62));
      hips.box(sg * 0.105 * S, 0.865, -0.108, 0.09, 0.075, 0.012, 0, ...dark(pants, 0.78));
    }
  } else hips.box(0, 0.98, 0, 0.35 * S, 0.045, 0.2, 0, 0.1, 0.08, 0.07);
  // Kopf + Hals
  const hd = mk(BONE.head);
  hd.cylinder(0, 1.5, 0, 0.055, 0.05, 0.1, 8, ...skin);
  b(hd, 0, 1.66, 0.005, 0.105, 0.125, 0.115, skin, 2);
  // Augen/Nase
  hd.box(-0.04, 1.675, 0.112, 0.022, 0.02, 0.012, 0, 0.08, 0.06, 0.05); hd.box(0.04, 1.675, 0.112, 0.022, 0.02, 0.012, 0, 0.08, 0.06, 0.05);
  hd.box(0, 1.64, 0.118, 0.025, 0.04, 0.03, 0, ...dark(skin, 0.95));
  hd.box(0, 1.6, 0.11, 0.05, 0.012, 0.01, 0, 0.6, 0.25, 0.25);
  if (o.glasses) hd.box(0, 1.678, 0.118, 0.19, 0.04, 0.03, 0, 0.04, 0.04, 0.05);
  if (o.fit) for (const sg of [-1, 1]) hd.box(sg * 0.042, 1.706, 0.108, 0.05, 0.011, 0.012, sg * 0.12, o.hair[0] * 1.1, o.hair[1] * 1.1, o.hair[2] * 1.1);
  // Haare
  if (o.hairStyle === 'quiff') {
    // Mann: Deckhaar mit Volumen, nach hinten gekämmte Stirnpartie, kurze Seiten
    const hc = o.hair;
    b(hd, 0, 1.725, -0.012, 0.114, 0.08, 0.124, hc);
    b(hd, 0, 1.775, 0.025, 0.088, 0.05, 0.09, hc, 2);
    b(hd, 0, 1.762, 0.088, 0.09, 0.028, 0.046, hc);
    for (const sg of [-1, 1]) b(hd, sg * 0.102, 1.675, -0.012, 0.028, 0.075, 0.1, hc);
    b(hd, 0, 1.655, -0.098, 0.106, 0.09, 0.05, hc);
  } else if (o.hairStyle === 'updo') {
    // Frau: Mittelscheitel, nach hinten gebunden zu einem hohen Dutt, lose Strähnen am Gesicht
    const hc = o.hair;
    b(hd, 0, 1.722, -0.012, 0.115, 0.078, 0.125, hc);
    for (const sg of [-1, 1]) { b(hd, sg * 0.099, 1.678, 0.0, 0.03, 0.082, 0.105, hc); b(hd, sg * 0.093, 1.585, 0.055, 0.014, 0.088, 0.022, hc); }
    b(hd, 0, 1.66, -0.1, 0.102, 0.092, 0.045, hc);
    b(hd, 0, 1.795, -0.098, 0.064, 0.06, 0.064, hc, 2);
  } else if (o.hairStyle !== 'bald') {
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
    if (o.armband && side < 0) {
      // Schwarzes Stoffband mit Knoten am unteren Oberarm
      ua.cylinder(sx, 1.2, 0, 0.064, 0.067, 0.055, 9, 0.035, 0.035, 0.04);
      blobBox(ua, sx - 0.07, 1.235, 0.01, 0.026, 0.042, 0.032, [0.035, 0.035, 0.04], 0);
      blobBox(ua, sx - 0.06, 1.2, -0.03, 0.02, 0.04, 0.025, [0.035, 0.035, 0.04], 0);
    }
    fa.cylinder(sx, 0.9, 0, 0.042, 0.052, 0.27, 7, ...(o.sleeves ? sleeveCol : skin));
    blobBox(fa, sx, 0.88, 0.0, 0.05, 0.055, 0.05, skin, 0);
    if (o.watch && side > 0) {
      fa.cylinder(sx, 0.915, 0, 0.05, 0.05, 0.04, 9, 0.04, 0.04, 0.045);
      fa.box(sx + 0.046, 0.915, 0, 0.02, 0.042, 0.04, 0, 0.05, 0.06, 0.08);
      fa.box(sx + 0.058, 0.922, 0, 0.004, 0.028, 0.028, 0, 0.18, 0.3, 0.45);
    }
  }
  // Beine
  for (const side of [1, -1]) {
    const th = mk(side > 0 ? BONE.legL : BONE.legR), sh = mk(side > 0 ? BONE.shinL : BONE.shinR);
    const lx = 0.095 * S * side;
    const thCol = o.shorts ? (o.bare ? pants : pants) : pants;
    th.cylinder(lx, 0.5, 0, 0.072, 0.092, 0.45, 8, ...thCol);
    blobBox(th, lx, 0.5, 0, 0.075, 0.075, 0.075, thCol, 0);
    if (o.jeans) {
      // Hosenbein reicht bis auf den Schuh; Bootcut weitet sich zum Saum
      const hem = o.jeans === 'bootcut' ? 0.082 : 0.06;
      sh.cylinder(lx, 0.04, 0, hem, 0.068, 0.47, 9, ...pants);
      sh.cylinder(lx, 0.04, 0, hem * 1.012, hem * 1.012, 0.014, 9, ...dark(pants, 0.7));
    } else sh.cylinder(lx, 0.09, 0, 0.05, 0.068, 0.42, 8, ...(o.shorts ? skin : pants));
    if (o.sneakers) {
      const w = [0.96, 0.96, 0.95];
      sh.box(lx, 0.0, 0.065, 0.112, 0.03, 0.3, 0, 0.9, 0.9, 0.88);                       // Sohle
      sh.box(lx, 0.03, 0.055, 0.102, 0.052, 0.27, 0, ...w);                              // Schaft
      blobBox(sh, lx, 0.058, 0.17, 0.052, 0.036, 0.055, w, 1);                            // Kappe
      sh.box(lx, 0.082, 0.04, 0.056, 0.012, 0.1, 0, 0.82, 0.82, 0.85);                    // Schnürung
      sh.box(lx, 0.05, -0.085, 0.07, 0.04, 0.02, 0, 0.8, 0.8, 0.82);                      // Fersenlasche
    } else {
      sh.box(lx, 0.0, 0.05, 0.105, 0.085, 0.27, 0, ...o.shoes);
      sh.box(lx, 0.075, -0.0, 0.1, 0.03, 0.2, 0, ...dark(o.shoes, 1.1));
    }
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
    this.group.rotation.order = 'YXZ';   // erst kippen, dann in Blickrichtung drehen (Liegen auf dem Rücken, Schwimmen, Umfallen)
    this.group.add(this.mesh);
    // Waffen-Haltepunkt (rechte Hand)
    this.hand = new THREE.Group();
    this.hand.position.set(0, -0.27, 0.02);
    B.foreR.add(this.hand);
    if (outfit.phone) {
      const ph = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.146, 0.011), new THREE.MeshStandardMaterial({ color: 0x0c0d12, roughness: 0.3, metalness: 0.6 }));
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.136), new THREE.MeshStandardMaterial({ color: 0x1a2a44, roughness: 0.15, metalness: 0.2, emissive: 0x16263f, emissiveIntensity: 0.5 }));
      screen.position.z = -0.0058; screen.rotation.y = Math.PI;
      ph.add(body, screen);
      ph.position.set(0.012, -0.29 * (outfit.height || 1), 0.05);
      ph.rotation.x = -0.28;
      B.foreR.add(ph);
      this.phoneMesh = ph;
    }
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
    if (this.phoneMesh) this.phoneMesh.visible = (this.hand.children.length === 0 || !!st.phone) && !st.driving && !st.dead && !st.swim && !st.lie;
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
      // Bewegung 0..1 weich überblenden (Stand: Wassertreten, schwimmen: Kraulen, getaucht: Brustschwimmen)
      const mv = clamp(spd / 2.6, 0, 1);
      this.swimMv = (this.swimMv ?? mv) + (mv - (this.swimMv ?? mv)) * Math.min(1, dt * 4);
      const m = this.swimMv, t = this.stateT;
      if (st.dive) {
        const c = t * 2.4, k = Math.sin(c), pull = Math.max(0, k);
        this.group.rotation.x = 1.35 + st.diveDir * 0.35;
        this.mesh.position.set(0, -0.1, 0);
        B.armL.rotation.x = -2.9 + pull * 1.9; B.armR.rotation.x = -2.9 + pull * 1.9;
        B.armL.rotation.z = -0.25 - pull * 0.9; B.armR.rotation.z = 0.25 + pull * 0.9;
        B.foreL.rotation.x = -0.2 - pull * 0.5; B.foreR.rotation.x = -0.2 - pull * 0.5;
        const kick = Math.max(0, Math.sin(c + 1.4));
        B.legL.rotation.x = 0.1 + kick * 0.35; B.legR.rotation.x = 0.1 + kick * 0.35; B.legL.rotation.z = -0.25 * kick; B.legR.rotation.z = 0.25 * kick;
        B.shinL.rotation.x = 1.4 * (1 - kick); B.shinR.rotation.x = 1.4 * (1 - kick);
        B.head.rotation.x = -0.75;
        return;
      }
      const tr = t * 2.6, cr = t * (3.2 + m * 2.2);
      this.group.rotation.x = 0.22 + m * 1.0 + Math.sin(tr * 2) * 0.03 * (1 - m);
      this.mesh.position.set(0, -0.05 + Math.sin(tr * 2) * 0.04 * (1 - m), 0);
      // Wassertreten: Arme kreisen seitlich, Beine radeln
      const aTx = -0.5 + Math.cos(tr) * 0.3, aTz = 0.95 + Math.sin(tr) * 0.25;
      // Kraulen: Arme abwechselnd über Kopf, Beine flattern
      const aCl = Math.sin(cr) * 2.6 - 1.4, aCr = Math.sin(cr + Math.PI) * 2.6 - 1.4;
      B.armL.rotation.x = aTx * (1 - m) + aCl * m; B.armR.rotation.x = (-0.5 + Math.cos(tr + Math.PI) * 0.3) * (1 - m) + aCr * m;
      B.armL.rotation.z = -aTz * (1 - m) - 0.15 * m; B.armR.rotation.z = aTz * (1 - m) + 0.15 * m;
      B.foreL.rotation.x = -0.6 * (1 - m); B.foreR.rotation.x = -0.6 * (1 - m);
      B.legL.rotation.x = Math.sin(tr) * 0.55 * (1 - m) + Math.sin(cr * 2) * 0.45 * m; B.legR.rotation.x = Math.sin(tr + Math.PI) * 0.55 * (1 - m) + Math.sin(cr * 2 + Math.PI) * 0.45 * m;
      B.shinL.rotation.x = (0.7 + Math.sin(tr) * 0.4) * (1 - m) + 0.15 * m; B.shinR.rotation.x = (0.7 + Math.sin(tr + Math.PI) * 0.4) * (1 - m) + 0.15 * m;
      B.head.rotation.x = -0.2 * (1 - m) - 0.95 * m;
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

    if (st.climb !== null && st.climb !== undefined) {
      // Arme greifen nach oben und drücken sich ab, Beine werden angezogen
      const k = st.climb, up = Math.sin(Math.PI * Math.min(1, k * 1.15));
      B.armL.rotation.x = B.armR.rotation.x = -2.7 + k * 2.2;
      B.foreL.rotation.x = B.foreR.rotation.x = -0.25 - up * 0.7;
      B.legL.rotation.x = -1.35 * up; B.shinL.rotation.x = 1.5 * up;
      B.legR.rotation.x = -0.75 * up; B.shinR.rotation.x = 1.1 * up;
      B.spine.rotation.x = 0.45 * up;
      this.hand.visible = false;
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
    if (st.phone) { B.armR.rotation.set(-2.1, 0, 0.6); B.foreR.rotation.set(-2.1, 0, 0); B.head.rotation.set(0.05, -0.18, -0.3); }
    if (this.phoneMesh) {
      // am Ohr: Bildschirm zum Kopf; sonst locker in der Hand
      const h = this.outfit.height || 1;
      if (st.phone) { this.phoneMesh.position.set(0.04, -0.37 * h, 0.02); this.phoneMesh.rotation.set(-0.12, -Math.PI / 2, 0); }
      else { this.phoneMesh.position.set(0.012, -0.29 * h, 0.05); this.phoneMesh.rotation.set(-0.28, 0, 0); }
    }
    this.hand.visible = !st.phone;   // Waffe beim Telefonieren ausblenden
    if (st.punch > 0) {
      const k = st.punch; // 1 → 0
      const sw = Math.sin((1 - k) * Math.PI);
      const pow = st.heavy ? 1.35 : 1;   // schwerer Schlag holt weiter aus
      B.armR.rotation.set(-1.5 * sw * pow - 0.2, 0.2, 0); B.foreR.rotation.set(-0.2 - 0.4 * (1 - sw), 0, 0);
      B.spine.rotation.y = -0.45 * sw * pow * pow;
      if (st.heavy) B.spine.rotation.x += 0.2 * sw;
    }
    if (st.kick > 0) {
      const sw = Math.sin((1 - st.kick) * Math.PI);
      B.legR.rotation.x = -(st.heavy ? 1.75 : 1.3) * sw; B.shinR.rotation.x = 0.9 * sw * (1 - sw);
      B.spine.rotation.x = -0.28 * sw;
      B.armL.rotation.z = -0.08 - 0.8 * sw; B.armR.rotation.z = 0.08 + 0.7 * sw;
    }
    if (st.windup > 0) {
      // angekündigter Schlag: Arm weit nach hinten
      B.armR.rotation.set(0.75, 0, 0.4); B.foreR.rotation.set(-1.7, 0, 0);
      B.spine.rotation.y = 0.45;
    }
    if (st.block) {
      // Deckung: beide Fäuste vors Gesicht
      B.armR.rotation.set(-1.25, 0.4, 0.15); B.foreR.rotation.set(-1.9, 0, 0);
      B.armL.rotation.set(-1.25, -0.4, -0.15); B.foreL.rotation.set(-1.9, 0, 0);
      B.spine.rotation.x += 0.14; B.head.rotation.x = 0.18;
    }
    if (st.dodge > 0) {
      const sw = Math.sin(Math.PI * Math.min(1, st.dodge / 0.4));
      B.spine.rotation.z = (st.dodgeSide || 1) * 0.5 * sw; B.spine.rotation.x -= 0.2 * sw;
      B.hips.position.y -= 0.16 * sw;
      B.legL.rotation.z = -0.25 * sw; B.legR.rotation.z = 0.25 * sw;
    }
    if (st.throw > 0) {
      const k = st.throw; const sw = Math.sin((1 - k) * Math.PI);
      B.armR.rotation.set(-2.6 + (1 - k) * 3.2, 0, 0.2); B.spine.rotation.x += 0.2 * sw;
    }
  }
}
