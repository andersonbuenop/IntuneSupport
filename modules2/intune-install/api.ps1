param(
    $Query,
    $Config,
    $Body,
    $Method
)

$ErrorActionPreference = "Stop"

function New-Result {
    param(
        [bool]$Success,
        [string]$Error = ""
    )

    return @{
        success = $Success
        error   = $Error
    }
}

function Ensure-GraphModules {
    $modules = @(
        "Microsoft.Graph.Authentication",
        "Microsoft.Graph.Users",
        "Microsoft.Graph.Groups"
    )

    foreach ($m in $modules) {
        $found = Get-Module $m -ListAvailable |
            Sort-Object Version -Descending |
            Select-Object -First 1

        if (!$found) {
            throw "Módulo PowerShell não encontrado: $m"
        }

        Import-Module $m -ErrorAction Stop
    }
}

function Ensure-GraphConnection {
    Ensure-GraphModules

    $RequiredScopes = @(
        "User.Read.All",
        "Group.Read.All",
        "GroupMember.ReadWrite.All",
        "DeviceManagementManagedDevices.Read.All"
    )

    $ctx = $null

    try {
        $ctx = Get-MgContext
    }
    catch {
        $ctx = $null
    }

    if ($ctx) {
        $MissingScopes = @($RequiredScopes | Where-Object { $_ -notin @($ctx.Scopes) })
        if ($MissingScopes.Count -eq 0) {
            return $ctx
        }
    }

    Connect-MgGraph `
        -Scopes $RequiredScopes `
        -NoWelcome `
        -ErrorAction Stop | Out-Null

    $ctx = Get-MgContext

    if (!$ctx) {
        throw "Não foi possível ligar ao Microsoft Graph."
    }

    return $ctx
}

function Get-IntuneManagedDevices {
    param([string]$UserPrincipalName)

    if ([string]::IsNullOrWhiteSpace($UserPrincipalName)) { return @() }

    $SafeUpn = $UserPrincipalName.Replace("'", "''")
    $Filter = [Uri]::EscapeDataString("userPrincipalName eq '$SafeUpn'")
    $Select = 'id,deviceName,operatingSystem,osVersion,manufacturer,model,complianceState,managementAgent,lastSyncDateTime,enrolledDateTime'
    $Uri = "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?`$filter=$Filter&`$select=$Select"
    $Response = Invoke-MgGraphRequest -Method GET -Uri $Uri -ErrorAction Stop

    return @($Response.value | ForEach-Object {
        @{
            id = [string]$_.id
            deviceName = [string]$_.deviceName
            operatingSystem = [string]$_.operatingSystem
            osVersion = [string]$_.osVersion
            manufacturer = [string]$_.manufacturer
            model = [string]$_.model
            complianceState = [string]$_.complianceState
            managementAgent = [string]$_.managementAgent
            lastSyncDateTime = [string]$_.lastSyncDateTime
            enrolledDateTime = [string]$_.enrolledDateTime
        }
    })
}

function Resolve-IntuneUser {
    param([string]$UserInput)

    $valor = $UserInput.Trim()

    if ([string]::IsNullOrWhiteSpace($valor)) {
        throw "Utilizador não informado."
    }

    if ($valor -notmatch "@") {
        $upn = "$($valor.ToUpper())@corp.santander.pt"
    }
    else {
        $partes = $valor.Split("@")
        $upn = "$($partes[0].ToUpper())@$($partes[1])"
    }

    try {
        $u = Get-MgUser `
            -UserId $upn `
            -Property "Id,DisplayName,UserPrincipalName,MailNickname,Mail" `
            -ErrorAction Stop

        if ($u) {
            return $u
        }
    }
    catch {
    }

    $nick = ($valor -replace "@.*", "").ToUpper()
    $safeNick = $nick.Replace("'", "''")

    try {
        $res = Get-MgUser `
            -Filter "mailNickname eq '$safeNick'" `
            -All `
            -Property "Id,DisplayName,UserPrincipalName,MailNickname,Mail" `
            -ErrorAction Stop

        if ($res) {
            return ($res | Select-Object -First 1)
        }
    }
    catch {
    }

    return $null
}

function Get-UserGroupNames {
    param([string]$UserId)

    $memberOf = Get-MgUserMemberOf -UserId $UserId -All -ErrorAction Stop

    return @(
        $memberOf |
            ForEach-Object { $_.AdditionalProperties.displayName } |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
}

function Get-TechnicianName {
    $fallback = $env:USERNAME

    try {
        $upn = "$($env:USERNAME.ToUpper())@corp.santander.pt"

        $tech = Get-MgUser `
            -UserId $upn `
            -Property "DisplayName" `
            -ErrorAction Stop

        if ($tech.DisplayName) {
            return $tech.DisplayName
        }
    }
    catch {
    }

    return $fallback
}

function Get-Saudacao {
    $h = (Get-Date).Hour

    if ($h -ge 1 -and $h -lt 12) {
        return "Bom dia"
    }

    if ($h -ge 12 -and $h -lt 19) {
        return "Boa tarde"
    }

    return "Boa noite"
}

function Build-IntuneTicket {
    param(
        [string]$Nome,
        [string]$Assinatura,
        [array]$MobileDevices = @()
    )

    $s = Get-Saudacao
    $ExistingDeviceNotice = ""

    if ($MobileDevices.Count -gt 0) {
        $DeviceLines = @($MobileDevices | ForEach-Object {
            $DeviceName = if ([string]::IsNullOrWhiteSpace([string]$_.deviceName)) { "Equipamento sem nome" } else { [string]$_.deviceName }
            $BrandModel = ((@([string]$_.manufacturer, [string]$_.model) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join " ").Trim()
            $System = ((@([string]$_.operatingSystem, [string]$_.osVersion) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join " ").Trim()
            $Details = @($BrandModel, $System) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
            if ($Details.Count -gt 0) { "- $DeviceName ($($Details -join ' | '))" } else { "- $DeviceName" }
        })

        $ExistingDeviceNotice = @"
Identificámos que já possui o(s) seguinte(s) equipamento(s) móvel(eis) configurado(s) no Intune:

$($DeviceLines -join [Environment]::NewLine)

Pode avançar com a configuração do novo equipamento. Mantenha o equipamento antigo disponível e não o apague, reponha ou entregue enquanto a configuração do Intune e do MFA não estiver concluída e testada no novo equipamento.

"@
    }

    return @"
$s $Nome,

Agradecemos a sua solicitação.

A configuração foi realizada, porém terá que aguardar 24 horas para a sincronização entre os servidores em Portugal e Espanha.

Após as 24 horas, poderá proceder com a configuração do seu telemóvel. Receberá dois e-mails com as instruções e os manuais para configuração do Intune/Harmony e do MFA.

$ExistingDeviceNotice
Caso tenha alguma dúvida, pedimos que crie um novo pedido no ServiceNow, reportando as suas dificuldades.

Link para abertura do pedido:
https://santander.service-now.com/sp?id=sc_cat_item&sys_id=3bc65c23db79c0d4f1024dc2ba9619a7

Atentamente,
$Assinatura
"@
}

function Get-IntuneManualPackages {
    $ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
    $FilesRoot = Join-Path $ProjectRoot 'files'
    $Definitions = @(
        @{ key = 'mobile'; title = 'Configuração do Intune e Harmony'; subject = 'Configuração do telemóvel - Intune e Harmony'; files = @('Manual-Intune-Android.pdf', 'Manual-Intune-iOS.pdf') },
        @{ key = 'mfa'; title = 'Configuração do MFA'; subject = 'Configuração do MFA - Microsoft Authenticator'; files = @('Manual-Auhenticator IOS.pdf', 'Manual-Authenticator Android.pdf') }
    )
    return @($Definitions | ForEach-Object {
        $Paths = @($_.files | ForEach-Object { Join-Path $FilesRoot $_ })
        @{
            key = $_.key; title = $_.title; subject = $_.subject; fileNames = @($_.files)
            attachments = @($Paths | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | ForEach-Object { Get-Item -LiteralPath $_ })
            missing = @($Paths | Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) } | ForEach-Object { Split-Path $_ -Leaf })
        }
    })
}

function Build-IntuneEmailText {
    param([string]$Kind, [string]$Nome, [string]$Assinatura, [array]$MobileDevices = @())
    $s = Get-Saudacao
    $OldDeviceBlock = ""
    if ($MobileDevices.Count -gt 0) {
        $Lines = @($MobileDevices | ForEach-Object {
            $Name = if ([string]::IsNullOrWhiteSpace([string]$_.deviceName)) { 'Equipamento sem nome' } else { [string]$_.deviceName }
            $Details = ((@([string]$_.manufacturer, [string]$_.model, [string]$_.operatingSystem, [string]$_.osVersion) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ' ').Trim()
            if ($Details) { "- $Name ($Details)" } else { "- $Name" }
        })
        $OldDeviceBlock = @"
Equipamento(s) móvel(eis) já configurado(s):
$($Lines -join [Environment]::NewLine)

Mantenha o equipamento antigo disponível. Não o apague, reponha ou entregue até concluir e testar o Intune e o MFA no novo equipamento.

"@
    }
    if ($Kind -eq 'mobile') { return @"
$s $Nome,

Este é o primeiro de dois e-mails. Seguem em anexo os manuais Android e iOS para configurar o novo telemóvel no Intune e a aplicação Harmony.

$OldDeviceBlock
Passo a passo:

1. Aguarde o período de 24 horas para a sincronização entre os servidores em Portugal e Espanha.
2. Confirme os requisitos mínimos: Android 12 ou superior, ou iOS 18.6.2 ou superior.
3. Configure um PIN/password: mínimo de 6 caracteres em Apple e 8 caracteres em Android.
4. Com uma ligação estável, siga o manual Android ou iOS anexo para instalar e configurar o Portal da Empresa Intune.
5. Inicie sessão com a sua conta corporativa e conclua o registo, aceitando os perfis e permissões solicitados.
6. Configure a aplicação Harmony seguindo as instruções incluídas no mesmo manual.
7. Confirme que o equipamento ficou registado e que consegue aceder às aplicações corporativas sem alertas pendentes.

Não remova o equipamento antigo nesta fase. Consulte o segundo e-mail para configurar e testar o MFA.

Atentamente,
$Assinatura
"@
    }
    if ($Kind -eq 'mfa') { return @"
$s $Nome,

Este é o segundo de dois e-mails. Seguem em anexo os manuais Android e iOS para configurar o Microsoft Authenticator/MFA no novo equipamento.

Passo a passo:

1. Mantenha o equipamento antigo disponível e com acesso ao MFA.
2. No novo equipamento, instale o Microsoft Authenticator.
3. Aceda às Informações de Segurança da sua conta corporativa e adicione um novo método de autenticação.
4. Siga o manual anexo correspondente ao sistema operativo do novo equipamento para concluir a associação.
5. Efetue um teste e confirme que consegue aprovar um pedido de MFA no novo equipamento.
6. Não elimine o método antigo antes de concluir o teste com sucesso.

Se ocorrer algum erro, abra um novo pedido no ServiceNow e indique o passo em que ocorreu o problema.

Atentamente,
$Assinatura
"@ }
    return ""
}

function Send-IntuneConfigurationEmail {
    param([string]$Recipient, [string]$Subject, [string]$Text, [array]$Attachments)
    $SenderAddress = 'User.Action.Required@santander.pt'
    if ($Recipient -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$') { throw 'Endereço de e-mail do utilizador inválido.' }
    try { $Outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') }
    catch { try { $Outlook = New-Object -ComObject Outlook.Application } catch { throw 'Não foi possível utilizar o Outlook clássico. Confirme que está aberto na mesma sessão do servidor.' } }
    $Mail = $Outlook.CreateItem(0)
    $Mail.To = $Recipient
    $Mail.Subject = $Subject
    $Mail.SentOnBehalfOfName = $SenderAddress
    $Encoded = [Net.WebUtility]::HtmlEncode($Text) -replace "(`r`n|`n|`r)", '<br>'
    $Mail.HTMLBody = "<!doctype html><html><body style='margin:0;padding:0;background:#f3f3f3;font-family:Segoe UI,Arial,sans-serif;color:#2d2d2d'><table role='presentation' width='100%' cellspacing='0' cellpadding='0'><tr><td align='center' style='padding:24px 12px'><table role='presentation' width='680' cellspacing='0' cellpadding='0' style='max-width:100%;background:#ffffff;box-shadow:0 2px 8px rgba(0,0,0,.10)'><tr><td style='background:#ec0000;padding:22px 28px;color:#ffffff'><strong style='font-size:25px;letter-spacing:1px'>SANTANDER</strong><span style='float:right;font-size:12px'>IT Santander Portugal<br>Instalação Intune</span></td></tr><tr><td style='padding:28px;font-size:14px;line-height:1.65;color:#333333'>$Encoded</td></tr><tr><td style='background:#f7f7f7;border-top:1px solid #e5e5e5;padding:16px 28px;font-size:11px;color:#777777'>Mensagem enviada pelo Santander Support Web V2.</td></tr></table></td></tr></table></body></html>"
    foreach ($File in $Attachments) { [void]$Mail.Attachments.Add($File.FullName) }
    if (-not $Mail.Recipients.ResolveAll()) { throw 'O Outlook não conseguiu validar o destinatário.' }
    $Mail.Send()
    return @{ sender = $SenderAddress; recipient = $Recipient; subject = $Subject; attachments = @($Attachments | ForEach-Object Name); sentAt = (Get-Date).ToString('o') }
}

function Test-IsMobileIntuneDevice {
    param($Device)
    $Description = "$( [string]$Device.operatingSystem ) $( [string]$Device.model ) $( [string]$Device.deviceName )"
    return $Description -match '(?i)android|ios|ipados|iphone|ipad|tablet|mobile|phone|smartphone'
}

function Build-MacAccessTicket {
    param([string]$Nome, [string]$Assinatura, [string]$GroupName, [string]$Action)
    $s = Get-Saudacao
    $ResultText = switch ($Action) {
        'ADDED' { "Foi concedido ao utilizador acesso ao grupo $GroupName, necessário para a configuração e gestão do equipamento MacBook através do Microsoft Intune." }
        'REMOVED' { "Foi removido o acesso do utilizador ao grupo $GroupName, associado à configuração e gestão de equipamentos MacBook através do Microsoft Intune." }
        default { "Confirmámos que o utilizador já possui acesso ao grupo $GroupName para configuração do equipamento MacBook através do Microsoft Intune." }
    }
    return @"
$s $Nome,

Agradecemos a sua solicitação.

$ResultText

As alterações de acesso poderão demorar até 24 horas a ficar disponíveis em todos os sistemas.

Caso encontre alguma dificuldade durante a configuração do MacBook, pedimos que abra um novo pedido no ServiceNow, indicando o erro apresentado.

Atentamente,
$Assinatura
"@
}

function Add-UserToGraphGroup {
    param(
        [string]$UserId,
        [string]$GroupName
    )

    if ([string]::IsNullOrWhiteSpace($UserId)) {
        throw "UserId não informado."
    }

    if ([string]::IsNullOrWhiteSpace($GroupName)) {
        throw "Grupo não informado."
    }

    if ($GroupName -notin @("GR_Intune_Central_Mdm", "GR_Intune_Rede_Mdm", "GR_Intune_Central_MDM_MAC")) {
        throw "Grupo inválido: $GroupName"
    }

    $group = Get-MgGroup `
        -Filter "displayName eq '$GroupName'" `
        -ErrorAction Stop |
        Select-Object -First 1

    if (!$group) {
        throw "Grupo não encontrado: $GroupName"
    }

    $ExistingGroups = Get-UserGroupNames -UserId $UserId
    if ($ExistingGroups -contains $GroupName) {
        return $false
    }

    New-MgGroupMemberByRef `
        -GroupId $group.Id `
        -BodyParameter @{
            "@odata.id" = "https://graph.microsoft.com/v1.0/directoryObjects/$UserId"
        } `
        -ErrorAction Stop | Out-Null

    return $true
}

function Remove-UserFromGraphGroup {
    param([string]$UserId, [string]$GroupName)

    if ([string]::IsNullOrWhiteSpace($UserId)) { throw "UserId não informado." }
    if ($GroupName -notin @("GR_Intune_Central_Mdm", "GR_Intune_Rede_Mdm", "GR_Intune_Central_MDM_MAC")) { throw "Grupo inválido: $GroupName" }

    $ExistingGroups = Get-UserGroupNames -UserId $UserId
    if ($ExistingGroups -notcontains $GroupName) { return $false }

    $SafeGroupName = $GroupName.Replace("'", "''")
    $Group = Get-MgGroup -Filter "displayName eq '$SafeGroupName'" -ErrorAction Stop | Select-Object -First 1
    if (!$Group) { throw "Grupo não encontrado: $GroupName" }

    Remove-MgGroupMemberByRef -GroupId $Group.Id -DirectoryObjectId $UserId -ErrorAction Stop
    return $true
}

try {
    $Action = [string]$Query["action"]

    if ([string]::IsNullOrWhiteSpace($Action)) {
        return New-Result -Success $false -Error "Action não informada."
    }

    Ensure-GraphConnection | Out-Null

    switch ($Action) {

        "searchUser" {
            $UserInput = [string]$Query["user"]

            if ([string]::IsNullOrWhiteSpace($UserInput)) {
                return New-Result -Success $false -Error "Utilizador não informado."
            }

            $user = Resolve-IntuneUser -UserInput $UserInput

            if (!$user) {
                return New-Result -Success $false -Error "Utilizador não encontrado."
            }

            $groups = Get-UserGroupNames -UserId $user.Id

            $hasCentral = $groups -contains "GR_Intune_Central_Mdm"
            $hasRede    = $groups -contains "GR_Intune_Rede_Mdm"
            $hasMac     = $groups -contains "GR_Intune_Central_MDM_MAC"

            $techName = Get-TechnicianName

            $devices = @()
            $devicesWarning = ""
            try {
                $devices = @(Get-IntuneManagedDevices -UserPrincipalName $user.UserPrincipalName)
            }
            catch {
                $devicesWarning = "Não foi possível consultar os equipamentos Intune: $($_.Exception.Message)"
            }

            $mobileDevices = @($devices | Where-Object { Test-IsMobileIntuneDevice -Device $_ })
            $ticket = Build-IntuneTicket `
                -Nome $user.DisplayName `
                -Assinatura $techName `
                -MobileDevices $mobileDevices
            $packages = @(Get-IntuneManualPackages)
            $emailRecipient = if (-not [string]::IsNullOrWhiteSpace([string]$user.Mail)) { [string]$user.Mail } else { [string]$user.UserPrincipalName }
            $emailMessages = @($packages | ForEach-Object {
                @{ key = $_.key; title = $_.title; subject = $_.subject; attachments = @($_.attachments | ForEach-Object Name); missing = @($_.missing); body = (Build-IntuneEmailText -Kind $_.key -Nome $user.DisplayName -Assinatura $techName -MobileDevices $mobileDevices) }
            })
            $emailMissing = @($packages | ForEach-Object { $_.missing })

            return @{
                success           = $true
                id                = $user.Id
                displayName       = $user.DisplayName
                userPrincipalName = $user.UserPrincipalName
                mailNickname      = $user.MailNickname
                hasCentral        = $hasCentral
                hasRede           = $hasRede
                hasMac            = $hasMac
                ticket            = $ticket
                technician        = $techName
                devices           = @($devices)
                devicesWarning    = $devicesWarning
                mobileDeviceCount = $mobileDevices.Count
                emailRecipient    = $emailRecipient
                emailSender       = 'User.Action.Required@santander.pt'
                emailSubject      = '2 e-mails de configuração: Intune/Harmony e MFA'
                emailBody         = (($emailMessages | ForEach-Object { "=== $($_.title) ===`r`n$($_.body)" }) -join "`r`n`r`n")
                emailAttachments  = @($packages | ForEach-Object { $_.attachments | ForEach-Object Name })
                emailMessages     = $emailMessages
                emailMissing      = $emailMissing
                emailReady        = ($emailMissing.Count -eq 0)
            }
        }

        "addGroup" {
            if ([string]$Method -ne "POST") {
                return New-Result -Success $false -Error "A adição ao grupo requer um pedido POST."
            }
            $userId    = [string]$Query["userId"]
            $groupName = [string]$Query["groupName"]

            $added = Add-UserToGraphGroup `
                -UserId $userId `
                -GroupName $groupName

            $actionTicket = $null
            if ($groupName -eq 'GR_Intune_Central_MDM_MAC') {
                $targetUser = Get-MgUser -UserId $userId -Property 'DisplayName' -ErrorAction Stop
                $actionTicket = Build-MacAccessTicket -Nome $targetUser.DisplayName -Assinatura (Get-TechnicianName) -GroupName $groupName -Action $(if ($added) { 'ADDED' } else { 'EXISTS' })
            }

            return @{
                success = $true
                group   = $groupName
                added   = $added
                message = $(if ($added) { "Utilizador adicionado com sucesso ao grupo $groupName." } else { "O utilizador já pertencia ao grupo $groupName." })
                ticket  = $actionTicket
            }
        }

        "removeGroup" {
            if ([string]$Method -ne "POST") {
                return New-Result -Success $false -Error "A remoção do grupo requer um pedido POST."
            }

            $userId = [string]$Query["userId"]
            $groupName = [string]$Query["groupName"]
            $removed = Remove-UserFromGraphGroup -UserId $userId -GroupName $groupName

            $actionTicket = $null
            if ($groupName -eq 'GR_Intune_Central_MDM_MAC') {
                $targetUser = Get-MgUser -UserId $userId -Property 'DisplayName' -ErrorAction Stop
                $actionTicket = Build-MacAccessTicket -Nome $targetUser.DisplayName -Assinatura (Get-TechnicianName) -GroupName $groupName -Action $(if ($removed) { 'REMOVED' } else { 'EXISTS' })
            }

            return @{
                success = $true
                group = $groupName
                removed = $removed
                message = $(if ($removed) { "Utilizador removido com sucesso do grupo $groupName." } else { "O utilizador já não pertencia ao grupo $groupName." })
                ticket = $actionTicket
            }
        }

        "sendConfigurationEmail" {
            if ([string]$Method -ne 'POST') {
                return New-Result -Success $false -Error 'O envio de e-mail requer um pedido POST.'
            }
            $userId = [string]$Query['userId']
            if ($userId -notmatch '^[0-9a-fA-F-]{36}$') { return New-Result -Success $false -Error 'UserId inválido.' }
            $user = Get-MgUser -UserId $userId -Property 'Id,DisplayName,UserPrincipalName,Mail' -ErrorAction Stop
            $recipient = if (-not [string]::IsNullOrWhiteSpace([string]$user.Mail)) { [string]$user.Mail } else { [string]$user.UserPrincipalName }
            $devices = @(Get-IntuneManagedDevices -UserPrincipalName $user.UserPrincipalName)
            $mobileDevices = @($devices | Where-Object { Test-IsMobileIntuneDevice -Device $_ })
            $technician = Get-TechnicianName
            $packages = @(Get-IntuneManualPackages)
            $missing = @($packages | ForEach-Object { $_.missing })
            if ($missing.Count -gt 0) { return New-Result -Success $false -Error "Manuais em falta na pasta files: $($missing -join ', ')" }
            $sent = @()
            foreach ($package in $packages) {
                $emailText = Build-IntuneEmailText -Kind $package.key -Nome $user.DisplayName -Assinatura $technician -MobileDevices $mobileDevices
                $sent += Send-IntuneConfigurationEmail -Recipient $recipient -Subject $package.subject -Text $emailText -Attachments $package.attachments
            }
            return @{ success = $true; message = "Dois e-mails enviados para $recipient."; emails = @($sent) }
        }

        default {
            return New-Result -Success $false -Error "Action inválida: $Action"
        }
    }
}
catch {
    return @{
        success = $false
        error   = $_.Exception.Message
        type    = $_.Exception.GetType().FullName
    }
}
