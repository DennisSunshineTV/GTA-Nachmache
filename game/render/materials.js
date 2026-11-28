// Gemeinsame Materialien. Tag/Nacht-Zustand wird zentral gesteuert (Fensterlicht, Leuchtreklamen).
import * as THREE from 'three';
import * as T from './textures.js';
import { smoothstep } from '../util.js';
import { makeRoadMaterial } from './roadshader.js';
import * as HD from './hdtextures.js';
import { makeFoliageAtlas } from './foliage.js';

const POOL_MAX = 32;   // so viele Pools um die Kamera bekommen ein Loch im Gelände

export class Materials {
  constructor(signList) {
    this.tex = {};
    const detail = T.makeDetailTexture();
    this.tex.detail = detail;
    this.terrain = new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: 0.97, metalness: 0 });

    const fac = (maker, opts = {}) => {
      const t = maker();
      const m = new THREE.MeshStandardMaterial({
        map: t.map, emissiveMap: t.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0,
        vertexColors: true, roughness: opts.rough ?? 0.88, metalness: opts.metal ?? 0.0,
      });
      return m;
    };
    this.facade = {
      plaster: fac(T.makePlasterFacade),
      old: fac(T.makeOldFacade),
      hotel: fac(T.makeHotelFacade, { rough: 0.8 }),
      glass: fac(T.makeGlassFacade, { rough: 0.24, metal: 0.32 }),
      shop: fac(T.makeShopFacade),
      metal: fac(T.makeMetalFacade, { rough: 0.55, metal: 0.25 }),
      club: fac(T.makeClubFacade, { rough: 0.7 }),
      finca: fac(T.makeFincaFacade, { rough: 0.95 }),
    };
    this.roof = new THREE.MeshStandardMaterial({ map: T.makeRoofTexture(), vertexColors: true, roughness: 0.85 });
    this.flat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0 });
    this.glassFlat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.1, metalness: 0.5 });

    const roadAtlas = T.makeRoadAtlas();
    this.tex.road = roadAtlas;
    this.road = makeRoadMaterial(roadAtlas);
    // Gelände: in der Nähe feine Gras- bzw. Kiesstruktur in Weltkoordinaten (wie am Straßenrand), großflächige Tönung
    const rt = this.road.userData.tex;
    // Pools in der Nähe: dort hat das Gelände ein Loch in Beckenform (darunter liegt das Becken), siehe setPools
    this.poolU = { uPoolP: { value: Array.from({ length: POOL_MAX }, () => new THREE.Vector4()) }, uPoolS: { value: Array.from({ length: POOL_MAX }, () => new THREE.Vector4()) }, uPoolN: { value: 0 } };
    this.terrain.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { tGrass: { value: rt.grass }, tGrassN: { value: rt.grassN }, tGrav: { value: rt.grav }, tGravN: { value: rt.gravN }, tNoise: { value: rt.noise } }, this.poolU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vTW;`).replace('#include <fog_vertex>', `#include <fog_vertex>
vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tGrass, tGrassN, tGrav, tGravN, tNoise;
uniform vec4 uPoolP[${POOL_MAX}];
uniform vec4 uPoolS[${POOL_MAX}];
uniform int uPoolN;
varying vec3 vTW;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  // Schwimmbecken: Gelände über dem Becken weglassen (x,z,cos,sin / Halbbreite, Halbtiefe, Form, Inselradius)
  for (int pi = 0; pi < ${POOL_MAX}; pi++) {
    if (pi >= uPoolN) break;
    vec2 pd = vTW.xz - uPoolP[pi].xy;
    vec4 PS = uPoolS[pi];
    if (dot(pd, pd) > (PS.x * PS.x + PS.y * PS.y) * 1.05 + 0.5) continue;
    vec2 pl = vec2(uPoolP[pi].z * pd.x - uPoolP[pi].w * pd.y, uPoolP[pi].w * pd.x + uPoolP[pi].z * pd.y);
    vec2 pq = abs(pl) / PS.xy;
    float pv = PS.z < 0.5 ? pow(pq.x, 6.0) + pow(pq.y, 6.0) : dot(pq, pq);
    if (pv < 0.995 && length(pl) >= PS.w) discard;
  }
  float tFade = 1.0 - smoothstep(35.0, 120.0, length(vTW - cameraPosition));
  float tGreen = vColor.g / (vColor.r + vColor.g + vColor.b + 1e-4);
  float tG = smoothstep(0.4, 0.47, tGreen);
  vec2 tw = vTW.xz;
  diffuseColor.rgb *= 0.9 + 0.2 * texture2D(tNoise, tw / 43.0).r;
  float gL = clamp(dot(texture2D(tGrass, tw / 1.4).rgb, vec3(0.333)) / 0.085, 0.35, 2.0);
  float sL = clamp(dot(texture2D(tGrav, tw / 1.7).rgb, vec3(0.333)) / 0.3, 0.55, 1.6);
  diffuseColor.rgb *= mix(1.0, mix(sL, gL, tG), tFade * mix(0.35, 0.7, tG));
  vec2 tN = mix(texture2D(tGravN, tw / 1.7).xy, texture2D(tGrassN, tw / 1.4).xy, tG) * 2.0 - 1.0;`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(normal + mat3(viewMatrix) * vec3(tN.x, 0.0, tN.y) * 0.55 * tFade);`);
    };
    this.terrain.customProgramCacheKey = () => 'terrain-hd-v2-pools';

    const sign = T.makeSignAtlas(signList);
    this.sign = new THREE.MeshStandardMaterial({ map: sign.map, emissiveMap: sign.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.5, roughness: 0.6, vertexColors: true });

    this.tex.pool = T.makePoolTexture();
    // Poolwasser: durchsichtig (Schwimmer und Beckenboden sichtbar, auch von unten), aus der Ferne deckend
    this.pool = new THREE.MeshStandardMaterial({ map: this.tex.pool, color: 0xd8f4ff, roughness: 0.06, metalness: 0.0, emissive: new THREE.Color(0.05, 0.4, 0.5), emissiveIntensity: 0.25, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    this.pool.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW;').replace('#include <fog_vertex>', '#include <fog_vertex>\nvPW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPW;').replace('#include <opaque_fragment>', `#include <opaque_fragment>
  { float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 3.0);
    float far = smoothstep(140.0, 220.0, length(vPW - cameraPosition));
    gl_FragColor.a = clamp(max(mix(gl_FragColor.a, 0.92, fr), far), 0.0, 1.0); }`);
    };
    this.pool.customProgramCacheKey = () => 'pool-water-v2';
    // Becken (Wände und Boden): helle Fliesen mit Lichtmuster
    this.poolBasin = new THREE.MeshStandardMaterial({ map: this.tex.pool, vertexColors: true, roughness: 0.32, metalness: 0.0 });
    this.poolRim = new THREE.MeshStandardMaterial({ color: 0xece6d8, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: true });

    this.tex.frond = T.makeFrondTexture();
    this.frond = new THREE.MeshStandardMaterial({ map: this.tex.frond, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, vertexColors: true });
    // Gras- und Blattkarten: beidseitig, Normale wird auf der Rückseite NICHT umgedreht (sonst dunkle Flecken)
    const foliage = (map, alphaTest, rough) => {
      const m = new THREE.MeshStandardMaterial({ map, alphaTest, side: THREE.DoubleSide, roughness: rough, vertexColors: true });
      m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, '')); };
      m.customProgramCacheKey = () => 'foliage-' + alphaTest;
      return m;
    };
    this.tex.grassCard = HD.makeGrassCard();
    this.grassCard = foliage(this.tex.grassCard, 0.42, 0.92);
    // Laub der Bäume und Büsche (render/foliage.js): Atlas mit Blattbüscheln. Wind wiegt die Kronen (Ausschlag wächst mit
    // der Höhe), die Alpha-Kante bleibt auch in der Ferne dicht (Mip-Ausgleich) und Gegenlicht scheint leicht durch.
    this.foliageU = { uTime: { value: 0 } };
    this.tex.foliage = makeFoliageAtlas();
    this.leafCard = new THREE.MeshStandardMaterial({ map: this.tex.foliage, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.82, vertexColors: true });
    this.leafCard.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.foliageU.uTime;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `#include <begin_vertex>
  {
    #ifdef USE_INSTANCING
      vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
    #else
      vec3 ip = vec3(0.0);
    #endif
    float h = max(0.0, position.y);
    float ph = ip.x * 0.13 + ip.z * 0.11;
    float big = sin(uTime * 0.9 + ph) * 0.6 + sin(uTime * 1.7 + ph * 1.3) * 0.4;
    float flut = sin(uTime * 4.3 + position.x * 1.7 + position.z * 1.3 + ph) * 0.35;
    transformed.x += (big * 0.018 + flut * 0.012) * h;
    transformed.z += (sin(uTime * 1.1 + ph * 0.7) * 0.012 + flut * 0.01) * h;
  }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, ''))
        .replace('#include <alphatest_fragment>', `
  #ifdef USE_MAP
  { vec2 tsz = vec2(textureSize(map, 0)); vec2 ddx = dFdx(vMapUv * tsz), ddy = dFdy(vMapUv * tsz);
    float lod = max(0.0, 0.5 * log2(max(dot(ddx, ddx), dot(ddy, ddy))));
    diffuseColor.a *= 1.0 + lod * 0.3; }
  #endif
  if (diffuseColor.a < alphaTest) discard;`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.06;');
    };
    this.leafCard.customProgramCacheKey = () => 'leaf-card-v2';
    // Einfamilienhäuser (render/housegeom.js): Texturen in Metern, Tönung über Vertexfarben
    const winAtlas = HD.makeWindowAtlas();
    const tm = (t, o = {}) => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(o.n ?? 0.8, o.n ?? 0.8), vertexColors: true, roughness: o.rough ?? 0.9, metalness: 0 });
    const woodTex = HD.makeWood();
    this.house = {
      plaster: tm(HD.makePlaster(), { n: 0.45, rough: 0.94 }),
      roof: tm(HD.makeRoofTiles(), { n: 1.0, rough: 0.7 }),
      wood: tm(woodTex, { n: 0.5, rough: 0.72 }),
      stone: tm(HD.makeStoneWall(), { n: 0.9, rough: 0.92 }),
      hedge: tm(HD.makeHedge(), { n: 1.0, rough: 0.95 }),
      glass: new THREE.MeshStandardMaterial({ map: winAtlas, vertexColors: true, roughness: 0.06, metalness: 0.35 }),
      glassLit: new THREE.MeshStandardMaterial({ map: winAtlas, vertexColors: true, roughness: 0.06, metalness: 0.3, emissive: new THREE.Color(1.0, 0.72, 0.45), emissiveMap: winAtlas, emissiveIntensity: 0 }),
      fence: new THREE.MeshStandardMaterial({ map: HD.makeFenceBars(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.45 }),
    };
    // ---- Strandhaus: dunkler Dielenboden (seidig), LED-Licht, Lichtschein, klares Glas, angestrahlte Blätter ----
    this.deckWood = tm(woodTex, { n: 0.45, rough: 0.42 });
    this.led = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.glow = new THREE.MeshBasicMaterial({ map: T.makeGlowTexture(), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.homeGlass = new THREE.MeshStandardMaterial({ color: 0x3c4c58, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 });
    this.homeGlass.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `#include <opaque_fragment>
  { float fr = pow(1.0 - clamp(abs(dot(normalize(vViewPosition), normal)), 0.0, 1.0), 3.0);
    gl_FragColor.a = clamp(mix(gl_FragColor.a, 0.85, fr), 0.0, 1.0); }`);
    };
    this.homeGlass.customProgramCacheKey = () => 'home-glass-v1';
    this.leafU = { uUp: { value: 0.1 } };
    this.leaf = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, side: THREE.DoubleSide });
    this.leaf.onBeforeCompile = (sh) => {
      sh.uniforms.uUp = this.leafU.uUp;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLeafT;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLeafT = uv.y;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uUp;\nvarying float vLeafT;').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += diffuseColor.rgb * uUp * (1.0 - smoothstep(0.0, 0.95, vLeafT)) * vec3(2.6, 1.8, 0.5);`);
    };
    this.leaf.customProgramCacheKey = () => 'leaf-uplit-v1';
    this.prop = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    // Markierungen auf dem Belag (Parkbuchten): stärker zur Kamera gezogen als die Fahrbahn selbst
    this.marking = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    this.propMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6 });
    this.tex.glow = T.makeGlowTexture();

    this.windowLevel = 0;
    this.all = [terrain(this), ...Object.values(this.facade), this.roof, this.flat, this.road, this.sign, this.pool, this.frond, this.prop];
  }

  // Pools in der Nähe der Kamera an den Gelände-Shader geben (höchstens POOL_MAX, die nächsten zuerst)
  setPools(list) {
    const U = this.poolU, n = Math.min(POOL_MAX, list.length);
    for (let i = 0; i < n; i++) {
      const p = list[i];
      U.uPoolP.value[i].set(p.x, p.z, Math.cos(p.rot), Math.sin(p.rot));
      U.uPoolS.value[i].set(p.w / 2, p.d / 2, p.shape === 'rect' ? 0 : 1, p.island ? p.d * 0.19 : 0);
    }
    U.uPoolN.value = n;
  }

  // night: 0 (Tag) … 1 (Nacht)
  setNight(night, rain = 0) {
    const w = smoothstep(0.12, 0.7, night);
    for (const m of Object.values(this.facade)) m.emissiveIntensity = (m === this.facade.club ? 0.35 + w * 3 : w * 0.95);
    this.facade.shop.emissiveIntensity = w * 1.1 + 0.02;
    this.sign.emissiveIntensity = 0.25 + w * 2.2;
    this.house.glassLit.emissiveIntensity = w * 1.5;
    this.pool.emissiveIntensity = 0.1 + w * 0.7;
    // Strandhaus: LED und Lichtschein werden abends kräftig, tagsüber nur dezent
    const eve = smoothstep(0.0, 0.45, night);
    this.led.color.setScalar(1.35 + eve * 2.0);
    this.glow.color.setScalar(0.16 + eve * 0.95);
    this.leafU.uUp.value = 0.1 + eve * 0.8;
    // nasse Straßen
    this.road.roughness = 0.93 - rain * 0.55;
  }
}

function terrain(m) { return m.terrain; }
