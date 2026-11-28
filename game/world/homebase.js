// Strandhaus zur Laufzeit: begehbare Böden, Haustür (schwingt auf) und Sektionaltor der Garage (rollt in Schienen
// unter die Decke), beide öffnen sich automatisch. Ein Fahrzeug, das der Spieler in der Garage abstellt, gehört ihm.
import * as THREE from 'three';
import { HOUSE, GARAGE_IN } from './beachhouse.js';
import { VEHICLE_TYPES } from '../entities/vehicle_models.js';
import { makeWeaponModel } from '../combat/weapons.js';

const GARAGE_CLS = new Set(['car', 'bike']);
const NOT_KEEPABLE = new Set(['police']);
const SLAT_N = 6;
const TRACK_R = 0.3;                                   // Radius der Umlenkung oben am Tor

export class HomeBase {
  constructor(game) {
    this.game = game;
    const home = game.ctx.home;
    this.home = home;
    if (!home || !home.mainB || !home.garageB) { this.home = null; return; }
    const mb = home.mainB, gb = home.garageB;
    this.yM = mb.base + 0.12; this.yG = gb.base + 0.12;
    this.gOpen = 0; this.dOpen = 0; this.parkT = 0;

    // Böden als Plattformen (das Dünengelände darunter steigt an; so steht man immer auf den Dielen)
    const hd = mb.d / 2, PO = HOUSE.porch;
    const plat = (b, lx, lz, w, d, top) => { const q = this.toWorld(b, lx, lz); return { x: q.x, z: q.z, w, d, rot: b.rot, top, rad: Math.hypot(w, d) / 2 }; };
    this.platforms = [
      plat(mb, 0, 0, mb.w, mb.d, this.yM),
      plat(gb, 0, 0, gb.w, gb.d, this.yG),
      plat(mb, 0, -hd - PO.d / 2, PO.w, PO.d, this.yM),
      plat(mb, 0, -hd - PO.d - PO.step / 2, PO.w, PO.step, this.yM - 0.2),
    ];
    // Stufen zwischen Terrasse und Glasfront (begehbar)
    if (mb.stairs) {
      const dy = (mb.deckY ?? this.yM) + 0.074;
      for (let j = 1; j < mb.stairs.n; j++) { const d = (mb.stairs.n - j) * 0.3; this.platforms.push(plat(mb, -0.225, 6.55 + d / 2, 8.25, d, dy + j * mb.stairs.rise)); }
    }
    game.physics.addPlatforms(this.platforms);

    this.group = new THREE.Group();
    game.scene.add(this.group);
    this._buildGarageDoor(gb);
    this._buildHouseDoor(mb);
    this._buildSafe(mb);
    // Warmes Licht innen (immer in der Szene, damit sich die Lichtanzahl der Shader nie ändert; aus = Stärke 0)
    this.lights = [
      { l: new THREE.PointLight(0xffd6a0, 0, 16, 1.4), b: mb, lx: 0, lz: 0.5, y: this.yM + 3.2, on: 36 },
      { l: new THREE.PointLight(0xfff2dc, 0, 11, 1.4), b: gb, lx: 0, lz: 0, y: this.yG + 2.8, on: 16 },
      // Feuerschale auf der Terrasse (flackert)
      { l: new THREE.PointLight(0xff8a38, 0, 11, 1.5), b: mb, lx: 5.4, lz: 11.2 + (mb.furnZ || 0), y: (mb.deckY ?? this.yM) + 1.25, on: 16, fire: true },
    ];
    this.fireT = 0;
    for (const L of this.lights) { const q = this.toWorld(L.b, L.lx, L.lz); L.l.position.set(q.x, L.y, q.z); L.l.castShadow = false; this.group.add(L.l); }
  }

  toWorld(b, lx, lz) { const c = Math.cos(b.rot), s = Math.sin(b.rot); return { x: b.x + c * lx + s * lz, z: b.z - s * lx + c * lz }; }
  toLocal(b, x, z) { const c = Math.cos(b.rot), s = Math.sin(b.rot), dx = x - b.x, dz = z - b.z; return { x: c * dx - s * dz, z: s * dx + c * dz }; }

  // ---------- Garagentor ----------
  _buildGarageDoor(gb) {
    const D = GARAGE_IN.door;
    this.gRoot = new THREE.Group();
    this.gRoot.position.set(gb.x, this.yG, gb.z);
    this.gRoot.rotation.y = gb.rot;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.14, 0.14, 0.155), roughness: 0.45, metalness: 0.5 });
    const groove = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.055, 0.055, 0.065), roughness: 0.6, metalness: 0.4 });
    this.slatH = D.h / SLAT_N;
    const geo = new THREE.BoxGeometry(D.w, this.slatH - 0.012, 0.05);
    const gGeo = new THREE.BoxGeometry(D.w - 0.04, 0.03, 0.02);
    this.slats = [];
    for (let i = 0; i < SLAT_N; i++) {
      const m = new THREE.Mesh(geo, mat);
      const gr = new THREE.Mesh(gGeo, groove); gr.position.set(0, 0, -0.035); m.add(gr);
      if (i === 1) { const h = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), groove); h.position.set(0, 0, -0.05); m.add(h); }
      m.castShadow = true; m.receiveShadow = true;
      this.gRoot.add(m);
      this.slats.push(m);
    }
    // Schienen innen (seitlich und unter der Decke)
    const rail = new THREE.MeshStandardMaterial({ color: 0x55575c, roughness: 0.5, metalness: 0.6 });
    for (const sg of [-1, 1]) {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.05, D.h, 0.05), rail); v.position.set(sg * (D.w / 2 + 0.03), D.h / 2, this._z0() + 0.06); this.gRoot.add(v);
      const hz = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, D.h + 0.2), rail); hz.position.set(sg * (D.w / 2 + 0.03), D.h + TRACK_R + 0.04, this._z0() + TRACK_R + D.h / 2); this.gRoot.add(hz);
    }
    this.group.add(this.gRoot);
    // Kollider im Torrahmen; seine Unterkante wandert mit dem Tor nach oben
    const q = this.toWorld(gb, 0, this._z0());
    this.gCol = { k: 'b', x: q.x, z: q.z, hx: D.w / 2, hz: 0.14, c: Math.cos(gb.rot), s: Math.sin(gb.rot), y0: this.yG - 0.3, y1: this.yG + D.h + 0.4 };
    this.game.physics.addColliders([this.gCol]);
    this._placeSlats();
  }

  _z0() { return -this.home.garageB.d / 2 + 0.12; }

  // Punkt auf der Torschiene (Länge s ab Boden): senkrecht hoch, Viertelkreis, waagerecht unter die Decke
  _track(s) {
    const H = GARAGE_IN.door.h, z0 = this._z0(), arc = (Math.PI / 2) * TRACK_R;
    if (s <= H) return [s, z0];
    if (s <= H + arc) { const t = (s - H) / TRACK_R; return [H + Math.sin(t) * TRACK_R, z0 + (1 - Math.cos(t)) * TRACK_R]; }
    return [H + TRACK_R, z0 + TRACK_R + (s - H - arc)];
  }

  _placeSlats() {
    const H = GARAGE_IN.door.h, arc = (Math.PI / 2) * TRACK_R;
    const e = this.gOpen < 0.5 ? 2 * this.gOpen * this.gOpen : 1 - Math.pow(-2 * this.gOpen + 2, 2) / 2;   // sanft an- und auslaufen
    const shift = e * (H + arc);
    for (let i = 0; i < SLAT_N; i++) {
      const s0 = i * this.slatH + shift;
      const [y0, z0] = this._track(s0), [y1, z1] = this._track(s0 + this.slatH);
      const m = this.slats[i];
      m.position.set(0, (y0 + y1) / 2, (z0 + z1) / 2);
      m.rotation.x = Math.atan2(z1 - z0, y1 - y0);
    }
    this.gCol.y0 = this.yG + Math.min(shift, H) - 0.05;
  }

  // ---------- Haustür ----------
  _buildHouseDoor(mb) {
    const D = HOUSE.door, hd = mb.d / 2;
    this.dRoot = new THREE.Group();
    const hinge = this.toWorld(mb, D.x - D.w / 2, -hd + 0.15);
    this.dRoot.position.set(hinge.x, this.yM, hinge.z);
    this.dRoot.rotation.y = mb.rot;
    this.dPivot = new THREE.Group();
    this.dRoot.add(this.dPivot);
    const geo = new THREE.BoxGeometry(D.w, D.h, 0.07); geo.translate(D.w / 2, D.h / 2, 0);
    const leaf = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(0.1, 0.1, 0.11), roughness: 0.45, metalness: 0.35 }));
    leaf.castShadow = true; leaf.receiveShadow = true;
    this.dPivot.add(leaf);
    const panel = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.3, 0.17, 0.09), roughness: 0.55 });
    for (const [py, ph] of [[0.55, 0.7], [1.55, 0.9]]) for (const sz of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(D.w - 0.3, ph, 0.02), panel); p.position.set(D.w / 2, py, sz * 0.042); this.dPivot.add(p);
    }
    // senkrechte, leuchtende Griffleiste
    const knobM = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.35, 0.55) });
    for (const sz of [-1, 1]) { const k = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.85, 0.035), knobM); k.position.set(D.w - 0.14, 1.15, sz * 0.075); this.dPivot.add(k); }
    this.group.add(this.dRoot);
    const q = this.toWorld(mb, D.x, -hd + 0.15);
    this.dCenter = q;
    this.dCol = { k: 'b', x: q.x, z: q.z, hx: D.w / 2, hz: 0.12, c: Math.cos(mb.rot), s: Math.sin(mb.rot), y0: this.yM - 0.3, y1: this.yM + D.h };
    this.game.physics.addColliders([this.dCol]);
  }

  // ---------- Tresor (Schlafzimmer, neben dem Kleiderschrank) ----------
  // Zu Beginn liegt darin die Pistole mit Munition; wer ihn mit F öffnet, nimmt sie heraus (owned.safeTaken).
  _buildSafe(mb) {
    const S = HOUSE.safe, T = 0.045;
    const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.16, 0.17, 0.19), roughness: 0.38, metalness: 0.75 });
    const inner = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.32, 0.05, 0.06), roughness: 0.9 });   // roter Filz innen
    const chrome = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.8, 0.8, 0.82), roughness: 0.18, metalness: 1 });
    const root = new THREE.Group();
    const q = this.toWorld(mb, S.x, S.z);
    root.position.set(q.x, this.yM, q.z); root.rotation.y = mb.rot;
    const box = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; root.add(o); return o; };
    // Gehäuse (vorn offen), Innenfutter und Zwischenboden
    box(S.w, S.h, T, 0, S.h / 2, -S.d / 2 + T / 2, steel);
    for (const sx of [-1, 1]) box(T, S.h, S.d, sx * (S.w / 2 - T / 2), S.h / 2, 0, steel);
    box(S.w, T, S.d, 0, S.h - T / 2, 0, steel);
    box(S.w, 0.06, S.d, 0, 0.03, 0, steel);
    box(S.w - 2 * T, S.h - 0.1, 0.01, 0, S.h / 2, -S.d / 2 + T + 0.006, inner);
    box(S.w - 2 * T, 0.02, S.d - T - 0.02, 0, 0.47, 0.01, steel);
    box(S.w - 2 * T, 0.012, S.d - T - 0.03, 0, 0.487, 0.01, inner);
    // Tür an Scharnieren links: Drehrad, Zahlenfeld mit Leuchte, Griff
    this.safeDoor = new THREE.Group();
    this.safeDoor.position.set(-S.w / 2, 0, S.d / 2);
    root.add(this.safeDoor);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(S.w, S.h, 0.07), steel); leaf.position.set(S.w / 2, S.h / 2, 0.035); leaf.castShadow = true; this.safeDoor.add(leaf);
    const add = (geo, m, x, y, z, rx = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.x = rx; this.safeDoor.add(o); return o; };
    add(new THREE.CylinderGeometry(0.085, 0.085, 0.025, 28), chrome, S.w / 2, S.h * 0.58, 0.083, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.06, 0.07, 0.02, 24), steel, S.w / 2, S.h * 0.58, 0.1, Math.PI / 2);
    for (let i = 0; i < 3; i++) { const sp = add(new THREE.BoxGeometry(0.018, 0.2, 0.018), chrome, S.w / 2, S.h * 0.58, 0.115); sp.rotation.z = i * Math.PI / 3; }
    add(new THREE.BoxGeometry(0.15, 0.2, 0.012), new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.3, metalness: 0.4 }), S.w / 2, S.h * 0.28, 0.076);
    this.safeLed = add(new THREE.BoxGeometry(0.03, 0.016, 0.01), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.25, 0.2) }), S.w / 2 + 0.04, S.h * 0.28 + 0.07, 0.084);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) add(new THREE.BoxGeometry(0.028, 0.022, 0.008), chrome, S.w / 2 - 0.04 + c * 0.04, S.h * 0.28 + 0.025 - r * 0.035, 0.084);
    add(new THREE.BoxGeometry(0.03, 0.22, 0.03), chrome, S.w - 0.07, S.h * 0.58, 0.1);
    for (const y of [0.18, S.h - 0.18]) add(new THREE.CylinderGeometry(0.018, 0.018, 0.12, 10), chrome, 0, y, 0.035);
    // Inhalt: Pistole auf dem Zwischenboden, Munitionsschachteln und Geldbündel darunter
    this.safeLoot = new THREE.Group();
    const gun = makeWeaponModel('pistol');
    if (gun) { gun.rotation.set(Math.PI / 2, 0, 1.4); gun.position.set(-0.02, 0.52, 0.02); gun.scale.setScalar(1.1); this.safeLoot.add(gun); }
    const ammo = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.75, 0.55, 0.12), roughness: 0.6 });
    for (const [x, z] of [[-0.14, -0.05], [-0.14, 0.06], [0.0, 0.0]]) { const a = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.07, 0.09), ammo); a.position.set(x, 0.095, z); this.safeLoot.add(a); }
    const cash = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.32, 0.55, 0.3), roughness: 0.8 });
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.08), cash); c.position.set(0.15, 0.08 + i * 0.042, -0.02); this.safeLoot.add(c); }
    root.add(this.safeLoot);
    this.group.add(root);
    this.safeRoot = root;
    this.safeOpen = 0; this.safeWant = false; this.safeTakeT = 0;
    this._syncSafe();
  }

  get safeFull() { return !this.game.owned.safeTaken; }
  _syncSafe() { if (this.safeLoot) this.safeLoot.visible = this.safeFull || this.safeTakeT > 0; }

  // F vor dem Tresor: Tür öffnen; liegt die Pistole noch darin, nimmt die Figur sie heraus
  openSafe() {
    const g = this.game, p = g.player;
    if (!this.safeDoor) return;
    this.safeWant = true;
    g.audio?.pickup?.();
    if (this.safeFull) {
      g.owned.safeTaken = true;
      this.safeTakeT = 0.9;                                 // der Inhalt verschwindet, wenn die Tür offen ist
      p.giveWeapon('pistol', 60);
      p.setWeapon('pistol');
      g.ui?.notify('Pistole und Munition aus dem Tresor genommen', 'good');
    } else g.ui?.notify('Der Tresor ist leer', 'info');
  }

  _updateSafe(dt) {
    if (!this.safeDoor) return;
    const p = this.game.player, sp = this.home.safe;
    if (this.safeWant && Math.hypot(p.x - sp.x, p.z - sp.z) > 2.6) this.safeWant = false;   // weggegangen: Tür fällt zu
    const before = this.safeOpen;
    this.safeOpen = Math.max(0, Math.min(1, this.safeOpen + (this.safeWant ? dt * 1.4 : -dt * 0.9)));
    if (this.safeOpen !== before) {
      const e = this.safeOpen < 0.5 ? 2 * this.safeOpen * this.safeOpen : 1 - Math.pow(-2 * this.safeOpen + 2, 2) / 2;
      this.safeDoor.rotation.y = -e * 1.95;
      this.safeLed.material.color.setRGB(this.safeOpen > 0.02 ? 0.25 : 2.4, this.safeOpen > 0.02 ? 2.2 : 0.25, 0.2);
    }
    if (this.safeTakeT > 0 && this.safeOpen > 0.6) { this.safeTakeT -= dt; if (this.safeTakeT <= 0) this._syncSafe(); }
  }

  // ---------- Aufwachen im Bett (nach dem Tod und nach dem Schlafen) ----------
  // Die Figur liegt im Bett, setzt sich auf, schwingt die Beine über die Bettkante und steht auf; die Kamera schaut dabei
  // aus dem Raum aufs Bett. Danach übernimmt der Spieler wieder.
  wakeUp(done = null) {
    const g = this.game, p = g.player, mb = this.home.mainB, bd = HOUSE.bed, r = mb.rot;
    const P0 = this.toWorld(mb, bd.x - 0.1, bd.z), P1 = this.toWorld(mb, bd.x + 0.3, bd.z + 0.85);
    const h0 = r + Math.PI / 2, h1 = r, DUR = 5.4;
    const yF = this.yM;
    if (p.vehicle) g.exitVehicle(p, true);
    p.state = 'ground'; p.vx = p.vz = 0; p.vy = 0; p.climb = null; p.aiming = false;
    p.x = P0.x; p.z = P0.z; p.y = yF; p.h = h0;
    p.anim.wake = 0; p.anim.lie = false; p.anim.sit = false;
    g.controlsEnabled = false;
    const camA = this.toWorld(mb, -1.05, -0.35), camB = this.toWorld(mb, -1.55, -0.95), look = this.toWorld(mb, bd.x + 0.2, bd.z + 0.2);
    let t = 0;
    const smooth = (x) => x * x * (3 - 2 * x);
    const place = () => {
      const k = Math.min(1, t / DUR), sw = smooth(Math.min(1, Math.max(0, (k - 0.45) / 0.21)));
      p.anim.wake = k;
      p.x = P0.x + (P1.x - P0.x) * sw; p.z = P0.z + (P1.z - P0.z) * sw; p.y = yF; p.h = h0 + (h1 - h0) * sw;
      const c = smooth(k);
      g.cineCam = { x: camA.x + (camB.x - camA.x) * c, y: yF + 1.55 + 0.25 * c, z: camA.z + (camB.z - camA.z) * c, lx: look.x, ly: yF + 0.75 + 0.35 * c, lz: look.z };
      return k;
    };
    place();
    p.scripted = (dt) => {
      t += dt;
      p.vx = p.vz = 0;
      if (place() < 1) return;
      // fertig: die Hüfte steht jetzt 0,42 m vor dem Ursprung → Figur dorthin, normale Pose
      p.x += Math.sin(h1) * 0.42; p.z += Math.cos(h1) * 0.42;
      p.anim.wake = null; p.scripted = null; g.cineCam = null;
      p.camYaw = h1; p.camPitch = -0.12; p.camInit = false;
      g.controlsEnabled = true;
      done && done();
    };
  }

  // ---------- Garage: Stellplätze und Besitz ----------
  insideGarage(x, z, margin = 0) {
    const gb = this.home.garageB, q = this.toLocal(gb, x, z);
    return Math.abs(q.x) < gb.w / 2 - 0.3 - margin && q.z > -gb.d / 2 + margin && q.z < gb.d / 2 - 0.3;
  }

  // Freier Stellplatz in der Garage (Fahrzeug schaut zum Tor) oder null
  freeSlot() {
    if (!this.home) return null;
    const gb = this.home.garageB;
    for (const s of GARAGE_IN.slots) {
      const q = this.toWorld(gb, s.x, s.z);
      if (!this.game.vehicles.list.some((v) => v.alive && Math.hypot(v.x - q.x, v.z - q.z) < 2.6)) return { x: q.x, z: q.z, h: gb.rot + Math.PI };
    }
    return null;
  }

  canKeep(v) {
    const T = VEHICLE_TYPES[v.type];
    return T && GARAGE_CLS.has(T.cls) && !NOT_KEEPABLE.has(v.type) && v.origOwner !== 'mission' && (v.hl ?? 2.5) * 2 <= 6.2;
  }

  // Abgestelltes Fahrzeug gehört ab jetzt dem Spieler (Speicherstand: owned.vehicles)
  claim(v) {
    const g = this.game;
    g.owned.vehicles.push({ type: v.type, paint: v.paintIdx });
    v.ownedIdx = g.owned.vehicles.length - 1;
    v.keep = true;
    g.ui?.notify(`${VEHICLE_TYPES[v.type].name} gehört jetzt dir – sicher in deiner Garage geparkt`, 'good');
    g.audio?.pickup?.();
  }

  // Beim Laden eines Spielstands: eigene Autos stehen wieder in der Garage
  fillGarage() {
    if (!this.home) return;
    const g = this.game, list = g.owned.vehicles;
    for (let i = list.length - 1; i >= 0; i--) {
      const T = VEHICLE_TYPES[list[i].type];
      if (!T || !GARAGE_CLS.has(T.cls)) continue;
      if (g.vehicles.list.some((v) => v.alive && v.ownedIdx === i)) continue;
      if (!this.freeSlot()) break;
      g.shops?.spawnOwned(i, null, true);
    }
  }

  update(dt) {
    if (!this.home) return;
    const g = this.game, p = g.player, gb = this.home.garageB;
    const at = p.vehicle || p;
    const near = Math.hypot(at.x - gb.x, at.z - gb.z) < 60;

    // Tor: offen, wenn der Spieler davor (bis 12 m) oder in der Garage ist; nie auf einem Fahrzeug schließen
    const lp = this.toLocal(gb, at.x, at.z);
    let want = near && p.alive && Math.abs(lp.x) < 7 && lp.z > -gb.d / 2 - 12 && lp.z < gb.d / 2 + 0.5;
    if (!want && this.gOpen > 0) {
      for (const v of g.vehicles.list) {
        if (!v.alive || Math.hypot(v.x - gb.x, v.z - gb.z) > 12) continue;
        const q = this.toLocal(gb, v.x, v.z);
        if (Math.abs(q.x) < GARAGE_IN.door.w / 2 + 1 && Math.abs(q.z - this._z0()) < (v.hl ?? 2.5) + 0.6) { want = true; break; }
      }
    }
    const before = this.gOpen;
    this.gOpen = Math.max(0, Math.min(1, this.gOpen + (want ? dt : -dt) / 2.4));
    if (this.gOpen !== before) this._placeSlats();

    // Haustür: öffnet, sobald man zu Fuß davorsteht (innen oder außen)
    const dd = Math.hypot(p.x - this.dCenter.x, p.z - this.dCenter.z);
    const dWant = !p.vehicle && p.alive && dd < 2.4 && Math.abs(p.y - this.yM) < 1.5;
    const db = this.dOpen;
    this.dOpen = Math.max(0, Math.min(1, this.dOpen + (dWant ? dt * 2.6 : -dt * 1.6)));
    if (this.dOpen !== db) {
      const e = 1 - Math.pow(1 - this.dOpen, 3);
      this.dPivot.rotation.y = -e * 1.75;
      this.dCol.y0 = this.dOpen > 0.3 ? 1e9 : this.yM - 0.3;
    }

    this._updateSafe(dt);

    // Licht: nachts und bei Annäherung
    const lightOn = near ? 1 : 0;
    for (const L of this.lights) L.l.intensity = L.on * lightOn * (0.35 + 0.65 * (g.atm?.night ?? 0)) * (L.fire ? 0.85 + 0.15 * Math.sin(g.time * 13) * Math.sin(g.time * 7.3) : 1);

    // Flammen in der Feuerschale
    const fl = this.lights[2];
    if (near && g.effects.fireP) {
      this.fireT = Math.min(0.2, this.fireT + dt);
      const fx = fl.l.position.x, fz = fl.l.position.z, fy = fl.y - 0.72;
      while (this.fireT > 0.04) {
        this.fireT -= 0.04;
        const a = Math.random() * 6.28, r = Math.random() * 0.36;
        g.effects.fireP.spawn(fx + Math.cos(a) * r, fy, fz + Math.sin(a) * r, (Math.random() - 0.5) * 0.15, 0.55 + Math.random() * 0.7, (Math.random() - 0.5) * 0.15, 0.35 + Math.random() * 0.35, 0.34, 0.05, [2.6, 1.15, 0.22, 0.75], [1.1, 0.2, 0.02, 0], -0.5, 0.4);
      }
    }

    // Parken: Fahrzeug langsam in der Garage → gehört dem Spieler
    const v = p.vehicle || p.lastVehicle;
    if (v && v.alive && !v.exploded && v.ownedIdx == null && near && this.insideGarage(v.x, v.z) && Math.abs(v.speed || 0) < 0.8) {
      if (!this.canKeep(v)) {
        if (!v._noKeepMsg) { v._noKeepMsg = true; g.ui?.notify(v.type === 'police' ? 'Polizeifahrzeuge kannst du nicht behalten' : 'Dieses Fahrzeug passt nicht in deine Garage', 'warn'); }
      } else if ((this.parkT += dt) > 0.8) { this.parkT = 0; this.claim(v); }
    } else this.parkT = 0;
  }
}
