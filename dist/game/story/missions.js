// Missionen und Story von "Mallorca's: Street Life".
import { fmtMoney, clamp } from '../util.js';

// ---------- Hilfen ----------
const names = (g) => (g.player.who === 'lucia' ? { ME: 'Lucia', P: 'Jason' } : { ME: 'Jason', P: 'Lucia' });
const fill = (t, g) => { const n = names(g); return t.replaceAll('{ME}', n.ME).replaceAll('{P}', n.P); };

function resolve(g, pos) {
  if (!pos) return null;
  if (typeof pos === 'function') return resolve(g, pos(g));
  if (typeof pos === 'string') pos = { poi: pos };
  if (pos.x !== undefined) return { x: pos.x, z: pos.z };
  const key = pos.poi;
  let p = g.ctx.pois.find((q) => q.id === key);
  if (!p) {
    const sid = key.split('.')[0];
    const s = g.ctx.settlements.find((q) => q.id === sid && q.pos);
    p = s ? { x: s.pos[0], z: s.pos[1] } : g.ctx.pois.find((q) => q.type === 'city');
  }
  const o = { x: p.x + (pos.dx || 0), z: p.z + (pos.dz || 0) };
  if (pos.snap) { const nr = g.ctx.net.nearest(o.x, o.z, 160, (r) => !r.noTraffic && r.kind !== 'track'); if (nr) { o.x = nr.x; o.z = nr.z; o.h = Math.atan2(nr.road.pts[Math.min(nr.i + 1, nr.road.pts.length - 1)][0] - nr.road.pts[nr.i][0], nr.road.pts[Math.min(nr.i + 1, nr.road.pts.length - 1)][1] - nr.road.pts[nr.i][1]); } }
  return o;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pp = (g) => (g.player.vehicle ? { x: g.player.vehicle.x, z: g.player.vehicle.z } : { x: g.player.x, z: g.player.z });

// ---------- Schritt-Fabriken ----------
const S = {
  dialog: (lines) => ({
    t: 'dialog',
    init(m) { m.g.ui.setObjective(m.def.title, ''); m.g.ui.dialog(lines.map((l) => ({ who: fill(l[0], m.g), text: fill(l[1], m.g) })), () => { this.done = true; }); this.done = false; },
    tick() { return this.done; },
  }),

  // Zu einem Ort gehen/fahren
  goto: (pos, text, o = {}) => ({
    t: 'goto', opts: o,
    init(m) {
      const p = resolve(m.g, pos); this.p = p;
      this.mk = m.marker(p, o.radius ?? 6, text, o);
      m.objective(fill(text, m.g));
      m.waypoint(p);
    },
    tick(m) {
      const pl = m.g.player;
      const inV = !!pl.vehicle;
      if (o.onFoot && inV) return false;
      if (o.inVehicle && !inV) return false;
      return dist(pp(m.g), this.p) < (o.radius ?? 6) + (inV ? 2 : 0) && Math.abs((inV ? pl.vehicle.y : pl.y) - m.g.physics.groundHeight(this.p.x, this.p.z)) < (o.dy ?? 12);
    },
    end(m) { m.dropMarkers(); },
  }),

  // Beliebiges Fahrzeug nehmen
  enterAny: (text) => ({ t: 'enter', init(m) { m.objective(text); }, tick(m) { return !!m.g.player.vehicle; } }),

  // Bestimmtes Fahrzeug bereitstellen und einsteigen
  getVehicle: (type, pos, text, o = {}) => ({
    t: 'getVeh',
    init(m) {
      const p = resolve(m.g, pos);
      const v = m.g.vehicles.spawn(type, p.x, p.z, p.h ?? o.heading ?? 0, { owner: 'mission', paint: o.paint ?? 0 });
      v.keep = true; v.owner = 'mission';
      if (o.locked === false) v.locked = false;
      m.veh = v; this.v = v;
      m.mk = m.g.markers.add({ x: p.x, z: p.z, radius: 4, color: [0.3, 0.9, 1], blip: { icon: '▣', color: '#6ad1ff', big: true }, height: 22 });
      m.markers.push(m.mk);
      m.objective(fill(text, m.g));
      m.waypoint(p);
    },
    tick(m) { const v = this.v; if (!v.alive || v.exploded) { m.fail('Das Fahrzeug wurde zerstört'); return false; } if (m.mk) { m.mk.x = v.x; m.mk.z = v.z; m.mk.beam.position.set(v.x, v.y + 11, v.z); m.mk.ring.position.set(v.x, v.y + 0.2, v.z); } return m.g.player.vehicle === v; },
    end(m) { m.dropMarkers(); },
  }),

  // Fahrzeug zu einem Ort bringen (optional Zeitlimit, Mindestzustand)
  driveTo: (pos, text, o = {}) => ({
    t: 'driveTo', opts: o,
    init(m) {
      const p = resolve(m.g, pos); this.p = p; this.t0 = 0;
      this.mk = m.marker(p, o.radius ?? 9, text, { vehicleOnly: !o.air, color: [1, 0.9, 0.2], ...o });
      m.objective(fill(text, m.g), o.limit ? `Zeit: ${Math.ceil(o.limit)} s` : '');
      m.waypoint(p);
      this.left = o.limit || 0;
    },
    tick(m, dt) {
      const g = m.g, pl = g.player, v = m.veh;
      if (o.limit) { this.left -= dt; m.sub(`Zeit: ${Math.max(0, Math.ceil(this.left))} s`); if (this.left <= 0) { m.fail('Zeit abgelaufen'); return false; } }
      if (v) {
        if (!v.alive || v.exploded) { m.fail('Das Fahrzeug wurde zerstört'); return false; }
        if (pl.vehicle !== v) { this.away = (this.away || 0) + dt; m.sub(`Zurück zum Fahrzeug! ${Math.ceil(25 - this.away)} s`); if (this.away > 25) { m.fail('Du hast das Fahrzeug zurückgelassen'); return false; } } else this.away = 0;
        if (o.hpMin && v.hp < v.maxHp * o.hpMin) { m.fail('Das Fahrzeug ist zu stark beschädigt'); return false; }
      }
      if (v && pl.vehicle !== v) return false;
      if (!pl.vehicle) return false;
      const d = dist(pp(g), this.p);
      if (o.landing) { const veh = pl.vehicle; return d < (o.radius ?? 60) && veh.grounded && (veh.airSpeed || 0) < 10; }
      return d < (o.radius ?? 9) + 3;
    },
    end(m) { m.dropMarkers(); },
  }),

  // Gegner ausschalten. spawn(g, m) → Charaktere
  kill: (spawnFn, text, o = {}) => ({
    t: 'kill',
    init(m) {
      this.foes = spawnFn(m.g, m) || [];
      for (const c of this.foes) c.missionFoe = true;
      m.objective(fill(text, m.g), `Verbleibend: ${this.foes.length}`);
      const avg = this.foes.reduce((a, c) => ({ x: a.x + c.x / this.foes.length, z: a.z + c.z / this.foes.length }), { x: 0, z: 0 });
      this.mid = avg; m.waypoint(avg);
      this.mk = m.g.markers.add({ x: avg.x, z: avg.z, radius: 6, color: [1, 0.2, 0.2], blip: { icon: '☠', color: '#ff4d4d', big: true }, height: 26 }); m.markers.push(this.mk);
    },
    tick(m) {
      const left = this.foes.filter((c) => c.alive).length;
      m.sub(`Verbleibend: ${left}`);
      if (this.mk) { const alive = this.foes.filter((c) => c.alive); if (alive.length) { const a = alive[0]; this.mk.x = a.x; this.mk.z = a.z; this.mk.beam.position.set(a.x, a.y + 13, a.z); this.mk.ring.position.set(a.x, a.y + 0.2, a.z); m.waypoint(a, true); } }
      return left === 0;
    },
    end(m) { m.dropMarkers(); },
  }),

  // Im Bereich bleiben (Fortschritt), optional zielen/Polizei auslösen
  hold: (pos, secs, text, o = {}) => ({
    t: 'hold', opts: o,
    init(m) {
      const p = resolve(m.g, pos); this.p = p; this.acc = 0;
      this.mk = m.marker(p, o.radius ?? 4, text, { color: [1, 0.4, 0.8] });
      m.objective(fill(text, m.g), '');
      m.waypoint(p);
      this.started = false;
    },
    tick(m, dt) {
      const g = m.g;
      const near = dist(pp(g), this.p) < (o.radius ?? 4) + 1;
      if (o.needAim && !g.player.aiming) { m.sub(near ? 'Ziehe deine Waffe! (Rechte Maustaste)' : ''); return false; }
      if (!near) { if (this.started) m.sub('Zurück in den Bereich!'); return false; }
      if (!this.started) { this.started = true; o.onStart?.(m); }
      this.acc += dt;
      o.onTick?.(m, this.acc, dt);
      m.sub(`Fortschritt: ${Math.min(100, Math.round((this.acc / secs) * 100))} %`);
      return this.acc >= secs;
    },
    end(m) { m.dropMarkers(); },
  }),

  // Fahndung loswerden
  escape: (stars, text) => ({
    t: 'escape',
    init(m) { m.g.police.setWanted(stars); m.objective(fill(text, m.g), 'Verschwinde aus dem Sichtfeld der Polizei'); },
    tick(m) { return m.g.police.wanted === 0; },
  }),

  wait: (secs, text) => ({ t: 'wait', init(m) { this.acc = 0; m.objective(text); }, tick(m, dt) { this.acc += dt; return this.acc >= secs; } }),

  run: (fn) => ({ t: 'run', init(m) { fn(m.g, m); }, tick() { return true; } }),

  // Bedingung abwarten
  until: (cond, text, sub = '') => ({ t: 'until', init(m) { m.objective(fill(text, m.g), sub); }, tick(m, dt) { return cond(m.g, m, dt); } }),

  // Wellen von Verstärkung (Polizei) während die Mission läuft
  reward: (n) => ({ t: 'reward', init(m) { m.reward += n; }, tick() { return true; } }),
};

const poi = (id, o = {}) => ({ poi: id, ...o });

// ---------- Missionen ----------
const MISSIONS = [
  {
    id: 'm1', title: 'Willkommen in Palma', giver: 'Marco', reward: 500, start: poi('palma.center'), startNow: true, friend: ['marco', 8],
    steps: [
      S.dialog([
        ['{P} (Anruf)', '{ME}, endlich! Wir sind in Palma – ohne Geld, aber mit Plänen. Marco wartet im Hafen auf dich.'],
        ['{P} (Anruf)', 'Schnapp dir einfach irgendein Auto. Drück F in der Nähe eines Fahrzeugs, um einzusteigen.'],
      ]),
      S.enterAny('Steige in ein Fahrzeug (F)'),
      S.goto(poi('palma.harbor', { snap: true }), 'Fahre zum Hafen von Palma', { radius: 12, inVehicle: true }),
      S.dialog([
        ['Marco', 'Du musst {ME} sein. Don Rafael sucht Leute, die nicht zu viele Fragen stellen.'],
        ['Marco', 'Fang klein an: Ich brauche einen gelben Veloce GT aus Platja de Palma. Der Besitzer wird nicht begeistert sein.'],
      ]),
    ],
  },
  {
    id: 'm2', title: 'Schnelle Autos', giver: 'Marco', reward: 3500, start: poi('palma.harbor', { dx: 25 }), friend: ['marco', 8],
    steps: [
      S.dialog([['Marco', 'Der Veloce steht am Hotel in Platja de Palma. Bring ihn heil zu meiner Garage am Hafen – ich zahle nach Zustand.']]),
      S.getVehicle('sports', poi('arenal.center', { snap: true, dx: 20 }), 'Hole den gelben Sportwagen in Platja de Palma', { paint: 5 }),
      S.run((g, m) => {
        const p = g.player;
        const a = Math.random() * 6.28;
        for (let k = 0; k < 2; k++) g.enemies.spawnChaser('compact', p.x + Math.cos(a + k) * 140, p.z + Math.sin(a + k) * 140, 0, { group: 'm2', paint: 3 });
        g.ui.notify('Die Besitzer sind hinter dir her!', 'warn');
      }),
      S.driveTo(poi('palma.harbor', { snap: true, dx: 20 }), 'Bringe den Wagen zu Marcos Garage am Hafen', { hpMin: 0.35, radius: 12 }),
      S.run((g, m) => { g.enemies.clearGroup('m2'); }),
      S.dialog([['Marco', 'Nicht schlecht. Das Auto hat ein paar Kratzer, aber der Käufer wird es überleben.']]),
    ],
  },
  {
    id: 'm3', title: 'Kleiner Fisch', giver: 'Marco', reward: 12000, start: poi('palma.harbor', { dx: -25 }), friend: ['marco', 10],
    steps: [
      S.dialog([
        ['Marco', 'Die Joyería Oro in der Innenstadt. Teure Uhren, schlechte Alarmanlage.'],
        ['{P}', 'Ich warte im Fluchtwagen. Zieh deine Waffe und sei schnell, {ME}.'],
      ]),
      S.goto(poi('palma.jewelry'), 'Gehe zur Joyería Oro', { radius: 3.5, onFoot: true }),
      S.hold(poi('palma.jewelry'), 8, 'Raube den Juwelier aus: Waffe ziehen (rechte Maustaste) und im Laden bleiben', { radius: 5, needAim: true, onStart: (m) => { m.g.police.crime('robbery', m.g.player, m.g.player.x, m.g.player.z, true); m.g.police.setWanted(2); m.g.ui.notify('Alarm! Die Polizei ist unterwegs', 'warn'); } }),
      S.reward(4000),
      S.escape(2, 'Entkomme der Polizei'),
      S.goto(poi('palma.harbor', { snap: true, dx: -20 }), 'Bringe die Beute zu Marcos Garage', { radius: 12 }),
      S.dialog([['Marco', 'Ein sauberer Job. Don Rafael wird davon hören – und er mag Leute mit Talent.']]),
    ],
  },
  {
    id: 'm4', title: 'Küstenstraße', giver: 'Marco', reward: 6500, start: poi('palma.harbor', { dz: 30 }), friend: ['marco', 8],
    steps: [
      S.dialog([['Marco', 'Ein Päckchen in Sóller – schnell. Nimm das Motorrad, die Küstenstraße ist kurvig. Und sei gewarnt: Rafaels Konkurrenz weiß Bescheid.']]),
      S.getVehicle('moto', poi('palma.harbor', { snap: true, dz: 45 }), 'Nimm das Motorrad am Hafen', { paint: 1 }),
      S.run((g) => { const p = g.player; g.enemies.spawnChaser('moto', p.x - 80, p.z - 80, 0, { group: 'm4', shooter: false, paint: 3 }); }),
      S.driveTo(poi('soller.center', { snap: true }), 'Bringe das Päckchen nach Sóller', { limit: 260, radius: 14 }),
      S.hold(poi('soller.center', { snap: true }), 3, 'Übergabe an den Kontakt', { radius: 14 }),
      S.run((g) => g.enemies.clearGroup('m4')),
      S.driveTo(poi('palma.harbor', { snap: true, dz: 30 }), 'Fahre zurück zum Hafen von Palma', { radius: 12 }),
      S.dialog([['Marco', 'Pünktlich. Die Konkurrenz hat nichts bemerkt – oder doch?']]),
    ],
  },
  {
    id: 'm5', title: 'Ware aus Ibiza', giver: 'Tomeu', reward: 18000, start: poi('palma.pier0'), friend: ['tomeu', 14],
    steps: [
      S.dialog([
        ['Tomeu', 'Ibiza, Platja d’en Bossa. Dort liegt eine Yacht mit Ware, die niemand sehen soll. Nimm mein Schnellboot.'],
        ['Tomeu', 'Brich nicht die Wellen, sonst bleibt nichts übrig. Und achte auf die Küstenwache!'],
      ]),
      S.getVehicle('speedboat', poi('palma.pier0', { dx: 0, dz: 0 }), 'Nimm das Schnellboot am Pier', { paint: 2 }),
      S.driveTo(poi('platjabossa.center'), 'Fahre mit dem Boot nach Ibiza', { radius: 220, air: true }),
      S.run((g) => { const p = g.player; for (let k = 0; k < 2; k++) g.enemies.spawnChaser('speedboat', p.x + 150 + k * 40, p.z + 150, 0, { group: 'm5', paint: 0 }); g.ui.notify('Rivalen haben dich entdeckt!', 'warn'); }),
      S.hold(poi('platjabossa.center'), 5, 'Lade die Ware auf (Boot im Bereich halten)', { radius: 260 }),
      S.driveTo(poi('cabrera-port.harbor'), 'Bringe die Ware zum Versteck auf Cabrera', { radius: 120, air: true }),
      S.run((g) => g.enemies.clearGroup('m5')),
      S.dialog([['Tomeu', 'Cabrera ist verlassen – perfekt. Wir sind im Geschäft, {ME}.']]),
    ],
  },
  {
    id: 'm6', title: 'Rivalen', giver: 'Marco', reward: 9000, start: poi('palma.harbor', { dx: 40, dz: 10 }), friend: ['marco', 10],
    steps: [
      S.dialog([['Marco', 'Die Rivalen haben im Polígono Son Castelló eine Lagerhalle übernommen. Räum sie aus – und nimm den Koffer mit.']]),
      S.goto(poi('poligon.center'), 'Fahre zum Polígono Son Castelló', { radius: 90 }),
      S.kill((g) => g.enemies.spawnGang(...(() => { const p = resolve(g, poi('poligon.center')); return [p.x, p.z]; })(), 9, { group: 'm6', radius: 38, alert: false, weapon: null }), 'Schalte alle Rivalen aus'),
      S.run((g, m) => { const p = resolve(g, poi('poligon.center')); g.pickups.spawn('cash', p.x + 3, p.z + 3, 4500, { life: 600 }); g.ui.notify('Der Koffer liegt in der Halle', 'info'); }),
      S.wait(1, 'Durchsuche die Halle'),
      S.run((g) => g.enemies.clearGroup('m6')),
      S.dialog([['Marco', 'Ruhe im Viertel – für den Moment.']]),
    ],
  },
  {
    id: 'm7', title: 'Die Finca', giver: 'Don Rafael', reward: 25000, start: poi('palma.harbor', { dx: -45, dz: 10 }), friend: ['rafael', 12],
    steps: [
      S.dialog([
        ['Don Rafael', '{ME}, mein Freund. Ein Geschäftspartner hat Unterlagen in seiner Finca – Beweise, die mir schaden könnten.'],
        ['Don Rafael', 'Hol sie dir. Die Wachen schießen sofort.'],
      ]),
      S.goto((g) => { const f = g.ctx.pois.find((p) => p.type === 'finca'); return { x: f.x - 90, z: f.z - 90 }; }, 'Fahre zur abgelegenen Finca', { radius: 80 }),
      S.kill((g) => { const f = g.ctx.pois.find((p) => p.type === 'finca'); return g.enemies.spawnGang(f.x, f.z, 8, { group: 'm7', radius: 22, weapon: null, accuracy: 2.2 }); }, 'Schalte die Wachen aus'),
      S.hold((g) => { const f = g.ctx.pois.find((p) => p.type === 'finca'); return { x: f.x, z: f.z }; }, 6, 'Durchsuche das Haus nach den Unterlagen', { radius: 18, onStart: (m) => m.g.police.setWanted(2) }),
      S.escape(2, 'Verschwinde von hier, die Polizei kommt'),
      S.run((g) => g.enemies.clearGroup('m7')),
      S.dialog([['Don Rafael', 'Du hast mich nicht enttäuscht. Aber merk dir: Loyalität ist alles.']]),
    ],
  },
  {
    id: 'm8', title: 'Flug nach Menorca', giver: 'Elena', reward: 22000, start: poi('airport.apron'), friend: ['elena', 14],
    steps: [
      S.dialog([
        ['Elena', 'Ich bin Elena, Fluglotsin mit Nebenjob. Ein Kunde wartet in Maó – mit einer Tasche, die nicht auf eine Fähre passt.'],
        ['Elena', 'Die Cessna steht am Vorfeld. Gas mit Shift, Nase hoch mit S. Und lande bitte in einem Stück!'],
      ]),
      S.getVehicle('plane', poi('airport.apron', { dx: -20, dz: 0 }), 'Steige in die Cessna am Vorfeld', { paint: 2, heading: 0 }),
      S.driveTo(poi('mao.center'), 'Fliege nach Maó auf Menorca', { radius: 260, air: true }),
      S.driveTo(poi('mao.center'), 'Lande die Maschine bei Maó (Gas runter, sanft aufsetzen)', { radius: 600, landing: true, air: true }),
      S.wait(2, 'Warte auf den Kontakt …'),
      S.dialog([['Elena (Funk)', 'Gute Landung! Der Kunde hat die Tasche. Du kannst mit dem Boot zurück – ich melde mich.']]),
    ],
  },
  {
    id: 'm9', title: 'Der große Coup', giver: 'Don Rafael', reward: 150000, start: poi('palma.harbor', { dz: -35 }), friend: ['rafael', 16],
    steps: [
      S.dialog([
        ['Don Rafael', 'Das Banco de Mallorca. Der Tresor im Keller ist voll – und unsere Zeit ist knapp.'],
        ['{P}', 'Kauf dir eine anständige Waffe und Schutzweste, {ME}. Das wird laut.'],
      ]),
      S.until((g) => g.player.armor >= 50 && ['smg', 'rifle', 'shotgun'].some((w) => g.player.weapons[w]), 'Rüste dich aus: Schutzweste (50+) und Maschinenpistole/Gewehr', 'Waffenladen (Armería) in Palma'),
      S.goto(poi('palma.bank'), 'Gehe zur Bank', { radius: 4, onFoot: true }),
      S.dialog([['{P}', 'Ich bin hinter dir. Los!']]),
      S.hold(poi('palma.bank'), 22, 'Öffne den Tresor: Im Bankbereich bleiben', { radius: 8, onStart: (m) => { const g = m.g; g.police.crime('robbery', g.player, g.player.x, g.player.z, true); g.police.setWanted(4); g.ui.notify('Der stille Alarm wurde ausgelöst!', 'warn'); } }),
      S.reward(60000),
      S.getVehicle('speedboat', poi('palma.pier2'), 'Nimm das Fluchtboot am Pier', { paint: 3 }),
      S.escape(4, 'Entkomme der Polizei'),
      S.driveTo(poi('cabrera-port.harbor'), 'Fahre mit dem Boot nach Cabrera', { radius: 140, air: true }),
      S.dialog([['{P}', 'Wir haben es geschafft. Das Geld reicht für ein neues Leben – wenn Rafael uns lässt.']]),
    ],
  },
  {
    id: 'm10', title: 'Finale: Formentor', giver: 'Don Rafael', reward: 50000, start: poi('cabrera-port.harbor', { dx: 10 }), friend: ['rafael', 0],
    steps: [
      S.dialog([
        ['Don Rafael (Anruf)', 'Ihr habt zu viel gesehen. Kommt zum Leuchtturm am Cap de Formentor – allein. Dann reden wir.'],
        ['{P}', 'Das ist eine Falle, {ME}. Aber wir kommen nicht anders aus der Sache raus.'],
      ]),
      S.getVehicle('luxury', poi('palma.harbor', { snap: true, dx: 60 }), 'Nimm den Wagen (Estrella L) in Palma', { paint: 0 }),
      S.driveTo(poi('formentor.lighthouse'), 'Fahre zum Leuchtturm am Cap de Formentor', { radius: 110 }),
      S.kill((g) => { const p = resolve(g, poi('formentor.lighthouse')); const out = g.enemies.spawnGang(p.x, p.z, 8, { group: 'm10', radius: 30, weapon: null, accuracy: 2.0, alert: true }); const boss = g.enemies.spawnGang(p.x + 6, p.z + 4, 1, { group: 'm10', radius: 1, weapon: 'rifle', hp: 260, boss: true, outfit: 'business', alert: true }); return out.concat(boss); }, 'Besiege Don Rafael und seine Männer'),
      S.run((g) => { g.enemies.clearGroup('m10'); }),
      S.dialog([
        ['{P}', 'Vorbei. Nichts hält uns mehr auf dieser Insel.'],
        ['{ME}', 'Mallorca gehört uns. Die Straße gehört uns. Das war erst der Anfang.'],
      ]),
    ],
    ending: true,
  },
];

const FRIENDS = {
  marco: { name: 'Marco Ibáñez', role: 'Schmuggler & Vermittler', level: 0, text: 'Vermittelt Aufträge im Hafen von Palma.' },
  tomeu: { name: 'Tomeu', role: 'Bootsmann', level: 0, text: 'Kennt jede Bucht und jede Strömung.' },
  rafael: { name: 'Don Rafael Vidal', role: 'Pate der Insel', level: 0, text: 'Mächtig, charmant – und gefährlich.' },
  elena: { name: 'Elena', role: 'Pilotin', level: 0, text: 'Fliegt alles, was Flügel hat.' },
  partner: { name: '', role: 'Partner', level: 40, text: 'Dein Partner in jeder Lage.' },
};

export class MissionManager {
  constructor(game) {
    this.game = game;
    this.defs = MISSIONS;
    this.total = MISSIONS.length;
    this.done = new Set();
    this.cur = null;
    this.startMk = null;
    this.friends = JSON.parse(JSON.stringify(FRIENDS));
    this.markers = [];
    this.started = false;
    this._wpT = 0;
  }

  begin() {
    this.started = true;
    this.refreshStartMarker();
    const first = this.defs[0];
    if (!this.done.has(first.id)) setTimeout(() => { if (!this.cur) this.start(first.id); }, 1500);
  }

  available() {
    for (let i = 0; i < this.defs.length; i++) { if (!this.done.has(this.defs[i].id)) return this.defs[i]; }
    return null;
  }

  refreshStartMarker() {
    const g = this.game;
    if (this.startMk) { g.markers.remove(this.startMk); this.startMk = null; }
    if (this.cur) return;
    const d = this.available();
    if (!d) return;
    const p = resolve(g, d.start);
    this.startMk = g.markers.add({
      x: p.x, z: p.z, radius: 3.2, color: [1, 0.35, 0.85], height: 40, blip: { icon: 'M', color: '#ff5de6', big: true },
      onEnter: () => this.start(d.id), hint: d.title,
    });
    this.startMk.label = d.title;
  }

  start(id) {
    const g = this.game;
    if (this.cur) return;
    const def = this.defs.find((d) => d.id === id);
    if (!def || this.done.has(id)) return;
    if (this.startMk) { g.markers.remove(this.startMk); this.startMk = null; }
    const m = {
      g, def, idx: -1, step: null, reward: def.reward, markers: [], veh: null, mk: null,
      objective: (text, sub = '') => g.ui.setObjective(def.title, text, sub),
      sub: (s) => { if (g.ui.objective) { g.ui.objective.sub = s; g.ui.el.obj.querySelector('.s').textContent = s; } },
      waypoint: (p, quiet) => { const mm = g.ui.minimap; if (!mm.waypoint || mm.waypoint.mission || !quiet) { mm.waypoint = { x: p.x, z: p.z, mission: true }; if (!quiet) mm.routeT = 0; } else { mm.waypoint.x = p.x; mm.waypoint.z = p.z; } },
      marker: (p, r, text, o = {}) => { const mk = g.markers.add({ x: p.x, z: p.z, radius: r, color: o.color || [1, 0.85, 0.2], blip: { icon: o.icon || '●', color: '#ffd24a', big: true }, height: 34 }); m.markers.push(mk); return mk; },
      dropMarkers: () => { for (const k of m.markers) g.markers.remove(k); m.markers.length = 0; m.mk = null; },
      fail: (reason) => this.fail(reason),
    };
    this.cur = m;
    g.ui.notify(`Mission gestartet: ${def.title}`, 'mission');
    g.ui.banner(def.title, def.giver ? `Auftraggeber: ${def.giver}` : '', 3);
    g.police.disabled = false;
    this.next();
  }

  next() {
    const m = this.cur;
    if (!m) return;
    if (m.step && m.step.end) m.step.end(m);
    m.idx++;
    if (m.idx >= m.def.steps.length) { this.complete(); return; }
    m.step = m.def.steps[m.idx];
    m.step.done = false;
    try { m.step.init(m); } catch (e) { console.error('Mission-Schritt:', e); this.fail('Fehler im Missionsschritt'); }
  }

  update(dt) {
    const g = this.game;
    if (!this.started) return;
    if (!this.cur) { if (!this.startMk) this.refreshStartMarker(); return; }
    const m = this.cur;
    if (g.dying) return;
    if (m.step && m.step.tick) {
      let done = false;
      try { done = m.step.tick(m, dt); } catch (e) { console.error('Mission-Tick:', e); this.fail('Fehler'); return; }
      if (done && this.cur === m) this.next();
    }
  }

  complete() {
    const g = this.game, m = this.cur;
    if (!m) return;
    m.dropMarkers();
    g.ui.setObjective(null);
    g.ui.minimap.clearWaypoint();
    this.done.add(m.def.id);
    g.stats.missionsDone = this.done.size;
    g.addMoney(m.reward);
    g.ui.banner('Mission abgeschlossen', `${m.def.title} · ${fmtMoney(m.reward)}`, 4);
    g.ui.notify(`+${fmtMoney(m.reward)} – ${m.def.title}`, 'cash');
    g.audio?.pickup();
    if (m.def.friend) { const f = this.friends[m.def.friend[0]]; if (f) f.level = clamp(f.level + m.def.friend[1], 0, 100); }
    this.friends.partner.level = clamp(this.friends.partner.level + 4, 0, 100);
    this.cur = null;
    for (const k of ['m2', 'm4', 'm5', 'm6', 'm7', 'm10']) g.enemies.clearGroup(k);
    if (m.def.ending) {
      setTimeout(() => g.ui.dialog([['Abspann', 'Mallorca’s: Street Life – du hast die Hauptgeschichte abgeschlossen. Die Insel ist weiter offen: Erkunde Ibiza, Menorca, Formentera, kaufe Geschäfte und genieße die Straßen.']], null), 4200);
    }
    this.refreshStartMarker();
    g.saveToServer?.();
  }

  fail(reason) {
    const g = this.game, m = this.cur;
    if (!m) return;
    m.dropMarkers();
    if (m.step?.end) m.step.end(m);
    g.ui.setObjective(null);
    g.ui.minimap.clearWaypoint();
    g.ui.banner('Mission fehlgeschlagen', reason, 4);
    g.ui.notify(`Mission fehlgeschlagen: ${reason}`, 'warn');
    for (const k of ['m2', 'm4', 'm5', 'm6', 'm7', 'm10']) g.enemies.clearGroup(k);
    if (m.veh && m.veh.owner === 'mission') { m.veh.owner = 'abandoned'; m.veh.keep = false; }
    this.cur = null;
    g.controlsEnabled = true;
    this.refreshStartMarker();
  }

  onPlayerDied() { if (this.cur) this.fail('Du bist gestorben'); }
  onPlayerBusted() { if (this.cur) this.fail('Du wurdest festgenommen'); }
  onRespawn() { this.refreshStartMarker(); }
  onKill() {}
  onEnemyHurt() {}
  onExplosion() {}
  onWanted() {}
  onEnterVehicle() {}

  reset() { this.done.clear(); if (this.cur) this.fail('Zurückgesetzt'); this.refreshStartMarker(); }

  friendList() {
    const n = names(this.game);
    return Object.entries(this.friends).map(([k, f]) => ({ ...f, name: k === 'partner' ? n.P : f.name })).filter((f) => f.level > 0 || f.name === n.P);
  }

  serialize() { return { done: [...this.done], friends: Object.fromEntries(Object.entries(this.friends).map(([k, f]) => [k, f.level])) }; }

  restore(d) {
    if (!d) return;
    this.done = new Set(d.done || []);
    for (const [k, lv] of Object.entries(d.friends || {})) if (this.friends[k]) this.friends[k].level = lv;
    this.game.stats.missionsDone = this.done.size;
    if (this.cur) this.fail('Neu geladen');
    this.refreshStartMarker();
  }
}
