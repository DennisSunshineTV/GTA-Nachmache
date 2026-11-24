// Gemeinsame Materialien. Tag/Nacht-Zustand wird zentral gesteuert (Fensterlicht, Leuchtreklamen).
import * as THREE from 'three';
import * as T from './textures.js';
import { smoothstep } from '../util.js';

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
    this.road = new THREE.MeshStandardMaterial({ map: roadAtlas, roughness: 0.93, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: true });

    const sign = T.makeSignAtlas(signList);
    this.sign = new THREE.MeshStandardMaterial({ map: sign.map, emissiveMap: sign.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.5, roughness: 0.6, vertexColors: true });

    this.tex.pool = T.makePoolTexture();
    this.pool = new THREE.MeshStandardMaterial({ map: this.tex.pool, color: 0xffffff, roughness: 0.08, metalness: 0.0, emissive: new THREE.Color(0.05, 0.4, 0.5), emissiveIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.poolRim = new THREE.MeshStandardMaterial({ color: 0xece6d8, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, vertexColors: true });

    this.tex.frond = T.makeFrondTexture();
    this.frond = new THREE.MeshStandardMaterial({ map: this.tex.frond, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, vertexColors: true });
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
    this.pool.emissiveIntensity = 0.1 + w * 0.7;
    // nasse Straßen
    this.road.roughness = 0.93 - rain * 0.55;
  }
}

function terrain(m) { return m.terrain; }
