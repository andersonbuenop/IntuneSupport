# ============================================================
# START PRODUCAO - SANTANDER SUPPORT WEB V2
# ============================================================

Clear-Host

$RootFolder = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "============================================"
Write-Host " Santander Support Web V2 - PRODUCAO"
Write-Host "============================================"
Write-Host ""

Write-Host "Ambiente: PRODUCAO" -ForegroundColor Red
Write-Host "UseMock: FALSE" -ForegroundColor Red
Write-Host ""

. "$RootFolder\core\server.ps1"
