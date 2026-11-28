<?php
// Diagnose der Installation (/api/status.php). Läuft bewusst eigenständig: Sie meldet auch dann, was fehlt oder
// schiefgeht, wenn die übrige API wegen eines Fehlers gar nicht erst startet.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$report = array(
    'ok' => false,
    'php' => PHP_VERSION,
    'php_ok' => version_compare(PHP_VERSION, '8.0.0', '>='),
    'pdo_sqlite' => extension_loaded('pdo_sqlite'),
    'mbstring' => extension_loaded('mbstring'),
    'api_loaded' => false,
    'data_directory_writable' => false,
    'database' => false,
    'members' => null,
);
$done = false;

// Serverpfade aus Fehlermeldungen entfernen
function street_life_clean($msg)
{
    return preg_replace('#(?:[A-Za-z]:)?[/\\\\][^\s:()]*[/\\\\]#', '', (string)$msg);
}

// Schwere Fehler beim Laden (z. B. falsche PHP-Version) trotzdem als JSON melden
register_shutdown_function(function () use (&$report, &$done) {
    if ($done) {
        return;
    }
    $e = error_get_last();
    if ($e !== null) {
        $report['fatal'] = street_life_clean($e['message']) . ' (' . basename($e['file']) . ':' . $e['line'] . ')';
    }
    echo json_encode($report);
});

try {
    require __DIR__ . '/lib.php';
    $report['api_loaded'] = true;
    $report['data_directory_writable'] = is_writable(ensureDataDir());
    if ($report['pdo_sqlite'] && $report['data_directory_writable']) {
        $pdo = db();
        $report['database'] = true;
        $report['members'] = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    }
    $report['ok'] = $report['php_ok'] && $report['pdo_sqlite'] && $report['data_directory_writable'] && $report['database'];
} catch (Throwable $e) {
    $report['error'] = street_life_clean($e->getMessage()) . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')';
}
$done = true;
echo json_encode($report);
