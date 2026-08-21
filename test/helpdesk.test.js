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
  assert.ok(Array.isArray(unidades.data.unidades));
  assert.equal(unidades.data.unidades.length, 3);
  assert.equal(unidades.data.unidade_fixa, null);

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
  // UNIDADE FIXA DO SERVIDOR (INTRANET LOCAL)
  // ============================================================

  const configAntes = await request(port, 'GET', '/api/config/unidade-fixa');
  assert.equal(configAntes.status, 200);
  assert.equal(configAntes.data.unidade_fixa, null);
  // Define unidade fixa (id 2) como admin
  const setFixa = await request(port, 'PUT', '/api/config/unidade-fixa', { unidade_id: 2 }, login.data.token);
  assert.equal(setFixa.status, 200);
  const configDepois = await request(port, 'GET', '/api/config/unidade-fixa');
  assert.equal(configDepois.data.unidade_fixa, 2);
  const unidadesComFixa = await request(port, 'GET', '/api/unidades');
  assert.equal(unidadesComFixa.data.unidade_fixa, 2);
  // Não-admin não pode alterar
  const semPermissao = await request(port, 'PUT', '/api/config/unidade-fixa', { unidade_id: 1 });
  assert.equal(semPermissao.status, 401);
  // Unidade inválida é rejeitada
  const invalida = await request(port, 'PUT', '/api/config/unidade-fixa', { unidade_id: 999 }, login.data.token);
  assert.equal(invalida.status, 400);
  // Remove a unidade fixa (null) para não afetar os demais testes
  const remover = await request(port, 'PUT', '/api/config/unidade-fixa', { unidade_id: null }, login.data.token);
  assert.equal(remover.status, 200);
  const configFinal = await request(port, 'GET', '/api/config/unidade-fixa');
  assert.equal(configFinal.data.unidade_fixa, null);

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
  // Promoção para admin é permitida ao admin
  const promote = await request(port, 'PUT', `/api/usuarios/${createdUser.data.id}`, { perfil: 'admin' }, login.data.token);
  assert.equal(promote.status, 200);
  // Conta admin (id 1) pode ser editada por outro admin
  const editAdmin = await request(port, 'PUT', '/api/usuarios/1', { nome: 'Administrador de demonstração' }, login.data.token);
  assert.equal(editAdmin.status, 200);
  // Admin não pode rebaixar, inativar ou excluir a si mesmo
  const selfDemote = await request(port, 'PUT', '/api/usuarios/1', { perfil: 'usuario' }, login.data.token);
  assert.equal(selfDemote.status, 403);
  const selfInactive = await request(port, 'PUT', '/api/usuarios/1/ativo', { ativo: false }, login.data.token);
  assert.equal(selfInactive.status, 403);
  const selfDelete = await request(port, 'DELETE', '/api/usuarios/1', undefined, login.data.token);
  assert.equal(selfDelete.status, 403);
  // Conta admin pode ser excluída por outro admin (não é mais protegida)
  const deleteAdmin = await request(port, 'DELETE', `/api/usuarios/${createdUser.data.id}`, undefined, login.data.token);
  assert.equal(deleteAdmin.status, 200);
  // Único administrador ativo restante não pode ser excluído nem inativado
  const lastAdminDelete = await request(port, 'DELETE', '/api/usuarios/1', undefined, login.data.token);
  assert.equal(lastAdminDelete.status, 403);
  const lastAdminInactive = await request(port, 'PUT', '/api/usuarios/1/ativo', { ativo: false }, login.data.token);
  assert.equal(lastAdminInactive.status, 403);

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
