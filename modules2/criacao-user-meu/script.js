let MEU_MANUAL_MFA_PADRAO = "";
let MEU_CC_PADRAO = "";
let MEU_GRUPO_E3 = "";

window.meuWindowsFullName = "";
window.meuTemLicencaE3 = false;
window.meuArquivoOnlineOk = false;
window.meuRecipientLimitOk = false;
window.meuManualMfaSelecionado = "";
window.meuWorkflowRunning = false;
window.meuWorkflowNextStep = 0;
window.meuWorkflowStartedAt = 0;
window.meuWorkflowTimer = null;

async function meuApi(action, user, extraQuery) {
    let url = "/module/criacao-user-meu/api?action=" + encodeURIComponent(action || "") +
        "&user=" + encodeURIComponent(user || "");

    if (extraQuery) {
        url += "&" + extraQuery;
    }

    const response = await fetch(url, {
        method: "POST",
        cache: "no-store"
    });

    const text = await response.text();
    let parsed;

    try {
        parsed = JSON.parse(text);
        if (typeof parsed === "string") parsed = JSON.parse(parsed);
    } catch (error) {
        throw new Error("Resposta inválida da API: " + text.substring(0, 500));
    }

    if (!response.ok && (!parsed || parsed.success !== false)) {
        throw new Error("HTTP " + response.status + " ao executar " + action + ".");
    }

    return parsed;
}

function meuEl(id) {
    return document.getElementById(id);
}

function meuText(id) {
    const el = meuEl(id);
    return el ? (el.textContent || "").trim() : "";
}

function meuValue(id) {
    const el = meuEl(id);
    return el ? (el.value || "").trim() : "";
}

function meuSet(id, value) {
    const el = meuEl(id);
    if (el) el.textContent = value === undefined || value === null || value === "" ? "-" : String(value);
}

function meuSetValue(id, value) {
    const el = meuEl(id);
    if (el) el.value = value === undefined || value === null ? "" : String(value);
}

function meuSetResultado(texto) {
    meuSetValue("meuResultado", texto || "");
}

function meuSetOverallStatus(texto, tipo) {
    const status = meuEl("meuOverallStatus");
    if (!status) return;
    status.className = "meu-overall-status " + (tipo || "neutral");
    status.textContent = texto || "Aguardando pesquisa";
}

function meuDebugTexto(result, textoBase) {
    let texto = textoBase || "";

    if (result && Array.isArray(result.debug) && result.debug.length) {
        texto += "\n\n==================== DEBUG ====================\n";
        texto += result.debug.join("\n");
    }

    return texto;
}

function meuSetButtonBusy(functionName, busy, busyText) {
    document.querySelectorAll('[onclick="' + functionName + '()"]')
        .forEach(function(button) {
            if (!button.dataset.originalText) {
                button.dataset.originalText = button.textContent;
            }

            button.disabled = !!busy;
            button.textContent = busy ? (busyText || "A processar...") : button.dataset.originalText;
        });
}

function meuProgressSetGroup(prefix, percent, titulo, mensagem, show) {
    const area = meuEl(prefix + "Area");
    const bar = meuEl(prefix + "Bar");
    const percentEl = meuEl(prefix + "Percent");
    const tituloEl = meuEl(prefix + "Titulo");
    const msgEl = meuEl(prefix + "Mensagem");
    const value = Math.max(0, Math.min(100, Number(percent) || 0));

    if (area && show !== false) area.style.display = "block";
    if (bar) bar.style.width = value + "%";
    if (percentEl) percentEl.textContent = value + "%";
    if (tituloEl && titulo) tituloEl.textContent = titulo;
    if (msgEl && mensagem) msgEl.textContent = mensagem;
}

function meuProgressHideGroup(prefix, delay) {
    window.setTimeout(function() {
        const area = meuEl(prefix + "Area");
        if (area) area.style.display = "none";
        meuProgressSetGroup(prefix, 0, "Processando...", "A iniciar operação...", false);
    }, delay || 900);
}

function meuProgressShow(titulo, mensagem) {
    meuProgressSetGroup("meuProgress", 5, titulo || "Processando...", mensagem || "A iniciar operação...");
}

function meuProgressSet(percent, titulo, mensagem) {
    meuProgressSetGroup("meuProgress", percent, titulo, mensagem);
}

function meuProgressHide(delay) {
    meuProgressHideGroup("meuProgress", delay);
}

function meuTpaProgressShow(titulo, mensagem) {
    meuProgressSetGroup("meuTpaProgress", 5, titulo || "Criando TPA...", mensagem || "A iniciar criação do TPA...");
}

function meuTpaProgressSet(percent, titulo, mensagem) {
    meuProgressSetGroup("meuTpaProgress", percent, titulo, mensagem);
}

function meuTpaProgressHide(delay) {
    meuProgressHideGroup("meuTpaProgress", delay);
}

function meuE3ProgressShow(titulo, mensagem) {
    meuProgressSetGroup("meuE3Progress", 5, titulo || "Licença E3", mensagem || "A iniciar operação...");
}

function meuE3ProgressSet(percent, titulo, mensagem) {
    meuProgressSetGroup("meuE3Progress", percent, titulo, mensagem);
}

function meuE3ProgressHide(delay) {
    meuProgressHideGroup("meuE3Progress", delay);
}

function meuArquivoOnlineProgressSet(percent, titulo, mensagem) {
    meuProgressSetGroup("meuArquivoOnlineProgress", percent, titulo, mensagem);
}

function meuArquivoOnlineProgressHide(delay) {
    meuProgressHideGroup("meuArquivoOnlineProgress", delay);
}

function meuSetE3Status(temLicenca, texto) {
    const bolinha = meuEl("meuE3Bolinha");
    const status = meuEl("meuE3StatusTexto");

    if (bolinha) bolinha.style.background = temLicenca ? "#198754" : "#dc3545";
    if (status) status.textContent = texto || (temLicenca ? "Licença E3 atribuída" : "Licença E3 não atribuída");

    window.meuTemLicencaE3 = !!temLicenca;
    meuAtualizarTextosDerivados();
}

function meuArquivoOnlineSetStatus(ativo, texto) {
    const bolinha = meuEl("meuArquivoOnlineBolinha");
    const label = meuEl("meuArquivoOnlineStatus");

    if (bolinha) bolinha.style.background = ativo ? "#198754" : "#dc3545";
    if (label) label.textContent = texto || (ativo ? "Arquivo Online ativo" : "Arquivo Online não ativo");

    window.meuArquivoOnlineOk = !!ativo;
    meuAtualizarTextosDerivados();
}

function meuGetManualMfaPathFinal() {
    let path = meuValue("meuManualMfaPath") || window.meuManualMfaSelecionado || "";

    try {
        if (!path) path = localStorage.getItem("meuManualMfaPath") || "";
    } catch (_) {}

    if (!path || path.toLowerCase().includes("fakepath")) {
        path = MEU_MANUAL_MFA_PADRAO;
    }

    return path;
}

function meuSetManualMfaPath(path) {
    window.meuManualMfaSelecionado = path || MEU_MANUAL_MFA_PADRAO;
    meuSetValue("meuManualMfaPath", window.meuManualMfaSelecionado);

    try {
        localStorage.setItem("meuManualMfaPath", window.meuManualMfaSelecionado);
    } catch (_) {}
}

function meuGetEmailServexternos() {
    const emailEntra = meuText("infoEmailEntra");
    const sam = meuText("infoSam");
    const input = meuValue("meuInputUser");
    let local = "";

    if (emailEntra && emailEntra.includes("@") && emailEntra !== "Sem email preenchido") {
        local = emailEntra.split("@")[0];
    } else if (sam && sam !== "-") {
        local = sam;
    } else if (input) {
        local = input.includes("@") ? input.split("@")[0] : input;
    }

    return local ? local + "@servexternos.santander.pt" : "";
}

function meuResetStatusCards() {
    meuSetE3Status(false, "Licença não verificada");
    meuArquivoOnlineSetStatus(false, "Arquivo Online não verificado");
    meuSetValue("meuRecipientLimit", "50");
    const limitStatus = meuEl("meuRecipientLimitStatus");
    if (limitStatus) {
        limitStatus.className = "meu-field-status";
        limitStatus.textContent = "Valor padrão: 50 destinatários.";
    }
    window.meuRecipientLimitOk = false;
    meuSetOverallStatus("Aguardando pesquisa", "neutral");
}

function meuLimpar() {
    meuSetValue("meuInputUser", "");

    const infoCard = meuEl("meuInfoCard");
    if (infoCard) infoCard.style.display = "none";

    [
        "meuNumeroTicket", "meuContato1", "meuContato2", "meuContato3", "meuSupervisao",
        "meuContato1Email", "meuContato2Email", "meuContato3Email", "meuSupervisaoEmail",
        "meuTpaValor", "meuTpaValidade", "meuEmailAssunto", "meuEmailPara", "meuEmailHtmlBox"
    ].forEach(function(id) { meuSetValue(id, ""); });

    meuSetValue("meuComandosBox", "Aguardando pesquisa do utilizador...");
    meuSetValue("meuRespostaTicketBox", "Aguardando dados do utilizador...");
    meuSetValue("meuE3Grupo", MEU_GRUPO_E3);
    meuSetValue("meuEmailCc", MEU_CC_PADRAO);
    meuSetManualMfaPath(meuGetManualMfaPathFinal());
    meuSetResultado("Aguardando...");
    meuResetStatusCards();
}

function preencherInformacoes(data) {
    const infoCard = meuEl("meuInfoCard");
    if (infoCard) infoCard.style.display = "block";

    meuSet("infoNome", data.nome);
    meuSet("infoUPN", data.upn);
    meuSet("infoEmailEntra", data.emailEntra);
    meuSet("infoEstadoEntra", data.estadoEntra);
    meuSet("infoObjectId", data.objectId);
    meuSet("infoDominioAD", data.dominioAD);
    meuSet("infoSam", data.samAccountName);
    meuSet("infoEstadoAD", data.estadoAD);
    meuSet("infoExoExiste", data.exoExiste || "A verificar...");
    meuSet("infoExoDetalhe", data.exoDetalhe || "A verificar em segundo plano...");
    meuSet("infoCriacaoAD", data.dataCriacaoAD);
    meuSet("infoDN", data.dn);

    meuGerarComandos();
    meuAtualizarTextosDerivados();
}
function meuMostrar(result) {
    const textoBase = result && result.data && result.data.resultadoTexto
        ? result.data.resultadoTexto
        : JSON.stringify(result, null, 2);

    meuSetResultado(meuDebugTexto(result, textoBase));
}

async function meuPesquisar() {
    const user = meuValue("meuInputUser");

    if (!user) {
        meuSetResultado("Informe um utilizador para pesquisar.");
        return;
    }

    const infoCard = meuEl("meuInfoCard");
    if (infoCard) infoCard.style.display = "none";

    meuSetButtonBusy("meuPesquisar", true, "A pesquisar...");
    meuResetStatusCards();
    meuSetOverallStatus("A pesquisar utilizador", "loading");
    meuProgressShow("Pesquisar utilizador", "A consultar Entra ID e AD Local...");
    meuSetResultado("A pesquisar o utilizador...");

    try {
        meuProgressSet(35, "Pesquisar utilizador", "A consultar Microsoft Graph...");
        const result = await meuApi("pesquisar", user);

        if (!result.success) {
            throw new Error(result.error || "Falha na pesquisa.");
        }

        meuProgressSet(75, "Pesquisar utilizador", "A apresentar dados encontrados...");
        preencherInformacoes(result.data || {});
        meuMostrar(result);
        meuSetOverallStatus("Utilizador carregado", "success");
        meuProgressSet(100, "Pesquisa concluída", "Dados principais carregados. EXO e E3 continuam em segundo plano.");

        Promise.allSettled([
            meuVerificarE3(true),
            meuVerificarExoEmSegundoPlano((result.data && result.data.upn) || user)
        ]).then(function() {
            meuAtualizarTextosDerivados();
        });
    } catch (error) {
        meuSetResultado("Erro ao pesquisar: " + error.message);
        meuProgressSet(100, "Erro", "Falha na pesquisa.");
    } finally {
        meuSetButtonBusy("meuPesquisar", false);
        meuProgressHide(1100);
    }
}

async function meuVerificarExoEmSegundoPlano(user) {
    meuSet("infoExoExiste", "A verificar...");
    meuSet("infoExoDetalhe", "A consultar Exchange Online...");
    meuArquivoOnlineSetStatus(false, "A verificar Arquivo Online...");

    try {
        const result = await meuApi("verificar-exo", user);

        if (!result.success) {
            throw new Error(result.error || "Falha ao consultar EXO.");
        }

        const data = result.data || {};
        meuSet("infoExoExiste", data.exoExiste || "Não");
        meuSet("infoExoDetalhe", data.exoDetalhe || "Sem detalhe");

        const ativo = data.archiveEnabled === true || String(data.archiveStatus || "").toLowerCase() === "active";
        meuArquivoOnlineSetStatus(
            ativo,
            ativo ? "Arquivo Online ativo/verificado" : "Arquivo Online não ativo (" + (data.archiveStatus || "None") + ")"
        );
    } catch (error) {
        meuSet("infoExoExiste", "Erro");
        meuSet("infoExoDetalhe", error.message);
        meuArquivoOnlineSetStatus(false, "Erro ao verificar Arquivo Online");
    }
}

async function meuCriarTPA() {
    const user = meuText("infoUPN") !== "-" ? meuText("infoUPN") : meuValue("meuInputUser");

    if (!user) {
        meuSetResultado("Informe ou pesquise um utilizador antes de criar o TPA.");
        return;
    }

    meuSetValue("meuTpaValor", "");
    meuSetValue("meuTpaValidade", "");
    meuSetButtonBusy("meuCriarTPA", true, "A criar TPA...");
    meuTpaProgressShow("Criando TPA", "A enviar pedido direto ao Microsoft Graph...");
    meuTpaProgressSet(30, "Criando TPA", "A processar o utilizador...");

    try {
        const result = await meuApi("criar-tpa", user);

        if (!result.success) {
            throw new Error(result.error || "Falha ao criar TPA.");
        }

        const data = result.data || {};
        const tpa = data.temporaryAccessPass || "";
        const validade = data.validade || "8 horas";

        if (!tpa) {
            throw new Error("A API não devolveu o valor do Temporary Access Pass.");
        }

        meuSetValue("meuTpaValor", tpa);
        meuSetValue("meuTpaValidade", validade);
        meuTpaProgressSet(100, "TPA criado", "Temporary Access Pass gerado com sucesso.");
        meuSetResultado(meuDebugTexto(result, data.resultadoTexto || "TPA criado com sucesso."));
        meuAtualizarTextosDerivados();
    } catch (error) {
        meuSetResultado("Erro ao criar TPA: " + error.message);
        meuTpaProgressSet(100, "Erro ao criar TPA", error.message);
    } finally {
        meuSetButtonBusy("meuCriarTPA", false);
        meuTpaProgressHide(1400);
    }
}

async function meuVerificarE3(silencioso) {
    const user = meuText("infoUPN") !== "-" ? meuText("infoUPN") : meuValue("meuInputUser");
    if (!user) return;

    meuE3ProgressShow("Verificar Licença E3", "A consultar o grupo de licença...");
    meuE3ProgressSet(35, "Verificar Licença E3", "A validar associação no Graph...");
    meuSetE3Status(false, "A verificar licença E3...");

    try {
        const result = await meuApi("verificar-e3", user);

        if (!result.success) {
            throw new Error(result.error || "Falha ao verificar E3.");
        }

        const data = result.data || {};
        meuSetE3Status(!!data.temLicenca, data.mensagem);
        meuE3ProgressSet(100, "Verificação concluída", data.mensagem || "Estado atualizado.");

        if (!silencioso) {
            meuSetResultado(meuDebugTexto(result, data.resultadoTexto || data.mensagem));
        }
    } catch (error) {
        meuSetE3Status(false, "Erro ao verificar licença E3");
        meuE3ProgressSet(100, "Erro na verificação", error.message);

        if (!silencioso) {
            meuSetResultado("Erro ao verificar E3: " + error.message);
        }
    } finally {
        meuE3ProgressHide(1000);
    }
}

async function meuAtribuirE3() {
    const user = meuText("infoUPN") !== "-" ? meuText("infoUPN") : meuValue("meuInputUser");

    if (!user) {
        meuSetResultado("Informe ou pesquise um utilizador antes de atribuir a licença E3.");
        return;
    }

    meuSetButtonBusy("meuAtribuirE3", true, "A atribuir E3...");
    meuE3ProgressShow("Atribuir Licença E3", "A enviar associação direta ao grupo...");
    meuE3ProgressSet(35, "Atribuir Licença E3", "A validar o utilizador e o grupo...");
    meuSetE3Status(false, "A atribuir licença E3...");

    try {
        const result = await meuApi("atribuir-e3", user);

        if (!result.success) {
            throw new Error(result.error || "Falha ao atribuir E3.");
        }

        const data = result.data || {};
        meuSetE3Status(true, data.mensagem || "Licença E3 atribuída/verificada");
        meuE3ProgressSet(100, "Licença E3 concluída", "Associação ao grupo concluída. Propagação ocorre em segundo plano.");
        meuSetResultado(meuDebugTexto(result, data.resultadoTexto || data.mensagem));
    } catch (error) {
        meuSetE3Status(false, "Erro ao atribuir licença E3");
        meuE3ProgressSet(100, "Erro na atribuição", error.message);
        meuSetResultado("Erro ao atribuir E3: " + error.message);
    } finally {
        meuSetButtonBusy("meuAtribuirE3", false);
        meuE3ProgressHide(1300);
    }
}

async function meuAtivarArquivoOnlineExo() {
    const user = meuText("infoUPN") !== "-" ? meuText("infoUPN") : meuValue("meuInputUser");

    if (!user) {
        meuSetResultado("Pesquise primeiro o utilizador antes de ativar o Arquivo Online.");
        return;
    }

    meuSetButtonBusy("meuAtivarArquivoOnlineExo", true, "A ativar arquivo...");
    meuArquivoOnlineSetStatus(false, "A ativar Arquivo Online...");
    meuArquivoOnlineProgressSet(15, "Arquivo Online EXO", "A verificar a mailbox...");

    try {
        const result = await meuApi("ativar-arquivo-online", user);

        if (!result.success) {
            throw new Error(result.error || "Falha ao ativar Arquivo Online.");
        }

        const data = result.data || {};
        meuArquivoOnlineProgressSet(100, "Arquivo Online EXO", data.mensagem || "Pedido concluído.");
        meuArquivoOnlineSetStatus(true, data.alreadyActive ? "Arquivo Online já ativo" : "Ativação enviada ao Exchange Online");
        meuSetResultado(meuDebugTexto(result, data.resultadoTexto || data.mensagem));
    } catch (error) {
        meuArquivoOnlineSetStatus(false, "Erro ao ativar Arquivo Online");
        meuArquivoOnlineProgressSet(100, "Erro no Arquivo Online", error.message);
        meuSetResultado("Erro ao ativar Arquivo Online: " + error.message);
    } finally {
        meuSetButtonBusy("meuAtivarArquivoOnlineExo", false);
        meuArquivoOnlineProgressHide(1500);
    }
}

async function meuDefinirRecipientLimit() {
    const user = meuText("infoUPN") && meuText("infoUPN") !== "-" ? meuText("infoUPN") : meuValue("meuInputUser");
    const input = meuEl("meuRecipientLimit");
    const limit = Number(input ? input.value : "");
    const status = meuEl("meuRecipientLimitStatus");

    const setStatus = function(message, type) {
        if (!status) return;
        status.className = "meu-field-status" + (type ? " " + type : "");
        status.textContent = message;
    };

    if (!user) {
        setStatus("Pesquise primeiro o utilizador.", "error");
        meuSetResultado("Pesquise primeiro o utilizador.");
        return;
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        setStatus("Informe um número inteiro entre 1 e 1000.", "error");
        meuSetResultado("Informe um limite inteiro entre 1 e 1000.");
        if (input) input.focus();
        return;
    }

    meuSetButtonBusy("meuDefinirRecipientLimit", true, "A aplicar...");
    setStatus("A aplicar o limite no Exchange Online...", "");

    try {
        const query = new URLSearchParams({ limit: String(limit) }).toString();
        const result = await meuApi("definir-limite-destinatarios", user, query);
        if (!result.success) throw new Error(result.error || "Falha ao definir o limite de destinatários.");
        const message = result.data && result.data.mensagem ? result.data.mensagem : "Limite de destinatários definido com sucesso.";
        window.meuRecipientLimitOk = true;
        setStatus(message, "success");
        meuSetResultado(message);
    } catch (error) {
        setStatus(error.message, "error");
        meuSetResultado("Erro ao definir limite de destinatários: " + error.message);
    } finally {
        meuSetButtonBusy("meuDefinirRecipientLimit", false);
    }
}

function meuWorkflowSetStep(index, state, statusText) {
    const step = document.querySelector('[data-workflow-step="' + index + '"]');
    if (!step) return;
    step.className = "meu-workflow-step " + state;
    const icon = step.querySelector(".meu-workflow-step-icon");
    const status = step.querySelector("em");
    if (icon) icon.textContent = state === "success" ? "✓" : state === "error" ? "!" : state === "running" ? "…" : String(index + 1);
    if (status) status.textContent = statusText || (state === "success" ? "Concluído" : state === "error" ? "Erro" : state === "running" ? "Em execução" : "Aguardando");
}

function meuWorkflowSetProgress(completed, title) {
    const total = 8;
    const percent = Math.round((Math.max(0, Math.min(total, completed)) / total) * 100);
    const bar = meuEl("meuWorkflowProgressBar");
    const percentEl = meuEl("meuWorkflowPercent");
    const text = meuEl("meuWorkflowProgressText");
    if (bar) bar.style.width = percent + "%";
    if (percentEl) percentEl.textContent = percent + "%";
    if (text && title) text.textContent = title;
}

function meuWorkflowSetMessage(message, type) {
    const el = meuEl("meuWorkflowMessage");
    if (!el) return;
    el.className = "meu-workflow-message" + (type ? " " + type : "");
    el.textContent = message;
}

function meuWorkflowStartClock(reset) {
    if (reset) window.meuWorkflowStartedAt = Date.now();
    if (window.meuWorkflowTimer) window.clearInterval(window.meuWorkflowTimer);
    const update = function() {
        const elapsed = window.meuWorkflowStartedAt ? Math.max(0, Math.round((Date.now() - window.meuWorkflowStartedAt) / 1000)) : 0;
        const el = meuEl("meuWorkflowElapsed");
        if (el) el.textContent = "Tempo total: " + elapsed + "s";
    };
    update();
    window.meuWorkflowTimer = window.setInterval(update, 1000);
}

function meuWorkflowStopClock() {
    if (window.meuWorkflowTimer) window.clearInterval(window.meuWorkflowTimer);
    window.meuWorkflowTimer = null;
}

function meuWorkflowOpen(reset) {
    const overlay = meuEl("meuWorkflowOverlay");
    if (!overlay) return;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    if (reset) {
        for (let index = 0; index < 8; index++) meuWorkflowSetStep(index, "pending", "Aguardando");
        meuWorkflowSetProgress(0, "Preparar configuração");
        meuWorkflowSetMessage("A validar os dados necessários para iniciar.", "");
        const retry = meuEl("meuWorkflowRetry");
        if (retry) retry.style.display = "none";
    }
    const close = meuEl("meuWorkflowClose");
    if (close) close.disabled = true;
}

function meuWorkflowValidation() {
    const user = meuText("infoUPN") && meuText("infoUPN") !== "-" ? meuText("infoUPN") : "";
    if (!user) throw new Error("Pesquise e carregue o utilizador antes de iniciar a configuração.");
    if (!meuValue("meuNumeroTicket")) throw new Error("Preencha o número do ticket antes de iniciar a configuração.");
    const responsaveis = ["meuContato1", "meuContato2", "meuContato3", "meuSupervisao"].map(meuValue).filter(Boolean);
    if (!responsaveis.length) throw new Error("Preencha pelo menos um responsável ou contacto do utilizador.");
    const limit = Number(meuValue("meuRecipientLimit"));
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("O limite de destinatários deve ser um inteiro entre 1 e 1000.");
    return { user, limit };
}

async function meuWorkflowExecuteStep(index, context) {
    if (index === 0) return meuWorkflowValidation();

    if (index === 1) {
        const result = await meuApi("criar-tpa", context.user);
        if (!result.success) throw new Error(result.error || "Falha ao criar o TPA.");
        const data = result.data || {};
        if (!data.temporaryAccessPass) throw new Error("A API não devolveu o Temporary Access Pass.");
        meuSetValue("meuTpaValor", data.temporaryAccessPass);
        meuSetValue("meuTpaValidade", data.validade || "8 horas");
        return context;
    }

    if (index === 2) {
        const result = await meuApi("atribuir-e3", context.user);
        if (!result.success) throw new Error(result.error || "Falha ao atribuir a licença E3.");
        const data = result.data || {};
        meuSetE3Status(true, data.mensagem || "Licença E3 atribuída/verificada");
        return context;
    }

    if (index === 3) {
        const result = await meuApi("ativar-arquivo-online", context.user);
        if (!result.success) throw new Error(result.error || "Falha ao ativar o Arquivo Online.");
        const data = result.data || {};
        meuArquivoOnlineSetStatus(true, data.alreadyActive ? "Arquivo Online já ativo" : "Ativação enviada ao Exchange Online");
        return context;
    }

    if (index === 4) {
        const query = new URLSearchParams({ limit: String(context.limit) }).toString();
        const result = await meuApi("definir-limite-destinatarios", context.user, query);
        if (!result.success) throw new Error(result.error || "Falha ao definir o limite de destinatários.");
        const status = meuEl("meuRecipientLimitStatus");
        if (status) {
            status.className = "meu-field-status success";
            status.textContent = result.data && result.data.mensagem ? result.data.mensagem : "Limite aplicado.";
        }
        window.meuRecipientLimitOk = true;
        return context;
    }

    if (index === 5) {
        meuGerarComandos();
        meuAtualizarTextosDerivados();
        return context;
    }

    if (index === 6) {
        await meuCopiarRespostaTicket();
        return context;
    }

    await meuAbrirEmailOutlook(true);
    return context;
}

async function meuRunWorkflow(startIndex) {
    if (window.meuWorkflowRunning) return;
    window.meuWorkflowRunning = true;
    window.meuWorkflowNextStep = startIndex;
    meuSetButtonBusy("meuConfigurarUtilizador", true, "A configurar...");
    const retry = meuEl("meuWorkflowRetry");
    const close = meuEl("meuWorkflowClose");
    if (retry) retry.style.display = "none";
    if (close) close.disabled = true;
    meuSetOverallStatus("Configuração em curso", "loading");

    let context;
    try {
        context = meuWorkflowValidation();
        for (let index = startIndex; index < 8; index++) {
            window.meuWorkflowNextStep = index;
            meuWorkflowSetStep(index, "running", "Em execução");
            meuWorkflowSetProgress(index, index === 0 ? "Validar dados" : "Executar etapa " + (index + 1) + " de 8");
            meuWorkflowSetMessage("A executar: " + (document.querySelector('[data-workflow-step="' + index + '"] strong')?.textContent || "etapa") + ".", "");
            context = await meuWorkflowExecuteStep(index, context);
            meuWorkflowSetStep(index, "success", "Concluído");
            meuWorkflowSetProgress(index + 1, index === 7 ? "Configuração concluída" : "Etapa concluída");
            window.meuWorkflowNextStep = index + 1;
        }

        meuWorkflowSetMessage("Configuração terminada com sucesso. Os dados e documentos foram atualizados.", "success");
        meuSetResultado("Configuração automática concluída com sucesso para " + context.user + ".");
        meuSetOverallStatus("Configuração concluída", "success");
    } catch (error) {
        const failedIndex = Math.min(window.meuWorkflowNextStep, 7);
        meuWorkflowSetStep(failedIndex, "error", "Erro");
        meuWorkflowSetProgress(failedIndex, "Configuração interrompida");
        meuWorkflowSetMessage(error.message || "Erro desconhecido durante a configuração.", "error");
        meuSetResultado("Configuração automática interrompida: " + (error.message || "Erro desconhecido."));
        meuSetOverallStatus("Configuração interrompida", "error");
        if (retry) retry.style.display = "inline-flex";
    } finally {
        window.meuWorkflowRunning = false;
        meuSetButtonBusy("meuConfigurarUtilizador", false);
        meuWorkflowStopClock();
        if (close) close.disabled = false;
    }
}

function meuConfigurarUtilizador() {
    if (window.meuWorkflowRunning) return;
    window.meuWorkflowNextStep = 0;
    meuWorkflowOpen(true);
    meuWorkflowStartClock(true);
    meuRunWorkflow(0);
}

function meuRetomarConfiguracao() {
    if (window.meuWorkflowRunning) return;
    meuWorkflowStartClock(false);
    meuRunWorkflow(Math.max(0, Math.min(7, window.meuWorkflowNextStep)));
}

function meuFecharWorkflow() {
    if (window.meuWorkflowRunning) return;
    const overlay = meuEl("meuWorkflowOverlay");
    if (!overlay) return;
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
}

async function meuPesquisarEmailResponsavel(inputId, emailId) {
    const input = meuEl(inputId);
    const email = meuEl(emailId);
    if (!input || !email) return;

    const user = input.value.trim();
    email.value = "";

    if (!user) {
        meuAtualizarTextosDerivados();
        return;
    }

    email.value = "A pesquisar...";

    try {
        const result = await meuApi("buscar-email", user);
        email.value = result.success && result.data && result.data.email ? result.data.email : "Não encontrado";
    } catch (_) {
        email.value = "Erro";
    }

    meuAtualizarTextosDerivados();
}

function meuGerarComandos() {
    const user = meuText("infoSam") && meuText("infoSam") !== "-" ? meuText("infoSam") : meuValue("meuInputUser");
    const dominioTexto = meuText("infoDominioAD");
    const dominio = dominioTexto && dominioTexto !== "-" && dominioTexto !== "Não encontrado"
        ? dominioTexto
        : "central.rinterna.local";
    const emailServexternos = meuGetEmailServexternos();

    if (!user) {
        meuSetValue("meuComandosBox", "Aguardando pesquisa do utilizador...");
        return "";
    }

    const cloudAddress = user + "_Cloud@gruposantander.com";
    const smtpSantander = user + "@santander.pt";
    const proxies = [
        "smtp:" + cloudAddress,
        emailServexternos ? "SMTP:" + emailServexternos : "",
        "smtp:" + smtpSantander
    ].filter(Boolean);

    const quotedProxies = proxies.map(function(value) { return '"' + value + '"'; }).join(",");

    const comandos = [
        '$user = Get-ADUser -Identity "' + user + '" -Server "' + dominio + '" -Properties proxyAddresses',
        'Set-ADUser -Identity "' + user + '" -Server "' + dominio + '" -Replace @{msExchRecipientDisplayType=-1073741818;msExchRecipientTypeDetails=128;msExchRecipLimit=50;targetAddress="SMTP:' + cloudAddress + '";mailNickname="' + user + '"}',
        '$novosProxies = @(' + quotedProxies + ') | Where-Object { $user.proxyAddresses -notcontains $_ }',
        'if (@($novosProxies).Count -gt 0) { Set-ADUser -Identity "' + user + '" -Server "' + dominio + '" -Add @{proxyAddresses=$novosProxies} }'
    ].join("\n");

    meuSetValue("meuComandosBox", comandos);
    return comandos;
}

async function meuCopiarTextoCampo(id, mensagem) {
    const box = meuEl(id);
    if (!box) return;

    box.select();
    box.setSelectionRange(0, 99999);

    try {
        await navigator.clipboard.writeText(box.value);
    } catch (_) {
        document.execCommand("copy");
    }

    meuSetResultado(mensagem);
}

async function meuCopiarComandos() {
    if (!meuValue("meuComandosBox") || meuValue("meuComandosBox") === "Aguardando pesquisa do utilizador...") {
        meuGerarComandos();
    }

    await meuCopiarTextoCampo("meuComandosBox", "Comandos MEU copiados para a área de transferência.");
}

function meuMontarRespostaTicket() {
    const user = meuText("infoSam") && meuText("infoSam") !== "-" ? meuText("infoSam") : meuValue("meuInputUser");
    const emailServexternos = meuGetEmailServexternos();
    const dominio = meuText("infoDominioAD") || "";
    const ticket = meuValue("meuNumeroTicket");
    const dataCriacao = meuText("infoCriacaoAD") || "";
    const assinatura = window.meuWindowsFullName || "Equipa de Suporte";
    const e3 = window.meuTemLicencaE3 ? "Concluída" : "Pendente";
    const arquivo = meuText("meuArquivoOnlineStatus") || "Não verificado";
    const tpa = meuValue("meuTpaValor") ? "Criado" : "Pendente";
    const limiteDestinatarios = window.meuRecipientLimitOk
        ? (meuValue("meuRecipientLimit") || "50") + " destinatários"
        : "Pendente";

    if (!user) {
        meuSetValue("meuRespostaTicketBox", "Aguardando dados do utilizador...");
        return "";
    }

    const resposta =
`Boa tarde,

Foi efetuada a criação do MEU para o novo utilizador provisionado pela Gestão de Acessos.

Detalhes do utilizador:

User: ${user}
E-mail: ${emailServexternos}
Domínio AD: ${dominio}
Nº Ticket: ${ticket}
Data Criação: ${dataCriacao}

Ações complementares:

Licença Office 365 E3: ${e3}
Arquivo Online EXO: ${arquivo}
Temporary Access Pass: ${tpa}
Limite de destinatários: ${limiteDestinatarios}

Atenciosamente,
${assinatura}
Equipa Exchange / Office365 / Intune`;

    meuSetValue("meuRespostaTicketBox", resposta);
    return resposta;
}

async function meuCopiarRespostaTicket() {
    meuMontarRespostaTicket();
    await meuCopiarTextoCampo("meuRespostaTicketBox", "Resposta do ticket copiada para a área de transferência.");
}

function meuHtmlEncode(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* MEU_EMAIL_PROFISSIONAL_V3
   Modelo de email baseado em tabelas e estilos inline para melhor compatibilidade
   com Outlook Desktop, Outlook Web e clientes móveis. */
function meuMontarEmailResponsavel() {
    const user = meuText("infoSam") && meuText("infoSam") !== "-"
        ? meuText("infoSam")
        : meuValue("meuInputUser");

    const nome = meuText("infoNome") || "";
    const upn = meuText("infoUPN") || "";
    const ticket = meuValue("meuNumeroTicket");
    const email = meuGetEmailServexternos();
    const dataCriacao = meuText("infoCriacaoAD");
    const tpa = meuValue("meuTpaValor");
    const validadeTpa = meuValue("meuTpaValidade") || "8 horas";

    const contatos = [
        meuValue("meuContato1Email"),
        meuValue("meuContato2Email"),
        meuValue("meuContato3Email"),
        meuValue("meuSupervisaoEmail")
    ].filter(function(value) {
        return value &&
            value !== "A pesquisar..." &&
            value !== "Não encontrado" &&
            value !== "Erro";
    });

    const para = Array.from(new Set(contatos)).join("; ");
    const assunto =
        (ticket ? ticket + " - " : "") +
        "Dados de acesso e configuração MFA | " +
        (user || "Novo utilizador");

    meuSetValue("meuEmailAssunto", assunto);
    meuSetValue("meuEmailPara", para);

    function saudacao() {
        const hora = new Date().getHours();

        if (hora < 12) return "Bom dia";
        if (hora < 19) return "Boa tarde";
        return "Boa noite";
    }

    function statusBadge(texto, concluido) {
        const background = concluido ? "#E7F4EC" : "#FFF4DE";
        const border = concluido ? "#198754" : "#C78300";
        const color = concluido ? "#116B43" : "#7A4B00";

        return (
            '<span style="' +
                'display:inline-block;' +
                'padding:5px 10px;' +
                'border:1px solid ' + border + ';' +
                'background-color:' + background + ';' +
                'color:' + color + ';' +
                'font-family:Segoe UI,Arial,sans-serif;' +
                'font-size:11px;' +
                'font-weight:700;' +
                'line-height:16px;' +
                'letter-spacing:.3px;' +
                'text-transform:uppercase;' +
                'white-space:nowrap;' +
            '">' +
                meuHtmlEncode(texto) +
            '</span>'
        );
    }

    const e3StatusEl = document.getElementById("meuE3StatusTexto");
    const e3Status = e3StatusEl ? e3StatusEl.textContent.trim() : "";
    const e3StatusLower = e3Status.toLowerCase();
    const e3Ok =
        e3StatusLower.includes("atribu") ||
        e3StatusLower.includes("verificada") ||
        e3StatusLower.includes("possui");

    const archiveStatusEl = document.getElementById("meuArquivoOnlineStatus");
    const archiveStatus = archiveStatusEl ? archiveStatusEl.textContent.trim() : "";
    const archiveStatusLower = archiveStatus.toLowerCase();
    const archiveOk =
        archiveStatusLower.includes("ativo") ||
        archiveStatusLower.includes("solicitado") ||
        archiveStatusLower.includes("verificado");

    const tpaOk = !!tpa;
    const ticketTexto = ticket || "Não informado";
    const tpaTexto = tpa || "Ainda não gerado";
    const preHeader =
        "Dados de acesso inicial e instruções para configuração do MFA do utilizador " +
        (user || "");

    const html = `<!doctype html>
<html lang="pt">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>${meuHtmlEncode(assunto)}</title>
    <!--[if mso]>
    <style>
        table { border-collapse: collapse; }
        td, th { font-family: Arial, sans-serif !important; }
    </style>
    <![endif]-->
</head>

<body style="margin:0;padding:0;background-color:#F3F4F6;color:#222222;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
        ${meuHtmlEncode(preHeader)}
    </div>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           bgcolor="#F3F4F6" style="width:100%;background-color:#F3F4F6;">
        <tr>
            <td align="center" style="padding:24px 12px;">

                <table role="presentation" width="720" cellspacing="0" cellpadding="0" border="0"
                       style="width:100%;max-width:720px;background-color:#FFFFFF;border:1px solid #D9DDE3;">

                    <tr>
                        <td bgcolor="#EC0000"
                            style="background-color:#EC0000;padding:24px 30px;border-bottom:5px solid #B80000;">
                            <div style="font-family:Segoe UI,Arial,sans-serif;font-size:30px;line-height:34px;font-weight:700;color:#FFFFFF;">
                                Santander
                            </div>
                            <div style="font-family:Segoe UI,Arial,sans-serif;font-size:13px;line-height:20px;color:#FFFFFF;padding-top:4px;">
                                Criação de Utilizador MEU | IT Services Portugal
                            </div>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:30px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:22px;color:#2D3035;">

                            <p style="margin:0 0 16px 0;font-size:15px;">
                                <strong>${saudacao()},</strong>
                            </p>

                            <p style="margin:0 0 22px 0;">
                                O aprovisionamento do utilizador
                                <strong style="color:#EC0000;">${meuHtmlEncode(user || "-")}</strong>
                                foi concluído no âmbito do processo <strong>MEU</strong>.
                                Abaixo seguem os dados necessários para o primeiro acesso e para a configuração do MFA.
                            </p>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 12px 0;">
                                <tr>
                                    <td style="font-family:Segoe UI,Arial,sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#24272B;padding:0 0 8px 0;border-bottom:3px solid #EC0000;">
                                        Dados do utilizador
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   bgcolor="#F8F9FA"
                                   style="width:100%;background-color:#F8F9FA;border:1px solid #E1E4E8;margin:0 0 26px 0;">
                                <tr>
                                    <td width="34%" style="padding:11px 14px;border-bottom:1px solid #E1E4E8;font-weight:700;color:#4B4F55;">Utilizador</td>
                                    <td style="padding:11px 14px;border-bottom:1px solid #E1E4E8;color:#EC0000;font-weight:700;">${meuHtmlEncode(user || "-")}</td>
                                </tr>
                                <tr>
                                    <td width="34%" style="padding:11px 14px;border-bottom:1px solid #E1E4E8;font-weight:700;color:#4B4F55;">Nome</td>
                                    <td style="padding:11px 14px;border-bottom:1px solid #E1E4E8;">${meuHtmlEncode(nome || "-")}</td>
                                </tr>
                                <tr>
                                    <td width="34%" style="padding:11px 14px;border-bottom:1px solid #E1E4E8;font-weight:700;color:#4B4F55;">E-mail corporativo</td>
                                    <td style="padding:11px 14px;border-bottom:1px solid #E1E4E8;color:#0057B8;font-weight:700;">${meuHtmlEncode(email || "-")}</td>
                                </tr>
                                <tr>
                                    <td width="34%" style="padding:11px 14px;border-bottom:1px solid #E1E4E8;font-weight:700;color:#4B4F55;">UPN</td>
                                    <td style="padding:11px 14px;border-bottom:1px solid #E1E4E8;">${meuHtmlEncode(upn || "-")}</td>
                                </tr>
                                <tr>
                                    <td width="34%" style="padding:11px 14px;border-bottom:1px solid #E1E4E8;font-weight:700;color:#4B4F55;">Número do ticket</td>
                                    <td style="padding:11px 14px;border-bottom:1px solid #E1E4E8;">${meuHtmlEncode(ticketTexto)}</td>
                                </tr>
                                <tr>
                                    <td width="34%" style="padding:11px 14px;font-weight:700;color:#4B4F55;">Data de criação</td>
                                    <td style="padding:11px 14px;">${meuHtmlEncode(dataCriacao || "-")}</td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 12px 0;">
                                <tr>
                                    <td style="font-family:Segoe UI,Arial,sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#24272B;padding:0 0 8px 0;border-bottom:3px solid #EC0000;">
                                        Estado da configuração
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;border:1px solid #DDE1E6;margin:0 0 26px 0;">
                                <tr bgcolor="#F3F4F6" style="background-color:#F3F4F6;">
                                    <th align="left" width="34%" style="padding:11px 12px;border-bottom:1px solid #DDE1E6;font-size:12px;color:#4A4E54;">SERVIÇO</th>
                                    <th align="left" width="23%" style="padding:11px 12px;border-bottom:1px solid #DDE1E6;font-size:12px;color:#4A4E54;">ESTADO</th>
                                    <th align="left" style="padding:11px 12px;border-bottom:1px solid #DDE1E6;font-size:12px;color:#4A4E54;">DETALHES</th>
                                </tr>
                                <tr>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;font-weight:700;">Microsoft 365 E3</td>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;">${statusBadge(e3Ok ? "Atribuída" : "Pendente", e3Ok)}</td>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;color:#555A60;">Grupo GR_PT_M365_E3</td>
                                </tr>
                                <tr>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;font-weight:700;">Arquivo Online EXO</td>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;">${statusBadge(archiveOk ? "Ativo / solicitado" : "Pendente", archiveOk)}</td>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;color:#555A60;">Ativação enviada ao Exchange Online</td>
                                </tr>
                                <tr>
                                    <td style="padding:13px 12px;font-weight:700;">Temporary Access Pass</td>
                                    <td style="padding:13px 12px;">${statusBadge(tpaOk ? "Criado" : "Pendente", tpaOk)}</td>
                                    <td style="padding:13px 12px;color:#555A60;">Credencial temporária para o primeiro acesso</td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 12px 0;">
                                <tr>
                                    <td style="font-family:Segoe UI,Arial,sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#24272B;padding:0 0 8px 0;border-bottom:3px solid #EC0000;">
                                        Dados para o primeiro acesso
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   bgcolor="#FFF5F5"
                                   style="width:100%;background-color:#FFF5F5;border:2px solid #EC0000;margin:0 0 22px 0;">
                                <tr>
                                    <td align="center" style="padding:20px 18px 8px 18px;color:#5E1313;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">
                                        Temporary Access Pass
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center"
                                        style="padding:4px 18px 10px 18px;font-family:Consolas,'Courier New',monospace;font-size:25px;line-height:32px;font-weight:700;color:#EC0000;letter-spacing:1.5px;">
                                        ${meuHtmlEncode(tpaTexto)}
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="padding:0 18px 20px 18px;color:#5C6066;font-size:13px;line-height:20px;">
                                        Validade: <strong>${meuHtmlEncode(validadeTpa)}</strong>
                                        &nbsp;&nbsp;|&nbsp;&nbsp;
                                        Utilização: <strong>multiuso</strong>
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 22px 0;">
                                <tr>
                                    <td align="center" bgcolor="#EC0000"
                                        style="background-color:#EC0000;padding:13px 18px;">
                                        <a href="https://aka.ms/mysecurityinfo"
                                           style="display:block;font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;">
                                            Abrir portal de Segurança e configurar o MFA
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 12px 0;">
                                <tr>
                                    <td style="font-family:Segoe UI,Arial,sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#24272B;padding:0 0 8px 0;border-bottom:3px solid #EC0000;">
                                        Como concluir a configuração
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 24px 0;">
                                <tr>
                                    <td width="38" valign="top" style="padding:8px 8px 8px 0;">
                                        <div style="width:28px;height:28px;line-height:28px;text-align:center;background-color:#EC0000;color:#FFFFFF;font-weight:700;">1</div>
                                    </td>
                                    <td valign="top" style="padding:8px 0;">
                                        <strong>Aceder ao portal</strong><br>
                                        Abrir <a href="https://aka.ms/mysecurityinfo" style="color:#0057B8;font-weight:700;">https://aka.ms/mysecurityinfo</a>.
                                    </td>
                                </tr>
                                <tr>
                                    <td width="38" valign="top" style="padding:8px 8px 8px 0;">
                                        <div style="width:28px;height:28px;line-height:28px;text-align:center;background-color:#EC0000;color:#FFFFFF;font-weight:700;">2</div>
                                    </td>
                                    <td valign="top" style="padding:8px 0;">
                                        <strong>Efetuar o primeiro login</strong><br>
                                        Utilizar o UPN e o Temporary Access Pass apresentados neste e-mail.
                                    </td>
                                </tr>
                                <tr>
                                    <td width="38" valign="top" style="padding:8px 8px 8px 0;">
                                        <div style="width:28px;height:28px;line-height:28px;text-align:center;background-color:#EC0000;color:#FFFFFF;font-weight:700;">3</div>
                                    </td>
                                    <td valign="top" style="padding:8px 0;">
                                        <strong>Registar o Microsoft Authenticator</strong><br>
                                        Seguir as instruções do portal e utilizar o manual MFA enviado em anexo.
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   bgcolor="#FFF1F1"
                                   style="width:100%;background-color:#FFF1F1;border-left:5px solid #EC0000;margin:0 0 14px 0;">
                                <tr>
                                    <td style="padding:15px 16px;color:#751515;font-size:13px;line-height:20px;">
                                        <strong>Atenção:</strong>
                                        o Temporary Access Pass tem validade máxima de
                                        <strong>${meuHtmlEncode(validadeTpa)}</strong>.
                                        Caso expire ou ocorra algum erro, deverá ser aberto um novo pedido no ServiceNow.
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   bgcolor="#FFF8E6"
                                   style="width:100%;background-color:#FFF8E6;border-left:5px solid #D59A00;margin:0 0 24px 0;">
                                <tr>
                                    <td style="padding:15px 16px;color:#654C00;font-size:13px;line-height:20px;">
                                        <strong>Nota:</strong>
                                        o utilizador apenas deverá configurar o MFA a partir da data de início de funções definida no contrato.
                                        O código temporário deve ser partilhado apenas com o utilizador correto.
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0 0 5px 0;">Atenciosamente,</p>
                            <p style="margin:0;font-weight:700;color:#24272B;">Santander EndUser</p>
                            <p style="margin:2px 0 0 0;font-size:12px;color:#676C72;">
                                Equipa Exchange / Office365 / Intune
                            </p>

                        </td>
                    </tr>

                    <tr>
                        <td bgcolor="#24272B"
                            style="background-color:#24272B;padding:16px 30px;font-family:Segoe UI,Arial,sans-serif;font-size:11px;line-height:17px;color:#FFFFFF;">
                            Mensagem gerada pelo Santander Support Web V2.
                            O manual de configuração MFA segue em anexo.
                        </td>
                    </tr>

                </table>

            </td>
        </tr>
    </table>
</body>
</html>`;

    meuSetValue("meuEmailHtmlBox", html);
    return html;
}
async function meuCopiarCorpoEmail() {
    meuMontarEmailResponsavel();
    await meuCopiarTextoCampo("meuEmailHtmlBox", "Corpo HTML do email copiado.");
}

function meuAtualizarTextosDerivados() {
    if (typeof meuMontarRespostaTicket === "function") meuMontarRespostaTicket();
    if (typeof meuMontarEmailResponsavel === "function") meuMontarEmailResponsavel();
}

async function meuEscolherManualMfa() {
    meuSetResultado("A abrir janela para selecionar o manual MFA...");

    try {
        const result = await meuApi("escolher-manual-mfa", "");

        if (!result.success || !result.data || !result.data.path) {
            throw new Error(result.error || "Nenhum ficheiro selecionado.");
        }

        meuSetManualMfaPath(result.data.path);
        meuAtualizarTextosDerivados();
        meuSetResultado("Manual MFA selecionado:\n" + result.data.path);
    } catch (error) {
        meuSetResultado("Falha ao selecionar manual:\n" + error.message);
    }
}

/* MEU_EMAIL_414_FRONTEND_V3_1
   Não enviar o HTML completo pela URL.
   Envia apenas dados compactos; o backend monta o modelo profissional. */
async function meuAbrirEmailOutlook(propagarErro) {
    meuMontarEmailResponsavel();

    const e3Status = meuText("meuE3StatusTexto").toLowerCase();

    const payload = {
        to: meuValue("meuEmailPara"),
        cc: meuValue("meuEmailCc") || MEU_CC_PADRAO,
        subject: meuValue("meuEmailAssunto"),
        attachment: meuGetManualMfaPathFinal(),

        user:
            meuText("infoSam") && meuText("infoSam") !== "-"
                ? meuText("infoSam")
                : meuValue("meuInputUser"),

        nome: meuText("infoNome"),
        email: meuGetEmailServexternos(),
        upn: meuText("infoUPN"),
        ticket: meuValue("meuNumeroTicket"),
        dataCriacao: meuText("infoCriacaoAD"),
        tpa: meuValue("meuTpaValor"),
        validadeTpa: meuValue("meuTpaValidade") || "8 horas",

        e3Ok:
            e3Status.includes("atribu") ||
            e3Status.includes("verificada") ||
            e3Status.includes("possui"),

        arquivoOk: window.meuArquivoOnlineOk === true
    };

    if (!payload.to) {
        const error = new Error("Informe os responsáveis para preencher o campo Para.");
        meuSetResultado(error.message);
        if (propagarErro) throw error;
        return false;
    }

    if (!payload.subject) {
        const error = new Error("O assunto do email está vazio.");
        meuSetResultado(error.message);
        if (propagarErro) throw error;
        return false;
    }

    if (!payload.tpa) {
        const error = new Error("Crie o TPA antes de preparar o email para o responsável.");
        meuSetResultado(error.message);
        if (propagarErro) throw error;
        return false;
    }

    meuSetButtonBusy("meuAbrirEmailOutlook", true, "A abrir Outlook...");

    try {
        const endpoint =
            "/module/criacao-user-meu/api?action=criar-email-responsavel";

        let response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json; charset=UTF-8"
            },
            body: JSON.stringify(payload)
        });

        let text = await response.text();
        let result;

        try {
            result = JSON.parse(text);
            if (typeof result === "string") {
                result = JSON.parse(result);
            }
        }
        catch {
            result = {
                success: false,
                error: "Resposta inválida da API.",
                raw: text
            };
        }

        /*
          Alguns carregadores antigos não entregam o corpo POST ao api.ps1.
          Nesse caso, usar fallback com parâmetros compactos.
          O HTML não é enviado e a URL permanece pequena.
        */
        if (
            !result.success &&
            (
                String(result.error || "").toLowerCase().includes("não recebidos") ||
                String(result.error || "").toLowerCase().includes("nao recebidos") ||
                String(result.error || "").toLowerCase().includes("payload")
            )
        ) {
            const params = new URLSearchParams();

            params.set("action", "criar-email-responsavel");
            params.set("to", payload.to);
            params.set("cc", payload.cc);
            params.set("subject", payload.subject);
            params.set("attachment", payload.attachment || "");
            params.set("emailUser", payload.user || "");
            params.set("nome", payload.nome || "");
            params.set("email", payload.email || "");
            params.set("upn", payload.upn || "");
            params.set("ticket", payload.ticket || "");
            params.set("dataCriacao", payload.dataCriacao || "");
            params.set("tpa", payload.tpa || "");
            params.set("validadeTpa", payload.validadeTpa || "8 horas");
            params.set("e3Ok", payload.e3Ok ? "true" : "false");
            params.set("arquivoOk", payload.arquivoOk ? "true" : "false");

            response = await fetch(
                "/module/criacao-user-meu/api?" + params.toString(),
                { method: "POST" }
            );

            text = await response.text();

            try {
                result = JSON.parse(text);

                if (typeof result === "string") {
                    result = JSON.parse(result);
                }
            }
            catch {
                result = {
                    success: false,
                    error: "Resposta inválida da API.",
                    raw: text
                };
            }
        }

        if (!response.ok) {
            throw new Error(
                "HTTP " + response.status + " ao criar o email no Outlook."
            );
        }

        if (!result.success) {
            throw new Error(
                result.error ||
                "Falha ao criar o email profissional no Outlook."
            );
        }

        meuSetResultado(
            "Email profissional criado no Outlook para validação antes do envio.\n\n" +
            "Para: " + payload.to + "\n" +
            "CC: " + payload.cc + "\n" +
            "Anexo: " + (payload.attachment || "NÃO INFORMADO")
        );
        return true;
    }
    catch (error) {
        meuSetResultado(
            "Erro ao criar email no Outlook: " + error.message
        );
        if (propagarErro) throw error;
        return false;
    }
    finally {
        meuSetButtonBusy("meuAbrirEmailOutlook", false);
    }
}
function meuBindResponsaveisEmail() {
    [
        { input: "meuContato1", email: "meuContato1Email" },
        { input: "meuContato2", email: "meuContato2Email" },
        { input: "meuContato3", email: "meuContato3Email" },
        { input: "meuSupervisao", email: "meuSupervisaoEmail" }
    ].forEach(function(campo) {
        const inputEl = meuEl(campo.input);
        if (!inputEl || inputEl.dataset.meuBound === "1") return;

        inputEl.dataset.meuBound = "1";
        inputEl.addEventListener("blur", function() {
            meuPesquisarEmailResponsavel(campo.input, campo.email);
        });
        inputEl.addEventListener("input", meuAtualizarTextosDerivados);
        inputEl.addEventListener("keydown", function(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                meuPesquisarEmailResponsavel(campo.input, campo.email);
            }
        });
    });
}

function meuBindCamposDinamicos() {
    [
        "meuNumeroTicket", "meuContato1Email", "meuContato2Email", "meuContato3Email",
        "meuSupervisaoEmail", "meuTpaValor", "meuTpaValidade", "meuManualMfaPath"
    ].forEach(function(id) {
        const el = meuEl(id);
        if (!el || el.dataset.meuDynamicBound === "1") return;
        el.dataset.meuDynamicBound = "1";
        el.addEventListener("input", meuAtualizarTextosDerivados);
        el.addEventListener("blur", meuAtualizarTextosDerivados);
    });
}

function meuNovoUtilizador() {
    meuLimpar();
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(function() {
        const campo = meuEl("meuInputUser");
        if (campo) campo.focus();
    }, 350);
}

function meuLimparTudo() {
    meuLimpar();
    window.scrollTo({ top: 0, behavior: "smooth" });
    window.setTimeout(function() {
        const campo = meuEl("meuInputUser");
        if (campo) campo.focus();
    }, 350);
}

async function meuCarregarConfiguracao() {
    try {
        const result = await meuApi("configuracao", "");
        const settings = result?.data || {};
        MEU_MANUAL_MFA_PADRAO = String(settings.manualMfaPath || "");
        MEU_CC_PADRAO = String(settings.defaultCc || "");
        MEU_GRUPO_E3 = String(settings.e3Group || "");
        window.meuWindowsFullName = String(settings.operatorName || "");
    } catch (error) {
        console.warn("Não foi possível carregar a configuração do módulo:", error.message);
    }
}

async function meuInicializarModulo() {
    await meuCarregarConfiguracao();
    const input = meuEl("meuInputUser");

    if (input && input.dataset.meuSearchBound !== "1") {
        input.dataset.meuSearchBound = "1";
        input.addEventListener("keydown", function(event) {
            if (event.key === "Enter") {
                event.preventDefault();
                meuPesquisar();
            }
        });
    }

    meuBindResponsaveisEmail();
    meuBindCamposDinamicos();

    let manual = "";
    try { manual = localStorage.getItem("meuManualMfaPath") || ""; } catch (_) {}
    meuSetManualMfaPath(manual || meuValue("meuManualMfaPath") || MEU_MANUAL_MFA_PADRAO);
    meuSetValue("meuE3Grupo", MEU_GRUPO_E3);
    meuSetValue("meuEmailCc", MEU_CC_PADRAO);
    meuAtualizarTextosDerivados();
}

meuInicializarModulo();
