// Radio: komplett synthetische, urheberrechtsfreie Musik (live aus Code erzeugt). Sechs Sender.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], pentMin: [0, 3, 5, 7, 10], pentMaj: [0, 2, 4, 7, 9], dorian: [0, 2, 3, 5, 7, 9, 10],
};

export class Synth {
  constructor(ctx, out) {
    this.ctx = ctx; this.out = out;
    // Rauschpuffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Verzerrungskurve (Rock-Gitarre)
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 6); }
    this.dist = ctx.createWaveShaper(); this.dist.curve = curve; this.dist.oversample = '2x';
    this.distOut = ctx.createGain(); this.distOut.gain.value = 0.5;
    this.dist.connect(this.distOut); this.distOut.connect(out);
  }

  _env(g, t, a, d, s, r, dur, peak) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * s), t + a + d);
    g.gain.setValueAtTime(Math.max(0.0001, peak * s), t + Math.max(a + d, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a + d, dur) + r);
  }

  osc(type, freq, t, dur, peak, { a = 0.005, d = 0.1, s = 0.5, r = 0.1, cutoff = 0, q = 1, detune = 0, dest = this.out, slide = 0 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = c.createGain();
    this._env(g, t, a, d, s, r, dur, peak);
    let node = o;
    if (cutoff) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = q; o.connect(f); node = f; }
    node.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + a + d + r + 0.05);
    return { o, g };
  }

  noise(t, dur, peak, { type = 'lowpass', freq = 3000, q = 0.7, a = 0.002, dest = this.out, sweep = 0 } = {}) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  kick(t, v = 1, dest = this.out, deep = 1) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(160 * deep, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.45);
    this.noise(t, 0.03, 0.18 * v, { type: 'highpass', freq: 2500, dest });
  }
  snare(t, v = 1, dest = this.out, tone = 190) {
    this.noise(t, 0.2, 0.5 * v, { type: 'bandpass', freq: 2300, q: 0.8, dest });
    this.osc('triangle', tone, t, 0.08, 0.3 * v, { a: 0.001, d: 0.08, s: 0.01, r: 0.02, dest });
  }
  clap(t, v = 1, dest = this.out) { for (let i = 0; i < 3; i++) this.noise(t + i * 0.011, 0.09, 0.34 * v, { type: 'bandpass', freq: 1500 + i * 150, q: 1.2, dest }); this.noise(t + 0.033, 0.18, 0.22 * v, { type: 'bandpass', freq: 1400, q: 1, dest }); }
  hat(t, v = 1, open = false, dest = this.out) { this.noise(t, open ? 0.22 : 0.045, 0.2 * v, { type: 'highpass', freq: open ? 6500 : 8000, q: 0.6, dest }); }
  tom(t, f, v = 1, dest = this.out) { this.osc('sine', f, t, 0.2, 0.5 * v, { a: 0.001, d: 0.18, s: 0.01, r: 0.05, slide: 0.6, dest }); }
  rim(t, v = 1, dest = this.out) { this.osc('square', 820, t, 0.03, 0.18 * v, { a: 0.001, d: 0.03, s: 0.05, r: 0.01, cutoff: 3000, dest }); }
  cowbell(t, v = 1, dest = this.out) { this.osc('square', 560, t, 0.1, 0.12 * v, { a: 0.001, d: 0.1, s: 0.1, r: 0.05, cutoff: 2600, dest }); this.osc('square', 840, t, 0.1, 0.1 * v, { a: 0.001, d: 0.1, s: 0.1, r: 0.05, cutoff: 2600, dest }); }
  bass808(t, m, dur, v = 1, dest = this.out) { this.osc('sine', mtof(m), t, dur, 0.9 * v, { a: 0.004, d: dur, s: 0.4, r: 0.06, dest }); this.osc('triangle', mtof(m + 12), t, dur * 0.6, 0.12 * v, { a: 0.004, d: 0.2, s: 0.1, r: 0.05, dest }); }
  bassSaw(t, m, dur, v = 1, cutoff = 700, dest = this.out) { this.osc('sawtooth', mtof(m), t, dur, 0.45 * v, { a: 0.004, d: 0.12, s: 0.45, r: 0.05, cutoff, q: 4, dest }); this.osc('sine', mtof(m - 12), t, dur, 0.5 * v, { a: 0.004, d: 0.15, s: 0.8, r: 0.05, dest }); }
  pluck(t, m, v = 1, dest = this.out) { this.osc('triangle', mtof(m), t, 0.3, 0.3 * v, { a: 0.002, d: 0.3, s: 0.01, r: 0.1, dest }); this.osc('sine', mtof(m + 12), t, 0.2, 0.1 * v, { a: 0.002, d: 0.2, s: 0.01, r: 0.05, dest }); }
  keys(t, ms, dur, v = 1, dest = this.out) { for (const m of ms) { this.osc('sine', mtof(m), t, dur, 0.13 * v, { a: 0.01, d: 0.3, s: 0.35, r: 0.25, dest }); this.osc('triangle', mtof(m + 12.05), t, dur * 0.5, 0.05 * v, { a: 0.005, d: 0.2, s: 0.1, r: 0.1, dest }); } }
  pad(t, ms, dur, v = 1, dest = this.out, cutoff = 1400) { for (const m of ms) for (const dt of [-7, 7]) this.osc('sawtooth', mtof(m), t, dur, 0.04 * v, { a: 0.5, d: 0.4, s: 0.8, r: 0.8, cutoff, q: 0.8, detune: dt, dest }); }
  stab(t, ms, dur, v = 1, dest = this.out, cutoff = 2400) { for (const m of ms) { this.osc('sawtooth', mtof(m), t, dur, 0.085 * v, { a: 0.003, d: 0.12, s: 0.25, r: 0.08, cutoff, q: 2, dest }); } }
  lead(t, m, dur, v = 1, type = 'sawtooth', cutoff = 3200, dest = this.out) { const r = this.osc(type, mtof(m), t, dur, 0.1 * v, { a: 0.01, d: 0.1, s: 0.7, r: 0.1, cutoff, q: 3, dest }); const l = this.ctx.createOscillator(), lg = this.ctx.createGain(); l.frequency.value = 5.5; lg.gain.value = 6; l.connect(lg); lg.connect(r.o.detune); l.start(t); l.stop(t + dur + 0.4); }
  flute(t, m, dur, v = 1, dest = this.out) { const r = this.osc('sine', mtof(m), t, dur, 0.15 * v, { a: 0.06, d: 0.1, s: 0.8, r: 0.2, dest }); const l = this.ctx.createOscillator(), lg = this.ctx.createGain(); l.frequency.value = 5; lg.gain.value = 8; l.connect(lg); lg.connect(r.o.detune); l.start(t); l.stop(t + dur + 0.5); this.noise(t, dur, 0.02 * v, { type: 'bandpass', freq: mtof(m) * 2, q: 4, dest }); }
  guitar(t, ms, dur, v = 1, mute = false) { for (const m of ms) this.osc('sawtooth', mtof(m), t, dur, 0.1 * v, { a: 0.002, d: mute ? 0.08 : 0.5, s: mute ? 0.05 : 0.6, r: 0.06, cutoff: 2600, q: 1, dest: this.dist }); }
  pick(t, m, dur, v = 1) { this.osc('sawtooth', mtof(m), t, dur, 0.12 * v, { a: 0.004, d: 0.2, s: 0.5, r: 0.1, cutoff: 3600, q: 2, dest: this.dist }); }
  shaker(t, v = 1, dest = this.out) { this.noise(t, 0.06, 0.11 * v, { type: 'bandpass', freq: 6000, q: 1.5, dest }); }
}

// Akkord aus Skalenstufe
function chordFrom(root, scale, deg, type = 'triad') {
  const s = SCALES[scale];
  const at = (k) => root + s[((deg + k) % s.length + s.length) % s.length] + 12 * Math.floor((deg + k) / s.length);
  const ch = [at(0), at(2), at(4)];
  if (type === '7') ch.push(at(6));
  return ch;
}

// ---------- Sender ----------
function mkHipHop(S, bus, duck) {
  const st = { bpm: pick([84, 88, 92, 96]), root: pick([45, 46, 48, 50]), scale: 'minor', prog: pick([[0, 5, 2, 6], [0, 3, 5, 4], [0, 2, 5, 6], [0, 6, 5, 4]]), kickP: pick([[0, 7, 10], [0, 6, 10, 14], [0, 3, 10], [0, 8, 11]]), seed: Math.random(), swing: 0.04 };
  const mel = [0, 2, 4, 1, 3, 2, 0, 4].map(() => pick(SCALES.pentMin));
  return {
    bpm: st.bpm,
    step(i, t, bar) {
      const sp = 60 / st.bpm / 4;
      const sw = (i % 2) ? st.swing * sp * 4 : 0;
      t += sw;
      const b = bar % 4, deg = st.prog[b];
      const ch = chordFrom(st.root + 24, st.scale, deg, '7');
      if (st.kickP.includes(i)) S.kick(t, 1, bus, 0.9);
      if (i === 4 || i === 12) { S.snare(t, 0.9, bus); if (i === 12 && b === 3 && Math.random() < 0.5) S.clap(t + sp * 0.5, 0.5, bus); }
      if (i % 2 === 0) S.hat(t, i % 4 === 0 ? 0.8 : 0.5, false, bus); else if (Math.random() < 0.55) S.hat(t, 0.3, false, bus);
      if (i === 14 && Math.random() < 0.4) S.hat(t, 0.6, true, bus);
      // 808
      const bm = st.root + [0, 3, 5, 7, 10, 8, 2, 6][deg % 7 === 0 ? 0 : deg % 7] - 12 + 12;
      const root = st.root - 12 + SCALES.minor[deg % 7];
      if (i === 0) S.bass808(t, root, sp * 6, 1, bus);
      if (i === 10 && Math.random() < 0.7) S.bass808(t, root + (Math.random() < 0.3 ? 7 : 0), sp * 4, 0.9, bus);
      if (i === 14 && Math.random() < 0.3) S.bass808(t, root + 12, sp * 2, 0.7, bus);
      // Keys
      if (i === 0) S.keys(t, ch, sp * 8, 0.9, bus);
      if (i === 8) S.keys(t + sp * 0.02, ch.map((m) => m + (Math.random() < 0.3 ? 12 : 0)), sp * 6, 0.8, bus);
      // Melodie
      if (i % 4 === 2 && Math.random() < 0.5 && bar % 8 >= 2) S.pluck(t, st.root + 36 + pick(SCALES.pentMin) + (Math.random() < 0.3 ? 12 : 0), 0.9, bus);
      if (i === 0 && b === 0) S.pad(t, ch.map((m) => m - 12), sp * 16, 0.6, bus, 900);
      void mel;
    },
  };
}

function mkPop(S, bus, duck) {
  const st = { bpm: pick([108, 112, 116, 120]), root: pick([48, 50, 52, 53]), scale: 'major', prog: pick([[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4]]), seed: Math.random() };
  const hook = Array.from({ length: 8 }, () => pick([0, 2, 4, 5, 7, 9]));
  return {
    bpm: st.bpm,
    step(i, t, bar) {
      const sp = 60 / st.bpm / 4;
      const b = bar % 4, deg = st.prog[b];
      const ch = chordFrom(st.root + 12, st.scale, deg);
      const root = st.root - 12 + SCALES.major[deg % 7];
      if (i % 4 === 0) { S.kick(t, 0.85, bus); duck(t); }
      if (i === 4 || i === 12) S.clap(t, 0.8, bus);
      if (i % 4 === 2) S.hat(t, 0.55, true, bus); else if (i % 2 === 0) S.hat(t, 0.3, false, bus);
      if (i % 2 === 0) S.bassSaw(t, root, sp * 1.7, 0.8, 600 + (i === 0 ? 300 : 0), bus);
      if (i === 0 || i === 6 || i === 10) S.stab(t, ch, sp * 2.6, 0.9, bus);
      if (i === 0) S.pad(t, ch, sp * 16, 0.7, bus, 1800);
      // Hook
      if (bar % 8 >= 4 && (i === 0 || i === 3 || i === 6 || i === 8 || i === 12)) S.lead(t, st.root + 36 + hook[(i + b * 2) % 8], sp * 2.4, 0.8, 'sawtooth', 3600, bus);
    },
  };
}

function mkRock(S, bus, duck) {
  const st = { bpm: pick([120, 128, 134, 140]), root: pick([40, 41, 43, 45]), prog: pick([[0, 5, 3, 4], [0, 3, 4, 3], [0, 6, 5, 6]]), scale: 'minor' };
  return {
    bpm: st.bpm,
    step(i, t, bar) {
      const sp = 60 / st.bpm / 4;
      const b = bar % 4, deg = st.prog[b];
      const r = st.root + SCALES.minor[deg % 7];
      const power = [r + 12, r + 19, r + 24];
      if (i === 0 || i === 6 || i === 10 || (i === 14 && b === 3)) S.kick(t, 1, bus, 1.1);
      if (i === 4 || i === 12) S.snare(t, 1, bus, 210);
      if (i % 2 === 0) S.hat(t, 0.5, false, bus);
      if (i === 15 && b === 3) { S.tom(t, 150, 0.7, bus); S.tom(t + sp * -0.5, 190, 0.7, bus); }
      if (i % 2 === 0) S.guitar(t, power, sp * 1.8, 0.8, i % 4 !== 0);
      if (i === 0) S.osc('sine', mtof(r), t, sp * 3, 0.5, { a: 0.01, d: 0.3, s: 0.6, r: 0.1, dest: bus });
      if (i % 4 === 0) S.osc('triangle', mtof(r), t, sp * 3.5, 0.5, { a: 0.005, d: 0.25, s: 0.6, r: 0.06, dest: bus, cutoff: 800 });
      // Lead-Lick jeden vierten Takt
      if (b === 3 && i >= 4 && i % 2 === 0 && Math.random() < 0.8) S.pick(t, r + 24 + pick(SCALES.pentMin), sp * 1.6, 0.8);
      if (i === 0 && b === 0) S.noise(t, 0.5, 0.15, { type: 'highpass', freq: 5000, dest: bus });
    },
  };
}

function mkHouse(S, bus, duck) {
  const st = { bpm: pick([122, 124, 126, 128]), root: pick([45, 46, 47, 48]), prog: pick([[0, 0, 5, 3], [0, 6, 5, 6], [0, 3, 0, 4]]), scale: 'minor', arp: Array.from({ length: 16 }, () => pick([0, 2, 4, 7, 9, 11])) };
  return {
    bpm: st.bpm,
    step(i, t, bar) {
      const sp = 60 / st.bpm / 4;
      const b = bar % 4, deg = st.prog[b];
      const ch = chordFrom(st.root + 24, st.scale, deg, '7');
      const root = st.root - 12 + SCALES.minor[deg % 7];
      if (i % 4 === 0) { S.kick(t, 1, bus, 1.1); duck(t); }
      if (i === 4 || i === 12) S.clap(t, 0.8, bus);
      if (i % 4 === 2) S.hat(t, 0.7, true, bus); else if (i % 2 === 1) S.hat(t, 0.25, false, bus);
      if (i % 4 === 2 || (i % 4 === 3 && Math.random() < 0.5)) S.bassSaw(t, root, sp * 1.2, 0.9, 520, bus);
      if (i === 3 || i === 6 || i === 11 || i === 14) S.stab(t, ch, sp * 1.4, 0.85, bus, 2200);
      if (i === 0) S.pad(t, ch, sp * 16, 0.5, bus, 1500);
      if (bar % 8 >= 4 && i % 2 === 0) S.lead(t, st.root + 36 + st.arp[(i + bar) % 16], sp * 1.6, 0.55, 'square', 2600, bus);
      if (i === 8 && bar % 4 === 3) S.noise(t, sp * 8, 0.12, { type: 'highpass', freq: 3000, sweep: 3, dest: bus });
    },
  };
}

function mkLatin(S, bus, duck) {
  const st = { bpm: pick([92, 96, 98, 100]), root: pick([45, 47, 48, 50]), prog: pick([[0, 5, 6, 4], [0, 3, 6, 4], [0, 6, 3, 4]]), scale: 'minor' };
  const mel = Array.from({ length: 8 }, () => pick(SCALES.pentMin));
  return {
    bpm: st.bpm,
    step(i, t, bar) {
      const sp = 60 / st.bpm / 4;
      const b = bar % 4, deg = st.prog[b];
      const ch = chordFrom(st.root + 24, st.scale, deg);
      const root = st.root - 12 + SCALES.minor[deg % 7];
      if (i % 4 === 0) S.kick(t, 0.95, bus, 0.9);
      if (i === 3 || i === 6 || i === 11 || i === 14) { S.rim(t, 0.9, bus); if (i === 3 || i === 11) S.snare(t, 0.55, bus, 230); }
      if (i % 2 === 0) S.hat(t, 0.35, false, bus);
      if (i === 15) S.tom(t, 230, 0.4, bus);
      if (i === 0 || i === 3 || i === 8 || i === 11) S.bass808(t, root, sp * 2.6, 0.95, bus);
      if (i === 6 || i === 14) S.bass808(t, root + 7, sp * 1.6, 0.6, bus);
      if (i === 0 || i === 6 || i === 12) S.pluck(t, st.root + 24 + SCALES.minor[(deg + (i === 6 ? 2 : 4)) % 7], 0.9, bus);
      if (i % 4 === 3 && Math.random() < 0.6) S.cowbell(t, 0.5, bus);
      if (bar % 8 >= 4 && (i === 2 || i === 5 || i === 9 || i === 13)) S.pluck(t, st.root + 36 + mel[(i + b) % 8], 0.75, bus);
      if (i === 0 && b % 2 === 0) S.pad(t, ch, sp * 16, 0.45, bus, 1200);
    },
  };
}

function mkLounge(S, bus, duck) {
  const st = { bpm: pick([88, 92, 96]), root: pick([48, 50, 53]), prog: pick([[0, 5, 1, 4], [1, 4, 0, 5], [0, 3, 1, 4]]), scale: 'major' };
  return {
    bpm: st.bpm,
    step(i, t, bar) {
      const sp = 60 / st.bpm / 4;
      const b = bar % 4, deg = st.prog[b];
      const ch = chordFrom(st.root + 12, st.scale, deg, '7');
      const root = st.root - 12 + SCALES.major[deg % 7];
      if (i === 0 || i === 8) S.kick(t, 0.5, bus, 0.8);
      if (i === 4 || i === 12) S.rim(t, 0.5, bus);
      if (i % 2 === 0) S.shaker(t, i % 4 === 0 ? 0.8 : 0.5, bus);
      if (i === 0 || i === 6 || i === 10) S.keys(t, ch, sp * 5, 0.8, bus);
      if (i % 4 === 0) S.osc('sine', mtof(root + (i === 8 ? 7 : 0)), t, sp * 3, 0.55, { a: 0.01, d: 0.2, s: 0.5, r: 0.1, dest: bus, cutoff: 700 });
      if (i === 0) S.pad(t, ch.map((m) => m - 12), sp * 16, 0.55, bus, 900);
      if (bar % 4 >= 2 && (i === 2 || i === 7 || i === 12) && Math.random() < 0.7) S.flute(t, st.root + 36 + pick(SCALES.pentMaj), sp * 3, 0.7, bus);
      if (i === 15 && Math.random() < 0.3) S.hat(t, 0.4, true, bus);
    },
  };
}

export const STATIONS = [
  { id: 'costa', name: 'Costa Beats FM', genre: 'Hip-Hop & Rap', mk: mkHipHop },
  { id: 'playa', name: 'Playa Pop 99.1', genre: 'Pop', mk: mkPop },
  { id: 'tramuntana', name: 'Tramuntana Rock', genre: 'Rock', mk: mkRock },
  { id: 'neon', name: 'Neon Nights', genre: 'Elektronische Musik', mk: mkHouse },
  { id: 'latina', name: 'La Isla Latina', genre: 'Reggaeton & Latin', mk: mkLatin },
  { id: 'lounge', name: 'Café del Sol', genre: 'Chill Lounge', mk: mkLounge },
];

export class Radio {
  constructor(game, audio) {
    this.game = game;
    this.audio = audio;
    this.idx = -1;      // -1 = aus
    this.gen = null;
    this.bar = 0; this.step = 0;
    this.nextT = 0;
    this.active = false;
    this.lastIdx = Math.floor(Math.random() * STATIONS.length);
    this.rebuild();
    this.timer = setInterval(() => this._tick(), 25);
  }

  rebuild() {
    const a = this.audio;
    if (!a.ctx) return;
    if (this.bus) return;
    const c = a.ctx;
    this.bus = c.createGain(); this.bus.gain.value = 1;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 8000;
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -16; this.comp.ratio.value = 4;
    this.musicGain = c.createGain(); this.musicGain.gain.value = 0;
    this.bus.connect(this.comp); this.comp.connect(this.lp); this.lp.connect(this.musicGain); this.musicGain.connect(a.musicBus);
    this.duckGain = c.createGain(); this.duckGain.gain.value = 1;
    this.pre = c.createGain();
    this.synth = new Synth(c, this.bus);
  }

  duck(t) { const g = this.bus.gain; g.cancelScheduledValues(t); g.setValueAtTime(0.65, t); g.linearRampToValueAtTime(1, t + 0.18); }

  setStation(i, silent = false) {
    this.rebuild();
    if (i < 0 || i >= STATIONS.length) { this.idx = -1; this.gen = null; this._fade(0); if (!silent) this.game.ui?.radioShow(null); return; }
    this.idx = i; this.lastIdx = i;
    const st = STATIONS[i];
    this.gen = st.mk(this.synth, this.bus, (t) => this.duck(t));
    this.bar = 0; this.step = 0;
    this.nextT = this.audio.ctx.currentTime + 0.08;
    this._fade(this.active ? 1 : 0);
    if (!silent) this.game.ui?.radioShow(st.name, st.genre);
  }

  next(dir = 1) {
    const n = STATIONS.length + 1;
    let i = this.idx + dir;
    if (i >= STATIONS.length) i = -1;
    if (i < -1) i = STATIONS.length - 1;
    this.setStation(i);
    void n;
  }

  _fade(v) { if (!this.musicGain) return; const t = this.audio.ctx.currentTime; this.musicGain.gain.cancelScheduledValues(t); this.musicGain.gain.setTargetAtTime(v, t, 0.15); }

  onEnter(v) {
    this.active = true;
    this.rebuild();
    if (this.idx === -1 && v.cls !== 'plane' && v.cls !== 'heli' && !this.manualOff) this.setStation(this.lastIdx, true), this.game.ui?.radioShow(STATIONS[this.idx].name, STATIONS[this.idx].genre);
    this._fade(this.idx >= 0 ? 1 : 0);
  }
  onExit() { this.active = false; this._fade(0); }

  _tick() {
    const a = this.audio;
    if (!a.ctx || !this.gen || a.ctx.state !== 'running') return;
    const c = a.ctx;
    // Zeitplan: 16 Schritte pro Takt
    const sp = 60 / this.gen.bpm / 4;
    let guard = 0;
    while (this.nextT < c.currentTime + 0.16 && guard++ < 8) {
      try { this.gen.step(this.step, this.nextT, this.bar); } catch (e) { console.warn('Radio:', e); }
      this.nextT += sp;
      this.step++;
      if (this.step >= 16) { this.step = 0; this.bar++; if (this.bar > 0 && this.bar % 32 === 0) { this.gen = STATIONS[this.idx].mk(this.synth, this.bus, (t) => this.duck(t)); } }
    }
    if (this.nextT < c.currentTime - 0.5) this.nextT = c.currentTime + 0.05;
  }

  update(dt) {
    const g = this.game;
    if (!this.lp) return;
    // Beim Aussteigen leiser/dumpfer, bei Flugzeugen aus
    const v = g.player.vehicle;
    const off = !v || v.cls === 'plane' || v.cls === 'heli' || v.exploded;
    if (!off && this.active && this.musicGain) { /* an */ }
    if (off && this.active) { this.active = false; this._fade(0); }
    if (!off && !this.active) { this.active = true; this._fade(this.idx >= 0 ? 1 : 0); }
  }

  dispose() { clearInterval(this.timer); this.gen = null; try { this.musicGain?.disconnect(); } catch { /* ignorieren */ } }
}
