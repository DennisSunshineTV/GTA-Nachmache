// Chunk-Streaming: Gelände in drei Detailstufen, Details (Straßen, Gebäude, Props) in Nähe des Spielers.
import * as THREE from 'three';
import { TerrainBuilder, CHUNK, LODS } from './terrain.js';

const key = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);

export class ChunkManager {
  constructor(engine, ctx, materials, detailBuilder = null) {
    this.engine = engine;
    this.scene = engine.scene;
    this.ctx = ctx;
    this.mats = materials;
    this.terrainBuilder = new TerrainBuilder(ctx);
    this.detailBuilder = detailBuilder;
    this.chunks = new Map();
    this.queue = [];
    this.current = null;
    this.focusChunk = [NaN, NaN];
    this.landMap = this._landMap();
    this.lodDist = [640, 1650, 3700];  // Wechsel zu LOD1, LOD2, ausblenden
    this.detailDist = 760;
    this.stats = { terrain: 0, detail: 0, built: 0 };
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.onDetailLoaded = null;
    this.onDetailUnloaded = null;
  }

  // Welche Chunks enthalten überhaupt Land? (Meeresbereiche brauchen kein Gelände)
  _landMap() {
    const { coast, world } = this.ctx;
    const cx0 = Math.floor(world.x0 / CHUNK), cx1 = Math.floor(world.x1 / CHUNK), cz0 = Math.floor(world.z0 / CHUNK), cz1 = Math.floor(world.z1 / CHUNK);
    const map = new Set();
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        let land = false;
        for (let j = 0; j <= 8 && !land; j++) for (let i = 0; i <= 8; i++) {
          if (coast.sdAt(cx * CHUNK + (i * CHUNK) / 8, cz * CHUNK + (j * CHUNK) / 8) > 0.2) { land = true; break; }
        }
        if (land) map.add(key(cx, cz));
      }
    }
    return map;
  }

  hasLand(cx, cz) { return this.landMap.has(key(cx, cz)); }

  lodFor(d, current) {
    // Hysterese: bestehende Stufe etwas länger halten
    const h = current === undefined ? 0 : 60;
    const [a, b, c] = this.lodDist;
    if (current === 0 && d < a + h) return 0;
    if (current === 1 && d < b + h && d > a - h) return 1;
    if (current === 2 && d < c + h && d > b - h) return 2;
    if (d < a) return 0;
    if (d < b) return 1;
    if (d < c) return 2;
    return -1;
  }

  update(focus) {
    const cx = Math.floor(focus.x / CHUNK), cz = Math.floor(focus.z / CHUNK);
    this.focusX = focus.x; this.focusZ = focus.z;
    if (cx === this.focusChunk[0] && cz === this.focusChunk[1] && this.queue.length === 0 && !this.current && !this._dirty) return;
    this.focusChunk = [cx, cz];
    this._dirty = false;
    const R = Math.ceil((this.lodDist[2] + 120) / CHUNK) + 1;
    const wanted = new Map();
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const ccx = cx + dx, ccz = cz + dz;
        if (!this.hasLand(ccx, ccz)) continue;
        // Abstand zum nächsten Punkt des Chunks
        const nx = Math.max(ccx * CHUNK - focus.x, 0, focus.x - (ccx + 1) * CHUNK), nz = Math.max(ccz * CHUNK - focus.z, 0, focus.z - (ccz + 1) * CHUNK);
        const d = Math.hypot(nx, nz);
        const k = key(ccx, ccz);
        const existing = this.chunks.get(k);
        const lod = this.lodFor(d, existing?.lod);
        if (lod < 0) continue;
        wanted.set(k, { cx: ccx, cz: ccz, lod, d, detail: lod === 0 && d < this.detailDist });
      }
    }
    // Entladen
    for (const [k, c] of this.chunks) {
      if (!wanted.has(k)) this._unload(k, c);
    }
    // Detail wieder entfernen
    for (const [k, w] of wanted) {
      const c = this.chunks.get(k);
      if (c && c.detail && (!w.detail && c.dist > this.detailDist + 140)) this._dropDetail(c);
    }
    // Aufgaben erzeugen
    this.queue.length = 0;
    for (const [k, w] of wanted) {
      const c = this.chunks.get(k);
      if (!c || c.lod !== w.lod) this.queue.push({ type: 'terrain', k, ...w });
      else if (w.detail && !c.detail && !c.detailPending) this.queue.push({ type: 'detail', k, ...w });
      if (c) c.dist = w.d;
    }
    this.queue.sort((a, b) => a.d - b.d);
    // Bereits laufende Aufgabe verwerfen, falls sie nicht mehr gebraucht wird
    if (this.current && !wanted.has(this.current.task.k)) this.current = null;
  }

  // Zeitbudget (ms) pro Frame abarbeiten
  step(budgetMs = 5) {
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      if (!this.current) {
        const task = this.queue.shift();
        if (!task) return false;
        const gen = task.type === 'terrain' ? this._terrainTask(task) : this._detailTask(task);
        this.current = { task, gen };
      }
      const r = this.current.gen.next();
      if (r.done) this.current = null;
    }
    return true;
  }

  // Schlüssel der Chunks mit Detail, deren Mitte näher als r an p liegt (für Schattenwurf der Props)
  nearKeys(p, r) {
    const out = new Set();
    for (const [k, ch] of this.chunks) {
      if (!ch.detail) continue;
      const mx = ch.cx * CHUNK + CHUNK / 2, mz = ch.cz * CHUNK + CHUNK / 2;
      if (Math.hypot(mx - p.x, mz - p.z) < r + CHUNK * 0.7) out.add(k);
    }
    return out;
  }

  get busy() { return !!this.current || this.queue.length > 0; }

  *_terrainTask(task) {
    const gen = this.terrainBuilder.build(task.cx, task.cz, task.lod);
    let r = gen.next();
    while (!r.done) { yield; r = gen.next(); }
    const { geometry, heights } = r.value;
    const old = this.chunks.get(task.k);
    const mesh = new THREE.Mesh(geometry, this.mats.terrain);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = true;
    this.group.add(mesh);
    if (old) { this.group.remove(old.mesh); old.mesh.geometry.dispose(); }
    const chunk = old || { cx: task.cx, cz: task.cz, k: task.k, detail: null, dist: task.d };
    chunk.mesh = mesh; chunk.lod = task.lod; chunk.heights = heights || null;
    this.chunks.set(task.k, chunk);
    this.stats.built++;
    if (task.detail && !chunk.detail && this.detailBuilder) {
      // Details gleich anschließend
      this.queue.unshift({ type: 'detail', k: task.k, cx: task.cx, cz: task.cz, lod: 0, d: task.d, detail: true });
    }
  }

  *_detailTask(task) {
    const chunk = this.chunks.get(task.k);
    if (!chunk || chunk.lod !== 0 || chunk.detail || !this.detailBuilder) return;
    chunk.detailPending = true;
    const gen = this.detailBuilder.build(chunk);
    let r = gen.next();
    while (!r.done) { yield; r = gen.next(); }
    chunk.detailPending = false;
    if (!this.chunks.has(task.k)) { r.value.dispose?.(); return; }
    chunk.detail = r.value;
    this.stats.detail++;
    this._dirty = true;
    this.onDetailLoaded?.(chunk);
  }

  _dropDetail(c) {
    if (!c.detail) return;
    this.onDetailUnloaded?.(c);
    c.detail.dispose?.();
    c.detail = null;
  }

  _unload(k, c) {
    this._dropDetail(c);
    this.group.remove(c.mesh);
    c.mesh.geometry.dispose();
    this.chunks.delete(k);
  }

  // Geländehöhe: aus geladenen LOD0-Chunks (exakt wie das Mesh), sonst analytisch
  heightAt(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (c && c.heights) {
      const n = LODS[0].n, cell = CHUNK / n;
      let fx = (x - cx * CHUNK) / cell, fz = (z - cz * CHUNK) / cell;
      const i = Math.min(n - 1, fx | 0), j = Math.min(n - 1, fz | 0);
      fx -= i; fz -= j;
      const w = n + 1, h = c.heights;
      const a = h[j * w + i], b = h[j * w + i + 1], cc = h[(j + 1) * w + i], d = h[(j + 1) * w + i + 1];
      // Dreiecke wie im Mesh: (a,c,b) und (b,c,d)
      if (fx + fz <= 1) return a + (b - a) * fx + (cc - a) * fz;
      return d + (b - d) * (1 - fz) + (cc - d) * (1 - fx);
    }
    return this.ctx.hf.h(x, z);
  }

  dispose() {
    for (const [k, c] of [...this.chunks]) this._unload(k, c);
    this.scene.remove(this.group);
  }
}
