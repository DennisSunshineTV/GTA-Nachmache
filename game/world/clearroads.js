// Freie Fahrt: läuft, wenn alle Straßen liegen. Häuser, die in eine Fahrbahn ragen, werden auf der Straßenseite gekürzt
// oder – wenn zu wenig übrig bliebe – abgerissen; Läden und Clubs ziehen dann in ein Nachbarhaus. Pools, Palmen, Bäume,
// Mauern und Liegen auf der Fahrbahn verschwinden.

const NO_ROAD = new Set(['deck', 'runway', 'taxiway']);          // Strandhaus-Bohlen und Flugbetrieb zählen nicht
const MIN_SIDE = 6, MIN_SHARE = 0.4;                              // kleiner darf ein gekürztes Haus nicht werden
const PROP_GAP = { palm: 0.4, cypress: 0.4, olive: 0.6, bougainvillea: 0.6, lounger: 0.8, parasol: 0.8, wallseg: 0.3, container: 1.2 };
const PROP_LEN = { wallseg: 2.05, container: 6.1 };               // halbe Länge längs der Objektachse

// Abstand, der neben der Straßenmitte frei bleiben muss: Fahrbahn plus ein Streifen für Fußgänger
const clearance = (r) => r.w / 2 + (r.sw > 0 ? 1 : 0.5);

// Punkte der Straßenmitten (alle 0,5 m) in der Nähe eines gedrehten Rechtecks, in dessen Koordinaten: { x, z, c }
function roadPoints(net, o, extra) {
  const cs = Math.cos(o.rot), sn = Math.sin(o.rot), rad = Math.hypot(o.w, o.d) / 2 + 2, out = [];
  net.segHash.query(o.x - rad, o.z - rad, o.x + rad, o.z + rad, (g) => {
    const r = g.r;
    if (NO_ROAD.has(r.kind)) return;
    const a = r.pts[g.i], b = r.pts[g.i + 1], c = extra(r);
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
    for (let k = 0; k <= n; k++) {
      const dx = a[0] + ((b[0] - a[0]) * k) / n - o.x, dz = a[1] + ((b[1] - a[1]) * k) / n - o.z;
      const x = cs * dx - sn * dz, z = sn * dx + cs * dz;
      if (Math.abs(x) < o.w / 2 + c && Math.abs(z) < o.d / 2 + c) out.push({ x, z, c });
    }
  });
  return out;
}

const depth = (p, q) => p.c - Math.hypot(Math.max(q.x0 - p.x, 0, p.x - q.x1), Math.max(q.z0 - p.z, 0, p.z - q.z1));
const area = (q) => (q.x1 - q.x0) * (q.z1 - q.z0);

// Rechteck so weit kürzen, bis kein Straßenpunkt mehr zu nah ist (immer an der Seite, die am wenigsten Fläche kostet)
function trim(rect, pts) {
  let q = rect;
  for (let it = 0; it <= pts.length; it++) {
    let worst = null, d = 0.01;
    for (const p of pts) { const k = depth(p, q); if (k > d) { d = k; worst = p; } }
    if (!worst) return q;
    const cuts = [{ ...q, x1: worst.x - worst.c }, { ...q, x0: worst.x + worst.c }, { ...q, z1: worst.z - worst.c }, { ...q, z0: worst.z + worst.c }]
      .filter((s) => s.x1 - s.x0 >= MIN_SIDE && s.z1 - s.z0 >= MIN_SIDE);
    if (!cuts.length) return null;
    q = cuts.sort((a, b) => area(b) - area(a))[0];
  }
  return null;
}

// Taugt das Haus o als neues Quartier? Es darf in keinem anderen stecken, und vor der Fassade zur Straße (dort setzt
// spots.doorOf den Eingang) muss Platz sein. counts(h): zählt das Haus h noch als Hindernis?
function usable(ctx, o, counts) {
  const near = ctx.buildings.filter((h) => h !== o && counts(h) && Math.hypot(h.x - o.x, h.z - o.z) < 80);
  const inside = (x, z) => near.some((h) => {
    const cs = Math.cos(h.rot), sn = Math.sin(h.rot), dx = x - h.x, dz = z - h.z;
    return Math.abs(cs * dx - sn * dz) < h.w / 2 + 0.2 && Math.abs(sn * dx + cs * dz) < h.d / 2 + 0.2;
  });
  const cs = Math.cos(o.rot), sn = Math.sin(o.rot);
  const world = (lx, lz) => [o.x + cs * lx + sn * lz, o.z - sn * lx + cs * lz];
  for (const i of [-1, -0.5, 0, 0.5, 1]) for (const j of [-1, -0.5, 0, 0.5, 1]) if (inside(...world(i * (o.w / 2 - 0.5), j * (o.d / 2 - 0.5)))) return false;
  const road = ctx.net.nearest(o.x, o.z, 150, (r) => !NO_ROAD.has(r.kind));
  if (!road) return false;
  const doors = [world(0, o.d / 2 + 2.8), world(o.w / 2 + 2.8, 0), world(0, -o.d / 2 - 2.8), world(-o.w / 2 - 2.8, 0)];
  const door = doors.sort((p, q) => Math.hypot(p[0] - road.x, p[1] - road.z) - Math.hypot(q[0] - road.x, q[1] - road.z))[0];
  return !inside(...door) && ctx.hf.h(...door) > 0.3;
}

export function clearRoads(ctx) {
  const { net } = ctx;
  const stats = { trimmed: 0, removed: 0, moved: 0, pools: 0, props: 0 };
  const refs = ctx.pois.filter((p) => p.bid !== undefined).map((p) => [p, ctx.buildings[p.bid]]);   // Orte mit Gebäude
  const needed = new Set(refs.map(([, b]) => b));
  const gone = new Set(), homeless = [];

  // --- Häuser ---
  for (const b of ctx.buildings) {
    if (b.style === 'beach' || b.style === 'service' || b.style === 'resto') continue;   // eigene, eingeebnete Grundstücke
    const pts = roadPoints(net, b, clearance);
    const full = { x0: -b.w / 2, x1: b.w / 2, z0: -b.d / 2, z1: b.d / 2 };
    if (!pts.some((p) => depth(p, full) > 0.01)) continue;
    const q = trim(full, pts);
    if (q && area(q) >= b.w * b.d * MIN_SHARE) {
      const mx = (q.x0 + q.x1) / 2, mz = (q.z0 + q.z1) / 2, cs = Math.cos(b.rot), sn = Math.sin(b.rot);
      b.x += cs * mx + sn * mz; b.z += -sn * mx + cs * mz;
      b.w = q.x1 - q.x0; b.d = q.z1 - q.z0;
      stats.trimmed++;
    } else if (needed.has(b) || b.tag) homeless.push(b);
    else { gone.add(b); stats.removed++; }
  }
  // Läden, Clubs und Missionsgebäude, die nicht stehen bleiben können, ziehen in das nächste freie Nachbarhaus
  for (const b of homeless) {
    const dist = (o) => Math.hypot(o.x - b.x, o.z - b.z);
    const best = ctx.buildings
      .filter((o) => o !== b && !gone.has(o) && !o.tag && !needed.has(o) && ['apt', 'old', 'office', 'shop', 'hotel', 'house'].includes(o.style) && o.w >= 12 && o.d >= 10 && dist(o) < 250)
      .sort((p, q) => dist(p) - dist(q))
      .find((o) => usable(ctx, o, (h) => h !== b && !gone.has(h)));
    if (!best) continue;
    Object.assign(b, { x: best.x, z: best.z, rot: best.rot, w: best.w, d: best.d });
    gone.add(best); stats.moved++;
  }
  // Liste neu nummerieren (Nummer = Position) und die Orte auf ihre Gebäude setzen
  ctx.buildings = ctx.buildings.filter((b) => !gone.has(b));
  ctx.buildings.forEach((b, i) => { b.id = i; });
  for (const [p, b] of refs) { p.bid = b.id; p.x = b.x; p.z = b.z; }

  // --- Pools samt Liegen drumherum ---
  const dry = ctx.pools.filter((o) => roadPoints(net, o, (r) => r.w / 2 + 0.3).some((p) => depth(p, { x0: -o.w / 2, x1: o.w / 2, z0: -o.d / 2, z1: o.d / 2 }) > 0));
  ctx.pools = ctx.pools.filter((o) => !dry.includes(o));
  stats.pools = dry.length;

  // --- Feste Objekte auf der Fahrbahn ---
  const before = ctx.props.length;
  ctx.props = ctx.props.filter((p) => {
    if ((p.t === 'lounger' || p.t === 'parasol') && dry.some((o) => Math.hypot(p.x - o.x, p.z - o.z) < Math.max(o.w, o.d) / 2 + 5)) return false;
    const gap = PROP_GAP[p.t];
    if (gap === undefined) return true;
    const half = PROP_LEN[p.t] || 0, ax = Math.cos(p.r || 0), az = -Math.sin(p.r || 0);
    return !(half ? [-1, -0.5, 0, 0.5, 1] : [0]).some((k) => {
      const x = p.x + ax * half * k, z = p.z + az * half * k;
      let hit = false;
      net.segHash.query(x - 1, z - 1, x + 1, z + 1, (g) => {
        if (hit || NO_ROAD.has(g.r.kind)) return;
        const a = g.r.pts[g.i], b = g.r.pts[g.i + 1], ex = b[0] - a[0], ez = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (z - a[1]) * ez) / (ex * ex + ez * ez || 1)));
        if (Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t) < g.r.w / 2 + gap) hit = true;
      });
      return hit;
    });
  });
  stats.props = before - ctx.props.length;
  return stats;
}
