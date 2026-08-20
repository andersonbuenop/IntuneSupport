# Relatório CIB

Módulo do SantanderSupportWebV2 para consultar utilizadores no Microsoft Entra ID e os equipamentos móveis associados no Microsoft Intune.

## Ficheiros

- `module.json`
- `page.html`
- `style.css`
- `script.js`
- `api.ps1`
- `config.json`

## Funções

- Consulta individual ou em lote por UPN, e-mail, employee ID ou login.
- Dados do utilizador no Entra ID e dados completos dos dispositivos geridos no Intune.
- Indicadores, filtros e detalhe por equipamento.
- Exportação CSV.
- Preparação do e-mail no Outlook local, com CSV e HTML opcionais.

## Permissões Graph

- `User.Read.All`
- `Directory.Read.All`
- `DeviceManagementManagedDevices.Read.All`

A implementação é somente de leitura. O e-mail é aberto no Outlook para revisão antes do envio.


## Atualização 1.1.0
- Lista de utilizadores persistente no servidor e no navegador.
- Gravação automática e botão Guardar lista.
- Filtros de Sistema, Conformidade e Propriedade com seleção múltipla.
- O botão Limpar remove apenas os resultados e mantém a lista guardada.


## Correção 1.1.1
- Corrigida a sintaxe PowerShell da persistência da lista para compatibilidade com Windows PowerShell 5.1.
- Simplificado o cálculo do resumo para evitar ambiguidades do parser.


## Atualização 1.2.0
- Os campos Para e CC ficam guardados automaticamente no servidor e no navegador.
- Vários destinatários podem ser separados por ponto e vírgula.
- O corpo do e-mail foi redesenhado para leitura profissional no Outlook.
- O resumo do e-mail passa a refletir apenas os registos efetivamente enviados.
- A tabela do e-mail apresenta dados essenciais; os campos técnicos completos permanecem nos anexos.
