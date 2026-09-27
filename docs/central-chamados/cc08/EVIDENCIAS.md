# CC-08 — Evidências e acompanhamento

Data: 27/09/2026. Branch: feat/cc-08-central.
Base produto: ace9e647d7e1042327c234a891b2d182c33149cc.
Estado: entrega candidata, flags OFF, sem aceite de produção.

## Verificações locais

| Verificação | Resultado | Limite da evidência |
|---|---|---|
| Contratos/SQLite/HTTP/CR/Apply/migrations | 371 testes aprovados | Inclui 27 testes novos CC08; não usa D1 remoto |
| Segurança de Preview | 23 testes aprovados e gate OK | Política local; não comprova deployment |
| Chromium | 3 testes aprovados | Interface com respostas HTTP controladas; não é acceptance autenticado |
| TypeScript e build | Aprovados | Build apresenta aviso de bundles grandes |
| Ratchet estrito | Aprovado | Baseline high-signal preservado |
| ESLint direcionado | Zero erros, 1 aviso | Dependência de useEffect preexistente em ChangeRequestReviewPage |

Total: 397 testes distintos aprovados; reruns não são contados novamente.

Comando principal:

```sh
node --experimental-strip-types --test tests/ticket-changes.test.mjs tests/project-change-request*.test.mjs tests/ticket-command*.test.mjs tests/ticket-access*.test.mjs tests/ticket-conversation*.test.mjs tests/ticket-attachment*.test.mjs tests/ticket-notifications.test.mjs tests/project-large-save.test.mjs tests/production-migration*.test.mjs
npm run test:preview-safety
npx playwright test tests/browser/ticket-changes.spec.ts --project=chromium
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -b
npm run build
```

O ensaio de 90 MiB usa o pipeline real de gravação de revisões com SQLite e Dropbox simulado; verifica blocos de até 4 MiB, checksum, lineage e revisão publicada. Não mede memória, CPU, latência ou quotas reais de Cloudflare/Dropbox. O teste de recuperação verifica a revisão original após avanço posterior do head. ACL, revogação, CAS/rollback, idempotência, histórico, feedback/reenvio, reconciliação e retry têm cobertura local.

## Migration candidata

Arquivo: 0031_ticket_change_reconciliation.sql.
SHA-256: f189d35d51b61a6bcde68de7d87cc1b8894b213ebf0cd35e47e0b92b893b73b8.
D1 de destino previsto: maono_maps / 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db.
Não auditada nem aplicada em produção. Não existe approval hash para esta entrega.

O run anterior 36345128266 pós-validou 0030, mas registrou 0020 pendente. É necessário comparar schema real e ledger antes de avançar. O preflight preparado bloqueia autorização se faltarem pré-requisitos ou houver expansão histórica incompatível; não substitui revisão humana das definições SQL. O operador permanece sujeito ao AGENTS.md: audit → relatório → autorização exata → apply isolado → pós-validação.

## Pendências e próximo passo

| Pendência | Responsável | Próximo passo |
|---|---|---|
| Revisão/CI/merge | Codex + revisor | Publicar e revisar a entrega candidata |
| Schema remoto e ledger 0020 | Operador protegido + Matheus | Audit read-only; resolver cada pré-requisito separadamente |
| Migration 0031 | Operador protegido + Matheus | Após merge, audit e autorização específica do hash |
| Worker scheduled | Operação | Provisionar com flags OFF, conferir binding/SHA/cron |
| Suíte CC08 no operador de acceptance | Codex + Matheus | Implementar/registrar suíte protegida e preparar QA sintético |
| Acceptance real e aceites herdados | Codex + Matheus | ACL, revogação, falhas/retry, 90 MiB, budgets, cleanup e restauração |
| Rollout permanente | Matheus + operação | Decisão posterior às evidências do canário |

Nenhuma migration, flag de produção, cron ou deployment foi alterado nesta execução. O pedido de execução não dispensa o gate humano específico da migration definido em AGENTS.md.
