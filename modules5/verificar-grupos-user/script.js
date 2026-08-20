let vguUltimoResultado = null;
let vguGruposFiltrados = [];

async function vguConsultar() {
    const user = document.getElementById("vguUser").value.trim();

    if (!user) {
        vguMostrarMensagem("Informe o utilizador, UPN ou email.", "warning");
        return;
    }

    vguMostrarMensagem("A consultar grupos do utilizador...", "info");
    vguSetLoading(true);

    document.getElementById("vguResumo").style.display = "none";
    document.getElementById("vguResultado").style.display = "none";
    document.getElementById("vguUserInfo").style.display = "none";
    document.getElementById("vguFerramentas").style.display = "none";
    document.getElementById("vguTabelaBody").innerHTML = "";

    try {
        const url = "/module/verificar-grupos-user/api?action=consultar&user=" + encodeURIComponent(user);

        if (window.appDebugLog) {
            window.appDebugLog("API REQUEST", url);
        }

        const response = await fetch(url);
        const text = await response.text();

        if (window.appDebugLog) {
            window.appDebugLog("API RESPONSE", text);
        }

        let json = JSON.parse(text);

        if (typeof json === "string") {
            json = JSON.parse(json);
        }

        if (!json.success) {
            vguMostrarMensagem(json.message || "Erro ao consultar grupos.", "danger");
            return;
        }

        vguUltimoResultado = json.data;
        vguRender(json.data);
        vguMostrarMensagem("Consulta concluída com sucesso.", "success");

    } catch (error) {
        vguMostrarMensagem("Erro ao consultar grupos: " + error.message, "danger");
    } finally {
        vguSetLoading(false);
    }
}

async function vguConectarAzure() {
    vguMostrarMensagem("A abrir autenticação Azure / Entra ID via WAM...", "info");
    vguSetLoading(true);

    try {
        const url = "/api/graph/connect";

        if (window.appDebugLog) {
            window.appDebugLog("API REQUEST", url);
        }

        const response = await fetch(url, { method: "POST" });
        const text = await response.text();

        if (window.appDebugLog) {
            window.appDebugLog("API RESPONSE", text);
        }

        let json = JSON.parse(text);

        if (typeof json === "string") {
            json = JSON.parse(json);
        }

        if (!json.success && json.connected !== true) {
            vguMostrarMensagem(json.message || json.error || "Erro ao conectar ao Azure.", "danger");
            return;
        }

        vguMostrarMensagem("Conectado ao Azure / Entra ID com sucesso.", "success");

    } catch (error) {
        vguMostrarMensagem("Erro ao conectar Azure: " + error.message, "danger");
    } finally {
        vguSetLoading(false);
    }
}

function vguRender(data) {
    document.getElementById("vguResumo").style.display = "grid";
    document.getElementById("vguResultado").style.display = "block";
    document.getElementById("vguUserInfo").style.display = "block";
    document.getElementById("vguFerramentas").style.display = "block";

    document.getElementById("vguTotal").innerText = data.total || 0;
    document.getElementById("vguSecurity").innerText = data.security || 0;
    document.getElementById("vguM365").innerText = data.m365 || 0;
    document.getElementById("vguDistribution").innerText = data.distribution || 0;
    document.getElementById("vguMailSecurity").innerText = data.mailSecurity || 0;

    const userInfo = data.user || {};

    document.getElementById("vguUserInfoBody").innerHTML = `
        <div class="vgu-user-grid">
            <div class="vgu-user-item"><strong>Nome:</strong><br>${vguEscape(userInfo.displayName || "")}</div>
            <div class="vgu-user-item"><strong>UPN:</strong><br>${vguEscape(userInfo.userPrincipalName || "")}</div>
            <div class="vgu-user-item"><strong>Email:</strong><br>${vguEscape(userInfo.mail || "")}</div>
            <div class="vgu-user-item"><strong>ID:</strong><br>${vguEscape(userInfo.id || "")}</div>
        </div>
    `;

    document.getElementById("vguFiltroTexto").value = "";
    document.getElementById("vguFiltroTipo").value = "";

    vguAplicarFiltros();
}

function vguAplicarFiltros() {
    if (!vguUltimoResultado || !vguUltimoResultado.groups) {
        return;
    }

    const texto = document.getElementById("vguFiltroTexto").value.trim().toLowerCase();
    const tipo = document.getElementById("vguFiltroTipo").value;

    vguGruposFiltrados = vguUltimoResultado.groups.filter(g => {
        const linha = [
            g.displayName || "",
            g.type || "",
            g.mail || "",
            g.id || ""
        ].join(" ").toLowerCase();

        const passaTexto = !texto || linha.includes(texto);
        const passaTipo = !tipo || g.type === tipo;

        return passaTexto && passaTipo;
    });

    vguRenderTabela(vguGruposFiltrados);
}

function vguRenderTabela(groups) {
    const tbody = document.getElementById("vguTabelaBody");
    const contador = document.getElementById("vguContadorTabela");

    tbody.innerHTML = "";

    contador.innerHTML = `
        A apresentar ${groups.length} de ${(vguUltimoResultado.groups || []).length} grupos.
    `;

    if (!groups || groups.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4">Nenhum grupo encontrado.</td></tr>`;
        return;
    }

    groups.forEach(g => {
        const tr = document.createElement("tr");

        tr.innerHTML = `
            <td>${vguEscape(g.displayName || "")}</td>
            <td>${vguTipoBadge(g.type || "")}</td>
            <td>${vguEscape(g.mail || "")}</td>
            <td>${vguEscape(g.id || "")}</td>
        `;

        tbody.appendChild(tr);
    });
}

function vguTipoBadge(tipo) {
    let classe = "vgu-badge";

    if (tipo === "Security") classe += " vgu-badge-security";
    if (tipo === "Microsoft 365") classe += " vgu-badge-m365";
    if (tipo === "Mail Enabled Security") classe += " vgu-badge-mail";
    if (tipo === "Distribution") classe += " vgu-badge-distribution";

    return `<span class="${classe}">${vguEscape(tipo)}</span>`;
}

function vguExportarCsv() {
    if (!vguUltimoResultado) {
        vguMostrarMensagem("Não há dados para exportar.", "warning");
        return;
    }

    const user = vguUltimoResultado.user || {};
    const groups = vguGruposFiltrados.length ? vguGruposFiltrados : (vguUltimoResultado.groups || []);

    const linhas = [];

    linhas.push([
        "Utilizador",
        "UPN",
        "Email Utilizador",
        "Grupo",
        "Tipo",
        "Email Grupo",
        "ID Grupo"
    ]);

    groups.forEach(g => {
        linhas.push([
            user.displayName || "",
            user.userPrincipalName || "",
            user.mail || "",
            g.displayName || "",
            g.type || "",
            g.mail || "",
            g.id || ""
        ]);
    });

    const csv = linhas.map(l => l.map(vguCsvEscape).join(";")).join("\r\n");
    const filename = vguNomeArquivo("grupos_user", "csv");

    vguDownloadArquivo(csv, filename, "text/csv;charset=utf-8;");
}

function vguExportarHtml() {
    if (!vguUltimoResultado) {
        vguMostrarMensagem("Não há dados para exportar.", "warning");
        return;
    }

    const user = vguUltimoResultado.user || {};
    const groups = vguGruposFiltrados.length ? vguGruposFiltrados : (vguUltimoResultado.groups || []);

    let rows = "";

    groups.forEach(g => {
        rows += `
            <tr>
                <td>${vguEscape(g.displayName || "")}</td>
                <td>${vguEscape(g.type || "")}</td>
                <td>${vguEscape(g.mail || "")}</td>
                <td>${vguEscape(g.id || "")}</td>
            </tr>
        `;
    });

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Relatório de Grupos - ${vguEscape(user.userPrincipalName || "")}</title>
<style>
body {
    font-family: Arial, sans-serif;
    margin: 30px;
    color: #222;
}
h1 {
    color: #b00000;
}
.summary {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 12px;
    margin: 20px 0;
}
.card {
    border-left: 5px solid #e00000;
    padding: 12px;
    background: #f8f8f8;
}
.card strong {
    display: block;
    font-size: 22px;
}
table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 20px;
}
th {
    background: #b00000;
    color: white;
    text-align: left;
}
td, th {
    border: 1px solid #ddd;
    padding: 8px;
}
tr:nth-child(even) {
    background: #f5f5f5;
}
.meta {
    margin-top: 10px;
    font-size: 13px;
    color: #555;
}
</style>
</head>
<body>

<h1>Relatório de Grupos de Acesso</h1>

<p><strong>Nome:</strong> ${vguEscape(user.displayName || "")}</p>
<p><strong>UPN:</strong> ${vguEscape(user.userPrincipalName || "")}</p>
<p><strong>Email:</strong> ${vguEscape(user.mail || "")}</p>
<p><strong>ID:</strong> ${vguEscape(user.id || "")}</p>

<div class="summary">
    <div class="card">Total<strong>${vguUltimoResultado.total || 0}</strong></div>
    <div class="card">Security<strong>${vguUltimoResultado.security || 0}</strong></div>
    <div class="card">Microsoft 365<strong>${vguUltimoResultado.m365 || 0}</strong></div>
    <div class="card">Mail Security<strong>${vguUltimoResultado.mailSecurity || 0}</strong></div>
    <div class="card">Distribution<strong>${vguUltimoResultado.distribution || 0}</strong></div>
</div>

<table>
    <thead>
        <tr>
            <th>Grupo</th>
            <th>Tipo</th>
            <th>Email</th>
            <th>ID</th>
        </tr>
    </thead>
    <tbody>
        ${rows}
    </tbody>
</table>

<div class="meta">
    Relatório gerado em ${new Date().toLocaleString()}.
</div>

</body>
</html>
`;

    const filename = vguNomeArquivo("grupos_user", "html");

    vguDownloadArquivo(html, filename, "text/html;charset=utf-8;");
}

async function vguCopiarGrupos() {
    if (!vguUltimoResultado) {
        vguMostrarMensagem("Não há dados para copiar.", "warning");
        return;
    }

    const groups = vguGruposFiltrados.length ? vguGruposFiltrados : (vguUltimoResultado.groups || []);

    const texto = groups.map(g => `${g.displayName || ""} | ${g.type || ""} | ${g.mail || ""}`).join("\n");

    try {
        await navigator.clipboard.writeText(texto);
        vguMostrarMensagem("Grupos copiados para a área de transferência.", "success");
    } catch {
        vguMostrarMensagem("Não foi possível copiar automaticamente.", "warning");
    }
}

function vguLimpar() {
    vguUltimoResultado = null;
    vguGruposFiltrados = [];

    document.getElementById("vguUser").value = "";
    document.getElementById("vguMensagem").innerHTML = "";
    document.getElementById("vguResumo").style.display = "none";
    document.getElementById("vguResultado").style.display = "none";
    document.getElementById("vguUserInfo").style.display = "none";
    document.getElementById("vguFerramentas").style.display = "none";
    document.getElementById("vguTabelaBody").innerHTML = "";
}

function vguMostrarMensagem(msg, tipo) {
    const div = document.getElementById("vguMensagem");

    div.innerHTML = `
        <div class="alert alert-${tipo}">
            ${vguEscape(msg)}
        </div>
    `;
}

function vguSetLoading(isLoading) {
    document.querySelectorAll(".verificar-grupos-user-page button").forEach(btn => {
        btn.disabled = isLoading;
    });
}

function vguCsvEscape(value) {
    value = String(value ?? "");
    value = value.replaceAll('"', '""');
    return `"${value}"`;
}

function vguDownloadArquivo(conteudo, filename, mime) {
    const blob = new Blob([conteudo], { type: mime });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}

function vguNomeArquivo(prefixo, ext) {
    const user = document.getElementById("vguUser").value.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    const data = new Date().toISOString().slice(0,19).replaceAll(":", "").replace("T", "_");

    return `${prefixo}_${user}_${data}.${ext}`;
}

function vguEscape(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
