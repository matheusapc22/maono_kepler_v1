# CC-03 — revisão independente do operador remoto

Revisão local concluída em 25/09/2026. Base: `cdc2277774ffe89a944761d5738b40b0d038cb73`, PR #196 aberta/draft no contexto desta entrega. O incremento do operador ainda estava sem commit ao capturar os hashes abaixo. **Nenhum bloqueador P0/P1 permanece aberto no desenho e na implementação revisados.** A aplicação de migration não é merge, ativação de flags ou aceite do atendimento.

## Contexto operacional recebido

O contexto recuperado registra a aplicação da `0026_ticket_command_lifecycle.sql` em produção, banco `maono_maps`, UUID `5bc4dc32-f3bd-4c92-bbd1-cbda63e467db`, às 17:10:33 UTC, linha 20 do ledger, `foreign_key_check` vazio e `quick_check` aprovado. Esta revisão não executou nem revalidou essas consultas remotamente. O registro complementa o snapshot anterior; não transforma a revisão local anterior em evidência remota.

A aprovação técnica do operador não substitui a aprovação humana da execução concreta no alvo/organização conferidos. Migration, backfill, merge, versão publicada, flags e aceite são gates separados. O operador não concede permissões nem muda esses estados.

## Fronteiras verificadas

| Fronteira | Evidência observada no código e nos testes locais |
|---|---|
| Alvo real | `d1 info` confere UUID e nome antes da criação do proxy. Config temporária exclusiva contém somente `DB`, `remote:true` e o alvo; não admite preview ID ou ambiente herdado. Conta explícita, quando informada, entra no mesmo config. Probe rejeita metadata ausente/simulada; não há fallback voluntário para SQLite local. |
| Inspeção | Modo padrão `inventory` envolve o DB em `readOnlyD1`; bloqueia métodos de escrita, DML inclusive após WITH, múltiplos statements e PRAGMAs mutáveis. Não chama o job de páginas. `complete` significa inventário terminado; `allOrganizationsReady`, pendências e `releaseAuthorized:false` evitam interpretá-lo como liberação. |
| Schema e ledger | Preflight compara objetos/definições normalizadas das 0025/0026, colunas prévias necessárias e unicidade da identidade legada. Exige os dois nomes no ledger e contrato compatível da origem. Não aplica SQL corretivo ou migration por inferência. |
| Aplicação | Uma organização ativa explícita, operador super admin ativo e fallback ativo membro da organização; UUID repetido e pausa dos writers atestada. Não aceita seleção global para apply. Usa o `DB.batch` original do job, preservando atomicidade por linha importada. |
| Recuperação | Antes de DML, consulta automaticamente o bookmark atual pelo mesmo Wrangler/config e salva o resultado. É um ponto de recuperação identificado, não restauração ensaiada ou garantia de ausência de gravações concorrentes. |
| Replay | No-op exige marker ready/schema 1/pending 0/skipped 0/completedAt e igualdade das contagens atuais com as registradas. Não atualiza marker nem cria eventos nesse caso. A inspeção final revalida o predicado antes de retornar aplicação completa. |
| Falha e relatório | Arquivo novo é reservado com criação exclusiva antes de autenticação; relatório é salvo antes de DML e após páginas. Falha interrompe páginas seguintes, preserva páginas confirmadas e informa incerteza de commit. Em erro, `migrated` é mínimo confirmado; não declara rollback de importações anteriores. Falha de arquivo não elimina a tentativa independente de emitir JSON em stdout. |
| Credenciais e saída | Autenticação fica no Wrangler. Config/report não recebem tokens; não são impressos stdout/stderr/SQL brutos de falhas. Wrapper fixa log/telemetria antes do proxy e restaura o ambiente depois. Relatórios contêm nomes/IDs operacionais necessários, contagens e procedência do run, sem textos dos chamados. |
| Encerramento | `dispose` do proxy, remoção de config temporária e fechamento do relatório estão no finally. Interrupção impede páginas seguintes; página/linha já confirmada continua durável. Ajuda e falha de argumentos/destino não inicializam conexão. |

A consulta de identidade e o probe real permanecem parte da execução autorizada na máquina do operador. Nos ensaios, control plane e proxy foram injetados; não se declara que o formato da resposta ou a autenticação daquele D1 já foram observados por esta revisão.

## Achados tratados durante a revisão

| ID | Achado | Resultado |
|---|---|---|
| OP-01 | O CLI local anterior podia perder páginas concluídas no relatório ao falhar a seguinte. | Operador remoto mantém páginas e total conhecido no catch; teste de falha posterior e persistência pós-página aprovado. |
| OP-02 | Destino de relatório inválido era descoberto pelo CLI local somente depois da importação, podendo também eliminar stdout. | Novo wrapper reserva/valida o arquivo antes de conexão; teste independente confirmou zero consultas de control plane quando o arquivo já existe. |
| OP-03 | Zero pendências isoladamente não prova marker consistente; fonte nova após o marker podia tornar a conclusão obsoleta. | Predicado único confere marker/contagens e inspeção final. Injeção de nova origem antes da última inspeção retornou exit 2, `complete:false` e pending 1. |
| OP-04 | Resposta perdida depois do COMMIT deixa importação durável sem incrementar o contador confirmado do processo. | Repro independente gravou uma linha, devolveu erro e preservou `migrated:0` como mínimo, com `commitOutcomeUnknown:true` e `requiresReconciliation:true`. Retry por identidade permanece seguro; nenhuma alegação de rollback global. |
| OP-05 | Identidade injetada divergente podia ser rotulada como verified antes da comparação; logs do proxy não tinham a mesma restrição do subprocesso. | Verified agora exige correspondência; identidade rejeitada tem teste próprio. Log/telemetria do processo pai são controlados antes do import e restaurados no finally. |
| OP-06 | Comparação de definições ALTER por substring precisava distinguir limites de coluna e valores que compartilham prefixos. | Comparação agora exige delimitadores antes/depois da definição. Teste em SQLite com a expansão realmente alterada para DEFAULT 10 confirmou recusa e snapshot sem DML; suíte independente passou novamente. |

As reproduções do CLI local estão em `qa/operator-edges-pqafIJ`; ensaios adicionais do novo operador, em `qa/operator-independent-repros.mjs`, no diretório de trabalho que contém o checkout. Esses pontos não foram corrigidos no CLI exclusivamente local por esta tarefa; a aplicação remota deve usar o novo wrapper revisado.

## Validação local

```sh
node --test tests/ticket-backfill-operator.test.mjs tests/ticket-legacy-backfill.test.mjs
```

Resultado independente: **39 testes aprovados, zero falhas, zero skips** — 27 do operador e 12 do job/CLI local existente. Cobertura inclui schema/ledger incompletos, identidade e binding incorretos, escopo/atores, zero DML no inventário, páginas/replay, falha parcial, resposta perdida, relatório e cleanup. `git diff --check` passou.

Além da suíte, os ensaios próprios confirmaram: inventário com delta zero em `total_changes()`; destino existente rejeitado antes de conexão; config remoto exclusivo e descarte do proxy/config; DEFAULT de versão divergente recusado; origem tardia impedindo conclusão; e classificação da resposta perdida após COMMIT. `--help` foi executado sem inicializar Wrangler remoto.

## Limites e decisão operacional

O [runbook remoto](remote-operator-runbook.md) preserva a pausa dos writers e o aceite separado da ativação. `--writers-paused` é atestado humano; o operador não aplica um bloqueio distribuído. A reconciliação verifica identidades/contagens e não detecta alteração semântica de uma origem já importada. Se a operação normal for retomada antes do cutover, é necessária nova reconciliação e análise de divergências; não sobrescrever Tickets canônicos por inferência.

O smoke nativo local de `getPlatformProxy`/`workerd` foi executado pelo agente principal entre 17:37:54 e 17:38:04 UTC, com Node v24.19.0 e Wrangler 4.140.0. Esta revisão leu o [script](../../../scripts/central-chamados/operator/smoke-local.mjs) e a [evidência JSON](evidence/operator-runtime.json): `ok:true`, `servedBy:miniflare.db`, `remoteBindings:false` e `remoteD1Access:false`. Cinco cenários verificaram inventário sem DML; paginação/retomada com efeitos obrigatórios; replay sem escrita e isolamento da segunda organização; rollback nativo por falha de outbox seguido de retomada; e prontidão global ainda bloqueada pela organização não conciliada. O script configura explicitamente D1 local e chama a biblioteca com identidade/bookmark fictícios; não exercita autenticação, control plane ou D1 remoto. Esse resultado substitui a ressalva anterior de runtime local pendente. A execução em CI conserva seu registro próprio quando disponível.

Somente a primeira aplicação autorizada por organização poderá produzir evidência D1 real. Os testes com SQLite/proxy injetado não equivalem a ensaio autenticado remoto. Não foram executados proxy remoto, backfill remoto, migration, alteração de flag, deploy ou merge nesta revisão. A aprovação humana final e os gates de produção permanecem preservados.

## Referências

- [Cloudflare — API do Wrangler/getPlatformProxy](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy): config explícita, persistência, bindings remotos e dispose.
- [Cloudflare — bindings por modo de desenvolvimento](https://developers.cloudflare.com/workers/local-development/bindings-per-env/): D1 suporta binding remoto com código local.
- [Cloudflare — D1Database](https://developers.cloudflare.com/d1/worker-api/d1-database/): `batch` é transacional; várias páginas não são uma única transação.
- [Cloudflare — Get D1 Database](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/): identidade do banco no control plane.

Foi lido também o código instalado do Wrangler `4.140.0`. A seleção D1 prioriza `preview_database_id` quando presente e admite simulação local sem conexão remota; o config exclusivo e a rejeição do probe simulado são, portanto, verificações necessárias. O pacote e seu lockfile permanecem isolados das dependências da aplicação.

## Conteúdo revisado

Hashes SHA-256 antes do commit; alterações posteriores exigem revisar o delta.

| Arquivo | SHA-256 |
|---|---|
| `scripts/central-chamados/operator/backfill-d1.mjs` | `51cff88a44d221eeaf9150978955bb07492e0ceeab913d72b1ef00804c257a9f` |
| `scripts/central-chamados/operator/lib.mjs` | `bca5f6d47681222a5e946010dd5bff6b4322a391463d246cdb6c7d935a2df79d` |
| `scripts/central-chamados/operator/package.json` | `c10cd5c2b2235159c83330196c6b51ebef991d5d120d34eab0a66b82183f883a` |
| `scripts/central-chamados/operator/package-lock.json` | `3e36011494988f2f72850e8e1eeeba48dabbd359e1bce79e48bf4ddaa1e2e35b` |
| `tests/ticket-backfill-operator.test.mjs` | `dffde007868a02d770186f276da8de3212e26081b12bc28f5dc6f8bce99f3c47` |
| `functions/_lib/ticket-legacy-backfill.js` | `b939d6e54c3b00984f15805557e94278a01fbab3dc4e77988b5e64970384e621` |
| `scripts/central-chamados/operator/smoke-local.mjs` | `ba24e226fea06c7f739e3a75d3f47dbe244b30b7cd58ea47afed5c80020534e9` |
| `docs/central-chamados/cc-03/evidence/operator-runtime.json` | `4525eb43280a66ff4c6b35703345ef119f35446678515e7743149379412be135` |
