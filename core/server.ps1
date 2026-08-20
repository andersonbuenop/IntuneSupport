# ============================================================
# SERVER.PS1
# ============================================================
# Servidor HTTP local baseado em HttpListener.
# Este ficheiro deve ser estável.
# Evitar alterar este ficheiro para criar novas ferramentas.
# Novas ferramentas devem ser criadas dentro da pasta modules.
# ============================================================

$Global:AppRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

$ConfigFile = Join-Path $Global:AppRoot "config.json"

if (!(Test-Path $ConfigFile)) {
    Write-Host "config.json nao encontrado." -ForegroundColor Red
    exit
}

$Global:AppConfig = Get-Content $ConfigFile -Raw | ConvertFrom-Json

. "$Global:AppRoot\core\logger.ps1"
. "$Global:AppRoot\core\response.ps1"
. "$Global:AppRoot\core\router.ps1"

$Port = $Global:AppConfig.port
$Url = "http://localhost:$Port/"
$InstanceMutex = New-Object System.Threading.Mutex($false, "SantanderSupportWebV2-$Port")
$OwnsInstance = $false

try { $OwnsInstance = $InstanceMutex.WaitOne(0) }
catch [System.Threading.AbandonedMutexException] { $OwnsInstance = $true }

if (-not $OwnsInstance) {
    Write-AppLog "Já existe uma instância do servidor a utilizar a porta $Port." "ERROR"
    $InstanceMutex.Dispose()
    exit
}

Write-AppLog "Iniciando servidor em $Url"
Write-AppLog "Ambiente: $($Global:AppConfig.environment)"
Write-AppLog "UseMock: $($Global:AppConfig.useMock)"

$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add($Url)

try {
    $Listener.Start()
}
catch {
    Write-AppLog "Erro ao iniciar servidor: $($_.Exception.Message)" "ERROR"
    if ($OwnsInstance) { try { $InstanceMutex.ReleaseMutex() } catch {} }
    $InstanceMutex.Dispose()
    exit
}

Write-Host ""
Write-Host "Servidor iniciado:"
Write-Host $Url -ForegroundColor Green
Write-Host ""
Write-Host "Para parar, pressione CTRL + C"
Write-Host ""

while ($Listener.IsListening) {
    try {
        $Context = $Listener.GetContext()

        Invoke-AppRoute `
            -Request $Context.Request `
            -Response $Context.Response `
            -Context $Context
    }
    catch {
        Write-AppLog "Erro geral: $($_.Exception.Message)" "ERROR"
    }
}

if ($OwnsInstance) { try { $InstanceMutex.ReleaseMutex() } catch {} }
$InstanceMutex.Dispose()
