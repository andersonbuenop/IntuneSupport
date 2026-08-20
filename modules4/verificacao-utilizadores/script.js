(function () {
  "use strict";

  const MODULE_ENDPOINT = "/module/verificacao-utilizadores/api";
  const SERVICE_NOW_URL = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bb85467db79c0d4f1024dc2ba961997&sysparm_category=93d369bedbf1a700ec3fa5305b96190a";
  const BATCH_SIZE = 8;
  const SAFE_GET_ACTIONS = new Set(["verificar", "search-created"]);

  window.vuUltimosResultados = [];
  window.vuUltimasNotas = [];
  window.vuPreventiveRows = [];
  window.vuFonteConsulta = "Consulta direta";
  window.vuKpiFilter = "all";
  window.vuResultadosVisiveis = [];
  let vuTicketQueue = null;

  const VU_KPI_FILTER_LABELS = {
    all: "Todos os utilizadores",
    ad: "Encontrados no AD Local",
    azure: "Encontrados no Azure",
    e3: "Com licença E3",
    exo: "Com mailbox no Exchange Online",
    archive: "Com Arquivo Online",
    healthy: "Utilizadores saudáveis",
    pending: "Utilizadores com pendências"
  };

  let vuBusy = false;
  let vuRunToken = 0;
  let vuAbortController = null;
  let vuCsrfToken = "";

  function vuEl(id) {
    return document.getElementById(id);
  }

  function vuEscapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function vuText(value, fallback = "-") {
    const text = String(value === null || value === undefined ? "" : value).trim();
    return text || fallback;
  }

  function vuUniqueText(items) {
    return [...new Set((Array.isArray(items) ? items : []).map(item => String(item || "").trim()).filter(Boolean))];
  }

  function vuTodayIso(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function vuCleanupOperationPanel() {
    const panel = vuEl("vuOperationPanel");
    if (panel) panel.remove();
  }

  if (window.vuBeforeUnloadHandler) {
    window.removeEventListener("beforeunload", window.vuBeforeUnloadHandler);
  }

  window.vuBeforeUnloadHandler = vuCleanupOperationPanel;
  window.addEventListener("beforeunload", window.vuBeforeUnloadHandler);
  vuCleanupOperationPanel();

  function vuEnsureOperationPanel() {
    let panel = vuEl("vuOperationPanel");

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

    const titleEl = vuEl("vuOperationTitle");
    const userEl = vuEl("vuOperationUser");

    if (titleEl) titleEl.textContent = "⚙️ " + (title || "Operação em curso");
    if (userEl) userEl.textContent = user || "";

    vuOperationProgress(5, "A preparar operação...");
  }

  function vuOperationProgress(percent, step) {
    const panel = vuEnsureOperationPanel();
    panel.classList.add("show");

    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    const fill = vuEl("vuOperationFill");
    const pct = vuEl("vuOperationPercent");
    const stepEl = vuEl("vuOperationStep");

    if (fill) fill.style.width = p + "%";
    if (pct) pct.textContent = p + "%";
    if (stepEl) stepEl.textContent = step || "A processar...";
  }

  function vuOperationSuccess(message) {
    const panel = vuEnsureOperationPanel();
    panel.className = "vu-operation-panel show success";
    vuOperationProgress(100, message || "Operação concluída com sucesso.");
    window.setTimeout(vuOperationHide, 3500);
  }

  function vuOperationError(message) {
    const panel = vuEnsureOperationPanel();
    panel.className = "vu-operation-panel show error";
    vuOperationProgress(100, message || "Operação não concluída.");
    window.setTimeout(vuOperationHide, 5000);
  }

  function vuOperationHide() {
    const panel = vuEl("vuOperationPanel");
    if (panel) panel.classList.remove("show");
  }

  function vuSetBusy(isBusy, message) {
    vuBusy = Boolean(isBusy);

    document.querySelectorAll("[data-vu-busy]").forEach(element => {
      element.disabled = vuBusy;
      element.classList.toggle("is-disabled", vuBusy);
    });

    const busyText = vuEl("vuBusyText");
    if (busyText) {
      busyText.textContent = vuBusy ? (message || "Operação em curso...") : "";
    }
    const cancelButton = vuEl("vuCancelButton");
    if (cancelButton) cancelButton.hidden = !vuBusy;
  }

  function vuParseUsers() {
    const single = vuEl("vuSingleUser")?.value.trim() || "";
    const list = vuEl("vuUserList")?.value.trim() || "";
    const users = [];

    if (single) users.push(single);

    if (list) {
      for (const line of list.split(/\r?\n/)) {
        const clean = line.trim();
        if (!clean) continue;

        const firstCol = clean.split(/\t|;|,/)[0].trim();
        const lower = firstCol.toLowerCase();

        if (!firstCol) continue;
        if (["utilizador", "user", "login", "samaccountname", "upn", "email"].includes(lower)) continue;

        users.push(firstCol);
      }
    }

    const seen = new Set();
    const unique = [];

    for (const user of users) {
      const key = user.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(user);
    }

    return unique;
  }

  function vuSetStatus(type, title, detail) {
    const box = vuEl("vuStatusBox");
    const status = vuEl("vuStatus");
    const statusDetail = vuEl("vuStatusDetail");

    if (box) box.className = `vu-status ${type || "idle"}`;
    if (status) status.textContent = title || "";
    if (statusDetail) statusDetail.textContent = detail || "";
  }

  function vuSetProgress(percent, text) {
    const wrap = vuEl("vuProgressWrap");
    const fill = vuEl("vuProgressFill");
    const label = vuEl("vuProgressText");
    const pct = vuEl("vuProgressPercent");
    const bar = vuEl("vuProgressBar");
    const p = Math.max(0, Math.min(100, Number(percent) || 0));

    if (wrap) wrap.style.display = "block";
    if (fill) fill.style.width = p + "%";
    if (label) label.textContent = text || "A processar...";
    if (pct) pct.textContent = p + "%";
    if (bar) bar.setAttribute("aria-valuenow", String(p));
  }

  function vuSetProgressError(text) {
    vuSetProgress(100, text || "Operação não concluída.");
  }

  function vuBool(value, yes = "Sim", no = "Não") {
    return value
      ? `<span class="vu-pill ok">✓ ${vuEscapeHtml(yes)}</span>`
      : `<span class="vu-pill bad">✕ ${vuEscapeHtml(no)}</span>`;
  }

  function vuStatePill(checked, exists, enabled) {
    if (!checked) {
      return `<span class="vu-pill warn">! Não validado</span>`;
    }

    if (!exists) {
      return `<span class="vu-pill neutral">– Não encontrado</span>`;
    }

    return enabled
      ? `<span class="vu-pill ok">✓ Ativo</span>`
      : `<span class="vu-pill bad">✕ Inativo</span>`;
  }

  function vuWarn(text) {
    return `<span class="vu-pill warn">! ${vuEscapeHtml(text)}</span>`;
  }

  function vuInitials(name, input) {
    const base = String(name || input || "?").trim();
    const parts = base.split(/\s+/).filter(Boolean);

    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    return base.substring(0, 2).toUpperCase();
  }

  async function vuReadApiResponse(response) {
    const text = await response.text();
    let data;

    try {
      data = JSON.parse(text);
      if (typeof data === "string") data = JSON.parse(data);
      if (Array.isArray(data)) {
        for (let index = data.length - 1; index >= 0; index--) {
          let candidate = data[index];
          if (typeof candidate === "string") {
            try { candidate = JSON.parse(candidate); } catch { continue; }
          }
          if (candidate && typeof candidate === "object" && typeof candidate.ok === "boolean") {
            data = candidate;
            break;
          }
        }
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("A API não devolveu um objeto de resposta válido.");
      }
    } catch {
      const excerpt = text ? ` Resposta: ${text.slice(0, 220)}` : "";
      throw new Error(`Resposta inválida da API (HTTP ${response.status}).${excerpt}`);
    }

    if (!response.ok) {
      throw new Error(data?.error || `Erro HTTP ${response.status}.`);
    }

    return data;
  }

  async function vuApiRequest(payload) {
    const action = String(payload?.action || "").toLowerCase();
    const requestPayload = { ...payload };
    if (["add-e3", "enable-archive", "clear-hide-address-list", "set-recipient-limit", "save-png"].includes(action)) {
      requestPayload.csrfToken = await vuGetCsrfToken();
    }
    let postError = null;
    let shouldFallback = false;

    try {
      const response = await fetch(MODULE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify(requestPayload),
        cache: "no-store",
        signal: vuAbortController?.signal
      });

      const data = await vuReadApiResponse(response);
      const emptyRequest = data?.ok === false &&
        /pedido vazio|ação não informada|nenhum utilizador recebido/i.test(String(data?.error || ""));

      if (!emptyRequest) {
        return data;
      }

      shouldFallback = true;
      postError = new Error(data?.error || "O servidor não leu o corpo POST.");
    } catch (error) {
      postError = error;
      shouldFallback = true;
    }

    if (!SAFE_GET_ACTIONS.has(action) || !shouldFallback) {
      throw postError || new Error("Falha no pedido à API.");
    }

    const encodedPayload = encodeURIComponent(JSON.stringify(requestPayload));
    const encodedAction = encodeURIComponent(action);
    const url = `${MODULE_ENDPOINT}?action=${encodedAction}&payload=${encodedPayload}`;

    if (url.length > 7800) {
      throw new Error(
        postError?.message ||
        "A lista é demasiado grande para envio por URL e o servidor não aceitou o pedido POST."
      );
    }

    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: vuAbortController?.signal
    });

    return vuReadApiResponse(response);
  }

  async function vuGetCsrfToken() {
    if (vuCsrfToken) return vuCsrfToken;
    const response = await fetch(`${MODULE_ENDPOINT}?action=csrf-token`, { method: "GET", cache: "no-store" });
    const data = await vuReadApiResponse(response);
    if (!data?.ok || !data?.token) throw new Error("Não foi possível preparar a ação administrativa.");
    vuCsrfToken = String(data.token);
    return vuCsrfToken;
  }

  function vuCancelar() {
    if (!vuBusy) return;
    vuRunToken++;
    vuAbortController?.abort();
    vuSetStatus("warn", "Operação cancelada.", "Os pedidos ainda não enviados foram interrompidos.");
  }

  async function vuProcessUsers(users, sourceLabel, progressStart = 12, progressEnd = 100) {
    const runToken = vuRunToken;
    const cleanUsers = Array.isArray(users) ? users.filter(Boolean) : [];

    window.vuUltimosResultados = [];
    window.vuUltimasNotas = [];
    window.vuFonteConsulta = sourceLabel || "Consulta direta";

    if (!cleanUsers.length) {
      vuRenderResultados();
      return;
    }

    const batchCount = Math.ceil(cleanUsers.length / BATCH_SIZE);

    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
      if (runToken !== vuRunToken) {
        throw new Error("A operação foi substituída por uma consulta mais recente.");
      }

      const start = batchIndex * BATCH_SIZE;
      const batch = cleanUsers.slice(start, start + BATCH_SIZE);
      const processedBefore = start;
      const requestProgress = progressStart +
        ((progressEnd - progressStart) * processedBefore / cleanUsers.length);

      vuSetProgress(
        Math.round(requestProgress),
        `A verificar ${Math.min(processedBefore + 1, cleanUsers.length)} a ${Math.min(processedBefore + batch.length, cleanUsers.length)} de ${cleanUsers.length}...`
      );

      const data = await vuApiRequest({
        action: "verificar",
        users: batch
      });

      if (!data?.ok) {
        throw new Error(data?.error || "Erro desconhecido na API.");
      }

      const rows = Array.isArray(data.results) ? data.results : [];
      const notes = Array.isArray(data.notes) ? data.notes : [];

      window.vuUltimosResultados.push(...rows);
      window.vuUltimasNotas = vuUniqueText([...window.vuUltimasNotas, ...notes]);

      const processedAfter = Math.min(start + batch.length, cleanUsers.length);
      const completedProgress = progressStart +
        ((progressEnd - progressStart) * processedAfter / cleanUsers.length);

      vuSetProgress(
        Math.round(completedProgress),
        `Verificados ${processedAfter} de ${cleanUsers.length}.`
      );

      vuRenderResultados();
    }
  }

  async function vuVerificar() {
    if (vuBusy) {
      vuSetStatus("warn", "Já existe uma operação em curso.", "Aguarde a conclusão antes de iniciar outra consulta.");
      return;
    }

    const users = vuParseUsers();

    if (!users.length) {
      vuSetStatus("err", "Nenhum utilizador informado.", "Informe um utilizador ou cole uma lista do Excel.");
      return;
    }

    vuRunToken++;
    vuAbortController = new AbortController();
    vuSetBusy(true, "Consulta direta em curso...");
    vuSetStatus("idle", `A verificar ${users.length} utilizador(es)...`, "A consulta será processada em pequenos lotes.");
    vuSetProgress(5, "A preparar consulta direta...");

    try {
      await vuProcessUsers(users, "Consulta direta", 10, 100);

      vuSetProgress(100, "Consulta concluída.");
      vuSetStatus(
        "ok",
        "Verificação concluída com sucesso.",
        `${window.vuUltimosResultados.length} resultado(s) encontrado(s).`
      );
    } catch (error) {
      vuRenderResultados();
      if (error?.name === "AbortError") {
        vuSetProgressError("Operação cancelada.");
        vuSetStatus("warn", "Operação cancelada.", "Os resultados já recebidos foram mantidos.");
        return;
      }
      vuSetProgressError("Falha na verificação.");
      vuSetStatus("err", "Erro na verificação.", error.message || "Erro desconhecido.");
    } finally {
      vuSetBusy(false);
      vuAbortController = null;
    }
  }

  function vuValidateDateRange() {
    const start = vuEl("vuStartDate")?.value || "";
    const end = vuEl("vuEndDate")?.value || "";

    if (!start || !end) {
      throw new Error("Informe a data inicial e a data final.");
    }

    const startDate = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new Error("As datas informadas são inválidas.");
    }

    if (endDate < startDate) {
      throw new Error("A data final não pode ser anterior à data inicial.");
    }

    const days = Math.floor((endDate - startDate) / 86400000);

    if (days > 90) {
      throw new Error("O intervalo máximo permitido é de 90 dias.");
    }

    return { start, end };
  }

  async function vuPesquisarCriados() {
    if (vuBusy) {
      vuSetStatus("warn", "Já existe uma operação em curso.", "Aguarde a conclusão antes de iniciar outra pesquisa.");
      return;
    }

    let range;

    try {
      range = vuValidateDateRange();
    } catch (error) {
      vuSetStatus("err", "Período inválido.", error.message);
      return;
    }

    vuRunToken++;
    vuAbortController = new AbortController();
    vuSetBusy(true, "Pesquisa preventiva em curso...");
    window.vuUltimosResultados = [];
    window.vuUltimasNotas = [];
    window.vuPreventiveRows = [];
    window.vuFonteConsulta = `Criados no AD: ${range.start} a ${range.end}`;

    vuRenderResultados();
    vuSetStatus("idle", "A procurar utilizadores criados no AD...", `${range.start} até ${range.end}.`);
    vuSetProgress(5, "A consultar os domínios do Active Directory...");

    try {
      const searchData = await vuApiRequest({
        action: "search-created",
        startDate: range.start,
        endDate: range.end,
        onlyEnabled: Boolean(vuEl("vuOnlyActive")?.checked),
        requireUpn: Boolean(vuEl("vuRequireUpn")?.checked)
      });

      if (!searchData?.ok) {
        throw new Error(searchData?.error || "Não foi possível pesquisar o AD.");
      }

      window.vuPreventiveRows = Array.isArray(searchData.rows) ? searchData.rows : [];
      const users = Array.isArray(searchData.users) ? searchData.users : [];
      const searchErrors = Array.isArray(searchData.errors) ? searchData.errors : [];

      if (searchErrors.length) {
        window.vuUltimasNotas = vuUniqueText(searchErrors.map(error => `Pesquisa AD parcial: ${error}`));
      }

      vuSetProgress(18, `Encontrados ${users.length} utilizador(es) no período.`);

      if (!users.length) {
        vuRenderResultados();
        vuSetProgress(100, "Pesquisa concluída sem resultados.");
        vuSetStatus(
          searchData.partial ? "warn" : "ok",
          "Nenhum utilizador encontrado no período.",
          searchData.partial
            ? "A pesquisa foi parcial. Consulte as notas de ligação."
            : `${range.start} até ${range.end}.`
        );
        return;
      }

      vuSetStatus(
        searchData.partial ? "warn" : "idle",
        `${users.length} utilizador(es) encontrado(s) no AD.`,
        "A validar Azure, licença E3, Exchange Online e Arquivo Online."
      );

      await vuProcessUsers(users, window.vuFonteConsulta, 20, 100);

      if (searchErrors.length) {
        window.vuUltimasNotas = vuUniqueText([
          ...window.vuUltimasNotas,
          ...searchErrors.map(error => `Pesquisa AD parcial: ${error}`)
        ]);
        vuRenderResultados();
      }

      vuSetProgress(100, "Pesquisa preventiva concluída.");
      vuSetStatus(
        searchData.partial ? "warn" : "ok",
        "Pesquisa preventiva concluída.",
        `${window.vuUltimosResultados.length} utilizador(es) verificado(s).`
      );
    } catch (error) {
      vuRenderResultados();
      if (error?.name === "AbortError") {
        vuSetProgressError("Operação cancelada.");
        vuSetStatus("warn", "Operação cancelada.", "Os resultados já recebidos foram mantidos.");
        return;
      }
      vuSetProgressError("Pesquisa preventiva não concluída.");
      vuSetStatus("err", "Erro na pesquisa preventiva.", error.message || "Erro desconhecido.");
    } finally {
      vuSetBusy(false);
      vuAbortController = null;
    }
  }

  function vuSetPeriodo(mode) {
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let end = new Date(start);

    if (mode === "last7") {
      start.setDate(start.getDate() - 6);
    } else if (mode === "month") {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const startEl = vuEl("vuStartDate");
    const endEl = vuEl("vuEndDate");

    if (startEl) startEl.value = vuTodayIso(start);
    if (endEl) endEl.value = vuTodayIso(end);
  }

  async function vuExecutarAcaoResultado(action, index, label, extraPayload = {}) {
    if (vuBusy) {
      vuSetStatus("warn", "Já existe uma operação em curso.", "Aguarde a conclusão antes de executar uma ação corretiva.");
      return;
    }

    const result = window.vuUltimosResultados[index];
    const user = result?.resolvedUser || result?.azure?.upn || result?.ad?.upn || result?.input;

    if (!result || !user) {
      alert("Utilizador inválido.");
      return;
    }

    const confirmed = window.confirm(`${label}\n\nUtilizador: ${user}\n\nConfirma a execução?`);
    if (!confirmed) return;

    vuSetBusy(true, `${label}...`);
    vuAbortController = new AbortController();
    vuSetStatus("idle", `A executar ação: ${label}`, user);
    vuOperationStart(label, user);
    vuSetProgress(15, "A preparar ação...");
    vuOperationProgress(15, "A preparar ação...");

    try {
      vuSetProgress(45, "A enviar pedido...");
      vuOperationProgress(45, "A enviar pedido para a API...");

      const data = await vuApiRequest({
        action,
        user,
        ...extraPayload
      });

      vuSetProgress(75, "A receber resposta...");
      vuOperationProgress(75, "A aguardar conclusão...");

      if (!data?.ok) {
        throw new Error(data?.error || "Erro desconhecido.");
      }

      vuSetProgress(100, "Ação concluída.");
      vuOperationSuccess(data.message || "Operação realizada.");
      vuSetStatus("ok", "Ação concluída.", data.message || "Operação realizada.");

      const refreshData = await vuApiRequest({
        action: "verificar",
        users: [user]
      });

      if (refreshData?.ok && Array.isArray(refreshData.results) && refreshData.results.length) {
        window.vuUltimosResultados[index] = refreshData.results[0];
        window.vuUltimasNotas = vuUniqueText([
          ...window.vuUltimasNotas,
          ...(Array.isArray(refreshData.notes) ? refreshData.notes : [])
        ]);
        vuRenderResultados();
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        vuSetProgressError("Operação cancelada.");
        vuSetStatus("warn", "Operação cancelada.", user);
        vuOperationHide();
        return;
      }
      vuSetProgressError("Ação não concluída.");
      vuSetStatus("err", "Erro ao executar ação.", error.message || "Erro desconhecido.");
      vuOperationError(error.message || "Erro desconhecido.");
      alert(error.message || "Erro desconhecido.");
    } finally {
      vuSetBusy(false);
      vuAbortController = null;
    }
  }

  function vuAlterarRecipientLimit(index) {
    const input = vuEl(`vuRecipientLimit-${index}`);
    const limit = Number(input?.value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      vuSetStatus("err", "Limite inválido.", "Informe um número inteiro entre 1 e 1000.");
      input?.focus();
      return;
    }
    vuExecutarAcaoResultado("set-recipient-limit", index, `Alterar limite de destinatários para ${limit}`, { limit });
  }

  function vuTextoServiceNow(result) {
    const attr3 = vuText(result?.ad?.extensionAttribute3, "<vazio>");
    const syncStatus = result?.ad?.syncBlocked
      ? "Bloqueada pelo extensionAttribute3"
      : "Sem bloqueio pelo extensionAttribute3";

    return [
      "Verificação de Utilizador - Santander Support Web",
      "",
      `Origem da consulta: ${vuText(window.vuFonteConsulta)}`,
      `Utilizador pesquisado: ${vuText(result?.input)}`,
      `Nome: ${vuText(result?.displayName)}`,
      `Utilizador resolvido: ${vuText(result?.resolvedUser)}`,
      "",
      "Resultado:",
      `AD Local validado: ${result?.ad?.checked ? "Sim" : "Não"}`,
      `AD Local: ${result?.ad?.exists ? "Existe" : "Não existe"}`,
      `Domínio AD: ${vuText(result?.ad?.domain)}`,
      `Ativo AD: ${result?.ad?.exists ? (result?.ad?.enabled ? "Sim" : "Não") : "Não aplicável"}`,
      `Criado AD: ${vuText(result?.ad?.created)}`,
      `Última modificação AD: ${vuText(result?.ad?.modified)}`,
      `Erro AD: ${vuText(result?.ad?.error)}`,
      `DN: ${vuText(result?.ad?.dn)}`,
      `msExchHideFromAddressLists: ${result?.ad?.hideFromAddressLists === null || result?.ad?.hideFromAddressLists === undefined ? "<sem valor>" : String(result.ad.hideFromAddressLists)}`,
      "",
      `extensionAttribute3: ${attr3}`,
      `Sincronização AD → Azure: ${syncStatus}`,
      "",
      `Azure validado: ${result?.azure?.checked ? "Sim" : "Não"}`,
      `Azure/Entra: ${result?.azure?.exists ? "Existe" : "Não existe"}`,
      `Ativo Azure: ${result?.azure?.exists ? (result?.azure?.enabled ? "Sim" : "Não") : "Não aplicável"}`,
      `Criado Azure: ${vuText(result?.azure?.created)}`,
      `Última sincronização: ${vuText(result?.azure?.lastSync)}`,
      `Erro Azure: ${vuText(result?.azure?.error)}`,
      "",
      `Grupo GR_PT_M365_E3: ${result?.e3?.checked ? (result?.e3?.hasGroup ? "Sim" : "Não") : "Não foi possível validar"}`,
      `Licença E3 atribuída: ${result?.e3?.checked ? (result?.e3?.hasLicense ? "Sim" : "Não") : "Não foi possível validar"}`,
      `SKU E3: ${vuText(result?.e3?.skuPartNumber)}`,
      `Erro E3: ${vuText(result?.e3?.error)}`,
      "",
      `Exchange validado: ${result?.exo?.checked ? "Sim" : "Não"}`,
      `Exchange Online: ${result?.exo?.exists ? "Existe" : "Não existe"}`,
      `Tipo mailbox: ${vuText(result?.exo?.recipientTypeDetails)}`,
      `SMTP principal: ${vuText(result?.exo?.primarySmtpAddress)}`,
      `Arquivo Online: ${result?.exo?.archiveEnabled ? "Ativo/provisionado" : "Não ativo"}`,
      `Archive Status: ${vuText(result?.exo?.archiveStatus)}`,
      `Archive GUID: ${vuText(result?.exo?.archiveGuid)}`,
      `Limite de destinatários por mensagem: ${vuText(result?.exo?.recipientLimits)}`,
      `Erro Exchange: ${vuText(result?.exo?.error)}`,
      "",
      `Diagnóstico: ${vuText(result?.diagnostic)}`
    ].join("\n");
  }

  async function vuCopyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const copied = document.execCommand("copy");
    textarea.remove();

    if (!copied) {
      throw new Error("O navegador não permitiu copiar o texto.");
    }
  }

  async function vuAbrirServiceNow(index) {
    const result = window.vuUltimosResultados[index];

    if (!result) {
      alert("Resultado não encontrado.");
      return;
    }

    const serviceNowWindow = window.open("about:blank", "_blank");

    if (!serviceNowWindow) {
      vuSetStatus(
        "warn",
        "O navegador bloqueou a abertura do ServiceNow.",
        "Autorize popups para localhost:8080 e tente novamente."
      );
      return;
    }

    try {
      serviceNowWindow.opener = null;
    } catch {}

    const text = vuTextoServiceNow(result);

    try {
      await vuCopyToClipboard(text);
      vuSetStatus("ok", "Texto copiado para o ServiceNow.", "Cole o conteúdo no campo de descrição do pedido.");
    } catch {
      vuSetStatus(
        "warn",
        "Não foi possível copiar automaticamente.",
        "O ServiceNow será aberto. Copie o resumo manualmente se necessário."
      );
    }

    serviceNowWindow.location.href = SERVICE_NOW_URL;
  }

  function vuTicketAtual() {
    return vuTicketQueue && vuTicketQueue.index < vuTicketQueue.rows.length
      ? vuTicketQueue.rows[vuTicketQueue.index]
      : null;
  }

  function vuRenderFilaTickets() {
    if (!vuTicketQueue) return;
    const row = vuTicketAtual();
    const total = vuTicketQueue.rows.length;
    const finished = !row;
    const processed = Math.min(vuTicketQueue.index, total);
    const counter = vuEl("vuTicketQueueCounter");
    const status = vuEl("vuTicketQueueStatus");
    const bar = vuEl("vuTicketQueueBar");
    if (counter) counter.textContent = finished ? `${total} de ${total}` : `${vuTicketQueue.index + 1} de ${total}`;
    if (status) status.textContent = finished
      ? `Concluído: ${vuTicketQueue.opened} aberto(s), ${vuTicketQueue.skipped} ignorado(s)`
      : `${vuTicketQueue.opened} aberto(s) · ${vuTicketQueue.skipped} ignorado(s)`;
    if (bar) bar.style.width = `${total ? Math.round((processed / total) * 100) : 0}%`;
    const name = vuEl("vuTicketQueueName");
    const user = vuEl("vuTicketQueueUser");
    const help = vuEl("vuTicketQueueHelp");
    if (name) name.textContent = row?.displayName || row?.input || "Processamento concluído";
    if (user) user.textContent = row?.resolvedUser || row?.azure?.upn || row?.input || "Não existem mais pedidos na fila.";
    if (help) help.textContent = finished
      ? "A sequência terminou. Pode fechar esta janela ou iniciar outra sequência a partir dos resultados visíveis."
      : "O resumo foi copiado e o formulário do ServiceNow foi aberto numa nova aba. Depois de abrir o pedido, volte a esta página e confirme para avançar.";
    ["vuTicketQueueConfirm", "vuTicketQueueReopen", "vuTicketQueueSkip"].forEach(id => {
      const button = vuEl(id); if (button) button.disabled = finished;
    });
  }

  function vuAbrirTicketAtual() {
    const row = vuTicketAtual();
    if (!row) { vuRenderFilaTickets(); return; }
    const popup = window.open(SERVICE_NOW_URL, "_blank", "noopener");
    if (!popup) vuSetStatus("warn", "Popup bloqueado.", "Autorize popups para esta aplicação e tente novamente.");
    vuCopyToClipboard(vuTextoServiceNow(row)).catch(() => {
      window.prompt("Copie o texto do pedido:", vuTextoServiceNow(row));
    });
    vuRenderFilaTickets();
  }

  function vuIniciarFilaTickets() {
    const visible = Array.isArray(window.vuResultadosVisiveis) ? window.vuResultadosVisiveis : [];
    const seen = new Set();
    const rows = visible.filter(row => {
      const key = String(row?.resolvedUser || row?.azure?.upn || row?.ad?.sam || row?.input || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
    if (!rows.length) { vuSetStatus("warn", "Sem pedidos para abrir.", "Não existem resultados visíveis."); return; }
    vuTicketQueue = { rows, index: 0, opened: 0, skipped: 0 };
    const overlay = vuEl("vuTicketQueueOverlay");
    overlay?.classList.add("open");
    overlay?.setAttribute("aria-hidden", "false");
    vuAbrirTicketAtual();
  }

  function vuAvancarFilaTickets(opened) {
    if (!vuTicketQueue || !vuTicketAtual()) return;
    if (opened) vuTicketQueue.opened += 1; else vuTicketQueue.skipped += 1;
    vuTicketQueue.index += 1;
    vuRenderFilaTickets();
    if (vuTicketAtual()) vuAbrirTicketAtual();
    else vuSetStatus("ok", "Sequência de pedidos concluída.", `${vuTicketQueue.opened} pedido(s) confirmado(s).`);
  }

  function vuFecharFilaTickets() {
    const overlay = vuEl("vuTicketQueueOverlay");
    overlay?.classList.remove("open");
    overlay?.setAttribute("aria-hidden", "true");
  }

  function vuInfoCard(kind, icon, title, text) {
    return `
      <div class="vu-fix-card ${vuEscapeHtml(kind)}">
        <div class="vu-fix-icon">${icon}</div>
        <div class="vu-fix-content">
          <strong>${vuEscapeHtml(title)}</strong>
          <span>${vuEscapeHtml(text)}</span>
        </div>
      </div>
    `;
  }

  function vuRenderAcoes(result, originalIndex) {
    const cards = [];
    const attr3 = vuText(result?.ad?.extensionAttribute3, "");

    if (!result?.ad?.checked) {
      cards.push(vuInfoCard(
        "blocked",
        "⚠",
        "AD local não validado",
        vuText(result?.ad?.error, "Verifique o módulo ActiveDirectory, a rede e as permissões.")
      ));
    } else if (!result?.ad?.exists && !result?.azure?.exists) {
      cards.push(vuInfoCard(
        "blocked",
        "🔎",
        "Utilizador não encontrado",
        "O utilizador não foi localizado no AD local nem no Azure/Entra."
      ));
    } else if (!result?.ad?.exists && result?.azure?.exists) {
      cards.push(vuInfoCard(
        "wait",
        "⚠",
        "Existe apenas no Azure",
        "Confirmar a origem do objeto e por que não foi encontrado no AD local."
      ));
    }

    if (result?.ad?.exists && !result?.ad?.enabled) {
      cards.push(vuInfoCard(
        "blocked",
        "⛔",
        "Utilizador desativado no AD",
        "Rever o estado da conta antes de executar ações de licenciamento ou mailbox."
      ));
    }

    if (result?.azure?.exists && !result?.azure?.enabled) {
      cards.push(vuInfoCard(
        "blocked",
        "⛔",
        "Utilizador desativado no Azure",
        "Rever o estado da conta sincronizada no Entra ID."
      ));
    }

    if (result?.ad?.exists && result?.ad?.syncBlocked) {
      cards.push(vuInfoCard(
        "blocked",
        "⛔",
        "Sincronização condicionada pelo atributo 3",
        `extensionAttribute3: ${attr3}. Limpe o atributo no AD quando for necessário permitir a sincronização.`
      ));
    } else if (result?.ad?.exists && result?.azure?.checked && !result?.azure?.exists) {
      cards.push(vuInfoCard(
        "wait",
        "⏱",
        "Aguardar sincronização",
        "Existe no AD, o atributo 3 está vazio, mas ainda não existe no Azure. Se foi criado hoje, aguardar FIM amanhã às 08:00."
      ));
    }

    if (!result?.azure?.checked) {
      cards.push(vuInfoCard(
        "wait",
        "⚠",
        "Azure/Entra não validado",
        vuText(result?.azure?.error, "Verifique a ligação e as permissões do Microsoft Graph.")
      ));
    }

    if (result?.azure?.exists && result?.e3?.checked === false) {
      cards.push(vuInfoCard(
        "wait",
        "⚠",
        "Não foi possível validar a licença E3",
        vuText(result?.e3?.error, "Verifique a ligação e as permissões do Microsoft Graph.")
      ));
    } else if (result?.azure?.exists && !result?.e3?.hasGroup) {
      cards.push(`
        <button type="button" class="vu-fix-card action license" data-vu-busy onclick="vuExecutarAcaoResultado('add-e3', ${Number(originalIndex)}, 'Adicionar licença E3 / grupo GR_PT_M365_E3')">
          <div class="vu-fix-icon">💳</div>
          <div class="vu-fix-content">
            <strong>Adicionar licença E3</strong>
            <span>Adicionar ao grupo GR_PT_M365_E3</span>
          </div>
          <div class="vu-fix-arrow">→</div>
        </button>
      `);
    } else if (result?.azure?.exists && result?.e3?.hasGroup && !result?.e3?.hasLicense) {
      cards.push(vuInfoCard(
        "wait",
        "⏱",
        "Licença E3 ainda não atribuída",
        "O grupo de licenciamento está presente, mas o SKU E3 ainda não aparece no utilizador. Aguarde o processamento e volte a verificar."
      ));
    }

    if (result?.ad?.exists && result?.ad?.hideFromAddressLists !== null && result?.ad?.hideFromAddressLists !== undefined) {
      cards.push(`
        <button type="button" class="vu-fix-card action" data-vu-busy onclick="vuExecutarAcaoResultado('clear-hide-address-list', ${Number(originalIndex)}, 'Limpar msExchHideFromAddressLists')">
          <div class="vu-fix-icon">📇</div>
          <div class="vu-fix-content">
            <strong>Limpar ocultação da lista de endereços</strong>
            <span>Remover o valor atual de msExchHideFromAddressLists (${result.ad.hideFromAddressLists ? "True" : "False"}).</span>
          </div>
          <div class="vu-fix-arrow">→</div>
        </button>
      `);
    }

    if (!result?.exo?.checked) {
      cards.push(vuInfoCard(
        "wait",
        "⚠",
        "Exchange Online não validado",
        vuText(result?.exo?.error, "Verifique a ligação WAM e as permissões no Exchange Online.")
      ));
    } else if (result?.azure?.exists && !result?.exo?.exists) {
      cards.push(vuInfoCard(
        "wait",
        "📭",
        "Mailbox ainda não encontrada",
        "Confirmar licenciamento e aguardar o provisionamento da mailbox."
      ));
    } else if (result?.exo?.exists && !result?.exo?.archiveEnabled) {
      cards.push(`
        <button type="button" class="vu-fix-card action archive" data-vu-busy onclick="vuExecutarAcaoResultado('enable-archive', ${Number(originalIndex)}, 'Ativar Arquivo Online')">
          <div class="vu-fix-icon">🗄️</div>
          <div class="vu-fix-content">
            <strong>Ativar Arquivo Online</strong>
            <span>Executar a ativação do arquivo e identificar objetos híbridos.</span>
          </div>
          <div class="vu-fix-arrow">→</div>
        </button>
      `);
    }

    if (result?.exo?.exists) {
      const currentLimit = /^\d+$/.test(String(result?.exo?.recipientLimits || "")) ? String(result.exo.recipientLimits) : "";
      cards.push(`
        <div class="vu-fix-card vu-limit-card">
          <div class="vu-fix-icon">✉️</div>
          <div class="vu-fix-content">
            <strong>Limite de destinatários</strong>
            <span>Atual: ${vuEscapeHtml(vuText(result?.exo?.recipientLimits))}. Defina entre 1 e 1000.</span>
            <div class="vu-inline-action">
              <input id="vuRecipientLimit-${Number(originalIndex)}" type="number" min="1" max="1000" step="1" value="${vuEscapeHtml(currentLimit)}" aria-label="Novo limite de destinatários">
              <button type="button" class="vu-btn vu-btn-primary" data-vu-busy onclick="vuAlterarRecipientLimit(${Number(originalIndex)})">Alterar</button>
            </div>
          </div>
        </div>
      `);
    }

    if (!cards.length) {
      cards.push(vuInfoCard(
        "ok",
        "✓",
        "Sem ações pendentes",
        "AD, sincronização, licença, mailbox e Arquivo Online estão validados."
      ));
    }

    return `
      <div class="vu-fix-area">
        <div class="vu-fix-title">Ações corretivas e observações</div>
        <div class="vu-fix-grid">
          ${cards.join("")}
        </div>
      </div>
    `;
  }

  function vuIsHealthy(result) {
    return String(result?.diagnostic || "").trim().toLowerCase() === "utilizador saudável";
  }

  function vuHasPending(result) {
    return !vuIsHealthy(result);
  }

  function vuMatchesKpiFilter(result, filterName) {
    switch (filterName) {
      case "ad":
        return Boolean(result?.ad?.exists);
      case "azure":
        return Boolean(result?.azure?.exists);
      case "e3":
        return Boolean(result?.e3?.checked && result?.e3?.hasLicense);
      case "exo":
        return Boolean(result?.exo?.checked && result?.exo?.exists);
      case "archive":
        return Boolean(result?.exo?.archiveEnabled);
      case "healthy":
        return vuIsHealthy(result);
      case "pending":
        return vuHasPending(result);
      case "all":
      default:
        return true;
    }
  }

  function vuUpdateKpiFilterUi() {
    const activeFilter = VU_KPI_FILTER_LABELS[window.vuKpiFilter]
      ? window.vuKpiFilter
      : "all";

    document.querySelectorAll(".vu-kpi-card[data-vu-kpi]").forEach(card => {
      const isActive = card.dataset.vuKpi === activeFilter;
      card.classList.toggle("is-active", isActive);
      card.setAttribute("aria-pressed", isActive ? "true" : "false");
    });

    const bar = vuEl("vuActiveFilter");
    const text = vuEl("vuActiveFilterText");

    if (bar) bar.hidden = activeFilter === "all";
    if (text) text.textContent = `Filtro rápido: ${VU_KPI_FILTER_LABELS[activeFilter]}`;
  }

  function vuAplicarFiltroKpi(filterName) {
    const requested = VU_KPI_FILTER_LABELS[filterName] ? filterName : "all";
    const current = VU_KPI_FILTER_LABELS[window.vuKpiFilter]
      ? window.vuKpiFilter
      : "all";

    window.vuKpiFilter = requested !== "all" && requested === current
      ? "all"
      : requested;

    vuRenderResultados();

    const resultsPanel = document.querySelector(".vu-results-panel");
    if (resultsPanel?.scrollIntoView) {
      resultsPanel.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  }

  function vuLimparFiltroKpi() {
    window.vuKpiFilter = "all";
    window.vuResultadosVisiveis = [];
    vuTicketQueue = null;
    vuFecharFilaTickets();
    vuRenderResultados();
  }

  function vuRenderResultados() {
    const container = vuEl("vuResultado");
    if (!container) return;

    const filter = (vuEl("vuFilter")?.value || "").toLowerCase();
    const allRows = Array.isArray(window.vuUltimosResultados) ? window.vuUltimosResultados : [];

    let indexedRows = allRows.map((result, originalIndex) => ({
      result,
      originalIndex
    }));

    const kpiFilter = VU_KPI_FILTER_LABELS[window.vuKpiFilter]
      ? window.vuKpiFilter
      : "all";

    indexedRows = indexedRows.filter(item =>
      vuMatchesKpiFilter(item.result, kpiFilter)
    );

    if (filter) {
      indexedRows = indexedRows.filter(item =>
        JSON.stringify(item.result).toLowerCase().includes(filter)
      );
    }

    window.vuResultadosVisiveis = indexedRows.map(item => item.result);
    const ticketButton = vuEl("vuOpenAllTickets");
    if (ticketButton) {
      ticketButton.disabled = window.vuResultadosVisiveis.length === 0;
      ticketButton.textContent = window.vuResultadosVisiveis.length
        ? `Abrir pedidos em sequência (${window.vuResultadosVisiveis.length})`
        : "Abrir pedidos em sequência";
    }

    const total = allRows.length;
    const ad = allRows.filter(result => result?.ad?.exists).length;
    const azure = allRows.filter(result => result?.azure?.exists).length;
    const exo = allRows.filter(result => result?.exo?.exists).length;
    const e3 = allRows.filter(result => result?.e3?.checked && result?.e3?.hasLicense).length;
    const archive = allRows.filter(result => result?.exo?.archiveEnabled).length;
    const healthy = allRows.filter(vuIsHealthy).length;
    const pending = allRows.filter(vuHasPending).length;

    const kpis = {
      vuKpiTotal: total,
      vuKpiAd: ad,
      vuKpiAzure: azure,
      vuKpiExo: exo,
      vuKpiE3: e3,
      vuKpiArchive: archive,
      vuKpiHealthy: healthy,
      vuKpiPending: pending
    };

    Object.entries(kpis).forEach(([id, value]) => {
      const element = vuEl(id);
      if (element) element.textContent = value;
    });

    const summary = vuEl("vuResumoSub");
    if (summary) {
      summary.textContent = total
        ? `${total} resultado(s) • ${vuText(window.vuFonteConsulta)}`
        : "Aguardando consulta";
    }

    const count = vuEl("vuResultCount");
    if (count) {
      const hasViewFilter = kpiFilter !== "all" || Boolean(filter);
      count.textContent = hasViewFilter
        ? `${indexedRows.length} de ${total} resultado(s)`
        : `${indexedRows.length} resultado(s)`;
    }

    vuUpdateKpiFilterUi();

    const source = vuEl("vuResultSource");
    if (source) source.textContent = vuText(window.vuFonteConsulta, "Sem origem");

    const notes = vuEl("vuNotes");
    if (notes) {
      const noteList = Array.isArray(window.vuUltimasNotas) ? window.vuUltimasNotas : [];

      notes.innerHTML = noteList.map(note => {
        const text = vuText(note, "");
        const isError = /erro|falha|parcial|indisponível/i.test(text);
        return `<span class="${isError ? "vu-note-error" : "vu-note-ok"}">${isError ? "⚠" : "✓"} ${vuEscapeHtml(text)}</span>`;
      }).join("<br>");
    }

    if (!indexedRows.length) {
      container.className = "vu-results-empty";

      if (!total) {
        container.textContent = "Nenhuma consulta executada.";
      } else if (kpiFilter !== "all") {
        container.textContent = `Nenhum utilizador corresponde ao filtro "${VU_KPI_FILTER_LABELS[kpiFilter]}".`;
      } else {
        container.textContent = "Nenhum resultado corresponde ao texto pesquisado.";
      }

      return;
    }

    container.className = "vu-result-list";

    container.innerHTML = indexedRows.map(({ result, originalIndex }) => {
      const name = vuText(result?.displayName, result?.input || "-");
      const diagnostic = vuText(result?.diagnostic);
      const healthyResult = vuIsHealthy(result);
      const diagnosticClass = healthyResult ? "ok" : "warn";
      const attr3 = vuText(result?.ad?.extensionAttribute3, "<vazio>");
      const attr3Filled = Boolean(result?.ad?.syncBlocked);

      const e3Display = result?.e3?.checked === false
        ? vuWarn("Não validado")
        : vuBool(result?.e3?.hasLicense, "Licença atribuída", "Licença não atribuída");

      const exoExists = result?.exo?.checked
        ? vuBool(result?.exo?.exists, "Existe", "Não existe")
        : vuWarn("Não validado");

      return `
        <article class="vu-user-card">
          <div class="vu-user-header">
            <div class="vu-user-left">
              <div class="vu-avatar">${vuEscapeHtml(vuInitials(name, result?.input))}</div>
              <div class="vu-user-title">
                <strong>${vuEscapeHtml(name)}</strong>
                <span>Input: ${vuEscapeHtml(vuText(result?.input))} • Resolvido: ${vuEscapeHtml(vuText(result?.resolvedUser))}</span>
              </div>
            </div>
            <div class="vu-diag">
              <span class="vu-pill ${diagnosticClass}">${healthyResult ? "✓" : "!"} ${vuEscapeHtml(diagnostic)}</span>
            </div>
          </div>

          <div class="vu-detail-grid">
            <div class="vu-detail">
              <h4>AD Local</h4>
              ${vuStatePill(result?.ad?.checked, result?.ad?.exists, result?.ad?.enabled)}
              <div class="vu-line"><b>Domínio:</b> ${vuEscapeHtml(vuText(result?.ad?.domain))}</div>
              <div class="vu-line"><b>SAM:</b> ${vuEscapeHtml(vuText(result?.ad?.sam))}</div>
              <div class="vu-line"><b>UPN:</b> ${vuEscapeHtml(vuText(result?.ad?.upn))}</div>
              <div class="vu-line"><b>Mailbox GUID:</b> ${vuEscapeHtml(vuText(result?.ad?.mailboxGuid))}</div>
              <div class="vu-line"><b>Consistency GUID:</b> ${vuEscapeHtml(vuText(result?.ad?.consistencyGuid))}</div>
              <div class="vu-line"><b>Archive GUID:</b> ${vuEscapeHtml(vuText(result?.ad?.archiveGuid))}</div>
              <div class="vu-line"><b>Archive Status:</b> ${vuEscapeHtml(vuText(result?.ad?.archiveStatus))}</div>
              <div class="vu-line"><b>Criado:</b> ${vuEscapeHtml(vuText(result?.ad?.created))}</div>
              <div class="vu-line"><b>Última modificação:</b> ${vuEscapeHtml(vuText(result?.ad?.modified))}</div>
              <div class="vu-line"><b>msExchHideFromAddressLists:</b> ${result?.ad?.hideFromAddressLists === null || result?.ad?.hideFromAddressLists === undefined ? "&lt;sem valor&gt;" : (result.ad.hideFromAddressLists ? "True" : "False")}</div>
              ${result?.ad?.error ? `<div class="vu-line vu-line-error"><b>Erro:</b> ${vuEscapeHtml(result.ad.error)}</div>` : ""}
            </div>

            <div class="vu-detail">
              <h4>Atributo 3 / Sincronização</h4>
              ${result?.ad?.checked
                ? (attr3Filled ? vuWarn("Preenchido") : `<span class="vu-pill ok">✓ Vazio</span>`)
                : vuWarn("Não validado")}
              <div class="vu-line"><b>extensionAttribute3:</b> ${vuEscapeHtml(attr3)}</div>
              <div class="vu-line"><b>Estado:</b> ${vuEscapeHtml(vuText(result?.sync?.status))}</div>
            </div>

            <div class="vu-detail">
              <h4>Azure / Entra</h4>
              ${vuStatePill(result?.azure?.checked, result?.azure?.exists, result?.azure?.enabled)}
              <div class="vu-line"><b>UPN:</b> ${vuEscapeHtml(vuText(result?.azure?.upn))}</div>
              <div class="vu-line"><b>Mailbox GUID:</b> ${vuEscapeHtml(vuText(result?.azure?.mailboxGuid))}</div>
              <div class="vu-line"><b>Consistency GUID:</b> ${vuEscapeHtml(vuText(result?.azure?.consistencyGuid))}</div>
              <div class="vu-line"><b>Archive GUID:</b> ${vuEscapeHtml(vuText(result?.azure?.archiveGuid))}</div>
              <div class="vu-line"><b>Archive Status:</b> ${vuEscapeHtml(vuText(result?.azure?.archiveStatus))}</div>
              <div class="vu-line"><b>Criado:</b> ${vuEscapeHtml(vuText(result?.azure?.created))}</div>
              <div class="vu-line"><b>Última sync:</b> ${vuEscapeHtml(vuText(result?.azure?.lastSync))}</div>
              ${result?.azure?.error ? `<div class="vu-line vu-line-error"><b>Erro:</b> ${vuEscapeHtml(result.azure.error)}</div>` : ""}
            </div>

            <div class="vu-detail">
              <h4>Licença E3</h4>
              ${e3Display}
              <div class="vu-line"><b>Grupo:</b> ${vuEscapeHtml(vuText(result?.e3?.groupName, "GR_PT_M365_E3"))}</div>
              <div class="vu-line"><b>No grupo:</b> ${result?.e3?.hasGroup ? "Sim" : "Não"}</div>
              <div class="vu-line"><b>SKU atribuído:</b> ${vuEscapeHtml(vuText(result?.e3?.skuPartNumber))}</div>
              <div class="vu-line"><b>Verificado:</b> ${result?.e3?.checked ? "Sim" : "Não"}</div>
              ${result?.e3?.error ? `<div class="vu-line vu-line-error"><b>Erro:</b> ${vuEscapeHtml(result.e3.error)}</div>` : ""}
            </div>

            <div class="vu-detail">
              <h4>Exchange Online</h4>
              ${exoExists}
              <div class="vu-line"><b>UPN:</b> ${vuEscapeHtml(vuText(result?.exo?.upn))}</div>
              <div class="vu-line"><b>Mailbox GUID:</b> ${vuEscapeHtml(vuText(result?.exo?.mailboxGuid))}</div>
              <div class="vu-line"><b>Consistency GUID:</b> ${vuEscapeHtml(vuText(result?.exo?.consistencyGuid))}</div>
              <div class="vu-line"><b>Archive GUID:</b> ${vuEscapeHtml(vuText(result?.exo?.archiveGuid))}</div>
              <div class="vu-line"><b>Archive Status:</b> ${vuEscapeHtml(vuText(result?.exo?.archiveStatus))}</div>
              <div class="vu-line"><b>Tipo:</b> ${vuEscapeHtml(vuText(result?.exo?.recipientTypeDetails))}</div>
              <div class="vu-line"><b>SMTP:</b> ${vuEscapeHtml(vuText(result?.exo?.primarySmtpAddress))}</div>
              <div class="vu-line"><b>Arquivo:</b> ${result?.exo?.exists ? (result?.exo?.archiveEnabled ? "Ativo/provisionado" : "Não ativo") : "Não aplicável"}</div>
              <div class="vu-line"><b>Limite de destinatários:</b> ${vuEscapeHtml(vuText(result?.exo?.recipientLimits))}</div>
              ${result?.exo?.error ? `<div class="vu-line vu-line-error"><b>Erro:</b> ${vuEscapeHtml(result.exo.error)}</div>` : ""}
            </div>

            <div class="vu-detail">
              <h4>Identidade</h4>
              <div class="vu-line"><b>Mail AD:</b> ${vuEscapeHtml(vuText(result?.ad?.mail))}</div>
              <div class="vu-line"><b>Azure ID:</b> ${vuEscapeHtml(vuText(result?.azure?.id))}</div>
              <div class="vu-line"><b>Archive GUID:</b> ${vuEscapeHtml(vuText(result?.exo?.archiveGuid))}</div>
            </div>
          </div>

          ${vuRenderAcoes(result, originalIndex)}

          <div class="vu-servicenow-area">
            <button type="button" class="vu-servicenow-btn vu-png-btn" data-vu-busy onclick="vuExportarResultadoPng(${Number(originalIndex)})">
              <span class="vu-servicenow-icon">🖼️</span>
              <span>
                <strong>Guardar quadro em PNG</strong>
                <small>Cria uma imagem deste resultado para anexar ao pedido</small>
              </span>
              <b>↓</b>
            </button>
            <button type="button" class="vu-servicenow-btn" data-vu-busy onclick="vuAbrirServiceNow(${Number(originalIndex)})">
              <span class="vu-servicenow-icon">📝</span>
              <span>
                <strong>Abrir ServiceNow</strong>
                <small>Copia o resumo da verificação e abre o pedido</small>
              </span>
              <b>→</b>
            </button>
          </div>

          <div class="vu-dn-box">
            <b>DN:</b> ${vuEscapeHtml(vuText(result?.ad?.dn))}
          </div>
        </article>
      `;
    }).join("");

    if (vuBusy) {
      document.querySelectorAll("[data-vu-busy]").forEach(element => {
        element.disabled = true;
        element.classList.add("is-disabled");
      });
    }
  }

  function vuPngValue(value, fallback = "—") {
    const text = String(value === null || value === undefined ? "" : value).trim();
    return text || fallback;
  }

  function vuPngBoolean(value, yes = "Sim", no = "Não") {
    return value ? yes : no;
  }

  function vuPngWrap(ctx, text, maxWidth) {
    const source = vuPngValue(text);
    const words = source.split(/\s+/);
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      if (ctx.measureText(word).width <= maxWidth) { line = word; continue; }
      let chunk = "";
      for (const character of word) {
        if (ctx.measureText(chunk + character).width > maxWidth && chunk) { lines.push(chunk); chunk = character; }
        else chunk += character;
      }
      line = chunk;
    }
    if (line) lines.push(line);
    return lines.length ? lines : ["—"];
  }

  function vuPngRoundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function vuPngSectionHeight(ctx, rows, width) {
    ctx.font = "24px Arial, sans-serif";
    return 66 + rows.reduce((height, row) => height + Math.max(1, vuPngWrap(ctx, `${row[0]}: ${row[1]}`, width - 48).length) * 34, 0) + 24;
  }

  function vuPngDrawSection(ctx, section, x, y, width) {
    const height = vuPngSectionHeight(ctx, section.rows, width);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#dfe3e8";
    ctx.lineWidth = 2;
    vuPngRoundRect(ctx, x, y, width, height, 16);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#202124";
    ctx.font = "700 28px Arial, sans-serif";
    ctx.fillText(section.title, x + 24, y + 42);
    let lineY = y + 82;
    ctx.font = "24px Arial, sans-serif";
    for (const [label, value] of section.rows) {
      const lines = vuPngWrap(ctx, `${label}: ${vuPngValue(value)}`, width - 48);
      lines.forEach((line, lineIndex) => {
        ctx.fillStyle = lineIndex === 0 ? "#344054" : "#667085";
        ctx.fillText(line, x + 24, lineY);
        lineY += 34;
      });
    }
    return height;
  }

  function vuPngPendingReasons(result) {
    const reasons = [];
    if (!result?.ad?.checked) reasons.push("não foi possível validar o AD Local");
    else if (!result?.ad?.exists) reasons.push("utilizador não encontrado no AD Local");
    else if (!result?.ad?.enabled) reasons.push("utilizador desativado no AD Local");
    if (result?.ad?.syncBlocked) reasons.push(`extensionAttribute3 preenchido (${vuPngValue(result?.ad?.extensionAttribute3)})`);
    if (result?.ad?.hideFromAddressLists === true) reasons.push("msExchHideFromAddressLists está definido como True");
    if (!result?.azure?.checked) reasons.push("não foi possível validar o Azure/Entra");
    else if (!result?.azure?.exists) reasons.push("utilizador não encontrado no Azure/Entra");
    else if (!result?.azure?.enabled) reasons.push("utilizador desativado no Azure/Entra");
    if (result?.azure?.exists && result?.e3?.checked === false) reasons.push("não foi possível validar o licenciamento E3");
    else if (result?.azure?.exists && !result?.e3?.hasGroup) reasons.push("grupo GR_PT_M365_E3 em falta");
    else if (result?.azure?.exists && !result?.e3?.hasLicense) reasons.push("licença E3 ainda não atribuída");
    if (!result?.exo?.checked) reasons.push("não foi possível validar o Exchange Online");
    else if (!result?.exo?.exists) reasons.push("mailbox não encontrada no Exchange Online");
    else if (!result?.exo?.archiveEnabled) reasons.push("Arquivo Online não está ativo");
    return vuUniqueText(reasons);
  }

  async function vuExportarResultadoPng(index) {
    const result = window.vuUltimosResultados[index];
    if (!result) { vuSetStatus("err", "Não foi possível criar o PNG.", "Resultado não encontrado."); return; }
    const sections = [
      { title: "AD Local", rows: [
        ["Estado", result?.ad?.checked ? (result?.ad?.exists ? (result?.ad?.enabled ? "Existe e está ativo" : "Existe e está inativo") : "Não encontrado") : "Não validado"],
        ["UPN", result?.ad?.upn], ["Mailbox GUID", result?.ad?.mailboxGuid], ["Consistency GUID", result?.ad?.consistencyGuid],
        ["Archive GUID", result?.ad?.archiveGuid], ["Archive Status", result?.ad?.archiveStatus],
        ["msExchHideFromAddressLists", result?.ad?.hideFromAddressLists === null || result?.ad?.hideFromAddressLists === undefined ? "Sem valor" : String(result.ad.hideFromAddressLists)],
        ["extensionAttribute3", result?.ad?.extensionAttribute3 || "Sem valor"], ["Domínio", result?.ad?.domain]
      ]},
      { title: "Azure / Entra", rows: [
        ["Estado", result?.azure?.checked ? (result?.azure?.exists ? (result?.azure?.enabled ? "Existe e está ativo" : "Existe e está inativo") : "Não encontrado") : "Não validado"],
        ["UPN", result?.azure?.upn], ["Mailbox GUID", result?.azure?.mailboxGuid], ["Consistency GUID", result?.azure?.consistencyGuid],
        ["Archive GUID", result?.azure?.archiveGuid], ["Archive Status", result?.azure?.archiveStatus], ["Última sincronização", result?.azure?.lastSync]
      ]},
      { title: "Exchange Online", rows: [
        ["Estado", result?.exo?.checked ? (result?.exo?.exists ? "Mailbox encontrada" : "Mailbox não encontrada") : "Não validado"],
        ["UPN", result?.exo?.upn], ["Mailbox GUID", result?.exo?.mailboxGuid], ["Consistency GUID", result?.exo?.consistencyGuid],
        ["Archive GUID", result?.exo?.archiveGuid], ["Archive Status", result?.exo?.archiveStatus],
        ["Limite de destinatários", result?.exo?.recipientLimits], ["SMTP principal", result?.exo?.primarySmtpAddress], ["Tipo", result?.exo?.recipientTypeDetails]
      ]},
      { title: "Licenciamento e diagnóstico", rows: [
        ["Grupo GR_PT_M365_E3", vuPngBoolean(result?.e3?.hasGroup)], ["Licença E3 atribuída", vuPngBoolean(result?.e3?.hasLicense)],
        ["SKU", result?.e3?.skuPartNumber], ["Arquivo Online", result?.exo?.archiveEnabled ? "Ativo/provisionado" : "Não ativo"],
        ["Diagnóstico", result?.diagnostic]
      ]}
    ];
    const logicalWidth = 1500;
    const margin = 56;
    const gap = 28;
    const columnWidth = (logicalWidth - margin * 2 - gap) / 2;
    const measureCanvas = document.createElement("canvas");
    const measureContext = measureCanvas.getContext("2d");
    const pendingReasons = vuPngPendingReasons(result);
    const healthy = vuIsHealthy(result) && pendingReasons.length === 0;
    const conclusionParagraphs = healthy
      ? ["Utilizador validado com sucesso. A conta encontra-se ativa e operacional, com sincronização, licenciamento, mailbox e Arquivo Online verificados. Não foram identificadas pendências no momento desta consulta."]
      : [
          "A verificação identificou as seguintes pendências:",
          ...pendingReasons.map(reason => `• ${reason}.`),
          pendingReasons.length ? "Consulte os detalhes abaixo antes de encerrar o pedido." : `• ${vuPngValue(result?.diagnostic, "resultado requer validação")}.`
        ];
    measureContext.font = "26px Arial, sans-serif";
    const conclusionLines = conclusionParagraphs.flatMap(paragraph => vuPngWrap(measureContext, paragraph, logicalWidth - margin * 2 - 56));
    const conclusionHeight = 88 + conclusionLines.length * 38;
    const heights = sections.map(section => vuPngSectionHeight(measureContext, section.rows, columnWidth));
    const leftHeight = heights[0] + gap + heights[2];
    const rightHeight = heights[1] + gap + heights[3];
    const conclusionTop = 234;
    const sectionsTop = conclusionTop + conclusionHeight + gap;
    const logicalHeight = sectionsTop + Math.max(leftHeight, rightHeight) + margin;
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = logicalWidth * scale;
    canvas.height = logicalHeight * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#f5f6f8"; ctx.fillRect(0, 0, logicalWidth, logicalHeight);
    const gradient = ctx.createLinearGradient(0, 0, logicalWidth, 0);
    gradient.addColorStop(0, "#ec0000"); gradient.addColorStop(1, "#a80000");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, logicalWidth, 210);
    ctx.fillStyle = "#ffffff"; ctx.font = "700 42px Arial, sans-serif";
    ctx.fillText("Verificação de Utilizador", margin, 68);
    ctx.font = "700 34px Arial, sans-serif";
    ctx.fillText(vuPngValue(result?.displayName, result?.input), margin, 125);
    ctx.font = "25px Arial, sans-serif";
    ctx.fillText(`Utilizador: ${vuPngValue(result?.resolvedUser, result?.input)}`, margin, 169);
    ctx.textAlign = "right";
    ctx.fillText(new Date().toLocaleString("pt-PT"), logicalWidth - margin, 68);
    ctx.textAlign = "left";
    ctx.fillStyle = healthy ? "#ecfdf3" : "#fffaeb";
    ctx.strokeStyle = healthy ? "#12b76a" : "#f79009";
    ctx.lineWidth = 3;
    vuPngRoundRect(ctx, margin, conclusionTop, logicalWidth - margin * 2, conclusionHeight, 18);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = healthy ? "#027a48" : "#b54708";
    ctx.font = "700 30px Arial, sans-serif";
    ctx.fillText(healthy ? "✓ Conclusão: utilizador operacional" : "⚠ Conclusão: existem pontos a validar", margin + 28, conclusionTop + 44);
    ctx.fillStyle = "#344054";
    ctx.font = "26px Arial, sans-serif";
    conclusionLines.forEach((line, lineIndex) => ctx.fillText(line, margin + 28, conclusionTop + 88 + lineIndex * 38));
    let leftY = sectionsTop;
    leftY += vuPngDrawSection(ctx, sections[0], margin, leftY, columnWidth) + gap;
    vuPngDrawSection(ctx, sections[2], margin, leftY, columnWidth);
    let rightY = sectionsTop;
    rightY += vuPngDrawSection(ctx, sections[1], margin + columnWidth + gap, rightY, columnWidth) + gap;
    vuPngDrawSection(ctx, sections[3], margin + columnWidth + gap, rightY, columnWidth);
    const safeUser = vuPngValue(result?.ad?.sam, result?.input).replace(/[^a-z0-9._-]+/gi, "-");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const fileName = `verificacao-utilizador-${safeUser}-${stamp}.png`;
    vuSetBusy(true, "A guardar PNG em C:\\temp...");
    try {
      const response = await vuApiRequest({ action: "save-png", fileName, imageBase64: canvas.toDataURL("image/png") });
      if (!response?.ok) throw new Error(response?.error || "Não foi possível guardar o PNG.");
      vuSetStatus("ok", "PNG criado.", response.path || response.message || `C:\\temp\\${fileName}`);
    } catch (error) {
      vuSetStatus("err", "Erro ao guardar PNG.", error.message || "Erro desconhecido.");
      alert(error.message || "Não foi possível guardar o PNG.");
    } finally {
      vuSetBusy(false);
    }
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
      "Origem Consulta",
      "Utilizador",
      "Nome",
      "AD Verificado",
      "AD Existe",
      "Dominio AD",
      "Ativo AD",
      "Erro AD",
      "extensionAttribute3",
      "msExchHideFromAddressLists",
      "Bloqueio Sync Attribute3",
      "Azure Verificado",
      "Azure Existe",
      "Ativo Azure",
      "Erro Azure",
      "Licenca E3",
      "E3 Verificado",
      "Erro E3",
      "EXO Verificado",
      "EXO Existe",
      "Erro EXO",
      "Arquivo Online",
      "Criado AD",
      "Ultima Modificacao AD",
      "Criado Azure",
      "Ultima Sync Azure",
      "UPN Azure",
      "Mail AD",
      "SMTP Principal EXO",
      "Tipo EXO",
      "Archive Status",
      "Archive GUID",
      "Limite Destinatarios",
      "DN",
      "Diagnostico"
    ];

    const lines = [headers.map(vuCsvEscape).join(";")];

    for (const result of window.vuUltimosResultados) {
      lines.push([
        window.vuFonteConsulta || "",
        result?.input || "",
        result?.displayName || "",
        result?.ad?.checked ? "Sim" : "Não",
        result?.ad?.exists ? "Sim" : "Não",
        result?.ad?.domain || "",
        result?.ad?.exists ? (result?.ad?.enabled ? "Sim" : "Não") : "",
        result?.ad?.error || "",
        result?.ad?.extensionAttribute3 || "",
        result?.ad?.hideFromAddressLists === null || result?.ad?.hideFromAddressLists === undefined ? "" : String(result.ad.hideFromAddressLists),
        result?.ad?.syncBlocked ? "Sim" : "Não",
        result?.azure?.checked ? "Sim" : "Não",
        result?.azure?.exists ? "Sim" : "Não",
        result?.azure?.exists ? (result?.azure?.enabled ? "Sim" : "Não") : "",
        result?.azure?.error || "",
        result?.e3?.hasLicense ? "Sim" : "Não",
        result?.e3?.checked ? "Sim" : "Não",
        result?.e3?.error || "",
        result?.exo?.checked ? "Sim" : "Não",
        result?.exo?.exists ? "Sim" : "Não",
        result?.exo?.error || "",
        result?.exo?.archiveEnabled ? "Sim" : "Não",
        result?.ad?.created || "",
        result?.ad?.modified || "",
        result?.azure?.created || "",
        result?.azure?.lastSync || "",
        result?.azure?.upn || "",
        result?.ad?.mail || "",
        result?.exo?.primarySmtpAddress || "",
        result?.exo?.recipientTypeDetails || "",
        result?.exo?.archiveStatus || "",
        result?.exo?.archiveGuid || "",
        result?.exo?.recipientLimits || "",
        result?.ad?.dn || "",
        result?.diagnostic || ""
      ].map(vuCsvEscape).join(";"));
    }

    const csvContent = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csvContent], {
      type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const now = new Date();
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");

    anchor.href = url;
    anchor.download = `verificacao-utilizadores-${stamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  async function vuCopiarResumo() {
    if (!window.vuUltimosResultados.length) {
      alert("Sem resultados para copiar.");
      return;
    }

    const text = [
      `Origem: ${vuText(window.vuFonteConsulta)}`,
      "",
      ...window.vuUltimosResultados.map(result => {
        const attr3 = vuText(result?.ad?.extensionAttribute3, "<vazio>");

        return [
          `${vuText(result?.input)} | ${vuText(result?.displayName)}`,
          `AD: ${result?.ad?.checked ? (result?.ad?.exists ? "Sim" : "Não") : "Não validado"}`,
          `Criado AD: ${vuText(result?.ad?.created)}`,
          `Última modificação AD: ${vuText(result?.ad?.modified)}`,
          `Atributo3: ${attr3}`,
          `msExchHideFromAddressLists: ${result?.ad?.hideFromAddressLists === null || result?.ad?.hideFromAddressLists === undefined ? "<sem valor>" : String(result.ad.hideFromAddressLists)}`,
          `Bloqueio Sync: ${result?.ad?.syncBlocked ? "Sim" : "Não"}`,
          `Azure: ${result?.azure?.checked ? (result?.azure?.exists ? "Sim" : "Não") : "Não validado"}`,
          `E3: ${result?.e3?.checked ? (result?.e3?.hasLicense ? "Sim" : "Não") : "Não validado"}`,
          `EXO: ${result?.exo?.checked ? (result?.exo?.exists ? "Sim" : "Não") : "Não validado"}`,
          `Arquivo: ${result?.exo?.archiveEnabled ? "Sim" : "Não"}`,
          `Limite de destinatários: ${vuText(result?.exo?.recipientLimits)}`,
          `Diagnóstico: ${vuText(result?.diagnostic)}`
        ].join(" | ");
      })
    ].join("\n");

    try {
      await vuCopyToClipboard(text);
      vuSetStatus("ok", "Resumo copiado.", `${window.vuUltimosResultados.length} resultado(s) copiado(s).`);
    } catch (error) {
      vuSetStatus("err", "Não foi possível copiar o resumo.", error.message || "Erro do navegador.");
    }
  }

  function vuLimpar() {
    if (vuBusy) {
      vuSetStatus("warn", "Operação em curso.", "Aguarde a conclusão para limpar os resultados.");
      return;
    }

    vuRunToken++;
    window.vuUltimosResultados = [];
    window.vuUltimasNotas = [];
    window.vuPreventiveRows = [];
    window.vuFonteConsulta = "Consulta direta";
    window.vuKpiFilter = "all";
    window.vuResultadosVisiveis = [];
    vuTicketQueue = null;
    vuFecharFilaTickets();

    const idsToClear = ["vuSingleUser", "vuUserList", "vuFilter"];

    idsToClear.forEach(id => {
      const element = vuEl(id);
      if (element) element.value = "";
    });

    vuSetPeriodo("today");

    const onlyActive = vuEl("vuOnlyActive");
    const requireUpn = vuEl("vuRequireUpn");

    if (onlyActive) onlyActive.checked = true;
    if (requireUpn) requireUpn.checked = true;

    vuSetStatus(
      "idle",
      "Aguardando consulta.",
      "Consulte diretamente ou pesquise utilizadores criados num período."
    );

    const progress = vuEl("vuProgressWrap");
    if (progress) progress.style.display = "none";

    vuOperationHide();
    vuRenderResultados();
  }

  function vuInitialize() {
    vuSetPeriodo("today");
    vuRenderResultados();
    vuEl("vuTicketQueueOverlay")?.addEventListener("click", event => {
      if (event.target === vuEl("vuTicketQueueOverlay")) vuFecharFilaTickets();
    });
  }
  window.vuCleanupOperationPanel = vuCleanupOperationPanel;
  window.vuVerificar = vuVerificar;
  window.vuPesquisarCriados = vuPesquisarCriados;
  window.vuSetPeriodo = vuSetPeriodo;
  window.vuExecutarAcaoResultado = vuExecutarAcaoResultado;
  window.vuAlterarRecipientLimit = vuAlterarRecipientLimit;
  window.vuAbrirServiceNow = vuAbrirServiceNow;
  window.vuAplicarFiltroKpi = vuAplicarFiltroKpi;
  window.vuLimparFiltroKpi = vuLimparFiltroKpi;
  window.vuRenderResultados = vuRenderResultados;
  window.vuExportCsv = vuExportCsv;
  window.vuExportarResultadoPng = vuExportarResultadoPng;
  window.vuCopiarResumo = vuCopiarResumo;
  window.vuLimpar = vuLimpar;
  window.vuCancelar = vuCancelar;
  window.vuIniciarFilaTickets = vuIniciarFilaTickets;
  window.vuAbrirTicketAtual = vuAbrirTicketAtual;
  window.vuAvancarFilaTickets = vuAvancarFilaTickets;
  window.vuFecharFilaTickets = vuFecharFilaTickets;

  vuInitialize();
})();
