// Linienbusse: Busse im Verkehr halten an den Haltestellen (world/busstops.js) in ihrer Fahrtrichtung. Fahrgäste steigen
// an der vorderen Tür (rechts) aus und laufen auf dem Gehweg weiter, Wartende steigen ein und sitzen danach sichtbar auf
// den Plätzen im Bus. An Haltestellen in der Nähe des Spielers warten ein paar Leute.
import { Character } from '../entities/character.js';
import { BUS_DOORS } from '../entities/vehicle_models.js';

const WAIT_R = 170;                       // Wartende nur an Haltestellen in diesem Umkreis
const DOOR_Z = BUS_DOORS[0].z;            // vordere Tür (lokal)
const RIDERS = ['local', 'tourist', 'elder', 'business', 'worker', 'local', 'tourist'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class BusService {
  constructor(game) {
    this.game = game;
    this.stops = game.ctx.busStops || [];
    this.byRoad = game.ctx.stopsByRoad || new Map();
    for (const s of this.stops) { s.waiting = []; s.want = Math.floor(Math.random() * 4); }
    this.scanT = 0; this.checkT = 0;
  }

  // ---------- Fahrgäste im Bus ----------
  onSpawn(v) {
    if (!v.dims.seats) return;
    v.busSeats = new Array(v.dims.seats.length).fill(null);
    v.busSeats[0] = v.driver;
    const n = 2 + Math.floor(Math.random() * 8);
    for (let k = 0; k < n; k++) {
      const ch = new Character(this.game, 'ped', v.x, v.z, { noHuman: true, outfit: pick(RIDERS) });
      this.game.addCharacter(ch);
      if (!this._seat(v, ch)) { this.game.removeCharacter(ch); break; }
    }
  }

  _seat(v, ch) {
    const free = [];
    for (let i = 1; i < v.busSeats.length; i++) if (!v.busSeats[i]) free.push(i);
    if (!free.length) return false;
    const i = free[Math.floor(Math.random() * free.length)];
    v.busSeats[i] = ch;
    this.game.seatNpc(ch, v, i);
    return true;
  }

  _unseat(v, ch) {
    const i = v.busSeats ? v.busSeats.indexOf(ch) : -1;
    if (i >= 0) v.busSeats[i] = null;
    const k = v.passengers.indexOf(ch); if (k >= 0) v.passengers.splice(k, 1);
    ch.state = 'ground'; ch.vehicle = null; ch.seat = 0;
    if (ch.noHuman) { ch.noHuman = false; ch.ensureHuman(); }
  }

  // Tür (rechts, lokal −x) in Weltkoordinaten, out = Abstand nach außen
  door(v, out = 0.6) {
    const fx = Math.sin(v.h), fz = Math.cos(v.h), lx = Math.cos(v.h), lz = -Math.sin(v.h);
    return { x: v.x + fx * DOOR_Z - lx * (v.hw + out), z: v.z + fz * DOOR_Z - lz * (v.hw + out) };
  }

  // ---------- Halten an der Haltestelle (aus ai/traffic.js) ----------
  drive(v, r, limit, dt) {
    if (!v.busSeats) return limit;
    const b = v.bus || (v.bus = { dwell: 0, stop: null, served: new Set(), alight: [], alightT: 0 });
    if (v.ai.panic > 0) { if (b.dwell > 0) this._depart(v, b); return limit; }
    if (b.dwell > 0) {
      b.dwell -= dt;
      this._service(v, b, dt);
      v.ai.redWait = true;                                 // wer dahinter steht, wartet geduldig
      if (b.dwell > 0) return 0;
      this._depart(v, b);
      return limit;
    }
    if (r.curve) return limit;
    const list = this.byRoad.get(r.road.id);
    if (!list) return limit;
    let best = null, bd = 1e9;
    for (const st of list) {
      if (st.fwd !== r.fwd || b.served.has(st.id)) continue;
      const d = st.sRail - DOOR_Z - r.s;                   // vordere Tür auf Höhe des Häuschens
      if (d > -1.5 && d < bd) { bd = d; best = st; }
    }
    if (!best) return limit;
    if (bd < 0.6 && Math.abs(r.speed) < 0.35) { this._arrive(v, b, best); return 0; }
    return Math.min(limit, bd <= 0 ? 0 : Math.sqrt(3.2 * bd));
  }

  _arrive(v, b, stop) {
    b.stop = stop; b.served.add(stop.id);
    b.dwell = 6 + Math.random() * 2;
    // Aussteigen: 0–3 Fahrgäste nacheinander
    const riders = v.passengers.filter((c) => c.alive && c.vehicle === v);
    const n = Math.min(riders.length, Math.floor(Math.random() * 4));
    b.alight = riders.sort(() => Math.random() - 0.5).slice(0, n);
    b.alightT = 0.6;
    // Einsteigen: die Wartenden laufen zur Tür
    const d = this.door(v, 0.9);
    for (const c of stop.waiting) if (c.alive && c.ai && c.ai.mode === 'busWait') { c.ai.mode = 'board'; c.ai.tx = d.x + (Math.random() - 0.5) * 0.6; c.ai.tz = d.z + (Math.random() - 0.5) * 0.6; c.ai.bus = v; }
    this.game.audio?.busDoor?.(v);
  }

  _service(v, b, dt) {
    const g = this.game;
    // nacheinander aussteigen
    b.alightT -= dt;
    if (b.alight.length && b.alightT <= 0) {
      b.alightT = 0.9;
      const ch = b.alight.shift();
      if (ch.alive && ch.vehicle === v) this._toSidewalk(v, ch, b.stop);
    }
    // einsteigen, wer an der Tür ist; solange noch jemand kommt, wartet der Bus (höchstens bis 14 s)
    const st = b.stop;
    let coming = false;
    for (let i = st.waiting.length - 1; i >= 0; i--) {
      const c = st.waiting[i];
      if (!c.alive || !c.ai || c.ai.mode !== 'board' || c.ai.bus !== v) { if (!c.alive || !c.ai || (c.ai.mode !== 'board' && c.ai.mode !== 'busWait')) st.waiting.splice(i, 1); continue; }
      const d = this.door(v, 0.9);
      if (Math.hypot(c.x - d.x, c.z - d.z) < 1.1) {
        st.waiting.splice(i, 1);
        const k = g.peds.list.indexOf(c); if (k >= 0) g.peds.list.splice(k, 1);
        c.ai = null;
        if (!this._seat(v, c)) { g.removeCharacter(c); }
      } else coming = true;
    }
    if ((coming || b.alight.length) && b.dwell < 0.5 && (b.extra = (b.extra || 0) + dt) < 6) b.dwell = 0.5;
  }

  _depart(v, b) {
    b.dwell = 0; b.extra = 0;
    for (const ch of b.alight) if (ch.alive && ch.vehicle === v) this._toSidewalk(v, ch, b.stop);
    b.alight = [];
    // wer es nicht mehr geschafft hat, wartet auf den nächsten Bus
    if (b.stop) for (const c of b.stop.waiting) if (c.ai && c.ai.mode === 'board') { c.ai.mode = 'busWait'; c.ai.bus = null; c.ai.tx = c.x; c.ai.tz = c.z; }
    if (b.stop) b.stop.want = Math.floor(Math.random() * 4);
  }

  // Fahrgast steigt aus und geht auf dem Gehweg in Fahrtrichtung des Busses weiter
  _toSidewalk(v, ch, stop) {
    const g = this.game, net = g.ctx.net;
    this._unseat(v, ch);
    const d = this.door(v, 0.7);
    ch.x = d.x; ch.z = d.z; ch.y = g.physics.groundHeight(d.x, d.z); ch.vx = ch.vz = 0; ch.h = v.h - Math.PI / 2;
    const road = net.roads[stop.rid];
    const side = 1, off = (road.w / 2 + Math.max(road.sw, 2) * 0.5) * side;
    const fwd = Math.random() < 0.7 ? stop.fwd : !stop.fwd;
    const s = fwd === stop.fwd ? stop.sRail : road.len - stop.sRail;
    ch.ai = { mode: 'walk', t: 8 + Math.random() * 20, route: { road, fwd, s, side: fwd === stop.fwd ? side : -side, off: fwd === stop.fwd ? off : -off }, tx: ch.x, tz: ch.z, outfit: ch.outfitKind, fear: 0, moodT: 8 + Math.random() * 20, bumpT: 0 };
    g.peds.list.push(ch);
  }

  // ---------- Wartende an den Haltestellen ----------
  update(dt) {
    const g = this.game, p = g.player;
    const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 1.2;
      for (const st of this.stops) {
        st.waiting = st.waiting.filter((c) => c.alive && !c.dropped && c.ai && (c.ai.mode === 'busWait' || c.ai.mode === 'board'));
        const d = Math.hypot(st.x - px, st.z - pz);
        if (d > WAIT_R || d < 30 || st.waiting.length >= st.want) continue;
        const k = st.waiting.length;
        const x = st.stand.x + st.T[0] * (k - 1) * 0.9 + (Math.random() - 0.5) * 0.3, z = st.stand.z + st.T[1] * (k - 1) * 0.9 + (Math.random() - 0.5) * 0.3;
        const c = g.peds._make(pick(RIDERS), x, z, { mode: 'busWait' });
        if (!c) continue;
        c.ai.face = Math.atan2(-st.R[0], -st.R[1]) + (Math.random() - 0.5) * 0.8;   // Blick zur Straße
        c.ai.t = 1e9;
        st.waiting.push(c);
      }
    }
    // Fahrgäste verlassen den Bus, wenn der Spieler ihn übernimmt oder er brennt/zerstört ist
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = 0.5;
      for (const v of g.vehicles.list) {
        if (!v.busSeats || !v.passengers.length) continue;
        const bad = !v.alive || v.exploded || v.burning > 0 || (v.driver && v.driver.isPlayer) || (!v.driver && v.owner !== 'traffic');
        if (!bad) continue;
        for (const ch of [...v.passengers]) {
          if (ch.isPlayer) continue;
          this._unseat(v, ch);
          const d = this.door(v, 0.8 + Math.random());
          ch.x = d.x; ch.z = d.z; ch.y = g.physics.groundHeight(d.x, d.z);
          g.peds.adopt(ch); g.peds.scare(ch, v, 10);
        }
      }
    }
  }
}
