// Straßenmaterial in hoher Auflösung: Der Belag wird pro Pixel berechnet statt aus einem groben Atlas gelesen.
// - Asphalt: Gesteinskörnung in Weltkoordinaten (≈4 mm/Pixel), Normalen, großflächige Tönung, Risse, Flicken,
//   Ölspur und Reifenspuren, Markierungen analytisch und kantengeglättet (immer scharf, egal wie nah).
// - Feldweg: zwei Kiesspuren mit Grasmittelstreifen und ausfransendem Grasrand.
// - Bankett: Kies an der Asphaltkante, dann Gras, unregelmäßig ins Gelände übergehend.
// - Gehweg/Pflaster: Platten bzw. Pflastersteine mit Fugen und Bordstein.
// Vertexfarbe der Straßengeometrie trägt Parameter (nicht als Farbe): r = Breite/32 m, g = 1 im Straßenband
// (Markierungen/Querprofil), 0 auf Kreuzungsflächen (nur Weltmuster).
import * as THREE from 'three';
import { ROAD_COLS, ROAD_TILE_M, ROAD_STRIP } from './textures.js';
import * as HD from './hdtextures.js';

export function makeRoadMaterial(atlas) {
  const asph = HD.makeAsphaltDetail(), grav = HD.makeGravel(), grass = HD.makeGrassGround();
  const uniforms = {
    tAsph: { value: asph.map }, tAsphN: { value: asph.normal },
    tGrav: { value: grav.map }, tGravN: { value: grav.normal },
    tGrass: { value: grass.map }, tGrassN: { value: grass.normal },
    tWear: { value: HD.makeRoadWear() }, tNoise: { value: HD.makeSoftNoise() },
  };
  const mat = new THREE.MeshStandardMaterial({
    map: atlas, roughness: 0.93, metalness: 0, vertexColors: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const S = ROAD_STRIP;
  const defs = `
#define RCOLS ${ROAD_COLS.toFixed(1)}
#define RPAD ${(0.0015 * ROAD_COLS).toFixed(5)}
#define RTILE ${ROAD_TILE_M.toFixed(1)}
`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRW;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvRW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${defs}
uniform sampler2D tAsph, tAsphN, tGrav, tGravN, tGrass, tGrassN, tWear, tNoise;
varying vec3 vRW;
float rdLine(float x, float c, float hw, float aa) { return 1.0 - smoothstep(hw - aa, hw + aa, abs(x - c)); }
float rdDash(float v, float dash, float gap, float av) { float p = mod(v, dash + gap); return smoothstep(-av, av, p) * (1.0 - smoothstep(dash - av, dash + av, p)); }
float rdHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Pflaster/Platten: Fugenmaske (1 = Fuge), Steinton
vec2 rdPaver(vec2 p, vec2 size, float bond) {
  float row = floor(p.y / size.y);
  p.x += mod(row, 2.0) * size.x * bond;
  vec2 c = floor(p / size), f = fract(p / size) * size;
  float j = min(min(f.x, size.x - f.x), min(f.y, size.y - f.y));
  float aa = max(fwidth(p.x), fwidth(p.y)) * 0.7 + 0.002;
  return vec2(1.0 - smoothstep(0.004, 0.006 + aa, j), rdHash(c));
}
`)
      .replace('#include <map_fragment>', `
vec4 rdAtl = texture2D(map, vMapUv);
float rdSF = vMapUv.x * RCOLS;
float rdSid = floor(rdSF + 0.0001);
float rdT = clamp((fract(rdSF) - RPAD) / (1.0 - 2.0 * RPAD), 0.0, 1.0);
float rdW = max(vColor.r * 32.0, 0.3);
float rdMk = step(0.5, vColor.g);
float rdX = (rdT - 0.5) * rdW;
float rdV = vMapUv.y * RTILE;
vec2 rdP = vRW.xz;
float rdNA = texture2D(tNoise, rdP / 97.0).r, rdNB = texture2D(tNoise, rdP / 23.0).g, rdNC = texture2D(tNoise, rdP / 5.3).b;
vec3 rdCol = rdAtl.rgb;
vec2 rdN = vec2(0.0);
float rdRough = 1.0;
bool rdAsph = rdSid < 6.5 || abs(rdSid - ${S.zebra}.0) < 0.5 || abs(rdSid - ${S.plain}.0) < 0.5 || abs(rdSid - ${S.taxi}.0) < 0.5;
if (rdAsph) {
  vec3 ag = texture2D(tAsph, rdP / 2.5).rgb;
  vec2 agN = texture2D(tAsphN, rdP / 2.5).xy * 2.0 - 1.0;
  float br = rdSid < 0.5 ? 1.08 : rdSid < 1.5 ? 0.92 : rdSid < 2.5 ? 1.12 : rdSid < 3.5 ? 1.0 : rdSid < 4.5 ? 0.86 : rdSid < 5.5 ? 1.0 : rdSid < 6.5 ? 1.15 : 1.0;
  rdCol = ag * br * (0.8 + 0.4 * rdNA) * (0.9 + 0.2 * rdNB);
  rdN = agN * 0.5;
  if (rdMk > 0.5) {
    vec4 wr = texture2D(tWear, vec2(rdX / 8.0 + 0.5, rdV / 32.0));
    rdCol *= mix(1.0, 0.6, wr.r * 0.85);
    rdCol *= 0.78 + 0.44 * wr.g;
    rdRough -= wr.r * 0.3;
    // Fahrstreifen: dunkle Ölspur in der Mitte, hellere glatte Reifenspuren
    float lanes = (rdSid > 3.5 && rdSid < 5.5) ? 4.0 : rdSid > 8.5 ? 1.0 : 2.0;
    float lw = rdW / lanes;
    float lp = mod(rdX + rdW * 0.5, lw) - lw * 0.5;
    float oil = 1.0 - smoothstep(0.12, 0.5, abs(lp));
    float wheel = 1.0 - smoothstep(0.15, 0.45, abs(abs(lp) - 0.85));
    rdCol *= 1.0 - 0.13 * oil * (0.5 + rdNC);
    rdCol *= 1.0 + 0.08 * wheel;
    rdRough -= 0.14 * wheel;
    float edge = min(rdT, 1.0 - rdT) * rdW;
    rdCol *= 0.86 + 0.14 * smoothstep(0.0, 0.35, edge);
    // Markierungen
    float aa = max(fwidth(rdX), 0.002) * 0.8, av = max(fwidth(rdV), 0.002) * 0.8;
    float hw = rdW * 0.5, p = 0.0, py = 0.0;
    if (rdSid < 0.5) { p = max(rdLine(rdX, -hw + 0.35, 0.06, aa), rdLine(rdX, hw - 0.35, 0.06, aa)); p = max(p, rdLine(rdX, 0.0, 0.06, aa) * rdDash(rdV, 3.0, 3.0, av)); }
    else if (rdSid < 1.5) { p = max(rdLine(rdX, -hw + 0.32, 0.08, aa), rdLine(rdX, hw - 0.32, 0.08, aa)); p = max(p, rdLine(rdX, 0.0, 0.065, aa) * rdDash(rdV, 5.0, 10.0, av)); }
    else if (rdSid < 2.5) { p = max(rdLine(rdX, -hw + 0.28, 0.065, aa), rdLine(rdX, hw - 0.28, 0.065, aa)); p = max(p, rdLine(rdX, 0.0, 0.06, aa) * rdDash(rdV, 3.0, 6.0, av)); }
    else if (rdSid < 3.5) { p = max(rdLine(rdX, -hw + 0.3, 0.065, aa), rdLine(rdX, hw - 0.3, 0.065, aa)); p = max(p, max(rdLine(rdX, -0.13, 0.06, aa), rdLine(rdX, 0.13, 0.06, aa))); }
    else if (rdSid < 4.5) { p = max(rdLine(rdX, -hw + 0.4, 0.125, aa), rdLine(rdX, hw - 0.4, 0.125, aa)); p = max(p, max(rdLine(rdX, -0.16, 0.075, aa), rdLine(rdX, 0.16, 0.075, aa))); p = max(p, max(rdLine(rdX, -hw * 0.5, 0.075, aa), rdLine(rdX, hw * 0.5, 0.075, aa)) * rdDash(rdV, 6.0, 12.0, av)); }
    else if (rdSid < 5.5) { p = max(rdLine(rdX, -hw + 0.32, 0.065, aa), rdLine(rdX, hw - 0.32, 0.065, aa)); p = max(p, max(rdLine(rdX, -hw * 0.5, 0.065, aa), rdLine(rdX, hw * 0.5, 0.065, aa)) * rdDash(rdV, 3.0, 6.0, av)); py = max(rdLine(rdX, -0.14, 0.065, aa), rdLine(rdX, 0.14, 0.065, aa)); }
    else if (abs(rdSid - ${S.zebra}.0) < 0.5) { float st = abs(fract(rdX / 1.0 + 0.25) - 0.5); p = (1.0 - smoothstep(0.25 - aa, 0.25 + aa, st)) * (1.0 - smoothstep(hw - 0.35 - aa, hw - 0.35 + aa, abs(rdX))); }
    else if (abs(rdSid - ${S.taxi}.0) < 0.5) { py = rdLine(rdX, 0.0, 0.08, aa); }
    float wearP = mix(0.45, 1.0, wr.b) * (0.86 + 0.14 * rdNC);
    vec3 paint = vec3(0.78) * (0.92 + 0.6 * ag.r);
    vec3 ypaint = vec3(0.8, 0.55, 0.1) * (0.92 + 0.6 * ag.r);
    float pw = p * wearP, yw = py * wearP;
    rdCol = mix(rdCol, paint, pw);
    rdCol = mix(rdCol, ypaint, yw);
    rdRough = mix(rdRough, 0.6, max(pw, yw));
    rdN *= 1.0 - max(pw, yw) * 0.75;
  }
} else if (abs(rdSid - ${S.track}.0) < 0.5) {
  vec3 gv = texture2D(tGrav, rdP / 1.6).rgb; vec2 gvN = texture2D(tGravN, rdP / 1.6).xy * 2.0 - 1.0;
  vec3 gr = texture2D(tGrass, rdP / 1.2).rgb; vec2 grN = texture2D(tGrassN, rdP / 1.2).xy * 2.0 - 1.0;
  float ax = abs(rdX);
  float rin = 0.36 + (rdNC - 0.5) * 0.3, rout = 1.2 + (rdNB - 0.5) * 0.4;
  float rut = smoothstep(rin - 0.09, rin + 0.09, ax) * (1.0 - smoothstep(rout - 0.12, rout + 0.12, ax));
  if (rdMk < 0.5) rut = smoothstep(0.25, 0.55, rdNC + 0.15);
  float rc = 1.0 - smoothstep(0.0, 0.32, abs(ax - 0.8));
  vec3 g2 = gv * (0.92 + 0.2 * rdNB) * (1.0 - 0.1 * rc);
  vec3 gg = gr * (0.82 + 0.32 * rdNA) * vec3(1.0 + 0.12 * rdNB, 1.0, 1.0 - 0.1 * rdNB);
  rdCol = mix(gg, g2, rut);
  rdN = mix(grN * 0.7, gvN * 0.85, rut);
  if (rdMk > 0.5 && ax > rdW * 0.5 - 0.3 - rdNB * 0.55 - rdNC * 0.3) discard;
} else if (abs(rdSid - ${S.shoulder}.0) < 0.5) {
  vec3 gv = texture2D(tGrav, rdP / 1.4).rgb * vec3(0.86, 0.88, 0.92); vec2 gvN = texture2D(tGravN, rdP / 1.4).xy * 2.0 - 1.0;
  vec3 gr = texture2D(tGrass, rdP / 1.2).rgb; vec2 grN = texture2D(tGrassN, rdP / 1.2).xy * 2.0 - 1.0;
  float e = rdT * rdW;
  float gx = smoothstep(0.12, 0.7, e + (rdNC - 0.5) * 0.55 + (rdNB - 0.5) * 0.25);
  rdCol = mix(gv * (0.85 + 0.25 * rdNB), gr * (0.85 + 0.3 * rdNA), gx);
  rdN = mix(gvN * 0.85, grN * 0.7, gx);
  if (e > rdW - 0.4 + (rdNC - 0.5) * 0.7 - rdNB * 0.3) discard;
} else if (abs(rdSid - ${S.sidewalk}.0) < 0.5 || abs(rdSid - ${S.pavers}.0) < 0.5) {
  bool pv = abs(rdSid - ${S.pavers}.0) < 0.5;
  vec2 pp = rdMk > 0.5 ? vec2(rdT * rdW, rdV) : rdP;
  vec2 j = pv ? rdPaver(pp, vec2(0.24, 0.12), 0.5) : rdPaver(pp, vec2(0.5, 0.5), 0.0);
  vec3 gv = texture2D(tGrav, rdP / 0.9).rgb;
  float lum = dot(gv, vec3(0.333)) / 0.33;
  vec3 base = pv ? vec3(0.32, 0.31, 0.3) : vec3(0.52, 0.5, 0.45);
  rdCol = base * (0.86 + 0.28 * j.y) * mix(1.0, lum, 0.3) * (0.9 + 0.2 * rdNB);
  rdCol *= 1.0 - 0.5 * j.x;
  rdN = (texture2D(tGravN, rdP / 0.9).xy * 2.0 - 1.0) * 0.35;
  if (!pv && rdMk > 0.5) {
    float e = rdT * rdW;
    float curb = 1.0 - smoothstep(0.17, 0.19, e);
    rdCol = mix(rdCol, vec3(0.46, 0.46, 0.45) * mix(1.0, lum, 0.25), curb);
    rdCol *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.03, e));
  }
} else {
  // übrige Beläge (Promenade, Kai, Vorfeld, Holz, Piste): Atlas-Farbe mit feiner Körnung
  float g = rdSid > ${S.prom - 0.5} && rdSid < ${S.prom + 0.5} ? dot(texture2D(tGrav, rdP / 1.6).rgb, vec3(0.333)) / 0.33 : clamp(dot(texture2D(tAsph, rdP / 2.5).rgb, vec3(0.333)) / 0.11, 0.45, 1.9);
  rdCol = rdAtl.rgb * mix(1.0, g, abs(rdSid - ${S.deck}.0) < 0.5 ? 0.0 : 0.35);
}
diffuseColor.rgb = rdCol;
`)
      .replace('#include <color_fragment>', '')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * clamp(rdRough, 0.08, 1.0);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + mat3(viewMatrix) * vec3(rdN.x, 0.0, rdN.y));');
  };
  mat.customProgramCacheKey = () => 'road-hd-v1';
  mat.userData.tex = { grass: grass.map, grassN: grass.normal, grav: grav.map, gravN: grav.normal, noise: uniforms.tNoise.value };
  return mat;
}
