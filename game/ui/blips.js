// Symbole (Blips) auf Karte und Minikarte. Eine Quelle für das Zeichnen, die Missions-/Shop-Marker und die Kartenlegende,
// damit die Legende immer zu dem passt, was tatsächlich auf der Karte erscheint.
import { MAP_FONT } from './mapstyle.js';

// Piktogramme als SVG-Pfade im Feld 24×24 (Füllregel "evenodd"). Kurze Zeichen wie "M" oder "$" werden als Text gezeichnet.
export const ICON_PATHS = {
  car: 'M6.3 5.7C6.7 4.7 7.6 4 8.6 4h6.8c1 0 1.9.7 2.3 1.7L19.2 10h.6c.8 0 1.4.6 1.4 1.4v6.4c0 .3-.2.5-.5.5h-.5v1.2c0 .6-.4 1-1 1h-1.6c-.6 0-1-.4-1-1v-1.2H7.400v1.2c0 .6-.4 1-1 1H4.800c-.6 0-1-.4-1-1v-1.200h-.5c-.3 0-.5-.2-.5-.5v-6.400c0-.8.6-1.4 1.4-1.4h.6zM6.900 10h10.200l-1.3-3.5c-.1-.3-.3-.5-.6-.5H8.800c-.3 0-.5.2-.6.5zM6.600 12.300a1.600 1.600 0 1 0 0 3.200a1.600 1.600 0 1 0 0-3.200zM17.400 12.300a1.600 1.600 0 1 0 0 3.200a1.600 1.600 0 1 0 0-3.200z',
  anchor: 'M12 1.8a3.2 3.2 0 0 1 1.2 6.2v1.500h3v2.300h-3v7.700c2.500-.4 4.500-2.100 5.300-4.300l-1.700.6L19.5 11.600L22.200 16l-1.500-.3C19.700 19.6 16.200 22.2 12 22.2S4.300 19.6 3.3 15.700L1.8 16l2.700-4.400l2.7 4.200l-1.7-.6c.8 2.200 2.800 3.900 5.3 4.300v-7.700h-3V9.5h3V8A3.2 3.2 0 0 1 12 1.8zM12 3.9a1.1 1.1 0 1 0 0 2.2a1.1 1.1 0 1 0 0-2.2z',
  plane: 'M21.8 15.8v-2.2l-8.3-5V3.300C13.500 2.300 12.800 1.500 12 1.500s-1.500.8-1.500 1.8v5.300l-8.300 5v2.200l8.3-2.600v5.4l-2.2 1.6v1.8L12 20.900l3.700 1.1v-1.800l-2.2-1.6v-5.400z',
  home: 'M12 2.500L22.500 12H19.5v9.500h-5.200v-6.200H9.700v6.2H4.5V12h-3z',
  cross: 'M8.800 3h6.4v5.800H21v6.400h-5.8V21H8.800v-5.8H3V8.800h5.8z',
  star: 'M12 1.8l3 6.600l7.200.8l-5.400 4.8l1.5 7.100L12 17.500l-6.3 3.600l1.500-7.1L1.8 9.2L9 8.400z',
  gem: 'M12 2L22 12L12 22L2 12z',
  cocktail: 'M2.500 3h19v1.800l-8.2 8.500v5.600h4.4v2.3H6.3v-2.3h4.4v-5.600L2.500 4.8zM6.8 5.400l2.300 2.4h5.8l2.3-2.4z',
  drink: 'M4.500 4h12v3H18a3.5 3.5 0 0 1 3.5 3.5v3A3.500 3.500 0 0 1 18 17h-1.500v2c0 1.100-.9 2-2 2h-8c-1.100 0-2-.9-2-2zM16.500 9.4v5.200H18c.6 0 1.100-.5 1.100-1.1v-3c0-.6-.5-1.1-1.1-1.1zM7.300 8.300v9.400h2V8.300zM11.700 8.3v9.400h2V8.300z',
  flag: 'M5 2.2h2.300v1.3h12.7l-3 4.7l3 4.700H7.300V22H5z',
  exclaim: 'M9.5 2.500h5l-.9 12.500h-3.200zM12 16.800a2.500 2.500 0 1 0 0 5a2.500 2.500 0 1 0 0-5z',
  skull: 'M12 2c-5.200 0-9 3.500-9 8.300c0 2.700 1.200 4.8 3.2 6.1v3.900c0 .6.4 1 1 1h1.600v-2.500h2v2.5h2.400v-2.5h2v2.500h1.6c.6 0 1-.4 1-1v-3.900c2-1.3 3.2-3.4 3.2-6.1C21 5.5 17.200 2 12 2zM8.200 9a2.300 2.300 0 1 0 0 4.600a2.300 2.300 0 1 0 0-4.6zM15.800 9a2.300 2.300 0 1 0 0 4.600a2.300 2.300 0 1 0 0-4.600zM12 13.5l1.5 3.100h-3z',
  heli: 'M2 3.500h19v2h-8.500v2.100c4.300.2 7.700 3.1 7.700 6.700c0 1.600-1.3 2.900-2.9 2.9H15.200l1 2.2H19v2H5.500v-2h2.700l1-2.4c-2.5-.8-4.4-2.700-5-5.1L1.500 11l1-2l2.9 1.9c1.1-1.900 3.2-3.100 5.600-3.300V5.500H2z',
  fuel: 'M4 3.5C4 2.7 4.7 2 5.5 2h7c.8 0 1.5.7 1.5 1.5V12h1c1.1 0 2 .9 2 2v3.5c0 .4.3.7.7.7s.7-.3.7-.7V9.4L16.7 7.6l1.2-1.2l2.5 2.5c.4.4.6.9.6 1.4v7.2c0 1.5-1.2 2.7-2.7 2.7s-2.7-1.2-2.7-2.7V14H14v6h1v2H3v-2h1zM6.2 4.5V9h5.6V4.5z',
  food: 'M6 2h1.6v6.2h1.3V2h1.6v6.2h1.3V2h1.6v7.4c0 1.5-1 2.6-2.4 3V22H8.500v-9.600C7 12 6 10.900 6 9.400zM16.800 2C19 2 20.200 4.700 20.200 8.600c0 2.600-.8 4.300-2.300 4.900V22H15.300V2.300c.5-.2 1-.3 1.500-.3z',
  wrench: 'M21.3 6.2l-3.4 3.4l-2.8-.7l-.7-2.8l3.4-3.4C15.6 1.9 12.9 2.6 11.6 4.3C10.5 5.7 10.3 7.5 10.9 9.1L2.7 17.3a2.3 2.3 0 0 0 3.3 3.3l8.2-8.2c1.6.6 3.4.4 4.8-.7C20.7 10.4 21.4 7.7 21.3 6.2zM4.6 19.7a1.1 1.1 0 1 1 0-2.2a1.1 1.1 0 0 1 0 2.2z',
};

// Marker aus Missionen, Shops und Wegpunkt
export const BLIP = {
  waypoint: { icon: 'flag', color: '#d873f5', label: 'Wegpunkt' },
  quest: { icon: 'M', color: '#c985ff', label: 'Quest-Start' },
  target: { icon: 'exclaim', color: '#ffc633', label: 'Missionsziel' },
  vehicle: { icon: 'car', color: '#62c8f5', label: 'Fahrzeug' },
  enemy: { icon: 'skull', color: '#ff5353', label: 'Gegner' },
  house: { icon: 'H', color: '#6ee28f', label: 'Mein Haus (Home)' },
  home: { icon: 'home', color: '#6ee28f', label: 'Immobilien' },
};

// Orte der Welt. minScale: ab welchem Zoom (Bildpunkte pro Meter) das Symbol auf der Vollbildkarte erscheint,
// damit die Karte lesbar bleibt (Läden und Lokale liegen in den Städten dicht beieinander).
export const POI_ICONS = {
  bank: { icon: '$', color: '#6ee28f', label: 'Bank', minScale: 0.16 },
  jewelry: { icon: 'gem', color: '#b995ff', label: 'Juwelier', minScale: 0.16 },
  gunshop: { icon: 'star', color: '#ffc633', label: 'Waffenladen', minScale: 0.16 },
  carshop: { icon: 'car', color: '#62c8f5', label: 'Autohaus', minScale: 0.16 },
  police: { icon: 'P', color: '#5a94ff', label: 'Polizei', minScale: 0.16 },
  clinic: { icon: 'cross', color: '#ff5b66', label: 'Klinik', minScale: 0.16 },
  harbor: { icon: 'anchor', color: '#62c8f5', label: 'Hafen', minScale: 0.032 },
  airport: { icon: 'plane', color: '#ffffff', label: 'Flughafen', minScale: 0, square: true },
  club: { icon: 'cocktail', color: '#ff72d2', label: 'Nachtclub', minScale: 0.22 },
  bar: { icon: 'drink', color: '#ffc633', label: 'Bar', minScale: 0.22 },
  fuel: { icon: 'fuel', color: '#ffb340', label: 'Tankstelle', minScale: 0.045 },
  repair: { icon: 'wrench', color: '#7ad1ff', label: 'Werkstatt', minScale: 0.045 },
  parking: { icon: 'P', color: '#3d86f5', label: 'Parkplatz', minScale: 0.12, square: true },
  restaurant: { icon: 'food', color: '#ff9a3d', label: 'Restaurant', minScale: 0.1 },
};

// Reihenfolge der Einträge in der Legende (zeilenweise, zwei Spalten wie auf der Vorlage)
export const LEGEND_ITEMS = [
  { arrow: true, label: 'Deine Position' }, BLIP.waypoint,
  BLIP.quest, BLIP.target,
  BLIP.vehicle, BLIP.enemy,
  BLIP.house, BLIP.home,
  POI_ICONS.bank, POI_ICONS.jewelry,
  POI_ICONS.gunshop, POI_ICONS.carshop,
  POI_ICONS.police, POI_ICONS.clinic,
  POI_ICONS.harbor, POI_ICONS.airport,
  POI_ICONS.club, POI_ICONS.bar,
  POI_ICONS.fuel, POI_ICONS.repair,
  POI_ICONS.parking, POI_ICONS.restaurant,
];

const TAU = Math.PI * 2;
const INK = '#0c131c';
const paths = new Map();
const pathOf = (name) => {
  let p = paths.get(name);
  if (!p) { p = new Path2D(ICON_PATHS[name]); paths.set(name, p); }
  return p;
};

// Piktogramm oder Zeichen mittig auf (x, y); size = Kantenlänge in Bildpunkten
export function drawIcon(c, icon, x, y, size, color = INK) {
  if (!icon) return;
  c.save();
  c.fillStyle = color;
  if (ICON_PATHS[icon]) {
    c.translate(x - size / 2, y - size / 2);
    c.scale(size / 24, size / 24);
    c.fill(pathOf(icon), 'evenodd');
  } else {
    c.font = `800 ${Math.round(size * 1.12)}px ${MAP_FONT}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(icon, x, y + size * 0.06);
  }
  c.restore();
}

// Marker: farbige Scheibe mit dunklem Symbol und hellem Ring (square: abgerundetes Quadrat, z. B. Flughafen)
export function drawMarker(c, x, y, r, color, icon, square = false) {
  c.save();
  const shape = (grow) => {
    c.beginPath();
    if (square) c.roundRect(x - r - grow, y - r - grow, (r + grow) * 2, (r + grow) * 2, (r + grow) * 0.32);
    else c.arc(x, y, r + grow, 0, TAU);
  };
  c.shadowColor = 'rgba(0,0,0,.65)'; c.shadowBlur = r * 0.75; c.shadowOffsetY = r * 0.18;
  c.fillStyle = INK; shape(r * 0.3); c.fill();
  c.shadowColor = 'transparent'; c.shadowBlur = 0; c.shadowOffsetY = 0;
  c.fillStyle = 'rgba(255,255,255,.95)'; shape(r * 0.14); c.fill();
  c.fillStyle = color; shape(-r * 0.04); c.fill();
  drawIcon(c, icon, x, y, r * 1.38);
  c.restore();
}

// Spielerpfeil: Spitze nach oben bei angle = 0
export function drawArrow(c, x, y, angle, size) {
  c.save();
  c.translate(x, y); c.rotate(angle); c.scale(size / 15, size / 15);
  c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 7; c.shadowOffsetY = 2;
  c.beginPath(); c.moveTo(0, -15); c.lineTo(11, 12); c.lineTo(0, 6); c.lineTo(-11, 12); c.closePath();
  c.lineJoin = 'round'; c.strokeStyle = INK; c.lineWidth = 4; c.stroke();
  c.shadowColor = 'transparent';
  c.fillStyle = '#fff'; c.fill();
  c.restore();
}

// Dasselbe Symbol als SVG für die Legende
export function iconSvg(item) {
  if (item.arrow) return '<svg viewBox="-14 -17 28 32"><path d="M0-15L11 12 0 6-11 12Z" fill="#fff" stroke="#0c131c" stroke-width="2.5" stroke-linejoin="round"/></svg>';
  const inner = ICON_PATHS[item.icon]
    ? `<path transform="translate(4.4 4.4) scale(.8)" d="${ICON_PATHS[item.icon]}" fill="${INK}" fill-rule="evenodd"/>`
    : `<text x="14" y="14.6" text-anchor="middle" dominant-baseline="central" font-size="19" font-weight="800" fill="${INK}">${item.icon}</text>`;
  const back = item.square
    ? `<rect x="1" y="1" width="26" height="26" rx="6" fill="${item.color}" stroke="#fff" stroke-width="1.6"/>`
    : `<circle cx="14" cy="14" r="13" fill="${item.color}" stroke="rgba(255,255,255,.9)" stroke-width="1.6"/>`;
  return `<svg viewBox="0 0 28 28">${back}${inner}</svg>`;
}
