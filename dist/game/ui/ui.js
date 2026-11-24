// Benutzeroberfläche im Spiel: HUD, Hinweise, Sprechblasen, Untertitel, Overlays.
import { clamp, fmtMoney } from '../util.js';
import { WEAPONS } from '../combat/weapons.js';
import { WEATHER_NAMES } from '../render/sky.js';
import { Minimap } from './minimap.js';
import { Panels } from './panels.js';
import * as THREE from 'three';

const CSS = `
#gui{position:absolute;inset:0;pointer-events:none;font-family:"Segoe UI",system-ui,sans-serif;color:#fff;user-select:none;overflow:hidden}
#gui *{box-sizing:border-box}
#gui .hud-tr{position:absolute;top:18px;right:22px;text-align:right;text-shadow:0 2px 8px #000,0 0 3px #000}
#gui .money{font-size:34px;font-weight:800;color:#7dff8a;letter-spacing:.02em}
#gui .money.neg{color:#ff6b6b}
#gui .clock{font-size:15px;opacity:.92;margin-bottom:2px}
#gui .stars{margin-top:6px;font-size:28px;letter-spacing:4px;height:34px}
#gui .stars .on{color:#ffe14a;text-shadow:0 0 10px #ffb300}
#gui .stars .off{color:rgba(255,255,255,.22)}
#gui .stars.flash .on{animation:starblink .45s steps(2) infinite}
@keyframes starblink{50%{color:#6aa5ff;text-shadow:0 0 12px #3a7bff}}
#gui .mapwrap{position:absolute;left:22px;bottom:22px;width:210px;height:210px}
#gui .mapwrap canvas{position:absolute;left:0;top:0;border-radius:50%;box-shadow:0 0 0 3px rgba(255,255,255,.85),0 6px 20px rgba(0,0,0,.6)}
#gui .bars{position:absolute;left:0;bottom:-18px;width:210px}
#gui .bar{height:8px;border-radius:5px;background:rgba(0,0,0,.55);overflow:hidden;margin-top:3px;box-shadow:0 0 0 1px rgba(255,255,255,.35)}
#gui .bar i{display:block;height:100%;width:100%;transition:width .25s}
#gui .bar.hp i{background:linear-gradient(90deg,#ff3b4a,#ff7a5a)}
#gui .bar.ar i{background:linear-gradient(90deg,#3a7bff,#6ad1ff)}
#gui .place{position:absolute;left:250px;bottom:30px;font-size:15px;text-shadow:0 2px 6px #000;opacity:.95;line-height:1.35}
#gui .place b{font-size:19px;display:block}
#gui .weapon{position:absolute;right:26px;bottom:26px;text-align:right;text-shadow:0 2px 8px #000}
#gui .weapon .wn{font-size:17px;font-weight:700;opacity:.95}
#gui .weapon .am{font-size:30px;font-weight:800}
#gui .weapon .am small{font-size:17px;opacity:.7;font-weight:600}
#gui .veh{position:absolute;right:26px;bottom:100px;text-align:right;text-shadow:0 2px 8px #000;display:none}
#gui .veh .sp{font-size:54px;font-weight:800;line-height:1}
#gui .veh .sp small{font-size:18px;opacity:.75;margin-left:4px}
#gui .veh .vn{font-size:15px;opacity:.85}
#gui .veh .hpb{width:170px;height:6px;margin:6px 0 0 auto;border-radius:4px;background:rgba(0,0,0,.5);overflow:hidden}
#gui .veh .hpb i{display:block;height:100%;background:#7dff8a}
#gui .radio{position:absolute;right:26px;bottom:230px;font-size:16px;text-shadow:0 2px 6px #000;opacity:0;transition:opacity .4s;text-align:right}
#gui .radio.show{opacity:1}
#gui .radio b{color:#ff5de6}
#gui .cross{position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;display:none}
#gui .cross::before,#gui .cross::after{content:"";position:absolute;background:#fff;box-shadow:0 0 3px #000}
#gui .cross::before{left:12px;top:0;width:2px;height:26px;clip-path:polygon(0 0,100% 0,100% 38%,0 38%,0 62%,100% 62%,100% 100%,0 100%)}
#gui .cross::after{top:12px;left:0;height:2px;width:26px;clip-path:polygon(0 0,38% 0,38% 100%,0 100%,62% 100%,62% 0,100% 0,100% 100%)}
#gui .cross.hit{filter:drop-shadow(0 0 6px #f44)}
#gui .dot{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#fff;box-shadow:0 0 4px #000;display:none}
#gui .prompt{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);padding:9px 18px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.3);border-radius:10px;font-size:18px;display:none;white-space:nowrap}
#gui .prompt kbd{display:inline-block;min-width:26px;padding:1px 7px;margin-right:8px;border-radius:6px;background:#fff;color:#111;font-weight:800;text-align:center}
#gui .notes{position:absolute;top:22px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:7px;width:min(560px,90vw)}
#gui .note{padding:8px 16px;border-radius:9px;background:rgba(10,10,20,.72);border-left:4px solid #fff;font-size:17px;animation:noteIn .25s;box-shadow:0 4px 14px rgba(0,0,0,.4)}
#gui .note.cash{border-color:#7dff8a;color:#c8ffd0}
#gui .note.good{border-color:#7dff8a}
#gui .note.warn{border-color:#ffb84a;color:#ffe3b0}
#gui .note.info{border-color:#6ad1ff}
#gui .note.mission{border-color:#ff5de6}
@keyframes noteIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
#gui .obj{position:absolute;left:24px;top:18px;max-width:min(430px,44vw);text-shadow:0 2px 6px #000}
#gui .obj .t{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#ff9be9;font-weight:700}
#gui .obj .d{font-size:19px;font-weight:600;margin-top:2px}
#gui .obj .s{font-size:14px;opacity:.85;margin-top:3px}
#gui .sub{position:absolute;left:50%;bottom:74px;transform:translateX(-50%);max-width:min(900px,86vw);text-align:center;font-size:21px;line-height:1.35;text-shadow:0 2px 8px #000,0 0 3px #000;display:none}
#gui .sub b{color:#ffd46a}
#gui .bubbles{position:absolute;inset:0}
#gui .bub{position:absolute;transform:translate(-50%,-100%);padding:4px 10px;background:rgba(255,255,255,.92);color:#111;border-radius:12px;font-size:14px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.4)}
#gui .bub::after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-6px;border:6px solid transparent;border-bottom:0;border-top-color:rgba(255,255,255,.92)}
#gui .nametag{position:absolute;transform:translate(-50%,-100%);font-size:13px;text-shadow:0 1px 4px #000;white-space:nowrap}
#gui .vig{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(255,0,0,0) 45%,rgba(200,0,20,.55) 100%);opacity:0;transition:opacity .25s}
#gui .over{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.35)}
#gui .over h1{margin:0;font-size:clamp(60px,12vw,150px);letter-spacing:.06em;color:#d8232f;text-shadow:0 0 40px rgba(255,0,0,.6),0 6px 0 #400;animation:wasted 1.4s ease-out}
#gui .over p{font-size:24px;margin:8px 0 0;opacity:.9}
@keyframes wasted{from{transform:scale(1.6);opacity:0}to{transform:none;opacity:1}}
#gui .banner{position:absolute;left:50%;top:26%;transform:translateX(-50%);font-size:clamp(34px,5vw,64px);font-weight:800;letter-spacing:.1em;text-shadow:0 4px 20px #000;opacity:0;transition:opacity .8s;text-transform:uppercase;text-align:center}
#gui .banner.show{opacity:1}
#gui .banner small{display:block;font-size:.35em;letter-spacing:.3em;opacity:.8;margin-top:6px}
#gui .arrest{position:absolute;left:50%;top:58%;transform:translateX(-50%);width:240px;height:8px;border-radius:5px;background:rgba(0,0,0,.6);overflow:hidden;display:none}
#gui .arrest i{display:block;height:100%;background:#4da3ff}
#gui .dmgdir{position:absolute;inset:0}
#gui .fpsd{position:absolute;left:8px;top:6px;font-size:12px;opacity:.55}
#gui .lockhint{position:absolute;left:50%;top:92px;transform:translateX(-50%);padding:9px 20px;border-radius:999px;background:rgba(0,0,0,.66);border:1px solid rgba(255,255,255,.4);font-size:16px;font-weight:600;display:none;white-space:nowrap;animation:lockpulse 1.6s ease-in-out infinite}
@keyframes lockpulse{50%{box-shadow:0 0 0 6px rgba(255,255,255,.12)}}
#gui .help{position:absolute;left:50%;bottom:20px;transform:translateX(-50%);font-size:13px;opacity:.75;text-shadow:0 1px 4px #000;transition:opacity 1s}
#gui .panel{pointer-events:auto}
#gui .gmenu{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(8,5,20,.62);backdrop-filter:blur(8px);pointer-events:auto}
#gui .gmenu .box{width:min(560px,92vw);max-height:88vh;overflow:auto;padding:26px 28px;background:rgba(20,12,40,.92);border:1px solid rgba(255,255,255,.22);border-radius:16px;box-shadow:0 20px 70px rgba(0,0,0,.6)}
#gui .gmenu.wide .box{width:min(980px,96vw)}
#gui .gmenu h2{margin:0 0 16px;font-size:26px;letter-spacing:.04em}
#gui .gmenu h3{margin:18px 0 8px;font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:#ff9be9}
#gui .mb{display:block;width:100%;margin:8px 0;padding:13px 18px;text-align:left;font:inherit;font-size:18px;font-weight:600;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:10px;cursor:pointer;transition:background .15s,transform .15s}
#gui .mb:hover,#gui .mb:focus-visible{background:rgba(255,130,230,.22);transform:translateX(4px);outline:none}
#gui .mb small{display:block;font-weight:400;opacity:.7;font-size:13px;margin-top:2px}
#gui .mb[disabled]{opacity:.4;cursor:default}
#gui .row{display:flex;align-items:center;gap:14px;margin:10px 0}
#gui .row label{flex:1;font-size:16px}
#gui .row input[type=range]{width:200px}
#gui .row select,#gui .row input[type=text],#gui .row input[type=number]{padding:7px 10px;font:inherit;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.25);border-radius:8px;color-scheme:dark}
#gui .row select option{color:#000}
#gui .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px}
#gui .keys{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:15px}
#gui .keys kbd{padding:1px 8px;border-radius:6px;background:#fff;color:#111;font-weight:800;text-align:center;justify-self:start}
#gui .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
#gui .tab{padding:7px 14px;border-radius:8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);cursor:pointer;font-size:15px}
#gui .tab.on{background:rgba(255,100,220,.3);border-color:#ff7de9}
#gui .chip{display:inline-block;padding:6px 12px;margin:3px;border-radius:8px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);cursor:pointer;font-size:14px}
#gui .chip:hover{background:rgba(255,120,230,.3)}
#gui .mapfull{position:absolute;inset:0;display:none;background:#08162a;pointer-events:auto}
#gui .mapfull canvas{width:100%;height:100%;display:block;cursor:crosshair}
#gui .mapfull .legend{position:absolute;left:18px;bottom:14px;font-size:13px;opacity:.85;text-shadow:0 1px 3px #000}
#gui .mapfull .close{position:absolute;right:18px;top:14px;padding:8px 14px;border-radius:8px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.3);cursor:pointer}
#gui .dlg{position:absolute;left:50%;bottom:60px;transform:translateX(-50%);width:min(820px,92vw);padding:16px 22px;background:rgba(10,8,24,.88);border:1px solid rgba(255,255,255,.25);border-radius:14px;display:none;pointer-events:auto}
#gui .dlg .who{font-weight:800;color:#ffd46a;margin-bottom:4px}
#gui .dlg .txt{font-size:20px;line-height:1.4}
#gui .dlg .go{margin-top:8px;font-size:13px;opacity:.7;text-align:right}
`;

export class UI {
  constructor(game, container) {
    this.game = game;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    this.style = st;
    const root = document.createElement('div');
    root.id = 'gui';
    root.innerHTML = `
      <div class="vig"></div>
      <div class="obj" style="display:none"><div class="t"></div><div class="d"></div><div class="s"></div></div>
      <div class="hud-tr"><div class="clock"></div><div class="money">€0</div><div class="stars"></div></div>
      <div class="mapwrap"><canvas width="210" height="210"></canvas><div class="bars"><div class="bar hp"><i></i></div><div class="bar ar"><i></i></div></div></div>
      <div class="place"><b></b><span></span></div>
      <div class="weapon"><div class="wn"></div><div class="am"></div></div>
      <div class="veh"><div class="sp">0<small>km/h</small></div><div class="vn"></div><div class="hpb"><i></i></div></div>
      <div class="radio"></div>
      <div class="cross"></div><div class="dot"></div>
      <div class="prompt"></div>
      <div class="notes"></div>
      <div class="lockhint">Klicke ins Spiel, um die Maus zu steuern</div>
      <div class="sub"></div>
      <div class="bubbles"></div>
      <div class="banner"></div>
      <div class="arrest"><i></i></div>
      <div class="over"><h1></h1><p></p></div>
      <div class="dlg"><div class="who"></div><div class="txt"></div><div class="go">[Leertaste] Weiter</div></div>
      <div class="mapfull"><canvas></canvas><div class="close">Schließen (M / Esc)</div><div class="legend"></div></div>
      <div class="gmenu"><div class="box"></div></div>
      <div class="fpsd"></div>
      <div class="help"></div>`;
    container.appendChild(root);
    this.root = root;
    const $ = (s) => root.querySelector(s);
    this.el = {
      vig: $('.vig'), obj: $('.obj'), clock: $('.clock'), money: $('.money'), stars: $('.stars'), mapCanvas: $('.mapwrap canvas'),
      hp: $('.bar.hp i'), ar: $('.bar.ar i'), place: $('.place'), weapon: $('.weapon'), veh: $('.veh'), radio: $('.radio'),
      cross: $('.cross'), dot: $('.dot'), prompt: $('.prompt'), notes: $('.notes'), sub: $('.sub'), bubbles: $('.bubbles'), banner: $('.banner'),
      arrest: $('.arrest'), over: $('.over'), dlg: $('.dlg'), mapfull: $('.mapfull'), menu: $('.gmenu'), fps: $('.fpsd'), help: $('.help'), lock: $('.lockhint'),
    };
    this.minimap = new Minimap(game, this.el.mapCanvas, this.el.mapfull);
    this.panels = new Panels(game, this);
    this.bubbles = [];
    this.notes = [];
    this.subT = 0;
    this.moneyShown = game.money;
    this.region = '';
    this.regionT = 0;
    this.radioT = 0;
    this.lastWanted = -1;
    this.wantedFlashT = 0;
    this.dmgT = 0;
    this.objective = null;
    this._v = new THREE.Vector3();
    this.hintT = 14;
    this.el.help.innerHTML = 'WASD bewegen · Shift sprinten · Leertaste springen · F einsteigen · Rechte Maustaste zielen · Esc Pause · M Karte';
    this.dialogQueue = [];
    this.dialogCb = null;
    this.dialogOpen = false;
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- Hinweise ----------
  notify(text, kind = 'info', ms = 3600) {
    const n = document.createElement('div');
    n.className = 'note ' + kind;
    n.textContent = text;
    this.el.notes.appendChild(n);
    while (this.el.notes.children.length > 5) this.el.notes.firstChild.remove();
    setTimeout(() => { n.style.opacity = '0'; n.style.transition = 'opacity .4s'; setTimeout(() => n.remove(), 450); }, ms);
  }

  moneyChanged(d) { this.moneyFlash = 1.2; }

  subtitle(speaker, text, secs = 4) {
    this.el.sub.innerHTML = (speaker ? `<b>${speaker}:</b> ` : '') + text;
    this.el.sub.style.display = 'block';
    this.subT = secs;
  }

  // Dialog mit Weiter (Leertaste/Klick); blockiert Steuerung. lines: [{who, text}]
  dialog(lines, cb) {
    this.dialogQueue = lines.slice();
    this.dialogCb = cb || null;
    this.dialogOpen = true;
    this.game.controlsEnabled = false;
    this._nextLine();
  }

  _nextLine() {
    const l = this.dialogQueue.shift();
    if (!l) {
      this.el.dlg.style.display = 'none';
      this.dialogOpen = false;
      this.game.controlsEnabled = true;
      const cb = this.dialogCb; this.dialogCb = null;
      cb && cb();
      return;
    }
    this.el.dlg.style.display = 'block';
    this.el.dlg.querySelector('.who').textContent = l.who || '';
    this.el.dlg.querySelector('.txt').textContent = l.text;
    this.dialogLineT = 0;
    if (l.sfx) this.game.audio?.phoneRing?.();
  }

  bubble(ch, text, secs = 3) {
    if (!ch || (ch !== this.game.player && Math.hypot(ch.x - this.game.player.x, ch.z - this.game.player.z) > 40)) return;
    if (this.bubbles.length > 6) { const o = this.bubbles.shift(); o.el.remove(); }
    const old = this.bubbles.find((b) => b.ch === ch);
    if (old) { old.el.remove(); this.bubbles.splice(this.bubbles.indexOf(old), 1); }
    const el = document.createElement('div');
    el.className = 'bub'; el.textContent = text;
    this.el.bubbles.appendChild(el);
    this.bubbles.push({ ch, el, t: secs });
  }

  setObjective(title, desc, sub = '') {
    this.objective = title ? { title, desc, sub } : null;
    if (!title) { this.el.obj.style.display = 'none'; return; }
    this.el.obj.style.display = 'block';
    this.el.obj.querySelector('.t').textContent = title;
    this.el.obj.querySelector('.d').textContent = desc || '';
    this.el.obj.querySelector('.s').textContent = sub || '';
  }

  banner(text, sub = '', secs = 3) {
    const b = this.el.banner;
    b.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    b.classList.add('show');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => b.classList.remove('show'), secs * 1000);
  }

  showOverlay(title, sub, ms) {
    const o = this.el.over;
    o.querySelector('h1').textContent = title;
    o.querySelector('h1').style.color = title === 'BUSTED' ? '#4da3ff' : '#d8232f';
    o.querySelector('p').textContent = sub || '';
    o.style.display = 'flex';
  }
  hideOverlay() { this.el.over.style.display = 'none'; }

  damaged(d) { this.dmgT = Math.min(1, this.dmgT + d / 40); }

  vehicleEntered(v) {
    this.el.veh.style.display = 'block';
    this.el.veh.querySelector('.vn').textContent = v.T.name;
    this.vehCls = v.cls;
  }
  vehicleExited() { this.el.veh.style.display = 'none'; }

  radioShow(name, genre) {
    this.el.radio.innerHTML = name ? `<b>♪</b> ${name}<br><small>${genre || ''}</small>` : '<b>♪</b> Radio aus';
    this.el.radio.classList.add('show');
    this.radioT = 3.2;
  }

  wantedChanged(w, up) {
    this.lastWanted = w;
    if (w > 0 && up) this.notify('Fahndung! Die Polizei ist hinter dir her', 'warn');
  }

  togglePause() { this.panels.togglePause(); }

  // ---------- Pro Frame ----------
  update(dt) {
    const g = this.game, p = g.player, el = this.el;
    // Dialog weiter
    if (this.dialogOpen) {
      this.dialogLineT += dt;
      if (g.input.hit('Space') || g.input.hit('Enter') || g.input.mouseHit(0)) if (this.dialogLineT > 0.25) this._nextLine();
    }
    // Hinweis: Ohne Mausfang (Pointer-Lock) bewegt sich die Kamera nicht
    el.lock.style.display = (!g.input.locked && !g.paused && !this.panels.open && !this.dialogOpen && !this.minimap.full && g.controlsEnabled && p.alive) ? 'block' : 'none';
    // Menü-Eingaben
    if (g.input.hit('Escape') && !g.input.locked) this.panels.onEscape();
    if (g.input.hit('KeyM') && !this.panels.open) this.minimap.toggleFull();
    if (g.input.hit('F4') && g.isAdmin) this.panels.toggleAdmin();
    if (g.input.hit('KeyN')) { this.fpsShow = !this.fpsShow; }
    // Geld
    this.moneyShown += (g.money - this.moneyShown) * Math.min(1, dt * 7);
    if (Math.abs(g.money - this.moneyShown) < 1) this.moneyShown = g.money;
    el.money.textContent = fmtMoney(this.moneyShown);
    el.money.style.transform = this.moneyFlash > 0 ? 'scale(1.12)' : '';
    this.moneyFlash = Math.max(0, (this.moneyFlash || 0) - dt);
    // Uhr, Wetter
    const h = g.atm.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    el.clock.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${WEATHER_NAMES[g.atm.weatherKey] || ''}`;
    // Gesundheit
    el.hp.style.width = clamp((p.hp / p.maxHp) * 100, 0, 100) + '%';
    el.ar.style.width = clamp(p.armor, 0, 100) + '%';
    // Sterne
    const w = g.police.wanted;
    if (w !== this._wShown || this._flashShown !== (g.police.seen)) {
      this._wShown = w; this._flashShown = g.police.seen;
      el.stars.innerHTML = [0, 1, 2, 3, 4].map((i) => `<span class="${i < w ? 'on' : 'off'}">★</span>`).join('');
      el.stars.classList.toggle('flash', w > 0 && !g.police.seen);
    }
    // Waffe
    const W = p.weapon;
    if (p.vehicle) el.weapon.style.display = 'none';
    else {
      el.weapon.style.display = 'block';
      el.weapon.querySelector('.wn').textContent = W ? W.name : '';
      const ws = p.weapons[p.cur];
      el.weapon.querySelector('.am').innerHTML = W && W.mag ? `${ws ? ws.mag : 0}<small> / ${ws ? ws.reserve : 0}</small>` : (W && W.thrown ? `${ws ? ws.mag + ws.reserve : 0}` : '');
    }
    // Fahrzeug
    if (p.vehicle) {
      const v = p.vehicle;
      const sp = v.cls === 'boat' ? Math.abs(v.speed) * 1.94 : Math.abs(v.speed) * 3.6;
      el.veh.querySelector('.sp').innerHTML = `${Math.round(sp)}<small>${v.cls === 'boat' ? 'kn' : 'km/h'}</small>`;
      el.veh.querySelector('.hpb i').style.width = clamp((v.hp / v.maxHp) * 100, 0, 100) + '%';
      el.veh.querySelector('.hpb i').style.background = v.hp / v.maxHp > 0.5 ? '#7dff8a' : v.hp / v.maxHp > 0.25 ? '#ffd24a' : '#ff5a4a';
      if (v.cls === 'plane') el.veh.querySelector('.vn').textContent = `${v.T.name} · Höhe ${Math.round(v.y - g.physics.groundHeight(v.x, v.z))} m · Gas ${Math.round(v.throttleAir * 100)}%`;
    }
    // Radio-Anzeige
    this.radioT -= dt;
    if (this.radioT <= 0) el.radio.classList.remove('show');
    // Fadenkreuz
    const aim = p.aiming && !p.vehicle && p.alive;
    el.cross.style.display = aim ? 'block' : 'none';
    el.dot.style.display = !aim && !p.vehicle && p.alive && p.weapon && !p.weapon.melee ? 'block' : 'none';
    el.cross.classList.toggle('hit', !!p.aimTarget);
    // Hinweis-Prompt
    el.prompt.style.display = 'none';
    if (p.alive && !g.paused && g.controlsEnabled) {
      let txt = null;
      if (p.vehicle) {
        const v = p.vehicle;
        txt = `<kbd>F</kbd>Aussteigen`;
        if (v.cls === 'plane') txt += ` &nbsp; <kbd>Shift</kbd>Gas`;
      } else {
        const m = g.markers.interactable(p);
        if (m) txt = `<kbd>F</kbd>${m.hint || 'Interagieren'}`;
        else {
          const v = g.vehicles.nearest(p.x, p.z, 3.7, (q) => q.alive && !q.exploded && q.burning <= 0 && !(q.driver && q.driver.isPlayer));
          if (v) txt = `<kbd>F</kbd>${v.driver ? 'Fahrer rausziehen' : 'Einsteigen'} · ${v.T.name}`;
        }
      }
      if (txt) { el.prompt.innerHTML = txt; el.prompt.style.display = 'block'; }
    }
    // Untertitel
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) el.sub.style.display = 'none'; }
    // Region
    this.regionT -= dt;
    if (this._frameCount++ % 20 === 0) this._region();
    // Schaden
    this.dmgT = Math.max(0, this.dmgT - dt * 1.4);
    const lowhp = p.hp < p.maxHp * 0.3;
    el.vig.style.opacity = String(Math.min(1, this.dmgT + (lowhp ? 0.35 + Math.sin(g.time * 5) * 0.12 : 0)));
    // Festnahme-Balken
    if (g.police.arrestT > 0.05) { el.arrest.style.display = 'block'; el.arrest.firstChild.style.width = (g.police.arrestT / 2.6) * 100 + '%'; } else el.arrest.style.display = 'none';
    // Sprechblasen
    this._updateBubbles(dt);
    // Minikarte
    this.minimap.update(dt);
    // FPS
    if (this.fpsShow) el.fps.textContent = `${Math.round(g.fps)} FPS · Fahrzeuge ${g.vehicles.list.length} · Figuren ${g.characters.length} · Chunks ${g.chunks.chunks.size}`; else el.fps.textContent = '';
    this.hintT -= dt;
    if (this.hintT < 0) el.help.style.opacity = '0';
  }
  _frameCount = 0;

  _region() {
    const g = this.game, p = g.player;
    const x = p.vehicle ? p.vehicle.x : p.x, z = p.vehicle ? p.vehicle.z : p.z;
    let best = null, bd = 1e9;
    for (const s of g.ctx.settlements) {
      if (!s.pos) continue;
      const d = Math.hypot(s.pos[0] - x, s.pos[1] - z);
      const R = (s.r || s.len / 2 || 250) * 1.25;
      if (d < R && d < bd) { bd = d; best = s.name; }
    }
    let name = best;
    if (!name) {
      const isl = g.ctx.coast.islandAt(x, z);
      if (!isl) name = g.ctx.coast.sdAt(x, z) < 0 ? 'Mittelmeer' : '';
      else name = { mallorca: 'Mallorca', menorca: 'Menorca', ibiza: 'Ibiza', formentera: 'Formentera', cabrera: 'Cabrera', dragonera: 'Sa Dragonera', conills: 'Cabrera' }[isl] || '';
      // Landschaft
      const sdv = g.ctx.coast.sdAt(x, z);
      if (isl === 'mallorca') {
        const mh = g.ctx.hf.mountain(x, z);
        if (mh > 60) name = (x > 1100 && z < -2500) ? 'Cap de Formentor' : (x > 2400 ? 'Serres de Llevant' : 'Serra de Tramuntana');
        else if (g.ctx.hf.wetMask(x, z)) name = "S'Albufera";
      }
      if (sdv < 0) name = isl ? name : 'Mittelmeer';
    }
    const street = (() => { const nr = g.ctx.net.nearest(x, z, 24); return nr && nr.road.name && nr.road.sw > 0 ? nr.road.name : ''; })();
    const pl = this.el.place;
    pl.querySelector('b').textContent = name || '';
    pl.querySelector('span').textContent = street;
    if (name && name !== this.region) {
      this.region = name;
      if (this.regionStarted) this.banner(name, g.ctx.coast.islandAt(x, z) ? '' : '', 2.6);
      this.regionStarted = true;
    }
  }

  _updateBubbles(dt) {
    const g = this.game, cam = g.camera, W = this.root.clientWidth, H = this.root.clientHeight;
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.t -= dt;
      const c = b.ch;
      if (b.t <= 0 || !c || (c.dropped)) { b.el.remove(); this.bubbles.splice(i, 1); continue; }
      this._v.set(c.x, c.y + 2.05, c.z).project(cam);
      if (this._v.z > 1 || this._v.z < -1 || Math.abs(this._v.x) > 1.1) { b.el.style.display = 'none'; continue; }
      b.el.style.display = 'block';
      b.el.style.left = ((this._v.x * 0.5 + 0.5) * W) + 'px';
      b.el.style.top = ((-this._v.y * 0.5 + 0.5) * H) + 'px';
    }
  }

  setHint(t) { this.el.help.innerHTML = t; this.el.help.style.opacity = '1'; this.hintT = 8; }

  dispose() {
    this.root.remove();
    this.style.remove();
  }
}
