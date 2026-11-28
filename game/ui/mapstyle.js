// Aussehen der Karte (Vollbildkarte 2D/3D und Minikarte): Farben, Schrift und Straßenstile.
// Eine Quelle, damit Karte, Texturen und Legende zusammenpassen. Der Untergrund (Satellitenbild) kommt aus satellite.js.

export const PAL = {
  water: '#0e2a40',      // offenes Meer (Hintergrund hinter dem Satellitenbild)
  land: '#4c5234',       // Land, falls kein Satellitenbild gezeichnet werden kann
  text: '#ffffff',
  halo: 'rgba(6,12,20,.85)',
  accent: '#ff5fd8',     // Fahrstrecke zur Quest
};

// Schmale Schrift wie auf der Vorlage (Windows: Bahnschrift), mit Ausweichschriften für andere Systeme
export const MAP_FONT = '"Bahnschrift", "Barlow Condensed", "Roboto Condensed", "Avenir Next Condensed", "Arial Narrow", "Segoe UI", system-ui, sans-serif';

// Straßenarten: w = Breite in Metern (die Kartenbreite wächst mit dem Zoom), minPx = Mindestbreite in Bildpunkten,
// minScale = ab welchem Zoom (Bildpunkte pro Meter) die Straße gezeichnet wird, minor = beim Herauszoomen zurückhaltender.
export const ROAD_STYLE = {
  alley: { w: 5.4, minPx: 1.1, color: '#a9aaa4', casing: 'rgba(20,22,20,.50)', minScale: 0.09, minor: true, label: 'Gasse' },
  track: { w: 3.8, minPx: 1.1, color: '#cdb58c', casing: 'rgba(40,30,18,.45)', minScale: 0.07, dash: true, minor: true, label: 'Feldweg' },
  street: { w: 7.0, minPx: 1.5, color: '#adb0ad', casing: 'rgba(18,22,24,.55)', minScale: 0.032, minor: true, label: 'Nebenstraße' },
  promenade: { w: 9, minPx: 1.8, color: '#efe2c2', casing: 'rgba(40,32,20,.5)', minScale: 0.05, minor: true, label: 'Promenade' },
  avenue: { w: 11, minPx: 2.4, color: '#eceae4', casing: 'rgba(16,20,24,.65)', minScale: 0.025, label: 'Allee' },
  rural: { w: 7, minPx: 1.6, color: '#c4c3bb', casing: 'rgba(18,22,18,.55)', minScale: 0.018, label: 'Nebenstraße' },
  scenic: { w: 7.8, minPx: 2.1, color: '#ffffff', casing: 'rgba(14,18,22,.62)', minScale: 0, dash: true, label: 'Panoramastraße' },
  main: { w: 9.4, minPx: 2.6, color: '#fbfaf6', casing: 'rgba(14,18,22,.72)', minScale: 0, label: 'Hauptstraße' },
  highway: { w: 12.5, minPx: 3.4, color: '#f7a824', casing: 'rgba(52,30,4,.85)', minScale: 0, label: 'Autobahn' },
  deck: { w: 5, minPx: 1.4, color: '#c79a62', casing: 'rgba(40,28,14,.55)', minScale: 0.1, label: 'Zufahrt' },
  quay: { w: 9, minPx: 1.6, color: '#cfcbc0', casing: 'rgba(18,22,24,.4)', minScale: 0.1, label: 'Kai' },
  forecourt: { w: 14, minPx: 1.6, color: '#c9c9c4', casing: 'rgba(18,22,24,.35)', minScale: 0.1, label: 'Vorplatz' },
  taxiway: { w: 16, minPx: 1.6, color: '#777b7c', casing: 'rgba(18,22,24,.45)', minScale: 0.03, label: 'Rollweg' },
  runway: { w: 46, minPx: 3, color: '#45484d', casing: 'rgba(10,12,14,.7)', minScale: 0.01, label: 'Landebahn' },
};

// Zeichenreihenfolge: unten → oben
export const ROAD_ORDER = ['runway', 'taxiway', 'track', 'alley', 'quay', 'forecourt', 'deck', 'street', 'promenade', 'avenue', 'rural', 'scenic', 'main', 'highway'];

// Straßen, die die Legende erklärt (wie auf der Vorlage)
export const LEGEND_ROADS = ['highway', 'main', 'rural', 'scenic'];

// Dachfarben nach Bauart (Luftbild)
export const ROOFS = {
  finca: ['#b8694a', '#a95a3f', '#c27c55'],
  house: ['#b9674a', '#c98a62', '#ded6c8', '#a4573f'],
  old: ['#b76b49', '#a35b3f', '#c8855b', '#bfa688'],
  apt: ['#ded9ce', '#c4beb2', '#b98565', '#e9e5dc'],
  shop: ['#d5cec0', '#b9b4aa', '#b4785a'],
  office: ['#bcc3c6', '#dcd9d2', '#a3a9ad'],
  bank: ['#d8d2c2'],
  tower: ['#aebbc6', '#c8d0d6'],
  hotel: ['#ece9e1', '#ded6c6', '#f4f1ea', '#d3b89a'],
  club: ['#8d6f8f', '#b08a76', '#6f7488'],
  bar: ['#c08d62', '#d9cbb0'],
  ware: ['#8f979f', '#aab0b4', '#7b858f', '#b3a596'],
  church: ['#9c503a'],
  terminal: ['#d2d9de'],
  beach: ['#efe8da'],
};
