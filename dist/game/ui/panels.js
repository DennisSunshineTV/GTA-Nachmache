// Menüs im Spiel: Pause, Optionen, Steuerung, Statistik, Speichern/Laden, Shops, Admin-Panel.
import { fmtMoney } from '../util.js';
import { VEHICLE_TYPES } from '../entities/vehicle_models.js';
import { WEAPONS, WEAPON_ORDER } from '../combat/weapons.js';
import { WEATHER_NAMES } from '../render/sky.js';
import { charName } from '../story/characters.js';
import { loadSettings, saveSettings, renderOptions, computeRemap, ACTIONS, ACTION_GROUPS, FIXED_INFO, CONTROLLER_LAYOUT, effectiveCode, keyLabel } from '/assets/options.js';

// Einstellungen und Tastenbelegung liegen in assets/options.js (auch vom Startbildschirm genutzt)
export { loadSettings, saveSettings };

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
    { const { remap, blocked } = computeRemap(s.keys); g.input.setRemap?.(remap, blocked); }
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

  // "Zurück"- bzw. "Schließen"-Knopf einer Ansicht; die Controller-Taste B drückt ihn
  backBtn(label, fn) {
    const b = this.btn(label, fn);
    b.dataset.back = '1';
    return b;
  }

  back() {
    const b = this.box.querySelector('[data-back]');
    if (b) b.click(); else this.close();
  }

  // Rückfrage im Menü (das Fenster von confirm() ließe sich nicht mit dem Controller bedienen)
  confirm(text, label, yes, no) {
    this._show('<h2>Bitte bestätigen</h2><p></p><div id="cq"></div>');
    this.box.querySelector('p').textContent = text;
    this.box.querySelector('#cq').append(this.backBtn('Abbrechen', no), this.btn(label, yes));
  }

  // Vollbildkarte aus dem Pause-Menü öffnen (Tabs: Karte / Quests)
  openMap(tab) {
    this.menu.style.display = 'none';
    this.open = false;
    this.ui.minimap.open(tab, true);
  }

  pauseMenu() {
    const g = this.game;
    this._show(`<h2>Pause</h2><div id="pm"></div>`);
    const pm = this.box.querySelector('#pm');
    const items = [
      ['Weiter spielen', () => this.close()],
      ['Karte', () => this.openMap('map')],
      ['Quests', () => this.openMap('quests')],
      ['Spiel speichern', () => this.saveMenu('save'), this.saveInfo()],
      ['Speicherstand laden', () => this.saveMenu('load')],
      ['Optionen', () => this.optionsMenu()],
      ['Steuerung', () => this.controlsMenu()],
      ['Statistiken', () => this.statsMenu()],
      ['Freundschaften', () => this.friendsMenu()],
      ['Hauptmenü', () => this.confirm('Zum Hauptmenü zurückkehren? Nicht gespeicherter Fortschritt geht verloren.', 'Zum Hauptmenü', () => g.exitToMenu?.(), () => this.pauseMenu())],
    ];
    // Admins und Sysadmins erreichen das Admin-Menü auch über das Pause-Menü (sonst nur mit F4)
    if (g.isAdmin) items.push(['Admin-Menü', () => this.adminMenu('teleport'), g.rank + ' · ' + g.userName]);
    for (const [l, f, sub] of items) pm.appendChild(this.btn(l, f, sub || ""));
  }

  // Optionen mit den Reitern Audio, Grafik und Tastatur (Oberfläche in assets/options.js)
  // Speicherplätze: ganz oben der Auto-Save, darunter die 10 eigenen Speicherstände.
  // mode 'save': in einen Platz speichern (Auto-Save kann man nicht von Hand überschreiben); 'load': einen Stand laden
  async saveMenu(mode, back = () => this.pauseMenu()) {
    const g = this.game;
    this._show(`<h2>${mode === 'save' ? 'Spiel speichern' : 'Speicherstand laden'}</h2><div id="sl" style="opacity:.8">Lade Speicherplätze …</div><div id="sb"></div>`);
    this.box.querySelector('#sb').appendChild(this.backBtn('Zurück', back));
    let slots = [];
    let unsupported = false;
    try { const r = await fetch('/api/saves'); const d = await r.json(); if (Array.isArray(d.slots)) slots = d.slots; else unsupported = true; } catch { unsupported = true; }
    if (!this.open) return;
    if (unsupported) {
      this.box.querySelector('#sl').textContent = 'Die Speicherplätze sind auf dem Server noch nicht verfügbar. Bitte die Dateien api/index.php und api/lib.php auf dem Server aktualisieren (Inhalt von dist/ hochladen).';
      return;
    }
    const by = new Map(slots.map((s) => [s.slot, s]));
    const list = this.box.querySelector('#sl');
    list.style.opacity = 1; list.textContent = '';
    const info = (s) => `${charName(s.summary.who)} · ${fmtMoney(s.summary.money)} · ${s.summary.missions} ${s.summary.missions === 1 ? 'Mission' : 'Missionen'} · ${new Date(s.savedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`;
    for (let n = 0; n <= 10; n++) {
      const s = by.get(n);
      const label = n === 0 ? 'Auto-Save <span style="font-weight:500;opacity:.75">(automatisch)</span>' : 'Speicherstand ' + n;
      let sub = s ? info(s) : (n === 0 ? (g.autoSaveOn ? 'Noch nichts automatisch gespeichert' : 'Auto-Save ist aus (Optionen → Speichern)') : 'Leer');
      let disabled = false, fn = null;
      if (mode === 'save') {
        if (n === 0) { disabled = true; sub += g.autoSaveOn && s ? ' · wird nach jeder Mission automatisch aktualisiert' : ''; }
        else {
          const save = async () => { await g.saveToServer(false, n); this.saveMenu('save', back); };
          fn = s ? () => this.confirm('Speicherstand ' + n + ' überschreiben?', 'Überschreiben', save, () => this.saveMenu('save', back)) : save;
        }
      } else if (!s) disabled = true;
      else fn = async () => { if (await g.loadFromServer(n)) this.close(); };
      const b = this.btn(label, fn || (() => {}), sub);
      if (disabled) b.disabled = true;
      b.style.padding = '9px 16px'; b.style.margin = '5px 0'; b.style.fontSize = '17px';
      list.appendChild(b);
    }
  }

  // Zusatzzeile beim Speichern: wann zuletzt gespeichert wurde (und ob automatisch)
  saveInfo() {
    const g = this.game;
    if (!g.lastSaveAt) return g.autoSaveOn ? 'Auto-Save ist an: gespeichert wird nach jeder geschafften Mission' : 'Auto-Save ist aus (Optionen → Speichern)';
    const t = new Date(g.lastSaveAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return 'Zuletzt gespeichert um ' + t + (g.lastSaveAuto ? ' (automatisch)' : '');
  }

  optionsMenu() {
    const s = this.settings;
    this._show('<h2>Optionen</h2><div id="opt-host"></div><div id="ob"></div>', true);
    const ctl = renderOptions(this.box.querySelector('#opt-host'), { settings: s, onChange: () => { saveSettings(s); this.apply(); } });
    this.box.querySelector('#ob').appendChild(this.backBtn('Zurück', () => { ctl.dispose(); this.pauseMenu(); }));
  }

  // Steuerung: zeigt die aktuelle Tastenbelegung (geändert wird sie unter Optionen → Tastatur) und die Xbox-Belegung.
  // Das zuletzt benutzte Eingabegerät steht oben.
  controlsMenu() {
    const s = this.settings;
    const head = (t) => `<h3 style="grid-column:1 / -1">${t}</h3>`, row = ([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`;
    const keys = [];
    for (const g of ACTION_GROUPS) {
      keys.push(head(g.label));
      for (const a of ACTIONS.filter((x) => x.group === g.id)) keys.push(row([keyLabel(effectiveCode(s.keys, a)), a.label]));
    }
    keys.push(head('Maus und weitere feste Bedienung'), ...FIXED_INFO.map(row));
    const pad = CONTROLLER_LAYOUT.flatMap((sec) => [head('Xbox-Controller · ' + sec.title), ...sec.rows.map(row)]);
    const rows = this.game.input.device === 'pad' ? [...pad, ...keys] : [...keys, ...pad];
    this._show(`<h2>Steuerung</h2><p style="opacity:.8;margin:0 0 8px">Tasten änderst du unter Optionen → Tastatur.</p><div class="keys">${rows.join('')}</div><div id="cb"></div>`);
    this.box.querySelector('#cb').appendChild(this.backBtn('Zurück', () => this.pauseMenu()));
  }

  statsMenu() {
    const g = this.game, st = g.stats;
    const mins = Math.floor(st.playMs / 60000);
    this._show(`<h2>Statistiken</h2><div class="keys">
      <kbd>Geld</kbd><span>${fmtMoney(g.money)}</span><kbd>Spielzeit</kbd><span>${Math.floor(mins / 60)} h ${mins % 60} min</span>
      <kbd>Besiegte Gegner</kbd><span>${st.kills || 0}</span><kbd>Schüsse</kbd><span>${st.shots || 0}</span>
      <kbd>Missionen</kbd><span>${st.missionsDone || 0} / ${g.missions?.total || 0}</span>
      <kbd>Immobilien</kbd><span>${Object.keys(g.owned.properties || {}).length}</span><kbd>Eingeloggt als</kbd><span>${g.userName} (${g.rank})</span></div><div id="sb"></div>`);
    this.box.querySelector('#sb').appendChild(this.backBtn('Zurück', () => this.pauseMenu()));
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
    this.box.querySelector('#fb').appendChild(this.backBtn('Zurück', () => this.pauseMenu()));
  }

  // ---------- Allgemeines Auswahlmenü (Shops etc.) ----------
  // items: [{ label, sub, fn, disabled }]
  listMenu(title, items, intro = '', onClose = null) {
    this._show(`<h2>${title}</h2>${intro ? `<p style="opacity:.85">${intro}</p>` : ''}<div id="lm"></div><div id="lb"></div>`, items.length > 8);
    const lm = this.box.querySelector('#lm');
    for (const it of items) { const b = this.btn(it.label, () => { it.fn?.(); }, it.sub); if (it.disabled) b.disabled = true; lm.appendChild(b); }
    this.box.querySelector('#lb').appendChild(this.backBtn('Schließen', () => { this.close(); onClose?.(); }));
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
      group('Fahndung', [0, 1, 2, 3, 4, 5, 6].map((n) => chip(n ? `${n} ★` : 'Keine', () => g.police.setWanted(n))).concat([chip(g.police.disabled ? 'Polizei an' : 'Polizei aus', () => { g.police.disabled = !g.police.disabled; g.police.clear(true); this.adminMenu('player'); })]));
      group('Figur', [chip(charName('jason'), () => g.player.setOutfit('player_jason')), chip(charName('lucia'), () => g.player.setOutfit('player_lucia'))]);
    } else if (tab === 'system') {
      const r = g.engine.renderer.info;
      const info = document.createElement('div');
      info.style.cssText = 'font-family:Consolas,monospace;font-size:14px;line-height:1.6;opacity:.9;white-space:pre';
      info.textContent = `FPS: ${Math.round(g.fps)}\nGeometrien: ${r.memory.geometries}\nTexturen: ${r.memory.textures}\nChunks: ${g.chunks.chunks.size}\nFahrzeuge: ${g.vehicles.list.length}\nFiguren: ${g.characters.length}\nWelt-Erzeugung: ${Math.round(g.ctx.generatedMs)} ms\nStraßen: ${g.ctx.net.roads.length} (${Math.round(g.ctx.net.totalLength / 1000)} km)\nGebäude: ${g.ctx.buildings.length}`;
      ac.appendChild(info);
      group('Werkzeuge', [chip('Verkehr leeren', () => { for (const v of [...g.traffic.cars]) g.vehicles.remove(v); g.traffic.cars.length = 0; }), chip('Alle Wracks entfernen', () => { for (const v of [...g.vehicles.list]) if (v.exploded) g.vehicles.remove(v); }), chip('Missionen zurücksetzen', () => { g.missions?.reset?.(); this.close(); })]);
    }
    const back = this.backBtn('Zurück zum Pause-Menü', () => { this.adminOpen = false; this.pauseMenu(); });
    ac.appendChild(back);
    const close = this.btn('Schließen (F4)', () => this.close());
    ac.appendChild(close);
  }
}
