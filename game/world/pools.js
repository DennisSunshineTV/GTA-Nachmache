// Schwimmbecken (Villen, Hotels, Fincas): Form, Wasserhöhe und Beckenboden. Reine Weltdaten-Hilfen (ohne Three.js),
// gemeinsam genutzt von Physik (Boden, Wasserhöhe, Schwimmen), Darstellung (Becken, Loch im Gelände) und KI.
// Pools sind begehbar „von oben“ nicht mehr: Wer hineinläuft, fällt ins Wasser und schwimmt; am Rand klettert man hinaus.

export const POOL_SHALLOW = 1.15;   // Wassertiefe am flachen Ende (hier kann man stehen)
export const POOL_DEEP = 2.05;      // Wassertiefe am tiefen Ende

// Lokale Koordinaten im Pool (x entlang der Breite w, z entlang der Tiefe d)
export function poolLocal(p, x, z) {
  if (p._c === undefined) { p._c = Math.cos(p.rot); p._s = Math.sin(p.rot); }
  const c = p._c, s = p._s, dx = x - p.x, dz = z - p.z;
  return [c * dx - s * dz, s * dx + c * dz];
}
export function poolWorld(p, lx, lz) {
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [p.x + c * lx + s * lz, p.z - s * lx + c * lz];
}

// Insel in der Mitte (manche Hotelpools): fester Boden
export const islandR = (p) => (p.island ? p.d * 0.19 : 0);

// Form-Test: rechteckig mit runden Ecken (Superellipse), rund/oval; Nierenform wird als Oval geführt
export function shapeValue(p, lx, lz, grow = 0) {
  const hw = p.w / 2 + grow, hd = p.d / 2 + grow;
  if (p.shape === 'rect') return Math.pow(Math.abs(lx) / hw, 6) + Math.pow(Math.abs(lz) / hd, 6);
  return (lx / hw) ** 2 + (lz / hd) ** 2;
}
export function insidePool(p, x, z, grow = 0) {
  // schneller Vorab-Test über den Umkreis
  const dx = x - p.x, dz = z - p.z, R = Math.max(p.w, p.d) / 2 + grow;
  if (dx * dx + dz * dz > R * R * 2.05) return false;
  const [lx, lz] = poolLocal(p, x, z);
  if (shapeValue(p, lx, lz, grow) >= 1) return false;
  const ir = islandR(p);
  return !(ir > 0 && Math.hypot(lx, lz) < ir - grow);
}

// Umriss (Wasserfläche) als Polygon in Weltkoordinaten
export function poolOutline(p, grow = 0, n = 40) {
  const pts = [];
  const hw = p.w / 2 + grow, hd = p.d / 2 + grow;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let lx, lz;
    if (p.shape === 'rect') { const e = 1 / 3; lx = hw * Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), e); lz = hd * Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), e); }
    else { lx = hw * Math.cos(a); lz = hd * Math.sin(a); }
    pts.push(poolWorld(p, lx, lz));
  }
  return pts;
}

// Wasserhöhe des Pools: höchster Geländepunkt am Becken + 10 cm (einmal berechnet und gemerkt)
export function poolSurface(p, hAt) {
  if (p.wy === undefined) {
    let y = -1e9;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7]]) {
      const [x, z] = poolWorld(p, (dx * p.w) / 2, (dz * p.d) / 2);
      y = Math.max(y, hAt(x, z));
    }
    p.wy = y + 0.1;
  }
  return p.wy;
}

// Boden des Beckens: flaches Ende (lokal −x) bis tiefes Ende (+x), dazwischen eine sanfte Schräge
export function poolDepthAt(p, lx) {
  const t = Math.min(1, Math.max(0, (lx / (p.w / 2) + 1) / 2));
  const k = t < 0.35 ? 0 : t > 0.75 ? 1 : (t - 0.35) / 0.4;
  return POOL_SHALLOW + (POOL_DEEP - POOL_SHALLOW) * (k * k * (3 - 2 * k));
}
export function poolFloor(p, x, z, hAt) {
  const [lx] = poolLocal(p, x, z);
  return poolSurface(p, hAt) - poolDepthAt(p, lx);
}
