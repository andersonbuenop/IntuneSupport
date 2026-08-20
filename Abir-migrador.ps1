[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$migrador = Join-Path $root 'tools\Migrador-Ambientes.ps1'

if (-not (Test-Path -LiteralPath $migrador -PathType Leaf)) {
    throw "Ficheiro necessário não encontrado: $migrador"
}

& $migrador -Mode Gui