const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDb } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

const now = () => new Date().toISOString();
const id = value => Number.parseInt(value, 10);
const validId = value => Number.isInteger(id(value)) && id(value) > 0;

// ============================================================
// Segurança: validação de entrada
// ============================================================

// Whitelist de tabelas permitidas — qualquer nome de tabela usado em SQL dinâmico deve estar aqui
const ALLOWED_TABLES = new Set([
  'unidades', 'usuarios', 'categorias', 'subcategorias', 'fornecedores', 'locais', 'setores',
  'chamados', 'comentarios', 'notificacoes_log',
  'computadores', 'movimentacoes_bens', 'manutencoes', 'categorias_servico_manutencao', 'subcategorias_servico_manutencao',
  'checklists_laboratorio', 'checklist_laboratorio_itens',
  'dispositivos', 'numeros_dispositivos',
  'custos_chamado', 'orcamentos_chamado', 'compras_mensais',
  'impressoras', 'leituras_mensais', 'parametros_impressao',
  'notas_fiscais', 'nf_comparativo_mensal',
  'permissoes', 'grupos', 'grupos_permissoes', 'usuarios_grupos'
]);

// Verifica se o nome da tabela está na whitelist
function validTable(name) {
  if (!ALLOWED_TABLES.has(name)) throw new Error(`Tabela não permitida: ${name}`);
  return name;
}

// Verifica se os nomes das colunas estão na whitelist
// Valida que colunas fornecidas estão na whitelist — previne SQL injection via nomes de coluna
function validColumns(cols, allowed) {
  for (const col of cols) {
    if (!allowed.includes(col)) throw new Error(`Coluna não permitida: ${col}`);
  }
  return cols;
}

// Remove o hash da senha antes de expor os dados do usuário
function safeUser(user) {
  const { senha_hash, ...safe } = user;   // tira o senha_hash do objeto
  return safe;                            // devolve o resto sem o hash
}

// Permissões padrão por perfil quando o usuário não está vinculado a nenhum grupo.
// Garante que perfis operacionais continuem funcionando mesmo sem grupos configurados.
const PERMISSOES_PADRAO_PERFIL = {
  tecnico: [
    'chamados.ver_atribuidos', 'chamados.ver_todos_unidade', 'chamados.alterar_status',
    'chamados.ver_proprios', 'categorias.ver', 'projetores.ver'
  ],
  gestor: [
    'chamados.ver_atribuidos', 'chamados.ver_todos_unidade', 'chamados.alterar_status',
    'chamados.ver_proprios', 'categorias.ver', 'setores.ver',
    'relatorios.ver_dashboard', 'relatorios.ver_tempos', 'projetores.ver'
  ],
  usuario: ['chamados.ver_proprios']
};

// Permissões básicas de usuário comum — não habilitam acesso operacional
const PERMISSOES_USUARIO_BASICAS = new Set([
  'chamados.abrir', 'chamados.ver_proprios', 'chamados.reabrir',
  'chamados.comentar', 'notificacoes.receber'
]);

// Retorna a lista de permissões do usuário (admins têm todas).
// As permissões padrão do perfil são somadas às do grupo: entrar em um grupo
// NÃO revoga as capacidades básicas do perfil (ex.: técnico continua vendo
// os próprios chamados e alterando status mesmo sem a permissão no grupo).
async function userPermissions(db, user) {
  if (user.perfil === 'admin') return ['*'];
  const base = PERMISSOES_PADRAO_PERFIL[user.perfil] || [];
  const groupIds = (await db.prepare('SELECT grupo_id FROM usuarios_grupos WHERE usuario_id = ?').all(user.id)).map(r => r.grupo_id);
  if (!groupIds.length) return base;
  const permIds = (await db.prepare(`SELECT permissao_id FROM grupos_permissoes WHERE grupo_id IN (${groupIds.map(() => '?').join(',')})`).all(...groupIds)).map(r => r.permissao_id);
  if (!permIds.length) return base;
  const grupoPerms = (await db.prepare(`SELECT chave FROM permissoes WHERE id IN (${permIds.map(() => '?').join(',')})`).all(...permIds)).map(r => r.chave);
  return [...new Set([...base, ...grupoPerms])];
}

// Verifica se o usuário tem capacidade operacional: perfis operacionais
// (admin/gestor/tecnico) OU permissões concedidas via grupo além das básicas
// de usuário. Espelha temPermissoesAvancadas() do frontend.
function temCapacidadeOperacional(req) {
  if (['admin', 'gestor', 'tecnico'].includes(req.usuario.perfil)) return true;
  return (req.usuario.permissoes || []).some(p => !PERMISSOES_USUARIO_BASICAS.has(p));
}

// Middleware de autenticação via JWT — valida token e carrega usuário
async function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ erro: 'Token de acesso não fornecido.' });
  try {
    const token = jwt.verify(header.slice(7), JWT_SECRET);
    const db = getDb();
    const current = (await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(token.id));
    if (!current || !current.ativo) return res.status(401).json({ erro: 'Este usuário está inativo.' });
    let unidade = null;
    if (token.unidade_id) unidade = (await db.prepare('SELECT * FROM unidades WHERE id = ?').get(token.unidade_id));
    if (token.unidade_id && !unidade) return res.status(401).json({ erro: 'Unidade de acesso inválida.' });
    req.usuario = { ...safeUser(current), unidade_id: token.unidade_id || null, permissoes: await userPermissions(db, current) };
    next();
  } catch (_) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

// Middleware que exige permissões específicas (admins passam automaticamente)
function requirePermission(...permissions) {
  return (req, res, next) => {
    if (req.usuario.perfil === 'admin' || permissions.every(p => req.usuario.permissoes.includes(p))) return next();
    return res.status(403).json({ erro: 'Acesso negado.' });
  };
}

// Middleware que restringe acesso a perfis específicos
function requireRole(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.usuario.perfil)) return next();
    return res.status(403).json({ erro: 'Acesso negado.' });
  };
}

const admin = requireRole('admin');
const operational = (req, res, next) => temCapacidadeOperacional(req) ? next() : res.status(403).json({ erro: 'Acesso negado.' });

// Verifica se o item pertence à unidade do usuário (admins veem tudo)
function unitScope(req, item) {
  return req.usuario.perfil === 'admin' || Number(item.unidade_id) === Number(req.usuario.unidade_id);
}

// Obtém a unidade ativa do usuário ou retorna erro se não selecionada
function currentUnit(req, res) {
  if (!req.usuario.unidade_id) {
    res.status(400).json({ erro: 'Selecione uma unidade para esta operação.' });
    return null;
  }
  return Number(req.usuario.unidade_id);
}

// Verifica se o usuário tem permissão para acessar o chamado
function ticketAllowed(req, ticket) {
  if (!ticket) return false;
  if (req.usuario.perfil === 'admin') return true;
  if (req.usuario.perfil === 'usuario') return Number(ticket.usuario_id) === Number(req.usuario.id);
  return (req.usuario.perfil === 'admin' || Number(ticket.unidade_id) === Number(req.usuario.unidade_id)) && (req.usuario.perfil === 'gestor' || Number(ticket.tecnico_id) === Number(req.usuario.id));
}

// Middleware de sanitização — limita tamanho de strings e remove caracteres perigosos
// Faz o parsing manual do header Cookie em um objeto
// Parsing simples de cookies sem dependência externa
function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > 0) cookies[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return cookies;
}

// Middleware que protege páginas HTML — redireciona ao login se o cookie JWT for inválido
// Middleware para proteger páginas HTML — redireciona ao login se o cookie JWT for inválido
async function autenticarPagina(req, res, next) {
  const token = parseCookies(req.headers.cookie).token;
  if (!token) return res.redirect('/');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDb();
    const user = (await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(decoded.id));
    if (!user || !user.ativo) return res.redirect('/');
    req.usuario = { ...safeUser(user), unidade_id: decoded.unidade_id || null };
    next();
  } catch (_) {
    return res.redirect('/');
  }
}

// Remove caracteres perigosos e valida tamanho dos campos da requisição
function sanitizeInput(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    for (const [k, v] of Object.entries(req.body)) {
      if (typeof v === 'string') {
        if (v.length > 10000) return res.status(400).json({ erro: `Campo '${k}' excede o limite de 10000 caracteres.` });
        if (k.toLowerCase().includes('senha')) continue;
        req.body[k] = v.replace(/[<>]/g, '');
      }
      if (typeof v === 'number' && (!Number.isFinite(v) || Number.isNaN(v))) {
        return res.status(400).json({ erro: `Campo '${k}' contém valor numérico inválido.` });
      }
    }
  }
  next();
}

module.exports = {
  JWT_SECRET, JWT_EXPIRES, now, id, validId, safeUser, userPermissions,
  autenticar, autenticarPagina, requirePermission, requireRole, admin, operational, unitScope, currentUnit, ticketAllowed,
  validTable, validColumns, sanitizeInput
};
