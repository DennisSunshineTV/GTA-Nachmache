// Schilder: Liste der Texte (Weltgenerierung) + Stile (für die Textur-Atlas im Renderer).
export const SIGN_COLS = 4;
export const SIGN_ROWS = 28;     // 112 Plätze (die Welt braucht ~90 verschiedene Schilder; vorher 72 -> falsche Texte)

export const SIGN_STYLES = {
  hotel: { bg: '#0f3d73', fg: '#ffffff', edge: '#f5c542', glow: 0.35 },
  shop: { bg: '#b3262b', fg: '#ffffff', edge: '#ffffff', glow: 0.5 },
  bank: { bg: '#123d2b', fg: '#f3d27a', edge: '#f3d27a', glow: 0.4 },
  jewel: { bg: '#2a1b4d', fg: '#ffe9a8', edge: '#ffd35a', glow: 0.8 },
  gun: { bg: '#2c2c2c', fg: '#ffb020', edge: '#ffb020', glow: 0.4 },
  cars: { bg: '#0b2a55', fg: '#ffffff', edge: '#4cc2ff', glow: 0.9 },
  club: { bg: '#12001f', fg: '#ff3df2', edge: '#32f0ff', glow: 2.4 },
  bar: { bg: '#2b1203', fg: '#ffcf6b', edge: '#ff9a2e', glow: 1.4 },
  cafe: { bg: '#f4ead2', fg: '#4a2a12', edge: '#4a2a12', glow: 0.3 },
  gas: { bg: '#0a5c3a', fg: '#ffffff', edge: '#ffe200', glow: 0.7 },
  police: { bg: '#10204a', fg: '#ffffff', edge: '#3b7bff', glow: 0.6 },
  clinic: { bg: '#ffffff', fg: '#cc1f2d', edge: '#cc1f2d', glow: 0.5 },
  harbor: { bg: '#164a63', fg: '#ffffff', edge: '#ffffff', glow: 0.3 },
  port: { bg: '#0f2840', fg: '#8fe3ff', edge: '#8fe3ff', glow: 0.8 },
  beach: { bg: '#5a3b22', fg: '#f7e8c6', edge: '#d3a867', glow: 0.15 },
  burger: { bg: '#c8102e', fg: '#ffd200', edge: '#ffd200', glow: 1.1 },
  pizza: { bg: '#0b6b34', fg: '#ffffff', edge: '#e2242b', glow: 0.9 },
  doner: { bg: '#7a1010', fg: '#ffd27a', edge: '#ffd27a', glow: 1.0 },
  schnitzel: { bg: '#4a2a12', fg: '#f5e6c8', edge: '#d6a85a', glow: 0.7 },
  pommes: { bg: '#ffcc00', fg: '#c8102e', edge: '#c8102e', glow: 1.0 },
};

export class SignList {
  constructor() { this.items = []; this.index = new Map(); }
  add(text, style = 'shop') {
    const key = style + '|' + text;
    let i = this.index.get(key);
    if (i === undefined) {
      if (this.items.length >= SIGN_COLS * SIGN_ROWS) return this.index.get(this.items[0].style + '|' + this.items[0].text);
      i = this.items.length;
      this.items.push({ text, style });
      this.index.set(key, i);
    }
    return i;
  }
  // UV-Rechteck im Atlas (v=0 unten)
  static uv(i) {
    const col = i % SIGN_COLS, row = Math.floor(i / SIGN_COLS);
    const u0 = col / SIGN_COLS, u1 = (col + 1) / SIGN_COLS;
    const v1 = 1 - row / SIGN_ROWS, v0 = 1 - (row + 1) / SIGN_ROWS;
    return [u0 + 0.004, v0 + 0.004, u1 - 0.004, v1 - 0.004];
  }
}
