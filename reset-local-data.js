// Remove o banco SQLite local para reiniciar com dados limpos
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'local.db');
// Tenta remover o arquivo do banco (ignora se não existir)
try { fs.unlinkSync(dbPath); } catch (_) {}
console.log('Banco local removido. Será recriado na próxima inicialização.');
