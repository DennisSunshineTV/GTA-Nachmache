// Controller-Bedienung der Oberfläche (Xbox): Waffenrad, Fahrzeugmenü, Handy, Karte, Spielmenüs und Dialoge.
// update() läuft in jedem Bild vor der Spielfigur und verbraucht die Tasten, die eine Oberfläche benutzt.
import { PAD } from '../core/input.js';
import { WEAPONS, WEAPON_ORDER } from '../combat/weapons.js';
import { Phone, PHONE_CSS } from './phone.js';

const VEH_MENU_HOLD = 0.25;   // Steuerkreuz ← so lange (s) halten, bis das Fahrzeugmenü erscheint

export const PAD_CSS = `
#gui .radial{position:absolute;inset:0;display:none;background:radial-gradient(circle at center,rgba(8,5,20,.62) 0,rgba(8,5,20,.34) 55%,rgba(8,5,20,.12) 100%);--r:min(230px,32vmin)}
#gui .radial .ri{position:absolute;transform:translate(-50%,-50%);width:min(148px,21vmin);min-height:min(60px,9vmin);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:6px 8px;border-radius:14px;background:rgba(14,10,32,.82);border:2px solid rgba(255,255,255,.2);font-size:clamp(11px,1.9vmin,15px);font-weight:700;line-height:1.2;overflow-wrap:anywhere;transition:transform .1s,background .1s}
#gui .radial .ri small{font-size:.82em;font-weight:500;opacity:.75;margin-top:2px}
#gui .radial .ri.off{opacity:.35}
#gui .radial .ri.on{background:linear-gradient(135deg,#ff5fd8,#a855f7);border-color:#fff;transform:translate(-50%,-50%) scale(1.14);z-index:2}
#gui .radial .rc{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(210px,28vmin);text-align:center;text-shadow:0 2px 6px #000}
#gui .radial .rc div{font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#ff9be9}
#gui .radial .rc b{display:block;font-size:clamp(15px,2.8vmin,22px);margin-top:4px}
#gui .radial .rh{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);font-size:14px;white-space:nowrap;text-shadow:0 1px 4px #000}
#gui .padfocus{outline:3px solid #ffe14a !important;outline-offset:2px}
#gui .mb.padfocus,#gui .chip.padfocus,#gui .qbtn.padfocus{background:rgba(255,130,230,.34)}
` + PHONE_CSS;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Kreisförmiges Auswahlmenü: Der rechte Stick zeigt auf einen Eintrag
class Radial {
  constructor(root) {
    this.el = el('div', 'radial');
    root.appendChild(this.el);
    this.items = []; this.nodes = []; this.index = -1;
  }

  open(title, items, index, hint) {
    this.title = title; this.index = index;
    this.el.textContent = '';
    this.nodes = items.map((_, i) => {
      const a = (i / items.length) * Math.PI * 2 - Math.PI / 2;   // erster Eintrag oben, dann im Uhrzeigersinn
      const d = el('div', 'ri');
      d.style.left = `calc(50% + ${Math.cos(a).toFixed(4)} * var(--r))`;
      d.style.top = `calc(50% + ${Math.sin(a).toFixed(4)} * var(--r))`;
      this.el.appendChild(d);
      return d;
    });
    this.center = el('div', 'rc');
    this.el.append(this.center, el('div', 'rh', hint));
    this.set(items);
    this.el.style.display = 'block';
  }

  set(items) {
    this.items = items;
    items.forEach((it, i) => this.nodes[i].replaceChildren(el('span', '', it.label), el('small', '', it.sub || '')));
    this._paint();
  }

  point(x, y) {
    if (Math.hypot(x, y) < 0.5) return;
    const n = this.items.length, turn = Math.PI * 2;
    const i = Math.round(((Math.atan2(x, -y) + turn) % turn) / (turn / n)) % n;
    if (i !== this.index && !this.items[i].disabled) { this.index = i; this._paint(); }
  }

  _paint() {
    this.nodes.forEach((d, i) => { d.classList.toggle('on', i === this.index); d.classList.toggle('off', !!this.items[i].disabled); });
    this.center.replaceChildren(el('div', '', this.title), el('b', '', this.selected?.label || '–'));
  }

  get selected() { return this.items[this.index] || null; }
  close() { this.el.style.display = 'none'; this.index = -1; }
}

export class PadUI {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.mode = null;          // offenes Overlay: 'wheel' | 'vehmenu' | 'phone'
    this.radial = new Radial(ui.root);
    this.phone = new Phone(game, ui);
    this.connected = false;
    this.leftT = 0;
    this.focused = null; this.focusI = 0; this.menuKey = ''; this.questI = 0;
    this.navKey = ''; this.navT = 0;
  }

  get slowmo() { return this.mode === 'wheel' || this.mode === 'vehmenu' ? 0.25 : 1; }
  get usesRightStick() { return this.mode === 'wheel' || this.mode === 'vehmenu'; }

  update(dt) {
    const input = this.game.input, ui = this.ui;
    if (input.pad.active !== this.connected) this._connection(input.pad.active);
    if (input.device !== 'pad') this._clearFocus();     // Maus/Tastatur übernehmen
    if (!ui.panels.open) this.menuKey = '';
    if (!input.pad.active) return;
    // genau eine Ebene reagiert pro Bild
    if (ui.panels.open) { this.close(); this._menu(dt); return; }
    if (ui.minimap.full) { this.close(); this._map(dt); return; }
    this._clearFocus();
    if (ui.dialogOpen) { this.close(); this._dialog(); return; }
    this._play(dt);
  }

  close() {
    if (!this.mode) return;
    if (this.mode === 'phone') this.phone.close(); else this.radial.close();
    this.mode = null; this.leftT = 0;
  }

  _connection(on) {
    this.connected = on;
    if (on) { this.ui.notify('Controller verbunden', 'good'); return; }
    this.close();
    this.ui.notify('Controller getrennt', 'warn');
    if (!this.game.paused && !this.ui.dialogOpen && this.game.player.alive) this.ui.panels.pauseMenu();
  }

  // ---------- Im Spiel ----------
  _play(dt) {
    const g = this.game, input = g.input, p = g.player;
    if (input.padHit(PAD.MENU)) { this.close(); this.ui.panels.pauseMenu(); input.swallow(); return; }
    if (input.padHit(PAD.VIEW)) { this.close(); this.ui.minimap.open('map'); input.swallow(); return; }
    if (!p.alive || !g.controlsEnabled) { this.close(); return; }
    if (this.mode === 'wheel') this._wheel();
    else if (this.mode === 'vehmenu') this._vehMenu();
    else if (this.mode === 'phone') this._phone();
    else {
      this.leftT = p.vehicle && input.padDown(PAD.LEFT) ? this.leftT + dt : 0;
      if (!p.vehicle && !p.climb && input.padHit(PAD.LB)) this._openWheel();
      else if (this.leftT >= VEH_MENU_HOLD) this._openVehMenu();
      else if (input.padHit(PAD.UP)) { this.mode = 'phone'; this.phone.open(); input.consume(PAD.UP); }
    }
  }

  // ---------- Waffenrad (LB halten) ----------
  _openWheel() {
    const p = this.game.player;
    const items = WEAPON_ORDER.map((id) => {
      const W = WEAPONS[id], w = p.weapons[id], has = p.hasWeapon(id);
      const sub = !has ? 'nicht im Inventar' : W.melee ? 'Nahkampf' : W.thrown ? `${w.mag + w.reserve} Stück` : `${w.mag} / ${w.reserve}`;
      return { id, label: W.name.replace('schützengewehr', 'schützen­gewehr'), sub, disabled: !has };   // weicher Trennstrich
    });
    this.mode = 'wheel';
    this.radial.open('Waffen', items, WEAPON_ORDER.indexOf(p.cur), 'Rechter Stick: wählen · LB loslassen: übernehmen · B: abbrechen');
    this._wheel();
  }

  _wheel() {
    const input = this.game.input, p = this.game.player;
    const cancel = input.padHit(PAD.B);
    input.consume(PAD.A, PAD.B, PAD.X, PAD.Y, PAD.RB, PAD.LT, PAD.RT, PAD.UP);
    if (cancel || p.vehicle) { this.close(); return; }
    this.radial.point(input.pad.rx, input.pad.ry);
    if (!input.padDown(PAD.LB)) {
      const it = this.radial.selected;
      if (it && !it.disabled) p.setWeapon(it.id);
      this.close();
    }
  }

  // ---------- Fahrzeugmenü (Steuerkreuz ← halten) ----------
  _vehItems() {
    const g = this.game, v = g.player.vehicle, r = g.radio;
    const station = r?.stationName || 'Aus';
    const onOff = (b) => (b ? 'an' : 'aus');
    const items = [
      { label: 'Radio: weiter', sub: station, act: () => r?.next(1) },
      { label: 'Licht', sub: onOff(v.lightsOn), act: () => { v.lightsOn = !v.lightsOn; } },
    ];
    if (v.cls !== 'plane' && v.cls !== 'heli') items.push({ label: 'Motor', sub: v.engineOn ? 'läuft' : 'aus', act: () => { v.engineOn = !v.engineOn && !v.burning && !v.exploded; } });
    if (v.type === 'police') items.push({ label: 'Sirene', sub: onOff(v.sirenOn), act: () => { v.sirenOn = !v.sirenOn; } });
    items.push({ label: 'Radio aus', sub: station, act: () => r?.setStation(-1) }, { label: 'Radio: zurück', sub: station, act: () => r?.next(-1) });
    return items;
  }

  _openVehMenu() {
    this.mode = 'vehmenu'; this.applied = false;
    this.radial.open('Fahrzeug', this._vehItems(), -1, 'Rechter Stick: wählen · A: ausführen · ← loslassen: übernehmen · B: abbrechen');
  }

  _vehMenu() {
    const input = this.game.input, p = this.game.player;
    const cancel = input.padHit(PAD.B), run = input.padHit(PAD.A);
    input.consume(PAD.A, PAD.B, PAD.X, PAD.Y, PAD.UP);
    if (cancel || !p.vehicle) { this.close(); input.consume(PAD.LEFT); return; }
    this.radial.point(input.pad.rx, input.pad.ry);
    const it = this.radial.selected;
    if (run && it) { it.act(); this.applied = true; this.radial.set(this._vehItems()); }
    if (!input.padDown(PAD.LEFT)) {
      if (it && !this.applied) it.act();
      this.close();
    }
  }

  // ---------- Handy (Steuerkreuz ↑) ----------
  _phone() {
    const input = this.game.input, p = this.game.player;
    // Zielen oder Schießen zu Fuß steckt das Handy weg
    if (!p.vehicle && (input.padHit(PAD.LT) || input.padHit(PAD.RT))) { this.close(); return; }
    const then = this.phone.input(input);
    input.consume(PAD.A, PAD.B, PAD.X, PAD.Y, PAD.UP, PAD.DOWN, PAD.LEFT, PAD.RIGHT);
    if (then) { this.close(); input.swallow(); then(); }
  }

  // ---------- Dialoge ----------
  _dialog() {
    const input = this.game.input;
    if (input.padHit(PAD.MENU)) return;
    if (input.padHit(PAD.A) && this.ui.dialogLineT > 0.25) { this.ui._nextLine(); input.swallow(); }
  }

  // ---------- Menüs ----------
  // Richtung vom Steuerkreuz oder linken Stick, mit Wiederholung beim Halten: [x, y]
  _nav(dt) {
    const input = this.game.input, pad = input.pad;
    const y = input.padDown(PAD.UP) || pad.ly < -0.55 ? -1 : input.padDown(PAD.DOWN) || pad.ly > 0.55 ? 1 : 0;
    const x = y ? 0 : input.padDown(PAD.LEFT) || pad.lx < -0.55 ? -1 : input.padDown(PAD.RIGHT) || pad.lx > 0.55 ? 1 : 0;
    const key = x || y ? `${x},${y}` : '';
    if (key !== this.navKey) { this.navKey = key; this.navT = 0.4; return [x, y]; }
    if (!key || (this.navT -= dt) > 0) return [0, 0];
    this.navT = 0.12;
    return [x, y];
  }

  _setFocus(node, scroll) {
    if (this.game.input.device !== 'pad') return;
    if (this.focused !== node) { this._clearFocus(); node.classList.add('padfocus'); this.focused = node; }
    if (scroll) node.scrollIntoView({ block: 'nearest' });
  }

  _clearFocus() {
    this.focused?.classList.remove('padfocus');
    this.focused = null;
  }

  _menu(dt) {
    const input = this.game.input, panels = this.ui.panels, box = panels.box;
    if (input.padHit(PAD.MENU)) { panels.close(); input.swallow(); return; }
    if (input.padHit(PAD.B)) { input.swallow(); panels.back(); return; }
    const turn = input.padHit(PAD.LB) ? -1 : input.padHit(PAD.RB) ? 1 : 0;
    if (turn) {
      const tabs = [...box.querySelectorAll('.tab, .opt-tab')];
      const i = tabs.findIndex((t) => t.classList.contains('on'));
      if (tabs.length) { tabs[(i + turn + tabs.length) % tabs.length].click(); this.menuKey = ''; }
      return;
    }
    // rechter Stick scrollt lange Listen
    if (input.pad.ry) {
      const list = [...box.querySelectorAll('.opt-scroll, .opt-keys')].find((e) => e.offsetParent !== null) || box;
      list.scrollTop += input.pad.ry * 700 * dt;
    }
    // Tasten-Umbelegung braucht die Tastatur und wird übersprungen
    const items = [...box.querySelectorAll('.mb, .tab, .chip, .opt-tab, .opt-toggle, .opt-all button, input, select')].filter((e) => !e.disabled && e.offsetParent !== null);
    if (!items.length) return;
    const key = box.querySelector('h2')?.textContent || '';
    if (key !== this.menuKey) { this.menuKey = key; this.focusI = Math.max(0, items.findIndex((e) => !e.matches('.tab, .opt-tab'))); }
    this.focusI = Math.min(this.focusI, items.length - 1);
    const [dx, dy] = this._nav(dt);
    const cur = items[this.focusI];
    let moved = false;
    if (dy && items.length === 1) box.scrollTop += dy * 90;
    else if (dy) { this.focusI += dy; moved = true; }
    else if (dx && cur.type === 'range') {
      cur.value = String(+cur.value + dx * (+cur.step || 1));
      cur.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (dx && cur.tagName === 'SELECT') {
      cur.selectedIndex = Math.max(0, Math.min(cur.options.length - 1, cur.selectedIndex + dx));
      cur.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (dx) { this.focusI += dx; moved = true; }
    this.focusI = (this.focusI + items.length) % items.length;
    if (input.padHit(PAD.A)) { input.consume(PAD.A); items[this.focusI].click(); return; }
    this._setFocus(items[this.focusI], moved);
  }

  // ---------- Vollbildkarte ----------
  _map(dt) {
    const input = this.game.input, map = this.ui.minimap;
    if (input.padHit(PAD.MENU)) { input.swallow(); map.close(false); this.ui.panels.pauseMenu(); return; }
    if (input.padHit(PAD.VIEW)) { input.swallow(); map.close(false); return; }
    if (input.padHit(PAD.B)) { input.swallow(); map.close(true); return; }
    if (input.padHit(PAD.LB) || input.padHit(PAD.RB)) { map.setTab(map.tab === 'map' ? 'quests' : 'map'); this.questI = 0; return; }
    if (map.tab === 'map') { this._clearFocus(); map.padControl(input, dt); return; }
    // Quests: Steuerkreuz wählt eine Quest, A setzt den Wegpunkt, rechter Stick scrollt
    const panel = map.fullEl.querySelector('.questpanel');
    if (input.pad.ry) panel.scrollTop += input.pad.ry * 700 * dt;
    const items = [...panel.querySelectorAll('.qbtn')];
    const [, dy] = this._nav(dt);
    if (!items.length) { panel.scrollTop += dy * 90; return; }
    this.questI = Math.max(0, Math.min(items.length - 1, this.questI + dy));
    if (input.padHit(PAD.A)) { input.consume(PAD.A); items[this.questI].click(); return; }
    this._setFocus(items[this.questI], dy !== 0);
  }
}
