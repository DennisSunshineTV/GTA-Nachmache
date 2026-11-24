// Eingabe: Tastatur, Maus (Pointer-Lock) und optional Gamepad.
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

    this._kd = (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code.startsWith('F') && e.code.length <= 3 && e.code !== 'F') e.preventDefault();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
    };
    this._ku = (e) => { this.down.delete(e.code); this.released.add(e.code); };
    this._md = (e) => {
      if (!this.enabled) return;
      if (!this.locked && e.target === canvas) this.lock();
      this.mouse.buttons |= 1 << e.button;
      this.mouse.pressed |= 1 << e.button;
    };
    this._mu = (e) => { this.mouse.buttons &= ~(1 << e.button); };
    this._mm = (e) => {
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

  lock() {
    try { const p = this.canvas.requestPointerLock?.(); if (p && p.catch) p.catch(() => {}); } catch { /* ignorieren */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  key(code) { return this.down.has(code); }
  hit(code) { return this.pressed.has(code); }
  mouseDown(b) { return (this.mouse.buttons & (1 << b)) !== 0; }
  mouseHit(b) { return (this.mouse.pressed & (1 << b)) !== 0; }

  // Gamepad pro Frame abfragen
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    const p = this.pad;
    p.btnPressed.clear();
    if (!gp) { p.active = false; p.lx = p.ly = p.rx = p.ry = p.lt = p.rt = 0; this._padPrev.clear(); return; }
    const dz = (v) => (Math.abs(v) < 0.16 ? 0 : v);
    p.active = true;
    p.lx = dz(gp.axes[0]); p.ly = dz(gp.axes[1]); p.rx = dz(gp.axes[2]); p.ry = dz(gp.axes[3]);
    p.lt = gp.buttons[6]?.value || 0; p.rt = gp.buttons[7]?.value || 0;
    const cur = new Set();
    gp.buttons.forEach((b, i) => { if (b.pressed) cur.add(i); });
    for (const i of cur) if (!this._padPrev.has(i)) p.btnPressed.add(i);
    this._padPrev = cur; p.btn = cur;
  }

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
