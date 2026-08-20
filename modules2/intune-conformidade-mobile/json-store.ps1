#requires -Version 5.1
Set-StrictMode -Version 2.0

function Get-IcmJsonMutexName {
    param([Parameter(Mandatory)][string]$Path)
    $FullPath = [IO.Path]::GetFullPath($Path).ToLowerInvariant()
    $Sha = [Security.Cryptography.SHA256]::Create()
    try {
        $Hash = $Sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($FullPath))
        return 'SantanderSupportWebV2_ICM_' + ([BitConverter]::ToString($Hash).Replace('-', '').Substring(0, 24))
    }
    finally { $Sha.Dispose() }
}

function Write-IcmJsonAtomic {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Data,
        [ValidateRange(2, 100)][int]$Depth = 30,
        [ValidateRange(1000, 60000)][int]$TimeoutMilliseconds = 15000
    )

    $Directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $Directory)) {
        New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    }

    $Json = $Data | ConvertTo-Json -Depth $Depth
    $null = $Json | ConvertFrom-Json -ErrorAction Stop

    $Mutex = [Threading.Mutex]::new($false, (Get-IcmJsonMutexName -Path $Path))
    $Acquired = $false
    $TempPath = Join-Path $Directory ('.' + [IO.Path]::GetFileName($Path) + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    $BackupPath = "$Path.bak"
    $Encoding = [Text.UTF8Encoding]::new($false)

    try {
        try { $Acquired = $Mutex.WaitOne($TimeoutMilliseconds) }
        catch [Threading.AbandonedMutexException] { $Acquired = $true }
        if (-not $Acquired) { throw "Tempo excedido ao aguardar acesso exclusivo a $Path." }

        [IO.File]::WriteAllText($TempPath, $Json, $Encoding)
        $null = [IO.File]::ReadAllText($TempPath, [Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop

        if (Test-Path -LiteralPath $Path) {
            Copy-Item -LiteralPath $Path -Destination $BackupPath -Force
        }

        Move-Item -LiteralPath $TempPath -Destination $Path -Force
    }
    finally {
        if (Test-Path -LiteralPath $TempPath) { Remove-Item -LiteralPath $TempPath -Force -ErrorAction SilentlyContinue }
        if ($Acquired) { try { $Mutex.ReleaseMutex() } catch {} }
        $Mutex.Dispose()
    }
}