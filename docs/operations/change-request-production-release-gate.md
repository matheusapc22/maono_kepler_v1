# Change Requests — production acceptance and observability gate

## Escopo

Este é o gate operacional da PR 4, stacked sobre a PR 3 (`feat/viewer-request-tracking`), que por sua vez depende da PR 2 e da PR #147. Ele não autoriza merge antecipado, migration remota, criação artificial de sessão nem abertura do kill switch de Preview durante a fase de desenvolvimento.

O gate existe para provar, no SHA integrado, que lifecycle, Apply grande, feedback/tracking e resubmissão funcionam juntos e que o D1 permanece consistente antes de declarar o rollout concluído.

## Estado durante o desenvolvimento stacked

Enquanto o acceptance autenticado da #147 e a migration 0021 estiverem pendentes:

- `MAONO_PREVIEW_MUTATIONS_ENABLED` permanece `false`;
- migrations 0021, 0022 e 0023 permanecem não aplicadas remotamente;
- a branch operacional `ops/change-request-release-acceptance` não deve ser criada;
- o job mutável `acceptance` não pode executar; apenas build, testes e validações estáticas desta PR são permitidos;
- nenhuma sessão deve ser fabricada no D1 ou exposta em logs/chat.

## Pré-condições do gate remoto

O workflow `.github/workflows/change-request-production-acceptance.yml` somente pode ser executado remotamente depois que todas as condições abaixo forem verdadeiras:

1. #147, PR 2 e PR 3 estiverem integradas na ordem aprovada e o SHA alvo estiver implantado no Preview auditado.
2. As migrations `0021_change_request_lifecycle.sql`, `0022_change_request_apply_artifacts.sql` e `0023_change_request_resubmissions.sql` tiverem sido aplicadas em janelas controladas e constarem no ledger D1.
3. Preview e Production continuarem vinculados ao mesmo D1 auditado `maono_maps` e `/api/health` expuser, nos dois ambientes, `changeRequestLifecycleReady`, `changeRequestApplyArtifactReady` e `changeRequestResubmissionReady` como `true`.
4. Existir um projeto descartável com slug `qa-smoke-*` exclusivamente dentro de `Maõno Preview QA`.
5. Existirem duas identidades QA distintas: uma que resolva efetivamente para a rota Viewer e outra que resolva para Editor/Reviewer com permissão de Apply. Suas sessões são armazenadas somente nos Repository Secrets `MAONO_PREVIEW_VIEWER_SESSION_COOKIE` e `MAONO_PREVIEW_REVIEWER_SESSION_COOKIE` no formato `maono_session=<valor>`.
6. O isolamento fail-closed do Preview já tiver sido validado com o kill switch desligado. Só então `MAONO_PREVIEW_MUTATIONS_ENABLED=true` pode ser ativado para a curta janela do acceptance.
7. A branch operacional `ops/change-request-release-acceptance` deve nascer do SHA integrado já aprovado pelos gates locais. O dispatch exige a frase exata `RUN_QA_CHANGE_REQUEST_ACCEPTANCE`.

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

`scripts/preview/change-request-production-acceptance.mjs` restringe a execução ao projeto descartável `qa-smoke-*` e exige sessões Viewer e Reviewer diferentes. O roteiro mutável é:

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

Uma falha em qualquer ponto bloqueia o release; o workflow não altera migrations nem tenta corrigir o banco automaticamente.

## Fechamento da janela

Depois do acceptance e da observabilidade `post`, o operador deve restaurar `MAONO_PREVIEW_MUTATIONS_ENABLED=false` usando o mecanismo seguro já aprovado para Pages. A automação não tenta alterar essa variável nem substituir a configuração completa de Pages.

Em seguida, `.github/workflows/change-request-production-closure.yml` deve ser disparado sobre a branch operacional `ops/change-request-release-acceptance` com a confirmação exata `VERIFY_QA_CHANGE_REQUEST_CLOSED`. Esse gate é somente leitura e não usa sessões QA. Ele confirma:

- `MAONO_PREVIEW_MUTATIONS_ENABLED=false` explicitamente na configuração de Pages;
- `/api/health` do Preview reportando `previewMutationsEnabled=false`;
- readiness das migrations 0021/0022/0023 no Preview e Production;
- binding de Preview e Production ainda apontando para o D1 auditado `maono_maps`;
- nenhuma mutação remota executada pelo próprio gate de fechamento.

O release só pode ser declarado concluído depois do acceptance, da observabilidade posterior, da restauração manual do kill switch e do gate de fechamento read-only aprovado. Nenhum desses passos pode ser omitido ou convertido em sucesso por fallback.

## Disponibilidade de `workflow_dispatch`

Os workflows mutáveis/read-only de release só ficam disponíveis para disparo manual quando sua definição estiver presente na default branch do repositório. Antes da janela de rollout, deve existir um mecanismo operacional revisado na default branch que permita selecionar a branch `ops/change-request-release-acceptance` sem copiar credenciais nem enfraquecer os `if` de confirmação. Preparar esse bootstrap é permitido; executá-lo antes dos gates anteriores não é.

## Situação atual

A PR 4 pode ser desenvolvida e validada localmente/por CI enquanto os gates anteriores permanecem pendentes. O acceptance remoto continua **BLOQUEADO** até existir transferência segura das sessões QA e até o rollout controlado das migrations 0021/0022/0023. O gate de fechamento está programado, mas só deve ser usado depois da restauração explícita de `MAONO_PREVIEW_MUTATIONS_ENABLED=false`. Esses bloqueios não devem ser enfraquecidos para fazer workflows passarem.
