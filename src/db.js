// Módulo de banco de dados SQLite — configuração, schema e dados iniciais
const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'local.db');
let db;

// ============================================================
// Configuração do banco de dados
// ============================================================

// Retorna a instância do banco (lança erro se não foi inicializado)
function getDb() {
  if (!db) throw new Error('Database not initialized');
  return db;
}

// Abre o banco SQLite, ativa WAL e chaves estrangeiras, cria schema e popula dados iniciais
function initialize() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  schema();
  if (db.prepare("SELECT COUNT(*) AS c FROM unidades").get().c === 0) seed();
  seedPermissoes();
  return db;
}

// ============================================================
// Criação das tabelas (schema)
// ============================================================

function schema() {
  // Unidades de atendimento
  db.exec(`CREATE TABLE IF NOT EXISTS unidades (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, cidade TEXT, ativo INTEGER DEFAULT 1
  )`);
  // Configurações do sistema (chave-valor)
  db.exec(`CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY, valor TEXT
  )`);
  // Setores dos usuários
  db.exec(`CREATE TABLE IF NOT EXISTS setores (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, criado_em TEXT, atualizado_em TEXT
  )`);
  // Usuários do sistema
  db.exec(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL, perfil TEXT NOT NULL DEFAULT 'usuario',
    unidade_id INTEGER REFERENCES unidades(id), setor_id INTEGER REFERENCES setores(id),
    ativo INTEGER DEFAULT 1, criado_em TEXT, atualizado_em TEXT
  )`);
  // Categorias de chamados
  db.exec(`CREATE TABLE IF NOT EXISTS categorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, criado_em TEXT, atualizado_em TEXT
  )`);
  // Subcategorias vinculadas a categorias
  db.exec(`CREATE TABLE IF NOT EXISTS subcategorias (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, categoria_id INTEGER NOT NULL REFERENCES categorias(id), criado_em TEXT, atualizado_em TEXT
  )`);
  // Fornecedores parceiros
  db.exec(`CREATE TABLE IF NOT EXISTS fornecedores (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, cnpj TEXT, telefone TEXT, email TEXT, endereco TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  // Locais físicos dentro das unidades
  db.exec(`CREATE TABLE IF NOT EXISTS locais (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT, ativo INTEGER DEFAULT 1,
    unidade_id INTEGER REFERENCES unidades(id), criado_em TEXT, atualizado_em TEXT
  )`);
  // Chamados de suporte técnico
  db.exec(`CREATE TABLE IF NOT EXISTS chamados (
    id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL, descricao TEXT,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id), tecnico_id INTEGER REFERENCES usuarios(id),
    unidade_id INTEGER NOT NULL REFERENCES unidades(id), subcategoria_id INTEGER REFERENCES subcategorias(id),
    local_id INTEGER REFERENCES locais(id), status TEXT DEFAULT 'Aberto', motivo TEXT,
    fornecedor_id INTEGER REFERENCES fornecedores(id), criado_em TEXT, atualizado_em TEXT
  )`);
  // Comentários nos chamados
  db.exec(`CREATE TABLE IF NOT EXISTS comentarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT, chamado_id INTEGER NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id), texto TEXT NOT NULL, criado_em TEXT
  )`);
  // Log de notificações enviadas
  db.exec(`CREATE TABLE IF NOT EXISTS notificacoes_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, chamado_id INTEGER NOT NULL REFERENCES chamados(id) ON DELETE CASCADE,
    usuario_id INTEGER, alterado_por INTEGER, status_anterior TEXT, status_novo TEXT, enviada_em TEXT
  )`);
  // Patrimônio de computadores
  db.exec(`CREATE TABLE IF NOT EXISTS computadores (
    id INTEGER PRIMARY KEY AUTOINCREMENT, patrimonio TEXT, modelo TEXT, ip TEXT, ip_endereco TEXT,
    usuario_id INTEGER REFERENCES usuarios(id), local_id INTEGER REFERENCES locais(id),
    setor_id INTEGER REFERENCES setores(id),
    unidade_id INTEGER NOT NULL REFERENCES unidades(id), tipo TEXT DEFAULT 'computador',
    status TEXT DEFAULT 'Ativo',
    fabricante TEXT, num_serie TEXT, observacoes TEXT,
    processador TEXT, memoria_ram TEXT, armazenamento_tipo TEXT, armazenamento_tamanho TEXT,
    anydesk_id TEXT, teamviewer_id TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  // Movimentações de bens patrimoniais
  db.exec(`CREATE TABLE IF NOT EXISTS movimentacoes_bens (
    id INTEGER PRIMARY KEY AUTOINCREMENT, bem_id INTEGER NOT NULL REFERENCES computadores(id) ON DELETE CASCADE,
    local_origem_id INTEGER, local_destino_id INTEGER,
    usuario_responsavel_id INTEGER, observacao TEXT, criado_em TEXT
  )`);
  // Manutenções de equipamentos
  db.exec(`CREATE TABLE IF NOT EXISTS manutencoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, bem_id INTEGER NOT NULL REFERENCES computadores(id) ON DELETE CASCADE,
    tipo TEXT, categoria_servico_id INTEGER REFERENCES categorias_servico_manutencao(id),
    nome_servico TEXT, descricao TEXT, data_prevista TEXT, data_realizada_em TEXT,
    status TEXT DEFAULT 'agendada', tecnico_responsavel_id INTEGER, custo REAL,
    criado_em TEXT, atualizado_em TEXT
  )`);
  // Categorias de serviços de manutenção
  db.exec(`CREATE TABLE IF NOT EXISTS categorias_servico_manutencao (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, criado_em TEXT, atualizado_em TEXT
  )`);
  // Checklists de laboratório
  db.exec(`CREATE TABLE IF NOT EXISTS checklists_laboratorio (
    id INTEGER PRIMARY KEY AUTOINCREMENT, local_id INTEGER, unidade_id INTEGER,
    turno TEXT, observacoes TEXT, usuario_id INTEGER, criado_em TEXT
  )`);
  // Itens do checklist de laboratório
  db.exec(`CREATE TABLE IF NOT EXISTS checklist_laboratorio_itens (
    id INTEGER PRIMARY KEY AUTOINCREMENT, checklist_id INTEGER NOT NULL REFERENCES checklists_laboratorio(id) ON DELETE CASCADE,
    estado TEXT, observacoes TEXT
  )`);
  // Dispositivos de rede e periféricos
  db.exec(`CREATE TABLE IF NOT EXISTS dispositivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, usuario_id INTEGER, setor_id INTEGER, local_id INTEGER,
    unidade_id INTEGER NOT NULL REFERENCES unidades(id), ativo INTEGER DEFAULT 1, status TEXT DEFAULT 'Ativo',
    fabricante TEXT, modelo TEXT, data_aquisicao TEXT, observacoes TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  // Números de série/patrimônio dos dispositivos
  db.exec(`CREATE TABLE IF NOT EXISTS numeros_dispositivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, dispositivo_id INTEGER NOT NULL REFERENCES dispositivos(id) ON DELETE CASCADE,
    numero TEXT, observacoes TEXT, criado_em TEXT, atualizado_em TEXT
  )`);
  // Custos associados a chamados
  db.exec(`CREATE TABLE IF NOT EXISTS custos_chamado (
    id INTEGER PRIMARY KEY AUTOINCREMENT, chamado_id INTEGER REFERENCES chamados(id) ON DELETE CASCADE,
    descricao TEXT, tipo TEXT, valor REAL, fornecedor_id INTEGER REFERENCES fornecedores(id),
    criado_em TEXT, atualizado_em TEXT
  )`);
  // Orçamentos para chamados
  db.exec(`CREATE TABLE IF NOT EXISTS orcamentos_chamado (
    id INTEGER PRIMARY KEY AUTOINCREMENT, chamado_id INTEGER REFERENCES chamados(id) ON DELETE CASCADE,
    fornecedor_id INTEGER REFERENCES fornecedores(id), descricao TEXT, valor REAL, status TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  // Compras mensais planejadas
  db.exec(`CREATE TABLE IF NOT EXISTS compras_mensais (
    id INTEGER PRIMARY KEY AUTOINCREMENT, mes INTEGER, ano INTEGER,
    fornecedor_id INTEGER REFERENCES fornecedores(id), item TEXT, objetivo TEXT,
    valor_estimado REAL, status TEXT, criado_em TEXT, atualizado_em TEXT
  )`);
  // Impressoras cadastradas
  db.exec(`CREATE TABLE IF NOT EXISTS impressoras (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, usuario_id INTEGER, setor_id INTEGER, local_id INTEGER,
    unidade_id INTEGER NOT NULL REFERENCES unidades(id), ativo INTEGER DEFAULT 1,
    contagem_atual INTEGER DEFAULT 0, fabricante TEXT, modelo TEXT, num_serie TEXT, ip_endereco TEXT, observacoes TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  // Leituras mensais de contadores de impressoras
  db.exec(`CREATE TABLE IF NOT EXISTS leituras_mensais (
    id INTEGER PRIMARY KEY AUTOINCREMENT, impressora_id INTEGER REFERENCES impressoras(id) ON DELETE CASCADE,
    criado_por INTEGER, contagem INTEGER, observacoes TEXT, criado_em TEXT
  )`);
  // Parâmetros de configuração de impressão
  db.exec(`CREATE TABLE IF NOT EXISTS parametros_impressao (
    id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT, valor TEXT
  )`);
  // Notas fiscais
  db.exec(`CREATE TABLE IF NOT EXISTS notas_fiscais (
    id INTEGER PRIMARY KEY AUTOINCREMENT, numero TEXT, fornecedor_id INTEGER REFERENCES fornecedores(id),
    chamado_id INTEGER REFERENCES chamados(id) ON DELETE CASCADE, valor REAL,
    data_emissao TEXT, data_vencimento TEXT, data_pagamento TEXT, status TEXT, observacoes TEXT,
    criado_em TEXT, atualizado_em TEXT
  )`);
  // Comparativo mensal de notas fiscais
  db.exec(`CREATE TABLE IF NOT EXISTS nf_comparativo_mensal (
    id INTEGER PRIMARY KEY AUTOINCREMENT, mes INTEGER, ano INTEGER,
    valor_acadweb REAL, valor_prefeitura REAL, observacoes TEXT, criado_em TEXT, atualizado_em TEXT
  )`);
  // Permissões do sistema
  db.exec(`CREATE TABLE IF NOT EXISTS permissoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT, descricao TEXT
  )`);
  // Grupos de usuários
  db.exec(`CREATE TABLE IF NOT EXISTS grupos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT, descricao TEXT, criado_em TEXT, atualizado_em TEXT
  )`);
  // Associação grupos-permissões
  db.exec(`CREATE TABLE IF NOT EXISTS grupos_permissoes (
    grupo_id INTEGER NOT NULL REFERENCES grupos(id), permissao_id INTEGER NOT NULL REFERENCES permissoes(id),
    PRIMARY KEY (grupo_id, permissao_id)
  )`);
  // Associação usuários-grupos
  db.exec(`CREATE TABLE IF NOT EXISTS usuarios_grupos (
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id), grupo_id INTEGER NOT NULL REFERENCES grupos(id),
    PRIMARY KEY (usuario_id, grupo_id)
  )`);
  // Índices para consultas frequentes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chamados_unidade ON chamados(unidade_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chamados_status ON chamados(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chamados_usuario ON chamados(usuario_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_computadores_unidade ON computadores(unidade_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dispositivos_unidade ON dispositivos(unidade_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_impressoras_unidade ON impressoras(unidade_id)`);

  // Migração: adicionar colunas em tabelas existentes (ignora se já existem)
  for (const sql of [
    `ALTER TABLE computadores ADD COLUMN fabricante TEXT`,
    `ALTER TABLE computadores ADD COLUMN num_serie TEXT`,
    `ALTER TABLE computadores ADD COLUMN observacoes TEXT`,
    `ALTER TABLE computadores ADD COLUMN processador TEXT`,
    `ALTER TABLE computadores ADD COLUMN memoria_ram TEXT`,
    `ALTER TABLE computadores ADD COLUMN armazenamento_tipo TEXT`,
    `ALTER TABLE computadores ADD COLUMN armazenamento_tamanho TEXT`,
    `ALTER TABLE computadores ADD COLUMN anydesk_id TEXT`,
    `ALTER TABLE computadores ADD COLUMN teamviewer_id TEXT`,
    `ALTER TABLE dispositivos ADD COLUMN status TEXT DEFAULT 'Ativo'`,
    `ALTER TABLE dispositivos ADD COLUMN fabricante TEXT`,
    `ALTER TABLE dispositivos ADD COLUMN modelo TEXT`,
    `ALTER TABLE dispositivos ADD COLUMN data_aquisicao TEXT`,
    `ALTER TABLE dispositivos ADD COLUMN observacoes TEXT`,
    `ALTER TABLE numeros_dispositivos ADD COLUMN observacoes TEXT`,
    `ALTER TABLE impressoras ADD COLUMN fabricante TEXT`,
    `ALTER TABLE impressoras ADD COLUMN modelo TEXT`,
    `ALTER TABLE impressoras ADD COLUMN num_serie TEXT`,
    `ALTER TABLE impressoras ADD COLUMN ip_endereco TEXT`,
    `ALTER TABLE impressoras ADD COLUMN observacoes TEXT`,
    `ALTER TABLE leituras_mensais ADD COLUMN contagem INTEGER`,
    `ALTER TABLE leituras_mensais ADD COLUMN observacoes TEXT`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN estado TEXT`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN observacoes TEXT`,
    `ALTER TABLE checklists_laboratorio ADD COLUMN local_nome_snapshot TEXT`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN tipo TEXT`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN chave TEXT`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN bem_id INTEGER`,
    `ALTER TABLE checklist_laboratorio_itens ADD COLUMN nome_snapshot TEXT`,
    `ALTER TABLE manutencoes ADD COLUMN nome_servico TEXT`,
    `ALTER TABLE manutencoes ADD COLUMN categoria_servico_id INTEGER`,
    `ALTER TABLE manutencoes ADD COLUMN custo REAL`,
    `ALTER TABLE manutencoes ADD COLUMN data_realizada_em TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN status TEXT DEFAULT 'Ativo'`,
    `ALTER TABLE fornecedores ADD COLUMN tipo_servico TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN whatsapp TEXT`,
    `ALTER TABLE fornecedores ADD COLUMN observacoes TEXT`,
    `ALTER TABLE chamados ADD COLUMN bem_id INTEGER`,
    `ALTER TABLE manutencoes ADD COLUMN chamado_id INTEGER`
  ]) { try { db.exec(sql); } catch (_) {} }
}

// ============================================================
// Dados iniciais (seed)
// ============================================================

function seed() {
  const now = new Date().toISOString();
  const senha_hash = bcrypt.hashSync('Admin123!', 10);

  // Unidades de atendimento iniciais
  db.prepare(`INSERT INTO unidades (id, nome, cidade, ativo) VALUES (1, 'Parnamirim', 'Parnamirim/RN', 1),
    (2, 'Natal Centro', 'Natal/RN', 1), (3, 'Natal Zona Norte', 'Natal/RN', 1)`).run();
  // Usuário administrador padrão para acesso inicial
  db.prepare(`INSERT INTO usuarios (id, nome, email, senha_hash, perfil, unidade_id, setor_id, ativo, criado_em)
    VALUES (1, 'Administrador de demonstração', 'admin@local.test', ?, 'admin', NULL, NULL, 1, ?)`).run(senha_hash, now);

  // Permissões disponíveis para os grupos de usuários
  seedPermissoes();
}

// Popula as permissões disponíveis (idempotente — só insere as que ainda não existem)
function seedPermissoes() {
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
  permissoes.forEach(([chave, descricao]) => {
    if (!exists.get(chave)) insertPerm.run(chave, descricao);
  });
}

// Retorna o valor de uma configuração (null se não existir)
function getConfig(chave) {
  const row = getDb().prepare('SELECT valor FROM config WHERE chave = ?').get(chave);
  return row ? row.valor : null;
}

// Salva (ou remove, se valor for null) uma configuração
function setConfig(chave, valor) {
  const db = getDb();
  if (valor === null || valor === undefined || valor === '') {
    db.prepare('DELETE FROM config WHERE chave = ?').run(chave);
  } else {
    db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, String(valor));
  }
}

module.exports = { getDb, initialize, DB_PATH, getConfig, setConfig };
