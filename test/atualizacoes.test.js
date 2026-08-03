// ============================================================
// TESTES DE ATUALIZAÇÕES
// ============================================================

const assert = require('assert');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { request } = require('./helpers');

// Carrega a config de atualizações do repositório
function getAppConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'app.json'), 'utf8'));
}

// Extrai owner e repo de uma URL do GitHub (mesma lógica do backend)
function parseRepoUrl(url) {
  const m = String(url || '').match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

// Faz requisição HTTPS GET e retorna { statusCode, data }
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'chgt-helpdesk', 'Accept': 'application/vnd.github.v3+json' }, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) {}
        resolve({ statusCode: res.statusCode, data: parsed, raw: data });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ============================================================
// SUITE DE TESTES
// ============================================================

module.exports = async function testAtualizacoes(port) {
  const login = await request(port, 'POST', '/api/login', { email: 'admin@local.test', senha: 'Admin123!', unidade_id: 1 });
  assert.equal(login.status, 200);
  const token = login.data.token;

  // ============================================================
  // 1. CONFIG: VERSÃO E LINK DO REPOSITÓRIO
  // ============================================================

  const cfg = getAppConfig();
  assert.ok(cfg.versao && /^\d+\.\d+\.\d+$/.test(cfg.versao), `versão em config/app.json deve ser semântica (válida): ${cfg.versao}`);
  const repo = parseRepoUrl(cfg.repo_url);
  assert.ok(repo, `repo_url deve ser uma URL válida do GitHub: ${cfg.repo_url}`);
  assert.ok(repo.owner, 'repo_url deve conter owner');
  assert.ok(repo.repo, 'repo_url deve conter repositório');

  // ============================================================
  // 2. ENDPOINT /api/versao
  // ============================================================

  const versao = await request(port, 'GET', '/api/versao', undefined, token);
  assert.equal(versao.status, 200);
  assert.equal(versao.data.versao, cfg.versao, 'API deve retornar a mesma versão da config');

  // ============================================================
  // 3. ENDPOINT /api/atualizacoes/verificar
  // ============================================================

  const check = await request(port, 'GET', '/api/atualizacoes/verificar', undefined, token);
  assert.equal(check.status, 200);

  // Se o GitHub estiver acessível, a API deve retornar dados estruturados
  if (!check.data.erro) {
    assert.ok(typeof check.data.atualizacao_disponivel === 'boolean', 'atualizacao_disponivel deve ser booleano');
    assert.equal(check.data.versao_atual, cfg.versao, 'versao_atual deve bater com a config');
    assert.ok(typeof check.data.versao_nova === 'string' && check.data.versao_nova, 'versao_nova deve ser informada');
    assert.ok(typeof check.data.url_release === 'string' && check.data.url_release, 'url_release deve ser informada');
  }

  // ============================================================
  // 4. GITHUB DIRETO: LINK FUNCIONA E TEM RELEASE?
  // ============================================================

  // Valida o link real do GitHub: o repositório deve existir (HTTP 200)
  // e retornar os dados da release mais recente.
  let gh;
  try {
    gh = await fetchJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`);
  } catch (err) {
    console.log('  • github indisponível (sem internet?) — teste de release pulado');
    return;
  }

  assert.ok(gh.statusCode >= 200 && gh.statusCode < 300,
    `repositório ${repo.owner}/${repo.repo} deve existir no GitHub (status ${gh.statusCode})`);
  assert.ok(gh.data && gh.data.tag_name, 'release mais recente deve ter tag_name');
  assert.ok(/^\d+\.\d+\.\d+/.test(gh.data.tag_name.replace(/^v/, '')), `tag de release deve ser semântica: ${gh.data.tag_name}`);
  assert.ok(typeof gh.data.html_url === 'string' && /github\.com\//.test(gh.data.html_url), 'release deve ter url pública do GitHub');

  console.log('  ✓ atualizacoes: config, /api/versao, /verificar, link e release do GitHub');
};
