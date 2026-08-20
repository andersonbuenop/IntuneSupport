const samServiceNowUrl = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7&sysparm_category=6f044c7c1b1945505ae05532604bcb04";

function samShowLoading(title, text) {
  const overlay = document.getElementById("samLoadingOverlay");
  const titleEl = document.getElementById("samLoadingTitle");
  const textEl = document.getElementById("samLoadingText");

  if (!overlay) return;

  if (titleEl) titleEl.innerText = title || "A processar...";
  if (textEl) textEl.innerText = text || "Aguarde um momento.";

  overlay.style.display = "flex";
}

function samHideLoading() {
  const overlay = document.getElementById("samLoadingOverlay");
  if (overlay) overlay.style.display = "none";
}

function samTextoServiceNow(d) {
  return [
    "Pedido SAM - Dados do dispositivo",
    "",
    `Utilizador: ${d.User || ""}`,
    `Nome: ${d.Nome || ""}`,
    `Email: ${d.Email || ""}`,
    "",
    "Dispositivo:",
    `Modelo: ${d.Modelo || ""}`,
    `Sistema Operativo: ${d.SO || ""}`,
    `Versão: ${d.Versao || ""}`,
    `Compliance: ${d.Compliance || ""}`,
    `Último Sync: ${d.UltimoSync || ""}`,
    "",
    "Origem: Relatório SAM - Santander Support Web V2"
  ].join("\n");
}

async function samAbrirServiceNow(index) {
  const d = (window.samState.dados || [])[index];

  if (!d) {
    alert("Não foi possível obter os dados desta linha.");
    return;
  }

  const texto = samTextoServiceNow(d);

  let copied = false;
  try {
    await navigator.clipboard.writeText(texto);
    copied = true;
  } catch {}

  window.open(samServiceNowUrl, "_blank", "noopener,noreferrer");

  alert(copied
    ? "Dados do dispositivo copiados. Agora cole no pedido ServiceNow."
    : "O pedido ServiceNow foi aberto, mas não foi possível copiar os dados automaticamente.");
}

function samSetProgress(percent, text) {
  const wrap = document.getElementById("samProgressWrap");
  const bar = document.getElementById("samProgressBar");
  const label = document.getElementById("samProgressText");

  if (!wrap || !bar || !label) return;

  wrap.style.display = "block";
  label.style.display = "block";
  bar.style.width = `${percent}%`;
  label.innerText = text || `${percent}%`;
}

function samHideProgress(delay = 700) {
  setTimeout(() => {
    const wrap = document.getElementById("samProgressWrap");
    const bar = document.getElementById("samProgressBar");
    const label = document.getElementById("samProgressText");

    if (!wrap || !bar || !label) return;

    wrap.style.display = "none";
    label.style.display = "none";
    bar.style.width = "0%";
    label.innerText = "";
  }, delay);
}
window.samState = window.samState || {
  dados: [],
  dadosOriginais: [],
  report: "",
  reportHtml: ""
};

async function samApi(action, payload = {}) {
  const isRead = action === "get-config";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(`/module/relatorio-sam/api?action=${encodeURIComponent(action)}&_=${Date.now()}`, {
      method: isRead ? "GET" : "POST",
      cache: "no-store",
      headers: isRead ? undefined : { "Content-Type": "application/json" },
      body: isRead ? undefined : JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    let parsed = JSON.parse(text);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    if (!response.ok) throw new Error(parsed.message || parsed.error || `Erro HTTP ${response.status}.`);
    return parsed;
  } catch (error) {
    const message = error.name === "AbortError"
      ? "A operação excedeu o tempo limite de 120 segundos."
      : (error.message || "Erro de comunicação com o servidor.");
    return { success: false, message };
  } finally {
    clearTimeout(timeout);
  }
}

async function samInit() {
  const result = await samApi("get-config");

  if (result.success) {
    document.getElementById("samUsuarios").value = (result.usuariosSAM || []).join("\n");
    document.getElementById("samStatus").innerText = "Lista SAM carregada.";
  } else {
    document.getElementById("samStatus").innerText = result.message || "Erro ao carregar configuração.";
  }
}

async function samConnectGraph() {
  document.getElementById("samStatus").innerText = "A conectar ao Graph/Intune...";
  samShowLoading("A conectar ao Graph", "A validar sessão e permissões no Microsoft Graph...");
  samSetProgress(20, "A preparar módulos Microsoft Graph...");

  samSetProgress(45, "A abrir sessão Microsoft Graph...");
  const result = await samApi("connect-graph");
  samSetProgress(85, "A validar sessão Graph...");

  if (result.success) {
    document.getElementById("samStatus").innerText = result.message || "Graph conectado."; samHideLoading(); samSetProgress(100, "Graph conectado com sucesso."); samHideProgress();
  } else {
    document.getElementById("samStatus").innerText = result.message || "Erro ao conectar Graph.";
    samHideLoading(); alert(result.message || "Erro ao conectar Graph.");
    samHideProgress();
  }
}

async function samConsultarIntune() {
  const usuariosSAM = document.getElementById("samUsuarios").value
    .split(/\r?\n/)
    .map(x => x.trim().toUpperCase())
    .filter(Boolean);

  if (!usuariosSAM.length) {
    alert("Informe pelo menos um utilizador SAM.");
    return;
  }

  document.getElementById("samStatus").innerText = "A consultar Intune...";
  samShowLoading("A consultar Intune", "A obter e processar dispositivos dos utilizadores SAM...");
  samSetProgress(15, "A preparar consulta ao Intune...");

  samSetProgress(35, "A consultar dispositivos no Microsoft Intune...");
  const result = await samApi("consultar-intune", { usuariosSAM });
  samSetProgress(75, "A processar dispositivos encontrados...");

  if (!result.success) {
    document.getElementById("samStatus").innerText = result.message || "Erro ao consultar Intune.";
    samHideLoading(); alert(result.message || "Erro ao consultar Intune.");
    samHideProgress();
    return;
  }

  window.samState.dadosOriginais = result.dados || [];
  window.samState.dados = samFiltrarDados(window.samState.dadosOriginais);
  window.samState.report = samBuildPlainReport(window.samState.dados);
  window.samState.reportHtml = samBuildEmailHtml(window.samState.dados);

  samSetProgress(90, "A renderizar tabela e relatório...");
  samRenderTable();
  samRenderReport();
  samRenderKpis(samCalcularResumo(window.samState.dados));

  document.getElementById("samStatus").innerText =
    `Consulta concluída. ${window.samState.dados.length} dispositivo(s) encontrado(s).`;
  samHideLoading();
  samSetProgress(100, "Consulta concluída.");
  samHideProgress();
}

function samFiltrarDados(dados) {
  const filtro = document.getElementById("samFiltroTipo")?.value || "todos";

  return (dados || []).filter(d => {
    const so = String(d.SO || "").toLowerCase();
    const modelo = String(d.Modelo || "").toLowerCase();

    const isIOS = so.includes("ios") || modelo.includes("iphone") || modelo.includes("ipad");
    const isAndroid = so.includes("android");
    const isMac = so.includes("macos") || so.includes("mac os") || modelo.includes("macbook") || modelo.includes("imac");
    const isWindows = so.includes("windows");

    if (filtro === "todos") return true;

    if (filtro === "sam") {
      return isIOS || isAndroid || isMac;
    }

    if (filtro === "mobile") {
      return isIOS || isAndroid;
    }

    if (filtro === "apple") {
      return isIOS || isMac;
    }

    if (filtro === "windows") {
      return isWindows;
    }

    if (filtro === "mac") {
      return isMac;
    }

    if (filtro === "android") {
      return isAndroid;
    }

    if (filtro === "ios") {
      return isIOS;
    }

    return true;
  });
}

function samAplicarFiltro() {
  window.samState.dados = samFiltrarDados(window.samState.dadosOriginais || []);
  window.samState.report = samBuildPlainReport(window.samState.dados);
  window.samState.reportHtml = samBuildEmailHtml(window.samState.dados);
  samRenderTable();
  samRenderKpis(samCalcularResumo(window.samState.dados));
  samRenderReport();
}

function samCalcularResumo(dados) {
  dados = dados || [];

  const users = new Set(dados.map(d => d.User)).size;

  const mobile = dados.filter(d => {
    const so = String(d.SO || "").toLowerCase();
    const modelo = String(d.Modelo || "").toLowerCase();
    return so.includes("ios") || so.includes("android") || modelo.includes("iphone") || modelo.includes("ipad");
  }).length;

  const workstations = dados.filter(d => {
    const so = String(d.SO || "").toLowerCase();
    const modelo = String(d.Modelo || "").toLowerCase();
    return so.includes("windows") || so.includes("macos") || so.includes("mac os") || modelo.includes("macbook");
  }).length;

  return {
    users,
    devices: dados.length,
    mobile,
    workstations
  };
}

function samRenderTable() {
  const tbody = document.getElementById("samTableBody");
  const dados = window.samState.dados || [];

  if (!dados.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="sam-empty">Nenhum dispositivo encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = dados.map((d, index) => `
    <tr>
      <td>${samEscape(d.User)}</td>
      <td>${samEscape(d.Nome)}</td>
      <td>${samEscape(d.Email)}</td>
      <td>${samEscape(d.SO)}</td>
      <td>${samEscape(d.Modelo)}</td>
      <td>${samEscape(d.Versao)}</td>
      <td>${samEscape(d.Compliance)}</td>
      <td>${samEscape(d.UltimoSync)}</td>
      <td><button class="sam-action-btn" onclick="samAbrirServiceNow(${index})">ServiceNow</button></td>
    </tr>
  `).join("");
}

function samRenderReport() {
  document.getElementById("samReport").value = window.samState.report || "";
  const preview = document.getElementById("samReportHtml");
  if (preview) {
    preview.innerHTML = window.samState.reportHtml ||
      `<div class="sam-email-empty">Nenhum dispositivo encontrado para gerar o relatório.</div>`;
  }
}

function samGreeting() {
  const hour = new Date().getHours();
  if (hour <= 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function samDeviceType(device) {
  const os = String(device.SO || "").toLowerCase();
  const model = String(device.Modelo || "").toLowerCase();
  if (os.includes("ios") || os.includes("android") || model.includes("iphone") || model.includes("ipad")) return "Dispositivo móvel";
  if (os.includes("mac") || os.includes("windows") || model.includes("macbook") || model.includes("imac")) return "Estação de trabalho";
  return "Dispositivo";
}

function samBuildPlainReport(dados) {
  if (!dados?.length) return "";
  const users = new Map();
  dados.forEach(device => {
    const key = device.User || "Sem utilizador";
    if (!users.has(key)) users.set(key, []);
    users.get(key).push(device);
  });
  const lines = [
    `${samGreeting()},`, "",
    "De acordo com a solicitação, seguem as informações dos dispositivos SAM encontrados no Intune:", ""
  ];
  users.forEach((devices, user) => {
    lines.push(`Utilizador: ${user} - ${devices[0].Nome || ""}`);
    devices.forEach(d => lines.push(`  - ${samDeviceType(d)}: ${d.Modelo || "-"} (${d.SO || "-"}) - Versão: ${d.Versao || "-"} - Compliance: ${d.Compliance || "-"} - Último Sync: ${d.UltimoSync || "-"}`));
    lines.push("");
  });
  lines.push("Atenciosamente,", "IT Santander Portugal");
  return lines.join("\r\n");
}

function samBuildEmailHtml(dados) {
  if (!dados?.length) return "";
  const summary = samCalcularResumo(dados);
  const generated = new Date().toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
  const rows = dados.map(d => `
    <tr>
      <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;color:#24272b;font-weight:700;">${samEscape(d.User)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;color:#24272b;">${samEscape(d.Nome)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;color:#24272b;">${samEscape(d.Modelo)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;color:#24272b;">${samEscape(d.SO)} ${samEscape(d.Versao)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;color:#24272b;">${samEscape(d.Compliance)}</td>
      <td style="padding:9px 10px;border-bottom:1px solid #e5e7eb;color:#24272b;white-space:nowrap;">${samEscape(d.UltimoSync)}</td>
    </tr>`).join("");

  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:900px;border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;background:#ffffff;color:#24272b;">
    <tr><td bgcolor="#EC0000" style="background-color:#ec0000;padding:20px 26px;color:#ffffff !important;">
      <div style="font-size:11px;line-height:16px;text-transform:uppercase;letter-spacing:1px;color:#ffffff !important;">Santander Support Web V2</div>
      <div style="font-size:24px;line-height:32px;font-weight:700;color:#ffffff !important;">Relatório SAM</div>
      <div style="font-size:13px;line-height:20px;color:#ffffff !important;">Consulta de dispositivos no Microsoft Intune</div>
    </td></tr>
    <tr><td style="padding:24px 26px 12px;font-size:14px;line-height:21px;">
      <p style="margin:0 0 14px;">${samGreeting()},</p>
      <p style="margin:0;">De acordo com a solicitação, seguem as informações dos dispositivos SAM encontrados no Intune.</p>
    </td></tr>
    <tr><td style="padding:8px 26px 18px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;background:#f4f5f6;">
        <tr>
          <td align="center" style="padding:13px;border-right:1px solid #d8d8d8;"><strong style="font-size:22px;color:#ec0000;">${summary.users}</strong><br><span style="font-size:11px;color:#676c72;">Utilizadores</span></td>
          <td align="center" style="padding:13px;border-right:1px solid #d8d8d8;"><strong style="font-size:22px;color:#ec0000;">${summary.devices}</strong><br><span style="font-size:11px;color:#676c72;">Dispositivos</span></td>
          <td align="center" style="padding:13px;border-right:1px solid #d8d8d8;"><strong style="font-size:22px;color:#ec0000;">${summary.mobile}</strong><br><span style="font-size:11px;color:#676c72;">Mobile</span></td>
          <td align="center" style="padding:13px;"><strong style="font-size:22px;color:#ec0000;">${summary.workstations}</strong><br><span style="font-size:11px;color:#676c72;">Estações</span></td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:0 26px 22px;">
      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #d8d8d8;font-size:12px;">
        <thead><tr bgcolor="#24272B" style="background-color:#24272b;color:#ffffff !important;">
          <th align="left" style="padding:10px;color:#ffffff !important;">Utilizador</th><th align="left" style="padding:10px;color:#ffffff !important;">Nome</th><th align="left" style="padding:10px;color:#ffffff !important;">Modelo</th><th align="left" style="padding:10px;color:#ffffff !important;">Sistema</th><th align="left" style="padding:10px;color:#ffffff !important;">Compliance</th><th align="left" style="padding:10px;color:#ffffff !important;">Último Sync</th>
        </tr></thead><tbody>${rows}</tbody>
      </table>
    </td></tr>
    <tr><td style="padding:0 26px 24px;font-size:14px;line-height:20px;">
      <p style="margin:0 0 5px;">Atenciosamente,</p>
      <p style="margin:0;font-weight:700;">IT Santander Portugal</p>
    </td></tr>
    <tr><td style="background:#24272b;padding:12px 26px;color:#ffffff;font-size:10px;line-height:16px;">Mensagem gerada pelo Santander Support Web V2 · ${samEscape(generated)}</td></tr>
  </table>`;
}

async function samCopyHtmlReport() {
  const html = window.samState.reportHtml;
  const text = window.samState.report;
  if (!html) {
    alert("Ainda não existe relatório para copiar.");
    return;
  }

  try {
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      })]);
    } else {
      const holder = document.createElement("div");
      holder.contentEditable = "true";
      holder.style.position = "fixed";
      holder.style.left = "-10000px";
      holder.innerHTML = html;
      document.body.appendChild(holder);
      const range = document.createRange();
      range.selectNodeContents(holder);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (!document.execCommand("copy")) throw new Error("Falha ao copiar HTML.");
      selection.removeAllRanges();
      holder.remove();
    }
    alert("Relatório HTML copiado. Pode colá-lo diretamente na resposta do email.");
  } catch {
    alert("Não foi possível copiar o HTML. Utilize a versão em texto simples.");
  }
}

function samRenderKpis(summary) {
  summary = summary || {};
  document.getElementById("samKpiUsers").innerText = summary.users || 0;
  document.getElementById("samKpiDevices").innerText = summary.devices || 0;
  document.getElementById("samKpiMobile").innerText = summary.mobile || 0;
  document.getElementById("samKpiWorkstations").innerText = summary.workstations || 0;
}

async function samCopyReport() {
  if (!window.samState.report) {
    alert("Ainda não existe relatório para copiar.");
    return;
  }

  try {
    await navigator.clipboard.writeText(window.samState.report);
    alert("Relatório copiado.");
  } catch {
    alert("Não foi possível copiar automaticamente. Selecione o texto e copie-o manualmente.");
  }
}

function samExportCsv() {
  const dados = window.samState.dados || [];

  if (!dados.length) {
    alert("Ainda não existem dados para exportar.");
    return;
  }

  const headers = ["User", "Nome", "Email", "SO", "Modelo", "Versao", "Compliance", "UltimoSync"];
  const rows = dados.map(d =>
    headers.map(h => `"${String(d[h] || "").replaceAll('"', '""')}"`).join(";")
  );

  const csv = [headers.join(";"), ...rows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "Relatorio_SAM_Intune.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function samSaveUsers() {
  const usuariosSAM = document.getElementById("samUsuarios").value
    .split(/\r?\n/)
    .map(x => x.trim().toUpperCase())
    .filter(Boolean);

  samSetProgress(40, "A guardar lista SAM...");
  const result = await samApi("save-config", { usuariosSAM });
  samSetProgress(100, "Lista SAM guardada.");
  samHideProgress();

  if (result.success) {
    alert("Lista SAM guardada com sucesso.");
  } else {
    alert(result.message || "Erro ao guardar lista SAM.");
  }
}

function samEscape(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

setTimeout(samInit, 300);
