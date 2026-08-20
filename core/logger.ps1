function Write-AppLog {
    param(
        [string]$Message,
        [string]$Level = "INFO",
        [string]$Area = "GERAL"
    )

    $LogFolder = Join-Path $Global:AppRoot "logs"

    if (!(Test-Path $LogFolder)) {
        New-Item -ItemType Directory -Path $LogFolder -Force | Out-Null
    }

    $LogFile = Join-Path $LogFolder "app.log"

    # Nunca persistir credenciais temporarias, tokens ou segredos recebidos
    # nos corpos/resultados de APIs. A mascaragem fica centralizada aqui para
    # proteger tambem modulos antigos que ainda escrevam objetos completos.
    $SafeMessage = [string]$Message
    $SensitivePatterns = @(
        '(?i)(temporaryAccessPass|temporary_access_pass|csrfToken|access_token|refresh_token|authorization|password|senha|secret)(\s*[=:]\s*|\s*"\s*:\s*")([^\s,;"}]+)',
        '(?i)(TPA\s*:\s*)([^\s,;]+)'
    )
    foreach ($Pattern in $SensitivePatterns) {
        $SafeMessage = [regex]::Replace($SafeMessage, $Pattern, '$1$2***REDACTED***')
    }

    $Line = "[{0}] [{1}] [{2}] {3}" -f `
        (Get-Date -Format "yyyy-MM-dd HH:mm:ss"),
        $Level.ToUpper(),
        $Area.ToUpper(),
        $SafeMessage

    $Line | Out-File -FilePath $LogFile -Append -Encoding UTF8

    switch ($Level.ToUpper()) {
        "ERROR" { Write-Host $Line -ForegroundColor Red }
        "WARN"  { Write-Host $Line -ForegroundColor Yellow }
        "DEBUG" { Write-Host $Line -ForegroundColor Cyan }
        default { Write-Host $Line -ForegroundColor White }
    }
}

function Get-AppLog {
    param([int]$LastLines = 300)

    $LogFile = Join-Path $Global:AppRoot "logs\app.log"

    if (!(Test-Path $LogFile)) {
        return @("Ainda nao existem logs.")
    }

    return Get-Content $LogFile -Tail $LastLines -Encoding UTF8
}
