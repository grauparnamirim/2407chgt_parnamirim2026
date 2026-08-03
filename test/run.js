// ============================================================
// ORQUESTRADOR DE TESTES
// ============================================================

const { startServer, waitForServer } = require('./helpers');

// ============================================================
// FUNÇÃO PRINCIPAL
// ============================================================

// Executa todos os suites de teste sequencialmente
async function run() {
  const { server, port, tempDb } = startServer();
  let failed = false;

  try {
    await waitForServer(server);
    console.log(`Servidor de teste em http://127.0.0.1:${port}\n`);

    // ============================================================
    // LISTA DE SUITES DE TESTE
    // ============================================================

    const suites = [
      ['helpdesk', require('./helpdesk.test')],
      ['crud', require('./crud.test')],
      ['security', require('./security.test')],
      ['atualizacoes', require('./atualizacoes.test')]
    ];

    // ============================================================
    // EXECUÇÃO DOS TESTES
    // ============================================================

    for (const [name, suite] of suites) {
      try {
        await suite(port);
      } catch (err) {
        console.error(`  ✗ ${name}: ${err.message}`);
        failed = true;
      }
    }

    // ============================================================
    // RESUMO DOS RESULTADOS
    // ============================================================

    if (failed) {
      console.log('\n✗ ALGUNS TESTES FALHARAM');
      process.exitCode = 1;
    } else {
      console.log('\n✓ TODOS OS TESTES PASSARAM');
    }
  } catch (err) {
    console.error('Erro fatal:', err.message);
    process.exitCode = 1;
  } finally {
    // ============================================================
    // LIMPEZA
    // ============================================================

    server.kill();
    const fs = require('fs');
    try { fs.rmSync(require('path').dirname(tempDb), { recursive: true, force: true }); } catch (_) {}
  }
}

run();
