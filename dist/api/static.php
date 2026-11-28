<?php
// Spielcode (/game/) und Bibliotheken (/vendor/) werden nur an eingeloggte Spieler ausgeliefert.
// Die .htaccess leitet diese Adressen hierher; die Dateien selbst liegen in den normalen Ordnern.
declare(strict_types=1);

require __DIR__ . '/lib.php';

const TYPES = [
    'js' => 'text/javascript; charset=utf-8',
    'mjs' => 'text/javascript; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'css' => 'text/css; charset=utf-8',
    'html' => 'text/html; charset=utf-8',
    'png' => 'image/png',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'svg' => 'image/svg+xml',
    'woff2' => 'font/woff2',
    'mp3' => 'audio/mpeg',
    'ogg' => 'audio/ogg',
    'wav' => 'audio/wav',
    'glb' => 'model/gltf-binary',
    'wasm' => 'application/wasm',
];

function plain(int $status, string $text)
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    header('Cache-Control: no-store');
    echo $text;
    exit;
}

try {
    $path = rawurldecode((string)(parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/'));
    if (!preg_match('#^/(game|vendor)/(.+)$#D', $path, $m) || str_contains($path, "\0")) {
        plain(404, 'Nicht gefunden');
    }
    // Nur Dateien innerhalb des freigegebenen Ordners
    foreach (explode('/', $m[2]) as $part) {
        if ($part === '..' || $part === '.' || $part === '') {
            plain(403, 'Verboten');
        }
    }
    if (!userFromToken(requestToken())) {
        plain(401, 'Bitte einloggen.');
    }
    $file = dirname(__DIR__) . '/' . $m[1] . '/' . $m[2];
    if (!is_file($file)) {
        plain(404, 'Nicht gefunden');
    }
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    $size = (int)filesize($file);
    $etag = 'W/"' . $size . '-' . filemtime($file) . '"';
    header('Content-Type: ' . (TYPES[$ext] ?? 'application/octet-stream'));
    header('Cache-Control: private, no-cache');
    header('ETag: ' . $etag);
    header('X-Content-Type-Options: nosniff');
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
        http_response_code(304);
        exit;
    }
    header('Content-Length: ' . $size);
    if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'HEAD') {
        readfile($file);
    }
} catch (Throwable $e) {
    error_log('Street Life static: ' . $e->getMessage());
    plain(500, 'Serverfehler');
}
