// Restaurants zur Laufzeit: automatische Schiebetür aus Glas (öffnet, wenn jemand davorsteht), Bestellen an der Theke
// (F: Speisekarte, das Essen füllt die Gesundheit auf) und ein paar Gäste, die an den Tischen sitzen.
import * as THREE from 'three';
import { RESTO, KINDS, TABLES } from './restaurants.js';
import { fmtMoney } from '../util.js';

const GUEST_R = 110;

export class Restaurants {
  constructor(game) {
    this.game = game;
    this.sites = game.ctx.restaurants || [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fb8c2, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false });
    const frame = new THREE.MeshStandardMaterial({ color: 0x1e1f22, roughness: 0.4, metalness: 0.6 });
    const D = RESTO.door, pw = D.w / 2;
    const gGeo = new THREE.BoxGeometry(pw, 2.45, 0.03), fGeo = new THREE.BoxGeometry(0.05, 2.45, 0.05), hGeo = new THREE.BoxGeometry(pw, 0.05, 0.05);
    for (const st of this.sites) {
      const b = st.building;
      const yF = b.base + 0.12;
      const root = new THREE.Group();
      const q = this.toWorld(st, D.x, -RESTO.D / 2 + 0.12);
      root.position.set(q.x, yF, q.z); root.rotation.y = st.rot;
      st.panels = [-1, 1].map((sg) => {
        const p = new THREE.Group();
        const g = new THREE.Mesh(gGeo, glass); g.position.y = 1.225; g.renderOrder = 3; p.add(g);
        for (const ex of [-pw / 2, pw / 2]) { const f = new THREE.Mesh(fGeo, frame); f.position.set(ex, 1.225, 0); p.add(f); }
        for (const ey of [0.03, 2.42]) { const h = new THREE.Mesh(hGeo, frame); h.position.set(0, ey, 0); p.add(h); }
        p.position.x = sg * pw / 2;
        root.add(p);
        return { p, sg };
      });
      this.group.add(root);
      st.open = 0; st.yF = yF;
      st.dCol = { k: 'b', x: q.x, z: q.z, hx: D.w / 2, hz: 0.1, c: Math.cos(st.rot), s: Math.sin(st.rot), y0: yF - 0.3, y1: yF + 2.6 };
      game.physics.addColliders([st.dCol]);
      st.dc = this.toWorld(st, D.x, -RESTO.D / 2);
      st.guests = [];
      // Bestellen an der Theke (unsichtbarer Marker, man steht davor)
      game.markers.add({ x: st.order.x, z: st.order.z, y: yF, radius: 0.8, height: 1, invisible: true, hint: `${st.name}: Essen bestellen`, onInteract: () => this.menu(st), interactRadius: 1.6 });
    }
  }

  toWorld(st, lx, lz) { const c = Math.cos(st.rot), s = Math.sin(st.rot); return { x: st.x + c * lx + s * lz, z: st.z - s * lx + c * lz }; }

  // Speisekarte: jedes Gericht kostet etwas und füllt die Gesundheit auf
  menu(st) {
    const g = this.game, p = g.player, K = KINDS[st.kind];
    const full = p.hp >= p.maxHp;
    const items = K.menu.map(([name, price, heal]) => ({
      label: name,
      sub: `${fmtMoney(price)} · +${heal} Gesundheit${full ? ' · du bist satt' : ''}`,
      disabled: full || g.money < price,
      fn: () => {
        if (!g.spend(price)) { g.ui.notify('Nicht genug Geld', 'warn'); return; }
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + heal);
        p.stamina = 1; p.exhausted = false;
        g.stats.meals = (g.stats.meals || 0) + 1;
        g.audio?.pickup?.();
        g.ui.notify(`Guten Appetit! ${name} (+${Math.round(p.hp - before)} Gesundheit)`, 'good');
        this.menu(st);
      },
    }));
    g.ui.panels.listMenu(K.name, items, `Dein Geld: ${fmtMoney(g.money)} · Gesundheit ${Math.round(p.hp)}/${p.maxHp}`);
  }

  _guests(st) {
    const g = this.game;
    st.guests = st.guests.filter((c) => c.alive && !c.dropped && c.ai && c.ai.mode === 'sit');
    if (st.guests.length || st.seated) return;
    st.seated = true;
    const n = 1 + Math.floor(Math.random() * 3);
    const chairs = [];
    for (const [x, z] of TABLES) for (const sx of [-1, 1]) chairs.push([x + sx * 0.72, z, sx]);
    chairs.sort(() => Math.random() - 0.5);
    for (let i = 0; i < n; i++) {
      const [lx, lz, sx] = chairs[i];
      const q = this.toWorld(st, lx, lz);
      const ch = g.peds._make(['local', 'tourist', 'business', 'elder'][Math.floor(Math.random() * 4)], q.x, q.z, { mode: 'sit' });
      if (!ch) continue;
      // Blick zum Tisch (lokal −sx · x)
      const fx = -sx * Math.cos(st.rot), fz = sx * Math.sin(st.rot);
      ch.h = Math.atan2(fx, fz); ch.y = st.yF; ch.anim.sit = true;
      ch.ai.t = 1e9;
      ch.scripted = () => { ch.vx = ch.vz = 0; ch.y = st.yF; };   // sitzt fest auf dem Stuhl (keine Schubser durch die Stuhl-Kollision)
      st.guests.push(ch);
    }
  }

  update(dt) {
    const g = this.game, p = g.player;
    for (const st of this.sites) {
      const d = Math.hypot(st.x - p.x, st.z - p.z);
      if (d > 400) continue;
      // Tür: offen, wenn der Spieler oder ein Passant davor oder dahinter steht
      let want = !p.vehicle && Math.hypot(p.x - st.dc.x, p.z - st.dc.z) < 2.6;
      if (!want && d < 60) for (const c of g.peds.list) if (c.alive && c.state !== 'vehicle' && Math.hypot(c.x - st.dc.x, c.z - st.dc.z) < 2.2) { want = true; break; }
      const before = st.open;
      st.open = Math.max(0, Math.min(1, st.open + (want ? dt * 2.2 : -dt * 1.3)));
      if (st.open !== before) {
        const e = st.open < 0.5 ? 2 * st.open * st.open : 1 - Math.pow(-2 * st.open + 2, 2) / 2;
        for (const { p: m, sg } of st.panels) m.position.x = sg * (RESTO.door.w / 4 + e * RESTO.door.w * 0.5);
        st.dCol.y0 = st.open > 0.45 ? 1e9 : st.yF - 0.3;
      }
      if (d < GUEST_R && d > 25) this._guests(st);
      else if (d > 200) st.seated = false;
    }
  }
}
