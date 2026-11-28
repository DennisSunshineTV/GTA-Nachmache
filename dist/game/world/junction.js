// Kreuzungen: Form der Fahrbahnfläche, Bordstein-Rundungen, Bürgersteig-Ecken und die Strecke, um die jeder Arm
// zurückgenommen wird. Reine Weltdaten (ohne Three.js), damit das Straßennetz die Höhen an Kreuzungen glätten kann.
//
// Eine Kreuzung ist die Fläche zwischen den Fahrbahnrändern ihrer Arme: jeder Arm wird so weit zurückgenommen, dass
// seine Ränder auf die Ränder der Nachbararme treffen. In den Ecken liegt ein gerundeter Bordstein, daneben die
// Bürgersteig-Ecke. Dadurch ragt nirgends ein runder Fleck über die Straßenränder hinaus.

const AMAX = 2.2;          // längste Ecke in Vielfachen der Halbbreite (spitze Winkel werden abgeschnitten)
const FILLET_STEPS = 6;

const isAirKind = (k) => k === 'runway' || k === 'taxiway';

// Schnitt der Linie von Arm i (Seitenversatz +di auf seiner n-Seite) mit der Linie von Arm j (Versatz dj auf seiner −n-Seite).
// a, b = Abstand der Ecke vom Knoten entlang Arm i bzw. Arm j. Negativ bei Ecken auf der Außenseite einer Kurve.
function cornerOf(ui, uj, di, dj) {
  const ni = [-ui[1], ui[0]], nj = [-uj[1], uj[0]];
  const cr = ui[0] * uj[1] - ui[1] * uj[0], dot = ui[0] * uj[0] + ui[1] * uj[1];
  if (Math.abs(cr) < 0.12) {
    // (fast) parallele Arme: gerade durchlaufender Rand bzw. übereinanderliegende Arme
    if (dot < 0) { const d = (di + dj) / 2; return { a: 0, b: 0, p: [ni[0] * d, ni[1] * d], ok: true, straight: true }; }
    return { a: di, b: dj, p: [ni[0] * di + ui[0] * di, ni[1] * di + ui[1] * di], ok: false, straight: false };
  }
  const wx = -(nj[0] * dj + ni[0] * di), wz = -(nj[1] * dj + ni[1] * di);
  const a = (wx * uj[1] - wz * uj[0]) / cr, b = (wx * ui[1] - wz * ui[0]) / cr;
  return { a, b, p: [ni[0] * di + ui[0] * a, ni[1] * di + ui[1] * a], ok: true, straight: false };
}

function armsOf(net, node) {
  const arms = [];
  for (const id of node.roads) {
    const r = net.roads[id];
    if (isAirKind(r.kind)) continue;
    const n = r.pts.length;
    for (const end of ['a', 'b']) {
      if ((end === 'a' ? r.a : r.b) !== node.id) continue;
      const p0 = end === 'a' ? r.pts[0] : r.pts[n - 1], p1 = end === 'a' ? r.pts[1] : r.pts[n - 2];
      let dx = p1[0] - p0[0], dz = p1[1] - p0[1];
      const l = Math.hypot(dx, dz);
      if (l < 1e-6) continue;
      dx /= l; dz /= l;
      arms.push({ r, end, u: [dx, dz], th: Math.atan2(dz, dx), h: r.w / 2, sw: r.sw, trim: 0 });
    }
  }
  return arms;
}

// Punkt auf einem Arm in Strecke s vom Knoten, seitlich um off versetzt (positiv = n-Seite, n = (−uz, ux) des Arms).
function armPoint(net, arm, s, off) {
  const r = arm.r, o = {};
  net.pointAt(r, arm.end === 'a' ? s : r.len - s, o);
  const sg = arm.end === 'a' ? 1 : -1;
  const tx = o.dx * sg, tz = o.dz * sg;          // Richtung vom Knoten weg
  return [o.x - tz * off, o.y, o.z + tx * off];
}

const BEND = -0.9;         // zwei Straßen gelten ab einem Knick von gut 25° als Ecke (cos des Winkels zwischen den Armen)

function buildJunction(net, node) {
  const arms = armsOf(net, node);
  // auch eine Ecke aus zwei Straßen bekommt eine Fläche mit gerundetem Bordstein (sonst klaffen die Bänder auseinander)
  if (arms.length < 2 || (arms.length === 2 && arms[0].u[0] * arms[1].u[0] + arms[0].u[1] * arms[1].u[1] < BEND)) return null;
  arms.sort((p, q) => p.th - q.th);
  const m = arms.length;
  const minTrim = (a) => Math.max(a.h + 0.5, 3);
  for (const a of arms) a.trim = minTrim(a);
  const corners = [];
  for (let k = 0; k < m; k++) {
    const A = arms[k], B = arms[(k + 1) % m];
    const rc = cornerOf(A.u, B.u, A.h, B.h);
    const hm = Math.max(A.h, B.h);
    const cut = !rc.ok || rc.a > AMAX * hm || rc.b > AMAX * hm;
    const f = Math.min(3.4, Math.max(1.5, Math.min(A.h, B.h) * 0.8));
    const co = { kind: 'cut', rc, f, outer: null };
    if (cut) {
      const a = Math.min(Math.max(rc.a, 0), AMAX * hm), b = Math.min(Math.max(rc.b, 0), AMAX * hm);
      co.a = a; co.b = b;
      A.trim = Math.max(A.trim, a); B.trim = Math.max(B.trim, b);
    } else if (rc.a > 0 && rc.b > 0 && !rc.straight) {
      co.kind = 'fillet';
      A.trim = Math.max(A.trim, rc.a + f); B.trim = Math.max(B.trim, rc.b + f);
    } else {
      co.kind = rc.straight ? 'straight' : 'miter';
    }
    // Bürgersteig-Ecke, sobald einer der beiden Nachbararme einen Gehweg hat (sonst endete er mit einer Lücke vor der
    // Kreuzung); fehlt er an einem Arm, läuft die Ecke mit der Breite des anderen um die Kurve
    const swA = A.sw > 0 ? A.sw : B.sw, swB = B.sw > 0 ? B.sw : A.sw;
    if (co.kind !== 'cut' && (A.sw > 0 || B.sw > 0)) {
      const oc = cornerOf(A.u, B.u, A.h + swA, B.h + swB);
      const om = Math.max(A.h + swA, B.h + swB);
      if (oc.ok && oc.a <= AMAX * om && oc.b <= AMAX * om) {
        co.outer = oc; co.swA = swA; co.swB = swB;
        if (oc.a > 0 && oc.b > 0 && !oc.straight) { A.trim = Math.max(A.trim, oc.a + 0.05); B.trim = Math.max(B.trim, oc.b + 0.05); }
      }
    }
    corners.push(co);
  }
  for (const a of arms) a.trim = Math.min(a.trim, Math.max(a.r.len * 0.5, minTrim(a) * 0.6));
  const trim = new Map();
  for (const a of arms) trim.set(a.r.id + a.end, a.trim);
  for (const a of arms) a.y = armPoint(net, a, a.trim, 0)[1];

  const cx = node.x, cz = node.z;
  const yAt = (x, z, fallback) => fallback;
  const road = [];       // Ring der Fahrbahnfläche (x, y, z)
  const walks = [];      // Bürgersteig-Ecken { chain, sA, sB, co }
  for (let k = 0; k < m; k++) {
    const A = arms[k], B = arms[(k + 1) % m], co = corners[k];
    const eA = [armPoint(net, A, A.trim, -A.h), armPoint(net, A, A.trim, A.h)];   // [−n-Seite, +n-Seite]
    road.push(eA[0], eA[1]);
    const eB = armPoint(net, B, B.trim, -B.h);                                    // −n-Seite von B (zeigt zu A)
    const yA = A.y, yB = B.y;
    const chain = [eA[1]];
    const mix = (t) => yA + (yB - yA) * t;
    const pt = (x, z, t) => [x, yAt(x, z, mix(t)), z];
    if (co.kind === 'cut') {
      chain.push(armPoint(net, A, co.a, A.h), armPoint(net, B, co.b, -B.h));
    } else if (co.kind === 'fillet') {
      const Cx = cx + co.rc.p[0], Cz = cz + co.rc.p[1];
      const P0 = eA[1], P2 = eB;
      for (let s = 1; s < FILLET_STEPS; s++) {
        const t = s / FILLET_STEPS, u = 1 - t;
        chain.push(pt(u * u * P0[0] + 2 * u * t * Cx + t * t * P2[0], u * u * P0[2] + 2 * u * t * Cz + t * t * P2[2], t));
      }
    } else {
      chain.push(pt(cx + co.rc.p[0], cz + co.rc.p[1], 0.5));
    }
    chain.push(eB);
    for (let q = 1; q < chain.length - 1; q++) road.push(chain[q]);
    if (co.outer) {
      const oc = co.outer;
      const sA = armPoint(net, A, A.trim, A.h + co.swA), sB = armPoint(net, B, B.trim, -(B.h + co.swB));
      walks.push({ chain, sA, sB, co: pt(cx + oc.p[0], cz + oc.p[1], 0.5), A, B });
    }
  }
  return { arms, trim, road, walks, node };
}

export function junctionOf(net, node) {
  if (node._jn !== undefined) return node._jn;
  node._jn = node.roads.length >= 2 ? buildJunction(net, node) : null;
  return node._jn;
}

// Radius der alten, runden Fläche (nur noch für Knoten, an denen weniger als drei normale Straßen zusammenkommen)
function legacyPadRadius(net, node) {
  let r = 0;
  if (node.roads.length >= 3) {
    for (const id of node.roads) {
      const road = net.roads[id];
      if (isAirKind(road.kind)) continue;
      r = Math.max(r, road.w * 0.5);
    }
    r *= 1.1;
  }
  return r;
}

// Strecke vom Knoten, ab der die Straße r am Ende 'a' bzw. 'b' beginnt (davor liegt die Kreuzungsfläche)
export function armTrim(net, r, end) {
  const node = net.nodes[end === 'a' ? r.a : r.b];
  if (!node) return 0;
  const jn = junctionOf(net, node);
  if (jn) { const t = jn.trim.get(r.id + end); if (t !== undefined) return t; }
  if (node._legacy === undefined) node._legacy = legacyPadRadius(net, node);
  return node._legacy;
}

// Größter Abstand der Kreuzungsfläche vom Knoten (Mittelpunkt) – für Straßenmöbel o. Ä.
export function nodePadRadius(net, node) {
  const jn = junctionOf(net, node);
  if (jn) { let r = 0; for (const t of jn.trim.values()) r = Math.max(r, t); return r; }
  if (node._legacy === undefined) node._legacy = legacyPadRadius(net, node);
  return node._legacy;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); };

// Legt jede Kreuzung waagerecht auf die Knotenhöhe: Die Straßenhöhen der Arme werden in der Kreuzung (und 2,5 m
// darüber hinaus) auf diese Höhe gezogen und danach weich in den eigenen Verlauf überblendet. So liegen Fahrbahn,
// Bürgersteig-Ecken und Gelände exakt aufeinander und ragen nicht gegeneinander (vorher mittelte das Gelände die
// Höhen der Arme und schaute durch die Kreuzung). Muss nach dem Höhenprofil aller Straßen laufen.
export function flattenJunctions(net) {
  const list = [];
  for (const n of net.nodes) {
    n._jn = undefined;
    const jn = junctionOf(net, n);
    if (jn) list.push({ n, jn });
  }
  for (const { n, jn } of list) {
    for (const a of jn.arms) {
      const r = a.r, len = r.len;
      const other = net.nodes[a.end === 'a' ? r.b : r.a];
      const oj = other && other !== n ? other._jn : null;
      const oTrim = oj ? (oj.trim.get(r.id + (a.end === 'a' ? 'b' : 'a')) ?? 0) : 0;
      const F = Math.min(a.trim + 2.5, len / 2), Fb = oj ? Math.min(oTrim + 2.5, len / 2) : 0;
      const B = Math.max(0, Math.min(30, (len - F - Fb) / 2));
      for (let k = 0; k < r.pts.length; k++) {
        const s = a.end === 'a' ? r.cum[k] : len - r.cum[k];
        if (s > F + B) continue;
        const w = B > 0 ? 1 - smooth(F, F + B, s) : (s <= F ? 1 : 0);
        r.ys[k] += (n.y - r.ys[k]) * w;
      }
    }
  }
  // Zwischengespeicherte Kreuzungen enthalten noch die alten Höhen
  for (const { n } of list) n._jn = undefined;
}
