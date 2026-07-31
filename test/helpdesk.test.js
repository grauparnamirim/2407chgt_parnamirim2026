const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { startServer, waitForServer, request } = require('./helpers');

// ============================================================
// TESTES DO MÓDULO DE HELP DESK
// ============================================================

// Testa login, categorias, usuários e módulos vazios
module.exports = async function testHelpdesk(port) {
  // ============================================================
  // LISTAGEM DE UNIDADES
  // ============================================================

  const unidades = await request(port, 'GET', '/api/unidades');
  assert.equal(unidades.status, 200);
  assert.equal(unidades.data.length, 3);

  // ============================================================
  // LOGIN EM MÚLTIPLAS UNIDADES
  // ============================================================

  const logins = [];
  for (const unidade_id of [1, 2, 3]) {
    const login = await request(port, 'POST', '/api/login', { email: 'admin@local.test', senha: 'Admin123!', unidade_id });
    assert.equal(login.status, 200);
    assert.equal(login.data.usuario.unidade_id, unidade_id);
    assert.ok(login.data.token);
    logins.push(login);
  }
  const login = logins[1];

  // ============================================================
  // CRUD DE CATEGORIAS
  // ============================================================

  const category = await request(port, 'POST', '/api/categorias', { nome: 'Teste local' }, login.data.token);
  assert.equal(category.status, 201);
  const categories = await request(port, 'GET', '/api/categorias', undefined, login.data.token);
  assert.equal(categories.status, 200);
  assert.equal(categories.data[0].nome, 'Teste local');

  // ============================================================
  // CRIAÇÃO DE USUÁRIO E PROTEÇÃO DE PERFIL
  // ============================================================

  const createdUser = await request(port, 'POST', '/api/usuarios', { nome: 'Técnico local', email: 'tecnico@local.test', senha: 'SenhaLocal123!', perfil: 'tecnico' }, login.data.token);
  assert.equal(createdUser.status, 201);
  const dangerous = await request(port, 'PUT', `/api/usuarios/${createdUser.data.id}`, { perfil: 'admin' }, login.data.token);
  assert.equal(dangerous.status, 400);

  // ============================================================
  // MÓDULOS VAZIOS — TODOS DEVEM RETORNAR 200
  // ============================================================

  const emptyModules = [
    '/api/chamados', '/api/fornecedores', '/api/dispositivos', '/api/setores', '/api/locais',
    '/api/computadores', '/api/ativos', '/api/ativos/mapa-rede', '/api/ativos/manutencoes-agendadas',
    '/api/checklists-laboratorio/preparacao', '/api/manutencoes/categorias-servico',
    '/api/custos-chamado', '/api/orcamentos-chamado', '/api/compras-mensais',
    '/api/impressoras', '/api/leituras', '/api/parametros-impressao',
    '/api/notas-fiscais', '/api/notas-fiscais/estatisticas', '/api/nf-comparativo',
    '/api/relatorios', '/api/relatorios/tempos', '/api/grupos', '/api/permissoes'
  ];
  for (const route of emptyModules) {
    const response = await request(port, 'GET', route, undefined, login.data.token);
    assert.equal(response.status, 200, route);
  }

  console.log('  ✓ helpdesk: login, unidades, CRUD básico, módulos vazios');
};
