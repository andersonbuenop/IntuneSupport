(() => {
    "use strict";

    const MODULE_ID = "consulta-permissoes-mailbox";
    const API_URL = `/module/${MODULE_ID}/api`;

    const state = {
        rows: [],
        filter: "all",
        text: "",
        mailbox: null,
        logs: []
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

    function renderResult(data) {
        state.rows = Array.isArray(data.permissions) ? data.permissions : [];
        state.mailbox = data.mailbox || {};
        state.logs = Array.isArray(data.logs) ? data.logs : [];

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

        renderTable();
    }

    async function consultar() {
        const input = byId("cpmMailbox");
        const button = byId("cpmConsultarBtn");
        const mailbox = input?.value.trim() || "";

        showAlert("");

        if (!mailbox) {
            showAlert("Informe o endereço de e-mail da mailbox.");
            input?.focus();
            return;
        }

        button.disabled = true;
        setProgress(10, "A validar a mailbox...");

        try {
            setProgress(35, "A identificar o tipo e consultar permissões...");
            const data = await requestApi({
                action: "consultar",
                mailbox
            });

            if (!data?.success) {
                throw new Error(data?.error || data?.message || "A consulta não foi concluída.");
            }

            setProgress(85, "A preparar o resultado...");
            renderResult(data);
            setProgress(100, "Consulta concluída.", "success");
            const typeLabel = data.mailbox?.classificationLabel || "Destinatário Exchange";
            showAlert(
                `${typeLabel} identificado. ${data.summary?.total ?? state.rows.length} permissão(ões) encontrada(s).`,
                "success"
            );
        } catch (error) {
            setProgress(100, "Erro na consulta.", "error");
            showAlert(error.message || String(error));
        } finally {
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
        const rows = filteredRows();
        if (!rows.length) {
            showAlert("Não existem resultados para exportar.");
            return;
        }

        const header = [
            "ObjetoConsultado",
            "TipoIdentificado",
            "TipoTecnico",
            "Permissão",
            "Nome",
            "Email_UPN",
            "TipoObjetoPermissao",
            "TrusteeOriginal",
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
                row.permissionType,
                row.displayName,
                row.email,
                row.objectType,
                row.trustee,
                row.isInherited ? "Sim" : "Não",
                row.deny ? "Sim" : "Não"
            ].map(csvCell).join(";"));
        });

        const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
            type: "text/csv;charset=utf-8"
        });

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const safeMailbox = mailbox.replace(/[^a-zA-Z0-9._-]/g, "_");

        link.href = url;
        link.download = `permissoes_${safeMailbox || "mailbox"}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async function copiarResumo() {
        if (!state.mailbox) {
            showAlert("Faça uma consulta antes de copiar o resumo.");
            return;
        }

        const mailbox = state.mailbox.primarySmtpAddress || state.mailbox.identity || "";
        const fullRows = state.rows.filter((row) => row.permissionType === "FullAccess");
        const sendRows = state.rows.filter((row) => row.permissionType === "SendAs");

        const formatRows = (rows) => rows.length
            ? rows.map((row) => `- ${row.displayName || row.trustee}${row.email ? ` (${row.email})` : ""}`).join("\n")
            : "- Nenhuma permissão encontrada";

        const fullAccessApplicable = state.mailbox.supportsFullAccess !== false;
        const text = [
            `Objeto: ${mailbox}`,
            `Tipo: ${state.mailbox.classificationLabel || "Destinatário Exchange"}`,
            `Tipo técnico: ${state.mailbox.recipientTypeDetails || "não informado"}`,
            "",
            fullAccessApplicable
                ? `FullAccess (${fullRows.length}):`
                : "FullAccess: Não aplicável a este tipo de objeto",
            fullAccessApplicable ? formatRows(fullRows) : "",
            "",
            `SendAs (${sendRows.length}):`,
            formatRows(sendRows)
        ].filter((line, index, values) => {
            return !(line === "" && values[index - 1] === "");
        }).join("\n");

        try {
            await navigator.clipboard.writeText(text);
            showAlert("Resumo copiado para a área de transferência.", "success");
        } catch {
            showAlert("Não foi possível copiar automaticamente. Use a exportação CSV.");
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

        document.querySelectorAll("[data-cpm-filter]").forEach((button) => {
            button.addEventListener("click", () => {
                setFilter(button.dataset.cpmFilter || "all", button);
            });
        });

        checkExchangeConnection();
        byId("cpmMailbox")?.focus();
    }

    window.consultaPermissoesMailbox = {
        init,
        consultar,
        limpar
    };

    setTimeout(init, 50);
})();