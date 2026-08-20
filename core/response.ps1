# ============================================================
# RESPONSE.PS1
# ============================================================
# Funções para devolver respostas HTTP.
# Centralizar isto evita repetir código no servidor.
# ============================================================

function Send-TextResponse {
    param(
        $Response,
        [string]$Content,
        [string]$ContentType = "text/plain",
        [int]$StatusCode = 200
    )

    if ($null -eq $Response) {
        throw "Send-TextResponse recebeu Response nulo."
    }

    $HttpResponse = $null

    if (
        $Response -is [System.Net.HttpListenerResponse] -or
        $Response.PSObject.Properties["StatusCode"]
    ) {
        $HttpResponse = $Response
    }
    elseif (
        $Response -is [System.Net.HttpListenerContext] -or
        $Response.PSObject.Properties["Response"]
    ) {
        $HttpResponse = $Response.Response
    }

    if (
        $null -eq $HttpResponse -or
        -not $HttpResponse.PSObject.Properties["StatusCode"] -or
        -not $HttpResponse.PSObject.Properties["OutputStream"]
    ) {
        $ReceivedType = $Response.GetType().FullName

        throw (
            "Send-TextResponse recebeu objeto incompatível. " +
            "Tipo recebido: " +
            $ReceivedType
        )
    }

    $Bytes = [System.Text.Encoding]::UTF8.GetBytes(
        [string]$Content
    )

    $HttpResponse.StatusCode = $StatusCode
    $HttpResponse.ContentType = $ContentType
    $HttpResponse.ContentEncoding = [System.Text.Encoding]::UTF8
    $HttpResponse.ContentLength64 = $Bytes.Length
    $HttpResponse.Headers["X-Content-Type-Options"] = "nosniff"
    $HttpResponse.Headers["X-Frame-Options"] = "DENY"
    $HttpResponse.Headers["Referrer-Policy"] = "no-referrer"
    $HttpResponse.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    $HttpResponse.Headers["Cache-Control"] = "no-store"

    try {
        $HttpResponse.OutputStream.Write(
            $Bytes,
            0,
            $Bytes.Length
        )
    }
    finally {
        $HttpResponse.OutputStream.Close()
    }
}

function Send-JsonResponse {
    param(
        $Response,
        $Data,
        [int]$StatusCode = 200
    )

    $Json = $Data | ConvertTo-Json -Depth 10

    Send-TextResponse `
        -Response $Response `
        -Content $Json `
        -ContentType "application/json" `
        -StatusCode $StatusCode
}

function Send-FileResponse {
    param(
        $Response,
        [string]$FilePath,
        [string]$ContentType
    )

    if (!(Test-Path $FilePath)) {
        Send-JsonResponse `
            -Response $Response `
            -StatusCode 404 `
            -Data @{
                success = $false
                error   = "Ficheiro nao encontrado"
                file    = $FilePath
            }

        return
    }

    $Content = Get-Content $FilePath -Raw -Encoding UTF8

    Send-TextResponse `
        -Response $Response `
        -Content $Content `
        -ContentType $ContentType
}
