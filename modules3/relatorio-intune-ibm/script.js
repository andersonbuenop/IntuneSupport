window.ibm2All = [];
window.ibm2Filtered = [];
window.ibm2Page = 1;
window.ibm2PageSize = 50;
window.ibm2SortCol = "";
window.ibm2SortDir = "asc";

function ibm2SetStatus(msg, type) {
    const el = document.getElementById("ibm2Status");
    if (!el) return;
    el.className = "ibm2-status " + (type || "");
    el.innerText = msg || "";
}

function ibm2SetLoading(active, msg) {
    const el = document.getElementById("ibm2Loading");
    const txt = document.getElementById("ibm2LoadingText");

    if (!el) return;

    el.style.display = active ? "block" : "none";

    if (txt) {
        txt.innerText = msg || "A processar...";
    }
}

async function ibm2Api(action, payload) {
    const response = await fetch("/module/relatorio-intune-ibm/api?action=" + encodeURIComponent(action), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({}, payload || {}, { action }))
    });

    const text = await response.text();
    let result = JSON.parse(text);

    if (typeof result === "string") {
        result = JSON.parse(result);
    }

    return result;
}

async function ibm2Connect() {
    try {
        ibm2SetLoading(true, "A conectar ao Graph/Intune...");
        ibm2SetStatus("", "");

        const r = await ibm2Api("connect", {});

        if (!r.success) throw new Error(r.error || "Erro ao conectar.");

        ibm2SetStatus("Conectado: " + (r.account || ""), "ok");
    }
    catch (e) {
        ibm2SetStatus(e.message, "error");
    }
    finally {
        ibm2SetLoading(false);
    }
}

async function ibm2Load() {
    try {
        ibm2SetLoading(true, "A consultar dispositivos no Intune...");
        ibm2SetStatus("Consulta iniciada. Pode demorar alguns segundos.", "");

        const r = await ibm2Api("buscar-intune", {});

        if (!r.success) throw new Error(r.error || "Erro ao consultar Intune.");

        window.ibm2All = r.data || [];
        window.ibm2Page = 1;

        ibm2ApplyFilters(); await ibm2AtualizarComunicadosERecarregar(); ibm2SetStatus("Consulta concluida. Total: " + window.ibm2All.length + " devices.", "ok");
    }
    catch (e) {
        ibm2SetStatus(e.message, "error");
    }
    finally {
        ibm2SetLoading(false);
    }
}

function ibm2Checked(name) {
    return Array.from(document.querySelectorAll("input[name='" + name + "']:checked")).map(x => x.value);
}

function ibm2Text(v) {
    return String(v ?? "").toLowerCase();
}

function ibm2ApplyFilters() {
    const search = ibm2Text(document.getElementById("ibm2Search")?.value || "");
    const tipos = ibm2Checked("ibm2Tipo");
    const status = ibm2Checked("ibm2StatusFilter");
    const statusCalc = ibm2Checked("ibm2StatusCalcFilter");
    const owners = ibm2Checked("ibm2Owner");
    const diasSyncRaw = document.getElementById("ibm2DiasSync")?.value || "";
    const diasSync = diasSyncRaw === "" ? null : parseInt(diasSyncRaw, 10);

    let data = window.ibm2All.slice();

    if (search) {
        data = data.filter(r => {
            const blob = [
                r.Utilizador,
                r.Nome,
                r.Device,
                r.Tipo,
                r.Plataforma,
                r.StatusIntune,
                r.StatusCalculado,
                r.ManagementState,
                r.OwnerType,
                r.Fabricante,
                r.Modelo,
                r.SerialNumber,
                r.IMEI,
                r.Email,
                r.Telefone
            ].map(ibm2Text).join(" ");

            return blob.includes(search);
        });
    }

    if (tipos.length) {
        data = data.filter(r => tipos.includes(r.Tipo));
    }

    if (status.length) {
        data = data.filter(r => status.includes(r.StatusIntune));
    }

    if (statusCalc.length) {
        data = data.filter(r => statusCalc.includes(r.StatusCalculado));
    }

    if (owners.length) {
        data = data.filter(r => owners.includes(r.OwnerType));
    }

    if (diasSync !== null && !Number.isNaN(diasSync)) {
        data = data.filter(r => Number(r.DiasSemSync || 0) >= diasSync);
    }

    window.ibm2Filtered = data;

    ibm2RenderDashboard(data);
    ibm2RenderTable();
}

function ibm2RenderDashboard(data) {
    const el = document.getElementById("ibm2Dashboard");
    if (!el) return;

    const count = f => data.filter(f).length;

    const items = [
        ["Total", data.length],
        ["Android", count(x => x.Tipo === "Android")],
        ["iPhone", count(x => x.Tipo === "iPhone")],
        ["iPad", count(x => x.Tipo === "iPad")],
        ["Mac", count(x => x.Tipo === "Mac")],
        ["Tablet", count(x => x.Tipo === "Tablet")],
        ["Compliant", count(x => x.StatusIntune === "compliant")],
        ["Ação", count(x => x.Acao === "Sim")]
    ];

    el.innerHTML = items.map(i => `
        <div class="ibm2-kpi">
            <span>${i[0]}</span>
            <strong>${i[1]}</strong>
        </div>
    `).join("");
}

function ibm2Escape(v) {
    return String(v ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function ibm2Badge(v) {
    const value = String(v ?? "");
    const low = value.toLowerCase();

    if (!value) return "";

    if (low === "compliant" || low === "active" || low === "nao") {
        return `<span class="badge badge-ok">${ibm2Escape(value)}</span>`;
    }

    if (low === "android" || low === "iphone" || low === "ipad" || low === "mac" || low === "tablet") {
        return `<span class="badge badge-info">${ibm2Escape(value)}</span>`;
    }

    return `<span class="badge badge-warn">${ibm2Escape(value)}</span>`;
}

function ibm2Sort(col) {
    if (window.ibm2SortCol === col) {
        window.ibm2SortDir = window.ibm2SortDir === "asc" ? "desc" : "asc";
    } else {
        window.ibm2SortCol = col;
        window.ibm2SortDir = "asc";
    }

    ibm2RenderTable();
}

function ibm2RenderTable() {
    const el = document.getElementById("ibm2Table");
    const countEl = document.getElementById("ibm2Count");
    const pageInfo = document.getElementById("ibm2PageInfo");

    if (!el) return;

    let data = window.ibm2Filtered.slice();

    if (window.ibm2SortCol) {
        const col = window.ibm2SortCol;
        const dir = window.ibm2SortDir;

        data.sort((a, b) => {
            const va = ibm2Text(a[col]);
            const vb = ibm2Text(b[col]);

            if (va < vb) return dir === "asc" ? -1 : 1;
            if (va > vb) return dir === "asc" ? 1 : -1;
            return 0;
        });
    }

    window.ibm2Filtered = data;

    const total = data.length;
    const pageSize = window.ibm2PageSize;
    const maxPage = Math.max(1, Math.ceil(total / pageSize));

    if (window.ibm2Page > maxPage) window.ibm2Page = maxPage;

    const start = (window.ibm2Page - 1) * pageSize;
    const pageRows = data.slice(start, start + pageSize);

    if (countEl) countEl.innerText = total;
    if (pageInfo) pageInfo.innerText = "Página " + window.ibm2Page + " / " + maxPage;

    if (!pageRows.length) {
        el.innerHTML = "<div style='padding:18px;'>Sem resultados.</div>";
        return;
    }

    const cols = [
        "Utilizador",
        "Nome",
        "Device",
        "Tipo",
        "Plataforma",
        "Versao",
        "StatusIntune",
        "StatusCalculado",
        "OwnerType",
        "UltimoSync",
        "DiasSemSync",
        "Fabricante",
        "Modelo",
        "SerialNumber",
        "IMEI",
        "Acao"
    ];

    let html = "<table class='ibm2-table'><thead><tr>";

    cols.forEach(c => {
        html += `<th onclick="ibm2Sort('${c}')">${c}</th>`;
    });

    html += "<th>Estado da Ação</th>";
    html += "<th>Tratamento</th>";
    html += "</tr></thead><tbody>";

    pageRows.forEach((r, pageIdx) => {
        const realIdx = start + pageIdx;
        const estado = ibm2EstadoAcao(r);

        html += "<tr>";

        cols.forEach(c => {
            const v = r[c];

            if (["Tipo", "StatusIntune", "StatusCalculado", "Acao"].includes(c)) {
                html += `<td>${ibm2Badge(v)}</td>`;
            } else {
                html += `<td>${ibm2Escape(v)}</td>`;
            }
        });

        html += `<td>${ibm2EstadoAcaoHtml(r)}</td>`;

        if (ibm2IsNaoCompliant(r)) {
            html += `
                <td>
                    <div class="ibm2-row-actions">
                        <button class="ibm2-action-btn ibm2-action-email" onclick="ibm2EmailUtilizador(${realIdx})">Comunicar</button>
                        <button class="ibm2-action-btn ibm2-action-snow" onclick="ibm2AbrirServiceNow(${realIdx})">Abrir ticket</button>
                        <button class="ibm2-action-btn ibm2-action-ok" onclick="ibm2MarcarRegularizado(${realIdx})">Regularizado</button>
                        <button class="ibm2-action-btn ibm2-action-removed" onclick="ibm2MarcarRemovido(${realIdx})">Removido</button>
                    </div>
                </td>
            `;
        } else {
            html += "<td></td>";
        }

        html += "</tr>";
    });

    html += "</tbody></table>";

    el.innerHTML = html;
}

function ibm2ChangePageSize() {
    window.ibm2PageSize = parseInt(document.getElementById("ibm2PageSize").value, 10);
    window.ibm2Page = 1;
    ibm2RenderTable();
}

function ibm2PrevPage() {
    if (window.ibm2Page > 1) {
        window.ibm2Page--;
        ibm2RenderTable();
    }
}

function ibm2NextPage() {
    const maxPage = Math.max(1, Math.ceil(window.ibm2Filtered.length / window.ibm2PageSize));

    if (window.ibm2Page < maxPage) {
        window.ibm2Page++;
        ibm2RenderTable();
    }
}

function ibm2ExportCsv() {
    const data = window.ibm2Filtered || [];

    if (!data.length) {
        alert("Sem dados para exportar.");
        return;
    }

    const cols = Object.keys(data[0]);

    const csv = [
        cols.join(";"),
        ...data.map(r => cols.map(c => `"${String(r[c] ?? "").replaceAll('"', '""')}"`).join(";"))
    ].join("\r\n");

    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = "relatorio-intune-ibm-v2-filtrado.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}

function ibm2Count(data, fn) {
    return data.filter(fn).length;
}

function ibm2Percent(value, total) {
    const percent = total > 0 ? (Number(value) / Number(total)) * 100 : 0;
    return percent.toLocaleString("pt-PT", {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    });
}

function ibm2MesAtualPt() {
    return new Intl.DateTimeFormat("pt-PT", { month: "long", year: "numeric" }).format(new Date());
}

function ibm2BuildExecutiveReport(data) {
    if (!Array.isArray(data) || !data.length) {
        throw new Error("Sem dados para gerar relatório.");
    }

    const total = data.length;
    const norm = value => String(value || "").trim().toLowerCase();
    const isSemSync = row => norm(row.StatusCalculado) === "sem sync";
    const isNaoCompliant = row => norm(row.StatusIntune) !== "compliant";
    const byType = type => data.filter(row => row.Tipo === type);
    const groups = [
        { os: "iOS", type: "iPhone", label: "iPhone", rows: byType("iPhone") },
        { os: "iOS", type: "iPad", label: "iPad", rows: byType("iPad") },
        { os: "macOS", type: "Mac", label: "MacBook", rows: byType("Mac") },
        { os: "Android", type: "Android", label: "Phone", rows: byType("Android") },
        { os: "Android", type: "Tablet", label: "Tablet", rows: byType("Tablet") }
    ];
    const ios = groups[0].rows.length + groups[1].rows.length;
    const mac = groups[2].rows.length;
    const android = groups[3].rows.length + groups[4].rows.length;
    const compliant = data.filter(row => norm(row.StatusIntune) === "compliant" && !isSemSync(row)).length;
    const naoCompliant = data.filter(isNaoCompliant).length;
    const semSync = data.filter(isSemSync).length;
    const incidencia = data.filter(row => isNaoCompliant(row) || isSemSync(row)).length;
    const incidenciaTexto = incidencia === 1 ? "1 equipamento" : `${incidencia} equipamentos`;
    const month = ibm2MesAtualPt();
    const generated = new Date().toLocaleString("pt-PT");

    const typeRows = groups.map(group => `
        <tr>
            <td style="padding:10px 12px;border-top:1px solid #e8e8e8;color:#404040;">${group.os}</td>
            <td style="padding:10px 12px;border-top:1px solid #e8e8e8;color:#404040;">${group.label}</td>
            <td align="center" style="padding:10px 12px;border-top:1px solid #e8e8e8;font-weight:700;color:#262626;">${group.rows.length}</td>
            <td align="center" style="padding:10px 12px;border-top:1px solid #e8e8e8;color:#c40018;font-weight:700;">${group.rows.filter(isNaoCompliant).length}</td>
            <td align="center" style="padding:10px 12px;border-top:1px solid #e8e8e8;color:#c40018;font-weight:700;">${group.rows.filter(isSemSync).length}</td>
        </tr>`).join("");

    const platformCard = (name, value, width) => `
        <td width="${width}" style="padding:6px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dedede;border-radius:14px;background:#ffffff;">
                <tr><td style="padding:20px 18px;">
                    <span style="font-size:18px;font-weight:800;color:#c40018;">${name}</span>
                    <span style="display:block;margin-top:7px;font-size:11px;color:#666;text-transform:uppercase;">Total equipamentos</span>
                    <span style="font-size:25px;color:#333;">${value}</span>
                    <span style="font-size:13px;color:#666;"> (${ibm2Percent(value, total)}%)</span>
                </td></tr>
            </table>
        </td>`;

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Intune - Visão global do parque</title></head>
<body style="margin:0;padding:0;background:#eeeeee;font-family:Arial,'Segoe UI',sans-serif;color:#333333;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#eeeeee;padding:22px 0;"><tr><td align="center">
<table width="1080" cellpadding="0" cellspacing="0" style="width:1080px;max-width:96%;background:#ffffff;border:1px solid #d9d9d9;">
    <tr><td style="padding:34px 48px 10px 48px;">
        <div style="font-size:26px;line-height:1;color:#c40018;">Intune</div>
        <div style="font-size:22px;line-height:1.35;color:#333;margin-top:4px;">Visão global do parque – ${month}</div>
    </td></tr>
    <tr><td style="padding:10px 48px 20px 48px;font-size:17px;color:#555;">
        Distribuição dos equipamentos geridos em Intune e principais indicadores de conformidade.
    </td></tr>
    <tr><td style="padding:0 42px 12px 42px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="29%" style="padding:6px;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background:#eeeeee;border-radius:14px;">
                    <tr><td style="padding:20px 18px;border-left:5px solid #c40018;">
                        <span style="font-size:11px;color:#555;text-transform:uppercase;">Total equipamentos</span>
                        <span style="display:block;font-size:31px;color:#333;margin-top:3px;">${total}</span>
                    </td></tr>
                </table>
            </td>
            ${platformCard("iOS", ios, "24%")}
            ${platformCard("macOS", mac, "20%")}
            ${platformCard("Android", android, "27%")}
        </tr></table>
    </td></tr>
    <tr><td style="padding:0 48px 18px 48px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dedede;border-radius:14px;overflow:hidden;font-size:13px;">
            <tr style="background:#f5f5f5;color:#c40018;text-transform:uppercase;font-size:11px;">
                <th align="left" style="padding:12px;">Sistema operativo</th>
                <th align="left" style="padding:12px;">Tipo equipamento</th>
                <th style="padding:12px;">Total equipamentos</th>
                <th style="padding:12px;">Total não compliant</th>
                <th style="padding:12px;">Total sem sincronização</th>
            </tr>
            ${typeRows}
            <tr style="background:#fafafa;font-weight:800;">
                <td colspan="2" style="padding:11px 12px;border-top:2px solid #d8d8d8;">TOTAL</td>
                <td align="center" style="padding:11px 12px;border-top:2px solid #d8d8d8;">${total}</td>
                <td align="center" style="padding:11px 12px;border-top:2px solid #d8d8d8;color:#c40018;">${naoCompliant}</td>
                <td align="center" style="padding:11px 12px;border-top:2px solid #d8d8d8;color:#c40018;">${semSync}</td>
            </tr>
        </table>
    </td></tr>
    <tr><td style="padding:0 42px 28px 42px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="58%" style="padding:6px;vertical-align:top;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background:#eeeeee;border-radius:12px;"><tr>
                    <td width="58" align="center" style="padding:18px 8px 18px 16px;"><span style="display:inline-block;background:#333;color:#fff;border-radius:50%;width:38px;height:38px;line-height:38px;font-size:20px;">i</span></td>
                    <td style="padding:17px 18px 17px 8px;font-size:14px;line-height:1.5;color:#444;">
                        <b>${ibm2Percent(compliant, total)}%</b> dos equipamentos encontram-se <i>compliant</i>. Existem <b>${incidenciaTexto}</b> com incidências de conformidade ou sincronização.
                    </td>
                </tr></table>
            </td>
            <td width="42%" style="padding:6px;vertical-align:top;">
                <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff1f1;border-radius:12px;"><tr>
                    <td width="58" align="center" style="padding:18px 8px 18px 16px;"><span style="display:inline-block;background:#333;color:#fff;border-radius:50%;width:38px;height:38px;line-height:38px;font-size:20px;">!</span></td>
                    <td style="padding:17px 18px 17px 8px;font-size:14px;line-height:1.5;color:#444;">Analisar os equipamentos não compliant e sem sincronização, identificar a causa e acompanhar a respetiva regularização.</td>
                </tr></table>
            </td>
        </tr></table>
    </td></tr>
    <tr><td style="padding:0 48px 24px 48px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:11px;color:#555;">IBM Technology Lifecycle Services for <b style="color:#c40018;font-size:15px;">Santander</b></td>
            <td align="right" style="font-size:10px;color:#888;">Gerado em ${generated}</td>
        </tr></table>
    </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function ibm2GerarRelatorioHtml() {
    const data = window.ibm2Filtered && window.ibm2Filtered.length ? window.ibm2Filtered : window.ibm2All;
    const html = ibm2BuildExecutiveReport(data);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "intune-visao-global-parque.html";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
function ibm2HojePt() {
    return new Date().toLocaleDateString("pt-PT");
}

function ibm2DefaultSubject() {
    return "Relatório Intune Santander - " + ibm2HojePt();
}

function ibm2LoadMailPrefs() {
    const to = localStorage.getItem("ibm2MailTo") || "";
    const cc = localStorage.getItem("ibm2MailCc") || "";
    const subject = localStorage.getItem("ibm2MailSubject") || ibm2DefaultSubject();

    const toEl = document.getElementById("ibm2MailTo");
    const ccEl = document.getElementById("ibm2MailCc");
    const subjectEl = document.getElementById("ibm2MailSubject");

    if (toEl) toEl.value = to;
    if (ccEl) ccEl.value = cc;
    if (subjectEl) subjectEl.value = subject;
}

function ibm2SaveMailPrefs() {
    const to = document.getElementById("ibm2MailTo")?.value || "";
    const cc = document.getElementById("ibm2MailCc")?.value || "";
    const subject = document.getElementById("ibm2MailSubject")?.value || ibm2DefaultSubject();

    localStorage.setItem("ibm2MailTo", to);
    localStorage.setItem("ibm2MailCc", cc);
    localStorage.setItem("ibm2MailSubject", subject);
}

function ibm2RelatorioHtmlEmail() {
    const data = window.ibm2Filtered && window.ibm2Filtered.length ? window.ibm2Filtered : window.ibm2All;
    return ibm2BuildExecutiveReport(data);
}
async function ibm2PrepararEmailOutlook() {
    try {
        ibm2SaveMailPrefs();

        const to = document.getElementById("ibm2MailTo")?.value || "";
        const cc = document.getElementById("ibm2MailCc")?.value || "";
        const subject = document.getElementById("ibm2MailSubject")?.value || ibm2DefaultSubject();

        if (!to.trim()) {
            alert("Preencha o destinatário.");
            return;
        }

        const html = ibm2RelatorioHtmlEmail();

        ibm2SetLoading(true, "A preparar email no Outlook...");

        const r = await ibm2Api("preparar-email", {
            to,
            cc,
            subject,
            html
        });

        if (!r.success) {
            throw new Error(r.error || "Erro ao preparar email.");
        }

        ibm2SetStatus("Email preparado no Outlook.", "ok");
    }
    catch (e) {
        ibm2SetStatus(e.message, "error");
        alert(e.message);
    }
    finally {
        ibm2SetLoading(false);
    }
}

setTimeout(ibm2LoadMailPrefs, 300);

document.addEventListener("input", function(e) {
    if (e.target && ["ibm2MailTo", "ibm2MailCc", "ibm2MailSubject"].includes(e.target.id)) {
        ibm2SaveMailPrefs();
    }
});


const IBM2_SNOW_URL = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7&sysparm_category=6f044c7c1b1945505ae05532604bcb04";

function ibm2ResumoTicketGeral() {
    const data = window.ibm2Filtered && window.ibm2Filtered.length ? window.ibm2Filtered : window.ibm2All;
    const rows = Array.isArray(data) ? data : [];
    const norm = value => String(value || "").trim().toLowerCase();
    const naoCompliant = rows.filter(row => norm(row.StatusIntune) !== "compliant").length;
    const semSync = rows.filter(row => norm(row.StatusCalculado) === "sem sync").length;
    const afetados = rows.filter(row => norm(row.StatusIntune) !== "compliant" || norm(row.StatusCalculado) === "sem sync");
    const detalhe = afetados.slice(0, 50).map(row =>
        "- " + (row.Device || "Sem device") +
        " | " + (row.Utilizador || "Sem utilizador") +
        " | " + (row.Tipo || "Sem tipo") +
        " | Intune: " + (row.StatusIntune || "-") +
        " | Calculado: " + (row.StatusCalculado || "-") +
        " | Último sync: " + (row.UltimoSync || "-")
    ).join("\n");

    return [
        "PEDIDO DE ANÁLISE - MICROSOFT INTUNE",
        "",
        "Data: " + new Date().toLocaleString("pt-PT"),
        "Total considerado: " + rows.length,
        "Não compliant: " + naoCompliant,
        "Sem sincronização: " + semSync,
        "Equipamentos com incidência: " + afetados.length,
        "",
        "Solicita-se análise dos equipamentos não compliant e/ou sem sincronização, identificação da causa e acompanhamento da regularização.",
        "",
        "DETALHE (máximo de 50 equipamentos):",
        detalhe || "Sem equipamentos com incidência nos resultados atuais."
    ].join("\n");
}

async function ibm2AbrirTicketGeral() {
    const popup = window.open("about:blank", "_blank");
    if (!popup) {
        ibm2SetStatus("O navegador bloqueou a abertura do ServiceNow. Autorize popups e tente novamente.", "error");
        return;
    }

    try { popup.opener = null; } catch (_) {}
    const texto = ibm2ResumoTicketGeral();

    try {
        await navigator.clipboard.writeText(texto);
        ibm2SetStatus("Resumo do ticket copiado. Cole-o no campo de descrição do ServiceNow.", "ok");
    }
    catch (_) {
        window.prompt("Copie o resumo abaixo e cole no ServiceNow:", texto);
        ibm2SetStatus("ServiceNow aberto. Copie o resumo apresentado para o pedido.", "");
    }

    popup.location.href = IBM2_SNOW_URL;
}

function ibm2IsNaoCompliant(row) {
    const st = String(row.StatusIntune || "").toLowerCase();
    const calc = String(row.StatusCalculado || "").toLowerCase();

    return st !== "compliant" || calc === "noncompliant" || calc === "sem sync";
}

function ibm2LoadNcPrefs() {
    const s = localStorage.getItem("ibm2NcSubject");
    const t = localStorage.getItem("ibm2NcTemplate");

    if (s && document.getElementById("ibm2NcSubject")) {
        document.getElementById("ibm2NcSubject").value = s;
    }

    if (t && document.getElementById("ibm2NcTemplate")) {
        document.getElementById("ibm2NcTemplate").value = t;
    }
}

function ibm2SaveNcPrefs() {
    const s = document.getElementById("ibm2NcSubject")?.value || "";
    const t = document.getElementById("ibm2NcTemplate")?.value || "";

    localStorage.setItem("ibm2NcSubject", s);
    localStorage.setItem("ibm2NcTemplate", t);
}

function ibm2FiltrarNaoCompliant() {
    document.querySelectorAll("input[name='ibm2StatusFilter']").forEach(x => {
        x.checked = ["noncompliant", "inGracePeriod", "unknown", "configManager"].includes(x.value);
    });

    document.querySelectorAll("input[name='ibm2StatusCalcFilter']").forEach(x => {
        x.checked = ["Sem Sync"].includes(x.value);
    });

    ibm2ApplyFilters();
}

function ibm2BuildDeviceText(row) {
    return [
        "Utilizador: " + (row.Utilizador || ""),
        "Nome: " + (row.Nome || ""),
        "Email: " + (row.Email || ""),
        "Device: " + (row.Device || ""),
        "Tipo: " + (row.Tipo || ""),
        "Plataforma: " + (row.Plataforma || ""),
        "Versão: " + (row.Versao || ""),
        "Status Intune: " + (row.StatusIntune || ""),
        "Status Calculado: " + (row.StatusCalculado || ""),
        "Último Sync: " + (row.UltimoSync || ""),
        "Dias sem Sync: " + (row.DiasSemSync ?? ""),
        "Fabricante: " + (row.Fabricante || ""),
        "Modelo: " + (row.Modelo || ""),
        "Serial Number: " + (row.SerialNumber || ""),
        "IMEI: " + (row.IMEI || ""),
        "ManagedDeviceId: " + (row.ManagedDeviceId || ""),
        "AzureADDeviceId: " + (row.AzureADDeviceId || "")
    ].join("\n");
}

function ibm2BuildUserEmailHtml(row) {
    const nome = row.Nome || row.Utilizador || "Utilizador";
    const device = row.Device || "";
    const tipo = row.Tipo || "";
    const modelo = row.Modelo || "";
    const fabricante = row.Fabricante || "";
    const status = row.StatusIntune || "";
    const statusCalc = row.StatusCalculado || "";
    const ultimoSync = row.UltimoSync || "";
    const dias = row.DiasSemSync ?? "";
    const serial = row.SerialNumber || "";
    const snow = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7&sysparm_category=6f044c7c1b1945505ae05532604bcb04";

    return `
<html>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2937;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 0;">
<tr><td align="center">

<table width="760" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
<tr>
<td style="background:#262626;color:#ffffff;padding:24px 30px;border-bottom:5px solid #e40000;">
    <div style="font-size:24px;font-weight:800;">Santander</div>
    <div style="font-size:15px;color:#e5e7eb;margin-top:4px;">Ação necessária · Equipamento não compliant no Intune</div>
</td>
</tr>

<tr>
<td style="padding:28px 30px 10px 30px;">
    <div style="font-size:18px;font-weight:700;margin-bottom:12px;">${ibm2Saudacao()} ${ibm2Escape(nome)},</div>
    <div style="font-size:14px;line-height:1.7;color:#374151;">
        Identificámos que o equipamento abaixo encontra-se <b>não compliant</b> ou sem sincronização válida no Microsoft Intune.
    </div>
</td>
</tr>

<tr>
<td style="padding:14px 30px;">
    <div style="border:1px solid #fee2e2;background:#fff5f5;border-radius:12px;padding:18px;">
        <div style="font-size:13px;color:#991b1b;font-weight:700;">Aviso importante</div>
        <div style="font-size:15px;line-height:1.6;margin-top:8px;color:#7f1d1d;">
            Caso a situação não seja regularizada ou justificada através de ticket, o equipamento poderá ser
            <b>removido da plataforma do banco após 24 horas</b>.
        </div>
    </div>
</td>
</tr>

<tr>
<td style="padding:10px 30px 18px 30px;">
    <div style="font-size:16px;font-weight:700;margin-bottom:12px;">Dados do equipamento</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;font-size:13px;">
        <tr style="background:#f9fafb;"><td style="padding:11px;font-weight:700;width:190px;">Device</td><td style="padding:11px;">${ibm2Escape(device)}</td></tr>
        <tr><td style="padding:11px;border-top:1px solid #e5e7eb;font-weight:700;">Tipo</td><td style="padding:11px;border-top:1px solid #e5e7eb;">${ibm2Escape(tipo)}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:11px;border-top:1px solid #e5e7eb;font-weight:700;">Modelo</td><td style="padding:11px;border-top:1px solid #e5e7eb;">${ibm2Escape(fabricante)} ${ibm2Escape(modelo)}</td></tr>
        <tr><td style="padding:11px;border-top:1px solid #e5e7eb;font-weight:700;">Status</td><td style="padding:11px;border-top:1px solid #e5e7eb;color:#e40000;font-weight:700;">${ibm2Escape(status)} / ${ibm2Escape(statusCalc)}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:11px;border-top:1px solid #e5e7eb;font-weight:700;">Último Sync</td><td style="padding:11px;border-top:1px solid #e5e7eb;">${ibm2Escape(ultimoSync)}</td></tr>
        <tr><td style="padding:11px;border-top:1px solid #e5e7eb;font-weight:700;">Dias sem Sync</td><td style="padding:11px;border-top:1px solid #e5e7eb;">${ibm2Escape(dias)}</td></tr>
        <tr style="background:#f9fafb;"><td style="padding:11px;border-top:1px solid #e5e7eb;font-weight:700;">Serial</td><td style="padding:11px;border-top:1px solid #e5e7eb;">${ibm2Escape(serial)}</td></tr>
    </table>
</td>
</tr>

<tr>
<td style="padding:10px 30px 20px 30px;">
    <div style="font-size:16px;font-weight:700;margin-bottom:12px;">O que deve fazer</div>
    <ol style="font-size:14px;line-height:1.7;color:#374151;margin-top:0;">
        <li>Confirmar que o equipamento tem ligação à internet.</li>
        <li>Abrir a aplicação <b>Portal da Empresa / Intune</b>.</li>
        <li>Executar uma nova sincronização do equipamento.</li>
        <li>Verificar e corrigir ações pendentes indicadas pela aplicação.</li>
    </ol>
</td>
</tr>

<tr>
<td style="padding:0 30px 28px 30px;">
    <div style="background:#f9fafb;border-left:4px solid #e40000;padding:16px;border-radius:8px;font-size:14px;line-height:1.6;color:#4b5563;">
        Caso exista algum motivo para o equipamento não poder ser regularizado ou removido, deverá ser aberto um ticket no ServiceNow:<br><br>
        <a href="${snow}" style="display:inline-block;background:#c40018;color:#ffffff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:6px;">Abrir ticket ServiceNow</a>
    </div>
</td>
</tr>

<tr>
<td style="background:#f3f4f6;color:#6b7280;font-size:12px;padding:16px 30px;">
    Obrigado,<br>
    <b>User Action Required · IT Santander Portugal</b>
</td>
</tr>
</table>

</td></tr>
</table>
</body>
</html>
`;
}

async function ibm2EmailUtilizador(idx) {
    try {
        const row = window.ibm2Filtered[idx];

        if (!row) {
            alert("Linha não encontrada.");
            return;
        }

        const to = row.Email || row.Utilizador;

        if (!to) {
            alert("Este equipamento não tem email/utilizador associado.");
            return;
        }

        const subject = "Ação necessária - Regularização de equipamento no Intune";
        const html = ibm2BuildUserEmailHtml(row);

        ibm2SetLoading(true, "A preparar email ao utilizador...");

        const r = await ibm2Api("preparar-email", {
            to: to,
            cc: "",
            subject: subject,
            html: html
        });

        if (!r.success) {
            throw new Error(r.error || "Erro ao preparar email.");
        }

        const reg = await ibm2Api("registar-comunicado", {
            managedDeviceId: row.ManagedDeviceId,
            utilizador: row.Utilizador,
            email: to,
            device: row.Device,
            tipo: row.Tipo,
            statusIntune: row.StatusIntune,
            statusCalculado: row.StatusCalculado
        });

        if (!reg.success) {
            throw new Error(reg.error || "Email preparado, mas falhou o registo do comunicado.");
        }

        await ibm2AtualizarComunicadosERecarregar();

        ibm2SetStatus("Email preparado e comunicação registada para " + to + ". Aguardar 24h.", "ok");
    }
    catch (e) {
        ibm2SetStatus(e.message, "error");
        alert(e.message);
    }
    finally {
        ibm2SetLoading(false);
    }
}

async function ibm2AbrirServiceNow(idx) {
    const row = window.ibm2Filtered[idx];

    if (!row) {
        alert("Linha não encontrada.");
        return;
    }

    const details = ibm2BuildDeviceText(row);

    try {
        await navigator.clipboard.writeText(details);
        ibm2SetStatus("Dados copiados para a área de transferência. Cole no ticket ServiceNow.", "ok");
    }
    catch {
        ibm2SetStatus("Abra o ServiceNow e copie manualmente os dados da linha.", "error");
    }

    window.open(IBM2_SNOW_URL, "_blank");
}

setTimeout(ibm2LoadNcPrefs, 400);

document.addEventListener("input", function(e) {
    if (e.target && ["ibm2NcSubject", "ibm2NcTemplate"].includes(e.target.id)) {
        ibm2SaveNcPrefs();
    }
});

function ibm2LoadTestMailPrefs() {
    const saved = localStorage.getItem("ibm2TestMailTo") || "";
    const el = document.getElementById("ibm2TestMailTo");

    if (el) {
        el.value = saved;
    }
}

function ibm2SaveTestMailPrefs() {
    const value = document.getElementById("ibm2TestMailTo")?.value || "";
    localStorage.setItem("ibm2TestMailTo", value);
}

async function ibm2PrepararEmailTeste() {
    try {
        ibm2SaveTestMailPrefs();

        const to = document.getElementById("ibm2TestMailTo")?.value || "";

        if (!to.trim()) {
            alert("Preencha o destinatário de teste.");
            return;
        }

        const subject = "TESTE - " + ibm2DefaultSubject();
        const html = ibm2RelatorioHtmlEmail();

        ibm2SetLoading(true, "A preparar email de teste no Outlook...");

        const r = await ibm2Api("preparar-email", {
            to,
            cc: "",
            subject,
            html
        });

        if (!r.success) {
            throw new Error(r.error || "Erro ao preparar email de teste.");
        }

        ibm2SetStatus("Email de teste preparado no Outlook para " + to, "ok");
    }
    catch (e) {
        ibm2SetStatus(e.message, "error");
        alert(e.message);
    }
    finally {
        ibm2SetLoading(false);
    }
}

function ibm2PreviewRelatorioEmail() {
    try {
        const html = ibm2RelatorioHtmlEmail();
        const w = window.open("", "_blank");

        if (!w) {
            alert("O navegador bloqueou a janela de pré-visualização.");
            return;
        }

        w.document.open();
        w.document.write(html);
        w.document.close();
    }
    catch (e) {
        alert(e.message);
    }
}

setTimeout(ibm2LoadTestMailPrefs, 500);

document.addEventListener("input", function(e) {
    if (e.target && e.target.id === "ibm2TestMailTo") {
        ibm2SaveTestMailPrefs();
    }
});


async function ibm2VerComunicadosPendentes() {
    try {
        const r = await ibm2Api("comunicados", {});
        if (!r.success) return;

        const pendentes = (r.data || []).filter(x => x.DeveRemover === true);

        if (pendentes.length > 0) {
            ibm2SetStatus("Atenção: existem " + pendentes.length + " equipamento(s) comunicados há mais de 24h para remover.", "error");
            console.warn("Equipamentos para remover:", pendentes);
        }
    } catch {}
}

setTimeout(ibm2VerComunicadosPendentes, 1500);

window.ibm2Comunicados = [];

function ibm2Saudacao() {
    const h = new Date().getHours();
    const m = new Date().getMinutes();
    const total = h * 60 + m;

    if (total >= 1 && total <= 720) return "Bom dia";
    if (total >= 721 && total <= 1080) return "Boa tarde";
    return "Boa noite";
}

async function ibm2CarregarComunicados() {
    try {
        const r = await ibm2Api("comunicados", {});
        if (r && r.success) {
            window.ibm2Comunicados = r.data || [];
        }
    } catch {
        window.ibm2Comunicados = [];
    }
}

function ibm2GetComunicado(row) {
    return (window.ibm2Comunicados || []).find(x => x.ManagedDeviceId === row.ManagedDeviceId);
}

function ibm2StatusComunicado(row) {
    const c = ibm2GetComunicado(row);

    if (!c) return "";

    if (c.DeveRemover === true) {
        return `<span class="ibm2-remover">Remover após 24h</span>`;
    }

    return `<span class="ibm2-comunicado">Comunicado</span>`;
}

async function ibm2AtualizarComunicadosERecarregar() {
    await ibm2CarregarComunicados();
    ibm2RenderTable();

    const vencidos = (window.ibm2Comunicados || []).filter(x => x.DeveRemover === true);

    if (vencidos.length > 0) {
        ibm2SetStatus("Atenção: existem " + vencidos.length + " equipamento(s) comunicados há mais de 24h. Deve remover da plataforma.", "error");
    }
}


window.ibm2Comunicados = window.ibm2Comunicados || [];

function ibm2Saudacao() {
    const now = new Date();
    const total = now.getHours() * 60 + now.getMinutes();

    if (total >= 1 && total <= 720) return "Bom dia";
    if (total >= 721 && total <= 1080) return "Boa tarde";
    return "Boa noite";
}

async function ibm2CarregarComunicados() {
    try {
        const r = await ibm2Api("comunicados", {});
        if (r && r.success) {
            window.ibm2Comunicados = r.data || [];
        }
    } catch {
        window.ibm2Comunicados = [];
    }
}

function ibm2GetComunicado(row) {
    return (window.ibm2Comunicados || []).find(x => x.ManagedDeviceId === row.ManagedDeviceId);
}

function ibm2EstadoAcao(row) {
    const c = ibm2GetComunicado(row);

    if (!c) return "";

    return c.EstadoAcao || c.Status || "";
}

function ibm2EstadoAcaoHtml(row) {
    const estado = ibm2EstadoAcao(row);

    if (!estado) {
        return "";
    }

    if (estado === "Aguardar 24h" || estado === "Comunicado") {
        return `<span class="ibm2-state-pill ibm2-state-wait">🟡 Aguardar 24h</span>`;
    }

    if (estado === "Pronto para Remover") {
        return `<span class="ibm2-state-pill ibm2-state-remove">🔴 Remover</span>`;
    }

    if (estado === "Regularizado") {
        return `<span class="ibm2-state-pill ibm2-state-ok">🟢 Regularizado</span>`;
    }

    if (estado === "Removido") {
        return `<span class="ibm2-state-pill ibm2-state-removed">⚫ Removido</span>`;
    }

    return ibm2Escape(estado);
}

async function ibm2AtualizarComunicadosERecarregar() {
    await ibm2CarregarComunicados();
    ibm2RenderTable();

    const prontos = (window.ibm2Comunicados || []).filter(x => x.EstadoAcao === "Pronto para Remover" || x.DeveRemover === true);

    if (prontos.length > 0) {
        ibm2SetStatus("Atenção: existem " + prontos.length + " equipamento(s) comunicados há mais de 24h. Deve remover da plataforma.", "error");
    }
}

async function ibm2MarcarRemovido(idx) {
    const row = window.ibm2Filtered[idx];

    if (!row) {
        alert("Linha não encontrada.");
        return;
    }

    if (!confirm("Confirmar que este equipamento foi removido da plataforma?")) {
        return;
    }

    const r = await ibm2Api("marcar-removido", {
        managedDeviceId: row.ManagedDeviceId
    });

    if (!r.success) {
        alert(r.error || "Erro ao marcar removido.");
        return;
    }

    await ibm2AtualizarComunicadosERecarregar();
}

async function ibm2MarcarRegularizado(idx) {
    const row = window.ibm2Filtered[idx];

    if (!row) {
        alert("Linha não encontrada.");
        return;
    }

    const r = await ibm2Api("marcar-regularizado", {
        managedDeviceId: row.ManagedDeviceId
    });

    if (!r.success) {
        alert(r.error || "Erro ao marcar regularizado.");
        return;
    }

    await ibm2AtualizarComunicadosERecarregar();
}

function ibm2IsNaoCompliant(row) {
    const st = String(row.StatusIntune || "").toLowerCase();
    const calc = String(row.StatusCalculado || "").toLowerCase();

    return st !== "compliant" || calc === "noncompliant" || calc === "sem sync";
}
