(function () {
  "use strict";

  var MODULE_ID = "relatorio-cib";
  var STYLE_ID = "relatorio-cib-inline-style";
  var API_URL = "/module/" + MODULE_ID + "/api";

  function ensureStyle() {
    var old = document.getElementById(STYLE_ID);
    if (old) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.type = "text/css";
    style.textContent = ".cib-module{\n  --cib-red:#ec0000;\n  --cib-red-dark:#b90000;\n  --cib-ink:#242424;\n  --cib-muted:#667085;\n  --cib-line:#e4e7ec;\n  --cib-bg:#f5f6f8;\n  --cib-card:#ffffff;\n  --cib-success:#067647;\n  --cib-warning:#b54708;\n  --cib-danger:#b42318;\n  min-height:100%;\n  background:var(--cib-bg);\n  color:var(--cib-ink);\n  font-family:\"Segoe UI\",Arial,sans-serif;\n}\n.cib-module *{box-sizing:border-box}\n.cib-hero{\n  padding:24px 28px;\n  background:linear-gradient(120deg,var(--cib-red),#c40000);\n  color:#fff;\n  display:flex;\n  align-items:center;\n  justify-content:space-between;\n  gap:20px;\n}\n.cib-hero h1{margin:4px 0 5px;font-size:29px}\n.cib-hero p{margin:0;opacity:.92}\n.cib-eyebrow{font-size:11px;font-weight:800;letter-spacing:.12em}\n.cib-connection{display:flex;align-items:center;gap:9px;font-weight:700;white-space:nowrap}\n.cib-dot{width:10px;height:10px;border-radius:50%;background:#fda29b;box-shadow:0 0 0 4px rgba(255,255,255,.16)}\n.cib-dot.on{background:#75e0a7}\n.cib-input-card,.cib-filter-card{\n  margin:16px 20px 0;\n  padding:16px;\n  background:var(--cib-card);\n  border:1px solid var(--cib-line);\n  border-radius:14px;\n  box-shadow:0 2px 8px rgba(16,24,40,.04);\n}\n.cib-input-card{display:grid;grid-template-columns:minmax(320px,1fr) 220px;gap:16px}\n.cib-input-main label,.cib-filter-field label,.cib-modal-body>label,.cib-form-grid label{\n  display:block;font-size:12px;font-weight:750;margin-bottom:6px;color:#344054\n}\n.cib-input-main textarea,.cib-filter-field input,.cib-filter-field select,.cib-modal-body input,.cib-modal-body textarea{\n  width:100%;border:1px solid #cfd4dc;border-radius:9px;padding:10px 12px;font:inherit;background:#fff;outline:none\n}\n.cib-input-main textarea:focus,.cib-filter-field input:focus,.cib-filter-field select:focus,.cib-modal-body input:focus,.cib-modal-body textarea:focus{\n  border-color:var(--cib-red);box-shadow:0 0 0 3px rgba(236,0,0,.09)\n}\n.cib-input-meta{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:7px;flex-wrap:wrap}\n.cib-input-help{font-size:11px;color:var(--cib-muted)}\n.cib-save-state{font-size:11px;font-weight:700;color:var(--cib-muted);display:flex;align-items:center;gap:6px}\n.cib-save-state::before{content:\"\";width:7px;height:7px;border-radius:50%;background:#98a2b3}\n.cib-save-state.saved{color:var(--cib-success)}\n.cib-save-state.saved::before{background:#12b76a}\n.cib-save-state.saving{color:var(--cib-warning)}\n.cib-save-state.saving::before{background:#f79009}\n.cib-save-state.error{color:var(--cib-danger)}\n.cib-save-state.error::before{background:#d92d20}\n.cib-actions{display:flex;flex-direction:column;gap:8px;justify-content:center}\n.cib-btn{border:0;border-radius:9px;padding:10px 14px;font-weight:750;cursor:pointer;transition:.15s ease}\n.cib-btn:hover{transform:translateY(-1px)}\n.cib-btn:disabled{opacity:.5;cursor:not-allowed;transform:none}\n.cib-btn-primary{background:var(--cib-red);color:#fff}\n.cib-btn-primary:hover{background:var(--cib-red-dark)}\n.cib-btn-light{background:#fff;color:#344054;border:1px solid #d0d5dd}\n.cib-btn-ghost{background:#f2f4f7;color:#475467}\n.cib-progress{margin:14px 20px 0;background:#fff;border:1px solid var(--cib-line);border-radius:12px;padding:12px 14px}\n.cib-progress-head{display:flex;justify-content:space-between;gap:15px;font-size:12px;margin-bottom:8px}\n.cib-progress-track{height:8px;background:#eaecf0;border-radius:999px;overflow:hidden}\n.cib-progress-track div{height:100%;width:0;background:var(--cib-red);transition:width .25s ease}\n.cib-summary{display:grid;grid-template-columns:repeat(10,minmax(112px,1fr));gap:10px;padding:14px 20px}\n.cib-stat{background:#fff;border:1px solid var(--cib-line);border-radius:12px;padding:12px;box-shadow:0 2px 6px rgba(16,24,40,.04)}\n.cib-stat span{display:block;color:var(--cib-muted);font-size:11px;font-weight:700;min-height:28px}\n.cib-stat strong{display:block;font-size:23px;margin-top:4px}\n.cib-stat-success{border-left:4px solid #12b76a}\n.cib-stat-warning{border-left:4px solid #f79009}\n.cib-stat-danger{border-left:4px solid #d92d20}\n.cib-filter-card{display:grid;grid-template-columns:minmax(240px,1fr) 180px 190px 180px auto;align-items:end;gap:10px;margin-top:0;overflow:visible}\n.cib-filter-result{font-size:12px;font-weight:750;color:var(--cib-muted);padding:10px 4px;white-space:nowrap}\n.cib-content-grid{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(350px,.72fr);gap:14px;padding:14px 20px 22px}\n.cib-table-card,.cib-detail-card{background:#fff;border:1px solid var(--cib-line);border-radius:14px;box-shadow:0 2px 8px rgba(16,24,40,.04);overflow:hidden}\n.cib-card-head{padding:15px 17px;border-bottom:1px solid var(--cib-line)}\n.cib-card-head h2{margin:0 0 3px;font-size:17px}\n.cib-card-head span{font-size:12px;color:var(--cib-muted)}\n.cib-table-scroll{overflow:auto;max-height:650px}\n.cib-table{width:100%;border-collapse:collapse;font-size:12px;min-width:1280px}\n.cib-table th{position:sticky;top:0;z-index:1;background:#242424;color:#fff;text-align:left;padding:11px 10px;white-space:nowrap}\n.cib-table td{padding:10px;border-bottom:1px solid #eaecf0;vertical-align:top}\n.cib-table tbody tr[data-row-index]{cursor:pointer}\n.cib-table tbody tr[data-row-index]:hover{background:#f9fafb}\n.cib-table tbody tr.selected{background:#fff1f1}\n.cib-empty-row{text-align:center;color:var(--cib-muted);padding:40px!important}\n.cib-badge{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap;background:#f2f4f7;color:#344054}\n.cib-badge.success{background:#dcfae6;color:var(--cib-success)}\n.cib-badge.warning{background:#fff4e5;color:var(--cib-warning)}\n.cib-badge.danger{background:#fee4e2;color:var(--cib-danger)}\n.cib-badge.info{background:#eff8ff;color:#175cd3}\n.cib-detail-card{padding:18px;overflow:auto;max-height:718px}\n.cib-detail-empty{min-height:400px;display:grid;place-items:center;text-align:center;color:var(--cib-muted);padding:35px}\n.cib-detail-title{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;border-bottom:1px solid var(--cib-line);padding-bottom:13px}\n.cib-detail-title h2{margin:4px 0;font-size:20px}\n.cib-detail-title span:not(.cib-badge){font-size:12px;color:var(--cib-muted)}\n.cib-detail-card h3{font-size:13px;margin:16px 0 8px}\n.cib-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}\n.cib-detail-item{border:1px solid var(--cib-line);border-radius:9px;padding:9px;min-width:0}\n.cib-detail-item span{display:block;font-size:9px;font-weight:800;text-transform:uppercase;color:var(--cib-muted);letter-spacing:.04em}\n.cib-detail-item strong{display:block;font-size:11px;margin-top:4px;word-break:break-word;white-space:pre-wrap}\n.cib-hidden{display:none!important}\n.cib-modal{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:20px}\n.cib-modal-backdrop{position:absolute;inset:0;background:rgba(16,24,40,.56)}\n.cib-modal-panel{position:relative;width:min(760px,96vw);max-height:92vh;overflow:auto;background:#fff;border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.28)}\n.cib-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:15px;padding:18px 20px;border-bottom:1px solid var(--cib-line)}\n.cib-modal-head h2{margin:4px 0 0;font-size:20px}\n.cib-modal-close{border:0;background:#f2f4f7;border-radius:8px;width:34px;height:34px;font-size:22px;cursor:pointer}\n.cib-modal-body{padding:18px 20px}\n.cib-modal-body>label{margin-top:12px}\n.cib-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}\n.cib-email-recipient-meta{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:8px 0 4px;flex-wrap:wrap}\n.cib-check-row{display:grid;gap:9px;margin-top:15px;font-size:12px;color:#344054}\n.cib-check-row label{display:flex;align-items:center;gap:8px}\n.cib-check-row input{width:auto}\n.cib-modal-actions{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid var(--cib-line)}\n.cib-toast{position:fixed;right:24px;bottom:24px;z-index:100000;background:#242424;color:#fff;border-radius:10px;padding:12px 16px;box-shadow:0 14px 30px rgba(0,0,0,.25);opacity:0;pointer-events:none;transform:translateY(10px);transition:.2s}\n.cib-toast.show{opacity:1;transform:translateY(0)}\n\n.cib-multi-filter{position:relative}\n.cib-multi-toggle{width:100%;min-height:39px;border:1px solid #cfd4dc;border-radius:9px;padding:9px 34px 9px 12px;background:#fff;font:inherit;text-align:left;cursor:pointer;position:relative;color:#344054;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.cib-multi-toggle::after{content:\"⌄\";position:absolute;right:12px;top:50%;transform:translateY(-55%);font-size:16px;color:#667085}\n.cib-multi-toggle:focus,.cib-multi-toggle.open{border-color:var(--cib-red);box-shadow:0 0 0 3px rgba(236,0,0,.09);outline:none}\n.cib-multi-menu{position:absolute;z-index:50;left:0;right:0;top:calc(100% + 5px);min-width:210px;background:#fff;border:1px solid #d0d5dd;border-radius:10px;box-shadow:0 12px 28px rgba(16,24,40,.18);padding:7px;max-height:270px;overflow:auto}\n.cib-multi-menu label{display:flex!important;align-items:center;gap:9px;margin:0!important;padding:8px 9px;border-radius:7px;font-size:12px!important;font-weight:600!important;color:#344054!important;cursor:pointer}\n.cib-multi-menu label:hover{background:#f2f4f7}\n.cib-multi-menu input{width:auto!important;margin:0;accent-color:var(--cib-red)}\n.cib-multi-menu .cib-multi-all{font-weight:800!important;border-bottom:1px solid #eaecf0;border-radius:7px 7px 0 0;margin-bottom:4px!important}\n@media(max-width:1500px){.cib-summary{grid-template-columns:repeat(5,1fr)}}\n@media(max-width:1150px){\n  .cib-content-grid{grid-template-columns:1fr}\n  .cib-detail-card{max-height:none}\n  .cib-filter-card{grid-template-columns:1fr 1fr 1fr}\n  .cib-filter-search{grid-column:1/-1}\n}\n@media(max-width:760px){\n  .cib-hero{align-items:flex-start;flex-direction:column}\n  .cib-input-card{grid-template-columns:1fr}\n  .cib-actions{display:grid;grid-template-columns:1fr 1fr}\n  .cib-summary{grid-template-columns:repeat(2,1fr)}\n  .cib-filter-card{grid-template-columns:1fr}\n  .cib-filter-search{grid-column:auto}\n  .cib-content-grid{padding-left:10px;padding-right:10px}\n  .cib-detail-grid,.cib-form-grid{grid-template-columns:1fr}\n}\n";
    document.head.appendChild(style);
  }

  ensureStyle();

  var state = {
    rows: [],
    users: [],
    filteredRows: [],
    selectedIndex: -1,
    lastSummary: null,
    saveTimer: null,
    emailSaveTimer: null,
    emailSettingsLoaded: false,
    filters: { os: [], compliance: [], owner: [] }
  };

  function byId(id) { return document.getElementById(id); }

  function text(value, fallback) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return fallback === undefined ? "—" : fallback;
    }
    return String(value);
  }

  function escapeHtml(value) {
    return text(value, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalize(value) {
    return text(value, "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function parseUsers(raw) {
    var seen = Object.create(null);
    return String(raw || "")
      .split(/[\n,;]+/)
      .map(function (item) { return item.trim(); })
      .filter(function (item) {
        var key = item.toLowerCase();
        if (!item || seen[key]) return false;
        seen[key] = true;
        return true;
      });
  }

  var USERS_STORAGE_KEY = "relatorio-cib.saved-users.v1";

  function setUsersSaveState(message, mode) {
    var el = byId("cibUsersSaveState");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("saved", "saving", "error");
    if (mode) el.classList.add(mode);
  }

  function saveUsersLocal(raw) {
    try { window.localStorage.setItem(USERS_STORAGE_KEY, String(raw || "")); } catch (ignore) {}
  }

  function loadUsersLocal() {
    try { return window.localStorage.getItem(USERS_STORAGE_KEY) || ""; } catch (ignore) { return ""; }
  }

  async function saveUsersList(showMessage) {
    var input = byId("cibUsersInput");
    var users = parseUsers(input ? input.value : "");
    saveUsersLocal(input ? input.value : "");
    setUsersSaveState("A guardar alterações...", "saving");

    try {
      var result = await api("saveSavedUsers", { users: users });
      var count = Number(result.count || users.length || 0);
      setUsersSaveState("Lista guardada automaticamente • " + count + " utilizador(es)", "saved");
      if (showMessage) toast("Lista de utilizadores guardada com sucesso.");
      return true;
    } catch (error) {
      setUsersSaveState("Guardado apenas neste navegador • erro no servidor", "error");
      if (showMessage) toast(error.message);
      return false;
    }
  }

  function scheduleUsersSave() {
    var input = byId("cibUsersInput");
    saveUsersLocal(input ? input.value : "");
    setUsersSaveState("Alterações por guardar...", "saving");
    window.clearTimeout(state.saveTimer);
    state.saveTimer = window.setTimeout(function () { saveUsersList(false); }, 700);
  }

  async function loadSavedUsers() {
    var input = byId("cibUsersInput");
    if (!input) return;
    setUsersSaveState("A carregar lista guardada...", "saving");

    try {
      var result = await api("getSavedUsers", {});
      var users = Array.isArray(result.users) ? result.users : [];
      if (users.length) {
        input.value = users.join("\n");
        saveUsersLocal(input.value);
      } else {
        var localValue = loadUsersLocal();
        if (localValue) {
          input.value = localValue;
          await saveUsersList(false);
          return;
        }
      }
      setUsersSaveState("Lista guardada automaticamente • " + users.length + " utilizador(es)", "saved");
    } catch (error) {
      var fallback = loadUsersLocal();
      if (fallback) input.value = fallback;
      setUsersSaveState(fallback ? "Lista recuperada deste navegador" : "Não foi possível carregar a lista guardada", fallback ? "saved" : "error");
    }
  }


  var EMAIL_SETTINGS_STORAGE_KEY = "relatorio-cib.email-settings.v1";

  function normalizeRecipients(raw) {
    var seen = Object.create(null);
    return String(raw || "")
      .split(/[\r\n,;]+/)
      .map(function (item) { return item.trim(); })
      .filter(function (item) {
        var key = item.toLowerCase();
        if (!item || seen[key]) return false;
        seen[key] = true;
        return true;
      })
      .join("; ");
  }

  function setEmailSaveState(message, mode) {
    var el = byId("cibEmailSaveState");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("saved", "saving", "error");
    if (mode) el.classList.add(mode);
  }

  function saveEmailSettingsLocal(to, cc) {
    try {
      window.localStorage.setItem(EMAIL_SETTINGS_STORAGE_KEY, JSON.stringify({ to: to || "", cc: cc || "" }));
    } catch (ignore) {}
  }

  function loadEmailSettingsLocal() {
    try {
      var raw = window.localStorage.getItem(EMAIL_SETTINGS_STORAGE_KEY);
      if (!raw) return { to: "", cc: "" };
      var value = JSON.parse(raw);
      return { to: String(value.to || ""), cc: String(value.cc || "") };
    } catch (ignore) {
      return { to: "", cc: "" };
    }
  }

  async function saveEmailSettings(showMessage) {
    var toInput = byId("cibEmailTo");
    var ccInput = byId("cibEmailCc");
    if (!toInput || !ccInput) return false;

    var to = normalizeRecipients(toInput.value);
    var cc = normalizeRecipients(ccInput.value);
    saveEmailSettingsLocal(to, cc);
    setEmailSaveState("A guardar destinatários...", "saving");

    try {
      var result = await api("saveEmailSettings", { to: to, cc: cc });
      toInput.value = String(result.to || to);
      ccInput.value = String(result.cc || cc);
      state.emailSettingsLoaded = true;
      setEmailSaveState("Destinatários guardados automaticamente", "saved");
      if (showMessage) toast("Destinatários do e-mail guardados.");
      return true;
    } catch (error) {
      setEmailSaveState("Guardado apenas neste navegador • erro no servidor", "error");
      if (showMessage) toast(error.message);
      return false;
    }
  }

  function scheduleEmailSettingsSave() {
    var toInput = byId("cibEmailTo");
    var ccInput = byId("cibEmailCc");
    saveEmailSettingsLocal(toInput ? toInput.value : "", ccInput ? ccInput.value : "");
    setEmailSaveState("Alterações por guardar...", "saving");
    window.clearTimeout(state.emailSaveTimer);
    state.emailSaveTimer = window.setTimeout(function () { saveEmailSettings(false); }, 700);
  }

  async function loadEmailSettings() {
    var toInput = byId("cibEmailTo");
    var ccInput = byId("cibEmailCc");
    if (!toInput || !ccInput) return;
    setEmailSaveState("A carregar destinatários guardados...", "saving");

    try {
      var result = await api("getEmailSettings", {});
      var serverTo = String(result.to || "");
      var serverCc = String(result.cc || "");
      if (serverTo || serverCc) {
        toInput.value = serverTo;
        ccInput.value = serverCc;
        saveEmailSettingsLocal(serverTo, serverCc);
      } else {
        var localValue = loadEmailSettingsLocal();
        if (localValue.to || localValue.cc) {
          toInput.value = localValue.to;
          ccInput.value = localValue.cc;
          await saveEmailSettings(false);
          return;
        }
      }
      state.emailSettingsLoaded = true;
      setEmailSaveState("Destinatários guardados automaticamente", "saved");
    } catch (error) {
      var fallback = loadEmailSettingsLocal();
      toInput.value = fallback.to;
      ccInput.value = fallback.cc;
      setEmailSaveState((fallback.to || fallback.cc) ? "Destinatários recuperados deste navegador" : "Não foi possível carregar os destinatários", (fallback.to || fallback.cc) ? "saved" : "error");
    }
  }

  function filterLabels(group) {
    if (group === "os") return { windows: "Windows", android: "Android", ios: "iOS/iPadOS", other: "Outros sistemas", none: "Sem equipamento" };
    if (group === "compliance") return { compliant: "Conforme", ingraceperiod: "Em carência", noncompliant: "Não conforme", unknown: "Desconhecido" };
    return { company: "Corporativo", personal: "Pessoal", none: "Não informado" };
  }

  function filterButtonId(group) {
    if (group === "os") return "cibFilterOsButton";
    if (group === "compliance") return "cibFilterComplianceButton";
    return "cibFilterOwnerButton";
  }

  function filterMenuId(group) {
    if (group === "os") return "cibFilterOsMenu";
    if (group === "compliance") return "cibFilterComplianceMenu";
    return "cibFilterOwnerMenu";
  }

  function getSelectedFilterValues(group) {
    var root = byId("cibRoot");
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll('[data-cib-filter-option="' + group + '"]:checked')).map(function (el) { return el.value; });
  }

  function updateMultiFilter(group) {
    var values = getSelectedFilterValues(group);
    state.filters[group] = values;
    var all = document.querySelector('[data-cib-filter-all="' + group + '"]');
    if (all) all.checked = values.length === 0;

    var labels = filterLabels(group);
    var button = byId(filterButtonId(group));
    if (button) {
      if (!values.length) button.textContent = "Todos";
      else if (values.length <= 2) button.textContent = values.map(function (value) { return labels[value] || value; }).join(" + ");
      else button.textContent = values.length + " selecionados";
    }
  }

  function closeMultiFilters(exceptGroup) {
    ["os", "compliance", "owner"].forEach(function (group) {
      if (group === exceptGroup) return;
      var menu = byId(filterMenuId(group));
      var button = byId(filterButtonId(group));
      if (menu) menu.classList.add("cib-hidden");
      if (button) { button.classList.remove("open"); button.setAttribute("aria-expanded", "false"); }
    });
  }

  function toggleMultiFilter(group) {
    var menu = byId(filterMenuId(group));
    var button = byId(filterButtonId(group));
    if (!menu || !button) return;
    var willOpen = menu.classList.contains("cib-hidden");
    closeMultiFilters(group);
    menu.classList.toggle("cib-hidden", !willOpen);
    button.classList.toggle("open", willOpen);
    button.setAttribute("aria-expanded", willOpen ? "true" : "false");
  }

  function resetMultiFilters() {
    ["os", "compliance", "owner"].forEach(function (group) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-cib-filter-option="' + group + '"]'), function (el) { el.checked = false; });
      var all = document.querySelector('[data-cib-filter-all="' + group + '"]');
      if (all) all.checked = true;
      updateMultiFilter(group);
    });
    closeMultiFilters();
  }

  function classifyOs(row) {
    if (!row.deviceFound) return "none";
    var value = normalize(row.operatingSystem).replace(/\s/g, "");
    if (value === "windows" || value.indexOf("windows") === 0) return "windows";
    if (value === "android" || value.indexOf("android") === 0) return "android";
    if (value === "ios" || value === "ipados" || value.indexOf("ios") === 0 || value.indexOf("ipados") === 0) return "ios";
    return "other";
  }

  function classifyCompliance(row) {
    var value = normalize(row.complianceState).replace(/\s/g, "");
    if (value === "compliant") return "compliant";
    if (value === "ingraceperiod") return "ingraceperiod";
    if (value === "noncompliant") return "noncompliant";
    return "unknown";
  }

  function classifyOwner(row) {
    var value = normalize(row.ownerType).replace(/\s/g, "");
    if (value === "company") return "company";
    if (value === "personal") return "personal";
    return "none";
  }

  async function api(action, payload) {
    var response = await fetch(API_URL + "?action=" + encodeURIComponent(action), {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    });

    var raw = await response.text();
    var data = {};

    try { data = raw ? JSON.parse(raw) : {}; }
    catch (error) { throw new Error("Resposta inválida do backend: " + raw.slice(0, 500)); }

    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (ignore) {}
    }

    if (!response.ok) {
      throw new Error(data && data.message ? data.message : "Erro HTTP " + response.status);
    }

    if (data && data.success === false) {
      throw new Error(data.message || "A operação não foi concluída.");
    }

    return data;
  }

  function toast(message) {
    var el = byId("cibToast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    window.clearTimeout(el._cibTimer);
    el._cibTimer = window.setTimeout(function () { el.classList.remove("show"); }, 3500);
  }

  function setBusy(active, message, percent) {
    var wrap = byId("cibProgress");
    if (!wrap) return;
    wrap.classList.toggle("cib-hidden", !active);
    byId("cibProgressText").textContent = message || "A processar...";
    byId("cibProgressPercent").textContent = String(percent || 0) + "%";
    byId("cibProgressBar").style.width = String(percent || 0) + "%";
    ["cibConnectBtn", "cibConsultBtn", "cibClearBtn"].forEach(function (id) {
      var button = byId(id);
      if (button) button.disabled = !!active;
    });
  }

  function setConnection(graph) {
    var connected = !!(graph && graph.connected);
    var dot = byId("cibConnectionDot");
    if (dot) dot.classList.toggle("on", connected);
    byId("cibConnectionText").textContent = connected
      ? "Graph ligado: " + text(graph.account, "conta ativa")
      : "Graph desligado";
  }

  function setCount(id, value) {
    var el = byId(id);
    if (el) el.textContent = String(Number(value || 0));
  }

  function updateSummary(summary) {
    summary = summary || {};
    state.lastSummary = summary;
    setCount("cibCountRequested", summary.requestedUsers);
    setCount("cibCountFound", summary.foundUsers);
    setCount("cibCountNotFound", summary.notFoundUsers);
    setCount("cibCountNoDevice", summary.usersWithoutDevices);
    setCount("cibCountDevices", summary.totalDevices);
    setCount("cibCountAndroid", summary.androidDevices);
    setCount("cibCountIos", summary.iosDevices);
    setCount("cibCountCompliant", summary.compliantDevices);
    setCount("cibCountGrace", summary.inGraceDevices);
    setCount("cibCountNoncompliant", summary.noncompliantDevices);
  }

  function statusBadge(row) {
    if (!row.userFound) return '<span class="cib-badge danger">Não encontrado</span>';
    if (!row.deviceFound) return '<span class="cib-badge warning">Sem equipamento</span>';
    return '<span class="cib-badge success">Encontrado</span>';
  }

  function complianceBadge(value) {
    var key = normalize(value).replace(/\s/g, "");
    if (key === "compliant") return '<span class="cib-badge success">Conforme</span>';
    if (key === "ingraceperiod") return '<span class="cib-badge warning">Em carência</span>';
    if (key === "noncompliant") return '<span class="cib-badge danger">Não conforme</span>';
    if (!key) return '<span class="cib-badge">—</span>';
    return '<span class="cib-badge info">' + escapeHtml(value) + '</span>';
  }

  function ownerLabel(value) {
    var key = normalize(value);
    if (key === "company") return "Corporativo";
    if (key === "personal") return "Pessoal";
    return text(value);
  }

  function applyFilters() {
    var query = normalize(byId("cibFilterText").value);
    var selectedOs = state.filters.os || [];
    var selectedCompliance = state.filters.compliance || [];
    var selectedOwner = state.filters.owner || [];

    state.filteredRows = state.rows.filter(function (row) {
      var haystack = normalize([
        row.input, row.userDisplayName, row.userPrincipalName, row.userMail,
        row.employeeId, row.department, row.companyName, row.deviceName,
        row.operatingSystem, row.osVersion, row.manufacturer, row.model,
        row.serialNumber, row.imei, row.phoneNumber, row.azureADDeviceId,
        row.managedDeviceId
      ].join(" "));

      if (query && haystack.indexOf(query) < 0) return false;
      if (selectedOs.length && selectedOs.indexOf(classifyOs(row)) < 0) return false;
      if (selectedCompliance.length && selectedCompliance.indexOf(classifyCompliance(row)) < 0) return false;
      if (selectedOwner.length && selectedOwner.indexOf(classifyOwner(row)) < 0) return false;
      return true;
    });

    renderTable();
  }

  function renderTable() {
    var body = byId("cibTableBody");
    if (!body) return;

    if (!state.filteredRows.length) {
      body.innerHTML = '<tr><td colspan="10" class="cib-empty-row">Nenhum resultado corresponde aos filtros.</td></tr>';
      byId("cibFilterResult").textContent = "0 registo(s)";
      return;
    }

    body.innerHTML = state.filteredRows.map(function (row, index) {
      return '<tr data-row-index="' + index + '">' +
        '<td>' + statusBadge(row) + '</td>' +
        '<td><strong>' + escapeHtml(text(row.userDisplayName, row.input)) + '</strong><br><small>' + escapeHtml(text(row.employeeId, "")) + '</small></td>' +
        '<td>' + escapeHtml(text(row.userPrincipalName)) + '</td>' +
        '<td>' + escapeHtml(text(row.deviceName)) + '</td>' +
        '<td>' + escapeHtml(text(row.operatingSystem)) + ' ' + escapeHtml(text(row.osVersion, "")) + '</td>' +
        '<td>' + escapeHtml(text(row.manufacturer, "")) + ' ' + escapeHtml(text(row.model)) + '</td>' +
        '<td>' + complianceBadge(row.complianceState) + '</td>' +
        '<td>' + escapeHtml(ownerLabel(row.ownerType)) + '</td>' +
        '<td>' + escapeHtml(text(row.lastSyncDateTime)) + '</td>' +
        '<td>' + escapeHtml(text(row.daysWithoutSync)) + '</td>' +
      '</tr>';
    }).join("");

    byId("cibFilterResult").textContent = state.filteredRows.length + " registo(s)";

    Array.prototype.forEach.call(body.querySelectorAll("tr[data-row-index]"), function (tr) {
      tr.addEventListener("click", function () {
        Array.prototype.forEach.call(body.querySelectorAll("tr.selected"), function (old) { old.classList.remove("selected"); });
        tr.classList.add("selected");
        showDetails(state.filteredRows[Number(tr.getAttribute("data-row-index"))]);
      });
    });
  }

  function detailItem(label, value) {
    return '<div class="cib-detail-item"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(text(value)) + '</strong></div>';
  }

  function showDetails(row) {
    if (!row) return;
    byId("cibDetailEmpty").classList.add("cib-hidden");
    byId("cibDetailContent").classList.remove("cib-hidden");
    byId("cibDetailName").textContent = text(row.userDisplayName, row.input);
    byId("cibDetailUpn").textContent = text(row.userPrincipalName, row.input);

    var badge = byId("cibDetailBadge");
    badge.className = "cib-badge " + (!row.userFound ? "danger" : (!row.deviceFound ? "warning" : "success"));
    badge.textContent = !row.userFound ? "Utilizador não encontrado" : (!row.deviceFound ? "Sem equipamento" : "Equipamento encontrado");

    var userFields = [
      ["Entrada consultada", row.input],
      ["Nome", row.userDisplayName],
      ["UPN", row.userPrincipalName],
      ["E-mail", row.userMail],
      ["Employee ID", row.employeeId],
      ["SAM Account Name", row.onPremisesSamAccountName],
      ["Estado da conta", row.accountEnabled === true ? "Ativa" : (row.accountEnabled === false ? "Desativada" : "—")],
      ["Cargo", row.jobTitle],
      ["Departamento", row.department],
      ["Empresa", row.companyName],
      ["Localização", row.officeLocation],
      ["Manager", row.managerDisplayName],
      ["Manager UPN", row.managerUserPrincipalName],
      ["Data de criação", row.userCreatedDateTime],
      ["Sincronização local", row.onPremisesSyncEnabled === true ? "Sim" : (row.onPremisesSyncEnabled === false ? "Não" : "—")],
      ["Última sincronização local", row.onPremisesLastSyncDateTime],
      ["Domínio local", row.onPremisesDomainName],
      ["Distinguished Name", row.onPremisesDistinguishedName],
      ["Erro da consulta", row.userError]
    ];

    var deviceFields = [
      ["Nome do equipamento", row.deviceName],
      ["Sistema operativo", row.operatingSystem],
      ["Versão", row.osVersion],
      ["Fabricante", row.manufacturer],
      ["Modelo", row.model],
      ["Número de série", row.serialNumber],
      ["IMEI", row.imei],
      ["Número de telefone", row.phoneNumber],
      ["Operadora", row.subscriberCarrier],
      ["MAC Wi-Fi", row.wiFiMacAddress],
      ["Conformidade", row.complianceState],
      ["Fim da carência", row.complianceGraceExpirationDateTime],
      ["Estado de gestão", row.managementState],
      ["Agente de gestão", row.managementAgent],
      ["Propriedade", ownerLabel(row.ownerType)],
      ["Tipo de inscrição", row.enrollmentType],
      ["Data de inscrição", row.enrolledDateTime],
      ["Última sincronização", row.lastSyncDateTime],
      ["Dias sem sincronizar", row.daysWithoutSync],
      ["Encriptado", row.isEncrypted === true ? "Sim" : (row.isEncrypted === false ? "Não" : "—")],
      ["Supervisionado", row.isSupervised === true ? "Sim" : (row.isSupervised === false ? "Não" : "—")],
      ["Jailbreak/Root", row.jailBroken],
      ["Estado de registo", row.deviceRegistrationState],
      ["Registado no Entra", row.azureADRegistered === true ? "Sim" : (row.azureADRegistered === false ? "Não" : "—")],
      ["Categoria", row.deviceCategoryDisplayName],
      ["Ameaça reportada", row.partnerReportedThreatState],
      ["Patch Android", row.androidSecurityPatchLevel],
      ["Armazenamento total", row.totalStorageDisplay],
      ["Armazenamento livre", row.freeStorageDisplay],
      ["Azure AD Device ID", row.azureADDeviceId],
      ["Managed Device ID", row.managedDeviceId]
    ];

    byId("cibUserDetailGrid").innerHTML = userFields.map(function (item) { return detailItem(item[0], item[1]); }).join("");
    byId("cibDeviceDetailGrid").innerHTML = deviceFields.map(function (item) { return detailItem(item[0], item[1]); }).join("");
  }

  async function connectGraph() {
    try {
      setBusy(true, "A abrir a autenticação do Microsoft Graph...", 30);
      var result = await api("connect", {});
      setConnection(result.graph);
      setBusy(true, "Ligação concluída.", 100);
      toast(result.message || "Graph/Intune ligado com sucesso.");
    } catch (error) {
      toast(error.message);
    } finally {
      window.setTimeout(function () { setBusy(false, "", 0); }, 500);
    }
  }

  async function consultUsers() {
    var users = parseUsers(byId("cibUsersInput").value);
    if (!users.length) {
      toast("Informe pelo menos um utilizador.");
      return;
    }

    try {
      window.clearTimeout(state.saveTimer);
      await saveUsersList(false);
      setBusy(true, "A validar a ligação e preparar a consulta...", 12);
      window.setTimeout(function () {
        if (!byId("cibProgress").classList.contains("cib-hidden")) setBusy(true, "A consultar utilizadores e equipamentos no Intune...", 45);
      }, 350);

      var result = await api("consult", { users: users });
      state.rows = Array.isArray(result.rows) ? result.rows : [];
      state.users = Array.isArray(result.users) ? result.users : [];
      updateSummary(result.summary || {});
      setConnection(result.graph);
      setBusy(true, "Relatório concluído.", 100);
      byId("cibExportBtn").disabled = !state.rows.length;
      byId("cibEmailBtn").disabled = !state.rows.length;
      applyFilters();
      toast("Consulta concluída: " + state.rows.length + " registo(s) no relatório.");
    } catch (error) {
      toast(error.message);
    } finally {
      window.setTimeout(function () { setBusy(false, "", 0); }, 650);
    }
  }

  function csvValue(value) {
    var v = text(value, "").replace(/"/g, '""');
    return '"' + v + '"';
  }

  function exportCsv() {
    var rows = state.filteredRows.length ? state.filteredRows : state.rows;
    if (!rows.length) return;

    var columns = [
      ["Entrada", "input"], ["Utilizador encontrado", "userFound"], ["Nome", "userDisplayName"],
      ["UPN", "userPrincipalName"], ["E-mail", "userMail"], ["Employee ID", "employeeId"],
      ["SAM Account Name", "onPremisesSamAccountName"], ["Conta ativa", "accountEnabled"],
      ["Cargo", "jobTitle"], ["Departamento", "department"], ["Empresa", "companyName"],
      ["Localização", "officeLocation"], ["Manager", "managerDisplayName"],
      ["Manager UPN", "managerUserPrincipalName"], ["Criação do utilizador", "userCreatedDateTime"],
      ["Sincronizado local", "onPremisesSyncEnabled"], ["Última sync local", "onPremisesLastSyncDateTime"],
      ["Domínio local", "onPremisesDomainName"], ["DN", "onPremisesDistinguishedName"],
      ["Equipamento encontrado", "deviceFound"], ["Equipamento", "deviceName"],
      ["SO", "operatingSystem"], ["Versão SO", "osVersion"], ["Fabricante", "manufacturer"],
      ["Modelo", "model"], ["Número de série", "serialNumber"], ["IMEI", "imei"],
      ["Telefone", "phoneNumber"], ["Operadora", "subscriberCarrier"], ["MAC Wi-Fi", "wiFiMacAddress"],
      ["Conformidade", "complianceState"], ["Fim da carência", "complianceGraceExpirationDateTime"],
      ["Estado gestão", "managementState"], ["Agente gestão", "managementAgent"], ["Propriedade", "ownerType"],
      ["Tipo inscrição", "enrollmentType"], ["Data inscrição", "enrolledDateTime"],
      ["Última sincronização", "lastSyncDateTime"], ["Dias sem sync", "daysWithoutSync"],
      ["Encriptado", "isEncrypted"], ["Supervisionado", "isSupervised"], ["Jailbreak/Root", "jailBroken"],
      ["Estado registo", "deviceRegistrationState"], ["Registado Entra", "azureADRegistered"],
      ["Categoria", "deviceCategoryDisplayName"], ["Ameaça", "partnerReportedThreatState"],
      ["Patch Android", "androidSecurityPatchLevel"], ["Armazenamento total", "totalStorageDisplay"],
      ["Armazenamento livre", "freeStorageDisplay"], ["Azure AD Device ID", "azureADDeviceId"],
      ["Managed Device ID", "managedDeviceId"], ["Erro", "userError"]
    ];

    var lines = [columns.map(function (c) { return csvValue(c[0]); }).join(";")];
    rows.forEach(function (row) {
      lines.push(columns.map(function (c) { return csvValue(row[c[1]]); }).join(";"));
    });

    var blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "Relatorio_CIB_" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function openEmailModal() {
    if (!state.rows.length) return;
    if (!state.emailSettingsLoaded) loadEmailSettings();
    var today = new Date().toLocaleDateString("pt-PT");
    byId("cibEmailSubject").value = "Relatório CIB - Equipamentos móveis - " + today;
    byId("cibEmailModal").classList.remove("cib-hidden");
  }

  function closeEmailModal() {
    byId("cibEmailModal").classList.add("cib-hidden");
  }

  async function prepareEmail() {
    var to = normalizeRecipients(byId("cibEmailTo").value);
    var cc = normalizeRecipients(byId("cibEmailCc").value);
    var subject = byId("cibEmailSubject").value.trim();
    byId("cibEmailTo").value = to;
    byId("cibEmailCc").value = cc;
    if (!to) { toast("Informe o destinatário do e-mail."); return; }
    if (!subject) { toast("Informe o assunto do e-mail."); return; }

    var useFiltered = byId("cibEmailFiltered").checked;
    var rows = useFiltered ? state.filteredRows : state.rows;
    if (!rows.length) { toast("Não existem resultados para enviar."); return; }

    try {
      byId("cibPrepareEmailBtn").disabled = true;
      window.clearTimeout(state.emailSaveTimer);
      await saveEmailSettings(false);
      var result = await api("prepareEmail", {
        to: to,
        cc: cc,
        subject: subject,
        intro: byId("cibEmailIntro").value,
        attachCsv: byId("cibAttachCsv").checked,
        attachHtml: byId("cibAttachHtml").checked,
        rows: rows,
        users: state.users,
        summary: state.lastSummary || {}
      });
      closeEmailModal();
      toast(result.message || "E-mail aberto no Outlook para revisão.");
    } catch (error) {
      toast(error.message);
    } finally {
      byId("cibPrepareEmailBtn").disabled = false;
    }
  }

  function clearResults() {
    state.rows = [];
    state.users = [];
    state.filteredRows = [];
    state.selectedIndex = -1;
    state.lastSummary = null;
    byId("cibFilterText").value = "";
    resetMultiFilters();
    byId("cibTableBody").innerHTML = '<tr><td colspan="10" class="cib-empty-row">A lista guardada foi mantida. Clique em Consultar utilizadores para gerar um novo relatório.</td></tr>';
    byId("cibFilterResult").textContent = "0 registo(s)";
    byId("cibDetailEmpty").classList.remove("cib-hidden");
    byId("cibDetailContent").classList.add("cib-hidden");
    byId("cibExportBtn").disabled = true;
    byId("cibEmailBtn").disabled = true;
    updateSummary({});
    toast("Resultados limpos. A lista de utilizadores foi mantida.");
  }

  async function refreshStatus() {
    try {
      var result = await api("status", {});
      setConnection(result.graph);
    } catch (ignore) {}
  }

  function init() {
    ensureStyle();
    var root = byId("cibRoot");
    if (!root || root.getAttribute("data-cib-bound") === "1") return;
    root.setAttribute("data-cib-bound", "1");

    byId("cibConnectBtn").addEventListener("click", connectGraph);
    byId("cibConsultBtn").addEventListener("click", consultUsers);
    byId("cibExportBtn").addEventListener("click", exportCsv);
    byId("cibEmailBtn").addEventListener("click", openEmailModal);
    byId("cibSaveUsersBtn").addEventListener("click", function () { saveUsersList(true); });
    byId("cibClearBtn").addEventListener("click", clearResults);
    byId("cibPrepareEmailBtn").addEventListener("click", prepareEmail);
    byId("cibFilterText").addEventListener("input", applyFilters);

    ["os", "compliance", "owner"].forEach(function (group) {
      byId(filterButtonId(group)).addEventListener("click", function (event) {
        event.stopPropagation();
        toggleMultiFilter(group);
      });

      var menu = byId(filterMenuId(group));
      menu.addEventListener("click", function (event) { event.stopPropagation(); });

      var all = document.querySelector('[data-cib-filter-all="' + group + '"]');
      if (all) {
        all.addEventListener("change", function () {
          if (all.checked) {
            Array.prototype.forEach.call(document.querySelectorAll('[data-cib-filter-option="' + group + '"]'), function (el) { el.checked = false; });
          } else if (!getSelectedFilterValues(group).length) {
            all.checked = true;
          }
          updateMultiFilter(group);
          applyFilters();
        });
      }

      Array.prototype.forEach.call(document.querySelectorAll('[data-cib-filter-option="' + group + '"]'), function (option) {
        option.addEventListener("change", function () {
          updateMultiFilter(group);
          applyFilters();
        });
      });

      updateMultiFilter(group);
    });

    document.addEventListener("click", function () { closeMultiFilters(); });

    Array.prototype.forEach.call(root.querySelectorAll("[data-cib-close-modal='true']"), function (el) {
      el.addEventListener("click", closeEmailModal);
    });

    byId("cibUsersInput").addEventListener("input", scheduleUsersSave);
    byId("cibEmailTo").addEventListener("input", scheduleEmailSettingsSave);
    byId("cibEmailCc").addEventListener("input", scheduleEmailSettingsSave);
    byId("cibEmailTo").addEventListener("blur", function () { saveEmailSettings(false); });
    byId("cibEmailCc").addEventListener("blur", function () { saveEmailSettings(false); });

    byId("cibUsersInput").addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        consultUsers();
      }
    });

    loadSavedUsers();
    loadEmailSettings();
    refreshStatus();
  }

  window.relatorioCibInit = init;
  init();
  window.setTimeout(init, 100);
  window.setTimeout(init, 500);
})();

/* BEGIN CIB RECIPIENTS FIX V1.2.2 */
(function () {
    "use strict";

    var FIELD_IDS = {
        cibEmailTo: true,
        cibEmailCc: true
    };

    var saveTimer = null;

    function isRecipientField(element) {
        return Boolean(
            element &&
            element.id &&
            FIELD_IDS[element.id]
        );
    }

    function repairRecipientText(value) {
        var raw = String(value == null ? "" : value);

        raw = raw.replace(/\r\n?/g, "\n");
        raw = raw.replace(/[,\n]+/g, ";");

        /*
         * Recupera listas antigas como:
         * nome1@santander.ptnome2@santander.pt
         */
        raw = raw.replace(
            /(\.(?:pt|com|net|org|eu|es|fr|de|it|nl|be|co\.uk))(?=[a-z0-9._%+\-]+@)/gi,
            "$1;"
        );

        var seen = Object.create(null);
        var output = [];

        raw.split(/;+/).forEach(function (part) {
            var recipient = String(part || "").trim();

            if (!recipient) {
                return;
            }

            var angleAddress =
                recipient.match(/<([^<>@\s]+@[^<>\s]+)>/);

            if (angleAddress) {
                recipient = angleAddress[1].trim();
            }

            var key = recipient.toLowerCase();

            if (!seen[key]) {
                seen[key] = true;
                output.push(recipient);
            }
        });

        return output.join("; ");
    }

    function getFields() {
        return {
            to: document.getElementById("cibEmailTo"),
            cc: document.getElementById("cibEmailCc")
        };
    }

    function saveLocalSettings(payload) {
        try {
            var keys = [];

            for (var index = 0; index < localStorage.length; index += 1) {
                var key = localStorage.key(index);

                if (
                    key &&
                    (
                        /cib.*email/i.test(key) ||
                        /email.*cib/i.test(key)
                    )
                ) {
                    keys.push(key);
                }
            }

            keys.forEach(function (key) {
                localStorage.setItem(
                    key,
                    JSON.stringify(payload)
                );
            });

            localStorage.setItem(
                "relatorio-cib-email-settings-v122",
                JSON.stringify(payload)
            );
        }
        catch (error) {
            console.warn(
                "Relatório CIB: não foi possível guardar localmente.",
                error
            );
        }
    }

    function saveSettings() {
        var fields = getFields();

        if (!fields.to || !fields.cc) {
            return;
        }

        var payload = {
            to: repairRecipientText(fields.to.value),
            cc: repairRecipientText(fields.cc.value),
            updatedAt: new Date().toISOString()
        };

        saveLocalSettings(payload);

        fetch(
            "/module/relatorio-cib/api?action=saveemailsettings",
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json;charset=UTF-8"
                },
                body: JSON.stringify({
                    to: payload.to,
                    cc: payload.cc,
                    updatedAt: payload.updatedAt,
                    payload: payload
                })
            }
        ).catch(function (error) {
            console.warn(
                "Relatório CIB: não foi possível guardar destinatários.",
                error
            );
        });
    }

    function scheduleSave() {
        window.clearTimeout(saveTimer);

        saveTimer = window.setTimeout(
            saveSettings,
            700
        );
    }

    function repairVisibleFields() {
        var fields = getFields();

        [fields.to, fields.cc].forEach(function (field) {
            if (!field || document.activeElement === field) {
                return;
            }

            var repaired = repairRecipientText(field.value);

            if (repaired && repaired !== field.value) {
                field.value = repaired;
            }
        });
    }

    /*
     * Impede que a função antiga retire o ponto e vírgula
     * enquanto o utilizador ainda está a escrever.
     */
    document.addEventListener(
        "input",
        function (event) {
            if (!isRecipientField(event.target)) {
                return;
            }

            event.stopImmediatePropagation();
            scheduleSave();
        },
        true
    );

    document.addEventListener(
        "change",
        function (event) {
            if (!isRecipientField(event.target)) {
                return;
            }

            event.stopImmediatePropagation();

            event.target.value =
                repairRecipientText(event.target.value);

            saveSettings();
        },
        true
    );

    document.addEventListener(
        "blur",
        function (event) {
            if (!isRecipientField(event.target)) {
                return;
            }

            event.stopImmediatePropagation();

            event.target.value =
                repairRecipientText(event.target.value);

            saveSettings();
        },
        true
    );

    document.addEventListener(
        "focusin",
        function (event) {
            if (!isRecipientField(event.target)) {
                return;
            }

            var repaired =
                repairRecipientText(event.target.value);

            if (repaired && repaired !== event.target.value) {
                event.target.value = repaired;
            }
        },
        true
    );

    /*
     * Executado antes do evento antigo do botão.
     * Assim o Outlook recebe a lista corretamente separada.
     */
    document.addEventListener(
        "click",
        function (event) {
            var button = event.target.closest
                ? event.target.closest("button")
                : null;

            if (!button) {
                return;
            }

            var buttonText =
                String(button.textContent || "").trim();

            var isOutlookButton =
                button.id === "cibPrepareEmailBtn" ||
                /abrir no outlook/i.test(buttonText);

            if (!isOutlookButton) {
                return;
            }

            var fields = getFields();

            if (fields.to) {
                fields.to.value =
                    repairRecipientText(fields.to.value);
            }

            if (fields.cc) {
                fields.cc.value =
                    repairRecipientText(fields.cc.value);
            }

            saveSettings();
        },
        true
    );

    function initialize() {
        repairVisibleFields();

        if (!document.documentElement) {
            return;
        }

        var observer = new MutationObserver(function () {
            repairVisibleFields();
        });

        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: [
                    "class",
                    "style",
                    "aria-hidden"
                ]
            }
        );
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initialize,
            { once: true }
        );
    }
    else {
        initialize();
    }
})();
/* END CIB RECIPIENTS FIX V1.2.2 */
