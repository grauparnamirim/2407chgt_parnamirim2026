const { Router } = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { getDb, getConfig, setConfig } = require('../db');
const { JWT_SECRET, JWT_EXPIRES, now, id, validId, safeUser, userPermissions, autenticar, admin } = require('../middleware');
const rateLimit = require('express-rate-limit');

// ============================================================
// IMPORTS E CONFIGURAÇÃO
// ============================================================

// Limitador de taxa de login: 20 tentativas a cada 15 minutos
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Tente novamente mais tarde.' }
});

const router = Router();

// Retorna lista de unidades ativas para o formulário de login
// Inclui a unidade fixa do servidor (intranet local), se definida pelo admin
router.get('/unidades', (_, res) => {
  const unidades = getDb().prepare('SELECT * FROM unidades WHERE ativo != 0').all();
  const unidadeFixa = getConfig('unidade_fixa');
  res.json({ unidades, unidade_fixa: unidadeFixa ? id(unidadeFixa) : null });
});

// Retorna a unidade fixa do servidor (pública — usada pelo formulário de login)
router.get('/config/unidade-fixa', (_, res) => {
  const unidadeFixa = getConfig('unidade_fixa');
  res.json({ unidade_fixa: unidadeFixa ? id(unidadeFixa) : null });
});

// Define (ou remove, com null) a unidade fixa do servidor — somente admin
router.put('/config/unidade-fixa', autenticar, admin, (req, res) => {
  const valor = req.body.unidade_id === null || req.body.unidade_id === undefined || req.body.unidade_id === ''
    ? null
    : id(req.body.unidade_id);
  if (valor !== null) {
    const unidade = getDb().prepare('SELECT id FROM unidades WHERE id = ? AND ativo != 0').get(valor);
    if (!unidade) return res.status(400).json({ erro: 'Unidade inválida ou inativa.' });
  }
  setConfig('unidade_fixa', valor);
  res.json({ sucesso: true, mensagem: valor ? 'Unidade fixa definida!' : 'Unidade fixa removida.' });
});

// Limpa o cookie de autenticação e encerra a sessão
router.post('/logout', (_, res) => {
  res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });
  res.json({ sucesso: true });
});

// Autentica o usuário: valida email, senha, unidade e gera token JWT
router.post('/login', loginLimiter, async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const senha = String(req.body.senha || '');
  const unidadeId = id(req.body.unidade_id);
  if (!email || !senha || !validId(unidadeId)) return res.status(400).json({ erro: 'Email, senha e unidade são obrigatórios.' });
  const db = getDb();
  const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
  const unidade = db.prepare('SELECT * FROM unidades WHERE id = ?').get(unidadeId);
  if (!user || !user.ativo || !unidade || unidade.ativo === 0) return res.status(401).json({ erro: 'Email ou senha inválidos.' });
  if (user.perfil !== 'admin' && Number(user.unidade_id) !== unidadeId) return res.status(403).json({ erro: 'Esta conta não pertence à unidade selecionada.' });
  if (!(await bcrypt.compare(senha, user.senha_hash))) return res.status(401).json({ erro: 'Email ou senha inválidos.' });
  const permissoes = userPermissions(db, user);
  const usuario = { ...safeUser(user), unidade_id: unidadeId, permissoes };
  const token = jwt.sign({ id: user.id, unidade_id: unidadeId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.cookie('token', token, { httpOnly: true, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 });
  res.json({ sucesso: true, token, usuario });
});

module.exports = router;
