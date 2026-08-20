let devicesIntuneUltimoResultado = null;

function devicesIntuneSetStatus(tipo, mensagem) {
    const el = document.getElementById("devicesIntuneStatus");
    if (!el) return;

    let classe = "alert-info";
    if (tipo === "erro") classe = "alert-danger";
    if (tipo === "ok") classe = "alert-success";
    if (tipo === "aviso") classe = "alert-warning";

    el.innerHTML = `<div class="alert ${classe}">${mensagem}</div>`;
}

function devicesIntuneLimpar() {
    document.getElementById("devicesIntuneQuery").value = "";
    document.getElementById("devicesIntuneStatus").innerHTML = "";
    document.getElementById("devicesIntuneResumo").innerHTML = "";
    document.getElementById("devicesIntuneResultado").innerHTML = "";
    devicesIntuneUltimoResultado = null;
}

async function devicesIntunePesquisar() {

    const query = document.getElementById("devicesIntuneQuery").value.trim();

    if (!query) {
        devicesIntuneSetStatus("aviso", "Informe um utilizador, UPN, email, device name, serial number, IMEI ou Azure Device ID.");
        return;
    }

    devicesIntuneSetStatus("info", "A consultar dispositivos no Intune...");
    document.getElementById("devicesIntuneResumo").innerHTML = "";
    document.getElementById("devicesIntuneResultado").innerHTML = "";

    try {
        const url = `/module/devices-intune/api?action=search&query=${encodeURIComponent(query)}`;
        const response = await fetch(url);
        const text = await response.text();

        let json;
        try {
            json = JSON.parse(text);
        } catch (e) {
            devicesIntuneSetStatus("erro", "Erro ao interpretar resposta da API:<br><pre>" + escapeHtml(text) + "</pre>");
            return;
        }

        if (!json.success) {
            devicesIntuneSetStatus("erro", json.message || "Erro ao consultar dispositivos.");
            return;
        }

        devicesIntuneUltimoResultado = json;
        devicesIntuneRender(json);
        devicesIntuneSetStatus("ok", "Consulta concluída com sucesso.");

    } catch (ex) {
        devicesIntuneSetStatus("erro", "Erro no frontend: " + ex.message);
    }
}

function devicesIntuneRender(json) {

    const devices = json.devices || [];

    const total = devices.length;
    const compliant = devices.filter(d => String(d.complianceState).toLowerCase() === "compliant").length;
    const nonCompliant = devices.filter(d => String(d.complianceState).toLowerCase() === "noncompliant").length;
    const android = devices.filter(d => String(d.operatingSystem).toLowerCase().includes("android")).length;
    const ios = devices.filter(d => {
        const so = String(d.operatingSystem).toLowerCase();
        return so.includes("ios") || so.includes("iphone") || so.includes("ipad");
    }).length;
    const windows = devices.filter(d => String(d.operatingSystem).toLowerCase().includes("windows")).length;
    const macos = devices.filter(d => String(d.operatingSystem).toLowerCase().includes("mac")).length;
    const semSync30 = devices.filter(d => Number(d.diasSemSync || 0) > 30).length;

    document.getElementById("devicesIntuneResumo").innerHTML = `
        <div class="cards-grid">
            <div class="card kpi-card"><h3>Total</h3><div class="kpi">${total}</div></div>
            <div class="card kpi-card"><h3>Compliant</h3><div class="kpi">${compliant}</div></div>
            <div class="card kpi-card"><h3>Non Compliant</h3><div class="kpi">${nonCompliant}</div></div>
            <div class="card kpi-card"><h3>Android</h3><div class="kpi">${android}</div></div>
            <div class="card kpi-card"><h3>iOS/iPadOS</h3><div class="kpi">${ios}</div></div>
            <div class="card kpi-card"><h3>Windows</h3><div class="kpi">${windows}</div></div>
            <div class="card kpi-card"><h3>macOS</h3><div class="kpi">${macos}</div></div>
            <div class="card kpi-card"><h3>Sem Sync > 30d</h3><div class="kpi">${semSync30}</div></div>
        </div>
    `;

    let html = `
        <div class="card">
            <h3>Resultado</h3>
            <div class="table-wrapper">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Utilizador</th>
                            <th>UPN</th>
                            <th>Device</th>
                            <th>SO</th>
                            <th>Versão</th>
                            <th>Compliance</th>
                            <th>Management</th>
                            <th>Ownership</th>
                            <th>Fabricante</th>
                            <th>Modelo</th>
                            <th>Serial</th>
                            <th>IMEI</th>
                            <th>Último Sync</th>
                            <th>Dias Sem Sync</th>
                            <th>Encrypted</th>
                            <th>Supervised</th>
                            <th>Azure Device ID</th>
                            <th>Intune Device ID</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    devices.forEach(d => {
        html += `
            <tr>
                <td>${escapeHtml(d.userDisplayName)}</td>
                <td>${escapeHtml(d.userPrincipalName)}</td>
                <td>${escapeHtml(d.deviceName)}</td>
                <td>${escapeHtml(d.operatingSystem)}</td>
                <td>${escapeHtml(d.osVersion)}</td>
                <td>${escapeHtml(d.complianceState)}</td>
                <td>${escapeHtml(d.managementState)}</td>
                <td>${escapeHtml(d.ownerType)}</td>
                <td>${escapeHtml(d.manufacturer)}</td>
                <td>${escapeHtml(d.model)}</td>
                <td>${escapeHtml(d.serialNumber)}</td>
                <td>${escapeHtml(d.imei)}</td>
                <td>${escapeHtml(d.lastSyncDateTime)}</td>
                <td>${escapeHtml(d.diasSemSync)}</td>
                <td>${escapeHtml(d.isEncrypted)}</td>
                <td>${escapeHtml(d.isSupervised)}</td>
                <td>${escapeHtml(d.azureADDeviceId)}</td>
                <td>${escapeHtml(d.id)}</td>
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
}

function devicesIntuneExportCsv() {
    if (!devicesIntuneUltimoResultado || !devicesIntuneUltimoResultado.devices) {
        devicesIntuneSetStatus("aviso", "Não existem dados para exportar.");
        return;
    }

    const devices = devicesIntuneUltimoResultado.devices;

    const headers = [
        "UserDisplayName",
        "UserPrincipalName",
        "EmailAddress",
        "DeviceName",
        "OperatingSystem",
        "OsVersion",
        "ComplianceState",
        "ManagementState",
        "OwnerType",
        "EnrollmentType",
        "Manufacturer",
        "Model",
        "SerialNumber",
        "IMEI",
        "PhoneNumber",
        "LastSyncDateTime",
        "DiasSemSync",
        "IsEncrypted",
        "IsSupervised",
        "JailBroken",
        "AzureADDeviceId",
        "Id"
    ];

    let csv = headers.join(";") + "\n";

    devices.forEach(d => {
        csv += headers.map(h => csvEscape(d[lowerFirst(h)] ?? d[h] ?? "")).join(";") + "\n";
    });

    downloadTextFile("devices-intune.csv", csv, "text/csv;charset=utf-8");
}

function devicesIntuneExportHtml() {
    if (!devicesIntuneUltimoResultado || !devicesIntuneUltimoResultado.devices) {
        devicesIntuneSetStatus("aviso", "Não existem dados para exportar.");
        return;
    }

    const conteudo = document.getElementById("devicesIntuneResultado").innerHTML;

    const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Devices Intune</title>
<style>
body { font-family: Segoe UI, Arial, sans-serif; padding: 20px; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { border: 1px solid #ccc; padding: 6px; }
th { background: #f3f3f3; }
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

function lowerFirst(value) {
    if (!value) return value;
    return value.charAt(0).toLowerCase() + value.slice(1);
}
