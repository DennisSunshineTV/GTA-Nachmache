// Waffen: Daten und einfache Modelle (liegen entlang +z, Griff im Ursprung).
import * as THREE from 'three';

export const WEAPONS = {
  fists: { id: 'fists', name: 'Fäuste', slot: 0, melee: true, dmg: 12, rate: 0.42, range: 1.7, price: 0 },
  bat: { id: 'bat', name: 'Baseballschläger', slot: 0, melee: true, dmg: 34, rate: 0.65, range: 2.2, price: 250, model: 'bat' },
  pistol: { id: 'pistol', name: 'Pistole', slot: 1, dmg: 24, rate: 0.26, mag: 12, reserve: 108, spread: 0.014, range: 110, auto: false, reload: 1.3, snd: 'pistol', price: 600, model: 'pistol', ammoPrice: 40 },
  smg: { id: 'smg', name: 'Maschinenpistole', slot: 2, dmg: 15, rate: 0.075, mag: 30, reserve: 270, spread: 0.034, range: 85, auto: true, reload: 1.8, snd: 'smg', price: 2500, model: 'smg', twoHanded: true, ammoPrice: 90 },
  shotgun: { id: 'shotgun', name: 'Schrotflinte', slot: 3, dmg: 12, pellets: 9, rate: 0.85, mag: 6, reserve: 42, spread: 0.075, range: 40, auto: false, reload: 2.4, snd: 'shotgun', price: 3500, model: 'shotgun', twoHanded: true, ammoPrice: 60 },
  rifle: { id: 'rifle', name: 'Sturmgewehr', slot: 4, dmg: 22, rate: 0.095, mag: 30, reserve: 270, spread: 0.02, range: 170, auto: true, reload: 2.1, snd: 'rifle', price: 7000, model: 'rifle', twoHanded: true, ammoPrice: 120 },
  sniper: { id: 'sniper', name: 'Scharfschützengewehr', slot: 5, dmg: 110, rate: 1.15, mag: 5, reserve: 35, spread: 0.0012, range: 500, auto: false, reload: 2.6, snd: 'sniper', price: 12000, model: 'sniper', twoHanded: true, zoom: 3.2, ammoPrice: 200 },
  grenade: { id: 'grenade', name: 'Granaten', slot: 6, thrown: true, dmg: 150, rate: 0.9, mag: 1, reserve: 4, radius: 9, fuse: 2.3, price: 300, model: 'grenade', ammoPrice: 300 },
};
export const WEAPON_ORDER = ['fists', 'bat', 'pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'grenade'];

const dark = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.45, metalness: 0.7 });
const grip = new THREE.MeshStandardMaterial({ color: 0x2a2320, roughness: 0.8 });
const wood = new THREE.MeshStandardMaterial({ color: 0x6b4426, roughness: 0.7 });
const olive = new THREE.MeshStandardMaterial({ color: 0x3d4a2f, roughness: 0.6, metalness: 0.2 });

function box(w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true;
  return m;
}

export function makeWeaponModel(id) {
  const g = new THREE.Group();
  const W = WEAPONS[id];
  if (!W || !W.model) return null;
  switch (W.model) {
    case 'pistol': g.add(box(0.035, 0.05, 0.2, 0, 0.03, 0.1, dark), box(0.034, 0.1, 0.05, 0, -0.04, 0.02, grip)); break;
    case 'smg': g.add(box(0.045, 0.07, 0.32, 0, 0.03, 0.15, dark), box(0.036, 0.14, 0.05, 0, -0.06, 0.04, grip), box(0.03, 0.12, 0.04, 0, -0.07, 0.17, dark), box(0.02, 0.025, 0.12, 0, 0.03, 0.4, dark)); break;
    case 'shotgun': g.add(box(0.045, 0.06, 0.55, 0, 0.03, 0.28, dark), box(0.04, 0.05, 0.28, 0, 0.0, 0.06, wood), box(0.05, 0.06, 0.2, 0, 0.0, 0.36, wood)); break;
    case 'rifle': g.add(box(0.05, 0.08, 0.5, 0, 0.04, 0.25, olive), box(0.04, 0.05, 0.25, 0, 0.0, -0.12, olive), box(0.03, 0.14, 0.06, 0, -0.08, 0.14, dark), box(0.025, 0.03, 0.3, 0, 0.04, 0.62, dark), box(0.03, 0.04, 0.1, 0, 0.09, 0.3, dark)); break;
    case 'sniper': g.add(box(0.05, 0.07, 0.75, 0, 0.03, 0.34, dark), box(0.045, 0.06, 0.3, 0, 0.0, -0.16, wood), box(0.04, 0.05, 0.28, 0, 0.1, 0.25, dark), box(0.02, 0.025, 0.4, 0, 0.04, 0.9, dark)); break;
    case 'bat': g.add(box(0.04, 0.04, 0.8, 0, 0, 0.3, wood)); break;
    case 'grenade': { const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), olive); m.position.set(0, 0, 0.02); g.add(m, box(0.015, 0.03, 0.015, 0, 0.05, 0.02, dark)); break; }
    default: break;
  }
  // Waffe zeigt entlang +z; im Handsystem zeigt der Unterarm nach -y → drehen
  const holder = new THREE.Group();
  g.rotation.x = Math.PI / 2;
  holder.add(g);
  return holder;
}

// Mündungsposition (relativ, entlang +z) pro Waffe
export const MUZZLE = { pistol: 0.22, smg: 0.42, shotgun: 0.6, rifle: 0.66, sniper: 0.95 };
