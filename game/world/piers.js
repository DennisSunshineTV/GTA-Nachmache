// Bootsstege (reine Weltdaten): vom Ufer aus begehbar machen und Liegeplätze für Boote bestimmen.
// Ein Steg ist eine Plattform { x, z, w (Länge), d (Breite), rot, top }; seine lokale x-Achse zeigt seewärts.
import { clamp } from '../util.js';

const axis = (p) => [Math.cos(p.rot), -Math.sin(p.rot)];

// Läuft, wenn alle Straßen liegen: Jeder Steg beginnt erst hinter der Straße (keine Stufe in der Fahrbahn) und liegt so
// niedrig, dass man ihn vom Ufer aus betreten kann (Stufen bis 0,7 m werden einfach hochgegangen).
export function fitPiers(ctx) {
  for (const p of ctx.platforms) {
    const [ax, az] = axis(p);
    // Punkt auf der Mittellinie, t Meter vom Landende
    const at = (t) => [p.x + ax * (t - p.w / 2), p.z + az * (t - p.w / 2)];
    const onRoad = (t) => { const [x, z] = at(t); return [-0.5, 0, 0.5].some((s) => ctx.net.covers(x - az * s * p.d, z + ax * s * p.d, 0.1)); };
    const move = (m) => { p.x += (ax * m) / 2; p.z += (az * m) / 2; p.w -= m; };   // Landende um m seewärts schieben
    let cut = 0;
    for (let t = 0; t <= p.w - 12; t += 0.5) if (onRoad(t)) cut = t + 0.6;
    move(cut);
    p.top = clamp(ctx.hf.h(...at(0)) + 0.45, 0.55, 1.15);
    // Liegt das Landende in einer Senke, reicht der Steg weiter ans Ufer – an eine Straße nur, wenn dort höchstens eine
    // flache Kante (0,25 m) entsteht. Das Geländenetz ist grob (4 m), deshalb zählt auch der Boden knapp seewärts.
    const low = () => Math.min(ctx.hf.h(...at(0)), ctx.hf.h(...at(2.5))) < p.top - 0.65;
    const flush = () => !onRoad(-0.5) || p.top - (ctx.net.nearest(...at(-0.5), 20)?.y ?? 0) <= 0.25;
    for (let k = 0; k < 16 && low() && flush(); k++) move(-0.5);
  }
}

// Soll ein Boot auf oder dicht an einem Steg erscheinen, bekommt es einen Platz im freien Wasser hinter der Stegspitze.
// halfLen: halbe Bootslänge, taken(x, z): Platz schon belegt? Liefert { x, z, h } oder null (kein Steg in der Nähe).
export function pierBerth(ctx, x, z, halfLen, taken = () => false) {
  for (const p of ctx.platforms) {
    const [ax, az] = axis(p), dx = x - p.x, dz = z - p.z;
    const along = dx * ax + dz * az, side = dz * ax - dx * az;
    if (Math.abs(along) > p.w / 2 + halfLen + 1 || Math.abs(side) > p.d / 2 + halfLen) continue;
    const out = p.w / 2 + halfLen + 1;
    const spot = (k) => ({ x: p.x + ax * out - az * k * 4.5, z: p.z + az * out + ax * k * 4.5, h: Math.atan2(ax, az) });
    return [0, 1, -1, 2, -2].map(spot).find((s) => !taken(s.x, s.z)) || spot(0);
  }
  return null;
}
