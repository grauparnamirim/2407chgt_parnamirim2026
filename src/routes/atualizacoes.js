// Módulo de atualizações — verifica versão no GitHub e baixa ZIP
const { Router } = require('express');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { autenticar, admin } = require('../middleware');

const router = Router();

// Carrega config/app.json com fallback para valores padrão
const APP_CONFIG = (() => {
  try {
    return require('../../config/app.json');
  } catch {
    return { versao: '0.0.0', repo_url: '' };
  }
})();

// Extrai owner e repo de uma URL do GitHub
function parseRepoUrl(url) {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
}

// Comparação semântica de versões (retorna 1, 0, -1)
function semverCompare(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// Faz requisição HTTPS GET e retorna o JSON parseado
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'chgt-helpdesk', 'Accept': 'application/vnd.github.v3+json' }, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`GitHub API: ${res.statusCode} — ${data.slice(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Resposta inválida do GitHub.')); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('Tempo limite excedido ao contactar GitHub.')); });
  });
}

// Stream de download HTTP para arquivo local
function streamDownload(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, { headers: { 'User-Agent': 'chgt-helpdesk' }, timeout: 120000 }, (res) => {
      if (res.statusCode !== 200) {
        file.close(); fs.unlinkSync(destPath);
        return reject(new Error(`Download falhou: HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { file.close(); if (fs.existsSync(destPath)) fs.unlinkSync(destPath); reject(err); })
      .on('timeout', function () { this.destroy(); file.close(); if (fs.existsSync(destPath)) fs.unlinkSync(destPath); reject(new Error('Tempo limite do download excedido.')); });
  });
}

// Cache da última release obtida do GitHub
let ultimaRelease = null;

// Retorna a versão atual do sistema (usado pelo sidebar)
router.get('/versao', autenticar, (req, res) => {
  res.json({ versao: APP_CONFIG.versao });
});

// Consulta GitHub Releases e compara com a versão atual
router.get('/atualizacoes/verificar', autenticar, admin, async (req, res) => {
  const repo = parseRepoUrl(APP_CONFIG.repo_url);
  if (!repo) {
    return res.json({ erro: 'URL do repositório não configurada.', atualizacao_disponivel: false });
  }
  try {
    const release = await fetchJson(`https://api.github.com/repos/${repo.owner}/${repo.repo}/releases/latest`);
    const versaoNova = release.tag_name || '0.0.0';
    // Armazena dados da release para download posterior
    ultimaRelease = { tag: versaoNova, zipball: release.zipball_url, html_url: release.html_url, body: release.body || '' };
    const comparacao = semverCompare(versaoNova, APP_CONFIG.versao);
    res.json({
      atualizacao_disponivel: comparacao > 0,
      versao_atual: APP_CONFIG.versao,
      versao_nova: versaoNova,
      url_download: release.zipball_url,
      url_release: release.html_url,
      changelog: release.body || ''
    });
  } catch (e) {
    res.json({ erro: e.message, atualizacao_disponivel: false });
  }
});

// Baixa o zipball da última release para a pasta backups/
router.post('/atualizacoes/baixar', autenticar, admin, async (req, res) => {
  const repo = parseRepoUrl(APP_CONFIG.repo_url);
  if (!repo) {
    return res.status(400).json({ erro: 'URL do repositório não configurada.' });
  }
  const tag = ultimaRelease?.tag || req.body.tag;
  if (!tag) {
    return res.status(400).json({ erro: 'Nenhuma versão disponível para download. Primeiro verifique as atualizações.' });
  }
  const backupDir = path.join(__dirname, '..', '..', 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const destName = `chgt-helpdesk-${tag.replace(/^v/, '')}.zip`;
  const destPath = path.join(backupDir, destName);
  try {
    const url = ultimaRelease?.zipball || `https://api.github.com/repos/${repo.owner}/${repo.repo}/zipball/${tag}`;
    await streamDownload(url, destPath);
    const stat = fs.statSync(destPath);
    res.json({
      sucesso: true,
      mensagem: `Atualização baixada: ${destName}`,
      arquivo: destName,
      caminho: destPath,
      tamanho: stat.size
    });
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
});

module.exports = router;
