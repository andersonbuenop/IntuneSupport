let intuneCurrentUser = null;
let intuneOperationInProgress = false;
let intuneProgressResetTimer = null;

window.intuneServiceNowUrl = "https://santander.service-now.com/itsm?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7&sysparm_category=6f044c7c1b1945505ae05532604bcb04";
window.intuneUsuarioAtual = {};
window.intuneUltimaAcaoServiceNow = "";

function iniciarIntuneInstall() {
    const txtUser = document.getElementById("intuneUser");
    const btnVerificar = document.getElementById("btnIntuneVerificar");
    const btnLimpar = document.getElementById("btnIntuneLimpar");
    const btnAddCentral = document.getElementById("btnAddCentral");
    const btnAddRede = document.getElementById("btnAddRede");
    const btnRemoveCentral = document.getElementById("btnRemoveCentral");
    const btnRemoveRede = document.getElementById("btnRemoveRede");
    const btnAddMac = document.getElementById("btnAddMac");
    const btnRemoveMac = document.getElementById("btnRemoveMac");
    const btnCopiar = document.getElementById("btnCopiarTicket");
    const btnCopiarServiceNow = document.getElementById("btnIntuneCopiarServiceNow");
    const btnAbrirServiceNow = document.getElementById("btnIntuneAbrirServiceNow");
    const btnSendEmail = document.getElementById("btnIntuneSendEmail");

    criarProgressGlobal("progressIntune");
    resetarProgressGlobal("progressIntune");

    btnVerificar?.addEventListener("click", verificarIntuneUser);
    btnLimpar?.addEventListener("click", limparIntune);
    btnAddCentral?.addEventListener("click", () => adicionarGrupoIntune("GR_Intune_Central_Mdm"));
    btnAddRede?.addEventListener("click", () => adicionarGrupoIntune("GR_Intune_Rede_Mdm"));
    btnRemoveCentral?.addEventListener("click", () => removerGrupoIntune("GR_Intune_Central_Mdm"));
    btnRemoveRede?.addEventListener("click", () => removerGrupoIntune("GR_Intune_Rede_Mdm"));
    btnAddMac?.addEventListener("click", () => adicionarGrupoIntune("GR_Intune_Central_MDM_MAC"));
    btnRemoveMac?.addEventListener("click", () => removerGrupoIntune("GR_Intune_Central_MDM_MAC"));
    btnCopiar?.addEventListener("click", copiarTicketIntune);
    btnCopiarServiceNow?.addEventListener("click", intuneCopiarServiceNow);
    btnAbrirServiceNow?.addEventListener("click", intuneAbrirServiceNow);
    btnSendEmail?.addEventListener("click", intuneEnviarEmailConfiguracao);

    txtUser?.addEventListener("keydown", function (e) {
        if (e.key === "Enter") verificarIntuneUser();
    });
}

function setIntuneBusy(busy) {
    intuneOperationInProgress = busy;
    const search = document.getElementById("btnIntuneVerificar");
    const clear = document.getElementById("btnIntuneLimpar");
    const input = document.getElementById("intuneUser");
    if (search) { search.disabled = busy; search.textContent = busy ? "A verificar..." : "Verificar utilizador"; }
    if (clear) clear.disabled = busy;
    if (input) input.disabled = busy;
    atualizarAcoesGruposIntune();
    intuneAtualizarAcaoEmail();
}

function intuneAtualizarAcaoEmail() {
    const button = document.getElementById("btnIntuneSendEmail");
    if (!button) return;
    button.disabled = intuneOperationInProgress || !intuneCurrentUser?.id || intuneCurrentUser.emailReady !== true;
}

function intuneRenderizarEmail(data) {
    const recipient = document.getElementById("intuneEmailRecipient");
    const sender = document.getElementById("intuneEmailSender");
    const subject = document.getElementById("intuneEmailSubject");
    const body = document.getElementById("intuneEmailBody");
    const attachments = document.getElementById("intuneEmailAttachments");
    const status = document.getElementById("intuneEmailStatus");
    const files = Array.isArray(data?.emailAttachments) ? data.emailAttachments : [];
    const messages = Array.isArray(data?.emailMessages) ? data.emailMessages : [];
    const missing = Array.isArray(data?.emailMissing) ? data.emailMissing : [];
    if (recipient) recipient.textContent = data?.emailRecipient || "-";
    if (sender) sender.textContent = data?.emailSender || "User.Action.Required@santander.pt";
    if (subject) subject.textContent = data?.emailSubject || "Manuais de configuração Intune e MFA";
    if (body) body.value = data?.emailBody || "";
    if (attachments) attachments.innerHTML = messages.length
        ? messages.map(message => `<div><strong>${intuneEscapeHtml(message.title)}</strong> ${(message.attachments || []).length ? (message.attachments || []).map(file => `<span class="ii-attachment">${intuneEscapeHtml(file)}</span>`).join("") : '<span class="ii-attachment-missing">Sem anexo — instruções no corpo do e-mail.</span>'}${(message.missing || []).map(file => `<span class="ii-attachment-missing">Em falta: ${intuneEscapeHtml(file)}</span>`).join("")}</div>`).join("")
        : '<span class="ii-attachment-missing">Manuais ainda não validados na pasta files.</span>';
    if (status) {
        status.textContent = data?.emailReady === true ? `Dois e-mails prontos, com ${files.length} anexo(s).` : `Envio bloqueado. Ficheiros em falta: ${missing.join(", ") || "manuais não validados"}.`;
        status.className = "field-info " + (data?.emailReady === true ? "ok" : "warn");
    }
    intuneAtualizarAcaoEmail();
}

function atualizarAcoesGruposIntune() {
    const hasUser = Boolean(intuneCurrentUser && intuneCurrentUser.id);
    const states = {
        btnAddCentral: !intuneOperationInProgress && hasUser && intuneCurrentUser.hasCentral !== true,
        btnAddRede: !intuneOperationInProgress && hasUser && intuneCurrentUser.hasRede !== true,
        btnRemoveCentral: !intuneOperationInProgress && hasUser && intuneCurrentUser.hasCentral === true,
        btnRemoveRede: !intuneOperationInProgress && hasUser && intuneCurrentUser.hasRede === true,
        btnAddMac: !intuneOperationInProgress && hasUser && intuneCurrentUser.hasMac !== true,
        btnRemoveMac: !intuneOperationInProgress && hasUser && intuneCurrentUser.hasMac === true
    };
    Object.keys(states).forEach(id => { const button = document.getElementById(id); if (button) button.disabled = !states[id]; });
}

function intunePrepararProgress() {
    if (intuneProgressResetTimer) clearTimeout(intuneProgressResetTimer);
    intuneProgressResetTimer = null;
}

function intuneRecolherProgress() {
    intunePrepararProgress();
    intuneProgressResetTimer = setTimeout(() => {
        resetarProgressGlobal("progressIntune");
        intuneProgressResetTimer = null;
    }, 1400);
}

function intuneEscapeHtml(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function intuneFormatarData(valor) {
    if (!valor) return "-";
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? valor : data.toLocaleString("pt-PT");
}

function intuneRenderizarEquipamentos(devices, warning) {
    const summary = document.getElementById("intuneDevicesSummary");
    const container = document.getElementById("intuneDevices");
    if (!summary || !container) return;
    const normalized = Array.isArray(devices) ? devices.slice() : [];
    const isMobile = device => {
        const text = `${device.operatingSystem || ""} ${device.model || ""} ${device.deviceName || ""}`.toLowerCase();
        return /android|ios|ipados|iphone|ipad|tablet|mobile|phone|smartphone/.test(text);
    };
    normalized.sort((a, b) => Number(isMobile(b)) - Number(isMobile(a)) || String(b.lastSyncDateTime || "").localeCompare(String(a.lastSyncDateTime || "")));
    const mobiles = normalized.filter(isMobile);
    const others = normalized.filter(device => !isMobile(device));
    window.intuneEquipamentosMoveis = mobiles;
    if (warning) {
        summary.textContent = warning;
        summary.className = "ii-devices-summary field-info warn";
    } else {
        summary.textContent = normalized.length ? `${mobiles.length} móvel(eis) em ${normalized.length} equipamento(s) encontrado(s).` : "Nenhum equipamento Intune associado ao utilizador.";
        summary.className = "ii-devices-summary";
    }
    const renderDevice = (device, mobile) => {
        const compliance = String(device.complianceState || "unknown").toLowerCase();
        const stateClass = compliance === "compliant" ? "ok" : compliance === "noncompliant" ? "error" : "warn";
        return `<article class="ii-device ${mobile ? "mobile" : ""}">
            <div class="ii-device-head"><div>${mobile ? '<span class="ii-mobile-label">Equipamento móvel</span>' : ""}<h4>${intuneEscapeHtml(device.deviceName || "Equipamento sem nome")}</h4><span class="ii-device-id">${intuneEscapeHtml(device.id || "-")}</span></div><span class="ii-device-state ${stateClass}">${intuneEscapeHtml(device.complianceState || "Desconhecido")}</span></div>
            <div class="ii-device-grid">
                <div><strong>Sistema</strong><span>${intuneEscapeHtml(device.operatingSystem || "-")} ${intuneEscapeHtml(device.osVersion || "")}</span></div>
                <div><strong>Modelo</strong><span>${intuneEscapeHtml(device.manufacturer || "-")} ${intuneEscapeHtml(device.model || "")}</span></div>
                <div><strong>Gestão</strong><span>${intuneEscapeHtml(device.managementAgent || "-")}</span></div>
                <div><strong>Última sincronização</strong><span>${intuneEscapeHtml(intuneFormatarData(device.lastSyncDateTime))}</span></div>
            </div>
        </article>`;
    };
    container.innerHTML = [
        mobiles.length ? `<div class="ii-device-section"><h4>Telemóveis e tablets</h4><div class="ii-device-subgrid">${mobiles.map(device => renderDevice(device, true)).join("")}</div></div>` : '<div class="ii-device-empty">Nenhum telemóvel ou tablet associado.</div>',
        others.length ? `<details class="ii-other-devices"><summary>Outros equipamentos (${others.length})</summary><div class="ii-device-subgrid">${others.map(device => renderDevice(device, false)).join("")}</div></details>` : ""
    ].join("");
}

async function intuneFetchJson(url, options) {
    const response = await fetch(url, Object.assign({ cache: "no-store" }, options || {}));
    let data;
    try { data = await response.json(); } catch (_) { throw new Error("O servidor devolveu uma resposta inválida."); }
    if (!response.ok) throw new Error(data.error || "Erro HTTP " + response.status + ".");
    return data;
}

async function intuneCopiarTexto(texto) {
    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(texto);
        return;
    }
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    if (!copied) throw new Error("Não foi possível copiar automaticamente.");
}

function setIntuneStatus(texto, tipo) {
    const el = document.getElementById("intuneStatus");
    if (!el) return;
    el.innerText = texto;
    el.className = "field-info " + (tipo || "");
}

function setIntuneLog(texto) {
    const el = document.getElementById("intuneLog");
    if (el) el.innerText = "Log: " + texto;
}

function limparIntune() {
    if (intuneOperationInProgress) return;
    intunePrepararProgress();
    intuneCurrentUser = null;
    window.intuneUsuarioAtual = {};
    window.intuneUltimaAcaoServiceNow = "";
    window.intuneEquipamentosMoveis = [];

    document.getElementById("intuneUser").value = "";
    document.getElementById("intuneDisplayName").innerText = "-";
    document.getElementById("intuneUpn").innerText = "-";
    document.getElementById("intuneObjectId").innerText = "-";
    document.getElementById("intuneTicket").value = "";

    const sn = document.getElementById("intuneServiceNowTexto");
    if (sn) sn.value = "";

    document.getElementById("btnAddCentral").disabled = true;
    document.getElementById("btnAddRede").disabled = true;
    document.getElementById("btnRemoveCentral").disabled = true;
    document.getElementById("btnRemoveRede").disabled = true;
    document.getElementById("btnAddMac").disabled = true;
    document.getElementById("btnRemoveMac").disabled = true;
    document.getElementById("btnCopiarTicket").disabled = true;

    atualizarBadge("badgeCentral", null);
    atualizarBadge("badgeRede", null);
    atualizarBadge("badgeMac", null);

    setIntuneStatus("Aguardando pesquisa...", "");
    setIntuneLog("-");
    resetarProgressGlobal("progressIntune");
    intuneRenderizarEquipamentos([], "Pesquise um utilizador para consultar os equipamentos.");
    intuneRenderizarEmail(null);
    const badge = document.getElementById("intuneOverallBadge");
    if (badge) { badge.textContent = "Aguardando"; badge.className = "ii-overall neutral"; }
}

function atualizarBadge(id, valor) {
    const badge = document.getElementById(id);
    if (!badge) return;

    if (valor === true) {
        badge.innerText = "✓";
        badge.className = "badge-ok";
    } else if (valor === false) {
        badge.innerText = "×";
        badge.className = "badge-error";
    } else {
        badge.innerText = "-";
        badge.className = "badge-neutral";
    }
}

function intuneMontarTextoServiceNow(tipo, grupo, dados) {
    dados = dados || window.intuneUsuarioAtual || {};

    const nome = dados.displayName || "";
    const upn = dados.userPrincipalName || "";
    const id = dados.id || "";
    const mailNickname = dados.mailNickname || "";
    const tecnico = dados.technician || "Raphael Gomes Vieira";
    const central = dados.hasCentral === true ? "Sim" : "Não";
    const rede = dados.hasRede === true ? "Sim" : "Não";
    const mac = dados.hasMac === true ? "Sim" : "Não";

    if (tipo === "ADICAO") {
        return `Foi realizada a verificação do utilizador ${nome} (${upn}).

Dados identificados:
- Nome: ${nome}
- UPN: ${upn}
- ObjectId Entra ID: ${id}
- MailNickname: ${mailNickname}
- Grupo Central Intune: ${central}
- Grupo Rede Intune: ${rede}
- Grupo MacBook Intune: ${mac}

Ação realizada:
Foi efetuada a adição do utilizador ao grupo ${grupo} no Entra ID/Azure AD.

Após a alteração, o utilizador deverá aguardar até 24 horas para sincronização entre os sistemas.

Atentamente,
${tecnico}`;
    }

    if (tipo === "REMOCAO") {
        return `Foi realizada a verificação do utilizador ${nome} (${upn}).

Ação realizada:
Foi removido o acesso do utilizador ao grupo ${grupo} no Entra ID/Azure AD.

Após a alteração, a atualização dos sistemas poderá demorar até 24 horas.

Atentamente,
${tecnico}`;
    }

    return `Foi realizada a verificação do utilizador ${nome} (${upn}).

Dados identificados:
- Nome: ${nome}
- UPN: ${upn}
- ObjectId Entra ID: ${id}
- MailNickname: ${mailNickname}
- Grupo Central Intune: ${central}
- Grupo Rede Intune: ${rede}
- Grupo MacBook Intune: ${mac}

Resultado:
Foi confirmado que o utilizador já possui acesso ao grupo ${grupo} no Entra ID/Azure AD.

Não foi necessária qualquer alteração adicional.

Atentamente,
${tecnico}`;
}

function intuneAtualizarServiceNowTexto(texto) {
    window.intuneUltimaAcaoServiceNow = texto || "";

    const txt = document.getElementById("intuneServiceNowTexto");
    const box = document.getElementById("intuneServiceNowBox");

    if (txt) txt.value = window.intuneUltimaAcaoServiceNow;
    if (box) box.style.display = "block";
}

async function verificarIntuneUser() {
    if (intuneOperationInProgress) return;
    const user = document.getElementById("intuneUser").value.trim();

    if (!user) {
        setIntuneStatus("Informe um utilizador.", "warn");
        return;
    }

    try {
        intunePrepararProgress();
        setIntuneBusy(true);
        const overall = document.getElementById("intuneOverallBadge");
        if (overall) { overall.textContent = "A verificar"; overall.className = "ii-overall loading"; }
        intuneCurrentUser = null;
        window.intuneUsuarioAtual = {};

        document.getElementById("btnAddCentral").disabled = true;
        document.getElementById("btnAddRede").disabled = true;
        document.getElementById("btnCopiarTicket").disabled = true;

        setIntuneStatus("A pesquisar utilizador no Microsoft Graph...", "loading");
        setIntuneLog("Pesquisa iniciada.");
        atualizarProgressGlobal("progressIntune", 15, "A preparar pesquisa...");

        const url = "/module/intune-install/api?action=searchUser&user=" + encodeURIComponent(user);

        atualizarProgressGlobal("progressIntune", 40, "A procurar utilizador...");

        const data = await intuneFetchJson(url);

        atualizarProgressGlobal("progressIntune", 70, "A validar grupos Intune...");

        if (!data.success) {
            finalizarProgressGlobal("progressIntune", false, data.error || "Erro na pesquisa.");
            setIntuneStatus(data.error || "Utilizador não encontrado.", "error");
            setIntuneLog(data.error || "Erro.");
            if (overall) { overall.textContent = "Não encontrado"; overall.className = "ii-overall warn"; }
            return;
        }

        intuneCurrentUser = data;
        window.intuneUsuarioAtual = data;

        document.getElementById("intuneDisplayName").innerText = data.displayName || "-";
        document.getElementById("intuneUpn").innerText = data.userPrincipalName || "-";
        document.getElementById("intuneObjectId").innerText = data.id || "-";
        document.getElementById("intuneTicket").value = data.ticket || "";

        atualizarBadge("badgeCentral", data.hasCentral);
        atualizarBadge("badgeRede", data.hasRede);
        atualizarBadge("badgeMac", data.hasMac);

        document.getElementById("btnCopiarTicket").disabled = false;
        document.getElementById("btnAddCentral").disabled = data.hasCentral === true;
        document.getElementById("btnAddRede").disabled = data.hasRede === true;
        document.getElementById("btnRemoveCentral").disabled = data.hasCentral !== true;
        document.getElementById("btnRemoveRede").disabled = data.hasRede !== true;
        document.getElementById("btnAddMac").disabled = data.hasMac === true;
        document.getElementById("btnRemoveMac").disabled = data.hasMac !== true;
        intuneRenderizarEquipamentos(Array.isArray(data.devices) ? data.devices : [], data.devicesWarning || "");
        intuneRenderizarEmail(data);

        setIntuneStatus("Utilizador encontrado: " + data.displayName, "ok");

        if (data.hasCentral === true && data.hasRede === true) {
            setIntuneLog("Utilizador já possui os grupos Intune Central e Rede.");
            intuneAtualizarServiceNowTexto(intuneMontarTextoServiceNow("VERIFICACAO", "Central e Rede", data));
        } else if (data.hasCentral === true) {
            setIntuneLog("Utilizador já possui grupo Intune Central.");
            intuneAtualizarServiceNowTexto(
                intuneMontarTextoServiceNow("VERIFICACAO", "GR_Intune_Central_Mdm", data)
            );
        } else if (data.hasRede === true) {
            setIntuneLog("Utilizador já possui grupo Intune Rede.");
            intuneAtualizarServiceNowTexto(
                intuneMontarTextoServiceNow("VERIFICACAO", "GR_Intune_Rede_Mdm", data)
            );
        } else {
            setIntuneLog("Utilizador sem grupo Intune. Pode adicionar Central ou Rede.");
        }

        finalizarProgressGlobal("progressIntune", true, "Validação concluída.");
        if (overall) { overall.textContent = data.hasCentral || data.hasRede || data.hasMac ? "Acesso confirmado" : "Ação necessária"; overall.className = "ii-overall " + (data.hasCentral || data.hasRede || data.hasMac ? "ok" : "warn"); }
    } catch (err) {
        finalizarProgressGlobal("progressIntune", false, "Erro na validação.");
        setIntuneStatus("Erro: " + err.message, "error");
        setIntuneLog(err.message);
        const overall = document.getElementById("intuneOverallBadge");
        if (overall) { overall.textContent = "Erro"; overall.className = "ii-overall warn"; }
    } finally {
        setIntuneBusy(false);
        intuneRecolherProgress();
        document.getElementById("intuneUser")?.focus();
    }
}

async function intuneEnviarEmailConfiguracao() {
    if (intuneOperationInProgress || !intuneCurrentUser?.id) return;
    const files = Array.isArray(intuneCurrentUser.emailAttachments) ? intuneCurrentUser.emailAttachments : [];
    if (intuneCurrentUser.emailReady !== true) {
        setIntuneStatus("Existem manuais em falta na pasta files.", "warn");
        return;
    }
    const confirmed = confirm(`Confirma o envio de dois e-mails para:\n\n${intuneCurrentUser.emailRecipient}\n\nAnexos:\n- ${files.join("\n- ")}?`);
    if (!confirmed) return;
    const emailStatus = document.getElementById("intuneEmailStatus");
    try {
        setIntuneBusy(true);
        if (emailStatus) { emailStatus.textContent = "A preparar e enviar pelo Outlook clássico..."; emailStatus.className = "field-info loading"; }
        const url = "/module/intune-install/api?action=sendConfigurationEmail&userId=" + encodeURIComponent(intuneCurrentUser.id);
        const data = await intuneFetchJson(url, { method: "POST" });
        if (!data.success) throw new Error(data.error || "Não foi possível enviar o e-mail.");
        if (emailStatus) { emailStatus.textContent = data.message || "E-mail enviado com sucesso."; emailStatus.className = "field-info ok"; }
        setIntuneStatus(data.message || "E-mail enviado com sucesso.", "ok");
        setIntuneLog(`Dois e-mails enviados com ${files.length} anexo(s).`);
    } catch (error) {
        if (emailStatus) { emailStatus.textContent = "Erro: " + error.message; emailStatus.className = "field-info error"; }
        setIntuneStatus("Erro ao enviar e-mail: " + error.message, "error");
    } finally {
        setIntuneBusy(false);
    }
}

async function removerGrupoIntune(groupName) {
    if (!intuneCurrentUser || !intuneCurrentUser.id) {
        setIntuneStatus("Primeiro verifique um utilizador.", "warn");
        return;
    }
    const confirma = confirm("Confirma remover o acesso do utilizador ao grupo:\n\n" + groupName + "?\n\nEsta ação poderá interromper o acesso Intune.");
    if (!confirma) return;
    try {
        setIntuneBusy(true);
        setIntuneStatus("A remover do grupo " + groupName + "...", "loading");
        atualizarProgressGlobal("progressIntune", 45, "A executar remoção no Microsoft Graph...");
        const url = "/module/intune-install/api?action=removeGroup&userId=" + encodeURIComponent(intuneCurrentUser.id) + "&groupName=" + encodeURIComponent(groupName);
        const data = await intuneFetchJson(url, { method: "POST" });
        if (!data.success) throw new Error(data.error || "Erro ao remover grupo.");
        if (groupName === "GR_Intune_Central_Mdm") intuneCurrentUser.hasCentral = false;
        if (groupName === "GR_Intune_Rede_Mdm") intuneCurrentUser.hasRede = false;
        if (groupName === "GR_Intune_Central_MDM_MAC") intuneCurrentUser.hasMac = false;
        window.intuneUsuarioAtual = intuneCurrentUser;
        atualizarBadge("badgeCentral", intuneCurrentUser.hasCentral);
        atualizarBadge("badgeRede", intuneCurrentUser.hasRede);
        atualizarBadge("badgeMac", intuneCurrentUser.hasMac);
        if (data.ticket) document.getElementById("intuneTicket").value = data.ticket;
        intuneAtualizarServiceNowTexto(intuneMontarTextoServiceNow("REMOCAO", groupName, intuneCurrentUser));
        setIntuneStatus(data.message || "Acesso removido com sucesso.", "ok");
        setIntuneLog(data.message || "Remoção concluída.");
        finalizarProgressGlobal("progressIntune", true, "Grupo removido com sucesso.");
    } catch (err) {
        finalizarProgressGlobal("progressIntune", false, "Erro ao remover grupo.");
        setIntuneStatus("Erro: " + err.message, "error");
        setIntuneLog(err.message);
    } finally {
        setIntuneBusy(false);
        document.getElementById("btnAddCentral").disabled = intuneCurrentUser.hasCentral === true;
        document.getElementById("btnAddRede").disabled = intuneCurrentUser.hasRede === true;
        document.getElementById("btnRemoveCentral").disabled = intuneCurrentUser.hasCentral !== true;
        document.getElementById("btnRemoveRede").disabled = intuneCurrentUser.hasRede !== true;
        document.getElementById("btnAddMac").disabled = intuneCurrentUser.hasMac === true;
        document.getElementById("btnRemoveMac").disabled = intuneCurrentUser.hasMac !== true;
    }
}

async function adicionarGrupoIntune(groupName) {
    if (!intuneCurrentUser || !intuneCurrentUser.id) {
        setIntuneStatus("Primeiro verifique um utilizador.", "warn");
        return;
    }

    const confirma = confirm("Confirma adicionar o utilizador ao grupo:\n\n" + groupName + "?");
    if (!confirma) return;

    try {
        setIntuneBusy(true);
        atualizarProgressGlobal("progressIntune", 20, "A preparar adição ao grupo...");
        setIntuneStatus("A adicionar ao grupo " + groupName + "...", "loading");
        atualizarProgressGlobal("progressIntune", 55, "A executar alteração no Microsoft Graph...");

        const url = "/module/intune-install/api?action=addGroup"
            + "&userId=" + encodeURIComponent(intuneCurrentUser.id)
            + "&groupName=" + encodeURIComponent(groupName);

        const data = await intuneFetchJson(url, { method: "POST" });

        if (!data.success) {
            finalizarProgressGlobal("progressIntune", false, data.error || "Erro ao adicionar grupo.");
            setIntuneStatus(data.error || "Erro ao adicionar grupo.", "error");
            setIntuneLog(data.error || "Erro.");
            return;
        }

        atualizarProgressGlobal("progressIntune", 80, "A atualizar estado...");

        if (groupName === "GR_Intune_Central_Mdm") {
            intuneCurrentUser.hasCentral = true;
            window.intuneUsuarioAtual.hasCentral = true;
            atualizarBadge("badgeCentral", true);
            document.getElementById("btnAddCentral").disabled = true;
        }

        if (groupName === "GR_Intune_Rede_Mdm") {
            intuneCurrentUser.hasRede = true;
            window.intuneUsuarioAtual.hasRede = true;
            atualizarBadge("badgeRede", true);
            document.getElementById("btnAddRede").disabled = true;
        }

        if (groupName === "GR_Intune_Central_MDM_MAC") {
            intuneCurrentUser.hasMac = true;
            window.intuneUsuarioAtual.hasMac = true;
            atualizarBadge("badgeMac", true);
            document.getElementById("btnAddMac").disabled = true;
        }

        if (data.ticket) document.getElementById("intuneTicket").value = data.ticket;

        setIntuneStatus("Utilizador adicionado com sucesso ao grupo.", "ok");
        setIntuneLog("Adicionado a " + groupName + ".");

        intuneAtualizarServiceNowTexto(
            intuneMontarTextoServiceNow("ADICAO", groupName, window.intuneUsuarioAtual)
        );

        finalizarProgressGlobal("progressIntune", true, "Grupo adicionado com sucesso.");
        const overall = document.getElementById("intuneOverallBadge");
        if (overall) { overall.textContent = "Acesso atualizado"; overall.className = "ii-overall ok"; }
    } catch (err) {
        finalizarProgressGlobal("progressIntune", false, "Erro ao adicionar grupo.");
        setIntuneStatus("Erro: " + err.message, "error");
        setIntuneLog(err.message);
    } finally {
        setIntuneBusy(false);
        if (intuneCurrentUser) {
            document.getElementById("btnAddCentral").disabled = intuneCurrentUser.hasCentral === true;
            document.getElementById("btnAddRede").disabled = intuneCurrentUser.hasRede === true;
            document.getElementById("btnAddMac").disabled = intuneCurrentUser.hasMac === true;
        }
    }
}

function copiarTicketIntune() {
    const texto = document.getElementById("intuneTicket").value;

    if (!texto) {
        setIntuneStatus("Não existe resposta para copiar.", "warn");
        return;
    }

    intuneCopiarTexto(texto)
        .then(() => {
            setIntuneLog("Resposta copiada para o clipboard.");
            setIntuneStatus("Resposta copiada.", "ok");
        })
        .catch(err => {
            setIntuneStatus("Erro ao copiar: " + err.message, "error");
        });
}

function intuneCopiarServiceNow() {
    const txt = document.getElementById("intuneServiceNowTexto");
    const texto = txt ? txt.value : window.intuneUltimaAcaoServiceNow;

    if (!texto) {
        alert("Ainda não existe texto ServiceNow preparado.");
        return;
    }

    intuneCopiarTexto(texto).then(function () {
        setIntuneStatus("Registo ServiceNow copiado.", "ok");
    }).catch(function (error) { setIntuneStatus("Erro ao copiar: " + error.message, "error"); });
}

async function intuneAbrirServiceNow() {
    const txt = document.getElementById("intuneServiceNowTexto");
    const texto = txt ? txt.value : window.intuneUltimaAcaoServiceNow;

    if (texto) {
        try {
            await intuneCopiarTexto(texto);
        } catch (e) {
            if (txt) {
                txt.focus();
                txt.select();
                document.execCommand("copy");
            }
        }
    }

    window.open(window.intuneServiceNowUrl, "_blank");
}

iniciarIntuneInstall();
