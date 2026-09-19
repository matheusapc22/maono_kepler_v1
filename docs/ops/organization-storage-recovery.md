# Organization Storage Recovery — Runbook PRH-06

## Objetivo

Executar recuperação automática de organizações com storage inconsistente sem acoplar o healing ao request do usuário. O Worker usa o mesmo `repairActiveOrganizationStorages()` da aplicação, portanto preserva claim/CAS, lease e correlação introduzidos nas PRH-04/05.

## Estado seguro inicial

O Worker deve ser implantado inicialmente com:

- `MAONO_STORAGE_RECOVERY_ENABLED=false`
- `MAONO_STORAGE_RECOVERY_DRY_RUN=true`
- `MAONO_STORAGE_RECOVERY_KILL_SWITCH=true`
- batch pequeno (10)
- backoff de erro de 900 s
- lease de 120 s

O cron pode existir com a feature desabilitada: nesse estado não há consulta de candidatos, claim, mutação nem chamada ao Dropbox.

## Sequência de ativação

1. Validar bindings D1 e secrets Dropbox.
2. Executar a suíte `test:organization-readiness`.
3. Implantar o Worker ainda desabilitado.
4. Pelo operador, habilitar `MAONO_STORAGE_RECOVERY_ENABLED=true` e retirar o kill switch, mantendo `DRY_RUN=true`.
5. Observar uma ou mais execuções e conferir `checked/skipped/hasMore` e o mesmo `correlationId` nos audit logs.
6. Confirmar que os candidatos reportados são esperados.
7. Somente então definir `MAONO_STORAGE_RECOVERY_DRY_RUN=false`.
8. Manter batch pequeno até o backfill PRH-07.

## Kill switch

Definir `MAONO_STORAGE_RECOVERY_KILL_SWITCH=true`. O handler retorna antes do acesso ao reconciler e não executa healing.

## Backoff e fairness

- `ERROR` recente fica fora da fila pelo período `MAONO_STORAGE_RECOVERY_ERROR_BACKOFF_SECONDS`.
- `PENDING` recente permanece protegido pelo lease/CAS.
- `PENDING` expirado volta a ser candidato.
- O modo automático usa ordem pelo `storage_checked_at` mais antigo, e falhas atualizam o timestamp; assim um item que falha repetidamente vai para o fim temporal da fila em vez de monopolizar o batch.
- O endpoint manual continua suportando `afterId/cursor`; o Worker não depende de cursor persistente.

### Endurecimento PRH-08

O modo periódico e o backfill seletivo compartilham a proteção de paths. Raízes inválidas/legadas exigem decisão e nunca são normalizadas para outro caminho automaticamente. Itens elegíveis têm prioridade sobre bloqueados para evitar starvation.

O campo existente `storage_error` pode conter um envelope JSON v1 sanitizado: código, incidente, tentativas e datas. Não contém mensagens do provider, tokens ou paths. O envelope é persistido já no claim, portanto interrupções também consomem o limite de 5 tentativas por incidente. Falhas transitórias respeitam 15 minutos de espera; erros permanentes, envelopes inválidos e limite esgotado ficam bloqueados para investigação. APIs de organizações expõem apenas o código seguro, não o envelope. `READY` limpa o envelope, e observações correlacionadas preservam a evidência em `audit_logs`.

Antes de habilitar dry-run/apply, o operador verifica remotamente UUID/nome, histórico e schema 0009, e captura um bookmark do D1 Time Travel. A verificação não executa SQL de migration e não comprova a existência das pastas Dropbox. Dry-run não altera organizações nem cria pastas, mas **grava auditoria**.

Após esta versão, não fazer downgrade isolado do Worker para um código que ignore o orçamento persistido de tentativas. Em regressão, primeiro desabilitar o Worker/acionar kill switch; preservar os dados e investigar. Reverter código não reverte escritas de banco ou Dropbox.

O aceite completo e as instruções do SLO estão em [PRH-08](./product-reliability-prh08-acceptance.md).

## Rollback

1. Acionar o kill switch.
2. Não remover `storage_status/storage_checked_at`.
3. Não reverter migration 0009.
4. Investigar pelo `correlationId` da execução.
5. Reativar primeiro em dry-run.

## Limites de escopo

A PRH-06 não ativa o cron em Production automaticamente, não executa migration e não toca no rollout de Change Requests #147/#149/#150/#151 ou migrations 0021/0022/0023.


## Extensão PRH-07 — ativação e physical drift

A PRH-07 adiciona o operador `Organization storage recovery operator` e o inventário D1 × Dropbox.

### Migration obrigatória

Os modos `deploy_dry_run` e `deploy_apply` dependem de `migrations/0009_organization_storage_invariant.sql` aplicada no D1 alvo. O operador exige a confirmação literal:

`MIGRATION_0009_APPLIED_TO_TARGET_D1`

Build verde, Preview verde ou merge não substituem essa confirmação/evidência.

### Operador

Modos:

- `validate`: apenas valida código/testes;
- `deploy_disabled`: publica baseline disabled;
- `deploy_dry_run`: exige migration 0009 confirmada;
- `deploy_apply`: exige migration 0009 confirmada e secrets Dropbox.

O workflow sempre publica uma configuração disabled antes de um modo mutável.

### Inventário e backfill

Consulte `docs/ops/organization-storage-drift-backfill.md`.

O inventário é report-only por padrão. Orphans e paths legados nunca são adotados, renomeados ou excluídos automaticamente.
