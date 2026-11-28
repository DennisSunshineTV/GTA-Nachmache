// Lobbymusik für den Startbildschirm: „Neon Highway“ – ein selbst komponierter Synthwave-Fahrtsong (a-Moll, 104 BPM).
// Alles wird live im Browser erzeugt (Web Audio), es gibt keine Audiodateien und damit keine Urheberrechte Dritter.
// Autothema: Motorbrummen im Hintergrund, Gasstoß vor jeder Wiederholung und ein Auto, das vorbeifährt.

const BPM = 104;
const STEP = 60 / BPM / 4;            // Sechzehntel in Sekunden
const BAR = 16;                       // Schritte pro Takt
const LOOP_BARS = 8;
const LOOKAHEAD = 1.0;                // so weit im Voraus werden Noten eingeplant (Sekunden)

const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Akkorde und Bass je Takt: Am – F – C – G – Am – F – Dm – E
const BARS = [
  { root: 33, chord: [57, 60, 64] },
  { root: 29, chord: [53, 57, 60] },
  { root: 36, chord: [55, 60, 64] },
  { root: 31, chord: [55, 59, 62] },
  { root: 33, chord: [57, 60, 64] },
  { root: 29, chord: [53, 57, 60] },
  { root: 38, chord: [53, 57, 62] },
  { root: 40, chord: [56, 59, 64] },
];
// Melodie ab Takt 3: [Schritt, MIDI-Note, Länge in Schritten]
const LEAD = {
  2: [[0, 76, 4], [6, 79, 2], [8, 76, 4], [14, 74, 2]],
  3: [[0, 74, 4], [6, 71, 2], [8, 74, 6]],
  4: [[0, 72, 4], [6, 76, 2], [8, 81, 6], [14, 79, 2]],
  5: [[0, 77, 4], [6, 76, 2], [8, 72, 4], [12, 76, 4]],
  6: [[0, 74, 6], [8, 77, 4], [12, 81, 4]],
  7: [[0, 80, 4], [4, 76, 4], [8, 71, 8]],
};
const ARP = [0, 1, 2, 3, 2, 1];

export class LobbyMusic {
  constructor(ctx) {
    this.ctx = ctx;
    this.running = false;
    this.timer = null;
    this.step = 0;
    this.nextTime = 0;
    this.volume = 0.4;
    const c = ctx;

    // Ausgang: Lautstärke → Kompressor
    this.master = c.createGain();
    this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);

    // Gruppe mit "Pumpen" (Bass, Pad, Arpeggio werden beim Bassdrum-Schlag leiser)
    this.duck = c.createGain();
    this.duck.connect(this.master);
    // Echo für Arpeggio und Melodie
    this.delay = c.createDelay(1.5);
    this.delay.delayTime.value = (60 / BPM) * 0.75;
    const fb = c.createGain(); fb.gain.value = 0.34;
    const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2400;
    this.delay.connect(dlp); dlp.connect(fb); fb.connect(this.delay);
    const dOut = c.createGain(); dOut.gain.value = 0.5;
    dlp.connect(dOut); dOut.connect(this.master);
    // Rauschen
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.engine = null;
  }

  // Lautstärke 0..1 (wirkt sofort)
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.running) this.master.gain.setTargetAtTime(this.volume * 0.55, this.ctx.currentTime, 0.1);
  }

  start() {
    const c = this.ctx;
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (this.running) return;
    this.running = true;
    this.step = 0;
    this.nextTime = c.currentTime + 0.12;
    this.master.gain.cancelScheduledValues(c.currentTime);
    this.master.gain.setValueAtTime(0, c.currentTime);
    this.master.gain.linearRampToValueAtTime(this.volume * 0.55, c.currentTime + 2.5);
    this._startEngine();
    this.timer = setInterval(() => this._tick(), 120);
    this._tick();
  }

  // Ausblenden und anhalten (z. B. beim Spielstart)
  stop(fade = 1.2) {
    if (!this.running) return;
    const c = this.ctx;
    this.running = false;
    clearInterval(this.timer); this.timer = null;
    this.master.gain.cancelScheduledValues(c.currentTime);
    this.master.gain.setValueAtTime(this.master.gain.value, c.currentTime);
    this.master.gain.linearRampToValueAtTime(0, c.currentTime + fade);
    setTimeout(() => {
      try { this._stopEngine(); if (!this.running) c.suspend(); } catch { /* ignorieren */ }
    }, fade * 1000 + 100);
  }

  _tick() {
    const c = this.ctx;
    while (this.nextTime < c.currentTime + LOOKAHEAD) {
      this.scheduleStep(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % (LOOP_BARS * BAR);
    }
  }

  // ---------- Klangbausteine ----------
  _osc(type, freq, t, dur, vol, o = {}) {
    const c = this.ctx;
    const osc = c.createOscillator();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (o.detune) osc.detune.value = o.detune;
    if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t + (o.slideT || dur));
    let node = osc;
    if (o.cutoff) {
      const f = c.createBiquadFilter(); f.type = o.ftype || 'lowpass'; f.frequency.value = o.cutoff; f.Q.value = o.q || 0.7;
      if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur);
      node.connect(f); node = f;
    }
    const g = c.createGain();
    const a = o.attack ?? 0.005, r = o.release ?? 0.06;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, Math.max(t + a, t + dur - r));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    g.connect(o.dest || this.duck);
    if (o.send) { const s = c.createGain(); s.gain.value = o.send; g.connect(s); s.connect(this.delay); }
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  _noise(t, dur, vol, o = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = o.type || 'highpass'; f.frequency.setValueAtTime(o.freq || 6000, t); f.Q.value = o.q || 0.7;
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + (o.sweepT || dur));
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g);
    let out = g;
    if (o.pan) {
      const p = c.createStereoPanner();
      p.pan.setValueAtTime(o.pan[0], t); p.pan.linearRampToValueAtTime(o.pan[1], t + dur);
      g.connect(p); out = p;
    }
    out.connect(o.dest || this.master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  _kick(t) {
    const c = this.ctx;
    this._osc('sine', 150, t, 0.4, 0.62, { slideTo: 44, slideT: 0.13, attack: 0.002, release: 0.3, dest: this.master });
    this._noise(t, 0.02, 0.14, { type: 'highpass', freq: 2500 });
    // Bassdrum drückt Bass, Pad und Arpeggio kurz weg
    const g = this.duck.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.35, t);
    g.linearRampToValueAtTime(1, t + 0.24);
    void c;
  }

  _snare(t) {
    this._noise(t, 0.2, 0.3, { type: 'bandpass', freq: 1900, q: 0.8 });
    this._noise(t, 0.12, 0.16, { type: 'highpass', freq: 4000 });
    this._osc('triangle', 200, t, 0.12, 0.16, { slideTo: 140, attack: 0.002, release: 0.1, dest: this.master });
  }

  _hat(t, open) {
    this._noise(t, open ? 0.2 : 0.045, open ? 0.2 : 0.16, { type: 'highpass', freq: 7000, q: 0.5 });
  }

  // Dauerndes Motorbrummen (Leerlauf) mit leicht schwankender Drehzahl
  _startEngine() {
    if (this.engine) return;
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.value = 0.035;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 150; lp.Q.value = 1.2;
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 41;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 82.5;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.22;
    const lfoG = c.createGain(); lfoG.gain.value = 5;
    lfo.connect(lfoG); lfoG.connect(o1.frequency); lfoG.connect(o2.frequency);
    const g2 = c.createGain(); g2.gain.value = 0.35;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(this.master);
    for (const o of [o1, o2, lfo]) o.start(t);
    this.engine = { nodes: [o1, o2, lfo] };
  }

  _stopEngine() {
    if (!this.engine) return;
    for (const o of this.engine.nodes) { try { o.stop(); } catch { /* ignorieren */ } }
    this.engine = null;
  }

  // Gasstoß: Motor dreht kurz hoch
  _rev(t) {
    this._osc('sawtooth', 58, t, 1.6, 0.1, { slideTo: 190, slideT: 1.1, cutoff: 520, ftype: 'lowpass', q: 1.5, attack: 0.15, release: 0.5, dest: this.master });
    this._osc('square', 116, t, 1.6, 0.05, { slideTo: 380, slideT: 1.1, cutoff: 700, ftype: 'lowpass', attack: 0.15, release: 0.5, dest: this.master });
  }

  // Vorbeifahrt: Rauschen und Motorton ziehen von links nach rechts, die Tonhöhe fällt (Doppler)
  _passBy(t) {
    this._noise(t, 3.2, 0.1, { type: 'bandpass', freq: 500, sweepTo: 220, sweepT: 3.2, q: 1.1, pan: [-0.9, 0.9] });
    this._noise(t + 0.2, 2.6, 0.05, { type: 'bandpass', freq: 1700, sweepTo: 600, sweepT: 2.6, q: 2, pan: [-0.9, 0.9] });
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(120, t + 3);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 1.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    const p = c.createStereoPanner(); p.pan.setValueAtTime(-0.9, t); p.pan.linearRampToValueAtTime(0.9, t + 3);
    o.connect(lp); lp.connect(g); g.connect(p); p.connect(this.master);
    o.start(t); o.stop(t + 3.4);
  }

  // Plant einen Sechzehntel-Schritt (0 … 127) zum Zeitpunkt t ein
  scheduleStep(index, t) {
    const bar = Math.floor(index / BAR) % LOOP_BARS, s = index % BAR;
    const { root, chord } = BARS[bar];
    // Schlagzeug: Vierviertel-Bassdrum, Snare auf 2 und 4, Hi-Hats
    if (s % 4 === 0) this._kick(t);
    if (s === 4 || s === 12) this._snare(t);
    if (s % 2 === 0) this._hat(t, s === 6 || s === 14);
    else if (bar >= 2) this._hat(t, false);
    // Bass: Achtel, Oktavsprung auf der "und"
    if (s % 2 === 0) {
      const n = (s === 6 || s === 14) ? root + 12 : root;
      this._osc('sawtooth', mtof(n), t, STEP * 1.8, 0.1, { cutoff: 620, sweepTo: 340, q: 2.5, attack: 0.004, release: 0.05 });
    }
    // Pad: Akkord zu Taktbeginn
    if (s === 0) {
      for (const n of chord) {
        this._osc('sawtooth', mtof(n), t, STEP * BAR, 0.05, { cutoff: 1500, attack: 0.5, release: 0.6, detune: -7 });
        this._osc('sawtooth', mtof(n), t, STEP * BAR, 0.05, { cutoff: 1500, attack: 0.5, release: 0.6, detune: 7 });
      }
    }
    // Arpeggio in Sechzehnteln (ab Takt 2 lauter)
    {
      const tones = [chord[0], chord[1], chord[2], chord[0] + 12];
      const n = tones[ARP[s % ARP.length]] + 12;
      this._osc('square', mtof(n), t, STEP * 0.85, bar >= 1 ? 0.075 : 0.05, { cutoff: 4200, sweepTo: 1400, q: 1, attack: 0.003, release: 0.04, send: 0.45 });
    }
    // Melodie
    const lead = LEAD[bar];
    if (lead) {
      for (const [st, note, len] of lead) {
        if (st === s) {
          this._osc('sawtooth', mtof(note), t, STEP * len, 0.1, { cutoff: 4200, q: 0.9, attack: 0.012, release: 0.12, send: 0.5 });
          this._osc('triangle', mtof(note), t, STEP * len, 0.07, { attack: 0.012, release: 0.12, send: 0.3 });
        }
      }
    }
    // Autos: Gasstoß vor jeder Wiederholung, Vorbeifahrt in der Mitte
    if (bar === 7 && s === 8) this._rev(t);
    if (bar === 4 && s === 0) this._passBy(t);
  }
}

export function createLobbyMusic() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  return new LobbyMusic(new AC());
}

export const LOBBY_TITLE = 'Neon Highway';
