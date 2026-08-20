(() => {
  "use strict";

  const state = {
    rows: [],
    filtered: [],
    selected: null,
    filter: "all",
    connected: false
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    search: $("icmSearch"),
    connect: $("icmConnect"),
    searchUser: $("icmSearchUser"),
    scan: $("icmScan"),
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
    let data;

    try { data = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error(raw || `Erro HTTP ${response.status}`); }

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
        case "Android":
          return String(row.operatingSystem || "").toLowerCase().includes("android");
        case "iOS":
          return /ios|ipados/i.test(String(row.operatingSystem || ""));
        case "high":
          return normalizeState(row.risk) === "alto";
        default:
          return true;
      }
    });

    renderTable();
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
  }

  function renderTable() {
    els.tbody.innerHTML = "";

    if (!state.filtered.length) {
      els.tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:35px;color:#667085">Nenhum dispositivo encontrado.</td></tr>`;
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
        <td>${escapeHtml(row.userPrincipalName)}</td>
        <td>${escapeHtml(`${row.operatingSystem || ""} ${row.osVersion || ""}`)}</td>
        <td>${escapeHtml(row.model || "—")}</td>
        <td>${stateBadge(row.complianceState)}</td>
        <td>${escapeHtml(formatDate(row.graceExpiration))}</td>
        <td>${escapeHtml(formatDate(row.lastSyncDateTime))}</td>
        <td>${escapeHtml(row.diagnosticCategory || "Conformidade Intune")}</td>
        <td>
          <button class="icm-btn icm-btn-light icm-row-open" data-id="${escapeHtml(row.managedDeviceId)}">Detalhes</button>
        </td>
      `;

      tr.addEventListener("click", () => selectRow(row));
      els.tbody.appendChild(tr);
    }
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
      state.rows = result.rows || [];
      state.selected = null;
      updateDashboard();
      applyFilter();

      if (state.filtered[0]) selectRow(state.filtered[0]);
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
      "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7&sysparm_category=6f044c7c1b1945505ae05532604bcb04",
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
  els.searchUser.addEventListener("click", () => runSearch("user"));
  els.scan.addEventListener("click", () => runSearch("allProblems"));
  els.exportBtn.addEventListener("click", exportCsv);
  els.clear.addEventListener("click", clearAll);
  els.search.addEventListener("keydown", event => {
    if (event.key === "Enter") runSearch("user");
  });

  $("icmCopyTicket").addEventListener("click", copyTicket);
  $("icmOpenServiceNow").addEventListener("click", openServiceNow);
  $("icmOpenIntune").addEventListener("click", openIntune);

  api("status")
    .then(result => {
      if (result.connected) {
        state.connected = true;
        els.connDot.classList.add("on");
        els.connText.textContent = `Ligado: ${result.account || "Microsoft Graph"}`;
      }
    })
    .catch(() => {});

  renderTable();
})();

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
