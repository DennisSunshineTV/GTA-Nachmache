const http = require('http');
const fs = require('fs');
const path = require('path');
const users = require('./users');

const PORT = process.env.PORT || 3000;
// Nur hinter einem vertrauenswürdigen Reverse-Proxy aktivieren (liest X-Forwarded-*).
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

// ---------- Hilfsfunktionen ----------

function clientIp(req) {
  let ip = req.socket.remoteAddress || '';
  if (TRUST_PROXY && req.headers['x-forwarded-for']) {
    ip = String(req.headers['x-forwarded-for']).split(',')[0].trim();
  }
  return ip.replace(/^::ffff:/, '');
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function readJson(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) {
      return reject(new users.HttpError(415, 'JSON erwartet.'));
    }
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new users.HttpError(413, 'Anfrage zu groß.'));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error();
        resolve(data);
      } catch {
        reject(new users.HttpError(400, 'Ungültiges JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function getToken(req) {
  const m = /(?:^|;\s*)session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

function sessionCookie(req, token, maxAgeSec) {
  const secure = req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

// Einfaches Rate-Limit pro IP (im Speicher).
const buckets = new Map();
function rateLimit(key, ip, max, windowMs) {
  const id = `${key}:${ip}`;
  const now = Date.now();
  let b = buckets.get(id);
  if (!b || b.reset < now) b = { count: 0, reset: now + windowMs };
  b.count++;
  buckets.set(id, b);
  if (b.count > max) throw new users.HttpError(429, 'Zu viele Versuche. Bitte später erneut versuchen.');
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k);
}, 60_000).unref();

// ---------- API ----------

async function handleApi(req, res, urlPath) {
  const ip = clientIp(req);
  const token = getToken(req);
  const me = users.userFromToken(token);
  const method = req.method;

  if (urlPath === '/api/me' && method === 'GET') {
    return sendJson(res, 200, { user: me ? users.publicUser(me) : null });
  }

  if (urlPath === '/api/register' && method === 'POST') {
    rateLimit('register', ip, 10, 60 * 60_000);
    const user = await users.register(await readJson(req), ip);
    const t = users.createSession(user);
    return sendJson(res, 201, { user: users.publicUser(user) }, {
      'Set-Cookie': sessionCookie(req, t, users.SESSION_MS / 1000),
    });
  }

  if (urlPath === '/api/login' && method === 'POST') {
    rateLimit('login', ip, 10, 15 * 60_000);
    const user = await users.login(await readJson(req));
    const t = users.createSession(user);
    return sendJson(res, 200, { user: users.publicUser(user) }, {
      'Set-Cookie': sessionCookie(req, t, users.SESSION_MS / 1000),
    });
  }

  if (urlPath === '/api/logout' && method === 'POST') {
    users.destroySession(token);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // Speicherstand (ein Slot pro Account)
  if (urlPath === '/api/save') {
    if (!me) throw new users.HttpError(401, 'Bitte einloggen.');
    if (method === 'GET') {
      const data = users.getSave(me.id);
      return sendJson(res, 200, data ? { save: data.save, savedAt: data.savedAt } : { save: null });
    }
    if (method === 'PUT' || method === 'POST') {
      rateLimit('save', ip, 60, 60_000);
      const body = await readJson(req, 300_000);
      if (!body.save || typeof body.save !== 'object') throw new users.HttpError(400, 'Kein Speicherstand übergeben.');
      return sendJson(res, 200, { ok: true, savedAt: users.putSave(me.id, body.save) });
    }
  }

  // Admin-Bereich: Sysadmin und Admin dürfen ansehen, nur Sysadmin darf ändern.
  if (urlPath === '/api/admin/users' && method === 'GET') {
    if (!me || !['Sysadmin', 'Admin'].includes(me.rank)) throw new users.HttpError(403, 'Kein Zugriff.');
    return sendJson(res, 200, { users: users.listUsers(), canEdit: me.rank === 'Sysadmin', ranks: users.RANKS });
  }

  const m = /^\/api\/admin\/users\/(\d+)$/.exec(urlPath);
  if (m && method === 'PATCH') {
    if (!me || me.rank !== 'Sysadmin') throw new users.HttpError(403, 'Nur Sysadmins dürfen Accounts ändern.');
    const { rank, registeredAt, ip: newIp } = await readJson(req);
    const updated = users.updateUser(Number(m[1]), { rank, registeredAt, ip: newIp });
    return sendJson(res, 200, { user: users.adminUser(updated) });
  }

  throw new users.HttpError(404, 'Nicht gefunden.');
}

// ---------- Statische Dateien ----------

// Öffentlich: Startseite + Bilder. Nur für eingeloggte Spieler: Spielcode (game/) und Bibliotheken (vendor/).
const STATIC_DIRS = [
  { prefix: '/assets/', dir: path.join(__dirname, 'assets'), auth: false },
  { prefix: '/game/', dir: path.join(__dirname, 'game'), auth: true },
  { prefix: '/vendor/', dir: path.join(__dirname, 'vendor'), auth: true },
];

function serveStatic(req, res, urlPath) {
  let file;
  if (urlPath === '/' || urlPath === '/index.html') {
    file = path.join(__dirname, 'index.html');
  } else {
    const entry = STATIC_DIRS.find((d) => urlPath.startsWith(d.prefix));
    if (!entry) {
      res.writeHead(404);
      return res.end('Nicht gefunden');
    }
    file = path.normalize(path.join(__dirname, urlPath));
    // Nur Dateien innerhalb des freigegebenen Ordners ausliefern
    if (!file.startsWith(entry.dir + path.sep)) {
      res.writeHead(403);
      return res.end('Verboten');
    }
    if (entry.auth && !users.userFromToken(getToken(req))) {
      res.writeHead(401);
      return res.end('Bitte einloggen.');
    }
  }

  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404);
      return res.end('Nicht gefunden');
    }
    const etag = `W/"${st.size}-${Math.round(st.mtimeMs)}"`;
    const headers = {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    fs.readFile(file, (err2, data) => {
      if (err2) {
        res.writeHead(404);
        return res.end('Nicht gefunden');
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
}

http.createServer(async (req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.url.split('?')[0]);
  } catch {
    res.writeHead(400);
    return res.end('Ungültige URL');
  }

  if (urlPath.startsWith('/api/')) {
    try {
      await handleApi(req, res, urlPath);
    } catch (err) {
      if (!(err instanceof users.HttpError)) console.error(err);
      if (!res.headersSent) {
        const status = err instanceof users.HttpError ? err.status : 500;
        sendJson(res, status, { error: status === 500 ? 'Serverfehler.' : err.message });
      }
    }
    return;
  }

  serveStatic(req, res, urlPath);
}).listen(PORT, () => console.log(`Läuft auf http://localhost:${PORT}`));
