# Intune - Conformidade Mobile

Módulo do Santander Support V2 para consulta de dispositivos móveis no
Microsoft Intune, diagnóstico de conformidade, controlo preventivo de falta de
comunicação, notificações e proteção de utilizadores VIP.

## Requisitos

- Windows PowerShell 5.1 ou superior
- Microsoft.Graph.Authentication
- Microsoft.Graph.Users (para pesquisa de utilizadores VIP)
- Microsoft.Graph.Users.Actions (apenas para envio pelo Graph)
- Outlook clássico numa sessão interativa (para transporte OutlookLocal)

Permissões Graph de consulta:

- DeviceManagementManagedDevices.Read.All
- DeviceManagementConfiguration.Read.All
- User.Read.All

O envio por Microsoft Graph também exige Mail.Send. Na configuração atual, o
transporte principal é OutlookLocal e o envio Graph real permanece bloqueado.

## Segurança operacional

- O módulo não remove automaticamente dispositivos do Intune.
- A remoção automática está desativada na configuração.
- Utilizadores VIP exigem aprovação manual para notificações e estados de remoção.
- Preparar uma mensagem no Outlook não a regista como enviada.
- O lifecycle só deve registar uma notificação após envio confirmado.

## Dados locais

- data/history.json: histórico resumido dos scans
- notification-lifecycle.json: lifecycle de notificações e resoluções
- preventive-config.json: prazos preventivos ativos
- vip-users.json: lista local de utilizadores VIP

Estes ficheiros contêm dados operacionais e pessoais e devem ter permissões NTFS
restritas, retenção definida e backups protegidos.

## Rotas principais

- status, connect e scan
- getPreventiveConfig e savePreventiveConfig
- getLifecycle, reconcileLifecycle e setLifecycleStatus
- reconcilePreventiveIntune e refreshPreventiveControl
- prepareOutlookNotification e sendOutlookNotification
- getVipUsers, lookupVipUser, saveVipUser, deleteVipUser e toggleVipUser

## Nota sobre o lifecycle

O nome interno Preventive30d é mantido por compatibilidade com dados anteriores.
Os prazos reais são lidos de preventive-config.json.
