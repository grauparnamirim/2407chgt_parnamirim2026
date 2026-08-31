# CHGT HelpDesk

Sistema de helpdesk executado localmente para gerenciamento de chamados, inventário de equipamentos, impressoras, dispositivos e fluxos financeiros da Central de HelpDesk Grau Técnico — unidades Parnamirim/RN, Natal Centro e Natal Zona Norte.

A aplicação roda somente no computador onde é instalada. Usa **PostgreSQL** como banco de dados — os dados ficam armazenados localmente (ou em um container) e não dependem de serviços em nuvem. Em produção simples, o PostgreSQL roda no próprio equipamento via Docker.

---

## Sumário

- [Funcionalidades](#funcionalidades)
- [Stack Tecnológica](#stack-tecnológica)
- [Requisitos](#requisitos)
- [Instalação e Execução](#instalação-e-execução)
- [Acesso de Demonstração](#acesso-de-demonstração)
- [Estrutura do Projeto](#estrutura-do-projeto)
- [Banco de Dados](#banco-de-dados)
- [Autenticação e Segurança](#autenticação-e-segurança)
- [API — Endpoints](#api--endpoints)
- [Backup, Atualizações e DNS](#backup-atualizações-e-dns)
- [Temas](#temas)
- [Testes](#testes)
- [Boas Práticas Adotadas](#boas-práticas-adotadas)

---

## Funcionalidades

- **Chamados** — abertura, acompanhamento por status (Aberto, Em andamento, Aguardando Fornecedor, Resolvido), atribuição de técnico, comentários e medição de tempo de resposta.
- **Inventário** — cadastro de bens patrimoniais com patrimônio auto-gerado, tipos (gabinete, monitor, projetor, caixa de som, fones, outros), QR Code para identificação, movimentações e manutenções.
- **Impressoras** — cadastro de impressoras, leituras mensais de contadores, relatório consolidado.
- **Dispositivos** — aparelhos com vínculo de números de telefone.
- **Financeiro** — custos e orçamentos por chamado, compras mensais, notas fiscais e comparativo mensal.
- **Usuários e Permissões** — perfis (admin, gestor, tecnico, usuario), grupos de permissão personalizados e controle de acesso por unidade.
- **Relatórios** — métricas de tempo de atendimento, taxa de resolução, desempenho por técnico e indicadores financeiros.
- **Backup** — criação, listagem, download e exclusão de backups do banco de dados (somente administrador).
- **Atualizações** — verificação de novas versões no GitHub e download do pacote de atualização (somente administrador).
- **Servidor DNS local** — resolve `chgt.helpdesk.local` para o IP do hospedeiro, permitindo acesso pela rede por nome de domínio.
- **Pesquisa Global** — busca rápida por chamados e bens patrimoniais (Ctrl+K).
- **Temas visuais** — 4 temas selecionáveis (Técnico, Escuro, Faculdade, Profissionalizante).

---

## Stack Tecnológica

| Camada | Tecnologia |
| --- | --- |
| Backend | Node.js, Express 4, `pg` (PostgreSQL) |
| Autenticação | JWT (jsonwebtoken) + bcrypt |
| Segurança | Helmet, express-rate-limit, sanitização de entrada |
| Frontend | HTML5, CSS3 e JavaScript puro (sem frameworks) |
| Ícones | Iconify (CDN) |
| QR Code | qrcode-generator (Kazuhiko Arase) — geração 100% no navegador |
| Banco de dados | PostgreSQL 16 (via Docker) |
| Testes | Node.js nativo com `http` (sem jest/mocha) |

---

## Requisitos

- **Node.js 18 ou superior** (testado na v22)
- Windows, Linux ou macOS
- Acesso de leitura/escrita no diretório do projeto

---

## Instalação e Execução

### Opção A — Docker (recomendada)

```bash
# 1. Instalar as dependências (apenas para desenvolvimento fora do container)
npm install

# 2. Subir PostgreSQL + aplicação com Docker Compose
npm run docker:up
```

Isso sobe um container `db` (PostgreSQL 16) e o `app`. O app aguarda o PostgreSQL ficar saudável antes de criar o schema e os dados iniciais. Para encerrar: `npm run docker:down`.

### Opção B — PostgreSQL local + Node

```bash
# 1. Criar o banco de dados PostgreSQL (ex.: via psql)
createdb chgt_helpdesk

# 2. Definir as variáveis de ambiente (ver .env.example)
export PGUSER=postgres PGPASSWORD=postgres PGDATABASE=chgt_helpdesk PGHOST=localhost PGPORT=5432

# 3. Instalar dependências e iniciar
npm install
npm start
```

Abra o navegador em `http://127.0.0.1:3000` ou, pela rede local, no IP da máquina (ex.: `http://10.2.200.155:3000`).

> O servidor escuta no **IP do hospedeiro** (detectado dinamicamente), permitindo que outros computadores da rede acessem o sistema. Para usar o nome `chgt.helpdesk.local` no navegador, use o servidor DNS integrado:

```bash
# Sobe o sistema e o servidor DNS local juntos (app + DNS)
npm run start:all
```

Com o DNS rodando, qualquer PC da rede com DNS apontado para o IP do hospedeiro acessa o sistema em `http://chgt.helpdesk.local:3000`.

### Reset dos dados

Para apagar o schema e recomeçar com dados limpos (recriado na próxima inicialização):

```bash
npm run reset-local-data
```

> Este comando remove e recria o schema `public` do banco configurado pelas variáveis de ambiente. Ele não afeta outros schemas ou bancos.

---

## Acesso de Demonstração

| E-mail | Senha |
| --- | --- |
| `admin@local.test` | `Admin123!` |

No login, escolha a unidade pertecente : **Parnamirim/RN**, **Natal Centro** ou **Natal Zona Norte**.

> Esta é uma conta pública de demonstração. **Não a utilize em produção** — após criar um administrador próprio, edite ou exclua esta conta no módulo **Usuários** (o sistema impede excluir o único administrador ativo , so podendo ser alterado por outro admin).

---

## Estrutura do Projeto

```
2407chgt_parnamirim2026/
├── config/
│   ├── app.json              # Versão do sistema e repositório GitHub
│   └── dns.json              # Configuração do servidor DNS local
├── src/
│   ├── index.js              # Ponto de entrada: inicializa banco e sobe o servidor
│   ├── app.js                # Aplicação Express, rotas estáticas e /api/*
│   ├── db.js                 # Conexão SQLite, schema, migrações e dados iniciais
│   ├── middleware.js          # JWT, permissões, sanitização e proteção de páginas
│   ├── dns-server.js         # Servidor DNS local (resolve chgt.helpdesk.local)
│   └── routes/
│       ├── auth.js           # Login, logout e listagem de unidades
│       ├── users.js          # CRUD de usuários e troca de unidade/senha
│       ├── tickets.js        # Chamados e comentários
│       ├── assets.js         # Inventário: bens, movimentações, manutenções e indicadores
│       ├── devices.js        # Dispositivos e números de telefone
│       ├── printers.js       # Impressoras e leituras mensais
│       ├── misc.js           # Financeiro, notas fiscais, relatórios, grupos e pesquisa
│       ├── backup.js         # Backup e restauração do banco (admin)
│       ├── atualizacoes.js   # Versão, verificação e download de atualizações (admin)
│       └── crud.js           # Gerador de CRUD genérico (categorias, setores, locais...)
├── public/
│   ├── app.js                # Frontend: estado global, API, sidebar, modais e temas
│   ├── style.css             # Estilos completos com 4 temas
│   ├── index.html            # Tela de login
│   ├── painel.html           # Dashboard e chamados
│   ├── inventario.html       # Inventário de equipamentos com QR Code
│   ├── avancado.html         # Backup e atualizações (admin)
│   ├── ...                   # Demais páginas do sistema
│   ├── js/qrcode.min.js      # Biblioteca de geração de QR Code
│   └── midia/                # Imagens e logotipos
├── start.js                  # Launcher unificado: sobe sistema + DNS (start:all)
├── test/
│   ├── run.js                # Orquestrador: sobe servidor de teste e executa as suites
│   ├── helpers.js            # startServer, waitForServer e cliente HTTP
│   ├── helpdesk.test.js      # Login, unidades e CRUD básico
│   ├── crud.test.js          # CRUD de todas as entidades
│   ├── security.test.js      # SQL injection, XSS, validação, acesso, rate limit e erros
│   └── atualizacoes.test.js  # Config, /api/versao, verificação, link e release do GitHub
├── backups/                  # Backups gerados pela aplicação (ignorado pelo Git)
├── data/                     # Banco SQLite local (ignorado pelo Git)
├── package.json
└── README.md
```

---

## Banco de Dados

O banco é um **PostgreSQL** acessado via variáveis de ambiente (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`), criado automaticamente na primeira execução. As três unidades fictícias e a conta de administrador de demonstração são semeadas nesse momento.

Características:

- **Conexão via `pg`** (`Pool`) — o app aguarda o PostgreSQL ficar disponível (retry de até 30s) antes de criar o schema.
- **Foreign keys** — integridade referencial garantida pelo PostgreSQL (`ON DELETE CASCADE`).
- **Migrações automáticas** — colunas novas são adicionadas em tabelas existentes via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, sem exigir intervenção manual.
- **Backups** — o endpoint de backup gera um `pg_dump` (arquivo `.sql`) no diretório `backups/`.

### Principais tabelas

| Tabela | Finalidade |
| --- | --- |
| `unidades` | Unidades de atendimento (Parnamirim, Natal Centro, Natal Zona Norte) |
| `usuarios` | Usuários do sistema (admin, gestor, tecnico, usuario) |
| `chamados`, `comentarios` | Chamados de suporte e seus comentários |
| `categorias`, `subcategorias`, `setores`, `locais`, `fornecedores` | Cadastros base |
| `computadores` | Bens patrimoniais do inventário (tipo, modelo, série, especificações, etc.) |
| `movimentacoes_bens` | Histórico de movimentações de bens |
| `manutencoes` | Manutenções agendadas/concluídas de equipamentos |
| `categorias_servico_manutencao` | Categorias de serviços de manutenção |
| `dispositivos`, `numeros_dispositivos` | Dispositivos e números de telefone vinculados |
| `impressoras`, `leituras_mensais` | Impressoras e leituras de contador |
| `custos_chamado`, `orcamentos_chamado`, `compras_mensais` | Financeiro |
| `notas_fiscais`, `nf_comparativo_mensal` | Notas fiscais e comparativo mensal |
| `permissoes`, `grupos`, `grupos_permissoes`, `usuarios_grupos` | Controle de acesso (RBAC) |

---

## Autenticação e Segurança

- **Senhas** — armazenadas com **bcrypt** (nunca em texto puro). O hash nunca é exposto na API.
- **JWT** — token com expiração de **8 horas**. O segredo (`JWT_SECRET`) pode ser definido via variável de ambiente; sem ele, um segredo aleatório é gerado a cada inicialização (o que invalida sessões antigas ao reiniciar).
- **Cookie httpOnly** — as páginas HTML usam um cookie `token` com `httpOnly` e `sameSite: strict` para proteger contra acesso via JavaScript (XSS).
- **Header Authorization** — as chamadas de API usam `Authorization: Bearer <token>`.
- **Rate limit** — 30 requisições por 15 segundos por IP nas rotas `/api/*`; 20 tentativas de login por 15 minutos.
- **Sanitização** — strings com `<` e `>` são higienizadas e campos acima de 10.000 caracteres são rejeitados.
- **SQL injection** — nomes de tabelas e colunas passam por whitelist (`validTable`, `validColumns`).
- **Controle de acesso** — perfis, grupos de permissão e escopo por unidade via `requireRole`, `requirePermission` e `unitScope`.
- **Logout automático** — o frontend detecta respostas `401` e tokens expirados e encerra a sessão.

---

## API — Endpoints

Todas as rotas abaixo são prefixadas com `/api`.

### Autenticação

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/login` | Autentica com email + senha + unidade e retorna token e usuário |
| `POST` | `/logout` | Encerra a sessão e limpa o cookie |
| `GET` | `/unidades` | Lista unidades ativas (pública, usada no login) |

### Usuários

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET/POST` | `/usuarios` | Listar/criar usuários |
| `PUT/DELETE` | `/usuarios/:id` | Atualizar/excluir usuário |
| `PUT` | `/usuarios/:id/senha` | Alterar senha |
| `PUT` | `/usuarios/:id/unidade` | Alterar unidade do usuário |

### Chamados

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET/POST` | `/chamados` | Listar (com filtros) e criar chamados |
| `PUT` | `/chamados/:id` | Atualizar chamado |
| `GET/POST` | `/chamados/:id/comentarios` | Listar/adicionar comentários |
| `GET` | `/chamados/:id/tempos` | Tempo de resposta do chamado |
| `PUT` | `/chamados/:id/status` | Alterar status com notificação |
| `PUT` | `/chamados/:id/motivo` | Registrar motivo de resolução |

### Inventário

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET/POST` | `/ativos` | Listar/criar bens patrimoniais |
| `PUT/DELETE` | `/ativos/:id` | Atualizar/excluir bem |
| `GET/POST` | `/ativos/:id/movimentacoes` | Movimentações do bem |
| `GET/POST` | `/ativos/:id/manutencoes` | Listar/agendar manutenções |
| `PUT` | `/ativos/:id/manutencoes/:mid` | Atualizar manutenção |
| `GET` | `/ativos/indicadores-manutencao` | Resumo, série mensal e bens recorrentes |

### Dispositivos

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET/POST` | `/dispositivos` | Listar/criar dispositivos |
| `PUT/DELETE` | `/dispositivos/:id` | Atualizar/excluir dispositivo |
| `GET/POST/PUT/DELETE` | `/dispositivos/:id/numeros[/:nid]` | Gerenciar números de telefone |
| `GET` | `/dispositivos/relatorio` | Relatório consolidado |

### Impressoras

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET/POST` | `/impressoras` | Listar/criar impressoras |
| `PUT/DELETE` | `/impressoras/:id` | Atualizar/excluir impressora |
| `GET/POST` | `/impressoras/:id/leituras` | Leituras mensais |
| `DELETE` | `/impressoras/:id/leituras/:lid` | Excluir leitura |
| `GET` | `/impressoras/relatorio` | Relatório consolidado |

### Financeiro, Notas e Relatórios

| Método | Rota | Descrição |
| --- | --- | --- |
| `CRUD` | `/custos-chamado`, `/orcamentos-chamado`, `/compras-mensais` | Financeiro por chamado |
| `PUT` | `/orcamentos-chamado/:id/aprovar` e `/rejeitar` | Aprovar/rejeitar orçamento |
| `CRUD` | `/notas-fiscais` | Notas fiscais |
| `GET` | `/notas-fiscais/estatisticas` | Estatísticas de notas |
| `GET` | `/relatorios`, `/relatorios/tempos`, `/relatorios/financeiros` | Relatórios |

### Grupos e Permissões

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/permissoes` | Lista permissões disponíveis |
| `CRUD` | `/grupos` | Grupos de permissão |
| `PUT` | `/grupos/:id/permissoes` | Vincular permissões ao grupo |
| `GET/PUT` | `/usuarios/:id/grupos` | Vincular grupos a um usuário |

### Pesquisa

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/pesquisa?q=...` | Busca chamados e bens patrimoniais |

### CRUD Genérico

`GET`, `POST`, `PUT` e `DELETE` em: `/categorias`, `/subcategorias`, `/fornecedores`, `/setores` e `/locais`.

---

## Backup, Atualizações e DNS

### Backup (somente administrador)

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/backup` | Cria um backup do banco em `backups/local-AAAA-MM-DD-HHMMSS.db` |
| `GET` | `/backups` | Lista backups (nome, tamanho e data) |
| `GET` | `/backups/:nome/download` | Baixa o arquivo do backup |
| `DELETE` | `/backups/:nome` | Exclui um backup |

> Antes de copiar, a aplicação executa `wal_checkpoint(TRUNCATE)` para garantir consistência sem fechar o banco. A página **Avançado** (`/avancado`) permite gerenciar tudo isso pelo navegador.

### Atualizações (somente administrador)

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/versao` | Versão atual do sistema (exibida no rodapé da sidebar) |
| `GET` | `/atualizacoes/verificar` | Consulta o GitHub Releases e compara versões |
| `POST` | `/atualizacoes/baixar` | Baixa o pacote da nova versão para `backups/` |

A versão atual e a URL do repositório são configuradas em `config/app.json`. A interface fica na página **Avançado**, com botões "Verificar atualizações" e "Baixar atualização". Em caso de erro, o usuário recebe mensagens amigáveis — os detalhes técnicos ficam apenas no log do servidor.

### Servidor DNS local

| Comando | Descrição |
| --- | --- |
| `npm run dns` | Inicia o servidor DNS (porta 53) |
| `npm run dns:dev` | Inicia com recarga automática (nodemon) |
| `npm run start:all` | Sobe o sistema e o DNS juntos |

O DNS resolve `chgt.helpdesk.local` para o IP do hospedeiro. Se a porta 53 estiver ocupada no `0.0.0.0` (ex.: ICS do Windows), ele detecta automaticamente o IP da interface física e vincula nela. A configuração fica em `config/dns.json` (porta, TTL, rate limit e domínios).

> No Windows a porta baixa (53) não exige privilégio especial, mas em Linux pode ser necessário rodar como `root`/`sudo`.

---

## Temas

O sistema oferece 4 temas selecionáveis, salvos no `localStorage`:

| Tema | Cor principal |
| --- | --- |
| Técnico (padrão) | Verde `#43B307` |
| Escuro | Verde sobre fundo escuro |
| Faculdade | Laranja `#E67E22` |
| Profissionalizante | Azul `#2563EB` |

---

## Testes

```bash
npm test
```

A suíte executa **20 testes** em 4 arquivos:

- **helpdesk** — login, listagem de unidades, CRUD básico e módulos vazios.
- **crud** — operações completas de todas as entidades.
- **security** — SQL injection, XSS, validação de entrada, controle de acesso, rate limit (HTTP 429) e erros de atualização sem vazar detalhes técnicos.
- **atualizacoes** — validação da config (versão e link do GitHub), `/api/versao`, verificação de atualizações e consulta real à release do GitHub.

Os testes sobem um servidor em porta aleatória com **banco de teste** (`chgt_helpdesk_test`, via variáveis de ambiente) e não modificam o banco de produção. É necessário criar esse banco previamente:

```bash
createdb chgt_helpdesk_test
```

> Requer um PostgreSQL em execução e as variáveis `PG*` apontando para ele.

---

## Boas Práticas Adotadas

- **Sem `dados_json`** — todos os campos em colunas diretas do banco (consultas mais simples e tipadas).
- **QR Code em texto plano** — o QR do patrimônio carrega os dados como texto (não URL), funcionando em qualquer leitor, inclusive na câmera nativa do Android.
- **Patrimônio auto-gerado** — sigla da unidade + 8 caracteres hexadecimais aleatórios, com garantia de unicidade.
- **Cache de 7 dias** para assets estáticos.
- **Modais com confirmação** — inclusive no logout, evitando cliques acidentais.
- **Sanitização no servidor** — proteção adicional mesmo que o frontend seja burlado.
