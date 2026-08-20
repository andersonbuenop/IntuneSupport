param(
    $Query = $null,
    $Config = $null,
    $Body = $null
)

$ErrorActionPreference = "Stop"

function Send-Json {
    param($Obj)
    $Obj | ConvertTo-Json -Depth 20 -Compress
}

function Get-Param {
    param($Name)

    if ($Body) {
        try {
            if ($Body -is [string]) {
                $json = $Body | ConvertFrom-Json
                if ($json.PSObject.Properties[$Name]) { return $json.$Name }
            } elseif ($Body.PSObject.Properties[$Name]) {
                return $Body.$Name
            }
        } catch {}
    }

    if ($Query -and $Query[$Name]) {
        return $Query[$Name]
    }

    return $null
}

function Convert-ADFileTimeToDate {
    param($Value)

    if ($null -eq $Value) { return $null }

    try {
        [Int64]$v = [Int64]$Value

        if ($v -eq 0 -or $v -eq 9223372036854775807) {
            return $null
        }

        return [DateTime]::FromFileTimeUtc($v).ToLocalTime()
    } catch {
        return $null
    }
}

function Normalize-Date {
    param($Value, [bool]$EndOfDay = $false)

    if ([string]::IsNullOrWhiteSpace($Value)) { return $null }

    $d = [DateTime]::Parse($Value)

    if ($EndOfDay) {
        return $d.Date.AddDays(1).AddSeconds(-1)
    }

    return $d.Date
}

try {
    Import-Module ActiveDirectory -ErrorAction Stop

    $Action = Get-Param "action"

    if ([string]::IsNullOrWhiteSpace($Action)) {
        $Action = "search"
    }

    $User = Get-Param "user"
    $Date = Get-Param "date"
    $DateFrom = Get-Param "dateFrom"
    $DateTo = Get-Param "dateTo"

    $Domains = @(
        @{
            Name = "central.rinterna.local"
            Server = "central.rinterna.local"
        },
        @{
            Name = "rede.rinterna.local"
            Server = "rede.rinterna.local"
        }
    )

    $StartDate = $null
    $EndDate = $null

    if (-not [string]::IsNullOrWhiteSpace($Date)) {
        $StartDate = Normalize-Date $Date $false
        $EndDate = Normalize-Date $Date $true
    } else {
        $StartDate = Normalize-Date $DateFrom $false
        $EndDate = Normalize-Date $DateTo $true
    }

    $Results = New-Object System.Collections.Generic.List[object]

    foreach ($Domain in $Domains) {
        try {
            $Server = $Domain.Server

            if (-not [string]::IsNullOrWhiteSpace($User)) {
                $safeUser = $User.Replace("'", "''")

                $filter = "SamAccountName -like '*$safeUser*' -or UserPrincipalName -like '*$safeUser*' -or Name -like '*$safeUser*' -or DisplayName -like '*$safeUser*'"

                $Users = Get-ADUser `
                    -Server $Server `
                    -Filter $filter `
                    -Properties DisplayName,UserPrincipalName,Mail,Enabled,AccountExpirationDate,accountExpires,Department,Title,Manager,whenCreated,DistinguishedName `
                    -ResultSetSize 200
            } else {
                $Users = Get-ADUser `
                    -Server $Server `
                    -Filter * `
                    -Properties DisplayName,UserPrincipalName,Mail,Enabled,AccountExpirationDate,accountExpires,Department,Title,Manager,whenCreated,DistinguishedName `
                    -ResultSetSize $null
            }

            foreach ($U in $Users) {
                $ExpireDate = $U.AccountExpirationDate

                if ($null -eq $ExpireDate) {
                    $ExpireDate = Convert-ADFileTimeToDate $U.accountExpires
                }

                if ($null -eq $ExpireDate) {
                    continue
                }

                if ($StartDate -and $ExpireDate -lt $StartDate) {
                    continue
                }

                if ($EndDate -and $ExpireDate -gt $EndDate) {
                    continue
                }

                $ManagerName = $null

                if ($U.Manager) {
                    try {
                        $ManagerObj = Get-ADUser -Server $Server -Identity $U.Manager -Properties DisplayName,UserPrincipalName
                        $ManagerName = "$($ManagerObj.DisplayName) <$($ManagerObj.UserPrincipalName)>"
                    } catch {
                        $ManagerName = $U.Manager
                    }
                }

                $DaysToExpire = [math]::Floor(($ExpireDate.Date - (Get-Date).Date).TotalDays)

                $Status = if ($DaysToExpire -lt 0) {
                    "Expirado"
                } elseif ($DaysToExpire -eq 0) {
                    "Expira hoje"
                } else {
                    "A expirar"
                }

                $Results.Add([PSCustomObject]@{
                    Dominio = $Domain.Name
                    SamAccountName = $U.SamAccountName
                    Nome = $U.DisplayName
                    UserPrincipalName = $U.UserPrincipalName
                    Email = $U.Mail
                    Enabled = $U.Enabled
                    Estado = $Status
                    AccountExpires = $ExpireDate.ToString("yyyy-MM-dd HH:mm:ss")
                    DiasParaExpirar = $DaysToExpire
                    Departamento = $U.Department
                    Cargo = $U.Title
                    Manager = $ManagerName
                    CriadoEm = if ($U.whenCreated) { $U.whenCreated.ToString("yyyy-MM-dd HH:mm:ss") } else { $null }
                    DistinguishedName = $U.DistinguishedName
                })
            }
        } catch {
            $Results.Add([PSCustomObject]@{
                Dominio = $Domain.Name
                SamAccountName = $null
                Nome = $null
                UserPrincipalName = $null
                Email = $null
                Enabled = $null
                Estado = "Erro"
                AccountExpires = $null
                DiasParaExpirar = $null
                Departamento = $null
                Cargo = $null
                Manager = $null
                CriadoEm = $null
                DistinguishedName = $_.Exception.Message
            })
        }
    }

    $Ordered = $Results | Sort-Object AccountExpires, Dominio, SamAccountName

    Send-Json @{
        success = $true
        total = @($Ordered).Count
        data = @($Ordered)
        filters = @{
            user = $User
            date = $Date
            dateFrom = $DateFrom
            dateTo = $DateTo
        }
        generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    }
}
catch {
    Send-Json @{
        success = $false
        message = $_.Exception.Message
        data = @()
    }
}
