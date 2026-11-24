// Atmosphäre: Himmelskuppel (Verlauf, Sonne, Wolken, Sterne, Mond), Tageszeit, Wetter, Licht, Nebel, Umgebungskarte.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU } from '../util.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // am Fernclip
}`;

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSunDir, uMoonDir;
uniform vec3 uZenith, uHorizon, uGround, uSunColor;
uniform vec3 uCloudLit, uCloudShadow;
uniform float uCover, uTime, uStars, uSunIntensity, uDarken, uDesat;
uniform vec2 uWind;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return s;
}
float star(vec3 d) {
  vec3 g = d * 220.0; vec3 id = floor(g);
  float h = fract(sin(dot(id, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 c = fract(g) - 0.5;
  float r = smoothstep(0.35, 0.0, length(c));
  return step(0.9965, h) * r * (0.5 + 0.5 * fract(h * 91.7));
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // Verlauf
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);
  if (h < 0.0) col = mix(uHorizon, uGround, smoothstep(0.0, -0.12, h));
  float sd = max(dot(d, uSunDir), 0.0);
  // Sonnenschein: breiter Schimmer + Scheibe
  col += uSunColor * (pow(sd, 6.0) * 0.28 + pow(sd, 48.0) * 0.5 + pow(sd, 700.0) * 2.0) * uSunIntensity;
  col += uSunColor * smoothstep(0.99955, 0.99975, sd) * 30.0 * uSunIntensity;
  // Horizontdunst
  col = mix(col, uHorizon * 1.05, pow(1.0 - clamp(abs(h), 0.0, 1.0), 12.0) * 0.55);
  // Sterne und Mond
  if (uStars > 0.01 && h > 0.0) {
    col += vec3(1.0, 0.95, 0.9) * star(d) * uStars * 2.2;
    float md = dot(d, uMoonDir);
    col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, md) * 3.2 * uStars;
    col += vec3(0.5, 0.6, 0.9) * pow(max(md, 0.0), 120.0) * 0.25 * uStars;
  }
  // Wolken (projizierte Ebene)
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.17) * 0.85 + uWind * uTime;
    float n = fbm(uv * 0.65) + 0.18 * fbm(uv * 2.6 + 3.1);
    float t0 = 0.80 - 0.46 * uCover;
    float dens = smoothstep(t0, t0 + 0.2, n);
    float n2 = fbm((uv + uSunDir.xz * 0.16) * 0.65) + 0.18 * fbm((uv + uSunDir.xz * 0.16) * 2.6 + 3.1);
    float shade = clamp((n - n2) * 5.0 + 0.55, 0.0, 1.0);
    vec3 cc = mix(uCloudShadow, uCloudLit, shade);
    cc += uSunColor * pow(sd, 5.0) * 0.35 * dens * uSunIntensity;
    float fade = smoothstep(0.0, 0.14, h);
    col = mix(col, cc, dens * fade * (0.92 - 0.1 * (1.0 - uCover)));
  }
  col *= uDarken;
  col = mix(col, vec3(dot(col, vec3(0.3333))), uDesat);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Farbtabellen nach Sonnenhöhe (Grad)
const C = (r, g, b) => new THREE.Color(r, g, b);
const PAL = {
  night: { zen: C(0.004, 0.008, 0.035), hor: C(0.03, 0.045, 0.1), sun: C(0.5, 0.5, 0.7), lit: C(0.12, 0.14, 0.24), sha: C(0.02, 0.03, 0.07), gnd: C(0.01, 0.015, 0.03) },
  twi: { zen: C(0.05, 0.07, 0.26), hor: C(0.9, 0.38, 0.34), sun: C(1.0, 0.38, 0.16), lit: C(1.0, 0.55, 0.45), sha: C(0.26, 0.2, 0.4), gnd: C(0.2, 0.1, 0.12) },
  gold: { zen: C(0.16, 0.32, 0.72), hor: C(1.0, 0.65, 0.4), sun: C(1.0, 0.6, 0.3), lit: C(1.0, 0.82, 0.62), sha: C(0.55, 0.5, 0.62), gnd: C(0.5, 0.35, 0.28) },
  day: { zen: C(0.035, 0.2, 0.74), hor: C(0.46, 0.72, 0.97), sun: C(1.0, 0.96, 0.88), lit: C(1.0, 1.0, 1.0), sha: C(0.58, 0.67, 0.8), gnd: C(0.5, 0.58, 0.62) },
};

const WEATHER = {
  sunny: { cover: 0.22, dark: 1.0, fog: 0.0, rain: 0, gray: 0.0, wind: 1 },
  clear: { cover: 0.42, dark: 1.0, fog: 0.0, rain: 0, gray: 0.05, wind: 1.2 },
  cloudy: { cover: 0.72, dark: 0.92, fog: 0.15, rain: 0, gray: 0.35, wind: 1.8 },
  overcast: { cover: 0.95, dark: 0.78, fog: 0.4, rain: 0, gray: 0.6, wind: 2.2 },
  rain: { cover: 1.0, dark: 0.62, fog: 0.8, rain: 0.8, gray: 0.8, wind: 3 },
  storm: { cover: 1.0, dark: 0.42, fog: 1.0, rain: 1.0, gray: 0.9, wind: 5 },
  fog: { cover: 0.6, dark: 0.85, fog: 2.2, rain: 0, gray: 0.5, wind: 0.8 },
};
export const WEATHER_NAMES = { sunny: 'Sonnig', clear: 'Heiter', cloudy: 'Bewölkt', overcast: 'Bedeckt', rain: 'Regen', storm: 'Gewitter', fog: 'Nebel' };

const tmpC = new THREE.Color();

export class Atmosphere {
  constructor(renderer, scene, camera, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.hour = opts.hour ?? 10;
    this.time = 0;
    this.weatherKey = opts.weather || 'sunny';
    this.w = { ...WEATHER[this.weatherKey] };
    this.target = { ...WEATHER[this.weatherKey] };
    this.lightning = 0;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.elev = 30;
    this.night = 0; // 0 Tag … 1 Nacht
    this.dusk = 0;  // Dämmerung
    this.fogColor = new THREE.Color(0.6, 0.8, 0.97);
    this.horizonColor = new THREE.Color();
    this.zenithColor = new THREE.Color();
    this.sunColor = new THREE.Color();
    this.skyUniforms = {
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() }, uCloudLit: { value: new THREE.Color() }, uCloudShadow: { value: new THREE.Color() },
      uCover: { value: 0.4 }, uTime: { value: 0 }, uStars: { value: 0 }, uSunIntensity: { value: 1 }, uDarken: { value: 1 }, uDesat: { value: 0 }, uWind: { value: new THREE.Vector2(0.004, 0.0017) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 40, 24), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    scene.add(this.sky);

    // Licht
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const q = opts.shadowSize || 2048;
    this.sun.shadow.mapSize.set(q, q);
    const sc = this.sun.shadow.camera;
    this.shadowRange = opts.shadowRange || 110;
    sc.left = -this.shadowRange; sc.right = this.shadowRange; sc.top = this.shadowRange; sc.bottom = -this.shadowRange; sc.near = 1; sc.far = 900;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.35;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd7ff, 0x7a6a55, 0.35);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0x99ccff, 0.00016);

    // Umgebungskarte (IBL) aus dem Himmel
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(this.sky.geometry, mat);
    this.envSky.frustumCulled = false;
    this.envScene.add(this.envSky);
    this.envRT = null;
    this.envHour = -99;
    this.envWeatherSig = '';
    this._update(0, true);
  }

  setWeather(key, instant = false) {
    if (!WEATHER[key]) return;
    this.weatherKey = key;
    this.target = { ...WEATHER[key] };
    if (instant) this.w = { ...WEATHER[key] };
  }

  // Sonnenstand aus der Uhrzeit (Sommer, Mallorca: ~06:30 – 20:30)
  _sunFromHour(h) {
    let a;
    if (h >= 6.5 && h <= 20.5) a = ((h - 6.5) / 14) * Math.PI;
    else a = Math.PI + (((h < 6.5 ? h + 24 : h) - 20.5) / 10) * Math.PI;
    const y = Math.sin(a) * 0.9;
    const x = Math.cos(a);
    const z = Math.sin(a) * 0.43;
    return this.sunDir.set(x, y, z).normalize();
  }

  _update(dt, force = false) {
    // Wetter überblenden
    const k = 1 - Math.exp(-dt * 0.35);
    for (const key of Object.keys(this.w)) this.w[key] += (this.target[key] - this.w[key]) * k;
    this.time += dt;

    const sd = this._sunFromHour(this.hour);
    this.moonDir.set(-sd.x, -sd.y * 0.9 + 0.15, -sd.z).normalize();
    const elev = (Math.asin(clamp(sd.y, -1, 1)) * 180) / Math.PI;
    this.elev = elev;
    // Paletten mischen
    const mix = (key) => {
      const out = new THREE.Color();
      let a, b, t;
      if (elev < -10) { a = b = PAL.night; t = 0; }
      else if (elev < -3) { a = PAL.night; b = PAL.twi; t = smoothstep(-10, -3, elev); }
      else if (elev < 5) { a = PAL.twi; b = PAL.gold; t = smoothstep(-3, 5, elev); }
      else if (elev < 22) { a = PAL.gold; b = PAL.day; t = smoothstep(5, 22, elev); }
      else { a = b = PAL.day; t = 0; }
      return out.copy(a[key]).lerp(b[key], t);
    };
    const zen = mix('zen'), hor = mix('hor'), sun = mix('sun'), lit = mix('lit'), sha = mix('sha'), gnd = mix('gnd');
    // Wetter-Entsättigung
    const gray = this.w.gray, dark = this.w.dark;
    const desat = (c, amt, mul) => { const l = (c.r + c.g + c.b) / 3; c.r = lerp(c.r, l * 0.9, amt) * mul; c.g = lerp(c.g, l * 0.92, amt) * mul; c.b = lerp(c.b, l * 0.96, amt) * mul; return c; };
    desat(zen, gray, dark); desat(hor, gray * 0.8, dark * (1 + 0.15 * gray)); desat(lit, gray * 0.6, dark); desat(sha, gray * 0.4, dark * 0.9); desat(gnd, gray * 0.5, dark);
    const u = this.skyUniforms;
    u.uZenith.value.copy(zen); u.uHorizon.value.copy(hor); u.uSunColor.value.copy(sun); u.uCloudLit.value.copy(lit); u.uCloudShadow.value.copy(sha); u.uGround.value.copy(gnd);
    u.uCover.value = this.w.cover;
    u.uTime.value = this.time * (this.w.wind || 1);
    this.night = 1 - smoothstep(-8, 2, elev);
    this.dusk = smoothstep(-10, 0, elev) * (1 - smoothstep(0, 12, elev));
    u.uStars.value = smoothstep(-6, -14, elev) * (1 - this.w.cover * 0.8);
    u.uSunIntensity.value = smoothstep(-4, 4, elev) * (1 - this.w.cover * 0.7);
    u.uDarken.value = 1;
    this.horizonColor.copy(hor);
    this.zenithColor.copy(zen);
    this.sunColor.copy(sun);

    // Licht: eine Richtungslichtquelle, die weich von Sonne zu Mond wechselt
    const sunI = smoothstep(-2, 9, elev) * lerp(2.4, 3.8, clamp(elev / 60, 0, 1)) * (1 - 0.72 * this.w.cover * (0.5 + 0.5 * gray));
    const moonI = (1 - smoothstep(-6, 2, elev)) * 1.1 * (1 - this.w.cover * 0.6);
    const ws = smoothstep(-4, 4, elev);
    this.lightDir = (this.lightDir || new THREE.Vector3()).copy(this.moonDir).lerp(this.sunDir, ws).normalize();
    this.sun.color.copy(tmpC.setRGB(0.55, 0.66, 1.0)).lerp(sun, ws).lerp(tmpC.setRGB(1, 1, 1), 0.12 * ws);
    this.sun.intensity = sunI * ws + moonI * (1 - ws) + this.lightning * 6;
    this.hemi.color.copy(zen).lerp(hor, 0.5).multiplyScalar(0.9);
    { const hl = (this.hemi.color.r + this.hemi.color.g + this.hemi.color.b) / 3; this.hemi.color.r = lerp(this.hemi.color.r, hl, 0.4); this.hemi.color.g = lerp(this.hemi.color.g, hl, 0.4); this.hemi.color.b = lerp(this.hemi.color.b, hl, 0.4); }
    this.hemi.groundColor.copy(gnd).multiplyScalar(0.6);
    this.hemi.intensity = lerp(0.2, 0.5, this.night) + this.lightning * 0.5;
    this.scene.environmentIntensity = lerp(0.62, 0.62, this.night) * (0.65 + 0.35 * (1 - this.w.cover * 0.5));

    // Nebel
    const fc = this.fogColor.copy(hor).lerp(tmpC.copy(zen), 0.08);
    this.scene.fog.color.copy(fc);
    const baseD = 0.00013;
    this.scene.fog.density = baseD + this.w.fog * 0.0012 * (1 + this.night * 0.4);
    this.exposure = lerp(0.74, 1.15, this.night) * (1 - 0.08 * this.w.cover);

    // Umgebungskarte gelegentlich neu rechnen
    const sig = `${this.weatherKey}`;
    if (force || Math.abs(this.hour - this.envHour) > 0.2 || (this.hour < this.envHour - 12) || sig !== this.envWeatherSig) {
      this._updateEnv();
      this.envHour = this.hour;
      this.envWeatherSig = sig;
    }
  }

  _updateEnv() {
    const prev = this.envRT;
    // Umgebungslicht entsättigen: Schatten sollen kühl-grau wirken, nicht tiefblau
    this.skyUniforms.uDesat.value = 0.5;
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
    this.skyUniforms.uDesat.value = 0;
    this.scene.environment = this.envRT.texture;
    if (prev) prev.dispose();
  }

  // focus: Weltposition des Spielers (Sonnenlicht/Schatten folgen ihm)
  update(dt, focus, camera) {
    this._update(dt);
    this.sky.position.copy(camera.position);
    this.sky.scale.setScalar(1);
    // Blitze
    if (this.weatherKey === 'storm' && Math.random() < dt * 0.12) this.lightning = 1;
    this.lightning = Math.max(0, this.lightning - dt * 3.5);
    // Schatten: Position texelgenau an der Lichtachse ausrichten (kein Flimmern)
    const L = this.lightDir;
    const f = L.clone().multiplyScalar(-1).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(f).normalize();
    const up = new THREE.Vector3().crossVectors(f, right).normalize();
    const texel = (this.shadowRange * 2) / this.sun.shadow.mapSize.x;
    const lx = Math.round(focus.dot(right) / texel) * texel, ly = Math.round(focus.dot(up) / texel) * texel;
    const snapped = focus.clone().addScaledVector(right, lx - focus.dot(right)).addScaledVector(up, ly - focus.dot(up));
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(L, 450);
    this.sun.target.updateMatrixWorld();
  }

  get weatherInfo() { return { key: this.weatherKey, rain: this.w.rain, fog: this.w.fog, cover: this.w.cover }; }
}
