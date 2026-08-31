const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { getDb, getConnectionString } = require('../db');
const { autenticar } = require('../middleware');

const execFileAsync = promisify(execFile);
const router = Router();
const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Cria um backup lógico do PostgreSQL (pg_dump) com timestamp no nome do arquivo
router.post('/backup', autenticar, async (req, res) => {
  if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem fazer backup.' });
  try {
    const data = new Date();
    const ts = data.getFullYear() +
      String(data.getMonth() + 1).padStart(2, '0') +
      String(data.getDate()).padStart(2, '0') + '-' +
      String(data.getHours()).padStart(2, '0') +
      String(data.getMinutes()).padStart(2, '0') +
      String(data.getSeconds()).padStart(2, '0');
    const nome = `local-${ts}.sql`;
    await execFileAsync('pg_dump', ['--no-owner', '--no-privileges', '-f', path.join(BACKUP_DIR, nome), getConnectionString()]);
    res.json({ sucesso: true, mensagem: `Backup criado: ${nome}`, arquivo: nome });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao criar backup: ' + e.message });
  }
});

// Lista todos os backups disponíveis ordenados do mais recente ao mais antigo
router.get('/backups', autenticar, (req, res) => {
  if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem listar backups.' });
  try {
    const arquivos = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.sql'))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return { nome: f, tamanho: stat.size, criado_em: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    res.json(arquivos);
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao listar backups.' });
  }
});

// Exclui um backup pelo nome (com validação de segurança do caminho)
router.delete('/backups/:nome', autenticar, (req, res) => {
  if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem excluir backups.' });
  const arquivo = path.join(BACKUP_DIR, req.params.nome);
  if (!arquivo.startsWith(BACKUP_DIR) || !req.params.nome.endsWith('.sql')) return res.status(400).json({ erro: 'Arquivo inválido.' });
  try {
    if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
    res.json({ sucesso: true, mensagem: 'Backup excluído.' });
  } catch (e) {
    res.status(500).json({ erro: 'Erro ao excluir backup.' });
  }
});

// Faz o download de um arquivo de backup
router.get('/backups/:nome/download', autenticar, (req, res) => {
  if (req.usuario.perfil !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem baixar backups.' });
  const arquivo = path.join(BACKUP_DIR, req.params.nome);
  if (!arquivo.startsWith(BACKUP_DIR) || !req.params.nome.endsWith('.sql')) return res.status(400).json({ erro: 'Arquivo inválido.' });
  if (!fs.existsSync(arquivo)) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
  res.download(arquivo);
});

module.exports = router;
