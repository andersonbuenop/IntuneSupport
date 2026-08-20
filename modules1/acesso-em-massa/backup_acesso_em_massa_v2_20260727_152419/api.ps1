param(
    $Query = $null,
    $Config = $null,
    $Body = $null
)

$ErrorActionPreference = "Stop"
$Logs = New-Object System.Collections.Generic.List[string]

function Add-Log {
    param([string]$Msg)
    $Logs.Add("[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Msg") | Out-Null
}

function JsonResponse {
    param($Obj)
    $Obj | ConvertTo-Json -Depth 40
}

function Get-ValueSafe {
    param($Obj, [string]$Name)

    if (-not $Obj) { return $null }

    try {
        if ($Obj -is [System.Collections.IDictionary]) {
            if ($Obj.Contains($Name)) { return $Obj[$Name] }
            if ($Obj.ContainsKey($Name)) { return $Obj[$Name] }
        }
    } catch {}

    try {
        $v = $Obj[$Name]
        if ($null -ne $v) { return $v }
    } catch {}

    try {
        $p = $Obj.PSObject.Properties[$Name]
        if ($p) { return $p.Value }
    } catch {}

    try { return $Obj.$Name } catch {}
    return $null
}

function Convert-PayloadToObject {
    param($Payload)

    if (-not $Payload) { return $null }
    if ($Payload -isnot [string]) { return $Payload }

    $text = "$Payload"
    try { $text = [System.Uri]::UnescapeDataString($text) } catch {}
    return ($text | ConvertFrom-Json)
}

function Get-RequestPayload {
    param($Query, $Config, $Body)

    if ($Body) { return $Body }

    foreach ($source in @($Query, $Config)) {
        foreach ($name in @("payload", "Payload", "body", "Body")) {
            $value = Get-ValueSafe -Obj $source -Name $name
            if ($value) { return $value }
        }
    }

    $queryFromConfig = Get-ValueSafe -Obj $Config -Name "Query"
    if ($queryFromConfig) {
        $value = Get-ValueSafe -Obj $queryFromConfig -Name "payload"
        if ($value) { return $value }
    }

    if ($Query -is [string] -and $Query.Trim().StartsWith("{")) {
        return $Query
    }

    return $null
}

function Get-CurrentOperator {
    $sam = $env:USERNAME
    $result = @{
        DisplayName = $sam
        Email = ""
        SamAccountName = $sam
    }

    try {
        Import-Module ActiveDirectory -ErrorAction SilentlyContinue
        if (Get-Command Get-ADUser -ErrorAction SilentlyContinue) {
            $adUser = Get-ADUser $sam -Properties DisplayName, Mail -ErrorAction SilentlyContinue
            if ($adUser) {
                if ($adUser.DisplayName) { $result.DisplayName = "$($adUser.DisplayName)" }
                if ($adUser.Mail) { $result.Email = "$($adUser.Mail)" }
                return $result
            }
        }
    } catch {}

    try {
        $searcher = New-Object DirectoryServices.DirectorySearcher
        $searcher.Filter = "(&(objectCategory=person)(objectClass=user)(sAMAccountName=$sam))"
        $searcher.PropertiesToLoad.Add("displayName") | Out-Null
        $searcher.PropertiesToLoad.Add("mail") | Out-Null
        $found = $searcher.FindOne()

        if ($found) {
            if ($found.Properties["displayname"].Count -gt 0) {
                $result.DisplayName = "$($found.Properties["displayname"][0])"
            }
            if ($found.Properties["mail"].Count -gt 0) {
                $result.Email = "$($found.Properties["mail"][0])"
            }
        }
    } catch {}

    return $result
}

function Get-ExchangeConnection {
    try {
        if (Get-Command Get-ConnectionInformation -ErrorAction SilentlyContinue) {
            return Get-ConnectionInformation -ErrorAction SilentlyContinue |
                Where-Object { "$($_.State)" -eq "Connected" -or -not $_.State } |
                Select-Object -First 1
        }
    } catch {}

    return $null
}

function Test-ExchangeSession {
    $connection = Get-ExchangeConnection
    if ($connection) {
        Add-Log "Sessão Exchange ativa: $($connection.UserPrincipalName)"
        return $true
    }
    return $false
}

function Connect-ExchangeWAM {
    param([string]$AdminUser)

    Import-Module ExchangeOnlineManagement -ErrorAction Stop
    Add-Log "A iniciar conexão Exchange Online via WAM..."

    if ([string]::IsNullOrWhiteSpace($AdminUser)) {
        Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop
    } else {
        Connect-ExchangeOnline -UserPrincipalName $AdminUser -ShowBanner:$false -ErrorAction Stop
    }

    if (-not (Test-ExchangeSession)) {
        throw "A conexão foi chamada, mas não foi encontrada sessão ativa."
    }

    Add-Log "Conectado ao Exchange Online com sucesso."
}

function Test-FullAccessExisting {
    param(
        [string]$Mailbox,
        [string]$User
    )

    $permissions = @(Get-MailboxPermission -Identity $Mailbox -User $User -ErrorAction SilentlyContinue)
    return [bool]($permissions | Where-Object {
        -not $_.IsInherited -and
        -not $_.Deny -and
        (@($_.AccessRights) -contains "FullAccess")
    } | Select-Object -First 1)
}

function Test-SendAsExisting {
    param(
        [string]$Mailbox,
        [string]$User
    )

    $candidateValues = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
    [void]$candidateValues.Add($User)

    try {
        $recipient = Get-Recipient -Identity $User -ErrorAction Stop
        foreach ($value in @(
            "$($recipient.Name)",
            "$($recipient.Alias)",
            "$($recipient.DisplayName)",
            "$($recipient.PrimarySmtpAddress)",
            "$($recipient.ExternalDirectoryObjectId)"
        )) {
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                [void]$candidateValues.Add($value)
            }
        }
    } catch {}

    $permissions = @(Get-RecipientPermission -Identity $Mailbox -ErrorAction SilentlyContinue)

    foreach ($permission in $permissions) {
        if (@($permission.AccessRights) -notcontains "SendAs") { continue }

        $trustee = "$($permission.Trustee)"
        if ($candidateValues.Contains($trustee)) { return $true }
    }

    return $false
}

function Invoke-FullAccess {
    param(
        [string]$Operacao,
        [string]$Mailbox,
        [string]$User,
        [bool]$AutoMapping
    )

    if ($Operacao -eq "add") {
        Add-Log "FullAccess: a verificar permissão existente..."

        if (Test-FullAccessExisting -Mailbox $Mailbox -User $User) {
            Add-Log "FullAccess: já existe. Ignorado."
            return "ignored"
        }

        Add-MailboxPermission `
            -Identity $Mailbox `
            -User $User `
            -AccessRights FullAccess `
            -InheritanceType All `
            -AutoMapping:$AutoMapping `
            -Confirm:$false `
            -ErrorAction Stop | Out-Null

        Add-Log "FullAccess: adicionado com sucesso. AutoMapping=$AutoMapping"
        return "ok"
    }

    if ($Operacao -eq "remove") {
        Add-Log "FullAccess: a verificar permissão existente..."

        if (-not (Test-FullAccessExisting -Mailbox $Mailbox -User $User)) {
            Add-Log "FullAccess: não existe. Ignorado."
            return "ignored"
        }

        Remove-MailboxPermission `
            -Identity $Mailbox `
            -User $User `
            -AccessRights FullAccess `
            -InheritanceType All `
            -Confirm:$false `
            -ErrorAction Stop | Out-Null

        Add-Log "FullAccess: removido com sucesso."
        return "ok"
    }

    throw "Operação inválida para FullAccess: $Operacao"
}

function Invoke-SendAs {
    param(
        [string]$Operacao,
        [string]$Mailbox,
        [string]$User
    )

    if ($Operacao -eq "add") {
        Add-Log "SendAs: a verificar permissão existente..."

        if (Test-SendAsExisting -Mailbox $Mailbox -User $User) {
            Add-Log "SendAs: já existe. Ignorado."
            return "ignored"
        }

        Add-RecipientPermission `
            -Identity $Mailbox `
            -Trustee $User `
            -AccessRights SendAs `
            -Confirm:$false `
            -ErrorAction Stop | Out-Null

        Add-Log "SendAs: adicionado com sucesso."
        return "ok"
    }

    if ($Operacao -eq "remove") {
        Add-Log "SendAs: a verificar permissão existente..."

        if (-not (Test-SendAsExisting -Mailbox $Mailbox -User $User)) {
            Add-Log "SendAs: não existe. Ignorado."
            return "ignored"
        }

        Remove-RecipientPermission `
            -Identity $Mailbox `
            -Trustee $User `
            -AccessRights SendAs `
            -Confirm:$false `
            -ErrorAction Stop | Out-Null

        Add-Log "SendAs: removido com sucesso."
        return "ok"
    }

    throw "Operação inválida para SendAs: $Operacao"
}

try {
    Add-Log "Iniciando módulo Acesso em Massa."

    $payloadRaw = Get-RequestPayload -Query $Query -Config $Config -Body $Body

    if (-not $payloadRaw) {
        $queryType = if ($null -eq $Query) { "<null>" } else { $Query.GetType().FullName }
        $configType = if ($null -eq $Config) { "<null>" } else { $Config.GetType().FullName }
        Add-Log "DEBUG: QueryType=$queryType"
        Add-Log "DEBUG: ConfigType=$configType"
        throw "Body/Payload vazio. O router não entregou o JSON ao api.ps1."
    }

    $payload = Convert-PayloadToObject -Payload $payloadRaw
    $action = "$($payload.action)"

    if ($action -eq "current-operator") {
        $operator = Get-CurrentOperator
        Add-Log "Operador atual: $($operator.DisplayName) | $($operator.Email)"

        JsonResponse @{
            success = $true
            operator = $operator
            logs = @($Logs)
        }
        return
    }

    if ($action -eq "exchange-status") {
        Import-Module ExchangeOnlineManagement -ErrorAction Stop
        $connection = Get-ExchangeConnection

        JsonResponse @{
            success = $true
            connected = [bool]$connection
            account = if ($connection) { "$($connection.UserPrincipalName)" } else { "" }
            logs = @($Logs)
        }
        return
    }

    if ($action -eq "consultar-identidade") {
        Import-Module ExchangeOnlineManagement -ErrorAction Stop

        if (-not (Test-ExchangeSession)) {
            throw "Não existe sessão ativa no Exchange Online."
        }

        $valor = "$($payload.valor)".Trim()
        $tipoConsulta = "$($payload.tipoConsulta)".Trim()

        if ([string]::IsNullOrWhiteSpace($valor)) {
            throw "Valor vazio para consulta."
        }

        Add-Log "Consulta solicitada: $tipoConsulta | $valor"

        $resultado = @{
            encontrado = $false
            valor = $valor
            tipoConsulta = $tipoConsulta
            nome = ""
            email = ""
            recipientTypeDetails = ""
            mensagem = "Não encontrado"
        }

        try {
            $recipient = Get-Recipient -Identity $valor -ErrorAction Stop
            $resultado.encontrado = $true
            $resultado.nome = "$($recipient.DisplayName)"
            $resultado.email = "$($recipient.PrimarySmtpAddress)"
            $resultado.recipientTypeDetails = "$($recipient.RecipientTypeDetails)"
            $resultado.mensagem = "Encontrado"
            Add-Log "Encontrado: $($resultado.nome) | $($resultado.email) | $($resultado.recipientTypeDetails)"
        } catch {
            Add-Log "Não encontrado em Get-Recipient: $valor"
        }

        JsonResponse @{
            success = $true
            resultado = $resultado
            logs = @($Logs)
        }
        return
    }

    if ($action -eq "connect-exchange") {
        Connect-ExchangeWAM -AdminUser "$($payload.adminUser)"

        JsonResponse @{
            success = $true
            logs = @($Logs)
        }
        return
    }

    if ($action -ne "executar") {
        throw "Ação inválida: $action"
    }

    Import-Module ExchangeOnlineManagement -ErrorAction Stop

    if (-not (Test-ExchangeSession)) {
        throw "Não existe sessão ativa no Exchange Online. Clique primeiro em Conectar Exchange Online."
    }

    $operacao = "$($payload.operacao)".Trim()
    $tipoAcesso = "$($payload.tipoAcesso)".Trim()
    $autoMapping = "$($payload.autoMapping)".Trim()
    $linhas = @($payload.linhas)

    if ($operacao -notin @("add", "remove")) {
        throw "Operação inválida: $operacao"
    }

    if ($tipoAcesso -notin @("FullAccess", "SendAs", "FullAccessSendAs")) {
        throw "Tipo de acesso inválido: $tipoAcesso"
    }

    $autoMapBool = ($autoMapping -eq "true")

    Add-Log "Operação: $operacao"
    Add-Log "Tipo de acesso: $tipoAcesso"
    Add-Log "AutoMapping: $autoMapBool"
    Add-Log "Total de linhas: $($linhas.Count)"

    $totalOk = 0
    $totalErro = 0
    $totalIgnorado = 0
    $resultados = New-Object System.Collections.Generic.List[object]
    $i = 0

    foreach ($linha in $linhas) {
        $i++
        $user = "$($linha.user)".Trim()
        $mailbox = "$($linha.mailbox)".Trim()

        $linhaResultado = [ordered]@{
            linha = $i
            user = $user
            mailbox = $mailbox
            fullAccess = "not-requested"
            sendAs = "not-requested"
            success = $true
            error = ""
        }

        if ([string]::IsNullOrWhiteSpace($user) -or [string]::IsNullOrWhiteSpace($mailbox)) {
            Add-Log "Linha $i ignorada: utilizador ou mailbox vazio."
            $totalIgnorado++
            $linhaResultado.success = $false
            $linhaResultado.error = "Utilizador ou mailbox vazio."
            $resultados.Add([pscustomobject]$linhaResultado) | Out-Null
            continue
        }

        Add-Log "------------------------------------------------------------"
        Add-Log "Linha $i"
        Add-Log "Utilizador: $user"
        Add-Log "Mailbox/LD: $mailbox"

        try {
            Get-Recipient -Identity $user -ErrorAction Stop | Out-Null
            Get-Recipient -Identity $mailbox -ErrorAction Stop | Out-Null

            if ($tipoAcesso -in @("FullAccess", "FullAccessSendAs")) {
                try {
                    $status = Invoke-FullAccess -Operacao $operacao -Mailbox $mailbox -User $user -AutoMapping $autoMapBool
                    $linhaResultado.fullAccess = $status
                    if ($status -eq "ok") { $totalOk++ } else { $totalIgnorado++ }
                } catch {
                    $linhaResultado.fullAccess = "error"
                    $linhaResultado.success = $false
                    $linhaResultado.error += "FullAccess: $($_.Exception.Message) "
                    $totalErro++
                    Add-Log "FullAccess: ERRO: $($_.Exception.Message)"
                }
            }

            if ($tipoAcesso -in @("SendAs", "FullAccessSendAs")) {
                try {
                    $status = Invoke-SendAs -Operacao $operacao -Mailbox $mailbox -User $user
                    $linhaResultado.sendAs = $status
                    if ($status -eq "ok") { $totalOk++ } else { $totalIgnorado++ }
                } catch {
                    $linhaResultado.sendAs = "error"
                    $linhaResultado.success = $false
                    $linhaResultado.error += "SendAs: $($_.Exception.Message) "
                    $totalErro++
                    Add-Log "SendAs: ERRO: $($_.Exception.Message)"
                }
            }
        } catch {
            $linhaResultado.success = $false
            $linhaResultado.error = $_.Exception.Message
            $totalErro++
            Add-Log ("ERRO na linha {0}: {1}" -f $i, $_.Exception.Message)
        }

        $resultados.Add([pscustomobject]$linhaResultado) | Out-Null
    }

    Add-Log "------------------------------------------------------------"
    Add-Log "Processamento concluído."
    Add-Log "Operações concluídas: $totalOk"
    Add-Log "Operações ignoradas: $totalIgnorado"
    Add-Log "Erros: $totalErro"

    JsonResponse @{
        success = $true
        totalOk = $totalOk
        totalErro = $totalErro
        totalIgnorado = $totalIgnorado
        resultados = @($resultados)
        logs = @($Logs)
    }
}
catch {
    Add-Log "ERRO GERAL: $($_.Exception.Message)"

    JsonResponse @{
        success = $false
        error = $_.Exception.Message
        logs = @($Logs)
    }
}