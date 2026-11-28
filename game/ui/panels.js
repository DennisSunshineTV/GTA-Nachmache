// Menüs im Spiel: Pause, Optionen, Steuerung, Statistik, Speichern/Laden, Shops, Admin-Panel.
import { fmtMoney } from '../util.js';
import { VEHICLE_TYPES } from '../entities/vehicle_models.js';
import { WEAPONS, WEAPON_ORDER } from '../combat/weapons.js';
import { WEATHER_NAMES } from '../render/sky.js';
import { charName } from '../story/characters.js';
import { loadSettings, saveSettings, renderOptions, computeRemap, ACTIONS, ACTION_GROUPS, FIXED_INFO, CONTROLLER_LAYOUT, effectiveCode, keyLabel } from '/assets/options.js';

// Einstellungen und Tastenbelegung liegen in assets/options.js (auch vom Startbildschirm genutzt)
export { loadSettings, saveSettings };

// Eigene Speicherplätze (dazu Platz 0 = Auto-Save)
export const SAVE_SLOTS = 5;

// Kleine Symbole für die Statistik-Karten
const SI = {
  clock: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.4 3.6 2.1-.9 1.6L11 13V6h2z"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><path d="M7 2h2v2h6V2h2v2h3a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h3zm-2 7v10h14V9z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 2 3 6.6 7.2.8-5.4 4.9 1.5 7.1L12 17.8l-6.3 3.6 1.5-7.1L1.8 9.4 9 8.6z"/></svg>',
  euro: '<svg viewBox="0 0 24 24"><path d="M15 4c2 0 3.7.6 5 1.6l-1.2 1.8A6.4 6.4 0 0 0 15 6.2c-2.6 0-4.7 1.6-5.5 4H16l-.6 1.8H9.1v.8l.1 1H15l-.6 1.8H9.5c.9 2.3 3 3.9 5.5 3.9 1.5 0 2.8-.4 3.8-1.2l1.2 1.8A8.6 8.6 0 0 1 15 21c-3.9 0-7.1-2.6-8-6.2H4l.6-1.8h2.1l-.1-1 .1-.8H4l.6-1.8H7C7.9 6.6 11.1 4 15 4z"/></svg>',
  house: '<svg viewBox="0 0 24 24"><path d="M12 3 2 11h3v10h5v-6h4v6h5V11h3z"/></svg>',
  car: '<svg viewBox="0 0 24 24"><path d="M5.5 10.5 7.3 6c.3-.9 1.1-1.5 2-1.5h5.4c.9 0 1.7.6 2 1.5l1.8 4.5c1 .2 1.8 1.1 1.8 2.2v4.1c0 .6-.4 1-1 1h-.8v1.4c0 .5-.4.9-.9.9h-1.5c-.5 0-.9-.4-.9-.9v-1.4H8.8v1.4c0 .5-.4.9-.9.9H6.4c-.5 0-.9-.4-.9-.9v-1.4h-.8c-.6 0-1-.4-1-1v-4.1c0-1.1.8-2 1.8-2.2zm2-.3h9L15 6.6c-.1-.3-.3-.4-.6-.4H9.6c-.3 0-.5.1-.6.4z"/></svg>',
  road: '<svg viewBox="0 0 24 24"><path d="M9 2h2l-1 20H5zm4 0h2l4 20h-5zM11.2 4h1.6l.2 3h-2zm-.3 5h2.2l.2 4h-2.6zm-.3 6h2.8l.3 5h-3.4z"/></svg>',
  target: '<svg viewBox="0 0 24 24"><path d="M11 1h2v3.1A8 8 0 0 1 19.9 11H23v2h-3.1A8 8 0 0 1 13 19.9V23h-2v-3.1A8 8 0 0 1 4.1 13H1v-2h3.1A8 8 0 0 1 11 4.1zm1 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm0 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z"/></svg>',
  bullet: '<svg viewBox="0 0 24 24"><path d="M10 2h4c1.7 2.1 2 4.4 2 7v9H8V9c0-2.6.3-4.9 2-7zM7 19h10v3H7z"/></svg>',
  badge: '<svg viewBox="0 0 24 24"><path d="M12 1 3 5v6c0 5.6 3.8 10.7 9 12 5.2-1.3 9-6.4 9-12V5zm0 5 1.6 3.3 3.6.5-2.6 2.5.6 3.6L12 14.2l-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z"/></svg>',
};

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
    // Grafik: Auflösung (Render-Auflösung des Spiels) und Schatten ein/aus
    g.engine.setResolution?.(s.resolution);
    if (g.engine.setShadows?.(s.shadows !== false)) g.onQualityChanged?.();
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
    this._friendsCtl?.dispose(); this._friendsCtl = null;
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
    const mp = g.net;
    this._show(`<h2>${mp ? 'Pause · Multiplayer' : 'Pause'}</h2><div id="pm"></div>`);
    const pm = this.box.querySelector('#pm');
    const items = [
      ['Weiter spielen', () => this.close()],
      ['Karte', () => this.openMap('map')],
      ['Quests', () => this.openMap('quests')],
    ];
    if (mp) items.push(['Spieler auf dem Server', () => this.playersMenu(), mp.serverName + ' · ' + mp.countText()]);
    else items.push(['Spiel speichern', () => this.saveMenu('save'), this.saveInfo()], ['Speicherstand laden', () => this.saveMenu('load')]);
    items.push(
      ['Optionen', () => this.optionsMenu()],
      ['Steuerung', () => this.controlsMenu()],
      ['Statistiken', () => this.statsMenu()],
      ['Freundschaften', () => this.friendsMenu()],
      [mp ? 'Server verlassen' : 'Hauptmenü', () => this.confirm(mp ? 'Den Server verlassen und zum Hauptmenü zurückkehren?' : 'Zum Hauptmenü zurückkehren? Nicht gespeicherter Fortschritt geht verloren.', mp ? 'Server verlassen' : 'Zum Hauptmenü', () => g.exitToMenu?.(), () => this.pauseMenu())],
    );
    // Admins und Sysadmins erreichen das Admin-Menü auch über das Pause-Menü (sonst nur mit F4) – rot umrandet
    if (g.isAdmin) items.push(['Admin-Menü', () => this.adminMenu('teleport'), g.rank + ' · ' + g.userName, 'admin']);
    for (const [l, f, sub, cls] of items) { const b = this.btn(l, f, sub || ''); if (cls) b.classList.add(cls); pm.appendChild(b); }
  }

  // Multiplayer: wer gerade auf dem Server ist
  playersMenu() {
    const g = this.game, mp = g.net;
    if (!mp) { this.pauseMenu(); return; }
    const list = mp.playerList();
    this._show(`<h2>${mp.serverName} <small style="font-size:15px;opacity:.75">(${mp.countText()})</small></h2><div id="pl"></div><div id="pb"></div>`);
    const pl = this.box.querySelector('#pl');
    for (const r of list) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;margin:8px 0;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,.07)';
      const dot = document.createElement('i');
      dot.style.cssText = `flex:0 0 12px;height:12px;border-radius:50%;background:${r.me ? '#ff5de6' : '#4ade80'}`;
      const name = document.createElement('b'); name.textContent = r.name + (r.me ? ' (du)' : '');
      const info = document.createElement('span'); info.style.cssText = 'margin-left:auto;opacity:.75;font-size:14px'; info.textContent = r.info;
      row.append(dot, name, info);
      pl.appendChild(row);
    }
    this.box.querySelector('#pb').appendChild(this.backBtn('Zurück', () => this.pauseMenu()));
  }

  // Speicherplätze: ganz oben der Auto-Save, darunter die 5 eigenen Speicherplätze.
  // mode 'save': in einen Platz speichern (Auto-Save kann man nicht von Hand überschreiben); 'load': einen Stand laden.
  // Ältere Spielstände aus den früheren Plätzen 6–10 lassen sich weiterhin laden (sie stehen dann darunter).
  async saveMenu(mode, back = () => this.pauseMenu()) {
    const g = this.game;
    if (g.net) { this.listMenu('Multiplayer', [], 'Im Multiplayer wird nicht gespeichert – deine Einzelspieler-Spielstände bleiben unverändert.', () => back()); return; }
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
    const shown = [];
    for (let n = 0; n <= SAVE_SLOTS; n++) shown.push(n);
    if (mode === 'load') for (const s of slots) if (s.slot > SAVE_SLOTS) shown.push(s.slot);
    for (const n of shown) {
      const s = by.get(n);
      const label = n === 0 ? 'Auto-Save <span style="font-weight:500;opacity:.75">(automatisch)</span>' : n > SAVE_SLOTS ? `Älterer Speicherstand ${n} <span style="font-weight:500;opacity:.75">(nur laden)</span>` : 'Speicherplatz ' + n;
      let sub = s ? info(s) : (n === 0 ? (g.autoSaveOn ? 'Noch nichts automatisch gespeichert' : 'Auto-Save ist aus (Optionen → Speichern)') : 'Leer');
      let disabled = false, fn = null;
      if (mode === 'save') {
        if (n === 0) { disabled = true; sub += g.autoSaveOn && s ? ' · wird nach jeder Mission automatisch aktualisiert' : ''; }
        else {
          const save = async () => { await g.saveToServer(false, n); this.saveMenu('save', back); };
          fn = s ? () => this.confirm('Speicherplatz ' + n + ' überschreiben?', 'Überschreiben', save, () => this.saveMenu('save', back)) : save;
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

  // Statistiken als Kartenraster: Kopf mit Figur und aktuellem Spieltag, darunter Zeit, Fortschritt, Kampf und Unterwegs.
  // „Tage im Spiel“ zählt die Spieltage (Uhr im Spiel: 1 Spielstunde = 100 s, Schlafen zählt mit); im Multiplayer gilt die Serverzeit.
  statsMenu() {
    const g = this.game, st = g.stats, p = g.player;
    const mins = Math.floor((st.playMs || 0) / 60000);
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const h = g.atm.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} Uhr`;
    const days = g.net ? g.net.serverDay() - 1 : (st.days || 0);
    const total = g.missions?.total || 0, done = st.missionsDone || 0;
    const km = (st.distance || 0) / 1000;
    const card = (icon, label, value, cls = '', extra = '') => `<div class="stat-card ${cls}"><i>${SI[icon] || ''}</i><small>${label}</small><b>${value}</b>${extra}</div>`;
    const sec = (t) => `<div class="stat-sec">${t}</div>`;
    const who = charName(p.who);
    this._show(`<h2>Statistiken</h2>
      <div class="stat-head"><div class="stat-ava">${esc(who.charAt(0))}</div><div class="stat-who"><b>${esc(who)}</b><span>${esc(g.userName)} · ${esc(g.rank)}${g.net ? ' · ' + esc(g.net.serverName) : ''}</span></div>
        <div class="stat-day"><b>Tag ${days + 1}</b><span>${clock}${g.net ? ' · Serverzeit' : ''}</span></div></div>
      ${sec('Zeit')}<div class="stat-grid">
        ${card('cal', g.net ? 'Tage auf dem Server' : 'Tage im Spiel', days.toLocaleString('de-DE'), 'accent')}
        ${card('sun', 'Aktueller Spieltag', 'Tag ' + (days + 1))}
        ${card('clock', 'Uhrzeit im Spiel', clock)}
        ${card('clock', 'Echte Spielzeit', `${Math.floor(mins / 60)} Std. ${mins % 60} Min.`)}
      </div>
      ${sec('Fortschritt & Besitz')}<div class="stat-grid">
        ${card('star', 'Missionen', `${done} / ${total}`, '', `<div class="stat-bar"><em style="width:${total ? Math.round((done / total) * 100) : 0}%"></em></div>`)}
        ${card('euro', 'Geld', fmtMoney(g.money), 'money')}
        ${card('house', 'Immobilien', Object.keys(g.owned.properties || {}).length)}
        ${card('car', 'Eigene Fahrzeuge', (g.owned.vehicles || []).length)}
      </div>
      ${sec('Kampf & Unterwegs')}<div class="stat-grid">
        ${card('target', 'Besiegte Gegner', (st.kills || 0).toLocaleString('de-DE'))}
        ${card('bullet', 'Abgegebene Schüsse', (st.shots || 0).toLocaleString('de-DE'))}
        ${card('badge', 'Höchste Fahndung', (st.maxWanted || 0) + ' ★')}
        ${card('road', 'Zurückgelegte Strecke', km < 10 ? km.toFixed(1).replace('.', ',') + ' km' : Math.round(km).toLocaleString('de-DE') + ' km')}
      </div><div id="sb" style="margin-top:14px"></div>`, true);
    this.box.querySelector('#sb').appendChild(this.backBtn('Zurück', () => this.pauseMenu()));
  }

  // Freundschaften: oben die Mitglieder (Suche, Anfragen, Freundesliste – assets/friends.js, wie auf der Startseite),
  // darunter die Kontakte aus den Missionen
  friendsMenu(tab = 'members') {
    const g = this.game;
    const list = g.missions?.friendList?.() || [];
    this._show(`<h2>Freundschaften</h2><div class="tabs"><div class="tab ${tab === 'members' ? 'on' : ''}" data-t="members">Mitglieder</div><div class="tab ${tab === 'contacts' ? 'on' : ''}" data-t="contacts">Kontakte im Spiel</div></div><div id="fl"></div><div id="fb"></div>`, true);
    this.box.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { this._friendsCtl?.dispose(); this.friendsMenu(t.dataset.t); }));
    const fl = this.box.querySelector('#fl');
    const back = () => { this._friendsCtl?.dispose(); this._friendsCtl = null; this.pauseMenu(); };
    if (tab === 'members') {
      import('/assets/friends.js').then((m) => { if (this.open && fl.isConnected) this._friendsCtl = m.renderFriends(fl, { onChange: (d) => this.ui.friendData?.(d) }); })
        .catch(() => { fl.textContent = 'Die Freundschaften konnten nicht geladen werden.'; });
    } else {
      if (!list.length) fl.innerHTML = '<p>Du hast noch niemanden kennengelernt. Schließe Missionen ab, um Kontakte zu knüpfen.</p>';
      for (const f of list) {
        const row = document.createElement('div');
        row.style.cssText = 'margin:10px 0;padding:10px 14px;border-radius:10px;background:rgba(255,255,255,.07)';
        row.innerHTML = `<b>${f.name}</b> <span style="opacity:.7">· ${f.role}</span><div style="margin-top:6px;height:8px;border-radius:5px;background:rgba(0,0,0,.4);overflow:hidden"><i style="display:block;height:100%;width:${f.level}%;background:linear-gradient(90deg,#ff5de6,#ffb347)"></i></div><div style="font-size:13px;opacity:.75;margin-top:4px">${f.text}</div>`;
        fl.appendChild(row);
      }
    }
    this.box.querySelector('#fb').appendChild(this.backBtn('Zurück', back));
  }

  // ---------- Schlafen (Bett im Strandhaus) ----------
  // Aufwachzeit wählen; geht der Schlaf über Mitternacht, beginnt ein neuer Spieltag
  sleepMenu() {
    const g = this.game;
    if (g.net) { this.listMenu('Schlafen', [], 'Im Multiplayer läuft für alle dieselbe Serverzeit – Schlafen ist nur im Einzelspieler möglich.'); return; }
    if (g.police.wanted > 0) { this.listMenu('Schlafen', [], 'Mit Fahndung kannst du nicht schlafen. Hänge zuerst die Polizei ab.'); return; }
    const now = g.atm.hour, day = (g.stats.days || 0) + 1;
    const hh = Math.floor(now), mm = Math.floor((now - hh) * 60);
    this._show(`<h2>Schlafen</h2><p style="opacity:.85;margin:0 0 12px">Jetzt ist es ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} Uhr (Tag ${day}). Wann möchtest du aufwachen?</p><div id="sg" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px"></div><div id="sb" style="margin-top:10px"></div>`, true);
    const sg = this.box.querySelector('#sg');
    for (const h of [5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22]) {
      let dh = ((h - now) % 24 + 24) % 24;
      if (dh < 0.5) dh += 24;
      const newDay = now + dh >= 24;
      const hrs = Math.floor(dh), mins = Math.round((dh - hrs) * 60);
      const b = this.btn(`${String(h).padStart(2, '0')}:00 Uhr`, () => { this.close(); g.sleep(h); }, `${hrs} Std.${mins ? ' ' + mins + ' Min.' : ''} Schlaf · ${newDay ? 'Tag ' + (day + 1) : 'noch Tag ' + day}`);
      b.style.margin = '0'; b.style.textAlign = 'center';
      if (newDay) b.style.borderColor = 'rgba(255,212,106,.55)';
      sg.appendChild(b);
    }
    this.box.querySelector('#sb').appendChild(this.backBtn('Abbrechen', () => this.close()));
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
    this._show(`<div class="ahead"><h2>Admin-Menü <small style="font-size:14px;opacity:.7">(${g.rank} · ${g.userName})</small></h2><button type="button" class="abtn" title="Mitglieder und Protokoll – wie im Admin-Menü der Startseite">Admin</button></div><div class="tabs">${tabs.map(([k, l]) => `<div class="tab ${k === tab ? 'on' : ''}" data-t="${k}">${l}</div>`).join('')}</div><div id="ac"></div>`, true);
    this.box.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => this.adminMenu(t.dataset.t)));
    // „Admin“ oben rechts: öffnet das Admin-Menü der Startseite (Mitglieder, Protokoll) über dem Spiel
    this.box.querySelector('.abtn').addEventListener('click', () => {
      const open = window.__streetlife?.openAdmin;
      if (open) open(); else this.ui.notify('Das Admin-Menü der Startseite ist nicht verfügbar', 'warn');
    });
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
      const groups = { 'Autos': ['sports', 'coupe', 'luxury', 'limo', 'suv', 'compact', 'taxi', 'police', 'van', 'econelo', 'pickup'], 'Zweiräder & Nutzfahrzeuge': ['moto', 'truck', 'bus', 'tractor', 'forklift', 'excavator'], 'Wasser & Luft': ['speedboat', 'yacht', 'jetski', 'plane', 'heli'] };
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
