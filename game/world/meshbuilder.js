// Sammelt Geometrie (Positionen, Normalen, UVs, Farben) in einfachen Arrays – ohne Three.js.
// Wird später in BufferGeometry umgewandelt.

export class MeshBuilder {
  constructor() {
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = [];
    this.n = 0;
  }

  get empty() { return this.n === 0; }

  vert(x, y, z, nx, ny, nz, u, v, r, g, b) {
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.uv.push(u, v); this.col.push(r, g, b);
    return this.n++;
  }

  // Viereck a,b,c,d (gegen den Uhrzeigersinn von vorn gesehen). uvs = [u0,v0,u1,v1] für a..c; d ergibt sich.
  quad(a, b, c, d, nx, ny, nz, u0, v0, u1, v1, r, g, bl) {
    const i = this.n;
    this.vert(a[0], a[1], a[2], nx, ny, nz, u0, v0, r, g, bl);
    this.vert(b[0], b[1], b[2], nx, ny, nz, u1, v0, r, g, bl);
    this.vert(c[0], c[1], c[2], nx, ny, nz, u1, v1, r, g, bl);
    this.vert(d[0], d[1], d[2], nx, ny, nz, u0, v1, r, g, bl);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  // Dreieck mit automatischer Normale
  tri(a, b, c, r, g, bl, uva = [0, 0], uvb = [1, 0], uvc = [0.5, 1]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) { nx = 0; ny = 1; nz = 0; } else { nx /= l; ny /= l; nz /= l; }   // entartetes Dreieck: nie Normale 0
    const i = this.n;
    this.vert(a[0], a[1], a[2], nx, ny, nz, uva[0], uva[1], r, g, bl);
    this.vert(b[0], b[1], b[2], nx, ny, nz, uvb[0], uvb[1], r, g, bl);
    this.vert(c[0], c[1], c[2], nx, ny, nz, uvc[0], uvc[1], r, g, bl);
    this.idx.push(i, i + 1, i + 2);
  }

  // Quad mit automatischer Normale (Reihenfolge entscheidet über die Vorderseite)
  quadAuto(a, b, c, d, r, g, bl, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    // Normale aus den Diagonalen: bleibt gültig, auch wenn zwei Eckpunkte zusammenfallen (Dreieck als Quad,
    // z. B. Walmdach über quadratischem Grundriss). Eine Normale der Länge 0 würde im Shader NaN erzeugen
    // und den Bloom zu großen schwarzen Rechtecken verschmieren.
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
    const vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    let l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) { nx = 0; ny = 1; nz = 0; l = 1; }
    this.quad(a, b, c, d, nx / l, ny / l, nz / l, u0, v0, u1, v1, r, g, bl);
  }

  // Quad, dessen Normale automatisch nach oben (y>0) gedreht wird
  quadUp(a, b, c, d, r, g, bl, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const ny = uz * vx - ux * vz;
    if (ny >= 0) this.quadAuto(a, b, c, d, r, g, bl, u0, v0, u1, v1);
    else this.quadAuto(d, c, b, a, r, g, bl, u0, v1, u1, v0);
  }

  triUp(a, b, c, r, g, bl, uva, uvb, uvc) {
    const ux = b[0] - a[0], uz = b[2] - a[2], vx = c[0] - a[0], vz = c[2] - a[2];
    if (uz * vx - ux * vz >= 0) this.tri(a, b, c, r, g, bl, uva, uvb, uvc);
    else this.tri(a, c, b, r, g, bl, uva, uvc, uvb);
  }

  // Dreieck, dessen Normale in Richtung (hx,hy,hz) zeigt
  triFace(a, b, c, hx, hy, hz, r, g, bl) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * hx + ny * hy + nz * hz >= 0) this.tri(a, b, c, r, g, bl);
    else this.tri(a, c, b, r, g, bl);
  }

  // Gedrehte Box (Drehung um Y). Mittelpunkt am Boden: (cx, y0, cz). Seiten bekommen UV 0..1
  box(cx, y0, cz, sx, sy, sz, rot, r, g, b, opts = {}) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const hx = sx / 2, hz = sz / 2;
    const P = (lx, y, lz) => [cx + c * lx + s * lz, y, cz - s * lx + c * lz];
    const y1 = y0 + sy;
    const p000 = P(-hx, y0, -hz), p100 = P(hx, y0, -hz), p101 = P(hx, y0, hz), p001 = P(-hx, y0, hz);
    const p010 = P(-hx, y1, -hz), p110 = P(hx, y1, -hz), p111 = P(hx, y1, hz), p011 = P(-hx, y1, hz);
    const shade = opts.shade ?? true;
    const k = (f) => (shade ? f : 1);
    // oben
    if (!opts.noTop) this.quadAuto(p011, p111, p110, p010, r * k(1), g * k(1), b * k(1));
    // Seiten (Normalen automatisch)
    const nxz = (lx, lz) => [c * lx + s * lz, -s * lx + c * lz];
    const faces = [
      [p001, p101, p111, p011, 0, 1, k(0.9)], // +z
      [p100, p000, p010, p110, 0, -1, k(0.82)], // -z
      [p101, p100, p110, p111, 1, 0, k(0.95)], // +x
      [p000, p001, p011, p010, -1, 0, k(0.86)], // -x
    ];
    for (const [a, bb, cc, d, lx, lz, f] of faces) {
      const [nx, nz] = nxz(lx, lz);
      this.quad(a, bb, cc, d, nx, 0, nz, 0, 0, 1, 1, r * f, g * f, b * f);
    }
    if (!opts.noBottom) this.quadAuto(p000, p100, p101, p001, r * 0.6, g * 0.6, b * 0.6);
  }

  // Zylinder (Y-Achse), segs Seiten
  cylinder(cx, y0, cz, r0, r1, h, segs, r, g, b, capTop = true) {
    const i0 = this.n;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const slope = (r0 - r1) / (h || 1);
      const nl = Math.hypot(1, slope);
      this.vert(cx + ca * r0, y0, cz + sa * r0, ca / nl, slope / nl, sa / nl, i / segs, 0, r, g, b);
      this.vert(cx + ca * r1, y0 + h, cz + sa * r1, ca / nl, slope / nl, sa / nl, i / segs, 1, r, g, b);
    }
    for (let i = 0; i < segs; i++) {
      const a = i0 + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (capTop && r1 > 0) {
      const c0 = this.vert(cx, y0 + h, cz, 0, 1, 0, 0.5, 0.5, r, g, b);
      const j0 = this.n;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        this.vert(cx + Math.cos(a) * r1, y0 + h, cz + Math.sin(a) * r1, 0, 1, 0, 0.5, 0.5, r * 0.95, g * 0.95, b * 0.95);
      }
      for (let i = 0; i < segs; i++) this.idx.push(c0, j0 + i + 1, j0 + i);
    }
  }

  // Satteldach über Rechteck (Mittelpunkt, Größe w×d, Drehung), First entlang der längeren Seite
  gable(cx, y, cz, w, d, rot, rise, over, rr, rg, rb, wr, wg, wb, endMB = this) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, ly, lz) => [cx + c * lx + s * lz, ly, cz - s * lx + c * lz];
    const alongX = w >= d;
    const hw = w / 2 + over, hd = d / 2 + over;
    const gw = w / 2, gd = d / 2; // Giebelflächen sitzen auf der Wandkante
    if (alongX) {
      const e0 = P(-hw, y, -hd), e1 = P(hw, y, -hd), e2 = P(hw, y, hd), e3 = P(-hw, y, hd);
      const r0 = P(-hw, y + rise, 0), r1 = P(hw, y + rise, 0);
      this.quadUp(e0, e1, r1, r0, rr, rg, rb, 0, 0, w * 0.25, rise * 0.5);
      this.quadUp(e2, e3, r0, r1, rr, rg, rb, 0, 0, w * 0.25, rise * 0.5);
      const t = rise * (1 - over / hd);
      endMB.triFace(P(gw, y, -gd), P(gw, y, gd), P(gw, y + t, 0), c, 0, -s, wr, wg, wb);
      endMB.triFace(P(-gw, y, gd), P(-gw, y, -gd), P(-gw, y + t, 0), -c, 0, s, wr, wg, wb);
    } else {
      const e0 = P(-hw, y, -hd), e1 = P(hw, y, -hd), e2 = P(hw, y, hd), e3 = P(-hw, y, hd);
      const r0 = P(0, y + rise, -hd), r1 = P(0, y + rise, hd);
      this.quadUp(e1, e2, r1, r0, rr, rg, rb, 0, 0, d * 0.25, rise * 0.5);
      this.quadUp(e3, e0, r0, r1, rr, rg, rb, 0, 0, d * 0.25, rise * 0.5);
      const t = rise * (1 - over / hw);
      endMB.triFace(P(-gw, y, -gd), P(gw, y, -gd), P(0, y + t, -gd), -s, 0, -c, wr, wg, wb);
      endMB.triFace(P(gw, y, gd), P(-gw, y, gd), P(0, y + t, gd), s, 0, c, wr, wg, wb);
    }
  }

  // Walmdach (4 Flächen)
  hip(cx, y, cz, w, d, rot, rise, over, rr, rg, rb) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, ly, lz) => [cx + c * lx + s * lz, ly, cz - s * lx + c * lz];
    const hw = w / 2 + over, hd = d / 2 + over;
    const long = Math.max(0, Math.abs(w - d) / 2 - over * 0.2);
    const top = y + rise;
    const e = [P(-hw, y, -hd), P(hw, y, -hd), P(hw, y, hd), P(-hw, y, hd)];
    let a, b;
    if (w >= d) { a = P(-long, top, 0); b = P(long, top, 0); } else { a = P(0, top, -long); b = P(0, top, long); }
    this.quadUp(e[0], e[1], b, a, rr, rg, rb, 0, 0, 3, 2);
    this.quadUp(e[2], e[3], a, b, rr, rg, rb, 0, 0, 3, 2);
    this.triUp(e[1], e[2], b, rr * 0.92, rg * 0.92, rb * 0.92);
    this.triUp(e[3], e[0], a, rr * 0.92, rg * 0.92, rb * 0.92);
  }

  // Kegel/Pyramide-ähnlich: Zylinder mit r1=0
  cone(cx, y0, cz, r0, h, segs, r, g, b) { this.cylinder(cx, y0, cz, r0, 0.001, h, segs, r, g, b, false); }

  merge(other) {
    const off = this.n;
    for (let i = 0; i < other.pos.length; i++) this.pos.push(other.pos[i]);
    for (let i = 0; i < other.nor.length; i++) this.nor.push(other.nor[i]);
    for (let i = 0; i < other.uv.length; i++) this.uv.push(other.uv[i]);
    for (let i = 0; i < other.col.length; i++) this.col.push(other.col[i]);
    for (let i = 0; i < other.idx.length; i++) this.idx.push(other.idx[i] + off);
    this.n += other.n;
  }
}
