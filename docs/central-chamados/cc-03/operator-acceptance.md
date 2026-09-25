# CC-03 — aceite complementar do operador D1

Complemento da PR #196 sobre `cdc2277774ffe89a944761d5738b40b0d038cb73`, preparado em 25/09/2026. Corrige a lacuna operacional entre o job já entregue e sua execução autenticada no D1 real. Não altera migrations, rotas, flags ou o núcleo transacional do Ticket.

## Estado operacional

A migration 0026 em produção foi confirmada pelo usuário: D1 `maono_maps`, UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`, ledger ID 20 às `2026-09-25 17:10:33` UTC; `foreign_key_check` sem linhas e `quick_check = ok`. A confirmação não é merge: a PR permanece aberta/draft. Nenhum backfill remoto ou mudança de flags foi executado nesta preparação. Dev/Preview não herdam a confirmação de produção.

## Evidência do complemento

| Verificação | Resultado | Evidência |
|---|---|---|
| CLI, preflight, identidade, inventário, aplicação por organização, replay e falhas | 27/27 testes aprovados em Node 24.19.0 | `evidence/operator-tests.log` |
| Regressão de comandos, cliente, HTTP, concorrência, transações e job legado | 139/139 testes aprovados | `evidence/operator-core-regression.log` |
| Revisão independente | Sem P0/P1 aberto nos arquivos revisados; 39 testes executados pelo revisor não são somados novamente | `operator-review.md` |
| Binding nativo via Wrangler/Miniflare local | Aprovado: inventário sem alterações, paginação/retomada, replay, isolamento e rollback de batch na falha da outbox | `evidence/operator-runtime.json`, job `cc03-d1-binding-smoke` |
| Migration 0026 | Arquivo preservado, SHA-256 `803e2095a6f7bc53b41af0a1dfd64e01ad27844c883779fd5237d40acf7a9621` | Manifest complementar |

Total novo executado pelo autor: **166 testes aprovados**, além dos cinco cenários do smoke nativo. O histórico de 316 testes da entrega inicial permanece em `acceptance.md`; não é reapresentado como execução deste complemento. O runtime local respondeu com `served_by = miniflare.db`; não se tratou de um binding D1 remoto. Os checks do SHA publicado ainda devem ser conferidos no CI. O resultado final do CI e SHA são registrados no [controle](https://docs.google.com/spreadsheets/d/1iLrW6EPgJeifKXhaeE85SfKt_PBEGLeqnTGGAe0rFLY/edit).

## Fronteiras demonstradas

- Inventário padrão usa consultas protegidas contra DML, não cria markers e não expõe conteúdo dos Tickets. `complete` distingue consulta concluída de `allOrganizationsReady`; nenhum relatório autoriza release.
- A configuração temporária contém somente `DB`, nome/UUID explícitos e `remote:true`. O control plane confere a identidade; um probe rejeita binding local ou metadados insuficientes. Nenhuma configuração de Preview é herdada.
- `apply` exige uma organização ativa, operador super admin ativo, fallback ativo membro da organização, UUID repetido e declaração da pausa real dos escritores. O bookmark atual é consultado automaticamente antes da escrita.
- O job usa `DB.batch` nativo para Ticket, comando, evento, audit e outbox. Nenhuma emulação com SQL sequencial foi introduzida.
- Relatório novo é reservado antes da conexão. Falha em página posterior preserva as contagens confirmadas. Resposta perdida após commit é resultado desconhecido que exige reconciliação; não é descrita como rollback.
- Replay só é no-op se marker e contagens atuais concordarem. Uma origem nova na inspeção final impede sucesso. A reconciliação não sobrescreve conteúdo canônico existente.
- A saída e os relatórios omitem stdout/stderr internos, tokens e conteúdo de Tickets. Proxy e configuração temporária são descartados ao terminar.

## Reprodução local

```sh
npm ci --prefix scripts/central-chamados/operator --no-audit --no-fund
node --test tests/ticket-backfill-operator.test.mjs
node --experimental-strip-types --test tests/ticket-command*.test.mjs tests/ticket-legacy-backfill.test.mjs
node scripts/central-chamados/operator/smoke-local.mjs
node scripts/central-chamados/operator/backfill-d1.mjs --help
```

O smoke nativo usa somente dados fictícios, binding local e `remoteBindings:false`. Não depende de token Cloudflare nem consulta o banco de produção. Seu resultado não comprova autenticação, latência, identidade ou dados do D1 remoto.

## Próxima evidência exigida

Executar o inventário no computador autenticado do operador e seguir [remote-operator-runbook.md](remote-operator-runbook.md): escolher IDs reais, realizar pausa dos escritores, aplicar por organização, repetir sem novas escritas e conferir cobertura de todas as organizações. Manter flags desligadas até os gates de release, incluindo merge efetivo, versão publicada e QA autenticado. Não reaplicar a 0026 já confirmada nem envolver 0021/0022/0023.
