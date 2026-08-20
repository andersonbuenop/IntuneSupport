param(
    $Query,
    $Config,
    [string]$Body = '',
    [string]$Method = 'GET'
)

try { Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue } catch {}

$action = ''
$payload = ''

try { $action = [string]$Query['action'] } catch {}

if (-not [string]::IsNullOrWhiteSpace($Body)) {
    $payload = $Body
}
else {
    try { $payload = [string]$Query['payload'] } catch {}
}

function Write-JsonResponse {
    param(
        [bool]$Success,
        [string]$Message,
        $Data = $null,
        $Connected = $null
    )

    if ($null -eq $Connected) {
        $Connected = $Success
    }

    return [pscustomobject]@{
        success   = $Success
        connected = [bool]$Connected
        message   = $Message
        data      = $Data
    }
}

function ConvertFrom-JsonSafe {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return [pscustomobject]@{}
    }

    try {
        return ($Text | ConvertFrom-Json -ErrorAction Stop)
    }
    catch {
        return [pscustomobject]@{}
    }
}

function Get-Val {
    param(
        $Obj,
        [string]$Name
    )

    try {
        if ($null -ne $Obj -and $Obj.PSObject.Properties.Name -contains $Name) {
            return [string]$Obj.$Name
        }
    }
    catch {}

    return ''
}

function Convert-ToText {
    param($Value)

    if ($null -eq $Value) {
        return ''
    }

    if ($Value -is [string]) {
        return $Value
    }

    if ($Value -is [System.Collections.IEnumerable]) {
        $parts = @()

        foreach ($item in $Value) {
            if ($null -eq $item) {
                continue
            }

            $text = ''

            try {
                if ($item.PSObject.Properties.Name -contains 'PrimarySmtpAddress') {
                    $text = [string]$item.PrimarySmtpAddress
                }
                elseif ($item.PSObject.Properties.Name -contains 'Address') {
                    $text = [string]$item.Address
                }
                elseif ($item.PSObject.Properties.Name -contains 'Name') {
                    $text = [string]$item.Name
                }
                else {
                    $text = [string]$item
                }
            }
            catch {
                $text = [string]$item
            }

            if (-not [string]::IsNullOrWhiteSpace($text)) {
                $parts += $text
            }
        }

        return ($parts -join '; ')
    }

    return [string]$Value
}

function To-Date {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $null
    }

    try {
        return [datetime]::Parse($Value, [System.Globalization.CultureInfo]::InvariantCulture)
    }
    catch {
        try {
            return [datetime]::Parse($Value)
        }
        catch {
            return $null
        }
    }
}

function Convert-DateLocalString {
    param($DateValue)

    try {
        if (-not $DateValue) {
            return ''
        }

        $date = [datetime]$DateValue
        return $date.ToString('yyyy-MM-ddTHH:mm')
    }
    catch {
        return ''
    }
}

function Test-TrackingEmailExchangeOnline {
    try {
        Import-Module ExchangeOnlineManagement -ErrorAction Stop

        $connection = Get-ConnectionInformation -ErrorAction SilentlyContinue | Select-Object -First 1

        if (-not $connection) {
            return [pscustomobject]@{
                success   = $false
                connected = $false
                message   = 'Não existe sessão ativa no Exchange Online.'
            }
        }

        if (Get-Command Get-EXOMailbox -ErrorAction SilentlyContinue) {
            Get-EXOMailbox -ResultSize 1 -ErrorAction Stop | Out-Null
        }
        elseif (Get-Command Get-Mailbox -ErrorAction SilentlyContinue) {
            Get-Mailbox -ResultSize 1 -ErrorAction Stop | Out-Null
        }
        else {
            throw 'A sessão foi encontrada, mas os comandos de mailbox não estão disponíveis.'
        }

        return [pscustomobject]@{
            success   = $true
            connected = $true
            message   = 'Exchange Online conectado e funcional.'
        }
    }
    catch {
        return [pscustomobject]@{
            success   = $false
            connected = $false
            message   = "Sessão EXO inválida ou expirada: $($_.Exception.Message)"
        }
    }
}

function Ensure-ExchangeReady {
    $test = Test-TrackingEmailExchangeOnline

    if (-not $test.success) {
        throw $test.message
    }

    return $true
}

function Connect-EXO {
    param($PayloadObject)

    Import-Module ExchangeOnlineManagement -ErrorAction Stop

    $adminUpn = Get-Val $PayloadObject 'adminUpn'

    if ([string]::IsNullOrWhiteSpace($adminUpn)) {
        Connect-ExchangeOnline -ShowBanner:$false -ErrorAction Stop
    }
    else {
        Connect-ExchangeOnline -UserPrincipalName $adminUpn -ShowBanner:$false -ErrorAction Stop
    }

    $test = Test-TrackingEmailExchangeOnline

    if (-not $test.success) {
        throw $test.message
    }

    return 'Exchange Online conectado com sucesso.'
}

function Get-SmtpFromOutlookAddressEntry {
    param($AddressEntry)

    if ($null -eq $AddressEntry) {
        return ''
    }

    $smtp = ''

    try {
        $type = [string]$AddressEntry.Type

        if ($type -eq 'EX') {
            try {
                $exchangeUser = $AddressEntry.GetExchangeUser()
                if ($exchangeUser) {
                    $smtp = [string]$exchangeUser.PrimarySmtpAddress
                    try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($exchangeUser) | Out-Null } catch {}
                }
            }
            catch {}

            if ([string]::IsNullOrWhiteSpace($smtp)) {
                try {
                    $smtp = [string]$AddressEntry.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x39FE001E')
                }
                catch {}
            }
        }
        else {
            try { $smtp = [string]$AddressEntry.Address } catch {}
        }
    }
    catch {}

    return $smtp
}

function Read-MsgOutlook {
    param($PayloadObject)

    $path = Get-Val $PayloadObject 'msgPath'

    if ([string]::IsNullOrWhiteSpace($path)) {
        throw 'Caminho do ficheiro .msg não informado.'
    }

    if ([System.IO.Path]::GetExtension($path) -ine '.msg') {
        throw 'Apenas ficheiros com extensão .MSG são permitidos.'
    }

    if ([System.IO.Path]::IsPathRooted($path) -eq $false -or $path.StartsWith('\\')) {
        throw 'O caminho do ficheiro .MSG deve ser local e absoluto.'
    }

    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Ficheiro .msg não encontrado: $path"
    }

    $fileInfo = Get-Item -LiteralPath $path -ErrorAction Stop
    if ($fileInfo.Length -gt 50MB) {
        throw 'O ficheiro .MSG excede o limite de 50 MB.'
    }

    $outlook = $null
    $item = $null
    $sender = $null

    try {
        $outlook = New-Object -ComObject Outlook.Application
        $item = $outlook.Session.OpenSharedItem($path)

        if (-not $item) {
            throw 'O Outlook não conseguiu abrir o ficheiro .msg.'
        }

        $internetMessageId = ''
        try {
            $internetMessageId = [string]$item.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x1035001E')
        }
        catch {}

        $senderEmail = ''
        try { $senderEmail = [string]$item.SenderEmailAddress } catch {}

        try {
            $sender = $item.Sender
            $resolvedSmtp = Get-SmtpFromOutlookAddressEntry $sender

            if (-not [string]::IsNullOrWhiteSpace($resolvedSmtp)) {
                $senderEmail = $resolvedSmtp
            }
        }
        catch {}

        if ($senderEmail -like '/O=*') {
            try {
                $senderEmail = [string]$item.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x5D01001E')
            }
            catch {}
        }

        $received = ''
        $sent = ''

        try { $received = [string]$item.ReceivedTime } catch {}
        try { $sent = [string]$item.SentOn } catch {}

        $dateLocal = ''

        if ($received) {
            $dateLocal = Convert-DateLocalString $item.ReceivedTime
        }
        elseif ($sent) {
            $dateLocal = Convert-DateLocalString $item.SentOn
        }

        return [pscustomobject]@{
            fileName           = [System.IO.Path]::GetFileName($path)
            fullPath           = $path
            from               = [string]$item.SenderName
            senderEmailAddress = $senderEmail
            to                 = [string]$item.To
            cc                 = [string]$item.CC
            subject            = [string]$item.Subject
            receivedTime       = $received
            sentOn             = $sent
            dateLocal          = $dateLocal
            internetMessageId  = $internetMessageId
        }
    }
    catch {
        throw $_.Exception.Message
    }
    finally {
        try {
            if ($sender) {
                [System.Runtime.InteropServices.Marshal]::ReleaseComObject($sender) | Out-Null
            }
        }
        catch {}

        try {
            if ($item) {
                [System.Runtime.InteropServices.Marshal]::ReleaseComObject($item) | Out-Null
            }
        }
        catch {}

        try {
            if ($outlook) {
                [System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook) | Out-Null
            }
        }
        catch {}

        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function Resolve-RecipientExo {
    param($PayloadObject)

    $inputValue = Get-Val $PayloadObject 'recipientName'

    if ([string]::IsNullOrWhiteSpace($inputValue)) {
        $inputValue = Get-Val $PayloadObject 'recipient'
    }

    if ([string]::IsNullOrWhiteSpace($inputValue)) {
        $inputValue = Get-Val $PayloadObject 'mailbox'
    }

    if ([string]::IsNullOrWhiteSpace($inputValue)) {
        throw 'Destinatário/mailbox não informado.'
    }

    $results = @()

    try {
        $results += Get-Recipient -Identity $inputValue -ErrorAction Stop
    }
    catch {}

    if (@($results).Count -eq 0) {
        try {
            $safe = $inputValue.Replace("'", "''")
            $results += Get-Recipient -ResultSize 30 -Filter "DisplayName -like '*$safe*'" -ErrorAction Stop
        }
        catch {}
    }

    if (@($results).Count -eq 0) {
        try {
            $results += Get-Recipient -Anr $inputValue -ResultSize 30 -ErrorAction Stop
        }
        catch {}
    }

    $clean = @()

    foreach ($recipientObject in $results) {
        $smtp = ''

        try { $smtp = [string]$recipientObject.PrimarySmtpAddress } catch {}

        if ([string]::IsNullOrWhiteSpace($smtp)) {
            try { $smtp = [string]$recipientObject.WindowsEmailAddress } catch {}
        }

        if (-not [string]::IsNullOrWhiteSpace($smtp)) {
            $clean += [pscustomobject]@{
                displayName          = [string]$recipientObject.DisplayName
                primarySmtpAddress   = $smtp
                recipientTypeDetails = [string]$recipientObject.RecipientTypeDetails
                identity             = [string]$recipientObject.Identity
            }
        }
    }

    $clean = @($clean | Sort-Object primarySmtpAddress -Unique)

    if ($clean.Count -eq 0) {
        return [pscustomobject]@{
            found     = $false
            ambiguous = $false
            input     = $inputValue
            selected  = $null
            results   = @()
            message   = "Nenhum destinatário encontrado no Exchange Online para: $inputValue"
        }
    }

    $normalizedInput = $inputValue.Trim()
    $exact = @(
        $clean | Where-Object {
            $_.primarySmtpAddress -ieq $normalizedInput -or
            $_.identity -ieq $normalizedInput -or
            $_.displayName -ieq $normalizedInput
        }
    )

    $selected = $null
    $ambiguous = $false

    if ($exact.Count -eq 1) {
        $selected = $exact[0]
    }
    elseif ($clean.Count -eq 1) {
        $selected = $clean[0]
    }
    else {
        $ambiguous = $true
    }

    $message = 'Destinatário resolvido com sucesso.'

    if ($ambiguous) {
        $message = "Foram encontrados $($clean.Count) destinatários possíveis. Informe o endereço SMTP completo."
    }

    return [pscustomobject]@{
        found     = $true
        ambiguous = $ambiguous
        input     = $inputValue
        selected  = $selected
        results   = $clean
        message   = $message
    }
}

function Resolve-Solicitante {
    param($PayloadObject)

    $solicitante = Get-Val $PayloadObject 'solicitante'

    if ([string]::IsNullOrWhiteSpace($solicitante)) {
        return [pscustomobject]@{
            input       = ''
            displayName = ''
            found       = $false
            source      = ''
        }
    }

    $attempts = @($solicitante)

    if ($solicitante -notmatch '@') {
        $attempts += "$solicitante@corp.santander.pt"
        $attempts += "$solicitante@santander.pt"
    }

    foreach ($identity in $attempts) {
        try {
            $recipientObject = Get-Recipient -Identity $identity -ErrorAction Stop
            return [pscustomobject]@{
                input       = $solicitante
                displayName = [string]$recipientObject.DisplayName
                found       = $true
                source      = 'ExchangeRecipient'
            }
        }
        catch {}

        try {
            $userObject = Get-User -Identity $identity -ErrorAction Stop
            return [pscustomobject]@{
                input       = $solicitante
                displayName = [string]$userObject.DisplayName
                found       = $true
                source      = 'ExchangeUser'
            }
        }
        catch {}
    }

    try {
        Import-Module ActiveDirectory -ErrorAction Stop
        $safe = $solicitante.Replace("'", "''")
        $adUser = Get-ADUser -Filter "SamAccountName -eq '$safe' -or UserPrincipalName -eq '$safe' -or Mail -eq '$safe'" -Properties DisplayName, Mail, UserPrincipalName -ErrorAction Stop | Select-Object -First 1

        if ($adUser) {
            return [pscustomobject]@{
                input       = $solicitante
                displayName = [string]$adUser.DisplayName
                found       = $true
                source      = 'ActiveDirectory'
            }
        }
    }
    catch {}

    return [pscustomobject]@{
        input       = $solicitante
        displayName = $solicitante
        found       = $false
        source      = 'NotFound'
    }
}

function Convert-ToTrackingSmtpAddress {
    param($Value)

    if ($null -eq $Value) { return '' }

    $text = ([string]$Value).Trim()
    if ([string]::IsNullOrWhiteSpace($text)) { return '' }

    if ($text -match '(?i)^smtp:') {
        $text = $text.Substring(5).Trim()
    }

    if ($text.StartsWith('<') -and $text.EndsWith('>') -and $text.Length -gt 2) {
        $text = $text.Substring(1, $text.Length - 2).Trim()
    }

    if ($text -notmatch '^[^\s@]+@[^\s@]+$') { return '' }
    return $text.ToLowerInvariant()
}

function Get-TrackingMailboxAddressMap {
    param([string]$Identity)

    $records = [ordered]@{}
    $errors = @()
    $resolved = $false
    $displayName = ''
    $recipientTypeDetails = ''
    $primarySmtpAddress = ''

    $priority = @{
        'SMTP principal' = 100
        'Endereço técnico híbrido' = 90
        'Encaminhamento externo' = 85
        'UPN' = 75
        'Alias SMTP' = 60
        'Endereço informado' = 50
    }

    $addAddress = {
        param($RawValue, [string]$Type, [string]$Source)

        $smtp = Convert-ToTrackingSmtpAddress $RawValue
        if ([string]::IsNullOrWhiteSpace($smtp)) { return }

        if ($smtp -match '(?i)\.mail\.onmicrosoft\.com$') {
            $Type = 'Endereço técnico híbrido'
        }

        if (-not $records.Contains($smtp)) {
            $records[$smtp] = [pscustomobject]@{
                address = $smtp
                type = $Type
                source = $Source
                priority = $(if ($priority.ContainsKey($Type)) { $priority[$Type] } else { 1 })
            }
            return
        }

        $existing = $records[$smtp]
        $newPriority = $(if ($priority.ContainsKey($Type)) { $priority[$Type] } else { 1 })
        if ($newPriority -gt [int]$existing.priority) {
            $existing.type = $Type
            $existing.priority = $newPriority
        }

        if ($Source -and ([string]$existing.source -notlike "*$Source*")) {
            $existing.source = ((@([string]$existing.source, $Source) | Where-Object { $_ }) -join '; ')
        }
    }

    & $addAddress $Identity 'Endereço informado' 'Campo Mailbox/Destinatário'

    $objects = @()

    try {
        $recipientObject = Get-Recipient -Identity $Identity -ErrorAction Stop
        if ($recipientObject) {
            $objects += $recipientObject
            $resolved = $true
        }
    }
    catch {
        $errors += "Get-Recipient: $($_.Exception.Message)"
    }

    try {
        if (Get-Command Get-Mailbox -ErrorAction SilentlyContinue) {
            $mailboxObject = Get-Mailbox -Identity $Identity -ErrorAction Stop
            if ($mailboxObject) {
                $objects += $mailboxObject
                $resolved = $true
            }
        }
    }
    catch {
        $errors += "Get-Mailbox: $($_.Exception.Message)"
    }

    try {
        $exoMailboxCommand = Get-Command Get-EXOMailbox -ErrorAction SilentlyContinue
        if ($exoMailboxCommand) {
            $params = @{ Identity = $Identity; ErrorAction = 'Stop' }
            if ($exoMailboxCommand.Parameters.ContainsKey('Properties')) {
                $params['Properties'] = @(
                    'EmailAddresses',
                    'WindowsEmailAddress',
                    'UserPrincipalName',
                    'RecipientTypeDetails'
                )
            }
            $exoMailboxObject = Get-EXOMailbox @params
            if ($exoMailboxObject) {
                $objects += $exoMailboxObject
                $resolved = $true
            }
        }
    }
    catch {
        $errors += "Get-EXOMailbox: $($_.Exception.Message)"
    }

    try {
        if (Get-Command Get-MailUser -ErrorAction SilentlyContinue) {
            $mailUserObject = Get-MailUser -Identity $Identity -ErrorAction Stop
            if ($mailUserObject) {
                $objects += $mailUserObject
                $resolved = $true
            }
        }
    }
    catch {}

    foreach ($object in @($objects)) {
        if (-not $displayName) {
            try { $displayName = [string]$object.DisplayName } catch {}
        }
        if (-not $recipientTypeDetails) {
            try { $recipientTypeDetails = [string]$object.RecipientTypeDetails } catch {}
        }

        try {
            $value = Convert-ToTrackingSmtpAddress $object.PrimarySmtpAddress
            if ($value) {
                $primarySmtpAddress = $value
                & $addAddress $value 'SMTP principal' 'PrimarySmtpAddress'
            }
        }
        catch {}

        foreach ($propertyName in @('WindowsEmailAddress', 'UserPrincipalName', 'WindowsLiveID')) {
            try {
                if ($object.PSObject.Properties.Name -contains $propertyName) {
                    & $addAddress $object.$propertyName 'UPN' $propertyName
                }
            }
            catch {}
        }

        foreach ($propertyName in @('ExternalEmailAddress', 'RemoteRoutingAddress', 'TargetAddress')) {
            try {
                if ($object.PSObject.Properties.Name -contains $propertyName) {
                    & $addAddress $object.$propertyName 'Encaminhamento externo' $propertyName
                }
            }
            catch {}
        }

        try {
            foreach ($proxyAddress in @($object.EmailAddresses)) {
                $proxyText = [string]$proxyAddress
                $proxyType = 'Alias SMTP'
                if ($proxyText -cmatch '^SMTP:') { $proxyType = 'SMTP principal' }
                if ($proxyText -match '(?i)\.mail\.onmicrosoft\.com$') { $proxyType = 'Endereço técnico híbrido' }
                & $addAddress $proxyText $proxyType 'EmailAddresses'
            }
        }
        catch {}
    }

    if (-not $primarySmtpAddress) {
        $primaryRecord = @($records.Values | Where-Object { $_.type -eq 'SMTP principal' } | Select-Object -First 1)
        if ($primaryRecord.Count -gt 0) { $primarySmtpAddress = [string]$primaryRecord[0].address }
    }

    $recordArray = @(
        $records.Values |
            Sort-Object @{ Expression = { [int]$_.priority }; Descending = $true }, address |
            Select-Object address, type, source
    )

    return [pscustomobject]@{
        identity = $Identity
        resolved = $resolved
        displayName = $displayName
        recipientTypeDetails = $recipientTypeDetails
        primarySmtpAddress = $primarySmtpAddress
        addresses = @($recordArray | ForEach-Object { $_.address })
        addressRecords = $recordArray
        technicalAddresses = @($recordArray | Where-Object { $_.type -in @('Endereço técnico híbrido', 'Encaminhamento externo') } | ForEach-Object { $_.address })
        error = $(if (-not $resolved) { (($errors | Where-Object { $_ }) -join ' | ') } else { '' })
    }
}

function Get-MailboxData {
    param($PayloadObject)

    $mailbox = Get-Val $PayloadObject 'mailbox'

    $result = [ordered]@{
        identity                      = $mailbox
        displayName                   = ''
        primarySmtpAddress            = ''
        recipientTypeDetails          = ''
        hiddenFromAddressListsEnabled = ''
        forwardingAddress             = ''
        forwardingSmtpAddress         = ''
        deliverToMailboxAndForward    = ''
        hasForwarding                 = $false
        resolved                      = $false
        addresses                     = @()
        addressRecords                = @()
        technicalAddresses            = @()
        addressResolutionError        = ''
        error                         = ''
    }

    if ([string]::IsNullOrWhiteSpace($mailbox)) {
        $result.error = 'Mailbox não informada.'
        return [pscustomobject]$result
    }

    try {
        $mailboxObject = $null
        $exoCommand = Get-Command Get-EXOMailbox -ErrorAction SilentlyContinue

        if ($exoCommand) {
            $params = @{
                Identity    = $mailbox
                ErrorAction = 'Stop'
            }

            if ($exoCommand.Parameters.ContainsKey('Properties')) {
                $params['Properties'] = @(
                    'ForwardingAddress',
                    'ForwardingSmtpAddress',
                    'DeliverToMailboxAndForward',
                    'HiddenFromAddressListsEnabled',
                    'EmailAddresses',
                    'WindowsEmailAddress',
                    'UserPrincipalName'
                )
            }

            try {
                $mailboxObject = Get-EXOMailbox @params
            }
            catch {
                if (Get-Command Get-Mailbox -ErrorAction SilentlyContinue) {
                    $mailboxObject = Get-Mailbox -Identity $mailbox -ErrorAction Stop
                }
                else {
                    throw
                }
            }
        }
        else {
            $mailboxObject = Get-Mailbox -Identity $mailbox -ErrorAction Stop
        }

        $result.displayName = [string]$mailboxObject.DisplayName
        $result.resolved = $true
        $result.primarySmtpAddress = [string]$mailboxObject.PrimarySmtpAddress
        $result.recipientTypeDetails = [string]$mailboxObject.RecipientTypeDetails
        $result.hiddenFromAddressListsEnabled = [string]$mailboxObject.HiddenFromAddressListsEnabled
        $result.forwardingAddress = Convert-ToText $mailboxObject.ForwardingAddress
        $result.forwardingSmtpAddress = Convert-ToText $mailboxObject.ForwardingSmtpAddress
        $result.deliverToMailboxAndForward = [string]$mailboxObject.DeliverToMailboxAndForward

        if ($result.forwardingAddress -or $result.forwardingSmtpAddress) {
            $result.hasForwarding = $true
        }
    }
    catch {
        $result.error = $_.Exception.Message
    }

    try {
        $addressMap = Get-TrackingMailboxAddressMap -Identity $mailbox
        $result.addresses = @($addressMap.addresses)
        $result.addressRecords = @($addressMap.addressRecords)
        $result.technicalAddresses = @($addressMap.technicalAddresses)
        $result.addressResolutionError = [string]$addressMap.error
        if ($addressMap.resolved) { $result.resolved = $true }

        if (-not $result.primarySmtpAddress -and $addressMap.primarySmtpAddress) {
            $result.primarySmtpAddress = [string]$addressMap.primarySmtpAddress
        }
        if (-not $result.displayName -and $addressMap.displayName) {
            $result.displayName = [string]$addressMap.displayName
        }
        if (-not $result.recipientTypeDetails -and $addressMap.recipientTypeDetails) {
            $result.recipientTypeDetails = [string]$addressMap.recipientTypeDetails
        }
    }
    catch {
        $result.addressResolutionError = $_.Exception.Message
    }

    if (-not $result.resolved -and -not [string]::IsNullOrWhiteSpace($mailbox)) {
        $result.error = 'O endereço não foi resolvido como mailbox no tenant Exchange Online conectado. O rastreio de transporte continua disponível, mas forwarding e regras não podem ser confirmados.'
    }

    return [pscustomobject]$result
}

function Convert-TraceRawItems {
    param($Items)

    $output = @()

    foreach ($traceItem in @($Items)) {
        $receivedValue = $null

        if ($traceItem.PSObject.Properties.Name -contains 'Received') {
            $receivedValue = $traceItem.Received
        }
        elseif ($traceItem.PSObject.Properties.Name -contains 'ReceivedDateTime') {
            $receivedValue = $traceItem.ReceivedDateTime
        }

        $receivedText = ''
        $receivedUtcText = ''
        $receivedSort = [datetime]::MinValue

        try {
            if ($receivedValue) {
                $receivedDate = [datetime]$receivedValue

                if ($receivedDate.Kind -eq [System.DateTimeKind]::Unspecified) {
                    $receivedDate = [datetime]::SpecifyKind($receivedDate, [System.DateTimeKind]::Utc)
                }

                $receivedSort = $receivedDate.ToUniversalTime()
                $receivedUtcText = $receivedSort.ToString('yyyy-MM-dd HH:mm:ss')
                $receivedText = $receivedSort.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss')
            }
        }
        catch {
            $receivedText = [string]$receivedValue
            $receivedUtcText = [string]$receivedValue
        }

        $traceId = ''
        if ($traceItem.PSObject.Properties.Name -contains 'MessageTraceId') {
            $traceId = [string]$traceItem.MessageTraceId
        }

        $messageId = ''
        if ($traceItem.PSObject.Properties.Name -contains 'MessageId') {
            $messageId = [string]$traceItem.MessageId
        }

        $output += [pscustomobject]@{
            received       = $receivedText
            receivedUtc    = $receivedUtcText
            receivedSort   = $receivedSort
            sender         = [string]$traceItem.SenderAddress
            recipient      = [string]$traceItem.RecipientAddress
            subject        = [string]$traceItem.Subject
            status         = [string]$traceItem.Status
            messageTraceId = $traceId
            messageId      = $messageId
        }
    }

    return @(
        $output |
            Sort-Object messageTraceId, recipient, messageId -Unique |
            Sort-Object receivedSort -Descending
    )
}

function Invoke-TrackingMessageTraceQuery {
    param(
        [datetime]$Start,
        [datetime]$End,
        [string]$Recipient = '',
        [string]$Sender = '',
        [string]$Subject = '',
        [string]$MessageId = '',
        [bool]$UseServerSubject = $false,
        [string]$Label = 'Pesquisa'
    )

    $allRawItems = @()
    $errors = @()
    $truncated = $false
    $chunkCount = 0
    $cursor = $Start

    while ($cursor -lt $End) {
        $chunkEnd = $cursor.AddDays(10)
        if ($chunkEnd -gt $End) {
            $chunkEnd = $End
        }

        $chunkCount++

        try {
            $items = @()
            $v2Command = Get-Command Get-MessageTraceV2 -ErrorAction SilentlyContinue

            if ($v2Command) {
                $params = @{
                    StartDate   = $cursor
                    EndDate     = $chunkEnd
                    ErrorAction = 'Stop'
                }

                if ($v2Command.Parameters.ContainsKey('ResultSize')) {
                    $params['ResultSize'] = 5000
                }

                if (-not [string]::IsNullOrWhiteSpace($Recipient)) {
                    $params['RecipientAddress'] = $Recipient
                }

                if (-not [string]::IsNullOrWhiteSpace($Sender)) {
                    $params['SenderAddress'] = $Sender
                }

                if (-not [string]::IsNullOrWhiteSpace($MessageId) -and $v2Command.Parameters.ContainsKey('MessageId')) {
                    $params['MessageId'] = $MessageId
                }

                if ($UseServerSubject -and -not [string]::IsNullOrWhiteSpace($Subject) -and $v2Command.Parameters.ContainsKey('Subject')) {
                    $params['Subject'] = $Subject
                    if ($v2Command.Parameters.ContainsKey('SubjectFilterType')) {
                        $params['SubjectFilterType'] = 'Contains'
                    }
                }

                $items = @(Get-MessageTraceV2 @params)
            }
            else {
                $params = @{
                    StartDate   = $cursor
                    EndDate     = $chunkEnd
                    PageSize    = 5000
                    ErrorAction = 'Stop'
                }

                if (-not [string]::IsNullOrWhiteSpace($Recipient)) {
                    $params['RecipientAddress'] = $Recipient
                }

                if (-not [string]::IsNullOrWhiteSpace($Sender)) {
                    $params['SenderAddress'] = $Sender
                }

                if (-not [string]::IsNullOrWhiteSpace($MessageId)) {
                    $params['MessageId'] = $MessageId
                }

                $items = @(Get-MessageTrace @params)
            }

            if (@($items).Count -ge 5000) {
                $truncated = $true
            }

            $allRawItems += $items
        }
        catch {
            $errors += "Período $($cursor.ToString('yyyy-MM-dd HH:mm')) a $($chunkEnd.ToString('yyyy-MM-dd HH:mm')): $($_.Exception.Message)"
        }

        $cursor = $chunkEnd
    }

    $normalized = @(Convert-TraceRawItems $allRawItems)

    if ($UseServerSubject -and -not [string]::IsNullOrWhiteSpace($Subject)) {
        $normalized = @($normalized | Where-Object { $_.subject -like "*$Subject*" })
    }

    return [pscustomobject]@{
        label      = $Label
        recipient  = $Recipient
        sender     = $Sender
        subject    = $(if ($UseServerSubject) { $Subject } else { '' })
        messageId  = $MessageId
        items      = $normalized
        count      = @($normalized).Count
        error      = ($errors -join ' | ')
        truncated  = $truncated
        chunkCount = $chunkCount
    }
}

function Get-TrackingTraceDetails {
    param($TraceItems)

    $output = @()
    $detailCommandV2 = Get-Command Get-MessageTraceDetailV2 -ErrorAction SilentlyContinue
    $detailCommandV1 = Get-Command Get-MessageTraceDetail -ErrorAction SilentlyContinue

    foreach ($trace in @($TraceItems | Select-Object -First 25)) {
        $events = @()
        $errorText = ''

        try {
            $detailItems = @()

            if ($detailCommandV2 -and $trace.messageTraceId -and $trace.recipient) {
                $detailItems = @(Get-MessageTraceDetailV2 -MessageTraceId $trace.messageTraceId -RecipientAddress $trace.recipient -ErrorAction Stop)
            }
            elseif ($detailCommandV1 -and $trace.messageTraceId -and $trace.recipient) {
                $detailItems = @(Get-MessageTraceDetail -MessageTraceId $trace.messageTraceId -RecipientAddress $trace.recipient -ErrorAction Stop)
            }

            foreach ($detail in $detailItems) {
                $dateValue = $null
                if ($detail.PSObject.Properties.Name -contains 'Date') {
                    $dateValue = $detail.Date
                }
                elseif ($detail.PSObject.Properties.Name -contains 'EventDate') {
                    $dateValue = $detail.EventDate
                }

                $localDate = ''
                $utcDate = ''

                try {
                    if ($dateValue) {
                        $parsedDate = [datetime]$dateValue
                        if ($parsedDate.Kind -eq [System.DateTimeKind]::Unspecified) {
                            $parsedDate = [datetime]::SpecifyKind($parsedDate, [System.DateTimeKind]::Utc)
                        }
                        $utcDate = $parsedDate.ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss')
                        $localDate = $parsedDate.ToUniversalTime().ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss')
                    }
                }
                catch {
                    $localDate = [string]$dateValue
                    $utcDate = [string]$dateValue
                }

                $events += [pscustomobject]@{
                    date      = $localDate
                    dateUtc   = $utcDate
                    event     = Convert-ToText $detail.Event
                    action    = Convert-ToText $detail.Action
                    detail    = Convert-ToText $detail.Detail
                    data      = Convert-ToText $detail.Data
                    fromIp    = Convert-ToText $detail.FromIP
                    toIp      = Convert-ToText $detail.ToIP
                }
            }
        }
        catch {
            $errorText = $_.Exception.Message
        }

        $output += [pscustomobject]@{
            messageTraceId = $trace.messageTraceId
            messageId      = $trace.messageId
            recipient      = $trace.recipient
            events         = $events
            error          = $errorText
        }
    }

    return $output
}

function Add-TrackingTraceAssociation {
    param($Items, $AddressRecords)

    $addressMap = @{}
    foreach ($record in @($AddressRecords)) {
        $key = Convert-ToTrackingSmtpAddress $record.address
        if ($key) { $addressMap[$key] = $record }
    }$output = @()
    foreach ($item in @($Items)) {
        $recipientKey = Convert-ToTrackingSmtpAddress $item.recipient
        $record = $null
        if ($recipientKey -and $addressMap.ContainsKey($recipientKey)) {
            $record = $addressMap[$recipientKey]
        }

        $association = ''
        $scope = 'other'
        $isMailboxMatch = $false

        if ($record) {
            $association = [string]$record.type
            $isMailboxMatch = $true
            if ($record.type -eq 'SMTP principal' -or $record.type -eq 'Endereço informado') {
                $scope = 'primary'
            }
            elseif ($record.type -in @('Endereço técnico híbrido', 'Encaminhamento externo')) {
                $scope = 'technical'
            }
            else {
                $scope = 'alias'
            }
        }

        $output += [pscustomobject]@{
            received             = $item.received
            receivedUtc          = $item.receivedUtc
            receivedSort         = $item.receivedSort
            sender               = $item.sender
            recipient            = $item.recipient
            subject              = $item.subject
            status               = $item.status
            messageTraceId       = $item.messageTraceId
            messageId            = $item.messageId
            isMailboxMatch       = $isMailboxMatch
            recipientAssociation = $association
            associationScope     = $scope
        }
    }

    return $output
}

function Get-TraceDeliveryOutcome {
    param($TraceItems, $Details)

    if (@($TraceItems).Count -eq 0) { return 'Não localizado' }

    $eventText = @()
    foreach ($detail in @($Details)) {
        foreach ($event in @($detail.events)) {
            $eventText += "$($event.event) $($event.action) $($event.detail) $($event.data)"
        }
    }

    $eventCombined = ($eventText -join ' ').ToLowerInvariant()
    $statuses = @($TraceItems | ForEach-Object { ([string]$_.status).ToLowerInvariant() })

    if ($eventCombined -match 'quarant' -or $statuses -contains 'quarantined') { return 'Quarentena' }
    if ($eventCombined -match 'junk|spam' -or $statuses -contains 'filteredasspam') { return 'Spam/Junk' }
    if ($eventCombined -match 'fail|reject|drop|blocked' -or $statuses -contains 'failed') { return 'Falha' }
    if ($statuses -contains 'pending' -or $statuses -contains 'gettingstatus') { return 'Pendente' }
    if ($statuses -contains 'delivered') { return 'Entregue' }
    if ($statuses -contains 'expanded') { return 'Expandido' }

    $statusText = ((@($TraceItems | ForEach-Object { $_.status } | Where-Object { $_ } | Sort-Object -Unique)) -join ', ')
    if ([string]::IsNullOrWhiteSpace($statusText)) { return 'Localizado' }
    return $statusText
}

function Get-TraceData {
    param($PayloadObject)

    $mailbox = Get-Val $PayloadObject 'mailbox'
    $recipient = Get-Val $PayloadObject 'recipient'
    $sender = Get-Val $PayloadObject 'sender'
    $subject = Get-Val $PayloadObject 'subject'
    $messageId = Get-Val $PayloadObject 'messageId'

    if ([string]::IsNullOrWhiteSpace($recipient)) { $recipient = $mailbox }

    if ([string]::IsNullOrWhiteSpace($recipient) -and [string]::IsNullOrWhiteSpace($sender) -and [string]::IsNullOrWhiteSpace($messageId)) {
        throw 'Informe o destinatário/mailbox, o remetente ou o Message-ID para o Message Trace.'
    }

    $start = To-Date (Get-Val $PayloadObject 'start')
    $end = To-Date (Get-Val $PayloadObject 'end')
    if (-not $start) { $start = (Get-Date).AddHours(-24) }
    if (-not $end) { $end = Get-Date }
    if ($start -ge $end) { throw 'A data inicial deve ser anterior à data final.' }

    $addressMap = Get-TrackingMailboxAddressMap -Identity $recipient
    $addressRecords = @($addressMap.addressRecords)
    if ($addressRecords.Count -eq 0 -and $recipient) {
        $addressRecords = @([pscustomobject]@{ address = (Convert-ToTrackingSmtpAddress $recipient); type = 'Endereço informado'; source = 'Campo Destinatário' })
    }

    $addressesToQuery = @($addressRecords | ForEach-Object { $_.address } | Where-Object { $_ } | Select-Object -First 15)
    if ($addressesToQuery.Count -eq 0 -and $recipient) { $addressesToQuery = @($recipient) }

    $attempts = @()
    $errors = @()
    $truncated = $false
    $chunkCount = 0
    $mailboxQueryItems = @()
    $subjectGlobalItems = @()
    $senderGlobalItems = @()

    foreach ($address in $addressesToQuery) {
        $label = "Endereço associado: $address"
        $attempt = Invoke-TrackingMessageTraceQuery -Start $start -End $end -Recipient $address -MessageId $messageId -Label $label
        $attempts += $attempt
        if ($attempt.error) { $errors += $attempt.error }
        $truncated = $truncated -or $attempt.truncated
        $chunkCount += $attempt.chunkCount
        $mailboxQueryItems += @($attempt.items)
    }

    $mailboxQueryItems = @(
        $mailboxQueryItems |
            Sort-Object messageTraceId, recipient, messageId -Unique |
            Sort-Object receivedSort -Descending
    )
    $mailboxQueryItems = @(Add-TrackingTraceAssociation $mailboxQueryItems $addressRecords)

    if (-not [string]::IsNullOrWhiteSpace($subject)) {
        $subjectAttempt = Invoke-TrackingMessageTraceQuery -Start $start -End $end -Subject $subject -UseServerSubject $true -Label 'Assunto + período (pesquisa organizacional)'
        $attempts += $subjectAttempt
        if ($subjectAttempt.error) { $errors += $subjectAttempt.error }
        $truncated = $truncated -or $subjectAttempt.truncated
        $chunkCount += $subjectAttempt.chunkCount
        $subjectGlobalItems = @(Add-TrackingTraceAssociation $subjectAttempt.items $addressRecords)
    }

    if ([string]::IsNullOrWhiteSpace($subject) -and -not [string]::IsNullOrWhiteSpace($sender)) {
        $senderAttempt = Invoke-TrackingMessageTraceQuery -Start $start -End $end -Sender $sender -Label 'MAIL FROM + período (pesquisa organizacional)'
        $attempts += $senderAttempt
        if ($senderAttempt.error) { $errors += $senderAttempt.error }
        $truncated = $truncated -or $senderAttempt.truncated
        $chunkCount += $senderAttempt.chunkCount
        $senderGlobalItems = @(Add-TrackingTraceAssociation $senderAttempt.items $addressRecords)
    }

    $combinedMailboxItems = @($mailboxQueryItems) + @($subjectGlobalItems | Where-Object { $_.isMailboxMatch }) + @($senderGlobalItems | Where-Object { $_.isMailboxMatch })
    $mailboxPool = @(
        $combinedMailboxItems |
            Sort-Object messageTraceId, recipient, messageId -Unique |
            Sort-Object receivedSort -Descending
    )

    $selectedItems = @()
    $matchLevel = 'notFound'
    $matchDescription = 'Nenhuma entrega foi localizada para os endereços associados à mailbox pesquisada.'

    if (-not [string]::IsNullOrWhiteSpace($messageId)) {
        $normalizedMessageId = $messageId.Trim('<', '>')
        $selectedItems = @($mailboxPool | Where-Object { ([string]$_.messageId).Trim('<', '>') -ieq $normalizedMessageId })
        if ($selectedItems.Count -gt 0) {
            $matchLevel = 'mailboxMessageId'
            $matchDescription = 'Entrega localizada para a mailbox pelo Message-ID.'
        }
    }

    if ($selectedItems.Count -eq 0) {
        $subjectMatches = @($mailboxPool)
        $senderMatches = @($mailboxPool)

        if (-not [string]::IsNullOrWhiteSpace($subject)) {
            $subjectMatches = @($mailboxPool | Where-Object { $_.subject -like "*$subject*" })
        }
        if (-not [string]::IsNullOrWhiteSpace($sender)) {
            $senderMatches = @($mailboxPool | Where-Object { $_.sender -ieq $sender })
        }

        $bothMatches = @($mailboxPool | Where-Object {
            ([string]::IsNullOrWhiteSpace($subject) -or $_.subject -like "*$subject*") -and
            ([string]::IsNullOrWhiteSpace($sender) -or $_.sender -ieq $sender)
        })

        if ($bothMatches.Count -gt 0) {
            $selectedItems = $bothMatches
            $matchLevel = 'mailboxRecipientSenderSubject'
            $matchDescription = 'Entrega localizada para um endereço associado à mailbox, com correspondência do MAIL FROM e do assunto.'
        }
        elseif (-not [string]::IsNullOrWhiteSpace($subject) -and $subjectMatches.Count -gt 0) {
            $selectedItems = $subjectMatches
            $matchLevel = 'mailboxRecipientSubject'
            $matchDescription = 'Entrega localizada para um endereço associado à mailbox e pelo assunto. O MAIL FROM pode ser diferente do From visível.'
        }
        elseif (-not [string]::IsNullOrWhiteSpace($sender) -and $senderMatches.Count -gt 0) {
            $selectedItems = $senderMatches
            $matchLevel = 'mailboxRecipientSender'
            $matchDescription = 'Entrega localizada para um endereço associado à mailbox e pelo MAIL FROM.'
        }
        elseif ([string]::IsNullOrWhiteSpace($subject) -and [string]::IsNullOrWhiteSpace($sender) -and $mailboxPool.Count -gt 0) {
            $selectedItems = $mailboxPool
            $matchLevel = 'mailboxRecipientOnly'
            $matchDescription = 'Mensagens localizadas para os endereços associados à mailbox no período.'
        }
    }

    $selectedItems = @($selectedItems | Select-Object -First 100)

    $otherItems = @()
    if ($subjectGlobalItems.Count -gt 0) {
        $otherItems = @($subjectGlobalItems | Where-Object {
            -not $_.isMailboxMatch -and
            ([string]::IsNullOrWhiteSpace($sender) -or $_.sender -ieq $sender)
        } | Select-Object -First 100)
    }
    elseif ($senderGlobalItems.Count -gt 0) {
        $otherItems = @($senderGlobalItems | Where-Object { -not $_.isMailboxMatch } | Select-Object -First 100)
    }

    $deliveryScope = 'none'
    $deliveryConfirmation = 'Não localizada para a mailbox'
    $matchedMailboxAddresses = @()

    if ($selectedItems.Count -gt 0) {
        $matchedMailboxAddresses = @($selectedItems | ForEach-Object { $_.recipient } | Where-Object { $_ } | Sort-Object -Unique)
        $scopes = @($selectedItems | ForEach-Object { $_.associationScope } | Sort-Object -Unique)

        if ($scopes -contains 'primary') {
            $deliveryScope = 'primary'
            $deliveryConfirmation = 'Confirmada para a mailbox'
            $matchDescription = "$matchDescription Destinatário confirmado: $($matchedMailboxAddresses -join '; ')."
        }
        elseif ($scopes -contains 'technical') {
            $deliveryScope = 'technical'
            $deliveryConfirmation = 'Confirmada por endereço técnico associado'
            $matchDescription = "$matchDescription O Exchange entregou para o endereço técnico associado: $($matchedMailboxAddresses -join '; ')."
        }
        else {
            $deliveryScope = 'alias'
            $deliveryConfirmation = 'Confirmada por alias associado'
            $matchDescription = "$matchDescription Alias associado confirmado: $($matchedMailboxAddresses -join '; ')."
        }
    }
    elseif ($otherItems.Count -gt 0) {
        $deliveryScope = 'otherRecipientsOnly'
        $deliveryConfirmation = 'Encontrada apenas para outros destinatários'
        $matchLevel = 'otherRecipientsOnly'
        $matchDescription = "O envio com o assunto/remetente informado foi localizado para $($otherItems.Count) outro(s) destinatário(s), mas não foi encontrada entrega para nenhum endereço associado à mailbox $recipient."
    }

    $details = @(Get-TrackingTraceDetails $selectedItems)
    $deliveryOutcome = Get-TraceDeliveryOutcome $selectedItems $details
    if ($deliveryScope -eq 'otherRecipientsOnly') { $deliveryOutcome = 'Sem entrega confirmada' }

    $actualSenders = @($selectedItems | ForEach-Object { $_.sender } | Where-Object { $_ } | Sort-Object -Unique)
    if ($actualSenders.Count -eq 0 -and $otherItems.Count -gt 0) {
        $actualSenders = @($otherItems | ForEach-Object { $_.sender } | Where-Object { $_ } | Sort-Object -Unique)
    }
    $actualRecipients = @($selectedItems | ForEach-Object { $_.recipient } | Where-Object { $_ } | Sort-Object -Unique)

    $attemptSummary = @()
    foreach ($attempt in $attempts) {
        $attemptSummary += [pscustomobject]@{
            label     = $attempt.label
            recipient = $attempt.recipient
            sender    = $attempt.sender
            subject   = $attempt.subject
            messageId = $attempt.messageId
            count     = $attempt.count
            error     = $attempt.error
            truncated = $attempt.truncated
        }
    }

    return [pscustomobject]@{
        items                    = $selectedItems
        otherItems               = $otherItems
        details                  = $details
        attempts                 = $attemptSummary
        error                    = (($errors | Where-Object { $_ }) -join ' | ')
        start                    = $start.ToString('yyyy-MM-dd HH:mm:ss')
        end                      = $end.ToString('yyyy-MM-dd HH:mm:ss')
        chunkCount               = $chunkCount
        truncated                = $truncated
        matchLevel               = $matchLevel
        matchDescription         = $matchDescription
        exactMatchCount          = @($selectedItems).Count
        candidateCount           = @($mailboxPool).Count
        deliveryOutcome          = $deliveryOutcome
        deliveryScope            = $deliveryScope
        deliveryConfirmation     = $deliveryConfirmation
        matchedMailboxAddresses  = $matchedMailboxAddresses
        inputSender              = $sender
        inputRecipient           = $recipient
        inputSubject             = $subject
        inputMessageId           = $messageId
        actualSenders            = $actualSenders
        actualRecipients         = $actualRecipients
        otherRecipientCount      = @($otherItems).Count
        mailboxAddresses         = @($addressMap.addresses)
        mailboxAddressRecords    = @($addressMap.addressRecords)
        mailboxPrimaryAddress    = [string]$addressMap.primarySmtpAddress
        mailboxDisplayName       = [string]$addressMap.displayName
        mailboxRecipientType     = [string]$addressMap.recipientTypeDetails
        addressResolutionError   = [string]$addressMap.error
        mailbox                  = [pscustomobject]@{
            identity = $recipient
            displayName = [string]$addressMap.displayName
            primarySmtpAddress = [string]$addressMap.primarySmtpAddress
            recipientTypeDetails = [string]$addressMap.recipientTypeDetails
            addresses = @($addressMap.addresses)
            addressRecords = @($addressMap.addressRecords)
            technicalAddresses = @($addressMap.technicalAddresses)
            addressResolutionError = [string]$addressMap.error
            error = ''
        }
    }
}

function Get-RulesData {
    param($PayloadObject)

    $mailbox = Get-Val $PayloadObject 'mailbox'

    if ([string]::IsNullOrWhiteSpace($mailbox)) {
        throw 'Mailbox não informada para a consulta de regras.'
    }

    $out = @()
    $errorMessage = ''

    try {
        $command = Get-Command Get-InboxRule -ErrorAction Stop
        $params = @{
            Mailbox     = $mailbox
            ErrorAction = 'Stop'
        }

        if ($command.Parameters.ContainsKey('IncludeHidden')) {
            $params['IncludeHidden'] = $true
        }

        $rules = @(Get-InboxRule @params)

        foreach ($rule in $rules) {
            $forwardTo = Convert-ToText $rule.ForwardTo
            $redirectTo = Convert-ToText $rule.RedirectTo
            $forwardAsAttachmentTo = Convert-ToText $rule.ForwardAsAttachmentTo
            $moveToFolder = Convert-ToText $rule.MoveToFolder
            $subjectContainsWords = Convert-ToText $rule.SubjectContainsWords
            $from = Convert-ToText $rule.From

            $actions = @()

            if ([bool]$rule.DeleteMessage) { $actions += 'Apaga mensagem' }
            if ([bool]$rule.SoftDeleteMessage) { $actions += 'Soft delete' }
            if ($moveToFolder) { $actions += "Move para: $moveToFolder" }
            if ($forwardTo) { $actions += "Encaminha para: $forwardTo" }
            if ($redirectTo) { $actions += "Redireciona para: $redirectTo" }
            if ($forwardAsAttachmentTo) { $actions += "Encaminha como anexo para: $forwardAsAttachmentTo" }
            if ([bool]$rule.MarkAsRead) { $actions += 'Marca como lida' }

            if ($actions.Count -eq 0) {
                $actions += 'Outra ação'
            }

            $conditions = @()
            if ($from) { $conditions += "De: $from" }
            if ($subjectContainsWords) { $conditions += "Assunto contém: $subjectContainsWords" }

            $isHidden = $false
            if ($rule.PSObject.Properties.Name -contains 'IsHidden') {
                $isHidden = [bool]$rule.IsHidden
            }

            $out += [pscustomobject]@{
                name                  = [string]$rule.Name
                enabled               = [string]$rule.Enabled
                priority              = [string]$rule.Priority
                description           = [string]$rule.Description
                from                  = $from
                subjectContainsWords  = $subjectContainsWords
                moveToFolder          = $moveToFolder
                deleteMessage         = [bool]$rule.DeleteMessage
                softDeleteMessage     = [bool]$rule.SoftDeleteMessage
                markAsRead            = [string]$rule.MarkAsRead
                forwardTo             = $forwardTo
                redirectTo            = $redirectTo
                forwardAsAttachmentTo = $forwardAsAttachmentTo
                stopProcessingRules   = [string]$rule.StopProcessingRules
                isHidden              = $isHidden
                actionSummary         = ($actions -join '; ')
                conditionSummary      = ($conditions -join '; ')
            }
        }
    }
    catch {
        $errorMessage = $_.Exception.Message
    }

    return [pscustomobject]@{
        items = $out
        error = $errorMessage
    }
}

function Get-AuditData {
    param($PayloadObject)

    $mailbox = Get-Val $PayloadObject 'mailbox'
    $start = To-Date (Get-Val $PayloadObject 'start')
    $end = To-Date (Get-Val $PayloadObject 'end')

    if ([string]::IsNullOrWhiteSpace($mailbox)) {
        throw 'Mailbox não informada para a auditoria.'
    }

    if (-not $start) {
        $start = (Get-Date).AddHours(-24)
    }

    if (-not $end) {
        $end = Get-Date
    }

    if ($start -ge $end) {
        throw 'A data inicial deve ser anterior à data final.'
    }

    $out = @()
    $errors = @()
    $logs = @()

    $operations = @(
        'HardDelete',
        'SoftDelete',
        'Move',
        'MoveToDeletedItems',
        'UpdateInboxRules',
        'New-InboxRule',
        'Set-InboxRule',
        'Remove-InboxRule'
    )

    $baseParams = @{
        StartDate   = $start
        EndDate     = $end
        Operations  = $operations
        ResultSize  = 5000
        ErrorAction = 'Stop'
    }

    try {
        $logs += @(Search-UnifiedAuditLog @baseParams -UserIds $mailbox)
    }
    catch {
        $errors += "Pesquisa por utilizador: $($_.Exception.Message)"
    }

    try {
        $logs += @(Search-UnifiedAuditLog @baseParams -FreeText $mailbox)
    }
    catch {
        $errors += "Pesquisa por conteúdo da mailbox: $($_.Exception.Message)"
    }

    $seen = @{}

    foreach ($log in $logs) {
        $auditDataRaw = [string]$log.AuditData
        $key = "{0}|{1}|{2}" -f [string]$log.CreationDate, [string]$log.Operations, $auditDataRaw

        if ($seen.ContainsKey($key)) {
            continue
        }

        $seen[$key] = $true

        $auditObject = $null
        try { $auditObject = $auditDataRaw | ConvertFrom-Json -ErrorAction Stop } catch {}

        $operation = [string]$log.Operations
        $actor = [string]$log.UserIds
        $mailboxOwner = ''
        $subject = ''
        $folder = ''
        $destinationFolder = ''
        $clientIp = ''
        $logonType = ''

        if ($auditObject) {
            if ($auditObject.PSObject.Properties.Name -contains 'Operation') {
                $operation = [string]$auditObject.Operation
            }

            if ($auditObject.PSObject.Properties.Name -contains 'UserId') {
                $actor = [string]$auditObject.UserId
            }

            if ($auditObject.PSObject.Properties.Name -contains 'MailboxOwnerUPN') {
                $mailboxOwner = [string]$auditObject.MailboxOwnerUPN
            }

            if ($auditObject.PSObject.Properties.Name -contains 'ClientIPAddress') {
                $clientIp = [string]$auditObject.ClientIPAddress
            }

            if ($auditObject.PSObject.Properties.Name -contains 'LogonType') {
                $logonType = [string]$auditObject.LogonType
            }

            try {
                if ($auditObject.Item) {
                    $subject = [string]$auditObject.Item.Subject
                }
            }
            catch {}

            try {
                if ($auditObject.Folder) {
                    $folder = [string]$auditObject.Folder.Path
                }
            }
            catch {}

            try {
                if ($auditObject.DestFolder) {
                    $destinationFolder = [string]$auditObject.DestFolder.Path
                }
            }
            catch {}
        }

        $out += [pscustomobject]@{
            creationDate     = [string]$log.CreationDate
            operation        = $operation
            actor            = $actor
            mailboxOwner     = $mailboxOwner
            subject          = $subject
            folder           = $folder
            destinationFolder = $destinationFolder
            clientIp         = $clientIp
            logonType        = $logonType
            objectId         = Convert-ToText $log.ObjectIds
            auditData        = $auditDataRaw
        }
    }

    $out = @($out | Sort-Object creationDate -Descending)

    return [pscustomobject]@{
        items     = $out
        error     = ($errors -join ' | ')
        truncated = (@($logs).Count -ge 5000)
        start     = $start.ToString('yyyy-MM-dd HH:mm:ss')
        end       = $end.ToString('yyyy-MM-dd HH:mm:ss')
    }
}

function Build-Result {
    param($PayloadObject)

    $mailbox = Get-MailboxData $PayloadObject
    $trace = Get-TraceData $PayloadObject
    $rules = Get-RulesData $PayloadObject
    $audit = Get-AuditData $PayloadObject

    $deleteRules = @($rules.items | Where-Object { $_.deleteMessage -eq $true -or $_.softDeleteMessage -eq $true })
    $forwardRules = @($rules.items | Where-Object { $_.forwardTo -or $_.redirectTo -or $_.forwardAsAttachmentTo })
    $moveRules = @($rules.items | Where-Object { $_.moveToFolder })
    $hiddenRules = @($rules.items | Where-Object { $_.isHidden -eq $true })
    $alerts = @()

    if ($mailbox.error) {
        $alerts += [pscustomobject]@{ level = 'warning'; title = 'Erro ao consultar mailbox'; message = $mailbox.error }
    }

    if ($mailbox.addressResolutionError -or $trace.addressResolutionError) {
        $resolutionError = ((@($mailbox.addressResolutionError, $trace.addressResolutionError) | Where-Object { $_ }) -join ' | ')
        $alerts += [pscustomobject]@{ level = 'warning'; title = 'Mapeamento de endereços incompleto'; message = $resolutionError }
    }

    if ($mailbox.hasForwarding) {
        $alerts += [pscustomobject]@{ level = 'danger'; title = 'Forwarding ativo na mailbox'; message = "Destino: $($mailbox.forwardingAddress) $($mailbox.forwardingSmtpAddress). DeliverToMailboxAndForward: $($mailbox.deliverToMailboxAndForward)." }
    }

    if ($trace.deliveryScope -eq 'none') {
        $alerts += [pscustomobject]@{
            level = 'danger'
            title = 'Entrega não localizada para a mailbox'
            message = $trace.matchDescription
        }
    }
    elseif ($trace.deliveryScope -eq 'otherRecipientsOnly') {
        $alerts += [pscustomobject]@{
            level = 'warning'
            title = 'Envio localizado apenas para outros destinatários'
            message = $trace.matchDescription
        }
    }
    else {
        $outcomeLevel = 'success'
        if ($trace.deliveryOutcome -in @('Falha', 'Quarentena')) { $outcomeLevel = 'danger' }
        elseif ($trace.deliveryOutcome -in @('Pendente', 'Spam/Junk', 'Expandido')) { $outcomeLevel = 'warning' }

        $alerts += [pscustomobject]@{
            level = $outcomeLevel
            title = "$($trace.deliveryConfirmation): $($trace.deliveryOutcome)"
            message = $trace.matchDescription
        }
    }

    if ($trace.inputSender -and @($trace.actualSenders).Count -gt 0 -and -not (@($trace.actualSenders) -contains $trace.inputSender)) {
        $alerts += [pscustomobject]@{
            level = 'warning'
            title = 'Remetente SMTP diferente do From visível'
            message = "O comprovativo informa From $($trace.inputSender), mas o Message Trace registou MAIL FROM: $(@($trace.actualSenders) -join '; ')."
        }
    }

    if ($deleteRules.Count -gt 0) {
        $alerts += [pscustomobject]@{ level = 'danger'; title = 'Regras que eliminam mensagens'; message = "Foram encontradas $($deleteRules.Count) regra(s) com eliminação direta ou soft delete." }
    }
    if ($forwardRules.Count -gt 0) {
        $alerts += [pscustomobject]@{ level = 'warning'; title = 'Regras de encaminhamento/redirecionamento'; message = "Foram encontradas $($forwardRules.Count) regra(s) que encaminham ou redirecionam mensagens." }
    }
    if ($moveRules.Count -gt 0) {
        $alerts += [pscustomobject]@{ level = 'warning'; title = 'Regras que movem mensagens'; message = "Foram encontradas $($moveRules.Count) regra(s) que movem mensagens para outras pastas." }
    }
    if ($hiddenRules.Count -gt 0) {
        $alerts += [pscustomobject]@{ level = 'warning'; title = 'Regras ocultas encontradas'; message = "Foram encontradas $($hiddenRules.Count) regra(s) ocultas na mailbox." }
    }
    if ($trace.error) {
        $alerts += [pscustomobject]@{ level = 'warning'; title = 'Message Trace com erro parcial ou total'; message = $trace.error }
    }
    if ($trace.truncated) {
        $alerts += [pscustomobject]@{ level = 'warning'; title = 'Message Trace pode estar truncado'; message = 'Pelo menos uma pesquisa atingiu o limite de 5.000 resultados.' }
    }
    if ($rules.error) {
        $alerts += [pscustomobject]@{ level = 'warning'; title = 'Consulta de regras com erro'; message = $rules.error }
    }
    if ($audit.error) {
        $alerts += [pscustomobject]@{ level = 'warning'; title = 'Auditoria com erro parcial ou total'; message = $audit.error }
    }
    if (@($audit.items).Count -eq 0 -and -not $audit.error) {
        $alerts += [pscustomobject]@{ level = 'success'; title = 'Sem eventos encontrados na auditoria'; message = 'Não foram encontrados eventos correspondentes nas pesquisas de auditoria disponíveis para o período informado.' }
    }

    $analysisStatus = 'success'
    if (@($alerts | Where-Object { $_.level -eq 'danger' }).Count -gt 0) { $analysisStatus = 'danger' }
    elseif (@($alerts | Where-Object { $_.level -eq 'warning' }).Count -gt 0) { $analysisStatus = 'warning' }

    $recommendation = @"
RECOMENDAÇÃO AUTOMÁTICA

1. Confirmar primeiro o card Entrega à mailbox e o endereço associado usado pelo Exchange.
2. Se a entrega ocorreu por endereço técnico híbrido, tratar esse resultado como entrega da mesma mailbox.
3. As mensagens de outros destinatários do mesmo envio são apenas contexto e não devem alterar o diagnóstico da mailbox pesquisada.
4. Se a entrega estiver confirmada, rever a pasta indicada no último evento, Junk/Spam, Quarentena e as regras da mailbox.
5. Se não houver entrega para nenhum endereço associado, validar o destinatário do comprovativo e o Message-ID.
"@

    $data = [pscustomobject]@{
        analysisComplete = $true
        analysisStatus   = $analysisStatus
        generatedAt      = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
        mailbox          = $mailbox
        traces           = $trace.items
        relatedTraces    = $trace.otherItems
        traceDetails     = $trace.details
        traceAttempts    = $trace.attempts
        rules            = $rules.items
        audits           = $audit.items
        summary          = [pscustomobject]@{
            traceCount                   = @($trace.items).Count
            traceExactMatchCount         = $trace.exactMatchCount
            traceCandidateCount          = $trace.candidateCount
            traceMatchLevel              = $trace.matchLevel
            traceMatchDescription        = $trace.matchDescription
            traceDeliveryOutcome         = $trace.deliveryOutcome
            traceDeliveryScope           = $trace.deliveryScope
            traceDeliveryConfirmation    = $trace.deliveryConfirmation
            traceMatchedMailboxAddresses = $trace.matchedMailboxAddresses
            traceMailboxAddresses        = $trace.mailboxAddresses
            traceMailboxAddressRecords   = $trace.mailboxAddressRecords
            traceOtherRecipientCount     = $trace.otherRecipientCount
            traceInputSender             = $trace.inputSender
            traceInputRecipient          = $trace.inputRecipient
            traceInputSubject            = $trace.inputSubject
            traceInputMessageId          = $trace.inputMessageId
            traceActualSenders           = $trace.actualSenders
            traceActualRecipients        = $trace.actualRecipients
            traceAddressResolutionError  = $trace.addressResolutionError
            traceError                   = $trace.error
            traceTruncated               = $trace.truncated
            traceChunkCount              = $trace.chunkCount
            rulesCount                   = @($rules.items).Count
            deleteRulesCount             = $deleteRules.Count
            forwardRulesCount            = $forwardRules.Count
            moveRulesCount               = $moveRules.Count
            hiddenRulesCount             = $hiddenRules.Count
            auditCount                   = @($audit.items).Count
            rulesError                   = $rules.error
            auditError                   = $audit.error
            auditTruncated               = $audit.truncated
        }
        diagnosis        = [pscustomobject]@{
            alerts         = $alerts
            recommendation = $recommendation.Trim()
        }
    }

    $message = "Análise concluída para $($mailbox.identity)."
    if ($analysisStatus -ne 'success') { $message = "Análise concluída com avisos para $($mailbox.identity)." }
    return [pscustomobject]@{ message = $message; data = $data }
}

$payloadObject = ConvertFrom-JsonSafe $payload

if ([string]::IsNullOrWhiteSpace($action)) {
    $payloadAction = Get-Val $payloadObject 'action'
    if ($payloadAction) {
        $action = $payloadAction
    }
}

switch ($action) {
    'checkExchange' {
        $test = Test-TrackingEmailExchangeOnline
        Write-JsonResponse $test.success $test.message $null $test.connected
        return
    }

    'connectExchange' {
        try {
            $message = Connect-EXO $payloadObject
            Write-JsonResponse $true $message $null $true
        }
        catch {
            Write-JsonResponse $false $_.Exception.Message $null $false
        }
        return
    }

    'lerMsgOutlook' {
        try {
            $result = Read-MsgOutlook $payloadObject
            Write-JsonResponse $true 'Ficheiro .MSG lido com sucesso.' $result $false
        }
        catch {
            Write-JsonResponse $false $_.Exception.Message $null $false
        }
        return
    }

    'resolverDestinatarioExo' {
        try {
            Ensure-ExchangeReady | Out-Null
            $result = Resolve-RecipientExo $payloadObject
            Write-JsonResponse $true $result.message $result $true
        }
        catch {
            Write-JsonResponse $false $_.Exception.Message $null $false
        }
        return
    }

    'resolverSolicitante' {
        $exchangeConnected = $true
        try { Ensure-ExchangeReady | Out-Null } catch { $exchangeConnected = $false }
        $result = Resolve-Solicitante $payloadObject
        Write-JsonResponse $true 'Solicitante resolvido.' $result $exchangeConnected
        return
    }

    'analiseCompleta' {
        try {
            Ensure-ExchangeReady | Out-Null
            $result = Build-Result $payloadObject
            Write-JsonResponse $true $result.message $result.data $true
        }
        catch {
            Write-JsonResponse $false $_.Exception.Message $null $false
        }
        return
    }

    'messageTrace' {
        try {
            Ensure-ExchangeReady | Out-Null
            $trace = Get-TraceData $payloadObject

            $alerts = @()
            $level = 'success'

            if ($trace.deliveryScope -eq 'none') {
                $level = 'danger'
                $alerts += [pscustomobject]@{ level = 'danger'; title = 'Entrega não localizada para a mailbox'; message = $trace.matchDescription }
            }
            elseif ($trace.deliveryScope -eq 'otherRecipientsOnly') {
                $level = 'warning'
                $alerts += [pscustomobject]@{ level = 'warning'; title = 'Envio localizado apenas para outros destinatários'; message = $trace.matchDescription }
            }
            else {
                if ($trace.deliveryOutcome -in @('Falha', 'Quarentena')) { $level = 'danger' }
                elseif ($trace.deliveryOutcome -in @('Pendente', 'Spam/Junk', 'Expandido')) { $level = 'warning' }
                $alerts += [pscustomobject]@{ level = $level; title = "$($trace.deliveryConfirmation): $($trace.deliveryOutcome)"; message = $trace.matchDescription }
            }

            if ($trace.addressResolutionError) {
                $alerts += [pscustomobject]@{ level = 'warning'; title = 'Mapeamento de endereços incompleto'; message = $trace.addressResolutionError }
                if ($level -eq 'success') { $level = 'warning' }
            }

            if ($trace.inputSender -and @($trace.actualSenders).Count -gt 0 -and -not (@($trace.actualSenders) -contains $trace.inputSender)) {
                $alerts += [pscustomobject]@{ level = 'warning'; title = 'MAIL FROM diferente'; message = "Remetente(s) registado(s) no transporte: $(@($trace.actualSenders) -join '; ')" }
                if ($level -eq 'success') { $level = 'warning' }
            }

            Write-JsonResponse $true 'Rastreio da mailbox concluído.' ([pscustomobject]@{
                partialType   = 'messageTrace'
                analysisStatus = $level
                mailbox       = $trace.mailbox
                traces        = $trace.items
                relatedTraces = $trace.otherItems
                traceDetails  = $trace.details
                traceAttempts = $trace.attempts
                diagnosis     = [pscustomobject]@{ alerts = $alerts; recommendation = 'Considere apenas as mensagens confirmadas para os endereços associados à mailbox. Os outros destinatários são apresentados separadamente como contexto.' }
                summary       = [pscustomobject]@{
                    traceCount                   = @($trace.items).Count
                    traceExactMatchCount         = $trace.exactMatchCount
                    traceCandidateCount          = $trace.candidateCount
                    traceMatchLevel              = $trace.matchLevel
                    traceMatchDescription        = $trace.matchDescription
                    traceDeliveryOutcome         = $trace.deliveryOutcome
                    traceDeliveryScope           = $trace.deliveryScope
                    traceDeliveryConfirmation    = $trace.deliveryConfirmation
                    traceMatchedMailboxAddresses = $trace.matchedMailboxAddresses
                    traceMailboxAddresses        = $trace.mailboxAddresses
                    traceMailboxAddressRecords   = $trace.mailboxAddressRecords
                    traceOtherRecipientCount     = $trace.otherRecipientCount
                    traceInputSender             = $trace.inputSender
                    traceInputRecipient          = $trace.inputRecipient
                    traceInputSubject            = $trace.inputSubject
                    traceInputMessageId          = $trace.inputMessageId
                    traceActualSenders           = $trace.actualSenders
                    traceActualRecipients        = $trace.actualRecipients
                    traceAddressResolutionError  = $trace.addressResolutionError
                    traceError                   = $trace.error
                    traceTruncated               = $trace.truncated
                    traceChunkCount               = $trace.chunkCount
                }
            }) $true
        }
        catch {
            Write-JsonResponse $false $_.Exception.Message $null $false
        }
        return
    }

    'regras' {
        try {
            Ensure-ExchangeReady | Out-Null
            $rules = Get-RulesData $payloadObject
            $deleteRules = @($rules.items | Where-Object { $_.deleteMessage -eq $true -or $_.softDeleteMessage -eq $true })
            $forwardRules = @($rules.items | Where-Object { $_.forwardTo -or $_.redirectTo -or $_.forwardAsAttachmentTo })
            $moveRules = @($rules.items | Where-Object { $_.moveToFolder })
            $hiddenRules = @($rules.items | Where-Object { $_.isHidden -eq $true })

            Write-JsonResponse $true 'Consulta de regras concluída.' ([pscustomobject]@{
                partialType = 'rules'
                rules       = $rules.items
                summary     = [pscustomobject]@{
                    rulesCount        = @($rules.items).Count
                    deleteRulesCount  = $deleteRules.Count
                    forwardRulesCount = $forwardRules.Count
                    moveRulesCount    = $moveRules.Count
                    hiddenRulesCount  = $hiddenRules.Count
                    rulesError        = $rules.error
                }
            }) $true
        }
        catch {
            Write-JsonResponse $false $_.Exception.Message $null $false
        }
        return
    }

    'auditoria' {
        try {
            Ensure-ExchangeReady | Out-Null
            $audit = Get-AuditData $payloadObject
            Write-JsonResponse $true 'Consulta de auditoria concluída.' ([pscustomobject]@{
                partialType = 'audit'
                audits      = $audit.items
                summary     = [pscustomobject]@{
                    auditCount     = @($audit.items).Count
                    auditError     = $audit.error
                    auditTruncated = $audit.truncated
                }
            }) $true
        }
        catch {
            Write-JsonResponse $false $_.Exception.Message $null $false
        }
        return
    }

    default {
        Write-JsonResponse $false "Ação inválida: $action" $null $false
        return
    }
}
