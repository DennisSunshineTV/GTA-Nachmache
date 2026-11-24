// Weltdaten für "Mallorca's: Street Life".
// Koordinaten: X nach Osten, Z nach Süden, Einheit Meter. Mallorca ist an der echten Geografie
// angelehnt (Maßstab ~1:12 500), Siedlungen sind bewusst größer als maßstabsgetreu.

const SCALE = 12.5;
const LON0 = 2.95, LAT0 = 39.6;
export const ll = (lon, lat) => [((lon - LON0) * 85.5 * 1000) / SCALE, (-(lat - LAT0) * 111 * 1000) / SCALE];

// Insel aus lokalen km-Koordinaten (x Ost, y Nord) platzieren
function localIsland(pts, cx, cz, mPerKm, rotDeg = 0) {
  const r = (rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return pts.map(([x, y]) => [cx + (x * c - y * s) * mPerKm, cz - (x * s + y * c) * mPerKm]);
}

// ---------- Küstenlinien ----------

const MALLORCA = [
  [2.330, 39.585], [2.345, 39.603], [2.385, 39.628], [2.430, 39.645], [2.480, 39.660], [2.520, 39.690],
  [2.570, 39.700], [2.610, 39.725], [2.645, 39.750], [2.672, 39.790], [2.690, 39.806], [2.715, 39.804],
  [2.727, 39.826], [2.760, 39.833], [2.800, 39.850], [2.840, 39.857], [2.900, 39.868], [2.950, 39.890],
  [3.020, 39.915], [3.080, 39.935], [3.150, 39.958], [3.215, 39.975],
  // Formentor, Bucht von Pollença
  [3.235, 39.962], [3.200, 39.938], [3.150, 39.922], [3.105, 39.915], [3.085, 39.895], [3.105, 39.878],
  [3.160, 39.884], [3.208, 39.890], [3.205, 39.865], [3.165, 39.845],
  // Bucht von Alcúdia
  [3.128, 39.815], [3.130, 39.790], [3.160, 39.765], [3.215, 39.755], [3.270, 39.765], [3.330, 39.772],
  [3.390, 39.748], [3.440, 39.732], [3.480, 39.715],
  // Ostküste
  [3.458, 39.690], [3.428, 39.655], [3.388, 39.610], [3.380, 39.575], [3.345, 39.540], [3.300, 39.490],
  [3.272, 39.440], [3.237, 39.385], [3.197, 39.345], [3.130, 39.310], [3.070, 39.272], [3.050, 39.260],
  // Südküste
  [3.000, 39.280], [2.982, 39.320], [2.950, 39.350], [2.880, 39.352], [2.820, 39.356], [2.782, 39.353],
  // Bucht von Palma
  [2.772, 39.400], [2.748, 39.455], [2.748, 39.490], [2.712, 39.526], [2.662, 39.545], [2.622, 39.551],
  [2.582, 39.520], [2.546, 39.486], [2.516, 39.456], [2.496, 39.481], [2.470, 39.505],
  [2.445, 39.526], [2.420, 39.536], [2.386, 39.541], [2.356, 39.561],
].map(([lo, la]) => ll(lo, la));

const DRAGONERA = localIsland(
  [[-2.2, -0.4], [-1.5, -0.1], [-0.6, 0.15], [0.4, 0.3], [1.3, 0.5], [2.0, 0.9], [2.3, 1.4], [2.0, 1.8], [1.2, 1.6], [0.2, 1.0], [-0.8, 0.7], [-1.6, 0.4], [-2.1, 0.1]],
  -5150, -30, 200, 18);

const CABRERA = localIsland(
  [[-3.8, 0.4], [-3.2, 1.4], [-2.0, 2.0], [-0.5, 2.1], [1.0, 1.7], [2.4, 1.9], [3.6, 1.0], [3.9, -0.2], [3.0, -1.2], [1.6, -1.9], [0.0, -1.6], [-1.2, -2.1], [-2.6, -1.4], [-3.5, -0.5]],
  500, 4600, 190, 8);
const CONILLS = localIsland([[-0.5, -0.2], [0.1, -0.5], [0.6, -0.1], [0.4, 0.4], [-0.2, 0.5]], -300, 4950, 190, 0);

const MENORCA = localIsland(
  [[-24, -3], [-21, 0.5], [-17, 2], [-12, 2.8], [-8, 3.6], [-4, 4.4], [-1, 4.0], [3, 3.0], [8, 3.2], [13, 2.1], [18, 0.6], [22, -1.5], [23.5, -3.5], [22, -5], [17, -5.5], [12, -5.8], [6, -5.4], [0, -4.8], [-6, -4.2], [-12, -4.4], [-17, -4.0], [-21, -4.2]],
  7800, -3000, 105, 0);

const IBIZA = localIsland(
  [[-20, 0], [-17, 5], [-10, 7], [-2, 8], [6, 9], [14, 8], [19, 4], [21, -1], [15, -5], [8, -6], [2, -8], [-6, -7], [-13, -6], [-18, -3]],
  -8800, 4400, 125, 28);

const FORMENTERA = localIsland(
  [[-9.5, -0.4], [-8.8, 0.6], [-7.2, 0.9], [-5.5, 0.5], [-3.5, 0.7], [-2.0, 0.4], [-0.8, 0.8], [0.6, 0.9], [1.6, 0.5], [2.6, 0.9], [4.0, 1.2], [6.0, 1.5], [8.0, 1.1], [9.3, 0.2], [9.6, -0.8], [8.6, -1.6], [6.5, -1.9], [4.5, -1.4], [3.0, -0.8], [1.6, -1.0], [0.5, -0.6], [-0.6, -0.9], [-2.0, -0.7], [-3.6, -0.8], [-5.5, -0.6], [-7.2, -0.9]],
  -8300, 7300, 175, 0);

export const ISLANDS = [
  { id: 'mallorca', name: 'Mallorca', poly: MALLORCA, big: true },
  { id: 'dragonera', name: 'Sa Dragonera', poly: DRAGONERA },
  { id: 'cabrera', name: 'Cabrera', poly: CABRERA },
  { id: 'conills', name: 'Illa dels Conills', poly: CONILLS },
  { id: 'menorca', name: 'Menorca', poly: MENORCA, big: true },
  { id: 'ibiza', name: 'Ibiza', poly: IBIZA, big: true },
  { id: 'formentera', name: 'Formentera', poly: FORMENTERA, big: true },
];

// Weltgrenzen (für Raster)
export const WORLD = { x0: -12600, z0: -5200, x1: 10800, z1: 9000 };

// ---------- Gebirge (Höhen übertrieben) ----------
// Jede Kette: Punkte [x, z, Höhe], Streuung sigma in Metern.

const ridge = (pts, sigma) => ({ pts: pts.map(([lo, la, h]) => [...ll(lo, la), h]), sigma });

export const RIDGES = [
  // Serra de Tramuntana
  ridge([[2.360, 39.605, 70], [2.430, 39.635, 150], [2.455, 39.645, 205], [2.520, 39.685, 150], [2.590, 39.715, 175],
    [2.660, 39.775, 215], [2.730, 39.800, 190], [2.795, 39.815, 290], [2.855, 39.815, 275], [2.930, 39.850, 225],
    [3.000, 39.885, 150], [3.070, 39.915, 120]], 520),
  // Formentor
  ridge([[3.090, 39.925, 110], [3.150, 39.945, 130], [3.200, 39.962, 95]], 240),
  // Serres de Llevant
  ridge([[3.300, 39.745, 70], [3.370, 39.705, 105], [3.340, 39.650, 90], [3.300, 39.600, 80], [3.260, 39.520, 85], [3.200, 39.470, 100], [3.150, 39.420, 90]], 460),
  // Einzelberge der Ebene
  ridge([[2.925, 39.462, 110], [2.930, 39.460, 110]], 300), // Randa
  ridge([[3.150, 39.462, 115], [3.155, 39.460, 115]], 280), // Sant Salvador
  ridge([[2.925, 39.700, 70], [2.930, 39.703, 70]], 260), // Alaró/Santa Magdalena
  ridge([[3.060, 39.552, 55], [3.062, 39.553, 55]], 240), // Bonany
  ridge([[3.010, 39.730, 70], [3.012, 39.731, 70]], 200),
  ridge([[2.700, 39.590, 55], [2.710, 39.600, 55]], 260), // Hügel bei Palma
  // Dragonera
  { pts: [[-5700, 320, 70], [-5200, 60, 110], [-4650, -120, 80]], sigma: 170 },
  // Cabrera
  { pts: [[-700, 4650, 60], [400, 4600, 85], [1100, 4560, 70]], sigma: 280 },
  // Menorca (Monte Toro)
  { pts: [[6500, -2900, 35], [7600, -3000, 45], [8100, -3100, 90], [8900, -3050, 40]], sigma: 520 },
  // Ibiza
  { pts: [[-10200, 5000, 60], [-9400, 4600, 85], [-8700, 4300, 100], [-8000, 3900, 80]], sigma: 420 },
  // Formentera (La Mola)
  { pts: [[-6900, 7220, 55], [-6700, 7240, 60]], sigma: 260 },
];

// ---------- Landschafts-Zonen ----------

// S'Albufera (Feuchtgebiet), Salzebene Es Salobrar
export const WETLANDS = [
  { id: 'albufera', pts: [ll(3.030, 39.800), ll(3.085, 39.802), ll(3.092, 39.772), ll(3.070, 39.742), ll(3.030, 39.750), ll(3.015, 39.778)], water: 0.34 },
  { id: 'salobrar', pts: [ll(2.985, 39.340), ll(3.025, 39.345), ll(3.045, 39.330), ll(3.030, 39.312), ll(3.000, 39.315)], water: 0.22, salt: true },
  { id: 'cabrera-lagoon', pts: [[-100, 4560], [150, 4540], [220, 4640], [20, 4670]], water: 0.2 },
];

// Ackerland / Ebene (Es Pla) und sonstige Zonen
export const ZONES = {
  plain: [ll(2.720, 39.700), ll(2.960, 39.760), ll(3.130, 39.730), ll(3.300, 39.650), ll(3.230, 39.470), ll(3.020, 39.400), ll(2.800, 39.440), ll(2.700, 39.560)],
};

// Feste Höhen für Siedlungen im Gebirge (Talböden): id -> { h, r, blend }
export const PADS = {
  soller: { h: 42, r: 380, blend: 300 },
  portsoller: { h: 2.6, r: 300, blend: 260 },
  valldemossa: { h: 138, r: 210, blend: 170 },
  pollenca: { h: 22, r: 330, blend: 260 },
  portpollenca: { h: 2.4, r: 260, blend: 200 },
  andratx: { h: 5.5, r: 260, blend: 220 },
  santelm: { h: 4.5, r: 170, blend: 140 },
  formentor: { h: 38, r: 120, blend: 120 },
  arta: { h: 62, r: 240, blend: 200 },
  felanitx: { h: 80, r: 260, blend: 200 },
  calamillor: { h: 3.5, r: 300, blend: 200 },
  portocolom: { h: 4, r: 200, blend: 180 },
  portocristo: { h: 5, r: 220, blend: 180 },
  calaratjada: { h: 5, r: 240, blend: 180 },
};

// ---------- Siedlungen ----------
// kind: city | resort | village | fishing | industrial | airport
// Positionen für Mallorca per ll(lon, lat); Nachbarinseln direkt in Weltmetern.

export const SETTLEMENTS = [
  // --- Mallorca ---
  { id: 'palma', name: 'Palma', kind: 'city', at: ll(2.652, 39.592), r: 1050, angle: 0.28, block: [78, 62], towers: 16, port: true, island: 'mallorca', sector: 'bay' },
  { id: 'arenal', name: 'Platja de Palma', kind: 'resort', at: ll(2.732, 39.506), len: 1900, depth: 260, hotels: 'big', island: 'mallorca' },
  { id: 'magaluf', name: 'Magaluf', kind: 'resort', at: ll(2.537, 39.492), len: 1100, depth: 220, hotels: 'night', island: 'mallorca' },
  { id: 'andratx', name: "Port d'Andratx", kind: 'fishing', at: ll(2.388, 39.552), r: 330, island: 'mallorca' },
  { id: 'santelm', name: 'Sant Elm', kind: 'fishing', at: ll(2.358, 39.578), r: 170, island: 'mallorca' },
  { id: 'valldemossa', name: 'Valldemossa', kind: 'village', at: ll(2.623, 39.708), r: 230, island: 'mallorca' },
  { id: 'soller', name: 'Sóller', kind: 'village', at: ll(2.717, 39.765), r: 330, island: 'mallorca' },
  { id: 'portsoller', name: 'Port de Sóller', kind: 'fishing', at: ll(2.700, 39.793), r: 280, island: 'mallorca' },
  { id: 'pollenca', name: 'Pollença', kind: 'village', at: ll(3.015, 39.872), r: 340, island: 'mallorca' },
  { id: 'portpollenca', name: 'Port de Pollença', kind: 'resort', at: ll(3.094, 39.898), len: 900, depth: 200, hotels: 'mid', island: 'mallorca' },
  { id: 'alcudia', name: 'Alcúdia', kind: 'village', at: ll(3.118, 39.852), r: 330, island: 'mallorca' },
  { id: 'portalcudia', name: "Port d'Alcúdia", kind: 'resort', at: ll(3.160, 39.842), len: 900, depth: 220, hotels: 'mid', marina: true, island: 'mallorca' },
  { id: 'muro', name: 'Platja de Muro', kind: 'resort', at: ll(3.128, 39.795), len: 2100, depth: 240, hotels: 'pool', island: 'mallorca' },
  { id: 'canpicafort', name: 'Can Picafort', kind: 'resort', at: ll(3.178, 39.762), len: 1000, depth: 200, hotels: 'mid', island: 'mallorca' },
  { id: 'calaratjada', name: 'Cala Ratjada', kind: 'fishing', at: ll(3.462, 39.708), r: 300, island: 'mallorca' },
  { id: 'calamillor', name: 'Cala Millor', kind: 'resort', at: ll(3.378, 39.590), len: 1100, depth: 220, hotels: 'mid', island: 'mallorca' },
  { id: 'portocristo', name: 'Porto Cristo', kind: 'fishing', at: ll(3.322, 39.543), r: 280, island: 'mallorca' },
  { id: 'portocolom', name: 'Portocolom', kind: 'fishing', at: ll(3.255, 39.421), r: 240, island: 'mallorca' },
  { id: 'colonia', name: 'Colònia de Sant Jordi', kind: 'fishing', at: ll(2.995, 39.322), r: 240, island: 'mallorca' },
  { id: 'inca', name: 'Inca', kind: 'city', at: ll(2.912, 39.720), r: 520, angle: 0.5, block: [90, 70], towers: 0, island: 'mallorca' },
  { id: 'manacor', name: 'Manacor', kind: 'city', at: ll(3.208, 39.568), r: 520, angle: -0.3, block: [90, 70], towers: 0, island: 'mallorca' },
  { id: 'llucmajor', name: 'Llucmajor', kind: 'village', at: ll(2.888, 39.490), r: 300, island: 'mallorca' },
  { id: 'campos', name: 'Campos', kind: 'village', at: ll(3.018, 39.433), r: 250, island: 'mallorca' },
  { id: 'felanitx', name: 'Felanitx', kind: 'village', at: ll(3.148, 39.468), r: 300, island: 'mallorca' },
  { id: 'santanyi', name: 'Santanyí', kind: 'village', at: ll(3.128, 39.355), r: 230, island: 'mallorca' },
  { id: 'sineu', name: 'Sineu', kind: 'village', at: ll(3.010, 39.642), r: 240, island: 'mallorca' },
  { id: 'sapobla', name: 'Sa Pobla', kind: 'village', at: ll(3.020, 39.770), r: 260, island: 'mallorca' },
  { id: 'arta', name: 'Artà', kind: 'village', at: ll(3.350, 39.695), r: 260, island: 'mallorca' },
  { id: 'algaida', name: 'Algaida', kind: 'village', at: ll(2.895, 39.560), r: 200, island: 'mallorca' },
  { id: 'poligon', name: 'Polígono Son Castelló', kind: 'industrial', at: ll(2.700, 39.622), r: 380, island: 'mallorca' },
  { id: 'poligon2', name: 'Polígono Inca', kind: 'industrial', at: ll(2.935, 39.698), r: 280, island: 'mallorca' },
  { id: 'airport', name: 'Aeropuerto de Palma', kind: 'airport', at: ll(2.735, 39.552), angle: -1.02, island: 'mallorca' },
  { id: 'formentor', name: 'Cap de Formentor', kind: 'village', at: ll(3.118, 39.928), r: 120, tiny: true, island: 'mallorca' },
  // --- Menorca ---
  { id: 'ciutadella', name: 'Ciutadella', kind: 'village', at: { isl: 'menorca', deg: 180, in: 300 }, r: 330, island: 'menorca' },
  { id: 'mao', name: 'Maó', kind: 'city', at: { isl: 'menorca', deg: 0, in: 330 }, r: 380, angle: 0.2, block: [85, 66], towers: 0, island: 'menorca' },
  { id: 'fornells', name: 'Fornells', kind: 'fishing', at: { isl: 'menorca', deg: 262, in: 120 }, r: 230, island: 'menorca' },
  { id: 'caladonga', name: 'Cala Galdana', kind: 'resort', at: { isl: 'menorca', deg: 98, in: 0 }, len: 700, depth: 180, hotels: 'mid', island: 'menorca' },
  // --- Ibiza ---
  { id: 'eivissa', name: 'Ibiza-Stadt', kind: 'city', at: { isl: 'ibiza', deg: 62, in: 420 }, r: 520, angle: 0.4, block: [78, 62], towers: 3, port: true, island: 'ibiza' },
  { id: 'santantoni', name: 'Sant Antoni', kind: 'resort', at: { isl: 'ibiza', deg: 198, in: 0 }, len: 1000, depth: 220, hotels: 'night', island: 'ibiza' },
  { id: 'platjabossa', name: "Platja d'en Bossa", kind: 'resort', at: { isl: 'ibiza', deg: 108, in: 0 }, len: 1100, depth: 220, hotels: 'night', island: 'ibiza' },
  { id: 'santaeularia', name: 'Santa Eulària', kind: 'village', at: { isl: 'ibiza', deg: 18, in: 330 }, r: 280, island: 'ibiza' },
  // --- Formentera ---
  { id: 'lasavina', name: 'La Savina', kind: 'fishing', at: { isl: 'formentera', deg: 250, in: 90 }, r: 230, island: 'formentera' },
  { id: 'espujols', name: 'Es Pujols', kind: 'resort', at: { isl: 'formentera', deg: 292, in: 0 }, len: 600, depth: 160, hotels: 'mid', island: 'formentera' },
  // --- Cabrera ---
  { id: 'cabrera-port', name: 'Cabrera Hafen', kind: 'fishing', at: { isl: 'cabrera', deg: 268, in: 90 }, r: 90, tiny: true, island: 'cabrera' },
];

// ---------- Verbindungsstraßen (A* über Gelände) ----------
// class: highway | main | rural | scenic | track
export const LINKS = [
  // Hauptachsen
  ['palma', 'inca', 'highway'], ['inca', 'sapobla', 'main'], ['sapobla', 'muro', 'main'], ['muro', 'alcudia', 'main'],
  ['palma', 'algaida', 'highway'], ['algaida', 'manacor', 'highway'], ['manacor', 'portocristo', 'main'],
  ['manacor', 'arta', 'main'], ['arta', 'calaratjada', 'main'], ['arta', 'canpicafort', 'main'], ['canpicafort', 'muro', 'main'],
  ['manacor', 'calamillor', 'main'], ['manacor', 'felanitx', 'main'], ['felanitx', 'portocolom', 'rural'],
  ['felanitx', 'santanyi', 'main'], ['santanyi', 'campos', 'main'], ['campos', 'colonia', 'main'], ['campos', 'llucmajor', 'main'],
  ['llucmajor', 'palma', 'highway'], ['llucmajor', 'arenal', 'main'], ['palma', 'arenal', 'highway'], ['palma', 'airport', 'highway'],
  ['palma', 'poligon', 'main'], ['poligon', 'inca', 'highway'], ['inca', 'poligon2', 'main'],
  ['inca', 'sineu', 'main'], ['sineu', 'manacor', 'main'], ['sineu', 'sapobla', 'rural'],
  ['alcudia', 'portalcudia', 'main'], ['alcudia', 'pollenca', 'main'], ['pollenca', 'portpollenca', 'main'],
  ['palma', 'magaluf', 'highway'], ['magaluf', 'andratx', 'main'], ['andratx', 'santelm', 'rural'],
  // Küstenstraße (Ma-10)
  ['andratx', 'valldemossa', 'scenic'], ['valldemossa', 'soller', 'scenic'], ['soller', 'portsoller', 'main'],
  ['soller', 'pollenca', 'scenic'], ['palma', 'valldemossa', 'main'], ['palma', 'soller', 'main'],
  ['portpollenca', 'formentor', 'scenic'],
  // Menorca
  ['ciutadella', 'mao', 'main'], ['ciutadella', 'caladonga', 'rural'], ['mao', 'fornells', 'rural'], ['caladonga', 'mao', 'rural'],
  // Ibiza
  ['eivissa', 'santantoni', 'main'], ['eivissa', 'platjabossa', 'main'], ['eivissa', 'santaeularia', 'main'], ['santantoni', 'santaeularia', 'rural'],
  // Formentera
  ['lasavina', 'espujols', 'rural'],
];

export const SCENIC_LINKS = new Set(['andratx>valldemossa', 'valldemossa>soller', 'soller>pollenca', 'portpollenca>formentor']);

// ---------- Orte für Teleport / Minikarte ----------
export const REGION_NAMES = [
  { name: 'Serra de Tramuntana', at: ll(2.700, 39.790), r: 2200 },
  { name: "S'Albufera", at: ll(3.095, 39.775), r: 650 },
  { name: 'Es Pla', at: ll(3.020, 39.620), r: 1700 },
  { name: 'Formentor', at: ll(3.160, 39.950), r: 600 },
  { name: 'Serres de Llevant', at: ll(3.320, 39.620), r: 900 },
  { name: 'Bucht von Palma', at: ll(2.640, 39.500), r: 800 },
];

export const WORLD_ISLAND_LABELS = ISLANDS.map((i) => i.name);
