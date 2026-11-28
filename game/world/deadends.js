// Keine Straße endet im Nichts. Läuft nach dem Straßenbau und vor den Höhenprofilen: Jedes offene Ende (Knoten mit nur
// einer Straße) wird mit einer anderen Straße verbunden (Querstraße oder Einmündung). Wo das nicht geht (Meer, Steilhang,
// Gebäude), wird der Stummel bis zur letzten Kreuzung entfernt. Ausgenommen: Piste und Rollwege, die Holzbohlen am
// Strandhaus und die Feldwege (sie führen zu den Fincas und entstehen erst später).
import { SpatialHash, clamp } from '../util.js';
import { ROAD_KINDS } from './roadnet.js';
import { LU } from './landuse.js';

const OPEN_OK = new Set(['runway', 'taxiway', 'deck', 'track']);
const RADII = [70, 130, 220, 340];            // Anschlüsse zuerst in der Nähe suchen, dann weiter weg
const COS_BACK = Math.cos((55 * Math.PI) / 180);   // der Anschluss darf nicht auf den Stummel zurücklaufen
const COS_ARM = Math.cos((38 * Math.PI) / 180);    // Mindestwinkel zu den Straßen am Ziel

const unit = (ax, az, bx, bz) => { const l = Math.hypot(bx - ax, bz - az) || 1; return [(bx - ax) / l, (bz - az) / l]; };
function nearestOnSeg(x, z, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const t = clamp(((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1), 0, 1);
  const qx = a[0] + ex * t, qz = a[1] + ez * t;
  return { x: qx, z: qz, t, d: Math.hypot(x - qx, z - qz) };
}
// Schnittpunkt der Strecken p-q und a-b (oder null)
function crossing(p, q, a, b) {
  const rx = q[0] - p[0], rz = q[1] - p[1], sx = b[0] - a[0], sz = b[1] - a[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a[0] - p[0]) * sz - (a[1] - p[1]) * sx) / den, u = ((a[0] - p[0]) * rz - (a[1] - p[1]) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + rx * t, p[1] + rz * t] : null;
}

export function closeDeadEnds(ctx) {
  const { net, coast, hf, landuse } = ctx;
  const gone = new Set();                     // entfernte bzw. geteilte Straßen
  const segs = new SpatialHash(48), solids = new SpatialHash(48);
  const addSegs = (r) => {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      segs.insert({ r, i }, Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]));
    }
  };
  for (const r of net.roads) addSegs(r);
  for (const o of [...ctx.buildings, ...ctx.pools]) {
    const rad = Math.hypot(o.w, o.d) / 2;
    solids.insert({ x: o.x, z: o.z, hw: o.w / 2, hd: o.d / 2, c: Math.cos(o.rot), s: Math.sin(o.rot) }, o.x - rad, o.z - rad, o.x + rad, o.z + rad);
  }

  const nearSolid = (x, z, gap) => {
    let hit = false;
    solids.query(x - gap, z - gap, x + gap, z + gap, (o) => {
      if (hit) return;
      const dx = x - o.x, dz = z - o.z, lx = o.c * dx - o.s * dz, lz = o.s * dx + o.c * dz;
      if (Math.hypot(Math.max(0, Math.abs(lx) - o.hw), Math.max(0, Math.abs(lz) - o.hd)) < gap) hit = true;
    });
    return hit;
  };

  // Richtungen der Straßen, die an einem Knoten hängen (vom Knoten weg)
  const armsAt = (id) => net.nodes[id].roads.map((rid) => {
    const r = net.roads[rid], p = r.a === id ? r.pts[1] : r.pts[r.pts.length - 2], n = net.nodes[id];
    return unit(n.x, n.z, p[0], p[1]);
  });

  // Passt eine Verbindung der Art "kind" entlang pts ins Gelände?
  function fits(pts, kind, arms) {
    const k = ROAD_KINDS[kind], full = k.w / 2 + k.sw;
    const A = pts[0], B = pts[pts.length - 1];
    const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    const L = lens.reduce((a, b) => a + b, 0);
    if (L < 6 || Math.abs(hf.base(B[0], B[1]) - hf.base(A[0], A[1])) / L > 0.14) return false;
    const end = unit(B[0], B[1], pts[pts.length - 2][0], pts[pts.length - 2][1]);
    if (arms.some((u) => u[0] * end[0] + u[1] * end[1] > COS_ARM)) return false;
    const clear = full + 12;                     // nahe den Anschlussknoten liegen Straßen naturgemäß dicht
    let s0 = 0;
    for (let i = 0; i < lens.length; i++) {
      const p = pts[i], q = pts[i + 1];
      // keine Querung anderer Straßen ohne Kreuzung
      let bad = false;
      segs.query(Math.min(p[0], q[0]) - 1, Math.min(p[1], q[1]) - 1, Math.max(p[0], q[0]) + 1, Math.max(p[1], q[1]) + 1, (g) => {
        if (bad || gone.has(g.r)) return;
        const x = crossing(p, q, g.r.pts[g.i], g.r.pts[g.i + 1]);
        if (x && Math.hypot(x[0] - A[0], x[1] - A[1]) > 3 && Math.hypot(x[0] - B[0], x[1] - B[1]) > 3) bad = true;
      });
      if (bad) return false;
      for (let s = 0; s < lens[i]; s += 2.5) {
        const t = s / (lens[i] || 1), x = p[0] + (q[0] - p[0]) * t, z = p[1] + (q[1] - p[1]) * t, at = s0 + s;
        if (coast.sdAt(x, z) < k.w / 2 + 3 || hf.baseSlope(x, z, 8) > 0.34) return false;
        const lu = landuse.get(x, z);
        if (lu === LU.AIRPORT || lu === LU.RUNWAY) return false;
        if (hf.wet.length) { const w = hf.wetMask(x, z); if (w && w.m > 0.05) return false; }
        if (nearSolid(x, z, full + 0.2)) return false;
        if (at > clear && at < L - clear) {
          // nicht dicht neben einer anderen Straße herlaufen
          segs.query(x - 24, z - 24, x + 24, z + 24, (g) => {
            if (!bad && !gone.has(g.r) && nearestOnSeg(x, z, g.r.pts[g.i], g.r.pts[g.i + 1]).d < full + (g.r.w / 2 + g.r.sw) * 0.75) bad = true;
          });
          if (bad) return false;
        }
      }
      s0 += lens[i];
    }
    return true;
  }

  // Straße an einem Punkt im Segment i teilen → neuer Knoten (für Einmündungen)
  function split(r, i, x, z) {
    const id = net.addNode(x, z, 0.5);
    drop(r);
    const opts = { w: r.w, sw: r.sw, name: r.name, urban: r.urban, flat: r.flat, oneway: r.oneway, noTraffic: r.noTraffic };
    for (const [pts, a, b] of [[[...r.pts.slice(0, i + 1), [x, z]], r.a, id], [[[x, z], ...r.pts.slice(i + 1)], id, r.b]]) {
      const half = net.addRoad(r.kind, pts, a, b, opts);
      if (half) addSegs(half);
    }
    return id;
  }

  function drop(r) {
    gone.add(r);
    for (const id of [r.a, r.b]) { const list = net.nodes[id].roads, k = list.indexOf(r.id); if (k >= 0) list.splice(k, 1); }
  }

  // Offenes Ende n mit dem besten erreichbaren Ziel im Umkreis maxD verbinden
  function link(n, maxD) {
    const r = net.roads[n.roads[0]];
    const other = r.a === n.id ? r.b : r.a;
    const prev = r.a === n.id ? r.pts[1] : r.pts[r.pts.length - 2];
    const out = unit(prev[0], prev[1], n.x, n.z);     // Verlängerung des Stummels
    const cands = [];
    const add = (x, z, extra, weight) => {
      const d = Math.hypot(x - n.x, z - n.z);
      if (d < 6 || d > maxD) return;
      const dir = unit(n.x, n.z, x, z), cos = out[0] * dir[0] + out[1] * dir[1];
      if (-cos > COS_BACK) return;
      const bend = cos >= 0.9 ? 0 : cos >= -0.2 ? (0.9 - cos) * 0.35 : 1.2;
      cands.push({ x, z, d, cos, score: d * (1 + bend) * weight, ...extra });
    };
    net.nodeHash.query(n.x - maxD, n.z - maxD, n.x + maxD, n.z + maxD, (t) => {
      if (t.id === n.id || t.id === other || !t.roads.length || t.roads.some((id) => OPEN_OK.has(net.roads[id].kind))) return;
      add(t.x, t.z, { node: t.id }, t.roads.length === 1 ? 0.75 : 1);
    });
    const onRoad = new Map();                    // je Straße nur die nächste Stelle
    segs.query(n.x - maxD, n.z - maxD, n.x + maxD, n.z + maxD, (g) => {
      if (gone.has(g.r) || g.r === r || OPEN_OK.has(g.r.kind)) return;
      const q = nearestOnSeg(n.x, n.z, g.r.pts[g.i], g.r.pts[g.i + 1]);
      if (!onRoad.has(g.r) || q.d < onRoad.get(g.r).d) onRoad.set(g.r, { ...q, i: g.i });
    });
    for (const [road, q] of onRoad) {
      const ends = [net.nodes[road.a], net.nodes[road.b]];
      if (ends.every((e) => Math.hypot(q.x - e.x, q.z - e.z) > 14)) add(q.x, q.z, { road, i: q.i }, 1.15);
    }
    cands.sort((a, b) => a.score - b.score);

    const wanted = r.kind === 'promenade' || r.kind === 'quay' ? 'street' : r.kind === 'highway' ? 'main' : r.kind;
    const kinds = wanted === 'street' || wanted === 'avenue' ? [wanted, 'alley'] : [wanted];
    for (const c of cands.slice(0, 40)) {
      const straight = [[n.x, n.z], [c.x, c.z]];
      const shapes = [straight];
      if (c.cos < 0.9 && c.cos > 0) {
        // sanfter Bogen, der den Stummel zuerst weiterführt
        const cx = n.x + out[0] * c.d * 0.45, cz = n.z + out[1] * c.d * 0.45, curve = [];
        for (let k = 0; k <= 8; k++) { const t = k / 8, u = 1 - t; curve.push([u * u * n.x + 2 * u * t * cx + t * t * c.x, u * u * n.z + 2 * u * t * cz + t * t * c.z]); }
        shapes.unshift(curve);
      }
      let arms;
      if (c.road) { const a = c.road.pts[c.i], b = c.road.pts[c.i + 1]; arms = [unit(a[0], a[1], b[0], b[1]), unit(b[0], b[1], a[0], a[1])]; } else arms = armsAt(c.node);
      for (const kind of kinds) {
        for (const pts of shapes) {
          const first = unit(n.x, n.z, pts[1][0], pts[1][1]);
          if (-(out[0] * first[0] + out[1] * first[1]) > COS_BACK || !fits(pts, kind, arms)) continue;
          const to = c.road ? split(c.road, c.i, c.x, c.z) : c.node;
          const road = net.addRoad(kind, pts, n.id, to, { urban: r.urban, name: r.name });
          if (!road) return false;
          addSegs(road);
          return true;
        }
      }
    }
    return false;
  }

  const stats = { connected: 0, removed: 0, removedKm: 0 };
  const isOpen = (n) => n.roads.length === 1 && !OPEN_OK.has(net.roads[n.roads[0]].kind);
  for (let guard = 0; guard < 300; guard++) {
    const open = net.nodes.filter(isOpen);
    if (!open.length) break;
    let linked = 0;
    for (const maxD of RADII) for (const n of open) if (isOpen(n) && link(n, maxD)) linked++;
    stats.connected += linked;
    if (linked) continue;
    // nichts mehr anschließbar: Stummel entfernen (dadurch entstehende Enden kommen in der nächsten Runde dran)
    for (const n of open) {
      if (!isOpen(n)) continue;
      const r = net.roads[n.roads[0]];
      stats.removed++; stats.removedKm += r.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1]), 0) / 1000;
      drop(r);
    }
  }
  compact(net, gone);
  return stats;
}

// Entfernte Straßen aus der Liste nehmen und die Nummern neu vergeben (vor finalize, danach hängt nichts daran)
function compact(net, gone) {
  const keep = net.roads.filter((r) => !gone.has(r));
  const newId = new Map(keep.map((r, i) => [r.id, i]));
  for (const n of net.nodes) n.roads = n.roads.map((id) => newId.get(id)).filter((id) => id !== undefined);
  keep.forEach((r, i) => { r.id = i; });
  net.roads = keep;
}
