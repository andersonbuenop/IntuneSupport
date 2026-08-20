param(
    $Query,
    $Config,
    [string]$Body = "",
    [string]$Method = "GET"
)

$ErrorActionPreference = "Continue"

function Write-Json {
    param($Obj)
    $Obj | ConvertTo-Json -Depth 40 -Compress
}

function Test-Cmd {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-VuCsrfToken {
    if ([string]::IsNullOrWhiteSpace([string]$Global:VuCsrfToken)) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        $Global:VuCsrfToken = [Convert]::ToBase64String($bytes)
    }
    return [string]$Global:VuCsrfToken
}

function Test-VuCsrfToken {
    param([string]$Token)
    $expected = Get-VuCsrfToken
    if ([string]::IsNullOrWhiteSpace($Token) -or $Token.Length -ne $expected.Length) { return $false }
    $left = [Text.Encoding]::UTF8.GetBytes($Token)
    $right = [Text.Encoding]::UTF8.GetBytes($expected)
    return [Security.Cryptography.CryptographicOperations]::FixedTimeEquals($left, $right)
}

function Write-VuAudit {
    param([string]$ActionName, [string]$Target, [bool]$Success, [string]$Detail)
    try {
        $logFolder = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\logs'))
        if (-not (Test-Path -LiteralPath $logFolder)) { New-Item -Path $logFolder -ItemType Directory -Force | Out-Null }
        $safeDetail = ([string]$Detail).Replace("`r", ' ').Replace("`n", ' ')
        $line = '{0} | operator={1} | action={2} | target={3} | success={4} | detail={5}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $env:USERNAME, $ActionName, $Target, $Success, $safeDetail
        Add-Content -LiteralPath (Join-Path $logFolder 'verificacao-utilizadores-audit.log') -Value $line -Encoding UTF8
    } catch {}
}

function Get-TextValue {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    $text = ([string]$Value).Trim()

    if ([string]::IsNullOrWhiteSpace($text)) {
        return $null
    }

    return $text
}

function ConvertTo-VuGuidText {
    param($Value)
    if ($null -eq $Value) { return $null }
    try {
        if ($Value -is [guid]) { return $Value.ToString() }
        if ($Value -is [byte[]] -and $Value.Length -eq 16) { return ([guid]::new($Value)).ToString() }
        $text = Get-TextValue $Value
        if (-not $text) { return $null }
        $parsed = [guid]::Empty
        if ([guid]::TryParse($text, [ref]$parsed)) { return $parsed.ToString() }
        $bytes = [Convert]::FromBase64String($text)
        if ($bytes.Length -eq 16) { return ([guid]::new($bytes)).ToString() }
        return $text
    }
    catch { return (Get-TextValue $Value) }
}

function Get-QueryValue {
    param([string]$Name)

    try {
        if ($Query -and $Query[$Name]) {
            return [string]$Query[$Name]
        }
    } catch {}

    foreach ($scopeName in @("script", "global")) {
        try {
            $queryVar = Get-Variable -Name Query -Scope $scopeName -ErrorAction SilentlyContinue
            if ($queryVar -and $queryVar.Value -and $queryVar.Value[$Name]) {
                return [string]$queryVar.Value[$Name]
            }
        } catch {}
    }

    return $null
}

function ConvertFrom-JsonSafe {
    param($Value)

    if ($null -eq $Value) {
        return $null
    }

    try {
        $text = [string]$Value

        if ([string]::IsNullOrWhiteSpace($text)) {
            return $null
        }

        $parsed = $text | ConvertFrom-Json -ErrorAction Stop

        if ($parsed -is [string]) {
            $nested = [string]$parsed

            if (-not [string]::IsNullOrWhiteSpace($nested)) {
                return $nested | ConvertFrom-Json -ErrorAction Stop
            }
        }

        return $parsed
    } catch {
        return $null
    }
}

function Get-RequestJson {
    $fromBody = ConvertFrom-JsonSafe $Body
    if ($fromBody) {
        return $fromBody
    }

    if (-not [string]::IsNullOrWhiteSpace($Payload)) {
        try {
            $decodedPayload = [System.Uri]::UnescapeDataString($Payload)
            $fromPayload = ConvertFrom-JsonSafe $decodedPayload
            if ($fromPayload) {
                return $fromPayload
            }
        } catch {}
    }

    $queryPayload = Get-QueryValue "payload"
    if (-not [string]::IsNullOrWhiteSpace($queryPayload)) {
        try {
            $decodedQueryPayload = [System.Uri]::UnescapeDataString($queryPayload)
            $fromQuery = ConvertFrom-JsonSafe $decodedQueryPayload
            if ($fromQuery) {
                return $fromQuery
            }
        } catch {}
    }

    return $null
}

function Get-RequestedAction {
    param($Request)

    $requestAction = $null

    if ($Request) {
        try {
            $requestAction = Get-TextValue $Request.action
        } catch {}
    }

    if (-not $requestAction) {
        $requestAction = Get-TextValue $Action
    }

    if (-not $requestAction) {
        $requestAction = Get-TextValue (Get-QueryValue "action")
    }

    if ($requestAction) {
        return $requestAction.ToLowerInvariant()
    }

    return $null
}

function New-ConnectionState {
    param(
        [bool]$Connected,
        [string[]]$Notes,
        [string]$Error
    )

    return [pscustomobject]@{
        connected = $Connected
        notes = @($Notes | Where-Object { $_ } | Select-Object -Unique)
        error = Get-TextValue $Error
    }
}

function Ensure-Graph {
    param([bool]$NeedsWrite = $false)

    $notes = @()
    $requiredScopes = @(
        "User.Read.All",
        "Group.Read.All",
        "Directory.Read.All"
    )

    if ($NeedsWrite) {
        $requiredScopes += "GroupMember.ReadWrite.All"
    }

    try {
        Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
        Import-Module Microsoft.Graph.Users -ErrorAction Stop
        Import-Module Microsoft.Graph.Groups -ErrorAction Stop

        $ctx = Get-MgContext -ErrorAction SilentlyContinue
        $mustConnect = -not $ctx

        if ($ctx) {
            $currentScopes = @($ctx.Scopes)
            $missingScopes = @($requiredScopes | Where-Object { $_ -notin $currentScopes })

            if ($missingScopes.Count -gt 0) {
                $mustConnect = $true
                $notes += "Graph ligado, mas faltavam permissões: $($missingScopes -join ', ')."
            }
        }

        if ($mustConnect) {
            Connect-MgGraph -Scopes $requiredScopes -NoWelcome -ErrorAction Stop | Out-Null
            $notes += if ($NeedsWrite) { "Graph ligado por WAM com permissão de escrita em grupos." } else { "Graph ligado por WAM em modo de leitura." }
        }
        else {
            $notes += "Graph já estava ligado."
        }

        if (-not (Test-Cmd "Get-MgUser")) {
            throw "O comando Get-MgUser não está disponível após carregar os módulos do Graph."
        }

        return New-ConnectionState -Connected $true -Notes $notes -Error $null
    }
    catch {
        $message = $_.Exception.Message
        $notes += "Graph/WAM erro: $message"
        return New-ConnectionState -Connected $false -Notes $notes -Error $message
    }
}

function Ensure-Exchange {
    $notes = @()

    try {
        Import-Module ExchangeOnlineManagement -ErrorAction Stop

        $exoOk = $false

        if (Test-Cmd "Get-ConnectionInformation") {
            $conn = Get-ConnectionInformation -ErrorAction SilentlyContinue |
                Where-Object { $_.State -eq "Connected" } |
                Select-Object -First 1

            if ($conn) {
                $exoOk = $true
            }
        }

        if (-not $exoOk) {
            Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop | Out-Null
            $notes += "Exchange Online ligado por WAM."
        }
        else {
            $notes += "Exchange Online já estava ligado."
        }

        if (-not (Test-Cmd "Get-EXOMailbox") -and -not (Test-Cmd "Get-Mailbox")) {
            throw "Nenhum comando de consulta de mailbox está disponível."
        }

        return New-ConnectionState -Connected $true -Notes $notes -Error $null
    }
    catch {
        $message = $_.Exception.Message
        $notes += "Exchange/WAM erro: $message"
        return New-ConnectionState -Connected $false -Notes $notes -Error $message
    }
}

function Get-UserCandidates {
    param([string]$User)

    $items = New-Object System.Collections.Generic.List[string]
    $clean = Get-TextValue $User

    if (-not $clean) {
        return @()
    }

    $items.Add($clean)

    if ($clean -match "@") {
        $prefix = $clean.Split("@")[0]
        if ($prefix) {
            $items.Add($prefix)
        }
    }
    else {
        $items.Add("$clean@corp.santander.pt")
        $items.Add("$clean@santander.pt")
        $items.Add("$clean@servexternos.santander.pt")
    }

    return @($items | Where-Object { $_ } | Select-Object -Unique)
}

function Find-AdUserLocal {
    param([string]$User)

    $domains = @("central.rinterna.local", "rede.rinterna.local")
    $errors = @()

    try {
        Import-Module ActiveDirectory -ErrorAction Stop
    }
    catch {
        return [pscustomobject]@{
            checked = $false
            exists = $false
            error = "Módulo ActiveDirectory indisponível: $($_.Exception.Message)"
            domain = $null
            enabled = $false
            created = $null
            modified = $null
            dn = $null
            sam = $null
            upn = $null
            mail = $null
            displayName = $null
            proxyAddresses = @()
            extensionAttribute3 = $null
            hideFromAddressLists = $null
            mailboxGuid = $null
            consistencyGuid = $null
            archiveGuid = $null
            archiveStatus = $null
            syncBlocked = $false
        }
    }

    $candidates = Get-UserCandidates $User
    $successfulQueries = 0

    foreach ($domain in $domains) {
        foreach ($candidate in $candidates) {
            try {
                $safe = $candidate.Replace("'","''")
                $filter = "SamAccountName -eq '$safe' -or UserPrincipalName -eq '$safe' -or Mail -eq '$safe'"

                $ad = Get-ADUser `
                    -Server $domain `
                    -Filter $filter `
                    -Properties DisplayName,Mail,UserPrincipalName,SamAccountName,Enabled,WhenCreated,DistinguishedName,ProxyAddresses,extensionAttribute3,msExchHideFromAddressLists,msExchMailboxGuid,'mS-DS-ConsistencyGuid',msExchArchiveGUID,msExchArchiveStatus,whenChanged `
                    -ErrorAction Stop |
                    Select-Object -First 1

                $successfulQueries++

                if ($ad) {
                    $attribute3 = Get-TextValue $ad.extensionAttribute3

                    return [pscustomobject]@{
                        checked = $true
                        exists = $true
                        error = $null
                        domain = $domain
                        enabled = [bool]$ad.Enabled
                        created = $ad.WhenCreated
                        modified = $ad.whenChanged
                        dn = $ad.DistinguishedName
                        sam = $ad.SamAccountName
                        upn = $ad.UserPrincipalName
                        mail = $ad.Mail
                        displayName = $ad.DisplayName
                        proxyAddresses = @($ad.ProxyAddresses)
                        extensionAttribute3 = $attribute3
                        hideFromAddressLists = if ($null -eq $ad.msExchHideFromAddressLists) { $null } else { [bool]$ad.msExchHideFromAddressLists }
                        mailboxGuid = ConvertTo-VuGuidText $ad.msExchMailboxGuid
                        consistencyGuid = ConvertTo-VuGuidText $ad.'mS-DS-ConsistencyGuid'
                        archiveGuid = ConvertTo-VuGuidText $ad.msExchArchiveGUID
                        archiveStatus = if ($null -eq $ad.msExchArchiveStatus) { $null } else { [string]$ad.msExchArchiveStatus }
                        syncBlocked = [bool](-not [string]::IsNullOrWhiteSpace($attribute3))
                    }
                }
            }
            catch {
                $errors += "${domain} / ${candidate}: $($_.Exception.Message)"
            }
        }
    }

    $checked = $successfulQueries -gt 0
    $errorText = $null

    if (-not $checked -and $errors.Count -gt 0) {
        $errorText = ($errors | Select-Object -Unique) -join " | "
    }

    return [pscustomobject]@{
        checked = $checked
        exists = $false
        error = $errorText
        domain = $null
        enabled = $false
        created = $null
        modified = $null
        dn = $null
        sam = $null
        upn = $null
        mail = $null
        displayName = $null
        proxyAddresses = @()
            extensionAttribute3 = $null
            hideFromAddressLists = $null
            mailboxGuid = $null
            consistencyGuid = $null
            archiveGuid = $null
            archiveStatus = $null
            syncBlocked = $false
    }
}

function Find-AzureUser {
    param(
        [string]$User,
        $GraphState
    )

    if (-not $GraphState.connected) {
        return [pscustomobject]@{
            checked = $false
            exists = $false
            error = $GraphState.error
            user = $null
        }
    }

    $clean = Get-TextValue $User
    $candidates = Get-UserCandidates $clean
    $errors = @()
    $successfulQueries = 0

    foreach ($candidate in $candidates) {
        try {
            $u = Get-MgUser `
                -UserId $candidate `
                -Property "id,displayName,userPrincipalName,mail,accountEnabled,createdDateTime,onPremisesSamAccountName,onPremisesLastSyncDateTime,onPremisesImmutableId" `
                -ErrorAction Stop

            $successfulQueries++

            if ($u) {
                return [pscustomobject]@{
                    checked = $true
                    exists = $true
                    error = $null
                    user = $u
                }
            }
        }
        catch {
            $errors += $_.Exception.Message
        }
    }

    foreach ($candidate in $candidates) {
        try {
            $safe = $candidate.Replace("'","''")
            $filter = "userPrincipalName eq '$safe' or mail eq '$safe' or onPremisesSamAccountName eq '$safe'"

            $u = Get-MgUser `
                -Filter $filter `
                -Property "id,displayName,userPrincipalName,mail,accountEnabled,createdDateTime,onPremisesSamAccountName,onPremisesLastSyncDateTime,onPremisesImmutableId" `
                -ConsistencyLevel eventual `
                -ErrorAction Stop |
                Select-Object -First 1

            $successfulQueries++

            if ($u) {
                return [pscustomobject]@{
                    checked = $true
                    exists = $true
                    error = $null
                    user = $u
                }
            }
        }
        catch {
            $errors += $_.Exception.Message
        }
    }

    if ($clean -and $clean -notmatch "@") {
        try {
            $safePrefix = $clean.Replace("'","''")
            $filter = "startswith(userPrincipalName,'$safePrefix')"

            $u = Get-MgUser `
                -Filter $filter `
                -Property "id,displayName,userPrincipalName,mail,accountEnabled,createdDateTime,onPremisesSamAccountName,onPremisesLastSyncDateTime,onPremisesImmutableId" `
                -ConsistencyLevel eventual `
                -ErrorAction Stop |
                Where-Object {
                    $_.UserPrincipalName -like "$clean@*" -or
                    $_.OnPremisesSamAccountName -eq $clean
                } |
                Select-Object -First 1

            $successfulQueries++

            if ($u) {
                return [pscustomobject]@{
                    checked = $true
                    exists = $true
                    error = $null
                    user = $u
                }
            }
        }
        catch {
            $errors += $_.Exception.Message
        }
    }

    $queryError = $null

    if ($successfulQueries -eq 0 -and $errors.Count -gt 0) {
        $queryError = ($errors | Select-Object -Unique | Select-Object -First 3) -join " | "
    }

    return [pscustomobject]@{
        checked = [bool]($successfulQueries -gt 0)
        exists = $false
        error = $queryError
        user = $null
    }
}

function Test-E3 {
    param(
        $AzureLookup,
        $GraphState
    )

    $groupName = "GR_PT_M365_E3"

    $result = [ordered]@{ hasGroup = $false; hasLicense = $false; groupName = $groupName; skuPartNumber = $null; checked = $false; error = $null }
    if (-not $GraphState.connected) { $result.error = $GraphState.error; return [pscustomobject]$result }
    if (-not $AzureLookup.exists -or -not $AzureLookup.user) {
        $result.error = if ($AzureLookup.error) { $AzureLookup.error } else { "Utilizador não disponível no Azure/Entra." }
        return [pscustomobject]$result
    }

    try {
        $groups = Get-MgUserTransitiveMemberOf -UserId $AzureLookup.user.Id -All -ErrorAction Stop
        foreach ($g in $groups) {
            $displayName = $null
            try { $displayName = [string]$g.AdditionalProperties["displayName"] } catch {}
            if ($displayName -eq $groupName) { $result.hasGroup = $true; break }
        }

        if (-not (Test-Cmd 'Get-MgUserLicenseDetail')) { throw 'Get-MgUserLicenseDetail não está disponível.' }
        $e3Skus = @('SPE_E3', 'ENTERPRISEPACK', 'Microsoft_365_E3')
        $license = Get-MgUserLicenseDetail -UserId $AzureLookup.user.Id -ErrorAction Stop |
            Where-Object { [string]$_.SkuPartNumber -in $e3Skus } |
            Select-Object -First 1
        if ($license) { $result.hasLicense = $true; $result.skuPartNumber = [string]$license.SkuPartNumber }
        $result.checked = $true
    }
    catch { $result.error = $_.Exception.Message }

    return [pscustomobject]$result
}

function Find-Exo {
    param(
        [string]$Identity,
        $ExchangeState
    )

    if (-not $ExchangeState.connected) {
        return [pscustomobject]@{
            checked = $false
            exists = $false
            error = $ExchangeState.error
            mailbox = $null
        }
    }

    $clean = Get-TextValue $Identity

    if (-not $clean) {
        return [pscustomobject]@{
            checked = $true
            exists = $false
            error = $null
            mailbox = $null
        }
    }

    $candidates = Get-UserCandidates $clean
    $errors = @()
    $successfulQueries = 0

    foreach ($candidate in $candidates) {
        if (Test-Cmd "Get-EXOMailbox") {
            try {
                $mbx = Get-EXOMailbox `
                    -Identity $candidate `
                    -Properties ArchiveStatus,ArchiveGuid,ExchangeGuid,UserPrincipalName,RecipientTypeDetails,PrimarySmtpAddress,Alias,ExternalDirectoryObjectId,RecipientLimits `
                    -ErrorAction Stop

                $successfulQueries++

                if ($mbx) {
                    return [pscustomobject]@{
                        checked = $true
                        exists = $true
                        error = $null
                        mailbox = $mbx
                    }
                }
            }
            catch {
                $message = $_.Exception.Message

                if ($message -match "couldn.?t be found|not found|does not exist|doesn.?t exist|cannot find") {
                    $successfulQueries++
                }
                else {
                    $errors += $message
                }
            }
        }

        if (Test-Cmd "Get-Mailbox") {
            try {
                $mbx = Get-Mailbox -Identity $candidate -ErrorAction Stop
                $successfulQueries++

                if ($mbx) {
                    return [pscustomobject]@{
                        checked = $true
                        exists = $true
                        error = $null
                        mailbox = $mbx
                    }
                }
            }
            catch {
                $message = $_.Exception.Message

                if ($message -match "couldn.?t be found|not found|does not exist|doesn.?t exist|cannot find") {
                    $successfulQueries++
                }
                else {
                    $errors += $message
                }
            }
        }
    }

    $queryError = $null

    if ($successfulQueries -eq 0 -and $errors.Count -gt 0) {
        $queryError = ($errors | Select-Object -Unique | Select-Object -First 3) -join " | "
    }

    return [pscustomobject]@{
        checked = [bool]($successfulQueries -gt 0)
        exists = $false
        error = $queryError
        mailbox = $null
    }
}

function Get-Diagnostic {
    param(
        $Ad,
        $Azure,
        $E3,
        $Exo,
        [bool]$ArchiveEnabled
    )

    if (-not $Ad.checked) {
        return "Não foi possível consultar o AD local: $($Ad.error)"
    }

    $attribute3 = Get-TextValue $Ad.extensionAttribute3

    if ($Ad.exists -and $attribute3) {
        if (-not $Azure.checked) {
            return "extensionAttribute3 preenchido com '$attribute3' e não foi possível validar o Azure: $($Azure.error)"
        }

        if (-not $Azure.exists) {
            return "Sincronização bloqueada pelo AD: extensionAttribute3 preenchido com '$attribute3'. Limpar o atributo para permitir a sincronização com o Azure."
        }

        return "Atenção: extensionAttribute3 preenchido com '$attribute3'. O utilizador já existe no Azure, mas futuras sincronizações podem ficar bloqueadas."
    }

    if (-not $Azure.checked) {
        return "Não foi possível validar o Azure/Entra: $($Azure.error)"
    }

    if ($Ad.exists -and -not $Azure.exists) {
        return "Existe no AD mas não existe no Azure. Se foi criado hoje, aguardar sincronização FIM amanhã às 08:00."
    }

    if (-not $Ad.exists -and -not $Azure.exists) {
        return "Utilizador não encontrado no AD nem no Azure."
    }

    if (-not $Ad.exists -and $Azure.exists) {
        return "Existe no Azure mas não foi encontrado no AD local."
    }

    if ($Ad.exists -and -not $Ad.enabled) {
        return "Utilizador desativado no AD."
    }

    if ($Azure.exists -and -not $Azure.user.AccountEnabled) {
        return "Utilizador desativado no Azure."
    }

    if (-not $E3.checked) {
        return "Não foi possível validar o grupo GR_PT_M365_E3: $($E3.error)"
    }

    if (-not $E3.hasGroup) {
        return "Sem grupo GR_PT_M365_E3."
    }

    if (-not $E3.hasLicense) {
        return "Grupo GR_PT_M365_E3 presente, mas a licença E3 ainda não está atribuída."
    }

    if (-not $Exo.checked) {
        return "Não foi possível validar o Exchange Online: $($Exo.error)"
    }

    if (-not $Exo.exists) {
        return "Sem mailbox no Exchange Online."
    }

    if (-not $ArchiveEnabled) {
        return "Arquivo Online não ativo."
    }

    return "Utilizador saudável"
}

function Search-AdUsersCreated {
    param(
        [datetime]$StartDate,
        [datetime]$EndDate,
        [bool]$OnlyEnabled,
        [bool]$RequireUpn
    )

    $domains = @("central.rinterna.local", "rede.rinterna.local")
    $maxResults = 500
    $items = @()
    $errors = @()
    $domainStats = @()
    $successDomains = 0

    try {
        Import-Module ActiveDirectory -ErrorAction Stop
    }
    catch {
        return @{
            ok = $false
            error = "Módulo ActiveDirectory indisponível: $($_.Exception.Message)"
            users = @()
            rows = @()
            domainStats = @()
        }
    }

    foreach ($domain in $domains) {
        try {
            $rows = @(
                Get-ADUser `
                    -Server $domain `
                    -Filter { WhenCreated -ge $StartDate -and WhenCreated -le $EndDate } `
                    -Properties DisplayName,Mail,UserPrincipalName,SamAccountName,Enabled,WhenCreated,DistinguishedName,extensionAttribute3,msExchHideFromAddressLists,whenChanged `
                    -ResultSetSize ($maxResults + 1) `
                    -ErrorAction Stop
            )

            $successDomains++

            if ($OnlyEnabled) {
                $rows = @($rows | Where-Object { $_.Enabled })
            }

            if ($RequireUpn) {
                $rows = @($rows | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.UserPrincipalName) })
            }

            foreach ($row in $rows) {
                $identity = Get-TextValue $row.UserPrincipalName

                if (-not $identity) {
                    $identity = Get-TextValue $row.SamAccountName
                }

                if (-not $identity) {
                    continue
                }

                $attribute3 = Get-TextValue $row.extensionAttribute3

                $items += [pscustomobject]@{
                    identity = $identity
                    domain = $domain
                    sam = $row.SamAccountName
                    upn = $row.UserPrincipalName
                    mail = $row.Mail
                    displayName = $row.DisplayName
                    enabled = [bool]$row.Enabled
                    created = $row.WhenCreated
                    modified = $row.whenChanged
                    dn = $row.DistinguishedName
                    extensionAttribute3 = $attribute3
                    hideFromAddressLists = if ($null -eq $row.msExchHideFromAddressLists) { $null } else { [bool]$row.msExchHideFromAddressLists }
                    syncBlocked = [bool](-not [string]::IsNullOrWhiteSpace($attribute3))
                }
            }

            $domainStats += [pscustomobject]@{
                domain = $domain
                ok = $true
                count = $rows.Count
                error = $null
            }
        }
        catch {
            $message = $_.Exception.Message
            $errors += "${domain}: $message"

            $domainStats += [pscustomobject]@{
                domain = $domain
                ok = $false
                count = 0
                error = $message
            }
        }
    }

    if ($successDomains -eq 0) {
        return @{
            ok = $false
            error = "Não foi possível consultar nenhum domínio do AD. $($errors -join ' | ')"
            users = @()
            rows = @()
            domainStats = $domainStats
        }
    }

    if ($items.Count -gt $maxResults) {
        return @{
            ok = $false
            error = "A pesquisa encontrou mais de $maxResults utilizadores. Reduza o intervalo de datas."
            users = @()
            rows = @()
            domainStats = $domainStats
        }
    }

    $dedup = @{}

    foreach ($item in $items) {
        $key = $null

        if ($item.upn) {
            $key = ([string]$item.upn).ToLowerInvariant()
        }
        elseif ($item.sam) {
            $key = (([string]$item.domain) + "|" + ([string]$item.sam)).ToLowerInvariant()
        }

        if ($key -and -not $dedup.ContainsKey($key)) {
            $dedup[$key] = $item
        }
    }

    $uniqueRows = @(
        $dedup.Values |
        Sort-Object created, domain, sam
    )

    $users = @($uniqueRows | ForEach-Object { $_.identity })

    $formattedRows = @(
        $uniqueRows | ForEach-Object {
            [pscustomobject]@{
                identity = $_.identity
                domain = $_.domain
                sam = $_.sam
                upn = $_.upn
                mail = $_.mail
                displayName = $_.displayName
                enabled = $_.enabled
                created = if ($_.created) { $_.created.ToString("yyyy-MM-dd HH:mm:ss") } else { $null }
                modified = if ($_.modified) { $_.modified.ToString("yyyy-MM-dd HH:mm:ss") } else { $null }
                dn = $_.dn
                extensionAttribute3 = $_.extensionAttribute3
                hideFromAddressLists = $_.hideFromAddressLists
                syncBlocked = $_.syncBlocked
            }
        }
    )

    return @{
        ok = $true
        partial = [bool]($errors.Count -gt 0)
        count = $users.Count
        users = $users
        rows = $formattedRows
        errors = @($errors)
        domainStats = $domainStats
        startDate = $StartDate.ToString("yyyy-MM-dd HH:mm:ss")
        endDate = $EndDate.ToString("yyyy-MM-dd HH:mm:ss")
    }
}

function Invoke-VuAddE3 {
    param([string]$User)

    $groupName = "GR_PT_M365_E3"
    $graph = Ensure-Graph -NeedsWrite $true

    if (-not $graph.connected) {
        return @{
            ok = $false
            error = "Não foi possível ligar ao Microsoft Graph: $($graph.error)"
            notes = $graph.notes
        }
    }

    $azure = Find-AzureUser -User $User -GraphState $graph

    if (-not $azure.checked) {
        return @{
            ok = $false
            error = "Não foi possível consultar o Azure: $($azure.error)"
            notes = $graph.notes
        }
    }

    if (-not $azure.exists) {
        return @{
            ok = $false
            error = "Utilizador não encontrado no Azure. Verifique o extensionAttribute3 no AD ou, se foi criado hoje, aguarde a sincronização FIM amanhã às 08:00."
            notes = $graph.notes
        }
    }

    $currentE3 = Test-E3 -AzureLookup $azure -GraphState $graph

    if ($currentE3.checked -and $currentE3.hasGroup) {
        return @{
            ok = $true
            message = "O utilizador $($azure.user.UserPrincipalName) já pertence ao grupo $groupName."
            notes = $graph.notes
        }
    }

    if (-not $currentE3.checked) {
        return @{
            ok = $false
            error = "Não foi possível confirmar a associação atual ao grupo $groupName. $($currentE3.error)"
            notes = $graph.notes
        }
    }

    try {
        $safeGroupName = $groupName.Replace("'","''")

        $group = Get-MgGroup `
            -Filter "displayName eq '$safeGroupName'" `
            -ConsistencyLevel eventual `
            -Property "id,displayName" `
            -ErrorAction Stop |
            Select-Object -First 1

        if (-not $group) {
            return @{
                ok = $false
                error = "Grupo $groupName não encontrado."
                notes = $graph.notes
            }
        }

        $bodyParameter = @{
            "@odata.id" = "https://graph.microsoft.com/v1.0/directoryObjects/$($azure.user.Id)"
        }

        New-MgGroupMemberByRef `
            -GroupId $group.Id `
            -BodyParameter $bodyParameter `
            -ErrorAction Stop |
            Out-Null

        return @{
            ok = $true
            message = "Grupo $groupName adicionado ao utilizador $($azure.user.UserPrincipalName)."
            notes = $graph.notes
        }
    }
    catch {
        $message = $_.Exception.Message

        if ($message -match "already exist|added object references already exist|One or more added object references already exist") {
            return @{
                ok = $true
                message = "O utilizador $($azure.user.UserPrincipalName) já pertence ao grupo $groupName."
                notes = $graph.notes
            }
        }

        return @{
            ok = $false
            error = "Erro ao adicionar E3: $message"
            notes = $graph.notes
        }
    }
}

function Invoke-VuEnableArchive {
    param([string]$User)

    $exchange = Ensure-Exchange

    if (-not $exchange.connected) {
        return @{
            ok = $false
            error = "Não foi possível ligar ao Exchange Online: $($exchange.error)"
            notes = $exchange.notes
        }
    }

    $exo = Find-Exo -Identity $User -ExchangeState $exchange

    if (-not $exo.checked) {
        return @{
            ok = $false
            error = "Não foi possível consultar a mailbox: $($exo.error)"
            notes = $exchange.notes
        }
    }

    if (-not $exo.exists -or -not $exo.mailbox) {
        return @{
            ok = $false
            error = "Mailbox não encontrada no Exchange Online."
            notes = $exchange.notes
        }
    }

    $mailbox = $exo.mailbox
    $archiveGuid = [string]$mailbox.ArchiveGuid
    $archiveStatus = [string]$mailbox.ArchiveStatus
    $recipientType = [string]$mailbox.RecipientTypeDetails

    if ($archiveStatus -eq "Active" -or ($archiveGuid -and $archiveGuid -ne "00000000-0000-0000-0000-000000000000")) {
        return @{
            ok = $true
            message = "Arquivo Online já está ativo ou provisionado para $User."
            notes = $exchange.notes
        }
    }

    $resolvedIdentity = Get-TextValue $mailbox.PrimarySmtpAddress

    if (-not $resolvedIdentity) {
        $resolvedIdentity = $User
    }

    try {
        if ($recipientType -match "Remote" -and (Test-Cmd "Enable-RemoteMailbox")) {
            Enable-RemoteMailbox -Identity $resolvedIdentity -Archive -ErrorAction Stop | Out-Null

            return @{
                ok = $true
                message = "Pedido de ativação do Arquivo Online enviado no Exchange híbrido para $resolvedIdentity."
                notes = $exchange.notes
            }
        }

        Enable-Mailbox -Identity $resolvedIdentity -Archive -ErrorAction Stop | Out-Null

        return @{
            ok = $true
            message = "Pedido de ativação do Arquivo Online enviado para $resolvedIdentity."
            notes = $exchange.notes
        }
    }
    catch {
        $message = $_.Exception.Message

        if ($message -match "on-premises|on premises|synchroni[sz]ed|write scope|outside the current user's write scope") {
            return @{
                ok = $false
                error = "A mailbox é gerida pelo ambiente híbrido. A ativação do arquivo deve ser realizada no Exchange local com Enable-RemoteMailbox -Archive. Detalhe: $message"
                notes = $exchange.notes
            }
        }

        return @{
            ok = $false
            error = "Erro ao ativar Arquivo Online: $message"
            notes = $exchange.notes
        }
    }
}

function Invoke-VuClearHideFromAddressLists {
    param([string]$User)

    $ad = Find-AdUserLocal -User $User
    if (-not $ad.checked) { return @{ ok = $false; error = "Não foi possível consultar o AD: $($ad.error)" } }
    if (-not $ad.exists -or -not $ad.dn -or -not $ad.domain) { return @{ ok = $false; error = 'Utilizador não encontrado no AD local.' } }
    if ($null -eq $ad.hideFromAddressLists) { return @{ ok = $true; message = 'O atributo msExchHideFromAddressLists já está sem valor.' } }

    try {
        Set-ADUser -Identity $ad.dn -Server $ad.domain -Clear 'msExchHideFromAddressLists' -ErrorAction Stop | Out-Null
        return @{ ok = $true; message = "Atributo msExchHideFromAddressLists limpo em $($ad.sam)." }
    }
    catch { return @{ ok = $false; error = "Erro ao limpar msExchHideFromAddressLists: $($_.Exception.Message)" } }
}

function Invoke-VuSetRecipientLimit {
    param([string]$User, [int]$Limit)

    if ($Limit -lt 1 -or $Limit -gt 1000) { return @{ ok = $false; error = 'O limite deve ser um número entre 1 e 1000.' } }
    $exchange = Ensure-Exchange
    if (-not $exchange.connected) { return @{ ok = $false; error = "Não foi possível ligar ao Exchange Online: $($exchange.error)"; notes = $exchange.notes } }
    $exo = Find-Exo -Identity $User -ExchangeState $exchange
    if (-not $exo.checked) { return @{ ok = $false; error = "Não foi possível consultar a mailbox: $($exo.error)"; notes = $exchange.notes } }
    if (-not $exo.exists -or -not $exo.mailbox) { return @{ ok = $false; error = 'Mailbox não encontrada no Exchange Online.'; notes = $exchange.notes } }
    if (-not (Test-Cmd 'Set-Mailbox')) { return @{ ok = $false; error = 'O comando Set-Mailbox não está disponível nesta sessão.'; notes = $exchange.notes } }

    $identity = Get-TextValue $exo.mailbox.PrimarySmtpAddress
    if (-not $identity) { $identity = $User }
    try {
        Set-Mailbox -Identity $identity -RecipientLimits $Limit -Confirm:$false -ErrorAction Stop | Out-Null
        return @{ ok = $true; message = "Limite de destinatários alterado para $Limit em $identity."; notes = $exchange.notes }
    }
    catch { return @{ ok = $false; error = "Erro ao alterar RecipientLimits: $($_.Exception.Message)"; notes = $exchange.notes } }
}

function Invoke-VuSavePng {
    param([string]$FileName, [string]$ImageBase64)

    $safeName = [IO.Path]::GetFileName($FileName)
    $safeName = $safeName -replace '[^a-zA-Z0-9._-]', '-'
    if ([string]::IsNullOrWhiteSpace($safeName)) { $safeName = 'verificacao-utilizador.png' }
    if (-not $safeName.EndsWith('.png', [StringComparison]::OrdinalIgnoreCase)) { $safeName += '.png' }
    if ([string]::IsNullOrWhiteSpace($ImageBase64) -or $ImageBase64.Length -gt 22000000) {
        return @{ ok = $false; error = 'Imagem PNG vazia ou demasiado grande.' }
    }

    try {
        $cleanBase64 = $ImageBase64 -replace '^data:image/png;base64,', ''
        $bytes = [Convert]::FromBase64String($cleanBase64)
        if ($bytes.Length -lt 8 -or $bytes[0] -ne 137 -or $bytes[1] -ne 80 -or $bytes[2] -ne 78 -or $bytes[3] -ne 71) {
            return @{ ok = $false; error = 'O conteúdo recebido não é um ficheiro PNG válido.' }
        }

        $folder = 'C:\temp'
        if (-not (Test-Path -LiteralPath $folder)) { New-Item -Path $folder -ItemType Directory -Force | Out-Null }
        $destination = Join-Path $folder $safeName
        [IO.File]::WriteAllBytes($destination, $bytes)
        return @{ ok = $true; message = "PNG guardado em $destination"; path = $destination }
    }
    catch { return @{ ok = $false; error = "Não foi possível guardar o PNG em C:\temp: $($_.Exception.Message)" } }
}

function Invoke-VuVerify {
    param([string[]]$Users)

    $cleanUsers = @(
        $Users |
        ForEach-Object { Get-TextValue $_ } |
        Where-Object { $_ } |
        Select-Object -Unique
    )

    if (-not $cleanUsers -or $cleanUsers.Count -eq 0) {
        return @{
            ok = $false
            error = "Nenhum utilizador recebido pela API."
        }
    }

    if ($cleanUsers.Count -gt 100) {
        return @{
            ok = $false
            error = "A API aceita no máximo 100 utilizadores por pedido. O frontend deve enviar a lista em lotes."
        }
    }

    $graph = Ensure-Graph
    $exchange = Ensure-Exchange

    $globalNotes = @()
    $globalNotes += $graph.notes
    $globalNotes += $exchange.notes
    $globalNotes = @($globalNotes | Where-Object { $_ } | Select-Object -Unique)

    $results = @()

    foreach ($inputUser in $cleanUsers) {
        $ad = Find-AdUserLocal $inputUser
        $resolved = $inputUser

        if ($ad.exists -and $ad.upn) {
            $resolved = $ad.upn
        }

        $azure = Find-AzureUser -User $resolved -GraphState $graph

        if (-not $azure.exists -and $inputUser -ne $resolved) {
            $azureFallback = Find-AzureUser -User $inputUser -GraphState $graph

            if ($azureFallback.exists -or -not $azureFallback.checked) {
                $azure = $azureFallback
            }
        }

        $azureUser = $azure.user

        if ($azure.exists -and $azureUser.UserPrincipalName) {
            $resolved = $azureUser.UserPrincipalName
        }

        $e3 = Test-E3 -AzureLookup $azure -GraphState $graph
        $exo = Find-Exo -Identity $resolved -ExchangeState $exchange

        if (-not $exo.exists -and $ad.mail) {
            $exoFallback = Find-Exo -Identity $ad.mail -ExchangeState $exchange

            if ($exoFallback.exists -or -not $exoFallback.checked) {
                $exo = $exoFallback
            }
        }

        $mailbox = $exo.mailbox
        $archiveGuid = $null
        $archiveStatus = $null
        $archiveEnabled = $false
        $archiveProvisioned = $false
        $recipientType = $null
        $primarySmtpAddress = $null

        if ($exo.exists -and $mailbox) {
            $archiveGuid = [string]$mailbox.ArchiveGuid
            $archiveStatus = [string]$mailbox.ArchiveStatus
            $recipientType = [string]$mailbox.RecipientTypeDetails
            $primarySmtpAddress = Get-TextValue $mailbox.PrimarySmtpAddress

            if ($archiveGuid -and $archiveGuid -ne "00000000-0000-0000-0000-000000000000") {
                $archiveProvisioned = $true
            }

            if ($archiveStatus -eq "Active" -or $archiveProvisioned) {
                $archiveEnabled = $true
            }
        }

        $diagnostic = Get-Diagnostic `
            -Ad $ad `
            -Azure $azure `
            -E3 $e3 `
            -Exo $exo `
            -ArchiveEnabled $archiveEnabled

        $attribute3 = Get-TextValue $ad.extensionAttribute3
        $syncBlocked = [bool]($ad.exists -and $attribute3)

        $results += [pscustomobject]@{
            input = $inputUser
            resolvedUser = $resolved
            displayName = if ($azure.exists -and $azureUser.DisplayName) {
                $azureUser.DisplayName
            }
            elseif ($ad.displayName) {
                $ad.displayName
            }
            else {
                $null
            }

            ad = [pscustomobject]@{
                checked = [bool]$ad.checked
                exists = [bool]$ad.exists
                error = $ad.error
                domain = $ad.domain
                enabled = [bool]$ad.enabled
                created = if ($ad.created) { $ad.created.ToString("yyyy-MM-dd HH:mm") } else { $null }
                modified = if ($ad.modified) { $ad.modified.ToString("yyyy-MM-dd HH:mm:ss") } else { $null }
                dn = $ad.dn
                sam = $ad.sam
                upn = $ad.upn
                mail = $ad.mail
                proxyAddresses = @($ad.proxyAddresses)
                extensionAttribute3 = $attribute3
                hideFromAddressLists = $ad.hideFromAddressLists
                mailboxGuid = $ad.mailboxGuid
                consistencyGuid = $ad.consistencyGuid
                archiveGuid = $ad.archiveGuid
                archiveStatus = $ad.archiveStatus
                syncBlocked = $syncBlocked
            }

            azure = [pscustomobject]@{
                checked = [bool]$azure.checked
                exists = [bool]$azure.exists
                error = $azure.error
                enabled = if ($azure.exists) { [bool]$azureUser.AccountEnabled } else { $false }
                created = if ($azure.exists -and $azureUser.CreatedDateTime) { $azureUser.CreatedDateTime.ToString("yyyy-MM-dd HH:mm") } else { $null }
                upn = if ($azure.exists) { $azureUser.UserPrincipalName } else { $null }
                id = if ($azure.exists) { $azureUser.Id } else { $null }
                lastSync = if ($azure.exists -and $azureUser.OnPremisesLastSyncDateTime) { $azureUser.OnPremisesLastSyncDateTime.ToString("yyyy-MM-dd HH:mm") } else { $null }
                consistencyGuid = if ($azure.exists) { ConvertTo-VuGuidText $azureUser.OnPremisesImmutableId } else { $null }
                mailboxGuid = if ($exo.exists -and $mailbox) { ConvertTo-VuGuidText $mailbox.ExchangeGuid } else { $null }
                archiveGuid = $archiveGuid
                archiveStatus = $archiveStatus
            }

            sync = [pscustomobject]@{
                attributeName = "extensionAttribute3"
                attributeValue = $attribute3
                blockedByAttribute3 = $syncBlocked
                status = if (-not $ad.checked) {
                    "AD não validado"
                }
                elseif (-not $ad.exists) {
                    "AD não encontrado"
                }
                elseif ($syncBlocked) {
                    "Bloqueada pelo atributo 3"
                }
                else {
                    "Atributo 3 vazio"
                }
            }

            e3 = $e3

            exo = [pscustomobject]@{
                checked = [bool]$exo.checked
                exists = [bool]$exo.exists
                error = $exo.error
                recipientTypeDetails = $recipientType
                primarySmtpAddress = $primarySmtpAddress
                upn = if ($exo.exists -and $mailbox.UserPrincipalName) { [string]$mailbox.UserPrincipalName } else { $resolved }
                mailboxGuid = if ($exo.exists -and $mailbox) { ConvertTo-VuGuidText $mailbox.ExchangeGuid } else { $null }
                consistencyGuid = if ($azure.exists) { ConvertTo-VuGuidText $azureUser.OnPremisesImmutableId } else { $null }
                archiveEnabled = [bool]$archiveEnabled
                archiveProvisioned = [bool]$archiveProvisioned
                archiveStatus = $archiveStatus
                archiveGuid = $archiveGuid
                recipientLimits = if ($exo.exists -and $mailbox) { [string]$mailbox.RecipientLimits } else { $null }
            }

            diagnostic = $diagnostic
        }
    }

    return @{
        ok = $true
        count = $results.Count
        notes = $globalNotes
        results = $results
    }
}

try {
    $request = Get-RequestJson
    $requestAction = Get-RequestedAction $request

    if (-not $requestAction) {
        Write-Json @{
            ok = $false
            error = "Ação não informada."
        }
        return
    }

    switch ($requestAction) {
        "csrf-token" {
            Write-Json @{ ok = $true; token = (Get-VuCsrfToken) }
            return
        }

        "verificar" {
            if (-not $request) {
                Write-Json @{
                    ok = $false
                    error = "Pedido vazio."
                }
                return
            }

            Write-Json (Invoke-VuVerify -Users @($request.users))
            return
        }

        "search-created" {
            if (-not $request) {
                Write-Json @{
                    ok = $false
                    error = "Pedido vazio."
                }
                return
            }

            $startText = Get-TextValue $request.startDate
            $endText = Get-TextValue $request.endDate

            if (-not $startText -or -not $endText) {
                Write-Json @{
                    ok = $false
                    error = "Informe a data inicial e a data final."
                }
                return
            }

            try {
                $culture = [System.Globalization.CultureInfo]::InvariantCulture
                $startDate = [datetime]::ParseExact($startText, "yyyy-MM-dd", $culture)
                $endDateBase = [datetime]::ParseExact($endText, "yyyy-MM-dd", $culture)
                $endDate = $endDateBase.AddDays(1).AddTicks(-1)
            }
            catch {
                Write-Json @{
                    ok = $false
                    error = "Formato de data inválido. Utilize yyyy-MM-dd."
                }
                return
            }

            if ($endDate -lt $startDate) {
                Write-Json @{
                    ok = $false
                    error = "A data final não pode ser anterior à data inicial."
                }
                return
            }

            if (($endDate.Date - $startDate.Date).TotalDays -gt 90) {
                Write-Json @{
                    ok = $false
                    error = "O intervalo máximo permitido é de 90 dias."
                }
                return
            }

            $onlyEnabled = [bool]$request.onlyEnabled
            $requireUpn = [bool]$request.requireUpn

            Write-Json (Search-AdUsersCreated `
                -StartDate $startDate `
                -EndDate $endDate `
                -OnlyEnabled $onlyEnabled `
                -RequireUpn $requireUpn)
            return
        }

        "add-e3" {
            if (-not $request) {
                Write-Json @{
                    ok = $false
                    error = "Pedido vazio."
                }
                return
            }

            $target = Get-TextValue $request.user
            if ($Method -ne 'POST' -or -not (Test-VuCsrfToken ([string]$request.csrfToken))) {
                Write-VuAudit -ActionName $requestAction -Target $target -Success $false -Detail 'Pedido recusado: método ou token CSRF inválido.'
                Write-Json @{ ok = $false; error = 'Pedido administrativo não autorizado. Atualize a página e tente novamente.' }
                return
            }
            if (-not $target) { Write-Json @{ ok = $false; error = 'Utilizador inválido.' }; return }
            $actionResult = Invoke-VuAddE3 -User $target
            Write-VuAudit -ActionName $requestAction -Target $target -Success ([bool]$actionResult.ok) -Detail $(if ($actionResult.ok) { $actionResult.message } else { $actionResult.error })
            Write-Json $actionResult
            return
        }

        "enable-archive" {
            if (-not $request) {
                Write-Json @{
                    ok = $false
                    error = "Pedido vazio."
                }
                return
            }

            $target = Get-TextValue $request.user
            if ($Method -ne 'POST' -or -not (Test-VuCsrfToken ([string]$request.csrfToken))) {
                Write-VuAudit -ActionName $requestAction -Target $target -Success $false -Detail 'Pedido recusado: método ou token CSRF inválido.'
                Write-Json @{ ok = $false; error = 'Pedido administrativo não autorizado. Atualize a página e tente novamente.' }
                return
            }
            if (-not $target) { Write-Json @{ ok = $false; error = 'Utilizador inválido.' }; return }
            $actionResult = Invoke-VuEnableArchive -User $target
            Write-VuAudit -ActionName $requestAction -Target $target -Success ([bool]$actionResult.ok) -Detail $(if ($actionResult.ok) { $actionResult.message } else { $actionResult.error })
            Write-Json $actionResult
            return
        }

        "clear-hide-address-list" {
            $target = if ($request) { Get-TextValue $request.user } else { $null }
            if ($Method -ne 'POST' -or -not $request -or -not (Test-VuCsrfToken ([string]$request.csrfToken))) {
                Write-VuAudit -ActionName $requestAction -Target $target -Success $false -Detail 'Pedido recusado: método ou token CSRF inválido.'
                Write-Json @{ ok = $false; error = 'Pedido administrativo não autorizado. Atualize a página e tente novamente.' }
                return
            }
            if (-not $target) { Write-Json @{ ok = $false; error = 'Utilizador inválido.' }; return }
            $actionResult = Invoke-VuClearHideFromAddressLists -User $target
            Write-VuAudit -ActionName $requestAction -Target $target -Success ([bool]$actionResult.ok) -Detail $(if ($actionResult.ok) { $actionResult.message } else { $actionResult.error })
            Write-Json $actionResult
            return
        }

        "set-recipient-limit" {
            $target = if ($request) { Get-TextValue $request.user } else { $null }
            if ($Method -ne 'POST' -or -not $request -or -not (Test-VuCsrfToken ([string]$request.csrfToken))) {
                Write-VuAudit -ActionName $requestAction -Target $target -Success $false -Detail 'Pedido recusado: método ou token CSRF inválido.'
                Write-Json @{ ok = $false; error = 'Pedido administrativo não autorizado. Atualize a página e tente novamente.' }
                return
            }
            $limitValue = 0
            if (-not $target -or -not [int]::TryParse([string]$request.limit, [ref]$limitValue) -or $limitValue -lt 1 -or $limitValue -gt 1000) {
                Write-Json @{ ok = $false; error = 'Informe um limite inteiro entre 1 e 1000.' }
                return
            }
            $actionResult = Invoke-VuSetRecipientLimit -User $target -Limit $limitValue
            Write-VuAudit -ActionName $requestAction -Target $target -Success ([bool]$actionResult.ok) -Detail $(if ($actionResult.ok) { $actionResult.message } else { $actionResult.error })
            Write-Json $actionResult
            return
        }

        "save-png" {
            if ($Method -ne 'POST' -or -not $request -or -not (Test-VuCsrfToken ([string]$request.csrfToken))) {
                Write-VuAudit -ActionName $requestAction -Target ([string]$request.fileName) -Success $false -Detail 'Pedido recusado: método ou token CSRF inválido.'
                Write-Json @{ ok = $false; error = 'Pedido não autorizado. Atualize a página e tente novamente.' }
                return
            }
            $actionResult = Invoke-VuSavePng -FileName ([string]$request.fileName) -ImageBase64 ([string]$request.imageBase64)
            Write-VuAudit -ActionName $requestAction -Target ([string]$request.fileName) -Success ([bool]$actionResult.ok) -Detail $(if ($actionResult.ok) { $actionResult.message } else { $actionResult.error })
            Write-Json $actionResult
            return
        }

        default {
            Write-Json @{
                ok = $false
                error = "Ação não suportada: $requestAction"
            }
            return
        }
    }
}
catch {
    Write-Json @{
        ok = $false
        error = $_.Exception.Message
    }
}
