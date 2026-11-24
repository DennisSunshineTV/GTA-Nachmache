// Geschäfte und Aktivitäten: Waffenladen, Autohaus, Klinik, Bars (Überfall), Immobilien, Wohnung (Speichern, Garage).
import { fmtMoney, clamp } from '../util.js';
import { WEAPONS, WEAPON_ORDER } from '../combat/weapons.js';
import { VEHICLE_TYPES } from '../entities/vehicle_models.js';
import { freeSpot } from '../world/spots.js';

const PROPERTIES = [
  { id: 'beachbar', name: 'Strandbar „Sol y Mar“', poi: 'arenal.beachbar', price: 120000, income: 420, icon: '🍹' },
  { id: 'club', name: 'Nachtclub „Neon“', poi: 'magaluf.club0', price: 480000, income: 1350, icon: '♪' },
  { id: 'marina', name: 'Yacht-Charter Palma', poi: 'palma.pier3', price: 900000, income: 2900, icon: '⚓' },
  { id: 'finca', name: 'Finca in Alcúdia', poi: 'alcudia.center', price: 1500000, income: 4600, icon: '⌂' },
];
const SALE_CARS = ['compact', 'coupe', 'suv', 'pickup', 'van', 'luxury', 'sports', 'moto', 'limo', 'speedboat', 'jetski', 'plane', 'yacht'];

export class Shops {
  constructor(game) {
    this.game = game;
    this.markers = [];
    this.pending = {};
    this.build();
  }

  find(id) { return this.game.ctx.pois.find((p) => p.id === id); }

  build() {
    const g = this.game, M = g.markers, ui = g.ui;
    const add = (x, z, hint, color, onInteract, blip) => { const m = M.add({ x, z, radius: 2.6, color, height: 14, hint, onInteract, blip, interactRadius: 3.4 }); this.markers.push(m); return m; };
    // POI-basierte Läden
    for (const p of g.ctx.pois) {
      if (p.type === 'gunshop') add(p.x, p.z, 'Waffenladen betreten', [1, 0.7, 0.2], () => this.gunShop());
      else if (p.type === 'carshop') add(p.x, p.z, 'Autohaus betreten', [0.3, 0.7, 1], () => this.carShop(p));
      else if (p.type === 'clinic') add(p.x, p.z, 'Behandlung (€50)', [1, 0.3, 0.4], () => this.clinic());
      else if (p.type === 'bar') add(p.x, p.z, 'Bar: Getränk kaufen / Überfall', [0.9, 0.7, 0.2], (m) => this.bar(m, p));
    }
    // Wohnung am Startpunkt
    const sp = g.startPosition();
    const hp = freeSpot(g.ctx, sp.x + 14, sp.z + 10, 3);
    const ax = hp.x, az = hp.z;
    this.home = add(ax, az, 'Wohnung: Speichern & Garage', [0.4, 1, 0.5], () => this.apartment(), { icon: '⌂', color: '#7dff8a' });
    // Immobilien
    for (const pr of PROPERTIES) {
      const p = this.find(pr.poi) || g.ctx.pois.find((q) => q.id.startsWith(pr.poi.split('.')[0]));
      if (!p) continue;
      const q = p.door ? { x: p.x, z: p.z } : freeSpot(g.ctx, p.x + 5, p.z + 5, 3);   // Gebäude sind nicht begehbar: Marker davor
      this.markers.push(M.add({ x: q.x, z: q.z, radius: 2.6, color: [0.2, 0.9, 0.5], height: 16, hint: pr.name, interactRadius: 3.4, onInteract: () => this.property(pr), blip: { icon: pr.icon, color: '#5be07d' } }));
    }
    void ui;
  }

  gunShop() {
    const g = this.game, p = g.player;
    const items = [];
    for (const id of WEAPON_ORDER) {
      const W = WEAPONS[id];
      if (!W.price) continue;
      const owned = p.hasWeapon(id);
      if (!owned) items.push({ label: `${W.name}`, sub: `${fmtMoney(W.price)}`, disabled: g.money < W.price, fn: () => { if (g.spend(W.price)) { p.giveWeapon(id, W.mag ? W.reserve : 0); if (W.mag) p.weapons[id].mag = W.mag; g.ui.notify(`${W.name} gekauft`, 'good'); this.gunShop(); } } });
      else if (W.ammoPrice) items.push({ label: `Munition: ${W.name}`, sub: `${fmtMoney(W.ammoPrice)} für ${Math.max(1, Math.floor((W.mag || 6)))} × Magazin`, disabled: g.money < W.ammoPrice, fn: () => { if (g.spend(W.ammoPrice)) { p.addAmmo(id, (W.mag || 6) * 3); g.ui.notify('Munition aufgefüllt', 'good'); this.gunShop(); } } });
    }
    items.push({ label: 'Schutzweste', sub: fmtMoney(900), disabled: g.money < 900 || p.armor >= 100, fn: () => { if (g.spend(900)) { p.armor = 100; g.ui.notify('Schutzweste angelegt', 'good'); this.gunShop(); } } });
    g.ui.panels.listMenu('Armería Cala', items, `Dein Geld: ${fmtMoney(g.money)}`);
  }

  carShop(poi) {
    const g = this.game;
    const items = SALE_CARS.map((k) => {
      const T = VEHICLE_TYPES[k];
      return { label: T.name, sub: `${fmtMoney(T.price)} · max. ${Math.round(T.maxSpeed * 3.6)} km/h`, disabled: g.money < T.price, fn: () => this.buyCar(k, poi) };
    });
    g.ui.panels.listMenu('Auto Luxe Palma', items, `Dein Geld: ${fmtMoney(g.money)}. Gekaufte Fahrzeuge findest du in deiner Wohnungsgarage.`);
  }

  buyCar(k, poi) {
    const g = this.game, T = VEHICLE_TYPES[k];
    if (!g.spend(T.price)) return;
    const paint = Math.floor(Math.random() * (T.paint?.length || 1));
    g.owned.vehicles.push({ type: k, paint });
    g.ui.notify(`${T.name} gekauft – steht in deiner Garage`, 'good');
    g.ui.panels.close();
    this.spawnOwned(g.owned.vehicles.length - 1, poi);
  }

  spawnOwned(i, near) {
    const g = this.game, o = g.owned.vehicles[i];
    if (!o) return;
    let x, z, h = 0;
    const ref = near || g.player;
    const T = VEHICLE_TYPES[o.type];
    if (T.cls === 'plane') { const rw = g.ctx.runway; x = rw.x - rw.ux * rw.L * 0.4; z = rw.z - rw.uz * rw.L * 0.4; h = Math.atan2(rw.ux, rw.uz); }
    else if (T.cls === 'boat') {
      const hb = g.ctx.pois.find((q) => q.id === 'palma.pier0') || g.ctx.pois.find((q) => q.type === 'pier');
      x = hb.x; z = hb.z;
    } else {
      const nr = g.ctx.net.nearest(ref.x + 8, ref.z + 8, 80, (r) => !r.noTraffic && r.kind !== 'track') || g.ctx.net.nearest(ref.x, ref.z, 200);
      x = nr ? nr.x + 3 : ref.x + 4; z = nr ? nr.z : ref.z + 4;
      if (nr) h = Math.atan2(nr.road.pts[Math.min(nr.i + 1, nr.road.pts.length - 1)][0] - nr.road.pts[nr.i][0], nr.road.pts[Math.min(nr.i + 1, nr.road.pts.length - 1)][1] - nr.road.pts[nr.i][1]);
    }
    const v = g.vehicles.spawn(o.type, x, z, h, { owner: 'abandoned', paint: o.paint });
    v.keep = true; v.ownedIdx = i;
    g.ui.notify(`${T.name} wurde bereitgestellt`, 'info');
    return v;
  }

  clinic() {
    const g = this.game, p = g.player;
    if (p.hp >= p.maxHp && p.armor >= 0) { g.ui.notify('Du bist bereits gesund', 'info'); return; }
    if (!g.spend(50)) { g.ui.notify('Nicht genug Geld', 'warn'); return; }
    p.hp = p.maxHp; g.ui.notify('Vollständig geheilt (€50)', 'good');
  }

  bar(m, p) {
    const g = this.game, pl = g.player;
    if (pl.aiming && pl.weapon && !pl.weapon.melee) {
      if (m.robbedAt && g.time - m.robbedAt < 240) { g.ui.notify('Die Kasse ist leer', 'warn'); return; }
      m.robbedAt = g.time;
      const loot = 300 + Math.floor(Math.random() * 900);
      g.addMoney(loot);
      g.ui.notify(`Überfall: ${fmtMoney(loot)} erbeutet`, 'cash');
      g.police.crime('robbery', pl, pl.x, pl.z, true);
      g.peds.hearShot(pl.x, pl.z, 40, pl);
      g.ui.bubble(pl, 'Kasse auf! Sofort!', 2.5);
    } else {
      if (!g.spend(15)) { g.ui.notify('Nicht genug Geld', 'warn'); return; }
      pl.heal(25); g.ui.notify('Erfrischendes Getränk (+25 Gesundheit)', 'good');
    }
  }

  apartment() {
    const g = this.game;
    const items = [
      { label: 'Spiel speichern', sub: 'Fortschritt auf dem Server sichern', fn: async () => { await g.saveToServer(); g.ui.panels.close(); } },
      { label: 'Bis 08:00 Uhr schlafen', sub: 'Gesundheit auffüllen, Zeit vorspulen', fn: () => { g.atm.hour = 8; g.player.hp = g.player.maxHp; g.ui.notify('Gut geschlafen', 'good'); g.ui.panels.close(); } },
    ];
    g.owned.vehicles.forEach((o, i) => items.push({ label: `Garage: ${VEHICLE_TYPES[o.type].name}`, sub: 'Fahrzeug bereitstellen', fn: () => { const exist = g.vehicles.list.find((v) => v.ownedIdx === i && v.alive); if (exist) { exist.x = g.player.x + 5; exist.z = g.player.z + 3; exist.vx = exist.vz = 0; } else this.spawnOwned(i); g.ui.panels.close(); } }));
    g.ui.panels.listMenu('Deine Wohnung', items, 'Hier bist du sicher.');
  }

  property(pr) {
    const g = this.game, owned = g.owned.properties[pr.id];
    if (!owned) {
      g.ui.panels.listMenu(pr.name, [
        { label: `Kaufen für ${fmtMoney(pr.price)}`, sub: `Bringt ca. ${fmtMoney(pr.income)} pro Spielstunde`, disabled: g.money < pr.price, fn: () => { if (g.spend(pr.price)) { g.owned.properties[pr.id] = { since: g.time, collected: 0 }; this.pending[pr.id] = 0; g.ui.notify(`${pr.name} gekauft!`, 'good'); g.ui.panels.close(); } } },
      ], 'Ein Geschäft, das Geld verdient, während du die Insel erkundest.');
    } else {
      const amt = Math.floor(this.pending[pr.id] || 0);
      g.ui.panels.listMenu(pr.name, [
        { label: `Einnahmen abholen: ${fmtMoney(amt)}`, sub: `${fmtMoney(pr.income)} pro Spielstunde (max. 8 Stunden)`, disabled: amt < 1, fn: () => { g.addMoney(amt); this.pending[pr.id] = 0; g.ui.notify(`+${fmtMoney(amt)} Einnahmen`, 'cash'); g.ui.panels.close(); } },
      ]);
    }
  }

  update(dt) {
    const g = this.game;
    for (const pr of PROPERTIES) {
      if (!g.owned.properties[pr.id]) continue;
      const cap = pr.income * 8;
      this.pending[pr.id] = Math.min(cap, (this.pending[pr.id] || 0) + (pr.income / (1 / g.timeScale)) * dt * 1);
    }
  }
}
