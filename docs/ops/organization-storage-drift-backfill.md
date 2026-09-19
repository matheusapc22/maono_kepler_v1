# PRH-07 — Recovery Activation + Physical Drift Backfill

## Pré-requisito obrigatório: migration 0009

A PRH-07 depende de `migrations/0009_organization_storage_invariant.sql`.
Ela fornece, entre outros campos:

- `dropbox_root_path`;
- `storage_status`;
- `storage_error`;
- `storage_checked_at`.

**Não executar recovery dry-run/apply em Production enquanto a aplicação da 0009 no D1 alvo não estiver confirmada.**

O workflow `Organization storage recovery operator` exige a confirmação literal:

`MIGRATION_0009_APPLIED_TO_TARGET_D1`

antes dos modos `deploy_dry_run` e `deploy_apply`.

## Objetivo operacional

A PRH-06 separou readiness de recovery e criou o Worker scheduled.
A PRH-07 adiciona:

1. deployment controlado do Worker;
2. inventário físico D1 × Dropbox;
3. classificação report-only do drift;
4. backfill seletivo e idempotente;
5. proibição de adoção/exclusão automática de órfãos.

## Sequência do recovery Worker

### 1. validate

Executar o operador em modo `validate`.

Confirmação:

`VALIDATE_STORAGE_RECOVERY_OPERATOR`

Nenhum deploy é feito.

### 2. deploy_disabled

Confirmação:

`DEPLOY_STORAGE_RECOVERY_DISABLED`

O Worker é publicado com:

- recovery disabled;
- dry-run true;
- kill switch true.

Esse estágio não executa healing.

### 3. deploy_dry_run

Pré-requisito: migration 0009 confirmada no D1 alvo.

Confirmações:

- `DEPLOY_STORAGE_RECOVERY_DRY_RUN`
- `MIGRATION_0009_APPLIED_TO_TARGET_D1`

O Worker passa a executar o scheduler, mas o reconciliador permanece sem claim, alteração de organizações ou chamada de criação ao provider. Os eventos de auditoria são gravados no D1.

Observar:

- correlationId;
- checked;
- skipped;
- hasMore;
- audit start/complete;
- ausência de mutações inesperadas.

### 4. deploy_apply

Somente após dry-run observado e aprovado.

Confirmações:

- `DEPLOY_STORAGE_RECOVERY_APPLY`
- `MIGRATION_0009_APPLIED_TO_TARGET_D1`

O operador sempre publica uma versão disabled antes de mudar para apply. Os secrets Dropbox são configurados antes do deploy final mutável.

## Inventário físico

Endpoint Admin:

- `GET /api/admin/organizations/storage-drift`

O relatório:

- pagina toda a raiz `/projects` do Dropbox;
- cruza folders físicos com `organizations`;
- cruza `organization_files`;
- não cria, move ou exclui nada;
- inclui correlationId e resumo por código.

Classes principais:

- `READY_MISSING_PHYSICAL_FOLDER`;
- `MISSING_PHYSICAL_FOLDER`;
- `PHYSICAL_PRESENT_STORAGE_NOT_READY`;
- `READY_WITH_STORAGE_ERROR`;
- `STORAGE_STATE_INVALID`;
- `ORGANIZATION_PATH_INVALID`;
- `ORGANIZATION_PATH_LEGACY`;
- `INACTIVE_WITH_PHYSICAL_FOLDER`;
- `ORPHAN_PHYSICAL_FOLDER`;
- `FILE_PATH_OUTSIDE_ORGANIZATION`;
- `ACTIVE_FILE_ON_INACTIVE_ORGANIZATION`;
- `UNEXPECTED_PROJECTS_ROOT_FILE`.

## Backfill seletivo

Endpoint Admin:

- `POST /api/admin/organizations/storage-drift`

Payload:

```json
{
  "approvedOrganizationIds": [12, 18],
  "confirmation": "APPLY_APPROVED_STORAGE_DRIFT"
}
```

Somente organizações explicitamente aprovadas e com drift marcado como `repairable` entram em apply.

O backfill reutiliza `ensureOrganizationStorage(..., { revalidateReady: true })`.

### PRH-08: rearmar incidente após investigação

Após corrigir a causa de um incidente bloqueado/esgotado, o operador pode acrescentar `"resetRetryBudget": true` ao mesmo payload com IDs explicitamente aprovados e confirmação `APPLY_APPROVED_STORAGE_DRIFT`. Sem esse campo booleano, o orçamento não é reiniciado. A operação registra a ligação entre incidente anterior e novo e conta como intervenção manual no SLO. Não libera paths protegidos nem substitui a revisão do inventário; não é utilizada pelo cron.

A verificação física também valida `documents`; conflitos com arquivos e inventário incompleto impedem falso sucesso/apply. Raízes fora do inventário `/projects` são desconhecidas, não presumidamente ausentes.

### Nunca automático

A PRH-07 **não**:

- adota pasta órfã como organização;
- exclui pasta órfã;
- renomeia path legado automaticamente;
- corrige metadata de arquivo fora da raiz;
- cria nova organização a partir de folder físico;
- executa migration.

Esses casos permanecem report-only até decisão humana explícita.

## Rollback

### Worker

1. executar o operador em `deploy_disabled`;
2. se necessário, ativar `MAONO_STORAGE_RECOVERY_KILL_SWITCH=true`;
3. preservar `storage_status/storage_checked_at`;
4. investigar pelo correlationId.

### Drift apply

O apply somente recria/valida storage usando as primitives existentes.
Não exclui folders e não move paths.
Falhas permanecem recuperáveis pelo estado `ERROR`.

## Critério de saída da PRH-07

- migration 0009 confirmada no ambiente alvo;
- Worker validado e implantado em disabled;
- dry-run scheduled observado;
- apply somente depois de aprovação;
- 100% das organizações/folders `/projects` classificados no inventário;
- repairable drift convergido em lote controlado;
- órfãos e paths legados permanecem sem mutação automática;
- correlação e auditoria preservadas;
- CI/build/Preview verdes.
