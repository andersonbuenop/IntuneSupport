(function () {
    "use strict";

    const moduleKey = "ResetMfaModuleV232";

    if (window[moduleKey] && window[moduleKey].initialized) {
        window[moduleKey].refresh();
        return;
    }

    const SERVICE_NOW_URL = "https://santander.service-now.com/now/nav/ui/classic/params/target/com.glideapp.servicecatalog_cat_item_view.do%3Fv%3D1%26sysparm_id%3D3af50b342b06be102a08f35fee91bf23";
    const APPROVAL_RECIPIENTS = [
        "s613220@corp.santander.pt",
        "S613637@corp.santander.pt",
        "S612160@corp.santander.pt"
    ];

    const state = {
        initialized: false,
        busy: false,
        graphReady: false,
        user: null,
        signature: "",
        authorization: null,
        searchFingerprint: "",
        lastResetResult: null,
        approvedRequesters: []
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function valueOf(id) {
        const element = byId(id);
        return element ? element.value.trim() : "";
    }

    function setValue(id, value) {
        const element = byId(id);
        if (element) {
            element.value = value == null ? "" : String(value);
        }
    }

    function setText(id, value) {
        const element = byId(id);
        if (element) {
            element.textContent = value == null ? "" : String(value);
        }
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatDateTime(value) {
        if (!value) {
            return new Date().toLocaleString();
        }

        const parsed = new Date(value.replace(" ", "T"));
        return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
    }

    function addLog(message) {
        const logs = byId("resetMfaLogs");

        if (!logs) {
            return;
        }

        const time = new Date().toLocaleTimeString();

        if (logs.textContent.includes("Aguardando operação")) {
            logs.textContent = "";
        }

        logs.textContent += `[${time}] ${message}\n`;
        logs.scrollTop = logs.scrollHeight;
    }

    function setProgress(percent, message) {
        const normalized = Math.max(0, Math.min(100, Number(percent) || 0));
        const bar = byId("resetMfaProgressBar");
        const track = bar ? bar.parentElement : null;

        if (bar) {
            bar.style.width = `${normalized}%`;
        }

        if (track) {
            track.setAttribute("aria-valuenow", String(normalized));
        }

        setText("resetMfaProgressPercent", `${normalized}%`);
        setText("resetMfaProgressText", message || "Aguardando operação.");
    }

    function setBusy(isBusy, message) {
        state.busy = Boolean(isBusy);

        [
            "resetMfaBtnConnect",
            "resetMfaBtnSearch",
            "resetMfaBtnValidateRequester"
        ].forEach(id => {
            const button = byId(id);
            if (button) {
                button.disabled = state.busy;
            }
        });

        updateActionState();

        if (message) {
            setProgress(state.busy ? 10 : 0, message);
        }
    }

    function updateGraphStatus(connected, ready, text) {
        const dot = byId("resetMfaGraphStatusDot");

        if (dot) {
            dot.classList.remove("reset-mfa-graph-on", "reset-mfa-graph-off");
            dot.classList.add(connected && ready ? "reset-mfa-graph-on" : "reset-mfa-graph-off");
        }

        setText(
            "resetMfaGraphStatusText",
            text || (connected && ready ? "Conectado e pronto" : "Não conectado")
        );

        state.graphReady = Boolean(connected && ready);
        updateActionState();
    }

    async function callApi(action, params = {}, timeoutMs = 120000) {
        const query = new URLSearchParams();
        query.append("action", action);

        Object.keys(params).forEach(key => {
            const value = params[key];

            if (value !== undefined && value !== null && String(value).trim() !== "") {
                query.append(key, String(value));
            }
        });

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch("/module/reset-mfa/api", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify(Object.fromEntries(query.entries())),
                cache: "no-store",
                signal: controller.signal
            });

            const text = await response.text();
            let parsed;

            try {
                parsed = text ? JSON.parse(text) : null;
            } catch (error) {
                throw new Error(`Resposta inválida da API. HTTP ${response.status}. Conteúdo: ${text.slice(0, 300)}`);
            }

            if (!response.ok) {
                throw new Error((parsed && parsed.message) || `Erro HTTP ${response.status}.`);
            }

            if (!parsed || typeof parsed.success !== "boolean") {
                throw new Error("A API devolveu uma estrutura inesperada.");
            }

            return parsed;
        } catch (error) {
            if (error && error.name === "AbortError") {
                throw new Error("A operação excedeu o tempo limite. Verifique o servidor e tente novamente.");
            }

            throw error;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    function buildAddress(data) {
        if (data.formattedAddress) {
            return data.formattedAddress;
        }

        return [
            data.streetAddress,
            data.city,
            data.state,
            data.postalCode,
            data.country,
            data.officeLocation
        ].filter(Boolean).join("\n");
    }

    function buildHierarchy(data) {
        const hierarchy = Array.isArray(data.managerHierarchy) ? data.managerHierarchy : [];

        if (hierarchy.length) {
            return hierarchy
                .map(item => `${item.level}. ${item.displayName || ""} | ${item.mail || item.userPrincipalName || ""}`)
                .join("\n");
        }

        return "";
    }

    function getAllowedApproversText() {
        if (!state.user) {
            return "- Responsável hierárquico não identificado.";
        }

        const approvers = Array.isArray(state.user.allowedApprovers)
            ? state.user.allowedApprovers
            : [];

        if (!approvers.length) {
            return "- Responsável hierárquico não identificado automaticamente.";
        }

        return approvers
            .map(item => `- ${item.displayName || ""} (${item.mail || item.userPrincipalName || ""}) — ${item.role || ""}`)
            .join("\n");
    }

    function getGreeting() {
        const now = new Date();
        const minutes = now.getHours() * 60 + now.getMinutes();

        if (minutes >= 60 && minutes <= 720) {
            return "Bom dia";
        }

        if (minutes >= 721 && minutes <= 1080) {
            return "Boa tarde";
        }

        return "Boa noite";
    }

    function getRequestSource() {
        return valueOf("resetMfaRequestSource") || "ServiceNow";
    }

    function getTeamsReference() {
        return `Teams - ${new Date().toLocaleString()}`;
    }

    function ensureRequestReference() {
        const source = getRequestSource();
        const reference = byId("resetMfaRequestReference");

        if (source === "Teams" && reference && !reference.value.trim()) {
            reference.value = getTeamsReference();
        }

        updateActionState();
    }

    function updateRequestSourceVisual() {
        const source = getRequestSource();
        const label = byId("resetMfaReferenceLabel");
        const input = byId("resetMfaRequestReference");

        const definitions = {
            ServiceNow: {
                label: "Número do ticket / pedido",
                placeholder: "Exemplo: RITM012345678"
            },
            Teams: {
                label: "Referência do pedido no Teams",
                placeholder: "Preenchida automaticamente; pode editar"
            },
            Email: {
                label: "Assunto ou referência do e-mail",
                placeholder: "Exemplo: Reset MFA - Ana Paula"
            },
            Telefone: {
                label: "Referência / descrição breve",
                placeholder: "Exemplo: Chamada recebida às 10:45"
            },
            Outro: {
                label: "Referência / descrição breve",
                placeholder: "Descreva a origem da solicitação"
            }
        };

        const definition = definitions[source] || definitions.ServiceNow;

        if (label) {
            label.textContent = definition.label;
        }

        if (input) {
            input.placeholder = definition.placeholder;
        }

        ensureRequestReference();

        if (state.authorization) {
            clearValidation();
            addLog("Autorização invalidada porque a origem da solicitação foi alterada.");
        }
    }

    function renderApprovedRequesters() {
        const container = byId("resetMfaApprovedList");

        if (!container) {
            return;
        }

        const entries = Array.isArray(state.approvedRequesters)
            ? state.approvedRequesters
            : [];

        if (!entries.length) {
            container.innerHTML = '<div class="reset-mfa-summary reset-mfa-summary-info">Nenhuma pessoa pré-aprovada cadastrada.</div>';
            return;
        }

        container.innerHTML = entries.map(entry => `
            <div class="reset-mfa-approved-item ${entry.active === true ? "" : "reset-mfa-approved-item-inactive"}">
                <div>
                    <div class="reset-mfa-approved-name">
                        ${escapeHtml(entry.displayName || entry.userPrincipalName || "Utilizador")}
                        <span class="reset-mfa-badge ${entry.active === true ? "reset-mfa-badge-success" : "reset-mfa-badge-neutral"}">
                            ${entry.active === true ? "Ativo" : "Inativo"}
                        </span>
                    </div>
                    <div class="reset-mfa-approved-contact">
                        ${escapeHtml(entry.userPrincipalName || entry.mail || "")}
                    </div>
                    <div class="reset-mfa-approved-meta">
                        ${entry.note ? `Observação: ${escapeHtml(entry.note)} | ` : ""}
                        Atualizado por ${escapeHtml(entry.updatedBy || entry.addedBy || "")}
                        ${entry.updatedAt || entry.addedAt ? `em ${escapeHtml(entry.updatedAt || entry.addedAt)}` : ""}
                    </div>
                </div>
                <div class="reset-mfa-approved-actions">
                    <button type="button" class="reset-mfa-btn reset-mfa-btn-small ${entry.active === true ? "reset-mfa-btn-light" : "reset-mfa-btn-green"}"
                        onclick="alternarEstadoPreAprovadoResetMFA('${escapeHtml(entry.id)}', ${entry.active === true ? "false" : "true"})">
                        ${entry.active === true ? "Desativar" : "Ativar"}
                    </button>
                    <button type="button" class="reset-mfa-btn reset-mfa-btn-small reset-mfa-btn-red"
                        onclick="removerPreAprovadoResetMFA('${escapeHtml(entry.id)}')">
                        Remover
                    </button>
                </div>
            </div>
        `).join("");
    }

    async function loadApprovedRequesters() {
        const container = byId("resetMfaApprovedList");

        if (container) {
            container.textContent = "A carregar lista...";
        }

        try {
            const result = await callApi("approved-list");

            if (!result.success || !result.data) {
                throw new Error(result.message || "Não foi possível carregar a lista.");
            }

            state.approvedRequesters = Array.isArray(result.data.requesters)
                ? result.data.requesters
                : [];

            renderApprovedRequesters();
            addLog(`Pré-aprovados carregados: ${state.approvedRequesters.length}.`);
        } catch (error) {
            if (container) {
                container.innerHTML = `<div class="reset-mfa-summary reset-mfa-summary-danger">${escapeHtml(error.message)}</div>`;
            }

            addLog(`Falha ao carregar pré-aprovados: ${error.message}`);
        }
    }

    function toggleApprovedPanel(forceOpen) {
        const panel = byId("resetMfaApprovedPanel");

        if (!panel) {
            return;
        }

        const shouldOpen = typeof forceOpen === "boolean"
            ? forceOpen
            : panel.classList.contains("reset-mfa-hidden");

        panel.classList.toggle("reset-mfa-hidden", !shouldOpen);

        if (shouldOpen) {
            loadApprovedRequesters();
        }
    }

    async function addApprovedRequester() {
        if (state.busy) {
            return;
        }

        const identifier = valueOf("resetMfaApprovedIdentifier");
        const note = valueOf("resetMfaApprovedNote");

        if (!identifier) {
            window.alert("Informe a pessoa que deseja pré-aprovar.");
            return;
        }

        setBusy(true);
        setProgress(20, "A resolver e guardar o pré-aprovado...");
        addLog(`A adicionar ou atualizar pré-aprovado: ${identifier}`);

        try {
            const result = await callApi("approved-add", { identifier, note });

            if (!result.success) {
                throw new Error(result.message || "Não foi possível guardar o pré-aprovado.");
            }

            setValue("resetMfaApprovedIdentifier", "");
            setValue("resetMfaApprovedNote", "");
            await loadApprovedRequesters();
            clearValidation();
            setProgress(100, result.message);
            window.alert(result.message);
        } catch (error) {
            setProgress(0, "Falha ao guardar o pré-aprovado.");
            addLog(`Falha ao guardar pré-aprovado: ${error.message}`);
            window.alert(error.message);
        } finally {
            setBusy(false);
        }
    }

    async function toggleApprovedRequester(id, active) {
        if (state.busy) {
            return;
        }

        setBusy(true);
        setProgress(20, active ? "A ativar pré-aprovado..." : "A desativar pré-aprovado...");

        try {
            const result = await callApi("approved-toggle", {
                id,
                active: active ? "true" : "false"
            });

            if (!result.success) {
                throw new Error(result.message || "Não foi possível alterar o estado.");
            }

            await loadApprovedRequesters();
            clearValidation();
            setProgress(100, result.message);
            addLog(result.message);
        } catch (error) {
            setProgress(0, "Falha ao alterar o pré-aprovado.");
            addLog(`Falha ao alterar pré-aprovado: ${error.message}`);
            window.alert(error.message);
        } finally {
            setBusy(false);
        }
    }

    async function removeApprovedRequester(id) {
        if (state.busy) {
            return;
        }

        const entry = (state.approvedRequesters || []).find(item => item.id === id);
        const displayName = entry
            ? entry.displayName || entry.userPrincipalName || "utilizador"
            : "utilizador";

        if (!window.confirm(`Remover ${displayName} da lista de pré-aprovados?`)) {
            return;
        }

        setBusy(true);
        setProgress(20, "A remover pré-aprovado...");

        try {
            const result = await callApi("approved-remove", { id });

            if (!result.success) {
                throw new Error(result.message || "Não foi possível remover o pré-aprovado.");
            }

            await loadApprovedRequesters();
            clearValidation();
            setProgress(100, result.message);
            addLog(result.message);
        } catch (error) {
            setProgress(0, "Falha ao remover o pré-aprovado.");
            addLog(`Falha ao remover pré-aprovado: ${error.message}`);
            window.alert(error.message);
        } finally {
            setBusy(false);
        }
    }

    function clearValidation() {
        state.authorization = null;
        const field = byId("resetMfaValidationState");

        if (field) {
            field.value = "";
            field.classList.remove(
                "reset-mfa-validation-ok",
                "reset-mfa-validation-warning",
                "reset-mfa-validation-error"
            );
        }

        const info = byId("resetMfaApproverInfo");

        if (info) {
            info.classList.add("reset-mfa-hidden");
            info.textContent = "";
        }

        updateActionState();
    }

    function markSelectionInvalid(reason) {
        if (!state.user) {
            return;
        }

        state.user = null;
        state.searchFingerprint = "";
        state.lastResetResult = null;
        clearValidation();
        clearUserFields(false);

        const notice = byId("resetMfaSelectionNotice");

        if (notice) {
            notice.classList.remove("reset-mfa-hidden");
            notice.textContent = reason || "O texto da pesquisa foi alterado. Pesquise novamente para confirmar o utilizador.";
        }

        addLog("Seleção anterior invalidada porque o campo de pesquisa foi alterado.");
        updateActionState();
    }

    function setAccountBadge(enabled) {
        const badge = byId("resetMfaAccountBadge");

        if (!badge) {
            return;
        }

        badge.classList.remove(
            "reset-mfa-badge-neutral",
            "reset-mfa-badge-success",
            "reset-mfa-badge-danger"
        );

        if (enabled === true) {
            badge.classList.add("reset-mfa-badge-success");
            badge.textContent = "Conta ativa";
        } else if (enabled === false) {
            badge.classList.add("reset-mfa-badge-danger");
            badge.textContent = "Conta desativada";
        } else {
            badge.classList.add("reset-mfa-badge-neutral");
            badge.textContent = "Sem pesquisa";
        }
    }

    function clearUserFields(clearSearchInput = true) {
        [
            "resetMfaNome",
            "resetMfaUpn",
            "resetMfaEmail",
            "resetMfaEmployeeId",
            "resetMfaDepartamento",
            "resetMfaCargo",
            "resetMfaObjectId",
            "resetMfaManager",
            "resetMfaManagerContact",
            "resetMfaAddress",
            "resetMfaManagerHierarchy"
        ].forEach(id => setValue(id, ""));

        if (clearSearchInput) {
            setValue("resetMfaUserInput", "");
        }

        setAccountBadge(null);

        const result = byId("resetMfaMethodsResult");

        if (result) {
            result.textContent = "Nenhum utilizador pesquisado.";
        }
    }

    function renderMethodList(title, methods, emptyText) {
        const safeMethods = Array.isArray(methods) ? methods : [];

        const items = safeMethods.length
            ? safeMethods.map(method => `
                <li>
                    <strong>${escapeHtml(method.name || "Método")}</strong>
                    <span class="reset-mfa-method-reason">${escapeHtml(method.reason || method.type || "")}</span>
                </li>
            `).join("")
            : `<li>${escapeHtml(emptyText)}</li>`;

        return `
            <div class="reset-mfa-method-group">
                <h4>${escapeHtml(title)}</h4>
                <ul class="reset-mfa-method-list">${items}</ul>
            </div>
        `;
    }

    function renderMethods(data, summaryClass = "reset-mfa-summary-info", summaryText = "") {
        const result = byId("resetMfaMethodsResult");

        if (!result) {
            return;
        }

        const methods = Array.isArray(data.methods) ? data.methods : [];
        const removable = methods.filter(method => method.removable === true);
        const password = methods.filter(method => method.category === "Password");
        const protectedSpecial = methods.filter(method =>
            method.protected === true && method.category !== "Password"
        );

        result.innerHTML = `
            <div class="reset-mfa-summary ${summaryClass}">
                ${escapeHtml(summaryText || `Removíveis: ${removable.length} | Protegidos: ${password.length + protectedSpecial.length}`)}
            </div>
            ${renderMethodList("MFA padrão removível", removable, "Nenhum método MFA padrão removível.")}
            ${renderMethodList("Métodos especiais protegidos", protectedSpecial, "Nenhum método especial encontrado.")}
            ${renderMethodList("Password protegida", password, "Password não listada pela API.")}
        `;
    }

    function fillUser(data) {
        setValue("resetMfaNome", data.displayName);
        setValue("resetMfaUpn", data.userPrincipalName);
        setValue("resetMfaEmail", data.mail);
        setValue("resetMfaEmployeeId", data.employeeId);
        setValue("resetMfaDepartamento", data.department);
        setValue("resetMfaCargo", data.jobTitle);
        setValue("resetMfaObjectId", data.id);
        setValue("resetMfaManager", data.managerDisplayName);
        setValue("resetMfaManagerContact", data.managerMail || data.managerUserPrincipalName);
        setValue("resetMfaAddress", buildAddress(data));
        setValue("resetMfaManagerHierarchy", buildHierarchy(data));
        setAccountBadge(data.accountEnabled === true);
        renderMethods(
            data,
            data.removableMethodsCount > 0 ? "reset-mfa-summary-info" : "reset-mfa-summary-warning",
            `MFA removíveis: ${data.removableMethodsCount || 0} | Métodos protegidos: ${data.protectedMethodsCount || 0}`
        );
        updateNoManagerApprovalPanel();
    }

    function hasHierarchyApprover() {
        return Boolean(
            state.user &&
            Array.isArray(state.user.allowedApprovers) &&
            state.user.allowedApprovers.length > 0
        );
    }

    function buildApprovalEmailPreview() {
        if (!state.user) {
            return "";
        }

        return [
            "Solicita-se aprovação para reset MFA.",
            "",
            `Ticket / referência: ${valueOf("resetMfaRequestReference") || "A preencher"}`,
            `Origem: ${getRequestSource()}`,
            `Utilizador: ${state.user.displayName || ""}`,
            `UPN: ${state.user.userPrincipalName || ""}`,
            `Employee ID: ${state.user.employeeId || "Não informado"}`,
            `Departamento: ${state.user.department || "Não informado"}`,
            `Cargo: ${state.user.jobTitle || "Não informado"}`,
            `Métodos MFA removíveis: ${Number(state.user.removableMethodsCount || 0)}`,
            "",
            "O utilizador não possui manager/responsável hierárquico no Microsoft Graph.",
            "Responder a este e-mail com a aprovação ou rejeição do reset MFA."
        ].join("\n");
    }

    function updateNoManagerApprovalPanel() {
        const panel = byId("resetMfaNoManagerApprovalPanel");
        const button = byId("resetMfaBtnSendApprovalEmail");
        const previewButton = byId("resetMfaBtnPreviewApprovalEmail");
        const show = Boolean(state.user && state.user.id && !hasHierarchyApprover());

        if (panel) {
            panel.classList.toggle("reset-mfa-hidden", !show);
        }

        if (!show) {
            return;
        }

        setValue("resetMfaApprovalEmailTo", APPROVAL_RECIPIENTS.join("; "));
        setValue(
            "resetMfaApprovalEmailSubject",
            `[APROVAÇÃO RESET MFA] ${valueOf("resetMfaRequestReference") || "Sem referência"} - ${state.user.displayName || state.user.userPrincipalName || "Utilizador"}`
        );
        setValue("resetMfaApprovalEmailPreview", buildApprovalEmailPreview());

        if (button) {
            button.disabled = state.busy || !state.graphReady || !valueOf("resetMfaRequestReference");
        }
        if (previewButton) {
            previewButton.disabled = state.busy || !state.graphReady || !valueOf("resetMfaRequestReference");
        }
    }

    function closeApprovalEmailPreview() {
        const modal = byId("resetMfaEmailPreviewModal");
        const frame = byId("resetMfaEmailPreviewFrame");
        if (modal) {
            modal.classList.add("reset-mfa-hidden");
        }
        if (frame) {
            frame.srcdoc = "";
        }
    }

    async function previewApprovalEmail() {
        if (state.busy || !state.user || hasHierarchyApprover()) {
            return;
        }

        ensureRequestReference();
        const reference = valueOf("resetMfaRequestReference");
        if (!reference) {
            window.alert("Informe o número do ticket ou referência antes de pré-visualizar o e-mail.");
            return;
        }

        setBusy(true);
        setProgress(20, "A preparar a pré-visualização do e-mail...");
        try {
            const result = await callApi("preview-approval-email", {
                userId: state.user.id,
                expectedUpn: state.user.userPrincipalName,
                source: getRequestSource(),
                reference
            });
            if (!result.success || !result.data || !result.data.html) {
                throw new Error(result.message || "Não foi possível preparar a pré-visualização.");
            }

            const modal = byId("resetMfaEmailPreviewModal");
            const frame = byId("resetMfaEmailPreviewFrame");
            setText("resetMfaEmailPreviewTo", (result.data.recipients || []).join("; "));
            setText("resetMfaEmailPreviewSubject", result.data.subject || "");
            if (frame) {
                frame.srcdoc = result.data.html;
            }
            if (modal) {
                modal.classList.remove("reset-mfa-hidden");
            }
            setProgress(100, "Pré-visualização preparada. Nenhum e-mail foi enviado.");
            addLog("Pré-visualização do pedido de aprovação aberta; nenhum e-mail enviado.");
        } catch (error) {
            setProgress(0, "Falha ao preparar a pré-visualização.");
            addLog(`Falha na pré-visualização do e-mail: ${error.message}`);
            window.alert(error.message);
        } finally {
            setBusy(false);
        }
    }

    async function sendApprovalEmail() {
        if (state.busy || !state.user || hasHierarchyApprover()) {
            return;
        }

        ensureRequestReference();
        const reference = valueOf("resetMfaRequestReference");

        if (!reference) {
            window.alert("Informe o número do ticket ou referência antes de enviar o pedido de aprovação.");
            return;
        }

        if (!window.confirm(`Enviar o pedido de aprovação para:\n\n${APPROVAL_RECIPIENTS.join("\n")}?`)) {
            return;
        }

        const status = byId("resetMfaApprovalEmailStatus");
        setBusy(true);
        setProgress(20, "A preparar e enviar o pedido de aprovação pelo Outlook...");
        if (status) {
            status.className = "reset-mfa-approval-email-status";
            status.textContent = "A preparar e enviar pelo Outlook clássico...";
        }

        try {
            const result = await callApi("send-approval-email", {
                userId: state.user.id,
                expectedUpn: state.user.userPrincipalName,
                source: getRequestSource(),
                reference
            });
            if (!result.success) {
                throw new Error(result.message || "Não foi possível enviar o pedido de aprovação.");
            }

            const data = result.data || {};
            if (status) {
                status.className = "reset-mfa-approval-email-status reset-mfa-approval-email-status-success";
                status.textContent = `Pedido enviado em ${formatDateTime(data.sentAt)}. Aguarde a resposta e valide como solicitante a pessoa que aprovou.`;
            }
            setProgress(100, "Pedido de aprovação enviado com sucesso.");
            addLog(`Pedido de aprovação enviado para ${APPROVAL_RECIPIENTS.join(", ")}.`);
            closeApprovalEmailPreview();
            window.alert("Pedido de aprovação enviado. Aguarde a resposta ao e-mail antes de validar e executar o reset.");
        } catch (error) {
            if (status) {
                status.className = "reset-mfa-approval-email-status reset-mfa-approval-email-status-error";
                status.textContent = `Erro: ${error.message}`;
            }
            setProgress(0, "Falha no envio do pedido de aprovação.");
            addLog(`Falha ao enviar pedido de aprovação: ${error.message}`);
            window.alert(error.message);
        } finally {
            setBusy(false);
            updateNoManagerApprovalPanel();
        }
    }

    function updateActionState() {
        const search = byId("resetMfaBtnSearch");
        const validateRequesterButton = byId("resetMfaBtnValidateRequester");
        const addApprovedButton = byId("resetMfaBtnAddApproved");
        const prevalidate = byId("resetMfaBtnPrevalidate");
        const reset = byId("resetMfaBtnReset");
        const removableCount = state.user ? Number(state.user.removableMethodsCount || 0) : 0;
        const hasUser = Boolean(state.user && state.user.id);
        const accountEnabled = Boolean(state.user && state.user.accountEnabled === true);
        const authorized = Boolean(state.authorization && state.authorization.allowed === true);
        const hasReference = Boolean(valueOf("resetMfaRequestReference"));

        if (search) {
            search.disabled = state.busy || !state.graphReady;
        }

        if (validateRequesterButton) {
            validateRequesterButton.disabled = state.busy || !state.graphReady || !hasUser;
        }

        if (addApprovedButton) {
            addApprovedButton.disabled = state.busy || !state.graphReady;
        }

        if (prevalidate) {
            prevalidate.disabled = state.busy || !state.graphReady || !hasUser;
        }

        if (reset) {
            reset.disabled =
                state.busy ||
                !state.graphReady ||
                !hasUser ||
                !accountEnabled ||
                removableCount < 1 ||
                !authorized ||
                !hasReference;
        }
        updateNoManagerApprovalPanel();
    }

    async function verifyGraphSession() {
        updateGraphStatus(false, false, "Verificando sessão Microsoft Graph...");
        addLog("Verificando sessão Microsoft Graph.");

        try {
            const result = await callApi("status");
            const data = result.data || {};

            if (data.connected && data.ready) {
                updateGraphStatus(true, true, `Conectado: ${data.account || "conta Graph"}`);
                addLog(`Microsoft Graph pronto: ${data.account || "conta não informada"}.`);
            } else if (data.connected) {
                updateGraphStatus(true, false, `Conectado, mas faltam permissões: ${(data.missingScopes || []).join(", ")}`);
                addLog("Sessão Graph encontrada, mas sem todos os scopes necessários.");
            } else {
                updateGraphStatus(false, false, "Microsoft Graph não conectado.");
                addLog("Microsoft Graph não conectado.");
            }
        } catch (error) {
            updateGraphStatus(false, false, "Falha ao verificar Microsoft Graph.");
            addLog(`Falha ao verificar Graph: ${error.message}`);
        }
    }

    async function connectGraph() {
        if (state.busy) {
            return;
        }

        setBusy(true);
        setProgress(15, "A conectar ao Microsoft Graph...");
        addLog("Pedido de conexão ao Microsoft Graph iniciado.");

        try {
            const result = await callApi("connect");
            const data = result.data || {};

            if (!result.success || !data.ready) {
                throw new Error(result.message || "Não foi possível preparar a sessão Graph.");
            }

            updateGraphStatus(true, true, `Conectado: ${data.account || "conta Graph"}`);
            setProgress(100, "Microsoft Graph conectado e pronto.");
            addLog(`Microsoft Graph conectado com sucesso: ${data.account || ""}.`);
        } catch (error) {
            updateGraphStatus(false, false, "Falha ao conectar Microsoft Graph.");
            setProgress(0, "Falha na conexão com o Microsoft Graph.");
            addLog(`Falha Graph: ${error.message}`);
            window.alert(error.message);
        } finally {
            setBusy(false);
        }
    }

    async function searchUser() {
        if (state.busy) {
            return;
        }

        const identifier = valueOf("resetMfaUserInput");

        if (!identifier) {
            window.alert("Informe um utilizador.");
            return;
        }

        state.user = null;
        state.lastResetResult = null;
        state.searchFingerprint = "";
        clearValidation();
        clearUserFields(false);

        const notice = byId("resetMfaSelectionNotice");

        if (notice) {
            notice.classList.add("reset-mfa-hidden");
            notice.textContent = "";
        }

        setBusy(true);
        setProgress(15, "A pesquisar o utilizador no Microsoft Graph...");
        addLog(`Pesquisa iniciada para: ${identifier}`);

        const resultBox = byId("resetMfaMethodsResult");

        if (resultBox) {
            resultBox.innerHTML = '<div class="reset-mfa-summary reset-mfa-summary-info">A pesquisar utilizador...</div>';
        }

        try {
            const result = await callApi("search", { user: identifier });

            if (!result.success || !result.data) {
                throw new Error(result.message || "Utilizador não encontrado.");
            }

            state.user = result.data;
            state.searchFingerprint = identifier.toLowerCase();
            fillUser(result.data);
            setProgress(100, "Utilizador pesquisado e identidade confirmada.");
            addLog(`Utilizador confirmado: ${result.data.displayName} <${result.data.userPrincipalName}>.`);
            addLog(`Object ID: ${result.data.id}`);
            addLog(`Métodos MFA padrão removíveis: ${result.data.removableMethodsCount || 0}.`);

            if (result.data.accountEnabled !== true) {
                addLog("ATENÇÃO: conta desativada. O reset permanecerá bloqueado.");
            }
        } catch (error) {
            state.user = null;
            clearUserFields(false);

            if (resultBox) {
                resultBox.innerHTML = `<div class="reset-mfa-summary reset-mfa-summary-danger">${escapeHtml(error.message)}</div>`;
            }

            setProgress(0, "Pesquisa não concluída.");
            addLog(`Falha na pesquisa: ${error.message}`);
            window.alert(error.message);
        } finally {
            setBusy(false);
            updateActionState();
        }
    }

    function clearUser() {
        state.user = null;
        state.authorization = null;
        state.searchFingerprint = "";
        state.lastResetResult = null;
        clearUserFields(true);
        clearValidation();
        const notice = byId("resetMfaSelectionNotice");

        if (notice) {
            notice.classList.add("reset-mfa-hidden");
            notice.textContent = "";
        }

        setProgress(0, "Aguardando operação.");
        addLog("Dados do utilizador limpos.");
    }

    function setValidationVisual(validation) {
        const field = byId("resetMfaValidationState");
        const info = byId("resetMfaApproverInfo");

        if (!field) {
            return;
        }

        field.classList.remove(
            "reset-mfa-validation-ok",
            "reset-mfa-validation-warning",
            "reset-mfa-validation-error"
        );

        if (validation && validation.allowed === true) {
            field.classList.add("reset-mfa-validation-ok");
        } else if (validation && validation.state === "ThirdParty") {
            field.classList.add("reset-mfa-validation-warning");
        } else {
            field.classList.add("reset-mfa-validation-error");
        }

        field.value = validation ? validation.message || validation.state || "" : "";

        if (info && validation) {
            const requester = validation.requester || {};
            const approvers = Array.isArray(validation.approvers) ? validation.approvers : [];
            const approvedEntry = validation.approvedEntry || null;

            info.classList.remove("reset-mfa-hidden");
            info.innerHTML = `
                <strong>Solicitante resolvido:</strong>
                ${escapeHtml(requester.displayName || "Não identificado")}
                ${requester.userPrincipalName ? `&lt;${escapeHtml(requester.userPrincipalName)}&gt;` : ""}
                <br>
                <strong>Origem:</strong> ${escapeHtml(validation.requestSource || getRequestSource())}
                |
                <strong>Referência:</strong> ${escapeHtml(validation.requestReference || valueOf("resetMfaRequestReference"))}
                <br>
                <strong>Regra aplicada:</strong> ${escapeHtml(validation.authorizationRule || validation.matchedRole || "Sem autorização automática")}
                ${approvedEntry && approvedEntry.note ? `<br><strong>Observação do pré-aprovado:</strong> ${escapeHtml(approvedEntry.note)}` : ""}
                <br>
                <strong>Aprovadores hierárquicos:</strong>
                ${approvers.length
                    ? approvers.map(item => `${escapeHtml(item.displayName || "")} (${escapeHtml(item.role || "")})`).join(" | ")
                    : "Nenhum identificado"}
            `;
        }
    }

    async function validateRequester() {
        if (state.busy) {
            return false;
        }

        if (!state.user || !state.user.id) {
            window.alert("Pesquise primeiro o utilizador alvo.");
            return false;
        }

        ensureRequestReference();

        const requester = valueOf("resetMfaRequester");
        const reference = valueOf("resetMfaRequestReference");

        if (!requester) {
            window.alert("Informe a pessoa que solicitou o reset.");
            return false;
        }

        if (!reference) {
            window.alert("Informe a referência da solicitação.");
            return false;
        }

        setBusy(true);
        setProgress(20, "A validar solicitante, hierarquia e lista de pré-aprovados...");
        addLog(`Validação do solicitante iniciada: ${requester}`);

        try {
            const result = await callApi("validate-requester", {
                userId: state.user.id,
                expectedUpn: state.user.userPrincipalName,
                requester,
                source: getRequestSource(),
                reference
            });

            if (!result.data) {
                throw new Error(result.message || "Não foi possível validar o solicitante.");
            }

            state.authorization = result.data;
            setValue("resetMfaRequestReference", result.data.requestReference || reference);
            setValidationVisual(result.data);
            setProgress(
                100,
                result.data.allowed
                    ? "Autorização validada."
                    : "Solicitante identificado, mas sem autorização automática."
            );
            addLog(`Resultado da autorização: ${result.data.state} — ${result.data.message}`);
            addLog(`Regra aplicada: ${result.data.authorizationRule || "não autorizada"}.`);
            generateTicketResponse();
            return result.data.allowed === true;
        } catch (error) {
            state.authorization = null;
            setValidationVisual({
                allowed: false,
                state: "Error",
                message: error.message,
                requester: null,
                approvers: [],
                requestSource: getRequestSource(),
                requestReference: reference
            });
            setProgress(0, "Falha na validação do solicitante.");
            addLog(`Falha na validação: ${error.message}`);
            window.alert(error.message);
            return false;
        } finally {
            setBusy(false);
            updateActionState();
        }
    }

    function generateTicketResponse() {
        if (!state.user) {
            window.alert("Pesquise primeiro um utilizador.");
            return;
        }

        ensureRequestReference();

        const greeting = getGreeting();
        const signature = state.signature || valueOf("resetMfaSignature") || "Suporte";
        const requestSource = getRequestSource();
        const requestReference = valueOf("resetMfaRequestReference") || "não informada";
        const approvers = getAllowedApproversText();
        const authorization = state.authorization;
        const lastResult = state.lastResetResult;
        let text = "";

        if (lastResult) {
            const status = lastResult.operationStatus;
            const removedNames = (lastResult.removed || []).map(item => `- ${item.name}`).join("\n") || "- Nenhum";
            const failedNames = (lastResult.failed || []).map(item => `- ${item.name}: ${item.error}`).join("\n") || "- Nenhuma";
            const resultSource = lastResult.requestSource || requestSource;
            const resultReference = lastResult.requestReference || requestReference;
            const requesterName = lastResult.authorization && lastResult.authorization.requester
                ? lastResult.authorization.requester.displayName
                : (authorization && authorization.requester ? authorization.requester.displayName : "");
            const rule = lastResult.authorization
                ? lastResult.authorization.authorizationRule || lastResult.authorization.matchedRole || ""
                : (authorization ? authorization.authorizationRule || authorization.matchedRole || "" : "");

            if (status === "Success") {
                text = `${greeting}, Colega,

Informamos que o reset dos métodos MFA padrão do utilizador ${state.user.displayName} (${state.user.userPrincipalName}) foi concluído e confirmado.

Origem do pedido: ${resultSource}
Referência: ${resultReference}
Solicitante: ${requesterName}
Regra de autorização: ${rule}

Métodos removidos:
${removedNames}

O utilizador deverá registar novamente o Microsoft Authenticator ou outro método MFA permitido no próximo acesso.

Métodos especiais protegidos, como FIDO2, Windows Hello for Business, Temporary Access Pass, email e password, não foram removidos.

Atenciosamente,
${signature}`;
            } else if (status === "NoMethods") {
                text = `${greeting}, Colega,

Após validação do utilizador ${state.user.displayName} (${state.user.userPrincipalName}), não foram encontrados métodos MFA padrão removíveis.

Origem do pedido: ${resultSource}
Referência: ${resultReference}
Solicitante: ${requesterName}
Regra de autorização: ${rule}

Os métodos especiais protegidos permaneceram inalterados.

Atenciosamente,
${signature}`;
            } else {
                text = `${greeting}, Colega,

O reset MFA do utilizador ${state.user.displayName} (${state.user.userPrincipalName}) não foi totalmente confirmado.

Origem do pedido: ${resultSource}
Referência: ${resultReference}
Solicitante: ${requesterName}
Regra de autorização: ${rule}
Estado: ${status}

Métodos removidos:
${removedNames}

Falhas:
${failedNames}

É necessária validação técnica adicional antes do encerramento da solicitação.

Atenciosamente,
${signature}`;
            }
        } else if (authorization && authorization.allowed === true) {
            text = `${greeting}, Colega,

Agradecemos a solicitação.

Após validação do utilizador ${state.user.displayName}, confirmámos que a pessoa que pediu o reset está autorizada.

Origem do pedido: ${requestSource}
Referência: ${requestReference}
Solicitante validado: ${authorization.requester ? authorization.requester.displayName : ""}
Regra de autorização: ${authorization.authorizationRule || authorization.matchedRole || ""}

A solicitação encontra-se autorizada para pré-validação e execução do reset MFA padrão.

Atenciosamente,
${signature}`;
        } else {
            text = `${greeting}, Colega,

Agradecemos a solicitação.

Para prosseguir com o reset MFA do utilizador ${state.user.displayName} (${state.user.userPrincipalName}), é necessária autorização do manager direto, do segundo nível hierárquico ou de uma pessoa ativa na lista interna de pré-aprovados.

Origem do pedido: ${requestSource}
Referência: ${requestReference}

Responsáveis hierárquicos elegíveis:
${approvers}

Link direto para abertura do pedido no ServiceNow:
${SERVICE_NOW_URL}

Atenciosamente,
${signature}`;
        }

        setValue("resetMfaResponseText", text);
        addLog("Resposta da solicitação gerada.");
    }

    async function prevalidateReset() {
        if (state.busy) {
            return;
        }

        if (!state.user || !state.user.id) {
            window.alert("Pesquise primeiro um utilizador.");
            return;
        }

        setBusy(true);
        setProgress(20, "A confirmar a identidade e consultar os métodos atuais...");
        addLog("Pré-validação iniciada sem alterações.");

        try {
            const result = await callApi("test", {
                userId: state.user.id,
                expectedUpn: state.user.userPrincipalName
            });

            if (!result.success || !result.data) {
                throw new Error(result.message || "Pré-validação não concluída.");
            }

            const data = result.data;
            state.user.methods = data.methods || [];
            state.user.removableMethodsCount = data.removableMethodsCount || 0;
            state.user.protectedMethodsCount = data.protectedMethodsCount || 0;
            state.user.accountEnabled = data.accountEnabled === true;

            renderMethods(
                state.user,
                data.removableMethodsCount > 0 ? "reset-mfa-summary-info" : "reset-mfa-summary-warning",
                `Pré-validação: ${data.removableMethodsCount || 0} método(s) MFA padrão removível(is).`
            );

            setAccountBadge(data.accountEnabled === true);
            setProgress(100, "Pré-validação concluída sem alterar o utilizador.");
            addLog(`Conta: ${data.accountEnabled ? "ativa" : "desativada"}.`);
            addLog(`Métodos removíveis: ${data.removableMethodsCount || 0}.`);
            addLog(`Métodos protegidos: ${data.protectedMethodsCount || 0}.`);
            window.alert("Pré-validação concluída. Nenhum método foi alterado.");
        } catch (error) {
            setProgress(0, "Falha na pré-validação.");
            addLog(`Erro na pré-validação: ${error.message}`);
            window.alert(error.message);
        } finally {
            setBusy(false);
            updateActionState();
        }
    }

    function buildResetConfirmation() {
        const removable = (state.user.methods || []).filter(method => method.removable === true);
        const methodsText = removable.length
            ? removable.map(method => `- ${method.name}`).join("\n")
            : "- Nenhum";

        return [
            "CONFIRMA O RESET MFA PADRÃO?",
            "",
            `Utilizador: ${state.user.displayName}`,
            `UPN: ${state.user.userPrincipalName}`,
            `Object ID: ${state.user.id}`,
            `Origem: ${getRequestSource()}`,
            `Referência: ${valueOf("resetMfaRequestReference")}`,
            `Solicitante: ${state.authorization && state.authorization.requester ? state.authorization.requester.displayName : ""}`,
            `Autorização: ${state.authorization ? state.authorization.authorizationRule || state.authorization.matchedRole || state.authorization.state : ""}`,
            "",
            "Métodos que serão removidos:",
            methodsText,
            "",
            "Password e métodos especiais permanecerão protegidos."
        ].join("\n");
    }

    function renderResetResult(data, message) {
        const box = byId("resetMfaMethodsResult");

        if (!box) {
            return;
        }

        let summaryClass = "reset-mfa-summary-danger";

        if (data.operationStatus === "Success") {
            summaryClass = "reset-mfa-summary-success";
        } else if (data.operationStatus === "NoMethods") {
            summaryClass = "reset-mfa-summary-info";
        } else if (data.operationStatus === "Partial" || data.operationStatus === "PendingVerification") {
            summaryClass = "reset-mfa-summary-warning";
        }

        const removed = Array.isArray(data.removed) ? data.removed : [];
        const failed = Array.isArray(data.failed) ? data.failed : [];
        const remaining = Array.isArray(data.remaining) ? data.remaining : [];
        const protectedMethods = Array.isArray(data.finalMethods)
            ? data.finalMethods.filter(method => method.protected === true)
            : (state.user.methods || []).filter(method => method.protected === true);

        box.innerHTML = `
            <div class="reset-mfa-summary ${summaryClass}">
                ${escapeHtml(message || data.operationStatus || "Resultado da operação")}
            </div>
            <div class="reset-mfa-method-group">
                <h4>Execução</h4>
                <ul class="reset-mfa-method-list">
                    <li><strong>Data/hora:</strong> ${escapeHtml(formatDateTime(data.timestamp))}</li>
                    <li><strong>Origem:</strong> ${escapeHtml(data.requestSource || getRequestSource())}</li>
                    <li><strong>Referência:</strong> ${escapeHtml(data.requestReference || data.ticket || "")}</li>
                    <li><strong>Removidos:</strong> ${escapeHtml(data.removedCount || 0)}</li>
                    <li><strong>Falhas:</strong> ${escapeHtml(data.failedCount || 0)}</li>
                    <li><strong>Restantes:</strong> ${escapeHtml(data.remainingMethods || 0)}</li>
                    <li><strong>Verificação final:</strong> ${data.verified ? "Confirmada" : "Não confirmada"}</li>
                </ul>
            </div>
            ${renderMethodList("Métodos removidos", removed, "Nenhum método removido.")}
            ${renderMethodList("Métodos ainda restantes", remaining, "Nenhum método MFA padrão restante.")}
            ${renderMethodList(
                "Falhas",
                failed.map(item => ({
                    name: item.name,
                    reason: item.error
                })),
                "Nenhuma falha."
            )}
            ${renderMethodList("Métodos protegidos preservados", protectedMethods, "Nenhum método protegido listado.")}
        `;
    }

    async function resetMfa() {
        if (state.busy) {
            return;
        }

        if (!state.user || !state.user.id) {
            window.alert("Pesquise primeiro um utilizador.");
            return;
        }

        if (!state.authorization || state.authorization.allowed !== true) {
            window.alert("Valide primeiro um solicitante autorizado.");
            return;
        }

        ensureRequestReference();

        const requestSource = getRequestSource();
        const requestReference = valueOf("resetMfaRequestReference");

        if (!requestReference) {
            window.alert("Informe a referência da solicitação.");
            return;
        }

        if (state.user.accountEnabled !== true) {
            window.alert("A conta está desativada. O reset foi bloqueado.");
            return;
        }

        if (!window.confirm(buildResetConfirmation())) {
            addLog("Reset MFA cancelado pelo operador.");
            return;
        }

        setBusy(true);
        setProgress(15, "A validar identidade, referência e autorização...");
        addLog("============================================================");
        addLog(`RESET MFA iniciado para ${state.user.userPrincipalName}.`);
        addLog(`Origem: ${requestSource}`);
        addLog(`Referência: ${requestReference}`);
        addLog(`Object ID confirmado: ${state.user.id}`);

        try {
            window.setTimeout(() => {
                if (state.busy) {
                    setProgress(40, "A remover os métodos MFA padrão...");
                }
            }, 700);

            window.setTimeout(() => {
                if (state.busy) {
                    setProgress(72, "A aguardar propagação e validar os métodos restantes...");
                }
            }, 2500);

            const result = await callApi("reset", {
                userId: state.user.id,
                expectedUpn: state.user.userPrincipalName,
                requester: state.authorization.requester.userPrincipalName || state.authorization.requester.mail,
                source: requestSource,
                reference: requestReference
            }, 180000);

            if (!result.data) {
                throw new Error(result.message || "A API não devolveu o resultado da execução.");
            }

            state.lastResetResult = result.data;

            if (Array.isArray(result.data.finalMethods)) {
                state.user.methods = result.data.finalMethods;
                state.user.removableMethodsCount = result.data.finalMethods.filter(method => method.removable === true).length;
                state.user.protectedMethodsCount = result.data.finalMethods.filter(method => method.protected === true).length;
            }

            renderResetResult(result.data, result.message);

            if (result.data.operationStatus === "Success" || result.data.operationStatus === "NoMethods") {
                setProgress(100, result.message);
            } else {
                setProgress(100, `Operação concluída com estado: ${result.data.operationStatus}.`);
            }

            addLog(`Estado final: ${result.data.operationStatus}.`);
            addLog(`Métodos removidos: ${result.data.removedCount}.`);
            addLog(`Falhas: ${result.data.failedCount}.`);
            addLog(`Métodos restantes: ${result.data.remainingMethods}.`);
            addLog(`Verificação final: ${result.data.verified ? "confirmada" : "não confirmada"}.`);
            addLog("============================================================");

            generateTicketResponse();

            if (!result.success) {
                window.alert(result.message || "O reset não foi totalmente concluído.");
            } else {
                window.alert(result.message || "Reset MFA concluído.");
            }
        } catch (error) {
            setProgress(0, "Falha na execução do reset MFA.");
            addLog(`Erro no reset MFA: ${error.message}`);

            const box = byId("resetMfaMethodsResult");

            if (box) {
                box.innerHTML = `<div class="reset-mfa-summary reset-mfa-summary-danger">${escapeHtml(error.message)}</div>`;
            }

            window.alert(error.message);
        } finally {
            setBusy(false);
            updateActionState();
        }
    }

    async function copyText(text, successMessage) {
        if (!text || !text.trim()) {
            window.alert("Não existe conteúdo para copiar.");
            return false;
        }

        try {
            await navigator.clipboard.writeText(text);
            addLog(successMessage);
            return true;
        } catch (error) {
            const temporary = document.createElement("textarea");
            temporary.value = text;
            temporary.setAttribute("readonly", "");
            temporary.style.position = "fixed";
            temporary.style.opacity = "0";
            document.body.appendChild(temporary);
            temporary.select();

            const copied = document.execCommand("copy");
            document.body.removeChild(temporary);

            if (!copied) {
                throw error;
            }

            addLog(successMessage);
            return true;
        }
    }

    async function copyMethods() {
        if (!state.user) {
            window.alert("Pesquise primeiro um utilizador.");
            return;
        }

        const methods = Array.isArray(state.user.methods) ? state.user.methods : [];
        const removable = methods.filter(method => method.removable === true);
        const protectedMethods = methods.filter(method => method.protected === true);

        const text = [
            `Utilizador: ${state.user.displayName || ""}`,
            `UPN: ${state.user.userPrincipalName || ""}`,
            `Object ID: ${state.user.id || ""}`,
            "",
            "Métodos MFA padrão removíveis:",
            ...(removable.length
                ? removable.map(method => `- ${method.name} | ${method.type}`)
                : ["- Nenhum"]),
            "",
            "Métodos protegidos:",
            ...(protectedMethods.length
                ? protectedMethods.map(method => `- ${method.name} | ${method.type}`)
                : ["- Nenhum"])
        ].join("\n");

        await copyText(text, "Métodos de autenticação copiados.");
    }

    async function copyResponse() {
        await copyText(valueOf("resetMfaResponseText"), "Resposta copiada para a área de transferência.");
    }

    function getOperationStatusText(status) {
        const labels = {
            Success: "Concluído e confirmado",
            Partial: "Concluído parcialmente",
            PendingVerification: "Pendente de confirmação final",
            NoMethods: "Nenhum método MFA padrão removível",
            Failed: "Falha na execução"
        };

        return labels[status] || status || "Ainda não executado";
    }

    function buildServiceNowText() {
        if (!state.user) {
            return "";
        }

        ensureRequestReference();

        const result = state.lastResetResult || null;
        const authorization = result && result.authorization
            ? result.authorization
            : state.authorization;

        const requester = authorization && authorization.requester
            ? authorization.requester
            : null;

        const source = result && result.requestSource
            ? result.requestSource
            : getRequestSource();

        const reference = result && result.requestReference
            ? result.requestReference
            : valueOf("resetMfaRequestReference");

        const rule = authorization
            ? authorization.authorizationRule || authorization.matchedRole || authorization.state || ""
            : "Não validada";

        const operator = result && result.operator
            ? result.operator.fullName || result.operator.windowsUser || state.signature
            : state.signature || valueOf("resetMfaSignature") || "Suporte";

        const methods = Array.isArray(state.user.methods)
            ? state.user.methods
            : [];

        const removableCurrent = methods.filter(method => method.removable === true);
        const protectedCurrent = methods.filter(method => method.protected === true);

        const removed = result && Array.isArray(result.removed)
            ? result.removed
            : [];

        const failed = result && Array.isArray(result.failed)
            ? result.failed
            : [];

        const remaining = result && Array.isArray(result.remaining)
            ? result.remaining
            : removableCurrent;

        const protectedPreserved = result && Array.isArray(result.finalMethods)
            ? result.finalMethods.filter(method => method.protected === true)
            : protectedCurrent;

        const responseText = valueOf("resetMfaResponseText");

        const formatMethods = (items, emptyText) => {
            if (!items || !items.length) {
                return `- ${emptyText}`;
            }

            return items.map(item => {
                const detail = item.error || item.reason || item.type || "";
                return `- ${item.name || "Método"}${detail ? ` | ${detail}` : ""}`;
            }).join("\n");
        };

        const status = result
            ? getOperationStatusText(result.operationStatus)
            : authorization && authorization.allowed === true
                ? "Autorizado — aguardando execução"
                : "Aguardando validação da autorização";

        const executionDate = result && result.timestamp
            ? formatDateTime(result.timestamp)
            : "Ainda não executado";

        const accountState = state.user.accountEnabled === true
            ? "Ativa"
            : "Desativada";

        return [
            "SHORT DESCRIPTION",
            `Reset MFA - ${state.user.displayName || ""} - ${state.user.userPrincipalName || ""}`,
            "",
            "DADOS DA SOLICITAÇÃO",
            `Origem: ${source || ""}`,
            `Referência: ${reference || ""}`,
            `Solicitante: ${requester ? requester.displayName || "" : valueOf("resetMfaRequester")}`,
            `UPN do solicitante: ${requester ? requester.userPrincipalName || requester.mail || "" : valueOf("resetMfaRequester")}`,
            `Object ID do solicitante: ${requester ? requester.id || "" : ""}`,
            `Regra de autorização: ${rule}`,
            "",
            "UTILIZADOR ALVO",
            `Nome: ${state.user.displayName || ""}`,
            `UPN: ${state.user.userPrincipalName || ""}`,
            `Email: ${state.user.mail || ""}`,
            `Employee ID: ${state.user.employeeId || ""}`,
            `Departamento: ${state.user.department || ""}`,
            `Cargo: ${state.user.jobTitle || ""}`,
            `Object ID: ${state.user.id || ""}`,
            `Estado da conta: ${accountState}`,
            `Manager direto: ${state.user.managerDisplayName || ""}`,
            `Contacto do manager: ${state.user.managerMail || state.user.managerUserPrincipalName || ""}`,
            "",
            "RESULTADO DA OPERAÇÃO",
            `Estado: ${status}`,
            `Data/hora da execução: ${executionDate}`,
            `Operador: ${operator || ""}`,
            `Métodos removidos: ${result ? Number(result.removedCount || 0) : 0}`,
            `Falhas: ${result ? Number(result.failedCount || 0) : 0}`,
            `Métodos MFA restantes: ${result ? Number(result.remainingMethods || 0) : remaining.length}`,
            `Verificação final: ${result ? (result.verified ? "Confirmada" : "Não confirmada") : "Não executada"}`,
            "",
            "MÉTODOS REMOVIDOS",
            formatMethods(removed, "Nenhum método removido ou operação ainda não executada."),
            "",
            "MÉTODOS MFA AINDA REMOVÍVEIS / RESTANTES",
            formatMethods(remaining, "Nenhum método MFA padrão restante."),
            "",
            "FALHAS",
            formatMethods(failed, "Nenhuma falha."),
            "",
            "MÉTODOS PROTEGIDOS PRESERVADOS",
            formatMethods(protectedPreserved, "Nenhum método protegido listado."),
            "",
            "RESPOSTA / WORK NOTES",
            responseText || "Resposta ainda não gerada."
        ].join("\n");
    }

    async function openServiceNow() {
        if (!state.user) {
            window.alert("Pesquise primeiro o utilizador antes de abrir o ServiceNow.");
            return;
        }

        ensureRequestReference();

        if (!valueOf("resetMfaRequestReference")) {
            window.alert("Informe a referência da solicitação antes de abrir o ServiceNow.");
            return;
        }

        if (!valueOf("resetMfaResponseText")) {
            generateTicketResponse();
        }

        const serviceNowText = buildServiceNowText();

        // A abertura é feita imediatamente para não ser bloqueada pelo navegador.
        window.open(SERVICE_NOW_URL, "_blank", "noopener,noreferrer");

        try {
            const copied = await copyText(
                serviceNowText,
                "Resumo completo copiado para colar no ServiceNow."
            );

            if (copied) {
                addLog("ServiceNow aberto com os dados completos preparados.");
                window.alert(
                    "ServiceNow aberto.\n\n" +
                    "Os dados completos da solicitação e da execução foram copiados " +
                    "para a área de transferência. Cole no campo Description ou Work Notes."
                );
            }
        } catch (error) {
            addLog(`ServiceNow aberto, mas não foi possível copiar os dados: ${error.message}`);
            window.alert(
                "O ServiceNow foi aberto, mas não foi possível copiar os dados automaticamente.\n\n" +
                "Utilize o botão Copiar resposta ou tente novamente."
            );
        }
    }

    function clearAll() {
        state.user = null;
        state.authorization = null;
        state.searchFingerprint = "";
        state.lastResetResult = null;
        clearUserFields(true);
        clearValidation();
        setValue("resetMfaRequestSource", "ServiceNow");
        setValue("resetMfaRequestReference", "");
        setValue("resetMfaRequester", "");
        updateRequestSourceVisual();
        setValue("resetMfaSignature", state.signature || "");
        setValue("resetMfaResponseText", "");
        setText("resetMfaLogs", "Aguardando operação...");
        setProgress(0, "Aguardando operação.");

        const notice = byId("resetMfaSelectionNotice");

        if (notice) {
            notice.classList.add("reset-mfa-hidden");
            notice.textContent = "";
        }

        addLog("Todos os campos foram limpos.");
    }

    async function loadWindowsSignature() {
        try {
            const result = await callApi("windowsUser");

            if (result.success && result.data) {
                state.signature = result.data.fullName || result.data.username || "Suporte";
                setValue("resetMfaSignature", state.signature);
                setText(
                    "resetMfaWindowsInfo",
                    `${result.data.fullName || result.data.username || "Suporte"} (${result.data.windowsUser || ""})`
                );
                addLog(`Assinatura automática carregada: ${state.signature}.`);
            }
        } catch (error) {
            state.signature = "Suporte";
            setValue("resetMfaSignature", state.signature);
            setText("resetMfaWindowsInfo", "Não foi possível identificar o utilizador Windows.");
            addLog(`Falha ao carregar assinatura Windows: ${error.message}`);
        }
    }

    function bindEvents() {
        const searchInput = byId("resetMfaUserInput");
        const requesterInput = byId("resetMfaRequester");
        const sourceInput = byId("resetMfaRequestSource");
        const referenceInput = byId("resetMfaRequestReference");
        const approvedIdentifier = byId("resetMfaApprovedIdentifier");

        if (searchInput && !searchInput.dataset.resetMfaBound) {
            searchInput.dataset.resetMfaBound = "1";

            searchInput.addEventListener("keydown", event => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    searchUser();
                }
            });

            searchInput.addEventListener("input", () => {
                const current = searchInput.value.trim().toLowerCase();

                if (state.user && state.searchFingerprint && current !== state.searchFingerprint) {
                    markSelectionInvalid();
                }
            });
        }

        if (requesterInput && !requesterInput.dataset.resetMfaBound) {
            requesterInput.dataset.resetMfaBound = "1";
            requesterInput.addEventListener("input", () => {
                if (state.authorization) {
                    clearValidation();
                    addLog("Autorização invalidada porque o solicitante foi alterado.");
                }
            });

            requesterInput.addEventListener("keydown", event => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    validateRequester();
                }
            });
        }

        if (sourceInput && !sourceInput.dataset.resetMfaBound) {
            sourceInput.dataset.resetMfaBound = "1";
            sourceInput.addEventListener("change", updateRequestSourceVisual);
        }

        if (referenceInput && !referenceInput.dataset.resetMfaBound) {
            referenceInput.dataset.resetMfaBound = "1";
            referenceInput.addEventListener("input", () => {
                if (state.authorization) {
                    clearValidation();
                    addLog("Autorização invalidada porque a referência da solicitação foi alterada.");
                }

                updateActionState();
            });
        }

        if (approvedIdentifier && !approvedIdentifier.dataset.resetMfaBound) {
            approvedIdentifier.dataset.resetMfaBound = "1";
            approvedIdentifier.addEventListener("keydown", event => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    addApprovedRequester();
                }
            });
        }
    }

    async function initialize() {
        if (!byId("resetMfaModuleRoot")) {
            return;
        }

        if (state.initialized) {
            bindEvents();
            updateRequestSourceVisual();
            updateActionState();
            return;
        }

        state.initialized = true;
        addLog("Módulo Reset MFA V2.3.2 carregado.");
        bindEvents();
        updateRequestSourceVisual();
        setProgress(0, "Aguardando operação.");
        updateActionState();
        await Promise.all([
            verifyGraphSession(),
            loadWindowsSignature(),
            loadApprovedRequesters()
        ]);
    }

    async function refresh() {
        state.busy = false;
        state.graphReady = false;
        state.user = null;
        state.authorization = null;
        state.searchFingerprint = "";
        state.lastResetResult = null;
        state.approvedRequesters = [];
        bindEvents();
        clearUserFields(true);
        clearValidation();
        updateRequestSourceVisual();
        setProgress(0, "Aguardando operação.");
        updateActionState();
        await Promise.all([
            verifyGraphSession(),
            loadWindowsSignature(),
            loadApprovedRequesters()
        ]);
    }

    const api = {
        initialized: true,
        refresh,
        connectGraph,
        searchUser,
        clearUser,
        validateRequester,
        generateTicketResponse,
        prevalidateReset,
        resetMfa,
        copyResponse,
        copyMethods,
        openServiceNow,
        clearAll,
        loadApprovedRequesters,
        toggleApprovedPanel,
        addApprovedRequester,
        toggleApprovedRequester,
        removeApprovedRequester,
        sendApprovalEmail,
        previewApprovalEmail,
        closeApprovalEmailPreview
    };

    window[moduleKey] = api;

    window.conectarGraphResetMFA = connectGraph;
    window.pesquisarUtilizadorResetMFA = searchUser;
    window.limparUtilizadorResetMFA = clearUser;
    window.validarSolicitanteTicketResetMFA = validateRequester;
    window.gerarRespostaTicketResetMFA = generateTicketResponse;
    window.testarResetMFA = prevalidateReset;
    window.resetarMFA = resetMfa;
    window.copiarRespostaResetMFA = copyResponse;
    window.copiarMetodosMFA = copyMethods;
    window.abrirServiceNowResetMFA = openServiceNow;
    window.limparResetMFA = clearAll;
    window.alternarPainelPreAprovadosResetMFA = toggleApprovedPanel;
    window.adicionarPreAprovadoResetMFA = addApprovedRequester;
    window.alternarEstadoPreAprovadoResetMFA = toggleApprovedRequester;
    window.removerPreAprovadoResetMFA = removeApprovedRequester;
    window.enviarEmailAprovacaoResetMFA = sendApprovalEmail;
    window.previsualizarEmailAprovacaoResetMFA = previewApprovalEmail;
    window.fecharPrevisualizacaoEmailResetMFA = closeApprovalEmailPreview;

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, { once: true });
    } else {
        initialize();
    }
}());
