// Servidor DNS local — resolve domínios internos do HelpDesk para IPs locais
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dnsPacket = require('dns-packet');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'dns.json');

let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch {
  config = {
    port: 53,
    host: '0.0.0.0',
    ttl: 300,
    rateLimit: { windowMs: 60000, maxRequests: 120 },
    domains: { 'chgt.helpdesk.local': '127.0.0.1' }
  };
}

config.port = parseInt(process.env.DNS_PORT, 10) || config.port;
config.host = process.env.DNS_HOST || config.host;

// ============================================================
// Configuração de rede
// ============================================================

// Marcadores de adaptadores de rede virtuais (devem ser evitados)
const VIRTUAL_MARKERS = ['vEthernet', 'virtual', 'wsl', 'loopback', 'hyper-v'];

// Lista as interfaces IPv4 não internas, priorizando adaptadores físicos
function listInterfaces() {
  const entries = [];
  for (const name of Object.keys(os.networkInterfaces())) {
    for (const iface of os.networkInterfaces()[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        entries.push({ name, address: iface.address });
      }
    }
  }
  const isVirtual = (name) => VIRTUAL_MARKERS.some((m) => name.toLowerCase().includes(m.toLowerCase()));
  entries.sort((a, b) => Number(isVirtual(a.name)) - Number(isVirtual(b.name)));
  return entries;
}

// Detecta dinamicamente o IP do hospedeiro: prioriza o adaptador físico,
// caindo para o primeiro disponível se não houver. Usado como host padrão.
function getHostIP() {
  const entries = listInterfaces();
  return entries.length > 0 ? entries[0].address : '127.0.0.1';
}

// Verifica se o processo roda com privilégios elevados.
// No Windows usa "net session" (só roda elevado); no Linux usa o UID.
function isElevated() {
  try {
    if (process.platform === 'win32') {
      execSync('net session', { stdio: 'ignore' });
      return true;
    }
    return typeof process.getuid === 'function' && process.getuid() === 0;
  } catch {
    return false;
  }
}

// IP usado nas respostas para clientes da rede; é atualizado para
// refletir a interface realmente vinculada ao iniciar o servidor
let localIP = getHostIP();
const requests = new Map();

// ============================================================
// Controle de taxa (rate limit)
// ============================================================

// Verifica se o IP não excedeu o limite de requisições na janela atual
function checkRateLimit(ip) {
  const now = Date.now();
  let entry = requests.get(ip);
  if (!entry || now - entry.windowStart > config.rateLimit.windowMs) {
    entry = { windowStart: now, count: 0 };
    requests.set(ip, entry);
  }
  entry.count++;
  return entry.count <= config.rateLimit.maxRequests;
}

// ============================================================
// Construção de pacotes DNS
// ============================================================

// Monta pacote DNS de resposta bem-sucedida com o IP resolvido
function buildResponse(query, ip) {
  const answer = {
    name: query.questions[0].name,
    type: query.questions[0].type,
    class: 'IN',
    ttl: config.ttl,
    data: query.questions[0].type === 'AAAA' ? '::1' : ip
  };

  return dnsPacket.encode({
    id: query.id,
    type: 'response',
    flags: dnsPacket.AUTHORITATIVE_ANSWER,
    questions: query.questions,
    answers: [answer]
  });
}

// Monta pacote DNS de resposta recusada (domínio não configurado)
function buildRefused(query) {
  return dnsPacket.encode({
    id: query.id,
    type: 'response',
    flags: dnsPacket.REFUSED,
    questions: query.questions,
    answers: []
  });
}

const server = dgram.createSocket('udp4');

// ============================================================
// Manipulação de requisições DNS
// ============================================================

server.on('message', (raw, rinfo) => {
  const clientIP = rinfo.address;

  if (!checkRateLimit(clientIP)) return;

  let query;
  try {
    query = dnsPacket.decode(raw);
  } catch {
    return;
  }

  if (!query.questions || query.questions.length === 0) return;

  const q = query.questions[0];
  if (q.type !== 'A' && q.type !== 'AAAA') return;
  if (q.class !== 'IN') return;

  const domain = q.name.toLowerCase();

  if (!config.domains[domain]) {
    const refused = buildRefused(query);
    server.send(refused, rinfo.port, clientIP);
    return;
  }

  const ip = domain === q.name && config.domains[domain] === '127.0.0.1' && clientIP !== '127.0.0.1'
    ? localIP
    : config.domains[domain];

  const response = buildResponse(query, ip);
  server.send(response, rinfo.port, clientIP);
});

server.on('error', (err) => {
  console.error(`[dns] error: ${err.message}`);
});

// ============================================================
// Gerenciamento do servidor
// ============================================================

// Monta a lista de hosts a tentar: o host configurado (ou o IP dinâmico
// do hospedeiro quando o padrão for 0.0.0.0) e, em seguida, cada interface
function listCandidateHosts() {
  const hosts = [];
  if (config.host && config.host !== '0.0.0.0') {
    hosts.push(config.host);
  } else {
    hosts.push(getHostIP());
  }
  for (const e of listInterfaces()) hosts.push(e.address);
  return [...new Set(hosts)];
}

// Tenta vincular o servidor a um host:porta e resolve/rejeita conforme o resultado
function tryBind(srv, port, host) {
  return new Promise((resolve, reject) => {
    srv.once('listening', resolve);
    srv.once('error', reject);
    srv.bind(port, host);
  });
}

// Inicia o servidor DNS na porta configurada, vinculando dinamicamente
// ao IP do hospedeiro. Se esse IP estiver ocupado,
// tenta automaticamente as demais interfaces até conseguir vincular.
async function start() {
  const port = config.port;
  const candidates = listCandidateHosts();
  let lastError = null;

  for (const host of candidates) {
    try {
      await tryBind(server, port, host);
      const addr = server.address();
      localIP = addr.address;
      console.log(`[dns] ${addr.family} server on ${addr.address}:${addr.port}`);
      console.log(`[dns] resolving: ${Object.keys(config.domains).join(', ')}`);
      if (port === 53) {
        console.log(`[dns] LAN access via ${addr.address}:53`);
        if (addr.address !== getHostIP()) {
          console.log(`[dns] ${getHostIP()} ocupado — usando interface ${addr.address}. Configure o DNS dos clientes para ${addr.address}.`);
        }
        if (!isElevated() && process.platform !== 'win32') {
          console.log('[dns] aviso: rodando como usuário sem privilégio — porta 53 pode exigir root em alguns sistemas.');
        }
      }
      return;
    } catch (err) {
      lastError = err;
      // Um bind com falha deixa o socket desvinculado; tenta a próxima interface
      server.removeAllListeners('listening');
      server.removeAllListeners('error');
    }
  }

  throw lastError || new Error('Não foi possível iniciar o servidor DNS em nenhuma interface.');
}

// Para o servidor DNS de forma graciosa
function stop() {
  return new Promise((resolve) => {
    server.close(resolve);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error(`[dns] failed to start: ${err.message}`);
    process.exit(1);
  });
}

process.on('SIGINT', () => {
  console.log('\n[dns] shutting down...');
  stop().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  stop().then(() => process.exit(0));
});

module.exports = { start, stop, getHostIP };
