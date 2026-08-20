(function () {
    "use strict";

    let mbRunning = false;
    const byMbId = id => document.getElementById(id);
    const safeText = value => String(value == null ? "" : value);

    function setInfo(id, message, state) {
        const target = byMbId(id);
        if (!target) return;
        target.className = `field-info ${state || ""}`.trim();
        target.textContent = safeText(message);
    }

    async function requestJson(url, options) {
        const response = await fetch(url, Object.assign({ cache: "no-store" }, options || {}));
        const text = await response.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; }
        catch (_) { throw new Error("O servidor devolveu uma resposta inválida."); }
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
    }

    async function validar(tipo) {
        const config = {
            user: { field: "mbUser", info: "mbUserInfo", action: "validateUser" },
            origem: { field: "mbOrigem", info: "mbOrigemInfo", action: "validateBalcao" },
            destino: { field: "mbDestino", info: "mbDestinoInfo", action: "validateBalcao" }
        }[tipo];
        if (!config) return false;

        const value = byMbId(config.field).value.trim();
        if (!value) { setInfo(config.info, "Aguardando...", ""); return false; }
        setInfo(config.info, "A pesquisar...", "loading");

        try {
            const url = `/module/mudanca-balcao/api?action=${config.action}&user=${encodeURIComponent(value)}&numero=${encodeURIComponent(value)}&tipo=${encodeURIComponent(tipo)}`;
            const data = await requestJson(url);
            if (!data.success) throw new Error(data.error || "Não encontrado.");
            setInfo(config.info, `${data.displayName || value}${data.email ? ` — ${data.email}` : ""}`, "ok");
            return true;
        } catch (error) {
            setInfo(config.info, error.message || "Erro ao validar.", "error");
            return false;
        }
    }

    function setRunning(value) {
        mbRunning = value;
        const button = byMbId("mbExecuteButton");
        if (button) {
            button.disabled = value;
            button.textContent = value ? "A executar..." : "Validar e executar";
        }
    }

    async function executar() {
        if (mbRunning) return;
        const user = byMbId("mbUser").value.trim();
        const origem = byMbId("mbOrigem").value.trim();
        const destino = byMbId("mbDestino").value.trim();
        const resultado = byMbId("mbResultado");
        const resposta = byMbId("mbResposta");

        resposta.value = "";
        resetarProgressGlobal("mbProgressGlobal");
        if (!user || !origem || !destino) {
            finalizarProgressGlobal("mbProgressGlobal", false, "Preencha o utilizador e os balcões com quatro algarismos.");
            resultado.textContent = "Preencha corretamente todos os campos obrigatórios.";
            return;
        }
        if (origem === destino) {
            finalizarProgressGlobal("mbProgressGlobal", false, "A origem e o destino devem ser diferentes.");
            resultado.textContent = "O balcão de origem e o de destino devem ser diferentes.";
            return;
        }

        const valid = await Promise.all([validar("user"), validar("origem"), validar("destino")]);
        if (!valid[0]) {
            finalizarProgressGlobal("mbProgressGlobal", false, "O utilizador não foi validado.");
            resultado.textContent = "Corrija o utilizador antes de executar.";
            return;
        }

        const missingBranches = [];
        if (!valid[1]) missingBranches.push(`origem ${origem}`);
        if (!valid[2]) missingBranches.push(`destino ${destino}`);
        const warning = missingBranches.length
            ? `\n\nAtenção: não foi encontrado o balcão de ${missingBranches.join(" e ")}. Apenas as operações válidas serão executadas e a ocorrência será incluída no ticket.`
            : "";
        if (!window.confirm(`Confirma o processamento de ${user}, origem ${origem}, destino ${destino}?${warning}`)) return;

        setRunning(true);
        atualizarProgressGlobal("mbProgressGlobal", 35, "A aplicar permissões no balcão de destino...");
        resultado.textContent = "Operação em curso. Não feche esta página.";

        try {
            const data = await requestJson("/module/mudanca-balcao/api?action=execute", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user, origem, destino })
            });
            resposta.value = data.ticketResponse || "";
            if (!data.success) throw new Error(data.error || "Não foi possível concluir a mudança.");
            finalizarProgressGlobal("mbProgressGlobal", true, "Processo concluído com sucesso.");
            resultado.textContent = data.message || "Mudança de balcão processada.";
        } catch (error) {
            finalizarProgressGlobal("mbProgressGlobal", false, error.message || "Erro inesperado.");
            resultado.textContent = `Erro: ${error.message || "Erro inesperado."}`;
        } finally {
            setRunning(false);
        }
    }

    async function copiar() {
        const resposta = byMbId("mbResposta");
        if (!resposta || !resposta.value.trim()) {
            if (typeof mostrarToast === "function") mostrarToast("Não existe resposta para copiar.", "error");
            return;
        }
        try {
            await navigator.clipboard.writeText(resposta.value);
            if (typeof mostrarToast === "function") mostrarToast("Resposta copiada.", "success");
        } catch (_) {
            resposta.focus();
            resposta.select();
            document.execCommand("copy");
        }
    }

    function limpar() {
        if (mbRunning) return;

        ["mbUser", "mbOrigem", "mbDestino"].forEach(id => {
            const field = byMbId(id);
            if (field) field.value = "";
        });

        setInfo("mbUserInfo", "Aguardando utilizador...", "");
        setInfo("mbOrigemInfo", "Aguardando balcão de origem...", "");
        setInfo("mbDestinoInfo", "Aguardando balcão de destino...", "");

        const resposta = byMbId("mbResposta");
        const resultado = byMbId("mbResultado");
        if (resposta) resposta.value = "";
        if (resultado) resultado.textContent = "Aguardando execução...";

        resetarProgressGlobal("mbProgressGlobal");
        const firstField = byMbId("mbUser");
        if (firstField) firstField.focus();
    }

    const bindings = [
        ["mbUser", "blur", () => validar("user")],
        ["mbOrigem", "blur", () => validar("origem")],
        ["mbDestino", "blur", () => validar("destino")],
        ["mbExecuteButton", "click", executar],
        ["mbClearButton", "click", limpar],
        ["mbCopyButton", "click", copiar]
    ];
    bindings.forEach(([id, event, handler]) => {
        const element = byMbId(id);
        if (element) element.addEventListener(event, handler);
    });

    if (typeof criarPainelConexaoModulo === "function") {
        criarPainelConexaoModulo("exchangeConnectionBox", { exchange: true });
    }
})();
