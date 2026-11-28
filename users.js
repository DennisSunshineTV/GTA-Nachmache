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
  // Freundschaften: Paare (a < b), Anfragen (pending/declined) und Mitteilungen
  if (!Array.isArray(store.friends)) store.friends = [];
  if (!Array.isArray(store.friendRequests)) store.friendRequests = [];
  if (!Array.isArray(store.notifications)) store.notifications = [];
  if (!store.nextReqId) store.nextReqId = 1;
  if (!store.nextNoteId) store.nextNoteId = 1;
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

// ---------- Freundschaften ----------
// Mitglieder suchen, Anfragen schicken, annehmen oder ablehnen. Wer abgelehnt wurde, kann derselben Person erst
// 24 Stunden später wieder eine Anfrage schicken. Über jede Antwort bekommt der Absender eine Mitteilung.

const DECLINE_BLOCK_MS = 24 * 60 * 60 * 1000;
const NOTE_MAX = 50;              // Mitteilungen pro Mitglied, die aufbewahrt werden

const pairKey = (a, b) => (a < b ? [a, b] : [b, a]);
const areFriends = (a, b) => { const [x, y] = pairKey(a, b); return store.friends.some((f) => f.a === x && f.b === y); };
const userById = (id) => store.users.find((u) => u.id === id) || null;

function pruneFriendRequests() {
  const now = Date.now();
  store.friendRequests = store.friendRequests.filter((r) => r.status === 'pending' || (r.status === 'declined' && now - r.decidedAt < DECLINE_BLOCK_MS));
}

function addNote(userId, text) {
  store.notifications.push({ id: store.nextNoteId++, userId, text, time: new Date().toISOString(), read: false });
  const mine = store.notifications.filter((n) => n.userId === userId);
  if (mine.length > NOTE_MAX) {
    const drop = new Set(mine.slice(0, mine.length - NOTE_MAX).map((n) => n.id));
    store.notifications = store.notifications.filter((n) => !drop.has(n.id));
  }
}

// Wartezeit (ms), bis „from“ an „to“ wieder eine Anfrage schicken darf (0 = sofort)
function declineWait(from, to) {
  const now = Date.now();
  let wait = 0;
  for (const r of store.friendRequests) {
    if (r.from === from && r.to === to && r.status === 'declined') wait = Math.max(wait, r.decidedAt + DECLINE_BLOCK_MS - now);
  }
  return Math.max(0, wait);
}

function relationTo(meId, otherId) {
  if (areFriends(meId, otherId)) return { relation: 'friend' };
  if (store.friendRequests.some((r) => r.status === 'pending' && r.from === meId && r.to === otherId)) return { relation: 'outgoing' };
  const inc = store.friendRequests.find((r) => r.status === 'pending' && r.from === otherId && r.to === meId);
  if (inc) return { relation: 'incoming', requestId: inc.id };
  const wait = declineWait(meId, otherId);
  if (wait > 0) return { relation: 'blocked', waitMs: wait };
  return { relation: 'none' };
}

// Namen bestehen nur aus Buchstaben und Zahlen; alles andere wird aus der Suche entfernt (wie in der PHP-Variante)
function searchMembers(me, q) {
  q = str(q).replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  if (q.length < 2) return [];
  pruneFriendRequests();
  return store.users
    .filter((u) => u.id !== me.id && u.name.toLowerCase().includes(q))
    .sort((a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name, 'de'))
    .slice(0, 20)
    .map((u) => ({ id: u.id, name: u.name, rank: u.rank, online: isOnline(u.id), ...relationTo(me.id, u.id) }));
}

function friendsOverview(me) {
  pruneFriendRequests();
  const friends = store.friends
    .filter((f) => f.a === me.id || f.b === me.id)
    .map((f) => { const u = userById(f.a === me.id ? f.b : f.a); return u ? { id: u.id, name: u.name, rank: u.rank, online: isOnline(u.id), since: f.since } : null; })
    .filter(Boolean)
    .sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name, 'de'));
  const incoming = store.friendRequests.filter((r) => r.status === 'pending' && r.to === me.id)
    .map((r) => { const u = userById(r.from); return u ? { id: r.id, from: { id: u.id, name: u.name }, createdAt: r.createdAt } : null; }).filter(Boolean);
  const outgoing = store.friendRequests.filter((r) => r.status === 'pending' && r.from === me.id)
    .map((r) => { const u = userById(r.to); return u ? { id: r.id, to: { id: u.id, name: u.name }, createdAt: r.createdAt } : null; }).filter(Boolean);
  const notifications = store.notifications.filter((n) => n.userId === me.id && !n.read).map((n) => ({ id: n.id, text: n.text, time: n.time }));
  return { friends, incoming, outgoing, notifications };
}

function waitText(ms) {
  const min = Math.max(1, Math.ceil(ms / 60000));
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h} Std.${m ? ' ' + m + ' Min.' : ''}` : `${m} Min.`;
}

function sendFriendRequest(me, { name, userId }) {
  pruneFriendRequests();
  const target = userId !== undefined && userId !== null
    ? userById(Number(userId))
    : store.users.find((u) => sameName(u.name, str(name).trim()));
  if (!target) throw new HttpError(404, 'Mitglied nicht gefunden.');
  if (target.id === me.id) throw new HttpError(400, 'Du kannst dir nicht selbst eine Freundschaftsanfrage schicken.');
  if (areFriends(me.id, target.id)) throw new HttpError(409, `Du bist mit ${target.name} bereits befreundet.`);
  if (store.friendRequests.some((r) => r.status === 'pending' && r.from === me.id && r.to === target.id)) throw new HttpError(409, `Du hast ${target.name} bereits eine Anfrage geschickt.`);
  if (store.friendRequests.some((r) => r.status === 'pending' && r.from === target.id && r.to === me.id)) throw new HttpError(409, `${target.name} hat dir bereits eine Anfrage geschickt – du findest sie oben rechts unter „Ausloggen“.`);
  const wait = declineWait(me.id, target.id);
  if (wait > 0) throw new HttpError(429, `${target.name} hat deine Freundschaftsanfrage abgelehnt. Eine neue Anfrage ist erst 24 Stunden danach möglich (noch ${waitText(wait)}).`);
  store.friendRequests = store.friendRequests.filter((r) => !(r.from === me.id && r.to === target.id));
  const req = { id: store.nextReqId++, from: me.id, to: target.id, createdAt: new Date().toISOString(), status: 'pending', decidedAt: 0 };
  store.friendRequests.push(req);
  save();
  return { id: req.id, to: { id: target.id, name: target.name } };
}

function respondFriendRequest(me, { id, accept }) {
  const req = store.friendRequests.find((r) => r.id === Number(id) && r.status === 'pending' && r.to === me.id);
  if (!req) throw new HttpError(404, 'Diese Freundschaftsanfrage gibt es nicht mehr.');
  const from = userById(req.from);
  if (accept) {
    store.friendRequests = store.friendRequests.filter((r) => r !== req && !(r.status === 'pending' && r.from === me.id && r.to === req.from));
    if (from && !areFriends(me.id, from.id)) { const [a, b] = pairKey(me.id, from.id); store.friends.push({ a, b, since: new Date().toISOString() }); }
    if (from) addNote(from.id, `${me.name} hat deine Freundschaftsanfrage angenommen.`);
  } else {
    req.status = 'declined'; req.decidedAt = Date.now();
    if (from) addNote(from.id, `${me.name} hat deine Freundschaftsanfrage abgelehnt.`);
  }
  save();
  return { ok: true, accepted: !!accept };
}

function removeFriend(me, { userId }) {
  const [a, b] = pairKey(me.id, Number(userId));
  const before = store.friends.length;
  store.friends = store.friends.filter((f) => !(f.a === a && f.b === b));
  if (store.friends.length === before) throw new HttpError(404, 'Diese Freundschaft gibt es nicht.');
  save();
  return { ok: true };
}

function cancelFriendRequest(me, { id }) {
  const before = store.friendRequests.length;
  store.friendRequests = store.friendRequests.filter((r) => !(r.id === Number(id) && r.from === me.id && r.status === 'pending'));
  if (store.friendRequests.length === before) throw new HttpError(404, 'Diese Anfrage gibt es nicht mehr.');
  save();
  return { ok: true };
}

function readNotifications(me, { ids }) {
  const set = Array.isArray(ids) ? new Set(ids.map(Number)) : null;
  for (const n of store.notifications) if (n.userId === me.id && (!set || set.has(n.id))) n.read = true;
  store.notifications = store.notifications.filter((n) => !n.read);
  save();
  return { ok: true };
}

// ---------- Multiplayer ----------
// Zwei Server mit je höchstens 16 Spielern. Die Spielzustände liegen nur im Speicher; wer sich 15 s nicht meldet,
// gilt als gegangen. Jede Anmeldung bekommt ein eigenes Zufalls-Token, mit dem das Spiel seinen Zustand meldet.

const MP_SERVERS = [{ id: 1, name: 'Server 1' }, { id: 2, name: 'Server 2' }];
const MP_MAX = 16;
const MP_TIMEOUT = 15_000;
const mpRooms = new Map(MP_SERVERS.map((s) => [s.id, new Map()]));

function mpPrune() {
  const now = Date.now();
  for (const room of mpRooms.values()) for (const [id, p] of room) if (now - p.seen > MP_TIMEOUT) room.delete(id);
}

function mpServers() {
  mpPrune();
  return MP_SERVERS.map((s) => ({ id: s.id, name: s.name, players: mpRooms.get(s.id).size, max: MP_MAX }));
}

function mpRoom(server) {
  const room = mpRooms.get(Number(server));
  if (!room) throw new HttpError(400, 'Unbekannter Server.');
  return room;
}

const finite = (v, lim) => { const n = Number(v); return Number.isFinite(n) ? Math.max(-lim, Math.min(lim, n)) : 0; };
const word = (v, max = 12) => (typeof v === 'string' && /^[A-Za-z0-9_]{1,24}$/.test(v) ? v.slice(0, max) : '');

// Nur bekannte Felder mit gültigen Werten übernehmen (der Zustand kommt vom Browser)
function mpCleanState(st) {
  if (!st || typeof st !== 'object') return null;
  const out = {
    x: finite(st.x, 30000), y: finite(st.y, 5000), z: finite(st.z, 30000), h: finite(st.h, 100), s: finite(st.s, 300),
    m: word(st.m, 8) || 'walk', w: word(st.w), c: st.c === 'lucia' ? 'lucia' : 'jason',
    a: st.a ? 1 : 0, cr: st.cr ? 1 : 0, ph: st.ph ? 1 : 0, ap: finite(st.ap, 2),
  };
  if (st.v && typeof st.v === 'object' && word(st.v.t)) {
    const v = st.v;
    out.v = { t: word(v.t), p: Math.max(0, Math.min(30, Math.floor(finite(v.p, 30)))), x: finite(v.x, 30000), y: finite(v.y, 5000), z: finite(v.z, 30000), h: finite(v.h, 100), pi: finite(v.pi, 4), ro: finite(v.ro, 4), st: finite(v.st, 2), sp: finite(v.sp, 300), l: v.l ? 1 : 0, si: v.si ? 1 : 0, seat: Math.max(0, Math.min(3, Math.floor(finite(v.seat, 3)))) };
  }
  return out;
}

const mpPublic = (p, now) => ({ id: p.id, name: p.name, st: p.st, age: now - p.seen });

function mpJoin(me, server) {
  mpPrune();
  const room = mpRoom(server);
  for (const r of mpRooms.values()) if (r !== room) r.delete(me.id);   // nur auf einem Server gleichzeitig
  if (!room.has(me.id) && room.size >= MP_MAX) {
    const s = MP_SERVERS.find((x) => x.id === Number(server));
    throw new HttpError(409, `${s.name} ist voll (${MP_MAX} von ${MP_MAX}). Bitte versuche es auf dem anderen Server.`);
  }
  const now = Date.now();
  const token = `${me.id}.${crypto.randomBytes(16).toString('hex')}`;   // gleiches Format wie die PHP-Variante
  room.set(me.id, { id: me.id, name: me.name, token, joined: now, seen: now, st: null });
  return { ok: true, server: Number(server), token, you: { id: me.id, name: me.name }, max: MP_MAX, now, players: [...room.values()].filter((p) => p.id !== me.id && p.st).map((p) => mpPublic(p, now)) };
}

function mpSync({ server, token, st }) {
  const room = mpRoom(server);
  const me = [...room.values()].find((p) => typeof token === 'string' && p.token === token);
  if (!me) throw new HttpError(409, 'Die Verbindung zum Server ist abgelaufen.');
  const now = Date.now();
  if (now - me.seen > MP_TIMEOUT) { room.delete(me.id); throw new HttpError(409, 'Die Verbindung zum Server ist abgelaufen.'); }
  me.seen = now;
  const clean = mpCleanState(st);
  if (clean) me.st = clean;
  setPresence(me.id);
  const players = [];
  for (const p of room.values()) if (p !== me && p.st && now - p.seen <= MP_TIMEOUT) players.push(mpPublic(p, now));
  return { ok: true, now, count: room.size, max: MP_MAX, players };
}

function mpLeave({ server, token }) {
  const room = mpRooms.get(Number(server));
  if (!room) return { ok: true };
  for (const [id, p] of room) if (typeof token === 'string' && p.token === token) room.delete(id);
  return { ok: true };
}

// ---------- Speicherstände: Platz 0 = Auto-Save, 1–5 = eigene Speicherplätze (pro Account und Platz eine Datei) ----------
// Früher gab es 10 Plätze: Stände in 6–10 lassen sich weiterhin laden, gespeichert wird nur noch in 1–5.

const SAVE_SLOTS = 10;
const SAVE_SLOTS_WRITE = 5;
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
  SAVE_SLOTS_WRITE,
  searchMembers,
  friendsOverview,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  cancelFriendRequest,
  readNotifications,
  mpServers,
  mpJoin,
  mpSync,
  mpLeave,
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
