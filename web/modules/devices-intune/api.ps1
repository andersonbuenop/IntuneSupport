param(
    [string]$action,
    [string]$query
)

$ErrorActionPreference = "Stop"

function New-JsonResponse {
    param(
        [bool]$Success,
        [string]$Message,
        $Data = $null
    )

    $obj = [ordered]@{
        success = $Success
        message = $Message
    }

    if ($null -ne $Data) {
        foreach ($key in $Data.Keys) {
            $obj[$key] = $Data[$key]
        }
    }

    $obj | ConvertTo-Json -Depth 30
}

function Get-DiasSemSync {
    param(
        $DateValue
    )

    if ($null -eq $DateValue -or [string]::IsNullOrWhiteSpace([string]$DateValue)) {
        return ""
    }

    try {
        $dt = [datetime]$DateValue
        return [int]((Get-Date) - $dt).TotalDays
    }
    catch {
        return ""
    }
}

try {

    if ([string]::IsNullOrWhiteSpace($action)) {
        New-JsonResponse -Success $false -Message "Action não informado."
        return
    }

    switch ($action) {

        "search" {

            if ([string]::IsNullOrWhiteSpace($query)) {
                New-JsonResponse -Success $false -Message "Informe um valor para pesquisa."
                return
            }

            Import-Module Microsoft.Graph.DeviceManagement -ErrorAction Stop

            $q = $query.Trim()

            $properties = @(
                "id",
                "deviceName",
                "userDisplayName",
                "userPrincipalName",
                "emailAddress",
                "operatingSystem",
                "osVersion",
                "complianceState",
                "managementState",
                "ownerType",
                "deviceEnrollmentType",
                "enrolledDateTime",
                "lastSyncDateTime",
                "manufacturer",
                "model",
                "serialNumber",
                "imei",
                "phoneNumber",
                "wiFiMacAddress",
                "azureADDeviceId",
                "isEncrypted",
                "isSupervised",
                "jailBroken",
                "deviceRegistrationState",
                "managedDeviceOwnerType"
            )

            $allDevices = Get-MgDeviceManagementManagedDevice -All -Property $properties

            $devices = $allDevices | Where-Object {
                ($_.UserDisplayName -like "*$q*") -or
                ($_.UserPrincipalName -like "*$q*") -or
                ($_.EmailAddress -like "*$q*") -or
                ($_.DeviceName -like "*$q*") -or
                ($_.SerialNumber -like "*$q*") -or
                ($_.Imei -like "*$q*") -or
                ($_.PhoneNumber -like "*$q*") -or
                ($_.AzureADDeviceId -like "*$q*") -or
                ($_.Id -like "*$q*") -or
                ($_.Model -like "*$q*") -or
                ($_.Manufacturer -like "*$q*")
            }

            if (!$devices) {
                New-JsonResponse -Success $false -Message "Nenhum dispositivo encontrado no Intune para: $q"
                return
            }

            $result = @()

            foreach ($d in $devices) {

                $diasSemSync = Get-DiasSemSync -DateValue $d.LastSyncDateTime

                $result += [ordered]@{
                    id                      = $d.Id
                    deviceName              = $d.DeviceName
                    userDisplayName         = $d.UserDisplayName
                    userPrincipalName       = $d.UserPrincipalName
                    emailAddress            = $d.EmailAddress
                    operatingSystem         = $d.OperatingSystem
                    osVersion               = $d.OsVersion
                    complianceState         = $d.ComplianceState
                    managementState         = $d.ManagementState
                    ownerType               = $d.OwnerType
                    enrollmentType          = $d.DeviceEnrollmentType
                    enrolledDateTime        = $d.EnrolledDateTime
                    lastSyncDateTime        = $d.LastSyncDateTime
                    diasSemSync             = $diasSemSync
                    manufacturer            = $d.Manufacturer
                    model                   = $d.Model
                    serialNumber            = $d.SerialNumber
                    imei                    = $d.Imei
                    phoneNumber             = $d.PhoneNumber
                    wiFiMacAddress          = $d.WiFiMacAddress
                    azureADDeviceId         = $d.AzureADDeviceId
                    isEncrypted             = $d.IsEncrypted
                    isSupervised            = $d.IsSupervised
                    jailBroken              = $d.JailBroken
                    deviceRegistrationState = $d.DeviceRegistrationState
                    managedDeviceOwnerType  = $d.ManagedDeviceOwnerType
                }
            }

            $data = [ordered]@{
                query = $q
                total = $result.Count
                devices = $result
            }

            New-JsonResponse -Success $true -Message "Consulta concluída." -Data $data
            return
        }

        default {
            New-JsonResponse -Success $false -Message "Action inválido: $action"
            return
        }
    }
}
catch {
    New-JsonResponse -Success $false -Message $_.Exception.Message
    return
}
