const TRACKING_EMAIL_MODULE = "tracking-email";
const TRACKING_EMAIL_VERSION = "5.4";
let trackingEmailLastData = null;
let trackingSolicitanteTimer = null;
let trackingEmailFileData = null;
let trackingEmailProgressTimer = null;
let trackingEmailBusyCount = 0;

function trackingEmailValue(id) {
    const element = document.getElementById(id);
    return element ? (element.value || "") : "";
}

function trackingEmailParseResponse(text) {
    let value = JSON.parse(text);
    if (typeof value === "string") value = JSON.parse(value);
    return value;
}

function trackingEmailEscape(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function trackingEmailProgress(text, value) {
    const textElement = document.getElementById("trackingProgressText");
    const bar = document.getElementById("trackingProgressBar");
    if (textElement) textElement.textContent = text || "";
    if (bar) bar.style.width = Math.max(0, Math.min(100, Number(value) || 0)) + "%";
}

function trackingEmailStartProgress(text) {
    clearInterval(trackingEmailProgressTimer);
    let value = 18;
    trackingEmailProgress(text, value);
    trackingEmailProgressTimer = setInterval(() => {
        if (value < 78) {
            value += value < 45 ? 6 : 2;
            trackingEmailProgress(text, value);
        }
    }, 700);
}

function trackingEmailFinishProgress(text, value = 100) {
    clearInterval(trackingEmailProgressTimer);
    trackingEmailProgressTimer = null;
    trackingEmailProgress(text, value);
}

function trackingEmailSetBusy(isBusy) {
    trackingEmailBusyCount += isBusy ? 1 : -1;
    if (trackingEmailBusyCount < 0) trackingEmailBusyCount = 0;
    const disabled = trackingEmailBusyCount > 0;
    document.querySelectorAll(".tracking-email-page .trk-action-btn").forEach(button => {
        button.disabled = disabled;
    });
}

function trackingEmailNotice(message, type = "info") {
    const notice = document.getElementById("trackingNotice");
    if (!notice) return;
    notice.className = "trk-notice trk-notice-" + type;
    notice.textContent = message || "";
    notice.style.display = message ? "block" : "none";
}

function trackingEmailSetResultado(text) {
    const element = document.getElementById("trackingResultado");
    if (element) element.textContent = text || "";
}

function trackingEmailShowDashboard() {
    const dashboard = document.getElementById("trackingDashboard");
    if (dashboard) dashboard.style.display = "block";
}

function trackingEmailSetExoStatus(status) {
    const element = document.getElementById("trackingExoStatus");
    if (!element) return;

    element.value = status || "Desconhecido";
    element.style.fontWeight = "700";

    if (status === "Conectado") {
        element.style.background = "#d1e7dd";
        element.style.color = "#0f5132";
    } else if (status === "Desconectado") {
        element.style.background = "#f8d7da";
        element.style.color = "#842029";
    } else {
        element.style.background = "#fff3cd";
        element.style.color = "#664d03";
    }
}

function trackingEmailTab(name) {
    document.querySelectorAll(".tracking-email-page .trk-tab").forEach(tab => tab.classList.remove("active"));
    document.querySelectorAll(".tracking-email-page .trk-panel").forEach(panel => panel.classList.remove("active"));

    const order = { diag: 0, trace: 1, rules: 2, audit: 3, raw: 4 };
    const tabs = Array.from(document.querySelectorAll(".tracking-email-page .trk-tab"));
    if (tabs[order[name]]) tabs[order[name]].classList.add("active");

    const panel = document.getElementById("panel-" + name);
    if (panel) panel.classList.add("active");
}

function trackingEmailCard(title, value, type, subtitle) {
    return `<div class="trk-card trk-${type || "info"}"><h3>${trackingEmailEscape(title)}</h3><div class="v">${trackingEmailEscape(value)}</div>${subtitle ? `<div style="margin-top:6px;font-size:12px;color:#6b7280;">${trackingEmailEscape(subtitle)}</div>` : ""}</div>`;
}

function trackingEmailDefaultData() {
    return {
        analysisComplete: false,
        mailbox: {},
        traces: [],
        relatedTraces: [],
        traceDetails: [],
        traceAttempts: [],
        rules: [],
        audits: [],
        summary: {},
        diagnosis: { alerts: [], recommendation: "Execute a análise completa para obter o diagnóstico consolidado." }
    };
}

function trackingEmailMergePartial(action, data) {
    const merged = trackingEmailLastData ? JSON.parse(JSON.stringify(trackingEmailLastData)) : trackingEmailDefaultData();
    merged.summary = merged.summary || {};

    if (action === "messageTrace") {
        merged.traces = data.traces || [];
        merged.relatedTraces = data.relatedTraces || [];
        if (data.mailbox) merged.mailbox = data.mailbox;
        merged.traceDetails = data.traceDetails || [];
        merged.traceAttempts = data.traceAttempts || [];
        merged.analysisStatus = data.analysisStatus || "warning";
        Object.assign(merged.summary, data.summary || {});
    } else if (action === "regras") {
        merged.rules = data.rules || [];
        Object.assign(merged.summary, data.summary || {});
    } else if (action === "auditoria") {
        merged.audits = data.audits || [];
        Object.assign(merged.summary, data.summary || {});
    }

    merged.analysisComplete = false;
    const partialAlert = {
        level: "warning",
        title: "Resultado parcial",
        message: "Esta consulta atualizou apenas uma parte do diagnóstico. Execute a análise completa antes de gerar o fecho do ticket."
    };
    const sourceDiagnosis = data.diagnosis || {};
    merged.diagnosis = {
        alerts: [...(sourceDiagnosis.alerts || []), partialAlert],
        recommendation: sourceDiagnosis.recommendation || "Execute a análise completa para validar mailbox, forwarding, Message Trace, regras e auditoria em conjunto."
    };

    return merged;
}

function trackingEmailRender(data) {
    trackingEmailLastData = data;
    trackingEmailShowDashboard();
    trackingEmailSetResultado(JSON.stringify(data, null, 2));

    const mailbox = data.mailbox || {};
    const summary = data.summary || {};
    const diagnosis = data.diagnosis || {};
    const cards = document.getElementById("trackingCards");

    const mailboxValue = mailbox.resolved === false ? "Não resolvida" : (mailbox.error ? "Erro" : (mailbox.recipientTypeDetails || "Não verificado"));
    const forwardingValue = mailbox.error ? "Não verificado" : (mailbox.hasForwarding ? "ATIVO" : "Não");
    const forwardingType = mailbox.error ? "warn" : (mailbox.hasForwarding ? "danger" : "ok");
    const deliveryScope = summary.traceDeliveryScope || "none";
    const traceOutcome = summary.traceDeliveryOutcome || "Não localizado";
    const traceType = deliveryScope === "otherRecipientsOnly" || ["Pendente", "Spam/Junk", "Expandido"].includes(traceOutcome)
        ? "warn"
        : (deliveryScope === "none" || ["Falha", "Quarentena", "Não localizado"].includes(traceOutcome) ? "danger" : "ok");
    const traceValue = deliveryScope === "otherRecipientsOnly" ? "Não confirmada" : traceOutcome;
    const matchedAddress = (summary.traceMatchedMailboxAddresses || []).join("; ");
    const traceSubtitle = matchedAddress
        ? `${summary.traceDeliveryConfirmation || "Entrega confirmada"}: ${matchedAddress}`
        : (summary.traceOtherRecipientCount ? `${summary.traceOtherRecipientCount} outro(s) destinatário(s)` : (summary.traceDeliveryConfirmation || ""));
    const rulesValue = mailbox.resolved === false ? "Indisponível" : (summary.rulesError ? "Erro" : (summary.rulesCount == null ? "Não verificado" : summary.rulesCount));
    const auditValue = summary.auditError ? "Erro" : (summary.auditCount == null ? "Não verificado" : summary.auditCount);

    if (cards) {
        cards.innerHTML =
            trackingEmailCard("Mailbox", mailboxValue, mailbox.error || mailbox.resolved === false ? "warn" : "info", mailbox.primarySmtpAddress || mailbox.identity || "") +
            trackingEmailCard("Forwarding", forwardingValue, forwardingType, mailbox.forwardingAddress || mailbox.forwardingSmtpAddress || "") +
            trackingEmailCard("Entrega à mailbox", traceValue, traceType, traceSubtitle) +
            trackingEmailCard("Regras", rulesValue, summary.rulesError || mailbox.resolved === false ? "warn" : ((summary.deleteRulesCount || summary.forwardRulesCount || summary.moveRulesCount) ? "warn" : "ok"), mailbox.resolved === false ? "Requer mailbox no tenant" : "Total de regras") +
            trackingEmailCard("Eliminam emails", mailbox.resolved === false || summary.rulesError ? "?" : (summary.deleteRulesCount || 0), mailbox.resolved === false || summary.rulesError ? "warn" : (summary.deleteRulesCount > 0 ? "danger" : "ok"), "Delete/SoftDelete") +
            trackingEmailCard("Auditoria", auditValue, summary.auditError ? "warn" : (summary.auditCount > 0 ? "warn" : "ok"), "Eventos encontrados");
    }

    let diagnosticHtml = "";
    if (diagnosis.alerts && diagnosis.alerts.length) {
        diagnosis.alerts.forEach(alert => {
            const cssClass = alert.level === "danger" ? "trk-alert-danger" : alert.level === "warning" ? "trk-alert-warning" : "trk-alert-success";
            diagnosticHtml += `<div class="trk-alert ${cssClass}"><b>${trackingEmailEscape(alert.title)}</b><br>${trackingEmailEscape(alert.message)}</div>`;
        });
    }

    diagnosticHtml += `<h3>Recomendação automática</h3><div class="trk-box">${trackingEmailEscape(diagnosis.recommendation || "Sem recomendação automática.")}</div>`;

    const diagnosticPanel = document.getElementById("panel-diag");
    const tracePanel = document.getElementById("panel-trace");
    const rulesPanel = document.getElementById("panel-rules");
    const auditPanel = document.getElementById("panel-audit");

    if (diagnosticPanel) diagnosticPanel.innerHTML = diagnosticHtml;
    if (tracePanel) tracePanel.innerHTML = trackingEmailRenderTrace(data);
    if (rulesPanel) rulesPanel.innerHTML = trackingEmailRenderRules(data);
    if (auditPanel) auditPanel.innerHTML = trackingEmailRenderAudit(data);

    trackingEmailTab(summary.traceCount != null ? "trace" : "diag");
}

function trackingEmailTraceTable(items, includeAssociation = false) {
    if (!items || !items.length) return "";
    let html = `<div class="trk-table-wrap"><table class="trk-table"><thead><tr><th>Recebido (local)</th><th>UTC</th><th>MAIL FROM</th><th>Destinatário</th>${includeAssociation ? "<th>Associação</th>" : ""}<th>Assunto</th><th>Status</th><th>Message-ID</th></tr></thead><tbody>`;
    items.forEach(item => {
        html += `<tr><td>${trackingEmailEscape(item.received)}</td><td>${trackingEmailEscape(item.receivedUtc || "")}</td><td>${trackingEmailEscape(item.sender)}</td><td>${trackingEmailEscape(item.recipient)}</td>${includeAssociation ? `<td>${trackingEmailEscape(item.recipientAssociation || "")}</td>` : ""}<td>${trackingEmailEscape(item.subject)}</td><td><b>${trackingEmailEscape(item.status)}</b></td><td>${trackingEmailEscape(item.messageId || item.messageTraceId || "")}</td></tr>`;
    });
    return html + `</tbody></table></div>`;
}

function trackingEmailRenderTrace(data) {
    const items = data.traces || [];
    const relatedItems = data.relatedTraces || [];
    const details = data.traceDetails || [];
    const attempts = data.traceAttempts || [];
    const summary = data.summary || {};
    let html = "";

    const scope = summary.traceDeliveryScope || "none";
    const outcome = summary.traceDeliveryOutcome || "Não localizado";
    const outcomeClass = scope === "otherRecipientsOnly" || ["Pendente", "Spam/Junk", "Expandido"].includes(outcome)
        ? "trk-alert-warning"
        : (scope === "none" || ["Falha", "Quarentena", "Não localizado"].includes(outcome) ? "trk-alert-danger" : "trk-alert-success");
    html += `<div class="trk-alert ${outcomeClass}"><b>${trackingEmailEscape(summary.traceDeliveryConfirmation || "Entrega à mailbox")}: ${trackingEmailEscape(outcome)}</b><br>${trackingEmailEscape(summary.traceMatchDescription || "")}</div>`;

    const addressRecords = summary.traceMailboxAddressRecords || [];
    if (addressRecords.length) {
        html += `<h3>Endereços associados à mailbox pesquisada</h3><div class="trk-address-list">`;
        addressRecords.forEach(record => {
            const matched = (summary.traceMatchedMailboxAddresses || []).some(address => String(address).toLowerCase() === String(record.address).toLowerCase());
            html += `<span class="trk-address-badge ${matched ? "matched" : ""}"><b>${trackingEmailEscape(record.type || "Endereço")}</b>: ${trackingEmailEscape(record.address || "")}</span>`;
        });
        html += `</div>`;
    }

    if (summary.traceActualSenders && summary.traceActualSenders.length) {
        html += `<div class="trk-alert trk-alert-info"><b>MAIL FROM registado no transporte</b><br>${trackingEmailEscape(summary.traceActualSenders.join("; "))}</div>`;
    }
    if (summary.traceAddressResolutionError) {
        html += `<div class="trk-alert trk-alert-warning"><b>Endereço não resolvido como mailbox no tenant conectado</b><br>O Message Trace continua válido para o endereço informado, mas aliases, forwarding e regras podem ficar indisponíveis.<details><summary>Detalhe técnico</summary>${trackingEmailEscape(summary.traceAddressResolutionError)}</details></div>`;
    }
    if (summary.traceError) {
        html += `<div class="trk-alert trk-alert-warning"><b>Erro parcial ou total no Message Trace</b><br>${trackingEmailEscape(summary.traceError)}</div>`;
    }
    if (summary.traceTruncated) {
        html += `<div class="trk-alert trk-alert-warning"><b>Resultado possivelmente truncado</b><br>Refine os filtros ou reduza o período.</div>`;
    }

    if (attempts.length) {
        html += `<h3>Pesquisas executadas automaticamente</h3><div class="trk-table-wrap"><table class="trk-table"><thead><tr><th>Etapa</th><th>Destinatário</th><th>MAIL FROM</th><th>Assunto/Message-ID</th><th>Resultados</th><th>Erro</th></tr></thead><tbody>`;
        attempts.forEach(attempt => {
            html += `<tr><td>${trackingEmailEscape(attempt.label)}</td><td>${trackingEmailEscape(attempt.recipient || "-")}</td><td>${trackingEmailEscape(attempt.sender || "-")}</td><td>${trackingEmailEscape(attempt.messageId || attempt.subject || "-")}</td><td><b>${trackingEmailEscape(attempt.count)}</b></td><td>${trackingEmailEscape(attempt.error || "")}</td></tr>`;
        });
        html += `</tbody></table></div>`;
    }

    if (items.length) {
        html += `<h3>Entrega confirmada para a mailbox pesquisada</h3>` + trackingEmailTraceTable(items, true);
    } else {
        html += `<div class="trk-alert ${relatedItems.length ? "trk-alert-warning" : "trk-alert-danger"}"><b>Não foi encontrada uma entrega para nenhum endereço associado à mailbox.</b><br>${relatedItems.length ? "O mesmo envio foi localizado para outros destinatários, apresentados abaixo." : "Confirme o destinatário, o período e o Message-ID."}</div>`;
    }

    if (relatedItems.length) {
        html += `<details class="trk-related-box"><summary>Outros destinatários do mesmo envio (${trackingEmailEscape(relatedItems.length)})</summary><p>Estas mensagens não pertencem à mailbox pesquisada e não alteram o resultado principal.</p>${trackingEmailTraceTable(relatedItems, false)}</details>`;
    }

    if (details.length) {
        html += `<h3>Fluxo e eventos detalhados da mailbox pesquisada</h3>`;
        details.forEach((detail, index) => {
            const trace = items.find(item => item.messageTraceId === detail.messageTraceId && item.recipient === detail.recipient) || items[index] || {};
            html += `<div class="trk-detail-card"><div class="trk-detail-title">${trackingEmailEscape(trace.subject || detail.messageId || detail.messageTraceId || "Mensagem")}</div><div class="trk-detail-meta">${trackingEmailEscape(detail.recipient || "")} · ${trackingEmailEscape(detail.messageTraceId || "")}</div>`;
            if (detail.error) {
                html += `<div class="trk-alert trk-alert-warning">Não foi possível obter os detalhes: ${trackingEmailEscape(detail.error)}</div>`;
            } else if (!detail.events || !detail.events.length) {
                html += `<div class="trk-alert trk-alert-warning">O Exchange não devolveu eventos detalhados para esta mensagem.</div>`;
            } else {
                html += `<div class="trk-table-wrap"><table class="trk-table"><thead><tr><th>Data</th><th>Evento</th><th>Ação</th><th>Detalhe</th><th>IP</th></tr></thead><tbody>`;
                detail.events.forEach(event => {
                    html += `<tr><td>${trackingEmailEscape(event.date || event.dateUtc || "")}</td><td><b>${trackingEmailEscape(event.event || "")}</b></td><td>${trackingEmailEscape(event.action || "")}</td><td>${trackingEmailEscape(event.detail || event.data || "")}</td><td>${trackingEmailEscape(event.fromIp || event.toIp || "")}</td></tr>`;
                });
                html += `</tbody></table></div>`;
            }
            html += `</div>`;
        });
    }

    return html;
}

function trackingEmailRenderRules(data) {
    const items = data.rules || [];
    const summary = data.summary || {};
    let html = "";

    if (summary.rulesError) {
        html += `<div class="trk-alert trk-alert-warning"><b>Erro na consulta de regras</b><br>${trackingEmailEscape(summary.rulesError)}</div>`;
    }

    if (!items.length) {
        return html + `<div class="trk-alert ${summary.rulesError ? "trk-alert-warning" : "trk-alert-success"}">${summary.rulesError ? "Não foi possível confirmar a ausência de regras." : "Nenhuma regra encontrada."}</div>`;
    }

    html += `<h3>Regras da mailbox</h3><div class="trk-table-wrap"><table class="trk-table"><thead><tr><th>Prioridade</th><th>Nome</th><th>Ativa</th><th>Oculta</th><th>Ação</th><th>Condição</th></tr></thead><tbody>`;
    items.forEach(item => {
        const risky = item.deleteMessage || item.softDeleteMessage || item.forwardTo || item.redirectTo || item.forwardAsAttachmentTo;
        html += `<tr><td>${trackingEmailEscape(item.priority)}</td><td>${trackingEmailEscape(item.name)}</td><td>${trackingEmailEscape(item.enabled)}</td><td>${item.isHidden ? "Sim" : "Não"}</td><td style="${risky ? "color:#842029;font-weight:700;" : ""}">${trackingEmailEscape(item.actionSummary || "Outra ação")}</td><td>${trackingEmailEscape(item.conditionSummary || "")}</td></tr>`;
    });
    return html + "</tbody></table></div>";
}

function trackingEmailRenderAudit(data) {
    const items = data.audits || [];
    const summary = data.summary || {};
    let html = "";

    if (summary.auditError) {
        html += `<div class="trk-alert trk-alert-warning"><b>Erro parcial ou total na auditoria</b><br>${trackingEmailEscape(summary.auditError)}</div>`;
    }

    if (summary.auditTruncated) {
        html += `<div class="trk-alert trk-alert-warning"><b>Resultado possivelmente truncado</b><br>Reduza o período da auditoria para obter um resultado mais preciso.</div>`;
    }

    if (!items.length) {
        return html + `<div class="trk-alert ${summary.auditError ? "trk-alert-warning" : "trk-alert-success"}">${summary.auditError ? "Não foi possível confirmar a ausência de eventos." : "Nenhum evento correspondente foi encontrado no período."}</div>`;
    }

    html += `<h3>Eventos de auditoria</h3><div class="trk-table-wrap"><table class="trk-table"><thead><tr><th>Data</th><th>Operação</th><th>Utilizador</th><th>Mailbox</th><th>Assunto</th><th>Pasta</th><th>Destino</th></tr></thead><tbody>`;
    items.forEach(item => {
        html += `<tr><td>${trackingEmailEscape(item.creationDate)}</td><td>${trackingEmailEscape(item.operation)}</td><td>${trackingEmailEscape(item.actor)}</td><td>${trackingEmailEscape(item.mailboxOwner)}</td><td>${trackingEmailEscape(item.subject)}</td><td>${trackingEmailEscape(item.folder)}</td><td>${trackingEmailEscape(item.destinationFolder)}</td></tr>`;
    });
    return html + "</tbody></table></div>";
}

function trackingEmailExtractEmail(value) {
    if (!value) return "";
    const angle = String(value).match(/<([^>]+@[^>]+)>/);
    if (angle) return angle[1].trim();
    const email = String(value).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    return email ? email[0].trim() : String(value).trim();
}

function trackingEmailFormatDatetimeLocal(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function trackingEmailParseHeaders(raw) {
    const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const header = (normalized.split("\n\n")[0] || normalized).replace(/\n[ \t]+/g, " ");

    function getHeader(name) {
        const regex = new RegExp("^" + name + "\\s*:\\s*(.*)$", "im");
        const match = header.match(regex);
        return match ? match[1].trim() : "";
    }

    return {
        from: getHeader("From"),
        to: getHeader("To"),
        cc: getHeader("Cc"),
        subject: getHeader("Subject"),
        date: getHeader("Date"),
        messageId: getHeader("Message-ID") || getHeader("Message-Id")
    };
}

async function trackingEmailLerFicheiroEmail() {
    const input = document.getElementById("trackingEmailFile");
    const result = document.getElementById("trackingEmailFileResumo");

    if (!input || !input.files || !input.files.length) {
        trackingEmailNotice("Selecione um ficheiro .EML ou .TXT.", "warning");
        return;
    }

    const file = input.files[0];
    const extension = file.name.split(".").pop().toLowerCase();

    if (extension !== "eml" && extension !== "txt") {
        trackingEmailNotice("Para ficheiros .MSG utilize o botão Ler .MSG via Outlook.", "warning");
        return;
    }

    trackingEmailSetBusy(true);
    trackingEmailStartProgress("A ler ficheiro...");

    try {
        const buffer = await file.arrayBuffer();
        let text = new TextDecoder("utf-8").decode(buffer);
        if (!text || text.indexOf("From:") === -1) text = new TextDecoder("iso-8859-1").decode(buffer);

        const headers = trackingEmailParseHeaders(text);
        trackingEmailFileData = {
            fileName: file.name,
            extension,
            fromRaw: headers.from,
            toRaw: headers.to,
            ccRaw: headers.cc,
            subject: headers.subject,
            dateRaw: headers.date,
            messageId: headers.messageId,
            fromEmail: trackingEmailExtractEmail(headers.from),
            toEmail: trackingEmailExtractEmail(headers.to),
            dateLocal: trackingEmailFormatDatetimeLocal(headers.date)
        };

        trackingEmailMostrarResumoAnexo();
        trackingEmailPreencherComFicheiro();
        trackingEmailNotice("Ficheiro lido e campos preenchidos.", "success");
        trackingEmailFinishProgress("Ficheiro lido.");
    } catch (error) {
        if (result) result.value = "Erro ao ler o ficheiro: " + error.message;
        trackingEmailNotice("Erro ao ler o ficheiro: " + error.message, "danger");
        trackingEmailFinishProgress("Erro ao ler ficheiro.");
    } finally {
        trackingEmailSetBusy(false);
    }
}

async function trackingEmailLerMSGOutlook() {
    const path = trackingEmailValue("trackingMsgPath").trim();
    const result = document.getElementById("trackingEmailFileResumo");

    if (!path) {
        trackingEmailNotice("Informe o caminho completo do ficheiro .MSG.", "warning");
        return;
    }

    trackingEmailSetBusy(true);
    trackingEmailStartProgress("A ler .MSG via Outlook...");

    const payload = { action: "lerMsgOutlook", msgPath: path };
    const url = `/module/${TRACKING_EMAIL_MODULE}/api?action=lerMsgOutlook`;

    try {
        const response = await fetch(url, {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
        const json = trackingEmailParseResponse(text);

        if (!json.success) {
            throw new Error(json.message || "Erro ao ler o ficheiro .MSG.");
        }

        const data = json.data || {};
        trackingEmailFileData = {
            fileName: data.fileName || path,
            extension: "msg",
            fromRaw: data.from || "",
            toRaw: data.to || "",
            ccRaw: data.cc || "",
            subject: data.subject || "",
            dateRaw: data.receivedTime || data.sentOn || "",
            messageId: data.internetMessageId || "",
            fromEmail: data.senderEmailAddress || trackingEmailExtractEmail(data.from || ""),
            toEmail: trackingEmailExtractEmail(data.to || ""),
            dateLocal: data.dateLocal || ""
        };

        trackingEmailMostrarResumoAnexo();
        trackingEmailPreencherComFicheiro();
        await trackingEmailResolverDestinatarioAtual();
        trackingEmailNotice("Ficheiro .MSG lido e dados preenchidos.", "success");
        trackingEmailFinishProgress(".MSG lido e dados preenchidos.");
    } catch (error) {
        if (result) result.value = "Erro ao chamar a API MSG: " + error.message;
        trackingEmailNotice("Erro ao ler .MSG: " + error.message, "danger");
        trackingEmailFinishProgress("Erro ao ler .MSG.");
    } finally {
        trackingEmailSetBusy(false);
    }
}

function trackingEmailMostrarResumoAnexo() {
    const result = document.getElementById("trackingEmailFileResumo");
    const data = trackingEmailFileData;
    if (!result || !data) return;

    result.value = `FICHEIRO ANALISADO
============================================================
Nome: ${data.fileName}
Tipo: ${data.extension}

DADOS EXTRAÍDOS
============================================================
From: ${data.fromRaw || "Não encontrado"}
SenderEmail: ${data.fromEmail || "Não encontrado"}
To: ${data.toRaw || "Não encontrado"}
Cc: ${data.ccRaw || "Não encontrado"}
Subject: ${data.subject || "Não encontrado"}
Date: ${data.dateRaw || "Não encontrado"}
Message-ID: ${data.messageId || "Não encontrado"}
`;
}

function trackingEmailPreencherComFicheiro() {
    const data = trackingEmailFileData;
    if (!data) return;

    if (data.toEmail) {
        document.getElementById("trackingMailbox").value = data.toEmail;
        document.getElementById("trackingRecipient").value = data.toEmail;
    }

    if (data.fromEmail) document.getElementById("trackingSender").value = data.fromEmail;
    if (data.subject) document.getElementById("trackingSubject").value = data.subject;
    if (data.messageId) document.getElementById("trackingMessageId").value = data.messageId;

    if (data.dateLocal) {
        const center = new Date(data.dateLocal);
        if (!Number.isNaN(center.getTime())) {
            const start = new Date(center.getTime() - 2 * 60 * 60000);
            const end = new Date(center.getTime() + 2 * 60 * 60000);
            document.getElementById("trackingStart").value = trackingEmailFormatDatetimeLocal(start);
            document.getElementById("trackingEnd").value = trackingEmailFormatDatetimeLocal(end);
        }
    }

    const ticket = document.getElementById("trackingTicketText");
    if (ticket) {
        ticket.value = (ticket.value || "") + `\n\nDADOS EXTRAÍDOS DO ANEXO DO EMAIL:\nFicheiro: ${data.fileName}\nFrom: ${data.fromRaw || ""}\nTo: ${data.toRaw || ""}\nSubject: ${data.subject || ""}\nDate: ${data.dateRaw || ""}\nMessage-ID: ${data.messageId || ""}\n`;
    }
}

function trackingEmailExtrairDados() {
    const text = trackingEmailValue("trackingTicketText");
    if (!text.trim()) {
        trackingEmailNotice("Cole o texto do ticket antes de extrair os dados.", "warning");
        return;
    }

    trackingEmailStartProgress("A extrair dados do ticket...");

    function labeledEmail(labels) {
        for (const label of labels) {
            const regex = new RegExp(`(?:^|\\n)\\s*${label}\\s*[:=-]\\s*[^\\n<]*<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})>?`, "im");
            const match = text.match(regex);
            if (match) return match[1].trim();
        }
        return "";
    }

    const from = labeledEmail(["from", "de", "remetente"]);
    const to = labeledEmail(["to", "para", "destinat[aá]rio", "recipient"]);
    const allEmails = [...new Set(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])];

    let sender = from;
    let recipient = to;

    if (!sender && !recipient && allEmails.length >= 2) {
        sender = allEmails[0];
        recipient = allEmails[1];
    } else if (!recipient && allEmails.length === 1) {
        recipient = allEmails[0];
    }

    if (sender) document.getElementById("trackingSender").value = sender;
    if (recipient) {
        document.getElementById("trackingRecipient").value = recipient;
        document.getElementById("trackingMailbox").value = recipient;
    }

    const subjectMatch = text.match(/(?:^|\n)\s*(?:subject|assunto)\s*[:=-]\s*(.+)$/im);
    if (subjectMatch) document.getElementById("trackingSubject").value = subjectMatch[1].trim();

    const messageIdMatch = text.match(/(?:^|\n)\s*message-id\s*:\s*(<[^>]+>|\S+)/im);
    if (messageIdMatch) document.getElementById("trackingMessageId").value = messageIdMatch[1].trim();

    const dateMatch = text.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})\b/);
    const timeMatch = text.match(/\b(\d{1,2})[hH:](\d{2})\b/);

    if (dateMatch && timeMatch) {
        const eventDate = new Date(Number(dateMatch[3]), Number(dateMatch[2]) - 1, Number(dateMatch[1]), Number(timeMatch[1]), Number(timeMatch[2]));
        const start = new Date(eventDate.getTime() - 2 * 60 * 60000);
        const end = new Date(eventDate.getTime() + 2 * 60 * 60000);
        document.getElementById("trackingStart").value = trackingEmailFormatDatetimeLocal(start);
        document.getElementById("trackingEnd").value = trackingEmailFormatDatetimeLocal(end);
    }

    trackingEmailNotice("Dados extraídos. O destinatário foi usado como mailbox e o From visível foi mantido apenas como referência; o sistema pesquisará também sem esse filtro.", "success");
    trackingEmailFinishProgress("Dados extraídos.");
}

function trackingEmailSaudacao() {
    const date = new Date();
    const minutes = date.getHours() * 60 + date.getMinutes();
    if (minutes <= 720) return "Bom dia";
    if (minutes <= 1080) return "Boa tarde";
    return "Boa noite";
}

function trackingEmailGetSolicitanteNome() {
    return trackingEmailValue("trackingSolicitanteDisplay").trim() || trackingEmailValue("trackingSolicitante").trim();
}

function trackingEmailDadosEmFalta() {
    const missing = [];
    if (!trackingEmailValue("trackingMailbox").trim()) missing.push("Mailbox / caixa de correio a analisar");
    if (!trackingEmailValue("trackingStart")) missing.push("Data e hora inicial do período em análise");
    if (!trackingEmailValue("trackingEnd")) missing.push("Data e hora final do período em análise");
    return missing;
}

function trackingEmailValidate(action) {
    const mailbox = trackingEmailValue("trackingMailbox").trim();
    const startValue = trackingEmailValue("trackingStart");
    const endValue = trackingEmailValue("trackingEnd");

    if (["analiseCompleta", "regras", "auditoria"].includes(action) && !mailbox) {
        trackingEmailNotice("Informe a mailbox antes de executar esta consulta.", "warning");
        return false;
    }

    if (action === "messageTrace" && !mailbox && !trackingEmailValue("trackingRecipient").trim() && !trackingEmailValue("trackingSender").trim() && !trackingEmailValue("trackingMessageId").trim()) {
        trackingEmailNotice("Informe a mailbox/destinatário, o remetente ou o Message-ID para o Message Trace.", "warning");
        return false;
    }

    if (["analiseCompleta", "messageTrace", "auditoria"].includes(action) && (!startValue || !endValue)) {
        trackingEmailNotice("Informe a data inicial e a data final para executar esta consulta.", "warning");
        return false;
    }

    if (["analiseCompleta", "messageTrace", "auditoria"].includes(action) && startValue && endValue) {
        const start = new Date(startValue);
        const end = new Date(endValue);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
            trackingEmailNotice("A data inicial deve ser anterior à data final.", "warning");
            return false;
        }
    }

    return true;
}

function trackingEmailGerarFecho() {
    const missing = trackingEmailDadosEmFalta();
    const name = trackingEmailGetSolicitanteNome();
    const introduction = name ? `${trackingEmailSaudacao()} ${name},` : `${trackingEmailSaudacao()},`;
    let text = "";

    if (missing.length) {
        text = `${introduction}\n\nPara concluir a análise, são necessários os seguintes dados:\n- ${missing.join("\n- ")}\n\nAtenciosamente,\nIT Santander Portugal`;
    } else if (!trackingEmailLastData || trackingEmailLastData.analysisComplete !== true) {
        text = `${introduction}\n\nAinda não foi executada uma análise completa para a mailbox ${trackingEmailValue("trackingMailbox")}. Execute a análise antes de gerar o texto técnico de fecho.\n\nAtenciosamente,\nIT Santander Portugal`;
    } else {
        const mailbox = trackingEmailLastData.mailbox || {};
        const summary = trackingEmailLastData.summary || {};
        const traces = trackingEmailLastData.traces || [];
        const rules = trackingEmailLastData.rules || [];
        const audits = trackingEmailLastData.audits || [];
        const deleteRules = rules.filter(rule => rule.deleteMessage || rule.softDeleteMessage);
        const moveRules = rules.filter(rule => rule.moveToFolder);
        const forwardRules = rules.filter(rule => rule.forwardTo || rule.redirectTo || rule.forwardAsAttachmentTo);
        text = `${introduction}\n\nFoi efetuada a análise da mailbox ${mailbox.identity || trackingEmailValue("trackingMailbox")} no Exchange Online.\n\nResumo da análise:\n- Tipo da mailbox: ${mailbox.recipientTypeDetails || "Não identificado"}\n- Confirmação da entrega: ${summary.traceDeliveryConfirmation || "Não localizada para a mailbox"}\n- Resultado do transporte: ${summary.traceDeliveryOutcome || "Não localizado"}\n- Endereço da mailbox confirmado: ${(summary.traceMatchedMailboxAddresses || []).join("; ") || "Nenhum"}\n- Outros destinatários do mesmo envio: ${summary.traceOtherRecipientCount || 0}\n- Regras existentes na mailbox: ${summary.rulesCount || 0}\n- Regras que eliminam mensagens: ${summary.deleteRulesCount || 0}\n- Regras que encaminham ou redirecionam: ${summary.forwardRulesCount || 0}\n- Eventos de auditoria encontrados no período: ${summary.auditCount || 0}\n- Forwarding ativo na mailbox: ${mailbox.hasForwarding ? "Sim" : "Não"}\n`;

        if (mailbox.hasForwarding) {
            text += `- Destino do forwarding: ${mailbox.forwardingAddress || mailbox.forwardingSmtpAddress || "Não identificado"}\n- Entregar também na mailbox: ${mailbox.deliverToMailboxAndForward || "Não identificado"}\n`;
        }

        text += "\nResultado encontrado:\n";

        if (summary.traceError) {
            text += `A consulta de Message Trace apresentou erro parcial ou total: ${summary.traceError}\n`;
        } else if (["primary", "technical", "alias"].includes(summary.traceDeliveryScope) && traces.length) {
            text += `A entrega foi confirmada para a mailbox. ${summary.traceDeliveryConfirmation || "Entrega confirmada"}. Resultado registado: ${summary.traceDeliveryOutcome || "Localizado"}.\n`;
            if (summary.traceMatchedMailboxAddresses && summary.traceMatchedMailboxAddresses.length) text += `Endereço usado pelo Exchange: ${summary.traceMatchedMailboxAddresses.join("; ")}\n`;
            if (summary.traceActualSenders && summary.traceActualSenders.length) text += `MAIL FROM registado: ${summary.traceActualSenders.join("; ")}\n`;
        } else if (summary.traceDeliveryScope === "otherRecipientsOnly") {
            text += `O envio foi localizado para outros destinatários, mas não foi encontrada entrega para nenhum endereço associado à mailbox analisada. Total de outros destinatários encontrados: ${summary.traceOtherRecipientCount || 0}.\n`;
        } else {
            text += "Não foi localizada uma entrega para nenhum endereço associado à mailbox no período informado.\n";
        }

        if (summary.traceTruncated) {
            text += "O resultado do Message Trace pode estar truncado devido ao limite de resultados.\n";
        }

        if (deleteRules.length) {
            text += "\nForam identificadas regras que eliminam mensagens:\n";
            deleteRules.forEach(rule => { text += `- ${rule.name}: ${rule.actionSummary || "Eliminação"}\n`; });
        }

        if (moveRules.length) {
            text += "\nForam identificadas regras que movem mensagens:\n";
            moveRules.forEach(rule => { text += `- ${rule.name}: ${rule.moveToFolder}\n`; });
        }

        if (forwardRules.length) {
            text += "\nForam identificadas regras que encaminham ou redirecionam mensagens:\n";
            forwardRules.forEach(rule => { text += `- ${rule.name}: ${rule.actionSummary}\n`; });
        }

        if (summary.auditError) {
            text += `\nA consulta de auditoria apresentou erro parcial ou total: ${summary.auditError}\n`;
        } else if (audits.length) {
            text += "\nForam encontrados eventos de auditoria no período analisado.\n";
        } else {
            text += "\nNão foram encontrados eventos correspondentes nas pesquisas de auditoria disponíveis para o período analisado.\n";
        }

        text += "\nAtenciosamente,\nIT Santander Portugal";
    }

    document.getElementById("trackingFechoTicket").value = text;
    trackingEmailNotice("Texto de fecho gerado.", "success");
    trackingEmailFinishProgress("Texto de fecho gerado.");
}

function trackingEmailCopiarFecho() {
    const element = document.getElementById("trackingFechoTicket");
    if (!element || !element.value.trim()) {
        trackingEmailNotice("Não existe texto para copiar.", "warning");
        return;
    }

    navigator.clipboard.writeText(element.value)
        .then(() => {
            trackingEmailNotice("Texto copiado.", "success");
            trackingEmailFinishProgress("Texto copiado.");
        })
        .catch(() => {
            element.select();
            document.execCommand("copy");
            trackingEmailNotice("Texto copiado.", "success");
            trackingEmailFinishProgress("Texto copiado.");
        });
}

function trackingEmailBuildPayload(action) {
    return {
        action,
        adminUpn: trackingEmailValue("trackingAdminUpn").trim(),
        mailbox: trackingEmailValue("trackingMailbox").trim(),
        start: trackingEmailValue("trackingStart"),
        end: trackingEmailValue("trackingEnd"),
        sender: trackingEmailValue("trackingSender").trim(),
        recipient: trackingEmailValue("trackingRecipient").trim(),
        subject: trackingEmailValue("trackingSubject").trim(),
        messageId: trackingEmailValue("trackingMessageId").trim(),
        solicitante: trackingEmailValue("trackingSolicitante").trim()
    };
}

async function trackingEmailApi(action, options = {}) {
    if (!options.skipValidation && !trackingEmailValidate(action)) return null;

    const payload = trackingEmailBuildPayload(action);
    const url = `/module/${TRACKING_EMAIL_MODULE}/api?action=${encodeURIComponent(action)}`;

    const isLongOperation = ["analiseCompleta", "messageTrace", "regras", "auditoria"].includes(action);
    if (isLongOperation) {
        window.__SantanderLongOperationCount = Number(window.__SantanderLongOperationCount || 0) + 1;
        if (typeof window.SantanderPauseBackgroundMonitoring === "function") window.SantanderPauseBackgroundMonitoring();
    }
    trackingEmailSetBusy(true);
    trackingEmailStartProgress(options.progressText || `A executar ${action}...`);

    try {
        const response = await fetch(url, {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);

        let json;
        try {
            json = trackingEmailParseResponse(text);
        } catch (parseError) {
            throw new Error("Resposta inválida da API: " + parseError.message + ". Conteúdo: " + text.slice(0, 500));
        }

        if (action === "connectExchange" || action === "checkExchange") {
            trackingEmailSetExoStatus(json.connected || json.success ? "Conectado" : "Desconectado");
            trackingEmailNotice(json.message || (json.success ? "Exchange Online conectado." : "Exchange Online desconectado."), json.success ? "success" : "warning");
            trackingEmailFinishProgress(json.success ? "Concluído." : "Exchange não conectado.");
            return json;
        }

        if (action === "resolverSolicitante") {
            const display = document.getElementById("trackingSolicitanteDisplay");
            if (display) display.value = json.data && json.data.displayName ? json.data.displayName : trackingEmailValue("trackingSolicitante");
            trackingEmailFinishProgress("Solicitante resolvido.");
            return json;
        }

        if (!json.success) {
            throw new Error(json.message || "A API devolveu um erro sem mensagem.");
        }

        if (action !== "lerMsgOutlook") trackingEmailSetExoStatus("Conectado");

        if (json.data) {
            const resultData = action === "analiseCompleta" ? json.data : trackingEmailMergePartial(action, json.data);
            trackingEmailRender(resultData);
        }

        const resultStatus = json.data && json.data.analysisStatus ? json.data.analysisStatus : (json.data && json.data.summary && json.data.summary.traceMatchLevel === "notFound" ? "danger" : "success");
        trackingEmailNotice(json.message || "Consulta concluída.", resultStatus === "danger" ? "danger" : resultStatus === "warning" ? "warning" : "success");
        trackingEmailFinishProgress("Concluído.");
        return json;
    } catch (error) {
        if (action !== "resolverSolicitante") {
            trackingEmailShowDashboard();
            trackingEmailSetResultado("Erro: " + error.message);
        }
        trackingEmailNotice("Erro: " + error.message, "danger");
        trackingEmailFinishProgress("Erro.");
        return null;
    } finally {
        trackingEmailSetBusy(false);
        if (isLongOperation) {
            window.__SantanderLongOperationCount = Math.max(0, Number(window.__SantanderLongOperationCount || 1) - 1);
            window.__SantanderLongOperationUntil = Date.now() + 10000;
        }
    }
}

function trackingEmailConectarEXO() { return trackingEmailApi("connectExchange", { skipValidation: true, progressText: "A conectar ao Exchange Online..." }); }
function trackingEmailCheckEXO() { return trackingEmailApi("checkExchange", { skipValidation: true, progressText: "A verificar a sessão Exchange Online..." }); }
function trackingEmailExecutarAnalise() { return trackingEmailApi("analiseCompleta", { progressText: "A executar análise completa..." }); }
function trackingEmailMessageTrace() { return trackingEmailApi("messageTrace", { progressText: "A rastrear a entrega no Exchange Online..." }); }
function trackingEmailRegras() { return trackingEmailApi("regras", { progressText: "A consultar regras da mailbox..." }); }
function trackingEmailAuditoria() { return trackingEmailApi("auditoria", { progressText: "A consultar auditoria..." }); }
function trackingEmailResolverSolicitante() { return trackingEmailApi("resolverSolicitante", { skipValidation: true, progressText: "A resolver solicitante..." }); }

function trackingEmailLimpar() {
    [
        "trackingTicketText", "trackingMailbox", "trackingSender", "trackingRecipient",
        "trackingSubject", "trackingMessageId", "trackingStart", "trackingEnd", "trackingSolicitante",
        "trackingSolicitanteDisplay", "trackingFechoTicket", "trackingEmailFileResumo",
        "trackingMsgPath"
    ].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.value = "";
    });

    const file = document.getElementById("trackingEmailFile");
    if (file) file.value = "";

    trackingEmailLastData = null;
    trackingEmailFileData = null;

    const dashboard = document.getElementById("trackingDashboard");
    if (dashboard) dashboard.style.display = "none";

    trackingEmailNotice("Campos limpos.", "success");
    trackingEmailFinishProgress("Aguardando...", 0);
}

function trackingEmailSetupSolicitanteAuto() {
    const element = document.getElementById("trackingSolicitante");
    if (!element || element.dataset.trackingBound === "1") return;

    element.dataset.trackingBound = "1";
    element.addEventListener("input", () => {
        clearTimeout(trackingSolicitanteTimer);
        trackingSolicitanteTimer = setTimeout(() => {
            if (trackingEmailValue("trackingSolicitante").trim().length >= 3) trackingEmailResolverSolicitante();
        }, 900);
    });

    element.addEventListener("blur", () => {
        if (trackingEmailValue("trackingSolicitante").trim().length >= 3) trackingEmailResolverSolicitante();
    });
}

async function trackingEmailResolverDestinatarioExo(nomeOuEmail) {
    if (!nomeOuEmail || !nomeOuEmail.trim()) return null;

    const payload = {
        action: "resolverDestinatarioExo",
        recipientName: nomeOuEmail,
        mailbox: trackingEmailValue("trackingMailbox"),
        recipient: trackingEmailValue("trackingRecipient")
    };

    const url = `/module/${TRACKING_EMAIL_MODULE}/api?action=resolverDestinatarioExo`;

    try {
        const response = await fetch(url, {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);
        const json = trackingEmailParseResponse(text);

        if (json.success && json.data) return json.data;
        return null;
    } catch (error) {
        trackingEmailNotice("Não foi possível resolver o destinatário: " + error.message, "warning");
        return null;
    }
}

async function trackingEmailResolverDestinatarioAtual() {
    const current = trackingEmailValue("trackingRecipient") || trackingEmailValue("trackingMailbox");
    if (!current.trim()) return false;

    trackingEmailStartProgress("A resolver destinatário no Exchange Online...");
    const result = await trackingEmailResolverDestinatarioExo(current);
    const summary = document.getElementById("trackingEmailFileResumo");

    if (result && result.selected && result.selected.primarySmtpAddress) {
        const selected = result.selected;
        document.getElementById("trackingMailbox").value = selected.primarySmtpAddress;
        document.getElementById("trackingRecipient").value = selected.primarySmtpAddress;

        if (summary) {
            summary.value += "\n\nDESTINATÁRIO RESOLVIDO NO EXCHANGE ONLINE\n";
            summary.value += "============================================================\n";
            summary.value += "Nome: " + (selected.displayName || "") + "\n";
            summary.value += "SMTP: " + (selected.primarySmtpAddress || "") + "\n";
            summary.value += "Tipo: " + (selected.recipientTypeDetails || "") + "\n";
        }

        trackingEmailFinishProgress("Destinatário resolvido e campos atualizados.");
        return true;
    }

    if (result && result.ambiguous && result.results && result.results.length) {
        if (summary) {
            summary.value += "\n\nDESTINATÁRIO AMBÍGUO\n";
            summary.value += "============================================================\n";
            result.results.slice(0, 10).forEach(candidate => {
                summary.value += `- ${candidate.displayName || ""} | ${candidate.primarySmtpAddress || ""} | ${candidate.recipientTypeDetails || ""}\n`;
            });
        }

        trackingEmailNotice("Foram encontrados vários destinatários. Informe o SMTP completo antes de continuar.", "warning");
        trackingEmailFinishProgress("Destinatário ambíguo.");
        return false;
    }

    trackingEmailNotice("Não foi possível resolver o destinatário no Exchange Online.", "warning");
    trackingEmailFinishProgress("Destinatário não resolvido.");
    return false;
}

function trackingEmailInitialize() {
    const adminUpn = localStorage.getItem("trackingEmailAdminUpn");
    const adminInput = document.getElementById("trackingAdminUpn");
    if (adminInput && adminUpn) adminInput.value = adminUpn;

    if (adminInput && adminInput.dataset.trackingBound !== "1") {
        adminInput.dataset.trackingBound = "1";
        adminInput.addEventListener("change", () => {
            localStorage.setItem("trackingEmailAdminUpn", adminInput.value || "");
        });
    }

    trackingEmailSetExoStatus("A verificar...");
    trackingEmailSetupSolicitanteAuto();
    setTimeout(() => trackingEmailCheckEXO(), 300);
}

setTimeout(trackingEmailInitialize, 500);
