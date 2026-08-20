function archiveExoValue(id) {
    const el = document.getElementById(id);
    return el ? (el.value || "").trim() : "";
}

function archiveExoSetResultado(texto) {
    const el = document.getElementById("archiveExoResultado");
    if (el) el.value = texto || "";
}

function archiveExoSetStatus(conectado, texto) {
    const bolinha = document.getElementById("archiveExoBolinha");
    const label = document.getElementById("archiveExoStatus");

    if (bolinha) {
        bolinha.style.background = conectado ? "#28a745" : "#dc3545";
    }

    if (label) {
        label.textContent = texto || (conectado ? "Exchange Online conectado" : "Exchange Online não conectado");
    }
}

async function archiveExoApi(action, user) {
    const url =
        "/module/arquivo-online-exo/api?action=" +
        encodeURIComponent(action || "") +
        "&user=" +
        encodeURIComponent(user || "") +
        "&debug=true";

    const response = await fetch(url, { method: "POST" });
    const text = await response.text();

    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === "string") return JSON.parse(parsed);
        return parsed;
    } catch {
        return {
            success: false,
            error: "Resposta inválida da API.",
            raw: text
        };
    }
}

async function archiveExoVerificarConexao() {
    archiveExoSetResultado("A verificar ligação Exchange Online...");
    archiveExoSetStatus(false, "A verificar Exchange Online...");

    const result = await archiveExoApi("status", "");

    if (result.success && result.data && result.data.connected) {
        archiveExoSetStatus(true, "Exchange Online conectado: " + (result.data.account || ""));
    } else {
        archiveExoSetStatus(false, "Exchange Online não conectado");
    }

    archiveExoSetResultado(JSON.stringify(result, null, 2));
}

async function archiveExoAtivar() {
    const user = archiveExoValue("archiveExoInputUser");

    if (!user) {
        alert("Informe o utilizador, UPN ou email da mailbox.");
        return;
    }

    archiveExoSetStatus(false, "A verificar/conectar Exchange Online...");
    archiveExoSetResultado("A iniciar ativação do Arquivo Online para: " + user);

    try {
        const result = await archiveExoApi("ativar", user);

        if (result.success && result.data && result.data.archiveEnabled) {
            archiveExoSetStatus(true, "Arquivo Online ativo/verificado");
        } else {
            archiveExoSetStatus(false, "Arquivo Online não ativo");
        }

        archiveExoSetResultado(JSON.stringify(result, null, 2));

        const msg =
            result.data?.mensagem ||
            result.error ||
            "Operação concluída.";

        alert(msg);
    }
    catch (e) {
        const erro = "Erro ao ativar Arquivo Online: " + e.message;
        archiveExoSetStatus(false, "Erro");
        archiveExoSetResultado(erro);
        alert(erro);
    }
}

function archiveExoLimpar() {
    const input = document.getElementById("archiveExoInputUser");
    if (input) input.value = "";

    archiveExoSetResultado("Aguardando operação...");
    archiveExoSetStatus(false, "Exchange Online não verificado");
}
