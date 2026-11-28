// Ampeln an Kreuzungen in den Orten (reine Weltdaten, ohne Three.js). Jede Ampelkreuzung hat zwei Phasengruppen: die
// gegenüberliegenden Arme schalten gemeinsam. Für jeden Arm gibt es einen Mast rechts vor der Kreuzung (aus Sicht der
// ankommenden Fahrzeuge) und eine Haltelinie, an der der Verkehr bei Rot wartet.
import { armsOf, armPoint, armTrim } from './junction.js';

const LIGHT_KINDS = new Set(['avenue', 'street', 'main']);
const MAJOR = new Set(['avenue', 'main']);
const SPACING = 90;           // Mindestabstand zweier Ampelkreuzungen (m)

// Phasen (Sekunden): Gruppe 0 grün → gelb → alle rot → Gruppe 1 rot-gelb → grün → gelb → alle rot → Gruppe 0 rot-gelb
export const PHASES = { g0: 14, y: 3, red: 1.5, ry: 1, g1: 11 };
export const CYCLE = PHASES.g0 + PHASES.y + PHASES.red + PHASES.ry + PHASES.g1 + PHASES.y + PHASES.red + PHASES.ry;

// Zustand einer Gruppe zur Zeit t: 'g' grün, 'y' gelb, 'r' rot, 'ry' rot-gelb
export function lightState(L, grp, t) {
  let k = ((t + L.offset) % CYCLE + CYCLE) % CYCLE;
  const P = PHASES;
  // Ablauf aus Sicht der Gruppe 0; Gruppe 1 ist um die halbe Folge versetzt
  const seq0 = [['g', P.g0], ['y', P.y], ['r', P.red + P.ry + P.g1 + P.y + P.red], ['ry', P.ry]];
  const seq1 = [['r', P.g0 + P.y + P.red], ['ry', P.ry], ['g', P.g1], ['y', P.y], ['r', P.red + P.ry]];
  for (const [st, d] of grp ? seq1 : seq0) { if (k < d) return st; k -= d; }
  return 'r';
}

export function placeTrafficLights(ctx) {
  const net = ctx.net, lights = [];
  const taken = [];
  // Kandidaten: wichtige Kreuzungen zuerst (Alleen/Hauptstraßen, viele Arme)
  const cands = [];
  for (const node of net.nodes) {
    if (node.roads.length < 3) continue;
    const arms = armsOf(net, node).filter((a) => !a.r.noTraffic && !a.r.hidden);
    if (arms.length < 3 || arms.length > 5) continue;
    if (!arms.every((a) => LIGHT_KINDS.has(a.r.kind))) continue;
    const major = arms.filter((a) => MAJOR.has(a.r.kind)).length;
    if (!major) continue;
    // zu spitze Winkel (Gabelungen) bekommen keine Ampel
    const th = arms.map((a) => a.th).sort((p, q) => p - q);
    let minGap = Math.PI * 2;
    for (let i = 0; i < th.length; i++) minGap = Math.min(minGap, ((th[(i + 1) % th.length] - th[i]) + Math.PI * 2) % (Math.PI * 2) || Math.PI * 2);
    if (minGap < 0.6) continue;
    // Arme müssen lang genug sein, damit vor der Kreuzung gehalten werden kann
    if (arms.some((a) => a.r.len < armTrim(net, a.r, a.end) + 12)) continue;
    cands.push({ node, arms, score: major * 2 + arms.length });
  }
  cands.sort((a, b) => b.score - a.score);
  for (const { node, arms } of cands) {
    if (taken.some((p) => Math.hypot(p[0] - node.x, p[1] - node.z) < SPACING)) continue;
    taken.push([node.x, node.z]);
    // Gruppen: Achse des am besten gegenüberliegenden Armpaars = Gruppe 0, der Rest Gruppe 1
    let best = null, bd = 2;
    for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
      const d = arms[i].u[0] * arms[j].u[0] + arms[i].u[1] * arms[j].u[1];
      if (d < bd) { bd = d; best = arms[i]; }
    }
    const ax = best.u;
    const L = { id: lights.length, node: node.id, x: node.x, z: node.z, y: node.y, offset: (node.id * 7.31) % CYCLE, arms: [] };
    for (const a of arms) {
      const along = Math.abs(a.u[0] * ax[0] + a.u[1] * ax[1]);
      const grp = along > 0.7 ? 0 : 1;
      const trim = armTrim(net, a.r, a.end);
      const side = a.r.w / 2 + (a.r.sw > 0 ? 0.65 : 1.1);
      const pole = armPoint(net, a, trim + 0.9, -side);
      // Haltelinie vor dem Abbiegebogen der KI (der beginnt etwa 3 m vor der Kreuzungsfläche)
      const stopFromNode = trim + 3.6;
      L.arms.push({ rid: a.r.id, end: a.end, grp, trim, stopFromNode, u: a.u, w: a.r.w, lanes: a.r.lanes, pole: { x: pole[0], y: pole[1], z: pole[2] }, rot: Math.atan2(a.u[0], a.u[1]) });
    }
    lights.push(L);
  }
  ctx.trafficLights = lights;
  // Nachschlagen für die KI: Straße + Ende → Ampel und Arm
  ctx.lightByArm = new Map();
  for (const L of lights) for (const a of L.arms) ctx.lightByArm.set(a.rid + a.end, { L, arm: a });
  return lights.length;
}
