# CC-03 — revisão independente de reconcile-empty

Revisão concluída em 25/09/2026, sobre o incremento local à base `4a27cff1539738784ca121e1690f266b2f252320`. O commit do incremento ainda estava pendente ao capturar os hashes. **Nenhum bloqueador P0/P1 foi encontrado no desenho e na implementação revisados.** As revisões anteriores permanecem como registros históricos.

## Contexto e escopo

O inventário remoto informado pelo usuário registrou fonte elegível zero e marker ausente para as organizações 3, 4, 6, 7, 8 e 9; a organização 3 já tinha dois chamados canônicos. Os inventários seguintes não apresentaram membros elegíveis para fallback nas organizações 4 e 8. Esses resultados são evidências recebidas do operador, não consultas D1 feitas por esta revisão.

O modo explícito `reconcile-empty` registra prontidão de uma fonte elegível vazia. Exige organização ativa e super admin ativo, confirmação de identidade, schema/ledger válidos, bookmark atual e pausa atestada dos writers. Não necessita nem aceita fallback porque não cria chamados ou atribui autoria. A operação `apply` mantém integralmente sua exigência de fallback ativo e membro da organização; não houve criação de grants, membros, migration, flag ou rota pública para contornar essa exigência.

## Implementação e concorrência

| Situação | Comportamento verificado |
|---|---|
| Fonte presente, zero elegíveis | Um INSERT/UPSERT condicional grava somente `ticket_command_backfills`. A contagem é reavaliada no mesmo statement, no escopo da organização. Não usa o importador de páginas nem grava um marker running antecipadamente. |
| Fonte não vazia, pendências zero | Recusa: `sourceCount=0` é obrigatório. Ter todas as identidades já importadas não transforma a fonte em vazia. Nenhum marcador ou chamado muda por essa tentativa. |
| Fonte ausente | Usa contagens zero e exige no próprio SQL que `tickets` continue ausente em `sqlite_master`. Se a tabela surgir antes da gravação, mesmo vazia, não escreve o marcador e exige nova conferência. |
| Linha elegível chega antes do SQL | O predicado do INSERT falha. A releitura distingue a guarda recusada de um replay; não retorna sucesso a partir de `changes=0` isoladamente. |
| Mudança concorrente durante/após a decisão | Escritores externos são serializados pela fronteira do statement. Se uma origem aparecer após a gravação ou antes da inspeção final, a conclusão falha. Se o marcador já foi gravado, o relatório informa o efeito durável; não afirma rollback. |
| Revogação operacional | Organização ativa e super admin ativo são verificados antes, no SQL e novamente depois. Revogação entre preflight e statement impede a escrita. |
| Marker ready coerente zero | O WHERE do ON CONFLICT evita atualização. Replay preserva timestamps e `last_run_id`, inclusive quando outro reconciliador acabou de gravar o marker. |
| Marker inconsistente | Pode reparar somente o marker se a fonte elegível continuar vazia e os gates forem satisfeitos. Não reescreve chamados canônicos para ajustar as contagens. |
| Fonte de outra organização ou inativa | Mantém o escopo: elegíveis são os registros da organização com active 1/null, ou todos quando essa coluna não existe. Linhas inativas ficam na contagem de excluídos e não são importadas. |
| Resposta perdida | Não repete a gravação automaticamente. Relatório preserva a nova inspeção e informa resultado incerto; `writesPerformed:false` junto de `outcomeUnknown/commitOutcomeUnknown:true` significa ausência de confirmação, não prova de zero efeitos. |

A integração do operador revalida `sourceCount=0` e marker coerente na inspeção final, mantém `releaseAuthorized:false` e preserva os relatórios antes/depois da tentativa. Os erros novos têm mensagens fixas; o ajuste final para `TICKET_BACKFILL_EMPTY_RESULT_UNCONFIRMED` foi lido e não expõe SQL ou conteúdo bruto.

## Preservação de dados e permissões

Foram comparados snapshots de todas as tabelas da fixture, incluindo dois chamados canônicos existentes e uma organização sem memberships. Na primeira reconciliação, apenas o marker mudou. Não houve novo Ticket, comando, evento, auditoria de Ticket, outbox, ciclo, autor ou vínculo de usuário. O replay não mudou o snapshot completo. O apply ordinário continuou sendo recusado quando o fallback não era membro, mesmo com fonte vazia.

A ausência de fonte é uma constatação no momento verificado, não um bloqueio permanente de escritores. O modo não cria uma garantia futura de vazio. A pausa continua sendo atestado humano; se a fonte mudar, o operador exige novo inventário e uma decisão explícita. Não troca automaticamente para apply nem importa dados novos por consequência.

## Validação local

Execuções independentes desta revisão:

```sh
node --test tests/ticket-legacy-backfill.test.mjs tests/ticket-backfill-operator.test.mjs
node --test tests/ticket-backfill-empty-operator.test.mjs
```

**76 testes aprovados, zero falhas e zero skips:** 31 do módulo de backfill/reconciliação, 34 do operador existente e 11 da integração do novo modo. A alteração posterior foi somente a mensagem fixa sanitizada citada acima, revisada por leitura. `git diff --check` passou.

Uma segunda revisão local executou ainda três repros: duas chamadas concorrentes produziram uma escrita e um no-op, preservando as tabelas fora do marker e os dois canônicos; tabela ausente surgindo após o commit produziu erro com efeito durável informado; e origem inserida por trigger durante o statement também impediu conclusão. Não foram identificadas falhas materiais nessas bordas.

O agente principal executou o [smoke nativo local](../../../scripts/central-chamados/operator/smoke-local.mjs), cuja [evidência JSON](evidence/reconcile-empty-runtime.json) foi lida nesta revisão: oito cenários aprovados entre 18:31:15 e 18:31:38 UTC, Node v24.19.0, Wrangler 4.140.0, `ok:true` e `servedBy:miniflare.db`. Os dois cenários novos exercitaram a organização sem membros com dois canônicos/replay e a chegada de origem entre preflight e o SQL. O script preserva `remoteBindings:false` e `remoteD1Access:false`; a evidência comprova runtime local, não D1 remoto.

## Limites de entrega

Nenhuma operação remota, migration, alteração de permissões/flags, deploy ou merge foi executada por esta revisão. Os resultados remotos recebidos justificam preparar o modo específico, mas não provam que ele já foi executado nessas organizações. Cada execução real permanece explícita e exige seus relatórios, replay e inventário final antes dos gates separados de ativação e aceite.

## Conteúdo revisado

Hashes SHA-256 antes do commit; alterações posteriores exigem revisar o delta.

| Arquivo | SHA-256 |
|---|---|
| `functions/_lib/ticket-legacy-backfill.js` | `deb6202cf297754d737ec1f5b19d7b79e6787a313def256b37678c539701b0cb` |
| `scripts/central-chamados/operator/lib.mjs` | `45ac028e313054b90f7ef38067ff8e615670f6a41154d1da96e1fe032722c61a` |
| `scripts/central-chamados/operator/backfill-d1.mjs` | `19cec57c538cd450195b280e221cc4153c5e3309d0fd6e9aa4cfae92d049280a` |
| `scripts/central-chamados/operator/smoke-local.mjs` | `9a6449bf3b931d2fefa57e41ee31c842f48610e7ead2bf062fcaadf41f21512e` |
| `tests/ticket-legacy-backfill.test.mjs` | `1b7c4f3716917271356d722c731fccc968d960656772764d12c3654577beb607` |
| `tests/ticket-backfill-empty-operator.test.mjs` | `92afe89518ec7b720bbf55efc3b29de25c690d5569c0485ad1816c925928a29e` |
| `docs/central-chamados/cc-03/evidence/reconcile-empty-runtime.json` | `061eea5ac0418a14719b84956541fc5f78339f3eea6f660e799538de560ff0dd` |
