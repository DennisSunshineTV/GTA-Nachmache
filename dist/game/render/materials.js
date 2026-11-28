// Gemeinsame Materialien. Tag/Nacht-Zustand wird zentral gesteuert (Fensterlicht, Leuchtreklamen).
import * as THREE from 'three';
import * as T from './textures.js';
import { smoothstep } from '../util.js';
import { makeRoadMaterial } from './roadshader.js';
import * as HD from './hdtextures.js';

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
    this.terrain.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { tGrass: { value: rt.grass }, tGrassN: { value: rt.grassN }, tGrav: { value: rt.grav }, tGravN: { value: rt.gravN }, tNoise: { value: rt.noise } });
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
varying vec3 vTW;`).replace('#include <fog_vertex>', `#include <fog_vertex>
vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform sampler2D tGrass, tGrassN, tGrav, tGravN, tNoise;
varying vec3 vTW;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
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
    this.terrain.customProgramCacheKey = () => 'terrain-hd-v1';

    const sign = T.makeSignAtlas(signList);
    this.sign = new THREE.MeshStandardMaterial({ map: sign.map, emissiveMap: sign.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.5, roughness: 0.6, vertexColors: true });

    this.tex.pool = T.makePoolTexture();
    this.pool = new THREE.MeshStandardMaterial({ map: this.tex.pool, color: 0xffffff, roughness: 0.08, metalness: 0.0, emissive: new THREE.Color(0.05, 0.4, 0.5), emissiveIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
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
    this.tex.leaf = HD.makeLeafCard();
    this.leaf = foliage(this.tex.leaf, 0.46, 0.95);
    // Einfamilienhäuser (render/housegeom.js): Texturen in Metern, Tönung über Vertexfarben
    const winAtlas = HD.makeWindowAtlas();
    const tm = (t, o = {}) => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, normalScale: new THREE.Vector2(o.n ?? 0.8, o.n ?? 0.8), vertexColors: true, roughness: o.rough ?? 0.9, metalness: 0 });
    this.house = {
      plaster: tm(HD.makePlaster(), { n: 0.45, rough: 0.94 }),
      roof: tm(HD.makeRoofTiles(), { n: 1.0, rough: 0.7 }),
      wood: tm(HD.makeWood(), { n: 0.5, rough: 0.72 }),
      stone: tm(HD.makeStoneWall(), { n: 0.9, rough: 0.92 }),
      hedge: tm(HD.makeHedge(), { n: 1.0, rough: 0.95 }),
      glass: new THREE.MeshStandardMaterial({ map: winAtlas, vertexColors: true, roughness: 0.06, metalness: 0.35 }),
      glassLit: new THREE.MeshStandardMaterial({ map: winAtlas, vertexColors: true, roughness: 0.06, metalness: 0.3, emissive: new THREE.Color(1.0, 0.72, 0.45), emissiveMap: winAtlas, emissiveIntensity: 0 }),
      fence: new THREE.MeshStandardMaterial({ map: HD.makeFenceBars(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, metalness: 0.45 }),
    };
    this.prop = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    this.propMetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6 });
    this.tex.glow = T.makeGlowTexture();

    this.windowLevel = 0;
    this.all = [terrain(this), ...Object.values(this.facade), this.roof, this.flat, this.road, this.sign, this.pool, this.frond, this.prop];
  }

  // night: 0 (Tag) … 1 (Nacht)
  setNight(night, rain = 0) {
    const w = smoothstep(0.12, 0.7, night);
    for (const m of Object.values(this.facade)) m.emissiveIntensity = (m === this.facade.club ? 0.35 + w * 3 : w * 0.95);
    this.facade.shop.emissiveIntensity = w * 1.1 + 0.02;
    this.sign.emissiveIntensity = 0.25 + w * 2.2;
    this.house.glassLit.emissiveIntensity = w * 1.5;
    this.pool.emissiveIntensity = 0.1 + w * 0.7;
    // nasse Straßen
    this.road.roughness = 0.93 - rain * 0.55;
  }
}

function terrain(m) { return m.terrain; }
