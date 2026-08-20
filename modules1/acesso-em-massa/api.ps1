param(
    $Query,
    $Config,
    [string]$Body = "",
    [string]$Method = "GET"
)

$ErrorActionPreference = "Stop"
$Logs = [System.Collections.Generic.List[string]]::new()

function Add-AMLog {
    param([string]$Message)
    $Logs.Add("[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message") | Out-Null
}

function New-AMResponse {
    param(
        [bool]$Success,
        [hashtable]$Data = @{}
    )
    $response = [ordered]@{ success = $Success }
    foreach ($item in $Data.GetEnumerator()) { $response[$item.Key] = $item.Value }
    $response.logs = @($Logs)
    return [pscustomobject]$response
}

function Get-AMOperator {
    $sam = [string]$env:USERNAME
    $result = [ordered]@{ DisplayName = $sam; Email = ""; SamAccountName = $sam }

    try {
        Import-Module ActiveDirectory -ErrorAction SilentlyContinue
        if (Get-Command Get-ADUser -ErrorAction SilentlyContinue) {
            $adUser = Get-ADUser -Identity $sam -Properties DisplayName, Mail -ErrorAction SilentlyContinue
            if ($adUser) {
                if ($adUser.DisplayName) { $result.DisplayName = [string]$adUser.DisplayName }
                if ($adUser.Mail) { $result.Email = [string]$adUser.Mail }
                return [pscustomobject]$result
            }
        }
    }
    catch {}

    try {
        $escapedSam = $sam.Replace("\", "\5c").Replace("*", "\2a").Replace("(", "\28").Replace(")", "\29")
        $searcher = [DirectoryServices.DirectorySearcher]::new()
        $searcher.Filter = "(&(objectCategory=person)(objectClass=user)(sAMAccountName=$escapedSam))"
        [void]$searcher.PropertiesToLoad.Add("displayName")
        [void]$searcher.PropertiesToLoad.Add("mail")
        $found = $searcher.FindOne()
        if ($found) {
            if ($found.Properties["displayname"].Count -gt 0) { $result.DisplayName = [string]$found.Properties["displayname"][0] }
            if ($found.Properties["mail"].Count -gt 0) { $result.Email = [string]$found.Properties["mail"][0] }
        }
    }
    catch {}

    return [pscustomobject]$result
}

function Import-AMExchangeModule {
    Import-Module ExchangeOnlineManagement -ErrorAction Stop
}

function Get-AMExchangeConnection {
    if (!(Get-Command Get-ConnectionInformation -ErrorAction SilentlyContinue)) { return $null }
    return Get-ConnectionInformation -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq "Connected" -or [string]::IsNullOrWhiteSpace([string]$_.State) } |
        Select-Object -First 1
}

function Assert-AMExchangeConnection {
    $connection = Get-AMExchangeConnection
    if (!$connection) { throw "Nao existe sessao ativa no Exchange Online. Clique primeiro em Conectar Exchange Online." }
    Add-AMLog "Sessao Exchange ativa: $($connection.UserPrincipalName)"
    return $connection
}

function Connect-AMExchange {
    param([string]$AdminUser)
    Import-AMExchangeModule
    Add-AMLog "A iniciar conexao Exchange Online via WAM..."
    if ([string]::IsNullOrWhiteSpace($AdminUser)) {
        Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop
    }
    else {
        Connect-ExchangeOnline -UserPrincipalName $AdminUser -ShowBanner:$false -ErrorAction Stop
    }
    [void](Assert-AMExchangeConnection)
    Add-AMLog "Conectado ao Exchange Online com sucesso."
}

function Test-AMFullAccessTarget {
    param($Recipient)
    $allowedTypes = @("UserMailbox", "SharedMailbox", "RoomMailbox", "EquipmentMailbox", "DiscoveryMailbox")
    return [string]$Recipient.RecipientTypeDetails -in $allowedTypes
}

function Test-AMFullAccessExisting {
    param([string]$Mailbox, [string]$User)
    $permissions = @(Get-MailboxPermission -Identity $Mailbox -User $User -ErrorAction Stop)
    return [bool]($permissions | Where-Object {
        !$_.IsInherited -and !$_.Deny -and @($_.AccessRights) -contains "FullAccess"
    } | Select-Object -First 1)
}

function Test-AMSendAsExisting {
    param([string]$Mailbox, [string]$User)
    $permissions = @(Get-RecipientPermission -Identity $Mailbox -Trustee $User -ErrorAction Stop)
    return [bool]($permissions | Where-Object {
        @($_.AccessRights) -contains "SendAs" -and !$_.Deny
    } | Select-Object -First 1)
}

function Invoke-AMFullAccess {
    param([string]$Operation, [string]$Mailbox, [string]$User, [bool]$AutoMapping)
    $exists = Test-AMFullAccessExisting -Mailbox $Mailbox -User $User

    if ($Operation -eq "add") {
        if ($exists) { Add-AMLog "FullAccess ja existe. Ignorado."; return "ignored" }
        Add-MailboxPermission -Identity $Mailbox -User $User -AccessRights FullAccess -InheritanceType All -AutoMapping:$AutoMapping -Confirm:$false -ErrorAction Stop | Out-Null
        Add-AMLog "FullAccess adicionado com sucesso. AutoMapping=$AutoMapping"
        return "ok"
    }

    if (!$exists) { Add-AMLog "FullAccess nao existe. Ignorado."; return "ignored" }
    Remove-MailboxPermission -Identity $Mailbox -User $User -AccessRights FullAccess -InheritanceType All -Confirm:$false -ErrorAction Stop | Out-Null
    Add-AMLog "FullAccess removido com sucesso."
    return "ok"
}

function Invoke-AMSendAs {
    param([string]$Operation, [string]$Mailbox, [string]$User)
    $exists = Test-AMSendAsExisting -Mailbox $Mailbox -User $User

    if ($Operation -eq "add") {
        if ($exists) { Add-AMLog "SendAs ja existe. Ignorado."; return "ignored" }
        Add-RecipientPermission -Identity $Mailbox -Trustee $User -AccessRights SendAs -Confirm:$false -ErrorAction Stop | Out-Null
        Add-AMLog "SendAs adicionado com sucesso."
        return "ok"
    }

    if (!$exists) { Add-AMLog "SendAs nao existe. Ignorado."; return "ignored" }
    Remove-RecipientPermission -Identity $Mailbox -Trustee $User -AccessRights SendAs -Confirm:$false -ErrorAction Stop | Out-Null
    Add-AMLog "SendAs removido com sucesso."
    return "ok"
}

try {
    Add-AMLog "Iniciando modulo Acesso em Massa. Metodo=$Method"
    if (([string]$Method).ToUpperInvariant() -ne "POST") {
        throw "Esta API requer o método POST."
    }
    if ([string]::IsNullOrWhiteSpace($Body)) { throw "Body JSON vazio." }

    try { $payload = $Body | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "Body JSON invalido: $($_.Exception.Message)" }

    $action = [string]$payload.action
    if ([string]::IsNullOrWhiteSpace($action)) { throw "Acao nao informada." }

    if ($action -eq "current-operator") {
        return New-AMResponse -Success $true -Data @{ operator = Get-AMOperator }
    }

    if ($action -eq "exchange-status") {
        Import-AMExchangeModule
        $connection = Get-AMExchangeConnection
        return New-AMResponse -Success $true -Data @{
            connected = [bool]$connection
            account = if ($connection) { [string]$connection.UserPrincipalName } else { "" }
        }
    }

    if ($action -eq "connect-exchange") {
        Connect-AMExchange -AdminUser ([string]$payload.adminUser)
        return New-AMResponse -Success $true
    }

    if ($action -eq "consultar-identidade") {
        Import-AMExchangeModule
        [void](Assert-AMExchangeConnection)
        $value = ([string]$payload.valor).Trim()
        if ([string]::IsNullOrWhiteSpace($value)) { throw "Valor vazio para consulta." }

        $result = [ordered]@{
            encontrado = $false
            valor = $value
            tipoConsulta = [string]$payload.tipoConsulta
            nome = ""
            email = ""
            recipientTypeDetails = ""
            mensagem = "Nao encontrado"
        }
        try {
            $recipient = Get-Recipient -Identity $value -ErrorAction Stop
            $result.encontrado = $true
            $result.nome = [string]$recipient.DisplayName
            $result.email = [string]$recipient.PrimarySmtpAddress
            $result.recipientTypeDetails = [string]$recipient.RecipientTypeDetails
            $result.mensagem = "Encontrado"
        }
        catch { Add-AMLog "Destinatario nao encontrado: $value" }

        return New-AMResponse -Success $true -Data @{ resultado = [pscustomobject]$result }
    }

    if ($action -ne "executar") { throw "Acao invalida: $action" }
    Import-AMExchangeModule
    [void](Assert-AMExchangeConnection)

    $operation = ([string]$payload.operacao).Trim()
    $accessType = ([string]$payload.tipoAcesso).Trim()
    $autoMapping = ([string]$payload.autoMapping).Trim().ToLowerInvariant() -eq "true"
    $rows = @($payload.linhas)

    if ($operation -notin @("add", "remove")) { throw "Operacao invalida: $operation" }
    if ($accessType -notin @("FullAccess", "SendAs", "FullAccessSendAs")) { throw "Tipo de acesso invalido: $accessType" }
    if ($rows.Count -eq 0) { throw "Nenhuma linha valida foi recebida." }
    if ($rows.Count -gt 500) { throw "O limite por execucao e de 500 linhas." }

    $results = [System.Collections.Generic.List[object]]::new()
    $totalOk = 0
    $totalError = 0
    $totalIgnored = 0
    $lineNumber = 0

    foreach ($row in $rows) {
        $lineNumber++
        $user = ([string]$row.user).Trim()
        $mailbox = ([string]$row.mailbox).Trim()
        $lineResult = [ordered]@{
            linha = $lineNumber; user = $user; mailbox = $mailbox
            fullAccess = "not-requested"; sendAs = "not-requested"
            success = $true; error = ""
        }

        Add-AMLog "Linha $lineNumber | Utilizador=$user | Destino=$mailbox"
        try {
            if ([string]::IsNullOrWhiteSpace($user) -or [string]::IsNullOrWhiteSpace($mailbox)) { throw "Utilizador ou destino vazio." }
            [void](Get-Recipient -Identity $user -ErrorAction Stop)
            $target = Get-Recipient -Identity $mailbox -ErrorAction Stop

            if ($accessType -in @("FullAccess", "FullAccessSendAs")) {
                if (!(Test-AMFullAccessTarget -Recipient $target)) {
                    $lineResult.fullAccess = "error"
                    $lineResult.success = $false
                    $lineResult.error += "FullAccess: o destino e '$($target.RecipientTypeDetails)', nao uma mailbox. "
                    $totalError++
                }
                else {
                    try {
                        $status = Invoke-AMFullAccess -Operation $operation -Mailbox $mailbox -User $user -AutoMapping $autoMapping
                        $lineResult.fullAccess = $status
                        if ($status -eq "ok") { $totalOk++ } else { $totalIgnored++ }
                    }
                    catch {
                        $lineResult.fullAccess = "error"; $lineResult.success = $false
                        $lineResult.error += "FullAccess: $($_.Exception.Message) "
                        $totalError++
                    }
                }
            }

            if ($accessType -in @("SendAs", "FullAccessSendAs")) {
                try {
                    $status = Invoke-AMSendAs -Operation $operation -Mailbox $mailbox -User $user
                    $lineResult.sendAs = $status
                    if ($status -eq "ok") { $totalOk++ } else { $totalIgnored++ }
                }
                catch {
                    $lineResult.sendAs = "error"; $lineResult.success = $false
                    $lineResult.error += "SendAs: $($_.Exception.Message) "
                    $totalError++
                }
            }
        }
        catch {
            $lineResult.success = $false
            $lineResult.error = $_.Exception.Message
            $totalError++
        }
        $lineResult.error = $lineResult.error.Trim()
        $results.Add([pscustomobject]$lineResult) | Out-Null
    }

    Add-AMLog "Concluido | OK=$totalOk | Ignorados=$totalIgnored | Erros=$totalError"
    return New-AMResponse -Success $true -Data @{
        totalOk = $totalOk; totalErro = $totalError; totalIgnorado = $totalIgnored
        resultados = @($results)
    }
}
catch {
    Add-AMLog "ERRO GERAL: $($_.Exception.Message)"
    return New-AMResponse -Success $false -Data @{ error = $_.Exception.Message }
}
