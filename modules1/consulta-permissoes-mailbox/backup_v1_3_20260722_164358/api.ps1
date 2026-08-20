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

function Get-MailboxInfo {
    param([string]$Identity)

    $recipient = $null

    if (Get-Command Get-EXORecipient -ErrorAction SilentlyContinue) {
        try {
            $recipient = Get-EXORecipient `
                -Identity $Identity `
                -Properties DisplayName,PrimarySmtpAddress,RecipientTypeDetails,ExternalDirectoryObjectId `
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

    if (-not $recipient) {
        throw "Mailbox, LD ou destinatário não encontrado no Exchange Online: $Identity"
    }

    $recipientTypeDetails = [string]$recipient.RecipientTypeDetails
    $classification = Get-RecipientClassification -RecipientTypeDetails $recipientTypeDetails

    Add-Log "Tipo identificado: $($classification.classificationLabel) [$recipientTypeDetails]"

    return [ordered]@{
        identity = [string]$Identity
        displayName = [string]$recipient.DisplayName
        primarySmtpAddress = [string]$recipient.PrimarySmtpAddress
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

    if ($action -ne "consultar") {
        throw "Ação inválida: $action"
    }

    $mailbox = ""

    if ($request -and $request.mailbox) {
        $mailbox = [string]$request.mailbox
    }

    if ([string]::IsNullOrWhiteSpace($mailbox)) {
        $mailbox = Get-QueryValue -Name "mailbox"
    }

    $mailbox = $mailbox.Trim()

    if ([string]::IsNullOrWhiteSpace($mailbox)) {
        throw "Informe o endereço de e-mail da mailbox."
    }

    $session = Test-ExchangeSession

    if (-not $session.connected) {
        throw "Não existe uma sessão ativa no Exchange Online. Utilize primeiro o botão de ligação Exchange do sistema."
    }

    Add-Log "Sessão Exchange Online validada. Conta: $($session.account)"
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