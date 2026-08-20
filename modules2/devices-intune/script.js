let devicesIntuneUltimoResultado = null;
let devicesIntuneCsvData = [];
let devicesIntuneCsvResultados = [];
let devicesIntuneResultadoAtual = [];
let devicesIntuneResultadoFiltrado = [];
let devicesIntuneSelecionados = new Set();

function devicesIntuneProgress(percent, text) {
    const wrap = document.getElementById("devicesIntuneProgress");
    const bar = document.getElementById("devicesIntuneProgressBar");
    const label = document.getElementById("devicesIntuneProgressText");
    const pct = document.getElementById("devicesIntuneProgressPercent");

    if (!wrap || !bar || !label || !pct) return;

    const value = Math.max(0, Math.min(100, Number(percent || 0)));

    wrap.style.display = "block";
    bar.style.width = value + "%";
    label.innerText = text || "A processar...";
    pct.innerText = value + "%";
}

function devicesIntuneProgressHide(delayMs) {
    const wrap = document.getElementById("devicesIntuneProgress");
    if (!wrap) return;

    setTimeout(() => {
        wrap.style.display = "none";
    }, delayMs || 600);
}


function devicesIntuneNormalize(value) {
    if (value === null || value === undefined) return "";

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    if (typeof value === "object") {
        if (value.value) return String(value.value);
        if (value.displayName) return String(value.displayName);
        if (value.name) return String(value.name);

        const keys = Object.keys(value);
        if (keys.length === 0) return "";

        return JSON.stringify(value);
    }

    return String(value);
}

function devicesIntuneSetStatus(tipo, mensagem) {
    const el = document.getElementById("devicesIntuneStatus");
    if (!el) return;

    let classe = "di-alert-info";
    if (tipo === "erro") classe = "di-alert-erro";
    if (tipo === "ok") classe = "di-alert-ok";
    if (tipo === "aviso") classe = "di-alert-aviso";

    el.innerHTML = `<div class="di-alert ${classe}">${mensagem}</div>`;
}

async function devicesIntuneApi(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();

    try {
        let json = JSON.parse(text);

        if (typeof json === "string") {
            json = JSON.parse(json);
        }

        return json;
    } catch (e) {
        throw new Error("Resposta inválida da API: " + text);
    }
}

async function devicesIntuneStatus() {
    devicesIntuneProgress(20, "A verificar ligação Graph/Intune..."); devicesIntuneSetStatus("info", "A verificar ligação Graph/Intune...");

    try {
        devicesIntuneProgress(55, "A validar sessão Graph..."); const json = await devicesIntuneApi("/module/devices-intune/api?action=status"); devicesIntuneProgress(85, "A concluir validação...");

        if (json.success && json.graph && json.graph.connected) {
            devicesIntuneProgress(100, "Ligação validada."); devicesIntuneSetStatus("ok", "Graph/Intune conectado: " + escapeHtml(json.graph.account)); devicesIntuneProgressHide(700);
        } else {
            devicesIntuneProgressHide(500); devicesIntuneSetStatus("aviso", "Graph/Intune não conectado. Clique em Conectar WAM.");
        }
    } catch (ex) {
        devicesIntuneProgress(100, "Erro no processamento."); devicesIntuneProgressHide(1200); devicesIntuneSetStatus("erro", "Erro ao verificar status: " + escapeHtml(ex.message));
    }
}

async function devicesIntuneConectar() {
    devicesIntuneProgress(25, "A conectar Graph/Intune..."); devicesIntuneSetStatus("info", "A conectar Graph/Intune...");

    try {
        devicesIntuneProgress(45, "A autenticar no Graph/Intune..."); const json = await devicesIntuneApi("/module/devices-intune/api?action=connect"); devicesIntuneProgress(85, "A confirmar ligação...");

        if (!json.success) {
            devicesIntuneProgress(100, "Erro no processamento."); devicesIntuneProgressHide(1200); devicesIntuneSetStatus("erro", escapeHtml(json.message || "Erro ao conectar Graph/Intune."));
            return;
        }

        const conta = json.graph && json.graph.account ? json.graph.account : "";
        devicesIntuneProgress(100, "Graph/Intune conectado."); devicesIntuneSetStatus("ok", "Graph/Intune conectado com sucesso. Conta: " + escapeHtml(conta)); devicesIntuneProgressHide(700);

    } catch (ex) {
        devicesIntuneProgress(100, "Erro no processamento."); devicesIntuneProgressHide(1200); devicesIntuneSetStatus("erro", "Erro ao conectar Graph/Intune: " + escapeHtml(ex.message));
    }
}

async function devicesIntunePesquisar() {
    const input = document.getElementById("devicesIntuneQuery");
    const query = input ? input.value.trim() : "";

    if (!query) {
        devicesIntuneProgressHide(500); devicesIntuneSetStatus("aviso", "Informe um utilizador, UPN, serial number, IMEI ou nome do device.");
        return;
    }

    devicesIntuneProgress(15, "A consultar dispositivos no Intune..."); devicesIntuneSetStatus("info", "A consultar dispositivos no Intune...");
    document.getElementById("devicesIntuneResumo").innerHTML = "";
    document.getElementById("devicesIntuneResultado").innerHTML = "";

    try {
        devicesIntuneProgress(35, "A consultar Microsoft Intune..."); const json = await devicesIntuneApi("/module/devices-intune/api?action=search&query=" + encodeURIComponent(query)); devicesIntuneProgress(75, "A preparar resultado...");

        if (!json.success) {
            devicesIntuneProgress(100, "Erro no processamento."); devicesIntuneProgressHide(1200); devicesIntuneSetStatus("erro", escapeHtml(json.message || "Erro ao consultar dispositivos."));
            return;
        }

        devicesIntuneUltimoResultado = json;
        devicesIntuneRender(json);
        devicesIntuneProgress(100, "Consulta concluída."); devicesIntuneSetStatus("ok", `Consulta concluída. ${json.total || 0} dispositivo(s) encontrado(s).`); devicesIntuneProgressHide(900);

    } catch (ex) {
        devicesIntuneProgress(100, "Erro no processamento."); devicesIntuneProgressHide(1200); devicesIntuneSetStatus("erro", "Erro na pesquisa: " + escapeHtml(ex.message));
    }
}

function devicesIntuneComplianceBadge(value) {
    const v = devicesIntuneNormalize(value).toLowerCase();

    if (!v) return `<span class="di-badge">Sem estado</span>`;
    if (v.includes("non")) return `<span class="di-badge di-badge-red">${escapeHtml(v)}</span>`;
    if (v.includes("compliant")) return `<span class="di-badge di-badge-green">${escapeHtml(v)}</span>`;
    return `<span class="di-badge">${escapeHtml(v)}</span>`;
}

function devicesIntuneBoolBadge(value, labelTrue, labelFalse) {
    const v = devicesIntuneNormalize(value).toLowerCase();
    const ok = v === "true" || v === "sim";
    return ok
        ? `<span class="di-badge di-badge-green">${labelTrue}</span>`
        : `<span class="di-badge">${labelFalse}</span>`;
}

function devicesIntuneRender(json) {
    const devices = json.devices || [];

    const total = devices.length;
    const compliant = devices.filter(d => devicesIntuneNormalize(d.complianceState).toLowerCase().includes("compliant") && !devicesIntuneNormalize(d.complianceState).toLowerCase().includes("non")).length;
    const nonCompliant = devices.filter(d => devicesIntuneNormalize(d.complianceState).toLowerCase().includes("non")).length;
    const encrypted = devices.filter(d => String(d.isEncrypted).toLowerCase() === "true").length;
    const semSync30 = devices.filter(d => Number(d.diasSemSync || 0) > 30).length;

    document.getElementById("devicesIntuneResumo").innerHTML = `
        <div class="di-kpis">
            <div class="di-kpi"><span>Total</span><strong>${total}</strong></div>
            <div class="di-kpi"><span>Compliant</span><strong>${compliant}</strong></div>
            <div class="di-kpi"><span>Non compliant</span><strong>${nonCompliant}</strong></div>
            <div class="di-kpi"><span>Encrypted</span><strong>${encrypted}</strong></div>
            <div class="di-kpi"><span>Sem sync > 30d</span><strong>${semSync30}</strong></div>
        </div>
    `;

    let cards = "";

    devices.forEach(d => {
        cards += `
            <div class="di-device-card">
                <div class="di-device-header">
                    <div class="di-device-title">
                        <h3>${escapeHtml(devicesIntuneNormalize(d.deviceName))}</h3>
                        <p>${escapeHtml(devicesIntuneNormalize(d.userDisplayName))} • ${escapeHtml(devicesIntuneNormalize(d.userPrincipalName))}</p>
                    </div>
                    <div class="di-badges">
                        <span class="di-badge di-badge-dark">${escapeHtml(devicesIntuneNormalize(d.operatingSystem))}</span>
                        ${devicesIntuneComplianceBadge(d.complianceState)}
                        ${devicesIntuneBoolBadge(d.isEncrypted, "Encrypted", "Not encrypted")}
                        ${devicesIntuneBoolBadge(d.isSupervised, "Supervised", "Not supervised")}
                    </div>
                </div>

                <div class="di-details">
                    <div class="di-field"><label>Email</label><div>${escapeHtml(devicesIntuneNormalize(d.emailAddress))}</div></div>
                    <div class="di-field"><label>Versão SO</label><div>${escapeHtml(devicesIntuneNormalize(d.osVersion))}</div></div>
                    <div class="di-field"><label>Fabricante</label><div>${escapeHtml(devicesIntuneNormalize(d.manufacturer))}</div></div>
                    <div class="di-field"><label>Modelo</label><div>${escapeHtml(devicesIntuneNormalize(d.model))}</div></div>

                    <div class="di-field"><label>Serial Number</label><div>${escapeHtml(devicesIntuneNormalize(d.serialNumber))}</div></div>
                    <div class="di-field"><label>IMEI</label><div>${escapeHtml(devicesIntuneNormalize(d.imei)) || "<span class='di-muted'>Sem informação</span>"}</div></div>
                    <div class="di-field"><label>WiFi MAC</label><div>${escapeHtml(devicesIntuneNormalize(d.wiFiMacAddress))}</div></div>
                    <div class="di-field"><label>Último Sync</label><div>${escapeHtml(devicesIntuneNormalize(d.lastSyncDateTime))}</div></div>

                    <div class="di-field"><label>Dias sem Sync</label><div>${escapeHtml(devicesIntuneNormalize(d.diasSemSync))}</div></div>
                    <div class="di-field"><label>Enrollment</label><div>${escapeHtml(devicesIntuneNormalize(d.enrollmentType)) || "<span class='di-muted'>Sem informação</span>"}</div></div>
                    <div class="di-field"><label>Owner Type</label><div>${escapeHtml(devicesIntuneNormalize(d.ownerType)) || "<span class='di-muted'>Sem informação</span>"}</div></div>
                    <div class="di-field"><label>JailBroken</label><div>${escapeHtml(devicesIntuneNormalize(d.jailBroken))}</div></div>

                    <div class="di-field"><label>Azure Device ID</label><div>${escapeHtml(devicesIntuneNormalize(d.azureADDeviceId))}</div></div>
                    <div class="di-field"><label>Intune Device ID</label><div>${escapeHtml(devicesIntuneNormalize(d.id))}</div></div>
                    <div class="di-field"><label>Enrolled Date</label><div>${escapeHtml(devicesIntuneNormalize(d.enrolledDateTime))}</div></div>
                    <div class="di-field"><label>Management State</label><div>${escapeHtml(devicesIntuneNormalize(d.managementState)) || "<span class='di-muted'>Sem informação</span>"}</div></div>
                </div>
            </div>
        `;
    });

    let table = `
        <div class="di-panel">
            <h3>Resultado em tabela</h3>
            <div class="di-table-wrap">
                <table class="di-table">
                    <thead>
                        <tr>
                            <th>Utilizador</th>
                            <th>UPN</th>
                            <th>Device</th>
                            <th>SO</th>
                            <th>Versão</th>
                            <th>Compliance</th>
                            <th>Serial</th>
                            <th>Último Sync</th>
                            <th>Dias</th>
                            <th>Azure Device ID</th>
                            <th>Intune Device ID</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    devices.forEach(d => {
        table += `
            <tr>
                <td>${escapeHtml(devicesIntuneNormalize(d.userDisplayName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.userPrincipalName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.deviceName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.operatingSystem))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.osVersion))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.complianceState)) || "Sem estado"}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.serialNumber))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.lastSyncDateTime))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.diasSemSync))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.azureADDeviceId))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.id))}</td>
            </tr>
        `;
    });

    table += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.getElementById("devicesIntuneResultado").innerHTML = cards + table;
}

function devicesIntuneLimpar() {
    document.getElementById("devicesIntuneQuery").value = "";
    document.getElementById("devicesIntuneStatus").innerHTML = "";
    document.getElementById("devicesIntuneResumo").innerHTML = "";
    document.getElementById("devicesIntuneResultado").innerHTML = "";
    devicesIntuneUltimoResultado = null;
}

function devicesIntuneExportCsv() {
    if (!devicesIntuneUltimoResultado || !devicesIntuneUltimoResultado.devices) {
        devicesIntuneProgressHide(500); devicesIntuneSetStatus("aviso", "Não existem dados para exportar.");
        return;
    }

    const devices = devicesIntuneUltimoResultado.devices;
    const headers = Object.keys(devices[0] || {});
    let csv = headers.join(";") + "\n";

    devices.forEach(d => {
        csv += headers.map(h => csvEscape(devicesIntuneNormalize(d[h]))).join(";") + "\n";
    });

    downloadTextFile("devices-intune.csv", csv, "text/csv;charset=utf-8");
}

function devicesIntuneExportHtml() {
    const conteudo = document.getElementById("devicesIntuneResultado").innerHTML;
    if (!conteudo) {
        devicesIntuneProgressHide(500); devicesIntuneSetStatus("aviso", "Não existem dados para exportar.");
        return;
    }

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Devices Intune</title>
<style>
body { font-family: Segoe UI, Arial, sans-serif; padding: 24px; background: #f6f6f6; }
.di-device-card, .di-panel { background: white; border-radius: 14px; padding: 16px; margin-bottom: 14px; border: 1px solid #ddd; }
.di-device-header { display: flex; justify-content: space-between; border-bottom: 1px solid #eee; padding-bottom: 12px; margin-bottom: 12px; }
.di-details { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.di-field { background: #fafafa; border: 1px solid #eee; border-radius: 10px; padding: 10px; }
.di-field label { font-size: 11px; color: #777; font-weight: bold; text-transform: uppercase; display:block; }
.di-badge { display:inline-block; border-radius: 999px; padding: 5px 9px; background:#eee; margin:2px; font-size:12px; font-weight:bold; }
.di-badge-red { background:#ffe8ec; color:#b00020; }
.di-badge-green { background:#e8f8ef; color:#126b3a; }
.di-badge-dark { background:#222; color:white; }
.di-table { width:100%; border-collapse:collapse; font-size:12px; }
.di-table th { background:#222; color:white; padding:8px; text-align:left; }
.di-table td { border-bottom:1px solid #eee; padding:8px; }
</style>
</head>
<body>
<h2>Relatório Devices Intune</h2>
${conteudo}
</body>
</html>`;

    downloadTextFile("devices-intune.html", html, "text/html;charset=utf-8");
}

function csvEscape(value) {
    value = String(value ?? "");
    value = value.replace(/"/g, '""');
    return `"${value}"`;
}

function downloadTextFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

setTimeout(() => {
    if (document.getElementById("devicesIntuneStatus")) {
        devicesIntuneStatus();
    }
}, 800);



function devicesIntuneDetectDelimiter(line) {
    const semicolon = (line.match(/;/g) || []).length;
    const comma = (line.match(/,/g) || []).length;
    return semicolon >= comma ? ";" : ",";
}

function devicesIntuneParseCsvLine(line, delimiter) {
    const result = [];
    let current = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const next = line[i + 1];

        if (char === '"' && next === '"') {
            current += '"';
            i++;
        } else if (char === '"') {
            insideQuotes = !insideQuotes;
        } else if (char === delimiter && !insideQuotes) {
            result.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }

    result.push(current.trim());
    return result;
}

function devicesIntuneGetCsvPesquisaColumn(headers) {
    const preferred = [
        "pesquisa",
        "serialnumber",
        "serial",
        "devicename",
        "device",
        "upn",
        "user",
        "utilizador",
        "email",
        "imei",
        "azureaddeviceid",
        "intunedeviceid"
    ];

    const normalized = headers.map(h => String(h || "").trim().toLowerCase());

    for (const name of preferred) {
        const idx = normalized.indexOf(name);
        if (idx >= 0) return idx;
    }

    return 0;
}

async function devicesIntuneImportCsv() {
    const input = document.getElementById("devicesIntuneCsvFile");
    const file = input && input.files ? input.files[0] : null;

    if (!file) {
        devicesIntuneSetStatus("aviso", "Selecione um ficheiro CSV.");
        return;
    }

    try {
        if (typeof devicesIntuneProgress === "function") {
            devicesIntuneProgress(10, "A ler ficheiro CSV...");
        }

        const text = await file.text();

        const linhas = text
            .split(/\r?\n/)
            .map(x => x.trim())
            .filter(x => x.length > 0);

        if (linhas.length < 2) {
            devicesIntuneSetStatus("erro", "CSV sem dados para importar.");
            if (typeof devicesIntuneProgressHide === "function") devicesIntuneProgressHide(800);
            return;
        }

        const delimiter = devicesIntuneDetectDelimiter(linhas[0]);
        const headers = devicesIntuneParseCsvLine(linhas[0], delimiter);
        const pesquisaIndex = devicesIntuneGetCsvPesquisaColumn(headers);

        devicesIntuneCsvData = [];
        devicesIntuneCsvResultados = [];

        for (let i = 1; i < linhas.length; i++) {
            const cols = devicesIntuneParseCsvLine(linhas[i], delimiter);
            const valor = cols[pesquisaIndex];

            if (valor && valor.trim()) {
                devicesIntuneCsvData.push({
                    pesquisa: valor.trim(),
                    linha: i + 1,
                    raw: cols
                });
            }
        }

        if (typeof devicesIntuneProgress === "function") {
            devicesIntuneProgress(100, "CSV validado.");
        }
        if (typeof devicesIntuneProgressHide === "function") {
            devicesIntuneProgressHide(900);
        }

        const info = document.getElementById("devicesIntuneCsvInfo");
        if (info) {
            info.innerHTML = `
                <div class="di-alert di-alert-ok">
                    CSV carregado com sucesso.
                    <b>${devicesIntuneCsvData.length}</b> registo(s) encontrados.
                    <br>Coluna usada: <b>${escapeHtml(headers[pesquisaIndex] || "Primeira coluna")}</b>
                </div>
            `;
        }

        let preview = `
            <div class="di-table-wrap">
                <table class="di-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Pesquisa</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        devicesIntuneCsvData.slice(0, 20).forEach((item, index) => {
            preview += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${escapeHtml(item.pesquisa)}</td>
                </tr>
            `;
        });

        preview += `
                    </tbody>
                </table>
            </div>
        `;

        if (devicesIntuneCsvData.length > 20) {
            preview += `<p class="di-muted">A mostrar apenas os primeiros 20 registos.</p>`;
        }

        const previewEl = document.getElementById("devicesIntuneCsvPreview");
        if (previewEl) previewEl.innerHTML = preview;

        devicesIntuneSetStatus("ok", "CSV validado. Agora clique em Consultar Intune.");

    } catch (ex) {
        if (typeof devicesIntuneProgressHide === "function") devicesIntuneProgressHide(800);
        devicesIntuneSetStatus("erro", "Erro ao ler CSV: " + escapeHtml(ex.message));
    }
}

async function devicesIntunePesquisarCsv() {
    if (!devicesIntuneCsvData || devicesIntuneCsvData.length === 0) {
        devicesIntuneSetStatus("aviso", "Importe e valide um CSV primeiro.");
        return;
    }

    devicesIntuneCsvResultados = [];
    const encontrados = [];
    const naoEncontrados = [];

    const resumo = document.getElementById("devicesIntuneResumo");
    const resultado = document.getElementById("devicesIntuneResultado");
    if (resumo) resumo.innerHTML = "";
    if (resultado) resultado.innerHTML = "";

    devicesIntuneSetStatus("info", "A iniciar consulta em massa no Intune...");

    for (let i = 0; i < devicesIntuneCsvData.length; i++) {
        const item = devicesIntuneCsvData[i];
        const pct = Math.round(((i + 1) / devicesIntuneCsvData.length) * 100);

        if (typeof devicesIntuneProgress === "function") {
            devicesIntuneProgress(
                pct,
                `A consultar ${i + 1}/${devicesIntuneCsvData.length}: ${item.pesquisa}`
            );
        }

        try {
            const json = await devicesIntuneApi(
                "/module/devices-intune/api?action=search&query=" + encodeURIComponent(item.pesquisa)
            );

            if (json.success && json.devices && json.devices.length > 0) {
                json.devices.forEach(d => {
                    d.csvPesquisa = item.pesquisa;
                    d.csvLinha = item.linha;
                    encontrados.push(d);
                    devicesIntuneCsvResultados.push(d);
                });
            } else {
                naoEncontrados.push({
                    csvPesquisa: item.pesquisa,
                    csvLinha: item.linha,
                    deviceName: "Não encontrado",
                    userDisplayName: "",
                    userPrincipalName: "",
                    emailAddress: "",
                    operatingSystem: "",
                    osVersion: "",
                    complianceState: "",
                    serialNumber: "",
                    imei: "",
                    lastSyncDateTime: "",
                    diasSemSync: "",
                    azureADDeviceId: "",
                    id: ""
                });
            }
        } catch (ex) {
            naoEncontrados.push({
                csvPesquisa: item.pesquisa,
                csvLinha: item.linha,
                deviceName: "Erro na consulta",
                erro: ex.message,
                userDisplayName: "",
                userPrincipalName: "",
                emailAddress: "",
                operatingSystem: "",
                osVersion: "",
                complianceState: "",
                serialNumber: "",
                imei: "",
                lastSyncDateTime: "",
                diasSemSync: "",
                azureADDeviceId: "",
                id: ""
            });
        }
    }

    const todos = encontrados.concat(naoEncontrados);

    devicesIntuneUltimoResultado = {
        success: true,
        message: "Consulta CSV concluída.",
        query: "CSV",
        total: todos.length,
        totalCsv: devicesIntuneCsvData.length,
        encontrados: encontrados.length,
        naoEncontrados: naoEncontrados.length,
        devices: todos
    };

    if (typeof devicesIntuneRenderBulk === "function") {
        devicesIntuneRenderBulk(devicesIntuneUltimoResultado);
    } else {
        devicesIntuneRender(devicesIntuneUltimoResultado);
    }

    if (typeof devicesIntuneProgress === "function") {
        devicesIntuneProgress(100, "Consulta em massa concluída.");
    }
    if (typeof devicesIntuneProgressHide === "function") {
        devicesIntuneProgressHide(1200);
    }

    devicesIntuneSetStatus(
        "ok",
        `Consulta CSV concluída. Encontrados: ${encontrados.length}. Não encontrados: ${naoEncontrados.length}.`
    );
}

function devicesIntuneRenderBulk(json) {
    const devices = json.devices || [];

    const totalCsv = json.totalCsv || devices.length;
    const encontrados = json.encontrados || 0;
    const naoEncontrados = json.naoEncontrados || 0;
    const compliant = devices.filter(d => devicesIntuneNormalize(d.complianceState).toLowerCase().includes("compliant") && !devicesIntuneNormalize(d.complianceState).toLowerCase().includes("non")).length;
    const nonCompliant = devices.filter(d => devicesIntuneNormalize(d.complianceState).toLowerCase().includes("non")).length;

    document.getElementById("devicesIntuneResumo").innerHTML = `
        <div class="di-kpis">
            <div class="di-kpi"><span>Total CSV</span><strong>${totalCsv}</strong></div>
            <div class="di-kpi"><span>Encontrados</span><strong>${encontrados}</strong></div>
            <div class="di-kpi"><span>Não encontrados</span><strong>${naoEncontrados}</strong></div>
            <div class="di-kpi"><span>Compliant</span><strong>${compliant}</strong></div>
            <div class="di-kpi"><span>Non compliant</span><strong>${nonCompliant}</strong></div>
        </div>
    `;

    let table = `
        <div class="di-panel">
            <h3>Resultado da Importação CSV</h3>
            <div class="di-table-wrap">
                <table class="di-table">
                    <thead>
                        <tr>
                            <th>Linha CSV</th>
                            <th>Pesquisa</th>
                            <th>Status</th>
                            <th>Utilizador</th>
                            <th>UPN</th>
                            <th>Device</th>
                            <th>SO</th>
                            <th>Versão</th>
                            <th>Compliance</th>
                            <th>Serial</th>
                            <th>Último Sync</th>
                            <th>Dias</th>
                            <th>Azure Device ID</th>
                            <th>Intune Device ID</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    devices.forEach(d => {
        const found = devicesIntuneNormalize(d.deviceName) !== "Não encontrado" &&
                      devicesIntuneNormalize(d.deviceName) !== "Erro na consulta";

        const status = found
            ? `<span class="di-badge di-badge-green">Encontrado</span>`
            : `<span class="di-badge di-badge-red">${escapeHtml(devicesIntuneNormalize(d.deviceName))}</span>`;

        table += `
            <tr>
                <td>${escapeHtml(devicesIntuneNormalize(d.csvLinha))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.csvPesquisa))}</td>
                <td>${status}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.userDisplayName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.userPrincipalName))}</td>
                <td>${found ? escapeHtml(devicesIntuneNormalize(d.deviceName)) : ""}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.operatingSystem))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.osVersion))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.complianceState)) || "Sem estado"}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.serialNumber))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.lastSyncDateTime))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.diasSemSync))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.azureADDeviceId))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.id))}</td>
            </tr>
        `;
    });

    table += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.getElementById("devicesIntuneResultado").innerHTML = table;
}

function devicesIntuneLimparCsv() {
    devicesIntuneCsvData = [];
    devicesIntuneCsvResultados = [];

    const file = document.getElementById("devicesIntuneCsvFile");
    if (file) file.value = "";

    const info = document.getElementById("devicesIntuneCsvInfo");
    if (info) info.innerHTML = "";

    const preview = document.getElementById("devicesIntuneCsvPreview");
    if (preview) preview.innerHTML = "";

    devicesIntuneSetStatus("ok", "Dados CSV limpos.");
}



function devicesIntuneComplianceKey(value) {
    const v = devicesIntuneNormalize(value).toLowerCase();

    if (!v) return "semestado";
    if (v.includes("non")) return "noncompliant";
    if (v.includes("compliant")) return "compliant";

    return "semestado";
}

function devicesIntuneOsKey(value) {
    const v = devicesIntuneNormalize(value).toLowerCase();

    if (v.includes("android")) return "android";
    if (v.includes("windows")) return "windows";
    if (v.includes("mac")) return "macos";
    if (v.includes("ios") || v.includes("iphone") || v.includes("ipad")) return "ios";

    return "";
}

function devicesIntuneMostrarFiltros(devices) {
    devicesIntuneResultadoAtual = devices || [];
    devicesIntuneResultadoFiltrado = devices || [];

    const panel = document.getElementById("devicesIntuneFiltrosPanel");
    if (panel) panel.style.display = devicesIntuneResultadoAtual.length ? "block" : "none";

    devicesIntuneAtualizarSelecionadosInfo();
}

function devicesIntuneAtualizarSelecionadosInfo() {
    const el = document.getElementById("devicesIntuneSelecionadosInfo");
    if (el) {
        el.innerHTML = `<b>${devicesIntuneSelecionados.size}</b> device(s) selecionado(s)`;
    }
}

function devicesIntuneToggleSelecionado(id, checked) {
    if (!id) return;

    if (checked) {
        devicesIntuneSelecionados.add(id);
    } else {
        devicesIntuneSelecionados.delete(id);
    }

    devicesIntuneAtualizarSelecionadosInfo();
}

function devicesIntuneIsDeviceValido(d) {
    const id = devicesIntuneNormalize(d.id);
    const name = devicesIntuneNormalize(d.deviceName);

    if (!id) return false;
    if (name === "Não encontrado") return false;
    if (name === "Erro na consulta") return false;

    return true;
}

function devicesIntuneAplicarFiltros() {
    if (!devicesIntuneResultadoAtual || !devicesIntuneResultadoAtual.length) {
        devicesIntuneSetStatus("aviso", "Não existem dados para filtrar.");
        return;
    }

    const filtroCompliance = devicesIntuneGetComplianceFiltrosSelecionados();
    const filtroSO = document.getElementById("devicesIntuneFiltroSO")?.value || "";
    const filtroTipoEquipamento = document.getElementById("devicesIntuneFiltroTipoEquipamento")?.value || "";
    const filtroSync = document.getElementById("devicesIntuneFiltroSync")?.value || "";

    devicesIntuneResultadoFiltrado = devicesIntuneResultadoAtual.filter(d => {
        const comp = devicesIntuneComplianceKey(d.complianceState);
        const so = devicesIntuneOsKey(d.operatingSystem);
        const tipoEquipamento = devicesIntuneTipoEquipamentoKey(d);
        const dias = Number(d.diasSemSync || 0);

        if (filtroCompliance.length && !filtroCompliance.includes(comp)) return false;
        if (filtroTipoEquipamento && tipoEquipamento !== filtroTipoEquipamento) return false;
        if (filtroSO && so !== filtroSO) return false;
        if (filtroSync && dias <= Number(filtroSync)) return false;

        return true;
    });

    devicesIntuneRenderListaFiltrada(devicesIntuneResultadoFiltrado);

    devicesIntuneSetStatus(
        "ok",
        `Filtro aplicado. ${devicesIntuneResultadoFiltrado.length} device(s) visível(eis).`
    );
}

function devicesIntuneLimparFiltros() {
    const c = document.querySelectorAll(".di-filter-compliance");
    const tipo = document.getElementById("devicesIntuneFiltroTipoEquipamento");
    const so = document.getElementById("devicesIntuneFiltroSO");
    const sync = document.getElementById("devicesIntuneFiltroSync");

    if (c) c.forEach(chk => chk.checked = true);
    if (tipo) tipo.value = "";
    if (so) so.value = "";
    if (sync) sync.value = "";

    devicesIntuneResultadoFiltrado = devicesIntuneResultadoAtual || [];
    devicesIntuneRenderListaFiltrada(devicesIntuneResultadoFiltrado);
    devicesIntuneSetStatus("ok", "Filtros limpos.");
}

function devicesIntuneSelecionarFiltrados() {
    const lista = devicesIntuneResultadoFiltrado && devicesIntuneResultadoFiltrado.length
        ? devicesIntuneResultadoFiltrado
        : devicesIntuneResultadoAtual;

    lista.forEach(d => {
        if (devicesIntuneIsDeviceValido(d)) {
            devicesIntuneSelecionados.add(devicesIntuneNormalize(d.id));
        }
    });

    document.querySelectorAll(".di-device-check").forEach(chk => {
        chk.checked = devicesIntuneSelecionados.has(chk.value);
    });

    devicesIntuneAtualizarSelecionadosInfo();
    devicesIntuneSetStatus("ok", `${devicesIntuneSelecionados.size} device(s) selecionado(s).`);
}

function devicesIntuneLimparSelecao() {
    devicesIntuneSelecionados.clear();

    document.querySelectorAll(".di-device-check").forEach(chk => {
        chk.checked = false;
    });

    devicesIntuneAtualizarSelecionadosInfo();
    devicesIntuneSetStatus("ok", "Seleção limpa.");
}

function devicesIntuneRenderListaFiltrada(devices) {
    if (!devicesIntuneUltimoResultado) return;

    const temp = {
        ...devicesIntuneUltimoResultado,
        devices: devices,
        total: devices.length
    };

    if (devicesIntuneUltimoResultado.query === "CSV" || devicesIntuneUltimoResultado.totalCsv) {
        devicesIntuneRenderBulkComSelecao(temp);
    } else {
        devicesIntuneRenderComSelecao(temp);
    }
}

function devicesIntuneRenderComSelecao(json) {
    const devices = json.devices || [];

    const total = devices.length;
    const compliant = devices.filter(d => devicesIntuneComplianceKey(d.complianceState) === "compliant").length;
    const nonCompliant = devices.filter(d => devicesIntuneComplianceKey(d.complianceState) === "noncompliant").length;
    const encrypted = devices.filter(d => String(d.isEncrypted).toLowerCase() === "true").length;
    const semSync30 = devices.filter(d => Number(d.diasSemSync || 0) > 30).length;

    document.getElementById("devicesIntuneResumo").innerHTML = `
        <div class="di-kpis">
            <div class="di-kpi"><span>Total visível</span><strong>${total}</strong></div>
            <div class="di-kpi"><span>Compliant</span><strong>${compliant}</strong></div>
            <div class="di-kpi"><span>Non compliant</span><strong>${nonCompliant}</strong></div>
            <div class="di-kpi"><span>Encrypted</span><strong>${encrypted}</strong></div>
            <div class="di-kpi"><span>Sem sync > 30d</span><strong>${semSync30}</strong></div>
        </div>
    `;

    let html = `
        <div class="di-panel">
            <h3>Resultado</h3>
            <div class="di-table-wrap">
                <table class="di-table">
                    <thead>
                        <tr>
                            <th>Selecionar</th>
                            <th>Utilizador</th>
                            <th>UPN</th>
                            <th>Device</th>
                            <th>SO</th>
                            <th>Versão</th>
                            <th>Compliance</th>
                            <th>Serial</th>
                            <th>Último Sync</th>
                            <th>Dias</th>
                            <th>Intune Device ID</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    devices.forEach(d => {
        const id = devicesIntuneNormalize(d.id);
        const disabled = devicesIntuneIsDeviceValido(d) ? "" : "disabled";
        const checked = devicesIntuneSelecionados.has(id) ? "checked" : "";

        html += `
            <tr>
                <td><input class="di-device-check" type="checkbox" value="${escapeHtml(id)}" ${checked} ${disabled} onchange="devicesIntuneToggleSelecionado(this.value, this.checked)"></td>
                <td>${escapeHtml(devicesIntuneNormalize(d.userDisplayName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.userPrincipalName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.deviceName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.operatingSystem))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.osVersion))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.complianceState)) || "Sem estado"}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.serialNumber))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.lastSyncDateTime))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.diasSemSync))}</td>
                <td>${escapeHtml(id)}</td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.getElementById("devicesIntuneResultado").innerHTML = html;
    devicesIntuneAtualizarSelecionadosInfo();
}

function devicesIntuneRenderBulkComSelecao(json) {
    const devices = json.devices || [];

    const stats = devicesIntuneCsvStats(devices);

    const compliant = devices.filter(d => devicesIntuneComplianceKey(d.complianceState) === "compliant").length;
    const nonCompliant = devices.filter(d => devicesIntuneComplianceKey(d.complianceState) === "noncompliant").length;
    const android = devices.filter(d => devicesIntuneOsKey(d.operatingSystem) === "android").length;
    const windows = devices.filter(d => devicesIntuneOsKey(d.operatingSystem) === "windows").length;
    const ios = devices.filter(d => devicesIntuneOsKey(d.operatingSystem) === "ios").length;
    const macos = devices.filter(d => devicesIntuneOsKey(d.operatingSystem) === "macos").length;
    const semSync30 = devices.filter(d => Number(d.diasSemSync || 0) > 30).length;

    document.getElementById("devicesIntuneResumo").innerHTML = `
        <div class="di-kpis">
            <div class="di-kpi"><span>Pesquisas CSV</span><strong>${stats.pesquisasCsv}</strong></div>
            <div class="di-kpi"><span>Com device</span><strong>${stats.pesquisasComDevice}</strong></div>
            <div class="di-kpi"><span>Sem device</span><strong>${stats.pesquisasSemDevice}</strong></div>
            <div class="di-kpi"><span>Devices encontrados</span><strong>${stats.devicesEncontrados}</strong></div>
            <div class="di-kpi"><span>Selecionados</span><strong>${devicesIntuneSelecionados.size}</strong></div>
            <div class="di-kpi"><span>Compliant</span><strong>${compliant}</strong></div>
            <div class="di-kpi"><span>Non compliant</span><strong>${nonCompliant}</strong></div>
            <div class="di-kpi"><span>Android</span><strong>${android}</strong></div>
            <div class="di-kpi"><span>Windows</span><strong>${windows}</strong></div>
            <div class="di-kpi"><span>iOS/iPadOS</span><strong>${ios}</strong></div>
            <div class="di-kpi"><span>macOS</span><strong>${macos}</strong></div>
            <div class="di-kpi"><span>Sem sync > 30d</span><strong>${semSync30}</strong></div>
        </div>
    `;

    let html = `
        <div class="di-panel">
            <h3>Resultado da Importação CSV</h3>
            <div class="di-table-wrap">
                <table class="di-table">
                    <thead>
                        <tr>
                            <th>Selecionar</th>
                            <th>Linha CSV</th>
                            <th>Pesquisa</th>
                            <th>Status</th>
                            <th>Utilizador</th>
                            <th>UPN</th>
                            <th>Device</th>
                            <th>SO</th>
                            <th>Compliance</th>
                            <th>Serial</th>
                            <th>Último Sync</th>
                            <th>Dias</th>
                            <th>Intune Device ID</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    devices.forEach(d => {
        const id = devicesIntuneNormalize(d.id);
        const valid = devicesIntuneIsDeviceValido(d);
        const checked = devicesIntuneSelecionados.has(id) ? "checked" : "";

        const status = valid
            ? `<span class="di-badge di-badge-green">Encontrado</span>`
            : `<span class="di-badge di-badge-red">${escapeHtml(devicesIntuneNormalize(d.deviceName) || "Não encontrado")}</span>`;

        const complianceText = devicesIntuneNormalize(d.complianceState) || "Sem estado";

        html += `
            <tr>
                <td><input class="di-device-check" type="checkbox" value="${escapeHtml(id)}" ${checked} ${valid ? "" : "disabled"} onchange="devicesIntuneToggleSelecionado(this.value, this.checked)"></td>
                <td>${escapeHtml(devicesIntuneNormalize(d.csvLinha))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.csvPesquisa))}</td>
                <td>${status}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.userDisplayName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.userPrincipalName))}</td>
                <td>${valid ? escapeHtml(devicesIntuneNormalize(d.deviceName)) : ""}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.operatingSystem))}</td>
                <td>${escapeHtml(complianceText)}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.serialNumber))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.lastSyncDateTime))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.diasSemSync))}</td>
                <td>${escapeHtml(id)}</td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.getElementById("devicesIntuneResultado").innerHTML = html;
    devicesIntuneAtualizarSelecionadosInfo();
}

function devicesIntunePrepararExclusaoSelecionados() {
    if (!devicesIntuneSelecionados.size) {
        devicesIntuneSetStatus("aviso", "Selecione pelo menos um device.");
        return;
    }

    const base = devicesIntuneResultadoAtual || [];
    const selecionados = base.filter(d => devicesIntuneSelecionados.has(devicesIntuneNormalize(d.id)));

    let html = `
        <div class="di-panel">
            <h3>🧾 Devices preparados para futura exclusão</h3>
            <div class="di-alert di-alert-aviso">
                Nenhuma ação foi executada. Esta lista apenas prepara a próxima fase:
                Delete, Retire ou Wipe com controlo de aprovação dupla no Intune.
            </div>

            <div class="di-table-wrap">
                <table class="di-table">
                    <thead>
                        <tr>
                            <th>Device</th>
                            <th>Utilizador</th>
                            <th>UPN</th>
                            <th>Compliance</th>
                            <th>Serial</th>
                            <th>Intune Device ID</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    selecionados.forEach(d => {
        html += `
            <tr>
                <td>${escapeHtml(devicesIntuneNormalize(d.deviceName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.userDisplayName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.userPrincipalName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.complianceState)) || "Sem estado"}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.serialNumber))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.id))}</td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.getElementById("devicesIntuneResultado").insertAdjacentHTML("afterbegin", html);

    devicesIntuneSetStatus(
        "aviso",
        `${selecionados.length} device(s) preparado(s). A exclusão real será adicionada depois com aprovação dupla.`
    );
}

const devicesIntuneOriginalRender = devicesIntuneRender;
devicesIntuneRender = function(json) {
    devicesIntuneUltimoResultado = json;
    devicesIntuneMostrarFiltros(json.devices || []);
    devicesIntuneRenderComSelecao(json);
};

if (typeof devicesIntuneRenderBulk === "function") {
    const devicesIntuneOriginalRenderBulk = devicesIntuneRenderBulk;
    devicesIntuneRenderBulk = function(json) {
        devicesIntuneUltimoResultado = json;
        devicesIntuneMostrarFiltros(json.devices || []);
        devicesIntuneRenderBulkComSelecao(json);
    };
}



function devicesIntuneCsvStats(devices) {
    const pesquisas = new Set();
    const pesquisasEncontradas = new Set();

    devices.forEach(d => {
        const pesquisa = devicesIntuneNormalize(d.csvPesquisa);
        if (pesquisa) pesquisas.add(pesquisa);

        if (devicesIntuneIsDeviceValido(d) && pesquisa) {
            pesquisasEncontradas.add(pesquisa);
        }
    });

    return {
        pesquisasCsv: pesquisas.size,
        pesquisasComDevice: pesquisasEncontradas.size,
        pesquisasSemDevice: Math.max(0, pesquisas.size - pesquisasEncontradas.size),
        devicesEncontrados: devices.filter(d => devicesIntuneIsDeviceValido(d)).length
    };
}



function devicesIntuneTipoEquipamentoKey(d) {
    const so = devicesIntuneNormalize(d.operatingSystem).toLowerCase();
    const model = devicesIntuneNormalize(d.model).toLowerCase();
    const name = devicesIntuneNormalize(d.deviceName).toLowerCase();

    if (so.includes("windows")) return "windows";
    if (so.includes("mac")) return "macos";

    if (
        so.includes("android") ||
        so.includes("ios") ||
        so.includes("ipad") ||
        so.includes("iphone") ||
        model.includes("ipad") ||
        model.includes("iphone") ||
        name.includes("androidforwork")
    ) {
        return "mobile";
    }

    return "";
}




function devicesIntuneGetComplianceFiltrosSelecionados() {
    const checks = document.querySelectorAll(".di-filter-compliance");
    const selected = [];

    checks.forEach(chk => {
        if (chk.checked) selected.push(chk.value);
    });

    return selected;
}

function devicesIntuneMarcarComplianceProblemas() {
    document.querySelectorAll(".di-filter-compliance").forEach(chk => {
        chk.checked = chk.value !== "compliant";
    });

    devicesIntuneAplicarFiltros();
}

function devicesIntuneMarcarComplianceTodos() {
    document.querySelectorAll(".di-filter-compliance").forEach(chk => {
        chk.checked = true;
    });

    devicesIntuneAplicarFiltros();
}



async function devicesIntuneSolicitarDeleteSelecionados() {
    if (!devicesIntuneSelecionados || devicesIntuneSelecionados.size === 0) {
        devicesIntuneSetStatus("aviso", "Selecione pelo menos um device para apagar.");
        return;
    }

    const total = devicesIntuneSelecionados.size;

    const confirmar = confirm(
        "Confirma que pretende enviar pedido de exclusão para " + total + " device(s)?\n\n" +
        "Atenção: no Intune Santander este pedido pode exigir aprovação de 2 pessoas."
    );

    if (!confirmar) {
        devicesIntuneSetStatus("aviso", "Exclusão cancelada pelo utilizador.");
        return;
    }

    let justification = prompt(
        "Informe a justificação para o pedido de exclusão:",
        "Device non compliant / sem utilização / pedido validado pelo suporte."
    );

    if (!justification || !justification.trim()) {
        devicesIntuneSetStatus("aviso", "Pedido cancelado. Justificação obrigatória.");
        return;
    }

    const ids = Array.from(devicesIntuneSelecionados);

    devicesIntuneProgress(20, "A enviar pedido de exclusão ao Intune...");
    devicesIntuneSetStatus("info", "A processar exclusão dos devices selecionados...");

    try {
        const json = await devicesIntuneApi(
            "/module/devices-intune/api?action=requestDeleteDevices",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids, justification })
            }
        );

        devicesIntuneProgress(100, "Pedido processado.");
        devicesIntuneProgressHide(1200);

        if (!json.success) {
            devicesIntuneSetStatus("erro", escapeHtml(json.message || "Erro ao apagar devices."));
            return;
        }

        devicesIntuneMaaTrackSelecionados("Delete", justification, json.results || []);

        let html = `
            <div class="di-panel">
                <h3>Resultado do pedido de exclusão</h3>
                <div class="di-alert di-alert-aviso">
                    Quando existir aprovação dupla no Intune, o estado pode ficar como
                    <b>Aguardando aprovação / Pedido pendente</b>.
                </div>
                <div class="di-table-wrap">
                    <table class="di-table">
                        <thead>
                            <tr>
                                <th>Device ID</th>
                                <th>Status</th>
                                <th>Mensagem</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        (json.results || []).forEach(r => {
            const badge = r.success
                ? `<span class="di-badge di-badge-green">${escapeHtml(r.status)}</span>`
                : `<span class="di-badge di-badge-red">${escapeHtml(r.status)}</span>`;

            html += `
                <tr>
                    <td>${escapeHtml(r.id)}</td>
                    <td>${badge}</td>
                    <td>${escapeHtml(r.message)}</td>
                </tr>
            `;
        });

        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        document.getElementById("devicesIntuneResultado").insertAdjacentHTML("afterbegin", html);

        devicesIntuneSetStatus(
            "ok",
            "Pedido de exclusão enviado/processado para " + total + " device(s)."
        );

    } catch (ex) {
        devicesIntuneProgressHide(1200);
        devicesIntuneSetStatus("erro", "Erro ao enviar pedido de exclusão: " + escapeHtml(ex.message));
    }
}



function devicesIntuneGetSelecionadosObjetos() {
    const base = devicesIntuneResultadoAtual || [];
    return base.filter(d => devicesIntuneSelecionados.has(devicesIntuneNormalize(d.id)));
}

function devicesIntuneAvaliarElegibilidade(d) {
    const compliance = devicesIntuneNormalize(d.complianceState).toLowerCase();
    const dias = Number(d.diasSemSync || 0);
    const owner = devicesIntuneNormalize(d.managedDeviceOwnerType).toLowerCase();
    const so = devicesIntuneNormalize(d.operatingSystem);

    let motivos = [];
    let elegivel = false;

    if (compliance.includes("non")) {
        elegivel = true;
        motivos.push("Non compliant");
    }

    if (dias > 30) {
        elegivel = true;
        motivos.push("Sem sync > 30 dias");
    }

    if (owner.includes("personal")) {
        motivos.push("Device pessoal");
    }

    if (!motivos.length) {
        motivos.push("Sem critério crítico identificado");
    }

    return {
        elegivel: elegivel,
        tipo: so,
        motivo: motivos.join(" | "),
        recomendacao: elegivel ? "Elegível para pedido de aprovação" : "Rever antes de solicitar exclusão"
    };
}

function devicesIntuneValidarSelecionados() {
    const selecionados = devicesIntuneGetSelecionadosObjetos();

    if (!selecionados.length) {
        devicesIntuneSetStatus("aviso", "Selecione pelo menos um device.");
        return;
    }

    let elegiveis = 0;

    let html = `
        <div class="di-panel">
            <h3>✅ Validação dos devices selecionados</h3>
            <div class="di-alert di-alert-aviso">
                Nenhuma ação foi enviada ao Intune. Esta validação apenas prepara o pedido para aprovação dupla.
            </div>

            <div class="di-table-wrap">
                <table class="di-table">
                    <thead>
                        <tr>
                            <th>Device</th>
                            <th>Utilizador</th>
                            <th>UPN</th>
                            <th>SO</th>
                            <th>Compliance</th>
                            <th>Owner</th>
                            <th>Dias sem Sync</th>
                            <th>Motivo</th>
                            <th>Recomendação</th>
                            <th>Intune Device ID</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    selecionados.forEach(d => {
        const avaliacao = devicesIntuneAvaliarElegibilidade(d);
        if (avaliacao.elegivel) elegiveis++;

        const badge = avaliacao.elegivel
            ? `<span class="di-badge di-badge-red">Elegível</span>`
            : `<span class="di-badge">Rever</span>`;

        html += `
            <tr>
                <td>${escapeHtml(devicesIntuneNormalize(d.deviceName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.userDisplayName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.userPrincipalName))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.operatingSystem))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.complianceState))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.managedDeviceOwnerType))}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.diasSemSync))}</td>
                <td>${escapeHtml(avaliacao.motivo)}</td>
                <td>${badge} ${escapeHtml(avaliacao.recomendacao)}</td>
                <td>${escapeHtml(devicesIntuneNormalize(d.id))}</td>
            </tr>
        `;
    });

    html += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.getElementById("devicesIntuneResultado").insertAdjacentHTML("afterbegin", html);

    devicesIntuneSetStatus(
        "ok",
        `Validação concluída. Selecionados: ${selecionados.length}. Elegíveis para aprovação: ${elegiveis}.`
    );
}

function devicesIntuneExportarSelecionadosCsv() {
    const selecionados = devicesIntuneGetSelecionadosObjetos();

    if (!selecionados.length) {
        devicesIntuneSetStatus("aviso", "Selecione pelo menos um device para exportar.");
        return;
    }

    const headers = [
        "DeviceName",
        "UserDisplayName",
        "UPN",
        "Email",
        "OperatingSystem",
        "Compliance",
        "OwnerType",
        "LastSyncDateTime",
        "DiasSemSync",
        "Motivo",
        "Recomendacao",
        "SerialNumber",
        "AzureADDeviceId",
        "IntuneDeviceId"
    ];

    let csv = headers.join(";") + "\n";

    selecionados.forEach(d => {
        const avaliacao = devicesIntuneAvaliarElegibilidade(d);

        const row = [
            d.deviceName,
            d.userDisplayName,
            d.userPrincipalName,
            d.emailAddress,
            d.operatingSystem,
            d.complianceState,
            d.managedDeviceOwnerType,
            d.lastSyncDateTime,
            d.diasSemSync,
            avaliacao.motivo,
            avaliacao.recomendacao,
            d.serialNumber,
            d.azureADDeviceId,
            d.id
        ];

        csv += row.map(v => csvEscape(devicesIntuneNormalize(v))).join(";") + "\n";
    });

    downloadTextFile("devices-intune-selecionados-aprovacao.csv", csv, "text/csv;charset=utf-8");
    devicesIntuneSetStatus("ok", "CSV dos selecionados exportado.");
}

function devicesIntuneGerarPedidoAprovacao() {
    const selecionados = devicesIntuneGetSelecionadosObjetos();

    if (!selecionados.length) {
        devicesIntuneSetStatus("aviso", "Selecione pelo menos um device.");
        return;
    }

    let texto = "Pedido de aprovação para ação Intune\n\n";
    texto += "Ação pretendida: Delete / Retire / Wipe\n";
    texto += "Justificação: Device non compliant / sem utilização / validado pelo suporte\n\n";
    texto += "Devices selecionados:\n\n";

    selecionados.forEach((d, idx) => {
        const avaliacao = devicesIntuneAvaliarElegibilidade(d);

        texto += `${idx + 1}. ${devicesIntuneNormalize(d.deviceName)}\n`;
        texto += `   Utilizador: ${devicesIntuneNormalize(d.userDisplayName)}\n`;
        texto += `   UPN: ${devicesIntuneNormalize(d.userPrincipalName)}\n`;
        texto += `   SO: ${devicesIntuneNormalize(d.operatingSystem)}\n`;
        texto += `   Compliance: ${devicesIntuneNormalize(d.complianceState)}\n`;
        texto += `   Owner: ${devicesIntuneNormalize(d.managedDeviceOwnerType)}\n`;
        texto += `   Dias sem sync: ${devicesIntuneNormalize(d.diasSemSync)}\n`;
        texto += `   Motivo: ${avaliacao.motivo}\n`;
        texto += `   Intune Device ID: ${devicesIntuneNormalize(d.id)}\n\n`;
    });

    navigator.clipboard.writeText(texto).catch(() => {});

    let html = `
        <div class="di-panel">
            <h3>🧾 Pedido de aprovação gerado</h3>
            <div class="di-alert di-alert-ok">
                O pedido foi preparado e copiado para a área de transferência.
                Ainda não foi enviada nenhuma ação ao Intune.
            </div>
            <pre style="white-space:pre-wrap;background:#111;color:#fff;padding:14px;border-radius:12px;">${escapeHtml(texto)}</pre>
        </div>
    `;document.getElementById("devicesIntuneResultado").insertAdjacentHTML("afterbegin", html);
    devicesIntuneSetStatus("ok", "Pedido de aprovação preparado.");
    setTimeout(() => {
        devicesIntuneCriarPedidoAprovacaoLocal();
    }, 300);
}



async function devicesIntuneCriarPedidoAprovacaoLocal() {
    const selecionados = devicesIntuneGetSelecionadosObjetos();

    if (!selecionados.length) {
        devicesIntuneSetStatus("aviso", "Selecione pelo menos um device.");
        return;
    }

    const actionType = prompt("Ação pretendida:", "Delete");
    if (!actionType) return;

    const justification = prompt(
        "Justificação para aprovação:",
        "Device non compliant / sem utilização / validado pelo suporte."
    );

    if (!justification || !justification.trim()) {
        devicesIntuneSetStatus("aviso", "Justificação obrigatória.");
        return;
    }

    const devices = selecionados.map(d => {
        const avaliacao = devicesIntuneAvaliarElegibilidade(d);

        return {
            id: devicesIntuneNormalize(d.id),
            deviceName: devicesIntuneNormalize(d.deviceName),
            userDisplayName: devicesIntuneNormalize(d.userDisplayName),
            userPrincipalName: devicesIntuneNormalize(d.userPrincipalName),
            operatingSystem: devicesIntuneNormalize(d.operatingSystem),
            complianceState: devicesIntuneNormalize(d.complianceState),
            ownerType: devicesIntuneNormalize(d.managedDeviceOwnerType),
            diasSemSync: devicesIntuneNormalize(d.diasSemSync),
            serialNumber: devicesIntuneNormalize(d.serialNumber),
            azureADDeviceId: devicesIntuneNormalize(d.azureADDeviceId),
            motivo: avaliacao.motivo,
            recomendacao: avaliacao.recomendacao
        };
    });

    try {
        devicesIntuneProgress(25, "A criar pedido de aprovação...");

        const json = await devicesIntuneApi(
            "/module/devices-intune/api?action=createApprovalRequest",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ actionType, justification, devices })
            }
        );

        devicesIntuneProgress(100, "Pedido criado.");
        devicesIntuneProgressHide(900);

        if (!json.success) {
            devicesIntuneSetStatus("erro", json.message || "Erro ao criar pedido.");
            return;
        }

        devicesIntuneSetStatus("ok", "Pedido criado: " + json.request.id);
        devicesIntuneCarregarPedidosAprovacao();

    } catch (ex) {
        devicesIntuneProgressHide(800);
        devicesIntuneSetStatus("erro", "Erro ao criar pedido: " + escapeHtml(ex.message));
    }
}

async function devicesIntuneCarregarPedidosAprovacao() {
    try {
        const json = await devicesIntuneApi("/module/devices-intune/api?action=listApprovalRequests");

        if (!json.success) {
            devicesIntuneSetStatus("erro", json.message || "Erro ao carregar pedidos.");
            return;
        }

        const requests = json.requests || [];
        const el = document.getElementById("devicesIntuneApprovalResultado");

        if (!el) return;

        if (!requests.length) {
            el.innerHTML = `<div class="di-alert di-alert-info">Nenhum pedido criado ainda.</div>`;
            return;
        }

        let html = `
            <div class="di-table-wrap">
                <table class="di-table">
                    <thead>
                        <tr>
                            <th>Pedido</th>
                            <th>Data</th>
                            <th>Criado por</th>
                            <th>Ação</th>
                            <th>Status</th>
                            <th>Devices</th>
                            <th>Justificação</th>
                            <th>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        requests.forEach(r => {
            html += `
                <tr>
                    <td>${escapeHtml(r.id)}</td>
                    <td>${escapeHtml(r.createdAt)}</td>
                    <td>${escapeHtml(r.createdBy)}</td>
                    <td>${escapeHtml(r.actionType)}</td>
                    <td><span class="di-badge ${r.status === "Aprovado" ? "di-badge-green" : "di-badge-red"}">${escapeHtml(r.status)}</span></td>
                    <td>${escapeHtml(r.devicesCount)}</td>
                    <td>${escapeHtml(r.justification)}</td>
                    <td>
                        <button class="di-btn di-btn-secondary" style="padding:7px 9px;" onclick="devicesIntuneVerPedido('${escapeHtml(r.id)}')">Ver</button>
                        <button class="di-btn di-btn-primary" style="padding:7px 9px;" onclick="devicesIntuneAprovarPedido('${escapeHtml(r.id)}')">Aprovar</button>
                        <button class="di-btn di-btn-secondary" style="padding:7px 9px;" onclick="devicesIntuneRejeitarPedido('${escapeHtml(r.id)}')">Rejeitar</button>
                    </td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;

        el.innerHTML = html;

    } catch (ex) {
        devicesIntuneSetStatus("erro", "Erro ao carregar pedidos: " + escapeHtml(ex.message));
    }
}

async function devicesIntuneAprovarPedido(id) {
    const comment = prompt("Comentário da aprovação:", "Aprovado.");
    if (comment === null) return;

    const json = await devicesIntuneApi(
        "/module/devices-intune/api?action=approveRequest",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId: id, decision: "approve", comment })
        }
    );

    devicesIntuneSetStatus(json.success ? "ok" : "erro", json.message);
    devicesIntuneCarregarPedidosAprovacao();
}

async function devicesIntuneRejeitarPedido(id) {
    const comment = prompt("Motivo da rejeição:", "Rejeitado.");
    if (comment === null) return;

    const json = await devicesIntuneApi(
        "/module/devices-intune/api?action=approveRequest",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId: id, decision: "reject", comment })
        }
    );

    devicesIntuneSetStatus(json.success ? "ok" : "erro", json.message);
    devicesIntuneCarregarPedidosAprovacao();
}

function devicesIntuneVerPedido(id) {
    devicesIntuneSetStatus("info", "Pedido selecionado: " + id + ". Detalhes completos ficam no JSON local.");
}



async function devicesIntuneEnviarDeleteIntuneSelecionados() {
    const selecionados = devicesIntuneGetSelecionadosObjetos();

    if (!selecionados.length) {
        devicesIntuneSetStatus("aviso", "Selecione pelo menos um device.");
        return;
    }

    const confirmacao = confirm(
        "Confirma o envio da solicitação de remoção para o Intune?\n\n" +
        "Quantidade: " + selecionados.length + " device(s)\n\n" +
        "A aprovação será tratada pelo MAA do próprio Intune."
    );

    if (!confirmacao) {
        devicesIntuneSetStatus("aviso", "Solicitação cancelada.");
        return;
    }

    const justification = prompt(
        "Justificação para o Intune MAA:",
        "Device non compliant / sem utilização / validado pelo suporte."
    );

    if (!justification || !justification.trim()) {
        devicesIntuneSetStatus("aviso", "Justificação obrigatória.");
        return;
    }

    const ids = selecionados.map(d => devicesIntuneNormalize(d.id)).filter(x => x);

    try {
        devicesIntuneProgress(20, "A enviar solicitação ao Intune...");
        devicesIntuneSetStatus("info", "A enviar solicitação de remoção ao Intune...");

        const json = await devicesIntuneApi(
            "/module/devices-intune/api?action=requestDeleteDevices",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids, justification })
            }
        );

        devicesIntuneProgress(100, "Solicitação processada.");
        devicesIntuneProgressHide(1000);

        if (!json.success) {
            devicesIntuneSetStatus("erro", json.message || "Erro ao enviar solicitação.");
            return;
        }

        devicesIntuneMaaTrackSelecionados("Delete", justification, json.results || []);

        let html = `
            <div class="di-panel">
                <h3>📨 Resultado da solicitação Intune</h3>
                <div class="di-alert di-alert-aviso">
                    A aprovação, quando exigida, será apresentada no portal Intune em Multi Admin Approval.
                </div>
                <div class="di-table-wrap">
                    <table class="di-table">
                        <thead>
                            <tr>
                                <th>Device ID</th>
                                <th>Status</th>
                                <th>Mensagem</th>
                            </tr>
                        </thead>
                        <tbody>
        `;

        (json.results || []).forEach(r => {
            const ok = r.success;
            html += `
                <tr>
                    <td>${escapeHtml(r.id)}</td>
                    <td>
                        <span class="di-badge ${ok ? "di-badge-green" : "di-badge-red"}">
                            ${escapeHtml(r.status)}
                        </span>
                    </td>
                    <td>${escapeHtml(r.message)}</td>
                </tr>
            `;
        });

        html += `
                        </tbody>
                    </table>
                </div>
            </div>
        `;

        document.getElementById("devicesIntuneResultado").insertAdjacentHTML("afterbegin", html);
        devicesIntuneSetStatus("ok", "Solicitação enviada/processada pelo Intune.");

    } catch (ex) {
        devicesIntuneProgressHide(1000);
        devicesIntuneSetStatus("erro", "Erro ao enviar solicitação: " + escapeHtml(ex.message));
    }
}



const devicesIntuneMaaStorageKey = "devicesIntuneMaaRequests";
const devicesIntuneMaaUsersStorageKey = "devicesIntuneMaaUsers";
const devicesIntuneMaaSeenStorageKey = "devicesIntuneMaaSeenRequests";
const devicesIntuneServiceNowUrl = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7&sysparm_category=6f044c7c1b1945505ae05532604bcb04";
const devicesIntuneMaaDefaultUsers = [
    "au_86246723@santandernet.onmicrosoft.com",
    "au_81680372@santandernet.onmicrosoft.com"
];
let devicesIntuneMaaCheckRunning = false;
let devicesIntuneMaaRequestsById = new Map();

function devicesIntuneMaaLoadUsers() {
    try {
        const saved = JSON.parse(localStorage.getItem(devicesIntuneMaaUsersStorageKey) || "null");
        return Array.isArray(saved) && saved.length ? saved : [...devicesIntuneMaaDefaultUsers];
    } catch {
        return [...devicesIntuneMaaDefaultUsers];
    }
}

function devicesIntuneMaaNormalizeUsers(text) {
    return [...new Set(String(text || "").split(/[\n,;]+/).map(x => x.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

function devicesIntuneMaaSaveUsersFromInput() {
    const input = document.getElementById("devicesIntuneMaaUsers");
    const users = devicesIntuneMaaNormalizeUsers(input ? input.value : "");
    if (!users.length) {
        devicesIntuneSetStatus("aviso", "Informe pelo menos um UPN para monitorizar.");
        return;
    }
    localStorage.setItem(devicesIntuneMaaUsersStorageKey, JSON.stringify(users));
    if (input) input.value = users.join("\n");
    devicesIntuneSetStatus("ok", `${users.length} utilizador(es) guardado(s) para monitorização MAA.`);
    devicesIntuneMaaCheckNow();
}

function devicesIntuneMaaRenderUserRequests(json) {
    const el = document.getElementById("devicesIntuneMaaUserResultado");
    if (!el) return;
    const users = json.users || [];
    devicesIntuneMaaRequestsById = new Map();
    const trackedByRequest = new Map(
        devicesIntuneMaaLoad()
            .filter(item => item.maaRequestId)
            .map(item => [String(item.maaRequestId), item])
    );
    const total = Number(json.totalPending || 0);
    let html = `
        <div class="di-alert ${total ? "di-alert-aviso" : "di-alert-ok"}">
            <b>Consulta direta ao Intune:</b> ${total} solicitação(ões) MAA pendente(s).
            Última verificação: ${escapeHtml(new Date(json.checkedAt).toLocaleString())}
        </div>
        <div class="di-table-wrap"><table class="di-table"><thead><tr>
            <th>Utilizador</th><th>Estado</th><th>Pedido</th><th>Equipamento</th><th>Data</th><th>Tipo</th><th>Justificação</th><th>Ação</th>
        </tr></thead><tbody>`;

    users.forEach(user => {
        if (!user.found) {
            html += `<tr><td>${escapeHtml(user.requestedUpn)}</td><td><span class="di-badge di-badge-red">Não encontrado</span></td><td colspan="6">${escapeHtml(user.error || "Utilizador não encontrado no Entra ID.")}</td></tr>`;
            return;
        }
        if (!user.requests || !user.requests.length) {
            html += `<tr><td>${escapeHtml(user.userPrincipalName)}</td><td><span class="di-badge di-badge-green">Sem pendências</span></td><td colspan="6">Nenhum pedido needsApproval/approved.</td></tr>`;
            return;
        }
        user.requests.forEach(request => {
            const tracked = trackedByRequest.get(String(request.id));
            request.deviceId = tracked?.id || request.deviceId || "";
            request.deviceName = tracked?.deviceName || request.deviceName || "";
            request.deviceUser = tracked?.userDisplayName || tracked?.userPrincipalName || "";
            request.deviceOperatingSystem = tracked?.operatingSystem || "";
            devicesIntuneMaaRequestsById.set(request.id, { user, request });
            const equipmentDetails = [request.deviceUser, request.deviceOperatingSystem].filter(Boolean).join(" · ");
            html += `<tr>
                <td>${escapeHtml(user.userPrincipalName)}</td>
                <td><span class="di-badge di-badge-red">${escapeHtml(request.status)}</span></td>
                <td>${escapeHtml(request.id)}</td>
                <td><div id="maa-equipment-${escapeHtml(request.id)}" style="min-width:220px"><strong>${escapeHtml(request.deviceName || "Equipamento MAA")}</strong><br><code style="font-size:11px;word-break:break-all">${escapeHtml(request.deviceId || "Device ID ainda não localizado")}</code>${equipmentDetails ? `<br><small>${escapeHtml(equipmentDetails)}</small>` : ""}${!request.deviceId ? `<br><button class="di-btn di-btn-secondary" style="padding:5px 8px;margin-top:6px" onclick="devicesIntuneMaaResolveDevice('${escapeHtml(request.id)}')">Localizar equipamento</button>` : ""}</div></td>
                <td>${escapeHtml(new Date(request.requestDateTime).toLocaleString())}</td>
                <td>${escapeHtml((request.policyTypes || []).join(", "))}</td>
                <td>${escapeHtml(request.requestJustification)}</td>
                <td><div style="display:flex;gap:6px;flex-wrap:wrap;">
                    ${request.status === "needsApproval" ? `<button class="di-btn di-btn-primary" style="padding:7px 9px;" onclick="devicesIntuneMaaApprove('${escapeHtml(request.id)}')">Aprovar no Intune</button>` : `<button class="di-btn di-btn-primary" style="padding:7px 9px;" onclick="devicesIntuneMaaComplete('${escapeHtml(request.id)}')">Concluir remoção</button>`}
                    <button class="di-btn di-btn-secondary" style="padding:7px 9px;" onclick="devicesIntuneMaaOpenServiceNow('${escapeHtml(request.id)}')">Abrir ticket</button>
                </div></td>
            </tr>`;
        });
    });
    html += "</tbody></table></div>";
    el.innerHTML = html;
}

function devicesIntuneMaaTicketText(user, request) {
    const format = value => {
        if (!value) return "Não informado";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
    };

    return `SOLICITAÇÃO INTUNE MAA

Solicitante: ${user.displayName || "Não informado"}
UPN do solicitante: ${user.userPrincipalName || user.requestedUpn || "Não informado"}
ID da solicitação MAA: ${request.id}
Intune Device ID: ${request.deviceId || "Não devolvido pelo Intune"}
Equipamento: ${request.deviceName || "Não informado"}
Utilizador do equipamento: ${request.deviceUser || "Não informado"}
Estado atual: ${request.status}
Data da solicitação: ${format(request.requestDateTime)}
Data de expiração: ${format(request.expirationDateTime)}
Última alteração: ${format(request.lastModifiedDateTime)}
Tipo de política/ação: ${(request.policyTypes || []).join(", ") || "Não informado"}

Justificação do solicitante:
${request.requestJustification || "Não informada"}

Justificação da aprovação/rejeição:
${request.approvalJustification || "Ainda não informada"}

Resumo:
Foi identificada uma solicitação de ação sobre equipamento no fluxo Multi Admin Approval do Microsoft Intune. Favor analisar o pedido e proceder conforme o processo operacional aplicável.`;
}

async function devicesIntuneCopyText(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("Não foi possível copiar automaticamente.");
}

async function devicesIntuneMaaOpenServiceNow(requestId) {
    const entry = devicesIntuneMaaRequestsById.get(requestId);
    if (!entry) {
        devicesIntuneSetStatus("erro", "Atualize o painel MAA antes de abrir o ticket.");
        return;
    }

    const text = devicesIntuneMaaTicketText(entry.user, entry.request);
    let copied = false;
    try {
        await devicesIntuneCopyText(text);
        copied = true;
    } catch {}

    window.open(devicesIntuneServiceNowUrl, "_blank", "noopener,noreferrer");
    if (copied) {
        alert("O resumo da solicitação MAA foi copiado. Cole-o no campo de detalhes do ServiceNow.");
        devicesIntuneSetStatus("ok", "ServiceNow aberto e resumo do ticket copiado.");
    } else {
        prompt("Copie o resumo abaixo e cole no ServiceNow:", text);
    }
}

async function devicesIntuneMaaApprove(requestId) {
    if (!confirm("Confirma a aprovação desta solicitação MAA no Intune?\n\nPedido: " + requestId + "\n\nEsta ação será registada com a conta ligada por WAM.")) return;

    const justification = prompt("Justificação obrigatória para aprovação:", "Pedido validado pelo suporte e aprovado para execução.");
    if (!justification || justification.trim().length < 10) {
        devicesIntuneSetStatus("aviso", "Informe uma justificação com pelo menos 10 caracteres.");
        return;
    }

    try {
        devicesIntuneProgress(30, "A aprovar solicitação MAA no Intune...");
        devicesIntuneSetStatus("info", "A aprovar solicitação MAA no Intune...");
        const json = await devicesIntuneApi(
            "/module/devices-intune/api?action=approveMaaRequest",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestId, justification: justification.trim() })
            }
        );
        if (!json.success) throw new Error(json.message || "A aprovação MAA falhou.");
        devicesIntuneProgress(100, "Solicitação MAA aprovada.");
        devicesIntuneProgressHide(900);
        devicesIntuneSetStatus("ok", `Solicitação aprovada no Intune por ${escapeHtml(json.approvedBy || "conta WAM")}.`);
        await devicesIntuneMaaCheckNow();
    } catch (ex) {
        devicesIntuneProgressHide(900);
        devicesIntuneSetStatus("erro", escapeHtml(ex.message));
    }
}

async function devicesIntuneMaaResolveDevice(requestId, quiet = false) {
    const entry = devicesIntuneMaaRequestsById.get(requestId);
    if (entry?.request?.deviceId) return {
        id: entry.request.deviceId,
        deviceName: entry.request.deviceName,
        userDisplayName: entry.request.deviceUser,
        operatingSystem: entry.request.deviceOperatingSystem
    };
    try {
        devicesIntuneProgress(20, "A procurar o equipamento nos eventos de auditoria do Intune...");
        if (!quiet) devicesIntuneSetStatus("info", "A relacionar o pedido MAA com o equipamento...");
        const json = await devicesIntuneApi("/module/devices-intune/api?action=resolveMaaRequestDevice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requestId })
        });
        if (!json.success || !json.device?.id) throw new Error(json.message || "Equipamento não localizado.");
        const device = json.device;
        if (entry) {
            entry.request.deviceId = device.id;
            entry.request.deviceName = device.deviceName || "";
            entry.request.deviceUser = device.userDisplayName || device.userPrincipalName || "";
            entry.request.deviceOperatingSystem = [device.operatingSystem, device.osVersion].filter(Boolean).join(" ");
        }
        devicesIntuneMaaUpsert({
            id: device.id,
            maaRequestId: requestId,
            actionType: "Delete",
            deviceName: device.deviceName || "",
            userDisplayName: device.userDisplayName || "",
            userPrincipalName: device.userPrincipalName || "",
            operatingSystem: [device.operatingSystem, device.osVersion].filter(Boolean).join(" "),
            status: entry?.request?.status || "approved",
            statusDetail: "Equipamento localizado automaticamente pela auditoria do Intune.",
            lastCheck: new Date().toLocaleString()
        });
        const cell = document.getElementById(`maa-equipment-${requestId}`);
        if (cell) cell.innerHTML = `<strong>${escapeHtml(device.deviceName || "Equipamento MAA")}</strong><br><code style="font-size:11px;word-break:break-all">${escapeHtml(device.id)}</code><br><small>${escapeHtml(device.userDisplayName || device.userPrincipalName || "")}${device.operatingSystem ? ` · ${escapeHtml(device.operatingSystem)} ${escapeHtml(device.osVersion || "")}` : ""}</small>`;
        devicesIntuneProgress(100, "Equipamento localizado.");
        devicesIntuneProgressHide(700);
        devicesIntuneSetStatus("ok", `Equipamento localizado: ${escapeHtml(device.deviceName || device.id)}.`);
        return device;
    } catch (ex) {
        devicesIntuneProgressHide(900);
        devicesIntuneSetStatus("erro", escapeHtml(ex.message));
        return null;
    }
}

async function devicesIntuneMaaComplete(requestId) {
    const entry = devicesIntuneMaaRequestsById.get(requestId);
    const tracked = devicesIntuneMaaLoad().find(x => x.maaRequestId === requestId);
    let deviceId = entry?.request?.deviceId || tracked?.id || "";
    if (!deviceId) {
        const resolved = await devicesIntuneMaaResolveDevice(requestId, true);
        if (!resolved?.id) return;
        deviceId = resolved.id;
    }

    try {
        devicesIntuneProgress(20, "A validar solicitação e equipamento...");
        devicesIntuneSetStatus("info", "A validar a conclusão MAA...");
        const preview = await devicesIntuneApi(
            "/module/devices-intune/api?action=completeMaaDelete",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestId, deviceId: deviceId.trim(), mode: "preview" })
            }
        );
        if (!preview.success) throw new Error(preview.message || "Não foi possível validar a conclusão.");

        const d = preview.device || {};
        const confirmed = confirm(
            "CONFIRMAR REMOÇÃO DEFINITIVA NO INTUNE\n\n" +
            "Device: " + (d.deviceName || "Não informado") + "\n" +
            "Utilizador: " + (d.userDisplayName || d.userPrincipalName || "Não informado") + "\n" +
            "Serial: " + (d.serialNumber || "Não informado") + "\n" +
            "Modelo/SO: " + (d.model || "") + " / " + (d.operatingSystem || "") + "\n" +
            "Intune Device ID: " + d.id + "\n\n" +
            "Esta ação conclui o MAA e remove o equipamento do Intune. Deseja continuar?"
        );
        if (!confirmed) {
            devicesIntuneProgressHide(500);
            devicesIntuneSetStatus("aviso", "Conclusão cancelada. Nenhuma remoção foi executada.");
            return;
        }

        devicesIntuneProgress(65, "A concluir remoção aprovada no Intune...");
        const result = await devicesIntuneApi(
            "/module/devices-intune/api?action=completeMaaDelete",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ requestId, deviceId: d.id, mode: "execute" })
            }
        );
        if (!result.success) throw new Error(result.message || "A conclusão MAA falhou.");

        devicesIntuneProgress(100, "Remoção MAA concluída.");
        devicesIntuneProgressHide(1000);
        devicesIntuneSetStatus("ok", `Remoção concluída por ${escapeHtml(result.completedBy || "conta WAM")}. Estado: ${escapeHtml(result.status || "completed")}.`);
        await devicesIntuneMaaCheckNow();
    } catch (ex) {
        devicesIntuneProgressHide(900);
        devicesIntuneSetStatus("erro", escapeHtml(ex.message));
    }
}

async function devicesIntuneMaaCheckUserRequests() {
    const users = devicesIntuneMaaLoadUsers();
    const json = await devicesIntuneApi(
        "/module/devices-intune/api?action=listMaaRequestsByUsers",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userPrincipalNames: users })
        }
    );
    if (!json.success) throw new Error(json.message || "Erro ao consultar solicitações MAA.");

    devicesIntuneMaaRenderUserRequests(json);
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem(devicesIntuneMaaSeenStorageKey) || "[]"); } catch {}
    const currentIds = (json.users || []).flatMap(x => (x.requests || []).map(r => r.id));
    const newIds = currentIds.filter(id => !seen.includes(id));
    if (newIds.length) devicesIntuneMaaNotify("Novas pendências MAA", `${newIds.length} nova(s) solicitação(ões) encontrada(s).`);
    localStorage.setItem(devicesIntuneMaaSeenStorageKey, JSON.stringify(currentIds));
    return json;
}

function devicesIntuneMaaLoad() {
    try {
        return JSON.parse(localStorage.getItem(devicesIntuneMaaStorageKey) || "[]");
    } catch {
        return [];
    }
}

function devicesIntuneMaaSave(items) {
    localStorage.setItem(devicesIntuneMaaStorageKey, JSON.stringify(items || []));
}

function devicesIntuneMaaUpsert(item) {
    const items = devicesIntuneMaaLoad();
    const idx = items.findIndex(x => x.id === item.id && x.actionType === item.actionType);

    if (idx >= 0) {
        items[idx] = { ...items[idx], ...item };
    } else {
        items.unshift(item);
    }

    devicesIntuneMaaSave(items);
    devicesIntuneMaaRender();
}

function devicesIntuneMaaTrackSelecionados(actionType, justification, apiResults) {
    const selecionados = devicesIntuneGetSelecionadosObjetos();

    selecionados.forEach(d => {
        const id = devicesIntuneNormalize(d.id);
        const result = (apiResults || []).find(r => r.id === id) || {};

        devicesIntuneMaaUpsert({
            id: id,
            actionType: actionType || "Delete",
            deviceName: devicesIntuneNormalize(d.deviceName),
            userDisplayName: devicesIntuneNormalize(d.userDisplayName),
            userPrincipalName: devicesIntuneNormalize(d.userPrincipalName),
            operatingSystem: devicesIntuneNormalize(d.operatingSystem),
            complianceState: devicesIntuneNormalize(d.complianceState),
            ownerType: devicesIntuneNormalize(d.managedDeviceOwnerType || d.ownerType),
            diasSemSync: devicesIntuneNormalize(d.diasSemSync),
            justification: justification || "",
            maaRequestId: result.approvalCode || "",
            requestedAt: new Date().toLocaleString(),
            lastCheck: "",
            status: "Pendente aprovação Intune",
            statusDetail: result.message || "Solicitação enviada para o fluxo MAA do Intune.",
            notFoundCount: 0,
            notified: false
        });
    });
}

function devicesIntuneMaaRender() {
    const el = document.getElementById("devicesIntuneMaaMonitorResultado");
    if (!el) return;

    const items = devicesIntuneMaaLoad();

    if (!items.length) {
        el.innerHTML = `<div class="di-alert di-alert-info">Nenhuma solicitação Intune MAA monitorizada.</div>`;
        return;
    }

    const pendentes = items.filter(x => !String(x.status).toLowerCase().includes("conclu")).length;
    const concluidos = items.length - pendentes;

    let html = `
        <div class="di-kpis">
            <div class="di-kpi"><span>Total monitorizado</span><strong>${items.length}</strong></div>
            <div class="di-kpi"><span>Pendentes</span><strong>${pendentes}</strong></div>
            <div class="di-kpi"><span>Concluídos</span><strong>${concluidos}</strong></div>
        </div>

        <div class="di-table-wrap">
            <table class="di-table">
                <thead>
                    <tr>
                        <th>Status</th>
                        <th>Ação</th>
                        <th>Device</th>
                        <th>Utilizador</th>
                        <th>UPN</th>
                        <th>Compliance</th>
                        <th>Solicitado em</th>
                        <th>Última verificação</th>
                        <th>Detalhe</th>
                    </tr>
                </thead>
                <tbody>
    `;

    items.forEach(r => {
        const done = String(r.status).toLowerCase().includes("conclu");
        const badgeClass = done ? "di-badge-green" : "di-badge-red";

        html += `
            <tr>
                <td><span class="di-badge ${badgeClass}">${escapeHtml(r.status)}</span></td>
                <td>${escapeHtml(r.actionType)}</td>
                <td>${escapeHtml(r.deviceName)}</td>
                <td>${escapeHtml(r.userDisplayName)}</td>
                <td>${escapeHtml(r.userPrincipalName)}</td>
                <td>${escapeHtml(r.complianceState)}</td>
                <td>${escapeHtml(r.requestedAt)}</td>
                <td>${escapeHtml(r.lastCheck)}</td>
                <td>${escapeHtml(r.statusDetail)}</td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    el.innerHTML = html;
}

async function devicesIntuneMaaCheckNow() {
    if (devicesIntuneMaaCheckRunning) return;
    devicesIntuneMaaCheckRunning = true;
    const items = devicesIntuneMaaLoad();

    devicesIntuneSetStatus("info", "A verificar solicitações Intune MAA...");
    devicesIntuneProgress(25, "A verificar solicitações Intune MAA...");

    try {
        await devicesIntuneMaaCheckUserRequests();
    } catch (ex) {
        const el = document.getElementById("devicesIntuneMaaUserResultado");
        if (el) el.innerHTML = `<div class="di-alert di-alert-erro">${escapeHtml(ex.message)}</div>`;
    }

    for (const item of items) {
        if (String(item.status).toLowerCase().includes("conclu")) {
            continue;
        }

        try {
            const json = await devicesIntuneApi(
                "/module/devices-intune/api?action=search&query=" + encodeURIComponent(item.id)
            );

            item.lastCheck = new Date().toLocaleString();

            if (json.success && json.devices && json.devices.length > 0) {
                item.status = "Pendente aprovação Intune";
                item.statusDetail = "Device ainda existe no Intune. Aguardando aprovação/conclusão.";
                item.notFoundCount = 0;
            } else {
                item.notFoundCount = Number(item.notFoundCount || 0) + 1;

                if (item.notFoundCount >= 2) {
                    item.status = "Concluído no Intune";
                    item.statusDetail = "Device não encontrado após verificações. Provável aprovação e remoção concluída.";

                    if (!item.notified) {
                        devicesIntuneMaaNotify(
                            "Solicitação Intune concluída",
                            item.deviceName + " foi removido/concluído no Intune."
                        );
                        item.notified = true;
                    }
                } else {
                    item.status = "A confirmar conclusão";
                    item.statusDetail = "Device não encontrado na primeira verificação. Será confirmado na próxima.";
                }
            }
        } catch (ex) {
            item.lastCheck = new Date().toLocaleString();
            item.statusDetail = "Erro ao verificar: " + ex.message;
        }
    }

    devicesIntuneMaaSave(items);
    devicesIntuneMaaRender();

    devicesIntuneProgress(100, "Verificação concluída.");
    devicesIntuneProgressHide(1000);
    devicesIntuneSetStatus("ok", "Verificação das solicitações concluída.");
    devicesIntuneMaaCheckRunning = false;
}

function devicesIntuneMaaAtivarNotificacoes() {
    if (!("Notification" in window)) {
        devicesIntuneSetStatus("aviso", "Este navegador não suporta notificações.");
        return;
    }

    Notification.requestPermission().then(permission => {
        if (permission === "granted") {
            devicesIntuneSetStatus("ok", "Notificações ativadas.");
        } else {
            devicesIntuneSetStatus("aviso", "Notificações não foram autorizadas.");
        }
    });
}

function devicesIntuneMaaNotify(title, body) {
    try {
        if ("Notification" in window && Notification.permission === "granted") {
            new Notification(title, { body: body });
        }
    } catch {}

    devicesIntuneSetStatus("ok", title + ": " + body);
}

function devicesIntuneMaaLimparConcluidos() {
    const items = devicesIntuneMaaLoad();
    const pendentes = items.filter(x => !String(x.status).toLowerCase().includes("conclu"));
    devicesIntuneMaaSave(pendentes);
    devicesIntuneMaaRender();
    devicesIntuneSetStatus("ok", "Solicitações concluídas removidas do painel.");
}

setInterval(() => {
    devicesIntuneMaaCheckNow();
}, 3600000);

setTimeout(() => {
    const input = document.getElementById("devicesIntuneMaaUsers");
    if (input) input.value = devicesIntuneMaaLoadUsers().join("\n");
    devicesIntuneMaaRender();
    devicesIntuneMaaCheckNow();
}, 1200);




async function devicesIntunePesquisarTodos() {

    const tipos =
        Array.from(
            document.querySelectorAll(
                ".diTipo:checked"
            )
        ).map(x => x.value);

    const compliance =
        Array.from(
            document.querySelectorAll(
                ".diCompliance:checked"
            )
        ).map(x => x.value);

    devicesIntuneSetStatus(
        "info",
        "Consultando Intune..."
    );

    try {

        const json =
            await devicesIntuneApi(
                "/module/devices-intune/api?action=listDevices" +
                "&tipo=" + encodeURIComponent(tipos.join(",")) +
                "&compliance=" + encodeURIComponent(compliance.join(","))
            );

        if (!json.success) {

            devicesIntuneSetStatus(
                "erro",
                json.message
            );

            return;
        }

        devicesIntuneUltimoResultado = json;

        devicesIntuneRender(json);

        devicesIntuneSetStatus(
            "ok",
            json.total +
            " dispositivos encontrados."
        );

    }
    catch(ex){

        devicesIntuneSetStatus(
            "erro",
            ex.message
        );
    }
}




async function devicesIntuneNonCompliant() {

    devicesIntuneSetStatus(
        "info",
        "A consultar dispositivos non-compliant..."
    );

    try {

        const json =
            await devicesIntuneApi(
                "/module/devices-intune/api?action=nonCompliant"
            );

        if (!json.success) {

            devicesIntuneSetStatus(
                "erro",
                json.message
            );

            return;
        }

        devicesIntuneUltimoResultado = json;

        devicesIntuneRender(json);

        devicesIntuneSetStatus(
            "ok",
            json.total +
            " dispositivos non-compliant encontrados."
        );

    }
    catch(ex){

        devicesIntuneSetStatus(
            "erro",
            ex.message
        );
    }
}

function devicesIntuneMaaAtivarNotificacoesWindowsGlobal() {
    if (window.SantanderMaaGlobal?.ativarNotificacoesWindows) {
        window.SantanderMaaGlobal.ativarNotificacoesWindows();
        return;
    }
    devicesIntuneMaaAtivarNotificacoes();
}

function devicesIntuneMaaAbrirContactosGlobal() {
    if (window.SantanderMaaGlobal?.abrirContactos) {
        window.SantanderMaaGlobal.abrirContactos();
        return;
    }
    devicesIntuneSetStatus("erro", "Gestão global de contactos não disponível. Atualize a aplicação com Ctrl+F5.");
}

function devicesIntuneMaaEnviarAlertaManualGlobal() {
    if (!window.SantanderMaaGlobal?.enviarAlertaManual) {
        devicesIntuneSetStatus("erro", "Envio global não disponível. Atualize a aplicação com Ctrl+F5.");
        return;
    }
    const items = [];
    devicesIntuneMaaRequestsById.forEach(({ user, request }) => {
        items.push({
            kind: request.status === "needsApproval" ? "approval" : "completion",
            user,
            request
        });
    });
    if (!items.length) {
        devicesIntuneSetStatus("aviso", "Clique primeiro em Verificar agora para carregar as solicitações MAA.");
        return;
    }
    window.SantanderMaaGlobal.enviarAlertaManual(items);
}

async function devicesIntuneMaaSendSystemAlert() {
    const entries = [...devicesIntuneMaaRequestsById.values()].filter(entry =>
        entry?.request?.status === "needsApproval" || entry?.request?.status === "approved"
    );
    if (!entries.length) {
        devicesIntuneSetStatus("aviso", "Clique primeiro em Verificar agora para carregar os pedidos MAA pendentes.");
        return;
    }
    let selected = entries[0];
    if (entries.length > 1) {
        const options = entries.map((entry, index) =>
            `${index + 1}. ${entry.request.status} · ${entry.user.userPrincipalName || entry.user.requestedUpn} · ${entry.request.id}`
        ).join("\n");
        const choice = prompt(`Selecione o pedido a notificar (1-${entries.length}):\n\n${options}`, "1");
        if (!choice) return;
        const index = Number(choice) - 1;
        if (!Number.isInteger(index) || !entries[index]) {
            devicesIntuneSetStatus("erro", "Seleção inválida.");
            return;
        }
        selected = entries[index];
    }
    if (!confirm(`Enviar agora uma notificação interna ao outro aprovador?\n\nPedido: ${selected.request.id}\nEstado: ${selected.request.status}`)) return;
    try {
        devicesIntuneProgress(30, "A criar notificação para o aprovador...");
        const json = await devicesIntuneApi("/module/devices-intune/api?action=createMaaManualSystemAlert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                requestId: selected.request.id,
                targetUpns: devicesIntuneMaaLoadUsers()
            })
        });
        if (!json.success) throw new Error(json.message || "Não foi possível enviar o alerta.");
        devicesIntuneProgress(100, "Notificação enviada.");
        devicesIntuneProgressHide(700);
        devicesIntuneSetStatus("ok", `${escapeHtml(json.message)} Destinatário(s): ${escapeHtml((json.targets || []).join(", "))}.`);
    } catch (ex) {
        devicesIntuneProgressHide(800);
        devicesIntuneSetStatus("erro", escapeHtml(ex.message));
    }
}
