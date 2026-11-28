// Account-Verwaltung: Speicherung (JSON-Datei), Passwort-Hashing, Sessions, Validierung.
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const SAVE_DIR = path.join(DATA_DIR, 'saves');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

const RANKS = ['Sysadmin', 'Admin', 'Spieler'];
const OWNER_NAME = 'DennisSunshineTV';
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Speicher ----------

let store = { nextId: 1, users: [], sessions: {}, log: [], nextLogId: 1 };
const LOG_MAX = 5000;
// Anwesenheit: Wer im Spiel ist, meldet sich alle 30 s (Lebenszeichen). Nur im Speicher, nach 75 s ohne Meldung gilt man als offline.
const presence = new Map();
const ONLINE_MS = 75_000;
function setPresence(id, leave = false) { if (leave) presence.delete(id); else presence.set(id, Date.now()); }
function isOnline(id) { const t = presence.get(id); return !!t && Date.now() - t < ONLINE_MS; }

function load() {
  try {
    store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (!Array.isArray(store.log)) store.log = [];
  if (!store.nextLogId) store.nextLogId = store.log.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
  pruneSessions();
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function pruneSessions() {
  const now = Date.now();
  for (const [key, s] of Object.entries(store.sessions)) {
    if (s.expires < now) delete store.sessions[key];
  }
}

// ---------- Passwörter ----------

function scrypt(password, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

const DUMMY_HASH = `${'00'.repeat(16)}:${'00'.repeat(64)}`;

async function verifyPassword(password, stored) {
  const [saltHex, keyHex] = stored.split(':');
  const key = await scrypt(password, Buffer.from(saltHex, 'hex'));
  return crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex'));
}

// ---------- Validierung ----------

// Nur Buchstaben und Zahlen, mindestens ein Buchstabe (reine Zahlen sind nicht erlaubt).
const NAME_RE = /^(?=.*[A-Za-z])[A-Za-z0-9]{3,16}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v) {
  return typeof v === 'string' ? v : '';
}

function validateName(name) {
  if (!NAME_RE.test(name)) {
    throw new HttpError(400, 'Accountname: 3–16 Zeichen, nur Buchstaben oder Buchstaben mit Zahlen (nur Zahlen sind nicht erlaubt).');
  }
}

function validateEmail(email) {
  if (email.length > 254 || !EMAIL_RE.test(email)) {
    throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
  }
}

function validatePassword(password) {
  if (password.length < 8 || password.length > 128) {
    throw new HttpError(400, 'Das Passwort muss 8–128 Zeichen lang sein.');
  }
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

// ---------- Betriebssystem und Browser aus dem User-Agent ----------

function clientInfo(ua) {
  ua = typeof ua === 'string' ? ua.slice(0, 400) : '';
  let os = 'Unbekannt';
  let m;
  if (/Windows NT 10\.0/.test(ua)) os = 'Windows 10/11';
  else if (/Windows NT 6\.3/.test(ua)) os = 'Windows 8.1';
  else if (/Windows NT 6\.2/.test(ua)) os = 'Windows 8';
  else if (/Windows NT 6\.1/.test(ua)) os = 'Windows 7';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if ((m = /Android ([\d.]+)/.exec(ua))) os = 'Android ' + m[1].split('.')[0];
  else if (/Android/.test(ua)) os = 'Android';
  else if ((m = /(?:iPhone|iPad|iPod).*? OS (\d+)[_\d]*/.exec(ua))) os = 'iOS ' + m[1];
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/Linux|X11/.test(ua)) os = 'Linux';
  let browser = 'Unbekannt';
  if (/Edg(?:e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return { os, browser };
}

// Protokoll: Registrierungen und Logins (neueste zuletzt gespeichert, höchstens LOG_MAX Einträge)
function addLog(event, user, name, ip, client = {}) {
  store.log.push({
    id: store.nextLogId++,
    time: new Date().toISOString(),
    userId: user ? user.id : null,
    name: String(name || '').slice(0, 40),
    event,
    ip: ip || '',
    os: client.os || '',
    browser: client.browser || '',
  });
  if (store.log.length > LOG_MAX) store.log.splice(0, store.log.length - LOG_MAX);
  save();
}

function listLog(limit = 500) {
  return store.log.slice(-limit).reverse();
}

// ---------- Ausgabeformate ----------

function publicUser(u) {
  return { id: u.id, name: u.name, rank: u.rank };
}

function adminUser(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    rank: u.rank,
    registeredAt: u.registeredAt,
    ip: u.ip,
    os: u.os || '',
    browser: u.browser || '',
    online: isOnline(u.id),
    locked: sameName(u.name, OWNER_NAME),
  };
}

// ---------- Aktionen ----------

async function register({ name, email, password }, ip, client = {}) {
  name = str(name).trim();
  email = str(email).trim().toLowerCase();
  password = str(password);
  validateName(name);
  validateEmail(email);
  validatePassword(password);

  const isOwner = sameName(name, OWNER_NAME);
  // Optionaler Schutz: Ist SYSADMIN_EMAIL gesetzt, darf nur diese Adresse den Sysadmin-Namen belegen.
  const ownerEmail = (process.env.SYSADMIN_EMAIL || '').trim().toLowerCase();
  if (isOwner && ownerEmail && email !== ownerEmail) {
    throw new HttpError(403, 'Dieser Accountname ist reserviert.');
  }

  if (store.users.some((u) => sameName(u.name, name))) {
    throw new HttpError(409, 'Dieser Accountname ist bereits vergeben.');
  }
  if (store.users.some((u) => u.email === email)) {
    throw new HttpError(409, 'Diese E-Mail-Adresse ist bereits registriert.');
  }

  const passwordHash = await hashPassword(password);
  // Während des Hashings könnte ein anderer Request dieselben Daten belegt haben.
  if (store.users.some((u) => sameName(u.name, name) || u.email === email)) {
    throw new HttpError(409, 'Accountname oder E-Mail-Adresse bereits vergeben.');
  }

  const user = {
    id: store.nextId++,
    name: isOwner ? OWNER_NAME : name,
    email,
    passwordHash,
    rank: isOwner ? 'Sysadmin' : 'Spieler',
    registeredAt: new Date().toISOString(),
    ip,
    os: client.os || '',
    browser: client.browser || '',
  };
  store.users.push(user);
  addLog('register', user, user.name, ip, client);
  return user;
}

async function login({ name, password }, ip = '', client = {}) {
  const login = str(name).trim().toLowerCase();
  password = str(password);
  const user = store.users.find((u) => u.name.toLowerCase() === login || u.email === login);

  // Immer hashen, damit die Antwortzeit nicht verrät, ob der Account existiert.
  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    // Fehlversuche nur für bestehende Accounts protokollieren (keine Einträge für beliebige eingetippte Namen)
    if (user) addLog('loginFailed', user, user.name, ip, client);
    throw new HttpError(401, 'Accountname oder Passwort ist falsch.');
  }
  addLog('login', user, user.name, ip, client);
  return user;
}

function createSession(user) {
  pruneSessions();
  const token = crypto.randomBytes(32).toString('hex');
  store.sessions[hashToken(token)] = { userId: user.id, expires: Date.now() + SESSION_MS };
  save();
  return token;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function userFromToken(token) {
  if (!token) return null;
  const s = store.sessions[hashToken(token)];
  if (!s || s.expires < Date.now()) return null;
  return store.users.find((u) => u.id === s.userId) || null;
}

function destroySession(token) {
  if (!token) return;
  delete store.sessions[hashToken(token)];
  save();
}

function listUsers() {
  return store.users.map(adminUser);
}

function updateUser(id, changes) {
  const user = store.users.find((u) => u.id === id);
  if (!user) throw new HttpError(404, 'Account nicht gefunden.');
  const locked = sameName(user.name, OWNER_NAME);

  if (changes.rank !== undefined) {
    if (!RANKS.includes(changes.rank)) throw new HttpError(400, 'Ungültiger Rang.');
    if (locked && changes.rank !== 'Sysadmin') {
      throw new HttpError(403, `Der Rang von ${OWNER_NAME} kann nicht geändert werden.`);
    }
  }
  if (changes.ip !== undefined && (typeof changes.ip !== 'string' || !net.isIP(changes.ip))) {
    throw new HttpError(400, 'Ungültige IP-Adresse.');
  }
  let registeredAt;
  if (changes.registeredAt !== undefined) {
    const t = typeof changes.registeredAt === 'string' ? Date.parse(changes.registeredAt) : NaN;
    if (Number.isNaN(t)) throw new HttpError(400, 'Ungültiges Registrierungsdatum.');
    registeredAt = new Date(t).toISOString();
  }

  if (changes.rank !== undefined) user.rank = changes.rank;
  if (changes.ip !== undefined) user.ip = changes.ip;
  if (registeredAt !== undefined) user.registeredAt = registeredAt;
  save();
  return user;
}

// ---------- Speicherstände: Platz 0 = Auto-Save, 1–10 = eigene Speicherstände (pro Account und Platz eine Datei) ----------

const SAVE_SLOTS = 10;
const slotFile = (userId, slot) => path.join(SAVE_DIR, String(Number(userId)), `${slot}.json`);

// Früher gab es nur einen Speicherstand pro Account (saves/<id>.json): er wird zu Platz 1
function migrateOldSave(userId) {
  const old = path.join(SAVE_DIR, `${Number(userId)}.json`);
  if (!fs.existsSync(old)) return;
  fs.mkdirSync(path.dirname(slotFile(userId, 1)), { recursive: true });
  if (!fs.existsSync(slotFile(userId, 1))) fs.renameSync(old, slotFile(userId, 1));
  else fs.unlinkSync(old);
}

function readSlot(userId, slot) {
  try {
    return JSON.parse(fs.readFileSync(slotFile(userId, slot), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function summarize(save) {
  const st = save && typeof save.stats === 'object' && save.stats ? save.stats : {};
  return { who: String((save && save.who) || 'jason'), money: Math.floor(Number(save && save.money) || 0), missions: Number(st.missionsDone) || 0, playMs: Number(st.playMs) || 0 };
}

// slot weglassen: neuester Speicherstand aller Plätze
function getSave(userId, slot) {
  migrateOldSave(userId);
  if (slot !== undefined) return readSlot(userId, slot);
  let best = null;
  for (let i = 0; i <= SAVE_SLOTS; i++) {
    const d = readSlot(userId, i);
    if (d && (!best || d.savedAt > best.savedAt)) best = d;
  }
  return best;
}

function putSave(userId, slot, save) {
  migrateOldSave(userId);
  const file = slotFile(userId, slot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  const wrapped = { savedAt: new Date().toISOString(), save };
  fs.writeFileSync(tmp, JSON.stringify(wrapped));
  fs.renameSync(tmp, file);
  return wrapped.savedAt;
}

// Übersicht aller belegten Plätze (Auto-Save zuerst)
function listSaves(userId) {
  migrateOldSave(userId);
  const out = [];
  for (let i = 0; i <= SAVE_SLOTS; i++) {
    const d = readSlot(userId, i);
    if (d) out.push({ slot: i, savedAt: d.savedAt, summary: summarize(d.save) });
  }
  return out;
}

load();

module.exports = {
  SAVE_SLOTS,
  listSaves,
  setPresence,
  clientInfo,
  listLog,
  getSave,
  putSave,
  HttpError,
  RANKS,
  register,
  login,
  createSession,
  userFromToken,
  destroySession,
  listUsers,
  updateUser,
  publicUser,
  adminUser,
  SESSION_MS,
};
