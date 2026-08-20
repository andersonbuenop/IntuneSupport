#requires -Version 5.1
Set-StrictMode -Version 2.0
. (Join-Path $PSScriptRoot 'json-store.ps1')
# ICM UPDATE V1 - JSON STORE IMPORT

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

. (Join-Path $PSScriptRoot 'preventive-engine.ps1')
$script:LifecyclePath=Join-Path $PSScriptRoot 'notification-lifecycle.json'

function Get-LifecycleValueSafe {
    param($Object,[string]$Name,$Default=$null)
    if($null-eq$Object){return $Default}
    $p=$Object.PSObject.Properties[$Name]
    if($p){return $p.Value}
    return $Default
}

function Set-LifecycleValueSafe {
    param($Object,[string]$Name,$Value)
    if($Object.PSObject.Properties[$Name]){$Object.$Name=$Value}
    else{$Object|Add-Member -NotePropertyName $Name -NotePropertyValue $Value}
}

function ConvertTo-LifecycleDateSafe { param($Value) ConvertTo-V12Date $Value }

function Read-NotificationLifecycle {
    if(-not(Test-Path -LiteralPath $script:LifecyclePath)){
        return [pscustomobject]@{version='12.0.0';updatedAt=(Get-Date).ToString('o');items=@()}
    }
    try{
        $data=Get-Content -LiteralPath $script:LifecyclePath -Raw -Encoding UTF8|ConvertFrom-Json
        if(-not$data.PSObject.Properties['items']){$data|Add-Member -NotePropertyName items -NotePropertyValue @()}
        return $data
    }catch{
        throw "Não foi possível ler notification-lifecycle.json: $($_.Exception.Message)"
    }
}

function Save-NotificationLifecycle {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Data)
    Set-LifecycleValueSafe $Data version '13.1.0'
    Set-LifecycleValueSafe $Data updatedAt (Get-Date).ToString('o')
    Write-IcmJsonAtomic -Path $script:LifecyclePath -Data $Data -Depth 60
    # ICM UPDATE V1 - ATOMIC LIFECYCLE
}

function Get-LifecycleDeviceKey {
    param($Device)
    foreach($name in @('managedDeviceId','id','azureADDeviceId','azureAdDeviceId','serialNumber')){
        $v=[string](Get-LifecycleValueSafe $Device $name '')
        if(-not[string]::IsNullOrWhiteSpace($v)-and$v-ne'0'){return $v.Trim().ToLowerInvariant()}
    }
    $email=[string](Get-LifecycleValueSafe $Device userPrincipalName (Get-LifecycleValueSafe $Device email ''))
    $device=[string](Get-LifecycleValueSafe $Device deviceName '')
    return "$($email.Trim().ToLowerInvariant())|$($device.Trim().ToLowerInvariant())"
}

function Get-RequestedLifecycleType {
    param($Device)
    $type=[string](Get-LifecycleValueSafe $Device lifecycleType '')
    if($type-in@('Grace24h','Preventive30d')){return $type}
    if([bool](Get-LifecycleValueSafe $Device isPreventiveAlert $false)){return 'Preventive30d'}
    return 'Grace24h'
}

function Find-LifecycleItemV12 {
    param([object[]]$Items,[string]$DeviceKey,[string]$LifecycleType)
    @($Items|Where-Object{
        [string](Get-LifecycleValueSafe $_ deviceKey '')-eq$DeviceKey-and
        [string](Get-LifecycleValueSafe $_ lifecycleType 'Grace24h')-eq$LifecycleType
    })|Select-Object -First 1
}

function New-LifecycleItemV12 {
    param($Device,[string]$LifecycleType)
    [pscustomobject]@{
        deviceKey=Get-LifecycleDeviceKey $Device
        lifecycleType=$LifecycleType
        email=[string](Get-LifecycleValueSafe $Device userPrincipalName (Get-LifecycleValueSafe $Device email ''))
        displayName=[string](Get-LifecycleValueSafe $Device userDisplayName (Get-LifecycleValueSafe $Device displayName ''))
        deviceName=[string](Get-LifecycleValueSafe $Device deviceName '')
        managedDeviceId=[string](Get-LifecycleValueSafe $Device managedDeviceId '')
        azureADDeviceId=[string](Get-LifecycleValueSafe $Device azureADDeviceId '')
        serialNumber=[string](Get-LifecycleValueSafe $Device serialNumber '')
        model=[string](Get-LifecycleValueSafe $Device model '')
        operatingSystem=[string](Get-LifecycleValueSafe $Device operatingSystem '')
        complianceState=[string](Get-LifecycleValueSafe $Device complianceState '')
        lastSyncDateTime=$null
        daysWithoutSync=$null
        preventiveDeadlineAt=$null
        preventiveDaysRemaining=$null
        preventiveStatus=$null
        notifiedAt=$null
        lastNotifiedAt=$null
        notificationCount=0
        deadlineAt=$null
        status=if($LifecycleType-eq'Preventive30d'){'PreAlert'}else{'Waiting'}
        lastSeenAt=(Get-Date).ToString('o')
        missingSince=$null
        regularizedAt=$null
        removedAt=$null
        removedBy=$null
        resolutionNote=$null
        transport=$null
        sentBy=$null
        lastUpdatedAt=(Get-Date).ToString('o')
    }
}

function Copy-DeviceToLifecycleV12 {
    param($Item,$Device)
    $map=[ordered]@{
        email=@('userPrincipalName','email')
        displayName=@('userDisplayName','displayName')
        deviceName=@('deviceName')
        managedDeviceId=@('managedDeviceId','id')
        azureADDeviceId=@('azureADDeviceId','azureAdDeviceId')
        serialNumber=@('serialNumber')
        model=@('model')
        operatingSystem=@('operatingSystem')
        complianceState=@('complianceState')
    }
    foreach($target in $map.Keys){
        foreach($source in $map[$target]){
            $v=Get-LifecycleValueSafe $Device $source
            if($null-ne$v-and-not[string]::IsNullOrWhiteSpace([string]$v)){
                Set-LifecycleValueSafe $Item $target $v
                break
            }
        }
    }
}

function Update-PreventiveItemV12 {
    param($Item,$Device,$Config)
    Copy-DeviceToLifecycleV12 $Item $Device
    $info=Get-PreventiveSyncInfoV12 (Get-LifecycleValueSafe $Device lastSyncDateTime) $Config
    Set-LifecycleValueSafe $Item lastSyncDateTime $(if($info.lastSyncDateTime){$info.lastSyncDateTime.ToString('o')}else{$null})
    Set-LifecycleValueSafe $Item daysWithoutSync $info.daysWithoutSync
    Set-LifecycleValueSafe $Item preventiveDeadlineAt $(if($info.preventiveDeadlineAt){$info.preventiveDeadlineAt.ToString('o')}else{$null})
    Set-LifecycleValueSafe $Item deadlineAt $(if($info.preventiveDeadlineAt){$info.preventiveDeadlineAt.ToString('o')}else{$null})
    Set-LifecycleValueSafe $Item preventiveDaysRemaining $info.preventiveDaysRemaining
    Set-LifecycleValueSafe $Item preventiveStatus $info.preventiveStatus
    if(-not(Get-LifecycleValueSafe $Item removedAt)){
        Set-LifecycleValueSafe $Item status $info.preventiveStatus
        if($info.preventiveStatus-eq'Regularized'){
            if(-not(Get-LifecycleValueSafe $Item regularizedAt)){Set-LifecycleValueSafe $Item regularizedAt (Get-Date).ToString('o')}
        }else{Set-LifecycleValueSafe $Item regularizedAt $null}
    }
    Set-LifecycleValueSafe $Item lastSeenAt (Get-Date).ToString('o')
    Set-LifecycleValueSafe $Item missingSince $null
    Set-LifecycleValueSafe $Item lastUpdatedAt (Get-Date).ToString('o')
}

function Update-GraceItemV12 {
    param($Item,$Device)
    Copy-DeviceToLifecycleV12 $Item $Device
    $state=([string](Get-LifecycleValueSafe $Device complianceState '')).ToLowerInvariant()
    if($state-eq'compliant'){
        Set-LifecycleValueSafe $Item status 'Regularized'
        if(-not(Get-LifecycleValueSafe $Item regularizedAt)){Set-LifecycleValueSafe $Item regularizedAt (Get-Date).ToString('o')}
    }elseif(-not(Get-LifecycleValueSafe $Item removedAt)){
        $deadline=ConvertTo-LifecycleDateSafe (Get-LifecycleValueSafe $Item deadlineAt)
        if($deadline-and$deadline-le(Get-Date)){Set-LifecycleValueSafe $Item status 'ReadyToRemove'}
        elseif([int](Get-LifecycleValueSafe $Item notificationCount 0)-gt 0){Set-LifecycleValueSafe $Item status 'Waiting'}
    }
    Set-LifecycleValueSafe $Item lastSeenAt (Get-Date).ToString('o')
    Set-LifecycleValueSafe $Item missingSince $null
    Set-LifecycleValueSafe $Item lastUpdatedAt (Get-Date).ToString('o')
}

function Update-NotificationLifecycleFromScan {
    param($Devices,[switch]$FullScan)
    $data=Read-NotificationLifecycle
    $items=@($data.items)
    $config=Get-PreventiveConfigV12
    $seen=New-Object 'Collections.Generic.HashSet[string]'

    foreach($device in @($Devices)){
        $types=New-Object Collections.Generic.List[string]
        $compliance=([string](Get-LifecycleValueSafe $device complianceState '')).ToLowerInvariant()
        if($compliance-in@('ingraceperiod','noncompliant')){$types.Add('Grace24h')}

        $info=Get-PreventiveSyncInfoV12 (Get-LifecycleValueSafe $device lastSyncDateTime) $config
        if($info.isPreventiveAlert){
            $types.Add('Preventive30d')
            Set-LifecycleValueSafe $device isPreventiveAlert $true
            Set-LifecycleValueSafe $device daysWithoutSync $info.daysWithoutSync
            Set-LifecycleValueSafe $device preventiveStatus $info.preventiveStatus
            Set-LifecycleValueSafe $device preventiveDaysRemaining $info.preventiveDaysRemaining
            Set-LifecycleValueSafe $device preventiveDeadlineAt $(if($info.preventiveDeadlineAt){$info.preventiveDeadlineAt.ToString('o')}else{$null})
        }

        foreach($type in $types){
            $key=Get-LifecycleDeviceKey $device
            $null=$seen.Add("$key|$type")
            $item=Find-LifecycleItemV12 $items $key $type
            if(-not$item){$item=New-LifecycleItemV12 $device $type;$items+=$item}
            if($type-eq'Preventive30d'){Update-PreventiveItemV12 $item $device $config}
            else{Update-GraceItemV12 $item $device}
        }
    }

    if($FullScan){
        foreach($item in $items){
            $composite="$([string](Get-LifecycleValueSafe $item deviceKey ''))|$([string](Get-LifecycleValueSafe $item lifecycleType 'Grace24h'))"
            if(-not$seen.Contains($composite)-and-not(Get-LifecycleValueSafe $item removedAt)-and
               (Get-LifecycleValueSafe $item status)-notin@('Regularized','RemovedByUser','RemovedByTeam')){
                if(-not(Get-LifecycleValueSafe $item missingSince)){Set-LifecycleValueSafe $item missingSince (Get-Date).ToString('o')}
                Set-LifecycleValueSafe $item status 'PendingResolutionValidation'
            }
        }
    }

    $data.items=@($items)
    Save-NotificationLifecycle $data
    Get-NotificationLifecycleSummary
}

function Register-NotificationLifecycle {
    param($Device,[string]$SentBy='',[string]$Transport='Unknown')
    $data=Read-NotificationLifecycle
    $items=@($data.items)
    $type=Get-RequestedLifecycleType $Device
    $key=Get-LifecycleDeviceKey $Device
    $item=Find-LifecycleItemV12 $items $key $type
    if(-not$item){$item=New-LifecycleItemV12 $Device $type;$items+=$item}
    Copy-DeviceToLifecycleV12 $item $Device

    $now=Get-Date
    $count=[int](Get-LifecycleValueSafe $item notificationCount 0)
    if($count-eq 0){Set-LifecycleValueSafe $item notifiedAt $now.ToString('o')}
    Set-LifecycleValueSafe $item lastNotifiedAt $now.ToString('o')
    Set-LifecycleValueSafe $item notificationCount ($count+1)
    Set-LifecycleValueSafe $item transport $Transport
    Set-LifecycleValueSafe $item sentBy $SentBy

    if($type-eq'Grace24h'){
        $hours=24
        $cfgPath=Join-Path $PSScriptRoot 'notification-config.json'
        if(Test-Path -LiteralPath $cfgPath){
            try{
                $cfg=Get-Content -LiteralPath $cfgPath -Raw -Encoding UTF8|ConvertFrom-Json
                if($cfg.PSObject.Properties['notificationGraceHours']){$hours=[int]$cfg.notificationGraceHours}
            }catch{}
        }
        $requestedHours=[int](Get-LifecycleValueSafe $Device urgentDeadlineHours 0)
        if($requestedHours-gt 0-and$requestedHours-le 24){$hours=$requestedHours}
        $deadline=ConvertTo-LifecycleDateSafe (Get-LifecycleValueSafe $item deadlineAt)
        if(-not$deadline){$deadline=$now.AddHours($hours);Set-LifecycleValueSafe $item deadlineAt $deadline.ToString('o')}
        Set-LifecycleValueSafe $item status $(if($deadline-le$now){'ReadyToRemove'}else{'Waiting'})
    }else{
        Update-PreventiveItemV12 $item $Device (Get-PreventiveConfigV12)
    }

    $data.items=@($items)
    Save-NotificationLifecycle $data
    return $item
}

function Recalculate-PreventiveLifecycleV12 {
    $data=Read-NotificationLifecycle
    $items=@($data.items)
    $cfg=Get-PreventiveConfigV12
    $updated=0
    foreach($item in $items){
        if((Get-LifecycleValueSafe $item lifecycleType 'Grace24h')-ne'Preventive30d'){continue}
        $before="$(Get-LifecycleValueSafe $item deadlineAt)|$(Get-LifecycleValueSafe $item status)"
        Update-PreventiveItemV12 $item $item $cfg
        $after="$(Get-LifecycleValueSafe $item deadlineAt)|$(Get-LifecycleValueSafe $item status)"
        if($before-ne$after){$updated++}
    }
    $data.items=@($items);Save-NotificationLifecycle $data
    [pscustomobject]@{success=$true;updated=$updated}
}

function Set-NotificationLifecycleStatus {
    param([string]$DeviceKey,[string]$Status,[string]$LifecycleType='',[string]$ChangedBy='',[string]$Note='')
    $allowed=@('Waiting','ReadyToRemove','PreAlert','RemovalImminent','ReadyForRemoval','Regularized','PendingResolutionValidation','RemovedByUser','RemovedByTeam')
    if($Status-notin$allowed){throw "Estado não suportado: $Status"}
    $data=Read-NotificationLifecycle
    $matches=@($data.items|Where-Object{
        [string](Get-LifecycleValueSafe $_ deviceKey '')-eq$DeviceKey-and
        ([string]::IsNullOrWhiteSpace($LifecycleType)-or
         [string](Get-LifecycleValueSafe $_ lifecycleType 'Grace24h')-eq$LifecycleType)
    })
    if(-not$matches.Count){throw "Ciclo não encontrado: $DeviceKey"}
    foreach($item in $matches){
        Set-LifecycleValueSafe $item status $Status
        Set-LifecycleValueSafe $item resolutionNote $Note
        Set-LifecycleValueSafe $item lastUpdatedAt (Get-Date).ToString('o')
        if($Status-eq'Regularized'){Set-LifecycleValueSafe $item regularizedAt (Get-Date).ToString('o')}
        if($Status-in@('RemovedByUser','RemovedByTeam')){
            Set-LifecycleValueSafe $item removedAt (Get-Date).ToString('o')
            Set-LifecycleValueSafe $item removedBy $ChangedBy
        }
    }
    Save-NotificationLifecycle $data
    Get-NotificationLifecycleSummary
}

function Get-RemainingTextV12 {
    param($Deadline)
    $d=ConvertTo-LifecycleDateSafe $Deadline
    if(-not$d){return '—'}
    $r=$d-(Get-Date)
    if($r.TotalMinutes-le 0){return 'Prazo expirado'}
    if($r.TotalHours-lt 48){
        $m=[math]::Ceiling($r.TotalMinutes);$h=[math]::Floor($m/60);$mm=$m%60
        if($h-gt 0-and$mm-gt 0){return "${h}h ${mm}m"}
        if($h-gt 0){return "${h}h"}
        return "${mm}m"
    }
    $days=[math]::Ceiling($r.TotalDays)
    if($days-eq 1){return '1 dia'}
    return "$days dias"
}

function Get-NotificationLifecycleSummary {
    $data=Read-NotificationLifecycle
    $items=@($data.items)
    foreach($item in $items){Set-LifecycleValueSafe $item remainingText (Get-RemainingTextV12 (Get-LifecycleValueSafe $item deadlineAt))}
    $grace=@($items|Where-Object{(Get-LifecycleValueSafe $_ lifecycleType 'Grace24h')-eq'Grace24h'})
    $preventive=@($items|Where-Object{(Get-LifecycleValueSafe $_ lifecycleType 'Grace24h')-eq'Preventive30d'})
    [pscustomobject]@{
        success=$true;version='12.0.0'
        summary=[pscustomobject]@{
            total=$grace.Count
            waiting=@($grace|Where-Object{$_.status-eq'Waiting'}).Count
            readyToRemove=@($grace|Where-Object{$_.status-eq'ReadyToRemove'}).Count
            regularized=@($grace|Where-Object{$_.status-eq'Regularized'}).Count
            pendingResolutionValidation=@($grace|Where-Object{$_.status-eq'PendingResolutionValidation'}).Count
            removedByUser=@($grace|Where-Object{$_.status-eq'RemovedByUser'}).Count
            removedByTeam=@($grace|Where-Object{$_.status-eq'RemovedByTeam'}).Count
        }
        preventiveSummary=[pscustomobject]@{
            total=$preventive.Count
            preAlert=@($preventive|Where-Object{$_.status-eq'PreAlert'}).Count
            removalImminent=@($preventive|Where-Object{$_.status-eq'RemovalImminent'}).Count
            readyForRemoval=@($preventive|Where-Object{$_.status-eq'ReadyForRemoval'}).Count
            regularized=@($preventive|Where-Object{$_.status-eq'Regularized'}).Count
            pendingResolutionValidation=@($preventive|Where-Object{$_.status-eq'PendingResolutionValidation'}).Count
            removedByUser=@($preventive|Where-Object{$_.status-eq'RemovedByUser'}).Count
            removedByTeam=@($preventive|Where-Object{$_.status-eq'RemovedByTeam'}).Count
        }
        items=$grace
        preventiveItems=$preventive
        config=Get-PreventiveConfigV12
    }
}

function ConvertFrom-LifecyclePayloadV12 {
    param($Payload)
    $v=$Payload
    if($v-is[string]){
        try{$v=[uri]::UnescapeDataString($v)}catch{}
        for($i=0;$i-lt 5;$i++){
            if(-not($v-is[string])){break}
            try{$v=$v|ConvertFrom-Json}catch{break}
        }
    }
    return $v
}

function Invoke-NotificationLifecycleApi {
    param([string]$Action,$Payload=$null)
    try{
        $body=ConvertFrom-LifecyclePayloadV12 $Payload
        switch -Regex ($Action.Trim()){
            '^getLifecycle$'{return Get-NotificationLifecycleSummary}
            '^reconcileLifecycle$'{
                $rowsValue = Get-LifecycleValueSafe -Object $body -Name 'rows' -Default $null
                $rows = if ($null -ne $rowsValue) { @($rowsValue) } else { @($body) }
                return Update-NotificationLifecycleFromScan -Devices $rows -FullScan:([bool](Get-LifecycleValueSafe $body fullScan $false))
            }
            '^setLifecycleStatus$'{
                return Set-NotificationLifecycleStatus `
                    -DeviceKey ([string]$body.deviceKey) `
                    -LifecycleType ([string](Get-LifecycleValueSafe $body lifecycleType '')) `
                    -Status ([string]$body.status) `
                    -ChangedBy ([string](Get-LifecycleValueSafe $body changedBy 'Operador local')) `
                    -Note ([string](Get-LifecycleValueSafe $body note ''))
            }
            '^registerLifecycle$'{
                return [pscustomobject]@{success=$true;item=Register-NotificationLifecycle $body ([string](Get-LifecycleValueSafe $body sentBy '')) ([string](Get-LifecycleValueSafe $body transport 'Unknown'))}
            }
            default{return [pscustomobject]@{success=$false;message="Ação lifecycle não suportada: $Action"}}
        }
    }catch{
        return [pscustomobject]@{success=$false;action=$Action;message=$_.Exception.Message}
    }
}
# BEGIN NOTIFICATION LIFECYCLE OVERRIDES V13

if (Test-Path Function:\Update-NotificationLifecycleFromScan) {
    Set-Item `
        -Path Function:\Update-NotificationLifecycleFromScanLegacyV13 `
        -Value (Get-Item Function:\Update-NotificationLifecycleFromScan).ScriptBlock
}

function Get-LifecycleDeviceKey {
    param(
        [Parameter(Mandatory)]$Device
    )

    $managedDeviceId = [string](
        Get-LifecycleValueSafe `
            -Object $Device `
            -Name 'managedDeviceId' `
            -Default ''
    )

    if ([string]::IsNullOrWhiteSpace($managedDeviceId)) {
        $existingKey = [string](
            Get-LifecycleValueSafe `
                -Object $Device `
                -Name 'deviceKey' `
                -Default ''
        )

        if ($existingKey -match '^(?i)managed:(.+)$') {
            $managedDeviceId = [string]$Matches[1]
        }
        elseif ($existingKey -match '^[0-9a-fA-F-]{36}$') {
            $managedDeviceId = $existingKey
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($managedDeviceId)) {
        return ('managed:' + $managedDeviceId.Trim().ToLowerInvariant())
    }

    $azureId = [string](
        Get-LifecycleValueSafe `
            -Object $Device `
            -Name 'azureADDeviceId' `
            -Default ''
    )

    if (-not [string]::IsNullOrWhiteSpace($azureId) -and
        $azureId -ne '00000000-0000-0000-0000-000000000000') {
        return ('azure:' + $azureId.Trim().ToLowerInvariant())
    }

    $email = [string](
        Get-LifecycleValueSafe `
            -Object $Device `
            -Name 'email' `
            -Default ''
    )

    $deviceName = [string](
        Get-LifecycleValueSafe `
            -Object $Device `
            -Name 'deviceName' `
            -Default ''
    )

    return (
        'fallback:' +
        $email.Trim().ToLowerInvariant() +
        '|' +
        $deviceName.Trim().ToLowerInvariant()
    )
}

function Save-NotificationLifecycle {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Data)
    Set-LifecycleValueSafe $Data version '13.1.0'
    Set-LifecycleValueSafe $Data updatedAt (Get-Date).ToString('o')
    Write-IcmJsonAtomic -Path $script:LifecyclePath -Data $Data -Depth 60
    # ICM UPDATE V1 - ATOMIC LIFECYCLE
}

function Update-NotificationLifecycleFromScan {
    [CmdletBinding()]
    param(
        [Alias('Rows')]
        [AllowNull()]$Devices,

        [switch]$FullScan
    )

    if (-not (Get-Command Update-NotificationLifecycleFromScanLegacyV13 -ErrorAction SilentlyContinue)) {
        throw 'Implementação original de Update-NotificationLifecycleFromScan não foi encontrada.'
    }

    Update-NotificationLifecycleFromScanLegacyV13 `
        -Devices $Devices `
        -FullScan:$FullScan
}

# END NOTIFICATION LIFECYCLE OVERRIDES V13

# PATCH V13.0.6 - GRACE24H DIRECT GRAPH RECONCILIATION

function Get-LifecycleValueV1306 {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string[]]$Names,
        $Default = $null
    )

    if ($null -eq $Object) {
        return $Default
    }

    foreach ($name in $Names) {
        if ($Object -is [System.Collections.IDictionary]) {
            if ($Object.Contains($name)) {
                $value = $Object[$name]
                if ($null -ne $value) {
                    return $value
                }
            }

            continue
        }

        $property = $Object.PSObject.Properties[$name]

        if ($null -ne $property -and $null -ne $property.Value) {
            return $property.Value
        }
    }

    return $Default
}

function Set-LifecycleValueV1306 {
    param(
        [Parameter(Mandatory = $true)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Value
    )

    if ($Object -is [System.Collections.IDictionary]) {
        $Object[$Name] = $Value
        return
    }

    $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
}

function Get-CanonicalManagedDeviceIdV1306 {
    param([Parameter(Mandatory = $true)]$Object)

    $value = [string](Get-LifecycleValueV1306 `
        -Object $Object `
        -Names @('managedDeviceId','id','deviceKey') `
        -Default '')

    $value = $value.Trim()

    if ($value -match '^(?i)managed:(.+)$') {
        $value = $matches[1]
    }

    if ($value -eq '00000000-0000-0000-0000-000000000000') {
        return ''
    }

    return $value.ToLowerInvariant()
}

function Test-DeviceProblemV1306 {
    param([Parameter(Mandatory = $true)]$Device)

    $compliance = [string](Get-LifecycleValueV1306 `
        -Object $Device `
        -Names @('complianceState','compliance','status') `
        -Default '')

    $diagnostic = [string](Get-LifecycleValueV1306 `
        -Object $Device `
        -Names @('diagnosticCategory','diagnosis','diagnostic','policySummary') `
        -Default '')

    $complianceKey = $compliance.Trim().ToLowerInvariant()
    $diagnosticKey = $diagnostic.Trim().ToLowerInvariant()

    if (
        $complianceKey -match 'ingraceperiod' -or
        $complianceKey -match 'em car[eê]ncia' -or
        $complianceKey -match 'noncompliant' -or
        $complianceKey -match 'n[aã]o conforme'
    ) {
        return $true
    }

    if (
        $diagnosticKey.Contains('harmony') -or
        $diagnosticKey.Contains('mobile threat defense')
    ) {
        return $true
    }

    return $false
}

function Get-ManagedDeviceFromGraphV1306 {
    param([Parameter(Mandatory = $true)][string]$ManagedDeviceId)

    if (-not (Get-Command Invoke-MgGraphRequest -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{
            found = $null
            device = $null
            error = 'Invoke-MgGraphRequest não está disponível nesta sessão.'
        }
    }

    $select = @(
        'id',
        'deviceName',
        'userPrincipalName',
        'userDisplayName',
        'emailAddress',
        'operatingSystem',
        'model',
        'serialNumber',
        'azureADDeviceId',
        'complianceState',
        'lastSyncDateTime'
    ) -join ','

    $uri = (
        "https://graph.microsoft.com/beta/deviceManagement/managedDevices/" +
        ("{0}?`$select={1}" -f $ManagedDeviceId, $select)
    )

    try {
        $device = Invoke-MgGraphRequest `
            -Method GET `
            -Uri $uri `
            -ErrorAction Stop

        return [pscustomobject]@{
            found = $true
            device = $device
            error = $null
        }
    }
    catch {
        $message = $_.Exception.Message

        if (
            $message -match '(?i)\b404\b' -or
            $message -match '(?i)not found' -or
            $message -match '(?i)resourcenotfound'
        ) {
            return [pscustomobject]@{
                found = $false
                device = $null
                error = $null
            }
        }

        return [pscustomobject]@{
            found = $null
            device = $null
            error = $message
        }
    }
}

function Add-LifecycleHistoryV1306 {
    param(
        [Parameter(Mandatory = $true)]$Item,
        [Parameter(Mandatory = $true)][string]$Event,
        [Parameter(Mandatory = $true)][string]$Details,
        [Parameter(Mandatory = $true)][string]$ChangedBy,
        [Parameter(Mandatory = $true)][datetime]$Timestamp
    )

    $history = @(
        Get-LifecycleValueV1306 `
            -Object $Item `
            -Names @('history') `
            -Default @()
    )

    $history += [pscustomobject]@{
        timestamp = $Timestamp.ToString('o')
        event = $Event
        details = $Details
        changedBy = $ChangedBy
    }

    Set-LifecycleValueV1306 -Object $Item -Name 'history' -Value $history
}

function Save-LifecycleDocumentV1306 {
    param(
        [Parameter(Mandatory = $true)]$Document,
        [Parameter(Mandatory = $true)][string]$Path
    )
    Write-IcmJsonAtomic -Path $Path -Data $Document -Depth 40
}

function Update-NotificationLifecycleFromScan {
    [CmdletBinding()]
    param(
        [Alias('Rows')]
        [object[]]$Devices = @(),

        [switch]$FullScan
    )

    $path = Join-Path $PSScriptRoot 'notification-lifecycle.json'
    $now = Get-Date
    $changedBy = 'Reconciliação automática V13.0.6'

    if (-not (Test-Path -LiteralPath $path)) {
        return [pscustomobject]@{
            success = $true
            message = 'O controlo ainda não possui registos.'
            total = 0
            regularized = 0
            pendingValidation = 0
            errors = @()
        }
    }

    $raw = [System.IO.File]::ReadAllText($path)

    if ([string]::IsNullOrWhiteSpace($raw)) {
        $document = [pscustomobject]@{
            version = '13.0.6'
            updatedAt = $now.ToString('o')
            items = @()
        }
    }
    else {
        $document = $raw | ConvertFrom-Json
    }

    $items = @(
        Get-LifecycleValueV1306 `
            -Object $document `
            -Names @('items') `
            -Default @()
    )

    $deviceMap = @{}

    foreach ($device in @($Devices)) {
        $key = Get-CanonicalManagedDeviceIdV1306 -Object $device

        if (-not [string]::IsNullOrWhiteSpace($key)) {
            $deviceMap[$key] = $device
        }
    }

    $regularized = 0
    $stillProblem = 0
    $pendingValidation = 0
    $graphChecked = 0
    $updated = 0
    $errors = New-Object System.Collections.Generic.List[string]

    foreach ($item in $items) {
        $lifecycleType = [string](Get-LifecycleValueV1306 `
            -Object $item `
            -Names @('lifecycleType') `
            -Default 'Grace24h')

        if ($lifecycleType -ne 'Grace24h') {
            continue
        }

        $status = [string](Get-LifecycleValueV1306 `
            -Object $item `
            -Names @('status') `
            -Default '')

        if ($status -in @('Regularized','RemovedByTeam','RemovedByUser')) {
            continue
        }

        $key = Get-CanonicalManagedDeviceIdV1306 -Object $item

        if ([string]::IsNullOrWhiteSpace($key)) {
            continue
        }

        $device = $null
        $found = $null
        $source = ''

        if ($deviceMap.ContainsKey($key)) {
            $device = $deviceMap[$key]
            $found = $true
            $source = 'Última pesquisa'
        }
        elseif (
            $status -eq 'PendingResolutionValidation' -or
            $FullScan.IsPresent
        ) {
            $graphChecked++
            $graphResult = Get-ManagedDeviceFromGraphV1306 `
                -ManagedDeviceId $key

            $found = $graphResult.found
            $device = $graphResult.device
            $source = 'Microsoft Graph'

            if ($null -eq $found -and $graphResult.error) {
                $errors.Add("$key - $($graphResult.error)")
                continue
            }
        }
        else {
            continue
        }

        if ($found -eq $true -and $null -ne $device) {
            Set-LifecycleValueV1306 `
                -Object $item `
                -Name 'lastSeenAt' `
                -Value $now.ToString('o')

            Set-LifecycleValueV1306 `
                -Object $item `
                -Name 'missingSince' `
                -Value $null

            foreach ($field in @(
                'deviceName',
                'userPrincipalName',
                'emailAddress',
                'userDisplayName',
                'operatingSystem',
                'model',
                'serialNumber',
                'azureADDeviceId',
                'complianceState',
                'lastSyncDateTime'
            )) {
                $value = Get-LifecycleValueV1306 `
                    -Object $device `
                    -Names @($field) `
                    -Default $null

                if ($null -ne $value) {
                    switch ($field) {
                        'userPrincipalName' {
                            Set-LifecycleValueV1306 `
                                -Object $item `
                                -Name 'email' `
                                -Value $value
                        }
                        'emailAddress' {
                            $currentEmail = [string](Get-LifecycleValueV1306 `
                                -Object $item `
                                -Names @('email') `
                                -Default '')

                            if ([string]::IsNullOrWhiteSpace($currentEmail)) {
                                Set-LifecycleValueV1306 `
                                    -Object $item `
                                    -Name 'email' `
                                    -Value $value
                            }
                        }
                        'userDisplayName' {
                            Set-LifecycleValueV1306 `
                                -Object $item `
                                -Name 'displayName' `
                                -Value $value
                        }
                        default {
                            Set-LifecycleValueV1306 `
                                -Object $item `
                                -Name $field `
                                -Value $value
                        }
                    }
                }
            }

            if (-not (Test-DeviceProblemV1306 -Device $device)) {
                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'status' `
                    -Value 'Regularized'

                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'regularizedAt' `
                    -Value $now.ToString('o')

                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'removedAt' `
                    -Value $null

                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'removedBy' `
                    -Value $null

                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'resolutionType' `
                    -Value 'Regularized'

                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'resolutionConfirmedAt' `
                    -Value $now.ToString('o')

                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'resolutionConfirmedBy' `
                    -Value $changedBy

                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'resolutionNote' `
                    -Value "Dispositivo encontrado e saudável através de $source."

                Add-LifecycleHistoryV1306 `
                    -Item $item `
                    -Event 'Regularized' `
                    -Details "Dispositivo encontrado e sem o problema original através de $source." `
                    -ChangedBy $changedBy `
                    -Timestamp $now

                $regularized++
            }
            else {
                if ($status -eq 'PendingResolutionValidation') {
                    $deadlineRaw = Get-LifecycleValueV1306 `
                        -Object $item `
                        -Names @('deadlineAt') `
                        -Default $null

                    $newStatus = 'Waiting'

                    if ($deadlineRaw) {
                        try {
                            $deadline = [datetimeoffset]::Parse(
                                [string]$deadlineRaw
                            )

                            if ($deadline -le [datetimeoffset]::Now) {
                                $newStatus = 'ReadyForRemoval'
                            }
                        }
                        catch {}
                    }

                    Set-LifecycleValueV1306 `
                        -Object $item `
                        -Name 'status' `
                        -Value $newStatus
                }

                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'resolutionType' `
                    -Value $null

                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'resolutionConfirmedAt' `
                    -Value $null

                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'resolutionConfirmedBy' `
                    -Value $null

                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'resolutionNote' `
                    -Value $null

                $stillProblem++
            }

            Set-LifecycleValueV1306 `
                -Object $item `
                -Name 'lastUpdatedAt' `
                -Value $now.ToString('o')

            $updated++
            continue
        }

        if ($found -eq $false) {
            $missingSince = Get-LifecycleValueV1306 `
                -Object $item `
                -Names @('missingSince') `
                -Default $null

            if (-not $missingSince) {
                Set-LifecycleValueV1306 `
                    -Object $item `
                    -Name 'missingSince' `
                    -Value $now.ToString('o')
            }

            Set-LifecycleValueV1306 `
                -Object $item `
                -Name 'status' `
                -Value 'PendingResolutionValidation'

            Set-LifecycleValueV1306 `
                -Object $item `
                -Name 'lastUpdatedAt' `
                -Value $now.ToString('o')

            $pendingValidation++
            $updated++
        }
    }

    Set-LifecycleValueV1306 `
        -Object $document `
        -Name 'version' `
        -Value '13.0.6'

    Set-LifecycleValueV1306 `
        -Object $document `
        -Name 'updatedAt' `
        -Value $now.ToString('o')

    Set-LifecycleValueV1306 `
        -Object $document `
        -Name 'items' `
        -Value $items

    if ($updated -gt 0) {
        Save-LifecycleDocumentV1306 `
            -Document $document `
            -Path $path
    }

    $message = (
        "Reconciliação concluída: " +
        "$regularized regularizado(s), " +
        "$stillProblem ainda com problema, " +
        "$pendingValidation a validar resolução."
    )

    if ($errors.Count -gt 0) {
        $message += " $($errors.Count) consulta(s) ao Graph falharam."
    }

    return [pscustomobject]@{
        success = $true
        message = $message
        total = $items.Count
        updated = $updated
        graphChecked = $graphChecked
        regularized = $regularized
        stillProblem = $stillProblem
        pendingValidation = $pendingValidation
        errors = $errors.ToArray()
    }
}

# PATCH V13.0.7 - SAFE GRAPH MANAGED DEVICE URL
# BEGIN V13.0.8-CODEX-LIFECYCLE-COMBINED
# A última implementação V13.0.6 reconcilia apenas Grace24h. Antes de a
# substituir, guardamo-la com um nome explícito e publicamos uma função final
# que executa também a implementação preventiva preservada pelo próprio módulo.
if (Test-Path Function:\Update-NotificationLifecycleFromScan) {
    Set-Item `
        -Path Function:\Update-GraceLifecycleFromScanV1306 `
        -Value (Get-Item Function:\Update-NotificationLifecycleFromScan).ScriptBlock
}

function Update-NotificationLifecycleFromScan {
    [CmdletBinding()]
    param(
        [Alias('Rows')]
        [AllowNull()][object[]]$Devices = @(),

        [switch]$FullScan
    )

    if (-not (Get-Command Update-NotificationLifecycleFromScanLegacyV13 -ErrorAction SilentlyContinue)) {
        throw 'Reconciliação preventiva original não está disponível.'
    }

    if (-not (Get-Command Update-GraceLifecycleFromScanV1306 -ErrorAction SilentlyContinue)) {
        throw 'Reconciliação Grace24h V13.0.6 não está disponível.'
    }

    $preventiveResult = Update-NotificationLifecycleFromScanLegacyV13 `
        -Devices @($Devices) `
        -FullScan:$FullScan

    $graceResult = Update-GraceLifecycleFromScanV1306 `
        -Devices @($Devices) `
        -FullScan:$FullScan

    if ($null -eq $preventiveResult) {
        $preventiveResult = [pscustomobject]@{
            success = $true
            total = 0
        }
    }

    if ($preventiveResult -is [System.Collections.IDictionary]) {
        $preventiveResult['graceReconciliation'] = $graceResult
        $preventiveResult['combinedReconciliationVersion'] = '13.0.8'
    }
    else {
        $preventiveResult | Add-Member `
            -NotePropertyName graceReconciliation `
            -NotePropertyValue $graceResult `
            -Force

        $preventiveResult | Add-Member `
            -NotePropertyName combinedReconciliationVersion `
            -NotePropertyValue '13.0.8' `
            -Force
    }

    return $preventiveResult
}
# END V13.0.8-CODEX-LIFECYCLE-COMBINED

# BEGIN ICM ABSENCE/VACATION LIFECYCLE V1
. (Join-Path $PSScriptRoot 'absence-service.ps1')
Set-Item -Path Function:\Update-NotificationLifecycleFromScanBeforeAbsenceV1 -Value (Get-Item Function:\Update-NotificationLifecycleFromScan).ScriptBlock
function Update-NotificationLifecycleFromScan {
    [CmdletBinding()]param([Alias('Rows')][AllowNull()][object[]]$Devices=@(),[switch]$FullScan)
    $Result=Update-NotificationLifecycleFromScanBeforeAbsenceV1 -Devices @($Devices) -FullScan:$FullScan
    Update-IcmAbsenceLifecycle -Devices @($Devices)
    return $Result
}
# END ICM ABSENCE/VACATION LIFECYCLE V1
