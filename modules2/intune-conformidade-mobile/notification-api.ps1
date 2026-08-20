# BEGIN NOTIFICATION SAFE VALUE V12.0.2

# BEGIN VIP OPERATION GUARD V1
$VipApiPathGuardV1 = Join-Path $PSScriptRoot "vip-users-api.ps1"
if (Test-Path -LiteralPath $VipApiPathGuardV1) {
    . $VipApiPathGuardV1
}

function ConvertFrom-VipGuardJsonV1 {
    param([AllowNull()][object]$Value)
    if ($null -eq $Value) { return $null }
    if ($Value -isnot [string]) { return $Value }

    $text = ([string]$Value).Trim()
    if (-not $text) { return $null }

    try {
        $parsed = $text | ConvertFrom-Json -ErrorAction Stop
        if ($parsed -is [string]) {
            return ([string]$parsed) | ConvertFrom-Json -ErrorAction Stop
        }
        return $parsed
    } catch {
        return $null
    }
}

function Get-VipGuardPayloadV1 {
    foreach ($name in @("Body", "Payload", "payload")) {
        try {
            $variable = Get-Variable -Name $name -ErrorAction SilentlyContinue
            if ($variable -and $null -ne $variable.Value) {
                $parsed = ConvertFrom-VipGuardJsonV1 $variable.Value
                if ($parsed) { return $parsed }
            }
        } catch {}
    }
    return [pscustomobject]@{}
}

function Get-VipGuardActionV1 {
    foreach ($name in @("Action", "action")) {
        try {
            $variable = Get-Variable -Name $name -ErrorAction SilentlyContinue
            if ($variable -and $variable.Value) {
                return ([string]$variable.Value).Trim()
            }
        } catch {}
    }
    return ""
}

function Resolve-VipGuardIdentityV1 {
    param([AllowNull()][object]$Payload)

    foreach ($propertyName in @(
        "userPrincipalName", "upn", "email", "recipient",
        "mail", "userEmail", "to"
    )) {
        try {
            $property = $Payload.PSObject.Properties[$propertyName]
            if ($property -and $property.Value) {
                $normalized = Normalize-VipUserPrincipalName $property.Value
                if ($normalized) { return $normalized }
            }
        } catch {}
    }

    $deviceKey = $null
    try { $deviceKey = [string]$Payload.deviceKey } catch {}

    if ($deviceKey) {
        $lifecyclePath = Join-Path $PSScriptRoot "notification-lifecycle.json"
        if (Test-Path -LiteralPath $lifecyclePath) {
            try {
                $lifecycle = Get-Content -LiteralPath $lifecyclePath -Raw | ConvertFrom-Json
                $collections = @()
                foreach ($name in @("items", "preventiveItems")) {
                    if ($lifecycle.PSObject.Properties[$name]) {
                        $collections += @($lifecycle.$name)
                    }
                }

                $item = @(
                    $collections |
                    Where-Object {
                        ([string]$_.deviceKey).Equals(
                            $deviceKey,
                            [System.StringComparison]::OrdinalIgnoreCase
                        )
                    }
                ) | Select-Object -First 1

                if ($item) {
                    foreach ($name in @("userPrincipalName", "upn", "email", "userEmail")) {
                        $property = $item.PSObject.Properties[$name]
                        if ($property -and $property.Value) {
                            $normalized = Normalize-VipUserPrincipalName $property.Value
                            if ($normalized) { return $normalized }
                        }
                    }
                }
            } catch {}
        }
    }

    return $null
}

$VipGuardActionV1 = Get-VipGuardActionV1
$VipGuardPayloadV1 = Get-VipGuardPayloadV1
$VipGuardIdentityV1 = Resolve-VipGuardIdentityV1 $VipGuardPayloadV1
$VipGuardMatchV1 = if ($VipGuardIdentityV1) {
    Get-VipUserMatch $VipGuardIdentityV1
} else {
    $null
}

if ($VipGuardMatchV1) {
    $VipGuardIsTestV1 = $false
    $VipGuardApprovedV1 = $false
    $VipGuardStatusV1 = ""

    try { $VipGuardIsTestV1 = [bool]$VipGuardPayloadV1.isTest } catch {}
    try { $VipGuardApprovedV1 = [bool]$VipGuardPayloadV1.vipManualApproval } catch {}
    try { $VipGuardStatusV1 = [string]$VipGuardPayloadV1.status } catch {}

    $VipNotificationActionsV1 = @(
        "sendNotification",
        "prepareNotification",
        "sendOutlookNotification",
        "prepareOutlookNotification",
        "sendSelected",
        "send"
    )

    $VipProtectedStatusesV1 = @(
        "ReadyForRemoval",
        "ReadyToRemove",
        "RemovedByUser",
        "RemovedByTeam"
    )

    if (
        -not $VipGuardIsTestV1 -and
        $VipGuardActionV1 -in $VipNotificationActionsV1 -and
        -not $VipGuardApprovedV1
    ) {
        throw "Operação bloqueada: o destinatário $VipGuardIdentityV1 é VIP e exige validação manual."
    }

    if (
        $VipGuardActionV1 -eq "setLifecycleStatus" -and
        $VipGuardStatusV1 -in $VipProtectedStatusesV1 -and
        -not $VipGuardApprovedV1
    ) {
        throw "Alteração bloqueada: o equipamento pertence ao utilizador VIP $VipGuardIdentityV1 e exige aprovação manual."
    }
}
# END VIP OPERATION GUARD V1

function Get-NotificationValueV1202 {
    param(
        [AllowNull()]$Object,
        [Parameter(Mandatory)][string]$Name,
        $Default = $null
    )

    if ($null -eq $Object) {
        return $Default
    }

    $property = $Object.PSObject.Properties[$Name]

    if ($property) {
        return $property.Value
    }

    return $Default
}
# END NOTIFICATION SAFE VALUE V12.0.2

# BEGIN INTUNE MOBILE NOTIFICATION API V1
Set-StrictMode -Version 2.0

if (-not (Get-Command Register-NotificationLifecycle -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'notification-lifecycle-api.ps1')
}

function ConvertFrom-NotificationPayload {
    param([Parameter(Mandatory)][string]$Payload)

    try {
        $decoded = [System.Uri]::UnescapeDataString($Payload)
        return $decoded | ConvertFrom-Json
    }
    catch {
        throw "Payload de notificação inválido: $($_.Exception.Message)"
    }
}

function Get-NotificationConfig {
    $path = Join-Path $PSScriptRoot 'notification-config.json'
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Configuração de notificações não encontrada: $path"
    }
    return (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Get-NotificationGraphSender {
    param($Config)

    if ($Config.senderUserId -and -not [string]::IsNullOrWhiteSpace([string]$Config.senderUserId)) {
        return [string]$Config.senderUserId
    }

    if (-not (Get-Command Get-MgContext -ErrorAction SilentlyContinue)) {
        throw 'Microsoft Graph PowerShell não está disponível. Instale/importe Microsoft.Graph.Authentication.'
    }

    $ctx = Get-MgContext
    if (-not $ctx -or [string]::IsNullOrWhiteSpace([string]$ctx.Account)) {
        throw 'Não existe sessão Microsoft Graph ativa.'
    }

    return [string]$ctx.Account
}

function New-MobileComplianceEmailBody {
    param(
        [Parameter(Mandatory)]$Data,
        [Parameter(Mandatory)]$Config
    )

    $displayName = if ($Data.displayName) { [string]$Data.displayName } else { [string]$Data.email }
    $deviceName = if ($Data.deviceName) { [string]$Data.deviceName } else { 'Não identificado' }
    $os = if ($Data.operatingSystem) { [string]$Data.operatingSystem } else { 'Não identificado' }
    $intune = if ($Data.intuneStatus) { [string]$Data.intuneStatus } else { 'Não identificado' }
    $harmony = if ($Data.harmonyStatus) { [string]$Data.harmonyStatus } else { 'Não identificado' }
    $lastSync = if ($Data.lastSync) { [string]$Data.lastSync } else { 'Não disponível' }
    $problem = if ((Get-NotificationValueV1202 -Object $Data -Name 'problemDescription' -Default '')) { [string](Get-NotificationValueV1202 -Object $Data -Name 'problemDescription' -Default '') } else { 'Foi identificada uma pendência na configuração de segurança do equipamento.' }
    $instructions = if ($Data.instructions) { [string]$Data.instructions } else { 'Abra o Harmony no telemóvel e confirme que a aplicação está ativa, configurada e sem mensagens de erro. Em seguida, sincronize o equipamento no Portal da Empresa.' }

    $safe = {
        param([object]$v)
        [System.Net.WebUtility]::HtmlEncode([string]$v)
    }

    return @"
<!doctype html>
<html>
<body style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#252525">
<p>Bom dia, $(&$safe $displayName),</p>

<p>Identificámos uma pendência na configuração de segurança do seu equipamento móvel.</p>

<table style="border-collapse:collapse;margin:14px 0">
<tr><td style="padding:5px 12px 5px 0"><strong>Utilizador</strong></td><td>$(&$safe $Data.email)</td></tr>
<tr><td style="padding:5px 12px 5px 0"><strong>Equipamento</strong></td><td>$(&$safe $deviceName)</td></tr>
<tr><td style="padding:5px 12px 5px 0"><strong>Sistema operativo</strong></td><td>$(&$safe $os)</td></tr>
<tr><td style="padding:5px 12px 5px 0"><strong>Estado no Intune</strong></td><td>$(&$safe $intune)</td></tr>
<tr><td style="padding:5px 12px 5px 0"><strong>Estado do Harmony</strong></td><td>$(&$safe $harmony)</td></tr>
<tr><td style="padding:5px 12px 5px 0"><strong>Última sincronização</strong></td><td>$(&$safe $lastSync)</td></tr>
</table>

<p><strong>Situação identificada</strong><br>$(&$safe $problem)</p>

<p><strong>Ação necessária</strong><br>$(&$safe $instructions)</p>

<p>Após concluir a configuração, aguarde a atualização dos sistemas. Caso a situação permaneça, abra um pedido no ServiceNow para validação pela equipa responsável.</p>

<p>Obrigado,<br>$(&$safe $Config.signature)</p>
</body>
</html>
"@
}

# BEGIN INTUNE MOBILE NOTIFICATION MULTIDEVICE V2
function Add-MobileDevicesSummaryToHtml {
    param(
        [Parameter(Mandatory)][string]$Html,
        $Data
    )

    if (-not $Data.PSObject.Properties['devicesSummary']) {
        return $Html
    }

    $summary = [string]$Data.devicesSummary
    if ([string]::IsNullOrWhiteSpace($summary)) {
        return $Html
    }

    $encoded = [System.Net.WebUtility]::HtmlEncode($summary) -replace "(`r`n|`n|`r)", '<br>'
    $block = "<p><strong>Equipamentos abrangidos pela notificação</strong><br>$encoded</p>"

    if ($Html -match '(?i)</body>') {
        return [regex]::Replace($Html, '(?i)</body>', "$block`r`n</body>", 1)
    }

    return "$Html`r`n$block"
}
# END INTUNE MOBILE NOTIFICATION MULTIDEVICE V2

function Send-MobileComplianceNotification {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Data,
        [switch]$IsTest
    )

    $config = Get-NotificationConfig

    if (-not $config.enabled) {
        throw 'O envio de notificações está desativado na configuração.'
    }

    $recipient = if ($IsTest) { [string]$Data.testRecipient } else { [string]$Data.email }
    if ([string]::IsNullOrWhiteSpace($recipient) -or $recipient -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
        throw "Destinatário inválido: $recipient"
    }

    if (-not $IsTest -and -not [bool]$config.allowRealSend) {
        throw 'Envio real bloqueado. Valide o teste e altere allowRealSend para true em notification-config.json.'
    }

    if (-not (Get-Command Send-MgUserMail -ErrorAction SilentlyContinue)) {
        try {
            Import-Module Microsoft.Graph.Users.Actions -ErrorAction Stop
        }
        catch {
            throw 'Comando Send-MgUserMail indisponível. Instale Microsoft.Graph.Users.Actions e conecte com Mail.Send.'
        }
    }

    $sender = Get-NotificationGraphSender -Config $config
    $subject = if ($Data.subject) { [string]$Data.subject } else { [string]$config.defaultSubject }
    if ($IsTest) { $subject = "[TESTE] $subject" }

    $html = New-MobileComplianceEmailBody -Data $Data -Config $config
    $html = Add-MobileDevicesSummaryToHtml -Html $html -Data $Data

    $message = @{
        Subject = $subject
        Body = @{
            ContentType = 'HTML'
            Content = $html
        }
        ToRecipients = @(
            @{
                EmailAddress = @{
                    Address = $recipient
                }
            }
        )
    }

    Send-MgUserMail -UserId $sender -Message $message -SaveToSentItems

    if (-not $IsTest) {
        $null = Register-NotificationLifecycle `
            -Device $Data `
            -SentBy $sender `
            -Transport 'MicrosoftGraph'
    }

    [pscustomobject]@{
        success = $true
        recipient = $recipient
        sender = $sender
        isTest = [bool]$IsTest
        sentAt = (Get-Date).ToString('s')
        message = 'E-mail enviado com sucesso.'
    }
}

function Invoke-MobileNotificationApi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Payload
    )

    try {
        $data = ConvertFrom-NotificationPayload -Payload $Payload
        $isTest = [bool]$data.isTest
        $result = Send-MobileComplianceNotification -Data $data -IsTest:$isTest
        return $result
    }
    catch {
        return [pscustomobject]@{
            success = $false
            message = $_.Exception.Message
        }
    }
}
# END INTUNE MOBILE NOTIFICATION API V1
