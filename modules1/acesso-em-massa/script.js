let amOperatorName = "";
let amOperatorMail = "";
let amLinhaIndex = 0;
let amUltimosResultados = [];
let amExecutando = false;

const AM_SERVICENOW_URL = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bb85467db79c0d4f1024dc2ba961997&sysparm_category=93d369bedbf1a700ec3fa5305b96190a";

function amParseApiResponse(raw) {
    if (typeof raw === "string") {
        try { return JSON.parse(raw); }
        catch { return { success: false, error: raw, logs: [] }; }
    }
    return raw || { success: false, error: "Resposta vazia da API.", logs: [] };
}

async function amApi(payload) {
    const jsonPayload = JSON.stringify(payload);
    const action = encodeURIComponent(payload.action || "");
    const url = `/module/acesso-em-massa/api?action=${action}`;

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: jsonPayload
    });

    const rawText = await response.text();
    let raw;

    try { raw = JSON.parse(rawText); }
    catch { raw = rawText; }

    return amParseApiResponse(raw);
}

function amExtractExchangeAccount(logs) {
    for (const linha of (logs || [])) {
        if (linha.includes("Sessão Exchange ativa:")) {
            return linha.split("Sessão Exchange ativa:")[1].trim();
        }
    }
    return "";
}

function amSetExchangeStatus(isConnected, account = "") {
    const box = document.getElementById("amExchangeStatus");
    const titulo = document.getElementById("amExchangeStatusTitulo");
    const texto = document.getElementById("amExchangeStatusTexto");
    const icon = document.getElementById("amConnectIcon");

    if (!box || !titulo || !texto) return;

    box.classList.toggle("am-status-on", isConnected);
    box.classList.toggle("am-status-off", !isConnected);

    if (icon) {
        icon.classList.toggle("am-connect-icon-exo-on", isConnected);
        icon.classList.toggle("am-connect-icon-exo-off", !isConnected);
    }

    titulo.innerText = isConnected ? "Exchange Online conectado" : "Exchange Online desligado";
    texto.innerText = isConnected
        ? (account ? `Sessão ativa com: ${account}` : "Sessão Exchange Online ativa.")
        : "Clique em Conectar Exchange Online antes de executar.";
}

function amEscapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function amAdicionarLinha(user = "", mailbox = "") {
    amLinhaIndex++;
    const tbody = document.getElementById("amTabelaBody");
    if (!tbody) return;

    const tr = document.createElement("tr");
    tr.id = `amLinha_${amLinhaIndex}`;
    tr.dataset.resultIndex = "";

    tr.innerHTML = `
        <td><input class="form-control am-control am-user" placeholder="Ex: e868019 ou user@corp.santander.pt" value="${amEscapeHtml(user)}" onblur="amConsultarLinha('${tr.id}')" oninput="amLimparResultadoLinha('${tr.id}')"></td>
        <td><div class="am-user-info am-info-muted">Aguardando consulta...</div></td>
        <td><input class="form-control am-control am-mailbox" placeholder="Ex: lisboa.centrosantander@santander.pt" value="${amEscapeHtml(mailbox)}" onblur="amConsultarLinha('${tr.id}')" oninput="amLimparResultadoLinha('${tr.id}')"></td>
        <td><div class="am-mailbox-info am-info-muted">Aguardando consulta...</div></td>
        <td><div class="am-line-result am-info-muted">Ainda não executado</div></td>
        <td style="text-align:center;"><button class="am-btn am-btn-danger-soft" onclick="amRemoverLinha('${tr.id}')">Remover</button></td>
    `;

    tbody.appendChild(tr);
    amAtualizarConfiguracao();
}

function amLimparResultadoLinha(id) {
    const tr = document.getElementById(id);
    if (!tr) return;

    tr.dataset.resultIndex = "";
    const result = tr.querySelector(".am-line-result");
    if (result) result.innerHTML = '<span class="am-info-muted">Ainda não executado</span>';
    amUltimosResultados = [];
    amAtualizarConfiguracao();
}

function amRemoverLinha(id) {
    document.getElementById(id)?.remove();
    amAtualizarConfiguracao();
}

function amLimpar() {
    document.getElementById("amTabelaBody").innerHTML = "";
    document.getElementById("amLog").innerText = "";
    document.getElementById("amProgressArea").style.display = "none";
    document.getElementById("amTicketTexto").value = "";

    amUltimosResultados = [];
    amLinhaIndex = 0;
    amAdicionarLinha();
    amAplicarPadroes();
}

function amTipoLabel(tipo) {
    if (tipo === "FullAccessSendAs") return "FullAccess + SendAs";
    return tipo;
}

function amInvalidarResultadosConfiguracao() {
    amUltimosResultados = [];
    document.querySelectorAll("#amTabelaBody tr").forEach((tr) => {
        tr.dataset.resultIndex = "";
        const area = tr.querySelector(".am-line-result");
        if (area) area.innerHTML = '<span class="am-info-muted">Configuração alterada; execute novamente</span>';
    });
    amAtualizarConfiguracao();
}
function amAtualizarConfiguracao() {
    const total = document.querySelectorAll("#amTabelaBody tr").length;
    const operacao = document.getElementById("amOperacao")?.value || "add";
    const tipo = document.getElementById("amTipoAcesso")?.value || "FullAccessSendAs";
    const autoMapping = document.getElementById("amAutoMapping")?.value || "true";
    const autoField = document.getElementById("amAutoMappingField");
    const autoSelect = document.getElementById("amAutoMapping");

    document.getElementById("amTotalLinhas").innerText = total;
    document.getElementById("amOperacaoAtual").innerText = operacao === "add" ? "ADD" : "REMOVE";
    document.getElementById("amTipoAtual").innerText = amTipoLabel(tipo);

    const usaFullAccess = tipo === "FullAccess" || tipo === "FullAccessSendAs";
    document.getElementById("amAutoMappingAtual").innerText = usaFullAccess ? (autoMapping === "true" ? "Sim" : "Não") : "N/A";

    if (autoField && autoSelect) {
        autoField.classList.toggle("am-field-hidden", !usaFullAccess);
        autoSelect.disabled = !usaFullAccess;
    }

    amGerarTextoTicket();
}

function amSetProgress(percent, msg) {
    const area = document.getElementById("amProgressArea");
    const bar = document.getElementById("amProgressBar");
    const txt = document.getElementById("amProgressPercent");
    const mensagem = document.getElementById("amProgressMensagem");

    if (!area || !bar || !txt || !mensagem) return;

    area.style.display = "block";
    bar.style.width = `${percent}%`;
    txt.innerText = `${percent}%`;
    mensagem.innerText = msg;
}

function amSetLog(texto) {
    const log = document.getElementById("amLog");
    if (log) log.innerText = texto || "";
}

function amSetExecuting(value) {
    amExecutando = value;
    const btn = document.getElementById("amExecutarBtn");
    if (btn) {
        btn.disabled = value;
        btn.innerText = value ? "A processar..." : "Executar operação";
    }
}

function amImportarCSV() {
    const input = document.getElementById("amCsvFile");

    if (!input?.files?.length) {
        alert("Selecione um ficheiro CSV.");
        return;
    }

    const reader = new FileReader();

    reader.onload = function (e) {
        const content = String(e.target.result || "").replace(/^\uFEFF/, "");
        const linhas = content.split(/\r?\n/).filter(x => x.trim());

        let inicio = 0;
        if (linhas[0] && /user|utilizador/i.test(linhas[0])) inicio = 1;

        const existentes = new Set(
            Array.from(document.querySelectorAll("#amTabelaBody tr")).map(tr => {
                const u = tr.querySelector(".am-user")?.value.trim().toLowerCase() || "";
                const m = tr.querySelector(".am-mailbox")?.value.trim().toLowerCase() || "";
                return `${u}|${m}`;
            })
        );

        for (let i = inicio; i < linhas.length; i++) {
            const delimitador = linhas[i].includes(";") ? ";" : ",";
            const partes = linhas[i].split(delimitador).map(x => x.trim().replace(/^"|"$/g, ""));
            const user = partes[0] || "";
            const mailbox = partes[1] || "";
            const chave = `${user.toLowerCase()}|${mailbox.toLowerCase()}`;

            if (user && mailbox && !existentes.has(chave)) {
                amAdicionarLinha(user, mailbox);
                existentes.add(chave);
            }
        }

        amAtualizarConfiguracao();
    };

    reader.readAsText(input.files[0], "UTF-8");
}

async function amConectarExchange() {
    const adminUser = document.getElementById("amAdminUser")?.value || "";

    amSetLog("");
    amSetProgress(20, "A abrir autenticação Exchange Online...");

    try {
        const data = await amApi({ action: "connect-exchange", adminUser });
        const logs = data.logs || [];

        if (!data.success) {
            amSetProgress(100, "Erro ao conectar Exchange.");
            amSetExchangeStatus(false);
            amSetLog(`${logs.join("\n")}\n\n${data.error || ""}`.trim());
            return;
        }

        const conta = amExtractExchangeAccount(logs);
        amSetProgress(100, "Exchange Online conectado.");
        amSetExchangeStatus(true, conta);
        amSetLog(logs.join("\n"));
    } catch (e) {
        amSetProgress(100, "Erro na comunicação.");
        amSetExchangeStatus(false);
        amSetLog(e.message);
    }
}

async function amAtualizarStatusExchange() {
    try {
        const data = await amApi({ action: "exchange-status" });
        amSetExchangeStatus(Boolean(data.success && data.connected), data.account || "");
    } catch {
        amSetExchangeStatus(false);
    }
}

async function amExecutar() {
    if (amExecutando) return;

    const operacao = document.getElementById("amOperacao").value;
    const tipoAcesso = document.getElementById("amTipoAcesso").value;
    const autoMapping = document.getElementById("amAutoMapping").value;
    const linhas = [];

    document.querySelectorAll("#amTabelaBody tr").forEach((tr, index) => {
        const user = tr.querySelector(".am-user").value.trim();
        const mailbox = tr.querySelector(".am-mailbox").value.trim();

        if (user && mailbox) {
            linhas.push({ user, mailbox, rowId: tr.id, clientIndex: index });
        }
    });

    if (!linhas.length) {
        alert("Informe pelo menos uma linha com utilizador e mailbox/LD.");
        return;
    }

    amSetExecuting(true);
    amSetLog("");
    amSetProgress(10, "A preparar pedido...");

    try {
        amSetProgress(30, "A enviar pedido para o servidor...");

        const data = await amApi({
            action: "executar",
            operacao,
            tipoAcesso,
            autoMapping,
            linhas: linhas.map(({ user, mailbox }) => ({ user, mailbox }))
        });

        const logs = data.logs || [];
        const conta = amExtractExchangeAccount(logs);
        if (conta) amSetExchangeStatus(true, conta);

        if (!data.success) {
            amSetProgress(100, "Erro na execução.");
            amSetLog(`${data.error ? `ERRO: ${data.error}\n\n` : ""}${logs.join("\n")}`.trim());
            return;
        }

        amUltimosResultados = data.resultados || [];
        amRenderResultados(linhas, amUltimosResultados);
        amSetProgress(100, `Concluído: ${data.totalOk || 0} operação(ões), ${data.totalIgnorado || 0} ignorada(s), ${data.totalErro || 0} erro(s).`);
        amSetLog(logs.join("\n"));
        amGerarTextoTicket();
    } catch (e) {
        amSetProgress(100, "Erro na comunicação.");
        amSetLog(e.message);
    } finally {
        amSetExecuting(false);
    }
}

function amStatusBadge(label, status) {
    const css = status === "ok" ? "am-result-ok" : status === "ignored" ? "am-result-ignored" : "am-result-error";
    const texto = status === "ok" ? "OK" : status === "ignored" ? "Já estava" : "Erro";
    return `<span class="am-result-badge ${css}">${amEscapeHtml(label)}: ${texto}</span>`;
}

function amRenderResultados(linhasEnviadas, resultados) {
    linhasEnviadas.forEach((linha, index) => {
        const tr = document.getElementById(linha.rowId);
        const resultado = resultados[index];
        if (!tr || !resultado) return;

        tr.dataset.resultIndex = String(index);
        const area = tr.querySelector(".am-line-result");
        const partes = [];

        if (resultado.fullAccess !== "not-requested") partes.push(amStatusBadge("FullAccess", resultado.fullAccess));
        if (resultado.sendAs !== "not-requested") partes.push(amStatusBadge("SendAs", resultado.sendAs));

        if (resultado.error) {
            partes.push(`<div class="am-info-muted">${amEscapeHtml(resultado.error)}</div>`);
        }

        area.innerHTML = partes.join(" ") || '<span class="am-info-muted">Sem resultado</span>';
    });
}

async function amConsultarIdentidade(valor, tipoConsulta) {
    if (!valor) return null;

    const data = await amApi({
        action: "consultar-identidade",
        valor,
        tipoConsulta
    });

    if (!data.success) {
        return { encontrado: false, mensagem: data.error || "Erro na consulta" };
    }

    return data.resultado;
}

async function amConsultarLinha(rowId) {
    const tr = document.getElementById(rowId);
    if (!tr) return;

    const userInput = tr.querySelector(".am-user");
    const mailboxInput = tr.querySelector(".am-mailbox");
    const userInfo = tr.querySelector(".am-user-info");
    const mailboxInfo = tr.querySelector(".am-mailbox-info");

    const user = userInput.value.trim();
    const mailbox = mailboxInput.value.trim();

    if (user) {
        userInfo.innerHTML = "A consultar...";
        try {
            const rUser = await amConsultarIdentidade(user, "user");
            if (rUser?.encontrado) {
                userInfo.innerHTML = `<span class="am-info-badge">${amEscapeHtml(rUser.email || rUser.nome || "")}</span>`;
                userInfo.dataset.email = rUser.email || "";
                userInfo.dataset.nome = rUser.nome || "";
            } else {
                userInfo.innerHTML = '<span class="am-info-muted">Não encontrado</span>';
                userInfo.dataset.email = "";
                userInfo.dataset.nome = "";
            }
        } catch {
            userInfo.innerHTML = '<span class="am-info-muted">Erro consulta</span>';
        }
    }

    if (mailbox) {
        mailboxInfo.innerHTML = "A consultar...";
        try {
            const rMailbox = await amConsultarIdentidade(mailbox, "mailbox");
            if (rMailbox?.encontrado) {
                mailboxInfo.innerHTML = `<span class="am-info-badge">${amEscapeHtml(rMailbox.recipientTypeDetails || "")}</span>`;
                mailboxInfo.dataset.tipo = rMailbox.recipientTypeDetails || "";
                mailboxInfo.dataset.email = rMailbox.email || "";
                mailboxInfo.dataset.nome = rMailbox.nome || "";
            } else {
                mailboxInfo.innerHTML = '<span class="am-info-muted">Não encontrado</span>';
                mailboxInfo.dataset.tipo = "";
                mailboxInfo.dataset.email = "";
                mailboxInfo.dataset.nome = "";
            }
        } catch {
            mailboxInfo.innerHTML = '<span class="am-info-muted">Erro consulta</span>';
        }
    }

    amGerarTextoTicket();
}

function amSaudacaoAtual() {
    const minutos = new Date().getHours() * 60 + new Date().getMinutes();
    if (minutos >= 1 && minutos <= 720) return "Bom dia";
    if (minutos >= 721 && minutos <= 1080) return "Boa tarde";
    return "Boa noite";
}

async function amCopiarTexto(texto) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
        return;
    }

    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
}

async function amCopiarTicket() {
    const el = document.getElementById("amTicketTexto");
    if (!el) return;

    if (!el.value) amGerarTextoTicket();

    try {
        await amCopiarTexto(el.value);
        alert("Texto copiado para a área de transferência.");
    } catch (e) {
        alert(`Não foi possível copiar o texto: ${e.message}`);
    }
}

async function amAbrirServiceNow() {
    amGerarTextoTicket();
    const texto = document.getElementById("amTicketTexto")?.value || "";

    try {
        if (texto) await amCopiarTexto(texto);
    } catch {}

    window.open(AM_SERVICENOW_URL, "_blank", "noopener,noreferrer");
    alert("O texto do ticket foi copiado. Cole-o no campo de detalhes do ServiceNow.");
}

async function amLoadOperator() {
    try {
        const data = await amApi({ action: "current-operator" });
        if (!data.success || !data.operator) return;

        amOperatorName = data.operator.DisplayName || data.operator.displayName || data.operator.SamAccountName || data.operator.samAccountName || "";
        amOperatorMail = data.operator.Email || data.operator.email || "";

        if (amOperatorName) localStorage.setItem("amOperatorName", amOperatorName);
        if (amOperatorMail) localStorage.setItem("amOperatorMail", amOperatorMail);
    } catch {}
}

function amGetAssinatura() {
    const nome = amOperatorName || localStorage.getItem("amOperatorName") || "";
    return nome && nome !== "IT Santander Portugal"
        ? `${nome}\nIT Santander Portugal`
        : "IT Santander Portugal";
}

function amResultadoDescricao(resultado, operacao) {
    const itens = [];

    const verboOk = operacao === "add" ? "adicionado" : "removido";
    const verboIgnorado = operacao === "add" ? "já existia" : "não existia";

    if (resultado.fullAccess !== "not-requested") {
        itens.push(`FullAccess: ${resultado.fullAccess === "ok" ? verboOk : resultado.fullAccess === "ignored" ? verboIgnorado : "erro"}`);
    }

    if (resultado.sendAs !== "not-requested") {
        itens.push(`SendAs: ${resultado.sendAs === "ok" ? verboOk : resultado.sendAs === "ignored" ? verboIgnorado : "erro"}`);
    }

    return itens.join(" | ");
}

function amGerarTextoTicket() {
    const operacao = document.getElementById("amOperacao")?.value || "add";
    const tipoAcesso = document.getElementById("amTipoAcesso")?.value || "FullAccessSendAs";
    const autoMapping = document.getElementById("amAutoMapping")?.value === "true" ? "Sim" : "Não";
    const linhasTexto = [];

    document.querySelectorAll("#amTabelaBody tr").forEach((tr) => {
        const user = tr.querySelector(".am-user")?.value.trim() || "";
        const mailbox = tr.querySelector(".am-mailbox")?.value.trim() || "";
        if (!user || !mailbox) return;

        const userInfo = tr.querySelector(".am-user-info");
        const mailboxInfo = tr.querySelector(".am-mailbox-info");
        const emailUser = userInfo?.dataset.email || "";
        const tipoMailbox = mailboxInfo?.dataset.tipo || "";
        const resultIndex = tr.dataset.resultIndex;
        const resultado = resultIndex !== "" ? amUltimosResultados[Number(resultIndex)] : null;

        let acao;
        if (!resultado) {
            acao = `Pendente de execução: acesso ${amTipoLabel(tipoAcesso)} para o utilizador ${user}`;
        } else if (resultado.success) {
            acao = operacao === "add"
                ? `Foi concedido o acesso ${amTipoLabel(tipoAcesso)} ao utilizador ${user}`
                : `Foi removido o acesso ${amTipoLabel(tipoAcesso)} do utilizador ${user}`;
        } else {
            acao = `Não foi possível concluir integralmente o acesso ${amTipoLabel(tipoAcesso)} para o utilizador ${user}`;
        }

        if (emailUser) acao += ` / ${emailUser}`;
        acao += ` na mailbox ${mailbox}.`;
        if (tipoMailbox) acao += `\nTipo do destino: ${tipoMailbox}.`;
        if ((tipoAcesso === "FullAccess" || tipoAcesso === "FullAccessSendAs") && operacao === "add") {
            acao += `\nAutoMapping do FullAccess: ${autoMapping}.`;
        }
        if (resultado) acao += `\nResultado: ${amResultadoDescricao(resultado, operacao)}.`;
        if (resultado?.error) acao += `\nObservação: ${resultado.error.trim()}`;

        linhasTexto.push(acao);
    });

    const descricao = linhasTexto.length
        ? linhasTexto.join("\n\n")
        : "Nenhuma alteração foi executada ou registada.";

    const texto =
`${amSaudacaoAtual()},

Foram feitas as seguintes alterações:

${descricao}

A replicação poderá demorar +/-48 horas a aplicar.

Atenciosamente,

${amGetAssinatura()}`;

    const el = document.getElementById("amTicketTexto");
    if (el) el.value = texto;
}

function amAplicarPadroes() {
    const operacao = document.getElementById("amOperacao");
    const tipo = document.getElementById("amTipoAcesso");
    const auto = document.getElementById("amAutoMapping");

    if (operacao) operacao.value = "add";
    if (tipo) tipo.value = "FullAccessSendAs";
    if (auto) auto.value = "true";

    amAtualizarConfiguracao();
}

setTimeout(async () => {
    await amLoadOperator();

    const tbody = document.getElementById("amTabelaBody");
    if (tbody && tbody.children.length === 0) amAdicionarLinha();

    amAplicarPadroes();
    await amAtualizarStatusExchange();
}, 300);