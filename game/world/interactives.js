// Marker (Missions-/Shop-/Ziel-Säulen) und Pickups.
import * as THREE from 'three';

const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true);
const ringGeo = new THREE.RingGeometry(0.78, 1, 40);
ringGeo.rotateX(-Math.PI / 2);

export class Markers {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.time = 0;
  }

  // opts: { id, x, z, y?, label, color:[r,g,b], radius, onEnter, onInteract, blip:{icon,color}, type, vehicleOnly, onFoot, height, persistent, hint }
  add(opts) {
    const m = { radius: 2.6, color: [1, 0.85, 0.2], height: 34, active: true, ...opts };
    m.y = m.y ?? this.game.physics.groundHeight(m.x, m.z);
    m.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(m.color[0] * 1.6, m.color[1] * 1.6, m.color[2] * 1.6), transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(m.color[0] * 2, m.color[1] * 2, m.color[2] * 2), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.beam.scale.set(m.radius * 0.8, m.height, m.radius * 0.8);
    m.beam.position.set(m.x, m.y + m.height / 2, m.z);
    m.ring.scale.setScalar(m.radius);
    m.ring.position.set(m.x, m.y + 0.15, m.z);
    m.beam.visible = m.ring.visible = false;
    m.beam.frustumCulled = m.ring.frustumCulled = false;
    this.group.add(m.beam, m.ring);
    this.list.push(m);
    return m;
  }

  remove(m) {
    const i = this.list.indexOf(m);
    if (i >= 0) this.list.splice(i, 1);
    this.group.remove(m.beam, m.ring);
    m.beam.material.dispose(); m.ring.material.dispose();
  }

  removeBy(pred) { for (const m of [...this.list]) if (pred(m)) this.remove(m); }

  update(dt) {
    this.time += dt;
    const g = this.game, p = g.player;
    const pulse = 0.85 + Math.sin(this.time * 3) * 0.15;
    for (const m of this.list) {
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      const show = m.active && d < 650;
      m.beam.visible = m.ring.visible = show && !m.invisible;   // unsichtbare Marker: nur Interaktion (z. B. das Bett)
      if (!show) continue;
      m.ring.scale.setScalar(m.radius * pulse);
      m.beam.material.opacity = 0.2 + 0.08 * Math.sin(this.time * 2.2 + m.x);
      // Auslösen
      if (!m.onEnter || !m.active) continue;
      const inVeh = !!p.vehicle;
      const ground = p.vehicle ? p.vehicle.y : p.y;
      if (d < m.radius && Math.abs(ground - m.y) < 6 && (!m.vehicleOnly || inVeh) && (!m.onFoot || !inVeh)) {
        if (!m.wasIn) { m.wasIn = true; m.onEnter(m); }
      } else m.wasIn = false;
    }
  }

  // Nächster Marker mit onInteract in Reichweite (nur zu Fuß); liegen mehrere in Reichweite, gewinnt der relativ nächste
  interactable(p) {
    let best = null, bk = 1;
    for (const m of this.list) {
      if (!m.active || !m.onInteract) continue;
      const k = Math.hypot(m.x - p.x, m.z - p.z) / (m.interactRadius ?? m.radius + 0.6);
      if (k < bk && Math.abs(p.y - m.y) < 4) { bk = k; best = m; }
    }
    return best;
  }
}

const pickupGeo = {
  cash: new THREE.BoxGeometry(0.34, 0.06, 0.2),
  health: new THREE.BoxGeometry(0.3, 0.3, 0.12),
  armor: new THREE.BoxGeometry(0.32, 0.34, 0.12),
  weapon: new THREE.BoxGeometry(0.5, 0.12, 0.14),
  ammo: new THREE.BoxGeometry(0.26, 0.2, 0.2),
};
const pickupColor = { cash: [0.2, 1.0, 0.3], health: [1, 0.15, 0.2], armor: [0.3, 0.6, 1], weapon: [1, 0.8, 0.2], ammo: [1, 0.55, 0.15] };

export class Pickups {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.time = 0;
  }

  spawn(type, x, z, amount, extra = {}) {
    const c = pickupColor[type] || [1, 1, 1];
    const mesh = new THREE.Mesh(pickupGeo[type] || pickupGeo.cash, new THREE.MeshStandardMaterial({ color: new THREE.Color(c[0], c[1], c[2]), emissive: new THREE.Color(c[0], c[1], c[2]), emissiveIntensity: 1.1, roughness: 0.5 }));
    const y = this.game.physics.groundHeight(x, z);
    mesh.position.set(x, y + 0.5, z);
    this.group.add(mesh);
    const p = { type, x, z, y, amount, mesh, t: 0, life: extra.life ?? (type === 'cash' ? 120 : 1e9), ...extra };
    this.list.push(p);
    return p;
  }

  update(dt) {
    this.time += dt;
    const pl = this.game.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      p.mesh.rotation.y += dt * 2.2;
      p.mesh.position.y = p.y + 0.55 + Math.sin(this.time * 3 + p.x) * 0.08;
      const near = Math.abs(p.x - pl.x) < 1.6 && Math.abs(p.z - pl.z) < 1.6 && pl.alive && !pl.vehicle;
      if (near) { this._collect(p); this.remove(i); continue; }
      if (p.life <= 0) this.remove(i);
    }
  }

  _collect(p) {
    const g = this.game, pl = g.player;
    switch (p.type) {
      case 'cash': g.addMoney(p.amount); g.ui?.notify(`+€${p.amount}`, 'cash'); break;
      case 'health': pl.heal(p.amount); g.ui?.notify('Gesundheit aufgefüllt', 'info'); break;
      case 'armor': pl.armor = Math.min(100, pl.armor + p.amount); g.ui?.notify('Schutzweste', 'info'); break;
      case 'weapon': pl.giveWeapon(p.weapon, p.amount || 30); g.ui?.notify('Waffe aufgenommen', 'info'); break;
      case 'ammo': pl.addAmmo(p.weapon || pl.cur, p.amount); break;
      default: break;
    }
    g.audio?.pickup();
  }

  remove(i) {
    const p = this.list[i];
    this.group.remove(p.mesh);
    p.mesh.material.dispose();
    this.list.splice(i, 1);
  }
}
