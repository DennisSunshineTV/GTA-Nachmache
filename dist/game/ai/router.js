// Routenplanung über das Straßennetz (A* auf Knoten) und Hilfen zum Spurfolgen.
import { MinHeap, clamp, wrapPi } from '../util.js';

export class Router {
  constructor(net) {
    this.net = net;
    this.adj = null;
  }

  _build() {
    this.adj = this.net.nodes.map((n) => n.roads.filter((id) => !this.net.roads[id].noTraffic).map((id) => {
      const r = this.net.roads[id];
      return { road: r, to: r.a === n.id ? r.b : r.a, fwd: r.a === n.id, cost: r.len / Math.max(6, r.speed) };
    }));
  }

  neighbors(nodeId) { if (!this.adj) this._build(); return this.adj[nodeId] || []; }

  // Kürzeste Route zwischen Knoten: Liste von { road, fwd } oder null
  route(from, to, limit = 6000) {
    if (!this.adj) this._build();
    if (from === to) return [];
    const nodes = this.net.nodes;
    const g = new Map([[from, 0]]), came = new Map();
    const heap = new MinHeap();
    heap.push(0, from);
    const tx = nodes[to].x, tz = nodes[to].z;
    let steps = 0;
    while (heap.size && steps++ < limit) {
      const cur = heap.pop();
      if (cur === to) break;
      const gc = g.get(cur);
      for (const e of this.adj[cur]) {
        const ng = gc + e.cost;
        if (ng < (g.get(e.to) ?? Infinity)) {
          g.set(e.to, ng); came.set(e.to, { prev: cur, edge: e });
          const n = nodes[e.to];
          heap.push(ng + Math.hypot(n.x - tx, n.z - tz) / 28, e.to);
        }
      }
    }
    if (!came.has(to)) return null;
    const out = [];
    for (let c = to; c !== from;) { const e = came.get(c); out.push({ road: e.edge.road, fwd: e.edge.fwd }); c = e.prev; }
    return out.reverse();
  }

  // Zufällige nächste Straße am Knoten (bevorzugt geradeaus), ohne die bisherige
  pickNext(nodeId, fromRoad, preferDir = null) {
    const opts = this.neighbors(nodeId).filter((e) => e.road !== fromRoad);
    if (!opts.length) {
      const back = this.neighbors(nodeId).find((e) => e.road === fromRoad);
      return back || null;
    }
    if (preferDir && Math.random() < 0.55) {
      let best = null, bd = -2;
      for (const e of opts) {
        const r = e.road, p = e.fwd ? r.pts[1] : r.pts[r.pts.length - 2], n = this.net.nodes[nodeId];
        let dx = p[0] - n.x, dz = p[1] - n.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const d = dx * preferDir.x + dz * preferDir.z;
        if (d > bd) { bd = d; best = e; }
      }
      if (best) return best;
    }
    return opts[Math.floor(Math.random() * opts.length)];
  }
}

// Position auf einer Straße mit seitlichem Versatz (rechts der Fahrtrichtung positiv)
export function laneTarget(net, road, fwd, s, off, out = {}) {
  const sp = fwd ? s : road.len - s;
  net.pointAt(road, sp, out);
  let dx = out.dx, dz = out.dz;
  if (!fwd) { dx = -dx; dz = -dz; }
  out.tx = dx; out.tz = dz;                // Fahrtrichtung
  out.px = out.x + (-dz) * off;            // rechts = (-dz, dx)
  out.pz = out.z + dx * off;
  return out;
}

// Fortschritt s auf der Straße zum Punkt (x,z) bestimmen (lokal um s0 suchen)
export function projectOnRoad(net, road, x, z, s0, fwd) {
  const sp0 = fwd ? s0 : road.len - s0;
  let bestS = sp0, bd = 1e9;
  const cum = road.cum, pts = road.pts;
  let i0 = 0;
  // Segmentindex nahe sp0
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= sp0) lo = m; else hi = m; }
  i0 = lo;
  for (let i = Math.max(0, i0 - 3); i <= Math.min(pts.length - 2, i0 + 3); i++) {
    const a = pts[i], b = pts[i + 1];
    const ex = b[0] - a[0], ez = b[1] - a[1], l2 = ex * ex + ez * ez || 1;
    const t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / l2, 0, 1);
    const d = Math.hypot(x - (a[0] + ex * t), z - (a[1] + ez * t));
    if (d < bd) { bd = d; bestS = cum[i] + t * Math.sqrt(l2); }
  }
  return fwd ? bestS : road.len - bestS;
}
