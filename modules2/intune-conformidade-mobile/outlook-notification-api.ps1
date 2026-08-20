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

# BEGIN OUTLOOK LOCAL NOTIFICATION API V4
. (Join-Path $PSScriptRoot 'notification-lifecycle-api.ps1')
Set-StrictMode -Version 2.0

function ConvertFrom-OutlookNotificationPayload {
    param([Parameter(Mandatory)][string]$Payload)

    try {
        $decoded = [System.Uri]::UnescapeDataString($Payload)
        return $decoded | ConvertFrom-Json
    }
    catch {
        throw "Payload inválido: $($_.Exception.Message)"
    }
}

function Get-OutlookNotificationConfig {
    $path = Join-Path $PSScriptRoot 'notification-config.json'

    if (-not (Test-Path -LiteralPath $path)) {
        throw "Configuração não encontrada: $path"
    }

    Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function ConvertTo-OutlookSafeHtml {
    param([AllowNull()][object]$Value)
    [System.Net.WebUtility]::HtmlEncode([string]$Value)
}

function Resolve-MobileNotificationDisplayName {
    param(
        [Parameter(Mandatory)]$Data
    )

    $candidate = [string]$Data.displayName

    if (-not [string]::IsNullOrWhiteSpace($candidate) -and
        $candidate -notmatch '@') {
        return $candidate.Trim()
    }

    $upn = [string]$Data.email

    if (-not [string]::IsNullOrWhiteSpace($upn) -and
        (Get-Command Get-MgUser -ErrorAction SilentlyContinue)) {
        try {
            $user = Get-MgUser -UserId $upn -Property DisplayName -ErrorAction Stop
            if ($user.DisplayName) {
                return [string]$user.DisplayName
            }
        }
        catch {
            # Segue para fallback sem interromper a preparação do e-mail.
        }
    }

    if ($Data.PSObject.Properties['userDisplayName'] -and
        $Data.userDisplayName) {
        return [string]$Data.userDisplayName
    }

    if (-not [string]::IsNullOrWhiteSpace($upn)) {
        $local = ($upn -split '@')[0]
        if ($local -notmatch '^[SET]\d+$') {
            return ($local -replace '[._-]+', ' ')
        }
    }

    return 'Utilizador'
}

function Convert-ComplianceStateLabel {
    param([AllowNull()][object]$Value)

    switch -Regex ([string]$Value) {
        '^(?i)inGracePeriod$' { return 'Em período de carência' }
        '^(?i)noncompliant$'  { return 'Não conforme' }
        '^(?i)compliant$'     { return 'Conforme' }
        default {
            if ([string]::IsNullOrWhiteSpace([string]$Value)) {
                return 'Não identificado'
            }
            return [string]$Value
        }
    }
}

function Convert-OperatingSystemLabel {
    param([AllowNull()][object]$Value)

    if ([string]::IsNullOrWhiteSpace([string]$Value)) {
        return 'Não identificado'
    }

    return [string]$Value
}

function New-ActionStepsHtml {
    param([AllowNull()][object]$Instructions)

    $text = [string]$Instructions

    if ([string]::IsNullOrWhiteSpace($text)) {
        $steps = @(
            'Abra a aplicação Harmony Mobile no telemóvel.',
            'Confirme que a aplicação está ativa, protegida e sem alertas pendentes.',
            'Valide todas as permissões solicitadas pelo Harmony.',
            'Mantenha o telemóvel ligado à Internet durante alguns minutos.',
            'Abra o Portal da Empresa e execute uma sincronização do equipamento.',
            'Reinicie o telemóvel e repita a sincronização caso o estado não seja atualizado.'
        )
    }
    else {
        $steps = $text -split "(`r`n|`n|`r)|(?<=\.)\s+" |
            Where-Object {
                -not [string]::IsNullOrWhiteSpace($_) -and
                $_ -notmatch '^(`r`n|`n|`r)$'
            } |
            ForEach-Object {
                ($_ -replace '^\s*\d+[\.\)]\s*', '').Trim()
            }
    }

    $items = foreach ($step in $steps) {
        if ([string]::IsNullOrWhiteSpace($step)) { continue }
        '<li style="margin:0 0 9px 0;padding-left:4px;">' +
        (ConvertTo-OutlookSafeHtml $step) +
        '</li>'
    }

    '<ol style="margin:10px 0 0 22px;padding:0;line-height:1.55;">' +
    ($items -join '') +
    '</ol>'
}

function Get-NotificationDeadlineDisplay {
    param(
        [Parameter(Mandatory)]$Data,
        [Parameter(Mandatory)]$Config
    )

    $urgentHours = [int](Get-NotificationValueV1202 `
        -Object $Data `
        -Name 'urgentDeadlineHours' `
        -Default 0)

    $defaultHours = if ($urgentHours -gt 0 -and $urgentHours -le 24) {
        $urgentHours
    }
    elseif (
        $Config.PSObject.Properties['notificationGraceHours']
    ) {
        [int]$Config.notificationGraceHours
    }
    else {
        24
    }

    $requestedType = Get-RequestedLifecycleType -Device $Data

    $result = [pscustomobject]@{
        lifecycleType = $requestedType
        isReminder = $false
        deadlineAt = $null
        title = if ($requestedType -eq 'Preventive30d') {
            'Prazo preventivo'
        }
        else {
            "$defaultHours horas"
        }
        description = if ($requestedType -eq 'Preventive30d') {
            'Prazo calculado a partir da última sincronização do equipamento com o Intune.'
        }
        else {
            'Prazo contado a partir do envio da primeira notificação.'
        }
    }

    try {
        $lifecycle = Read-NotificationLifecycle
        $key = Get-LifecycleDeviceKey -Device $Data

        $existing = @($lifecycle.items) |
            Where-Object {
                $itemType = [string](
                    Get-LifecycleValueSafe `
                        -Object $_ `
                        -Name 'lifecycleType' `
                        -Default 'Grace24h'
                )

                [string]$_.deviceKey -eq [string]$key -and
                $itemType -eq $requestedType
            } |
            Select-Object -First 1

        $deadline = $null

        if ($existing) {
            $deadline = ConvertTo-LifecycleDateSafe (
                Get-LifecycleValueSafe `
                    -Object $existing `
                    -Name 'deadlineAt'
            )
        }

        if (-not $deadline -and
            $requestedType -eq 'Preventive30d') {
            $deadline = ConvertTo-LifecycleDateSafe (
                Get-LifecycleValueSafe `
                    -Object $Data `
                    -Name 'preventiveDeadlineAt'
            )

            if (-not $deadline) {
                $lastSync = ConvertTo-LifecycleDateSafe (
                    Get-LifecycleValueSafe `
                        -Object $Data `
                        -Name 'lastSyncDateTime'
                )

                if ($lastSync) {
                    $removalDays = 30

                    if (Get-Command Get-PreventiveConfigV12 -ErrorAction SilentlyContinue) {
                        try {
                            $preventiveConfig = Get-PreventiveConfigV12
                            $removalDays = [int]$preventiveConfig.removalDays
                        }
                        catch {}
                    }

                    $deadline = $lastSync.AddDays($removalDays)
                }
            }
        }

        if (-not $deadline) {
            return $result
        }

        $now = Get-Date
        $remaining = $deadline - $now

        $result.isReminder = [bool]$existing
        $result.deadlineAt = $deadline.ToString('o')

        if ($remaining.TotalMinutes -le 0) {
            $result.title = 'Prazo expirado'
            $result.description =
                "O prazo terminou em $($deadline.ToString('dd/MM/yyyy HH:mm'))."
            return $result
        }

        if ($requestedType -eq 'Preventive30d') {
            $days = [math]::Max(
                1,
                [math]::Ceiling($remaining.TotalDays)
            )

            $result.title = if ($days -eq 1) {
                '1 dia restante'
            }
            else {
                "$days dias restantes"
            }

            $result.description =
                "Data limite preventiva: $($deadline.ToString('dd/MM/yyyy HH:mm')). " +
                'A contagem utiliza a última comunicação registada pelo Intune.'

            return $result
        }

        $totalMinutes = [math]::Ceiling($remaining.TotalMinutes)
        $hours = [math]::Floor($totalMinutes / 60)
        $minutes = $totalMinutes % 60

        if ($hours -gt 0 -and $minutes -gt 0) {
            $result.title = "${hours}h ${minutes}m restantes"
        }
        elseif ($hours -gt 0) {
            $result.title = "${hours} horas restantes"
        }
        else {
            $result.title = "${minutes} minutos restantes"
        }

        $result.description =
            "Prazo original: $($deadline.ToString('dd/MM/yyyy HH:mm')). " +
            'Esta mensagem é um lembrete e não reinicia a contagem.'

        return $result
    }
    catch {
        return $result
    }
}
function New-OutlookMobileNotificationHtml {
    param(
        [Parameter(Mandatory)]$Data,
        [Parameter(Mandatory)]$Config,
        [switch]$UseEmbeddedLogo
    )

    $displayName = Resolve-MobileNotificationDisplayName -Data $Data
    $isAbsence = [bool](Get-NotificationValueV1202 -Object $Data -Name 'absenceActive' -Default $false)
    $isHarmonyIncomplete = [bool](Get-NotificationValueV1202 -Object $Data -Name 'harmonyIncomplete' -Default $false)
    $deviceName = if ($Data.deviceName) { [string]$Data.deviceName } else { 'Não identificado' }
    $operatingSystem = Convert-OperatingSystemLabel $Data.operatingSystem
    if ($Data.PSObject.Properties['osVersion'] -and $Data.osVersion) {
        $operatingSystem = "$operatingSystem $([string]$Data.osVersion)"
    }

    $intuneValue = if ($Data.complianceState) {
        $Data.complianceState
    }
    elseif ($Data.intuneStatus) {
        $Data.intuneStatus
    }
    else {
        $null
    }

    $intuneStatus = Convert-ComplianceStateLabel $intuneValue
    $risk = if ($Data.risk) { [string]$Data.risk } else { 'Ação necessária' }

    $problem = if ((Get-NotificationValueV1202 -Object $Data -Name 'problemDescription' -Default '')) {
        [string](Get-NotificationValueV1202 -Object $Data -Name 'problemDescription' -Default '')
    }
    elseif ($Data.harmonyStatus) {
        [string]$Data.harmonyStatus
    }
    else {
        'Foi identificada uma pendência na configuração de segurança do equipamento.'
    }

    $safeDisplayName = ConvertTo-OutlookSafeHtml $displayName
    $safeEmail = ConvertTo-OutlookSafeHtml $Data.email
    $safeDeviceName = ConvertTo-OutlookSafeHtml $deviceName
    $managedDeviceId = if ($Data.PSObject.Properties['managedDeviceId'] -and $Data.managedDeviceId) { [string]$Data.managedDeviceId } else { 'Não disponível' }
    $azureADDeviceId = if ($Data.PSObject.Properties['azureADDeviceId'] -and $Data.azureADDeviceId) { [string]$Data.azureADDeviceId } else { 'Não disponível' }
    $serialNumber = if ($Data.PSObject.Properties['serialNumber'] -and $Data.serialNumber -and [string]$Data.serialNumber -ne '0') { [string]$Data.serialNumber } else { 'Não disponível' }
    $model = if ($Data.PSObject.Properties['model'] -and $Data.model) { [string]$Data.model } else { 'Não identificado' }
    $safeManagedDeviceId = ConvertTo-OutlookSafeHtml $managedDeviceId
    $safeAzureADDeviceId = ConvertTo-OutlookSafeHtml $azureADDeviceId
    $safeSerialNumber = ConvertTo-OutlookSafeHtml $serialNumber
    $safeModel = ConvertTo-OutlookSafeHtml $model
    $safeOperatingSystem = ConvertTo-OutlookSafeHtml $operatingSystem
    $safeIntuneStatus = ConvertTo-OutlookSafeHtml $intuneStatus
    $safeRisk = ConvertTo-OutlookSafeHtml $risk
    $safeProblem = ConvertTo-OutlookSafeHtml $problem
    $safeSignature = ConvertTo-OutlookSafeHtml $Config.signature

    $deadlineDisplay = Get-NotificationDeadlineDisplay -Data $Data -Config $Config
    if ($isAbsence) {
        $absenceEndText = [string](Get-NotificationValueV1202 -Object $Data -Name 'absenceEndAt' -Default '')
        $deadlineDisplay.title = 'Prazo suspenso'
        $deadlineDisplay.description = if ($absenceEndText) { "Ausência/Férias ativa. A contagem será retomada após $absenceEndText." } else { 'Ausência/Férias ativa. A contagem será retomada após confirmação do regresso.' }
    }
    $safeDeadlineTitle = ConvertTo-OutlookSafeHtml $deadlineDisplay.title
    $safeDeadlineDescription = ConvertTo-OutlookSafeHtml $deadlineDisplay.description
    $emailHeading = if ($isHarmonyIncomplete -and -not $isAbsence) {
        'Urgente — conclua a configuração do Harmony Mobile'
    }
    else {
        'Ação necessária no seu equipamento móvel'
    }
    $safeEmailHeading = ConvertTo-OutlookSafeHtml $emailHeading

    $graceHours = if ($Config.PSObject.Properties['notificationGraceHours']) {
        [int]$Config.notificationGraceHours
    }
    else {
        24
    }

    $safeGraceHours = ConvertTo-OutlookSafeHtml $graceHours
    $effectiveInstructions = if ($isAbsence) { "Identificámos que se encontra atualmente em período de Ausência/Férias.`nQuando regressar, por favor, ligue o equipamento à Internet e proceda à respetiva atualização e sincronização.`nO prazo de regularização está suspenso durante a ausência e será retomado após o regresso." } else { [string]$Data.instructions }
    $stepsHtml = New-ActionStepsHtml -Instructions $effectiveInstructions
    $introText = if ($isAbsence) {
        'Identificámos uma pendência no equipamento e verificámos que se encontra em período de Ausência/Férias. A regularização deverá ser efetuada após o regresso.'
    }
    elseif ($isHarmonyIncomplete) {
        'Identificámos que a configuração obrigatória do Harmony Mobile não foi concluída no seu equipamento. Esta regularização é urgente e necessária para manter o equipamento registado na plataforma.'
    }
    else {
        'Identificámos uma pendência de segurança no seu equipamento móvel corporativo. Para evitar impacto no acesso aos serviços Santander, pedimos que siga as instruções abaixo.'
    }
    $consequenceText = if ($isAbsence) {
        'Durante o período de Ausência/Férias não será efetuada a contagem para remoção. O prazo será retomado após o regresso.'
    }
    elseif ($isHarmonyIncomplete) {
        'O Harmony Mobile é obrigatório. Caso a configuração não seja concluída no prazo de 2 horas contado a partir da primeira notificação, o equipamento será removido da plataforma de gestão de equipamentos móveis do Santander.'
    }
    else {
        'Caso o equipamento não seja regularizado até ao prazo indicado acima, o equipamento poderá ser removido da plataforma de gestão de equipamentos móveis do Santander.'
    }
    $serviceNowUrl = if ($Config.PSObject.Properties['serviceNowUrl']) { [string]$Config.serviceNowUrl } else { '' }
    $safeServiceNowUrl = ConvertTo-OutlookSafeHtml $serviceNowUrl

    $logoHtml = if ($UseEmbeddedLogo) {
        '<img src="cid:' + [string]$Config.logoContentId + '" alt="Santander" style="display:block;max-width:190px;height:auto;border:0;">'
    }
    else {
        '<div style="font-family:Arial,Segoe UI,sans-serif;font-size:25px;font-weight:700;letter-spacing:1.2px;color:#ffffff;">SANTANDER</div>'
    }

    $devicesBlock = ''
    if ($Data.PSObject.Properties['devicesSummary'] -and $Data.devicesSummary) {
        $summary = ConvertTo-OutlookSafeHtml ([string]$Data.devicesSummary)
        $summary = $summary -replace "(`r`n|`n|`r)", '<br>'

        $devicesBlock = @"
<tr>
<td style="padding:0 28px 20px 28px;">
  <div style="border:1px solid #E2E2E2;border-radius:6px;background:#FAFAFA;padding:16px;">
    <div style="font-size:14px;font-weight:700;color:#333333;margin-bottom:8px;">Equipamentos abrangidos</div>
    <div style="font-size:13px;line-height:1.55;color:#4A4A4A;">$summary</div>
  </div>
</td>
</tr>
"@
    }

    $absenceBlock = ''
    if ([bool](Get-NotificationValueV1202 -Object $Data -Name 'absenceActive' -Default $false)) {
        $absenceEnd = [string](Get-NotificationValueV1202 -Object $Data -Name 'absenceEndAt' -Default '')
        $safeAbsenceEnd = ConvertTo-OutlookSafeHtml $(if ($absenceEnd) { $absenceEnd } else { 'Sem data de regresso definida' })
        $absenceBlock = @"
<tr><td style="padding:0 28px 20px 28px;"><div style="background:#FFF8E1;border:1px solid #F0C36D;border-left:6px solid #D99000;padding:16px 18px;"><div style="font-weight:700;color:#7A4D00;margin-bottom:6px;">Ausência/Férias</div><div style="font-size:14px;line-height:1.55;color:#3D3D3D;">Identificámos uma ausência ativa. Quando regressar, por favor, proceda à atualização e sincronização do equipamento. O prazo fica suspenso durante a ausência e será retomado após o regresso.<br><strong>Regresso previsto:</strong> $safeAbsenceEnd</div></div></td></tr>
"@
    }

    return @"
<!doctype html>
<html>
<head>
<meta charset="utf-8">
</head>
<body style="margin:0;padding:0;background:#F3F3F3;font-family:Segoe UI,Arial,sans-serif;color:#2D2D2D;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#F3F3F3;">
<tr>
<td align="center" style="padding:24px 12px;">
<table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="width:680px;max-width:100%;background:#FFFFFF;border-collapse:separate;border-spacing:0;box-shadow:0 2px 8px rgba(0,0,0,0.10);">

<tr>
<td style="background:#EC0000;padding:22px 28px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr>
<td align="left" valign="middle">$logoHtml</td>
<td align="right" valign="middle" style="font-size:12px;color:#FFFFFF;line-height:1.4;">
<strong>IT Santander Portugal</strong><br>
Segurança de equipamentos móveis
</td>
</tr>
</table>
</td>
</tr>

<tr>
<td style="padding:30px 28px 18px 28px;">
  <div style="font-size:20px;font-weight:700;color:#222222;margin-bottom:14px;">$safeEmailHeading</div>
  <div style="font-size:15px;line-height:1.6;color:#3A3A3A;">
    Bom dia, <strong>$safeDisplayName</strong>.
  </div>
  <div style="font-size:15px;line-height:1.6;color:#3A3A3A;margin-top:10px;">
    $introText
  </div>
</td>
</tr>

<!-- BEGIN REGULARIZATION DEADLINE WARNING V10 -->
<tr>
<td style="padding:0 28px 20px 28px;">
  <table role="presentation"
         width="100%"
         cellspacing="0"
         cellpadding="0"
         border="0"
         style="background:#F7F7F7;border:1px solid #E1E1E1;border-collapse:separate;">
    <tr>
      <td style="padding:14px 16px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.7px;font-weight:700;color:#555555;">
          Prazo para regularização
        </div>
        <div style="font-size:24px;font-weight:700;color:#EC0000;margin-top:4px;">
          $safeDeadlineTitle
        </div>
        <div style="font-size:12px;line-height:1.5;color:#666666;margin-top:3px;">
          $safeDeadlineDescription
        </div>
      </td>
    </tr>
  </table>
</td>
</tr>
<!-- END REGULARIZATION DEADLINE WARNING V10 -->
<tr>
<td style="padding:0 28px 20px 28px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #E1E1E1;border-collapse:collapse;">
    <tr>
      <td colspan="2" style="background:#F7F7F7;padding:11px 14px;font-size:14px;font-weight:700;color:#333333;">Resumo do equipamento</td>
    </tr>
    <tr>
      <td width="185" style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;font-weight:700;color:#555555;">Utilizador</td>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;color:#333333;">$safeDisplayName</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;font-weight:700;color:#555555;">Conta</td>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;color:#333333;">$safeEmail</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;font-weight:700;color:#555555;">Equipamento</td>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;color:#333333;">$safeDeviceName</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;font-weight:700;color:#555555;">Modelo</td>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;color:#333333;">$safeModel</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;font-weight:700;color:#555555;">Managed Device ID</td>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:12px;color:#333333;font-family:Consolas,monospace;">$safeManagedDeviceId</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;font-weight:700;color:#555555;">Azure AD Device ID</td>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:12px;color:#333333;font-family:Consolas,monospace;">$safeAzureADDeviceId</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;font-weight:700;color:#555555;">Número de série</td>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;color:#333333;">$safeSerialNumber</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;font-weight:700;color:#555555;">Sistema operativo</td>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;color:#333333;">$safeOperatingSystem</td>
    </tr>
    <tr>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;font-weight:700;color:#555555;">Estado no Intune</td>
      <td style="padding:10px 14px;border-top:1px solid #E9E9E9;font-size:13px;color:#333333;">$safeIntuneStatus</td>
    </tr>
  </table>
</td>
</tr>

<tr>
<td style="padding:0 28px 20px 28px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFF4F4;border-left:5px solid #EC0000;">
    <tr>
      <td style="padding:16px 18px;">
        <div style="font-size:12px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:#A80000;margin-bottom:6px;">$safeRisk</div>
        <div style="font-size:14px;font-weight:700;color:#333333;margin-bottom:6px;">Situação identificada</div>
        <div style="font-size:14px;line-height:1.55;color:#3D3D3D;">$safeProblem</div>
      </td>
    </tr>
  </table>
</td>
</tr>

$devicesBlock
$absenceBlock

<tr>
<td style="padding:0 28px 22px 28px;">
  <div style="font-size:16px;font-weight:700;color:#222222;margin-bottom:8px;">O que deve fazer</div>
  <div style="font-size:14px;line-height:1.55;color:#3D3D3D;">
    $stepsHtml
  </div>
</td>
</tr>

<!-- BEGIN REGULARIZATION CONSEQUENCE WARNING V10 -->
<tr>
<td style="padding:0 28px 22px 28px;">
  <table role="presentation"
         width="100%"
         cellspacing="0"
         cellpadding="0"
         border="0"
         style="background:#FFF4F4;border:1px solid #F2B8B8;border-left:6px solid #EC0000;">
    <tr>
      <td style="padding:18px 19px;">
        <div style="font-size:13px;text-transform:uppercase;letter-spacing:.7px;font-weight:700;color:#A80000;margin-bottom:7px;">
          Importante — prazo de $safeDeadlineTitle
        </div>

        <div style="font-size:14px;line-height:1.58;color:#333333;">
          $consequenceText
        </div>

        <div style="font-size:14px;line-height:1.58;color:#333333;margin-top:11px;">
          Como consequência, poderá perder o acesso às ferramentas e aos
          serviços corporativos disponibilizados no telemóvel, incluindo,
          entre outros:
        </div>

        <ul style="margin:10px 0 0 20px;padding:0;font-size:14px;line-height:1.58;color:#333333;">
          <li style="margin-bottom:5px;">E-mail corporativo;</li>
          <li style="margin-bottom:5px;">Microsoft Teams;</li>
          <li style="margin-bottom:5px;">Aplicações corporativas;</li>
          <li style="margin-bottom:5px;">Company Portal;</li>
          <li style="margin-bottom:5px;">Outros serviços Santander configurados no equipamento.</li>
        </ul>

        <div style="font-size:14px;line-height:1.58;color:#333333;margin-top:11px;">
          Após a remoção, poderá ser necessária uma nova configuração do
          equipamento para restabelecer os acessos.
        </div>
      </td>
    </tr>
  </table>
</td>
</tr>
<!-- END REGULARIZATION CONSEQUENCE WARNING V10 -->
<tr>
<td style="padding:0 28px 26px 28px;">
  <div style="background:#F7F7F7;border-radius:6px;padding:16px 18px;font-size:13px;line-height:1.55;color:#4A4A4A;">
    Após concluir estes passos, aguarde alguns minutos para a atualização dos sistemas.
  </div>

  <div style="margin-top:18px;border:1px solid #E2E2E2;border-radius:6px;padding:18px;background:#FFFFFF;">
    <div style="font-size:15px;font-weight:700;color:#222222;margin-bottom:7px;">Precisa de ajuda?</div>
    <div style="font-size:13px;line-height:1.55;color:#4A4A4A;margin-bottom:14px;">
      Em caso de dúvidas, dificuldade na configuração ou se o estado não for atualizado,
      abra um pedido no ServiceNow para validação pela equipa responsável.
    </div>
    <div style="margin-top:16px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
                   xmlns:w="urn:schemas-microsoft-com:office:word"
                   href="$safeServiceNowUrl"
                   style="height:44px;v-text-anchor:middle;width:245px;"
                   arcsize="10%"
                   stroke="f"
                   fillcolor="#EC0000">
        <w:anchorlock/>
        <center style="color:#FFFFFF;font-family:Segoe UI,Arial,sans-serif;font-size:14px;font-weight:bold;">
          Abrir pedido no ServiceNow
        </center>
      </v:roundrect>
      <![endif]-->

      <!--[if !mso]><!-- -->
      <a href="$safeServiceNowUrl"
         target="_blank"
         style="background:#EC0000;border:1px solid #EC0000;border-radius:5px;color:#FFFFFF;display:inline-block;font-family:Segoe UI,Arial,sans-serif;font-size:14px;font-weight:700;line-height:44px;text-align:center;text-decoration:none;width:245px;-webkit-text-size-adjust:none;">
        Abrir pedido no ServiceNow
      </a>
      <!--<![endif]-->
    </div>

    <div style="font-size:11px;line-height:1.45;color:#777777;margin-top:12px;">
      Caso o botão não abra, utilize o
      <a href="$safeServiceNowUrl"
         target="_blank"
         style="color:#555555;font-weight:600;text-decoration:underline;">
        link alternativo do ServiceNow
      </a>.
    </div>
  </div>
</td>
</tr>

<tr>
<td style="padding:20px 28px;background:#F2F2F2;border-top:1px solid #E1E1E1;">
  <div style="font-size:13px;line-height:1.5;color:#555555;">
    Obrigado,<br>
    <strong>$safeSignature</strong>
  </div>
  <div style="font-size:11px;line-height:1.45;color:#777777;margin-top:12px;">
    Esta mensagem foi preparada automaticamente para apoiar a regularização da segurança do seu equipamento móvel.
  </div>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>
"@
}

function Get-OutlookApplication {
    try {
        return [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
    }
    catch {
        try {
            return New-Object -ComObject Outlook.Application
        }
        catch {
            throw 'Não foi possível iniciar o Outlook clássico. Confirme que o Outlook está instalado, configurado e aberto na mesma sessão do utilizador.'
        }
    }
}

function Add-OutlookEmbeddedLogo {
    param(
        [Parameter(Mandatory)]$MailItem,
        [Parameter(Mandatory)]$Config
    )

    $logoPath = [string]$Config.logoPath
    if ([string]::IsNullOrWhiteSpace($logoPath) -or
        -not (Test-Path -LiteralPath $logoPath)) {
        return $false
    }

    try {
        $attachment = $MailItem.Attachments.Add($logoPath)
        $contentId = [string]$Config.logoContentId

        $attachment.PropertyAccessor.SetProperty(
            'http://schemas.microsoft.com/mapi/proptag/0x3712001F',
            $contentId
        )

        $attachment.PropertyAccessor.SetProperty(
            'http://schemas.microsoft.com/mapi/proptag/0x7FFE000B',
            $true
        )

        return $true
    }
    catch {
        return $false
    }
}

function Resolve-OutlookSender {
    param(
        [Parameter(Mandatory)]$MailItem,
        [Parameter(Mandatory)][string]$SenderAddress
    )

    $MailItem.SentOnBehalfOfName = $SenderAddress
}

function New-OutlookNotificationDraft {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]$Data,
        [switch]$DirectSend
    )

    $config = Get-OutlookNotificationConfig

    if (-not $config.enabled) {
        throw 'A funcionalidade de notificações está desativada.'
    }

    $isTest = [bool](
        Get-NotificationValueV1202 `
            -Object $Data `
            -Name 'isTest' `
            -Default $false
    )

    $recipient = if ($isTest) {
        [string](
            Get-NotificationValueV1202 `
                -Object $Data `
                -Name 'testRecipient' `
                -Default ''
        )
    }
    else {
        [string](
            Get-NotificationValueV1202 `
                -Object $Data `
                -Name 'email' `
                -Default ''
        )
    }

    if ([string]::IsNullOrWhiteSpace($recipient) -or
        $recipient -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
        throw "Destinatário inválido: $recipient"
    }

    # Validação final no backend: não confiar apenas nos campos enviados pelo browser.
    $absenceIdentity = [string](Get-NotificationValueV1202 -Object $Data -Name 'email' -Default '')
    if ($absenceIdentity -and (Get-Command Get-IcmUserAbsence -ErrorAction SilentlyContinue)) {
        $absence = Get-IcmUserAbsence -UserPrincipalName $absenceIdentity
        foreach ($pair in ([ordered]@{absenceChecked=$absence.checked;absenceActive=$absence.active;absenceStatus=$absence.status;absenceJustification=$absence.justification;absenceStartAt=$absence.startAt;absenceEndAt=$absence.endAt}).GetEnumerator()) {
            Set-IcmAbsenceProperty -Object $Data -Name $pair.Key -Value $pair.Value
        }
    }

    if ($DirectSend -and -not [bool]$config.allowDirectOutlookSend) {
        throw 'O envio direto pelo Outlook está bloqueado. A mensagem deve ser revista e enviada manualmente.'
    }

    $senderAddress = [string]$config.outlookSenderAddress
    if ([string]::IsNullOrWhiteSpace($senderAddress)) {
        throw 'O remetente do Outlook não está configurado.'
    }

    $requestedSubject = [string](
        Get-NotificationValueV1202 `
            -Object $Data `
            -Name 'subject' `
            -Default ''
    )

    $subject = if ([bool](Get-NotificationValueV1202 -Object $Data -Name 'absenceActive' -Default $false)) {
        'Ação após o regresso - Regularização do equipamento móvel'
    }
    elseif (-not [string]::IsNullOrWhiteSpace($requestedSubject)) {
        $requestedSubject
    }
    else {
        [string]$config.defaultSubject
    }

    if ($isTest) {
        $subject = "[TESTE] $subject"
    }

    $outlook = Get-OutlookApplication
    $mail = $outlook.CreateItem(0)

    $htmlBody = New-OutlookMobileNotificationHtml `
        -Data $Data `
        -Config $config `
        -UseEmbeddedLogo:$false

    $mail.To = $recipient

    $fixedCc = if ($config.PSObject.Properties['fixedCc'] -and $config.fixedCc) {
        [string]$config.fixedCc
    }
    elseif ($config.PSObject.Properties['defaultCc'] -and $config.defaultCc) {
        (@($config.defaultCc) -join '; ')
    }
    else {
        'santander.enduser@santander.pt; techhelp@santander.pt'
    }

    if (-not [string]::IsNullOrWhiteSpace($fixedCc)) {
        $mail.CC = $fixedCc
    }

    $mail.Subject = $subject
    $mail.HTMLBody = $htmlBody

    Resolve-OutlookSender -MailItem $mail -SenderAddress $senderAddress

    $emailSent = $false
    $lifecycleRegistered = $false
    $warning = $null

    if ($DirectSend) {
        $mail.Send()
        $emailSent = $true

        $delayMs = if ($config.PSObject.Properties['directSendDelayMilliseconds']) {
            [int]$config.directSendDelayMilliseconds
        }
        else {
            650
        }

        if ($delayMs -gt 0) {
            Start-Sleep -Milliseconds $delayMs
        }

        if (-not $isTest) {
            try {
                $sentBy = ''

                try {
                    $namespace = $outlook.GetNamespace('MAPI')
                    $currentUser = $namespace.CurrentUser
                    $addressEntry = $currentUser.AddressEntry

                    if ($addressEntry) {
                        if ([string]$addressEntry.Type -eq 'EX') {
                            $exchangeUser = $addressEntry.GetExchangeUser()

                            if ($exchangeUser -and $exchangeUser.PrimarySmtpAddress) {
                                $sentBy = [string]$exchangeUser.PrimarySmtpAddress
                            }
                        }
                        elseif ($addressEntry.Address) {
                            $sentBy = [string]$addressEntry.Address
                        }
                    }

                    if ([string]::IsNullOrWhiteSpace($sentBy)) {
                        $sentBy = [string]$currentUser.Address
                    }
                }
                catch {}

                $null = Register-NotificationLifecycle `
                    -Device $Data `
                    -SentBy $sentBy `
                    -Transport 'OutlookLocal'

                $lifecycleRegistered = $true
            }
            catch {
                $warning =
                    'E-mail enviado, mas o controlo de prazos não foi atualizado: ' +
                    $_.Exception.Message
            }
        }

        $action = 'Enviado pelo Outlook'
    }
    else {
        $mail.Display($false)
        $action = 'Aberto no Outlook para revisão. O ciclo só é registado no envio direto.'
    }

    [pscustomobject]@{
        success = $true
        emailSent = $emailSent
        lifecycleRegistered = $lifecycleRegistered
        warning = $warning
        recipient = $recipient
        cc = $fixedCc
        sender = $senderAddress
        isTest = $isTest
        mode = if ($DirectSend) { 'Send' } else { 'Display' }
        displayName = Resolve-MobileNotificationDisplayName -Data $Data
        logoEmbedded = $false
        preparedAt = (Get-Date).ToString('s')
        message = $action
    }
}
function Invoke-OutlookNotificationApi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Payload,
        [switch]$DirectSend
    )

    try {
        $data = ConvertFrom-OutlookNotificationPayload -Payload $Payload
        New-OutlookNotificationDraft -Data $data -DirectSend:$DirectSend
    }
    catch {
        [pscustomobject]@{
            success = $false
            message = $_.Exception.Message
        }
    }
}
# END OUTLOOK LOCAL NOTIFICATION API V4
