
function etProgress(percent, text) {
  const box = document.getElementById("etProgressBox");
  const bar = document.getElementById("etProgressBar");
  const txt = document.getElementById("etProgressText");
  const pct = document.getElementById("etProgressPercent");

  if (!box || !bar) return;

  box.style.display = "block";
  bar.style.width = percent + "%";
  txt.innerText = text || "A processar...";
  pct.innerText = percent + "%";
}

function etProgressHide() {
  const box = document.getElementById("etProgressBox");
  if (box) box.style.display = "none";
}
const ET_SERVICENOW_URL = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7&sysparm_category=6f044c7c1b1945505ae05532604bcb04";

function etMsg(text, type = "ok") {
  const el = document.getElementById("etMsg");
  el.innerHTML = `<div class="et-msg ${type === "err" ? "et-msg-err" : "et-msg-ok"}">${text}</div>`;
}

function etClearMsg() {
  document.getElementById("etMsg").innerHTML = "";
}

async function equipaTestesApi(action, payload) {
  const url = `/module/equipa-testes/api?action=${encodeURIComponent(action)}&payload=${encodeURIComponent(JSON.stringify(payload || {}))}`;

  const res = await fetch(url, {
    method: "GET",
    cache: "no-store"
  });

  const txt = await res.text();

  try {
    return JSON.parse(txt);
  } catch(e) {
    throw new Error("Resposta inválida da API: " + txt);
  }
}

function etOpenServiceNow(groupName, upn) {
  const url = `${ET_SERVICENOW_URL}&short_description=${encodeURIComponent("Pedido de acesso - " + groupName + " - " + upn)}`;
  window.open(url, "_blank");
}

async function equipaTestesConsultar() {
  etClearMsg();

  const query = document.getElementById("etUser").value.trim();

  if (!query) {
    etMsg("Informe um utilizador.", "err");
    return;
  }

  document.getElementById("etResultado").style.display = "none";
  etProgress(15, "A iniciar consulta...");
  etMsg("A consultar utilizador, grupos Azure e Intune...");

  try {
    etProgress(35, "A validar utilizador no Entra ID...");
    const data = await equipaTestesApi("consultar", { user: query });
    etProgress(85, "A preparar resultados...");

    if (!data.success) {
      etMsg(data.message || "Erro na consulta.", "err");
      return;
    }

    renderEquipaTestes(data);
    etProgress(100, "Consulta concluída.");
    setTimeout(etProgressHide, 700);
    etClearMsg();

  } catch(e) {
    etProgressHide();
    etMsg(e.message, "err");
  }
}

function renderEquipaTestes(data) {
  document.getElementById("etResultado").style.display = "block";

  const u = data.user || {};

  document.getElementById("etUserInfo").innerHTML = `
    <div class="et-kv"><b>Nome</b><span>${u.displayName || "-"}</span></div>
    <div class="et-kv"><b>UPN</b><span>${u.userPrincipalName || "-"}</span></div>
    <div class="et-kv"><b>Email</b><span>${u.mail || "-"}</span></div>
    <div class="et-kv"><b>Account Enabled</b><span>${u.accountEnabled === true ? "Sim" : "Não"}</span></div>
    <div class="et-kv"><b>ID</b><span>${u.id || "-"}</span></div>
  `;

  const totalGroups = data.groups?.length || 0;
  const okGroups = (data.groups || []).filter(g => g.isMember).length;
  const devices = data.devices || [];
  const defenderOk = devices.some(d => d.defenderInstalled);

  document.getElementById("etResumo").innerHTML = `
    <div class="et-kv"><b>Grupos OK</b><span>${okGroups}/${totalGroups}</span></div>
    <div class="et-kv"><b>Telemóveis Intune</b><span>${devices.length}</span></div>
    <div class="et-kv"><b>MS Defender</b><span>${defenderOk ? "Encontrado" : "Não confirmado"}</span></div>
  `;

  let groupRows = "";

  for (const g of data.groups || []) {
    groupRows += `
      <tr>
        <td>${g.displayName}</td>
        <td>
          <span class="et-badge ${g.isMember ? "et-ok" : "et-no"}">
            ${g.isMember ? "Tem acesso" : "Sem acesso"}
          </span>
        </td>
        <td>
          ${g.isMember ? "" : `<button class="et-btn et-success" onclick="equipaTestesAdicionarGrupo('${g.id}', '${u.id}', '${g.displayName.replace(/'/g, "\\'")}')">Adicionar acesso</button>`}
          <button class="et-btn et-secondary" onclick="etOpenServiceNow('${g.displayName.replace(/'/g, "\\'")}', '${u.userPrincipalName}')">ServiceNow</button>
        </td>
      </tr>
    `;
  }

  document.getElementById("etGrupos").innerHTML = `
    <table class="et-table">
      <thead>
        <tr>
          <th>Grupo</th>
          <th>Estado</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>${groupRows}</tbody>
    </table>
  `;

  let deviceRows = "";

  if (!devices.length) {
    deviceRows = `
      <tr>
        <td colspan="7">Nenhum telemóvel encontrado no Intune para este utilizador.</td>
      </tr>
    `;
  } else {
    for (const d of devices) {
      deviceRows += `
        <tr>
          <td>${d.deviceName || "-"}</td>
          <td>${d.operatingSystem || "-"}</td>
          <td>${d.osVersion || "-"}</td>
          <td>${d.complianceState || "-"}</td>
          <td>${d.lastSyncDateTime || "-"}</td>
          <td>
            <span class="et-badge ${d.defenderInstalled ? "et-ok" : "et-no"}">
              ${d.defenderInstalled ? "Instalado" : "Não confirmado"}
            </span>
          </td>
          <td>${d.defenderMatch || "-"}</td>
        </tr>
      `;
    }
  }

  document.getElementById("etDevices").innerHTML = `
    <table class="et-table">
      <thead>
        <tr>
          <th>Device</th>
          <th>SO</th>
          <th>Versão</th>
          <th>Compliance</th>
          <th>Último Sync</th>
          <th>Defender</th>
          <th>Deteção</th>
        </tr>
      </thead>
      <tbody>${deviceRows}</tbody>
    </table>
  `;
}

async function equipaTestesAdicionarGrupo(groupId, userId, groupName) {
  if (!confirm(`Adicionar o utilizador ao grupo "${groupName}"?`)) {
    return;
  }

  etMsg("A adicionar acesso...");

  try {
    const data = await equipaTestesApi("addGroup", {
      groupId,
      userId
    });

    if (!data.success) {
      etMsg(data.message || "Erro ao adicionar acesso.", "err");
      return;
    }

    etMsg("Acesso adicionado com sucesso.");
    await equipaTestesConsultar();

  } catch(e) {
    etProgressHide();
    etMsg(e.message, "err");
  }
}




async function equipaTestesConectarGlobal() {
  etClearMsg();
  etProgress(20, "A conectar Graph/Intune...");

  try {
    etProgress(45, "A autenticar no Graph/Intune...");
    const res = await fetch("/module/devices-intune/api?action=connect");
    const text = await res.text();

    let json = JSON.parse(text);
    if (typeof json === "string") json = JSON.parse(json);

    etProgress(85, "A confirmar ligação...");

    if (!json.success) {
      etProgressHide();
      etMsg(json.message || "Erro ao conectar Graph/Intune.", "err");
      return;
    }

    const conta = json.graph && json.graph.account ? json.graph.account : "";
    etProgress(100, "Graph/Intune conectado.");
    setTimeout(etProgressHide, 700);
    etMsg("Graph/Intune conectado com sucesso. Conta: " + conta);

  } catch(e) {
    etProgressHide();
    etMsg("Erro ao conectar Graph/Intune: " + e.message, "err");
  }
}


