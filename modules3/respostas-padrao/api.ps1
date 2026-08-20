param(
    $Query = $null,
    $Config = $null,
    $Body = $null
)

$ErrorActionPreference = "Stop"

$ModuleRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ResponsesPath = Join-Path $ModuleRoot "respostas.json"

function New-ApiResult {
    param(
        [bool]$Success,
        $Data = $null,
        [string]$Error = ""
    )

    $Result = [ordered]@{
        success = $Success
    }

    if ($null -ne $Data) {
        foreach ($Property in $Data.Keys) {
            $Result[$Property] = $Data[$Property]
        }
    }

    if (-not [string]::IsNullOrWhiteSpace($Error)) {
        $Result["error"] = $Error
    }

    return [pscustomobject]$Result
}

try {
    $Action = ""

    if ($null -ne $Query) {
        $Action = [string]$Query["action"]
    }

    if ([string]::IsNullOrWhiteSpace($Action)) {
        $Action = "list"
    }

    switch ($Action.ToLowerInvariant()) {
        "list" {
            if (!(Test-Path -LiteralPath $ResponsesPath)) {
                return New-ApiResult `
                    -Success $false `
                    -Error "Ficheiro respostas.json não encontrado."
            }

            $Json = [System.IO.File]::ReadAllText(
                $ResponsesPath,
                [System.Text.Encoding]::UTF8
            )

            $Data = $Json | ConvertFrom-Json

            return New-ApiResult `
                -Success $true `
                -Data @{
                    settings = $Data.settings
                    responses = @($Data.responses)
                }
        }

        default {
            return New-ApiResult `
                -Success $false `
                -Error "Ação não suportada: $Action"
        }
    }
}
catch {
    return New-ApiResult `
        -Success $false `
        -Error $_.Exception.Message
}