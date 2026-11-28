// Die Autobahnen laufen von Ortseinfahrt zu Ortseinfahrt; im Ort fährt man über normale Straßen weiter.
// Für die Karte: je Ort die Einfahrten aller Autobahnen über Ortsstraßen verbinden, damit die gelbe Linie durchläuft.
// An der Welt selbst ändert sich dadurch nichts. Ohne Three.js, in Node prüfbar.
import { MinHeap, clamp } from '../util.js';

// Gewicht je Straßenart (breite Straßen bevorzugen); nicht aufgeführte Arten werden nie benutzt
const WEIGHT = { avenue: 0.75, main: 0.8, rural: 1, street: 1, scenic: 1.4, promenade: 1.5, alley: 1.9, quay: 3 };
const TURN = 60;   // so viele Meter Umweg "kostet" eine rechtwinklige Abbiegung – das hält die Linie ruhig
const NEAR = 160;  // Meter: so dicht gilt als "an derselben Stelle"

// Richtung, in der die Straße vom Knoten wegführt (über die ersten ~30 m)
function away(r, node) {
  const p = r.pts, n = p.length - 1, k = Math.min(3, n);
  const [o, q] = r.a === node ? [p[0], p[k]] : [p[n], p[n - k]];
  const l = Math.hypot(q[0] - o[0], q[1] - o[1]) || 1;
  return [(q[0] - o[0]) / l, (q[1] - o[1]) / l];
}
// Abbiege-Zuschlag, wenn man über Straße "from" am Knoten ankommt und über "to" weiterfährt
function turn(from, to, node) {
  const a = away(from, node), b = away(to, node);
  const angle = Math.acos(clamp(-(a[0] * b[0] + a[1] * b[1]), -1, 1));
  return TURN * (angle / (Math.PI / 2)) ** 2;
}

// Günstigster Weg über Ortsstraßen von einem Knoten in "start" zu einem Knoten in "goals"
function cheapest(net, start, goals, route) {
  const usable = (r) => !r.noTraffic && WEIGHT[r.kind] !== undefined;
  // Zuschlag beim Anschluss an die Autobahn bzw. an das schon gewählte Stück
  const join = (r, node) => {
    let best = Infinity;
    for (const id of net.nodes[node].roads) {
      const o = net.roads[id];
      if (o !== r && (o.kind === 'highway' || route.has(id))) best = Math.min(best, turn(o, r, node));
    }
    return best === Infinity ? 0 : best;
  };
  const heap = new MinHeap(), cost = new Map();
  const push = (state, c) => { if (c < (cost.get(state.key) ?? Infinity)) { cost.set(state.key, c); heap.push(c, { ...state, c }); } };
  const step = (node, r, c, prev) => {
    const end = r.a === node ? r.b : r.a;
    push({ key: r.id * 2 + (r.a === node ? 0 : 1), road: r, end, prev }, c + r.len * WEIGHT[r.kind]);
  };
  for (const node of start) for (const id of net.nodes[node].roads) { const r = net.roads[id]; if (usable(r)) step(node, r, join(r, node), null); }
  while (heap.size) {
    const s = heap.pop();
    if (s.done) {
      const roads = [];
      for (let q = s.prev; q; q = q.prev) roads.push(q.road);
      return { roads, end: s.end };
    }
    if (s.c > cost.get(s.key)) continue;
    if (goals.has(s.end)) push({ key: 'ziel' + s.key, done: true, end: s.end, prev: s }, s.c + join(s.road, s.end));
    for (const id of net.nodes[s.end].roads) {
      const r = net.roads[id];
      if (r !== s.road && usable(r)) step(s.end, r, s.c + turn(s.road, r, s.end), s);
    }
  }
  return null;
}

// Autobahnstücke, die an den Knoten "start" hängen: Straßennummern und berührte Knoten
function piece(net, start) {
  const roads = new Set(), nodes = new Set([start]), stack = [start];
  while (stack.length) {
    for (const id of net.nodes[stack.pop()].roads) {
      const r = net.roads[id];
      if (r.kind !== 'highway' || roads.has(id)) continue;
      roads.add(id);
      for (const n of [r.a, r.b]) if (!nodes.has(n)) { nodes.add(n); stack.push(n); }
    }
  }
  return { roads, nodes };
}

// links: [{ a, b, from, to }] – Einfahrtsknoten und Orte der geplanten Autobahnen. Liefert:
//   through: Ortsstraßen, die zur Autobahnstrecke gehören
//   side:    kurze Autobahnhaken ohne eigenes Ziel (die Karte zeigt sie als Hauptstraße)
export function highwayThrough(net, links) {
  const gap = (a, b) => Math.hypot(net.nodes[a].x - net.nodes[b].x, net.nodes[a].z - net.nodes[b].z);
  // Haken: Anfang und Ende liegen dicht beieinander, und am Ziel kommt ohnehin eine andere Autobahn an
  const hook = (l) => gap(l.a, l.b) < NEAR && links.some((o) => o !== l && (gap(o.a, l.b) < NEAR || gap(o.b, l.b) < NEAR));
  const main = links.filter((l) => !hook(l));
  const side = new Set();
  for (const l of links.filter(hook)) {
    const p = piece(net, l.a);
    if (main.every((o) => !p.nodes.has(o.a) && !p.nodes.has(o.b))) for (const id of p.roads) side.add(id);
  }
  const towns = new Map();
  for (const l of main) {
    for (const [town, node] of [[l.from, l.a], [l.to, l.b]]) {
      if (!towns.has(town)) towns.set(town, new Set());
      towns.get(town).add(node);
    }
  }
  const route = new Set();
  for (const gates of towns.values()) {
    const [first, ...rest] = gates;
    const tree = new Set([first]), open = new Set(rest);
    while (open.size) {
      const path = cheapest(net, tree, open, route);
      if (!path) break;
      for (const r of path.roads) { route.add(r.id); tree.add(r.a); tree.add(r.b); }
      tree.add(path.end);
      for (const g of open) if (tree.has(g)) open.delete(g);   // unterwegs passierte Einfahrten sind mit angeschlossen
    }
  }
  return { through: route, side };
}
