// Eingabe: Tastatur, Maus (Pointer-Lock) und optional Gamepad (Xbox-Controller).

// Tastennummern der Browser-Standardbelegung ("standard mapping") mit Xbox-Namen
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEADZONE = 0.16;

// Runde Totzone: kleine Ausschläge ignorieren, den Rest wieder auf 0..1 strecken
function stick(x = 0, y = 0) {
  const m = Math.hypot(x, y);
  if (m < DEADZONE) return [0, 0];
  const k = Math.min(1, (m - DEADZONE) / (1 - DEADZONE)) / m;
  return [x * k, y * k];
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();   // in diesem Frame gedrückt
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: 0, wheel: 0, pressed: 0 };
    this.locked = false;
    this.enabled = true;
    this.sens = 1;
    this.invertY = false;
    this.pad = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, active: false, btn: new Set(), btnPressed: new Set() };
    this._padPrev = new Set();
    this._swallowed = new Set();   // Controller-Tasten, die bis zum Loslassen nicht mehr zählen
    this.device = 'kb';            // zuletzt benutzt: 'kb' (Tastatur/Maus) oder 'pad' – bestimmt die angezeigten Tasten
    // Eigene Tastenbelegung: physische Taste → Standard-Code (remap); freigewordene Standardtasten sind gesperrt (blocked)
    this.remap = new Map();
    this.blocked = new Set();
    this._map = (code) => {
      const m = this.remap.get(code);
      if (m !== undefined) return m;
      return this.blocked.has(code) ? null : code;
    };

    this._kd = (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code.startsWith('F') && e.code.length <= 3 && e.code !== 'F') e.preventDefault();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      const code = this._map(e.code);
      if (code === null) return;
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
      this.device = 'kb';
    };
    this._ku = (e) => { const code = this._map(e.code); if (code === null) return; this.down.delete(code); this.released.add(code); };
    this._md = (e) => {
      if (!this.enabled) return;
      this.device = 'kb';
      if (!this.locked && e.target === canvas) this.lock();
      this.mouse.buttons |= 1 << e.button;
      this.mouse.pressed |= 1 << e.button;
    };
    this._mu = (e) => { this.mouse.buttons &= ~(1 << e.button); };
    this._mm = (e) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) this.device = 'kb';
      if (!this.locked) return;
      this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
    };
    this._wh = (e) => { if (this.enabled) this.mouse.wheel += Math.sign(e.deltaY); e.preventDefault(); };
    this._pl = () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked) this.onUnlock?.();
    };
    this._blur = () => { this.down.clear(); this.mouse.buttons = 0; };
    this._ctx = (e) => e.preventDefault();
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    canvas.addEventListener('mousedown', this._md);
    window.addEventListener('mouseup', this._mu);
    window.addEventListener('mousemove', this._mm);
    canvas.addEventListener('wheel', this._wh, { passive: false });
    canvas.addEventListener('contextmenu', this._ctx);
    document.addEventListener('pointerlockchange', this._pl);
    window.addEventListener('blur', this._blur);
  }

  // Mit Controller wird die Maus nicht gefangen (ein später verlorener Mausfang würde ungefragt pausieren)
  lock() {
    if (this.device === 'pad') return;
    try { const p = this.canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch { /* ignorieren */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  setRemap(remap, blocked) { this.remap = remap; this.blocked = blocked; this.down.clear(); this.pressed.clear(); }

  key(code) { return this.down.has(code); }
  hit(code) { return this.pressed.has(code); }
  mouseDown(b) { return (this.mouse.buttons & (1 << b)) !== 0; }
  mouseHit(b) { return (this.mouse.pressed & (1 << b)) !== 0; }

  // Gamepad pro Frame abfragen
  pollPad() {
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((q) => q && q.connected) : [];
    const gp = pads.find((q) => q.mapping === 'standard') || pads[0];
    const p = this.pad;
    p.btnPressed.clear();
    if (!gp) {
      p.active = false; p.lx = p.ly = p.rx = p.ry = p.lt = p.rt = 0;
      p.btn.clear(); this._padPrev.clear(); this._swallowed.clear(); this.device = 'kb';
      return;
    }
    p.active = true;
    [p.lx, p.ly] = stick(gp.axes[0], gp.axes[1]); [p.rx, p.ry] = stick(gp.axes[2], gp.axes[3]);
    // Trigger zählen ab 40 % als gedrückt und erst unter 25 % wieder als losgelassen (kein Flattern)
    const cur = new Set();
    gp.buttons.forEach((b, i) => {
      const down = i === PAD.LT || i === PAD.RT ? b.value > (this._padPrev.has(i) ? 0.25 : 0.4) : b.pressed;
      if (down) cur.add(i);
    });
    for (const i of this._swallowed) if (!cur.has(i)) this._swallowed.delete(i);
    for (const i of cur) if (!this._padPrev.has(i)) p.btnPressed.add(i);
    this._padPrev = cur;
    p.btn = new Set([...cur].filter((i) => !this._swallowed.has(i)));
    p.lt = this._swallowed.has(PAD.LT) ? 0 : gp.buttons[PAD.LT]?.value || 0;
    p.rt = this._swallowed.has(PAD.RT) ? 0 : gp.buttons[PAD.RT]?.value || 0;
    if (p.btnPressed.size || p.lx || p.ly || p.rx || p.ry) this.device = 'pad';
  }

  padHit(i) { return this.pad.btnPressed.has(i); }     // in diesem Frame gedrückt
  padDown(i) { return this.pad.btn.has(i); }           // wird gehalten

  // Eine Oberfläche hat die Tasten verbraucht: Das Spiel sieht sie nicht, bis sie losgelassen wurden
  consume(...buttons) {
    for (const i of buttons) {
      if (!this._padPrev.has(i)) continue;
      this._swallowed.add(i); this.pad.btn.delete(i); this.pad.btnPressed.delete(i);
      if (i === PAD.LT) this.pad.lt = 0;
      if (i === PAD.RT) this.pad.rt = 0;
    }
  }
  swallow() { this.consume(...this._padPrev); }        // alle gerade gedrückten Tasten verbrauchen

  // Frame-Ende: Einmal-Ereignisse zurücksetzen
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mouse.dx = 0; this.mouse.dy = 0; this.mouse.wheel = 0; this.mouse.pressed = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    this.canvas.removeEventListener('mousedown', this._md);
    window.removeEventListener('mouseup', this._mu);
    window.removeEventListener('mousemove', this._mm);
    this.canvas.removeEventListener('wheel', this._wh);
    this.canvas.removeEventListener('contextmenu', this._ctx);
    document.removeEventListener('pointerlockchange', this._pl);
    window.removeEventListener('blur', this._blur);
  }
}
