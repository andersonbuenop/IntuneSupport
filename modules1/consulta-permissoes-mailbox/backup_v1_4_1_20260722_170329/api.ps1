param(
    $Query = $null,
    $Config = $null,
    $Body = $null,
    [string]$action = "",
    [string]$payload = "",
    [string]$debug = ""
)

$ErrorActionPreference = "Stop"

$Logs = New-Object System.Collections.Generic.List[string]
$RecipientCache = @{}

function Add-Log {
    param([string]$Message)

    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    $Logs.Add($line) | Out-Null
}

function New-JsonResponse {
    param(
        [bool]$Success,
        [string]$Message,
        $Data = $null,
        [string]$ErrorMessage = ""
    )

    $response = [ordered]@{
        success = $Success
        message = $Message
    }

    if (-not [string]::IsNullOrWhiteSpace($ErrorMessage)) {
        $response.error = $ErrorMessage
    }

    if ($null -ne $Data) {
        foreach ($key in $Data.Keys) {
            $response[$key] = $Data[$key]
        }
    }

    $response | ConvertTo-Json -Depth 40
}

function Get-RequestObject {
    if ($null -ne $Body) {
        if ($Body -is [string]) {
            if (-not [string]::IsNullOrWhiteSpace($Body)) {
                try {
                    return $Body | ConvertFrom-Json
                }
                catch {
                    Add-Log "Body recebido como texto, mas não foi possível converter JSON."
                }
            }
        }
        else {
            return $Body
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($payload)) {
        try {
            return $payload | ConvertFrom-Json
        }
        catch {
            Add-Log "Payload recebido, mas não foi possível converter JSON."
        }
    }

    foreach ($scopeName in @("Script", "Global")) {
        foreach ($variableName in @(
            "ModuleApiBody",
            "RequestBody",
            "requestBody",
            "JsonBody",
            "json",
            "payload",
            "body"
        )) {
            try {
                $variable = Get-Variable -Name $variableName -Scope $scopeName -ErrorAction SilentlyContinue

                if ($variable -and $null -ne $variable.Value) {
                    if ($variable.Value -is [string]) {
                        if (-not [string]::IsNullOrWhiteSpace([string]$variable.Value)) {
                            try {
                                return ([string]$variable.Value) | ConvertFrom-Json
                            }
                            catch {}
                        }
                    }
                    else {
                        return $variable.Value
                    }
                }
            }
            catch {}
        }
    }

    return $null
}

function Get-QueryValue {
    param([string]$Name)

    if ($null -eq $Query) {
        return ""
    }

    try {
        $value = $Query[$Name]
        if ($null -ne $value) {
            return [string]$value
        }
    }
    catch {}

    try {
        $property = $Query.PSObject.Properties[$Name]
        if ($property) {
            return [string]$property.Value
        }
    }
    catch {}

    return ""
}

function Test-ExchangeSession {
    try {
        Import-Module ExchangeOnlineManagement -ErrorAction Stop
    }
    catch {
        Add-Log "Falha ao carregar ExchangeOnlineManagement: $($_.Exception.Message)"
        return @{
            connected = $false
            account = ""
        }
    }

    try {
        if (Get-Command Get-ConnectionInformation -ErrorAction SilentlyContinue) {
            $connection = Get-ConnectionInformation -ErrorAction SilentlyContinue |
                Where-Object { $_.State -eq "Connected" -or [string]::IsNullOrWhiteSpace([string]$_.State) } |
                Select-Object -First 1

            if ($connection) {
                return @{
                    connected = $true
                    account = [string]$connection.UserPrincipalName
                }
            }
        }
    }
    catch {}

    try {
        if (Get-Command Get-EXORecipient -ErrorAction SilentlyContinue) {
            $null = Get-EXORecipient -ResultSize 1 -Properties DisplayName -ErrorAction Stop
            return @{
                connected = $true
                account = ""
            }
        }
    }
    catch {}

    return @{
        connected = $false
        account = ""
    }
}

function Get-RecipientClassification {
    param([string]$RecipientTypeDetails)

    $type = if ([string]::IsNullOrWhiteSpace($RecipientTypeDetails)) {
        "Unknown"
    }
    else {
        $RecipientTypeDetails.Trim()
    }

    $result = [ordered]@{
        classificationLabel = "Outro destinatário Exchange"
        classificationCode = "other"
        supportsFullAccess = $false
        supportsSendAs = $true
    }

    switch ($type) {
        "SharedMailbox" {
            $result.classificationLabel = "Shared Mailbox"
            $result.classificationCode = "shared-mailbox"
            $result.supportsFullAccess = $true
        }
        "RemoteSharedMailbox" {
            $result.classificationLabel = "Shared Mailbox"
            $result.classificationCode = "shared-mailbox"
            $result.supportsFullAccess = $true
        }
        "UserMailbox" {
            $result.classificationLabel = "User Mailbox"
            $result.classificationCode = "user-mailbox"
            $result.supportsFullAccess = $true
        }
        "RemoteUserMailbox" {
            $result.classificationLabel = "User Mailbox"
            $result.classificationCode = "user-mailbox"
            $result.supportsFullAccess = $true
        }
        "MailUniversalDistributionGroup" {
            $result.classificationLabel = "LD (Lista de Distribuição)"
            $result.classificationCode = "distribution-list"
        }
        "UniversalDistributionGroup" {
            $result.classificationLabel = "LD (Lista de Distribuição)"
            $result.classificationCode = "distribution-list"
        }
        "MailUniversalSecurityGroup" {
            $result.classificationLabel = "LD de Segurança"
            $result.classificationCode = "distribution-list"
        }
        "UniversalSecurityGroup" {
            $result.classificationLabel = "LD de Segurança"
            $result.classificationCode = "distribution-list"
        }
        "DynamicDistributionGroup" {
            $result.classificationLabel = "LD Dinâmica"
            $result.classificationCode = "distribution-list"
        }
        "GroupMailbox" {
            $result.classificationLabel = "Grupo Microsoft 365"
            $result.classificationCode = "m365-group"
        }
        "RoomMailbox" {
            $result.classificationLabel = "Mailbox de Sala"
            $result.classificationCode = "resource-mailbox"
            $result.supportsFullAccess = $true
        }
        "RemoteRoomMailbox" {
            $result.classificationLabel = "Mailbox de Sala"
            $result.classificationCode = "resource-mailbox"
            $result.supportsFullAccess = $true
        }
        "EquipmentMailbox" {
            $result.classificationLabel = "Mailbox de Equipamento"
            $result.classificationCode = "resource-mailbox"
            $result.supportsFullAccess = $true
        }
        "RemoteEquipmentMailbox" {
            $result.classificationLabel = "Mailbox de Equipamento"
            $result.classificationCode = "resource-mailbox"
            $result.supportsFullAccess = $true
        }
        "MailUser" {
            $result.classificationLabel = "Mail User"
            $result.classificationCode = "mail-user"
        }
        "MailContact" {
            $result.classificationLabel = "Contacto de Correio"
            $result.classificationCode = "mail-contact"
        }
        default {
            if ($type -match "SharedMailbox") {
                $result.classificationLabel = "Shared Mailbox"
                $result.classificationCode = "shared-mailbox"
                $result.supportsFullAccess = $true
            }
            elseif ($type -match "UserMailbox") {
                $result.classificationLabel = "User Mailbox"
                $result.classificationCode = "user-mailbox"
                $result.supportsFullAccess = $true
            }
            elseif ($type -match "DistributionGroup") {
                $result.classificationLabel = "LD (Lista de Distribuição)"
                $result.classificationCode = "distribution-list"
            }
            elseif ($type -match "Mailbox") {
                $result.classificationLabel = "Mailbox Exchange"
                $result.classificationCode = "other"
                $result.supportsFullAccess = $true
            }
        }
    }

    return $result
}


function ConvertTo-RecipientSearchItem {
    param($Recipient)

    $recipientTypeDetails = [string]$Recipient.RecipientTypeDetails
    $classification = Get-RecipientClassification -RecipientTypeDetails $recipientTypeDetails

    return [pscustomobject][ordered]@{
        identity = [string]$Recipient.Identity
        displayName = [string]$Recipient.DisplayName
        primarySmtpAddress = [string]$Recipient.PrimarySmtpAddress
        alias = [string]$Recipient.Alias
        recipientTypeDetails = $recipientTypeDetails
        externalDirectoryObjectId = [string]$Recipient.ExternalDirectoryObjectId
        classificationLabel = [string]$classification.classificationLabel
        classificationCode = [string]$classification.classificationCode
        supportsFullAccess = [bool]$classification.supportsFullAccess
        supportsSendAs = [bool]$classification.supportsSendAs
    }
}

function Get-RecipientMatchRank {
    param(
        $Recipient,
        [string]$SearchText
    )

    $search = $SearchText.Trim().ToLowerInvariant()
    $displayName = ([string]$Recipient.DisplayName).ToLowerInvariant()
    $alias = ([string]$Recipient.Alias).ToLowerInvariant()
    $smtp = ([string]$Recipient.PrimarySmtpAddress).ToLowerInvariant()

    if ($smtp -eq $search) {
        return 0
    }

    if ($alias -eq $search) {
        return 1
    }

    if ($displayName -eq $search) {
        return 2
    }

    if ($alias.StartsWith($search)) {
        return 3
    }

    if ($displayName.StartsWith($search)) {
        return 4
    }

    if ($smtp.StartsWith($search)) {
        return 5
    }

    if ($alias.Contains($search)) {
        return 6
    }

    if ($displayName.Contains($search)) {
        return 7
    }

    if ($smtp.Contains($search)) {
        return 8
    }

    return 99
}

function Search-ExchangeRecipients {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SearchText,

        [int]$MaximumResults = 50
    )

    $search = $SearchText.Trim()

    if ([string]::IsNullOrWhiteSpace($search)) {
        return @()
    }

    Add-Log "A pesquisar destinatários por nome, alias ou endereço: $search"

    $found = New-Object System.Collections.Generic.List[object]

    if (Get-Command Get-EXORecipient -ErrorAction SilentlyContinue) {
        if ($search -match "@") {
            try {
                $exact = @(
                    Get-EXORecipient `
                        -Identity $search `
                        -Properties DisplayName,Alias,PrimarySmtpAddress,RecipientTypeDetails,ExternalDirectoryObjectId `
                        -ErrorAction Stop
                )

                foreach ($item in $exact) {
                    $found.Add($item) | Out-Null
                }
            }
            catch {
                Add-Log "Pesquisa exata sem resultado único: $($_.Exception.Message)"
            }
        }

        try {
            $anrResults = @(
                Get-EXORecipient `
                    -Anr $search `
                    -ResultSize $MaximumResults `
                    -Properties DisplayName,Alias,PrimarySmtpAddress,RecipientTypeDetails,ExternalDirectoryObjectId `
                    -ErrorAction Stop
            )

            foreach ($item in $anrResults) {
                $found.Add($item) | Out-Null
            }

            Add-Log "Pesquisa ANR devolveu $($anrResults.Count) resultado(s)."
        }
        catch {
            Add-Log "Pesquisa ANR falhou: $($_.Exception.Message)"
        }

        try {
            $safeSearch = $search.Replace("'", "''")
            $filter = "DisplayName -like '*$safeSearch*' -or Alias -like '*$safeSearch*' -or PrimarySmtpAddress -like '*$safeSearch*'"

            $filterResults = @(
                Get-EXORecipient `
                    -Filter $filter `
                    -ResultSize $MaximumResults `
                    -Properties DisplayName,Alias,PrimarySmtpAddress,RecipientTypeDetails,ExternalDirectoryObjectId `
                    -ErrorAction Stop
            )

            foreach ($item in $filterResults) {
                $found.Add($item) | Out-Null
            }

            Add-Log "Pesquisa por filtro devolveu $($filterResults.Count) resultado(s)."
        }
        catch {
            Add-Log "Pesquisa complementar por filtro falhou: $($_.Exception.Message)"
        }
    }
    elseif (Get-Command Get-Recipient -ErrorAction SilentlyContinue) {
        try {
            $legacyResults = @(
                Get-Recipient `
                    -Anr $search `
                    -ResultSize $MaximumResults `
                    -ErrorAction Stop
            )

            foreach ($item in $legacyResults) {
                $found.Add($item) | Out-Null
            }

            Add-Log "Pesquisa Get-Recipient devolveu $($legacyResults.Count) resultado(s)."
        }
        catch {
            Add-Log "Pesquisa Get-Recipient falhou: $($_.Exception.Message)"
        }
    }

    $unique = @{}

    foreach ($recipient in $found.ToArray()) {
        $key = [string]$recipient.ExternalDirectoryObjectId

        if ([string]::IsNullOrWhiteSpace($key)) {
            $key = [string]$recipient.PrimarySmtpAddress
        }

        if ([string]::IsNullOrWhiteSpace($key)) {
            $key = [string]$recipient.Identity
        }

        if ([string]::IsNullOrWhiteSpace($key)) {
            continue
        }

        $normalizedKey = $key.Trim().ToLowerInvariant()

        if (-not $unique.ContainsKey($normalizedKey)) {
            $unique[$normalizedKey] = $recipient
        }
    }

    $ranked = @(
        $unique.Values |
            ForEach-Object {
                [pscustomobject]@{
                    Rank = Get-RecipientMatchRank -Recipient $_ -SearchText $search
                    Recipient = $_
                }
            } |
            Sort-Object Rank, @{ Expression = { [string]$_.Recipient.DisplayName } } |
            Select-Object -First $MaximumResults
    )

    $items = New-Object System.Collections.Generic.List[object]

    foreach ($rankedItem in $ranked) {
        $items.Add(
            (ConvertTo-RecipientSearchItem -Recipient $rankedItem.Recipient)
        ) | Out-Null
    }

    Add-Log "Pesquisa consolidada: $($items.Count) objeto(s) único(s)."

    return $items.ToArray()
}

function Get-MailboxInfo {
    param([string]$Identity)

    $recipient = $null

    if (Get-Command Get-EXORecipient -ErrorAction SilentlyContinue) {
        try {
            $recipient = Get-EXORecipient `
                -Identity $Identity `
                -Properties DisplayName,Alias,PrimarySmtpAddress,RecipientTypeDetails,ExternalDirectoryObjectId `
                -ErrorAction Stop
        }
        catch {
            Add-Log "Get-EXORecipient não encontrou o destinatário: $($_.Exception.Message)"
        }
    }

    if (-not $recipient -and (Get-Command Get-Recipient -ErrorAction SilentlyContinue)) {
        try {
            $recipient = Get-Recipient -Identity $Identity -ErrorAction Stop
        }
        catch {
            Add-Log "Get-Recipient não encontrou o destinatário: $($_.Exception.Message)"
        }
    }

    $recipientItems = @($recipient)

    if ($recipientItems.Count -eq 0) {
        throw "Mailbox, LD ou destinatário não encontrado no Exchange Online: $Identity"
    }

    if ($recipientItems.Count -gt 1) {
        throw "A identificação '$Identity' corresponde a mais de um objeto. Faça uma pesquisa e selecione o destinatário correto."
    }

    $recipient = $recipientItems[0]
    $recipientTypeDetails = [string]$recipient.RecipientTypeDetails
    $classification = Get-RecipientClassification -RecipientTypeDetails $recipientTypeDetails

    Add-Log "Tipo identificado: $($classification.classificationLabel) [$recipientTypeDetails]"

    return [ordered]@{
        identity = [string]$Identity
        displayName = [string]$recipient.DisplayName
        primarySmtpAddress = [string]$recipient.PrimarySmtpAddress
        alias = [string]$recipient.Alias
        recipientTypeDetails = $recipientTypeDetails
        externalDirectoryObjectId = [string]$recipient.ExternalDirectoryObjectId
        classificationLabel = [string]$classification.classificationLabel
        classificationCode = [string]$classification.classificationCode
        supportsFullAccess = [bool]$classification.supportsFullAccess
        supportsSendAs = [bool]$classification.supportsSendAs
    }
}

function Resolve-Trustee {
    param([string]$Trustee)

    $key = $Trustee.ToLowerInvariant()

    if ($RecipientCache.ContainsKey($key)) {
        return $RecipientCache[$key]
    }

    $result = [ordered]@{
        displayName = ""
        email = ""
        objectType = ""
    }

    if ([string]::IsNullOrWhiteSpace($Trustee)) {
        $RecipientCache[$key] = $result
        return $result
    }

    $recipient = $null

    if (Get-Command Get-EXORecipient -ErrorAction SilentlyContinue) {
        try {
            $recipient = Get-EXORecipient `
                -Identity $Trustee `
                -Properties DisplayName,PrimarySmtpAddress,RecipientTypeDetails `
                -ErrorAction Stop
        }
        catch {}
    }

    if (-not $recipient -and (Get-Command Get-Recipient -ErrorAction SilentlyContinue)) {
        try {
            $recipient = Get-Recipient -Identity $Trustee -ErrorAction Stop
        }
        catch {}
    }

    if ($recipient) {
        $result.displayName = [string]$recipient.DisplayName
        $result.email = [string]$recipient.PrimarySmtpAddress
        $result.objectType = [string]$recipient.RecipientTypeDetails
    }
    else {
        if ($Trustee -match "@") {
            $result.email = $Trustee
        }

        $result.displayName = $Trustee
        $result.objectType = "Não resolvido"
    }

    $RecipientCache[$key] = $result
    return $result
}

function Test-IsSystemTrustee {
    param([string]$Trustee)

    if ([string]::IsNullOrWhiteSpace($Trustee)) {
        return $true
    }

    $normalized = $Trustee.Trim().ToUpperInvariant()

    if ($normalized -match "^NT AUTHORITY\\") {
        return $true
    }

    if ($normalized -in @(
        "S-1-5-10",
        "SELF",
        "NT AUTHORITY\SELF"
    )) {
        return $true
    }

    return $false
}

function Get-FullAccessPermissions {
    param([string]$Identity)

    $rawPermissions = @()

    if (Get-Command Get-EXOMailboxPermission -ErrorAction SilentlyContinue) {
        Add-Log "A consultar FullAccess com Get-EXOMailboxPermission."

        try {
            $rawPermissions = @(
                Get-EXOMailboxPermission `
                    -Identity $Identity `
                    -ResultSize Unlimited `
                    -ErrorAction Stop
            )
        }
        catch {
            Add-Log "Get-EXOMailboxPermission falhou; será usado o cmdlet tradicional. Erro: $($_.Exception.Message)"
            $rawPermissions = @()
        }
    }

    if ($rawPermissions.Count -eq 0 -and (Get-Command Get-MailboxPermission -ErrorAction SilentlyContinue)) {
        Add-Log "A consultar FullAccess com Get-MailboxPermission."

        $rawPermissions = @(
            Get-MailboxPermission `
                -Identity $Identity `
                -ErrorAction Stop
        )
    }

    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($permission in $rawPermissions) {
        $rights = @($permission.AccessRights | ForEach-Object { [string]$_ })

        if ($rights -notcontains "FullAccess") {
            continue
        }

        $trustee = [string]$permission.User

        if (Test-IsSystemTrustee -Trustee $trustee) {
            continue
        }

        $resolved = Resolve-Trustee -Trustee $trustee

        $rows.Add([pscustomobject][ordered]@{
            permissionType = "FullAccess"
            displayName = [string]$resolved.displayName
            email = [string]$resolved.email
            objectType = [string]$resolved.objectType
            trustee = $trustee
            isInherited = [bool]$permission.IsInherited
            deny = [bool]$permission.Deny
        }) | Out-Null
    }

    return $rows.ToArray()
}

function Get-SendAsPermissions {
    param([string]$Identity)

    $rawPermissions = @()

    if (Get-Command Get-EXORecipientPermission -ErrorAction SilentlyContinue) {
        Add-Log "A consultar SendAs com Get-EXORecipientPermission."

        try {
            $rawPermissions = @(
                Get-EXORecipientPermission `
                    -Identity $Identity `
                    -ResultSize Unlimited `
                    -ErrorAction Stop
            )
        }
        catch {
            Add-Log "Get-EXORecipientPermission falhou; será usado o cmdlet tradicional. Erro: $($_.Exception.Message)"
            $rawPermissions = @()
        }
    }

    if ($rawPermissions.Count -eq 0 -and (Get-Command Get-RecipientPermission -ErrorAction SilentlyContinue)) {
        Add-Log "A consultar SendAs com Get-RecipientPermission."

        $rawPermissions = @(
            Get-RecipientPermission `
                -Identity $Identity `
                -ResultSize Unlimited `
                -ErrorAction Stop
        )
    }

    $rows = New-Object System.Collections.Generic.List[object]

    foreach ($permission in $rawPermissions) {
        $rights = @($permission.AccessRights | ForEach-Object { [string]$_ })

        if ($rights -notcontains "SendAs") {
            continue
        }

        $trustee = [string]$permission.Trustee

        if (Test-IsSystemTrustee -Trustee $trustee) {
            continue
        }

        $resolved = Resolve-Trustee -Trustee $trustee

        $rows.Add([pscustomobject][ordered]@{
            permissionType = "SendAs"
            displayName = [string]$resolved.displayName
            email = [string]$resolved.email
            objectType = [string]$resolved.objectType
            trustee = $trustee
            isInherited = $false
            deny = $false
        }) | Out-Null
    }

    return $rows.ToArray()
}

try {
    Add-Log "Início da consulta de permissões da mailbox."

    $request = Get-RequestObject

    if ([string]::IsNullOrWhiteSpace($action)) {
        if ($request -and $request.action) {
            $action = [string]$request.action
        }
        else {
            $action = Get-QueryValue -Name "action"
        }
    }

    if ([string]::IsNullOrWhiteSpace($action)) {
        $action = "consultar"
    }

    if ($action -notin @("consultar", "pesquisar")) {
        throw "Ação inválida: $action"
    }

    $mailbox = ""

    if ($request -and $request.mailbox) {
        $mailbox = [string]$request.mailbox
    }

    if ([string]::IsNullOrWhiteSpace($mailbox) -and $request -and $request.query) {
        $mailbox = [string]$request.query
    }

    if ([string]::IsNullOrWhiteSpace($mailbox)) {
        $mailbox = Get-QueryValue -Name "mailbox"
    }

    if ([string]::IsNullOrWhiteSpace($mailbox)) {
        $mailbox = Get-QueryValue -Name "query"
    }

    $mailbox = $mailbox.Trim()

    if ([string]::IsNullOrWhiteSpace($mailbox)) {
        throw "Informe um nome, número, alias ou endereço de e-mail."
    }

    $session = Test-ExchangeSession

    if (-not $session.connected) {
        throw "Não existe uma sessão ativa no Exchange Online. Utilize primeiro o botão de ligação Exchange do sistema."
    }

    Add-Log "Sessão Exchange Online validada. Conta: $($session.account)"

    if ($action -eq "pesquisar") {
        $matches = @(Search-ExchangeRecipients -SearchText $mailbox -MaximumResults 50)

        New-JsonResponse `
            -Success $true `
            -Message "Pesquisa concluída." `
            -Data @{
                query = $mailbox
                matches = $matches
                count = $matches.Count
                connectedAccount = $session.account
                searchedAt = (Get-Date -Format "dd/MM/yyyy HH:mm:ss")
                logs = $Logs.ToArray()
            }

        return
    }

    Add-Log "Mailbox informada: $mailbox"

    $mailboxInfo = Get-MailboxInfo -Identity $mailbox
    $identity = if (-not [string]::IsNullOrWhiteSpace($mailboxInfo.primarySmtpAddress)) {
        $mailboxInfo.primarySmtpAddress
    }
    else {
        $mailbox
    }

    if ($mailboxInfo.supportsFullAccess) {
        $fullAccess = @(Get-FullAccessPermissions -Identity $identity)
    }
    else {
        $fullAccess = @()
        Add-Log "FullAccess não aplicável ao tipo $($mailboxInfo.classificationLabel); consulta ignorada."
    }

    if ($mailboxInfo.supportsSendAs) {
        $sendAs = @(Get-SendAsPermissions -Identity $identity)
    }
    else {
        $sendAs = @()
        Add-Log "SendAs não aplicável ao tipo $($mailboxInfo.classificationLabel); consulta ignorada."
    }

    $permissions = @(
        $fullAccess + $sendAs |
            Sort-Object permissionType, displayName, email
    )

    Add-Log "FullAccess encontrados: $($fullAccess.Count)"
    Add-Log "SendAs encontrados: $($sendAs.Count)"
    Add-Log "Consulta concluída com sucesso."

    New-JsonResponse `
        -Success $true `
        -Message "Consulta concluída." `
        -Data @{
            mailbox = $mailboxInfo
            permissions = $permissions
            summary = [ordered]@{
                total = $permissions.Count
                fullAccess = $fullAccess.Count
                sendAs = $sendAs.Count
                fullAccessApplicable = [bool]$mailboxInfo.supportsFullAccess
                sendAsApplicable = [bool]$mailboxInfo.supportsSendAs
            }
            connectedAccount = $session.account
            consultedAt = (Get-Date -Format "dd/MM/yyyy HH:mm:ss")
            logs = $Logs.ToArray()
        }
}
catch {
    Add-Log "ERRO: $($_.Exception.Message)"

    New-JsonResponse `
        -Success $false `
        -Message "Não foi possível concluir a consulta." `
        -ErrorMessage $_.Exception.Message `
        -Data @{
            logs = $Logs.ToArray()
        }
}