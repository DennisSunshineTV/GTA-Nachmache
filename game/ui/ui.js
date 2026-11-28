// Benutzeroberfläche im Spiel: HUD, Hinweise, Sprechblasen, Untertitel, Overlays.
import { clamp, fmtMoney } from '../util.js';
import { WEAPONS } from '../combat/weapons.js';
import { WEATHER_NAMES } from '../render/sky.js';
import { Minimap } from './minimap.js';
import { Panels } from './panels.js';
import { PadUI, PAD_CSS } from './padui.js';
import * as THREE from 'three';

// Waffensymbole für die Anzeige unten rechts (Silhouetten im Raster 64 × 32, Mündung nach rechts)
const DK = '#0b0f17';
const WEAPON_ICONS = {
  fists: `<path d="M18 14.5c0-2.5 2-4.5 4.5-4.5.9 0 1.8.3 2.5.8.7-1.6 2.3-2.8 4.2-2.8 1.6 0 3 .8 3.8 2.1.8-1.3 2.2-2.1 3.8-2.1 2.2 0 4 1.5 4.4 3.5.6-.3 1.3-.5 2-.5 2.5 0 4.5 2 4.5 4.5v6.3c0 5.3-4.3 8.7-9.6 8.7h-9.3C24.2 30.5 18 26 18 19.8z"/><path d="M29.2 10.5v7.2M36.8 10.5v7.2M43.2 13v6.2M20 21.5c5.2-1.6 10.4-1.4 15 .6" fill="none" stroke="${DK}" stroke-width="1.7" stroke-linecap="round"/>`,
  bat: `<path d="M8.5 29.8 6 27.3l3.5-3.6 27.3-17c4.4-2.7 10.2-4.8 15.4-4.6 1.9 0 3 1.3 2.6 3.1-.4 1.7-1.9 2.4-3.8 2.4-4.8.2-10.1 2.6-14 5.4L11.6 27.7z"/><circle cx="6.8" cy="28.6" r="2.6"/>`,
  pistol: `<path d="M9 9h42.5l1.5 1.5V15H45v2.5H33.5c-.3 3-2.4 5.2-5.6 5.2h-1.2L24 29H12.5l3.6-14H9z"/><path d="M27.4 17.6h3.9c-.2 1.8-1.4 3-3.3 3z" fill="${DK}"/><path d="M13 11.2h31" stroke="${DK}" stroke-width="1.2" opacity=".55"/>`,
  smg: `<path d="M3 11.5h9V13h5v-3h30v2h4v-1h7v3.5h-7v1.5h-4v2H38.5V30h-5.5V18H29l-2 8.5h-5.5l2-8.5H17v-2.5h-5V17H3z"/><path d="M19 12.4h25" stroke="${DK}" stroke-width="1.2" opacity=".55"/>`,
  shotgun: `<path d="M1.5 15.5 15 10.5h47v3H56v3.5H45v1.5h-9v-1.5h-4.5V19h-5.5l-2.2 3.5h-5.5l1.2-4.5-3.5.2L2.5 21.5z"/><path d="M36.5 14.2v4M40.5 14.2v4" stroke="${DK}" stroke-width="1.2" opacity=".6"/>`,
  rifle: `<path d="M2 10.5h13V12h11V9.5h3V8h12v1.5h4V12h7v1h9v2h-9v1.5h-8.5V15H36l3.2 9.5-5.2 1.6-3.4-10.6H29l-2.3 8H21.5l2.3-8H17l-4 3H2z"/><path d="M46.5 12.4v3.2M49.5 12.4v3.2" stroke="${DK}" stroke-width="1.1" opacity=".6"/>`,
  sniper: `<path d="M22 6.5h18v4.5h-2.5v1.5H63v2H35v2.5h-8.5l-2.2 6.5h-5.2l2.2-6.5H9l-7 4H.5V12H14v-1.5h12V11h-4z"/><circle cx="23.6" cy="8.75" r="1.2" fill="${DK}"/><path d="M53 15.5l-3 9M55 15.5l3 9" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>`,
  grenade: `<circle cx="30" cy="19.5" r="10"/><rect x="26" y="5" width="8" height="5.5" rx="1"/><path d="M34 7.5h6.5l3 6-2 1-2.5-5H34z"/><circle cx="22.5" cy="8.6" r="3.4" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M21 17h18M20.5 22h19M30 10.5v18.5" stroke="${DK}" stroke-width="1.4"/>`,
};
export const weaponIconSvg = (id) => `<svg viewBox="0 0 64 32" aria-hidden="true">${WEAPON_ICONS[id] || WEAPON_ICONS.fists}</svg>`;

const HELP_KB = 'WASD bewegen · Shift sprinten · Leertaste springen · F einsteigen · Rechte Maustaste zielen · Esc Pause · M Karte';
const HELP_PAD = 'LS rennen · A springen/klettern · Y einsteigen · LT/RT zielen/schießen · LB Waffenrad · ↑ Handy · View Karte · Menü Pause';

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
#gui .stars .on.six{color:#ff5a3d;text-shadow:0 0 12px #ff2a1a}
#gui .stars.flash .on{animation:starblink .45s steps(2) infinite}
@keyframes starblink{50%{color:#6aa5ff;text-shadow:0 0 12px #3a7bff}}
#gui .mapwrap{position:absolute;left:22px;bottom:22px;width:210px;height:210px}
#gui .mapwrap canvas{position:absolute;left:0;top:0;width:210px;height:210px;border-radius:22px;box-shadow:0 0 0 2px rgba(255,255,255,.88),0 0 0 6px rgba(9,18,28,.82),0 0 0 7px rgba(255,255,255,.16),0 8px 24px rgba(0,0,0,.6)}
#gui .hud-tl{position:absolute;left:24px;top:18px;display:flex;flex-direction:column;gap:10px;max-width:min(430px,44vw)}
#gui .vitals{display:flex;flex-direction:column;gap:6px;width:250px}
#gui .vrow{display:flex;align-items:center;gap:8px}
#gui .vrow svg{flex:0 0 16px;width:16px;height:16px;filter:drop-shadow(0 1px 2px #000)}
#gui .vbar{flex:1;height:10px;border-radius:6px;background:rgba(0,0,0,.55);overflow:hidden;box-shadow:0 0 0 1px rgba(255,255,255,.35),0 2px 6px rgba(0,0,0,.45)}
#gui .vbar i{display:block;height:100%;width:100%;border-radius:inherit}
#gui .vrow.hp i{background:linear-gradient(90deg,#d41c31,#ff5c5c);transition:width .25s}
#gui .vrow.hp svg{fill:#ff4d5e}
#gui .vrow.st i{background:linear-gradient(90deg,#16a046,#6cf08f)}
#gui .vrow.st svg{fill:#5fe38a}
#gui .vrow.ar i{background:linear-gradient(90deg,#2f6bff,#6ad1ff);transition:width .25s}
#gui .vrow.ar svg{fill:#6aa8ff}
#gui .vrow.st.tired .vbar,#gui .vrow.st.tired svg{animation:tired .55s steps(2) infinite}
#gui .vrow.vh i{background:linear-gradient(90deg,#e06a10,#ffa23a);transition:width .25s}
#gui .vrow.vh svg{fill:#ff9a2e}
#gui .vrow.fu i{background:linear-gradient(90deg,#c99a12,#ffd84a);transition:width .4s}
#gui .vrow.fu svg{fill:#ffd24a}
#gui .vrow.fu.low i{background:linear-gradient(90deg,#b81d1d,#ff5a3a)}
#gui .vrow.fu.low .vbar,#gui .vrow.fu.low svg{animation:tired .7s steps(2) infinite}
#gui .vrow.o2 i{background:linear-gradient(90deg,#1c8fd6,#7fdcff)}
#gui .vrow.o2 b{flex:0 0 16px;font-size:11px;font-weight:800;color:#7fdcff;text-shadow:0 1px 2px #000;letter-spacing:-.02em}
#gui .vrow.o2.low .vbar{animation:tired .5s steps(2) infinite}
#gui .vrow small{flex:0 0 34px;text-align:right;font-size:12px;font-weight:700;opacity:.9;text-shadow:0 1px 3px #000}
#gui .vrow.veh2{display:none}
@keyframes tired{50%{opacity:.18}}
#gui .compass{position:absolute;left:50%;top:8px;transform:translateX(-50%);width:min(660px,56vw);display:flex;flex-direction:column;align-items:center}
#gui .compass canvas{display:block;width:100%;height:40px}
#gui .qdist{display:none;align-items:center;gap:9px;margin-top:1px;font-size:22px;font-weight:800;letter-spacing:.02em;white-space:nowrap;text-shadow:0 2px 8px #000,0 0 3px #000}
#gui .qdist i{display:inline-block;width:11px;height:11px;transform:rotate(45deg);background:#ff5de6;box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 9px #ff5de6}
#gui .qdist.wp i{background:#d873f5;box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 9px #d873f5}
#gui .qdist small{font-size:14px;font-weight:600;opacity:.88}
#gui .place{position:absolute;left:250px;bottom:30px;font-size:15px;text-shadow:0 2px 6px #000;opacity:.95;line-height:1.35}
#gui .place b{font-size:19px;display:block}
#gui .hud-br{position:absolute;right:26px;bottom:26px;display:flex;flex-direction:column;align-items:flex-end;gap:12px}
#gui .weapon{display:flex;align-items:center;gap:13px;text-align:right;text-shadow:0 2px 8px #000}
#gui .weapon .wico{flex:0 0 auto;width:92px;height:50px;padding:5px 9px;border-radius:12px;background:linear-gradient(160deg,rgba(18,22,32,.78),rgba(8,10,16,.6));box-shadow:0 0 0 1px rgba(255,255,255,.24),0 6px 18px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center}
#gui .weapon .wico svg{width:100%;height:100%;fill:#fff;filter:drop-shadow(0 1px 2px rgba(0,0,0,.8))}
#gui .weapon .wn{font-size:17px;font-weight:700;opacity:.95}
#gui .weapon .am{font-size:30px;font-weight:800}
#gui .weapon .am:empty{display:none}
#gui .weapon .am small{font-size:17px;opacity:.7;font-weight:600}
#gui .call{display:none;align-items:center;gap:12px;padding:8px 16px 8px 9px;border-radius:999px;background:linear-gradient(100deg,rgba(10,40,22,.86),rgba(8,14,20,.78));box-shadow:0 0 0 1px rgba(110,240,150,.45),0 8px 22px rgba(0,0,0,.5);text-shadow:0 1px 4px #000}
#gui .call .ph{position:relative;flex:0 0 40px;width:40px;height:40px;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center;box-shadow:0 0 12px rgba(34,197,94,.7)}
#gui .call .ph::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid rgba(110,240,150,.8);animation:callring 1.4s ease-out infinite}
#gui .call .ph svg{width:22px;height:22px;fill:#fff;animation:callshake 1.4s ease-in-out infinite}
#gui .call .ci{display:flex;flex-direction:column;align-items:flex-end;line-height:1.15}
#gui .call .cw{font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8ff0b0}
#gui .call .ct{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:.02em}
@keyframes callring{0%{transform:scale(.9);opacity:1}100%{transform:scale(1.45);opacity:0}}
@keyframes callshake{0%,60%,100%{transform:rotate(0)}10%,30%,50%{transform:rotate(-12deg)}20%,40%{transform:rotate(12deg)}}
#gui .veh{text-align:right;text-shadow:0 2px 8px #000;display:none}
#gui .veh .sp{font-size:54px;font-weight:800;line-height:1}
#gui .veh .sp small{font-size:18px;opacity:.75;margin-left:4px}
#gui .veh .vn{font-size:15px;opacity:.85}
#gui .radio{font-size:16px;text-shadow:0 2px 6px #000;opacity:0;transition:opacity .4s;text-align:right}
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
#gui .notes{position:absolute;top:138px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:7px;width:min(560px,90vw)}
#gui .note{padding:8px 16px;border-radius:9px;background:rgba(10,10,20,.72);border-left:4px solid #fff;font-size:17px;animation:noteIn .25s;box-shadow:0 4px 14px rgba(0,0,0,.4)}
#gui .note.cash{border-color:#7dff8a;color:#c8ffd0}
#gui .note.good{border-color:#7dff8a}
#gui .note.warn{border-color:#ffb84a;color:#ffe3b0}
#gui .note.info{border-color:#6ad1ff}
#gui .note.mission{border-color:#ff5de6}
@keyframes noteIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
#gui .obj{text-shadow:0 2px 6px #000}
#gui .obj .t{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#ff9be9;font-weight:700}
#gui .obj .d{font-size:19px;font-weight:600;margin-top:2px}
#gui .obj .s{font-size:14px;opacity:.85;margin-top:3px}
#gui .sub{position:absolute;left:50%;bottom:74px;transform:translateX(-50%);max-width:min(900px,86vw);text-align:center;font-size:21px;line-height:1.35;text-shadow:0 2px 8px #000,0 0 3px #000;display:none}
#gui .sub b{color:#ffd46a}
#gui .bubbles{position:absolute;inset:0}
#gui .bub{position:absolute;transform:translate(-50%,-100%);padding:4px 10px;background:rgba(255,255,255,.92);color:#111;border-radius:12px;font-size:14px;font-weight:600;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.4)}
#gui .bub::after{content:"";position:absolute;left:50%;bottom:-6px;margin-left:-6px;border:6px solid transparent;border-bottom:0;border-top-color:rgba(255,255,255,.92)}
#gui .nametag{position:absolute;transform:translate(-50%,-100%);font-size:13px;text-shadow:0 1px 4px #000;white-space:nowrap}
#gui .mptags{position:absolute;inset:0}
#gui .mptag{position:absolute;transform:translate(-50%,-100%);padding:2px 11px 3px;border-radius:999px;background:rgba(8,14,24,.62);border:1px solid rgba(74,222,128,.75);font-size:13px;font-weight:700;white-space:nowrap;text-shadow:0 1px 3px #000;display:none}
#gui .mptag::before{content:"";display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:#4ade80;vertical-align:1px}
#gui .uw{position:absolute;inset:0;opacity:0;transition:opacity .25s;background:radial-gradient(ellipse at 50% 30%,rgba(40,140,170,.38),rgba(4,40,60,.82) 85%)}
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
#gui .help{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);white-space:nowrap;font-size:13px;opacity:.75;text-shadow:0 1px 4px #000;transition:opacity 1s}
#gui .panel{pointer-events:auto}
#gui .gmenu{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(8,5,20,.62);backdrop-filter:blur(8px);pointer-events:auto}
#gui .gmenu .box{width:min(560px,92%);max-height:min(88vh,calc(100% - 20px));overflow:auto;padding:26px 28px;background:rgba(20,12,40,.92);border:1px solid rgba(255,255,255,.22);border-radius:16px;box-shadow:0 20px 70px rgba(0,0,0,.6)}
#gui .gmenu.wide .box{width:min(980px,96%)}
#gui #pm .mb{margin:5px 0;padding:9px 16px;font-size:17px}
#gui #pm .mb small{font-size:12px;margin-top:0}
@media (max-height:780px){#gui #pm .mb{margin:4px 0;padding:6px 14px;font-size:16px}}
#gui .gmenu h2{margin:0 0 16px;font-size:26px;letter-spacing:.04em}
#gui .gmenu h3{margin:18px 0 8px;font-size:14px;letter-spacing:.14em;text-transform:uppercase;color:#ff9be9}
#gui .mb{display:block;width:100%;margin:8px 0;padding:13px 18px;text-align:left;font:inherit;font-size:18px;font-weight:600;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:10px;cursor:pointer;transition:background .15s,transform .15s}
#gui .mb:hover,#gui .mb:focus-visible{background:rgba(255,130,230,.22);transform:translateX(4px);outline:none}
#gui .mb small{display:block;font-weight:400;opacity:.7;font-size:13px;margin-top:2px}
#gui .mb[disabled]{opacity:.4;cursor:default}
#gui .mb.admin{background:linear-gradient(100deg,rgba(220,38,38,.42),rgba(150,20,20,.3));border:2px solid #ef4444;box-shadow:0 0 0 1px rgba(0,0,0,.35),0 0 16px rgba(239,68,68,.35)}
#gui .mb.admin:hover,#gui .mb.admin:focus-visible{background:linear-gradient(100deg,rgba(239,68,68,.6),rgba(185,28,28,.45))}
#gui .ahead{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin:0 0 16px}
#gui .ahead h2{margin:0}
#gui .abtn{flex:0 0 auto;padding:8px 18px;font:inherit;font-size:15px;font-weight:800;letter-spacing:.06em;color:#fff;background:#dc2626;border:1px solid #f87171;border-radius:9px;cursor:pointer;box-shadow:0 6px 18px rgba(220,38,38,.35)}
#gui .abtn:hover{background:#ef4444}
#gui .stat-head{display:flex;align-items:center;gap:16px;margin:0 0 18px;padding:16px 18px;border-radius:16px;background:radial-gradient(120% 140% at 0% 0%,rgba(255,107,214,.22),transparent 60%),rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12)}
#gui .stat-ava{flex:0 0 58px;width:58px;height:58px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:900;background:linear-gradient(160deg,#2a1650,#7a2c8f 55%,#ff8a3d)}
#gui .stat-who b{display:block;font-size:22px}
#gui .stat-who span{font-size:14px;opacity:.75}
#gui .stat-day{margin-left:auto;text-align:right}
#gui .stat-day b{display:block;font-size:30px;font-weight:900;line-height:1;background:linear-gradient(90deg,#ffb347,#ff6bd6);-webkit-background-clip:text;background-clip:text;color:transparent}
#gui .stat-day span{font-size:13px;opacity:.75}
#gui .stat-sec{margin:16px 0 8px;font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#ff9be9}
#gui .stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
#gui .stat-card{position:relative;padding:13px 14px 12px;border-radius:14px;background:linear-gradient(160deg,rgba(255,255,255,.09),rgba(255,255,255,.035));border:1px solid rgba(255,255,255,.12);overflow:hidden}
#gui .stat-card i{position:absolute;right:10px;top:10px;width:26px;height:26px;opacity:.35}
#gui .stat-card i svg{width:100%;height:100%;fill:#fff}
#gui .stat-card small{display:block;font-size:12px;letter-spacing:.04em;opacity:.72}
#gui .stat-card b{display:block;margin-top:4px;font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
#gui .stat-card.money b{color:#6ee7a8}
#gui .stat-card.accent b{color:#ffd46a}
#gui .stat-bar{height:8px;margin-top:8px;border-radius:5px;background:rgba(0,0,0,.35);overflow:hidden}
#gui .stat-bar em{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#22c55e,#8dffb0)}
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
#gui .mapfull{position:absolute;inset:0;display:none;background:#0e2a40;pointer-events:auto;overflow:hidden;font-family:"Bahnschrift","Barlow Condensed","Roboto Condensed","Avenir Next Condensed","Arial Narrow","Segoe UI",system-ui,sans-serif}
#gui .mapfull canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#gui .mapfull canvas.mapov{z-index:1;cursor:crosshair}
#gui .mapfull.in3d canvas.mapov{cursor:grab}
#gui .mapfull.inquests canvas{display:none}
#gui .mapshade{position:absolute;inset:0;z-index:1;pointer-events:none;background:radial-gradient(ellipse 34% 24% at 0 0,rgba(3,9,16,.66),transparent 100%),radial-gradient(ellipse 24% 20% at 100% 0,rgba(3,9,16,.55),transparent 100%),linear-gradient(transparent 84%,rgba(3,9,16,.4))}
#gui .mapbrand{position:absolute;left:clamp(12px,1.9vw,36px);top:clamp(10px,2.4vh,24px);z-index:3;display:flex;align-items:flex-end;gap:12px;pointer-events:none;filter:drop-shadow(0 2px 9px rgba(0,0,0,.6))}
#gui .mapbrand svg{width:clamp(46px,4.5vw,84px);height:auto;filter:drop-shadow(0 0 6px rgba(205,232,255,.6))}
#gui .mapbrand b{display:block;font-size:clamp(24px,2.8vw,52px);line-height:.96;font-weight:700;font-stretch:condensed;letter-spacing:.012em;text-transform:uppercase;white-space:nowrap;color:#f2f4f5}
#gui .mapbrand hr{height:2px;border:0;margin:6px -34px 5px 0;background:linear-gradient(90deg,rgba(255,255,255,.85),rgba(255,255,255,.4) 72%,transparent)}
#gui .mapbrand span{display:block;font-size:clamp(12px,1.15vw,21px);letter-spacing:.52em;text-transform:uppercase;white-space:nowrap;color:#e8ecef}
#gui .mapinfo{position:absolute;right:clamp(12px,1.4vw,28px);top:clamp(10px,2.4vh,24px);z-index:3;display:flex;align-items:center;gap:22px;text-shadow:0 2px 8px #000,0 0 3px #000}
#gui .mapinfo .mi{text-align:right;line-height:1.1;pointer-events:none}
#gui .mclock{font-size:30px;font-weight:700;letter-spacing:.01em}
#gui .mmoney{font-size:29px;font-weight:700;color:#5fdc80}
#gui .mcompass{width:70px;height:70px;cursor:pointer;filter:drop-shadow(0 4px 10px rgba(0,0,0,.55))}
#gui .mcompass svg{display:block;width:100%;height:100%}
#gui .maptop{position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:4;display:flex;gap:10px}
#gui .maptabs,#gui .mapmode{display:flex;gap:3px;padding:4px;border-radius:9px;background:rgba(9,18,28,.8);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);box-shadow:0 8px 26px rgba(0,0,0,.35)}
#gui .mtab,#gui .mm{padding:6px 20px;border-radius:6px;cursor:pointer;font-size:16px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:rgba(255,255,255,.76);transition:background .15s,color .15s}
#gui .mm{padding:6px 14px}
#gui .mtab:hover,#gui .mm:hover{background:rgba(255,255,255,.14);color:#fff}
#gui .mtab.on,#gui .mm.on{background:#f2f4f5;color:#0b1520}
#gui .mapctl{position:absolute;left:clamp(12px,1.9vw,36px);bottom:76px;z-index:4;display:flex;flex-direction:column;gap:6px}
#gui .mc{width:40px;height:40px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;border-radius:8px;background:rgba(9,18,28,.8);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);box-shadow:0 8px 26px rgba(0,0,0,.35);cursor:pointer;transition:background .15s;user-select:none}
#gui .mc:hover{background:rgba(255,255,255,.22)}
#gui .mapscale{position:absolute;left:clamp(18px,2.1vw,40px);bottom:20px;z-index:3;pointer-events:none;font-size:15px;text-shadow:0 1px 4px #000,0 0 3px #000}
#gui .mapscale .nums{position:relative;height:21px}
#gui .mapscale .nums span{position:absolute;top:0;transform:translateX(-50%);white-space:nowrap}
#gui .mapscale .nums span:nth-child(4){transform:translateX(-35%)}
#gui .mapscale .line{position:relative;height:9px;border-bottom:2px solid #fff}
#gui .mapscale .line i{position:absolute;bottom:0;width:2px;height:9px;margin-left:-1px;background:#fff}
#gui .maplegend{position:absolute;right:clamp(12px,1.4vw,28px);bottom:84px;z-index:3;display:none;padding:15px 20px 14px;border-radius:10px;background:rgba(10,19,29,.83);backdrop-filter:blur(9px);border:1px solid rgba(255,255,255,.13);box-shadow:0 10px 34px rgba(0,0,0,.42);font-size:16px;line-height:1.2;pointer-events:auto;max-height:calc(100% - 190px);overflow:hidden auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.3) transparent}
#gui .maplegend .lh{font-size:21px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;padding-bottom:9px;margin-bottom:11px;border-bottom:1px solid rgba(255,255,255,.32);cursor:pointer;user-select:none}
#gui .maplegend .lg{display:grid;grid-template-columns:repeat(2,auto);gap:8px 30px}
#gui .maplegend .li{display:flex;align-items:center;gap:13px;white-space:nowrap}
#gui .maplegend .sym{flex:0 0 28px;width:28px;height:28px}
#gui .maplegend .sym svg{display:block;width:100%;height:100%;font-family:inherit}
#gui .maplegend .lr{display:grid;grid-template-columns:repeat(2,auto);gap:9px 24px;margin-top:13px;padding-top:12px;border-top:1px solid rgba(255,255,255,.28)}
#gui .maplegend .lri{display:flex;align-items:center;gap:12px;white-space:nowrap}
#gui .maplegend .lri i{display:inline-block;width:40px;height:4px;border-radius:2px}
#gui .maplegend .lri i.dash{height:3px;border-radius:0;background:repeating-linear-gradient(90deg,#fff 0 7px,transparent 7px 11px)}
#gui .maplegend .ln{margin-top:10px;font-size:13px;opacity:.7}
@media (max-height:800px){#gui .maplegend{padding:11px 16px 10px;font-size:14px}#gui .maplegend .lh{font-size:17px;padding-bottom:6px;margin-bottom:8px}#gui .maplegend .lg{gap:5px 22px}#gui .maplegend .sym{flex-basis:22px;width:22px;height:22px}#gui .maplegend .li{gap:10px}#gui .maplegend .lr{margin-top:9px;padding-top:8px;gap:6px 20px}#gui .maplegend .ln{display:none}#gui .mclock{font-size:24px}#gui .mmoney{font-size:23px}#gui .mcompass{width:56px;height:56px}}
#gui .mapbar{position:absolute;right:clamp(12px,1.4vw,28px);bottom:16px;z-index:4;display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:7px 20px;max-width:calc(100% - 330px);padding:9px 18px;border-radius:8px;background:rgba(9,17,27,.85);backdrop-filter:blur(9px);border:1px solid rgba(255,255,255,.13);box-shadow:0 8px 26px rgba(0,0,0,.4);font-size:16px;font-weight:600}
#gui .mbi{display:flex;align-items:center;gap:7px;white-space:nowrap}
#gui .mbi[data-act]{cursor:pointer}
#gui .mbi[data-act]:hover{color:#ffd56b}
#gui .kc{display:inline-flex;align-items:center;justify-content:center;min-width:23px;height:23px;padding:0 6px;border-radius:4px;background:#f1f3f4;color:#101820;font-size:13px;font-weight:700}
#gui .pb{display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;border-radius:50%;color:#0a1016;font-size:14px;font-weight:800}
#gui .pb.a{background:#5cc85c}
#gui .pb.b{background:#ef4d52}
#gui .pb.x{background:#4b95ff}
#gui .pb.y{background:#f7c531}
@media (max-width:1500px){#gui .mapbar{font-size:14px;gap:6px 13px;padding:7px 12px}#gui .mbi{gap:5px}#gui .kc{min-width:20px;height:20px;padding:0 4px;font-size:11.5px}#gui .pb{width:20px;height:20px;font-size:12.5px}}
#gui .mapfull.inquests .mapbrand,#gui .mapfull.inquests .mapinfo,#gui .mapfull.inquests .mapctl,#gui .mapfull.inquests .mapscale,#gui .mapfull.inquests .mapshade,#gui .mapfull.inquests .mapmode{display:none}
#gui .mapfull.inquests::before{content:"";position:absolute;left:0;right:0;top:0;height:74px;z-index:3;pointer-events:none;background:linear-gradient(#0a1c36 62%,rgba(10,28,54,0))}
@media (max-width:1100px){#gui .mapfull:not(.inquests) .maptop{top:clamp(86px,13vh,112px)}}
#gui .questpanel{position:absolute;inset:0;z-index:2;display:none;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.35) transparent;padding:78px 16px 48px;background:radial-gradient(ellipse at top,#12356a 0%,#08162a 72%)}
#gui .qwrap{width:min(880px,100%);margin:0 auto}
#gui .qhead{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:8px}
#gui .qhead h2{margin:0;font-size:30px;letter-spacing:.05em}
#gui .qcount{font-size:16px;opacity:.88}
#gui .qbar{height:8px;border-radius:5px;background:rgba(255,255,255,.14);overflow:hidden;margin-bottom:16px}
#gui .qbar i{display:block;height:100%;background:linear-gradient(90deg,#22c55e,#8dffb0);transition:width .3s}
#gui .qrow{display:flex;gap:16px;align-items:flex-start;padding:14px 18px;margin:10px 0;border-radius:14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16)}
#gui .qnr{flex:0 0 40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;background:rgba(255,255,255,.16)}
#gui .qbody{flex:1;min-width:0}
#gui .qtitle{font-size:20px;font-weight:700;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
#gui .qbadge{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:2px 10px;border-radius:999px;background:rgba(255,255,255,.18)}
#gui .qmeta{font-size:14px;opacity:.8;margin-top:3px}
#gui .qdesc{font-size:15px;line-height:1.45;margin-top:7px;opacity:.93}
#gui .qobj{margin-top:8px;font-size:15px;color:#ffd6f5}
#gui .qlock{margin-top:8px;font-size:14px;opacity:.8}
#gui .qbtn{flex:0 0 auto;align-self:center;padding:8px 14px;font:inherit;font-size:14px;font-weight:700;color:#fff;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.32);border-radius:9px;cursor:pointer}
#gui .qbtn:hover{background:rgba(255,130,230,.32)}
#gui .qrow.done{background:linear-gradient(90deg,rgba(34,160,84,.62),rgba(34,160,84,.3));border-color:#4be08a}
#gui .qrow.done .qnr,#gui .qrow.done .qbadge{background:#22c55e;color:#04230f}
#gui .qrow.active{background:rgba(255,100,220,.18);border-color:#ff7de9}
#gui .qrow.active .qnr,#gui .qrow.active .qbadge{background:#ff5de6;color:#2a0524}
#gui .qrow.open{border-color:rgba(255,210,74,.65)}
#gui .qrow.open .qbadge{background:#ffd24a;color:#2e2400}
#gui .qrow.locked{opacity:.55}
#gui .sleepov{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:radial-gradient(ellipse at 50% 40%,#101a38,#02040a 70%);opacity:0;transition:opacity .7s ease;pointer-events:auto}
#gui .sleepov.on{opacity:1}
#gui .sleepov svg{width:74px;height:74px;fill:#ffe9a8;filter:drop-shadow(0 0 18px rgba(255,220,140,.55));animation:moonfloat 3s ease-in-out infinite}
#gui .sleepov h3{margin:6px 0 0;font-size:24px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.85}
#gui .sleepov .sc{font-size:64px;font-weight:900;font-variant-numeric:tabular-nums;letter-spacing:.03em;text-shadow:0 0 30px rgba(130,160,255,.4)}
#gui .sleepov .sd{font-size:17px;opacity:.75}
@keyframes moonfloat{50%{transform:translateY(-8px)}}
#gui .dlg{position:absolute;left:50%;bottom:60px;transform:translateX(-50%);width:min(820px,92vw);padding:16px 22px;background:rgba(10,8,24,.88);border:1px solid rgba(255,255,255,.25);border-radius:14px;display:none;pointer-events:auto}
#gui .dlg .who{font-weight:800;color:#ffd46a;margin-bottom:4px}
#gui .dlg .txt{font-size:20px;line-height:1.4}
#gui .dlg .go{margin-top:8px;font-size:13px;opacity:.7;text-align:right}
`;

export class UI {
  constructor(game, container) {
    this.game = game;
    const st = document.createElement('style');
    st.textContent = CSS + PAD_CSS;
    document.head.appendChild(st);
    this.style = st;
    const root = document.createElement('div');
    root.id = 'gui';
    root.innerHTML = `
      <div class="uw"></div>
      <div class="vig"></div>
      <div class="hud-tl"><div class="obj" style="display:none"><div class="t"></div><div class="d"></div><div class="s"></div></div><div class="vitals"><div class="vrow hp" title="Gesundheit"><svg viewBox="0 0 24 24"><path d="M12 21s-7.6-4.6-9.7-9.3C.9 8.3 3 4.4 6.8 4.4c2.1 0 3.6 1.1 4.4 2.4h1.6c.8-1.3 2.3-2.4 4.4-2.4 3.8 0 5.9 3.9 4.5 7.3C19.6 16.4 12 21 12 21z"/></svg><div class="vbar"><i></i></div></div><div class="vrow st" title="Ausdauer"><svg viewBox="0 0 24 24"><path d="M13.5 2 4 14h7l-1.5 8L19 10h-7z"/></svg><div class="vbar"><i></i></div></div><div class="vrow veh2 vh" title="Fahrzeugzustand"><svg viewBox="0 0 24 24"><path d="M5.5 10.5 7.3 6c.3-.9 1.1-1.5 2-1.5h5.4c.9 0 1.7.6 2 1.5l1.8 4.5c1 .2 1.8 1.1 1.8 2.2v4.1c0 .6-.4 1-1 1h-.8v1.4c0 .5-.4.9-.9.9h-1.5c-.5 0-.9-.4-.9-.9v-1.4H8.8v1.4c0 .5-.4.9-.9.9H6.4c-.5 0-.9-.4-.9-.9v-1.4h-.8c-.6 0-1-.4-1-1v-4.1c0-1.1.8-2 1.8-2.2zm2-.3h9L15 6.6c-.1-.3-.3-.4-.6-.4H9.6c-.3 0-.5.1-.6.4zM7 12.3a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zm10 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8z"/></svg><div class="vbar"><i></i></div><small></small></div><div class="vrow veh2 fu" title="Tank"><svg viewBox="0 0 24 24"><path d="M4 3.5c0-.8.7-1.5 1.5-1.5h7c.8 0 1.5.7 1.5 1.5V12h1c1.1 0 2 .9 2 2v3.5c0 .4.3.7.7.7s.7-.3.7-.7V9.4L16.7 7.6l1.2-1.2 2.5 2.5c.4.4.6.9.6 1.4v7.2c0 1.5-1.2 2.7-2.7 2.7s-2.7-1.2-2.7-2.7V14H14v6h1v2H3v-2h1zm2.2 1V9h5.6V4.5z"/></svg><div class="vbar"><i></i></div><small></small></div><div class="vrow o2" title="Sauerstoff" style="display:none"><b>O₂</b><div class="vbar"><i></i></div></div><div class="vrow ar" title="Schutzweste"><svg viewBox="0 0 24 24"><path d="M12 2 4 5.2v6c0 5.1 3.4 9.4 8 10.8 4.6-1.4 8-5.7 8-10.8v-6z"/></svg><div class="vbar"><i></i></div></div></div></div>
      <div class="compass"><canvas></canvas><div class="qdist"></div></div>
      <div class="hud-tr"><div class="clock"></div><div class="money">€0</div><div class="stars"></div></div>
      <div class="mapwrap"><canvas width="210" height="210"></canvas></div>
      <div class="place"><b></b><span></span></div>
      <div class="hud-br">
        <div class="radio"></div>
        <div class="call"><div class="ph"><svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z"/></svg></div><div class="ci"><span class="cw">Anruf</span><span class="ct">0:00</span></div></div>
        <div class="veh"><div class="sp">0<small>km/h</small></div><div class="vn"></div></div>
        <div class="weapon"><div class="wico"></div><div class="wtx"><div class="wn"></div><div class="am"></div></div></div>
      </div>
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
      <div class="mapfull"><canvas></canvas><div class="mapshade"></div><div class="questpanel"></div><div class="mapbrand"><svg viewBox="0 0 84 80" aria-hidden="true"><g fill="#04090e"><path d="M27 74C30 58 30 42 25 28l4.6-1.5C36 41 36 58 34 74z"/><path d="M27 27C20 18 11 17 3 24c9-2 16 0 23 6zM27 27C18 27 10 33 8 43c6-8 13-11 21-12zM27 27C24 16 16 9 6 10c9 3 14 9 18 19zM27 27C28 15 37 7 49 9c-9 3-14 9-18 20zM27 27c9-9 20-8 28 0-10-2-17-1-25 4zM27 27c10 0 17 7 18 17-5-7-11-11-20-13z"/><path d="M51 74c3-10 4-20 6-30l4 1c-2 11-3 20-2 29z"/><path d="M58 44c-5-7-13-8-20-4 8-1 13 1 19 7zM58 44c-8 1-13 6-14 14 4-6 9-8 17-9zM58 44c0-9 8-15 18-13-8 2-12 7-15 16zM58 44c8-5 17-3 22 6-7-4-13-4-20 1zM58 44c7 2 11 8 11 16-4-7-8-10-15-12zM58 44c-3-9-9-12-16-12 6 3 10 8 13 15z"/><circle cx="28" cy="30" r="4"/><circle cx="59" cy="47" r="3.2"/><path d="M8 77c12-6 24-5 32-3 10-3 24-3 36 3z"/></g></svg><div><b>Mallorca's</b><hr><span>Street Life</span></div></div><div class="mapinfo"><div class="mi"><div class="mclock">00:00</div><div class="mmoney">€0</div></div><div class="mcompass" title="Norden oben"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30.5" fill="rgba(8,14,22,.85)" stroke="rgba(255,255,255,.2)" stroke-width="1.5"/><g class="needle"><text x="32" y="17" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">N</text><path d="M32 20L45 51 32 44 19 51Z" fill="#fff"/></g></svg></div></div><div class="maptop"><div class="maptabs"><div class="mtab on" data-t="map">Karte</div><div class="mtab" data-t="quests">Quests</div></div><div class="mapmode"><div class="mm on" data-m="2d" title="Flache Karte (V)">2D</div><div class="mm" data-m="3d" title="Reliefkarte (V)">3D</div></div></div><div class="mapctl"><div class="mc" data-c="in" title="Hineinzoomen">+</div><div class="mc" data-c="out" title="Herauszoomen">−</div><div class="mc" data-c="me" title="Zu meiner Position">⌖</div></div><div class="mapscale"><div class="nums"><span style="left:0"></span><span style="left:25%"></span><span style="left:50%"></span><span style="left:100%"></span></div><div class="line"><i style="left:0"></i><i style="left:25%"></i><i style="left:50%"></i><i style="left:100%"></i></div></div><div class="maplegend"></div><div class="mapbar"></div></div>
      <div class="sleepov"><svg viewBox="0 0 24 24"><path d="M14.5 2.5a9.5 9.5 0 1 0 7 15.9A8 8 0 0 1 14.5 2.5z"/></svg><h3>Du schläfst …</h3><div class="sc">00:00</div><div class="sd"></div></div>
      <div class="gmenu"><div class="box"></div></div>
      <div class="fpsd"></div>
      <div class="help"></div>`;
    container.appendChild(root);
    this.root = root;
    const $ = (s) => root.querySelector(s);
    this.el = {
      vig: $('.vig'), uw: $('.uw'), obj: $('.obj'), clock: $('.clock'), money: $('.money'), stars: $('.stars'), mapCanvas: $('.mapwrap canvas'),
      hp: $('.vrow.hp i'), ar: $('.vrow.ar i'), arRow: $('.vrow.ar'), vhRow: $('.vrow.vh'), vh: $('.vrow.vh i'), vhTxt: $('.vrow.vh small'), fuRow: $('.vrow.fu'), fu: $('.vrow.fu i'), fuTxt: $('.vrow.fu small'), o2Row: $('.vrow.o2'), o2: $('.vrow.o2 i'), st: $('.vrow.st i'), stRow: $('.vrow.st'), compass: $('.compass canvas'), qdist: $('.qdist'), place: $('.place'), weapon: $('.weapon'), veh: $('.veh'), radio: $('.radio'),
      wico: $('.weapon .wico'), call: $('.call'), callWho: $('.call .cw'), callT: $('.call .ct'),
      cross: $('.cross'), dot: $('.dot'), prompt: $('.prompt'), notes: $('.notes'), sub: $('.sub'), bubbles: $('.bubbles'), banner: $('.banner'),
      arrest: $('.arrest'), over: $('.over'), dlg: $('.dlg'), mapfull: $('.mapfull'), menu: $('.gmenu'), fps: $('.fpsd'), help: $('.help'), lock: $('.lockhint'),
    };
    this.minimap = new Minimap(game, this.el.mapCanvas, this.el.mapfull);
    this.cctx = this.el.compass.getContext('2d');
    this._qdT = 0;
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
    this.el.help.innerHTML = HELP_KB;
    this.padui = new PadUI(game, this);
    this._padShown = false;
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

  // Ein Anruf ist eine Dialogzeile, deren Sprecher "(Anruf)" trägt (oder mit call: true). Die Spielfigur hält dann das Handy ans Ohr.
  // Während des Anrufs zeigt das HUD unten rechts (über der Waffe) ein Telefonsymbol mit der laufenden Gesprächsdauer.
  _setCall(on, who = '') {
    const p = this.game.player;
    if (on && !this._inCall) { this.game.audio?.phoneRing?.(); this._callStart = performance.now(); }
    this._inCall = on;
    if (on) {
      const name = String(who).replace(/\s*\(Anruf\)\s*/i, '').trim();
      if (name) this.el.callWho.textContent = 'Anruf · ' + name;
      else if (!this._callWhoSet) this.el.callWho.textContent = 'Anruf';
      this._callWhoSet = !!name || this._callWhoSet;
    } else this._callWhoSet = false;
    this.el.call.style.display = on ? 'flex' : 'none';
    if (p) p.anim.phone = on;
  }

  _nextLine() {
    const l = this.dialogQueue.shift();
    this._setCall(!!l && (!!l.call || /\(Anruf\)/.test(l.who || '')), l ? l.who : '');
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

  // Schwarzes Bild, das langsam aufblendet (Aufwachen nach dem Tod)
  fadeFromBlack(ms = 1500) {
    let f = this._fade;
    if (!f) { f = this._fade = document.createElement('div'); f.style.cssText = 'position:absolute;inset:0;background:#000;pointer-events:none;z-index:40'; this.root.appendChild(f); }
    f.style.transition = 'none'; f.style.opacity = '1';
    requestAnimationFrame(() => requestAnimationFrame(() => { f.style.transition = 'opacity ' + ms + 'ms ease-in'; f.style.opacity = '0'; }));
  }

  // Schlafen: Bild wird schwarz, die Uhr läuft von „from“ um dh Stunden vor; done() kommt bei schwarzem Bild
  sleepOverlay(from, dh, done) {
    const ov = this.root.querySelector('.sleepov'), sc = ov.querySelector('.sc'), sd = ov.querySelector('.sd');
    const day = (this.game.stats.days || 0) + 1, newDay = from + dh >= 24;
    const fmt = (h) => { h = ((h % 24) + 24) % 24; const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; };
    sd.textContent = newDay ? `Tag ${day} → Tag ${day + 1}` : `Tag ${day}`;
    sc.textContent = fmt(from);
    ov.style.display = 'flex';
    requestAnimationFrame(() => ov.classList.add('on'));
    const t0 = performance.now() + 700, RUN = 2600;
    const tick = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / RUN));
      const e = k * k * (3 - 2 * k);
      sc.textContent = fmt(from + dh * e);
      if (k < 1) { requestAnimationFrame(tick); return; }
      try { done && done(); } catch (err) { console.error(err); }
      setTimeout(() => { ov.classList.remove('on'); setTimeout(() => { ov.style.display = 'none'; }, 750); }, 450);
    };
    requestAnimationFrame(tick);
  }

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
    if (w >= 6 && up) this.notify('Fahndungsstufe 6! Die Polizei setzt alles ein', 'warn');
    else if (w > 0 && up) this.notify('Fahndung! Die Polizei ist hinter dir her', 'warn');
  }

  togglePause() { this.panels.togglePause(); }

  // Tastenhinweise passend zum zuletzt benutzten Eingabegerät
  _deviceChanged(pad) {
    this._padShown = pad;
    this.el.help.innerHTML = pad ? HELP_PAD : HELP_KB;
    if (pad && !this._padHelped) { this._padHelped = true; this.el.help.style.opacity = '1'; this.hintT = 12; }
    this.el.dlg.querySelector('.go').textContent = pad ? '[A] Weiter' : '[Leertaste] Weiter';
    this.minimap.refreshHints();
  }

  // ---------- Pro Frame ----------
  update(dt) {
    const g = this.game, p = g.player, el = this.el;
    const pad = g.input.device === 'pad';
    if (pad !== this._padShown) this._deviceChanged(pad);
    // Dialog weiter
    if (this.dialogOpen) {
      this.dialogLineT += dt;
      if (g.input.hit('Space') || g.input.hit('Enter') || g.input.mouseHit(0)) if (this.dialogLineT > 0.25) this._nextLine();
    }
    // Hinweis: Ohne Mausfang (Pointer-Lock) bewegt sich die Kamera nicht
    el.lock.style.display = (!pad && !g.input.locked && !g.paused && !this.panels.open && !this.dialogOpen && !this.minimap.full && g.controlsEnabled && p.alive) ? 'block' : 'none';
    // Menü-Eingaben
    const mapUi = this.minimap;
    if (mapUi.full) {
      // Vollbildkarte: Esc = zurück (ins Pause-Menü, falls von dort geöffnet), M = schließen, Tab/Q/E/Pfeile = zwischen Karte und Quests wechseln
      if (g.input.hit('Escape')) mapUi.close(true);
      else if (g.input.hit('KeyM')) mapUi.close(false);
      else if (mapUi.tab === 'map' && g.input.hit('KeyL')) mapUi.toggleLegend();
      else if (mapUi.tab === 'map' && (g.input.hit('KeyV') || g.input.hit('Digit2') || g.input.hit('Digit3'))) mapUi.setMode(g.input.hit('Digit2') ? '2d' : g.input.hit('Digit3') ? '3d' : (mapUi.mode === '2d' ? '3d' : '2d'));
      else if (g.input.hit('Tab') || g.input.hit('KeyQ') || g.input.hit('KeyE') || g.input.hit('ArrowLeft') || g.input.hit('ArrowRight')) mapUi.setTab(mapUi.tab === 'map' ? 'quests' : 'map');
    } else {
      if (g.input.hit('Escape') && !g.input.locked) this.panels.onEscape();
      if (g.input.hit('KeyM') && !this.panels.open) mapUi.open('map');
    }
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
    // Gesundheit, Ausdauer (blinkt, wenn erschöpft), Schutzweste (nur mit Weste)
    el.hp.style.width = clamp((p.hp / p.maxHp) * 100, 0, 100) + '%';
    el.ar.style.width = clamp(p.armor, 0, 100) + '%';
    el.arRow.style.display = p.armor > 0 ? 'flex' : 'none';
    el.st.style.width = clamp((p.stamina ?? 1) * 100, 0, 100) + '%';
    el.stRow.classList.toggle('tired', !!p.exhausted);
    // Fahrzeug: Zustand (orange) und Tank; Sauerstoff unter Wasser
    const cv = p.vehicle;
    el.vhRow.style.display = cv ? 'flex' : 'none';
    el.fuRow.style.display = cv && cv.usesFuel ? 'flex' : 'none';
    if (cv) {
      const hpPct = clamp(cv.hp / cv.maxHp, 0, 1);
      el.vh.style.width = hpPct * 100 + '%'; el.vhTxt.textContent = Math.round(hpPct * 100) + '%';
      if (cv.usesFuel) { el.fu.style.width = clamp(cv.fuel, 0, 1) * 100 + '%'; el.fuTxt.textContent = Math.round(cv.fuel * 100) + '%'; el.fuRow.classList.toggle('low', cv.fuel < 0.15); }
    }
    const o2 = p.o2 ?? 1;
    el.o2Row.style.display = o2 < 0.999 || p.diving ? 'flex' : 'none';
    el.o2.style.width = clamp(o2, 0, 1) * 100 + '%';
    el.o2Row.classList.toggle('low', o2 < 0.25);
    // Kompass und Entfernung zum Ziel
    this._compass(dt);
    // Sterne
    const w = g.police.wanted;
    if (w !== this._wShown || this._flashShown !== (g.police.evading)) {
      this._wShown = w; this._flashShown = g.police.evading;
      el.stars.innerHTML = [0, 1, 2, 3, 4, 5].map((i) => `<span class="${i < w ? 'on' : 'off'}${i === 5 ? ' six' : ''}">★</span>`).join('');
      el.stars.classList.toggle('flash', w > 0 && g.police.evading);
    }
    // Waffe: Symbol links neben Name und Munition
    const W = p.weapon;
    if (p.vehicle && !p.sidearm) el.weapon.style.display = 'none';
    else {
      el.weapon.style.display = 'flex';
      const wid = W ? W.id : 'fists';
      if (wid !== this._wIcon) { this._wIcon = wid; el.wico.innerHTML = weaponIconSvg(wid); }
      el.weapon.querySelector('.wn').textContent = W ? W.name : '';
      const ws = p.weapons[p.cur];
      el.weapon.querySelector('.am').innerHTML = W && W.mag ? `${ws ? ws.mag : 0}<small> / ${ws ? ws.reserve : 0}</small>` : (W && W.thrown ? `${ws ? ws.mag + ws.reserve : 0}` : '');
    }
    // Anruf: Gesprächsdauer (läuft auch, wenn das Spiel pausiert ist, wie ein echtes Telefonat)
    if (this._inCall) {
      const s = Math.max(0, Math.floor((performance.now() - (this._callStart || performance.now())) / 1000));
      el.callT.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    // Fahrzeug
    if (p.vehicle) {
      const v = p.vehicle;
      const sp = v.cls === 'boat' ? Math.abs(v.speed) * 1.94 : Math.abs(v.speed) * 3.6;
      el.veh.querySelector('.sp').innerHTML = `${Math.round(sp)}<small>${v.cls === 'boat' ? 'kn' : 'km/h'}</small>`;
      if (v.cls === 'plane') el.veh.querySelector('.vn').textContent = `${v.T.name} · Höhe ${Math.round(v.y - g.physics.groundHeight(v.x, v.z))} m · Gas ${Math.round(v.throttleAir * 100)}%`;
    }
    // Radio-Anzeige
    this.radioT -= dt;
    if (this.radioT <= 0) el.radio.classList.remove('show');
    // Fadenkreuz
    const aim = p.alive && (p.vehicle ? !!p.sidearm : p.aiming);
    el.cross.style.display = aim ? 'block' : 'none';
    el.dot.style.display = !aim && !p.vehicle && p.alive && p.weapon && !p.weapon.melee ? 'block' : 'none';
    el.cross.classList.toggle('hit', !!p.aimTarget);
    // Hinweis-Prompt
    el.prompt.style.display = 'none';
    if (p.alive && !g.paused && (g.controlsEnabled || g.services?.refuel)) {
      let txt = null;
      const use = pad ? 'Y' : 'F';
      if (p.vehicle) {
        const v = p.vehicle;
        txt = `<kbd>${use}</kbd>Aussteigen`;
        if (v.cls === 'plane') txt += ` &nbsp; <kbd>${pad ? 'RT' : 'Shift'}</kbd>Gas`;
      } else if (pad && g.combat.incoming(p)) txt = '<kbd>A</kbd>Kontern';
      else {
        const sp = g.services?.prompt(p, pad);
        const m = sp ? null : g.markers.interactable(p);
        if (sp) txt = sp;
        else if (m) txt = `<kbd>${use}</kbd>${m.hint || 'Interagieren'}`;
        else {
          const v = g.vehicles.nearest(p.x, p.z, 3.7, (q) => q.alive && !q.exploded && q.burning <= 0 && !(q.driver && q.driver.isPlayer));
          if (v) txt = `<kbd>${use}</kbd>${v.driver ? 'Fahrer rausziehen' : 'Einsteigen'} · ${v.T.name}`;
        }
      }
      if (txt) { el.prompt.innerHTML = txt; el.prompt.style.display = 'block'; }
    }
    // Untertitel
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) el.sub.style.display = 'none'; }
    // Region
    this.regionT -= dt;
    if (this._frameCount++ % 20 === 0) this._region();
    // Unter Wasser: bläulicher Schleier, sobald die Kamera eintaucht
    const cp = g.camera.position;
    el.uw.style.opacity = cp.y < g.physics.waterSurface(cp.x, cp.z) - 0.12 && g.physics.groundHeight(cp.x, cp.z) < cp.y ? '1' : '0';
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
    el.help.style.visibility = (this.minimap.full || this.panels.open || g.sleeping) ? 'hidden' : 'visible';   // Hinweiszeile nicht über Karte/Menüs/Schlaf
  }
  _frameCount = 0;

  // Kompassleiste: Himmelsrichtungen um die Blickrichtung (180° sichtbar), Ziel als Raute bzw. Pfeil am Rand.
  // Darunter die Entfernung zum Ziel – entlang der Route, sonst Luftlinie; unter 1 km in Metern.
  _compass(dt) {
    const g = this.game, p = g.player, cv = this.el.compass, c = this.cctx;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = cv.clientWidth || 600, H = cv.clientHeight || 40;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const SPAN = 180, ppd = W / SPAN, mid = W / 2, cy = H / 2 + 1;
    const head = (((180 - (p.camYaw * 180) / Math.PI) % 360) + 360) % 360;      // 0 = Norden, 90 = Osten
    const band = c.createLinearGradient(0, 0, W, 0);
    band.addColorStop(0, 'rgba(6,12,20,0)'); band.addColorStop(0.14, 'rgba(6,12,20,.52)'); band.addColorStop(0.86, 'rgba(6,12,20,.52)'); band.addColorStop(1, 'rgba(6,12,20,0)');
    c.fillStyle = band; c.fillRect(0, 7, W, H - 12);
    const line = c.createLinearGradient(0, 0, W, 0);
    line.addColorStop(0, 'rgba(255,255,255,0)'); line.addColorStop(0.18, 'rgba(255,255,255,.75)'); line.addColorStop(0.82, 'rgba(255,255,255,.75)'); line.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = line; c.fillRect(0, H - 6, W, 1.5);
    const NAMES = { 0: 'N', 45: 'NO', 90: 'O', 135: 'SO', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = 'rgba(0,0,0,.85)'; c.shadowBlur = 4;
    for (let d = Math.floor((head - SPAN / 2) / 5) * 5; d <= head + SPAN / 2; d += 5) {
      const x = mid + (d - head) * ppd;
      const fade = 1 - Math.pow(Math.abs(x - mid) / mid, 2.4);
      if (fade <= 0) continue;
      const n = ((d % 360) + 360) % 360;
      c.globalAlpha = fade;
      if (NAMES[n] !== undefined) {
        const main = n % 90 === 0;
        c.fillStyle = n === 0 ? '#ff6b6b' : '#fff';
        c.font = `${main ? 800 : 700} ${main ? 19 : 13}px "Segoe UI", system-ui, sans-serif`;
        c.fillText(NAMES[n], x, cy);
      } else if (n % 15 === 0) { c.fillStyle = 'rgba(255,255,255,.9)'; c.fillRect(x - 0.8, cy - 5, 1.6, 10); }
      else { c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(x - 0.6, cy - 2, 1.2, 4); }
    }
    c.globalAlpha = 1;
    // Blickrichtung
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(mid - 6, 1); c.lineTo(mid + 6, 1); c.lineTo(mid, 8); c.closePath(); c.fill();
    c.shadowBlur = 0;
    // Ziel
    const qt = this.minimap.questTarget();
    const px = p.vehicle ? p.vehicle.x : p.x, pz = p.vehicle ? p.vehicle.z : p.z;
    if (qt) {
      const tb = ((Math.atan2(qt.x - px, -(qt.z - pz)) * 180) / Math.PI + 360) % 360;
      const rel = ((tb - head + 540) % 360) - 180;
      const col = qt.kind === 'quest' ? '#ff5de6' : '#d873f5';
      c.fillStyle = col; c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = 2;
      c.shadowColor = col; c.shadowBlur = 8;
      if (Math.abs(rel) <= SPAN / 2 - 8) {
        const x = mid + rel * ppd;
        c.beginPath(); c.moveTo(x, cy - 9); c.lineTo(x + 7, cy); c.lineTo(x, cy + 9); c.lineTo(x - 7, cy); c.closePath(); c.stroke(); c.fill();
      } else {
        const sg = rel < 0 ? -1 : 1, x = sg < 0 ? 16 : W - 16;
        c.beginPath(); c.moveTo(x + sg * 8, cy); c.lineTo(x - sg * 4, cy - 8); c.lineTo(x - sg * 4, cy + 8); c.closePath(); c.stroke(); c.fill();
      }
      c.shadowBlur = 0;
    }
    // Entfernung (5× pro Sekunde)
    this._qdT -= dt;
    if (this._qdT > 0) return;
    this._qdT = 0.2;
    const q = this.el.qdist;
    if (!qt) { q.style.display = 'none'; return; }
    const dist = this.minimap.questDistance(qt, px, pz);
    const txt = dist < 999.5 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1).replace('.', ',')} km`;
    q.innerHTML = `<i></i>${txt}<small>${qt.kind === 'quest' ? 'bis zur Quest' : 'bis zum Wegpunkt'}</small>`;
    q.classList.toggle('wp', qt.kind !== 'quest');
    q.style.display = 'flex';
  }

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
