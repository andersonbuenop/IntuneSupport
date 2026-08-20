param(
    $Query,
    $Config,
    [string]$Body = "",
    [string]$Method = "GET"
)

function Add-MBLog {
    param([string]$Message, [string]$Level = "INFO")
    if (Get-Command Write-AppLog -ErrorAction SilentlyContinue) {
        Write-AppLog $Message $Level "MUDANCA-BALCAO"
    }
}

function New-MBError {
    param([string]$Message, [string]$Code = "VALIDATION_ERROR")
    return @{ success = $false; error = $Message; code = $Code }
}

function Test-MBUserIdentity {
    param([string]$Value)
    return -not [string]::IsNullOrWhiteSpace($Value) -and
        $Value.Length -le 160 -and
        $Value -match '^[A-Za-z0-9._%+@\\-]+$'
}

function Test-MBBalcaoNumber {
    param([string]$Value)
    return $Value -match '^\d{4}$' -and $Value -ne '0000'
}

function Get-Saudacao {
    $Hour = (Get-Date).Hour
    if ($Hour -lt 12) { return "Bom dia" }
    if ($Hour -lt 18) { return "Boa tarde" }
    return "Boa noite"
}

function Get-Assinatura {
    try {
        Import-Module ActiveDirectory -ErrorAction SilentlyContinue
        $ADUser = Get-ADUser $env:USERNAME -Properties DisplayName -ErrorAction Stop
        if ($ADUser.DisplayName) { return $ADUser.DisplayName }
    }
    catch { Add-MBLog "Falha ao obter assinatura no AD: $($_.Exception.Message)" "WARN" }

    try {
        $CurrentUser = [System.DirectoryServices.AccountManagement.UserPrincipal]::Current
        if ($CurrentUser.DisplayName) { return $CurrentUser.DisplayName }
    }
    catch { Add-MBLog "Falha ao obter assinatura local: $($_.Exception.Message)" "WARN" }

    return $env:USERNAME
}

function Resolve-Balcao {
    param([string]$Numero, [string]$Tipo)

    if (!(Test-MBBalcaoNumber $Numero)) {
        return @{ found = $false; error = "Não foi encontrada uma caixa de e-mail para o balcão de $Tipo $Numero conforme solicitado."; mailbox = $null }
    }

    $Filter = "DisplayName -like '$Numero*' -or Alias -like '$Numero*'"
    $Candidates = @(
        Get-Mailbox -Filter $Filter -ResultSize 50 -ErrorAction Stop |
            Where-Object { $_.PrimarySmtpAddress -like "*santander.pt" }
    )

    if ($Candidates.Count -eq 0) {
        return @{ found = $false; error = "Não foi encontrada uma caixa para o balcão de $Tipo $Numero."; mailbox = $null }
    }

    if ($Candidates.Count -gt 1) {
        return @{ found = $false; error = "Foram encontradas várias caixas para o balcão de $Tipo $Numero. Confirme o número."; mailbox = $null }
    }

    return @{ found = $true; error = ""; mailbox = $Candidates[0] }
}

function Test-MBFullAccess {
    param([string]$Mailbox, [string]$User)
    return $null -ne (Get-MailboxPermission -Identity $Mailbox -User $User -ErrorAction SilentlyContinue |
        Where-Object { $_.AccessRights -contains "FullAccess" -and -not $_.Deny } |
        Select-Object -First 1)
}

function Test-MBSendAs {
    param([string]$Mailbox, [string]$User)
    return $null -ne (Get-RecipientPermission -Identity $Mailbox -Trustee $User -ErrorAction SilentlyContinue |
        Where-Object { $_.AccessRights -contains "SendAs" } |
        Select-Object -First 1)
}

function New-TicketResponse {
    param([string]$User, [string]$Origem, $OrigemMailbox, [string]$Destino, $DestinoMailbox, [string[]]$Actions, [string[]]$Observations)
    $Lines = @("$(Get-Saudacao),", "", "Informamos que foram efetuadas as seguintes configurações:", "")
    if ($Actions.Count -gt 0) {
        foreach ($Action in $Actions) { $Lines += "• $Action" }
    }
    else {
        $Lines += "• Não foram efetuadas alterações de permissões."
    }
    if ($Observations.Count -gt 0) {
        $Lines += ""
        $Lines += "Observações:"
        foreach ($Observation in $Observations) { $Lines += "• $Observation" }
    }
    $Lines += ""
    $Lines += "A replicação das permissões poderá demorar até 48 horas a concluir."
    $Lines += ""
    $Lines += "Atenciosamente,"
    $Lines += ""
    $Lines += (Get-Assinatura)
    return ($Lines -join "`r`n")
}

try {
    Import-Module ExchangeOnlineManagement -ErrorAction Stop
    $Connection = Get-ConnectionInformation -ErrorAction Stop | Select-Object -First 1
    if (!$Connection) { throw "Não existe sessão Exchange Online ativa." }
}
catch {
    Add-MBLog "Exchange indisponível: $($_.Exception.Message)" "WARN"
    return (New-MBError "Exchange Online não conectado. Ligue no dashboard primeiro." "EXCHANGE_NOT_CONNECTED")
}

$Action = [string]$Query["action"]

if ($Action -eq "validateUser") {
    $User = ([string]$Query["user"]).Trim()
    if (!(Test-MBUserIdentity $User)) { return (New-MBError "Formato de utilizador inválido.") }
    try {
        $Mailbox = Get-Mailbox -Identity $User -ErrorAction Stop
        return @{ success = $true; displayName = [string]$Mailbox.DisplayName; email = $Mailbox.PrimarySmtpAddress.ToString() }
    }
    catch { return (New-MBError "Utilizador não encontrado no Exchange." "USER_NOT_FOUND") }
}

if ($Action -eq "validateBalcao") {
    $Numero = ([string]$Query["numero"]).Trim()
    $Tipo = ([string]$Query["tipo"]).Trim()
    if ($Tipo -notin @("origem", "destino")) { return (New-MBError "Tipo de balcão inválido.") }
    try {
        $Result = Resolve-Balcao -Numero $Numero -Tipo $Tipo
        if (!$Result.found) { return (New-MBError $Result.error "BRANCH_NOT_FOUND") }
        return @{ success = $true; displayName = [string]$Result.mailbox.DisplayName; email = $Result.mailbox.PrimarySmtpAddress.ToString() }
    }
    catch { return (New-MBError $_.Exception.Message "EXCHANGE_QUERY_ERROR") }
}

if ($Action -ne "execute") { return (New-MBError "Ação inválida." "INVALID_ACTION") }
if ($Method.ToUpperInvariant() -ne "POST") { return (New-MBError "A execução requer o método POST." "METHOD_NOT_ALLOWED") }
if ([string]::IsNullOrWhiteSpace($Body) -or $Body.Length -gt 16384) { return (New-MBError "Corpo do pedido ausente ou demasiado grande.") }

try { $Payload = $Body | ConvertFrom-Json -ErrorAction Stop }
catch { return (New-MBError "O corpo do pedido não contém JSON válido.") }

$User = ([string]$Payload.user).Trim()
$Origem = ([string]$Payload.origem).Trim()
$Destino = ([string]$Payload.destino).Trim()

if (!(Test-MBUserIdentity $User)) { return (New-MBError "Formato de utilizador inválido.") }
if ($Origem -eq $Destino) { return (New-MBError "O balcão de origem e o de destino devem ser diferentes.") }

$AddedDestinationFull = $false
$AddedDestinationSendAs = $false
$Actions = New-Object System.Collections.ArrayList
$Observations = New-Object System.Collections.ArrayList

try {
    Add-MBLog "VALIDAÇÃO | User=$User | Origem=$Origem | Destino=$Destino"
    $UserMailbox = Get-Mailbox -Identity $User -ErrorAction Stop
    $UserIdentity = $UserMailbox.PrimarySmtpAddress.ToString()
    $OrigemResult = Resolve-Balcao -Numero $Origem -Tipo "origem"
    $DestinoResult = Resolve-Balcao -Numero $Destino -Tipo "destino"
    $OrigemMailbox = if ($OrigemResult.found) { $OrigemResult.mailbox } else { $null }
    $DestinoMailbox = if ($DestinoResult.found) { $DestinoResult.mailbox } else { $null }
    $OrigemIdentity = if ($OrigemMailbox) { $OrigemMailbox.PrimarySmtpAddress.ToString() } else { "" }
    $DestinoIdentity = if ($DestinoMailbox) { $DestinoMailbox.PrimarySmtpAddress.ToString() } else { "" }
    if (!$OrigemResult.found) { [void]$Observations.Add($OrigemResult.error) }
    if (!$DestinoResult.found) { [void]$Observations.Add($DestinoResult.error) }

    # Adiciona primeiro o destino. Se falhar, a origem permanece intacta.
    if ($DestinoMailbox) {
        if (!(Test-MBFullAccess -Mailbox $DestinoIdentity -User $UserIdentity)) {
            Add-MailboxPermission -Identity $DestinoIdentity -User $UserIdentity -AccessRights FullAccess -InheritanceType All -AutoMapping:$false -Confirm:$false -ErrorAction Stop | Out-Null
            $AddedDestinationFull = $true
        }
        [void]$Actions.Add("Adicionado o acesso FullAccess ao balcão de destino $Destino ($DestinoIdentity) para $UserIdentity")

        if (!(Test-MBSendAs -Mailbox $DestinoIdentity -User $UserIdentity)) {
            Add-RecipientPermission -Identity $DestinoIdentity -Trustee $UserIdentity -AccessRights SendAs -Confirm:$false -ErrorAction Stop | Out-Null
            $AddedDestinationSendAs = $true
        }
        [void]$Actions.Add("Adicionada a permissão SendAs no balcão de destino $Destino ($DestinoIdentity) para $UserIdentity")
    }

    if ($OrigemMailbox) {
        if (Test-MBFullAccess -Mailbox $OrigemIdentity -User $UserIdentity) {
            Remove-MailboxPermission -Identity $OrigemIdentity -User $UserIdentity -AccessRights FullAccess -InheritanceType All -Confirm:$false -ErrorAction Stop | Out-Null
            [void]$Actions.Add("Removido o acesso FullAccess ao balcão de origem $Origem ($OrigemIdentity) para $UserIdentity")
        }
        else { [void]$Observations.Add("O utilizador não possuía acesso FullAccess no balcão de origem $Origem.") }

        if (Test-MBSendAs -Mailbox $OrigemIdentity -User $UserIdentity) {
            Remove-RecipientPermission -Identity $OrigemIdentity -Trustee $UserIdentity -AccessRights SendAs -Confirm:$false -ErrorAction Stop | Out-Null
            [void]$Actions.Add("Removida a permissão SendAs no balcão de origem $Origem ($OrigemIdentity) para $UserIdentity")
        }
        else { [void]$Observations.Add("O utilizador não possuía permissão SendAs no balcão de origem $Origem.") }
    }

    $TicketResponse = New-TicketResponse -User $User -Origem $Origem -OrigemMailbox $OrigemMailbox -Destino $Destino -DestinoMailbox $DestinoMailbox -Actions @($Actions) -Observations @($Observations)
    Add-MBLog "SUCESSO | User=$UserIdentity | Origem=$OrigemIdentity | Destino=$DestinoIdentity"
    $Message = if ($Observations.Count -gt 0) { "Processo concluído com observações" } else { "Mudança de balcão processada" }
    return @{ success = $true; message = $Message; user = $UserIdentity; origem = $Origem; destino = $Destino; actions = @($Actions); observacoes = @($Observations); ticketResponse = $TicketResponse }
}
catch {
    $Failure = $_.Exception.Message
    Add-MBLog "ERRO | User=$User | Origem=$Origem | Destino=$Destino | $Failure" "ERROR"

    # Reverte apenas permissões que esta execução adicionou no destino.
    try {
        if ($AddedDestinationSendAs -and $DestinoIdentity) {
            Remove-RecipientPermission -Identity $DestinoIdentity -Trustee $UserIdentity -AccessRights SendAs -Confirm:$false -ErrorAction Stop | Out-Null
        }
        if ($AddedDestinationFull -and $DestinoIdentity) {
            Remove-MailboxPermission -Identity $DestinoIdentity -User $UserIdentity -AccessRights FullAccess -InheritanceType All -Confirm:$false -ErrorAction Stop | Out-Null
        }
    }
    catch { Add-MBLog "Falha no rollback: $($_.Exception.Message)" "ERROR" }

    return @{ success = $false; error = $Failure; code = "EXECUTION_FAILED"; user = $User; origem = $Origem; destino = $Destino }
}
