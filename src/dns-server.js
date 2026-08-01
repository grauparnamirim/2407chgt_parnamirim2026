// Servidor DNS local — resolve domínios internos do HelpDesk para IPs locais
const dgram = require('dgram');
const os = require('os');
const fs = require('fs');
const path = require('path');
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

// Obtém o IP local da primeira interface de rede não interna
function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const localIP = getLocalIP();
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

// Inicia o servidor DNS na porta e host configurados
function start() {
  return new Promise((resolve, reject) => {
    server.once('listening', () => {
      const addr = server.address();
      console.log(`[dns] ${addr.family} server on ${addr.address}:${addr.port}`);
      console.log(`[dns] resolving: ${Object.keys(config.domains).join(', ')}`);
      if (config.port === 53) {
        console.log(`[dns] LAN access via ${localIP}:53 (requires admin/root)`);
      }
      resolve();
    });
    server.once('error', reject);
    server.bind(config.port, config.host);
  });
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

module.exports = { start, stop };
