# CC-03 — importação legada explícita e reconciliação

> **Atualização de 25/09/2026:** para operar o D1 real, use o [runbook do operador remoto](remote-operator-runbook.md). O CLI descrito neste documento permanece um ensaio em SQLite local. A 0026 de produção em `maono_maps` foi aplicada e validada pelo usuário; não precisa ser reaplicada. Merge, backfill e ativação continuam gates separados.

## Objetivo e limite de execução

`functions/_lib/ticket-legacy-backfill.js` substitui a necessidade de importar chamados durante uma leitura HTTP **após o cutover CC-03**. A biblioteca é um job de operador, sem endpoint público. O CLI `scripts/central-chamados/backfill-ticket-legacy.mjs` executa somente contra um arquivo SQLite local indicado explicitamente. Não descobre ambientes, não usa credenciais, não chama Wrangler e não aplica migrations.

Antes do cutover, a compatibilidade do fluxo antigo é preservada conforme o flag da CC-03. Depois do cutover, a leitura verifica schema e reconciliação sem DML. Um chamado legado novo sem correspondência canônica invalida o gate, mesmo que um marcador antigo esteja `ready`; execute novamente o job explícito.

A 0025 foi informada como aplicada e validada pelo usuário em 25/09/2026. A **0026 exige aplicação e validação próprias por ambiente**; a produção foi confirmada posteriormente conforme a atualização acima. As 0021/0022/0023 continuam fora desta operação. Os ensaios locais deste documento não comprovam aplicação remota.

## Contratos

| Item | Regra |
| --- | --- |
| Fonte | `tickets`, se existir, deve ter `id` e `organization_id`. Fonte incompatível gera erro explícito. |
| Universo | Organização indicada; `active = 1` ou `NULL` quando a coluna existir. Inativos são excluídos e contados separadamente. |
| Identidade | `organization_tickets(organization_id, legacy_ticket_id)` é única; conflito nessa identidade não atualiza nem duplica o chamado existente. Outros conflitos falham. |
| Página | Até 100 registros, ordenados por ID, selecionando somente identidades sem canônica. O padrão é 50. |
| Transação | Cada novo chamado, command, evento, auditoria e outbox são uma única transação D1 `batch`. Falha em qualquer parte desfaz essa linha. |
| Reexecução | Linhas anteriores já concluídas são duráveis; nova execução desde o cursor zero processa apenas pendentes. `migrated` usa `meta.changes` real do INSERT. |
| Chamados antigos já importados | São preservados. Não são recriados eventos ou ciclos históricos que o sistema não observou. |
| Natureza | `demand_nature = NULL`, `triage_source = legacy`; não inferir classificação a partir de categoria, texto ou status. |
| Ciclos | `version = 1`, `current_cycle_number = 0`, sem ciclo histórico artificial. A primeira mutação da CC-03 registra a linha de base observada. |
| Autoria | Autor original válido é preservado; ausência/ID inexistente usa substituto explícito. O evento registra o ID original e `creatorSubstituted`. O ator da importação é o operador. |
| Datas e responsáveis | Datas válidas e atribuição válida são preservadas. O evento identifica timestamp inferido e atribuição descartada; não inventa primeira resposta ou SLA histórico. |
| Falhas | Propagadas com relatório parcial. O marcador torna-se `failed`, nunca `ready`. Não há fallback silencioso de sucesso. |

O evento `ticket.legacy.imported` registra procedência, normalizações, operador e `runId`. Ele não representa uma resposta do atendimento. Audit/outbox são obrigatórios e ficam na mesma transação; consumidores da outbox pertencem às PRs seguintes.

## Preparação da cópia local

1. Identificar organização, ambiente e banco original e obter cópia autorizada. Proteger a cópia: ela contém dados de chamados.
2. Registrar a origem, data da cópia, schema e o ledger. Não confundir o snapshot `schema.sql` com prova de aplicação de migrations no ambiente.
3. Validar a presença de 0025 e 0026 na cópia; o CLI falha quando faltam as colunas/tabelas exigidas. Não executar migrations por lote geral.
4. Escolher `operator` e, se necessário, `fallback-user` existentes em `users`. O substituto é uma compatibilidade de chave estrangeira registrada na procedência, não uma afirmação de autoria original.

Exemplo de inventário sem escrita, usando Node compatível com `node:sqlite`:

```sh
node scripts/central-chamados/backfill-ticket-legacy.mjs \
  --sqlite /caminho/autorizado/copia.sqlite \
  --organization 1 \
  --database-identity copia-local-organizacao-1 \
  --report /caminho/autorizado/cc03-antes.json
```

Sem `--apply`, o SQLite abre o arquivo em modo somente leitura. O arquivo precisa existir, o caminho precisa ser absoluto e a identidade fornecida aparece no relatório. Essa identidade é declarada pelo operador; não substitui conferência de ambiente.

## Execução local paginada e retomada

```sh
node scripts/central-chamados/backfill-ticket-legacy.mjs \
  --sqlite /caminho/autorizado/copia.sqlite \
  --organization 1 \
  --database-identity copia-local-organizacao-1 \
  --operator 7 \
  --fallback-user 7 \
  --page-size 50 \
  --max-pages 10 \
  --apply \
  --report /caminho/autorizado/cc03-importacao.json
```

O limite de páginas encerra a execução normalmente mesmo se houver pendências. Verificar `complete` e contagens, não apenas o exit code. Em falha de uma linha, exit code 1 e `report` mostram o que foi concluído e o que falta. Resolver a causa e repetir o mesmo comando; a seleção recomeça no cursor zero e ignora as identidades já importadas.

A biblioteca também fornece `runTicketLegacyBackfillPage(env, options)`, para um operador D1 autenticado e controlado, e `inspectTicketLegacyBackfill(env, organizationId)`, somente leitura. A entrega inicial continha somente o CLI local. O complemento operacional agora está em [remote-operator-runbook.md](remote-operator-runbook.md). Um ensaio local aprovado não grava marcadores no D1 remoto nem autoriza o cutover remoto; cada ambiente exige identidade e evidências próprias. A função não é publicada como endpoint de produto.

## Reconciliação e liberação

O relatório distingue:

- `sourceCount`: linhas elegíveis na fonte da organização.
- `canonicalCount`: identidades elegíveis que possuem correspondência canônica.
- `canonicalTotal`: todos os chamados canônicos da organização, incluindo chamados novos.
- `pendingCount = sourceCount - canonicalCount`: identidades elegíveis ainda sem correspondência.
- `excludedSourceCount`: inativos fora do universo de importação.
- `skipped`: falhas da página; nunca interpretar como sucesso ou descartar o erro.

`ticket_command_backfills` guarda contagens, `last_legacy_id`, `last_run_id`, `schema_version = 1` e status. `ready` exige zero pendências, zero falhas/skips e `completed_at` preenchido. Contagens e decisão são calculadas juntas em SQL; o gate de leitura ainda confere o estado atual da fonte para detectar novas pendências após esse instante. Fonte inexistente também exige uma execução explícita que registre a reconciliação zero.

Antes de ativar `MAONO_TICKET_COMMANDS_ENABLED`, preservar evidências de: aplicação isolada da 0026 no ambiente correto; reconciliação de todas as organizações alcançadas; teste autenticado da jornada; leitura sem DML; replay do job sem novos chamados/eventos; escrituras legadas ainda existentes mapeadas. Permissões e gates de deploy permanecem os definidos na planilha.

## Interrupção e recuperação

Se houver divergência ou uma fonte nova aparecer, manter/desativar o flag CC-03 e registrar a causa. O job não remove fonte, não altera chamados canônicos já existentes e não apaga eventos; não usar DELETE para simular rollback. Reexecutar é a recuperação normal de falha parcial. Restauração integral da cópia/banco requer plano separado e verificado, pois apagar canônicas pode perder atendimento realizado após a importação.

## Evidência automatizada

`tests/ticket-legacy-backfill.test.mjs` executa SQL real em SQLite: paginação, isolamento, replay, falha parcial em outbox, rollback obrigatório de auditoria, autoria/datas, corrida de inserção, fonte ausente/incompatível, schema incompleto, inventário sem DML e CLI somente local. Os resultados locais não substituem D1 remoto ou QA autenticado.
