param(
    $Query = $null,
    $Config = $null,
    $Body = $null,
    $RequestBody = $null,
    [string]$Method = "GET"
)

$ErrorActionPreference = "Stop"
$Debug = New-Object System.Collections.Generic.List[string]

$script:MeuGraphContext = $null
$script:MeuE3GroupId = $null
$script:MeuE3GroupName = "GR_PT_M365_E3"
$script:MeuExoConnected = $false

function Add-Debug {
    param([string]$Msg)
    [void]$Debug.Add("[$(Get-Date -Format 'HH:mm:ss')] $Msg")
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
    }
    catch {}

    try {
        if ($QueryObject -and $QueryObject.AllKeys) {
            foreach ($Key in $QueryObject.AllKeys) {
                if ($Key -eq $Name) {
                    return "$(($QueryObject.GetValues($Key) | Select-Object -First 1))"
                }
            }
        }
    }
    catch {}

    return ""
}

function Initialize-MeuGraph {
    if ($script:MeuGraphContext) {
        return $script:MeuGraphContext
    }

    if (-not (Get-Command Get-MgContext -ErrorAction SilentlyContinue)) {
        Add-Debug "A carregar apenas Microsoft.Graph.Authentication..."
        Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
    }

    $RequiredScopes = @(
        "User.Read.All",
        "UserAuthenticationMethod.ReadWrite.All",
        "Group.ReadWrite.All",
        "Directory.Read.All"
    )

    $Context = Get-MgContext -ErrorAction SilentlyContinue
    $MissingScopes = @()

    if ($Context) {
        $CurrentScopes = @($Context.Scopes)
        $MissingScopes = @($RequiredScopes | Where-Object { $CurrentScopes -notcontains $_ })
    }

    if (-not $Context -or $MissingScopes.Count -gt 0) {
        if ($MissingScopes.Count -gt 0) {
            Add-Debug "Contexto Graph sem todos os scopes necessários: $($MissingScopes -join ', ')"
        }
        else {
            Add-Debug "Graph não conectado. A iniciar WAM..."
        }

        Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null

        Connect-MgGraph `
            -Scopes $RequiredScopes `
            -ContextScope CurrentUser `
            -NoWelcome `
            -ErrorAction Stop

        $Context = Get-MgContext -ErrorAction Stop
    }

    if (-not $Context) {
        throw "Não foi possível obter contexto do Microsoft Graph."
    }

    $script:MeuGraphContext = $Context
    Add-Debug "Graph conectado: $($Context.Account)"
    return $Context
}

function Invoke-MeuGraphRequest {
    param(
        [ValidateSet("GET","POST","PATCH","DELETE")]
        [string]$Method,
        [string]$Uri,
        $Body = $null,
        [hashtable]$Headers = $null
    )

    Initialize-MeuGraph | Out-Null

    $Params = @{
        Method      = $Method
        Uri         = $Uri
        ErrorAction = "Stop"
    }

    if ($null -ne $Body) {
        $Params.Body = if ($Body -is [string]) {
            $Body
        }
        else {
            $Body | ConvertTo-Json -Depth 20 -Compress
        }
        $Params.ContentType = "application/json"
    }

    if ($Headers) {
        $Params.Headers = $Headers
    }

    Invoke-MgGraphRequest @Params
}

function Search-LocalADUser {
    param (
        [string]$InputUser,
        [string]$UPN,
        [string]$Email
    )

    if (-not (Get-Command Get-ADUser -ErrorAction SilentlyContinue)) {
        Import-Module ActiveDirectory -ErrorAction Stop
    }

    $Domains = @(
        "central.rinterna.local",
        "rede.rinterna.local"
    )

    $SearchValues = New-Object System.Collections.Generic.List[string]

    foreach ($Value in @($InputUser, $UPN, $Email)) {
        if (-not [string]::IsNullOrWhiteSpace($Value)) {
            [void]$SearchValues.Add($Value.Trim())
        }
    }

    foreach ($Value in @($UPN, $Email)) {
        if ($Value -like "*@*") {
            [void]$SearchValues.Add($Value.Split("@")[0])
        }
    }

    $UniqueValues = @(
        $SearchValues |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Unique
    )

    foreach ($Domain in $Domains) {
        foreach ($Value in $UniqueValues) {
            try {
                Add-Debug "Pesquisar AD domínio=$Domain valor=$Value"

                $SafeValue = $Value.Replace("'", "''")
                $Proxy1 = "SMTP:$SafeValue"
                $Proxy2 = "smtp:$SafeValue"

                $Filter = "SamAccountName -eq '$SafeValue' -or UserPrincipalName -eq '$SafeValue' -or Mail -eq '$SafeValue' -or ProxyAddresses -eq '$Proxy1' -or ProxyAddresses -eq '$Proxy2'"

                $ADUser = Get-ADUser `
                    -Server $Domain `
                    -Filter $Filter `
                    -Properties DisplayName,SamAccountName,UserPrincipalName,Mail,Enabled,whenCreated,DistinguishedName,ProxyAddresses `
                    -ErrorAction SilentlyContinue |
                    Select-Object -First 1

                if ($ADUser) {
                    Add-Debug "Utilizador encontrado no AD $Domain com valor $Value"

                    return [PSCustomObject]@{
                        Found             = $true
                        Domain            = $Domain
                        SamAccountName    = $ADUser.SamAccountName
                        DisplayName       = $ADUser.DisplayName
                        UserPrincipalName = $ADUser.UserPrincipalName
                        Mail              = $ADUser.Mail
                        Enabled           = $ADUser.Enabled
                        WhenCreated       = $ADUser.whenCreated
                        DistinguishedName = $ADUser.DistinguishedName
                        ProxyAddresses    = @($ADUser.ProxyAddresses)
                    }
                }
            }
            catch {
                Add-Debug "Erro AD domínio=$Domain valor=$Value : $($_.Exception.Message)"
            }
        }
    }

    [PSCustomObject]@{
        Found             = $false
        Domain            = "Não encontrado no AD local"
        SamAccountName    = ""
        DisplayName       = ""
        UserPrincipalName = ""
        Mail              = ""
        Enabled           = $null
        WhenCreated       = $null
        DistinguishedName = ""
        ProxyAddresses    = @()
    }
}

function Search-EntraUser {
    param([string]$InputUser)

    if ([string]::IsNullOrWhiteSpace($InputUser)) {
        return $null
    }

    $InputUser = $InputUser.Trim()
    $Select = "id,displayName,userPrincipalName,mail,accountEnabled,proxyAddresses,givenName,surname"

    try {
        $EncodedId = [System.Uri]::EscapeDataString($InputUser)
        Add-Debug "Graph: pesquisa direta do utilizador."
        return Invoke-MeuGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/users/${EncodedId}?`$select=$Select"
    }
    catch {
        Add-Debug "Graph: pesquisa direta sem resultado."
    }

    $SafeInput = $InputUser.Replace("'", "''")

    if ($InputUser -like "*@*") {
        $Filter = "userPrincipalName eq '$SafeInput' or mail eq '$SafeInput'"
    }
    else {
        $Filter = "startswith(userPrincipalName,'$SafeInput@')"
    }

    try {
        $EncodedFilter = [System.Uri]::EscapeDataString($Filter)
        $Uri = "https://graph.microsoft.com/v1.0/users?`$select=$Select&`$filter=$EncodedFilter&`$top=25"
        Add-Debug "Graph: pesquisa filtrada do utilizador."
        $Result = Invoke-MeuGraphRequest -Method GET -Uri $Uri
        $Users = @($Result.value)

        if ($Users.Count -eq 0) {
            return $null
        }

        if ($InputUser -notlike "*@*") {
            $Exact = $Users | Where-Object {
                $_.userPrincipalName -and
                $_.userPrincipalName.Split("@")[0] -ieq $InputUser
            } | Select-Object -First 1

            if ($Exact) {
                return $Exact
            }
        }

        return $Users | Select-Object -First 1
    }
    catch {
        Add-Debug "Graph: erro na pesquisa filtrada: $($_.Exception.Message)"
        return $null
    }
}

function New-MeuTemporaryAccessPass {
    param([string]$InputUser)

    $EntraUser = Search-EntraUser -InputUser $InputUser

    if (-not $EntraUser) {
        throw "Utilizador não encontrado no Entra ID. Não foi possível criar TPA."
    }

    Add-Debug "A criar TPA multiuso de 8 horas para: $($EntraUser.userPrincipalName)"

    $Body = @{
        lifetimeInMinutes = 480
        isUsableOnce      = $false
    }

    $Tap = Invoke-MeuGraphRequest `
        -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/users/$($EntraUser.id)/authentication/temporaryAccessPassMethods" `
        -Body $Body

    if (-not $Tap.temporaryAccessPass) {
        throw "TPA criado, mas o valor não foi devolvido pela API."
    }

    [PSCustomObject]@{
        UserPrincipalName  = $EntraUser.userPrincipalName
        TemporaryAccessPass = $Tap.temporaryAccessPass
        CreatedDateTime    = $Tap.createdDateTime
        LifetimeInMinutes  = $Tap.lifetimeInMinutes
        IsUsableOnce       = $Tap.isUsableOnce
    }
}

function Find-MeuEmailUsuario {
    param([string]$InputUser)

    Add-Debug "Buscar email para responsável: $InputUser"

    $EntraUser = Search-EntraUser -InputUser $InputUser

    if ($EntraUser) {
        if ($EntraUser.mail) {
            return "$($EntraUser.mail)"
        }

        if ($EntraUser.userPrincipalName) {
            return "$($EntraUser.userPrincipalName)"
        }
    }

    $ADInfo = Search-LocalADUser -InputUser $InputUser -UPN "" -Email ""

    if ($ADInfo.Found -and $ADInfo.Mail) {
        return "$($ADInfo.Mail)"
    }

    return ""
}

function Get-MeuE3CachePath {
    $CacheDir = Join-Path $PSScriptRoot "cache"

    if (-not (Test-Path -LiteralPath $CacheDir -PathType Container)) {
        [void](New-Item -Path $CacheDir -ItemType Directory -Force)
    }

    Join-Path $CacheDir "e3-group.json"
}

function Get-MeuE3Group {
    if ($script:MeuE3GroupId) {
        return [PSCustomObject]@{
            Id          = $script:MeuE3GroupId
            DisplayName = $script:MeuE3GroupName
        }
    }

    $CachePath = Get-MeuE3CachePath

    if (Test-Path -LiteralPath $CachePath -PathType Leaf) {
        try {
            $Cached = Get-Content -LiteralPath $CachePath -Raw -ErrorAction Stop | ConvertFrom-Json

            if ($Cached.id -and $Cached.displayName -eq $script:MeuE3GroupName) {
                $script:MeuE3GroupId = "$($Cached.id)"
                Add-Debug "Grupo E3 obtido do cache local."

                return [PSCustomObject]@{
                    Id          = $script:MeuE3GroupId
                    DisplayName = $script:MeuE3GroupName
                }
            }
        }
        catch {
            Add-Debug "Cache E3 inválido: $($_.Exception.Message)"
        }
    }

    $SafeName = $script:MeuE3GroupName.Replace("'", "''")
    $Filter = [System.Uri]::EscapeDataString("displayName eq '$SafeName'")
    $Uri = "https://graph.microsoft.com/v1.0/groups?`$select=id,displayName&`$filter=$Filter&`$top=2"

    Add-Debug "A localizar grupo E3 no Graph."
    $Result = Invoke-MeuGraphRequest -Method GET -Uri $Uri
    $Group = @($Result.value) | Select-Object -First 1

    if (-not $Group) {
        throw "Grupo '$($script:MeuE3GroupName)' não encontrado no Entra ID."
    }

    $script:MeuE3GroupId = "$($Group.id)"

    try {
        @{
            id          = $script:MeuE3GroupId
            displayName = $script:MeuE3GroupName
            updatedAt   = (Get-Date).ToString("o")
        } | ConvertTo-Json | Set-Content -LiteralPath $CachePath -Encoding UTF8
    }
    catch {
        Add-Debug "Não foi possível gravar cache E3: $($_.Exception.Message)"
    }

    [PSCustomObject]@{
        Id          = $script:MeuE3GroupId
        DisplayName = $script:MeuE3GroupName
    }
}

function Get-MeuE3Status {
    param([string]$InputUser)

    $User = Search-EntraUser -InputUser $InputUser

    if (-not $User) {
        throw "Utilizador não encontrado no Entra ID."
    }

    $Group = Get-MeuE3Group

    Add-Debug "A validar E3 para $($User.userPrincipalName)."

    $Check = Invoke-MeuGraphRequest `
        -Method POST `
        -Uri "https://graph.microsoft.com/v1.0/users/$($User.id)/checkMemberGroups" `
        -Body @{ groupIds = @($Group.Id) }

    $TemLicenca = $false

    if ($Check -and $Check.value) {
        $TemLicenca = @($Check.value) -contains $Group.Id
    }

    [PSCustomObject]@{
        UserId            = $User.id
        UserPrincipalName = $User.userPrincipalName
        GroupId           = $Group.Id
        GroupName         = $Group.DisplayName
        TemLicenca        = $TemLicenca
    }
}

function Add-MeuE3License {
    param([string]$InputUser)

    $Status = Get-MeuE3Status -InputUser $InputUser

    if ($Status.TemLicenca) {
        Add-Debug "Utilizador já pertence ao grupo E3."
        return $Status
    }

    Add-Debug "A adicionar utilizador diretamente ao grupo E3."

    try {
        Invoke-MeuGraphRequest `
            -Method POST `
            -Uri "https://graph.microsoft.com/v1.0/groups/$($Status.GroupId)/members/`$ref" `
            -Body @{ "@odata.id" = "https://graph.microsoft.com/v1.0/directoryObjects/$($Status.UserId)" } | Out-Null
    }
    catch {
        if ($_.Exception.Message -notmatch "added object references already exist") {
            throw
        }

        Add-Debug "O utilizador já estava no grupo no momento da inclusão."
    }

    $Status.TemLicenca = $true
    return $Status
}

# MEU_EMAIL_414_BACKEND_V3_1
# O corpo profissional do email é montado no backend.
# O frontend envia apenas dados compactos, evitando HTTP 414.

function ConvertTo-MeuHtml {
    param($Value)

    if ($null -eq $Value) {
        return ""
    }

    return [System.Net.WebUtility]::HtmlEncode("$Value")
}

function ConvertTo-MeuBoolean {
    param($Value)

    if ($Value -is [bool]) {
        return [bool]$Value
    }

    $Text = "$Value".Trim().ToLowerInvariant()

    return $Text -in @(
        "true",
        "1",
        "sim",
        "yes",
        "ativo",
        "atribuida",
        "atribuída",
        "verificado",
        "verificada"
    )
}

function ConvertFrom-MeuJsonCandidate {
    param($Candidate)

    if ($null -eq $Candidate) {
        return $null
    }

    if (
        $Candidate -is [System.Collections.IDictionary] -or
        (
            $Candidate -is [PSCustomObject] -and
            $Candidate.PSObject.Properties.Count -gt 0
        )
    ) {
        try {
            if ($Candidate.payload) {
                $Nested = $Candidate.payload

                if (
                    $Nested -is [System.Collections.IDictionary] -or
                    $Nested -is [PSCustomObject]
                ) {
                    return $Nested
                }

                if (-not [string]::IsNullOrWhiteSpace("$Nested")) {
                    return ("$Nested" | ConvertFrom-Json)
                }
            }
        }
        catch {}

        return $Candidate
    }

    $Raw = "$Candidate"

    if ([string]::IsNullOrWhiteSpace($Raw)) {
        return $null
    }

    try {
        $Decoded = [System.Uri]::UnescapeDataString($Raw)
        $Parsed = $Decoded | ConvertFrom-Json

        if ($Parsed -and $Parsed.payload) {
            if (
                $Parsed.payload -is [System.Collections.IDictionary] -or
                $Parsed.payload -is [PSCustomObject]
            ) {
                return $Parsed.payload
            }

            return ("$($Parsed.payload)" | ConvertFrom-Json)
        }

        return $Parsed
    }
    catch {
        return $null
    }
}

function Get-MeuEmailPayload {
    param($QueryObject)

    foreach ($Candidate in @(
        $Body,
        $RequestBody,
        (Get-QueryValue -QueryObject $QueryObject -Name "payload"),
        (Get-QueryValue -QueryObject $QueryObject -Name "body"),
        (Get-QueryValue -QueryObject $QueryObject -Name "json")
    )) {
        $Parsed = ConvertFrom-MeuJsonCandidate -Candidate $Candidate

        if ($Parsed) {
            return $Parsed
        }
    }

    $DirectTo = Get-QueryValue -QueryObject $QueryObject -Name "to"
    $DirectSubject = Get-QueryValue -QueryObject $QueryObject -Name "subject"

    if (
        -not [string]::IsNullOrWhiteSpace($DirectTo) -or
        -not [string]::IsNullOrWhiteSpace($DirectSubject)
    ) {
        return [PSCustomObject]@{
            to           = $DirectTo
            cc           = Get-QueryValue -QueryObject $QueryObject -Name "cc"
            subject      = $DirectSubject
            attachment   = Get-QueryValue -QueryObject $QueryObject -Name "attachment"
            user         = Get-QueryValue -QueryObject $QueryObject -Name "emailUser"
            nome         = Get-QueryValue -QueryObject $QueryObject -Name "nome"
            email        = Get-QueryValue -QueryObject $QueryObject -Name "email"
            upn          = Get-QueryValue -QueryObject $QueryObject -Name "upn"
            ticket       = Get-QueryValue -QueryObject $QueryObject -Name "ticket"
            dataCriacao  = Get-QueryValue -QueryObject $QueryObject -Name "dataCriacao"
            tpa          = Get-QueryValue -QueryObject $QueryObject -Name "tpa"
            validadeTpa  = Get-QueryValue -QueryObject $QueryObject -Name "validadeTpa"
            e3Ok         = Get-QueryValue -QueryObject $QueryObject -Name "e3Ok"
            arquivoOk    = Get-QueryValue -QueryObject $QueryObject -Name "arquivoOk"
        }
    }

    return $null
}

function New-MeuStatusBadgeHtml {
    param(
        [string]$Text,
        [bool]$Success
    )

    if ($Success) {
        $Background = "#E7F4EC"
        $Border = "#198754"
        $Color = "#116B43"
    }
    else {
        $Background = "#FFF4DE"
        $Border = "#C78300"
        $Color = "#7A4B00"
    }

    $SafeText = ConvertTo-MeuHtml -Value $Text

    return @"
<span style="display:inline-block;padding:5px 10px;border:1px solid $Border;background-color:$Background;color:$Color;font-family:Segoe UI,Arial,sans-serif;font-size:11px;font-weight:700;line-height:16px;letter-spacing:.3px;text-transform:uppercase;white-space:nowrap;">$SafeText</span>
"@
}

function New-MeuProfessionalEmailHtml {
    param($Payload)

    $User = ConvertTo-MeuHtml -Value $Payload.user
    $Nome = ConvertTo-MeuHtml -Value $Payload.nome
    $Email = ConvertTo-MeuHtml -Value $Payload.email
    $Upn = ConvertTo-MeuHtml -Value $Payload.upn
    $Ticket = ConvertTo-MeuHtml -Value $Payload.ticket
    $DataCriacao = ConvertTo-MeuHtml -Value $Payload.dataCriacao
    $Tpa = ConvertTo-MeuHtml -Value $Payload.tpa
    $ValidadeTpa = ConvertTo-MeuHtml -Value $Payload.validadeTpa

    if ([string]::IsNullOrWhiteSpace($User)) { $User = "-" }
    if ([string]::IsNullOrWhiteSpace($Nome)) { $Nome = "-" }
    if ([string]::IsNullOrWhiteSpace($Email)) { $Email = "-" }
    if ([string]::IsNullOrWhiteSpace($Upn)) { $Upn = "-" }
    if ([string]::IsNullOrWhiteSpace($Ticket)) { $Ticket = "Não informado" }
    if ([string]::IsNullOrWhiteSpace($DataCriacao)) { $DataCriacao = "-" }
    if ([string]::IsNullOrWhiteSpace($Tpa)) { $Tpa = "Ainda não gerado" }
    if ([string]::IsNullOrWhiteSpace($ValidadeTpa)) { $ValidadeTpa = "8 horas" }

    $E3Ok = ConvertTo-MeuBoolean -Value $Payload.e3Ok
    $ArquivoOk = ConvertTo-MeuBoolean -Value $Payload.arquivoOk
    $TpaOk = ($Tpa -ne "Ainda não gerado")

    $E3Badge = New-MeuStatusBadgeHtml `
        -Text $(if ($E3Ok) { "Atribuída" } else { "Pendente" }) `
        -Success $E3Ok

    $ArquivoBadge = New-MeuStatusBadgeHtml `
        -Text $(if ($ArquivoOk) { "Ativo / solicitado" } else { "Pendente" }) `
        -Success $ArquivoOk

    $TpaBadge = New-MeuStatusBadgeHtml `
        -Text $(if ($TpaOk) { "Criado" } else { "Pendente" }) `
        -Success $TpaOk

    $Hour = (Get-Date).Hour

    if ($Hour -lt 12) {
        $Greeting = "Bom dia"
    }
    elseif ($Hour -lt 19) {
        $Greeting = "Boa tarde"
    }
    else {
        $Greeting = "Boa noite"
    }

    return @"
<!doctype html>
<html lang="pt">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <title>Dados de acesso e configuração MFA</title>
    <!--[if mso]>
    <style>
        table { border-collapse: collapse; }
        td, th { font-family: Arial, sans-serif !important; }
    </style>
    <![endif]-->
</head>

<body style="margin:0;padding:0;background-color:#F3F4F6;color:#222222;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
           bgcolor="#F3F4F6" style="width:100%;background-color:#F3F4F6;">
        <tr>
            <td align="center" style="padding:24px 12px;">

                <table role="presentation" width="720" cellspacing="0" cellpadding="0" border="0"
                       style="width:100%;max-width:720px;background-color:#FFFFFF;border:1px solid #D9DDE3;">

                    <tr>
                        <td bgcolor="#EC0000"
                            style="background-color:#EC0000;padding:24px 30px;border-bottom:5px solid #B80000;">
                            <div style="font-family:Segoe UI,Arial,sans-serif;font-size:30px;line-height:34px;font-weight:700;color:#FFFFFF;">
                                Santander
                            </div>
                            <div style="font-family:Segoe UI,Arial,sans-serif;font-size:13px;line-height:20px;color:#FFFFFF;padding-top:4px;">
                                Criação de Utilizador MEU | IT Services Portugal
                            </div>
                        </td>
                    </tr>

                    <tr>
                        <td style="padding:30px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:22px;color:#2D3035;">

                            <p style="margin:0 0 16px 0;font-size:15px;">
                                <strong>$Greeting,</strong>
                            </p>

                            <p style="margin:0 0 22px 0;">
                                O aprovisionamento do utilizador
                                <strong style="color:#EC0000;">$User</strong>
                                foi concluído no âmbito do processo <strong>MEU</strong>.
                                Abaixo seguem os dados necessários para o primeiro acesso e para a configuração do MFA.
                            </p>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 12px 0;">
                                <tr>
                                    <td style="font-family:Segoe UI,Arial,sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#24272B;padding:0 0 8px 0;border-bottom:3px solid #EC0000;">
                                        Dados do utilizador
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   bgcolor="#F8F9FA"
                                   style="width:100%;background-color:#F8F9FA;border:1px solid #E1E4E8;margin:0 0 26px 0;">
                                <tr>
                                    <td width="34%" style="padding:11px 14px;border-bottom:1px solid #E1E4E8;font-weight:700;color:#4B4F55;">Utilizador</td>
                                    <td style="padding:11px 14px;border-bottom:1px solid #E1E4E8;color:#EC0000;font-weight:700;">$User</td>
                                </tr>
                                <tr>
                                    <td width="34%" style="padding:11px 14px;border-bottom:1px solid #E1E4E8;font-weight:700;color:#4B4F55;">Nome</td>
                                    <td style="padding:11px 14px;border-bottom:1px solid #E1E4E8;">$Nome</td>
                                </tr>
                                <tr>
                                    <td width="34%" style="padding:11px 14px;border-bottom:1px solid #E1E4E8;font-weight:700;color:#4B4F55;">E-mail corporativo</td>
                                    <td style="padding:11px 14px;border-bottom:1px solid #E1E4E8;color:#0057B8;font-weight:700;">$Email</td>
                                </tr>
                                <tr>
                                    <td width="34%" style="padding:11px 14px;border-bottom:1px solid #E1E4E8;font-weight:700;color:#4B4F55;">UPN</td>
                                    <td style="padding:11px 14px;border-bottom:1px solid #E1E4E8;">$Upn</td>
                                </tr>
                                <tr>
                                    <td width="34%" style="padding:11px 14px;border-bottom:1px solid #E1E4E8;font-weight:700;color:#4B4F55;">Número do ticket</td>
                                    <td style="padding:11px 14px;border-bottom:1px solid #E1E4E8;">$Ticket</td>
                                </tr>
                                <tr>
                                    <td width="34%" style="padding:11px 14px;font-weight:700;color:#4B4F55;">Data de criação</td>
                                    <td style="padding:11px 14px;">$DataCriacao</td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 12px 0;">
                                <tr>
                                    <td style="font-family:Segoe UI,Arial,sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#24272B;padding:0 0 8px 0;border-bottom:3px solid #EC0000;">
                                        Estado da configuração
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;border:1px solid #DDE1E6;margin:0 0 26px 0;">
                                <tr bgcolor="#F3F4F6" style="background-color:#F3F4F6;">
                                    <th align="left" width="34%" style="padding:11px 12px;border-bottom:1px solid #DDE1E6;font-size:12px;color:#4A4E54;">SERVIÇO</th>
                                    <th align="left" width="23%" style="padding:11px 12px;border-bottom:1px solid #DDE1E6;font-size:12px;color:#4A4E54;">ESTADO</th>
                                    <th align="left" style="padding:11px 12px;border-bottom:1px solid #DDE1E6;font-size:12px;color:#4A4E54;">DETALHES</th>
                                </tr>
                                <tr>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;font-weight:700;">Microsoft 365 E3</td>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;">$E3Badge</td>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;color:#555A60;">Grupo GR_PT_M365_E3</td>
                                </tr>
                                <tr>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;font-weight:700;">Arquivo Online EXO</td>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;">$ArquivoBadge</td>
                                    <td style="padding:13px 12px;border-bottom:1px solid #E7E9EC;color:#555A60;">Ativação enviada ao Exchange Online</td>
                                </tr>
                                <tr>
                                    <td style="padding:13px 12px;font-weight:700;">Temporary Access Pass</td>
                                    <td style="padding:13px 12px;">$TpaBadge</td>
                                    <td style="padding:13px 12px;color:#555A60;">Credencial temporária para o primeiro acesso</td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 12px 0;">
                                <tr>
                                    <td style="font-family:Segoe UI,Arial,sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#24272B;padding:0 0 8px 0;border-bottom:3px solid #EC0000;">
                                        Dados para o primeiro acesso
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   bgcolor="#FFF5F5"
                                   style="width:100%;background-color:#FFF5F5;border:2px solid #EC0000;margin:0 0 22px 0;">
                                <tr>
                                    <td align="center" style="padding:20px 18px 8px 18px;color:#5E1313;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">
                                        Temporary Access Pass
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center"
                                        style="padding:4px 18px 10px 18px;font-family:Consolas,'Courier New',monospace;font-size:25px;line-height:32px;font-weight:700;color:#EC0000;letter-spacing:1.5px;">
                                        $Tpa
                                    </td>
                                </tr>
                                <tr>
                                    <td align="center" style="padding:0 18px 20px 18px;color:#5C6066;font-size:13px;line-height:20px;">
                                        Validade: <strong>$ValidadeTpa</strong>
                                        &nbsp;&nbsp;|&nbsp;&nbsp;
                                        Utilização: <strong>multiuso</strong>
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 22px 0;">
                                <tr>
                                    <td align="center" bgcolor="#EC0000"
                                        style="background-color:#EC0000;padding:13px 18px;">
                                        <a href="https://aka.ms/mysecurityinfo"
                                           style="display:block;font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#FFFFFF;text-decoration:none;">
                                            Abrir portal de Segurança e configurar o MFA
                                        </a>
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 12px 0;">
                                <tr>
                                    <td style="font-family:Segoe UI,Arial,sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#24272B;padding:0 0 8px 0;border-bottom:3px solid #EC0000;">
                                        Como concluir a configuração
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   style="width:100%;margin:0 0 24px 0;">
                                <tr>
                                    <td width="38" valign="top" style="padding:8px 8px 8px 0;">
                                        <div style="width:28px;height:28px;line-height:28px;text-align:center;background-color:#EC0000;color:#FFFFFF;font-weight:700;">1</div>
                                    </td>
                                    <td valign="top" style="padding:8px 0;">
                                        <strong>Aceder ao portal</strong><br>
                                        Abrir <a href="https://aka.ms/mysecurityinfo" style="color:#0057B8;font-weight:700;">https://aka.ms/mysecurityinfo</a>.
                                    </td>
                                </tr>
                                <tr>
                                    <td width="38" valign="top" style="padding:8px 8px 8px 0;">
                                        <div style="width:28px;height:28px;line-height:28px;text-align:center;background-color:#EC0000;color:#FFFFFF;font-weight:700;">2</div>
                                    </td>
                                    <td valign="top" style="padding:8px 0;">
                                        <strong>Efetuar o primeiro login</strong><br>
                                        Utilizar o UPN e o Temporary Access Pass apresentados neste e-mail.
                                    </td>
                                </tr>
                                <tr>
                                    <td width="38" valign="top" style="padding:8px 8px 8px 0;">
                                        <div style="width:28px;height:28px;line-height:28px;text-align:center;background-color:#EC0000;color:#FFFFFF;font-weight:700;">3</div>
                                    </td>
                                    <td valign="top" style="padding:8px 0;">
                                        <strong>Registar o Microsoft Authenticator</strong><br>
                                        Seguir as instruções do portal e utilizar o manual MFA enviado em anexo.
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   bgcolor="#FFF1F1"
                                   style="width:100%;background-color:#FFF1F1;border-left:5px solid #EC0000;margin:0 0 14px 0;">
                                <tr>
                                    <td style="padding:15px 16px;color:#751515;font-size:13px;line-height:20px;">
                                        <strong>Atenção:</strong>
                                        o Temporary Access Pass tem validade máxima de
                                        <strong>$ValidadeTpa</strong>.
                                        Caso expire ou ocorra algum erro, deverá ser aberto um novo pedido no ServiceNow.
                                    </td>
                                </tr>
                            </table>

                            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
                                   bgcolor="#FFF8E6"
                                   style="width:100%;background-color:#FFF8E6;border-left:5px solid #D59A00;margin:0 0 24px 0;">
                                <tr>
                                    <td style="padding:15px 16px;color:#654C00;font-size:13px;line-height:20px;">
                                        <strong>Nota:</strong>
                                        o utilizador apenas deverá configurar o MFA a partir da data de início de funções definida no contrato.
                                        O código temporário deve ser partilhado apenas com o utilizador correto.
                                    </td>
                                </tr>
                            </table>

                            <p style="margin:0 0 5px 0;">Atenciosamente,</p>
                            <p style="margin:0;font-weight:700;color:#24272B;">Santander EndUser</p>
                            <p style="margin:2px 0 0 0;font-size:12px;color:#676C72;">
                                Equipa Exchange / Office365 / Intune
                            </p>

                        </td>
                    </tr>

                    <tr>
                        <td bgcolor="#24272B"
                            style="background-color:#24272B;padding:16px 30px;font-family:Segoe UI,Arial,sans-serif;font-size:11px;line-height:17px;color:#FFFFFF;">
                            Mensagem gerada pelo Santander Support Web V2.
                            O manual de configuração MFA segue em anexo.
                        </td>
                    </tr>

                </table>

            </td>
        </tr>
    </table>
</body>
</html>
"@
}
function New-MeuOutlookEmailResponsavel {
    param(
        [string]$To,
        [string]$Cc,
        [string]$Subject,
        [string]$Html,
        [string]$Attachment
    )

    if ([string]::IsNullOrWhiteSpace($To)) { throw "Campo Para está vazio." }
    if ([string]::IsNullOrWhiteSpace($Subject)) { throw "Campo Assunto está vazio." }
    if ([string]::IsNullOrWhiteSpace($Html)) { throw "Corpo do email está vazio." }

    $SenderAddress = "User.Action.Required@santander.pt"
    $Outlook = New-Object -ComObject Outlook.Application
    $Mail = $Outlook.CreateItem(0)

    try {
        foreach ($Account in $Outlook.Session.Accounts) {
            if ($Account.SmtpAddress -ieq $SenderAddress) {
                $Mail.SendUsingAccount = $Account
                Add-Debug "SendUsingAccount definido para: $SenderAddress"
                break
            }
        }
    }
    catch {
        Add-Debug "Erro ao definir SendUsingAccount: $($_.Exception.Message)"
    }

    try {
        $Mail.SentOnBehalfOfName = $SenderAddress
    }
    catch {
        Add-Debug "Erro ao definir SentOnBehalfOfName: $($_.Exception.Message)"
    }

    $Mail.To = $To
    $Mail.CC = $Cc
    $Mail.Subject = $Subject
    $Mail.HTMLBody = $Html

    if ([string]::IsNullOrWhiteSpace($Attachment)) {
        $Attachment = "C:\Temp\SantanderSupportWebV2_PROD\files\Manual_MFA.pdf"
    }

    if (-not [string]::IsNullOrWhiteSpace($Attachment)) {
        $AttachmentClean = $Attachment.Trim('"').Trim()

        if (Test-Path -LiteralPath $AttachmentClean -PathType Leaf) {
            $ResolvedAttachment = (Resolve-Path -LiteralPath $AttachmentClean).Path
            [void]$Mail.Attachments.Add($ResolvedAttachment)
            Add-Debug "Anexo adicionado: $ResolvedAttachment"
        }
        else {
            Add-Debug "Anexo não encontrado: $AttachmentClean"
        }
    }

    $Mail.Display()
}

function Select-MeuManualMfa {
    try {
        Add-Type -AssemblyName System.Windows.Forms

        $Dialog = New-Object System.Windows.Forms.OpenFileDialog
        $Dialog.Title = "Selecionar Manual MFA"
        $Dialog.Filter = "PDF (*.pdf)|*.pdf|Word (*.docx)|*.docx|Todos os ficheiros (*.*)|*.*"
        $Dialog.Multiselect = $false

        if ($Dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            return $Dialog.FileName
        }

        return ""
    }
    catch {
        Add-Debug "Erro ao abrir seletor de ficheiro: $($_.Exception.Message)"
        return ""
    }
}

function Ensure-ExchangeOnlineConnected {
    if ($script:MeuExoConnected) {
        return
    }

    if (-not (Get-Command Connect-ExchangeOnline -ErrorAction SilentlyContinue)) {
        Add-Debug "A carregar ExchangeOnlineManagement..."
        Import-Module ExchangeOnlineManagement -ErrorAction Stop
    }

    try {
        $Connection = Get-ConnectionInformation -ErrorAction SilentlyContinue |
            Where-Object { $_.State -eq "Connected" } |
            Select-Object -First 1

        if ($Connection) {
            $script:MeuExoConnected = $true
            Add-Debug "Exchange Online já conectado: $($Connection.UserPrincipalName)"
            return
        }
    }
    catch {
        Add-Debug "Não foi possível validar ligação EXO: $($_.Exception.Message)"
    }

    Add-Debug "Exchange Online não conectado. A iniciar ligação otimizada..."

    $ConnectParams = @{
        ShowBanner  = $false
        ErrorAction = "Stop"
    }

    $ConnectCommand = Get-Command Connect-ExchangeOnline -ErrorAction Stop

    if ($ConnectCommand.Parameters.ContainsKey("SkipLoadingFormatData")) {
        $ConnectParams.SkipLoadingFormatData = $true
    }

    if ($ConnectCommand.Parameters.ContainsKey("CommandName")) {
        $ConnectParams.CommandName = @("Get-EXOMailbox", "Get-EXORecipient", "Enable-Mailbox", "Set-Mailbox")
    }

    Connect-ExchangeOnline @ConnectParams | Out-Null
    $script:MeuExoConnected = $true
}

function Get-MeuExoCandidates {
    param(
        [string]$InputUser,
        $EntraUser = $null,
        $LocalAD = $null
    )

    $Candidates = New-Object System.Collections.Generic.List[string]

    foreach ($Value in @(
        $InputUser,
        $EntraUser.userPrincipalName,
        $EntraUser.mail,
        $LocalAD.UserPrincipalName,
        $LocalAD.Mail,
        $LocalAD.SamAccountName
    )) {
        if (-not [string]::IsNullOrWhiteSpace("$Value")) {
            [void]$Candidates.Add("$Value")
        }
    }

    try {
        foreach ($Proxy in @($EntraUser.proxyAddresses)) {
            if ($Proxy -match "^(smtp|SMTP):(.+)$") {
                [void]$Candidates.Add($Matches[2])
            }
        }
    }
    catch {}

    @(
        $Candidates |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        ForEach-Object { $_.Trim() } |
        Select-Object -Unique
    )
}

function Get-MeuExoMailboxInfo {
    param(
        [string]$InputUser,
        $EntraUser = $null,
        $LocalAD = $null
    )

    $Candidates = Get-MeuExoCandidates -InputUser $InputUser -EntraUser $EntraUser -LocalAD $LocalAD

    if (-not $Candidates -or $Candidates.Count -eq 0) {
        return [PSCustomObject]@{
            Found          = $false
            Existe         = "Não"
            Detalhe        = "Sem identificadores para pesquisar no EXO"
            Mailbox        = $null
            ArchiveStatus  = "Não disponível"
            ArchiveEnabled = $false
        }
    }

    Ensure-ExchangeOnlineConnected

    foreach ($Candidate in $Candidates) {
        try {
            Add-Debug "Pesquisar EXO mailbox: $Candidate"

            $Mailbox = Get-EXOMailbox `
                -Identity $Candidate `
                -Properties ArchiveStatus,PrimarySmtpAddress,RecipientTypeDetails,ExternalDirectoryObjectId `
                -ErrorAction Stop

            if ($Mailbox) {
                $ArchiveStatus = "$($Mailbox.ArchiveStatus)"
                $ArchiveEnabled = $ArchiveStatus -ieq "Active"

                return [PSCustomObject]@{
                    Found          = $true
                    Existe         = "Sim"
                    Detalhe        = "Mailbox encontrada: $($Mailbox.PrimarySmtpAddress) [$($Mailbox.RecipientTypeDetails)]"
                    Mailbox        = $Mailbox
                    ArchiveStatus  = if ($ArchiveStatus) { $ArchiveStatus } else { "None" }
                    ArchiveEnabled = $ArchiveEnabled
                }
            }
        }
        catch {
            Add-Debug "Não encontrado como mailbox EXO ($Candidate): $($_.Exception.Message)"
        }
    }

    return [PSCustomObject]@{
        Found          = $false
        Existe         = "Não"
        Detalhe        = "Não encontrado no Exchange Online"
        Mailbox        = $null
        ArchiveStatus  = "Não disponível"
        ArchiveEnabled = $false
    }
}

function Enable-MeuArchiveOnline {
    param([string]$InputUser)

    $EntraUser = Search-EntraUser -InputUser $InputUser
    $Info = Get-MeuExoMailboxInfo -InputUser $InputUser -EntraUser $EntraUser -LocalAD $null

    if (-not $Info.Found) {
        throw $Info.Detalhe
    }

    if ($Info.ArchiveEnabled) {
        return [PSCustomObject]@{
            user           = "$($Info.Mailbox.PrimarySmtpAddress)"
            archiveStatus  = $Info.ArchiveStatus
            archiveEnabled = $true
            alreadyActive  = $true
            mensagem       = "Arquivo Online já estava ativo."
        }
    }

    $Identity = "$($Info.Mailbox.PrimarySmtpAddress)"
    Add-Debug "A enviar comando Enable-Mailbox -Archive para $Identity"

    Enable-Mailbox -Identity $Identity -Archive -ErrorAction Stop | Out-Null

    [PSCustomObject]@{
        user           = $Identity
        archiveStatus  = "Provisioning"
        archiveEnabled = $true
        alreadyActive  = $false
        mensagem       = "Pedido de ativação do Arquivo Online enviado com sucesso. A disponibilização final é processada pelo Exchange Online em segundo plano."
    }
}

function Set-MeuRecipientLimit {
    param([string]$InputUser, [int]$Limit)

    if ($Limit -lt 1 -or $Limit -gt 1000) {
        throw "O limite deve ser um número inteiro entre 1 e 1000."
    }

    $EntraUser = Search-EntraUser -InputUser $InputUser
    $Info = Get-MeuExoMailboxInfo -InputUser $InputUser -EntraUser $EntraUser -LocalAD $null
    if (-not $Info.Found) { throw $Info.Detalhe }
    if (-not (Get-Command Set-Mailbox -ErrorAction SilentlyContinue)) {
        throw "O comando Set-Mailbox não está disponível na sessão Exchange Online."
    }

    $Identity = "$($Info.Mailbox.PrimarySmtpAddress)"
    Set-Mailbox -Identity $Identity -RecipientLimits $Limit -Confirm:$false -ErrorAction Stop | Out-Null

    [PSCustomObject]@{
        user = $Identity
        limit = $Limit
        mensagem = "Limite de destinatários definido para $Limit em $Identity."
    }
}

function Build-ResultadoTexto {
    param(
        [string]$InputUser,
        $EntraUser,
        $ADInfo
    )

    if (-not $EntraUser) {
        return "Resultado: NÃO ENCONTRADO`r`n`r`nO utilizador '$InputUser' não foi encontrado no Entra ID."
    }

    $Estado = if ($EntraUser.accountEnabled -eq $true) { "Ativo" } elseif ($EntraUser.accountEnabled -eq $false) { "Desativado" } else { "Não disponível" }
    $Email = if ($EntraUser.mail) { $EntraUser.mail } else { "Sem email preenchido" }
    $ProxyList = if ($EntraUser.proxyAddresses) { @($EntraUser.proxyAddresses) -join "`r`n" } else { "Sem proxyAddresses" }

    if ($ADInfo.Found) {
        $ADStatus = if ($ADInfo.Enabled) { "Ativo" } else { "Desativado" }
        $ADResult = "Domínio AD Local: $($ADInfo.Domain)`r`nSamAccountName: $($ADInfo.SamAccountName)`r`nEstado AD Local: $ADStatus`r`nData de criação no AD: $($ADInfo.WhenCreated)`r`nDN: $($ADInfo.DistinguishedName)"
    }
    else {
        $ADResult = "Domínio AD Local: Não encontrado em central.rinterna.local nem rede.rinterna.local`r`nData de criação no AD: Não disponível"
    }

    "Resultado: ENCONTRADO NO ENTRA ID`r`n`r`nNome: $($EntraUser.displayName)`r`nUPN: $($EntraUser.userPrincipalName)`r`nEmail: $Email`r`nEstado Entra ID: $Estado`r`nObject ID: $($EntraUser.id)`r`n`r`nDados do AD Local:`r`n$ADResult`r`n`r`nProxyAddresses:`r`n$ProxyList"
}

try {
    $Action = Get-QueryValue -QueryObject $Query -Name "action"
    $InputUser = Get-QueryValue -QueryObject $Query -Name "user"

    $MutatingActions = @(
        "criar-email-responsavel",
        "escolher-manual-mfa",
        "criar-tpa",
        "atribuir-e3",
        "ativar-arquivo-online",
        "definir-limite-destinatarios"
    )
    if ($Action -in $MutatingActions -and ([string]$Method).ToUpperInvariant() -ne "POST") {
        JsonResponse @{ success = $false; error = "Esta ação requer o método POST." }
        return
    }

    Add-Debug "Action recebida: $Action"
    Add-Debug "Utilizador recebido: $InputUser"

    if ($Action -eq "configuracao") {
        $Settings = $Config.moduleSettings.criacaoUserMeu
        $OperatorName = [Environment]::UserName
        try {
            if (Get-Command Get-ADUser -ErrorAction SilentlyContinue) {
                $CurrentAdUser = Get-ADUser -Identity ([Environment]::UserName) -Properties DisplayName -ErrorAction Stop
                if (-not [string]::IsNullOrWhiteSpace([string]$CurrentAdUser.DisplayName)) {
                    $OperatorName = [string]$CurrentAdUser.DisplayName
                }
            }
        }
        catch { Add-Debug "Nome completo do operador indisponível: $($_.Exception.Message)" }

        JsonResponse @{
            success = $true
            data = @{
                manualMfaPath = [string]$Settings.manualMfaPath
                defaultCc = [string]$Settings.defaultCc
                e3Group = [string]$Settings.e3Group
                operatorName = $OperatorName
            }
        }
        return
    }

    if ($Action -eq "criar-email-responsavel") {
        $PayloadEmail = Get-MeuEmailPayload -QueryObject $Query

        if (-not $PayloadEmail) {
            throw "Dados compactos do email não recebidos."
        }

        $HtmlEmail = New-MeuProfessionalEmailHtml -Payload $PayloadEmail

        New-MeuOutlookEmailResponsavel `
            -To "$($PayloadEmail.to)" `
            -Cc "$($PayloadEmail.cc)" `
            -Subject "$($PayloadEmail.subject)" `
            -Html $HtmlEmail `
            -Attachment "$($PayloadEmail.attachment)"

        JsonResponse @{
            success = $true
            data = @{
                to             = "$($PayloadEmail.to)"
                cc             = "$($PayloadEmail.cc)"
                subject        = "$($PayloadEmail.subject)"
                attachment     = "$($PayloadEmail.attachment)"
                template       = "MEU_EMAIL_PROFISSIONAL_V3"
                resultadoTexto = "Email profissional criado no Outlook para validação antes do envio."
            }
            debug = $Debug
        }
        return
    }

if ($Action -eq "escolher-manual-mfa") {
        $Path = Select-MeuManualMfa

        if ([string]::IsNullOrWhiteSpace($Path)) {
            JsonResponse @{ success = $false; error = "Nenhum ficheiro selecionado."; debug = $Debug }
            return
        }

        JsonResponse @{ success = $true; data = @{ path = $Path }; debug = $Debug }
        return
    }

    if ($Action -eq "buscar-email") {
        if ([string]::IsNullOrWhiteSpace($InputUser)) { throw "Informe um utilizador para pesquisar o email." }
        $EmailEncontrado = Find-MeuEmailUsuario -InputUser $InputUser

        JsonResponse @{
            success = (-not [string]::IsNullOrWhiteSpace($EmailEncontrado))
            data    = @{ user = $InputUser; email = $EmailEncontrado }
            debug   = $Debug
        }
        return
    }

    if ($Action -eq "criar-tpa") {
        if ([string]::IsNullOrWhiteSpace($InputUser)) { throw "Informe um utilizador para criar o TPA." }
        $Tpa = New-MeuTemporaryAccessPass -InputUser $InputUser

        JsonResponse @{
            success = $true
            data = @{
                user                = "$($Tpa.UserPrincipalName)"
                temporaryAccessPass = "$($Tpa.TemporaryAccessPass)"
                validade            = "8 horas"
                lifetimeInMinutes   = $Tpa.LifetimeInMinutes
                isUsableOnce        = $Tpa.IsUsableOnce
                resultadoTexto      = "TPA criado com sucesso para $($Tpa.UserPrincipalName).`r`nValidade: 8 horas`r`nMultiuso: Sim`r`n`r`nTPA: $($Tpa.TemporaryAccessPass)"
            }
            debug = $Debug
        }
        return
    }

    if ($Action -eq "verificar-e3") {
        if ([string]::IsNullOrWhiteSpace($InputUser)) { throw "Informe um utilizador para verificar a licença E3." }
        $E3 = Get-MeuE3Status -InputUser $InputUser

        JsonResponse @{
            success = $true
            data = @{
                user           = "$($E3.UserPrincipalName)"
                grupo          = "$($E3.GroupName)"
                temLicenca     = [bool]$E3.TemLicenca
                mensagem       = if ($E3.TemLicenca) { "Licença E3 atribuída" } else { "Licença E3 não atribuída" }
                resultadoTexto = if ($E3.TemLicenca) { "O utilizador $($E3.UserPrincipalName) já possui licença E3." } else { "O utilizador $($E3.UserPrincipalName) não possui licença E3." }
            }
            debug = $Debug
        }
        return
    }

    if ($Action -eq "atribuir-e3") {
        if ([string]::IsNullOrWhiteSpace($InputUser)) { throw "Informe um utilizador para atribuir a licença E3." }
        $E3 = Add-MeuE3License -InputUser $InputUser

        JsonResponse @{
            success = $true
            data = @{
                user           = "$($E3.UserPrincipalName)"
                grupo          = "$($E3.GroupName)"
                temLicenca     = [bool]$E3.TemLicenca
                mensagem       = "Licença E3 atribuída/verificada"
                resultadoTexto = "Utilizador $($E3.UserPrincipalName) associado ao grupo GR_PT_M365_E3 com sucesso. A propagação da licença é processada pelo Microsoft 365 em segundo plano."
            }
            debug = $Debug
        }
        return
    }

    if ($Action -eq "verificar-exo") {
        if ([string]::IsNullOrWhiteSpace($InputUser)) { throw "Informe um utilizador para verificar o Exchange Online." }

        $EntraUser = Search-EntraUser -InputUser $InputUser
        $Exo = Get-MeuExoMailboxInfo -InputUser $InputUser -EntraUser $EntraUser -LocalAD $null
        $Connection = Get-ConnectionInformation -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Connected" } | Select-Object -First 1

        JsonResponse @{
            success = $true
            data = @{
                exoExiste      = $Exo.Existe
                exoDetalhe     = $Exo.Detalhe
                archiveStatus  = $Exo.ArchiveStatus
                archiveEnabled = [bool]$Exo.ArchiveEnabled
                exoAccount     = if ($Connection) { "$($Connection.UserPrincipalName)" } else { "" }
            }
            debug = $Debug
        }
        return
    }

    if ($Action -eq "ativar-arquivo-online") {
        if ([string]::IsNullOrWhiteSpace($InputUser)) { throw "Informe um utilizador para ativar o Arquivo Online." }
        $Archive = Enable-MeuArchiveOnline -InputUser $InputUser
        $Connection = Get-ConnectionInformation -ErrorAction SilentlyContinue | Where-Object { $_.State -eq "Connected" } | Select-Object -First 1

        JsonResponse @{
            success = $true
            data = @{
                user           = $Archive.user
                archiveStatus  = $Archive.archiveStatus
                archiveEnabled = [bool]$Archive.archiveEnabled
                alreadyActive  = [bool]$Archive.alreadyActive
                mensagem       = $Archive.mensagem
                exoAccount     = if ($Connection) { "$($Connection.UserPrincipalName)" } else { "" }
                resultadoTexto = $Archive.mensagem
            }
            debug = $Debug
        }
        return
    }

    if ($Action -eq "definir-limite-destinatarios") {
        if ([string]::IsNullOrWhiteSpace($InputUser)) { throw "Informe um utilizador para definir o limite de destinatários." }

        $LimitText = Get-QueryValue -QueryObject $Query -Name "limit"
        $Limit = 0
        if (-not [int]::TryParse($LimitText, [ref]$Limit) -or $Limit -lt 1 -or $Limit -gt 1000) {
            throw "Informe um limite inteiro entre 1 e 1000."
        }

        $RecipientLimit = Set-MeuRecipientLimit -InputUser $InputUser -Limit $Limit
        JsonResponse @{
            success = $true
            data = @{
                user           = $RecipientLimit.user
                limit          = $RecipientLimit.limit
                mensagem       = $RecipientLimit.mensagem
                resultadoTexto = $RecipientLimit.mensagem
            }
            debug = $Debug
        }
        return
    }

    if ($Action -ne "pesquisar") {
        JsonResponse @{ success = $false; error = "Action inválida: $Action"; debug = $Debug }
        return
    }

    if ([string]::IsNullOrWhiteSpace($InputUser)) {
        throw "Informe um utilizador para pesquisar."
    }

    $EntraUser = Search-EntraUser -InputUser $InputUser
    $Context = Initialize-MeuGraph

    if ($EntraUser) {
        $ADInfo = Search-LocalADUser -InputUser $InputUser -UPN "$($EntraUser.userPrincipalName)" -Email "$($EntraUser.mail)"
    }
    else {
        $ADInfo = Search-LocalADUser -InputUser $InputUser -UPN "" -Email ""
    }

    $Texto = Build-ResultadoTexto -InputUser $InputUser -EntraUser $EntraUser -ADInfo $ADInfo
    $EstadoEntra = if ($EntraUser -and $EntraUser.accountEnabled -eq $true) { "Ativo" } elseif ($EntraUser -and $EntraUser.accountEnabled -eq $false) { "Desativado" } else { "Não disponível" }
    $EstadoAD = if ($ADInfo.Found -and $ADInfo.Enabled) { "Ativo" } elseif ($ADInfo.Found -and -not $ADInfo.Enabled) { "Desativado" } else { "Não encontrado" }

    JsonResponse @{
        success = $true
        data = @{
            user           = $InputUser
            graphAccount   = "$($Context.Account)"
            nome           = if ($EntraUser) { "$($EntraUser.displayName)" } else { "" }
            upn            = if ($EntraUser) { "$($EntraUser.userPrincipalName)" } else { "" }
            emailEntra     = if ($EntraUser -and $EntraUser.mail) { "$($EntraUser.mail)" } else { "Sem email preenchido" }
            estadoEntra    = $EstadoEntra
            objectId       = if ($EntraUser) { "$($EntraUser.id)" } else { "" }
            dominioAD      = if ($ADInfo.Found) { "$($ADInfo.Domain)" } else { "Não encontrado" }
            samAccountName = if ($ADInfo.Found) { "$($ADInfo.SamAccountName)" } else { "" }
            estadoAD       = $EstadoAD
            dataCriacaoAD  = if ($ADInfo.Found) { "$($ADInfo.WhenCreated)" } else { "Não disponível" }
            dn             = if ($ADInfo.Found) { "$($ADInfo.DistinguishedName)" } else { "" }
            exoExiste      = "A verificar..."
            exoDetalhe     = "Consulta EXO iniciada em segundo plano pelo frontend."
            resultadoTexto = $Texto
        }
        debug = $Debug
    }
}
catch {
    Add-Debug "Erro geral: $($_.Exception.Message)"

    JsonResponse @{
        success = $false
        error   = $_.Exception.Message
        debug   = $Debug
    }
}
