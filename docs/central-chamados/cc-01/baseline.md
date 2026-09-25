# CC-01 — baseline verificável e reconciliação de branches

Captura: 2026-09-25T14:14:29+00:00. Repositório: [matheusapc22/maono_kepler_v1](https://github.com/matheusapc22/maono_kepler_v1).

Este registro executa o levantamento somente leitura de **REQ-CC-01 / CT-01**. Separa código-fonte, check de deployment observado, configuração documental e estado remoto desconhecido. **Não declara CT-02, QA autenticado ou produção aprovados.** Nenhuma migration é criada ou aplicada por CC-01.

## Referências fixadas e decisão de integração

| Referência | SHA | Árvore |
|---|---|---|
| Base funcional / target `mano_kepler_v1` | `eec3a7a8fa78ab259b5522d3531d3cec942cb63f` | `263bc3d342e11d72361f62d1c311f538ed61d892` |
| Default `main` | `6a2827cfb5f3474f201c8092ce92d8a957dd93e8` | `0ca52bd048d1a8c38f01ba7cb6f7aee8d2f91e09` |
| Merge-base | `a1d6d2526361d6b6d1b455e39056809c26ada87f` | — |

**ADR-CC-01 — decisão para este lote:** desenvolver `feat/cc-01-baseline-contracts` a partir do SHA funcional acima e abrir a PR contra `mano_kepler_v1`. Reconciliar a divergência por inventário e decisão explícita; não executar merge, cherry-pick ou retarget de `main` por conveniência. Isto fixa a base de integração de CC-01; não certifica a branch realmente configurada em Production.

Histórico local completo (`is-shallow-repository=false`): a funcional tem **1863 commits exclusivos** e está atrás de **22 commits exclusivos de main**. O diff integral main → funcional contém **819 arquivos**, 178467 inserções e 1820 exclusões. A lista de 300 arquivos da API não foi usada como diff completo. Esses números descrevem divergência histórica, não quantidade de correções pendentes.

## Os 22 commits exclusivos de main

Cada linha foi obtida de `git log source..main`; os arquivos modificados foram lidos contra o primeiro pai. Commits de merge aparecem separadamente e não significam mudanças adicionais aos commits de sua PR. Os SHAs e caminhos completos estão em `baseline.json`.

| SHA | Data | Grupo | Assunto |
|---|---|---|---|
| [7365e0626f45](https://github.com/matheusapc22/maono_kepler_v1/commit/7365e0626f45adf3d529f62d0d2fd9592a73380f) | 2025-10-07 | Frontend/assets anteriores | Update index.tsx |
| [9b0bbd0a7fbc](https://github.com/matheusapc22/maono_kepler_v1/commit/9b0bbd0a7fbc37251ae44cd9cb9b0b4ce68d9357) | 2025-10-07 | Frontend/assets anteriores | Merge pull request #2 from matheusapc22/matheusapc22-patch-1 |
| [5e40b2b12416](https://github.com/matheusapc22/maono_kepler_v1/commit/5e40b2b124167dec10106d77f2434220fc8e7e50) | 2026-05-21 | Frontend/assets anteriores | Add files via upload |
| [804b490be66d](https://github.com/matheusapc22/maono_kepler_v1/commit/804b490be66dc3f75bacd96e0846b465fe69b6f6) | 2026-05-21 | Frontend/assets anteriores | Update panel-header.tsx |
| [dbb389d4d79f](https://github.com/matheusapc22/maono_kepler_v1/commit/dbb389d4d79f6155df82986cf1fd788acb51e864) | 2026-05-27 | Frontend/assets anteriores | feat(projects): add Dropbox thumbnail projects page |
| [33c9de149b07](https://github.com/matheusapc22/maono_kepler_v1/commit/33c9de149b07bcafb08128976d17a481236f15f2) | 2026-05-27 | Frontend/assets anteriores | style(projects): add projects cockpit thumbnail layout |
| [68ed82dd3822](https://github.com/matheusapc22/maono_kepler_v1/commit/68ed82dd38222fae74a8b4700ab7e081781d6748) | 2026-05-27 | Frontend/assets anteriores | feat(projects): route Dropbox-backed projects dashboard |
| [f4b718c079a2](https://github.com/matheusapc22/maono_kepler_v1/commit/f4b718c079a2109f8b7b5444a76069ed878e8254) | 2026-05-27 | Frontend/assets anteriores | feat(dropbox): replace thumbnail on save without duplicating json |
| [9919d0bda0e1](https://github.com/matheusapc22/maono_kepler_v1/commit/9919d0bda0e15ed01fe7dc06e50ddcd2066e01ec) | 2026-05-27 | Frontend/assets anteriores | feat(dropbox): capture map canvas when saving thumbnail |
| [aa477af0031b](https://github.com/matheusapc22/maono_kepler_v1/commit/aa477af0031b50c2659688872b87973931f61740) | 2026-09-06 | Preview QA #147 | ops(pr147): register guarded manual Preview QA dispatch |
| [e8f3edde3983](https://github.com/matheusapc22/maono_kepler_v1/commit/e8f3edde39830c1bb2552c09aa53c08e7e67586c) | 2026-09-06 | CR bootstrap #152 | ci(change-requests): add default-branch release dispatcher |
| [d98be2120bad](https://github.com/matheusapc22/maono_kepler_v1/commit/d98be2120bad320153fbd906985e49791db546c7) | 2026-09-06 | CR bootstrap #152 | ci(change-requests): pin validated release SHA |
| [09c92f8214ab](https://github.com/matheusapc22/maono_kepler_v1/commit/09c92f8214abc4d485317e735f226b0f20654637) | 2026-09-06 | CR bootstrap #152 | ci(change-requests): validate Viewer tracking contract in release operator |
| [06ae952ef2f5](https://github.com/matheusapc22/maono_kepler_v1/commit/06ae952ef2f53d3f72b89d0e5ea5728805f930b0) | 2026-09-06 | CR bootstrap #152 | ci(change-requests): add controlled migration phase |
| [ff4883285975](https://github.com/matheusapc22/maono_kepler_v1/commit/ff488328597553f2ab0f3689a372716503855bc6) | 2026-09-06 | CR bootstrap #152 | ci(change-requests): syntax-check release branch operators |
| [660f66a90f91](https://github.com/matheusapc22/maono_kepler_v1/commit/660f66a90f91f3d800a69b92e316c125ecfc659e) | 2026-09-06 | CR bootstrap #152 | test(change-requests): validate default-branch release operator |
| [5ff585fb21d9](https://github.com/matheusapc22/maono_kepler_v1/commit/5ff585fb21d9aeed254d06e1cac99ca163ac42b2) | 2026-09-06 | CR bootstrap #152 | ci(change-requests): validate release operator on pull requests |
| [6bc000ed46cc](https://github.com/matheusapc22/maono_kepler_v1/commit/6bc000ed46cc2c4f91ad1bc1e3e11166aadecc74) | 2026-09-07 | CR bootstrap #152 | Merge pull request #152 from matheusapc22/ops/change-request-release-workflow-bootstrap |
| [ce721dd71d05](https://github.com/matheusapc22/maono_kepler_v1/commit/ce721dd71d05827f938d2c5b25773c740d747f8b) | 2026-09-09 | Large CREATE #158 | ci(create): bootstrap Large CREATE Preview acceptance operator |
| [d7b9295719d7](https://github.com/matheusapc22/maono_kepler_v1/commit/d7b9295719d782451fc097f8760a72831b7f0fe7) | 2026-09-10 | Large CREATE #158 | Merge pull request #158 from matheusapc22/ops/large-create-preview-acceptance-bootstrap |
| [cc28d65eb027](https://github.com/matheusapc22/maono_kepler_v1/commit/cc28d65eb0271442dd00700fb514fc27a575937f) | 2026-09-19 | Storage recovery #183 | chore(ops): bootstrap storage recovery operator workflow |
| [6a2827cfb5f3](https://github.com/matheusapc22/maono_kepler_v1/commit/6a2827cfb5f3474f201c8092ce92d8a957dd93e8) | 2026-09-19 | Storage recovery #183 | Merge pull request #183 from matheusapc22/ops/prh08-recovery-operator-bootstrap |

| Grupo | Decisão de reconciliação |
|---|---|
| Nove commits antigos de UI/assets | Os caminhos existem na funcional com blobs diferentes. Preservar a evolução atual; não presumir equivalência semântica nem importar versões anteriores neste lote documental. |
| Um bootstrap Preview QA #147 | `.github/workflows/pr147-preview-config.yml` existe somente em main; faz PATCH no Pages. Não executar nem portar em CC-01. |
| Oito commits/merge do operador CR #152 | Dispatcher, workflow de validação e teste estão somente em main. Manter gates e revalidar código do stack antes de qualquer recuperação operacional. |
| Dois commits/merge Large CREATE #158 | Workflow já existe na funcional. Diff atual tem apenas `default: mano_kepler_v1` no campo release_ref da versão funcional; nenhum cherry-pick necessário para CC-01. |
| Dois commits/merge storage recovery #183 | O workflow final é idêntico por blob nas duas referências. Nenhum cherry-pick necessário para CC-01. |

## Deployment observado versus ambientes não comprovados

| Evidência | Resultado | Limite |
|---|---|---|
| [Check Cloudflare Pages](https://github.com/matheusapc22/maono_kepler_v1/runs/108085556422) | success, concluído em 25/09/2026 13:12:28Z, associado ao SHA funcional | Não prova schema, autorização, sessões QA nem fluxo funcional |
| [URL informada pelo check](https://e7e63b4f.maono-kepler-v1.pages.dev) | Rótulo “Preview URL” do provedor | O hostname/hash não certifica runtime Preview: o middleware dá precedência à configuração explícita de runtime |
| Production | URL, branch configurada, deployment SHA, schema e smoke autenticado não verificados | Não preencher por inferência a partir de main, do check ou de memória |
| Acceptance autenticado | Não executado por este baseline | Requer identidades/ambiente e evidência próprios |

Não foi feito probe HTTP de health neste subtrabalho. O health de código só valida presença de DB e SELECT 1; mesmo um 200 não atesta migrations/domínios completos. Dados de runtime, flags e secrets permanecem não verificados.

## Bindings e schema de referência

`functions/_lib/organizations.js` resolve `DB`, depois `D1`, depois `MAONO_DB`. `/api/health` verifica somente `env.DB`. Os exemplos Wrangler documentam `maono_maps` para aplicação/Preview e usam placeholders de database_id; o ambiente local é `maono_maps_local`. O exemplo de Preview compartilha o D1 de produção. Confirmar separadamente ambiente, binding e ID antes de qualquer ação. IDs esperados em operadores são configuração de fonte, não prova do alvo remoto.

Entidades atuais: `organization_tickets`, `ticket_attachments`, `ticket_events`; CR usa `project_change_requests` e `project_change_operations` da migration 0020. **schema.sql não contém as tabelas CR**: executar apenas o bootstrap não substitui o inventário/ledger de migrations. SHA de cada arquivo, migrations presentes e configuração estão no JSON. Ledger/schema remoto não foram consultados.

As leituras GET de lista/detalhe chamam `migrateLegacyTickets`, portanto podem fazer DML de compatibilidade. Não usar esses endpoints como prova de operação estritamente sem escrita no banco. Este levantamento leu código e Git, não chamou esses endpoints.

## Rotas e contratos atuais

Inventário detalhado de ações/perfis e evolução pertence ao contrato complementar de CC-01. Aqui se registra somente a existência dos handlers no SHA fonte.

| Método | Endpoint | Gate atual resumido |
|---|---|---|
| GET, POST | `/api/organizations/:id/tickets` | ticket.view / ticket.create |
| GET, PATCH | `/api/organizations/:id/tickets/:ticketId` | ticket.view / ticket.manage |
| GET, POST | `/api/organizations/:id/tickets/:ticketId/attachments` | ticket.view; POST também ticket.create ou ticket.manage |
| PATCH, DELETE | `/api/organizations/:id/tickets/:ticketId/attachments/:attachmentId` | Leitura, contexto composto, autoria/gestão e estado |
| GET | `/api/organizations/:id/tickets/:ticketId/attachments/:attachmentId/download` | ticket.view e contexto organização/ticket/anexo |
| GET, POST | `/api/projects/:slug/change-requests` | Domínio Viewer/projeto |
| GET | `/api/projects/:slug/change-requests/:id` | Solicitante/projeto |
| GET | `/api/projects/:slug/change-requests/inbox` | Revisor autorizado do projeto |
| GET, POST | `/api/projects/:slug/change-requests/:id/review` | project.view + rota Editor + project.map.edit |
| POST | `/api/projects/:slug/change-requests/:id/apply` | Revisor e project.save; gates independentes do Ticket |
| GET | `/api/health` | Health básico, sem certificação de schema completo |

UI: `/projects` usa seção local `requests`; lista/Kanban/calendário e drawer compartilham contexto. CR: `/projects/:projectSlug/requests` e `/projects/:projectSlug/review/:changeRequestId`. Lista até 100 itens/requisição. `from/to` atuais filtram due_at com limites UTC, não abertura nem calendário SLA.

Anexos: cinco arquivos; 80 MiB por arquivo; 150 MiB por chamado; chunk 8 MiB e multipart legado 10 MiB. Vínculo CR atual: ticket_id UNIQUE, 1:1. Review exige project.view, rota Editor e project.map.edit; Apply também project.save. `can()` distingue organização ativa e projeto; ticket.view não concede Review/Apply. O Apply existente pode aprovar dentro da ação e materializa a base integral: evolução pertence a CC-08, sem alteração neste lote.

## Migrations e gates preservados

**CC-01 não cria migration. Dependências existentes permanecem “migration pendente de confirmação” por ambiente até evidência explícita; isso não significa que nunca foram aplicadas.** Em especial:

| Migration | Papel | Situação neste baseline |
|---|---|---|
| 0002_organizations_files.sql | Organizações, vínculos e armazenamento compartilhados | Presente na fonte; remoto não verificado |
| 0009_organization_storage_invariant.sql | Readiness e raiz de storage | Presente na fonte; confirmação atual do alvo não obtida aqui |
| 0010_ticket_center.sql | Chamados, anexos, eventos e concessões iniciais | Presente na fonte; pré-requisito da Central no banco alvo |
| 0020_project_change_requests.sql | CR e operações imutáveis | Presente na fonte; pré-requisito do domínio CR |
| 0021_change_request_lifecycle.sql | Decisões, journal e sincronização Ticket/CR | Ausente da árvore funcional; histórico fechado; não autorizada; migration pendente de confirmação |
| 0022_change_request_apply_artifacts.sql | Artefatos por tentativa de Apply | Ausente da árvore funcional; histórico fechado; não autorizada; migration pendente de confirmação |
| 0023_change_request_resubmissions.sql | Linhagem de resubmissão | Ausente da árvore funcional; histórico fechado; não autorizada; migration pendente de confirmação |
| 0024_document_folders_trash.sql | Pastas/lixeira de documentos | Já presente: número ocupado; remoto não certificado neste baseline |

Não reutilizar 0021–0024, não executar migrations por lote geral, não criar `ops/change-request-release-acceptance`, não habilitar `MAONO_PREVIEW_MUTATIONS_ENABLED=true`. A 0021 histórica altera compatibilidade de writers e seu fechamento automático de Ticket exige reconciliação com o planejamento novo; não portar esse SQL intacto. Qualquer aplicação futura precisa SQL revisável, ambiente/ID verificados, autorização explícita e confirmação pós-aplicação.

## PRs e operador histórico

Consulta GitHub somente leitura de 25/09: #147/#149/#150/#151 estão fechadas sem merge; #152 está mergeada. Os HEADs e URLs constam no JSON. Acceptance e closure históricas de #151 aparecem skipped, não aprovadas. Checks antigos não validam o HEAD desta PR.

Em main, `.github/workflows/change-request-release-operator.yml` tem workflow_dispatch e modos migrate/acceptance/closure, fixa RELEASE_REF em `ops/change-request-release-acceptance`, captura SHA e impede drift. Referencia testes/scripts do stack histórico e duas identidades QA distintas. A presença do YAML **não confirma que os pré-requisitos estejam disponíveis hoje**. Nenhum workflow foi executado por CC-01.

## Limites de aceite e próximos registros

- CT-01: inventário e comparação somente leitura registrados; Production, bindings/ledger/schema e QA continuam explicitamente desconhecidos.
- CT-02: **não executado**. Exige solicitante e atendente percorrendo dúvida/incidente no protótipo; revisão de código/documento não substitui sessão com usuários.
- Base/target de CC-01 estão fixados pela decisão acima. Antes de merge, revalidar HEAD/CI do lote; antes de ativar funcionalidade, obter evidência remota do ambiente e migrations aplicáveis.
- Nenhum commit/push, mudança de branch/HEAD, consulta/escrita D1 ou alteração de variável foi feito por este subtrabalho; houve fetch somente leitura da referência main.

Arquivo estruturado companheiro: [baseline.json](baseline.json). Fonte funcional: [eec3a7a8fa78](https://github.com/matheusapc22/maono_kepler_v1/commit/eec3a7a8fa78ab259b5522d3531d3cec942cb63f). Default: [6a2827cfb5f3](https://github.com/matheusapc22/maono_kepler_v1/commit/6a2827cfb5f3474f201c8092ce92d8a957dd93e8).
