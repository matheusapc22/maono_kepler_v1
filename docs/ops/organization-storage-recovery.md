# Organization Storage Recovery — Runbook PRH-06

## Objetivo

Executar recuperação automática de organizações com storage inconsistente sem acoplar o healing ao request do usuário. O Worker usa o mesmo `repairActiveOrganizationStorages()` da aplicação, portanto preserva claim/CAS, lease e correlação introduzidos nas PRH-04/05.

## Estado seguro inicial

O Worker deve ser implantado inicialmente com:

- `MAONO_STORAGE_RECOVERY_ENABLED=false`
- `MAONO_STORAGE_RECOVERY_DRY_RUN=true`
- `MAONO_STORAGE_RECOVERY_KILL_SWITCH=false`
- batch pequeno (10)
- backoff de erro de 900 s
- lease de 120 s

O cron pode existir com a feature desabilitada: nesse estado não há consulta de candidatos, claim, mutação nem chamada ao Dropbox.

## Sequência de ativação

1. Validar bindings D1 e secrets Dropbox.
2. Executar a suíte `test:organization-readiness`.
3. Implantar o Worker ainda desabilitado.
4. Habilitar apenas `MAONO_STORAGE_RECOVERY_ENABLED=true`, mantendo `DRY_RUN=true`.
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

## Rollback

1. Acionar o kill switch.
2. Não remover `storage_status/storage_checked_at`.
3. Não reverter migration 0009.
4. Investigar pelo `correlationId` da execução.
5. Reativar primeiro em dry-run.

## Limites de escopo

A PRH-06 não ativa o cron em Production automaticamente, não executa migration e não toca no rollout de Change Requests #147/#149/#150/#151 ou migrations 0021/0022/0023.
