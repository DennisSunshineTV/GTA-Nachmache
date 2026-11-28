// Bushaltestellen (reine Weltdaten): Wartehäuschen auf dem Gehweg breiter Ortsstraßen, je Fahrtrichtung auf der rechten
// Seite, meist paarweise gegenüber. Busse im Verkehr halten dort (ai/buses.js), Fahrgäste warten, steigen ein und aus.
import { nodePadRadius } from './junction.js';

const KINDS = new Set(['avenue', 'street', 'promenade']);
const SPACING = 280;                       // Mindestabstand zweier Haltestellen (m); das Gegenüber zählt nicht
const SH = { w: 3.6, d: 1.5 };             // Grundfläche des Wartehäuschens

const NAMES = ['Plaça Major', 'Mercat', 'Ajuntament', 'Port', 'Platja', 'Sa Riera', 'Es Pinar', 'Son Vida', 'Sant Jaume', 'La Llotja', 'Passeig', 'Estació', 'Hospital', 'Escola', 'Correus', 'Es Molí', 'Can Pere', 'Sa Font', 'Biblioteca', 'Teatre'];

function insideBuilding(ctx, x, z) {
  let hit = false;
  ctx.buildingHash.query(x - 2, z - 2, x + 2, z + 2, (b) => {
    if (hit || b.w === undefined) return;
    const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0), dx = x - b.x, dz = z - b.z;
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    if (Math.abs(lx) < b.w / 2 + 0.4 && Math.abs(lz) < b.d / 2 + 0.4) hit = true;
  });
  return hit;
}

export function placeBusStops(ctx) {
  const net = ctx.net, stops = [];
  const roads = net.roads.filter((r) => r && KINDS.has(r.kind) && !r.noTraffic && !r.hidden && r.sw >= 3 && r.len > 90).sort((a, b) => b.len - a.len);
  let nameI = 0;
  for (const r of roads) {
    const padA = nodePadRadius(net, net.nodes[r.a]) + 22, padB = nodePadRadius(net, net.nodes[r.b]) + 22;
    // zwischen zwei Laternen (die stehen bei 32·k): Mitte 32·k + 16; bei Alleen auch die Palmen (17·k) meiden
    for (let k = 0; 32 * k + 16 < r.len; k++) {
      const s = 32 * k + 16;
      if (s < padA || s > r.len - padB) continue;
      if (r.kind === 'avenue') { const m = s % 17; if (m < 3.5 || m > 13.5) continue; }
      const p = net.pointAt(r, s, {});
      const pair = [];
      for (const fwd of [true, false]) {
        // R: Einheitsvektor zur rechten Straßenseite in Fahrtrichtung (Fahrtrichtung a→b: rechts = (−dz, dx))
        const S = fwd ? 1 : -1, Rx = -p.dz * S, Rz = p.dx * S, Tx = p.dx, Tz = p.dz;
        const off = r.w / 2 + r.sw * 0.58;
        const x = p.x + Rx * off, z = p.z + Rz * off;
        if (stops.some((q) => !pair.includes(q) && Math.hypot(q.x - x, q.z - z) < SPACING)) continue;
        // Grundfläche frei: keine Gebäude, keine andere Straße, kein Wasser
        let ok = true;
        for (const [a, b] of [[-SH.w / 2, -SH.d / 2], [SH.w / 2, -SH.d / 2], [SH.w / 2, SH.d / 2], [-SH.w / 2, SH.d / 2], [0, 0]]) {
          const qx = x + Tx * a + Rx * b, qz = z + Tz * a + Rz * b;
          if (insideBuilding(ctx, qx, qz) || ctx.coast.sdAt(qx, qz) < 2) { ok = false; break; }
          if (net.nearest(qx, qz, 8, (o) => o !== r && !o.hidden && o.kind !== 'deck')) { ok = false; break; }
        }
        if (!ok) continue;
        const stop = {
          id: stops.length, rid: r.id, fwd, s, sRail: fwd ? s : r.len - s, x, z,
          rot: Math.atan2(-Rx, -Rz),                                  // Modell-+z (offene Seite) zeigt zur Fahrbahn
          R: [Rx, Rz], T: [Tx * S, Tz * S],
          stand: { x: x - Rx * 1.0, z: z - Rz * 1.0 },                // Wartende stehen vor dem Häuschen
          bench: { x: x + Rx * 0.35, z: z + Rz * 0.35 },              // Sitzbank hinten im Häuschen
          curb: { x: p.x + Rx * (r.w / 2 - 0.2), z: p.z + Rz * (r.w / 2 - 0.2) },
          name: NAMES[nameI++ % NAMES.length],
        };
        stops.push(stop); pair.push(stop);
        ctx.props.push({ t: 'busstop', x, z, r: stop.rot, s: 1, v: 0 });
      }
    }
  }
  ctx.busStops = stops;
  ctx.stopsByRoad = new Map();
  for (const st of stops) { if (!ctx.stopsByRoad.has(st.rid)) ctx.stopsByRoad.set(st.rid, []); ctx.stopsByRoad.get(st.rid).push(st); }
  return stops.length;
}
