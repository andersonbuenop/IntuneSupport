param(
    [string]$action,
    [string]$user,
    [string]$debug
)

$ErrorActionPreference = "Stop"

function Send-Json {
    param([object]$Data)
    $Data | ConvertTo-Json -Depth 30 -Compress
}

function Get-RequestValue {
    param(
        [string]$Name,
        [string]$CurrentValue
    )

    if (-not [string]::IsNullOrWhiteSpace($CurrentValue)) {
        return $CurrentValue
    }

    try {
        if ($script:Query -and $script:Query.ContainsKey($Name)) {
            return [string]$script:Query[$Name]
        }
    } catch {}

    try {
        if ($Query -and $Query.ContainsKey($Name)) {
            return [string]$Query[$Name]
        }
    } catch {}

    try {
        if ($script:Params -and $script:Params.ContainsKey($Name)) {
            return [string]$script:Params[$Name]
        }
    } catch {}

    try {
        if ($Params -and $Params.ContainsKey($Name)) {
            return [string]$Params[$Name]
        }
    } catch {}

    try {
        if ($Request -and $Request.QueryString[$Name]) {
            return [string]$Request.QueryString[$Name]
        }
    } catch {}

    return $null
}

$action = Get-RequestValue -Name "action" -CurrentValue $action
$user   = Get-RequestValue -Name "user"   -CurrentValue $user
$debug  = Get-RequestValue -Name "debug"  -CurrentValue $debug

function Test-GraphConnected {
    try {
        $ctx = Get-MgContext -ErrorAction SilentlyContinue

        if ($null -eq $ctx) {
            return $false
        }

        if ([string]::IsNullOrWhiteSpace($ctx.Account)) {
            return $false
        }

        return $true
    }
    catch {
        return $false
    }
}

function Connect-GraphWam {
    try {
        Import-Module Microsoft.Graph.Authentication -ErrorAction SilentlyContinue
        Import-Module Microsoft.Graph.Users -ErrorAction SilentlyContinue
        Import-Module Microsoft.Graph.Groups -ErrorAction SilentlyContinue
        Import-Module Microsoft.Graph.Identity.DirectoryManagement -ErrorAction SilentlyContinue

        $Scopes = @(
            "User.Read.All",
            "Group.Read.All",
            "Directory.Read.All"
        )

        Connect-MgGraph -Scopes $Scopes -NoWelcome -ErrorAction Stop | Out-Null

        $ctx = Get-MgContext -ErrorAction SilentlyContinue

        if ($ctx) {
            return @{
                success = $true
                message = "Conectado ao Azure / Entra ID com sucesso."
                data = @{
                    account = $ctx.Account
                    tenantId = $ctx.TenantId
                    scopes = $ctx.Scopes
                }
            }
        }

        return @{
            success = $false
            message = "A janela WAM foi chamada, mas não foi possível confirmar a conexão Graph."
        }
    }
    catch {
        return @{
            success = $false
            message = "Erro ao conectar ao Azure / Entra ID: $($_.Exception.Message)"
        }
    }
}

function Resolve-EntraUser {
    param([string]$Identity)

    $identityClean = $Identity.Trim()

    if ([string]::IsNullOrWhiteSpace($identityClean)) {
        return $null
    }

    try {
        return Get-MgUser -UserId $identityClean -ErrorAction Stop
    }
    catch {}

    try {
        $safe = $identityClean.Replace("'", "''")

        $filter = "userPrincipalName eq '$safe' or mail eq '$safe' or employeeId eq '$safe'"

        $found = Get-MgUser `
            -Filter $filter `
            -ConsistencyLevel eventual `
            -CountVariable count `
            -All `
            -ErrorAction Stop

        if ($found) {
            return $found | Select-Object -First 1
        }
    }
    catch {}

    try {
        if ($identityClean -notlike "*@*") {
            $possibleUpns = @(
                "$identityClean@corp.santander.pt",
                "$identityClean@santander.pt",
                "$identityClean@santandernet.onmicrosoft.com"
            )

            foreach ($upn in $possibleUpns) {
                try {
                    $u = Get-MgUser -UserId $upn -ErrorAction Stop
                    if ($u) {
                        return $u
                    }
                }
                catch {}
            }
        }
    }
    catch {}

    return $null
}

function Get-GroupType {
    param([object]$Group)

    $groupTypes = $null
    $securityEnabled = $null
    $mailEnabled = $null

    try {
        $groupTypes = $Group.AdditionalProperties["groupTypes"]
        $securityEnabled = $Group.AdditionalProperties["securityEnabled"]
        $mailEnabled = $Group.AdditionalProperties["mailEnabled"]
    }
    catch {}

    if ($groupTypes -and ($groupTypes -contains "Unified")) {
        return "Microsoft 365"
    }

    if ($securityEnabled -eq $true -and $mailEnabled -eq $true) {
        return "Mail Enabled Security"
    }

    if ($securityEnabled -eq $true) {
        return "Security"
    }

    if ($mailEnabled -eq $true) {
        return "Distribution"
    }

    return "Outro"
}

try {
    switch ($action) {

        "status" {
            $connected = Test-GraphConnected
            $ctx = Get-MgContext -ErrorAction SilentlyContinue

            Send-Json @{
                success = $true
                connected = $connected
                data = @{
                    account = if ($ctx) { $ctx.Account } else { "" }
                    tenantId = if ($ctx) { $ctx.TenantId } else { "" }
                }
            }
            return
        }

        "connect" {
            Send-Json (Connect-GraphWam)
            return
        }

        "consultar" {

            if ([string]::IsNullOrWhiteSpace($user)) {
                Send-Json @{
                    success = $false
                    message = "Utilizador não informado."
                }
                return
            }

            if (-not (Test-GraphConnected)) {
                Send-Json @{
                    success = $false
                    needConnect = $true
                    message = "Azure / Entra ID não está conectado. Clique em Conectar Azure para abrir o WAM."
                }
                return
            }

            Import-Module Microsoft.Graph.Users -ErrorAction SilentlyContinue
            Import-Module Microsoft.Graph.Groups -ErrorAction SilentlyContinue

            $entraUser = Resolve-EntraUser -Identity $user

            if ($null -eq $entraUser) {
                Send-Json @{
                    success = $false
                    message = "Utilizador não encontrado no Entra ID."
                }
                return
            }

            $memberOf = Get-MgUserMemberOf `
                -UserId $entraUser.Id `
                -All `
                -ErrorAction Stop

            $groups = @()
            $security = 0
            $m365 = 0
            $distribution = 0
            $mailSecurity = 0
            $other = 0

            foreach ($item in $memberOf) {

                $odataType = ""
                try {
                    $odataType = $item.AdditionalProperties["@odata.type"]
                } catch {}

                if ($odataType -ne "#microsoft.graph.group") {
                    continue
                }

                $type = Get-GroupType -Group $item

                switch ($type) {
                    "Security" { $security++ }
                    "Microsoft 365" { $m365++ }
                    "Distribution" { $distribution++ }
                    "Mail Enabled Security" { $mailSecurity++ }
                    default { $other++ }
                }

                $displayName = ""
                $mail = ""
                $id = ""

                try { $displayName = $item.AdditionalProperties["displayName"] } catch {}
                try { $mail = $item.AdditionalProperties["mail"] } catch {}
                try { $id = $item.Id } catch {}

                $groups += [PSCustomObject]@{
                    displayName = $displayName
                    type        = $type
                    mail        = $mail
                    id          = $id
                }
            }

            $groups = $groups | Sort-Object displayName

            Send-Json @{
                success = $true
                data = @{
                    user = @{
                        id                = $entraUser.Id
                        displayName       = $entraUser.DisplayName
                        userPrincipalName = $entraUser.UserPrincipalName
                        mail              = $entraUser.Mail
                    }
                    total        = @($groups).Count
                    security     = $security
                    m365         = $m365
                    distribution = $distribution
                    mailSecurity = $mailSecurity
                    other        = $other
                    groups       = $groups
                }
            }
            return
        }

        default {
            Send-Json @{
                success = $false
                message = "Action inválida ou não informada."
                debug = @{
                    actionRecebida = $action
                    userRecebido = $user
                }
            }
            return
        }
    }
}
catch {
    Send-Json @{
        success = $false
        message = $_.Exception.Message
    }
}
