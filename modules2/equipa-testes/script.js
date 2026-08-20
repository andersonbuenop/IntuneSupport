let equipaTestesData = null;

const ET_SN_URL = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7&sysparm_category=6f044c7c1b1945505ae05532604bcb04";

function etEscape(v) {
  return String(v ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function etMsg(text, type = "info") {
  const el = document.getElementById("etMsg");
  if (!el) return;
  el.innerHTML = `<div class="et-msg et-msg-${type}">${etEscape(text)}</div>`;
}

function etClearMsg() {
  const el = document.getElementById("etMsg");
  if (el) el.innerHTML = "";
}

function etProgress(percent, text) {
  const wrap = document.getElementById("etProgress");
  const bar = document.getElementById("etProgressBar");
  const label = document.getElementById("etProgressText");
  const pct = document.getElementById("etProgressPercent");
  if (!wrap || !bar || !label || !pct) return;

  const value = Math.max(0, Math.min(100, Number(percent || 0)));
  wrap.style.display = "block";
  bar.style.width = value + "%";
  label.innerText = text || "A processar...";
  pct.innerText = value + "%";
}

function etProgressHide(delay = 700) {
  const wrap = document.getElementById("etProgress");
  if (!wrap) return;
  setTimeout(() => wrap.style.display = "none", delay);
}

async function equipaTestesApi(action, payload = {}) {
  const url = `/module/equipa-testes/api?action=${encodeURIComponent(action)}&payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const response = await fetch(url);
  const text = await response.text();

  let json = JSON.parse(text);
  if (typeof json === "string") json = JSON.parse(json);
  return json;
}

function etTab(name, btn) {
  document.querySelectorAll(".et-tab-content").forEach(x => x.classList.remove("active"));
  document.querySelectorAll(".et-tabs button").forEach(x => x.classList.remove("active"));

  document.getElementById("tab-" + name)?.classList.add("active");
  btn?.classList.add("active");
}

async function equipaTestesStatus() {
  etProgress(25, "A verificar sessão Graph...");
  etMsg("A verificar sessão Graph/Intune...", "info");

  try {
    const json = await equipaTestesApi("status", {});
    etProgress(80, "A validar resposta...");

    if (json.success && json.graph && json.graph.connected) {
      etProgress(100, "Sessão ativa.");
      etProgressHide();
      etMsg("Graph/Intune conectado: " + (json.graph.account || ""), "ok");
    } else {
      etProgressHide();
      etMsg("Graph/Intune não conectado.", "err");
    }
  } catch(e) {
    etProgressHide();
    etMsg("Erro ao verificar sessão: " + e.message, "err");
  }
}

async function equipaTestesConectar() {
  etProgress(20, "A conectar Graph/Intune...");
  etMsg("A conectar Graph/Intune...", "info");

  try {
    const json = await equipaTestesApi("connect", {});
    etProgress(85, "A confirmar ligação...");

    if (!json.success) {
      etProgressHide();
      etMsg(json.message || "Erro ao conectar.", "err");
      return;
    }

    etProgress(100, "Graph/Intune conectado.");
    etProgressHide();
    etMsg("Graph/Intune conectado com sucesso. Conta: " + (json.graph?.account || ""), "ok");
  } catch(e) {
    etProgressHide();
    etMsg("Erro ao conectar Graph/Intune: " + e.message, "err");
  }
}

async function equipaTestesConsultar() {
  const user = document.getElementById("etUser")?.value.trim();

  if (!user) {
    etMsg("Informe um utilizador.", "err");
    return;
  }

  etClearMsg();
  etProgress(10, "A iniciar consulta...");
  document.getElementById("etResultado").style.display = "none";

  try {
    etProgress(30, "A consultar Entra ID...");
    const json = await equipaTestesApi("consultar", { user });

    etProgress(80, "A preparar dashboard...");

    if (!json.success) {
      etProgressHide();
      etMsg(json.message || "Erro na consulta.", "err");
      return;
    }

    equipaTestesData = json;
    equipaTestesRender(json);

    etProgress(100, "Consulta concluída.");
    etProgressHide();
    etMsg("Consulta concluída com sucesso.", "ok");

  } catch(e) {
    etProgressHide();
    etMsg("Erro na consulta: " + e.message, "err");
  }
}

function equipaTestesRender(data) {
  const u = data.user || {};
  const groups = data.groups || [];
  const devices = data.devices || [];

  const okGroups = groups.filter(g => g.isMember).length;
  const missing = groups.filter(g => !g.isMember && g.found).length;
  const compliant = devices.filter(d => String(d.complianceState || "").toLowerCase() === "compliant").length;
  const defender = devices.some(d => d.defenderInstalled);

  document.getElementById("etResultado").style.display = "block";

  document.getElementById("etUserName").innerText = u.displayName || "-";
  document.getElementById("etUserSub").innerText = `${u.userPrincipalName || "-"} • ${u.department || "Sem departamento"}`;

  document.getElementById("etUserBadges").innerHTML = `
    <span class="et-badge ${u.accountEnabled ? "et-badge-ok" : "et-badge-no"}">${u.accountEnabled ? "Conta Ativa" : "Conta Inativa"}</span>
    <span class="et-badge et-badge-neutral">${devices.length} dispositivo(s)</span>
    <span class="et-badge ${missing === 0 ? "et-badge-ok" : "et-badge-warn"}">${okGroups}/${groups.length} grupos</span>
  `;

  document.getElementById("etKpiGroups").innerText = `${okGroups}/${groups.length}`;
  document.getElementById("etKpiMissing").innerText = missing;
  document.getElementById("etKpiDevices").innerText = devices.length;
  document.getElementById("etKpiCompliant").innerText = compliant;
  document.getElementById("etKpiDefender").innerText = defender ? "OK" : "Pendente";

  document.getElementById("etUserInfo").innerHTML = `
    ${etInfo("Nome", u.displayName)}
    ${etInfo("UPN", u.userPrincipalName)}
    ${etInfo("Email", u.mail)}
    ${etInfo("Departamento", u.department)}
    ${etInfo("Cargo", u.jobTitle)}
    ${etInfo("Estado", u.accountEnabled ? "Ativo" : "Inativo")}
  `;

  renderGroups(groups, u);
  renderDevices(devices);
  renderResumo(data);
  renderTimeline(data);
  setTimeout(() => {
    if (typeof equipaTestesGerarRespostaTicket === "function") {
      equipaTestesGerarRespostaTicket();
    }
  }, 300);
}

function etInfo(label, value) {
  return `<div class="et-info"><label>${etEscape(label)}</label><div>${etEscape(value || "-")}</div></div>`;
}

function renderGroups(groups, user) {
  let rows = "";

  groups.forEach(g => {
    const status = g.isMember
      ? `<span class="et-badge et-badge-ok">Tem acesso</span>`
      : `<span class="et-badge et-badge-no">Sem acesso</span>`;

    const addBtn = (!g.isMember && g.found)
      ? `<button class="et-btn et-btn-success" onclick="equipaTestesAdicionarGrupo('${etEscape(g.id)}')">Adicionar</button>`
      : "";

    rows += `
      <tr>
        <td><strong>${etEscape(g.displayName)}</strong></td>
        <td>${status}</td>
        <td>
          ${addBtn}
          <button class="et-btn et-btn-secondary" onclick="equipaTestesAbrirServiceNow('${etEscape(g.displayName)}')">ServiceNow</button>
        </td>
      </tr>
    `;
  });

  document.getElementById("etGrupos").innerHTML = `
    <table class="et-table">
      <thead>
        <tr>
          <th>Grupo</th>
          <th>Estado</th>
          <th>Ação</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderDevices(devices) {
  if (!devices.length) {
    document.getElementById("etDevices").innerHTML = `<div class="et-msg et-msg-info">Nenhum telemóvel encontrado no Intune.</div>`;
    return;
  }

  let html = "";

  devices.forEach(d => {
    const compliant = String(d.complianceState || "").toLowerCase() === "compliant";

    html += `
      <div class="et-device">
        <h4>📱 ${etEscape(d.deviceName || "-")}</h4>
        <p>${etEscape(d.manufacturer || "-")} • ${etEscape(d.model || "-")}</p>

        <div class="et-badge-row" style="margin-bottom:12px;">
          <span class="et-badge ${compliant ? "et-badge-ok" : "et-badge-no"}">${etEscape(d.complianceState || "Sem estado")}</span>
          <span class="et-badge et-badge-neutral">${etEscape(d.operatingSystem || "-")}</span>
          <span class="et-badge ${d.defenderInstalled ? "et-badge-ok" : "et-badge-warn"}">${d.defenderInstalled ? "Defender OK" : "Defender pendente"}</span>
        </div>

        <div class="et-device-details">
          ${etDeviceField("Versão SO", d.osVersion)}
          ${etDeviceField("Último Sync", d.lastSyncDateTime)}
          ${etDeviceField("Serial", d.serialNumber)}
          ${etDeviceField("Defender", d.defenderMatch || "-")}
        </div>
      </div>
    `;
  });

  document.getElementById("etDevices").innerHTML = html;
}

function etDeviceField(label, value) {
  return `<div class="et-device-field"><label>${etEscape(label)}</label><div>${etEscape(value || "-")}</div></div>`;
}

function renderResumo(data) {
  const groups = data.groups || [];
  const devices = data.devices || [];

  const missing = groups.filter(g => !g.isMember && g.found);
  const compliant = devices.filter(d => String(d.complianceState || "").toLowerCase() === "compliant").length;

  let estado = "🟢 Utilizador preparado para testes.";
  let detalhes = "Todos os requisitos principais encontram-se cumpridos.";

  if (missing.length > 0 || devices.length === 0 || compliant < devices.length) {
    estado = "🟡 Utilizador ainda não está totalmente preparado.";
    detalhes = "";

    if (missing.length) {
      detalhes += `<p><strong>Grupos em falta:</strong> ${missing.map(x => etEscape(x.displayName)).join(", ")}</p>`;
    }

    if (devices.length === 0) {
      detalhes += `<p><strong>Intune:</strong> Nenhum telemóvel encontrado.</p>`;
    }

    if (devices.length > 0 && compliant < devices.length) {
      detalhes += `<p><strong>Compliance:</strong> Existe dispositivo não compliant.</p>`;
    }
  }

  document.getElementById("etResumoFinal").innerHTML = `
    <div class="et-msg ${missing.length ? "et-msg-info" : "et-msg-ok"}">
      <strong>${estado}</strong>
      <div style="margin-top:8px;">${detalhes}</div>
    </div>
  `;
}

function renderTimeline(data) {
  const now = new Date().toLocaleString();

  document.getElementById("etTimeline").innerHTML = `
    <div class="et-timeline-item"><strong>${now}</strong><br>Utilizador encontrado no Entra ID.</div>
    <div class="et-timeline-item">Grupos Azure validados.</div>
    <div class="et-timeline-item">Dispositivos Intune consultados.</div>
    <div class="et-timeline-item">Dashboard atualizado.</div>
  `;
}

async function equipaTestesAdicionarGrupo(groupId) {
  if (!equipaTestesData?.user?.id) {
    etMsg("Sem utilizador carregado.", "err");
    return;
  }

  if (!confirm("Adicionar este grupo ao utilizador?")) return;

  etProgress(30, "A adicionar grupo...");

  try {
    const json = await equipaTestesApi("addGroup", {
      userId: equipaTestesData.user.id,
      groupId
    });

    if (!json.success) {
      etProgressHide();
      etMsg(json.message || "Erro ao adicionar grupo.", "err");
      return;
    }

    etProgress(100, "Grupo adicionado.");
    etProgressHide();
    etMsg("Grupo adicionado com sucesso.", "ok");
    await equipaTestesConsultar();

  } catch(e) {
    etProgressHide();
    etMsg("Erro ao adicionar grupo: " + e.message, "err");
  }
}

async function equipaTestesAdicionarTodos() {
  if (!equipaTestesData?.user?.id) {
    etMsg("Sem utilizador carregado.", "err");
    return;
  }

  const missing = (equipaTestesData.groups || []).filter(g => !g.isMember && g.found);
  if (!missing.length) {
    etMsg("Não existem grupos em falta.", "ok");
    return;
  }

  if (!confirm(`Adicionar ${missing.length} grupo(s) em falta?`)) return;

  etProgress(20, "A adicionar grupos em falta...");

  try {
    const json = await equipaTestesApi("addMissingGroups", {
      userId: equipaTestesData.user.id,
      groups: missing.map(g => g.id)
    });

    if (!json.success) {
      etProgressHide();
      etMsg(json.message || "Erro ao adicionar grupos.", "err");
      return;
    }

    etProgress(100, "Grupos adicionados.");
    etProgressHide();
    etMsg("Grupos em falta adicionados com sucesso.", "ok");
    await equipaTestesConsultar();

  } catch(e) {
    etProgressHide();
    etMsg("Erro ao adicionar grupos: " + e.message, "err");
  }
}

async function equipaTestesPrepararUtilizador() {
  await equipaTestesAdicionarTodos();
}

function equipaTestesAbrirServiceNow(groupName) {
  const u = equipaTestesData?.user || {};

  const texto = [
    "Pedido/Registo de acesso - Equipa de Testes",
    "",
    "Utilizador: " + (u.displayName || "-"),
    "UPN: " + (u.userPrincipalName || "-"),
    "Email: " + (u.mail || "-"),
    "Departamento: " + (u.department || "-"),
    "",
    "Grupo/Acesso:",
    "- " + groupName,
    "",
    "Ação:",
    "Foi solicitado/registado o acesso do utilizador ao grupo indicado.",
    "",
    "Observações:",
    "Utilizador de testes One App. Validar também configuração do telemóvel no Intune e instalação do Microsoft Defender."
  ].join("\n");

  navigator.clipboard.writeText(texto).catch(() => {});

  const shortDesc = "Acesso Equipa de Testes - " + (u.userPrincipalName || "") + " - " + groupName;

  const url =
    ET_SN_URL +
    "&short_description=" + encodeURIComponent(shortDesc) +
    "&description=" + encodeURIComponent(texto);

  window.open(url, "_blank");

  etMsg("Texto do ServiceNow copiado. Basta colar no ticket se o campo não preencher automaticamente.", "ok");
}

function equipaTestesAbrirServiceNowCompleto() {
  const upn = equipaTestesData?.user?.userPrincipalName || "";
  const missing = (equipaTestesData?.groups || []).filter(g => !g.isMember).map(g => g.displayName).join(", ");
  const desc = `Pedido de acessos Equipa de Testes - ${upn} - ${missing || "Sem grupos em falta"}`;
  window.open(`${ET_SN_URL}&short_description=${encodeURIComponent(desc)}`, "_blank");
}

function equipaTestesResumoTexto() {
  if (!equipaTestesData) return "";

  const u = equipaTestesData.user || {};
  const missing = (equipaTestesData.groups || []).filter(g => !g.isMember).map(g => g.displayName);
  const devices = equipaTestesData.devices || [];

  return [
    "Resumo Equipa de Testes",
    "",
    "Utilizador: " + (u.displayName || "-"),
    "UPN: " + (u.userPrincipalName || "-"),
    "Email: " + (u.mail || "-"),
    "Departamento: " + (u.department || "-"),
    "",
    "Grupos em falta:",
    missing.length ? missing.map(x => "- " + x).join("\n") : "- Nenhum",
    "",
    "Dispositivos Intune: " + devices.length,
    devices.map(d => `- ${d.deviceName} | ${d.operatingSystem} ${d.osVersion} | ${d.complianceState}`).join("\n")
  ].join("\n");
}

async function equipaTestesCopiarResumo() {
  const text = equipaTestesResumoTexto();
  if (!text) {
    etMsg("Sem dados para copiar.", "err");
    return;
  }

  await navigator.clipboard.writeText(text);
  etMsg("Resumo copiado para a área de transferência.", "ok");
}

function equipaTestesExportCsv() {
  if (!equipaTestesData) {
    etMsg("Sem dados para exportar.", "err");
    return;
  }

  const u = equipaTestesData.user || {};
  const rows = [];

  (equipaTestesData.groups || []).forEach(g => {
    rows.push({
      Tipo: "Grupo",
      Utilizador: u.userPrincipalName,
      Nome: g.displayName,
      Estado: g.isMember ? "Tem acesso" : "Sem acesso",
      Extra: ""
    });
  });

  (equipaTestesData.devices || []).forEach(d => {
    rows.push({
      Tipo: "Device",
      Utilizador: u.userPrincipalName,
      Nome: d.deviceName,
      Estado: d.complianceState,
      Extra: `${d.operatingSystem} ${d.osVersion} ${d.model}`
    });
  });

  const headers = Object.keys(rows[0] || {});
  let csv = headers.join(";") + "\n";

  rows.forEach(r => {
    csv += headers.map(h => `"${String(r[h] ?? "").replaceAll('"','""')}"`).join(";") + "\n";
  });

  const blob = new Blob([csv], { type:"text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "equipa-testes.csv";
  a.click();
}

function equipaTestesGerarRespostaTicket() {
  if (!equipaTestesData) {
    etMsg("Sem dados carregados para gerar resposta.", "err");
    return;
  }

  const u = equipaTestesData.user || {};
  const groups = equipaTestesData.groups || [];
  const devices = equipaTestesData.devices || [];

  const nome = u.displayName || "Utilizador";
  const missingGroups = groups.filter(g => !g.isMember).map(g => g.displayName);
  const hasDevices = devices.length > 0;
  const defenderOk = devices.some(d => d.defenderInstalled);

  let texto = "";

  texto += `Boa tarde ${nome},\n\n`;
  texto += `Agradecemos a sua solicitação.\n\n`;

  if (missingGroups.length > 0) {
    texto += `Foram identificados acessos em falta para a Equipa de Testes/One App.\n\n`;
    texto += `Os seguintes grupos deverão estar atribuídos ao utilizador:\n\n`;
    missingGroups.forEach(g => {
      texto += `- ${g}\n`;
    });
    texto += `\n`;
  } else {
    texto += `Os grupos necessários para a Equipa de Testes/One App encontram-se atribuídos ao utilizador.\n\n`;
  }

  if (!hasDevices) {
    texto += `Não foi identificado qualquer telemóvel configurado no Intune para este utilizador.\n\n`;
    texto += `Após a atribuição dos acessos necessários, deverá aguardar até 24 horas para a sincronização entre os servidores em Portugal e Espanha.\n\n`;
    texto += `Após esse período, poderá proceder com a configuração do seu telemóvel, utilizando os manuais fornecidos em anexo, tendo sempre em conta o seu sistema operativo Android/iOS.\n\n`;
  } else {
    texto += `Foi identificado telemóvel configurado no Intune para este utilizador.\n\n`;
  }

  texto += `Para utilizadores de testes, além dos grupos de acesso, é obrigatório garantir que o Microsoft Defender da Microsoft está instalado e configurado no dispositivo.\n\n`;

  if (hasDevices && !defenderOk) {
    texto += `Neste momento, a instalação do Microsoft Defender não foi confirmada pelo Intune, pelo que deverá ser validada/configurada no equipamento.\n\n`;
  }

  texto += `Relativamente ao sistema operativo do seu dispositivo, deverá ter em conta que são apenas permitidos dispositivos com as seguintes versões mínimas:\n\n`;
  texto += `- Android 12 inclusive ou superior\n`;
  texto += `- iOS 18.6.2 inclusive ou superior\n\n`;

  texto += `De notar:\n\n`;
  texto += `- É importante que, depois da configuração do telemóvel, seja feita a configuração da aplicação Harmony.\n`;
  texto += `- É obrigatório instalar/configurar o Microsoft Defender da Microsoft no dispositivo.\n`;
  texto += `- Se possuir um equipamento Apple, deverá ter um PIN/password de, no mínimo, 6 caracteres.\n`;
  texto += `- Se possuir um equipamento Android, deverá ter um PIN/password de, no mínimo, 8 caracteres.\n\n`;

  texto += `Caso tenha alguma dúvida, pedimos que crie um novo pedido no ServiceNow, reportando as suas dificuldades.\n\n`;
  texto += `Link para abertura do pedido:\n`;
  texto += `https://santander.service-now.com/sp?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7\n\n`;

  texto += `Atentamente,\n`;
  texto += `Raphael Gomes Vieira`;

  const area = document.getElementById("etRespostaTicket");
  if (area) area.value = texto;

  etMsg("Resposta para fecho do ticket gerada.", "ok");
}

async function equipaTestesCopiarRespostaTicket() {
  const area = document.getElementById("etRespostaTicket");

  if (!area || !area.value.trim()) {
    equipaTestesGerarRespostaTicket();
  }

  const texto = document.getElementById("etRespostaTicket")?.value || "";

  if (!texto.trim()) {
    etMsg("Sem resposta para copiar.", "err");
    return;
  }

  await navigator.clipboard.writeText(texto);
  etMsg("Resposta copiada para a área de transferência.", "ok");
}


