#requires -Version 5.1
# BEGIN PREVENTIVE RECONCILIATION API V13
Set-StrictMode -Version 2.0

if (-not (Get-Command Get-PreventiveConfigV12 -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'preventive-engine.ps1')
}

if (-not (Get-Command Read-NotificationLifecycle -ErrorAction SilentlyContinue)) {
    . (Join-Path $PSScriptRoot 'notification-lifecycle-api.ps1')
}

function Add-LifecycleHistoryV13 {
    param(
        [Parameter(Mandatory)]$Item,
        [Parameter(Mandatory)][string]$Event,
        [string]$Details = '',
        [string]$ChangedBy = 'Reconciliação automática'
    )

    $history = @()

    if ($Item.PSObject.Properties['history'] -and $Item.history) {
        $history = @($Item.history)
    }

    $last = $history | Select-Object -Last 1

    if ($last -and
        [string]$last.event -eq $Event -and
        [string]$last.details -eq $Details) {
        return
    }

    $history += [pscustomobject]@{
        timestamp = (Get-Date).ToString('o')
        event = $Event
        details = $Details
        changedBy = $ChangedBy
    }

    if ($history.Count -gt 50) {
        $history = @($history | Select-Object -Last 50)
    }

    if ($Item.PSObject.Properties['history']) {
        $Item.history = $history
    }
    else {
        $Item | Add-Member -NotePropertyName history -NotePropertyValue $history
    }
}

function Get-ManagedDeviceFromGraphV13 {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$ManagedDeviceId
    )

    if (-not (Get-Command Invoke-MgGraphRequest -ErrorAction SilentlyContinue)) {
        throw 'Invoke-MgGraphRequest não está disponível. Ligue primeiro ao Microsoft Graph.'
    }

    $safeId = [uri]::EscapeDataString($ManagedDeviceId)
    $uri = "https://graph.microsoft.com/beta/deviceManagement/managedDevices/$safeId"

    try {
        $device = Invoke-MgGraphRequest `
            -Method GET `
            -Uri $uri `
            -OutputType PSObject `
            -ErrorAction Stop

        return [pscustomobject]@{
            exists = $true
            device = $device
            statusCode = 200
        }
    }
    catch {
        $message = $_.Exception.Message
        $statusCode = $null

        if ($_.Exception.PSObject.Properties['ResponseStatusCode']) {
            $statusCode = [int]$_.Exception.ResponseStatusCode
        }
        elseif ($message -match '\b404\b|NotFound|ResourceNotFound') {
            $statusCode = 404
        }

        if ($statusCode -eq 404) {
            return [pscustomobject]@{
                exists = $false
                device = $null
                statusCode = 404
            }
        }

        throw
    }
}

function Clear-LifecycleResolutionV13 {
    param([Parameter(Mandatory)]$Item)

    foreach ($name in @(
        'resolutionType',
        'resolutionConfirmedAt',
        'resolutionConfirmedBy',
        'resolutionNote',
        'removedAt',
        'removedBy'
    )) {
        Set-LifecycleValueSafe $Item $name $null
    }
}

function Invoke-PreventiveIntuneReconciliationV13 {
    [CmdletBinding()]
    param(
        [string]$ChangedBy = 'Reconciliação automática V13'
    )

    if (-not (Get-Command Invoke-MgGraphRequest -ErrorAction SilentlyContinue)) {
        throw 'Microsoft Graph não está ligado. Utilize primeiro o botão Conectar Graph/Intune.'
    }

    $data = Read-NotificationLifecycle
    $items = @($data.items)
    $config = Get-PreventiveConfigV12
    $now = Get-Date

    $summary = [ordered]@{
        total = 0
        checked = 0
        missingFromIntune = 0
        removedByTeam = 0
        regularized = 0
        stillPending = 0
        skipped = 0
        errors = 0
    }

    $results = New-Object System.Collections.Generic.List[object]

    foreach ($item in $items) {
        if ([string](Get-LifecycleValueSafe $item 'lifecycleType' 'Grace24h') -ne 'Preventive30d') {
            continue
        }

        $summary.total++

        $currentStatus = [string](Get-LifecycleValueSafe $item 'status' '')

        if ($currentStatus -in @('RemovedByUser', 'RemovedByTeam')) {
            $summary.skipped++
            continue
        }

        $managedDeviceId = [string](Get-LifecycleValueSafe $item 'managedDeviceId' '')

        if ([string]::IsNullOrWhiteSpace($managedDeviceId)) {
            $summary.skipped++

            Add-LifecycleHistoryV13 `
                -Item $item `
                -Event 'ReconciliationSkipped' `
                -Details 'Managed Device ID não disponível.' `
                -ChangedBy $ChangedBy

            continue
        }

        try {
            $lookup = Get-ManagedDeviceFromGraphV13 -ManagedDeviceId $managedDeviceId
            $summary.checked++

            if (-not $lookup.exists) {
                if (-not (Get-LifecycleValueSafe $item 'missingSince' $null)) {
                    Set-LifecycleValueSafe $item 'missingSince' $now.ToString('o')
                }

                Set-LifecycleValueSafe $item 'status' 'PendingResolutionValidation'
                Set-LifecycleValueSafe $item 'lastUpdatedAt' $now.ToString('o')
                $summary.missingFromIntune++

                Add-LifecycleHistoryV13 `
                    -Item $item `
                    -Event 'MissingFromIntune' `
                    -Details 'Dispositivo não encontrado no Intune. É necessária validação manual antes de confirmar a remoção.' `
                    -ChangedBy $ChangedBy

                $results.Add([pscustomobject]@{
                    deviceKey = Get-LifecycleValueSafe $item 'deviceKey' ''
                    deviceName = Get-LifecycleValueSafe $item 'deviceName' ''
                    email = Get-LifecycleValueSafe $item 'email' ''
                    result = 'PendingResolutionValidation'
                    message = 'Dispositivo não encontrado. Aguarda validação manual.'
                })

                continue
            }

            $device = $lookup.device
            $lastSync = Get-V12Value $device 'lastSyncDateTime'
            $info = Get-PreventiveSyncInfoV12 `
                -LastSyncValue $lastSync `
                -Config $config `
                -Now $now

            $previousStatus = [string](Get-LifecycleValueSafe $item 'status' '')
            $previousLastSync = [string](Get-LifecycleValueSafe $item 'lastSyncDateTime' '')

            Copy-DeviceToLifecycleV12 -Item $item -Device $device

            $lastSyncValue = $null
            if ($info.lastSyncDateTime) {
                $lastSyncValue = $info.lastSyncDateTime.ToString('o')
            }

            $deadlineValue = $null
            if ($info.preventiveDeadlineAt) {
                $deadlineValue = $info.preventiveDeadlineAt.ToString('o')
            }

            Set-LifecycleValueSafe $item 'lastSyncDateTime' $lastSyncValue
            Set-LifecycleValueSafe $item 'daysWithoutSync' $info.daysWithoutSync
            Set-LifecycleValueSafe $item 'preventiveDeadlineAt' $deadlineValue
            Set-LifecycleValueSafe $item 'deadlineAt' $deadlineValue
            Set-LifecycleValueSafe $item 'preventiveDaysRemaining' $info.preventiveDaysRemaining
            Set-LifecycleValueSafe $item 'preventiveStatus' $info.preventiveStatus
            Set-LifecycleValueSafe $item 'isPreventiveAlert' ([bool]$info.isPreventiveAlert)
            Set-LifecycleValueSafe $item 'lastSeenAt' $now.ToString('o')
            Set-LifecycleValueSafe $item 'missingSince' $null
            Set-LifecycleValueSafe $item 'lastUpdatedAt' $now.ToString('o')

            if (-not $info.isPreventiveAlert) {
                Set-LifecycleValueSafe $item 'status' 'Regularized'
                Set-LifecycleValueSafe $item 'regularizedAt' $now.ToString('o')
                Set-LifecycleValueSafe $item 'resolutionType' 'Regularized'
                Set-LifecycleValueSafe $item 'resolutionConfirmedAt' $now.ToString('o')
                Set-LifecycleValueSafe $item 'resolutionConfirmedBy' $ChangedBy
                Set-LifecycleValueSafe $item 'resolutionNote' 'O dispositivo voltou a comunicar com o Intune.'
                Set-LifecycleValueSafe $item 'removedAt' $null
                Set-LifecycleValueSafe $item 'removedBy' $null
                $summary.regularized++

                if ($previousStatus -ne 'Regularized' -or
                    $previousLastSync -ne [string]$lastSyncValue) {
                    Add-LifecycleHistoryV13 `
                        -Item $item `
                        -Event 'Regularized' `
                        -Details 'O dispositivo voltou a comunicar com o Intune e saiu do período preventivo.' `
                        -ChangedBy $ChangedBy
                }

                $results.Add([pscustomobject]@{
                    deviceKey = Get-LifecycleValueSafe $item 'deviceKey' ''
                    deviceName = Get-LifecycleValueSafe $item 'deviceName' ''
                    email = Get-LifecycleValueSafe $item 'email' ''
                    result = 'Regularized'
                    message = 'Dispositivo voltou a comunicar.'
                })
            }
            else {
                Clear-LifecycleResolutionV13 -Item $item
                Set-LifecycleValueSafe $item 'status' $info.preventiveStatus
                Set-LifecycleValueSafe $item 'regularizedAt' $null
                $summary.stillPending++

                if ($previousStatus -ne [string]$info.preventiveStatus -or
                    $previousLastSync -ne [string]$lastSyncValue) {
                    Add-LifecycleHistoryV13 `
                        -Item $item `
                        -Event 'Reconciled' `
                        -Details "Estado: $($info.preventiveStatus); dias sem comunicação: $($info.daysWithoutSync)." `
                        -ChangedBy $ChangedBy
                }

                $results.Add([pscustomobject]@{
                    deviceKey = Get-LifecycleValueSafe $item 'deviceKey' ''
                    deviceName = Get-LifecycleValueSafe $item 'deviceName' ''
                    email = Get-LifecycleValueSafe $item 'email' ''
                    result = $info.preventiveStatus
                    message = 'Dispositivo continua sem comunicação.'
                })
            }
        }
        catch {
            $summary.errors++

            Add-LifecycleHistoryV13 `
                -Item $item `
                -Event 'ReconciliationError' `
                -Details $_.Exception.Message `
                -ChangedBy $ChangedBy

            $results.Add([pscustomobject]@{
                deviceKey = Get-LifecycleValueSafe $item 'deviceKey' ''
                deviceName = Get-LifecycleValueSafe $item 'deviceName' ''
                email = Get-LifecycleValueSafe $item 'email' ''
                result = 'Error'
                message = $_.Exception.Message
            })
        }
    }

    $data.items = @($items)
    Save-NotificationLifecycle -Data $data

    return [pscustomobject]@{
        success = $true
        version = '13.0.0'
        message = 'Reconciliação automática concluída.'
        summary = [pscustomobject]$summary
        results = $results.ToArray()
        lifecycle = Get-NotificationLifecycleSummary
    }
}

function Invoke-PreventiveReconciliationApi {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Action,
        $Payload = $null
    )

    try {
        switch -Regex ($Action.Trim()) {
            '^(reconcilePreventiveIntune|refreshPreventiveControl|validatePreventiveResolutions)$' {
                $changedBy = 'Reconciliação automática V13'

                if ($Payload) {
                    $body = ConvertFrom-LifecyclePayloadV12 $Payload

                    if ($body -and $body.PSObject.Properties['changedBy']) {
                        $changedBy = [string]$body.changedBy
                    }
                }

                return Invoke-PreventiveIntuneReconciliationV13 -ChangedBy $changedBy
            }

            default {
                return [pscustomobject]@{
                    success = $false
                    message = "Ação de reconciliação não suportada: $Action"
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
# END PREVENTIVE RECONCILIATION API V13