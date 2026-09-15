// Scripts da página de controle de impressões 

// Previne submit acidental ao pressionar Enter
document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); }
});

verificarAutenticacao();
const u = AppState.usuario;
if (!u) { window.location.href = '/'; }
else if (!['admin', 'gestor', 'tecnico'].includes(u.perfil) && !temPermissao('impressoras.ver')) {
    window.location.href = u.perfil === 'usuario' ? '/meus-chamados' : '/';
}
const usuario = AppState.usuario;

const NOMES_MESES = ['', 'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

configurarSidebar([]);
(function () {
    const navEl = document.getElementById('sidebar-nav');
    if (!navEl) return;
    const perfil = AppState.usuario.perfil;
    const isAdminOrGestor = ['admin', 'gestor', 'tecnico'].includes(perfil);
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
    if (temAlgumaPermissao('impressoras.ver') || isAdminOrGestor) {
        html += `<a href="impressoras" class="active"><span class="nav-icon"><iconify-icon icon="mdi:printer" width="20" height="20"></iconify-icon></span> Controle Impressões</a>`;
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

// ============================================================
// INICIALIZAÇÃO
// ============================================================
function getMesesDisponiveis(ano) {
    if (ano == 2026) return [4, 5, 6, 7, 8, 9, 10, 11, 12];
    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
}

function popularSelectMes(ano) {
    const select = document.getElementById('select-mes');
    const meses = getMesesDisponiveis(ano);
    const current = select.value;
    select.innerHTML = meses.map(m => `<option value="${m}">${NOMES_MESES[m]}</option>`).join('');
    if (current && meses.includes(parseInt(current))) {
    select.value = current;
    } else {
    select.value = meses[0];
    }
}

function onAnoChange() {
    const ano = parseInt(document.getElementById('select-ano').value);
    popularSelectMes(ano);

    // Mostra/esconde aba Cadastro
    const btn = document.getElementById('tab-btn-cadastro');
    btn.classList.toggle('tab-cadastro-hidden', ano !== 2026);

    ultimoCacheKey = null;
    carregarMes();
}

function onMesChange() {
    ultimoCacheKey = null;
    carregarMes();
}

function onStatusChange() {
    ultimoCacheKey = null;
    carregarMes();
}

// ============================================================
// IMPRESSÃO DO RELATÓRIO MENSAL
// ============================================================
let nomeUnidadeImpressao = usuario?.unidade_id ? `Unidade #${usuario.unidade_id}` : 'Todas as unidades';

async function carregarNomeUnidadeImpressao() {
    try {
    const unidades = await api('/api/unidades');
    const unidade = unidades.find(item => Number(item.id) === Number(usuario?.unidade_id));
    if (unidade) nomeUnidadeImpressao = unidade.cidade ? `${unidade.nome} — ${unidade.cidade}` : unidade.nome;
    } catch (_) {
    // O identificador da unidade permanece como fallback no cabeçalho.
    }
    atualizarCabecalhoImpressao();
}

function atualizarCabecalhoImpressao() {
    const mes = Number(document.getElementById('select-mes')?.value);
    const ano = document.getElementById('select-ano')?.value || '';
    const statusCampo = document.getElementById('select-status');
    const unidadeEl = document.getElementById('impressao-unidade');
    const periodoEl = document.getElementById('impressao-periodo');
    const statusEl = document.getElementById('impressao-status');
    const emissaoEl = document.getElementById('impressao-emissao');
    if (unidadeEl) unidadeEl.textContent = nomeUnidadeImpressao;
    if (periodoEl) periodoEl.textContent = `${NOMES_MESES[mes] || ''} / ${ano}`;
    if (statusEl) statusEl.textContent = `Impressoras: ${statusCampo?.options[statusCampo.selectedIndex]?.text || 'Todas'}`;
    if (emissaoEl) emissaoEl.textContent = `Emitido em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}`;
}

function limparEstadoImpressao() {
    document.body.classList.remove('impressao-incluir-mensalidade');
}

function abrirOpcoesImpressao() {
    if (!document.querySelector('#mensal-content .mensalidade-grid')) {
    showToast('Aguarde o relatório mensal terminar de carregar.', 'info');
    return;
    }
    limparEstadoImpressao();
    openModal('🖨️ Imprimir controle mensal', `<div><label class="impressao-opcao-financeira" for="impressao-incluir-mensalidade"><input type="checkbox" id="impressao-incluir-mensalidade"><span><strong>Incluir mensalidade do mês</strong><small>Desmarcado por padrão. O Total Excedente em reais continuará aparecendo no documento.</small></span></label><p class="impressao-opcao-aviso"><iconify-icon icon="mdi:information-outline" width="16" height="16"></iconify-icon> O relatório será preparado em A4 paisagem com os filtros atualmente selecionados.</p></div>`, [
    { text: 'Cancelar', cls: 'btn-outline', id: 'btn-cancelar-impressao', onClick: () => { limparEstadoImpressao(); closeModal(); } },
    { text: 'Imprimir', cls: 'btn-primary', id: 'btn-confirmar-impressao', onClick: imprimirRelatorioMensal }
    ]);
}

async function imprimirRelatorioMensal() {
    const incluirMensalidade = Boolean(document.getElementById('impressao-incluir-mensalidade')?.checked);
    document.body.classList.toggle('impressao-incluir-mensalidade', incluirMensalidade);
    atualizarCabecalhoImpressao();
    closeModal();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
    window.print();
    } finally {
    setTimeout(limparEstadoImpressao, 500);
    }
}

window.addEventListener('beforeprint', atualizarCabecalhoImpressao);
window.addEventListener('afterprint', limparEstadoImpressao);

// ============================================================
// CARREGAR DADOS DO MÊS
// ============================================================
let ultimoCacheKey = null;

function corMensalidade(valor) {
    if (valor >= 1000) return 'alert-vermelho';
    if (valor > 840) return 'alert-laranja';
    return 'alert-verde';
}

function corTotal(valor, limite) {
    if (valor >= limite) return 'alert-laranja';
    return 'alert-verde';
}

async function carregarMes() {
    const mes = parseInt(document.getElementById('select-mes').value);
    const ano = parseInt(document.getElementById('select-ano').value);
    const status = document.getElementById('select-status').value;
    const container = document.getElementById('mensal-content');

    const cacheKey = mes + '-' + ano + '-' + status;
    if (ultimoCacheKey === cacheKey) return;
    ultimoCacheKey = cacheKey;

    container.innerHTML = '<p class="text-secondary">Carregando...</p>';

    try {
    const [leituras, relatorio] = await Promise.all([
        api('/api/leituras?mes=' + mes + '&ano=' + ano + '&status=' + status),
        api('/api/relatorios/impressao/mensal?mes=' + mes + '&ano=' + ano + '&status=' + status)
    ]);

    const franquiaTonner = relatorio.parametros?.franquia_tonner || 9000;
    const franquiaColorida = relatorio.parametros?.franquia_colorida || 1000;
    const valorFixoBase = relatorio.parametros?.valor_fixo_base || 840;

    let html = '';

    // Totais e mensalidade com alerta de cor
    const r = relatorio || {};
    html += '<div class="mensalidade-grid">';
    html += '<div class="mensalidade-card ' + corTotal(r.total_tonner, franquiaTonner) + '"><div class="fc-value">' + (r.total_tonner ?? '—') + '</div><div class="fc-label">Total TONNER (pág)</div><div class="fc-label" style="font-size:0.7rem;margin-top:4px">Franquia: ' + franquiaTonner + '</div></div>';
    html += '<div class="mensalidade-card ' + corTotal(r.total_colorida, franquiaColorida) + '"><div class="fc-value">' + (r.total_colorida ?? '—') + '</div><div class="fc-label">Total COLORIDA (pág)</div><div class="fc-label" style="font-size:0.7rem;margin-top:4px">Franquia: ' + franquiaColorida + '</div></div>';
    html += '<div class="mensalidade-card"><div class="fc-value">' + (r.excedente_tonner ?? '—') + '</div><div class="fc-label">Excedente TONNER (pág)</div></div>';
    html += '<div class="mensalidade-card"><div class="fc-value">' + (r.excedente_colorida ?? '—') + '</div><div class="fc-label">Excedente COLORIDA (pág)</div></div>';
    html += '<div class="mensalidade-card"><div class="fc-value">R$ ' + (r.total_excedente_reais || 0).toFixed(2) + '</div><div class="fc-label">Total Excedente (R$)</div></div>';
    html += '<div class="mensalidade-card mensalidade-card-mensalidade ' + corMensalidade(r.mensalidade) + '"><div class="fc-value">R$ ' + (r.mensalidade || 0).toFixed(2) + '</div><div class="fc-label"><strong>mensalidade DO MÊS</strong></div></div>';
    html += '</div>';

    // Tabela de leituras
    html += '<div class="card mt-20"><div class="card-header"><h2><iconify-icon icon="mdi:calendar-text" width="20" height="20"></iconify-icon> ' + NOMES_MESES[mes] + ' / ' + ano + ' — Leituras</h2></div><div class="card-body no-padding"><div class="table-wrap"><table><thead><tr><th>MAC</th><th>IP</th><th>Impressora</th><th>Setor</th><th>Tipo</th><th>Contagem Anterior</th><th>Contag. Atual</th><th>Total Impressões</th></tr></thead><tbody>';

    if (!leituras.length) {
        html += '<tr><td colspan="8" class="text-center text-secondary">Nenhuma impressora cadastrada.</td></tr>';
    } else {
        for (const leitura of leituras) {
        const contagem_leitura = leitura.contagem_leitura !== null ? leitura.contagem_leitura : '';
        const contagem_anterior = leitura.contagem_anterior !== null ? leitura.contagem_anterior : leitura.contagem_atual;
        const total_imp = contagem_leitura !== '' ? Math.max(0, parseInt(contagem_leitura) - parseInt(contagem_anterior)) : 0;

        html += '<tr>';
        html += '<td>' + (leitura.mac || '<span class="text-secondary">—</span>') + '</td>';
        html += '<td>' + leitura.ip + '</td>';
        html += '<td><strong>' + escapeHTML(leitura.impressora_nome) + '</strong></td>';
        html += '<td>' + (leitura.setor_nome || '<span class="text-secondary">—</span>') + '</td>';
        html += '<td>' + (leitura.tipo === 'TONNER' ? '<span class="badge badge-aberto">TONNER</span>' : '<span class="badge badge-andamento">COLORIDA</span>') + '</td>';
        html += '<td class="text-center"><strong>' + contagem_anterior + '</strong></td>';
        html += '<td class="text-center"><input type="number" class="contagem-input ' + (contagem_leitura !== '' ? 'saved' : '') + '" id="contagem-' + mes + '-' + leitura.impressora_id + '" value="' + (contagem_leitura !== '' ? contagem_leitura : '') + '" min="0" placeholder="0000" onchange="salvarLeitura(' + mes + ',' + ano + ',' + leitura.impressora_id + ',this)"></td>';
        html += '<td class="text-center"><span class="total-impressoes ' + (total_imp === 0 ? 'zero' : '') + '">' + total_imp + '</span></td>';
        html += '</tr>';
        }
    }

    html += '</tbody></table></div></div></div>';
    container.innerHTML = html;
    } catch (e) {
    container.innerHTML = '<div class="card"><div class="card-body"><p class="text-secondary">Erro ao carregar dados: ' + e.message + '</p></div></div>';
    showToast('Erro: ' + e.message, 'error');
    }
}

async function salvarLeitura(mes, ano, impressora_id, input) {
    const contagem_leitura = parseInt(input.value);
    if (isNaN(contagem_leitura) || contagem_leitura < 0) {
    showToast('Informe uma contagem válida (número positivo).', 'error');
    input.value = '';
    input.classList.remove('saved');
    return;
    }
    try {
    const r = await api('/api/leituras', {
        method: 'POST',
        body: { impressora_id, mes: parseInt(mes), ano: parseInt(ano), contagem_leitura }
    });
    input.classList.add('saved');
    ultimoCacheKey = null;
    carregarMes();
    showToast(r.mensagem, 'success');
    } catch (err) {
    showToast(err.message, 'error');
    }
}

// Carrega dados de impressoras
async function carregarTudo() {
    ultimoCacheKey = null;
    await carregarImpressoras();
}

// Esconder botões sem permissão
(function () {
    const btnNovo = document.getElementById('btn-nova-impressora');
    if (btnNovo && !temPermissao('impressoras.criar')) btnNovo.style.display = 'none';
    // Esconder aba Parâmetros se não puder editar
    if (!temPermissao('impressoras.editar') && !['admin', 'gestor', 'tecnico'].includes(usuario.perfil)) {
    const tabParam = document.querySelector('[data-tab="parametros"]');
    if (tabParam) tabParam.style.display = 'none';
    }
})();

async function carregarImpressoras() {
    try {
    const imp = await api('/api/impressoras');
    document.getElementById('stat-total-impressoras').textContent = imp.length;
    document.getElementById('stat-tonner').textContent = imp.filter(i => i.tipo === 'TONNER').length;
    document.getElementById('stat-colorida').textContent = imp.filter(i => i.tipo === 'COLORIDA').length;

    const podeEditar = temPermissao('impressoras.editar');
    const podeExcluir = temPermissao('impressoras.excluir');
    const tbody = document.getElementById('tabela-impressoras');
    if (!imp.length) {
        tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><h3>Nenhuma impressora cadastrada</h3></div></td></tr>';
        return;
    }
    tbody.innerHTML = imp.map(i => {
        const isInativo = i.ativo === 0;
        const btnEditar = podeEditar ? `<button class="btn btn-outline btn-sm" onclick="editarImpressora(${i.id})" style="padding:4px 8px;font-size:0.7rem"><iconify-icon icon="mdi:pencil" width="14" height="14"></iconify-icon></button>` : '';
        const btnExcluir = podeExcluir ? `<button class="btn btn-danger btn-sm" onclick="excluirImpressora(${i.id},'${escapeHTML(i.nome)}')" style="padding:4px 8px;font-size:0.7rem"><iconify-icon icon="mdi:delete" width="14" height="14"></iconify-icon></button>` : '';
        const btnToggle = podeEditar
        ? `<button class="btn btn-sm btn-toggle-status ${isInativo ? 'btn-primary' : 'btn-outline'}" onclick="toggleStatusImpressora(${i.id}, ${i.ativo})" style="padding:4px 8px;font-size:0.7rem" title="${isInativo ? 'Reativar' : 'Inativar'}"><iconify-icon icon="${isInativo ? 'mdi:play-circle' : 'mdi:pause-circle'}" width="14" height="14"></iconify-icon></button>`
        : '';
        const acoes = [btnEditar, btnToggle, btnExcluir].filter(Boolean).join(' ') || '<span class="text-secondary">—</span>';
        const statusBadge = isInativo ? ' <span class="badge-inativa">Inativa</span>' : '';
        return `<tr class="${isInativo ? 'inativa' : ''}">
        <td>${i.mac || '<span class="text-secondary">—</span>'}</td>
        <td>${i.ip}</td>
        <td><strong>${escapeHTML(i.nome)}</strong>${statusBadge}</td>
        <td>${i.setor_nome || '<span class="text-secondary">—</span>'}</td>
        <td>${i.tipo === 'TONNER' ? '<span class="badge badge-aberto">TONNER</span>' : '<span class="badge badge-andamento">COLORIDA</span>'}</td>
        <td class="text-center"><strong>${i.contagem_atual}</strong></td>
        <td style="white-space:nowrap">${acoes}</td>
        </tr>`;
    }).join('');
    } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function abrirModalCadastroImpressora() {
    const setores = await api('/api/setores');
    const optsSetor = setores.length
    ? '<option value="">Selecione...</option>' + setores.map(s => `<option value="${s.id}">${escapeHTML(s.nome)}</option>`).join('')
    : '<option value="">Nenhum setor cadastrado</option>';
    openModal(
    '➕ Nova Impressora',
    `<form id="fmi" class="form-grid">
        <div class="form-group"><label>MAC (endereço físico)</label><input id="mi-mac" placeholder="Ex: AA:BB:CC:DD:EE:FF"></div>
        <div class="form-group"><label>IP *</label><input id="mi-ip" placeholder="Ex: 10.2.200.1" required></div>
        <div class="form-group"><label>Nome / Número *</label><input id="mi-nome" placeholder="Ex: Impressora 01" required></div>
        <div class="form-group"><label>Setor</label><select id="mi-setor">${optsSetor}</select></div>
        <div class="form-group"><label>Tipo *</label><select id="mi-tipo"><option value="TONNER">TONNER</option><option value="COLORIDA">COLORIDA</option></select></div>
        <div class="form-group"><label>Contagem Atual</label><input type="number" id="mi-contagem" value="0" min="0"></div>
    </form>`,
    [{ text: 'Cancelar', cls: 'btn-outline', id: 'btn-cancelar-imp', onClick: closeModal }, { text: '💾 Cadastrar', cls: 'btn-primary', id: 'btn-salvar-imp', onClick: salvarImpressoraModal }]
    );
}

async function salvarImpressoraModal() {
    const mac = document.getElementById('mi-mac').value.trim();
    const ip = document.getElementById('mi-ip').value.trim();
    const nome = document.getElementById('mi-nome').value.trim();
    const setor_id = document.getElementById('mi-setor').value;
    const tipo = document.getElementById('mi-tipo').value;
    const contagem_atual = parseInt(document.getElementById('mi-contagem').value) || 0;
    if (!ip || !nome || !tipo || !setor_id) { showToast('Preencha IP, nome, tipo e setor.', 'error'); return; }
    try {
    const r = await api('/api/impressoras', { method: 'POST', body: { mac, ip, nome, setor_id: parseInt(setor_id), tipo, contagem_atual } });
    showToast(r.mensagem, 'success');
    closeModal();
    carregarImpressoras();
    } catch (err) { showToast(err.message, 'error'); }
}

async function editarImpressora(id) {
    const imp = await api('/api/impressoras');
    const i = imp.find(x => x.id === id);
    if (!i) return;
    const setores = await api('/api/setores');
    const optsSetor = setores.length
    ? '<option value="">Selecione...</option>' + setores.map(s => `<option value="${s.id}" ${i.setor_id === s.id ? 'selected' : ''}>${escapeHTML(s.nome)}</option>`).join('')
    : '<option value="">Nenhum setor</option>';
    openModal(
    '✏️ Editar ' + escapeHTML(i.nome),
    `<form id="fei" class="form-grid">
        <div class="form-group"><label>MAC</label><input id="ei-mac" value="${escapeHTML(i.mac || '')}"></div>
        <div class="form-group"><label>IP</label><input id="ei-ip" value="${escapeHTML(i.ip)}" required></div>
        <div class="form-group"><label>Nome</label><input id="ei-nome" value="${escapeHTML(i.nome)}" required></div>
        <div class="form-group"><label>Setor</label><select id="ei-setor">${optsSetor}</select></div>
        <div class="form-group"><label>Tipo</label><select id="ei-tipo"><option value="TONNER" ${i.tipo === 'TONNER' ? 'selected' : ''}>TONNER</option><option value="COLORIDA" ${i.tipo === 'COLORIDA' ? 'selected' : ''}>COLORIDA</option></select></div>
        <div class="form-group"><label>Contagem Atual</label><input type="number" id="ei-contagem" value="${i.contagem_atual}" min="0"></div>
    </form>`,
    [{ text: 'Cancelar', cls: 'btn-outline', id: 'btn-cancelar-editimp', onClick: closeModal }, {
        text: '💾 Salvar', cls: 'btn-primary', id: 'btn-editar-imp', onClick: async () => {
        const mac = document.getElementById('ei-mac').value.trim();
        const ip = document.getElementById('ei-ip').value.trim();
        const nome = document.getElementById('ei-nome').value.trim();
        const setor_id = document.getElementById('ei-setor').value;
        const tipo = document.getElementById('ei-tipo').value;
        const contagem_atual = parseInt(document.getElementById('ei-contagem').value) || 0;
        try {
            const r = await api('/api/impressoras/' + id, { method: 'PUT', body: { mac, ip, nome, setor_id: setor_id ? parseInt(setor_id) : null, tipo, contagem_atual } });
            showToast(r.mensagem, 'success');
            closeModal();
            carregarImpressoras();
        } catch (err) { showToast(err.message, 'error'); }
        }
    }]
    );
}

function excluirImpressora(id, nome) {
    openModal('🗑️ Excluir Impressora', `<p>Tem certeza que deseja excluir <strong>${escapeHTML(nome)}</strong>?</p><p class="text-secondary mt-12">Todas as leituras desta impressora também serão removidas.</p>`,
    [{ text: 'Cancelar', cls: 'btn-outline', id: 'btn-cancelar-delimp', onClick: closeModal }, {
        text: '🗑️ Excluir', cls: 'btn-danger', id: 'btn-del-imp', onClick: async () => {
        try { const r = await api('/api/impressoras/' + id, { method: 'DELETE' }); showToast(r.mensagem, 'success'); closeModal(); carregarImpressoras(); } catch (err) { showToast(err.message, 'error'); }
        }
    }]
    );
}

async function toggleStatusImpressora(id, statusAtual) {
    const novoStatus = statusAtual === 1 ? 0 : 1;
    const acao = novoStatus === 0 ? 'inativar' : 'reativar';
    openModal(
    (novoStatus === 0 ? '⏸️' : '▶️') + ' ' + (novoStatus === 0 ? 'Inativar' : 'Reativar') + ' Impressora',
    `<p>Tem certeza que deseja <strong>${acao}</strong> esta impressora?</p>`,
    [
        { text: 'Cancelar', cls: 'btn-outline', id: 'btn-cancelar-toggle-imp', onClick: closeModal },
        {
        text: (novoStatus === 0 ? '⏸️ Inativar' : '▶️ Reativar'),
        cls: novoStatus === 0 ? 'btn-danger' : 'btn-primary',
        id: 'btn-toggle-imp',
        onClick: async () => {
            try {
            const r = await api('/api/impressoras/' + id + '/status', { method: 'PUT', body: { ativo: novoStatus } });
            showToast(r.mensagem, 'success');
            closeModal();
            carregarImpressoras();
            } catch (err) { showToast(err.message, 'error'); }
        }
        }
    ]
    );
}

// ============================================================
// PARÂMETROS
// ============================================================
async function carregarParametros() {
    try {
    const p = await api('/api/parametros-impressao');
    document.getElementById('param-franquia_tonner').value = p.franquia_tonner ?? 9000;
    document.getElementById('param-franquia_colorida').value = p.franquia_colorida ?? 1000;
    document.getElementById('param-valor_excedente_tonner').value = p.valor_excedente_tonner ?? 0.05;
    document.getElementById('param-valor_excedente_colorida').value = p.valor_excedente_colorida ?? 0.25;
    document.getElementById('param-valor_fixo_base').value = p.valor_fixo_base ?? 840;
    } catch (e) { showToast('Erro: ' + e.message, 'error'); }
}

async function salvarParametros() {
    const body = {
    franquia_tonner: parseFloat(document.getElementById('param-franquia_tonner').value) || 0,
    franquia_colorida: parseFloat(document.getElementById('param-franquia_colorida').value) || 0,
    valor_excedente_tonner: parseFloat(document.getElementById('param-valor_excedente_tonner').value) || 0,
    valor_excedente_colorida: parseFloat(document.getElementById('param-valor_excedente_colorida').value) || 0,
    valor_fixo_base: parseFloat(document.getElementById('param-valor_fixo_base').value) || 0
    };
    try {
    const r = await api('/api/parametros-impressao', { method: 'PUT', body });
    showToast(r.mensagem, 'success');
    ultimoCacheKey = null;
    } catch (err) { showToast(err.message, 'error'); }
}

// ============================================================
// INIT
// ============================================================
const anoAtual = parseInt(document.getElementById('select-ano').value);
if (anoAtual !== 2026) {
    document.getElementById('tab-btn-cadastro').classList.add('tab-cadastro-hidden');
}
popularSelectMes(anoAtual);
carregarNomeUnidadeImpressao();
carregarMes();
carregarTudo();
