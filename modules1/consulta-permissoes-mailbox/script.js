(() => {
    "use strict";

    const MODULE_ID = "consulta-permissoes-mailbox";
    const API_URL = `/module/${MODULE_ID}/api`;
    const SERVICE_NOW_URL = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bb85467db79c0d4f1024dc2ba961997&sysparm_category=93d369bedbf1a700ec3fa5305b96190a";

    const state = {
        rows: [],
        filter: "all",
        text: "",
        mailbox: null,
        logs: [],
        searchResults: [],
        searchScope: "mailboxes",
        distributionOwners: [],
        distributionMembers: [],
        distributionText: ""
    };

    const byId = (id) => document.getElementById(id);

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function parseServerResponse(value) {
        let current = value;

        for (let i = 0; i < 3; i += 1) {
            if (typeof current !== "string") {
                return current;
            }

            const trimmed = current.trim();
            if (!trimmed) {
                return {};
            }

            try {
                current = JSON.parse(trimmed);
            } catch {
                return { success: false, error: trimmed };
            }
        }

        return current;
    }

    async function requestApi(payload) {
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const raw = await response.text();
        const data = parseServerResponse(raw);

        if (!response.ok) {
            throw new Error(data?.error || data?.message || `Erro HTTP ${response.status}`);
        }

        return data;
    }

    function setProgress(percent, text, mode = "normal") {
        const container = byId("cpmProgress");
        const bar = byId("cpmProgressBar");
        const label = byId("cpmProgressText");

        if (!container || !bar || !label) return;

        const safe = Math.max(0, Math.min(100, Number(percent) || 0));
        container.hidden = false;
        bar.style.width = `${safe}%`;
        bar.textContent = `${safe}%`;
        label.textContent = text || "A processar...";

        if (mode === "success") {
            bar.style.background = "#079455";
        } else if (mode === "error") {
            bar.style.background = "#d92d20";
        } else {
            bar.style.background = "#ec0000";
        }
    }

    function showAlert(message, type = "error") {
        const el = byId("cpmAlert");
        if (!el) return;

        el.hidden = !message;
        el.className = `cpm-alert cpm-alert-${type}`;
        el.textContent = message || "";
    }

    function setConnectionBadge(connected, account = "") {
        const badge = byId("cpmConnectionBadge");
        if (!badge) return;

        badge.className = "cpm-connection";

        if (connected) {
            badge.classList.add("cpm-connection-ok");
            badge.textContent = account ? `Exchange ligado: ${account}` : "Exchange Online ligado";
        } else {
            badge.classList.add("cpm-connection-error");
            badge.textContent = "Exchange Online não ligado";
        }
    }

    async function checkExchangeConnection() {
        try {
            const response = await fetch("/api/exchange/status", { cache: "no-store" });
            const raw = await response.text();
            const data = parseServerResponse(raw);
            setConnectionBadge(Boolean(data?.connected), data?.user || "");
        } catch {
            setConnectionBadge(false);
        }
    }


    function getSearchScopeLabel(scope) {
        switch (scope) {
            case "distributionLists":
                return "Listas de distribuição (LD)";
            case "all":
                return "Todos os destinatários";
            case "mailboxes":
            default:
                return "Caixas de correio";
        }
    }

    function updateSearchHelp() {
        const scope = byId("cpmSearchScope")?.value || "mailboxes";
        const help = byId("cpmSearchHelp");

        state.searchScope = scope;

        if (!help) return;

        if (scope === "distributionLists") {
            help.textContent =
                "Pesquisa somente listas de distribuição, listas de segurança habilitadas para correio e listas dinâmicas.";
        } else if (scope === "all") {
            help.textContent =
                "Pesquisa todos os objetos habilitados para correio. Este modo pode devolver muitos utilizadores, grupos e contactos.";
        } else {
            help.textContent =
                "O modo padrão pesquisa somente mailboxes, tal como a página Caixas de Correio do Exchange Admin Center.";
        }
    }

    function filteredRows() {
        const needle = state.text.trim().toLowerCase();

        return state.rows.filter((row) => {
            const permissionMatch = state.filter === "all" || row.permissionType === state.filter;
            if (!permissionMatch) return false;
            if (!needle) return true;

            const haystack = [
                row.displayName,
                row.email,
                row.objectType,
                row.trustee
            ].join(" ").toLowerCase();

            return haystack.includes(needle);
        });
    }

    function renderTable() {
        const tbody = byId("cpmTabelaBody");
        const empty = byId("cpmEmptyState");
        const subtitle = byId("cpmTableSubtitle");

        if (!tbody || !empty || !subtitle) return;

        const rows = filteredRows();
        tbody.innerHTML = "";

        rows.forEach((row) => {
            const tr = document.createElement("tr");
            const permissionClass = row.permissionType === "FullAccess"
                ? "cpm-permission-full"
                : "cpm-permission-send";

            tr.innerHTML = `
                <td>
                    <span class="cpm-permission ${permissionClass}">
                        ${escapeHtml(row.permissionType)}
                    </span>
                </td>
                <td>${escapeHtml(row.displayName || "—")}</td>
                <td>${escapeHtml(row.email || "—")}</td>
                <td>${escapeHtml(row.objectType || "—")}</td>
                <td>${escapeHtml(row.trustee || "—")}</td>
                <td class="${row.isInherited ? "cpm-yes" : "cpm-no"}">
                    ${row.isInherited ? "Sim" : "Não"}
                </td>
                <td class="${row.deny ? "cpm-yes" : "cpm-no"}">
                    ${row.deny ? "Sim" : "Não"}
                </td>
            `;

            tbody.appendChild(tr);
        });

        empty.hidden = rows.length > 0;

        const filterLabel = state.filter === "all" ? "todas as permissões" : state.filter;
        subtitle.textContent = `${rows.length} resultado(s), a mostrar ${filterLabel}.`;
    }

    function getDistributionRows() {
        return [
            ...state.distributionOwners.map((row) => ({ ...row, relationType: "Proprietário" })),
            ...state.distributionMembers.map((row) => ({ ...row, relationType: "Membro" }))
        ];
    }

    function filteredDistributionRows() {
        const needle = state.distributionText.trim().toLowerCase();
        const rows = getDistributionRows();

        if (!needle) {
            return rows;
        }

        return rows.filter((row) => {
            const haystack = [
                row.relationType,
                row.displayName,
                row.email,
                row.objectType,
                row.identity
            ].join(" ").toLowerCase();

            return haystack.includes(needle);
        });
    }

    function renderDistributionTable(distributionData = null) {
        const area = byId("cpmDistributionArea");
        const tbody = byId("cpmDistributionBody");
        const empty = byId("cpmDistributionEmpty");
        const note = byId("cpmDistributionNote");

        if (!area || !tbody || !empty || !note) return;

        const isDistributionList =
            state.mailbox?.classificationCode === "distribution-list";

        area.hidden = !isDistributionList;

        if (!isDistributionList) {
            tbody.innerHTML = "";
            return;
        }

        const rows = filteredDistributionRows();
        tbody.innerHTML = "";

        rows.forEach((row) => {
            const tr = document.createElement("tr");
            const isOwner = row.relationType === "Proprietário";
            const relationClass = isOwner
                ? "cpm-relation-owner"
                : "cpm-relation-member";

            tr.innerHTML = `
                <td>
                    <span class="cpm-relation-badge ${relationClass}">
                        ${escapeHtml(row.relationType)}
                    </span>
                </td>
                <td>${escapeHtml(row.displayName || "—")}</td>
                <td>${escapeHtml(row.email || "—")}</td>
                <td>${escapeHtml(row.objectType || "—")}</td>
                <td>${escapeHtml(row.identity || "—")}</td>
            `;

            tbody.appendChild(tr);
        });

        byId("cpmOwnersTotal").textContent = String(state.distributionOwners.length);
        byId("cpmMembersTotal").textContent = String(state.distributionMembers.length);
        byId("cpmDirectoryTotal").textContent = String(
            state.distributionOwners.length + state.distributionMembers.length
        );

        const membersSupported = distributionData?.membersSupported !== false;
        const defaultNote = membersSupported
            ? "A estrutura da LD foi consultada no Exchange Online."
            : "Os membros desta lista não puderam ser enumerados automaticamente.";

        note.textContent = distributionData?.note || defaultNote;
        note.classList.toggle("cpm-distribution-warning", !membersSupported);
        empty.hidden = rows.length > 0;
    }

    function renderResult(data) {
        state.rows = Array.isArray(data.permissions) ? data.permissions : [];
        state.mailbox = data.mailbox || {};
        state.logs = Array.isArray(data.logs) ? data.logs : [];
        state.distributionOwners = Array.isArray(data.distributionList?.owners)
            ? data.distributionList.owners
            : [];
        state.distributionMembers = Array.isArray(data.distributionList?.members)
            ? data.distributionList.members
            : [];
        state.distributionText = "";

        const distributionFilter = byId("cpmDistributionFilter");
        if (distributionFilter) {
            distributionFilter.value = "";
        }

        byId("cpmSearchResultsArea").hidden = true;
        byId("cpmResultadoArea").hidden = false;
        byId("cpmMailboxNome").textContent = state.mailbox.displayName || state.mailbox.identity || "Mailbox";
        byId("cpmMailboxEmail").textContent = state.mailbox.primarySmtpAddress || state.mailbox.identity || "—";
        const typeBadge = byId("cpmMailboxTipo");
        const typeCode = state.mailbox.classificationCode || "other";
        const typeLabel = state.mailbox.classificationLabel
            || state.mailbox.recipientTypeDetails
            || "Destinatário Exchange";

        typeBadge.textContent = typeLabel;
        typeBadge.className = `cpm-type-badge cpm-type-${typeCode}`;

        byId("cpmRecipientRawType").textContent =
            `Tipo técnico: ${state.mailbox.recipientTypeDetails || "não informado"}`;

        byId("cpmConsultaData").textContent = data.consultedAt
            ? `Consultado em ${data.consultedAt}`
            : "";

        byId("cpmTotal").textContent = String(data.summary?.total ?? state.rows.length);
        byId("cpmFullAccessTotal").textContent = String(data.summary?.fullAccess ?? 0);
        byId("cpmSendAsTotal").textContent = String(data.summary?.sendAs ?? 0);

        const fullAccessCard = document.querySelector('[data-cpm-filter="FullAccess"]');
        const fullAccessApplicable = data.summary?.fullAccessApplicable !== false;

        fullAccessCard?.classList.toggle("cpm-kpi-not-applicable", !fullAccessApplicable);
        byId("cpmFullAccessNote").textContent = fullAccessApplicable
            ? "Acesso total à mailbox"
            : "Não aplicável a este tipo de objeto";

        byId("cpmSendAsNote").textContent = "Enviar como o objeto";
        byId("cpmLog").textContent = state.logs.join("\n");

        state.filter = "all";
        document.querySelectorAll("[data-cpm-filter]").forEach((button) => {
            button.classList.toggle("cpm-kpi-active", button.dataset.cpmFilter === "all");
        });

        renderDistributionTable(data.distributionList || null);
        renderTable();
    }

    function renderSearchResults(results, query, searchScope = "mailboxes") {
        const area = byId("cpmSearchResultsArea");
        const tbody = byId("cpmSearchResultsBody");
        const count = byId("cpmSearchResultsCount");
        const subtitle = byId("cpmSearchResultsSubtitle");

        state.searchResults = Array.isArray(results) ? results : [];

        tbody.innerHTML = "";
        count.textContent = String(state.searchResults.length);
        const scopeLabel = getSearchScopeLabel(searchScope);
        subtitle.innerHTML =
            `${state.searchResults.length} objeto(s) encontrado(s) para "${escapeHtml(query)}"` +
            `<span class="cpm-search-scope-note">${escapeHtml(scopeLabel)}</span>`;

        state.searchResults.forEach((item) => {
            const tr = document.createElement("tr");
            const typeCode = item.classificationCode || "other";
            const identity =
                item.primarySmtpAddress ||
                item.externalDirectoryObjectId ||
                item.identity ||
                "";

            tr.innerHTML = `
                <td>
                    <div class="cpm-search-result-name">
                        ${escapeHtml(item.displayName || "—")}
                    </div>
                </td>
                <td>
                    <div class="cpm-search-result-email">
                        ${escapeHtml(item.primarySmtpAddress || "—")}
                    </div>
                </td>
                <td>${escapeHtml(item.alias || "—")}</td>
                <td>
                    <span class="cpm-type-badge cpm-type-${escapeHtml(typeCode)}">
                        ${escapeHtml(item.classificationLabel || "Destinatário Exchange")}
                    </span>
                </td>
                <td>${escapeHtml(item.recipientTypeDetails || "—")}</td>
                <td>
                    <button
                        type="button"
                        class="btn-primary cpm-select-object-btn"
                        data-cpm-identity="${escapeHtml(identity)}">
                        Consultar
                    </button>
                </td>
            `;

            tbody.appendChild(tr);
        });

        tbody.querySelectorAll("[data-cpm-identity]").forEach((button) => {
            button.addEventListener("click", () => {
                const identity = button.dataset.cpmIdentity || "";
                consultarSelecionado(identity, button);
            });
        });

        byId("cpmResultadoArea").hidden = true;
        area.hidden = false;
    }

    async function consultarSelecionado(identity, sourceButton = null) {
        const input = byId("cpmMailbox");
        const mainButton = byId("cpmConsultarBtn");

        if (!identity) {
            showAlert("Não foi possível identificar o objeto selecionado.");
            return;
        }

        if (sourceButton) {
            sourceButton.disabled = true;
        }

        mainButton.disabled = true;
        showAlert("");
        setProgress(55, "A consultar FullAccess e SendAs do objeto selecionado...");

        try {
            const data = await requestApi({
                action: "consultar",
                mailbox: identity
            });

            if (!data?.success) {
                throw new Error(
                    data?.error ||
                    data?.message ||
                    "A consulta de permissões não foi concluída."
                );
            }

            if (input && data.mailbox?.primarySmtpAddress) {
                input.value = data.mailbox.primarySmtpAddress;
            }

            setProgress(85, "A preparar o resultado...");
            renderResult(data);
            setProgress(100, "Consulta concluída.", "success");

            const typeLabel =
                data.mailbox?.classificationLabel ||
                "Destinatário Exchange";

            if (data.mailbox?.classificationCode === "distribution-list") {
                showAlert(
                    `${typeLabel} identificada. ` +
                    `${data.summary?.owners ?? 0} proprietário(s), ` +
                    `${data.summary?.members ?? 0} membro(s) e ` +
                    `${data.summary?.sendAs ?? 0} permissão(ões) SendAs.`,
                    "success"
                );
            } else {
                showAlert(
                    `${typeLabel} identificado. ${data.summary?.total ?? state.rows.length} permissão(ões) encontrada(s).`,
                    "success"
                );
            }
        }
        catch (error) {
            setProgress(100, "Erro na consulta.", "error");
            showAlert(error.message || String(error));
        }
        finally {
            mainButton.disabled = false;

            if (sourceButton) {
                sourceButton.disabled = false;
            }
        }
    }async function consultar() {
        const input = byId("cpmMailbox");
        const button = byId("cpmConsultarBtn");
        const query = input?.value.trim() || "";
        const searchScope = byId("cpmSearchScope")?.value || "mailboxes";

        state.searchScope = searchScope;
        showAlert("");

        if (!query) {
            showAlert("Informe um nome, número, alias ou endereço de e-mail.");
            input?.focus();
            return;
        }

        button.disabled = true;
        byId("cpmResultadoArea").hidden = true;
        byId("cpmSearchResultsArea").hidden = true;
        setProgress(10, "A pesquisar objetos no Exchange Online...");

        try {
            const searchData = await requestApi({
                action: "pesquisar",
                query,
                searchScope
            });

            if (!searchData?.success) {
                throw new Error(
                    searchData?.error ||
                    searchData?.message ||
                    "A pesquisa não foi concluída."
                );
            }

            const matches = Array.isArray(searchData.matches)
                ? searchData.matches
                : [];

            if (!matches.length) {
                throw new Error(
                    `Nenhum resultado foi encontrado em ${getSearchScopeLabel(searchScope)} para "${query}".`
                );
            }

            if (matches.length === 1) {
                setProgress(40, "Um objeto encontrado. A consultar permissões...");
                button.disabled = false;
                await consultarSelecionado(
                    matches[0].primarySmtpAddress ||
                    matches[0].externalDirectoryObjectId ||
                    matches[0].identity
                );
                return;
            }

            renderSearchResults(
                matches,
                query,
                searchData.searchScope || searchScope
            );
            setProgress(
                100,
                `${matches.length} objetos encontrados. Selecione o objeto pretendido.`,
                "success"
            );
            showAlert(
                `${matches.length} resultado(s) em ${getSearchScopeLabel(searchScope)}. Selecione o objeto correto para consultar as permissões.`,
                "success"
            );
        }
        catch (error) {
            setProgress(100, "Erro na pesquisa.", "error");
            showAlert(error.message || String(error));
        }
        finally {
            button.disabled = false;
        }
    }

    function limpar() {
        const input = byId("cpmMailbox");
        if (input) {
            input.value = "";
            input.focus();
        }

        state.rows = [];
        state.filter = "all";
        state.text = "";
        state.mailbox = null;
        state.logs = [];
        state.searchResults = [];
        state.searchScope = "mailboxes";
        state.distributionOwners = [];
        state.distributionMembers = [];
        state.distributionText = "";

        const scopeSelect = byId("cpmSearchScope");
        if (scopeSelect) {
            scopeSelect.value = "mailboxes";
        }
        updateSearchHelp();

        byId("cpmSearchResultsBody").innerHTML = "";
        byId("cpmDistributionBody").innerHTML = "";
        byId("cpmDistributionArea").hidden = true;
        byId("cpmDistributionFilter").value = "";
        byId("cpmSearchResultsArea").hidden = true;
        byId("cpmResultadoArea").hidden = true;
        byId("cpmProgress").hidden = true;
        byId("cpmFiltroTexto").value = "";
        showAlert("");
    }

    function setFilter(filter, button) {
        state.filter = filter;

        document.querySelectorAll("[data-cpm-filter]").forEach((item) => {
            item.classList.toggle("cpm-kpi-active", item === button);
        });

        renderTable();
    }

    function csvCell(value) {
        return `"${String(value ?? "").replaceAll('"', '""')}"`;
    }

    function exportCsv() {
        const permissionRows = state.rows.map((row) => ({
            category: "Permissão",
            relation: row.permissionType,
            displayName: row.displayName,
            email: row.email,
            objectType: row.objectType,
            originalIdentity: row.trustee,
            inherited: row.isInherited ? "Sim" : "Não",
            deny: row.deny ? "Sim" : "Não"
        }));

        const directoryRows = getDistributionRows().map((row) => ({
            category: "Estrutura da LD",
            relation: row.relationType,
            displayName: row.displayName,
            email: row.email,
            objectType: row.objectType,
            originalIdentity: row.identity,
            inherited: "",
            deny: ""
        }));

        const rows = [...directoryRows, ...permissionRows];

        if (!rows.length) {
            showAlert("Não existem dados para exportar.");
            return;
        }

        const header = [
            "ObjetoConsultado",
            "TipoIdentificado",
            "TipoTecnico",
            "Categoria",
            "VinculoOuPermissao",
            "Nome",
            "Email_UPN",
            "TipoObjeto",
            "IdentidadeOriginal",
            "Herdado",
            "Deny"
        ];

        const mailbox = state.mailbox?.primarySmtpAddress || state.mailbox?.identity || "";
        const lines = [header.map(csvCell).join(";")];

        rows.forEach((row) => {
            lines.push([
                mailbox,
                state.mailbox?.classificationLabel || "",
                state.mailbox?.recipientTypeDetails || "",
                row.category,
                row.relation,
                row.displayName,
                row.email,
                row.objectType,
                row.originalIdentity,
                row.inherited,
                row.deny
            ].map(csvCell).join(";"));
        });

        const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
            type: "text/csv;charset=utf-8"
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const safeMailbox = mailbox.replace(/[^a-zA-Z0-9._-]/g, "_");

        link.href = url;
        link.download = `relatorio_exchange_${safeMailbox || "objeto"}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function formatPermissionRows(rows) {
        if (!rows.length) {
            return "- Nenhuma permissão encontrada";
        }

        return rows.map((row) => {
            const name = row.displayName || row.trustee || "Não identificado";
            const email = row.email ? ` | E-mail/UPN: ${row.email}` : "";
            const objectType = row.objectType ? ` | Tipo: ${row.objectType}` : "";
            const trustee = row.trustee ? ` | Trustee: ${row.trustee}` : "";
            const inherited = row.isInherited ? " | Herdado: Sim" : "";
            const deny = row.deny ? " | Deny: Sim" : "";

            return `- ${name}${email}${objectType}${trustee}${inherited}${deny}`;
        }).join("\n");
    }

    function formatDirectoryRows(rows) {
        if (!rows.length) {
            return "- Nenhum registo encontrado";
        }

        return rows.map((row) => {
            const name = row.displayName || row.identity || "Não identificado";
            const email = row.email ? ` | E-mail/UPN: ${row.email}` : "";
            const objectType = row.objectType ? ` | Tipo: ${row.objectType}` : "";
            return `- ${name}${email}${objectType}`;
        }).join("\n");
    }

    function buildReportText(serviceNowMode = false) {
        if (!state.mailbox) {
            return "";
        }

        const mailbox =
            state.mailbox.primarySmtpAddress ||
            state.mailbox.identity ||
            "";

        const displayName =
            state.mailbox.displayName ||
            state.mailbox.identity ||
            "Não informado";

        const typeLabel =
            state.mailbox.classificationLabel ||
            "Destinatário Exchange";

        const technicalType =
            state.mailbox.recipientTypeDetails ||
            "não informado";

        const fullRows =
            state.rows.filter((row) => row.permissionType === "FullAccess");

        const sendRows =
            state.rows.filter((row) => row.permissionType === "SendAs");

        const fullAccessApplicable =
            state.mailbox.supportsFullAccess !== false;

        const isDistributionList =
            state.mailbox.classificationCode === "distribution-list";

        const consultationDate =
            byId("cpmConsultaData")?.textContent
                ?.replace(/^Consultado em\s*/i, "")
                ?.trim() ||
            new Date().toLocaleString("pt-PT");

        const lines = [];

        if (serviceNowMode) {
            lines.push(
                "RELATÓRIO DO OBJETO EXCHANGE",
                "Santander Support Web V2",
                "",
                "Solicitação: Consulta de permissões e estrutura de um objeto do Exchange Online.",
                ""
            );
        }

        lines.push(
            `Objeto consultado: ${displayName}`,
            `Endereço: ${mailbox}`,
            `Tipo identificado: ${typeLabel}`,
            `Tipo técnico: ${technicalType}`,
            `Data da consulta: ${consultationDate}`,
            ""
        );

        if (isDistributionList) {
            lines.push(
                `PROPRIETÁRIOS (${state.distributionOwners.length})`,
                formatDirectoryRows(state.distributionOwners),
                "",
                `MEMBROS (${state.distributionMembers.length})`,
                formatDirectoryRows(state.distributionMembers),
                ""
            );
        }

        if (fullAccessApplicable) {
            lines.push(
                `FULLACCESS (${fullRows.length})`,
                formatPermissionRows(fullRows),
                ""
            );
        }
        else {
            lines.push(
                "FULLACCESS",
                "- Não aplicável a este tipo de objeto.",
                ""
            );
        }

        lines.push(
            `SENDAS (${sendRows.length})`,
            formatPermissionRows(sendRows)
        );

        if (serviceNowMode) {
            lines.push(
                "",
                "Observação: consulta efetuada em modo somente leitura. Nenhuma permissão, proprietário ou membro foi alterado.",
                "",
                "IT Santander Portugal"
            );
        }

        return lines.join("\n");
    }

    async function copyToClipboard(text) {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
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

    async function copiarResumo() {
        if (!state.mailbox) {
            showAlert("Faça uma consulta antes de copiar o resumo.");
            return;
        }

        try {
            await copyToClipboard(buildReportText(false));
            showAlert(
                "Resumo copiado para a área de transferência.",
                "success"
            );
        }
        catch {
            showAlert(
                "Não foi possível copiar automaticamente. Use a exportação CSV."
            );
        }
    }

    async function abrirServiceNow() {
        if (!state.mailbox) {
            showAlert(
                "Faça uma consulta antes de abrir o pedido no ServiceNow."
            );
            return;
        }

        const button = byId("cpmServiceNowBtn");
        const reportText = buildReportText(true);

        if (button) {
            button.disabled = true;
        }

        const copyPromise = copyToClipboard(reportText);

        window.open(
            SERVICE_NOW_URL,
            "_blank",
            "noopener"
        );

        try {
            await copyPromise;

            showAlert(
                "Relatório copiado. O ServiceNow foi aberto; cole o conteúdo no campo de descrição do pedido.",
                "success"
            );
        }
        catch {
            showAlert(
                "O ServiceNow foi aberto, mas não foi possível copiar o relatório automaticamente. Utilize o botão Copiar resumo."
            );
        }
        finally {
            if (button) {
                button.disabled = false;
            }
        }
    }

    function init() {
        const root = document.querySelector(".cpm-module");
        if (!root || root.dataset.cpmReady === "true") return;
        root.dataset.cpmReady = "true";

        byId("cpmConsultarBtn")?.addEventListener("click", consultar);
        byId("cpmLimparBtn")?.addEventListener("click", limpar);
        byId("cpmCsvBtn")?.addEventListener("click", exportCsv);
        byId("cpmCopiarBtn")?.addEventListener("click", copiarResumo);
        byId("cpmServiceNowBtn")?.addEventListener("click", abrirServiceNow);
        byId("cpmSearchScope")?.addEventListener("change", () => {
            updateSearchHelp();
            byId("cpmSearchResultsArea").hidden = true;
            byId("cpmResultadoArea").hidden = true;
            showAlert("");
        });

        byId("cpmMailbox")?.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                consultar();
            }
        });

        byId("cpmFiltroTexto")?.addEventListener("input", (event) => {
            state.text = event.target.value || "";
            renderTable();
        });

        byId("cpmDistributionFilter")?.addEventListener("input", (event) => {
            state.distributionText = event.target.value || "";
            renderDistributionTable();
        });

        document.querySelectorAll("[data-cpm-filter]").forEach((button) => {
            button.addEventListener("click", () => {
                setFilter(button.dataset.cpmFilter || "all", button);
            });
        });

        updateSearchHelp();
        checkExchangeConnection();
        byId("cpmMailbox")?.focus();
    }

    window.consultaPermissoesMailbox = {
        init,
        consultar,
        limpar,
        abrirServiceNow
    };

    setTimeout(init, 50);
})();