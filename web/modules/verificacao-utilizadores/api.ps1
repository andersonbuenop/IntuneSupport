param(
    [string]$Action,
    [string]$Payload,
    [string]$Body
)

$ErrorActionPreference = "Continue"

function Write-Json {
    param($Obj)
    $Obj | ConvertTo-Json -Depth 30 -Compress
}

function Test-Cmd {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-RequestJson {
    try {
        if ($Query -and $Query["payload"]) {
            $decoded = [System.Uri]::UnescapeDataString([string]$Query["payload"])
            return $decoded | ConvertFrom-Json
        }
    } catch {}

    try {
        if ($script:Query -and $script:Query["payload"]) {
            $decoded = [System.Uri]::UnescapeDataString([string]$script:Query["payload"])
            return $decoded | ConvertFrom-Json
        }
    } catch {}

    try {
        if ($global:Query -and $global:Query["payload"]) {
            $decoded = [System.Uri]::UnescapeDataString([string]$global:Query["payload"])
            return $decoded | ConvertFrom-Json
        }
    } catch {}

    try {
        if (-not [string]::IsNullOrWhiteSpace($Payload)) {
            $decoded = [System.Uri]::UnescapeDataString($Payload)
            return $decoded | ConvertFrom-Json
        }
    } catch {}

    try {
        if (-not [string]::IsNullOrWhiteSpace($Body)) {
            return $Body | ConvertFrom-Json
        }
    } catch {}

    return $null
}

function Ensure-Graph {
    $notes = @()

    try {
        Import-Module Microsoft.Graph.Authentication -ErrorAction SilentlyContinue
        Import-Module Microsoft.Graph.Users -ErrorAction SilentlyContinue
        Import-Module Microsoft.Graph.Groups -ErrorAction SilentlyContinue

        $ctx = Get-MgContext -ErrorAction SilentlyContinue
        if (-not $ctx) {
            Connect-MgGraph -Scopes "User.Read.All","Group.Read.All","GroupMember.ReadWrite.All","Directory.Read.All" -NoWelcome -ErrorAction Stop | Out-Null
            $notes += "Graph ligado por WAM."
        }
    } catch {
        $notes += "Graph/WAM erro: $($_.Exception.Message)"
    }

    return $notes
}

function Ensure-Exchange {
    $notes = @()

    try {
        Import-Module ExchangeOnlineManagement -ErrorAction SilentlyContinue

        $exoOk = $false
        if (Test-Cmd "Get-ConnectionInformation") {
            $conn = Get-ConnectionInformation -ErrorAction SilentlyContinue
            if ($conn) { $exoOk = $true }
        }

        if (-not $exoOk) {
            Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop | Out-Null
            $notes += "Exchange Online ligado por WAM."
        }
    } catch {
        $notes += "Exchange/WAM erro: $($_.Exception.Message)"
    }

    return $notes
}

function Find-AdUserLocal {
    param([string]$User)

    $domains = @("central.rinterna.local", "rede.rinterna.local")

    try {
        Import-Module ActiveDirectory -ErrorAction SilentlyContinue
    } catch {}

    $candidates = New-Object System.Collections.Generic.List[string]
    $clean = ([string]$User).Trim()

    if ($clean) { $candidates.Add($clean) }

    if ($clean -match "@") {
        $prefix = $clean.Split("@")[0]
        if ($prefix) { $candidates.Add($prefix) }
    }
    else {
        $candidates.Add("$clean@corp.santander.pt")
        $candidates.Add("$clean@santander.pt")
        $candidates.Add("$clean@servexternos.santander.pt")
    }

    $candidates = $candidates | Select-Object -Unique

    foreach ($domain in $domains) {
        foreach ($candidate in $candidates) {
            try {
                $safe = $candidate.Replace("'","''")

                $filter = "SamAccountName -eq '$safe' -or UserPrincipalName -eq '$safe' -or Mail -eq '$safe'"

                $ad = Get-ADUser `
                    -Server $domain `
                    -Filter $filter `
                    -Properties DisplayName,Mail,UserPrincipalName,SamAccountName,Enabled,WhenCreated,DistinguishedName,ProxyAddresses `
                    -ErrorAction Stop |
                    Select-Object -First 1

                if ($ad) {
                    return [pscustomobject]@{
                        exists = $true
                        domain = $domain
                        enabled = [bool]$ad.Enabled
                        created = $ad.WhenCreated
                        dn = $ad.DistinguishedName
                        sam = $ad.SamAccountName
                        upn = $ad.UserPrincipalName
                        mail = $ad.Mail
                        displayName = $ad.DisplayName
                        proxyAddresses = @($ad.ProxyAddresses)
                    }
                }
            } catch {}
        }
    }

    return [pscustomobject]@{
        exists = $false
        domain = $null
        enabled = $false
        created = $null
        dn = $null
        sam = $null
        upn = $null
        mail = $null
        displayName = $null
        proxyAddresses = @()
    }
}
function Find-AzureUser {
    param([string]$User)

    if (-not (Test-Cmd "Get-MgUser")) {
        try { Import-Module Microsoft.Graph.Users -ErrorAction SilentlyContinue } catch {}
    }

    if (-not (Test-Cmd "Get-MgUser")) {
        return $null
    }

    $clean = ([string]$User).Trim()
    $candidates = New-Object System.Collections.Generic.List[string]

    if ($clean) { $candidates.Add($clean) }

    if ($clean -match "@") {
        $prefix = $clean.Split("@")[0]
        if ($prefix) { $candidates.Add($prefix) }
    }
    else {
        $candidates.Add("$clean@corp.santander.pt")
        $candidates.Add("$clean@santander.pt")
        $candidates.Add("$clean@servexternos.santander.pt")
    }

    $candidates = $candidates | Select-Object -Unique

    foreach ($candidate in $candidates) {
        try {
            return Get-MgUser `
                -UserId $candidate `
                -Property "id,displayName,userPrincipalName,mail,accountEnabled,createdDateTime,onPremisesSamAccountName,onPremisesLastSyncDateTime" `
                -ErrorAction Stop
        } catch {}
    }

    foreach ($candidate in $candidates) {
        try {
            $safe = $candidate.Replace("'","''")
            $filter = "userPrincipalName eq '$safe' or mail eq '$safe' or onPremisesSamAccountName eq '$safe'"

            $u = Get-MgUser `
                -Filter $filter `
                -Property "id,displayName,userPrincipalName,mail,accountEnabled,createdDateTime,onPremisesSamAccountName,onPremisesLastSyncDateTime" `
                -ConsistencyLevel eventual `
                -ErrorAction Stop |
                Select-Object -First 1

            if ($u) { return $u }
        } catch {}
    }

    # Último fallback: procurar pelo início do UPN
    if ($clean -notmatch "@") {
        try {
            $safePrefix = $clean.Replace("'","''")
            $filter = "startswith(userPrincipalName,'$safePrefix')"

            $u = Get-MgUser `
                -Filter $filter `
                -Property "id,displayName,userPrincipalName,mail,accountEnabled,createdDateTime,onPremisesSamAccountName,onPremisesLastSyncDateTime" `
                -ConsistencyLevel eventual `
                -ErrorAction Stop |
                Where-Object {
                    $_.UserPrincipalName -like "$clean@*" -or
                    $_.OnPremisesSamAccountName -eq $clean
                } |
                Select-Object -First 1

            if ($u) { return $u }
        } catch {}
    }

    return $null
}
function Test-E3 {
    param($AzureUser)

    $groupName = "GR_PT_M365_E3"

    if (-not $AzureUser) {
        return [pscustomobject]@{
            hasGroup = $false
            groupName = $groupName
            checked = $false
        }
    }

    try {
        $groups = Get-MgUserTransitiveMemberOf -UserId $AzureUser.Id -All -ErrorAction Stop

        foreach ($g in $groups) {
            if ($g.AdditionalProperties.displayName -eq $groupName) {
                return [pscustomobject]@{
                    hasGroup = $true
                    groupName = $groupName
                    checked = $true
                }
            }
        }
    } catch {}

    return [pscustomobject]@{
        hasGroup = $false
        groupName = $groupName
        checked = $true
    }
}

function Find-Exo {
    param([string]$Identity)

    if ([string]::IsNullOrWhiteSpace($Identity)) {
        return $null
    }

    $clean = ([string]$Identity).Trim()
    $candidates = New-Object System.Collections.Generic.List[string]

    $candidates.Add($clean)

    if ($clean -match "@") {
        $prefix = $clean.Split("@")[0]
        if ($prefix) { $candidates.Add($prefix) }
    }
    else {
        $candidates.Add("$clean@corp.santander.pt")
        $candidates.Add("$clean@santander.pt")
        $candidates.Add("$clean@servexternos.santander.pt")
    }

    $candidates = $candidates | Select-Object -Unique

    foreach ($candidate in $candidates) {
        try {
            if (Test-Cmd "Get-EXOMailbox") {
                $mbx = Get-EXOMailbox `
                    -Identity $candidate `
                    -Properties ArchiveStatus,ArchiveGuid,RecipientTypeDetails,PrimarySmtpAddress,Alias `
                    -ErrorAction Stop

                if ($mbx) { return $mbx }
            }

            if (Test-Cmd "Get-Mailbox") {
                $mbx = Get-Mailbox -Identity $candidate -ErrorAction Stop
                if ($mbx) { return $mbx }
            }
        } catch {}
    }

    return $null
}
function Get-Diagnostic {
    param($Ad,$Az,$E3,$Exo,$ArchiveEnabled)

    if ($Ad.exists -and -not $Az) {
        return "Existe no AD mas não existe no Azure. Se foi criado hoje, aguardar sincronização FIM amanhã às 08:00."
    }

    if (-not $Ad.exists -and -not $Az) {
        return "Utilizador não encontrado no AD nem no Azure"
    }

    if (-not $Ad.exists -and $Az) {
        return "Existe no Azure mas não foi encontrado no AD local"
    }

    if ($Ad.exists -and -not $Ad.enabled) {
        return "Utilizador desativado no AD"
    }

    if ($Az -and -not $Az.AccountEnabled) {
        return "Utilizador desativado no Azure"
    }

    if (-not $E3.hasGroup) {
        return "Sem grupo GR_PT_M365_E3"
    }

    if (-not $Exo) {
        return "Sem mailbox no Exchange Online"
    }

    if (-not $ArchiveEnabled) {
        return "Arquivo Online não ativo"
    }

    return "Utilizador saudável"
}

function Invoke-VuAddE3 {
    param([string]$User)

    $groupName = "GR_PT_M365_E3"
    $notes = Ensure-Graph

    $az = Find-AzureUser $User

    if (-not $az) {
        return @{
            ok = $false
            error = "Utilizador não encontrado no Azure. Se foi criado hoje no AD, aguardar sincronização FIM amanhã às 08:00."
            notes = $notes
        }
    }

    try {
        $grp = Get-MgGroup -Filter "displayName eq '$groupName'" -ConsistencyLevel eventual -ErrorAction Stop | Select-Object -First 1

        if (-not $grp) {
            return @{
                ok = $false
                error = "Grupo $groupName não encontrado."
                notes = $notes
            }
        }

        $null = New-MgGroupMemberByRef -GroupId $grp.Id -BodyParameter @{ "@odata.id" = "https://graph.microsoft.com/v1.0/directoryObjects/$($az.Id)" } -ErrorAction Stop

        return @{
            ok = $true
            message = "Grupo $groupName adicionado ao utilizador $($az.UserPrincipalName)."
            notes = $notes
        }
    } catch {
        return @{
            ok = $false
            error = "Erro ao adicionar E3: $($_.Exception.Message)"
            notes = $notes
        }
    }
}

function Invoke-VuEnableArchive {
    param([string]$User)

    $notes = Ensure-Exchange

    try {
        $exo = Find-Exo $User

        if (-not $exo) {
            return @{
                ok = $false
                error = "Mailbox não encontrada no Exchange Online."
                notes = $notes
            }
        }

        $archiveGuid = [string]$exo.ArchiveGuid
        $archiveStatus = [string]$exo.ArchiveStatus

        if ($archiveStatus -eq "Active" -or ($archiveGuid -and $archiveGuid -ne "00000000-0000-0000-0000-000000000000")) {
            return @{
                ok = $true
                message = "Arquivo Online já está ativo para $User."
                notes = $notes
            }
        }

        $null = Enable-Mailbox -Identity $User -Archive -ErrorAction Stop

        return @{
            ok = $true
            message = "Pedido de ativação do Arquivo Online enviado para $User."
            notes = $notes
        }
    } catch {
        return @{
            ok = $false
            error = "Erro ao ativar Arquivo Online: $($_.Exception.Message)"
            notes = $notes
        }
    }
}

try {
    $request = Get-RequestJson

    if (-not $request) {
        Write-Json @{
            ok = $false
            error = "Pedido vazio."
        }
        exit
    }

    if ($request.action -eq "add-e3") {
        Write-Json (Invoke-VuAddE3 -User ([string]$request.user))
        exit
    }

    if ($request.action -eq "enable-archive") {
        Write-Json (Invoke-VuEnableArchive -User ([string]$request.user))
        exit
    }

    $users = @($request.users)

    if (-not $users -or $users.Count -eq 0) {
        Write-Json @{
            ok = $false
            error = "Nenhum utilizador recebido pela API."
        }
        exit
    }

    $globalNotes = @()
    $globalNotes += Ensure-Graph
    $globalNotes += Ensure-Exchange

    $results = @()

    foreach ($user in $users) {
        $inputUser = [string]$user

        if ([string]::IsNullOrWhiteSpace($inputUser)) {
            continue
        }

        $ad = Find-AdUserLocal $inputUser

        $resolved = $inputUser

        if ($ad.exists -and $ad.upn) {
            $resolved = $ad.upn
        }

        $az = Find-AzureUser $resolved

        if (-not $az -and $inputUser -ne $resolved) {
            $az = Find-AzureUser $inputUser
        }

        if ($az -and $az.UserPrincipalName) {
            $resolved = $az.UserPrincipalName
        }

        $e3 = Test-E3 $az

        $exo = Find-Exo $resolved

        if (-not $exo -and $ad.mail) {
            $exo = Find-Exo $ad.mail
        }

        $archiveGuid = $null
        $archiveStatus = $null
        $archiveEnabled = $false
        $recipientType = $null

        if ($exo) {
            $archiveGuid = [string]$exo.ArchiveGuid
            $archiveStatus = [string]$exo.ArchiveStatus
            $recipientType = [string]$exo.RecipientTypeDetails

            if ($archiveStatus -eq "Active" -or ($archiveGuid -and $archiveGuid -ne "00000000-0000-0000-0000-000000000000")) {
                $archiveEnabled = $true
            }
        }

        $diag = Get-Diagnostic $ad $az $e3 $exo $archiveEnabled

        $results += [pscustomobject]@{
            input = $inputUser
            resolvedUser = $resolved
            displayName = if ($az -and $az.DisplayName) { $az.DisplayName } elseif ($ad.displayName) { $ad.displayName } else { $null }

            ad = [pscustomobject]@{
                exists = [bool]$ad.exists
                domain = $ad.domain
                enabled = [bool]$ad.enabled
                created = if ($ad.created) { $ad.created.ToString("yyyy-MM-dd HH:mm") } else { $null }
                dn = $ad.dn
                sam = $ad.sam
                upn = $ad.upn
                mail = $ad.mail
                proxyAddresses = @($ad.proxyAddresses)
            }

            azure = [pscustomobject]@{
                exists = [bool]$az
                enabled = if ($az) { [bool]$az.AccountEnabled } else { $false }
                created = if ($az -and $az.CreatedDateTime) { $az.CreatedDateTime.ToString("yyyy-MM-dd HH:mm") } else { $null }
                upn = if ($az) { $az.UserPrincipalName } else { $null }
                id = if ($az) { $az.Id } else { $null }
                lastSync = if ($az -and $az.OnPremisesLastSyncDateTime) { $az.OnPremisesLastSyncDateTime.ToString("yyyy-MM-dd HH:mm") } else { $null }
            }

            e3 = $e3

            exo = [pscustomobject]@{
                exists = [bool]$exo
                recipientTypeDetails = $recipientType
                archiveEnabled = [bool]$archiveEnabled
                archiveStatus = $archiveStatus
                archiveGuid = $archiveGuid
            }

            diagnostic = $diag
        }
    }

    Write-Json @{
        ok = $true
        count = $results.Count
        notes = $globalNotes
        results = $results
    }
}
catch {
    Write-Json @{
        ok = $false
        error = $_.Exception.Message
    }
}


