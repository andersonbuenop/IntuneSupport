#requires -Version 5.1
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-CibProperty {
    param(
        [Parameter(Mandatory = $false)]$Object,
        [Parameter(Mandatory = $true)][string]$Name,
        $Default = $null
    )

    if ($null -eq $Object) { return $Default }

    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $Default
    }

    $property = $Object.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
    return $Default
}

function Get-CibVariableValue {
    param([Parameter(Mandatory = $true)][string[]]$Names)

    foreach ($name in $Names) {
        foreach ($scope in @(0,1,2,3,4,5,'Script','Global')) {
            try {
                $variable = Get-Variable -Name $name -Scope $scope -ErrorAction SilentlyContinue
                if ($null -ne $variable -and $null -ne $variable.Value) {
                    return $variable.Value
                }
            }
            catch {}
        }
    }

    return $null
}

function Get-CibBodyObject {
    $raw = Get-CibVariableValue -Names @('payload','Payload','body','Body','requestBody','RequestBody','json','JsonBody')

    if ($raw -and -not ($raw -is [string])) {
        return $raw
    }

    if ([string]::IsNullOrWhiteSpace([string]$raw)) {
        $request = Get-CibVariableValue -Names @('Request','request')
        if ($request) {
            foreach ($propertyName in @('Body','RawBody','Content')) {
                try {
                    $candidate = Get-CibProperty -Object $request -Name $propertyName
                    if (-not [string]::IsNullOrWhiteSpace([string]$candidate)) {
                        $raw = [string]$candidate
                        break
                    }
                }
                catch {}
            }

            if ([string]::IsNullOrWhiteSpace([string]$raw)) {
                try {
                    if ($request.InputStream) {
                        $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8, $true, 1024, $true)
                        $raw = $reader.ReadToEnd()
                        $reader.Dispose()
                    }
                }
                catch {}
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace([string]$raw)) { return $null }

    try { return ([string]$raw | ConvertFrom-Json) }
    catch { return $null }
}

function Get-CibAction {
    param($Body)

    $actionValue = Get-CibVariableValue -Names @('action','Action')
    if (-not [string]::IsNullOrWhiteSpace([string]$actionValue)) {
        return [string]$actionValue
    }

    $query = Get-CibVariableValue -Names @('Query','query')
    if ($query) {
        try {
            $queryAction = Get-CibProperty -Object $query -Name 'action'
            if (-not [string]::IsNullOrWhiteSpace([string]$queryAction)) {
                return [string]$queryAction
            }
        }
        catch {}
    }

    $request = Get-CibVariableValue -Names @('Request','request')
    if ($request) {
        try {
            $queryAction = $request.QueryString['action']
            if (-not [string]::IsNullOrWhiteSpace([string]$queryAction)) {
                return [string]$queryAction
            }
        }
        catch {}
    }

    $bodyAction = Get-CibProperty -Object $Body -Name 'action'
    if (-not [string]::IsNullOrWhiteSpace([string]$bodyAction)) {
        return [string]$bodyAction
    }

    return ''
}

function Send-CibJson {
    param([Parameter(Mandatory = $true)]$Data)
    $Data | ConvertTo-Json -Depth 40 -Compress
}

$script:CibSavedUsersPath = Join-Path -Path $PSScriptRoot -ChildPath 'saved-users.json'
$script:CibEmailSettingsPath = Join-Path -Path $PSScriptRoot -ChildPath 'email-settings.json'

function ConvertTo-CibUniqueUsers {
    param($Values)

    $seen = @{}
    $output = @()

    foreach ($value in @($Values)) {
        if ($null -eq $value) {
            continue
        }

        $items = @([string]$value -split '[\r\n,;]+')
        foreach ($item in $items) {
            $clean = ([string]$item).Trim()
            if ([string]::IsNullOrWhiteSpace($clean)) {
                continue
            }

            $key = $clean.ToLowerInvariant()
            if (-not $seen.ContainsKey($key)) {
                $seen.Add($key, $true)
                $output += $clean
            }
        }
    }

    return @($output)
}

function Get-CibSavedUsers {
    $users = @()
    $updatedAt = ''

    if (Test-Path -LiteralPath $script:CibSavedUsersPath -PathType Leaf) {
        try {
            $raw = Get-Content -LiteralPath $script:CibSavedUsersPath -Raw -Encoding UTF8

            if (-not [string]::IsNullOrWhiteSpace([string]$raw)) {
                $data = $raw | ConvertFrom-Json
                $savedValues = Get-CibProperty -Object $data -Name 'users' -Default @()
                $users = @(ConvertTo-CibUniqueUsers -Values $savedValues)
                $updatedAt = [string](Get-CibProperty -Object $data -Name 'updatedAt' -Default '')
            }
        }
        catch {
            throw ('Não foi possível ler a lista guardada: ' + $_.Exception.Message)
        }
    }

    $userCount = @($users).Count

    return [pscustomobject]@{
        success = $true
        users = @($users)
        count = $userCount
        updatedAt = $updatedAt
        path = $script:CibSavedUsersPath
    }
}

function Save-CibSavedUsers {
    param($Body)

    $bodyUsers = Get-CibProperty -Object $Body -Name 'users' -Default @()
    $users = @(ConvertTo-CibUniqueUsers -Values $bodyUsers)
    $updatedAt = (Get-Date).ToString('o')
    $userCount = @($users).Count

    $data = [ordered]@{
        version = 1
        updatedAt = $updatedAt
        users = @($users)
    }

    $directory = Split-Path -Parent $script:CibSavedUsersPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $temporaryPath = $script:CibSavedUsersPath + '.tmp'
    $json = $data | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText(
        $temporaryPath,
        [string]$json,
        [System.Text.Encoding]::UTF8
    )
    Move-Item -LiteralPath $temporaryPath -Destination $script:CibSavedUsersPath -Force

    return [pscustomobject]@{
        success = $true
        message = 'Lista de utilizadores guardada com sucesso.'
        users = @($users)
        count = $userCount
        updatedAt = $updatedAt
        path = $script:CibSavedUsersPath
    }
}


function ConvertTo-CibRecipientString {
    [CmdletBinding()]
    param($Value)

    if ($null -eq $Value) {
        return ''
    }

    $raw = ''

    if (
        $Value -is [System.Collections.IEnumerable] -and
        -not ($Value -is [string])
    ) {
        $raw = @(
            $Value |
                ForEach-Object {
                    [string]$_
                }
        ) -join ';'
    }
    else {
        $raw = [string]$Value
    }

    if ([string]::IsNullOrWhiteSpace($raw)) {
        return ''
    }

    $raw = $raw.Replace("`r`n", "`n").Replace("`r", "`n")

    $raw = [regex]::Replace(
        $raw,
        '[,\n]+',
        ';'
    )

    # Corrige listas antigas que ficaram sem separador.
    $raw = [regex]::Replace(
        $raw,
        '(?i)(\.(?:pt|com|net|org|eu|es|fr|de|it|nl|be|co\.uk))(?=[a-z0-9._%+\-]+@)',
        '$1;'
    )

    $unique = New-Object `
        'System.Collections.Generic.Dictionary[string,string]' `
        ([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($part in ($raw -split ';+')) {
        $recipient = ([string]$part).Trim()

        if ([string]::IsNullOrWhiteSpace($recipient)) {
            continue
        }

        if ($recipient -match '<([^<>@\s]+@[^<>\s]+)>') {
            $recipient = $Matches[1].Trim()
        }

        if (-not $unique.ContainsKey($recipient)) {
            $unique.Add($recipient, $recipient)
        }
    }

    return (@($unique.Values) -join '; ')
}

function Get-CibEmailSettings {
    $to = ''
    $cc = ''
    $updatedAt = ''

    if (Test-Path -LiteralPath $script:CibEmailSettingsPath -PathType Leaf) {
        try {
            $raw = Get-Content -LiteralPath $script:CibEmailSettingsPath -Raw -Encoding UTF8
            if (-not [string]::IsNullOrWhiteSpace([string]$raw)) {
                $data = $raw | ConvertFrom-Json
                $to = ConvertTo-CibRecipientString (Get-CibProperty -Object $data -Name 'to' -Default '')
                $cc = ConvertTo-CibRecipientString (Get-CibProperty -Object $data -Name 'cc' -Default '')
                $updatedAt = [string](Get-CibProperty -Object $data -Name 'updatedAt' -Default '')
            }
        }
        catch {
            throw ('Não foi possível ler os destinatários guardados: ' + $_.Exception.Message)
        }
    }

    return [pscustomobject]@{
        success = $true
        to = $to
        cc = $cc
        updatedAt = $updatedAt
        path = $script:CibEmailSettingsPath
    }
}

function Save-CibEmailSettings {
    param($Body)

    $to = ConvertTo-CibRecipientString (Get-CibProperty -Object $Body -Name 'to' -Default '')
    $cc = ConvertTo-CibRecipientString (Get-CibProperty -Object $Body -Name 'cc' -Default '')
    $updatedAt = (Get-Date).ToString('o')

    $data = [ordered]@{
        version = 1
        updatedAt = $updatedAt
        to = $to
        cc = $cc
    }

    $directory = Split-Path -Parent $script:CibEmailSettingsPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }

    $temporaryPath = $script:CibEmailSettingsPath + '.tmp'
    $json = $data | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText(
        $temporaryPath,
        [string]$json,
        [System.Text.Encoding]::UTF8
    )
    Move-Item -LiteralPath $temporaryPath -Destination $script:CibEmailSettingsPath -Force

    return [pscustomobject]@{
        success = $true
        message = 'Destinatários guardados com sucesso.'
        to = $to
        cc = $cc
        updatedAt = $updatedAt
        path = $script:CibEmailSettingsPath
    }
}

function Get-CibGraphStatus {
    try {
        Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
        $context = Get-MgContext

        if (-not $context -or [string]::IsNullOrWhiteSpace([string]$context.Account)) {
            return [pscustomobject]@{
                connected = $false
                account = ''
                tenantId = ''
                scopes = @()
            }
        }

        return [pscustomobject]@{
            connected = $true
            account = [string]$context.Account
            tenantId = [string]$context.TenantId
            scopes = @($context.Scopes)
        }
    }
    catch {
        return [pscustomobject]@{
            connected = $false
            account = ''
            tenantId = ''
            scopes = @()
        }
    }
}

function Connect-CibGraph {
    Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
    $scopes = @(
        'User.Read.All',
        'Directory.Read.All',
        'DeviceManagementManagedDevices.Read.All'
    )

    Connect-MgGraph -Scopes $scopes -NoWelcome -ErrorAction Stop | Out-Null
    return Get-CibGraphStatus
}

function Assert-CibGraph {
    $status = Get-CibGraphStatus
    if (-not $status.connected) {
        throw 'Microsoft Graph não está ligado. Clique primeiro em Conectar Graph/Intune.'
    }

    if (-not (Get-Command Invoke-MgGraphRequest -ErrorAction SilentlyContinue)) {
        throw 'Invoke-MgGraphRequest não está disponível nesta sessão.'
    }

    return $status
}

function Invoke-CibGraphGet {
    param([Parameter(Mandatory = $true)][string]$Uri)

    $items = New-Object System.Collections.ArrayList
    $next = $Uri
    $isCollection = $false

    while (-not [string]::IsNullOrWhiteSpace($next)) {
        $response = Invoke-MgGraphRequest -Method GET -Uri $next -OutputType PSObject -ErrorAction Stop
        $value = Get-CibProperty -Object $response -Name 'value'

        if ($null -ne $value) {
            $isCollection = $true
            foreach ($item in @($value)) { [void]$items.Add($item) }
            $next = [string](Get-CibProperty -Object $response -Name '@odata.nextLink' -Default '')
        }
        else {
            return $response
        }
    }

    if ($isCollection) { return @($items.ToArray()) }
    return @()
}

function ConvertTo-CibODataLiteral {
    param([string]$Value)
    if ($null -eq $Value) { return '' }
    return $Value.Replace("'", "''")
}

function ConvertTo-CibLocalDate {
    param($Value)
    if ([string]::IsNullOrWhiteSpace([string]$Value)) { return '' }

    try {
        $date = [DateTimeOffset]::Parse([string]$Value)
        return $date.ToLocalTime().ToString('dd/MM/yyyy HH:mm')
    }
    catch { return [string]$Value }
}

function Get-CibDaysWithoutSync {
    param($Value)
    if ([string]::IsNullOrWhiteSpace([string]$Value)) { return $null }

    try {
        $date = [DateTimeOffset]::Parse([string]$Value)
        $days = [math]::Floor(([DateTimeOffset]::UtcNow - $date.ToUniversalTime()).TotalDays)
        if ($days -lt 0) { $days = 0 }
        return [int]$days
    }
    catch { return $null }
}

function ConvertTo-CibStorageDisplay {
    param($Value)
    if ($null -eq $Value -or [string]::IsNullOrWhiteSpace([string]$Value)) { return '' }

    try {
        $bytes = [double]$Value
        if ($bytes -le 0) { return '0 GB' }
        return ('{0:N2} GB' -f ($bytes / 1GB))
    }
    catch { return [string]$Value }
}

function Find-CibUser {
    param([Parameter(Mandatory = $true)][string]$InputValue)

    $inputClean = $InputValue.Trim()
    $select = @(
        'id','displayName','userPrincipalName','mail','mailNickname','employeeId',
        'jobTitle','department','companyName','officeLocation','accountEnabled',
        'createdDateTime','onPremisesSyncEnabled','onPremisesLastSyncDateTime',
        'onPremisesSamAccountName','onPremisesDomainName','onPremisesDistinguishedName',
        'mobilePhone','businessPhones'
    ) -join ','

    if ($inputClean -match '^[0-9a-fA-F-]{36}$' -or $inputClean.Contains('@')) {
        try {
            $encoded = [uri]::EscapeDataString($inputClean)
            $direct = Invoke-CibGraphGet -Uri "https://graph.microsoft.com/v1.0/users/$encoded?`$select=$select"
            if ($direct) { return $direct }
        }
        catch {}
    }

    $literal = ConvertTo-CibODataLiteral -Value $inputClean
    $filter = "userPrincipalName eq '$literal' or mail eq '$literal' or mailNickname eq '$literal' or employeeId eq '$literal'"
    $filterEncoded = [uri]::EscapeDataString($filter)
    $exact = @(Invoke-CibGraphGet -Uri "https://graph.microsoft.com/v1.0/users?`$filter=$filterEncoded&`$select=$select&`$top=5")

    if ($exact.Count -gt 0) { return $exact[0] }

    $prefixFilter = "startswith(userPrincipalName,'$literal') or startswith(mail,'$literal') or startswith(displayName,'$literal')"
    $prefixEncoded = [uri]::EscapeDataString($prefixFilter)
    $prefix = @(Invoke-CibGraphGet -Uri "https://graph.microsoft.com/v1.0/users?`$filter=$prefixEncoded&`$select=$select&`$top=5")

    if ($prefix.Count -eq 1) { return $prefix[0] }
    if ($prefix.Count -gt 1) {
        $preferred = @($prefix | Where-Object {
            ([string](Get-CibProperty $_ 'mailNickname')).Equals($inputClean, [System.StringComparison]::OrdinalIgnoreCase) -or
            ([string](Get-CibProperty $_ 'employeeId')).Equals($inputClean, [System.StringComparison]::OrdinalIgnoreCase)
        })
        if ($preferred.Count -gt 0) { return $preferred[0] }
    }

    return $null
}

function Get-CibManager {
    param([Parameter(Mandatory = $true)][string]$UserId)

    try {
        $manager = Invoke-CibGraphGet -Uri "https://graph.microsoft.com/v1.0/users/$UserId/manager?`$select=id,displayName,userPrincipalName,mail"
        return [pscustomobject]@{
            displayName = [string](Get-CibProperty $manager 'displayName' '')
            userPrincipalName = [string](Get-CibProperty $manager 'userPrincipalName' '')
            mail = [string](Get-CibProperty $manager 'mail' '')
        }
    }
    catch {
        return [pscustomobject]@{
            displayName = ''
            userPrincipalName = ''
            mail = ''
        }
    }
}

function Get-CibManagedDevices {
    param(
        [Parameter(Mandatory = $true)][string]$UserId,
        [Parameter(Mandatory = $true)][string]$UserPrincipalName
    )

    $select = @(
        'id','userId','deviceName','managedDeviceName','userPrincipalName','userDisplayName','emailAddress',
        'operatingSystem','osVersion','manufacturer','model','serialNumber','imei','phoneNumber',
        'subscriberCarrier','wiFiMacAddress','complianceState','complianceGracePeriodExpirationDateTime',
        'managementState','managementAgent','managedDeviceOwnerType','deviceEnrollmentType','enrolledDateTime',
        'lastSyncDateTime','isEncrypted','isSupervised','jailBroken','deviceRegistrationState','azureADRegistered',
        'azureADDeviceId','deviceCategoryDisplayName','partnerReportedThreatState','androidSecurityPatchLevel',
        'totalStorageSpaceInBytes','freeStorageSpaceInBytes'
    ) -join ','

    $filter = [uri]::EscapeDataString("userId eq '$UserId'")

    try {
        return @(Invoke-CibGraphGet -Uri "https://graph.microsoft.com/beta/deviceManagement/managedDevices?`$filter=$filter&`$select=$select")
    }
    catch {
        if ([string]::IsNullOrWhiteSpace($UserPrincipalName)) { throw }
        $upnLiteral = ConvertTo-CibODataLiteral -Value $UserPrincipalName
        $upnFilter = [uri]::EscapeDataString("userPrincipalName eq '$upnLiteral'")
        return @(Invoke-CibGraphGet -Uri "https://graph.microsoft.com/beta/deviceManagement/managedDevices?`$filter=$upnFilter&`$select=$select")
    }
}

function New-CibRow {
    param(
        [Parameter(Mandatory = $true)][string]$InputValue,
        $User,
        $Manager,
        $Device,
        [string]$UserError = ''
    )

    $userFound = $null -ne $User
    $deviceFound = $null -ne $Device
    $lastSyncRaw = if ($deviceFound) { Get-CibProperty $Device 'lastSyncDateTime' } else { $null }

    return [pscustomobject]@{
        input = $InputValue
        userFound = $userFound
        userError = $UserError
        userId = if ($userFound) { [string](Get-CibProperty $User 'id' '') } else { '' }
        userDisplayName = if ($userFound) { [string](Get-CibProperty $User 'displayName' '') } else { '' }
        userPrincipalName = if ($userFound) { [string](Get-CibProperty $User 'userPrincipalName' '') } else { '' }
        userMail = if ($userFound) { [string](Get-CibProperty $User 'mail' '') } else { '' }
        employeeId = if ($userFound) { [string](Get-CibProperty $User 'employeeId' '') } else { '' }
        onPremisesSamAccountName = if ($userFound) { [string](Get-CibProperty $User 'onPremisesSamAccountName' '') } else { '' }
        accountEnabled = if ($userFound) { Get-CibProperty $User 'accountEnabled' } else { $null }
        jobTitle = if ($userFound) { [string](Get-CibProperty $User 'jobTitle' '') } else { '' }
        department = if ($userFound) { [string](Get-CibProperty $User 'department' '') } else { '' }
        companyName = if ($userFound) { [string](Get-CibProperty $User 'companyName' '') } else { '' }
        officeLocation = if ($userFound) { [string](Get-CibProperty $User 'officeLocation' '') } else { '' }
        managerDisplayName = if ($Manager) { [string](Get-CibProperty $Manager 'displayName' '') } else { '' }
        managerUserPrincipalName = if ($Manager) { [string](Get-CibProperty $Manager 'userPrincipalName' '') } else { '' }
        managerMail = if ($Manager) { [string](Get-CibProperty $Manager 'mail' '') } else { '' }
        userCreatedDateTime = if ($userFound) { ConvertTo-CibLocalDate (Get-CibProperty $User 'createdDateTime') } else { '' }
        onPremisesSyncEnabled = if ($userFound) { Get-CibProperty $User 'onPremisesSyncEnabled' } else { $null }
        onPremisesLastSyncDateTime = if ($userFound) { ConvertTo-CibLocalDate (Get-CibProperty $User 'onPremisesLastSyncDateTime') } else { '' }
        onPremisesDomainName = if ($userFound) { [string](Get-CibProperty $User 'onPremisesDomainName' '') } else { '' }
        onPremisesDistinguishedName = if ($userFound) { [string](Get-CibProperty $User 'onPremisesDistinguishedName' '') } else { '' }
        deviceFound = $deviceFound
        managedDeviceId = if ($deviceFound) { [string](Get-CibProperty $Device 'id' '') } else { '' }
        deviceName = if ($deviceFound) {
            $name = [string](Get-CibProperty $Device 'deviceName' '')
            if ([string]::IsNullOrWhiteSpace($name)) { [string](Get-CibProperty $Device 'managedDeviceName' '') } else { $name }
        } else { '' }
        operatingSystem = if ($deviceFound) { [string](Get-CibProperty $Device 'operatingSystem' '') } else { '' }
        osVersion = if ($deviceFound) { [string](Get-CibProperty $Device 'osVersion' '') } else { '' }
        manufacturer = if ($deviceFound) { [string](Get-CibProperty $Device 'manufacturer' '') } else { '' }
        model = if ($deviceFound) { [string](Get-CibProperty $Device 'model' '') } else { '' }
        serialNumber = if ($deviceFound) { [string](Get-CibProperty $Device 'serialNumber' '') } else { '' }
        imei = if ($deviceFound) { [string](Get-CibProperty $Device 'imei' '') } else { '' }
        phoneNumber = if ($deviceFound) { [string](Get-CibProperty $Device 'phoneNumber' '') } else { '' }
        subscriberCarrier = if ($deviceFound) { [string](Get-CibProperty $Device 'subscriberCarrier' '') } else { '' }
        wiFiMacAddress = if ($deviceFound) { [string](Get-CibProperty $Device 'wiFiMacAddress' '') } else { '' }
        complianceState = if ($deviceFound) { [string](Get-CibProperty $Device 'complianceState' '') } else { '' }
        complianceGraceExpirationDateTime = if ($deviceFound) { ConvertTo-CibLocalDate (Get-CibProperty $Device 'complianceGracePeriodExpirationDateTime') } else { '' }
        managementState = if ($deviceFound) { [string](Get-CibProperty $Device 'managementState' '') } else { '' }
        managementAgent = if ($deviceFound) { [string](Get-CibProperty $Device 'managementAgent' '') } else { '' }
        ownerType = if ($deviceFound) { [string](Get-CibProperty $Device 'managedDeviceOwnerType' '') } else { '' }
        enrollmentType = if ($deviceFound) { [string](Get-CibProperty $Device 'deviceEnrollmentType' '') } else { '' }
        enrolledDateTime = if ($deviceFound) { ConvertTo-CibLocalDate (Get-CibProperty $Device 'enrolledDateTime') } else { '' }
        lastSyncDateTime = if ($deviceFound) { ConvertTo-CibLocalDate $lastSyncRaw } else { '' }
        daysWithoutSync = if ($deviceFound) { Get-CibDaysWithoutSync $lastSyncRaw } else { $null }
        isEncrypted = if ($deviceFound) { Get-CibProperty $Device 'isEncrypted' } else { $null }
        isSupervised = if ($deviceFound) { Get-CibProperty $Device 'isSupervised' } else { $null }
        jailBroken = if ($deviceFound) { [string](Get-CibProperty $Device 'jailBroken' '') } else { '' }
        deviceRegistrationState = if ($deviceFound) { [string](Get-CibProperty $Device 'deviceRegistrationState' '') } else { '' }
        azureADRegistered = if ($deviceFound) { Get-CibProperty $Device 'azureADRegistered' } else { $null }
        deviceCategoryDisplayName = if ($deviceFound) { [string](Get-CibProperty $Device 'deviceCategoryDisplayName' '') } else { '' }
        partnerReportedThreatState = if ($deviceFound) { [string](Get-CibProperty $Device 'partnerReportedThreatState' '') } else { '' }
        androidSecurityPatchLevel = if ($deviceFound) { [string](Get-CibProperty $Device 'androidSecurityPatchLevel' '') } else { '' }
        totalStorageDisplay = if ($deviceFound) { ConvertTo-CibStorageDisplay (Get-CibProperty $Device 'totalStorageSpaceInBytes') } else { '' }
        freeStorageDisplay = if ($deviceFound) { ConvertTo-CibStorageDisplay (Get-CibProperty $Device 'freeStorageSpaceInBytes') } else { '' }
        azureADDeviceId = if ($deviceFound) { [string](Get-CibProperty $Device 'azureADDeviceId' '') } else { '' }
    }
}

function Get-CibSummary {
    param(
        [object[]]$Users,
        [object[]]$Rows
    )

    $allUsers = @($Users)
    $allRows = @($Rows)
    $deviceRows = @($allRows | Where-Object { $_.deviceFound })
    $foundUsers = @($allUsers | Where-Object { $_.found })

    $requestedUsersCount = $allUsers.Count
    $foundUsersCount = $foundUsers.Count
    $notFoundUsersCount = @($allUsers | Where-Object { -not $_.found }).Count
    $usersWithoutDevicesCount = @($foundUsers | Where-Object { [int]$_.deviceCount -eq 0 }).Count
    $totalDevicesCount = $deviceRows.Count
    $androidDevicesCount = @($deviceRows | Where-Object { [string]$_.operatingSystem -imatch '^Android$' }).Count
    $iosDevicesCount = @($deviceRows | Where-Object { [string]$_.operatingSystem -imatch '^(iOS|iPadOS)$' }).Count
    $compliantDevicesCount = @($deviceRows | Where-Object { [string]$_.complianceState -ieq 'compliant' }).Count
    $inGraceDevicesCount = @($deviceRows | Where-Object { [string]$_.complianceState -ieq 'inGracePeriod' }).Count
    $noncompliantDevicesCount = @($deviceRows | Where-Object { [string]$_.complianceState -ieq 'noncompliant' }).Count

    return [pscustomobject]@{
        requestedUsers = $requestedUsersCount
        foundUsers = $foundUsersCount
        notFoundUsers = $notFoundUsersCount
        usersWithoutDevices = $usersWithoutDevicesCount
        totalDevices = $totalDevicesCount
        androidDevices = $androidDevicesCount
        iosDevices = $iosDevicesCount
        compliantDevices = $compliantDevicesCount
        inGraceDevices = $inGraceDevicesCount
        noncompliantDevices = $noncompliantDevicesCount
    }
}

function Invoke-CibConsult {
    param($Body)

    $graph = Assert-CibGraph
    $inputUsers = @(Get-CibProperty $Body 'users' @())
    $cleanUsers = New-Object System.Collections.ArrayList
    $seen = @{}

    foreach ($item in $inputUsers) {
        $value = [string]$item
        $value = $value.Trim()
        if ([string]::IsNullOrWhiteSpace($value)) { continue }
        $key = $value.ToLowerInvariant()
        if ($seen.ContainsKey($key)) { continue }
        $seen[$key] = $true
        [void]$cleanUsers.Add($value)
    }

    if ($cleanUsers.Count -eq 0) { throw 'Nenhum utilizador foi informado.' }

    $rows = New-Object System.Collections.ArrayList
    $users = New-Object System.Collections.ArrayList

    foreach ($inputValue in @($cleanUsers.ToArray())) {
        try {
            $user = Find-CibUser -InputValue $inputValue

            if (-not $user) {
                [void]$users.Add([pscustomobject]@{
                    input = $inputValue
                    found = $false
                    userId = ''
                    displayName = ''
                    userPrincipalName = ''
                    mail = ''
                    deviceCount = 0
                    error = 'Utilizador não encontrado no Entra ID.'
                })
                [void]$rows.Add((New-CibRow -InputValue $inputValue -User $null -Manager $null -Device $null -UserError 'Utilizador não encontrado no Entra ID.'))
                continue
            }

            $userId = [string](Get-CibProperty $user 'id' '')
            $userUpn = [string](Get-CibProperty $user 'userPrincipalName' '')
            $manager = Get-CibManager -UserId $userId
            $devices = @(Get-CibManagedDevices -UserId $userId -UserPrincipalName $userUpn)

            [void]$users.Add([pscustomobject]@{
                input = $inputValue
                found = $true
                userId = $userId
                displayName = [string](Get-CibProperty $user 'displayName' '')
                userPrincipalName = $userUpn
                mail = [string](Get-CibProperty $user 'mail' '')
                deviceCount = $devices.Count
                error = ''
            })

            if ($devices.Count -eq 0) {
                [void]$rows.Add((New-CibRow -InputValue $inputValue -User $user -Manager $manager -Device $null))
            }
            else {
                foreach ($device in $devices) {
                    [void]$rows.Add((New-CibRow -InputValue $inputValue -User $user -Manager $manager -Device $device))
                }
            }
        }
        catch {
            $message = $_.Exception.Message
            [void]$users.Add([pscustomobject]@{
                input = $inputValue
                found = $false
                userId = ''
                displayName = ''
                userPrincipalName = ''
                mail = ''
                deviceCount = 0
                error = $message
            })
            [void]$rows.Add((New-CibRow -InputValue $inputValue -User $null -Manager $null -Device $null -UserError $message))
        }
    }

    $rowArray = @($rows.ToArray())
    $userArray = @($users.ToArray())

    return [pscustomobject]@{
        success = $true
        message = 'Consulta concluída.'
        graph = $graph
        generatedAt = (Get-Date).ToString('s')
        users = $userArray
        rows = $rowArray
        summary = Get-CibSummary -Users $userArray -Rows $rowArray
    }
}

function ConvertTo-CibHtmlEncoded {
    param($Value)
    return [System.Net.WebUtility]::HtmlEncode([string]$Value)
}

function Format-CibEmailDate {
    param($Value)

    if ([string]::IsNullOrWhiteSpace([string]$Value)) { return '—' }

    try {
        $parsed = [DateTimeOffset]::Parse([string]$Value)
        return $parsed.ToLocalTime().ToString('dd/MM/yyyy HH:mm')
    }
    catch {
        return [string]$Value
    }
}

function Get-CibEmailOwnerLabel {
    param($Value)

    $key = ([string]$Value).Trim().ToLowerInvariant()
    if ($key -eq 'company') { return 'Corporativo' }
    if ($key -eq 'personal') { return 'Pessoal' }
    if ([string]::IsNullOrWhiteSpace($key)) { return 'Não informado' }
    return [string]$Value
}

function Get-CibEmailComplianceInfo {
    param(
        $Value,
        [bool]$UserFound,
        [bool]$DeviceFound
    )

    if (-not $UserFound) {
        return [pscustomobject]@{ Label = 'Não encontrado'; Background = '#FEE4E2'; Foreground = '#B42318'; Border = '#FECDCA' }
    }

    if (-not $DeviceFound) {
        return [pscustomobject]@{ Label = 'Sem equipamento'; Background = '#FEF0C7'; Foreground = '#B54708'; Border = '#FEDF89' }
    }

    $key = ([string]$Value).Trim().ToLowerInvariant()
    switch ($key) {
        'compliant' { return [pscustomobject]@{ Label = 'Conforme'; Background = '#D1FADF'; Foreground = '#067647'; Border = '#A6F4C5' } }
        'ingraceperiod' { return [pscustomobject]@{ Label = 'Em carência'; Background = '#FEF0C7'; Foreground = '#B54708'; Border = '#FEDF89' } }
        'noncompliant' { return [pscustomobject]@{ Label = 'Não conforme'; Background = '#FEE4E2'; Foreground = '#B42318'; Border = '#FECDCA' } }
        default {
            $label = [string]$Value
            if ([string]::IsNullOrWhiteSpace($label)) { $label = 'Desconhecido' }
            return [pscustomobject]@{ Label = $label; Background = '#F2F4F7'; Foreground = '#475467'; Border = '#EAECF0' }
        }
    }
}

function Get-CibEmailReportSummary {
    param([object[]]$Rows)

    $requested = @{}
    $found = @{}
    $notFound = @{}
    $withoutDevice = @{}
    $deviceRows = @()
    $androidCount = 0
    $iosCount = 0
    $windowsCount = 0
    $compliantCount = 0
    $inGraceCount = 0
    $noncompliantCount = 0

    foreach ($row in @($Rows)) {
        $inputValue = [string](Get-CibProperty $row 'input' '')
        $upn = [string](Get-CibProperty $row 'userPrincipalName' '')
        $key = ''
        if (-not [string]::IsNullOrWhiteSpace($inputValue)) {
            $key = $inputValue.ToLowerInvariant()
        }
        elseif (-not [string]::IsNullOrWhiteSpace($upn)) {
            $key = $upn.ToLowerInvariant()
        }
        else {
            $key = [guid]::NewGuid().ToString('N')
        }
        $requested[$key] = $true

        $userFound = [bool](Get-CibProperty $row 'userFound' $false)
        $deviceFound = [bool](Get-CibProperty $row 'deviceFound' $false)

        if ($userFound) {
            $found[$key] = $true
            if (-not $deviceFound) { $withoutDevice[$key] = $true }
        }
        else {
            $notFound[$key] = $true
        }

        if ($deviceFound) {
            $deviceRows += $row
            $operatingSystem = [string](Get-CibProperty $row 'operatingSystem' '')
            $complianceState = [string](Get-CibProperty $row 'complianceState' '')

            if ($operatingSystem -imatch '^Android$') { $androidCount++ }
            elseif ($operatingSystem -imatch '^(iOS|iPadOS)$') { $iosCount++ }
            elseif ($operatingSystem -imatch '^Windows$') { $windowsCount++ }

            if ($complianceState -ieq 'compliant') { $compliantCount++ }
            elseif ($complianceState -ieq 'inGracePeriod') { $inGraceCount++ }
            elseif ($complianceState -ieq 'noncompliant') { $noncompliantCount++ }
        }
    }

    return [pscustomobject]@{
        requestedUsers = $requested.Count
        foundUsers = $found.Count
        notFoundUsers = $notFound.Count
        usersWithoutDevices = $withoutDevice.Count
        totalDevices = @($deviceRows).Count
        androidDevices = $androidCount
        iosDevices = $iosCount
        windowsDevices = $windowsCount
        compliantDevices = $compliantCount
        inGraceDevices = $inGraceCount
        noncompliantDevices = $noncompliantCount
    }
}

function Get-CibEmailHtml {
    param(
        [object[]]$Rows,
        $Summary,
        [string]$Intro
    )

    $reportSummary = Get-CibEmailReportSummary -Rows $Rows
    $introHtml = (ConvertTo-CibHtmlEncoded $Intro) -replace "`r?`n", '<br>'
    $generated = Get-Date -Format 'dd/MM/yyyy HH:mm'
    $tableRows = New-Object System.Text.StringBuilder
    $rowNumber = 0

    foreach ($row in @($Rows)) {
        $rowNumber++
        $userFound = [bool](Get-CibProperty $row 'userFound' $false)
        $deviceFound = [bool](Get-CibProperty $row 'deviceFound' $false)
        $background = '#FFFFFF'
        if (($rowNumber % 2) -eq 0) { $background = '#FAFAFA' }
        if (-not $userFound) { $background = '#FFF7F6' }
        elseif (-not $deviceFound) { $background = '#FFFCF5' }

        $displayName = [string](Get-CibProperty $row 'userDisplayName' '')
        if ([string]::IsNullOrWhiteSpace($displayName)) { $displayName = [string](Get-CibProperty $row 'input' '—') }
        $upn = [string](Get-CibProperty $row 'userPrincipalName' '')
        if ([string]::IsNullOrWhiteSpace($upn)) { $upn = [string](Get-CibProperty $row 'input' '—') }
        $department = [string](Get-CibProperty $row 'department' '')

        $deviceName = [string](Get-CibProperty $row 'deviceName' '')
        $manufacturer = [string](Get-CibProperty $row 'manufacturer' '')
        $model = [string](Get-CibProperty $row 'model' '')
        $serial = [string](Get-CibProperty $row 'serialNumber' '')
        $modelText = (($manufacturer, $model) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }) -join ' '

        if (-not $userFound) {
            $deviceName = 'Utilizador não encontrado no Entra ID'
            $modelText = [string](Get-CibProperty $row 'userError' '')
        }
        elseif (-not $deviceFound) {
            $deviceName = 'Sem equipamento associado'
            $modelText = 'Não foi encontrado equipamento gerido no Intune.'
        }

        $operatingSystem = [string](Get-CibProperty $row 'operatingSystem' '')
        $osVersion = [string](Get-CibProperty $row 'osVersion' '')
        $systemText = (($operatingSystem, $osVersion) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }) -join ' '
        if ([string]::IsNullOrWhiteSpace($systemText)) { $systemText = '—' }

        $owner = Get-CibEmailOwnerLabel (Get-CibProperty $row 'ownerType' '')
        $lastSync = Format-CibEmailDate (Get-CibProperty $row 'lastSyncDateTime' '')
        $compliance = Get-CibEmailComplianceInfo -Value (Get-CibProperty $row 'complianceState' '') -UserFound $userFound -DeviceFound $deviceFound

        $userExtra = ''
        if (-not [string]::IsNullOrWhiteSpace($department)) {
            $userExtra = '<br><span style="font-size:10px;color:#667085">' + (ConvertTo-CibHtmlEncoded $department) + '</span>'
        }

        $deviceExtra = ''
        if (-not [string]::IsNullOrWhiteSpace($modelText)) {
            $deviceExtra += '<br><span style="font-size:10px;color:#475467">' + (ConvertTo-CibHtmlEncoded $modelText) + '</span>'
        }
        if ($deviceFound -and -not [string]::IsNullOrWhiteSpace($serial)) {
            $deviceExtra += '<br><span style="font-size:10px;color:#667085">Série: ' + (ConvertTo-CibHtmlEncoded $serial) + '</span>'
        }

        $complianceBadge = '<span style="display:inline-block;padding:4px 8px;border-radius:12px;border:1px solid ' + $compliance.Border + ';background:' + $compliance.Background + ';color:' + $compliance.Foreground + ';font-size:10px;font-weight:700;white-space:nowrap">' + (ConvertTo-CibHtmlEncoded $compliance.Label) + '</span>'

        [void]$tableRows.AppendLine((@"
<tr style="background:$background">
  <td valign="top" style="padding:11px 10px;border-bottom:1px solid #EAECF0;word-break:break-word">
    <div style="font-size:12px;font-weight:700;color:#101828">$(ConvertTo-CibHtmlEncoded $displayName)</div>
    <div style="font-size:10px;color:#475467;margin-top:2px">$(ConvertTo-CibHtmlEncoded $upn)</div>$userExtra
  </td>
  <td valign="top" style="padding:11px 10px;border-bottom:1px solid #EAECF0;word-break:break-word">
    <div style="font-size:11px;font-weight:700;color:#101828">$(ConvertTo-CibHtmlEncoded $deviceName)</div>$deviceExtra
  </td>
  <td valign="top" style="padding:11px 10px;border-bottom:1px solid #EAECF0;font-size:11px;color:#344054">$(ConvertTo-CibHtmlEncoded $systemText)</td>
  <td valign="top" style="padding:11px 10px;border-bottom:1px solid #EAECF0">$complianceBadge</td>
  <td valign="top" style="padding:11px 10px;border-bottom:1px solid #EAECF0;font-size:11px;color:#344054">$(ConvertTo-CibHtmlEncoded $owner)</td>
  <td valign="top" style="padding:11px 10px;border-bottom:1px solid #EAECF0;font-size:11px;color:#344054;white-space:nowrap">$(ConvertTo-CibHtmlEncoded $lastSync)</td>
</tr>
"@))
    }

    $requested = $reportSummary.requestedUsers
    $found = $reportSummary.foundUsers
    $notFound = $reportSummary.notFoundUsers
    $noDevice = $reportSummary.usersWithoutDevices
    $devices = $reportSummary.totalDevices
    $android = $reportSummary.androidDevices
    $ios = $reportSummary.iosDevices
    $windows = $reportSummary.windowsDevices
    $compliant = $reportSummary.compliantDevices
    $inGrace = $reportSummary.inGraceDevices
    $noncompliant = $reportSummary.noncompliantDevices
    $includedRows = @($Rows).Count

    return @"
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#F2F4F7;font-family:'Segoe UI',Arial,sans-serif;color:#101828">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F4F7">
    <tr>
      <td align="center" style="padding:24px 12px">
        <table role="presentation" width="980" cellpadding="0" cellspacing="0" border="0" style="width:980px;max-width:100%;background:#FFFFFF;border:1px solid #E4E7EC">
          <tr>
            <td bgcolor="#EC0000" style="background:#EC0000;padding:24px 28px;color:#FFFFFF !important">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td valign="top">
                    <div style="font-size:10px;letter-spacing:1.5px;font-weight:700;text-transform:uppercase;color:#FFFFFF !important">IT Santander Portugal</div>
                    <div style="font-size:27px;line-height:34px;font-weight:700;margin-top:4px;color:#FFFFFF !important">Relatório CIB</div>
                    <div style="font-size:13px;line-height:20px;margin-top:2px;color:#FFFFFF !important">Utilizadores e equipamentos geridos no Microsoft Intune</div>
                  </td>
                  <td align="right" valign="top" style="font-size:11px;line-height:17px;color:#FFFFFF !important;white-space:nowrap">
                    <span style="color:#FFFFFF !important">Gerado em</span><br><strong style="color:#FFFFFF !important">$generated</strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 28px 10px">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F9FAFB;border-left:4px solid #EC0000">
                <tr><td style="padding:14px 16px;font-size:13px;line-height:20px;color:#344054">$introHtml</td></tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:10px 28px 6px">
              <div style="font-size:15px;font-weight:700;color:#101828;margin-bottom:10px">Resumo executivo</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="6" border="0" style="border-collapse:separate">
                <tr>
                  <td width="20%" style="padding:12px;border:1px solid #EAECF0;background:#FFFFFF"><div style="font-size:10px;color:#667085">Utilizadores incluídos</div><div style="font-size:22px;font-weight:700;color:#101828;margin-top:3px">$requested</div></td>
                  <td width="20%" style="padding:12px;border:1px solid #EAECF0;background:#FFFFFF"><div style="font-size:10px;color:#667085">Encontrados</div><div style="font-size:22px;font-weight:700;color:#067647;margin-top:3px">$found</div></td>
                  <td width="20%" style="padding:12px;border:1px solid #EAECF0;background:#FFFFFF"><div style="font-size:10px;color:#667085">Não encontrados</div><div style="font-size:22px;font-weight:700;color:#B42318;margin-top:3px">$notFound</div></td>
                  <td width="20%" style="padding:12px;border:1px solid #EAECF0;background:#FFFFFF"><div style="font-size:10px;color:#667085">Sem equipamento</div><div style="font-size:22px;font-weight:700;color:#B54708;margin-top:3px">$noDevice</div></td>
                  <td width="20%" style="padding:12px;border:1px solid #EAECF0;background:#FFFFFF"><div style="font-size:10px;color:#667085">Equipamentos</div><div style="font-size:22px;font-weight:700;color:#101828;margin-top:3px">$devices</div></td>
                </tr>
                <tr>
                  <td width="20%" style="padding:12px;border:1px solid #EAECF0;background:#FFFFFF"><div style="font-size:10px;color:#667085">Android</div><div style="font-size:20px;font-weight:700;color:#101828;margin-top:3px">$android</div></td>
                  <td width="20%" style="padding:12px;border:1px solid #EAECF0;background:#FFFFFF"><div style="font-size:10px;color:#667085">iOS / iPadOS</div><div style="font-size:20px;font-weight:700;color:#101828;margin-top:3px">$ios</div></td>
                  <td width="20%" style="padding:12px;border:1px solid #EAECF0;background:#FFFFFF"><div style="font-size:10px;color:#667085">Windows</div><div style="font-size:20px;font-weight:700;color:#101828;margin-top:3px">$windows</div></td>
                  <td width="20%" style="padding:12px;border:1px solid #A6F4C5;background:#ECFDF3"><div style="font-size:10px;color:#067647">Conformes</div><div style="font-size:20px;font-weight:700;color:#067647;margin-top:3px">$compliant</div></td>
                  <td width="20%" style="padding:12px;border:1px solid #FEDF89;background:#FFFAEB"><div style="font-size:10px;color:#B54708">Carência / Não conformes</div><div style="font-size:20px;font-weight:700;color:#B54708;margin-top:3px">$inGrace / <span style="color:#B42318">$noncompliant</span></div></td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px 0">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-size:15px;font-weight:700;color:#101828">Utilizadores e equipamentos</td>
                  <td align="right" style="font-size:10px;color:#667085">$includedRows registo(s) incluído(s)</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:10px 28px 24px">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #D0D5DD;table-layout:fixed">
                <thead>
                  <tr style="background:#292929;color:#FFFFFF">
                    <th width="23%" align="left" style="padding:10px;font-size:10px;letter-spacing:.2px">UTILIZADOR</th>
                    <th width="26%" align="left" style="padding:10px;font-size:10px;letter-spacing:.2px">EQUIPAMENTO</th>
                    <th width="13%" align="left" style="padding:10px;font-size:10px;letter-spacing:.2px">SISTEMA</th>
                    <th width="13%" align="left" style="padding:10px;font-size:10px;letter-spacing:.2px">CONFORMIDADE</th>
                    <th width="10%" align="left" style="padding:10px;font-size:10px;letter-spacing:.2px">PROPRIEDADE</th>
                    <th width="15%" align="left" style="padding:10px;font-size:10px;letter-spacing:.2px">ÚLTIMA SINCRONIZAÇÃO</th>
                  </tr>
                </thead>
                <tbody>$($tableRows.ToString())</tbody>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;background:#F9FAFB;border:1px solid #EAECF0">
                <tr>
                  <td style="padding:12px 14px;font-size:10px;line-height:16px;color:#475467">
                    <strong>Nota:</strong> o corpo do e-mail apresenta os dados essenciais para leitura rápida. Os anexos CSV e HTML contêm o relatório e os campos técnicos completos, quando selecionados.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 28px;background:#F9FAFB;border-top:1px solid #EAECF0">
              <div style="font-size:12px;line-height:18px;color:#344054">Atentamente,<br><strong>IT Santander Portugal</strong></div>
              <div style="font-size:9px;line-height:14px;color:#98A2B3;margin-top:10px">Relatório gerado automaticamente pelo Santander Support Web V2.</div>
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

function Get-CibExportRows {
    param([object[]]$Rows)

    foreach ($row in $Rows) {
        [pscustomobject]@{
            Entrada = Get-CibProperty $row 'input' ''
            UtilizadorEncontrado = Get-CibProperty $row 'userFound' $false
            Nome = Get-CibProperty $row 'userDisplayName' ''
            UPN = Get-CibProperty $row 'userPrincipalName' ''
            Email = Get-CibProperty $row 'userMail' ''
            EmployeeId = Get-CibProperty $row 'employeeId' ''
            SamAccountName = Get-CibProperty $row 'onPremisesSamAccountName' ''
            ContaAtiva = Get-CibProperty $row 'accountEnabled' $null
            Cargo = Get-CibProperty $row 'jobTitle' ''
            Departamento = Get-CibProperty $row 'department' ''
            Empresa = Get-CibProperty $row 'companyName' ''
            Localizacao = Get-CibProperty $row 'officeLocation' ''
            Manager = Get-CibProperty $row 'managerDisplayName' ''
            ManagerUPN = Get-CibProperty $row 'managerUserPrincipalName' ''
            CriacaoUtilizador = Get-CibProperty $row 'userCreatedDateTime' ''
            SincronizadoLocal = Get-CibProperty $row 'onPremisesSyncEnabled' $null
            UltimaSyncLocal = Get-CibProperty $row 'onPremisesLastSyncDateTime' ''
            DominioLocal = Get-CibProperty $row 'onPremisesDomainName' ''
            DistinguishedName = Get-CibProperty $row 'onPremisesDistinguishedName' ''
            EquipamentoEncontrado = Get-CibProperty $row 'deviceFound' $false
            Equipamento = Get-CibProperty $row 'deviceName' ''
            SistemaOperativo = Get-CibProperty $row 'operatingSystem' ''
            VersaoSO = Get-CibProperty $row 'osVersion' ''
            Fabricante = Get-CibProperty $row 'manufacturer' ''
            Modelo = Get-CibProperty $row 'model' ''
            NumeroSerie = Get-CibProperty $row 'serialNumber' ''
            IMEI = Get-CibProperty $row 'imei' ''
            Telefone = Get-CibProperty $row 'phoneNumber' ''
            Operadora = Get-CibProperty $row 'subscriberCarrier' ''
            MacWifi = Get-CibProperty $row 'wiFiMacAddress' ''
            Conformidade = Get-CibProperty $row 'complianceState' ''
            FimCarencia = Get-CibProperty $row 'complianceGraceExpirationDateTime' ''
            EstadoGestao = Get-CibProperty $row 'managementState' ''
            AgenteGestao = Get-CibProperty $row 'managementAgent' ''
            Propriedade = Get-CibProperty $row 'ownerType' ''
            TipoInscricao = Get-CibProperty $row 'enrollmentType' ''
            DataInscricao = Get-CibProperty $row 'enrolledDateTime' ''
            UltimaSincronizacao = Get-CibProperty $row 'lastSyncDateTime' ''
            DiasSemSync = Get-CibProperty $row 'daysWithoutSync' $null
            Encriptado = Get-CibProperty $row 'isEncrypted' $null
            Supervisionado = Get-CibProperty $row 'isSupervised' $null
            JailbreakRoot = Get-CibProperty $row 'jailBroken' ''
            EstadoRegisto = Get-CibProperty $row 'deviceRegistrationState' ''
            RegistadoEntra = Get-CibProperty $row 'azureADRegistered' $null
            Categoria = Get-CibProperty $row 'deviceCategoryDisplayName' ''
            AmeacaReportada = Get-CibProperty $row 'partnerReportedThreatState' ''
            PatchAndroid = Get-CibProperty $row 'androidSecurityPatchLevel' ''
            ArmazenamentoTotal = Get-CibProperty $row 'totalStorageDisplay' ''
            ArmazenamentoLivre = Get-CibProperty $row 'freeStorageDisplay' ''
            AzureADDeviceId = Get-CibProperty $row 'azureADDeviceId' ''
            ManagedDeviceId = Get-CibProperty $row 'managedDeviceId' ''
            Erro = Get-CibProperty $row 'userError' ''
        }
    }
}

function Invoke-CibPrepareEmail {
    param($Body)

    $to = ConvertTo-CibRecipientString (Get-CibProperty $Body 'to' '')
    $cc = ConvertTo-CibRecipientString (Get-CibProperty $Body 'cc' '')
    $subject = [string](Get-CibProperty $Body 'subject' '')
    $intro = [string](Get-CibProperty $Body 'intro' '')
    $rows = @(Get-CibProperty $Body 'rows' @())
    $summary = Get-CibProperty $Body 'summary' ([pscustomobject]@{})
    $attachCsv = [bool](Get-CibProperty $Body 'attachCsv' $true)
    $attachHtml = [bool](Get-CibProperty $Body 'attachHtml' $true)

    if ([string]::IsNullOrWhiteSpace($to)) { throw 'Campo Para está vazio.' }
    if ([string]::IsNullOrWhiteSpace($subject)) { throw 'Campo Assunto está vazio.' }
    if ($rows.Count -eq 0) { throw 'Não existem resultados para incluir no e-mail.' }

    [void](Save-CibEmailSettings -Body ([pscustomobject]@{ to = $to; cc = $cc }))
    $html = Get-CibEmailHtml -Rows $rows -Summary $summary -Intro $intro
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'SantanderSupportWebV2\RelatorioCIB'
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
    $token = [guid]::NewGuid().ToString('N').Substring(0,8)
    $csvPath = Join-Path $tempRoot "Relatorio_CIB_${stamp}_${token}.csv"
    $htmlPath = Join-Path $tempRoot "Relatorio_CIB_${stamp}_${token}.html"

    if ($attachCsv) {
        @(Get-CibExportRows -Rows $rows) | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Delimiter ';' -Encoding UTF8
    }

    if ($attachHtml) {
        [System.IO.File]::WriteAllText($htmlPath, $html, (New-Object System.Text.UTF8Encoding($true)))
    }

    $outlook = New-Object -ComObject Outlook.Application
    $mail = $outlook.CreateItem(0)
    $mail.To = $to
    if (-not [string]::IsNullOrWhiteSpace($cc)) { $mail.CC = $cc }
    $mail.Subject = $subject
    $mail.HTMLBody = $html

    if ($attachCsv -and (Test-Path -LiteralPath $csvPath)) { [void]$mail.Attachments.Add($csvPath) }
    if ($attachHtml -and (Test-Path -LiteralPath $htmlPath)) { [void]$mail.Attachments.Add($htmlPath) }

    $mail.Display($false)

    return [pscustomobject]@{
        success = $true
        message = 'E-mail aberto no Outlook para revisão.'
        recipient = $to
        cc = $cc
        subject = $subject
        rows = $rows.Count
        csvAttachment = if ($attachCsv) { $csvPath } else { '' }
        htmlAttachment = if ($attachHtml) { $htmlPath } else { '' }
    }
}

$bodyObject = Get-CibBodyObject
$actionName = Get-CibAction -Body $bodyObject

try {
    switch ($actionName.ToLowerInvariant()) {
        'getsavedusers' {
            Send-CibJson (Get-CibSavedUsers)
        }

        'savesavedusers' {
            Send-CibJson (Save-CibSavedUsers -Body $bodyObject)
        }

        'getemailsettings' {
            Send-CibJson (Get-CibEmailSettings)
        }

        'saveemailsettings' {
            Send-CibJson (Save-CibEmailSettings -Body $bodyObject)
        }

        'status' {
            Send-CibJson ([pscustomobject]@{
                success = $true
                graph = Get-CibGraphStatus
            })
        }

        'connect' {
            $graph = Connect-CibGraph
            Send-CibJson ([pscustomobject]@{
                success = $true
                message = 'Microsoft Graph e Intune ligados com sucesso.'
                graph = $graph
            })
        }

        'consult' {
            Send-CibJson (Invoke-CibConsult -Body $bodyObject)
        }

        'prepareemail' {
            Send-CibJson (Invoke-CibPrepareEmail -Body $bodyObject)
        }

        default {
            Send-CibJson ([pscustomobject]@{
                success = $false
                message = "Action não informada ou não suportada: $actionName"
            })
        }
    }
}
catch {
    Send-CibJson ([pscustomobject]@{
        success = $false
        message = $_.Exception.Message
        type = $_.Exception.GetType().FullName
        line = $_.InvocationInfo.ScriptLineNumber
    })
}
