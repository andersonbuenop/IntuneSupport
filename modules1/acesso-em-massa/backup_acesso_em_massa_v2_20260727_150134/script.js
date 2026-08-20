let amOperatorName = '';
let amOperatorMail = '';
let amLinhaIndex = 0;

function amParseApiResponse(raw) {
    if (typeof raw === "string") {
        try {
            return JSON.parse(raw);
        } catch {
            return {
                success: false,
                error: raw,
                logs: []
            };
        }
    }

    return raw || {
        success: false,
        error: "Resposta vazia da API.",
        logs: []
    };
}

function amExtractExchangeAccount(logs) {
    logs = logs || [];

    for (const linha of logs) {
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

    if (isConnected) {
        box.classList.remove("am-status-off");
        box.classList.add("am-status-on");

        if (icon) {
            icon.classList.remove("am-connect-icon-exo-off");
            icon.classList.add("am-connect-icon-exo-on");
        }

        titulo.innerText = "Exchange Online conectado";
        texto.innerText = account
            ? "Sessão ativa com: " + account
            : "Sessão Exchange Online ativa.";

        localStorage.setItem("amExchangeConnected", "true");
        localStorage.setItem("amExchangeAccount", account || "");
    } else {
        box.classList.remove("am-status-on");
        box.classList.add("am-status-off");

        if (icon) {
            icon.classList.remove("am-connect-icon-exo-on");
            icon.classList.add("am-connect-icon-exo-off");
        }

        titulo.innerText = "Exchange Online desligado";
        texto.innerText = "Clique em Conectar Exchange Online antes de executar.";

        localStorage.removeItem("amExchangeConnected");
        localStorage.removeItem("amExchangeAccount");
    }
}

function amEscapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function amAdicionarLinha(user = "", mailbox = "") {
    amLinhaIndex++;

    const tbody = document.getElementById("amTabelaBody");

    const tr = document.createElement("tr");
    tr.id = "amLinha_" + amLinhaIndex;

    tr.innerHTML = `
        <td>
            <input class="form-control am-control am-user"
                   placeholder="Ex: e868019 ou user@corp.santander.pt"
                   value="${amEscapeHtml(user)}"
                   onblur="amConsultarLinha('${tr.id}')"
                   oninput="amAtualizarTotais()">
        </td>
        <td>
            <div class="am-user-info am-info-muted">Aguardando consulta...</div>
        </td>
        <td>
            <input class="form-control am-control am-mailbox"
                   placeholder="Ex: lisboa.centrosantander@santander.pt"
                   value="${amEscapeHtml(mailbox)}"
                   onblur="amConsultarLinha('${tr.id}')"
                   oninput="amAtualizarTotais()">
        </td>
        <td>
            <div class="am-mailbox-info am-info-muted">Aguardando consulta...</div>
        </td>
        <td style="text-align:center;">
            <button class="am-btn am-btn-danger-soft" onclick="amRemoverLinha('${tr.id}')">Remover</button>
        </td>
    `;

    tbody.appendChild(tr);
    amAtualizarTotais();
}

function amRemoverLinha(id) {
    const el = document.getElementById(id);

    if (el) {
        el.remove();
    }

    amAtualizarTotais();
}

function amLimpar() {
    document.getElementById("amTabelaBody").innerHTML = "";
    document.getElementById("amLog").innerText = "";
    document.getElementById("amProgressArea").style.display = "none";

    amLinhaIndex = 0;
    amAdicionarLinha();
    amAtualizarTotais();
}

function amAtualizarTotais() {
    const total = document.querySelectorAll("#amTabelaBody tr").length;
    const operacao = document.getElementById("amOperacao")?.value || "add";
    const tipo = document.getElementById("amTipoAcesso")?.value || "FullAccess";
    const autoMapping = document.getElementById("amAutoMapping")?.value || "true";

    document.getElementById("amTotalLinhas").innerText = total;
    document.getElementById("amOperacaoAtual").innerText = operacao === "add" ? "ADD" : "REMOVE";
    document.getElementById("amTipoAtual").innerText = tipo;
    document.getElementById("amAutoMappingAtual").innerText = autoMapping === "true" ? "Sim" : "Não";
}

function amSetProgress(percent, msg) {
    const area = document.getElementById("amProgressArea");
    const bar = document.getElementById("amProgressBar");
    const txt = document.getElementById("amProgressPercent");
    const mensagem = document.getElementById("amProgressMensagem");

    area.style.display = "block";
    bar.style.width = percent + "%";
    txt.innerText = percent + "%";
    mensagem.innerText = msg;
}

function amSetLog(texto) {
    document.getElementById("amLog").innerText = texto || "";
}

function amImportarCSV() {
    const input = document.getElementById("amCsvFile");

    if (!input.files || input.files.length === 0) {
        alert("Selecione um ficheiro CSV.");
        return;
    }

    const file = input.files[0];
    const reader = new FileReader();

    reader.onload = function (e) {
        const content = e.target.result || "";
        const linhas = content.split(/\r?\n/).filter(x => x.trim() !== "");

        let inicio = 0;

        if (linhas[0]?.toLowerCase().includes("user")) {
            inicio = 1;
        }

        for (let i = inicio; i < linhas.length; i++) {
            const linha = linhas[i].trim();

            if (!linha) continue;

            const partes = linha.includes(";")
                ? linha.split(";")
                : linha.split(",");

            const user = (partes[0] || "").trim();
            const mailbox = (partes[1] || "").trim();

            if (user && mailbox) {
                amAdicionarLinha(user, mailbox);
            }
        }

        amAtualizarTotais();
    };

    reader.readAsText(file, "UTF-8");
}

async function amConectarExchange() {
    const adminUser = document.getElementById("amAdminUser")?.value || "";

    const payload = {
        action: "connect-exchange",
        adminUser: adminUser
    };

    amSetLog("");
    amSetProgress(20, "A abrir autenticação Exchange Online...");

    try {
        const jsonPayload = JSON.stringify(payload);
        const url = "/module/acesso-em-massa/api?action=connect-exchange&payload=" + encodeURIComponent(jsonPayload);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: jsonPayload
        });

        const raw = await response.json();
        const data = amParseApiResponse(raw);
        const logs = data.logs || [];

        if (!data.success) {
            amSetProgress(100, "Erro ao conectar Exchange.");
            amSetExchangeStatus(false);
            amSetLog(logs.join("\n") + "\n\n" + (data.error || ""));
            return;
        }

        const conta = amExtractExchangeAccount(logs);

        amSetProgress(100, "Exchange Online conectado.");
        amSetExchangeStatus(true, conta);
        amSetLog(logs.join("\n"));
    }
    catch (e) {
        amSetProgress(100, "Erro na comunicação.");
        amSetExchangeStatus(false);
        amSetLog(e.message);
    }
}

async function amExecutar() {
    const operacao = document.getElementById("amOperacao").value;
    const tipoAcesso = document.getElementById("amTipoAcesso").value;
    const autoMapping = document.getElementById("amAutoMapping").value;

    const linhas = [];

    document.querySelectorAll("#amTabelaBody tr").forEach(tr => {
        const user = tr.querySelector(".am-user").value.trim();
        const mailbox = tr.querySelector(".am-mailbox").value.trim();

        if (user && mailbox) {
            linhas.push({
                user: user,
                mailbox: mailbox
            });
        }
    });

    if (linhas.length === 0) {
        alert("Informe pelo menos uma linha com utilizador e mailbox/LD.");
        return;
    }

    const payload = {
        action: "executar",
        operacao: operacao,
        tipoAcesso: tipoAcesso,
        autoMapping: autoMapping,
        linhas: linhas
    };

    amSetLog("");
    amSetProgress(10, "A preparar pedido...");

    try {
        const jsonPayload = JSON.stringify(payload);
        const url = "/module/acesso-em-massa/api?action=executar&payload=" + encodeURIComponent(jsonPayload);

        amSetProgress(30, "A enviar pedido para o servidor...");

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: jsonPayload
        });

        amSetProgress(70, "A processar permissões no Exchange Online...");

        const raw = await response.json();
        const data = amParseApiResponse(raw);
        const logs = data.logs || [];

        const conta = amExtractExchangeAccount(logs);

        if (conta) {
            amSetExchangeStatus(true, conta);
        }

        if (!data.success) {
            amSetProgress(100, "Erro na execução.");

            let textoErro = "";

            if (data.error) {
                textoErro += "ERRO: " + data.error + "\n\n";
            }

            if (logs.length > 0) {
                textoErro += logs.join("\n");
            }

            amSetLog(textoErro || "Erro desconhecido.");
            return;
        }

        amSetProgress(100, "Operação concluída.");
amSetLog(logs.join("\n"));
amGerarTextoTicket();
    }
    catch (e) {
        amSetProgress(100, "Erro na comunicação.");
        amSetLog(e.message);
    }
}

setTimeout(() => {
    amLoadOperator();
    const tbody = document.getElementById("amTabelaBody");

    if (tbody && tbody.children.length === 0) {
        amAdicionarLinha();
    }

    const auto = document.getElementById("amAutoMapping");

    if (auto) {
        auto.value = "true";
    }

    const wasConnected = localStorage.getItem("amExchangeConnected") === "true";
    const account = localStorage.getItem("amExchangeAccount") || "";

    if (wasConnected) {
        amSetExchangeStatus(true, account);
    } else {
        amSetExchangeStatus(false);
    }

    amAtualizarTotais();
}, 300);

async function amConsultarIdentidade(valor, tipoConsulta) {
    if (!valor) return null;

    const payload = {
        action: "consultar-identidade",
        valor: valor,
        tipoConsulta: tipoConsulta
    };

    const jsonPayload = JSON.stringify(payload);
    const url = "/module/acesso-em-massa/api?action=consultar-identidade&payload=" + encodeURIComponent(jsonPayload);

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: jsonPayload
    });

    const raw = await response.json();
    const data = amParseApiResponse(raw);

    if (!data.success) {
        return {
            encontrado: false,
            mensagem: data.error || "Erro na consulta"
        };
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

            if (rUser && rUser.encontrado) {
                userInfo.innerHTML = `<span class="am-info-badge">${amEscapeHtml(rUser.email || "")}</span>`;
                userInfo.dataset.email = rUser.email || "";
                userInfo.dataset.nome = rUser.nome || "";
            } else {
                userInfo.innerHTML = `<span class="am-info-muted">Não encontrado</span>`;
                userInfo.dataset.email = "";
                userInfo.dataset.nome = "";
            }
        } catch (e) {
            userInfo.innerHTML = `<span class="am-info-muted">Erro consulta</span>`;
        }
    }

    if (mailbox) {
        mailboxInfo.innerHTML = "A consultar...";

        try {
            const rMailbox = await amConsultarIdentidade(mailbox, "mailbox");

            if (rMailbox && rMailbox.encontrado) {
                mailboxInfo.innerHTML = `<span class="am-info-badge">${amEscapeHtml(rMailbox.recipientTypeDetails || "")}</span>`;
                mailboxInfo.dataset.tipo = rMailbox.recipientTypeDetails || "";
                mailboxInfo.dataset.email = rMailbox.email || "";
                mailboxInfo.dataset.nome = rMailbox.nome || "";
            } else {
                mailboxInfo.innerHTML = `<span class="am-info-muted">Não encontrado</span>`;
                mailboxInfo.dataset.tipo = "";
                mailboxInfo.dataset.email = "";
                mailboxInfo.dataset.nome = "";
            }
        } catch (e) {
            mailboxInfo.innerHTML = `<span class="am-info-muted">Erro consulta</span>`;
        }
    }

    amGerarTextoTicket();
}

function amSaudacaoAtual() {
    const agora = new Date();
    const minutos = agora.getHours() * 60 + agora.getMinutes();

    if (minutos >= 1 && minutos <= 720) {
        return "Bom dia";
    }

    if (minutos >= 721 && minutos <= 1080) {
        return "Boa tarde";
    }

    return "Boa noite";
}



function amCopiarTicket() {
    const el = document.getElementById("amTicketTexto");

    if (!el) return;

    if (!el.value) {
        amGerarTextoTicket();
    }

    el.select();
    document.execCommand("copy");

    alert("Texto copiado para a área de transferência.");
}





async function amLoadOperator() {
    try {
        const payload = {
            action: "current-operator"
        };

        const jsonPayload = JSON.stringify(payload);
        const url = "/module/acesso-em-massa/api?action=current-operator&payload=" + encodeURIComponent(jsonPayload);

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: jsonPayload
        });

        const raw = await response.json();
        const data = amParseApiResponse(raw);

        if (!data.success || !data.operator) return;

        amOperatorName =
            data.operator.DisplayName ||
            data.operator.displayName ||
            data.operator.SamAccountName ||
            data.operator.samAccountName ||
            "";

        amOperatorMail =
            data.operator.Email ||
            data.operator.email ||
            "";

        if (amOperatorName) {
            localStorage.setItem("amOperatorName", amOperatorName);
        }

        if (amOperatorMail) {
            localStorage.setItem("amOperatorMail", amOperatorMail);
        }
    }
    catch {}
}

function amGetAssinatura() {
    const nome =
        amOperatorName ||
        localStorage.getItem("amOperatorName") ||
        "";

    if (nome && nome !== "IT Santander Portugal") {
        return `${nome}
IT Santander Portugal`;
    }

    return "IT Santander Portugal";
}

function amGerarTextoTicket() {
    const operacao = document.getElementById("amOperacao")?.value || "add";
    const tipoAcesso = document.getElementById("amTipoAcesso")?.value || "FullAccess";
    const autoMapping = document.getElementById("amAutoMapping")?.value === "true" ? "Sim" : "Não";

    const saudacao = amSaudacaoAtual();
    const linhasTexto = [];

    document.querySelectorAll("#amTabelaBody tr").forEach((tr) => {
        const user = tr.querySelector(".am-user")?.value.trim() || "";
        const mailbox = tr.querySelector(".am-mailbox")?.value.trim() || "";

        const userInfo = tr.querySelector(".am-user-info");
        const mailboxInfo = tr.querySelector(".am-mailbox-info");

        const emailUser = userInfo?.dataset.email || "";
        const tipoMailbox = mailboxInfo?.dataset.tipo || "";

        if (!user || !mailbox) return;

        let acao = "";

        if (operacao === "add") {
            acao = `Foi concedido o acesso ${tipoAcesso} ao utilizador ${user}`;
        } else {
            acao = `Foi removido o acesso ${tipoAcesso} do utilizador ${user}`;
        }

        if (emailUser) {
            acao += ` / ${emailUser}`;
        }

        acao += ` na mailbox ${mailbox}.`;

        if (tipoMailbox) {
            acao += `\nTipo do destino: ${tipoMailbox}.`;
        }

        if (tipoAcesso === "FullAccess" && operacao === "add") {
            acao += `\nAutoMapping: ${autoMapping}.`;
        }

        linhasTexto.push(acao);
    });

    const descricao = linhasTexto.length
        ? linhasTexto.join("\n\n")
        : "A alteração solicitada foi efetuada conforme pedido.";

    const assinatura = amGetAssinatura();

    const texto =
`${saudacao},

Foram feitas as seguintes alterações:

${descricao}

A replicação poderá demorar +/-48 horas a aplicar.

Atenciosamente,

${assinatura}`;

    const el = document.getElementById("amTicketTexto");
    if (el) el.value = texto;
}

