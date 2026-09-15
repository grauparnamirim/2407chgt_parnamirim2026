// Scripts da página de relatórios 

// Previne submit acidental ao pressionar Enter em inputs
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); }
});

// Verifica autenticação e permissões
verificarAutenticacao();
const u = AppState.usuario;
if (!u) { window.location.href = '/'; }
else if (!['admin','gestor','tecnico'].includes(u.perfil) && !temPermissao('relatorios.ver_tempos')) {
    window.location.href = u.perfil === 'usuario' ? '/meus-chamados' : '/';
}

// Configura a navegação da sidebar
configurarSidebar([]);
(function() {
    const navEl = document.getElementById('sidebar-nav');
    if (!navEl) return;
    const perfil = AppState.usuario.perfil;
    const isAdminOrGestor = ['admin','gestor','tecnico'].includes(perfil);
    let html = '';

    html += '<div class="nav-section">Principal</div>';
    html += `<a href="painel"><span class="nav-icon"><iconify-icon icon="mdi:view-dashboard" width="20" height="20"></iconify-icon></span> Painel</a>`;
    if (temAlgumaPermissao('chamados.ver_atribuidos', 'chamados.ver_todos_unidade', 'chamados.ver_proprios')) {
    html += `<a href="painel"><span class="nav-icon"><iconify-icon icon="mdi:ticket-outline" width="20" height="20"></iconify-icon></span> Chamados</a>`;
    }

    const mostraCadastros = temAlgumaPermissao('setores.ver', 'categorias.ver', 'usuarios.ver', 'inventario.ver', 'ativos.ver');
    if (mostraCadastros) {
    html += '<div class="nav-section">Cadastros</div>';
    if (temAlgumaPermissao('setores.ver')) {
        html += `<a href="setores"><span class="nav-icon"><iconify-icon icon="mdi:domain" width="20" height="20"></iconify-icon></span> Setores</a>`;
    }
    if (temAlgumaPermissao('categorias.ver')) {
        html += `<a href="categorias"><span class="nav-icon"><iconify-icon icon="mdi:shape-outline" width="20" height="20"></iconify-icon></span> Categorias</a>`;
    }
    if (temAlgumaPermissao('inventario.ver')) {
        html += `<a href="inventario"><span class="nav-icon"><iconify-icon icon="mdi:desktop-tower-monitor" width="20" height="20"></iconify-icon></span> Inventário</a>`;
    }
    if (temAlgumaPermissao('usuarios.ver')) {
        html += `<a href="usuarios"><span class="nav-icon"><iconify-icon icon="mdi:account-group" width="20" height="20"></iconify-icon></span> Usuários</a>`;
    }
    }

    const mostraGestao = temAlgumaPermissao('relatorios.ver_dashboard', 'relatorios.ver_tempos', 'impressoras.ver', 'fornecedores.ver', 'projetores.ver', 'dispositivos.ver') || isAdminOrGestor;
    if (mostraGestao) {
    html += '<div class="nav-section">Gestão</div>';
    if (temAlgumaPermissao('relatorios.ver_dashboard', 'relatorios.ver_tempos')) {
        html += `<a href="relatorios" class="active"><span class="nav-icon"><iconify-icon icon="mdi:chart-bar" width="20" height="20"></iconify-icon></span> Relatórios</a>`;
    }
    if (temAlgumaPermissao('impressoras.ver') || isAdminOrGestor) {
        html += `<a href="impressoras"><span class="nav-icon"><iconify-icon icon="mdi:printer" width="20" height="20"></iconify-icon></span> Controle Impressões</a>`;
    }
    if (temAlgumaPermissao('fornecedores.ver') || isAdminOrGestor) {
        html += `<a href="fornecedores"><span class="nav-icon"><iconify-icon icon="mdi:truck-delivery" width="20" height="20"></iconify-icon></span> Fornecedores</a>`;
    }
    if (temPermissao('dispositivos.ver')) {
        html += `<a href="dispositivos"><span class="nav-icon"><iconify-icon icon="mdi:cellphone-link" width="20" height="20"></iconify-icon></span> Dispositivos</a>`;
    }
    if (temAlgumaPermissao('projetores.ver', 'inventario.ver', 'ativos.ver')) {
        html += `<a href="projetores"><span class="nav-icon"><iconify-icon icon="mdi:projector" width="20" height="20"></iconify-icon></span> Controle Projetores</a>`;
    }
    }

    const mostraFinanceiro = temAlgumaPermissao('financeiro.ver', 'financeiro.criar', 'financeiro.aprovar') || isAdminOrGestor;
    if (mostraFinanceiro) {
    html += '<div class="nav-section">Financeiro</div>';
    html += `<a href="financeiro"><span class="nav-icon"><iconify-icon icon="mdi:currency-usd" width="20" height="20"></iconify-icon></span> Financeiro</a>`;
    if (temAlgumaPermissao('notas_fiscais.ver') || isAdminOrGestor) {
        html += `<a href="notas-fiscais"><span class="nav-icon"><iconify-icon icon="mdi:file-document" width="20" height="20"></iconify-icon></span> Notas Fiscais</a>`;
    }
    }

    if (AppState.usuario.perfil === 'admin') {
    html += '<div class="nav-section">Sistema</div>';
    html += '<a href="avancado"><span class="nav-icon"><iconify-icon icon="mdi:cog-outline" width="20" height="20"></iconify-icon></span> Avançado</a>';
    }

    navEl.innerHTML = html;
})();

// Formata duração em ms para exibição legível
function formatarTempo(ms) { if (ms < 0) ms = 0; const seg = Math.floor(ms / 1000); if (seg < 60) return `${seg}s`; const min = Math.floor(seg / 60); if (min < 60) return `${min}min`; const horas = Math.floor(min / 60); const minRest = min % 60; if (horas < 24) return `${horas}h ${minRest}min`; const dias = Math.floor(horas / 24); const hRest = horas % 24; return `${dias}d ${hRest}h`; }

// Carrega os dados de relatórios da API e preenche a página
async function carregarRelatorios() {
    try {
    const data = await api(`/api/relatorios/tempos?gestor_id=${AppState.usuario.id}`);
    const { chamados, metricas } = data;
    document.getElementById('met-media').textContent = formatarTempo(metricas.tempo_medio_util_ms);
    document.getElementById('met-media-total').textContent = formatarTempo(metricas.tempo_medio_total_ms);
    document.getElementById('met-lento').textContent = metricas.mais_demorado_ms ? formatarTempo(metricas.mais_demorado_ms) : '—';
    document.getElementById('met-rapido').textContent = metricas.mais_rapido_ms ? formatarTempo(metricas.mais_rapido_ms) : '—';
    const taxa = metricas.total_chamados > 0 ? Math.round((metricas.total_resolvidos / metricas.total_chamados) * 100) : 0;
    document.getElementById('met-taxa').textContent = `${taxa}%`;
    const tbody = document.getElementById('tabela-tempos');
    if (!chamados.length) { tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="empty-icon"><iconify-icon icon="mdi:chart-timeline" width="40" height="40"></iconify-icon></div><h3>Nenhum chamado concluído</h3></div></td></tr>'; return; }
    tbody.innerHTML = chamados.map(c=>`<tr><td><strong>#${c.id}</strong></td><td>${c.titulo}</td><td>${c.usuario_nome}</td><td>${c.tecnico_nome}</td><td>${formatarData(c.aberto_em)}</td><td>${formatarData(c.concluido_em)}</td><td><strong>${formatarTempo(c.tempo_util_ms)}</strong></td><td>${c.tempo_espera_ms > 0 ? formatarTempo(c.tempo_espera_ms) : '<span class="text-secondary">—</span>'}</td><td>${formatarTempo(c.tempo_aberto_ms)}</td></tr>`).join('');
    } catch (e) { showToast('Erro: '+e.message, 'error'); }
}

// Logout com confirmação
document.getElementById('sidebar-logout').addEventListener('click', function(e) {
    e.preventDefault();
    openModal('🚪 Sair do Sistema', '<p>Tem certeza que deseja sair?</p>', [
    { text:'Cancelar', cls:'btn-outline', id:'btn-cancelar-logout', onClick: closeModal },
    { text:'✅ Sair', cls:'btn-danger', id:'btn-confirmar-logout', onClick: () => AppState.logout() }
    ]);
});

carregarRelatorios();
