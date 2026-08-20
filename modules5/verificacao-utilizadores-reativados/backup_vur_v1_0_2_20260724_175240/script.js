(() => {
  "use strict";

  const MODULE_ID = "verificacao-utilizadores-reativados";
  const API_URL = `/module/${MODULE_ID}/api`;
  let lastResult = null;

  const $ = (id) => document.getElementById(id);
  const value = (v) => v === null || v === undefined || v === "" ? "—" : String(v);
  const jsonText = (obj) => JSON.stringify(obj || {}, null, 2);

  function setProgress(percent, text, visible = true) {
    $("vurProgressWrap").hidden = !visible;
    $("vurProgressBar").style.width = `${Math.max(0, Math.min(100, percent))}%`;
    $("vurProgressText").textContent = text || "";
  }

  async function callApi(action, payload = {}) {
    const response = await fetch(`${API_URL}?action=${encodeURIComponent(action)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload)
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; }
    catch { throw new Error(`Resposta inválida da API: ${raw.substring(0, 400)}`); }
    if (!response.ok || data.success === false) throw new Error(data.message || `Erro HTTP ${response.status}`);
    return data;
  }

  function setConnection(key, state, title) {
    const el = document.querySelector(`.vur-connection[data-key="${key}"]`);
    if (!el) return;
    el.classList.remove("ok", "warn", "error");
    el.classList.add(state === true ? "ok" : state === false ? "error" : "warn");
    if (title) el.title = title;
  }

  async function loadStatus() {
    setProgress(15, "A verificar ligações...");
    try {
      const data = await callApi("status");
      const s = data.connections || {};
      setConnection("ad", s.ad?.connected, s.ad?.message);
      setConnection("exchangeOnPrem", s.exchangeOnPrem?.connected, s.exchangeOnPrem?.message);
      setConnection("graph", s.graph?.connected, s.graph?.message);
      setConnection("exchangeOnline", s.exchangeOnline?.connected, s.exchangeOnline?.message);
      setProgress(100, "Ligações verificadas.");
      setTimeout(() => setProgress(0, "", false), 900);
    } catch (e) {
      setProgress(100, e.message);
    }
  }

  function statusText(obj, foundLabel = "Encontrado") {
    if (!obj) return "Não consultado";
    if (obj.error) return "Erro";
    return obj.found ? foundLabel : "Não encontrado";
  }

  function renderSummary(r) {
    $("vurSummary").hidden = false;
    $("vurOverallStatus").textContent = value(r.diagnosis?.status);
    $("vurAdStatus").textContent = statusText(r.ad);
    $("vurOnPremStatus").textContent = statusText(r.exchangeOnPrem);
    $("vurEntraStatus").textContent = statusText(r.entra);
    $("vurExoStatus").textContent = statusText(r.exchangeOnline);
    $("vurGuidStatus").textContent = value(r.diagnosis?.guidStatus);
  }

  function renderFindings(findings) {
    const host = $("vurFindings");
    host.innerHTML = "";
    (findings || []).forEach(f => {
      const item = document.createElement("div");
      item.className = `vur-alert ${f.severity || "info"}`;
      item.innerHTML = `<strong>${escapeHtml(f.title || "Informação")}</strong><div>${escapeHtml(f.message || "")}</div>`;
      host.appendChild(item);
    });
    if (!findings || findings.length === 0) {
      host.innerHTML = '<div class="vur-alert success"><strong>Nenhuma inconsistência crítica identificada</strong><div>Os principais atributos consultados estão coerentes.</div></div>';
    }
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = value(text);
    return div.innerHTML;
  }

  function renderComparison(rows) {
    const body = $("vurComparisonBody");
    body.innerHTML = "";
    (rows || []).forEach(row => {
      const tr = document.createElement("tr");
      const cls = row.status === "OK" ? "ok" : row.status === "ERRO" ? "error" : "warn";
      tr.innerHTML = `
        <td><strong>${escapeHtml(row.attribute)}</strong></td>
        <td>${escapeHtml(value(row.ad))}</td>
        <td>${escapeHtml(value(row.exchangeOnPrem))}</td>
        <td>${escapeHtml(value(row.entra))}</td>
        <td>${escapeHtml(value(row.exchangeOnline))}</td>
        <td><span class="vur-pill ${cls}">${escapeHtml(row.status || "AVISO")}</span></td>`;
      body.appendChild(tr);
    });
  }

  function renderDetails(r) {
    $("vurDetailsPanel").hidden = false;
    $("vurAdDetails").textContent = jsonText(r.ad);
    $("vurOnPremDetails").textContent = jsonText(r.exchangeOnPrem);
    $("vurEntraDetails").textContent = jsonText(r.entra);
    $("vurExoDetails").textContent = jsonText(r.exchangeOnline);
  }

  function renderCommands(r) {
    const text = (r.diagnosis?.recommendedCommands || []).join("\r\n\r\n");
    $("vurCommandsPanel").hidden = !text;
    $("vurCommands").textContent = text || "Nenhum comando recomendado.";
  }

  function renderResult(r) {
    lastResult = r;
    $("vurDiagnosisPanel").hidden = false;
    $("vurDiagnosisHeadline").textContent = value(r.diagnosis?.summary);
    renderSummary(r);
    renderFindings(r.diagnosis?.findings);
    renderComparison(r.comparison);
    renderDetails(r);
    renderCommands(r);
  }

  async function verifyUser() {
    const identity = $("vurIdentity").value.trim();
    if (!identity) {
      $("vurIdentity").focus();
      return;
    }
    setProgress(8, "A iniciar diagnóstico...");
    $("vurSearchBtn").disabled = true;
    try {
      setProgress(25, "A consultar Active Directory e Exchange on-premises...");
      const data = await callApi("diagnose", { identity });
      setProgress(90, "A preparar comparação e recomendações...");
      renderResult(data);
      setProgress(100, "Diagnóstico concluído.");
      setTimeout(() => setProgress(0, "", false), 1200);
    } catch (e) {
      setProgress(100, `Erro: ${e.message}`);
    } finally {
      $("vurSearchBtn").disabled = false;
    }
  }

  function clearAll() {
    lastResult = null;
    $("vurIdentity").value = "";
    ["vurSummary","vurDiagnosisPanel","vurDetailsPanel","vurCommandsPanel"].forEach(id => $(id).hidden = true);
    setProgress(0, "", false);
    $("vurIdentity").focus();
  }

  function buildDiagnosisText() {
    if (!lastResult) return "";
    const d = lastResult.diagnosis || {};
    const lines = [
      "VERIFICAÇÃO DE UTILIZADOR REATIVADO",
      "===================================",
      `Utilizador: ${value(lastResult.identity)}`,
      `Data: ${value(lastResult.generatedAt)}`,
      `Resultado: ${value(d.status)}`,
      `ExchangeGuid: ${value(d.guidStatus)}`,
      "",
      "RESUMO",
      value(d.summary),
      "",
      "CONSTATAÇÕES"
    ];
    (d.findings || []).forEach((f, i) => lines.push(`${i + 1}. [${(f.severity || "info").toUpperCase()}] ${f.title}: ${f.message}`));
    return lines.join("\r\n");
  }

  async function copyText(text) {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("vurSearchBtn")?.addEventListener("click", verifyUser);
    $("vurStatusBtn")?.addEventListener("click", loadStatus);
    $("vurClearBtn")?.addEventListener("click", clearAll);
    $("vurCopyDiagnosisBtn")?.addEventListener("click", () => copyText(buildDiagnosisText()));
    $("vurCopyCommandsBtn")?.addEventListener("click", () => copyText((lastResult?.diagnosis?.recommendedCommands || []).join("\r\n\r\n")));
    $("vurIdentity")?.addEventListener("keydown", e => { if (e.key === "Enter") verifyUser(); });
    loadStatus();
  });
})();
