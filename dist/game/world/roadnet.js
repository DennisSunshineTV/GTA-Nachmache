// Straßennetz: Knoten, Straßen, Höhenprofile, Geländeeinschnitt, A*-Verbindungen.
import { SpatialHash, MinHeap, smoothstep, lerp, clamp, catmull, resample, simplify, polyLength } from '../util.js';
import { flattenJunctions } from './junction.js';
import { LU } from './landuse.js';

export const ROAD_KINDS = {
  highway: { w: 13, speed: 34, lanes: 4, fall: 15, sw: 0, tex: 'hw' },
  main: { w: 9.6, speed: 25, lanes: 2, fall: 18, sw: 0, tex: 'main' },
  rural: { w: 7.8, speed: 20, lanes: 2, fall: 22, sw: 0, tex: 'rural' },
  scenic: { w: 7.8, speed: 17, lanes: 2, fall: 30, sw: 0, tex: 'scenic' },
  avenue: { w: 13, speed: 17, lanes: 4, fall: 6, sw: 3.6, tex: 'avenue' },
  street: { w: 8.6, speed: 12, lanes: 2, fall: 6, sw: 3.2, tex: 'street' },
  alley: { w: 6.2, speed: 8, lanes: 2, fall: 5, sw: 2.2, tex: 'alley' },
  promenade: { w: 11, speed: 9, lanes: 2, fall: 6, sw: 4.5, tex: 'prom' },
  track: { w: 4.8, speed: 10, lanes: 1, fall: 7, sw: 0, tex: 'track' },
  taxiway: { w: 16, speed: 12, lanes: 1, fall: 8, sw: 0, tex: 'taxi', noTraffic: true },
  runway: { w: 46, speed: 0, lanes: 0, fall: 10, sw: 0, tex: 'runway', noTraffic: true },
  quay: { w: 10, speed: 8, lanes: 2, fall: 4, sw: 0, tex: 'quay' },
  deck: { w: 6, speed: 8, lanes: 1, fall: 4, sw: 0, tex: 'deck', noTraffic: true },
  forecourt: { w: 16, speed: 5, lanes: 1, fall: 7, sw: 0, tex: 'apron', noTraffic: true },   // Vorplatz von Tankstelle/Werkstatt
};

const CARVE_MAX = 48;
const CARVE_W = new Float64Array(CARVE_MAX), CARVE_E = new Float64Array(CARVE_MAX), CARVE_Y = new Float64Array(CARVE_MAX);

export class RoadNet {
  constructor(hf, coast) {
    this.hf = hf;
    this.coast = coast;
    this.nodes = [];
    this.roads = [];
    this.nodeHash = new SpatialHash(32);
    this.segHash = new SpatialHash(48);
    this.finalized = false;
  }

  addNode(x, z, merge = 5) {
    let found = -1, bd = merge * merge;
    this.nodeHash.query(x - merge, z - merge, x + merge, z + merge, (n) => {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d <= bd) { bd = d; found = n.id; }
    });
    if (found >= 0) return found;
    const n = { id: this.nodes.length, x, z, y: 0, roads: [] };
    this.nodes.push(n);
    this.nodeHash.insert(n, x, z);
    return n.id;
  }

  // pts: Polylinie inkl. Endpunkte (Endpunkte werden an Knoten gebunden)
  addRoad(kind, pts, a, b, opts = {}) {
    const k = ROAD_KINDS[kind];
    const na = this.nodes[a], nb = this.nodes[b];
    let p = pts.map((q) => [q[0], q[1]]);
    p[0] = [na.x, na.z];
    p[p.length - 1] = [nb.x, nb.z];
    if (p.length === 2 && Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) < 0.5) return null;
    p = resample(p, 10);
    const road = {
      id: this.roads.length, kind, w: opts.w ?? k.w, speed: k.speed, lanes: k.lanes, sw: opts.sw ?? k.sw, fall: k.fall,
      pts: p, ys: null, cum: null, len: 0, a, b, name: opts.name || '', oneway: !!opts.oneway, noTraffic: !!k.noTraffic || !!opts.noTraffic,
      urban: !!opts.urban, flat: !!opts.flat,
    };
    this.roads.push(road);
    na.roads.push(road.id);
    nb.roads.push(road.id);
    return road;
  }

  // Straße zwischen zwei Punkten (erzeugt Knoten)
  connect(kind, p, q, opts = {}) {
    const a = this.addNode(p[0], p[1], opts.merge ?? 5), b = this.addNode(q[0], q[1], opts.merge ?? 5);
    if (a === b) return null;
    return this.addRoad(kind, [p, q], a, b, opts);
  }

  nearestNode(x, z, maxd = 200, filter = null) {
    let best = null, bd = maxd * maxd;
    this.nodeHash.query(x - maxd, z - maxd, x + maxd, z + maxd, (n) => {
      if (filter && !filter(n)) return;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    });
    return best;
  }

  // Höhenprofile + Hash, danach Geländeeinschnitt aktivieren
  finalize() {
    const hf = this.hf;
    // Knotenhöhen: Mittel aus Umgebung
    for (const n of this.nodes) {
      let s = hf.base(n.x, n.z), c = 1;
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        s += hf.base(n.x + Math.cos(a) * 14, n.z + Math.sin(a) * 14); c++;
      }
      n.y = Math.max(0.35, s / c);
    }
    for (const r of this.roads) this._profile(r);
    flattenJunctions(this);
    levelCrossings(this.roads);
    for (const r of this.roads) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        const m = (r.w * 0.5 + r.sw + r.fall) + 4;
        const seg = { r, i };
        this.segHash.insert(seg, Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m);
      }
    }
    this.finalized = true;
    hf.carve = (x, z, h) => this.carve(x, z, h);
  }

  // Nachträglich hinzugefügte Straße (nach finalize): bindet an das Höhenprofil einer bestehenden Straße an
  addLate(kind, pts, { yB = null, hf = this.hf, name = '', noTraffic = false, w = null, flat = false } = {}) {
    const a = this.addNode(pts[0][0], pts[0][1], 0.5), b = this.addNode(pts[pts.length - 1][0], pts[pts.length - 1][1], 0.5);
    if (a === b) return null;
    const na = this.nodes[a], nb = this.nodes[b];
    na.y = Math.max(0.35, hf.h(na.x, na.z));
    nb.y = yB ?? Math.max(0.35, hf.h(nb.x, nb.z));
    const p = catmull(pts.map((q) => [q[0], q[1]]), 8, false, 0.5);
    const r = this.addRoad(kind, p, a, b, { name, noTraffic, w: w ?? undefined, flat });
    if (!r) return null;
    this._profile(r);
    for (let i = 0; i < r.pts.length - 1; i++) {
      const A = r.pts[i], B = r.pts[i + 1];
      const m = (r.w * 0.5 + r.sw + r.fall) + 4;
      this.segHash.insert({ r, i }, Math.min(A[0], B[0]) - m, Math.min(A[1], B[1]) - m, Math.max(A[0], B[0]) + m, Math.max(A[1], B[1]) + m);
    }
    return r;
  }

  _profile(r) {
    const pts = r.pts, n = pts.length, hf = this.hf;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    r.cum = cum;
    r.len = cum[n - 1];
    const na = this.nodes[r.a], nb = this.nodes[r.b];
    let ys = new Float32Array(n);
    for (let i = 0; i < n; i++) ys[i] = hf.base(pts[i][0], pts[i][1]);
    if (r.flat) {
      ys.fill((na.y + nb.y) / 2);
    } else {
      // Glätten (Fenster ~ ±45 m), zweimal
      const win = r.kind === 'highway' ? 6 : r.kind === 'scenic' || r.kind === 'rural' ? 2 : 4;
      for (let pass = 0; pass < (r.kind === 'scenic' || r.kind === 'rural' ? 1 : 2); pass++) {
        const t = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let s = 0, c = 0;
          for (let k = -win; k <= win; k++) {
            const j = i + k;
            if (j >= 0 && j < n) { s += ys[j]; c++; }
          }
          t[i] = s / c;
        }
        ys = t;
      }
      // Enden an Knotenhöhen anbinden
      const d0 = na.y - ys[0], d1 = nb.y - ys[n - 1];
      const fade = Math.min(90, r.len * 0.5) || 1;
      for (let i = 0; i < n; i++) {
        const s = cum[i];
        ys[i] += d0 * Math.max(0, 1 - s / fade) + d1 * Math.max(0, 1 - (r.len - s) / fade);
      }
      // Maximale Steigung begrenzen (ca. 11 %). Die Enden bleiben immer auf Knotenhöhe – sonst klafft an der Kreuzung
      // eine Stufe; liegen die Knoten dafür zu weit auseinander, wird die Straße gleichmäßig steiler.
      const maxS = Math.max(r.kind === 'highway' ? 0.06 : 0.11, (Math.abs(nb.y - na.y) / (r.len || 1)) * 1.15);
      for (let i = 0; i < n; i++) {
        const a = maxS * cum[i], b = maxS * (r.len - cum[i]);
        ys[i] = clamp(ys[i], Math.max(na.y - a, nb.y - b), Math.min(na.y + a, nb.y + b));
      }
      ys[0] = na.y; ys[n - 1] = nb.y;
      for (let i = 1; i < n - 1; i++) { const ds = cum[i] - cum[i - 1]; ys[i] = clamp(ys[i], ys[i - 1] - maxS * ds, ys[i - 1] + maxS * ds); }
      for (let i = n - 2; i > 0; i--) { const ds = cum[i + 1] - cum[i]; ys[i] = clamp(ys[i], ys[i + 1] - maxS * ds, ys[i + 1] + maxS * ds); }
    }
    for (let i = 0; i < n; i++) ys[i] = Math.max(ys[i], 0.35);
    r.ys = ys;
  }

  // Geländeeinschnitt: zieht die Höhe in Straßennähe auf das Straßenprofil
  // Überlappen sich mehrere Straßen (Kreuzungen), zählt die, deren Fläche der Stelle am nächsten liegt – sonst
  // würde das Gelände über einer Straße aus dem Mittel aller Arme liegen und durch den Belag ragen.
  // In Städten (Bürgersteig) bleibt das Gelände außerdem ein Stück weiter flach: das Geländenetz hat 4 m Raster,
  // sonst schauen Dreiecke am Bordsteinrand durch.
  carve(x, z, h) {
    let wBest = 0, emin = Infinity, n = 0;
    this.segHash.query(x - 1, z - 1, x + 1, z + 1, (seg) => {
      const r = seg.r, a = r.pts[seg.i], b = r.pts[seg.i + 1];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const l2 = ex * ex + ez * ez || 1;
      let t = ((x - a[0]) * ex + (z - a[1]) * ez) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - (a[0] + ex * t), dz = z - (a[1] + ez * t);
      const d = Math.sqrt(dx * dx + dz * dz);
      const half = r.w * 0.5 + r.sw;
      const flat = half + (r.sw > 0 ? 3.0 : 0.8);
      if (d >= flat + r.fall || n >= CARVE_MAX) return;
      const w = 1 - smoothstep(flat, flat + r.fall, d);
      const e = d - half;
      if (w > wBest) wBest = w;
      if (e < emin) emin = e;
      CARVE_W[n] = w; CARVE_E[n] = e; CARVE_Y[n] = r.ys[seg.i] + (r.ys[seg.i + 1] - r.ys[seg.i]) * t;
      n++;
    });
    if (wBest <= 0) return h;
    let ySum = 0, wSum = 0;
    for (let k = 0; k < n; k++) {
      const ww = CARVE_W[k] * (1 - smoothstep(0, 1.2, CARVE_E[k] - emin));
      ySum += CARVE_Y[k] * ww; wSum += ww;
    }
    const y = wSum > 1e-9 ? ySum / wSum : h;
    return h + (y - h) * wBest;
  }

  // Deckung 0..1 durch Fahrbahn (für Fernsicht-Färbung des Geländes)
  roadCover(x, z) {
    let best = 0;
    this.segHash.query(x - 1, z - 1, x + 1, z + 1, (seg) => {
      const r = seg.r;
      if (r.kind === 'track') return;
      const a = r.pts[seg.i], b = r.pts[seg.i + 1];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const l2 = ex * ex + ez * ez || 1;
      let t = ((x - a[0]) * ex + (z - a[1]) * ez) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - (a[0] + ex * t), z - (a[1] + ez * t));
      const half = r.w * 0.5 + r.sw;
      const c = 1 - smoothstep(half * 0.5, half + 6, d);
      if (c > best) best = c;
    });
    return best;
  }

  // Nächste Straße zu (x,z): { road, i, t, d, x, z, y }
  nearest(x, z, maxd = 40, filter = null) {
    let best = null, bd = maxd;
    this.segHash.query(x - maxd, z - maxd, x + maxd, z + maxd, (seg) => {
      const r = seg.r;
      if (filter && !filter(r)) return;
      const a = r.pts[seg.i], b = r.pts[seg.i + 1];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const l2 = ex * ex + ez * ez || 1;
      let t = ((x - a[0]) * ex + (z - a[1]) * ez) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = a[0] + ex * t, qz = a[1] + ez * t;
      const d = Math.hypot(x - qx, z - qz);
      if (d < bd) {
        bd = d;
        best = { road: r, i: seg.i, t, d, x: qx, z: qz, y: r.ys[seg.i] + (r.ys[seg.i + 1] - r.ys[seg.i]) * t };
      }
    });
    return best;
  }

  // Liegt (x,z) auf irgendeiner Straße (Fahrbahn, Bürgersteig, Holzbohlen), plus Sicherheitsabstand?
  covers(x, z, margin = 0) {
    let hit = false;
    this.segHash.query(x - 1, z - 1, x + 1, z + 1, (seg) => {
      if (hit) return;
      const r = seg.r, a = r.pts[seg.i], b = r.pts[seg.i + 1];
      const ex = b[0] - a[0], ez = b[1] - a[1];
      const t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
      if (Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t) < r.w * 0.5 + r.sw + margin) hit = true;
    });
    return hit;
  }

  // Position/Richtung auf einer Straße bei Strecke s
  pointAt(r, s, out = {}) {
    const cum = r.cum, n = cum.length;
    s = clamp(s, 0, r.len);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const seg = cum[hi] - cum[lo] || 1;
    const t = (s - cum[lo]) / seg;
    const a = r.pts[lo], b = r.pts[hi];
    out.x = a[0] + (b[0] - a[0]) * t;
    out.z = a[1] + (b[1] - a[1]) * t;
    out.y = r.ys[lo] + (r.ys[hi] - r.ys[lo]) * t;
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    out.dx = dx / l; out.dz = dz / l;
    out.i = lo;
    return out;
  }

  // Straßenabschnitt zur Statistik: Länge in Metern
  get totalLength() { return this.roads.reduce((s, r) => s + r.len, 0); }
}

// Kreuzen sich zwei Straßen ohne gemeinsamen Knoten, treffen sie sich dort auf gleicher Höhe – sonst verschwindet eine
// im Boden. Die Höhe wird über 40 m eingeblendet; die Straßenenden (Knotenhöhen) bleiben unverändert.
function levelCrossings(roads) {
  const hash = new SpatialHash(48), found = [];
  for (const r of roads) {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1], ex = b[0] - a[0], ez = b[1] - a[1];
      const box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      hash.query(...box, (o) => {
        if (o.r === r) return;
        const c = o.r.pts[o.i], d = o.r.pts[o.i + 1], fx = d[0] - c[0], fz = d[1] - c[1], den = ex * fz - ez * fx;
        if (Math.abs(den) < 1e-6) return;
        const t = ((c[0] - a[0]) * fz - (c[1] - a[1]) * fx) / den, u = ((c[0] - a[0]) * ez - (c[1] - a[1]) * ex) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) found.push([{ r, i, t }, { r: o.r, i: o.i, t: u }]);
      });
      hash.insert({ r, i }, ...box);
    }
  }
  const height = ({ r, i, t }) => r.ys[i] + (r.ys[i + 1] - r.ys[i]) * t;
  for (const pair of found) {
    const [ya, yb] = pair.map(height);
    if (Math.abs(ya - yb) < 0.3) continue;
    for (const c of pair) {
      const r = c.r, at = r.cum[c.i] + (r.cum[c.i + 1] - r.cum[c.i]) * c.t, delta = (ya + yb) / 2 - height(c);
      for (let k = 1; k < r.pts.length - 1; k++) {
        const w = 1 - smoothstep(4, 40, Math.abs(r.cum[k] - at));
        r.ys[k] += delta * w * Math.min(1, r.cum[k] / 15, (r.len - r.cum[k]) / 15);
      }
    }
  }
}

// ---------- A*-Verbindungsstraßen ----------

export function routeLinks(net, links, ctx) {
  const { hf, coast, world, settlements, landuse = null, cell = 30 } = ctx;
  const nx = Math.ceil((world.x1 - world.x0) / cell), nz = Math.ceil((world.z1 - world.z0) / cell);
  const N = nx * nz;
  const hg = new Float32Array(N).fill(NaN); // Basishöhen (lazy)
  const sdg = new Float32Array(N).fill(NaN);
  const cx = (i) => world.x0 + (i % nx + 0.5) * cell;
  const cz = (i) => world.z0 + (Math.floor(i / nx) + 0.5) * cell;
  const heightAt = (i) => (Number.isNaN(hg[i]) ? (hg[i] = hf.base(cx(i), cz(i))) : hg[i]);
  const sdAt = (i) => (Number.isNaN(sdg[i]) ? (sdg[i] = coast.sdAt(cx(i), cz(i))) : sdg[i]);
  // Flughafengelände (auch angeschnittene Zellen): Verbindungsstraßen führen außen herum
  const airg = new Int8Array(N).fill(-1);
  const airAt = (i) => {
    if (airg[i] < 0) {
      airg[i] = 0;
      if (landuse) for (const dx of [-0.5, 0, 0.5]) for (const dz of [-0.5, 0, 0.5]) { const u = landuse.get(cx(i) + dx * cell, cz(i) + dz * cell); if (u === LU.AIRPORT || u === LU.RUNWAY) airg[i] = 1; }
    }
    return airg[i] === 1;
  };
  const used = new Uint8Array(N);
  const blockR = new Float32Array(N); // Zusatzkosten in Siedlungen

  const cellOf = (x, z) => {
    const i = clamp(Math.floor((x - world.x0) / cell), 0, nx - 1), j = clamp(Math.floor((z - world.z0) / cell), 0, nz - 1);
    return j * nx + i;
  };

  const paths = []; // { cells:[...], kind, aNode, bNode, scenic }

  const gScore = new Float32Array(N), came = new Int32Array(N), stamp = new Uint32Array(N);
  let stampId = 0;
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

  function route(start, goal, scenic, exemptA, exemptB) {
    stampId++;
    const heap = new MinHeap();
    gScore[start] = 0; came[start] = -1; stamp[start] = stampId;
    heap.push(0, start);
    const gx = cx(goal), gz = cz(goal);
    const closed = new Uint8Array(0);
    void closed;
    let guard = 0;
    while (heap.size && guard++ < 900000) {
      const cur = heap.pop();
      if (cur === goal) break;
      const ci = cur % nx, cj = (cur / nx) | 0;
      const gc = gScore[cur];
      const hc = heightAt(cur);
      for (let k = 0; k < 8; k++) {
        const ni = ci + DIRS[k][0], nj = cj + DIRS[k][1];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const nb = nj * nx + ni;
        const sd = sdAt(nb);
        const isEnd = nb === goal || nb === start;
        if (sd < 24 && !isEnd) continue;
        const hn = heightAt(nb);
        const run = DIRS[k][2] * cell;
        const slope = Math.abs(hn - hc) / run;
        if (slope > 0.42 && !isEnd) continue;
        let c = DIRS[k][2] * (1 + 38 * slope * slope + (slope > 0.25 ? 6 : 0));
        if (sd < 55) c *= 1.6;
        if (!isEnd && airAt(nb)) c *= 40;
        if (scenic) c *= 1 + 0.01 * Math.max(0, sd - 110);
        if (used[nb]) c *= 0.5;
        const br = blockR[nb];
        if (br > 0 && !(br === exemptA || br === exemptB)) c *= 9;
        const g = gc + c;
        if (stamp[nb] !== stampId || g < gScore[nb]) {
          stamp[nb] = stampId; gScore[nb] = g; came[nb] = cur;
          const hx = cx(nb) - gx, hz = cz(nb) - gz;
          heap.push(g + Math.sqrt(hx * hx + hz * hz) / cell * 0.5, nb);
        }
      }
    }
    if (stamp[goal] !== stampId) return null;
    const out = [];
    for (let c = goal; c !== -1; c = came[c]) out.push(c);
    return out.reverse();
  }

  // Siedlungsflächen kosten Zuschlag (außer für eigene Endpunkte)
  settlements.forEach((s, idx) => {
    if (!s.pos || s.kind === 'resort') return;
    const R = (s.r || 200) * 0.95;
    const r = Math.ceil(R / cell);
    const c0 = cellOf(s.pos[0], s.pos[1]);
    const ci = c0 % nx, cj = (c0 / nx) | 0;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      if (di * di + dj * dj <= r * r) blockR[j * nx + i] = idx + 1;
    }
  });

  const byId = new Map(settlements.map((s, i) => [s.id, { s, idx: i + 1 }]));
  for (const [a, b, kind] of links) {
    const A = byId.get(a), B = byId.get(b);
    if (!A || !B || !A.s.pos || !B.s.pos) continue;
    const ga = pickGate(net, A.s, B.s.approach || B.s.pos), gb = pickGate(net, B.s, A.s.approach || A.s.pos);
    if (!ga || !gb) continue;
    const scenic = kind === 'scenic';
    const cells = route(cellOf(ga.x, ga.z), cellOf(gb.x, gb.z), scenic, A.idx, B.idx);
    if (!cells) { console.warn('Keine Route', a, b); continue; }
    for (const c of cells) used[c] = 1;
    paths.push({ cells, kind, a: ga.id, b: gb.id, from: ga, to: gb, towns: [a, b] });
  }

  // ---- Zellgraph vereinigen und in Ketten zerlegen ----
  const adj = new Map();
  const addEdge = (u, v) => {
    if (u === v) return;
    let s = adj.get(u); if (!s) adj.set(u, (s = new Set())); s.add(v);
    let t = adj.get(v); if (!t) adj.set(v, (t = new Set())); t.add(u);
  };
  const kindRank = { highway: 5, main: 4, rural: 3, scenic: 3, track: 1 };
  const edgeKind = new Map();
  const ek = (u, v) => (u < v ? u * N + v : v * N + u);
  const terminals = new Map(); // Zelle -> Knoten-ID
  for (const p of paths) {
    terminals.set(p.cells[0], p.a);
    terminals.set(p.cells[p.cells.length - 1], p.b);
    for (let i = 1; i < p.cells.length; i++) {
      const u = p.cells[i - 1], v = p.cells[i];
      addEdge(u, v);
      const key = ek(u, v);
      const prev = edgeKind.get(key);
      if (!prev || kindRank[p.kind] > kindRank[prev]) edgeKind.set(key, p.kind);
    }
  }
  const isJunction = (c) => adj.get(c).size !== 2 || terminals.has(c);
  const visited = new Set();
  const nodeOfCell = (c) => {
    if (terminals.has(c)) return terminals.get(c);
    return net.addNode(cx(c), cz(c), 4);
  };
  const created = [];
  for (const [start] of adj) {
    if (!isJunction(start)) continue;
    for (const nb of adj.get(start)) {
      const key0 = ek(start, nb);
      if (visited.has(key0)) continue;
      const chain = [start];
      let prev = start, cur = nb;
      visited.add(key0);
      chain.push(cur);
      while (!isJunction(cur)) {
        const nxt = [...adj.get(cur)].find((x) => x !== prev);
        visited.add(ek(cur, nxt));
        prev = cur; cur = nxt;
        chain.push(cur);
      }
      // Straßenklasse: häufigste/höchste im Abschnitt
      let kind = 'rural', rank = 0;
      for (let i = 1; i < chain.length; i++) {
        const kk = edgeKind.get(ek(chain[i - 1], chain[i]));
        if (kindRank[kk] > rank) { rank = kindRank[kk]; kind = kk; }
      }
      let pts = chain.map((c) => [cx(c), cz(c)]);
      const a = nodeOfCell(chain[0]), b = nodeOfCell(chain[chain.length - 1]);
      if (a === b) continue;
      const na = net.nodes[a], nb2 = net.nodes[b];
      pts[0] = [na.x, na.z];
      pts[pts.length - 1] = [nb2.x, nb2.z];
      if (pts.length > 2) {
        pts = simplify(pts, 17);
        pts = catmull(pts, 10, false, 0.5);
      }
      const road = net.addRoad(kind, pts, a, b);
      if (road) created.push(road);
    }
  }
  created.paths = paths;
  return created;
}

// Einfahrtsknoten einer Siedlung in Richtung `toward`
function pickGate(net, s, toward) {
  const cands = s.gates && s.gates.length ? s.gates : null;
  if (!cands) return null;
  let best = null, bd = 1e18;
  for (const id of cands) {
    const n = net.nodes[id];
    const d = (n.x - toward[0]) ** 2 + (n.z - toward[1]) ** 2;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
