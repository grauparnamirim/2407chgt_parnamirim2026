// Ponto de entrada que sobe o servidor web e o servidor DNS local juntos
const { initialize } = require('./db');
const { createApp } = require('./app');
const dns = require('./dns-server');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || dns.getHostIP();

async function start() {
  await initialize();
  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`CHGT HelpDesk disponível em http://${HOST}:${PORT}`);
    console.log('Banco de dados: PostgreSQL');
  });
  try {
    await dns.start();
  } catch (e) {
    console.warn('Servidor DNS não iniciou (requer privilégios elevados):', e.message);
  }
}

start().catch(err => { console.error('Falha ao iniciar:', err.message); process.exitCode = 1; });
