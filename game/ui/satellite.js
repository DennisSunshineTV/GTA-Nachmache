// Satellitenbild der Inseln: Aus den Weltdaten (Küste, Höhen, Wälder, Felder, Siedlungen) erzeugt ein eigener kleiner
// WebGL-Shader für jeden Kartenausschnitt das Luftbild – bei jedem Zoom scharf, ohne Bilddateien.
// Straßen, Gebäude und Symbole zeichnet map2d.js darüber.
import { fbm2, pointInPoly } from '../util.js';
import { WORLD, ZONES } from '../world/map.js';
import { LU } from '../world/landuse.js';

export const SAT_CELL = 12;   // Meter pro Zelle des Geländerasters (Höhe, Wald, Felder, Berge)

// Landnutzung → [bebaut, Garten, Flugfeld] (0..255)
const USE = {
  [LU.URBAN]: [255, 0, 0], [LU.HOTEL]: [140, 150, 0], [LU.INDUSTRIAL]: [245, 0, 0], [LU.HARBOR]: [230, 0, 0],
  [LU.PLAZA]: [215, 0, 0], [LU.FARMYARD]: [70, 40, 0], [LU.GARDEN]: [0, 255, 0], [LU.AIRPORT]: [0, 0, 255],
  [LU.RUNWAY]: [0, 0, 255], [LU.BEACHCLUB]: [60, 0, 0],
};

// Raster in Häppchen berechnen (Generator), damit die Ladeanzeige weiterläuft
function* satelliteSteps(ctx) {
  const { coast, hf, landuse } = ctx;
  const W = Math.ceil((WORLD.x1 - WORLD.x0) / SAT_CELL) + 1, H = Math.ceil((WORLD.z1 - WORLD.z0) / SAT_CELL) + 1;
  const land = new Float32Array(W * H * 4);   // Höhe, Waldrauschen, Ackerland, Berghöhe
  const hgrid = new Float32Array(W * H);      // Höhe ≥ 0 (für das Relief der 3D-Karte)
  for (let j = 0; j < H; j++) {
    const z = WORLD.z0 + j * SAT_CELL;
    for (let i = 0; i < W; i++) {
      const x = WORLD.x0 + i * SAT_CELL;
      if (coast.sdAt(x, z) < -14) continue;
      const k = j * W + i, h = Math.max(0, hf.base(x, z));
      hgrid[k] = h;
      land[k * 4] = h;
      land[k * 4 + 1] = fbm2(x / 160, z / 160, 3, 14);   // dasselbe Rauschen wie die Wälder im Spiel
      land[k * 4 + 2] = h < 70 && pointInPoly(x, z, ZONES.plain) ? 1 : 0;
      land[k * 4 + 3] = hf.mountain(x, z);
    }
    if ((j & 7) === 7) yield;
  }

  // Landnutzung (Raster der Welt) + Feuchtgebiete
  const U = { nx: landuse.nx, nz: landuse.nz, cell: landuse.cell };
  const use = new Uint8Array(U.nx * U.nz * 4);
  for (let k = 0, n = U.nx * U.nz; k < n; k++) {
    const c = USE[landuse.data[k]];
    if (c) { use[k * 4] = c[0]; use[k * 4 + 1] = c[1]; use[k * 4 + 2] = c[2]; }
  }
  yield;
  // Häuser außerhalb ausgewiesener Flächen verdichten das Stadtbild
  for (const b of ctx.buildings) {
    if (!b.style || b.style === 'finca' || b.style === 'beach') continue;
    const r = Math.max(b.w, b.d) * 0.5 + 5;
    const i0 = Math.max(0, Math.ceil((b.x - r - WORLD.x0) / U.cell)), i1 = Math.min(U.nx - 1, Math.floor((b.x + r - WORLD.x0) / U.cell));
    const j0 = Math.max(0, Math.ceil((b.z - r - WORLD.z0) / U.cell)), j1 = Math.min(U.nz - 1, Math.floor((b.z + r - WORLD.z0) / U.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const o = (j * U.nx + i) * 4;
        if (!use[o + 2] && use[o + 1] < 128 && use[o] < 200) use[o] = 200;
      }
    }
  }
  for (const w of hf.wet) {
    const i0 = Math.max(0, Math.floor((w.x0 - WORLD.x0) / U.cell)), i1 = Math.min(U.nx - 1, Math.ceil((w.x1 - WORLD.x0) / U.cell));
    const j0 = Math.max(0, Math.floor((w.z0 - WORLD.z0) / U.cell)), j1 = Math.min(U.nz - 1, Math.ceil((w.z1 - WORLD.z0) / U.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const m = hf.wetMask(WORLD.x0 + i * U.cell, WORLD.z0 + j * U.cell);
        if (m) use[(j * U.nx + i) * 4 + 3] = Math.min(255, Math.round(m.m * 255));
      }
    }
  }
  return { W, H, cell: SAT_CELL, land, hgrid, use, useW: U.nx, useH: U.nz, useCell: U.cell };
}

export async function buildSatelliteData(ctx, tick) {
  const it = satelliteSteps(ctx);
  let t = performance.now(), r;
  while (!(r = it.next()).done) {
    if (tick && performance.now() - t > 40) { await tick(); t = performance.now(); }
  }
  return r.value;
}

export function buildSatelliteDataSync(ctx) {
  const it = satelliteSteps(ctx);
  let r;
  while (!(r = it.next()).done);
  return r.value;
}

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uSd, uLand, uUse;
uniform vec2 uOrigin;                       // Weltkoordinate der ersten Rasterzelle
uniform vec3 uSdGrid, uLandGrid, uUseGrid;  // Spalten, Zeilen, Meter pro Zelle
uniform vec2 uCenter, uRes;
uniform float uScale;                       // Bildpunkte pro Meter
out vec4 outColor;

const mat2 ROT = mat2(0.80, 0.60, -0.60, 0.80);

float hash(vec2 c) {
  uvec2 q = uvec2(ivec2(c)) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n >> 8) * (1.0 / 16777216.0);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Feinheiten unterhalb weniger Bildpunkte ausblenden (kein Flimmern beim Herauszoomen)
float detail(float lambda) { return clamp(lambda * uScale * 0.45 - 0.55, 0.0, 1.0); }
float nz(vec2 p, float lambda, float seed) {
  float d = detail(lambda);
  if (d <= 0.0) return 0.5;
  return mix(0.5, vnoise(p / lambda + vec2(seed * 17.31, seed * 5.73)), d);
}
float fbm3(vec2 p, float l, float s) {
  return nz(p, l, s) * 0.571 + nz(ROT * p, l * 0.47, s + 1.0) * 0.286 + nz(p, l * 0.23, s + 2.0) * 0.143;
}
float ridge(vec2 p, float l, float s) {
  float d = detail(l);
  if (d <= 0.0) return 0.4;
  float r = 1.0 - abs(vnoise(p / l + vec2(s * 17.31, s * 5.73)) * 2.0 - 1.0);
  return mix(0.4, r * r, d);
}

vec2 gridUV(vec2 p, vec3 g) { return ((p - uOrigin) / g.z + 0.5) / g.xy; }
vec4 landAt(vec2 p) { return texture(uLand, gridUV(p, uLandGrid)); }
vec2 warp(vec2 p) { return p + (vec2(nz(p, 190.0, 3.0), nz(p, 190.0, 4.0)) - 0.5) * 95.0; }

// Höhe mit Graten und Rinnen (nur für die Schummerung)
float relief(vec2 p) {
  vec4 L = landAt(p);
  float mt = smoothstep(3.0, 80.0, L.a);
  float h = L.r + fbm3(p, 150.0, 11.0) * 6.0 * (1.0 - mt);
  if (mt > 0.0) {
    vec2 w = warp(p);
    h += mt * (ridge(w, 330.0, 7.0) * 26.0 + ridge(ROT * w, 150.0, 8.0) * 15.0 + ridge(w, 66.0, 9.0) * 8.0 + ridge(ROT * p, 28.0, 10.0) * 3.2);
  }
  return h;
}

vec3 water(vec2 p, float sd) {
  vec2 w = p + (vec2(nz(p, 1500.0, 20.0), nz(p, 1500.0, 21.0)) - 0.5) * 900.0;
  float big = fbm3(w, 3400.0, 22.0);
  vec3 col = mix(vec3(0.034, 0.112, 0.176), vec3(0.072, 0.205, 0.292), smoothstep(0.28, 0.74, big));
  col += (fbm3(w * vec2(1.0, 1.7), 520.0, 23.0) - 0.5) * vec3(0.018, 0.034, 0.042);
  col += (fbm3(p * vec2(1.0, 2.2), 60.0, 24.0) - 0.5) * vec3(0.026, 0.044, 0.050);
  col += (nz(p * vec2(1.0, 2.0), 12.0, 25.0) - 0.5) * 0.045;
  float d = -sd;
  if (d < 297.0) {
    float dn = d + (fbm3(p, 230.0, 26.0) - 0.5) * 170.0 * smoothstep(0.0, 60.0, d) + (fbm3(p, 46.0, 27.0) - 0.5) * 30.0 * smoothstep(0.0, 20.0, d);
    float far = smoothstep(296.0, 200.0, d);
    dn *= mix(0.60, 1.0, smoothstep(0.05, 0.30, uScale));   // aus der Ferne ein breiterer türkiser Saum
    col = mix(col, vec3(0.040, 0.240, 0.330), smoothstep(270.0, 60.0, dn) * 0.88 * far);
    col = mix(col, vec3(0.045, 0.425, 0.475), smoothstep(115.0, 28.0, dn));
    col = mix(col, vec3(0.270, 0.700, 0.650), smoothstep(52.0, 8.0, dn));
    col = mix(col, vec3(0.640, 0.850, 0.730), smoothstep(15.0, 0.0, dn));
    // Seegraswiesen und Riffe
    float weed = smoothstep(0.50, 0.68, fbm3(p, 105.0, 28.0)) * smoothstep(8.0, 34.0, dn) * smoothstep(200.0, 80.0, dn);
    col = mix(col, vec3(0.022, 0.180, 0.205), weed * 0.66);
    // Brandung
    float fw = max(3.0, 1.1 / uScale);
    float foam = smoothstep(fw * 2.2, 0.0, d) * smoothstep(0.30, 0.72, fbm3(p, 34.0, 29.0));
    float wave = smoothstep(fw, 0.0, abs(d - 18.0 - (nz(p, 60.0, 30.0) - 0.5) * 18.0)) * smoothstep(0.55, 0.8, nz(p, 42.0, 31.0)) * detail(12.0);
    col = mix(col, vec3(0.90, 0.95, 0.94), clamp(foam * 0.78 + wave * 0.34, 0.0, 1.0));
  }
  return col;
}

// Feldparzellen der Ebene
vec3 fields(vec2 p) {
  float ang = 0.3 + vnoise(p / 1700.0 + 5.0) * 0.9;
  float ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(p.x * ca + p.y * sa, -p.x * sa + p.y * ca);
  q += (vec2(vnoise(p / 95.0 + 1.0), vnoise(p / 95.0 + 11.0)) - 0.5) * 16.0;
  float P = 62.0 + 60.0 * hash(floor(q / 260.0) + 8.0);
  vec2 c = floor(q / P), f = q / P - c;
  float h = hash(c + vec2(77.0, 13.0));
  vec3 col = h < 0.24 ? vec3(0.545, 0.455, 0.250) : h < 0.40 ? vec3(0.430, 0.300, 0.190) : h < 0.58 ? vec3(0.265, 0.365, 0.145)
    : h < 0.68 ? vec3(0.200, 0.290, 0.125) : h < 0.82 ? vec3(0.385, 0.365, 0.200) : h < 0.92 ? vec3(0.600, 0.520, 0.325) : vec3(0.490, 0.370, 0.240);
  col *= 0.90 + 0.18 * hash(c + vec2(3.0, 78.0));
  if (h > 0.74 && h < 0.92) {   // Haine mit Baumreihen
    vec2 g = q / 9.0;
    float dotm = smoothstep(0.34, 0.20, length(fract(g) - 0.5 + (vec2(hash(floor(g)), hash(floor(g) + 5.0)) - 0.5) * 0.26));
    col = mix(col * mix(0.88, 1.0, detail(9.0)), vec3(0.125, 0.180, 0.080), dotm * detail(9.0));
  } else if (hash(c + 31.0) < 0.6) {   // Furchen
    col *= 1.0 + sin((hash(c + 19.0) < 0.5 ? q.x : q.y) * 6.2831 / 6.0) * 0.09 * detail(6.0);
  }
  float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * P;
  float ew = max(1.6, 0.6 / uScale);
  col = mix(col, vec3(0.150, 0.205, 0.100), (1.0 - smoothstep(ew * 0.4, ew * 1.5, edge)) * clamp(uScale * 4.0, 0.20, 0.85));
  // aus der Ferne ruhiger, mit großflächigen Tönungen statt Schachbrett
  col = mix(vec3(0.350, 0.335, 0.185), col, mix(0.50, 0.90, smoothstep(0.06, 0.40, uScale)));
  return col * (0.80 + 0.40 * fbm3(p, 430.0, 80.0));
}

vec3 ground(vec2 p, float sd) {
  vec4 L = landAt(p);
  float e = max(9.0, 1.3 / uScale);
  vec2 g = vec2(relief(p + vec2(e, 0.0)) - relief(p - vec2(e, 0.0)), relief(p + vec2(0.0, e)) - relief(p - vec2(0.0, e))) / (2.0 * e);
  vec2 gb = vec2(landAt(p + vec2(14.0, 0.0)).r - landAt(p - vec2(14.0, 0.0)).r, landAt(p + vec2(0.0, 14.0)).r - landAt(p - vec2(0.0, 14.0)).r) / 28.0;
  float slope = length(gb), h = L.r;
  float mt = smoothstep(4.0, 75.0, L.a);
  vec2 jit = (vec2(nz(p, 26.0, 50.0), nz(p, 26.0, 51.0)) - 0.5) * 12.0;
  vec4 U = texture(uUse, gridUV(p + jit, uUseGrid));
  float m1 = fbm3(p, 340.0, 52.0), m2 = fbm3(p, 82.0, 53.0), m3 = fbm3(p, 19.0, 54.0), m4 = nz(p, 5.0, 55.0);

  // Macchia und trockenes Gras
  vec3 col = mix(vec3(0.222, 0.255, 0.132), vec3(0.475, 0.398, 0.238), smoothstep(0.34, 0.70, m1 * 0.62 + m2 * 0.38));
  float farm = smoothstep(0.3, 0.7, L.b) * smoothstep(0.34, 0.14, slope) * (1.0 - mt) * smoothstep(0.27, 0.46, fbm3(p, 290.0, 81.0));
  if (farm > 0.01) col = mix(col, fields(p), farm);
  // Kiefernwald
  float forest = smoothstep(0.46, 0.61, L.g + (m2 - 0.5) * 0.24 + mt * 0.07) * (1.0 - farm * 0.9) * smoothstep(1.0, 3.5, h);
  vec3 wood = mix(vec3(0.070, 0.128, 0.064), vec3(0.185, 0.250, 0.105), clamp(0.5 + (m3 - 0.5) * 1.1 + (m4 - 0.5) * 1.2, 0.0, 1.0));
  col = mix(col, wood, forest);
  // Gebirge: dunkle Hänge, helle Grate und Fels
  if (mt > 0.0) {
    float top = ridge(warp(p), 330.0, 7.0);
    vec3 rock = mix(vec3(0.320, 0.255, 0.175), vec3(0.610, 0.530, 0.405), smoothstep(0.28, 0.76, fbm3(p, 120.0, 56.0) * 0.6 + m3 * 0.4));
    float r = mt * clamp(smoothstep(0.24, 0.80, slope + (m2 - 0.5) * 0.55) * 0.62 + smoothstep(70.0, 240.0, h) * 0.45 + (top - 0.55) * 0.75 + (m1 - 0.5) * 0.6, 0.0, 1.0);
    col = mix(col, vec3(0.115, 0.158, 0.080), mt * 0.42 * (1.0 - r));
    col = mix(col, rock, r * 0.86);
  }
  col *= 1.0 - smoothstep(0.60, 0.82, nz(p, 9.0, 57.0)) * 0.30 * (1.0 - farm);   // Büsche
  col *= 0.88 + 0.24 * (m3 * 0.5 + m4 * 0.5);
  // Feuchtgebiet mit Wasserflächen
  if (U.a > 0.02) {
    vec3 marsh = mix(vec3(0.130, 0.225, 0.130), vec3(0.320, 0.345, 0.180), m2);
    marsh = mix(vec3(0.050, 0.200, 0.225), marsh, smoothstep(0.40, 0.52, fbm3(p, 70.0, 61.0)));
    col = mix(col, marsh, smoothstep(0.05, 0.6, U.a));
  }
  // Strand
  float bw = 17.0 + 24.0 * nz(p, 100.0, 60.0);
  float sand = (1.0 - smoothstep(bw - 7.0, bw + 7.0, sd + (m3 - 0.5) * 12.0)) * smoothstep(0.42, 0.20, slope) * smoothstep(8.0, 4.0, h) * (1.0 - mt);
  vec3 sandCol = mix(vec3(0.775, 0.672, 0.478), vec3(0.915, 0.832, 0.640), m3);
  col = mix(col, mix(sandCol * 0.80, sandCol, smoothstep(0.5, 6.0, sd)), sand);
  // Felsküste
  float cliff = (1.0 - smoothstep(5.0, 34.0, sd + (m2 - 0.5) * 34.0)) * (1.0 - sand);
  col = mix(col, mix(vec3(0.355, 0.300, 0.215), vec3(0.665, 0.580, 0.445), m3), cliff * 0.86);
  // Gärten
  col = mix(col, mix(vec3(0.190, 0.285, 0.115), vec3(0.340, 0.420, 0.180), m3), smoothstep(0.15, 0.85, U.g) * 0.82);
  // Siedlungen: heller Grund, aus der Nähe ohne, aus der Ferne mit Dächerkörnung
  float paved = smoothstep(0.16, 0.78, U.r);
  if (paved > 0.0) {
    float a = 0.30 + floor(nz(p, 420.0, 70.0) * 3.0) * 0.35;
    vec2 q = vec2(p.x * cos(a) + p.y * sin(a), -p.x * sin(a) + p.y * cos(a));
    vec2 c = floor(q / 17.0), f = q / 17.0 - c;
    float r = hash(c + 200.0);
    vec3 roof = r < 0.30 ? vec3(0.815, 0.790, 0.735) : r < 0.50 ? vec3(0.665, 0.430, 0.300) : r < 0.68 ? vec3(0.500, 0.495, 0.480)
      : r < 0.78 ? vec3(0.745, 0.625, 0.470) : r < 0.88 ? vec3(0.225, 0.300, 0.160) : vec3(0.610, 0.585, 0.535);
    float inner = smoothstep(0.07, 0.17, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
    vec3 base = vec3(0.445, 0.428, 0.385) * (0.86 + 0.28 * m3);
    roof *= 0.92;
    vec3 town = mix(base, roof, inner * detail(17.0) * (1.0 - smoothstep(0.14, 0.32, uScale)));
    town *= 0.86 + 0.28 * mix(nz(p, 46.0, 71.0), 0.5, smoothstep(0.14, 0.32, uScale));
    col = mix(col, town, paved * 0.93);
  }
  // Flugfeld
  float apron = smoothstep(0.2, 0.8, U.b);
  col = mix(col, mix(vec3(0.375, 0.385, 0.280), vec3(0.520, 0.520, 0.465), smoothstep(0.35, 0.65, nz(p, 130.0, 72.0))) * (0.94 + 0.12 * m3), apron);
  // Licht von Nordwesten
  float flatten = 1.0 - max(paved, apron) * 0.7;
  vec3 n = normalize(vec3(-g.x * 1.65, 1.0, -g.y * 1.65));
  vec3 sun = normalize(vec3(-0.62, 0.62, -0.48));
  float lit = (dot(n, sun) - sun.y) * flatten;
  col *= clamp(1.0 + lit * 1.40, 0.40, 1.55);
  col = mix(col, col * vec3(0.78, 0.92, 1.20), clamp(-lit * 1.5, 0.0, 1.0));
  col += vec3(0.050, 0.034, 0.004) * clamp(lit * 1.5, 0.0, 1.0);
  return pow(max(col, 0.0), vec3(0.91)) * 1.03;
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 p = uCenter + (frag - uRes * 0.5) / uScale;
  vec2 rel = (p - uOrigin) / uSdGrid.z;
  bool outside = rel.x < 0.0 || rel.y < 0.0 || rel.x > uSdGrid.x - 1.0 || rel.y > uSdGrid.y - 1.0;
  float sd = outside ? -300.0 : texture(uSd, gridUV(p, uSdGrid)).r;
  float aa = 0.7 / uScale;
  float jag = outside ? 0.0 : (nz(p, 15.0, 40.0) - 0.5) * 3.2;
  float land = smoothstep(-aa, aa, sd + jag);
  vec3 col = vec3(0.0);
  if (land < 0.999) col = water(p, sd + jag);
  if (land > 0.001) col = mix(col, ground(p, sd + jag), land);
  outColor = vec4(col, 1.0);
}`;

export class SatelliteRenderer {
  constructor(coast, data) {
    this.coast = coast;
    this.data = data;
    this._init();
  }

  _init() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 4;
    const gl = cv.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
    if (!gl) throw new Error('WebGL2 ist nicht verfügbar');
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('Satellitenshader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Satellitenshader: ' + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const u = {};
    for (const n of ['uSd', 'uLand', 'uUse', 'uOrigin', 'uSdGrid', 'uLandGrid', 'uUseGrid', 'uCenter', 'uRes', 'uScale']) u[n] = gl.getUniformLocation(prog, n);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const texture = (unit, internal, w, h, format, type, pixels) => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, pixels);
    };
    const c = this.coast, d = this.data;
    texture(0, gl.R16F, c.nx, c.nz, gl.RED, gl.FLOAT, c.sd);
    texture(1, gl.RGBA16F, d.W, d.H, gl.RGBA, gl.FLOAT, d.land);
    texture(2, gl.RGBA8, d.useW, d.useH, gl.RGBA, gl.UNSIGNED_BYTE, d.use);
    gl.uniform1i(u.uSd, 0); gl.uniform1i(u.uLand, 1); gl.uniform1i(u.uUse, 2);
    gl.uniform2f(u.uOrigin, WORLD.x0, WORLD.z0);
    gl.uniform3f(u.uSdGrid, c.nx, c.nz, c.cell);
    gl.uniform3f(u.uLandGrid, d.W, d.H, d.cell);
    gl.uniform3f(u.uUseGrid, d.useW, d.useH, d.useCell);
    this.canvas = cv; this.gl = gl; this.u = u;
  }

  // Ausschnitt view = { x, z, scale (Bildpunkte pro Meter) } in W×H zeichnen; liefert die Zeichenfläche
  render(view, W, H) {
    if (this.gl.isContextLost()) this._init();
    const { gl, u, canvas } = this;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform2f(u.uCenter, view.x, view.z);
    gl.uniform2f(u.uRes, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(u.uScale, view.scale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return canvas;
  }
}
