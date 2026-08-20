function iniciarResetMFA() {
    adicionarLogResetMFA("Módulo Reset MFA carregado.");
    verificarSessaoGraphResetMFA();
}

function adicionarLogResetMFA(mensagem) {
    const logs = document.getElementById("resetMfaLogs");

    if (!logs) return;

    const hora = new Date().toLocaleTimeString();

    if (logs.innerText.includes("Aguardando operação")) {
        logs.innerText = "";
    }

    logs.innerText += `[${hora}] ${mensagem}\n`;
    logs.scrollTop = logs.scrollHeight;
}

function verificarSessaoGraphResetMFA() {
    const status = document.getElementById("resetMfaGraphStatus");

    if (status) {
        status.innerHTML = `<span class="text-warning">Sessão Graph ainda não verificada.</span>`;
    }

    adicionarLogResetMFA("Verificação inicial da sessão Graph.");
}

function conectarGraphResetMFA() {
    adicionarLogResetMFA("Pedido de conexão ao Microsoft Graph iniciado.");

    document.getElementById("resetMfaGraphStatus").innerHTML = `
        <span class="text-warning">A conectar ao Microsoft Graph...</span>
    `;

    // Fase 3: ligar ao backend PowerShell
}

function pesquisarUtilizadorResetMFA() {
    const user = document.getElementById("resetMfaUserInput").value.trim();

    if (!user) {
        adicionarLogResetMFA("Informe um utilizador para pesquisar.");
        alert("Informe um utilizador.");
        return;
    }

    adicionarLogResetMFA("Pesquisa iniciada para: " + user);

    document.getElementById("resetMfaResultado").innerHTML = `
        <div class="alert alert-info">
            Pesquisa preparada para: <strong>${user}</strong>
            <br>
            Na próxima fase será ligada ao backend PowerShell.
        </div>
    `;
}

function limparResetMFA() {
    document.getElementById("resetMfaUserInput").value = "";
    document.getElementById("resetMfaResultado").innerHTML = "Nenhum utilizador pesquisado.";
    document.getElementById("resetMfaLogs").innerText = "Aguardando operação...";

    adicionarLogResetMFA("Campos limpos.");
}
