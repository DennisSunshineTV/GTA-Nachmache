// Allgemeine Hilfsfunktionen: Mathe, Zufall, Rauschen, räumliche Hash-Tabelle.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, x) => clamp((x - a) / (b - a), 0, 1);
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const sign = (v) => (v < 0 ? -1 : 1);

export function wrapPi(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}
export const angDiff = (a, b) => wrapPi(b - a);

// Gleitende Annäherung (framerate-unabhängig)
export const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));
export const dampAngle = (cur, target, rate, dt) => cur + wrapPi(target - cur) * (1 - Math.exp(-rate * dt));

// ---------- Zufall ----------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1) {
    this.f = mulberry32(seed);
  }
  next() { return this.f(); }
  range(a, b) { return a + (b - a) * this.f(); }
  int(a, b) { return a + Math.floor(this.f() * (b - a + 1)); }
  chance(p) { return this.f() < p; }
  pick(arr) { return arr[Math.floor(this.f() * arr.length)]; }
  sign() { return this.f() < 0.5 ? -1 : 1; }
  gauss() { return (this.f() + this.f() + this.f() + this.f() - 2) * 0.8660254; }
}

export function strSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Ganzzahl-Hash → [0,1)
export function ihash(x, y, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------- Rauschen ----------

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// Value-Noise, Ergebnis in [0,1)
export function noise2(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = ihash(xi, yi, s), b = ihash(xi + 1, yi, s);
  const c = ihash(xi, yi + 1, s), d = ihash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fraktales Rauschen, ca. [0,1]
export function fbm2(x, y, oct = 4, s = 0) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * noise2(x, y, s + i * 17);
    norm += amp;
    x = x * 2.03 + 11.7;
    y = y * 2.03 - 5.3;
    amp *= 0.5;
  }
  return sum / norm;
}

// "Ridged" Rauschen für Felsgrate, [0,1]
export function ridged2(x, y, oct = 4, s = 0) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise2(x, y, s + i * 31) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    x = x * 2.1 + 3.1;
    y = y * 2.1 + 7.9;
    amp *= 0.5;
  }
  return sum / norm;
}

// ---------- Geometrie 2D ----------

export function distPointSeg(px, pz, ax, az, bx, bz, out) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t, qz = az + dz * t;
  if (out) { out.t = t; out.x = qx; out.z = qz; }
  const ex = px - qx, ez = pz - qz;
  return Math.sqrt(ex * ex + ez * ez);
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Catmull-Rom durch Punkte [x,z], liefert dichte Polylinie
export function catmull(pts, perSeg = 8, closed = false, alpha = 0.5) {
  const n = pts.length;
  if (n < 3) return pts.map((p) => [p[0], p[1]]);
  const out = [];
  const get = (i) => {
    if (closed) return pts[((i % n) + n) % n];
    return pts[Math.max(0, Math.min(n - 1, i))];
  };
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const d1 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1e-3, alpha);
    const d2 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1e-3, alpha);
    const d3 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]) || 1e-3, alpha);
    // Barry-Goldman-ähnliche Tangenten (centripetal)
    const t1x = ((p1[0] - p0[0]) / d1 - (p2[0] - p0[0]) / (d1 + d2) + (p2[0] - p1[0]) / d2) * d2;
    const t1z = ((p1[1] - p0[1]) / d1 - (p2[1] - p0[1]) / (d1 + d2) + (p2[1] - p1[1]) / d2) * d2;
    const t2x = ((p2[0] - p1[0]) / d2 - (p3[0] - p1[0]) / (d2 + d3) + (p3[0] - p2[0]) / d3) * d2;
    const t2z = ((p2[1] - p1[1]) / d2 - (p3[1] - p1[1]) / (d2 + d3) + (p3[1] - p2[1]) / d3) * d2;
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push([
        h00 * p1[0] + h10 * t1x + h01 * p2[0] + h11 * t2x,
        h00 * p1[1] + h10 * t1z + h01 * p2[1] + h11 * t2z,
      ]);
    }
  }
  if (!closed) out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}

// Polylinie in gleichmäßigen Abständen neu abtasten
export function resample(pts, step) {
  if (pts.length < 2) return pts.slice();
  const out = [[pts[0][0], pts[0][1]]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let ax = pts[i - 1][0], az = pts[i - 1][1];
    const bx = pts[i][0], bz = pts[i][1];
    let seg = Math.hypot(bx - ax, bz - az);
    while (carry + seg >= step) {
      const t = (step - carry) / seg;
      ax += (bx - ax) * t;
      az += (bz - az) * t;
      out.push([ax, az]);
      seg = Math.hypot(bx - ax, bz - az);
      carry = 0;
    }
    carry += seg;
  }
  const last = pts[pts.length - 1];
  const e = out[out.length - 1];
  if (Math.hypot(last[0] - e[0], last[1] - e[1]) > step * 0.3) out.push([last[0], last[1]]);
  else out[out.length - 1] = [last[0], last[1]];
  return out;
}

export function polyLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

// Douglas-Peucker
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distPointSeg(pts[i][0], pts[i][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// ---------- Räumliche Hash-Tabelle ----------

export class SpatialHash {
  constructor(cell = 64) {
    this.cell = cell;
    this.map = new Map();
    this.stamp = 0;
  }
  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  insert(obj, minx, minz, maxx = minx, maxz = minz) {
    const c = this.cell;
    const x0 = Math.floor(minx / c), x1 = Math.floor(maxx / c);
    const z0 = Math.floor(minz / c), z1 = Math.floor(maxz / c);
    const keys = [];
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this._key(ix, iz);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(obj);
        keys.push(k);
      }
    }
    obj._hk = obj._hk ? obj._hk.concat(keys) : keys;
  }
  remove(obj) {
    if (!obj._hk) return;
    for (const k of obj._hk) {
      const arr = this.map.get(k);
      if (!arr) continue;
      const i = arr.indexOf(obj);
      if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); }
      if (!arr.length) this.map.delete(k);
    }
    obj._hk = null;
  }
  // Ruft fn(obj) einmal pro Objekt im Rechteck auf
  query(minx, minz, maxx, maxz, fn) {
    const c = this.cell;
    const x0 = Math.floor(minx / c), x1 = Math.floor(maxx / c);
    const z0 = Math.floor(minz / c), z1 = Math.floor(maxz / c);
    const st = ++this.stamp;
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.map.get(this._key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const o = arr[i];
          if (o._qs === st) continue;
          o._qs = st;
          fn(o);
        }
      }
    }
  }
  collect(minx, minz, maxx, maxz, out = []) {
    out.length = 0;
    this.query(minx, minz, maxx, maxz, (o) => out.push(o));
    return out;
  }
}

// Kleiner Min-Heap (für A*)
export class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p];
      i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topV = v[0];
    const lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c];
        i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return topV;
  }
}

export const fmtMoney = (n) => '€' + Math.floor(n).toLocaleString('de-DE');
