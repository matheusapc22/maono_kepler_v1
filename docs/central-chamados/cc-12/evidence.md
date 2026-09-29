# Evidências da execução CC-12

29/09/2026, executor Codex. Base produto `0cb04ade080c097b1d5940baac501767619c51ba`. Evidência do código desta PR, com escopo parcial CC12-A/B. O SHA final revisado e o CI remoto devem ser registrados no controle externo após o push; este documento não se autodeclara review independente.

| Verificação | Resultado local |
|---|---|
| `node --test tests/ticket*.test.mjs tests/project-change-request*.test.mjs tests/production-migration*.test.mjs` | 604 testes, 604 aprovados, 0 falhas/skips |
| CC12, incluída no total acima | 24 testes: domínio, migração, preflight, API, ACL, geração, Worker, provider mock, limites e GC |
| `node node_modules/typescript/bin/tsc -b` | Aprovado |
| `npm run build` | Aprovado; avisos de bibliotecas Kepler/Loaders e chunks grandes permanecem |
| `playwright test tests/browser/ticket-exports.spec.ts --project=chromium` | 4/4 aprovados; fixture HTTP local, não produção |
| `node scripts/audit-user-error-sinks.mjs --baseline scripts/user-error-sink-baseline.json --strict-baseline` | Baseline idêntico; nenhuma exceção adicionada |
| `node scripts/central-chamados/validate-cc01.mjs` | Aprovado; contratos de fonte preservados |
| `npm run test:preview-safety` | 23/23 testes e gate aprovado |
| `git diff --check` | Aprovado |
| Schema SQLite novo e upgrade | quick_check=ok, foreign_key_check vazio, imutabilidade e cobertura de triggers comprovadas |

Casos novos concretos: 250 linhas autorizadas sem teto da página; filtros e percentis exatos; privados/cross-org excluídos; geração alterada entre páginas e antes de persistir; replay idempotente/conflito; revogação depois de pronto e entre partições; cancelamento durante upload; lease perdido; workers concorrentes; retry/backoff/exaustão; checksum; limite de corpo/linhas/bytes/fontes; expiração; órfão finalizado depois do cleanup; provider mock com resposta de finalize perdida e objeto conflitante; paginação de histórico em 5+2 sem duplicação.

O identificador de repetição da API se chama `idempotencyKey`, distinto de um ID de diagnóstico. Erros operacionais não são exibidos crus na interface. Testes do provedor interceptam fetch e usam somente credenciais fictícias.

## Limites da evidência

Ambiente local Node24.19.0, SQLite de `node:sqlite`; workflow novo usa Node22. Repositório sem package-lock; `npm ci` indisponível. `yarn install --frozen-lockfile` recusou o lock existente por divergência. Para validar UI/build foi executado `npm install --ignore-scripts --legacy-peer-deps --package-lock=false --no-audit --no-fund`; nenhum manifesto ou lock foi alterado. Consequentemente o build local não comprova reprodutibilidade de dependências travadas. Jobs de contrato Node não dependem dessa instalação.

Não executados nesta entrega: aplicação D1 remota, acesso real Dropbox, provisionamento Worker, medição de carga Cloudflare, audit produção, deploy/SHA servido, suite autenticada, importação/reabertura em planilhas, canário e rollout. PR201 continua aberta com conflitos e registry apenas CC04; CC13 ainda bloqueia causas/incidentes. Ver `acceptance.md` e `migration-runbook.md` para passos concretos.

A migration0035 foi preparada e testada, não aplicada remotamente. Arquivo SHA-256 `43029aa0e4126521aa584becb88c12eec5c70c083dd7c2bde9085951ad8e4229`. Nenhum merge/schema/deploy/flag anterior foi alterado por estes testes.
