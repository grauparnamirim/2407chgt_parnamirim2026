const { Router } = require('express');
const bcrypt = require('bcrypt');
const { getDb } = require('../db');
const { autenticar, admin, operational, now, id, validId, safeUser, currentUnit, unitScope } = require('../middleware');

// ============================================================
// IMPORTS E CONFIGURAÇÃO
// ============================================================

const router = Router();

// Lista todos os usuários (filtrados por unidade quando aplicável),
// incluindo o nome do setor vinculado
router.get('/usuarios', autenticar, admin, (req, res) => {
  const db = getDb();
  const select = `SELECT u.*, s.nome AS setor_nome FROM usuarios u LEFT JOIN setores s ON u.setor_id = s.id`;
  let rows;
  if (req.usuario.perfil === 'admin' && !req.usuario.unidade_id) {
    rows = db.prepare(select).all();
  } else {
    rows = db.prepare(`${select} WHERE u.unidade_id = ? OR u.unidade_id IS NULL`).all(req.usuario.unidade_id);
  }
  res.json(rows.map(safeUser));
});

// Lista usuários com perfil técnico disponíveis
router.get('/tecnicos', autenticar, operational, (req, res) => {
  const db = getDb();
  const rows = req.usuario.perfil === 'admin'
    ? db.prepare("SELECT id, nome, email FROM usuarios WHERE perfil = 'tecnico' AND ativo = 1").all()
    : db.prepare("SELECT id, nome, email FROM usuarios WHERE perfil = 'tecnico' AND ativo = 1 AND unidade_id = ?").all(req.usuario.unidade_id);
  res.json(rows);
});

// Cadastra um novo usuário (admin apenas, senha mínima de 8 caracteres)
router.post('/usuarios', autenticar, admin, async (req, res) => {
  const nome = String(req.body.nome || '').trim(), email = String(req.body.email || '').trim().toLowerCase(), senha = String(req.body.senha || ''), perfil = String(req.body.perfil || '').trim();
  const unidadeId = currentUnit(req, res);
  if (!unidadeId) return;
  if (!nome || !email || senha.length < 8 || !['admin', 'gestor', 'tecnico', 'usuario'].includes(perfil)) return res.status(400).json({ erro: 'Informe nome, email, senha com ao menos 8 caracteres e perfil válido.' });
  const db = getDb();
  const exists = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(email);
  if (exists) return res.status(400).json({ erro: 'Email já cadastrado.' });
  const senha_hash = await bcrypt.hash(senha, 10);
  const result = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, perfil, setor_id, unidade_id, ativo, criado_em) VALUES (?, ?, ?, ?, ?, ?, 1, ?)').run(nome, email, senha_hash, perfil, validId(req.body.setor) ? id(req.body.setor) : null, unidadeId, now());
  res.status(201).json({ sucesso: true, id: result.lastInsertRowid, mensagem: 'Usuário cadastrado com sucesso!' });
});

// Atualiza dados de um usuário (admin apenas, não altera conta admin)
router.put('/usuarios/:id', autenticar, admin, async (req, res) => {
  const db = getDb();
  const target = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id(req.params.id));
  if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (target.perfil === 'admin') return res.status(403).json({ erro: 'A conta demonstrativa administrativa não pode ser alterada por esta rota.' });
  const sets = [], vals = [];
  if (req.body.nome !== undefined) { sets.push('nome = ?'); vals.push(String(req.body.nome).trim()); }
  if (req.body.email !== undefined) { sets.push('email = ?'); vals.push(String(req.body.email).trim().toLowerCase()); }
  if (req.body.setor !== undefined) { sets.push('setor_id = ?'); vals.push(validId(req.body.setor) ? id(req.body.setor) : null); }
  if (req.body.perfil !== undefined) {
    if (!['admin', 'gestor', 'tecnico', 'usuario'].includes(req.body.perfil)) return res.status(400).json({ erro: 'Perfil inválido.' });
    sets.push('perfil = ?'); vals.push(req.body.perfil);
  }
  if (req.body.senha) { sets.push('senha_hash = ?'); vals.push(await bcrypt.hash(String(req.body.senha), 10)); }
  if (sets.length) { sets.push('atualizado_em = ?'); vals.push(now()); vals.push(id(req.params.id)); db.prepare(`UPDATE usuarios SET ${sets.join(', ')} WHERE id = ?`).run(...vals); }
  res.json({ sucesso: true, mensagem: 'Usuário atualizado!' });
});

// Ativa ou desativa um usuário (admin apenas, não inativa conta admin)
router.put('/usuarios/:id/ativo', autenticar, admin, (req, res) => {
  const db = getDb();
  const target = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id(req.params.id));
  if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (target.perfil === 'admin') return res.status(403).json({ erro: 'A conta demonstrativa administrativa não pode ser inativada.' });
  db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(req.body.ativo ? 1 : 0, id(req.params.id));
  res.json({ sucesso: true, mensagem: 'Status do usuário atualizado.' });
});

// Exclui um usuário (admin apenas, não exclui conta admin)
router.delete('/usuarios/:id', autenticar, admin, (req, res) => {
  const db = getDb();
  const target = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id(req.params.id));
  if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (target.perfil === 'admin') return res.status(403).json({ erro: 'A conta demonstrativa administrativa não pode ser excluída.' });
  db.prepare('DELETE FROM usuarios_grupos WHERE usuario_id = ?').run(id(req.params.id));
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id(req.params.id));
  res.json({ sucesso: true, mensagem: 'Usuário excluído!' });
});

module.exports = router;
