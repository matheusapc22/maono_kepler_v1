# Change Requests — runbook final de rollout

Este roteiro fecha o stack `#147 -> #149 -> #150 -> #151` sem enfraquecer os gates já definidos. Ele pressupõe que o código e o CI estão prontos, mas **não autoriza** aplicar migrations, habilitar mutations ou fazer merge antes das pré-condições abaixo.

## Estado que deve permanecer enquanto o rollout não começar

- `MAONO_PREVIEW_MUTATIONS_ENABLED=false`.
- `0021_change_request_lifecycle.sql`, `0022_change_request_apply_artifacts.sql` e `0023_change_request_resubmissions.sql` não são aplicadas.
- A branch `ops/change-request-release-acceptance` não existe.
- As PRs #147, #149, #150 e #151 permanecem Draft e sem merge.
- Cookies de sessão nunca são enviados por chat ou impressos em logs.

## Pré-condições humanas

Antes de abrir a janela de rollout, preparar no `Maõno Preview QA`:

1. Um projeto descartável cujo slug seja `qa-smoke-*`.
2. Uma identidade QA **Viewer** distinta, com role efetiva `viewer` e acesso `viewer` ao projeto.
3. Uma identidade QA **Reviewer/Editor** distinta, não Viewer, com acesso efetivo `editor`, `write` ou `owner` ao mesmo projeto e capacidade de Review/Apply.
4. Salvar somente no GitHub Actions os cookies das duas sessões, no formato `maono_session=<valor>`:
   - `MAONO_PREVIEW_VIEWER_SESSION_COOKIE`
   - `MAONO_PREVIEW_REVIEWER_SESSION_COOKIE`
5. Manter `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` existentes; o token precisa continuar com D1 Write e Pages Read/Write necessários ao rollout.

A validação de release consulta `/api/session` e bloqueia se os dois cookies forem da mesma pessoa, se o Viewer não resolver para rota Viewer, se o Reviewer não resolver para rota Editor-capable, se a organização ativa não for `maono-preview-qa` ou se o projeto QA não estiver acessível.

## Bootstrap do operador

A PR #152 contém somente o dispatcher operacional da default branch. Depois de CI/Preview verdes, ela pode ser mesclada em `main` sem incorporar o stack funcional em `mano_kepler_v1`.

O dispatcher `Change Request release operator` só possui execução manual e trabalha sobre uma branch operacional fixa. Ele captura o SHA da branch, executa testes + build, e os jobs remotos recusam continuar se a branch se mover depois da validação.

## Preparação da branch de release

Somente depois das identidades QA e secrets estarem prontos:

1. Confirmar que #151 está verde em GitHub Actions e Cloudflare Pages.
2. Criar `ops/change-request-release-acceptance` **exatamente** a partir do HEAD final aprovado de #151.
3. Aguardar o Preview dessa branch ficar verde.
4. Confirmar manualmente que `MAONO_PREVIEW_MUTATIONS_ENABLED=false` continua vigente.
5. Durante toda a janela, evitar Review/Apply de Change Requests em produção até o deploy de #147 concluir, pois 0021 introduz writers incompatíveis com a implementação antiga.

## Fase 1 — migrations 0021/0022/0023

No GitHub Actions, executar `Change Request release operator` com:

- `mode = migrate`
- `confirmation = APPLY_CHANGE_REQUEST_0021_0023`
- `preview_base_url = <Preview da branch operacional>`
- `production_base_url = <Production>`
- `qa_project_slug = <qa-smoke-...>`

O job de migration:

- exige Preview fail-closed (`mutations=false`);
- valida os dois usuários QA antes de tocar no D1;
- confirma bindings Preview/Production para o mesmo `maono_maps`;
- recusa migration se houver Change Request em `applying`;
- aceita somente um prefixo consistente de ledger 0021 -> 0022 -> 0023;
- falha em schema parcial não registrado;
- cria um diretório temporário contendo **somente** as migrations ainda pendentes;
- usa Wrangler para aplicar apenas esse conjunto;
- confirma ledger, colunas, tabela, índices, triggers, journal e sincronização Request/Ticket;
- confirma `/api/health` do Preview com readiness 0021/0022/0023=true;
- confirma que `MAONO_PREVIEW_MUTATIONS_ENABLED` permaneceu false.

Se esse job falhar depois de iniciar a escrita, **não repetir cegamente**. Primeiro inspecionar ledger/schema; o próprio job é idempotente apenas quando o estado remoto é coerente.

## Fase 2 — acceptance autenticado antes do primeiro merge funcional

Depois das migrations ficarem verdes:

1. Na configuração Preview do Cloudflare Pages, alterar **somente** `MAONO_PREVIEW_MUTATIONS_ENABLED` para `true`.
2. Confirmar que o deployment/health do Preview reflete `previewMutationsEnabled=true`.
3. Executar `Change Request release operator`:
   - `mode = acceptance`
   - `confirmation = RUN_QA_CHANGE_REQUEST_ACCEPTANCE`
   - os mesmos URLs e `qa_project_slug`.

Esse gate executa, com usuários distintos:

`submit -> reject + feedback -> tracking -> resubmit + replay -> approve -> streaming Apply + retry -> tracking final`.

A observabilidade posterior exige pai rejeitado, filha aplicada, lineage correto, checksum imutável, `applied_revision = base_revision + 1`, Ticket fechado e zero divergências globais.

Se o acceptance falhar, **não fazer merge**. Restaurar `MAONO_PREVIEW_MUTATIONS_ENABLED=false`, preservar evidências e corrigir a causa antes de reabrir a janela.

## Fase 3 — fechar imediatamente o Preview mutável

Assim que o acceptance terminar com sucesso:

1. Alterar `MAONO_PREVIEW_MUTATIONS_ENABLED=false` no Cloudflare Pages.
2. Não declarar o gate concluído ainda; a verificação final de closure será executada após o stack estar implantado em Production.

## Fase 4 — merges funcionais

Os merges devem levar o código para `mano_kepler_v1` na ordem lógica do stack.

### 4.1 PR #147

- Confirmar acceptance verde e mutations novamente false.
- Marcar #147 ready somente neste ponto.
- Mergear #147 em `mano_kepler_v1`.
- Aguardar Cloudflare Production e CI do commit de merge ficarem verdes.
- Confirmar `/api/health` sem regressão.

Esse é o ponto crítico que encerra a janela em que 0021 está no D1 mas os writers antigos ainda poderiam existir em Production.

### 4.2 PR #149

Depois de #147 estar efetivamente em `mano_kepler_v1`:

- alterar a base de #149 de `feat/change-requests-ticket-lifecycle` para `mano_kepler_v1`;
- confirmar que o diff contém somente a etapa large Apply esperada;
- aguardar os checks recalculados;
- mergear #149;
- aguardar CI + Production verdes.

### 4.3 PR #150

Depois de #149:

- alterar a base de #150 de `refactor/change-request-large-apply` para `mano_kepler_v1`;
- confirmar o diff de tracking/feedback/resubmission;
- aguardar checks;
- mergear #150;
- aguardar CI + Production verdes.

### 4.4 PR #151

Depois de #150:

- alterar a base de #151 de `feat/viewer-request-tracking` para `mano_kepler_v1`;
- confirmar que restam somente acceptance/observability/hardening esperados;
- aguardar checks;
- mergear #151;
- aguardar CI + Cloudflare Production verdes.

Não fazer os quatro merges em lote sem observar o deploy verde de cada estágio.

## Fase 5 — closure final

Com #151 já implantada em Production e Preview mutations=false, executar no GitHub Actions:

- `mode = closure`
- `confirmation = VERIFY_QA_CHANGE_REQUEST_CLOSED`
- `preview_base_url = <Preview operacional>`
- `production_base_url = <Production>`

O gate final é somente leitura e deve comprovar:

- Preview `mutations=false` na configuração Pages e em `/api/health`;
- Preview e Production ainda apontam para o D1 auditado;
- readiness 0021/0022/0023=true;
- health integrado dos dois ambientes.

Somente depois desse job verde o rollout pode ser declarado concluído.

## Critérios de parada

Interromper o rollout imediatamente se ocorrer qualquer um destes pontos:

- sessão QA ausente, expirada, mesma identidade ou role/rota incorreta;
- `applying` em andamento antes das migrations;
- ledger fora da ordem 0021 -> 0022 -> 0023;
- schema parcial;
- divergência Request/Ticket ou journal;
- Preview mutations diferente do estado esperado;
- CI/Cloudflare vermelho em qualquer HEAD/merge;
- diff inesperado ao retargetar uma PR stacked;
- health sem readiness integral depois do deploy correspondente.

Nesses casos não alterar gates para fazê-los passar e não fabricar estado no D1.
