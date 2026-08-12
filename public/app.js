// app.js — CHGT HelpDesk v1.0.0 — Frontend com JWT
// Gerencia: estado global, API com token, sidebar, tabs e modais

// ============================================================
// ESTADO GLOBAL (sessionStorage)
// ============================================================
const AppState = {
  get token() { return sessionStorage.getItem('token'); },
  set token(t) { sessionStorage.setItem('token', t); },
  get usuario() {
    const data = sessionStorage.getItem('usuario');
    return data ? JSON.parse(data) : null;
  },
  set usuario(user) { sessionStorage.setItem('usuario', JSON.stringify(user)); },
  async logout() {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
    sessionStorage.clear();
    window.location.href = '/';
  }
};

// Aplica o tema salvo no localStorage ao carregar a página
function aplicarTemaSalvo() {
  let tema = localStorage.getItem('tema');
  if (tema === 'dark') { tema = 'escuro'; localStorage.setItem('tema', 'escuro'); }
  if (!tema || !['tecnico','escuro','faculdade','profissionalizante'].includes(tema)) tema = 'tecnico';
  document.documentElement.setAttribute('data-theme', tema);
}

// Aplica um tema específico e salva a preferência do usuário
function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  localStorage.setItem('tema', tema);
  closeModal();
}

// Abre modal com opções de temas visuais para o usuário escolher
function abrirModalTemas() {
  const atual = document.documentElement.getAttribute('data-theme') || 'tecnico';
  const temas = [
    { id: 'tecnico', nome: 'Técnico (Padrão)', icon: 'mdi:wrench', cor1: '#43B307', cor2: '#358f05' },
    { id: 'escuro', nome: 'Modo Escuro', icon: 'mdi:weather-night', cor1: '#43B307', cor2: '#282c34' },
    { id: 'faculdade', nome: 'Faculdade', icon: 'mdi:school', cor1: '#E67E22', cor2: '#d35400' },
    { id: 'profissionalizante', nome: 'Profissionalizante', icon: 'mdi:certificate', cor1: '#2563EB', cor2: '#1d4ed8' }
  ];
  const cardsHTML = temas.map(t => `
    <div class="theme-card${t.id === atual ? ' active' : ''}" onclick="aplicarTema('${t.id}')">
      <iconify-icon icon="${t.icon}" width="28" height="28" style="color:${t.cor1}"></iconify-icon>
      <strong style="font-size:0.85rem">${t.nome}</strong>
      <div style="display:flex;gap:4px;justify-content:center;margin-top:2px">
        <span style="width:18px;height:18px;border-radius:50%;background:${t.cor1};border:1px solid rgba(0,0,0,0.1)"></span>
        <span style="width:18px;height:18px;border-radius:50%;background:${t.cor2};border:1px solid rgba(0,0,0,0.1)"></span>
      </div>
    </div>
  `).join('');
  openModal('🎨 Selecionar Tema', `<div class="theme-grid">${cardsHTML}</div>`, []);
}

aplicarTemaSalvo();

// ============================================================
// LOADING GLOBAL — entrada da página e operações demoradas
// ============================================================
const appLoading = (() => {
  const DELAY_MS = 300;
  const MIN_VISIBLE_MS = 450;
  let pendentes = 0;
  let carregamentoInicial = true;
  let overlay = null;
  let mensagem = null;
  let exibidoEm = 0;
  let timerExibir = null;
  let timerOcultar = null;

  // Cria o overlay de carregamento se ainda não existir no DOM
  function criar() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'app-loading-overlay';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-label', 'Carregando conteúdo');
    overlay.innerHTML = `
      <div class="app-loading-brand">
        <div class="app-loading-logo-wrap">
          <img src="/midia/logo-chgt-carregamento.png" alt="Grau Técnico" class="app-loading-logo">
        </div>
        <div class="app-loading-spinner" aria-hidden="true"></div>
        <p class="app-loading-message">Carregando...</p>
      </div>
    `;
    mensagem = overlay.querySelector('.app-loading-message');
    document.body.appendChild(overlay);
  }

  // Cancela o timer de exibição do loading se estiver ativo
  function limparTimerExibir() {
    if (timerExibir) {
      clearTimeout(timerExibir);
      timerExibir = null;
    }
  }

  // Cancela o timer de ocultação do loading se estiver ativo
  function limparTimerOcultar() {
    if (timerOcultar) {
      clearTimeout(timerOcultar);
      timerOcultar = null;
    }
  }

  // Exibe o overlay de carregamento com uma mensagem opcional
  function mostrar(texto = 'Carregando...') {
    criar();
    limparTimerOcultar();
    if (mensagem) mensagem.textContent = texto;
    overlay.setAttribute('aria-label', texto);
    if (!overlay.classList.contains('is-visible')) {
      overlay.classList.add('is-visible');
      exibidoEm = Date.now();
    }
  }

  // Agenda a ocultação do overlay após o tempo mínimo de exibição
  function ocultarQuandoPossivel() {
    if (carregamentoInicial || pendentes > 0 || !overlay || !overlay.classList.contains('is-visible')) return;
    limparTimerOcultar();
    const restante = Math.max(0, MIN_VISIBLE_MS - (Date.now() - exibidoEm));
    timerOcultar = setTimeout(() => {
      if (!carregamentoInicial && pendentes === 0 && overlay) {
        overlay.classList.remove('is-visible');
      }
    }, restante);
  }

  // Agenda a exibição do loading com atraso para evitar flashes rápidos
  function agendarExibicao(texto) {
    if (carregamentoInicial || (overlay && overlay.classList.contains('is-visible')) || timerExibir) return;
    timerExibir = setTimeout(() => {
      timerExibir = null;
      if (pendentes > 0 && !carregamentoInicial) mostrar(texto);
    }, DELAY_MS);
  }

  // Incrementa o contador de operações pendentes e ativa o loading
  function iniciar(texto = 'Carregando...') {
    pendentes += 1;
    if (carregamentoInicial) mostrar(texto);
    else agendarExibicao(texto);
  }

  // Decrementa o contador de operações e oculta o loading se todas concluírem
  function concluir() {
    pendentes = Math.max(0, pendentes - 1);
    if (pendentes === 0) {
      limparTimerExibir();
      ocultarQuandoPossivel();
    }
  }

  // Finaliza o estado de carregamento inicial da página
  function concluirCarregamentoInicial() {
    carregamentoInicial = false;
    if (pendentes === 0) ocultarQuandoPossivel();
  }

  // A tela de marca aparece de imediato em toda página que carrega o app.js.
  mostrar('Carregando...');
  if (document.readyState === 'complete') {
    setTimeout(concluirCarregamentoInicial, 0);
  } else {
    window.addEventListener('load', concluirCarregamentoInicial, { once: true });
  }

  return { iniciar, concluir };
})();

// ============================================================
// FUNÇÕES DE PERMISSÃO (RBAC)
// ============================================================
// Verifica se o usuário possui uma permissão específica
function temPermissao(chave) {
  const usuario = AppState.usuario;
  if (!usuario || !usuario.permissoes) return false;
  if (usuario.perfil === 'admin') return true;
  return usuario.permissoes.includes(chave);
}

// Verifica se o usuário possui ao menos uma das permissões informadas
function temAlgumaPermissao(...chaves) {
  return chaves.some(chave => temPermissao(chave));
}

const PERMISSOES_USUARIO_PADRAO = [
  'chamados.abrir', 'chamados.ver_proprios', 'chamados.reabrir',
  'chamados.comentar', 'notificacoes.receber'
];

// Verifica se o usuário possui permissões além do conjunto padrão de usuário
function temPermissoesAvancadas() {
  const usuario = AppState.usuario;
  if (!usuario || !usuario.permissoes) return false;
  if (usuario.perfil === 'admin') return true;
  return usuario.permissoes.some(p => !PERMISSOES_USUARIO_PADRAO.includes(p));
}

// ============================================================
// TOKEN EXPIRADO — verificação local do JWT
// ============================================================
// Verifica se o token JWT está expirado analisando o payload
function tokenEstaExpirado() {
  const token = AppState.token;
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch (_) {
    return true;
  }
}

// ============================================================
// VERIFICAÇÃO DE AUTENTICAÇÃO
// ============================================================
// Verifica autenticação e perfil de acesso, redireciona se necessário
function verificarAutenticacao(...perfisEsperados) {
  const usuario = AppState.usuario;
  const token = AppState.token;
  if (!usuario || !token || tokenEstaExpirado()) {
    AppState.logout();
    return false;
  }
  // Admin pode acessar qualquer página
  if (usuario.perfil === 'admin') return true;
  // Se não há perfis esperados, qualquer usuário autenticado passa
  if (perfisEsperados.length === 0) return true;
  // Se o perfil está na lista, passa
  if (perfisEsperados.includes(usuario.perfil)) return true;
  // Usuários com permissões avançadas podem acessar páginas restritas
  if (temPermissoesAvancadas()) return true;
  // Redireciona para a página apropriada
  const paginas = { admin: 'painel', gestor: 'painel', tecnico: 'painel', usuario: 'meus-chamados' };
  window.location.href = paginas[usuario.perfil] || '/';
  return false;
}

// ============================================================
// API HELPER — Com token JWT no header
// ============================================================
// Faz requisições à API com token JWT, loading e tratamento de erros
async function api(url, options = {}) {
  const baseURL = window.location.origin;
  const token = AppState.token;
  const { loadingText, ...requestOptions } = options;
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...requestOptions
  };
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }
  appLoading.iniciar(loadingText || 'Carregando...');
  try {
    const response = await fetch(baseURL + url, config);
    // Se 401, token expirou — força logout
    if (response.status === 401) {
      AppState.logout();
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    // ✅ VALIDAR response.ok ANTES de fazer parse JSON
    let data;
    try {
      data = await response.json();
    } catch (parseErr) {
      // Se não conseguir fazer parse JSON, cria erro genérico
      data = { erro: 'Erro ao processar resposta do servidor' };
    }
    if (!response.ok) throw new Error(data.erro || `Erro HTTP ${response.status}`);
    return data;
  } catch (err) {
    console.error('❌ API:', err.message);
    throw err;
  } finally {
    appLoading.concluir();
  }
}

// ============================================================
// ESCAPE HTML — Proteção contra XSS
// ============================================================
// Escapa caracteres HTML para prevenir ataques XSS
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  str = String(str);
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return str.replace(/[&<>"']/g, m => map[m]);
}

// ============================================================
// TOAST — Feedback visual
// ============================================================
// Exibe uma notificação toast temporária na tela
function showToast(mensagem, tipo = 'info') {
  const existente = document.querySelector('.toast');
  if (existente) existente.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = mensagem;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================================
// FORMATAÇÃO
// ============================================================
// Formata data ISO no padrão brasileiro (dd/mm/aaaa hh:mm)
function formatarData(dataString) {
  if (!dataString) return '-';
  const data = new Date(dataString);
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Converte milissegundos em duração legível (ex: 2h 30min)
function formatarDuracao(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalMinutos = Math.floor(ms / 60000);
  if (totalMinutos < 1) return 'agora';
  if (totalMinutos < 60) return `${totalMinutos}min`;
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  if (horas < 24) return minutos ? `${horas}h ${minutos}min` : `${horas}h`;
  const dias = Math.floor(horas / 24);
  const horasRestantes = horas % 24;
  return horasRestantes ? `${dias}d ${horasRestantes}h` : `${dias}d`;
}

// Gera texto descritivo do tempo de resposta de um chamado
function textoTempoResposta(inicio, fim = null, tempoEsperaMs = 0) {
  const dataInicio = new Date(inicio);
  if (Number.isNaN(dataInicio.getTime())) return '-';
  const dataFim = fim ? new Date(fim) : new Date();
  const totalMs = dataFim.getTime() - dataInicio.getTime();
  const tempoUtil = Math.max(0, totalMs - tempoEsperaMs);
  const duracaoUtil = formatarDuracao(tempoUtil);
  const pausado = tempoEsperaMs > 0 ? ` (${formatarDuracao(tempoEsperaMs)} aguardando fornecedor)` : '';
  return fim ? `Aguardou ${duracaoUtil}${pausado}` : `Aguardando há ${duracaoUtil}${pausado}`;
}

// Gera HTML do timer de resposta com status ativo ou finalizado
function tempoRespostaHTML(chamado) {
  const resolvido = chamado.status === 'Resolvido';
  const aguardandoFornecedor = chamado.status === 'Aguardando Fornecedor';
  const fim = resolvido ? (chamado.atualizado_em || chamado.criado_em) : '';
  const tempoEspera = Number(chamado.tempo_espera_ms) || 0;
  const pausadoLabel = aguardandoFornecedor ? ' ⏸️ Pausado' : '';
  const texto = textoTempoResposta(chamado.criado_em, fim || null, tempoEspera) + pausadoLabel;
  return `<span class="timer-resposta ${resolvido ? 'finalizado' : 'ativo'}" data-inicio="${chamado.criado_em || ''}" data-fim="${fim}" data-tempo-espera="${tempoEspera}">${texto}</span>`;
}

// Atualiza em tempo real todos os timers de resposta na página
function atualizarTimersResposta() {
  document.querySelectorAll('.timer-resposta.ativo').forEach(el => {
    const tempoEspera = Number(el.dataset.tempoEspera) || 0;
    el.textContent = textoTempoResposta(el.dataset.inicio, null, tempoEspera);
  });
}

// Gera HTML do badge de status do chamado com cor e indicador
function statusBadgeHTML(status) {
  const map = { 'Aberto': { cls: 'badge-aberto' }, 'Em andamento': { cls: 'badge-andamento' }, 'Aguardando Fornecedor': { cls: 'badge-aguardando' }, 'Resolvido': { cls: 'badge-resolvido' } };
  const m = map[status] || { cls: '' };
  return `<span class="badge ${m.cls}"><span class="badge-dot"></span>${status}</span>`;
}

// ============================================================
// ÍCONES ICONIFY (Material Design Icons)
// ============================================================
const icons = {
  dashboard:   '<iconify-icon icon="mdi:view-dashboard" width="20" height="20"></iconify-icon>',
  chamados:    '<iconify-icon icon="mdi:ticket-outline" width="20" height="20"></iconify-icon>',
  usuarios:    '<iconify-icon icon="mdi:account-group" width="20" height="20"></iconify-icon>',
  inventario:  '<iconify-icon icon="mdi:desktop-tower-monitor" width="20" height="20"></iconify-icon>',
  relatorios:  '<iconify-icon icon="mdi:chart-bar" width="20" height="20"></iconify-icon>',
  historico:   '<iconify-icon icon="mdi:archive-outline" width="20" height="20"></iconify-icon>',
  notificacoes:'<iconify-icon icon="mdi:bell-outline" width="20" height="20"></iconify-icon>',
  refresh:     '<iconify-icon icon="mdi:refresh" width="16" height="16"></iconify-icon>',
  plus:        '<iconify-icon icon="mdi:plus" width="24" height="24"></iconify-icon>',
  edit:        '<iconify-icon icon="mdi:pencil" width="14" height="14"></iconify-icon>',
  delete:      '<iconify-icon icon="mdi:delete" width="14" height="14"></iconify-icon>',
  userPlus:    '<iconify-icon icon="mdi:account-plus" width="16" height="16"></iconify-icon>',
  atribuir:    '<iconify-icon icon="mdi:account-arrow-right" width="14" height="14"></iconify-icon>',
  logout:      '<iconify-icon icon="mdi:logout" width="18" height="18"></iconify-icon>',
  menu:        '<iconify-icon icon="mdi:menu" width="22" height="22"></iconify-icon>',
  newTicket:   '<iconify-icon icon="mdi:plus-circle" width="18" height="18"></iconify-icon>'
};

// Gera HTML do badge de perfil do usuário (gestor, técnico, usuário)
function perfilBadgeHTML(perfil) {
  const map = { gestor: 'badge-perfil-gestor', tecnico: 'badge-perfil-tecnico', usuario: 'badge-perfil-usuario' };
  return `<span class="badge ${map[perfil] || ''}">${perfil}</span>`;
}

// ============================================================
// SIDEBAR + TABS
// ============================================================
// Configura a sidebar com dados do usuário, navegação e eventos
function configurarSidebar(navItems = []) {
  const usuario = AppState.usuario;
  if (!usuario) return;
  const nomeEl = document.getElementById('sidebar-nome');
  const cargoEl = document.getElementById('sidebar-cargo');
  const avatarEl = document.getElementById('sidebar-avatar');
  if (nomeEl) nomeEl.textContent = usuario.nome;
  if (cargoEl) cargoEl.textContent = usuario.perfil;
  if (avatarEl) avatarEl.textContent = usuario.nome.charAt(0).toUpperCase();

  const navEl = document.getElementById('sidebar-nav');
  if (navEl) {
    if (navItems.length) {
      let html = '', lastSection = '';
      navItems.forEach(item => {
        if (item.section && item.section !== lastSection) { html += `<div class="nav-section">${item.section}</div>`; lastSection = item.section; }
        html += `<a data-tab="${item.id}" onclick="ativarTab('${item.id}')"><span class="nav-icon">${item.icon}</span>${item.label}</a>`;
      });
      navEl.innerHTML = html;
    }
  }

  const logoutBtn = document.getElementById('sidebar-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', () => AppState.logout());

  atualizarBreadcrumb();

  const toggleBtn = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');
  if (toggleBtn && sidebar) toggleBtn.addEventListener('click', () => sidebar.classList.toggle('open'));
}

// Ativa uma aba específica na sidebar e no painel de conteúdo
function ativarTab(tabId) {
  document.querySelectorAll('#sidebar-nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === tabId));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tabId}`));
  atualizarBreadcrumb();
  const sidebar = document.getElementById('sidebar');
  if (sidebar && window.innerWidth <= 768) sidebar.classList.remove('open');
}

// Atualiza o breadcrumb no topo da página conforme a aba ativa
function atualizarBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  if (!bc) return;
  let activeTab = document.querySelector('.tab-btn.active');
  let tabLabel = 'Início';
  if (activeTab) {
    tabLabel = activeTab.textContent.trim();
  } else {
    const activeLink = document.querySelector('#sidebar-nav a.active');
    if (activeLink) tabLabel = activeLink.textContent.trim();
  }
  const usuario = AppState.usuario;
  const perfilNome = usuario ? usuario.perfil.charAt(0).toUpperCase() + usuario.perfil.slice(1) : '';
  bc.innerHTML = `${perfilNome} › <strong>${tabLabel}</strong>`;
}

// ============================================================
// MODAL
// ============================================================
// Abre um modal com título, conteúdo HTML e botões no rodapé
function openModal(title, bodyHTML, footerButtons = [], extraClass = '') {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'modal-overlay';
  let footerHTML = '';
  if (footerButtons.length) {
    footerHTML = `<div class="modal-footer">${footerButtons.map(b => `<button class="btn ${b.cls || 'btn-outline'}" id="${b.id || ''}">${b.text}</button>`).join('')}</div>`;
  }
  overlay.innerHTML = `<div class="modal ${extraClass}"><div class="modal-header"><h3>${title}</h3><button class="modal-close" onclick="closeModal()">✕</button></div><div class="modal-body">${bodyHTML}</div>${footerHTML}</div>`;
  document.body.appendChild(overlay);
  footerButtons.forEach(b => { if (b.onClick && b.id) { const btn = overlay.querySelector(`#${b.id}`); if (btn) btn.addEventListener('click', b.onClick); } });
  overlay.classList.remove('hidden');
}
// Remove o modal do DOM
function closeModal() { const o = document.getElementById('modal-overlay'); if (o) o.remove(); }

// ============================================================
// PESQUISA GLOBAL
// ============================================================
// Verifica se o perfil do usuário pode usar a pesquisa global
function podeUsarPesquisaGlobal() {
  return ['admin', 'gestor', 'tecnico'].includes(AppState.usuario?.perfil);
}

// Remove o overlay da pesquisa global do DOM
function fecharPesquisaGlobal() {
  document.getElementById('global-search-overlay')?.remove();
}

// Abre a pesquisa global com campo de busca, debounce e exibição de resultados
function abrirPesquisaGlobal() {
  if (!podeUsarPesquisaGlobal() || document.getElementById('global-search-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'global-search-overlay';
  overlay.className = 'global-search-overlay';
  overlay.innerHTML = `
    <section class="global-search-dialog" role="dialog" aria-modal="true" aria-labelledby="global-search-title">
      <div class="global-search-input-wrap">
        <iconify-icon icon="mdi:magnify" width="22" height="22" aria-hidden="true"></iconify-icon>
        <input id="global-search-input" type="search" autocomplete="off" placeholder="Buscar chamados ou patrimônio..." aria-label="Pesquisar chamados e ativos">
        <kbd>ESC</kbd>
      </div>
      <p class="global-search-hint" id="global-search-title">Digite pelo menos 2 caracteres para pesquisar.</p>
      <div class="global-search-results" aria-live="polite"></div>
    </section>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#global-search-input');
  const hint = overlay.querySelector('.global-search-hint');
  const results = overlay.querySelector('.global-search-results');
  let debounce = null;
  let buscaAtual = 0;

  function renderizarEstado(texto, classe = '') {
    results.innerHTML = '';
    const estado = document.createElement('p');
    estado.className = `global-search-state ${classe}`.trim();
    estado.textContent = texto;
    results.appendChild(estado);
  }

  function adicionarGrupo(titulo, icone, itens) {
    if (!itens.length) return;
    const grupo = document.createElement('div');
    grupo.className = 'global-search-group';
    const tituloEl = document.createElement('h3');
    tituloEl.innerHTML = `<iconify-icon icon="${icone}" width="16" height="16" aria-hidden="true"></iconify-icon>${titulo}`;
    grupo.appendChild(tituloEl);

    itens.forEach(item => {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.className = 'global-search-result';
      botao.innerHTML = `<span class="global-search-result-icon"><iconify-icon icon="${item.tipo === 'chamado' ? 'mdi:ticket-outline' : 'mdi:desktop-tower-monitor'}" width="19" height="19" aria-hidden="true"></iconify-icon></span><span class="global-search-result-text"><strong></strong><small></small></span><iconify-icon class="global-search-result-arrow" icon="mdi:arrow-top-right" width="18" height="18" aria-hidden="true"></iconify-icon>`;
      botao.querySelector('strong').textContent = item.titulo;
      botao.querySelector('small').textContent = item.resumo || 'Abrir registro';
      botao.addEventListener('click', () => { window.location.href = item.destino; });
      grupo.appendChild(botao);
    });
    results.appendChild(grupo);
  }

  async function pesquisar(termo) {
    const codigoBusca = ++buscaAtual;
    hint.textContent = 'Buscando registros...';
    renderizarEstado('Buscando...', 'loading');
    try {
      const dados = await api(`/api/pesquisa?q=${encodeURIComponent(termo)}`, { loadingText: 'Buscando registros...' });
      if (codigoBusca !== buscaAtual) return;
      results.innerHTML = '';
      adicionarGrupo('Chamados', 'mdi:ticket-outline', dados.chamados || []);
      adicionarGrupo('Ativos', 'mdi:desktop-tower-monitor', dados.ativos || []);
      if (!results.children.length) renderizarEstado('Nenhum resultado encontrado.');
      hint.textContent = 'Selecione um resultado para abrir e destacar o registro.';
    } catch (err) {
      if (codigoBusca !== buscaAtual) return;
      renderizarEstado(err.message || 'Não foi possível pesquisar agora.', 'error');
      hint.textContent = 'Tente novamente em instantes.';
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const termo = input.value.trim();
    buscaAtual += 1;
    if (termo.length < 2) {
      results.innerHTML = '';
      hint.textContent = 'Digite pelo menos 2 caracteres para pesquisar.';
      return;
    }
    debounce = setTimeout(() => pesquisar(termo), 250);
  });
  overlay.addEventListener('click', event => { if (event.target === overlay) fecharPesquisaGlobal(); });
  requestAnimationFrame(() => input.focus());
}

// ============================================================
// VERSÃO NO SIDEBAR
// ============================================================
// Busca a versão do sistema no servidor e exibe no rodapé da sidebar
async function exibirVersaoSidebar() {
  const footer = document.querySelector('.sidebar-footer');
  if (!footer || document.getElementById('sidebar-version')) return;
  try {
    const res = await fetch('/api/versao', {
      headers: AppState.token ? { 'Authorization': `Bearer ${AppState.token}` } : {}
    });
    if (!res.ok) return;
    const data = await res.json();
    const el = document.createElement('span');
    el.id = 'sidebar-version';
    el.className = 'sidebar-version';
    el.textContent = `v${data.versao}`;
    el.title = `CHGT HelpDesk v${data.versao}`;
    footer.appendChild(el);
  } catch (_) {}
}

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  setInterval(atualizarTimersResposta, 60000);
  if (document.body.classList.contains('login-body')) return;
  exibirVersaoSidebar();
  const usuario = AppState.usuario;
  if (podeUsarPesquisaGlobal()) {
    const acoes = document.querySelector('.top-header .header-actions');
    if (acoes && !document.getElementById('btn-pesquisa-global')) {
      const botao = document.createElement('button');
      botao.type = 'button';
      botao.id = 'btn-pesquisa-global';
      botao.className = 'header-icon-btn global-search-trigger';
      botao.title = 'Pesquisar (Ctrl+K)';
      botao.setAttribute('aria-label', 'Pesquisar chamados e ativos');
      botao.innerHTML = '<iconify-icon icon="mdi:magnify" width="20" height="20"></iconify-icon>';
      botao.addEventListener('click', abrirPesquisaGlobal);
      acoes.prepend(botao);
    }
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    fecharPesquisaGlobal();
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
  const alvo = event.target;
  const emCampoTexto = alvo instanceof HTMLInputElement || alvo instanceof HTMLTextAreaElement || alvo?.isContentEditable;
  if (emCampoTexto || !podeUsarPesquisaGlobal()) return;
  event.preventDefault();
  abrirPesquisaGlobal();
});
