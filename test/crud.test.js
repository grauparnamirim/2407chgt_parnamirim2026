// ============================================================
// TESTES DE CRUD — TODAS AS ENTIDADES
// ============================================================

const assert = require('assert');
const { request } = require('./helpers');

// Executa operações CRUD em todas as entidades do sistema
module.exports = async function testCrud(port) {
  // ============================================================
  // ALIAS PARA REQUISIÇÕES
  // ============================================================

  async function post(path, body, tok) { return request(port, 'POST', path, body, tok); }
  async function get(path, tok) { return request(port, 'GET', path, undefined, tok); }
  async function put(path, body, tok) { return request(port, 'PUT', path, body, tok); }
  async function del(path, tok) { return request(port, 'DELETE', path, undefined, tok); }

  // ============================================================
  // EXECUTOR DE TESTE INDIVIDUAL
  // ============================================================

  // Executa um teste com nome e captura falhas
  async function test(label, fn) {
    try { await fn(); console.log('  ✓ crud: ' + label); } catch (e) { console.error('  ✗ crud: ' + label + ' - ' + e.message); throw e; }
  }

  // ============================================================
  // AUTENTICAÇÃO INICIAL
  // ============================================================

  const login = await post('/api/login', { email: 'admin@local.test', senha: 'Admin123!', unidade_id: 1 });
  assert.equal(login.status, 200);
  const t = login.data.token;

  // ============================================================
  // CRUD POR ENTIDADE
  // ============================================================

  await test('categorias', async () => {
    const c = await post('/api/categorias', { nome: 'CRUD Teste' }, t); assert.equal(c.status, 201, JSON.stringify(c.data));
    const list = await get('/api/categorias', t); assert.ok(list.data.some(i => Number(i.id) === Number(c.data.id)));
    await put(`/api/categorias/${c.data.id}`, { nome: 'CRUD Teste' }, t); assert.equal(c.status, 201);
    await del(`/api/categorias/${c.data.id}`, t);
    const after = await get('/api/categorias', t); assert.ok(!after.data.some(i => Number(i.id) === Number(c.data.id)));
  });

  await test('subcategorias', async () => {
    const c = await post('/api/categorias', { nome: 'Cat Mãe' }, t);
    const s = await post('/api/subcategorias', { nome: 'Sub', categoria_id: c.data.id }, t); assert.equal(s.status, 201);
    await del(`/api/subcategorias/${s.data.id}`, t);
    await del(`/api/categorias/${c.data.id}`, t);
  });

  await test('fornecedores', async () => {
    const c = await post('/api/fornecedores', { nome: 'Fornecedor T' }, t); assert.equal(c.status, 201);
    await del(`/api/fornecedores/${c.data.id}`, t);
  });

  await test('setores', async () => {
    const c = await post('/api/setores', { nome: 'Setor T' }, t); assert.equal(c.status, 201);
    await del(`/api/setores/${c.data.id}`, t);
  });

  await test('locais', async () => {
    const c = await post('/api/locais', { nome: 'Local T', tipo: 'sala', ativo: 1 }, t); assert.equal(c.status, 201);
    await del(`/api/locais/${c.data.id}`, t);
  });

  await test('usuarios', async () => {
    const c = await post('/api/usuarios', { nome: 'Técnico T', email: 'tec.t@test.local', senha: 'Senha123!', perfil: 'tecnico' }, t); assert.equal(c.status, 201);
    await put(`/api/usuarios/${c.data.id}`, { nome: 'Técnico Atualizado' }, t);
    await del(`/api/usuarios/${c.data.id}`, t);
  });

  await test('chamados', async () => {
    const c = await post('/api/chamados', { titulo: 'Chamado T', descricao: 'Desc' }, t); assert.equal(c.status, 201);
    const cm = await post(`/api/chamados/${c.data.id}/comentarios`, { texto: 'Comentário' }, t); assert.equal(cm.status, 201);
    const st = await put(`/api/chamados/${c.data.id}/status`, { status: 'Em andamento' }, t); assert.equal(st.status, 200);
    const hi = await get(`/api/chamados/${c.data.id}/historico`, t); assert.ok(hi.data.historico.length > 0);
    const dt = await get(`/api/chamados/${c.data.id}/detalhes`, t); assert.equal(dt.status, 200);
    await del(`/api/chamados/${c.data.id}`, t);
  });

  await test('dispositivos', async () => {
    const d = await post('/api/dispositivos', { nome: 'Switch T' }, t); assert.equal(d.status, 201);
    const n = await post(`/api/dispositivos/${d.data.id}/numeros`, { numero: '192.168.1.1' }, t); assert.equal(n.status, 201);
    const ns = await get(`/api/dispositivos/${d.data.id}/numeros`, t); assert.ok(ns.data.length > 0);
    await del(`/api/dispositivos/${d.data.id}`, t);
    const list = await get('/api/dispositivos', t); assert.ok(!list.data.some(x => Number(x.id) === Number(d.data.id)));
  });

  await test('impressoras', async () => {
    const i = await post('/api/impressoras', { nome: 'HP T', contagem_atual: 1000 }, t); assert.equal(i.status, 201);
    await post('/api/leituras', { impressora_id: i.data.id, contagem: 1500 }, t);
    const ls = await get('/api/leituras', t); assert.ok(ls.data.some(l => Number(l.impressora_id) === Number(i.data.id)));
    await del(`/api/impressoras/${i.data.id}`, t);
  });

  await test('ativos', async () => {
    const local = await post('/api/locais', { nome: 'Local Ativo', tipo: 'sala', ativo: 1, unidade_id: 1 }, t); assert.equal(local.status, 201);
    const a = await post('/api/ativos', { patrimonio: 'PAT-001', modelo: 'Dell' }, t); assert.equal(a.status, 201, JSON.stringify(a.data));
    const m = await post(`/api/ativos/${a.data.id}/movimentacoes`, { local_destino_id: local.data.id }, t); assert.equal(m.status, 201, JSON.stringify(m.data));
    const ms = await get(`/api/ativos/${a.data.id}/movimentacoes`, t); assert.ok(ms.data.length > 0);
    await del(`/api/ativos/${a.data.id}`, t);
    await del(`/api/locais/${local.data.id}`, t);
  });

  await test('notas-fiscais', async () => {
    const nf = await post('/api/notas-fiscais', { numero: 'NF-001', valor: 1500.50, status: 'pendente' }, t); assert.equal(nf.status, 201, JSON.stringify(nf.data));
    await del(`/api/notas-fiscais/${nf.data.id}`, t);
  });

  await test('compras-mensais', async () => {
    const c = await post('/api/compras-mensais', { mes: 7, ano: 2026, item: 'Papel', valor_estimado: 89.90, status: 'pendente' }, t); assert.equal(c.status, 201);
    await del(`/api/compras-mensais/${c.data.id}`, t);
  });

  await test('orcamentos-chamado', async () => {
    const o = await post('/api/orcamentos-chamado', { descricao: 'Orçamento T', valor: 500, status: 'pendente' }, t); assert.equal(o.status, 201, JSON.stringify(o.data));
    await del(`/api/orcamentos-chamado/${o.data.id}`, t);
  });

  await test('custos-chamado', async () => {
    const c = await post('/api/custos-chamado', { descricao: 'Custo T', tipo: 'material', valor: 100 }, t); assert.equal(c.status, 201, JSON.stringify(c.data));
    await del(`/api/custos-chamado/${c.data.id}`, t);
  });

  await test('nf-comparativo', async () => {
    const nf = await post('/api/nf-comparativo', { mes: 7, ano: 2026, valor_acadweb: 1000, valor_prefeitura: 950 }, t); assert.equal(nf.status, 201);
    await del(`/api/nf-comparativo/${nf.data.id}`, t);
  });

  await test('grupos', async () => {
    const g = await post('/api/grupos', { nome: 'Grupo T', descricao: 'Desc' }, t); assert.equal(g.status, 201);
    await put(`/api/grupos/${g.data.id}/permissoes`, { permissoes: [] }, t);
    await del(`/api/grupos/${g.data.id}`, t);
  });

  await test('servicos (FK em uso)', async () => {
    // Cria categoria de serviço e uma manutenção vinculada a ela
    const cat = await post('/api/manutencoes/categorias-servico', { nome: 'Serviço FK Teste' }, t);
    assert.equal(cat.status, 201, JSON.stringify(cat.data));
    const ativo = await post('/api/ativos', { patrimonio: 'PAT-FK', modelo: 'Dell' }, t); assert.equal(ativo.status, 201);
    const manut = await post(`/api/ativos/${ativo.data.id}/manutencoes`, { categoria_servico_id: cat.data.id, nome_servico: 'Manutenção FK' }, t);
    assert.equal(manut.status, 201, JSON.stringify(manut.data));

    // Exclusão deve ser bloqueada (409) com mensagem amigável — sem stack trace
    const bloqueada = await del(`/api/manutencoes/categorias-servico/${cat.data.id}`, t);
    assert.equal(bloqueada.status, 409, 'deve bloquear exclusão de serviço em uso');
    assert.ok(bloqueada.data.erro && bloqueada.data.erro.includes('manutenção'), 'mensagem deve ser amigável');

    // Removendo a manutenção, a exclusão da categoria passa a funcionar
    await del(`/api/ativos/${ativo.data.id}`, t);
    const liberada = await del(`/api/manutencoes/categorias-servico/${cat.data.id}`, t);
    assert.equal(liberada.status, 200, 'após desvincular, exclusão deve funcionar');
  });
};
