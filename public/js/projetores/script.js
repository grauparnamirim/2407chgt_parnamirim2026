// Scripts da página de projetores

// Previne submit acidental ao pressionar Enter
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); }
});

// Verifica autenticação e permissões
verificarAutenticacao();
const u = AppState.usuario;
if (!u) { window.location.href = '/'; }
else if (!['admin','gestor','tecnico'].includes(u.perfil) && !temAlgumaPermissao('projetores.ver', 'inventario.ver', 'ativos.ver')) {
    window.location.href = u.perfil === 'usuario' ? '/meus-chamados' : '/';
}

// Pode registrar/concluir manutenções
const podeManutencao = ['admin', 'gestor', 'tecnico'].includes(u.perfil) || temPermissao('ativos.manutencoes');

// Formatação
function formatarMoeda(v) {
    return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

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
        html += `<a href="relatorios"><span class="nav-icon"><iconify-icon icon="mdi:chart-bar" width="20" height="20"></iconify-icon></span> Relatórios</a>`;
    }
    if (temAlgumaPermissao('impressoras.ver')) {
        html += `<a href="impressoras"><span class="nav-icon"><iconify-icon icon="mdi:printer" width="20" height="20"></iconify-icon></span> Controle Impressões</a>`;
    }
    if (temAlgumaPermissao('fornecedores.ver')) {
        html += `<a href="fornecedores"><span class="nav-icon"><iconify-icon icon="mdi:truck-delivery" width="20" height="20"></iconify-icon></span> Fornecedores</a>`;
    }
    if (temPermissao('dispositivos.ver')) {
        html += `<a href="dispositivos"><span class="nav-icon"><iconify-icon icon="mdi:cellphone-link" width="20" height="20"></iconify-icon></span> Dispositivos</a>`;
    }
    if (temAlgumaPermissao('projetores.ver', 'inventario.ver', 'ativos.ver')) {
        html += `<a href="projetores" class="active"><span class="nav-icon"><iconify-icon icon="mdi:projector" width="20" height="20"></iconify-icon></span> Controle Projetores</a>`;
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

// Badge de status do ativo
function badgeStatusAtivo(status) {
    if (status === 'Em manutenção') return '<span class="badge badge-andamento">Em manutenção</span>';
    if (status === 'Desativado' || status === 'Baixado') return `<span class="badge badge-erro">${escapeHTML(status)}</span>`;
    return '<span class="badge badge-sucesso">Ativo</span>';
}

// Carrega a lista de projetores com dashboard e ranking
async function carregarProjetores() {
    try {
    const r = await api('/api/projetores');
    const { projetores, resumo, ranking } = r;

    // Cartões
    document.getElementById('stat-total').textContent = resumo.total_projetores;
    document.getElementById('stat-em-manutencao').textContent = resumo.em_manutencao;
    document.getElementById('stat-conserto').textContent = resumo.foram_para_conserto;
    document.getElementById('stat-gasto').textContent = formatarMoeda(resumo.total_gasto);

    // Ranking
    const rankEl = document.getElementById('ranking-projetores');
    if (!ranking.length) {
        rankEl.innerHTML = '<p class="text-secondary">Nenhum projetor passou por manutenção registrada ainda.</p>';
    } else {
        const max = ranking[0].total_gasto || 1;
        rankEl.innerHTML = ranking.slice(0, 10).map((item, idx) => `
        <div class="ranking-item pos-${idx + 1}">
            <div class="ranking-pos">${idx + 1}</div>
            <div class="ranking-info">
            <strong>${escapeHTML(item.patrimonio || `#${item.id}`)}${item.modelo ? ' — ' + escapeHTML(item.modelo) : ''}</strong>
            <small>${escapeHTML(item.local_nome || 'Local não informado')} · ${item.total_manutencoes} manutenção(ões)</small>
            </div>
            <div class="ranking-bar-bg"><div class="ranking-bar" style="width:${Math.max(4, Math.round(item.total_gasto / max * 100))}%"></div></div>
            <div class="ranking-valor">${formatarMoeda(item.total_gasto)}</div>
        </div>`).join('');
    }

    // Tabela
    const tbody = document.getElementById('tabela-projetores');
    if (!projetores.length) {
        tbody.innerHTML = '<tr><td colspan="11"><div class="empty-state"><h3>Nenhum projetor registrado</h3><p>Os projetores cadastrados no inventário aparecerão aqui.</p></div></td></tr>';
        return;
    }
    tbody.innerHTML = projetores.map(p => `
        <tr>
        <td><strong>${escapeHTML(p.patrimonio || '—')}</strong></td>
        <td>${escapeHTML([p.fabricante, p.modelo].filter(Boolean).join(' ')) || '<span class="text-secondary">—</span>'}</td>
        <td>${p.local_nome ? escapeHTML(p.local_nome) : '<span class="text-secondary">—</span>'}</td>
        <td>${badgeStatusAtivo(p.status)}</td>
        <td>${p.servico_nome ? escapeHTML(p.servico_nome) + ' <span class="badge ' + (p.status_manutencao === 'concluida' ? 'badge-sucesso' : 'badge-andamento') + '">' + (p.status_manutencao ? escapeHTML(p.status_manutencao) : '') + '</span>' : '<span class="text-secondary">—</span>'}</td>
        <td>${p.data_quebra ? formatarData(p.data_quebra) : '<span class="text-secondary">—</span>'}</td>
        <td>${p.data_retorno ? formatarData(p.data_retorno) : '<span class="text-secondary">—</span>'}</td>
        <td>${p.valor_manutencao ? formatarMoeda(p.valor_manutencao) : '<span class="text-secondary">—</span>'}</td>
        <td>${p.total_manutencoes || '<span class="text-secondary">0</span>'}</td>
        <td>${p.total_gasto ? formatarMoeda(p.total_gasto) : '<span class="text-secondary">—</span>'}</strong></td>
        <td style="white-space:nowrap">${podeManutencao ? `<button class="btn btn-outline btn-sm" onclick="abrirModalNovaManutencaoProjetor(${p.id}, '${escapeHTML(p.patrimonio || '')}')" style="padding:4px 8px;font-size:0.7rem" title="Registrar manutenção"><iconify-icon icon="mdi:wrench" width="14" height="14"></iconify-icon> Nova</button> ` : ''}<button class="btn btn-outline btn-sm" onclick="verHistorico(${p.id})" style="padding:4px 8px;font-size:0.7rem" title="Ver histórico"><iconify-icon icon="mdi:history" width="14" height="14"></iconify-icon> Histórico</button></td>
        </tr>`).join('');
    } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// Abre o histórico de manutenções de um projetor
async function verHistorico(id) {
    try {
    const p = await api('/api/projetores/' + id);
    const manutencoes = p.manutencoes || [];
    let linhas;
    if (!manutencoes.length) {
        linhas = '<p class="text-secondary">Nenhuma manutenção registrada para este projetor.</p>';
    } else {
        linhas = `<table>
        <thead><tr><th>Serviço</th><th>Status</th><th>Data quebra</th><th>Data retorno</th><th>Valor</th>${podeManutencao ? '<th>Ações</th>' : ''}</tr></thead>
        <tbody>${manutencoes.map(m => `<tr>
            <td>${escapeHTML(m.nome_servico || m.tipo || 'Manutenção')}${m.descricao ? '<br><small class="text-secondary">' + escapeHTML(m.descricao) + '</small>' : ''}</td>
            <td><span class="badge ${m.status === 'concluida' ? 'badge-sucesso' : 'badge-andamento'}">${escapeHTML(m.status || 'agendada')}</span></td>
            <td>${formatarData(m.criado_em)}</td>
            <td>${m.data_retorno ? formatarData(m.data_retorno) : '<span class="text-secondary">—</span>'}</td>
            <td>${m.custo ? formatarMoeda(m.custo) : '<span class="text-secondary">—</span>'}</td>
            <td>${m.status !== 'concluida' && podeManutencao ? `<button class="btn btn-outline btn-sm" onclick="concluirManutencaoProjetor(${m.id})" style="padding:4px 8px;font-size:0.7rem"><iconify-icon icon="mdi:check" width="14" height="14"></iconify-icon> Concluir</button>` : ''}</td>
        </tr>`).join('')}</tbody>
        </table>`;
    }
    openModal('Histórico do Projetor', `<div class="dispositivo-modal-cabecalho"><span><iconify-icon icon="mdi:projector" width="25" height="25"></iconify-icon></span><div><strong>${escapeHTML(p.patrimonio || 'Projetor #' + p.id)}</strong><small>${escapeHTML([p.fabricante, p.modelo].filter(Boolean).join(' · ') || 'Projetor')}</small></div>${badgeStatusAtivo(p.status)}</div>${linhas}`, [
        { text: 'Fechar', cls: 'btn-outline', id: 'btn-fechar-historico', onClick: closeModal }
    ]);
    } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

// Abre modal para registrar nova manutenção de um projetor (entrada manual)
function abrirModalNovaManutencaoProjetor(id, patrimonio) {
    const hoje = new Date().toISOString().slice(0, 10);
    openModal('🔧 Nova Manutenção', `<form id="fnp" class="form-grid col-1">
    <div class="inventario-confirmacao-servico"><span>Projetor</span><strong>${escapeHTML(patrimonio || '#' + id)}</strong></div>
    <div class="form-group"><label>Nome do serviço *</label><input id="np-servico" placeholder="Ex: Troca de lâmpada, Limpeza interna" required></div>
    <div class="form-group"><label>Descrição</label><textarea id="np-desc" rows="2" placeholder="Detalhes do serviço realizado"></textarea></div>
    <div class="form-group"><label>Data da quebra</label><input type="date" id="np-quebra" value="${hoje}"></div>
    <div class="form-group"><label>Valor (R$)</label><input type="number" id="np-valor" step="0.01" min="0" placeholder="0,00"></div>
    <div class="form-group"><label>Status</label><select id="np-status"><option value="em_manutencao">Em manutenção</option><option value="concluida">Concluída</option></select></div>
    </form>`, [
    { text:'Cancelar', cls:'btn-outline', id:'btn-cancelar-np', onClick: closeModal },
    { text:'💾 Salvar', cls:'btn-primary', id:'btn-salvar-np', onClick: async () => {
        const servico = document.getElementById('np-servico').value.trim();
        if (!servico) { showToast('Nome do serviço é obrigatório.', 'error'); return; }
        const valor = document.getElementById('np-valor').value.trim();
        const status = document.getElementById('np-status').value;
        try {
        const body = {
            tipo: 'corretiva', nome_servico: servico,
            descricao: document.getElementById('np-desc').value.trim(),
            data_quebra: document.getElementById('np-quebra').value || null
        };
        if (valor) body.custo = parseFloat(valor);
        if (status === 'concluida') body.status = 'concluida';
        const r = await api(`/api/ativos/${id}/manutencoes`, { method:'POST', body });
        showToast(r.mensagem, 'success'); closeModal(); carregarProjetores();
        } catch(err) { showToast(err.message, 'error'); }
    }}
    ]);
}

// Conclui uma manutenção pendente registrando o valor
function concluirManutencaoProjetor(id) {
    openModal('✅ Concluir Manutenção', `<form class="form-grid col-1"><div class="form-group"><label>Valor do serviço (R$)</label><input type="number" id="cm-valor" step="0.01" min="0" placeholder="0,00"></div></form>`, [
    { text:'Cancelar', cls:'btn-outline', id:'btn-cancelar-cm', onClick: closeModal },
    { text:'✅ Concluir', cls:'btn-success', id:'btn-confirmar-cm', onClick: async () => {
        try {
        const r = await api(`/api/manutencoes/${id}`, { method:'PUT', body:{ custo: parseFloat(document.getElementById('cm-valor').value) || 0 } });
        showToast(r.mensagem, 'success'); closeModal(); carregarProjetores();
        } catch(err) { showToast(err.message, 'error'); }
    }}
    ]);
}

// Logout com confirmação
document.getElementById('sidebar-logout').addEventListener('click', function(e) {
    e.preventDefault();
    openModal('🚪 Sair do Sistema', '<p>Tem certeza que deseja sair?</p>', [
    { text: 'Cancelar', cls: 'btn-outline', id: 'btn-cancelar-logout', onClick: closeModal },
    { text: '✅ Sair', cls: 'btn-danger', id: 'btn-confirmar-logout', onClick: () => AppState.logout() }
    ]);
});

carregarProjetores();
