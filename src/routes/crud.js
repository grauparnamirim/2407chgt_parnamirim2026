const { Router } = require('express');
const { getDb } = require('../db');
const { autenticar, operational, now, id, validId, currentUnit, unitScope, validTable, validColumns } = require('../middleware');

// Gera rotas CRUD automáticas (GET, POST, PUT, DELETE) para uma tabela
// Parâmetros:
//   path         - caminho da rota (ex: "locais")
//   table        - nome da tabela no banco
//   fields       - array de campos permitidos (opcional)
//   unit         - se true, aplica filtro por unidade do usuário
//   message      - nome amigável para mensagens de resposta
//   beforeCreate - hook (req, body) => string de erro | null (bloqueia criação)
//   beforeUpdate - hook (req, existing, body) => string de erro | null
//   beforeDelete - hook (req, existing) => string de erro | null
function createCrudRoutes({ path, table, fields, unit, message, beforeCreate, beforeUpdate, beforeDelete }) {
  validTable(table);
  const router = Router();
  const manage = operational;
  const bloquear = (req, res, erro) => res.status(400).json({ erro });

  router.get(`/${path}`, autenticar,async  (req, res) => {
    const db = getDb();
    let rows;
    if (unit && req.usuario.perfil !== 'admin') {
      rows = (await db.prepare(`SELECT * FROM ${validTable(table)} WHERE unidade_id = ?`).all(req.usuario.unidade_id));
    } else {
      rows = (await db.prepare(`SELECT * FROM ${validTable(table)}`).all());
    }
    if (table === 'locais' && !req.query.incluir_inativos) rows = rows.filter(x => x.ativo !== 0);
    if (table === 'locais') {
      const countStmt = db.prepare(`SELECT
        (SELECT COUNT(*) FROM computadores c WHERE c.local_id = ? AND c.status NOT IN ('Desativado','Baixado')) +
        (SELECT COUNT(*) FROM dispositivos d WHERE d.local_id = ? AND d.ativo = 1) +
        (SELECT COUNT(*) FROM impressoras i WHERE i.local_id = ? AND i.ativo = 1) AS total`);
      for (const row of rows) row.total_bens = await countStmt.get(row.id, row.id, row.id).total || 0;
    }
    res.json(rows);
  });

  router.post(`/${path}`, autenticar, manage,async  (req, res) => {
    const db = getDb();
    let unidadeId;
    if (unit) { unidadeId = currentUnit(req, res); if (!unidadeId) return; }
    const body = fields ? Object.fromEntries(fields.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]])) : { ...req.body };
    if (body.nome !== undefined && !String(body.nome).trim()) return res.status(400).json({ erro: 'Nome é obrigatório.' });
    if (beforeCreate) { const erro = beforeCreate(req, body); if (erro) return bloquear(req, res, erro); }
    const cols = [...Object.keys(body), ...(unit ? ['unidade_id'] : []), 'criado_em', 'atualizado_em'];
    validColumns(cols, [...(fields || Object.keys(body)), ...(unit ? ['unidade_id'] : []), 'criado_em', 'atualizado_em']);
    const vals = [...Object.values(body), ...(unit ? [unidadeId] : []), now(), now()];
    const placeholders = cols.map(() => '?').join(', ');
    const result = (await db.prepare(`INSERT INTO ${validTable(table)} (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals));
    res.status(201).json({ sucesso: true, id: result.lastInsertRowid, mensagem: `${message} criado!` });
  });

  router.put(`/${path}/:id`, autenticar, manage,async  (req, res) => {
    const db = getDb();
    const existing = (await db.prepare(`SELECT * FROM ${validTable(table)} WHERE id = ?`).get(id(req.params.id)));
    if (!existing) return res.status(404).json({ erro: `${message} não encontrado.` });
    if (unit && !unitScope(req, existing)) return res.status(403).json({ erro: 'Acesso negado.' });
    if (beforeUpdate) { const erro = beforeUpdate(req, existing, req.body); if (erro) return bloquear(req, res, erro); }
    const body = fields ? Object.fromEntries(fields.filter(k => req.body[k] !== undefined).map(k => [k, req.body[k]])) : { ...req.body };
    const allowed = [...(fields || Object.keys(body)), 'atualizado_em'];
    const sets = Object.keys(body).map(k => { validColumns([k], allowed); return `${k} = ?`; });
    const vals = Object.values(body);
    if (sets.length) { sets.push('atualizado_em = ?'); vals.push(now()); vals.push(id(req.params.id)); (await db.prepare(`UPDATE ${validTable(table)} SET ${sets.join(', ')} WHERE id = ?`).run(...vals)); }
    res.json({ sucesso: true, mensagem: `${message} atualizado!` });
  });

  router.delete(`/${path}/:id`, autenticar, manage,async  (req, res) => {
    const db = getDb();
    const existing = (await db.prepare(`SELECT * FROM ${validTable(table)} WHERE id = ?`).get(id(req.params.id)));
    if (!existing) return res.status(404).json({ erro: `${message} não encontrado.` });
    if (unit && !unitScope(req, existing)) return res.status(403).json({ erro: 'Acesso negado.' });
    if (beforeDelete) { const erro = beforeDelete(req, existing); if (erro) return bloquear(req, res, erro); }
    (await db.prepare(`DELETE FROM ${validTable(table)} WHERE id = ?`).run(id(req.params.id)));
    res.json({ sucesso: true, mensagem: `${message} removido!` });
  });

  return router;
}

module.exports = { createCrudRoutes };
