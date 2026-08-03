// ============================================================
// FUNÇÕES AUXILIARES DE TESTE
// ============================================================

const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');

// ============================================================
// SERVIDOR DE TESTE
// ============================================================

// Inicia uma instância do servidor com banco temporário e porta aleatória
// extraEnv permite injetar variáveis de ambiente específicas (ex.: RATE_LIMIT_MAX)
function startServer(extraEnv = {}) {
  const tempDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'chgt-test-')), 'test.db');
  const port = 35117 + Math.floor(Math.random() * 500);
  const server = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DB_PATH: tempDb, TEST: '1', HOST: '127.0.0.1', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', chunk => process.stderr.write('[SERVER] ' + chunk));
  return { server, port, tempDb };
}

// Aguarda até que o servidor esteja pronto para receber requisições
function waitForServer(server) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Servidor não iniciou.')), 10000);
    server.stdout.on('data', chunk => {
      process.stdout.write('[SERVER] ' + chunk);
      if (chunk.toString().includes('CHGT HelpDesk SQLite disponível')) {
        clearTimeout(timer); resolve();
      }
    });
    server.on('exit', code => reject(new Error(`Servidor encerrou com código ${code}.`)));
  });
}

// ============================================================
// CLIENTE HTTP
// ============================================================

// Faz uma requisição HTTP configurável e retorna { status, data }
function request(port, method, route, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path: route, method,
      headers: {
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data;
        try { data = JSON.parse(raw); } catch (_) { data = raw; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ============================================================
// EXPORTAÇÃO
// ============================================================

module.exports = { startServer, waitForServer, request };
