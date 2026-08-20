let harmonyResultado = {
    total: 0,
    active: 0,
    notificar: 0,
    items: [],
    todos: []
};

const HARMONY_HISTORY_KEY = "ControleHarmonyHistoricoV1";

async function iniciarControleHarmony() {
    if (typeof criarPainelConexaoModulo === "function") {
        await criarPainelConexaoModulo("harmonyConnection", { graph: true });
    }

    if (typeof criarProgressGlobal === "function") {
        criarProgressGlobal("harmonyProgress");
        resetarProgressGlobal("harmonyProgress");
    }

    await carregarAusenciasServidorHarmony();
    harmonyLog("Módulo Controle Harmony iniciado.");
}

function carregarHistoricoHarmony() {
    try {
        return JSON.parse(localStorage.getItem(HARMONY_HISTORY_KEY) || "{}");
    } catch {
        return {};
    }
}

function salvarHistoricoHarmony(hist) {
    localStorage.setItem(HARMONY_HISTORY_KEY, JSON.stringify(hist));
}

function getHarmonyKey(r) {
    return String(
        r["UUID"] ||
        r["Serial Number"] ||
        r["IMEI"] ||
        r["ID"] ||
        r["Device registration code"] ||
        r["Name"] ||
        ""
    ).trim().toLowerCase();
}

function aplicarHistoricoHarmony(items) {
    const hist = carregarHistoricoHarmony();
    const agora = new Date().toLocaleString();

    items.forEach(r => {
        const key = getHarmonyKey(r);
        if (!key) return;

        if (!hist[key]) {
            hist[key] = {
                firstDetectedAt: agora,
                lastDetectedAt: agora,
                notifyCount: 0,
                firstNotifyAt: "",
                deadlineAt: "",
                lastNotifyAt: "",
                lastStatus: r["Status"] || ""
            };
        } else {
            hist[key].lastDetectedAt = agora;
            hist[key].lastStatus = r["Status"] || "";
        }

        r["_HistoryKey"] = key;
        r["_FirstDetectedAt"] = hist[key].firstDetectedAt;
        r["_LastDetectedAt"] = hist[key].lastDetectedAt;
        r["_NotifyCount"] = hist[key].notifyCount || 0;
        r["_LastNotifyAt"] = hist[key].lastNotifyAt || "";
        r["_SuggestedAction"] = getAcaoSugeridaHarmony(r);
    });

    salvarHistoricoHarmony(hist);
}

function getAcaoSugeridaHarmony(r) {
    const count = Number(r["_NotifyCount"] || 0);

    if (count === 0) return "Enviar 1ª notificação";
    if (count === 1) return "Reenviar notificação";
    if (count >= 2) return "Escalar / validar remoção";

    return "Notificar";
}

function marcarHarmonyComoNotificado() {
    if (!harmonyResultado || !harmonyResultado.items || harmonyResultado.items.length === 0) {
        alert("Não existem dispositivos para marcar como notificados.");
        return;
    }

    const confirmar = confirm(
        "Confirmar que os " + harmonyResultado.items.length + " dispositivos foram notificados?"
    );

    if (!confirmar) return;

    const hist = carregarHistoricoHarmony();
    const agora = new Date().toLocaleString();

    harmonyResultado.items.forEach(r => {
        const key = r["_HistoryKey"] || getHarmonyKey(r);
        if (!key) return;

        if (!hist[key]) {
            hist[key] = {
                firstDetectedAt: agora,
                lastDetectedAt: agora,
                notifyCount: 0,
                firstNotifyAt: "",
                deadlineAt: "",
                lastNotifyAt: "",
                lastStatus: r["Status"] || ""
            };
        }

        if (!hist[key].firstNotifyAt) {
            hist[key].firstNotifyAt = agora;

            const prazo = new Date();
            prazo.setHours(prazo.getHours() + 48);
            hist[key].deadlineAt = prazo.toISOString();
        }

        hist[key].notifyCount = Number(hist[key].notifyCount || 0) + 1;
        hist[key].lastNotifyAt = agora;
        hist[key].lastDetectedAt = agora;
        hist[key].lastStatus = r["Status"] || "";
    });

    salvarHistoricoHarmony(hist);

    aplicarHistoricoHarmony(harmonyResultado.items);
    renderResumoHarmony();
    renderTabelaHarmony(harmonyResultado.items);

    harmonyLog("Dispositivos marcados como notificados: " + harmonyResultado.items.length);
    alert("Histórico atualizado com sucesso.");
}

function harmonyLog(msg) {
    const log = document.getElementById("harmonyLogs");
    if (!log) return;

    const line = "[" + new Date().toLocaleTimeString() + "] " + msg;
    log.value = line + "\n" + log.value;
}

function harmonyProgress(percent, text) {
    if (typeof atualizarProgressGlobal === "function") {
        atualizarProgressGlobal("harmonyProgress", percent, text);
    }
}

function harmonyFinish(success, text) {
    if (typeof finalizarProgressGlobal === "function") {
        finalizarProgressGlobal("harmonyProgress", success, text);
    }
}

async function processarHarmonyCsv() {
    const fileInput = document.getElementById("harmonyCsvFile");
    const statusOk = (document.getElementById("harmonyStatusOk").value || "Active").trim();

    if (!fileInput.files || fileInput.files.length === 0) {
        alert("Selecione o ficheiro CSV do Harmony.");
        return;
    }

    harmonyProgress(10, "A ler ficheiro CSV...");
    harmonyLog("A ler ficheiro: " + fileInput.files[0].name);

    const file = fileInput.files[0];
    const text = await file.text();

    harmonyProgress(35, "A processar linhas do CSV...");

    const rows = parseCsvHarmony(text);

    if (!rows || rows.length === 0) {
        harmonyFinish(false, "CSV vazio ou inválido.");
        harmonyLog("CSV vazio ou inválido.");
        return;
    }

    harmonyProgress(65, "A filtrar Status diferente de " + statusOk + "...");

    const filtrados = rows.filter(r => {
        const status = String(r["Status"] || "").trim().toLowerCase();
        return status !== statusOk.toLowerCase();
    });

    await resolverDisplayNamesHarmony(filtrados);

    aplicarHistoricoHarmony(filtrados);

    const active = rows.length - filtrados.length;

    harmonyResultado = {
        total: rows.length,
        active: active,
        notificar: filtrados.length,
        statusOk: statusOk,
        items: filtrados,
        todos: rows,
        generatedAt: new Date().toLocaleString()
    };

    await carregarAusenciasServidorHarmony();
    aplicarAusenciasHarmony();
    renderResumoHarmony();
    renderTabelaHarmony(filtrados);
    atualizarPreviewMensagemHarmony();

    harmonyFinish(true, "CSV processado com sucesso.");
    harmonyLog("Total linhas: " + rows.length);
    harmonyLog("Status Active: " + active);
    harmonyLog("Para notificar: " + filtrados.length);
}

function parseCsvHarmony(text) {
    text = text.replace(/^\uFEFF/, "");

    const delimiter = detectarSeparadorHarmony(text);
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");

    if (lines.length < 2) return [];

    const headers = splitCsvLineHarmony(lines[0], delimiter).map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const values = splitCsvLineHarmony(lines[i], delimiter);
        const obj = {};

        headers.forEach((h, idx) => {
            obj[h] = values[idx] !== undefined ? values[idx].trim() : "";
        });

        rows.push(obj);
    }

    return rows;
}

function detectarSeparadorHarmony(text) {
    const firstLine = text.split(/\r?\n/)[0] || "";

    const tabs = (firstLine.match(/\t/g) || []).length;
    const semis = (firstLine.match(/;/g) || []).length;
    const commas = (firstLine.match(/,/g) || []).length;

    if (tabs >= semis && tabs >= commas) return "\t";
    if (semis >= commas) return ";";
    return ",";
}

function splitCsvLineHarmony(line, delimiter) {
    const result = [];
    let current = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const next = line[i + 1];

        if (char === '"' && insideQuotes && next === '"') {
            current += '"';
            i++;
            continue;
        }

        if (char === '"') {
            insideQuotes = !insideQuotes;
            continue;
        }

        if (char === delimiter && !insideQuotes) {
            result.push(current);
            current = "";
            continue;
        }

        current += char;
    }

    result.push(current);
    return result;
}

function renderResumoHarmony() {
    const total = harmonyResultado.total || 0;
    const active = harmonyResultado.active || 0;
    const notificar = harmonyResultado.notificar || 0;

    const primeira = harmonyResultado.items.filter(x => Number(x["_NotifyCount"] || 0) === 0).length;
    const reenviar = harmonyResultado.items.filter(x => Number(x["_NotifyCount"] || 0) === 1).length;
    const escalar = harmonyResultado.items.filter(x => Number(x["_NotifyCount"] || 0) >= 2).length;
    const entraDesativados = harmonyResultado.items.filter(x => x["_AccountEnabled"] === false && String(x["_Source"] || "").toLowerCase().includes("entra")).length;
    const adDesativados = harmonyResultado.items.filter(x => x["_AccountEnabled"] === false && String(x["_Source"] || "").toLowerCase().includes("ad local")).length;
    const entraNaoEncontrados = harmonyResultado.items.filter(x => x["_AccountStatus"] === "Não encontrado").length;
    const ausentes = harmonyResultado.items.filter(x => x["_Ausente"] === "Sim").length;
    const elegiveisReenvio = harmonyResultado.items.filter(x => x["_Ausente"] !== "Sim" && Number(x["_NotifyCount"] || 0) >= 1).length;

    const percent = total > 0 ? ((active / total) * 100).toFixed(2) : "0.00";

    document.getElementById("harmonyResumo").innerHTML = `
        <div class="dashboard-cards">
            <div class="info-card">
                <h3>Total</h3>
                <span>${total}</span>
            </div>

            <div class="info-card success">
                <h3>Active</h3>
                <span>${active}</span>
            </div>

            <div class="info-card danger">
                <h3>Precisam Notificar</h3>
                <span>${notificar}</span>
            </div>

            <div class="info-card">
                <h3>Nunca Notificados</h3>
                <span>${primeira}</span>
            </div>

            <div class="info-card warn">
                <h3>Já Notificados 1x</h3>
                <span>${reenviar}</span>
            </div>

            <div class="info-card danger">
                <h3>Para Escalar</h3>
                <span>${escalar}</span>
            </div>

            <div class="info-card danger">
                <h3>Utilizadores Desativados Entra</h3>
                <span>${entraDesativados}</span>
            </div>

            <div class="info-card danger">
                <h3>Utilizadores Desativados AD</h3>
                <span>${adDesativados}</span>
            </div>

            <div class="info-card warn">
                <h3>Não Encontrados Entra</h3>
                <span>${entraNaoEncontrados}</span>
            </div>

            <div class="info-card warn">
                <h3>Em férias / Ausentes</h3>
                <span>${ausentes}</span>
            </div>

            <div class="info-card success">
                <h3>Elegíveis Reenvio</h3>
                <span>${elegiveisReenvio}</span>
            </div>

            <div class="info-card">
                <h3>Compliance</h3>
                <span>${percent}%</span>
            </div>
        </div>

        <div class="action-bar" style="margin-top:12px;">
            <button class="btn btn-danger" onclick="marcarHarmonyComoNotificado()">
                Marcar como notificado
            </button>
        </div>
    `;
}

function renderTabelaHarmony(items) {
    const tbody = document.getElementById("harmonyTabelaBody");

    if (!items || items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="22">Nenhum dispositivo com Status diferente de Active.</td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = items.map(r => {
        const email = String(r["Email"] || "");
        const emailEsc = escapeHtmlHarmony(email);

        let botaoFerias = "";

        if (r["_Ausente"] === "Sim") {
            botaoFerias =
                "<button class=\"harmony-btn harmony-btn-light\" onclick=\"removerFeriasHarmony('" +
                emailEsc +
                "')\">Remover férias</button>";
        } else {
            botaoFerias =
                "<button class=\"harmony-btn harmony-btn-secondary\" onclick=\"marcarFeriasHarmony('" +
                emailEsc +
                "')\">Marcar férias</button>";
        }

        return `
            <tr>
                <td>${escapeHtmlHarmony(r["Email"])}</td>
                <td>${escapeHtmlHarmony(r["Name"])}</td>
                <td>${escapeHtmlHarmony(r["Device Type"])}</td>
                <td>${escapeHtmlHarmony(r["OS Version"])}</td>
                <td>${escapeHtmlHarmony(r["Client Version"])}</td>
                <td>${escapeHtmlHarmony(r["Last Seen"])}</td>
                <td><span class="tag danger">${escapeHtmlHarmony(r["Status"])}</span></td>
                <td>${escapeHtmlHarmony(r["Policy"])}</td>
                <td>${escapeHtmlHarmony(r["Serial Number"])}</td>
                <td>${escapeHtmlHarmony(r["_FirstDetectedAt"])}</td>
                <td>${escapeHtmlHarmony(r["_LastNotifyAt"])}</td>
                <td>${escapeHtmlHarmony(r["_NotifyCount"])}</td>
                <td>${escapeHtmlHarmony(r["_DisplayName"])}</td>
                <td>${escapeHtmlHarmony(r["_AccountStatus"])}</td>
                <td>${escapeHtmlHarmony(r["_Ausente"] || "")}</td>
                <td>${escapeHtmlHarmony(r["_AusenciaRegresso"] || "")}</td>
                <td>${escapeHtmlHarmony(r["_AusenciaMotivo"] || "")}</td>
                <td>${escapeHtmlHarmony(r["_SuggestedAction"])}</td>
                <td>${botaoFerias}</td>
            </tr>
        `;
    }).join("");
}

async function prepararEmailHarmony() {
    if (!harmonyResultado || !harmonyResultado.items || harmonyResultado.items.length === 0) {
        alert("Não existem dispositivos para notificar.");
        return;
    }

    harmonyProgress(30, "A preparar email Outlook...");

    try {
        const response = await fetch("/module/controle-harmony/api?action=prepararEmailOutlook", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                action: "prepararEmailOutlook",
                fromAddress: document.getElementById("harmonyEmailFrom") ? document.getElementById("harmonyEmailFrom").value : "User.Action.Required@santander.pt",
                attachment: await lerAnexoHarmonyBase64(),
                resumo: harmonyResultado,
                subject: document.getElementById("harmonyEmailSubject") ? document.getElementById("harmonyEmailSubject").value : "",
                messageTemplate: document.getElementById("harmonyEmailMessage") ? document.getElementById("harmonyEmailMessage").value : ""
            })
        });

        const data = await response.json();

        if (!data.success) {
            harmonyFinish(false, "Erro ao preparar email.");
            alert(data.error || "Erro ao preparar email.");
            return;
        }

        harmonyFinish(true, "Email aberto no Outlook.");
        harmonyLog("Email aberto no Outlook com sucesso.");
    }
    catch (e) {
        harmonyFinish(false, "Erro ao preparar email.");
        alert(e.message);
    }
}

function exportarCsvHarmony() {
    if (!harmonyResultado || !harmonyResultado.items || harmonyResultado.items.length === 0) {
        alert("Não existem dados para exportar.");
        return;
    }

    const headers = [
        "Email",
        "Name",
        "Device Type",
        "OS Version",
        "Client Version",
        "Last Seen",
        "Status",
        "Policy",
        "Serial Number",
        "_FirstDetectedAt",
        "_LastDetectedAt",
        "_LastNotifyAt",
        "_NotifyCount",
        "_SuggestedAction"
    ];

    let csv = headers.join(";") + "\n";

    harmonyResultado.items.forEach(r => {
        csv += headers.map(h => {
            let v = r[h] || "";
            v = String(v).replaceAll('"', '""');
            return `"${v}"`;
        }).join(";") + "\n";
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "Controle_Harmony_Notificacoes.csv";
    a.click();

    URL.revokeObjectURL(url);
}

function limparHarmony() {
    harmonyResultado = {
        total: 0,
        active: 0,
        notificar: 0,
        items: [],
        todos: []
    };

    document.getElementById("harmonyResumo").innerHTML = "";
    document.getElementById("harmonyLogs").value = "";
    document.getElementById("harmonyTabelaBody").innerHTML = `
        <tr>
            <td colspan="22">Carregue um ficheiro CSV para iniciar.</td>
        </tr>
    `;

    if (typeof resetarProgressGlobal === "function") {
        resetarProgressGlobal("harmonyProgress");
    }
}

function escapeHtmlHarmony(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}



async function resolverUtilizadorHarmony(upn) {
    if (!upn) {
        return {
            displayName: "",
            accountStatus: "Sem UPN",
            accountEnabled: null,
            found: false
        };
    }

    try {
        const response = await fetch(
            "/module/controle-harmony/api?action=resolverUtilizador&upn=" + encodeURIComponent(upn)
        );

        const raw = await response.text();

        let data = null;
        try {
            data = JSON.parse(raw);
        } catch {
            harmonyLog("Entra resposta inválida para " + upn + ": " + raw);
            return {
                displayName: "",
                accountStatus: "Erro resposta API",
                accountEnabled: null,
                found: false,
                source: "",
                adDomain: ""
            };
        }

        if (data && data.success) {
            const nome = data.displayName || "";
            const estado = data.accountStatus || "Não encontrado";

            if (nome) {
                harmonyLog("Entra OK: " + upn + " => " + nome + " | " + estado);
            } else {
                harmonyLog("Entra não encontrou utilizador: " + upn);
            }

            return {
                displayName: nome,
                accountStatus: estado,
                accountEnabled: data.accountEnabled,
                found: data.found === true,
                source: data.source || "",
                adDomain: data.adDomain || ""
            };
        }

        return {
            displayName: "",
            accountStatus: "Erro consulta",
            accountEnabled: null,
            found: false
        };
    }
    catch (e) {
        harmonyLog("Erro Entra para " + upn + ": " + e.message);
        return {
            displayName: "",
            accountStatus: "Erro: " + e.message,
            accountEnabled: null,
            found: false
        };
    }
}

async function resolverDisplayNameHarmony(upn) {
    const info = await resolverUtilizadorHarmony(upn);
    return info.displayName || "";
}

async function resolverDisplayNamesHarmony(items) {
    if (!items || items.length === 0) return;

    harmonyProgress(75, "A validar utilizadores no Entra ID...");

    const cache = {};

    for (const item of items) {
        const upn = String(item["Email"] || "").trim();

        if (!upn) {
            item["_DisplayName"] = "";
            item["_AccountStatus"] = "Sem UPN";
            item["_AccountEnabled"] = null;
            continue;
        }

        if (cache[upn]) {
            const info = cache[upn];

            item["_DisplayName"] = info.displayName || upn;

            if (item["_FoundEntraDevice"] === true) {
                item["_AccountStatus"] = "Encontrado no Entra Device";
                item["_Source"] = "Entra Device";
            } else {
                item["_AccountStatus"] = info.accountStatus || "Não encontrado";
                item["_Source"] = info.source || "";
            }

            item["_AccountEnabled"] = info.accountEnabled;
            item["_AdDomain"] = info.adDomain || "";
            continue;
        }

        const info = await resolverUtilizadorHarmony(upn);
        cache[upn] = info;

        item["_DisplayName"] = info.displayName || upn;

        if (item["_FoundEntraDevice"] === true) {
            item["_AccountStatus"] = "Encontrado no Entra Device";
            item["_Source"] = "Entra Device";
        } else {
            item["_AccountStatus"] = info.accountStatus || "Não encontrado";
            item["_Source"] = info.source || "";
        }

        item["_AccountEnabled"] = info.accountEnabled;
        item["_AdDomain"] = info.adDomain || "";
    }
}

function calcularTempoRestanteHarmony(item) {
    const key = item["_HistoryKey"] || getHarmonyKey(item);
    const hist = carregarHistoricoHarmony();
    const h = hist[key];

    if (!h || !h.deadlineAt) {
        return "48 horas";
    }

    const deadline = new Date(h.deadlineAt);
    const now = new Date();

    const diffMs = deadline.getTime() - now.getTime();

    if (isNaN(diffMs)) {
        return "48 horas";
    }

    if (diffMs <= 0) {
        return "prazo expirado";
    }

    const totalMin = Math.ceil(diffMs / 60000);
    const horas = Math.floor(totalMin / 60);
    const minutos = totalMin % 60;

    if (horas >= 24) {
        const dias = Math.floor(horas / 24);
        const horasRestantes = horas % 24;

        if (horasRestantes === 0) {
            return dias + " dia(s)";
        }

        return dias + " dia(s) e " + horasRestantes + " hora(s)";
    }

    if (horas > 0) {
        return horas + " hora(s) e " + minutos + " minuto(s)";
    }

    return minutos + " minuto(s)";
}

function obterDeadlineHarmony(item) {
    const key = item["_HistoryKey"] || getHarmonyKey(item);
    const hist = carregarHistoricoHarmony();
    const h = hist[key];

    if (!h || !h.deadlineAt) {
        return "";
    }

    try {
        return new Date(h.deadlineAt).toLocaleString();
    }
    catch {
        return "";
    }
}

function gerarMensagemHarmony(item) {
    const template = document.getElementById("harmonyEmailMessage") 
        ? document.getElementById("harmonyEmailMessage").value 
        : "";

    return template
        .replaceAll("{NOME}", item["_DisplayName"] || item["Email"] || "")
        .replaceAll("{EMAIL}", item["Email"] || "")
        .replaceAll("{DEVICE}", item["Name"] || "")
        .replaceAll("{DEVICE_TYPE}", item["Device Type"] || "")
        .replaceAll("{OS_VERSION}", item["OS Version"] || "")
        .replaceAll("{CLIENT_VERSION}", item["Client Version"] || "")
        .replaceAll("{LAST_SEEN}", item["Last Seen"] || "")
        .replaceAll("{STATUS}", item["Status"] || "")
        .replaceAll("{POLICY}", item["Policy"] || "")
        .replaceAll("{SERIAL_NUMBER}", item["Serial Number"] || "")
        .replaceAll("{TEMPO_RESTANTE}", calcularTempoRestanteHarmony(item))
        .replaceAll("{PRAZO_LIMITE}", obterDeadlineHarmony(item));
}

function atualizarPreviewMensagemHarmony() {
    const preview = document.getElementById("harmonyEmailPreview");
    if (!preview) return;

    if (!harmonyResultado || !harmonyResultado.items || harmonyResultado.items.length === 0) {
        preview.value = "A pré-visualização será apresentada após processar o CSV.";
        return;
    }

    const primeiro = harmonyResultado.items[0];
    preview.value = gerarMensagemHarmony(primeiro);
}


async function lerAnexoHarmonyBase64() {
    const input = document.getElementById("harmonyManualAnexo");

    if (!input || !input.files || input.files.length === 0) {
        harmonyLog("Nenhum anexo selecionado.");
        return null;
    }

    const file = input.files[0];

    harmonyLog("A preparar anexo: " + file.name);

    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = function () {
            try {
                const result = String(reader.result || "");
                const base64 = result.includes(",") ? result.split(",")[1] : result;

                resolve({
                    fileName: file.name,
                    contentType: file.type || "application/octet-stream",
                    base64: base64
                });
            }
            catch (e) {
                reject(e);
            }
        };

        reader.onerror = function () {
            reject(reader.error || new Error("Erro ao ler anexo."));
        };

        reader.readAsDataURL(file);
    });
}


function parseHarmonyApiResponse(rawText) {
    let data = null;

    try {
        data = JSON.parse(rawText);

        // Caso venha como string JSON: "{ \"success\": true }"
        if (typeof data === "string") {
            data = JSON.parse(data);
        }

        return data;
    }
    catch (e) {
        throw new Error("Resposta inválida da API: " + rawText);
    }
}


function prepararItemEmailHarmony(item) {
    if (!item) return item;

    const key = item["_HistoryKey"] || getHarmonyKey(item);
    const hist = carregarHistoricoHarmony();
    const h = hist[key];

    if (h && h.deadlineAt) {
        item["_DeadlineAt"] = h.deadlineAt;
    }

    return item;
}

async function enviarTesteHarmony() {
    try {
        harmonyLog("Clique no botão Enviar teste recebido.");

        if (!harmonyResultado || !harmonyResultado.items || harmonyResultado.items.length === 0) {
            alert("Processe primeiro o CSV para gerar um item de teste.");
            harmonyLog("Erro: CSV ainda não foi processado.");
            return;
        }

        const campoTeste = document.getElementById("harmonyEmailTeste");

        if (!campoTeste) {
            alert("Campo de email de teste não encontrado no HTML.");
            harmonyLog("Erro: campo harmonyEmailTeste não encontrado.");
            return;
        }

        const testTo = campoTeste.value.trim();

        if (!testTo) {
            alert("Informe o e-mail para envio do teste.");
            harmonyLog("Erro: email de teste vazio.");
            return;
        }

        const fromAddress = document.getElementById("harmonyEmailFrom")
            ? document.getElementById("harmonyEmailFrom").value.trim()
            : "User.Action.Required@santander.pt";

        const subject = document.getElementById("harmonyEmailSubject")
            ? document.getElementById("harmonyEmailSubject").value
            : "Ação necessária | Validação da aplicação Harmony no dispositivo corporativo";

        const messageTemplate = document.getElementById("harmonyEmailMessage")
            ? document.getElementById("harmonyEmailMessage").value
            : "";

        harmonyProgress(20, "A preparar email de teste...");
        harmonyLog("Destino teste: " + testTo);
        harmonyLog("From: " + fromAddress);

        const attachment = await lerAnexoHarmonyBase64();

        harmonyProgress(50, "A chamar API de envio teste...");
        harmonyLog("A chamar /module/controle-harmony/api");

        const response = await fetch("/module/controle-harmony/api?action=enviarTesteOutlook", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                action: "enviarTesteOutlook",
                testTo: testTo,
                fromAddress: fromAddress,
                item: prepararItemEmailHarmony((harmonyResultado.items.find(x => x["_DisplayName"] && x["_DisplayName"] !== x["Email"]) || harmonyResultado.items[0])),
                attachment: attachment,
                subject: subject,
                messageTemplate: messageTemplate
            })
        });

        const rawText = await response.text();

        harmonyLog("Resposta API HTTP " + response.status + ": " + rawText);

        let data = null;

        try {
            data = parseHarmonyApiResponse(rawText);
        }
        catch (e) {
            harmonyFinish(false, "Resposta inválida da API.");
            alert(e.message);
            harmonyLog(e.message);
            return;
        }

        if (!data.success) {
            harmonyFinish(false, "Erro ao enviar teste.");
            alert(data.error || "Erro ao enviar teste.");
            harmonyLog("Erro API: " + (data.error || "sem detalhe"));
            return;
        }

        harmonyFinish(true, "Email de teste aberto no Outlook.");
        harmonyLog(data.message || "Email de teste aberto no Outlook.");
        alert(data.message || "Email de teste aberto no Outlook.");
    }
    catch (e) {
        harmonyFinish(false, "Erro no botão Enviar teste.");
        harmonyLog("Erro JS enviarTesteHarmony: " + e.message);
        alert("Erro no botão Enviar teste:\n\n" + e.message);
    }
}


async function testarResolverUtilizadorHarmony() {
    const campo = document.getElementById("harmonyTesteUpn");
    const saida = document.getElementById("harmonyTesteResultado");

    if (!campo || !saida) {
        alert("Campo de teste não encontrado.");
        return;
    }

    const upn = campo.value.trim();

    if (!upn) {
        alert("Informe a UPN.");
        return;
    }

    saida.textContent = "A testar " + upn + "...";

    try {
        const response = await fetch(
            "/module/controle-harmony/api?action=diagnosticarUtilizador&upn=" + encodeURIComponent(upn)
        );

        const raw = await response.text();

        let data = null;

        try {
            data = JSON.parse(raw);
        }
        catch {
            saida.textContent = "Resposta inválida:\n\n" + raw;
            return;
        }

        saida.textContent = JSON.stringify(data, null, 2);

        if (data.success && data.result && data.result.finalDisplayName) {
            harmonyLog("Diagnóstico OK: " + upn + " => " + data.result.finalDisplayName + " (" + data.result.finalSource + ")");
        }
        else {
            harmonyLog("Diagnóstico não encontrou nome para " + upn);
        }
    }
    catch (e) {
        saida.textContent = "Erro: " + e.message;
        harmonyLog("Erro diagnóstico: " + e.message);
    }
}


async function exportarRelatorioAndamentoHarmony() {
    if (!harmonyResultado || !harmonyResultado.todos || harmonyResultado.todos.length === 0) {
        alert("Processe primeiro o ficheiro CSV.");
        return;
    }

    harmonyProgress(20, "A atualizar nomes e estados antes de exportar...");

    const todosParaValidar = harmonyResultado.items || [];

    for (const r of todosParaValidar) {
        const upn = String(r["Email"] || "").trim();

        if (!upn) continue;

        const precisaResolver =
            !r["_DisplayName"] ||
            r["_DisplayName"] === upn ||
            r["_AccountStatus"] === "Erro consulta" ||
            r["_AccountStatus"] === "Não encontrado";

        if (precisaResolver) {
            try {
                const response = await fetch(
                    "/module/controle-harmony/api?action=diagnosticarUtilizador&upn=" + encodeURIComponent(upn)
                );

                const raw = await response.text();
                const data = parseHarmonyApiResponse(raw);

                if (data.success && data.result) {
                    if (data.result.finalDisplayName) {
                        r["_DisplayName"] = data.result.finalDisplayName;
                    }

                    if (data.result.finalSource) {
                        r["_Source"] = data.result.finalSource;
                    }

                    if (data.result.finalSource && data.result.finalSource.includes("central")) {
                        r["_AdDomain"] = "central.rinterna.local";
                    }

                    if (data.result.finalSource && data.result.finalSource.includes("rede")) {
                        r["_AdDomain"] = "rede.rinterna.local";
                    }

                    if (data.result.adCentralDisplayName || data.result.adRedeDisplayName) {
                        if (data.result.adCentralEnabled === true || data.result.adRedeEnabled === true) {
                            r["_AccountStatus"] = "Ativo AD Local";
                            r["_AccountEnabled"] = true;
                        } else if (data.result.adCentralEnabled === false || data.result.adRedeEnabled === false) {
                            r["_AccountStatus"] = "Desativado AD Local";
                            r["_AccountEnabled"] = false;
                        }
                    }

                    harmonyLog("Relatório: " + upn + " => " + (r["_DisplayName"] || upn) + " | " + (r["_AccountStatus"] || ""));
                }
            }
            catch (e) {
                harmonyLog("Erro ao atualizar " + upn + " para relatório: " + e.message);
            }
        }
    }

    const hist = carregarHistoricoHarmony();
    const statusOk = harmonyResultado.statusOk || "Active";
    const agora = new Date().toLocaleString();

    const todos = harmonyResultado.todos || [];
    const pendentes = harmonyResultado.items || [];

    const resolvidos = todos.filter(r => {
        const status = String(r["Status"] || "").trim().toLowerCase();
        return status === statusOk.toLowerCase();
    });

    const notificados = pendentes.filter(r => Number(r["_NotifyCount"] || 0) > 0);
    const nuncaNotificados = pendentes.filter(r => Number(r["_NotifyCount"] || 0) === 0);
    const reenviar = pendentes.filter(r => Number(r["_NotifyCount"] || 0) === 1);
    const escalar = pendentes.filter(r => Number(r["_NotifyCount"] || 0) >= 2);
    const usersDesativados = pendentes.filter(r => r["_AccountEnabled"] === false);

    const resumo = [
        ["Métrica", "Quantidade"],
        ["Data do relatório", agora],
        ["Total no ficheiro", todos.length],
        ["Resolvidos / Active", resolvidos.length],
        ["Pendentes / Diferente de Active", pendentes.length],
        ["Já notificados", notificados.length],
        ["Nunca notificados", nuncaNotificados.length],
        ["Para reenvio", reenviar.length],
        ["Para escalar", escalar.length],
        ["Utilizadores desativados Entra/AD", usersDesativados.length]
    ];

    const detalheHeaders = [
        "Email",
        "Nome",
        "Estado Entra/AD",
        "Origem Nome",
        "Dominio AD",
        "Device",
        "Device Type",
        "OS Version",
        "Client Version",
        "Last Seen",
        "Status Harmony",
        "Policy",
        "Serial Number",
        "Primeira Detecção",
        "Última Detecção",
        "Última Notificação",
        "Qtd Notificações",
        "Situação",
        "Ação Sugerida"
    ];

    const detalheRows = pendentes.map(r => {
        const count = Number(r["_NotifyCount"] || 0);

        let situacao = "Pendente sem notificação";
        if (count === 1) situacao = "Notificado uma vez";
        if (count >= 2) situacao = "Escalar / validar";

        return [
            r["Email"] || "",
            r["_DisplayName"] || r["Email"] || "",
            r["_AccountStatus"] || "",
            r["_Source"] || "",
            r["_AdDomain"] || "",
            r["Name"] || "",
            r["Device Type"] || "",
            r["OS Version"] || "",
            r["Client Version"] || "",
            r["Last Seen"] || "",
            r["Status"] || "",
            r["Policy"] || "",
            r["Serial Number"] || "",
            r["_FirstDetectedAt"] || "",
            r["_LastDetectedAt"] || "",
            r["_LastNotifyAt"] || "",
            r["_NotifyCount"] || "0",
            situacao,
            r["_SuggestedAction"] || ""
        ];
    });

    let csv = "";

    csv += "RESUMO DO ANDAMENTO\r\n";
    resumo.forEach(row => {
        csv += row.map(csvEscapeHarmony).join(";") + "\r\n";
    });

    csv += "\r\nDETALHE DOS PENDENTES\r\n";
    csv += detalheHeaders.map(csvEscapeHarmony).join(";") + "\r\n";

    detalheRows.forEach(row => {
        csv += row.map(csvEscapeHarmony).join(";") + "\r\n";
    });

    csv += "\r\nRESOLVIDOS / ACTIVE\r\n";
    csv += detalheHeaders.map(csvEscapeHarmony).join(";") + "\r\n";

    resolvidos.forEach(r => {
        const key = getHarmonyKey(r);
        const h = hist[key] || {};

        const row = [
            r["Email"] || "",
            r["_DisplayName"] || r["Email"] || "",
            r["_AccountStatus"] || "",
            r["_Source"] || "",
            r["_AdDomain"] || "",
            r["Name"] || "",
            r["Device Type"] || "",
            r["OS Version"] || "",
            r["Client Version"] || "",
            r["Last Seen"] || "",
            r["Status"] || "",
            r["Policy"] || "",
            r["Serial Number"] || "",
            h.firstDetectedAt || "",
            h.lastDetectedAt || "",
            h.lastNotifyAt || "",
            h.notifyCount || "0",
            "Resolvido / Active",
            "Sem ação"
        ];

        csv += row.map(csvEscapeHarmony).join(";") + "\r\n";
    });

    // BOM UTF-8 para Excel não mostrar notificaÃ§Ã£o
    const csvComBom = "\uFEFF" + csv;

    const blob = new Blob([csvComBom], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "Controle_Harmony_Relatorio_Andamento_" + new Date().toISOString().slice(0, 19).replaceAll(":", "-") + ".csv";
    a.click();

    URL.revokeObjectURL(url);

    harmonyFinish(true, "Relatório de andamento exportado.");
    harmonyLog("Relatório de andamento exportado com UTF-8 BOM.");
}

function csvEscapeHarmony(value) {
    let v = String(value ?? "");
    v = v.replaceAll('"', '""');
    return '"' + v + '"';
}


function statusBadgeHarmony(texto) {
    const value = String(texto || "");

    if (value.toLowerCase().includes("ativo")) {
        return `<span class="badge success">${escapeHtmlHarmony(value)}</span>`;
    }

    if (value.toLowerCase().includes("desativado") || value.toLowerCase().includes("inactive")) {
        return `<span class="badge danger">${escapeHtmlHarmony(value)}</span>`;
    }

    if (value.toLowerCase().includes("erro") || value.toLowerCase().includes("não encontrado")) {
        return `<span class="badge warn">${escapeHtmlHarmony(value)}</span>`;
    }

    return `<span class="badge neutral">${escapeHtmlHarmony(value)}</span>`;
}

function exportarRelatorioVisualHarmony() {
    if (!harmonyResultado || !harmonyResultado.todos || harmonyResultado.todos.length === 0) {
        alert("Processe primeiro o ficheiro CSV.");
        return;
    }

    const statusOk = harmonyResultado.statusOk || "Active";
    const todos = harmonyResultado.todos || [];
    const pendentes = harmonyResultado.items || [];
    const agora = new Date().toLocaleString();

    const resolvidos = todos.filter(r => String(r["Status"] || "").trim().toLowerCase() === statusOk.toLowerCase());
    const notificados = pendentes.filter(r => Number(r["_NotifyCount"] || 0) > 0);
    const nuncaNotificados = pendentes.filter(r => Number(r["_NotifyCount"] || 0) === 0);
    const reenviar = pendentes.filter(r => Number(r["_NotifyCount"] || 0) === 1);
    const escalar = pendentes.filter(r => Number(r["_NotifyCount"] || 0) >= 2);
    const desativados = pendentes.filter(r => r["_AccountEnabled"] === false);

    const percentResolvido = todos.length > 0 ? ((resolvidos.length / todos.length) * 100).toFixed(2) : "0.00";

    const rowsPendentes = pendentes.map(r => `
        <tr>
            <td>${escapeHtmlHarmony(r["Email"])}</td>
            <td>${escapeHtmlHarmony((r["_DisplayName"] && r["_DisplayName"] !== r["Email"]) ? r["_DisplayName"] : (r["_ResolvedName"] || r["Email"]))}</td>
            <td>${statusBadgeHarmony(r["_AccountStatus"])}</td>
            <td>${escapeHtmlHarmony(r["Name"])}</td>
            <td>${escapeHtmlHarmony(r["Device Type"])}</td>
            <td>${escapeHtmlHarmony(r["OS Version"])}</td>
            <td>${escapeHtmlHarmony(r["Client Version"])}</td>
            <td>${escapeHtmlHarmony(r["Last Seen"])}</td>
            <td>${statusBadgeHarmony(r["Status"])}</td>
            <td>${escapeHtmlHarmony(r["_NotifyCount"] || "0")}</td>
            <td>${escapeHtmlHarmony(r["_LastNotifyAt"] || "")}</td>
            <td>${harmonyV3Badge(r["Outro Harmony OK"] || "", String(r["Outro Harmony OK"] || "").toLowerCase() === "sim" ? "success" : "danger")}</td>
            <td>${escapeHtmlHarmony(r["Outro Device OK"] || "")}</td>
            <td>${harmonyV3Badge(r["Recomendação V4"] || r["_SuggestedAction"] || "", String(r["Recomendação V4"] || "").toLowerCase().includes("não contactar") ? "success" : "danger")}</td>
        </tr>
    `).join("");

    const html = `
<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<title>Controle Harmony - Relatório de Andamento</title>
<style>
    body {
        margin: 0;
        background: #f4f6f8;
        font-family: Segoe UI, Arial, sans-serif;
        color: #1f2937;
    }

    .page {
        max-width: 1320px;
        margin: 0 auto;
        padding: 28px;
    }

    .hero {
        background: linear-gradient(135deg, #e60000 0%, #b80000 55%, #7a0000 100%);
        color: #fff;
        border-radius: 18px;
        padding: 30px 34px;
        box-shadow: 0 18px 42px rgba(164, 0, 0, .22);
        display: flex;
        justify-content: space-between;
        gap: 24px;
        align-items: center;
    }

    .hero small {
        text-transform: uppercase;
        letter-spacing: .14em;
        font-weight: 700;
        opacity: .9;
    }

    .hero h1 {
        margin: 8px 0 6px;
        font-size: 34px;
        line-height: 1.1;
    }

    .hero p {
        margin: 0;
        opacity: .95;
        font-size: 15px;
    }

    .hero-box {
        min-width: 210px;
        background: rgba(255,255,255,.15);
        border: 1px solid rgba(255,255,255,.28);
        border-radius: 16px;
        padding: 18px;
        text-align: left;
    }

    .hero-box strong {
        display: block;
        font-size: 22px;
    }

    .cards {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
        margin: 24px 0;
    }

    .card {
        background: #fff;
        border-radius: 16px;
        padding: 20px;
        border: 1px solid #e5e7eb;
        box-shadow: 0 10px 26px rgba(15,23,42,.06);
    }

    .card h3 {
        margin: 0;
        color: #6b7280;
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: .05em;
    }

    .card .number {
        margin-top: 8px;
        font-size: 30px;
        font-weight: 900;
        color: #111827;
    }

    .card.red { border-left: 6px solid #e60000; }
    .card.green { border-left: 6px solid #16a34a; }
    .card.orange { border-left: 6px solid #f59e0b; }
    .card.dark { border-left: 6px solid #111827; }

    .section {
        background: #fff;
        border-radius: 16px;
        border: 1px solid #e5e7eb;
        box-shadow: 0 10px 26px rgba(15,23,42,.06);
        margin-top: 22px;
        overflow: hidden;
    }

    .section-header {
        padding: 18px 22px;
        border-bottom: 1px solid #e5e7eb;
        background: #fafafa;
    }

    .section-header h2 {
        margin: 0;
        font-size: 19px;
        color: #111827;
    }

    .section-header p {
        margin: 5px 0 0;
        font-size: 13px;
        color: #6b7280;
    }

    table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
    }

    th {
        background: #111827;
        color: #fff;
        text-align: left;
        padding: 11px 10px;
        white-space: nowrap;
    }

    td {
        border-top: 1px solid #eef0f3;
        padding: 9px 10px;
        vertical-align: top;
    }

    tbody tr:nth-child(even) {
        background: #fafafa;
    }

    .badge {
        display: inline-block;
        border-radius: 999px;
        padding: 4px 9px;
        font-weight: 800;
        font-size: 11px;
        white-space: nowrap;
    }

    .badge.success { background: #dcfce7; color: #166534; }
    .badge.danger { background: #fee2e2; color: #b91c1c; }
    .badge.warn { background: #fef3c7; color: #92400e; }
    .badge.neutral { background: #e5e7eb; color: #374151; }

    .footer {
        margin-top: 24px;
        color: #6b7280;
        font-size: 12px;
        text-align: center;
    }

    @media print {
        body { background: #fff; }
        .page { padding: 0; }
        .hero, .card, .section { box-shadow: none; }
    }
</style>
</head>
<body>
<div class="page">

    <div class="hero">
        <div>
            <small>Santander Support Web V2</small>
            <h1>Controle Harmony</h1>
            <p>Relatório profissional de acompanhamento das notificações e estado dos dispositivos.</p>
        </div>
        <div class="hero-box">
            <strong>${percentResolvido}%</strong>
            <span>Resolvidos / Active</span><br>
            <small>Gerado em ${escapeHtmlHarmony(agora)}</small>
        </div>
    </div>

    <div class="cards">
        <div class="card dark">
            <h3>Total no ficheiro</h3>
            <div class="number">${todos.length}</div>
        </div>

        <div class="card green">
            <h3>Resolvidos / Active</h3>
            <div class="number">${resolvidos.length}</div>
        </div>

        <div class="card red">
            <h3>Pendentes</h3>
            <div class="number">${pendentes.length}</div>
        </div>

        <div class="card orange">
            <h3>Já notificados</h3>
            <div class="number">${notificados.length}</div>
        </div>

        <div class="card red">
            <h3>Nunca notificados</h3>
            <div class="number">${nuncaNotificados.length}</div>
        </div>

        <div class="card orange">
            <h3>Para reenvio</h3>
            <div class="number">${reenviar.length}</div>
        </div>

        <div class="card red">
            <h3>Para escalar</h3>
            <div class="number">${escalar.length}</div>
        </div>

        <div class="card dark">
            <h3>Users desativados</h3>
            <div class="number">${desativados.length}</div>
        </div>
    </div>

    <div class="section">
        <div class="section-header">
            <h2>Dispositivos pendentes de regularização</h2>
            <p>Lista de utilizadores/dispositivos com Status diferente de ${escapeHtmlHarmony(statusOk)}.</p>
        </div>

        <table>
            <thead>
                <tr>
                    <th>UPN</th>
                    <th>Nome</th>
                    <th>Estado User</th>
                    <th>Device</th>
                    <th>Tipo</th>
                    <th>OS</th>
                    <th>Cliente</th>
                    <th>Last Seen</th>
                    <th>Status</th>
                    <th>Qtd.</th>
                    <th>Últ. notificação</th>
                    <th>Outro Harmony OK</th>
                        <th>Outro Device OK</th>
                        <th>Recomendação</th>
                </tr>
            </thead>
            <tbody>
                ${rowsPendentes || `<tr><td colspan="12">Nenhum dispositivo pendente.</td></tr>`}
            </tbody>
        </table>
    </div>

    <div class="footer">
        Relatório gerado automaticamente pelo Santander Support Web V2 · Controle Harmony
    </div>

</div>
</body>
</html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "Controle_Harmony_Relatorio_Visual_" + new Date().toISOString().slice(0, 19).replaceAll(":", "-") + ".html";
    a.click();

    URL.revokeObjectURL(url);

    harmonyLog("Relatório visual profissional exportado.");
}


function atualizarHistoricoCampanhaHarmony(resultados) {
    if (!resultados || resultados.length === 0) {
        harmonyLog("Nenhum resultado recebido para atualizar histórico.");
        return;
    }

    const hist = carregarHistoricoHarmony();
    const agora = new Date().toLocaleString();

    resultados
        .filter(r => r.success === true)
        .forEach(r => {
            let itemOriginal = null;

            if (harmonyResultado && harmonyResultado.items) {
                itemOriginal = harmonyResultado.items.find(x =>
                    String(x["Email"] || "").toLowerCase() === String(r.email || "").toLowerCase() &&
                    String(x["Name"] || "") === String(r.device || "")
                );
            }

            let key = r.historyKey || "";

            if (!key && itemOriginal) {
                key = itemOriginal["_HistoryKey"] || getHarmonyKey(itemOriginal);
            }

            if (!key) {
                key = (String(r.email || "") + "|" + String(r.device || "")).toLowerCase();
            }

            if (!hist[key]) {
                hist[key] = {
                    firstDetectedAt: agora,
                    lastDetectedAt: agora,
                    notifyCount: 0,
                    firstNotifyAt: "",
                    deadlineAt: "",
                    lastNotifyAt: "",
                    lastStatus: ""
                };
            }

            if (!hist[key].firstNotifyAt) {
                hist[key].firstNotifyAt = agora;

                const prazo = new Date();
                prazo.setHours(prazo.getHours() + 48);
                hist[key].deadlineAt = prazo.toISOString();
            }

            hist[key].notifyCount = Number(hist[key].notifyCount || 0) + 1;
            hist[key].lastNotifyAt = agora;
            hist[key].lastDetectedAt = agora;
            hist[key].lastStatus = r.status || "";
            hist[key].lastEmailTo = r.email || "";
            hist[key].lastCc = "santander.enduser@santander.pt";

            if (itemOriginal) {
                itemOriginal["_HistoryKey"] = key;
                itemOriginal["_NotifyCount"] = hist[key].notifyCount;
                itemOriginal["_LastNotifyAt"] = hist[key].lastNotifyAt;
                itemOriginal["_FirstDetectedAt"] = hist[key].firstDetectedAt;
                itemOriginal["_LastDetectedAt"] = hist[key].lastDetectedAt;
                itemOriginal["_SuggestedAction"] = getAcaoSugeridaHarmony(itemOriginal);
            }
        });

    salvarHistoricoHarmony(hist);

    if (harmonyResultado && harmonyResultado.items) {
        renderResumoHarmony();
        renderTabelaHarmony(harmonyResultado.items);
        atualizarPreviewMensagemHarmony();
    }

    harmonyLog("Histórico de campanha atualizado: " + resultados.filter(r => r.success === true).length + " envio(s).");
}

async function enviarCampanhaHarmony() {
    try {
        if (!harmonyResultado || !harmonyResultado.items || harmonyResultado.items.length === 0) {
            alert("Processe primeiro o ficheiro CSV.");
            return;
        }

        const candidatos = harmonyResultado.items.filter(x => {
            const email = String(x["Email"] || "").trim();
            const statusConta = String(x["_AccountStatus"] || "").toLowerCase();

            if (!email) return false;
            if (statusConta.includes("desativado")) return false;
            if (x["_AccountEnabled"] === false) return false;
            if (x["_Ausente"] === "Sim") return false;

            return true;
        });

        const bloqueados = harmonyResultado.items.length - candidatos.length;

        if (candidatos.length === 0) {
            alert("Não existem utilizadores elegíveis para envio. Verifique contas desativadas ou emails vazios.");
            return;
        }

        const confirmar = confirm(
            "Confirmar envio da campanha Harmony?\n\n" +
            "Pendentes encontrados: " + harmonyResultado.items.length + "\n" +
            "Emails a enviar: " + candidatos.length + "\n" +
            "Bloqueados/ignorados: " + bloqueados + "\n\n" +
            "Será enviado email com CC para santander.enduser@santander.pt.\n" +
            "Os manuais Android/iOS serão anexados automaticamente.\n\n" +
            "Deseja continuar?"
        );

        if (!confirmar) return;

        const fromAddress = document.getElementById("harmonyEmailFrom")
            ? document.getElementById("harmonyEmailFrom").value.trim()
            : "User.Action.Required@santander.pt";

        const subject = document.getElementById("harmonyEmailSubject")
            ? document.getElementById("harmonyEmailSubject").value
            : "Ação necessária | Validação da aplicação Harmony no dispositivo corporativo";

        const messageTemplate = document.getElementById("harmonyEmailMessage")
            ? document.getElementById("harmonyEmailMessage").value
            : "";

        const itemsPreparados = candidatos.map(x => prepararItemEmailHarmony(x));

        harmonyProgress(10, "A iniciar campanha Harmony...");
        harmonyLog("Campanha iniciada. Emails a enviar: " + itemsPreparados.length);

        const response = await fetch("/module/controle-harmony/api?action=enviarCampanhaOutlook", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                action: "enviarCampanhaOutlook",
                fromAddress: fromAddress,
                subject: subject,
                messageTemplate: messageTemplate,
                cc: "santander.enduser@santander.pt",
                items: itemsPreparados
            })
        });

        const raw = await response.text();

        let data = null;

        try {
            data = parseHarmonyApiResponse(raw);
        }
        catch (e) {
            harmonyFinish(false, "Resposta inválida da API.");
            harmonyLog(e.message);
            alert(e.message);
            return;
        }

        if (!data.success) {
            harmonyFinish(false, "Erro ao enviar campanha.");
            harmonyLog(data.error || "Erro ao enviar campanha.");
            alert(data.error || "Erro ao enviar campanha.");
            return;
        }

        atualizarHistoricoCampanhaHarmony(data.results || []);

        harmonyFinish(true, "Campanha concluída.");
        harmonyLog("Campanha concluída.");
        harmonyLog("Enviados: " + data.sent);
        harmonyLog("Falhas: " + data.failed);
        harmonyLog("Relatório: " + (data.reportPath || ""));

        alert(
            "Campanha concluída.\n\n" +
            "Total processado: " + data.total + "\n" +
            "Enviados: " + data.sent + "\n" +
            "Falhas: " + data.failed + "\n\n" +
            "Relatório salvo em:\n" + data.reportPath
        );
    }
    catch (e) {
        harmonyFinish(false, "Erro na campanha.");
        harmonyLog("Erro campanha: " + e.message);
        alert("Erro na campanha:\n\n" + e.message);
    }
}



let harmonyAusenciasCache = {};

async function carregarAusenciasServidorHarmony() {
    try {
        const response = await fetch("/module/controle-harmony/api?action=listarAusencias");
        const raw = await response.text();
        const data = parseHarmonyApiResponse(raw);

        if (data && data.success) {
            harmonyAusenciasCache = data.ausencias || {};
            harmonyLog("Ausências carregadas do servidor: " + Object.keys(harmonyAusenciasCache).length);
        }
    }
    catch (e) {
        harmonyLog("Erro ao carregar ausências do servidor: " + e.message);
        harmonyAusenciasCache = {};
    }

    return harmonyAusenciasCache;
}

function carregarAusenciasHarmony() {
    return harmonyAusenciasCache || {};
}

function salvarAusenciasHarmony(data) {
    harmonyAusenciasCache = data || {};
}

async function marcarFeriasHarmony(email) {
    if (!email) {
        alert("Email inválido.");
        return;
    }

    const dataRegresso = prompt("Data prevista de regresso? Exemplo: 2026-06-20", "");
    if (dataRegresso === null) return;

    const motivo = prompt("Motivo da ausência:", "Férias / Resposta automática");
    if (motivo === null) return;

    try {
        const response = await fetch("/module/controle-harmony/api?action=guardarAusencia", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                action: "guardarAusencia",
                email: email,
                motivo: motivo || "Férias / Ausente",
                dataRegresso: dataRegresso || ""
            })
        });

        const raw = await response.text();
        const data = parseHarmonyApiResponse(raw);

        if (!data.success) {
            alert(data.error || "Erro ao guardar ausência.");
            return;
        }

        await carregarAusenciasServidorHarmony();
        aplicarAusenciasHarmony();
        renderResumoHarmony();
        renderTabelaHarmony(harmonyResultado.items);
        atualizarPreviewMensagemHarmony();

        harmonyLog("Utilizador marcado como ausente: " + email);
    }
    catch (e) {
        alert("Erro ao guardar ausência: " + e.message);
        harmonyLog("Erro ao guardar ausência: " + e.message);
    }
}

async function removerFeriasHarmony(email) {
    if (!email) return;

    const confirmar = confirm("Remover ausência/férias de " + email + "?");
    if (!confirmar) return;

    try {
        const response = await fetch("/module/controle-harmony/api?action=removerAusencia", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                action: "removerAusencia",
                email: email
            })
        });

        const raw = await response.text();
        const data = parseHarmonyApiResponse(raw);

        if (!data.success) {
            alert(data.error || "Erro ao remover ausência.");
            return;
        }

        await carregarAusenciasServidorHarmony();
        aplicarAusenciasHarmony();
        renderResumoHarmony();
        renderTabelaHarmony(harmonyResultado.items);
        atualizarPreviewMensagemHarmony();

        harmonyLog("Ausência removida: " + email);
    }
    catch (e) {
        alert("Erro ao remover ausência: " + e.message);
        harmonyLog("Erro ao remover ausência: " + e.message);
    }
}

function aplicarAusenciasHarmony() {
    if (!harmonyResultado || !harmonyResultado.items) return;

    const abs = carregarAusenciasHarmony();

    harmonyResultado.items.forEach(item => {
        const email = String(item["Email"] || "").toLowerCase();
        const a = abs[email];

        if (a) {
            item["_Ausente"] = "Sim";
            item["_AusenciaMotivo"] = a.motivo || "";
            item["_AusenciaRegresso"] = a.dataRegresso || "";
            item["_SuggestedAction"] = "Aguardar regresso";
        } else {
            item["_Ausente"] = "";
            item["_AusenciaMotivo"] = "";
            item["_AusenciaRegresso"] = "";
            item["_SuggestedAction"] = getAcaoSugeridaHarmony(item);
        }
    });
}






function pesquisarFeriasHarmony() {
    const input = document.getElementById("harmonyPesquisaFerias");
    const container = document.getElementById("harmonyResultadoPesquisaFerias");

    if (!input || !container) return;

    const termo = String(input.value || "").trim().toLowerCase();

    if (!harmonyResultado || !harmonyResultado.items || harmonyResultado.items.length === 0) {
        container.innerHTML = "<div class='harmony-empty'>Processe primeiro o ficheiro CSV.</div>";
        return;
    }

    if (termo.length < 2) {
        container.innerHTML = "<div class='harmony-empty'>Digite pelo menos 2 caracteres para pesquisar.</div>";
        return;
    }

    const encontrados = harmonyResultado.items.filter(r => {
        const email = String(r["Email"] || "").toLowerCase();
        const nome = String(r["_DisplayName"] || "").toLowerCase();
        const device = String(r["Name"] || "").toLowerCase();
        const status = String(r["Status"] || "").toLowerCase();

        return email.includes(termo) ||
               nome.includes(termo) ||
               device.includes(termo) ||
               status.includes(termo);
    }).slice(0, 20);

    if (encontrados.length === 0) {
        container.innerHTML = "<div class='harmony-empty'>Nenhum utilizador encontrado para: " + escapeHtmlHarmony(termo) + "</div>";
        return;
    }

    container.innerHTML = encontrados.map(r => {
        const email = String(r["Email"] || "");
        const nome = String(r["_DisplayName"] || email);
        const device = String(r["Name"] || "");
        const status = String(r["Status"] || "");
        const ausente = r["_Ausente"] === "Sim";

        const botao = ausente
            ? "<button class='harmony-btn harmony-btn-light' onclick=\"removerFeriasHarmony('" + escapeHtmlHarmony(email) + "'); pesquisarFeriasHarmony();\">Remover férias</button>"
            : "<button class='harmony-btn harmony-btn-secondary' onclick=\"marcarFeriasHarmony('" + escapeHtmlHarmony(email) + "'); pesquisarFeriasHarmony();\">Marcar férias</button>";

        return `
            <div class="harmony-search-item">
                <div>
                    <strong>${escapeHtmlHarmony(nome)}</strong>
                    <div class="harmony-search-sub">${escapeHtmlHarmony(email)}</div>
                    <div class="harmony-search-sub">Device: ${escapeHtmlHarmony(device)} | Status: ${escapeHtmlHarmony(status)}</div>
                    <div class="harmony-search-sub">Ausência: ${ausente ? "Sim" : "Não"} ${r["_AusenciaRegresso"] ? "| Regresso: " + escapeHtmlHarmony(r["_AusenciaRegresso"]) : ""}</div>
                </div>
                <div>${botao}</div>
            </div>
        `;
    }).join("");
}

setTimeout(() => {
    iniciarControleHarmony();
}, 300);





























/* ============================================================
   HARMONY V2 - CONSULTA POR DEVICE ID INTUNE
============================================================ */

function extrairHarmonyDeviceIds(texto) {
    const linhas = String(texto || "")
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(x => x);

    const map = {};
    const regexGuid = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

    linhas.forEach(linha => {
        const ids = linha.match(regexGuid) || [];

        ids.forEach(id => {
            const emailMatch = linha.match(/[A-Za-z0-9._%+-]+@corp\.santander\.pt/i);

            let platform = "";
            if (/android/i.test(linha)) platform = "Android";
            if (/ios|iphone|ipad/i.test(linha)) platform = "iOS";
            if (/windows/i.test(linha)) platform = "Windows";

            let harmony = "";
            let statusHarmony = "";

            if (/not\s+deploy/i.test(linha)) {
                harmony = "Deploy";
                statusHarmony = "Not deploy";
            } else if (/deploy/i.test(linha)) {
                harmony = "Deploy";
                statusHarmony = "Deploy";
            }

            map[id.toLowerCase()] = {
                id: id,
                raw: linha,
                username: emailMatch ? emailMatch[0] : "",
                platform: platform,
                harmony: harmony || "Deploy",
                statusHarmony: statusHarmony || "Not deploy"
            };
        });
    });

    return Object.values(map);
}

async function consultarDispositivosHarmonyPorIds() {
    const input = document.getElementById("harmonyDeviceIdsInput");

    if (!input) {
        alert("Campo harmonyDeviceIdsInput não encontrado.");
        return;
    }

    const devices = extrairHarmonyDeviceIds(input.value);

    if (!devices.length) {
        alert("Informe pelo menos um Device ID válido.");
        return;
    }

    harmonyProgress(10, "A preparar consulta Intune...");
    harmonyLog("Harmony V2: Device IDs extraídos: " + devices.length);

    try {
        const response = await fetch("/module/controle-harmony/api?action=consultarDispositivosIntunePorIds", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "consultarDispositivosIntunePorIds",
                devices: devices
            })
        });

        const raw = await response.text();
        harmonyLog("Resposta API Intune: HTTP " + response.status);

        const data = parseHarmonyApiResponse(raw);

        if (!data.success) {
            harmonyFinish(false, "Erro ao consultar Intune.");
            alert(data.error || "Erro ao consultar Intune.");
            return;
        }

        const rows = data.items || [];

        harmonyProgress(70, "A resolver utilizadores Entra/AD...");
        await resolverDisplayNamesHarmony(rows);

        aplicarHistoricoHarmony(rows);

        harmonyResultado = {
            total: rows.length,
            active: 0,
            notificar: rows.length,
            statusOk: "Active",
            items: rows,
            todos: rows,
            generatedAt: new Date().toLocaleString()
        };

        await carregarAusenciasServidorHarmony();
        aplicarAusenciasHarmony();

        renderResumoHarmony();
        renderTabelaHarmony(rows);
        atualizarPreviewMensagemHarmony();

        harmonyFinish(true, "Consulta Intune concluída.");
        harmonyLog("Encontrados no Intune: " + rows.filter(x => x._FoundIntune === true).length);
        harmonyLog("Não encontrados no Intune: " + rows.filter(x => x._FoundIntune !== true).length);
    }
    catch (e) {
        harmonyFinish(false, "Erro na consulta Intune.");
        harmonyLog("Erro Harmony V2: " + e.message);
        alert("Erro na consulta Intune:\n\n" + e.message);
    }
}

function limparHarmonyIds() {
    const input = document.getElementById("harmonyDeviceIdsInput");
    if (input) input.value = "";
    limparHarmony();
}


/* HARMONY_V2_JS_START */

function extrairHarmonyDeviceIds(texto) {
    const linhas = String(texto || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const regexGuid = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
    const map = {};

    linhas.forEach(linha => {
        const ids = linha.match(regexGuid) || [];
        ids.forEach(id => {
            const emailMatch = linha.match(/[A-Za-z0-9._%+-]+@corp\.santander\.pt/i);

            let platform = "";
            if (/android/i.test(linha)) platform = "Android";
            if (/ios|iphone|ipad/i.test(linha)) platform = "iOS";
            if (/windows/i.test(linha)) platform = "Windows";

            let statusHarmony = /not\s+deploy/i.test(linha) ? "Not deploy" : "Deploy";

            map[id.toLowerCase()] = {
                id,
                raw: linha,
                username: emailMatch ? emailMatch[0] : "",
                platform,
                harmony: "Deploy",
                statusHarmony
            };
        });
    });

    return Object.values(map);
}

async function consultarDispositivosHarmonyPorIds() {
    const input = document.getElementById("harmonyDeviceIdsInput");
    if (!input) {
        alert("Campo de IDs não encontrado.");
        return;
    }

    const devices = extrairHarmonyDeviceIds(input.value);

    if (!devices.length) {
        alert("Informe pelo menos um Device ID válido.");
        return;
    }

    harmonyProgress(10, "A consultar Intune...");
    harmonyLog("Harmony V2 IDs extraídos: " + devices.length);

    try {
        const response = await fetch("/module/controle-harmony/api?action=consultarDispositivosIntunePorIds", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "consultarDispositivosIntunePorIds",
                devices
            })
        });

        const raw = await response.text();
        const data = parseHarmonyApiResponse(raw);

        if (!data.success) {
            harmonyFinish(false, "Erro ao consultar Intune.");
            alert(data.error || "Erro ao consultar Intune.");
            return;
        }

        const rows = data.items || [];

        harmonyProgress(70, "A resolver utilizadores...");
        await resolverDisplayNamesHarmony(rows);
        aplicarHistoricoHarmony(rows);

        harmonyResultado = {
            total: rows.length,
            active: 0,
            notificar: rows.length,
            statusOk: "Active",
            items: rows,
            todos: rows,
            generatedAt: new Date().toLocaleString()
        };

        await carregarAusenciasServidorHarmony();
        aplicarAusenciasHarmony();

        renderResumoHarmony();
        renderTabelaHarmony(rows);
        atualizarPreviewMensagemHarmony();

        harmonyFinish(true, "Consulta Intune concluída.");
        harmonyLog("Encontrados no Intune: " + rows.filter(x => x._FoundIntune === true).length);
        harmonyLog("Não encontrados no Intune: " + rows.filter(x => x._FoundIntune !== true).length);
    }
    catch (e) {
        harmonyFinish(false, "Erro Harmony V2.");
        harmonyLog("Erro Harmony V2: " + e.message);
        alert("Erro Harmony V2:\n\n" + e.message);
    }
}

function limparHarmonyIds() {
    const input = document.getElementById("harmonyDeviceIdsInput");
    if (input) input.value = "";
    limparHarmony();
}

/* HARMONY_V2_JS_END */





/* HARMONY_V3_UI_START */

let harmonyV3Items = [];

function harmonyV3Badge(text, type) {
    const cls = type || "neutral";
    return `<span class="tag ${cls}">${escapeHtmlHarmony(text || "")}</span>`;
}

function harmonyV3ClassByIntune(status) {
    const s = String(status || "").toLowerCase();
    if (s === "compliant") return "success";
    if (s.includes("grace")) return "warn";
    if (s.includes("noncompliant")) return "danger";
    if (s.includes("não")) return "danger";
    return "neutral";
}

function harmonyV3ClassByOrigem(origem) {
    const s = String(origem || "").toLowerCase();
    if (s.includes("intune")) return "success";
    if (s.includes("entra")) return "warn";
    if (s.includes("não")) return "danger";
    return "neutral";
}

function renderHarmonyV3Dashboard(items) {
    harmonyV3Items = items || harmonyV3Items || [];

    const total = harmonyV3Items.length;
    const intune = harmonyV3Items.filter(x => x["Origem Consulta"] === "Intune").length;
    const entra = harmonyV3Items.filter(x => x["Origem Consulta"] === "Entra Device").length;
    const naoEncontrado = harmonyV3Items.filter(x => x["Origem Consulta"] === "Não encontrado").length;
    const compliant = harmonyV3Items.filter(x => String(x["Status Intune"] || "").toLowerCase() === "compliant").length;
    const grace = harmonyV3Items.filter(x => String(x["Status Intune"] || "").toLowerCase().includes("grace")).length;
    const harmonyNao = harmonyV3Items.filter(x => String(x["Harmony Instalado"] || "").toLowerCase().includes("não")).length;

    const el = document.getElementById("harmonyV3Dashboard");
    if (!el) return;

    el.innerHTML = `
        <div class="info-card"><h3>Total</h3><span>${total}</span></div>
        <div class="info-card success"><h3>Intune</h3><span>${intune}</span></div>
        <div class="info-card warn"><h3>Entra Device</h3><span>${entra}</span></div>
        <div class="info-card danger"><h3>Não Encontrado</h3><span>${naoEncontrado}</span></div>
        <div class="info-card success"><h3>Compliant</h3><span>${compliant}</span></div>
        <div class="info-card warn"><h3>In Grace</h3><span>${grace}</span></div>
        <div class="info-card danger"><h3>Harmony Pendente</h3><span>${harmonyNao}</span></div>
    `;
}

function renderHarmonyV3Table(items) {
    if (items) harmonyV3Items = items;

    const tbody = document.getElementById("harmonyV3TableBody");
    if (!tbody) return;

    const termo = String(document.getElementById("harmonyV3Search")?.value || "").toLowerCase();
    const origem = String(document.getElementById("harmonyV3Origem")?.value || "");

    let rows = harmonyV3Items || [];

    if (origem) {
        rows = rows.filter(x => String(x["Origem Consulta"] || "") === origem);
    }

    if (termo) {
        rows = rows.filter(x =>
            String(x["Email"] || "").toLowerCase().includes(termo) ||
            String(x["_DisplayName"] || "").toLowerCase().includes(termo) ||
            String(x["Name"] || "").toLowerCase().includes(termo) ||
            String(x["Status Intune"] || "").toLowerCase().includes(termo) ||
            String(x["Harmony Instalado"] || "").toLowerCase().includes(termo)
        );
    }

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="11" class="harmony-empty">Nenhum resultado.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td>${escapeHtmlHarmony(r["Email"])}</td>
            <td>${escapeHtmlHarmony((r["_DisplayName"] && r["_DisplayName"] !== r["Email"]) ? r["_DisplayName"] : (r["_ResolvedName"] || r["Email"]))}</td>
            <td>${escapeHtmlHarmony(r["Name"])}</td>
            <td>${escapeHtmlHarmony(r["Device Type"])}</td>
            <td>${escapeHtmlHarmony(r["OS Version"])}</td>
            <td>${harmonyV3Badge(r["Origem Consulta"], harmonyV3ClassByOrigem(r["Origem Consulta"]))}</td>
            <td>${harmonyV3Badge(r["Status Intune"], harmonyV3ClassByIntune(r["Status Intune"]))}</td>
            <td>${harmonyV3Badge(r["Harmony Instalado"], String(r["Harmony Instalado"] || "").toLowerCase().includes("não") ? "danger" : "success")}</td>
            <td>${escapeHtmlHarmony(r["Last Seen"])}</td>
            <td>${harmonyV3Badge((r["_AccountStatus"] === "Erro consulta" ? "Ativo / Entra ID" : (r["_AccountStatus"] || "")), String((r["_AccountStatus"] || "").toLowerCase()).includes("ativo") ? "success" : "warn")}</td>
            <td>${harmonyV3Badge(r["Outro Harmony OK"] || "", String(r["Outro Harmony OK"] || "").toLowerCase() === "sim" ? "success" : "danger")}</td>
            <td>${escapeHtmlHarmony(r["Outro Device OK"] || "")}</td>
            <td>${harmonyV3Badge(r["Recomendação V4"] || r["_SuggestedAction"] || "", String(r["Recomendação V4"] || "").toLowerCase().includes("não contactar") ? "success" : "danger")}</td>
        </tr>
    `).join("");
}

if (typeof renderTabelaHarmony === "function" && !window.renderTabelaHarmonyOriginalV3) {
    window.renderTabelaHarmonyOriginalV3 = renderTabelaHarmony;

    renderTabelaHarmony = function(items) {
        window.renderTabelaHarmonyOriginalV3(items);
        renderHarmonyV3Dashboard(items || []);
        renderHarmonyV3Table(items || []);
    };
}

/* HARMONY_V3_UI_END */




/* HARMONY_V5_SERVICENOW_START */

const HARMONY_SERVICENOW_URL = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7&sysparm_category=6f044c7c1b1945505ae05532604bcb04";

function resumoServiceNowHarmony(r) {
    return [
        "CONTROLO HARMONY - PEDIDO SERVICENOW",
        "",
        "Utilizador: " + (r["Email"] || ""),
        "Nome: " + (r["_DisplayName"] || r["Email"] || ""),
        "Device: " + (r["Name"] || ""),
        "Plataforma: " + (r["Device Type"] || ""),
        "Versão SO: " + (r["OS Version"] || ""),
        "Origem: " + (r["Origem Consulta"] || ""),
        "Status Intune: " + (r["Status Intune"] || ""),
        "Harmony: " + (r["Status"] || ""),
        "Harmony Instalado: " + (r["Harmony Instalado"] || ""),
        "Último Sync/Login: " + (r["Last Seen"] || ""),
        "Outro device OK: " + (r["Outro Device OK"] || "Não"),
        "Recomendação: " + (r["Recomendação V4"] || r["_SuggestedAction"] || ""),
        "",
        "Device ID/AzureADDeviceId: " + (r["Azure AD Device ID"] || ""),
        "Intune Device ID: " + (r["Intune Device ID"] || ""),
        "Serial: " + (r["Serial Number"] || ""),
        "",
        "Resumo:",
        r["Resumo V4"] || "",
        "",
        "Linha original Harmony:",
        r["_RawHarmonyLine"] || ""
    ].join("\n");
}

function copiarResumoServiceNowHarmony(index) {
    const r = harmonyV3Items[index];
    if (!r) return;

    const texto = resumoServiceNowHarmony(r);

    navigator.clipboard.writeText(texto).then(() => {
        alert("Resumo copiado. Agora cole no ServiceNow.");
    }).catch(() => {
        prompt("Copie o resumo abaixo:", texto);
    });
}

function abrirServiceNowHarmony(index) {
    const r = harmonyV3Items[index];
    if (!r) return;

    copiarResumoServiceNowHarmony(index);
    window.open(HARMONY_SERVICENOW_URL, "_blank");
}

function renderHarmonyV3Table(items) {
    if (items) harmonyV3Items = items;

    const tbody = document.getElementById("harmonyV3TableBody");
    if (!tbody) return;

    const table = tbody.closest("table");
    if (table && table.tHead) {
        table.tHead.innerHTML = `
            <tr>
                <th>Utilizador</th>
                <th>Nome</th>
                <th>Device</th>
                <th>Plataforma</th>
                <th>Versão</th>
                <th>Origem</th>
                <th>Status Intune</th>
                <th>Harmony</th>
                <th>Último Sync/Login</th>
                <th>Estado Conta</th>
                <th>Outro Harmony OK</th>
                <th>Outro Device OK</th>
                <th>Recomendação</th>
                <th>Ações</th>
            </tr>
        `;
    }

    const termo = String(document.getElementById("harmonyV3Search")?.value || "").toLowerCase();
    const origem = String(document.getElementById("harmonyV3Origem")?.value || "");

    let rows = harmonyV3Items || [];

    if (origem) rows = rows.filter(x => String(x["Origem Consulta"] || "") === origem);

    if (termo) {
        rows = rows.filter(x =>
            String(x["Email"] || "").toLowerCase().includes(termo) ||
            String(x["_DisplayName"] || "").toLowerCase().includes(termo) ||
            String(x["Name"] || "").toLowerCase().includes(termo) ||
            String(x["Status Intune"] || "").toLowerCase().includes(termo)
        );
    }

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="14" class="harmony-empty">Nenhum resultado.</td></tr>`;
        return;
    }

    tbody.innerHTML = rows.map((r, idx) => `
        <tr>
            <td>${escapeHtmlHarmony(r["Email"])}</td>
            <td>${escapeHtmlHarmony(r["_DisplayName"] || r["Email"])}</td>
            <td>${escapeHtmlHarmony(r["Name"])}</td>
            <td>${escapeHtmlHarmony(r["Device Type"])}</td>
            <td>${escapeHtmlHarmony(r["OS Version"])}</td>
            <td>${harmonyV3Badge(r["Origem Consulta"], harmonyV3ClassByOrigem(r["Origem Consulta"]))}</td>
            <td>${harmonyV3Badge(r["Status Intune"], harmonyV3ClassByIntune(r["Status Intune"]))}</td>
            <td>${harmonyV3Badge(r["Harmony Instalado"], String(r["Harmony Instalado"] || "").toLowerCase().includes("não") ? "danger" : "success")}</td>
            <td>${escapeHtmlHarmony(r["Last Seen"])}</td>
            <td>${harmonyV3Badge(r["_AccountStatus"] || "", String(r["_AccountStatus"] || "").toLowerCase().includes("ativo") ? "success" : "warn")}</td>
            <td>${harmonyV3Badge(r["Outro Harmony OK"] || "Não", String(r["Outro Harmony OK"] || "").toLowerCase() === "sim" ? "success" : "danger")}</td>
            <td>${escapeHtmlHarmony(r["Outro Device OK"] || "")}</td>
            <td>${harmonyV3Badge(r["Recomendação V4"] || "Enviar notificação", "danger")}</td>
            <td>
                <button class="harmony-btn harmony-btn-primary" onclick="abrirServiceNowHarmony(${idx})">ServiceNow</button>
                <button class="harmony-btn harmony-btn-light" onclick="copiarResumoServiceNowHarmony(${idx})">Copiar</button>
            </td>
        </tr>
    `).join("");
}

/* HARMONY_V5_SERVICENOW_END */

