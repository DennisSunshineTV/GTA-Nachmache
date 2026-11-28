// Tankstellen und Werkstätten zur Laufzeit.
// Tanken: an der Zapfsäule die Zapfpistole nehmen (F/Y) – ein Schlauch führt von der Säule zur Hand –, zum Fahrzeug gehen,
// F/Y = Volltanken für 50 €. Zu weit weg (Schlauchlänge) oder ins Auto steigen hängt die Pistole wieder ein.
// Werkstatt: Das Sektionaltor öffnet sich bei Annäherung; ein Fahrzeug, das in der Halle anhält, wird repariert.
// Preis: 99 % Schaden und mehr = 500 €, darunter anteilig (98 % … 1 %).
import * as THREE from 'three';
import { SHOP } from './services.js';
import { fmtMoney } from '../util.js';

export const FUEL_PRICE = 50;
export const REPAIR_MAX = 500;
const HOSE = 6.5;                 // Schlauchlänge (m)
const SLAT_N = 8, TRACK_R = 0.35;
const _v = new THREE.Vector3();

export function repairCost(v) {
  const pct = Math.round((1 - v.hp / v.maxHp) * 100);
  if (pct <= 0) return { pct: 0, cost: 0 };
  return { pct, cost: pct >= 99 ? REPAIR_MAX : Math.max(1, Math.round((REPAIR_MAX * pct) / 99)) };
}

// Sektionaltor einer Werkstatthalle (Lamellen laufen in Schienen unter die Decke)
class ShopDoor {
  constructor(game, site, mats) {
    this.game = game; this.site = site;
    const hall = site.door.hall;
    this.hall = hall; this.yF = hall.base + 0.12; this.open = 0;
    this.W = SHOP.door.w; this.H = SHOP.door.h; this.z0 = -hall.d / 2 + 0.2;
    this.root = new THREE.Group();
    this.root.position.set(hall.x, this.yF, hall.z);
    this.root.rotation.y = hall.rot;
    this.slatH = this.H / SLAT_N;
    const geo = new THREE.BoxGeometry(this.W, this.slatH - 0.015, 0.06);
    const rib = new THREE.BoxGeometry(this.W - 0.05, 0.035, 0.02);
    this.slats = [];
    for (let i = 0; i < SLAT_N; i++) {
      const m = new THREE.Mesh(geo, mats.slat);
      const r = new THREE.Mesh(rib, mats.rib); r.position.set(0, 0, -0.04); m.add(r);
      if (i === 2) for (let k = -3; k <= 3; k++) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.02), mats.win); w.position.set(k * 1.05, 0, -0.04); m.add(w); }
      m.castShadow = true; m.receiveShadow = true;
      this.root.add(m); this.slats.push(m);
    }
    game.scene.add(this.root);
    const c = Math.cos(hall.rot), s = Math.sin(hall.rot);
    this.col = { k: 'b', x: hall.x + s * this.z0, z: hall.z + c * this.z0, hx: this.W / 2, hz: 0.22, c, s, y0: this.yF - 0.3, y1: this.yF + this.H + 0.4 };
    game.physics.addColliders([this.col]);
    this.place();
  }

  track(s) {
    const H = this.H, arc = (Math.PI / 2) * TRACK_R;
    if (s <= H) return [s, this.z0];
    if (s <= H + arc) { const t = (s - H) / TRACK_R; return [H + Math.sin(t) * TRACK_R, this.z0 + (1 - Math.cos(t)) * TRACK_R]; }
    return [H + TRACK_R, this.z0 + TRACK_R + (s - H - arc)];
  }

  place() {
    const H = this.H, arc = (Math.PI / 2) * TRACK_R, o = this.open;
    const e = o < 0.5 ? 2 * o * o : 1 - Math.pow(-2 * o + 2, 2) / 2;
    const shift = e * (H + arc);
    for (let i = 0; i < SLAT_N; i++) {
      const s0 = i * this.slatH + shift, [y0, z0] = this.track(s0), [y1, z1] = this.track(s0 + this.slatH);
      const m = this.slats[i];
      m.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2);
      m.rotation.x = Math.atan2(z1 - z0, y1 - y0);
    }
    this.col.y0 = this.yF + Math.min(shift, H) - 0.05;
  }

  local(x, z) { const c = Math.cos(this.hall.rot), s = Math.sin(this.hall.rot), dx = x - this.hall.x, dz = z - this.hall.z; return [c * dx - s * dz, s * dx + c * dz]; }

  update(dt, px, pz) {
    const [lx, lz] = this.local(px, pz), hd = this.hall.d / 2;
    let want = Math.abs(lx) < this.W / 2 + 5 && lz > -hd - 16 && lz < hd;
    if (!want && this.open > 0) {
      for (const v of this.game.vehicles.list) {
        if (!v.alive || Math.hypot(v.x - this.hall.x, v.z - this.hall.z) > 16) continue;
        const [vx, vz] = this.local(v.x, v.z);
        if (Math.abs(vx) < this.W / 2 + 1 && Math.abs(vz - this.z0) < (v.hl ?? 2.5) + 0.8) { want = true; break; }
      }
    }
    const before = this.open;
    this.open = Math.max(0, Math.min(1, this.open + (want ? dt : -dt) / 2.6));
    if (this.open !== before) this.place();
  }

  inside(x, z) { const [lx, lz] = this.local(x, z), hw = this.hall.w / 2, hd = this.hall.d / 2; return Math.abs(lx) < hw - 1.1 && lz > -hd + 1.0 && lz < hd - 1.2; }
}

export class Services {
  constructor(game) {
    this.game = game;
    const sites = game.ctx.services || [];
    this.fuel = sites.filter((s) => s.kind === 'fuel');
    this.shops = sites.filter((s) => s.kind === 'repair');
    const mats = {
      slat: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, roughness: 0.45, metalness: 0.55 }),
      rib: new THREE.MeshStandardMaterial({ color: 0x8a9098, roughness: 0.5, metalness: 0.5 }),
      win: new THREE.MeshStandardMaterial({ color: 0x2c3c48, roughness: 0.1, metalness: 0.6 }),
    };
    this.doors = this.shops.map((s) => new ShopDoor(game, s, mats));
    // Zapfpistole (in der Hand) und Schlauch
    this.hoseMat = new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 });
    this.hose = new THREE.Mesh(new THREE.BufferGeometry(), this.hoseMat);
    this.hose.visible = false; this.hose.frustumCulled = false; this.hose.castShadow = true;
    game.scene.add(this.hose);
    this.nozzle = new THREE.Group();
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.05), new THREE.MeshStandardMaterial({ color: 0x18a050, roughness: 0.5 }));
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.18), new THREE.MeshStandardMaterial({ color: 0x222326, roughness: 0.4, metalness: 0.4 }));
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.3, metalness: 0.8 }));
    body.position.set(0, -0.05, 0.08); spout.rotation.x = Math.PI / 2; spout.position.set(0, -0.06, 0.24);
    this.nozzle.add(grip, body, spout);
    this.hold = null;       // { site, pump, prev }
    this.refuel = null;     // { v, t, dur }
    this.repairT = 0; this.repaired = null;
  }

  _pumpNear(p, r = 1.5) {
    let best = null, bd = r;
    for (const s of this.fuel) {
      if (Math.abs(s.x - p.x) > 30 || Math.abs(s.z - p.z) > 30) continue;
      for (const pu of s.pumps) { const d = Math.hypot(pu.x - p.x, pu.z - p.z); if (d < bd) { bd = d; best = { site: s, pump: pu }; } }
    }
    return best;
  }

  _carNear(p) {
    const g = this.game;
    return g.vehicles.nearest(p.x, p.z, 4.2, (v) => v.alive && !v.exploded && v.usesFuel && !(v.driver && v.driver !== p) && Math.hypot(v.x - p.x, v.z - p.z) < (v.hl ?? 2.4) + 1.3);
  }

  // Hinweistext für die Interaktionszeile (null = nichts von hier)
  prompt(p, pad) {
    if (p.vehicle || !p.alive) return null;
    const use = pad ? 'Y' : 'F';
    if (this.refuel) return `Tanke … ${Math.round((this.refuel.t / this.refuel.dur) * 100)} %`;
    if (this.hold) {
      const v = this._carNear(p);
      if (v) return v.fuel >= 0.99 ? 'Der Tank ist voll' : `<kbd>${use}</kbd>Volltanken (${fmtMoney(FUEL_PRICE)})`;
      if (this._pumpNear(p, 1.8)) return `<kbd>${use}</kbd>Zapfpistole zurückhängen`;
      return 'Zapfpistole in der Hand – geh zum Fahrzeug';
    }
    if (this._pumpNear(p)) return `<kbd>${use}</kbd>Zapfpistole nehmen`;
    return null;
  }

  // F/Y gedrückt: true, wenn hier etwas passiert ist
  interact(p) {
    const g = this.game;
    if (p.vehicle) return false;
    if (this.refuel) return true;
    if (this.hold) {
      const v = this._carNear(p);
      if (v) {
        if (v.fuel >= 0.99) { g.ui?.notify('Der Tank ist schon voll', 'info'); return true; }
        if (g.money < FUEL_PRICE) { g.ui?.notify(`Nicht genug Geld zum Tanken (${fmtMoney(FUEL_PRICE)})`, 'warn'); return true; }
        this.refuel = { v, t: 0, dur: 2.8, ctl: g.controlsEnabled };
        g.controlsEnabled = false;
        p.h = Math.atan2(v.x - p.x, v.z - p.z);
        return true;
      }
      if (this._pumpNear(p, 1.8)) { this.release(); return true; }
      return false;
    }
    const pu = this._pumpNear(p);
    if (!pu) return false;
    this.hold = { ...pu, prev: p.cur };
    p.setWeapon('fists');
    p.human?.setWeapon(this.nozzle);
    p.nozzle = true;
    this.hose.visible = true;
    g.ui?.notify('Zapfpistole genommen – geh zu deinem Fahrzeug', 'info');
    return true;
  }

  release(msg) {
    const p = this.game.player;
    if (!this.hold) return;
    p.nozzle = false;
    const prev = this.hold.prev;
    this.hold = null;
    this.hose.visible = false;
    if (prev && p.hasWeapon(prev)) p.setWeapon(prev); else p._applyWeaponModel();
    if (msg) this.game.ui?.notify(msg, 'info');
  }

  _hose(p) {
    const pu = this.hold.pump;
    const y0 = this.game.physics.groundHeight(pu.x, pu.z);
    const a = new THREE.Vector3(pu.x, y0 + 1.05, pu.z);
    const b = p.human?.hand ? p.human.hand.getWorldPosition(_v).clone() : new THREE.Vector3(p.x, p.y + 1.0, p.z);
    const d = a.distanceTo(b);
    const sag = Math.max(0.15, 1.25 - d * 0.12);
    const m1 = a.clone().lerp(b, 0.33), m2 = a.clone().lerp(b, 0.66);
    m1.y = Math.max(y0 + 0.08, Math.min(a.y, b.y) - sag); m2.y = Math.max(y0 + 0.08, Math.min(a.y, b.y) - sag * 0.7);
    const curve = new THREE.CatmullRomCurve3([a, m1, m2, b]);
    const geo = new THREE.TubeGeometry(curve, 28, 0.024, 6, false);
    this.hose.geometry.dispose();
    this.hose.geometry = geo;
  }

  update(dt) {
    const g = this.game, p = g.player;
    const at = p.vehicle || p;
    for (const d of this.doors) if (Math.abs(d.hall.x - at.x) < 120 && Math.abs(d.hall.z - at.z) < 120) d.update(dt, at.x, at.z);
    // Zapfpistole
    if (this.hold) {
      if (p.vehicle || !p.alive) this.release();
      else if (Math.hypot(this.hold.pump.x - p.x, this.hold.pump.z - p.z) > HOSE + 0.8) this.release('Der Schlauch ist zu kurz – Zapfpistole eingehängt');
      else this._hose(p);
    }
    if (this.refuel) {
      const r = this.refuel;
      r.t += dt;
      if (!p.alive || !r.v.alive || r.v.exploded) { g.controlsEnabled = r.ctl; this.refuel = null; }
      else if (r.t >= r.dur) {
        g.controlsEnabled = r.ctl;
        this.refuel = null;
        if (g.spend(FUEL_PRICE)) { r.v.fuel = 1; r.v._lowWarned = r.v._emptyWarned = false; g.ui?.notify(`Vollgetankt – ${fmtMoney(FUEL_PRICE)}`, 'good'); g.audio?.pickup?.(); }
        this.release();
      }
    }
    // Werkstatt: im Fahrzeug in der Halle anhalten
    const v = p.vehicle;
    const shop = v ? this.doors.find((d) => d.inside(v.x, v.z)) : null;
    if (!shop) { this.repairT = 0; this.repaired = null; }
    else if (this.repaired !== v && Math.abs(v.speed || 0) < 1.5 && !v.exploded) {
      this.repairT += dt;
      if (this.repairT > 1.2) {
        this.repaired = v;
        const { pct, cost } = repairCost(v);
        if (pct <= 0 && v.burning <= 0) g.ui?.notify('Dein Fahrzeug ist unbeschädigt', 'info');
        else if (g.money < cost) g.ui?.notify(`Reparatur kostet ${fmtMoney(cost)} – nicht genug Geld`, 'warn');
        else {
          g.spend(cost);
          v.hp = v.maxHp; v.burning = 0; v.engineOn = true;
          g.ui?.notify(`Repariert (${pct} % Schaden) – ${fmtMoney(cost)}`, 'good');
          for (let k = 0; k < 6; k++) g.effects.sparks(v.x + (Math.random() - 0.5) * 2, v.y + 0.8, v.z + (Math.random() - 0.5) * 3, 5);
          g.audio?.pickup?.();
        }
      }
    }
    // Tankwarnung
    if (v && v.usesFuel) {
      if (v.fuel < 0.15 && !v._lowWarned && v.fuel > 0) { v._lowWarned = true; g.ui?.notify('Tank fast leer – fahre zur nächsten Tankstelle', 'warn', 5000); }
      if (v.fuel <= 0 && !v._emptyWarned) { v._emptyWarned = true; g.ui?.notify('Der Tank ist leer!', 'warn', 5000); }
      if (v.fuel > 0.3) v._lowWarned = false;
    }
  }
}
