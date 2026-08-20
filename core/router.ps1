# ============================================================
# ROUTER.PS1
# ============================================================
# Responsável pelas rotas da aplicação.
#
# Regra principal:
# Para criar novas ferramentas, NÃO mexer aqui.
# Basta criar nova pasta dentro de /modules.
# ============================================================

$script:GraphSessionConnectedAt = $null
$script:GraphSessionExpiresAt = $null
$Global:GraphSessionConnectedAt = $null
$Global:GraphSessionExpiresAt = $null
$script:ExchangeSessionConnectedAt = $null
$script:ExchangeSessionExpiresAt = $null

function Get-AppConnectionExpiry {
    param($Connection)
    if ($null -eq $Connection) { return $null }
    foreach ($PropertyName in @("TokenExpiryTime", "TokenExpirationTime", "ExpirationTime", "ExpiresOn")) {
        $Property = $Connection.PSObject.Properties[$PropertyName]
        if ($Property -and $Property.Value) {
            try { return ([DateTimeOffset]$Property.Value).ToString("o") } catch { }
        }
    }
    return $null
}

# DASHBOARD_V3_HELPERS_BEGIN
function Test-AppSameOriginRequest {
    param($Request)

    if ($null -eq $Request) { return $false }

    $FetchSite = [string]$Request.Headers["Sec-Fetch-Site"]
    if ($FetchSite -and $FetchSite -notin @("same-origin", "same-site", "none")) {
        return $false
    }

    $Origin = [string]$Request.Headers["Origin"]
    if ([string]::IsNullOrWhiteSpace($Origin)) { return $true }

    try {
        $OriginUri = [Uri]$Origin
        return (
            $OriginUri.Scheme -eq $Request.Url.Scheme -and
            $OriginUri.Host -eq $Request.Url.Host -and
            $OriginUri.Port -eq $Request.Url.Port
        )
    }
    catch { return $false }
}

function Test-AppRequestBodySize {
    param($Request, [long]$MaximumBytes = 10485760)
    if ($null -eq $Request) { return $false }
    return ($Request.ContentLength64 -le $MaximumBytes)
}

function Get-DashboardDataDirectory {
    $DataDirectory = Join-Path $Global:AppRoot "data"

    if (!(Test-Path -LiteralPath $DataDirectory)) {
        New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
    }

    return $DataDirectory
}

function Get-DashboardUsageFile {
    $DataDirectory = Get-DashboardDataDirectory
    return (Join-Path $DataDirectory "module-usage.jsonl")
}

function Get-DashboardModuleKey {
    param($ModuleConfig)

    if ($null -eq $ModuleConfig) {
        return ""
    }

    foreach ($PropertyName in @("id", "module", "name")) {
        $Property = $ModuleConfig.PSObject.Properties[$PropertyName]

        if ($Property -and -not [string]::IsNullOrWhiteSpace([string]$Property.Value)) {
            return ([string]$Property.Value).Trim()
        }
    }

    return ""
}

function Get-DashboardModuleCatalog {
    $Modules = New-Object System.Collections.ArrayList
    $ModulesRoot = Join-Path $Global:AppRoot "modules"

    if (!(Test-Path -LiteralPath $ModulesRoot)) {
        return @()
    }

    Get-ChildItem -LiteralPath $ModulesRoot -Directory | ForEach-Object {
        $ConfigFile = Join-Path $_.FullName "module.json"

        if (!(Test-Path -LiteralPath $ConfigFile)) {
            return
        }

        try {
            $ModuleConfig = Get-Content -LiteralPath $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json

            if ($ModuleConfig.enabled -eq $true) {
                [void]$Modules.Add($ModuleConfig)
            }
        }
        catch {
            Write-AppLog "DASHBOARD | Erro ao ler module.json em $($_.FullName): $($_.Exception.Message)" "ERROR" "DASHBOARD"
        }
    }

    return @($Modules | Sort-Object category, order, title)
}

function Read-DashboardRequestBody {
    param($Request)

    if ($null -eq $Request -or $null -eq $Request.InputStream) {
        return ""
    }

    $Encoding = $Request.ContentEncoding

    if ($null -eq $Encoding) {
        $Encoding = [System.Text.Encoding]::UTF8
    }

    $Reader = New-Object System.IO.StreamReader($Request.InputStream, $Encoding)

    try {
        return $Reader.ReadToEnd()
    }
    finally {
        $Reader.Dispose()
    }
}

function Add-DashboardUsageEntry {
    param($Entry)

    $UsageFile = Get-DashboardUsageFile
    $JsonLine = ($Entry | ConvertTo-Json -Depth 10 -Compress) + [Environment]::NewLine
    $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $Mutex = New-Object System.Threading.Mutex($false, "SantanderSupportWebV2DashboardUsage")
    $Acquired = $false

    try {
        try {
            $Acquired = $Mutex.WaitOne(5000)
        }
        catch [System.Threading.AbandonedMutexException] {
            $Acquired = $true
        }

        if (!$Acquired) {
            throw "Tempo excedido ao aguardar acesso ao ficheiro de utilização."
        }

        [System.IO.File]::AppendAllText($UsageFile, $JsonLine, $Utf8NoBom)
    }
    finally {
        if ($Acquired) {
            try { $Mutex.ReleaseMutex() } catch {}
        }

        $Mutex.Dispose()
    }
}

function Get-DashboardUsageEntries {
    $UsageFile = Get-DashboardUsageFile

    if (!(Test-Path -LiteralPath $UsageFile)) {
        return @()
    }

    $Entries = New-Object System.Collections.ArrayList

    Get-Content -LiteralPath $UsageFile -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object {
        $Line = [string]$_

        if ([string]::IsNullOrWhiteSpace($Line)) {
            return
        }

        try {
            $Entry = $Line | ConvertFrom-Json

            if ($Entry -and $Entry.timestamp -and $Entry.moduleId) {
                [void]$Entries.Add($Entry)
            }
        }
        catch {
            Write-AppLog "DASHBOARD | Linha de utilização inválida ignorada: $($_.Exception.Message)" "WARN" "DASHBOARD"
        }
    }

    return @($Entries)
}

function ConvertTo-DashboardTimestamp {
    param($Value)

    $TimestampText = [string]$Value

    if ([string]::IsNullOrWhiteSpace($TimestampText)) {
        return [DateTimeOffset]::MinValue
    }

    $TimestampText = $TimestampText.Trim()

    try {
        return [DateTimeOffset]::Parse(
            $TimestampText,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [System.Globalization.DateTimeStyles]::RoundtripKind
        )
    }
    catch {
        try {
            return [DateTimeOffset]::Parse(
                $TimestampText,
                [System.Globalization.CultureInfo]::CurrentCulture,
                [System.Globalization.DateTimeStyles]::AllowWhiteSpaces
            )
        }
        catch {
            Write-AppLog "DASHBOARD | Timestamp inválido ignorado: $TimestampText" "WARN" "DASHBOARD"
            return [DateTimeOffset]::MinValue
        }
    }
}

function Get-DashboardPeriodStart {
    param([string]$Period)

    $Now = [DateTimeOffset]::Now
    $Today = [DateTimeOffset]::new($Now.Year, $Now.Month, $Now.Day, 0, 0, 0, $Now.Offset)
    $NormalizedPeriod = ([string]$Period).ToLowerInvariant()

    switch ($NormalizedPeriod) {
        "today"  { return $Today }
        "7days"  { return $Today.AddDays(-6) }
        "30days" { return $Today.AddDays(-29) }
        "all"    { return [DateTimeOffset]::MinValue }
        default  { return $Today.AddDays(-6) }
    }
}
# DASHBOARD_V3_HELPERS_END


function Invoke-AppRoute {
    param(
        $Request,
        $Response,
        $Context
    )

    $Path = $Request.Url.AbsolutePath.ToLower()
    $Query = $Request.QueryString
    $Method = $Request.HttpMethod
    $UserAgent = $Request.UserAgent
    $RemoteIp = $Request.RemoteEndPoint

    Write-AppLog "REQUEST | Metodo=$Method | Path=$Path | IP=$RemoteIp" "INFO"

    try {
        if ($Method -notin @("GET", "HEAD", "OPTIONS") -and -not (Test-AppSameOriginRequest -Request $Request)) {
            Send-JsonResponse -Response $Response -StatusCode 403 -Data @{
                success = $false
                error = "Pedido recusado: origem não autorizada."
            }
            return
        }

        if (-not (Test-AppRequestBodySize -Request $Request)) {
            Send-JsonResponse -Response $Response -StatusCode 413 -Data @{
                success = $false
                error = "Pedido demasiado grande. Limite: 10 MB."
            }
            return
        }

        # Página inicial
        if ($Path -eq "/") {
            Send-FileResponse `
                -Response $Response `
                -FilePath "$Global:AppRoot\web\index.html" `
                -ContentType "text/html"

            return
        }

        # Evita erro visual por favicon
        if ($Path -eq "/favicon.ico") {
            Send-TextResponse `
                -Response $Response `
                -Content "" `
                -ContentType "image/x-icon" `
                -StatusCode 204

            return
        }

        # CSS
        if ($Path -like "/css/*") {
            $File = Join-Path "$Global:AppRoot\web" $Path.TrimStart("/")

            Write-AppLog "STATIC CSS | $File" "DEBUG"

            Send-FileResponse `
                -Response $Response `
                -FilePath $File `
                -ContentType "text/css"

            return
        }

        # JavaScript principal
        if ($Path -like "/js/*") {
            $File = Join-Path "$Global:AppRoot\web" $Path.TrimStart("/")

            Write-AppLog "STATIC JS | $File" "DEBUG"

            Send-FileResponse `
                -Response $Response `
                -FilePath $File `
                -ContentType "application/javascript"

            return
        }


        # ====================================================
        # DASHBOARD_V3_STATIC_ASSETS_BEGIN
        # Imagens e outros recursos estáticos da pasta web\assets.
        if ($Path -like "/assets/*") {
            $WebRoot = [System.IO.Path]::GetFullPath((Join-Path $Global:AppRoot "web"))
            $WebRootPrefix = $WebRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
            $RelativeAsset = [System.Uri]::UnescapeDataString($Path.TrimStart("/"))
            $AssetFile = [System.IO.Path]::GetFullPath((Join-Path $WebRoot $RelativeAsset))

            if (!$AssetFile.StartsWith($WebRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                Send-JsonResponse -Response $Response -StatusCode 403 -Data @{
                    success = $false
                    error = "Caminho de recurso inválido."
                }
                return
            }

            $Extension = [System.IO.Path]::GetExtension($AssetFile).ToLowerInvariant()
            $ContentType = switch ($Extension) {
                ".png"  { "image/png" }
                ".jpg"  { "image/jpeg" }
                ".jpeg" { "image/jpeg" }
                ".gif"  { "image/gif" }
                ".svg"  { "image/svg+xml" }
                ".webp" { "image/webp" }
                default { "application/octet-stream" }
            }

            Send-FileResponse `
                -Response $Response `
                -FilePath $AssetFile `
                -ContentType $ContentType

            return
        }
        # DASHBOARD_V3_STATIC_ASSETS_END


        # EXCHANGE ONLINE - STATUS
        # ====================================================
        if ($Path -eq "/api/exchange/status" -or $Path -eq "/api/exchangestatus") {

            Write-AppLog "Iniciando verificacao de status Exchange." "INFO" "EXCHANGE"

            try {
                Write-AppLog "A executar Get-ConnectionInformation." "DEBUG" "EXCHANGE"

                $Connection = Get-ConnectionInformation -ErrorAction Stop | Select-Object -First 1

                if ($Connection) {
                    if (-not $script:ExchangeSessionConnectedAt) { $script:ExchangeSessionConnectedAt = [DateTimeOffset]::Now }
                    $DetectedExpiry = Get-AppConnectionExpiry -Connection $Connection
                    if ($DetectedExpiry) { $script:ExchangeSessionExpiresAt = [DateTimeOffset]::Parse($DetectedExpiry) }
                    Write-AppLog "Sessao Exchange encontrada. User=$($Connection.UserPrincipalName)" "INFO" "EXCHANGE"

                    Send-JsonResponse -Response $Response -Data @{
                        success = $true
                        connected = $true
                        user = $Connection.UserPrincipalName
                        connectedAt = $script:ExchangeSessionConnectedAt.ToString("o")
                        expiresAt = if ($script:ExchangeSessionExpiresAt) { $script:ExchangeSessionExpiresAt.ToString("o") } else { $null }
                        expiryEstimated = $false
                    }

                    return
                }

                Write-AppLog "Nenhuma sessao Exchange ativa encontrada." "WARN" "EXCHANGE"

                Send-JsonResponse -Response $Response -Data @{
                    success = $true
                    connected = $false
                    user = ""
                }

                return
            }
            catch {
                Write-AppLog "Status Exchange falhou: $($_.Exception.Message)" "WARN" "EXCHANGE"

                Send-JsonResponse -Response $Response -Data @{
                    success = $true
                    connected = $false
                    user = ""
                    error = $_.Exception.Message
                }

                return
            }
        }

        # ====================================================
        # EXCHANGE ONLINE - CONNECT
        # Aceita as duas rotas para evitar falha de frontend:
        # POST /api/exchange/connect
        # GET  /api/connectexchange
        # ====================================================
        if ($Path -eq "/api/exchange/connect" -or $Path -eq "/api/connectexchange") {

            Write-AppLog "Pedido de conexao Exchange recebido. Metodo=$Method Path=$Path" "INFO" "EXCHANGE"

            try {
                Write-AppLog "Passo 1: Validando modulo ExchangeOnlineManagement." "INFO" "EXCHANGE"

                $Module = Get-Module ExchangeOnlineManagement -ListAvailable |
                    Sort-Object Version -Descending |
                    Select-Object -First 1

                if (!$Module) {
                    throw "Modulo ExchangeOnlineManagement nao encontrado."
                }

                Write-AppLog "Modulo encontrado. Versao=$($Module.Version) Path=$($Module.Path)" "INFO" "EXCHANGE"

                Write-AppLog "Passo 2: Importando modulo ExchangeOnlineManagement." "INFO" "EXCHANGE"

                Import-Module ExchangeOnlineManagement -ErrorAction Stop

                Write-AppLog "Modulo importado com sucesso." "INFO" "EXCHANGE"

                Write-AppLog "Passo 3: Verificando se ja existe sessao ativa." "INFO" "EXCHANGE"

                $ExistingConnection = $null

                try {
                    $ExistingConnection = Get-ConnectionInformation -ErrorAction SilentlyContinue | Select-Object -First 1
                }
                catch {
                    Write-AppLog "Nenhuma sessao previa detectada." "DEBUG" "EXCHANGE"
                }

                if ($ExistingConnection) {
                    if (-not $script:ExchangeSessionConnectedAt) { $script:ExchangeSessionConnectedAt = [DateTimeOffset]::Now }
                    $DetectedExpiry = Get-AppConnectionExpiry -Connection $ExistingConnection
                    if ($DetectedExpiry) { $script:ExchangeSessionExpiresAt = [DateTimeOffset]::Parse($DetectedExpiry) }
                    Write-AppLog "Sessao Exchange ja estava ativa. User=$($ExistingConnection.UserPrincipalName)" "INFO" "EXCHANGE"

                    Send-JsonResponse -Response $Response -Data @{
                        success = $true
                        connected = $true
                        alreadyConnected = $true
                        user = $ExistingConnection.UserPrincipalName
                        connectedAt = $script:ExchangeSessionConnectedAt.ToString("o")
                        expiresAt = if ($script:ExchangeSessionExpiresAt) { $script:ExchangeSessionExpiresAt.ToString("o") } else { $null }
                        expiryEstimated = $false
                    }

                    return
                }

                Write-AppLog "Passo 4: Chamando Connect-ExchangeOnline." "INFO" "EXCHANGE"
                Write-AppLog "A janela de autenticacao pode abrir no servidor/maquina local." "WARN" "EXCHANGE"

                Connect-ExchangeOnline -ShowBanner:$false -DisableWAM -ErrorAction Stop

                Write-AppLog "Connect-ExchangeOnline finalizado. Validando sessao criada." "INFO" "EXCHANGE"

                $Connection = Get-ConnectionInformation -ErrorAction Stop | Select-Object -First 1

                if (!$Connection) {
                    throw "Connect-ExchangeOnline executou, mas nenhuma sessao foi retornada."
                }

                $script:ExchangeSessionConnectedAt = [DateTimeOffset]::Now
                $DetectedExpiry = Get-AppConnectionExpiry -Connection $Connection
                $script:ExchangeSessionExpiresAt = if ($DetectedExpiry) { [DateTimeOffset]::Parse($DetectedExpiry) } else { $null }

                Write-AppLog "Conexao Exchange efetuada com sucesso. User=$($Connection.UserPrincipalName)" "INFO" "EXCHANGE"

                Send-JsonResponse -Response $Response -Data @{
                    success = $true
                    connected = $true
                    alreadyConnected = $false
                    user = $Connection.UserPrincipalName
                    connectedAt = $script:ExchangeSessionConnectedAt.ToString("o")
                    expiresAt = if ($script:ExchangeSessionExpiresAt) { $script:ExchangeSessionExpiresAt.ToString("o") } else { $null }
                    expiryEstimated = $false
                }

                return
            }
            catch {
                Write-AppLog "ERRO ao conectar Exchange: $($_.Exception.Message)" "ERROR" "EXCHANGE"
                Write-AppLog "TipoErro=$($_.Exception.GetType().FullName)" "ERROR" "EXCHANGE"

                if ($_.ScriptStackTrace) {
                    Write-AppLog "StackTrace=$($_.ScriptStackTrace)" "ERROR" "EXCHANGE"
                }

                Send-JsonResponse -Response $Response -StatusCode 500 -Data @{
                    success = $false
                    connected = $false
                    error = $_.Exception.Message
                    errorType = $_.Exception.GetType().FullName
                }

                return
            }
        }

        
        # ====================================================
        # MICROSOFT GRAPH - STATUS
        # ====================================================
        if ($Path -eq "/api/graph/status") {

            Write-AppLog "Verificando status Microsoft Graph." "INFO" "GRAPH"

            try {
                Import-Module Microsoft.Graph.Authentication -ErrorAction Stop

                $Ctx = Get-MgContext

                $GraphSessionExpired = (
                    $Ctx -and
                    $Global:GraphSessionExpiresAt -and
                    [DateTimeOffset]::Now -ge [DateTimeOffset]$Global:GraphSessionExpiresAt
                )

                if ($Ctx -and -not $GraphSessionExpired) {
                    if (-not $script:GraphSessionConnectedAt) {
                        $script:GraphSessionConnectedAt = [DateTimeOffset]::Now
                        $script:GraphSessionExpiresAt = $script:GraphSessionConnectedAt.AddMinutes(55)
                    }
                    $Global:GraphSessionConnectedAt = $script:GraphSessionConnectedAt
                    $Global:GraphSessionExpiresAt = $script:GraphSessionExpiresAt
                    Send-JsonResponse -Response $Response -Data @{
                        success = $true
                        connected = $true
                        account = $Ctx.Account
                        tenantId = $Ctx.TenantId
                        scopes = @($Ctx.Scopes)
                        connectedAt = $script:GraphSessionConnectedAt.ToString("o")
                        expiresAt = $script:GraphSessionExpiresAt.ToString("o")
                        expiryEstimated = $true
                    }
                    return
                }

                if ($GraphSessionExpired) {
                    Write-AppLog "Sessao Graph atingiu o limite seguro; reconexao manual necessaria." "WARN" "GRAPH"
                }
                Send-JsonResponse -Response $Response -Data @{
                    success = $true
                    connected = $false
                    account = ""
                    tenantId = ""
                    scopes = @()
                    expired = [bool]$GraphSessionExpired
                    needConnect = [bool]$GraphSessionExpired
                }
                return
            }
            catch {
                Send-JsonResponse -Response $Response -Data @{
                    success = $true
                    connected = $false
                    error = $_.Exception.Message
                }
                return
            }
        }

        # ====================================================
        # MICROSOFT GRAPH - CONNECT
        # ====================================================
        if ($Path -eq "/api/graph/connect") {

            Write-AppLog "Pedido de conexão Microsoft Graph recebido." "INFO" "GRAPH"

            try {
                Import-Module Microsoft.Graph.Authentication -ErrorAction Stop

                if ($Global:GraphSessionExpiresAt -and [DateTimeOffset]::Now -ge [DateTimeOffset]$Global:GraphSessionExpiresAt) {
                    Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
                }

                Connect-MgGraph `
                    -Scopes "User.Read.All","Directory.Read.All","Group.Read.All","GroupMember.ReadWrite.All","UserAuthenticationMethod.ReadWrite.All","DeviceManagementManagedDevices.Read.All","DeviceManagementManagedDevices.ReadWrite.All","DeviceManagementRBAC.Read.All","DeviceManagementApps.Read.All" `
                    -NoWelcome `
                    -ErrorAction Stop | Out-Null

                $Ctx = Get-MgContext

                if (!$Ctx) {
                    throw "Connect-MgGraph executou, mas não retornou contexto."
                }

                $script:GraphSessionConnectedAt = [DateTimeOffset]::Now
                $script:GraphSessionExpiresAt = $script:GraphSessionConnectedAt.AddMinutes(55)
                $Global:GraphSessionConnectedAt = $script:GraphSessionConnectedAt
                $Global:GraphSessionExpiresAt = $script:GraphSessionExpiresAt

                Send-JsonResponse -Response $Response -Data @{
                    success = $true
                    connected = $true
                    account = $Ctx.Account
                    tenantId = $Ctx.TenantId
                    scopes = @($Ctx.Scopes)
                    connectedAt = $script:GraphSessionConnectedAt.ToString("o")
                    expiresAt = $script:GraphSessionExpiresAt.ToString("o")
                    expiryEstimated = $true
                }
                return
            }
            catch {
                Write-AppLog "Erro ao conectar Graph: $($_.Exception.Message)" "ERROR" "GRAPH"

                Send-JsonResponse -Response $Response -StatusCode 500 -Data @{
                    success = $false
                    connected = $false
                    error = $_.Exception.Message
                }
                return
            }
        }

        # ====================================================
        # MICROSOFT GRAPH - DISCONNECT
        # ====================================================
        if ($Path -eq "/api/graph/disconnect") {

            try {
                Import-Module Microsoft.Graph.Authentication -ErrorAction Stop
                Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
                $script:GraphSessionConnectedAt = $null
                $script:GraphSessionExpiresAt = $null
                $Global:GraphSessionConnectedAt = $null
                $Global:GraphSessionExpiresAt = $null

                Send-JsonResponse -Response $Response -Data @{
                    success = $true
                    connected = $false
                }
                return
            }
            catch {
                Send-JsonResponse -Response $Response -StatusCode 500 -Data @{
                    success = $false
                    error = $_.Exception.Message
                }
                return
            }
        }

        # DASHBOARD_V3_ROUTES_BEGIN
        # ====================================================
        # DASHBOARD - INFORMAÇÃO DO SISTEMA
        # ====================================================
        if ($Path -eq "/api/system/info") {
            $DashboardModules = @(Get-DashboardModuleCatalog)
            $Categories = @($DashboardModules | ForEach-Object { [string]$_.category } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)

            Send-JsonResponse -Response $Response -Data @{
                success = $true
                appName = $Global:AppConfig.appName
                environment = $Global:AppConfig.environment
                useMock = $Global:AppConfig.useMock
                port = $Global:AppConfig.port
                version = $Global:AppConfig.version
                build = $Global:AppConfig.build
                releaseName = $Global:AppConfig.releaseName
                serverTime = (Get-Date).ToString("o")
                moduleCount = $DashboardModules.Count
                categories = $Categories
            }

            return
        }

        # ====================================================
        # DASHBOARD - REGISTAR UTILIZAÇÃO DE MÓDULO
        # POST /api/dashboard/usage
        # ====================================================
        if ($Path -eq "/api/dashboard/usage" -and $Method -eq "POST") {
            try {
                $RequestedModuleId = [string]$Query["moduleId"]

                if ([string]::IsNullOrWhiteSpace($RequestedModuleId)) {
                    $DashboardBody = Read-DashboardRequestBody -Request $Request

                    if (-not [string]::IsNullOrWhiteSpace($DashboardBody)) {
                        if ($DashboardBody.Length -gt 65536) {
                            Send-JsonResponse -Response $Response -StatusCode 413 -Data @{
                                success = $false
                                error = "Payload demasiado grande."
                            }
                            return
                        }

                        $Payload = $DashboardBody | ConvertFrom-Json
                        $RequestedModuleId = [string]$Payload.moduleId
                    }
                }

                if ([string]::IsNullOrWhiteSpace($RequestedModuleId)) {
                    Send-JsonResponse -Response $Response -StatusCode 400 -Data @{
                        success = $false
                        error = "moduleId não informado."
                    }
                    return
                }

                $RequestedModuleId = $RequestedModuleId.Trim()
                $DashboardModules = @(Get-DashboardModuleCatalog)
                $SelectedModule = $DashboardModules | Where-Object {
                    (Get-DashboardModuleKey -ModuleConfig $_) -ieq $RequestedModuleId
                } | Select-Object -First 1

                if ($null -eq $SelectedModule) {
                    Send-JsonResponse -Response $Response -StatusCode 404 -Data @{
                        success = $false
                        error = "Módulo ativo não encontrado."
                        moduleId = $RequestedModuleId
                    }
                    return
                }

                $ModuleKey = Get-DashboardModuleKey -ModuleConfig $SelectedModule
                $ModuleTitle = if ([string]::IsNullOrWhiteSpace([string]$SelectedModule.title)) { $ModuleKey } else { [string]$SelectedModule.title }
                $ModuleCategory = if ([string]::IsNullOrWhiteSpace([string]$SelectedModule.category)) { "Ferramentas" } else { [string]$SelectedModule.category }

                $UsageEntry = [ordered]@{
                    timestamp = (Get-Date).ToString("o")
                    moduleId = $ModuleKey
                    moduleTitle = $ModuleTitle
                    category = $ModuleCategory
                }

                Add-DashboardUsageEntry -Entry $UsageEntry
                Write-AppLog "DASHBOARD USAGE | Module=$ModuleKey | Title=$ModuleTitle" "INFO" "DASHBOARD"

                Send-JsonResponse -Response $Response -Data @{
                    success = $true
                    item = $UsageEntry
                }

                return
            }
            catch {
                Write-AppLog "DASHBOARD USAGE ERROR | $($_.Exception.Message)" "ERROR" "DASHBOARD"

                Send-JsonResponse -Response $Response -StatusCode 500 -Data @{
                    success = $false
                    error = $_.Exception.Message
                }

                return
            }
        }

        # ====================================================
        # DASHBOARD - RANKING DE UTILIZAÇÃO
        # GET /api/dashboard/usage?period=today|7days|30days|all
        # ====================================================
        if ($Path -eq "/api/dashboard/usage" -and $Method -eq "GET") {
            $Period = [string]$Query["period"]

            if ([string]::IsNullOrWhiteSpace($Period)) {
                $Period = "7days"
            }

            $AllowedPeriods = @("today", "7days", "30days", "all")

            if ($AllowedPeriods -notcontains $Period.ToLowerInvariant()) {
                Send-JsonResponse -Response $Response -StatusCode 400 -Data @{
                    success = $false
                    error = "Período inválido. Utilize today, 7days, 30days ou all."
                }
                return
            }

            $Period = $Period.ToLowerInvariant()
            $PeriodStart = Get-DashboardPeriodStart -Period $Period
            $Entries = @(Get-DashboardUsageEntries)
            $FilteredEntries = @($Entries | Where-Object {
                (ConvertTo-DashboardTimestamp -Value $_.timestamp) -ge $PeriodStart
            })

            $Ranking = @(
                $FilteredEntries |
                    Group-Object moduleId |
                    ForEach-Object {
                        $LatestEntry = $_.Group |
                            Sort-Object { ConvertTo-DashboardTimestamp -Value $_.timestamp } -Descending |
                            Select-Object -First 1

                        [pscustomobject][ordered]@{
                            moduleId = [string]$_.Name
                            moduleTitle = [string]$LatestEntry.moduleTitle
                            category = [string]$LatestEntry.category
                            count = [int]$_.Count
                            lastUsed = [string]$LatestEntry.timestamp
                        }
                    } |
                    Sort-Object @{ Expression = "count"; Descending = $true }, @{ Expression = "moduleTitle"; Descending = $false }
            )

            Send-JsonResponse -Response $Response -Data @{
                success = $true
                period = $Period
                periodStart = if ($PeriodStart -eq [DateTimeOffset]::MinValue) { $null } else { $PeriodStart.ToString("o") }
                generatedAt = (Get-Date).ToString("o")
                totalAccesses = $FilteredEntries.Count
                uniqueModules = $Ranking.Count
                ranking = $Ranking
            }

            return
        }

        # Método não permitido na rota de utilização.
        if ($Path -eq "/api/dashboard/usage") {
            Send-JsonResponse -Response $Response -StatusCode 405 -Data @{
                success = $false
                error = "Método não permitido."
                method = $Method
            }
            return
        }

        # ====================================================
        # DASHBOARD - ATIVIDADE RECENTE
        # ====================================================
        if ($Path -eq "/api/dashboard/activity") {
            $Limit = 8

            try {
                if (-not [string]::IsNullOrWhiteSpace([string]$Query["limit"])) {
                    $Limit = [int]$Query["limit"]
                }
            }
            catch {
                $Limit = 8
            }

            if ($Limit -lt 1) { $Limit = 1 }
            if ($Limit -gt 50) { $Limit = 50 }

            $Entries = @(Get-DashboardUsageEntries)
            $Items = @(
                $Entries |
                    Sort-Object { ConvertTo-DashboardTimestamp -Value $_.timestamp } -Descending |
                    Select-Object -First $Limit
            )

            Send-JsonResponse -Response $Response -Data @{
                success = $true
                generatedAt = (Get-Date).ToString("o")
                items = $Items
            }

            return
        }
        # DASHBOARD_V3_ROUTES_END


        # Lista de módulos
        if ($Path -eq "/api/modules") {
            $Modules = New-Object System.Collections.ArrayList

            Get-ChildItem "$Global:AppRoot\modules" -Directory | ForEach-Object {
                $ConfigFile = Join-Path $_.FullName "module.json"

                if (Test-Path $ConfigFile) {
                    try {
                        $ModuleConfig = Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json

                        if ($ModuleConfig.enabled -eq $true) {
                            [void]$Modules.Add($ModuleConfig)
                        }
                    }
                    catch {
                        Write-AppLog "Erro ao ler module.json em $($_.FullName): $($_.Exception.Message)" "ERROR"
                    }
                }
            }

            $Modules = $Modules | Sort-Object category, order, title

            Send-JsonResponse `
                -Response $Response `
                -Data @{
                    success = $true
                    modules = @($Modules)
                }

            return
        }

        # Debug dos logs
        if ($Path -eq "/api/debug") {
            if ([string]$Global:AppConfig.environment -eq "production") {
                Send-JsonResponse -Response $Response -StatusCode 404 -Data @{
                    success = $false
                    error = "Rota não encontrada."
                }
                return
            }

            $Logs = Get-AppLog -LastLines 300

            Send-JsonResponse `
                -Response $Response `
                -Data @{
                    success = $true
                    logs = $Logs
                    environment = $Global:AppConfig.environment
                    useMock = $Global:AppConfig.useMock
                    appRoot = $Global:AppRoot
                    version = $Global:AppConfig.version
                    build = $Global:AppConfig.build
                    releaseName = $Global:AppConfig.releaseName
                }

            return
        }

        # Rotas dos módulos
        if ($Path -match "^/module/([^/]+)/(.+)$") {
            $ModuleName = $Matches[1]
            $Action = $Matches[2]

            $ModuleFolder = Join-Path "$Global:AppRoot\modules" $ModuleName

            Write-AppLog "MODULE | Nome=$ModuleName | Acao=$Action" "DEBUG"

            if (!(Test-Path $ModuleFolder)) {
                Send-JsonResponse `
                    -Response $Response `
                    -StatusCode 404 `
                    -Data @{
                        success = $false
                        error = "Modulo nao encontrado"
                        module = $ModuleName
                    }

                return
            }

            if ($Action -eq "page") {
                Send-FileResponse `
                    -Response $Response `
                    -FilePath "$ModuleFolder\page.html" `
                    -ContentType "text/html"

                return
            }

            if ($Action -eq "script") {
                Send-FileResponse `
                    -Response $Response `
                    -FilePath "$ModuleFolder\script.js" `
                    -ContentType "application/javascript"

                return
            }


            if ($Action -in @("style", "css")) {
                if ($null -eq $Context -or $null -eq $Context.Response) {
                    throw "Context.Response está nulo na rota CSS."
                }

                $CssFile = Join-Path $ModuleFolder "style.css"
                $HttpResponse = $Context.Response

                if (!(Test-Path -LiteralPath $CssFile)) {
                    $CssContent = "/* style.css não encontrado para o módulo $ModuleName */"
                    $CssBytes = [System.Text.Encoding]::UTF8.GetBytes($CssContent)

                    $HttpResponse.StatusCode = 404
                    $HttpResponse.ContentType = "text/css"
                    $HttpResponse.ContentEncoding = [System.Text.Encoding]::UTF8
                    $HttpResponse.ContentLength64 = $CssBytes.Length

                    try {
                        $HttpResponse.OutputStream.Write(
                            $CssBytes,
                            0,
                            $CssBytes.Length
                        )
                    }
                    finally {
                        $HttpResponse.OutputStream.Close()
                    }

                    return
                }

                $CssContent = [System.IO.File]::ReadAllText(
                    $CssFile,
                    [System.Text.Encoding]::UTF8
                )

                $CssBytes = [System.Text.Encoding]::UTF8.GetBytes($CssContent)

                Write-AppLog "CSS RESPONSE TYPE | $($HttpResponse.GetType().FullName) | File=$CssFile | Bytes=$($CssBytes.Length)" "DEBUG"

                $HttpResponse.StatusCode = 200
                $HttpResponse.ContentType = "text/css; charset=utf-8"
                $HttpResponse.ContentEncoding = [System.Text.Encoding]::UTF8
                $HttpResponse.ContentLength64 = $CssBytes.Length

                try {
                    $HttpResponse.OutputStream.Write(
                        $CssBytes,
                        0,
                        $CssBytes.Length
                    )
                }
                finally {
                    $HttpResponse.OutputStream.Close()
                }

                return
            }
            if ($Action -eq "api") {
                $ApiFile = "$ModuleFolder\api.ps1"
            # PASSA_ACTION_BODY_MODULOS_FIX
            $ModuleApiAction = $Query["action"]
            $Action = $Query["action"]

            $Reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
            $Body = $Reader.ReadToEnd()
            $ModuleApiBody = $Body

                if (!(Test-Path $ApiFile)) {
                    Send-JsonResponse `
                        -Response $Response `
                        -StatusCode 404 `
                        -Data @{
                            success = $false
                            error = "API do modulo nao encontrada"
                        }

                    return
                }

                Write-AppLog "Executando API do modulo: $ModuleName" "INFO"

                $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

                try {
                    Write-AppLog "API MODULO INICIO | Modulo=$ModuleName | Query=$($Request.Url.Query)" "INFO" "MODULO"

                    $DebugMode = $false

                    try {
                        $DebugMode = (
                            [string]$Global:AppConfig.environment -ne "production" -and
                            ([string]$Query["debug"]).ToLower() -eq "true"
                        )
                    }
                    catch {
                        $DebugMode = $false
                    }

                    if ($DebugMode) {
                        Write-AppLog "DEBUG MODULO ATIVO | Modulo=$ModuleName | Action=$($Query["action"]) | Metodo=$Method | UserAgent=$UserAgent | IP=$RemoteIp" "DEBUG" "DEBUG"
                        Write-AppLog "DEBUG QUERY | $($Request.Url.Query)" "DEBUG" "DEBUG"

                        if (-not [string]::IsNullOrWhiteSpace($Body)) {
                            Write-AppLog "DEBUG BODY | $Body" "DEBUG" "DEBUG"
                        }
                        else {
                            Write-AppLog "DEBUG BODY | vazio" "DEBUG" "DEBUG"
                        }
                    }

                    $Global:ModuleApiBody = $Body
                    $Global:ModuleApiAction = $Query["action"]
                    $Global:ModuleDebug = $DebugMode

                    $StreamMode = ([string]$Query["stream"]).ToLowerInvariant() -eq "true"
                    if ($StreamMode) {
                        $Response.StatusCode = 200
                        $Response.ContentType = "application/x-ndjson; charset=utf-8"
                        $Response.ContentEncoding = [System.Text.Encoding]::UTF8
                        $Response.SendChunked = $true
                        $StreamEncoding = [System.Text.UTF8Encoding]::new($false)
                        $StreamWriter = [System.IO.StreamWriter]::new($Response.OutputStream, $StreamEncoding, 4096, $true)
                        $StreamWriter.AutoFlush = $true
                        $Global:ModuleStreamWriter = $StreamWriter
                        try {
                            $null = & $ApiFile -Query $Query -Config $Global:AppConfig -Body $Body -Method $Method
                        }
                        catch {
                            $StreamError = @{ type = "error"; success = $false; message = $_.Exception.Message } | ConvertTo-Json -Compress
                            $StreamWriter.WriteLine($StreamError)
                        }
                        finally {
                            $Stopwatch.Stop()
                            Remove-Variable -Name ModuleStreamWriter -Scope Global -ErrorAction SilentlyContinue
                            $StreamWriter.Dispose()
                            $Response.OutputStream.Close()
                        }
                        Write-AppLog "API MODULO STREAM FIM | Modulo=$ModuleName | DuracaoMs=$($Stopwatch.ElapsedMilliseconds)" "INFO" "MODULO"
                        return
                    }

                    $Result = & $ApiFile `
                        -Query $Query `
                        -Config $Global:AppConfig `
                        -Body $Body `
                        -Method $Method

                    if ($DebugMode) {
                        try {
                            $DebugResultJson = $Result | ConvertTo-Json -Depth 20 -Compress
                            Write-AppLog "DEBUG RESULT | Modulo=$ModuleName | $DebugResultJson" "DEBUG" "DEBUG"
                        }
                        catch {
                            Write-AppLog "DEBUG RESULT | Falha ao converter resultado: $($_.Exception.Message)" "WARN" "DEBUG"
                        }
                    }

                    $Stopwatch.Stop()

                    Write-AppLog "API MODULO FIM | Modulo=$ModuleName | DuracaoMs=$($Stopwatch.ElapsedMilliseconds) | Success=$($Result.success)" "INFO" "MODULO"

                    if ($Result.success -eq $false -and -not [string]::IsNullOrWhiteSpace([string]$Result.error)) {
                        Write-AppLog "API MODULO ERRO RETORNADO | Modulo=$ModuleName | Erro=$($Result.error)" "ERROR" "MODULO"
                    }

                    Send-JsonResponse `
                        -Response $Response `
                        -Data $Result

                    return
                }
                catch {
                    $Stopwatch.Stop()

                    Write-AppLog "API MODULO EXCEPTION | Modulo=$ModuleName | DuracaoMs=$($Stopwatch.ElapsedMilliseconds) | Erro=$($_.Exception.Message)" "ERROR" "MODULO"

                    Send-JsonResponse `
                        -Response $Response `
                        -StatusCode 500 `
                        -Data @{
                            success = $false
                            error = $_.Exception.Message
                            module = $ModuleName
                        }

                    return
                }
            }
        }

        Send-JsonResponse `
            -Response $Response `
            -StatusCode 404 `
            -Data @{
                success = $false
                error = "Rota nao encontrada"
                path = $Path
            }
    }
    catch {
        Write-AppLog "ERRO NA ROTA $Path : $($_.Exception.Message)" "ERROR"

        Send-JsonResponse `
            -Response $Response `
            -StatusCode 500 `
            -Data @{
                success = $false
                error = $_.Exception.Message
                path = $Path
            }
    }
}
