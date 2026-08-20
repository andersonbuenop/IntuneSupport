let uxLastData = [];
let uxPollTimer = null;
let uxCurrentJobId = null;

const UX_SN_URL = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bb85467db79c0d4f1024dc2ba961997&sysparm_category=93d369bedbf1a700ec3fa5305b96190a";

function uxParseApi(raw) {
    let result = JSON.parse(raw);
    if (typeof result === "string") result = JSON.parse(result);
    return result;
}

function uxEscape(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function uxBadge(row) {
    const estado = row.Estado || "";
    if (estado === "Expirado") return `<span class="ux-badge danger">Expirado</span>`;
    if (estado === "Expira hoje") return `<span class="ux-badge warn">Expira hoje</span>`;
    return `<span class="ux-badge ok">A expirar</span>`;
}

function uxNotifyBadge(row) {
    if (row.Notificar) return `<span class="ux-badge ok">Sim</span>`;
    return `<span class="ux-badge gray">Não</span>`;
}

async function uxSearch() {
    const user = document.getElementById("uxUser").value.trim();
    const date = document.getElementById("uxDate").value;
    const dateFrom = document.getElementById("uxDateFrom").value;
    const dateTo = document.getElementById("uxDateTo").value;
    const notifyOnlyE8E9 = document.getElementById("uxOnlyE8E9").checked;

    const tbody = document.getElementById("uxTableBody");
    const summary = document.getElementById("uxSummary");

    uxResetStats();

    document.getElementById("uxProgressBox").style.display = "block";
    document.getElementById("uxProgressText").innerText = "A iniciar consulta...";
    document.getElementById("uxProgressSub").innerText = "A preparar consulta.";
    document.getElementById("uxProgressPercent").innerText = "0%";
    document.getElementById("uxProgressFill").style.width = "0%";

    tbody.innerHTML = `<tr><td colspan="16" class="ux-empty">A iniciar consulta no Active Directory...</td></tr>`;
    summary.style.display = "none";
    uxLastData = [];

    if (uxPollTimer) clearInterval(uxPollTimer);

    try {
        const response = await fetch("/module/utilizadores-expirar/api", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                action: "start",
                user,
                date,
                dateFrom,
                dateTo,
                notifyOnlyE8E9
            })
        });

        const startResult = uxParseApi(await response.text());

        if (!startResult.success) throw new Error(startResult.message || "Erro ao iniciar consulta.");

        uxCurrentJobId = startResult.jobId;
        uxPollTimer = setInterval(async () => await uxReadProgress(uxCurrentJobId), 1000);
        await uxReadProgress(uxCurrentJobId);

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="16" class="ux-empty">Erro: ${uxEscape(err.message)}</td></tr>`;
    }
}

async function uxReadProgress(jobId) {
    try {
        const response = await fetch("/module/utilizadores-expirar/api", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ action: "progress", jobId })
        });

        const result = uxParseApi(await response.text());

        if (!result.success && result.status !== "done" && result.status !== "cancelled") {
            throw new Error(result.message || result.error || "Erro ao consultar progresso.");
        }

        const percent = result.percent || 0;

        document.getElementById("uxProgressText").innerText = result.current || "A processar...";
        document.getElementById("uxProgressSub").innerText = `Estado: ${result.status || "-"} | Job: ${jobId}`;
        document.getElementById("uxProgressPercent").innerText = percent + "%";
        document.getElementById("uxProgressFill").style.width = percent + "%";

        document.getElementById("uxCurrentDomain").innerText = result.currentDomain || "-";
        document.getElementById("uxCurrentUser").innerText = result.currentUser || "-";
        document.getElementById("uxProcessed").innerText = result.processed || 0;
        document.getElementById("uxFound").innerText = result.found || 0;
        document.getElementById("uxElapsed").innerText = result.elapsed || "00:00:00";
        document.getElementById("uxSpeed").innerText = `${result.speed || 0}/s`;

        uxLastData = result.data || [];
        uxUpdateStats(result.stats);
        uxRenderTable();

        document.getElementById("uxSummary").style.display = "block";
        document.getElementById("uxSummary").innerHTML =
            `Encontrados: ${uxLastData.length} | Processados: ${result.processed || 0} | Tempo: ${uxEscape(result.elapsed || "00:00:00")}`;

        if (["done","error","cancelled"].includes(result.status)) {
            clearInterval(uxPollTimer);
            uxPollTimer = null;

            if (result.status === "error") {
                document.getElementById("uxTableBody").innerHTML =
                    `<tr><td colspan="16" class="ux-empty">Erro: ${uxEscape(result.error)}</td></tr>`;
            }
        }

    } catch (err) {
        clearInterval(uxPollTimer);
        uxPollTimer = null;
        document.getElementById("uxTableBody").innerHTML =
            `<tr><td colspan="16" class="ux-empty">Erro: ${uxEscape(err.message)}</td></tr>`;
    }
}

function uxRenderTable() {
    const tbody = document.getElementById("uxTableBody");

    if (!uxLastData.length) {
        tbody.innerHTML = `<tr><td colspan="16" class="ux-empty">Nenhum utilizador encontrado.</td></tr>`;
        return;
    }

    tbody.innerHTML = uxLastData.map((row, index) => `
        <tr>
            <td>
                <div class="ux-row-actions">
                    <button class="ux-btn small primary" onclick="uxSendMail(${index}, false)">Enviar</button>
                    <button class="ux-btn small" onclick="uxSendMail(${index}, true)">Teste</button>
                    <button class="ux-btn small" onclick="uxCopyTicket(${index})">Copiar SN</button>
                    <button class="ux-btn small" onclick="uxOpenServiceNow(${index})">Abrir SN</button>
                </div>
            </td>
            <td>${uxNotifyBadge(row)}</td>
            <td>${uxEscape(row.Dominio)}</td>
            <td><b>${uxEscape(row.SamAccountName)}</b></td>
            <td>${uxEscape(row.Nome)}</td>
            <td>${uxEscape(row.UserPrincipalName)}</td>
            <td>${uxEscape(row.Email)}</td>
            <td>${uxEscape(row.Manager)}</td>
            <td>${uxEscape(row.ManagerEmail)}</td>
            <td>${row.Enabled ? "Ativo" : "Desativado"}</td>
            <td>${uxBadge(row)}<br>${uxEscape(row.AccountExpires)}</td>
            <td>${uxEscape(row.DiasParaExpirar)}</td>
            <td>${uxEscape(row.Departamento)}</td>
            <td>${uxEscape(row.Cargo)}</td>
            <td>${uxEscape(row.Descricao)}</td>
            <td title="${uxEscape(row.DistinguishedName)}">${uxEscape(row.DistinguishedName)}</td>
        </tr>
    `).join("");
}

async function uxSendMail(index, isTest) {
    const row = uxLastData[index];

    if (!row.Notificar && !isTest) {
        alert("Este utilizador não é E8* ou E9*. Não está elegível para notificação.");
        return;
    }

    const testTo = document.getElementById("uxTestEmail").value.trim();

    if (isTest && !testTo) {
        alert("Informe o email de teste.");
        return;
    }

    if (!isTest) {
        const ok = confirm(`Enviar email para ${row.Email || ""} ${row.ManagerEmail || ""}?`);
        if (!ok) return;
    }

    const response = await fetch("/module/utilizadores-expirar/api", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            action: "sendMail",
            row,
            testTo: isTest ? testTo : ""
        })
    });

    const result = uxParseApi(await response.text());

    if (!result.success) {
        alert("Erro: " + (result.message || "Erro ao enviar email."));
        return;
    }

    alert(result.message || "Email enviado.");
}

function uxBuildTicketText(row) {
    return [
        "Pedido: Notificação de utilizador a expirar",
        "",
        "Utilizador: " + (row.SamAccountName || ""),
        "Nome: " + (row.Nome || ""),
        "UPN: " + (row.UserPrincipalName || ""),
        "Email: " + (row.Email || ""),
        "Domínio: " + (row.Dominio || ""),
        "Estado AD: " + (row.Enabled ? "Ativo" : "Desativado"),
        "Data de expiração: " + (row.AccountExpires || ""),
        "Dias para expirar: " + (row.DiasParaExpirar || ""),
        "Departamento: " + (row.Departamento || ""),
        "Cargo: " + (row.Cargo || ""),
        "Descrição AD: " + (row.Descricao || ""),
        "",
        "Manager: " + (row.Manager || "Sem manager no AD"),
        "Email Manager: " + (row.ManagerEmail || "Sem email de manager"),
        "",
        "Ação necessária:",
        "O manager deve atualizar as informações do utilizador no Workday.",
        "Caso contrário, o utilizador poderá ser bloqueado após a data de expiração.",
        "",
        "CC fixo:",
        "santander.enduser@santander.pt",
        "jose.simoes@santander.pt",
        "maria.santosp@gruposantander.com",
        "",
        "Remetente configurado:",
        "User.Action.Required@santander.pt"
    ].join("\n");
}

async function uxCopyTicket(index) {
    const row = uxLastData[index];
    const text = uxBuildTicketText(row);

    try {
        await navigator.clipboard.writeText(text);
        alert("Texto do ServiceNow copiado.");
    } catch {
        prompt("Copie o texto abaixo:", text);
    }
}

function uxOpenServiceNow(index) {
    uxCopyTicket(index);
    window.open(UX_SN_URL, "_blank");
}

async function uxCancel() {
    if (!uxCurrentJobId) {
        alert("Não existe consulta em execução.");
        return;
    }

    await fetch("/module/utilizadores-expirar/api", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ action: "cancel", jobId: uxCurrentJobId })
    });
}

function uxUpdateStats(stats) {
    stats = stats || {};
    document.getElementById("uxStatTotal").innerText = stats.total || 0;
    document.getElementById("uxStatExpired").innerText = stats.expired || 0;
    document.getElementById("uxStatToday").innerText = stats.today || 0;
    document.getElementById("uxStat7").innerText = stats.sevenDays || 0;
    document.getElementById("uxStat30").innerText = stats.thirtyDays || 0;
    if (document.getElementById("uxStatE8E9")) {
        document.getElementById("uxStatE8E9").innerText = stats.e8e9 || 0;
    }
}

function uxResetStats() {
    uxUpdateStats({total:0,expired:0,today:0,sevenDays:0,thirtyDays:0,e8e9:0});
    document.getElementById("uxCurrentDomain").innerText = "-";
    document.getElementById("uxCurrentUser").innerText = "-";
    document.getElementById("uxProcessed").innerText = "0";
    document.getElementById("uxFound").innerText = "0";
    document.getElementById("uxElapsed").innerText = "00:00:00";
    document.getElementById("uxSpeed").innerText = "0/s";
}

function uxClear() {
    if (uxPollTimer) clearInterval(uxPollTimer);

    uxCurrentJobId = null;
    uxLastData = [];

    document.getElementById("uxUser").value = "";
    document.getElementById("uxDate").value = "";
    document.getElementById("uxDateFrom").value = "";
    document.getElementById("uxDateTo").value = "";
    document.getElementById("uxProgressBox").style.display = "none";
    document.getElementById("uxSummary").style.display = "none";
    document.getElementById("uxTableBody").innerHTML =
        `<tr><td colspan="16" class="ux-empty">Preencha os filtros e clique em Consultar.</td></tr>`;

    uxResetStats();
}

function uxExportCsv() {
    if (!uxLastData.length) {
        alert("Não existem dados para exportar.");
        return;
    }

    const headers = [
        "Dominio","SamAccountName","Nome","UserPrincipalName","Email",
        "Manager","ManagerEmail","Enabled","Estado","AccountExpires",
        "DiasParaExpirar","Departamento","Cargo","Descricao","Notificar",
        "CriadoEm","DistinguishedName"
    ];

    const csv = [
        headers.join(";"),
        ...uxLastData.map(row => headers.map(h => {
            const value = row[h] ?? "";
            return `"${String(value).replaceAll('"', '""')}"`;
        }).join(";"))
    ].join("\r\n");

    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "utilizadores-a-expirar.csv";
    a.click();
    URL.revokeObjectURL(url);
}


async function uxSendAll() {
    const rows = uxLastData.filter(r => r.Notificar === true);

    if (!rows.length) {
        alert("Não existem utilizadores E8/E9 elegíveis para envio.");
        return;
    }

    const ok = confirm(`Enviar email para todos os ${rows.length} utilizadores E8/E9 encontrados?`);
    if (!ok) return;

    let success = 0;
    let fail = 0;

    for (const row of rows) {
        try {
            const response = await fetch("/module/utilizadores-expirar/api", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    action: "sendMail",
                    row,
                    testTo: ""
                })
            });

            const result = uxParseApi(await response.text());

            if (result.success) {
                success++;
            } else {
                fail++;
            }
        } catch {
            fail++;
        }

        document.getElementById("uxSummary").style.display = "block";
        document.getElementById("uxSummary").innerHTML =
            `Envio em massa em execução... Sucesso: ${success} | Falhas: ${fail} | Total: ${rows.length}`;
    }

    alert(`Envio concluído.\n\nSucesso: ${success}\nFalhas: ${fail}\nTotal: ${rows.length}`);
}
