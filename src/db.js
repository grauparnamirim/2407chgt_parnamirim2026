// Módulo de banco de dados PostgreSQL — configuração, schema e dados iniciais
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'chgt_helpdesk',
  max: Number(process.env.PGMAX || 10),
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false
});

let dbReady = false;
let activeClient = null;

// ============================================================
// Adapter compatível com a API síncrona do better-sqlite3
// ============================================================

// Converte marcadores posicionais "?" do SQLite para "$1, $2, ..." do PostgreSQL
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function getTarget() { return activeClient || pool; }

// Cria uma "statement" com os métodos get/all/run (assíncronos)
function makeStatement(sql) {
  const converted = convertPlaceholders(sql);
  return {
    async get(...params) {
      const r = await getTarget().query(converted, params);
      return r.rows[0];
    },
    async all(...params) {
      const r = await getTarget().query(converted, params);
      return r.rows;
    },
    async run(...params) {
      let q = converted;
      // Insere RETURNING id para emular last_insert_rowid() do SQLite
      if (/^\s*INSERT\s+INTO/i.test(q) && !/\bRETURNING\b/i.test(q)) q += ' RETURNING id';
      const r = await getTarget().query(q, params);
      return { lastInsertRowid: r.rows[0] ? r.rows[0].id : null, changes: r.rowCount };
    }
  };
}

// Objeto db exposto com a mesma forma da API antiga (prepare/exec)
const db = {
  prepare(sql) { return makeStatement(sql); },
  async exec(sql) {
    const stmts = sql.split(';').map(s => s.trim()).filter(Boolean);
    for (const s of stmts) await getTarget().query(s);
  },
  // Executa um callback dentro de uma transação (emula db.transaction do SQLite)
  async transaction(callback) {
    const client = await pool.connect();
    activeClient = client;
    try {
      await client.query('BEGIN');
      const result = await callback();
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      activeClient = null;
      client.release();
    }
  },
  query: (...args) => pool.query(...args)
};

// Retorna a instância do banco (lança erro se não foi inicializado)
function getDb() {
  if (!dbReady) throw new Error('Database not initialized');
  return db;
}

// Monta uma connection string a partir das variáveis de ambiente (usada no backup)
function getConnectionString() {
  const ssl = process.env.PGSSL === 'true' ? '?sslmode=require' : '';
  return `postgresql://${process.env.PGUSER || 'postgres'}:${encodeURIComponent(process.env.PGPASSWORD || 'postgres')}@${process.env.PGHOST || 'localhost'}:${Number(process.env.PGPORT || 5432)}/${process.env.PGDATABASE || 'chgt_helpdesk'}${ssl}`;
}

// Abre o banco, cria schema e popula dados iniciais
async function initialize() {
  let lastErr;
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      await schema();
      const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM unidades');
      if (rows[0].c === 0) await seed();
      await seedPermissoes();
      dbReady = true;
      return db;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  throw new Error('Não foi possível conectar ao PostgreSQL: ' + (lastErr && lastErr.message));
}

// ============================================================
// Criação das tabelas (schema) — PostgreSQL
// ============================================================

async function schema() {
  await db.exec(`CREATE TABLE IF NOT EXISTS unidades (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, cidade TEXT, ativo INTEGER DEFAULT 1
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY, valor TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS setores (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS usuarios (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL, perfil TEXT NOT NULL DEFAULT 'usuario',
    unidade_id INTEGER REFERENCES unidades(id), setor_id INTEGER REFERENCES setores(id),
    ativo INTEGER DEFAULT 1, criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS categorias (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS subcategorias (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, categoria_id INTEGER NOT NULL REFERENCES categorias(id), criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS fornecedores (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, cnpj TEXT, telefone TEXT, email TEXT, endereco TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS locais (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, tipo TEXT, ativo INTEGER DEFAULT 1,
    unidade_id INTEGER REFERENCES unidades(id), criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS chamados (
    id SERIAL PRIMARY KEY, titulo TEXT NOT NULL, descricao TEXT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id), tecnico_id INTEGER REFERENCES usuarios(id),
    unidade_id INTEGER NOT NULL REFERENCES unidades(id), subcategoria_id INTEGER REFERENCES subcategorias(id),
    local_id INTEGER REFERENCES locais(id), status TEXT DEFAULT 'Aberto', motivo TEXT,
    fornecedor_id INTEGER REFERENCES fornecedores(id), criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS comentarios (
    id SERIAL PRIMARY KEY, chamado_id INTEGER NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id), texto TEXT NOT NULL, criado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS notificacoes_log (
    id SERIAL PRIMARY KEY, chamado_id INTEGER NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
    usuario_id INTEGER, alterado_por INTEGER, status_anterior TEXT, status_novo TEXT, enviada_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS computadores (
    id SERIAL PRIMARY KEY, patrimonio TEXT, modelo TEXT, ip TEXT, ip_endereco TEXT,
    usuario_id INTEGER REFERENCES usuarios(id), local_id INTEGER REFERENCES locais(id),
    setor_id INTEGER REFERENCES setores(id),
    unidade_id INTEGER NOT NULL REFERENCES unidades(id), tipo TEXT DEFAULT 'computador',
    status TEXT DEFAULT 'Ativo',
    fabricante TEXT, num_serie TEXT, observacoes TEXT,
    processador TEXT, memoria_ram TEXT, armazenamento_tipo TEXT, armazenamento_tamanho TEXT,
    anydesk_id TEXT, teamviewer_id TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS movimentacoes_bens (
    id SERIAL PRIMARY KEY, bem_id INTEGER NOT NULL REFERENCES computadores(id) ON DELETE CASCADE,
    local_origem_id INTEGER, local_destino_id INTEGER,
    usuario_responsavel_id INTEGER, observacao TEXT, criado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS categorias_servico_manutencao (
    id SERIAL PRIMARY KEY, nome TEXT NOT NULL, criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS manutencoes (
    id SERIAL PRIMARY KEY, bem_id INTEGER NOT NULL REFERENCES computadores(id) ON DELETE CASCADE,
    tipo TEXT, categoria_servico_id INTEGER REFERENCES categorias_servico_manutencao(id),
    nome_servico TEXT, descricao TEXT, data_prevista TEXT, data_realizada_em TEXT,
    status TEXT DEFAULT 'agendada', tecnico_responsavel_id INTEGER, custo REAL,
    criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS checklists_laboratorio (
    id SERIAL PRIMARY KEY, local_id INTEGER, unidade_id INTEGER,
    turno TEXT, observacoes TEXT, usuario_id INTEGER, criado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS checklist_laboratorio_itens (
    id SERIAL PRIMARY KEY, checklist_id INTEGER NOT NULL REFERENCES checklists_laboratorio(id) ON DELETE CASCADE,
    estado TEXT, observacoes TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS dispositivos (
    id SERIAL PRIMARY KEY, nome TEXT, usuario_id INTEGER, setor_id INTEGER, local_id INTEGER,
    unidade_id INTEGER NOT NULL REFERENCES unidades(id), ativo INTEGER DEFAULT 1, status TEXT DEFAULT 'Ativo',
    fabricante TEXT, modelo TEXT, data_aquisicao TEXT, observacoes TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS numeros_dispositivos (
    id SERIAL PRIMARY KEY, dispositivo_id INTEGER NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
    numero TEXT, observacoes TEXT, criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS custos_chamado (
    id SERIAL PRIMARY KEY, chamado_id INTEGER REFERENCES chamados(id) ON DELETE CASCADE,
    descricao TEXT, tipo TEXT, valor REAL, fornecedor_id INTEGER REFERENCES fornecedores(id),
    criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS orcamentos_chamado (
    id SERIAL PRIMARY KEY, chamado_id INTEGER REFERENCES chamados(id) ON DELETE CASCADE,
    fornecedor_id INTEGER REFERENCES fornecedores(id), descricao TEXT, valor REAL, status TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS compras_mensais (
    id SERIAL PRIMARY KEY, mes INTEGER, ano INTEGER,
    fornecedor_id INTEGER REFERENCES fornecedores(id), item TEXT, objetivo TEXT,
    valor_estimado REAL, status TEXT, criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS impressoras (
    id SERIAL PRIMARY KEY, nome TEXT, usuario_id INTEGER, setor_id INTEGER, local_id INTEGER,
    unidade_id INTEGER NOT NULL REFERENCES unidades(id), ativo INTEGER DEFAULT 1,
    contagem_atual INTEGER DEFAULT 0, fabricante TEXT, modelo TEXT, num_serie TEXT, ip_endereco TEXT, observacoes TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS leituras_mensais (
    id SERIAL PRIMARY KEY, impressora_id INTEGER REFERENCES impressoras(id) ON DELETE CASCADE,
    criado_por INTEGER, contagem INTEGER, observacoes TEXT, criado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS parametros_impressao (
    id SERIAL PRIMARY KEY, chave TEXT, valor TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS notas_fiscais (
    id SERIAL PRIMARY KEY, numero TEXT, fornecedor_id INTEGER REFERENCES fornecedores(id),
    chamado_id INTEGER REFERENCES chamados(id) ON DELETE CASCADE, valor REAL,
    data_emissao TEXT, data_vencimento TEXT, data_pagamento TEXT, status TEXT, observacoes TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS nf_comparativo_mensal (
    id SERIAL PRIMARY KEY, mes INTEGER, ano INTEGER,
    valor_acadweb REAL, valor_prefeitura REAL, observacoes TEXT, criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS permissoes (
    id SERIAL PRIMARY KEY, chave TEXT, descricao TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS grupos (
    id SERIAL PRIMARY KEY, nome TEXT, descricao TEXT, criado_em TEXT, atualizado_em TEXT
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS grupos_permissoes (
    grupo_id INTEGER NOT NULL REFERENCES grupos(id), permissao_id INTEGER NOT NULL REFERENCES permissoes(id),
    PRIMARY KEY (grupo_id, permissao_id)
  )`);
  await db.exec(`CREATE TABLE IF NOT EXISTS usuarios_grupos (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id), grupo_id INTEGER NOT NULL REFERENCES grupos(id),
    PRIMARY KEY (usuario_id, grupo_id)
  )`);

  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chamados_unidade ON chamados(unidade_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chamados_status ON chamados(status)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_chamados_usuario ON chamados(usuario_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_computadores_unidade ON computadores(unidade_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_dispositivos_unidade ON dispositivos(unidade_id)`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_impressoras_unidade ON impressoras(unidade_id)`);

  // Migração: adicionar colunas em tabelas existentes (ignora se já existem)
  for (const sql of [
    `ALTER TABLE computadores ADD COLUMN IF NOT EXISTS fabricante TEXT`,
    `ALTER TABLE computadores ADD COLUMN IF NOT EXISTS num_serie TEXT`,
    `ALTER TABLE computadores ADD COLUMN IF NOT EXISTS observacoes TEXT`,
    `ALTER TABLE computadores ADD COLUMN IF NOT EXISTS processador TEXT`,
    `ALTER TABLE computadores ADD COLUMN IF NOT EXISTS memoria_ram TEXT`,
    `ALTER TABLE computadores ADD COLUMN IF NOT EXISTS armazenamento_tipo TEXT`,
    `ALTER TABLE computadores ADD COLUMN IF NOT EXISTS armazenamento_tamanho TEXT`,
    `ALTER TABLE computadores ADD COLUMN IF NOT EXISTS anydesk_id TEXT`,
    `ALTER TABLE computadores ADD COLUMN IF NOT EXISTS teamviewer_id TEXT`,
    `ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Ativo'`,
    `ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS fabricante TEXT`,
    `ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS modelo TEXT`,
    `ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS data_aquisicao TEXT`,
    `ALTER TABLE dispositivos ADD COLUMN IF NOT EXISTS observacoes TEXT`,
    `ALTER TABLE numeros_dispositivos ADD COLUMN IF NOT EXISTS observacoes TEXT`,
    `ALTER TABLE impressoras ADD COLUMN IF NOT EXISTS fabricante TEXT`,
    `ALTER TABLE impressoras ADD COLUMN IF NOT EXISTS modelo TEXT`,
    `ALTER TABLE impressoras ADD COLUMN IF NOT EXISTS num_serie TEXT`,
    `ALTER TABLE impressoras ADD COLUMN IF NOT EXISTS ip_endereco TEXT`,
    `ALTER TABLE impressoras ADD COLUMN IF NOT EXISTS observacoes TEXT`,
    `ALTER TABLE impressoras ADD COLUMN IF NOT EXISTS tipo TEXT`,
    `ALTER TABLE impressoras ADD COLUMN IF NOT EXISTS mac TEXT`,
    `ALTER TABLE leituras_mensais ADD COLUMN IF NOT EXISTS contagem INTEGER`,
    `ALTER TABLE leituras_mensais ADD COLUMN IF NOT EXISTS observacoes TEXT`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN IF NOT EXISTS estado TEXT`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN IF NOT EXISTS observacoes TEXT`,
    `ALTER TABLE checklists_laboratorio ADD COLUMN IF NOT EXISTS local_nome_snapshot TEXT`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN IF NOT EXISTS tipo TEXT`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN IF NOT EXISTS chave TEXT`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN IF NOT EXISTS bem_id INTEGER`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN IF NOT EXISTS nome_snapshot TEXT`,
    `ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS nome_servico TEXT`,
    `ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS categoria_servico_id INTEGER`,
    `ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS custo REAL`,
    `ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS data_realizada_em TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Ativo'`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS tipo_servico TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS whatsapp TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN IF NOT EXISTS observacoes TEXT`,
    `ALTER TABLE chamados ADD COLUMN IF NOT EXISTS bem_id INTEGER`,
    `ALTER TABLE manutencoes ADD COLUMN IF NOT EXISTS chamado_id INTEGER`
  ]) { try { await db.exec(sql); } catch (_) {} }
}

// ============================================================
// Dados iniciais (seed)
// ============================================================

async function seed() {
  const now = new Date().toISOString();
  const senha_hash = bcrypt.hashSync('Admin123!', 10);

  // Unidades de atendimento iniciais
  await db.prepare(`INSERT INTO unidades (id, nome, cidade, ativo) VALUES (1, 'Parnamirim', 'Parnamirim/RN', 1),
    (2, 'Natal Centro', 'Natal/RN', 1), (3, 'Natal Zona Norte', 'Natal/RN', 1)`).run();
  // Usuário administrador padrão para acesso inicial
  await db.prepare(`INSERT INTO usuarios (id, nome, email, senha_hash, perfil, unidade_id, setor_id, ativo, criado_em)
    VALUES (1, 'Administrador de demonstração', 'admin@local.test', ?, 'admin', NULL, NULL, 1, ?)`).run(senha_hash, now);

  // Ajusta as sequências dos SERIALs para não colidir com os ids explícitos do seed
  await db.exec(`SELECT setval(pg_get_serial_sequence('unidades', 'id'), (SELECT MAX(id) FROM unidades))`);
  await db.exec(`SELECT setval(pg_get_serial_sequence('usuarios', 'id'), (SELECT MAX(id) FROM usuarios))`);

  await seedPermissoes();
}

// Popula as permissões disponíveis (idempotente — só insere as que ainda não existem)
async function seedPermissoes() {
  const permissoes = [
    ['chamados.ver_atribuidos', 'Ver chamados atribuídos a mim'],
    ['chamados.ver_todos_unidade', 'Ver todos os chamados da unidade'],
    ['chamados.ver_proprios', 'Ver os próprios chamados'],
    ['chamados.alterar_status', 'Alterar status de chamados'],
    ['categorias.ver', 'Ver categorias de chamados'],
    ['categorias.criar', 'Criar categorias'],
    ['categorias.editar', 'Editar categorias'],
    ['categorias.excluir', 'Excluir categorias'],
    ['setores.ver', 'Ver setores'],
    ['setores.criar', 'Criar setores'],
    ['setores.editar', 'Editar setores'],
    ['setores.excluir', 'Excluir setores'],
    ['usuarios.ver', 'Ver usuários'],
    ['usuarios.criar', 'Criar usuários'],
    ['usuarios.editar', 'Editar usuários'],
    ['usuarios.excluir', 'Excluir usuários'],
    ['usuarios.gerenciar_permissoes', 'Gerenciar permissões de usuários'],
    ['inventario.ver', 'Ver inventário'],
    ['inventario.atribuir_usuario', 'Atribuir usuário em equipamentos'],
    ['inventario.checklists', 'Gerenciar checklists de laboratório'],
    ['ativos.ver', 'Ver ativos e manutenções'],
    ['ativos.criar', 'Criar ativos'],
    ['ativos.editar', 'Editar ativos'],
    ['ativos.excluir', 'Excluir ativos'],
    ['ativos.manutencoes', 'Gerenciar manutenções'],
    ['ativos.movimentar', 'Movimentar ativos'],
    ['projetores.ver', 'Ver controle de projetores'],
    ['relatorios.ver_dashboard', 'Ver dashboard de relatórios'],
    ['relatorios.ver_tempos', 'Ver relatório de tempos'],
    ['impressoras.ver', 'Ver controle de impressões'],
    ['impressoras.criar', 'Cadastrar impressoras'],
    ['impressoras.editar', 'Editar impressoras'],
    ['impressoras.excluir', 'Excluir impressoras'],
    ['fornecedores.ver', 'Ver fornecedores'],
    ['fornecedores.criar', 'Cadastrar fornecedores'],
    ['fornecedores.editar', 'Editar fornecedores'],
    ['fornecedores.excluir', 'Excluir fornecedores'],
    ['dispositivos.ver', 'Ver dispositivos'],
    ['dispositivos.criar', 'Cadastrar dispositivos'],
    ['dispositivos.editar', 'Editar dispositivos'],
    ['dispositivos.excluir', 'Excluir dispositivos'],
    ['financeiro.ver', 'Ver financeiro'],
    ['financeiro.criar', 'Lançar movimentações financeiras'],
    ['financeiro.aprovar', 'Aprovar movimentações financeiras'],
    ['compras.solicitar', 'Solicitar compras mensais'],
    ['compras.aprovar', 'Aprovar compras mensais'],
    ['notas_fiscais.ver', 'Ver notas fiscais'],
    ['notas_fiscais.criar', 'Cadastrar notas fiscais'],
    ['notas_fiscais.editar', 'Editar notas fiscais'],
    ['notas_fiscais.excluir', 'Excluir notas fiscais'],
    ['nf_comparativo.criar', 'Criar comparativos de notas fiscais'],
    ['nf_comparativo.editar', 'Editar comparativos de notas fiscais'],
    ['nf_comparativo.excluir', 'Excluir comparativos de notas fiscais']
  ];
  const insertPerm = db.prepare('INSERT INTO permissoes (chave, descricao) VALUES (?, ?)');
  const exists = db.prepare('SELECT 1 FROM permissoes WHERE chave = ?');
  for (const [chave, descricao] of permissoes) {
    if (!(await exists.get(chave))) await insertPerm.run(chave, descricao);
  }
}

// Retorna o valor de uma configuração (null se não existir)
async function getConfig(chave) {
  const row = await db.prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
  return row ? row.valor : null;
}

// Salva (ou remove, se valor for null) uma configuração
async function setConfig(chave, valor) {
  if (valor === null || valor === undefined || valor === '') {
    await db.prepare('DELETE FROM config WHERE chave = ?').run(chave);
  } else {
    await db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor').run(chave, String(valor));
  }
}

module.exports = { getDb, initialize, getConfig, setConfig, getConnectionString, pool, database: db };
