const { Router } = require('express');
const { getDb } = require('../db');
const { autenticar, operational, admin, now, id, currentUnit, ticketAllowed } = require('../middleware');
const { createCrudRoutes } = require('./crud');

const router = Router();

// === FINANCEIRO ===
router.use(createCrudRoutes({ path: 'custos-chamado', table: 'custos_chamado', fields: ['chamado_id', 'descricao', 'tipo', 'valor', 'fornecedor_id'], message: 'Custo' }));
// Lista custos de chamados (com filtro opcional por chamado_id)
router.get('/custos-chamado', autenticar, (req, res) => {
  const db = getDb();
  let rows = db.prepare('SELECT * FROM custos_chamado').all();
  if (req.query.chamado_id) rows = rows.filter(x => Number(x.chamado_id) === id(req.query.chamado_id));
  res.json(rows.filter(c => ticketAllowed(req, db.prepare('SELECT * FROM chamados WHERE id = ?').get(c.chamado_id))));
});

router.use(createCrudRoutes({ path: 'orcamentos-chamado', table: 'orcamentos_chamado', fields: ['chamado_id', 'fornecedor_id', 'descricao', 'valor', 'status'], message: 'Orçamento' }));

// Aprova um orçamento de chamado (apenas admin)
router.put('/orcamentos-chamado/:id/aprovar', autenticar, admin, (req, res) => {
  getDb().prepare("UPDATE orcamentos_chamado SET status = 'aprovado' WHERE id = ?").run(id(req.params.id));
  res.json({ sucesso: true, mensagem: 'Orçamento aprovado!' });
});

// Rejeita um orçamento de chamado (apenas admin)
router.put('/orcamentos-chamado/:id/rejeitar', autenticar, admin, (req, res) => {
  getDb().prepare("UPDATE orcamentos_chamado SET status = 'rejeitado' WHERE id = ?").run(id(req.params.id));
  res.json({ sucesso: true, mensagem: 'Orçamento rejeitado!' });
});

router.use(createCrudRoutes({ path: 'compras-mensais', table: 'compras_mensais', fields: ['mes', 'ano', 'fornecedor_id', 'item', 'objetivo', 'valor_estimado', 'status'], message: 'Compra' }));

// Atualiza o status de uma compra mensal
router.put('/compras-mensais/:id/status', autenticar, operational, (req, res) => {
  getDb().prepare('UPDATE compras_mensais SET status = ? WHERE id = ?').run(req.body.status, id(req.params.id));
  res.json({ sucesso: true, mensagem: 'Status atualizado!' });
});

// Retorna relatório financeiro (dados mockados — estrutura reservada)
router.get('/relatorios/financeiros', autenticar, operational, (_, res) => res.json({ total_gasto: 0, gastos_por_tipo: [], gastos_por_setor: [], top_chamados: [], orcamentos_pendentes: [] }));

// === NOTAS FISCAIS ===
router.use(createCrudRoutes({ path: 'notas-fiscais', table: 'notas_fiscais', fields: ['numero', 'fornecedor_id', 'chamado_id', 'valor', 'data_emissao', 'data_vencimento', 'data_pagamento', 'status', 'observacoes'], message: 'Nota fiscal' }));

// Retorna estatísticas de notas fiscais (dados mockados)
router.get('/notas-fiscais/estatisticas', autenticar, operational, (_, res) => res.json({ total: 0, pendentes: 0, pagas: 0, atrasadas: 0, valor_total: 0 }));

// Atualiza o status e data de pagamento de uma nota fiscal
router.put('/notas-fiscais/:id/status', autenticar, operational, (req, res) => {
  getDb().prepare('UPDATE notas_fiscais SET status = ?, data_pagamento = ? WHERE id = ?').run(req.body.status, req.body.data_pagamento || null, id(req.params.id));
  res.json({ sucesso: true, mensagem: 'Status atualizado!' });
});

// === NF COMPARATIVO ===
router.use(createCrudRoutes({ path: 'nf-comparativo', table: 'nf_comparativo_mensal', fields: ['mes', 'ano', 'valor_acadweb', 'valor_prefeitura', 'observacoes'], message: 'Comparativo' }));

// Retorna um registro de comparativo NF pelo ID
router.get('/nf-comparativo/:id', autenticar, operational, (req, res) => {
  const item = getDb().prepare('SELECT * FROM nf_comparativo_mensal WHERE id = ?').get(id(req.params.id));
  if (!item) return res.status(404).json({ erro: 'Comparativo não encontrado.' });
  res.json(item);
});

// === MANUTENÇÃO CATEGORIAS ===
// DELETE customizado: bloqueia a exclusão de uma categoria de serviço que
// ainda esteja vinculada a manutenções, evitando o erro de foreign key.
router.delete('/manutencoes/categorias-servico/:id', autenticar, operational, (req, res) => {
  const db = getDb();
  const categoriaId = id(req.params.id);
  const categoria = db.prepare('SELECT * FROM categorias_servico_manutencao WHERE id = ?').get(categoriaId);
  if (!categoria) return res.status(404).json({ erro: 'Categoria de serviço não encontrada.' });
  const emUso = db.prepare('SELECT COUNT(*) AS c FROM manutencoes WHERE categoria_servico_id = ?').get(categoriaId).c;
  if (emUso > 0) {
    return res.status(409).json({ erro: `Não é possível excluir "${categoria.nome}" pois está vinculada a ${emUso} manutenção(ões).` });
  }
  db.prepare('DELETE FROM categorias_servico_manutencao WHERE id = ?').run(categoriaId);
  res.json({ sucesso: true, mensagem: 'Categoria de serviço removida!' });
});

router.use(createCrudRoutes({ path: 'manutencoes/categorias-servico', table: 'categorias_servico_manutencao', fields: ['nome'], message: 'Categoria de serviço' }));

// === RELATÓRIOS ===

// Permite acesso a relatórios para perfis operacionais OU quem tiver a permissão
function relatoriosAllowed(req, res, next) {
  const perms = req.usuario.permissoes || [];
  if (['admin', 'gestor', 'tecnico'].includes(req.usuario.perfil) ||
      perms.includes('relatorios.ver_dashboard') || perms.includes('relatorios.ver_tempos')) return next();
  return res.status(403).json({ erro: 'Acesso negado.' });
}

// Chamados visíveis ao usuário nos relatórios.
// - admin: todos; gestor: da unidade (com filtro opcional por técnico);
// - tecnico: apenas os próprios chamados atribuídos;
// - usuario: apenas os chamados que ele mesmo abriu.
// gestorId (query): permite a admin/gestor filtrar por um técnico específico.
// Quando gestorId é o próprio id, o filtro é ignorado (visão completa da unidade).
function relatorioChamados(req, gestorId) {
  const db = getDb();
  const filtroTecnico = chamados => gestorId && gestorId !== req.usuario.id
    ? chamados.filter(c => Number(c.tecnico_id) === gestorId)
    : chamados;
  if (req.usuario.perfil === 'admin') {
    return filtroTecnico(db.prepare('SELECT * FROM chamados').all());
  }
  if (req.usuario.perfil === 'usuario') {
    return db.prepare('SELECT * FROM chamados WHERE usuario_id = ?').all(req.usuario.id);
  }
  if (req.usuario.perfil === 'tecnico') {
    return db.prepare('SELECT * FROM chamados WHERE tecnico_id = ?').all(req.usuario.id);
  }
  return filtroTecnico(db.prepare('SELECT * FROM chamados WHERE unidade_id = ?').all(req.usuario.unidade_id));
}

// Reconstrói a linha do tempo de status de um chamado a partir do notificacoes_log
// e calcula tempo aberto, tempo aguardando fornecedor e tempo útil (em ms).
function calcularTemposChamado(db, c) {
  const inicio = new Date(c.criado_em).getTime();
  const fim = c.status === 'Resolvido' ? new Date(c.atualizado_em || c.criado_em).getTime() : Date.now();
  const logs = db.prepare('SELECT * FROM notificacoes_log WHERE chamado_id = ? ORDER BY enviada_em ASC').all(c.id);
  const eventos = [{ t: inicio, status: 'Aberto' }];
  logs.forEach(l => eventos.push({ t: new Date(l.enviada_em).getTime(), status: l.status_novo }));
  eventos.push({ t: fim, status: c.status });
  let espera = 0;
  for (let i = 0; i < eventos.length - 1; i++) {
    const dt = eventos[i + 1].t - eventos[i].t;
    if (dt > 0 && eventos[i].status === 'Aguardando Fornecedor') espera += dt;
  }
  const aberto = Math.max(0, fim - inicio);
  return {
    tempo_aberto_ms: aberto,
    tempo_espera_ms: espera,
    tempo_util_ms: Math.max(0, aberto - espera)
  };
}

// Retorna relatório geral de chamados agrupados por status e técnico
router.get('/relatorios', autenticar, relatoriosAllowed, (req, res) => {
  const db = getDb();
  const gestorId = id(req.query.gestor_id);
  const chamados = relatorioChamados(req, gestorId);
  const count = status => chamados.filter(c => c.status === status).length;
  const porTecnicoMap = {};
  chamados.forEach(c => {
    if (!c.tecnico_id) return;
    const nome = db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(c.tecnico_id)?.nome || `Técnico #${c.tecnico_id}`;
    porTecnicoMap[nome] = (porTecnicoMap[nome] || 0) + 1;
  });
  res.json({
    porStatus: ['Aberto', 'Em andamento', 'Resolvido'].map(status => ({ status, total: count(status) })),
    porTecnico: Object.entries(porTecnicoMap).map(([tecnico, total]) => ({ tecnico, total })),
    totalChamados: chamados.length
  });
});

// Retorna relatório de tempos de chamados concluídos com métricas reais
router.get('/relatorios/tempos', autenticar, relatoriosAllowed, (req, res) => {
  const db = getDb();
  const gestorId = id(req.query.gestor_id);
  const todosChamados = relatorioChamados(req, gestorId);
  const concluidos = todosChamados.filter(c => c.status === 'Resolvido');
  const chamados = concluidos.map(c => {
    const t = calcularTemposChamado(db, c);
    return {
      id: c.id, titulo: c.titulo,
      usuario_nome: db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(c.usuario_id)?.nome || '',
      tecnico_nome: c.tecnico_id ? db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(c.tecnico_id)?.nome || '' : '',
      aberto_em: c.criado_em,
      concluido_em: c.atualizado_em || c.criado_em,
      tempo_util_ms: t.tempo_util_ms,
      tempo_espera_ms: t.tempo_espera_ms,
      tempo_aberto_ms: t.tempo_aberto_ms
    };
  });
  const total = chamados.length;
  const totalChamados = todosChamados.length;
  const totalResolvidos = total;
  const somaUtil = chamados.reduce((s, c) => s + c.tempo_util_ms, 0);
  const somaTotal = chamados.reduce((s, c) => s + c.tempo_aberto_ms, 0);
  res.json({
    chamados,
    metricas: {
      tempo_medio_util_ms: total ? Math.round(somaUtil / total) : 0,
      tempo_medio_total_ms: total ? Math.round(somaTotal / total) : 0,
      mais_demorado_ms: total ? Math.max(...chamados.map(c => c.tempo_aberto_ms)) : 0,
      mais_rapido_ms: total ? Math.min(...chamados.map(c => c.tempo_aberto_ms)) : 0,
      total_chamados: totalChamados,
      total_resolvidos: totalResolvidos
    }
  });
});

// === ADMIN: GRUPOS E PERMISSÕES ===
// Retorna todas as permissões disponíveis, agrupadas por módulo
router.get('/permissoes', autenticar, admin, (_, res) => {
  const db = getDb();
  const lista = db.prepare('SELECT * FROM permissoes').all();
  const agrupadas = {};
  lista.forEach(p => {
    const modulo = p.chave.split('.')[0];
    (agrupadas[modulo] = agrupadas[modulo] || []).push(p);
  });
  res.json({ lista, agrupadas });
});

// Retorna todos os grupos de usuários com permissões e flag de sistema
router.get('/grupos', autenticar, admin, (_, res) => {
  const db = getDb();
  const grupos = db.prepare('SELECT * FROM grupos').all();
  res.json(grupos.map(g => ({
    ...g,
    sistema: false,
    permissoes: db.prepare(`SELECT p.chave FROM grupos_permissoes gp JOIN permissoes p ON p.id = gp.permissao_id WHERE gp.grupo_id = ?`).all(g.id).map(r => r.chave)
  })));
});
router.use(createCrudRoutes({ path: 'grupos', table: 'grupos', fields: ['nome', 'descricao'], message: 'Grupo', manage: admin }));

// Retorna os IDs das permissões de um grupo
router.get('/grupos/:id/permissoes', autenticar, admin, (req, res) => {
  const rows = getDb().prepare('SELECT permissao_id FROM grupos_permissoes WHERE grupo_id = ?').all(id(req.params.id));
  res.json(rows.map(r => r.permissao_id));
});

// Retorna os usuários de um grupo
router.get('/grupos/:id/usuarios', autenticar, admin, (req, res) => {
  const rows = getDb().prepare(`SELECT u.id, u.nome, u.email, u.perfil FROM usuarios u
    JOIN usuarios_grupos ug ON ug.usuario_id = u.id WHERE ug.grupo_id = ?`).all(id(req.params.id));
  res.json(rows);
});

// Atualiza as permissões de um grupo (substitui todas as associações).
// Aceita tanto IDs numéricos quanto chaves de permissão.
router.put('/grupos/:id/permissoes', autenticar, admin, (req, res) => {
  const db = getDb();
  const grupoId = id(req.params.id);
  const raw = Array.isArray(req.body.permissoes) ? req.body.permissoes : [];
  const permissionIds = raw.map(v => {
    if (Number.isInteger(Number(v))) return Number(v);
    const found = db.prepare('SELECT id FROM permissoes WHERE chave = ?').get(String(v));
    return found ? found.id : null;
  }).filter(v => v !== null);
  db.prepare('DELETE FROM grupos_permissoes WHERE grupo_id = ?').run(grupoId);
  const insert = db.prepare('INSERT INTO grupos_permissoes (grupo_id, permissao_id) VALUES (?, ?)');
  permissionIds.forEach(permissao_id => insert.run(grupoId, permissao_id));
  res.json({ sucesso: true, mensagem: 'Permissões atualizadas!' });
});

// Retorna os grupos de um usuário (com nome, para exibição)
router.get('/usuarios/:id/grupos', autenticar, admin, (req, res) => {
  const rows = getDb().prepare(`SELECT g.id, g.nome FROM grupos g JOIN usuarios_grupos ug ON ug.grupo_id = g.id WHERE ug.usuario_id = ?`).all(id(req.params.id));
  res.json(rows);
});

// Atualiza os grupos de um usuário (substitui todas as associações)
router.put('/usuarios/:id/grupos', autenticar, admin, (req, res) => {
  const db = getDb();
  const groups = Array.isArray(req.body.grupos) ? req.body.grupos.map(id) : [];
  db.prepare('DELETE FROM usuarios_grupos WHERE usuario_id = ?').run(id(req.params.id));
  const insert = db.prepare('INSERT INTO usuarios_grupos (usuario_id, grupo_id) VALUES (?, ?)');
  groups.forEach(grupo_id => insert.run(id(req.params.id), grupo_id));
  res.json({ sucesso: true, mensagem: 'Grupos atualizados!' });
});

// === PESQUISA ===
// Pesquisa global por chamados e ativos (mínimo 2 caracteres)
router.get('/pesquisa', autenticar, (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  if (q.length < 2) return res.json({ chamados: [], ativos: [] });
  const db = getDb();
  let chamados, ativos;
  if (req.usuario.perfil === 'admin') {
    chamados = db.prepare("SELECT id, titulo, descricao FROM chamados WHERE titulo || ' ' || COALESCE(descricao,'') LIKE ?").all(`%${q}%`).slice(0, 8).map(c => ({ id: c.id, titulo: c.titulo, resumo: c.descricao || '', destino: '/painel' }));
    ativos = db.prepare("SELECT id, patrimonio, modelo FROM computadores WHERE COALESCE(patrimonio,'') || ' ' || COALESCE(modelo,'') LIKE ?").all(`%${q}%`).slice(0, 8).map(c => ({ id: c.id, titulo: c.patrimonio || c.modelo || 'Ativo', resumo: c.modelo || '', destino: '/inventario' }));
  } else {
    chamados = db.prepare("SELECT id, titulo, descricao FROM chamados WHERE unidade_id = ? AND (titulo || ' ' || COALESCE(descricao,'') LIKE ?)").all(req.usuario.unidade_id, `%${q}%`).slice(0, 8).map(c => ({ id: c.id, titulo: c.titulo, resumo: c.descricao || '', destino: '/painel' }));
    ativos = db.prepare("SELECT id, patrimonio, modelo FROM computadores WHERE unidade_id = ? AND (COALESCE(patrimonio,'') || ' ' || COALESCE(modelo,'') LIKE ?)").all(req.usuario.unidade_id, `%${q}%`).slice(0, 8).map(c => ({ id: c.id, titulo: c.patrimonio || c.modelo || 'Ativo', resumo: c.modelo || '', destino: '/inventario' }));
  }
  res.json({ chamados, ativos });
});

module.exports = router;
