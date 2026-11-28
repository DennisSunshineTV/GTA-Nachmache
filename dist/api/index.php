<?php
// API des Spiels (ALL-INKL / PHP): Anmeldung, Registrierung, Speicherstand, Admin-Bereich.
// Alle Adressen unter /api/ laufen über diese Datei (siehe .htaccess).
declare(strict_types=1);

require __DIR__ . '/lib.php';

$method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
$path = rawurldecode((string)(parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/'));
$path = rtrim($path, '/') === '' ? '/' : rtrim($path, '/');

try {
    // Zustand der Installation prüfen (wie /api/status.php bei der Hauptseite)
    if ($path === '/api/status' || $path === '/api/status.php') {
        $writable = false;
        try {
            $writable = is_writable(ensureDataDir());
        } catch (Throwable $e) {
            $writable = false;
        }
        $sqlite = extension_loaded('pdo_sqlite');
        sendJson(200, [
            'ok' => $sqlite && $writable,
            'php' => PHP_VERSION,
            'pdo_sqlite' => $sqlite,
            'data_directory_writable' => $writable,
        ]);
    }

    $ip = clientIp();
    $client = parseUserAgent((string)($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $token = requestToken();
    $me = userFromToken($token);

    if ($path === '/api/me' && $method === 'GET') {
        sendJson(200, ['user' => $me ? publicUser($me) : null]);
    }

    if ($path === '/api/register' && $method === 'POST') {
        rateLimit('register', $ip, 10, 3600);
        $user = registerUser(readJson(), $ip, $client);
        setSessionCookie(createSession($user), SESSION_SECONDS);
        sendJson(201, ['user' => publicUser($user)]);
    }

    if ($path === '/api/login' && $method === 'POST') {
        rateLimit('login', $ip, 10, 900);
        $user = loginUser(readJson(), $ip, $client);
        setSessionCookie(createSession($user), SESSION_SECONDS);
        sendJson(200, ['user' => publicUser($user)]);
    }

    if ($path === '/api/logout' && $method === 'POST') {
        destroySession($token);
        setSessionCookie('', 0);
        sendJson(200, ['ok' => true]);
    }

    // Speicherstände: Platz 0 = Auto-Save, 1–10 = eigene. /api/saves liefert die Übersicht,
    // /api/save?slot=N einen Stand (GET ohne slot: den neuesten, PUT ohne slot: Platz 1)
    if ($path === '/api/saves' && $method === 'GET') {
        if (!$me) {
            throw new HttpError(401, 'Bitte einloggen.');
        }
        sendJson(200, ['slots' => listSaveSlots((int)$me['id'])]);
    }
    if ($path === '/api/save') {
        if (!$me) {
            throw new HttpError(401, 'Bitte einloggen.');
        }
        $slot = null;
        $slotParam = $_GET['slot'] ?? '';
        if (is_string($slotParam) && $slotParam !== '') {
            if (!preg_match('/^\d+$/D', $slotParam) || (int)$slotParam > SAVE_SLOTS) {
                throw new HttpError(400, 'Ungültiger Speicherplatz.');
            }
            $slot = (int)$slotParam;
        }
        if ($method === 'GET') {
            $row = getSaveRow((int)$me['id'], $slot);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store');
            // Gespeicherten JSON-Text unverändert ausgeben (leere Objekte bleiben Objekte)
            echo $row
                ? '{"save":' . $row['data'] . ',"savedAt":' . json_encode($row['saved_at']) . '}'
                : '{"save":null}';
            exit;
        }
        if ($method === 'PUT' || $method === 'POST') {
            rateLimit('save', $ip, 60, 60);
            requireJsonRequest();
            $raw = readBody(300000);
            $body = json_decode($raw === '' ? '{}' : $raw, false);
            if (!is_object($body) || !isset($body->save) || (!is_object($body->save) && !is_array($body->save))) {
                throw new HttpError(400, 'Kein Speicherstand übergeben.');
            }
            $json = json_encode($body->save, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
            if ($json === false) {
                throw new HttpError(400, 'Ungültiger Speicherstand.');
            }
            $target = $slot ?? 1;
            sendJson(200, ['ok' => true, 'slot' => $target, 'savedAt' => putSave((int)$me['id'], $target, $json, json_encode(saveSummary($body->save)))]);
        }
    }

    // Admin-Bereich: Sysadmin und Admin dürfen ansehen, nur Sysadmin darf ändern
    if ($path === '/api/admin/users' && $method === 'GET') {
        if (!$me || !in_array($me['rank'], ['Sysadmin', 'Admin'], true)) {
            throw new HttpError(403, 'Kein Zugriff.');
        }
        sendJson(200, ['users' => listUsers(), 'canEdit' => $me['rank'] === 'Sysadmin', 'ranks' => RANKS]);
    }

    // Anwesenheit: das laufende Spiel meldet sich regelmäßig (state: ping) und beim Verlassen (state: leave)
    if ($path === '/api/presence' && $method === 'POST') {
        if (!$me) {
            throw new HttpError(401, 'Bitte einloggen.');
        }
        rateLimit('presence', $ip, 240, 60);
        $body = readJson();
        setPresence((int)$me['id'], ($body['state'] ?? 'ping') === 'leave');
        sendJson(200, ['ok' => true]);
    }

    // Protokoll: Registrierungen und Logins
    if ($path === '/api/admin/log' && $method === 'GET') {
        if (!$me || !in_array($me['rank'], ['Sysadmin', 'Admin'], true)) {
            throw new HttpError(403, 'Kein Zugriff.');
        }
        sendJson(200, ['entries' => listLogEntries(500)]);
    }

    if (preg_match('#^/api/admin/users/(\d+)$#D', $path, $m) && $method === 'PATCH') {
        if (!$me || $me['rank'] !== 'Sysadmin') {
            throw new HttpError(403, 'Nur Sysadmins dürfen Accounts ändern.');
        }
        $updated = updateUser((int)$m[1], readJson());
        sendJson(200, ['user' => adminUser($updated)]);
    }

    throw new HttpError(404, 'Nicht gefunden.');
} catch (HttpError $e) {
    sendError($e->status, $e->getMessage());
} catch (Throwable $e) {
    error_log('Street Life API: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    sendError(500, 'Serverfehler.');
}
