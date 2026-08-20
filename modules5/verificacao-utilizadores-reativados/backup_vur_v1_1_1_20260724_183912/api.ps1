#requires -Version 5.1
<#
.SYNOPSIS
    Diagnóstico híbrido de utilizadores reativados.
.DESCRIPTION
    Modo somente leitura. Consulta AD local, Exchange on-premises,
    Microsoft Graph e Exchange Online. Não altera atributos.
#>

$ErrorActionPreference = 'Stop'

function Write-JsonResponse {
    param(
        [Parameter(Mandatory)] [object]$Data,
        [int]$StatusCode = 200
    )
    try {
        if (Get-Command Set-HttpStatusCode -ErrorAction SilentlyContinue) {
            Set-HttpStatusCode $StatusCode
        }
    } catch {}
    return ($Data | ConvertTo-Json -Depth 20 -Compress)
}

function Get-RequestPayload {
    if ($null -ne $Body -and $Body -isnot [string]) { return $Body }
    if ($Body -is [string] -and -not [string]::IsNullOrWhiteSpace($Body)) {
        try { return ($Body | ConvertFrom-Json) } catch {}
    }
    if ($Request -and $Request.Body) {
        try {
            $reader = New-Object System.IO.StreamReader($Request.Body)
            $raw = $reader.ReadToEnd()
            if ($raw) { return ($raw | ConvertFrom-Json) }
        } catch {}
    }
    return [pscustomobject]@{}
}

function Convert-ByteArrayToGuidString {
    param($Value)
    if ($null -eq $Value) { return $null }
    try {
        if ($Value -is [byte[]] -and $Value.Length -eq 16) {
            return ([guid]::new($Value)).Guid
        }
        if ($Value -is [guid]) { return $Value.Guid }
        $s = [string]$Value
        if ([string]::IsNullOrWhiteSpace($s)) { return $null }
        return ([guid]$s).Guid
    } catch {
        return [string]$Value
    }
}

function Convert-GuidToImmutableId {
    param($GuidValue)
    try {
        $g = [guid]$GuidValue
        return [Convert]::ToBase64String($g.ToByteArray())
    } catch { return $null }
}

function Get-SafeProperty {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($p) { return $p.Value }
    return $null
}

function Get-ConnectionStatus {
    $adCmd = Get-Command Get-ADUser -ErrorAction SilentlyContinue
    $exoCmd = Get-Command Get-EXORecipient -ErrorAction SilentlyContinue
    $graphCmd = Get-Command Get-MgContext -ErrorAction SilentlyContinue
    $onPremCmd = Get-Command Get-RemoteMailbox -ErrorAction SilentlyContinue

    $graphConnected = $false
    $graphMessage = 'Módulo Microsoft.Graph não carregado.'
    if ($graphCmd) {
        try {
            $ctx = Get-MgContext
            $graphConnected = [bool]($ctx -and $ctx.Account)
            $graphMessage = if ($graphConnected) { "Conectado como $($ctx.Account)" } else { 'Microsoft Graph sem sessão ativa.' }
        } catch { $graphMessage = $_.Exception.Message }
    }

    $exoConnected = $false
    $exoMessage = 'ExchangeOnlineManagement não carregado.'
    if ($exoCmd) {
        try {
            $null = Get-EXORecipient -ResultSize 1 -ErrorAction Stop
            $exoConnected = $true
            $exoMessage = 'Exchange Online disponível.'
        } catch { $exoMessage = $_.Exception.Message }
    }

    [pscustomobject]@{
        ad = [pscustomobject]@{
            connected = [bool]$adCmd
            message = if ($adCmd) { 'Módulo ActiveDirectory disponível.' } else { 'Módulo ActiveDirectory não carregado.' }
        }
        exchangeOnPrem = [pscustomobject]@{
            connected = [bool]$onPremCmd
            message = if ($onPremCmd) { 'Cmdlets do Exchange on-premises disponíveis.' } else { 'Cmdlets Get-RemoteMailbox/Get-Recipient não encontrados na sessão.' }
        }
        graph = [pscustomobject]@{ connected = $graphConnected; message = $graphMessage }
        exchangeOnline = [pscustomobject]@{ connected = $exoConnected; message = $exoMessage }
    }
}

function Find-AdUserHybrid {
    param([Parameter(Mandatory)][string]$Identity)

    if (-not (Get-Command Get-ADUser -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{ found=$false; error='Módulo ActiveDirectory não disponível.' }
    }

    $properties = @(
        'Enabled','DisplayName','UserPrincipalName','SamAccountName','mail','targetAddress',
        'proxyAddresses','mailNickname','whenCreated','whenChanged','ObjectGUID',
        'ms-DS-ConsistencyGuid','msExchRecipientTypeDetails','msExchRemoteRecipientType',
        'msExchRecipientDisplayType','msExchMailboxGuid','msExchArchiveGUID',
        'legacyExchangeDN','DistinguishedName'
    )

    $escaped = $Identity.Replace("'","''")
    $servers = @()
    if ($env:USERDNSDOMAIN) { $servers += $env:USERDNSDOMAIN }
    $servers += @('central.rinterna.local','rede.rinterna.local')
    $servers = $servers | Select-Object -Unique

    foreach ($server in $servers) {
        try {
            $user = $null
            try { $user = Get-ADUser -Identity $Identity -Server $server -Properties $properties -ErrorAction Stop } catch {}
            if (-not $user) {
                $filter = "UserPrincipalName -eq '$escaped' -or mail -eq '$escaped' -or SamAccountName -eq '$escaped' -or Name -eq '$escaped'"
                $user = Get-ADUser -Filter $filter -Server $server -Properties $properties -ErrorAction Stop | Select-Object -First 1
            }
            if ($user) {
                $objectGuid = Convert-ByteArrayToGuidString $user.ObjectGUID
                $consistencyGuid = Convert-ByteArrayToGuidString (Get-SafeProperty $user 'ms-DS-ConsistencyGuid')
                return [pscustomobject]@{
                    found = $true
                    server = $server
                    displayName = $user.DisplayName
                    userPrincipalName = $user.UserPrincipalName
                    samAccountName = $user.SamAccountName
                    enabled = [bool]$user.Enabled
                    mail = $user.mail
                    targetAddress = $user.targetAddress
                    proxyAddresses = @($user.proxyAddresses)
                    mailNickname = $user.mailNickname
                    whenCreated = $user.whenCreated
                    whenChanged = $user.whenChanged
                    distinguishedName = $user.DistinguishedName
                    objectGuid = $objectGuid
                    consistencyGuid = $consistencyGuid
                    expectedImmutableId = if ($consistencyGuid) { Convert-GuidToImmutableId $consistencyGuid } else { Convert-GuidToImmutableId $objectGuid }
                    exchangeGuid = Convert-ByteArrayToGuidString (Get-SafeProperty $user 'msExchMailboxGuid')
                    archiveGuid = Convert-ByteArrayToGuidString (Get-SafeProperty $user 'msExchArchiveGUID')
                    recipientTypeDetails = Get-SafeProperty $user 'msExchRecipientTypeDetails'
                    remoteRecipientType = Get-SafeProperty $user 'msExchRemoteRecipientType'
                    recipientDisplayType = Get-SafeProperty $user 'msExchRecipientDisplayType'
                    legacyExchangeDN = Get-SafeProperty $user 'legacyExchangeDN'
                }
            }
        } catch {
            $lastError = $_.Exception.Message
        }
    }

    return [pscustomobject]@{ found=$false; error=$lastError }
}

function Find-ExchangeOnPremRecipient {
    param([Parameter(Mandatory)][string]$Identity)

    if (-not (Get-Command Get-Recipient -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{ found=$false; error='Cmdlets do Exchange on-premises não disponíveis na sessão atual.' }
    }

    try {
        $recipient = Get-Recipient -Identity $Identity -ErrorAction SilentlyContinue
        if (-not $recipient) {
            $recipient = Get-Recipient -ResultSize Unlimited -Filter "EmailAddresses -eq 'smtp:$Identity'" -ErrorAction SilentlyContinue | Select-Object -First 1
        }
        if (-not $recipient) { return [pscustomobject]@{ found=$false } }

        $remote = $null
        $mailbox = $null
        $mailUser = $null
        try { $remote = Get-RemoteMailbox -Identity $recipient.Identity -ErrorAction Stop } catch {}
        try { $mailbox = Get-Mailbox -Identity $recipient.Identity -ErrorAction Stop } catch {}
        try { $mailUser = Get-MailUser -Identity $recipient.Identity -ErrorAction Stop } catch {}

        $source = if ($remote) { $remote } elseif ($mailbox) { $mailbox } elseif ($mailUser) { $mailUser } else { $recipient }

        return [pscustomobject]@{
            found = $true
            identity = [string]$recipient.Identity
            name = [string]$recipient.Name
            displayName = [string]$recipient.DisplayName
            recipientType = [string]$recipient.RecipientType
            recipientTypeDetails = [string]$recipient.RecipientTypeDetails
            primarySmtpAddress = [string](Get-SafeProperty $source 'PrimarySmtpAddress')
            emailAddresses = @((Get-SafeProperty $source 'EmailAddresses') | ForEach-Object { [string]$_ })
            externalEmailAddress = [string](Get-SafeProperty $source 'ExternalEmailAddress')
            remoteRoutingAddress = [string](Get-SafeProperty $source 'RemoteRoutingAddress')
            exchangeGuid = Convert-ByteArrayToGuidString (Get-SafeProperty $source 'ExchangeGuid')
            archiveGuid = Convert-ByteArrayToGuidString (Get-SafeProperty $source 'ArchiveGuid')
            remoteRecipientType = [string](Get-SafeProperty $source 'RemoteRecipientType')
            legacyExchangeDN = [string](Get-SafeProperty $source 'LegacyExchangeDN')
            hasRemoteMailbox = [bool]$remote
            hasLocalMailbox = [bool]$mailbox
            hasMailUser = [bool]$mailUser
        }
    } catch {
        return [pscustomobject]@{ found=$false; error=$_.Exception.Message }
    }
}

function Find-EntraUserHybrid {
    param([Parameter(Mandatory)][string]$Identity)

    if (-not (Get-Command Get-MgUser -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{ found=$false; error='Microsoft.Graph.Users não disponível.' }
    }
    try {
        $escaped = $Identity.Replace("'","''")
        $props = @(
            'id','displayName','userPrincipalName','mail','accountEnabled','onPremisesSyncEnabled',
            'onPremisesImmutableId','onPremisesDistinguishedName','onPremisesSamAccountName',
            'onPremisesSecurityIdentifier','onPremisesProvisioningErrors','assignedLicenses',
            'proxyAddresses'
        )
        $user = $null
        try { $user = Get-MgUser -UserId $Identity -Property $props -ErrorAction Stop } catch {}
        if (-not $user) {
            $filter = "userPrincipalName eq '$escaped' or mail eq '$escaped'"
            $user = Get-MgUser -Filter $filter -Property $props -Top 2 -ErrorAction Stop | Select-Object -First 1
        }
        if (-not $user) { return [pscustomobject]@{ found=$false } }

        return [pscustomobject]@{
            found = $true
            id = $user.Id
            displayName = $user.DisplayName
            userPrincipalName = $user.UserPrincipalName
            mail = $user.Mail
            accountEnabled = $user.AccountEnabled
            onPremisesSyncEnabled = $user.OnPremisesSyncEnabled
            onPremisesImmutableId = $user.OnPremisesImmutableId
            onPremisesDistinguishedName = $user.OnPremisesDistinguishedName
            onPremisesSamAccountName = $user.OnPremisesSamAccountName
            onPremisesSecurityIdentifier = $user.OnPremisesSecurityIdentifier
            provisioningErrors = @($user.OnPremisesProvisioningErrors)
            proxyAddresses = @($user.ProxyAddresses)
            assignedLicenseCount = @($user.AssignedLicenses).Count
        }
    } catch {
        return [pscustomobject]@{ found=$false; error=$_.Exception.Message }
    }
}

function Find-ExchangeOnlineHybrid {
    param([Parameter(Mandatory)][string]$Identity)

    if (-not (Get-Command Get-EXORecipient -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{ found=$false; error='ExchangeOnlineManagement não disponível ou sem sessão.' }
    }

    try {
        $recipient = Get-EXORecipient -Identity $Identity -Properties DisplayName,RecipientType,RecipientTypeDetails,EmailAddresses,ExternalEmailAddress -ErrorAction SilentlyContinue
        $mailbox = $null
        $softDeleted = $null
        try {
            $mailbox = Get-EXOMailbox -Identity $Identity -Properties ExchangeGuid,ArchiveGuid,PrimarySmtpAddress,EmailAddresses,RecipientTypeDetails,WhenCreated,ExternalDirectoryObjectId -ErrorAction Stop
        } catch {}
        if (Get-Command Get-Mailbox -ErrorAction SilentlyContinue) {
            try { $softDeleted = Get-Mailbox -SoftDeletedMailbox -Identity $Identity -ErrorAction Stop } catch {}
        }

        if (-not $recipient -and -not $mailbox -and -not $softDeleted) {
            return [pscustomobject]@{ found=$false }
        }

        $source = if ($mailbox) { $mailbox } elseif ($softDeleted) { $softDeleted } else { $recipient }
        return [pscustomobject]@{
            found = $true
            displayName = [string](Get-SafeProperty $source 'DisplayName')
            recipientType = [string](Get-SafeProperty $recipient 'RecipientType')
            recipientTypeDetails = [string](Get-SafeProperty $source 'RecipientTypeDetails')
            primarySmtpAddress = [string](Get-SafeProperty $source 'PrimarySmtpAddress')
            emailAddresses = @((Get-SafeProperty $source 'EmailAddresses') | ForEach-Object { [string]$_ })
            externalEmailAddress = [string](Get-SafeProperty $recipient 'ExternalEmailAddress')
            exchangeGuid = Convert-ByteArrayToGuidString (Get-SafeProperty $source 'ExchangeGuid')
            archiveGuid = Convert-ByteArrayToGuidString (Get-SafeProperty $source 'ArchiveGuid')
            externalDirectoryObjectId = [string](Get-SafeProperty $source 'ExternalDirectoryObjectId')
            whenCreated = Get-SafeProperty $source 'WhenCreated'
            isSoftDeleted = [bool]$softDeleted
            hasActiveMailbox = [bool]$mailbox
        }
    } catch {
        return [pscustomobject]@{ found=$false; error=$_.Exception.Message }
    }
}

function Test-GuidEmpty {
    param($GuidValue)
    if ([string]::IsNullOrWhiteSpace([string]$GuidValue)) { return $true }
    return ([string]$GuidValue -eq '00000000-0000-0000-0000-000000000000')
}

function New-ComparisonRow {
    param($Attribute,$Ad,$OnPrem,$Entra,$Exo,$Status)
    [pscustomobject]@{
        attribute=$Attribute; ad=$Ad; exchangeOnPrem=$OnPrem; entra=$Entra; exchangeOnline=$Exo; status=$Status
    }
}

function Add-DiagnosisCheck {
    param(
        [Parameter(Mandatory)]
        [System.Collections.ArrayList]$List,

        [Parameter(Mandatory)]
        [string]$Key,

        [Parameter(Mandatory)]
        [string]$Title,

        [Parameter(Mandatory)]
        [ValidateSet(
            'ok',
            'warning',
            'error',
            'pending',
            'info'
        )]
        [string]$Status,

        [Parameter(Mandatory)]
        [string]$Detail
    )

    [void]$List.Add(
        [pscustomobject]@{
            key    = $Key
            title  = $Title
            status = $Status
            detail = $Detail
        }
    )
}

function Add-DiagnosisFinding {
    param(
        [Parameter(Mandatory)]
        [System.Collections.ArrayList]$List,

        [Parameter(Mandatory)]
        [ValidateSet(
            'success',
            'warning',
            'error',
            'info'
        )]
        [string]$Severity,

        [Parameter(Mandatory)]
        [string]$Title,

        [Parameter(Mandatory)]
        [string]$Message
    )

    [void]$List.Add(
        [pscustomobject]@{
            severity = $Severity
            title    = $Title
            message  = $Message
        }
    )
}

function Build-Diagnosis {
    param(
        $Identity,
        $Ad,
        $OnPrem,
        $Entra,
        $Exo
    )

    $findings = New-Object System.Collections.ArrayList
    $checks = New-Object System.Collections.ArrayList
    $actions = New-Object System.Collections.ArrayList
    $commands = New-Object System.Collections.ArrayList
    $comparison = New-Object System.Collections.ArrayList

    $adGuid = [string]$Ad.exchangeGuid
    $onPremGuid = [string]$OnPrem.exchangeGuid
    $exoGuid = [string]$Exo.exchangeGuid

    $adFound = [bool]$Ad.found
    $onPremFound = [bool]$OnPrem.found
    $entraFound = [bool]$Entra.found
    $exoFound = [bool]$Exo.found
    $exoActive = [bool]$Exo.hasActiveMailbox
    $exoSoft = [bool]$Exo.isSoftDeleted
    $hasRemote = [bool]$OnPrem.hasRemoteMailbox
    $hasLocal = [bool]$OnPrem.hasLocalMailbox
    $hasMailUser = [bool]$OnPrem.hasMailUser

    $localGuidAvailable = -not (
        Test-GuidEmpty $onPremGuid
    )

    $exoGuidAvailable = -not (
        Test-GuidEmpty $exoGuid
    )

    $guidMatch = $false

    if (
        $localGuidAvailable -and
        $exoGuidAvailable
    ) {
        $guidMatch = (
            $onPremGuid -ieq $exoGuid
        )
    }

    $archiveMatch = $false

    $bothArchiveEmpty = (
        [string]::IsNullOrWhiteSpace(
            [string]$OnPrem.archiveGuid
        ) -and
        [string]::IsNullOrWhiteSpace(
            [string]$Exo.archiveGuid
        )
    )

    if ($bothArchiveEmpty) {
        $archiveMatch = $true
    }
    elseif (
        $OnPrem.archiveGuid -and
        $Exo.archiveGuid
    ) {
        $archiveMatch = (
            [string]$OnPrem.archiveGuid -ieq
            [string]$Exo.archiveGuid
        )
    }

    $upnMatch = $false

    if (
        $Ad.userPrincipalName -and
        $Entra.userPrincipalName
    ) {
        $upnMatch = (
            [string]$Ad.userPrincipalName -ieq
            [string]$Entra.userPrincipalName
        )
    }

    $smtpMatch = $false

    if (
        $OnPrem.primarySmtpAddress -and
        $Exo.primarySmtpAddress
    ) {
        $smtpMatch = (
            [string]$OnPrem.primarySmtpAddress -ieq
            [string]$Exo.primarySmtpAddress
        )
    }

    $routingAddress = $null

    if ($OnPrem.remoteRoutingAddress) {
        $routingAddress = [string]$OnPrem.remoteRoutingAddress
    }
    elseif ($Ad.targetAddress) {
        $routingAddress = [string]$Ad.targetAddress
    }

    $routingOk = -not (
        [string]::IsNullOrWhiteSpace(
            $routingAddress
        )
    )

    $immutableMatch = $false

    if (
        $Ad.expectedImmutableId -and
        $Entra.onPremisesImmutableId
    ) {
        $immutableMatch = (
            [string]$Ad.expectedImmutableId -eq
            [string]$Entra.onPremisesImmutableId
        )
    }

    $syncEnabled = (
        $Entra.onPremisesSyncEnabled -eq $true
    )

    $licensePresent = (
        [int]$Entra.assignedLicenseCount -gt 0
    )

    $provisioningErrorCount = @(
        $Entra.provisioningErrors
    ).Count

    # Active Directory

    if ($adFound) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'ad' `
            -Title 'Active Directory' `
            -Status 'ok' `
            -Detail (
                "Objeto encontrado em $($Ad.server). " +
                "Conta habilitada: $($Ad.enabled)."
            )
    }
    else {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'ad' `
            -Title 'Active Directory' `
            -Status 'error' `
            -Detail (
                'O objeto não foi localizado no Active Directory.'
            )

        Add-DiagnosisFinding `
            -List $findings `
            -Severity 'error' `
            -Title 'Utilizador não encontrado no AD local' `
            -Message (
                'Sem o objeto de origem do Active Directory ' +
                'não é possível concluir o diagnóstico híbrido.'
            )
    }

    if (
        $adFound -and
        -not $Ad.enabled
    ) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'adEnabled' `
            -Title 'Conta habilitada' `
            -Status 'error' `
            -Detail (
                'A conta continua desativada no Active Directory.'
            )

        Add-DiagnosisFinding `
            -List $findings `
            -Severity 'error' `
            -Title 'Conta AD desativada' `
            -Message (
                'O utilizador foi encontrado, mas a conta ' +
                'continua desativada.'
            )
    }
    elseif ($adFound) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'adEnabled' `
            -Title 'Conta habilitada' `
            -Status 'ok' `
            -Detail (
                'A conta está habilitada no Active Directory.'
            )
    }

    # Exchange on-premises

    if ($onPremFound) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'onPrem' `
            -Title 'Exchange on-premises' `
            -Status 'ok' `
            -Detail (
                "Recipient encontrado como " +
                "$($OnPrem.recipientTypeDetails)."
            )
    }
    else {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'onPrem' `
            -Title 'Exchange on-premises' `
            -Status 'error' `
            -Detail (
                'Nenhum Recipient, RemoteMailbox, MailUser ' +
                'ou Mailbox foi localizado.'
            )

        if ($adFound) {
            Add-DiagnosisFinding `
                -List $findings `
                -Severity 'error' `
                -Title 'Recipient Exchange local ausente' `
                -Message (
                    'O utilizador existe no AD, mas não possui ' +
                    'objeto Exchange local correspondente.'
                )

            if ($Ad.userPrincipalName) {
                $alias = (
                    ($Ad.userPrincipalName -split '@')[0] `
                        -replace '[^a-zA-Z0-9._-]', ''
                )

                [void]$commands.Add(
                    "Enable-RemoteMailbox " +
                    "-Identity '$($Ad.distinguishedName)' " +
                    "-Alias '$alias' " +
                    "-RemoteRoutingAddress " +
                    "'$alias@SEU_TENANT.mail.onmicrosoft.com'"
                )
            }
        }
    }

    # Dupla mailbox:
    # não considerar erro apenas porque existe objeto nos dois lados.
    # Tem de existir inconsistência real.

    $doubleMailboxCritical = (
        $hasLocal -and
        $exoActive -and
        (
            (-not $guidMatch) -or
            (-not $routingOk)
        )
    )

    if ($doubleMailboxCritical) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'mailboxTopology' `
            -Title 'Topologia da mailbox' `
            -Status 'error' `
            -Detail (
                'Existe mailbox local e mailbox online, mas os ' +
                'atributos híbridos não estão coerentes.'
            )

        Add-DiagnosisFinding `
            -List $findings `
            -Severity 'error' `
            -Title 'Possível dupla mailbox' `
            -Message (
                'Foram encontradas mailboxes nos dois ambientes ' +
                'com GUID divergente, GUID ausente ou roteamento ' +
                'híbrido inválido.'
            )
    }
    elseif (
        $hasLocal -and
        $exoActive -and
        $guidMatch
    ) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'mailboxTopology' `
            -Title 'Topologia da mailbox' `
            -Status 'ok' `
            -Detail (
                'O objeto aparece nos dois ambientes, mas o ' +
                'ExchangeGuid coincide. Não foi caracterizada ' +
                'dupla mailbox.'
            )
    }
    elseif ($hasRemote) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'mailboxTopology' `
            -Title 'Topologia da mailbox' `
            -Status 'ok' `
            -Detail (
                'RemoteMailbox válida localizada no Exchange ' +
                'on-premises.'
            )
    }
    elseif (
        $onPremFound -and
        $exoActive -and
        $guidMatch
    ) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'mailboxTopology' `
            -Title 'Topologia da mailbox' `
            -Status 'ok' `
            -Detail (
                'A classificação local é atípica, porém a mailbox ' +
                'online está associada pelo mesmo ExchangeGuid.'
            )
    }
    elseif (
        $onPremFound -and
        -not $hasRemote -and
        -not $hasLocal
    ) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'mailboxTopology' `
            -Title 'Topologia da mailbox' `
            -Status 'warning' `
            -Detail (
                "O objeto local está classificado como " +
                "$($OnPrem.recipientTypeDetails), sem " +
                "RemoteMailbox explícita."
            )
    }

    # Entra ID

    if ($entraFound) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'entra' `
            -Title 'Microsoft Entra ID' `
            -Status 'ok' `
            -Detail (
                'Objeto encontrado no Microsoft Entra ID.'
            )
    }
    else {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'entra' `
            -Title 'Microsoft Entra ID' `
            -Status 'error' `
            -Detail (
                'O objeto não foi localizado no Microsoft Entra ID.'
            )

        Add-DiagnosisFinding `
            -List $findings `
            -Severity 'error' `
            -Title 'Utilizador ausente no Entra ID' `
            -Message (
                'Verifique o escopo e os erros do Entra Connect.'
            )
    }

    if ($entraFound) {
        if ($syncEnabled) {
            Add-DiagnosisCheck `
                -List $checks `
                -Key 'sync' `
                -Title 'Sincronização local' `
                -Status 'ok' `
                -Detail (
                    'OnPremisesSyncEnabled está verdadeiro.'
                )
        }
        else {
            Add-DiagnosisCheck `
                -List $checks `
                -Key 'sync' `
                -Title 'Sincronização local' `
                -Status 'error' `
                -Detail (
                    'OnPremisesSyncEnabled não está verdadeiro.'
                )

            Add-DiagnosisFinding `
                -List $findings `
                -Severity 'error' `
                -Title 'Objeto não marcado como sincronizado' `
                -Message (
                    'O objeto pode ser cloud-only ou não estar ' +
                    'associado corretamente ao AD local.'
                )
        }

        if ($provisioningErrorCount -gt 0) {
            Add-DiagnosisCheck `
                -List $checks `
                -Key 'provisioning' `
                -Title 'Erros de provisionamento' `
                -Status 'error' `
                -Detail (
                    "Foram encontrados " +
                    "$provisioningErrorCount erro(s)."
                )

            Add-DiagnosisFinding `
                -List $findings `
                -Severity 'error' `
                -Title 'Erros de provisionamento no Entra ID' `
                -Message (
                    "O objeto possui " +
                    "$provisioningErrorCount erro(s) " +
                    "de provisionamento."
                )
        }
        else {
            Add-DiagnosisCheck `
                -List $checks `
                -Key 'provisioning' `
                -Title 'Erros de provisionamento' `
                -Status 'ok' `
                -Detail (
                    'Nenhum erro de provisionamento foi ' +
                    'devolvido pelo Graph.'
                )
        }

        if ($licensePresent) {
            Add-DiagnosisCheck `
                -List $checks `
                -Key 'license' `
                -Title 'Licenciamento' `
                -Status 'ok' `
                -Detail (
                    "$($Entra.assignedLicenseCount) " +
                    "licença(s) atribuída(s)."
                )
        }
        else {
            Add-DiagnosisCheck `
                -List $checks `
                -Key 'license' `
                -Title 'Licenciamento' `
                -Status 'warning' `
                -Detail (
                    'Nenhuma licença atribuída foi encontrada.'
                )

            Add-DiagnosisFinding `
                -List $findings `
                -Severity 'warning' `
                -Title 'Sem licenças atribuídas' `
                -Message (
                    'Confirme se o utilizador deve possuir uma ' +
                    'licença com Exchange Online.'
                )
        }
    }

    # Exchange Online

    if (
        $exoFound -and
        $exoActive
    ) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'exo' `
            -Title 'Exchange Online' `
            -Status 'ok' `
            -Detail (
                'Mailbox ativa localizada no Exchange Online.'
            )
    }
    elseif ($exoSoft) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'exo' `
            -Title 'Exchange Online' `
            -Status 'error' `
            -Detail (
                'Foi localizada somente uma mailbox soft-deleted.'
            )

        Add-DiagnosisFinding `
            -List $findings `
            -Severity 'error' `
            -Title 'Mailbox soft-deleted encontrada' `
            -Message (
                'A mailbox antiga pode estar a reter o ' +
                'ExchangeGuid ou endereços SMTP.'
            )
    }
    else {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'exo' `
            -Title 'Exchange Online' `
            -Status 'pending' `
            -Detail (
                'Mailbox ativa ainda não localizada no Exchange Online.'
            )

        if ($licensePresent) {
            Add-DiagnosisFinding `
                -List $findings `
                -Severity 'warning' `
                -Title 'Provisionamento online pendente' `
                -Message (
                    'Existe licença atribuída, mas a mailbox ativa ' +
                    'ainda não foi localizada. Pode ser necessário ' +
                    'aguardar o provisionamento.'
                )

            [void]$actions.Add(
                'Aguardar o provisionamento e repetir a verificação.'
            )
        }
    }

    # ExchangeGuid

    $guidStatus = 'GUID não disponível'

    if (
        $localGuidAvailable -and
        $exoGuidAvailable
    ) {
        if ($guidMatch) {
            $guidStatus = 'GUIDs iguais'

            Add-DiagnosisCheck `
                -List $checks `
                -Key 'exchangeGuid' `
                -Title 'ExchangeGuid' `
                -Status 'ok' `
                -Detail (
                    "ExchangeGuid coincidente: $exoGuid"
                )
        }
        else {
            $guidStatus = 'GUIDs divergentes'

            Add-DiagnosisCheck `
                -List $checks `
                -Key 'exchangeGuid' `
                -Title 'ExchangeGuid' `
                -Status 'error' `
                -Detail (
                    "On-premises: $onPremGuid | " +
                    "Exchange Online: $exoGuid"
                )

            Add-DiagnosisFinding `
                -List $findings `
                -Severity 'error' `
                -Title 'ExchangeGuid divergente' `
                -Message (
                    'A divergência pode impedir a associação ' +
                    'correta da mailbox.'
                )

            if ($OnPrem.identity) {
                [void]$commands.Add(
                    "Set-RemoteMailbox " +
                    "-Identity '$($OnPrem.identity)' " +
                    "-ExchangeGuid '$exoGuid'"
                )
            }
        }
    }
    elseif (
        $exoGuidAvailable -and
        -not $localGuidAvailable
    ) {
        $guidStatus = 'GUID local vazio'

        Add-DiagnosisCheck `
            -List $checks `
            -Key 'exchangeGuid' `
            -Title 'ExchangeGuid' `
            -Status 'error' `
            -Detail (
                "A mailbox online possui $exoGuid, mas o objeto " +
                'local não apresenta GUID válido.'
            )

        Add-DiagnosisFinding `
            -List $findings `
            -Severity 'error' `
            -Title 'ExchangeGuid local vazio' `
            -Message (
                'O objeto local não contém o ExchangeGuid da ' +
                'mailbox online.'
            )

        if ($OnPrem.identity) {
            [void]$commands.Add(
                "Set-RemoteMailbox " +
                "-Identity '$($OnPrem.identity)' " +
                "-ExchangeGuid '$exoGuid'"
            )
        }
    }
    elseif (
        $localGuidAvailable -and
        -not $exoGuidAvailable
    ) {
        $guidStatus = 'Mailbox online ausente'

        Add-DiagnosisCheck `
            -List $checks `
            -Key 'exchangeGuid' `
            -Title 'ExchangeGuid' `
            -Status 'pending' `
            -Detail (
                "O objeto local possui $onPremGuid, mas a mailbox " +
                'online ainda não foi localizada.'
            )
    }
    else {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'exchangeGuid' `
            -Title 'ExchangeGuid' `
            -Status 'warning' `
            -Detail (
                'Não foi possível comparar os GUIDs.'
            )
    }

    # ArchiveGuid

    if ($archiveMatch) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'archiveGuid' `
            -Title 'ArchiveGuid' `
            -Status 'ok' `
            -Detail (
                'ArchiveGuid consistente ou ausente nos dois ambientes.'
            )
    }
    else {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'archiveGuid' `
            -Title 'ArchiveGuid' `
            -Status 'warning' `
            -Detail (
                "On-premises: $($OnPrem.archiveGuid) | " +
                "Exchange Online: $($Exo.archiveGuid)"
            )

        Add-DiagnosisFinding `
            -List $findings `
            -Severity 'warning' `
            -Title 'ArchiveGuid divergente' `
            -Message (
                'O GUID do arquivo online não coincide entre ' +
                'os ambientes.'
            )
    }

    # UPN

    if ($upnMatch) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'upn' `
            -Title 'UPN' `
            -Status 'ok' `
            -Detail (
                'UPN igual no AD local e Entra ID.'
            )
    }
    else {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'upn' `
            -Title 'UPN' `
            -Status 'warning' `
            -Detail (
                "AD: $($Ad.userPrincipalName) | " +
                "Entra: $($Entra.userPrincipalName)"
            )
    }

    # SMTP

    if ($smtpMatch) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'smtp' `
            -Title 'Primary SMTP' `
            -Status 'ok' `
            -Detail (
                'Primary SMTP igual no Exchange on-premises ' +
                'e Exchange Online.'
            )
    }
    else {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'smtp' `
            -Title 'Primary SMTP' `
            -Status 'warning' `
            -Detail (
                "On-premises: $($OnPrem.primarySmtpAddress) | " +
                "Online: $($Exo.primarySmtpAddress)"
            )
    }

    # Remote routing

    if ($routingOk) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'routing' `
            -Title 'Remote routing address' `
            -Status 'ok' `
            -Detail (
                "Roteamento híbrido encontrado: $routingAddress"
            )
    }
    else {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'routing' `
            -Title 'Remote routing address' `
            -Status 'warning' `
            -Detail (
                'targetAddress ou RemoteRoutingAddress ' +
                'não foi localizado.'
            )

        Add-DiagnosisFinding `
            -List $findings `
            -Severity 'warning' `
            -Title 'RemoteRoutingAddress ausente' `
            -Message (
                'O objeto não apresenta endereço de ' +
                'roteamento híbrido.'
            )
    }

    # ImmutableId

    if ($immutableMatch) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'immutableId' `
            -Title 'ImmutableId' `
            -Status 'ok' `
            -Detail (
                'ImmutableId corresponde ao valor esperado ' +
                'do AD local.'
            )
    }
    elseif (
        $Ad.expectedImmutableId -and
        $Entra.onPremisesImmutableId
    ) {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'immutableId' `
            -Title 'ImmutableId' `
            -Status 'error' `
            -Detail (
                'O ImmutableId do Entra não corresponde ao ' +
                'valor esperado do AD.'
            )

        Add-DiagnosisFinding `
            -List $findings `
            -Severity 'error' `
            -Title 'ImmutableId divergente' `
            -Message (
                'O objeto cloud pode estar associado a outro ' +
                'objeto do Active Directory.'
            )
    }
    else {
        Add-DiagnosisCheck `
            -List $checks `
            -Key 'immutableId' `
            -Title 'ImmutableId' `
            -Status 'warning' `
            -Detail (
                'Não foi possível comparar o ImmutableId.'
            )
    }

    # Estados da tabela

    $upnStatus = 'AVISO'

    if ($upnMatch) {
        $upnStatus = 'OK'
    }

    $guidRowStatus = 'AVISO'

    if ($guidMatch) {
        $guidRowStatus = 'OK'
    }
    elseif (
        $guidStatus -match 'divergentes' -or
        $guidStatus -match 'vazio'
    ) {
        $guidRowStatus = 'ERRO'
    }

    $archiveStatus = 'AVISO'

    if ($archiveMatch) {
        $archiveStatus = 'OK'
    }

    $recipientStatus = 'AVISO'

    if ($doubleMailboxCritical) {
        $recipientStatus = 'ERRO'
    }
    elseif (
        $onPremFound -and
        $exoFound
    ) {
        $recipientStatus = 'OK'
    }

    $routingStatus = 'AVISO'

    if ($routingOk) {
        $routingStatus = 'OK'
    }

    $immutableStatus = 'AVISO'

    if ($immutableMatch) {
        $immutableStatus = 'OK'
    }
    elseif (
        $Ad.expectedImmutableId -and
        $Entra.onPremisesImmutableId
    ) {
        $immutableStatus = 'ERRO'
    }

    [void]$comparison.Add(
        (
            New-ComparisonRow `
                -Attribute 'UPN' `
                -Ad $Ad.userPrincipalName `
                -OnPrem $OnPrem.primarySmtpAddress `
                -Entra $Entra.userPrincipalName `
                -Exo $Exo.primarySmtpAddress `
                -Status $upnStatus
        )
    )

    [void]$comparison.Add(
        (
            New-ComparisonRow `
                -Attribute 'ExchangeGuid' `
                -Ad $adGuid `
                -OnPrem $onPremGuid `
                -Entra '—' `
                -Exo $exoGuid `
                -Status $guidRowStatus
        )
    )

    [void]$comparison.Add(
        (
            New-ComparisonRow `
                -Attribute 'ArchiveGuid' `
                -Ad $Ad.archiveGuid `
                -OnPrem $OnPrem.archiveGuid `
                -Entra '—' `
                -Exo $Exo.archiveGuid `
                -Status $archiveStatus
        )
    )

    [void]$comparison.Add(
        (
            New-ComparisonRow `
                -Attribute 'RecipientTypeDetails' `
                -Ad $Ad.recipientTypeDetails `
                -OnPrem $OnPrem.recipientTypeDetails `
                -Entra '—' `
                -Exo $Exo.recipientTypeDetails `
                -Status $recipientStatus
        )
    )

    [void]$comparison.Add(
        (
            New-ComparisonRow `
                -Attribute 'RemoteRoutingAddress' `
                -Ad $Ad.targetAddress `
                -OnPrem $OnPrem.remoteRoutingAddress `
                -Entra '—' `
                -Exo $Exo.externalEmailAddress `
                -Status $routingStatus
        )
    )

    [void]$comparison.Add(
        (
            New-ComparisonRow `
                -Attribute 'ImmutableId' `
                -Ad $Ad.expectedImmutableId `
                -OnPrem '—' `
                -Entra $Entra.onPremisesImmutableId `
                -Exo '—' `
                -Status $immutableStatus
        )
    )

    $errorCount = @(
        $checks |
        Where-Object status -eq 'error'
    ).Count

    $warningCount = @(
        $checks |
        Where-Object status -eq 'warning'
    ).Count

    $pendingCount = @(
        $checks |
        Where-Object status -eq 'pending'
    ).Count

    $classification = 'AMBIENTE HÍBRIDO CONSISTENTE'
    $status = 'Sem inconsistências críticas'

    if ($doubleMailboxCritical) {
        $classification = 'POSSÍVEL DUPLA MAILBOX'
        $status = 'Com erro'
    }
    elseif ($guidStatus -eq 'GUIDs divergentes') {
        $classification = 'EXCHANGEGUID DIVERGENTE'
        $status = 'Com erro'
    }
    elseif ($guidStatus -eq 'GUID local vazio') {
        $classification = 'EXCHANGEGUID LOCAL AUSENTE'
        $status = 'Com erro'
    }
    elseif (
        -not $entraFound -or
        -not $syncEnabled
    ) {
        $classification = 'PROBLEMA DE SINCRONIZAÇÃO ENTRA'
        $status = 'Com erro'
    }
    elseif ($exoSoft) {
        $classification = 'MAILBOX SOFT-DELETED'
        $status = 'Com erro'
    }
    elseif (
        -not $exoActive -and
        $licensePresent
    ) {
        $classification = 'PROVISIONAMENTO ONLINE PENDENTE'
        $status = 'Pendente'
    }
    elseif ($errorCount -gt 0) {
        $classification = 'OBJETO HÍBRIDO COM ERROS'
        $status = 'Com erro'
    }
    elseif ($warningCount -gt 0) {
        $classification = (
            'AMBIENTE HÍBRIDO CONSISTENTE COM AVISOS'
        )
        $status = 'Com avisos'
    }

    if (
        $actions.Count -eq 0 -and
        $errorCount -eq 0
    ) {
        [void]$actions.Add(
            'Nenhuma correção técnica necessária neste momento.'
        )
    }

    if (
        $commands.Count -eq 0 -and
        $errorCount -eq 0
    ) {
        [void]$commands.Add(
            '# Nenhum comando de correção recomendado.'
        )
    }

    $summary = (
        "$classification. " +
        "Erros: $errorCount | " +
        "Avisos: $warningCount | " +
        "Pendentes: $pendingCount."
    )

    [pscustomobject]@{
        diagnosis = [pscustomobject]@{
            status = $status
            classification = $classification
            guidStatus = $guidStatus
            summary = $summary
            errorCount = $errorCount
            warningCount = $warningCount
            pendingCount = $pendingCount
            findings = $findings.ToArray()
            checks = $checks.ToArray()
            recommendedActions = $actions.ToArray()
            recommendedCommands = $commands.ToArray()
        }

        comparison = $comparison.ToArray()
    }
}
try {
    $payload = Get-RequestPayload
    $actionName = if ($action) { [string]$action } elseif ($Query.action) { [string]$Query.action } else { '' }

    switch ($actionName.ToLowerInvariant()) {
        'status' {
            Write-JsonResponse ([pscustomobject]@{
                success = $true
                connections = Get-ConnectionStatus
            })
            break
        }
        'diagnose' {
            $identity = [string]$payload.identity
            if ([string]::IsNullOrWhiteSpace($identity)) {
                Write-JsonResponse ([pscustomobject]@{success=$false;message='Utilizador não informado.'}) 400
                break
            }

            $ad = Find-AdUserHybrid -Identity $identity
            $resolvedIdentity = if ($ad.found -and $ad.userPrincipalName) { $ad.userPrincipalName } else { $identity }

            $onPrem = Find-ExchangeOnPremRecipient -Identity $resolvedIdentity
            if (-not $onPrem.found -and $ad.found -and $ad.samAccountName) {
                $onPrem = Find-ExchangeOnPremRecipient -Identity $ad.samAccountName
            }

            $entra = Find-EntraUserHybrid -Identity $resolvedIdentity
            $exo = Find-ExchangeOnlineHybrid -Identity $resolvedIdentity
            $built = Build-Diagnosis -Identity $identity -Ad $ad -OnPrem $onPrem -Entra $entra -Exo $exo

            Write-JsonResponse ([pscustomobject]@{
                success = $true
                identity = $identity
                generatedAt = (Get-Date).ToString('dd/MM/yyyy HH:mm:ss')
                mode = 'read-only'
                ad = $ad
                exchangeOnPrem = $onPrem
                entra = $entra
                exchangeOnline = $exo
                diagnosis = $built.diagnosis
                comparison = $built.comparison
            })
            break
        }
        default {
            Write-JsonResponse ([pscustomobject]@{success=$false;message='Action não informado ou inválido.'}) 400
        }
    }
} catch {
    Write-JsonResponse ([pscustomobject]@{
        success = $false
        message = $_.Exception.Message
        detail = $_.ScriptStackTrace
    }) 500
}
