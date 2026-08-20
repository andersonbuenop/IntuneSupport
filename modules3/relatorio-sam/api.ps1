param(
    $Query = $null,
    $Config = $null,
    $Body = $null,
    $Method = "GET"
)

$ErrorActionPreference = "Stop"

$ModuleRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $ModuleRoot "config.json"

function Send-Json {
    param($Obj)
    $Obj | ConvertTo-Json -Depth 40 -Compress
}

function Convert-Payload {
    param($RawPayload)

    if ($null -eq $RawPayload) { return [PSCustomObject]@{} }
    if ($RawPayload -isnot [string]) { return $RawPayload }

    try { $decoded = [System.Uri]::UnescapeDataString("$RawPayload") }
    catch { $decoded = "$RawPayload" }

    try { return $decoded | ConvertFrom-Json }
    catch { return [PSCustomObject]@{} }
}

function Get-RequestPayload {
    param($QueryPayload, $RequestBody)

    if (-not [string]::IsNullOrWhiteSpace([string]$RequestBody)) {
        try { return $RequestBody | ConvertFrom-Json -ErrorAction Stop }
        catch { throw "O corpo do pedido não contém JSON válido." }
    }

    return Convert-Payload $QueryPayload
}

function Get-SamUsers {
    param($Values, [switch]$AllowEmpty)

    $users = @($Values) |
        ForEach-Object { ([string]$_).Trim().ToUpperInvariant() } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Sort-Object -Unique

    if (-not $AllowEmpty -and $users.Count -eq 0) { throw "Lista SAM vazia." }
    if ($users.Count -gt 500) { throw "A lista SAM não pode exceder 500 utilizadores." }

    $invalidUsers = @($users | Where-Object { $_ -notmatch '^S\d{6}$' })
    if ($invalidUsers.Count -gt 0) {
        throw "Identificador(es) SAM inválido(s): $($invalidUsers -join ', '). Utilize o formato S seguido de 6 dígitos."
    }

    return $users
}

function Assert-Method {
    param([string[]]$Allowed)

    if ($Allowed -notcontains ([string]$Method).ToUpperInvariant()) {
        throw "Método HTTP inválido para esta operação."
    }
}

function Get-Saudacao {
    $hora = (Get-Date).Hour
    if ($hora -ge 0 -and $hora -le 12) { return "Bom dia" }
    elseif ($hora -gt 12 -and $hora -lt 18) { return "Boa tarde" }
    else { return "Boa noite" }
}

function Get-TipoDispositivo {
    param([string]$os)

    $osLower = "$os".ToLower()

    if ($osLower -match "iphone|ipad|ios|android") { return "movel" }
    if ($osLower -match "windows|macos|mac os") { return "estacao" }

    return "desconhecido"
}

function Generate-FormattedReport {
    param($Dados)

    if (-not $Dados -or $Dados.Count -eq 0) { return "" }

    $usuarios = $Dados | Group-Object User

    $report = "$(Get-Saudacao),`r`n`r`n"
    $report += "De acordo com a solicitação, seguem as informações dos dispositivos SAM encontrados no Intune:`r`n`r`n"

    foreach ($usuario in $usuarios) {
        $userId = $usuario.Name
        $primeiro = $usuario.Group | Select-Object -First 1

        $report += "Utilizador: $userId - $($primeiro.Nome)`r`n"

        $moveis = $usuario.Group | Where-Object { (Get-TipoDispositivo $_.SO) -eq "movel" }
        $estacoes = $usuario.Group | Where-Object { (Get-TipoDispositivo $_.SO) -eq "estacao" }

        if ($moveis.Count -gt 0) {
            $report += "  Dispositivos móveis:`r`n"
            foreach ($d in $moveis) {
                $report += "    - $($d.Modelo) ($($d.SO)) - Versão: $($d.Versao) - Compliance: $($d.Compliance) - Último Sync: $($d.UltimoSync)`r`n"
            }
        }

        if ($estacoes.Count -gt 0) {
            $report += "  Estações de trabalho:`r`n"
            foreach ($d in $estacoes) {
                $report += "    - $($d.Modelo) ($($d.SO)) - Versão: $($d.Versao) - Compliance: $($d.Compliance) - Último Sync: $($d.UltimoSync)`r`n"
            }
        }

        if ($moveis.Count -eq 0 -and $estacoes.Count -eq 0) {
            $report += "  Nenhum dispositivo encontrado.`r`n"
        }

        $report += "`r`n"
    }

    $report += "Atenciosamente,`r`nIT Santander Portugal"
    return $report
}

function Ensure-GraphModule {
    Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
    Import-Module Microsoft.Graph.DeviceManagement -ErrorAction Stop
}

try {
    $Action = [string]$Query["action"]
    $PayloadRaw = [string]$Query["payload"]
    $PayloadObj = Get-RequestPayload -QueryPayload $PayloadRaw -RequestBody $Body

    switch ($Action) {
        "get-config" {
            Assert-Method -Allowed @("GET")
            if (!(Test-Path $ConfigPath)) {
                @{
                    usuariosSAM = @(
                        "S800384",
                        "S800922",
                        "S800784",
                        "S300810",
                        "S611946",
                        "S800900",
                        "S800393",
                        "S800359"
                    )
                } | ConvertTo-Json -Depth 10 | Set-Content $ConfigPath -Encoding UTF8
            }

            $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json

            Send-Json @{
                success = $true
                module = "relatorio-sam"
                usuariosSAM = @($cfg.usuariosSAM)
            }
        }

        "save-config" {
            Assert-Method -Allowed @("POST")
            $usuarios = @(Get-SamUsers -Values $PayloadObj.usuariosSAM -AllowEmpty)

            @{ usuariosSAM = $usuarios } |
                ConvertTo-Json -Depth 10 |
                Set-Content $ConfigPath -Encoding UTF8

            Send-Json @{
                success = $true
                module = "relatorio-sam"
                usuariosSAM = $usuarios
            }
        }

        "connect-graph" {
            Assert-Method -Allowed @("POST")
            Ensure-GraphModule

            $Scopes = @(
                "DeviceManagementManagedDevices.Read.All"
            )

            Connect-MgGraph -Scopes $Scopes -NoWelcome | Out-Null
            $ctx = Get-MgContext

            Send-Json @{
                success = $true
                module = "relatorio-sam"
                message = "Graph conectado com sucesso: $($ctx.Account)"
                account = "$($ctx.Account)"
                tenantId = "$($ctx.TenantId)"
                scopes = @($ctx.Scopes)
            }
        }

        "consultar-intune" {
            Assert-Method -Allowed @("POST")
            Ensure-GraphModule

            $ctx = Get-MgContext
            if (-not $ctx) {
                throw "Graph não conectado. Clique primeiro em Conectar Graph/Intune."
            }

            $usuariosSAM = @(Get-SamUsers -Values $PayloadObj.usuariosSAM)
            $usuariosLookup = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
            foreach ($usuarioSAM in $usuariosSAM) { [void]$usuariosLookup.Add($usuarioSAM) }

            $allDevices = Get-MgDeviceManagementManagedDevice -All -Property "id,deviceName,userPrincipalName,userDisplayName,emailAddress,operatingSystem,model,osVersion,complianceState,lastSyncDateTime"

            $dados = foreach ($d in $allDevices) {
                $upn = "$($d.UserPrincipalName)"
                $userId = ($upn -replace "@.*", "").Trim().ToUpper()

                if ($usuariosLookup.Contains($userId)) {
                    [PSCustomObject]@{
                        User       = $userId
                        Nome       = "$($d.UserDisplayName)"
                        Email      = "$($d.EmailAddress)"
                        SO         = "$($d.OperatingSystem)"
                        Modelo     = "$($d.Model)"
                        Versao     = "$($d.OsVersion)"
                        Compliance = "$($d.ComplianceState)"
                        UltimoSync = if ($d.LastSyncDateTime) { ([datetime]$d.LastSyncDateTime).ToString("dd/MM/yyyy HH:mm") } else { "" }
                    }
                }
            }

            $dados = @($dados)
            $report = Generate-FormattedReport -Dados $dados

            Send-Json @{
                success = $true
                module = "relatorio-sam"
                dados = $dados
                report = $report
                summary = @{
                    users = @($dados | Select-Object -ExpandProperty User -Unique).Count
                    devices = $dados.Count
                    mobile = @($dados | Where-Object { (Get-TipoDispositivo $_.SO) -eq "movel" }).Count
                    workstations = @($dados | Where-Object { (Get-TipoDispositivo $_.SO) -eq "estacao" }).Count
                }
            }
        }

        default {
            Send-Json @{
                success = $false
                module = "relatorio-sam"
                message = "Action inválida: $Action"
            }
        }
    }
}
catch {
    Send-Json @{
        success = $false
        module = "relatorio-sam"
        message = $_.Exception.Message
    }
}
