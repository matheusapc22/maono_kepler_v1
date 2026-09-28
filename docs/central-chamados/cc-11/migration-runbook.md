# Migration CC-11 — 0034_ticket_metric_rollups.sql

Não reaplicar0033. A política AGENTS.md exige auditoria protegida e autorização humana do hash emitido; executar a CC11 não é autorização de D1.

1. Depois de review/merge, copiar o SHA completo da branch `mano_kepler_v1` contendo esta entrega. Manter métricas OFF.
2. Em Actions, `Production D1 migration operator`, `Run workflow` na branch `main`. Preencher `mode=audit`, `migration=0034_ticket_metric_rollups.sql` e deixar `approval_hash` vazio. O operador fixa automaticamente o HEAD de `mano_kepler_v1`; não há input manual de SHA. Conferir o `Pinned product SHA` do summary contra o merge aprovado. Não preencher token Cloudflare no chat.
3. Aprovar o ambiente protegido `production-d1-migrations` se solicitado. Conferir artefato: `writesPerformed=false`, schema compatível; ledger0010/25/26/27/28/33; migration pendente; SHA Git/SQL; pending digest/earlier pending; quick_check ok/FK0; bookmark Time Travel e approval hash. Qualquer drift/schema parcial bloqueia.
4. Após ler o audit, autorizar nominalmente 0034 e o hash atual no D1 `maono_maps` (`5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`). Não reutilizar hash da 0033. Não aplicar outras pendentes.
5. Nova execução na main com `mode=apply`, o mesmo `migration` e o `approval_hash` auditado. O operador fixa novamente o produto: exigir que o SHA ainda corresponda ao audit, sem novos merges entre audit e apply. Executor revalida e aplica somente o SQL isolado. Se falhar após início possível, verificar somente leitura antes de tentar novamente.
6. Exigir `APPLIED AND POST-VALIDATED`, ledger0034, quick_check ok/FK0, arquivo/hash/GitSHA/appliedAt e bookmark. Guardar o artefato na pasta CC11 e atualizar controle.
7. Acceptance autenticado e rollout continuam gates separados. h não tem default: publicação exige aprovação operacional. Só ativar flags na allowlist QA autorizada.

Rollback funcional: desligar métricas e preservar schema aditivo/checkpoints. Não apagar fatos/definições nem executar down destrutivo. Restauração de D1 somente com operador humano autorizado e bookmark; este runbook não autoriza restaurar dados.
