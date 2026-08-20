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

function Build-Diagnosis {
    param($Identity,$Ad,$OnPrem,$Entra,$Exo)

    $findings = New-Object System.Collections.Generic.List[object]
    $commands = New-Object System.Collections.Generic.List[string]
    $comparison = New-Object System.Collections.Generic.List[object]

    $adGuid = [string]$Ad.exchangeGuid
    $onPremGuid = [string]$OnPrem.exchangeGuid
    $exoGuid = [string]$Exo.exchangeGuid
    $guidStatus = 'Não determinado'

    if (-not $Ad.found) {
        $findings.Add([pscustomobject]@{severity='error';title='Utilizador não encontrado no AD local';message='O diagnóstico híbrido não pode ser concluído sem localizar o objeto de origem no Active Directory.'})
    } elseif (-not $Ad.enabled) {
        $findings.Add([pscustomobject]@{severity='warning';title='Conta AD desativada';message='O objeto foi localizado, mas a conta continua desativada no Active Directory.'})
    }

    if ($Ad.found -and -not $OnPrem.found) {
        $findings.Add([pscustomobject]@{severity='error';title='Recipient Exchange local ausente';message='O utilizador existe no AD, mas não foi encontrado como Recipient, RemoteMailbox, MailUser ou Mailbox no Exchange on-premises.'})
        if ($Ad.userPrincipalName) {
            $alias = (($Ad.userPrincipalName -split '@')[0] -replace '[^a-zA-Z0-9._-]','')
            $commands.Add("Enable-RemoteMailbox -Identity '$($Ad.distinguishedName)' -Alias '$alias' -RemoteRoutingAddress '$alias@SEU_TENANT.mail.onmicrosoft.com'")
        }
    }

    if ($OnPrem.found -and $OnPrem.hasLocalMailbox) {
        $findings.Add([pscustomobject]@{severity='error';title='Mailbox local encontrada';message='Existe uma mailbox no Exchange on-premises. Verifique se também existe uma mailbox no Exchange Online, pois isso pode representar cenário de dupla mailbox.'})
    }

    if ($OnPrem.found -and -not $OnPrem.hasRemoteMailbox -and -not $OnPrem.hasLocalMailbox) {
        $findings.Add([pscustomobject]@{severity='warning';title='Objeto não é RemoteMailbox';message="O recipient local está classificado como $($OnPrem.recipientTypeDetails). Para uma mailbox alojada no Exchange Online, normalmente deve existir um RemoteMailbox válido."})
    }

    if ($Ad.found -and $Entra.found) {
        if ($Entra.onPremisesSyncEnabled -ne $true) {
            $findings.Add([pscustomobject]@{severity='error';title='Objeto Entra não marcado como sincronizado';message='OnPremisesSyncEnabled não está como verdadeiro. O objeto pode ser cloud-only ou não estar corretamente associado ao AD local.'})
        }
        if ($Ad.expectedImmutableId -and $Entra.onPremisesImmutableId -and $Ad.expectedImmutableId -ne $Entra.onPremisesImmutableId) {
            $findings.Add([pscustomobject]@{severity='error';title='ImmutableId divergente';message='O ImmutableId no Entra ID não corresponde ao valor esperado a partir do ms-DS-ConsistencyGuid/ObjectGUID do AD local.'})
        }
        if (@($Entra.provisioningErrors).Count -gt 0) {
            $findings.Add([pscustomobject]@{severity='error';title='Erros de provisionamento no Entra ID';message="Foram encontrados $(@($Entra.provisioningErrors).Count) erros de provisionamento associados ao objeto."})
        }
    } elseif ($Ad.found -and -not $Entra.found) {
        $findings.Add([pscustomobject]@{severity='error';title='Utilizador ausente no Entra ID';message='O objeto existe no AD local, mas não foi localizado no Entra ID. Verifique o escopo e os erros do Entra Connect.'})
    }

    if (-not (Test-GuidEmpty $exoGuid) -and -not (Test-GuidEmpty $onPremGuid)) {
        if ($exoGuid -ieq $onPremGuid) {
            $guidStatus = 'GUIDs iguais'
        } else {
            $guidStatus = 'GUIDs divergentes'
            $findings.Add([pscustomobject]@{severity='error';title='ExchangeGuid divergente';message="Exchange on-premises: $onPremGuid | Exchange Online: $exoGuid. Essa divergência pode impedir a associação correta da mailbox."})
            if ($OnPrem.identity) {
                $commands.Add("Set-RemoteMailbox -Identity '$($OnPrem.identity)' -ExchangeGuid '$exoGuid'")
            }
        }
    } elseif (-not (Test-GuidEmpty $exoGuid) -and (Test-GuidEmpty $onPremGuid)) {
        $guidStatus = 'GUID local vazio'
        $findings.Add([pscustomobject]@{severity='error';title='ExchangeGuid local vazio';message="A mailbox do Exchange Online possui o GUID $exoGuid, mas o RemoteMailbox local não apresenta um ExchangeGuid válido."})
        if ($OnPrem.identity) {
            $commands.Add("Set-RemoteMailbox -Identity '$($OnPrem.identity)' -ExchangeGuid '$exoGuid'")
        }
    } elseif ((Test-GuidEmpty $exoGuid) -and -not (Test-GuidEmpty $onPremGuid)) {
        $guidStatus = 'Mailbox online ausente'
        $findings.Add([pscustomobject]@{severity='warning';title='ExchangeGuid apenas no ambiente local';message='Existe ExchangeGuid no objeto local, mas nenhuma mailbox ativa com GUID foi localizada no Exchange Online.'})
    } else {
        $guidStatus = 'GUID não disponível'
    }

    if ($Exo.found -and $Exo.isSoftDeleted) {
        $findings.Add([pscustomobject]@{severity='error';title='Mailbox soft-deleted encontrada';message='Foi localizada uma mailbox soft-deleted. Ela pode estar a reter o ExchangeGuid ou endereços SMTP do utilizador reativado.'})
    }

    if ($Entra.found -and $Entra.assignedLicenseCount -eq 0) {
        $findings.Add([pscustomobject]@{severity='warning';title='Sem licenças atribuídas';message='O utilizador não possui licenças atribuídas no Entra ID. Confirme se deve receber uma licença com Exchange Online.'})
    }

    # PowerShell 5.1:
    # os estados são calculados antes de chamar New-ComparisonRow.
    # Não utilizar "if" diretamente como argumento de um comando.

    $upnStatus = 'AVISO'

    if (
        $Ad.userPrincipalName -and
        $Entra.userPrincipalName -and
        $Ad.userPrincipalName -ieq $Entra.userPrincipalName
    ) {
        $upnStatus = 'OK'
    }

    $exchangeGuidStatus = 'AVISO'

    if ($guidStatus -eq 'GUIDs iguais') {
        $exchangeGuidStatus = 'OK'
    }
    elseif (
        $guidStatus -match 'divergentes' -or
        $guidStatus -match 'vazio'
    ) {
        $exchangeGuidStatus = 'ERRO'
    }

    $archiveGuidStatus = 'AVISO'

    if (
        $OnPrem.archiveGuid -and
        $Exo.archiveGuid -and
        ([string]$OnPrem.archiveGuid -ieq [string]$Exo.archiveGuid)
    ) {
        $archiveGuidStatus = 'OK'
    }
    elseif (
        -not $OnPrem.archiveGuid -and
        -not $Exo.archiveGuid
    ) {
        $archiveGuidStatus = 'OK'
    }

    $recipientTypeStatus = 'AVISO'

    if ($OnPrem.hasRemoteMailbox) {
        $recipientTypeStatus = 'OK'
    }

    $routingStatus = 'AVISO'

    if (
        $Ad.targetAddress -or
        $OnPrem.remoteRoutingAddress
    ) {
        $routingStatus = 'OK'
    }

    $immutableIdStatus = 'AVISO'

    if (
        $Ad.expectedImmutableId -and
        $Entra.onPremisesImmutableId -and
        ([string]$Ad.expectedImmutableId -eq
         [string]$Entra.onPremisesImmutableId)
    ) {
        $immutableIdStatus = 'OK'
    }

    $comparison.Add(
        (New-ComparisonRow `
            -Attribute 'UPN' `
            -Ad $Ad.userPrincipalName `
            -OnPrem $OnPrem.primarySmtpAddress `
            -Entra $Entra.userPrincipalName `
            -Exo $Exo.primarySmtpAddress `
            -Status $upnStatus)
    )

    $comparison.Add(
        (New-ComparisonRow `
            -Attribute 'ExchangeGuid' `
            -Ad $adGuid `
            -OnPrem $onPremGuid `
            -Entra '—' `
            -Exo $exoGuid `
            -Status $exchangeGuidStatus)
    )

    $comparison.Add(
        (New-ComparisonRow `
            -Attribute 'ArchiveGuid' `
            -Ad $Ad.archiveGuid `
            -OnPrem $OnPrem.archiveGuid `
            -Entra '—' `
            -Exo $Exo.archiveGuid `
            -Status $archiveGuidStatus)
    )

    $comparison.Add(
        (New-ComparisonRow `
            -Attribute 'RecipientTypeDetails' `
            -Ad $Ad.recipientTypeDetails `
            -OnPrem $OnPrem.recipientTypeDetails `
            -Entra '—' `
            -Exo $Exo.recipientTypeDetails `
            -Status $recipientTypeStatus)
    )

    $comparison.Add(
        (New-ComparisonRow `
            -Attribute 'RemoteRoutingAddress' `
            -Ad $Ad.targetAddress `
            -OnPrem $OnPrem.remoteRoutingAddress `
            -Entra '—' `
            -Exo $Exo.externalEmailAddress `
            -Status $routingStatus)
    )

    $comparison.Add(
        (New-ComparisonRow `
            -Attribute 'ImmutableId' `
            -Ad $Ad.expectedImmutableId `
            -OnPrem '—' `
            -Entra $Entra.onPremisesImmutableId `
            -Exo '—' `
            -Status $immutableIdStatus)
    )
    $errors = @($findings | Where-Object severity -eq 'error').Count
    $warnings = @($findings | Where-Object severity -eq 'warning').Count
    $status = if ($errors -gt 0) { 'Com erro' } elseif ($warnings -gt 0) { 'Com avisos' } else { 'Sem inconsistências críticas' }
    $summary = if ($errors -gt 0) {
        "Foram identificados $errors problema(s) crítico(s) e $warnings aviso(s). Analise as constatações antes de aplicar qualquer correção."
    } elseif ($warnings -gt 0) {
        "Não foram encontrados erros críticos, mas existem $warnings aviso(s) que devem ser validados."
    } else {
        'Os principais atributos híbridos consultados estão coerentes.'
    }

    [pscustomobject]@{
        diagnosis = [pscustomobject]@{
            status = $status
            guidStatus = $guidStatus
            summary = $summary
            findings = $findings.ToArray()
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
