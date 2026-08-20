let uxLastData = [];

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

    if (estado === "Expirado") {
        return `<span class="ux-badge danger">Expirado</span>`;
    }

    if (estado === "Expira hoje") {
        return `<span class="ux-badge warn">Expira hoje</span>`;
    }

    return `<span class="ux-badge ok">A expirar</span>`;
}

async function uxSearch() {
    const user = document.getElementById("uxUser").value.trim();
    const date = document.getElementById("uxDate").value;
    const dateFrom = document.getElementById("uxDateFrom").value;
    const dateTo = document.getElementById("uxDateTo").value;

    const body = {
        action: "search",
        user,
        date,
        dateFrom,
        dateTo
    };

    const tbody = document.getElementById("uxTableBody");
    const summary = document.getElementById("uxSummary");

    tbody.innerHTML = `<tr><td colspan="12" class="ux-empty">A consultar Active Directory...</td></tr>`;
    summary.style.display = "none";

    try {
        const response = await fetch("/module/utilizadores-expirar/api", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        const raw = await response.text();
        const result = JSON.parse(raw);

        if (!result.success) {
            throw new Error(result.message || "Erro desconhecido.");
        }

        uxLastData = result.data || [];

        summary.style.display = "block";
        summary.innerHTML = `Total encontrado: ${result.total || 0} utilizador(es) | Gerado em: ${uxEscape(result.generatedAt)}`;

        if (!uxLastData.length) {
            tbody.innerHTML = `<tr><td colspan="12" class="ux-empty">Nenhum utilizador encontrado com Account Expires para os filtros informados.</td></tr>`;
            return;
        }

        tbody.innerHTML = uxLastData.map(row => `
            <tr>
                <td>${uxEscape(row.Dominio)}</td>
                <td><b>${uxEscape(row.SamAccountName)}</b></td>
                <td>${uxEscape(row.Nome)}</td>
                <td>${uxEscape(row.UserPrincipalName)}</td>
                <td>${uxEscape(row.Email)}</td>
                <td>${row.Enabled ? "Ativo" : "Desativado"}</td>
                <td>${uxBadge(row)}<br>${uxEscape(row.AccountExpires)}</td>
                <td>${uxEscape(row.DiasParaExpirar)}</td>
                <td>${uxEscape(row.Departamento)}</td>
                <td>${uxEscape(row.Cargo)}</td>
                <td>${uxEscape(row.Manager)}</td>
                <td title="${uxEscape(row.DistinguishedName)}">${uxEscape(row.DistinguishedName)}</td>
            </tr>
        `).join("");

    } catch (err) {
        uxLastData = [];
        tbody.innerHTML = `<tr><td colspan="12" class="ux-empty">Erro: ${uxEscape(err.message)}</td></tr>`;
    }
}

function uxClear() {
    document.getElementById("uxUser").value = "";
    document.getElementById("uxDate").value = "";
    document.getElementById("uxDateFrom").value = "";
    document.getElementById("uxDateTo").value = "";
    document.getElementById("uxSummary").style.display = "none";
    document.getElementById("uxTableBody").innerHTML = `<tr><td colspan="12" class="ux-empty">Preencha os filtros e clique em Consultar.</td></tr>`;
    uxLastData = [];
}

function uxExportCsv() {
    if (!uxLastData.length) {
        alert("Não existem dados para exportar.");
        return;
    }

    const headers = [
        "Dominio",
        "SamAccountName",
        "Nome",
        "UserPrincipalName",
        "Email",
        "Enabled",
        "Estado",
        "AccountExpires",
        "DiasParaExpirar",
        "Departamento",
        "Cargo",
        "Manager",
        "CriadoEm",
        "DistinguishedName"
    ];

    const csv = [
        headers.join(";"),
        ...uxLastData.map(row => headers.map(h => {
            const value = row[h] ?? "";
            return `"${String(value).replaceAll('"', '""')}"`;
        }).join(";"))
    ].join("\r\n");

    const blob = new Blob(["\ufeff" + csv], {
        type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "utilizadores-a-expirar.csv";
    a.click();
    URL.revokeObjectURL(url);
}
