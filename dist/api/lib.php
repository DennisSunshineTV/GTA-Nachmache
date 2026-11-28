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
    if ($version >= 5) {
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
    // Version 5: Freundschaften (Paare mit user_a < user_b), Anfragen und Mitteilungen
    $pdo->exec('CREATE TABLE IF NOT EXISTS friends (
        user_a INTEGER NOT NULL,
        user_b INTEGER NOT NULL,
        since TEXT NOT NULL,
        PRIMARY KEY (user_a, user_b)
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS friend_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_id INTEGER NOT NULL,
        to_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT \'pending\',
        decided_at INTEGER NOT NULL DEFAULT 0
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        is_read INTEGER NOT NULL DEFAULT 0
    )');
    $pdo->exec('PRAGMA user_version = 5');
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

// ---------- Freundschaften ----------
// Mitglieder suchen, Anfragen schicken, annehmen oder ablehnen (wie users.js). Wer abgelehnt wurde, kann derselben
// Person erst 24 Stunden später wieder eine Anfrage schicken. Über jede Antwort bekommt der Absender eine Mitteilung.

const DECLINE_BLOCK_SECONDS = 86400;
const NOTE_MAX = 50;

function friendPair(int $a, int $b): array
{
    return $a < $b ? [$a, $b] : [$b, $a];
}

function areFriends(int $a, int $b): bool
{
    [$x, $y] = friendPair($a, $b);
    $st = db()->prepare('SELECT 1 FROM friends WHERE user_a = ? AND user_b = ?');
    $st->execute([$x, $y]);
    return (bool)$st->fetchColumn();
}

function findUserById(int $id): ?array
{
    $st = db()->prepare('SELECT * FROM users WHERE id = ?');
    $st->execute([$id]);
    return $st->fetch() ?: null;
}

function isOnlineRow(array $u): bool
{
    return (time() - (int)($u['last_seen'] ?? 0)) < 75;
}

function pruneFriendRequests(): void
{
    $pdo = db();
    $pdo->prepare("DELETE FROM friend_requests WHERE status = 'declined' AND decided_at < ?")->execute([time() - DECLINE_BLOCK_SECONDS]);
    $pdo->exec("DELETE FROM friend_requests WHERE status NOT IN ('pending', 'declined')");
}

// Sekunden, bis $from an $to wieder eine Anfrage schicken darf (0 = sofort)
function declineWait(int $from, int $to): int
{
    $st = db()->prepare("SELECT MAX(decided_at) FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'declined'");
    $st->execute([$from, $to]);
    $t = (int)$st->fetchColumn();
    return $t > 0 ? max(0, $t + DECLINE_BLOCK_SECONDS - time()) : 0;
}

function pendingRequest(int $from, int $to): ?array
{
    $st = db()->prepare("SELECT * FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending' LIMIT 1");
    $st->execute([$from, $to]);
    return $st->fetch() ?: null;
}

function relationTo(int $me, int $other): array
{
    if (areFriends($me, $other)) {
        return ['relation' => 'friend'];
    }
    if (pendingRequest($me, $other)) {
        return ['relation' => 'outgoing'];
    }
    $inc = pendingRequest($other, $me);
    if ($inc) {
        return ['relation' => 'incoming', 'requestId' => (int)$inc['id']];
    }
    $wait = declineWait($me, $other);
    if ($wait > 0) {
        return ['relation' => 'blocked', 'waitMs' => $wait * 1000];
    }
    return ['relation' => 'none'];
}

function addNote(int $userId, string $text): void
{
    $pdo = db();
    $pdo->prepare('INSERT INTO notifications (user_id, text, created_at, is_read) VALUES (?, ?, ?, 0)')->execute([$userId, $text, isoNow()]);
    $pdo->prepare('DELETE FROM notifications WHERE user_id = ? AND id NOT IN (SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ' . NOTE_MAX . ')')->execute([$userId, $userId]);
}

function waitText(int $seconds): string
{
    $min = max(1, (int)ceil($seconds / 60));
    $h = intdiv($min, 60);
    $m = $min % 60;
    return $h > 0 ? $h . ' Std.' . ($m ? ' ' . $m . ' Min.' : '') : $m . ' Min.';
}

// Mitglieder suchen: Namen bestehen nur aus Buchstaben und Zahlen, alles andere wird aus der Suche entfernt
function searchMembers(array $me, string $q): array
{
    $q = strtolower((string)preg_replace('/[^A-Za-z0-9]/', '', $q));
    if (strlen($q) < 2) {
        return [];
    }
    pruneFriendRequests();
    $st = db()->prepare("SELECT id, name, rank, last_seen FROM users WHERE id <> ? AND lower(name) LIKE ?
        ORDER BY (CASE WHEN lower(name) LIKE ? THEN 0 ELSE 1 END), name COLLATE NOCASE LIMIT 20");
    $st->execute([(int)$me['id'], '%' . $q . '%', $q . '%']);
    $out = [];
    foreach ($st->fetchAll() as $u) {
        $out[] = array_merge(['id' => (int)$u['id'], 'name' => $u['name'], 'rank' => $u['rank'], 'online' => isOnlineRow($u)], relationTo((int)$me['id'], (int)$u['id']));
    }
    return $out;
}

function friendsOverview(array $me): array
{
    pruneFriendRequests();
    $pdo = db();
    $id = (int)$me['id'];
    $st = $pdo->prepare('SELECT u.id, u.name, u.rank, u.last_seen, f.since FROM friends f JOIN users u ON u.id = (CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END) WHERE f.user_a = ? OR f.user_b = ?');
    $st->execute([$id, $id, $id]);
    $friends = [];
    foreach ($st->fetchAll() as $u) {
        $friends[] = ['id' => (int)$u['id'], 'name' => $u['name'], 'rank' => $u['rank'], 'online' => isOnlineRow($u), 'since' => $u['since']];
    }
    usort($friends, function ($a, $b) {
        if ($a['online'] !== $b['online']) {
            return $a['online'] ? -1 : 1;
        }
        return strcasecmp($a['name'], $b['name']);
    });
    $st = $pdo->prepare("SELECT r.id, r.created_at, u.id AS uid, u.name FROM friend_requests r JOIN users u ON u.id = r.from_id WHERE r.to_id = ? AND r.status = 'pending' ORDER BY r.id");
    $st->execute([$id]);
    $incoming = [];
    foreach ($st->fetchAll() as $r) {
        $incoming[] = ['id' => (int)$r['id'], 'from' => ['id' => (int)$r['uid'], 'name' => $r['name']], 'createdAt' => $r['created_at']];
    }
    $st = $pdo->prepare("SELECT r.id, r.created_at, u.id AS uid, u.name FROM friend_requests r JOIN users u ON u.id = r.to_id WHERE r.from_id = ? AND r.status = 'pending' ORDER BY r.id");
    $st->execute([$id]);
    $outgoing = [];
    foreach ($st->fetchAll() as $r) {
        $outgoing[] = ['id' => (int)$r['id'], 'to' => ['id' => (int)$r['uid'], 'name' => $r['name']], 'createdAt' => $r['created_at']];
    }
    $st = $pdo->prepare('SELECT id, text, created_at FROM notifications WHERE user_id = ? AND is_read = 0 ORDER BY id');
    $st->execute([$id]);
    $notes = [];
    foreach ($st->fetchAll() as $n) {
        $notes[] = ['id' => (int)$n['id'], 'text' => $n['text'], 'time' => $n['created_at']];
    }
    return ['friends' => $friends, 'incoming' => $incoming, 'outgoing' => $outgoing, 'notifications' => $notes];
}

function sendFriendRequest(array $me, array $body): array
{
    pruneFriendRequests();
    $pdo = db();
    $meId = (int)$me['id'];
    if (isset($body['userId']) && is_numeric($body['userId'])) {
        $target = findUserById((int)$body['userId']);
    } else {
        $st = $pdo->prepare('SELECT * FROM users WHERE lower(name) = lower(?) LIMIT 1');
        $st->execute([trim(str($body['name'] ?? null))]);
        $target = $st->fetch() ?: null;
    }
    if (!$target) {
        throw new HttpError(404, 'Mitglied nicht gefunden.');
    }
    $tid = (int)$target['id'];
    $tname = (string)$target['name'];
    if ($tid === $meId) {
        throw new HttpError(400, 'Du kannst dir nicht selbst eine Freundschaftsanfrage schicken.');
    }
    if (areFriends($meId, $tid)) {
        throw new HttpError(409, 'Du bist mit ' . $tname . ' bereits befreundet.');
    }
    if (pendingRequest($meId, $tid)) {
        throw new HttpError(409, 'Du hast ' . $tname . ' bereits eine Anfrage geschickt.');
    }
    if (pendingRequest($tid, $meId)) {
        throw new HttpError(409, $tname . ' hat dir bereits eine Anfrage geschickt – du findest sie oben rechts unter „Ausloggen“.');
    }
    $wait = declineWait($meId, $tid);
    if ($wait > 0) {
        throw new HttpError(429, $tname . ' hat deine Freundschaftsanfrage abgelehnt. Eine neue Anfrage ist erst 24 Stunden danach möglich (noch ' . waitText($wait) . ').');
    }
    $pdo->prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?')->execute([$meId, $tid]);
    $pdo->prepare("INSERT INTO friend_requests (from_id, to_id, created_at, status, decided_at) VALUES (?, ?, ?, 'pending', 0)")->execute([$meId, $tid, isoNow()]);
    return ['id' => (int)$pdo->lastInsertId(), 'to' => ['id' => $tid, 'name' => $tname]];
}

function respondFriendRequest(array $me, array $body): array
{
    $pdo = db();
    $meId = (int)$me['id'];
    $st = $pdo->prepare("SELECT * FROM friend_requests WHERE id = ? AND to_id = ? AND status = 'pending'");
    $st->execute([is_numeric($body['id'] ?? null) ? (int)$body['id'] : 0, $meId]);
    $req = $st->fetch();
    if (!$req) {
        throw new HttpError(404, 'Diese Freundschaftsanfrage gibt es nicht mehr.');
    }
    $fromId = (int)$req['from_id'];
    $accept = !empty($body['accept']);
    if ($accept) {
        $pdo->prepare('DELETE FROM friend_requests WHERE id = ?')->execute([(int)$req['id']]);
        $pdo->prepare("DELETE FROM friend_requests WHERE from_id = ? AND to_id = ? AND status = 'pending'")->execute([$meId, $fromId]);
        [$a, $b] = friendPair($meId, $fromId);
        $pdo->prepare('INSERT OR IGNORE INTO friends (user_a, user_b, since) VALUES (?, ?, ?)')->execute([$a, $b, isoNow()]);
        addNote($fromId, $me['name'] . ' hat deine Freundschaftsanfrage angenommen.');
    } else {
        $pdo->prepare("UPDATE friend_requests SET status = 'declined', decided_at = ? WHERE id = ?")->execute([time(), (int)$req['id']]);
        addNote($fromId, $me['name'] . ' hat deine Freundschaftsanfrage abgelehnt.');
    }
    return ['ok' => true, 'accepted' => $accept];
}

function removeFriend(array $me, array $body): array
{
    [$a, $b] = friendPair((int)$me['id'], is_numeric($body['userId'] ?? null) ? (int)$body['userId'] : 0);
    $st = db()->prepare('DELETE FROM friends WHERE user_a = ? AND user_b = ?');
    $st->execute([$a, $b]);
    if ($st->rowCount() < 1) {
        throw new HttpError(404, 'Diese Freundschaft gibt es nicht.');
    }
    return ['ok' => true];
}

function cancelFriendRequest(array $me, array $body): array
{
    $st = db()->prepare("DELETE FROM friend_requests WHERE id = ? AND from_id = ? AND status = 'pending'");
    $st->execute([is_numeric($body['id'] ?? null) ? (int)$body['id'] : 0, (int)$me['id']]);
    if ($st->rowCount() < 1) {
        throw new HttpError(404, 'Diese Anfrage gibt es nicht mehr.');
    }
    return ['ok' => true];
}

function readNotifications(array $me, array $body): array
{
    $pdo = db();
    if (isset($body['ids']) && is_array($body['ids'])) {
        $del = $pdo->prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?');
        foreach ($body['ids'] as $nid) {
            if (is_numeric($nid)) {
                $del->execute([(int)$nid, (int)$me['id']]);
            }
        }
    } else {
        $pdo->prepare('DELETE FROM notifications WHERE user_id = ?')->execute([(int)$me['id']]);
    }
    return ['ok' => true];
}

// ---------- Speicherstände: Platz 0 = Auto-Save, 1–5 = eigene ----------
// Früher gab es 10 Plätze: Stände in 6–10 lassen sich weiterhin laden, gespeichert wird nur noch in 1–5.

const SAVE_SLOTS = 10;
const SAVE_SLOTS_WRITE = 5;

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
