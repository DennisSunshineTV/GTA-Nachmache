const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(dist, 'index.html'));
for (const dir of ['assets', 'game', 'vendor']) {
  if (fs.existsSync(path.join(__dirname, dir))) {
    fs.cpSync(path.join(__dirname, dir), path.join(dist, dir), { recursive: true });
  }
}

console.log('Build fertig: dist/');
