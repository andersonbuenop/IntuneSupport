<#
.SYNOPSIS
    Diagnóstico SantanderSupportWebV2 V16.3.2.

.DESCRIPTION
    Diagnóstico reutilizável com três modos:

      1. Módulo específico
         Verifica frontend, backend, API, rotas, assets, manifestos,
         duplicações, inicialização JavaScript e comparação opcional
         com um módulo de referência.

      2. Páginas comuns / Ferramentas
         Verifica app.js, router.ps1, página principal, catálogo,
         funções que montam Ferramentas/Relatórios, CSS global,
         cartões duplicados e navegação incorreta.

      3. Sistema completo
         Varre todos os módulos, catálogo, frontend, backend,
         duplicações físicas, backups dentro da produção, rotas HTTP,
         inconsistências entre modules e web\modules e produz uma
         posição assertiva consolidada.

    O script possui interface gráfica WinForms, mas também pode ser
    executado por linha de comandos com -NoGui.

.EXAMPLE
    # Abrir GUI
    pwsh.exe -ExecutionPolicy Bypass -File .\Diagnostico-Santander-V16.ps1

.EXAMPLE
    # Diagnóstico de módulo sem GUI
    pwsh.exe -ExecutionPolicy Bypass `
      -File .\Diagnostico-Santander-V16.ps1 `
      -NoGui `
      -Mode Module `
      -ModulePath "C:\Temp\SantanderSupportWebV2_PROD\modules\intune-conformidade-mobile"

.EXAMPLE
    # Sistema completo
    pwsh.exe -ExecutionPolicy Bypass `
      -File .\Diagnostico-Santander-V16.ps1 `
      -NoGui `
      -Mode FullSystem `
      -Root "C:\Temp\SantanderSupportWebV2_PROD"
#>

[CmdletBinding()]
param(
    [string]$Root = "C:\Temp\SantanderSupportWebV2_PROD",

    [ValidateSet("Module","CommonPages","FullSystem")]
    [string]$Mode = "Module",

    [string]$ModulePath = "",

    [string]$ReferenceModulePath = "",

    [string]$BaseUrl = "http://localhost:8080",

    [switch]$NoGui,

    [switch]$OpenReport
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

# -------------------------------------------------------------------------
# Estado
# -------------------------------------------------------------------------

$script:Results = New-Object System.Collections.Generic.List[object]
$script:Actions = New-Object System.Collections.Generic.List[string]
$script:LastReportPath = ""
$script:Catalog = $null
$script:CatalogRaw = ""
$script:MainForm = $null
$script:Grid = $null
$script:SummaryLabel = $null
$script:StatusLabel = $null
$script:ProgressBar = $null

# -------------------------------------------------------------------------
# Utilitários
# -------------------------------------------------------------------------

function Add-Result {
    param(
        [ValidateSet("OK","INFO","AVISO","ERRO")]
        [string]$Level,

        [string]$Area,

        [string]$Check,

        [string]$Detail,

        [string]$Correction = "",

        [string]$Path = "",

        [int]$Line = 0
    )

    $script:Results.Add([pscustomobject]@{
        Level      = $Level
        Area       = $Area
        Check      = $Check
        Detail     = $Detail
        Correction = $Correction
        Path       = $Path
        Line       = $Line
    })
}

function Add-Action {
    param([string]$Text)

    if (
        -not [string]::IsNullOrWhiteSpace($Text) -and
        -not $script:Actions.Contains($Text)
    ) {
        $script:Actions.Add($Text)
    }
}

function Get-SafeProperty {
    param(
        $Object,
        [string[]]$Names,
        $Default = $null
    )

    if ($null -eq $Object) {
        return $Default
    }

    foreach ($name in $Names) {
        try {
            if ($Object -is [hashtable] -and $Object.ContainsKey($name)) {
                return $Object[$name]
            }

            $property = $Object.PSObject.Properties[$name]

            if ($property) {
                return $property.Value
            }
        }
        catch {}
    }

    return $Default
}

function Read-TextFile {
    param([string]$Path)

    if (-not (Test-Path $Path -PathType Leaf)) {
        return ""
    }

    try {
        return [System.IO.File]::ReadAllText(
            $Path,
            [System.Text.Encoding]::UTF8
        )
    }
    catch {
        return Get-Content $Path -Raw -ErrorAction SilentlyContinue
    }
}

function Get-TextHash {
    param([string]$Text)

    if ($null -eq $Text) {
        return ""
    }

    $sha = [System.Security.Cryptography.SHA256]::Create()

    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)

        return (
            $sha.ComputeHash($bytes) |
            ForEach-Object { $_.ToString("x2") }
        ) -join ""
    }
    finally {
        $sha.Dispose()
    }
}

function Get-FileHashSafe {
    param([string]$Path)

    if (-not (Test-Path $Path -PathType Leaf)) {
        return ""
    }

    try {
        return (Get-FileHash $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    catch {
        return Get-TextHash (Read-TextFile $Path)
    }
}

function Get-LineNumber {
    param(
        [string]$Text,
        [int]$Index
    )

    if ($Index -lt 0) {
        return 0
    }

    return (($Text.Substring(0,$Index) -split "`n").Count)
}

function Test-JsonFile {
    param(
        [string]$Path,
        [string]$Area,
        [string]$Label
    )

    if (-not (Test-Path $Path -PathType Leaf)) {
        Add-Result "ERRO" $Area $Label "Ficheiro não encontrado." "Criar ou restaurar o ficheiro." $Path
        return $null
    }

    try {
        $content = Read-TextFile $Path
        $value = $content | ConvertFrom-Json -ErrorAction Stop

        Add-Result "OK" $Area $Label "JSON válido." "" $Path
        return $value
    }
    catch {
        Add-Result "ERRO" $Area $Label "JSON inválido: $($_.Exception.Message)" "Corrigir a sintaxe JSON." $Path
        return $null
    }
}

function Test-PowerShellSyntax {
    param(
        [string]$Path,
        [string]$Area
    )

    if (-not (Test-Path $Path -PathType Leaf)) {
        return
    }

    $tokens = $null
    $errors = $null

    [void][System.Management.Automation.Language.Parser]::ParseFile(
        $Path,
        [ref]$tokens,
        [ref]$errors
    )

    if (@($errors).Count -eq 0) {
        Add-Result "OK" $Area "Sintaxe PowerShell" "Sem erros de sintaxe." "" $Path
        return
    }

    foreach ($errorItem in @($errors)) {
        Add-Result `
            "ERRO" `
            $Area `
            "Sintaxe PowerShell" `
            $errorItem.Message `
            "Corrigir a linha indicada." `
            $Path `
            $errorItem.Extent.StartLineNumber
    }
}

function Test-JavaScriptHeuristic {
    param(
        [string]$Path,
        [string]$Area
    )

    if (-not (Test-Path $Path -PathType Leaf)) {
        return
    }

    $text = Read-TextFile $Path

    $openBraces  = ([regex]::Matches($text,'\{')).Count
    $closeBraces = ([regex]::Matches($text,'\}')).Count
    $openParens  = ([regex]::Matches($text,'\(')).Count
    $closeParens = ([regex]::Matches($text,'\)')).Count
    $openSquares = ([regex]::Matches($text,'\[')).Count
    $closeSquares= ([regex]::Matches($text,'\]')).Count

    if (
        $openBraces -eq $closeBraces -and
        $openParens -eq $closeParens -and
        $openSquares -eq $closeSquares
    ) {
        Add-Result "OK" $Area "Equilíbrio JavaScript" "Chavetas, parênteses e colchetes equilibrados." "" $Path
    }
    else {
        Add-Result `
            "AVISO" `
            $Area `
            "Equilíbrio JavaScript" `
            "Contagens: {$openBraces/$closeBraces} ($openParens/$closeParens) [$openSquares/$closeSquares]." `
            "Validar a sintaxe do JavaScript num editor ou Node.js." `
            $Path
    }

    if ($text -match 'DOMContentLoaded|window\.onload|\(\s*function\s*\(|=>\s*\{|function\s+init|window\.[A-Za-z0-9_]*init') {
        Add-Result "OK" $Area "Inicialização JavaScript" "Foi encontrado um mecanismo provável de inicialização." "" $Path
    }
    else {
        Add-Result `
            "AVISO" `
            $Area `
            "Inicialização JavaScript" `
            "Não foi identificado DOMContentLoaded, IIFE, onload ou init." `
            "Confirmar que o script funciona quando é injetado dinamicamente." `
            $Path
    }
}

function Invoke-HttpSafe {
    param(
        [string]$Uri,
        [string]$Method = "GET",
        [string]$Body = "",
        [int]$TimeoutSec = 12
    )

    try {
        $parameters = @{
            Uri         = $Uri
            Method      = $Method
            TimeoutSec  = $TimeoutSec
            UseBasicParsing = $true
            ErrorAction = "Stop"
        }

        if (-not [string]::IsNullOrWhiteSpace($Body)) {
            $parameters["Body"] = $Body
            $parameters["ContentType"] = "application/json"
        }

        $response = Invoke-WebRequest @parameters

        return [pscustomobject]@{
            Success     = $true
            StatusCode  = [int]$response.StatusCode
            ContentType = [string]$response.Headers["Content-Type"]
            Body        = [string]$response.Content
            Error       = ""
        }
    }
    catch {
        $status = 0
        $body = ""

        try {
            if ($_.Exception.Response) {
                $status = [int]$_.Exception.Response.StatusCode

                $stream = $_.Exception.Response.GetResponseStream()

                if ($stream) {
                    $reader = New-Object System.IO.StreamReader($stream)

                    try {
                        $body = $reader.ReadToEnd()
                    }
                    finally {
                        $reader.Dispose()
                    }
                }
            }
        }
        catch {}

        return [pscustomobject]@{
            Success     = $false
            StatusCode  = $status
            ContentType = ""
            Body        = $body
            Error       = $_.Exception.Message
        }
    }
}

function Find-AppJs {
    param([string]$RootPath)

    $preferred = @(
        (Join-Path $RootPath "web\js\app.js"),
        (Join-Path $RootPath "js\app.js"),
        (Join-Path $RootPath "app.js")
    )

    foreach ($candidate in $preferred) {
        if (Test-Path $candidate -PathType Leaf) {
            return $candidate
        }
    }

    return (
        Get-ChildItem $RootPath -Recurse -File -Filter "app.js" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\backup|_backup|\\modules\\' } |
        Select-Object -First 1 -ExpandProperty FullName
    )
}

function Find-Router {
    param([string]$RootPath)

    $preferred = @(
        (Join-Path $RootPath "core\router.ps1"),
        (Join-Path $RootPath "router.ps1")
    )

    foreach ($candidate in $preferred) {
        if (Test-Path $candidate -PathType Leaf) {
            return $candidate
        }
    }

    return (
        Get-ChildItem $RootPath -Recurse -File -Filter "router.ps1" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\backup|_backup' } |
        Select-Object -First 1 -ExpandProperty FullName
    )
}

function Get-ModuleNameFromPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return ""
    }

    return (Split-Path $Path -Leaf)
}

function Get-HtmlIdsAndClasses {
    param([string]$Html)

    $ids = @(
        [regex]::Matches(
            $Html,
            'id\s*=\s*["'']([^"'']+)["'']',
            [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
        ) |
        ForEach-Object { $_.Groups[1].Value }
    )

    $classes = New-Object System.Collections.Generic.List[string]

    foreach ($match in [regex]::Matches(
        $Html,
        'class\s*=\s*["'']([^"'']+)["'']',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )) {
        foreach ($name in ($match.Groups[1].Value -split '\s+')) {
            if (-not [string]::IsNullOrWhiteSpace($name)) {
                $classes.Add($name)
            }
        }
    }

    return [pscustomobject]@{
        Ids     = @($ids | Sort-Object -Unique)
        Classes = @($classes | Sort-Object -Unique)
    }
}

function Get-CssSelectors {
    param([string]$Css)

    $withoutComments = [regex]::Replace(
        $Css,
        '/\*[\s\S]*?\*/',
        ""
    )

    $selectors = New-Object System.Collections.Generic.List[string]

    foreach ($match in [regex]::Matches($withoutComments,'(?ms)([^{}]+)\{')) {
        $header = $match.Groups[1].Value.Trim()

        if ($header.StartsWith("@")) {
            continue
        }

        foreach ($selector in ($header -split ',')) {
            $value = $selector.Trim()

            if (-not [string]::IsNullOrWhiteSpace($value)) {
                $selectors.Add($value)
            }
        }
    }

    return @($selectors | Sort-Object -Unique)
}

function Test-CssCoverage {
    param(
        [string[]]$Selectors,
        [string[]]$HtmlIds,
        [string[]]$HtmlClasses
    )

    $matched = 0
    $testable = 0

    foreach ($selector in $Selectors) {
        $tokens = @(
            [regex]::Matches($selector,'([.#])([A-Za-z_][A-Za-z0-9_-]*)') |
            ForEach-Object {
                [pscustomobject]@{
                    Type = $_.Groups[1].Value
                    Name = $_.Groups[2].Value
                }
            }
        )

        if ($tokens.Count -eq 0) {
            continue
        }

        $testable++
        $allFound = $true

        foreach ($token in $tokens) {
            if ($token.Type -eq "." -and $HtmlClasses -notcontains $token.Name) {
                $allFound = $false
            }

            if ($token.Type -eq "#" -and $HtmlIds -notcontains $token.Name) {
                $allFound = $false
            }
        }

        if ($allFound) {
            $matched++
        }
    }

    return [pscustomobject]@{
        Testable = $testable
        Matched  = $matched
        Percent  = if ($testable -gt 0) {
            [math]::Round(($matched / $testable) * 100,1)
        }
        else {
            100
        }
    }
}

function Get-CatalogEntries {
    param($CatalogObject)

    $entries = New-Object System.Collections.Generic.List[object]

    function Walk-Catalog {
        param($Value)

        if ($null -eq $Value) {
            return
        }

        if ($Value -is [string] -or $Value -is [ValueType]) {
            return
        }

        if (
            $Value -is [System.Collections.IEnumerable] -and
            -not ($Value -is [pscustomobject]) -and
            -not ($Value -is [hashtable])
        ) {
            foreach ($item in $Value) {
                Walk-Catalog $item
            }

            return
        }

        $name = [string](Get-SafeProperty $Value @("name","id","module","slug") "")
        $title = [string](Get-SafeProperty $Value @("title") "")
        $description = [string](Get-SafeProperty $Value @("description") "")
        $category = [string](Get-SafeProperty $Value @("category") "")
        $enabled = Get-SafeProperty $Value @("enabled","active") $null

        if (-not [string]::IsNullOrWhiteSpace($name)) {
            $entries.Add([pscustomobject]@{
                Name        = $name
                Title       = $title
                Description = $description
                Category    = $category
                Enabled     = $enabled
                Raw         = $Value
            })
        }

        foreach ($property in $Value.PSObject.Properties) {
            if ($property.Value -ne $Value) {
                Walk-Catalog $property.Value
            }
        }
    }

    Walk-Catalog $CatalogObject

    return @(
        $entries |
        Group-Object Name |
        ForEach-Object { $_.Group[0] }
    )
}

function Load-Catalog {
    param([string]$Url)

    $script:Catalog = $null
    $script:CatalogRaw = ""

    $result = Invoke-HttpSafe "$Url/api/modules"

    if (-not $result.Success) {
        Add-Result `
            "ERRO" `
            "Catálogo" `
            "GET /api/modules" `
            "Falhou: HTTP $($result.StatusCode) $($result.Error)" `
            "Confirmar que o servidor está iniciado e que a rota existe."

        return @()
    }

    Add-Result "OK" "Catálogo" "GET /api/modules" "HTTP $($result.StatusCode)."

    $script:CatalogRaw = $result.Body

    try {
        $script:Catalog = $result.Body | ConvertFrom-Json -ErrorAction Stop
        $entries = @(Get-CatalogEntries $script:Catalog)

        Add-Result "OK" "Catálogo" "JSON do catálogo" "$($entries.Count) módulo(s) identificado(s)."
        return $entries
    }
    catch {
        Add-Result `
            "ERRO" `
            "Catálogo" `
            "JSON do catálogo" `
            "Não foi possível interpretar: $($_.Exception.Message)" `
            "Corrigir encoding ou estrutura devolvida pelo endpoint."

        return @()
    }
}

function Test-Server {
    param([string]$Url)

    try {
        $uri = [uri]$Url
        $port = if ($uri.IsDefaultPort) {
            if ($uri.Scheme -eq "https") { 443 } else { 80 }
        }
        else {
            $uri.Port
        }

        $connection = Get-NetTCPConnection `
            -LocalPort $port `
            -State Listen `
            -ErrorAction SilentlyContinue |
            Select-Object -First 1

        if ($connection) {
            $process = Get-Process `
                -Id $connection.OwningProcess `
                -ErrorAction SilentlyContinue

            Add-Result `
                "OK" `
                "Servidor" `
                "Porta $port" `
                "PID=$($connection.OwningProcess) Processo=$($process.ProcessName)"
        }
        else {
            Add-Result `
                "ERRO" `
                "Servidor" `
                "Porta $port" `
                "Nada está a escutar nesta porta." `
                "Executar o start-prod.ps1."
        }
    }
    catch {
        Add-Result "AVISO" "Servidor" "Porta" "Não foi possível consultar a porta: $($_.Exception.Message)"
    }

    $homeResponse = Invoke-HttpSafe "$Url/"

    if ($homeResponse.Success) {
        Add-Result "OK" "Servidor" "Página principal" "HTTP $($homeResponse.StatusCode) $($homeResponse.ContentType)"
    }
    else {
        Add-Result `
            "ERRO" `
            "Servidor" `
            "Página principal" `
            "Falhou: HTTP $($homeResponse.StatusCode) $($homeResponse.Error)" `
            "Confirmar o servidor e a URL."
    }
}

# -------------------------------------------------------------------------
# Diagnóstico de módulo
# -------------------------------------------------------------------------

function Test-ModuleStructure {
    param(
        [string]$Path,
        [string]$Label = "Módulo"
    )

    $moduleName = Get-ModuleNameFromPath $Path
    $area = "${Label}: $moduleName"

    if (-not (Test-Path $Path -PathType Container)) {
        Add-Result "ERRO" $area "Pasta" "Pasta não encontrada." "Selecionar uma pasta válida." $Path
        return $null
    }

    Add-Result "OK" $area "Pasta" $Path "" $Path

    $requiredFiles = @(
        "module.json",
        "page.html",
        "script.js",
        "style.css",
        "api.ps1",
        "config.json"
    )

    foreach ($fileName in $requiredFiles) {
        $filePath = Join-Path $Path $fileName

        if (Test-Path $filePath -PathType Leaf) {
            $file = Get-Item $filePath

            Add-Result `
                "OK" `
                $area `
                "Ficheiro $fileName" `
                "$($file.Length) bytes" `
                "" `
                $filePath
        }
        else {
            $level = if ($fileName -in @("config.json","style.css")) {
                "AVISO"
            }
            else {
                "ERRO"
            }

            Add-Result `
                $level `
                $area `
                "Ficheiro $fileName" `
                "Não encontrado." `
                "Criar ou restaurar o ficheiro." `
                $filePath
        }
    }

    $manifestPath = Join-Path $Path "module.json"
    $manifest = Test-JsonFile $manifestPath $area "module.json"

    if ($manifest) {
        $identifier = [string](Get-SafeProperty $manifest @("name","id","module","slug") "")
        $enabled = Get-SafeProperty $manifest @("enabled","active") $null

        if ($identifier -eq $moduleName) {
            Add-Result "OK" $area "Identificador" "Valor='$identifier'."
        }
        else {
            Add-Result `
                "ERRO" `
                $area `
                "Identificador" `
                "Manifesto='$identifier'; pasta='$moduleName'." `
                "Definir o identificador igual ao nome da pasta." `
                $manifestPath
        }

        if ($null -eq $enabled) {
            Add-Result "AVISO" $area "Enabled" "Propriedade ausente." "Adicionar enabled=true." $manifestPath
        }
        elseif ([bool]$enabled) {
            Add-Result "OK" $area "Enabled" "True."
        }
        else {
            Add-Result "ERRO" $area "Enabled" "False." "Alterar para true." $manifestPath
        }
    }

    $configPath = Join-Path $Path "config.json"

    if (Test-Path $configPath -PathType Leaf) {
        [void](Test-JsonFile $configPath $area "config.json")
    }

    Test-PowerShellSyntax (Join-Path $Path "api.ps1") $area
    Test-JavaScriptHeuristic (Join-Path $Path "script.js") $area

    $pagePath = Join-Path $Path "page.html"
    $stylePath = Join-Path $Path "style.css"

    if (Test-Path $pagePath -PathType Leaf) {
        $html = Read-TextFile $pagePath
        $dom = Get-HtmlIdsAndClasses $html
        $duplicates = @(
            [regex]::Matches(
                $html,
                'id\s*=\s*["'']([^"'']+)["'']',
                [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
            ) |
            ForEach-Object { $_.Groups[1].Value } |
            Group-Object |
            Where-Object Count -gt 1
        )

        if ($duplicates.Count -eq 0) {
            Add-Result "OK" $area "IDs HTML" "Nenhum ID duplicado." "" $pagePath
        }
        else {
            Add-Result `
                "ERRO" `
                $area `
                "IDs HTML" `
                (($duplicates.Name) -join ", ") `
                "Renomear IDs repetidos." `
                $pagePath
        }

        if ($html -match '<script\b') {
            Add-Result "INFO" $area "Script no page.html" "Existe uma tag script direta." "" $pagePath
        }
        else {
            Add-Result "INFO" $area "Script no page.html" "Sem tag script direta; depende do carregador central." "" $pagePath
        }

        if ($html -match '<style\b|stylesheet|style\.css') {
            Add-Result "INFO" $area "CSS no page.html" "Foi encontrada referência ou bloco CSS." "" $pagePath
        }
        else {
            Add-Result `
                "AVISO" `
                $area `
                "CSS no page.html" `
                "Sem referência ou bloco CSS." `
                "Confirmar que o carregador central injeta o style.css." `
                $pagePath
        }

        if (Test-Path $stylePath -PathType Leaf) {
            $css = Read-TextFile $stylePath
            $selectors = @(Get-CssSelectors $css)
            $coverage = Test-CssCoverage `
                -Selectors $selectors `
                -HtmlIds $dom.Ids `
                -HtmlClasses $dom.Classes

            Add-Result `
                "INFO" `
                $area `
                "Cobertura CSS/HTML" `
                "$($coverage.Matched) de $($coverage.Testable) seletores testáveis correspondem ($($coverage.Percent)%)." `
                "" `
                $stylePath

            if ($coverage.Testable -ge 10 -and $coverage.Percent -lt 25) {
                Add-Result `
                    "ERRO" `
                    $area `
                    "Escopo CSS" `
                    "Poucos seletores correspondem ao HTML." `
                    "Comparar classes/IDs entre page.html e style.css." `
                    $stylePath
            }
        }
    }

    return [pscustomobject]@{
        Name     = $moduleName
        Path     = $Path
        Manifest = $manifest
    }
}

function Test-ModuleHttp {
    param(
        [string]$ModuleName,
        [string]$ModulePathValue,
        [string]$Url
    )

    $area = "HTTP: $ModuleName"

    $tests = @(
        [pscustomobject]@{ Name="Page";   Uri="$Url/module/$ModuleName/page";   Required=$true  },
        [pscustomobject]@{ Name="Script"; Uri="$Url/module/$ModuleName/script"; Required=$true  },
        [pscustomobject]@{ Name="CSS";    Uri="$Url/module/$ModuleName/style";  Required=$false },
        [pscustomobject]@{ Name="CSS css";Uri="$Url/module/$ModuleName/css";    Required=$false },
        [pscustomobject]@{ Name="CSS file";Uri="$Url/module/$ModuleName/style.css";Required=$false },
        [pscustomobject]@{ Name="API status";Uri="$Url/module/$ModuleName/api?action=status";Required=$true },
        [pscustomobject]@{ Name="Rota curta";Uri="$Url/module/$ModuleName";Required=$false }
    )

    $responses = @{}

    foreach ($test in $tests) {
        $response = Invoke-HttpSafe $test.Uri
        $responses[$test.Name] = $response

        if ($response.Success) {
            Add-Result `
                "OK" `
                $area `
                $test.Name `
                "HTTP $($response.StatusCode) $($response.ContentType)."
        }
        else {
            $level = if ($test.Required) { "ERRO" } else { "INFO" }

            Add-Result `
                $level `
                $area `
                $test.Name `
                "HTTP $($response.StatusCode). $($response.Error)" `
                $(if ($test.Required) { "Rever o router e o ficheiro do módulo." } else { "" })
        }
    }

    if (
        $responses.ContainsKey("Page") -and
        $responses["Page"].Success -and
        (Test-Path (Join-Path $ModulePathValue "page.html") -PathType Leaf)
    ) {
        $local = Read-TextFile (Join-Path $ModulePathValue "page.html")
        $served = $responses["Page"].Body

        if ((Get-TextHash $local) -eq (Get-TextHash $served)) {
            Add-Result "OK" $area "Page local versus servido" "Conteúdo idêntico."
        }
        else {
            Add-Result `
                "AVISO" `
                $area `
                "Page local versus servido" `
                "O HTML servido é diferente do page.html da pasta selecionada." `
                "Verificar se o router lê web\modules, cache ou outra cópia."
        }
    }

    if (
        $responses.ContainsKey("Script") -and
        $responses["Script"].Success -and
        (Test-Path (Join-Path $ModulePathValue "script.js") -PathType Leaf)
    ) {
        $localScript = Read-TextFile (Join-Path $ModulePathValue "script.js")

        if ((Get-TextHash $localScript) -eq (Get-TextHash $responses["Script"].Body)) {
            Add-Result "OK" $area "Script local versus servido" "Conteúdo idêntico."
        }
        else {
            Add-Result `
                "AVISO" `
                $area `
                "Script local versus servido" `
                "O JavaScript servido é diferente do ficheiro local." `
                "Localizar a cópia realmente publicada."
        }
    }

    $cssWorks = (
        ($responses.ContainsKey("CSS") -and $responses["CSS"].Success) -or
        ($responses.ContainsKey("CSS css") -and $responses["CSS css"].Success) -or
        ($responses.ContainsKey("CSS file") -and $responses["CSS file"].Success)
    )

    if ($cssWorks) {
        Add-Result "OK" $area "Publicação CSS" "Pelo menos uma rota CSS respondeu 200."
    }
    else {
        Add-Result `
            "ERRO" `
            $area `
            "Publicação CSS" `
            "Nenhuma rota CSS conhecida respondeu 200." `
            "Implementar uma rota CSS ou carregar style.css pelo app.js."
    }

    $apiResponse = $responses["API status"]

    if ($apiResponse.Success) {
        $body = [string]$apiResponse.Body

        if ($body -match 'Action não informada|Action nao informada|não suportada:\s*["}]|nao suportada:\s*["}]') {
            Add-Result `
                "ERRO" `
                $area `
                "Leitura da action" `
                "A query contém action=status, mas a API afirma que a action está vazia." `
                "Corrigir a leitura de `$Query no api.ps1."
        }
    }
}

function Compare-Modules {
    param(
        $PrimaryInfo,
        $ReferenceInfo
    )

    if ($null -eq $PrimaryInfo -or $null -eq $ReferenceInfo) {
        return
    }

    $area = "Comparação de módulos"

    foreach ($fileName in @("page.html","script.js","style.css","api.ps1","module.json")) {
        $primaryFile = Join-Path $PrimaryInfo.Path $fileName
        $referenceFile = Join-Path $ReferenceInfo.Path $fileName

        if (
            (Test-Path $primaryFile -PathType Leaf) -and
            (Test-Path $referenceFile -PathType Leaf)
        ) {
            $primarySize = (Get-Item $primaryFile).Length
            $referenceSize = (Get-Item $referenceFile).Length

            Add-Result `
                "INFO" `
                $area `
                $fileName `
                "Módulo=$primarySize bytes | Referência=$referenceSize bytes."
        }
    }

    $primaryJs = Read-TextFile (Join-Path $PrimaryInfo.Path "script.js")
    $referenceJs = Read-TextFile (Join-Path $ReferenceInfo.Path "script.js")

    $patterns = @(
        [pscustomobject]@{ Name="IIFE"; Regex='\(\s*function\s*\(' },
        [pscustomobject]@{ Name="DOMContentLoaded"; Regex='DOMContentLoaded' },
        [pscustomobject]@{ Name="Init global"; Regex='window\.[A-Za-z0-9_]*init|function\s+init' }
    )

    foreach ($pattern in $patterns) {
        $primaryHas = $primaryJs -match $pattern.Regex
        $referenceHas = $referenceJs -match $pattern.Regex

        if ($referenceHas -and -not $primaryHas) {
            Add-Result `
                "AVISO" `
                $area `
                "Contrato JS: $($pattern.Name)" `
                "A referência usa este padrão e o módulo não." `
                "Avaliar adoção do mesmo padrão."
        }
    }
}


# -------------------------------------------------------------------------
# Diagnóstico aprofundado de carregadores, rotas e customizações
# -------------------------------------------------------------------------
function Get-TextMatchDetails {
    param(
        [string]$Text,
        [string]$Pattern,
        [int]$ContextBefore = 1,
        [int]$ContextAfter = 1,
        [int]$Maximum = 30
    )

    $lines = @($Text -split "`r?`n")
    $regex = New-Object System.Text.RegularExpressions.Regex(
        $Pattern,
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )

    $items = New-Object System.Collections.Generic.List[object]

    for ($index = 0; $index -lt $lines.Count; $index++) {
        if ($regex.IsMatch([string]$lines[$index])) {
            $start = [Math]::Max(0, $index - $ContextBefore)
            $end = [Math]::Min($lines.Count - 1, $index + $ContextAfter)
            $context = New-Object System.Collections.Generic.List[string]

            for ($lineIndex = $start; $lineIndex -le $end; $lineIndex++) {
                $context.Add(("L{0}: {1}" -f ($lineIndex + 1), $lines[$lineIndex].TrimEnd()))
            }

            $items.Add([pscustomobject]@{
                Line = $index + 1
                Text = [string]$lines[$index]
                Context = $context -join " | "
            })

            if ($items.Count -ge $Maximum) {
                break
            }
        }
    }

    return $items.ToArray()
}

function Get-JavaScriptFunctionBlock {
    param(
        [string]$Text,
        [string]$FunctionName
    )

    $match = [regex]::Match(
        $Text,
        '(?is)(?:async\s+)?function\s+' + [regex]::Escape($FunctionName) + '\s*\([^)]*\)\s*\{'
    )

    if (-not $match.Success) {
        return $null
    }

    $start = $match.Index
    $braceStart = $Text.IndexOf('{', $match.Index)
    if ($braceStart -lt 0) { return $null }

    $depth = 0
    $quote = [char]0
    $escaped = $false

    for ($i = $braceStart; $i -lt $Text.Length; $i++) {
        $char = $Text[$i]

        if ($quote -ne [char]0) {
            if ($escaped) {
                $escaped = $false
                continue
            }
            if ($char -eq '\\') {
                $escaped = $true
                continue
            }
            if ($char -eq $quote) {
                $quote = [char]0
            }
            continue
        }

        if ($char -eq '"' -or $char -eq "'" -or $char -eq '`') {
            $quote = $char
            continue
        }

        if ($char -eq '{') { $depth++ }
        elseif ($char -eq '}') {
            $depth--
            if ($depth -eq 0) {
                return $Text.Substring($start, ($i - $start + 1))
            }
        }
    }

    return $Text.Substring($start)
}

function Add-DeepLoaderDiagnostics {
    param(
        [string]$AppPath,
        [string]$AppText,
        [string]$RouterPath,
        [string]$RouterText,
        [string[]]$FocusModuleNames = @()
    )

    if ($AppPath -and $AppText) {
        $abrirBlock = Get-JavaScriptFunctionBlock -Text $AppText -FunctionName 'abrirModulo'

        if ($abrirBlock) {
            $callsScript = $abrirBlock -match '\bcarregarScriptModulo\s*\('
            $callsCss = $abrirBlock -match '\b(carregarCssModulo|loadModuleCss|carregarModuloAssets|loadModuleAssets)\s*\('
            $setsHtml = $abrirBlock -match 'innerHTML\s*=|insertAdjacentHTML\s*\('

            Add-Result 'INFO' 'Diagnóstico Profundo' 'Fluxo abrirModulo' (
                "HTML=$setsHtml; Script=$callsScript; CSS=$callsCss; Tamanho=$($abrirBlock.Length) caracteres."
            ) '' $AppPath

            if (-not $callsCss) {
                Add-Result 'ERRO' 'Diagnóstico Profundo' 'abrirModulo sem CSS' (
                    'A função abrirModulo foi extraída e não chama nenhum carregador CSS/assets conhecido.'
                ) 'Adicionar chamada explícita a carregarCssModulo(moduleName).' $AppPath
            }
        }
        else {
            Add-Result 'AVISO' 'Diagnóstico Profundo' 'Extração de abrirModulo' (
                'Não foi possível extrair o corpo completo da função.'
            ) 'Rever se abrirModulo usa arrow function, atribuição ou sintaxe não convencional.' $AppPath
        }

        $patterns = @(
            [pscustomobject]@{ Name='Criação de LINK CSS'; Regex='document\.createElement\(\s*["'']link["'']\s*\)' },
            [pscustomobject]@{ Name='Função carregarCssModulo'; Regex='(?:async\s+)?function\s+carregarCssModulo\s*\(' },
            [pscustomobject]@{ Name='Chamada carregarCssModulo'; Regex='\bcarregarCssModulo\s*\(' },
            [pscustomobject]@{ Name='Navegação direta de módulo'; Regex='window\.location(?:\.href|\.assign)?|location\.href|MODULE_URL\s*=' },
            [pscustomobject]@{ Name='MODULE_ID'; Regex='MODULE_ID\s*=\s*["''][^"'']+["'']' },
            [pscustomobject]@{ Name='Gerador catálogo'; Regex='todosModulos\.forEach|abrirModulo\s*\(' }
        )

        foreach ($entry in $patterns) {
            $details = @(Get-TextMatchDetails -Text $AppText -Pattern $entry.Regex -Maximum 40)
            if ($details.Count -eq 0) {
                Add-Result 'INFO' 'Código app.js' $entry.Name 'Nenhuma ocorrência.' '' $AppPath
                continue
            }

            $lineList = @($details | ForEach-Object { $_.Line }) -join ', '
            Add-Result 'INFO' 'Código app.js' $entry.Name (
                "$($details.Count) ocorrência(s). Linha(s): $lineList."
            ) '' $AppPath

            foreach ($detail in $details) {
                Add-Result 'INFO' 'Trecho app.js' ("$($entry.Name) L$($detail.Line)") $detail.Context '' $AppPath
            }
        }

        foreach ($focusName in $FocusModuleNames) {
            if ([string]::IsNullOrWhiteSpace($focusName)) { continue }
            $details = @(Get-TextMatchDetails -Text $AppText -Pattern ([regex]::Escape($focusName)) -Maximum 60)
            $lineList = @($details | ForEach-Object { $_.Line }) -join ', '
            $focusMessage = 'Nenhuma ocorrência.'
            if ($details.Count -gt 0) {
                $focusMessage = "$($details.Count) ocorrência(s): $lineList."
            }
            Add-Result 'INFO' 'Código app.js' "Linhas de $focusName" $focusMessage '' $AppPath

            foreach ($detail in $details) {
                Add-Result 'INFO' 'Trecho módulo no app.js' ("$focusName L$($detail.Line)") $detail.Context '' $AppPath
            }
        }
    }

    if ($RouterPath -and $RouterText) {
        $routerPatterns = @(
            [pscustomobject]@{ Name='Rota page'; Regex='page\.html|["'']page["'']' },
            [pscustomobject]@{ Name='Rota script'; Regex='script\.js|["'']script["'']|application/javascript' },
            [pscustomobject]@{ Name='Rota API'; Regex='api\.ps1|["'']api["'']' },
            [pscustomobject]@{ Name='Rota CSS'; Regex='style\.css|["'']style["'']|["'']css["'']|text/css' },
            [pscustomobject]@{ Name='Origem modules'; Regex='web[\\/]modules|Join-Path[^\r\n]*modules|[\\/]modules[\\/]' },
            [pscustomobject]@{ Name='Tratamento /module'; Regex='\/module\/|modulePath|moduleName|moduleId' }
        )

        foreach ($entry in $routerPatterns) {
            $details = @(Get-TextMatchDetails -Text $RouterText -Pattern $entry.Regex -Maximum 50)
            if ($details.Count -eq 0) {
                $level = if ($entry.Name -eq 'Rota CSS') { 'ERRO' } else { 'INFO' }
                $correction = ''
                if ($entry.Name -eq 'Rota CSS') {
                    $correction = 'Adicionar tratamento explícito para style.css ou style/css.'
                }
                Add-Result $level 'Código router.ps1' $entry.Name 'Nenhuma ocorrência.' $correction $RouterPath
                continue
            }

            $lineList = @($details | ForEach-Object { $_.Line }) -join ', '
            Add-Result 'INFO' 'Código router.ps1' $entry.Name (
                "$($details.Count) ocorrência(s). Linha(s): $lineList."
            ) '' $RouterPath

            foreach ($detail in $details) {
                Add-Result 'INFO' 'Trecho router.ps1' ("$($entry.Name) L$($detail.Line)") $detail.Context '' $RouterPath
            }
        }
    }
}

# -------------------------------------------------------------------------
# Diagnóstico das páginas comuns e framework
# -------------------------------------------------------------------------

function Test-CommonFramework {
    param(
        [string]$RootPath,
        [string]$Url,
        [string[]]$FocusModuleNames = @()
    )

    $appPath = Find-AppJs $RootPath
    $routerPath = Find-Router $RootPath
    $globalCssPath = Join-Path $RootPath "web\css\style.css"

    if ($appPath) {
        Add-Result "OK" "Framework Frontend" "app.js" $appPath "" $appPath
        Test-JavaScriptHeuristic $appPath "Framework Frontend"

        $appText = Read-TextFile $appPath

        foreach ($functionName in @(
            "carregarFerramentas",
            "carregarRelatorios",
            "abrirModulo",
            "carregarScriptModulo",
            "abrirModuloSeguro"
        )) {
            if ($appText -match ("function\s+" + [regex]::Escape($functionName) + "\s*\(")) {
                Add-Result "OK" "Framework Frontend" "Função $functionName" "Encontrada." "" $appPath
            }
            else {
                $level = if ($functionName -in @("carregarFerramentas","abrirModulo","carregarScriptModulo")) {
                    "ERRO"
                }
                else {
                    "AVISO"
                }

                Add-Result `
                    $level `
                    "Framework Frontend" `
                    "Função $functionName" `
                    "Não encontrada." `
                    "Comparar com uma versão funcional do app.js." `
                    $appPath
            }
        }

        if ($appText -match 'document\.createElement\(\s*["'']link["'']\s*\)|carregarCssModulo|module-style-|/style\b|/css\b') {
            Add-Result "OK" "Framework Frontend" "Carregamento CSS modular" "Há indícios de carregamento/injeção de CSS." "" $appPath
        }
        else {
            Add-Result `
                "ERRO" `
                "Framework Frontend" `
                "Carregamento CSS modular" `
                "Não foi encontrado carregador CSS modular." `
                "Criar carregarCssModulo(moduleName) e chamá-la em abrirModulo." `
                $appPath
        }

        if ($appText -match 'window\.location\.(assign|href).*/module/|MODULE_URL\s*=\s*["'']/module/') {
            Add-Result `
                "ERRO" `
                "Framework Frontend" `
                "Navegação direta /module/NOME" `
                "Há código que navega para uma rota curta que pode devolver 404." `
                "Usar abrirModulo() para os cartões." `
                $appPath
        }

        $allModuleIds = @(
            [regex]::Matches(
                $appText,
                'MODULE_ID\s*=\s*["'']([^"'']+)["'']',
                [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
            ) |
            ForEach-Object { $_.Groups[1].Value }
        )

        $duplicateCustomIds = @(
            $allModuleIds |
            Group-Object |
            Where-Object Count -gt 1
        )

        foreach ($duplicate in $duplicateCustomIds) {
            Add-Result `
                "ERRO" `
                "Framework Frontend" `
                "Blocos personalizados repetidos" `
                "MODULE_ID='$($duplicate.Name)' aparece $($duplicate.Count) vezes." `
                "Remover blocos personalizados e usar o catálogo nativo." `
                $appPath
        }

        foreach ($focusName in $FocusModuleNames) {
            if ([string]::IsNullOrWhiteSpace($focusName)) {
                continue
            }

            $occurrences = @(
                [regex]::Matches(
                    $appText,
                    [regex]::Escape($focusName),
                    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
                )
            )

            Add-Result `
                "INFO" `
                "Framework Frontend" `
                "Ocorrências de $focusName" `
                "$($occurrences.Count) ocorrência(s) no app.js." `
                "" `
                $appPath

            if ($occurrences.Count -gt 4) {
                Add-Result `
                    "AVISO" `
                    "Framework Frontend" `
                    "Possível customização excessiva: $focusName" `
                    "Muitas ocorrências específicas no app.js." `
                    "Idealmente o módulo deve depender apenas do catálogo e do carregador genérico." `
                    $appPath
            }
        }

        $nativeCardBuilder = $appText -match 'todosModulos\.forEach[\s\S]{0,1500}abrirModulo\('

        if ($nativeCardBuilder) {
            Add-Result "OK" "Página Ferramentas" "Gerador nativo de cartões" "Foi localizado todosModulos.forEach com abrirModulo()." "" $appPath
        }
        else {
            Add-Result `
                "ERRO" `
                "Página Ferramentas" `
                "Gerador nativo de cartões" `
                "Não foi identificado o padrão esperado." `
                "Rever carregarFerramentas()." `
                $appPath
        }
    }
    else {
        Add-Result "ERRO" "Framework Frontend" "app.js" "Não encontrado." "Confirmar a estrutura web\js." $RootPath
    }

    if ($routerPath) {
        Add-Result "OK" "Framework Backend" "router.ps1" $routerPath "" $routerPath
        Test-PowerShellSyntax $routerPath "Framework Backend"

        $routerText = Read-TextFile $routerPath

        foreach ($routePart in @("page","script","api")) {
            if ($routerText -match ("['""]" + $routePart + "['""]|Acao.*" + $routePart + "|/" + $routePart)) {
                Add-Result "OK" "Framework Backend" "Suporte a $routePart" "Há referências no router." "" $routerPath
            }
            else {
                Add-Result `
                    "AVISO" `
                    "Framework Backend" `
                    "Suporte a $routePart" `
                    "Não foi identificado claramente." `
                    "Rever o tratamento das rotas dos módulos." `
                    $routerPath
            }
        }

        if ($routerText -match 'style\.css|["'']style["'']|["'']css["'']') {
            Add-Result "OK" "Framework Backend" "Suporte CSS" "Há referências a style/css." "" $routerPath
        }
        else {
            Add-Result `
                "ERRO" `
                "Framework Backend" `
                "Suporte CSS" `
                "Não há suporte claro a CSS modular." `
                "Adicionar rota style/css ou usar injeção no frontend." `
                $routerPath
        }

        if ($routerText -match 'web\\modules|web/modules') {
            Add-Result "INFO" "Framework Backend" "Origem web\modules" "O router pode usar a cópia publicada em web\modules." "" $routerPath
        }

        if ($routerText -match 'modules\\\$|Join-Path.*modules') {
            Add-Result "INFO" "Framework Backend" "Origem modules" "O router contém referências à pasta modules." "" $routerPath
        }
    }
    else {
        Add-Result "ERRO" "Framework Backend" "router.ps1" "Não encontrado." "Confirmar a pasta core." $RootPath
    }


    Add-DeepLoaderDiagnostics `
        -AppPath $appPath `
        -AppText $(if ($appPath) { Read-TextFile $appPath } else { $null }) `
        -RouterPath $routerPath `
        -RouterText $(if ($routerPath) { Read-TextFile $routerPath } else { $null }) `
        -FocusModuleNames $FocusModuleNames

    if (Test-Path $globalCssPath -PathType Leaf) {
        Add-Result "OK" "Página Ferramentas" "CSS global" "$((Get-Item $globalCssPath).Length) bytes." "" $globalCssPath
    }
    else {
        Add-Result "ERRO" "Página Ferramentas" "CSS global" "web\css\style.css não encontrado." "Restaurar o CSS global." $globalCssPath
    }

    $homeResponse = Invoke-HttpSafe "$Url/"

    if ($homeResponse.Success) {
        if ($homeResponse.Body -match 'app\.js') {
            Add-Result "OK" "Página Ferramentas" "Referência app.js" "A página principal referencia app.js."
        }
        else {
            Add-Result "AVISO" "Página Ferramentas" "Referência app.js" "Não localizada no HTML principal."
        }

        if ($homeResponse.Body -match 'style\.css') {
            Add-Result "OK" "Página Ferramentas" "Referência CSS global" "A página principal referencia style.css."
        }
        else {
            Add-Result "AVISO" "Página Ferramentas" "Referência CSS global" "Não localizada no HTML principal."
        }
    }
    # Duplicações físicas entre modules e web\modules
    $modulesRoot = Join-Path $RootPath "modules"
    $webModulesRoot = Join-Path $RootPath "web\modules"

    if (
        (Test-Path $modulesRoot -PathType Container) -and
        (Test-Path $webModulesRoot -PathType Container)
    ) {
        foreach ($moduleDirectory in Get-ChildItem $modulesRoot -Directory -ErrorAction SilentlyContinue) {
            $webCopy = Join-Path $webModulesRoot $moduleDirectory.Name

            if (Test-Path $webCopy -PathType Container) {
                foreach ($fileName in @("page.html","script.js","style.css")) {
                    $sourceFile = Join-Path $moduleDirectory.FullName $fileName
                    $publishedFile = Join-Path $webCopy $fileName

                    if (
                        (Test-Path $sourceFile -PathType Leaf) -and
                        (Test-Path $publishedFile -PathType Leaf)
                    ) {
                        if ((Get-FileHashSafe $sourceFile) -eq (Get-FileHashSafe $publishedFile)) {
                            Add-Result `
                                "OK" `
                                "Publicação de módulos" `
                                "$($moduleDirectory.Name)/$fileName" `
                                "modules e web\modules estão sincronizados."
                        }
                        else {
                            Add-Result `
                                "ERRO" `
                                "Publicação de módulos" `
                                "$($moduleDirectory.Name)/$fileName" `
                                "As duas cópias são diferentes." `
                                "Definir uma única origem ou sincronizar a publicação."
                        }
                    }
                }
            }
        }
    }
}

# -------------------------------------------------------------------------
# Diagnóstico completo
# -------------------------------------------------------------------------

function Get-ValidModuleDirectories {
    param([string]$RootPath)

    $modulesRoot = Join-Path $RootPath "modules"

    if (-not (Test-Path $modulesRoot -PathType Container)) {
        return @()
    }

    return @(
        Get-ChildItem $modulesRoot -Directory -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -notmatch 'backup|bak|old|temp|tmp' -and
            (Test-Path (Join-Path $_.FullName "module.json") -PathType Leaf)
        }
    )
}

function Test-SystemWide {
    param(
        [string]$RootPath,
        [string]$Url
    )

    $moduleDirectories = @(Get-ValidModuleDirectories $RootPath)
    $catalogEntries = @(Load-Catalog $Url)

    Add-Result "INFO" "Sistema Completo" "Módulos físicos" "$($moduleDirectories.Count) módulo(s)."
    Add-Result "INFO" "Sistema Completo" "Módulos no catálogo" "$($catalogEntries.Count) módulo(s)."

    $physicalNames = @($moduleDirectories.Name | Sort-Object -Unique)
    $catalogNames = @($catalogEntries.Name | Sort-Object -Unique)

    foreach ($name in $physicalNames) {
        if ($catalogNames -notcontains $name) {
            Add-Result `
                "ERRO" `
                "Sistema Completo" `
                "Fora do catálogo: $name" `
                "Existe fisicamente, mas não aparece no /api/modules." `
                "Rever module.json, enabled e loader."
        }
    }

    foreach ($name in $catalogNames) {
        if ($physicalNames -notcontains $name) {
            Add-Result `
                "ERRO" `
                "Sistema Completo" `
                "Sem pasta física: $name" `
                "O catálogo devolve um módulo sem pasta correspondente." `
                "Remover entrada obsoleta ou restaurar a pasta."
        }
    }

    # Duplicação de nomes no catálogo bruto.
    if ($script:Catalog) {
        $rawEntries = New-Object System.Collections.Generic.List[string]

        function Walk-AllCatalogNames {
            param($Value)

            if ($null -eq $Value) {
                return
            }

            if ($Value -is [string] -or $Value -is [ValueType]) {
                return
            }

            if (
                $Value -is [System.Collections.IEnumerable] -and
                -not ($Value -is [pscustomobject]) -and
                -not ($Value -is [hashtable])
            ) {
                foreach ($item in $Value) {
                    Walk-AllCatalogNames $item
                }

                return
            }

            $name = [string](Get-SafeProperty $Value @("name","id","module","slug") "")

            if (-not [string]::IsNullOrWhiteSpace($name)) {
                $rawEntries.Add($name)
            }

            foreach ($property in $Value.PSObject.Properties) {
                if ($property.Value -ne $Value) {
                    Walk-AllCatalogNames $property.Value
                }
            }
        }

        Walk-AllCatalogNames $script:Catalog

        foreach ($duplicate in @($rawEntries | Group-Object | Where-Object Count -gt 1)) {
            Add-Result `
                "ERRO" `
                "Sistema Completo" `
                "Catálogo duplicado: $($duplicate.Name)" `
                "$($duplicate.Count) ocorrências." `
                "Corrigir o loader ou manifestos duplicados."
        }
    }

    # Backups e cópias dentro da raiz de produção.
    $backupDirectories = @(
        Get-ChildItem $RootPath -Recurse -Directory -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match 'backup|_backup|bak|old' -and
            $_.FullName -notmatch '\\backups\\fix_|\\backups\\css_loader'
        }
    )

    Add-Result "INFO" "Sistema Completo" "Pastas de backup" "$($backupDirectories.Count) encontrada(s)."

    foreach ($backup in $backupDirectories | Select-Object -First 40) {
        Add-Result `
            "AVISO" `
            "Sistema Completo" `
            "Backup dentro da produção" `
            $backup.FullName `
            "Mover backups históricos para fora da raiz PROD."
    }

    $total = [math]::Max($moduleDirectories.Count,1)
    $index = 0

    foreach ($moduleDirectory in $moduleDirectories) {
        $index++

        if ($script:ProgressBar) {
            $script:ProgressBar.Value = [math]::Min(
                100,
                [int](($index / $total) * 100)
            )

            [System.Windows.Forms.Application]::DoEvents()
        }

        $info = Test-ModuleStructure $moduleDirectory.FullName "Varredura"
        Test-ModuleHttp $moduleDirectory.Name $moduleDirectory.FullName $Url
    }

    Test-CommonFramework `
        -RootPath $RootPath `
        -Url $Url `
        -FocusModuleNames $physicalNames
}

# -------------------------------------------------------------------------
# Consolidação e relatório
# -------------------------------------------------------------------------

function Build-AssertivePosition {
    $errors = @($script:Results | Where-Object Level -eq "ERRO")
    $warnings = @($script:Results | Where-Object Level -eq "AVISO")

    $criticalAreas = @(
        $errors |
        Group-Object Area |
        Sort-Object Count -Descending
    )

    if ($errors.Count -eq 0) {
        Add-Result `
            "OK" `
            "Conclusão" `
            "Posição assertiva V16.3.2" `
            "Não foram encontradas falhas críticas. Existem $($warnings.Count) aviso(s) para revisão preventiva."

        return
    }

    $top = @(
        $criticalAreas |
        Select-Object -First 5 |
        ForEach-Object { "$($_.Name) ($($_.Count))" }
    )

    Add-Result `
        "ERRO" `
        "Conclusão" `
        "Posição assertiva V16.3.2" `
        "Foram encontrados $($errors.Count) erro(s). Áreas mais afetadas: $($top -join '; ')." `
        "Executar as ações pela ordem apresentada no final do relatório."

    if ($errors.Check -contains "Carregamento CSS modular") {
        Add-Action "Corrigir primeiro o carregador CSS genérico do app.js; isto afeta todos os módulos."
    }

    if ($errors.Check -contains "Suporte CSS") {
        Add-Action "Definir uma estratégia única para CSS modular: rota no router ou injeção pelo frontend."
    }

    if ($errors.Check -contains "Navegação direta /module/NOME") {
        Add-Action "Remover cartões personalizados que usam window.location e manter apenas abrirModulo()."
    }

    if (@($errors | Where-Object Check -like "Blocos personalizados repetidos").Count -gt 0) {
        Add-Action "Limpar blocos específicos repetidos do app.js e deixar o catálogo criar os cartões."
    }

    if (@($errors | Where-Object Area -eq "Publicação de módulos").Count -gt 0) {
        Add-Action "Sincronizar ou eliminar a duplicação entre modules e web\modules."
    }

    if (@($errors | Where-Object Check -eq "Leitura da action").Count -gt 0) {
        Add-Action "Corrigir a leitura de action no api.ps1 dos módulos afetados."
    }

    if (@($errors | Where-Object Check -eq "Page local versus servido").Count -gt 0) {
        Add-Action "Confirmar qual pasta o router publica e eliminar cópias divergentes."
    }
}

function Write-Report {
    param(
        [string]$ModeValue,
        [string]$RootValue,
        [string]$ModulePathValue,
        [string]$ReferencePathValue,
        [string]$UrlValue
    )

    Build-AssertivePosition

    if ($script:Actions.Count -eq 0) {
        Add-Action "Rever os avisos e efetuar um teste funcional no browser com Ctrl+F5."
    }

    $reportName = "Diagnostico_Santander_V16_3_{0}_{1}.txt" -f (
        $ModeValue
    ),(
        Get-Date -Format "yyyyMMdd_HHmmss"
    )

    $reportPath = Join-Path $env:TEMP $reportName
    $lines = New-Object System.Collections.Generic.List[string]

    $lines.Add("DIAGNÓSTICO SANTANDER SUPPORT WEB V16.3.2")
    $lines.Add("Data: $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss')")
    $lines.Add("Modo: $ModeValue")
    $lines.Add("Root: $RootValue")
    $lines.Add("Módulo: $ModulePathValue")
    $lines.Add("Referência: $ReferencePathValue")
    $lines.Add("URL: $UrlValue")
    $lines.Add(("="*100))
    $lines.Add("")

    foreach ($result in $script:Results) {
        $location = ""

        if (-not [string]::IsNullOrWhiteSpace($result.Path)) {
            $location = " | Ficheiro: $($result.Path)"

            if ($result.Line -gt 0) {
                $location += " | Linha: $($result.Line)"
            }
        }

        $lines.Add(
            "[$($result.Level)] [$($result.Area)] $($result.Check): $($result.Detail)$location"
        )

        if (-not [string]::IsNullOrWhiteSpace($result.Correction)) {
            $lines.Add("      CORRIGIR: $($result.Correction)")
        }
    }

    $errors = @($script:Results | Where-Object Level -eq "ERRO")
    $warnings = @($script:Results | Where-Object Level -eq "AVISO")
    $oks = @($script:Results | Where-Object Level -eq "OK")

    $lines.Add("")
    $lines.Add("RESUMO")
    $lines.Add("OK: $($oks.Count) | Erros: $($errors.Count) | Avisos: $($warnings.Count)")
    $lines.Add("")
    $lines.Add("O QUE FAZER AGORA")

    $number = 1

    foreach ($action in $script:Actions) {
        $lines.Add("$number. $action")
        $number++
    }

    [System.IO.File]::WriteAllLines(
        $reportPath,
        $lines,
        [System.Text.UTF8Encoding]::new($true)
    )

    $script:LastReportPath = $reportPath
    return $reportPath
}

function Refresh-Grid {
    if (-not $script:Grid) {
        return
    }

    $script:Grid.Rows.Clear()

    foreach ($result in $script:Results) {
        $index = $script:Grid.Rows.Add(
            $result.Level,
            $result.Area,
            $result.Check,
            $result.Detail,
            $result.Correction
        )

        $row = $script:Grid.Rows[$index]

        switch ($result.Level) {
            "ERRO" {
                $row.DefaultCellStyle.BackColor = [System.Drawing.Color]::MistyRose
                $row.DefaultCellStyle.ForeColor = [System.Drawing.Color]::DarkRed
            }
            "AVISO" {
                $row.DefaultCellStyle.BackColor = [System.Drawing.Color]::LightYellow
                $row.DefaultCellStyle.ForeColor = [System.Drawing.Color]::DarkGoldenrod
            }
            "OK" {
                $row.DefaultCellStyle.BackColor = [System.Drawing.Color]::Honeydew
                $row.DefaultCellStyle.ForeColor = [System.Drawing.Color]::DarkGreen
            }
            default {
                $row.DefaultCellStyle.BackColor = [System.Drawing.Color]::AliceBlue
                $row.DefaultCellStyle.ForeColor = [System.Drawing.Color]::MidnightBlue
            }
        }
    }

    $errors = @($script:Results | Where-Object Level -eq "ERRO").Count
    $warnings = @($script:Results | Where-Object Level -eq "AVISO").Count
    $oks = @($script:Results | Where-Object Level -eq "OK").Count

    $script:SummaryLabel.Text = "OK: $oks   |   Erros: $errors   |   Avisos: $warnings"
}

function Start-Diagnostic {
    param(
        [string]$ModeValue,
        [string]$RootValue,
        [string]$ModulePathValue,
        [string]$ReferencePathValue,
        [string]$UrlValue,
        [bool]$OpenReportValue
    )

    $script:Results.Clear()
    $script:Actions.Clear()

    if ($script:ProgressBar) {
        $script:ProgressBar.Value = 0
    }

    if ($script:StatusLabel) {
        $script:StatusLabel.Text = "A analisar..."
    }

    try {
        if (-not (Test-Path $RootValue -PathType Container)) {
            Add-Result "ERRO" "Estrutura" "Root" "Pasta PROD não encontrada." "Selecionar a raiz correta." $RootValue
        }
        else {
            Add-Result "OK" "Estrutura" "Root" $RootValue "" $RootValue
        }

        Test-Server $UrlValue

        switch ($ModeValue) {
            "Module" {
                $catalogEntries = @(Load-Catalog $UrlValue)

                $primaryInfo = Test-ModuleStructure $ModulePathValue "Módulo"
                $referenceInfo = $null

                if (
                    -not [string]::IsNullOrWhiteSpace($ReferencePathValue) -and
                    (Test-Path $ReferencePathValue -PathType Container)
                ) {
                    $referenceInfo = Test-ModuleStructure $ReferencePathValue "Referência"
                }

                if ($primaryInfo) {
                    Test-ModuleHttp $primaryInfo.Name $primaryInfo.Path $UrlValue

                    $matchingCatalog = @(
                        $catalogEntries |
                        Where-Object Name -eq $primaryInfo.Name
                    )

                    if ($matchingCatalog.Count -eq 1) {
                        Add-Result "OK" "Catálogo" "Entrada do módulo" "Uma entrada encontrada."
                    }
                    elseif ($matchingCatalog.Count -eq 0) {
                        Add-Result `
                            "ERRO" `
                            "Catálogo" `
                            "Entrada do módulo" `
                            "O módulo não aparece no catálogo." `
                            "Rever module.json e reiniciar o servidor."
                    }
                    else {
                        Add-Result `
                            "ERRO" `
                            "Catálogo" `
                            "Entrada do módulo" `
                            "$($matchingCatalog.Count) entradas encontradas." `
                            "Remover duplicações."
                    }

                    Test-CommonFramework `
                        -RootPath $RootValue `
                        -Url $UrlValue `
                        -FocusModuleNames @($primaryInfo.Name)
                }

                Compare-Modules $primaryInfo $referenceInfo
            }

            "CommonPages" {
                $entries = @(Load-Catalog $UrlValue)
                Test-CommonFramework `
                    -RootPath $RootValue `
                    -Url $UrlValue `
                    -FocusModuleNames @($entries.Name)
            }

            "FullSystem" {
                Test-SystemWide $RootValue $UrlValue
            }
        }
    }
    catch {
        Add-Result `
            "ERRO" `
            "Diagnóstico V16.3.2" `
            "Falha interna" `
            $_.Exception.Message `
            "Enviar o relatório e a linha apresentada para corrigir o próprio diagnosticador."
    }

    $reportPath = Write-Report `
        -ModeValue $ModeValue `
        -RootValue $RootValue `
        -ModulePathValue $ModulePathValue `
        -ReferencePathValue $ReferencePathValue `
        -UrlValue $UrlValue

    if ($script:Grid) {
        Refresh-Grid
    }

    if ($script:ProgressBar) {
        $script:ProgressBar.Value = 100
    }

    if ($script:StatusLabel) {
        $script:StatusLabel.Text = "Concluído. Relatório: $reportPath"
    }

    if ($OpenReportValue) {
        Start-Process notepad.exe $reportPath
    }

    return $reportPath
}

# -------------------------------------------------------------------------
# Interface gráfica
# -------------------------------------------------------------------------

function Select-Folder {
    param(
        [string]$Description,
        [string]$InitialPath
    )

    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $Description
    $dialog.ShowNewFolderButton = $false

    if (Test-Path $InitialPath -PathType Container) {
        $dialog.SelectedPath = $InitialPath
    }

    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        return $dialog.SelectedPath
    }

    return ""
}

function Show-Gui {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing

    [System.Windows.Forms.Application]::EnableVisualStyles()

    $form = New-Object System.Windows.Forms.Form
    $form.Text = "SantanderSupportWebV2 | Diagnóstico V16.3.2"
    $form.StartPosition = "CenterScreen"
    $form.Size = New-Object System.Drawing.Size(1500,900)
    $form.MinimumSize = New-Object System.Drawing.Size(1200,760)
    $form.BackColor = [System.Drawing.Color]::White
    $script:MainForm = $form

    $header = New-Object System.Windows.Forms.Panel
    $header.Dock = "Top"
    $header.Height = 92
    $header.BackColor = [System.Drawing.Color]::FromArgb(204,0,0)
    $form.Controls.Add($header)

    $title = New-Object System.Windows.Forms.Label
    $title.Text = "Diagnóstico SantanderSupportWebV2 V16.3.2"
    $title.ForeColor = [System.Drawing.Color]::White
    $title.Font = New-Object System.Drawing.Font("Segoe UI",20,[System.Drawing.FontStyle]::Bold)
    $title.AutoSize = $true
    $title.Location = New-Object System.Drawing.Point(24,16)
    $header.Controls.Add($title)

    $subtitle = New-Object System.Windows.Forms.Label
    $subtitle.Text = "Módulo específico, páginas comuns ou varredura completa do sistema"
    $subtitle.ForeColor = [System.Drawing.Color]::White
    $subtitle.Font = New-Object System.Drawing.Font("Segoe UI",10)
    $subtitle.AutoSize = $true
    $subtitle.Location = New-Object System.Drawing.Point(28,58)
    $header.Controls.Add($subtitle)

    $config = New-Object System.Windows.Forms.Panel
    $config.Dock = "Top"
    $config.Height = 235
    $config.Padding = New-Object System.Windows.Forms.Padding(20)
    $config.BackColor = [System.Drawing.Color]::FromArgb(248,248,248)
    $form.Controls.Add($config)

    $labelMode = New-Object System.Windows.Forms.Label
    $labelMode.Text = "Modo de diagnóstico"
    $labelMode.Location = New-Object System.Drawing.Point(22,18)
    $labelMode.AutoSize = $true
    $labelMode.Font = New-Object System.Drawing.Font("Segoe UI",9,[System.Drawing.FontStyle]::Bold)
    $config.Controls.Add($labelMode)

    $comboMode = New-Object System.Windows.Forms.ComboBox
    $comboMode.DropDownStyle = "DropDownList"
    $comboMode.Items.AddRange(@(
        "Módulo específico",
        "Páginas comuns / Ferramentas",
        "Sistema completo"
    ))
    $comboMode.SelectedIndex = switch ($Mode) {
        "CommonPages" { 1 }
        "FullSystem"  { 2 }
        default       { 0 }
    }
    $comboMode.Location = New-Object System.Drawing.Point(22,42)
    $comboMode.Width = 290
    $config.Controls.Add($comboMode)

    $labelRoot = New-Object System.Windows.Forms.Label
    $labelRoot.Text = "Pasta PROD"
    $labelRoot.Location = New-Object System.Drawing.Point(330,18)
    $labelRoot.AutoSize = $true
    $labelRoot.Font = New-Object System.Drawing.Font("Segoe UI",9,[System.Drawing.FontStyle]::Bold)
    $config.Controls.Add($labelRoot)

    $textRoot = New-Object System.Windows.Forms.TextBox
    $textRoot.Text = $Root
    $textRoot.Location = New-Object System.Drawing.Point(330,42)
    $textRoot.Width = 850
    $config.Controls.Add($textRoot)

    $buttonRoot = New-Object System.Windows.Forms.Button
    $buttonRoot.Text = "Selecionar..."
    $buttonRoot.Location = New-Object System.Drawing.Point(1190,40)
    $buttonRoot.Width = 130
    $buttonRoot.Add_Click({
        $selected = Select-Folder "Selecionar a pasta PROD" $textRoot.Text

        if ($selected) {
            $textRoot.Text = $selected
        }
    })
    $config.Controls.Add($buttonRoot)

    $labelModule = New-Object System.Windows.Forms.Label
    $labelModule.Text = "Pasta do módulo"
    $labelModule.Location = New-Object System.Drawing.Point(22,82)
    $labelModule.AutoSize = $true
    $labelModule.Font = New-Object System.Drawing.Font("Segoe UI",9,[System.Drawing.FontStyle]::Bold)
    $config.Controls.Add($labelModule)

    $textModule = New-Object System.Windows.Forms.TextBox

    if ([string]::IsNullOrWhiteSpace($ModulePath)) {
        $textModule.Text = Join-Path $Root "modules\intune-conformidade-mobile"
    }
    else {
        $textModule.Text = $ModulePath
    }

    $textModule.Location = New-Object System.Drawing.Point(22,106)
    $textModule.Width = 1158
    $config.Controls.Add($textModule)

    $buttonModule = New-Object System.Windows.Forms.Button
    $buttonModule.Text = "Selecionar..."
    $buttonModule.Location = New-Object System.Drawing.Point(1190,104)
    $buttonModule.Width = 130
    $buttonModule.Add_Click({
        $selected = Select-Folder "Selecionar a pasta do módulo" $textModule.Text

        if ($selected) {
            $textModule.Text = $selected
        }
    })
    $config.Controls.Add($buttonModule)

    $labelReference = New-Object System.Windows.Forms.Label
    $labelReference.Text = "Módulo de referência (opcional)"
    $labelReference.Location = New-Object System.Drawing.Point(22,142)
    $labelReference.AutoSize = $true
    $labelReference.Font = New-Object System.Drawing.Font("Segoe UI",9,[System.Drawing.FontStyle]::Bold)
    $config.Controls.Add($labelReference)

    $textReference = New-Object System.Windows.Forms.TextBox

    if ([string]::IsNullOrWhiteSpace($ReferenceModulePath)) {
        $textReference.Text = Join-Path $Root "modules\mudanca-balcao"
    }
    else {
        $textReference.Text = $ReferenceModulePath
    }

    $textReference.Location = New-Object System.Drawing.Point(22,166)
    $textReference.Width = 790
    $config.Controls.Add($textReference)

    $buttonReference = New-Object System.Windows.Forms.Button
    $buttonReference.Text = "Selecionar..."
    $buttonReference.Location = New-Object System.Drawing.Point(820,164)
    $buttonReference.Width = 130
    $buttonReference.Add_Click({
        $selected = Select-Folder "Selecionar o módulo de referência" $textReference.Text

        if ($selected) {
            $textReference.Text = $selected
        }
    })
    $config.Controls.Add($buttonReference)

    $labelUrl = New-Object System.Windows.Forms.Label
    $labelUrl.Text = "URL do servidor"
    $labelUrl.Location = New-Object System.Drawing.Point(970,142)
    $labelUrl.AutoSize = $true
    $labelUrl.Font = New-Object System.Drawing.Font("Segoe UI",9,[System.Drawing.FontStyle]::Bold)
    $config.Controls.Add($labelUrl)

    $textUrl = New-Object System.Windows.Forms.TextBox
    $textUrl.Text = $BaseUrl
    $textUrl.Location = New-Object System.Drawing.Point(970,166)
    $textUrl.Width = 350
    $config.Controls.Add($textUrl)

    $buttonAnalyse = New-Object System.Windows.Forms.Button
    $buttonAnalyse.Text = "Analisar"
    $buttonAnalyse.Location = New-Object System.Drawing.Point(22,201)
    $buttonAnalyse.Width = 150
    $buttonAnalyse.Height = 32
    $buttonAnalyse.BackColor = [System.Drawing.Color]::FromArgb(204,0,0)
    $buttonAnalyse.ForeColor = [System.Drawing.Color]::White
    $buttonAnalyse.FlatStyle = "Flat"
    $config.Controls.Add($buttonAnalyse)

    $buttonReport = New-Object System.Windows.Forms.Button
    $buttonReport.Text = "Abrir último relatório"
    $buttonReport.Location = New-Object System.Drawing.Point(182,201)
    $buttonReport.Width = 180
    $buttonReport.Height = 32
    $buttonReport.Add_Click({
        if (
            -not [string]::IsNullOrWhiteSpace($script:LastReportPath) -and
            (Test-Path $script:LastReportPath -PathType Leaf)
        ) {
            Start-Process notepad.exe $script:LastReportPath
        }
        else {
            [System.Windows.Forms.MessageBox]::Show(
                "Ainda não existe um relatório.",
                "Diagnóstico V16.3.2",
                "OK",
                "Information"
            )
        }
    })
    $config.Controls.Add($buttonReport)

    $checkOpenReport = New-Object System.Windows.Forms.CheckBox
    $checkOpenReport.Text = "Abrir relatório no Bloco de Notas"
    $checkOpenReport.Checked = $true
    $checkOpenReport.AutoSize = $true
    $checkOpenReport.Location = New-Object System.Drawing.Point(385,207)
    $config.Controls.Add($checkOpenReport)

    $progress = New-Object System.Windows.Forms.ProgressBar
    $progress.Location = New-Object System.Drawing.Point(660,207)
    $progress.Width = 660
    $progress.Height = 22
    $script:ProgressBar = $progress
    $config.Controls.Add($progress)

    $contentPanel = New-Object System.Windows.Forms.Panel
    $contentPanel.Dock = "Fill"
    $contentPanel.Padding = New-Object System.Windows.Forms.Padding(15)
    $form.Controls.Add($contentPanel)

    $grid = New-Object System.Windows.Forms.DataGridView
    $grid.Dock = "Fill"
    $grid.AllowUserToAddRows = $false
    $grid.AllowUserToDeleteRows = $false
    $grid.ReadOnly = $true
    $grid.AutoSizeRowsMode = "AllCells"
    $grid.RowHeadersVisible = $false
    $grid.SelectionMode = "FullRowSelect"
    $grid.MultiSelect = $false
    $grid.BackgroundColor = [System.Drawing.Color]::White
    $grid.BorderStyle = "FixedSingle"
    $grid.Columns.Add("Level","Nível") | Out-Null
    $grid.Columns.Add("Area","Área") | Out-Null
    $grid.Columns.Add("Check","Verificação") | Out-Null
    $grid.Columns.Add("Detail","Resultado") | Out-Null
    $grid.Columns.Add("Correction","Correção sugerida") | Out-Null
    $grid.Columns["Level"].Width = 70
    $grid.Columns["Area"].Width = 190
    $grid.Columns["Check"].Width = 230
    $grid.Columns["Detail"].AutoSizeMode = "Fill"
    $grid.Columns["Correction"].Width = 350
    $grid.DefaultCellStyle.WrapMode = "True"
    $script:Grid = $grid
    $contentPanel.Controls.Add($grid)

    $footer = New-Object System.Windows.Forms.Panel
    $footer.Dock = "Bottom"
    $footer.Height = 48
    $footer.BackColor = [System.Drawing.Color]::FromArgb(245,245,245)
    $form.Controls.Add($footer)

    $summary = New-Object System.Windows.Forms.Label
    $summary.Text = "OK: 0   |   Erros: 0   |   Avisos: 0"
    $summary.AutoSize = $true
    $summary.Font = New-Object System.Drawing.Font("Segoe UI",10,[System.Drawing.FontStyle]::Bold)
    $summary.Location = New-Object System.Drawing.Point(16,14)
    $script:SummaryLabel = $summary
    $footer.Controls.Add($summary)

    $status = New-Object System.Windows.Forms.Label
    $status.Text = "Pronto."
    $status.AutoEllipsis = $true
    $status.Location = New-Object System.Drawing.Point(340,15)
    $status.Width = 1080
    $script:StatusLabel = $status
    $footer.Controls.Add($status)

    $updateModeControls = {
        $isModule = $comboMode.SelectedIndex -eq 0
        $textModule.Enabled = $isModule
        $buttonModule.Enabled = $isModule
        $textReference.Enabled = $isModule
        $buttonReference.Enabled = $isModule
    }

    $comboMode.Add_SelectedIndexChanged($updateModeControls)
    & $updateModeControls

    $buttonAnalyse.Add_Click({
        $modeValue = switch ($comboMode.SelectedIndex) {
            1 { "CommonPages" }
            2 { "FullSystem" }
            default { "Module" }
        }

        $buttonAnalyse.Enabled = $false

        try {
            [void](Start-Diagnostic `
                -ModeValue $modeValue `
                -RootValue $textRoot.Text.Trim() `
                -ModulePathValue $textModule.Text.Trim() `
                -ReferencePathValue $textReference.Text.Trim() `
                -UrlValue $textUrl.Text.Trim().TrimEnd("/") `
                -OpenReportValue $checkOpenReport.Checked)
        }
        finally {
            $buttonAnalyse.Enabled = $true
        }
    })

    [void]$form.ShowDialog()
}

# -------------------------------------------------------------------------
# Execução
# -------------------------------------------------------------------------

if ($NoGui) {
    $report = Start-Diagnostic `
        -ModeValue $Mode `
        -RootValue $Root `
        -ModulePathValue $ModulePath `
        -ReferencePathValue $ReferenceModulePath `
        -UrlValue $BaseUrl.TrimEnd("/") `
        -OpenReportValue ([bool]$OpenReport)

    foreach ($result in $script:Results) {
        $color = switch ($result.Level) {
            "ERRO"  { "Red" }
            "AVISO" { "Yellow" }
            "OK"    { "Green" }
            default { "Cyan" }
        }

        Write-Host "[$($result.Level)] [$($result.Area)] $($result.Check): $($result.Detail)" -ForegroundColor $color

        if (-not [string]::IsNullOrWhiteSpace($result.Correction)) {
            Write-Host "      CORRIGIR: $($result.Correction)" -ForegroundColor DarkYellow
        }
    }

    Write-Host ""
    Write-Host "Relatório: $report" -ForegroundColor Cyan
}
else {
    Show-Gui
}