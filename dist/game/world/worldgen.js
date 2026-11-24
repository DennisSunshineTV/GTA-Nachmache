// Erzeugt alle Weltdaten (ohne Rendering). Läuft asynchron in Phasen, damit die Ladeanzeige lebt.
import { ISLANDS, WORLD, RIDGES, WETLANDS, LINKS } from './map.js';
import { Coast } from './coast.js';
import { HeightField } from './heightfield.js';
import { Landuse } from './landuse.js';
import { RoadNet, routeLinks } from './roadnet.js';
import { SignList } from './signs.js';
import { generateSettlements } from './settlements.js';
import { generateRural } from './rural.js';
import { SpatialHash } from '../util.js';
import { doorOf } from './spots.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

export async function buildWorldData(progress = () => {}) {
  const t0 = performance.now();
  const log = (m) => console.log(`[Welt ${(performance.now() - t0).toFixed(0)} ms] ${m}`);
  const ctx = { world: WORLD };
  progress(0.02, 'Küsten und Inseln formen …'); await tick();
  ctx.coast = new Coast(ISLANDS, WORLD, 10);
  log('Küste');
  progress(0.12, 'Gebirge und Täler …'); await tick();
  ctx.hf = new HeightField(ctx.coast, { ridges: RIDGES, wetlands: WETLANDS });
  ctx.landuse = new Landuse(WORLD, 8);
  ctx.net = new RoadNet(ctx.hf, ctx.coast);
  ctx.signs = new SignList();
  ctx.settlementsByKind = {};
  progress(0.2, 'Städte und Dörfer bauen …'); await tick();
  generateSettlements(ctx);
  log(`Siedlungen: ${ctx.buildings.length} Gebäude, ${ctx.net.roads.length} Straßen`);
  progress(0.45, 'Straßen über die Insel legen …'); await tick();
  const created = routeLinks(ctx.net, LINKS, { hf: ctx.hf, coast: ctx.coast, world: WORLD, settlements: ctx.settlements });
  log(`Verbindungsstraßen: ${created.length} Abschnitte aus ${created.paths.length}/${LINKS.length} Routen (${(created.paths.reduce((a, p) => a + p.cells.length, 0) * 30 / 1000).toFixed(0)} km Zellpfad)`);
  progress(0.62, 'Straßenprofile berechnen …'); await tick();
  ctx.net.finalize();
  log(`Straßennetz: ${(ctx.net.totalLength / 1000).toFixed(0)} km`);
  progress(0.72, 'Fincas, Felder, Wälder …'); await tick();
  generateRural(ctx);
  log(`Fincas/Props: ${ctx.props.length} Props`);

  // Gebäude-Basishöhen (nach Straßeneinschnitt)
  progress(0.82, 'Gebäude platzieren …'); await tick();
  const hf = ctx.hf;
  ctx.buildingHash = new SpatialHash(128);
  for (const b of ctx.buildings) {
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    let lo = Infinity, hi = -Infinity;
    for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
      const y = hf.h(b.x + c * lx * b.w / 2 + s * lz * b.d / 2, b.z - s * lx * b.w / 2 + c * lz * b.d / 2);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    b.y0 = lo;          // Wandunterkante: tiefster Punkt
    b.base = Math.max(lo, hi - 4); // Bodenplatte: nicht tiefer als 4 m unter dem höchsten Punkt
    b.base = Math.max(b.base, lo);
    b.ground = (lo + hi) / 2;
    b.fnd = Math.max(0, hi - lo) + 0.6; // Fundamenttiefe, um Lücken zu schließen
    b.rad = Math.hypot(b.w, b.d) / 2;
    ctx.buildingHash.insert(b, b.x - b.rad, b.z - b.rad, b.x + b.rad, b.z + b.rad);
  }
  for (const pl of ctx.platforms) {
    pl.rad = Math.hypot(pl.w, pl.d) / 2;
    ctx.buildingHash.insert(pl, pl.x - pl.rad, pl.z - pl.rad, pl.x + pl.rad, pl.z + pl.rad);
  }
  // Eingänge: Läden/Missionsziele (Waffenladen, Bank, Klinik, Club …) liegen vor der Tür, denn Gebäude sind nicht begehbar
  let doors = 0;
  for (const p of ctx.pois) {
    if (p.bid === undefined) continue;
    const b = ctx.buildings[p.bid];
    if (!b) continue;
    const d = doorOf(ctx, b);
    p.bx = p.x; p.bz = p.z; p.x = d.x; p.z = d.z; p.door = true; doors++;
  }
  log(`Gebäudehöhen, ${doors} Eingänge`);
  progress(0.9, 'Welt fertig'); await tick();
  ctx.generatedMs = performance.now() - t0;
  return ctx;
}
