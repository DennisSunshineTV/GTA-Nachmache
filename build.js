const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(dist, 'index.html'));
// Server mit der API (/api/…: Anmeldung, Registrierung, Speicherstand) gehört zum Spiel und muss mit ausgeliefert werden
for (const file of ['server.js', 'users.js', 'package.json']) {
  if (fs.existsSync(path.join(__dirname, file))) fs.copyFileSync(path.join(__dirname, file), path.join(dist, file));
}
for (const dir of ['assets', 'game', 'vendor']) {
  if (fs.existsSync(path.join(__dirname, dir))) {
    fs.cpSync(path.join(__dirname, dir), path.join(dist, dir), { recursive: true });
  }
}

// ALL-INKL (PHP): .htaccess und die PHP-API (Anmeldung, Speicherstand) gehören ins Paket
const host = path.join(__dirname, 'hosting', 'allinkl');
if (fs.existsSync(host)) {
  fs.copyFileSync(path.join(host, '.htaccess'), path.join(dist, '.htaccess'));
  fs.cpSync(path.join(host, 'api'), path.join(dist, 'api'), { recursive: true });
}

console.log('Build fertig: dist/ (Server: node server.js · ALL-INKL: Inhalt von dist/ hochladen, siehe hosting/allinkl/INSTALLATION.md)');
