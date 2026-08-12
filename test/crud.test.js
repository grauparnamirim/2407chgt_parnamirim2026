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

  await test('usuarios: criar admin e setor_nome', async () => {
    // Cria um setor e vincula a um novo usuário
    const setor = await post('/api/setores', { nome: 'Setor TI' }, t); assert.equal(setor.status, 201);
    const a = await post('/api/usuarios', { nome: 'Admin 2', email: 'admin2@test.local', senha: 'Senha123!', perfil: 'admin', setor: setor.data.id }, t);
    assert.equal(a.status, 201, JSON.stringify(a.data));
    const lista = await get('/api/usuarios', t);
    const criado = lista.data.find(u => Number(u.id) === Number(a.data.id));
    assert.ok(criado, 'usuário deve aparecer na lista');
    assert.equal(criado.perfil, 'admin', 'perfil admin deve ser salvo');
    assert.equal(criado.setor_nome, 'Setor TI', 'lista deve incluir o nome do setor vinculado');
    // Novo admin deve conseguir criar outro usuário
    const login2 = await post('/api/login', { email: 'admin2@test.local', senha: 'Senha123!', unidade_id: 1 });
    assert.equal(login2.status, 200);
    const c2 = await post('/api/usuarios', { nome: 'Usuário do admin2', email: 'u2@test.local', senha: 'Senha123!', perfil: 'usuario' }, login2.data.token);
    assert.equal(c2.status, 201, 'admin criado deve poder cadastrar usuários');
    await del(`/api/usuarios/${c2.data.id}`, login2.data.token);
    await del(`/api/usuarios/${a.data.id}`, t);
    await del(`/api/setores/${setor.data.id}`, t);
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
    // Custo exige um chamado válido
    const semChamado = await post('/api/custos-chamado', { descricao: 'Sem chamado', valor: 10 }, t);
    assert.equal(semChamado.status, 400, JSON.stringify(semChamado.data));
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

  await test('grupos: permissões e membros', async () => {
    // Permissões disponíveis devem estar populadas no seed
    const perm = await get('/api/permissoes', t); assert.equal(perm.status, 200);
    assert.ok(perm.data.lista.length >= 10, 'deve existir permissões no seed: ' + perm.data.lista.length);
    assert.ok(perm.data.agrupadas && Object.keys(perm.data.agrupadas).length >= 3, 'deve vir agrupadas por módulo');
    const permissaoId = perm.data.lista[0].id;

    // Cria grupo, vincula permissão e consulta de volta
    const g = await post('/api/grupos', { nome: 'Grupo Perm', descricao: 'Teste' }, t); assert.equal(g.status, 201);
    const salvarPerm = await put(`/api/grupos/${g.data.id}/permissoes`, { permissoes: [permissaoId] }, t);
    assert.equal(salvarPerm.status, 200);
    const atuais = await get(`/api/grupos/${g.data.id}/permissoes`, t);
    assert.deepEqual(atuais.data.map(Number), [permissaoId], 'deve retornar as permissões do grupo');
    const listaGrupos = await get('/api/grupos', t);
    const grupoNaLista = listaGrupos.data.find(item => Number(item.id) === Number(g.data.id));
    assert.ok(grupoNaLista && grupoNaLista.permissoes.length === 1, 'grupo deve vir com chaves de permissões');
    assert.equal(grupoNaLista.permissoes[0], perm.data.lista[0].chave, 'chave da permissão no grupo');

    // Cria usuário, vincula ao grupo e consulta membros
    const u = await post('/api/usuarios', { nome: 'Membro G', email: 'membro.g@test.local', senha: 'Senha123!', perfil: 'tecnico' }, t);
    assert.equal(u.status, 201);
    await put(`/api/usuarios/${u.data.id}/grupos`, { grupos: [g.data.id] }, t);
    const membros = await get(`/api/grupos/${g.data.id}/usuarios`, t);
    assert.ok(membros.data.some(m => Number(m.id) === Number(u.data.id)), 'usuário deve aparecer como membro');
    const gruposDoUsuario = await get(`/api/usuarios/${u.data.id}/grupos`, t);
    assert.deepEqual(gruposDoUsuario.data.map(g => Number(g.id)), [g.data.id], 'grupos do usuário');

    await del(`/api/usuarios/${u.data.id}`, t);
    await del(`/api/grupos/${g.data.id}`, t);
  });

  await test('relatorios: métricas reais', async () => {
    // Sem chamados, relatório vem zerado
    const vazio = await get('/api/relatorios/tempos', t);
    assert.equal(vazio.status, 200);
    assert.equal(vazio.data.metricas.total_chamados, 0);

    // Abre e resolve um chamado para gerar métrica real
    const chamado = await post('/api/chamados', { titulo: 'Chamado relatório', descricao: 'Teste de métricas' }, t);
    assert.equal(chamado.status, 201);
    const status = await put(`/api/chamados/${chamado.data.id}/status`, { status: 'Resolvido', motivo: 'Corrigido no teste' }, t);
    assert.equal(status.status, 200);

    const rel = await get('/api/relatorios', t);
    assert.equal(rel.status, 200);
    assert.equal(rel.data.totalChamados, 1);
    assert.ok(rel.data.porStatus.find(s => s.status === 'Resolvido').total === 1, 'deve contar resolvidos');

    const tempos = await get('/api/relatorios/tempos', t);
    assert.equal(tempos.status, 200);
    assert.equal(tempos.data.metricas.total_chamados, 1);
    assert.equal(tempos.data.metricas.total_resolvidos, 1);
    assert.equal(tempos.data.chamados.length, 1);
    assert.ok(tempos.data.chamados[0].tempo_aberto_ms >= 0, 'tempo aberto calculado');
    assert.ok(tempos.data.metricas.tempo_medio_util_ms > 0, 'tempo médio útil calculado');
    assert.ok(tempos.data.metricas.mais_rapido_ms > 0, 'mais rápido calculado');
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

  await test('chamado resolvido soma custos na manutenção', async () => {
    // Cria projetor e chamado vinculado
    const ativo = await post('/api/ativos', { patrimonio: 'PAT-CUSTO', modelo: 'Projetor T', tipo: 'projetor' }, t);
    assert.equal(ativo.status, 201, JSON.stringify(ativo.data));
    const ch = await post('/api/chamados', { titulo: 'Chamado custo', descricao: 'Teste', bem_id: ativo.data.id }, t);
    assert.equal(ch.status, 201, JSON.stringify(ch.data));
    // Registra custos no chamado (chamado aberto)
    const c1 = await post('/api/custos-chamado', { chamado_id: ch.data.id, descricao: 'Peça', valor: 150.5 }, t);
    assert.equal(c1.status, 201, JSON.stringify(c1.data));
    const c2 = await post('/api/custos-chamado', { chamado_id: ch.data.id, descricao: 'Serviço', valor: 49.5 }, t);
    assert.equal(c2.status, 201, JSON.stringify(c2.data));
    // Resolve o chamado
    const r = await put(`/api/chamados/${ch.data.id}/status`, { status: 'Resolvido', motivo: 'Concluído no teste' }, t);
    assert.equal(r.status, 200);
    // A manutenção criada deve ter o custo = soma (200.00)
    const chDet = await get(`/api/chamados/${ch.data.id}/detalhes`, t);
    assert.equal(chDet.status, 200);
    assert.equal(chDet.data.bem_patrimonio, 'PAT-CUSTO', 'detalhes deve trazer patrimônio do aparelho');
    assert.equal(chDet.data.bem_tipo, 'projetor', 'detalhes deve trazer tipo do aparelho');
    assert.equal(chDet.data.bem_id, ativo.data.id, 'detalhes deve trazer o aparelho vinculado');
    const manuts = await get(`/api/projetores/${ativo.data.id}`, t);
    assert.equal(manuts.status, 200);
    const auto = manuts.data.manutencoes.find(m => Number(m.chamado_id) === Number(ch.data.id));
    assert.ok(auto, 'deve existir manutenção automática');
    assert.ok(Number(auto.custo) === 200, 'custo da manutenção deve ser a soma dos custos do chamado');
    // Chamado resolvido bloqueia novo custo
    const bloqueado = await post('/api/custos-chamado', { chamado_id: ch.data.id, descricao: 'Tarde', valor: 10 }, t);
    assert.equal(bloqueado.status, 400);
  });

  await test('custos filtrados por chamado', async () => {
    const chA = await post('/api/chamados', { titulo: 'Custo A', descricao: 'Teste' }, t);
    assert.equal(chA.status, 201, JSON.stringify(chA.data));
    const chB = await post('/api/chamados', { titulo: 'Custo B', descricao: 'Teste' }, t);
    assert.equal(chB.status, 201, JSON.stringify(chB.data));
    await post('/api/custos-chamado', { chamado_id: chA.data.id, descricao: 'Unico do A', valor: 10 }, t);
    await post('/api/custos-chamado', { chamado_id: chB.data.id, descricao: 'Unico do B', valor: 20 }, t);
    const soA = await get(`/api/custos-chamado?chamado_id=${chA.data.id}`, t);
    assert.equal(soA.data.length, 1, 'deve trazer apenas o custo do chamado A');
    assert.equal(soA.data[0].chamado_id, chA.data.id);
    assert.equal(soA.data[0].descricao, 'Unico do A');
  });
};
