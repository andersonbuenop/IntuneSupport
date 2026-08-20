param(
    $Query = $null,
    $Config = $null,
    [string]$Body = '',
    [string]$Method = 'GET',
    $action = $null
)
# ICM UPDATE V1 - EXPLICIT METHOD




# BEGIN SAFE GRAPH CONTEXT
function Get-ObjectPropertySafe {
    param(
        $InputObject,
        [string]$Name,
        $DefaultValue = $null
    )

    if ($null -eq $InputObject) {
        return $DefaultValue
    }

    try {
        if ($InputObject -is [System.Collections.IDictionary]) {
            foreach ($Key in $InputObject.Keys) {
                if ([string]$Key -ieq $Name) {
                    return $InputObject[$Key]
                }
            }
        }

        $Property = $InputObject.PSObject.Properties |
            Where-Object { $_.Name -ieq $Name } |
            Select-Object -First 1

        if ($Property) {
            return $Property.Value
        }
    }
    catch {
    }

    return $DefaultValue
}

function Get-GraphAccountSafe {
    param(
        $Context
    )

    if ($null -eq $Context) {
        return $null
    }

    foreach ($PropertyName in @(
        'Account',
        'UserPrincipalName',
        'Username',
        'User',
        'ClientId'
    )) {
        $Value = Get-ObjectPropertySafe `
            -InputObject $Context `
            -Name $PropertyName

        if (-not [string]::IsNullOrWhiteSpace([string]$Value)) {
            return [string]$Value
        }
    }

    return $null
}

function Get-GraphConnectionStateSafe {
    $Context = $null

    try {
        $Context = Get-MgContext -ErrorAction SilentlyContinue
    }
    catch {
        $Context = $null
    }

    $TenantId = Get-ObjectPropertySafe `
        -InputObject $Context `
        -Name 'TenantId'

    $Scopes = Get-ObjectPropertySafe `
        -InputObject $Context `
        -Name 'Scopes' `
        -DefaultValue @()

    $Account = Get-GraphAccountSafe -Context $Context

    $Connected =
        $null -ne $Context -and
        (
            -not [string]::IsNullOrWhiteSpace([string]$TenantId) -or
            @($Scopes).Count -gt 0 -or
            -not [string]::IsNullOrWhiteSpace([string]$Account)
        )

    [pscustomobject]@{
        Connected = [bool]$Connected
        Account   = $Account
        TenantId  = $TenantId
        Scopes    = @($Scopes)
        Context   = $Context
    }
}
# END SAFE GRAPH CONTEXT


# BEGIN FIX ACTION REQUEST URL V4

function ConvertFrom-QueryStringSafe {
    param(
        [string]$QueryString
    )

    $Result = @{}

    if ([string]::IsNullOrWhiteSpace($QueryString)) {
        return $Result
    }

    $Text = $QueryString.Trim()

    $QuestionIndex = $Text.IndexOf('?')

    if ($QuestionIndex -ge 0) {
        $Text = $Text.Substring($QuestionIndex + 1)
    }

    if ($Text.StartsWith('?')) {
        $Text = $Text.Substring(1)
    }

    foreach ($Part in ($Text -split '&')) {
        if ([string]::IsNullOrWhiteSpace($Part)) {
            continue
        }

        $Pair = $Part -split '=', 2

        $Name = [System.Uri]::UnescapeDataString(
            ([string]$Pair[0]).Replace('+', ' ')
        )

        $Value = ''

        if ($Pair.Count -gt 1) {
            $Value = [System.Uri]::UnescapeDataString(
                ([string]$Pair[1]).Replace('+', ' ')
            )
        }

        if (-not [string]::IsNullOrWhiteSpace($Name)) {
            $Result[$Name] = $Value
        }
    }

    return $Result
}

function Get-ActionFromAnyObject {
    param(
        $InputObject
    )

    if ($null -eq $InputObject) {
        return $null
    }

    if ($InputObject -is [System.Collections.IDictionary]) {
        foreach ($Key in $InputObject.Keys) {
            if ([string]$Key -ieq 'action') {
                return [string]$InputObject[$Key]
            }
        }
    }

    try {
        $ActionProperty = $InputObject.PSObject.Properties |
            Where-Object { $_.Name -ieq 'action' } |
            Select-Object -First 1

        if ($ActionProperty) {
            $Value = [string]$ActionProperty.Value

            if (-not [string]::IsNullOrWhiteSpace($Value)) {
                return $Value
            }
        }
    }
    catch {
    }

    if ($InputObject -is [string]) {
        $Text = [string]$InputObject

        if (-not [string]::IsNullOrWhiteSpace($Text)) {
            try {
                $ParsedJson = $Text | ConvertFrom-Json -ErrorAction Stop

                $JsonAction = Get-ActionFromAnyObject -InputObject $ParsedJson

                if (-not [string]::IsNullOrWhiteSpace([string]$JsonAction)) {
                    return [string]$JsonAction
                }
            }
            catch {
            }

            $ParsedQuery = ConvertFrom-QueryStringSafe -QueryString $Text

            foreach ($Key in $ParsedQuery.Keys) {
                if ([string]$Key -ieq 'action') {
                    return [string]$ParsedQuery[$Key]
                }
            }
        }
    }

    foreach ($PropertyName in @(
        'Query',
        'QueryString',
        'RawUrl',
        'Url',
        'Uri',
        'RequestUri',
        'AbsoluteUri',
        'OriginalString'
    )) {
        try {
            $Property = $InputObject.PSObject.Properties[$PropertyName]

            if ($Property -and $null -ne $Property.Value) {
                $NestedValue = Get-ActionFromAnyObject -InputObject $Property.Value

                if (-not [string]::IsNullOrWhiteSpace([string]$NestedValue)) {
                    return [string]$NestedValue
                }
            }
        }
        catch {
        }
    }

    try {
        $RequestProperty = $InputObject.PSObject.Properties['Request']

        if ($RequestProperty -and $null -ne $RequestProperty.Value) {
            $RequestAction = Get-ActionFromAnyObject -InputObject $RequestProperty.Value

            if (-not [string]::IsNullOrWhiteSpace([string]$RequestAction)) {
                return [string]$RequestAction
            }
        }
    }
    catch {
    }

    return $null
}

function Get-RequestActionRobust {
    param(
        $DirectAction,
        $QueryObject,
        $BodyObject
    )

    $Result = $null

    if (-not [string]::IsNullOrWhiteSpace([string]$DirectAction)) {
        $Result = [string]$DirectAction
    }

    if ([string]::IsNullOrWhiteSpace([string]$Result)) {
        $Result = Get-ActionFromAnyObject -InputObject $QueryObject
    }

    if ([string]::IsNullOrWhiteSpace([string]$Result)) {
        $Result = Get-ActionFromAnyObject -InputObject $BodyObject
    }

    if ([string]::IsNullOrWhiteSpace([string]$Result)) {
        $CandidateVariableNames = @(
            'Request',
            'Context',
            'HttpContext',
            'ListenerContext',
            'HttpListenerContext',
            'RequestContext',
            'WebRequest',
            'RawUrl',
            'Url',
            'Uri',
            'RequestUri',
            'QueryString',
            'RequestQuery',
            'Route',
            'RouteData',
            'Parameters',
            'Params'
        )

        foreach ($ScopeNumber in 0..12) {
            foreach ($VariableName in $CandidateVariableNames) {
                try {
                    $Candidate = Get-Variable `
                        -Name $VariableName `
                        -Scope $ScopeNumber `
                        -ValueOnly `
                        -ErrorAction SilentlyContinue

                    if ($null -eq $Candidate) {
                        continue
                    }

                    $CandidateAction = Get-ActionFromAnyObject `
                        -InputObject $Candidate

                    if (-not [string]::IsNullOrWhiteSpace([string]$CandidateAction)) {
                        $Result = [string]$CandidateAction
                        break
                    }
                }
                catch {
                }
            }

            if (-not [string]::IsNullOrWhiteSpace([string]$Result)) {
                break
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace([string]$Result)) {
        try {
            foreach ($BoundKey in $PSBoundParameters.Keys) {
                $BoundValue = $PSBoundParameters[$BoundKey]

                $BoundAction = Get-ActionFromAnyObject `
                    -InputObject $BoundValue

                if (-not [string]::IsNullOrWhiteSpace([string]$BoundAction)) {
                    $Result = [string]$BoundAction
                    break
                }
            }
        }
        catch {
        }
    }

    return ([string]$Result).Trim().ToLowerInvariant()
}

$RequestAction = Get-RequestActionRobust `
    -DirectAction $Action `
    -QueryObject $Query `
    -BodyObject $Body

# BEGIN VIP DISPATCH AFTER REQUESTACTION V3.5
$VipActionKeyV34 = ([string]$RequestAction).Trim().ToLowerInvariant()

$VipSupportedActionsV34 = @(
    "getvipusers",
    "lookupvipuser",
    "savevipuser",
    "deletevipuser",
    "togglevipuser"
)

if ($VipActionKeyV34 -in $VipSupportedActionsV34) {
    $VipApiFileV34 = Join-Path $PSScriptRoot "vip-users-api.ps1"

    if (-not (Test-Path -LiteralPath $VipApiFileV34)) {
        [ordered]@{
            success = $false
            message = "vip-users-api.ps1 não encontrado."
            error = "vip-users-api.ps1 não encontrado."
        } | ConvertTo-Json -Depth 10 -Compress
        return
    }

    . $VipApiFileV34

    $VipPayloadV34 = $null

    foreach ($VipPayloadNameV34 in @(
        "Body",
        "Payload",
        "payload",
        "RequestBody"
    )) {
        try {
            $VipPayloadVariableV34 = Get-Variable `
                -Name $VipPayloadNameV34 `
                -ErrorAction SilentlyContinue

            if (
                $VipPayloadVariableV34 -and
                $null -ne $VipPayloadVariableV34.Value
            ) {
                $VipPayloadV34 = $VipPayloadVariableV34.Value
                break
            }
        }
        catch {}
    }

    if ($VipPayloadV34 -is [string]) {
        $VipPayloadTextV34 = ([string]$VipPayloadV34).Trim()

        if ($VipPayloadTextV34) {
            try {
                $VipPayloadV34 = $VipPayloadTextV34 |
                    ConvertFrom-Json -ErrorAction Stop

                if ($VipPayloadV34 -is [string]) {
                    $VipPayloadV34 = ([string]$VipPayloadV34) |
                        ConvertFrom-Json -ErrorAction Stop
                }
            }
            catch {
                $VipPayloadV34 = [pscustomobject]@{}
            }
        }
    }

    if ($null -eq $VipPayloadV34) {
        $VipPayloadV34 = [pscustomobject]@{}
    }

    try {
        $VipResultV34 = Invoke-VipUsersApi `
            -Action $VipActionKeyV34 `
            -Payload $VipPayloadV34

        $VipResultV34 |
            ConvertTo-Json -Depth 30 -Compress
    }
    catch {
        [ordered]@{
            success = $false
            message = $_.Exception.Message
            error = $_.Exception.Message
        } | ConvertTo-Json -Depth 10 -Compress
    }

    return
}
# END VIP DISPATCH AFTER REQUESTACTION V3.5

$action = $RequestAction

# END FIX ACTION REQUEST URL V4


$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$ModuleRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$HistoryPath = Join-Path $ModuleRoot "data\history.json"
. (Join-Path $ModuleRoot 'json-store.ps1')
. (Join-Path $ModuleRoot 'absence-service.ps1')
# ICM UPDATE V1 - JSON STORE IMPORT
$ConfigPath = Join-Path $ModuleRoot "config.json"

function Send-Json {
    param($Object)
    $Object | ConvertTo-Json -Depth 30 -Compress
}

function Get-ValueSafe {
    param($Object, [string]$Name)

    if ($null -eq $Object) { return $null }

    try {
        if ($Object -is [System.Collections.IDictionary]) {
            if ($Object.Contains($Name)) { return $Object[$Name] }
            if ($Object.ContainsKey($Name)) { return $Object[$Name] }
        }
    } catch {}

    try {
        $property = $Object.PSObject.Properties[$Name]
        if ($property) { return $property.Value }
    } catch {}

    return $null
}

function Get-ActionSafe {
    param($Query)

    $action = $RequestAction
    if (-not $action -and $env:REQUEST_QUERY) {
        try {
            $parsed = [System.Web.HttpUtility]::ParseQueryString($env:REQUEST_QUERY)
            $action = [string]$parsed["action"]
        } catch {}
    }

    return $action
}

function Convert-BodySafe {
    param($Body)

    if ($null -eq $Body) { return @{} }

    if ($Body -is [string]) {
        if ([string]::IsNullOrWhiteSpace($Body)) { return @{} }
        try { return $Body | ConvertFrom-Json }
        catch { return @{} }
    }

    return $Body
}

function Ensure-GraphModule {
    if (-not (Get-Module -ListAvailable Microsoft.Graph.Authentication)) {
        throw "Módulo Microsoft.Graph.Authentication não instalado."
    }

    Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
}

function Connect-Graph {
    Ensure-GraphModule

    $scopes = @(
        "DeviceManagementManagedDevices.Read.All",
        "DeviceManagementConfiguration.Read.All",
        "User.Read.All"
    )

    Connect-MgGraph -Scopes $scopes -ContextScope Process -NoWelcome -ErrorAction Stop
    $context = Get-MgContext

    if (-not $context -or -not (Get-GraphAccountSafe -Context $context)) {
        throw "A ligação ao Microsoft Graph não foi concluída."
    }

    return $context
}

function Assert-GraphConnected {
    Ensure-GraphModule
    $context = Get-MgContext
    if (-not $context -or -not (Get-GraphAccountSafe -Context $context)) {
        throw "Microsoft Graph desligado. Use o botão Conectar Graph."
    }

    return $context
}

function Invoke-GraphGet {
    param([Parameter(Mandatory)][string]$Uri)

    $items = New-Object System.Collections.ArrayList
    $next = $Uri

    while ($next) {
        $response = Invoke-MgGraphRequest -Method GET -Uri $next -OutputType PSObject
        $value = Get-ValueSafe $response "value"

        if ($null -ne $value) {
            foreach ($item in @($value)) {
                [void]$items.Add($item)
            }

            $nextLink = Get-ValueSafe $response "@odata.nextLink"
            $next = if ($nextLink) { [string]$nextLink } else { $null }
        }
        else {
            return $response
        }
    }

    return $items.ToArray()
}

function Convert-ToLocalDate {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [datetimeoffset]) {
        $date = $Value.ToLocalTime().DateTime

        if ($date.Year -ge 9990) {
            return $null
        }

        return $date
    }

    if ($Value -is [datetime]) {
        $date = [datetime]$Value

        if ($date.Year -ge 9990) {
            return $null
        }

        return $date
    }

    $text = ([string]$Value).Trim()

    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    $invariant =
        [System.Globalization.CultureInfo]::InvariantCulture

    $ptCulture =
        [System.Globalization.CultureInfo]::GetCultureInfo('pt-PT')

    $styles =
        [System.Globalization.DateTimeStyles]::AllowWhiteSpaces

    $parsedOffset = [datetimeoffset]::MinValue

    # O Microsoft Graph devolve normalmente ISO 8601.
    # Este formato é sempre tratado antes de qualquer formato localizado.
    if (
        [datetimeoffset]::TryParse(
            $text,
            $invariant,
            [System.Globalization.DateTimeStyles]::RoundtripKind,
            [ref]$parsedOffset
        ) -and
        $text -match '^\d{4}-\d{2}-\d{2}'
    ) {
        $date = $parsedOffset.ToLocalTime().DateTime

        if ($date.Year -ge 9990) {
            return $null
        }

        return $date
    }

    $parsedDate = [datetime]::MinValue

    # Datas apresentadas pelo portal/ambiente português.
    # dd/MM é avaliado antes de MM/dd para impedir a inversão dia/mês.
    $ptFormats = @(
        'dd/MM/yyyy HH:mm:ss',
        'dd/MM/yyyy, HH:mm:ss',
        'dd/MM/yyyy H:mm:ss',
        'dd/MM/yyyy, H:mm:ss',
        'dd/MM/yyyy HH:mm',
        'dd/MM/yyyy, HH:mm',
        'dd/MM/yyyy H:mm',
        'dd/MM/yyyy, H:mm',
        'dd/MM/yyyy',
        'd/M/yyyy HH:mm:ss',
        'd/M/yyyy, HH:mm:ss',
        'd/M/yyyy H:mm:ss',
        'd/M/yyyy, H:mm:ss',
        'd/M/yyyy HH:mm',
        'd/M/yyyy, HH:mm',
        'd/M/yyyy H:mm',
        'd/M/yyyy, H:mm',
        'd/M/yyyy',
        'dd-MM-yyyy HH:mm:ss',
        'dd-MM-yyyy HH:mm',
        'dd-MM-yyyy'
    )

    foreach ($format in $ptFormats) {
        if (
            [datetime]::TryParseExact(
                $text,
                $format,
                $ptCulture,
                $styles,
                [ref]$parsedDate
            )
        ) {
            if ($parsedDate.Year -ge 9990) {
                return $null
            }

            return $parsedDate
        }
    }

    # Último fallback com cultura portuguesa.
    if (
        [datetime]::TryParse(
            $text,
            $ptCulture,
            $styles,
            [ref]$parsedDate
        )
    ) {
        if ($parsedDate.Year -ge 9990) {
            return $null
        }

        return $parsedDate
    }

    return $null
}

function Test-IsMobileDevice {
    param($Device)

    $os = [string](Get-ValueSafe $Device "operatingSystem")
    $model = [string](Get-ValueSafe $Device "model")
    $name = [string](Get-ValueSafe $Device "deviceName")
    $enrollment = [string](Get-ValueSafe $Device "deviceEnrollmentType")
    $combined = "$os $model $name $enrollment"

    return (
        $os -match "Android|iOS|iPadOS" -or
        $combined -match "AndroidForWork|AndroidEnterprise|iPhone|iPad"
    )
}

function Translate-ComplianceSetting {
    param([string]$Setting)

    $map = [ordered]@{
        "DeviceThreatProtectionRequiredSecurityLevel" = "Harmony: nível de ameaça acima do permitido ou estado seguro não reportado"
        "ThreatProtection"                            = "Harmony: validação de ameaça"
        "PasscodeRequired"                            = "Código de desbloqueio obrigatório"
        "PasswordRequired"                            = "Código de desbloqueio obrigatório"
        "MinimumOSVersion"                            = "Versão mínima do sistema operativo"
        "MaximumOSVersion"                            = "Versão máxima do sistema operativo"
        "OSVersion"                                   = "Versão do sistema operativo"
        "EncryptionRequired"                          = "Encriptação obrigatória"
        "StorageRequireEncryption"                    = "Encriptação do armazenamento"
        "Jailbroken"                                  = "Dispositivo com jailbreak/root"
        "Rooted"                                      = "Dispositivo com jailbreak/root"
        "RequireUserExistence"                        = "Utilizador associado ao dispositivo"
        "RequireDeviceCompliancePolicyAssigned"       = "Política de conformidade atribuída"
        "RequireRemainContact"                        = "Dispositivo deve comunicar com o Intune"
    }

    foreach ($key in $map.Keys) {
        if ($Setting -match [regex]::Escape($key)) {
            return $map[$key]
        }
    }

    if ([string]::IsNullOrWhiteSpace($Setting)) {
        return "Definição não identificada"
    }

    return $Setting
}

# BEGIN PREVENTIVE CONTROL V10.3.13

function Get-PreventiveControlConfig {
    $config = Get-PreventiveConfigV112

    return [pscustomobject]@{
        preAlertDays = [int]$config.notificationStartDays
        removalDays = [int]$config.removalDays
        notificationIntervalDays =
            [int]$config.notificationIntervalDays
    }
}

function Get-PreventiveSyncInfo {
    param($LastSyncValue)

    return Get-PreventiveSyncInfoV112 `
        -LastSyncValue $LastSyncValue
}

function Get-TrackedPreventiveManagedDeviceIds {
    $result =
        New-Object System.Collections.Generic.HashSet[string]

    try {
        $lifecyclePath =
            Join-Path $ModuleRoot 'notification-lifecycle.json'

        if (Test-Path -LiteralPath $lifecyclePath) {
            $store =
                Get-Content `
                    -LiteralPath $lifecyclePath `
                    -Raw `
                    -Encoding UTF8 |
                ConvertFrom-Json

            foreach ($item in @($store.items)) {
                $itemType = ''

                if ($item.PSObject.Properties['lifecycleType']) {
                    $itemType = [string]$item.lifecycleType
                }

                if ($itemType -ne 'Preventive30d') {
                    continue
                }

                $managedId = ''

                if ($item.PSObject.Properties['managedDeviceId']) {
                    $managedId = [string]$item.managedDeviceId
                }

                if ([string]::IsNullOrWhiteSpace($managedId)) {
                    continue
                }

                $null = $result.Add(
                    $managedId.ToLowerInvariant()
                )
            }
        }
    }
    catch {
    }

    Write-Output -NoEnumerate $result
}

# END PREVENTIVE CONTROL V10.3.13
function Get-ManagedDevices {
    $select = @(
        "id",
        "deviceName",
        "userPrincipalName",
        "userDisplayName",
        "emailAddress",
        "operatingSystem",
        "osVersion",
        "model",
        "manufacturer",
        "complianceState",
        "complianceGracePeriodExpirationDateTime",
        "lastSyncDateTime",
        "enrolledDateTime",
        "azureADDeviceId",
        "serialNumber",
        "managementAgent",
        "deviceEnrollmentType",
        "managedDeviceOwnerType"
    ) -join ","

    Invoke-GraphGet "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?`$select=$select&`$top=999"
}

function Get-PolicyDetails {
    param([string]$ManagedDeviceId)

    $details = New-Object System.Collections.ArrayList

    try {
        $policies = @(Invoke-GraphGet "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/$ManagedDeviceId/deviceCompliancePolicyStates")

        foreach ($policy in $policies) {
            $policyId = [string](Get-ValueSafe $policy "id")
            $policyName = [string](Get-ValueSafe $policy "displayName")
            $policyState = [string](Get-ValueSafe $policy "state")

            if (-not $policyName) { $policyName = $policyId }

            $settings = @()
            try {
                $settings = @(Invoke-GraphGet "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/$ManagedDeviceId/deviceCompliancePolicyStates/$policyId/settingStates")
            } catch {}

            if ($settings.Count -eq 0) {
                [void]$details.Add([pscustomobject]@{
                    policyName = $policyName
                    policyState = $policyState
                    settingName = ""
                    translatedSetting = Translate-ComplianceSetting ""
                    settingState = ""
                    errorCode = ""
                })
            }
            else {
                foreach ($setting in $settings) {
                    $settingName = ""
                    foreach ($candidate in @("settingName","setting","displayName","settingInstanceId")) {
                        $value = Get-ValueSafe $setting $candidate
                        if ($value) {
                            $settingName = [string]$value
                            break
                        }
                    }

                    $settingState = ""
                    foreach ($candidate in @("state","complianceState","status")) {
                        $value = Get-ValueSafe $setting $candidate
                        if ($value) {
                            $settingState = [string]$value
                            break
                        }
                    }

                    [void]$details.Add([pscustomobject]@{
                        policyName = $policyName
                        policyState = $policyState
                        settingName = $settingName
                        translatedSetting = Translate-ComplianceSetting $settingName
                        settingState = $settingState
                        errorCode = [string](Get-ValueSafe $setting "errorCode")
                    })
                }
            }
        }
    }
    catch {
        [void]$details.Add([pscustomobject]@{
            policyName = "Falha na consulta"
            policyState = "error"
            settingName = $_.Exception.Message
            translatedSetting = $_.Exception.Message
            settingState = "error"
            errorCode = ""
        })
    }

    return $details.ToArray()
}

function Get-Diagnosis {
    param(
        [object[]]$PolicyDetails,
        [string]$ComplianceState
    )

    $problems = @(
        $PolicyDetails | Where-Object {
            "$($_.policyState) $($_.settingState)" -match "noncompliant|error|conflict|unknown|ingraceperiod"
        }
    )

    $allText = (($problems | ForEach-Object {
        "$($_.policyName) $($_.settingName) $($_.translatedSetting)"
    }) -join " ")

    # Uma política MTD/Harmony não conforme durante a carência normalmente
    # indica que a configuração ou associação da aplicação não foi concluída.
    $hasMtdPolicyProblem = @(
        $problems | Where-Object {
            "$($_.policyName) $($_.settingName) $($_.translatedSetting)" -match
                "(?i)(^|[_ .-])MTD([_ .-]|$)|Harmony|MobileThreat|ThreatProtection"
        }
    ).Count -gt 0

    if ($hasMtdPolicyProblem -and
        $ComplianceState -match "^(?i:inGracePeriod|noncompliant)$") {
        return [pscustomobject]@{
            category = "Harmony - configuração incompleta"
            diagnosis = "A política de Mobile Threat Defense (Harmony) está não conforme. A instalação, ativação, associação ou concessão de permissões do Harmony pode não ter sido concluída no equipamento."
            risk = "Alto"
            recommendation = @"
1. Abrir a aplicação Harmony Mobile no equipamento.
2. Concluir o registo ou a ativação apresentados pela aplicação.
3. Aceitar todas as permissões solicitadas pelo Harmony.
4. Confirmar que a aplicação apresenta o equipamento como protegido e sem alertas pendentes.
5. Manter o equipamento ligado à Internet e o Harmony aberto durante alguns minutos.
6. Abrir o Portal da Empresa e executar uma sincronização/verificação.
7. Aguardar a atualização do estado no Intune.
8. Se continuar não conforme, abrir ticket para a equipa End User/Harmony validar a associação do dispositivo.
"@
        }
    }

    if ($allText -match "DeviceThreatProtectionRequiredSecurityLevel|ThreatProtection|Harmony|MobileThreat|MTD") {
        return [pscustomobject]@{
            category = "Harmony / Mobile Threat Defense"
            diagnosis = "O Intune recebeu do Harmony um nível de ameaça que não cumpre a política, ou o Harmony ainda não reportou um estado seguro atualizado."
            risk = "Alto"
            recommendation = @"
1. Abrir a aplicação Harmony Mobile.
2. Confirmar que a aplicação está ativa, protegida e sem alertas pendentes.
3. Corrigir os alertas apresentados pelo Harmony.
4. Confirmar todas as permissões solicitadas pelo Harmony.
5. Manter o telemóvel ligado à Internet e deixar o Harmony aberto durante alguns minutos.
6. Abrir o Company Portal e executar uma sincronização/verificação.
7. Reiniciar o telemóvel e repetir a sincronização caso o estado não mude.
8. Se continuar não conforme, abrir ticket para a equipa End User/Harmony verificar a aplicação e a associação do dispositivo.
"@
        }
    }

    if ($allText -match "Jailbreak|Root") {
        return [pscustomobject]@{
            category = "Integridade do dispositivo"
            diagnosis = "O dispositivo foi identificado como jailbreak/root ou falhou a validação de integridade."
            risk = "Alto"
            recommendation = @"
1. Confirmar se o dispositivo foi alterado com jailbreak/root.
2. Repor o equipamento para o estado original.
3. Atualizar o sistema operativo.
4. Voltar a registar o equipamento no Company Portal.
5. Em caso de falso positivo, abrir ticket para análise especializada.
"@
        }
    }

    if ($allText -match "Passcode|Password") {
        return [pscustomobject]@{
            category = "Código de acesso"
            diagnosis = "O equipamento não cumpre os requisitos de código de desbloqueio."
            risk = "Médio"
            recommendation = @"
1. Abrir as definições do equipamento.
2. Ativar ou alterar o código de desbloqueio para cumprir a política.
3. Abrir o Company Portal e sincronizar.
4. Aguardar alguns minutos e validar novamente no Intune.
"@
        }
    }

    if ($allText -match "OSVersion|MinimumOS|MaximumOS") {
        return [pscustomobject]@{
            category = "Sistema operativo"
            diagnosis = "A versão do sistema operativo não cumpre a política definida."
            risk = "Médio"
            recommendation = @"
1. Procurar atualizações nas definições do equipamento.
2. Instalar a versão mais recente permitida.
3. Reiniciar o equipamento.
4. Abrir o Company Portal e sincronizar.
"@
        }
    }

    if ($allText -match "Encrypt") {
        return [pscustomobject]@{
            category = "Encriptação"
            diagnosis = "A encriptação obrigatória não foi confirmada pelo Intune."
            risk = "Alto"
            recommendation = @"
1. Confirmar que o equipamento possui código de desbloqueio.
2. Confirmar que a encriptação está ativa.
3. Reiniciar o equipamento.
4. Abrir o Company Portal e sincronizar.
5. Se continuar não conforme, abrir ticket para análise.
"@
        }
    }

    if ($ComplianceState -match "^noncompliant$") {
        return [pscustomobject]@{
            category = "Equipamento móvel não conforme"
            diagnosis = "O equipamento móvel não cumpre pelo menos uma regra de conformidade ou terminou o período de carência."
            risk = "Alto"
            recommendation = @"
1. Abrir o Harmony Mobile e verificar alertas e permissões.
2. Corrigir os alertas apresentados.
3. Confirmar ligação à Internet.
4. Abrir o Company Portal e executar uma sincronização.
5. Reiniciar o equipamento e voltar a sincronizar.
6. Se continuar não conforme, abrir ticket incluindo a política e a definição indicadas.
"@
        }
    }

    return [pscustomobject]@{
        category = "Aguardando avaliação/sincronização"
        diagnosis = "O equipamento encontra-se em período de carência, mas o Graph não devolveu uma regra específica não conforme. Pode estar a aguardar a avaliação do Harmony, Company Portal ou uma nova sincronização."
        risk = "Médio"
        recommendation = @"
1. Confirmar que o equipamento tem ligação à Internet.
2. Abrir o Harmony Mobile e verificar se existem alertas.
3. Manter o Harmony aberto durante alguns minutos.
4. Abrir o Company Portal e executar uma sincronização/verificação.
5. Reiniciar o telemóvel ou tablet e repetir a sincronização.
6. Se o estado não atualizar, abrir ticket com os dados apresentados neste relatório.
"@
    }
}

function Get-PolicySummary {
    param([object[]]$PolicyDetails)

    $problem = @(
        $PolicyDetails | Where-Object {
            "$($_.policyState) $($_.settingState)" -match "noncompliant|error|conflict|unknown|ingraceperiod"
        }
    )

    if ($problem.Count -eq 0) { $problem = @($PolicyDetails) }

    return (($problem | ForEach-Object {
        "$($_.policyName) > $($_.translatedSetting) [$($(if ($_.settingState) { $_.settingState } else { $_.policyState }))]"
    } | Select-Object -Unique) -join "; ")
}

function Read-History {
    if (-not (Test-Path $HistoryPath)) { return @{} }

    try {
        $content = Get-Content $HistoryPath -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($content)) { return @{} }
        $object = $content | ConvertFrom-Json

        $result = @{}
        foreach ($property in $object.PSObject.Properties) {
            $result[$property.Name] = @($property.Value)
        }
        return $result
    }
    catch {
        return @{}
    }
}

function Save-History {
    param([hashtable]$History)

    Write-IcmJsonAtomic -Path $HistoryPath -Data $History -Depth 20
    # ICM UPDATE V1 - ATOMIC HISTORY
}

function Add-HistoryEntry {
    param(
        [hashtable]$History,
        [string]$ManagedDeviceId,
        $Entry
    )

    if (-not $History.ContainsKey($ManagedDeviceId)) {
        $History[$ManagedDeviceId] = @()
    }

    $current = @($History[$ManagedDeviceId])
    $last = $current | Select-Object -Last 1

    $changed = (
        -not $last -or
        $last.complianceState -ne $Entry.complianceState -or
        $last.diagnosticCategory -ne $Entry.diagnosticCategory
    )

    if ($changed) {
        $current += $Entry
        if ($current.Count -gt 30) {
            $current = @($current | Select-Object -Last 30)
        }
        $History[$ManagedDeviceId] = $current
    }
}

$action = $RequestAction
$bodyObject = Convert-BodySafe $Body

try {
# BEGIN PREVENTIVE ENGINE ROUTER V11.1.1
. (Join-Path $PSScriptRoot 'preventive-engine.ps1')

if ([string]$action -in @(
    'getpreventiveconfig',
    'savepreventiveconfig',
    'getpreventivehistory',
    'resetpreventivehistory',
    'evaluatepreventive'
)) {
    $preventivePayload = $bodyObject

    if ($null -eq $preventivePayload -or
        ($preventivePayload -is [System.Collections.IDictionary] -and
         $preventivePayload.Count -eq 0)) {

        if (Get-Variable -Name Query -ErrorAction SilentlyContinue) {
            try {
                $queryPayload = $Query['payload']

                if (-not [string]::IsNullOrWhiteSpace(
                    [string]$queryPayload
                )) {
                    $preventivePayload = [string]$queryPayload
                }
            }
            catch {
            }
        }
    }

    Invoke-PreventiveEngineApi `
        -Action ([string]$action) `
        -Payload $preventivePayload |
        ConvertTo-Json -Depth 50 -Compress

    return
}
# END PREVENTIVE ENGINE ROUTER V11.1.1
# BEGIN INTUNE MOBILE REQUEST PAYLOAD RESOLVER V4
function ConvertTo-IntuneMobilePayloadJsonV4 {
    [CmdletBinding()]
    param(
        [AllowNull()]$BodyObject,
        [AllowNull()]$RawBody,
        [AllowNull()]$QueryObject,
        [AllowNull()]$RequestObject,
        [AllowNull()]$LegacyPayload
    )

    function Convert-CandidateToJsonV4 {
        param([AllowNull()]$Candidate)

        if ($null -eq $Candidate) {
            return $null
        }

        if ($Candidate -is [string]) {
            $text = [string]$Candidate

            if ([string]::IsNullOrWhiteSpace($text)) {
                return $null
            }

            return $text
        }

        return (
            $Candidate |
            ConvertTo-Json -Depth 60 -Compress
        )
    }

    function Get-PayloadPropertyV4 {
        param([AllowNull()]$Object)

        if ($null -eq $Object -or $Object -is [string]) {
            return $null
        }

        if ($Object -is [System.Collections.IDictionary]) {
            foreach ($key in $Object.Keys) {
                if ([string]$key -ieq 'payload') {
                    return $Object[$key]
                }
            }
        }

        try {
            $property = $Object.PSObject.Properties['payload']

            if ($property) {
                return $property.Value
            }
        }
        catch {
        }

        return $null
    }

    function Test-ObjectHasContentV4 {
        param([AllowNull()]$Object)

        if ($null -eq $Object) {
            return $false
        }

        if ($Object -is [string]) {
            return -not [string]::IsNullOrWhiteSpace([string]$Object)
        }

        if ($Object -is [System.Collections.IDictionary]) {
            return $Object.Count -gt 0
        }

        try {
            return @($Object.PSObject.Properties).Count -gt 0
        }
        catch {
            return $true
        }
    }

    # 1. Corpo já convertido pelo router principal.
    if (Test-ObjectHasContentV4 -Object $BodyObject) {
        $nestedPayload = Get-PayloadPropertyV4 -Object $BodyObject

        if ($null -ne $nestedPayload) {
            $resolved = Convert-CandidateToJsonV4 -Candidate $nestedPayload

            if (-not [string]::IsNullOrWhiteSpace([string]$resolved)) {
                return [string]$resolved
            }
        }

        $resolved = Convert-CandidateToJsonV4 -Candidate $BodyObject

        if (-not [string]::IsNullOrWhiteSpace([string]$resolved)) {
            return [string]$resolved
        }
    }

    # 2. Corpo HTTP bruto.
    if (Test-ObjectHasContentV4 -Object $RawBody) {
        if ($RawBody -is [string]) {
            $rawText = [string]$RawBody

            try {
                $parsedBody = $rawText | ConvertFrom-Json -ErrorAction Stop
                $nestedPayload = Get-PayloadPropertyV4 -Object $parsedBody

                if ($null -ne $nestedPayload) {
                    $resolved = Convert-CandidateToJsonV4 -Candidate $nestedPayload

                    if (-not [string]::IsNullOrWhiteSpace([string]$resolved)) {
                        return [string]$resolved
                    }
                }
            }
            catch {
            }

            if (-not [string]::IsNullOrWhiteSpace($rawText)) {
                return $rawText
            }
        }
        else {
            $resolved = Convert-CandidateToJsonV4 -Candidate $RawBody

            if (-not [string]::IsNullOrWhiteSpace([string]$resolved)) {
                return [string]$resolved
            }
        }
    }

    # 3. Query recebida pelo router.
    if ($null -ne $QueryObject) {
        try {
            $queryPayload = $QueryObject['payload']

            if ($null -ne $queryPayload) {
                $resolved = Convert-CandidateToJsonV4 -Candidate $queryPayload

                if (-not [string]::IsNullOrWhiteSpace([string]$resolved)) {
                    return [string]$resolved
                }
            }
        }
        catch {
        }
    }

    # 4. QueryString do objeto Request.
    if ($null -ne $RequestObject) {
        try {
            $requestPayload = $RequestObject.QueryString['payload']

            if ($null -ne $requestPayload) {
                $resolved = Convert-CandidateToJsonV4 -Candidate $requestPayload

                if (-not [string]::IsNullOrWhiteSpace([string]$resolved)) {
                    return [string]$resolved
                }
            }
        }
        catch {
        }
    }

    # 5. Variável legada.
    $legacyResolved = Convert-CandidateToJsonV4 -Candidate $LegacyPayload

    if (-not [string]::IsNullOrWhiteSpace([string]$legacyResolved)) {
        return [string]$legacyResolved
    }

    return $null
}
# END INTUNE MOBILE REQUEST PAYLOAD RESOLVER V4

# BEGIN INTUNE MOBILE NOTIFICATION ROUTER V2
. (Join-Path $PSScriptRoot 'notification-api.ps1')

if ([string]$Action -ieq 'sendNotification') {
    $routerBodyObject = Get-Variable `
        -Name bodyObject `
        -ValueOnly `
        -ErrorAction SilentlyContinue

    $routerRawBody = Get-Variable `
        -Name Body `
        -ValueOnly `
        -ErrorAction SilentlyContinue

    $routerQuery = Get-Variable `
        -Name Query `
        -ValueOnly `
        -ErrorAction SilentlyContinue

    $routerRequest = Get-Variable `
        -Name Request `
        -ValueOnly `
        -ErrorAction SilentlyContinue

    $routerLegacyPayload = Get-Variable `
        -Name payload `
        -ValueOnly `
        -ErrorAction SilentlyContinue

    $notificationPayload =
        ConvertTo-IntuneMobilePayloadJsonV4 `
            -BodyObject $routerBodyObject `
            -RawBody $routerRawBody `
            -QueryObject $routerQuery `
            -RequestObject $routerRequest `
            -LegacyPayload $routerLegacyPayload

    if ([string]::IsNullOrWhiteSpace([string]$notificationPayload)) {
        [pscustomobject]@{
            success = $false
            message = 'Payload não informado.'
            source = 'body-query-legacy'
        } |
        ConvertTo-Json -Depth 8

        return
    }

    Invoke-MobileNotificationApi `
        -Payload ([string]$notificationPayload) |
        ConvertTo-Json -Depth 12

    return
}
# END INTUNE MOBILE NOTIFICATION ROUTER V2
# BEGIN OUTLOOK LOCAL NOTIFICATION ROUTER V4
. (Join-Path $PSScriptRoot 'outlook-notification-api.ps1')

if ([string]$Action -ieq 'prepareOutlookNotification' -or
    [string]$Action -ieq 'sendOutlookNotification') {

    $routerBodyObject = Get-Variable `
        -Name bodyObject `
        -ValueOnly `
        -ErrorAction SilentlyContinue

    $routerRawBody = Get-Variable `
        -Name Body `
        -ValueOnly `
        -ErrorAction SilentlyContinue

    $routerQuery = Get-Variable `
        -Name Query `
        -ValueOnly `
        -ErrorAction SilentlyContinue

    $routerRequest = Get-Variable `
        -Name Request `
        -ValueOnly `
        -ErrorAction SilentlyContinue

    $routerLegacyPayload = Get-Variable `
        -Name payload `
        -ValueOnly `
        -ErrorAction SilentlyContinue

    $outlookPayload =
        ConvertTo-IntuneMobilePayloadJsonV4 `
            -BodyObject $routerBodyObject `
            -RawBody $routerRawBody `
            -QueryObject $routerQuery `
            -RequestObject $routerRequest `
            -LegacyPayload $routerLegacyPayload

    if ([string]::IsNullOrWhiteSpace([string]$outlookPayload)) {
        [pscustomobject]@{
            success = $false
            message = 'Payload não informado.'
            source = 'body-query-legacy'
        } |
        ConvertTo-Json -Depth 8

        return
    }

    $directSend =
        [string]$Action -ieq 'sendOutlookNotification'

    Invoke-OutlookNotificationApi `
        -Payload ([string]$outlookPayload) `
        -DirectSend:$directSend |
        ConvertTo-Json -Depth 12

    return
}
# END OUTLOOK LOCAL NOTIFICATION ROUTER V4
# BEGIN PREVENTIVE RECONCILIATION ROUTER V12.5
. (Join-Path $PSScriptRoot 'preventive-reconciliation-api.ps1')

if ([string]$action -in @(
    'reconcilepreventiveintune',
    'refreshpreventivecontrol',
    'validatepreventiveresolutions'
)) {
    $reconciliationPayload = $bodyObject

    if (
        $null -eq $reconciliationPayload -or
        (
            $reconciliationPayload -is [System.Collections.IDictionary] -and
            $reconciliationPayload.Count -eq 0
        )
    ) {
        try {
            if ($Query -and $Query['payload']) {
                $reconciliationPayload = [string]$Query['payload']
            }
        }
        catch {
        }
    }

    if ($null -eq $reconciliationPayload) {
        $reconciliationPayload = ''
    }
    elseif (-not ($reconciliationPayload -is [string])) {
        $reconciliationPayload =
            $reconciliationPayload |
            ConvertTo-Json -Depth 50 -Compress
    }

    Invoke-PreventiveReconciliationApi `
        -Action ([string]$action) `
        -Payload ([string]$reconciliationPayload) |
        ConvertTo-Json -Depth 50 -Compress

    return
}
# END PREVENTIVE RECONCILIATION ROUTER V12.5
# BEGIN INTUNE MOBILE LIFECYCLE ROUTER V9
. (Join-Path $PSScriptRoot 'notification-lifecycle-api.ps1')

if ([string]$action -in @(
    'getlifecycle',
    'reconcilelifecycle',
    'markremoved',
    'setlifecyclestatus'
)) {
    $lifecyclePayload = $bodyObject

    if (
        $null -eq $lifecyclePayload -or
        (
            $lifecyclePayload -is [System.Collections.IDictionary] -and
            $lifecyclePayload.Count -eq 0
        )
    ) {
        try {
            if ($Query -and $Query['payload']) {
                $lifecyclePayload = [string]$Query['payload']
            }
        }
        catch {
        }
    }

    if ($null -eq $lifecyclePayload) {
        $lifecyclePayload = ''
    }

    Invoke-NotificationLifecycleApi `
        -Action ([string]$action) `
        -Payload $lifecyclePayload |
        ConvertTo-Json -Depth 50 -Compress

    return
}
# END INTUNE MOBILE LIFECYCLE ROUTER V9
    switch ($action) {
        # BEGIN REGISTER OUTLOOK SENT ACTION V9.5.2
        'registerOutlookSentLifecycle' {
            try {
                $__body = $Payload
                if ($null -eq $__body) { $__body = $payload }
                if ($__body -is [string]) { $__body = $__body | ConvertFrom-Json }

                return Register-OutlookSentNotifications `
                    -Payload $(if ($__body.PSObject.Properties['devices']) { $__body.devices } else { $__body }) `
                    -SentBy $(if ($__body.PSObject.Properties['sentBy']) { [string]$__body.sentBy } else { 'Operador local' }) `
                    -RegistrationToken $(if ($__body.PSObject.Properties['registrationToken']) { [string]$__body.registrationToken } else { '' })
            }
            catch {
                return [pscustomobject]@{ success = $false; message = $_.Exception.Message }
            }
        }
        # END REGISTER OUTLOOK SENT ACTION V9.5.2

        "status" {
            $context = $null
            try {
                Ensure-GraphModule
                $context = Get-MgContext
            } catch {}

            Send-Json @{
                success = $true
                connected = [bool]($context -and (Get-GraphAccountSafe -Context $context))
                account = if ($context) { (Get-GraphAccountSafe -Context $context) } else { $null }
            }
        }

        "connect" {
            $context = Connect-Graph
            Send-Json @{
                success = $true
                connected = $true
                account = (Get-GraphAccountSafe -Context $context)
                tenantId = (Get-ObjectPropertySafe -InputObject $context -Name 'TenantId')
            }
        }

        "exchangeabsencestatus" {
            $exchangeState = Get-IcmExchangeConnection
            Send-Json @{success=$true;connected=$exchangeState.connected;account=$exchangeState.account;source='ExchangeOnline'}
        }

        "connectexchangeabsence" {
            $exchangeState = Connect-IcmExchange
            $script:IcmAbsenceCache = @{}
            Send-Json @{success=$true;connected=$exchangeState.connected;account=$exchangeState.account;source='ExchangeOnline'}
        }

        "scan" {        try {

            $script:LifecycleReconciledExplicitlyV1034 = $false

            [void](Assert-GraphConnected)

            $mode = [string](Get-ValueSafe $bodyObject "mode")
            $search = [string](Get-ValueSafe $bodyObject "search")

            $devices = @(Get-ManagedDevices | Where-Object { Test-IsMobileDevice $_ })

            if ($mode -eq "user") {
                $devices = @($devices | Where-Object {
                    ([string](Get-ValueSafe $_ "userPrincipalName") -like "*$search*") -or
                    ([string](Get-ValueSafe $_ "emailAddress") -like "*$search*") -or
                    ([string](Get-ValueSafe $_ "userDisplayName") -like "*$search*") -or
                    ([string](Get-ValueSafe $_ "deviceName") -like "*$search*")
                })
            }
            else {
                $trackedPreventiveIds =
                    Get-TrackedPreventiveManagedDeviceIds

                $devices = @($devices | Where-Object {
                    $stateValue =
                        [string](
                            Get-ValueSafe $_ 'complianceState'
                        )

                    $syncInfo =
                        Get-PreventiveSyncInfo (
                            Get-ValueSafe $_ 'lastSyncDateTime'
                        )

                    $managedId =
                        [string](
                            Get-ValueSafe $_ 'id'
                        )

                    $isTrackedPreventive =
                        -not [string]::IsNullOrWhiteSpace($managedId) -and
                        $trackedPreventiveIds.Contains(
                            $managedId.ToLowerInvariant()
                        )

                    return (
                        $stateValue -match
                            'inGracePeriod|noncompliant' -or
                        $syncInfo.isPreventiveAlert -or
                        $isTrackedPreventive
                    )
                })
            }

            $history = Read-History
            $rows = New-Object System.Collections.ArrayList

            foreach ($device in $devices) {
                $managedDeviceId =
                    [string](Get-ValueSafe $device 'id')

                $complianceState =
                    [string](Get-ValueSafe $device 'complianceState')

                $syncInfo =
                    Get-PreventiveSyncInfo (
                        Get-ValueSafe $device 'lastSyncDateTime'
                    )

                $isGraceProblem =
                    $complianceState -match
                        '^(inGracePeriod|noncompliant)$'

                $lifecycleType = if ($isGraceProblem) {
                    'Grace24h'
                }
                elseif ($syncInfo.isPreventiveAlert) {
                    'Preventive30d'
                }
                else {
                    'Normal'
                }

                $details = @()
                $diagnostic = $null

                if ($isGraceProblem) {
                    $details = @(Get-PolicyDetails $managedDeviceId)
                    $diagnostic =
                        Get-Diagnosis $details $complianceState
                }
                elseif ($syncInfo.isPreventiveAlert) {
                    $riskValue = if (
                        $syncInfo.preventiveStatus -in @(
                            'RemovalImminent',
                            'ReadyForRemoval'
                        )
                    ) {
                        'Alto'
                    }
                    else {
                        'Médio'
                    }

                    $diagnostic = [pscustomobject]@{
                        category =
                            'Pré-alerta de comunicação com o Intune'
                        diagnosis = (
                            'O equipamento não comunica com o Intune há ' +
                            [string]$syncInfo.daysWithoutSync +
                            ' dia(s). Deve ser sincronizado antes da data limite.'
                        )
                        risk = $riskValue
                        recommendation = @"
1. Ligar o equipamento à Internet.
2. Abrir o Harmony Mobile e confirmar que está ativo e sem alertas.
3. Abrir o Portal da Empresa e executar uma sincronização.
4. Manter o equipamento ligado durante alguns minutos.
5. Reiniciar e repetir a sincronização se o estado não atualizar.
"@
                    }
                }
                else {
                    $diagnostic = [pscustomobject]@{
                        category = 'Comunicação restabelecida'
                        diagnosis =
                            'O equipamento voltou a comunicar com o Intune.'
                        risk = 'Baixo'
                        recommendation =
                            'Nenhuma ação adicional é necessária.'
                    }
                }

                $entry = [pscustomobject]@{
                    timestamp = (Get-Date).ToString("o")
                    complianceState = $complianceState
                    diagnosticCategory = $diagnostic.category
                    risk = $diagnostic.risk
                }

                Add-HistoryEntry $history $managedDeviceId $entry

                $absence = Get-IcmUserAbsence -UserPrincipalName ([string](Get-ValueSafe $device "userPrincipalName"))
                [void]$rows.Add([pscustomobject]@{
                    managedDeviceId = $managedDeviceId
                    deviceName = [string](Get-ValueSafe $device "deviceName")
                    userPrincipalName = [string](Get-ValueSafe $device "userPrincipalName")
                    userDisplayName = [string](Get-ValueSafe $device "userDisplayName")
                    absenceChecked = [bool]$absence.checked
                    absenceActive = [bool]$absence.active
                    absenceStatus = [string]$absence.status
                    absenceJustification = [string]$absence.justification
                    absenceStartAt = $absence.startAt
                    absenceEndAt = $absence.endAt
                    operatingSystem = [string](Get-ValueSafe $device "operatingSystem")
                    osVersion = [string](Get-ValueSafe $device "osVersion")
                    manufacturer = [string](Get-ValueSafe $device "manufacturer")
                    model = [string](Get-ValueSafe $device "model")
                    serialNumber = [string](Get-ValueSafe $device "serialNumber")
                    complianceState = $complianceState
                    lifecycleType = $lifecycleType
                    hiddenReconciliationOnly = (
                        $lifecycleType -eq 'Normal'
                    )
                    graceExpiration = (
                        Convert-ToLocalDate (
                            Get-ValueSafe $device `
                                'complianceGracePeriodExpirationDateTime'
                        )
                    )
                    lastSyncDateTime = $syncInfo.lastSyncDateTime
                    daysWithoutSync = $syncInfo.daysWithoutSync
                    preventiveDeadlineAt =
                        $syncInfo.preventiveDeadlineAt
                    preventiveDaysRemaining =
                        $syncInfo.preventiveDaysRemaining
                    preventiveStatus =
                        $syncInfo.preventiveStatus
                    isPreventiveAlert =
                        $syncInfo.isPreventiveAlert
                    enrolledDateTime = (
                        Convert-ToLocalDate (
                            Get-ValueSafe $device 'enrolledDateTime'
                        )
                    )
                    azureADDeviceId = [string](Get-ValueSafe $device "azureADDeviceId")
                    ownerType = [string](Get-ValueSafe $device "managedDeviceOwnerType")
                    enrollmentType = [string](Get-ValueSafe $device "deviceEnrollmentType")
                    diagnosticCategory = $diagnostic.category
                    diagnosis = $diagnostic.diagnosis
                    recommendation = $diagnostic.recommendation
                    risk = $diagnostic.risk
                    policySummary = Get-PolicySummary $details
                    policyDetails = $details
                    history = @($history[$managedDeviceId])
                })
            }

            Save-History $history
            
            # BEGIN NON-BLOCKING SCAN RECONCILIATION V10.3.13
            $__finalScanRows = @($rows.ToArray())
            $script:LifecycleReconciledExplicitlyV1034 = $true
            
            $__reconcileAttempted = $false
            $__reconcileSuccess = $false
            $__reconcileWarning = $null
            $__preventivePersisted = $null
            
            $__preventiveReceived = @(
                $__finalScanRows | Where-Object {
                    [string]$_.lifecycleType -eq 'Preventive30d' -or
                    [bool]$_.isPreventiveAlert
                }
            ).Count
            
            if (Get-Command Update-NotificationLifecycleFromScan -ErrorAction SilentlyContinue) {
                $__reconcileAttempted = $true
            
                try {
                    $__life = Update-NotificationLifecycleFromScan -Devices $__finalScanRows
                    $__reconcileSuccess = $true
            
                    if ($__life -and $__life.PSObject.Properties['preventiveSummary']) {
                        $__preventivePersisted = [int]$__life.preventiveSummary.total
                    }
                }
                catch {
                    $__reconcileWarning = $_.Exception.Message
                    Write-Warning ('Lifecycle não atualizado: ' + $__reconcileWarning)
                }
            }
            else {
                $__reconcileWarning = 'Update-NotificationLifecycleFromScan indisponível.'
            }
            
            Send-Json @{
                success = $true
                total = $__finalScanRows.Count
                rows = $__finalScanRows
                lifecycleReconciliation = @{
                    attempted = $__reconcileAttempted
                    success = $__reconcileSuccess
                    warning = $__reconcileWarning
                    rowsReceived = $__finalScanRows.Count
                    preventiveRowsReceived = $__preventiveReceived
                    preventiveItemsPersisted = $__preventivePersisted
                }
            }
            # END NON-BLOCKING SCAN RECONCILIATION V10.3.13
            # END EXPLICIT SCAN RECONCILIATION V10.3.13
        
        }
        finally {

        # BEGIN SERVER-SIDE SCAN RECONCILIATION V9.5.1
        try {
            # disable duplicate reconciliation V10.3.13
            if (
                -not $script:LifecycleReconciledExplicitlyV1034 -and
                (Get-Command Update-NotificationLifecycleFromScan -ErrorAction SilentlyContinue)
            ) {
                $__scanRows = @()
                $__scanRowsDetected = $false
                $__scanSuccessDetected = $false

                # Variáveis mais comuns utilizadas pelo módulo.
                $__candidateNames = @(
                    'rows',
                    'Rows',
                    'result',
                    'Result',
                    'response',
                    'Response',
                    'scanResult',
                    'ScanResult',
                    'devices',
                    'Devices',
                    'data',
                    'Data'
                )

                foreach ($__name in $__candidateNames) {
                    $__variable = Get-Variable `
                        -Name $__name `
                        -Scope Local `
                        -ErrorAction SilentlyContinue

                    if (-not $__variable) {
                        continue
                    }

                    $__candidate = $__variable.Value

                    if ($null -eq $__candidate) {
                        continue
                    }

                    # Desembrulhar JSON textual.
                    if ($__candidate -is [string]) {
                        try {
                            $__candidate = $__candidate | ConvertFrom-Json
                        }
                        catch {
                            continue
                        }
                    }

                    # Objeto de resposta com success/rows.
                    if (
                        (Get-ValueSafe $__candidate 'rows')
                    ) {
                        $__scanRowsDetected = $true

                        if (
                            (Get-ValueSafe $__candidate 'success')
                        ) {
                            $__scanSuccessDetected =
                                [bool]$__candidate.success
                        }
                        else {
                            $__scanSuccessDetected = $true
                        }

                        $__scanRows = @($__candidate.rows)
                        break
                    }

                    # Array direto de dispositivos.
                    if (
                        $__candidate -is [System.Collections.IEnumerable] -and
                        -not ($__candidate -is [string])
                    ) {
                        $__array = @($__candidate)

                        if ($__array.Count -gt 0) {
                            $__first = $__array[0]

                            if (
                                $__first -and
                                (
                                    (Get-ValueSafe $__first 'managedDeviceId') -or
                                    (Get-ValueSafe $__first 'deviceName') -or
                                    (Get-ValueSafe $__first 'userPrincipalName')
                                )
                            ) {
                                $__scanRowsDetected = $true
                                $__scanSuccessDetected = $true
                                $__scanRows = $__array
                                break
                            }
                        }
                    }
                }

                # Fallback: procurar em todas as variáveis locais por objeto com rows.
                if (-not $__scanRowsDetected) {
                    foreach ($__variable in Get-Variable -Scope Local) {
                        $__candidate = $__variable.Value

                        if (
                            $null -ne $__candidate -and
                            (Get-ValueSafe $__candidate 'rows')
                        ) {
                            $__scanRowsDetected = $true

                            if (
                                (Get-ValueSafe $__candidate 'success')
                            ) {
                                $__scanSuccessDetected =
                                    [bool]$__candidate.success
                            }
                            else {
                                $__scanSuccessDetected = $true
                            }

                            $__scanRows = @($__candidate.rows)
                            break
                        }
                    }
                }

                if ($__scanRowsDetected -and $__scanSuccessDetected) {
                    $null = Update-NotificationLifecycleFromScan `
                        -Rows @($__scanRows)
                }
            }
        }
        catch {
            # A reconciliação nunca deve impedir a resposta principal do scan.
            Write-Warning (
                'Falha na reconciliação server-side do lifecycle: ' +
                $_.Exception.Message
            )
        }
        # END SERVER-SIDE SCAN RECONCILIATION V9.5.1
        }}

        default {
            Send-Json @{
                success = $false
                message = "Action não informada ou não suportada: $action | RequestAction: $RequestAction"
            }
        }
    }
}
catch {
    Send-Json @{
        success = $false
        message = $_.Exception.Message
        type = $_.Exception.GetType().FullName
        line = $_.InvocationInfo.ScriptLineNumber
    }
}

# BEGIN PREVENTIVE ENGINE IMPORT V11.2
. (Join-Path $PSScriptRoot 'preventive-engine.ps1')
# END PREVENTIVE ENGINE IMPORT V11.2

# BEGIN PREVENTIVE CONFIG ROUTER V11.2
if ([string]$Action -ieq 'getPreventiveConfig') {
    $activeConfig = Get-PreventiveConfigV112

    Send-Json @{
        success = $true
        version = '11.2.0'
        notificationStartDays =
            [int]$activeConfig.notificationStartDays
        removalDays =
            [int]$activeConfig.removalDays
        notificationIntervalDays =
            [int]$activeConfig.notificationIntervalDays
    }

    return
}

if ([string]$Action -ieq 'savePreventiveConfig') {
    $payloadObject = Convert-BodySafe $Body

    if ($Query -and $Query['payload']) {
        try {
            $payloadObject =
                [System.Uri]::UnescapeDataString(
                    [string]$Query['payload']
                ) |
                ConvertFrom-Json
        }
        catch {
        }
    }

    $savedConfig =
        Save-PreventiveConfigV112 `
            -NotificationStartDays (
                [int](
                    Get-ValueSafe `
                        $payloadObject `
                        'notificationStartDays'
                )
            ) `
            -RemovalDays (
                [int](
                    Get-ValueSafe `
                        $payloadObject `
                        'removalDays'
                )
            ) `
            -NotificationIntervalDays (
                [int](
                    Get-ValueSafe `
                        $payloadObject `
                        'notificationIntervalDays'
                )
            )

    Send-Json @{
        success = $true
        version = '11.2.0'
        message = 'Prazos preventivos guardados com sucesso.'
        notificationStartDays =
            [int]$savedConfig.notificationStartDays
        removalDays =
            [int]$savedConfig.removalDays
        notificationIntervalDays =
            [int]$savedConfig.notificationIntervalDays
        recalculateRequired = $true
    }

    return
}
# END PREVENTIVE CONFIG ROUTER V11.2

# BEGIN INTUNE MOBILE V12 IMPORTS
foreach ($dependencyV12 in @(
    (Join-Path $PSScriptRoot 'preventive-engine.ps1'),
    (Join-Path $PSScriptRoot 'preventive-config-api.ps1'),
    (Join-Path $PSScriptRoot 'notification-lifecycle-api.ps1')
)) {
    if (Test-Path -LiteralPath $dependencyV12) {
        . $dependencyV12
    }
}
# END INTUNE MOBILE V12 IMPORTS

# BEGIN INTUNE MOBILE V12.1 RECONCILIATION IMPORT
$preventiveReconciliationV121Path = Join-Path $PSScriptRoot 'preventive-reconciliation-api.ps1'

if (Test-Path -LiteralPath $preventiveReconciliationV121Path) {
    . $preventiveReconciliationV121Path
}
# END INTUNE MOBILE V12.1 RECONCILIATION IMPORT
