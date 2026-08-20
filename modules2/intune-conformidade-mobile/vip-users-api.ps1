Set-StrictMode -Version 2.0
. (Join-Path $PSScriptRoot 'json-store.ps1')
# ICM UPDATE V1 - JSON STORE IMPORT

$script:VipUsersPath = Join-Path $PSScriptRoot "vip-users.json"

function Normalize-VipUserPrincipalName {
    param([AllowNull()][object]$Value)

    $text = [string]$Value
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }

    $text = $text.Trim().ToLowerInvariant()
    $match = [regex]::Match(
        $text,
        '(?i)([a-z][a-z0-9._-]{2,})@(corp\.santander\.pt|gruposantander\.com)'
    )

    if ($match.Success) {
        return $match.Value.ToLowerInvariant()
    }

    if ($text -match '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
        return $text
    }

    return $null
}

function Read-VipUsers {
    if (-not (Test-Path -LiteralPath $script:VipUsersPath)) {
        return [pscustomobject]@{
            version = "1.0.0"
            updatedAt = $null
            updatedBy = $null
            users = @()
        }
    }

    try {
        $data = Get-Content -LiteralPath $script:VipUsersPath -Raw | ConvertFrom-Json
        $source = if ($data.PSObject.Properties["users"]) {
            @($data.users)
        }
        elseif ($data.PSObject.Properties["items"]) {
            @($data.items)
        }
        else {
            @()
        }

        $users = @(
            $source |
            ForEach-Object {
                $upn = Normalize-VipUserPrincipalName $_.upn
                if (-not $upn) { return }

                [pscustomobject]@{
                    upn = $upn
                    name = [string]$_.name
                    notes = [string]$_.notes
                    enabled = if ($null -eq $_.enabled) { $true } else { [bool]$_.enabled }
                }
            } |
            Group-Object upn |
            ForEach-Object { $_.Group | Select-Object -First 1 } |
            Sort-Object upn
        )

        return [pscustomobject]@{
            version = "1.0.0"
            updatedAt = $data.updatedAt
            updatedBy = $data.updatedBy
            users = $users
        }
    }
    catch {
        throw "Não foi possível ler vip-users.json: $($_.Exception.Message)"
    }
}

function Save-VipUsers {
    param(
        [Parameter(Mandatory)][object[]]$Users,
        [string]$ChangedBy = "Operador local"
    )

    $normalized = @(
        $Users |
        ForEach-Object {
            $upn = Normalize-VipUserPrincipalName $_.upn
            if (-not $upn) { return }

            [pscustomobject]@{
                upn = $upn
                name = ([string]$_.name).Trim()
                notes = ([string]$_.notes).Trim()
                enabled = if ($null -eq $_.enabled) { $true } else { [bool]$_.enabled }
            }
        } |
        Group-Object upn |
        ForEach-Object { $_.Group | Select-Object -Last 1 } |
        Sort-Object upn
    )

    $document = [ordered]@{
        version = "1.0.0"
        updatedAt = (Get-Date).ToString("o")
        updatedBy = $ChangedBy
        users = $normalized
    }

    Write-IcmJsonAtomic -Path $script:VipUsersPath -Data $document -Depth 20
    # ICM UPDATE V1 - ATOMIC VIP USERS

    return Read-VipUsers
}

function Get-VipUserMatch {
    param([AllowNull()][object]$Identity)

    $upn = Normalize-VipUserPrincipalName $Identity
    if (-not $upn) { return $null }

    return @(
        (Read-VipUsers).users |
        Where-Object {
            $_.enabled -and
            ([string]$_.upn).Equals($upn, [System.StringComparison]::OrdinalIgnoreCase)
        }
    ) | Select-Object -First 1
}

function Test-IsVipUser {
    param([AllowNull()][object]$Identity)
    return $null -ne (Get-VipUserMatch $Identity)
}

function Get-VipPropertySafe {
    param(
        [AllowNull()][object]$Object,
        [Parameter(Mandatory)][string]$Name
    )

    if ($null -eq $Object) { return $null }

    try {
        $property = $Object.PSObject.Properties[$Name]
        if ($property) { return $property.Value }
    } catch {}

    return $null
}

function ConvertTo-VipDirectoryResult {
    param([Parameter(Mandatory)][object]$User)

    $upn = Normalize-VipUserPrincipalName (Get-VipPropertySafe $User "UserPrincipalName")
    if (-not $upn) {
        $upn = Normalize-VipUserPrincipalName (Get-VipPropertySafe $User "Mail")
    }

    $jobTitle = [string](Get-VipPropertySafe $User "JobTitle")
    $department = [string](Get-VipPropertySafe $User "Department")

    $notesParts = @()
    if (-not [string]::IsNullOrWhiteSpace($jobTitle)) {
        $notesParts += $jobTitle.Trim()
    }
    if (-not [string]::IsNullOrWhiteSpace($department)) {
        $notesParts += $department.Trim()
    }

    return [pscustomobject]@{
        id = [string](Get-VipPropertySafe $User "Id")
        upn = $upn
        name = [string](Get-VipPropertySafe $User "DisplayName")
        mail = [string](Get-VipPropertySafe $User "Mail")
        department = $department
        jobTitle = $jobTitle
        accountEnabled = Get-VipPropertySafe $User "AccountEnabled"
        onPremisesSamAccountName = [string](Get-VipPropertySafe $User "OnPremisesSamAccountName")
        notesSuggestion = ($notesParts -join " — ")
    }
}

function Find-VipDirectoryUser {
    param([Parameter(Mandatory)][string]$Identity)

    $term = ([string]$Identity).Trim()
    if ([string]::IsNullOrWhiteSpace($term)) {
        throw "Informe o identificador, UPN ou e-mail do utilizador."
    }

    if (Get-Command Ensure-Graph -ErrorAction SilentlyContinue) {
        try { Ensure-Graph | Out-Null } catch {}
    }
    elseif (Get-Command Ensure-GraphConnection -ErrorAction SilentlyContinue) {
        try { Ensure-GraphConnection | Out-Null } catch {}
    }

    if (-not (Get-Command Get-MgUser -ErrorAction SilentlyContinue)) {
        throw "Microsoft Graph não está disponível. Ligue primeiro a sessão Graph."
    }

    $escaped = $term.Replace("'", "''")
    $properties = @(
        "id",
        "displayName",
        "userPrincipalName",
        "mail",
        "department",
        "jobTitle",
        "accountEnabled",
        "onPremisesSamAccountName"
    )

    $results = New-Object System.Collections.Generic.List[object]

    function Add-VipGraphResult {
        param([AllowNull()][object]$Item)
        if ($null -eq $Item) { return }

        $converted = ConvertTo-VipDirectoryResult $Item
        if (-not $converted.upn) { return }

        $exists = $false

        foreach ($existingItem in $results) {
            if (
                ([string]$existingItem.upn).Equals(
                    [string]$converted.upn,
                    [System.StringComparison]::OrdinalIgnoreCase
                )
            ) {
                $exists = $true
                break
            }
        }

        if (-not $exists) { $results.Add($converted) }
    }

    $normalizedUpn = Normalize-VipUserPrincipalName $term

    if ($normalizedUpn) {
        try {
            Add-VipGraphResult (
                Get-MgUser -UserId $normalizedUpn -Property $properties -ErrorAction Stop
            )
        } catch {}
    }

    if ($results.Count -eq 0) {
        $filters = @(
            "userPrincipalName eq '$escaped'",
            "mail eq '$escaped'",
            "onPremisesSamAccountName eq '$escaped'",
            "startsWith(userPrincipalName,'$escaped')",
            "startsWith(mail,'$escaped')"
        )

        foreach ($filter in $filters) {
            try {
                $found = @(
                    Get-MgUser `
                        -Filter $filter `
                        -ConsistencyLevel eventual `
                        -Top 10 `
                        -Property $properties `
                        -ErrorAction Stop
                )

                foreach ($item in $found) { Add-VipGraphResult $item }

                if ($results.Count -eq 1) { break }
            } catch {}
        }
    }

    if ($results.Count -eq 0 -and $term -notmatch "@") {
        foreach ($domain in @("corp.santander.pt", "gruposantander.com")) {
            $candidate = "$term@$domain"
            try {
                Add-VipGraphResult (
                    Get-MgUser -UserId $candidate -Property $properties -ErrorAction Stop
                )
            } catch {}
        }
    }

    # PowerShell 5.1 pode lançar "Argument types do not match"
    # ao envolver diretamente List[object] em @(...).
    return [object[]]$results.ToArray()
}
function Invoke-VipUsersApi {
    param(
        [Parameter(Mandatory)][string]$Action,
        [AllowNull()][object]$Payload
    )

    $actionKey = $Action.Trim().ToLowerInvariant()
    $current = Read-VipUsers

    switch ($actionKey) {
        "lookupvipuser" {
            $identity = [string]$Payload.identity
            if ([string]::IsNullOrWhiteSpace($identity)) {
                $identity = [string]$Payload.upn
            }

            $results = @(Find-VipDirectoryUser -Identity $identity)

            if ($results.Count -eq 0) {
                return [ordered]@{
                    success = $true
                    found = $false
                    multiple = $false
                    users = @()
                    message = "Utilizador não encontrado no Microsoft Graph."
                }
            }

            if ($results.Count -eq 1) {
                return [ordered]@{
                    success = $true
                    found = $true
                    multiple = $false
                    user = $results[0]
                    users = @($results[0])
                }
            }

            return [ordered]@{
                success = $true
                found = $true
                multiple = $true
                users = @($results)
                message = "Foram encontradas várias correspondências."
            }
        }
        "getvipusers" {
            return [ordered]@{
                success = $true
                users = @($current.users)
                summary = [ordered]@{
                    total = @($current.users).Count
                    enabled = @($current.users | Where-Object enabled).Count
                }
                updatedAt = $current.updatedAt
                updatedBy = $current.updatedBy
            }
        }

        "savevipuser" {
            $upn = Normalize-VipUserPrincipalName $Payload.upn
            if (-not $upn) { throw "UPN VIP inválido." }

            $items = @($current.users | Where-Object {
                -not ([string]$_.upn).Equals($upn, [System.StringComparison]::OrdinalIgnoreCase)
            })

            $items += [pscustomobject]@{
                upn = $upn
                name = ([string]$Payload.name).Trim()
                notes = ([string]$Payload.notes).Trim()
                enabled = if ($null -eq $Payload.enabled) { $true } else { [bool]$Payload.enabled }
            }

            $saved = Save-VipUsers -Users $items -ChangedBy ([string]$Payload.changedBy)
            return [ordered]@{
                success = $true
                message = "Utilizador VIP guardado."
                users = @($saved.users)
            }
        }

        "deletevipuser" {
            $upn = Normalize-VipUserPrincipalName $Payload.upn
            if (-not $upn) { throw "UPN VIP inválido." }

            $items = @($current.users | Where-Object {
                -not ([string]$_.upn).Equals($upn, [System.StringComparison]::OrdinalIgnoreCase)
            })

            $saved = Save-VipUsers -Users $items -ChangedBy ([string]$Payload.changedBy)
            return [ordered]@{
                success = $true
                message = "Utilizador VIP removido da lista."
                users = @($saved.users)
            }
        }

        "togglevipuser" {
            $upn = Normalize-VipUserPrincipalName $Payload.upn
            if (-not $upn) { throw "UPN VIP inválido." }

            $found = $false
            $items = @(
                $current.users |
                ForEach-Object {
                    if (([string]$_.upn).Equals($upn, [System.StringComparison]::OrdinalIgnoreCase)) {
                        $found = $true
                        [pscustomobject]@{
                            upn = $_.upn
                            name = $_.name
                            notes = $_.notes
                            enabled = -not [bool]$_.enabled
                        }
                    } else {
                        $_
                    }
                }
            )

            if (-not $found) { throw "Utilizador VIP não encontrado." }

            $saved = Save-VipUsers -Users $items -ChangedBy ([string]$Payload.changedBy)
            return [ordered]@{
                success = $true
                message = "Estado VIP atualizado."
                users = @($saved.users)
            }
        }

        default {
            throw "Ação VIP não suportada: $Action"
        }
    }
}