<?php
// Gemeinsame Funktionen der PHP-API (ALL-INKL): Datenbank, Sessions, Validierung, JSON-Antworten.
// Entspricht der Node-Variante (server.js / users.js), damit index.html und das Spiel unverändert laufen.
declare(strict_types=1);

const OWNER_NAME = 'DennisSunshineTV';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const RANKS = ['Sysadmin', 'Admin', 'Spieler'];
// Gültiger bcrypt-Hash eines zufälligen Passworts: wird beim Login mit unbekanntem Account geprüft,
// damit die Antwortzeit nicht verrät, ob der Account existiert.
const DUMMY_HASH = '$2y$10$dnW2y5K/M3qgRvsOil9emuqrLe0psjEnW.Htwby7gnL1DiIiG4oz/';

// Optionale Einstellungen: api/config.php kann SYSADMIN_EMAIL definieren (nur diese Adresse darf sich als Sysadmin registrieren).
if (is_file(__DIR__ . '/config.php')) {
    require __DIR__ . '/config.php';
}

final class HttpError extends RuntimeException
{
    public int $status;

    public function __construct(int $status, string $message)
    {
        parent::__construct($message, $status);
        $this->status = $status;
    }
}

// ---------- Antworten ----------

function sendJson(int $status, array $body)
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}

function sendError(int $status, string $message)
{
    sendJson($status, ['error' => $message]);
}

function clientIp(): string
{
    // Nur die direkte Verbindung zählt (X-Forwarded-For lässt sich fälschen).
    return (string)($_SERVER['REMOTE_ADDR'] ?? '');
}

function isHttps(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

// Ist das Array eine Liste (Schlüssel 0, 1, 2 …)? Entspricht array_is_list() ab PHP 8.1
function isList(array $a): bool
{
    $i = 0;
    foreach ($a as $k => $_) {
        if ($k !== $i++) {
            return false;
        }
    }
    return true;
}

function readBody(int $limit): string
{
    $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
    if ($raw === false) {
        $raw = '';
    }
    if (strlen($raw) > $limit) {
        throw new HttpError(413, 'Anfrage zu groß.');
    }
    return $raw;
}

function requireJsonRequest(): void
{
    $type = (string)($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? '');
    if (!str_starts_with(strtolower($type), 'application/json')) {
        throw new HttpError(415, 'JSON erwartet.');
    }
}

function readJson(int $limit = 10000): array
{
    requireJsonRequest();
    $raw = readBody($limit);
    $data = json_decode($raw === '' ? '{}' : $raw, true);
    if (!is_array($data) || ($data !== [] && isList($data))) {
        throw new HttpError(400, 'Ungültiges JSON.');
    }
    return $data;
}

// ---------- Datenbank (SQLite) ----------

function dataDir(): string
{
    return __DIR__ . '/data';
}

function ensureDataDir(): string
{
    $dir = dataDir();
    if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) {
        throw new RuntimeException('Der Ordner api/data kann nicht angelegt werden.');
    }
    // Der Datenordner darf nie von außen lesbar sein (Passwort-Hashes, E-Mail-Adressen, Speicherstände)
    $ht = $dir . '/.htaccess';
    if (!is_file($ht)) {
        @file_put_contents($ht, "Require all denied\n<IfModule !mod_authz_core.c>\n  Order deny,allow\n  Deny from all\n</IfModule>\n");
    }
    return $dir;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $dir = ensureDataDir();
    $pdo = new PDO('sqlite:' . $dir . '/game.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA busy_timeout = 8000');
    $pdo->exec('PRAGMA foreign_keys = ON');
    $version = (int)$pdo->query('PRAGMA user_version')->fetchColumn();
    if ($version >= 4) {
        return $pdo;
    }
    $pdo->exec('CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        rank TEXT NOT NULL DEFAULT \'Spieler\',
        registered_at TEXT NOT NULL,
        ip TEXT NOT NULL DEFAULT \'\'
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires INTEGER NOT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS saves (
        user_id INTEGER PRIMARY KEY,
        saved_at TEXT NOT NULL,
        data TEXT NOT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS rate (
        k TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        reset INTEGER NOT NULL
    )');
    // Version 2: Betriebssystem und Browser bei der Registrierung, Protokoll der Registrierungen und Logins
    $cols = array_column($pdo->query('PRAGMA table_info(users)')->fetchAll(), 'name');
    // Version 3: Anwesenheit (last_seen = Unix-Zeit des letzten Lebenszeichens aus dem Spiel)
    foreach (['os' => "TEXT NOT NULL DEFAULT ''", 'browser' => "TEXT NOT NULL DEFAULT ''", 'last_seen' => 'INTEGER NOT NULL DEFAULT 0'] as $col => $def) {
        if (!in_array($col, $cols, true)) {
            try {
                $pdo->exec('ALTER TABLE users ADD COLUMN ' . $col . ' ' . $def);
            } catch (PDOException $e) {
                // Gleichzeitiger Aufruf hat die Spalte schon angelegt
            }
        }
    }
    $pdo->exec('CREATE TABLE IF NOT EXISTS log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        time TEXT NOT NULL,
        user_id INTEGER,
        name TEXT NOT NULL DEFAULT \'\',
        event TEXT NOT NULL,
        ip TEXT NOT NULL DEFAULT \'\',
        os TEXT NOT NULL DEFAULT \'\',
        browser TEXT NOT NULL DEFAULT \'\'
    )');
    // Version 4: mehrere Speicherplätze (0 = Auto-Save, 1–10 = eigene); der frühere Einzel-Speicherstand wird zu Platz 1
    $pdo->exec('CREATE TABLE IF NOT EXISTS save_slots (
        user_id INTEGER NOT NULL,
        slot INTEGER NOT NULL,
        saved_at TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT \'\',
        data TEXT NOT NULL,
        PRIMARY KEY (user_id, slot)
    )');
    $pdo->exec("INSERT OR IGNORE INTO save_slots (user_id, slot, saved_at, summary, data) SELECT user_id, 1, saved_at, '', data FROM saves");
    $pdo->exec('PRAGMA user_version = 4');
    return $pdo;
}

function isoNow(): string
{
    $t = microtime(true);
    return gmdate('Y-m-d\TH:i:s', (int)$t) . sprintf('.%03dZ', (int)(($t - floor($t)) * 1000));
}

// Betriebssystem und Browser aus dem User-Agent (gleiche Erkennung wie users.js)
function parseUserAgent(string $ua): array
{
    $ua = substr($ua, 0, 400);
    $os = 'Unbekannt';
    $m = [];
    if (preg_match('/Windows NT 10\.0/', $ua)) {
        $os = 'Windows 10/11';
    } elseif (preg_match('/Windows NT 6\.3/', $ua)) {
        $os = 'Windows 8.1';
    } elseif (preg_match('/Windows NT 6\.2/', $ua)) {
        $os = 'Windows 8';
    } elseif (preg_match('/Windows NT 6\.1/', $ua)) {
        $os = 'Windows 7';
    } elseif (preg_match('/Windows/', $ua)) {
        $os = 'Windows';
    } elseif (preg_match('/Android ([\d.]+)/', $ua, $m)) {
        $os = 'Android ' . explode('.', $m[1])[0];
    } elseif (preg_match('/Android/', $ua)) {
        $os = 'Android';
    } elseif (preg_match('/(?:iPhone|iPad|iPod).*? OS (\d+)[_\d]*/', $ua, $m)) {
        $os = 'iOS ' . $m[1];
    } elseif (preg_match('/iPhone|iPad|iPod/', $ua)) {
        $os = 'iOS';
    } elseif (preg_match('/CrOS/', $ua)) {
        $os = 'ChromeOS';
    } elseif (preg_match('/Mac OS X|Macintosh/', $ua)) {
        $os = 'macOS';
    } elseif (preg_match('/Linux|X11/', $ua)) {
        $os = 'Linux';
    }
    $browser = 'Unbekannt';
    if (preg_match('/Edg(?:e|A|iOS)?\//', $ua)) {
        $browser = 'Edge';
    } elseif (preg_match('/OPR\/|Opera/', $ua)) {
        $browser = 'Opera';
    } elseif (preg_match('/Firefox\/|FxiOS\//', $ua)) {
        $browser = 'Firefox';
    } elseif (preg_match('/Chrome\/|CriOS\//', $ua)) {
        $browser = 'Chrome';
    } elseif (preg_match('/Safari\//', $ua)) {
        $browser = 'Safari';
    }
    return ['os' => $os, 'browser' => $browser];
}

// Protokoll: Registrierungen und Logins (höchstens 5000 Einträge werden behalten)
function addLogEntry(string $event, ?array $user, string $name, string $ip, array $client): void
{
    $pdo = db();
    $pdo->prepare('INSERT INTO log (time, user_id, name, event, ip, os, browser) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([isoNow(), $user ? (int)$user['id'] : null, substr($name, 0, 40), $event, $ip, (string)($client['os'] ?? ''), (string)($client['browser'] ?? '')]);
    $pdo->exec('DELETE FROM log WHERE id <= (SELECT MAX(id) FROM log) - 5000');
}

function listLogEntries(int $limit = 500): array
{
    $st = db()->prepare('SELECT id, time, user_id, name, event, ip, os, browser FROM log ORDER BY id DESC LIMIT ?');
    $st->bindValue(1, $limit, PDO::PARAM_INT);
    $st->execute();
    $out = [];
    foreach ($st->fetchAll() as $r) {
        $out[] = [
            'id' => (int)$r['id'],
            'time' => $r['time'],
            'userId' => $r['user_id'] === null ? null : (int)$r['user_id'],
            'name' => $r['name'],
            'event' => $r['event'],
            'ip' => $r['ip'],
            'os' => $r['os'],
            'browser' => $r['browser'],
        ];
    }
    return $out;
}

// Einfaches Rate-Limit pro IP
function rateLimit(string $key, string $ip, int $max, int $windowSeconds): void
{
    $pdo = db();
    $id = $key . ':' . $ip;
    $now = time();
    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM rate WHERE reset < ?')->execute([$now]);
        $st = $pdo->prepare('SELECT count, reset FROM rate WHERE k = ?');
        $st->execute([$id]);
        $row = $st->fetch();
        if (!$row) {
            $pdo->prepare('INSERT INTO rate (k, count, reset) VALUES (?, 1, ?)')->execute([$id, $now + $windowSeconds]);
            $count = 1;
        } else {
            $count = (int)$row['count'] + 1;
            $pdo->prepare('UPDATE rate SET count = ? WHERE k = ?')->execute([$count, $id]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        throw $e;
    }
    if ($count > $max) {
        throw new HttpError(429, 'Zu viele Versuche. Bitte später erneut versuchen.');
    }
}

// ---------- Validierung ----------

function str(mixed $v): string
{
    return is_string($v) ? $v : '';
}

function textLength(string $s): int
{
    return function_exists('mb_strlen') ? mb_strlen($s, 'UTF-8') : strlen($s);
}

function lower(string $s): string
{
    return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
}

function pwKey(string $password): string
{
    return hash('sha256', $password);
}

function validateName(string $name): void
{
    // Nur Buchstaben und Zahlen, mindestens ein Buchstabe (reine Zahlen sind nicht erlaubt)
    if (!preg_match('/^(?=.*[A-Za-z])[A-Za-z0-9]{3,16}$/D', $name)) {
        throw new HttpError(400, 'Accountname: 3–16 Zeichen, nur Buchstaben oder Buchstaben mit Zahlen (nur Zahlen sind nicht erlaubt).');
    }
}

function validateEmail(string $email): void
{
    if (strlen($email) > 254 || !preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/D', $email)) {
        throw new HttpError(400, 'Bitte eine gültige E-Mail-Adresse angeben.');
    }
}

function validatePassword(string $password): void
{
    $n = textLength($password);
    if ($n < 8 || $n > 128) {
        throw new HttpError(400, 'Das Passwort muss 8–128 Zeichen lang sein.');
    }
}

function sameName(string $a, string $b): bool
{
    return lower($a) === lower($b);
}

// ---------- Ausgabeformate ----------

function publicUser(array $u): array
{
    return ['id' => (int)$u['id'], 'name' => $u['name'], 'rank' => $u['rank']];
}

function adminUser(array $u): array
{
    return [
        'id' => (int)$u['id'],
        'name' => $u['name'],
        'email' => $u['email'],
        'rank' => $u['rank'],
        'registeredAt' => $u['registered_at'],
        'ip' => $u['ip'],
        'os' => (string)($u['os'] ?? ''),
        'browser' => (string)($u['browser'] ?? ''),
        'online' => (time() - (int)($u['last_seen'] ?? 0)) < 75,
        'locked' => sameName($u['name'], OWNER_NAME),
    ];
}

// ---------- Konten ----------

function registerUser(array $body, string $ip, array $client = []): array
{
    $name = trim(str($body['name'] ?? null));
    $email = lower(trim(str($body['email'] ?? null)));
    $password = str($body['password'] ?? null);
    validateName($name);
    validateEmail($email);
    validatePassword($password);

    $isOwner = sameName($name, OWNER_NAME);
    $ownerEmail = defined('SYSADMIN_EMAIL') ? lower(trim((string)SYSADMIN_EMAIL)) : '';
    if ($isOwner && $ownerEmail !== '' && $email !== $ownerEmail) {
        throw new HttpError(403, 'Dieser Accountname ist reserviert.');
    }

    $pdo = db();
    $st = $pdo->prepare('SELECT 1 FROM users WHERE lower(name) = lower(?)');
    $st->execute([$name]);
    if ($st->fetchColumn()) {
        throw new HttpError(409, 'Dieser Accountname ist bereits vergeben.');
    }
    $st = $pdo->prepare('SELECT 1 FROM users WHERE email = ?');
    $st->execute([$email]);
    if ($st->fetchColumn()) {
        throw new HttpError(409, 'Diese E-Mail-Adresse ist bereits registriert.');
    }

    $hash = password_hash(pwKey($password), PASSWORD_DEFAULT);
    $user = [
        'name' => $isOwner ? OWNER_NAME : $name,
        'email' => $email,
        'password_hash' => $hash,
        'rank' => $isOwner ? 'Sysadmin' : 'Spieler',
        'registered_at' => isoNow(),
        'ip' => $ip,
        'os' => (string)($client['os'] ?? ''),
        'browser' => (string)($client['browser'] ?? ''),
    ];
    try {
        $pdo->prepare('INSERT INTO users (name, email, password_hash, rank, registered_at, ip, os, browser) VALUES (:name, :email, :password_hash, :rank, :registered_at, :ip, :os, :browser)')
            ->execute($user);
    } catch (PDOException $e) {
        // Gleichzeitige Registrierung mit denselben Daten
        throw new HttpError(409, 'Accountname oder E-Mail-Adresse bereits vergeben.');
    }
    $user['id'] = (int)$pdo->lastInsertId();
    addLogEntry('register', $user, $user['name'], $ip, $client);
    return $user;
}

function loginUser(array $body, string $ip = '', array $client = []): array
{
    $login = lower(trim(str($body['name'] ?? null)));
    $password = str($body['password'] ?? null);
    $st = db()->prepare('SELECT * FROM users WHERE lower(name) = ? OR email = ? LIMIT 1');
    $st->execute([$login, $login]);
    $user = $st->fetch() ?: null;
    $ok = password_verify(pwKey($password), $user ? $user['password_hash'] : DUMMY_HASH);
    if (!$user || !$ok) {
        // Fehlversuche nur für bestehende Accounts protokollieren (keine Einträge für beliebige eingetippte Namen)
        if ($user) {
            addLogEntry('loginFailed', $user, (string)$user['name'], $ip, $client);
        }
        throw new HttpError(401, 'Accountname oder Passwort ist falsch.');
    }
    addLogEntry('login', $user, (string)$user['name'], $ip, $client);
    // Hash bei Bedarf auf den aktuellen Standard bringen
    if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
        db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash(pwKey($password), PASSWORD_DEFAULT), $user['id']]);
    }
    return $user;
}

// ---------- Sessions ----------

function requestToken(): ?string
{
    $t = $_COOKIE['session'] ?? '';
    return is_string($t) && preg_match('/^[a-f0-9]{64}$/D', $t) ? $t : null;
}

function setSessionCookie(string $value, int $maxAgeSeconds): void
{
    setcookie('session', $value, [
        'expires' => $maxAgeSeconds > 0 ? time() + $maxAgeSeconds : time() - 3600,
        'path' => '/',
        'secure' => isHttps(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

function createSession(array $user): string
{
    $pdo = db();
    $pdo->prepare('DELETE FROM sessions WHERE expires < ?')->execute([time()]);
    $token = bin2hex(random_bytes(32));
    $pdo->prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)')
        ->execute([hash('sha256', $token), (int)$user['id'], time() + SESSION_SECONDS]);
    return $token;
}

function userFromToken(?string $token): ?array
{
    if (!$token) {
        return null;
    }
    $st = db()->prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires >= ?');
    $st->execute([hash('sha256', $token), time()]);
    return $st->fetch() ?: null;
}

function destroySession(?string $token): void
{
    if ($token) {
        db()->prepare('DELETE FROM sessions WHERE token_hash = ?')->execute([hash('sha256', $token)]);
    }
}

function currentUser(): ?array
{
    return userFromToken(requestToken());
}

// ---------- Admin ----------

function listUsers(): array
{
    return array_map('adminUser', db()->query('SELECT * FROM users ORDER BY id')->fetchAll());
}

function updateUser(int $id, array $changes): array
{
    $pdo = db();
    $st = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $st->execute([$id]);
    $user = $st->fetch();
    if (!$user) {
        throw new HttpError(404, 'Account nicht gefunden.');
    }
    $locked = sameName($user['name'], OWNER_NAME);

    if (array_key_exists('rank', $changes) && $changes['rank'] !== null) {
        if (!is_string($changes['rank']) || !in_array($changes['rank'], RANKS, true)) {
            throw new HttpError(400, 'Ungültiger Rang.');
        }
        if ($locked && $changes['rank'] !== 'Sysadmin') {
            throw new HttpError(403, 'Der Rang von ' . OWNER_NAME . ' kann nicht geändert werden.');
        }
    }
    if (array_key_exists('ip', $changes) && $changes['ip'] !== null) {
        if (!is_string($changes['ip']) || filter_var($changes['ip'], FILTER_VALIDATE_IP) === false) {
            throw new HttpError(400, 'Ungültige IP-Adresse.');
        }
    }
    $registeredAt = null;
    if (array_key_exists('registeredAt', $changes) && $changes['registeredAt'] !== null) {
        $t = is_string($changes['registeredAt']) ? strtotime($changes['registeredAt']) : false;
        if ($t === false) {
            throw new HttpError(400, 'Ungültiges Registrierungsdatum.');
        }
        $registeredAt = gmdate('Y-m-d\TH:i:s', $t) . '.000Z';
    }

    if (($changes['rank'] ?? null) !== null) {
        $user['rank'] = $changes['rank'];
    }
    if (($changes['ip'] ?? null) !== null) {
        $user['ip'] = $changes['ip'];
    }
    if ($registeredAt !== null) {
        $user['registered_at'] = $registeredAt;
    }
    $pdo->prepare('UPDATE users SET rank = ?, ip = ?, registered_at = ? WHERE id = ?')
        ->execute([$user['rank'], $user['ip'], $user['registered_at'], $id]);
    return $user;
}

// ---------- Anwesenheit ----------

// Wer im Spiel ist, meldet sich alle 30 s; nach 75 s ohne Meldung gilt man als offline
function setPresence(int $userId, bool $leave): void
{
    db()->prepare('UPDATE users SET last_seen = ? WHERE id = ?')->execute([$leave ? 0 : time(), $userId]);
}

// ---------- Speicherstände: Platz 0 = Auto-Save, 1–10 = eigene ----------

const SAVE_SLOTS = 10;

// Kurzinfo für die Übersicht (Figur, Geld, Missionen, Spielzeit) aus dem gespeicherten Spielstand
function saveSummary($save): array
{
    $stats = (is_object($save) && isset($save->stats) && is_object($save->stats)) ? $save->stats : null;
    return [
        'who' => (string)((is_object($save) && isset($save->who)) ? $save->who : 'jason'),
        'money' => (int)floor((float)((is_object($save) && isset($save->money)) ? $save->money : 0)),
        'missions' => (int)($stats->missionsDone ?? 0),
        'playMs' => (int)($stats->playMs ?? 0),
    ];
}

// $slot = null: neuester Spielstand aller Plätze
function getSaveRow(int $userId, ?int $slot = null): ?array
{
    if ($slot === null) {
        $st = db()->prepare('SELECT saved_at, data FROM save_slots WHERE user_id = ? ORDER BY saved_at DESC LIMIT 1');
        $st->execute([$userId]);
    } else {
        $st = db()->prepare('SELECT saved_at, data FROM save_slots WHERE user_id = ? AND slot = ?');
        $st->execute([$userId, $slot]);
    }
    return $st->fetch() ?: null;
}

function putSave(int $userId, int $slot, string $json, string $summary): string
{
    $savedAt = isoNow();
    db()->prepare('INSERT INTO save_slots (user_id, slot, saved_at, summary, data) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, slot) DO UPDATE SET saved_at = excluded.saved_at, summary = excluded.summary, data = excluded.data')
        ->execute([$userId, $slot, $savedAt, $summary, $json]);
    return $savedAt;
}

// Übersicht aller belegten Plätze (Auto-Save zuerst)
function listSaveSlots(int $userId): array
{
    $pdo = db();
    $st = $pdo->prepare('SELECT slot, saved_at, summary FROM save_slots WHERE user_id = ? ORDER BY slot');
    $st->execute([$userId]);
    $out = [];
    foreach ($st->fetchAll() as $r) {
        $sum = json_decode((string)$r['summary'], true);
        if (!is_array($sum)) {
            // übernommener alter Spielstand ohne Kurzinfo: einmal aus den Daten bilden und merken
            $d = getSaveRow($userId, (int)$r['slot']);
            $sum = saveSummary($d ? json_decode($d['data'], false) : null);
            $pdo->prepare('UPDATE save_slots SET summary = ? WHERE user_id = ? AND slot = ?')->execute([json_encode($sum), $userId, (int)$r['slot']]);
        }
        $out[] = ['slot' => (int)$r['slot'], 'savedAt' => $r['saved_at'], 'summary' => $sum];
    }
    return $out;
}
