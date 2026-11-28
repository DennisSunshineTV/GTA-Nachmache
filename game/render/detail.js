// Detail-Aufbau pro Chunk: Gebäude, Straßen, Pools, Piers, Props, Kollisionsdaten.
import * as THREE from 'three';
import { MeshBuilder } from '../world/meshbuilder.js';
import { toGeometry } from './geom.js';
import { addBuilding } from './buildinggeom.js';
import { addHouse } from './housegeom.js';
import { buildRoads, buildNodes, nodePadRadius, SHOULDER_W } from './roadgeom.js';
import { vegetation, nearBuilding } from './vegetation.js';
import { CHUNK } from './terrain.js';
import { PROP_DEFS } from './props.js';
import { TAU, ihash } from '../util.js';

const ckey = (cx, cz) => (cx + 4096) * 8192 + (cz + 4096);
import { BOAT_REF } from '../entities/vehicle_models.js';
import { poolSurface, poolOutline, poolDepthAt, poolLocal, poolWorld, islandR } from '../world/pools.js';
import { buildHomeDeck } from './beachgeom.js';

export class DetailBuilder {
  constructor(ctx, mats, props, chunkMgrRef) {
    this.ctx = ctx;
    this.mats = mats;
    this.props = props;
    this.cm = chunkMgrRef;       // wird nach Erzeugung gesetzt (hAt)
    this.density = 1;
    this._index();
  }

  // Räumliche Indizes: Straßensegmente, Knoten, Props, Pools, Boote je Chunk
  _index() {
    const { net, props, pools, boats, platforms } = this.ctx;
    this.roadSegs = new Map();
    for (const r of net.roads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const mx = (r.pts[i][0] + r.pts[i + 1][0]) / 2, mz = (r.pts[i][1] + r.pts[i + 1][1]) / 2;
        const k = ckey(Math.floor(mx / CHUNK), Math.floor(mz / CHUNK));
        let a = this.roadSegs.get(k); if (!a) this.roadSegs.set(k, (a = []));
        a.push({ r, i });
      }
    }
    const bucket = (arr, getXZ) => {
      const m = new Map();
      for (const it of arr) { const [x, z] = getXZ(it); const k = ckey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)); let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(it); }
      return m;
    };
    this.propIdx = bucket(props, (p) => [p.x, p.z]);
    this.poolIdx = bucket(pools, (p) => [p.x, p.z]);
    this.boatIdx = bucket(boats, (p) => [p.x, p.z]);
    this.platIdx = bucket(platforms, (p) => [p.x, p.z]);
    this.bldIdx = bucket(this.ctx.buildings, (b) => [b.x, b.z]);
  }

  // Einfamilienhaus: Seite zur Straße (0..3) und Tiefe des Vorgartens bis zum Gehweg-/Fahrbahnrand
  houseInfo(b, hAt) {
    const q = this.front(b);
    const nl = [[0, 1], [1, 0], [0, -1], [-1, 0]][q], half = q % 2 ? b.w / 2 : b.d / 2;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const nx = c * nl[0] + s * nl[1], nz = -s * nl[0] + c * nl[1];
    const fx = b.x + nx * half, fz = b.z + nz * half;
    const nr = this.ctx.net.nearest(fx + nx * 3, fz + nz * 3, 40);
    let yard = 0;
    if (nr) yard = (nr.x - fx) * nx + (nr.z - fz) * nz - nr.road.w / 2 - nr.road.sw;
    return { q, yard: Math.max(0, Math.min(14, yard)), hAt };
  }

  front(b) {
    if (b.front !== undefined) return b.front;
    let k = 0;
    const nr = this.ctx.net.nearest(b.x, b.z, 150);
    if (nr) {
      const dx = nr.x - b.x, dz = nr.z - b.z;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const nl = [[0, 1], [1, 0], [0, -1], [-1, 0]];
      let best = -2;
      for (let q = 0; q < 4; q++) {
        const nx = c * nl[q][0] + s * nl[q][1], nz = -s * nl[q][0] + c * nl[q][1];
        const d = (nx * dx + nz * dz) / (Math.hypot(dx, dz) || 1);
        if (d > best) { best = d; k = q; }
      }
    }
    b.front = k;
    return k;
  }

  *build(chunk) {
    const ctx = this.ctx, mats = this.mats;
    const { cx, cz } = chunk;
    const key = ckey(cx, cz);
    const x0 = cx * CHUNK, z0 = cz * CHUNK, x1 = x0 + CHUNK, z1 = z0 + CHUNK;
    const hAt = (x, z) => this.cm.heightAt(x, z);
    const B = { plaster: new MeshBuilder(), old: new MeshBuilder(), hotel: new MeshBuilder(), glass: new MeshBuilder(), shop: new MeshBuilder(), metal: new MeshBuilder(), club: new MeshBuilder(), finca: new MeshBuilder(), roof: new MeshBuilder(), flat: new MeshBuilder(), sign: new MeshBuilder(),
      hPlaster: new MeshBuilder(), hRoof: new MeshBuilder(), hWood: new MeshBuilder(), hStone: new MeshBuilder(), hHedge: new MeshBuilder(), hGlass: new MeshBuilder(), hGlassLit: new MeshBuilder(), hFence: new MeshBuilder(),
      led: new MeshBuilder(), glow: new MeshBuilder(), bglass: new MeshBuilder(), hDeck: new MeshBuilder(), leaf: new MeshBuilder(), mark: new MeshBuilder() };   // Strandhaus
    const roadMB = new MeshBuilder(), poolMB = new MeshBuilder(), rimMB = new MeshBuilder(), basinMB = new MeshBuilder();
    B.road = roadMB;      // Einfahrten und Gartenwege der Häuser liegen im Straßen-Mesh (Pflaster)
    const colliders = [], platforms = [];
    const list = []; // Props
    let work = 0;

    // --- Gebäude ---
    const blds = this.bldIdx.get(key) || [];
    for (const b of blds) {
      if (b.tower) {
        // Hochhäuser liegen im globalen Skyline-Mesh
      } else if (b.style === 'house') {
        addHouse(b, B, this.houseInfo(b, hAt));
      } else {
        addBuilding(b, B, b.signIdx !== undefined ? this.front(b) : 0);
      }
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      if (b.colliders) {
        // Begehbares Gebäude (Strandhaus): einzelne Wände/Möbel statt eines massiven Blocks; [lx, lz, hx, hz, Höhe?]
        const yF = b.base + 0.12;
        for (const [lx, lz, hx, hz, h, onDeck] of b.colliders) {
          const house = b.style === 'house';
          // onDeck: Möbel auf der Terrasse (unterhalb des Hausbodens)
          const gy = onDeck ? (b.deckY ?? yF) : yF;
          colliders.push({ k: 'b', x: b.x + c * lx + s * lz, z: b.z - s * lx + c * lz, hx, hz, c, s, y0: onDeck ? gy - 0.6 : h && !house ? yF - 0.2 : b.y0 - 1, y1: h ? gy + h + (house ? 0.5 : 0) : b.base + b.h + 4, ref: b });
        }
      } else colliders.push({ k: 'b', x: b.x, z: b.z, hx: b.w / 2, hz: b.d / 2, c, s, y0: b.y0 - 1, y1: b.base + b.h + 4, ref: b });
      if (b.style === 'house' || (++work & 7) === 0) yield;
    }
    yield;

    // --- Piers / Plattformen ---
    for (const p of this.platIdx.get(key) || []) {
      B.flat.box(p.x, -1.8, p.z, p.w, p.top + 1.8, p.d, p.rot, 0.34, 0.27, 0.2, { noTop: true });
      B.flat.box(p.x, p.top - 0.02, p.z, p.w, 0.04, p.d, p.rot, 0.66, 0.52, 0.36);
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      for (let k = -p.w / 2 + 2; k < p.w / 2; k += 6) for (const sd of [-1, 1]) {
        B.flat.cylinder(p.x + c * k + s * sd * (p.d / 2 - 0.2), p.top, p.z - s * k + c * sd * (p.d / 2 - 0.2), 0.14, 0.14, 0.6, 6, 0.2, 0.2, 0.22);
      }
      platforms.push(p);
    }

    // --- Straßen ---
    const segs = this.roadSegs.get(key) || [];
    buildRoads(ctx, segs, roadMB);
    const nodes = [];
    ctx.net.nodeHash.query(x0, z0, x1, z1, (n) => { if (n.x >= x0 && n.x < x1 && n.z >= z0 && n.z < z1) nodes.push(n); });
    buildNodes(ctx, nodes, roadMB);
    // Strandhaus: Terrasse, Stege und Vorplatz als durchgehende Dielenfläche (in der Kachel des Hauses)
    if (ctx.home && ctx.home.deck && ckey(Math.floor(ctx.home.x / CHUNK), Math.floor(ctx.home.z / CHUNK)) === key) buildHomeDeck(ctx, hAt, B, colliders);
    // Parkplätze: weiße Buchtmarkierungen auf der Asphaltfläche und das blaue P-Schild an der Einfahrt
    for (const lot of ctx.parkingLots || []) {
      if (ckey(Math.floor(lot.x / CHUNK), Math.floor(lot.z / CHUNK)) !== key) continue;
      const c = Math.cos(lot.rot), s = Math.sin(lot.rot), y = lot.y + 0.025;
      const W = (lx, lz) => [lot.x + c * lx + s * lz, lot.z - s * lx + c * lz];
      for (const [x0, z0, x1, z1] of lot.lines) {
        const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = (-dz / l) * 0.06, nz = (dx / l) * 0.06;
        const a = W(x0 + nx, z0 + nz), b = W(x1 + nx, z1 + nz), cc = W(x1 - nx, z1 - nz), d = W(x0 - nx, z0 - nz);
        B.mark.quadUp([a[0], y, a[1]], [b[0], y, b[1]], [cc[0], y, cc[1]], [d[0], y, d[1]], 0.93, 0.93, 0.9);
      }
      const sg = lot.sign, gy = hAt(sg.x, sg.z);
      B.flat.cylinder(sg.x, gy, sg.z, 0.05, 0.05, 2.7, 8, 0.6, 0.62, 0.64);
      const off = (lx, lz) => [sg.x + c * lx + s * lz, sg.z - s * lx + c * lz];
      const [bx, bz] = off(0, -0.06);
      B.flat.box(bx, gy + 2.05, bz, 0.66, 0.66, 0.05, lot.rot, 0.95, 0.95, 0.95);
      const [px, pz] = off(0, -0.09);
      B.flat.box(px, gy + 2.08, pz, 0.6, 0.6, 0.02, lot.rot, 0.05, 0.3, 0.78);
      // Buchstabe P (weiß): Stamm, Bogen oben, rechte Kante des Bogens
      for (const [lx, ly, w, h] of [[-0.11, 2.15, 0.08, 0.46], [0.0, 2.53, 0.25, 0.07], [0.0, 2.33, 0.25, 0.07], [0.1, 2.36, 0.07, 0.22]]) {
        const [qx, qz] = off(lx, -0.11);
        B.flat.box(qx, gy + ly, qz, w, h, 0.01, lot.rot, 0.97, 0.97, 0.97);
      }
      colliders.push({ k: 'c', x: sg.x, z: sg.z, r: 0.1, y0: gy - 1, y1: gy + 2.8, prop: 'sign' });
    }
    yield;

    // --- Pools: man kann darin schwimmen. Das Gelände hat an der Wasserfläche ein Loch (Shader, materials.setPools),
    // darunter liegt das Becken (Wände, Boden mit flachem und tiefem Ende), drumherum der Beckenrand als Ring ---
    for (const p of this.poolIdx.get(key) || []) {
      const y = poolSurface(p, hAt);
      const N = 40;
      const rim = poolOutline(p, 0.9, N), wat = poolOutline(p, 0, N);
      const fan = (mb, pts, yy, r, g, bl, uvScale) => {
        const cxy = [p.x, yy, p.z];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          mb.triUp(cxy, [a[0], yy, a[1]], [b[0], yy, b[1]], r, g, bl, [p.x / uvScale, p.z / uvScale], [a[0] / uvScale, a[1] / uvScale], [b[0] / uvScale, b[1] / uvScale]);
        }
      };
      // Beckenrand: Ring zwischen Wasserkante und 0,9 m außen
      for (let i = 0; i < N; i++) {
        const a = wat[i], b = wat[(i + 1) % N], c = rim[(i + 1) % N], d = rim[i];
        rimMB.quadUp([a[0], y - 0.04, a[1]], [b[0], y - 0.04, b[1]], [c[0], y - 0.04, c[1]], [d[0], y - 0.04, d[1]], 0.93, 0.9, 0.84, a[0] / 6, a[1] / 6, c[0] / 6, c[1] / 6);
      }
      // Wasserfläche knapp unter dem Rand (durchsichtig, man sieht Schwimmer und Beckenboden)
      fan(poolMB, wat, y - 0.07, 1, 1, 1, 7);
      // Wände vom Rand bis zum Boden (Fliesen, Vorderseite zur Beckenmitte), Boden als Fächer mit Tiefenverlauf
      const floorAt = (x, z) => y - poolDepthAt(p, poolLocal(p, x, z)[0]);
      // Viereck A,B,C,D (oben a, oben b, unten b, unten a) mit Vorderseite zum Punkt (tx,tz)
      const wallQuad = (A, Bq, C, D, tx, tz, col, u0, u1, v1) => {
        const ux = C[0] - A[0], uy = C[1] - A[1], uz = C[2] - A[2], vx = D[0] - Bq[0], vy = D[1] - Bq[1], vz = D[2] - Bq[2];
        const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
        const mx = tx - (A[0] + Bq[0]) / 2, mz = tz - (A[2] + Bq[2]) / 2;
        if (nx * mx + nz * mz >= 0) basinMB.quadAuto(A, Bq, C, D, ...col, u0, 0, u1, v1);
        else basinMB.quadAuto(D, C, Bq, A, ...col, u0, v1, u1, 0);
      };
      let along = 0;
      for (let i = 0; i < N; i++) {
        const a = wat[i], b = wat[(i + 1) % N];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const fa = floorAt(a[0], a[1]), fb = floorAt(b[0], b[1]);
        const top = y - 0.04, band = top - 0.14;
        // dunkelblaue Fliesenkante unter dem Rand, darunter helle Fliesen
        wallQuad([a[0], top, a[1]], [b[0], top, b[1]], [b[0], band, b[1]], [a[0], band, a[1]], p.x, p.z, [0.12, 0.34, 0.52], 0, 1, 1);
        wallQuad([a[0], band, a[1]], [b[0], band, b[1]], [b[0], fb, b[1]], [a[0], fa, a[1]], p.x, p.z, [0.74, 0.9, 0.96], along / 2.5, (along + len) / 2.5, ((band - fa) + (band - fb)) / 5);
        along += len;
      }
      const cf = floorAt(p.x, p.z);
      for (let i = 0; i < N; i++) {
        const a = wat[i], b = wat[(i + 1) % N];
        basinMB.triUp([p.x, cf, p.z], [a[0], floorAt(a[0], a[1]), a[1]], [b[0], floorAt(b[0], b[1]), b[1]], 0.6, 0.82, 0.92, [p.x / 3, p.z / 3], [a[0] / 3, a[1] / 3], [b[0] / 3, b[1] / 3]);
      }
      // Bahnlinie am Boden (dunkelblau) entlang der langen Achse
      {
        const L = p.w * 0.38, wdt = 0.12;
        const q = (lx, lz) => { const [wx, wz] = poolWorld(p, lx, lz); return [wx, floorAt(wx, wz) + 0.01, wz]; };
        basinMB.quadUp(q(-L, -wdt), q(L, -wdt), q(L, wdt), q(-L, wdt), 0.1, 0.25, 0.5);
      }
      if (p.island) {
        const ir = islandR(p), M = 16, ring = [];
        for (let i = 0; i < M; i++) { const a = (i / M) * TAU; ring.push(poolWorld(p, Math.cos(a) * ir, Math.sin(a) * ir)); }
        for (let i = 0; i < M; i++) {
          const a = ring[i], b = ring[(i + 1) % M];
          const fa = floorAt(a[0], a[1]), fb = floorAt(b[0], b[1]);
          // Inselwand: Vorderseite nach außen ins Wasser
          const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
          wallQuad([a[0], y + 0.12, a[1]], [b[0], y + 0.12, b[1]], [b[0], fb, b[1]], [a[0], fa, a[1]], 2 * mx - p.x, 2 * mz - p.z, [0.74, 0.9, 0.96], 0, 1, 1);
        }
        const cc = [p.x, y + 0.2, p.z];
        for (let i = 0; i < M; i++) { const a = ring[i], b = ring[(i + 1) % M]; B.flat.triUp(cc, [a[0], y + 0.12, a[1]], [b[0], y + 0.12, b[1]], 0.3, 0.5, 0.2); }
        list.push({ t: 'palm', x: p.x, y: y + 0.15, z: p.z, r: 1, s: 0.8, v: 1 });
      }
    }

    // --- Straßenmöbel: Lampen, Alleen, Mauern ---
    this._roadside(segs, list, hAt, B);
    yield;

    // --- Explizite Props ---
    for (const p of this.propIdx.get(key) || []) {
      if (['palm', 'olive', 'cypress', 'bush', 'bougainvillea', 'lounger', 'parasol'].includes(p.t) && nearBuilding(ctx, p.x, p.z, 0.2)) continue;
      list.push({ ...p, y: hAt(p.x, p.z) });
    }
    for (const bt of this.boatIdx.get(key) || []) {
      const ref = BOAT_REF[bt.kind] || 10;
      list.push({ t: bt.kind, x: bt.x, y: -0.15, z: bt.z, r: bt.rot, s: bt.len / ref, v: 0, c: bt.v });
    }

    // --- Vegetation ---
    const vg = vegetation(ctx, cx, cz, hAt, this.density);
    let vr = vg.next();
    while (!vr.done) { yield; vr = vg.next(); }
    for (const p of vr.value) list.push(p);

    // Kollisionen der Props
    for (const p of list) {
      const def = PROP_DEFS[p.t];
      if (!def) continue;
      const mdl = this.props.models[p.t][(p.v ?? 0) % this.props.models[p.t].length];
      const col = mdl.collider;
      if (!col) continue;
      const s = p.s || 1;
      if (col.box) colliders.push({ k: 'b', x: p.x, z: p.z, hx: col.box[0] * s, hz: col.box[1] * s, c: Math.cos(p.r || 0), s: Math.sin(p.r || 0), y0: p.y - 1, y1: p.y + col.h * s, prop: p.t });
      else colliders.push({ k: 'c', x: p.x, z: p.z, r: col.r * s, y0: p.y - 1, y1: p.y + col.h * s, prop: p.t });
    }
    this.props.addChunk(key, list);

    // --- Meshes ---
    const group = new THREE.Group();
    const add = (mb, mat, opts = {}) => {
      if (mb.empty) return;
      const m = new THREE.Mesh(toGeometry(mb, { srgbColors: !opts.linear }), mat);
      m.castShadow = opts.cast !== false; m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      if (opts.order) m.renderOrder = opts.order;
      group.add(m);
    };
    add(B.plaster, mats.facade.plaster); add(B.old, mats.facade.old); add(B.hotel, mats.facade.hotel); add(B.glass, mats.facade.glass);
    add(B.shop, mats.facade.shop); add(B.metal, mats.facade.metal); add(B.club, mats.facade.club); add(B.finca, mats.facade.finca);
    add(B.roof, mats.roof); add(B.flat, mats.flat); add(B.sign, mats.sign, { cast: false });
    const H = mats.house;
    add(B.hPlaster, H.plaster); add(B.hRoof, H.roof); add(B.hWood, H.wood); add(B.hStone, H.stone); add(B.hHedge, H.hedge);
    add(B.hGlass, H.glass); add(B.hGlassLit, H.glassLit); add(B.hFence, H.fence);
    add(roadMB, mats.road, { cast: false, order: 1, linear: true });   // Vertexfarben = Shader-Parameter
    add(basinMB, mats.poolBasin, { cast: false });
    add(rimMB, mats.poolRim, { cast: false, order: 2 });
    add(B.hDeck, mats.deckWood, { cast: false }); add(B.led, mats.led, { cast: false }); add(B.leaf, mats.leaf);
    add(B.glow, mats.glow, { cast: false, order: 4 }); add(B.bglass, mats.homeGlass, { cast: false, order: 5 });
    add(poolMB, mats.pool, { cast: false, order: 3 });
    add(B.mark, mats.marking, { cast: false, order: 2 });   // Fahrbahnmarkierungen (Parkbuchten) über dem Belag
    this.cm.scene.add(group);

    const self = this;
    return {
      group, colliders, platforms, key,
      dispose() {
        self.cm.scene.remove(group);
        group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        self.props.removeChunk(key);
      },
    };
  }

  _roadside(segs, list, hAt, B) {
    const net = this.ctx.net;
    for (const { r, i } of segs) {
      const kind = r.kind;
      const a = r.pts[i], b = r.pts[i + 1];
      const dx0 = b[0] - a[0], dz0 = b[1] - a[1], L = Math.hypot(dx0, dz0) || 1;
      const tx = dx0 / L, tz = dz0 / L, nx = -tz, nz = tx;
      const s0 = r.cum[i], s1 = r.cum[i + 1];
      const padA = net.nodes[r.a] ? nodePadRadius(net, net.nodes[r.a]) : 0, padB = net.nodes[r.b] ? nodePadRadius(net, net.nodes[r.b]) : 0;
      const at = (s) => { const f = (s - s0) / L; return [a[0] + dx0 * f, a[1] + (b[1] - a[1]) * f, r.ys[i] + (r.ys[i + 1] - r.ys[i]) * f]; };
      const okS = (s) => s > padA + 6 && s < r.len - padB - 6;
      // Lampen
      if (r.urban && (kind === 'street' || kind === 'avenue' || kind === 'promenade' || kind === 'alley' || kind === 'quay')) {
        const step = kind === 'alley' ? 38 : 32;
        for (let k = Math.ceil(s0 / step); k * step < s1; k++) {
          const s = k * step;
          if (!okS(s)) continue;
          const side = k % 2 ? 1 : -1;
          const f = (s - s0) / L, px = a[0] + dx0 * f, pz = a[1] + (b[1] - a[1]) * f;
          const off = r.w / 2 + r.sw * 0.55;
          const x = px + nx * off * side, z = pz + nz * off * side;
          // Modell: Arm in +x; Drehung so, dass +x zur Straße (−side·n) zeigt
          list.push({ t: 'lamp', x, y: hAt(x, z), z, r: Math.atan2(side * nz, -side * nx), s: 1, v: 0 });
        }
      }
      // Alleen mit Palmen
      if (kind === 'avenue') {
        const step = 17;
        for (let k = Math.ceil(s0 / step); k * step < s1; k++) {
          const s = k * step; if (!okS(s)) continue;
          const f = (s - s0) / L, px = a[0] + dx0 * f, pz = a[1] + (b[1] - a[1]) * f;
          for (const side of [-1, 1]) { const off = r.w / 2 + r.sw - 0.9; const x = px + nx * off * side, z = pz + nz * off * side; list.push({ t: 'palm', x, y: hAt(x, z), z, r: k * 1.7 + side, s: 1.1, v: k % 3 }); }
        }
      }
      // Überland: Leitpfosten, Grasbüschel am Bankett, Alleebäume
      if (OVERLAND.has(kind) && !r.urban) this._overland(r, i, s0, s1, a, dx0, dz0, L, nx, nz, okS, list, hAt);
      // Feldweg: Gras auf dem Mittelstreifen und am Rand, teils Weidezaun
      if (kind === 'track') this._trackside(r, s0, s1, okS, list, hAt, B);
      // Bruchsteinmauer an Küstenstraßen (Abbruchkante)
      if (kind === 'scenic' || kind === 'main' || kind === 'rural') {
        const step = 4;
        for (let k = Math.ceil(s0 / step); k * step < s1; k++) {
          const s = k * step;
          const f = (s - s0) / L, px = a[0] + dx0 * f, pz = a[1] + (b[1] - a[1]) * f, py = r.ys[i] + (r.ys[i + 1] - r.ys[i]) * f;
          for (const side of [-1, 1]) {
            const off = r.w / 2 + 1.5;
            const x = px + nx * off * side, z = pz + nz * off * side;
            const drop = py - hAt(x + nx * side * 3, z + nz * side * 3);
            if (drop > (kind === 'scenic' ? 2.0 : 4.5)) list.push({ t: 'wallseg', x, y: hAt(x, z) - 0.2, z, r: Math.atan2(-tz, tx), s: 1, v: 0 });
          }
        }
      }
      void at;
    }
  }

  // Überlandstraße: Leitpfosten (alle 25 m, beidseitig), Grasbüschel am Bankettrand, Laubbäume in lockerer Reihe
  _overland(r, i, s0, s1, a, dx0, dz0, L, nx, nz, okS, list, hAt) {
    const hw = r.w / 2;
    const at = (s, side, off) => { const f = (s - s0) / L; const px = a[0] + dx0 * f, pz = a[1] + dz0 * f; const x = px + nx * off * side, z = pz + nz * off * side; return [x, z]; };
    for (let k = Math.ceil(s0 / 25); k * 25 < s1; k++) {
      const s = k * 25; if (!okS(s)) continue;
      for (const side of [-1, 1]) {
        const [x, z] = at(s, side, hw + 0.75);
        if (this._onOtherRoad(r, x, z, 1.2)) continue;
        list.push({ t: 'delineator', x, y: hAt(x, z), z, r: Math.atan2(side * nz, -side * nx), s: 1, v: 0 });
      }
    }
    if (this.density < 0.7) return;
    for (let k = Math.ceil(s0 / 0.9); k * 0.9 < s1; k++) {
      const s = k * 0.9; if (!okS(s + 3)) continue;
      for (const side of [-1, 1]) {
        const h = ihash(r.id * 2 + (side > 0 ? 1 : 0), k, 41);
        if (h > 0.78) continue;
        const [x, z] = at(s, side, hw + SHOULDER_W - 0.25 + ihash(r.id, k * 2 + side, 42) * 2.4);
        if (this._onOtherRoad(r, x, z)) continue;     // nicht auf Vorplätzen, Einfahrten, Wegen
        list.push({ t: 'grasstuft', x, y: hAt(x, z), z, r: h * 40, s: 0.65 + ihash(k, r.id, 43) * 0.7, v: (k * 7 + r.id) % 3 });
      }
    }
    for (let k = Math.ceil(s0 / 15); k * 15 < s1; k++) {
      const s = k * 15; if (!okS(s)) continue;
      for (const side of [-1, 1]) {
        const h = ihash(r.id * 2 + (side > 0 ? 1 : 0), k, 44);
        if (h > 0.4) continue;
        const [x, z] = at(s + (h - 0.2) * 12, side, hw + 4.4 + ihash(k, r.id, 45) * 3);
        if (!this._freeForTree(r, x, z)) continue;
        list.push({ t: 'tree', x, y: hAt(x, z) - 0.1, z, r: h * 60, s: 0.85 + ihash(k, side, 46) * 0.4, v: (k + r.id + (side > 0 ? 1 : 0)) % 3 });
      }
    }
  }

  // Liegt (x,z) auf einer anderen Fläche des Straßennetzes (Vorplatz, Einfahrt, Weg)?
  _onOtherRoad(r, x, z, margin = 0.3) {
    let hit = false;
    this.ctx.net.segHash.query(x - 1, z - 1, x + 1, z + 1, (seg) => {
      const o = seg.r;
      if (hit || o === r) return;
      const a = o.pts[seg.i], b = o.pts[seg.i + 1], ex = b[0] - a[0], ez = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1)));
      if (Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t) < o.w / 2 + o.sw + margin) hit = true;
    });
    return hit;
  }

  _freeForTree(r, x, z) {
    const ctx = this.ctx;
    if (ctx.coast.sdAt(x, z) < 8) return false;
    if (ctx.landuse.get(x, z) !== 0) return false;
    const nr = ctx.net.nearest(x, z, 14);
    if (nr && nr.d < nr.road.w / 2 + nr.road.sw + 3.4) return false;
    if (nearBuilding(ctx, x, z, 3)) return false;
    return true;
  }

  // Feldweg: Gras auf dem Mittelstreifen und an den Rändern; bei gut der Hälfte der Wege ein Weidezaun
  // (Holzpfähle alle 3 m, zwei Drähte), auf einer oder beiden Seiten
  _trackside(r, s0, s1, okS, list, hAt, B) {
    const net = this.ctx.net, P = {}, Q = {};
    const hw = r.w / 2;
    const side = (p, off) => [p.x - p.dz * off, p.z + p.dx * off];
    if (this.density >= 0.7) {
      for (let k = Math.ceil(s0 / 0.8); k * 0.8 < s1; k++) {
        const s = k * 0.8; if (!okS(s + 4)) continue;
        net.pointAt(r, s, P);
        const hm = ihash(r.id, k, 61);
        if (hm < 0.5) { const [x, z] = side(P, (ihash(k, r.id, 62) - 0.5) * 0.3); list.push({ t: 'grasstuft', x, y: hAt(x, z) + 0.02, z, r: hm * 50, s: 0.45 + hm * 0.5, v: 1 }); }
        for (const sd of [-1, 1]) {
          const he = ihash(r.id * 2 + (sd > 0 ? 1 : 0), k, 63);
          if (he > 0.72) continue;
          const [x, z] = side(P, sd * (hw - 0.55 + he * 1.6));
          list.push({ t: 'grasstuft', x, y: hAt(x, z), z, r: he * 50, s: 0.7 + he * 0.7, v: (k + (sd > 0 ? 1 : 0)) % 3 });
        }
      }
    }
    if (ihash(r.id, 0, 51) > 0.6) return;
    const both = ihash(r.id, 1, 52) < 0.5, one = ihash(r.id, 2, 53) < 0.5 ? -1 : 1;
    const sides = both ? [-1, 1] : [one];
    const f = B.flat;
    for (let k = Math.ceil(s0 / 3); k * 3 < s1; k++) {
      const s = k * 3; if (!okS(s) || !okS(s + 3)) continue;
      net.pointAt(r, s, P); net.pointAt(r, s + 3, Q);
      for (const sd of sides) {
        const off = sd * (hw + 0.45);
        const [x0, z0] = side(P, off), [x1, z1] = side(Q, off);
        const y0 = hAt(x0, z0), y1 = hAt(x1, z1);
        const lean = (ihash(k, r.id + sd, 54) - 0.5) * 0.12, tone = 0.85 + ihash(k, r.id, 55) * 0.3;
        beam(f, [x0, y0 - 0.15, z0], [x0 + lean * P.dx, y0 + 1.18, z0 + lean * P.dz], 0.1, [0.43 * tone, 0.34 * tone, 0.25 * tone]);
        for (const hgt of [0.52, 0.96]) beam(f, [x0, y0 + hgt, z0], [x1, y1 + hgt, z1], 0.014, [0.5, 0.5, 0.5]);
        if (ihash(k, r.id, 56) < 0.8) list.push({ t: 'grasstuft', x: x0, y: y0, z: z0, r: k, s: 0.9 + ihash(k, r.id, 57) * 0.5, v: 2 });
      }
    }
  }
}

const OVERLAND = new Set(['rural', 'main', 'scenic', 'highway']);

// Dünner Balken mit quadratischem Querschnitt zwischen zwei Punkten (Zaunpfahl, Draht)
function beam(mb, a, b, t, col) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / L, uy = dy / L, uz = dz / L;
  // Seitenvektor waagerecht (bei senkrechten Balken: x-Achse), dann Normale = Richtung × Seite
  let sx = -uz, sz = ux, sl = Math.hypot(sx, sz);
  if (sl < 1e-4) { sx = 1; sz = 0; sl = 1; }
  sx = sx / sl * t / 2; sz = sz / sl * t / 2;
  let vx = uy * sz, vy = uz * sx - ux * sz, vz = -uy * sx;
  const vl = Math.hypot(vx, vy, vz) || 1; vx = vx / vl * t / 2; vy = vy / vl * t / 2; vz = vz / vl * t / 2;
  const P = (p, i, j) => [p[0] + sx * i + vx * j, p[1] + vy * j, p[2] + sz * i + vz * j];
  const faces = [[1, 1, -1, 1], [-1, 1, -1, -1], [-1, -1, 1, -1], [1, -1, 1, 1]];
  for (const [i0, j0, i1, j1] of faces) mb.quadAuto(P(a, i1, j1), P(b, i1, j1), P(b, i0, j0), P(a, i0, j0), col[0], col[1], col[2]);
  mb.quadAuto(P(b, 1, 1), P(b, -1, 1), P(b, -1, -1), P(b, 1, -1), col[0], col[1], col[2]);
}

// Globale Skyline: alle Hochhäuser in einem Mesh (immer sichtbar, auch aus großer Entfernung)
export function buildSkyline(ctx, mats) {
  const B = { glass: new MeshBuilder(), flat: new MeshBuilder(), sign: new MeshBuilder() };
  const stub = { plaster: new MeshBuilder(), old: new MeshBuilder(), hotel: new MeshBuilder(), shop: new MeshBuilder(), metal: new MeshBuilder(), club: new MeshBuilder(), finca: new MeshBuilder(), roof: new MeshBuilder() };
  Object.assign(stub, B);
  for (const b of ctx.buildings) {
    if (!b.tower) continue;
    const nr = ctx.net.nearest(b.x, b.z, 150);
    let front = 0;
    if (nr) {
      const dx = nr.x - b.x, dz = nr.z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
      const nl = [[0, 1], [1, 0], [0, -1], [-1, 0]];
      let best = -2;
      nl.forEach((n, q) => { const d = ((c * n[0] + s * n[1]) * dx + (-s * n[0] + c * n[1]) * dz) / (Math.hypot(dx, dz) || 1); if (d > best) { best = d; front = q; } });
    }
    addBuilding(b, stub, front);
  }
  const group = new THREE.Group();
  const add = (mb, mat, cast = true) => {
    if (mb.empty) return;
    const m = new THREE.Mesh(toGeometry(mb), mat);
    m.castShadow = cast; m.receiveShadow = true; m.matrixAutoUpdate = false; m.frustumCulled = false;
    group.add(m);
  };
  add(B.glass, mats.facade.glass); add(B.flat, mats.flat); add(B.sign, mats.sign, false);
  return group;
}
