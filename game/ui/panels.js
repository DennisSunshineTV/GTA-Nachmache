// Menüs im Spiel: Pause, Optionen, Steuerung, Statistik, Speichern/Laden, Shops, Admin-Panel.
import { fmtMoney } from '../util.js';
import { QUALITY } from '../render/engine.js';
import { VEHICLE_TYPES } from '../entities/vehicle_models.js';
import { WEAPONS, WEAPON_ORDER } from '../combat/weapons.js';
import { WEATHER_NAMES } from '../render/sky.js';

const SETTINGS_KEY = 'streetlife.settings.v1';
export function loadSettings() {
  try { return { quality: 'high', master: 0.8, music: 0.7, sfx: 0.8, sens: 1, invertY: false, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { quality: 'high', master: 0.8, music: 0.7, sfx: 0.8, sens: 1, invertY: false }; }
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignorieren */ } }

const KEYS = [
  ['W A S D', 'Laufen / Fahren'], ['Shift', 'Sprinten (zu Fuß) / Gas (Flugzeug)'], ['Leertaste', 'Springen · Handbremse · Bremse'], ['Maus', 'Kamera / Zielen'],
  ['Rechte Maustaste', 'Zielen'], ['Linke Maustaste', 'Schießen / Schlagen'], ['R', 'Nachladen'], ['1 – 8 / Mausrad', 'Waffe wechseln'],
  ['F', 'Einsteigen · Aussteigen · Interagieren'], ['Q / E', 'Radiosender wechseln (Fahrzeug) · Seitenruder (Flugzeug)'], ['H', 'Hupe'], ['L', 'Licht an/aus'],
  ['G', 'Polizeisirene (Polizeiauto)'], ['C', 'Ducken'], ['V', 'Kameraansicht'], ['M', 'Karte (Wegpunkt per Klick)'],
  ['N', 'FPS-Anzeige'], ['Esc', 'Pause-Menü'], ['W/S (Flugzeug)', 'Nase runter / hoch'], ['A/D (Flugzeug)', 'Querneigung'],
];

export class Panels {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.open = false;
    this.settings = loadSettings();
    this.apply(true);
    this.menu = ui.el.menu;
    this.box = this.menu.querySelector('.box');
    this.adminOpen = false;
    game.input.onUnlock = () => { if (!game.paused && !this.open && game.player.alive && !this.ui.dialogOpen && !game.controlsLocked) this.togglePause(true); };
  }

  apply(initial = false) {
    const g = this.game, s = this.settings;
    g.input.sens = s.sens; g.input.invertY = s.invertY;
    g.audio?.setVolumes?.(s.master, s.music, s.sfx);
    if (!initial && g.engine.qualityKey !== s.quality) { g.engine.setQuality(s.quality); g.onQualityChanged?.(); }
  }

  _show(html, wide = false) {
    this.menu.classList.toggle('wide', wide);
    this.box.innerHTML = html;
    this.menu.style.display = 'flex';
    this.open = true;
    this.game.paused = true;
    this.game.input.unlock();
  }

  close() {
    this.menu.style.display = 'none';
    this.open = false; this.adminOpen = false;
    if (!this.ui.minimap.full) { this.game.paused = false; this.game.input.lock(); }
  }

  onEscape() {
    if (this.ui.minimap.full) return;
    if (this.open) { this.close(); return; }
    this.togglePause();
  }

  togglePause(force) {
    if (this.open && force !== true) { this.close(); return; }
    if (this.ui.dialogOpen) return;
    this.pauseMenu();
  }

  btn(label, fn, sub = '') {
    const b = document.createElement('button');
    b.className = 'mb'; b.innerHTML = label + (sub ? `<small>${sub}</small>` : '');
    b.addEventListener('click', fn);
    return b;
  }

  pauseMenu() {
    const g = this.game;
    this._show(`<h2>Pause</h2><div id="pm"></div>`);
    const pm = this.box.querySelector('#pm');
    const items = [
      ['Weiter spielen', () => this.close()],
      ['Karte', () => { this.menu.style.display = 'none'; this.open = false; this.ui.minimap.toggleFull(true); }],
      ['Spiel speichern', async () => { await g.saveToServer?.(); }],
      ['Speicherstand laden', async () => { await g.loadFromServer?.(); this.close(); }],
      ['Optionen', () => this.optionsMenu()],
      ['Steuerung', () => this.controlsMenu()],
      ['Statistiken', () => this.statsMenu()],
      ['Freundschaften', () => this.friendsMenu()],
      ['Hauptmenü', () => { if (confirm('Zum Hauptmenü zurückkehren? Nicht gespeicherter Fortschritt geht verloren.')) g.exitToMenu?.(); }],
    ];
    for (const [l, f] of items) pm.appendChild(this.btn(l, f));
  }

  optionsMenu() {
    const s = this.settings;
    this._show(`<h2>Optionen</h2>
      <div class="row"><label>Grafikqualität</label><select id="o-q">${Object.keys(QUALITY).map((k) => `<option value="${k}" ${s.quality === k ? 'selected' : ''}>${{ low: 'Niedrig', medium: 'Mittel', high: 'Hoch', ultra: 'Ultra' }[k]}</option>`).join('')}</select></div>
      <div class="row"><label>Gesamtlautstärke</label><input id="o-m" type="range" min="0" max="1" step="0.05" value="${s.master}"></div>
      <div class="row"><label>Musik / Radio</label><input id="o-mu" type="range" min="0" max="1" step="0.05" value="${s.music}"></div>
      <div class="row"><label>Effekte</label><input id="o-s" type="range" min="0" max="1" step="0.05" value="${s.sfx}"></div>
      <div class="row"><label>Maus-Empfindlichkeit</label><input id="o-se" type="range" min="0.2" max="2.5" step="0.05" value="${s.sens}"></div>
      <div class="row"><label>Y-Achse umkehren</label><input id="o-iy" type="checkbox" ${s.invertY ? 'checked' : ''}></div>
      <div id="ob"></div>`);
    const $ = (id) => this.box.querySelector(id);
    const upd = () => {
      s.quality = $('#o-q').value; s.master = +$('#o-m').value; s.music = +$('#o-mu').value; s.sfx = +$('#o-s').value; s.sens = +$('#o-se').value; s.invertY = $('#o-iy').checked;
      saveSettings(s); this.apply();
    };
    for (const id of ['#o-q', '#o-m', '#o-mu', '#o-s', '#o-se', '#o-iy']) $(id).addEventListener('input', upd);
    $('#ob').appendChild(this.btn('Zurück', () => this.pauseMenu()));
  }

  controlsMenu() {
    this._show(`<h2>Steuerung</h2><div class="keys">${KEYS.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join('')}</div><div id="cb"></div>`);
    this.box.querySelector('#cb').appendChild(this.btn('Zurück', () => this.pauseMenu()));
  }

  statsMenu() {
    const g = this.game, st = g.stats;
    const mins = Math.floor(st.playMs / 60000);
    this._show(`<h2>Statistiken</h2><div class="keys">
      <kbd>Geld</kbd><span>${fmtMoney(g.money)}</span><kbd>Spielzeit</kbd><span>${Math.floor(mins / 60)} h ${mins % 60} min</span>
      <kbd>Besiegte Gegner</kbd><span>${st.kills || 0}</span><kbd>Schüsse</kbd><span>${st.shots || 0}</span>
      <kbd>Missionen</kbd><span>${st.missionsDone || 0} / ${g.missions?.total || 0}</span>
      <kbd>Immobilien</kbd><span>${Object.keys(g.owned.properties || {}).length}</span><kbd>Eingeloggt als</kbd><span>${g.userName} (${g.rank})</span></div><div id="sb"></div>`);
    this.box.querySelector('#sb').appendChild(this.btn('Zurück', () => this.pauseMenu()));
  }

  friendsMenu() {
    const g = this.game;
    const list = g.missions?.friendList?.() || [];
    this._show(`<h2>Freundschaften</h2>${list.length ? '' : '<p>Du hast noch niemanden kennengelernt. Schließe Missionen ab, um Kontakte zu knüpfen.</p>'}<div id="fl"></div><div id="fb"></div>`);
    const fl = this.box.querySelector('#fl');
    for (const f of list) {
      const row = document.createElement('div');
      row.style.cssText = 'margin:10px 0;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,.07)';
      row.innerHTML = `<b>${f.name}</b> <span style="opacity:.7">· ${f.role}</span><div style="margin-top:6px;height:8px;border-radius:5px;background:rgba(0,0,0,.4);overflow:hidden"><i style="display:block;height:100%;width:${f.level}%;background:linear-gradient(90deg,#ff5de6,#ffb347)"></i></div><div style="font-size:13px;opacity:.75;margin-top:4px">${f.text}</div>`;
      fl.appendChild(row);
    }
    this.box.querySelector('#fb').appendChild(this.btn('Zurück', () => this.pauseMenu()));
  }

  // ---------- Allgemeines Auswahlmenü (Shops etc.) ----------
  // items: [{ label, sub, fn, disabled }]
  listMenu(title, items, intro = '', onClose = null) {
    this._show(`<h2>${title}</h2>${intro ? `<p style="opacity:.85">${intro}</p>` : ''}<div id="lm"></div><div id="lb"></div>`, items.length > 8);
    const lm = this.box.querySelector('#lm');
    for (const it of items) { const b = this.btn(it.label, () => { it.fn?.(); }, it.sub); if (it.disabled) b.disabled = true; lm.appendChild(b); }
    this.box.querySelector('#lb').appendChild(this.btn('Schließen', () => { this.close(); onClose?.(); }));
  }

  // ---------- Admin-Panel ----------
  toggleAdmin() {
    if (!this.game.isAdmin) return;
    if (this.adminOpen) { this.close(); return; }
    this.adminMenu('teleport');
  }

  adminMenu(tab) {
    const g = this.game, isSys = g.rank === 'Sysadmin';
    this.adminOpen = true;
    const tabs = [['teleport', 'Teleport'], ['vehicles', 'Fahrzeuge'], ['world', 'Welt & Zeit'], ['player', 'Spieler']];
    if (isSys) tabs.push(['system', 'System']);
    this._show(`<h2>Admin-Menü <small style="font-size:14px;opacity:.7">(${g.rank} · ${g.userName})</small></h2><div class="tabs">${tabs.map(([k, l]) => `<div class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</div>`).join('')}</div><div id="ac"></div>`, true);
    this.box.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => this.adminMenu(t.dataset.t)));
    const ac = this.box.querySelector('#ac');
    const chip = (label, fn) => { const c = document.createElement('span'); c.className = 'chip'; c.textContent = label; c.addEventListener('click', fn); return c; };
    const group = (title, nodes) => { const h = document.createElement('h3'); h.textContent = title; ac.appendChild(h); const d = document.createElement('div'); nodes.forEach((n) => d.appendChild(n)); ac.appendChild(d); };
    if (tab === 'teleport') {
      const isl = { mallorca: 'Mallorca', menorca: 'Menorca', ibiza: 'Ibiza', formentera: 'Formentera', cabrera: 'Cabrera', dragonera: 'Sa Dragonera' };
      for (const [id, name] of Object.entries(isl)) {
        const ss = g.ctx.settlements.filter((s) => s.island === id && s.pos);
        if (!ss.length) continue;
        group(name, ss.map((s) => chip(s.name, () => { g.teleport(s.pos[0], s.pos[1]); this.close(); })));
      }
      group('Besondere Orte', g.ctx.pois.filter((p) => ['harbor', 'airport', 'bossfinca', 'landmark', 'beach'].includes(p.type) && !p.id.includes('pier')).slice(0, 40).map((p) => chip(p.label, () => { g.teleport(p.x, p.z); this.close(); })));
    } else if (tab === 'vehicles') {
      const groups = { 'Autos': ['sports', 'coupe', 'luxury', 'limo', 'suv', 'compact', 'taxi', 'police', 'van', 'pickup'], 'Zweiräder & Nutzfahrzeuge': ['moto', 'truck', 'bus', 'tractor', 'forklift', 'excavator'], 'Wasser & Luft': ['speedboat', 'yacht', 'jetski', 'plane', 'heli'] };
      for (const [name, keys] of Object.entries(groups)) group(name, keys.map((k) => chip(VEHICLE_TYPES[k].name, () => { g.adminSpawn(k); this.close(); })));
    } else if (tab === 'world') {
      group('Wetter', Object.keys(WEATHER_NAMES).map((k) => chip(WEATHER_NAMES[k], () => { g.atm.setWeather(k); g.weatherT = 900; })));
      group('Uhrzeit', [6, 9, 12, 15, 18, 20, 22, 0, 3].map((h) => chip(`${String(h).padStart(2, '0')}:00`, () => { g.atm.hour = h; })));
      group('Zeit', [chip(g.timeFrozen ? 'Zeit läuft weiter' : 'Zeit einfrieren', () => { g.timeFrozen = !g.timeFrozen; this.adminMenu('world'); }), chip('Zeit ×5', () => { g.timeScale = 5 / 100; }), chip('Zeit normal', () => { g.timeScale = 1 / 100; })]);
      group('Verkehr & Passanten', [chip('Wenig', () => { g.traffic.target = 8; g.peds.target = 16; }), chip('Normal', () => { g.traffic.target = g.quality.traffic; g.peds.target = g.quality.peds; }), chip('Viel', () => { g.traffic.target = g.quality.traffic * 1.6; g.peds.target = g.quality.peds * 1.5; }), chip('Leer', () => { g.traffic.target = 0; g.peds.target = 0; })]);
    } else if (tab === 'player') {
      group('Geld', [1000, 10000, 100000, 1000000].map((n) => chip('+' + fmtMoney(n), () => g.addMoney(n))));
      group('Gesundheit', [chip('Volle Gesundheit + Weste', () => { g.player.hp = g.player.maxHp; g.player.armor = 100; }), chip(g.god ? 'Gottmodus aus' : 'Gottmodus an', () => { g.god = !g.god; g.godVehicles = g.god; this.adminMenu('player'); })]);
      group('Waffen', [chip('Alle Waffen + Munition', () => { for (const id of WEAPON_ORDER) if (id !== 'fists') { g.player.giveWeapon(id, 400); g.player.weapons[id].mag = WEAPONS[id].mag || 1; } })]);
      group('Fahndung', [0, 1, 2, 3, 4, 5].map((n) => chip(n ? `${n} ★` : 'Keine', () => g.police.setWanted(n))).concat([chip(g.police.disabled ? 'Polizei an' : 'Polizei aus', () => { g.police.disabled = !g.police.disabled; g.police.clear(true); this.adminMenu('player'); })]));
      group('Figur', [chip('Jason', () => g.player.setOutfit('player_jason')), chip('Lucia', () => g.player.setOutfit('player_lucia'))]);
    } else if (tab === 'system') {
      const r = g.engine.renderer.info;
      const info = document.createElement('div');
      info.style.cssText = 'font-family:Consolas,monospace;font-size:14px;line-height:1.6;opacity:.9;white-space:pre';
      info.textContent = `FPS: ${Math.round(g.fps)}\nGeometrien: ${r.memory.geometries}\nTexturen: ${r.memory.textures}\nChunks: ${g.chunks.chunks.size}\nFahrzeuge: ${g.vehicles.list.length}\nFiguren: ${g.characters.length}\nWelt-Erzeugung: ${Math.round(g.ctx.generatedMs)} ms\nStraßen: ${g.ctx.net.roads.length} (${Math.round(g.ctx.net.totalLength / 1000)} km)\nGebäude: ${g.ctx.buildings.length}`;
      ac.appendChild(info);
      group('Werkzeuge', [chip('Verkehr leeren', () => { for (const v of [...g.traffic.cars]) g.vehicles.remove(v); g.traffic.cars.length = 0; }), chip('Alle Wracks entfernen', () => { for (const v of [...g.vehicles.list]) if (v.exploded) g.vehicles.remove(v); }), chip('Missionen zurücksetzen', () => { g.missions?.reset?.(); this.close(); })]);
    }
    const close = this.btn('Schließen (F4)', () => this.close());
    ac.appendChild(close);
  }
}
