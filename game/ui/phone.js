// Handy (Controller: Steuerkreuz ↑): Karte, Quests, Kontakte und Speichern auf einem Smartphone-Bildschirm.
// Das Spiel läuft dabei weiter, man kann mit dem Handy in der Hand gehen oder fahren.
import { PAD } from '../core/input.js';
import { charName, partnerOf } from '../story/characters.js';

export const PHONE_CSS = `
#gui .phone{position:absolute;right:26px;bottom:110px;width:244px;height:min(420px,70vh);display:none;flex-direction:column;padding:12px 12px 10px;border-radius:30px;background:linear-gradient(160deg,#241447,#0d1b33 70%);border:5px solid #0b0b10;box-shadow:0 18px 50px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.28);animation:phoneUp .18s ease-out}
@keyframes phoneUp{from{transform:translateY(60px);opacity:0}to{transform:none;opacity:1}}
#gui .phone .pt{display:flex;justify-content:space-between;font-size:13px;font-weight:700;opacity:.85;padding:0 8px}
#gui .phone .ph{font-size:19px;font-weight:800;margin:10px 6px 10px}
#gui .phone .pg{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start;flex:1;overflow:hidden}
#gui .phone .pg.list{grid-template-columns:1fr;gap:7px}
#gui .phone .pa{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;height:92px;border-radius:18px;background:rgba(255,255,255,.1);border:2px solid transparent;font-size:14px;font-weight:700}
#gui .phone .pa i{font-style:normal;font-size:32px;line-height:1}
#gui .phone .list .pa{flex-direction:row;justify-content:flex-start;gap:10px;height:46px;padding:0 12px;border-radius:12px}
#gui .phone .list .pa i{font-size:18px}
#gui .phone .pa.on{background:linear-gradient(135deg,#ff5fd8,#a855f7);border-color:#fff}
#gui .phone .pf{font-size:12px;opacity:.75;text-align:center;margin-top:6px}
`;

const APPS = [
  { id: 'map', icon: '🗺️', label: 'Karte' },
  { id: 'quests', icon: '✅', label: 'Quests' },
  { id: 'contacts', icon: '👥', label: 'Kontakte' },
  { id: 'save', icon: '💾', label: 'Speichern' },
];
const CALL_LINES = {
  partner: 'Na du? Pass auf dich auf – und komm heil zurück.',
  marco: 'Hola! Wenn es Arbeit gibt, siehst du das rosa „M“ auf der Karte.',
  tomeu: 'Das Meer ist ruhig heute. Genieß die Insel!',
  rafael: 'Ich melde mich, wenn ich dich brauche. Nicht umgekehrt.',
  elena: 'Bestes Flugwetter! Wir sehen uns.',
};

export class Phone {
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.el = document.createElement('div');
    this.el.className = 'phone';
    ui.root.appendChild(this.el);
    this.view = 'home';
    this.index = 0;
    this.items = APPS;
  }

  open() {
    this.view = 'home'; this.index = 0;
    this._draw();
    this.el.style.display = 'flex';
    this.game.audio?.ping();
  }

  close() { this.el.style.display = 'none'; }

  // Tasten auswerten. Rückgabe: Funktion, die nach dem Wegstecken ausgeführt wird (null = Handy bleibt offen)
  input(input) {
    if (input.padHit(PAD.B)) {
      if (this.view === 'home') return () => {};
      this.view = 'home'; this.index = APPS.findIndex((a) => a.id === 'contacts'); this._draw();
      return null;
    }
    const n = this.items.length, cols = this.view === 'home' ? 2 : 1;
    let i = this.index;
    if (input.padHit(PAD.LEFT)) i -= 1;
    if (input.padHit(PAD.RIGHT)) i += 1;
    if (input.padHit(PAD.UP)) i -= cols;
    if (input.padHit(PAD.DOWN)) i += cols;
    if (i !== this.index && n) { this.index = ((i % n) + n) % n; this._draw(); }
    const it = this.items[this.index];
    if (!input.padHit(PAD.A) || !it) return null;
    if (this.view === 'contacts') return () => this._call(it);
    if (it.id === 'contacts') { this.view = 'contacts'; this.index = 0; this._draw(); return null; }
    if (it.id === 'save') return () => this.ui.panels.saveMenu('save', () => this.ui.panels.close());
    return () => this.ui.minimap.open(it.id);
  }

  _contacts() {
    const g = this.game;
    return Object.entries(g.missions?.friends || {}).filter(([, f]) => f.level > 0)
      .map(([id, f]) => ({ id, icon: '📞', label: id === 'partner' ? charName(partnerOf(g.player.who)) : f.name }));
  }

  // Anruf: Klingeln, Handy am Ohr, Antwort als Untertitel – die Steuerung bleibt frei
  _call(contact) {
    const ui = this.ui;
    ui._setCall(true);
    ui.subtitle(`${contact.label} (Anruf)`, CALL_LINES[contact.id] || '…', 5);
    clearTimeout(this._callTimer);
    this._callTimer = setTimeout(() => { if (!ui.dialogOpen) ui._setCall(false); }, 5000);
  }

  _draw() {
    this.items = this.view === 'home' ? APPS : this._contacts();
    const make = (tag, cls, text) => { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const h = this.game.atm.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    const top = make('div', 'pt');
    top.append(make('span', '', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`), make('span', '', '▮▮▮'));
    const grid = make('div', this.view === 'home' ? 'pg' : 'pg list');
    this.items.forEach((it, i) => {
      const tile = make('div', i === this.index ? 'pa on' : 'pa');
      tile.append(make('i', '', it.icon), make('span', '', it.label));
      grid.append(tile);
    });
    this.el.replaceChildren(top, make('div', 'ph', this.view === 'home' ? 'Handy' : 'Kontakte'), grid,
      make('div', 'pf', this.view === 'home' ? 'A: öffnen · B: wegstecken' : 'A: anrufen · B: zurück'));
  }
}
