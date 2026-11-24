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

let store = { nextId: 1, users: [], sessions: {} };

function load() {
  try {
    store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
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
    locked: sameName(u.name, OWNER_NAME),
  };
}

// ---------- Aktionen ----------

async function register({ name, email, password }, ip) {
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
  };
  store.users.push(user);
  save();
  return user;
}

async function login({ name, password }) {
  const login = str(name).trim().toLowerCase();
  password = str(password);
  const user = store.users.find((u) => u.name.toLowerCase() === login || u.email === login);

  // Immer hashen, damit die Antwortzeit nicht verrät, ob der Account existiert.
  const ok = await verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Accountname oder Passwort ist falsch.');
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

// ---------- Speicherstände (pro Account eine Datei) ----------

function getSave(userId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(SAVE_DIR, `${Number(userId)}.json`), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function putSave(userId, save) {
  fs.mkdirSync(SAVE_DIR, { recursive: true });
  const file = path.join(SAVE_DIR, `${Number(userId)}.json`);
  const tmp = file + '.tmp';
  const wrapped = { savedAt: new Date().toISOString(), save };
  fs.writeFileSync(tmp, JSON.stringify(wrapped));
  fs.renameSync(tmp, file);
  return wrapped.savedAt;
}

load();

module.exports = {
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
