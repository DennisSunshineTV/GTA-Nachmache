<?php
// Multiplayer der PHP-API (ALL-INKL): 2 Server mit je höchstens 16 Spielern. Entspricht users.js (mpServers, mpJoin, mpSync, mpLeave).
// Shared-Hosting kann keine dauerhaften Verbindungen halten: Das Spiel meldet seinen Zustand mehrmals pro Sekunde
// und bekommt dabei die Zustände der anderen zurück. Jeder Spieler hat eine kleine JSON-Datei unter api/data/mp/s<Server>/
// (so blockieren sich die vielen kurzen Anfragen nicht in der Datenbank). Wer sich 15 s nicht meldet, gilt als gegangen.
declare(strict_types=1);

const MP_SERVERS = [1 => 'Server 1', 2 => 'Server 2'];
const MP_MAX = 16;
const MP_TIMEOUT = 15;

function mpNowMs(): int
{
    return (int)round(microtime(true) * 1000);
}

function mpServerId($v): int
{
    $id = is_numeric($v) ? (int)$v : 0;
    // array_key_exists statt isset: isset() auf ein Konstanten-Array ist in PHP ein Kompilierfehler
    if (!array_key_exists($id, MP_SERVERS)) {
        throw new HttpError(400, 'Unbekannter Server.');
    }
    return $id;
}

function mpDir(int $server): string
{
    $dir = ensureDataDir() . '/mp/s' . $server;
    if (!is_dir($dir) && !@mkdir($dir, 0750, true) && !is_dir($dir)) {
        throw new RuntimeException('Der Ordner api/data/mp kann nicht angelegt werden.');
    }
    return $dir;
}

function mpFile(int $server, int $userId): string
{
    return mpDir($server) . '/u' . $userId . '.json';
}

function mpReadFile(string $file): ?array
{
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') {
        return null;
    }
    $p = json_decode($raw, true);
    return is_array($p) && isset($p['id'], $p['seen']) ? $p : null;
}

function mpWriteFile(string $file, array $p): void
{
    $tmp = $file . '.' . bin2hex(random_bytes(4)) . '.tmp';
    if (@file_put_contents($tmp, json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION)) === false) {
        throw new RuntimeException('Multiplayer-Zustand kann nicht gespeichert werden.');
    }
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        throw new RuntimeException('Multiplayer-Zustand kann nicht gespeichert werden.');
    }
}

// Alle aktiven Spieler eines Servers; abgelaufene Einträge werden dabei gelöscht
function mpPlayers(int $server): array
{
    $dir = mpDir($server);
    $now = microtime(true);
    $out = [];
    foreach (scandir($dir) ?: [] as $name) {
        if (!preg_match('/^u(\d+)\.json$/D', $name)) {
            if (preg_match('/\.tmp$/D', $name) && @filemtime($dir . '/' . $name) < time() - 60) {
                @unlink($dir . '/' . $name);
            }
            continue;
        }
        $p = mpReadFile($dir . '/' . $name);
        if (!$p) {
            continue;
        }
        if ($now - (float)$p['seen'] > MP_TIMEOUT) {
            @unlink($dir . '/' . $name);
            continue;
        }
        $out[(int)$p['id']] = $p;
    }
    return $out;
}

function mpPublic(array $p, int $nowMs): array
{
    return ['id' => (int)$p['id'], 'name' => (string)$p['name'], 'st' => $p['st'], 'age' => max(0, $nowMs - (int)round((float)$p['seen'] * 1000))];
}

function mpServers(): array
{
    $out = [];
    foreach (MP_SERVERS as $id => $name) {
        $out[] = ['id' => $id, 'name' => $name, 'players' => count(mpPlayers($id)), 'max' => MP_MAX];
    }
    return $out;
}

function mpFinite($v, float $lim): float
{
    $n = is_numeric($v) ? (float)$v : 0.0;
    if (!is_finite($n)) {
        return 0.0;
    }
    return max(-$lim, min($lim, $n));
}

function mpWord($v, int $max = 12): string
{
    return is_string($v) && preg_match('/^[A-Za-z0-9_]{1,24}$/D', $v) ? substr($v, 0, $max) : '';
}

// Nur bekannte Felder mit gültigen Werten übernehmen (der Zustand kommt vom Browser)
function mpCleanState($st): ?array
{
    if (!is_array($st)) {
        return null;
    }
    $m = mpWord($st['m'] ?? null, 8);
    $out = [
        'x' => mpFinite($st['x'] ?? 0, 30000), 'y' => mpFinite($st['y'] ?? 0, 5000), 'z' => mpFinite($st['z'] ?? 0, 30000),
        'h' => mpFinite($st['h'] ?? 0, 100), 's' => mpFinite($st['s'] ?? 0, 300),
        'm' => $m !== '' ? $m : 'walk', 'w' => mpWord($st['w'] ?? null), 'c' => ($st['c'] ?? '') === 'lucia' ? 'lucia' : 'jason',
        'a' => empty($st['a']) ? 0 : 1, 'cr' => empty($st['cr']) ? 0 : 1, 'ph' => empty($st['ph']) ? 0 : 1, 'ap' => mpFinite($st['ap'] ?? 0, 2),
    ];
    $v = $st['v'] ?? null;
    if (is_array($v) && mpWord($v['t'] ?? null) !== '') {
        $out['v'] = [
            't' => mpWord($v['t']), 'p' => (int)max(0, min(30, floor(mpFinite($v['p'] ?? 0, 30)))),
            'x' => mpFinite($v['x'] ?? 0, 30000), 'y' => mpFinite($v['y'] ?? 0, 5000), 'z' => mpFinite($v['z'] ?? 0, 30000), 'h' => mpFinite($v['h'] ?? 0, 100),
            'pi' => mpFinite($v['pi'] ?? 0, 4), 'ro' => mpFinite($v['ro'] ?? 0, 4), 'st' => mpFinite($v['st'] ?? 0, 2), 'sp' => mpFinite($v['sp'] ?? 0, 300),
            'l' => empty($v['l']) ? 0 : 1, 'si' => empty($v['si']) ? 0 : 1, 'seat' => (int)max(0, min(3, floor(mpFinite($v['seat'] ?? 0, 3)))),
        ];
    }
    return $out;
}

// Token = "<Mitglieds-Nr>.<Zufall>": so findet die Anfrage ihre Datei, ohne die Datenbank zu fragen
function mpTokenUser($token): int
{
    if (!is_string($token) || !preg_match('/^(\d{1,10})\.[a-f0-9]{32}$/D', $token, $m)) {
        throw new HttpError(409, 'Die Verbindung zum Server ist abgelaufen.');
    }
    return (int)$m[1];
}

function mpJoin(array $me, $serverParam): array
{
    $server = mpServerId($serverParam);
    $meId = (int)$me['id'];
    $lock = @fopen(ensureDataDir() . '/mp-join.lock', 'c');
    if ($lock) {
        flock($lock, LOCK_EX);
    }
    try {
        // nur auf einem Server gleichzeitig
        foreach (array_keys(MP_SERVERS) as $sid) {
            if ($sid !== $server && is_file(mpFile($sid, $meId))) {
                @unlink(mpFile($sid, $meId));
            }
        }
        $players = mpPlayers($server);
        if (!isset($players[$meId]) && count($players) >= MP_MAX) {
            throw new HttpError(409, MP_SERVERS[$server] . ' ist voll (' . MP_MAX . ' von ' . MP_MAX . '). Bitte versuche es auf dem anderen Server.');
        }
        $now = microtime(true);
        $token = $meId . '.' . bin2hex(random_bytes(16));
        mpWriteFile(mpFile($server, $meId), ['id' => $meId, 'name' => (string)$me['name'], 'token' => $token, 'joined' => $now, 'seen' => $now, 'st' => null]);
    } finally {
        if ($lock) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }
    $nowMs = mpNowMs();
    $others = [];
    foreach ($players as $id => $p) {
        if ($id !== $meId && $p['st'] !== null) {
            $others[] = mpPublic($p, $nowMs);
        }
    }
    return ['ok' => true, 'server' => $server, 'token' => $token, 'you' => ['id' => $meId, 'name' => (string)$me['name']], 'max' => MP_MAX, 'now' => $nowMs, 'players' => $others];
}

function mpSync(array $body): array
{
    $server = mpServerId($body['server'] ?? null);
    $uid = mpTokenUser($body['token'] ?? null);
    $file = mpFile($server, $uid);
    $p = mpReadFile($file);
    if (!$p || !is_string($p['token'] ?? null) || !hash_equals($p['token'], (string)$body['token'])) {
        throw new HttpError(409, 'Die Verbindung zum Server ist abgelaufen.');
    }
    $now = microtime(true);
    if ($now - (float)$p['seen'] > MP_TIMEOUT) {
        @unlink($file);
        throw new HttpError(409, 'Die Verbindung zum Server ist abgelaufen.');
    }
    $p['seen'] = $now;
    $clean = mpCleanState($body['st'] ?? null);
    if ($clean !== null) {
        $p['st'] = $clean;
    }
    mpWriteFile($file, $p);
    $nowMs = mpNowMs();
    $players = mpPlayers($server);
    $others = [];
    foreach ($players as $id => $q) {
        if ($id !== $uid && $q['st'] !== null) {
            $others[] = mpPublic($q, $nowMs);
        }
    }
    return ['ok' => true, 'now' => $nowMs, 'count' => max(1, count($players)), 'max' => MP_MAX, 'players' => $others];
}

function mpLeave(array $body): array
{
    try {
        $server = mpServerId($body['server'] ?? null);
        $uid = mpTokenUser($body['token'] ?? null);
    } catch (HttpError $e) {
        return ['ok' => true];
    }
    $file = mpFile($server, $uid);
    $p = mpReadFile($file);
    if ($p && is_string($p['token'] ?? null) && hash_equals($p['token'], (string)$body['token'])) {
        @unlink($file);
    }
    return ['ok' => true];
}
