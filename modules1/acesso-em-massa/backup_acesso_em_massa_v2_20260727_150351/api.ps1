param(
    $Query = $null,
    $Config = $null,
    $Body = $null
)

$ErrorActionPreference = "Stop"

$Logs = New-Object System.Collections.Generic.List[string]

function Add-Log {
    param([string]$Msg)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Msg"
    $Logs.Add($line) | Out-Null
}

function JsonResponse {
    param($Obj)
    $Obj | ConvertTo-Json -Depth 30
}

function Get-ValueSafe {
    param(
        $Obj,
        [string]$Name
    )

    if (-not $Obj) {
        return $null
    }

    try {
        if ($Obj -is [System.Collections.IDictionary]) {
            if ($Obj.Contains($Name)) {
                return $Obj[$Name]
            }
            if ($Obj.ContainsKey($Name)) {
                return $Obj[$Name]
            }
        }
    }
    catch {}

    try {
        $v = $Obj[$Name]
        if ($v) {
            return $v
        }
    }
    catch {}

    try {
        $prop = $Obj.PSObject.Properties[$Name]
        if ($prop) {
            return $prop.Value
        }
    }
    catch {}

    try {
        return $Obj.$Name
    }
    catch {}

    return $null
}

function Convert-PayloadToObject {
    param($Payload)

    if (-not $Payload) {
        return $null
    }

    if ($Payload -isnot [string]) {
        return $Payload
    }

    $text = "$Payload"

    try {
        $text = [System.Uri]::UnescapeDataString($text)
    }
    catch {}

    return ($text | ConvertFrom-Json)
}

function Get-RequestPayload {
    param(
        $Query,
        $Config,
        $Body
    )

    if ($Body) {
        return $Body
    }

    $payload = Get-ValueSafe -Obj $Query -Name "payload"
    if ($payload) {
        return $payload
    }

    $payload = Get-ValueSafe -Obj $Query -Name "Payload"
    if ($payload) {
        return $payload
    }

    $payload = Get-ValueSafe -Obj $Query -Name "body"
    if ($payload) {
        return $payload
    }

    $payload = Get-ValueSafe -Obj $Query -Name "Body"
    if ($payload) {
        return $payload
    }

    $payload = Get-ValueSafe -Obj $Config -Name "payload"
    if ($payload) {
        return $payload
    }

    $payload = Get-ValueSafe -Obj $Config -Name "Payload"
    if ($payload) {
        return $payload
    }

    $payload = Get-ValueSafe -Obj $Config -Name "body"
    if ($payload) {
        return $payload
    }

    $payload = Get-ValueSafe -Obj $Config -Name "Body"
    if ($payload) {
        return $payload
    }

    $queryFromConfig = Get-ValueSafe -Obj $Config -Name "Query"
    if ($queryFromConfig) {
        $payload = Get-ValueSafe -Obj $queryFromConfig -Name "payload"
        if ($payload) {
            return $payload
        }
    }

    if ($Query -is [string] -and $Query.Trim().StartsWith("{")) {
        return $Query
    }

    return $null
}


function Get-CurrentOperator {
    $Sam = $env:USERNAME

    $Result = @{
        DisplayName = $Sam
        Email = ""
        SamAccountName = $Sam
    }

    try {
        Import-Module ActiveDirectory -ErrorAction SilentlyContinue

        if (Get-Command Get-ADUser -ErrorAction SilentlyContinue) {
            $AdUser = Get-ADUser $Sam -Properties DisplayName,Mail -ErrorAction SilentlyContinue

            if ($AdUser) {
                if ($AdUser.DisplayName) {
                    $Result.DisplayName = "$($AdUser.DisplayName)"
                }

                if ($AdUser.Mail) {
                    $Result.Email = "$($AdUser.Mail)"
                }

                return $Result
            }
        }
    }
    catch {}

    try {
        $Searcher = New-Object DirectoryServices.DirectorySearcher
        $Searcher.Filter = "(&(objectCategory=person)(objectClass=user)(sAMAccountName=$Sam))"
        $Searcher.PropertiesToLoad.Add("displayName") | Out-Null
        $Searcher.PropertiesToLoad.Add("mail") | Out-Null

        $Found = $Searcher.FindOne()

        if ($Found) {
            if ($Found.Properties["displayname"].Count -gt 0) {
                $Result.DisplayName = "$($Found.Properties["displayname"][0])"
            }

            if ($Found.Properties["mail"].Count -gt 0) {
                $Result.Email = "$($Found.Properties["mail"][0])"
            }
        }
    }
    catch {}

    return $Result
}

function Test-ExchangeSession {
    try {
        if (Get-Command Get-ConnectionInformation -ErrorAction SilentlyContinue) {
            $ci = Get-ConnectionInformation -ErrorAction SilentlyContinue | Select-Object -First 1

            if ($ci) {
                Add-Log "Sessão Exchange ativa: $($ci.UserPrincipalName)"
                return $true
            }
        }
    }
    catch {}

    return $false
}

function Connect-ExchangeWAM {
    param([string]$AdminUser)

    Import-Module ExchangeOnlineManagement -ErrorAction Stop

    Add-Log "A iniciar conexão Exchange Online via WAM..."

    if ([string]::IsNullOrWhiteSpace($AdminUser)) {
        Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop
    }
    else {
        Connect-ExchangeOnline -UserPrincipalName $AdminUser -ShowBanner:$false -ErrorAction Stop
    }

    if (-not (Test-ExchangeSession)) {
        throw "A conexão foi chamada, mas não foi encontrada sessão ativa."
    }

    Add-Log "Conectado ao Exchange Online com sucesso."
}

try {
    Add-Log "Iniciando módulo Acesso em Massa."

    $PayloadRaw = Get-RequestPayload -Query $Query -Config $Config -Body $Body

    if (-not $PayloadRaw) {
        Add-Log "DEBUG: QueryType=$($Query.GetType().FullName)"
        Add-Log "DEBUG: ConfigType=$($Config.GetType().FullName)"
        throw "Body/Payload vazio. O router não entregou o JSON ao api.ps1."
    }

    $Payload = Convert-PayloadToObject -Payload $PayloadRaw

    $Action = "$($Payload.action)"

    
    if ($Action -eq "current-operator") {
        $Operator = Get-CurrentOperator

        Add-Log "Operador atual: $($Operator.DisplayName) | $($Operator.Email)"

        JsonResponse @{
            success = $true
            operator = $Operator
            logs = @($Logs)
        }

        return
    }

    if ($Action -eq "consultar-identidade") {

        Import-Module ExchangeOnlineManagement -ErrorAction Stop

        if (-not (Test-ExchangeSession)) {
            throw "Não existe sessão ativa no Exchange Online."
        }

        $Valor = "$($Payload.valor)".Trim()
        $TipoConsulta = "$($Payload.tipoConsulta)".Trim()

        if ([string]::IsNullOrWhiteSpace($Valor)) {
            throw "Valor vazio para consulta."
        }

        Add-Log "Consulta solicitada: $TipoConsulta | $Valor"

        $Resultado = @{
            encontrado = $false
            valor = $Valor
            tipoConsulta = $TipoConsulta
            nome = ""
            email = ""
            recipientTypeDetails = ""
            mensagem = "Não encontrado"
        }

        try {
            $Recipient = Get-Recipient -Identity $Valor -ErrorAction Stop

            $Resultado.encontrado = $true
            $Resultado.nome = "$($Recipient.DisplayName)"
            $Resultado.email = "$($Recipient.PrimarySmtpAddress)"
            $Resultado.recipientTypeDetails = "$($Recipient.RecipientTypeDetails)"
            $Resultado.mensagem = "Encontrado"

            Add-Log "Encontrado: $($Resultado.nome) | $($Resultado.email) | $($Resultado.recipientTypeDetails)"
        }
        catch {
            Add-Log "Não encontrado em Get-Recipient: $Valor"
        }

        JsonResponse @{
            success = $true
            resultado = $Resultado
            logs = @($Logs)
        }

        return
    }

    if ($Action -eq "connect-exchange") {
        $AdminUser = "$($Payload.adminUser)"
        Connect-ExchangeWAM -AdminUser $AdminUser

        JsonResponse @{
            success = $true
            logs = @($Logs)
        }

        return
    }

    if ($Action -ne "executar") {
        throw "Ação inválida: $Action"
    }

    Import-Module ExchangeOnlineManagement -ErrorAction Stop

    if (-not (Test-ExchangeSession)) {
        throw "Não existe sessão ativa no Exchange Online. Clique primeiro em Conectar Exchange Online."
    }

    $Operacao = "$($Payload.operacao)"
    $TipoAcesso = "$($Payload.tipoAcesso)"
    $AutoMapping = "$($Payload.autoMapping)"
    $Linhas = @($Payload.linhas)

    Add-Log "Operação: $Operacao"
    Add-Log "Tipo de acesso: $TipoAcesso"
    Add-Log "AutoMapping: $AutoMapping"
    Add-Log "Total de linhas: $($Linhas.Count)"

    $i = 0
    $TotalOk = 0
    $TotalErro = 0
    $TotalIgnorado = 0

    foreach ($Linha in $Linhas) {
        $i++

        $User = "$($Linha.user)".Trim()
        $Mailbox = "$($Linha.mailbox)".Trim()

        if ([string]::IsNullOrWhiteSpace($User) -or [string]::IsNullOrWhiteSpace($Mailbox)) {
            Add-Log ("Linha {0} ignorada: user ou mailbox vazio." -f $i)
            $TotalIgnorado++
            continue
        }

        Add-Log "------------------------------------------------------------"
        Add-Log ("Linha {0}" -f $i)
        Add-Log "Utilizador: $User"
        Add-Log "Mailbox/LD: $Mailbox"

        try {
            if ($TipoAcesso -eq "FullAccess") {
                $AutoMapBool = $false

                if ($AutoMapping -eq "true") {
                    $AutoMapBool = $true
                }

                if ($Operacao -eq "add") {
                    Add-Log "A verificar FullAccess existente..."

                    $PermissaoExistente = Get-MailboxPermission `
                        -Identity $Mailbox `
                        -User $User `
                        -ErrorAction SilentlyContinue

                    if ($PermissaoExistente) {
                        Add-Log "INFO: FullAccess já existe. Ignorado."
                        $TotalIgnorado++
                    }
                    else {
                        Add-Log "A adicionar FullAccess..."

                        Add-MailboxPermission `
                            -Identity $Mailbox `
                            -User $User `
                            -AccessRights FullAccess `
                            -InheritanceType All `
                            -AutoMapping:$AutoMapBool `
                            -Confirm:$false `
                            -ErrorAction Stop | Out-Null

                        Add-Log "OK: FullAccess adicionado."
                        $TotalOk++
                    }
                }
                elseif ($Operacao -eq "remove") {
                    Add-Log "A remover FullAccess..."

                    Remove-MailboxPermission `
                        -Identity $Mailbox `
                        -User $User `
                        -AccessRights FullAccess `
                        -InheritanceType All `
                        -Confirm:$false `
                        -ErrorAction Stop | Out-Null

                    Add-Log "OK: FullAccess removido."
                    $TotalOk++
                }
                else {
                    throw "Operação inválida para FullAccess: $Operacao"
                }
            }
            elseif ($TipoAcesso -eq "SendAs") {
                if ($Operacao -eq "add") {
                    Add-Log "A verificar SendAs existente..."

                    $ExisteSendAs = Get-RecipientPermission `
                        -Identity $Mailbox `
                        -ErrorAction SilentlyContinue |
                    Where-Object {
                        "$($_.Trustee)" -eq $User -and "$($_.AccessRights)" -match "SendAs"
                    }

                    if ($ExisteSendAs) {
                        Add-Log "INFO: SendAs já existe. Ignorado."
                        $TotalIgnorado++
                    }
                    else {
                        Add-Log "A adicionar SendAs..."

                        Add-RecipientPermission `
                            -Identity $Mailbox `
                            -Trustee $User `
                            -AccessRights SendAs `
                            -Confirm:$false `
                            -ErrorAction Stop | Out-Null

                        Add-Log "OK: SendAs adicionado."
                        $TotalOk++
                    }
                }
                elseif ($Operacao -eq "remove") {
                    Add-Log "A remover SendAs..."

                    Remove-RecipientPermission `
                        -Identity $Mailbox `
                        -Trustee $User `
                        -AccessRights SendAs `
                        -Confirm:$false `
                        -ErrorAction Stop | Out-Null

                    Add-Log "OK: SendAs removido."
                    $TotalOk++
                }
                else {
                    throw "Operação inválida para SendAs: $Operacao"
                }
            }
            else {
                throw "Tipo de acesso inválido: $TipoAcesso"
            }
        }
        catch {
            $TotalErro++
            Add-Log ("ERRO na linha {0}: {1}" -f $i, $_.Exception.Message)
        }
    }

    Add-Log "------------------------------------------------------------"
    Add-Log "Processamento concluído."
    Add-Log "Sucesso: $TotalOk"
    Add-Log "Ignorados: $TotalIgnorado"
    Add-Log "Erros: $TotalErro"

    JsonResponse @{
        success = $true
        totalOk = $TotalOk
        totalErro = $TotalErro
        totalIgnorado = $TotalIgnorado
        logs = @($Logs)
    }
}
catch {
    Add-Log ("ERRO GERAL: {0}" -f $_.Exception.Message)

    JsonResponse @{
        success = $false
        error = $_.Exception.Message
        logs = @($Logs)
    }
}



