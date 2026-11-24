// Begehbare Orte: Eingänge vor Gebäuden und Punkte außerhalb von Gebäudegrundrissen (reine Weltdaten, ohne Rendering).
// Gebäude sind massiv (nicht betretbar) – Läden und Missionsziele müssen deshalb auf dem Gehweg davor liegen.

const NL = [[0, 1], [1, 0], [0, -1], [-1, 0]];   // lokale Fassadennormalen (wie in detail.js front())

// Liegt (x,z) mit Abstand r im Grundriss eines Gebäudes (außer `skip`)?
function blockedBy(ctx, x, z, r, skip = null) {
  let hit = null;
  ctx.buildingHash.query(x - 40, z - 40, x + 40, z + 40, (b) => {
    if (hit || b === skip || b.w === undefined || b.rot === undefined || b.top !== undefined) return;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const dx = x - b.x, dz = z - b.z;
    const lx = c * dx - s * dz, lz = s * dx + c * dz;
    if (Math.abs(lx) < b.w / 2 + r && Math.abs(lz) < b.d / 2 + r) hit = b;
  });
  return hit;
}

// Schiebt einen Punkt aus allen Gebäudegrundrissen heraus (Abstand r zur Wand)
export function freeSpot(ctx, x, z, r = 2.4) {
  for (let it = 0; it < 8; it++) {
    let moved = false;
    ctx.buildingHash.query(x - 40, z - 40, x + 40, z + 40, (b) => {
      if (b.w === undefined || b.rot === undefined || b.top !== undefined) return;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const dx = x - b.x, dz = z - b.z;
      const lx = c * dx - s * dz, lz = s * dx + c * dz;
      const px = Math.max(-b.w / 2, Math.min(b.w / 2, lx)), pz = Math.max(-b.d / 2, Math.min(b.d / 2, lz));
      const ex = lx - px, ez = lz - pz, d2 = ex * ex + ez * ez;
      if (d2 >= r * r) return;
      let nx, nz, pen;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); nx = ex / d; nz = ez / d; pen = r - d; }
      else { const ox = b.w / 2 - Math.abs(lx), oz = b.d / 2 - Math.abs(lz); if (ox < oz) { nx = Math.sign(lx) || 1; nz = 0; pen = ox + r; } else { nx = 0; nz = Math.sign(lz) || 1; pen = oz + r; } }
      x += (c * nx + s * nz) * pen; z += (-s * nx + c * nz) * pen;
      moved = true;
    });
    if (!moved) break;
  }
  return { x, z };
}

// Eingang eines Gebäudes: Punkt vor der Fassade, die zur nächsten Straße zeigt (dieselbe Seite wie Schild/Ladenfront).
// Setzt b.front, damit Rendering und Eingang übereinstimmen.
export function doorOf(ctx, b) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const nr = ctx.net.nearest(b.x, b.z, 150);
  const dx = nr ? nr.x - b.x : 0, dz = nr ? nr.z - b.z : 1;
  const L = Math.hypot(dx, dz) || 1;
  const order = [0, 1, 2, 3].map((q) => {
    const nx = c * NL[q][0] + s * NL[q][1], nz = -s * NL[q][0] + c * NL[q][1];
    return { q, nx, nz, score: (nx * dx + nz * dz) / L };
  }).sort((a, b2) => b2.score - a.score);
  for (let i = 0; i < order.length; i++) {
    const { q, nx, nz } = order[i];
    const half = q % 2 === 0 ? b.d / 2 : b.w / 2;
    const x = b.x + nx * (half + 2.8), z = b.z + nz * (half + 2.8);
    const ok = !blockedBy(ctx, x, z, 0.9, b) && ctx.hf.h(x, z) > 0.3;
    if (ok || i === order.length - 1) {
      if (i === 0) b.front = q;
      return { x, z, q };
    }
  }
  return { x: b.x, z: b.z, q: 0 };
}
