// Ponto de entrada do servidor HTTP
const { initialize } = require('./db');
const { createApp } = require('./app');

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';

// Inicializa o banco e sobe o servidor Express na porta configurada
async function start() {
  initialize();
  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`CHGT HelpDesk SQLite disponível em http://${HOST}:${PORT}`);
    console.log('Banco local: data/local.db');
  });
}

start().catch(err => { console.error('Falha ao iniciar:', err.message); process.exitCode = 1; });
