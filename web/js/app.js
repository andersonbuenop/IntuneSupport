"use strict";

/* ============================================================
   SANTANDER SUPPORT WEB - APP.JS DASHBOARD OPERACIONAL V3
============================================================ */

let todosModulos = [];
let SantanderDebugMode = localStorage.getItem("SantanderDebugMode") === "true";
let SantanderDebugLogs = [];

const SantanderApp = {
    currentView: "dashboard",
    dashboardPeriod: "7days",
    moduleLoadError: "",
    systemInfo: null,
    ranking: null,
    todayUsage: null,
    activity: [],
    connections: {
        graph: { connected: false },
        exchange: { connected: false }
    }
};

const FAVORITES_KEY = "SantanderDashboardFavoritesV3";
const RECENTS_KEY = "SantanderDashboardRecentV3";
const PENDING_MODULE_KEY = "__SantanderModuloPendente";
const GLOBAL_MAA_SNOOZE_KEY = "SantanderGlobalMaaSnoozeV1";
const GLOBAL_MAA_NOTIFIED_KEY = "SantanderGlobalMaaNotifiedV1";
const GLOBAL_MAA_USERS = [
    "au_86246723@santandernet.onmicrosoft.com",
    "au_81680372@santandernet.onmicrosoft.com"
];
let SantanderGlobalMaaChecking = false;
let SantanderGlobalMaaAbortController = null;
let SantanderGlobalMaaRequests = [];
let SantanderGlobalMaaTimer = null;
let SantanderManualMaaTimer = null;
let SantanderManualMaaChecking = false;
let SantanderGlobalMaaContacts = [];
let SantanderConnectionTimer = null;
const SANTANDER_MAA_TIMEOUT_MS = 25000;

function byId(id) {
    return document.getElementById(id);
}

function escapeHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizarTexto(value) {
    return String(value == null ? "" : value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

function obterChaveModulo(modulo) {
    if (!modulo) return "";
    return String(modulo.id || modulo.module || modulo.name || "").trim();
}

function obterTituloModulo(modulo) {
    if (!modulo) return "Módulo";
    return String(modulo.title || modulo.name || obterChaveModulo(modulo) || "Módulo");
}

function obterDescricaoModulo(modulo) {
    return String((modulo && modulo.description) || "Ferramenta operacional do Santander Support Web.");
}

function obterCategoriaModulo(modulo) {
    return String((modulo && modulo.category) || "Ferramentas");
}

function obterIconeModulo(modulo) {
    const title = obterTituloModulo(modulo).trim();
    return title ? title.charAt(0).toUpperCase() : "S";
}

function formatarNumero(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat("pt-PT").format(Number.isFinite(number) ? number : 0);
}

function formatarDataHora(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat("pt-PT", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function formatarHora(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return new Intl.DateTimeFormat("pt-PT", {
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function definirAtualizacao(value) {
    const target = byId("lastUpdate");
    if (!target) return;

    const date = value ? new Date(value) : new Date();
    target.textContent = Number.isNaN(date.getTime())
        ? "Atualização indisponível"
        : `Atualizado às ${formatarHora(date)}`;
}

async function fetchJson(url, options) {
    const response = await fetch(url, Object.assign({ cache: "no-store" }, options || {}));
    const text = await response.text();
    let data = null;

    if (text) {
        try {
            data = JSON.parse(text);
        } catch (error) {
            throw new Error(`Resposta inválida de ${url}: ${text.slice(0, 180)}`);
        }
    }

    if (!response.ok) {
        const message = data && (data.error || data.message)
            ? data.error || data.message
            : `HTTP ${response.status}`;
        throw new Error(message);
    }

    return data || {};
}

function mostrarToast(message, type) {
    const region = byId("toastRegion");
    if (!region) return;

    const toast = document.createElement("div");
    toast.className = `toast ${type || ""}`.trim();
    toast.textContent = String(message || "");
    region.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4200);
}

function setPageHeader(title, subtitle) {
    const pageTitle = byId("pageTitle");
    const pageSubtitle = byId("pageSubtitle");

    if (pageTitle) pageTitle.textContent = title || "Santander Support Web";
    if (pageSubtitle) pageSubtitle.textContent = subtitle || "";
}

function setActiveNav(view) {
    SantanderApp.currentView = view;

    document.querySelectorAll(".sidebar-nav .menu-main").forEach(button => {
        button.classList.toggle("active", button.dataset.view === view);
    });

    fecharMenuMobile();
}

function abrirMenuMobile() {
    const sidebar = byId("sidebar");
    const button = byId("mobileMenuButton");
    if (!sidebar || !button) return;

    sidebar.classList.toggle("open");
    button.setAttribute("aria-expanded", sidebar.classList.contains("open") ? "true" : "false");
}

function fecharMenuMobile() {
    const sidebar = byId("sidebar");
    const button = byId("mobileMenuButton");
    if (!sidebar || !button) return;

    sidebar.classList.remove("open");
    button.setAttribute("aria-expanded", "false");
}

function mostrarAmbiente(environment) {
    const badge = byId("environmentBadge");
    if (!badge) return;

    const normalized = normalizarTexto(environment || "production");
    const production = normalized === "production" || normalized === "producao" || normalized === "prod";

    badge.innerHTML = production
        ? '<span class="badge badge-production">PRODUÇÃO</span>'
        : `<span class="badge">${escapeHtml(String(environment || "AMBIENTE" ).toUpperCase())}</span>`;
}

function renderPageLoading(message) {
    const content = byId("content");
    if (!content) return;

    content.innerHTML = `
        <div class="page-loading">
            <div class="loading-spinner" aria-hidden="true"></div>
            <strong>${escapeHtml(message || "A carregar...")}</strong>
        </div>
    `;
}

function renderPageError(title, message, retryAction) {
    const content = byId("content");
    if (!content) return;

    content.innerHTML = `
        <div class="error-state">
            <strong>${escapeHtml(title || "Não foi possível concluir a operação")}</strong>
            <span>${escapeHtml(message || "Erro desconhecido.")}</span>
            ${retryAction ? `<button class="btn-primary" type="button" id="pageRetryButton">Tentar novamente</button>` : ""}
        </div>
    `;

    if (retryAction) {
        const button = byId("pageRetryButton");
        if (button) button.addEventListener("click", retryAction, { once: true });
    }
}

async function carregarModulos(force) {
    if (!force && Array.isArray(todosModulos) && todosModulos.length > 0) {
        return todosModulos;
    }

    SantanderApp.moduleLoadError = "";

    try {
        const data = await fetchJson("/api/modules");
        if (!data.success) {
            throw new Error(data.error || "A API não confirmou o carregamento dos módulos.");
        }

        todosModulos = Array.isArray(data.modules)
            ? data.modules
            : data.modules
                ? [data.modules]
                : [];

        return todosModulos;
    } catch (error) {
        todosModulos = [];
        SantanderApp.moduleLoadError = error.message;
        addDebugLog("MODULES ERROR", "Falha ao carregar /api/modules", error.message);
        throw error;
    }
}

async function carregarInformacaoSistema() {
    try {
        const data = await fetchJson("/api/system/info");
        SantanderApp.systemInfo = data;
        mostrarAmbiente(data.environment);
        return data;
    } catch (error) {
        addDebugLog("SYSTEM INFO ERROR", "Falha ao carregar /api/system/info", error.message);

        const fallback = {
            success: false,
            appName: "Santander Support Web V2",
            environment: "production",
            version: "2.0.0-PROD",
            build: "—",
            releaseName: "Base Modular V2",
            serverTime: new Date().toISOString(),
            moduleCount: Array.isArray(todosModulos) ? todosModulos.length : 0
        };

        SantanderApp.systemInfo = fallback;
        mostrarAmbiente(fallback.environment);
        return fallback;
    }
}

async function carregarUso(period) {
    const normalized = period || "7days";
    const data = await fetchJson(`/api/dashboard/usage?period=${encodeURIComponent(normalized)}`);
    return data;
}

async function carregarAtividade() {
    try {
        const data = await fetchJson("/api/dashboard/activity?limit=8");
        SantanderApp.activity = Array.isArray(data.items) ? data.items : [];
        return SantanderApp.activity;
    } catch (error) {
        addDebugLog("ACTIVITY ERROR", "Falha ao carregar atividade do dashboard", error.message);
        SantanderApp.activity = [];
        return [];
    }
}

async function consultarStatusConexoes() {
    const results = await Promise.allSettled([
        fetchJson("/api/graph/status"),
        fetchJson("/api/exchange/status")
    ]);

    SantanderApp.connections.graph = results[0].status === "fulfilled"
        ? results[0].value
        : { connected: false, error: results[0].reason.message };

    SantanderApp.connections.exchange = results[1].status === "fulfilled"
        ? results[1].value
        : { connected: false, error: results[1].reason.message };

    return SantanderApp.connections;
}

function lerListaLocalStorage(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function guardarListaLocalStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`Não foi possível guardar ${key}:`, error);
    }
}

function obterFavoritos() {
    return lerListaLocalStorage(FAVORITES_KEY).map(String);
}

function moduloFavorito(moduleId) {
    return obterFavoritos().includes(String(moduleId));
}

function alternarFavorito(moduleId) {
    const key = String(moduleId || "");
    if (!key) return false;

    let favorites = obterFavoritos();
    const exists = favorites.includes(key);

    favorites = exists
        ? favorites.filter(item => item !== key)
        : [key].concat(favorites).slice(0, 20);

    guardarListaLocalStorage(FAVORITES_KEY, favorites);
    mostrarToast(exists ? "Módulo removido dos favoritos." : "Módulo adicionado aos favoritos.", "success");
    return !exists;
}

function registarRecenteLocal(moduleId) {
    const key = String(moduleId || "");
    if (!key) return;

    const recents = lerListaLocalStorage(RECENTS_KEY)
        .filter(item => item && String(item.moduleId) !== key);

    recents.unshift({
        moduleId: key,
        timestamp: new Date().toISOString()
    });

    guardarListaLocalStorage(RECENTS_KEY, recents.slice(0, 12));
}

function obterRecentesLocais() {
    const recents = lerListaLocalStorage(RECENTS_KEY);
    return recents
        .map(item => {
            const modulo = todosModulos.find(moduleItem => obterChaveModulo(moduleItem) === String(item.moduleId));
            return modulo ? { modulo, timestamp: item.timestamp } : null;
        })
        .filter(Boolean);
}

function localizarModulo(moduleId) {
    const key = String(moduleId || "");
    return todosModulos.find(modulo => obterChaveModulo(modulo) === key) || null;
}

function renderQuickModule(modulo) {
    const id = obterChaveModulo(modulo);
    const favorite = moduloFavorito(id);

    return `
        <article class="quick-module" data-module-id="${escapeHtml(id)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(obterTituloModulo(modulo))}">
            <div class="quick-module-icon" aria-hidden="true">${escapeHtml(obterIconeModulo(modulo))}</div>
            <div class="quick-module-content">
                <strong>${escapeHtml(obterTituloModulo(modulo))}</strong>
                <small>${escapeHtml(obterCategoriaModulo(modulo))}</small>
            </div>
            <button class="favorite-button ${favorite ? "active" : ""}" type="button" data-favorite-module="${escapeHtml(id)}" aria-label="${favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}">
                ${favorite ? "★" : "☆"}
            </button>
        </article>
    `;
}

function renderModuleCard(modulo) {
    const id = obterChaveModulo(modulo);
    const favorite = moduloFavorito(id);

    return `
        <article class="module-card" data-module-id="${escapeHtml(id)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(obterTituloModulo(modulo))}">
            <div class="module-card-top">
                <div class="module-icon" aria-hidden="true">${escapeHtml(obterIconeModulo(modulo))}</div>
                <button class="favorite-button ${favorite ? "active" : ""}" type="button" data-favorite-module="${escapeHtml(id)}" aria-label="${favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}">
                    ${favorite ? "★" : "☆"}
                </button>
            </div>
            <h3>${escapeHtml(obterTituloModulo(modulo))}</h3>
            <p>${escapeHtml(obterDescricaoModulo(modulo))}</p>
            <div class="module-footer">
                <span class="module-tag">${escapeHtml(obterCategoriaModulo(modulo))}</span>
                <span class="module-open">Abrir →</span>
            </div>
        </article>
    `;
}

function bindModuleCards(container) {
    if (!container) return;

    container.querySelectorAll("[data-module-id]").forEach(card => {
        const open = event => {
            if (event.target && event.target.closest("[data-favorite-module]")) return;
            const modulo = localizarModulo(card.dataset.moduleId);
            if (!modulo) return;
            abrirModulo(
                obterChaveModulo(modulo),
                obterTituloModulo(modulo),
                obterDescricaoModulo(modulo)
            ).catch(error => {
                console.error(error);
            });
        };

        card.addEventListener("click", open);
        card.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                open(event);
            }
        });
    });

    container.querySelectorAll("[data-favorite-module]").forEach(button => {
        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();

            const active = alternarFavorito(button.dataset.favoriteModule);
            button.classList.toggle("active", active);
            button.textContent = active ? "★" : "☆";
            button.setAttribute("aria-label", active ? "Remover dos favoritos" : "Adicionar aos favoritos");

            if (SantanderApp.currentView === "dashboard") {
                renderDashboardModules();
            }
        });
    });
}

function renderMetric(icon, label, value, note, variant) {
    return `
        <div class="metric-card ${variant || ""}">
            <div class="metric-icon" aria-hidden="true">${escapeHtml(icon)}</div>
            <div>
                <span class="metric-label">${escapeHtml(label)}</span>
                <strong class="metric-value">${escapeHtml(value)}</strong>
                <small class="metric-note">${escapeHtml(note)}</small>
            </div>
        </div>
    `;
}

function renderRanking(rankingData) {
    const ranking = rankingData && Array.isArray(rankingData.ranking)
        ? rankingData.ranking.slice(0, 6)
        : [];

    if (ranking.length === 0) {
        return `
            <div class="empty-state">
                <strong>Ainda não existem utilizações registadas.</strong>
                <span>O ranking será preenchido automaticamente ao abrir os módulos.</span>
            </div>
        `;
    }

    const maximum = Math.max.apply(null, ranking.map(item => Number(item.count || 0)).concat([1]));

    return `
        <div class="ranking-list">
            ${ranking.map((item, index) => {
                const width = Math.max(7, Math.round((Number(item.count || 0) / maximum) * 100));
                return `
                    <div class="ranking-item">
                        <div class="rank-number">${index + 1}</div>
                        <div class="rank-main">
                            <strong title="${escapeHtml(item.moduleTitle || item.moduleId || "Módulo")}">${escapeHtml(item.moduleTitle || item.moduleId || "Módulo")}</strong>
                            <div class="rank-bar-track"><div class="rank-bar" style="width:${width}%"></div></div>
                        </div>
                        <div class="rank-count">${formatarNumero(item.count)}</div>
                    </div>
                `;
            }).join("")}
        </div>
    `;
}

function renderConnections(connections) {
    const graph = connections.graph || { connected: false };
    const exchange = connections.exchange || { connected: false };

    return `
        <div class="connection-grid-compact">
            <div class="connection-compact ${graph.connected ? "connected" : "disconnected"}">
                <span class="connection-status-dot" aria-hidden="true"></span>
                <div>
                    <strong>Microsoft Graph</strong>
                    <small title="${escapeHtml(graph.account || graph.error || "")}">${escapeHtml(graph.connected ? (graph.account || "Conectado") : "Desconectado")}</small>
                    ${renderConnectionLifetime(graph)}
                </div>
            </div>

            <div class="connection-compact ${exchange.connected ? "connected" : "disconnected"}">
                <span class="connection-status-dot" aria-hidden="true"></span>
                <div>
                    <strong>Exchange Online</strong>
                    <small title="${escapeHtml(exchange.user || exchange.error || "")}">${escapeHtml(exchange.connected ? (exchange.user || "Conectado") : "Desconectado")}</small>
                    ${renderConnectionLifetime(exchange)}
                </div>
            </div>
        </div>
        <div class="connection-actions-compact">
            <button class="btn-subtle connection-connect-all" type="button" id="connectAllDashboard">Conectar serviços</button>
        </div>
        <div class="connection-workflow" id="connectionWorkflow" hidden></div>
    `;
}

function renderConnectionLifetime(connection) {
    if (!connection || !connection.connected) return "";
    if (!connection.expiresAt) return '<span class="connection-lifetime">Sessão ativa · expiração não disponibilizada</span>';
    return `<span class="connection-lifetime" data-session-expires="${escapeHtml(connection.expiresAt)}" data-session-estimated="${connection.expiryEstimated ? "true" : "false"}"></span>`;
}

function formatarTempoRestante(milliseconds) {
    if (milliseconds <= 0) return "reconexão necessária";
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function atualizarTimersConexao() {
    document.querySelectorAll("[data-session-expires]").forEach(element => {
        const expiresAt = new Date(element.dataset.sessionExpires).getTime();
        if (!Number.isFinite(expiresAt)) return;
        const estimated = element.dataset.sessionEstimated === "true";
        element.textContent = `${estimated ? "Renovação prevista" : "Sessão válida"}: ${formatarTempoRestante(expiresAt - Date.now())}`;
        element.classList.toggle("expired", expiresAt <= Date.now());
    });
}

function iniciarTimersConexao() {
    if (SantanderConnectionTimer) clearInterval(SantanderConnectionTimer);
    atualizarTimersConexao();
    SantanderConnectionTimer = setInterval(atualizarTimersConexao, 1000);
}

function renderConnectionWorkflow(steps) {
    const target = byId("connectionWorkflow");
    if (!target) return;
    target.hidden = false;
    target.innerHTML = steps.map((step, index) => `
        <div class="connection-workflow-step ${step.status}">
            <span>${step.status === "success" ? "✓" : step.status === "error" ? "!" : index + 1}</span>
            <div><strong>${escapeHtml(step.title)}</strong><small>${escapeHtml(step.detail)}</small></div>
        </div>
    `).join("");
}

async function conectarServicosDashboard() {
    const button = byId("connectAllDashboard");
    const steps = [
        { title: "Verificar sessões", detail: "A consultar o estado atual...", status: "active" },
        { title: "Microsoft Graph", detail: "Aguardando", status: "pending" },
        { title: "Exchange Online", detail: "Aguardando", status: "pending" }
    ];
    if (button) { button.disabled = true; button.textContent = "A conectar..."; }
    renderConnectionWorkflow(steps);
    try {
        await consultarStatusConexoes();
        steps[0] = { title: "Verificar sessões", detail: "Estado consultado", status: "success" };
        steps[1] = { title: "Microsoft Graph", detail: SantanderApp.connections.graph.connected ? "Sessão já estava ativa" : "A abrir autenticação...", status: SantanderApp.connections.graph.connected ? "success" : "active" };
        renderConnectionWorkflow(steps);
        if (!SantanderApp.connections.graph.connected) {
            const graph = await fetchJson("/api/graph/connect", { method: "POST" });
            if (!graph.success) throw new Error(graph.error || "Falha ao conectar Microsoft Graph.");
            SantanderApp.connections.graph = graph;
            steps[1] = { title: "Microsoft Graph", detail: "Conectado com sucesso", status: "success" };
        }
        steps[2] = { title: "Exchange Online", detail: SantanderApp.connections.exchange.connected ? "Sessão já estava ativa" : "A abrir autenticação...", status: SantanderApp.connections.exchange.connected ? "success" : "active" };
        renderConnectionWorkflow(steps);
        if (!SantanderApp.connections.exchange.connected) {
            const exchange = await fetchJson("/api/exchange/connect", { method: "POST" });
            if (!exchange.success) throw new Error(exchange.error || "Falha ao conectar Exchange Online.");
            SantanderApp.connections.exchange = exchange;
            steps[2] = { title: "Exchange Online", detail: "Conectado com sucesso", status: "success" };
        }
        renderConnectionWorkflow(steps);
        mostrarToast("Graph e Exchange Online conectados com sucesso.", "success");
        setTimeout(atualizarConexoesDashboard, 900);
    } catch (error) {
        const activeIndex = steps.findIndex(step => step.status === "active");
        if (activeIndex >= 0) steps[activeIndex] = { ...steps[activeIndex], detail: error.message, status: "error" };
        renderConnectionWorkflow(steps);
        mostrarToast(`Erro na conexão: ${error.message}`, "error");
    } finally {
        if (button) { button.disabled = false; button.textContent = "Conectar serviços"; }
    }
}

function renderActivity(activity) {
    if (!Array.isArray(activity) || activity.length === 0) {
        const local = obterRecentesLocais();
        if (local.length === 0) {
            return `
                <div class="empty-state">
                    <strong>Sem atividade recente.</strong>
                    <span>Os módulos abertos aparecerão aqui.</span>
                </div>
            `;
        }

        return `
            <div class="activity-list">
                ${local.slice(0, 6).map(item => `
                    <div class="activity-item">
                        <div class="activity-icon">${escapeHtml(obterIconeModulo(item.modulo))}</div>
                        <div class="activity-main">
                            <strong>${escapeHtml(obterTituloModulo(item.modulo))}</strong>
                            <small>${escapeHtml(obterCategoriaModulo(item.modulo))}</small>
                        </div>
                        <span class="activity-time">${escapeHtml(formatarHora(item.timestamp))}</span>
                    </div>
                `).join("")}
            </div>
        `;
    }

    return `
        <div class="activity-list">
            ${activity.slice(0, 7).map(item => `
                <div class="activity-item">
                    <div class="activity-icon">${escapeHtml(String(item.moduleTitle || item.moduleId || "S").charAt(0).toUpperCase())}</div>
                    <div class="activity-main">
                        <strong>${escapeHtml(item.moduleTitle || item.moduleId || "Módulo")}</strong>
                        <small>${escapeHtml(item.category || "Ferramentas")}</small>
                    </div>
                    <span class="activity-time" title="${escapeHtml(formatarDataHora(item.timestamp))}">${escapeHtml(formatarHora(item.timestamp))}</span>
                </div>
            `).join("")}
        </div>
    `;
}

function selecionarModulosRapidos(searchText) {
    const query = normalizarTexto(searchText || "");
    let selected = [];

    if (query) {
        selected = todosModulos.filter(modulo => {
            const haystack = normalizarTexto([
                obterTituloModulo(modulo),
                obterDescricaoModulo(modulo),
                obterCategoriaModulo(modulo)
            ].join(" "));
            return haystack.includes(query);
        });
    } else {
        const favoriteIds = obterFavoritos();
        selected = favoriteIds
            .map(id => localizarModulo(id))
            .filter(Boolean);

        if (selected.length === 0 && SantanderApp.ranking && Array.isArray(SantanderApp.ranking.ranking)) {
            selected = SantanderApp.ranking.ranking
                .map(item => localizarModulo(item.moduleId))
                .filter(Boolean);
        }

        if (selected.length === 0) {
            selected = todosModulos.slice(0, 6);
        }
    }

    return selected.slice(0, query ? 12 : 6);
}

function renderDashboardModules(searchText) {
    const container = byId("dashboardQuickModules");
    if (!container) return;

    const modules = selecionarModulosRapidos(searchText);

    container.innerHTML = modules.length
        ? modules.map(renderQuickModule).join("")
        : `
            <div class="empty-state" style="grid-column:1/-1">
                <strong>Nenhum módulo encontrado.</strong>
                <span>Tente pesquisar por outro nome ou categoria.</span>
            </div>
        `;

    bindModuleCards(container);
}

function renderDashboard() {
    const content = byId("content");
    if (!content) return;

    const system = SantanderApp.systemInfo || {};
    const today = SantanderApp.todayUsage || { totalAccesses: 0 };
    const ranking = SantanderApp.ranking || { totalAccesses: 0, uniqueModules: 0, ranking: [] };
    const connectedCount = [
        SantanderApp.connections.graph,
        SantanderApp.connections.exchange
    ].filter(item => item && item.connected).length;

    content.innerHTML = `
        <div class="dashboard-shell">
            <section class="dashboard-intro">
                <div>
                    <span class="dashboard-kicker">Plataforma operacional</span>
                    <h2>${escapeHtml(system.appName || "Santander Support Web V2")}</h2>
                    <p>
                        Acesso centralizado às ferramentas de suporte, ligações Microsoft 365,
                        relatórios e atividade operacional do ambiente de Produção.
                    </p>
                    <button class="dashboard-refresh" type="button" id="refreshDashboard">↻ Atualizar dashboard</button>
                </div>
                <img class="dashboard-logo-real" src="/assets/santander-logo.png" alt="Santander" onerror="this.style.display='none'">
            </section>

            <section class="metric-grid" aria-label="Indicadores do dashboard">
                ${renderMetric("◇", "Módulos ativos", formatarNumero(todosModulos.length), "Ferramentas disponíveis", "")}
                ${renderMetric("↗", "Acessos hoje", formatarNumero(today.totalAccesses), "Aberturas concluídas", "success")}
                ${renderMetric("▤", "Módulos utilizados", formatarNumero(ranking.uniqueModules), "No período selecionado", "info")}
                ${renderMetric("●", "Serviços conectados", `${connectedCount}/2`, "Graph e Exchange", connectedCount === 2 ? "success" : "warning")}
            </section>

            <section class="dashboard-main-grid">
                <div class="dashboard-column">
                    <article class="panel">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h3>Acesso rápido</h3>
                                <p>Favoritos, módulos mais utilizados e pesquisa global.</p>
                            </div>
                            <button class="btn-subtle" type="button" id="openAllTools">Ver todas</button>
                        </div>

                        <div class="dashboard-search-row">
                            <div class="search-field">
                                <input id="dashboardModuleSearch" type="search" placeholder="Pesquisar ferramenta, relatório ou categoria..." autocomplete="off">
                            </div>
                            <button class="btn-subtle" type="button" id="clearDashboardSearch">Limpar</button>
                        </div>

                        <div id="dashboardQuickModules" class="quick-module-grid"></div>
                    </article>

                    <article class="panel">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h3>Estado das conexões</h3>
                                <p>Estado real das sessões globais utilizadas pelos módulos.</p>
                            </div>
                            <button class="btn-subtle" type="button" id="refreshConnectionsDashboard">Atualizar</button>
                        </div>
                        <div id="dashboardConnections">${renderConnections(SantanderApp.connections)}</div>
                    </article>
                </div>

                <div class="dashboard-column secondary">
                    <article class="panel">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h3>Ranking de utilização</h3>
                                <p>Módulos abertos com sucesso.</p>
                            </div>
                            <div class="period-tabs" role="group" aria-label="Período do ranking">
                                ${[
                                    ["today", "Hoje"],
                                    ["7days", "7 dias"],
                                    ["30days", "30 dias"],
                                    ["all", "Total"]
                                ].map(item => `
                                    <button class="period-tab ${SantanderApp.dashboardPeriod === item[0] ? "active" : ""}" type="button" data-ranking-period="${item[0]}">${item[1]}</button>
                                `).join("")}
                            </div>
                        </div>
                        <div id="dashboardRanking">${renderRanking(ranking)}</div>
                    </article>

                    <article class="panel">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h3>Atividade recente</h3>
                                <p>Últimas ferramentas abertas no sistema.</p>
                            </div>
                        </div>
                        ${renderActivity(SantanderApp.activity)}
                    </article>

                    <article class="panel">
                        <div class="panel-header">
                            <div class="panel-title">
                                <h3>Informação do sistema</h3>
                                <p>Dados obtidos diretamente do config.json.</p>
                            </div>
                        </div>
                        <div class="system-summary">
                            <div class="system-summary-item">
                                <span>Versão</span>
                                <strong title="${escapeHtml(system.version || "—")}">${escapeHtml(system.version || "—")}</strong>
                            </div>
                            <div class="system-summary-item">
                                <span>Build</span>
                                <strong title="${escapeHtml(system.build || "—")}">${escapeHtml(system.build || "—")}</strong>
                            </div>
                            <div class="system-summary-item">
                                <span>Release</span>
                                <strong title="${escapeHtml(system.releaseName || "—")}">${escapeHtml(system.releaseName || "—")}</strong>
                            </div>
                        </div>
                    </article>
                </div>
            </section>
        </div>
    `;

    renderDashboardModules();
    bindDashboardEvents();
    definirAtualizacao(system.serverTime || new Date());
}

function bindDashboardEvents() {
    const refresh = byId("refreshDashboard");
    const openTools = byId("openAllTools");
    const search = byId("dashboardModuleSearch");
    const clearSearch = byId("clearDashboardSearch");
    const refreshConnections = byId("refreshConnectionsDashboard");
    const connectAllButton = byId("connectAllDashboard");

    if (refresh) refresh.addEventListener("click", () => carregarDashboard(SantanderApp.dashboardPeriod, true));
    if (openTools) openTools.addEventListener("click", carregarFerramentas);
    if (search) search.addEventListener("input", event => renderDashboardModules(event.target.value));
    if (clearSearch) clearSearch.addEventListener("click", () => {
        if (search) search.value = "";
        renderDashboardModules("");
        if (search) search.focus();
    });
    if (refreshConnections) refreshConnections.addEventListener("click", atualizarConexoesDashboard);
    if (connectAllButton) connectAllButton.addEventListener("click", conectarServicosDashboard);
    iniciarTimersConexao();

    document.querySelectorAll("[data-ranking-period]").forEach(button => {
        button.addEventListener("click", async () => {
            SantanderApp.dashboardPeriod = button.dataset.rankingPeriod || "7days";
            document.querySelectorAll("[data-ranking-period]").forEach(item => {
                item.classList.toggle("active", item === button);
            });

            const target = byId("dashboardRanking");
            if (target) {
                target.innerHTML = '<div class="page-loading" style="min-height:130px"><div class="loading-spinner"></div><strong>A atualizar ranking...</strong></div>';
            }

            try {
                SantanderApp.ranking = await carregarUso(SantanderApp.dashboardPeriod);
                if (target) target.innerHTML = renderRanking(SantanderApp.ranking);
                renderDashboardModules(search ? search.value : "");
            } catch (error) {
                if (target) {
                    target.innerHTML = `<div class="error-state" style="min-height:130px"><strong>Erro ao carregar ranking</strong><span>${escapeHtml(error.message)}</span></div>`;
                }
            }
        });
    });
}

async function carregarDashboard(period, force) {
    setActiveNav("dashboard");
    setPageHeader("Dashboard", "Visão operacional do Santander Support Web");
    SantanderApp.dashboardPeriod = period || SantanderApp.dashboardPeriod || "7days";
    renderPageLoading("A atualizar indicadores, ranking e conexões...");

    try {
        await carregarModulos(Boolean(force));

        const results = await Promise.allSettled([
            carregarInformacaoSistema(),
            carregarUso("today"),
            carregarUso(SantanderApp.dashboardPeriod),
            carregarAtividade(),
            consultarStatusConexoes()
        ]);

        SantanderApp.todayUsage = results[1].status === "fulfilled"
            ? results[1].value
            : { totalAccesses: 0, uniqueModules: 0, ranking: [] };

        SantanderApp.ranking = results[2].status === "fulfilled"
            ? results[2].value
            : { totalAccesses: 0, uniqueModules: 0, ranking: [] };

        renderDashboard();
    } catch (error) {
        renderPageError(
            "Não foi possível carregar o dashboard",
            error.message,
            () => carregarDashboard(SantanderApp.dashboardPeriod, true)
        );
    }
}

async function atualizarConexoesDashboard() {
    const target = byId("dashboardConnections");
    if (target) {
        target.innerHTML = '<div class="page-loading" style="min-height:120px"><div class="loading-spinner"></div><strong>A verificar conexões...</strong></div>';
    }

    await consultarStatusConexoes();

    if (target) {
        target.innerHTML = renderConnections(SantanderApp.connections);
    }

    const connectAllButton = byId("connectAllDashboard");
    if (connectAllButton) connectAllButton.addEventListener("click", conectarServicosDashboard);
    iniciarTimersConexao();

    definirAtualizacao(new Date());
}

function renderCatalog(modules, title, subtitle, view) {
    const content = byId("content");
    if (!content) return;

    const categories = Array.from(new Set(modules.map(obterCategoriaModulo))).sort((a, b) => a.localeCompare(b, "pt"));

    content.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <div class="panel-title">
                    <h3>${escapeHtml(title)}</h3>
                    <p>${escapeHtml(subtitle)}</p>
                </div>
                <span class="module-tag" id="catalogCount">${formatarNumero(modules.length)} módulo(s)</span>
            </div>

            <div class="catalog-toolbar">
                <div class="search-field">
                    <input id="catalogSearch" type="search" placeholder="Pesquisar por nome, descrição ou categoria..." autocomplete="off">
                </div>
                <button class="btn-subtle" id="catalogClear" type="button">Limpar filtros</button>
            </div>

            <div class="category-chips" id="categoryChips">
                <button class="category-chip active" type="button" data-category="">Todos</button>
                ${categories.map(category => `<button class="category-chip" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("")}
            </div>

            <div id="moduleCatalogGrid" class="module-grid"></div>
        </div>
    `;

    const state = { search: "", category: "" };
    const grid = byId("moduleCatalogGrid");
    const count = byId("catalogCount");

    const render = () => {
        const query = normalizarTexto(state.search);
        const category = normalizarTexto(state.category);

        const filtered = modules.filter(modulo => {
            const matchesCategory = !category || normalizarTexto(obterCategoriaModulo(modulo)) === category;
            const matchesSearch = !query || normalizarTexto([
                obterTituloModulo(modulo),
                obterDescricaoModulo(modulo),
                obterCategoriaModulo(modulo)
            ].join(" ")).includes(query);
            return matchesCategory && matchesSearch;
        });

        if (count) count.textContent = `${formatarNumero(filtered.length)} módulo(s)`;

        if (grid) {
            grid.innerHTML = filtered.length
                ? filtered.map(renderModuleCard).join("")
                : `
                    <div class="empty-state" style="grid-column:1/-1">
                        <strong>Nenhum módulo encontrado.</strong>
                        <span>Altere a pesquisa ou selecione outra categoria.</span>
                    </div>
                `;
            bindModuleCards(grid);
        }
    };

    const search = byId("catalogSearch");
    const clear = byId("catalogClear");

    if (search) search.addEventListener("input", event => {
        state.search = event.target.value;
        render();
    });

    if (clear) clear.addEventListener("click", () => {
        state.search = "";
        state.category = "";
        if (search) search.value = "";
        document.querySelectorAll("#categoryChips .category-chip").forEach(button => {
            button.classList.toggle("active", button.dataset.category === "");
        });
        render();
    });

    document.querySelectorAll("#categoryChips .category-chip").forEach(button => {
        button.addEventListener("click", () => {
            state.category = button.dataset.category || "";
            document.querySelectorAll("#categoryChips .category-chip").forEach(item => {
                item.classList.toggle("active", item === button);
            });
            render();
        });
    });

    render();
    setActiveNav(view);
    definirAtualizacao(new Date());
}

async function carregarRespostasPadrao() {
    setPageHeader(
        "Respostas padrão",
        "Biblioteca de respostas operacionais para tickets e atendimento"
    );

    setActiveNav("respostas");

    await abrirModulo(
        "respostas-padrao",
        "Respostas padrão",
        "Biblioteca de respostas operacionais para tickets e atendimento"
    );
}
async function carregarFerramentas() {
    setPageHeader("Ferramentas", "Módulos operacionais disponíveis");
    renderPageLoading("A carregar o catálogo de ferramentas...");

    try {
        await carregarModulos(true);
        renderCatalog(
            todosModulos,
            "Catálogo de ferramentas",
            "Pesquise, filtre por categoria ou marque os módulos mais utilizados como favoritos.",
            "ferramentas"
        );
    } catch (error) {
        renderPageError("Não foi possível carregar as ferramentas", error.message, carregarFerramentas);
    }
}

async function carregarRelatorios() {
    setPageHeader("Relatórios", "Relatórios operacionais disponíveis");
    renderPageLoading("A carregar os módulos de relatório...");

    try {
        await carregarModulos(true);

        const reports = todosModulos.filter(modulo => {
            const category = normalizarTexto(obterCategoriaModulo(modulo));
            return category.includes("relatorio");
        });

        renderCatalog(
            reports,
            "Relatórios operacionais",
            "Relatórios disponíveis para Intune, Exchange, Microsoft 365 e outras áreas.",
            "relatorios"
        );
    } catch (error) {
        renderPageError("Não foi possível carregar os relatórios", error.message, carregarRelatorios);
    }
}

function renderModuleLoading(title, percent, message) {
    const content = byId("content");
    if (!content) return;

    const safePercent = Math.min(100, Math.max(0, Number(percent || 0)));

    content.innerHTML = `
        <div class="module-loading-card">
            <h3>${escapeHtml(title || "A abrir módulo")}</h3>
            <p id="moduleLoadMessage">${escapeHtml(message || "A preparar o módulo...")}</p>
            <div class="module-load-progress"><span id="moduleLoadProgress" style="width:${safePercent}%"></span></div>
        </div>
    `;
}

function updateModuleLoading(percent, message) {
    const progress = byId("moduleLoadProgress");
    const text = byId("moduleLoadMessage");
    const safePercent = Math.min(100, Math.max(0, Number(percent || 0)));

    if (progress) progress.style.width = `${safePercent}%`;
    if (text) text.textContent = message || "A processar...";
}

async function carregarCssModulo(moduleName) {
    const styleId = "module-style-active";
    const previousStyle = byId(styleId);
    if (previousStyle) previousStyle.remove();

    const cssUrl = `/module/${encodeURIComponent(moduleName)}/style?v=${Date.now()}`;
    const response = await fetch(cssUrl, { cache: "no-store" });

    if (response.status === 404) {
        console.info("Módulo sem style.css publicado:", moduleName);
        return false;
    }

    if (!response.ok) {
        throw new Error(`Falha ao carregar CSS do módulo: HTTP ${response.status}`);
    }

    const cssText = await response.text();
    const style = document.createElement("style");
    style.id = styleId;
    style.setAttribute("data-module", moduleName);
    style.textContent = cssText;
    document.head.appendChild(style);
    return true;
}

async function carregarScriptModulo(moduleName) {
    const oldScript = byId("module-script");
    if (oldScript) oldScript.remove();

    window.__SantanderModuloCarregando = moduleName;

    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.id = "module-script";
        script.src = `/module/${encodeURIComponent(moduleName)}/script?v=${Date.now()}`;
        script.async = false;

        script.onload = () => {
            window.__SantanderModuloExecutado = moduleName;
            window.__SantanderModuloCarregando = null;
            resolve(true);
        };

        script.onerror = () => {
            window.__SantanderModuloCarregando = null;
            reject(new Error(`Falha ao carregar o script do módulo ${moduleName}.`));
        };

        document.body.appendChild(script);
    });
}

async function registarUsoModulo(moduleName) {
    const moduleId = String(moduleName || "").trim();

    if (!moduleId) {
        return false;
    }

    try {
        await fetchJson(
            `/api/dashboard/usage?moduleId=${encodeURIComponent(moduleId)}`,
            { method: "POST" }
        );

        return true;
    } catch (error) {
        addDebugLog(
            "USAGE ERROR",
            `Não foi possível registar utilização de ${moduleId}`,
            error.message
        );

        return false;
    }
}

async function abrirModulo(moduleName, title, description) {
    if (window.__SantanderModuloExecutado || window.__SantanderModuloCarregando) {
        try {
            sessionStorage.setItem(PENDING_MODULE_KEY, JSON.stringify({
                moduleName,
                title: title || moduleName,
                description: description || ""
            }));
        } catch (error) {
            console.warn("Não foi possível guardar o módulo pendente:", error);
        }

        window.location.reload();
        return;
    }

    if (!moduleName || moduleName === "undefined" || moduleName === "null") {
        renderPageError("Módulo inválido", "O módulo não possui id, module ou name.", carregarFerramentas);
        return;
    }

    if (window.vuCleanupOperationPanel) {
        try { window.vuCleanupOperationPanel(); } catch (_) { }
    }

    const oldVuPanel = byId("vuOperationPanel");
    if (oldVuPanel) oldVuPanel.remove();

    setPageHeader(title || moduleName, description || "Módulo operacional");
    setActiveNav(moduleName === "respostas-padrao" ? "respostas" : "ferramentas");
    renderModuleLoading(title || moduleName, 8, "A obter a página do módulo...");

    try {
        const pageResponse = await fetch(
            `/module/${encodeURIComponent(moduleName)}/page?v=${Date.now()}`,
            { cache: "no-store" }
        );

        if (!pageResponse.ok) {
            throw new Error(`Falha ao carregar a página do módulo: HTTP ${pageResponse.status}`);
        }

        const html = await pageResponse.text();
        updateModuleLoading(38, "Página recebida. A aplicar o estilo...");

        const content = byId("content");
        if (!content) throw new Error("Área principal #content não encontrada.");
        content.innerHTML = `
            <div class="module-loading-card" id="moduleInlineLoadBanner" style="margin-bottom:16px">
                <h3>${escapeHtml(title || moduleName)}</h3>
                <p id="moduleLoadMessage">Página recebida. A aplicar o estilo...</p>
                <div class="module-load-progress"><span id="moduleLoadProgress" style="width:38%"></span></div>
            </div>
            ${html}
        `;

        await carregarCssModulo(moduleName);
        updateModuleLoading(72, "Estilo aplicado. A iniciar o módulo...");

        await carregarScriptModulo(moduleName);
        updateModuleLoading(100, "Módulo carregado com sucesso.");
        setTimeout(() => {
            const banner = byId("moduleInlineLoadBanner");
            if (banner) banner.remove();
        }, 450);
        registarRecenteLocal(moduleName);
        await registarUsoModulo(moduleName);

        definirAtualizacao(new Date());
        addDebugLog("MODULE OPEN", `Módulo aberto: ${moduleName}`, title || "");
    } catch (error) {
        addDebugLog("MODULE ERROR", `Falha ao abrir módulo ${moduleName}`, error.message);
        renderPageError(
            `Erro ao abrir ${title || moduleName}`,
            error.message,
            () => abrirModulo(moduleName, title, description)
        );
    }
}

function abrirModuloSeguro(element) {
    try {
        const raw = element && element.getAttribute("data-module-json");
        const modulo = raw ? JSON.parse(decodeURIComponent(escape(atob(raw)))) : null;
        const moduleKey = obterChaveModulo(modulo);

        if (!moduleKey) {
            throw new Error("Módulo sem id/module/name.");
        }

        abrirModulo(moduleKey, obterTituloModulo(modulo), obterDescricaoModulo(modulo));
    } catch (error) {
        mostrarToast(`Erro ao abrir módulo: ${error.message}`, "error");
        console.error(error);
    }
}

async function restaurarModuloPendenteSantander() {
    let pendingRaw = null;

    try {
        pendingRaw = sessionStorage.getItem(PENDING_MODULE_KEY);
        if (!pendingRaw) return false;

        sessionStorage.removeItem(PENDING_MODULE_KEY);
        const pending = JSON.parse(pendingRaw);
        if (!pending || !pending.moduleName) return false;

        await abrirModulo(
            pending.moduleName,
            pending.title || pending.moduleName,
            pending.description || ""
        );return true;
    } catch (error) {
        try { sessionStorage.removeItem(PENDING_MODULE_KEY); } catch (_) { }
        console.error("Erro ao restaurar módulo pendente:", error);
        return false;
    }
}

/* ============================================================
   CONNECTIONS - GLOBAL AND COMPATIBILITY
============================================================ */

async function conectarGraphGlobal() {
    mostrarToast("A abrir autenticação do Microsoft Graph...", "");

    try {
        const data = await fetchJson("/api/graph/connect", { method: "POST" });
        if (!data.success) throw new Error(data.error || "Falha ao conectar Microsoft Graph.");
        mostrarToast("Microsoft Graph conectado com sucesso.", "success");
    } catch (error) {
        mostrarToast(`Erro ao conectar Graph: ${error.message}`, "error");
    }

    if (SantanderApp.currentView === "dashboard") {
        await atualizarConexoesDashboard();
    } else {
        await atualizarStatusConexoesGlobal();
    }
}

async function desconectarGraphGlobal() {
    try {
        await fetchJson("/api/graph/disconnect", { method: "POST" });
        mostrarToast("Microsoft Graph desligado.", "success");
    } catch (error) {
        mostrarToast(`Erro ao desligar Graph: ${error.message}`, "error");
    }

    if (SantanderApp.currentView === "dashboard") {
        await atualizarConexoesDashboard();
    } else {
        await atualizarStatusConexoesGlobal();
    }
}

async function conectarExchangeGlobal() {
    mostrarToast("A abrir autenticação do Exchange Online...", "");

    try {
        const data = await fetchJson("/api/exchange/connect", { method: "POST" });
        if (!data.success) throw new Error(data.error || "Falha ao conectar Exchange Online.");
        mostrarToast("Exchange Online conectado com sucesso.", "success");
    } catch (error) {
        mostrarToast(`Erro ao conectar Exchange: ${error.message}`, "error");
    }

    if (SantanderApp.currentView === "dashboard") {
        await atualizarConexoesDashboard();
    } else {
        await atualizarStatusConexoesGlobal();
    }
}

async function conectarExchangeOnline() {
    return conectarExchangeGlobal();
}

async function verificarExchangeOnline() {
    try {
        await atualizarStatusExchange();
    } catch (error) {
        console.warn("Erro verificarExchangeOnline:", error);
    }
}

async function atualizarStatusExchange() {
    const status = byId("exchangeStatus");
    if (!status) return;

    try {
        const data = await fetchJson("/api/exchange/status");
        status.innerHTML = data.connected
            ? `<div class="success">● Exchange Online conectado</div><div style="margin-top:7px">${escapeHtml(data.user || "")}</div>`
            : '<div class="error">● Exchange Online não conectado</div>';
    } catch (error) {
        status.innerHTML = `<div class="error">Erro ao consultar Exchange: ${escapeHtml(error.message)}</div>`;
    }
}

async function carregarPainelConexoesGlobal() {
    const container = byId("connectionPanelGlobal");
    if (!container) return;

    container.innerHTML = `
        <div class="connection-card loading"><strong>Microsoft Graph</strong><span>A verificar...</span></div>
        <div class="connection-card loading"><strong>Exchange Online</strong><span>A verificar...</span></div>
    `;

    await atualizarStatusConexoesGlobal();
}

async function atualizarStatusConexoesGlobal() {
    const container = byId("connectionPanelGlobal");
    if (!container) return;

    await consultarStatusConexoes();
    const graph = SantanderApp.connections.graph;
    const exchange = SantanderApp.connections.exchange;

    container.innerHTML = `
        <div class="connection-card ${graph.connected ? "connected" : "disconnected"}">
            <div>
                <strong>Microsoft Graph</strong>
                <span>${graph.connected ? "Conectado" : "Desconectado"}</span>
                <small>${escapeHtml(graph.account || graph.error || "")}</small>
            </div>
            <div class="connection-actions">
                <button type="button" data-connect-graph>Conectar</button>
                <button type="button" data-disconnect-graph>Desligar</button>
            </div>
        </div>

        <div class="connection-card ${exchange.connected ? "connected" : "disconnected"}">
            <div>
                <strong>Exchange Online</strong>
                <span>${exchange.connected ? "Conectado" : "Desconectado"}</span>
                <small>${escapeHtml(exchange.user || exchange.error || "")}</small>
            </div>
            <div class="connection-actions">
                <button type="button" data-connect-exchange>Conectar</button>
                <button type="button" data-refresh-connections>Atualizar</button>
            </div>
        </div>
    `;

    const graphConnect = container.querySelector("[data-connect-graph]");
    const graphDisconnect = container.querySelector("[data-disconnect-graph]");
    const exchangeConnect = container.querySelector("[data-connect-exchange]");
    const refresh = container.querySelector("[data-refresh-connections]");

    if (graphConnect) graphConnect.addEventListener("click", conectarGraphGlobal);
    if (graphDisconnect) graphDisconnect.addEventListener("click", desconectarGraphGlobal);
    if (exchangeConnect) exchangeConnect.addEventListener("click", conectarExchangeGlobal);
    if (refresh) refresh.addEventListener("click", atualizarStatusConexoesGlobal);
}

async function criarPainelConexaoModulo(containerId, options) {
    const container = byId(containerId);
    if (!container) return;

    const useExchange = options && options.exchange === true;
    const useGraph = options && options.graph === true;

    container.className = "module-connection-wrapper";
    container.innerHTML = '<div class="module-connection-loading">A verificar conexões...</div>';

    let html = "";
    if (useExchange) html += await gerarCardConexaoExchangeModulo(containerId);
    if (useGraph) html += await gerarCardConexaoGraphModulo(containerId);
    container.innerHTML = html;

    container.querySelectorAll("[data-module-connect-exchange]").forEach(button => {
        button.addEventListener("click", () => conectarExchangeModulo(containerId));
    });
    container.querySelectorAll("[data-module-connect-graph]").forEach(button => {
        button.addEventListener("click", () => conectarGraphModulo(containerId));
    });
    container.querySelectorAll("[data-module-refresh]").forEach(button => {
        button.addEventListener("click", () => criarPainelConexaoModulo(containerId, options));
    });
}

async function gerarCardConexaoExchangeModulo() {
    let data = { connected: false };
    try { data = await fetchJson("/api/exchange/status"); } catch (error) { data = { connected: false, error: error.message }; }

    return `
        <div class="module-connection-card ${data.connected ? "connected" : "disconnected"}">
            <div>
                <div class="module-connection-title">Exchange Online</div>
                <div class="module-connection-status">${data.connected ? "Conectado" : "Desconectado"}</div>
                <div class="module-connection-detail">${escapeHtml(data.user || data.error || "Necessário para executar este módulo.")}</div>
            </div>
            <div class="module-connection-actions">
                <button type="button" data-module-connect-exchange>Conectar Exchange</button>
                <button type="button" data-module-refresh>Atualizar</button>
            </div>
        </div>
    `;
}

async function gerarCardConexaoGraphModulo() {
    let data = { connected: false };
    try { data = await fetchJson("/api/graph/status"); } catch (error) { data = { connected: false, error: error.message }; }

    return `
        <div class="module-connection-card ${data.connected ? "connected" : "disconnected"}">
            <div>
                <div class="module-connection-title">Microsoft Graph</div>
                <div class="module-connection-status">${data.connected ? "Conectado" : "Desconectado"}</div>
                <div class="module-connection-detail">${escapeHtml(data.account || data.error || "Necessário para executar este módulo.")}</div>
            </div>
            <div class="module-connection-actions">
                <button type="button" data-module-connect-graph>Conectar Graph</button>
                <button type="button" data-module-refresh>Atualizar</button>
            </div>
        </div>
    `;
}

async function conectarExchangeModulo(containerId) {
    await conectarExchangeGlobal();
    await criarPainelConexaoModulo(containerId, { exchange: true });
}

async function conectarGraphModulo(containerId) {
    await conectarGraphGlobal();
    await criarPainelConexaoModulo(containerId, { graph: true });
}

/* ============================================================
   COPY COMPATIBILITY
============================================================ */

function copiarRespostaMudancaBalcao() {
    const field = byId("ticketResponse") || byId("respostaTicketMudancaBalcao");

    if (!field) {
        mostrarToast("Campo de resposta não encontrado.", "error");
        return;
    }

    const text = field.value || field.innerText || field.textContent || "";
    if (!text.trim()) {
        mostrarToast("Não existe resposta para copiar.", "error");
        return;
    }

    copiarTexto(text)
        .then(() => mostrarToast("Resposta copiada com sucesso.", "success"))
        .catch(() => mostrarToast("Não foi possível copiar automaticamente.", "error"));
}

async function copiarTexto(text) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const temporary = document.createElement("textarea");
    temporary.value = text;
    temporary.style.position = "fixed";
    temporary.style.left = "-9999px";
    document.body.appendChild(temporary);
    temporary.focus();
    temporary.select();

    const success = document.execCommand("copy");
    temporary.remove();

    if (!success) throw new Error("Falha ao copiar.");
}

function carregarResetMFA() {
    abrirModulo("reset-mfa", "Reset MFA", "Repor métodos de autenticação multifator.");
}

/* ============================================================
   GLOBAL PROGRESS
============================================================ */

function criarProgressGlobal(containerId) {
    const container = byId(containerId);
    if (!container) {
        console.warn("Progress container não encontrado:", containerId);
        return;
    }

    if (container.dataset.progressReady === "true") return;

    container.className = "global-progress-container";
    container.innerHTML = `
        <div class="global-progress-wrapper">
            <div class="global-progress-bar" id="${escapeHtml(containerId)}_bar">0%</div>
        </div>
        <div class="global-progress-text" id="${escapeHtml(containerId)}_text">Aguardando...</div>
    `;
    container.dataset.progressReady = "true";
}

function atualizarProgressGlobal(containerId, percentage, text) {
    criarProgressGlobal(containerId);

    const container = byId(containerId);
    const bar = byId(`${containerId}_bar`);
    const status = byId(`${containerId}_text`);
    if (!container || !bar || !status) return;

    let value = parseInt(percentage, 10);
    if (Number.isNaN(value)) value = 0;
    value = Math.max(0, Math.min(100, value));

    container.style.display = "block";
    container.classList.remove("global-progress-success", "global-progress-error", "global-progress-warning");
    bar.style.width = `${value}%`;
    bar.textContent = `${value}%`;
    status.textContent = text || "A processar...";
}

function finalizarProgressGlobal(containerId, success, text) {
    atualizarProgressGlobal(containerId, 100, text);
    const container = byId(containerId);
    if (!container) return;

    container.classList.remove("global-progress-success", "global-progress-error", "global-progress-warning");
    container.classList.add(success === true ? "global-progress-success" : "global-progress-error");
}

function resetarProgressGlobal(containerId) {
    criarProgressGlobal(containerId);

    const container = byId(containerId);
    const bar = byId(`${containerId}_bar`);
    const status = byId(`${containerId}_text`);
    if (!container || !bar || !status) return;

    container.style.display = "none";
    container.classList.remove("global-progress-success", "global-progress-error", "global-progress-warning");
    bar.style.width = "0%";
    bar.textContent = "0%";
    status.textContent = "Aguardando...";
}

/* ============================================================
   DEBUG MODE GLOBAL
============================================================ */

function abrirDebug() {
    SantanderDebugMode = !SantanderDebugMode;
    localStorage.setItem("SantanderDebugMode", SantanderDebugMode ? "true" : "false");
    atualizarDebugButton();
    renderDebugPanel();

    if (SantanderDebugMode) {
        addDebugLog("DEBUG ATIVADO", "O modo debug foi ativado.");
        carregarDebugServidor();
    }
}

function atualizarDebugButton() {
    const button = document.querySelector(".debug-button");
    const label = document.querySelector(".debug-button-label");
    if (!button) return;

    button.classList.toggle("debug-on", SantanderDebugMode);
    if (label) label.textContent = SantanderDebugMode ? "Debug ON" : "Debug";

    const count = SantanderDebugLogs.filter(log => String(log.tipo).toUpperCase().includes("ERROR")).length;
    const counter = byId("debugErrorCount");
    if (counter) {
        counter.textContent = String(count);
        counter.hidden = count === 0;
    }
}

function renderDebugPanel() {
    let panel = byId("debugPanelGlobal");

    if (!SantanderDebugMode) {
        if (panel) panel.style.display = "none";
        return;
    }

    if (!panel) {
        panel = document.createElement("div");
        panel.id = "debugPanelGlobal";
        panel.innerHTML = `
            <div class="debug-panel-header">
                <strong>Debug Mode</strong>
                <div>
                    <button type="button" data-debug-refresh>Atualizar</button>
                    <button type="button" data-debug-clear>Limpar</button>
                    <button type="button" data-debug-close>Fechar</button>
                </div>
            </div>
            <div class="debug-panel-body" id="debugPanelBody"></div>
        `;
        document.body.appendChild(panel);

        panel.querySelector("[data-debug-refresh]").addEventListener("click", carregarDebugServidor);
        panel.querySelector("[data-debug-clear]").addEventListener("click", limparDebugPanel);
        panel.querySelector("[data-debug-close]").addEventListener("click", abrirDebug);
    }

    panel.style.display = "block";
    atualizarDebugPanel();
}

function addDebugLog(type, message, detail) {
    SantanderDebugLogs.unshift({
        hora: new Date().toLocaleTimeString("pt-PT"),
        tipo: type,
        mensagem: message,
        detalhe: detail || ""
    });

    if (SantanderDebugLogs.length > 300) SantanderDebugLogs.pop();
    atualizarDebugPanel();
    atualizarDebugButton();
}

function atualizarDebugPanel() {
    const body = byId("debugPanelBody");
    if (!body) return;

    body.innerHTML = SantanderDebugLogs.map(log => `
        <div class="debug-log-item">
            <div>
                <span class="debug-time">${escapeHtml(log.hora)}</span>
                <span class="debug-type">${escapeHtml(log.tipo)}</span>
            </div>
            <div class="debug-message">${escapeHtml(log.mensagem)}</div>
            ${log.detalhe ? `<pre>${escapeHtml(log.detalhe)}</pre>` : ""}
        </div>
    `).join("");
}

function limparDebugPanel() {
    SantanderDebugLogs = [];
    atualizarDebugPanel();
    atualizarDebugButton();
}

async function carregarDebugServidor() {
    if (String(SantanderApp?.systemInfo?.environment || "production").toLowerCase() === "production") {
        addDebugLog("SERVER", "Os logs do servidor não são expostos no ambiente de produção.");
        return;
    }
    if (!SantanderDebugMode) return;

    try {
        const data = await fetchJson("/api/debug");
        if (data.success && Array.isArray(data.logs)) {
            addDebugLog("SERVER LOGS", "Últimas linhas do servidor carregadas.", data.logs.join("\n"));
        } else {
            addDebugLog("SERVER ERROR", "Não foi possível carregar logs do servidor.", JSON.stringify(data, null, 2));
        }
    } catch (error) {
        addDebugLog("SERVER ERROR", "Erro ao chamar /api/debug", error.message);
    }
}

function escapeHtmlDebug(text) {
    return escapeHtml(text);
}

(function instalarDebugFetchInterceptor() {
    if (window.__SantanderDebugFetchInstalled) return;
    window.__SantanderDebugFetchInstalled = true;

    const originalFetch = window.fetch.bind(window);

    window.fetch = async function(resource, options) {
        const url = typeof resource === "string" ? resource : resource.url;
        let finalResource = resource;

        if (SantanderDebugMode && url && url.includes("/module/") && url.includes("/api")) {
            const separator = url.includes("?") ? "&" : "?";
            finalResource = `${url}${separator}debug=true`;
            addDebugLog("API REQUEST", finalResource, options && options.body ? options.body : "");
        }

        try {
            const response = await originalFetch(finalResource, options);

            if (SantanderDebugMode && url && url.includes("/module/") && url.includes("/api")) {
                const clone = response.clone();
                clone.text().then(text => addDebugLog("API RESPONSE", url, text)).catch(() => { });
            }

            return response;
        } catch (error) {
            if (SantanderDebugMode) addDebugLog("FETCH ERROR", url || "fetch", error.message);
            throw error;
        }
    };
})();

/* ============================================================
   GLOBAL INTUNE MAA MONITOR
============================================================ */

function obterAdiamentosMaaGlobal() {
    try { return JSON.parse(localStorage.getItem(GLOBAL_MAA_SNOOZE_KEY) || "{}"); }
    catch { return {}; }
}

function guardarAdiamentosMaaGlobal(data) {
    localStorage.setItem(GLOBAL_MAA_SNOOZE_KEY, JSON.stringify(data || {}));
}

function adiarAlertasMaaGlobal(minutes) {
    const until = Date.now() + Number(minutes || 5) * 60000;
    const snoozes = obterAdiamentosMaaGlobal();
    let notified = {};
    try { notified = JSON.parse(localStorage.getItem(GLOBAL_MAA_NOTIFIED_KEY) || "{}"); } catch {}
    SantanderGlobalMaaRequests.forEach(item => { snoozes[item.request.id] = until; });
    SantanderGlobalMaaRequests.forEach(item => { delete notified[item.request.id]; });
    guardarAdiamentosMaaGlobal(snoozes);
    localStorage.setItem(GLOBAL_MAA_NOTIFIED_KEY, JSON.stringify(notified));
    const modal = byId("santanderGlobalMaaModal");
    if (modal) modal.remove();
    mostrarToast(`Lembrete MAA adiado por ${minutes} minutos.`, "success");
}

function abrirDevicesIntunePeloAlerta() {
    const modal = byId("santanderGlobalMaaModal");
    if (modal) modal.remove();
    abrirModulo(
        "devices-intune",
        "Devices Intune",
        "Consulta, aprovação e conclusão de solicitações Intune MAA."
    ).catch(error => mostrarToast(`Erro ao abrir Devices Intune: ${error.message}`, "error"));
}

function normalizarRespostaModulo(data) {
    if (typeof data !== "string") return data || {};
    try { return JSON.parse(data); } catch { return { success: false, message: data }; }
}

async function ativarNotificacoesWindowsMaa() {
    if (!("Notification" in window)) {
        mostrarToast("Este navegador não suporta notificações do Windows.", "error");
        return;
    }
    const permission = await Notification.requestPermission();
    mostrarToast(permission === "granted" ? "Notificações do Windows ativadas." : "Permissão de notificações não concedida.", permission === "granted" ? "success" : "error");
}

function notificarWindowsMaa(items) {
    if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
    let notified = {};
    try { notified = JSON.parse(localStorage.getItem(GLOBAL_MAA_NOTIFIED_KEY) || "{}"); } catch {}
    const fresh = items.filter(item => !notified[item.request.id]);
    if (!fresh.length) return;
    fresh.forEach(item => {
        const notification = new Notification(
            item.kind === "approval" ? "Aprovação Intune MAA necessária" : "Solicitação MAA pronta para conclusão",
            {
                body: `${item.user.userPrincipalName || item.user.requestedUpn}\n${item.request.requestJustification || "Abra a aplicação para consultar."}`,
                tag: `santander-maa-${item.request.id}`,
                requireInteraction: true
            }
        );
        notification.onclick = () => {
            window.focus();
            abrirDevicesIntunePeloAlerta();
            notification.close();
        };
        notified[item.request.id] = Date.now();
    });
    localStorage.setItem(GLOBAL_MAA_NOTIFIED_KEY, JSON.stringify(notified));
}

async function carregarContactosMaaGlobal() {
    let data = await fetchJson("/module/devices-intune/api?action=getMaaAlertContacts");
    data = normalizarRespostaModulo(data);
    SantanderGlobalMaaContacts = Array.isArray(data.contacts) ? data.contacts : [];
    return SantanderGlobalMaaContacts;
}

async function guardarContactosMaaGlobal() {
    let data = await fetchJson("/module/devices-intune/api?action=saveMaaAlertContacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacts: SantanderGlobalMaaContacts })
    });
    data = normalizarRespostaModulo(data);
    if (!data.success) throw new Error(data.message || "Não foi possível guardar os contactos.");
    SantanderGlobalMaaContacts = data.contacts || [];
}

async function adicionarContactoMaaGlobal() {
    const email = prompt("E-mail ou UPN do contacto:", "");
    if (!email) return;
    let data = await fetchJson("/module/devices-intune/api?action=resolveMaaAlertContact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() })
    });
    data = normalizarRespostaModulo(data);
    if (!data.success || !data.contact) throw new Error(data.message || "Utilizador não encontrado.");
    const idx = SantanderGlobalMaaContacts.findIndex(x => x.id === data.contact.id || x.userPrincipalName === data.contact.userPrincipalName);
    if (idx >= 0) SantanderGlobalMaaContacts[idx] = { ...SantanderGlobalMaaContacts[idx], ...data.contact };
    else SantanderGlobalMaaContacts.push(data.contact);
    await guardarContactosMaaGlobal();
    await abrirContactosMaaGlobal();
}

async function abrirContactosMaaGlobal() {
    try { await carregarContactosMaaGlobal(); }
    catch (error) { mostrarToast(error.message, "error"); return; }
    const old = byId("santanderMaaContactsModal");
    if (old) old.remove();
    instalarEstiloModalMaaGlobal();
    const overlay = document.createElement("div");
    overlay.id = "santanderMaaContactsModal";
    overlay.className = "maa-global-overlay";
    overlay.innerHTML = `
        <div class="maa-global-modal" role="dialog" aria-modal="true">
            <div class="maa-global-header"><h3>Contactos para escalamento MAA</h3><p>Pesquise pelo e-mail/UPN; os restantes dados vêm do Entra ID.</p></div>
            <div class="maa-global-body">
                ${SantanderGlobalMaaContacts.length ? SantanderGlobalMaaContacts.map((contact, index) => `
                    <div class="maa-global-request" data-contact-index="${index}">
                        <strong>${escapeHtml(contact.displayName || contact.userPrincipalName)}</strong>
                        <span>${escapeHtml(contact.mail || contact.userPrincipalName)} · ${escapeHtml(contact.jobTitle || "Cargo não informado")} · ${escapeHtml(contact.department || "Departamento não informado")}</span>
                        <div class="maa-contact-options">
                            <label><input type="checkbox" data-contact-field="active" ${contact.active ? "checked" : ""}> Ativo</label>
                            <label><input type="checkbox" data-contact-field="emailEnabled" ${contact.emailEnabled ? "checked" : ""}> E-mail</label>
                            <label><input type="checkbox" data-contact-field="teamsEnabled" ${contact.teamsEnabled ? "checked" : ""}> Teams</label>
                            <button type="button" class="maa-global-snooze" data-contact-remove>Remover</button>
                        </div>
                    </div>`).join("") : `<p>Não existem contactos configurados.</p>`}
            </div>
            <div class="maa-global-actions">
                <button type="button" class="maa-global-open" data-contact-add>Adicionar pelo e-mail</button>
                <button type="button" class="maa-global-snooze" data-contact-save>Guardar</button>
                <button type="button" class="maa-global-snooze" data-contact-close>Fechar</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("[data-contact-add]").addEventListener("click", () => adicionarContactoMaaGlobal().catch(error => mostrarToast(error.message, "error")));
    overlay.querySelector("[data-contact-close]").addEventListener("click", () => overlay.remove());
    overlay.querySelector("[data-contact-save]").addEventListener("click", async () => {
        overlay.querySelectorAll("[data-contact-index]").forEach(row => {
            const contact = SantanderGlobalMaaContacts[Number(row.dataset.contactIndex)];
            row.querySelectorAll("[data-contact-field]").forEach(input => { contact[input.dataset.contactField] = input.checked; });
        });
        try { await guardarContactosMaaGlobal(); mostrarToast("Contactos MAA guardados.", "success"); overlay.remove(); }
        catch (error) { mostrarToast(error.message, "error"); }
    });
    overlay.querySelectorAll("[data-contact-remove]").forEach(button => button.addEventListener("click", async () => {
        const index = Number(button.closest("[data-contact-index]").dataset.contactIndex);
        SantanderGlobalMaaContacts.splice(index, 1);
        await guardarContactosMaaGlobal();
        abrirContactosMaaGlobal();
    }));
}

function criarTextoAlertaManualMaa() {
    const lines = SantanderGlobalMaaRequests.map(item => [
        item.kind === "approval" ? "APROVAÇÃO NECESSÁRIA" : "CONCLUSÃO NECESSÁRIA",
        `Solicitante: ${item.user.userPrincipalName || item.user.requestedUpn}`,
        `Pedido MAA: ${item.request.id}`,
        `Estado: ${item.request.status}`,
        `Data: ${formatarDataHora(item.request.requestDateTime)}`,
        `Justificação: ${item.request.requestJustification || "Não informada"}`
    ].join("\n"));
    return `Alerta Intune MAA\n\n${lines.join("\n\n")}`;
}

function criarItensAlertaManualMaa() {
    return SantanderGlobalMaaRequests.map(item => ({
        kind: item.kind,
        user: item.user.userPrincipalName || item.user.requestedUpn || "Não informado",
        requestId: item.request.id || "Não informado",
        status: item.request.status || "Não informado",
        date: formatarDataHora(item.request.requestDateTime),
        justification: item.request.requestJustification || "Não informada"
    }));
}

function criarHtmlTeamsAlertaMaa(items) {
    const blocks = items.map(item => `<div style="margin:0 0 14px"><strong style="color:#b40000">${escapeHtml(item.kind === "approval" ? "APROVAÇÃO NECESSÁRIA" : "CONCLUSÃO NECESSÁRIA")}</strong><br><strong>${escapeHtml(item.user)}</strong><br>Pedido: <code>${escapeHtml(item.requestId)}</code><br>Estado: ${escapeHtml(item.status)}<br>Data: ${escapeHtml(item.date)}<br>Justificação: ${escapeHtml(item.justification)}</div>`).join("");
    return `<div><strong>🔔 Solicitação Intune MAA pendente</strong><br><br>${blocks}<strong>Ação necessária:</strong> aceda ao módulo Devices Intune para validar o equipamento e executar a aprovação ou conclusão.</div>`;
}

async function enviarAlertaManualMaa() {
    if (!SantanderGlobalMaaRequests.length) { mostrarToast("Não existem solicitações MAA visíveis para alertar.", "error"); return; }
    try { await carregarContactosMaaGlobal(); }
    catch (error) { mostrarToast(error.message, "error"); return; }
    const active = SantanderGlobalMaaContacts.filter(x => x.active);
    if (!active.length) { await abrirContactosMaaGlobal(); return; }
    const text = criarTextoAlertaManualMaa();
    const alertItems = criarItensAlertaManualMaa();
    const teamsHtml = criarHtmlTeamsAlertaMaa(alertItems);
    const subject = "Alerta - solicitação Intune MAA pendente";
    const emails = active.filter(x => x.emailEnabled).map(x => x.mail || x.userPrincipalName);
    const teams = active.filter(x => x.teamsEnabled).map(x => x.userPrincipalName);
    const old = byId("santanderMaaManualSendModal");
    if (old) old.remove();
    const overlay = document.createElement("div");
    overlay.id = "santanderMaaManualSendModal";
    overlay.className = "maa-global-overlay";
    overlay.innerHTML = `
        <div class="maa-global-modal" role="dialog" aria-modal="true">
            <div class="maa-global-header"><h3>Enviar alerta manual</h3><p>O Outlook clássico envia automaticamente; no Teams, confirme o envio na conversa aberta.</p></div>
            <div class="maa-global-body"><div class="maa-global-request"><strong>${active.length} contacto(s) ativo(s)</strong><span>${escapeHtml(active.map(x => x.displayName || x.userPrincipalName).join(", "))}</span></div></div>
            <div class="maa-global-actions">
                ${emails.length ? `<button type="button" class="maa-global-open" data-send-outlook>Enviar pelo Outlook clássico</button>` : ""}
                ${teams.length ? `<button type="button" class="maa-global-open" data-open-teams>Copiar mensagem e abrir Teams</button>` : ""}
                <button type="button" class="maa-global-snooze" data-manual-close>Fechar</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("[data-manual-close]").addEventListener("click", () => overlay.remove());
    const outlookButton = overlay.querySelector("[data-send-outlook]");
    if (outlookButton) outlookButton.addEventListener("click", async () => {
        if (!confirm(`Confirma o envio automático pelo Outlook clássico para ${emails.length} destinatário(s)?`)) return;
        outlookButton.disabled = true;
        const originalText = outlookButton.textContent;
        outlookButton.textContent = "A enviar...";
        try {
            let data = await fetchJson("/module/devices-intune/api?action=sendMaaOutlookAlert", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ subject, text, items: alertItems })
            });
            data = normalizarRespostaModulo(data);
            if (!data.success) throw new Error(data.message || "Falha no envio pelo Outlook clássico.");
            mostrarToast(`${data.message} ${Array.isArray(data.recipients) ? data.recipients.length : emails.length} destinatário(s).`, "success");
            outlookButton.textContent = "E-mail enviado";
        } catch (error) {
            mostrarToast(error.message, "error");
            outlookButton.disabled = false;
            outlookButton.textContent = originalText;
        }
    });
    const teamsButton = overlay.querySelector("[data-open-teams]");
    if (teamsButton) teamsButton.addEventListener("click", async () => {
        const copyWithFallback = async (plainValue, htmlValue) => {
            if (navigator.clipboard?.write && window.ClipboardItem) {
                try {
                    await navigator.clipboard.write([new ClipboardItem({
                        "text/plain": new Blob([plainValue], { type: "text/plain" }),
                        "text/html": new Blob([htmlValue], { type: "text/html" })
                    })]);
                    return true;
                } catch {}
            }
            if (navigator.clipboard?.writeText) {
                try { await navigator.clipboard.writeText(plainValue); return true; } catch {}
            }
            const area = document.createElement("textarea");
            area.value = plainValue;
            area.setAttribute("readonly", "");
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            const copied = document.execCommand("copy");
            area.remove();
            return copied;
        };
        try {
            const copied = await copyWithFallback(text, teamsHtml);
            if (!copied) throw new Error("O navegador não autorizou a cópia para a área de transferência.");
            const teamsUrl = `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(teams.join(","))}`;
            window.open(teamsUrl, "_blank", "noopener,noreferrer");
            mostrarToast("Mensagem copiada. No Teams, pressione Ctrl+V e envie.", "success");
            teamsButton.textContent = "Copiado — use Ctrl+V no Teams";
        } catch (error) {
            mostrarToast(error.message, "error");
        }
    });
}

window.SantanderMaaGlobal = {
    ativarNotificacoesWindows: ativarNotificacoesWindowsMaa,
    abrirContactos: abrirContactosMaaGlobal,
    enviarAlertaManual: async items => {
        if (Array.isArray(items)) SantanderGlobalMaaRequests = items;
        return enviarAlertaManualMaa();
    }
};

function instalarEstiloModalMaaGlobal() {
    if (byId("santanderGlobalMaaStyle")) return;
    const style = document.createElement("style");
    style.id = "santanderGlobalMaaStyle";
    style.textContent = `
        .maa-global-overlay{position:fixed;inset:0;background:rgba(15,23,42,.48);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(2px)}
        .maa-global-modal{width:min(680px,100%);max-height:86vh;overflow:auto;background:#fff;border-radius:20px;box-shadow:0 24px 80px rgba(15,23,42,.32);border:1px solid #fee2e2}
        .maa-global-header{padding:22px 24px;background:linear-gradient(135deg,#b40000,#e00000);color:#fff;border-radius:20px 20px 0 0}
        .maa-global-header h3{margin:0 0 6px;font-size:21px}.maa-global-header p{margin:0;opacity:.92}
        .maa-global-body{padding:20px 24px}.maa-global-request{padding:14px;border:1px solid #e5e7eb;border-radius:14px;margin-bottom:10px;background:#f8fafc}
        .maa-global-request strong{display:block;color:#111827}.maa-global-request span{display:block;margin-top:4px;color:#64748b;font-size:13px}
        .maa-global-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 24px 22px}.maa-global-actions button{border:0;border-radius:10px;padding:10px 14px;font-weight:800;cursor:pointer}
        .maa-global-open{background:#d40000;color:#fff}.maa-global-snooze{background:#f1f5f9;color:#1f2937}
        .maa-contact-options{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px}.maa-contact-options label{font-size:13px;color:#374151}
    `;
    document.head.appendChild(style);
}

function renderizarAlertaMaaGlobal(items) {
    SantanderGlobalMaaRequests = items || [];
    const existing = byId("santanderGlobalMaaModal");
    if (!SantanderGlobalMaaRequests.length) {
        if (existing) existing.remove();
        return;
    }

    instalarEstiloModalMaaGlobal();
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.id = "santanderGlobalMaaModal";
    overlay.className = "maa-global-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "maaGlobalTitle");

    const approvals = SantanderGlobalMaaRequests.filter(x => x.kind === "approval").length;
    const completions = SantanderGlobalMaaRequests.length - approvals;
    overlay.innerHTML = `
        <div class="maa-global-modal">
            <div class="maa-global-header">
                <h3 id="maaGlobalTitle">Solicitação Intune MAA pendente</h3>
                <p>${approvals ? `${approvals} pedido(s) aguardam a sua aprovação.` : ""} ${completions ? `${completions} pedido(s) aprovados aguardam conclusão.` : ""}</p>
            </div>
            <div class="maa-global-body">
                ${SantanderGlobalMaaRequests.map(item => `
                    <div class="maa-global-request">
                        <strong>${escapeHtml(item.kind === "approval" ? "Aprovação necessária" : "Pronto para conclusão")} — ${escapeHtml(item.user.userPrincipalName || item.user.requestedUpn)}</strong>
                        <span>Pedido: ${escapeHtml(item.request.id)} · ${escapeHtml(formatarDataHora(item.request.requestDateTime))}</span>
                        <span>${escapeHtml(item.request.requestJustification || "Sem justificação informada")}</span>
                    </div>
                `).join("")}
            </div>
            <div class="maa-global-actions">
                <button type="button" class="maa-global-open" data-maa-open>Abrir Devices Intune</button>
                <button type="button" class="maa-global-snooze" data-maa-snooze="5">Lembrar em 5 min</button>
                <button type="button" class="maa-global-snooze" data-maa-snooze="10">Lembrar em 10 min</button>
                <button type="button" class="maa-global-snooze" data-maa-snooze="15">Lembrar em 15 min</button>
                <button type="button" class="maa-global-snooze" data-maa-windows>Ativar notificações Windows</button>
                <button type="button" class="maa-global-snooze" data-maa-close>Fechar</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("[data-maa-open]").addEventListener("click", abrirDevicesIntunePeloAlerta);
    overlay.querySelectorAll("[data-maa-snooze]").forEach(button => {
        button.addEventListener("click", () => adiarAlertasMaaGlobal(Number(button.dataset.maaSnooze)));
    });
    overlay.querySelector("[data-maa-close]").addEventListener("click", () => adiarAlertasMaaGlobal(5));
    overlay.querySelector("[data-maa-windows]").addEventListener("click", ativarNotificacoesWindowsMaa);
}

async function verificarMaaGlobal() {
    if (SantanderGlobalMaaChecking) return;
    if (Number(window.__SantanderLongOperationCount || 0) > 0 || Date.now() < Number(window.__SantanderLongOperationUntil || 0)) return;
    const graph = SantanderApp.connections && SantanderApp.connections.graph;
    const graphExpiresAt = graph && graph.expiresAt ? Date.parse(graph.expiresAt) : NaN;
    if (graph && graph.connected && Number.isFinite(graphExpiresAt) && Date.now() >= graphExpiresAt - 120000) return;
    if (window.__SantanderModuloExecutado === "devices-intune" || window.__SantanderModuloCarregando === "devices-intune") {
        const modal = byId("santanderGlobalMaaModal");
        if (modal) modal.remove();
        return;
    }
    SantanderGlobalMaaChecking = true;
    SantanderGlobalMaaAbortController = new AbortController();
    const maaTimeout = setTimeout(() => SantanderGlobalMaaAbortController?.abort(), SANTANDER_MAA_TIMEOUT_MS);
    try {
        let data = await fetchJson("/module/devices-intune/api?action=listMaaRequestsByUsers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userPrincipalNames: GLOBAL_MAA_USERS, silent: true }),
            signal: SantanderGlobalMaaAbortController.signal
        });
        if (typeof data === "string") data = JSON.parse(data);
        if (!data.success || !data.monitoringAvailable) return;

        const operator = String(data.currentOperator || "").toLowerCase();
        const snoozes = obterAdiamentosMaaGlobal();
        const now = Date.now();
        const alerts = [];
        (data.users || []).forEach(user => {
            const requestor = String(user.userPrincipalName || user.requestedUpn || "").toLowerCase();
            (user.requests || []).forEach(request => {
                if (Number(snoozes[request.id] || 0) > now) return;
                if (request.status === "needsApproval" && requestor !== operator) alerts.push({ kind: "approval", user, request });
                if (request.status === "approved" && requestor === operator) alerts.push({ kind: "completion", user, request });
            });
        });
        renderizarAlertaMaaGlobal(alerts);
        notificarWindowsMaa(alerts);
    } catch (error) {
        if (error && error.name !== "AbortError" && SantanderDebugMode) addDebugLog("MAA MONITOR", "Falha na verificação global MAA", error.message);
    } finally {
        clearTimeout(maaTimeout);
        SantanderGlobalMaaAbortController = null;
        SantanderGlobalMaaChecking = false;
    }
}

async function confirmarAlertaManualMaaSistema(alertId) {
    try {
        await fetchJson("/module/devices-intune/api?action=ackMaaManualSystemAlert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alertId })
        });
    } catch {}
}

function renderizarAlertaManualMaaSistema(alert) {
    if (!alert || byId("santanderManualMaaSystemModal")) return;
    instalarEstiloModalMaaGlobal();
    const overlay = document.createElement("div");
    overlay.id = "santanderManualMaaSystemModal";
    overlay.className = "maa-global-overlay";
    overlay.innerHTML = `
        <div class="maa-global-modal" role="dialog" aria-modal="true">
            <div class="maa-global-header">
                <h3>Aprovador solicitado</h3>
                <p>${escapeHtml(alert.sender || "Outro utilizador")} enviou um alerta manual para análise imediata.</p>
            </div>
            <div class="maa-global-body">
                <div class="maa-global-request">
                    <strong>${escapeHtml(alert.status === "approved" ? "Conclusão necessária" : "Aprovação necessária")}</strong>
                    <span>Pedido MAA: ${escapeHtml(alert.requestId)}</span>
                    <span>Solicitante: ${escapeHtml(alert.requestorUpn || "Não informado")}</span>
                    <span>${escapeHtml(alert.justification || "Sem justificação informada")}</span>
                </div>
            </div>
            <div class="maa-global-actions">
                <button type="button" class="maa-global-open" data-manual-system-open>Abrir Devices Intune</button>
                <button type="button" class="maa-global-snooze" data-manual-system-close>Dispensar</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("[data-manual-system-open]").addEventListener("click", async () => {
        await confirmarAlertaManualMaaSistema(alert.id);
        overlay.remove();
        abrirDevicesIntunePeloAlerta();
    });
    overlay.querySelector("[data-manual-system-close]").addEventListener("click", async () => {
        await confirmarAlertaManualMaaSistema(alert.id);
        overlay.remove();
    });
    if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
        const notification = new Notification("Solicitação manual Intune MAA", {
            body: `Pedido ${alert.requestId}\n${alert.justification || "Abra a aplicação para analisar."}`,
            tag: `santander-maa-manual-${alert.id}`,
            requireInteraction: true
        });
        notification.onclick = () => { window.focus(); notification.close(); };
    }
}

async function verificarAlertasManuaisMaaSistema() {
    if (SantanderManualMaaChecking) return;
    SantanderManualMaaChecking = true;
    try {
        let data = await fetchJson("/module/devices-intune/api?action=listMaaManualSystemAlerts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}"
        });
        data = normalizarRespostaModulo(data);
        if (data.success && Array.isArray(data.alerts) && data.alerts.length) renderizarAlertaManualMaaSistema(data.alerts[0]);
    } catch (error) {
        if (SantanderDebugMode) addDebugLog("MAA ALERTA MANUAL", "Falha na consulta de alertas manuais", error.message);
    } finally { SantanderManualMaaChecking = false; }
}

window.SantanderPauseBackgroundMonitoring = function () {
    if (SantanderGlobalMaaAbortController) SantanderGlobalMaaAbortController.abort();
};

function iniciarMonitorMaaGlobal() {
    if (SantanderGlobalMaaTimer) return;
    instalarEstiloModalMaaGlobal();
    const actions = document.querySelector(".topbar-actions");
    if (actions && !byId("maaGlobalSettingsButton")) {
        const button = document.createElement("button");
        button.id = "maaGlobalSettingsButton";
        button.type = "button";
        button.className = "maa-global-snooze";
        button.style.cssText = "border:0;border-radius:10px;padding:9px 12px;font-weight:800;cursor:pointer;";
        button.textContent = "Contactos MAA";
        button.addEventListener("click", abrirContactosMaaGlobal);
        actions.appendChild(button);
    }
    verificarMaaGlobal();
    SantanderGlobalMaaTimer = setInterval(verificarMaaGlobal, 3600000);
    verificarAlertasManuaisMaaSistema();
    SantanderManualMaaTimer = setInterval(verificarAlertasManuaisMaaSistema, 30000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) verificarAlertasManuaisMaaSistema(); });
}

/* ============================================================
   APPLICATION INITIALIZATION
============================================================ */

function bindNavigation() {
    const dashboard = byId("navDashboard");
    const tools = byId("navFerramentas");
    const reports = byId("navRelatorios");
    const standardResponses = byId("navRespostasPadrao");
    const debug = document.querySelector(".debug-button");
    const mobile = byId("mobileMenuButton");

    if (dashboard) dashboard.addEventListener("click", () => carregarDashboard(SantanderApp.dashboardPeriod, false));
    if (tools) tools.addEventListener("click", carregarFerramentas);
    if (reports) reports.addEventListener("click", carregarRelatorios);
    if (standardResponses) standardResponses.addEventListener("click", carregarRespostasPadrao);
    if (debug) debug.addEventListener("click", abrirDebug);
    if (mobile) mobile.addEventListener("click", abrirMenuMobile);
}

async function inicializarAplicacao() {
    bindNavigation();
    mostrarAmbiente("production");
    atualizarDebugButton();

    if (SantanderDebugMode) {
        renderDebugPanel();
        addDebugLog("DEBUG ATIVO", "Debug Mode recuperado do localStorage.");
    }

    const restored = await restaurarModuloPendenteSantander();
    if (!restored) {
        await carregarDashboard("7days", true);
    }
    iniciarMonitorMaaGlobal();
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inicializarAplicacao, { once: true });
} else {
    inicializarAplicacao();
}

/* SANTANDER_DASHBOARD_V3_READY */
