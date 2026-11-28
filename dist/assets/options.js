// Optionen (Audio · Grafik · Tastatur · Controller · Speichern): gemeinsam genutzt vom Startbildschirm (index.html) und vom Pause-Menü im Spiel.
// Liegt bewusst in /assets/ (öffentlich), weil die Optionen schon vor der Anmeldung erreichbar sind.

export const SETTINGS_KEY = 'streetlife.settings.v1';
export const DEFAULTS = { quality: 'high', master: 0.8, music: 0.7, sfx: 0.8, lobby: 0.5, autosave: true, sens: 1, invertY: false, keys: {} };

export function loadSettings() {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    if (!s.keys || typeof s.keys !== 'object') s.keys = {};
    return s;
  } catch { return { ...DEFAULTS, keys: {} }; }
}
export function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignorieren */ } }

// ---------- Tastenbelegung ----------
// codes: Standard-Tasten (KeyboardEvent.code, unabhängig vom Tastaturlayout). Das Spiel fragt immer diese Standard-Codes ab;
// eigene Belegungen werden in der Eingabe (game/core/input.js) auf sie zurückgeführt.
export const ACTION_GROUPS = [
  { id: 'move', label: 'Bewegung & Fahrzeuge' },
  { id: 'combat', label: 'Waffen' },
  { id: 'view', label: 'Ansichten & Menüs' },
];

const A = (id, group, label, codes, extra = {}) => ({ id, group, label, codes: Array.isArray(codes) ? codes : [codes], ...extra });
export const ACTIONS = [
  A('forward', 'move', 'Vorwärts · Gas · Flugzeug: Nase runter', 'KeyW'),
  A('back', 'move', 'Rückwärts · Bremse · Flugzeug: Nase hoch', 'KeyS'),
  A('left', 'move', 'Links · Flugzeug: Querneigung links', 'KeyA'),
  A('right', 'move', 'Rechts · Flugzeug: Querneigung rechts', 'KeyD'),
  A('sprint', 'move', 'Sprinten (zu Fuß) · Gas (Flugzeug)', ['ShiftLeft', 'ShiftRight'], { shown: 'Shift' }),
  A('jump', 'move', 'Springen · Handbremse · Bremse', 'Space'),
  A('crouch', 'move', 'Ducken', 'KeyC'),
  A('interact', 'move', 'Einsteigen · Aussteigen · Interagieren', 'KeyF'),
  A('horn', 'move', 'Hupe', 'KeyH'),
  A('lights', 'move', 'Licht an/aus', 'KeyL'),
  A('siren', 'move', 'Polizeisirene (Polizeiauto)', 'KeyG'),
  A('radioNext', 'move', 'Radio: nächster Sender (Fahrzeug) · Seitenruder (Flugzeug)', 'KeyE'),
  A('radioPrev', 'move', 'Radio: voriger Sender (Fahrzeug) · Seitenruder (Flugzeug)', 'KeyQ'),
  A('descend', 'move', 'Flugzeug: Sinken', 'KeyX'),
  A('reload', 'combat', 'Nachladen', 'KeyR'),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => A('weapon' + n, 'combat', 'Waffe ' + n, 'Digit' + n)),
  A('camera', 'view', 'Kameraansicht wechseln (Karte: 2D / 3D)', 'KeyV'),
  A('map', 'view', 'Karte öffnen / schließen', 'KeyM'),
  A('fps', 'view', 'FPS-Anzeige', 'KeyN'),
  A('admin', 'view', 'Admin-Menü im Spiel (nur Admins)', 'F4'),
  A('pause', 'view', 'Pause-Menü', 'Escape', { fixed: true }),
];

// Weitere feste Bedienung (Maus und Sonderfälle), nur zur Information
export const FIXED_INFO = [
  ['Maus', 'Kamera drehen · Zielen'],
  ['Rechte Maustaste', 'Zielen'],
  ['Linke Maustaste', 'Schießen · Schlagen · Dialog weiter'],
  ['Mausrad', 'Waffe wechseln'],
  ['Leertaste / Enter', 'Dialog weiter'],
  ['Tab', 'Karte: zwischen Karte und Quests wechseln'],
  ['2 / 3', 'Karte: direkt 2D oder 3D wählen'],
  ['L', 'Karte: Legende ein / aus'],
];

// ---------- Xbox-Controller (feste Belegung; Anzeige in den Optionen und im Menü "Steuerung") ----------
export const CONTROLLER_LAYOUT = [
  { title: 'Zu Fuß', rows: [['Linker Stick', 'Bewegen'], ['Rechter Stick', 'Kamera'], ['LS drücken', 'Rennen'], ['A', 'Springen · Klettern'], ['B', 'Ducken (an / aus)'], ['X', 'Nahkampf'], ['Y', 'Interagieren · Einsteigen'], ['LT', 'Zielen'], ['RT', 'Schießen'], ['LB halten', 'Waffenrad (rechter Stick wählt)'], ['Steuerkreuz ↑', 'Handy'], ['View', 'Karte'], ['Menü', 'Pause-Menü']] },
  { title: 'Kampf', rows: [['LT', 'Zielen'], ['RT', 'Schießen'], ['X', 'Schlagen · Treten'], ['X halten', 'Schwerer Angriff'], ['A halten', 'Blocken (Gegner in der Nähe)'], ['A tippen', 'Ausweichen · Kontern, wenn der Gegner ausholt']] },
  { title: 'Fahrzeug', rows: [['Linker Stick', 'Lenken'], ['RT', 'Gas'], ['LT', 'Bremsen · Rückwärts'], ['A', 'Handbremse'], ['LS drücken', 'Hupen'], ['RB', 'Aus dem Fahrzeug schießen'], ['LB', 'Seitenwaffe ziehen (nochmal: wechseln, wegstecken)'], ['Y', 'Aussteigen'], ['Steuerkreuz ← halten', 'Fahrzeugmenü (Radio, Licht, Motor, Sirene)'], ['Steuerkreuz ↑', 'Handy']] },
  { title: 'Flugzeug & Hubschrauber', rows: [['Linker Stick', 'Neigen (vor / zurück, seitlich)'], ['RT / LT', 'Flugzeug: mehr / weniger Gas · Hubschrauber: steigen / sinken'], ['LB / RB', 'Drehen (Seitenruder)'], ['A', 'Flugzeug: am Boden bremsen'], ['Y', 'Aussteigen (am Boden)']] },
  { title: 'Menüs & Karte', rows: [['Steuerkreuz / Stick', 'Auswählen'], ['A', 'Bestätigen · Dialog weiter'], ['B', 'Zurück'], ['LB / RB', 'Reiter wechseln'], ['Karte', 'Stick verschieben · LT/RT Zoom · A Wegpunkt · X entfernen · Y Legende · RS drücken: 2D/3D']] },
];

const RESERVED = new Set(['Escape', 'F5', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu']);

export const primaryCode = (a) => a.codes[0];
export const effectiveCode = (keys, a) => (a.fixed ? primaryCode(a) : keys[a.id] || primaryCode(a));

// Für die Eingabe: gedrückte physische Taste → Standard-Code, den das Spiel kennt. blocked = frei gewordene Standardtasten
export function computeRemap(keys = {}) {
  const remap = new Map(), blocked = new Set();
  for (const a of ACTIONS) {
    const p = keys[a.id];
    if (!p || a.fixed || (a.codes.length === 1 && p === a.codes[0])) continue;
    remap.set(p, a.codes[0]);
    for (const d of a.codes) blocked.add(d);
  }
  return { remap, blocked };
}

// ---------- Tastenbeschriftung ----------
let layout = null;   // tatsächliche Tastaturbelegung (z. B. QWERTZ), sofern der Browser sie liefert
try { navigator.keyboard?.getLayoutMap?.().then((m) => { layout = m; }).catch(() => {}); } catch { /* ignorieren */ }
const NAMES = {
  Space: 'Leertaste', ShiftLeft: 'Shift (links)', ShiftRight: 'Shift (rechts)', ControlLeft: 'Strg (links)', ControlRight: 'Strg (rechts)',
  AltLeft: 'Alt (links)', AltRight: 'Alt Gr', Escape: 'Esc', Tab: 'Tab', Enter: 'Enter', Backspace: 'Rücktaste', CapsLock: 'Feststelltaste',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Insert: 'Einfg', Delete: 'Entf', Home: 'Pos1', End: 'Ende',
  PageUp: 'Bild ↑', PageDown: 'Bild ↓', NumpadAdd: 'Num +', NumpadSubtract: 'Num −', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadEnter: 'Num Enter',
};
export function keyLabel(code) {
  if (NAMES[code]) return NAMES[code];
  if (layout && layout.has(code)) return String(layout.get(code)).toUpperCase();
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return 'Num ' + code.slice(6);
  return code;
}
const defaultLabel = (a) => a.shown || a.codes.map(keyLabel).join(' / ');

// ---------- Oberfläche ----------
let styled = false;
function injectStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const st = document.createElement('style');
  st.textContent = `
.opt{color:#fff;text-align:left}
.opt-tabs{display:flex;gap:6px;margin:0 0 14px;border-bottom:1px solid rgba(255,255,255,.18)}
.opt-tab{padding:9px 20px;font:inherit;font-weight:700;color:#cfc6e6;background:transparent;border:0;border-bottom:3px solid transparent;cursor:pointer}
.opt-tab:hover{color:#fff}
.opt-tab.on{color:#fff;border-bottom-color:#ff7de9}
.opt-panel[hidden]{display:none}
.opt-row{display:flex;align-items:center;gap:14px;margin:12px 0}
.opt-row label{flex:1;font-size:16px}
.opt-row input[type=range]{width:210px}
.opt-val{min-width:44px;text-align:right;opacity:.8;font-variant-numeric:tabular-nums}
.opt-row select{padding:7px 10px;font:inherit;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);border-radius:8px;color-scheme:dark}
.opt-row select option{color:#000}
.opt-hint{margin:0 0 10px;font-size:13px;line-height:1.4;opacity:.8}
.opt-msg{min-height:1.3em;margin:6px 0;font-size:13px;color:#ffd46a}
.opt-top{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:6px}
.opt-top .opt-hint{margin:0;flex:1}
.opt-keys{max-height:min(54vh,470px);overflow:auto;padding-right:6px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.35) transparent}
.opt-keys h4{margin:16px 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#ff9be9}
.opt-keys h4:first-child{margin-top:2px}
.opt-krow{display:grid;grid-template-columns:minmax(0,1fr) 112px 160px 32px;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px}
.opt-khead{font-size:11px;letter-spacing:.1em;text-transform:uppercase;opacity:.6;border-bottom:1px solid rgba(255,255,255,.2)}
.opt-scroll{max-height:min(54vh,470px);overflow:auto;padding-right:6px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.35) transparent}
.opt-scroll h4{margin:16px 0 6px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#ff9be9}
.opt-scroll h4:first-child{margin-top:2px}
.opt-prow{display:grid;grid-template-columns:170px minmax(0,1fr);align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px}
.opt-prow kbd{justify-self:start}
.opt kbd{display:inline-block;min-width:26px;padding:2px 9px;border-radius:6px;background:#fff;color:#111;font:inherit;font-weight:800;font-size:13px;text-align:center}
.opt-krow button{font:inherit;font-size:13px;font-weight:700;padding:6px 10px;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.3);border-radius:8px;cursor:pointer}
.opt-krow button:hover{background:rgba(255,255,255,.2)}
.opt-krow button.cap{background:#ff7de9;color:#1a0b2e;border-color:#ff7de9}
.opt-krow button.changed{border-color:#ff7de9}
.opt-krow button.reset{padding:4px 0;width:28px;border-radius:50%;opacity:.8}
.opt-krow .fixed{opacity:.6;font-size:12px}
.opt-krow .name{overflow:hidden;text-overflow:ellipsis}
.opt-all{margin:0;flex:0 0 auto}
.opt-toggle{font:inherit;font-weight:800;min-width:84px;padding:8px 16px;border-radius:999px;border:1px solid rgba(255,255,255,.3);color:#fff;background:rgba(255,255,255,.1);cursor:pointer}
.opt-toggle.on{background:#22c55e;border-color:#22c55e;color:#04210f}
.opt-all button{font:inherit;font-size:13px;font-weight:700;padding:7px 12px;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.3);border-radius:8px;cursor:pointer}
@media (max-width:640px){.opt-krow{grid-template-columns:minmax(0,1fr) 90px 130px 28px}.opt-prow{grid-template-columns:120px minmax(0,1fr)}}
`;
  document.head.appendChild(st);
}

const QUALITY_LABELS = { low: 'Niedrig', medium: 'Mittel', high: 'Hoch', ultra: 'Ultra' };
let lastTab = 'audio';

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Baut die Optionen mit den Reitern Audio, Grafik und Tastatur in root.
// opts: { settings, onChange(settings) }
export function renderOptions(root, { settings, onChange = () => {} }) {
  injectStyle();
  const s = settings;
  if (!s.keys) s.keys = {};
  root.textContent = '';
  const wrap = el('div', 'opt');
  const tabs = el('div', 'opt-tabs');
  tabs.setAttribute('role', 'tablist');
  const panels = {};
  const tabBtns = {};
  const changed = () => onChange(s);

  // --- Audio ---
  const audio = el('div', 'opt-panel');
  const slider = (label, key) => {
    const row = el('div', 'opt-row');
    const lab = el('label', '', label);
    const inp = el('input');
    inp.type = 'range'; inp.min = '0'; inp.max = '1'; inp.step = '0.05'; inp.value = String(s[key]);
    const val = el('span', 'opt-val', Math.round(s[key] * 100) + ' %');
    inp.addEventListener('input', () => { s[key] = +inp.value; val.textContent = Math.round(s[key] * 100) + ' %'; changed(); });
    row.append(lab, inp, val);
    return row;
  };
  audio.append(slider('Gesamtlautstärke', 'master'), slider('Musik / Radio', 'music'), slider('Effekte', 'sfx'), slider('Lobbymusik', 'lobby'));
  panels.audio = audio;

  // --- Grafik ---
  const gfx = el('div', 'opt-panel');
  {
    const row = el('div', 'opt-row');
    const lab = el('label', '', 'Grafikqualität');
    const sel = el('select');
    for (const k of Object.keys(QUALITY_LABELS)) {
      const o = el('option', '', QUALITY_LABELS[k]);
      o.value = k; if (s.quality === k) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('input', () => { s.quality = sel.value; changed(); });
    row.append(lab, sel);
    gfx.append(row);
  }
  panels.grafik = gfx;

  // --- Speichern ---
  const sav = el('div', 'opt-panel');
  {
    const row = el('div', 'opt-row');
    const lab = el('label', '', 'Auto-Save (automatisch speichern)');
    const tg = el('button', 'opt-toggle');
    tg.type = 'button';
    const paint = () => { tg.textContent = s.autosave !== false ? 'An' : 'Aus'; tg.classList.toggle('on', s.autosave !== false); tg.setAttribute('aria-pressed', String(s.autosave !== false)); };
    tg.addEventListener('click', () => { s.autosave = s.autosave === false; paint(); changed(); });
    paint();
    row.append(lab, tg);
    sav.append(row, el('p', 'opt-hint', 'Ist Auto-Save an, speichert das Spiel nach jeder geschafften Mission automatisch auf dem Server. Der Auto-Save hat einen eigenen Platz und steht in der Liste der Speicherstände ganz oben (die 10 eigenen Speicherstände darunter bleiben unberührt). Von Hand speichern kannst du immer, auch bei ausgeschaltetem Auto-Save.'));
  }
  panels.speichern = sav;

  // --- Tastatur ---
  const kb = el('div', 'opt-panel');
  const top = el('div', 'opt-top');
  top.append(el('p', 'opt-hint', 'Mitte: Standardtaste, rechts: neue Taste. Klicke auf die Taste rechts und drücke die gewünschte neue Taste (Esc bricht ab). Ist sie schon vergeben, tauschen beide Aktionen ihre Tasten.'));
  const msg = el('div', 'opt-msg');
  const list = el('div', 'opt-keys');
  kb.append(top, msg, list);
  const mouseRows = [];   // Maus-Einstellungen: stehen am Ende der Liste
  let capture = null;

  function stopCapture() {
    if (!capture) return;
    window.removeEventListener('keydown', capture.onKey, true);
    window.removeEventListener('mousedown', capture.onAway, true);
    capture = null;
  }

  function setKey(id, code) {
    const a = ACTIONS.find((x) => x.id === id);
    if (code === primaryCode(a)) delete s.keys[id]; else s.keys[id] = code;
  }

  function assign(a, code) {
    const prev = effectiveCode(s.keys, a);
    const other = ACTIONS.find((x) => !x.fixed && x.id !== a.id && effectiveCode(s.keys, x) === code);
    setKey(a.id, code);
    if (other) { setKey(other.id, prev); msg.textContent = `„${keyLabel(code)}“ war bei „${other.label}“ belegt – beide Tasten wurden getauscht.`; } else msg.textContent = '';
    changed();
    drawKeys();
  }

  function startCapture(a, btn) {
    stopCapture();
    msg.textContent = '';
    btn.textContent = 'Taste drücken …'; btn.classList.add('cap');
    const onKey = (e) => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.code === 'Escape') { stopCapture(); drawKeys(); return; }
      if (RESERVED.has(e.code)) { msg.textContent = 'Diese Taste ist reserviert und kann nicht belegt werden.'; return; }
      stopCapture();
      assign(a, e.code);
    };
    const onAway = (e) => { if (e.target !== btn) { stopCapture(); drawKeys(); } };
    capture = { onKey, onAway };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onAway, true);
  }

  function drawKeys() {
    list.textContent = '';
    const head = el('div', 'opt-krow opt-khead');
    head.append(el('span', '', 'Aktion'), el('span', '', 'Standard'), el('span', '', 'Neue Taste'), el('span', ''));
    list.append(head);
    for (const g of ACTION_GROUPS) {
      list.append(el('h4', '', g.label));
      for (const a of ACTIONS.filter((x) => x.group === g.id)) {
        const row = el('div', 'opt-krow');
        const name = el('span', 'name', a.label);
        name.title = a.label;
        const std = el('span');
        const k = el('kbd', '', defaultLabel(a));
        std.append(k);
        const cur = el('span');
        const rst = el('span');
        if (a.fixed) {
          cur.append(el('span', 'fixed', 'fest'));
        } else {
          const code = effectiveCode(s.keys, a);
          const isChanged = code !== primaryCode(a);
          const btn = el('button', isChanged ? 'changed' : '', keyLabel(code));
          btn.type = 'button';
          btn.addEventListener('click', () => startCapture(a, btn));
          cur.append(btn);
          if (isChanged) {
            const r = el('button', 'reset', '↺');
            r.type = 'button'; r.title = 'Standardtaste wiederherstellen';
            r.addEventListener('click', () => { setKey(a.id, primaryCode(a)); msg.textContent = ''; changed(); drawKeys(); });
            rst.append(r);
          }
        }
        row.append(name, std, cur, rst);
        list.append(row);
      }
    }
    list.append(el('h4', '', 'Maus und weitere feste Bedienung'));
    for (const [key, text] of FIXED_INFO) {
      const row = el('div', 'opt-krow');
      const std = el('span'); std.append(el('kbd', '', key));
      row.append(el('span', 'name', text), std, el('span', 'fixed', 'fest'), el('span'));
      // Die Taste steht bei den festen Einträgen links vom Text: Reihenfolge wie bei den anderen Zeilen (Aktion, Taste)
      list.append(row);
    }
    for (const r of mouseRows) list.append(r);
  }
  drawKeys();

  const all = el('div', 'opt-all');
  const allBtn = el('button', '', 'Alle Tasten auf Standard');
  allBtn.type = 'button';
  allBtn.addEventListener('click', () => { s.keys = {}; msg.textContent = 'Alle Tasten sind wieder auf Standard.'; changed(); drawKeys(); });
  all.append(allBtn);
  top.append(all);

  // Maus (gehört zur Steuerung)
  {
    const row = el('div', 'opt-row');
    const lab = el('label', '', 'Maus-Empfindlichkeit');
    const inp = el('input'); inp.type = 'range'; inp.min = '0.2'; inp.max = '2.5'; inp.step = '0.05'; inp.value = String(s.sens);
    const val = el('span', 'opt-val', s.sens.toFixed(2));
    inp.addEventListener('input', () => { s.sens = +inp.value; val.textContent = s.sens.toFixed(2); changed(); });
    row.append(lab, inp, val);
    const row2 = el('div', 'opt-row');
    const lab2 = el('label', '', 'Y-Achse umkehren');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!s.invertY;
    cb.addEventListener('input', () => { s.invertY = cb.checked; changed(); });
    row2.append(lab2, cb);
    mouseRows.push(row, row2);
  }
  drawKeys();
  panels.tastatur = kb;

  // --- Controller (Übersicht der Xbox-Belegung) ---
  const ctr = el('div', 'opt-panel');
  {
    const scroll = el('div', 'opt-scroll');
    for (const sec of CONTROLLER_LAYOUT) {
      scroll.append(el('h4', '', sec.title));
      for (const [key, text] of sec.rows) {
        const row = el('div', 'opt-prow');
        row.append(el('kbd', '', key), el('span', '', text));
        scroll.append(row);
      }
    }
    ctr.append(el('p', 'opt-hint', 'Xbox-Controller anschließen (Kabel oder Bluetooth) und im Spiel eine Taste drücken – er wird automatisch erkannt. „Y-Achse umkehren“ (Reiter Tastatur) gilt auch für den rechten Stick.'), scroll);
  }
  panels.controller = ctr;

  // --- Reiter ---
  const TABS = [['audio', 'Audio'], ['grafik', 'Grafik'], ['tastatur', 'Tastatur'], ['controller', 'Controller'], ['speichern', 'Speichern']];
  function select(id) {
    lastTab = id;
    stopCapture();
    for (const [k] of TABS) { panels[k].hidden = k !== id; tabBtns[k].classList.toggle('on', k === id); }
    if (id === 'tastatur') drawKeys();
  }
  for (const [k, label] of TABS) {
    const b = el('button', 'opt-tab', label);
    b.type = 'button'; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => select(k));
    tabBtns[k] = b; tabs.append(b);
  }
  wrap.append(tabs, audio, gfx, kb, ctr, sav);
  root.append(wrap);
  select(lastTab);
  // Beschriftung der Tasten nachziehen, sobald das Tastaturlayout des Browsers bekannt ist
  setTimeout(() => { if (!kb.hidden) drawKeys(); }, 300);
  return { dispose: stopCapture };
}
