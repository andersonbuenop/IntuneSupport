#requires -Version 5.1
Set-StrictMode -Version 2.0
$script:IcmAbsenceCache = @{}
function ConvertTo-IcmAbsenceDate { param($Value) if($null-eq$Value){return $null};$Text=if($Value.PSObject.Properties['dateTime']){[string]$Value.dateTime}else{[string]$Value};$Parsed=[datetimeoffset]::MinValue;if([datetimeoffset]::TryParse($Text,[ref]$Parsed)){return $Parsed};return $null }
function Get-IcmExchangeConnection {
 $Connection=$null;try{$Connection=Get-ConnectionInformation -ErrorAction Stop|Select-Object -First 1}catch{}
 [pscustomobject]@{connected=[bool]$Connection;account=if($Connection){[string]$Connection.UserPrincipalName}else{$null}}
}
function Connect-IcmExchange {
 if(!(Get-Module -ListAvailable ExchangeOnlineManagement)){throw 'Módulo ExchangeOnlineManagement não instalado.'}
 Import-Module ExchangeOnlineManagement -ErrorAction Stop
 $Existing=Get-IcmExchangeConnection;if($Existing.connected){return $Existing}
 Connect-ExchangeOnline -ShowBanner:$false -DisableWAM -ErrorAction Stop
 $Result=Get-IcmExchangeConnection;if(!$Result.connected){throw 'A ligação ao Exchange Online não foi concluída.'};return $Result
}
function Get-IcmUserAbsence {
 [CmdletBinding()]param([AllowNull()][string]$UserPrincipalName,[datetimeoffset]$Now=[datetimeoffset]::Now)
 $Upn=([string]$UserPrincipalName).Trim().ToLowerInvariant();if(!$Upn){return [pscustomobject]@{checked=$false;active=$false;status='NoIdentity';justification='Ausência/Férias não verificada';startAt=$null;endAt=$null}}
 if($script:IcmAbsenceCache.ContainsKey($Upn)){return $script:IcmAbsenceCache[$Upn]}
 $R=[ordered]@{checked=$false;active=$false;status='NotVerified';justification='Ausência/Férias não verificada';startAt=$null;endAt=$null;source='ExchangeOnlineAutoReply'}
 try{if(!(Get-Command Get-MailboxAutoReplyConfiguration -ErrorAction SilentlyContinue)){throw 'Exchange Online não ligado. Use o botão Conectar Exchange.'};$Reply=Get-MailboxAutoReplyConfiguration -Identity $Upn -ErrorAction Stop;$Status=([string]$Reply.AutoReplyState).ToLowerInvariant();$Start=ConvertTo-IcmAbsenceDate $Reply.StartTime;$End=ConvertTo-IcmAbsenceDate $Reply.EndTime;$Active=$Status-eq'enabled'-or($Status-eq'scheduled'-and(!$Start-or$Now-ge$Start)-and(!$End-or$Now-lt$End));$R.checked=$true;$R.active=[bool]$Active;$R.status=if($Active){'AbsenceVacation'}else{'Available'};$R.justification=if($Active){'Ausência/Férias — prazo suspenso até ao regresso.'}else{'Disponível'};$R.startAt=if($Start){$Start.ToString('o')}else{$null};$R.endAt=if($End){$End.ToString('o')}else{$null}}catch{$R.error=$_.Exception.Message}
 $O=[pscustomobject]$R;$script:IcmAbsenceCache[$Upn]=$O;return $O
}
function Set-IcmAbsenceProperty {param($Object,[string]$Name,$Value)if($Object.PSObject.Properties[$Name]){$Object.$Name=$Value}else{$Object|Add-Member -NotePropertyName $Name -NotePropertyValue $Value}}
function Update-IcmAbsenceLifecycle {
 param([object[]]$Devices=@());$Path=Join-Path $PSScriptRoot 'notification-lifecycle.json';if(!(Test-Path -LiteralPath $Path)){return};$Doc=Get-Content -LiteralPath $Path -Raw -Encoding UTF8|ConvertFrom-Json;$Now=[datetimeoffset]::Now;$Changed=$false
 foreach($Device in @($Devices)){$Key=Get-LifecycleDeviceKey $Device;$Active=[bool](Get-LifecycleValueSafe $Device 'absenceActive' $false);foreach($Item in @($Doc.items|Where-Object{[string]$_.deviceKey-eq[string]$Key})){$Pause=ConvertTo-IcmAbsenceDate(Get-LifecycleValueSafe $Item 'absencePauseStartedAt' $null);$Total=[double](Get-LifecycleValueSafe $Item 'absencePausedSeconds' 0);$Base=ConvertTo-IcmAbsenceDate(Get-LifecycleValueSafe $Item 'absenceBaseDeadlineAt' $null);if(!$Base){$Base=ConvertTo-IcmAbsenceDate(Get-LifecycleValueSafe $Item 'deadlineAt' $null);if($Base){Set-IcmAbsenceProperty $Item 'absenceBaseDeadlineAt' $Base.ToString('o')}};if($Active){if(!$Pause){$Pause=$Now;Set-IcmAbsenceProperty $Item 'absencePauseStartedAt' $Pause.ToString('o')};Set-IcmAbsenceProperty $Item 'absenceActive' $true;Set-IcmAbsenceProperty $Item 'absenceStatus' 'Ausência/Férias';Set-IcmAbsenceProperty $Item 'absenceEndAt'(Get-LifecycleValueSafe $Device 'absenceEndAt' $null);if((Get-LifecycleValueSafe $Item 'status' '')-ne'PausedAbsenceVacation'){Set-IcmAbsenceProperty $Item 'statusBeforeAbsence'(Get-LifecycleValueSafe $Item 'status' 'Waiting')};Set-IcmAbsenceProperty $Item 'status' 'PausedAbsenceVacation';if($Base){$Adjusted=$Base.AddSeconds($Total+($Now-$Pause).TotalSeconds).ToString('o');Set-IcmAbsenceProperty $Item 'deadlineAt' $Adjusted;Set-IcmAbsenceProperty $Item 'preventiveDeadlineAt' $Adjusted};$Changed=$true}elseif($Pause){$Total+=[math]::Max(0,($Now-$Pause).TotalSeconds);Set-IcmAbsenceProperty $Item 'absencePausedSeconds' $Total;Set-IcmAbsenceProperty $Item 'absencePauseStartedAt' $null;Set-IcmAbsenceProperty $Item 'absenceActive' $false;Set-IcmAbsenceProperty $Item 'absenceReturnedAt' $Now.ToString('o');if($Base){$Adjusted=$Base.AddSeconds($Total).ToString('o');Set-IcmAbsenceProperty $Item 'deadlineAt' $Adjusted;Set-IcmAbsenceProperty $Item 'preventiveDeadlineAt' $Adjusted};Set-IcmAbsenceProperty $Item 'status'(Get-LifecycleValueSafe $Item 'statusBeforeAbsence' 'Waiting');$Changed=$true}elseif($Total-gt 0-and$Base){$Adjusted=$Base.AddSeconds($Total).ToString('o');Set-IcmAbsenceProperty $Item 'deadlineAt' $Adjusted;Set-IcmAbsenceProperty $Item 'preventiveDeadlineAt' $Adjusted;$Changed=$true}}}
 if($Changed){Write-IcmJsonAtomic -Path $Path -Data $Doc -Depth 60}
}
