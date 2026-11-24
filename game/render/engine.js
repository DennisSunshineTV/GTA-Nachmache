// Renderer, Kamera, Nachbearbeitung (Bloom) und Qualitätsstufen.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const QUALITY = {
  low: { pixelRatio: 0.8, shadow: 0, bloom: false, shadowRange: 70, msaa: 0, detail: 0.6 },
  medium: { pixelRatio: 1.0, shadow: 1024, bloom: false, shadowRange: 90, msaa: 4, detail: 0.85 },
  high: { pixelRatio: 1.25, shadow: 2048, bloom: true, shadowRange: 110, msaa: 4, detail: 1 },
  ultra: { pixelRatio: 2, shadow: 4096, bloom: true, shadowRange: 130, msaa: 4, detail: 1.25 },
};

export class Engine {
  constructor(container, qualityKey = 'high') {
    this.container = container;
    this.qualityKey = QUALITY[qualityKey] ? qualityKey : 'high';
    this.q = QUALITY[this.qualityKey];
    const renderer = new THREE.WebGLRenderer({ antialias: !this.q.bloom, powerPreference: 'high-performance', stencil: false });
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = this.q.shadow > 0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x6fa8e8);
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none';
    renderer.domElement.tabIndex = 0;
    container.appendChild(renderer.domElement);
    this.canvas = renderer.domElement;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.25, 9500);
    this.camera.position.set(0, 50, 0);
    this.baseFov = 62;
    this.composer = null;
    this.bloom = null;
    this.resize();
    this._buildComposer();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  _buildComposer() {
    if (this.composer) { this.composer.dispose?.(); this.composer = null; }
    if (!this.q.bloom) return;
    const w = this.width, h = this.height;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.q.msaa || 0 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.setPixelRatio(1);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.34, 0.55, 0.92);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    composer.setSize(w, h);
    this.composer = composer;
  }

  setQuality(key) {
    if (!QUALITY[key]) return;
    this.qualityKey = key; this.q = QUALITY[key];
    this.renderer.shadowMap.enabled = this.q.shadow > 0;
    this.resize();
    this._buildComposer();
    this.onQualityChange?.(this.q);
  }

  resize() {
    const w = Math.max(2, this.container.clientWidth || window.innerWidth), h = Math.max(2, this.container.clientHeight || window.innerHeight);
    this.width = Math.floor(w * Math.min(this.q.pixelRatio, window.devicePixelRatio * 1.0 || 1));
    this.height = Math.floor(h * Math.min(this.q.pixelRatio, window.devicePixelRatio * 1.0 || 1));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) { this.composer.setSize(this.width, this.height); this.bloom?.setSize(this.width, this.height); }
  }

  render(dt) {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    this.canvas.remove();
  }
}
