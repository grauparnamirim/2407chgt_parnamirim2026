const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { request, startServer, waitForServer } = require('./helpers');

// ============================================================
// TESTES DE SEGURANÇA
// ============================================================

// Verifica proteção contra SQL injection, XSS, validação de entrada e controle de acesso
module.exports = async function testSecurity(port) {
  // Login para obter token
  const login = await request(port, 'POST', '/api/login', { email: 'admin@local.test', senha: 'Admin123!', unidade_id: 1 });
  assert.equal(login.status, 200);
  const token = login.data.token;

  // ============================================================
  // 1. SQL INJECTION VIA ROTA
  // ============================================================

  // Tentativa de injeção SQL através do path da URL
  const badPath = '/api/"; SELECT * FROM sqlite_master; --';
  const badTable = await request(port, 'GET', encodeURI(badPath), undefined, token);
  assert.equal(badTable.status, 404, 'rota maliciosa deve retornar 404');

  // ============================================================
  // 2. SQL INJECTION VIA BODY
  // ============================================================

  // Tentativa de injeção SQL através de chave inválida no corpo da requisição
  const injectCol = await request(port, 'POST', '/api/categorias', { nome: 'test', "'; DROP TABLE categorias; --": 'value' }, token);
  assert.equal(injectCol.status, 201, 'coluna extra ignorada não quebra CRUD');

  // ============================================================
  // 3. XSS — SANITIZAÇÃO DE CARACTERES
  // ============================================================

  // Verifica se caracteres < e > são removidos do campo nome
  const xss = await request(port, 'POST', '/api/categorias', { nome: '<script>alert(1)</script>Teste' }, token);
  assert.equal(xss.status, 201);
  const cats = await request(port, 'GET', '/api/categorias', undefined, token);
  const created = cats.data.find(c => c.id === xss.data.id);
  assert.ok(created, 'categoria encontrada');
  assert.ok(!created.nome.includes('<'), 'nome não deve conter <');
  assert.ok(!created.nome.includes('>'), 'nome não deve conter >');

  // ============================================================
  // 4. VALIDAÇÃO DE TAMANHO MÁXIMO
  // ============================================================

  // Input com mais de 10000 caracteres deve ser rejeitado
  const big = await request(port, 'POST', '/api/categorias', { nome: 'A'.repeat(10001) }, token);
  assert.equal(big.status, 400, 'nome com 10001 caracteres deve ser rejeitado');

  // ============================================================
  // 5. JSON MALFORMADO
  // ============================================================

  // Payload JSON incompleto deve ser rejeitado com 400
  const { request: rawRequest } = require('./helpers');
  const http = require('http');
  const badJson = await new Promise(resolve => {
    const payload = '{"nome": "test"';
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/api/categorias', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), Authorization: `Bearer ${token}` }
    }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(raw) }));
    });
    req.write(payload);
    req.end();
  });
  assert.equal(badJson.status, 400, 'JSON malformado deve retornar 400');

  // ============================================================
  // 6. REQUISIÇÃO SEM TOKEN
  // ============================================================

  // Rota protegida sem token deve retornar 401
  const noAuth = await request(port, 'GET', '/api/categorias');
  assert.equal(noAuth.status, 401, 'sem token deve retornar 401');

  // ============================================================
  // 7. TOKEN INVÁLIDO
  // ============================================================

  // Token qualquer sem valor válido deve retornar 401
  const badToken = await request(port, 'GET', '/api/categorias', undefined, 'invalido');
  assert.equal(badToken.status, 401, 'token inválido deve retornar 401');

  // ============================================================
  // 8. CONTROLE DE ACESSO POR PERFIL
  // ============================================================

  // Usuário com perfil 'usuario' não deve acessar /api/usuarios
  const userLogin = await request(port, 'POST', '/api/login', { email: 'admin@local.test', senha: 'Admin123!', unidade_id: 1 });
  assert.equal(userLogin.status, 200);
  const adminToken = userLogin.data.token;
  const { data: { id: newUserId } } = await request(port, 'POST', '/api/usuarios', { nome: 'User test', email: 'user@test.local', senha: 'Senha123!', perfil: 'usuario' }, adminToken);
  assert.ok(newUserId);
  const usuarioLogin = await request(port, 'POST', '/api/login', { email: 'user@test.local', senha: 'Senha123!', unidade_id: 1 });
  const forbidden = await request(port, 'GET', '/api/usuarios', undefined, usuarioLogin.data.token);
  assert.equal(forbidden.status, 403, 'usuário sem acesso deve receber 403');

  // ============================================================
  // 8.1. TÉCNICO SEM GRUPO — PADRÃO DE CHAMADOS
  // ============================================================

  // Técnico criado sem grupo de permissão ainda deve ver os chamados
  const tecLogin = await request(port, 'POST', '/api/login', { email: 'admin@local.test', senha: 'Admin123!', unidade_id: 1 });
  const adminTecToken = tecLogin.data.token;
  const createdTec = await request(port, 'POST', '/api/usuarios', { nome: 'Técnico sem grupo', email: 'tec.semgrupo@test.local', senha: 'Senha123!', perfil: 'tecnico' }, adminTecToken);
  assert.equal(createdTec.status, 201);
  const tecTokenLogin = await request(port, 'POST', '/api/login', { email: 'tec.semgrupo@test.local', senha: 'Senha123!', unidade_id: 1 });
  assert.equal(tecTokenLogin.status, 200);
  assert.ok(tecTokenLogin.data.usuario.permissoes.includes('chamados.ver_atribuidos'), 'técnico sem grupo deve ver chamados atribuídos');
  const chamadosTec = await request(port, 'GET', '/api/chamados', undefined, tecTokenLogin.data.token);
  assert.equal(chamadosTec.status, 200, 'técnico sem grupo deve listar chamados da unidade');

  // Técnico com permissão chamados.alterar_status deve poder alterar status
  // de um chamado da unidade mesmo não sendo o técnico atribuído.
  const criadoChamado = await request(port, 'POST', '/api/chamados', { titulo: 'Chamado status tecnico', descricao: 'desc' }, tecTokenLogin.data.token);
  assert.equal(criadoChamado.status, 201);
  // Atribuição automática: como só existe um técnico ativo na unidade, o chamado deve ficar com ele
  const chamadoAposAbrir = await request(port, 'GET', `/api/chamados/${criadoChamado.data.id}/detalhes`, undefined, tecTokenLogin.data.token);
  assert.equal(chamadoAposAbrir.status, 200);
  assert.equal(chamadoAposAbrir.data.tecnico_id, tecTokenLogin.data.usuario.id, 'chamado deve ser atribuído ao técnico menos ocupado');
  const alteraStatus = await request(port, 'PUT', `/api/chamados/${criadoChamado.data.id}/status`, { status: 'Em andamento', tecnico_id: tecTokenLogin.data.usuario.id }, tecTokenLogin.data.token);
  assert.equal(alteraStatus.status, 200, 'técnico sem grupo deve alterar status do chamado da unidade');

  // ============================================================
  // 9. RATE LIMIT
  // ============================================================

  // Sobe um servidor dedicado com limite baixo (RATE_LIMIT_MAX=5)
  // para validar que exceder o limite retorna 429.
  const limiterServer = startServer({ RATE_LIMIT_MAX: '5' });
  await waitForServer(limiterServer.server);
  try {
    const many = [];
    for (let i = 0; i < 10; i++) {
      many.push(await request(limiterServer.port, 'GET', '/api/unidades'));
    }
    const blocked = many.some(r => r.status === 429);
    assert.ok(blocked, 'deve haver ao menos uma resposta 429 com muitas requisições');
  } finally {
    limiterServer.server.kill();
    try { fs.rmSync(path.dirname(limiterServer.tempDb), { recursive: true, force: true }); } catch (_) {}
  }

  // ============================================================
  // 10. ERROS DE ATUALIZAÇÃO NÃO VAZAM DETALHES TÉCNICOS
  // ============================================================

  // A rota responde 200 com dados válidos OU erro amigável. Quando há erro,
  // a mensagem deve ser curta e sem detalhes técnicos (status HTTP bruto do GitHub).
  const upd = await request(port, 'GET', '/api/atualizacoes/verificar', undefined, token);
  assert.equal(upd.status, 200);
  if (upd.data.erro) {
    assert.ok(!/\d{3}\s*[-:]\s*.*github/i.test(upd.data.erro), 'não deve vazar status HTTP bruto do GitHub');
    assert.ok(!/error\s+in|at\s+[a-zA-Z_$].*\(/i.test(upd.data.erro), 'não deve vazar stack trace');
    assert.ok(upd.data.erro.length < 200, 'mensagem de erro deve ser curta e amigável');
  } else {
    assert.ok(typeof upd.data.versao_atual === 'string', 'deve retornar a versão atual quando conectado ao GitHub');
  }

  console.log('  ✓ security: SQL injection, XSS, validação, acesso, rate limit, erros de atualização');
};
