const { Router } = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');
const { autenticar, operational, now, id, currentUnit, unitScope } = require('../middleware');

// ============================================================
// IMPORTS E CONFIGURAÇÃO
// ============================================================

const router = Router();

const SIGLAS_UNIDADE = { 1: 'PN', 2: 'NC', 3: 'ZN' };

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

// Gera um código de patrimônio único baseado na sigla da unidade + hexadecimal aleatório
function gerarPatrimonio(db, unidadeId) {
  const sigla = SIGLAS_UNIDADE[Number(unidadeId)] || 'XX';
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const patrimonio = sigla + hex;
    if (!db.prepare('SELECT 1 FROM computadores WHERE patrimonio = ?').get(patrimonio)) return patrimonio;
  }
  throw new Error('Não foi possível gerar um patrimônio único após 50 tentativas.');
}

// Enriquece um ativo com nomes relacionados (usuário, setor, local)
function enrichAsset(db, a) {
  return {
    ...a, usuario_nome: db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(a.usuario_id)?.nome || '',
    setor_nome: db.prepare('SELECT nome FROM setores WHERE id = ?').get(a.setor_id)?.nome || '',
    local_nome: db.prepare('SELECT nome FROM locais WHERE id = ?').get(a.local_id)?.nome || ''
  };
}

// Retorna a lista de ativos conforme o perfil do usuário (admin vê todos, demais vêem apenas da sua unidade)
function assetList(req) {
  const db = getDb();
  let rows;
  if (req.usuario.perfil === 'admin') {
    rows = db.prepare('SELECT * FROM computadores').all();
  } else {
    rows = db.prepare('SELECT * FROM computadores WHERE unidade_id = ?').all(req.usuario.unidade_id);
  }
  return rows.map(a => enrichAsset(db, a));
}

// ============================================================
// ASSET CRUD — Listagem, Criação, Atualização, Exclusão
// ============================================================

// Lista todos os ativos
router.get('/computadores', autenticar, operational, (req, res) => res.json(assetList(req)));
// Alias para listagem de ativos
router.get('/ativos', autenticar, operational, (req, res) => res.json(assetList(req)));

// Cria um novo ativo (computador)
router.post('/computadores', autenticar, operational, createAsset);
// Alias para criação de ativo
router.post('/ativos', autenticar, operational, createAsset);

// Atualiza um ativo existente
router.put('/computadores/:id', autenticar, operational, updateAsset);
// Alias para atualização de ativo
router.put('/ativos/:id', autenticar, operational, updateAsset);

// Remove um ativo
router.delete('/computadores/:id', autenticar, operational, deleteAsset);
// Alias para remoção de ativo
router.delete('/ativos/:id', autenticar, operational, deleteAsset);

// Atribui um usuário a um ativo (valida se o usuário pertence à mesma unidade)
router.put(['/computadores/:id/atribuir', '/ativos/:id/atribuir'], autenticar, operational, (req, res) => {
  const db = getDb();
  const asset = db.prepare('SELECT * FROM computadores WHERE id = ?').get(id(req.params.id));
  if (!asset || !unitScope(req, asset)) return res.status(404).json({ erro: 'Ativo não encontrado.' });
  const userId = req.body.usuario_id ? id(req.body.usuario_id) : null;
  if (userId) {
    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(userId);
    if (!user || Number(user.unidade_id) !== Number(asset.unidade_id)) return res.status(400).json({ erro: 'Usuário inválido para esta unidade.' });
  }
  db.prepare('UPDATE computadores SET usuario_id = ? WHERE id = ?').run(userId, asset.id);
  res.json({ sucesso: true, mensagem: 'Usuário atribuído!' });
});

// Retorna ativos da unidade com resumo para exibição no mapa de rede
router.get('/ativos/mapa-rede', autenticar, operational, (req, res) => {
  const db = getDb();
  let rows;
  if (req.usuario.perfil === 'admin') {
    rows = db.prepare('SELECT * FROM computadores').all();
  } else {
    rows = db.prepare('SELECT * FROM computadores WHERE unidade_id = ?').all(req.usuario.unidade_id);
  }
  const porIp = new Map();
  rows.forEach(a => { const ip = String(a.ip_endereco || a.ip || '').trim(); if (ip) porIp.set(ip, (porIp.get(ip) || 0) + 1); });
  const itens = rows.map(a => {
    const local = a.local_id ? db.prepare('SELECT nome, tipo FROM locais WHERE id = ?').get(a.local_id) : null;
    return {
      ...enrichAsset(db, a),
      local_tipo: local?.tipo || null,
      ip_endereco: a.ip_endereco || a.ip || '',
      ip_duplicado: Boolean(a.ip_endereco && porIp.get(String(a.ip_endereco).trim()) > 1)
    };
  });
  const comIp = itens.filter(a => a.ip_endereco).length;
  const conflitosIp = [...porIp.values()].filter(n => n > 1).length;
  res.json({
    resumo: { total: itens.length, com_ip: comIp, sem_ip: itens.length - comIp, conflitos_ip: conflitosIp },
    itens,
    pode_ver_acesso_remoto: req.usuario.perfil === 'admin' || (req.usuario.permissoes || []).includes('ativos.editar')
  });
});

// ============================================================
// MOVIMENTAÇÃO DE ATIVOS
// ============================================================

// Lista movimentações de um ativo
router.get('/ativos/:id/movimentacoes', autenticar, operational, (req, res) => {
  res.json(getDb().prepare('SELECT * FROM movimentacoes_bens WHERE bem_id = ?').all(id(req.params.id)));
});

// Registra uma nova movimentação e atualiza o local do ativo
router.post('/ativos/:id/movimentacoes', autenticar, operational, (req, res) => {
  const db = getDb();
  const asset = db.prepare('SELECT * FROM computadores WHERE id = ?').get(id(req.params.id));
  const localId = id(req.body.local_destino_id);
  if (!asset || !unitScope(req, asset)) return res.status(404).json({ erro: 'Ativo não encontrado.' });
  const local = db.prepare('SELECT * FROM locais WHERE id = ?').get(localId);
  if (!local || !unitScope(req, local)) return res.status(400).json({ erro: 'Local de destino inválido.' });
  db.prepare('INSERT INTO movimentacoes_bens (bem_id, local_origem_id, local_destino_id, usuario_responsavel_id, observacao, criado_em) VALUES (?, ?, ?, ?, ?, ?)').run(
    asset.id, asset.local_id || null, localId, req.usuario.id, String(req.body.observacao || '').trim(), now());
  db.prepare('UPDATE computadores SET local_id = ? WHERE id = ?').run(localId, asset.id);
  res.status(201).json({ sucesso: true, mensagem: 'Movimentação registrada!' });
});

// ============================================================
// MANUTENÇÃO DE ATIVOS
// ============================================================

// Lista manutenções com status "agendada"
router.get('/ativos/manutencoes-agendadas', autenticar, operational, (req, res) => {
  const db = getDb();
  const rows = db.prepare("SELECT m.*, c.patrimonio, cat.nome AS categoria_servico_nome FROM manutencoes m JOIN computadores c ON m.bem_id = c.id LEFT JOIN categorias_servico_manutencao cat ON m.categoria_servico_id = cat.id WHERE m.status = 'agendada'").all();
  res.json(rows.filter(m => unitScope(req, { unidade_id: db.prepare('SELECT unidade_id FROM computadores WHERE id = ?').get(m.bem_id)?.unidade_id })));
});

// Retorna locais e computadores elegíveis para manutenção preventiva
router.get('/ativos/manutencao-preventiva/candidatos', autenticar, operational, (req, res) => {
  const db = getDb();
  const locais = req.usuario.perfil === 'admin'
    ? db.prepare('SELECT * FROM locais WHERE ativo != 0').all()
    : db.prepare('SELECT * FROM locais WHERE unidade_id = ? AND ativo != 0').all(req.usuario.unidade_id);
  res.json({
    unidade_id: req.usuario.unidade_id,
    locais: locais.map(l => {
      const comps = db.prepare('SELECT * FROM computadores WHERE local_id = ? AND unidade_id = ?').all(l.id, req.usuario.unidade_id);
      return { ...l, computadores: comps.map(c => ({
        ...c, impedido: db.prepare("SELECT COUNT(*) AS c FROM manutencoes WHERE bem_id = ? AND tipo = 'preventiva' AND status = 'agendada'").get(c.id).c > 0
      })) };
    })
  });
});

// Cria manutenções preventivas em lote para múltiplos ativos
router.post('/ativos/manutencoes/lote', autenticar, operational, (req, res) => {
  const db = getDb();
  const ids = [...new Set((req.body.bem_ids || []).map(id).filter(Number.isInteger))];
  if (!ids.length) return res.status(400).json({ erro: 'Selecione ao menos um ativo.' });
  let created = 0;
  const insert = db.prepare('INSERT INTO manutencoes (bem_id, tipo, categoria_servico_id, nome_servico, descricao, data_prevista, status, tecnico_responsavel_id, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const check = db.prepare("SELECT COUNT(*) AS c FROM manutencoes WHERE bem_id = ? AND tipo = 'preventiva' AND status = 'agendada'");
  for (const bem_id of ids) {
    const asset = db.prepare('SELECT * FROM computadores WHERE id = ?').get(bem_id);
    if (asset && unitScope(req, asset) && check.get(bem_id).c === 0) {
      insert.run(bem_id, 'preventiva', id(req.body.categoria_servico_id) || null, String(req.body.nome_servico || '').trim(), String(req.body.descricao || '').trim(), req.body.data_prevista || null, 'agendada', req.usuario.id, now(), now());
      created++;
    }
  }
  res.status(201).json({ sucesso: true, criados: created, ignorados: [], mensagem: 'Manutenções preventivas agendadas!' });
});

// Lista manutenções de um ativo específico
router.get('/ativos/:id/manutencoes', autenticar, operational, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT m.*, c.nome AS categoria_servico_nome FROM manutencoes m LEFT JOIN categorias_servico_manutencao c ON m.categoria_servico_id = c.id WHERE m.bem_id = ?').all(id(req.params.id));
  res.json(rows);
});

// Registra uma nova manutenção para um ativo
router.post('/ativos/:id/manutencoes', autenticar, operational, (req, res) => {
  const db = getDb();
  const result = db.prepare('INSERT INTO manutencoes (bem_id, tipo, categoria_servico_id, nome_servico, descricao, data_prevista, status, tecnico_responsavel_id, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id(req.params.id), req.body.tipo || 'corretiva', id(req.body.categoria_servico_id) || null,
    String(req.body.nome_servico || '').trim(), String(req.body.descricao || '').trim(),
    req.body.data_prevista || null, req.body.status || 'agendada', req.usuario.id, now(), now());
  res.status(201).json({ sucesso: true, id: result.lastInsertRowid, mensagem: 'Manutenção registrada!' });
});

const MANUTENCAO_UPDATE_COLS = ['tipo', 'categoria_servico_id', 'nome_servico', 'descricao', 'data_prevista', 'status', 'custo', 'data_realizada_em'];
// Atualiza dados de uma manutenção (conclui automaticamente se custo for informado)
router.put('/manutencoes/:id', autenticar, operational, (req, res) => {
  const db = getDb();
  const m = db.prepare('SELECT * FROM manutencoes WHERE id = ?').get(id(req.params.id));
  if (!m) return res.status(404).json({ erro: 'Manutenção não encontrada.' });
  const sets = [], vals = [];
  for (const col of MANUTENCAO_UPDATE_COLS) {
    if (req.body[col] !== undefined) { sets.push(`${col} = ?`); vals.push(req.body[col]); }
  }
  if (req.body.custo !== undefined && m.status !== 'concluida') {
    sets.push('status = ?', 'data_realizada_em = ?');
    vals.push('concluida', now());
  }
  if (sets.length) { sets.push('atualizado_em = ?'); vals.push(now()); vals.push(m.id); db.prepare(`UPDATE manutencoes SET ${sets.join(', ')} WHERE id = ?`).run(...vals); }
  res.json({ sucesso: true, mensagem: 'Manutenção atualizada!' });
});

// ============================================================
// CHECKLISTS DE LABORATÓRIO
// ============================================================

// Retorna laboratórios disponíveis e, se informado um local, os itens para a conferência
router.get('/checklists-laboratorio/preparacao', autenticar, operational, (req, res) => {
  const db = getDb();
  const isAdmin = req.usuario.perfil === 'admin';
  const laboratorios = db.prepare(`SELECT l.id, l.nome, l.tipo,
    (SELECT COUNT(*) FROM computadores c WHERE c.local_id = l.id AND c.status != 'Desativado' AND c.status != 'Baixado') +
    (SELECT COUNT(*) FROM dispositivos d WHERE d.local_id = l.id AND d.ativo = 1) +
    (SELECT COUNT(*) FROM impressoras i WHERE i.local_id = l.id AND i.ativo = 1) AS total_bens
    FROM locais l WHERE l.tipo = 'laboratorio' AND l.ativo = 1${isAdmin ? '' : ' AND l.unidade_id = ?'} ORDER BY l.nome COLLATE NOCASE`)
    .all(...(isAdmin ? [] : [req.usuario.unidade_id]));
  const localId = id(req.query.local_id);
  let itens = [];
  if (localId) {
    itens.push({ tipo: 'internet', chave: 'internet', bem_id: null, nome: 'Internet e rede do laboratório' });
    const bens = db.prepare(`SELECT c.*, l.nome AS local_nome FROM computadores c LEFT JOIN locais l ON l.id = c.local_id
      WHERE c.local_id = ? AND c.status != 'Desativado' AND c.status != 'Baixado' ORDER BY c.patrimonio`).all(localId);
    for (const bem of bens) {
      const descricao = [bem.modelo, bem.fabricante].filter(Boolean).join(' · ');
      itens.push({ tipo: 'bem', chave: `bem:${bem.id}`, bem_id: bem.id, nome: bem.patrimonio || descricao || `Bem #${bem.id}` });
    }
  }
  res.json({ laboratorios, itens });
});

// Lista os checklists de laboratório (com resultado e responsável) respeitando filtros
router.get('/checklists-laboratorio', autenticar, operational, (req, res) => {
  const db = getDb();
  const isAdmin = req.usuario.perfil === 'admin';
  const condicoes = [];
  const params = [];
  if (!isAdmin) { condicoes.push('cl.unidade_id = ?'); params.push(req.usuario.unidade_id); }
  if (id(req.query.local_id)) { condicoes.push('cl.local_id = ?'); params.push(id(req.query.local_id)); }
  const limite = Math.min(200, Math.max(1, parseInt(req.query.limite, 10) || 50));
  const where = condicoes.length ? ' WHERE ' + condicoes.join(' AND ') : '';
  const rows = db.prepare(`SELECT cl.*, u.nome AS realizado_por_nome,
      (SELECT COUNT(*) FROM checklist_laboratorio_itens i WHERE i.checklist_id = cl.id AND i.estado = 'problema') AS total_problemas,
      (SELECT COUNT(*) FROM checklist_laboratorio_itens i WHERE i.checklist_id = cl.id AND i.estado = 'ausente') AS total_ausentes
    FROM checklists_laboratorio cl LEFT JOIN usuarios u ON u.id = cl.usuario_id${where}
    ORDER BY cl.criado_em DESC LIMIT ?`).all(...params, limite);
  for (const row of rows) {
    if (!row.local_nome_snapshot) {
      row.local_nome_snapshot = db.prepare('SELECT nome FROM locais WHERE id = ?').get(row.local_id)?.nome || 'Local removido';
    }
  }
  res.json(rows);
});

// Retorna um checklist específico com seus itens
router.get('/checklists-laboratorio/:id', autenticar, operational, (req, res) => {
  const db = getDb();
  const cl = db.prepare('SELECT * FROM checklists_laboratorio WHERE id = ?').get(id(req.params.id));
  if (!cl) return res.status(404).json({ erro: 'Checklist não encontrado.' });
  if (req.usuario.perfil !== 'admin' && Number(cl.unidade_id) !== Number(req.usuario.unidade_id)) {
    return res.status(403).json({ erro: 'Acesso negado.' });
  }
  const localNome = cl.local_nome_snapshot || db.prepare('SELECT nome FROM locais WHERE id = ?').get(cl.local_id)?.nome || 'Local removido';
  const usuario = db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(cl.usuario_id);
  const itens = db.prepare('SELECT * FROM checklist_laboratorio_itens WHERE checklist_id = ? ORDER BY id').all(cl.id)
    .map(i => ({ ...i, situacao: i.estado, observacao: i.observacoes, nome_snapshot: i.nome_snapshot || 'Item' }));
  res.json({ ...cl, local_nome_snapshot: localNome, realizado_por_nome: usuario?.nome || 'Usuário removido', itens });
});

// Cria um novo checklist com seus itens (salva snapshot dos nomes para exibição futura)
router.post('/checklists-laboratorio', autenticar, operational, (req, res) => {
  const unit = currentUnit(req, res); if (!unit) return;
  const db = getDb();
  const local = db.prepare('SELECT * FROM locais WHERE id = ?').get(id(req.body.local_id));
  if (!local || !unitScope(req, local)) return res.status(400).json({ erro: 'Laboratório inválido.' });
  const localNomeSnapshot = local.nome;
  const result = db.prepare('INSERT INTO checklists_laboratorio (local_id, unidade_id, turno, observacoes, usuario_id, local_nome_snapshot, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    local.id, unit, req.body.turno || 'outro', String(req.body.observacoes || '').trim(), req.usuario.id, localNomeSnapshot, now());
  const insert = db.prepare('INSERT INTO checklist_laboratorio_itens (checklist_id, estado, observacoes, tipo, chave, bem_id, nome_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)');
  let problemas = 0;
  for (const item of (req.body.itens || [])) {
    const situacao = item.situacao || item.estado || null;
    if (situacao === 'problema') problemas++;
    insert.run(result.lastInsertRowid, situacao, item.observacao || item.observacoes || null, item.tipo || 'bem', item.chave || null, id(item.bem_id) || null, item.nome || null);
  }
  res.status(201).json({ sucesso: true, id: result.lastInsertRowid, problemas, mensagem: problemas ? `Checklist salvo com ${problemas} pendência${problemas === 1 ? '' : 's'}!` : 'Checklist salvo!' });
});

// ============================================================
// INDICADORES DE MANUTENÇÃO
// ============================================================

// Retorna indicadores de manutenção (resumo, série histórica, ativos recorrentes)
router.get('/ativos/indicadores-manutencao', autenticar, operational, (req, res) => {
  const db = getDb();
  const meses = Math.max(1, parseInt(req.query.meses, 10) || 3);
  const dataLimite = new Date();
  dataLimite.setMonth(dataLimite.getMonth() - meses);
  const dataStr = dataLimite.toISOString();
  const isAdmin = req.usuario.perfil === 'admin';
  const unitFilter = isAdmin ? '' : ' AND c.unidade_id = ?';
  const unitParam = isAdmin ? [] : [req.usuario.unidade_id];

  const resumo = db.prepare(`SELECT
    SUM(CASE WHEN m.status = 'concluida' THEN 1 ELSE 0 END) AS concluidas,
    SUM(CASE WHEN m.status != 'concluida' THEN 1 ELSE 0 END) AS pendentes,
    SUM(m.custo) AS custo_total,
    AVG(m.custo) AS custo_medio
    FROM manutencoes m JOIN computadores c ON m.bem_id = c.id
    WHERE m.criado_em >= ?${unitFilter}`).get(dataStr, ...unitParam);

  const serieRows = db.prepare(`SELECT strftime('%m', m.criado_em) AS mes, strftime('%Y', m.criado_em) AS ano, COUNT(*) AS total
    FROM manutencoes m JOIN computadores c ON m.bem_id = c.id
    WHERE m.status = 'concluida' AND m.criado_em >= ?${unitFilter}
    GROUP BY ano, mes ORDER BY ano, mes`).all(dataStr, ...unitParam);

  const mesesRotulo = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const serie = serieRows.map(r => ({ rotulo: `${mesesRotulo[parseInt(r.mes, 10) - 1]}/${r.ano.slice(2)}`, total: r.total }));

  const recorrentes = db.prepare(`SELECT c.id, c.patrimonio, c.tipo, c.fabricante, c.modelo, COUNT(*) AS total
    FROM manutencoes m JOIN computadores c ON m.bem_id = c.id
    WHERE m.criado_em >= ?${unitFilter}
    GROUP BY c.id ORDER BY total DESC LIMIT 10`).all(dataStr, ...unitParam);

  res.json({
    resumo: {
      concluidas: resumo.concluidas || 0,
      pendentes: resumo.pendentes || 0,
      custo_total: resumo.custo_total || 0,
      custo_medio: resumo.custo_medio || 0
    },
    serie,
    recorrentes
  });
});

// Retorna um ativo específico com dados enriquecidos
router.get('/ativos/:id', autenticar, operational, (req, res) => {
  const db = getDb();
  const asset = db.prepare('SELECT * FROM computadores WHERE id = ?').get(id(req.params.id));
  if (!asset || !unitScope(req, asset)) return res.status(404).json({ erro: 'Ativo não encontrado.' });
  res.json(enrichAsset(db, asset));
});

// Cria um novo ativo no banco com patrimônio gerado automaticamente se não informado
function createAsset(req, res) {
  const unidadeId = currentUnit(req, res); if (!unidadeId) return;
  const db = getDb();
  const { patrimonio, modelo, ip, ip_endereco, usuario_id, local_id, setor_id, tipo, status,
    fabricante, num_serie, observacoes, processador, memoria_ram, armazenamento_tipo, armazenamento_tamanho, anydesk_id, teamviewer_id } = req.body;
  const patroFinal = patrimonio || gerarPatrimonio(db, unidadeId);
  const result = db.prepare(`INSERT INTO computadores (patrimonio, modelo, ip, ip_endereco, usuario_id, local_id, setor_id, unidade_id, tipo, status, fabricante, num_serie, observacoes, processador, memoria_ram, armazenamento_tipo, armazenamento_tamanho, anydesk_id, teamviewer_id, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    patroFinal, modelo || null, ip || null, ip_endereco || null, usuario_id || null, local_id || null, setor_id || null,
    unidadeId, tipo || 'gabinete', status || 'Ativo',
    fabricante || null, num_serie || null, observacoes || null, processador || null, memoria_ram || null,
    armazenamento_tipo || null, armazenamento_tamanho || null, anydesk_id || null, teamviewer_id || null, now(), now());
  res.status(201).json({ sucesso: true, id: result.lastInsertRowid, patrimonio: patroFinal, mensagem: 'Ativo cadastrado!' });
}

// Atualiza campos de um ativo existente com validação de escopo por unidade
function updateAsset(req, res) {
  const db = getDb();
  const asset = db.prepare('SELECT * FROM computadores WHERE id = ?').get(id(req.params.id));
  if (!asset) return res.status(404).json({ erro: 'Ativo não encontrado.' });
  if (!unitScope(req, asset)) return res.status(403).json({ erro: 'Acesso negado.' });
  const cols = ['patrimonio','modelo','ip','ip_endereco','usuario_id','local_id','setor_id','tipo','status',
    'fabricante','num_serie','observacoes','processador','memoria_ram','armazenamento_tipo','armazenamento_tamanho','anydesk_id','teamviewer_id'];
  const sets = [], vals = [];
  for (const col of cols) {
    if (req.body[col] !== undefined) { sets.push(`${col} = ?`); vals.push(req.body[col] !== '' ? req.body[col] : null); }
  }
  if (sets.length) { sets.push('atualizado_em = ?'); vals.push(now()); vals.push(asset.id); db.prepare(`UPDATE computadores SET ${sets.join(', ')} WHERE id = ?`).run(...vals); }
  res.json({ sucesso: true, mensagem: 'Ativo atualizado!' });
}

// Remove um ativo do banco com validação de escopo por unidade
function deleteAsset(req, res) {
  const db = getDb();
  const asset = db.prepare('SELECT * FROM computadores WHERE id = ?').get(id(req.params.id));
  if (!asset) return res.status(404).json({ erro: 'Ativo não encontrado.' });
  if (!unitScope(req, asset)) return res.status(403).json({ erro: 'Acesso negado.' });
  db.prepare('DELETE FROM computadores WHERE id = ?').run(asset.id);
  res.json({ sucesso: true, mensagem: 'Ativo removido!' });
}

module.exports = router;
