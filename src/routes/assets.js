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
async function gerarPatrimonio(db, unidadeId) {
  const sigla = SIGLAS_UNIDADE[Number(unidadeId)] || 'XX';
  for (let tentativa = 0; tentativa < 50; tentativa++) {
    const hex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const patrimonio = sigla + hex;
    if (!(await db.prepare('SELECT 1 FROM computadores WHERE patrimonio = ?').get(patrimonio))) return patrimonio;
  }
  throw new Error('Não foi possível gerar um patrimônio único após 50 tentativas.');
}

// Enriquece um ativo com nomes relacionados (usuário, setor, local)
async function enrichAsset(db, a) {
  return {
    ...a, usuario_nome: (await db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(a.usuario_id))?.nome || '',
    setor_nome: (await db.prepare('SELECT nome FROM setores WHERE id = ?').get(a.setor_id))?.nome || '',
    local_nome: (await db.prepare('SELECT nome FROM locais WHERE id = ?').get(a.local_id))?.nome || ''
  };
}

// Retorna a lista de ativos conforme o perfil do usuário (admin vê todos, demais vêem apenas da sua unidade)
async function assetList(req) {
  const db = getDb();
  let rows;
  if (req.usuario.perfil === 'admin') {
    rows = (await db.prepare('SELECT * FROM computadores').all());
  } else {
    rows = (await db.prepare('SELECT * FROM computadores WHERE unidade_id = ?').all(req.usuario.unidade_id));
  }
  return await Promise.all(rows.map(a => enrichAsset(db, a)));
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
router.put(['/computadores/:id/atribuir', '/ativos/:id/atribuir'], autenticar, operational,async  (req, res) => {
  const db = getDb();
  const asset = (await db.prepare('SELECT * FROM computadores WHERE id = ?').get(id(req.params.id)));
  if (!asset || !unitScope(req, asset)) return res.status(404).json({ erro: 'Ativo não encontrado.' });
  const userId = req.body.usuario_id ? id(req.body.usuario_id) : null;
  if (userId) {
    const user = (await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(userId));
    if (!user || Number(user.unidade_id) !== Number(asset.unidade_id)) return res.status(400).json({ erro: 'Usuário inválido para esta unidade.' });
  }
  (await db.prepare('UPDATE computadores SET usuario_id = ? WHERE id = ?').run(userId, asset.id));
  res.json({ sucesso: true, mensagem: 'Usuário atribuído!' });
});

// Retorna ativos da unidade com resumo para exibição no mapa de rede
router.get('/ativos/mapa-rede', autenticar, operational,async  (req, res) => {
  const db = getDb();
  let rows;
  if (req.usuario.perfil === 'admin') {
    rows = (await db.prepare('SELECT * FROM computadores').all());
  } else {
    rows = (await db.prepare('SELECT * FROM computadores WHERE unidade_id = ?').all(req.usuario.unidade_id));
  }
  const porIp = new Map();
  rows.forEach(a => { const ip = String(a.ip_endereco || a.ip || '').trim(); if (ip) porIp.set(ip, (porIp.get(ip) || 0) + 1); });
  const itens = await Promise.all(rows.map(async a => {
    const local = a.local_id ? (await db.prepare('SELECT nome, tipo FROM locais WHERE id = ?').get(a.local_id)) : null;
    return {
      ...(await enrichAsset(db, a)),
      local_tipo: local?.tipo || null,
      ip_endereco: a.ip_endereco || a.ip || '',
      ip_duplicado: Boolean(a.ip_endereco && porIp.get(String(a.ip_endereco).trim()) > 1)
    };
  }));
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
router.get('/ativos/:id/movimentacoes', autenticar, operational,async  (req, res) => {
  res.json((await getDb().prepare('SELECT * FROM movimentacoes_bens WHERE bem_id = ?').all(id(req.params.id))));
});

// Registra uma nova movimentação e atualiza o local do ativo
router.post('/ativos/:id/movimentacoes', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const asset = (await db.prepare('SELECT * FROM computadores WHERE id = ?').get(id(req.params.id)));
  const localId = id(req.body.local_destino_id);
  if (!asset || !unitScope(req, asset)) return res.status(404).json({ erro: 'Ativo não encontrado.' });
  const local = (await db.prepare('SELECT * FROM locais WHERE id = ?').get(localId));
  if (!local || !unitScope(req, local)) return res.status(400).json({ erro: 'Local de destino inválido.' });
  (await db.prepare('INSERT INTO movimentacoes_bens (bem_id, local_origem_id, local_destino_id, usuario_responsavel_id, observacao, criado_em) VALUES (?, ?, ?, ?, ?, ?)').run(
    asset.id, asset.local_id || null, localId, req.usuario.id, String(req.body.observacao || '').trim(), now()));
  (await db.prepare('UPDATE computadores SET local_id = ? WHERE id = ?').run(localId, asset.id));
  res.status(201).json({ sucesso: true, mensagem: 'Movimentação registrada!' });
});

// ============================================================
// MANUTENÇÃO DE ATIVOS
// ============================================================

// Lista manutenções com status "agendada"
router.get('/ativos/manutencoes-agendadas', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const rows = (await db.prepare("SELECT m.*, c.patrimonio, cat.nome AS categoria_servico_nome FROM manutencoes m JOIN computadores c ON m.bem_id = c.id LEFT JOIN categorias_servico_manutencao cat ON m.categoria_servico_id = cat.id WHERE m.status = 'agendada'").all());
  const visiveis = await Promise.all(rows.map(async m => ({
    m,
    keep: unitScope(req, { unidade_id: (await db.prepare('SELECT unidade_id FROM computadores WHERE id = ?').get(m.bem_id))?.unidade_id })
  })));
  res.json(visiveis.filter(v => v.keep).map(v => v.m));
});

// Retorna locais e computadores elegíveis para manutenção preventiva
router.get('/ativos/manutencao-preventiva/candidatos', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const locais = req.usuario.perfil === 'admin'
    ? (await db.prepare('SELECT * FROM locais WHERE ativo != 0').all())
    : (await db.prepare('SELECT * FROM locais WHERE unidade_id = ? AND ativo != 0').all(req.usuario.unidade_id));
  res.json({
    unidade_id: req.usuario.unidade_id,
    locais: await Promise.all(locais.map(async l => {
      const comps = await db.prepare('SELECT * FROM computadores WHERE local_id = ? AND unidade_id = ?').all(l.id, req.usuario.unidade_id);
      return {
        ...l,
        computadores: await Promise.all(comps.map(async c => ({
          ...c,
          impedido: (await db.prepare("SELECT COUNT(*) AS c FROM manutencoes WHERE bem_id = ? AND tipo = 'preventiva' AND status = 'agendada'").get(c.id)).c > 0
        })))
      };
    }))
  });
});

// Cria manutenções preventivas em lote para múltiplos ativos
router.post('/ativos/manutencoes/lote', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const ids = [...new Set((req.body.bem_ids || []).map(id).filter(Number.isInteger))];
  if (!ids.length) return res.status(400).json({ erro: 'Selecione ao menos um ativo.' });
  let created = 0;
  const insert = db.prepare('INSERT INTO manutencoes (bem_id, tipo, categoria_servico_id, nome_servico, descricao, data_prevista, status, tecnico_responsavel_id, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const check = db.prepare("SELECT COUNT(*) AS c FROM manutencoes WHERE bem_id = ? AND tipo = 'preventiva' AND status = 'agendada'");
  for (const bem_id of ids) {
    const asset = (await db.prepare('SELECT * FROM computadores WHERE id = ?').get(bem_id));
    if (asset && unitScope(req, asset) && await check.get(bem_id).c === 0) {
      await insert.run(bem_id, 'preventiva', id(req.body.categoria_servico_id) || null, String(req.body.nome_servico || '').trim(), String(req.body.descricao || '').trim(), req.body.data_prevista || null, 'agendada', req.usuario.id, now(), now());
      created++;
    }
  }
  res.status(201).json({ sucesso: true, criados: created, ignorados: [], mensagem: 'Manutenções preventivas agendadas!' });
});

// Lista manutenções de um ativo específico
router.get('/ativos/:id/manutencoes', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const rows = (await db.prepare('SELECT m.*, c.nome AS categoria_servico_nome FROM manutencoes m LEFT JOIN categorias_servico_manutencao c ON m.categoria_servico_id = c.id WHERE m.bem_id = ?').all(id(req.params.id)));
  res.json(rows);
});

// Registra uma nova manutenção para um ativo
// Suporta entrada manual de manutenção concluída: data_quebra (→criado_em),
// data_retorno (→data_realizada_em) e custo (conclui automaticamente quando
// informado sem status). Sem esses campos mantém o comportamento original.
router.post('/ativos/:id/manutencoes', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const custo = req.body.custo !== undefined && req.body.custo !== null && req.body.custo !== '' ? Number(req.body.custo) : null;
  const status = req.body.status || (custo != null ? 'concluida' : 'agendada');
  const criadoEm = req.body.data_quebra ? String(req.body.data_quebra).trim() : now();
  const realizadoEm = status === 'concluida' ? (req.body.data_retorno ? String(req.body.data_retorno).trim() : now()) : null;
  const result = (await db.prepare('INSERT INTO manutencoes (bem_id, tipo, categoria_servico_id, nome_servico, descricao, data_prevista, status, custo, tecnico_responsavel_id, criado_em, atualizado_em, data_realizada_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    id(req.params.id), req.body.tipo || 'corretiva', id(req.body.categoria_servico_id) || null,
    String(req.body.nome_servico || '').trim(), String(req.body.descricao || '').trim(),
    req.body.data_prevista || null, status, custo, req.usuario.id, criadoEm, now(), realizadoEm));
  res.status(201).json({ sucesso: true, id: result.lastInsertRowid, mensagem: 'Manutenção registrada!' });
});

const MANUTENCAO_UPDATE_COLS = ['tipo', 'categoria_servico_id', 'nome_servico', 'descricao', 'data_prevista', 'status', 'custo', 'data_realizada_em'];
// Atualiza dados de uma manutenção (conclui automaticamente se custo for informado)
router.put('/manutencoes/:id', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const m = (await db.prepare('SELECT * FROM manutencoes WHERE id = ?').get(id(req.params.id)));
  if (!m) return res.status(404).json({ erro: 'Manutenção não encontrada.' });
  const sets = [], vals = [];
  for (const col of MANUTENCAO_UPDATE_COLS) {
    if (req.body[col] !== undefined) { sets.push(`${col} = ?`); vals.push(req.body[col]); }
  }
  if (req.body.custo !== undefined && m.status !== 'concluida') {
    sets.push('status = ?', 'data_realizada_em = ?');
    vals.push('concluida', now());
  }
  if (sets.length) { sets.push('atualizado_em = ?'); vals.push(now()); vals.push(m.id); (await db.prepare(`UPDATE manutencoes SET ${sets.join(', ')} WHERE id = ?`).run(...vals)); }
  res.json({ sucesso: true, mensagem: 'Manutenção atualizada!' });
});

// ============================================================
// PROJETORES — Controle de manutenção
// ============================================================
// Projetores são ativos do tipo 'projetor' na tabela computadores; as
// manutenções ficam na tabela manutencoes (bem_id = computadores.id).
// Rotas top-level (/projetores) para não colidir com /ativos/:id e
// /ativos/:id/manutencoes, cuja ordem de registro no Express é relevante.

// Libera quem tem a permissão própria ou os módulos que já cobrem o inventário
function podeVerProjetores(req) {
  if (req.usuario.perfil === 'admin') return true;
  return (req.usuario.permissoes || []).some(p => ['projetores.ver', 'inventario.ver', 'ativos.ver'].includes(p));
}

// Lista todos os projetores com resumo do dashboard e ranking de despesa
router.get('/projetores', autenticar, operational, (req, res, next) => {
  if (!podeVerProjetores(req)) return res.status(403).json({ erro: 'Acesso negado.' });
  next();
},async  (req, res) => {
  const db = getDb();
  const isAdmin = req.usuario.perfil === 'admin';
  const unitFilter = isAdmin ? '' : ' AND c.unidade_id = ?';
  const unitParams = isAdmin ? [] : [req.usuario.unidade_id];
  const rows = (await db.prepare(`SELECT c.*, l.nome AS local_nome, l.tipo AS local_tipo,
      u.nome AS usuario_nome,
      (SELECT COUNT(*) FROM manutencoes m WHERE m.bem_id = c.id) AS total_manutencoes,
      (SELECT COUNT(*) FROM manutencoes m WHERE m.bem_id = c.id AND m.status != 'concluida') AS manutencoes_abertas,
      (SELECT SUM(m.custo) FROM manutencoes m WHERE m.bem_id = c.id) AS total_gasto
    FROM computadores c
    LEFT JOIN locais l ON l.id = c.local_id
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    WHERE c.tipo = 'projetor'${unitFilter} ORDER BY LOWER(c.patrimonio)`).all(...unitParams));
  const projetores = await Promise.all(rows.map(async p => {
    const ultima = (await db.prepare('SELECT * FROM manutencoes WHERE bem_id = ? ORDER BY criado_em DESC, id DESC LIMIT 1').get(p.id));
    return {
      ...p,
      total_manutencoes: p.total_manutencoes || 0,
      manutencoes_abertas: p.manutencoes_abertas || 0,
      total_gasto: p.total_gasto || 0,
      data_quebra: ultima?.criado_em || null,
      data_retorno: ultima && ultima.status === 'concluida' ? (ultima.data_realizada_em || ultima.atualizado_em) : null,
      valor_manutencao: ultima?.custo || 0,
      status_manutencao: ultima?.status || null,
      servico_nome: ultima?.nome_servico || null
    };
  }));
  const resumo = {
    total_projetores: projetores.length,
    em_manutencao: projetores.filter(p => p.manutencoes_abertas > 0).length,
    foram_para_conserto: projetores.filter(p => p.total_manutencoes > 0).length,
    total_manutencoes: projetores.reduce((s, p) => s + p.total_manutencoes, 0),
    total_gasto: projetores.reduce((s, p) => s + p.total_gasto, 0)
  };
  const ranking = projetores
    .filter(p => p.total_manutencoes > 0)
    .map(p => ({ id: p.id, patrimonio: p.patrimonio, modelo: p.modelo, fabricante: p.fabricante, local_nome: p.local_nome, total_manutencoes: p.total_manutencoes, total_gasto: p.total_gasto }))
    .sort((a, b) => b.total_gasto - a.total_gasto || b.total_manutencoes - a.total_manutencoes);
  res.json({ projetores, resumo, ranking });
});

// Retorna um projetor específico com o histórico completo de manutenções
router.get('/projetores/:id', autenticar, operational, (req, res, next) => {
  if (!podeVerProjetores(req)) return res.status(403).json({ erro: 'Acesso negado.' });
  next();
},async  (req, res) => {
  const db = getDb();
  const p = (await db.prepare("SELECT * FROM computadores WHERE id = ? AND tipo = 'projetor'").get(id(req.params.id)));
  if (!p) return res.status(404).json({ erro: 'Projetor não encontrado.' });
  if (!unitScope(req, p)) return res.status(403).json({ erro: 'Acesso negado.' });
  const manutencoes = (await db.prepare('SELECT * FROM manutencoes WHERE bem_id = ? ORDER BY criado_em DESC, id DESC').all(p.id))
    .map(m => ({ ...m, data_retorno: m.status === 'concluida' ? (m.data_realizada_em || m.atualizado_em) : null }));
  res.json({ ...(await enrichAsset(db, p)), manutencoes });
});

// ============================================================
// CHECKLISTS DE LABORATÓRIO
// ============================================================

// Retorna laboratórios disponíveis e, se informado um local, os itens para a conferência
router.get('/checklists-laboratorio/preparacao', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const isAdmin = req.usuario.perfil === 'admin';
  const laboratorios = (await db.prepare(`SELECT l.id, l.nome, l.tipo,
    (SELECT COUNT(*) FROM computadores c WHERE c.local_id = l.id AND c.status != 'Desativado' AND c.status != 'Baixado') +
    (SELECT COUNT(*) FROM dispositivos d WHERE d.local_id = l.id AND d.ativo = 1) +
    (SELECT COUNT(*) FROM impressoras i WHERE i.local_id = l.id AND i.ativo = 1) AS total_bens
    FROM locais l WHERE l.tipo = 'laboratorio' AND l.ativo = 1${isAdmin ? '' : ' AND l.unidade_id = ?'} ORDER BY LOWER(l.nome)`)
    .all(...(isAdmin ? [] : [req.usuario.unidade_id])));
  const localId = id(req.query.local_id);
  let itens = [];
  if (localId) {
    itens.push({ tipo: 'internet', chave: 'internet', bem_id: null, nome: 'Internet e rede do laboratório' });
    const bens = (await db.prepare(`SELECT c.*, l.nome AS local_nome FROM computadores c LEFT JOIN locais l ON l.id = c.local_id
      WHERE c.local_id = ? AND c.status != 'Desativado' AND c.status != 'Baixado' ORDER BY c.patrimonio`).all(localId));
    for (const bem of bens) {
      const descricao = [bem.modelo, bem.fabricante].filter(Boolean).join(' · ');
      itens.push({ tipo: 'bem', chave: `bem:${bem.id}`, bem_id: bem.id, nome: bem.patrimonio || descricao || `Bem #${bem.id}` });
    }
  }
  res.json({ laboratorios, itens });
});

// Lista os checklists de laboratório (com resultado e responsável) respeitando filtros
router.get('/checklists-laboratorio', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const isAdmin = req.usuario.perfil === 'admin';
  const condicoes = [];
  const params = [];
  if (!isAdmin) { condicoes.push('cl.unidade_id = ?'); params.push(req.usuario.unidade_id); }
  if (id(req.query.local_id)) { condicoes.push('cl.local_id = ?'); params.push(id(req.query.local_id)); }
  const limite = Math.min(200, Math.max(1, parseInt(req.query.limite, 10) || 50));
  const where = condicoes.length ? ' WHERE ' + condicoes.join(' AND ') : '';
  const rows = (await db.prepare(`SELECT cl.*, u.nome AS realizado_por_nome,
      (SELECT COUNT(*) FROM checklist_laboratorio_itens i WHERE i.checklist_id = cl.id AND i.estado = 'problema') AS total_problemas,
      (SELECT COUNT(*) FROM checklist_laboratorio_itens i WHERE i.checklist_id = cl.id AND i.estado = 'ausente') AS total_ausentes
    FROM checklists_laboratorio cl LEFT JOIN usuarios u ON u.id = cl.usuario_id${where}
    ORDER BY cl.criado_em DESC LIMIT ?`).all(...params, limite));
  for (const row of rows) {
    if (!row.local_nome_snapshot) {
      row.local_nome_snapshot = (await db.prepare('SELECT nome FROM locais WHERE id = ?').get(row.local_id))?.nome || 'Local removido';
    }
  }
  res.json(rows);
});

// Retorna um checklist específico com seus itens
router.get('/checklists-laboratorio/:id', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const cl = (await db.prepare('SELECT * FROM checklists_laboratorio WHERE id = ?').get(id(req.params.id)));
  if (!cl) return res.status(404).json({ erro: 'Checklist não encontrado.' });
  if (req.usuario.perfil !== 'admin' && Number(cl.unidade_id) !== Number(req.usuario.unidade_id)) {
    return res.status(403).json({ erro: 'Acesso negado.' });
  }
  const localNome = cl.local_nome_snapshot || (await db.prepare('SELECT nome FROM locais WHERE id = ?').get(cl.local_id))?.nome || 'Local removido';
  const usuario = (await db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(cl.usuario_id));
  const itens = (await db.prepare('SELECT * FROM checklist_laboratorio_itens WHERE checklist_id = ? ORDER BY id').all(cl.id))
    .map(i => ({ ...i, situacao: i.estado, observacao: i.observacoes, nome_snapshot: i.nome_snapshot || 'Item' }));
  res.json({ ...cl, local_nome_snapshot: localNome, realizado_por_nome: usuario?.nome || 'Usuário removido', itens });
});

// Cria um novo checklist com seus itens (salva snapshot dos nomes para exibição futura)
router.post('/checklists-laboratorio', autenticar, operational,async  (req, res) => {
  const unit = currentUnit(req, res); if (!unit) return;
  const db = getDb();
  const local = (await db.prepare('SELECT * FROM locais WHERE id = ?').get(id(req.body.local_id)));
  if (!local || !unitScope(req, local)) return res.status(400).json({ erro: 'Laboratório inválido.' });
  const localNomeSnapshot = local.nome;
  const result = (await db.prepare('INSERT INTO checklists_laboratorio (local_id, unidade_id, turno, observacoes, usuario_id, local_nome_snapshot, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    local.id, unit, req.body.turno || 'outro', String(req.body.observacoes || '').trim(), req.usuario.id, localNomeSnapshot, now()));
  const insert = db.prepare('INSERT INTO checklist_laboratorio_itens (checklist_id, estado, observacoes, tipo, chave, bem_id, nome_snapshot) VALUES (?, ?, ?, ?, ?, ?, ?)');
  let problemas = 0;
  for (const item of (req.body.itens || [])) {
    const situacao = item.situacao || item.estado || null;
    if (situacao === 'problema') problemas++;
    await insert.run(result.lastInsertRowid, situacao, item.observacao || item.observacoes || null, item.tipo || 'bem', item.chave || null, id(item.bem_id) || null, item.nome || null);
  }
  res.status(201).json({ sucesso: true, id: result.lastInsertRowid, problemas, mensagem: problemas ? `Checklist salvo com ${problemas} pendência${problemas === 1 ? '' : 's'}!` : 'Checklist salvo!' });
});

// ============================================================
// INDICADORES DE MANUTENÇÃO
// ============================================================

// Retorna indicadores de manutenção (resumo, série histórica, ativos recorrentes)
router.get('/ativos/indicadores-manutencao', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const meses = Math.max(1, parseInt(req.query.meses, 10) || 3);
  const dataLimite = new Date();
  dataLimite.setMonth(dataLimite.getMonth() - meses);
  const dataStr = dataLimite.toISOString();
  const isAdmin = req.usuario.perfil === 'admin';
  const unitFilter = isAdmin ? '' : ' AND c.unidade_id = ?';
  const unitParam = isAdmin ? [] : [req.usuario.unidade_id];

  const resumo = (await db.prepare(`SELECT
    SUM(CASE WHEN m.status = 'concluida' THEN 1 ELSE 0 END) AS concluidas,
    SUM(CASE WHEN m.status != 'concluida' THEN 1 ELSE 0 END) AS pendentes,
    SUM(m.custo) AS custo_total,
    AVG(m.custo) AS custo_medio
    FROM manutencoes m JOIN computadores c ON m.bem_id = c.id
    WHERE m.criado_em >= ?${unitFilter}`).get(dataStr, ...unitParam));

  const serieRows = (await db.prepare(`SELECT SUBSTRING(m.criado_em FROM 6 FOR 2) AS mes, SUBSTRING(m.criado_em FROM 1 FOR 4) AS ano, COUNT(*) AS total
    FROM manutencoes m JOIN computadores c ON m.bem_id = c.id
    WHERE m.status = 'concluida' AND m.criado_em >= ?${unitFilter}
    GROUP BY ano, mes ORDER BY ano, mes`).all(dataStr, ...unitParam));

  const mesesRotulo = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const serie = serieRows.map(r => ({ rotulo: `${mesesRotulo[parseInt(r.mes, 10) - 1]}/${r.ano.slice(2)}`, total: r.total }));

  const recorrentes = (await db.prepare(`SELECT c.id, c.patrimonio, c.tipo, c.fabricante, c.modelo, COUNT(*) AS total
    FROM manutencoes m JOIN computadores c ON m.bem_id = c.id
    WHERE m.criado_em >= ?${unitFilter}
    GROUP BY c.id ORDER BY total DESC LIMIT 10`).all(dataStr, ...unitParam));

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
router.get('/ativos/:id', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const asset = (await db.prepare('SELECT * FROM computadores WHERE id = ?').get(id(req.params.id)));
  if (!asset || !unitScope(req, asset)) return res.status(404).json({ erro: 'Ativo não encontrado.' });
  res.json(await enrichAsset(db, asset));
});

// Cria um novo ativo no banco com patrimônio gerado automaticamente se não informado
async function createAsset(req, res) {
  const unidadeId = currentUnit(req, res); if (!unidadeId) return;
  const db = getDb();
  const { patrimonio, modelo, ip, ip_endereco, usuario_id, local_id, setor_id, tipo, status,
    fabricante, num_serie, observacoes, processador, memoria_ram, armazenamento_tipo, armazenamento_tamanho, anydesk_id, teamviewer_id } = req.body;
  const patroFinal = patrimonio || gerarPatrimonio(db, unidadeId);
  const result = (await db.prepare(`INSERT INTO computadores (patrimonio, modelo, ip, ip_endereco, usuario_id, local_id, setor_id, unidade_id, tipo, status, fabricante, num_serie, observacoes, processador, memoria_ram, armazenamento_tipo, armazenamento_tamanho, anydesk_id, teamviewer_id, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    patroFinal, modelo || null, ip || null, ip_endereco || null, usuario_id || null, local_id || null, setor_id || null,
    unidadeId, tipo || 'gabinete', status || 'Ativo',
    fabricante || null, num_serie || null, observacoes || null, processador || null, memoria_ram || null,
    armazenamento_tipo || null, armazenamento_tamanho || null, anydesk_id || null, teamviewer_id || null, now(), now()));
  res.status(201).json({ sucesso: true, id: result.lastInsertRowid, patrimonio: patroFinal, mensagem: 'Ativo cadastrado!' });
}

// Atualiza campos de um ativo existente com validação de escopo por unidade
async function updateAsset(req, res) {
  const db = getDb();
  const asset = (await db.prepare('SELECT * FROM computadores WHERE id = ?').get(id(req.params.id)));
  if (!asset) return res.status(404).json({ erro: 'Ativo não encontrado.' });
  if (!unitScope(req, asset)) return res.status(403).json({ erro: 'Acesso negado.' });
  const cols = ['patrimonio','modelo','ip','ip_endereco','usuario_id','local_id','setor_id','tipo','status',
    'fabricante','num_serie','observacoes','processador','memoria_ram','armazenamento_tipo','armazenamento_tamanho','anydesk_id','teamviewer_id'];
  const sets = [], vals = [];
  for (const col of cols) {
    if (req.body[col] !== undefined) { sets.push(`${col} = ?`); vals.push(req.body[col] !== '' ? req.body[col] : null); }
  }
  if (sets.length) { sets.push('atualizado_em = ?'); vals.push(now()); vals.push(asset.id); (await db.prepare(`UPDATE computadores SET ${sets.join(', ')} WHERE id = ?`).run(...vals)); }
  res.json({ sucesso: true, mensagem: 'Ativo atualizado!' });
}

// Remove um ativo do banco com validação de escopo por unidade
async function deleteAsset(req, res) {
  const db = getDb();
  const asset = (await db.prepare('SELECT * FROM computadores WHERE id = ?').get(id(req.params.id)));
  if (!asset) return res.status(404).json({ erro: 'Ativo não encontrado.' });
  if (!unitScope(req, asset)) return res.status(403).json({ erro: 'Acesso negado.' });
  (await db.prepare('DELETE FROM computadores WHERE id = ?').run(asset.id));
  res.json({ sucesso: true, mensagem: 'Ativo removido!' });
}

module.exports = router;
