
window.vuCleanupOperationPanel = function () {
  const panel = document.getElementById("vuOperationPanel");
  if (panel) panel.remove();
};

window.addEventListener("beforeunload", window.vuCleanupOperationPanel);


function vuEnsureOperationPanel() {
  let panel = document.getElementById("vuOperationPanel");

  if (!panel) {
    panel = document.createElement("div");
    panel.id = "vuOperationPanel";
    panel.className = "vu-operation-panel";
    panel.innerHTML = `
      <div class="vu-operation-title" id="vuOperationTitle">Operação</div>
      <div class="vu-operation-user" id="vuOperationUser">Utilizador</div>
      <div class="vu-operation-step" id="vuOperationStep">A preparar...</div>
      <div class="vu-operation-bar">
        <div class="vu-operation-fill" id="vuOperationFill"></div>
      </div>
      <div class="vu-operation-percent" id="vuOperationPercent">0%</div>
    `;
    document.body.appendChild(panel);
  }

  return panel;
}

function vuOperationStart(title, user) {
  const panel = vuEnsureOperationPanel();

  panel.className = "vu-operation-panel show";

  document.getElementById("vuOperationTitle").textContent = "⚙️ " + (title || "Operação em curso");
  document.getElementById("vuOperationUser").textContent = user || "";
  vuOperationProgress(5, "A preparar operação...");
}

function vuOperationProgress(percent, step) {
  const panel = vuEnsureOperationPanel();
  panel.classList.add("show");

  const p = Math.max(0, Math.min(100, Number(percent) || 0));

  document.getElementById("vuOperationFill").style.width = p + "%";
  document.getElementById("vuOperationPercent").textContent = p + "%";
  document.getElementById("vuOperationStep").textContent = step || "A processar...";
}

function vuOperationSuccess(message) {
  const panel = vuEnsureOperationPanel();

  panel.className = "vu-operation-panel show success";
  vuOperationProgress(100, message || "Operação concluída com sucesso.");

  setTimeout(() => {
    vuOperationHide();
  }, 3500);
}

function vuOperationError(message) {
  const panel = vuEnsureOperationPanel();

  panel.className = "vu-operation-panel show error";
  vuOperationProgress(100, message || "Operação não concluída.");

  setTimeout(() => {
    vuOperationHide();
  }, 5000);
}

function vuOperationHide() {
  const panel = document.getElementById("vuOperationPanel");
  if (panel) {
    panel.classList.remove("show");
  }
}
window.vuUltimosResultados = [];
let vuUltimasNotas = [];

function vuParseUsers() {
  const single = document.getElementById("vuSingleUser")?.value.trim() || "";
  const list = document.getElementById("vuUserList")?.value.trim() || "";

  let users = [];

  if (single) users.push(single);

  if (list) {
    for (const linha of list.split(/\r?\n/)) {
      const clean = linha.trim();
      if (!clean) continue;

      const firstCol = clean.split(/\t|;|,/)[0].trim();
      const lower = firstCol.toLowerCase();

      if (!firstCol) continue;
      if (["utilizador", "user", "login", "samaccountname"].includes(lower)) continue;

      users.push(firstCol);
    }
  }

  return [...new Set(users)];
}

function vuSetStatus(type, title, detail) {
  const box = document.getElementById("vuStatusBox");
  const status = document.getElementById("vuStatus");
  const statusDetail = document.getElementById("vuStatusDetail");

  if (box) box.className = `vu-status ${type || "idle"}`;
  if (status) status.textContent = title || "";
  if (statusDetail) statusDetail.textContent = detail || "";
}

function vuSetProgress(percent, text) {
  const wrap = document.getElementById("vuProgressWrap");
  const fill = document.getElementById("vuProgressFill");
  const label = document.getElementById("vuProgressText");
  const pct = document.getElementById("vuProgressPercent");

  const p = Math.max(0, Math.min(100, Number(percent) || 0));

  if (wrap) wrap.style.display = "block";
  if (fill) fill.style.width = p + "%";
  if (label) label.textContent = text || "A processar...";
  if (pct) pct.textContent = p + "%";
}

function vuBool(v, yes = "Sim", no = "Não") {
  return v
    ? `<span class="vu-pill ok">✓ ${yes}</span>`
    : `<span class="vu-pill bad">✕ ${no}</span>`;
}

function vuInitials(name, input) {
  const base = String(name || input || "?").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.substring(0, 2).toUpperCase();
}

async function vuVerificar() {
  const users = vuParseUsers();

  if (!users.length) {
    vuSetStatus("err", "Nenhum utilizador informado.", "Informe um utilizador ou cole uma lista do Excel.");
    return;
  }

  vuSetStatus("idle", `A verificar ${users.length} utilizador(es)...`, "A preparar pedido.");
  vuSetProgress(10, "A preparar pedido...");

  try {
    const payload = {
      action: "verificar",
      users: users
    };

    vuSetProgress(25, "A enviar pedido para a API...");

    const encodedPayload = encodeURIComponent(JSON.stringify(payload));
    const response = await fetch(`/module/verificacao-utilizadores/api?action=verificar&payload=${encodedPayload}`, {
      method: "GET",
      cache: "no-store"
    });

    vuSetProgress(60, "A receber resposta...");
    const txt = await response.text();

    let data = JSON.parse(txt);
    if (typeof data === "string") data = JSON.parse(data);

    if (!data.ok) {
      vuSetStatus("err", "Erro na API.", data.error || "Erro desconhecido.");
      document.getElementById("vuResultado").innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
      return;
    }

    vuSetProgress(85, "A montar resultados...");

    vuUltimasNotas = data.notes || [];
    window.vuUltimosResultados = data.results || [];

    vuRenderResultados();

    vuSetProgress(100, "Concluído.");
    vuSetStatus("ok", "Verificação concluída com sucesso.", `${window.vuUltimosResultados.length} resultado(s) encontrado(s).`);
  } catch (e) {
    vuSetStatus("err", "Erro frontend.", e.message);
  }
}

async function vuExecutarAcao(action, user, label) {
  if (!user) {
    alert("Utilizador inválido.");
    return;
  }

  vuSetStatus("idle", `A executar ação: ${label}`, user);
  vuOperationStart(label, user);
  vuSetProgress(15, "A preparar ação...");
  vuOperationProgress(15, "A preparar ação...");

  try {
    const payload = encodeURIComponent(JSON.stringify({
      action: action,
      user: user
    }));

    vuSetProgress(45, "A enviar pedido...");
    vuOperationProgress(45, "A enviar pedido para a API...");
    const response = await fetch(`/module/verificacao-utilizadores/api?action=${encodeURIComponent(action)}&payload=${payload}`, {
      method: "GET",
      cache: "no-store"
    });

    vuSetProgress(75, "A receber resposta...");
    vuOperationProgress(75, "A aguardar conclusão...");
    const txt = await response.text();

    let data = JSON.parse(txt);
    if (typeof data === "string") data = JSON.parse(data);

    if (!data.ok) {
      vuSetStatus("err", "Ação não concluída.", data.error || "Erro desconhecido.");
      vuOperationError(data.error || "Erro desconhecido.");
      alert(data.error || "Erro desconhecido.");
      return;
    }

    vuSetProgress(100, "Ação concluída.");
    vuOperationSuccess(data.message || "Operação realizada.");
    vuSetStatus("ok", "Ação concluída.", data.message || "Operação realizada.");

    await vuVerificar();
  } catch (e) {
    vuSetStatus("err", "Erro ao executar ação.", e.message);
    vuOperationError(e.message);
    alert(e.message);
  }
}


function vuTextoServiceNow(r) {
  return [
    "Verificação de Utilizador - Santander Support Web",
    "",
    `Utilizador pesquisado: ${r.input || "-"}`,
    `Nome: ${r.displayName || "-"}`,
    `Utilizador resolvido: ${r.resolvedUser || "-"}`,
    "",
    "Resultado:",
    `AD Local: ${r.ad?.exists ? "Existe" : "Não existe"}`,
    `Domínio AD: ${r.ad?.domain || "-"}`,
    `Ativo AD: ${r.ad?.enabled ? "Sim" : "Não"}`,
    `Criado AD: ${r.ad?.created || "-"}`,
    `DN: ${r.ad?.dn || "-"}`,
    "",
    `Azure/Entra: ${r.azure?.exists ? "Existe" : "Não existe"}`,
    `Ativo Azure: ${r.azure?.enabled ? "Sim" : "Não"}`,
    `Criado Azure: ${r.azure?.created || "-"}`,
    `Última sincronização: ${r.azure?.lastSync || "-"}`,
    "",
    `Licença E3 / GR_PT_M365_E3: ${r.e3?.hasGroup ? "Sim" : "Não"}`,
    "",
    `Exchange Online: ${r.exo?.exists ? "Existe" : "Não existe"}`,
    `Tipo mailbox: ${r.exo?.recipientTypeDetails || "-"}`,
    `Arquivo Online: ${r.exo?.archiveEnabled ? "Ativo" : "Não ativo"}`,
    `Archive Status: ${r.exo?.archiveStatus || "-"}`,
    `Archive GUID: ${r.exo?.archiveGuid || "-"}`,
    "",
    `Diagnóstico: ${r.diagnostic || "-"}`
  ].join("\n");
}

async function vuAbrirServiceNow(index) {
  const r = window.vuUltimosResultados[index];

  if (!r) {
    alert("Resultado não encontrado.");
    return;
  }

  const texto = vuTextoServiceNow(r);

  try {
    await navigator.clipboard.writeText(texto);
    vuSetStatus("ok", "Texto copiado para o ServiceNow.", "Cole o conteúdo no campo de descrição do pedido.");
  } catch {
    vuSetStatus("warn", "Não foi possível copiar automaticamente.", "O ServiceNow será aberto, copie o resumo manualmente se necessário.");
  }

  window.open(
    "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bb85467db79c0d4f1024dc2ba961997&sysparm_category=93d369bedbf1a700ec3fa5305b96190a",
    "_blank"
  );
}

function vuRenderAcoes(r) {
  const user = r.resolvedUser || r.azure?.upn || r.ad?.upn || r.input;
  const safeUser = String(user || "").replace(/'/g, "\\'");

  const cards = [];

  if (r.ad?.exists && !r.azure?.exists) {
    cards.push(`
      <div class="vu-fix-card wait">
        <div class="vu-fix-icon">⏱</div>
        <div class="vu-fix-content">
          <strong>Aguardar sincronização</strong>
          <span>Existe no AD, mas ainda não existe no Azure. Se foi criado hoje, aguardar FIM amanhã às 08:00.</span>
        </div>
      </div>
    `);
  }

  if (r.azure?.exists && !r.e3?.hasGroup) {
    cards.push(`
      <button class="vu-fix-card action license" onclick="vuExecutarAcao('add-e3', '${safeUser}', 'Adicionar licença E3 / grupo GR_PT_M365_E3')">
        <div class="vu-fix-icon">💳</div>
        <div class="vu-fix-content">
          <strong>Adicionar licença E3</strong>
          <span>Adicionar ao grupo GR_PT_M365_E3</span>
        </div>
        <div class="vu-fix-arrow">→</div>
      </button>
    `);
  }

  if (r.exo?.exists && !r.exo?.archiveEnabled) {
    cards.push(`
      <button class="vu-fix-card action archive" onclick="vuExecutarAcao('enable-archive', '${safeUser}', 'Ativar Arquivo Online')">
        <div class="vu-fix-icon">🗄️</div>
        <div class="vu-fix-content">
          <strong>Ativar Arquivo Online</strong>
          <span>Executar Enable-Mailbox -Archive</span>
        </div>
        <div class="vu-fix-arrow">→</div>
      </button>
    `);
  }

  if (!cards.length) {
    cards.push(`
      <div class="vu-fix-card ok">
        <div class="vu-fix-icon">✓</div>
        <div class="vu-fix-content">
          <strong>Sem ações pendentes</strong>
          <span>Licença e arquivo não requerem correção.</span>
        </div>
      </div>
    `);
  }

  return `
    <div class="vu-fix-area">
      <div class="vu-fix-title">Ações corretivas</div>
      <div class="vu-fix-grid">
        ${cards.join("")}
      </div>
    </div>
  `;
}

function vuRenderResultados() {
  const container = document.getElementById("vuResultado");
  const filter = (document.getElementById("vuFilter")?.value || "").toLowerCase();

  let rows = window.vuUltimosResultados || [];

  if (filter) {
    rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(filter));
  }

  const total = window.vuUltimosResultados.length;
  const ad = window.vuUltimosResultados.filter(r => r.ad?.exists).length;
  const az = window.vuUltimosResultados.filter(r => r.azure?.exists).length;
  const exo = window.vuUltimosResultados.filter(r => r.exo?.exists).length;
  const e3 = window.vuUltimosResultados.filter(r => r.e3?.hasGroup).length;
  const archive = window.vuUltimosResultados.filter(r => r.exo?.archiveEnabled).length;

  document.getElementById("vuKpiTotal").textContent = total;
  document.getElementById("vuKpiAd").textContent = ad;
  document.getElementById("vuKpiAzure").textContent = az;
  document.getElementById("vuKpiExo").textContent = exo;
  document.getElementById("vuKpiE3").textContent = e3;
  document.getElementById("vuKpiArchive").textContent = archive;

  const resumo = document.getElementById("vuResumoSub");
  if (resumo) resumo.textContent = total ? `${total} resultado(s)` : "Aguardando consulta";

  const count = document.getElementById("vuResultCount");
  if (count) count.textContent = `${rows.length} resultado(s)`;

  const notes = document.getElementById("vuNotes");
  if (notes) {
    notes.innerHTML = vuUltimasNotas.length
      ? vuUltimasNotas.map(n => `✓ ${n}`).join("<br>")
      : "";
  }

  if (!rows.length) {
    container.className = "vu-results-empty";
    container.innerHTML = total ? "Nenhum resultado corresponde ao filtro." : "Nenhuma consulta executada.";
    return;
  }

  container.className = "vu-result-list";

  container.innerHTML = rows.map((r, idx) => {
    const nome = r.displayName || "-";
    const diag = r.diagnostic || "-";
    const healthy = diag.toLowerCase().includes("saudável");
    const diagClass = healthy ? "ok" : "warn";

    return `
      <article class="vu-user-card">
        <div class="vu-user-header">
          <div class="vu-user-left">
            <div class="vu-avatar">${vuInitials(nome, r.input)}</div>
            <div class="vu-user-title">
              <strong>${nome}</strong>
              <span>Input: ${r.input || "-"} • Resolvido: ${r.resolvedUser || "-"}</span>
            </div>
          </div>
          <div class="vu-diag">
            <span class="vu-pill ${diagClass}">${healthy ? "✓" : "!"} ${diag}</span>
          </div>
        </div>

        <div class="vu-detail-grid">
          <div class="vu-detail">
            <h4>AD Local</h4>
            ${vuBool(r.ad?.exists, "Existe", "Não existe")}
            <div class="vu-line"><b>Domínio:</b> ${r.ad?.domain || "-"}</div>
            <div class="vu-line"><b>SAM:</b> ${r.ad?.sam || "-"}</div>
            <div class="vu-line"><b>Criado:</b> ${r.ad?.created || "-"}</div>
            <div class="vu-line">${vuBool(r.ad?.enabled, "Ativo", "Inativo")}</div>
          </div>

          <div class="vu-detail">
            <h4>Azure / Entra</h4>
            ${vuBool(r.azure?.exists, "Existe", "Não existe")}
            <div class="vu-line"><b>UPN:</b> ${r.azure?.upn || "-"}</div>
            <div class="vu-line"><b>Criado:</b> ${r.azure?.created || "-"}</div>
            <div class="vu-line"><b>Última sync:</b> ${r.azure?.lastSync || "-"}</div>
            <div class="vu-line">${vuBool(r.azure?.enabled, "Ativo", "Inativo")}</div>
          </div>

          <div class="vu-detail">
            <h4>Licença E3</h4>
            ${vuBool(r.e3?.hasGroup, "Possui", "Não possui")}
            <div class="vu-line"><b>Grupo:</b> ${r.e3?.groupName || "GR_PT_M365_E3"}</div>
            <div class="vu-line"><b>Verificado:</b> ${r.e3?.checked ? "Sim" : "Não"}</div>
          </div>

          <div class="vu-detail">
            <h4>Exchange Online</h4>
            ${vuBool(r.exo?.exists, "Existe", "Não existe")}
            <div class="vu-line"><b>Tipo:</b> ${r.exo?.recipientTypeDetails || "-"}</div>
            <div class="vu-line"><b>Arquivo:</b> ${r.exo?.archiveEnabled ? "Ativo" : "Não ativo"}</div>
            <div class="vu-line"><b>Status:</b> ${r.exo?.archiveStatus || "-"}</div>
          </div>

          <div class="vu-detail">
            <h4>Identidade</h4>
            <div class="vu-line"><b>Mail AD:</b> ${r.ad?.mail || "-"}</div>
            <div class="vu-line"><b>Azure ID:</b> ${r.azure?.id || "-"}</div>
            <div class="vu-line"><b>Archive GUID:</b> ${r.exo?.archiveGuid || "-"}</div>
          </div>
        </div>

        ${vuRenderAcoes(r)}

        <div class="vu-servicenow-area">
          <button class="vu-servicenow-btn" onclick="vuAbrirServiceNow(${idx})">
            <span class="vu-servicenow-icon">📝</span>
            <span>
              <strong>Abrir ServiceNow</strong>
              <small>Copia o resumo da verificação e abre o pedido</small>
            </span>
            <b>→</b>
          </button>
        </div>

        <div class="vu-dn-box">
          <b>DN:</b> ${r.ad?.dn || "-"}
        </div>
      </article>
    `;
  }).join("");
}

function vuCsvEscape(value) {
  if (value === null || value === undefined) return '""';

  let text = String(value);
  text = text.replace(/\r?\n|\r/g, " ");
  text = text.replace(/\u00A0/g, " ");

  if (/^[=+\-@]/.test(text)) {
    text = "'" + text;
  }

  return '"' + text.replace(/"/g, '""') + '"';
}

function vuExportCsv() {
  if (!window.vuUltimosResultados.length) {
    alert("Sem resultados para exportar.");
    return;
  }

  const headers = [
    "Utilizador",
    "Nome",
    "AD Existe",
    "Dominio AD",
    "Ativo AD",
    "Azure Existe",
    "Ativo Azure",
    "Licenca E3",
    "EXO Existe",
    "Arquivo Online",
    "Criado AD",
    "Criado Azure",
    "UPN Azure",
    "Mail AD",
    "Tipo EXO",
    "Archive Status",
    "Archive GUID",
    "DN",
    "Diagnostico"
  ];

  const lines = [];
  lines.push(headers.map(vuCsvEscape).join(";"));

  for (const r of window.vuUltimosResultados) {
    lines.push([
      r.input || "",
      r.displayName || "",
      r.ad?.exists ? "Sim" : "Não",
      r.ad?.domain || "",
      r.ad?.enabled ? "Sim" : "Não",
      r.azure?.exists ? "Sim" : "Não",
      r.azure?.enabled ? "Sim" : "Não",
      r.e3?.hasGroup ? "Sim" : "Não",
      r.exo?.exists ? "Sim" : "Não",
      r.exo?.archiveEnabled ? "Sim" : "Não",
      r.ad?.created || "",
      r.azure?.created || "",
      r.azure?.upn || "",
      r.ad?.mail || "",
      r.exo?.recipientTypeDetails || "",
      r.exo?.archiveStatus || "",
      r.exo?.archiveGuid || "",
      r.ad?.dn || "",
      r.diagnostic || ""
    ].map(vuCsvEscape).join(";"));
  }

  const csvContent = "\uFEFF" + lines.join("\r\n");

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  const agora = new Date();
  const stamp = agora.toISOString().slice(0,19).replace(/[:T]/g, "-");

  a.href = url;
  a.download = `verificacao-utilizadores-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  URL.revokeObjectURL(url);
}

function vuCopiarResumo() {
  if (!window.vuUltimosResultados.length) {
    alert("Sem resultados para copiar.");
    return;
  }

  const texto = window.vuUltimosResultados.map(r =>
`${r.input} | ${r.displayName || "-"} | AD: ${r.ad?.exists} | Azure: ${r.azure?.exists} | E3: ${r.e3?.hasGroup} | EXO: ${r.exo?.exists} | Arquivo: ${r.exo?.archiveEnabled} | ${r.diagnostic}`
  ).join("\n");

  navigator.clipboard.writeText(texto);
  alert("Resumo copiado.");
}

function vuLimpar() {
  window.vuUltimosResultados = [];
  vuUltimasNotas = [];

  const single = document.getElementById("vuSingleUser");
  const list = document.getElementById("vuUserList");
  const filter = document.getElementById("vuFilter");

  if (single) single.value = "";
  if (list) list.value = "";
  if (filter) filter.value = "";

  vuSetStatus("idle", "Aguardando consulta.", "Informe um utilizador ou cole uma lista do Excel.");

  const progress = document.getElementById("vuProgressWrap");
  if (progress) progress.style.display = "none";

  vuRenderResultados();
}




