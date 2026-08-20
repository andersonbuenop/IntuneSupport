param(
    $Query = $null,
    $Config = $null,
    $Body = $null
)

$ErrorActionPreference = "Stop"

function Send-Json {
    param($Obj)
    $Obj | ConvertTo-Json -Depth 50 -Compress
}

function Get-QueryValue {
    param([string]$Name)

    if ($Query) {

        # Caso usado pelo framework: NameValueCollection
        if ($Query -is [System.Collections.Specialized.NameValueCollection]) {
            $v = $Query.Get($Name)
            if ($v) { return [string]$v }
        }

        # Caso Hashtable
        if ($Query -is [hashtable] -and $Query.ContainsKey($Name)) {
            return [string]$Query[$Name]
        }

        # Caso string
        if ($Query -is [string]) {
            $q = $Query
            if ($q.StartsWith("?")) { $q = $q.Substring(1) }
            $parsed = [System.Web.HttpUtility]::ParseQueryString($q)
            if ($parsed[$Name]) { return [string]$parsed[$Name] }
        }

        # Caso objeto normal
        $prop = $Query.PSObject.Properties[$Name]
        if ($prop) {
            return [string]$prop.Value
        }
    }

    if ($env:QUERY_STRING) {
        $parsed = [System.Web.HttpUtility]::ParseQueryString($env:QUERY_STRING)
        if ($parsed[$Name]) { return [string]$parsed[$Name] }
    }

    if ($env:REQUEST_URI) {
        try {
            $u = [System.Uri]("http://localhost" + $env:REQUEST_URI)
            $parsed = [System.Web.HttpUtility]::ParseQueryString($u.Query)
            if ($parsed[$Name]) { return [string]$parsed[$Name] }
        } catch {}
    }

    return $null
}

function Get-PayloadObject {
    $payload = Get-QueryValue "payload"

    if ($payload) {
        try {
            return ([System.Web.HttpUtility]::UrlDecode($payload)) | ConvertFrom-Json
        } catch {
            try { return $payload | ConvertFrom-Json } catch {}
        }
    }

    $user = Get-QueryValue "user"
    if ($user) {
        return [pscustomobject]@{ user = $user }
    }

    if ($Body) {
        try {
            if ($Body -is [string]) { return $Body | ConvertFrom-Json }
            return $Body
        } catch {}
    }

    return [pscustomobject]@{}
}

function Ensure-Graph {
    $ctx = Get-MgContext -ErrorAction SilentlyContinue
    if (-not $ctx) {
        throw "Graph/Intune não está conectado. Clique em Conectar Graph/Intune."
    }
}

function Invoke-GraphGetAll {
    param([string]$Uri)

    $all = @()
    $next = $Uri

    while ($next) {
        $res = Invoke-MgGraphRequest -Method GET -Uri $next
        if ($res.value) { $all += $res.value }
        $next = $res.'@odata.nextLink'
    }

    return $all
}

$RequiredGroups = @(
    "ONE APP - Portugal",
    "One App - QA",
    "GR_Intune_PT_VPN_PoC_APPS",
    "GR_Intune_Pruebas_OneApp_PT",
    "GR_Intune_PT_CENTRAL_EquipaAppsTestes"
)

try {
    $Action = Get-QueryValue "action"
    $Payload = Get-PayloadObject

    if (-not $Action) {
        Send-Json @{
            success = $false
            message = "Action não informado."
            queryType = if ($Query) { $Query.GetType().FullName } else { "null" }
            queryRaw = [string]$Query
            envQuery = $env:QUERY_STRING
            requestUri = $env:REQUEST_URI
        }
        return
    }

    switch ($Action) {

        "connect" {
            $Scopes = @(
                "User.Read.All",
                "Group.ReadWrite.All",
                "Directory.Read.All",
                "Device.Read.All",
                "DeviceManagementManagedDevices.Read.All",
                "DeviceManagementApps.Read.All"
            )

            Connect-MgGraph -Scopes $Scopes -NoWelcome | Out-Null
            $ctx = Get-MgContext

            Send-Json @{
                success = $true
                message = "Graph/Intune conectado."
                graph = @{
                    connected = $true
                    account = $ctx.Account
                    tenantId = $ctx.TenantId
                    scopes = $ctx.Scopes
                }
            }
            return
        }

        "status" {
            $ctx = Get-MgContext -ErrorAction SilentlyContinue

            Send-Json @{
                success = $true
                graph = @{
                    connected = [bool]$ctx
                    account = if ($ctx) { $ctx.Account } else { $null }
                    tenantId = if ($ctx) { $ctx.TenantId } else { $null }
                }
            }
            return
        }

        "consultar" {
            Ensure-Graph

            $UserQuery = [string]$Payload.user

            if ([string]::IsNullOrWhiteSpace($UserQuery)) {
                Send-Json @{ success = $false; message = "Utilizador não informado." }
                return
            }

            if ($UserQuery -notlike "*@*") {
                $UserQuery = "$UserQuery@corp.santander.pt"
            }

            $safe = $UserQuery.Replace("'", "''")

            $users = Invoke-GraphGetAll "/v1.0/users?`$filter=userPrincipalName eq '$safe' or mail eq '$safe'&`$select=id,displayName,userPrincipalName,mail,accountEnabled,department,jobTitle"

            if (-not $users -or $users.Count -eq 0) {
                Send-Json @{ success = $false; message = "Utilizador não encontrado no Entra ID." }
                return
            }

            $user = $users | Select-Object -First 1

            $memberOf = Invoke-GraphGetAll "/v1.0/users/$($user.id)/memberOf/microsoft.graph.group?`$select=id,displayName"

            $groupResults = @()

            foreach ($groupName in $RequiredGroups) {
                $groupSafe = $groupName.Replace("'", "''")
                $foundGroups = Invoke-GraphGetAll "/v1.0/groups?`$filter=displayName eq '$groupSafe'&`$select=id,displayName"
                $targetGroup = $foundGroups | Select-Object -First 1

                if ($targetGroup) {
                    $isMember = @($memberOf | Where-Object { $_.id -eq $targetGroup.id }).Count -gt 0

                    $groupResults += [pscustomobject]@{
                        displayName = $targetGroup.displayName
                        id = $targetGroup.id
                        found = $true
                        isMember = $isMember
                    }
                } else {
                    $groupResults += [pscustomobject]@{
                        displayName = $groupName
                        id = $null
                        found = $false
                        isMember = $false
                    }
                }
            }

            $upnSafe = $user.userPrincipalName.Replace("'", "''")

            $devices = Invoke-GraphGetAll "/v1.0/deviceManagement/managedDevices?`$filter=userPrincipalName eq '$upnSafe'&`$select=id,deviceName,userPrincipalName,operatingSystem,osVersion,complianceState,lastSyncDateTime,model,manufacturer,serialNumber"

            $mobileDevices = @($devices | Where-Object {
                $_.operatingSystem -match "Android|iOS|iPadOS"
            })

            $deviceResults = @()

            foreach ($dev in $mobileDevices) {
                $deviceResults += [pscustomobject]@{
                    id = $dev.id
                    deviceName = $dev.deviceName
                    operatingSystem = $dev.operatingSystem
                    osVersion = $dev.osVersion
                    complianceState = $dev.complianceState
                    lastSyncDateTime = $dev.lastSyncDateTime
                    manufacturer = $dev.manufacturer
                    model = $dev.model
                    serialNumber = $dev.serialNumber
                    defenderInstalled = $false
                    defenderMatch = "Validação por detectedApps pendente"
                }
            }

            Send-Json @{
                success = $true
                user = @{
                    id = $user.id
                    displayName = $user.displayName
                    userPrincipalName = $user.userPrincipalName
                    mail = $user.mail
                    accountEnabled = $user.accountEnabled
                    department = $user.department
                    jobTitle = $user.jobTitle
                }
                groups = $groupResults
                devices = $deviceResults
            }
            return
        }

        "addGroup" {
            Ensure-Graph

            $groupId = [string]$Payload.groupId
            $userId = [string]$Payload.userId

            if ([string]::IsNullOrWhiteSpace($groupId) -or [string]::IsNullOrWhiteSpace($userId)) {
                Send-Json @{ success = $false; message = "groupId ou userId não informado." }
                return
            }

            $bodyObj = @{
                "@odata.id" = "https://graph.microsoft.com/v1.0/directoryObjects/$userId"
            }

            Invoke-MgGraphRequest `
                -Method POST `
                -Uri "/v1.0/groups/$groupId/members/`$ref" `
                -Body ($bodyObj | ConvertTo-Json -Compress) `
                -ContentType "application/json"

            Send-Json @{ success = $true; message = "Utilizador adicionado ao grupo." }
            return
        }

        default {
            Send-Json @{ success = $false; message = "Action inválido: $Action" }
            return
        }
    }

} catch {
    Send-Json @{
        success = $false
        message = $_.Exception.Message
    }
}

