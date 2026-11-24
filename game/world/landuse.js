// Raster für Landnutzung (Bodenart unter Siedlungen) in 8-m-Zellen.
export const LU = {
  NONE: 0, URBAN: 1, GARDEN: 2, HOTEL: 3, INDUSTRIAL: 4, AIRPORT: 5, HARBOR: 6, PLAZA: 7, FARMYARD: 8, BEACHCLUB: 9, RUNWAY: 10,
};

export class Landuse {
  constructor(world, cell = 8) {
    this.world = world;
    this.cell = cell;
    this.nx = Math.ceil((world.x1 - world.x0) / cell) + 1;
    this.nz = Math.ceil((world.z1 - world.z0) / cell) + 1;
    this.data = new Uint8Array(this.nx * this.nz);
  }

  get(x, z) {
    const i = Math.floor((x - this.world.x0) / this.cell), j = Math.floor((z - this.world.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return 0;
    return this.data[j * this.nx + i];
  }

  // Konvexes Polygon füllen (pts: [[x,z],...])
  fillPoly(pts, code, grow = 0) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const c = this.cell, w = this.world;
    const i0 = Math.max(0, Math.floor((x0 - grow - w.x0) / c)), i1 = Math.min(this.nx - 1, Math.ceil((x1 + grow - w.x0) / c));
    const j0 = Math.max(0, Math.floor((z0 - grow - w.z0) / c)), j1 = Math.min(this.nz - 1, Math.ceil((z1 + grow - w.z0) / c));
    // Orientierung bestimmen
    let area = 0;
    for (let k = 0; k < pts.length; k++) { const p = pts[k], q = pts[(k + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
    const s = area >= 0 ? 1 : -1;
    for (let j = j0; j <= j1; j++) {
      const z = w.z0 + j * c;
      for (let i = i0; i <= i1; i++) {
        const x = w.x0 + i * c;
        let inside = true;
        for (let k = 0; k < pts.length; k++) {
          const p = pts[k], q = pts[(k + 1) % pts.length];
          const cr = ((q[0] - p[0]) * (z - p[1]) - (q[1] - p[1]) * (x - p[0])) * s;
          const el = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          if (cr / el < -grow) { inside = false; break; }
        }
        if (inside) this.data[j * this.nx + i] = code;
      }
    }
  }

  fillCircle(x, z, r, code) {
    const c = this.cell, w = this.world;
    const i0 = Math.max(0, Math.floor((x - r - w.x0) / c)), i1 = Math.min(this.nx - 1, Math.ceil((x + r - w.x0) / c));
    const j0 = Math.max(0, Math.floor((z - r - w.z0) / c)), j1 = Math.min(this.nz - 1, Math.ceil((z + r - w.z0) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = w.x0 + i * c - x, dz = w.z0 + j * c - z;
      if (dx * dx + dz * dz <= r * r) this.data[j * this.nx + i] = code;
    }
  }

  // Gedrehtes Rechteck
  fillRect(cx, cz, w, d, rot, code, grow = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const hw = w / 2, hd = d / 2;
    this.fillPoly([
      [cx + c * -hw - s * -hd, cz + s * -hw + c * -hd],
      [cx + c * hw - s * -hd, cz + s * hw + c * -hd],
      [cx + c * hw - s * hd, cz + s * hw + c * hd],
      [cx + c * -hw - s * hd, cz + s * -hw + c * hd],
    ], code, grow);
  }
}
