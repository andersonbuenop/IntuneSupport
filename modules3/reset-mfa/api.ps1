$ErrorActionPreference = "Stop"

$MaxVerifyAttempts = 6
$VerifySleepSeconds = 5
$RequiredGraphScopes = @(
    "UserAuthenticationMethod.ReadWrite.All",
    "User.Read.All"
)
$ResetMfaApprovalRecipients = @(
    "s613220@corp.santander.pt",
    "S613637@corp.santander.pt",
    "S612160@corp.santander.pt"
)
$ResetMfaSenderAddress = "User.Action.Required@santander.pt"

function New-ResetMfaResult {
    param(
        [bool]$Success,
        [string]$Message,
        [object]$Data = $null
    )

    [pscustomobject]@{
        success = $Success
        message = $Message
        data    = $Data
    }
}

function Get-QueryValue {
    param([string]$Name)

    if (-not [string]::IsNullOrWhiteSpace([string]$ModuleApiBody)) {
        try {
            if (-not $script:ResetMfaRequestBodyParsed) {
                $script:ResetMfaRequestBody = $ModuleApiBody | ConvertFrom-Json -ErrorAction Stop
                $script:ResetMfaRequestBodyParsed = $true
            }

            $Property = $script:ResetMfaRequestBody.PSObject.Properties[$Name]
            if ($Property -and -not [string]::IsNullOrWhiteSpace([string]$Property.Value)) {
                return [string]$Property.Value
            }
        }
        catch {
            throw "Corpo JSON inválido: $($_.Exception.Message)"
        }
    }

    if ($Request -and $Request.QueryString) {
        $Value = $Request.QueryString[$Name]
        if (![string]::IsNullOrWhiteSpace($Value)) {
            return $Value
        }
    }

    if ($Request -and $Request.Url -and $Request.Url.Query) {
        $QueryText = $Request.Url.Query.TrimStart("?")

        foreach ($Pair in ($QueryText -split "&")) {
            $Parts = $Pair -split "=", 2

            if ($Parts.Count -eq 2 -and $Parts[0] -eq $Name) {
                return [System.Uri]::UnescapeDataString($Parts[1])
            }
        }
    }

    return $null
}

function Import-GraphResetMfa {
    Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
    Import-Module Microsoft.Graph.Users -ErrorAction Stop
    Import-Module Microsoft.Graph.Identity.SignIns -ErrorAction Stop
}

function Get-GraphConnectionInfo {
    $Context = Get-MgContext
    $GrantedScopes = @()

    if ($Context -and $Context.Scopes) {
        $GrantedScopes = @($Context.Scopes)
    }

    $MissingScopes = @(
        foreach ($Scope in $RequiredGraphScopes) {
            if ($GrantedScopes -notcontains $Scope) {
                $Scope
            }
        }
    )

    [pscustomobject]@{
        connected     = [bool]$Context
        ready         = ([bool]$Context -and $MissingScopes.Count -eq 0)
        account       = if ($Context) { $Context.Account } else { $null }
        tenantId      = if ($Context) { $Context.TenantId } else { $null }
        scopes        = $GrantedScopes
        missingScopes = $MissingScopes
    }
}

function Assert-GraphReady {
    $Info = Get-GraphConnectionInfo

    if (!$Info.connected) {
        throw "Microsoft Graph não está conectado. Utilize o botão Conectar Graph."
    }

    if (!$Info.ready) {
        throw "A sessão Microsoft Graph não possui os scopes necessários: $($Info.missingScopes -join ', '). Reconecte o Graph."
    }

    return $Info
}

function Escape-GraphFilterValue {
    param([string]$Value)

    if ($null -eq $Value) {
        return ""
    }

    return $Value.Replace("'", "''")
}

function Get-AuthenticationMethodType {
    param($Method)

    $Type = ""

    if ($Method -and $Method.AdditionalProperties) {
        $Type = [string]$Method.AdditionalProperties["@odata.type"]
    }

    if ([string]::IsNullOrWhiteSpace($Type) -and $Method.PSObject.Properties.Name -contains "OdataType") {
        $Type = [string]$Method.OdataType
    }

    return $Type
}

function Get-FriendlyMethodName {
    param([string]$Type)

    switch -Regex ($Type) {
        "fido2AuthenticationMethod" { return "FIDO2 / Chave de segurança" }
        "emailAuthenticationMethod" { return "Email de autenticação" }
        "microsoftAuthenticatorAuthenticationMethod" { return "Microsoft Authenticator" }
        "phoneAuthenticationMethod" { return "Telefone (SMS/Chamada)" }
        "softwareOathAuthenticationMethod" { return "Software OATH (TOTP)" }
        "temporaryAccessPassAuthenticationMethod" { return "Temporary Access Pass" }
        "windowsHelloForBusinessAuthenticationMethod" { return "Windows Hello for Business" }
        "passwordAuthenticationMethod" { return "Password" }
        default {
            if ([string]::IsNullOrWhiteSpace($Type)) {
                return "Método desconhecido"
            }

            return $Type
        }
    }
}

function Get-MethodClassification {
    param([string]$Type)

    switch -Regex ($Type) {
        "passwordAuthenticationMethod" {
            return [pscustomobject]@{
                category  = "Password"
                removable = $false
                protected = $true
                isMfa     = $false
                reason    = "A password é protegida e nunca é removida por este módulo."
            }
        }
        "microsoftAuthenticatorAuthenticationMethod|phoneAuthenticationMethod|softwareOathAuthenticationMethod" {
            return [pscustomobject]@{
                category  = "StandardMfa"
                removable = $true
                protected = $false
                isMfa     = $true
                reason    = "Método incluído no reset MFA padrão."
            }
        }
        "fido2AuthenticationMethod|emailAuthenticationMethod|temporaryAccessPassAuthenticationMethod|windowsHelloForBusinessAuthenticationMethod" {
            return [pscustomobject]@{
                category  = "ProtectedSpecial"
                removable = $false
                protected = $true
                isMfa     = $true
                reason    = "Método especial protegido por segurança."
            }
        }
        default {
            return [pscustomobject]@{
                category  = "ProtectedUnknown"
                removable = $false
                protected = $true
                isMfa     = $true
                reason    = "Tipo não reconhecido; protegido por segurança."
            }
        }
    }
}

function Get-FormattedUserAddress {
    param($User)

    $Parts = @()

    if ($User.StreetAddress) {
        $Parts += $User.StreetAddress
    }

    $Localidade = @()

    if ($User.City) {
        $Localidade += $User.City
    }

    if ($User.State) {
        $Localidade += $User.State
    }

    if ($User.PostalCode) {
        $Localidade += $User.PostalCode
    }

    if ($Localidade.Count -gt 0) {
        $Parts += ($Localidade -join " - ")
    }

    if ($User.Country) {
        $Parts += $User.Country
    }

    if ($User.OfficeLocation) {
        $Parts += ("Office: " + $User.OfficeLocation)
    }

    if ($Parts.Count -eq 0) {
        return "Sem address/morada preenchido."
    }

    return ($Parts -join "`n")
}

function Resolve-ResetMfaUser {
    param([string]$Identifier)

    $Props = "id,displayName,userPrincipalName,mail,employeeId,department,jobTitle,accountEnabled,streetAddress,city,state,postalCode,country,officeLocation,mailNickname"
    $SearchValue = [string]$Identifier

    if ([string]::IsNullOrWhiteSpace($SearchValue)) {
        throw "Informe um user, email, UPN ou Object ID."
    }

    $SearchValue = $SearchValue.Trim()
    $DirectError = $null

    try {
        $DirectUser = Get-MgUser -UserId $SearchValue -Property $Props -ErrorAction Stop

        if ($DirectUser) {
            return $DirectUser
        }
    }
    catch {
        $DirectError = $_.Exception.Message
    }

    $Escaped = Escape-GraphFilterValue $SearchValue
    $Filter = "startswith(userPrincipalName,'$Escaped') or startswith(mail,'$Escaped') or startswith(mailNickname,'$Escaped')"

    try {
        $Users = @(
            Get-MgUser `
                -Filter $Filter `
                -Property $Props `
                -ConsistencyLevel eventual `
                -Top 25 `
                -ErrorAction Stop
        )
    }
    catch {
        if ($DirectError -match "Authorization|Insufficient|Forbidden|scope|permission") {
            throw "Não foi possível consultar o utilizador por falta de permissão no Microsoft Graph. $DirectError"
        }

        throw "Falha ao pesquisar o utilizador no Microsoft Graph: $($_.Exception.Message)"
    }

    if ($Users.Count -eq 1) {
        return $Users[0]
    }

    if ($Users.Count -gt 1) {
        $Lista = ($Users | Select-Object -First 10 | ForEach-Object {
            "$($_.DisplayName) <$($_.UserPrincipalName)>"
        }) -join "`n"

        throw "Foram encontrados vários utilizadores para '$SearchValue'. Refine a pesquisa:`n$Lista"
    }

    throw "Utilizador não encontrado para '$SearchValue'."
}

function Assert-ExpectedUser {
    param(
        $User,
        [string]$ExpectedUpn
    )

    if (![string]::IsNullOrWhiteSpace($ExpectedUpn)) {
        if ([string]::Compare($User.UserPrincipalName, $ExpectedUpn, $true) -ne 0) {
            throw "A identidade confirmada não corresponde ao utilizador exibido na tela. Pesquise novamente antes de continuar."
        }
    }
}

function Get-UserManagerInfoFromGraph {
    param([string]$UserId)

    $Empty = [pscustomobject]@{
        id                = ""
        displayName       = ""
        userPrincipalName = ""
        mail              = ""
        employeeId        = ""
        source            = ""
    }

    try {
        $ManagerRef = Get-MgUserManager -UserId $UserId -ErrorAction Stop

        if (!$ManagerRef) {
            return $Empty
        }

        $ManagerId = $null

        if ($ManagerRef.Id) {
            $ManagerId = $ManagerRef.Id
        }
        elseif ($ManagerRef.AdditionalProperties -and $ManagerRef.AdditionalProperties.ContainsKey("id")) {
            $ManagerId = $ManagerRef.AdditionalProperties["id"]
        }

        if (!$ManagerId) {
            return $Empty
        }

        $ManagerUser = Get-MgUser `
            -UserId $ManagerId `
            -Property "id,displayName,userPrincipalName,mail,employeeId" `
            -ErrorAction Stop

        return [pscustomobject]@{
            id                = $ManagerUser.Id
            displayName       = $ManagerUser.DisplayName
            userPrincipalName = $ManagerUser.UserPrincipalName
            mail              = $ManagerUser.Mail
            employeeId        = $ManagerUser.EmployeeId
            source            = "Graph"
        }
    }
    catch {
        return $Empty
    }
}

function Get-UserManagerHierarchy {
    param(
        [string]$UserId,
        [int]$MaxLevels = 4
    )

    $Hierarchy = @()
    $CurrentUserId = $UserId
    $Visited = @{}

    for ($Level = 1; $Level -le $MaxLevels; $Level++) {
        if ([string]::IsNullOrWhiteSpace($CurrentUserId)) {
            break
        }

        if ($Visited.ContainsKey($CurrentUserId)) {
            break
        }

        $Visited[$CurrentUserId] = $true
        $Manager = Get-UserManagerInfoFromGraph -UserId $CurrentUserId

        if (!$Manager -or [string]::IsNullOrWhiteSpace($Manager.id)) {
            break
        }

        $Hierarchy += [pscustomobject]@{
            level             = $Level
            role              = if ($Level -eq 1) { "Manager direto" } else { "$Level.º nível hierárquico" }
            id                = $Manager.id
            displayName       = $Manager.displayName
            userPrincipalName = $Manager.userPrincipalName
            mail              = $Manager.mail
            employeeId        = $Manager.employeeId
            source            = $Manager.source
        }

        $CurrentUserId = $Manager.id
    }

    return $Hierarchy
}

function Get-AllowedTicketApprovers {
    param([object[]]$Hierarchy)

    return @(
        $Hierarchy |
        Select-Object -First 2 |
        ForEach-Object {
            [pscustomobject]@{
                level             = $_.level
                role              = $_.role
                id                = $_.id
                displayName       = $_.displayName
                userPrincipalName = $_.userPrincipalName
                mail              = $_.mail
                employeeId        = $_.employeeId
                source            = $_.source
                contacts          = (@($_.userPrincipalName, $_.mail) | Where-Object { $_ } | Select-Object -Unique) -join " | "
            }
        }
    )
}

function Get-MethodsForUser {
    param([string]$UserId)

    $AllMethods = @(Get-MgUserAuthenticationMethod -UserId $UserId -ErrorAction Stop)

    return @(
        foreach ($Method in $AllMethods) {
            $Type = Get-AuthenticationMethodType -Method $Method
            $Classification = Get-MethodClassification -Type $Type

            [pscustomobject]@{
                id        = $Method.Id
                type      = $Type
                name      = Get-FriendlyMethodName -Type $Type
                category  = $Classification.category
                removable = $Classification.removable
                protected = $Classification.protected
                isMfa     = $Classification.isMfa
                reason    = $Classification.reason
            }
        }
    )
}

function Remove-ResetMfaMethod {
    param(
        [string]$UserId,
        $Method
    )

    $Type = [string]$Method.type
    $Id = [string]$Method.id

    if ($Method.removable -ne $true) {
        return "SKIPPED"
    }

    switch -Regex ($Type) {
        "microsoftAuthenticatorAuthenticationMethod" {
            Remove-MgUserAuthenticationMicrosoftAuthenticatorMethod `
                -UserId $UserId `
                -MicrosoftAuthenticatorAuthenticationMethodId $Id `
                -ErrorAction Stop
        }
        "phoneAuthenticationMethod" {
            Remove-MgUserAuthenticationPhoneMethod `
                -UserId $UserId `
                -PhoneAuthenticationMethodId $Id `
                -ErrorAction Stop
        }
        "softwareOathAuthenticationMethod" {
            Remove-MgUserAuthenticationSoftwareOathMethod `
                -UserId $UserId `
                -SoftwareOathAuthenticationMethodId $Id `
                -ErrorAction Stop
        }
        default {
            throw "Tipo não suportado pelo reset padrão: $Type"
        }
    }

    return "REMOVED"
}

function Test-TransientGraphError {
    param([string]$Message)

    if ([string]::IsNullOrWhiteSpace($Message)) {
        return $false
    }

    return [bool]($Message -match "429|Too Many Requests|temporar|timeout|timed out|Service Unavailable|503|gateway|connection.*closed")
}

function Get-WindowsOperator {
    $WinUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $Sam = $env:USERNAME
    $FullName = ""

    try {
        $Adsi = [ADSI]"WinNT://$env:USERDOMAIN/$env:USERNAME,user"
        $FullName = [string]$Adsi.FullName
    }
    catch {
        $FullName = ""
    }

    if ([string]::IsNullOrWhiteSpace($FullName)) {
        $FullName = $Sam
    }

    return [pscustomobject]@{
        windowsUser = $WinUser
        username    = $Sam
        fullName    = $FullName
    }
}

function Get-ApprovedRequesterConfigPath {
    return (Join-Path $PSScriptRoot "approved-requesters.json")
}

function New-DefaultApprovedRequesterConfig {
    [pscustomobject]@{
        version    = 1
        updatedAt  = ""
        updatedBy  = ""
        requesters = @()
    }
}

function Save-ApprovedRequesterConfig {
    param(
        [Parameter(Mandatory = $true)]
        $Config
    )

    $ConfigPath = Get-ApprovedRequesterConfigPath
    $TempPath = "$ConfigPath.tmp"
    $Encoding = New-Object System.Text.UTF8Encoding($true)

    if ($null -eq $Config.requesters) {
        $Config.requesters = @()
    }

    $Mutex = New-Object System.Threading.Mutex($false, "SantanderSupportWebV2ResetMfaApprovedRequesters")
    $Acquired = $false

    try {
        try { $Acquired = $Mutex.WaitOne(10000) }
        catch [System.Threading.AbandonedMutexException] { $Acquired = $true }
        if (!$Acquired) { throw "Tempo excedido ao guardar a lista de pré-aprovados." }

        $Json = $Config | ConvertTo-Json -Depth 8
        [System.IO.File]::WriteAllText($TempPath, $Json, $Encoding)
        Move-Item -LiteralPath $TempPath -Destination $ConfigPath -Force
    }
    finally {
        if ($Acquired) { try { $Mutex.ReleaseMutex() } catch {} }
        $Mutex.Dispose()
        if (Test-Path -LiteralPath $TempPath) { Remove-Item -LiteralPath $TempPath -Force -ErrorAction SilentlyContinue }
    }
}

function Send-ResetMfaApprovalEmail {
    param(
        [Parameter(Mandatory = $true)]$User,
        [Parameter(Mandatory = $true)]$RequestContext,
        [Parameter(Mandatory = $true)]$Operator,
        [switch]$PreviewOnly
    )

    $Hierarchy = @(Get-UserManagerHierarchy -UserId $User.Id -MaxLevels 2)
    if ($Hierarchy.Count -gt 0) {
        throw "O utilizador possui responsável hierárquico. Utilize o fluxo normal de validação do manager."
    }

    $Recipients = @($ResetMfaApprovalRecipients | Where-Object {
        $_ -match '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    } | Select-Object -Unique)
    if ($Recipients.Count -ne 3) { throw "A lista de destinatários de aprovação está inválida." }

    $Safe = {
        param($Value)
        [Net.WebUtility]::HtmlEncode([string]$Value)
    }
    $Methods = @(Get-MethodsForUser -UserId $User.Id)
    $RemovableCount = @($Methods | Where-Object { $_.removable -eq $true }).Count
    $Subject = "[APROVAÇÃO RESET MFA] $($RequestContext.reference) - $($User.DisplayName)"
    if ($Subject.Length -gt 180 -or $Subject -match '[\r\n]') { throw "Assunto do e-mail de aprovação inválido." }

    $GreetingHour = (Get-Date).Hour
    $Greeting = if ($GreetingHour -lt 12) { "Bom dia" } elseif ($GreetingHour -lt 19) { "Boa tarde" } else { "Boa noite" }
    $Signature = if ([string]::IsNullOrWhiteSpace([string]$Operator.fullName)) { "Equipa de Suporte" } else { [string]$Operator.fullName }
    $Html = @"
<!doctype html>
<html><body style='margin:0;padding:0;background:#f3f3f3;font-family:Segoe UI,Arial,sans-serif;color:#2d2d2d'>
<table role='presentation' width='100%' cellspacing='0' cellpadding='0' border='0' style='background:#f3f3f3'><tr><td align='center' style='padding:24px 12px'>
<table role='presentation' width='680' cellspacing='0' cellpadding='0' border='0' style='width:680px;max-width:100%;background:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,.10)'>
<tr><td style='background:#ec0000;padding:22px 28px;color:#ffffff'><table role='presentation' width='100%'><tr><td style='font-size:25px;font-weight:700;letter-spacing:1.2px;color:#ffffff'>SANTANDER</td><td align='right' style='font-size:12px;line-height:1.4;color:#ffffff'><strong>IT Santander Portugal</strong><br>Reset MFA</td></tr></table></td></tr>
<tr><td style='padding:30px 28px 16px'><div style='font-size:20px;font-weight:700;color:#222222'>Aprovação necessária para Reset MFA</div><p style='font-size:15px;line-height:1.6;color:#3a3a3a'>$Greeting,</p><p style='font-size:15px;line-height:1.6;color:#3a3a3a'>O utilizador abaixo não possui manager ou responsável hierárquico registado no Microsoft Graph. Solicitamos a vossa validação antes de executar o reset dos métodos MFA padrão.</p></td></tr>
<tr><td style='padding:0 28px 18px'><table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='border:1px solid #e1e1e1;background:#fafafa'>
<tr><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1;font-weight:700;width:34%'>Ticket / referência</td><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1'>$(&$Safe $RequestContext.reference)</td></tr>
<tr><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1;font-weight:700'>Origem</td><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1'>$(&$Safe $RequestContext.source)</td></tr>
<tr><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1;font-weight:700'>Utilizador</td><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1'>$(&$Safe $User.DisplayName)</td></tr>
<tr><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1;font-weight:700'>UPN</td><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1'>$(&$Safe $User.UserPrincipalName)</td></tr>
<tr><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1;font-weight:700'>Employee ID</td><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1'>$(&$Safe $User.EmployeeId)</td></tr>
<tr><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1;font-weight:700'>Departamento</td><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1'>$(&$Safe $User.Department)</td></tr>
<tr><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1;font-weight:700'>Cargo</td><td style='padding:10px 14px;border-bottom:1px solid #e1e1e1'>$(&$Safe $User.JobTitle)</td></tr>
<tr><td style='padding:10px 14px;font-weight:700'>Métodos removíveis</td><td style='padding:10px 14px'>$RemovableCount</td></tr>
</table></td></tr>
<tr><td style='padding:0 28px 24px'><table role='presentation' width='100%' style='background:#fff4f4;border:1px solid #f2b8b8;border-left:6px solid #ec0000'><tr><td style='padding:16px 18px'><div style='font-size:13px;text-transform:uppercase;letter-spacing:.6px;font-weight:700;color:#a80000'>Resposta necessária</div><div style='font-size:14px;line-height:1.55;color:#333333;margin-top:6px'><strong>Respondam a este e-mail indicando claramente “Aprovado” ou “Rejeitado”</strong>, mantendo o ticket no assunto. O reset permanecerá bloqueado até a aprovação ser validada no sistema.</div></td></tr></table></td></tr>
<tr><td style='padding:0 28px 25px;font-size:14px;line-height:1.6;color:#333333'>Obrigado,<br><strong>$(&$Safe $Signature)</strong><br>IT Santander Portugal</td></tr>
<tr><td style='background:#24272b;padding:16px 28px;font-size:11px;line-height:17px;color:#ffffff'>Mensagem gerada pelo Santander Support Web V2.</td></tr>
</table></td></tr></table></body></html>
"@

    if ($PreviewOnly) {
        return [pscustomobject]@{
            sender = $ResetMfaSenderAddress
            recipients = $Recipients
            subject = $Subject
            html = $Html
            removableMethodsCount = $RemovableCount
            preview = $true
        }
    }

    try { $Outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
    catch {
        try { $Outlook = New-Object -ComObject Outlook.Application }
        catch { throw "Não foi possível utilizar o Outlook clássico. Confirme que está aberto e configurado na mesma sessão do Windows que executa a aplicação." }
    }

    $Mail = $Outlook.CreateItem(0)
    try {
        foreach ($Account in $Outlook.Session.Accounts) {
            if ([string]$Account.SmtpAddress -ieq $ResetMfaSenderAddress) {
                $Mail.SendUsingAccount = $Account
                break
            }
        }
    } catch {}
    try { $Mail.SentOnBehalfOfName = $ResetMfaSenderAddress } catch {}
    $Mail.To = ($Recipients -join '; ')
    $Mail.Subject = $Subject
    $Mail.HTMLBody = $Html
    if (!$Mail.Recipients.ResolveAll()) { throw "O Outlook não conseguiu validar todos os destinatários." }
    $Mail.Send()

    $SentAt = (Get-Date).ToString("o")
    $LogFolder = Join-Path $PSScriptRoot "logs"
    if (!(Test-Path -LiteralPath $LogFolder)) { New-Item -ItemType Directory -Path $LogFolder -Force | Out-Null }
    [pscustomobject]@{
        sentAt = $SentAt
        channel = "OutlookClassic"
        sender = $ResetMfaSenderAddress
        recipients = $Recipients
        subject = $Subject
        requestReference = $RequestContext.reference
        targetId = $User.Id
        targetUpn = $User.UserPrincipalName
        operator = $Operator.windowsUser
        status = "sent"
    } | ConvertTo-Json -Compress | Add-Content -LiteralPath (Join-Path $LogFolder "reset-mfa-approval-email-audit.jsonl") -Encoding UTF8

    return [pscustomobject]@{
        sender = $ResetMfaSenderAddress
        recipients = $Recipients
        subject = $Subject
        sentAt = $SentAt
        removableMethodsCount = $RemovableCount
    }
}

function Read-ApprovedRequesterConfig {
    $ConfigPath = Get-ApprovedRequesterConfigPath

    if (!(Test-Path -LiteralPath $ConfigPath)) {
        $DefaultConfig = New-DefaultApprovedRequesterConfig
        Save-ApprovedRequesterConfig -Config $DefaultConfig
        return $DefaultConfig
    }

    try {
        $Raw = Get-Content -LiteralPath $ConfigPath -Raw -ErrorAction Stop

        if ([string]::IsNullOrWhiteSpace($Raw)) {
            throw "O ficheiro está vazio."
        }

        $Config = $Raw | ConvertFrom-Json -ErrorAction Stop

        if ($null -eq $Config.requesters) {
            $Config | Add-Member -MemberType NoteProperty -Name requesters -Value @() -Force
        }

        $Config.requesters = @($Config.requesters)

        if ($null -eq $Config.version) {
            $Config | Add-Member -MemberType NoteProperty -Name version -Value 1 -Force
        }

        return $Config
    }
    catch {
        throw "Não foi possível ler approved-requesters.json: $($_.Exception.Message)"
    }
}

function Get-ActiveApprovedRequester {
    param([string]$RequesterId)

    if ([string]::IsNullOrWhiteSpace($RequesterId)) {
        return $null
    }

    $Config = Read-ApprovedRequesterConfig

    return $Config.requesters |
        Where-Object {
            $_.id -eq $RequesterId -and $_.active -eq $true
        } |
        Select-Object -First 1
}

function Get-NormalizedRequestSource {
    param([string]$Source)

    switch (($Source + "").Trim().ToLowerInvariant()) {
        "servicenow" { return "ServiceNow" }
        "teams" { return "Teams" }
        "email" { return "Email" }
        "telefone" { return "Telefone" }
        "phone" { return "Telefone" }
        "outro" { return "Outro" }
        "other" { return "Outro" }
        default { return "ServiceNow" }
    }
}

function Resolve-RequestContext {
    param(
        [string]$Source,
        [string]$Reference
    )

    $NormalizedSource = Get-NormalizedRequestSource -Source $Source
    $NormalizedReference = ($Reference + "").Trim()

    if ($NormalizedSource -eq "Teams" -and [string]::IsNullOrWhiteSpace($NormalizedReference)) {
        $NormalizedReference = "Teams - " + (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    }

    if ([string]::IsNullOrWhiteSpace($NormalizedReference)) {
        switch ($NormalizedSource) {
            "ServiceNow" {
                throw "Informe o número ou referência do pedido no ServiceNow."
            }
            "Email" {
                throw "Informe o assunto ou referência do pedido recebido por email."
            }
            "Telefone" {
                throw "Informe uma referência ou descrição breve do pedido recebido por telefone."
            }
            "Outro" {
                throw "Informe uma referência ou descrição breve da solicitação."
            }
        }
    }

    return [pscustomobject]@{
        source    = $NormalizedSource
        reference = $NormalizedReference
    }
}

function ConvertTo-RequesterSummary {
    param($User)

    if (!$User) {
        return $null
    }

    return [pscustomobject]@{
        id                = $User.Id
        displayName       = $User.DisplayName
        userPrincipalName = $User.UserPrincipalName
        mail              = $User.Mail
        employeeId        = $User.EmployeeId
    }
}

function Test-TicketRequester {
    param(
        $TargetUser,
        [string]$RequesterIdentifier
    )

    if ([string]::IsNullOrWhiteSpace($RequesterIdentifier)) {
        return [pscustomobject]@{
            state             = "NotProvided"
            allowed           = $false
            message           = "Informe a pessoa que solicitou o reset."
            requester         = $null
            matchedRole       = $null
            authorizationRule = $null
            approvedEntry     = $null
            approvers         = @()
        }
    }

    $Requester = Resolve-ResetMfaUser -Identifier $RequesterIdentifier
    $RequesterSummary = ConvertTo-RequesterSummary -User $Requester
    $Hierarchy = @(Get-UserManagerHierarchy -UserId $TargetUser.Id -MaxLevels 4)
    $Approvers = @(Get-AllowedTicketApprovers -Hierarchy $Hierarchy)

    if ($Requester.Id -eq $TargetUser.Id) {
        return [pscustomobject]@{
            state             = "Self"
            allowed           = $false
            message           = "Auto-pedido identificado. É necessária autorização de um responsável elegível ou de um pré-aprovado ativo."
            requester         = $RequesterSummary
            matchedRole       = $null
            authorizationRule = "Auto-pedido bloqueado"
            approvedEntry     = $null
            approvers         = $Approvers
        }
    }

    $MatchedManager = $Approvers |
        Where-Object { $_.id -eq $Requester.Id } |
        Select-Object -First 1

    if ($MatchedManager) {
        return [pscustomobject]@{
            state             = "Manager"
            allowed           = $true
            message           = "Responsável hierárquico elegível identificado."
            requester         = $RequesterSummary
            matchedRole       = $MatchedManager.role
            authorizationRule = $MatchedManager.role
            approvedEntry     = $null
            approvers         = $Approvers
        }
    }

    $ApprovedEntry = Get-ActiveApprovedRequester -RequesterId $Requester.Id

    if ($ApprovedEntry) {
        return [pscustomobject]@{
            state             = "PreApproved"
            allowed           = $true
            message           = "Solicitante pré-aprovado da equipa identificado."
            requester         = $RequesterSummary
            matchedRole       = "Pré-aprovado da equipa"
            authorizationRule = "Pré-aprovado da equipa"
            approvedEntry     = $ApprovedEntry
            approvers         = $Approvers
        }
    }

    return [pscustomobject]@{
        state             = "ThirdParty"
        allowed           = $false
        message           = "O solicitante não corresponde ao manager direto, ao segundo nível hierárquico nem à lista ativa de pré-aprovados."
        requester         = $RequesterSummary
        matchedRole       = $null
        authorizationRule = "Sem autorização automática"
        approvedEntry     = $null
        approvers         = $Approvers
    }
}

function Write-ResetMfaAudit {
    param($Record)

    $AuditMutex = New-Object System.Threading.Mutex($false, "SantanderSupportWebV2ResetMfaAudit")
    $AuditAcquired = $false

    try {
        try { $AuditAcquired = $AuditMutex.WaitOne(10000) }
        catch [System.Threading.AbandonedMutexException] { $AuditAcquired = $true }
        if (!$AuditAcquired) { throw "Tempo excedido ao registar a auditoria do Reset MFA." }
        $LogFolder = Join-Path $PSScriptRoot "logs"

        if (!(Test-Path -LiteralPath $LogFolder)) {
            New-Item -ItemType Directory -Path $LogFolder -Force | Out-Null
        }

        $LogPath = Join-Path $LogFolder "reset-mfa-audit.csv"
        $RequiredColumns = @(
            "Timestamp",
            "RequestSource",
            "RequestReference",
            "Ticket",
            "OperatorWindows",
            "OperatorName",
            "TargetDisplayName",
            "TargetUPN",
            "TargetId",
            "RequesterName",
            "RequesterUPN",
            "RequesterId",
            "AuthorizationState",
            "AuthorizationRule",
            "Status",
            "RemovedCount",
            "FailedCount",
            "RemainingCount",
            "Details"
        )

        if (Test-Path -LiteralPath $LogPath) {
            $FirstLine = Get-Content -LiteralPath $LogPath -TotalCount 1 -ErrorAction SilentlyContinue

            if ($FirstLine -and $FirstLine -notmatch '"RequestSource"') {
                $LegacyRows = @(Import-Csv -LiteralPath $LogPath -ErrorAction Stop)
                $MigratedRows = @(
                    foreach ($Legacy in $LegacyRows) {
                        [pscustomobject]@{
                            Timestamp          = $Legacy.Timestamp
                            RequestSource      = "Legacy"
                            RequestReference   = $Legacy.Ticket
                            Ticket             = $Legacy.Ticket
                            OperatorWindows    = $Legacy.OperatorWindows
                            OperatorName       = $Legacy.OperatorName
                            TargetDisplayName  = $Legacy.TargetDisplayName
                            TargetUPN          = $Legacy.TargetUPN
                            TargetId           = $Legacy.TargetId
                            RequesterName      = $Legacy.RequesterName
                            RequesterUPN       = $Legacy.RequesterUPN
                            RequesterId        = ""
                            AuthorizationState = $Legacy.AuthorizationState
                            AuthorizationRule  = $Legacy.AuthorizationState
                            Status             = $Legacy.Status
                            RemovedCount       = $Legacy.RemovedCount
                            FailedCount        = $Legacy.FailedCount
                            RemainingCount     = $Legacy.RemainingCount
                            Details            = $Legacy.Details
                        }
                    }
                )

                $LegacyBackup = Join-Path $LogFolder ("reset-mfa-audit-legacy-" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".csv")
                Copy-Item -LiteralPath $LogPath -Destination $LegacyBackup -Force

                if ($MigratedRows.Count -gt 0) {
                    $MigratedRows | Export-Csv -LiteralPath $LogPath -NoTypeInformation -Encoding UTF8 -Force
                }
                else {
                    Remove-Item -LiteralPath $LogPath -Force
                }
            }
        }

        $AuditRow = [pscustomobject]@{
            Timestamp          = $Record.Timestamp
            RequestSource      = $Record.RequestSource
            RequestReference   = $Record.RequestReference
            Ticket             = $Record.RequestReference
            OperatorWindows    = $Record.OperatorWindows
            OperatorName       = $Record.OperatorName
            TargetDisplayName  = $Record.TargetDisplayName
            TargetUPN          = $Record.TargetUPN
            TargetId           = $Record.TargetId
            RequesterName      = $Record.RequesterName
            RequesterUPN       = $Record.RequesterUPN
            RequesterId        = $Record.RequesterId
            AuthorizationState = $Record.AuthorizationState
            AuthorizationRule  = $Record.AuthorizationRule
            Status             = $Record.Status
            RemovedCount       = $Record.RemovedCount
            FailedCount        = $Record.FailedCount
            RemainingCount     = $Record.RemainingCount
            Details            = $Record.Details
        }

        $AuditRow | Export-Csv -LiteralPath $LogPath -NoTypeInformation -Encoding UTF8 -Append -Force
    }
    catch {
        # A auditoria não deve interromper a operação principal.
        Write-Warning "Falha ao registar auditoria Reset MFA: $($_.Exception.Message)"
    }
    finally {
        if ($AuditAcquired) { try { $AuditMutex.ReleaseMutex() } catch {} }
        $AuditMutex.Dispose()
    }
}

try {
    $Action = Get-QueryValue "action"

    if ([string]::IsNullOrWhiteSpace($Action)) {
        $Action = "status"
    }

    switch ($Action.ToLowerInvariant()) {
        "status" {
            Import-GraphResetMfa
            $Info = Get-GraphConnectionInfo

            return New-ResetMfaResult `
                -Success $true `
                -Message "Status Microsoft Graph." `
                -Data $Info
        }

        "connect" {
            Import-GraphResetMfa
            $Info = Get-GraphConnectionInfo

            if (!$Info.ready) {
                Connect-MgGraph -Scopes $RequiredGraphScopes -NoWelcome -ErrorAction Stop
                $Info = Get-GraphConnectionInfo
            }

            if (!$Info.ready) {
                throw "Microsoft Graph conectado, mas os scopes necessários não foram concedidos: $($Info.missingScopes -join ', ')."
            }

            return New-ResetMfaResult `
                -Success $true `
                -Message "Microsoft Graph conectado e pronto." `
                -Data $Info
        }

        "search" {
            Import-GraphResetMfa
            Assert-GraphReady | Out-Null

            $UserInput = Get-QueryValue "user"
            $User = Resolve-ResetMfaUser -Identifier $UserInput
            $Hierarchy = @(Get-UserManagerHierarchy -UserId $User.Id -MaxLevels 4)
            $Manager = if ($Hierarchy.Count -gt 0) { $Hierarchy[0] } else { $null }
            $Approvers = @(Get-AllowedTicketApprovers -Hierarchy $Hierarchy)
            $Methods = @(Get-MethodsForUser -UserId $User.Id)
            $RemovableMethods = @($Methods | Where-Object { $_.removable -eq $true })
            $ProtectedMethods = @($Methods | Where-Object { $_.protected -eq $true })

            return New-ResetMfaResult `
                -Success $true `
                -Message "Utilizador encontrado." `
                -Data ([pscustomobject]@{
                    id                       = $User.Id
                    displayName              = $User.DisplayName
                    userPrincipalName        = $User.UserPrincipalName
                    mail                     = $User.Mail
                    employeeId               = $User.EmployeeId
                    department               = $User.Department
                    jobTitle                 = $User.JobTitle
                    accountEnabled           = $User.AccountEnabled
                    streetAddress            = $User.StreetAddress
                    city                     = $User.City
                    state                    = $User.State
                    postalCode               = $User.PostalCode
                    country                  = $User.Country
                    officeLocation           = $User.OfficeLocation
                    formattedAddress         = Get-FormattedUserAddress -User $User
                    managerDisplayName       = if ($Manager) { $Manager.displayName } else { "" }
                    managerUserPrincipalName = if ($Manager) { $Manager.userPrincipalName } else { "" }
                    managerMail              = if ($Manager) { $Manager.mail } else { "" }
                    managerEmployeeId        = if ($Manager) { $Manager.employeeId } else { "" }
                    managerHierarchy         = $Hierarchy
                    allowedApprovers         = $Approvers
                    methodsCount             = @($Methods | Where-Object { $_.isMfa -eq $true }).Count
                    removableMethodsCount    = $RemovableMethods.Count
                    protectedMethodsCount    = $ProtectedMethods.Count
                    allMethodsCount          = $Methods.Count
                    methods                  = $Methods
                })
        }

        "validate-requester" {
            Import-GraphResetMfa
            Assert-GraphReady | Out-Null

            $UserId = Get-QueryValue "userId"
            $ExpectedUpn = Get-QueryValue "expectedUpn"
            $Requester = Get-QueryValue "requester"
            $Source = Get-QueryValue "source"
            $Reference = Get-QueryValue "reference"
            $User = Resolve-ResetMfaUser -Identifier $UserId
            Assert-ExpectedUser -User $User -ExpectedUpn $ExpectedUpn
            $RequestContext = Resolve-RequestContext -Source $Source -Reference $Reference
            $Validation = Test-TicketRequester -TargetUser $User -RequesterIdentifier $Requester

            $Validation | Add-Member -MemberType NoteProperty -Name requestSource -Value $RequestContext.source -Force
            $Validation | Add-Member -MemberType NoteProperty -Name requestReference -Value $RequestContext.reference -Force

            return New-ResetMfaResult `
                -Success $true `
                -Message $Validation.message `
                -Data $Validation
        }

        "send-approval-email" {
            Import-GraphResetMfa
            Assert-GraphReady | Out-Null

            $UserId = Get-QueryValue "userId"
            $ExpectedUpn = Get-QueryValue "expectedUpn"
            $Source = Get-QueryValue "source"
            $Reference = Get-QueryValue "reference"
            $User = Resolve-ResetMfaUser -Identifier $UserId
            Assert-ExpectedUser -User $User -ExpectedUpn $ExpectedUpn
            $RequestContext = Resolve-RequestContext -Source $Source -Reference $Reference
            $Operator = Get-WindowsOperator
            $EmailResult = Send-ResetMfaApprovalEmail -User $User -RequestContext $RequestContext -Operator $Operator

            return New-ResetMfaResult `
                -Success $true `
                -Message "Pedido de aprovação enviado pelo Outlook." `
                -Data $EmailResult
        }

        "preview-approval-email" {
            Import-GraphResetMfa
            Assert-GraphReady | Out-Null

            $UserId = Get-QueryValue "userId"
            $ExpectedUpn = Get-QueryValue "expectedUpn"
            $Source = Get-QueryValue "source"
            $Reference = Get-QueryValue "reference"
            $User = Resolve-ResetMfaUser -Identifier $UserId
            Assert-ExpectedUser -User $User -ExpectedUpn $ExpectedUpn
            $RequestContext = Resolve-RequestContext -Source $Source -Reference $Reference
            $Operator = Get-WindowsOperator
            $Preview = Send-ResetMfaApprovalEmail -User $User -RequestContext $RequestContext -Operator $Operator -PreviewOnly

            return New-ResetMfaResult `
                -Success $true `
                -Message "Pré-visualização do pedido de aprovação preparada." `
                -Data $Preview
        }

        "approved-list" {
            $Config = Read-ApprovedRequesterConfig

            return New-ResetMfaResult `
                -Success $true `
                -Message "Lista de pré-aprovados carregada." `
                -Data ([pscustomobject]@{
                    version    = $Config.version
                    updatedAt  = $Config.updatedAt
                    updatedBy  = $Config.updatedBy
                    requesters = @($Config.requesters | Sort-Object displayName, userPrincipalName)
                })
        }

        "approved-add" {
            Import-GraphResetMfa
            Assert-GraphReady | Out-Null

            $Identifier = Get-QueryValue "identifier"
            $Note = Get-QueryValue "note"

            if ([string]::IsNullOrWhiteSpace($Identifier)) {
                throw "Informe o user, email ou UPN da pessoa pré-aprovada."
            }

            $ApprovedUser = Resolve-ResetMfaUser -Identifier $Identifier
            $Operator = Get-WindowsOperator
            $Config = Read-ApprovedRequesterConfig
            $Existing = $Config.requesters |
                Where-Object { $_.id -eq $ApprovedUser.Id } |
                Select-Object -First 1

            $Entry = [pscustomobject]@{
                id                = $ApprovedUser.Id
                displayName       = $ApprovedUser.DisplayName
                userPrincipalName = $ApprovedUser.UserPrincipalName
                mail              = $ApprovedUser.Mail
                employeeId        = $ApprovedUser.EmployeeId
                active            = $true
                note              = ($Note + "").Trim()
                addedAt           = if ($Existing -and $Existing.addedAt) { $Existing.addedAt } else { (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") }
                addedBy           = if ($Existing -and $Existing.addedBy) { $Existing.addedBy } else { $Operator.fullName }
                updatedAt         = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                updatedBy         = $Operator.fullName
            }

            $Remaining = @($Config.requesters | Where-Object { $_.id -ne $ApprovedUser.Id })
            $Config.requesters = @($Remaining + $Entry)
            $Config.updatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
            $Config.updatedBy = $Operator.fullName
            Save-ApprovedRequesterConfig -Config $Config

            return New-ResetMfaResult `
                -Success $true `
                -Message "Pré-aprovado adicionado ou atualizado." `
                -Data $Entry
        }

        "approved-toggle" {
            $RequesterId = Get-QueryValue "id"
            $ActiveText = Get-QueryValue "active"

            if ([string]::IsNullOrWhiteSpace($RequesterId)) {
                throw "Object ID do pré-aprovado não informado."
            }

            $NewActive = [System.Convert]::ToBoolean($ActiveText)
            $Operator = Get-WindowsOperator
            $Config = Read-ApprovedRequesterConfig
            $Found = $false
            $Updated = @(
                foreach ($Entry in $Config.requesters) {
                    if ($Entry.id -eq $RequesterId) {
                        $Found = $true
                        $Entry.active = $NewActive
                        $Entry.updatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                        $Entry.updatedBy = $Operator.fullName
                    }

                    $Entry
                }
            )

            if (!$Found) {
                throw "Pré-aprovado não encontrado."
            }

            $Config.requesters = $Updated
            $Config.updatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
            $Config.updatedBy = $Operator.fullName
            Save-ApprovedRequesterConfig -Config $Config

            return New-ResetMfaResult `
                -Success $true `
                -Message $(if ($NewActive) { "Pré-aprovado ativado." } else { "Pré-aprovado desativado." }) `
                -Data ([pscustomobject]@{
                    id     = $RequesterId
                    active = $NewActive
                })
        }

        "approved-remove" {
            $RequesterId = Get-QueryValue "id"

            if ([string]::IsNullOrWhiteSpace($RequesterId)) {
                throw "Object ID do pré-aprovado não informado."
            }

            $Operator = Get-WindowsOperator
            $Config = Read-ApprovedRequesterConfig
            $BeforeCount = @($Config.requesters).Count
            $Config.requesters = @($Config.requesters | Where-Object { $_.id -ne $RequesterId })

            if (@($Config.requesters).Count -eq $BeforeCount) {
                throw "Pré-aprovado não encontrado."
            }

            $Config.updatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
            $Config.updatedBy = $Operator.fullName
            Save-ApprovedRequesterConfig -Config $Config

            return New-ResetMfaResult `
                -Success $true `
                -Message "Pré-aprovado removido." `
                -Data ([pscustomobject]@{
                    id = $RequesterId
                })
        }

        "test" {
            Import-GraphResetMfa
            Assert-GraphReady | Out-Null

            $UserId = Get-QueryValue "userId"

            if ([string]::IsNullOrWhiteSpace($UserId)) {
                $UserId = Get-QueryValue "user"
            }

            $ExpectedUpn = Get-QueryValue "expectedUpn"
            $User = Resolve-ResetMfaUser -Identifier $UserId
            Assert-ExpectedUser -User $User -ExpectedUpn $ExpectedUpn
            $Methods = @(Get-MethodsForUser -UserId $User.Id)
            $RemovableMethods = @($Methods | Where-Object { $_.removable -eq $true })
            $ProtectedMethods = @($Methods | Where-Object { $_.protected -eq $true })

            return New-ResetMfaResult `
                -Success $true `
                -Message "Pré-validação concluída sem alterar o utilizador." `
                -Data ([pscustomobject]@{
                    userId                  = $User.Id
                    userPrincipalName       = $User.UserPrincipalName
                    displayName             = $User.DisplayName
                    accountEnabled          = $User.AccountEnabled
                    removableMethodsCount   = $RemovableMethods.Count
                    protectedMethodsCount   = $ProtectedMethods.Count
                    removableMethods        = $RemovableMethods
                    protectedMethods        = $ProtectedMethods
                    methods                 = $Methods
                })
        }

        "reset" {
            Import-GraphResetMfa
            Assert-GraphReady | Out-Null

            $UserId = Get-QueryValue "userId"
            $ExpectedUpn = Get-QueryValue "expectedUpn"
            $RequesterIdentifier = Get-QueryValue "requester"
            $RequestSource = Get-QueryValue "source"
            $RequestReference = Get-QueryValue "reference"

            if ([string]::IsNullOrWhiteSpace($RequestReference)) {
                $RequestReference = Get-QueryValue "ticket"
            }

            if ([string]::IsNullOrWhiteSpace($UserId)) {
                throw "Object ID do utilizador não informado. Pesquise novamente antes de executar o reset."
            }

            if ([string]::IsNullOrWhiteSpace($RequesterIdentifier)) {
                throw "Informe e valide o solicitante do ticket antes de executar o reset."
            }

            $RequestContext = Resolve-RequestContext -Source $RequestSource -Reference $RequestReference
            $User = Resolve-ResetMfaUser -Identifier $UserId
            Assert-ExpectedUser -User $User -ExpectedUpn $ExpectedUpn

            if ($User.AccountEnabled -ne $true) {
                throw "A conta do utilizador está desativada. O reset foi bloqueado por segurança."
            }

            $Authorization = Test-TicketRequester -TargetUser $User -RequesterIdentifier $RequesterIdentifier

            if ($Authorization.allowed -ne $true) {
                throw "Reset bloqueado: $($Authorization.message)"
            }

            $Methods = @(Get-MethodsForUser -UserId $User.Id)
            $RemovableMethods = @($Methods | Where-Object { $_.removable -eq $true })
            $ProtectedMethods = @($Methods | Where-Object { $_.protected -eq $true })
            $Operator = Get-WindowsOperator
            $Timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
            $Removed = @()
            $Skipped = @($ProtectedMethods)
            $Failed = @()

            if ($RemovableMethods.Count -eq 0) {
                $NoMethodsData = [pscustomobject]@{
                    operationStatus   = "NoMethods"
                    timestamp         = $Timestamp
                    requestSource     = $RequestContext.source
                    requestReference  = $RequestContext.reference
                    ticket            = $RequestContext.reference
                    operator          = $Operator
                    authorization     = $Authorization
                    userId            = $User.Id
                    userPrincipalName = $User.UserPrincipalName
                    displayName       = $User.DisplayName
                    removedCount      = 0
                    skippedCount      = $Skipped.Count
                    failedCount       = 0
                    remainingMethods  = 0
                    verified          = $true
                    removed           = @()
                    skipped           = $Skipped
                    failed            = @()
                    remaining         = @()
                    note              = "Não existiam métodos MFA padrão removíveis. Métodos especiais permaneceram protegidos."
                }

                Write-ResetMfaAudit -Record ([pscustomobject]@{
                    Timestamp          = $Timestamp
                    RequestSource      = $RequestContext.source
                    RequestReference   = $RequestContext.reference
                    OperatorWindows    = $Operator.windowsUser
                    OperatorName       = $Operator.fullName
                    TargetDisplayName  = $User.DisplayName
                    TargetUPN          = $User.UserPrincipalName
                    TargetId           = $User.Id
                    RequesterName      = $Authorization.requester.displayName
                    RequesterUPN       = $Authorization.requester.userPrincipalName
                    RequesterId        = $Authorization.requester.id
                    AuthorizationState = $Authorization.state
                    AuthorizationRule  = $Authorization.authorizationRule
                    Status             = "NoMethods"
                    RemovedCount       = 0
                    FailedCount        = 0
                    RemainingCount     = 0
                    Details            = "Nenhum método MFA padrão removível."
                })

                return New-ResetMfaResult `
                    -Success $true `
                    -Message "Nenhum método MFA padrão removível foi encontrado." `
                    -Data $NoMethodsData
            }

            foreach ($Method in $RemovableMethods) {
                try {
                    $Result = Remove-ResetMfaMethod -UserId $User.Id -Method $Method

                    if ($Result -eq "REMOVED") {
                        $Removed += $Method
                    }
                    else {
                        $Skipped += $Method
                    }
                }
                catch {
                    $Message = $_.Exception.Message
                    $RetrySucceeded = $false

                    if (Test-TransientGraphError -Message $Message) {
                        Start-Sleep -Seconds 3

                        try {
                            $RetryResult = Remove-ResetMfaMethod -UserId $User.Id -Method $Method

                            if ($RetryResult -eq "REMOVED") {
                                $Removed += [pscustomobject]@{
                                    id        = $Method.id
                                    type      = $Method.type
                                    name      = $Method.name
                                    category  = $Method.category
                                    removable = $Method.removable
                                    protected = $Method.protected
                                    isMfa     = $Method.isMfa
                                    reason    = $Method.reason
                                    retry     = $true
                                }
                                $RetrySucceeded = $true
                            }
                        }
                        catch {
                            $Message = $_.Exception.Message
                        }
                    }

                    if (!$RetrySucceeded) {
                        $Failed += [pscustomobject]@{
                            id    = $Method.id
                            type  = $Method.type
                            name  = $Method.name
                            error = $Message
                        }
                    }
                }
            }

            $Verified = $false
            $RemainingRemovableMethods = @()
            $FinalMethods = @()

            for ($Attempt = 1; $Attempt -le $MaxVerifyAttempts; $Attempt++) {
                $FinalMethods = @(Get-MethodsForUser -UserId $User.Id)
                $RemainingRemovableMethods = @($FinalMethods | Where-Object { $_.removable -eq $true })

                if ($RemainingRemovableMethods.Count -eq 0) {
                    $Verified = $true
                    break
                }

                if ($Attempt -lt $MaxVerifyAttempts) {
                    Start-Sleep -Seconds $VerifySleepSeconds
                }
            }

            $OperationStatus = "Failed"

            if ($Verified -and $Failed.Count -eq 0) {
                $OperationStatus = "Success"
            }
            elseif ($Removed.Count -gt 0 -and $Failed.Count -eq 0 -and !$Verified) {
                $OperationStatus = "PendingVerification"
            }
            elseif ($Removed.Count -gt 0) {
                $OperationStatus = "Partial"
            }

            $Message = switch ($OperationStatus) {
                "Success" { "Reset MFA concluído e confirmado." }
                "PendingVerification" { "Os métodos foram removidos, mas a verificação final ainda está pendente de propagação." }
                "Partial" { "Reset MFA concluído parcialmente. Consulte as falhas e métodos restantes." }
                default { "Não foi possível concluir o reset MFA." }
            }

            $ResultData = [pscustomobject]@{
                operationStatus   = $OperationStatus
                timestamp         = $Timestamp
                requestSource     = $RequestContext.source
                requestReference  = $RequestContext.reference
                ticket            = $RequestContext.reference
                operator          = $Operator
                authorization     = $Authorization
                userId            = $User.Id
                userPrincipalName = $User.UserPrincipalName
                displayName       = $User.DisplayName
                removedCount      = $Removed.Count
                skippedCount      = $Skipped.Count
                failedCount       = $Failed.Count
                remainingMethods  = $RemainingRemovableMethods.Count
                verified          = $Verified
                removed           = $Removed
                skipped           = $Skipped
                failed            = $Failed
                remaining         = $RemainingRemovableMethods
                finalMethods      = $FinalMethods
                note              = "O reset padrão remove apenas Microsoft Authenticator, telefone e Software OATH. Password, FIDO2, Windows Hello, TAP e email permanecem protegidos. A revogação de sessões não é executada nesta versão."
            }

            Write-ResetMfaAudit -Record ([pscustomobject]@{
                Timestamp          = $Timestamp
                RequestSource      = $RequestContext.source
                RequestReference   = $RequestContext.reference
                OperatorWindows    = $Operator.windowsUser
                OperatorName       = $Operator.fullName
                TargetDisplayName  = $User.DisplayName
                TargetUPN          = $User.UserPrincipalName
                TargetId           = $User.Id
                RequesterName      = $Authorization.requester.displayName
                RequesterUPN       = $Authorization.requester.userPrincipalName
                RequesterId        = $Authorization.requester.id
                AuthorizationState = $Authorization.state
                AuthorizationRule  = $Authorization.authorizationRule
                Status             = $OperationStatus
                RemovedCount       = $Removed.Count
                FailedCount        = $Failed.Count
                RemainingCount     = $RemainingRemovableMethods.Count
                Details            = $Message
            })

            return New-ResetMfaResult `
                -Success ($OperationStatus -eq "Success") `
                -Message $Message `
                -Data $ResultData
        }

        "windowsuser" {
            $Operator = Get-WindowsOperator

            return New-ResetMfaResult `
                -Success $true `
                -Message "Utilizador Windows identificado." `
                -Data $Operator
        }

        default {
            return New-ResetMfaResult `
                -Success $false `
                -Message "Action inválida: $Action"
        }
    }
}
catch {
    $ErrorData = [ordered]@{
        action = $Action
    }

    if ($env:SANTANDER_SUPPORT_DEBUG -eq "1") {
        $ErrorData["stack"] = $_.ScriptStackTrace
    }

    return New-ResetMfaResult `
        -Success $false `
        -Message $_.Exception.Message `
        -Data ([pscustomobject]$ErrorData)
}
