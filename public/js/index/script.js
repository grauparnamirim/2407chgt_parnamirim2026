// Scripts da página de login 

// Variável global de unidades
let unidades = [];
let unidadeFixa = null;

// Preenche o select de unidades; se houver unidade fixa, trava nele
function preencherSelectUnidades(select, fixa) {
    if (!unidades.length) {
        select.innerHTML = '<option value="">Nenhuma unidade cadastrada</option>';
        return;
    }
    select.innerHTML = '<option value="">Selecione a unidade...</option>' +
        unidades.map(u => `<option value="${u.id}">${u.nome}${u.cidade ? ' — ' + u.cidade : ''}</option>`).join('');
    if (fixa) {
        select.value = String(fixa);
        select.disabled = true;
    }
}

// Carrega a lista de unidades e a unidade fixa ao iniciar
(async function carregarUnidades() {
    try {
        const data = await api('/api/unidades', { loadingText: 'Preparando acesso...' });
        unidades = Array.isArray(data) ? data : (data.unidades || []);
        unidadeFixa = Array.isArray(data) ? null : (data.unidade_fixa || null);
        const select = document.getElementById('unidade');
        preencherSelectUnidades(select, unidadeFixa);
        if (!unidadeFixa) {
            const emailAtual = document.getElementById('email').value.trim().toLowerCase();
            const lembrada = emailAtual && localStorage.getItem('chgt_unidade_' + emailAtual);
            if (lembrada && [...select.options].some(o => o.value === lembrada)) select.value = lembrada;
        }
    } catch (err) {
        console.error('Erro ao carregar unidades:', err);
    }
})();

// Dropdown: se houver unidade fixa, fica sempre travado; senão admin, gestor e tecnico podem escolher livremente
document.getElementById('email').addEventListener('blur', function () {
    const email = this.value.trim().toLowerCase();
    const select = document.getElementById('unidade');
    const hint = document.getElementById('unidade-hint');
    if (!email || !unidades.length) return;
    if (unidadeFixa) {
        select.value = String(unidadeFixa);
        select.disabled = true;
        const fixa = unidades.find(u => String(u.id) === String(unidadeFixa));
        hint.textContent = `Unidade fixa do servidor${fixa ? ': ' + fixa.nome : ''}`;
        return;
    }
    select.disabled = false;
    const lembrada = localStorage.getItem('chgt_unidade_' + email);
    if (lembrada && [...select.options].some(o => o.value === lembrada)) {
        select.value = lembrada;
        hint.textContent = 'Unidade da última sessão restaurada — confira';
    } else {
        hint.textContent = 'Selecione sua unidade';
    }
});

// Login: envia credenciais para a API
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const senha = document.getElementById('senha').value;
    const unidade_id = document.getElementById('unidade').value;
    const msgEl = document.getElementById('login-msg');
    msgEl.textContent = '';

    if (!unidade_id) {
        msgEl.textContent = 'Selecione uma unidade.';
        return;
    }

    try {
        const data = await api('/api/login', {
            method: 'POST',
            body: { email, senha, unidade_id: parseInt(unidade_id) },
            loadingText: 'Entrando no sistema...'
        });

        if (!data.sucesso) throw new Error(data.erro || 'Erro no login.');

        AppState.token = data.token;
        AppState.usuario = data.usuario;
        localStorage.setItem('chgt_unidade_' + email.toLowerCase(), String(unidade_id));
        const paginas = { admin: 'painel', gestor: 'painel', tecnico: 'painel', usuario: 'meus-chamados' };
        window.location.href = paginas[data.usuario.perfil] || 'index';
    } catch (err) {
        msgEl.textContent = err.message || 'Erro ao fazer login.';
    }
});
