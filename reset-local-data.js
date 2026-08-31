// Reinicia o banco PostgreSQL removendo e recriando o schema público.
// O servidor recria tabelas e dados iniciais na próxima inicialização.
const { Client } = require('pg');

async function reset() {
  const client = new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'chgt_helpdesk'
  });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('GRANT ALL ON SCHEMA public TO postgres');
    await client.query('GRANT ALL ON SCHEMA public TO public');
    console.log('Schema público recriado. O banco será populado na próxima inicialização.');
  } finally {
    await client.end();
  }
}

reset().catch(e => { console.error('Erro ao resetar banco:', e.message); process.exitCode = 1; });
