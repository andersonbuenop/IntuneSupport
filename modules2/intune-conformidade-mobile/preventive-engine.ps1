#requires -Version 5.1
Set-StrictMode -Version 2.0
. (Join-Path $PSScriptRoot 'json-store.ps1')
# ICM UPDATE V1 - JSON STORE IMPORT
$script:PreventiveConfigFile = Join-Path $PSScriptRoot 'preventive-config.json'

function Get-V12Value {
    param($Object,[string]$Name,$Default=$null)
    if($null -eq $Object){return $Default}
    $p=$Object.PSObject.Properties[$Name]
    if($p){return $p.Value}
    return $Default
}

function ConvertTo-V12Date {
    param($Value)
    if($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)){return $null}
    try {
        return ([datetimeoffset]::Parse(
            [string]$Value,
            [Globalization.CultureInfo]::InvariantCulture,
            [Globalization.DateTimeStyles]::RoundtripKind
        )).ToLocalTime().DateTime
    } catch {
        try{return [datetime]$Value}catch{return $null}
    }
}

function Get-PreventiveConfigV12 {
    $defaults=[ordered]@{
        notificationStartDays=10
        removalDays=17
        notificationIntervalDays=2
    }

    if(-not(Test-Path -LiteralPath $script:PreventiveConfigFile)){
        return [pscustomobject]$defaults
    }

    try {
        $cfg=Get-Content -LiteralPath $script:PreventiveConfigFile -Raw -Encoding UTF8|ConvertFrom-Json
    } catch {
        return [pscustomobject]$defaults
    }

    function Resolve-Int([string[]]$Names,[int]$Default){
        foreach($name in $Names){
            $n=0
            $v=Get-V12Value $cfg $name
            if($null-ne$v -and [int]::TryParse([string]$v,[ref]$n) -and $n-gt 0){return $n}
        }
        return $Default
    }

    $start=Resolve-Int @('notificationStartDays','preventivePreAlertDays','preAlertDays') $defaults.notificationStartDays
    $remove=Resolve-Int @('removalDays','preventiveRemovalDays') $defaults.removalDays
    $interval=Resolve-Int @('notificationIntervalDays','preventiveNotificationIntervalDays','reminderIntervalDays') $defaults.notificationIntervalDays

    if($start-lt 1-or$start-gt 365){$start=$defaults.notificationStartDays}
    if($remove-le$start-or$remove-gt 730){$remove=$start+1}
    if($interval-lt 1-or$interval-gt 90){$interval=$defaults.notificationIntervalDays}

    [pscustomobject]@{
        notificationStartDays=[int]$start
        removalDays=[int]$remove
        notificationIntervalDays=[int]$interval
        version='12.0.0'
    }
}

function Save-PreventiveConfigV12 {
    param(
        [Parameter(Mandatory)][int]$NotificationStartDays,
        [Parameter(Mandatory)][int]$RemovalDays,
        [Parameter(Mandatory)][int]$NotificationIntervalDays
    )

    if($NotificationStartDays-lt 1-or$NotificationStartDays-gt 365){
        throw 'O início das notificações deve estar entre 1 e 365 dias.'
    }
    if($RemovalDays-le$NotificationStartDays-or$RemovalDays-gt 730){
        throw 'O dia de remoção deve ser superior ao início das notificações e no máximo 730 dias.'
    }
    if($NotificationIntervalDays-lt 1-or$NotificationIntervalDays-gt 90){
        throw 'O intervalo entre lembretes deve estar entre 1 e 90 dias.'
    }

    $cfg=if(Test-Path -LiteralPath $script:PreventiveConfigFile){
        try{Get-Content -LiteralPath $script:PreventiveConfigFile -Raw -Encoding UTF8|ConvertFrom-Json}catch{[pscustomobject]@{}}
    }else{[pscustomobject]@{}}

    $values=[ordered]@{
        notificationStartDays=$NotificationStartDays
        removalDays=$RemovalDays
        notificationIntervalDays=$NotificationIntervalDays
        preventiveConfigVersion='12.0.0'
        preventiveConfigUpdatedAt=(Get-Date).ToString('o')
    }

    foreach($name in $values.Keys){
        if($cfg.PSObject.Properties[$name]){$cfg.$name=$values[$name]}
        else{$cfg|Add-Member -NotePropertyName $name -NotePropertyValue $values[$name]}
    }

    foreach($legacy in @(
        'preventivePreAlertDays','preAlertDays','preventiveRemovalDays',
        'preventiveNotificationIntervalDays','reminderIntervalDays'
    )){
        if($cfg.PSObject.Properties[$legacy]){$cfg.PSObject.Properties.Remove($legacy)}
    }

    Write-IcmJsonAtomic -Path $script:PreventiveConfigFile -Data $cfg -Depth 40
    # ICM UPDATE V1 - ATOMIC PREVENTIVE CONFIG
    Get-PreventiveConfigV12
}

function Get-PreventiveStateV12 {
    param([int]$DaysWithoutSync,$Config=$null)
    if($null-eq$Config){$Config=Get-PreventiveConfigV12}
    if($DaysWithoutSync-ge[int]$Config.removalDays){return 'ReadyForRemoval'}
    if($DaysWithoutSync-eq([int]$Config.removalDays-1)){return 'RemovalImminent'}
    if($DaysWithoutSync-ge[int]$Config.notificationStartDays){return 'PreAlert'}
    return 'Regularized'
}

function Get-PreventiveSyncInfoV12 {
    param($LastSyncValue,$Config=$null,[datetime]$Now=(Get-Date))
    if($null-eq$Config){$Config=Get-PreventiveConfigV12}
    $last=ConvertTo-V12Date $LastSyncValue
    if(-not$last){
        return [pscustomobject]@{
            lastSyncDateTime=$null;daysWithoutSync=$null;preventiveDeadlineAt=$null
            preventiveDaysRemaining=$null;isPreventiveAlert=$false
            preventiveStatus='NotApplicable';canNotify=$false
        }
    }

    $days=[math]::Max(0,[math]::Floor(($Now-$last).TotalDays))
    $deadline=$last.AddDays([int]$Config.removalDays)
    $remaining=[math]::Max(0,[math]::Ceiling(($deadline-$Now).TotalDays))
    $status=Get-PreventiveStateV12 -DaysWithoutSync $days -Config $Config

    [pscustomobject]@{
        lastSyncDateTime=$last
        daysWithoutSync=[int]$days
        preventiveDeadlineAt=$deadline
        preventiveDaysRemaining=[int]$remaining
        isPreventiveAlert=($days-ge[int]$Config.notificationStartDays)
        preventiveStatus=$status
        canNotify=($status-in@('PreAlert','RemovalImminent','ReadyForRemoval'))
    }
}

function Test-PreventiveNotificationDueV12 {
    param($LastNotifiedAt,$Config=$null,[datetime]$Now=(Get-Date))
    if($null-eq$Config){$Config=Get-PreventiveConfigV12}
    $last=ConvertTo-V12Date $LastNotifiedAt
    if(-not$last){return $true}
    return (($Now-$last).TotalDays-ge[int]$Config.notificationIntervalDays)
}

# Compatibilidade transitória.
function Get-PreventiveConfigV112 { Get-PreventiveConfigV12 }
function Save-PreventiveConfigV112 {
    param([int]$NotificationStartDays,[int]$RemovalDays,[int]$NotificationIntervalDays)
    Save-PreventiveConfigV12 @PSBoundParameters
}
function Get-PreventiveStateV112 { param([int]$DaysWithoutSync) Get-PreventiveStateV12 $DaysWithoutSync }
function Get-PreventiveSyncInfoV112 { param($LastSyncValue) Get-PreventiveSyncInfoV12 $LastSyncValue }

# BEGIN PREVENTIVE ENGINE ROUTER COMPAT V12.0.1
function Invoke-PreventiveEngineApi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Action,
        $Payload = $null
    )

    try {
        switch -Regex ($Action.Trim()) {
            '^(getPreventiveConfig|preventiveConfig|savePreventiveConfig|updatePreventiveConfig)$' {
                if (-not (Get-Command Invoke-PreventiveConfigApi -ErrorAction SilentlyContinue)) {
                    $configApiPath = Join-Path $PSScriptRoot 'preventive-config-api.ps1'

                    if (Test-Path -LiteralPath $configApiPath) {
                        . $configApiPath
                    }
                }

                if (-not (Get-Command Invoke-PreventiveConfigApi -ErrorAction SilentlyContinue)) {
                    throw 'Invoke-PreventiveConfigApi não está disponível.'
                }

                return Invoke-PreventiveConfigApi `
                    -Action $Action `
                    -Payload $Payload
            }

            '^(getLifecycle|reconcileLifecycle|setLifecycleStatus|registerLifecycle|registerOutlookSentLifecycle|markRegularized|markRemoved)$' {
                if (-not (Get-Command Invoke-NotificationLifecycleApi -ErrorAction SilentlyContinue)) {
                    $lifecycleApiPath = Join-Path $PSScriptRoot 'notification-lifecycle-api.ps1'

                    if (Test-Path -LiteralPath $lifecycleApiPath) {
                        . $lifecycleApiPath
                    }
                }

                if (-not (Get-Command Invoke-NotificationLifecycleApi -ErrorAction SilentlyContinue)) {
                    throw 'Invoke-NotificationLifecycleApi não está disponível.'
                }

                return Invoke-NotificationLifecycleApi `
                    -Action $Action `
                    -Payload $Payload
            }

            default {
                return [pscustomobject]@{
                    success = $false
                    action = $Action
                    message = "Ação preventiva não suportada: $Action"
                }
            }
        }
    }
    catch {
        return [pscustomobject]@{
            success = $false
            action = $Action
            message = $_.Exception.Message
        }
    }
}
# END PREVENTIVE ENGINE ROUTER COMPAT V12.0.1

# BEGIN PREVENTIVE ENGINE RECONCILIATION ROUTER V12.1
function Invoke-PreventiveEngineReconciliationApiV121 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Action,
        $Payload = $null
    )

    if ($Action -notmatch '^(reconcilePreventiveIntune|refreshPreventiveControl|validatePreventiveResolutions)$') {
        return $null
    }

    if (-not (Get-Command Invoke-PreventiveReconciliationApi -ErrorAction SilentlyContinue)) {
        $path = Join-Path $PSScriptRoot 'preventive-reconciliation-api.ps1'

        if (Test-Path -LiteralPath $path) {
            . $path
        }
    }

    if (-not (Get-Command Invoke-PreventiveReconciliationApi -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{
            success = $false
            message = 'Invoke-PreventiveReconciliationApi não está disponível.'
        }
    }

    return Invoke-PreventiveReconciliationApi `
        -Action $Action `
        -Payload $Payload
}
# END PREVENTIVE ENGINE RECONCILIATION ROUTER V12.1
