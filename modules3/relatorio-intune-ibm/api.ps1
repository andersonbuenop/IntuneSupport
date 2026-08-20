param(
    $Query = $null,
    $Config = $null,
    $Body = $null
)

$ErrorActionPreference = "Stop"

function Send-Json {
    param($Obj)
    $Obj | ConvertTo-Json -Depth 80 -Compress
}

function Get-ValueSafe {
    param($Obj, [string]$Name, $Default = $null)

    if ($null -eq $Obj) { return $Default }

    try {
        if ($Obj -is [string]) {
            if ($Obj.Trim().StartsWith("{")) {
                $Obj = $Obj | ConvertFrom-Json
            }
        }

        if ($Obj -is [hashtable] -and $Obj.ContainsKey($Name)) {
            return $Obj[$Name]
        }

        try {
            $v = $Obj[$Name]
            if ($null -ne $v) { return $v }
        } catch {}

        $p = $Obj.PSObject.Properties[$Name]
        if ($p) { return $p.Value }
    }
    catch {}

    return $Default
}

function Get-ActionSafe {
    param($Query, $Body)

    $a = Get-ValueSafe $Query "action" ""

    if (-not $a) {
        $a = Get-ValueSafe $Body "action" ""
    }

    return [string]$a
}

function Connect-GraphIntune {
    Import-Module Microsoft.Graph.Authentication -ErrorAction Stop

    $ctx = Get-MgContext -ErrorAction SilentlyContinue

    if ($null -eq $ctx) {
        Connect-MgGraph -Scopes @(
            "DeviceManagementManagedDevices.Read.All",
            "Device.Read.All",
            "User.Read.All",
            "Directory.Read.All"
        ) -NoWelcome -ErrorAction Stop | Out-Null
    }

    $ctx = Get-MgContext -ErrorAction SilentlyContinue

    if ($null -eq $ctx) {
        throw "Graph/Intune nao conectado."
    }

    return $ctx
}

function Get-DeviceTipo {
    param($Device)

    $p = [string]$Device.operatingSystem
    $m = [string]$Device.model
    $n = [string]$Device.deviceName

    if ($p -like "*Android*") {
        if ($m -match "SM-X|Tab|Tablet" -or $n -match "Tab|Tablet") {
            return "Tablet"
        }
        return "Android"
    }

    if ($p -like "*iOS*") {
        if ($m -like "*iPad*" -or $n -like "*iPad*") {
            return "iPad"
        }
        return "iPhone"
    }

    if ($p -like "*macOS*" -or $p -like "*Mac*" -or $m -like "*Mac*" -or $n -like "*Mac*") {
        return "Mac"
    }

    if ($p -like "*Windows*") {
        return "Windows"
    }

    return $p
}

function Get-DevicesOnline {
    Connect-GraphIntune | Out-Null

    $Select = @(
        "id",
        "deviceName",
        "userPrincipalName",
        "userDisplayName",
        "operatingSystem",
        "osVersion",
        "complianceState",
        "managementState",
        "ownerType",
        "enrolledDateTime",
        "lastSyncDateTime",
        "manufacturer",
        "model",
        "serialNumber",
        "imei",
        "phoneNumber",
        "azureADDeviceId",
        "emailAddress",
        "isEncrypted",
        "isSupervised",
        "jailBroken",
        "deviceRegistrationState"
    ) -join ","

    $Uri = "https://graph.microsoft.com/beta/deviceManagement/managedDevices?`$select=$Select"

    $All = @()

    do {
        $R = Invoke-MgGraphRequest -Method GET -Uri $Uri -ErrorAction Stop

        if ($R.value) {
            $All += $R.value
        }

        $Uri = $R.'@odata.nextLink'
    }
    while ($Uri)

    $Now = Get-Date

    $Data = foreach ($d in $All) {
        $dias = $null

        if ($d.lastSyncDateTime) {
            $dias = [math]::Round(($Now - [datetime]$d.lastSyncDateTime).TotalDays, 0)
        }

        $tipo = Get-DeviceTipo -Device $d

        $statusCalc = "Active"
        $acao = "Nao"

        if ($d.complianceState -ne "compliant") {
            $statusCalc = "NonCompliant"
            $acao = "Sim"
        }

        if ($dias -ne $null -and $dias -ge 30) {
            $statusCalc = "Sem Sync"
            $acao = "Sim"
        }

        [pscustomobject]@{
            Utilizador              = $d.userPrincipalName
            Nome                    = $d.userDisplayName
            Device                  = $d.deviceName
            Tipo                    = $tipo
            Plataforma              = $d.operatingSystem
            Versao                  = $d.osVersion
            Origem                  = "Intune Online"
            StatusIntune            = $d.complianceState
            StatusCalculado         = $statusCalc
            ManagementState         = $d.managementState
            OwnerType               = $d.ownerType
            Fabricante              = $d.manufacturer
            Modelo                  = $d.model
            SerialNumber            = $d.serialNumber
            IMEI                    = $d.imei
            Telefone                = $d.phoneNumber
            Email                   = $d.emailAddress
            EnrolledDateTime        = $d.enrolledDateTime
            UltimoSync              = $d.lastSyncDateTime
            DiasSemSync             = $dias
            AzureADDeviceId         = $d.azureADDeviceId
            ManagedDeviceId         = $d.id
            IsEncrypted             = $d.isEncrypted
            IsSupervised            = $d.isSupervised
            JailBroken              = $d.jailBroken
            DeviceRegistrationState = $d.deviceRegistrationState
            Acao                    = $acao
        }
    }

    return @($Data)
}


function New-OutlookHtmlMail {
    param(
        [string]$To,
        [string]$Cc,
        [string]$Subject,
        [string]$Html
    )

    if ([string]::IsNullOrWhiteSpace($To)) {
        throw "Destinatario nao informado."
    }

    if ([string]::IsNullOrWhiteSpace($Subject)) {
        throw "Assunto nao informado."
    }

    if ([string]::IsNullOrWhiteSpace($Html)) {
        throw "HTML do relatorio nao informado."
    }

    $Outlook = New-Object -ComObject Outlook.Application
    $Mail = $Outlook.CreateItem(0)

        try {
        $Mail.SentOnBehalfOfName = "User.Action.Required@santander.pt"
    } catch {}

        try {
        $Mail.SentOnBehalfOfName = "User.Action.Required@santander.pt"
    } catch {}

    $Mail.To = $To
        $CcObrigatorio = "santander.enduser@santander.pt"

    if ([string]::IsNullOrWhiteSpace($Cc)) {
        $Mail.CC = $CcObrigatorio
    }
    else {
        if ($Cc -notmatch [regex]::Escape($CcObrigatorio)) {
            $Mail.CC = "$Cc;$CcObrigatorio"
        }
        else {
            $Mail.CC = $Cc
        }
    }
    $Mail.Subject = $Subject
    $Mail.HTMLBody = $Html

    $Mail.Display()

    return @{
        success = $true
        message = "Email preparado no Outlook."
        to = $To
        cc = $Cc
        subject = $Subject
    }
}


$Global:IntuneComunicadosStore = Join-Path $PSScriptRoot "data\comunicados.json"

function Get-ComunicadosStore {
    if (!(Test-Path $Global:IntuneComunicadosStore)) {
        @() | ConvertTo-Json -Depth 10 | Set-Content $Global:IntuneComunicadosStore -Encoding UTF8
    }

    try {
        $raw = Get-Content $Global:IntuneComunicadosStore -Raw
        if ([string]::IsNullOrWhiteSpace($raw)) { return @() }
        return @($raw | ConvertFrom-Json)
    }
    catch {
        return @()
    }
}

function Save-ComunicadosStore {
    param($Data)

    @($Data) | ConvertTo-Json -Depth 20 | Set-Content $Global:IntuneComunicadosStore -Encoding UTF8
}


function Ensure-ComunicadoProperties {
    param($Item)

    $defaults = @{
        Regularizado         = $false
        Removido             = $false
        DataRemocao          = $null
        QuemRemoveu          = $null
        DataRegularizacao    = $null
        QuemRegularizou      = $null
        QuemEnviou           = ""
        TotalComunicacoes    = 0
        Status               = "Comunicado"
        PrimeiraComunicacao  = $null
        UltimaComunicacao    = $null
        RemoverApos          = $null
        Email                = ""
        Utilizador           = ""
        Device               = ""
        Tipo                 = ""
        StatusIntune         = ""
        StatusCalculado      = ""
    }

    foreach ($k in $defaults.Keys) {
        if (-not ($Item.PSObject.Properties.Name -contains $k)) {
            $Item | Add-Member -NotePropertyName $k -NotePropertyValue $defaults[$k] -Force
        }
    }

    return $Item
}

function Register-Comunicado {
    param(
        [string]$ManagedDeviceId,
        [string]$Utilizador,
        [string]$Email,
        [string]$Device,
        [string]$Tipo,
        [string]$StatusIntune,
        [string]$StatusCalculado
    )

    if ([string]::IsNullOrWhiteSpace($ManagedDeviceId)) {
        throw "ManagedDeviceId nao informado."
    }

    $store = @(Get-ComunicadosStore)
    $now = Get-Date
    $deadline = $now.AddHours(24)
    $operator = Get-CurrentOperator
    $existing = $store | Where-Object { $_.ManagedDeviceId -eq $ManagedDeviceId } | Select-Object -First 1

    if ($existing) {
        $existing = Ensure-ComunicadoProperties -Item $existing
        $existing.UltimaComunicacao = $now.ToString("s")
        $existing.RemoverApos = $deadline.ToString("s")
        $existing.TotalComunicacoes = [int]$existing.TotalComunicacoes + 1
        $existing.Status = "Comunicado"
        $existing.Removido = $false
        $existing.Regularizado = $false
        $existing.QuemEnviou = $operator
    }
    else {
        $store += [pscustomobject]@{
            ManagedDeviceId = $ManagedDeviceId
            Utilizador = $Utilizador
            Email = $Email
            Device = $Device
            Tipo = $Tipo
            StatusIntune = $StatusIntune
            StatusCalculado = $StatusCalculado
            PrimeiraComunicacao = $now.ToString("s")
            UltimaComunicacao = $now.ToString("s")
            RemoverApos = $deadline.ToString("s")
            TotalComunicacoes = 1
            Status = "Comunicado"
            Removido = $false
            Regularizado = $false
            DataRemocao = $null
            DataRegularizacao = $null
            QuemRemoveu = $null
            QuemRegularizou = $null
            QuemEnviou = $operator
        }
    }

    Save-ComunicadosStore -Data $store
    return @{ success = $true; removerApos = $deadline.ToString("s") }
}

function Get-CurrentOperator {
    try {
        $context = Get-MgContext -ErrorAction SilentlyContinue
        if ($context -and $context.Account) { return [string]$context.Account }
    } catch {}
    return [Environment]::UserName
}

function Get-LifecycleStatus {
    param($Item)
    if ([bool]$Item.Regularizado) { return "Regularizado" }
    if ([bool]$Item.Removido) { return "Removido" }
    if ($Item.RemoverApos) {
        try {
            if ([datetime]$Item.RemoverApos -le (Get-Date)) { return "Pronto para remover" }
        } catch {}
    }
    return "Aguardar 24h"
}

function Get-ComunicadosResumo {
    $store = @(Get-ComunicadosStore)
    foreach ($item in $store) {
        $item = Ensure-ComunicadoProperties -Item $item
        $item.Status = Get-LifecycleStatus -Item $item
        $due = $item.Status -eq "Pronto para remover"
        $item | Add-Member -NotePropertyName DeveRemover -NotePropertyValue $due -Force
    }
    return $store
}

function Set-ComunicadoRemovido {
    param([string]$ManagedDeviceId)
    if ([string]::IsNullOrWhiteSpace($ManagedDeviceId)) { throw "ManagedDeviceId nao informado." }
    $store = @(Get-ComunicadosStore)
    $item = $store | Where-Object { $_.ManagedDeviceId -eq $ManagedDeviceId } | Select-Object -First 1
    if (-not $item) { throw "Registo de comunicado nao encontrado." }
    $item = Ensure-ComunicadoProperties -Item $item
    $item.Removido = $true
    $item.Regularizado = $false
    $item.Status = "Removido"
    $item.DataRemocao = (Get-Date).ToString("s")
    $item.QuemRemoveu = Get-CurrentOperator
    Save-ComunicadosStore -Data $store
    return @{ success = $true; status = "Removido" }
}

function Set-ComunicadoRegularizado {
    param([string]$ManagedDeviceId)
    if ([string]::IsNullOrWhiteSpace($ManagedDeviceId)) { throw "ManagedDeviceId nao informado." }
    $store = @(Get-ComunicadosStore)
    $item = $store | Where-Object { $_.ManagedDeviceId -eq $ManagedDeviceId } | Select-Object -First 1
    if (-not $item) { throw "Registo de comunicado nao encontrado." }
    $item = Ensure-ComunicadoProperties -Item $item
    $item.Regularizado = $true
    $item.Removido = $false
    $item.Status = "Regularizado"
    $item.DataRegularizacao = (Get-Date).ToString("s")
    $item.QuemRegularizou = Get-CurrentOperator
    Save-ComunicadosStore -Data $store
    return @{ success = $true; status = "Regularizado" }
}

$Action = Get-ActionSafe -Query $Query -Body $Body

try {
    switch ($Action) {
        "status" {
            $ctx = Get-MgContext -ErrorAction SilentlyContinue
            Send-Json @{ success = $true; connected = ($null -ne $ctx); account = if ($ctx) { $ctx.Account } else { $null }; tenantId = if ($ctx) { $ctx.TenantId } else { $null } }
        }
        "connect" {
            $ctx = Connect-GraphIntune
            Send-Json @{ success = $true; message = "Graph/Intune conectado com sucesso."; account = $ctx.Account; tenantId = $ctx.TenantId }
        }
        "buscar-intune" {
            $Data = @(Get-DevicesOnline)
            Send-Json @{ success = $true; total = $Data.Count; data = $Data; message = "Consulta Intune concluida." }
        }
        "preparar-email" {
            Send-Json (New-OutlookHtmlMail -To ([string](Get-ValueSafe $Body "to" "")) -Cc ([string](Get-ValueSafe $Body "cc" "")) -Subject ([string](Get-ValueSafe $Body "subject" "")) -Html ([string](Get-ValueSafe $Body "html" "")))
        }
        "registar-comunicado" {
            Send-Json (Register-Comunicado -ManagedDeviceId ([string](Get-ValueSafe $Body "managedDeviceId" "")) -Utilizador ([string](Get-ValueSafe $Body "utilizador" "")) -Email ([string](Get-ValueSafe $Body "email" "")) -Device ([string](Get-ValueSafe $Body "device" "")) -Tipo ([string](Get-ValueSafe $Body "tipo" "")) -StatusIntune ([string](Get-ValueSafe $Body "statusIntune" "")) -StatusCalculado ([string](Get-ValueSafe $Body "statusCalculado" "")))
        }
        "comunicados" { Send-Json @{ success = $true; data = @(Get-ComunicadosResumo) } }
        "marcar-removido" { Send-Json (Set-ComunicadoRemovido -ManagedDeviceId ([string](Get-ValueSafe $Body "managedDeviceId" ""))) }
        "marcar-regularizado" { Send-Json (Set-ComunicadoRegularizado -ManagedDeviceId ([string](Get-ValueSafe $Body "managedDeviceId" ""))) }
        default { Send-Json @{ success = $false; error = "Action nao reconhecida: $Action"; action = $Action; availableActions = @("status", "connect", "buscar-intune", "preparar-email", "registar-comunicado", "comunicados", "marcar-removido", "marcar-regularizado") } }
    }
}
catch {
    Send-Json @{ success = $false; action = $Action; error = $_.Exception.Message }
}
