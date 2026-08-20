param(
    $Query = $null,
    $Config = $null
)

$ErrorActionPreference = "Stop"
$Debug = New-Object System.Collections.Generic.List[string]

function Add-Debug {
    param([string]$Msg)
    $Debug.Add("[$(Get-Date -Format 'HH:mm:ss')] $Msg") | Out-Null
}

function JsonResponse {
    param($Obj)
    $Obj | ConvertTo-Json -Depth 30
}

function Get-QueryValue {
    param(
        $QueryObject,
        [string]$Name
    )

    try {
        if ($QueryObject -and $QueryObject[$Name]) {
            return "$($QueryObject[$Name])"
        }
    } catch {}

    try {
        if ($QueryObject -and $QueryObject.AllKeys) {
            foreach ($Key in $QueryObject.AllKeys) {
                if ($Key -eq $Name) {
                    return "$(($QueryObject.GetValues($Key) | Select-Object -First 1))"
                }
            }
        }
    } catch {}

    return ""
}

function Ensure-ExchangeOnline {
    Import-Module ExchangeOnlineManagement -Force

    $Conn = Get-ConnectionInformation -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq "Connected" } |
        Select-Object -First 1

    if ($Conn) {
        Add-Debug "Exchange Online já conectado: $($Conn.UserPrincipalName)"
        return $Conn
    }

    Add-Debug "Exchange Online não conectado. A iniciar WAM..."

    Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop | Out-Null

    $Conn = Get-ConnectionInformation -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq "Connected" } |
        Select-Object -First 1

    if (-not $Conn) {
        throw "Não foi possível estabelecer ligação ao Exchange Online."
    }

    Add-Debug "Exchange Online conectado: $($Conn.UserPrincipalName)"
    return $Conn
}

function Get-ExchangeStatus {
    Import-Module ExchangeOnlineManagement -Force

    $Conn = Get-ConnectionInformation -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq "Connected" } |
        Select-Object -First 1

    if ($Conn) {
        return [PSCustomObject]@{
            connected = $true
            account = "$($Conn.UserPrincipalName)"
            state = "$($Conn.State)"
        }
    }

    return [PSCustomObject]@{
        connected = $false
        account = ""
        state = "Disconnected"
    }
}

function Enable-ArchiveOnline {
    param(
        [string]$Identity
    )

    if ([string]::IsNullOrWhiteSpace($Identity)) {
        throw "Utilizador/mailbox não informado."
    }

    $Conn = Ensure-ExchangeOnline

    $Mailbox = $null

    Add-Debug "A procurar mailbox: $Identity"

    for ($i = 1; $i -le 12; $i++) {
        $Mailbox = Get-Mailbox -Identity $Identity -ErrorAction SilentlyContinue

        if ($Mailbox) {
            Add-Debug "Mailbox encontrada: $($Mailbox.UserPrincipalName)"
            break
        }

        Add-Debug "Mailbox ainda não encontrada. Tentativa $i de 12..."
        Start-Sleep -Seconds 10
    }

    if (-not $Mailbox) {
        return [PSCustomObject]@{
            archiveEnabled = $false
            archiveStatus = "Mailbox não encontrada"
            mensagem = "Exchange Online conectado, mas a mailbox não foi encontrada/provisionada."
            user = $Identity
            exoAccount = "$($Conn.UserPrincipalName)"
        }
    }

    if ($Mailbox.ArchiveStatus -eq "Active") {
        return [PSCustomObject]@{
            archiveEnabled = $true
            archiveStatus = "Active"
            mensagem = "Arquivo Online já estava ativo."
            user = "$($Mailbox.UserPrincipalName)"
            exoAccount = "$($Conn.UserPrincipalName)"
        }
    }

    Add-Debug "A ativar Arquivo Online para $($Mailbox.UserPrincipalName)"

    Enable-Mailbox `
        -Identity $Mailbox.UserPrincipalName `
        -Archive `
        -Confirm:$false `
        -ErrorAction Stop

    Start-Sleep -Seconds 5

    $MailboxAfter = Get-Mailbox -Identity $Mailbox.UserPrincipalName -ErrorAction SilentlyContinue

    return [PSCustomObject]@{
        archiveEnabled = $true
        archiveStatus = "$($MailboxAfter.ArchiveStatus)"
        mensagem = "Arquivo Online ativado com sucesso."
        user = "$($Mailbox.UserPrincipalName)"
        exoAccount = "$($Conn.UserPrincipalName)"
    }
}

try {
    $Action = Get-QueryValue -QueryObject $Query -Name "action"
    $User = Get-QueryValue -QueryObject $Query -Name "user"

    Add-Debug "Action recebida: $Action"
    Add-Debug "Utilizador recebido: $User"

    if ($Action -eq "status") {
        $Status = Get-ExchangeStatus

        JsonResponse @{
            success = $true
            data = $Status
            debug = $Debug
        }
        return
    }

    if ($Action -eq "ativar") {
        $Result = Enable-ArchiveOnline -Identity $User

        JsonResponse @{
            success = [bool]$Result.archiveEnabled
            data = $Result
            debug = $Debug
        }
        return
    }

    JsonResponse @{
        success = $false
        error = "Action inválida: $Action"
        debug = $Debug
    }
}
catch {
    Add-Debug "Erro geral: $($_.Exception.Message)"

    JsonResponse @{
        success = $false
        error = $_.Exception.Message
        debug = $Debug
    }
}
