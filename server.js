// CHGT HelpDesk — execução local com persistência JSON (sem MySQL)
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const JsonStore = require('./json-store');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(48).toString('hex');
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';
const dataDir = path.join(__dirname, 'data');
const store = new JsonStore({
  templatePath: path.join(dataDir, 'template.json'),
  dataPath: process.env.JSON_DATA_PATH || path.join(dataDir, 'local.json')
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

for (const page of ['painel', 'impressoras', 'fornecedores', 'dispositivos', 'usuario', 'setores', 'categorias', 'financeiro', 'relatorios', 'inventario', 'usuarios', 'notas-fiscais']) {
  app.get(`/${page}`, (_, res) => res.sendFile(path.join(__dirname, 'public', `${page}.html`)));
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas tentativas de login. Tente novamente mais tarde.' }
});

const now = () => new Date().toISOString();
const id = value => Number.parseInt(value, 10);
const validId = value => Number.isInteger(id(value)) && id(value) > 0;
const find = (data, key, value) => (data[key] || []).find(item => Number(item.id) === Number(value));
const remove = (data, key, value) => {
  const index = (data[key] || []).findIndex(item => Number(item.id) === Number(value));
  if (index < 0) return null;
  return data[key].splice(index, 1)[0];
};
const add = (data, key, value) => {
  const item = { id: store.nextId(data, key), ...value, criado_em: value.criado_em || now(), atualizado_em: now() };
  data[key].push(item);
  return item;
};
const update = (data, key, value, patch) => {
  const item = find(data, key, value);
  if (!item) return null;
  Object.assign(item, patch, { atualizado_em: now() });
  return item;
};
const safeUser = user => {
  const { senha_hash, ...safe } = user;
  return safe;
};
const text = value => String(value || '').trim();

function userPermissions(data, user) {
  if (user.perfil === 'admin') return ['*'];
  const groupIds = (data.usuarios_grupos || []).filter(x => Number(x.usuario_id) === Number(user.id)).map(x => Number(x.grupo_id));
  const permissionIds = (data.grupos_permissoes || []).filter(x => groupIds.includes(Number(x.grupo_id))).map(x => Number(x.permissao_id));
  return (data.permissoes || []).filter(x => permissionIds.includes(Number(x.id))).map(x => x.chave);
}

async function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ erro: 'Token de acesso não fornecido.' });
  try {
    const token = jwt.verify(header.slice(7), JWT_SECRET);
    const current = store.read(data => find(data, 'usuarios', token.id));
    if (!current || !current.ativo) return res.status(401).json({ erro: 'Este usuário está inativo.' });
    const unidade = token.unidade_id ? store.read(data => find(data, 'unidades', token.unidade_id)) : null;
    if (token.unidade_id && !unidade) return res.status(401).json({ erro: 'Unidade de acesso inválida.' });
    req.usuario = { ...safeUser(current), unidade_id: token.unidade_id || null, permissoes: store.read(data => userPermissions(data, current)) };
    next();
  } catch (_) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

function requirePermission(...permissions) {
  return (req, res, next) => {
    if (req.usuario.perfil === 'admin' || permissions.every(p => req.usuario.permissoes.includes(p))) return next();
    return res.status(403).json({ erro: 'Acesso negado.' });
  };
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (roles.includes(req.usuario.perfil)) return next();
    return res.status(403).json({ erro: 'Acesso negado.' });
  };
}
const admin = requireRole('admin');
const operational = requireRole('admin', 'gestor', 'tecnico');

function unitScope(req, item) {
  return req.usuario.perfil === 'admin' || Number(item.unidade_id) === Number(req.usuario.unidade_id);
}
function ticketAllowed(req, ticket) {
  if (!ticket) return false;
  if (req.usuario.perfil === 'admin') return true;
  if (req.usuario.perfil === 'usuario') return Number(ticket.usuario_id) === Number(req.usuario.id);
  return unitScope(req, ticket) && (req.usuario.perfil === 'gestor' || Number(ticket.tecnico_id) === Number(req.usuario.id));
}
function requireTicket(req, res, next) {
  const ticket = store.read(data => find(data, 'chamados', req.params.id));
  if (!ticket) return res.status(404).json({ erro: 'Chamado não encontrado.' });
  if (!ticketAllowed(req, ticket)) return res.status(403).json({ erro: 'Acesso negado a este chamado.' });
  req.chamado = ticket;
  next();
}
function currentUnit(req, res) {
  if (!req.usuario.unidade_id) {
    res.status(400).json({ erro: 'Selecione uma unidade para esta operação.' });
    return null;
  }
  return Number(req.usuario.unidade_id);
}
function enrich(data, item, key) {
  if (!item) return null;
  const value = { ...item };
  if (key === 'chamados') {
    value.usuario_nome = find(data, 'usuarios', item.usuario_id)?.nome || '';
    value.tecnico_nome = find(data, 'usuarios', item.tecnico_id)?.nome || '';
    value.fornecedor_nome = find(data, 'fornecedores', item.fornecedor_id)?.nome || '';
    value.local_nome = find(data, 'locais', item.local_id)?.nome || '';
    value.tempo_espera_ms = 0;
  }
  if (['computadores', 'impressoras', 'dispositivos'].includes(key)) {
    value.usuario_nome = find(data, 'usuarios', item.usuario_id)?.nome || '';
    value.setor_nome = find(data, 'setores', item.setor_id)?.nome || '';
    value.local_nome = find(data, 'locais', item.local_id)?.nome || '';
  }
  if (key === 'leituras_mensais') value.impressora_nome = find(data, 'impressoras', item.impressora_id)?.nome || '';
  if (key === 'notas_fiscais') {
    value.fornecedor_nome = find(data, 'fornecedores', item.fornecedor_id)?.nome || '';
    value.chamado_titulo = find(data, 'chamados', item.chamado_id)?.titulo || '';
  }
  return value;
}
function scopedList(req, key) {
  return store.read(data => (data[key] || []).filter(item => !item.unidade_id || unitScope(req, item)).map(item => enrich(data, item, key)));
}
function validateName(req, res) {
  const nome = text(req.body.nome);
  if (!nome) { res.status(400).json({ erro: 'Nome é obrigatório.' }); return null; }
  return nome;
}

app.get('/api/unidades', (_, res) => res.json(store.read(data => data.unidades.filter(u => u.ativo !== 0))));
app.post('/api/login', loginLimiter, async (req, res) => {
  const email = text(req.body.email).toLowerCase();
  const senha = String(req.body.senha || '');
  const unidadeId = id(req.body.unidade_id);
  if (!email || !senha || !validId(unidadeId)) return res.status(400).json({ erro: 'Email, senha e unidade são obrigatórios.' });
  const result = store.read(data => ({ user: data.usuarios.find(u => u.email.toLowerCase() === email), unidade: find(data, 'unidades', unidadeId) }));
  if (!result.user || !result.user.ativo || !result.unidade || result.unidade.ativo === 0) return res.status(401).json({ erro: 'Email ou senha inválidos.' });
  if (result.user.perfil !== 'admin' && Number(result.user.unidade_id) !== unidadeId) return res.status(403).json({ erro: 'Esta conta não pertence à unidade selecionada.' });
  if (!(await bcrypt.compare(senha, result.user.senha_hash))) return res.status(401).json({ erro: 'Email ou senha inválidos.' });
  const permissoes = store.read(data => userPermissions(data, result.user));
  const usuario = { ...safeUser(result.user), unidade_id: unidadeId, permissoes };
  const token = jwt.sign({ id: result.user.id, unidade_id: unidadeId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ sucesso: true, token, usuario });
});

app.get('/api/pesquisa', autenticar, (req, res) => {
  const q = text(req.query.q).toLowerCase();
  if (q.length < 2) return res.json({ chamados: [], ativos: [] });
  const result = store.read(data => ({
    chamados: data.chamados.filter(c => ticketAllowed(req, c) && `${c.titulo} ${c.descricao}`.toLowerCase().includes(q)).slice(0, 8).map(c => ({ id: c.id, titulo: c.titulo, resumo: c.descricao || '', destino: '/painel' })),
    ativos: data.computadores.filter(c => unitScope(req, c) && `${c.patrimonio || ''} ${c.modelo || ''}`.toLowerCase().includes(q)).slice(0, 8).map(c => ({ id: c.id, titulo: c.patrimonio || c.modelo || 'Ativo', resumo: c.modelo || '', destino: '/inventario' }))
  }));
  res.json(result);
});

// Usuários: somente administrador pode gerenciar contas. Perfis administrativos não são aceitos pela API.
app.get('/api/usuarios', autenticar, admin, (req, res) => res.json(scopedList(req, 'usuarios').map(safeUser)));
app.get('/api/tecnicos', autenticar, operational, (req, res) => res.json(scopedList(req, 'usuarios').filter(u => u.perfil === 'tecnico' && u.ativo).map(u => ({ id: u.id, nome: u.nome, email: u.email }))));
app.post('/api/usuarios', autenticar, admin, async (req, res) => {
  const nome = text(req.body.nome), email = text(req.body.email).toLowerCase(), senha = String(req.body.senha || ''), perfil = text(req.body.perfil);
  const unidadeId = currentUnit(req, res);
  if (!unidadeId) return;
  if (!nome || !email || senha.length < 8 || !['tecnico', 'usuario'].includes(perfil)) return res.status(400).json({ erro: 'Informe nome, email, senha com ao menos 8 caracteres e perfil válido.' });
  const exists = store.read(data => data.usuarios.some(u => u.email.toLowerCase() === email));
  if (exists) return res.status(400).json({ erro: 'Email já cadastrado.' });
  const senha_hash = await bcrypt.hash(senha, 10);
  const user = await store.write(data => add(data, 'usuarios', { nome, email, senha_hash, perfil, setor_id: validId(req.body.setor) ? id(req.body.setor) : null, unidade_id: unidadeId, ativo: 1 }));
  res.status(201).json({ sucesso: true, id: user.id, mensagem: 'Usuário cadastrado com sucesso!' });
});
app.put('/api/usuarios/:id', autenticar, admin, async (req, res) => {
  const target = store.read(data => find(data, 'usuarios', req.params.id));
  if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (target.perfil === 'admin') return res.status(403).json({ erro: 'A conta demonstrativa administrativa não pode ser alterada por esta rota.' });
  const patch = {};
  if (req.body.nome !== undefined) patch.nome = text(req.body.nome);
  if (req.body.email !== undefined) patch.email = text(req.body.email).toLowerCase();
  if (req.body.setor !== undefined) patch.setor_id = validId(req.body.setor) ? id(req.body.setor) : null;
  if (req.body.perfil !== undefined) {
    if (!['tecnico', 'usuario'].includes(req.body.perfil)) return res.status(400).json({ erro: 'Perfil inválido.' });
    patch.perfil = req.body.perfil;
  }
  if (req.body.senha) patch.senha_hash = await bcrypt.hash(String(req.body.senha), 10);
  await store.write(data => update(data, 'usuarios', req.params.id, patch));
  res.json({ sucesso: true, mensagem: 'Usuário atualizado!' });
});
app.put('/api/usuarios/:id/ativo', autenticar, admin, async (req, res) => {
  const target = store.read(data => find(data, 'usuarios', req.params.id));
  if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (target.perfil === 'admin') return res.status(403).json({ erro: 'A conta demonstrativa administrativa não pode ser inativada.' });
  await store.write(data => update(data, 'usuarios', req.params.id, { ativo: req.body.ativo ? 1 : 0 }));
  res.json({ sucesso: true, mensagem: 'Status do usuário atualizado.' });
});
app.delete('/api/usuarios/:id', autenticar, admin, async (req, res) => {
  const target = store.read(data => find(data, 'usuarios', req.params.id));
  if (!target) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (target.perfil === 'admin') return res.status(403).json({ erro: 'A conta demonstrativa administrativa não pode ser excluída.' });
  await store.write(data => remove(data, 'usuarios', req.params.id));
  res.json({ sucesso: true, mensagem: 'Usuário excluído!' });
});

// Chamados, histórico e comentários.
app.post('/api/chamados', autenticar, async (req, res) => {
  const unidadeId = currentUnit(req, res); if (!unidadeId) return;
  const titulo = text(req.body.titulo), descricao = text(req.body.descricao);
  if (!titulo || !descricao) return res.status(400).json({ erro: 'Título e descrição são obrigatórios.' });
  const chamado = await store.write(data => add(data, 'chamados', { titulo, descricao, usuario_id: req.usuario.id, tecnico_id: null, unidade_id: unidadeId, subcategoria_id: validId(req.body.subcategoria_id) ? id(req.body.subcategoria_id) : null, local_id: validId(req.body.local_id) ? id(req.body.local_id) : null, status: 'Aberto' }));
  res.status(201).json({ sucesso: true, id: chamado.id, mensagem: 'Chamado aberto!' });
});
app.get('/api/chamados', autenticar, (req, res) => res.json(store.read(data => data.chamados.filter(c => ticketAllowed(req, c)).filter(c => !req.query.status || String(req.query.status).split(',').includes(c.status)).map(c => enrich(data, c, 'chamados')).sort((a, b) => b.id - a.id))));
app.put('/api/chamados/:id/status', autenticar, requireTicket, operational, async (req, res) => {
  const status = text(req.body.status); const validos = ['Aberto', 'Em andamento', 'Aguardando Fornecedor', 'Resolvido', 'Reaberto'];
  if (!validos.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });
  if (status === 'Resolvido' && !text(req.body.motivo)) return res.status(400).json({ erro: 'Informe o motivo da resolução.' });
  await store.write(data => { const before = find(data, 'chamados', req.params.id); update(data, 'chamados', req.params.id, { status, motivo: text(req.body.motivo) || null, fornecedor_id: validId(req.body.fornecedor_id) ? id(req.body.fornecedor_id) : null, tecnico_id: before.tecnico_id || req.usuario.id }); add(data, 'notificacoes_log', { chamado_id: before.id, usuario_id: before.usuario_id, alterado_por: req.usuario.id, status_anterior: before.status, status_novo: status, enviada_em: now() }); });
  res.json({ sucesso: true, mensagem: `Status alterado para "${status}".` });
});
app.put('/api/chamados/:id/reabrir', autenticar, requireTicket, async (req, res) => {
  if (req.chamado.status !== 'Resolvido') return res.status(400).json({ erro: 'Apenas chamados resolvidos podem ser reabertos.' });
  await store.write(data => update(data, 'chamados', req.params.id, { status: 'Reaberto' }));
  res.json({ sucesso: true, mensagem: 'Chamado reaberto com sucesso!' });
});
app.put('/api/chamados/:id', autenticar, requireTicket, operational, async (req, res) => {
  await store.write(data => update(data, 'chamados', req.params.id, { titulo: text(req.body.titulo) || req.chamado.titulo, descricao: text(req.body.descricao) || req.chamado.descricao, local_id: req.body.local_id === undefined ? req.chamado.local_id : (validId(req.body.local_id) ? id(req.body.local_id) : null) }));
  res.json({ sucesso: true, mensagem: 'Chamado atualizado com sucesso!' });
});
app.delete('/api/chamados/:id', autenticar, requireTicket, operational, async (req, res) => { await store.write(data => remove(data, 'chamados', req.params.id)); res.json({ sucesso: true, mensagem: 'Chamado excluído com sucesso!' }); });
app.get('/api/chamados/:id/historico', autenticar, requireTicket, (req, res) => res.json(store.read(data => ({ chamado: enrich(data, find(data, 'chamados', req.params.id), 'chamados'), historico: data.notificacoes_log.filter(x => Number(x.chamado_id) === id(req.params.id)).map(x => ({ ...x, alterado_por_nome: find(data, 'usuarios', x.alterado_por)?.nome || '' })) }))));
app.get('/api/chamados/:id/detalhes', autenticar, requireTicket, (req, res) => res.json(store.read(data => enrich(data, find(data, 'chamados', req.params.id), 'chamados'))));
app.get('/api/chamados/:id/comentarios', autenticar, requireTicket, (req, res) => {
  const comentarios = store.read(data => data.comentarios
    .filter(x => Number(x.chamado_id) === id(req.params.id))
    .map(x => ({
      ...x,
      autor_nome: find(data, 'usuarios', x.usuario_id)?.nome || '',
      autor_perfil: find(data, 'usuarios', x.usuario_id)?.perfil || ''
    })));
  res.json(comentarios);
});
app.post('/api/chamados/:id/comentarios', autenticar, requireTicket, async (req, res) => { const comentario = text(req.body.texto); if (!comentario) return res.status(400).json({ erro: 'O comentário não pode estar vazio.' }); await store.write(data => add(data, 'comentarios', { chamado_id: id(req.params.id), usuario_id: req.usuario.id, texto: comentario })); res.status(201).json({ sucesso: true, mensagem: 'Comentário adicionado!' }); });

function simpleCrud({ path: route, key, unit = false, fields = null, message = 'Registro', manage = operational }) {
  app.get(`/api/${route}`, autenticar, (req, res) => {
    let items = scopedList(req, key);
    if (key === 'custos_chamado' || key === 'orcamentos_chamado') {
      items = store.read(data => data[key]
        .filter(item => ticketAllowed(req, find(data, 'chamados', item.chamado_id)))
        .map(item => enrich(data, item, key)));
    }
    if (key === 'subcategorias' && validId(req.query.categoria_id)) items = items.filter(x => Number(x.categoria_id) === id(req.query.categoria_id));
    if ((key === 'custos_chamado' || key === 'orcamentos_chamado') && validId(req.query.chamado_id)) items = items.filter(x => Number(x.chamado_id) === id(req.query.chamado_id));
    if (key === 'locais' && !req.query.incluir_inativos) items = items.filter(x => x.ativo !== 0);
    res.json(items);
  });
  app.post(`/api/${route}`, autenticar, manage, async (req, res) => {
    const unidadeId = unit ? currentUnit(req, res) : null; if (unit && !unidadeId) return;
    const body = fields ? Object.fromEntries(fields.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]])) : { ...req.body };
    if (body.nome !== undefined && !text(body.nome)) return res.status(400).json({ erro: 'Nome é obrigatório.' });
    if ((key === 'custos_chamado' || key === 'orcamentos_chamado') && !ticketAllowed(req, store.read(data => find(data, 'chamados', body.chamado_id)))) return res.status(403).json({ erro: 'Acesso negado a este chamado.' });
    const item = await store.write(data => add(data, key, { ...body, ...(unit ? { unidade_id: unidadeId } : {}), ativo: body.ativo === undefined ? 1 : body.ativo }));
    res.status(201).json({ sucesso: true, id: item.id, mensagem: `${message} criado!` });
  });
  app.put(`/api/${route}/:id`, autenticar, manage, async (req, res) => {
    const existing = store.read(data => find(data, key, req.params.id));
    if (!existing) return res.status(404).json({ erro: `${message} não encontrado.` });
    if (unit && !unitScope(req, existing)) return res.status(403).json({ erro: 'Acesso negado.' });
    if ((key === 'custos_chamado' || key === 'orcamentos_chamado') && !ticketAllowed(req, store.read(data => find(data, 'chamados', existing.chamado_id)))) return res.status(403).json({ erro: 'Acesso negado a este chamado.' });
    const body = fields ? Object.fromEntries(fields.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]])) : { ...req.body };
    await store.write(data => update(data, key, req.params.id, body));
    res.json({ sucesso: true, mensagem: `${message} atualizado!` });
  });
  app.delete(`/api/${route}/:id`, autenticar, manage, async (req, res) => {
    const existing = store.read(data => find(data, key, req.params.id));
    if (!existing) return res.status(404).json({ erro: `${message} não encontrado.` });
    if (unit && !unitScope(req, existing)) return res.status(403).json({ erro: 'Acesso negado.' });
    if ((key === 'custos_chamado' || key === 'orcamentos_chamado') && !ticketAllowed(req, store.read(data => find(data, 'chamados', existing.chamado_id)))) return res.status(403).json({ erro: 'Acesso negado a este chamado.' });
    await store.write(data => remove(data, key, req.params.id));
    res.json({ sucesso: true, mensagem: `${message} removido!` });
  });
}

simpleCrud({ path: 'categorias', key: 'categorias', fields: ['nome'], message: 'Categoria' });
simpleCrud({ path: 'subcategorias', key: 'subcategorias', fields: ['nome', 'categoria_id'], message: 'Subcategoria' });
simpleCrud({ path: 'fornecedores', key: 'fornecedores', fields: ['nome', 'cnpj', 'telefone', 'email', 'endereco'], message: 'Fornecedor' });
simpleCrud({ path: 'setores', key: 'setores', fields: ['nome'], message: 'Setor' });
simpleCrud({ path: 'locais', key: 'locais', unit: true, fields: ['nome', 'tipo', 'ativo'], message: 'Local' });

// Dispositivos e números associados.
app.get('/api/dispositivos', autenticar, operational, (req, res) => res.json(scopedList(req, 'dispositivos').map(d => ({ ...d, total_numeros: store.read(data => data.numeros_dispositivos.filter(n => Number(n.dispositivo_id) === Number(d.id)).length) }))));
app.get('/api/dispositivos/relatorio', autenticar, operational, (req, res) => res.json({ dispositivos: scopedList(req, 'dispositivos'), gerado_em: now() }));
app.post('/api/dispositivos', autenticar, operational, async (req, res) => { const unidadeId = currentUnit(req, res); if (!unidadeId) return; const item = await store.write(data => add(data, 'dispositivos', { ...req.body, unidade_id: unidadeId, ativo: 1 })); res.status(201).json({ sucesso: true, id: item.id, mensagem: 'Dispositivo cadastrado!' }); });
app.put('/api/dispositivos/:id', autenticar, operational, async (req, res) => { const item = store.read(data => find(data, 'dispositivos', req.params.id)); if (!item) return res.status(404).json({ erro: 'Dispositivo não encontrado.' }); if (!unitScope(req, item)) return res.status(403).json({ erro: 'Acesso negado.' }); await store.write(data => update(data, 'dispositivos', item.id, req.body)); res.json({ sucesso: true, mensagem: 'Dispositivo atualizado!' }); });
app.delete('/api/dispositivos/:id', autenticar, operational, async (req, res) => { const item = store.read(data => find(data, 'dispositivos', req.params.id)); if (!item) return res.status(404).json({ erro: 'Dispositivo não encontrado.' }); if (!unitScope(req, item)) return res.status(403).json({ erro: 'Acesso negado.' }); await store.write(data => { remove(data, 'dispositivos', item.id); data.numeros_dispositivos = data.numeros_dispositivos.filter(n => Number(n.dispositivo_id) !== Number(item.id)); }); res.json({ sucesso: true, mensagem: 'Dispositivo removido!' }); });
app.get('/api/dispositivos/:id/numeros', autenticar, operational, (req, res) => res.json(store.read(data => data.numeros_dispositivos.filter(n => Number(n.dispositivo_id) === id(req.params.id)))));
app.post('/api/dispositivos/:id/numeros', autenticar, operational, async (req, res) => { const n = await store.write(data => add(data, 'numeros_dispositivos', { ...req.body, dispositivo_id: id(req.params.id) })); res.status(201).json({ sucesso: true, id: n.id, mensagem: 'Número adicionado!' }); });
app.put('/api/dispositivos/:id/numeros/:numeroId', autenticar, operational, async (req, res) => { const n = store.read(data => find(data, 'numeros_dispositivos', req.params.numeroId)); if (!n || Number(n.dispositivo_id) !== id(req.params.id)) return res.status(404).json({ erro: 'Número não encontrado.' }); await store.write(data => update(data, 'numeros_dispositivos', n.id, req.body)); res.json({ sucesso: true, mensagem: 'Número atualizado!' }); });
app.delete('/api/dispositivos/:id/numeros/:numeroId', autenticar, operational, async (req, res) => { await store.write(data => remove(data, 'numeros_dispositivos', req.params.numeroId)); res.json({ sucesso: true, mensagem: 'Número removido!' }); });

// Inventário (computadores e ativos são a mesma coleção, como no esquema anterior).
function assetList(req) { return scopedList(req, 'computadores'); }
app.get('/api/computadores', autenticar, operational, (req, res) => res.json(assetList(req)));
app.get('/api/ativos', autenticar, operational, (req, res) => res.json(assetList(req)));
async function createAsset(req, res) { const unidadeId = currentUnit(req, res); if (!unidadeId) return; const asset = await store.write(data => add(data, 'computadores', { ...req.body, unidade_id: unidadeId, tipo: req.body.tipo || 'computador', status: req.body.status || 'Ativo', usuario_id: req.body.usuario_id || null, local_id: req.body.local_id || null })); res.status(201).json({ sucesso: true, id: asset.id, mensagem: 'Ativo cadastrado!' }); }
async function updateAsset(req, res) { const asset = store.read(data => find(data, 'computadores', req.params.id)); if (!asset) return res.status(404).json({ erro: 'Ativo não encontrado.' }); if (!unitScope(req, asset)) return res.status(403).json({ erro: 'Acesso negado.' }); await store.write(data => update(data, 'computadores', asset.id, req.body)); res.json({ sucesso: true, mensagem: 'Ativo atualizado!' }); }
async function deleteAsset(req, res) { const asset = store.read(data => find(data, 'computadores', req.params.id)); if (!asset) return res.status(404).json({ erro: 'Ativo não encontrado.' }); if (!unitScope(req, asset)) return res.status(403).json({ erro: 'Acesso negado.' }); await store.write(data => remove(data, 'computadores', asset.id)); res.json({ sucesso: true, mensagem: 'Ativo removido!' }); }
app.post('/api/computadores', autenticar, operational, createAsset); app.put('/api/computadores/:id', autenticar, operational, updateAsset); app.delete('/api/computadores/:id', autenticar, operational, deleteAsset);
app.post('/api/ativos', autenticar, operational, createAsset); app.put('/api/ativos/:id', autenticar, operational, updateAsset); app.delete('/api/ativos/:id', autenticar, operational, deleteAsset);
app.put(['/api/computadores/:id/atribuir', '/api/ativos/:id/atribuir'], autenticar, operational, async (req, res) => { const asset = store.read(data => find(data, 'computadores', req.params.id)); if (!asset || !unitScope(req, asset)) return res.status(404).json({ erro: 'Ativo não encontrado.' }); const userId = req.body.usuario_id ? id(req.body.usuario_id) : null; if (userId) { const user = store.read(data => find(data, 'usuarios', userId)); if (!user || Number(user.unidade_id) !== Number(asset.unidade_id)) return res.status(400).json({ erro: 'Usuário inválido para esta unidade.' }); } await store.write(data => update(data, 'computadores', asset.id, { usuario_id: userId })); res.json({ sucesso: true, mensagem: 'Usuário atribuído!' }); });
app.get('/api/ativos/mapa-rede', autenticar, operational, (req, res) => res.json(assetList(req).filter(x => x.ip || x.ip_endereco)));
app.get('/api/ativos/:id/movimentacoes', autenticar, operational, (req, res) => res.json(store.read(data => data.movimentacoes_bens.filter(x => Number(x.bem_id) === id(req.params.id)))));
app.post('/api/ativos/:id/movimentacoes', autenticar, operational, async (req, res) => { const asset = store.read(data => find(data, 'computadores', req.params.id)); const localId = id(req.body.local_destino_id); if (!asset || !unitScope(req, asset)) return res.status(404).json({ erro: 'Ativo não encontrado.' }); const local = store.read(data => find(data, 'locais', localId)); if (!local || !unitScope(req, local)) return res.status(400).json({ erro: 'Local de destino inválido.' }); await store.write(data => { add(data, 'movimentacoes_bens', { bem_id: asset.id, local_origem_id: asset.local_id || null, local_destino_id: localId, usuario_responsavel_id: req.usuario.id, observacao: text(req.body.observacao) }); update(data, 'computadores', asset.id, { local_id: localId }); }); res.status(201).json({ sucesso: true, mensagem: 'Movimentação registrada!' }); });
app.get('/api/ativos/manutencoes-agendadas', autenticar, operational, (req, res) => res.json(store.read(data => data.manutencoes.filter(m => m.status === 'agendada').filter(m => unitScope(req, find(data, 'computadores', m.bem_id) || {})))));
app.get('/api/ativos/manutencao-preventiva/candidatos', autenticar, operational, (req, res) => res.json(store.read(data => ({ unidade_id: req.usuario.unidade_id, locais: data.locais.filter(l => unitScope(req, l) && l.ativo !== 0).map(l => ({ ...l, computadores: data.computadores.filter(c => Number(c.local_id) === Number(l.id) && unitScope(req, c)).map(c => ({ ...c, impedido: data.manutencoes.some(m => Number(m.bem_id) === Number(c.id) && m.tipo === 'preventiva' && m.status === 'agendada') })) })) }))));
app.post('/api/ativos/manutencoes/lote', autenticar, operational, async (req, res) => { const ids = [...new Set((req.body.bem_ids || []).map(id).filter(Number.isInteger))]; if (!ids.length) return res.status(400).json({ erro: 'Selecione ao menos um ativo.' }); const result = await store.write(data => { const created = []; for (const bem_id of ids) { const asset = find(data, 'computadores', bem_id); if (asset && unitScope(req, asset) && !data.manutencoes.some(m => Number(m.bem_id) === bem_id && m.tipo === 'preventiva' && m.status === 'agendada')) created.push(add(data, 'manutencoes', { bem_id, tipo: 'preventiva', descricao: text(req.body.descricao), data_prevista: req.body.data_prevista || null, status: 'agendada', tecnico_responsavel_id: req.usuario.id })); } return created; }); res.status(201).json({ sucesso: true, criados: result.length, ignorados: [], mensagem: 'Manutenções preventivas agendadas!' }); });
app.get('/api/ativos/:id/manutencoes', autenticar, operational, (req, res) => res.json(store.read(data => data.manutencoes.filter(m => Number(m.bem_id) === id(req.params.id)))));
app.post('/api/ativos/:id/manutencoes', autenticar, operational, async (req, res) => { const m = await store.write(data => add(data, 'manutencoes', { ...req.body, bem_id: id(req.params.id), tecnico_responsavel_id: req.usuario.id, status: req.body.status || 'agendada' })); res.status(201).json({ sucesso: true, id: m.id, mensagem: 'Manutenção registrada!' }); });
app.put('/api/manutencoes/:id', autenticar, operational, async (req, res) => { const m = store.read(data => find(data, 'manutencoes', req.params.id)); if (!m) return res.status(404).json({ erro: 'Manutenção não encontrada.' }); await store.write(data => update(data, 'manutencoes', m.id, req.body)); res.json({ sucesso: true, mensagem: 'Manutenção atualizada!' }); });
simpleCrud({ path: 'manutencoes/categorias-servico', key: 'categorias_servico_manutencao', fields: ['nome', 'ativo'], message: 'Categoria de serviço' });
app.post('/api/manutencoes/categorias-servico/:id/subcategorias', autenticar, operational, async (req, res) => { const item = await store.write(data => add(data, 'subcategorias_servico_manutencao', { categoria_id: id(req.params.id), nome: text(req.body.nome), ativo: 1 })); res.status(201).json({ sucesso: true, id: item.id, mensagem: 'Subcategoria criada!' }); });
app.put('/api/manutencoes/subcategorias-servico/:id', autenticar, operational, async (req, res) => { await store.write(data => update(data, 'subcategorias_servico_manutencao', req.params.id, req.body)); res.json({ sucesso: true, mensagem: 'Subcategoria atualizada!' }); });
app.get('/api/checklists-laboratorio/preparacao', autenticar, operational, (req, res) => res.json({ locais: scopedList(req, 'locais'), itens: [] }));
app.get('/api/checklists-laboratorio', autenticar, operational, (req, res) => res.json(scopedList(req, 'checklists_laboratorio')));
app.get('/api/checklists-laboratorio/:id', autenticar, operational, (req, res) => res.json(store.read(data => ({ ...find(data, 'checklists_laboratorio', req.params.id), itens: data.checklist_laboratorio_itens.filter(x => Number(x.checklist_id) === id(req.params.id)) }))));
app.post('/api/checklists-laboratorio', autenticar, operational, async (req, res) => { const unit = currentUnit(req, res); if (!unit) return; const record = await store.write(data => { const checklist = add(data, 'checklists_laboratorio', { local_id: id(req.body.local_id), unidade_id: unit, turno: req.body.turno || 'outro', observacoes: text(req.body.observacoes), usuario_id: req.usuario.id }); for (const item of (req.body.itens || [])) add(data, 'checklist_laboratorio_itens', { ...item, checklist_id: checklist.id }); return checklist; }); res.status(201).json({ sucesso: true, id: record.id, mensagem: 'Checklist salvo!' }); });
app.get('/api/ativos/indicadores-manutencao', autenticar, operational, (_, res) => res.json({ resumo: [], serie: [], recorrentes: [] }));

// Financeiro, impressoras e notas fiscais.
simpleCrud({ path: 'custos-chamado', key: 'custos_chamado', fields: ['chamado_id', 'descricao', 'tipo', 'valor', 'fornecedor_id'], message: 'Custo' });
app.get('/api/custos-chamado', autenticar, (req, res) => { const items = scopedList(req, 'custos_chamado').filter(x => !req.query.chamado_id || Number(x.chamado_id) === id(req.query.chamado_id)); res.json(items); });
simpleCrud({ path: 'orcamentos-chamado', key: 'orcamentos_chamado', fields: ['chamado_id', 'fornecedor_id', 'descricao', 'valor', 'status'], message: 'Orçamento' });
app.put('/api/orcamentos-chamado/:id/aprovar', autenticar, admin, async (req, res) => { await store.write(data => update(data, 'orcamentos_chamado', req.params.id, { status: 'aprovado' })); res.json({ sucesso: true, mensagem: 'Orçamento aprovado!' }); });
app.put('/api/orcamentos-chamado/:id/rejeitar', autenticar, admin, async (req, res) => { await store.write(data => update(data, 'orcamentos_chamado', req.params.id, { status: 'rejeitado' })); res.json({ sucesso: true, mensagem: 'Orçamento rejeitado!' }); });
simpleCrud({ path: 'compras-mensais', key: 'compras_mensais', fields: ['mes', 'ano', 'fornecedor_id', 'item', 'objetivo', 'valor_estimado', 'status'], message: 'Compra' });
app.put('/api/compras-mensais/:id/status', autenticar, operational, async (req, res) => { await store.write(data => update(data, 'compras_mensais', req.params.id, { status: req.body.status })); res.json({ sucesso: true, mensagem: 'Status atualizado!' }); });
app.get('/api/relatorios/financeiros', autenticar, operational, (_, res) => res.json({ total_gasto: 0, gastos_por_tipo: [], gastos_por_setor: [], top_chamados: [], orcamentos_pendentes: [] }));
app.get('/api/impressoras', autenticar, operational, (req, res) => res.json(scopedList(req, 'impressoras')));
app.post('/api/impressoras', autenticar, operational, async (req, res) => { const unit = currentUnit(req, res); if (!unit) return; const item = await store.write(data => add(data, 'impressoras', { ...req.body, unidade_id: unit, ativo: 1, contagem_atual: Number(req.body.contagem_atual || 0) })); res.status(201).json({ sucesso: true, id: item.id, mensagem: 'Impressora cadastrada!' }); });
app.put('/api/impressoras/:id', autenticar, operational, async (req, res) => { await store.write(data => update(data, 'impressoras', req.params.id, req.body)); res.json({ sucesso: true, mensagem: 'Impressora atualizada!' }); });
app.delete('/api/impressoras/:id', autenticar, operational, async (req, res) => { await store.write(data => remove(data, 'impressoras', req.params.id)); res.json({ sucesso: true, mensagem: 'Impressora removida!' }); });
app.put('/api/impressoras/:id/status', autenticar, operational, async (req, res) => { await store.write(data => update(data, 'impressoras', req.params.id, { ativo: req.body.ativo ? 1 : 0 })); res.json({ sucesso: true, mensagem: 'Status atualizado!' }); });
app.get('/api/leituras', autenticar, operational, (req, res) => res.json(scopedList(req, 'leituras_mensais')));
app.post('/api/leituras', autenticar, operational, async (req, res) => { const item = await store.write(data => add(data, 'leituras_mensais', { ...req.body, criado_por: req.usuario.id })); res.status(201).json({ sucesso: true, id: item.id, mensagem: 'Leitura registrada!' }); });
app.get('/api/parametros-impressao', autenticar, operational, (req, res) => res.json(store.read(data => data.parametros_impressao)));
app.put('/api/parametros-impressao', autenticar, operational, async (req, res) => { await store.write(data => { data.parametros_impressao = Object.entries(req.body || {}).map(([chave, valor], index) => ({ id: index + 1, chave, valor })); }); res.json({ sucesso: true, mensagem: 'Parâmetros atualizados!' }); });
app.get('/api/relatorios/impressao/mensal', autenticar, operational, (_, res) => res.json({ impressoras: [], totais: { impressoes: 0, custo: 0 } }));
simpleCrud({ path: 'notas-fiscais', key: 'notas_fiscais', fields: ['numero', 'fornecedor_id', 'chamado_id', 'valor', 'data_emissao', 'data_vencimento', 'data_pagamento', 'status', 'observacoes'], message: 'Nota fiscal' });
app.get('/api/notas-fiscais/estatisticas', autenticar, operational, (_, res) => res.json({ total: 0, pendentes: 0, pagas: 0, atrasadas: 0, valor_total: 0 }));
app.put('/api/notas-fiscais/:id/status', autenticar, operational, async (req, res) => { await store.write(data => update(data, 'notas_fiscais', req.params.id, { status: req.body.status, data_pagamento: req.body.data_pagamento || null })); res.json({ sucesso: true, mensagem: 'Status atualizado!' }); });
simpleCrud({ path: 'nf-comparativo', key: 'nf_comparativo_mensal', fields: ['mes', 'ano', 'valor_acadweb', 'valor_prefeitura', 'observacoes'], message: 'Comparativo' });
app.get('/api/nf-comparativo/:id', autenticar, operational, (req, res) => { const item = store.read(data => find(data, 'nf_comparativo_mensal', req.params.id)); if (!item) return res.status(404).json({ erro: 'Comparativo não encontrado.' }); res.json(item); });

// Relatórios e RBAC (vazios inicialmente, mas persistidos se configurados pelo admin).
app.get('/api/relatorios', autenticar, operational, (req, res) => res.json(store.read(data => { const chamados = data.chamados.filter(c => ticketAllowed(req, c)); const count = status => chamados.filter(c => c.status === status).length; return { porStatus: ['Aberto', 'Em andamento', 'Resolvido'].map(status => ({ status, total: count(status) })), porTecnico: [], totalChamados: chamados.length }; })));
app.get('/api/relatorios/tempos', autenticar, operational, (_, res) => res.json({ chamados: [], metricas: { tempo_medio_util_ms: 0, tempo_medio_total_ms: 0, mais_demorado_ms: 0, mais_rapido_ms: 0, total_chamados: 0, total_resolvidos: 0 } }));
app.get('/api/permissoes', autenticar, admin, (_, res) => res.json(store.read(data => data.permissoes)));
app.get('/api/grupos', autenticar, admin, (_, res) => res.json(store.read(data => data.grupos)));
simpleCrud({ path: 'grupos', key: 'grupos', fields: ['nome', 'descricao'], message: 'Grupo', manage: admin });
app.put('/api/grupos/:id/permissoes', autenticar, admin, async (req, res) => { const permissions = Array.isArray(req.body.permissoes) ? req.body.permissoes.map(id) : []; await store.write(data => { data.grupos_permissoes = data.grupos_permissoes.filter(x => Number(x.grupo_id) !== id(req.params.id)); permissions.forEach(permissao_id => data.grupos_permissoes.push({ grupo_id: id(req.params.id), permissao_id })); }); res.json({ sucesso: true, mensagem: 'Permissões atualizadas!' }); });
app.get('/api/usuarios/:id/grupos', autenticar, admin, (req, res) => res.json(store.read(data => data.usuarios_grupos.filter(x => Number(x.usuario_id) === id(req.params.id)).map(x => x.grupo_id))));
app.put('/api/usuarios/:id/grupos', autenticar, admin, async (req, res) => { const groups = Array.isArray(req.body.grupos) ? req.body.grupos.map(id) : []; await store.write(data => { data.usuarios_grupos = data.usuarios_grupos.filter(x => Number(x.usuario_id) !== id(req.params.id)); groups.forEach(grupo_id => data.usuarios_grupos.push({ usuario_id: id(req.params.id), grupo_id })); }); res.json({ sucesso: true, mensagem: 'Grupos atualizados!' }); });

app.use('/api', (_, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
app.use((err, _, res, __) => { console.error('Erro interno:', err); res.status(500).json({ erro: 'Erro interno.' }); });

async function start() {
  await store.initialize();
  app.listen(PORT, HOST, () => {
    console.log(`CHGT HelpDesk JSON disponível em http://${HOST}:${PORT}`);
    console.log('Dados locais: data/local.json (ignorado pelo Git)');
  });
}

if (require.main === module) start().catch(err => { console.error('Falha ao iniciar:', err.message); process.exitCode = 1; });

module.exports = { app, store, start };
