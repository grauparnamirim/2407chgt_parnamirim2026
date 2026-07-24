const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.copyFileSync(path.join(dataDir, 'template.json'), path.join(dataDir, 'local.json'));
console.log('Dados locais restaurados a partir de data/template.json.');
