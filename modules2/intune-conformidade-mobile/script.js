/* PATCH V13.0.5 - LIFECYCLE PAYLOADS VIA POST */
/* PATCH V13.0.4 - SAFE LINE BASED NO RELOAD */

(() => {
  "use strict";

  const state = {
    rows: [],
    filtered: [],
    selected: null,
    filter: "all",
    connected: false,
    ticketQueue: null
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    search: $("icmSearch"),
    connect: $("icmConnect"),
    connectExchange: $("icmConnectExchange"),
    searchUser: $("icmSearchUser"),
    scan: $("icmScan"),
    openAllTickets: $("icmOpenAllTickets"),
    exportBtn: $("icmExport"),
    clear: $("icmClear"),
    tbody: $("icmTbody"),
    resultInfo: $("icmResultInfo"),
    progressWrap: $("icmProgressWrap"),
    progressText: $("icmProgressText"),
    progressPercent: $("icmProgressPercent"),
    progressBar: $("icmProgressBar"),
    connDot: $("icmConnDot"),
    connText: $("icmConnText"),
    detail: $("icmDetail"),
    emptyDetail: $("icmEmptyDetail"),
    toast: $("icmToast")
  };

  function apiUrl(action, payload) {
    const url = new URL("/module/intune-conformidade-mobile/api", window.location.origin);
    url.searchParams.set("action", action);
    if (payload !== undefined) {
      url.searchParams.set("payload", JSON.stringify(payload));
    }
    return url.toString();
  }

  async function api(action, payload, options = {}) {
    const method = options.method || (payload === undefined ? "GET" : "POST");
    const init = { method, headers: {} };

    if (method === "POST") {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(payload || {});
    }

    const response = await fetch(apiUrl(action, method === "GET" ? payload : undefined), init);
    const raw = await response.text();

    let data = raw;

    try {
      /*
       * O servidor pode devolver o objeto JSON diretamente ou uma string
       * contendo outro JSON. Fazemos parse até obter um objeto real.
       */
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (typeof data !== "string") {
          break;
        }

        const text = data.trim();

        if (!text) {
          data = {};
          break;
        }

        data = JSON.parse(text);
      }
    } catch (parseError) {
      console.error("Erro ao interpretar resposta da API:", {
        action,
        raw,
        parseError
      });

      throw new Error(raw || `Erro HTTP ${response.status}`);
    }

    if (!data || typeof data !== "object") {
      throw new Error(`Resposta inválida recebida na ação ${action}.`);
    }

    if (!response.ok || data.success === false) {
      throw new Error(data.message || `Erro HTTP ${response.status}`);
    }

    return data;
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => els.toast.classList.remove("show"), 2800);
  }

  function setBusy(busy, text = "A processar...", percent = 0) {
    [els.connect, els.searchUser, els.scan, els.exportBtn, els.clear].forEach(btn => btn.disabled = busy);
    els.progressWrap.classList.toggle("hidden", !busy);

    if (busy) {
      els.progressText.textContent = text;
      els.progressPercent.textContent = `${percent}%`;
      els.progressBar.style.width = `${percent}%`;
    }
  }

  function setProgress(text, current, total) {
    const percent = total ? Math.round((current / total) * 100) : 0;
    els.progressText.textContent = text;
    els.progressPercent.textContent = `${percent}%`;
    els.progressBar.style.width = `${percent}%`;
  }

  function normalizeState(value) {
    return String(value || "").toLowerCase();
  }

  function stateBadge(value) {
    const normalized = normalizeState(value);
    if (normalized === "ingraceperiod") return `<span class="icm-status grace">Em carência</span>`;
    if (normalized === "noncompliant") return `<span class="icm-status noncompliant">Não conforme</span>`;
    if (normalized === "compliant") return `<span class="icm-status compliant">Conforme</span>`;
    return `<span class="icm-status">${escapeHtml(value || "—")}</span>`;
  }

  function riskBadge(value) {
    const normalized = normalizeState(value);
    const cls = normalized === "alto" ? "high" : normalized === "médio" ? "medium" : "low";
    return `<span class="icm-risk ${cls}">${escapeHtml(value || "Baixo")}</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    if (!value) return "Não aplicável";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("pt-PT");
  }

  function applyFilter() {
    state.filtered = state.rows.filter(row => {
      switch (state.filter) {
        case "inGracePeriod":
          return normalizeState(row.complianceState) === "ingraceperiod";
        case "noncompliant":
          return normalizeState(row.complianceState) === "noncompliant";
        case "Harmony":
          return String(row.diagnosticCategory || "").toLowerCase().includes("harmony");
        case "harmonyIncomplete":
          return normalize(row.diagnosticCategory || "")
            .includes("harmony - configuracao incompleta");
        case "Android":
          return String(row.operatingSystem || "").toLowerCase().includes("android");
        case "iOS":
          return /ios|ipados/i.test(String(row.operatingSystem || ""));
        case "high":
          return normalizeState(row.risk) === "alto";
        case "preventive":
          return Boolean(row.isPreventiveAlert);
        case "removalImminent":
          return ["removalimminent", "readyforremoval"]
            .includes(normalizeState(row.preventiveStatus));
        default:
          return !row.hiddenReconciliationOnly;
      }
    });

    renderTable();
    updateTicketQueueButton();
  }

  function updateDashboard() {
    const rows = state.rows;
    const now = Date.now();
    const in48h = rows.filter(row => {
      if (!row.graceExpiration) return false;
      const expires = new Date(row.graceExpiration).getTime();
      return expires >= now && expires <= now + 48 * 60 * 60 * 1000;
    }).length;

    $("icmCountTotal").textContent = rows.length;
    $("icmCountGrace").textContent = rows.filter(r => normalizeState(r.complianceState) === "ingraceperiod").length;
    $("icmCountNoncompliant").textContent = rows.filter(r => normalizeState(r.complianceState) === "noncompliant").length;
    $("icmCountHigh").textContent = rows.filter(r => normalizeState(r.risk) === "alto").length;
    $("icmCountHarmony").textContent = rows.filter(r => String(r.diagnosticCategory || "").toLowerCase().includes("harmony")).length;
    $("icmCount48h").textContent = in48h;

    const preventiveRows = rows.filter(r => Boolean(r.isPreventiveAlert));
    const imminentRows = preventiveRows.filter(r =>
      normalizeState(r.preventiveStatus) === "removalimminent"
    );

    const preventiveCount = $("icmCountPreventive");
    const imminentCount = $("icmCountRemovalImminent");

    if (preventiveCount) preventiveCount.textContent = preventiveRows.length;
    if (imminentCount) imminentCount.textContent = imminentRows.length;
  }

  function renderTable() {
    els.tbody.innerHTML = "";

    if (!state.filtered.length) {
      els.tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:35px;color:#667085">Nenhum dispositivo encontrado.</td></tr>`;
      els.resultInfo.textContent = "Nenhum resultado";
      return;
    }

    els.resultInfo.textContent = `${state.filtered.length} dispositivo(s) apresentado(s)`;

    for (const row of state.filtered) {
      const tr = document.createElement("tr");
      tr.dataset.id = row.managedDeviceId;
      if (state.selected?.managedDeviceId === row.managedDeviceId) tr.classList.add("selected");

      tr.innerHTML = `
        <td>${riskBadge(row.risk)}</td>
        <td><strong>${escapeHtml(row.deviceName)}</strong></td>
        <td>${escapeHtml(row.userPrincipalName)}${row.absenceActive ? `<br><span style="display:inline-block;margin-top:4px;padding:3px 7px;border-radius:12px;background:#fff3cd;color:#7a4d00;font-size:11px;font-weight:700">Ausência/Férias${row.absenceEndAt ? ` · regresso ${escapeHtml(formatDate(row.absenceEndAt))}` : ''}</span>` : (!row.absenceChecked ? '<br><small style="color:#8a6d3b">Ausência/Férias não verificada</small>' : '')}</td>
        <td>${escapeHtml(`${row.operatingSystem || ""} ${row.osVersion || ""}`)}</td>
        <td>${escapeHtml(row.model || "—")}</td>
        <td>${stateBadge(row.complianceState)}</td>
        <td>${escapeHtml(formatDate(row.graceExpiration))}</td>
        <td>${escapeHtml(formatDate(row.lastSyncDateTime))}</td>
        <td>${escapeHtml(
          row.daysWithoutSync == null ? "—" : `${row.daysWithoutSync} dias`
        )}</td>
        <td>${escapeHtml(
          row.preventiveDeadlineAt
            ? `${formatDate(row.preventiveDeadlineAt)} (${row.preventiveDaysRemaining ?? 0} dia(s))`
            : "—"
        )}</td>
        <td>${escapeHtml(row.diagnosticCategory || "Conformidade Intune")}</td>
        <td>
          <button class="icm-btn icm-btn-light icm-row-open" data-id="${escapeHtml(row.managedDeviceId)}">Detalhes</button>
        </td>
      `;

      tr.addEventListener("click", () => selectRow(row));
      els.tbody.appendChild(tr);
    }
  }

  const serviceNowTicketUrl =
    "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7&sysparm_category=6f044c7c1b1945505ae05532604bcb04";

  function updateTicketQueueButton() {
    if (!els.openAllTickets) return;
    const count = state.filtered.length;
    els.openAllTickets.disabled = count === 0;
    els.openAllTickets.textContent = count
      ? `Abrir pedidos em sequência (${count})`
      : "Abrir pedidos em sequência";
  }

  function ticketQueueElements() {
    return {
      overlay: $("icmTicketQueueOverlay"),
      counter: $("icmTicketQueueCounter"),
      status: $("icmTicketQueueStatus"),
      bar: $("icmTicketQueueBar"),
      device: $("icmTicketQueueDevice"),
      user: $("icmTicketQueueUser"),
      help: $("icmTicketQueueHelp"),
      confirm: $("icmTicketQueueConfirm"),
      reopen: $("icmTicketQueueReopen"),
      skip: $("icmTicketQueueSkip")
    };
  }

  function currentTicketQueueRow() {
    const queue = state.ticketQueue;
    return queue && queue.index < queue.rows.length ? queue.rows[queue.index] : null;
  }

  function renderTicketQueue() {
    const queue = state.ticketQueue;
    const ui = ticketQueueElements();
    if (!queue || !ui.overlay) return;

    const row = currentTicketQueueRow();
    const total = queue.rows.length;
    const processed = Math.min(queue.index, total);
    const finished = !row;
    ui.counter.textContent = finished ? `${total} de ${total}` : `${queue.index + 1} de ${total}`;
    ui.status.textContent = finished
      ? `Concluído: ${queue.opened} aberto(s), ${queue.skipped} ignorado(s)`
      : `${queue.opened} aberto(s) · ${queue.skipped} ignorado(s)`;
    ui.bar.style.width = `${total ? Math.round((processed / total) * 100) : 0}%`;
    ui.device.textContent = row?.deviceName || "Processamento concluído";
    ui.user.textContent = row?.userPrincipalName || row?.email || "Não existem mais pedidos na fila.";
    ui.help.textContent = finished
      ? "A sequência terminou. Pode fechar esta janela ou iniciar uma nova sequência a partir dos resultados visíveis."
      : "O texto foi copiado e o formulário do ServiceNow foi aberto numa nova aba. Depois de abrir o pedido, volte a esta página e confirme para avançar.";
    ui.confirm.disabled = finished;
    ui.reopen.disabled = finished;
    ui.skip.disabled = finished;
  }

  function openCurrentTicket() {
    const row = currentTicketQueueRow();
    if (!row) {
      renderTicketQueue();
      return;
    }

    selectRow(row);
    window.open(serviceNowTicketUrl, "_blank", "noopener");
    navigator.clipboard.writeText(ticketText(row)).then(
      () => toast("Texto copiado. Preencha e abra o pedido no ServiceNow."),
      () => window.prompt("Copie o texto do pedido:", ticketText(row))
    );
    renderTicketQueue();
  }

  function startTicketQueue() {
    if (!state.filtered.length) {
      toast("Não existem dispositivos visíveis para abrir pedidos.");
      return;
    }

    const seen = new Set();
    const rows = state.filtered.filter(row => {
      const key = String(row.managedDeviceId || row.azureADDeviceId || `${row.userPrincipalName}|${row.deviceName}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    state.ticketQueue = { rows, index: 0, opened: 0, skipped: 0 };
    const overlay = $("icmTicketQueueOverlay");
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    openCurrentTicket();
  }

  function advanceTicketQueue(opened) {
    const queue = state.ticketQueue;
    if (!queue || !currentTicketQueueRow()) return;
    if (opened) queue.opened += 1;
    else queue.skipped += 1;
    queue.index += 1;
    renderTicketQueue();
    if (currentTicketQueueRow()) openCurrentTicket();
    else toast(`Sequência concluída: ${queue.opened} pedido(s) confirmado(s).`);
  }

  function closeTicketQueue() {
    const overlay = $("icmTicketQueueOverlay");
    overlay?.classList.remove("open");
    overlay?.setAttribute("aria-hidden", "true");
  }

  function listRecommendations(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map(x => x.trim())
      .filter(Boolean)
      .map(x => x.replace(/^\d+[\.\)]\s*/, "").replace(/^[-•]\s*/, ""));

    return `<ol>${lines.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ol>`;
  }

  function selectRow(row) {
    state.selected = row;
    renderTable();

    els.emptyDetail.classList.add("hidden");
    els.detail.classList.remove("hidden");

    $("icmDetailDevice").textContent = row.deviceName || "—";
    $("icmDetailUser").textContent = row.userPrincipalName || "—";
    $("icmDetailRisk").outerHTML = riskBadge(row.risk).replace("<span", `<span id="icmDetailRisk"`);

    $("icmInfoGrid").innerHTML = [
      ["Sistema", `${row.operatingSystem || ""} ${row.osVersion || ""}`],
      ["Modelo", row.model || "—"],
      ["Conformidade", row.complianceState || "—"],
      ["Fim da carência", formatDate(row.graceExpiration)],
      ["Último check-in", formatDate(row.lastSyncDateTime)],
      ["Dias sem sincronizar", row.daysWithoutSync == null ? "—" : `${row.daysWithoutSync} dias`],
      ["Data limite preventiva", formatDate(row.preventiveDeadlineAt)],
      ["Dias restantes", row.preventiveDaysRemaining == null ? "—" : `${row.preventiveDaysRemaining} dias`],
      ["Data de registo", formatDate(row.enrolledDateTime)],
      ["Azure AD Device ID", row.azureADDeviceId || "—"],
      ["Managed Device ID", row.managedDeviceId || "—"]
    ].map(([label, value]) => `
      <div class="icm-info-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
    `).join("");

    $("icmDetailCategory").textContent = row.diagnosticCategory || "Conformidade Intune";
    $("icmDetailDiagnosis").textContent = row.diagnosis || "Sem diagnóstico disponível.";

    $("icmPolicyList").innerHTML = (row.policyDetails || []).map(item => `
      <div class="icm-policy-row">
        <strong>${escapeHtml(item.translatedSetting || item.settingName || item.policyName)}</strong>
        <span>${escapeHtml(item.policyName)} · ${escapeHtml(item.settingState || item.policyState)}</span>
      </div>
    `).join("") || "<span>Sem detalhe devolvido pelo Graph.</span>";

    $("icmRecommendation").innerHTML = listRecommendations(row.recommendation);

    $("icmHistory").innerHTML = (row.history || []).slice().reverse().map(item => `
      <div class="icm-history-item">
        <span>${escapeHtml(formatDate(item.timestamp))}</span>
        <strong>${escapeHtml(item.complianceState)} · ${escapeHtml(item.diagnosticCategory || "")}</strong>
      </div>
    `).join("") || "<span>Sem histórico anterior.</span>";
  }

  async function connectGraph() {
    try {
      setBusy(true, "A ligar ao Microsoft Graph...", 20);
      const result = await api("connect", {});
      state.connected = true;
      els.connDot.classList.add("on");
      els.connText.textContent = `Ligado: ${result.account || "Microsoft Graph"}`;
      toast("Ligação ao Graph concluída.");
    } catch (error) {
      toast(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function runSearch(mode) {
    const search = els.search.value.trim();

    if (mode === "user" && !search) {
      toast("Informe um utilizador ou dispositivo.");
      return;
    }

    try {
      setBusy(true, "A consultar o Intune...", 10);

      const result = await api("scan", {
        mode,
        search
      });

      setProgress("A preparar resultados...", 90, 100);

      if (!result || typeof result !== "object") {
        throw new Error("A pesquisa devolveu uma resposta inválida.");
      }

      if (!Array.isArray(result.rows)) {
        console.error("Resposta scan sem array rows:", result);
        throw new Error(
          "A pesquisa terminou, mas os resultados não vieram no formato esperado."
        );
      }

      state.rows = result.rows;
      state.filtered = [];
      state.selected = null;

      updateDashboard();
      applyFilter();

      if (state.filtered.length > 0) {
        selectRow(state.filtered[0]);
      }

      console.log("Resultados Intune carregados:", {
        totalInformado: result.total,
        totalRecebido: state.rows.length,
        rows: state.rows
      });

      toast(`${state.rows.length} dispositivo(s) analisado(s).`);
    } catch (error) {
      toast(error.message);
    } finally {
      setBusy(false);
    }
  }

  function clearAll() {
    state.rows = [];
    state.filtered = [];
    state.selected = null;
    els.search.value = "";
    els.tbody.innerHTML = "";
    els.detail.classList.add("hidden");
    els.emptyDetail.classList.remove("hidden");
    updateDashboard();
    renderTable();
    updateTicketQueueButton();
  }

  function exportCsv() {
    if (!state.filtered.length) {
      toast("Não existem resultados para exportar.");
      return;
    }

    const headers = [
      "Risco","Dispositivo","Utilizador","SO","Versão","Modelo","Conformidade",
      "Fim da carência","Último check-in","Diagnóstico","Descrição","Recomendação",
      "Política/definição","Azure AD Device ID","Managed Device ID"
    ];

    const rows = state.filtered.map(row => [
      row.risk,row.deviceName,row.userPrincipalName,row.operatingSystem,row.osVersion,row.model,
      row.complianceState,row.graceExpiration,row.lastSyncDateTime,row.diagnosticCategory,
      row.diagnosis,row.recommendation,row.policySummary,row.azureADDeviceId,row.managedDeviceId
    ]);

    const csv = [headers, ...rows]
      .map(columns => columns.map(value => `"${String(value ?? "").replaceAll('"','""')}"`).join(";"))
      .join("\r\n");

    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Intune_Conformidade_Mobile_${new Date().toISOString().slice(0,19).replaceAll(":","")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function ticketText(row) {
    const policy = (row.policyDetails || [])
      .filter(x => /noncompliant|error|conflict|unknown/i.test(`${x.policyState} ${x.settingState}`))
      .map(x => `${x.policyName} > ${x.translatedSetting || x.settingName} [${x.settingState || x.policyState}]`)
      .join("\n");

    return `Utilizador: ${row.userPrincipalName}
Dispositivo: ${row.deviceName}
Sistema operativo: ${row.operatingSystem} ${row.osVersion}
Modelo: ${row.model}
Estado Intune: ${row.complianceState}
Fim do período de carência: ${formatDate(row.graceExpiration)}
Último check-in: ${formatDate(row.lastSyncDateTime)}

Diagnóstico:
${row.diagnosticCategory}
${row.diagnosis}

Política/definição:
${policy || row.policySummary}

Ação sugerida:
${row.recommendation}

Azure AD Device ID: ${row.azureADDeviceId}
Managed Device ID: ${row.managedDeviceId}`;
  }

  async function copyTicket() {
    if (!state.selected) return;
    await navigator.clipboard.writeText(ticketText(state.selected));
    toast("Texto do ticket copiado.");
  }

  function openServiceNow() {
    if (!state.selected) return;
    navigator.clipboard.writeText(ticketText(state.selected)).catch(() => {});
    window.open(
      serviceNowTicketUrl,
      "_blank",
      "noopener"
    );
  }

  function openIntune() {
    if (!state.selected) return;
    const id = encodeURIComponent(state.selected.managedDeviceId || "");
    window.open(`https://intune.microsoft.com/#view/Microsoft_Intune_Devices/DeviceSettingsMenu/~/overview/mdmDeviceId/${id}`, "_blank", "noopener");
  }

  document.querySelectorAll(".icm-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".icm-chip").forEach(x => x.classList.remove("active"));
      chip.classList.add("active");
      state.filter = chip.dataset.filter;
      applyFilter();
    });
  });

  els.connect.addEventListener("click", connectGraph);
  els.connectExchange?.addEventListener("click", async () => {
    try {
      els.connectExchange.disabled = true;
      els.connectExchange.textContent = "A ligar Exchange...";
      const result = await api("connectExchangeAbsence", {});
      els.connectExchange.textContent = result.connected ? "Exchange ligado" : "Conectar Exchange";
      toast(result.connected ? "Exchange Online ligado para verificar Ausência/Férias." : "Exchange Online não ligado.");
    } catch (error) {
      els.connectExchange.textContent = "Conectar Exchange";
      toast(error.message || "Falha ao ligar Exchange Online.");
    } finally { els.connectExchange.disabled = false; }
  });
  els.searchUser.addEventListener("click", () => runSearch("user"));
  els.scan.addEventListener("click", () => runSearch("allProblems"));
  els.openAllTickets?.addEventListener("click", startTicketQueue);
  els.exportBtn.addEventListener("click", exportCsv);
  els.clear.addEventListener("click", clearAll);
  els.search.addEventListener("keydown", event => {
    if (event.key === "Enter") runSearch("user");
  });

  $("icmCopyTicket").addEventListener("click", copyTicket);
  $("icmOpenServiceNow").addEventListener("click", openServiceNow);
  $("icmOpenIntune").addEventListener("click", openIntune);
  $("icmTicketQueueConfirm")?.addEventListener("click", () => advanceTicketQueue(true));
  $("icmTicketQueueSkip")?.addEventListener("click", () => advanceTicketQueue(false));
  $("icmTicketQueueReopen")?.addEventListener("click", openCurrentTicket);
  $("icmTicketQueueFinish")?.addEventListener("click", closeTicketQueue);
  $("icmTicketQueueClose")?.addEventListener("click", closeTicketQueue);
  $("icmTicketQueueOverlay")?.addEventListener("click", event => {
    if (event.target === $("icmTicketQueueOverlay")) closeTicketQueue();
  });

  api("status")
    .then(result => {
      if (result.connected) {
        state.connected = true;
        els.connDot.classList.add("on");
        els.connText.textContent = `Ligado: ${result.account || "Microsoft Graph"}`;
      }
    })
    .catch(() => {});

  api("exchangeAbsenceStatus")
    .then(result => { if (result.connected && els.connectExchange) els.connectExchange.textContent = "Exchange ligado"; })
    .catch(() => {});

  renderTable();
})();

/* BEGIN INTUNE MOBILE V12 */
(() => {
  'use strict';

  if (window.__intuneMobileV12Loaded) return;
  window.__intuneMobileV12Loaded = true;

  const API = '/module/intune-conformidade-mobile/api';
  const state = {
    rows: [],
    config: {
      notificationStartDays: 10,
      removalDays: 17,
      notificationIntervalDays: 2
    },
    selected: new Set(),
    sending: false
  };

  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const normalize = value => clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const escapeHtml = value => clean(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);

  function unwrap(value) {
    for (let depth = 0; depth < 8; depth += 1) {
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
          continue;
        } catch {
          break;
        }
      }

      if (Array.isArray(value) && value.length <= 4) {
        value =
          value.find(item => item && typeof item === 'object' && !Array.isArray(item)) ??
          value.find(item => typeof item === 'string') ??
          value[value.length - 1];
        continue;
      }

      break;
    }

    return value;
  }

  async function api(action, payload, method = payload === undefined ? 'GET' : 'POST') {
    const url = new URL(API, window.location.origin);
    url.searchParams.set('action', action);

    const init = {
      method,
      cache: 'no-store',
      headers: {}
    };

    if (payload !== undefined && method === 'GET') {
      url.searchParams.set('payload', JSON.stringify(payload));
    } else if (payload !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(payload);
    }

    const response = await fetch(url.pathname + url.search, init);
    const raw = await response.text();

    let data;
    try {
      data = unwrap(JSON.parse(raw));
    } catch {
      throw new Error(raw || `Erro HTTP ${response.status}`);
    }

    if (!response.ok || !data || data.success === false) {
      throw new Error(data?.message || `Erro HTTP ${response.status}`);
    }

    return data;
  }

  function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? clean(value)
      : date.toLocaleString('pt-PT');
  }

  function rememberRows(rows) {
    if (!Array.isArray(rows)) return;

    state.rows = rows.map(row => ({
      ...row,
      email: clean(row.email || row.userPrincipalName),
      userPrincipalName: clean(row.userPrincipalName || row.email),
      displayName: clean(row.displayName || row.userDisplayName),
      userDisplayName: clean(row.userDisplayName || row.displayName),
      managedDeviceId: clean(row.managedDeviceId || row.id),
      azureADDeviceId: clean(row.azureADDeviceId || row.azureAdDeviceId),
      serialNumber: clean(row.serialNumber),
      deviceName: clean(row.deviceName)
    }));

    window.__intuneMobileScanRows = state.rows;

    api('reconcileLifecycle', {
      rows: state.rows,
      fullScan: true
    }, 'POST').then(refreshLifecycle).catch(error => {
      console.error('V12: reconciliação automática:', error);
    });

    updateNotificationSummary();
    updateDynamicLabels();
  }

  function patchFetchForScan() {
    if (window.__intuneMobileV12FetchPatched) return;
    window.__intuneMobileV12FetchPatched = true;

    const previousFetch = window.fetch.bind(window);

    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : input?.url || '';
      const response = await previousFetch(input, init);

      if (
        url.includes('/module/intune-conformidade-mobile/api') &&
        /[?&]action=scan(?:&|$)/i.test(url)
      ) {
        try {
          const clone = response.clone();
          const parsed = unwrap(JSON.parse(await clone.text()));
          if (parsed && Array.isArray(parsed.rows)) {
            rememberRows(parsed.rows);
          }
        } catch (error) {
          console.error('V12: não foi possível guardar as linhas do scan.', error);
        }
      }

      return response;
    };
  }

  function lifecycleTypeOf(row) {
    return row.lifecycleType === 'Preventive30d' || row.isPreventiveAlert
      ? 'Preventive30d'
      : 'Grace24h';
  }

  function deviceKeyOf(row) {
    return clean(
      row.managedDeviceId ||
      row.id ||
      row.azureADDeviceId ||
      row.serialNumber ||
      `${row.userPrincipalName || row.email}|${row.deviceName}`
    ).toLowerCase();
  }

  function notifiable(row) {
    const email = clean(row.email || row.userPrincipalName);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;

    const compliance = normalize(row.complianceState);

    return (
      ['ingraceperiod', 'noncompliant'].includes(compliance) ||
      Boolean(row.isPreventiveAlert)
    );
  }

  function notificationRows() {
    return state.rows.filter(notifiable);
  }

  function rowKey(row) {
    return `${deviceKeyOf(row)}|${lifecycleTypeOf(row)}`;
  }

  function selectedRows() {
    return notificationRows().filter(row => state.selected.has(rowKey(row)));
  }

  function updateNotificationSummary() {
    const summary = $('imnSummary');
    if (!summary) return;

    const rows = notificationRows();
    const users = new Set(rows.map(row => normalize(row.email || row.userPrincipalName)));

    summary.textContent = rows.length
      ? `${users.size} utilizador(es); ${rows.length} equipamento(s) notificável(eis).`
      : 'Aguardando resultados da pesquisa.';
  }

  function renderNotificationList() {
    const list = $('imnList');
    if (!list) return;

    const rows = notificationRows();

    if (!rows.length) {
      list.innerHTML = '<div class="imn-empty">Nenhum equipamento notificável encontrado.</div>';
      return;
    }

    list.innerHTML = rows.map(row => {
      const key = rowKey(row);
      const preventive = lifecycleTypeOf(row) === 'Preventive30d';

      return `
        <div class="imn-row imn-v12-row">
          <div>
            <input type="checkbox"
                   data-v12-select="${escapeHtml(key)}"
                   ${state.selected.has(key) ? 'checked' : ''}>
          </div>
          <div>
            <strong>${escapeHtml(row.userDisplayName || row.displayName || row.email)}</strong><br>
            <small>${escapeHtml(row.email || row.userPrincipalName)}</small>
          </div>
          <div>
            <strong>${escapeHtml(row.deviceName || 'Equipamento')}</strong><br>
            <small>${preventive
              ? `Preventivo · ${escapeHtml(row.daysWithoutSync ?? '—')} dias sem comunicação`
              : escapeHtml(row.complianceState || 'Pendência Intune')}</small>
          </div>
          <div class="imn-status pending">Pendente</div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('[data-v12-select]').forEach(input => {
      input.addEventListener('change', () => {
        if (input.checked) state.selected.add(input.dataset.v12Select);
        else state.selected.delete(input.dataset.v12Select);
        updateSelectedButtons();
      });
    });

    updateSelectedButtons();
  }

  function updateSelectedButtons() {
    const count = selectedRows().length;
    const prepare = $('imnSendSelected');
    const direct = $('imnSendDirect');

    if (prepare) {
      prepare.textContent = count
        ? `Preparar selecionados no Outlook (${count})`
        : 'Preparar selecionados no Outlook';
    }

    if (direct) {
      direct.textContent = count
        ? `Enviar selecionados pelo Outlook (${count})`
        : 'Enviar selecionados pelo Outlook';
      direct.disabled = state.sending || count === 0;
    }
  }

  function openNotifications() {
    state.selected.clear();
    notificationRows().forEach(row => state.selected.add(rowKey(row)));
    renderNotificationList();

    $('imnOverlay')?.classList.add('open');
    $('imnOverlay')?.setAttribute('aria-hidden', 'false');
  }

  function closeNotifications() {
    if (state.sending) return;

    $('imnOverlay')?.classList.remove('open');
    $('imnOverlay')?.setAttribute('aria-hidden', 'true');
  }

  function preventiveInstructions(row) {
    if (row.absenceActive) {
      return [
        'Identificámos que se encontra atualmente em período de Ausência/Férias.',
        'Quando regressar, por favor, ligue o equipamento à Internet e proceda à respetiva atualização e sincronização.',
        'O prazo de regularização fica suspenso durante a ausência e será retomado após o regresso.',
        '', 'Para regularizar:', '1. Ligue o equipamento à Internet.',
        '2. Abra o Harmony Mobile e confirme que está ativo.',
        '3. Abra o Portal da Empresa e execute uma sincronização.'
      ].join('\n');
    }
    const remaining = Math.max(0, Number(row.preventiveDaysRemaining ?? 0));

    return [
      `Identificámos que o seu equipamento não comunica com a plataforma Microsoft Intune há ${row.daysWithoutSync} dias.`,
      `Dispõe de ${remaining === 1 ? '1 dia' : `${remaining} dias`} para regularizar a situação.`,
      '',
      'Para regularizar:',
      '1. Ligue o equipamento à Internet.',
      '2. Abra o Harmony Mobile e confirme que a aplicação está ativa e sem alertas.',
      '3. Abra o Portal da Empresa e execute uma sincronização.',
      '4. Mantenha o equipamento ligado durante alguns minutos.',
      '',
      `Data da última comunicação: ${formatDate(row.lastSyncDateTime)}`,
      `Data limite: ${formatDate(row.preventiveDeadlineAt)}`,
      '',
      'Caso a situação não seja regularizada dentro do prazo, o equipamento poderá ser removido da plataforma de gestão.'
    ].join('\n');
  }

  function complianceInstructions(row) {
    const category = normalize(row.diagnosticCategory || '');

    if (category.includes('harmony') &&
        category.includes('configuracao incompleta')) {
      return [
        'Foi identificado que a configuração do Harmony Mobile ainda não foi concluída no seu equipamento.',
        '',
        'Para regularizar:',
        '1. Abra a aplicação Harmony Mobile no equipamento.',
        '2. Conclua o registo ou a ativação apresentados pela aplicação.',
        '3. Aceite todas as permissões solicitadas pelo Harmony.',
        '4. Confirme que a aplicação indica que o equipamento está protegido e sem alertas.',
        '5. Mantenha o equipamento ligado à Internet e o Harmony aberto durante alguns minutos.',
        '6. Abra o Portal da Empresa e execute uma sincronização/verificação.',
        '7. Aguarde alguns minutos para a atualização do estado no Intune.',
        '',
        'Caso a situação se mantenha, responda a esta mensagem para que a equipa possa analisar a associação do equipamento.'
      ].join('\n');
    }

    return clean(
      row.recommendation ||
      $('imnInstructions')?.value ||
      'Abra o Harmony Mobile, confirme que a aplicação está ativa e sincronize o equipamento no Portal da Empresa.'
    );
  }

  function payloadOf(row, isTest) {
    const preventive = lifecycleTypeOf(row) === 'Preventive30d';
    const harmonyIncomplete =
      normalize(row.diagnosticCategory || '')
        .includes('harmony - configuracao incompleta');

    return {
      ...row,
      email: clean(row.email || row.userPrincipalName),
      displayName: clean(row.userDisplayName || row.displayName),
      lifecycleType: lifecycleTypeOf(row),
      harmonyIncomplete,
      urgentDeadlineHours: harmonyIncomplete ? 2 : null,
      problemDescription: preventive
        ? `O equipamento não comunica com o Microsoft Intune há ${row.daysWithoutSync ?? 'vários'} dias.`
        : clean(
            row.problemDescription ||
            row.diagnosis ||
            row.diagnosticCategory ||
            'Foi identificada uma pendência na configuração de segurança do equipamento móvel.'
          ),
      devicesSummary: clean(
        row.devicesSummary ||
        `${row.deviceName || 'Equipamento'} | Intune: ${row.complianceState || 'Não identificado'}`
      ),
      isTest,
      testRecipient: clean($('imnTestRecipient')?.value),
      subject: row.absenceActive
        ? 'Ação após o regresso - Regularização do equipamento móvel'
        : preventive
        ? 'Ação necessária - Equipamento sem comunicação com o Intune'
        : normalize(row.diagnosticCategory || '').includes('harmony') &&
          normalize(row.diagnosticCategory || '').includes('configuracao incompleta')
        ? 'Ação necessária - Concluir configuração do Harmony Mobile'
        : clean($('imnSubject')?.value),
      instructions: preventive
        ? preventiveInstructions(row)
        : complianceInstructions(row)
    };
  }

  async function sendOutlook(row, direct, isTest) {
    const action = direct
      ? 'sendOutlookNotification'
      : 'prepareOutlookNotification';

    return api(action, payloadOf(row, isTest));
  }

  function setNotificationProgress(done, total) {
    const wrapper = $('imnProgress');
    const bar = wrapper?.querySelector('div');

    if (!wrapper || !bar) return;

    wrapper.style.display = total ? 'block' : 'none';
    bar.style.width = total
      ? `${Math.round((done / total) * 100)}%`
      : '0%';
  }

  function logNotification(message) {
    const log = $('imnLog');
    if (!log) return;

    log.style.display = 'block';
    log.textContent += `${new Date().toLocaleTimeString()} ${message}\n`;
    log.scrollTop = log.scrollHeight;
  }

  async function prepareTest() {
    if (state.sending) return;

    const recipient = clean($('imnTestRecipient')?.value);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
      alert('Informe um destinatário de teste válido.');
      return;
    }

    const row = selectedRows()[0] || notificationRows()[0];
    if (!row) {
      alert('Não existem equipamentos para preparar o teste.');
      return;
    }

    state.sending = true;
    if ($('imnLog')) $('imnLog').textContent = '';
    setNotificationProgress(0, 1);

    try {
      await sendOutlook(row, false, true);
      setNotificationProgress(1, 1);
      logNotification('Teste aberto no Outlook.');
    } catch (error) {
      logNotification(`ERRO: ${error.message}`);
    } finally {
      state.sending = false;
      updateSelectedButtons();
    }
  }

  async function processSelected(direct) {
    if (state.sending) return;

    const rows = selectedRows();
    if (!rows.length) {
      alert('Selecione pelo menos um equipamento.');
      return;
    }

    if (direct && !confirm(
      `Confirma o envio automático de ${rows.length} mensagem(ns) pelo Outlook?`
    )) {
      return;
    }

    state.sending = true;
    if ($('imnLog')) $('imnLog').textContent = '';
    setNotificationProgress(0, rows.length);

    let ok = 0;
    let failed = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];

      try {
        await sendOutlook(row, direct, false);
        ok += 1;
        logNotification(`${direct ? 'Enviado' : 'Preparado'}: ${row.email} · ${row.deviceName}`);
      } catch (error) {
        failed += 1;
        logNotification(`ERRO ${row.email}: ${error.message}`);
      }

      setNotificationProgress(index + 1, rows.length);
    }

    logNotification(`Concluído. Sucesso: ${ok}; erros: ${failed}.`);
    state.sending = false;
    updateSelectedButtons();
    refreshLifecycle();
  }

  function statusMeta(status, preventive) {
    const map = preventive
      ? {
          PreAlert: ['Pré-alerta', 'impl-prealert'],
          RemovalImminent: ['Remoção iminente', 'impl-imminent'],
          ReadyForRemoval: ['Pronto para remover', 'impl-ready'],
          Regularized: ['Regularizado', 'impl-regularized'],
          PendingResolutionValidation: ['A validar resolução', 'impl-pending'],
          RemovedByUser: ['Removido pelo utilizador', 'impl-removed'],
          RemovedByTeam: ['Removido pela equipa', 'impl-removed']
        }
      : {
          Waiting: ['Dentro do prazo', 'iml-waiting'],
          ReadyToRemove: ['Pronto para remover', 'iml-ready'],
          Regularized: ['Regularizado', 'iml-regularized'],
          PendingResolutionValidation: ['A validar resolução', 'iml-missing'],
          RemovedByUser: ['Removido pelo utilizador', 'iml-removed-user'],
          RemovedByTeam: ['Removido pela equipa', 'iml-removed-team']
        };

    return map[status] || [clean(status) || '—', preventive ? 'impl-pending' : 'iml-notified'];
  }

  function lifecycleAction(item) {
    if (!['ReadyToRemove', 'PendingResolutionValidation'].includes(item.status)) {
      return '—';
    }

    return `
      <button type="button"
              class="iml-remove-btn"
              data-v12-status="RemovedByTeam"
              data-v12-key="${escapeHtml(item.deviceKey)}"
              data-v12-type="${escapeHtml(item.lifecycleType || 'Grace24h')}">
        Confirmar remoção
      </button>
    `;
  }

  function renderLifecycle(data) {
    const summary = data.summary || {};
    const preventiveSummary = data.preventiveSummary || {};
    const items = Array.isArray(data.items) ? data.items : [];
    const preventiveItems = Array.isArray(data.preventiveItems) ? data.preventiveItems : [];

    const set = (id, value) => {
      const element = $(id);
      if (element) element.textContent = String(value ?? 0);
    };

    set('imlWaiting', summary.waiting);
    set('imlReady', summary.readyToRemove);
    set('imlRegularized', summary.regularized);
    set('imlMissing', summary.pendingResolutionValidation);
    set('imlRemovedByUser', summary.removedByUser);
    set('imlRemovedByTeam', summary.removedByTeam);
    set('imlTotal', summary.total);

    set('implPreAlert', preventiveSummary.preAlert);
    set('implImminent', preventiveSummary.removalImminent);
    set('implReady', preventiveSummary.readyForRemoval);
    set('implRegularized', preventiveSummary.regularized);
    set('implTotal', preventiveSummary.total);

    const graceBody = $('imlRows');
    if (graceBody) {
      graceBody.innerHTML = items.length
        ? items.map(item => {
            const [label, cls] = statusMeta(item.status, false);
            const identifier = item.managedDeviceId || item.azureADDeviceId || item.serialNumber || '—';

            return `
              <tr>
                <td><strong>${escapeHtml(item.displayName || item.email)}</strong><br><small>${escapeHtml(item.email)}</small></td>
                <td>${escapeHtml(item.deviceName)}<br><small>${escapeHtml(item.model)}</small></td>
                <td style="font-family:Consolas,monospace;font-size:11px">${escapeHtml(identifier)}</td>
                <td>${escapeHtml(formatDate(item.notifiedAt))}</td>
                <td>${escapeHtml(formatDate(item.deadlineAt))}</td>
                <td>${escapeHtml(formatDate(item.lastSeenAt))}</td>
                <td>${escapeHtml(item.notificationCount || 0)}</td>
                <td><strong>${escapeHtml(item.remainingText || '—')}</strong></td>
                <td><span class="iml-badge ${cls}">${escapeHtml(label)}</span></td>
                <td>${lifecycleAction(item)}</td>
              </tr>
            `;
          }).join('')
        : '<tr><td colspan="10" class="iml-empty">Nenhuma notificação registada.</td></tr>';
    }

    const preventiveBody = $('implRows');
    if (preventiveBody) {
      preventiveBody.innerHTML = preventiveItems.length
        ? preventiveItems.map(item => {
            const [label, cls] = statusMeta(item.status, true);

            return `
              <tr>
                <td><strong>${escapeHtml(item.displayName || item.email)}</strong><br><small>${escapeHtml(item.email)}</small></td>
                <td>${escapeHtml(item.deviceName)}<br><small>${escapeHtml(item.model)}</small></td>
                <td>${escapeHtml(formatDate(item.lastSyncDateTime))}</td>
                <td>${escapeHtml(item.daysWithoutSync == null ? '—' : `${item.daysWithoutSync} dias`)}</td>
                <td>${escapeHtml(formatDate(item.deadlineAt || item.preventiveDeadlineAt))}</td>
                <td><strong>${escapeHtml(item.remainingText || '—')}</strong></td>
                <td><strong>${escapeHtml(item.notificationCount || 0)}</strong><br><small>${escapeHtml(formatDate(item.lastNotifiedAt))}</small></td>
                <td><span class="impl-badge ${cls}">${escapeHtml(label)}</span></td>
              </tr>
            `;
          }).join('')
        : '<tr><td colspan="8" class="impl-empty">Nenhum pré-alerta registado.</td></tr>';
    }

    if (data.config) {
      state.config = data.config;
      updateDynamicLabels();
    }
  }

  async function refreshLifecycle() {
    try {
      renderLifecycle(await api('getLifecycle'));
    } catch (error) {
      console.error('V12 lifecycle:', error);
    }
  }

  async function changeLifecycleStatus(button) {
    const note = prompt('Observação opcional:', '');
    if (note === null) return;

    await api('setLifecycleStatus', {
      deviceKey: button.dataset.v12Key,
      lifecycleType: button.dataset.v12Type,
      status: button.dataset.v12Status,
      changedBy: 'Operador local',
      note
    });

    refreshLifecycle();
  }

  function updateDynamicLabels() {
    const start = Number(state.config.notificationStartDays || 10);
    const removal = Number(state.config.removalDays || 17);

    const chip = document.querySelector('.icm-chip[data-filter="preventive"]');
    if (chip) chip.textContent = `Pré-alerta ${start}+ dias`;

    const counterLabel = $('icmCountPreventive')?.closest('.icm-card')?.querySelector('span');
    if (counterLabel) counterLabel.textContent = `Pré-alerta ${start}+ dias`;

    const description = $('implPanel')?.querySelector('.impl-head div div');
    if (description) {
      description.textContent =
        `O pré-alerta começa aos ${start} dias. No ${removal}.º dia o equipamento fica pronto para remoção manual.`;
    }
  }

  async function loadConfig() {
    const data = await api('getPreventiveConfig');
    state.config = data.config || data;
    updateDynamicLabels();
    return state.config;
  }

  function setConfigMessage(message, error = false) {
    const element = $('preventiveConfigMessageV112');
    if (!element) return;

    element.textContent = message || '';
    element.classList.toggle('is-error', error);
  }

  async function openConfig() {
    const modal = $('preventiveConfigModalV112');
    if (!modal) return;

    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');

    try {
      const config = await loadConfig();
      $('preventiveStartDaysV112').value = config.notificationStartDays;
      $('preventiveRemovalDaysV112').value = config.removalDays;
      $('preventiveIntervalDaysV112').value = config.notificationIntervalDays;

      setConfigMessage(
        `Configuração ativa: avisos aos ${config.notificationStartDays} dias, ` +
        `remoção aos ${config.removalDays} dias e lembretes a cada ` +
        `${config.notificationIntervalDays} dia(s).`
      );
    } catch (error) {
      setConfigMessage(error.message, true);
    }
  }

  function closeConfig() {
    $('preventiveConfigModalV112')?.classList.remove('is-open');
    $('preventiveConfigModalV112')?.setAttribute('aria-hidden', 'true');
  }

  async function saveConfig() {
    const notificationStartDays = Number($('preventiveStartDaysV112')?.value);
    const removalDays = Number($('preventiveRemovalDaysV112')?.value);
    const notificationIntervalDays = Number($('preventiveIntervalDaysV112')?.value);

    if (!Number.isInteger(notificationStartDays) || notificationStartDays < 1) {
      setConfigMessage('Informe um início de notificações válido.', true);
      return;
    }

    if (!Number.isInteger(removalDays) || removalDays <= notificationStartDays) {
      setConfigMessage('O dia de remoção deve ser superior ao início das notificações.', true);
      return;
    }

    if (!Number.isInteger(notificationIntervalDays) ||
        notificationIntervalDays < 1 ||
        notificationIntervalDays > 90) {
      setConfigMessage('O intervalo deve estar entre 1 e 90 dias.', true);
      return;
    }

    try {
      const saved = await api('savePreventiveConfig', {
        notificationStartDays,
        removalDays,
        notificationIntervalDays
      }, 'POST');

      state.config = saved.config;
      updateDynamicLabels();
      setConfigMessage(saved.message || 'Prazos guardados com sucesso.');
      await refreshLifecycle();

      setTimeout(() => {
        closeConfig();
        $('icmScan')?.click();
      }, 700);
    } catch (error) {
      setConfigMessage(error.message, true);
    }
  }

  function applyStyles() {
    if ($('intune-mobile-v12-styles')) return;

    const style = document.createElement('style');
    style.id = 'intune-mobile-v12-styles';
    style.textContent = `
      .imn-v12-row{
        display:grid !important;
        grid-template-columns:34px minmax(220px,1.1fr) minmax(260px,1.4fr) 110px !important;
        gap:12px !important;
        align-items:center !important;
        padding:12px !important
      }
      .imn-empty{padding:18px;text-align:center;color:#666}
      @media(max-width:760px){
        .imn-v12-row{grid-template-columns:30px 1fr !important}
        .imn-v12-row>*:nth-child(n+3){grid-column:2}
      }
    `;
    document.head.appendChild(style);
  }

  function bind() {
    applyStyles();
    patchFetchForScan();

    window.openPreventiveConfigV112 = openConfig;
    window.closePreventiveConfigV112 = closeConfig;
    window.savePreventiveConfigV112 = saveConfig;

    $('imnOpen')?.addEventListener('click', openNotifications);
    $('imnClose')?.addEventListener('click', closeNotifications);
    $('imnSelectAll')?.addEventListener('click', () => {
      notificationRows().forEach(row => state.selected.add(rowKey(row)));
      renderNotificationList();
    });
    $('imnClearAll')?.addEventListener('click', () => {
      state.selected.clear();
      renderNotificationList();
    });
    $('imnSendTest')?.addEventListener('click', prepareTest);
    $('imnSendSelected')?.addEventListener('click', () => processSelected(false));
    $('imnSendDirect')?.addEventListener('click', () => processSelected(true));

    $('imlRefresh')?.addEventListener('click', refreshLifecycle);
    $('imlReconcile')?.addEventListener('click', () => {
      api('reconcileLifecycle', {
        rows: state.rows,
        fullScan: true
      }).then(refreshLifecycle).catch(error => alert(error.message));
    });
    $('implRefresh')?.addEventListener('click', refreshLifecycle);

    document.addEventListener('click', event => {
      const button = event.target.closest?.('[data-v12-status]');
      if (button) {
        changeLifecycleStatus(button).catch(error => alert(error.message));
      }

      if (event.target === $('imnOverlay')) closeNotifications();
      if (event.target === $('preventiveConfigModalV112')) closeConfig();
    });

    loadConfig().catch(error => console.error('V12 config:', error));
    refreshLifecycle();
    updateNotificationSummary();
    window.setInterval(refreshLifecycle, 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
/* END INTUNE MOBILE V12 */

/* BEGIN PREVENTIVE DETAILS PANEL V12.0.3 */
(() => {
  'use strict';
  if (window.__preventiveDetailsV1203Loaded) return;
  window.__preventiveDetailsV1203Loaded = true;

  const API = '/module/intune-conformidade-mobile/api';
  const $ = id => document.getElementById(id);
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const esc = value => clean(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const state = { items: [] };

  function unwrap(value){
    for(let i=0;i<6;i++){
      if(typeof value==='string'){try{value=JSON.parse(value);continue}catch{break}}
      if(Array.isArray(value)&&value.length<=4){value=value.find(x=>x&&typeof x==='object'&&!Array.isArray(x))??value[value.length-1];continue}
      break;
    }
    return value;
  }

  async function api(action){
    const url=new URL(API,location.origin);url.searchParams.set('action',action);
    const response=await fetch(url.pathname+url.search,{cache:'no-store'});
    const raw=await response.text();
    const data=unwrap(JSON.parse(raw));
    if(!response.ok||!data||data.success===false) throw new Error(data?.message||`Erro HTTP ${response.status}`);
    return data;
  }

  function formatDate(value){
    if(!value)return '—';
    const d=new Date(value);return Number.isNaN(d.getTime())?clean(value):d.toLocaleString('pt-PT');
  }

  function scanRow(item){
    const rows=Array.isArray(window.__intuneMobileScanRows)?window.__intuneMobileScanRows:[];
    const m=clean(item.managedDeviceId).toLowerCase();
    const a=clean(item.azureADDeviceId).toLowerCase();
    const s=clean(item.serialNumber).toLowerCase();
    return rows.find(r=>(m&&clean(r.managedDeviceId).toLowerCase()===m)||(a&&clean(r.azureADDeviceId).toLowerCase()===a)||(s&&clean(r.serialNumber).toLowerCase()===s))||null;
  }

  function enrich(item){
    const row=scanRow(item)||{};
    return {...row,...item,
      serialNumber:clean(item.serialNumber||row.serialNumber),
      managedDeviceId:clean(item.managedDeviceId||row.managedDeviceId||row.id),
      azureADDeviceId:clean(item.azureADDeviceId||row.azureADDeviceId||row.azureAdDeviceId),
      operatingSystem:clean(item.operatingSystem||row.operatingSystem),
      osVersion:clean(item.osVersion||row.osVersion),
      manufacturer:clean(item.manufacturer||row.manufacturer),
      model:clean(item.model||row.model),
      complianceState:clean(item.complianceState||row.complianceState)
    };
  }

  function styles(){
    if($('ipd-v1203-style'))return;
    const s=document.createElement('style');s.id='ipd-v1203-style';s.textContent=`
      .ipd-cell{max-width:180px;font:11px Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .ipd-btn{border:1px solid #d0d5dd;background:#fff;border-radius:6px;padding:5px 9px;cursor:pointer;font-weight:600}.ipd-btn:hover{color:#ec0000;border-color:#ec0000}
      .ipd-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.45);z-index:99999;padding:24px}.ipd-overlay.open{display:flex}
      .ipd-modal{width:min(900px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.28)}
      .ipd-head{display:flex;justify-content:space-between;gap:16px;padding:20px 24px;background:linear-gradient(135deg,#ec0000,#b40000);color:#fff}.ipd-head h2{margin:0 0 4px}.ipd-head p{margin:0;opacity:.9}.ipd-close{border:0;background:transparent;color:#fff;font-size:28px;cursor:pointer}
      .ipd-body{padding:22px 24px}.ipd-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ipd-field{border:1px solid #e4e7ec;border-radius:10px;padding:12px 14px}.ipd-field span{display:block;color:#667085;font-size:11px;font-weight:700;text-transform:uppercase;margin-bottom:5px}.ipd-field strong{display:block;word-break:break-word}
      .ipd-alert{margin-top:16px;border-left:4px solid #ec0000;background:#fff7f7;border-radius:8px;padding:14px 16px}.ipd-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}.ipd-action{border:1px solid #d0d5dd;background:#fff;border-radius:8px;padding:9px 13px;cursor:pointer;font-weight:700}.ipd-action.primary{background:#ec0000;color:#fff;border-color:#ec0000}
      @media(max-width:760px){.ipd-grid{grid-template-columns:1fr}}
    `;document.head.appendChild(s);
  }

  function ensureModal(){
    if($('ipdOverlay'))return;
    const o=document.createElement('div');o.id='ipdOverlay';o.className='ipd-overlay';o.innerHTML=`<div class="ipd-modal"><div class="ipd-head"><div><h2>Detalhes do controlo preventivo</h2><p>Informações técnicas e prazo de regularização.</p></div><button id="ipdClose" class="ipd-close">×</button></div><div id="ipdBody" class="ipd-body"></div></div>`;
    document.body.appendChild(o);$('ipdClose').onclick=()=>o.classList.remove('open');o.onclick=e=>{if(e.target===o)o.classList.remove('open')};
  }

  function copy(value,label){
    const text=clean(value);if(!text){alert(`${label} não disponível.`);return}
    navigator.clipboard.writeText(text).catch(()=>prompt(`Copie o ${label}:`,text));
  }

  function openModal(item){
    const d=enrich(item);ensureModal();
    const os=[d.operatingSystem,d.osVersion].filter(Boolean).join(' ')||'—';
    $('ipdBody').innerHTML=`
      <div class="ipd-grid">
        <div class="ipd-field"><span>Utilizador</span><strong>${esc(d.displayName||d.email||'—')}</strong></div>
        <div class="ipd-field"><span>Equipamento</span><strong>${esc(d.deviceName||'—')}</strong></div>
        <div class="ipd-field"><span>Sistema</span><strong>${esc(os)}</strong></div>
        <div class="ipd-field"><span>Modelo</span><strong>${esc(d.model||'—')}</strong></div>
        <div class="ipd-field"><span>Número de série</span><strong>${esc(d.serialNumber||'—')}</strong></div>
        <div class="ipd-field"><span>Conformidade</span><strong>${esc(d.complianceState||'—')}</strong></div>
        <div class="ipd-field"><span>Último check-in</span><strong>${esc(formatDate(d.lastSyncDateTime))}</strong></div>
        <div class="ipd-field"><span>Dias sem sincronizar</span><strong>${esc(d.daysWithoutSync==null?'—':`${d.daysWithoutSync} dias`)}</strong></div>
        <div class="ipd-field"><span>Data limite preventiva</span><strong>${esc(formatDate(d.deadlineAt||d.preventiveDeadlineAt))}</strong></div>
        <div class="ipd-field"><span>Dias restantes</span><strong>${esc(d.remainingText||`${d.preventiveDaysRemaining??'—'} dia(s)`)}</strong></div>
        <div class="ipd-field"><span>Notificações enviadas</span><strong>${esc(d.notificationCount??0)}</strong></div>
        <div class="ipd-field"><span>Última notificação</span><strong>${esc(formatDate(d.lastNotifiedAt||d.notifiedAt))}</strong></div>
        <div class="ipd-field"><span>Managed Device ID</span><strong>${esc(d.managedDeviceId||'—')}</strong></div>
        <div class="ipd-field"><span>Azure AD Device ID</span><strong>${esc(d.azureADDeviceId||'—')}</strong></div>
      </div>
      <div class="ipd-alert"><strong>Controlo preventivo</strong><br>O equipamento não comunica com o Intune há ${esc(d.daysWithoutSync??'—')} dia(s). Deve ser sincronizado antes da data limite.</div>
      <div class="ipd-actions">
        <button class="ipd-action" data-copy="serial">Copiar número de série</button>
        <button class="ipd-action" data-copy="managed">Copiar Managed Device ID</button>
        <button class="ipd-action" data-copy="azure">Copiar Azure AD Device ID</button>
        <button class="ipd-action primary" data-open-intune>Abrir no Intune</button>
      </div>`;
    const b=$('ipdBody');b.querySelector('[data-copy="serial"]').onclick=()=>copy(d.serialNumber,'Número de série');b.querySelector('[data-copy="managed"]').onclick=()=>copy(d.managedDeviceId,'Managed Device ID');b.querySelector('[data-copy="azure"]').onclick=()=>copy(d.azureADDeviceId,'Azure AD Device ID');b.querySelector('[data-open-intune]').onclick=()=>{if(!d.managedDeviceId){alert('Managed Device ID não disponível.');return}window.open(`https://intune.microsoft.com/#view/Microsoft_Intune_Devices/DeviceSettingsMenu/~/overview/mdmDeviceId/${encodeURIComponent(d.managedDeviceId)}`,'_blank','noopener')};
    $('ipdOverlay').classList.add('open');
  }function decorate(){
    const tbody=$('implRows');const table=tbody?.closest('table');if(!tbody||!table)return;
    const head=table.querySelector('thead tr:last-child')||table.querySelector('thead tr')||table.querySelector('tr');if(!head)return;
    const labels=[...head.children].map(x=>clean(x.textContent));
    if(!labels.includes('Número de série')){const th=document.createElement('th');th.textContent='Número de série';head.insertBefore(th,head.children[2]||null)}
    if(![...head.children].some(x=>clean(x.textContent)==='Managed Device ID')){const th=document.createElement('th');th.textContent='Managed Device ID';head.insertBefore(th,head.children[3]||null)}
    if(![...head.children].some(x=>clean(x.textContent)==='Ações')){const th=document.createElement('th');th.textContent='Ações';head.appendChild(th)}
    [...tbody.querySelectorAll('tr')].forEach((tr,i)=>{
      if(tr.querySelector('.impl-empty'))return;const item=state.items[i];if(!item)return;const d=enrich(item);
      if(!tr.querySelector('[data-ipd-serial]')){const td=document.createElement('td');td.dataset.ipdSerial='1';td.className='ipd-cell';td.title=d.serialNumber;td.textContent=d.serialNumber||'—';tr.insertBefore(td,tr.children[2]||null)}
      if(!tr.querySelector('[data-ipd-managed]')){const td=document.createElement('td');td.dataset.ipdManaged='1';td.className='ipd-cell';td.title=d.managedDeviceId;td.textContent=d.managedDeviceId||'—';tr.insertBefore(td,tr.children[3]||null)}
      if(!tr.querySelector('[data-ipd-details]')){const td=document.createElement('td');const btn=document.createElement('button');btn.type='button';btn.className='ipd-btn';btn.dataset.ipdDetails=String(i);btn.textContent='Detalhes';btn.onclick=e=>{e.stopPropagation();openModal(item)};td.appendChild(btn);tr.appendChild(td)}
    });
  }

  /* V12.0.4-CODEX-POLLING-GUARD */
  let refreshInFlight=false;
  async function refresh(){
    if(refreshInFlight)return;
    refreshInFlight=true;
    try{
      const data=await api('getLifecycle');
      state.items=Array.isArray(data.preventiveItems)?data.preventiveItems:[];
      decorate();
    }catch(e){
      console.error('Preventive Details V12.0.4:',e);
    }finally{
      refreshInFlight=false;
    }
  }

  function bind(){
    styles();
    ensureModal();
    refresh();
    if(window.__ipd1203Interval)clearInterval(window.__ipd1203Interval);
    window.__ipd1203Interval=setInterval(refresh,60000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();
/* END PREVENTIVE DETAILS PANEL V12.0.3 */

/* BEGIN PREVENTIVE AUTO RECONCILIATION V12.1 */
(() => {
  'use strict';

  if (window.__preventiveAutoReconciliationV121Loaded) return;
  window.__preventiveAutoReconciliationV121Loaded = true;

  const API = '/module/intune-conformidade-mobile/api';
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

  function unwrap(value) {
    for (let i = 0; i < 8; i += 1) {
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
          continue;
        } catch {
          break;
        }
      }

      if (Array.isArray(value) && value.length <= 4) {
        value =
          value.find(item => item && typeof item === 'object' && !Array.isArray(item)) ??
          value.find(item => typeof item === 'string') ??
          value[value.length - 1];
        continue;
      }

      break;
    }

    return value;
  }

  async function api(action, payload, method = payload === undefined ? 'GET' : 'POST') {
    const url = new URL(API, window.location.origin);
    url.searchParams.set('action', action);

    const init = {
      method,
      cache: 'no-store',
      headers: {}
    };

    if (payload !== undefined && method === 'GET') {
      url.searchParams.set('payload', JSON.stringify(payload));
    }
    else if (payload !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(payload);
    }

    const response = await fetch(url.pathname + url.search, init);

    const raw = await response.text();
    let data;

    try {
      data = unwrap(JSON.parse(raw));
    } catch {
      throw new Error(raw || `Erro HTTP ${response.status}`);
    }

    if (!response.ok || !data || data.success === false) {
      throw new Error(data?.message || `Erro HTTP ${response.status}`);
    }

    return data;
  }

  function toast(message) {
    const element = document.getElementById('icmToast');

    if (element) {
      element.textContent = message;
      element.classList.add('show');
      clearTimeout(window.__preventiveV121ToastTimer);
      window.__preventiveV121ToastTimer =
        setTimeout(() => element.classList.remove('show'), 3500);
      return;
    }

    alert(message);
  }

  function setBusy(button, busy, text) {
    if (!button) return;

    if (!button.dataset.originalText) {
      button.dataset.originalText = clean(button.textContent);
    }

    button.disabled = busy;
    button.textContent = busy
      ? text
      : button.dataset.originalText;
  }


  function ensureProgressUiV126() {
    let overlay = document.getElementById('iprOverlayV126');

    if (overlay) return overlay;

    const style = document.createElement('style');
    style.id = 'iprStylesV126';
    style.textContent = `
      #iprOverlayV126{
        position:fixed;
        inset:0;
        z-index:999999;
        display:none;
        align-items:center;
        justify-content:center;
        padding:20px;
        background:rgba(15,23,42,.48);
        backdrop-filter:blur(2px)
      }
      #iprOverlayV126.open{display:flex}
      .ipr-card-v126{
        width:min(650px,96vw);
        max-height:90vh;
        overflow:auto;
        background:#fff;
        border-radius:16px;
        box-shadow:0 24px 70px rgba(0,0,0,.28);
        border:1px solid rgba(0,0,0,.08)
      }
      .ipr-head-v126{
        padding:18px 22px;
        color:#fff;
        background:linear-gradient(135deg,#ec0000,#b00020);
        border-radius:16px 16px 0 0
      }
      .ipr-head-v126 h3{
        margin:0;
        font-size:20px
      }
      .ipr-head-v126 p{
        margin:5px 0 0;
        opacity:.9;
        font-size:13px
      }
      .ipr-body-v126{padding:22px}
      .ipr-progress-line-v126{
        display:flex;
        justify-content:space-between;
        gap:16px;
        margin-bottom:8px;
        font-size:13px;
        font-weight:700
      }
      .ipr-track-v126{
        height:14px;
        overflow:hidden;
        border-radius:999px;
        background:#eceff3
      }
      .ipr-bar-v126{
        width:0%;
        height:100%;
        border-radius:999px;
        background:linear-gradient(90deg,#ec0000,#ff5c5c);
        transition:width .35s ease
      }
      .ipr-steps-v126{
        display:grid;
        gap:8px;
        margin-top:18px
      }
      .ipr-step-v126{
        display:grid;
        grid-template-columns:24px 1fr auto;
        gap:10px;
        align-items:center;
        padding:9px 10px;
        border-radius:9px;
        color:#667085;
        background:#f8fafc;
        font-size:13px
      }
      .ipr-step-v126.active{
        color:#101828;
        background:#fff1f1;
        border:1px solid #ffd2d2
      }
      .ipr-step-v126.done{
        color:#166534;
        background:#f0fdf4
      }
      .ipr-step-v126.error{
        color:#991b1b;
        background:#fef2f2
      }
      .ipr-icon-v126{
        display:flex;
        align-items:center;
        justify-content:center;
        width:22px;
        height:22px;
        border-radius:50%;
        font-weight:800;
        background:#e5e7eb
      }
      .ipr-step-v126.active .ipr-icon-v126{
        color:#fff;
        background:#ec0000;
        animation:iprPulseV126 1s infinite
      }
      .ipr-step-v126.done .ipr-icon-v126{
        color:#fff;
        background:#16a34a
      }
      .ipr-step-v126.error .ipr-icon-v126{
        color:#fff;
        background:#dc2626
      }
      .ipr-summary-v126{
        display:none;
        grid-template-columns:repeat(4,minmax(100px,1fr));
        gap:10px;
        margin-top:18px
      }
      .ipr-summary-v126.show{display:grid}
      .ipr-summary-card-v126{
        padding:12px;
        text-align:center;
        border:1px solid #e5e7eb;
        border-radius:10px;
        background:#fafafa
      }
      .ipr-summary-card-v126 strong{
        display:block;
        font-size:22px
      }
      .ipr-summary-card-v126 span{
        font-size:11px;
        color:#667085
      }
      .ipr-footer-v126{
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:12px;
        margin-top:18px;
        padding-top:16px;
        border-top:1px solid #e5e7eb
      }
      .ipr-time-v126{
        font-size:12px;
        color:#667085
      }
      .ipr-close-v126{
        display:none;
        border:0;
        border-radius:8px;
        padding:9px 18px;
        color:#fff;
        background:#ec0000;
        font-weight:700;
        cursor:pointer
      }
      .ipr-close-v126.show{display:inline-flex}
      @keyframes iprPulseV126{
        0%,100%{transform:scale(1);opacity:1}
        50%{transform:scale(.86);opacity:.72}
      }
      @media(max-width:650px){
        .ipr-summary-v126{
          grid-template-columns:repeat(2,minmax(100px,1fr))
        }
      }
    `;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'iprOverlayV126';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="ipr-card-v126" role="dialog" aria-modal="true">
        <div class="ipr-head-v126">
          <h3>Reconciliação com o Intune</h3>
          <p id="iprSubtitleV126">A preparar a operação...</p>
        </div>

        <div class="ipr-body-v126">
          <div class="ipr-progress-line-v126">
            <span id="iprPhaseV126">A iniciar...</span>
            <span id="iprPercentV126">0%</span>
          </div>

          <div class="ipr-track-v126">
            <div id="iprBarV126" class="ipr-bar-v126"></div>
          </div>

          <div id="iprStepsV126" class="ipr-steps-v126"></div>

          <div id="iprSummaryV126" class="ipr-summary-v126">
            <div class="ipr-summary-card-v126">
              <strong id="iprCheckedV126">0</strong>
              <span>Verificados</span>
            </div>
            <div class="ipr-summary-card-v126">
              <strong id="iprRemovedV126">0</strong>
              <span>Removidos</span>
            </div>
            <div class="ipr-summary-card-v126">
              <strong id="iprRegularizedV126">0</strong>
              <span>Regularizados</span>
            </div>
            <div class="ipr-summary-card-v126">
              <strong id="iprPendingV126">0</strong>
              <span>Ainda pendentes</span>
            </div>
          </div>

          <div class="ipr-footer-v126">
            <span id="iprTimeV126" class="ipr-time-v126">Tempo: 0s</span>
            <button id="iprCloseV126" type="button" class="ipr-close-v126">
              Fechar
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('iprCloseV126')?.addEventListener('click', () => {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    });

    return overlay;
  }

  const reconciliationStepsV126 = [
    'Ler equipamentos acompanhados',
    'Validar ligação ao Microsoft Graph',
    'Consultar dispositivos no Intune',
    'Comparar Managed Device IDs',
    'Atualizar estados e histórico',
    'Atualizar tabelas e indicadores'
  ];

  function renderProgressStepsV126(activeIndex = 0, failedIndex = -1) {
    const container = document.getElementById('iprStepsV126');
    if (!container) return;

    container.innerHTML = reconciliationStepsV126.map((label, index) => {
      const cls =
        index === failedIndex ? 'error' :
        index < activeIndex ? 'done' :
        index === activeIndex ? 'active' : '';

      const icon =
        index === failedIndex ? '!' :
        index < activeIndex ? '✓' :
        index + 1;

      const stateText =
        index === failedIndex ? 'Erro' :
        index < activeIndex ? 'Concluído' :
        index === activeIndex ? 'Em curso' : 'A aguardar';

      return `
        <div class="ipr-step-v126 ${cls}">
          <span class="ipr-icon-v126">${icon}</span>
          <span>${label}</span>
          <small>${stateText}</small>
        </div>
      `;
    }).join('');
  }

  function updateProgressV126(percent, phase, activeStep) {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));

    const bar = document.getElementById('iprBarV126');
    const percentElement = document.getElementById('iprPercentV126');
    const phaseElement = document.getElementById('iprPhaseV126');

    if (bar) bar.style.width = `${safePercent}%`;
    if (percentElement) percentElement.textContent = `${Math.round(safePercent)}%`;
    if (phaseElement) phaseElement.textContent = phase;

    renderProgressStepsV126(activeStep);
  }

  function showProgressV126(totalTracked) {
    const overlay = ensureProgressUiV126();

    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');

    const subtitle = document.getElementById('iprSubtitleV126');
    const summary = document.getElementById('iprSummaryV126');
    const close = document.getElementById('iprCloseV126');

    if (subtitle) {
      subtitle.textContent = totalTracked
        ? `${totalTracked} equipamento(s) acompanhado(s) serão analisados.`
        : 'Os equipamentos acompanhados serão analisados.';
    }

    summary?.classList.remove('show');
    close?.classList.remove('show');

    ['iprCheckedV126','iprRemovedV126','iprRegularizedV126','iprPendingV126']
      .forEach(id => {
        const element = document.getElementById(id);
        if (element) element.textContent = '0';
      });

    updateProgressV126(3, 'A preparar a reconciliação...', 0);

    return overlay;
  }

  function completeProgressV126(result, elapsedSeconds) {
    const summary = result?.summary || {};

    updateProgressV126(100, 'Reconciliação concluída.', reconciliationStepsV126.length);
    renderProgressStepsV126(reconciliationStepsV126.length);

    const subtitle = document.getElementById('iprSubtitleV126');
    if (subtitle) {
      subtitle.textContent = summary.errors
        ? `Concluída com ${summary.errors} erro(s).`
        : 'Todos os passos foram concluídos com sucesso.';
    }

    const values = {
      iprCheckedV126: summary.checked ?? summary.total ?? 0,
      iprRemovedV126: summary.removedByTeam ?? 0,
      iprRegularizedV126: summary.regularized ?? 0,
      iprPendingV126: summary.stillPending ?? 0
    };

    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = String(value);
    });

    document.getElementById('iprSummaryV126')?.classList.add('show');
    document.getElementById('iprCloseV126')?.classList.add('show');

    const time = document.getElementById('iprTimeV126');
    if (time) time.textContent = `Tempo total: ${elapsedSeconds.toFixed(1)}s`;
  }

  function failProgressV126(error, elapsedSeconds, failedStep) {
    const percent = Math.max(8, Math.min(94, failedStep * 16));
    updateProgressV126(percent, `Erro: ${error.message}`, failedStep);
    renderProgressStepsV126(failedStep, failedStep);

    const subtitle = document.getElementById('iprSubtitleV126');
    if (subtitle) {
      subtitle.textContent = 'A reconciliação não foi concluída.';
    }

    const time = document.getElementById('iprTimeV126');
    if (time) time.textContent = `Tempo até ao erro: ${elapsedSeconds.toFixed(1)}s`;

    document.getElementById('iprCloseV126')?.classList.add('show');
  }

  async function reconcile(button) {
    if (!confirm(
      'Confirma a reconciliação automática com o Intune?\n\n' +
      'Dispositivos não encontrados ficarão como "A validar resolução". ' +
      'Dispositivos que voltaram a comunicar serão marcados como regularizados.'
    )) {
      return;
    }

    const trackedElement = document.getElementById('implTotal');
    const totalTracked = Number(trackedElement?.textContent || 0);

    showProgressV126(totalTracked);
    setBusy(button, true, 'A reconciliar com o Intune...');

    const startedAt = performance.now();
    let currentStep = 0;
    let timer = null;
    let clockTimer = null;

    const stagedProgress = [
      { after: 350, percent: 12, phase: 'A ler equipamentos acompanhados...', step: 0 },
      { after: 1100, percent: 25, phase: 'A validar a ligação ao Microsoft Graph...', step: 1 },
      { after: 2100, percent: 42, phase: 'A consultar os dispositivos no Intune...', step: 2 },
      { after: 3600, percent: 60, phase: 'A comparar Managed Device IDs...', step: 3 },
      { after: 5400, percent: 78, phase: 'A atualizar estados e histórico...', step: 4 },
      { after: 7600, percent: 91, phase: 'A preparar os resultados...', step: 5 }
    ];

    const scheduled = stagedProgress.map(stage =>
      window.setTimeout(() => {
        currentStep = stage.step;
        updateProgressV126(stage.percent, stage.phase, stage.step);
      }, stage.after)
    );

    clockTimer = window.setInterval(() => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const time = document.getElementById('iprTimeV126');
      if (time) time.textContent = `Tempo decorrido: ${elapsed.toFixed(1)}s`;
    }, 250);

    try {
      const result = await api('reconcilePreventiveIntune', {
        changedBy: 'Operador local / Reconciliação V12.6'
      }, 'POST');

      scheduled.forEach(id => window.clearTimeout(id));
      if (clockTimer) window.clearInterval(clockTimer);

      const elapsed = (performance.now() - startedAt) / 1000;
      completeProgressV126(result, elapsed);

      const summary = result.summary || {};

      toast(
        `Reconciliação concluída: ` +
        `${summary.removedByTeam || 0} removido(s), ` +
        `${summary.regularized || 0} regularizado(s), ` +
        `${summary.stillPending || 0} ainda pendente(s), ` +
        `${summary.errors || 0} erro(s).`
      );

      let visualRefreshWarningV1261 = null;

      try {
        const preventiveRefreshButton =
          document.getElementById('implRefresh');

        if (preventiveRefreshButton) {
          preventiveRefreshButton.click();
        }
      } catch (refreshPreventiveErrorV1261) {
        visualRefreshWarningV1261 =
          refreshPreventiveErrorV1261?.message ||
          String(refreshPreventiveErrorV1261);

        console.warn(
          'V12.6.1: reconciliação concluída, mas o controlo preventivo não atualizou imediatamente.',
          refreshPreventiveErrorV1261
        );
      }

      try {
        const lifecycleRefreshButton =
          document.getElementById('imlRefresh');

        if (lifecycleRefreshButton) {
          lifecycleRefreshButton.click();
        }
      } catch (refreshLifecycleErrorV1261) {
        visualRefreshWarningV1261 =
          visualRefreshWarningV1261 ||
          refreshLifecycleErrorV1261?.message ||
          String(refreshLifecycleErrorV1261);

        console.warn(
          'V12.6.1: reconciliação concluída, mas o lifecycle não atualizou imediatamente.',
          refreshLifecycleErrorV1261
        );
      }

      try {
        window.dispatchEvent(
          new CustomEvent('preventive-v126-reconciled', {
            detail: {
              success: true,
              summary: result?.summary || {},
              visualRefreshWarning: visualRefreshWarningV1261
            }
          })
        );
      } catch (eventErrorV1261) {
        visualRefreshWarningV1261 =
          visualRefreshWarningV1261 ||
          eventErrorV1261?.message ||
          String(eventErrorV1261);

        console.warn(
          'V12.6.1: evento de atualização visual não foi emitido.',
          eventErrorV1261
        );
      }

      if (visualRefreshWarningV1261) {
        const subtitle = document.getElementById('iprSubtitleV126');

        if (subtitle) {
          subtitle.textContent =
            'Reconciliação concluída. A interface será atualizada automaticamente.';
        }

        console.info(
          'V12.6.1: backend concluído com sucesso; atualização visual diferida.',
          visualRefreshWarningV1261
        );
      }

      console.info('V13.0.4: reconciliação concluída sem recarregar a aplicação.');
    } catch (error) {
      scheduled.forEach(id => window.clearTimeout(id));
      if (clockTimer) window.clearInterval(clockTimer);

      const elapsed = (performance.now() - startedAt) / 1000;

      console.error('Reconciliação V12.6.1:', {
        message: error?.message || String(error),
        name: error?.name || '',
        stack: error?.stack || '',
        error
      });

      failProgressV126(error, elapsed, currentStep);
      toast(`Erro na reconciliação: ${error?.message || String(error)}`);
    } finally {
      setBusy(button, false, '');
    }
  }
  function bindRefreshButton() {
    const button = document.getElementById('implRefresh');

    if (!button || button.dataset.v121Bound === '1') return;

    button.dataset.v121Bound = '1';
    button.dataset.originalText = clean(button.textContent) || 'Atualizar controlo preventivo';

    /*
      Captura antes do listener V12 original para transformar o botão
      numa reconciliação real, evitando apenas um refresh simples.
    */
    button.addEventListener('click', event => {
      if (event.__v121Handled) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      event.__v121Handled = true;

      reconcile(button);
    }, true);

    button.textContent = 'Reconciliar com o Intune';
    button.title =
      'Consulta os dispositivos acompanhados no Intune e atualiza automaticamente os estados.';
  }

  function addManualActions() {
    const tbody = document.getElementById('implRows');
    if (!tbody) return;

    [...tbody.querySelectorAll('tr')].forEach((tr, index) => {
      if (tr.querySelector('.impl-empty')) return;
      if (tr.querySelector('[data-v121-manual-actions]')) return;

      const detailsButton = tr.querySelector('[data-ipd-details]');
      const actionCell = detailsButton?.closest('td');

      if (!actionCell) return;

      const wrapper = document.createElement('div');
      wrapper.dataset.v121ManualActions = '1';
      wrapper.style.display = 'flex';
      wrapper.style.flexWrap = 'wrap';
      wrapper.style.gap = '5px';
      wrapper.style.marginTop = '5px';

      const actions = [
        ['Regularizado', 'Regularized'],
        ['Removido utilizador', 'RemovedByUser'],
        ['Removido equipa', 'RemovedByTeam']
      ];

      actions.forEach(([label, status]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.className = 'ipd-details-btn';
        button.style.fontSize = '10px';
        button.style.padding = '4px 6px';
        button.dataset.v121Status = status;
        button.dataset.v121RowIndex = String(index);

        button.addEventListener('click', async event => {
          event.stopPropagation();

          const lifecycle = await api('getLifecycle');
          const items = Array.isArray(lifecycle.preventiveItems)
            ? lifecycle.preventiveItems
            : [];

          const item = items[Number(button.dataset.v121RowIndex)];
          if (!item) {
            toast('Registo preventivo não encontrado.');
            return;
          }

          const note = prompt(
            'Observação opcional:',
            status === 'RemovedByTeam'
              ? 'Equipamento removido do Intune pela equipa.'
              : ''
          );

          if (note === null) return;

          await api('setLifecycleStatus', {
            deviceKey: item.deviceKey,
            lifecycleType: 'Preventive30d',
            status,
            changedBy: 'Operador local',
            note
          }, 'POST');

          toast('Estado atualizado.');
          document.getElementById('implRefresh')?.dispatchEvent(
            new CustomEvent('v121-manual-refresh')
          );
          console.info('V13.0.4: estado atualizado sem recarregar a aplicação.');
        });

        wrapper.appendChild(button);
      });

      actionCell.appendChild(wrapper);
    });
  }

  function bind() {
    bindRefreshButton();

    const observer = new MutationObserver(() => {
      clearTimeout(window.__preventiveV121MutationTimer);
      window.__preventiveV121MutationTimer = setTimeout(() => {
        bindRefreshButton();
        addManualActions();
      }, 150);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    addManualActions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }
})();
/* END PREVENTIVE AUTO RECONCILIATION V12.1 */

/* BEGIN REQUEST BODY DIAGNOSTIC V12.2 */
(() => {
  'use strict';

  if (window.__intuneV122DiagnosticLoaded) return;
  window.__intuneV122DiagnosticLoaded = true;

  window.addEventListener('unhandledrejection', event => {
    const message = String(event?.reason?.message || event?.reason || '');

    if (/414|Request-URI Too Long|Request URL Too Long/i.test(message)) {
      console.error(
        'V12.2: ainda foi encontrada uma chamada GET demasiado longa. ' +
        'Verifique no Network qual ação continua a enviar payload no URL.'
      );
    }
  });
})();
/* END REQUEST BODY DIAGNOSTIC V12.2 */

/* PATCH V13.0.6 - LIFECYCLE PROGRESS UI */
(function () {
  'use strict';

  if (window.__icmV1306LifecycleProgressLoaded) return;
  window.__icmV1306LifecycleProgressLoaded = true;

  const state = {
    pending: null,
    timer: null,
    startedAt: 0,
    percent: 0,
    originalFetch: window.fetch.bind(window)
  };

  function ensureUi() {
    if (document.getElementById('icmLifecycleProgressV1306')) return;

    const style = document.createElement('style');
    style.id = 'icmLifecycleProgressStyleV1306';
    style.textContent = `
      #icmLifecycleProgressV1306 {
        position: fixed;
        inset: 0;
        z-index: 2147483600;
        background: rgba(10, 18, 28, .56);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
      }
      #icmLifecycleProgressV1306.show { display: flex; }
      #icmLifecycleProgressV1306 .icm-v1306-box {
        width: min(560px, 94vw);
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 24px 80px rgba(0,0,0,.34);
        overflow: hidden;
        font-family: Arial, sans-serif;
      }
      #icmLifecycleProgressV1306 .icm-v1306-head {
        background: linear-gradient(135deg, #c90016, #ed1b2e);
        color: #fff;
        padding: 20px 24px;
      }
      #icmLifecycleProgressV1306 .icm-v1306-title {
        font-size: 20px;
        font-weight: 700;
        margin: 0 0 5px;
      }
      #icmLifecycleProgressV1306 .icm-v1306-subtitle {
        font-size: 13px;
        opacity: .92;
      }
      #icmLifecycleProgressV1306 .icm-v1306-body {
        padding: 22px 24px 20px;
      }
      #icmLifecycleProgressV1306 .icm-v1306-line {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 10px;
        font-size: 14px;
        color: #263238;
      }
      #icmLifecycleProgressV1306 .icm-v1306-track {
        height: 12px;
        border-radius: 999px;
        background: #e6e9ec;
        overflow: hidden;
      }
      #icmLifecycleProgressV1306 .icm-v1306-bar {
        width: 0;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #d4001a, #f23a4c);
        transition: width .28s ease;
      }
      #icmLifecycleProgressV1306 .icm-v1306-status {
        margin-top: 16px;
        min-height: 20px;
        font-size: 13px;
        color: #455a64;
      }
      #icmLifecycleProgressV1306 .icm-v1306-status.ok {
        color: #147a38;
        font-weight: 700;
      }
      #icmLifecycleProgressV1306 .icm-v1306-status.error {
        color: #b00020;
        font-weight: 700;
        white-space: pre-wrap;
      }
      #icmLifecycleProgressV1306 .icm-v1306-actions {
        display: none;
        justify-content: flex-end;
        margin-top: 18px;
      }
      #icmLifecycleProgressV1306 .icm-v1306-actions.show {
        display: flex;
      }
      #icmLifecycleProgressV1306 .icm-v1306-close {
        border: 0;
        border-radius: 8px;
        background: #d4001a;
        color: #fff;
        padding: 9px 18px;
        font-weight: 700;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'icmLifecycleProgressV1306';
    overlay.innerHTML = `
      <div class="icm-v1306-box" role="dialog" aria-modal="true">
        <div class="icm-v1306-head">
          <div class="icm-v1306-title" id="icmLifecycleProgressTitleV1306">
            A atualizar controlo
          </div>
          <div class="icm-v1306-subtitle" id="icmLifecycleProgressSubtitleV1306">
            Aguarde enquanto os dados são processados.
          </div>
        </div>
        <div class="icm-v1306-body">
          <div class="icm-v1306-line">
            <span id="icmLifecycleProgressPhaseV1306">A iniciar...</span>
            <strong id="icmLifecycleProgressPercentV1306">0%</strong>
          </div>
          <div class="icm-v1306-track">
            <div class="icm-v1306-bar" id="icmLifecycleProgressBarV1306"></div>
          </div>
          <div class="icm-v1306-status" id="icmLifecycleProgressStatusV1306"></div>
          <div class="icm-v1306-actions" id="icmLifecycleProgressActionsV1306">
            <button type="button" class="icm-v1306-close" id="icmLifecycleProgressCloseV1306">
              Fechar
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('icmLifecycleProgressCloseV1306')
      ?.addEventListener('click', () => {
        overlay.classList.remove('show');
        state.pending = null;
      });
  }

  function setProgress(percent, phase, status, statusClass) {
    ensureUi();

    const value = Math.max(0, Math.min(100, Number(percent) || 0));
    state.percent = value;

    const bar = document.getElementById('icmLifecycleProgressBarV1306');
    const percentEl = document.getElementById('icmLifecycleProgressPercentV1306');
    const phaseEl = document.getElementById('icmLifecycleProgressPhaseV1306');
    const statusEl = document.getElementById('icmLifecycleProgressStatusV1306');

    if (bar) bar.style.width = `${value}%`;
    if (percentEl) percentEl.textContent = `${Math.round(value)}%`;
    if (phaseEl && phase) phaseEl.textContent = phase;

    if (statusEl) {
      statusEl.textContent = status || '';
      statusEl.className = `icm-v1306-status${statusClass ? ` ${statusClass}` : ''}`;
    }
  }

  function show(kind) {
    ensureUi();

    const overlay = document.getElementById('icmLifecycleProgressV1306');
    const title = document.getElementById('icmLifecycleProgressTitleV1306');
    const subtitle = document.getElementById('icmLifecycleProgressSubtitleV1306');
    const actions = document.getElementById('icmLifecycleProgressActionsV1306');

    state.pending = {
      kind,
      reconcileFinished: false
    };
    state.startedAt = Date.now();
    state.percent = 8;

    if (title) {
      title.textContent = kind === 'reconcile'
        ? 'Reconciliar última pesquisa'
        : 'Atualizar controlo';
    }if (subtitle) {
      subtitle.textContent = kind === 'reconcile'
        ? 'A validar os equipamentos acompanhados e os estados atuais no Intune.'
        : 'A carregar novamente o controlo de notificações.';
    }

    if (actions) actions.classList.remove('show');
    if (overlay) overlay.classList.add('show');

    setProgress(
      8,
      kind === 'reconcile'
        ? 'A enviar a última pesquisa...'
        : 'A pedir os dados atualizados...',
      '',
      ''
    );

    clearInterval(state.timer);
    state.timer = window.setInterval(() => {
      if (!state.pending) return;
      if (state.percent >= 88) return;

      const next = Math.min(88, state.percent + (state.percent < 55 ? 7 : 3));
      setProgress(
        next,
        state.pending.kind === 'reconcile'
          ? 'A validar estados e Managed Device IDs...'
          : 'A carregar o controlo...',
        '',
        ''
      );
    }, 480);

    window.setTimeout(() => {
      if (!state.pending) return;

      clearInterval(state.timer);
      setProgress(
        state.percent,
        'A operação está a demorar mais do que o habitual.',
        'Verifique a ligação ao Graph e o terminal do servidor.',
        'error'
      );

      document.getElementById('icmLifecycleProgressActionsV1306')
        ?.classList.add('show');
    }, 45000);
  }

  function finishSuccess(message) {
    if (!state.pending) return;

    clearInterval(state.timer);
    const minimumVisible = 950;
    const elapsed = Date.now() - state.startedAt;
    const delay = Math.max(0, minimumVisible - elapsed);

    window.setTimeout(() => {
      setProgress(
        100,
        'Operação concluída.',
        message || 'O controlo foi atualizado.',
        'ok'
      );

      window.setTimeout(() => {
        document.getElementById('icmLifecycleProgressV1306')
          ?.classList.remove('show');
        state.pending = null;
      }, 900);
    }, delay);
  }

  function finishError(message) {
    if (!state.pending) return;

    clearInterval(state.timer);
    setProgress(
      state.percent || 20,
      'Não foi possível concluir.',
      message || 'O servidor devolveu um erro.',
      'error'
    );

    document.getElementById('icmLifecycleProgressActionsV1306')
      ?.classList.add('show');
  }

  function readAction(input) {
    try {
      const raw = typeof input === 'string'
        ? input
        : (input && input.url ? input.url : String(input));

      return new URL(raw, window.location.origin)
        .searchParams
        .get('action');
    } catch {
      return '';
    }
  }

  async function readResponse(response) {
    try {
      const clone = response.clone();
      const text = await clone.text();

      if (!text) return null;

      try {
        return JSON.parse(text);
      } catch {
        return { message: text };
      }
    } catch {
      return null;
    }
  }

  window.fetch = async function (input, init) {
    const action = readAction(input);

    try {
      const response = await state.originalFetch(input, init);

      if (!state.pending) return response;

      if (state.pending.kind === 'reconcile' && action === 'reconcileLifecycle') {
        const data = await readResponse(response);

        if (!response.ok || (data && data.success === false)) {
          finishError(
            data?.message ||
            data?.error ||
            `Erro HTTP ${response.status}.`
          );
          return response;
        }

        state.pending.reconcileFinished = true;
        setProgress(
          88,
          'Reconciliação concluída. A atualizar a tabela...',
          data?.message || '',
          ''
        );

        window.setTimeout(() => {
          if (state.pending?.kind === 'reconcile') {
            finishSuccess(
              data?.message || 'Reconciliação e controlo atualizados.'
            );
          }
        }, 1400);

        return response;
      }

      if (
        state.pending.kind === 'refresh' &&
        action === 'getLifecycle'
      ) {
        const data = await readResponse(response);

        if (!response.ok || (data && data.success === false)) {
          finishError(
            data?.message ||
            data?.error ||
            `Erro HTTP ${response.status}.`
          );
        } else {
          finishSuccess(
            data?.message || 'Controlo carregado com sucesso.'
          );
        }
      }

      return response;
    } catch (error) {
      if (state.pending) {
        finishError(error?.message || String(error));
      }
      throw error;
    }
  };

  document.addEventListener('click', event => {
    const reconcileButton = event.target.closest('#implReconcile');
    const refreshButton = event.target.closest('#implRefresh');

    if (reconcileButton && !reconcileButton.disabled && !window.__icmLifecycleProgressV1308Installed) {
      show('reconcile');
      return;
    }

    if (refreshButton && !refreshButton.disabled) {
      show('refresh');
    }
  }, true);
})();

/* BEGIN LIFECYCLE RECONCILIATION PROGRESS V13.0.8 */
(() => {
  'use strict';

  if (window.__icmLifecycleProgressV1308Installed) return;
  window.__icmLifecycleProgressV1308Installed = true;

  const STYLE_ID = 'icmLifecycleProgressV1308Style';
  const MODAL_ID = 'icmLifecycleProgressV1308';

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${MODAL_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(15, 23, 42, .58);
        backdrop-filter: blur(2px);
      }

      #${MODAL_ID}.is-visible {
        display: flex;
      }

      #${MODAL_ID} .icm-lp-card {
        width: min(620px, 96vw);
        overflow: hidden;
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 24px 70px rgba(0, 0, 0, .32);
        font-family: Arial, Helvetica, sans-serif;
      }

      #${MODAL_ID} .icm-lp-header {
        padding: 20px 24px;
        color: #fff;
        background: linear-gradient(135deg, #ec0000, #c90000);
      }

      #${MODAL_ID} .icm-lp-header h2 {
        margin: 0 0 6px;
        font-size: 22px;
      }

      #${MODAL_ID} .icm-lp-header p {
        margin: 0;
        opacity: .94;
        font-size: 14px;
      }

      #${MODAL_ID} .icm-lp-body {
        padding: 22px 24px 20px;
      }

      #${MODAL_ID} .icm-lp-phase-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 10px;
        color: #1f2937;
        font-size: 15px;
        font-weight: 700;
      }

      #${MODAL_ID} .icm-lp-track {
        height: 12px;
        overflow: hidden;
        border-radius: 999px;
        background: #e5e7eb;
      }

      #${MODAL_ID} .icm-lp-bar {
        width: 0;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #ec0000, #ff3344);
        transition: width .35s ease;
      }

      #${MODAL_ID} .icm-lp-steps {
        display: grid;
        gap: 8px;
        margin-top: 20px;
      }

      #${MODAL_ID} .icm-lp-step {
        display: grid;
        grid-template-columns: 28px 1fr auto;
        align-items: center;
        gap: 10px;
        min-height: 42px;
        padding: 8px 10px;
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        color: #6b7280;
        background: #fff;
      }

      #${MODAL_ID} .icm-lp-step.is-active {
        color: #991b1b;
        border-color: #fecaca;
        background: #fff7f7;
      }

      #${MODAL_ID} .icm-lp-step.is-done {
        color: #166534;
        border-color: #bbf7d0;
        background: #f0fdf4;
      }

      #${MODAL_ID} .icm-lp-step.is-error {
        color: #991b1b;
        border-color: #fecaca;
        background: #fef2f2;
      }

      #${MODAL_ID} .icm-lp-icon {
        display: grid;
        width: 24px;
        height: 24px;
        place-items: center;
        border-radius: 50%;
        color: #fff;
        background: #9ca3af;
        font-size: 12px;
        font-weight: 800;
      }

      #${MODAL_ID} .icm-lp-step.is-active .icm-lp-icon {
        background: #ec0000;
      }

      #${MODAL_ID} .icm-lp-step.is-done .icm-lp-icon {
        background: #16a34a;
      }

      #${MODAL_ID} .icm-lp-step.is-error .icm-lp-icon {
        background: #dc2626;
      }

      #${MODAL_ID} .icm-lp-status {
        font-size: 12px;
        white-space: nowrap;
      }

      #${MODAL_ID} .icm-lp-result {
        display: none;
        margin-top: 18px;
        padding: 12px 14px;
        border-radius: 10px;
        color: #166534;
        background: #f0fdf4;
        font-size: 14px;
        line-height: 1.45;
      }

      #${MODAL_ID} .icm-lp-result.is-error {
        color: #991b1b;
        background: #fef2f2;
      }

      #${MODAL_ID} .icm-lp-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-top: 18px;
      }

      #${MODAL_ID} .icm-lp-time {
        color: #6b7280;
        font-size: 12px;
      }

      #${MODAL_ID} .icm-lp-close {
        display: none;
        border: 0;
        border-radius: 8px;
        padding: 10px 20px;
        color: #fff;
        background: #ec0000;
        cursor: pointer;
        font-weight: 700;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    installStyles();

    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Progresso da reconciliação');

    modal.innerHTML = `
      <div class="icm-lp-card">
        <div class="icm-lp-header">
          <h2>Reconciliação da última pesquisa</h2>
          <p>A acompanhar a operação enviada ao servidor.</p>
        </div>

        <div class="icm-lp-body">
          <div class="icm-lp-phase-row">
            <span data-role="phase">A iniciar reconciliação...</span>
            <strong data-role="percent">0%</strong>
          </div>

          <div class="icm-lp-track">
            <div class="icm-lp-bar" data-role="bar"></div>
          </div>

          <div class="icm-lp-steps">
            <div class="icm-lp-step" data-step="1">
              <span class="icm-lp-icon">1</span>
              <span>Preparar dados da última pesquisa</span>
              <span class="icm-lp-status">A aguardar</span>
            </div>

            <div class="icm-lp-step" data-step="2">
              <span class="icm-lp-icon">2</span>
              <span>Enviar pedido ao servidor</span>
              <span class="icm-lp-status">A aguardar</span>
            </div>

            <div class="icm-lp-step" data-step="3">
              <span class="icm-lp-icon">3</span>
              <span>Comparar equipamentos e estados</span>
              <span class="icm-lp-status">A aguardar</span>
            </div>

            <div class="icm-lp-step" data-step="4">
              <span class="icm-lp-icon">4</span>
              <span>Atualizar controlo e histórico</span>
              <span class="icm-lp-status">A aguardar</span>
            </div>

            <div class="icm-lp-step" data-step="5">
              <span class="icm-lp-icon">5</span>
              <span>Atualizar indicadores no ecrã</span>
              <span class="icm-lp-status">A aguardar</span>
            </div>
          </div>

          <div class="icm-lp-result" data-role="result"></div>

          <div class="icm-lp-footer">
            <span class="icm-lp-time" data-role="time">Tempo decorrido: 0.0s</span>
            <button type="button" class="icm-lp-close" data-role="close">Fechar</button>
          </div>
        </div>
      </div>
    `;

    modal.querySelector('[data-role="close"]').addEventListener('click', () => {
      modal.classList.remove('is-visible');
    });

    document.body.appendChild(modal);
    return modal;
  }

  const progress = {
    modal: null,
    startedAt: 0,
    timer: null,
    stagedTimers: [],

    reset() {
      this.modal = ensureModal();
      this.startedAt = performance.now();

      this.stagedTimers.forEach(id => window.clearTimeout(id));
      this.stagedTimers = [];

      if (this.timer) {
        window.clearInterval(this.timer);
        this.timer = null;
      }

      this.modal.querySelector('[data-role="phase"]').textContent =
        'A iniciar reconciliação...';
      this.modal.querySelector('[data-role="percent"]').textContent = '0%';
      this.modal.querySelector('[data-role="bar"]').style.width = '0%';

      const result = this.modal.querySelector('[data-role="result"]');
      result.style.display = 'none';
      result.classList.remove('is-error');
      result.textContent = '';

      const close = this.modal.querySelector('[data-role="close"]');
      close.style.display = 'none';

      this.modal.querySelectorAll('.icm-lp-step').forEach((step, index) => {
        step.classList.remove('is-active', 'is-done', 'is-error');
        step.querySelector('.icm-lp-icon').textContent = String(index + 1);
        step.querySelector('.icm-lp-status').textContent = 'A aguardar';
      });

      this.modal.classList.add('is-visible');

      this.timer = window.setInterval(() => {
        const elapsed = (performance.now() - this.startedAt) / 1000;
        this.modal.querySelector('[data-role="time"]').textContent =
          `Tempo decorrido: ${elapsed.toFixed(1)}s`;
      }, 200);
    },

    update(percent, phase, activeStep) {
      if (!this.modal) this.modal = ensureModal();

      const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
      this.modal.querySelector('[data-role="phase"]').textContent = phase;
      this.modal.querySelector('[data-role="percent"]').textContent =
        `${safePercent}%`;
      this.modal.querySelector('[data-role="bar"]').style.width =
        `${safePercent}%`;

      this.modal.querySelectorAll('.icm-lp-step').forEach((step, index) => {
        const stepNumber = index + 1;
        const status = step.querySelector('.icm-lp-status');
        const icon = step.querySelector('.icm-lp-icon');

        step.classList.remove('is-active', 'is-done', 'is-error');

        if (stepNumber < activeStep) {
          step.classList.add('is-done');
          icon.textContent = '✓';
          status.textContent = 'Concluído';
        } else if (stepNumber === activeStep) {
          step.classList.add('is-active');
          icon.textContent = String(stepNumber);
          status.textContent = 'Em curso';
        } else {
          icon.textContent = String(stepNumber);
          status.textContent = 'A aguardar';
        }
      });
    },

    schedule() {
      const stages = [
        [150, 12, 'A preparar dados da última pesquisa...', 1],
        [650, 28, 'Pedido enviado ao servidor...', 2],
        [1600, 48, 'A comparar equipamentos e estados...', 3],
        [3200, 68, 'A atualizar controlo e histórico...', 4],
        [5000, 84, 'A preparar os indicadores...', 5]
      ];

      this.stagedTimers = stages.map(([delay, percent, phase, step]) =>
        window.setTimeout(() => this.update(percent, phase, step), delay)
      );
    },

    finishSuccess(data) {
      this.stagedTimers.forEach(id => window.clearTimeout(id));
      this.stagedTimers = [];

      this.update(100, 'Reconciliação concluída.', 6);

      if (this.timer) {
        window.clearInterval(this.timer);
        this.timer = null;
      }

      const elapsed = (performance.now() - this.startedAt) / 1000;
      this.modal.querySelector('[data-role="time"]').textContent =
        `Tempo total: ${elapsed.toFixed(1)}s`;

      const summary = data?.summary || data?.data?.summary || {};
      const parts = [];

      const regularized =
        summary.regularized ??
        summary.regularizados ??
        data?.regularized ??
        data?.regularizados;

      const pending =
        summary.stillPending ??
        summary.pending ??
        summary.pendingValidation ??
        summary.aValidarResolucao ??
        data?.pending;

      const removed =
        summary.removedByTeam ??
        summary.removed ??
        summary.removidos ??
        data?.removed;

      if (Number.isFinite(Number(regularized))) {
        parts.push(`${Number(regularized)} regularizado(s)`);
      }

      if (Number.isFinite(Number(pending))) {
        parts.push(`${Number(pending)} pendente(s) de validação`);
      }

      if (Number.isFinite(Number(removed))) {
        parts.push(`${Number(removed)} removido(s) confirmado(s)`);
      }

      const result = this.modal.querySelector('[data-role="result"]');
      result.textContent = parts.length
        ? `Operação terminada com sucesso: ${parts.join(', ')}.`
        : 'Operação terminada com sucesso. O controlo foi atualizado.';
      result.style.display = 'block';

      this.modal.querySelector('[data-role="close"]').style.display =
        'inline-block';
    },

    finishError(message) {
      this.stagedTimers.forEach(id => window.clearTimeout(id));
      this.stagedTimers = [];

      if (this.timer) {
        window.clearInterval(this.timer);
        this.timer = null;
      }

      const active =
        this.modal.querySelector('.icm-lp-step.is-active') ||
        this.modal.querySelector('[data-step="2"]');

      active.classList.remove('is-active');
      active.classList.add('is-error');
      active.querySelector('.icm-lp-icon').textContent = '!';
      active.querySelector('.icm-lp-status').textContent = 'Erro';

      this.modal.querySelector('[data-role="phase"]').textContent =
        'A reconciliação terminou com erro.';

      const result = this.modal.querySelector('[data-role="result"]');
      result.textContent = message || 'Erro desconhecido durante a reconciliação.';
      result.classList.add('is-error');
      result.style.display = 'block';

      this.modal.querySelector('[data-role="close"]').style.display =
        'inline-block';
    }
  };

  function isLifecycleReconciliation(input) {
    let url = '';

    try {
      if (typeof input === 'string') {
        url = input;
      } else if (input && typeof input.url === 'string') {
        url = input.url;
      } else {
        url = String(input || '');
      }

      const parsed = new URL(url, window.location.origin);
      return (
        parsed.pathname.includes('/module/intune-conformidade-mobile/api') &&
        parsed.searchParams.get('action') === 'reconcileLifecycle'
      );
    } catch {
      return /action=reconcileLifecycle(?:&|$)/i.test(url);
    }
  }

  async function readResponseData(response) {
    if (!response || typeof response.clone !== 'function') return null;

    try {
      const clone = response.clone();
      const text = await clone.text();
      if (!text) return null;

      try {
        return JSON.parse(text);
      } catch {
        return { rawText: text };
      }
    } catch {
      return null;
    }
  }

  const previousFetch = window.fetch.bind(window);

  window.fetch = async function lifecycleProgressFetch(input, init) {
    const tracked = isLifecycleReconciliation(input);

    if (!tracked) {
      return previousFetch(input, init);
    }

    progress.reset();
    progress.schedule();

    try {
      const response = await previousFetch(input, init);
      const data = await readResponseData(response);

      const responseFailed =
        response &&
        typeof response.ok === 'boolean' &&
        response.ok === false;

      const apiFailed =
        data &&
        typeof data === 'object' &&
        data.success === false;

      if (responseFailed || apiFailed) {
        const message =
          data?.message ||
          data?.error ||
          data?.rawText ||
          `HTTP ${response?.status || 'desconhecido'}`;

        progress.finishError(String(message));
        return response;
      }progress.finishSuccess(data);
      return response;
    } catch (error) {
      progress.finishError(
        error?.message || String(error || 'Erro desconhecido.')
      );
      throw error;
    }
  };

  console.info(
    'V13.0.8: progresso da reconciliação da última pesquisa instalado.'
  );
})();
/* END LIFECYCLE RECONCILIATION PROGRESS V13.0.8 */

/* BEGIN INTUNE FILTERS V13.0.9 */
(() => {
  'use strict';

  const VERSION = '13.0.9';
  const ROOT_SELECTOR = '#icmRoot';

  try {
    if (window.__icmFiltersV1309 &&
        typeof window.__icmFiltersV1309.destroy === 'function') {
      window.__icmFiltersV1309.destroy();
    }
  } catch (cleanupError) {
    console.warn('V13.0.9: não foi possível limpar a instância anterior.', cleanupError);
  }

  const state = {
    activeFilter: 'all',
    thresholds: {
      notificationStartDays: 10,
      removalDays: 17
    },
    chipContainer: null,
    tbody: null,
    observer: null,
    mutationTimer: null,
    retryTimer: null,
    destroyed: false,
    chipCaptureHandler: null
  };

  const FILTERS = [
    {
      key: 'all',
      label: 'Todos',
      title: 'Mostrar todos os equipamentos apresentados.'
    },
    {
      key: 'grace',
      label: 'Em carência no Intune',
      title: 'Equipamentos cujo estado atual no Intune é inGracePeriod. Isso não significa, por si só, que o prazo já terminou.'
    },
    {
      key: 'grace48',
      label: 'Carência termina em 48h',
      title: 'Equipamentos em carência cuja data de fim ocorre nas próximas 48 horas.'
    },
    {
      key: 'noncompliant',
      label: 'Não conformes',
      title: 'Equipamentos cujo estado devolvido pelo Intune é noncompliant.'
    },
    {
      key: 'prealert',
      label: 'Pré-alerta',
      title: 'Equipamentos entre o início do alerta preventivo e o dia anterior à remoção iminente.'
    },
    {
      key: 'imminent',
      label: 'Remoção iminente',
      title: 'Equipamentos a um dia do limite configurado para remoção manual.'
    },
    {
      key: 'ready',
      label: 'Prontos para remover',
      title: 'Equipamentos que atingiram ou ultrapassaram o limite de dias sem sincronização.'
    },
    {
      key: 'harmony',
      label: 'Harmony',
      title: 'Equipamentos com diagnóstico relacionado com Harmony ou Mobile Threat Defense.'
    },
    {
      key: 'harmonyIncomplete',
      label: 'Harmony por configurar',
      title: 'Equipamentos cuja instalação, ativação ou configuração obrigatória do Harmony Mobile não foi concluída.'
    },
    {
      key: 'android',
      label: 'Android',
      title: 'Mostrar apenas equipamentos Android.'
    },
    {
      key: 'ios',
      label: 'iPhone/iPad',
      title: 'Mostrar apenas equipamentos iOS ou iPadOS.'
    },
    {
      key: 'high',
      label: 'Risco alto',
      title: 'Mostrar apenas equipamentos classificados como risco alto.'
    }
  ];

  function normalize(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function parseInteger(value) {
    const match = String(value ?? '').match(/-?\d+/);
    return match ? Number.parseInt(match[0], 10) : null;
  }

  function parsePortugueseDate(value) {
    const text = String(value ?? '').replace(/\s+/g, ' ');
    const match = text.match(
      /(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );

    if (!match) {
      return null;
    }

    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] || 0);

    const result = new Date(year, month, day, hour, minute, second);
    return Number.isNaN(result.getTime()) ? null : result;
  }

  function parseJsonValue(value) {
    let current = value;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (typeof current !== 'string') {
        break;
      }

      const trimmed = current.trim();
      if (!trimmed) {
        break;
      }

      try {
        current = JSON.parse(trimmed);
      } catch {
        break;
      }
    }

    return current;
  }

  async function loadThresholds() {
    const actions = ['getPreventiveConfig', 'getpreventiveconfig'];

    for (const action of actions) {
      try {
        const url = new URL(
          '/module/intune-conformidade-mobile/api',
          window.location.origin
        );
        url.searchParams.set('action', action);

        const response = await window.fetch(url.toString(), {
          method: 'GET',
          cache: 'no-store'
        });

        if (!response.ok) {
          continue;
        }

        const text = await response.text();
        const parsed = parseJsonValue(text);
        const payload = parsed?.config || parsed?.data || parsed;

        const notificationStartDays = Number(
          payload?.notificationStartDays
        );
        const removalDays = Number(payload?.removalDays);

        if (Number.isFinite(notificationStartDays) &&
            notificationStartDays >= 1) {
          state.thresholds.notificationStartDays = notificationStartDays;
        }

        if (Number.isFinite(removalDays) &&
            removalDays > state.thresholds.notificationStartDays) {
          state.thresholds.removalDays = removalDays;
        }

        break;
      } catch (error) {
        console.debug(
          `V${VERSION}: configuração preventiva não carregada por ${action}.`,
          error
        );
      }
    }
  }

  function findRoot() {
    return document.querySelector(ROOT_SELECTOR);
  }

  function findMainTbody() {
    const root = findRoot();
    if (!root) {
      return null;
    }

    return (
      document.getElementById('icmTbody') ||
      document.getElementById('icmTableBody') ||
      root.querySelector('.icm-table tbody') ||
      root.querySelector('section table tbody') ||
      root.querySelector('table tbody')
    );
  }

  function getRows() {
    const tbody = findMainTbody();
    if (!tbody) {
      return [];
    }

    state.tbody = tbody;

    return Array.from(tbody.rows).filter(row => {
      if (!row || row.cells.length < 9) {
        return false;
      }

      return !row.querySelector('td[colspan]');
    });
  }

  function readRow(row) {
    const cells = Array.from(row.cells).map(cell =>
      String(cell.innerText || cell.textContent || '').trim()
    );

    const riskText = cells[0] || '';
    const osText = cells[3] || '';
    const complianceText = cells[5] || '';
    const graceText = cells[6] || '';
    const daysText = cells[8] || '';
    const preventiveDeadlineText = cells[9] || '';
    const diagnosticText = cells[10] || '';

    const normalizedRisk = normalize(riskText);
    const normalizedOs = normalize(osText);
    const normalizedCompliance = normalize(complianceText);
    const normalizedDiagnostic = normalize(diagnosticText);
    const daysWithoutSync = parseInteger(daysText);
    const graceDeadline = parsePortugueseDate(graceText);

    const isGrace =
      normalizedCompliance.includes('in grace') ||
      normalizedCompliance.includes('ingraceperiod') ||
      normalizedCompliance.includes('em carencia') ||
      normalizedCompliance === 'carencia';

    const isNoncompliant =
      normalizedCompliance.includes('noncompliant') ||
      normalizedCompliance.includes('nao conforme');

    const isHarmony =
      normalizedDiagnostic.includes('harmony') ||
      normalizedDiagnostic.includes('mobile threat defense');

    const isHarmonyIncomplete =
      normalizedDiagnostic.includes('harmony') &&
      normalizedDiagnostic.includes('configuracao incompleta');

    const isAndroid = normalizedOs.includes('android');
    const isIos =
      normalizedOs.includes('ios') ||
      normalizedOs.includes('ipados') ||
      normalizedOs.includes('iphone') ||
      normalizedOs.includes('ipad');

    const isHighRisk =
      normalizedRisk === 'alto' ||
      normalizedRisk.includes('risco alto');

    const now = Date.now();
    const graceTime = graceDeadline ? graceDeadline.getTime() : null;
    const remainingGraceMs =
      graceTime === null ? null : graceTime - now;

    const isGraceWithin48Hours =
      isGrace &&
      remainingGraceMs !== null &&
      remainingGraceMs >= 0 &&
      remainingGraceMs <= 48 * 60 * 60 * 1000;

    const startDays = state.thresholds.notificationStartDays;
    const removalDays = state.thresholds.removalDays;
    const imminentDay = removalDays - 1;

    const isPreAlert =
      daysWithoutSync !== null &&
      daysWithoutSync >= startDays &&
      daysWithoutSync < imminentDay;

    const isRemovalImminent =
      daysWithoutSync !== null &&
      daysWithoutSync === imminentDay;

    const isReadyForRemoval =
      daysWithoutSync !== null &&
      daysWithoutSync >= removalDays;

    return {
      row,
      cells,
      riskText,
      osText,
      complianceText,
      graceText,
      preventiveDeadlineText,
      diagnosticText,
      daysWithoutSync,
      isGrace,
      isGraceWithin48Hours,
      isNoncompliant,
      isHarmony,
      isHarmonyIncomplete,
      isAndroid,
      isIos,
      isHighRisk,
      isPreAlert,
      isRemovalImminent,
      isReadyForRemoval
    };
  }

  function matchesFilter(data, filterKey) {
    switch (filterKey) {
      case 'grace':
        return data.isGrace;
      case 'grace48':
        return data.isGraceWithin48Hours;
      case 'noncompliant':
        return data.isNoncompliant;
      case 'prealert':
        return data.isPreAlert;
      case 'imminent':
        return data.isRemovalImminent;
      case 'ready':
        return data.isReadyForRemoval;
      case 'harmony':
        return data.isHarmony;
      case 'harmonyIncomplete':
        return data.isHarmonyIncomplete;
      case 'android':
        return data.isAndroid;
      case 'ios':
        return data.isIos;
      case 'high':
        return data.isHighRisk;
      case 'all':
      default:
        return true;
    }
  }

  function calculateCounts(rowData) {
    const counts = {
      all: rowData.length,
      grace: 0,
      grace48: 0,
      noncompliant: 0,
      prealert: 0,
      imminent: 0,
      ready: 0,
      harmony: 0,
      harmonyIncomplete: 0,
      android: 0,
      ios: 0,
      high: 0,
      stale10Plus: 0
    };

    for (const data of rowData) {
      if (data.isGrace) counts.grace += 1;
      if (data.isGraceWithin48Hours) counts.grace48 += 1;
      if (data.isNoncompliant) counts.noncompliant += 1;
      if (data.isPreAlert) counts.prealert += 1;
      if (data.isRemovalImminent) counts.imminent += 1;
      if (data.isReadyForRemoval) counts.ready += 1;
      if (data.isHarmony) counts.harmony += 1;
      if (data.isHarmonyIncomplete) counts.harmonyIncomplete += 1;
      if (data.isAndroid) counts.android += 1;
      if (data.isIos) counts.ios += 1;
      if (data.isHighRisk) counts.high += 1;

      if (data.daysWithoutSync !== null &&
          data.daysWithoutSync >=
            state.thresholds.notificationStartDays) {
        counts.stale10Plus += 1;
      }
    }

    return counts;
  }

  function getFilterLabel(filterKey) {
    const start = state.thresholds.notificationStartDays;
    const removal = state.thresholds.removalDays;
    const imminent = removal - 1;

    switch (filterKey) {
      case 'prealert':
        return `Pré-alerta ${start}–${Math.max(start, imminent - 1)} dias`;
      case 'imminent':
        return `Remoção iminente ${imminent} dias`;
      case 'ready':
        return `Prontos para remover ${removal}+ dias`;
      default:
        return FILTERS.find(filter => filter.key === filterKey)?.label ||
          filterKey;
    }
  }

  function updateChipCounts(counts) {
    if (!state.chipContainer) {
      return;
    }

    for (const button of state.chipContainer.querySelectorAll(
      '[data-v1309-filter]'
    )) {
      const key = button.dataset.v1309Filter;
      const count = counts[key] ?? 0;
      const label = getFilterLabel(key);

      button.replaceChildren();

      const labelNode = document.createElement('span');
      labelNode.textContent = label;

      const countNode = document.createElement('strong');
      countNode.className = 'icm-filter-count-v1309';
      countNode.textContent = String(count);

      button.append(labelNode, countNode);
      button.classList.toggle('active', key === state.activeFilter);
      button.setAttribute(
        'aria-pressed',
        key === state.activeFilter ? 'true' : 'false'
      );
    }
  }

  function findPresentationCounter() {
    const root = findRoot();
    if (!root) {
      return null;
    }

    const elements = root.querySelectorAll(
      'small, span, p, div'
    );

    for (const element of elements) {
      if (element.children.length > 0) {
        continue;
      }

      const text = normalize(element.textContent);
      if (text.includes('dispositivo(s) apresentado')) {
        return element;
      }
    }

    return null;
  }

  function updateSummary(visibleCount, totalCount) {
    const summary = document.getElementById('icmFilterSummaryV1309');
    const activeLabel = getFilterLabel(state.activeFilter);

    if (summary) {
      summary.textContent =
        `${activeLabel}: ${visibleCount} de ${totalCount} equipamento(s).`;
    }

    const presentationCounter = findPresentationCounter();
    if (presentationCounter) {
      presentationCounter.textContent =
        `${visibleCount} dispositivo(s) apresentado(s)`;
    }
  }

  function findDashboardCard(labelPart) {
    const dashboard = document.querySelector(
      `${ROOT_SELECTOR} .icm-dashboard`
    );

    if (!dashboard) {
      return null;
    }

    const normalizedPart = normalize(labelPart);

    return Array.from(
      dashboard.querySelectorAll('.icm-card')
    ).find(card => {
      const label = card.querySelector('span');
      return label &&
        normalize(label.textContent).includes(normalizedPart);
    }) || null;
  }

  function updateDashboardCards(counts) {
    const preventiveCard =
      findDashboardCard('pré-alerta 10+ dias') ||
      findDashboardCard('pre-alerta 10+ dias') ||
      findDashboardCard('sem sincronização');

    if (preventiveCard) {
      const label = preventiveCard.querySelector('span');
      const value = preventiveCard.querySelector('strong');

      if (label) {
        label.textContent =
          `Sem sincronização ${state.thresholds.notificationStartDays}+ dias`;
      }

      if (value) {
        value.textContent = String(counts.stale10Plus);
      }
    }

    const imminentCard = findDashboardCard('remoção iminente');
    if (imminentCard) {
      const label = imminentCard.querySelector('span');
      const value = imminentCard.querySelector('strong');

      if (label) {
        label.textContent =
          `Remoção iminente (${state.thresholds.removalDays - 1} dias)`;
      }

      if (value) {
        value.textContent = String(counts.imminent);
      }
    }

    const dashboard = document.querySelector(
      `${ROOT_SELECTOR} .icm-dashboard`
    );

    if (!dashboard) {
      return;
    }

    let readyCard = document.getElementById(
      'icmReadyRemovalCardV1309'
    );

    if (!readyCard) {
      readyCard = document.createElement('article');
      readyCard.id = 'icmReadyRemovalCardV1309';
      readyCard.className = 'icm-card danger';
      readyCard.innerHTML =
        '<span></span><strong id="icmReadyRemovalCountV1309">0</strong>';
      dashboard.appendChild(readyCard);
    }

    const readyLabel = readyCard.querySelector('span');
    const readyValue = readyCard.querySelector('strong');

    if (readyLabel) {
      readyLabel.textContent =
        `Prontos para remover (${state.thresholds.removalDays}+ dias)`;
    }

    if (readyValue) {
      readyValue.textContent = String(counts.ready);
    }
  }

  function applyFilter() {
    const rows = getRows();
    const rowData = rows.map(readRow);
    const counts = calculateCounts(rowData);

    let visibleCount = 0;

    for (const data of rowData) {
      const visible = matchesFilter(
        data,
        state.activeFilter
      );

      data.row.hidden = !visible;
      data.row.classList.toggle(
        'icm-filtered-out-v1309',
        !visible
      );

      if (visible) {
        visibleCount += 1;
      }
    }

    updateChipCounts(counts);
    updateSummary(visibleCount, rowData.length);
    updateDashboardCards(counts);
  }

  function selectFilter(filterKey) {
    if (!FILTERS.some(filter => filter.key === filterKey)) {
      filterKey = 'all';
    }

    state.activeFilter = filterKey;
    applyFilter();
  }

  function ensureStyles() {
    let style = document.getElementById(
      'icmFiltersStyleV1309'
    );

    if (style) {
      return;
    }

    style = document.createElement('style');
    style.id = 'icmFiltersStyleV1309';
    style.textContent = `
      #icmFiltersV1309 {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
      }

      #icmFiltersV1309 .icm-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }

      #icmFiltersV1309 .icm-filter-count-v1309 {
        display: inline-flex;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 999px;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.09);
        font-size: 11px;
        line-height: 1;
      }

      #icmFiltersV1309 .icm-chip.active
        .icm-filter-count-v1309 {
        background: rgba(255, 255, 255, 0.23);
      }

      #icmFilterHelpV1309 {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 18px;
        align-items: center;
        margin: 8px 0 10px;
        padding: 9px 12px;
        border: 1px solid rgba(180, 0, 25, 0.18);
        border-left: 4px solid #d71920;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.78);
        font-size: 12px;
      }

      #icmFilterSummaryV1309 {
        font-weight: 700;
      }

      #icmFilterHelpV1309 .icm-filter-help-text-v1309 {
        opacity: 0.78;
      }

      #icmReadyRemovalCardV1309 {
        border-left: 3px solid #d71920;
      }

      tr.icm-filtered-out-v1309 {
        display: none !important;
      }

      @media (max-width: 900px) {
        #icmFiltersV1309 .icm-chip {
          width: auto !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function ensureHelpPanel(filterContainer) {
    let panel = document.getElementById(
      'icmFilterHelpV1309'
    );

    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'icmFilterHelpV1309';
      panel.innerHTML = `
        <span id="icmFilterSummaryV1309">
          A preparar filtros...
        </span>
        <span class="icm-filter-help-text-v1309">
          Carência é o estado devolvido pelo Intune.
          Pré-alerta e remoção são calculados pelos dias sem sincronização.
        </span>
      `;

      filterContainer.insertAdjacentElement(
        'afterend',
        panel
      );
    }
  }

  function rebuildFilterBar() {
    const existingChip = document.querySelector(
      `${ROOT_SELECTOR} .icm-chip`
    );

    if (!existingChip) {
      return false;
    }

    const container = existingChip.parentElement;
    if (!container) {
      return false;
    }

    state.chipContainer = container;
    container.id = 'icmFiltersV1309';

    for (const oldChip of Array.from(
      container.querySelectorAll('.icm-chip')
    )) {
      oldChip.remove();
    }

    for (const filter of FILTERS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'icm-chip';
      button.dataset.v1309Filter = filter.key;
      button.title = filter.title;
      button.setAttribute('aria-pressed', 'false');
      container.appendChild(button);
    }

    state.chipCaptureHandler = event => {
      const button = event.target.closest(
        '[data-v1309-filter]'
      );

      if (!button || !container.contains(button)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      selectFilter(button.dataset.v1309Filter);
    };

    container.addEventListener(
      'click',
      state.chipCaptureHandler,
      true
    );

    ensureHelpPanel(container);
    return true;
  }

  function scheduleRefresh(delay = 80) {
    window.clearTimeout(state.mutationTimer);
    state.mutationTimer = window.setTimeout(() => {
      if (!state.destroyed) {
        applyFilter();
      }
    }, delay);
  }

  function observeRows() {
    const tbody = findMainTbody();
    if (!tbody) {
      return false;
    }

    state.tbody = tbody;

    state.observer = new MutationObserver(() => {
      scheduleRefresh(100);
    });

    state.observer.observe(tbody, {
      childList: true,
      subtree: true
    });

    return true;
  }

  async function init() {
    if (state.destroyed) {
      return;
    }

    ensureStyles();

    const root = findRoot();
    if (!root) {
      state.retryTimer = window.setTimeout(init, 250);
      return;
    }

    const filterReady = rebuildFilterBar();
    const tableReady = observeRows();

    if (!filterReady || !tableReady) {
      state.retryTimer = window.setTimeout(init, 250);
      return;
    }

    applyFilter();

    await loadThresholds();

    if (!state.destroyed) {
      applyFilter();
      console.info(
        `V${VERSION}: filtros separados instalados.`,
        {
          notificationStartDays:
            state.thresholds.notificationStartDays,
          removalDays:
            state.thresholds.removalDays
        }
      );
    }
  }

  function destroy() {
    state.destroyed = true;

    window.clearTimeout(state.mutationTimer);
    window.clearTimeout(state.retryTimer);

    if (state.observer) {
      state.observer.disconnect();
    }

    if (state.chipContainer &&
        state.chipCaptureHandler) {
      state.chipContainer.removeEventListener(
        'click',
        state.chipCaptureHandler,
        true
      );
    }
  }

  window.__icmFiltersV1309 = {
    version: VERSION,
    state,
    applyFilter,
    selectFilter,
    destroy
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );
  } else {
    window.setTimeout(init, 0);
  }
})();
/* END INTUNE FILTERS V13.0.9 */

/* BEGIN LIFECYCLE FETCH RELIABILITY V13.0.10 */
(() => {
  'use strict';

  if (window.__icmLifecycleFetchReliabilityV13010) return;
  window.__icmLifecycleFetchReliabilityV13010 = true;

  const previousFetch = window.fetch.bind(window);
  const longActions = new Set([
    'scan',
    'reconcileLifecycle',
    'reconcilePreventiveIntune',
    'refreshPreventiveControl',
    'validatePreventiveResolutions'
  ]);
  let longOperations = 0;
  let lifecycleRequest = null;

  function actionOf(input) {
    try {
      const raw = typeof input === 'string'
        ? input
        : (input && input.url ? input.url : String(input || ''));
      return String(new URL(raw, window.location.origin).searchParams.get('action') || '');
    } catch {
      return '';
    }
  }

  function delay(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  async function waitForLongOperations() {
    const startedAt = Date.now();
    while (longOperations > 0 && Date.now() - startedAt < 90000) {
      await delay(250);
    }
  }

  async function fetchLifecycleWithRetry(input, init) {
    await waitForLongOperations();
    let lastError = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await previousFetch(input, init);
      } catch (error) {
        lastError = error;
        if (attempt < 2) await delay(700 * (attempt + 1));
      }
    }

    throw lastError || new Error('Falha temporária ao atualizar o controlo preventivo.');
  }

  window.fetch = async function icmReliableLifecycleFetch(input, init) {
    const action = actionOf(input);

    if (action === 'getLifecycle') {
      if (!lifecycleRequest) {
        lifecycleRequest = fetchLifecycleWithRetry(input, init)
          .finally(() => { lifecycleRequest = null; });
      }

      const response = await lifecycleRequest;
      return response.clone();
    }

    if (!longActions.has(action)) {
      return previousFetch(input, init);
    }

    longOperations += 1;
    try {
      return await previousFetch(input, init);
    } finally {
      longOperations = Math.max(0, longOperations - 1);
    }
  };

  console.info('V13.0.10: proteção das consultas de ciclo de vida instalada.');
})();
/* END LIFECYCLE FETCH RELIABILITY V13.0.10 */

/* BEGIN VIP USERS UI V1 */
(() => {
  'use strict';

  window.__icmLifecycleProgressV1308Installed =
    window.__icmLifecycleProgressV1308Installed ||
    Boolean(document.querySelector('#icmLifecycleProgressV1308')) ||
    Boolean(window.__icmLifecycleProgressV1308);

  if (window.__icmVipUsersV1Loaded) return;
  window.__icmVipUsersV1Loaded = true;

  const state = {
    users: [],
    activeOnly: true,
    editingUpn: '',
    observer: null,
    timer: null
  };

  const apiUrl = '/module/intune-conformidade-mobile/api';

  const clean = value => String(value ?? '').trim();
  const normalize = value => clean(value).toLowerCase();

  const esc = value => clean(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

  function parseJson(value) {
    let current = value;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (typeof current !== 'string') break;
      const text = current.trim();
      if (!text) return null;
      try { current = JSON.parse(text); } catch { break; }
    }
    return current;
  }

  async function vipApi(action, payload = null, method = 'GET') {
    const url = new URL(apiUrl, window.location.origin);
    url.searchParams.set('action', action);

    const options = {
      method,
      cache: 'no-store',
      headers: {}
    };

    if (method !== 'GET') {
      options.headers['Content-Type'] = 'application/json; charset=utf-8';
      options.body = JSON.stringify(payload || {});
    }

    const response = await window.fetch(url.toString(), options);
    const text = await response.text();
    const data = parseJson(text) || {};

    if (!response.ok || data.success === false) {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

    return data;
  }

  function enabledUsers() {
    return state.users.filter(user => user.enabled !== false);
  }

  function findVipInText(text) {
    const normalizedText = normalize(text);
    return enabledUsers().find(user =>
      normalizedText.includes(normalize(user.upn))
    ) || null;
  }

  function ensureButton() {
    if (document.getElementById('icmManageVipV1')) return;

    const toolbar =
      document.querySelector('#icmRoot .icm-toolbar') ||
      document.querySelector('.icm-toolbar');

    if (!toolbar) return;

    const button = document.createElement('button');
    button.id = 'icmManageVipV1';
    button.type = 'button';
    button.className = 'icm-btn icm-btn-vip';
    button.textContent = 'Gerir VIPs';
    button.title = 'Adicionar, editar, ativar ou desativar utilizadores VIP.';
    button.addEventListener('click', openModal);

    const exportButton = Array.from(toolbar.querySelectorAll('button'))
      .find(item => /export/i.test(item.textContent || ''));

    if (exportButton) {
      toolbar.insertBefore(button, exportButton);
    } else {
      toolbar.appendChild(button);
    }
  }

  function ensureModal() {
    let modal = document.getElementById('icmVipModalV1');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'icmVipModalV1';
    modal.className = 'vip-modal-overlay';
    modal.innerHTML = `
      <div class="vip-modal" role="dialog" aria-modal="true" aria-label="Gestão de utilizadores VIP">
        <div class="vip-modal-header">
          <div>
            <h2>Gestão de utilizadores VIP</h2>
            <p>Notificações e remoções exigem validação manual.</p>
          </div>
          <button type="button" class="vip-modal-close" data-vip-close>&times;</button>
        </div>
        <div class="vip-modal-body">
          <form class="vip-form" id="icmVipFormV1">
            <label class="vip-upn-field-v3">
              Utilizador / UPN
              <div class="vip-upn-search-v3">
                <input id="icmVipUpnV1" type="text" required
                  placeholder="Ex.: s615462 ou utilizador@corp.santander.pt"
                  autocomplete="off">
                <button id="icmVipLookupV3" class="icm-btn icm-btn-light"
                  type="button">Procurar</button>
              </div>
              <small>Informe apenas o ID ou o UPN completo.</small>
            </label>
            <label>
              Nome
              <input id="icmVipNameV1" type="text" placeholder="Nome do utilizador">
            </label>
            <label>
              Observações
              <textarea id="icmVipNotesV1" placeholder="Cargo, área ou motivo da proteção"></textarea>
            </label>
            <div class="vip-form-actions">
              <button class="icm-btn icm-btn-primary" type="submit">Guardar</button>
              <button class="icm-btn icm-btn-light" type="button" data-vip-clear>Limpar</button>
            </div>
            <label class="vip-form-enabled">
              <input id="icmVipEnabledV1" type="checkbox" checked>
              Proteção VIP ativa
            </label>
          </form>
          <div id="icmVipMessageV1" class="vip-message"></div>
          <div class="vip-list-wrap">
            <table class="vip-table">
              <thead>
                <tr>
                  <th>UPN</th>
                  <th>Nome</th>
                  <th>Observações</th>
                  <th>Estado</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody id="icmVipRowsV1"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    modal.querySelector('[data-vip-close]').addEventListener('click', closeModal);
    modal.querySelector('[data-vip-clear]').addEventListener('click', clearForm);
    modal.addEventListener('click', event => {
      if (event.target === modal) closeModal();
    });
    modal.querySelector('#icmVipFormV1').addEventListener('submit', saveUser);
    modal.querySelector('#icmVipLookupV3').addEventListener('click', lookupVipUserV3);
    modal.querySelector('#icmVipUpnV1').addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        lookupVipUserV3();
      }
    });
    modal.querySelector('#icmVipUpnV1').addEventListener('blur', () => {
      const input = document.getElementById('icmVipUpnV1');
      const value = clean(input?.value);
      if (
        value &&
        !state.editingUpn &&
        !value.includes('@') &&
        value.length >= 4
      ) {
        window.setTimeout(() => {
          if (document.activeElement?.id !== 'icmVipLookupV3') {
            lookupVipUserV3();
          }
        }, 120);
      }
    });

    document.body.appendChild(modal);
    return modal;
  }

  function setMessage(message, isError = false) {
    const element = document.getElementById('icmVipMessageV1');
    if (!element) return;
    element.textContent = message || '';
    element.classList.toggle('is-error', isError);
  }

  function clearForm() {
    state.editingUpn = '';
    const upn = document.getElementById('icmVipUpnV1');
    const name = document.getElementById('icmVipNameV1');
    const notes = document.getElementById('icmVipNotesV1');
    const enabled = document.getElementById('icmVipEnabledV1');

    if (upn) {
      upn.value = '';
      upn.readOnly = false;
    }
    if (name) name.value = '';
    if (notes) notes.value = '';
    if (enabled) enabled.checked = true;
    setMessage('');
  }

  function renderList() {
    const tbody = document.getElementById('icmVipRowsV1');
    if (!tbody) return;

    if (!state.users.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="vip-empty">Nenhum utilizador VIP configurado.</td></tr>';
      return;
    }

    tbody.innerHTML = state.users.map(user => `
      <tr data-vip-upn="${esc(user.upn)}">
        <td><strong>${esc(user.upn)}</strong></td>
        <td>${esc(user.name || '—')}</td>
        <td><small>${esc(user.notes || '—')}</small></td>
        <td>
          <span class="${user.enabled !== false ? 'vip-enabled' : 'vip-disabled'}">
            ${user.enabled !== false ? 'Ativo' : 'Inativo'}
          </span>
        </td>
        <td>
          <div class="vip-row-actions">
            <button type="button" data-vip-edit>Editar</button>
            <button type="button" data-vip-toggle>
              ${user.enabled !== false ? 'Desativar' : 'Ativar'}
            </button>
            <button type="button" class="vip-delete" data-vip-delete>Eliminar</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-vip-edit]').forEach(button => {
      button.addEventListener('click', () => editUser(button.closest('tr').dataset.vipUpn));
    });

    tbody.querySelectorAll('[data-vip-toggle]').forEach(button => {
      button.addEventListener('click', () => toggleUser(button.closest('tr').dataset.vipUpn));
    });

    tbody.querySelectorAll('[data-vip-delete]').forEach(button => {
      button.addEventListener('click', () => deleteUser(button.closest('tr').dataset.vipUpn));
    });
  }

  async function loadUsers() {
    const data = await vipApi('getVipUsers');
    state.users = Array.isArray(data.users) ? data.users : [];
    renderList();
    decorate();
  }

  async function openModal() {
    ensureModal().classList.add('is-open');
    clearForm();
    try {
      await loadUsers();
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  function closeModal() {
    document.getElementById('icmVipModalV1')?.classList.remove('is-open');
  }

  function editUser(upn) {
    const user = state.users.find(item => normalize(item.upn) === normalize(upn));
    if (!user) return;

    state.editingUpn = user.upn;
    document.getElementById('icmVipUpnV1').value = user.upn;
    document.getElementById('icmVipUpnV1').readOnly = true;
    document.getElementById('icmVipNameV1').value = user.name || '';
    document.getElementById('icmVipNotesV1').value = user.notes || '';
    document.getElementById('icmVipEnabledV1').checked = user.enabled !== false;
  }

  function setLookupBusyV3(isBusy) {
    const button = document.getElementById('icmVipLookupV3');
    const input = document.getElementById('icmVipUpnV1');

    if (button) {
      button.disabled = Boolean(isBusy);
      button.textContent = isBusy ? 'A procurar...' : 'Procurar';
    }

    if (input) {
      input.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    }
  }

  function fillVipUserV3(user) {
    if (!user) return;

    const upn = document.getElementById('icmVipUpnV1');
    const name = document.getElementById('icmVipNameV1');
    const notes = document.getElementById('icmVipNotesV1');

    if (upn && user.upn) upn.value = user.upn;
    if (name && user.name) name.value = user.name;

    if (notes && !clean(notes.value)) {
      notes.value =
        user.notesSuggestion ||
        [user.jobTitle, user.department].filter(Boolean).join(' — ');
    }
  }

  function chooseVipUserV3(users) {
    const options = Array.isArray(users) ? users : [];
    if (!options.length) return null;
    if (options.length === 1) return options[0];

    const lines = options.map((user, index) =>
      `${index + 1}. ${user.name || 'Sem nome'} — ${user.upn}`
    );

    const answer = prompt(
      `Foram encontrados ${options.length} utilizadores.\n\n` +
      `${lines.join('\n')}\n\n` +
      'Informe o número do utilizador correto:',
      '1'
    );

    if (answer === null) return null;

    const selectedIndex = Number.parseInt(answer, 10) - 1;
    if (
      Number.isNaN(selectedIndex) ||
      selectedIndex < 0 ||
      selectedIndex >= options.length
    ) {
      alert('Seleção inválida.');
      return null;
    }

    return options[selectedIndex];
  }

  async function lookupVipUserV3() {
    const input = document.getElementById('icmVipUpnV1');
    const identity = clean(input?.value);

    if (!identity) {
      setMessage('Informe o ID, UPN ou e-mail do utilizador.', true);
      input?.focus();
      return;
    }

    setLookupBusyV3(true);
    setMessage('A procurar o utilizador no Microsoft Graph...');

    try {
      const data = await vipApi(
        'lookupVipUser',
        { identity },
        'POST'
      );

      if (!data.found) {
        setMessage(
          data.message || 'Utilizador não encontrado no Microsoft Graph.',
          true
        );
        return;
      }

      const selected = data.multiple
        ? chooseVipUserV3(data.users)
        : (data.user || data.users?.[0]);

      if (!selected) {
        setMessage('Pesquisa cancelada.');
        return;
      }

      fillVipUserV3(selected);

      const existing = state.users.find(user =>
        normalize(user.upn) === normalize(selected.upn)
      );

      if (existing) {
        editUser(existing.upn);
        setMessage(
          'O utilizador já existe na lista VIP. Os dados foram carregados para edição.'
        );
      } else {
        setMessage(
          `Utilizador encontrado: ${selected.name || selected.upn}. Confirme e clique em Guardar.`
        );
      }
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      setLookupBusyV3(false);
    }
  }
  async function saveUser(event) {
    event.preventDefault();

    const originalIdentityV3 = clean(
      document.getElementById('icmVipUpnV1')?.value
    );

    if (originalIdentityV3 && !originalIdentityV3.includes('@')) {
      await lookupVipUserV3();
    }

    const resolvedUpnV3 = clean(
      document.getElementById('icmVipUpnV1')?.value
    );

    if (!resolvedUpnV3.includes('@')) {
      setMessage(
        'Pesquise e selecione um utilizador válido antes de guardar.',
        true
      );
      return;
    }

    const payload = {
      upn: clean(document.getElementById('icmVipUpnV1')?.value),
      name: clean(document.getElementById('icmVipNameV1')?.value),
      notes: clean(document.getElementById('icmVipNotesV1')?.value),
      enabled: Boolean(document.getElementById('icmVipEnabledV1')?.checked),
      changedBy: 'Operador local'
    };

    try {
      const data = await vipApi('saveVipUser', payload, 'POST');
      state.users = Array.isArray(data.users) ? data.users : state.users;
      renderList();
      clearForm();
      setMessage('Utilizador VIP guardado.');
      decorate();
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  async function toggleUser(upn) {
    try {
      const data = await vipApi('toggleVipUser', {
        upn,
        changedBy: 'Operador local'
      }, 'POST');
      state.users = Array.isArray(data.users) ? data.users : state.users;
      renderList();
      decorate();
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  async function deleteUser(upn) {
    if (!confirm(`Eliminar ${upn} da lista VIP?`)) return;

    try {
      const data = await vipApi('deleteVipUser', {
        upn,
        changedBy: 'Operador local'
      }, 'POST');
      state.users = Array.isArray(data.users) ? data.users : state.users;
      renderList();
      decorate();
    } catch (error) {
      setMessage(error.message, true);
    }
  }

  function addBadge(cell, vip) {
    if (!cell || cell.querySelector('.icm-vip-badge')) return;

    const badge = document.createElement('span');
    badge.className = 'icm-vip-badge';
    badge.textContent = 'VIP';
    badge.title = vip.notes || vip.name || 'Utilizador VIP';

    let wrapper = cell.querySelector('.icm-user-with-badge');
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'icm-user-with-badge';
      while (cell.firstChild) wrapper.appendChild(cell.firstChild);
      cell.appendChild(wrapper);
    }
    wrapper.appendChild(badge);
  }

  function decorateTable(tbody) {
    if (!tbody) return;

    Array.from(tbody.querySelectorAll('tr')).forEach(row => {
      if (row.querySelector('td[colspan]')) return;

      const vip = findVipInText(row.innerText || row.textContent || '');
      row.classList.toggle('icm-row-vip', Boolean(vip));
      row.dataset.isVip = vip ? 'true' : 'false';

      if (!vip) {
        row.querySelectorAll('.icm-vip-badge')
          .forEach(badge => badge.remove());
      }

      if (vip) {
        const emailCell = Array.from(row.cells).find(cell =>
          normalize(cell.textContent).includes(normalize(vip.upn))
        ) || row.cells[1] || row.cells[0];

        const existingBadge =
          row.querySelector('.icm-vip-badge');

        if (existingBadge) {
          existingBadge.title =
            vip.notes || vip.name || 'Utilizador VIP';
        } else {
          addBadge(emailCell, vip);
        }

        const normalizedText = normalize(row.innerText);
        const ready =
          normalizedText.includes('readyforremoval') ||
          normalizedText.includes('readytoremove') ||
          normalizedText.includes('pronto para remover') ||
          normalizedText.includes('a validar resolucao');

        if (ready) {
          row.dataset.preventiveStatus = 'AwaitingVipValidation';
        }
      }
    });
  }

  function ensureVipFilter() {
    const container = document.getElementById('icmFiltersV1309');
    if (!container || document.getElementById('icmVipFilterV1')) return;

    const button = document.createElement('button');
    button.id = 'icmVipFilterV1';
    button.type = 'button';
    button.className = 'icm-chip';
    button.innerHTML = '<span>Utilizadores VIP</span><strong class="icm-filter-count-v1309">0</strong>';

    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();

      const active = !button.classList.contains('active');
      container.querySelectorAll('.icm-chip').forEach(chip => chip.classList.remove('active'));
      button.classList.toggle('active', active);

      const tbody =
        document.getElementById('icmTbody') ||
        document.getElementById('icmTableBody') ||
        document.querySelector('#icmRoot .icm-table tbody');

      if (!tbody) return;

      Array.from(tbody.querySelectorAll('tr')).forEach(row => {
        if (row.querySelector('td[colspan]')) return;
        row.classList.toggle(
          'icm-vip-filtered-out',
          active && row.dataset.isVip !== 'true'
        );
      });
    }, true);

    container.appendChild(button);
  }

  function updateDashboard() {
    const dashboard = document.querySelector('#icmRoot .icm-dashboard');
    if (!dashboard) return;

    const mainRows = Array.from(
      (document.getElementById('icmTbody') ||
       document.getElementById('icmTableBody') ||
       document.querySelector('#icmRoot .icm-table tbody'))
      ?.querySelectorAll('tr') || []
    );

    const vipRows = mainRows.filter(row => row.dataset.isVip === 'true');
    const critical = vipRows.filter(row =>
      row.dataset.preventiveStatus === 'AwaitingVipValidation'
    );

    let vipCard = document.getElementById('icmVipCardV1');
    if (!vipCard) {
      vipCard = document.createElement('article');
      vipCard.id = 'icmVipCardV1';
      vipCard.className = 'icm-card vip';
      vipCard.innerHTML = '<span>Equipamentos VIP</span><strong>0</strong>';
      dashboard.appendChild(vipCard);
    }

    let criticalCard = document.getElementById('icmVipCriticalCardV1');
    if (!criticalCard) {
      criticalCard = document.createElement('article');
      criticalCard.id = 'icmVipCriticalCardV1';
      criticalCard.className = 'icm-card vip-critical';
      criticalCard.innerHTML = '<span>VIP a validar</span><strong>0</strong>';
      dashboard.appendChild(criticalCard);
    }

    const vipValue = vipCard.querySelector('strong');
    const criticalValue =
      criticalCard.querySelector('strong');

    if (
      vipValue &&
      vipValue.textContent !== String(vipRows.length)
    ) {
      vipValue.textContent = String(vipRows.length);
    }

    if (
      criticalValue &&
      criticalValue.textContent !== String(critical.length)
    ) {
      criticalValue.textContent = String(critical.length);
    }

    const filterCount = document.querySelector(
      '#icmVipFilterV1 .icm-filter-count-v1309'
    );

    if (
      filterCount &&
      filterCount.textContent !== String(vipRows.length)
    ) {
      filterCount.textContent = String(vipRows.length);
    }
  }

  function protectVipActions() {
    document.querySelectorAll(
      '#implRows tr[data-is-vip="true"] button, #imlRows tr[data-is-vip="true"] button'
    ).forEach(button => {
      if (button.dataset.vipProtected === '1') return;
      if (!/remov|regulariz|estado|validar/i.test(button.textContent || '')) return;

      button.dataset.vipProtected = '1';
      button.classList.add('is-vip-action');

      button.addEventListener('click', event => {
        const approved = confirm(
          'ATENÇÃO — UTILIZADOR VIP\n\n' +
          'Confirma que validou manualmente esta operação e possui autorização para continuar?'
        );

        if (!approved) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }

        const note = prompt(
          'Justificação obrigatória para a operação VIP:',
          ''
        );

        if (!clean(note)) {
          alert('A operação VIP foi cancelada porque a justificação não foi informada.');
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }

        window.__icmVipManualApprovalV1 = {
          approved: true,
          note,
          expiresAt: Date.now() + 60000
        };
      }, true);
    });
  }

  function decorate() {
    ensureButton();
    ensureVipFilter();

    [
      document.getElementById('icmTbody'),
      document.getElementById('icmTableBody'),
      document.querySelector('#icmRoot .icm-table tbody'),
      document.getElementById('implRows'),
      document.getElementById('imlRows')
    ].filter(Boolean).forEach(decorateTable);

    updateDashboard();
    protectVipActions();
  }

  function scheduleDecorate() {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(decorate, 120);
  }

  async function init() {
    ensureButton();
    ensureModal();

    try {
      await loadUsers();
    } catch (error) {
      console.warn('VIP V2: lista VIP ainda não disponível.', error);
    }

    function installTargetedObserversV31() {
      if (state.observer) {
        state.observer.disconnect();
      }

      state.observer = new MutationObserver(() => {
        scheduleDecorate();
      });

      const targets = [
        document.getElementById('icmTbody'),
        document.getElementById('icmTableBody'),
        document.getElementById('implRows'),
        document.getElementById('imlRows')
      ].filter(Boolean);

      targets.forEach(target => {
        state.observer.observe(target, {
          childList: true,
          subtree: true
        });
      });
    }

    installTargetedObserversV31();

    window.addEventListener(
      'preventive-v126-reconciled',
      () => {
        installTargetedObserversV31();
        scheduleDecorate();
      }
    );

    document.addEventListener('click', event => {
      if (
        event.target.closest(
          '#icmSearch, #icmSearchBtn, #implRefresh, ' +
          '#implReconcile, #imlRefresh, #imlReconcile'
        )
      ) {
        window.setTimeout(() => {
          installTargetedObserversV31();
          scheduleDecorate();
        }, 500);
      }
    });

    decorate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    window.setTimeout(init, 0);
  }
})();
/* END VIP USERS UI V1 */
