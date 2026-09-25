# Document Purge — Runbook 08-S5

## Objetivo

Remover fisicamente do Dropbox apenas documentos em Lixeira quando houver uma
ordem explícita de exclusão permanente ou quando `purge_after <= now`.

A ordem obrigatória é:

1. reivindicar o item no D1 como `PURGE_PENDING`;
2. excluir o binário no Dropbox;
3. aceitar `path/not_found` como sucesso idempotente;
4. somente depois gravar `status=PURGED` e `purged_at` no D1;
5. manter o registro D1 como tombstone/auditoria.

## Migration

Nenhuma migration nova é criada na 08-S5.

Pré-requisito já satisfeito:
`0024_document_folders_trash.sql` aplicada e confirmada em Preview e Produção.

Não reaplicar 0024.

## Purge manual

A rota de purge permanente exige simultaneamente:

- `document.manage`;
- `document.delete`;
- confirmação literal `EXCLUIR PERMANENTEMENTE`;
- escopo da mesma organização;
- regra GeoJSON reaplicada antes da mutação.

O purge manual pode antecipar o prazo de 10 dias porque é uma ação forte e
explícita. O botão existe somente na visão Lixeira.

## Concorrência e crash recovery

O item é marcado `PURGE_PENDING` antes do provider. Restore aceita apenas
`TRASHED`, portanto não concorre com um purge em andamento.

Se a exclusão remota falhar, o item volta para `TRASHED` e recebe apenas um
código de erro sanitizado.

Se o provider confirmar a exclusão e a finalização D1 falhar/interromper, o
item permanece `PURGE_PENDING`. Após o TTL de claim (padrão 15 minutos), uma
nova execução pode retomar o item. O Dropbox retorna not_found, tratado como
sucesso idempotente, e o tombstone é finalizado.

## Worker automático

Arquivo: `workers/organization-file-purge.js`.

Estado inicial obrigatório:

- `MAONO_DOCUMENT_PURGE_ENABLED=false`
- `MAONO_DOCUMENT_PURGE_KILL_SWITCH=true`
- `MAONO_DOCUMENT_PURGE_DRY_RUN=true`
- batch 25
- claim TTL 900 s
- cron horário: `0 * * * *`

Com feature disabled ou kill switch ativo, o Worker retorna antes de listar
candidatos ou tocar no Dropbox.

Dry-run lista apenas vencidos e grava auditoria; não reivindica, não exclui
binário e não altera `organization_files`.

## Sequência de ativação

A ativação NÃO faz parte automaticamente da PR 08-S5.

1. Confirmar o SHA mergeado da 08-S5.
2. Confirmar novamente o binding Production `maono_maps`.
3. Confirmar que 0024 continua aplicada; não executar migrations.
4. Capturar bookmark Time Travel.
5. Configurar secrets Dropbox.
6. Implantar baseline disabled.
7. Habilitar Worker mantendo kill switch true e dry-run true.
8. Retirar kill switch, ainda em dry-run.
9. Observar pelo menos uma execução e conferir candidatos/auditoria.
10. Somente com aprovação explícita alterar `DRY_RUN=false`.
11. Começar com batch <= 25.

## Kill switch

Definir `MAONO_DOCUMENT_PURGE_KILL_SWITCH=true`.

Isso interrompe novas execuções antes de buscar candidatos.

## Rollback operacional

1. Acionar kill switch.
2. Definir `ENABLED=false`.
3. Não reverter 0024.
4. Não limpar tombstones PURGED.
5. Investigar por correlationId nos audit logs.
6. Reativar primeiro em dry-run.

## Fora de escopo

A 08-S5 não reaplica migrations, não habilita automaticamente o cron em
Production e não toca nas migrations 0020/0021/0022/0023.
