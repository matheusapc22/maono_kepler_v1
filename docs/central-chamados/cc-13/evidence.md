# Evidências locais CC-13

Execução em 29/09/2026, Node 24.19.0, dados sintéticos em SQLite/D1 local e respostas HTTP simuladas no Chromium. Nenhum teste abaixo acessa D1 produção, credenciais reais ou dados reais de usuários.

| Verificação | Resultado |
|---|---|
| `node --experimental-strip-types --test tests/ticket-*.test.mjs tests/production-migration-gate.test.mjs tests/production-migration-actions-workflow.test.mjs` | 562/562 aprovados; inclui 18 cenários CC13 e regressão das dependências |
| `node --test tests/ticket-cases.test.mjs` | 18/18 aprovados, incluindo CT43/44, CT41/42 ampliados, CR privado, preflight0036 e igualdade fresh/upgrade |
| `node node_modules/@playwright/test/cli.js test tests/browser/ticket-cases.spec.ts tests/browser/ticket-exports.spec.ts --project=chromium` | 8/8 aprovados: 4 CC13 e 4 CC12; fixtures locais, não aceite autenticado |
| `node scripts/central-chamados/operator/smoke-cases-local.mjs` | Binding D1 nativo local: objetos de migration, replay, CAS, rollback de batch, triggers de geração, quick_check e FK |
| `npm run test:preview-safety` | 23/23 e gate estático aprovados |
| `node node_modules/typescript/bin/tsc -b` / `npm run build` | Aprovados; build conserva avisos existentes de bundles grandes e dependências externas |
| `node scripts/audit-user-error-sinks.mjs --baseline scripts/user-error-sink-baseline.json --strict-baseline` | Baseline estrito preservado |

Para binding nativo: primeiro `npm ci --prefix scripts/central-chamados/operator --no-audit --no-fund`; usa Wrangler fixado pelo lockfile, `remoteBindings:false`, banco temporário local, sem credenciais. O workflow Central executa esta verificação junto do smoke CC03 e possui job CC13 para domínio/exportações.

Correção encontrada pela validação: IDs de CR materializados usam prefixo `cr:`; o validador CC13 foi ajustado e a relação/revogação testadas com o contrato CC08 real. UI foi tipada e histórico renderiza campos nomeados em vez de JSON. Revisões SQL são imutáveis contra alteração e remoção.

CI e review do SHA publicado devem ser consultados na PR. Ainda não comprovados: deploy/SHA servido, uso real Dropbox/Workers, auditoria/aplicação remota0036, suíte protegida CC13/CC12-C, leitor de tela, volume/limites, importação CSV real, cleanup, canário e rollout. Esses itens permanecem no controle, com papéis propostos e sem responsáveis nominais inventados.
