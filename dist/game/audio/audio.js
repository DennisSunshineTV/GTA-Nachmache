// Audio: synthetische Effekte (Waffen, Motoren, Explosionen, Sirenen), Umgebung und Radio-Anbindung.
import { Synth, Radio } from './radio.js';
import { clamp, lerp } from '../util.js';

export class AudioSystem {
  constructor(game, vols = {}) {
    this.game = game;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = AC ? new AC() : null;
    this.ok = !!this.ctx;
    if (!this.ok) return;
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = vols.master ?? 0.8;
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 5;
    this.master.connect(this.comp); this.comp.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = vols.sfx ?? 0.8; this.sfxBus.connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = vols.music ?? 0.7; this.musicBus.connect(this.master);
    this.ambBus = c.createGain(); this.ambBus.gain.value = 0.7 * (vols.sfx ?? 0.8); this.ambBus.connect(this.master);
    this.S = new Synth(c, this.sfxBus);
    this.engine = null;
    this.amb = null;
    this.t = 0;
    this.footT = 0;
    this._buildAmbient();
    this.radio = new Radio(game, this);
    game.radio = this.radio;
    this.club = { next: 0, bar: 0 };
    this.siren = null;
    if (c.state === 'suspended') c.resume().catch(() => {});
    this._unlock = () => { if (c.state === 'suspended') c.resume().catch(() => {}); };
    window.addEventListener('pointerdown', this._unlock);
    window.addEventListener('keydown', this._unlock);
  }

  setVolumes(m, mu, s) {
    if (!this.ok) return;
    this.master.gain.value = m; this.musicBus.gain.value = mu; this.sfxBus.gain.value = s; this.ambBus.gain.value = 0.7 * s;
  }

  // ---------- Hilfen ----------
  // Räumlicher Einmal-Knoten: fn(dest, t0) plant die Töne
  at(x, y, z, fn, ref = 25, maxDist = 400) {
    if (!this.ok || this.ctx.state !== 'running') return;
    const cam = this.game.camera;
    const dx = x - cam.position.x, dz = z - cam.position.z, dy = y - cam.position.y;
    const d = Math.hypot(dx, dy, dz);
    if (d > maxDist) return;
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = clamp(1 / (1 + (d / ref) ** 1.4), 0.015, 1);
    let node = g;
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      const rx = Math.cos(cam.rotation.y), rz = -Math.sin(cam.rotation.y);
      p.pan.value = clamp((dx * rx + dz * rz) / (d || 1) * 0.9, -0.9, 0.9);
      g.connect(p); p.connect(this.sfxBus); node = p;
    } else g.connect(this.sfxBus);
    fn(g, c.currentTime + 0.001);
    setTimeout(() => { try { g.disconnect(); node.disconnect(); } catch { /* ignorieren */ } }, 4000);
  }
  now(fn) { if (!this.ok || this.ctx.state !== 'running') return; fn(this.sfxBus, this.ctx.currentTime + 0.001); }

  // ---------- Einzel-Effekte ----------
  shot(ch, W) {
    const S = this.S, id = W?.id || 'pistol';
    this.at(ch.x, ch.y + 1.4, ch.z, (d, t) => {
      if (id === 'shotgun') { S.noise(t, 0.42, 0.9, { type: 'lowpass', freq: 2600, sweep: 0.25, dest: d }); S.osc('sine', 95, t, 0.2, 0.9, { a: 0.001, d: 0.2, s: 0.01, r: 0.05, slide: 0.4, dest: d }); }
      else if (id === 'sniper') { S.noise(t, 0.7, 0.9, { type: 'lowpass', freq: 3500, sweep: 0.12, dest: d }); S.osc('sine', 110, t, 0.3, 1, { a: 0.001, d: 0.3, s: 0.01, r: 0.05, slide: 0.35, dest: d }); S.noise(t + 0.12, 0.5, 0.2, { type: 'bandpass', freq: 900, dest: d }); }
      else if (id === 'smg' || id === 'rifle') { S.noise(t, 0.13, 0.75, { type: 'bandpass', freq: id === 'rifle' ? 2100 : 2800, q: 0.7, dest: d }); S.osc('sine', id === 'rifle' ? 130 : 170, t, 0.08, 0.7, { a: 0.001, d: 0.08, s: 0.01, r: 0.02, slide: 0.4, dest: d }); }
      else if (id === 'heli') { S.noise(t, 0.1, 0.4, { type: 'bandpass', freq: 2600, dest: d }); }
      else { S.noise(t, 0.16, 0.85, { type: 'bandpass', freq: 3200, q: 0.6, dest: d }); S.osc('sine', 150, t, 0.1, 0.7, { a: 0.001, d: 0.1, s: 0.01, r: 0.03, slide: 0.35, dest: d }); }
    }, id === 'sniper' ? 90 : 40, 700);
  }
  reloadSound(ch) { this.at(ch.x, ch.y + 1, ch.z, (d, t) => { const S = this.S; S.noise(t, 0.05, 0.4, { type: 'bandpass', freq: 1800, dest: d }); S.noise(t + 0.55, 0.06, 0.5, { type: 'bandpass', freq: 1200, dest: d }); S.noise(t + 0.9, 0.04, 0.35, { type: 'bandpass', freq: 2200, dest: d }); }, 10, 60); }
  click() { this.now((d, t) => this.S.noise(t, 0.02, 0.3, { type: 'bandpass', freq: 2500, dest: d })); }
  punch(ch) { this.at(ch.x, ch.y + 1, ch.z, (d, t) => { this.S.noise(t, 0.09, 0.5, { type: 'lowpass', freq: 600, dest: d }); this.S.osc('sine', 120, t, 0.08, 0.5, { a: 0.001, d: 0.08, s: 0.01, r: 0.02, slide: 0.5, dest: d }); }, 10, 50); }
  block(ch) { this.at(ch.x, ch.y + 1.2, ch.z, (d, t) => { this.S.noise(t, 0.05, 0.6, { type: 'bandpass', freq: 1400, dest: d }); this.S.osc('sine', 210, t, 0.05, 0.35, { a: 0.001, d: 0.05, s: 0.01, r: 0.02, dest: d }); }, 10, 50); }
  throwSound(ch) { this.at(ch.x, ch.y + 1, ch.z, (d, t) => this.S.noise(t, 0.2, 0.2, { type: 'bandpass', freq: 800, sweep: 3, dest: d }), 10, 40); }
  thud(x, y, z) { this.at(x, y, z, (d, t) => { this.S.osc('sine', 90, t, 0.18, 0.9, { a: 0.001, d: 0.18, s: 0.01, r: 0.05, slide: 0.4, dest: d }); this.S.noise(t, 0.1, 0.4, { type: 'lowpass', freq: 500, dest: d }); }, 12, 80); }
  hurt() { this.now((d, t) => this.S.noise(t, 0.12, 0.25, { type: 'lowpass', freq: 900, dest: d })); }
  explosion(dist = 30) {
    const S = this.S;
    this.now((d, t) => {
      const g = this.ctx.createGain(); g.gain.value = clamp(1 / (1 + (dist / 60) ** 1.3), 0.05, 1); g.connect(d);
      S.noise(t, 2.2, 1, { type: 'lowpass', freq: 2200, sweep: 0.03, dest: g });
      S.osc('sine', 70, t, 1.2, 1.2, { a: 0.002, d: 1.2, s: 0.01, r: 0.2, slide: 0.35, dest: g });
      S.noise(t + 0.05, 0.4, 0.5, { type: 'bandpass', freq: 600, dest: g });
      setTimeout(() => g.disconnect(), 3500);
    });
  }
  crash(speed) {
    const v = clamp(speed / 18, 0.2, 1);
    this.now((d, t) => { const S = this.S; S.noise(t, 0.35 * v + 0.1, 0.7 * v, { type: 'bandpass', freq: 900, q: 0.5, sweep: 0.4, dest: d }); S.osc('sine', 100, t, 0.2, 0.8 * v, { a: 0.001, d: 0.2, s: 0.01, r: 0.05, slide: 0.4, dest: d }); if (speed > 10) S.noise(t + 0.05, 0.5, 0.3, { type: 'highpass', freq: 3000, dest: d }); });
  }
  pickup() { this.now((d, t) => { this.S.osc('sine', 880, t, 0.08, 0.25, { a: 0.002, d: 0.08, s: 0.1, r: 0.03, dest: d }); this.S.osc('sine', 1320, t + 0.07, 0.12, 0.25, { a: 0.002, d: 0.12, s: 0.1, r: 0.05, dest: d }); }); }
  ping() { this.now((d, t) => { this.S.osc('triangle', 1040, t, 0.1, 0.18, { a: 0.002, d: 0.1, s: 0.1, r: 0.05, dest: d }); }); }
  wantedUp() { this.now((d, t) => { for (let i = 0; i < 3; i++) this.S.osc('square', i % 2 ? 640 : 880, t + i * 0.13, 0.12, 0.1, { a: 0.003, d: 0.1, s: 0.3, r: 0.02, cutoff: 2200, dest: d }); }); }
  wastedSound() { this.now((d, t) => { this.S.osc('sawtooth', 220, t, 2.5, 0.25, { a: 0.01, d: 2.5, s: 0.1, r: 0.5, slide: 0.25, cutoff: 900, dest: d }); this.S.noise(t, 1.5, 0.15, { type: 'lowpass', freq: 500, dest: d }); }); }
  phoneRing() { this.now((d, t) => { for (let i = 0; i < 4; i++) { this.S.osc('sine', 1000, t + i * 0.3, 0.12, 0.2, { a: 0.003, d: 0.12, s: 0.5, r: 0.02, dest: d }); this.S.osc('sine', 1250, t + i * 0.3 + 0.13, 0.12, 0.2, { a: 0.003, d: 0.12, s: 0.5, r: 0.02, dest: d }); } }); }
  enterVehicle(v) { this.at(v.x, v.y + 1, v.z, (d, t) => { this.S.noise(t, 0.05, 0.4, { type: 'lowpass', freq: 500, dest: d }); this.S.noise(t + 0.25, 0.08, 0.3, { type: 'lowpass', freq: 800, dest: d }); }, 10, 40); this._startEngine(v); }
  exitVehicle(v) { this.at(v.x, v.y + 1, v.z, (d, t) => this.S.noise(t, 0.07, 0.4, { type: 'lowpass', freq: 600, dest: d }), 10, 40); this._stopEngine(); }
  horn(v) {
    if (!this.ok || this.hornOn > this.ctx.currentTime) return;
    this.hornOn = this.ctx.currentTime + 0.12;
    this.at(v.x, v.y + 1, v.z, (d, t) => { for (const f of v.cls === 'bike' ? [520, 640] : v.type === 'bus' || v.type === 'truck' ? [220, 280] : [420, 530]) this.S.osc('square', f, t, 0.16, 0.12, { a: 0.005, d: 0.15, s: 0.9, r: 0.04, cutoff: 2500, dest: d }); }, 30, 200);
  }

  // ---------- Motor ----------
  _startEngine(v) {
    if (!this.ok) return;
    this._stopEngine();
    const c = this.ctx;
    const e = { v, o1: c.createOscillator(), o2: c.createOscillator(), o3: c.createOscillator(), f: c.createBiquadFilter(), g: c.createGain(), skid: null, wind: null };
    e.o1.type = 'sawtooth'; e.o2.type = 'square'; e.o3.type = 'sine';
    e.f.type = 'lowpass'; e.f.frequency.value = 600; e.f.Q.value = 2;
    e.g.gain.value = 0;
    e.o1.connect(e.f); e.o2.connect(e.f); e.o3.connect(e.g); e.f.connect(e.g); e.g.connect(this.sfxBus);
    e.o1.start(); e.o2.start(); e.o3.start();
    // Reifenquietschen + Wind
    const mkNoise = (type, freq, q) => { const s = c.createBufferSource(); s.buffer = this.S.noiseBuf; s.loop = true; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(); return { s, f, g }; };
    e.skid = mkNoise('bandpass', 1700, 3); e.wind = mkNoise('lowpass', 900, 0.6);
    this.engine = e;
  }
  _stopEngine() {
    const e = this.engine;
    if (!e) return;
    try { e.o1.stop(); e.o2.stop(); e.o3.stop(); e.skid.s.stop(); e.wind.s.stop(); e.g.disconnect(); e.skid.g.disconnect(); e.wind.g.disconnect(); } catch { /* ignorieren */ }
    this.engine = null;
  }

  _updateEngine(dt) {
    const e = this.engine;
    const p = this.game.player;
    if (!e) return;
    const v = p.vehicle;
    if (!v || !v.alive || v !== e.v) { if (!v) this._stopEngine(); else { this._startEngine(v); } return; }
    const c = this.ctx, t = c.currentTime;
    const T = v.T;
    const ratio = clamp(Math.abs(v.speed) / T.maxSpeed, 0, 1.1);
    const thr = clamp(Math.abs(v.ctl.throttle) + (v.cls === 'plane' ? v.throttleAir : 0), 0, 1);
    let f0, vol, cutoff, mix2 = 1;
    switch (v.cls) {
      case 'plane': f0 = 70 + v.throttleAir * 90; vol = 0.13 + v.throttleAir * 0.15; cutoff = 700 + v.throttleAir * 900; break;
      case 'heli': f0 = 22; vol = 0.2; cutoff = 500; break;
      case 'boat': f0 = 40 + ratio * 110 + thr * 20; vol = 0.1 + thr * 0.16; cutoff = 500 + ratio * 700; break;
      case 'tank': f0 = 26 + thr * 12; vol = 0.2 + thr * 0.1; cutoff = 380 + thr * 300; break;
      case 'bike': { const g = Math.min(5, Math.floor(ratio * 6)); const within = ratio * 6 - g; f0 = 70 + (g * 14) + within * 190; vol = 0.09 + thr * 0.12; cutoff = 900 + thr * 2400; break; }
      default: {
        const bigV = v.type === 'truck' || v.type === 'bus' || v.type === 'tractor';
        const gears = bigV ? 4 : 5;
        const g = Math.min(gears - 1, Math.floor(ratio * gears));
        const within = clamp(ratio * gears - g, 0, 1);
        const rpm = (bigV ? 700 : 900) + within * (bigV ? 2200 : 4800) + thr * 700;
        f0 = (rpm / 60) * (v.type === 'sports' ? 2.2 : bigV ? 1.2 : 2);
        vol = 0.07 + thr * 0.13 + (bigV ? 0.04 : 0);
        cutoff = 350 + thr * 1700 + rpm * 0.18;
        if (v.type === 'tractor') mix2 = 0.4;
      }
    }
    if (!v.engineOn || v.exploded) vol = 0;
    e.o1.frequency.setTargetAtTime(f0, t, 0.05); e.o2.frequency.setTargetAtTime(f0 * (v.type === 'sports' ? 1.5 : 1.003), t, 0.05); e.o3.frequency.setTargetAtTime(f0 * 0.5, t, 0.05);
    e.f.frequency.setTargetAtTime(cutoff, t, 0.06);
    e.g.gain.setTargetAtTime(vol * mix2 * 1.6, t, 0.05);
    // Quietschen: seitlicher Schlupf
    const lx = Math.cos(v.h), lz = -Math.sin(v.h);
    const slip = Math.abs(v.vx * lx + v.vz * lz);
    const skid = v.cls === 'car' || v.cls === 'bike' ? clamp((slip - 3) / 9, 0, 1) * (v.grounded ? 1 : 0) + (v.ctl.handbrake && Math.abs(v.speed) > 8 ? 0.6 : 0) : 0;
    e.skid.g.gain.setTargetAtTime(Math.min(0.6, skid * 0.45), t, 0.05);
    e.skid.f.frequency.setTargetAtTime(1500 + ratio * 900, t, 0.1);
    // Wind
    const sp = Math.abs(v.speed);
    e.wind.g.gain.setTargetAtTime(clamp(sp / 80, 0, 1) * (v.cls === 'plane' ? 0.45 : 0.22), t, 0.1);
  }

  // ---------- Umgebung ----------
  _buildAmbient() {
    const c = this.ctx;
    const mk = (type, freq, q, gain) => { const s = c.createBufferSource(); s.buffer = this.S.noiseBuf; s.loop = true; const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.ambBus); s.start(); return { s, f, g, base: gain }; };
    this.amb = {
      waves: mk('lowpass', 420, 0.5, 0.5), rain: mk('highpass', 1800, 0.5, 0.5), city: mk('lowpass', 220, 0.8, 0.3), cicada: mk('bandpass', 5600, 6, 0.3), wind: mk('lowpass', 500, 0.5, 0.4),
    };
    // Zikaden werden per Oszillator amplitudenmoduliert
    this.cic = c.createOscillator(); this.cicG = c.createGain(); this.cicG.gain.value = 0.5; this.cic.frequency.value = 26; this.cic.connect(this.cicG); this.cic.start();
    this.cicGain = c.createGain(); this.cicGain.gain.value = 0;
    this.cic2 = c.createOscillator(); this.cic2.type = 'square'; this.cic2.frequency.value = 5200; const cf = c.createBiquadFilter(); cf.type = 'bandpass'; cf.frequency.value = 5200; cf.Q.value = 8;
    this.cic2.connect(cf); cf.connect(this.cicGain); this.cicGain.connect(this.ambBus); this.cic2.start();
    this.cicG.connect(this.cicGain.gain);
    this.cricket = c.createOscillator(); this.cricket.type = 'sine'; this.cricket.frequency.value = 4300; this.crG = c.createGain(); this.crG.gain.value = 0;
    this.cricket.connect(this.crG); this.crG.connect(this.ambBus); this.cricket.start();
    this.crLfo = c.createOscillator(); this.crLfo.frequency.value = 18; const cl = c.createGain(); cl.gain.value = 0.5; this.crLfo.connect(cl); this.crBase = 0;
    this.crLfo.start();
  }

  _updateAmbient(dt) {
    const g = this.game, p = g.player, c = this.ctx, t = c.currentTime;
    const x = p.vehicle ? p.vehicle.x : p.x, z = p.vehicle ? p.vehicle.z : p.z;
    const sd = g.ctx.coast.sdAt(x, z);
    const lu = g.ctx.landuse.get(x, z);
    const night = g.atm.night, rain = g.atm.w.rain;
    const inV = !!p.vehicle && p.vehicle.cls !== 'boat' && p.vehicle.cls !== 'plane';
    const damp = inV ? 0.45 : 1;
    const wave = clamp(1 - Math.abs(sd) / 140, 0, 1) * 0.5 + (p.vehicle && p.vehicle.cls === 'boat' ? 0.25 : 0);
    this.amb.waves.g.gain.setTargetAtTime(wave * damp * (0.8 + 0.2 * Math.sin(g.time * 0.35)), t, 0.4);
    this.amb.rain.g.gain.setTargetAtTime(rain * 0.35 * (inV ? 0.6 : 1), t, 0.5);
    this.amb.city.g.gain.setTargetAtTime((lu && lu !== 10 ? 0.28 : 0.04) * damp, t, 0.6);
    this.amb.wind.g.gain.setTargetAtTime(0.03 + (g.atm.weatherKey === 'storm' ? 0.35 : 0.08) * (sd > 0 ? 1 : 1.3), t, 0.6);
    // Zikaden tagsüber im Grünen, Grillen nachts
    const green = sd > 40 && !lu ? 1 : lu === 2 ? 0.6 : 0;
    this.cicGain.gain.setTargetAtTime(0, t, 0.1); // (AM-Gain wird über cicG gesteuert)
    this.cicG.gain.setTargetAtTime(0.03 * green * (1 - night) * (1 - rain), t, 0.8);
    this.crG.gain.setTargetAtTime((0.012 * green * night) * (1 + Math.sin(g.time * 18) * 0.9 > 1 ? 1 : 0.1), t, 0.05);
    // Blitz → Donner
    if (g.atm.lightning > 0.9 && !this._thunder) { this._thunder = true; setTimeout(() => { this.explosion(250); this._thunder = false; }, 500 + Math.random() * 2500); }
    // Club-Bass bei Nacht
    this._clubUpdate(x, z, night, inV);
    // Sirenen
    this._sirenUpdate(x, z, inV);
  }

  _clubUpdate(x, z, night, inV) {
    const g = this.game, c = this.ctx;
    if (!this._clubs) this._clubs = g.ctx.pois.filter((p) => p.type === 'club');
    let best = 1e9;
    for (const cl of this._clubs) { const d = Math.hypot(cl.x - x, cl.z - z); if (d < best) best = d; }
    if (best > 90 || night < 0.4) return;
    const gain = clamp(1 - best / 90, 0, 1) * 0.5 * (inV ? 0.5 : 1);
    const bpm = 126, sp = 60 / bpm;
    const cl = this.club;
    if (cl.next < c.currentTime) cl.next = c.currentTime + 0.05;
    while (cl.next < c.currentTime + 0.12) {
      const gn = c.createGain(); gn.gain.value = gain;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; gn.connect(lp); lp.connect(this.ambBus);
      this.S.kick(cl.next, 1, gn, 1);
      if (cl.bar % 2 === 1) this.S.osc('sawtooth', 55, cl.next + sp * 0.5, sp * 0.4, 0.4, { a: 0.003, d: 0.1, s: 0.4, r: 0.05, cutoff: 200, dest: gn });
      const tmp = lp; setTimeout(() => { try { gn.disconnect(); tmp.disconnect(); } catch { /* */ } }, 1500);
      cl.next += sp; cl.bar++;
    }
  }

  _sirenUpdate(x, z, inV) {
    const g = this.game, c = this.ctx, t = c.currentTime;
    let best = 1e9;
    for (const v of g.vehicles.list) if (v.sirenOn && v.alive && !v.exploded) { const d = Math.hypot(v.x - x, v.z - z); if (d < best) best = d; }
    if (!this.siren) {
      const o = c.createOscillator(); o.type = 'sawtooth'; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1800;
      const gn = c.createGain(); gn.gain.value = 0; o.connect(f); f.connect(gn); gn.connect(this.sfxBus); o.start();
      this.siren = { o, gn };
    }
    const vol = best < 220 ? clamp(1 / (1 + (best / 30) ** 1.5), 0, 0.6) * 0.2 * (inV ? 0.6 : 1) : 0;
    this.siren.gn.gain.setTargetAtTime(vol, t, 0.1);
    const ph = (g.time * 0.9) % 1;
    const f = 700 + 700 * Math.abs(Math.sin(g.time * 3.2));
    this.siren.o.frequency.setTargetAtTime(f, t, 0.03);
    void ph;
  }

  update(dt) {
    if (!this.ok) return;
    this.t += dt;
    if (this.ctx.state === 'suspended') return;
    const g = this.game;
    this._updateEngine(dt);
    this._updateAmbient(dt);
    // Schritte
    const p = g.player;
    if (!p.vehicle && p.alive && p.state === 'ground' && p.speedH > 0.5) {
      this.footT -= dt;
      if (this.footT <= 0) {
        this.footT = clamp(0.62 - p.speedH * 0.07, 0.27, 0.6);
        const lu = g.ctx.landuse.get(p.x, p.z), sand = g.ctx.coast.sdAt(p.x, p.z) < 28;
        this.now((d, t) => this.S.noise(t, 0.06, sand ? 0.05 : 0.08, { type: 'lowpass', freq: sand ? 900 : lu ? 1700 : 1100, dest: d }));
      }
    }
    if (p.state === 'swim' && Math.random() < dt * 3) this.now((d, t) => this.S.noise(t, 0.2, 0.06, { type: 'bandpass', freq: 1200, dest: d }));
  }

  dispose() {
    this.radio?.dispose();
    this._stopEngine();
    window.removeEventListener('pointerdown', this._unlock);
    window.removeEventListener('keydown', this._unlock);
    try { this.ctx?.close(); } catch { /* ignorieren */ }
  }
}
