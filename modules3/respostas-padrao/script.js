"use strict";

(function initializeRespostasPadrao() {
    const STORAGE = {
        signature: "SantanderRespostasPadraoSignatureV1",
        greeting: "SantanderRespostasPadraoGreetingV1",
        favorites: "SantanderRespostasPadraoFavoritesV1",
        usage: "SantanderRespostasPadraoUsageV1",
        recent: "SantanderRespostasPadraoRecentV1"
    };

    const state = {
        responses: [],
        settings: {
            androidMinimum: "12",
            iosMinimum: "18.6.2",
            defaultSignature: "Raphael Vieira"
        },
        selectedId: "",
        search: "",
        category: "",
        sort: "title",
        favorites: readStorage(STORAGE.favorites, []),
        usage: readStorage(STORAGE.usage, {}),
        recent: readStorage(STORAGE.recent, []),
        fieldValues: {}
    };

    function element(id) {
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

    function normalize(value) {
        return String(value == null ? "" : value)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();
    }

    function readStorage(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch (_) {
            return fallback;
        }
    }

    function writeStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (_) { }
    }

    function showToast(message, type) {
        const toast = element("rpToast");
        if (!toast) return;

        toast.textContent = String(message || "");
        toast.className = `rp-toast show ${type || ""}`.trim();

        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => {
            toast.className = "rp-toast";
        }, 3200);
    }

    function getGreeting() {
        const selected = element("rpGreeting") ? element("rpGreeting").value : "auto";

        if (selected && selected !== "auto") {
            return selected;
        }

        return new Date().getHours() < 12 ? "Bom dia" : "Boa tarde";
    }

    function getSignature() {
        const value = element("rpSignature")
            ? element("rpSignature").value.trim()
            : state.settings.defaultSignature;

        return value || state.settings.defaultSignature || "Raphael Vieira";
    }

    function findResponse(id) {
        return state.responses.find(item => item.id === id) || null;
    }

    function isFavorite(id) {
        return state.favorites.includes(id);
    }

    function usageCount(id) {
        return Number(state.usage[id] || 0);
    }

    function recentIndex(id) {
        const index = state.recent.indexOf(id);
        return index < 0 ? 999999 : index;
    }

    function buildComputedTokens(response) {
        const values = state.fieldValues[response.id] || {};
        const email = String(values.caixa_email || "").trim();
        const target = String(values.dominio_remetente || "").trim();
        const channel = String(values.meio_contacto || "").trim();
        const dateRaw = String(values.data_tentativa || "").trim();

        let formattedAttempt = "";
        if (dateRaw) {
            const parsed = new Date(dateRaw);
            if (!Number.isNaN(parsed.getTime())) {
                formattedAttempt = new Intl.DateTimeFormat("pt-PT", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                }).format(parsed);
            }
        }

        let attemptIntro = "Tentámos entrar em contacto, mas não obtivemos resposta.";
        if (channel && formattedAttempt) {
            attemptIntro = `Tentámos entrar em contacto através de ${channel} em ${formattedAttempt}, mas não obtivemos resposta.`;
        } else if (channel) {
            attemptIntro = `Tentámos entrar em contacto através de ${channel}, mas não obtivemos resposta.`;
        } else if (formattedAttempt) {
            attemptIntro = `Tentámos entrar em contacto em ${formattedAttempt}, mas não obtivemos resposta.`;
        }

        const senderIntro = target
            ? `O motivo pelo qual as mensagens provenientes de ${target} não estão a ser recebidas está relacionado com a data de criação do respetivo endereço, que possui menos de 30 dias.`
            : "O motivo pelo qual as mensagens provenientes do domínio ou remetente indicado não estão a ser recebidas está relacionado com a data de criação do respetivo endereço, que possui menos de 30 dias.";

        return {
            saudacao: getGreeting(),
            assinatura: getSignature(),
            android_minimo: state.settings.androidMinimum || "12",
            ios_minimo: state.settings.iosMinimum || "18.6.2",
            link: response.link || "",
            caixa_instrucao: email
                ? `Introduza o endereço ${email} e clique em “OK”.`
                : "Introduza o endereço da caixa de e-mail que pretende adicionar e clique em “OK”.",
            remetente_intro: senderIntro,
            tentativa_intro: attemptIntro
        };
    }

    function renderTemplate(response) {
        const tokens = buildComputedTokens(response);
        let text = String(response.template || "");

        Object.keys(tokens).forEach(key => {
            const pattern = new RegExp(`{{${key}}}`, "g");
            text = text.replace(pattern, String(tokens[key] == null ? "" : tokens[key]));
        });

        return text.replace(/\n{3,}/g, "\n\n").trim();
    }

    function updateStats() {
        const total = element("rpTotalResponses");
        const favorites = element("rpFavoriteCount");
        const copies = element("rpCopyCount");

        if (total) total.textContent = String(state.responses.length);
        if (favorites) favorites.textContent = String(state.favorites.length);
        if (copies) {
            copies.textContent = String(
                Object.values(state.usage).reduce((sum, value) => sum + Number(value || 0), 0)
            );
        }
    }

    function renderCategories() {
        const target = element("rpCategoryChips");
        if (!target) return;

        const categories = Array.from(
            new Set(state.responses.map(item => item.category).filter(Boolean))
        ).sort((a, b) => a.localeCompare(b, "pt"));

        target.innerHTML = [
            '<button class="rp-category-chip active" type="button" data-category="">Todas</button>',
            ...categories.map(category => (
                `<button class="rp-category-chip" type="button" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`
            ))
        ].join("");

        target.querySelectorAll("[data-category]").forEach(button => {
            button.addEventListener("click", () => {
                state.category = button.dataset.category || "";

                target.querySelectorAll("[data-category]").forEach(item => {
                    item.classList.toggle("active", item === button);
                });

                renderList();
            });
        });
    }

    function getFilteredResponses() {
        const query = normalize(state.search);
        const category = normalize(state.category);

        const filtered = state.responses.filter(response => {
            const searchText = normalize([
                response.title,
                response.category,
                ...(response.keywords || []),
                response.template
            ].join(" "));

            const matchesSearch = !query || searchText.includes(query);
            const matchesCategory = !category || normalize(response.category) === category;

            return matchesSearch && matchesCategory;
        });

        filtered.sort((a, b) => {
            if (state.sort === "used") {
                return usageCount(b.id) - usageCount(a.id) || a.title.localeCompare(b.title, "pt");
            }

            if (state.sort === "recent") {
                return recentIndex(a.id) - recentIndex(b.id) || a.title.localeCompare(b.title, "pt");
            }

            return a.title.localeCompare(b.title, "pt");
        });

        return filtered;
    }

    function renderList() {
        const target = element("rpResponseList");
        const count = element("rpResultCount");
        if (!target) return;

        const responses = getFilteredResponses();

        if (count) {
            count.textContent = `${responses.length} de ${state.responses.length} resposta(s)`;
        }

        if (!responses.length) {
            target.innerHTML = `
                <div class="rp-empty-list">
                    <strong>Nenhuma resposta encontrada</strong>
                    <span>Altere a pesquisa ou selecione outra categoria.</span>
                </div>
            `;
            return;
        }

        target.innerHTML = responses.map(response => {
            const active = response.id === state.selectedId;
            const favorite = isFavorite(response.id);
            const countValue = usageCount(response.id);

            return `
                <div class="rp-response-item ${active ? "active" : ""}" data-response-id="${escapeHtml(response.id)}" role="button" tabindex="0">
                    <span class="rp-response-icon">${escapeHtml(response.icon || "RP")}</span>
                    <span class="rp-response-copy">
                        <strong title="${escapeHtml(response.title)}">${escapeHtml(response.title)}</strong>
                        <small>${escapeHtml(response.category || "Geral")}</small>
                        <em>${countValue} cópia(s)</em>
                    </span>
                    <button
                        class="rp-favorite-toggle ${favorite ? "active" : ""}"
                        type="button"
                        data-favorite-id="${escapeHtml(response.id)}"
                        title="${favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}"
                        aria-label="${favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}">
                        ${favorite ? "★" : "☆"}
                    </button>
                </div>
            `;
        }).join("");

        target.querySelectorAll("[data-response-id]").forEach(item => {
            const open = () => selectResponse(item.dataset.responseId);
            item.addEventListener("click", event => {
                if (event.target.closest("[data-favorite-id]")) return;
                open();
            });
            item.addEventListener("keydown", event => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    open();
                }
            });
        });

        target.querySelectorAll("[data-favorite-id]").forEach(button => {
            button.addEventListener("click", event => {
                event.stopPropagation();
                toggleFavorite(button.dataset.favoriteId);
            });
        });
    }

    function renderField(field, currentValue) {
        const id = `rpField_${field.id}`;
        const value = currentValue == null ? "" : String(currentValue);
        const fullClass = field.full ? " full" : "";

        if (field.type === "select") {
            return `
                <div class="rp-field${fullClass}">
                    <label for="${escapeHtml(id)}">${escapeHtml(field.label)}${field.optional ? " (opcional)" : ""}</label>
                    <select id="${escapeHtml(id)}" data-rp-field="${escapeHtml(field.id)}">
                        ${(field.options || []).map(option => (
                            `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option || "Selecionar...")}</option>`
                        )).join("")}
                    </select>
                </div>
            `;
        }

        return `
            <div class="rp-field${fullClass}">
                <label for="${escapeHtml(id)}">${escapeHtml(field.label)}${field.optional ? " (opcional)" : ""}</label>
                <input
                    id="${escapeHtml(id)}"
                    data-rp-field="${escapeHtml(field.id)}"
                    type="${escapeHtml(field.type || "text")}"
                    value="${escapeHtml(value)}"
                    placeholder="${escapeHtml(field.placeholder || "")}">
            </div>
        `;
    }

    function renderEditor() {
        const response = findResponse(state.selectedId);
        const target = element("rpEditorPanel");
        if (!target) return;

        if (!response) {
            target.innerHTML = `
                <div class="rp-empty-detail">
                    <strong>Selecione uma resposta</strong>
                    <span>A pré-visualização e os campos de personalização aparecerão aqui.</span>
                </div>
            `;
            return;
        }

        const currentFields = state.fieldValues[response.id] || {};
        const fields = Array.isArray(response.fields) ? response.fields : [];

        target.innerHTML = `
            <div class="rp-editor-heading">
                <div>
                    <h3>${escapeHtml(response.title)}</h3>
                    <div class="rp-editor-tags">
                        <span class="rp-tag">${escapeHtml(response.category || "Geral")}</span>
                        <span class="rp-tag">${usageCount(response.id)} cópia(s)</span>
                        ${isFavorite(response.id) ? '<span class="rp-tag">★ Favorita</span>' : ""}
                    </div>
                </div>

                <button
                    class="rp-favorite-toggle ${isFavorite(response.id) ? "active" : ""}"
                    id="rpEditorFavorite"
                    type="button"
                    title="Alternar favorito">
                    ${isFavorite(response.id) ? "★" : "☆"}
                </button>
            </div>

            <div class="rp-editor-body">
                ${fields.length ? `
                    <div class="rp-variable-grid">
                        ${fields.map(field => renderField(field, currentFields[field.id])).join("")}
                    </div>
                ` : ""}

                ${response.reminder ? `
                    <div class="rp-reminder">
                        <span aria-hidden="true">⚠</span>
                        <span>${escapeHtml(response.reminder)}</span>
                    </div>
                ` : ""}

                <div class="rp-preview-label">
                    <strong>Pré-visualização editável</strong>
                    <span>As alterações manuais também serão copiadas.</span>
                </div>

                <textarea class="rp-preview" id="rpPreview" spellcheck="true"></textarea>

                <div class="rp-actions">
                    <button class="rp-button rp-button-primary" id="rpCopyResponse" type="button">
                        Copiar resposta
                    </button>

                    <button class="rp-button rp-button-light" id="rpRestoreResponse" type="button">
                        Restaurar texto
                    </button>

                    ${response.link ? `
                        <button class="rp-button rp-button-dark" id="rpOpenLink" type="button">
                            ${escapeHtml(response.linkLabel || "Abrir ligação")}
                        </button>
                    ` : ""}
                </div>
            </div>
        `;

        target.querySelectorAll("[data-rp-field]").forEach(input => {
            input.addEventListener("input", () => {
                const values = state.fieldValues[response.id] || {};
                values[input.dataset.rpField] = input.value;
                state.fieldValues[response.id] = values;
                refreshPreview();
            });
        });

        const favorite = element("rpEditorFavorite");
        const copy = element("rpCopyResponse");
        const restore = element("rpRestoreResponse");
        const openLink = element("rpOpenLink");

        if (favorite) favorite.addEventListener("click", () => toggleFavorite(response.id));
        if (copy) copy.addEventListener("click", () => copyResponse(response));
        if (restore) restore.addEventListener("click", refreshPreview);
        if (openLink) openLink.addEventListener("click", () => window.open(response.link, "_blank", "noopener,noreferrer"));

        refreshPreview();
    }

    function refreshPreview() {
        const response = findResponse(state.selectedId);
        const preview = element("rpPreview");
        if (!response || !preview) return;
        preview.value = renderTemplate(response);
    }

    function selectResponse(id) {
        if (!findResponse(id)) return;
        state.selectedId = id;
        renderList();
        renderEditor();
    }

    function toggleFavorite(id) {
        if (!id) return;

        if (isFavorite(id)) {
            state.favorites = state.favorites.filter(item => item !== id);
        } else {
            state.favorites = [id, ...state.favorites.filter(item => item !== id)];
        }

        writeStorage(STORAGE.favorites, state.favorites);
        updateStats();
        renderList();
        renderEditor();
    }

    function registerCopy(id) {
        state.usage[id] = usageCount(id) + 1;
        state.recent = [id, ...state.recent.filter(item => item !== id)].slice(0, 30);

        writeStorage(STORAGE.usage, state.usage);
        writeStorage(STORAGE.recent, state.recent);

        updateStats();
        renderList();

        if (typeof window.addDebugLog === "function") {
            window.addDebugLog("STANDARD RESPONSE", `Resposta copiada: ${id}`, "");
        }
    }

    async function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const helper = document.createElement("textarea");
        helper.value = text;
        helper.style.position = "fixed";
        helper.style.left = "-9999px";
        document.body.appendChild(helper);
        helper.focus();
        helper.select();

        try {
            if (!document.execCommand("copy")) {
                throw new Error("O navegador recusou a cópia.");
            }
        } finally {
            helper.remove();
        }
    }

    async function copyResponse(response) {
        const signature = getSignature();
        const preview = element("rpPreview");

        if (!signature.trim()) {
            showToast("Preencha o nome para assinatura.", "error");
            const signatureInput = element("rpSignature");
            if (signatureInput) signatureInput.focus();
            return;
        }

        const text = preview ? preview.value.trim() : renderTemplate(response);

        if (!text) {
            showToast("A resposta está vazia.", "error");
            return;
        }

        try {
            await copyText(text);
            registerCopy(response.id);
            renderEditor();
            showToast("Resposta copiada para a área de transferência.", "success");
        } catch (error) {
            showToast(`Não foi possível copiar: ${error.message}`, "error");
        }
    }

    function bindGlobalEvents() {
        const search = element("rpSearch");
        const clear = element("rpClearFilters");
        const signature = element("rpSignature");
        const greeting = element("rpGreeting");
        const sort = element("rpSort");

        if (search) {
            search.addEventListener("input", () => {
                state.search = search.value;
                renderList();
            });
        }

        if (clear) {
            clear.addEventListener("click", () => {
                state.search = "";
                state.category = "";
                if (search) search.value = "";

                document.querySelectorAll("#rpCategoryChips [data-category]").forEach(button => {
                    button.classList.toggle("active", button.dataset.category === "");
                });

                renderList();
                if (search) search.focus();
            });
        }

        if (signature) {
            signature.addEventListener("input", () => {
                localStorage.setItem(STORAGE.signature, signature.value);
                refreshPreview();
            });
        }

        if (greeting) {
            greeting.addEventListener("change", () => {
                localStorage.setItem(STORAGE.greeting, greeting.value);
                refreshPreview();
            });
        }

        if (sort) {
            sort.addEventListener("change", () => {
                state.sort = sort.value || "title";
                renderList();
            });
        }
    }

    async function loadResponses() {
        const response = await fetch(
            `/module/respostas-padrao/api?action=list&_=${Date.now()}`,
            { cache: "no-store" }
        );

        const text = await response.text();
        let data = null;

        try {
            data = text ? JSON.parse(text) : {};
        } catch (_) {
            throw new Error(`Resposta inválida da API: ${text.slice(0, 160)}`);
        }

        if (!response.ok || !data.success) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        state.responses = Array.isArray(data.responses) ? data.responses : [];
        state.settings = Object.assign(state.settings, data.settings || {});
    }

    async function initialize() {
        try {
            await loadResponses();

            const signature = element("rpSignature");
            const greeting = element("rpGreeting");

            if (signature) {
                signature.value = localStorage.getItem(STORAGE.signature)
                    || state.settings.defaultSignature
                    || "Raphael Vieira";
            }

            if (greeting) {
                greeting.value = localStorage.getItem(STORAGE.greeting) || "auto";
            }

            bindGlobalEvents();
            renderCategories();
            updateStats();

            state.selectedId = state.responses.length ? state.responses[0].id : "";
            renderList();
            renderEditor();
        } catch (error) {
            const list = element("rpResponseList");
            const editor = element("rpEditorPanel");

            if (list) {
                list.innerHTML = `
                    <div class="rp-empty-list">
                        <strong>Não foi possível carregar as respostas</strong>
                        <span>${escapeHtml(error.message)}</span>
                    </div>
                `;
            }

            if (editor) {
                editor.innerHTML = `
                    <div class="rp-empty-detail">
                        <strong>Erro de carregamento</strong>
                        <span>Consulte o Debug para mais detalhes.</span>
                    </div>
                `;
            }

            if (typeof window.addDebugLog === "function") {
                window.addDebugLog("STANDARD RESPONSES ERROR", "Falha ao carregar respostas padrão", error.message);
            }
        }
    }

    initialize();
})();