// Ampeln zur Laufzeit: moderne Masten mit Signalgebern (rot, gelb, grün, mit Blenden und Kontrasttafel), bei breiten
// Straßen zusätzlich ein Ausleger über der Fahrbahn. Gezeichnet werden nur Ampeln in der Nähe der Kamera; die Schaltung
// läuft für alle (world/trafficlights.js: lightState). Die KI fragt state(Straße, Ende) und hält bei Rot an der Haltelinie.
import * as THREE from 'three';
import { lightState } from './trafficlights.js';

const VIEW = 260;                          // Ampeln in diesem Umkreis werden gezeichnet
const ON = { r: [3.4, 0.16, 0.08], y: [3.2, 1.7, 0.08], g: [0.12, 2.8, 1.25] };
const OFF = { r: [0.16, 0.035, 0.03], y: [0.15, 0.11, 0.025], g: [0.025, 0.11, 0.07] };

export class TrafficLightSystem {
  constructor(game) {
    this.game = game;
    this.lights = game.ctx.trafficLights || [];
    this.byArm = game.ctx.lightByArm || new Map();
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.t = 0;
    this.built = new Map();                // Ampel-Id → { root, heads: [{ grp, lens: [r, y, g] }] }
    this.scanT = 0;
    const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: new THREE.Color(...c), roughness: o.r ?? 0.5, metalness: o.m ?? 0.55 });
    this.mPole = mat([0.17, 0.18, 0.2]);
    this.mHouse = mat([0.06, 0.065, 0.075], { r: 0.4, m: 0.3 });
    this.mBoard = mat([0.03, 0.03, 0.035], { r: 0.7, m: 0.1 });
    this.mEdge = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.5 });
    this.lens = {};
    for (const k of ['r', 'y', 'g']) {
      this.lens[k + '1'] = new THREE.MeshBasicMaterial({ color: new THREE.Color(...ON[k]) });
      this.lens[k + '0'] = new THREE.MeshBasicMaterial({ color: new THREE.Color(...OFF[k]) });
    }
    // Geometrien (einmal)
    this.gPole = new THREE.CylinderGeometry(0.075, 0.09, 1, 12); this.gPole.translate(0, 0.5, 0);
    this.gBase = new THREE.CylinderGeometry(0.16, 0.2, 0.12, 12); this.gBase.translate(0, 0.06, 0);
    this.gArm = new THREE.CylinderGeometry(0.055, 0.065, 1, 10); this.gArm.rotateZ(Math.PI / 2); this.gArm.translate(-0.5, 0, 0);
    this.gHouse = new THREE.BoxGeometry(0.3, 0.92, 0.22);
    this.gBoard = new THREE.BoxGeometry(0.56, 1.14, 0.03);
    this.gEdge = new THREE.BoxGeometry(0.6, 1.18, 0.02);
    this.gLens = new THREE.CircleGeometry(0.105, 20);
    this.gVisor = new THREE.CylinderGeometry(0.125, 0.125, 0.2, 14, 1, true, -Math.PI / 2, Math.PI); this.gVisor.rotateX(Math.PI / 2); this.gVisor.translate(0, 0, 0.1);
    this.gButton = new THREE.BoxGeometry(0.12, 0.2, 0.08);
    // Masten sind fest: Kollider für alle Ampeln
    const cols = [];
    for (const L of this.lights) for (const a of L.arms) cols.push({ k: 'c', x: a.pole.x, z: a.pole.z, r: 0.14, y0: a.pole.y - 1, y1: a.pole.y + 6, prop: 'trafficlight' });
    game.physics.addColliders(cols);
  }

  // Zustand für die KI: Straße r, Ende 'a'/'b' → { state, arm } oder null
  stateFor(r, end) {
    const e = this.byArm.get(r.id + end);
    if (!e) return null;
    return { state: lightState(e.L, e.arm.grp, this.t), arm: e.arm };
  }

  _head(root, x, y, z, grp, heads, board = true) {
    const h = new THREE.Group(); h.position.set(x, y, z);
    if (board) {
      const e = new THREE.Mesh(this.gEdge, this.mEdge); e.position.z = -0.13; h.add(e);
      const b = new THREE.Mesh(this.gBoard, this.mBoard); b.position.z = -0.115; h.add(b);
    }
    const hs = new THREE.Mesh(this.gHouse, this.mHouse); hs.castShadow = true; h.add(hs);
    const lens = [];
    ['r', 'y', 'g'].forEach((k, i) => {
      const yy = 0.29 - i * 0.29;
      const l = new THREE.Mesh(this.gLens, this.lens[k + '0']); l.position.set(0, yy, 0.112); h.add(l);
      const v = new THREE.Mesh(this.gVisor, this.mHouse); v.position.set(0, yy, 0.11); h.add(v);
      lens.push(l);
    });
    root.add(h);
    heads.push({ grp, lens, st: '' });
  }

  _build(L) {
    const root = new THREE.Group(), heads = [];
    for (const a of L.arms) {
      const g = new THREE.Group();
      g.position.set(a.pole.x, a.pole.y, a.pole.z);
      g.rotation.y = a.rot;                            // lokal +z zeigt den ankommenden Fahrzeugen entgegen
      const wide = a.w >= 9;
      const H = wide ? 5.6 : 3.6;
      const base = new THREE.Mesh(this.gBase, this.mPole); g.add(base);
      const pole = new THREE.Mesh(this.gPole, this.mPole); pole.scale.y = H; pole.castShadow = true; g.add(pole);
      // Signalgeber am Mast (Augenhöhe der Fahrer) und Taster für Fußgänger auf der Rückseite
      this._head(g, 0, 2.75, 0.17, a.grp, heads, false);
      const btn = new THREE.Mesh(this.gButton, this.mHouse); btn.position.set(0, 1.1, -0.1); g.add(btn);
      if (wide) {
        // Ausleger zur Fahrbahnmitte (lokal −x), Signalgeber über der ankommenden Spur
        const side = a.w / 2 + 0.65, len = Math.max(2.5, side - a.w * (a.lanes >= 4 ? 0.25 : 0.3));
        const arm = new THREE.Mesh(this.gArm, this.mPole); arm.scale.x = len + 0.2; arm.position.y = H - 0.15; arm.castShadow = true; g.add(arm);
        this._head(g, -len, H - 0.85, 0.05, a.grp, heads, true);
      } else {
        this._head(g, 0, H - 0.25, 0.17, a.grp, heads, true);
      }
      root.add(g);
    }
    this.group.add(root);
    return { root, heads };
  }

  update(dt) {
    this.t += dt;
    const cam = this.game.camera.position;
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 0.5;
      for (const L of this.lights) {
        const near = Math.abs(L.x - cam.x) < VIEW && Math.abs(L.z - cam.z) < VIEW && Math.hypot(L.x - cam.x, L.z - cam.z) < VIEW;
        const b = this.built.get(L.id);
        if (near && !b) this.built.set(L.id, this._build(L));
        else if (!near && b && Math.hypot(L.x - cam.x, L.z - cam.z) > VIEW + 40) { this.group.remove(b.root); this.built.delete(L.id); }
      }
    }
    // Signalbilder schalten
    for (const [id, b] of this.built) {
      const L = this.lights[id];
      const s0 = lightState(L, 0, this.t), s1 = lightState(L, 1, this.t);
      for (const h of b.heads) {
        const st = h.grp ? s1 : s0;
        if (st === h.st) continue;
        h.st = st;
        h.lens[0].material = this.lens[st === 'r' || st === 'ry' ? 'r1' : 'r0'];
        h.lens[1].material = this.lens[st === 'y' || st === 'ry' ? 'y1' : 'y0'];
        h.lens[2].material = this.lens[st === 'g' ? 'g1' : 'g0'];
      }
    }
  }
}
