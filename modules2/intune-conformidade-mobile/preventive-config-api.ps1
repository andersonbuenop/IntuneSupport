#requires -Version 5.1
Set-StrictMode -Version 2.0
. (Join-Path $PSScriptRoot 'preventive-engine.ps1')

function ConvertFrom-PreventivePayloadV12 {
    param($Payload)
    $v=$Payload
    if($v-is[string]){
        if([string]::IsNullOrWhiteSpace($v)){return $null}
        try{$v=[uri]::UnescapeDataString($v)}catch{}
        for($i=0;$i-lt 4;$i++){
            if(-not($v-is[string])){break}
            try{$v=$v|ConvertFrom-Json}catch{break}
        }
    }
    return $v
}

function Invoke-PreventiveConfigApi {
    param([string]$Action,$Payload=$null)
    try{
        switch -Regex ($Action.Trim()){
            '^(getPreventiveConfig|preventiveConfig)$'{
                return [pscustomobject]@{success=$true;version='12.0.0';config=Get-PreventiveConfigV12}
            }
            '^(savePreventiveConfig|updatePreventiveConfig)$'{
                $body=ConvertFrom-PreventivePayloadV12 $Payload
                if($null-eq$body){throw 'Payload da configuração não informado.'}

                $saved=Save-PreventiveConfigV12 `
                    -NotificationStartDays ([int]$body.notificationStartDays) `
                    -RemovalDays ([int]$body.removalDays) `
                    -NotificationIntervalDays ([int]$body.notificationIntervalDays)

                $recalc=$null
                if(Get-Command Recalculate-PreventiveLifecycleV12 -ErrorAction SilentlyContinue){
                    $recalc=Recalculate-PreventiveLifecycleV12
                }

                return [pscustomobject]@{
                    success=$true
                    version='12.0.0'
                    message='Prazos guardados e ciclos preventivos recalculados.'
                    config=$saved
                    reconciliation=$recalc
                }
            }
            default{
                return [pscustomobject]@{success=$false;message="Ação preventiva não suportada: $Action"}
            }
        }
    }catch{
        return [pscustomobject]@{success=$false;action=$Action;message=$_.Exception.Message}
    }
}