(function () {
    "use strict";

    var MODULE_ID = "verificacao-utilizadores-reativados";
    var API_URL = "/module/" + MODULE_ID + "/api";
    var NS = "__VUR_MODULE_V104__";

    /*
     * O módulo é carregado dinamicamente.
     * Por isso, os eventos são instalados no document e não dependem
     * do momento em que o HTML do módulo foi inserido.
     */

    if (!window[NS]) {
        window[NS] = {
            initialized: false,
            statusLoaded: false,
            lastResult: null
        };
    }

    var state = window[NS];

    function byId(id) {
        return document.getElementById(id);
    }

    function textValue(value) {
        if (
            value === null ||
            value === undefined ||
            value === ""
        ) {
            return "—";
        }

        return String(value);
    }

    function escapeHtml(value) {
        var div = document.createElement("div");
        div.textContent = textValue(value);
        return div.innerHTML;
    }

    function setProgress(percent, message, visible) {
        var wrap = byId("vurProgressWrap");
        var bar = byId("vurProgressBar");
        var text = byId("vurProgressText");

        if (!wrap || !bar || !text) {
            return;
        }

        wrap.hidden = visible === false;
        bar.style.width =
            Math.max(0, Math.min(100, Number(percent) || 0)) + "%";
        text.textContent = message || "";
    }

    function showClientError(message) {
        var panel = byId("vurDiagnosisPanel");
        var headline = byId("vurDiagnosisHeadline");
        var findings = byId("vurFindings");

        if (panel) {
            panel.hidden = false;
        }

        if (headline) {
            headline.textContent =
                "Não foi possível executar a verificação.";
        }

        if (findings) {
            findings.innerHTML =
                '<div class="vur-alert error">' +
                "<strong>Erro na execução</strong>" +
                "<div>" +
                escapeHtml(message) +
                "</div>" +
                "</div>";
        }

        setProgress(100, "Erro: " + message, true);
    }

    async function callApi(action, payload) {
        var url =
            API_URL +
            "?action=" +
            encodeURIComponent(action);

        console.log(
            "[VUR V1.0.4] API REQUEST",
            url,
            payload || {}
        );

        var response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type":
                    "application/json; charset=utf-8"
            },
            body: JSON.stringify(payload || {})
        });

        var raw = await response.text();
        var data = null;

        console.log(
            "[VUR V1.0.4] API RESPONSE",
            response.status,
            raw
        );

        try {
            data = raw ? JSON.parse(raw) : {};

            /*
             * O router do SantanderSupportWebV2 pode serializar novamente
             * o JSON devolvido pelo api.ps1.
             *
             * Exemplo recebido:
             * "{\"success\":true,\"data\":{...}}"
             *
             * Nesse caso, a primeira conversão produz uma string.
             * Fazemos novas conversões até obter o objeto real.
             */
            var normalizeAttempts = 0;

            while (
                typeof data === "string" &&
                normalizeAttempts < 4
            ) {
                var normalizedText = data.trim();

                if (!normalizedText) {
                    data = {};
                    break;
                }

                data = JSON.parse(normalizedText);
                normalizeAttempts += 1;
            }

            if (
                data === null ||
                typeof data !== "object" ||
                Array.isArray(data)
            ) {
                throw new Error(
                    "A resposta final da API não é um objeto JSON."
                );
            }
        } catch (parseError) {
            throw new Error(
                "A API devolveu uma resposta JSON inválida. " +
                parseError.message +
                " | Resposta: " +
                raw.substring(0, 500)
            );
        }

        console.log(
            "[VUR V1.0.4] API NORMALIZED",
            data
        );

        if (!response.ok || data.success === false) {
            throw new Error(
                data.message ||
                "Erro HTTP " + response.status
            );
        }

        return data;
    }

    function setConnection(key, connected, message) {
        var element = document.querySelector(
            '.vur-connection[data-key="' +
            key +
            '"]'
        );

        if (!element) {
            return;
        }

        element.classList.remove(
            "ok",
            "warn",
            "error"
        );

        if (connected === true) {
            element.classList.add("ok");
        } else if (connected === false) {
            element.classList.add("error");
        } else {
            element.classList.add("warn");
        }

        if (message) {
            element.title = message;
        }
    }

    async function loadStatus() {
        console.log(
            "[VUR V1.0.4] Verificar ligações"
        );

        setProgress(
            15,
            "A verificar ligações...",
            true
        );

        try {
            var data = await callApi(
                "status",
                {}
            );

            var connections =
                data.connections || {};

            setConnection(
                "ad",
                connections.ad
                    ? connections.ad.connected
                    : null,
                connections.ad
                    ? connections.ad.message
                    : ""
            );

            setConnection(
                "exchangeOnPrem",
                connections.exchangeOnPrem
                    ? connections.exchangeOnPrem.connected
                    : null,
                connections.exchangeOnPrem
                    ? connections.exchangeOnPrem.message
                    : ""
            );

            setConnection(
                "graph",
                connections.graph
                    ? connections.graph.connected
                    : null,
                connections.graph
                    ? connections.graph.message
                    : ""
            );

            setConnection(
                "exchangeOnline",
                connections.exchangeOnline
                    ? connections.exchangeOnline.connected
                    : null,
                connections.exchangeOnline
                    ? connections.exchangeOnline.message
                    : ""
            );

            setProgress(
                100,
                "Ligações verificadas.",
                true
            );

            window.setTimeout(function () {
                setProgress(0, "", false);
            }, 1200);
        } catch (error) {
            console.error(
                "[VUR V1.0.4] Erro ao verificar ligações",
                error
            );

            showClientError(error.message);
        }
    }

    function objectStatus(obj) {
        if (!obj) {
            return "Não consultado";
        }

        if (obj.error) {
            return "Erro";
        }

        return obj.found
            ? "Encontrado"
            : "Não encontrado";
    }

    function renderSummary(result) {
        var summary = byId("vurSummary");

        if (summary) {
            summary.hidden = false;
        }

        var fields = {
            vurOverallStatus:
                result.diagnosis
                    ? result.diagnosis.status
                    : "—",

            vurAdStatus:
                objectStatus(result.ad),

            vurOnPremStatus:
                objectStatus(
                    result.exchangeOnPrem
                ),

            vurEntraStatus:
                objectStatus(result.entra),

            vurExoStatus:
                objectStatus(
                    result.exchangeOnline
                ),

            vurGuidStatus:
                result.diagnosis
                    ? result.diagnosis.guidStatus
                    : "—"
        };

        Object.keys(fields).forEach(function (id) {
            var element = byId(id);

            if (element) {
                element.textContent =
                    textValue(fields[id]);
            }
        });
    }

    function renderFindings(findings) {
        var host = byId("vurFindings");

        if (!host) {
            return;
        }

        host.innerHTML = "";

        if (
            !Array.isArray(findings) ||
            findings.length === 0
        ) {
            host.innerHTML =
                '<div class="vur-alert success">' +
                "<strong>" +
                "Nenhuma inconsistência crítica identificada" +
                "</strong>" +
                "<div>" +
                "Os principais atributos consultados estão coerentes." +
                "</div>" +
                "</div>";

            return;
        }

        findings.forEach(function (finding) {
            var item =
                document.createElement("div");

            item.className =
                "vur-alert " +
                (finding.severity || "info");

            item.innerHTML =
                "<strong>" +
                escapeHtml(
                    finding.title ||
                    "Informação"
                ) +
                "</strong>" +
                "<div>" +
                escapeHtml(
                    finding.message || ""
                ) +
                "</div>";

            host.appendChild(item);
        });
    }

    function renderComparison(rows) {
        var body = byId("vurComparisonBody");

        if (!body) {
            return;
        }

        body.innerHTML = "";

        if (!Array.isArray(rows)) {
            return;
        }

        rows.forEach(function (row) {
            var tr =
                document.createElement("tr");

            var className = "warn";

            if (row.status === "OK") {
                className = "ok";
            } else if (row.status === "ERRO") {
                className = "error";
            }

            tr.innerHTML =
                "<td><strong>" +
                escapeHtml(row.attribute) +
                "</strong></td>" +

                "<td>" +
                escapeHtml(
                    textValue(row.ad)
                ) +
                "</td>" +

                "<td>" +
                escapeHtml(
                    textValue(
                        row.exchangeOnPrem
                    )
                ) +
                "</td>" +

                "<td>" +
                escapeHtml(
                    textValue(row.entra)
                ) +
                "</td>" +

                "<td>" +
                escapeHtml(
                    textValue(
                        row.exchangeOnline
                    )
                ) +
                "</td>" +

                '<td><span class="vur-pill ' +
                className +
                '">' +
                escapeHtml(
                    row.status || "AVISO"
                ) +
                "</span></td>";

            body.appendChild(tr);
        });
    }

    function renderJson(id, value) {
        var element = byId(id);

        if (element) {
            element.textContent =
                JSON.stringify(
                    value || {},
                    null,
                    2
                );
        }
    }

    function renderResult(result) {
        state.lastResult = result;

        var diagnosisPanel =
            byId("vurDiagnosisPanel");

        var detailsPanel =
            byId("vurDetailsPanel");

        var commandsPanel =
            byId("vurCommandsPanel");

        var headline =
            byId("vurDiagnosisHeadline");

        if (diagnosisPanel) {
            diagnosisPanel.hidden = false;
        }

        if (detailsPanel) {
            detailsPanel.hidden = false;
        }

        if (headline) {
            headline.textContent =
                textValue(
                    result.diagnosis
                        ? result.diagnosis.summary
                        : ""
                );
        }

        renderSummary(result);

        renderFindings(
            result.diagnosis
                ? result.diagnosis.findings
                : []
        );

        renderComparison(
            result.comparison || []
        );

        renderJson(
            "vurAdDetails",
            result.ad
        );

        renderJson(
            "vurOnPremDetails",
            result.exchangeOnPrem
        );

        renderJson(
            "vurEntraDetails",
            result.entra
        );

        renderJson(
            "vurExoDetails",
            result.exchangeOnline
        );

        var commands =
            result.diagnosis &&
            Array.isArray(
                result.diagnosis
                    .recommendedCommands
            )
                ? result.diagnosis
                    .recommendedCommands
                : [];

        if (commandsPanel) {
            commandsPanel.hidden =
                commands.length === 0;
        }

        var commandText =
            byId("vurCommands");

        if (commandText) {
            commandText.textContent =
                commands.length
                    ? commands.join(
                        "\r\n\r\n"
                    )
                    : "Nenhum comando recomendado.";
        }
    }

    async function verifyUser() {
        console.log(
            "[VUR V1.0.4] Clique em verificar utilizador"
        );

        var input = byId("vurIdentity");
        var button = byId("vurSearchBtn");

        if (!input) {
            showClientError(
                "Campo de utilizador não encontrado na página."
            );
            return;
        }

        var identity =
            input.value.trim();

        if (!identity) {
            input.focus();

            setProgress(
                100,
                "Informe um utilizador.",
                true
            );

            window.setTimeout(function () {
                setProgress(0, "", false);
            }, 1500);

            return;
        }

        if (button) {
            button.disabled = true;
        }

        setProgress(
            10,
            "A iniciar diagnóstico...",
            true
        );

        try {
            var data = await callApi(
                "diagnose",
                {
                    identity: identity
                }
            );

            setProgress(
                90,
                "A preparar o resultado...",
                true
            );

            renderResult(data);

            setProgress(
                100,
                "Diagnóstico concluído.",
                true
            );

            window.setTimeout(function () {
                setProgress(0, "", false);
            }, 1400);
        } catch (error) {
            console.error(
                "[VUR V1.0.4] Erro no diagnóstico",
                error
            );

            showClientError(error.message);
        } finally {
            if (button) {
                button.disabled = false;
            }
        }
    }

    function clearModule() {
        console.log(
            "[VUR V1.0.4] Limpar módulo"
        );

        state.lastResult = null;

        var input = byId("vurIdentity");

        if (input) {
            input.value = "";
            input.focus();
        }

        [
            "vurSummary",
            "vurDiagnosisPanel",
            "vurDetailsPanel",
            "vurCommandsPanel"
        ].forEach(function (id) {
            var element = byId(id);

            if (element) {
                element.hidden = true;
            }
        });

        setProgress(0, "", false);
    }

    function buildDiagnosisText() {
        var result = state.lastResult;

        if (!result) {
            return "";
        }

        var diagnosis =
            result.diagnosis || {};

        var lines = [
            "VERIFICAÇÃO DE UTILIZADOR REATIVADO",
            "===================================",
            "Utilizador: " +
                textValue(result.identity),
            "Data: " +
                textValue(result.generatedAt),
            "Resultado: " +
                textValue(diagnosis.status),
            "ExchangeGuid: " +
                textValue(
                    diagnosis.guidStatus
                ),
            "",
            "RESUMO",
            textValue(diagnosis.summary),
            "",
            "CONSTATAÇÕES"
        ];

        var findings =
            Array.isArray(
                diagnosis.findings
            )
                ? diagnosis.findings
                : [];

        findings.forEach(function (
            finding,
            index
        ) {
            lines.push(
                (index + 1) +
                ". [" +
                String(
                    finding.severity ||
                    "info"
                ).toUpperCase() +
                "] " +
                textValue(finding.title) +
                ": " +
                textValue(finding.message)
            );
        });

        return lines.join("\r\n");
    }

    async function copyText(text) {
        if (!text) {
            return;
        }

        try {
            await navigator.clipboard.writeText(
                text
            );
        } catch (error) {
            var textarea =
                document.createElement(
                    "textarea"
                );

            textarea.value = text;
            document.body.appendChild(
                textarea
            );

            textarea.select();
            document.execCommand("copy");
            textarea.remove();
        }
    }

    /*
     * Delegação global.
     * Funciona mesmo que os botões sejam inseridos depois.
     */
    if (!state.initialized) {
        state.initialized = true;

        document.addEventListener(
            "click",
            function (event) {
                var target =
                    event.target.closest(
                        "#vurSearchBtn, " +
                        "#vurStatusBtn, " +
                        "#vurClearBtn, " +
                        "#vurCopyDiagnosisBtn, " +
                        "#vurCopyCommandsBtn"
                    );

                if (!target) {
                    return;
                }

                event.preventDefault();
                event.stopPropagation();

                console.log(
                    "[VUR V1.0.4] Botão detetado:",
                    target.id
                );

                if (
                    target.id ===
                    "vurSearchBtn"
                ) {
                    verifyUser();
                    return;
                }

                if (
                    target.id ===
                    "vurStatusBtn"
                ) {
                    loadStatus();
                    return;
                }

                if (
                    target.id ===
                    "vurClearBtn"
                ) {
                    clearModule();
                    return;
                }

                if (
                    target.id ===
                    "vurCopyDiagnosisBtn"
                ) {
                    copyText(
                        buildDiagnosisText()
                    );
                    return;
                }

                if (
                    target.id ===
                    "vurCopyCommandsBtn"
                ) {
                    var result =
                        state.lastResult;

                    var commands =
                        result &&
                        result.diagnosis &&
                        Array.isArray(
                            result.diagnosis
                                .recommendedCommands
                        )
                            ? result.diagnosis
                                .recommendedCommands
                                .join(
                                    "\r\n\r\n"
                                )
                            : "";

                    copyText(commands);
                }
            },
            true
        );

        document.addEventListener(
            "keydown",
            function (event) {
                if (
                    event.key !== "Enter" ||
                    !event.target ||
                    event.target.id !==
                        "vurIdentity"
                ) {
                    return;
                }

                event.preventDefault();
                verifyUser();
            },
            true
        );

        console.log(
            "[VUR V1.0.4] Delegação global instalada."
        );
    }

    /*
     * Ao carregar o script, tenta verificar as ligações.
     * Se o HTML ainda não existir, espera até o módulo aparecer.
     */
    function waitForModule() {
        var attempts = 0;
        var maxAttempts = 80;

        function check() {
            var app = byId("vurApp");

            if (app) {
                app.setAttribute(
                    "data-vur-version",
                    "1.0.4"
                );

                console.log(
                    "[VUR V1.0.4] Página localizada."
                );

                if (!state.statusLoaded) {
                    state.statusLoaded = true;
                    loadStatus();
                }

                return;
            }

            attempts += 1;

            if (attempts < maxAttempts) {
                window.setTimeout(
                    check,
                    150
                );
            } else {
                console.warn(
                    "[VUR V1.0.4] Página do módulo não foi localizada."
                );
            }
        }

        check();
    }

    waitForModule();

    /*
     * Funções globais de contingência.
     * Permitem teste manual no Console do navegador.
     */
    window.vurVerifyUser = verifyUser;
    window.vurLoadStatus = loadStatus;
    window.vurClear = clearModule;

    console.log(
        "[VUR V1.0.4] script.js executado."
    );
})();