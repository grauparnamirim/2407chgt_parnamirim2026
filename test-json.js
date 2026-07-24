const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chgt-json-'));
const port = 33117 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, ['server.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(port), JSON_DATA_PATH: path.join(tempDir, 'local.json') },
  stdio: ['ignore', 'pipe', 'pipe']
});

function request(method, route, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers: {
      ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    } }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data;
        try { data = JSON.parse(raw); } catch (_) { data = raw; }
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Servidor JSON não iniciou.')), 8000);
    server.stdout.on('data', chunk => {
      if (chunk.toString().includes('CHGT HelpDesk JSON disponível')) { clearTimeout(timer); resolve(); }
    });
    server.stderr.on('data', chunk => reject(new Error(chunk.toString())));
    server.on('exit', code => reject(new Error(`Servidor encerrou com código ${code}.`)));
  });

  const unidades = await request('GET', '/api/unidades');
  assert.equal(unidades.status, 200);
  assert.equal(unidades.data.length, 3);

  const logins = [];
  for (const unidade_id of [1, 2, 3]) {
    const login = await request('POST', '/api/login', { email: 'admin@local.test', senha: 'Admin123!', unidade_id });
    assert.equal(login.status, 200);
    assert.equal(login.data.usuario.unidade_id, unidade_id);
    assert.ok(login.data.token);
    logins.push(login);
  }
  const login = logins[1];

  const category = await request('POST', '/api/categorias', { nome: 'Teste local' }, login.data.token);
  assert.equal(category.status, 201);
  const categories = await request('GET', '/api/categorias', undefined, login.data.token);
  assert.equal(categories.status, 200);
  assert.equal(categories.data[0].nome, 'Teste local');

  const createdUser = await request('POST', '/api/usuarios', { nome: 'Técnico local', email: 'tecnico@local.test', senha: 'SenhaLocal123!', perfil: 'tecnico' }, login.data.token);
  assert.equal(createdUser.status, 201);
  const dangerous = await request('PUT', `/api/usuarios/${createdUser.data.id}`, { perfil: 'admin' }, login.data.token);
  assert.equal(dangerous.status, 400);

  const emptyModules = [
    '/api/chamados', '/api/fornecedores', '/api/dispositivos', '/api/setores', '/api/locais',
    '/api/computadores', '/api/ativos', '/api/ativos/mapa-rede', '/api/ativos/manutencoes-agendadas',
    '/api/checklists-laboratorio/preparacao', '/api/manutencoes/categorias-servico',
    '/api/custos-chamado', '/api/orcamentos-chamado', '/api/compras-mensais',
    '/api/impressoras', '/api/leituras', '/api/parametros-impressao',
    '/api/notas-fiscais', '/api/notas-fiscais/estatisticas', '/api/nf-comparativo',
    '/api/relatorios', '/api/relatorios/tempos', '/api/grupos', '/api/permissoes'
  ];
  for (const route of emptyModules) {
    const response = await request('GET', route, undefined, login.data.token);
    assert.equal(response.status, 200, route);
  }
  assert.ok(fs.existsSync(path.join(tempDir, 'local.json')));
  console.log('PASS JSON: login, unidades, CRUD, módulos vazios e proteção de administrador');
}

function cleanup() {
  if (fs.rmSync) fs.rmSync(tempDir, { recursive: true, force: true });
  else fs.rmdirSync(tempDir, { recursive: true });
}

run().then(() => { server.kill(); }).catch(error => { console.error(error.stack || error); server.kill(); process.exitCode = 1; }).finally(() => setTimeout(cleanup, 100));
