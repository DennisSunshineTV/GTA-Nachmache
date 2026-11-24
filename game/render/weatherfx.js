// Wetter- und Nachteffekte: Regen, Lichtschein von Laternen und Fahrzeugen, Scheinwerferkegel.
import * as THREE from 'three';
import { clamp } from '../util.js';

const RAIN_VERT = /* glsl */`
attribute vec3 aBase;
attribute float aEnd;
uniform float uTime, uIntensity;
uniform vec3 uCam;
varying float vA;
void main() {
  vec3 box = vec3(60.0, 36.0, 60.0);
  vec3 p = aBase * box;
  float speed = 24.0 + aBase.x * 8.0;
  p.y = mod(p.y - uTime * speed, box.y);
  vec3 off = p - box * 0.5;
  vec3 w = uCam + off;
  // an Weltgitter binden (kein Mitwandern)
  w.xz = uCam.xz + mod(p.xz - uCam.xz + box.xz * 0.5, box.xz) - box.xz * 0.5;
  w.y = uCam.y + p.y - 10.0;
  w.x += (aEnd) * 0.35; w.y += aEnd * 1.1;
  vA = step(aBase.z, uIntensity) * (1.0 - aEnd * 0.5);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const RAIN_FRAG = /* glsl */`
varying float vA;
uniform float uDay;
void main() {
  if (vA < 0.01) discard;
  gl_FragColor = vec4(vec3(0.62, 0.68, 0.78) * (0.35 + 0.65 * uDay), 0.32 * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class WeatherFx {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    // Regen
    const N = 5000;
    const base = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2), pos = new Float32Array(N * 2 * 3);
    for (let i = 0; i < N; i++) {
      const x = Math.random(), y = Math.random(), z = Math.random();
      for (let k = 0; k < 2; k++) { base.set([x, y, z], (i * 2 + k) * 3); end[i * 2 + k] = k; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainU = { uTime: { value: 0 }, uIntensity: { value: 0 }, uCam: { value: new THREE.Vector3() }, uDay: { value: 1 } };
    this.rain = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: this.rainU, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false }));
    this.rain.frustumCulled = false; this.rain.visible = false; this.rain.renderOrder = 8;
    scene.add(this.rain);

    // Glühpunkte (Laternen, Scheinwerfer, Rücklichter)
    const tex = game.mats.tex.glow;
    const mk = (size, color, max) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geo.setDrawRange(0, 0);
      const m = new THREE.Points(geo, new THREE.PointsMaterial({ map: tex, size, sizeAttenuation: true, color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.frustumCulled = false; m.renderOrder = 9;
      scene.add(m);
      return { pts: m, max, n: 0 };
    };
    this.lampGlow = mk(3.4, new THREE.Color(2.2, 1.5, 0.7), 3000);
    this.headGlow = mk(2.4, new THREE.Color(2.0, 1.9, 1.5), 600);
    this.tailGlow = mk(1.4, new THREE.Color(2.2, 0.25, 0.2), 600);
    this.neonGlow = mk(6, new THREE.Color(1.4, 0.4, 1.3), 400);
    // Scheinwerferkegel des Spielers
    this.spot = new THREE.SpotLight(0xfff0d0, 0, 70, 0.5, 0.6, 1.4);
    this.spotTarget = new THREE.Object3D();
    scene.add(this.spot, this.spotTarget);
    this.spot.target = this.spotTarget;
    this.spot.castShadow = false;
    this.lampList = [];
    this._lampDirty = true;
  }

  setLamps(list) { this.lampList = list; this._lampDirty = true; }

  _fill(obj, arr) {
    const a = obj.pts.geometry.attributes.position.array;
    const n = Math.min(obj.max, arr.length / 3);
    a.set(arr.subarray ? arr.subarray(0, n * 3) : arr.slice(0, n * 3), 0);
    obj.pts.geometry.setDrawRange(0, n);
    obj.pts.geometry.attributes.position.needsUpdate = true;
    obj.n = n;
  }

  update(dt, cam) {
    const g = this.game, atm = g.atm;
    const night = atm.night;
    // Regen
    const rain = atm.w.rain;
    this.rain.visible = rain > 0.02;
    this.rainU.uTime.value += dt;
    this.rainU.uIntensity.value = rain;
    this.rainU.uCam.value.copy(cam.position);
    this.rainU.uDay.value = 1 - night * 0.85;
    // Laternen
    const on = clamp((night - 0.2) / 0.5, 0, 1);
    this.lampGlow.pts.material.opacity = on * 0.85;
    this.headGlow.pts.material.opacity = clamp(on + (1 - atm.w.fog * 0), 0, 1) * 0.0 + on * 0.9;
    this.tailGlow.pts.material.opacity = (0.25 + on * 0.75);
    this.neonGlow.pts.material.opacity = on * 0.55;
    if (on > 0.02 && this._lampDirty) { this._fill(this.lampGlow, this.lampList.neon ? new Float32Array(0) : this.lampList.lamps || new Float32Array(0)); this._fill(this.neonGlow, this.lampList.neon || new Float32Array(0)); this._lampDirty = false; }
    // Fahrzeuge
    const head = [], tail = [];
    const px = cam.position.x, pz = cam.position.z;
    for (const v of g.vehicles.list) {
      if (!v.alive || v.exploded || (v.cls === 'boat') && v.hl < 3) continue;
      const d2 = (v.x - px) ** 2 + (v.z - pz) ** 2;
      if (d2 > 260 * 260) continue;
      const lightsOn = (v.engineOn && night > 0.25) || v.lightsOn;
      const c = Math.cos(v.h), s = Math.sin(v.h);
      const fx = s, fz = c, lx = c, lz = -s;
      const fwd = v.hl * 0.96, w = v.hw * 0.62;
      if (lightsOn) { for (const sx of (v.cls === 'bike' ? [0] : [-1, 1])) head.push(v.x + fx * fwd + lx * w * sx, v.y + Math.min(0.75, v.height * 0.4), v.z + fz * fwd + lz * w * sx); }
      if (v.ctl.brake > 0.1 || lightsOn || (v.ctl.throttle < -0.1 && v.speed > 0)) for (const sx of (v.cls === 'bike' ? [0] : [-1, 1])) tail.push(v.x - fx * fwd + lx * w * sx, v.y + Math.min(0.8, v.height * 0.45), v.z - fz * fwd + lz * w * sx);
    }
    this._fill(this.headGlow, new Float32Array(head));
    this._fill(this.tailGlow, new Float32Array(tail));
    // Scheinwerferkegel des Spielers
    const p = g.player, v = p.vehicle;
    if (v && night > 0.25 && v.engineOn && !v.exploded && v.cls !== 'plane' && v.cls !== 'heli') {
      const f = { x: Math.sin(v.h), z: Math.cos(v.h) };
      this.spot.position.set(v.x + f.x * (v.hl * 0.7), v.y + 0.8, v.z + f.z * (v.hl * 0.7));
      this.spotTarget.position.set(v.x + f.x * 30, v.y - 0.4, v.z + f.z * 30);
      this.spot.intensity = 260 * on;
    } else this.spot.intensity = 0;
  }
}
