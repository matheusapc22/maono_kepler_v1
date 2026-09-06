# Change Requests — production acceptance and observability gate

## Escopo

Este é o gate operacional da PR 4, stacked sobre a PR 3 (`feat/viewer-request-tracking`), que por sua vez depende da PR 2 e da PR #147. Ele não autoriza merge antecipado, migration remota, criação artificial de sessão nem abertura do kill switch de Preview durante a fase de desenvolvimento.

O gate existe para provar, no SHA integrado, que lifecycle, Apply grande, feedback/tracking e resubmissão funcionam juntos e que o D1 permanece consistente antes de declarar o rollout concluído.

## Estado durante o desenvolvimento stacked

Enquanto o acceptance autenticado da #147 e a migration 0021 estiverem pendentes:

- `MAONO_PREVIEW_MUTATIONS_ENABLED` permanece `false`;
- migrations 0021, 0022 e 0023 permanecem não aplicadas remotamente;
- a branch operacional `ops/change-request-release-acceptance` não deve ser criada;
- os jobs remotos de migration/acceptance não podem executar; apenas build, testes e validações estáticas desta PR são permitidos;
- nenhuma sessão deve ser fabricada no D1 ou exposta em logs/chat.

## Pré-condições do gate remoto

O operador de release somente pode ser utilizado depois que todas as condições abaixo forem verdadeiras:

1. #147, PR 2, PR 3 e PR 4 estiverem com CI/Preview aprovados no SHA alvo.
2. Existir um projeto descartável com slug `qa-smoke-*` exclusivamente dentro de `Maõno Preview QA`.
3. Existirem duas identidades QA realmente distintas: uma com role/rota Viewer e outra com rota Editor-capable e permissão de Review/Apply. Suas sessões são armazenadas somente nos Repository Secrets `MAONO_PREVIEW_VIEWER_SESSION_COOKIE` e `MAONO_PREVIEW_REVIEWER_SESSION_COOKIE` no formato `maono_session=<valor>`.
4. O isolamento fail-closed do Preview estiver validado com `MAONO_PREVIEW_MUTATIONS_ENABLED=false`.
5. A PR operacional #152 estiver disponível na default branch para expor o `workflow_dispatch` sem incorporar o stack funcional prematuramente.
6. A branch `ops/change-request-release-acceptance` nascer exatamente do SHA final aprovado da PR 4.
7. Durante a janela iniciada por 0021, Review/Apply de Change Requests em Production deve ficar operacionalmente congelado até o deploy da #147, pois a migration endurece o contrato dos writers.

## Gate de identidade QA

`scripts/preview/change-request-qa-identity-preflight.mjs` consulta `/api/session` com cada cookie, sem imprimir credenciais ou identificadores. O gate exige:

- dois usuários diferentes, não apenas cookies diferentes;
- organização ativa `maono-preview-qa` para ambos;
- projeto `qa-smoke-*` acessível às duas identidades;
- Viewer com role efetiva `viewer` e acesso `viewer`;
- Reviewer não Viewer e com acesso `editor`, `write` ou `owner`.

Esse preflight roda antes de qualquer mutation de acceptance e também é exigido pelo operador controlado de migrations.

## Migration gate controlado

`scripts/operations/change-request-release-migrations.mjs` aplica `0021`, `0022` e `0023` somente na janela explícita de rollout. Ele não habilita mutations e exige o Preview fail-closed antes de tocar no D1.

O gate:

- confirma que Preview e Production apontam para o mesmo `maono_maps` auditado;
- valida as duas identidades QA e o projeto descartável antes da escrita;
- recusa execução se houver Change Request `applying`;
- aceita apenas um prefixo coerente do ledger `0021 -> 0022 -> 0023`;
- recusa schema parcial não registrado ou ledger/schema divergente;
- cria um diretório temporário contendo somente migrations pendentes do trio e chama Wrangler nesse diretório isolado;
- depois da escrita confirma ledger, colunas, tabela, índices, triggers, journal e sincronização Request/Ticket;
- exige `/api/health` Preview com readiness das três migrations e confirma que `previewMutationsEnabled` continua `false`.

O dispatcher da PR #152 exige `mode=migrate` e a confirmação literal `APPLY_CHANGE_REQUEST_0021_0023`. Falha depois do início da escrita não deve ser seguida por retry cego; o estado remoto precisa ser inspecionado primeiro.

## Observabilidade prévia

`scripts/operations/change-request-release-observability.mjs` executa somente consultas read-only no D1. O próprio script rejeita SQL fora de `SELECT`, `PRAGMA` ou `WITH` e também recusa palavras-chave de mutação.

Antes do acceptance ele confirma:

- binding D1 de Preview e Production;
- configuração do escopo `maono-preview-qa`;
- ledger 0021/0022/0023;
- colunas, índices e triggers exigidos pelas três migrations;
- zero divergências Request/Ticket;
- journal de lifecycle sem lacunas;
- decisão e `applied_revision` coerentes;
- artefatos de Apply coerentes com a revisão-base;
- lineage de resubmissão válido;
- ausência de requests `applying` antigos além do limite configurado;
- projeto `qa-smoke-*` pertencente à organização QA;
- health integrado dos dois ambientes.

Dados de usuários, cookies, tokens e conteúdo de MapConfig não são impressos pelo observability gate.

## Acceptance autenticado

Depois que o migration gate estiver verde, o operador altera `MAONO_PREVIEW_MUTATIONS_ENABLED=true` apenas para a janela curta de acceptance. O preflight de identidade roda novamente antes das mutations.

`scripts/preview/change-request-production-acceptance.mjs` restringe a execução ao projeto descartável `qa-smoke-*`. O roteiro mutável é:

1. Viewer cria uma Change Request com `Idempotency-Key` única e uma operação `point.create` isolada no projeto QA.
2. Reviewer rejeita com feedback; repetir a mesma rejeição deve ser idempotente.
3. Viewer consulta tracking e precisa observar status `rejected` e o feedback canônico.
4. Viewer cria uma nova correção vinculada à rejeitada; repetir a mesma resubmissão deve retornar replay da mesma filha.
5. Tracking deve expor os dois lados do lineage (`resubmittedFromRequestId`/`resubmittedToRequestId`).
6. Reviewer inicia Review, aprova com feedback e repete a aprovação sem criar nova decisão.
7. O script lê o MapConfig QA, usa o mesmo `buildProjectChangeProposal` do produto, serializa a proposta, calcula o Dropbox content hash e chama o caminho streaming do Apply (`X-Maono-Large-Config: 1`) com revisão, tamanho, schema, lifecycle version e checksum explícitos.
8. O Apply deve publicar exatamente `baseRevision + 1`; a repetição deve ser idempotente.
9. Viewer deve observar a filha em `applied` e a revisão aplicada correta.

Os IDs e checksum produzidos são passados pelo `GITHUB_ENV` apenas para a etapa read-only seguinte; sessões nunca são copiadas para evidência.

## Observabilidade posterior

A etapa `post` volta ao D1 em modo read-only e prova que:

- a solicitação pai continua `rejected`;
- a filha está `applied` e aponta para o pai esperado;
- `applied_revision = base_revision + 1`;
- o artefato persistido possui exatamente o checksum calculado no acceptance;
- o Ticket da filha está `closed`;
- todos os invariantes globais verificados no pre-gate continuam em zero.

Uma falha em qualquer ponto bloqueia o release; o workflow não tenta corrigir o banco automaticamente.

## Fechamento da janela

Assim que o acceptance terminar, `MAONO_PREVIEW_MUTATIONS_ENABLED` deve voltar para `false`. Depois do stack estar efetivamente implantado em Production, o gate de closure read-only confirma essa restauração, os bindings e a readiness das três migrations nos dois ambientes.

A sequência operacional completa, incluindo retarget/merge das PRs stacked, está em `docs/operations/change-request-release-runbook.md`.

## Situação atual

A implementação de código pode ser considerada fechada quando CI + Cloudflare do HEAD final estiverem verdes. O rollout remoto continua **BLOQUEADO** até existir transferência segura das duas sessões QA, duas identidades corretas e a janela controlada para migrations/acceptance. Esse bloqueio não deve ser enfraquecido para fazer o workflow passar.
