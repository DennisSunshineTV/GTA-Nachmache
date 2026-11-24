// Effekte: GPU-Partikel (Rauch, Feuer, Staub, Funken, Gischt), Leuchtspuren, Mündungsfeuer, Explosionen.
import * as THREE from 'three';
import { clamp, lerp } from '../util.js';

const VERT = /* glsl */`
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * uScale / max(0.1, -mv.z), 0.0, 380.0);
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  vec4 c = vec4(vColor.rgb, vColor.a * t.a);
  if (c.a < 0.003) discard;
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Particles {
  constructor(scene, tex, max, additive, order = 5) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 4); this.c1 = new Float32Array(max * 4);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.aSize = new Float32Array(max); this.aColor = new Float32Array(max * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.aColor, 4).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.uniforms = { uMap: { value: tex }, uScale: { value: 800 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = order;
    scene.add(this.points);
    this.geo = g;
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, grav = 0, drag = 0) {
    let i;
    if (this.n < this.max) i = this.n++;
    else i = Math.floor(Math.random() * this.max);
    const p = i * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    this.life[i] = 0; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    const q = i * 4;
    for (let k = 0; k < 4; k++) { this.c0[q + k] = c0[k]; this.c1[q + k] = c1[k]; }
    this.grav[i] = grav; this.drag[i] = drag;
  }

  update(dt, scale) {
    this.uniforms.uScale.value = scale;
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.life[i] += dt;
      if (this.life[i] >= this.maxLife[i]) {
        // letztes Partikel in diese Lücke kopieren
        n--;
        if (i !== n) this._copy(n, i);
        i--;
        continue;
      }
      const p = i * 3;
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[p] *= d; this.vel[p + 1] = this.vel[p + 1] * d - this.grav[i] * dt; this.vel[p + 2] *= d;
      this.pos[p] += this.vel[p] * dt; this.pos[p + 1] += this.vel[p + 1] * dt; this.pos[p + 2] += this.vel[p + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.aSize[i] = lerp(this.s0[i], this.s1[i], t);
      const q = i * 4;
      for (let k = 0; k < 4; k++) this.aColor[q + k] = lerp(this.c0[q + k], this.c1[q + k], t);
    }
    this.n = n;
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }

  _copy(from, to) {
    for (let k = 0; k < 3; k++) { this.pos[to * 3 + k] = this.pos[from * 3 + k]; this.vel[to * 3 + k] = this.vel[from * 3 + k]; }
    for (let k = 0; k < 4; k++) { this.c0[to * 4 + k] = this.c0[from * 4 + k]; this.c1[to * 4 + k] = this.c1[from * 4 + k]; this.aColor[to * 4 + k] = this.aColor[from * 4 + k]; }
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from]; this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from]; this.aSize[to] = this.aSize[from];
  }
}

function softTexture(kind) {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  if (kind === 'smoke') {
    // Wolkiger Fleck aus mehreren weichen Kreisen
    g.clearRect(0, 0, S, S);
    for (let i = 0; i < 9; i++) {
      const x = S / 2 + (Math.random() - 0.5) * 30, y = S / 2 + (Math.random() - 0.5) * 30, r = 22 + Math.random() * 22;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    }
  } else {
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.smokeP = new Particles(scene, softTexture('smoke'), 2600, false, 6);
    this.fireP = new Particles(scene, softTexture('glow'), 2600, true, 7);
    this.shake = 0;
    // Mündungsfeuer-/Explosionslicht
    this.light = new THREE.PointLight(0xffb060, 0, 40, 2);
    this.light.position.set(0, -100, 0);
    scene.add(this.light);
    this.lightT = 0; this.lightMax = 0.1;
    // Leuchtspuren
    this.tracerMax = 96;
    this.tracerPos = new Float32Array(this.tracerMax * 6);
    this.tracerCol = new Float32Array(this.tracerMax * 6);
    this.tracerLife = new Float32Array(this.tracerMax);
    this.tracerN = 0;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setDrawRange(0, 0);
    this.tracers = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    this.tracers.frustumCulled = false;
    scene.add(this.tracers);
    // Druckwellen
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.7, 1, 40);
    this.ringGeo.rotateX(-Math.PI / 2);
    this.pending = [];
  }

  addShake(a) { this.shake = Math.min(1.6, this.shake + a); }

  smoke(x, y, z, k = 1) {
    const g = 0.2 + Math.random() * 0.25;
    this.smokeP.spawn(x, y, z, (Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 0.6, 2.8 + Math.random() * 2, 0.8 * k, 4 * k + 2, [g, g, g, 0.5], [g * 0.8, g * 0.8, g * 0.8, 0], -0.4, 0.4);
  }

  fire(x, y, z) {
    this.fireP.spawn(x, y, z, (Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.5, 1.2, 0.2, [2.4, 1.1, 0.2, 0.75], [0.8, 0.12, 0.02, 0], -1.4, 0.5);
    if (Math.random() < 0.3) this.smoke(x, y + 0.6, z, 0.8);
  }

  dust(x, y, z, n = 4) {
    for (let i = 0; i < n; i++) this.smokeP.spawn(x + (Math.random() - 0.5), y + 0.1, z + (Math.random() - 0.5), (Math.random() - 0.5) * 3, 0.4 + Math.random() * 0.8, (Math.random() - 0.5) * 3, 0.9 + Math.random() * 0.6, 0.5, 2.6, [0.62, 0.55, 0.42, 0.45], [0.6, 0.54, 0.42, 0], 0, 1.6);
  }

  puff(x, y, z, col = [0.7, 0.7, 0.7]) {
    for (let i = 0; i < 2; i++) this.smokeP.spawn(x, y, z, (Math.random() - 0.5) * 1.2, Math.random() * 1.2, (Math.random() - 0.5) * 1.2, 0.5 + Math.random() * 0.4, 0.2, 0.9, [col[0], col[1], col[2], 0.55], [col[0], col[1], col[2], 0], 0, 2);
  }

  sparks(x, y, z, n = 6) {
    for (let i = 0; i < n; i++) this.fireP.spawn(x, y, z, (Math.random() - 0.5) * 8, 1 + Math.random() * 5, (Math.random() - 0.5) * 8, 0.25 + Math.random() * 0.3, 0.16, 0.05, [3, 2, 0.8, 1], [1.5, 0.4, 0.1, 0], 12, 0.8);
  }

  wake(x, z, vx, vz) {
    this.smokeP.spawn(x, 0.12, z, vx * -0.2 + (Math.random() - 0.5) * 1.2, 0.8, vz * -0.2 + (Math.random() - 0.5) * 1.2, 1.1 + Math.random() * 0.6, 0.6, 2.8, [1, 1, 1, 0.55], [1, 1, 1, 0], 1.5, 1.5);
  }

  splash(x, z, n = 10) {
    for (let i = 0; i < n; i++) this.smokeP.spawn(x + (Math.random() - 0.5), 0.1, z + (Math.random() - 0.5), (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, 0.7 + Math.random() * 0.4, 0.4, 1.2, [1, 1, 1, 0.7], [1, 1, 1, 0], 9, 0.3);
  }

  muzzle(x, y, z, dx, dy, dz) {
    this.fireP.spawn(x + dx * 0.15, y + dy * 0.15, z + dz * 0.15, dx * 2, dy * 2, dz * 2, 0.06, 0.55, 0.2, [3, 2.2, 1.1, 1], [1.5, 0.6, 0.1, 0]);
    this.flash(x, y, z, 0.08, 4, 0xffc070, 18);
  }

  flash(x, y, z, dur, intensity, color = 0xffb060, dist = 40) {
    this.light.position.set(x, y, z);
    this.light.color.setHex(color);
    this.light.distance = dist;
    this.lightMax = dur; this.lightT = dur; this.lightI = intensity;
  }

  tracer(ax, ay, az, bx, by, bz, color = [1, 0.85, 0.5]) {
    const i = this.tracerN < this.tracerMax ? this.tracerN++ : Math.floor(Math.random() * this.tracerMax);
    const p = i * 6;
    this.tracerPos.set([ax, ay, az, bx, by, bz], p);
    this.tracerCol.set([color[0], color[1], color[2], color[0], color[1], color[2]], p);
    this.tracerLife[i] = 0.07;
  }

  impact(x, y, z, kind = 'default') {
    if (kind === 'metal') this.sparks(x, y, z, 5);
    else if (kind === 'flesh') this.puff(x, y, z, [0.55, 0.15, 0.12]);
    else if (kind === 'water') this.splash(x, z, 5);
    else this.dust(x, y, z, 2);
  }

  explosion(x, y, z, radius, damage, source) {
    for (let i = 0; i < 34; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.2, sp = 3 + Math.random() * 9;
      this.fireP.spawn(x, y, z, Math.cos(a) * sp, Math.sin(e) * sp * 0.7 + 3, Math.sin(a) * sp, 0.7 + Math.random() * 0.7, 2.8, 0.6, [3.2, 1.6, 0.4, 0.9], [0.8, 0.1, 0.0, 0], 4, 1.2);
    }
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 5;
      this.smokeP.spawn(x, y + 0.5, z, Math.cos(a) * sp, 1.5 + Math.random() * 5, Math.sin(a) * sp, 2.5 + Math.random() * 2.5, 2.5, 9, [0.12, 0.11, 0.1, 0.8], [0.25, 0.25, 0.25, 0], -0.5, 0.5);
    }
    this.flash(x, y + 1, z, 0.45, 40, 0xff9a40, 80);
    const m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.position.set(x, Math.max(0.2, y - 0.6), z); m.scale.setScalar(1);
    this.game.scene.add(m);
    this.rings.push({ m, t: 0, r: radius });
    const d = Math.hypot(x - this.game.camera.position.x, z - this.game.camera.position.z);
    this.addShake(clamp(1.2 - d / 80, 0, 1.2));
    this.game.audio?.explosion(d);
    this.game.combat?.explosionDamage(x, y, z, radius, damage, source);
  }

  update(dt) {
    const eng = this.game.engine;
    const fov = this.game.camera.fov * Math.PI / 180;
    const scale = eng.height / (2 * Math.tan(fov / 2));
    this.smokeP.update(dt, scale);
    this.fireP.update(dt, scale);
    // Leuchtspuren altern
    let n = this.tracerN;
    for (let i = 0; i < n; i++) {
      this.tracerLife[i] -= dt;
      if (this.tracerLife[i] <= 0) {
        n--;
        if (i !== n) { this.tracerPos.copyWithin(i * 6, n * 6, n * 6 + 6); this.tracerCol.copyWithin(i * 6, n * 6, n * 6 + 6); this.tracerLife[i] = this.tracerLife[n]; }
        i--;
      }
    }
    this.tracerN = n;
    this.tracers.geometry.setDrawRange(0, n * 2);
    this.tracers.geometry.attributes.position.needsUpdate = true;
    this.tracers.geometry.attributes.color.needsUpdate = true;
    // Licht
    if (this.lightT > 0) {
      this.lightT -= dt;
      this.light.intensity = Math.max(0, this.lightT / this.lightMax) * this.lightI * 30;
    } else this.light.intensity = 0;
    // Ringe
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / 0.5;
      r.m.scale.setScalar(1 + k * r.r * 1.1);
      r.m.material.opacity = Math.max(0, 0.7 * (1 - k));
      if (k >= 1) { this.game.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }
}
