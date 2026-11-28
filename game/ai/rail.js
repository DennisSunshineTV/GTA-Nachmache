// Geführte Fahrt auf der Fahrbahn: KI-Fahrzeuge folgen ihrer Spur und fahren in weichen Bögen durch Kreuzungen – so
// bleiben sie auf der Straße. Erst ein Stoß (oder eine Explosion) gibt sie an die Fahrphysik frei: v.rail = null.
//
// v.rail = { road, fwd, s (Strecke in Fahrtrichtung), off (Abstand rechts der Mitte), lane (reguläre Spur), offTarget,
//            speed, want (Wunschtempo), next (geplante Abzweigung), curve (laufender Bogen) }
import { armTrim } from '../world/junction.js';
import { clamp, wrapPi } from '../util.js';

export const laneOffset = (r) => (r.lanes >= 4 ? (Math.random() < 0.5 ? 0.14 : 0.37) * r.w : r.lanes >= 2 ? r.w * 0.25 : 0);

export function newRail(road, fwd, s, off, speed) {
  return { road, fwd, s, off, lane: off, offTarget: off, speed, want: speed, next: null, curve: null };
}

// Punkt und Richtung in der Spur. Die Richtung wird über 6 m gemittelt, damit die Spur an Knicken nicht springt
function lanePose(net, road, fwd, s, off) {
  const sp = fwd ? s : road.len - s;
  const a = net.pointAt(road, sp - 3, {}), m = net.pointAt(road, sp, {}), b = net.pointAt(road, sp + 3, {});
  const k = (fwd ? 1 : -1) / (Math.hypot(b.x - a.x, b.z - a.z) || 1);
  const dx = (b.x - a.x) * k, dz = (b.z - a.z) * k;
  return { x: m.x - dz * off, z: m.z + dx * off, dx, dz };
}

// Weicher Bogen (kubische Bézierkurve) von Pose a nach Pose b, mit Streckentabelle
function bend(a, b) {
  const chord = Math.hypot(b.x - a.x, b.z - a.z), cos = a.dx * b.dx + a.dz * b.dz;
  const k = cos < -0.6 ? Math.max(chord * 1.2, 5) : chord * 0.4;      // Wenden holt weiter aus
  const p = [[a.x, a.z], [a.x + a.dx * k, a.z + a.dz * k], [b.x - b.dx * k, b.z - b.dz * k], [b.x, b.z]];
  const pts = [], len = [0];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20, u = 1 - t, w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    pts.push([0, 1].map((c) => w[0] * p[0][c] + w[1] * p[1][c] + w[2] * p[2][c] + w[3] * p[3][c]));
    if (i) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, len, total: len[20], angle: Math.acos(clamp(cos, -1, 1)) };
}

function onBend(c, s) {
  let i = 1;
  while (i < c.len.length - 1 && c.len[i] < s) i++;
  const a = c.pts[i - 1], b = c.pts[i], l = c.len[i] - c.len[i - 1] || 1e-6, t = clamp((s - c.len[i - 1]) / l, 0, 1);
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / l, dz: (b[1] - a[1]) / l };
}

// Platz vor einem Straßenende, auf dem der Bogen läuft: die Kreuzungsfläche plus etwas Anlauf
const turnRoom = (net, road, end) => clamp(armTrim(net, road, end) + 3, Math.min(4, road.len * 0.45), road.len * 0.45);

// Nähert sich das Ende der Straße, wird die Abzweigung gewählt: choose(rail) → { road, fwd } oder null
export function plan(net, rail, choose) {
  if (rail.curve) return;
  let n = rail.next;
  if (n && Math.abs(n.from - rail.off) < 0.25) return;
  if (!n) {
    if (rail.s < rail.road.len - 45) return;
    const e = choose(rail);
    if (!e) return;
    n = { road: e.road, fwd: e.fwd, off: laneOffset(e.road) };
  }
  n.room = Math.min(turnRoom(net, rail.road, rail.fwd ? 'b' : 'a'), Math.max(0, rail.road.len - rail.s));
  n.s1 = turnRoom(net, n.road, n.fwd ? 'a' : 'b');
  n.from = rail.off;
  n.bend = bend(lanePose(net, rail.road, rail.fwd, rail.road.len - n.room, rail.off), lanePose(net, n.road, n.fwd, n.s1, n.off));
  rail.next = n;
}

const enter = (n) => ({ ...n.bend, road: n.road, fwd: n.fwd, s1: n.s1, off: n.off, s: 0 });

// Position in d Metern entlang der geplanten Strecke
export function poseAhead(net, rail, d) {
  const c = rail.curve;
  if (c) {
    const left = c.total - c.s;
    return d <= left ? onBend(c, c.s + d) : lanePose(net, c.road, c.fwd, Math.min(c.road.len, c.s1 + d - left), c.off);
  }
  const n = rail.next;
  if (n) {
    const over = rail.s + d - (rail.road.len - n.room);
    if (over > 0) return over <= n.bend.total ? onBend(n.bend, over) : lanePose(net, n.road, n.fwd, Math.min(n.road.len, n.s1 + over - n.bend.total), n.off);
  }
  return lanePose(net, rail.road, rail.fwd, Math.min(rail.road.len, rail.s + d), rail.off);
}

// Ein Zeitschritt: Tempo angleichen und weiterrücken. Liefert die neue Pose
export function driveRail(net, v, dt) {
  const r = v.rail, T = v.T;
  r.speed += clamp(r.want - r.speed, -T.brake * 0.8 * dt, T.accel * 0.7 * dt);
  if (r.want >= 0) r.speed = Math.max(0, r.speed);   // ein negatives Wunschtempo setzt zurück
  if (!r.curve) r.off += clamp(r.offTarget - r.off, -3 * dt, 3 * dt) * Math.min(1, Math.abs(r.speed) / 2);
  let dist = r.speed * dt;
  if (dist < 0 && !r.curve) r.s = Math.max(0, r.s + dist);
  while (dist > 1e-6) {
    const c = r.curve;
    if (c) {
      const left = c.total - c.s;
      if (dist < left) { c.s += dist; break; }
      dist -= left;
      Object.assign(r, { road: c.road, fwd: c.fwd, s: c.s1, off: c.off, lane: c.off, offTarget: c.off, curve: null });
      continue;
    }
    const n = r.next, start = n ? r.road.len - n.room : r.road.len;
    if (n && r.s + dist >= start) { dist -= Math.max(0, start - r.s); r.curve = enter(n); r.next = null; continue; }
    r.s = Math.min(r.road.len, r.s + dist);
    break;
  }
  return poseAhead(net, r, 0);
}

const bendSpeed = (angle) => (angle < 0.3 ? 24 : angle < 0.9 ? 11 : angle < 2.2 ? 6.5 : 4);

// Höchsttempo wegen Kurven: der Abbiegebogen voraus und die Krümmung der Straße
export function curveLimit(net, rail, brake) {
  const c = rail.curve, n = rail.next;
  let v = 99;
  if (c) v = bendSpeed(c.angle);
  else if (n) {
    const d = Math.max(0, rail.road.len - n.room - rail.s);
    v = Math.hypot(bendSpeed(n.bend.angle), Math.sqrt(brake * 0.7 * d));
  } else if (rail.s > rail.road.len - 6) v = 3;
  const a = poseAhead(net, rail, 2), b = poseAhead(net, rail, 24);
  const turn = Math.abs(wrapPi(Math.atan2(b.dx, b.dz) - Math.atan2(a.dx, a.dz)));
  if (turn > 0.3) v = Math.min(v, Math.max(6.5, 19 - turn * 12));
  return v;
}

// Wenden auf der Straße: in einem Bogen auf die Gegenspur
export function turnAround(net, v) {
  const r = v.rail;
  if (r.curve) return;
  const fwd = !r.fwd, s1 = Math.min(r.road.len, r.road.len - r.s + 6);
  const curve = bend(lanePose(net, r.road, r.fwd, r.s, r.off), lanePose(net, r.road, fwd, s1, r.lane));
  v.rail = newRail(r.road, fwd, s1, r.lane, Math.min(r.speed, 5));
  v.rail.curve = { ...curve, road: r.road, fwd, s1, off: r.lane, s: 0 };
}

// Fahrzeug (wieder) auf die Spur setzen: in einem Bogen vom jetzigen Ort in die nächste Straße einfädeln
export function attachRail(net, v, reach, filter) {
  const nr = net.nearest(v.x, v.z, reach, filter);
  if (!nr || Math.abs(v.y - nr.y) > 3) return false;
  const r = nr.road, at = r.cum[nr.i] + (r.cum[nr.i + 1] - r.cum[nr.i]) * nr.t;
  const p = net.pointAt(r, at, {});
  const hx = Math.sin(v.h), hz = Math.cos(v.h), fwd = hx * p.dx + hz * p.dz >= 0, off = laneOffset(r);
  const s1 = Math.min(r.len, (fwd ? at : r.len - at) + 12);
  v.rail = newRail(r, fwd, s1, off, Math.max(0, v.speed));
  v.rail.curve = { ...bend({ x: v.x, z: v.z, dx: hx, dz: hz }, lanePose(net, r, fwd, s1, off)), road: r, fwd, s1, off, s: 0 };
  return true;
}
