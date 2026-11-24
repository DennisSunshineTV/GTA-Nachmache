const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist);
fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(dist, 'index.html'));

console.log('Build fertig: dist/index.html');
