// Scripts da página do usuário

// Logout com confirmação
document.getElementById('sidebar-logout').addEventListener('click', function(e) {
    e.preventDefault();
    openModal('🚪 Sair do Sistema', '<p>Tem certeza que deseja sair?</p>', [
    { text:'Cancelar', cls:'btn-outline', id:'btn-cancelar-logout', onClick: closeModal },
    { text:'✅ Sair', cls:'btn-danger', id:'btn-confirmar-logout', onClick: () => AppState.logout() }
    ]);
});

// Verifica autenticação e permissões
if (!verificarAutenticacao('usuario')) throw new Error('Acesso negado.');
// Usuários com permissões avançadas (ex: coordenador) são redirecionados ao painel completo
if (temPermissoesAvancadas()) {
    window.location.href = 'painel';
    throw new Error('Redirecionando...');
}
const usuario = AppState.usuario;
configurarSidebar([
    { id: 'meus-chamados', icon: icons.chamados, label: 'Meus Chamados', section: 'Principal' }
]);

// Variáveis globais de estado
let todosChamados = [];
let categorias = [];
let filtroStatus = 'todos';
async function carregarTudo() { await carregarChamados(); }

// Renderiza os chamados na tabela e atualiza estatísticas
function renderizarChamados() {
    const chamados = todosChamados;
    document.getElementById('stat-u-abertos').textContent = chamados.filter(c => c.status === 'Aberto').length;
    document.getElementById('stat-u-andamento').textContent = chamados.filter(c => c.status === 'Em andamento').length;
    document.getElementById('stat-u-aguardando').textContent = chamados.filter(c => c.status === 'Aguardando Fornecedor').length;
    document.getElementById('stat-u-resolvidos').textContent = chamados.filter(c => c.status === 'Resolvido').length;
    document.getElementById('total-meus-chamados').textContent = `${chamados.length} chamado(s)`;

    const filtrados = filtroStatus === 'todos' ? chamados : chamados.filter(c => c.status === filtroStatus);
    const tbody = document.getElementById('tabela-chamados');
    if (!filtrados.length) {
    const msg = filtroStatus === 'todos' ? 'Nenhum chamado' : `Nenhum chamado com status "${filtroStatus}".`;
    tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="empty-icon"><iconify-icon icon="mdi:inbox-outline" width="40" height="40"></iconify-icon></div><h3>${msg}</h3>${filtroStatus === 'todos' ? '<p>Clique no botão <strong>+</strong> no canto inferior direito para abrir um chamado.</p>' : ''}</div></td></tr>`;
    return;
    }
    tbody.innerHTML = filtrados.map(c => {
    const catNome = c.subcategoria_id ? (c.subcategoria_nome || c.categoria_nome || '—') : (c.categoria_nome || '—');
    const acoes = (c.status === 'Resolvido'
        ? `<button class="btn btn-warning btn-sm" onclick="reabrirChamado(${c.id},'${escapeHTML(c.titulo)}')" style="padding:4px 8px;font-size:0.7rem">🔄 Reabrir</button> ` : '')
        + `<button class="btn btn-outline btn-sm" onclick="abrirComentarios(${c.id},'${escapeHTML(c.titulo)}')" style="padding:4px 8px;font-size:0.7rem"><iconify-icon icon="mdi:comment-text-outline" width="14" height="14"></iconify-icon></button>`;
    const historicoBtn = `<button class="btn btn-outline btn-sm" onclick="abrirHistorico(${c.id},'${escapeHTML(c.titulo)}')" style="padding:4px 8px;font-size:0.7rem" title="Ver histórico"><iconify-icon icon="mdi:clock-outline" width="14" height="14"></iconify-icon></button>`;
    return `<tr>
        <td><strong>#${c.id}</strong></td>
        <td><strong>${escapeHTML(c.titulo)}</strong><br><small class="text-secondary">${escapeHTML(c.descricao)}</small></td>
        <td><small>${catNome}</small></td>
        <td>${c.local_nome ? `<span class="chamado-local-badge"><iconify-icon icon="mdi:map-marker-outline" width="14" height="14"></iconify-icon>${escapeHTML(c.local_nome)}</span>` : '<span class="text-secondary">—</span>'}</td>
        <td>${c.tecnico_nome ? escapeHTML(c.tecnico_nome) : '<span class="text-secondary">Aguardando</span>'}</td>
        <td>${statusBadgeHTML(c.status)}</td>
        <td>${tempoRespostaHTML(c)}</td>
        <td>${acoes}</td>
        <td>${historicoBtn}</td>
        <td>${formatarData(c.atualizado_em||c.criado_em)}</td>
    </tr>`;
    }).join('');
    atualizarTimersResposta();
}

// Carrega os chamados do usuário da API
async function carregarChamados() {
    try {
    todosChamados = await api(`/api/chamados?usuario_id=${usuario.id}&perfil=usuario`);
    renderizarChamados();
    } catch (e) { showToast('Erro: '+e.message, 'error'); }
}

// Aplica filtro de status na tabela
function selecionarFiltro(el, status) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    filtroStatus = status;
    renderizarChamados();
}

// Abre modal para reabrir um chamado resolvido
async function reabrirChamado(id, titulo) {
    openModal('🔄 Reabrir Chamado', `<p>Deseja reabrir o chamado <strong>#${id}: ${escapeHTML(titulo)}</strong>?</p><p class="text-secondary mt-12">O chamado voltará para a lista de ativos para o técnico.</p>`, [
    { text:'Cancelar', cls:'btn-outline', id:'btn-cancelar-reabrir', onClick: closeModal },
    { text:'🔄 Reabrir', cls:'btn-warning', id:'btn-confirmar-reabrir', onClick: async () => {
        try {
        const r = await api(`/api/chamados/${id}/reabrir`, { method:'PUT' });
        showToast(r.mensagem, 'success');
        closeModal();
        carregarChamados();
        } catch(err) { showToast(err.message, 'error'); }
    }}
    ]);
}

// Abre modal de comentários do chamado
async function abrirComentarios(chamadoId, titulo) {
    let comentarios = [];
    try { comentarios = await api(`/api/chamados/${chamadoId}/comentarios`); } catch(e) { comentarios = []; }
    const lista = comentarios.length
    ? comentarios.map(c => `<div style="padding:10px;border-bottom:1px solid var(--color-border);">
        <strong>${escapeHTML(c.autor_nome)}</strong> <small class="text-secondary">(${c.autor_perfil}) — ${formatarData(c.criado_em)}</small>
        <p style="margin:4px 0 0;white-space:pre-wrap">${escapeHTML(c.texto)}</p></div>`).join('')
    : '<p class="text-secondary">Nenhum comentário ainda.</p>';
    openModal(`💬 Comentários — #${chamadoId} ${escapeHTML(titulo)}`, `
    <div style="max-height:300px;overflow-y:auto;margin-bottom:12px;">${lista}</div>
    <div class="form-group"><label>Novo comentário</label><textarea id="novo-comentario" rows="2" placeholder="Digite seu comentário..." style="width:100%"></textarea></div>`,
    [{ text:'Fechar', cls:'btn-outline', id:'btn-fechar-coment', onClick: closeModal },
        { text:'💬 Enviar', cls:'btn-primary', id:'btn-enviar-coment', onClick: async () => {
        const texto = document.getElementById('novo-comentario').value.trim();
        if (!texto) { showToast('Digite um comentário.', 'error'); return; }
        try {
            await api(`/api/chamados/${chamadoId}/comentarios`, { method:'POST', body:{ texto } });
            showToast('Comentário enviado!', 'success');
            closeModal();
        } catch(err) { showToast(err.message, 'error'); }
        }}
    ]);
}

// Abre modal com histórico de alterações do chamado
async function abrirHistorico(chamadoId, titulo) {
    try {
    const data = await api(`/api/chamados/${chamadoId}/historico`);
    const c = data.chamado;
    const logs = data.historico;
    let html = `<div style="max-height:400px;overflow-y:auto;padding:4px 0">`;

    html += `<div style="display:flex;gap:12px;padding:10px 0;border-left:2px solid #22c55e;padding-left:16px;position:relative;margin-left:8px">
        <div style="position:absolute;left:-6px;top:14px;width:10px;height:10px;border-radius:50%;background:#22c55e"></div>
        <div>
        <strong style="color:#22c55e">🟢 Aberto</strong>
        <div style="font-size:0.78rem;color:var(--color-text-secondary)">${formatarData(c.criado_em)}</div>
        <div style="margin-top:2px;font-size:0.85rem">Por: ${escapeHTML(c.usuario_nome)}</div>
        </div>
    </div>`;

    logs.forEach(log => {
        const cores = { 'Aberto': '#22c55e', 'Em andamento': '#3b82f6', 'Aguardando Fornecedor': '#eab308', 'Resolvido': '#22c55e' };
        const icones = { 'Aberto': '🟢', 'Em andamento': '🔵', 'Aguardando Fornecedor': '🟡', 'Resolvido': '✅' };
        const cor = cores[log.status_novo] || '#6b7280';
        const icone = icones[log.status_novo] || '➡️';
        const quem = log.alterado_por_nome ? ` — ${escapeHTML(log.alterado_por_nome)}` : '';
        html += `<div style="display:flex;gap:12px;padding:10px 0;border-left:2px solid ${cor};padding-left:16px;position:relative;margin-left:8px">
        <div style="position:absolute;left:-6px;top:14px;width:10px;height:10px;border-radius:50%;background:${cor}"></div>
        <div>
            <strong>${icone} ${log.status_anterior} → ${log.status_novo}</strong>
            <div style="font-size:0.78rem;color:var(--color-text-secondary)">${formatarData(log.enviada_em)}${quem}</div>
        </div>
        </div>`;
    });

    if (c.fornecedor_nome) {
        html += `<div style="padding:12px 0;margin-top:8px;border-top:1px solid var(--color-border);font-size:0.88rem">
        <strong>🏢 Fornecedor:</strong> ${escapeHTML(c.fornecedor_nome)}
        ${c.motivo_aguardando ? '<br><small>📌 '+escapeHTML(c.motivo_aguardando)+'</small>' : ''}
        </div>`;
    }
    if (c.motivo) {
        html += `<div style="padding:12px 0;border-top:1px solid var(--color-border);font-size:0.88rem">
        <strong>🔧 Motivo da resolução:</strong><br>${escapeHTML(c.motivo)}
        </div>`;
    }
    html += `</div>`;
    openModal(`📋 Histórico — #${chamadoId}`, html,
        [{ text:'Fechar', cls:'btn-outline', id:'btn-fechar-hist', onClick: closeModal }]);
    } catch (e) {
    showToast('Erro: '+e.message, 'error');
    }
}
// Carrega lista de categorias para o formulário
let ncEquipamentos = [];
async function carregarCategorias() {
    try { categorias = await api('/api/categorias'); } catch(e) { categorias = []; }
}

// Carrega subcategorias com base na categoria selecionada
async function carregarSubcategorias(categoriaId) {
    if (!categoriaId) { document.getElementById('nc-subcategoria').innerHTML = '<option value="">Selecione uma categoria primeiro</option>'; return; }
    try {
    const subs = await api(`/api/subcategorias?categoria_id=${categoriaId}`);
    const sel = document.getElementById('nc-subcategoria');
    if (subs.length) {
        sel.innerHTML = '<option value="">Selecione...</option>' + subs.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
    } else {
        sel.innerHTML = '<option value="">Nenhuma subcategoria</option>';
    }
    } catch(e) { console.error("Erro ao carregar subcategorias:", e); }
}

// Capitaliza o tipo de equipamento (ex.: "caixa de som" -> "Caixa de Som")
function capitalizarTipo(t) {
    if (!t) return 'Equipamento';
    return String(t).split(/[\s_-]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}
// Rótulo do equipamento: código — tipo — marca
function rotuloEquipamento(eq) {
    return (eq.patrimonio || '#' + eq.id) + ' — ' + capitalizarTipo(eq.tipo) + (eq.fabricante ? ' — ' + eq.fabricante : '');
}

// Filtra o select de equipamento conforme o local físico escolhido
function filtrarBemPorLocal() {
    const sel = document.getElementById('nc-bem');
    if (!sel) return;
    const localEl = document.getElementById('nc-local');
    const localId = localEl && localEl.value ? String(localEl.value) : '';
    if (!localId) {
    sel.innerHTML = '<option value="">Selecione um local para listar equipamentos</option>';
    return;
    }
    const lista = ncEquipamentos.filter(eq => String(eq.local_id) === localId);
    if (lista.length) {
    sel.innerHTML = '<option value="">Nenhum</option>' + lista.map(eq => `<option value="${eq.id}">${escapeHTML(rotuloEquipamento(eq))}</option>`).join('');
    } else {
    sel.innerHTML = '<option value="">Nenhum equipamento neste local</option>';
    }
}

// Abre modal de criação de novo chamado
async function abrirModalNovoChamado() {
    await carregarCategorias();
    let locais = [];
    try { locais = await api('/api/locais'); } catch (_) {}
    if (['admin','gestor','tecnico'].includes(AppState.usuario.perfil)) {
    try {
        const ativos = await api('/api/ativos');
        ncEquipamentos = (Array.isArray(ativos) ? ativos : []).filter(eq => !['Desativado','Baixado'].includes(eq.status));
    } catch (_) { ncEquipamentos = []; }
    }
    const optsCat = categorias.length
    ? '<option value="">Selecione...</option>' + categorias.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')
    : '<option value="">Nenhuma categoria cadastrada</option>';
    const bemGroup = ['admin','gestor','tecnico'].includes(AppState.usuario.perfil) ? `<div class="form-group"><label>Equipamento (opcional)</label><select id="nc-bem"><option value="">Selecione um local para listar equipamentos</option></select><small class="text-secondary">Ao escolher um local, a lista mostra os equipamentos daquele ambiente. Ao resolver o chamado, a manutenção será registrada automaticamente no equipamento.</small></div>` : '';
    openModal('➕ Novo Chamado', `<form id="fnc" class="form-grid col-1">
    <div class="form-group"><label>Local físico</label><select id="nc-local" onchange="filtrarBemPorLocal()"><option value="">Problema individual / sem local</option>${locais.map(local => `<option value="${local.id}">${escapeHTML(local.nome)}</option>`).join('')}</select><small class="text-secondary">Escolha o ambiente quando o problema afetar uma sala ou laboratório.</small></div>
    <div class="form-group"><label>Categoria</label><select id="nc-categoria" onchange="carregarSubcategorias(this.value)">${optsCat}</select></div>
    <div class="form-group"><label>Subcategoria</label><select id="nc-subcategoria"><option value="">Selecione uma categoria primeiro</option></select></div>
    ${bemGroup}
    <div class="form-group"><label>Descrição detalhada</label><textarea id="nc-descricao" placeholder="Descreva o problema com detalhes..." required></textarea></div>
    </form>`, [
    { text:'Cancelar', cls:'btn-outline', id:'btn-cancelar-chamado', onClick: closeModal },
    { text:'➕ Abrir Chamado', cls:'btn-primary', id:'btn-abrir-chamado', onClick: async () => {
        const descricao = document.getElementById('nc-descricao').value.trim();
        const subcategoria_id = document.getElementById('nc-subcategoria').value || null;
        const local_id = document.getElementById('nc-local').value || null;
        const bemEl = document.getElementById('nc-bem');
        const bem_id = bemEl && bemEl.value ? parseInt(bemEl.value) : null;
        try {
        const r = await api('/api/chamados', { method:'POST', body:{ titulo: descricao.substring(0, 100), descricao, subcategoria_id: subcategoria_id ? parseInt(subcategoria_id) : null, local_id: local_id ? Number(local_id) : null, bem_id } });
        showToast(r.mensagem, 'success');
        closeModal();
        carregarChamados();
        } catch(err) { showToast(err.message, 'error'); }
    }}
    ]);
}

carregarTudo();
setInterval(carregarChamados, 5000);