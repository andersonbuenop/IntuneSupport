param(
    $Query,
    $Config,
    [string]$Body = "",
    [string]$Method = "GET"
)

$ErrorActionPreference = "Stop"

function New-JsonResponse {
    param(
        [bool]$Success,
        [string]$Message,
        [object]$Data = $null
    )

    $obj = [ordered]@{
        success = $Success
        message = $Message
    }

    if ($null -ne $Data) {
        foreach ($p in $Data.PSObject.Properties) {
            $obj[$p.Name] = $p.Value
        }
    }

    $obj | ConvertTo-Json -Depth 60
}

function Get-QueryValue {
    param([string]$Name)

    if ($Request -and $Request.QueryString) {
        $Value = $Request.QueryString[$Name]
        if (![string]::IsNullOrWhiteSpace($Value)) {
            return $Value
        }
    }

    if ($Request -and $Request.Url -and $Request.Url.Query) {
        $QueryText = $Request.Url.Query.TrimStart("?")

        foreach ($Pair in ($QueryText -split "&")) {
            $Parts = $Pair -split "=", 2

            if ($Parts.Count -eq 2 -and $Parts[0] -eq $Name) {
                return [System.Uri]::UnescapeDataString($Parts[1])
            }
        }
    }

    return $null
}

function Get-RequestPayload {
    if ([string]::IsNullOrWhiteSpace($Body)) { return [pscustomobject]@{} }
    try { return ($Body | ConvertFrom-Json -ErrorAction Stop) }
    catch { throw "Body JSON inválido." }
}

function Get-PayloadValue {
    param($Payload, [string]$Name)
    if ($null -ne $Payload -and $null -ne $Payload.PSObject.Properties[$Name]) { return $Payload.$Name }
    return $null
}

function Assert-PostRequest {
    if ([string]$Method -ne "POST") { throw "Esta ação requer o método POST." }
}

function Get-GraphOperator {
    $ctx = Ensure-GraphIntuneConnection
    $account = ([string]$ctx.Account).Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($account)) { throw "Não foi possível identificar o operador autenticado no Microsoft Graph." }
    return $account
}

function Ensure-GraphIntuneModules {
    $modules = @(
        "Microsoft.Graph.Authentication",
        "Microsoft.Graph.DeviceManagement"
    )

    foreach ($m in $modules) {
        $found = Get-Module $m -ListAvailable |
            Sort-Object Version -Descending |
            Select-Object -First 1

        if (!$found) {
            throw "Módulo PowerShell não encontrado: $m"
        }

        Import-Module $m -ErrorAction Stop
    }
}

function Get-GraphIntuneRequiredScopes {
    return @(
        "DeviceManagementManagedDevices.ReadWrite.All",
        "DeviceManagementRBAC.Read.All",
        "DeviceManagementApps.Read.All",
        "User.Read.All"
    )
}

function Ensure-GraphIntuneConnection {
    param([switch]$AllowInteractive)

    Ensure-GraphIntuneModules

    $requiredScopes = @(Get-GraphIntuneRequiredScopes)

    $ctx = $null

    try {
        $ctx = Get-MgContext
    }
    catch {
        $ctx = $null
    }

    if ($ctx -and $ctx.Account) {
        $missingScopes = @($requiredScopes | Where-Object { $_ -notin @($ctx.Scopes) })
        $sessionExpired = (
            $Global:GraphSessionExpiresAt -and
            [DateTimeOffset]::Now -ge [DateTimeOffset]$Global:GraphSessionExpiresAt
        )
        if (!$missingScopes.Count -and -not $sessionExpired) { return $ctx }
    }

    if (!$AllowInteractive) {
        throw "A sessão Graph/Intune não está válida ou não possui todas as permissões necessárias. Clique em Conectar Graph/Intune."
    }

    if ($ctx) {
        Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
    }

    Connect-MgGraph `
        -Scopes $requiredScopes `
        -NoWelcome `
        -ErrorAction Stop | Out-Null

    $ctx = Get-MgContext

    if (!$ctx -or !$ctx.Account) {
        throw "Não foi possível ligar ao Microsoft Graph."
    }

    return $ctx
}

function Test-GraphIntuneConnection {
    try {
        Ensure-GraphIntuneModules

        $ctx = Get-MgContext

        $requiredScopes = @(Get-GraphIntuneRequiredScopes)
        $missingScopes = if ($ctx) { @($requiredScopes | Where-Object { $_ -notin @($ctx.Scopes) }) } else { @($requiredScopes) }
        $sessionExpired = (
            $Global:GraphSessionExpiresAt -and
            [DateTimeOffset]::Now -ge [DateTimeOffset]$Global:GraphSessionExpiresAt
        )

        if (!$ctx -or !$ctx.Account -or $missingScopes.Count -or $sessionExpired) {
            return [pscustomobject]@{
                connected = $false
                account   = ""
                tenantId  = ""
                scopes    = @()
                needConnect = $true
                expired = [bool]$sessionExpired
                missingScopes = @($missingScopes)
            }
        }

        return [pscustomobject]@{
            connected = $true
            account   = $ctx.Account
            tenantId  = $ctx.TenantId
            scopes    = @($ctx.Scopes)
        }
    }
    catch {
        return [pscustomobject]@{
            connected = $false
            account   = ""
            tenantId  = ""
            scopes    = @()
            error     = $_.Exception.Message
        }
    }
}


function Convert-GraphEnumToText {
    param($Value)

    if ($null -eq $Value) {
        return ""
    }

    try {
        $txt = [System.Enum]::GetName($Value.GetType(), $Value)
        if (![string]::IsNullOrWhiteSpace($txt)) {
            return $txt
        }
    }
    catch {}

    try {
        $txt = ($Value | Out-String).Trim()
        if (![string]::IsNullOrWhiteSpace($txt) -and $txt -ne "{}") {
            return $txt
        }
    }
    catch {}

    try {
        $txt = [string]$Value
        if (![string]::IsNullOrWhiteSpace($txt) -and $txt -ne "{}") {
            return $txt
        }
    }
    catch {}

    return ""
}


function Get-ApprovalStorePath {
    $moduleRoot = Join-Path $PSScriptRoot "data"

    if ($Config -and $Config.PSObject.Properties["devicesIntuneApprovalStorePath"]) {
        $configuredPath = [string]$Config.devicesIntuneApprovalStorePath
        if (![string]::IsNullOrWhiteSpace($configuredPath)) { return $configuredPath }
    }

    if (!(Test-Path $moduleRoot)) {
        New-Item `
            -ItemType Directory `
            -Force `
            -Path $moduleRoot | Out-Null
    }

    return (Join-Path $moduleRoot "approval-requests.json")
}

function Get-ApprovalStore {
    $path = Get-ApprovalStorePath

    if (!(Test-Path $path)) {
        @() | ConvertTo-Json -Depth 50 | Set-Content -Path $path -Encoding UTF8
    }

    $raw = Get-Content $path -Raw -Encoding UTF8

    if ([string]::IsNullOrWhiteSpace($raw)) {
        return @()
    }

    try {
        $data = $raw | ConvertFrom-Json
    }
    catch {
        return @()
    }

    if ($null -eq $data) {
        return @()
    }

    if ($data -is [array]) {
        return @($data)
    }

    return @($data)
}

function Save-ApprovalStore {
    param($Data)

    $path = Get-ApprovalStorePath
    $tempPath = "$path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        @($Data) | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath $tempPath -Encoding UTF8
        Move-Item -LiteralPath $tempPath -Destination $path -Force
    }
    finally {
        if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
    }
}

function Enter-ApprovalStoreLock {
    $mutex = [Threading.Mutex]::new($false, "Local\SantanderSupportWebV2-DevicesIntune-Approvals")
    if (!$mutex.WaitOne([TimeSpan]::FromSeconds(15))) {
        $mutex.Dispose()
        throw "O armazenamento de aprovações está ocupado. Tente novamente."
    }
    return $mutex
}

function Exit-ApprovalStoreLock {
    param($Mutex)
    if ($null -ne $Mutex) {
        try { $Mutex.ReleaseMutex() } catch {}
        $Mutex.Dispose()
    }
}

function Get-MaaAlertContactsPath {
    $dataRoot = Join-Path $PSScriptRoot "data"
    if (!(Test-Path -LiteralPath $dataRoot)) { New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null }
    return (Join-Path $dataRoot "maa-alert-contacts.json")
}

function Get-MaaAlertContacts {
    $path = Get-MaaAlertContactsPath
    if (!(Test-Path -LiteralPath $path)) { return @() }
    try {
        $data = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop
        return @($data)
    }
    catch { return @() }
}

function Save-MaaAlertContacts {
    param($Contacts)
    $path = Get-MaaAlertContactsPath
    $tempPath = "$path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        @($Contacts) | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $tempPath -Encoding UTF8
        Move-Item -LiteralPath $tempPath -Destination $path -Force
    }
    finally {
        if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue }
    }
}

function Get-MaaManualAlertsPath {
    $dataRoot = Split-Path (Get-MaaAlertContactsPath) -Parent
    return (Join-Path $dataRoot "maa-manual-system-alerts.json")
}

function Get-MaaManualAlerts {
    $path = Get-MaaManualAlertsPath
    if (!(Test-Path -LiteralPath $path)) { return @() }
    try { return @(Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json -ErrorAction Stop) }
    catch { return @() }
}

function Save-MaaManualAlerts {
    param($Alerts)
    $path = Get-MaaManualAlertsPath
    $tempPath = "$path.$([guid]::NewGuid().ToString('N')).tmp"
    try {
        @($Alerts) | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $tempPath -Encoding UTF8
        Move-Item -LiteralPath $tempPath -Destination $path -Force
    }
    finally { if (Test-Path -LiteralPath $tempPath) { Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue } }
}

function Enter-MaaManualAlertsLock {
    $mutex = [Threading.Mutex]::new($false, "Local\SantanderSupportWebV2-DevicesIntune-MaaManualAlerts")
    if (!$mutex.WaitOne([TimeSpan]::FromSeconds(15))) { $mutex.Dispose(); throw "A fila de alertas está ocupada. Tente novamente." }
    return $mutex
}

function Send-MaaAlertWithClassicOutlook {
    param(
        [Parameter(Mandatory)][string]$Subject,
        [Parameter(Mandatory)][string]$Text,
        [object[]]$Items = @()
    )

    $contacts = @(Get-MaaAlertContacts | Where-Object {
        [bool]$_.active -and [bool]$_.emailEnabled
    })
    $recipients = @($contacts | ForEach-Object {
        $address = if (![string]::IsNullOrWhiteSpace([string]$_.mail)) { [string]$_.mail } else { [string]$_.userPrincipalName }
        $address.Trim().ToLowerInvariant()
    } | Where-Object { $_ -match '^[^\s@]+@[^\s@]+\.[^\s@]+$' } | Sort-Object -Unique)

    if (!$recipients.Count) { throw "Não existem contactos ativos com envio por e-mail." }
    if ($recipients.Count -gt 50) { throw "O limite de destinatários por alerta é 50." }
    if ($Subject.Length -lt 5 -or $Subject.Length -gt 180 -or $Subject -match '[\r\n]') { throw "Assunto do alerta inválido." }
    if ($Text.Length -lt 20 -or $Text.Length -gt 20000 -or !$Text.StartsWith("Alerta Intune MAA")) { throw "Conteúdo do alerta inválido." }

    try { $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
    catch {
        try { $outlook = New-Object -ComObject Outlook.Application }
        catch { throw "Não foi possível utilizar o Outlook clássico. Confirme que está aberto e configurado na mesma sessão do Windows que executa a aplicação." }
    }

    $safeItems = @($Items | Select-Object -First 50)
    $cards = foreach ($item in $safeItems) {
        $kind = if ([string]$item.kind -eq "approval") { "APROVAÇÃO NECESSÁRIA" } else { "CONCLUSÃO NECESSÁRIA" }
        $user = [Net.WebUtility]::HtmlEncode(([string]$item.user).Trim())
        $requestId = [Net.WebUtility]::HtmlEncode(([string]$item.requestId).Trim())
        $status = [Net.WebUtility]::HtmlEncode(([string]$item.status).Trim())
        $date = [Net.WebUtility]::HtmlEncode(([string]$item.date).Trim())
        $justification = [Net.WebUtility]::HtmlEncode(([string]$item.justification).Trim())
        "<tr><td style='padding:0 28px 14px'><table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border:1px solid #e1e1e1;border-left:5px solid #ec0000;background:#fafafa'><tr><td style='padding:16px 18px;color:#333333'><div style='font-size:12px;font-weight:700;letter-spacing:.6px;color:#a80000'>$kind</div><div style='font-size:15px;font-weight:700;color:#222222;margin-top:6px'>$user</div><div style='font-size:13px;line-height:1.55;color:#3d3d3d;margin-top:8px'><strong>Pedido:</strong> $requestId<br><strong>Estado:</strong> $status<br><strong>Data:</strong> $date<br><strong>Justificação:</strong> $justification</div></td></tr></table></td></tr>"
    }
    if (!$cards.Count) {
        $fallback = [Net.WebUtility]::HtmlEncode($Text) -replace "(`r`n|`n|`r)", "<br>"
        $cards = @("<tr><td style='padding:0 28px 20px;font-size:14px;line-height:1.6;color:#3a3a3a'>$fallback</td></tr>")
    }
    $count = $safeItems.Count
    $mailHtml = "<!doctype html><html><body style='margin:0;padding:0;background:#f3f3f3;font-family:Segoe UI,Arial,sans-serif;color:#2d2d2d'><table role='presentation' width='100%' cellspacing='0' cellpadding='0' border='0' style='background:#f3f3f3'><tr><td align='center' style='padding:24px 12px'><table role='presentation' width='680' cellspacing='0' cellpadding='0' border='0' style='width:680px;max-width:100%;background:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,.10)'><tr><td style='background:#ec0000;padding:22px 28px;color:#ffffff'><table role='presentation' width='100%' cellspacing='0' cellpadding='0' border='0'><tr><td style='font-size:25px;font-weight:700;letter-spacing:1.2px;color:#ffffff'>SANTANDER</td><td align='right' style='font-size:12px;line-height:1.4;color:#ffffff'><strong>IT Santander Portugal</strong><br>Gestão de equipamentos</td></tr></table></td></tr><tr><td style='padding:30px 28px 18px;color:#2d2d2d'><div style='font-size:20px;font-weight:700;color:#222222;margin-bottom:14px'>Solicitação Intune MAA pendente</div><div style='font-size:15px;line-height:1.6;color:#3a3a3a'>Bom dia.</div><div style='font-size:15px;line-height:1.6;color:#3a3a3a;margin-top:10px'>Existe(m) <strong>$count solicitação(ões)</strong> que requer(em) aprovação ou conclusão. Aceda ao módulo <strong>Devices Intune</strong> para consultar os dados e executar a ação necessária.</div></td></tr><tr><td style='padding:0 28px 14px'><div style='background:#f7f7f7;border:1px solid #e1e1e1;padding:11px 14px;font-size:14px;font-weight:700;color:#333333'>Resumo das solicitações</div></td></tr>$($cards -join '')<tr><td style='padding:8px 28px 24px'><table role='presentation' width='100%' cellspacing='0' cellpadding='0' border='0' style='background:#fff4f4;border:1px solid #f2b8b8;border-left:6px solid #ec0000'><tr><td style='padding:16px 18px'><div style='font-size:13px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:#a80000;margin-bottom:6px'>Ação necessária</div><div style='font-size:14px;line-height:1.55;color:#333333'>Valide os dados do equipamento antes de aprovar ou concluir a remoção.</div></td></tr></table></td></tr><tr><td style='background:#f7f7f7;border-top:1px solid #e5e5e5;padding:16px 28px;font-size:11px;color:#777777'>Mensagem automática enviada pelo Santander Support Web V2.</td></tr></table></td></tr></table></body></html>"

    $mail = $outlook.CreateItem(0)
    $mail.To = ($recipients -join '; ')
    $mail.Subject = $Subject
    $mail.HTMLBody = $mailHtml
    if (!$mail.Recipients.ResolveAll()) { throw "O Outlook não conseguiu validar todos os destinatários." }
    $sender = ""
    try { $sender = [string]$outlook.Session.CurrentUser.Address }
    catch { $sender = [Environment]::UserName }
    $mail.Send()

    $auditPath = Join-Path (Split-Path (Get-MaaAlertContactsPath) -Parent) "maa-alert-send-audit.jsonl"
    [pscustomobject]@{
        sentAt = (Get-Date).ToString("o")
        channel = "OutlookClassic"
        sender = $sender
        recipients = $recipients
        subject = $Subject
        status = "sent"
    } | ConvertTo-Json -Compress | Add-Content -LiteralPath $auditPath -Encoding UTF8

    return [pscustomobject]@{ sender = $sender; recipients = $recipients; sentAt = (Get-Date).ToString("o") }
}


function Convert-ToAsciiHeader {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return ""
    }

    $normalized = $Text.Normalize([Text.NormalizationForm]::FormD)
    $chars = New-Object System.Collections.Generic.List[char]

    foreach ($ch in $normalized.ToCharArray()) {
        $cat = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch)

        if ($cat -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            if ([int][char]$ch -ge 32 -and [int][char]$ch -le 126) {
                $chars.Add($ch)
            }
        }
    }

    return (-join $chars).Trim()
}


function Convert-ToBase64Header {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        $Text = "Device removal request validated by support."
    }

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    return [System.Convert]::ToBase64String($bytes)
}

function Get-DiasSemSync {
    param($DateValue)

    if ($null -eq $DateValue -or [string]::IsNullOrWhiteSpace([string]$DateValue)) {
        return ""
    }

    try {
        return [int]((Get-Date) - ([datetime]$DateValue)).TotalDays
    }
    catch {
        return ""
    }
}

function Get-CachedManagedDevices {
    $now = Get-Date
    $cache = $Global:DevicesIntuneManagedDevicesCache
    if ($cache -and $cache.ExpiresAt -gt $now) { return @($cache.Devices) }

    $devices = @(Get-MgDeviceManagementManagedDevice -All -ErrorAction Stop)
    $Global:DevicesIntuneManagedDevicesCache = [pscustomobject]@{
        ExpiresAt = $now.AddMinutes(2)
        Devices = $devices
    }
    return $devices
}

function Resolve-MaaManagedDevice {
    param([Parameter(Mandatory)]$MaaRequest)

    $requestId = [string]$MaaRequest.id
    $requestDate = [datetimeoffset]$MaaRequest.requestDateTime
    $from = $requestDate.AddMinutes(-15).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ")
    $to = $requestDate.AddMinutes(15).UtcDateTime.ToString("yyyy-MM-ddTHH:mm:ssZ")
    $filter = [uri]::EscapeDataString("activityDateTime ge $from and activityDateTime le $to")
    $uri = "https://graph.microsoft.com/v1.0/deviceManagement/auditEvents?`$filter=$filter&`$top=200&`$orderby=activityDateTime desc"
    $response = Invoke-MgGraphRequest -Method GET -Uri $uri -ErrorAction Stop
    $requestorUpn = ([string]$MaaRequest.requestor.user.displayName).Trim().ToLowerInvariant()
    $requestorId = ([string]$MaaRequest.requestor.user.id).Trim()
    $candidates = New-Object System.Collections.Generic.List[object]

    foreach ($event in @($response.value)) {
        $actorUpn = ([string]$event.actor.userPrincipalName).Trim().ToLowerInvariant()
        $actorId = ([string]$event.actor.userId).Trim()
        if ($requestorId -and $actorId -and $actorId -ne $requestorId) { continue }
        if ($requestorUpn -match '@' -and $actorUpn -and $actorUpn -ne $requestorUpn) { continue }
        $eventText = "$($event.activity) $($event.displayName) $($event.activityType)".ToLowerInvariant()
        if ($eventText -notmatch 'device|managed|delete|remove|approval') { continue }
        foreach ($resource in @($event.resources)) {
            $ids = New-Object System.Collections.Generic.List[string]
            $resourceId = ([string]$resource.resourceId).Trim()
            if ($resourceId -match '^[0-9a-fA-F-]{36}$') { $ids.Add($resourceId) }
            foreach ($property in @($resource.modifiedProperties)) {
                if ([string]$property.displayName -match '(?i)device.*id|managed.*id|entity.*id') {
                    foreach ($match in [regex]::Matches("$($property.oldValue) $($property.newValue)", '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')) {
                        $ids.Add($match.Value)
                    }
                }
            }
            foreach ($id in @($ids | Where-Object { $_ -ne $requestId } | Select-Object -Unique)) {
                $candidates.Add([pscustomobject]@{
                    id = $id
                    name = [string]$resource.displayName
                    type = [string]$resource.auditResourceType
                    eventDate = $event.activityDateTime
                })
            }
        }
    }

    foreach ($candidate in @($candidates | Sort-Object eventDate -Descending)) {
        foreach ($entityType in @("managedDevice", "microsoft.graph.managedDevice", "ManagedDevice")) {
            try {
                $statusBody = @{ entityId = $candidate.id; entityType = $entityType } | ConvertTo-Json -Compress
                $status = Invoke-MgGraphRequest -Method POST -Uri "https://graph.microsoft.com/beta/deviceManagement/operationApprovalRequests/retrieveRequestStatus" -Body $statusBody -ContentType "application/json" -ErrorAction Stop
                $value = if ($status.PSObject.Properties["value"]) { $status.value } else { $status }
                if ([string]$value.requestId -eq $requestId) {
                    try {
                        return Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/$($candidate.id)?`$select=id,deviceName,userDisplayName,userPrincipalName,serialNumber,model,manufacturer,operatingSystem,osVersion,azureADDeviceId" -ErrorAction Stop
                    }
                    catch {
                        return [pscustomobject]@{ id = $candidate.id; deviceName = $candidate.name }
                    }
                }
            }
            catch { continue }
        }
    }

    $unique = @($candidates | Group-Object id | ForEach-Object { $_.Group | Select-Object -First 1 })
    if ($unique.Count -eq 1) {
        $candidate = $unique[0]
        try {
            return Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/$($candidate.id)?`$select=id,deviceName,userDisplayName,userPrincipalName,serialNumber,model,manufacturer,operatingSystem,osVersion,azureADDeviceId" -ErrorAction Stop
        }
        catch { return [pscustomobject]@{ id = $candidate.id; deviceName = $candidate.name } }
    }
    return $null
}

try {
    $action = Get-QueryValue "action"
    $query  = Get-QueryValue "query"

    if ([string]::IsNullOrWhiteSpace($action)) {
        New-JsonResponse `
            -Success $false `
            -Message "Action não informado. O router não enviou QueryString para o api.ps1."
        return
    }

    switch ($action) {

        "status" {
            $status = Test-GraphIntuneConnection

            New-JsonResponse `
                -Success $true `
                -Message "Status Graph/Intune consultado." `
                -Data ([pscustomobject]@{
                    graph = $status
                })
            return
        }

        "connect" {
            try {
                $ctx = Ensure-GraphIntuneConnection -AllowInteractive
                $Global:GraphSessionConnectedAt = [DateTimeOffset]::Now
                $Global:GraphSessionExpiresAt = $Global:GraphSessionConnectedAt.AddMinutes(55)

                $status = [pscustomobject]@{
                    connected = $true
                    account   = $ctx.Account
                    tenantId  = $ctx.TenantId
                    scopes    = @($ctx.Scopes)
                }

                New-JsonResponse `
                    -Success $true `
                    -Message "Graph/Intune conectado com sucesso." `
                    -Data ([pscustomobject]@{
                        graph = $status
                    })
                return
            }
            catch {
                New-JsonResponse `
                    -Success $false `
                    -Message ("Erro ao conectar Graph/Intune: " + $_.Exception.Message)
                return
            }
        }

        "search" {
            if ([string]::IsNullOrWhiteSpace($query)) {
                New-JsonResponse -Success $false -Message "Informe um valor para pesquisa."
                return
            }

            try {
                $ctx = Ensure-GraphIntuneConnection
            }
            catch {
                New-JsonResponse `
                    -Success $false `
                    -Message ("Graph/Intune não está conectado: " + $_.Exception.Message) `
                    -Data ([pscustomobject]@{
                        needConnect = $true
                    })
                return
            }

            $q = $query.Trim()

            $allDevices = Get-CachedManagedDevices

            $devices = $allDevices | Where-Object {
                ($_.UserDisplayName -like "*$q*") -or
                ($_.UserPrincipalName -like "*$q*") -or
                ($_.EmailAddress -like "*$q*") -or
                ($_.DeviceName -like "*$q*") -or
                ($_.SerialNumber -like "*$q*") -or
                ($_.Imei -like "*$q*") -or
                ($_.PhoneNumber -like "*$q*") -or
                ($_.AzureADDeviceId -like "*$q*") -or
                ($_.Id -like "*$q*") -or
                ($_.Model -like "*$q*") -or
                ($_.Manufacturer -like "*$q*")
            }

            if (!$devices) {
                New-JsonResponse `
                    -Success $false `
                    -Message "Nenhum dispositivo encontrado no Intune para: $q"
                return
            }

            $result = @()

            foreach ($d in $devices) {
                $result += [ordered]@{
                    id                      = $d.Id
                    deviceName              = $d.DeviceName
                    userDisplayName         = $d.UserDisplayName
                    userPrincipalName       = $d.UserPrincipalName
                    emailAddress            = $d.EmailAddress
                    operatingSystem         = $d.OperatingSystem
                    osVersion               = $d.OsVersion
                    complianceState = Convert-GraphEnumToText $d.ComplianceState
                    managementState = Convert-GraphEnumToText $d.ManagementState
                    ownerType = Convert-GraphEnumToText $d.OwnerType
                    enrollmentType = Convert-GraphEnumToText $d.DeviceEnrollmentType
                    enrolledDateTime        = $d.EnrolledDateTime
                    lastSyncDateTime        = $d.LastSyncDateTime
                    diasSemSync             = Get-DiasSemSync -DateValue $d.LastSyncDateTime
                    manufacturer            = $d.Manufacturer
                    model                   = $d.Model
                    serialNumber            = $d.SerialNumber
                    imei                    = $d.Imei
                    phoneNumber             = $d.PhoneNumber
                    wiFiMacAddress          = $d.WiFiMacAddress
                    azureADDeviceId         = $d.AzureADDeviceId
                    isEncrypted             = $d.IsEncrypted
                    isSupervised            = $d.IsSupervised
                    jailBroken              = $d.JailBroken
                    deviceRegistrationState = Convert-GraphEnumToText $d.DeviceRegistrationState
                    managedDeviceOwnerType = Convert-GraphEnumToText $d.ManagedDeviceOwnerType
                }
            }

            New-JsonResponse `
                -Success $true `
                -Message "Consulta concluída." `
                -Data ([pscustomobject]@{
                    query   = $q
                    total   = $result.Count
                    devices = $result
                })
            return
        }


        "createApprovalRequest" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $actionType = [string](Get-PayloadValue $payload "actionType")
            $justification = [string](Get-PayloadValue $payload "justification")
            $devices = @(Get-PayloadValue $payload "devices")

            if ([string]::IsNullOrWhiteSpace($actionType)) {
                $actionType = "Delete"
            }

            if ($actionType -ne "Delete") {
                New-JsonResponse -Success $false -Message "Tipo de ação não permitido."
                return
            }

            if ($justification.Trim().Length -lt 10 -or $justification.Length -gt 500) {
                New-JsonResponse -Success $false -Message "A justificação deve ter entre 10 e 500 caracteres."
                return
            }

            if ($devices.Count -lt 1 -or $devices.Count -gt 50) {
                New-JsonResponse -Success $false -Message "Informe entre 1 e 50 devices."
                return
            }

            foreach ($device in $devices) {
                $parsedId = [guid]::Empty
                if (![guid]::TryParse([string]$device.id, [ref]$parsedId)) {
                    New-JsonResponse -Success $false -Message "Foi recebido um Intune Device ID inválido."
                    return
                }
            }

            $operator = Get-GraphOperator
            $mutex = Enter-ApprovalStoreLock
            try {
                $store = Get-ApprovalStore
                $requestId = "REQ-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + ([guid]::NewGuid().ToString("N").Substring(0, 8))
                $request = [pscustomobject]@{
                id              = $requestId
                createdAt       = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                createdBy       = $operator
                actionType      = $actionType
                justification   = $justification
                status          = "Pendente"
                approvalsNeeded = 2
                approvalsCount  = 0
                approvals       = @()
                devicesCount    = @($devices).Count
                devices         = @($devices)
                executed        = $false
                executedAt      = ""
                executionResult = @()
                }

                $store = @($store) + $request
                Save-ApprovalStore -Data $store
            }
            finally {
                Exit-ApprovalStoreLock -Mutex $mutex
            }

            New-JsonResponse `
                -Success $true `
                -Message "Pedido de aprovação criado." `
                -Data ([pscustomobject]@{
                    request = $request
                })
            return
        }

        "listApprovalRequests" {
            $store = Get-ApprovalStore

            New-JsonResponse `
                -Success $true `
                -Message "Pedidos carregados." `
                -Data ([pscustomobject]@{
                    total = @($store).Count
                    requests = @($store | Sort-Object createdAt -Descending)
                })
            return
        }

        "listMaaRequestsByUsers" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $silent = [bool](Get-PayloadValue $payload "silent")
            $upns = @((Get-PayloadValue $payload "userPrincipalNames")) |
                ForEach-Object { ([string]$_).Trim().ToLowerInvariant() } |
                Where-Object { ![string]::IsNullOrWhiteSpace($_) } |
                Select-Object -Unique

            if ($upns.Count -lt 1 -or $upns.Count -gt 20) {
                New-JsonResponse -Success $false -Message "Informe entre 1 e 20 utilizadores."
                return
            }

            foreach ($upn in $upns) {
                if ($upn -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
                    New-JsonResponse -Success $false -Message "UPN inválido: $upn"
                    return
                }
            }

            if ($silent) {
                $connectionStatus = Test-GraphIntuneConnection
                $monitorSessionUnavailable = (
                    !$connectionStatus.connected -or
                    !$Global:GraphSessionExpiresAt -or
                    [DateTimeOffset]::Now.AddMinutes(2) -ge [DateTimeOffset]$Global:GraphSessionExpiresAt
                )
                if ($monitorSessionUnavailable) {
                    New-JsonResponse -Success $true -Message "Monitor MAA aguardando ligação Graph." -Data ([pscustomobject]@{
                        monitoringAvailable = $false
                        needConnect = $true
                        sessionExpired = [bool]$connectionStatus.connected
                        users = @()
                        totalPending = 0
                    })
                    return
                }
                # Uma verificacao automatica nunca deve abrir/renovar autenticacao WAM.
                # O contexto ja foi validado localmente e as chamadas Graph usam apenas
                # a janela segura registada pela conexao interativa.
                $ctx = Get-MgContext
            }
            else {
                try { $ctx = Ensure-GraphIntuneConnection }
                catch {
                    New-JsonResponse -Success $false -Message ("Graph/Intune não está conectado: " + $_.Exception.Message) -Data ([pscustomobject]@{ needConnect = $true })
                    return
                }
            }

            $resolvedUsers = @()
            foreach ($upn in $upns) {
                try {
                    $encodedUpn = [uri]::EscapeDataString($upn)
                    $user = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/users/$encodedUpn`?`$select=id,displayName,userPrincipalName" -ErrorAction Stop
                    $resolvedUsers += [pscustomobject]@{
                        requestedUpn = $upn
                        found = $true
                        id = [string]$user.id
                        displayName = [string]$user.displayName
                        userPrincipalName = [string]$user.userPrincipalName
                    }
                }
                catch {
                    $resolvedUsers += [pscustomobject]@{
                        requestedUpn = $upn
                        found = $false
                        id = ""
                        displayName = ""
                        userPrincipalName = $upn
                        error = $_.Exception.Message
                    }
                }
            }

            $allRequests = @()
            $nextLink = "https://graph.microsoft.com/beta/deviceManagement/operationApprovalRequests"
            while (![string]::IsNullOrWhiteSpace($nextLink)) {
                $response = Invoke-MgGraphRequest -Method GET -Uri $nextLink -ErrorAction Stop
                $allRequests += @($response.value)
                $nextLink = [string]$response.'@odata.nextLink'
            }

            $pendingStatuses = @("needsApproval", "approved")
            $results = foreach ($user in $resolvedUsers) {
                $matches = @()
                if ($user.found) {
                    $matches = @($allRequests | Where-Object {
                        ([string]$_.requestor.user.id -eq [string]$user.id) -and
                        ([string]$_.status -in $pendingStatuses)
                    } | ForEach-Object {
                        $targetDeviceId = @(
                            [string]$_.managedDeviceId,
                            [string]$_.deviceId,
                            [string]$_.entityId,
                            [string]$_.requestor.device.id
                        ) | Where-Object { ![string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1
                        $targetDeviceName = @(
                            [string]$_.deviceName,
                            [string]$_.targetDisplayName,
                            [string]$_.requestor.device.displayName
                        ) | Where-Object { ![string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1
                        [pscustomobject]@{
                            id = [string]$_.id
                            status = [string]$_.status
                            requestDateTime = $_.requestDateTime
                            expirationDateTime = $_.expirationDateTime
                            lastModifiedDateTime = $_.lastModifiedDateTime
                            requestJustification = [string]$_.requestJustification
                            approvalJustification = [string]$_.approvalJustification
                            policyTypes = @($_.requiredOperationApprovalPolicyTypes)
                            deviceId = [string]$targetDeviceId
                            deviceName = [string]$targetDeviceName
                        }
                    })
                }

                [pscustomobject]@{
                    requestedUpn = $user.requestedUpn
                    found = $user.found
                    displayName = $user.displayName
                    userPrincipalName = $user.userPrincipalName
                    pendingCount = $matches.Count
                    requests = $matches
                    error = if ($user.PSObject.Properties["error"]) { $user.error } else { "" }
                }
            }

            New-JsonResponse -Success $true -Message "Solicitações MAA consultadas no Intune." -Data ([pscustomobject]@{
                monitoringAvailable = $true
                currentOperator = ([string]$ctx.Account).Trim().ToLowerInvariant()
                checkedAt = (Get-Date).ToString("o")
                totalPending = @($results | ForEach-Object { $_.pendingCount } | Measure-Object -Sum).Sum
                users = @($results)
            })
            return
        }

        "getMaaAlertContacts" {
            New-JsonResponse -Success $true -Message "Contactos MAA carregados." -Data ([pscustomobject]@{
                contacts = @(Get-MaaAlertContacts)
            })
            return
        }

        "resolveMaaAlertContact" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $email = ([string](Get-PayloadValue $payload "email")).Trim().ToLowerInvariant()
            if ($email -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') {
                New-JsonResponse -Success $false -Message "E-mail/UPN inválido."
                return
            }
            try { [void](Ensure-GraphIntuneConnection) }
            catch {
                New-JsonResponse -Success $false -Message ("Graph não está conectado: " + $_.Exception.Message) -Data ([pscustomobject]@{ needConnect = $true })
                return
            }
            try {
                $encoded = [uri]::EscapeDataString($email)
                $user = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/users/$encoded`?`$select=id,displayName,userPrincipalName,mail,jobTitle,department,accountEnabled" -ErrorAction Stop
                New-JsonResponse -Success $true -Message "Utilizador encontrado no Entra ID." -Data ([pscustomobject]@{
                    contact = [pscustomobject]@{
                        id = [string]$user.id
                        displayName = [string]$user.displayName
                        userPrincipalName = [string]$user.userPrincipalName
                        mail = if ([string]::IsNullOrWhiteSpace([string]$user.mail)) { [string]$user.userPrincipalName } else { [string]$user.mail }
                        jobTitle = [string]$user.jobTitle
                        department = [string]$user.department
                        accountEnabled = [bool]$user.accountEnabled
                        emailEnabled = $true
                        teamsEnabled = $true
                        active = $true
                    }
                })
                return
            }
            catch {
                New-JsonResponse -Success $false -Message ("Utilizador não encontrado no Entra ID: " + $_.Exception.Message)
                return
            }
        }

        "saveMaaAlertContacts" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $contacts = @((Get-PayloadValue $payload "contacts"))
            if ($contacts.Count -gt 50) {
                New-JsonResponse -Success $false -Message "O limite é de 50 contactos."
                return
            }
            $clean = foreach ($contact in $contacts) {
                $upn = ([string]$contact.userPrincipalName).Trim().ToLowerInvariant()
                $mail = ([string]$contact.mail).Trim().ToLowerInvariant()
                if ($upn -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { continue }
                [pscustomobject]@{
                    id = [string]$contact.id
                    displayName = [string]$contact.displayName
                    userPrincipalName = $upn
                    mail = if ($mail -match '^[^\s@]+@[^\s@]+\.[^\s@]+$') { $mail } else { $upn }
                    jobTitle = [string]$contact.jobTitle
                    department = [string]$contact.department
                    accountEnabled = [bool]$contact.accountEnabled
                    emailEnabled = [bool]$contact.emailEnabled
                    teamsEnabled = [bool]$contact.teamsEnabled
                    active = [bool]$contact.active
                }
            }
            Save-MaaAlertContacts -Contacts @($clean | Sort-Object userPrincipalName -Unique)
            New-JsonResponse -Success $true -Message "Contactos MAA guardados." -Data ([pscustomobject]@{ contacts = @(Get-MaaAlertContacts) })
            return
        }

        "sendMaaOutlookAlert" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $subject = ([string](Get-PayloadValue $payload "subject")).Trim()
            $text = ([string](Get-PayloadValue $payload "text")).Trim()
            $items = @((Get-PayloadValue $payload "items"))
            try {
                $result = Send-MaaAlertWithClassicOutlook -Subject $subject -Text $text -Items $items
                New-JsonResponse -Success $true -Message "Alerta enviado automaticamente pelo Outlook clássico." -Data ([pscustomobject]@{
                    sender = $result.sender
                    recipients = @($result.recipients)
                    sentAt = $result.sentAt
                })
            }
            catch {
                New-JsonResponse -Success $false -Message ("Não foi possível enviar pelo Outlook clássico: " + $_.Exception.Message)
            }
            return
        }

        "createMaaManualSystemAlert" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $requestId = ([string](Get-PayloadValue $payload "requestId")).Trim()
            $targets = @((Get-PayloadValue $payload "targetUpns")) | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() } | Where-Object { $_ -match '^[^\s@]+@[^\s@]+\.[^\s@]+$' } | Select-Object -Unique
            $parsedRequestId = [guid]::Empty
            if (![guid]::TryParse($requestId, [ref]$parsedRequestId)) { New-JsonResponse -Success $false -Message "Pedido MAA inválido."; return }
            try {
                $operator = Get-GraphOperator
                $request = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/deviceManagement/operationApprovalRequests/$requestId" -ErrorAction Stop
                if ([string]$request.status -notin @("needsApproval", "approved")) { throw "O pedido já não está pendente. Estado: $($request.status)" }
                $requestorId = [string]$request.requestor.user.id
                $requestorUpn = ""
                if ($requestorId) {
                    try { $requestorUpn = ([string](Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/users/$requestorId`?`$select=userPrincipalName" -ErrorAction Stop).userPrincipalName).ToLowerInvariant() } catch {}
                }
                $targets = @($targets | Where-Object { $_ -ne $operator -and $_ -ne $requestorUpn })
                if (!$targets.Count) { throw "Não existe outro aprovador configurado para receber o alerta." }
                $mutex = Enter-MaaManualAlertsLock
                try {
                    $now = Get-Date
                    $alerts = @(Get-MaaManualAlerts | Where-Object { [datetime]$_.expiresAt -gt $now })
                    $alert = [pscustomobject]@{
                        id = [guid]::NewGuid().ToString()
                        requestId = $requestId
                        status = [string]$request.status
                        requestorUpn = $requestorUpn
                        justification = [string]$request.requestJustification
                        policyTypes = @($request.requiredOperationApprovalPolicyTypes)
                        sender = $operator
                        targetUpns = $targets
                        createdAt = $now.ToString("o")
                        expiresAt = $now.AddHours(24).ToString("o")
                        acknowledgedBy = @()
                    }
                    $alerts = @($alerts | Where-Object { !([string]$_.requestId -eq $requestId -and [string]$_.sender -eq $operator) }) + @($alert)
                    Save-MaaManualAlerts -Alerts $alerts
                }
                finally { Exit-ApprovalStoreLock -Mutex $mutex }
                New-JsonResponse -Success $true -Message "Notificação interna enviada ao outro aprovador." -Data ([pscustomobject]@{ alertId = $alert.id; targets = $targets })
            }
            catch { New-JsonResponse -Success $false -Message ("Não foi possível enviar a notificação interna: " + $_.Exception.Message) }
            return
        }

        "listMaaManualSystemAlerts" {
            Assert-PostRequest
            try {
                $connection = Test-GraphIntuneConnection
                if (!$connection.connected) {
                    New-JsonResponse -Success $true -Message "Monitor de alertas manuais aguardando ligação Graph." -Data ([pscustomobject]@{ alerts = @(); operator = "" })
                    return
                }
                $operator = ([string]$connection.account).Trim().ToLowerInvariant()
                $now = Get-Date
                $alerts = @(Get-MaaManualAlerts | Where-Object {
                    [datetime]$_.expiresAt -gt $now -and
                    $operator -in @($_.targetUpns) -and
                    $operator -notin @($_.acknowledgedBy)
                })
                New-JsonResponse -Success $true -Message "Alertas manuais consultados." -Data ([pscustomobject]@{ alerts = $alerts; operator = $operator })
            }
            catch { New-JsonResponse -Success $false -Message $_.Exception.Message }
            return
        }

        "ackMaaManualSystemAlert" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $alertId = ([string](Get-PayloadValue $payload "alertId")).Trim()
            try {
                $connection = Test-GraphIntuneConnection
                if (!$connection.connected) { throw "Graph/Intune não está conectado." }
                $operator = ([string]$connection.account).Trim().ToLowerInvariant()
                $mutex = Enter-MaaManualAlertsLock
                try {
                    $alerts = @(Get-MaaManualAlerts)
                    foreach ($alert in $alerts) {
                        if ([string]$alert.id -eq $alertId -and $operator -in @($alert.targetUpns)) {
                            $alert.acknowledgedBy = @(@($alert.acknowledgedBy) + $operator | Select-Object -Unique)
                        }
                    }
                    Save-MaaManualAlerts -Alerts $alerts
                }
                finally { Exit-ApprovalStoreLock -Mutex $mutex }
                New-JsonResponse -Success $true -Message "Alerta confirmado."
            }
            catch { New-JsonResponse -Success $false -Message $_.Exception.Message }
            return
        }

        "approveMaaRequest" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $requestId = ([string](Get-PayloadValue $payload "requestId")).Trim()
            $justification = ([string](Get-PayloadValue $payload "justification")).Trim()

            $parsedRequestId = [guid]::Empty
            if (![guid]::TryParse($requestId, [ref]$parsedRequestId)) {
                New-JsonResponse -Success $false -Message "ID da solicitação MAA inválido."
                return
            }

            if ($justification.Length -lt 10 -or $justification.Length -gt 1024) {
                New-JsonResponse -Success $false -Message "A justificação deve ter entre 10 e 1024 caracteres."
                return
            }

            try { [void](Ensure-GraphIntuneConnection) }
            catch {
                New-JsonResponse -Success $false -Message ("Graph/Intune não está conectado: " + $_.Exception.Message) -Data ([pscustomobject]@{ needConnect = $true })
                return
            }

            try {
                $requestUri = "https://graph.microsoft.com/beta/deviceManagement/operationApprovalRequests/$requestId"
                $maaRequest = Invoke-MgGraphRequest -Method GET -Uri $requestUri -ErrorAction Stop

                if ([string]$maaRequest.status -ne "needsApproval") {
                    New-JsonResponse -Success $false -Message "A solicitação já não está pendente de aprovação. Estado atual: $($maaRequest.status)"
                    return
                }

                $currentUser = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/me?`$select=id,displayName,userPrincipalName" -ErrorAction Stop
                if (![string]::IsNullOrWhiteSpace([string]$maaRequest.requestor.user.id) -and [string]$maaRequest.requestor.user.id -eq [string]$currentUser.id) {
                    New-JsonResponse -Success $false -Message "O solicitante não pode aprovar o próprio pedido MAA."
                    return
                }

                $approvalBody = @{
                    justification = $justification
                    approvalSource = "adminConsole"
                } | ConvertTo-Json -Compress

                $approveUri = "https://graph.microsoft.com/beta/deviceManagement/operationApprovalRequests/$requestId/approve"
                $graphResult = Invoke-MgGraphRequest -Method POST -Uri $approveUri -Body $approvalBody -ContentType "application/json" -ErrorAction Stop

                New-JsonResponse -Success $true -Message "Solicitação MAA aprovada no Intune." -Data ([pscustomobject]@{
                    requestId = $requestId
                    approvedBy = [string]$currentUser.userPrincipalName
                    graphResult = $graphResult
                })
                return
            }
            catch {
                New-JsonResponse -Success $false -Message ("Não foi possível aprovar a solicitação no Intune: " + $_.Exception.Message)
                return
            }
        }

        "resolveMaaRequestDevice" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $requestId = ([string](Get-PayloadValue $payload "requestId")).Trim()
            $parsedRequestId = [guid]::Empty
            if (![guid]::TryParse($requestId, [ref]$parsedRequestId)) {
                New-JsonResponse -Success $false -Message "ID da solicitação MAA inválido."
                return
            }
            try { [void](Ensure-GraphIntuneConnection) }
            catch {
                New-JsonResponse -Success $false -Message ("Graph/Intune não está conectado: " + $_.Exception.Message) -Data ([pscustomobject]@{ needConnect = $true })
                return
            }
            try {
                $requestUri = "https://graph.microsoft.com/beta/deviceManagement/operationApprovalRequests/$requestId"
                $maaRequest = Invoke-MgGraphRequest -Method GET -Uri $requestUri -ErrorAction Stop
                if ([string]$maaRequest.status -notin @("needsApproval", "approved")) {
                    throw "A solicitação não está pendente ou aprovada. Estado: $($maaRequest.status)"
                }
                $device = Resolve-MaaManagedDevice -MaaRequest $maaRequest
                if (!$device -or [string]::IsNullOrWhiteSpace([string]$device.id)) {
                    New-JsonResponse -Success $false -Message "Não foi possível relacionar automaticamente este pedido antigo com um único equipamento nos eventos de auditoria do Intune."
                    return
                }
                New-JsonResponse -Success $true -Message "Equipamento associado ao pedido MAA localizado." -Data ([pscustomobject]@{
                    device = [pscustomobject]@{
                        id = [string]$device.id
                        deviceName = [string]$device.deviceName
                        userDisplayName = [string]$device.userDisplayName
                        userPrincipalName = [string]$device.userPrincipalName
                        serialNumber = [string]$device.serialNumber
                        model = [string]$device.model
                        manufacturer = [string]$device.manufacturer
                        operatingSystem = [string]$device.operatingSystem
                        osVersion = [string]$device.osVersion
                        azureADDeviceId = [string]$device.azureADDeviceId
                    }
                })
            }
            catch {
                New-JsonResponse -Success $false -Message ("Falha ao localizar o equipamento do pedido MAA: " + $_.Exception.Message)
            }
            return
        }

        "completeMaaDelete" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $requestId = ([string](Get-PayloadValue $payload "requestId")).Trim()
            $deviceId = ([string](Get-PayloadValue $payload "deviceId")).Trim()
            $mode = ([string](Get-PayloadValue $payload "mode")).Trim().ToLowerInvariant()

            $parsedRequestId = [guid]::Empty
            $parsedDeviceId = [guid]::Empty
            if (![guid]::TryParse($requestId, [ref]$parsedRequestId)) {
                New-JsonResponse -Success $false -Message "ID da solicitação MAA inválido."
                return
            }
            if (![guid]::TryParse($deviceId, [ref]$parsedDeviceId)) {
                New-JsonResponse -Success $false -Message "Intune Device ID inválido."
                return
            }
            if ($mode -notin @("preview", "execute")) {
                New-JsonResponse -Success $false -Message "Modo de conclusão inválido."
                return
            }

            try { [void](Ensure-GraphIntuneConnection) }
            catch {
                New-JsonResponse -Success $false -Message ("Graph/Intune não está conectado: " + $_.Exception.Message) -Data ([pscustomobject]@{ needConnect = $true })
                return
            }

            try {
                $requestUri = "https://graph.microsoft.com/beta/deviceManagement/operationApprovalRequests/$requestId"
                $maaRequest = Invoke-MgGraphRequest -Method GET -Uri $requestUri -ErrorAction Stop
                if ([string]$maaRequest.status -ne "approved") {
                    New-JsonResponse -Success $false -Message "A solicitação não está pronta para conclusão. Estado atual: $($maaRequest.status)"
                    return
                }

                $currentUser = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/me?`$select=id,displayName,userPrincipalName" -ErrorAction Stop
                if ([string]::IsNullOrWhiteSpace([string]$maaRequest.requestor.user.id) -or [string]$maaRequest.requestor.user.id -ne [string]$currentUser.id) {
                    New-JsonResponse -Success $false -Message "A conclusão deve ser executada pela conta que criou a solicitação MAA."
                    return
                }

                $deviceUri = "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/$deviceId"
                $device = Invoke-MgGraphRequest -Method GET -Uri $deviceUri -ErrorAction Stop
                $deviceSummary = [pscustomobject]@{
                    id = [string]$device.id
                    deviceName = [string]$device.deviceName
                    userDisplayName = [string]$device.userDisplayName
                    userPrincipalName = [string]$device.userPrincipalName
                    serialNumber = [string]$device.serialNumber
                    operatingSystem = [string]$device.operatingSystem
                    model = [string]$device.model
                }

                if ($mode -eq "preview") {
                    New-JsonResponse -Success $true -Message "Device validado. Confirme para concluir a remoção." -Data ([pscustomobject]@{
                        requestId = $requestId
                        requestedBy = [string]$currentUser.userPrincipalName
                        device = $deviceSummary
                    })
                    return
                }

                Invoke-MgGraphRequest -Method DELETE -Uri $deviceUri -Headers @{
                    "x-msft-approval-code" = $requestId
                } -ErrorAction Stop | Out-Null

                Start-Sleep -Milliseconds 400
                $finalStatus = "completed"
                try {
                    $updatedRequest = Invoke-MgGraphRequest -Method GET -Uri $requestUri -ErrorAction Stop
                    $finalStatus = [string]$updatedRequest.status
                }
                catch {}

                New-JsonResponse -Success $true -Message "Remoção concluída através do fluxo MAA." -Data ([pscustomobject]@{
                    requestId = $requestId
                    completedBy = [string]$currentUser.userPrincipalName
                    status = $finalStatus
                    device = $deviceSummary
                })
                return
            }
            catch {
                New-JsonResponse -Success $false -Message ("Não foi possível concluir a remoção MAA: " + $_.Exception.Message)
                return
            }
        }

        "approveRequest" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $requestId = [string](Get-PayloadValue $payload "requestId")
            $decision = [string](Get-PayloadValue $payload "decision")
            $comment = [string](Get-PayloadValue $payload "comment")

            if ([string]::IsNullOrWhiteSpace($requestId)) {
                New-JsonResponse -Success $false -Message "requestId obrigatório."
                return
            }

            if ([string]::IsNullOrWhiteSpace($decision)) {
                $decision = "approve"
            }

            if ($decision -notin @("approve", "reject")) {
                New-JsonResponse -Success $false -Message "Decisão inválida."
                return
            }

            if ($comment.Length -gt 500) {
                New-JsonResponse -Success $false -Message "O comentário não pode exceder 500 caracteres."
                return
            }

            $operator = Get-GraphOperator
            $mutex = Enter-ApprovalStoreLock
            try {
                $store = Get-ApprovalStore
                $req = $store | Where-Object { $_.id -eq $requestId } | Select-Object -First 1
                if (!$req) { throw "Pedido não encontrado." }
                if ($req.status -in @("Rejeitado", "Aprovado")) { throw "Este pedido já está encerrado." }
                if (([string]$req.createdBy).ToLowerInvariant() -eq $operator) { throw "O criador do pedido não pode aprová-lo nem rejeitá-lo." }

                if ($decision -eq "reject") {
                $req.status = "Rejeitado"
                $req.approvals += [pscustomobject]@{
                    user     = $operator
                    decision = "Rejeitado"
                    date     = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                    comment  = $comment
                }
            }
                else {
                $already = @($req.approvals) | Where-Object {
                    $_.user -eq $operator -and $_.decision -eq "Aprovado"
                }

                if (!$already) {
                    $req.approvals += [pscustomobject]@{
                        user     = $operator
                        decision = "Aprovado"
                        date     = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                        comment  = $comment
                    }
                }

                $req.approvalsCount = @($req.approvals | Where-Object {
                    $_.decision -eq "Aprovado"
                }).Count

                if ($req.approvalsCount -ge 2) {
                    $req.status = "Aprovado"
                }
                else {
                    $req.status = "Aprovado $($req.approvalsCount)/2"
                }
            }

                Save-ApprovalStore -Data $store
            }
            finally {
                Exit-ApprovalStoreLock -Mutex $mutex
            }

            New-JsonResponse `
                -Success $true `
                -Message "Pedido atualizado." `
                -Data ([pscustomobject]@{
                    request = $req
                })
            return
        }


        "requestDeleteDevices" {
            Assert-PostRequest
            $payload = Get-RequestPayload
            $listaIds = @((Get-PayloadValue $payload "ids"))
            $justification = [string](Get-PayloadValue $payload "justification")

            if ($listaIds.Count -lt 1 -or $listaIds.Count -gt 50) {
                New-JsonResponse -Success $false -Message "Informe entre 1 e 50 devices."
                return
            }

            if ($justification.Trim().Length -lt 10 -or $justification.Length -gt 500) {
                New-JsonResponse -Success $false -Message "A justificação deve ter entre 10 e 500 caracteres."
                return
            }

            try {
                $ctx = Ensure-GraphIntuneConnection
            }
            catch {
                New-JsonResponse `
                    -Success $false `
                    -Message ("Graph/Intune não está conectado: " + $_.Exception.Message)
                return
            }

            $resultados = @()

            foreach ($deviceIdRaw in $listaIds) {
                $deviceId = ([string]$deviceIdRaw).Trim()
                $parsedDeviceId = [guid]::Empty
                if (![guid]::TryParse($deviceId, [ref]$parsedDeviceId)) {
                    $resultados += [pscustomobject]@{
                        id = $deviceId; success = $false; status = "Inválido"; message = "Intune Device ID inválido."
                    }
                    continue
                }

                try {
                    $uri = "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/$deviceId"

                    Invoke-MgGraphRequest `
                        -Method DELETE `
                        -Uri $uri `
                        -Headers @{
                            "x-msft-approval-justification" = (Convert-ToBase64Header $justification)
                        } `
                        -ErrorAction Stop | Out-Null

                    $resultados += [pscustomobject]@{
                        id      = $deviceId
                        success = $true
                        status  = "Solicitação enviada ao Intune"
                        message = "Pedido enviado. Se o MAA estiver ativo, ficará pendente de aprovação no Intune."
                    }
                }
                catch {
                    $msg = $_.Exception.Message
                    $status = "Erro"
                    $approvalCode = ""

                    if ($msg -match '(?i)x-msft-approval-code[:\s]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
                        $approvalCode = $Matches[1]
                    }

                    try {
                        $headerValues = $_.Exception.Response.Headers.GetValues("x-msft-approval-code")
                        if ($headerValues) { $approvalCode = [string](@($headerValues)[0]) }
                    }
                    catch {}

                    if ($msg -match "Conflict|409|pending|approval|aprovação|aprovacao") {
                        $status = "Pedido existente ou aguardando aprovação"
                    }

                    $resultados += [pscustomobject]@{
                        id      = $deviceId
                        success = $false
                        status  = $status
                        message = $msg
                        approvalCode = $approvalCode
                    }
                }
            }

            New-JsonResponse `
                -Success $true `
                -Message "Solicitação de remoção processada." `
                -Data ([pscustomobject]@{
                    total = @($resultados).Count
                    results = @($resultados)
                })
            return
        }

        default {
            New-JsonResponse -Success $false -Message "Action inválido: $action"
            return
        }
    }
}
catch {
    New-JsonResponse -Success $false -Message $_.Exception.Message
    return
}
