// 3D-Ansicht der Vollbildkarte: Reliefgelände mit Satellitenbild und Straßen als Bodentextur, frei dreh- und kippbar.
// Die Textur wird für den gerade sichtbaren Ausschnitt neu gezeichnet, damit Straßen bei jedem Zoom scharf bleiben.
import * as THREE from 'three';
import { clamp } from '../util.js';
import { WORLD } from '../world/map.js';
import { PAL } from './mapstyle.js';
import { drawBase, mapHeight } from './map2d.js';

const TEX = 2048;       // Pixel der Bodentextur
const GRID = 144;       // Gitterzellen des Reliefs pro Seite
const EXAG = 1.7;       // Höhenüberhöhung

export class Map3D {
  constructor(game, host, cache) {
    this.game = game;
    this.cache = cache;
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map3dcv';
    host.prepend(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(PAL.water);
    this.camera = new THREE.PerspectiveCamera(42, 1, 20, 90000);
    // Ansicht
    this.target = { x: 0, z: 0 };
    this.dist = 2600;
    this.yaw = 0;
    this.pitch = 0.95;          // Neigung über dem Boden (Bogenmaß); π/2 = senkrecht von oben
    // Textur-Ausschnitt
    this.win = { x: 1e9, z: 1e9, E: 0 };
    this.texCv = document.createElement('canvas'); this.texCv.width = this.texCv.height = TEX;
    this.texC = this.texCv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.texCv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.geo = new THREE.PlaneGeometry(1, 1, GRID, GRID);
    this.geo.rotateX(-Math.PI / 2);
    this.base = this.geo.attributes.position.array.slice();   // Einheitsgitter (x, z in −0.5..0.5)
    this.uv = this.geo.attributes.uv;
    // Licht und Schatten stecken schon im Satellitenbild: Farben unverändert zeigen
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.lastTex = 0;
    this.dirty = true;
    this.ray = new THREE.Raycaster();
    this.W = 0; this.H = 0;
  }

  setTarget(x, z) { this.target.x = x; this.target.z = z; this.dirty = true; }
  reset(x, z) { this.target.x = x; this.target.z = z; this.dist = 1800; this.yaw = 0; this.pitch = 0.95; this.dirty = true; }
  zoom(f) { this.dist = clamp(this.dist * f, 160, 36000); this.dirty = true; }
  // Drehen und Kippen (Maus rechts ziehen)
  orbit(dx, dy) { this.yaw -= dx * 0.006; this.pitch = clamp(this.pitch + dy * 0.005, 0.28, 1.5); this.dirty = true; }
  // Verschieben: Bildschirmbewegung in Weltmeter am Boden
  pan(dx, dy) {
    const k = this.metersPerPixel(), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const up = 1 / Math.max(0.35, Math.sin(this.pitch));
    this.target.x -= (dx * cy + dy * up * sy) * k;
    this.target.z -= (-dx * sy + dy * up * cy) * k;
    this.dirty = true;
  }

  resize(W, H) {
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.renderer.setSize(W, H, false);
    this.camera.aspect = W / H; this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  _height(x, z) { return mapHeight(this.cache, x, z) * EXAG; }
  heightAt(x, z) { return this._height(x, z); }

  // Boden-Ausschnitt (Relief + Textur) passend zur Kamera neu aufbauen
  _refreshWindow(force = false) {
    const t = this.target;
    const need = clamp(this.dist * 3.0, 1300, 42000);
    const w = this.win;
    const moved = Math.hypot(t.x - w.x, t.z - w.z) > w.E * 0.17;
    const scaled = !w.E || need > w.E * 1.35 || need < w.E * 0.62;
    const now = performance.now();
    if (!force && !(moved || scaled) ) return;
    if (!force && now - this.lastTex < 220) return;
    this.lastTex = now;
    const E = need;
    w.x = t.x; w.z = t.z; w.E = E;
    // Relief
    const p = this.geo.attributes.position, a = p.array;
    for (let i = 0; i < a.length; i += 3) {
      const x = t.x + this.base[i] * E, z = t.z + this.base[i + 2] * E;
      a[i] = x; a[i + 1] = this._height(x, z); a[i + 2] = z;
    }
    p.needsUpdate = true;
    this.geo.computeBoundingSphere();
    // Textur: Karte im Maßstab Textur/E
    drawBase(this.texC, TEX, TEX, { x: t.x, z: t.z, scale: TEX / E }, this.cache, this.game, { names: false });
    this._fadeEdges();
    this.tex.needsUpdate = true;
  }

  // Rand der Bodentextur ins offene Meer auslaufen lassen, sonst sieht man die Kante des Ausschnitts
  _fadeEdges() {
    const c = this.texC, d = TEX * 0.09;
    const sea = new THREE.Color(PAL.water).getHexString();
    for (const [x, y, w, h, x0, y0, x1, y1] of [
      [0, 0, TEX, d, 0, 0, 0, d], [0, TEX - d, TEX, d, 0, TEX, 0, TEX - d],
      [0, 0, d, TEX, 0, 0, d, 0], [TEX - d, 0, d, TEX, TEX, 0, TEX - d, 0],
    ]) {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, '#' + sea); g.addColorStop(0.15, '#' + sea); g.addColorStop(1, '#' + sea + '00');
      c.fillStyle = g; c.fillRect(x, y, w, h);
    }
  }

  _placeCamera() {
    const t = this.target, c = this.camera;
    const cp = Math.cos(this.pitch), d = this.dist;
    const gy = this._height(t.x, t.z);
    c.position.set(t.x + Math.sin(this.yaw) * cp * d, gy + Math.sin(this.pitch) * d, t.z + Math.cos(this.yaw) * cp * d);
    c.up.set(0, 1, 0);
    c.lookAt(t.x, gy, t.z);
    c.updateMatrixWorld();
    // Ferne sanft ausblenden
    this.scene.fog = new THREE.Fog(PAL.water, d * 1.5, d * 4.2);
  }

  // Zeichnen. Gibt true zurück, wenn neu gerendert wurde (damit der Aufrufer die Symbole nachzieht)
  render(W, H) {
    this.resize(W, H);
    this._refreshWindow(this.win.E === 0);
    this._placeCamera();
    this.renderer.render(this.scene, this.camera);
  }

  // Weltposition → Bildschirm. Liefert [x, y, sichtbar]
  project(x, z, lift = 0) {
    const v = new THREE.Vector3(x, this._height(x, z) + lift, z).project(this.camera);
    return [(v.x * 0.5 + 0.5) * this.W, (-v.y * 0.5 + 0.5) * this.H, v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15];
  }

  // Bildschirm → Weltposition auf dem Relief (oder null)
  pick(sx, sy) {
    const ndc = new THREE.Vector2((sx / this.W) * 2 - 1, -(sy / this.H) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = this.ray.intersectObject(this.mesh, false)[0];
    if (!hit) return null;
    const x = clamp(hit.point.x, WORLD.x0, WORLD.x1), z = clamp(hit.point.z, WORLD.z0, WORLD.z1);
    return [x, z];
  }

  // Meter pro Bildschirmpixel am Zielpunkt (für Symbolgrößen und Beschriftungen)
  metersPerPixel() { return (this.dist * 2 * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, this.H); }

  show(on) { this.canvas.style.display = on ? 'block' : 'none'; }

  dispose() {
    this.geo.dispose(); this.mat.dispose(); this.tex.dispose(); this.renderer.dispose();
    this.canvas.remove();
  }
}
