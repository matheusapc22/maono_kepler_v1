# CC-03 — revisão independente

Revisão local concluída em 25/09/2026. Base: `ddaabcb1ea6038b62da9d90a7d1acd20634bd236`. Branch: `feat/cc-03-ticket-command-lifecycle`. O commit da implementação ainda estava pendente ao registrar os hashes abaixo.

**Nenhum bloqueador P0/P1 permanece aberto no escopo revisado.** Os achados abaixo foram reproduzidos durante o desenvolvimento, corrigidos e retestados. A conclusão cobre o código local e os contratos de operação; não constitui aceite de produção, autorização de migration ou validação autenticada.

## Achados e retestes

| ID | Severidade original | Falha reproduzida | Correção e evidência final |
|---|---|---|---|
| REV-01 | P1 | PATCH apenas com `nextAction`, usando token válido, retornava `400 EMPTY_PATCH`. | Caminho de validação aceita a próxima ação isolada. Regressão passou na suíte independente. |
| REV-02 | P1 | Com comandos habilitados e triagem desligada, Ticket não classificado podia passar de Novo para Aberto. | Readiness exige as duas flags. Transições não finais exigem responsável válido; Novo→Aberto exige triagem. Testes de flags/precondições passaram. |
| REV-03 | P1 | Desligar comandos permitia reabrir pelo PATCH legado sem criar ciclo; o próximo fechamento sobrescrevia a conclusão anterior. | Guard de aplicação bloqueia edição de Tickets com ciclos adotados quando a capacidade está indisponível; headers de comando nunca caem no fallback. Trigger SQL impede mudança legada de status sem incremento de versão. Reteste local retornou 503 sem mudar o snapshot; reabertura explícita posterior criou ciclo 2 e preservou a conclusão anterior. O runbook exige preservar o guard também no rollback de código. |
| REV-04 | P1 operacional | Triggers imutáveis bloqueiam o `SET NULL` de autoria durante hard delete de usuário; isso precisa de resposta acionável sem enfraquecer retenção. | Rota administrativa retorna `409 USER_TICKET_HISTORY_RETAINED` e orienta desativação. Seis testes independentes passaram, incluindo rollback integral, causas D1 encadeadas, autor de comando/evento/auditoria, exclusão ordinária e FK alheia não remapeada. Desativação mantém o histórico. |

As reproduções e retestes usaram SQLite real, chaves estrangeiras habilitadas, migrations locais literais e dados fictícios. Nenhuma execução remota foi feita.

## Garantias verificadas

- O recurso `/state` possui representação canônica própria e ETag forte. Detalhe composto, nomes, anexos, eventos avulsos e links CR não são indevidamente cobertos pelo token. Wildcard, lista, ETag fraco, token estrangeiro e versão antiga são recusados.
- Mutação valida If-Match e faz CAS no SQL. Ciclos, esperas, evento, auditoria, resultado persistido e outbox são condicionados ao `last_command_id` vencedor, no mesmo batch. Perdedores não publicam efeitos; testes injetam falha em cada statement das operações cobertas.
- Criação usa chave única por organização/ator/operação e fingerprint canônico. Replay devolve o resultado persistido da intenção original; payload divergente falha. Autorização ocorre antes do acesso ao replay. Não há novo Ticket por retry da mesma intenção.
- PATCH genérico não contorna a máquina de estados nem grava versão/ciclo/conclusão fornecidos pelo cliente. Espera tem intervalo próprio; fechamento termina a espera; reabertura preserva conclusões anteriores. Legado sem evidência histórica não recebe desfecho ou ciclo fictício.
- Os comandos preservam `ticket.manage`; `auditOnSuccess:false` evita auditoria antecipada/duplicada de sucesso do gate. Negação de autorização permanece fato separado. O vínculo CR não concede Review/Apply e o fechamento não altera CR.
- GET de lista/detalhe/estado após cutover não executa importação nem cria ciclo. Readiness reconcilia origem pendente por leitura. Backfill tem entrada explícita, paginação, contagens efetivas e marker conciliado; origem nova invalida prontidão. A CLI entregue opera somente arquivo SQLite local explicitamente identificado.
- Correção acrescenta novo evento referindo-se ao original no mesmo Ticket/organização. Triggers protegem UPDATE/DELETE dos eventos e da auditoria `ticket.%` nas operações normais; não prometem resistência a administrador que remova schema/triggers.

## Fronteiras de escopo e operação

A atomicidade comprovada cobre os comandos Ticket e o backfill abrangidos. Os dois submitters CR mantêm seus caminhos atuais, testados como compatíveis com defaults/ciclo zero. Sua conversão transacional completa e reconciliação pertencem à CC-08; publicação e compensação externa de anexos pertencem à CC-06. Compatibilidade não prova atomicidade de todo o ciclo CR/Dropbox. A outbox persiste intenção; consumidor/entrega são CC-07. Grants granulares e ACL de objeto são CC-04.

O contrato de API e o runbook estão coerentes com essas fronteiras. Aplicar 0026 produz retenção mesmo com flag desligada. Rollback de flag suspende as edições do núcleo dos Tickets adotados; **não restaurar código antigo sem preservar o guard de somente leitura**. A barreira SQL de status é proteção adicional e não substitui recuperação completa. Onboarding de organização exige marker explícito, inclusive quando não existe origem legada.

Não foram executados D1 remoto, migrations remotas, CT-02 humano, QA autenticado ou deploy. A confirmação da 0025 recebida do usuário não identifica banco/ambiente e não autoriza a 0026. 0021/0022/0023 permanecem intocadas. O comportamento transacional foi exercitado no adapter SQLite local; cutover D1, ledger/checksum/binding, flags e aceite remoto continuam gates separados.

## Evidências locais finais

Execução independente:

```sh
node --test tests/ticket-commands-integration.test.mjs tests/ticket-command-http.test.mjs tests/ticket-legacy-backfill.test.mjs tests/ticket-command-admin-retention.test.mjs
```

Resultado: **122 testes aprovados, zero falhas e zero skips**. Inclui os retestes de comandos, HTTP, backfill e retenção administrativa. O log integral de trabalho está em `qa/cc03-independent-review-tests.txt` no diretório de scratch que contém o checkout. Também foi executado `schema.sql` integral em banco vazio: `PRAGMA foreign_key_check` vazio e trigger `ticket_lifecycle_requires_command` presente. Build, suites adicionais e fixtures de navegador executados pelo agente principal possuem evidências próprias; não são contados como execução desta revisão.

Os hashes SHA-256 identificam o conteúdo revisado antes do commit. Alterações posteriores nesses arquivos exigem avaliar o delta; o merge não substitui o aceite operacional.

| Arquivo | SHA-256 |
|---|---|
| `functions/_lib/ticket-commands.js` | `5c5007cb7cc3a9dfd1d51e9f59743f21ec8449cb752d29754ffb473b30b97c7c` |
| `functions/_lib/ticket-command-http.js` | `bc8982fcac5170583f7c80a286bda9a24ddbec5fd4d6fde1950129a7c4d9e489` |
| `functions/_lib/ticket-center.js` | `709d55b61cb4f0b748a10afea662855da5b4ef8cb34a5a9b2f090bcb691e861e` |
| `functions/_lib/ticket-legacy-backfill.js` | `b939d6e54c3b00984f15805557e94278a01fbab3dc4e77988b5e64970384e621` |
| `functions/api/admin/users/[id].js` | `f2c2f8d405dd05eb0484924d68cbaca3f141d900818ed116af904277975aead3` |
| `migrations/0026_ticket_command_lifecycle.sql` | `803e2095a6f7bc53b41af0a1dfd64e01ad27844c883779fd5237d40acf7a9621` |
| `schema.sql` | `6d3c9fab2774509b7ba92413714471c45cfceae56ce296b52d169fadb517038b` |
| `docs/central-chamados/cc-03/api-contract.md` | `a4ae7c24d14d4a5d9baeedac52785e8dc58c07b6e5b251ae6672fea84d89a1a9` |
| `docs/central-chamados/cc-03/migration-runbook.md` | `f1c6355e1d4badead2322b6c6c7e31b459e5c976cacccc6e1acc181aa7ee260c` |
| `tests/ticket-command-admin-retention.test.mjs` | `094537433241d781a8276b68bef86c369c265788f3ce73720bb21bb1d8b94587` |
