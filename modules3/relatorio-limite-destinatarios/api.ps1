param($Query=$null,$Config=$null,$Body=$null,$Method="GET")
$ErrorActionPreference="Stop"
function Send-Json($Object){$Object|ConvertTo-Json -Depth 20 -Compress}
function Send-StreamEvent($Object){
  if(-not $Global:ModuleStreamWriter){throw 'Canal de progresso não disponível.'}
  $Global:ModuleStreamWriter.WriteLine(($Object|ConvertTo-Json -Depth 20 -Compress))
}
function Convert-MailboxRow($Mailbox,[string[]]$Domains){
  $address=[string]$Mailbox.PrimarySmtpAddress
  $domain=if($address -match '@(.+)$'){$Matches[1].ToLowerInvariant()}else{''}
  if($domain -notin $Domains){return $null}
  $raw=[string]$Mailbox.RecipientLimits
  $unlimited=[string]::IsNullOrWhiteSpace($raw)-or $raw -eq 'Unlimited'
  $limit=if($unlimited){'Sem limite'}else{$raw}
  $status=if($unlimited){'Sem limite'}elseif($raw -eq '50'){'Limite 50'}else{'Outro limite'}
  [PSCustomObject]@{displayName=[string]$Mailbox.DisplayName;primarySmtpAddress=$address;domain=$domain;recipientTypeDetails=[string]$Mailbox.RecipientTypeDetails;recipientLimit=$limit;status=$status}
}
function New-ApprovalMail($Payload){
  $to=[string]$Payload.to;$cc=[string]$Payload.cc;$subject=[string]$Payload.subject;$limit=[int]$Payload.limit;$boxes=@($Payload.mailboxes)
  if([string]::IsNullOrWhiteSpace($to)){throw 'Destinatário não informado.'};if([string]::IsNullOrWhiteSpace($subject)){throw 'Assunto não informado.'};if($limit-lt 1-or$limit-gt 1000){throw 'Limite inválido.'};if($boxes.Count-eq 0-or$boxes.Count-gt 500){throw 'Seleção de caixas inválida.'}
  $encode={param($v)[Net.WebUtility]::HtmlEncode([string]$v)}
  $rows=@($boxes|ForEach-Object{"<tr><td style='padding:9px;border-bottom:1px solid #e5e7eb;'>$(& $encode $_.displayName)</td><td style='padding:9px;border-bottom:1px solid #e5e7eb;'>$(& $encode $_.primarySmtpAddress)</td><td style='padding:9px;border-bottom:1px solid #e5e7eb;'>$(& $encode $_.recipientLimit)</td></tr>"})-join''
  $html="<table width='100%' style='max-width:850px;border-collapse:collapse;font-family:Segoe UI,Arial;color:#24272b'><tr><td style='background:#ec0000;color:#fff;padding:22px 26px'><div style='font-size:11px;text-transform:uppercase'>Santander Support Web V2</div><div style='font-size:24px;font-weight:700'>Pedido de aprovação</div><div>Alteração de limite de destinatários</div></td></tr><tr><td style='padding:24px 26px'><p>Solicita-se aprovação para alterar o limite de destinatários das caixas abaixo para <strong>$limit</strong>.</p><table width='100%' style='border-collapse:collapse;border:1px solid #ddd;font-size:12px'><tr style='background:#24272b;color:#fff'><th align='left' style='padding:9px'>Nome</th><th align='left' style='padding:9px'>Mailbox</th><th align='left' style='padding:9px'>Limite atual</th></tr>$rows</table><p style='margin-top:22px'>Atenciosamente,<br><strong>IT Santander Portugal</strong></p></td></tr></table>"
  try{$outlook=[Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')}catch{try{$outlook=New-Object -ComObject Outlook.Application}catch{throw 'Não foi possível utilizar o Outlook clássico. Confirme que está aberto na mesma sessão do servidor.'}}
  $mail=$outlook.CreateItem(0);try{$mail.SentOnBehalfOfName='User.Action.Required@santander.pt'}catch{};$mail.To=$to;$mandatory='santander.enduser@santander.pt';$mail.CC=if([string]::IsNullOrWhiteSpace($cc)){$mandatory}elseif($cc-notmatch[regex]::Escape($mandatory)){"$cc;$mandatory"}else{$cc};$mail.Subject=$subject;$mail.HTMLBody=$html;$mail.Display()
  @{success=$true;message='Email de aprovação preparado no Outlook para revisão.'}
}
function Assert-ExchangeConnection {
  if(-not (Get-Command Get-EXOMailbox -ErrorAction SilentlyContinue)){throw "Exchange Online não conectado. Use primeiro o botão Conectar Exchange."}
  try{$connection=Get-ConnectionInformation -ErrorAction Stop|Select-Object -First 1}catch{$connection=$null}
  if(-not $connection){throw "Não existe uma sessão ativa no Exchange Online. Use primeiro o botão Conectar Exchange."}
}
try {
  if(([string]$Method).ToUpperInvariant() -ne 'POST'){throw 'Método HTTP inválido.'}
  $action=[string]$Query['action']
  if($action -notin @('consultar','consultar-stream','aplicar-limite','preparar-aprovacao')){throw "Ação inválida: $action"}
  $payload=if([string]::IsNullOrWhiteSpace([string]$Body)){[PSCustomObject]@{}}else{$Body|ConvertFrom-Json -ErrorAction Stop}
  if($action -eq 'preparar-aprovacao'){Send-Json (New-ApprovalMail $payload);return}
  if($action -eq 'aplicar-limite'){
    Assert-ExchangeConnection;$limit=[int]$payload.limit;$identities=@($payload.identities|ForEach-Object{([string]$_).Trim()}|Where-Object{$_}|Sort-Object -Unique)
    if($limit-lt 1-or$limit-gt 1000){throw 'O limite deve estar entre 1 e 1000.'};if($identities.Count-eq 0-or$identities.Count-gt 500){throw 'Selecione entre 1 e 500 caixas.'}
    $updated=[Collections.Generic.List[object]]::new();$failed=[Collections.Generic.List[object]]::new();foreach($identity in $identities){try{Set-Mailbox -Identity $identity -RecipientLimits $limit -Confirm:$false -ErrorAction Stop|Out-Null;$updated.Add(@{identity=$identity;limit=$limit})}catch{$failed.Add(@{identity=$identity;error=$_.Exception.Message})}}
    Send-Json @{success=$true;updated=@($updated);failed=@($failed)};return
  }
  $allowed=@('santander.pt','servexternos.santander.pt')
  $domains=@($payload.domains|ForEach-Object{([string]$_).Trim().TrimStart('@').ToLowerInvariant()}|Where-Object{$_ -in $allowed}|Sort-Object -Unique)
  if($domains.Count -eq 0){throw 'Selecione pelo menos um domínio válido.'}
  $mailboxType=[string]$payload.mailboxType
  if($mailboxType -notin @('UserMailbox','SharedMailbox')){$mailboxType='all'}
  $limitMode=[string]$payload.limitMode
  if($limitMode -notin @('exact','unlimited')){$limitMode='all'}
  $limitValue=0
  if($limitMode -eq 'exact'){
    if(-not [int]::TryParse([string]$payload.limitValue,[ref]$limitValue)-or $limitValue -lt 1){throw 'Quantidade do limite inválida.'}
  }
  $domainFilter=@($domains|ForEach-Object{"WindowsEmailAddress -like '*@$_'"}) -join ' -or '
  $filterParts=[Collections.Generic.List[string]]::new()
  $filterParts.Add("($domainFilter)")
  if($limitMode -eq 'exact'){$filterParts.Add("RecipientLimits -eq '$limitValue'")}
  elseif($limitMode -eq 'unlimited'){$filterParts.Add("RecipientLimits -eq 'Unlimited'")}
  $exchangeFilter=$filterParts -join ' -and '
  $recipientTypes=if($mailboxType -eq 'all'){@('UserMailbox','SharedMailbox')}else{@($mailboxType)}
  Assert-ExchangeConnection
  if($action -eq 'consultar-stream'){
    Send-StreamEvent @{type='start';success=$true;domains=$domains;filter=$exchangeFilter;mailboxType=$mailboxType;message='Consulta otimizada iniciada no Exchange Online.'}
    $batch=[Collections.Generic.List[object]]::new();$scanned=0;$found=0
    Get-EXOMailbox -Filter $exchangeFilter -ResultSize Unlimited -RecipientTypeDetails $recipientTypes -Properties DisplayName,PrimarySmtpAddress,RecipientTypeDetails,RecipientLimits -ErrorAction Stop | ForEach-Object {
      $scanned++
      $row=Convert-MailboxRow $_ $domains
      if($row){$batch.Add($row);$found++}
      if($batch.Count -ge 50){Send-StreamEvent @{type='batch';scanned=$scanned;found=$found;rows=@($batch)};$batch.Clear()}
      elseif(($scanned % 100) -eq 0){Send-StreamEvent @{type='progress';scanned=$scanned;found=$found}}
    }
    if($batch.Count){Send-StreamEvent @{type='batch';scanned=$scanned;found=$found;rows=@($batch)}}
    Send-StreamEvent @{type='complete';success=$true;scanned=$scanned;found=$found;generatedAt=(Get-Date).ToString('dd/MM/yyyy HH:mm')}
    return
  }
  $mailboxes=@(Get-EXOMailbox -Filter $exchangeFilter -ResultSize Unlimited -RecipientTypeDetails $recipientTypes -Properties DisplayName,PrimarySmtpAddress,RecipientTypeDetails,RecipientLimits -ErrorAction Stop)
  $rows=@($mailboxes|ForEach-Object{Convert-MailboxRow $_ $domains}|Where-Object{$_}|Sort-Object domain,primarySmtpAddress)
  Send-Json @{success=$true;module='relatorio-limite-destinatarios';generatedAt=(Get-Date).ToString('dd/MM/yyyy HH:mm');domains=$domains;rows=$rows;summary=@{total=$rows.Count;limit50=@($rows|Where-Object status -eq 'Limite 50').Count;otherLimits=@($rows|Where-Object status -eq 'Outro limite').Count;unlimited=@($rows|Where-Object status -eq 'Sem limite').Count}}
}catch{Send-Json @{success=$false;module='relatorio-limite-destinatarios';message=$_.Exception.Message}}
