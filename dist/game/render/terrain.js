// Gelände-Chunks: Geometrie mit Vertexfarben (Strand, Fels, Wald, Felder, Stadtboden) in drei Detailstufen.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, fbm2, noise2, ihash, pointInPoly } from '../util.js';
import { LU } from '../world/landuse.js';
import { ZONES } from '../world/map.js';

export const CHUNK = 256;
export const LODS = [
  { n: 64, skirt: 2.5 },   // 4 m
  { n: 32, skirt: 7 },     // 8 m
  { n: 16, skirt: 16 },    // 16 m
];

const indexCache = [];
function indexFor(lod) {
  if (indexCache[lod]) return indexCache[lod];
  const n = LODS[lod].n, w = n + 1;
  const idx = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Schürzen: vier Kanten, Vertices ab w*w
  let base = w * w;
  const edges = [
    (k) => k,                        // oben (j=0)
    (k) => n * w + k,                // unten (j=n)
    (k) => k * w,                    // links (i=0)
    (k) => k * w + n,                // rechts (i=n)
  ];
  for (let e = 0; e < 4; e++) {
    for (let k = 0; k < n; k++) {
      const t0 = edges[e](k), t1 = edges[e](k + 1);
      const s0 = base + k, s1 = base + k + 1;
      if (e === 1 || e === 2) idx.push(t0, s0, t1, t1, s0, s1);
      else idx.push(t0, t1, s0, t1, s1, s0);
    }
    base += n + 1;
  }
  const arr = new Uint16Array(idx);
  indexCache[lod] = arr;
  return arr;
}

const C = (r, g, b) => [r, g, b];
const COL = {
  sand: C(0.93, 0.87, 0.72), wet: C(0.7, 0.62, 0.48), rock: C(0.6, 0.55, 0.47), rockDark: C(0.42, 0.39, 0.34),
  scrub: C(0.46, 0.46, 0.27), grass: C(0.5, 0.55, 0.28), dry: C(0.72, 0.64, 0.38), pine: C(0.15, 0.3, 0.14), pineL: C(0.24, 0.4, 0.17),
  urban: C(0.6, 0.58, 0.54), garden: C(0.44, 0.52, 0.27), hotel: C(0.78, 0.74, 0.66), industrial: C(0.52, 0.52, 0.52), airport: C(0.62, 0.62, 0.6),
  runway: C(0.2, 0.2, 0.22), harbor: C(0.66, 0.64, 0.6), plaza: C(0.86, 0.79, 0.65), yard: C(0.7, 0.58, 0.42), beach: C(0.94, 0.88, 0.73),
  asphalt: C(0.3, 0.3, 0.32), wetland: C(0.3, 0.38, 0.22), mud: C(0.28, 0.25, 0.18), salt: C(0.93, 0.88, 0.86),
};
const FIELDS = [
  [C(0.8, 0.68, 0.4), 0.25], [C(0.6, 0.44, 0.3), 0.15], [C(0.45, 0.63, 0.23), 0.2], [C(0.4, 0.54, 0.22), 0.1],
  [C(0.52, 0.54, 0.3), 0.14], [C(0.74, 0.7, 0.4), 0.1], [C(0.86, 0.76, 0.48), 0.06],
];

// Feldparzelle an (x,z): Typ-Hash, Abstand zur Parzellengrenze (m)
export function parcelAt(x, z, o = {}) {
  const ang = 0.3 + noise2(x / 1700, z / 1700, 5) * 0.9;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let u = x * ca + z * sa, v = -x * sa + z * ca;
  u += (noise2(x / 95, z / 95, 1) - 0.5) * 16; v += (noise2(x / 95 + 9, z / 95, 2) - 0.5) * 16;
  const P = 62 + 60 * ihash(Math.floor(u / 260), Math.floor(v / 260), 8);
  const cu = Math.floor(u / P), cv = Math.floor(v / P);
  const fu = u / P - cu, fv = v / P - cv;
  o.hs = ihash(cu, cv, 77);
  o.k = 0.93 + ihash(cu, cv, 78) * 0.14;
  o.edge = Math.min(fu, 1 - fu, fv, 1 - fv) * P;
  return o;
}
export const FIELD_GROVE_MIN = 0.7, FIELD_GROVE_MAX = 0.84;
const _parcel = {};

function fieldColor(x, z, out) {
  const p = parcelAt(x, z, _parcel);
  const hs = p.hs;
  let acc = 0, col = FIELDS[0][0];
  for (const [c, pr] of FIELDS) { acc += pr; if (hs < acc) { col = c; break; } }
  out[0] = col[0] * p.k; out[1] = col[1] * p.k; out[2] = col[2] * p.k;
  const edge = p.edge;
  if (edge < 1.3) { const e = smoothstep(1.3, 0.2, edge); out[0] = lerp(out[0], 0.34, e); out[1] = lerp(out[1], 0.38, e); out[2] = lerp(out[2], 0.24, e); }
  return hs;
}

export class TerrainBuilder {
  constructor(ctx) {
    this.ctx = ctx;
    this.tmp = [0, 0, 0];
    this.tmp2 = [0, 0, 0];
  }

  groundColor(x, z, h, ny, sd, lod, out) {
    const { landuse, hf, net } = this.ctx;
    const lu = landuse.get(x, z);
    const t = this.tmp;
    const slope = Math.sqrt(Math.max(0, 1 - ny * ny)) / Math.max(ny, 0.05);
    const nn = fbm2(x / 38, z / 38, 3, 9);
    const nf = noise2(x / 23, z / 23, 3);
    let r, g, b;
    if (sd < 0) { r = 0.78; g = 0.72; b = 0.55; }
    else if (lu) {
      let c;
      switch (lu) {
        case LU.URBAN: c = COL.urban; break;
        case LU.GARDEN: c = COL.garden; break;
        case LU.HOTEL: c = (nn > 0.36 ? COL.garden : COL.hotel); break;
        case LU.INDUSTRIAL: c = COL.industrial; break;
        case LU.AIRPORT: c = COL.airport; break;
        case LU.RUNWAY: c = COL.runway; break;
        case LU.HARBOR: c = COL.harbor; break;
        case LU.PLAZA: c = COL.plaza; break;
        case LU.FARMYARD: c = COL.yard; break;
        case LU.BEACHCLUB: c = COL.beach; break;
        default: c = COL.urban;
      }
      const k = 0.92 + nf * 0.16;
      r = c[0] * k; g = c[1] * k; b = c[2] * k;
    } else {
      const beachW = 22 + 12 * noise2(x / 70, z / 70, 4);
      const rocky = slope > 0.5 || (h > 12 && sd < 70 && slope > 0.3);
      // Grundbewuchs
      const wm = hf.wet.length ? hf.wetMask(x, z) : null;
      if (sd < 1.8 && !rocky) { const c = COL.wet; r = c[0]; g = c[1]; b = c[2]; }
      else if (sd < beachW + 8 && !rocky && h < 6) {
        // Strand mit weichem, unregelmäßigem Übergang zur Vegetation (keine Zickzack-Kante)
        const c = COL.sand; const k = 0.95 + nf * 0.1;
        const sw = 1 - smoothstep(beachW - 8 + (nn - 0.5) * 10, beachW + 8 + (nn - 0.5) * 10, sd);
        if (sw > 0.985) { r = c[0] * k; g = c[1] * k; b = c[2] * k; }
        else {
          const nat = this.natural(x, z, h, slope, nn, nf, t);
          r = lerp(nat[0], c[0] * k, sw); g = lerp(nat[1], c[1] * k, sw); b = lerp(nat[2], c[2] * k, sw);
        }
      }
      else if (wm && wm.m > 0.08) {
        const c = wm.w.salt ? COL.salt : h < 0.15 ? COL.mud : COL.wetland;
        const nat = this.natural(x, z, h, slope, nn, nf, t);
        r = lerp(nat[0], c[0], Math.min(1, wm.m * 1.6)); g = lerp(nat[1], c[1], Math.min(1, wm.m * 1.6)); b = lerp(nat[2], c[2], Math.min(1, wm.m * 1.6));
      } else {
        const nat = this.natural(x, z, h, slope, nn, nf, t);
        r = nat[0]; g = nat[1]; b = nat[2];
      }
    }
    // Straßen aus der Ferne sichtbar machen
    if (lod > 0 && sd > 0) {
      const c = net.roadCover(x, z);
      if (c > 0.02) { const k = lod === 1 ? 0.8 : 0.6; r = lerp(r, 0.3, c * k); g = lerp(g, 0.3, c * k); b = lerp(b, 0.32, c * k); }
    }
    out[0] = r; out[1] = g; out[2] = b;
  }

  natural(x, z, h, slope, nn, nf, t) {
    let r, g, b;
    const farm = h < 70 && slope < 0.2 && pointInPoly(x, z, ZONES.plain);
    let forest = 0;
    if (farm) {
      fieldColor(x, z, t);
      r = t[0]; g = t[1]; b = t[2];
    } else {
      // Garrigue / Kiefernwald / trockenes Gras
      forest = smoothstep(0.5, 0.62, fbm2(x / 160, z / 160, 3, 14)) * (h > 1.5 ? 1 : 0);
      const dryK = smoothstep(0.35, 0.65, fbm2(x / 90, z / 90, 2, 21));
      const sc = COL.scrub, dr = COL.dry, pn = COL.pine, pl = COL.pineL;
      r = lerp(sc[0], dr[0], dryK); g = lerp(sc[1], dr[1], dryK); b = lerp(sc[2], dr[2], dryK);
      const pk = lerp(pn[0], pl[0], nn);
      r = lerp(r, pk, forest); g = lerp(g, lerp(pn[1], pl[1], nn), forest); b = lerp(b, lerp(pn[2], pl[2], nn), forest);
    }
    // Fels an steilen Hängen und in großer Höhe
    const rock = Math.max(smoothstep(0.6, 1.25, slope) * (1 - forest * 0.7), smoothstep(190, 300, h) * 0.5);
    if (rock > 0) {
      const rc = nn > 0.62 ? COL.rockDark : nn < 0.3 ? [0.7, 0.62, 0.5] : COL.rock;
      r = lerp(r, rc[0] * (0.85 + nf * 0.3), rock); g = lerp(g, rc[1] * (0.85 + nf * 0.3), rock); b = lerp(b, rc[2] * (0.85 + nf * 0.3), rock);
    }
    const k = 0.9 + nf * 0.2;
    t[0] = r * k; t[1] = g * k; t[2] = b * k;
    return t;
  }

  // Generator: erzeugt Geometrie in Zeitscheiben (yield). Rückgabe: { geometry, heights }
  *build(cx, cz, lod) {
    const { hf, coast } = this.ctx;
    const { n, skirt } = LODS[lod];
    const w = n + 1;
    const cell = CHUNK / n;
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    // Höhenraster mit 1 Zelle Rand
    const gw = n + 3;
    const hs = new Float32Array(gw * gw);
    const SD = new Float32Array(gw * gw);
    let work = 0;
    for (let j = 0; j < gw; j++) {
      for (let i = 0; i < gw; i++) {
        const x = x0 + (i - 1) * cell, z = z0 + (j - 1) * cell;
        hs[j * gw + i] = hf.h(x, z);
        SD[j * gw + i] = coast.sdAt(x, z);
      }
      work += gw;
      if (work > 900) { work = 0; yield; }
    }
    const nv = w * w + 4 * w;
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const c3 = [0, 0, 0];
    let k = 0;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const gi = (j + 1) * gw + (i + 1);
        const h = hs[gi];
        const x = x0 + i * cell, z = z0 + j * cell;
        const dhx = (hs[gi + 1] - hs[gi - 1]) / (2 * cell), dhz = (hs[gi + gw] - hs[gi - gw]) / (2 * cell);
        let nx = -dhx, ny = 1, nz = -dhz;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        const v = j * w + i;
        pos[v * 3] = x; pos[v * 3 + 1] = h; pos[v * 3 + 2] = z;
        nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
        uv[v * 2] = x / 14; uv[v * 2 + 1] = z / 14;
        this.groundColor(x, z, h, ny, SD[gi], lod, c3);
        // sRGB -> linear, Detailtextur gleicht ~0.78 aus
        col[v * 3] = Math.pow(c3[0], 2.2) * 1.12; col[v * 3 + 1] = Math.pow(c3[1], 2.2) * 1.12; col[v * 3 + 2] = Math.pow(c3[2], 2.2) * 1.12;
      }
      if ((++k & 3) === 0) yield;
    }
    // Schürzen
    let sv = w * w;
    const copyDown = (src) => {
      pos[sv * 3] = pos[src * 3]; pos[sv * 3 + 1] = pos[src * 3 + 1] - skirt; pos[sv * 3 + 2] = pos[src * 3 + 2];
      nor[sv * 3] = nor[src * 3]; nor[sv * 3 + 1] = nor[src * 3 + 1]; nor[sv * 3 + 2] = nor[src * 3 + 2];
      col[sv * 3] = col[src * 3]; col[sv * 3 + 1] = col[src * 3 + 1]; col[sv * 3 + 2] = col[src * 3 + 2];
      uv[sv * 2] = uv[src * 2]; uv[sv * 2 + 1] = uv[src * 2 + 1];
      sv++;
    };
    for (let i = 0; i <= n; i++) copyDown(i);
    for (let i = 0; i <= n; i++) copyDown(n * w + i);
    for (let j = 0; j <= n; j++) copyDown(j * w);
    for (let j = 0; j <= n; j++) copyDown(j * w + n);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(indexFor(lod), 1));
    // Begrenzung: Höhe aus den Daten
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < w * w; i++) { const y = pos[i * 3 + 1]; if (y < lo) lo = y; if (y > hi) hi = y; }
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(x0, lo - skirt, z0), new THREE.Vector3(x0 + CHUNK, hi, z0 + CHUNK));
    geo.boundingSphere = new THREE.Sphere();
    geo.boundingBox.getBoundingSphere(geo.boundingSphere);
    let heights = null;
    if (lod === 0) {
      heights = new Float32Array(w * w);
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) heights[j * w + i] = pos[(j * w + i) * 3 + 1];
    }
    return { geometry: geo, heights, lo, hi };
  }
}
