// Meer: Polargitter um die Kamera, Wellen, Tiefenfarbe aus dem Küsten-Distanzfeld, Schaum, Glitzern.
import * as THREE from 'three';

// Wellenparameter – müssen mit dem Shader übereinstimmen (Boote schwimmen auf demselben Seegang)
const WAVES = [
  { dx: 0.82, dz: 0.57, L: 82, A: 0.26 },
  { dx: -0.42, dz: 0.91, L: 46, A: 0.15 },
  { dx: 0.18, dz: -0.98, L: 23, A: 0.075 },
  { dx: -0.91, dz: -0.41, L: 11.5, A: 0.035 },
];
for (const w of WAVES) { const l = Math.hypot(w.dx, w.dz); w.dx /= l; w.dz /= l; w.k = (Math.PI * 2) / w.L; w.w = Math.sqrt(9.81 * w.k); }

// Wellenhöhe in Metern (JS-Seite)
export function waveHeight(x, z, t, amp = 1) {
  let h = 0;
  for (const w of WAVES) h += w.A * Math.sin((x * w.dx + z * w.dz) * w.k - t * w.w);
  return h * amp;
}

const GLSL_WAVES = WAVES.map((w, i) => `
  { float ph = dot(p, vec2(${w.dx.toFixed(5)}, ${w.dz.toFixed(5)})) * ${w.k.toFixed(6)} - t * ${w.w.toFixed(5)};
    float s = sin(ph), c = cos(ph);
    h += ${w.A.toFixed(4)} * s; dh += ${(w.A * w.k).toFixed(6)} * c * vec2(${w.dx.toFixed(5)}, ${w.dz.toFixed(5)}); }`).join('\n');

const VERT = /* glsl */`
uniform float uTime;
uniform vec3 uCam;
varying vec3 vWorld;
varying float vAmp;
#include <fog_pars_vertex>
void waves(vec2 p, float t, out float h, out vec2 dh) {
  h = 0.0; dh = vec2(0.0);
  ${GLSL_WAVES}
}
void main() {
  vec3 pos = position;
  pos.xz += uCam.xz;
  float h; vec2 dh;
  float dist = length(pos.xz - uCam.xz);
  float amp = 1.0 - smoothstep(350.0, 900.0, dist);
  waves(pos.xz, uTime, h, dh);
  pos.y = h * amp;
  vAmp = amp;
  vWorld = pos;
  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uCam;
uniform sampler2D uSD;
uniform vec4 uSDP;      // x0, z0, cell, 0
uniform vec2 uSDSize;   // nx, nz
uniform vec3 uSunDir, uSunColor, uZenith, uHorizon;
uniform float uSunI, uDay, uRain, uGray;
varying vec3 vWorld;
varying float vAmp;
#include <fog_pars_fragment>

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void waves(vec2 p, float t, out float h, out vec2 dh) {
  h = 0.0; dh = vec2(0.0);
  ${GLSL_WAVES}
}
vec3 skyCol(vec3 d) {
  float t = pow(clamp(d.y, 0.0, 1.0), 0.42);
  vec3 c = mix(uHorizon, uZenith, t);
  float sd = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 48.0) * 0.4) * uSunI;
  return c;
}

void main() {
  vec2 p = vWorld.xz;
  vec2 uv = ((p - uSDP.xy) / uSDP.z + 0.5) / uSDSize;
  float sd = texture2D(uSD, uv).r;     // Meter, >0 = Land
  float depth = -sd;

  // Normale aus Wellen + feinem Rauschen
  float h; vec2 dh; waves(p, uTime, h, dh);
  float dist = length(vWorld - uCam);
  float fineAmp = (1.0 - smoothstep(80.0, 600.0, dist)) * (0.6 + uRain * 1.2);
  vec2 q1 = p * 0.9 + vec2(uTime * 0.6, uTime * 0.37);
  vec2 q2 = p * 2.4 - vec2(uTime * 0.9, -uTime * 0.5);
  vec2 g = vec2(vnoise(q1 + vec2(0.7, 0.0)) - vnoise(q1 - vec2(0.7, 0.0)), vnoise(q1 + vec2(0.0, 0.7)) - vnoise(q1 - vec2(0.0, 0.7)));
  g += 0.6 * vec2(vnoise(q2 + vec2(0.4, 0.0)) - vnoise(q2 - vec2(0.4, 0.0)), vnoise(q2 + vec2(0.0, 0.4)) - vnoise(q2 - vec2(0.0, 0.4)));
  vec3 N = normalize(vec3(-dh.x * vAmp - g.x * 0.28 * fineAmp, 1.0, -dh.y * vAmp - g.y * 0.28 * fineAmp));
  N = normalize(N + 1e-5);
  vec3 V = normalize(uCam - vWorld);
  float ndv = max(dot(N, V), 0.0);

  vec3 deepC = vec3(0.008, 0.11, 0.25);
  vec3 midC = vec3(0.0, 0.36, 0.58);
  vec3 shalC = vec3(0.07, 0.74, 0.76);
  vec3 sandC = vec3(0.82, 0.88, 0.76);
  float k2 = smoothstep(0.0, 85.0, depth);
  float k1 = smoothstep(20.0, 300.0, depth);
  vec3 base = mix(mix(shalC, midC, k2), deepC, k1 * k1);
  // Sandiger Meeresboden im Flachwasser mit Seegras-Flecken
  float weeds = vnoise(p * 0.045) * 0.6 + vnoise(p * 0.19) * 0.4;
  base = mix(base, base * vec3(0.55, 0.75, 0.62), smoothstep(0.52, 0.72, weeds) * smoothstep(8.0, 25.0, depth) * (1.0 - smoothstep(40.0, 110.0, depth)));
  float sandK = 1.0 - smoothstep(0.0, 16.0, depth);
  base = mix(base, sandC * (0.78 + 0.22 * vnoise(p * 0.8 + uTime * 0.1)), sandK * 0.78);
  // Binnengewässer (Feuchtgebiete): trüb grün-braun
  if (sd > 0.0) { base = mix(vec3(0.12, 0.21, 0.17), vec3(0.18, 0.27, 0.2), vnoise(p * 0.1)); }

  // Bedeckter Himmel / Regen: Meer wird grau-grün und dunkler statt leuchtend türkis
  float lum = dot(base, vec3(0.3, 0.5, 0.2));
  base = mix(base, vec3(lum) * vec3(0.78, 0.92, 0.98) * 0.85, clamp(uGray * 0.7, 0.0, 0.7));
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  float fres = 0.03 + 0.97 * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0);
  fres = clamp(fres * (sd > 0.0 ? 1.2 : 1.0), 0.0, 0.95);
  float diffuse = clamp(dot(N, uSunDir), 0.0, 1.0);
  vec3 lit = base * (0.55 * uDay + 0.02 + diffuse * uSunI * 0.55 * uSunColor);
  vec3 refl = skyCol(R);
  vec3 col = mix(lit, refl, fres);
  // Glitzern
  float sp = pow(max(dot(R, uSunDir), 0.0), 450.0) * 9.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.35;
  col += uSunColor * sp * uSunI * (1.0 - uRain * 0.7);
  // Schaum an der Küste + Wellenlinien
  float wob = vnoise(p * 0.35 + uTime * 0.2) * 3.0;
  float foamLine = 1.0 - smoothstep(0.0, 2.2, depth + wob * 0.35 - 0.3 + 1.4 * sin(uTime * 0.7 + p.x * 0.01));
  float rings = 0.5 + 0.5 * sin(depth * 0.55 - uTime * 1.4 + wob);
  float foam = clamp(foamLine * (0.45 + 0.55 * rings) * step(-0.05, depth), 0.0, 1.0) * (sd > 0.0 ? 0.0 : 1.0);
  // Brandungsschaum bei hohem Seegang
  foam += smoothstep(0.62, 1.0, h * 3.2 * vAmp) * 0.25 * uRain;
  col = mix(col, vec3(0.95, 0.98, 1.0) * (0.55 * uDay + 0.45), clamp(foam, 0.0, 0.92));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Sea {
  constructor(scene, coast, atm) {
    this.coast = coast;
    // Distanzfeld als Halbfloat-Textur
    const { nx, nz, sd, cell, world } = coast;
    const data = new Uint16Array(nx * nz);
    for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(sd[i]);
    const tex = new THREE.DataTexture(data, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.sdTex = tex;

    this.uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uSD: { value: tex },
      uSDP: { value: new THREE.Vector4(world.x0, world.z0, cell, 0) }, uSDSize: { value: new THREE.Vector2(nx, nz) },
      uSunDir: atm.skyUniforms.uSunDir, uSunColor: atm.skyUniforms.uSunColor, uZenith: atm.skyUniforms.uZenith, uHorizon: atm.skyUniforms.uHorizon,
      uSunI: atm.skyUniforms.uSunIntensity, uDay: { value: 1 }, uRain: { value: 0 }, uGray: { value: 0 },
    });
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true });

    // Polargitter: Ringe wachsen exponentiell
    const rings = 112, segs = 144;
    const pos = [], idx = [];
    pos.push(0, 0, 0);
    let r = 5;
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      }
      r *= 1.0725;
    }
    for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
    for (let i = 0; i < rings - 1; i++) {
      for (let j = 0; j < segs; j++) {
        const a = 1 + i * segs + j, b = 1 + i * segs + ((j + 1) % segs), c = 1 + (i + 1) * segs + j, d = 1 + (i + 1) * segs + ((j + 1) % segs);
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
    this.atm = atm;
    this.time = 0;
  }

  update(dt, camera) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uCam.value.copy(camera.position);
    this.uniforms.uDay.value = 1 - this.atm.night * 0.9;
    this.uniforms.uRain.value = this.atm.w.rain;
    this.uniforms.uGray.value = this.atm.w.gray;
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
    // Das Mesh liegt um die Kamera; Weltposition wird im Shader über uCam addiert → Mesh selbst bei 0 halten
    this.mesh.position.set(0, 0, 0);
  }

  height(x, z) { return waveHeight(x, z, this.time); }
}
