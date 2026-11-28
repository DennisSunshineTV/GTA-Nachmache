// Spielfiguren: Anzeigenamen. Die Namen werden später vergeben – bis dahin heißen die Figuren „Mann“ und „Frau“.
// Die internen Kennungen ('jason', 'lucia') bleiben unverändert, weil Speicherstände, Outfits und die Figurauswahl sie benutzen.
// Zum Umbenennen genügt es, hier die Namen zu ändern (und in index.html die Figurauswahl und den Speicherstand-Hinweis).
export const PLAYER_CHARS = {
  jason: { name: 'Mann' },
  lucia: { name: 'Frau' },
};

export const charName = (who) => (PLAYER_CHARS[who] || PLAYER_CHARS.jason).name;
export const partnerOf = (who) => (who === 'lucia' ? 'jason' : 'lucia');
