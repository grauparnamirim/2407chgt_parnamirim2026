const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createCrudRoutes } = require('./routes/crud');
const { sanitizeInput, autenticarPagina } = require('./middleware');

// Rate limiter global: 30 requisições a cada 15 segundos por IP
// (reduz para limite mais restritivo se o servidor estiver sem resposta)
// RATE_LIMIT_MAX sobrescreve o limite — usado por testes para validar o 429
const apiLimiter = rateLimit({
  windowMs: 15 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || (process.env.TEST ? 9999 : 30),
  standardHeaders: true,
  legacyHeaders: false,
  message: { erro: 'Muitas requisições. Aguarde alguns segundos e tente novamente.' }
});

// Middleware que define tempo limite de 25 segundos para requisições
// Timeout: aborta requisições que demoram mais de 25 segundos
function timeoutMiddleware(req, res, next) {
  res.setTimeout(25000, () => {
    if (!res.headersSent) res.status(503).json({ erro: 'Tempo limite da requisição excedido.' });
    req.destroy();
  });
  next();
}

// Cria e configura a aplicação Express com middlewares, rotas estáticas e de API
function createApp() {
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '7d' }));

  const staticPages = ['painel', 'impressoras', 'fornecedores', 'dispositivos', 'meus-chamados', 'setores', 'categorias', 'financeiro', 'relatorios', 'inventario', 'usuarios', 'notas-fiscais', 'avancado'];
  for (const page of staticPages) {
    app.get(`/${page}`, autenticarPagina, (_, res) => res.sendFile(path.join(__dirname, '..', 'public', `${page}.html`)));
  }

  // Compatibilidade: página antiga "usuario" foi renomeada para "meus-chamados"
  app.get('/usuario', autenticarPagina, (_, res) => res.redirect('/meus-chamados'));

  app.get('/dispositivo/:id', autenticarPagina, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'dispositivo-detalhe.html'));
  });

  // Segurança: rate limit + timeout + sanitize em todas as rotas /api/
  app.use('/api', apiLimiter);
  app.use('/api', timeoutMiddleware);
  app.use('/api', sanitizeInput);

  app.use('/api', require('./routes/auth'));
  app.use('/api', require('./routes/users'));
  app.use('/api', require('./routes/tickets'));
  app.use('/api', require('./routes/devices'));
  app.use('/api', require('./routes/printers'));
  app.use('/api', require('./routes/assets'));
  app.use('/api', require('./routes/misc'));
  app.use('/api', require('./routes/backup'));
  app.use('/api', require('./routes/atualizacoes'));

  app.use('/api', createCrudRoutes({ path: 'categorias', table: 'categorias', fields: ['nome'], message: 'Categoria' }));
  app.use('/api', createCrudRoutes({ path: 'subcategorias', table: 'subcategorias', fields: ['nome', 'categoria_id'], message: 'Subcategoria' }));
  app.use('/api', createCrudRoutes({ path: 'fornecedores', table: 'fornecedores', fields: ['nome', 'cnpj', 'telefone', 'email', 'endereco'], message: 'Fornecedor' }));
  app.use('/api', createCrudRoutes({ path: 'setores', table: 'setores', fields: ['nome'], message: 'Setor' }));
  app.use('/api', createCrudRoutes({ path: 'locais', table: 'locais', fields: ['nome', 'tipo', 'ativo'], unit: true, message: 'Local' }));

  app.use('/api', (_, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  // Error handler com sanitização de erro para não vazar detalhes internos
  app.use((err, _, res, __) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ erro: 'JSON inválido no corpo da requisição.' });
    }
    console.error('Erro interno:', err);
    res.status(500).json({ erro: 'Erro interno do servidor.' });
  });

  return app;
}

module.exports = { createApp };
