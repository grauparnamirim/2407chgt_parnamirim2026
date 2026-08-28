const { Router } = require('express');
const { getDb } = require('../db');
const { autenticar, operational, now, id, currentUnit, unitScope } = require('../middleware');

// ============================================================
// IMPORTS E CONFIGURAÇÃO
// ============================================================

const router = Router();

// Lista todas as impressoras com dados enriquecidos
router.get('/impressoras', autenticar, operational, (req, res) => {
  const db = getDb();
  const rows = req.usuario.perfil === 'admin'
    ? db.prepare('SELECT * FROM impressoras').all()
    : db.prepare('SELECT * FROM impressoras WHERE unidade_id = ?').all(req.usuario.unidade_id);
  res.json(rows.map(r => enrichPrintData(db, r)));
});

// Cadastra uma nova impressora
router.post('/impressoras', autenticar, operational, (req, res) => {
  const unit = currentUnit(req, res); if (!unit) return;
  const db = getDb();
  const { nome, mac, ip, ip_endereco, tipo, usuario_id, setor_id, local_id, contagem_atual, fabricante, modelo, num_serie, observacoes } = req.body;
  const result = db.prepare(`INSERT INTO impressoras (nome, mac, ip_endereco, tipo, usuario_id, setor_id, local_id, unidade_id, ativo, contagem_atual, fabricante, modelo, num_serie, observacoes, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`).run(
    nome || null, mac || null, (ip_endereco || ip) || null, tipo || null, usuario_id || null, setor_id || null, local_id || null, unit, Number(contagem_atual || 0),
    fabricante || null, modelo || null, num_serie || null, observacoes || null, now(), now());
  res.status(201).json({ sucesso: true, id: result.lastInsertRowid, mensagem: 'Impressora cadastrada!' });
});

// Atualiza dados de uma impressora
router.put('/impressoras/:id', autenticar, operational, (req, res) => {
  const db = getDb();
  const item = db.prepare('SELECT * FROM impressoras WHERE id = ?').get(id(req.params.id));
  if (!item) return res.status(404).json({ erro: 'Impressora não encontrada.' });
  if (req.body.ip !== undefined && req.body.ip_endereco === undefined) req.body.ip_endereco = req.body.ip;
  const cols = ['nome','mac','ip_endereco','tipo','usuario_id','setor_id','local_id','contagem_atual','fabricante','modelo','num_serie','observacoes'];
  const sets = [], vals = [];
  for (const col of cols) {
    if (req.body[col] !== undefined) { sets.push(`${col} = ?`); vals.push(col === 'contagem_atual' ? Number(req.body[col]) : (req.body[col] !== '' ? req.body[col] : null)); }
  }
  if (sets.length) { sets.push('atualizado_em = ?'); vals.push(now()); vals.push(item.id); db.prepare(`UPDATE impressoras SET ${sets.join(', ')} WHERE id = ?`).run(...vals); }
  res.json({ sucesso: true, mensagem: 'Impressora atualizada!' });
});

// Remove uma impressora
router.delete('/impressoras/:id', autenticar, operational, (req, res) => {
  getDb().prepare('DELETE FROM impressoras WHERE id = ?').run(id(req.params.id));
  res.json({ sucesso: true, mensagem: 'Impressora removida!' });
});

// Ativa ou desativa uma impressora
router.put('/impressoras/:id/status', autenticar, operational, (req, res) => {
  getDb().prepare('UPDATE impressoras SET ativo = ? WHERE id = ?').run(req.body.ativo ? 1 : 0, id(req.params.id));
  res.json({ sucesso: true, mensagem: 'Status atualizado!' });
});

// Lista leituras mensais de contagem de impressão
router.get('/leituras', autenticar, operational, (req, res) => {
  const db = getDb();
  const rows = req.usuario.perfil === 'admin'
    ? db.prepare('SELECT l.*, i.tipo, i.mac, i.ip_endereco AS ip, i.nome AS impressora_nome, s.nome AS setor_nome FROM leituras_mensais l JOIN impressoras i ON l.impressora_id = i.id LEFT JOIN setores s ON i.setor_id = s.id').all()
    : db.prepare('SELECT l.*, i.tipo, i.mac, i.ip_endereco AS ip, i.nome AS impressora_nome, s.nome AS setor_nome FROM leituras_mensais l JOIN impressoras i ON l.impressora_id = i.id LEFT JOIN setores s ON i.setor_id = s.id WHERE i.unidade_id = ?').all(req.usuario.unidade_id);
  res.json(rows);
});

// Registra uma nova leitura mensal de contagem
router.post('/leituras', autenticar, operational, (req, res) => {
  const db = getDb();
  const { impressora_id, contagem, observacoes } = req.body;
  const result = db.prepare('INSERT INTO leituras_mensais (impressora_id, criado_por, contagem, observacoes, criado_em) VALUES (?, ?, ?, ?, ?)').run(
    impressora_id || null, req.usuario.id, Number(contagem || 0), observacoes || null, now());
  res.status(201).json({ sucesso: true, id: result.lastInsertRowid, mensagem: 'Leitura registrada!' });
});

// Retorna todos os parâmetros de impressão
router.get('/parametros-impressao', autenticar, operational, (req, res) => {
  const rows = getDb().prepare('SELECT * FROM parametros_impressao').all();
  const params = {};
  rows.forEach(r => { params[r.chave] = r.valor; });
  res.json(params);
});

// Substitui todos os parâmetros de impressão (deleta e reinsere)
router.put('/parametros-impressao', autenticar, operational, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM parametros_impressao').run();
  const insert = db.prepare('INSERT INTO parametros_impressao (chave, valor) VALUES (?, ?)');
  Object.entries(req.body || {}).forEach(([chave, valor], index) => insert.run(chave, valor));
  res.json({ sucesso: true, mensagem: 'Parâmetros atualizados!' });
});

// Retorna relatório mensal de impressão
router.get('/relatorios/impressao/mensal', autenticar, operational, (req, res) => {
  const db = getDb();
  const mes = Number(req.query.mes);
  const ano = Number(req.query.ano);
  const paramsRows = db.prepare('SELECT * FROM parametros_impressao').all();
  const parametros = {};
  paramsRows.forEach(r => { parametros[r.chave] = Number(r.valor); });

  const leituras = db.prepare(`
    SELECT l.*, i.tipo FROM leituras_mensais l
    JOIN impressoras i ON l.impressora_id = i.id
  `).all();

  let total_tonner = 0, total_colorida = 0;
  for (const l of leituras) {
    const delta = Math.max(0, Number(l.contagem || 0));
    if (l.tipo === 'COLORIDA') total_colorida += delta;
    else total_tonner += delta;
  }

  const franquia_tonner = parametros.franquia_tonner || 9000;
  const franquia_colorida = parametros.franquia_colorida || 1000;
  const excedente_tonner = Math.max(0, total_tonner - franquia_tonner);
  const excedente_colorida = Math.max(0, total_colorida - franquia_colorida);
  const valor_excedente_tonner = parametros.valor_excedente_tonner || 0.24;
  const valor_excedente_colorida = parametros.valor_excedente_colorida || 0.05;
  const total_excedente_reais = (excedente_tonner * valor_excedente_tonner) + (excedente_colorida * valor_excedente_colorida);
  const mensalidade = (parametros.valor_fixo_base || 840) + total_excedente_reais;

  res.json({ parametros, total_tonner, total_colorida, excedente_tonner, excedente_colorida, total_excedente_reais, mensalidade });
});

// Enriquece dados da impressora com nomes relacionados (usuário, setor, local)
function enrichPrintData(db, p) {
  return {
    ...p, ip: p.ip_endereco || '',
    usuario_nome: db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(p.usuario_id)?.nome || '',
    setor_nome: db.prepare('SELECT nome FROM setores WHERE id = ?').get(p.setor_id)?.nome || '',
    local_nome: db.prepare('SELECT nome FROM locais WHERE id = ?').get(p.local_id)?.nome || ''
  };
}

module.exports = router;
