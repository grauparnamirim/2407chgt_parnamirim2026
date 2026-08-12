const { Router } = require('express');
const { getDb } = require('../db');
const { autenticar, operational, now, id, validId, currentUnit } = require('../middleware');

// ============================================================
// IMPORTS E CONFIGURAÇÃO
// ============================================================

const router = Router();

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

// Verifica permissão de acesso a um chamado conforme perfil do usuário:
//   admin    → acesso total
//   usuario  → apenas chamados próprios
//   tecnico  → chamados da sua unidade ou atribuídos a ele
//   gestor   → chamados da sua unidade
function ticketAllowed(req, ticket) {
  if (!ticket) return false;
  if (req.usuario.perfil === 'admin') return true;
  if (req.usuario.perfil === 'usuario') return Number(ticket.usuario_id) === Number(req.usuario.id);
  return (req.usuario.perfil === 'admin' || Number(ticket.unidade_id) === Number(req.usuario.unidade_id)) && (req.usuario.perfil === 'gestor' || Number(ticket.tecnico_id) === Number(req.usuario.id));
}

// Middleware que carrega o chamado em req.chamado e verifica permissão de acesso
function requireTicket(req, res, next) {
  const db = getDb();
  const ticket = db.prepare('SELECT * FROM chamados WHERE id = ?').get(id(req.params.id));
  if (!ticket) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (!ticketAllowed(req, ticket)) return res.status(403).json({ erro: 'Acesso negado a este chamado.' });
  req.chamado = ticket;
  next();
}

// Valida a permissão de alterar status de um chamado:
//   admin    → acesso total
//   gestor   → chamados da sua unidade
//   tecnico  → chamados da sua unidade atribuídos a ele OU com permissão chamados.alterar_status
//   usuario  → apenas chamados próprios
function podeAlterarStatus(req, ticket) {
  if (!ticket) return false;
  if (req.usuario.perfil === 'admin') return true;
  if (req.usuario.perfil === 'usuario') return Number(ticket.usuario_id) === Number(req.usuario.id);
  const daUnidade = Number(ticket.unidade_id) === Number(req.usuario.unidade_id);
  if (req.usuario.perfil === 'gestor') return daUnidade;
  return daUnidade && (Number(ticket.tecnico_id) === Number(req.usuario.id) || (req.usuario.permissoes || []).includes('chamados.alterar_status'));
}

// Middleware específico para alterar status/reabrir — carrega o chamado e valida permissão
function requireStatusPermission(req, res, next) {
  const ticket = getDb().prepare('SELECT * FROM chamados WHERE id = ?').get(id(req.params.id));
  if (!ticket) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (!podeAlterarStatus(req, ticket)) return res.status(403).json({ erro: 'Acesso negado a este chamado.' });
  req.chamado = ticket;
  next();
}

// Enriquece dados do chamado com nomes relacionados (usuário, técnico, fornecedor, local, equipamento)
function enrichChamado(db, c) {
  const bem = c.bem_id ? db.prepare('SELECT * FROM computadores WHERE id = ?').get(c.bem_id) : null;
  return {
    ...c,
    usuario_nome: db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(c.usuario_id)?.nome || '',
    tecnico_nome: c.tecnico_id ? db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(c.tecnico_id)?.nome || '' : '',
    fornecedor_nome: c.fornecedor_id ? db.prepare('SELECT nome FROM fornecedores WHERE id = ?').get(c.fornecedor_id)?.nome || '' : '',
    local_nome: c.local_id ? db.prepare('SELECT nome FROM locais WHERE id = ?').get(c.local_id)?.nome || '' : '',
    bem_nome: bem?.patrimonio || '',
    bem_patrimonio: bem?.patrimonio || '',
    bem_tipo: bem?.tipo || '',
    bem_fabricante: bem?.fabricante || '',
    bem_modelo: bem?.modelo || '',
    bem_local: bem?.local_id ? db.prepare('SELECT nome FROM locais WHERE id = ?').get(bem.local_id)?.nome || '' : '',
    tempo_espera_ms: 0
  };
}

// ============================================================
// CHAMADOS — CRUD e Operações
// ============================================================

// Abre um novo chamado
router.post('/chamados', autenticar, (req, res) => {
  const unidadeId = currentUnit(req, res); if (!unidadeId) return;
  const titulo = String(req.body.titulo || '').trim(), descricao = String(req.body.descricao || '').trim();
  if (!titulo || !descricao) return res.status(400).json({ erro: 'Título e descrição são obrigatórios.' });
  const db = getDb();
  // Vínculo opcional com um equipamento (ex.: projetor) para registrar manutenção ao resolver
  const bemId = validId(req.body.bem_id) ? id(req.body.bem_id) : null;
  if (bemId) {
    const bem = db.prepare('SELECT * FROM computadores WHERE id = ?').get(bemId);
    if (!bem) return res.status(400).json({ erro: 'Equipamento inválido.' });
    if (req.usuario.perfil !== 'admin' && Number(bem.unidade_id) !== Number(unidadeId)) return res.status(400).json({ erro: 'Equipamento não pertence à sua unidade.' });
  }
  const insert = db.transaction(() => {
    const result = db.prepare(`INSERT INTO chamados (titulo, descricao, usuario_id, tecnico_id, unidade_id, subcategoria_id, local_id, bem_id, status, criado_em, atualizado_em)
      VALUES (?, ?, ?, NULL, ?, ?, ?, ?, 'Aberto', ?, ?)`).run(titulo, descricao, req.usuario.id, unidadeId, validId(req.body.subcategoria_id) ? id(req.body.subcategoria_id) : null, validId(req.body.local_id) ? id(req.body.local_id) : null, bemId, now(), now());
    const chamadoId = result.lastInsertRowid;
    // Atribui automaticamente ao técnico ativo da unidade com menos chamados em aberto
    const tecnico = db.prepare(`SELECT u.id FROM usuarios u
      WHERE u.perfil = 'tecnico' AND u.ativo = 1 AND u.unidade_id = ?
      ORDER BY (SELECT COUNT(*) FROM chamados c WHERE c.tecnico_id = u.id AND c.status != 'Resolvido') ASC, u.id ASC
      LIMIT 1`).get(unidadeId);
    if (tecnico) {
      db.prepare('UPDATE chamados SET tecnico_id = ? WHERE id = ?').run(tecnico.id, chamadoId);
    }
    return chamadoId;
  });
  const chamadoId = insert();
  res.status(201).json({ sucesso: true, id: chamadoId, mensagem: 'Chamado aberto!' });
});

// Lista chamados conforme perfil (admin: todos, usuario: próprios, demais: da unidade)
router.get('/chamados', autenticar, (req, res) => {
  const db = getDb();
  let rows;
  if (req.usuario.perfil === 'admin') {
    rows = db.prepare('SELECT * FROM chamados').all();
  } else if (req.usuario.perfil === 'usuario') {
    rows = db.prepare('SELECT * FROM chamados WHERE usuario_id = ?').all(req.usuario.id);
  } else {
    rows = db.prepare('SELECT * FROM chamados WHERE unidade_id = ?').all(req.usuario.unidade_id);
  }
  if (req.query.status) {
    const statuses = String(req.query.status).split(',');
    rows = rows.filter(c => statuses.includes(c.status));
  }
  res.json(rows.map(c => enrichChamado(db, c)).sort((a, b) => b.id - a.id));
});

// Altera o status de um chamado e registra notificação da mudança
router.put('/chamados/:id/status', autenticar, requireStatusPermission, operational, (req, res) => {
  const status = String(req.body.status || '').trim();
  const validos = ['Aberto', 'Em andamento', 'Aguardando Fornecedor', 'Resolvido', 'Reaberto'];
  if (!validos.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  if (status === 'Resolvido' && !String(req.body.motivo || '').trim()) return res.status(400).json({ erro: 'Informe o motivo da resolução.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM chamados WHERE id = ?').get(id(req.params.id));
  db.prepare('UPDATE chamados SET status = ?, motivo = ?, fornecedor_id = ?, tecnico_id = COALESCE(tecnico_id, ?), atualizado_em = ? WHERE id = ?').run(status, String(req.body.motivo || '').trim() || null, validId(req.body.fornecedor_id) ? id(req.body.fornecedor_id) : null, req.usuario.id, now(), id(req.params.id));
  db.prepare('INSERT INTO notificacoes_log (chamado_id, usuario_id, alterado_por, status_anterior, status_novo, enviada_em) VALUES (?, ?, ?, ?, ?, ?)').run(before.id, before.usuario_id, req.usuario.id, before.status, status, now());
  // Se o chamado estava vinculado a um equipamento (ex.: projetor), registra a
  // manutenção automaticamente ao resolver — apenas uma vez por chamado.
  // O custo da manutenção recebe a soma dos custos registrados no chamado.
  if (status === 'Resolvido' && before.bem_id) {
    const jaRegistrada = db.prepare('SELECT 1 FROM manutencoes WHERE chamado_id = ?').get(before.id);
    if (!jaRegistrada) {
      const somaCustos = db.prepare('SELECT COALESCE(SUM(valor), 0) AS total FROM custos_chamado WHERE chamado_id = ?').get(before.id).total || 0;
      db.prepare(`INSERT INTO manutencoes (bem_id, tipo, categoria_servico_id, nome_servico, descricao, data_prevista, status, custo, tecnico_responsavel_id, criado_em, atualizado_em, data_realizada_em, chamado_id)
        VALUES (?, 'corretiva', NULL, ?, ?, NULL, 'concluida', ?, ?, ?, ?, ?, ?)`).run(
        before.bem_id, `Resolvido via chamado #${before.id}`, String(req.body.motivo || '').trim() || null, somaCustos || null, req.usuario.id, now(), now(), now(), before.id);
    }
  }
  res.json({ sucesso: true, mensagem: `Status alterado para "${status}".` });
});

// Reabre um chamado que estava resolvido
router.put('/chamados/:id/reabrir', autenticar, requireStatusPermission, (req, res) => {
  if (req.chamado.status !== 'Resolvido') return res.status(400).json({ erro: 'Apenas chamados resolvidos podem ser reabertos.' });
  getDb().prepare('UPDATE chamados SET status = ?, atualizado_em = ? WHERE id = ?').run('Reaberto', now(), id(req.params.id));
  res.json({ sucesso: true, mensagem: 'Chamado reaberto com sucesso!' });
});

// Atualiza título, descrição e local de um chamado
router.put('/chamados/:id', autenticar, requireTicket, operational, (req, res) => {
  getDb().prepare('UPDATE chamados SET titulo = ?, descricao = ?, local_id = ?, atualizado_em = ? WHERE id = ?').run(
    String(req.body.titulo || '').trim() || req.chamado.titulo,
    String(req.body.descricao || '').trim() || req.chamado.descricao,
    req.body.local_id === undefined ? req.chamado.local_id : (validId(req.body.local_id) ? id(req.body.local_id) : null),
    now(), id(req.params.id));
  res.json({ sucesso: true, mensagem: 'Chamado atualizado com sucesso!' });
});

// Exclui um chamado
router.delete('/chamados/:id', autenticar, requireTicket, operational, (req, res) => {
  getDb().prepare('DELETE FROM chamados WHERE id = ?').run(id(req.params.id));
  res.json({ sucesso: true, mensagem: 'Chamado excluído com sucesso!' });
});

// Retorna o histórico de alterações de status de um chamado
router.get('/chamados/:id/historico', autenticar, requireTicket, (req, res) => {
  const db = getDb();
  const chamado = enrichChamado(db, db.prepare('SELECT * FROM chamados WHERE id = ?').get(id(req.params.id)));
  const historico = db.prepare('SELECT * FROM notificacoes_log WHERE chamado_id = ?').all(id(req.params.id)).map(x => ({
    ...x, alterado_por_nome: db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(x.alterado_por)?.nome || ''
  }));
  res.json({ chamado, historico });
});

// Retorna detalhes completos de um chamado com dados enriquecidos
router.get('/chamados/:id/detalhes', autenticar, requireTicket, (req, res) => {
  const db = getDb();
  res.json(enrichChamado(db, db.prepare('SELECT * FROM chamados WHERE id = ?').get(id(req.params.id))));
});

// Lista comentários de um chamado com dados do autor
router.get('/chamados/:id/comentarios', autenticar, requireTicket, (req, res) => {
  const db = getDb();
  const comentarios = db.prepare('SELECT * FROM comentarios WHERE chamado_id = ? ORDER BY id').all(id(req.params.id)).map(x => ({
    ...x,
    autor_nome: db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(x.usuario_id)?.nome || '',
    autor_perfil: db.prepare('SELECT perfil FROM usuarios WHERE id = ?').get(x.usuario_id)?.perfil || ''
  }));
  res.json(comentarios);
});

// Adiciona um comentário a um chamado
router.post('/chamados/:id/comentarios', autenticar, requireTicket, (req, res) => {
  const texto = String(req.body.texto || '').trim();
  if (!texto) return res.status(400).json({ erro: 'O comentário não pode estar vazio.' });
  getDb().prepare('INSERT INTO comentarios (chamado_id, usuario_id, texto, criado_em) VALUES (?, ?, ?, ?)').run(id(req.params.id), req.usuario.id, texto, now());
  res.status(201).json({ sucesso: true, mensagem: 'Comentário adicionado!' });
});

module.exports = router;
