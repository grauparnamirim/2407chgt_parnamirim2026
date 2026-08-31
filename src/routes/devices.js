const { Router } = require('express');
const { getDb } = require('../db');
const { autenticar, operational, now, id, currentUnit, unitScope } = require('../middleware');

const router = Router();

// Lista todos os dispositivos com contagem de números associados
router.get('/dispositivos', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const rows = req.usuario.perfil === 'admin'
    ? (await db.prepare('SELECT * FROM dispositivos').all())
    : (await db.prepare('SELECT * FROM dispositivos WHERE unidade_id = ?').all(req.usuario.unidade_id));
  res.json(await Promise.all(rows.map(async d => ({
    ...d, total_numeros: (await db.prepare('SELECT COUNT(*) AS c FROM numeros_dispositivos WHERE dispositivo_id = ?').get(d.id)).c
  }))));
});

// Gera relatório simples de dispositivos com timestamp de geração
router.get('/dispositivos/relatorio', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const rows = req.usuario.perfil === 'admin'
    ? (await db.prepare('SELECT * FROM dispositivos').all())
    : (await db.prepare('SELECT * FROM dispositivos WHERE unidade_id = ?').all(req.usuario.unidade_id));
  res.json({ dispositivos: rows, gerado_em: now() });
});

// Cadastra um novo dispositivo
router.post('/dispositivos', autenticar, operational,async  (req, res) => {
  const unidadeId = currentUnit(req, res); if (!unidadeId) return;
  const db = getDb();
  const { nome, usuario_id, setor_id, local_id, fabricante, modelo, data_aquisicao, observacoes, status } = req.body;
  const result = (await db.prepare('INSERT INTO dispositivos (nome, usuario_id, setor_id, local_id, unidade_id, ativo, status, fabricante, modelo, data_aquisicao, observacoes, criado_em, atualizado_em) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?)').run(
    nome || null, usuario_id || null, setor_id || null, local_id || null, unidadeId,
    status || 'Ativo', fabricante || null, modelo || null, data_aquisicao || null, observacoes || null, now(), now()));
  res.status(201).json({ sucesso: true, id: result.lastInsertRowid, mensagem: 'Dispositivo cadastrado!' });
});

// Atualiza dados de um dispositivo com validação de escopo por unidade
router.put('/dispositivos/:id', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const item = (await db.prepare('SELECT * FROM dispositivos WHERE id = ?').get(id(req.params.id)));
  if (!item) return res.status(404).json({ erro: 'Dispositivo não encontrado.' });
  if (!unitScope(req, item)) return res.status(403).json({ erro: 'Acesso negado.' });
  const cols = ['nome','usuario_id','setor_id','local_id','fabricante','modelo','data_aquisicao','observacoes','status'];
  const sets = [], vals = [];
  for (const col of cols) {
    if (req.body[col] !== undefined) { sets.push(`${col} = ?`); vals.push(req.body[col] !== '' ? req.body[col] : null); }
  }
  if (sets.length) { sets.push('atualizado_em = ?'); vals.push(now()); vals.push(item.id); (await db.prepare(`UPDATE dispositivos SET ${sets.join(', ')} WHERE id = ?`).run(...vals)); }
  res.json({ sucesso: true, mensagem: 'Dispositivo atualizado!' });
});

// Remove um dispositivo e seus números associados
router.delete('/dispositivos/:id', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const item = (await db.prepare('SELECT * FROM dispositivos WHERE id = ?').get(id(req.params.id)));
  if (!item) return res.status(404).json({ erro: 'Dispositivo não encontrado.' });
  if (!unitScope(req, item)) return res.status(403).json({ erro: 'Acesso negado.' });
  (await db.prepare('DELETE FROM numeros_dispositivos WHERE dispositivo_id = ?').run(item.id));
  (await db.prepare('DELETE FROM dispositivos WHERE id = ?').run(item.id));
  res.json({ sucesso: true, mensagem: 'Dispositivo removido!' });
});

// Lista números telefônicos associados a um dispositivo
router.get('/dispositivos/:id/numeros', autenticar, operational,async  (req, res) => {
  res.json((await getDb().prepare('SELECT * FROM numeros_dispositivos WHERE dispositivo_id = ?').all(id(req.params.id))));
});

// Adiciona um número telefônico a um dispositivo
router.post('/dispositivos/:id/numeros', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const { numero, observacoes } = req.body;
  const result = (await db.prepare('INSERT INTO numeros_dispositivos (dispositivo_id, numero, observacoes, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)').run(
    id(req.params.id), numero || null, observacoes || null, now(), now()));
  res.status(201).json({ sucesso: true, id: result.lastInsertRowid, mensagem: 'Número adicionado!' });
});

// Atualiza um número telefônico específico
router.put('/dispositivos/:id/numeros/:numeroId', autenticar, operational,async  (req, res) => {
  const db = getDb();
  const n = (await db.prepare('SELECT * FROM numeros_dispositivos WHERE id = ?').get(id(req.params.numeroId)));
  if (!n || Number(n.dispositivo_id) !== id(req.params.id)) return res.status(404).json({ erro: 'Número não encontrado.' });
  const sets = [], vals = [];
  if (req.body.numero !== undefined) { sets.push('numero = ?'); vals.push(req.body.numero); }
  if (req.body.observacoes !== undefined) { sets.push('observacoes = ?'); vals.push(req.body.observacoes); }
  if (sets.length) { sets.push('atualizado_em = ?'); vals.push(now()); vals.push(n.id); (await db.prepare(`UPDATE numeros_dispositivos SET ${sets.join(', ')} WHERE id = ?`).run(...vals)); }
  res.json({ sucesso: true, mensagem: 'Número atualizado!' });
});

// Remove um número telefônico de um dispositivo
router.delete('/dispositivos/:id/numeros/:numeroId', autenticar, operational,async  (req, res) => {
  (await getDb().prepare('DELETE FROM numeros_dispositivos WHERE id = ?').run(id(req.params.numeroId)));
  res.json({ sucesso: true, mensagem: 'Número removido!' });
});

module.exports = router;
