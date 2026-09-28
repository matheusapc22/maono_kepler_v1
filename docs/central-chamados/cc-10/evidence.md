# Evidências CC10 — 28/09/2026

Base de produto: `9dbe5e1d14e382f198a358a5381ad9aad78d64db`. Branch `feat/cc-10-central`.

| Verificação | Resultado local |
|---|---|
| `node --test tests/ticket-sla*.test.mjs` | 20/20 aprovados: CT33–36, horário de verão NY/Lord Howe, pausa, prefixo descoberto, resposta anterior à atribuição, CAS, idempotência, atomicidade, ACL, HTTP, flags e schema |
| `node --experimental-strip-types --test tests/ticket-sla*.test.mjs tests/ticket-flow*.test.mjs tests/ticket-command*.test.mjs tests/ticket-conversation*.test.mjs tests/production-migration*.test.mjs` | 255/255 aprovados, incluindo os20 SLA |
| `node --test tests/ticket-sla.test.mjs` após agrupar a consulta de membros | 7/7 aprovados; teste usa conversa real CC05 e corrida com fechamento |
| `node node_modules/@playwright/test/cli.js test tests/browser/ticket-sla.spec.ts --project=chromium` | 4/4 aprovados, HTTP interceptado em fixture local; não é acceptance autenticado remoto |
| `npm run build` | TypeScript e Vite aprovados; avisos das dependências/chunks grandes existentes, sem erro de build |
| Ratchet de erros com `--strict-baseline` | Aprovado; três referências internas requestId revisadas no baseline, sem renderização de diagnóstico |
| SQLite novo e upgrade | quick_check=ok, FK=0, schema CC10 equivalente, sem políticas seed |
| `git diff --check` | Aprovado |

Migration0033 SHA-256: `c80427c6b092e30885cb2358b76c7e1db5d025edf168a3218086ab50681d7060`.

Nenhuma migration remota, flag, política operacional ou dado de cliente foi alterado. PR201 permanece aberta e não mergeada na consulta desta execução. A suíte protegida CC10 depende da publicação e integração do operador; o roteiro está em `acceptance.md`.

CT33–36 continuam **pendentes na camada de aceitação**. CC09 mantém CT30–32, sessão/upload remoto, p95 D1, cleanup/restauração e rollout pendentes. Não há evidência de performance D1, aprovação operacional, review humano ou rollout nesta entrega.
