# Correção da saída JSON do operador CC-03

## Ocorrência recebida

Em 25/09/2026, o usuário executou o inventário no Windows sobre `61fe77eff20d6a1492bd053d478b2403a49c8963`, após instalação isolada bem-sucedida. Relatório `b775fce1-824a-4b6a-910e-d9f408c9199e`, entre `17:47:03.556Z` e `17:47:12.676Z`: `OPERATOR_WRANGLER_READ_FAILED`, `database.verified=false`, nenhuma organização ou página processada. O operador encerrou antes de criar o proxy ou iniciar o job. A tentativa não importou Tickets nem gravou marcadores.

Isso não invalida a migration 0026 já aplicada e validada pelo usuário em produção. Não há nova migration ou alteração de flags nesta correção. A PR #196 continua sem merge.

## Causa e mudança

O subprocesso usava `WRANGLER_LOG=none`. No Wrangler 4.140.0, tanto `d1 info --json` quanto `d1 time-travel info --json` publicam o resultado por `logger.log`; esse nível silencioso suprime o próprio payload JSON. Mesmo uma execução bem-sucedida termina sem stdout, e o parser antigo traduzia essa ausência em uma mensagem genérica sobre autenticação.

A revisão reproduziu o defeito com o CLI real e um D1 exclusivamente local: `none` retornou exit 0 e stdout vazio; `log` retornou exit 0 e JSON válido. Esse bug é suficiente para explicar o bloqueio observado, mas o log recebido não comprova por si só o estado da autenticação remota. A nova execução continuará conferindo conta/banco normalmente.

O subprocesso agora usa `WRANGLER_LOG=log`, mantendo stdout/stderr capturados e sem ecoar respostas internas. Desabilita arquivos de log do subprocesso e mantém o proxy principal silencioso. Não relaxa verificações de identidade, schema, autorização ou formato da resposta.

| Falha | Código novo |
|---|---|
| Instalação isolada não pode ser lida | `OPERATOR_WRANGLER_INSTALLATION` |
| Versão diferente da fixada | `OPERATOR_WRANGLER_VERSION` |
| Processo Wrangler retorna erro | `OPERATOR_WRANGLER_COMMAND_FAILED` |
| Processo conclui sem saída | `OPERATOR_WRANGLER_EMPTY_OUTPUT` |
| Resposta não é o objeto JSON contratado | `OPERATOR_WRANGLER_INVALID_JSON` |

Nenhum erro inclui stderr, stdout, tokens ou conteúdo de Tickets. Falha de parsing não é mais apresentada como prova de problema de login.

## Validação

- **34/34 testes do operador aprovados**, incluindo sete novos casos da fronteira com o subprocesso: saída JSON de identidade/bookmark, configuração de logs, caminhos com espaços, falhas redigidas, ausência de saída, formato inválido e instalação/versão.
- **Seis cenários do runtime local aprovados.** O smoke chama o Wrangler real pela mesma função de execução usada pelo operador, executando `SELECT 1` em D1 local. Confere o JSON antes de verificar que a resposta em array desse comando é corretamente recusada pelo parser de identidade/bookmark, que exige um objeto. Os outros cinco cenários continuam cobrindo inventário sem alteração, paginação/retomada, replay/isolamento, rollback da outbox e prontidão global.
- Evidências: `evidence/operator-json-fix-tests.log`, `evidence/operator-json-fix-runtime.json` e [revisão independente](operator-json-fix-review.md).

O smoke anterior validava o binding nativo, mas os testes do CLI substituíam a consulta Wrangler inteira. Essa lacuna permitiu que o filtro de logs passasse despercebido; o novo cenário cobre a fronteira real do processo. Nenhuma consulta ou escrita D1 remota foi feita por esta preparação.

## Retomada

Atualizar o worktree existente para o commit corretivo publicado na PR #196, preservando o relatório da tentativa. O pacote/lockfile não mudou; não é necessário reinstalar dependências por causa desta correção. Reexecutar somente o inventário, com um **novo nome de relatório**. Não apagar ou sobrescrever `cc03-inventario.json`.

Se a nova execução retornar `OPERATOR_WRANGLER_COMMAND_FAILED`, verificar a sessão e a conta corretas pelo `whoami` do Wrangler isolado; se necessário, fazer login. Não presumir que a correção do parser concede acesso ao banco. Não enviar credenciais no relatório.

O próximo gate continua sendo inventário remoto bem-sucedido, seguido de backfill/reconciliação/replay por organização. Manter `MAONO_TICKET_COMMANDS_ENABLED` desligada. [Roteiro operacional](remote-operator-runbook.md).
