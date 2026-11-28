// Einstieg des Spiels "Mallorca's: Street Life".
import * as THREE from 'three';
import { Engine } from './render/engine.js';
import { Atmosphere } from './render/sky.js';
import { Sea } from './render/water.js';
import { Materials } from './render/materials.js';
import { ChunkManager } from './render/chunks.js';
import { PropSystem } from './render/props.js';
import { DetailBuilder, buildSkyline } from './render/detail.js';
import { buildWorldData } from './world/worldgen.js';
import { Game } from './game.js';
import { UI } from './ui/ui.js';
import { AudioSystem } from './audio/audio.js';
import { loadSettings } from './ui/panels.js';
import { EnemyManager } from './ai/enemies.js';
import { MissionManager } from './story/missions.js';
import { Shops } from './story/shops.js';
import { buildSatelliteData } from './ui/satellite.js';
import { Underwater } from './render/underwater.js';
import { Multiplayer } from './net/multiplayer.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const frame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 120); });

async function warmUp(game, engine, progress) {
  const R = engine.renderer;
  progress(0.95, 'Grafik vorbereiten …'); await tick();
  game.update(1 / 60);                                   // Figuren und Fahrzeuge bekommen ihre Modelle
  const seen = new Set();
  engine.scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) for (const k in m) { const t = m[k]; if (t && t.isTexture && !seen.has(t)) { seen.add(t); try { R.initTexture(t); } catch { /* z. B. Render-Ziele */ } } }
  });
  progress(0.96, 'Shader übersetzen …'); await tick();
  try { await Promise.race([R.compileAsync(engine.scene, engine.camera), new Promise((r) => setTimeout(r, 20000))]); } catch (e) { console.warn('Shader-Vorbereitung:', e); }
  for (let i = 0; i < 10; i++) {
    game.update(1 / 60); game.render(1 / 60);
    progress(0.97 + i * 0.0025, 'Letzter Feinschliff …');
    await frame();
  }
}

export async function startGame(container, opts = {}) {
  const progress = opts.onProgress || (() => {});
  progress(0.01, 'Weltdaten erzeugen …');
  const ctx = await buildWorldData((p, m) => progress(p * 0.55, m));
  progress(0.56, 'Satellitenbild der Inseln …'); await tick();
  ctx.satData = await buildSatelliteData(ctx, tick);   // Grundlage für Karte und Minikarte
  progress(0.58, 'Grafik vorbereiten …'); await tick();
  const gfx = loadSettings();
  const engine = new Engine(container, opts.quality || 'high', { resolution: gfx.resolution, shadows: gfx.shadows !== false });
  const atm = new Atmosphere(engine.renderer, engine.scene, engine.camera, { hour: opts.hour ?? 10.5, weather: opts.weather || 'sunny', shadowSize: engine.q.shadow || 1024, shadowRange: engine.q.shadowRange });
  atm.sun.castShadow = engine.shadowsOn;
  const mats = new Materials(ctx.signs);
  const sea = new Sea(engine.scene, ctx.coast, atm);
  const props = new PropSystem(engine.scene, mats);
  const detail = new DetailBuilder(ctx, mats, props, null);
  detail.density = engine.q.detail >= 1 ? 1 : engine.q.detail;
  const chunks = new ChunkManager(engine, ctx, mats, detail);
  detail.cm = chunks;
  engine.scene.add(buildSkyline(ctx, mats));
  progress(0.62, 'Spiel zusammensetzen …'); await tick();

  const game = new Game({ engine, atm, sea, chunks, ctx, mats, props }, opts);
  game.THREE = THREE;
  game.isAdmin = ['Admin', 'Sysadmin'].includes(opts.rank);
  game.rank = opts.rank || 'Spieler';
  game.userName = opts.userName || 'Spieler';
  window.__game = game;

  // Start-Position und Gelände laden (Multiplayer: am Hafen von Palma)
  const start = opts.start || (opts.mp ? game.mpStartPosition(opts.mp.you?.id || 0) : game.startPosition());
  engine.camera.position.set(start.x, 40, start.z);
  chunks.update({ x: start.x, z: start.z });
  const total = chunks.queue.length;
  let guard = 0;
  while (chunks.busy && guard++ < 5000) {
    chunks.step(28);
    progress(0.62 + 0.3 * (1 - chunks.queue.length / Math.max(1, total)), 'Gelände und Gebäude aufbauen …');
    await tick();
    if (chunks.queue.length === 0 && !chunks.current) break;
  }
  // Physik-Kollider der bereits geladenen Details
  for (const c of chunks.chunks.values()) if (c.detail) game.physics.addColliders(c.detail.colliders);
  props.setNear(chunks.nearKeys(engine.camera.position, 300)); props.rebuild();

  progress(0.94, 'Figuren und Fahrzeuge …'); await tick();
  game.createPlayer(opts.who || 'jason', start);
  // Neues Spiel: ohne Waffe – die Pistole liegt im Tresor des Strandhauses. Im Multiplayer (Start am Hafen) und ohne Haus gibt es sie sofort
  if (opts.mp || !ctx.home) { game.player.giveWeapon('pistol', 60); game.player.setWeapon('pistol'); }
  game.player.money = game.money;
  game.ui = new UI(game, container);
  const set = loadSettings();
  game.audio = new AudioSystem(game, set);
  if (!opts.quality && set.quality && set.quality !== engine.qualityKey) { /* Qualität wird beim nächsten Start übernommen */ }
  game.enemies = new EnemyManager(game);
  game.missions = new MissionManager(game);
  game.shops = new Shops(game);
  game.under = new Underwater(game);           // Muscheln, Wasserpflanzen und Fische im Meer
  // Neues Spiel am Strandhaus: ein Kleinwagen steht in der Garage (der erste Auftrag verlangt ein Fahrzeug)
  if (!opts.mp && !(opts.save && opts.save.save) && !opts.start && game.ctx.home && !game.owned.vehicles.length) {
    game.owned.vehicles.push({ type: 'compact', paint: 0 });
    game.shops.spawnOwned(0);
  }
  if (opts.save && opts.save.save) { game.restore(opts.save.save); game.home.fillGarage(); }   // eigene Autos stehen in der Garage
  if (opts.setup) await opts.setup(game, start);
  // Welt beleben
  game.player.updateCamera(0);
  for (let i = 0; i < game.traffic.target; i++) game.traffic.spawnCar(start.x, start.z, 40, 260);
  for (let i = 0; i < game.traffic.targetParked; i++) game.traffic.spawnParked(start.x, start.z);
  for (let i = 0; i < game.peds.target; i++) game.peds.spawnNear(start.x, start.z, 12, 150);
  game.animals?.populate(start.x, start.z);

  // Kein Ruckeln nach dem Start: Shader übersetzen, Texturen hochladen und einige Bilder vorab zeichnen – alles noch
  // unter dem Ladebildschirm (sonst übersetzt der Grafiktreiber die Shader erst beim ersten sichtbaren Bild)
  await warmUp(game, engine, progress);

  // Schleife
  let last = performance.now(), frames = 0, acc = 0;
  game.fps = 60;
  const loop = (now) => {
    if (game.stopped) return;
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));   // der erste Zeitstempel kann vor „last“ liegen
    last = now;
    try {
      game.update(dt);
      game.render(dt);
    } catch (e) { console.error('Frame-Fehler:', e); if (!game._errShown) { game._errShown = true; game.ui?.notify('Fehler: ' + e.message, 'warn'); } }
    frames++; acc += dt;
    if (acc > 1) { game.fps = frames / acc; frames = 0; acc = 0; }
    game.raf = requestAnimationFrame(loop);
  };
  game.start = () => { last = performance.now(); game.raf = requestAnimationFrame(loop); };
  game.stop = () => { game.stopped = true; cancelAnimationFrame(game.raf); };
  progress(1, 'Los geht’s!');
  game.start();
  if (!opts.noMissions && !opts.mp) game.missions.begin();
  if (!opts.mp && ctx.home && !game.owned.safeTaken && !game.player.weapons.pistol) setTimeout(() => game.ui?.notify('Deine Pistole liegt im Tresor im Schlafzimmer – öffne ihn mit F', 'info', 8000), 6000);
  // Multiplayer: Verbindung zum Server (Mitspieler, Serverzeit)
  if (opts.mp) { game.net = new Multiplayer(game, opts.mp); game.ui.notify(`${game.net.serverName}: ${game.net.countText()} Spielern`, 'info', 5000); }
  return game;
}
