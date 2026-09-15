// Scripts da página de setores

// Previne submit acidental ao pressionar Enter
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); }
});

// Verifica autenticação e permissões
verificarAutenticacao();
const u = AppState.usuario;
if (!u) { window.location.href = '/'; }
else if (!['admin','gestor','tecnico'].includes(u.perfil) && !temPermissao('setores.ver')) {
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
        html += `<a href="setores" class="active"><span class="nav-icon"><iconify-icon icon="mdi:domain" width="20" height="20"></iconify-icon></span> Setores</a>`;
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

// Oculta botão "Novo setor" se não tiver permissão
(function() {
    const btnNovo = document.getElementById('btn-novo-setor');
    if (btnNovo && !temPermissao('setores.criar')) btnNovo.style.display = 'none';
})();

// Armazena a lista completa de setores
let setoresAtuais = [];

// Renderiza a tabela de setores com busca
function renderizarSetores() {
    const tbody = document.getElementById('tabela-setores');
    const termo = document.getElementById('busca-setores')?.value.trim().toLocaleLowerCase('pt-BR') || '';
    const setores = setoresAtuais.filter(setor => setor.nome.toLocaleLowerCase('pt-BR').includes(termo));
    const podeEditar = temPermissao('setores.editar');
    const podeExcluir = temPermissao('setores.excluir');
    const contador = document.getElementById('setores-contagem');
    document.getElementById('setores-total').textContent = setoresAtuais.length;

    if (contador) {
    contador.textContent = termo
        ? `${setores.length} de ${setoresAtuais.length} ${setoresAtuais.length === 1 ? 'setor encontrado' : 'setores encontrados'}`
        : `${setoresAtuais.length} ${setoresAtuais.length === 1 ? 'setor cadastrado' : 'setores cadastrados'}`;
    }
    if (!setoresAtuais.length) {
    tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state setores-vazio"><div class="empty-icon"><iconify-icon icon="mdi:domain-plus" width="42" height="42"></iconify-icon></div><h3>Nenhum setor cadastrado</h3><p>Cadastre os setores administrativos para começar a organizar a operação.</p>${temPermissao('setores.criar') ? '<button class="btn btn-primary btn-sm" onclick="abrirModalNovoSetor()"><iconify-icon icon="mdi:plus" width="17" height="17"></iconify-icon> Cadastrar primeiro setor</button>' : ''}</div></td></tr>`;
    return;
    }
    if (!setores.length) {
    tbody.innerHTML = '<tr><td colspan="4"><div class="empty-state setores-vazio"><div class="empty-icon"><iconify-icon icon="mdi:magnify-remove-outline" width="42" height="42"></iconify-icon></div><h3>Nenhum setor encontrado</h3><p>Tente outro termo na busca.</p><button class="btn btn-outline btn-sm" onclick="limparBuscaSetores()">Limpar busca</button></div></td></tr>';
    return;
    }
    tbody.innerHTML = setores.map(setor => {
    const btnEditar = podeEditar ? `<button class="btn btn-outline btn-sm" onclick="editarSetor(${setor.id})" title="Editar ${escapeHTML(setor.nome)}"><iconify-icon icon="mdi:pencil-outline" width="15" height="15"></iconify-icon><span>Editar</span></button>` : '';
    const btnExcluir = podeExcluir ? `<button class="btn btn-danger btn-sm" onclick="excluirSetor(${setor.id})" title="Excluir ${escapeHTML(setor.nome)}"><iconify-icon icon="mdi:delete-outline" width="15" height="15"></iconify-icon><span>Excluir</span></button>` : '';
    const acoes = [btnEditar, btnExcluir].filter(Boolean).join('') || '<span class="text-secondary">Somente leitura</span>';
    return `<tr>
        <td><div class="setor-nome"><span class="setor-nome-icone"><iconify-icon icon="mdi:office-building-outline" width="19" height="19"></iconify-icon></span><div><strong>${escapeHTML(setor.nome)}</strong><small>Setor administrativo</small></div></div></td>
        <td><span class="setor-id">#${setor.id}</span></td>
        <td><span class="setor-uso"><iconify-icon icon="mdi:account-group-outline" width="15" height="15"></iconify-icon> Usuários e relatórios</span></td>
        <td class="setores-acoes">${acoes}</td>
    </tr>`;
    }).join('');
}

// Limpa o campo de busca e re-renderiza
function limparBuscaSetores() {
    const campo = document.getElementById('busca-setores');
    if (campo) { campo.value = ''; campo.focus(); }
    renderizarSetores();
}

// Carrega a lista de setores da API
async function carregarSetores() {
    const tbody = document.getElementById('tabela-setores');
    if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center text-secondary">Atualizando setores...</td></tr>';
    try {
    setoresAtuais = await api('/api/setores');
    renderizarSetores();
    } catch(e) {
    setoresAtuais = [];
    document.getElementById('setores-total').textContent = '—';
    document.getElementById('setores-contagem').textContent = 'Não foi possível carregar os setores.';
    if (tbody) tbody.innerHTML = `<tr><td colspan="4"><div class="empty-state setores-vazio"><div class="empty-icon"><iconify-icon icon="mdi:alert-circle-outline" width="42" height="42"></iconify-icon></div><h3>Não foi possível carregar os setores</h3><p>${escapeHTML(e.message || 'Tente atualizar a página.')}</p><button class="btn btn-outline btn-sm" onclick="carregarSetores()"><iconify-icon icon="mdi:refresh" width="16" height="16"></iconify-icon> Tentar novamente</button></div></td></tr>`;
    showToast('Erro: '+e.message, 'error');
    }
}

// Abre modal para cadastrar novo setor
function abrirModalNovoSetor() {
    openModal('Novo setor', '<form id="fnset" class="form-grid col-1 setores-modal-form"><div class="setores-modal-intro"><span><iconify-icon icon="mdi:domain-plus" width="23" height="23"></iconify-icon></span><div><strong>Identifique o setor administrativo</strong><p>Use um nome claro, como “Secretaria”, “Coordenação Pedagógica” ou “Recepção”.</p></div></div><div class="form-group"><label>Nome do setor *</label><input id="nset-nome" maxlength="100" placeholder="Ex: Secretaria" required autofocus></div></form>', [
    { text:'Cancelar', cls:'btn-outline', id:'btn-cancelar-set', onClick: closeModal },
    { text:'💾 Salvar', cls:'btn-primary', id:'btn-salvar-set', onClick: async () => {
        const nome = document.getElementById('nset-nome').value.trim();
        if (!nome) { showToast('Informe o nome.', 'error'); return; }
        try { await api('/api/setores', { method:'POST', body:{ nome } }); showToast('Setor criado!', 'success'); closeModal(); carregarSetores(); } catch(err) { showToast(err.message, 'error'); }
    }}
    ]);
}

// Abre modal para editar um setor
function editarSetor(id) {
    const setor = setoresAtuais.find(item => Number(item.id) === Number(id));
    if (!setor) return;
    openModal('Editar setor', `<form id="feset" class="form-grid col-1 setores-modal-form"><div class="setores-modal-intro"><span><iconify-icon icon="mdi:pencil-outline" width="23" height="23"></iconify-icon></span><div><strong>Atualize a identificação</strong><p>As referências existentes continuarão vinculadas a este setor.</p></div></div><div class="form-group"><label>Nome do setor *</label><input id="eset-nome" maxlength="100" value="${escapeHTML(setor.nome)}" required autofocus></div></form>`, [
    { text:'Cancelar', cls:'btn-outline', id:'btn-cancelar-editset', onClick: closeModal },
    { text:'💾 Salvar', cls:'btn-primary', id:'btn-salvar-editset', onClick: async () => {
        const nome = document.getElementById('eset-nome').value.trim();
        if (!nome) { showToast('Informe o nome.', 'error'); return; }
        try { await api(`/api/setores/${id}`, { method:'PUT', body:{ nome } }); showToast('Setor atualizado!', 'success'); closeModal(); carregarSetores(); } catch(err) { showToast(err.message, 'error'); }
    }}
    ]);
}

// Abre confirmação para excluir um setor
function excluirSetor(id) {
    const setor = setoresAtuais.find(item => Number(item.id) === Number(id));
    if (!setor) return;
    openModal('Excluir setor', `<div class="setores-excluir-aviso"><span><iconify-icon icon="mdi:alert-outline" width="24" height="24"></iconify-icon></span><div><strong>Excluir “${escapeHTML(setor.nome)}”?</strong><p>Essa ação não pode ser desfeita. Se o setor estiver sendo usado, o sistema informará antes de concluir.</p></div></div>`, [
    { text:'Cancelar', cls:'btn-outline', id:'btn-cancelar-delset', onClick: closeModal },
    { text:'🗑️ Excluir', cls:'btn-danger', id:'btn-confirmar-delset', onClick: async () => {
        try { await api(`/api/setores/${id}`, { method:'DELETE' }); showToast('Setor excluído!', 'success'); closeModal(); carregarSetores(); } catch(err) { showToast(err.message, 'error'); }
    }}
    ]);
}

// Logout com confirmação
document.getElementById('sidebar-logout').addEventListener('click', function(e) {
    e.preventDefault();
    openModal('🚪 Sair do Sistema', '<p>Tem certeza que deseja sair?</p>', [
    { text:'Cancelar', cls:'btn-outline', id:'btn-cancelar-logout', onClick: closeModal },
    { text:'✅ Sair', cls:'btn-danger', id:'btn-confirmar-logout', onClick: () => AppState.logout() }
    ]);
});

carregarSetores();