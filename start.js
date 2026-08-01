// Inicializador do servidor web e servidor DNS em paralelo
const { spawn } = require('child_process');
const path = require('path');

// Inicia servidor HTTP (Express) em processo filho
const app = spawn('node', [path.join(__dirname, 'src', 'index.js')], { stdio: 'inherit' });
// Inicia servidor DNS em processo filho
const dns = spawn('node', [path.join(__dirname, 'src', 'dns-server.js')], { stdio: 'inherit' });

// Finaliza ambos os processos filhos ao encerrar
function cleanup() {
  app.kill();
  dns.kill();
  process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
