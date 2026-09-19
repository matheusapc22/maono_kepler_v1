# Auditoria de confiabilidade — 19/09/2026

Base de produto: `mano_kepler_v1` @ `c0864514605b32ac6ff26605e9b35869ad19ed39`. `main` não é base do produto. Planejamento e planilha foram criados antes do desenvolvimento.

Cinco achados reproduzidos e corrigidos em quatro módulos de produção. Sem migrations, dependências, flags, ativação de operadores, reativação de Change Requests, merge ou ações em Production. Aceite operacional permanece pendente.

## Superfície e autorização

Inventário estático: 21 rotas UI, 77 endpoints, 2 middlewares, 19 módulos de persistência/domínio. Ver [inventory.json](inventory.json); detecção de referências de teste é heurística, não prova de execução.

| Fronteira | Política e persistência |
| --- | --- |
| UI e API | `src/Routes.tsx`; guards de página + autorização no servidor. Middleware de Preview bloqueia mutação por padrão. |
| Projetos | Organização ativa, membership e vínculo `user_projects`; `projects` e ledger `project_config_revisions`; super_admin não atravessa workspace em lookup. |
| Documentos e GeoJSON | `organization-files` confere escopo do arquivo; `organization.projects.geojson.view` é independente de document.view e project.view. |
| Escrita | `project.create`/`project.save`, lifecycle permitido, expectedRevision e CAS; conteúdo externo só vira HEAD após verificação. |
| Storage | Dropbox em produção e adapter local-d1 em testes; caminhos por organização/projeto, checksum e número de revisão. Lease/readiness/recovery existentes preservados. |
| Administração/CR | Permissões/delegação próprias; recursos de CR permanecem nas condições operacionais existentes. |

## Achados, descartes e pendências

### AH-01 — Conflito de revisão gera ReferenceError

- **Classificação:** Confirmado
- **Causa / hipótese:** O ramo de conflito usa currentConfigRevision, variável inexistente, ao invés de currentRevision.
- **Impacto:** O conflito concorrente perde o erro tipado 409 e pode aparecer como falha interna.
- **Reprodução:** Reserve N+1; entre as duas leituras de projects, avance HEAD. Teste: recycle reports a concurrent HEAD.
- **Evidência:** tests/project-config-revision-concurrency.test.mjs; regressions-before.log (5 falhas anteriores); new-regressions-final.log
- **Correção:** Detalhe do erro usa currentRevision; leitura de HEAD antecede tentativa de reaproveitamento.
- **Limitação:** Reprodução local com SQL real; não representa incidente observado em produção.

### AH-02 — Duas limpezas concorrentes atingem o mesmo arquivo

- **Classificação:** Confirmado
- **Causa / hipótese:** A exclusão do artefato ocorria antes da aquisição exclusiva da revisão FAILED.
- **Impacto:** Dois candidatos podem excluir o mesmo caminho. Uma exclusão atrasada pode atingir conteúdo substituto; perda remota não foi observada nesta auditoria.
- **Reprodução:** Atrase DELETE no adapter local; inicie duas reservas de checksums diferentes para a mesma revisão. A segunda também alcançava DELETE. Teste: only one recycler.
- **Evidência:** tests/project-config-revision-concurrency.test.mjs; regressions-before.log (5 falhas anteriores); new-regressions-final.log
- **Correção:** Claim SQL com marcador RECYCLE e token antes de excluir; somente o dono conclui a transição.
- **Limitação:** Exclusão ambígua ou processo interrompido mantém RECYCLE bloqueado para inspeção; não há liberação automática.

### AH-03 — Publicação usa leitura antiga do ledger

- **Classificação:** Confirmado
- **Causa / hipótese:** CAS de projects conferia HEAD/lifecycle, mas não a identidade da tentativa READY lida anteriormente.
- **Impacto:** HEAD pode publicar checksum ou referência de uma tentativa substituída.
- **Reprodução:** Leia READY A; antes de UPDATE projects, recicle e finalize B. Antes da correção A publica metadados antigos. Teste: a READY ledger read before recycling.
- **Evidência:** tests/project-config-revision-concurrency.test.mjs; regressions-before.log (5 falhas anteriores); new-regressions-final.log
- **Correção:** Checksum e número de tentativa conferidos na entrada e dentro do CAS SQL; mesma proteção na promoção legacy.
- **Limitação:** Fluxo versionado exercitado com SQL real; streaming/legacy têm contratos existentes, sem integração remota completa.

### AH-04 — Revisão publicada pode ser reclamada como abandonada

- **Classificação:** Confirmado
- **Causa / hipótese:** Claim de READY abandonado confiava em published_at auxiliar sem conferir o HEAD canônico atomicamente.
- **Impacto:** Ledger de revisão já publicada pode mudar para FAILED quando o carimbo auxiliar se perdeu.
- **Reprodução:** READY antigo, published_at NULL; publique HEAD entre leitura e claim. Regressões: published HEAD protects READY lineage e publication between HEAD read and abandoned-READY claim.
- **Evidência:** tests/project-config-revision-concurrency.test.mjs; regressions-before.log (5 falhas anteriores); new-regressions-final.log; mutante published-head-guard eliminado
- **Correção:** Claim inclui NOT EXISTS de HEAD publicado e identidade checksum/tentativa.
- **Limitação:** O carimbo auxiliar continua best effort; a integridade passa a depender do HEAD canônico.

### AH-05 — Callback atrasado invalida outra tentativa

- **Classificação:** Confirmado
- **Causa / hipótese:** Marcação de falha usava apenas projeto/revisão; número da tentativa e checksum não eram requisitos.
- **Impacto:** Uma falha antiga pode trocar a reserva atual WRITING para FAILED.
- **Reprodução:** Reserve conteúdo substituto; envie a falha da tentativa anterior. Também testar retry de mesmo checksum e tentativa distinta. Teste: a delayed failure.
- **Evidência:** tests/project-config-revision-concurrency.test.mjs; regressions-before.log (5 falhas anteriores); new-regressions-final.log
- **Correção:** READY/FAILED recebem checksum e attempts da reserva; callbacks antigos ou durante RECYCLE não avançam estado.
- **Limitação:** Todos os callers de produção foram atualizados; upload remoto já em voo e consistência do provider exigem aceite operacional.

### HD-01 — Vazamento por troca de organização ativa

- **Classificação:** Descartado no cenário
- **Causa / hipótese:** Hipótese: membership em duas organizações permitiria acesso ao mapa da organização não selecionada.
- **Impacto:** Não reproduzido. Lista e lookup retornaram somente o workspace ativo.
- **Reprodução:** Sequência 1 → 2 → 1 com dois projetos e memberships; revogue membership; desative organização.
- **Evidência:** tests/project-organization-isolation.test.mjs: 4/4, SQL e funções reais
- **Correção:** Nenhuma alteração de autorização.
- **Limitação:** Não equivale a teste autenticado de todos os endpoints ou cookies remotos.

### HD-02 — Permissão de documento implica acesso GeoJSON

- **Classificação:** Descartado no cenário
- **Causa / hipótese:** Hipótese: documento/projeto concederiam implicitamente GeoJSON.
- **Impacto:** Não reproduzido. GeoJSON oculto até grant explícito e novamente negado após revogação.
- **Reprodução:** Listar manual.pdf + secret.geojson; conceder e revogar organization.projects.geojson.view; trocar organização.
- **Evidência:** tests/project-organization-isolation.test.mjs
- **Correção:** Nenhuma alteração de permissão.
- **Limitação:** Super admin também foi testado contra projeto de outra organização; matriz remota de roles continua pendente.

### HD-03 — Round-trip perde conteúdo dos mapas de referência

- **Classificação:** Descartado no cenário
- **Causa / hipótese:** Hipótese: serialização ou revisão perde configuração persistida.
- **Impacto:** Seis fixtures reabertos são profundamente iguais ao conteúdo salvo.
- **Reprodução:** Sequência real saveVersionedProjectConfig → readPublishedProjectConfig, seis revisões: pontos, polígonos, filtros/histograma, isócrona, cluster v2 e vazio.
- **Evidência:** Golden round-trip em project-config-revision-concurrency.test.mjs
- **Correção:** Nenhuma alteração de formato ou tolerância.
- **Limitação:** Não prova identidade de pixels, GPU, tiles externos nem mapas arbitrários.

### HP-01 — Nove falhas na suíte Node ampliada

- **Classificação:** Pendente — base
- **Causa / hipótese:** Três módulos antigos de clustering importam arquivos/exports ausentes; seis asserts estáticos esperam textos/marcadores não encontrados.
- **Impacto:** Cobertura ampliada permanece vermelha: baseline 1165/1174 e após correção 1181/1190; mesmos nove nomes.
- **Reprodução:** node --experimental-strip-types --test tests/*.test.mjs scripts/audit-user-error-sinks.test.mjs no SHA inicial e branch.
- **Evidência:** all-node-baseline.log e all-node-tests.log; detalhes no relatório da PR
- **Correção:** Não removidas nem relaxadas. Exigem triagem própria entre teste obsoleto e comportamento faltante.
- **Limitação:** Falha de teste confirmada; defeito de produto correspondente não confirmado.

### HP-02 — Validação de ambiente e SLO

- **Classificação:** Pendente operacional
- **Causa / hipótese:** Bindings, caminhos físicos, credenciais e observação real não são demonstrados pelo ambiente local.
- **Impacto:** Não é possível encerrar aceite de recuperação ou SLO somente com gates.
- **Reprodução:** Aplicar o runbook existente com sessão legítima e escopo explicitamente autorizado; não executado nesta tarefa.
- **Evidência:** docs/ops/product-reliability-prh08-acceptance.md; docs/operations/production-db-preview-testing.md
- **Correção:** Nenhuma ação em Production/Preview mutável; nenhum operador ativado.
- **Limitação:** SLO preserva 30 dias, amostras 1000 organizações e 100 incidentes transitórios. Migration 0009 já tem evidência histórica; não reaplicada.

## Cobertura

| ID | Fluxo | Verificação | Resultado / limite |
| --- | --- | --- | --- |
| CV-01 | Base e inventário | scripts/audit-reliability-inventory.mjs | 119 itens. Extração estática, não cobertura dinâmica. |
| CV-02 | Sessão e login | test:login; loading-runtime.spec.ts | Passou. Sessão sintética somente nos testes locais, sem QA remoto. |
| CV-03 | Criação pequena e identidade | project-creation-metadata; project-creation-limits; foundation | Passou / contratos. Integração completa D1 + Dropbox remoto não executada. |
| CV-04 | Criação streaming, abort e retry | project-large-save; project-large-legacy-lifecycle; stream-watchdog; full Node | Passou / contratos. Parte dos testes é textual; sem upload remoto grande. |
| CV-05 | Reserva e publicação concorrentes | 12 novos casos com SQLite real + 5 mutantes | Passou. Interleavings determinísticos selecionados, não prova exaustiva. |
| CV-06 | Salvamento e leitura do artefato | Golden round-trip em 6 revisões + atomic-save | Passou. Storage local-d1 e esquema real; sem disponibilidade remota. |
| CV-07 | Streaming e promoção legacy | Testes de save existentes + revisão dos callers/CAS | Passou / parcial. Proteção compartilhada exercitada; promoção legacy remota pendente. |
| CV-08 | Organização ativa e revogação | 4 novos testes SQL de organização; sequência 1/2/1 | Passou. Todos os endpoints autenticados ainda não exercitados remotamente. |
| CV-09 | GeoJSON versus documento | grant/revoke, filtragem, workspace alheio | Passou. Assert estático antigo de gestão da permissão falha na base (HP-01). |
| CV-10 | Preview protegido | test:preview-safety + assert-preview-safety | Passou. Nenhuma flag, exceção ou mutação remota habilitada. |
| CV-11 | Falhas de provider e recuperação | test:reliability; chaos; folder-safety | Passou. Timeout/429/5xx controlados; provider real não chamado. |
| CV-12 | Lease, budget e lifecycle | concurrency, recovery e drift existentes | Passou. Operador não ativado; storage físico pendente. |
| CV-13 | Readiness e caminhos protegidos | readiness, folder-safety e lifecycle | Passou. Migration 0009 histórica não reaplicada. |
| CV-14 | SLO e privacidade | test:reliability-slo; observability; ratchet | Passou / algoritmo. Não fecha janela nem amostra de SLO real. |
| CV-15 | Mapa, clusters e análises | foundation map-panels + round-trip | Passou / parcial. 3 testes antigos de clustering não carregam na suíte ampliada; pixels/tiles não aferidos. |
| CV-16 | Hidratação e navegação | foundation + loading browser | Passou. Sem mapa autenticado remoto. |
| CV-17 | Documentos, retry e resposta tardia | Playwright Chromium: 11/11 | Passou. Rotas mockadas somente no localhost; não são sessão QA. |
| CV-18 | Build e contrato de erros | npm run build; ratchet strict | Passou. Avisos de chunk permanecem; limites inalterados. |
| CV-19 | Change Requests | Testes existentes somente; sem flags/migrations | Parcial. Um assert estático antigo falha; funcionalidade não reativada. |

## Evidências e reprodução

| Execução | Resultado | Registro |
| --- | --- | --- |
| Foundation baseline | 796/796 passaram; 0 falharam | baseline-foundation.log |
| Foundation final | 812/812 passaram; 0 falharam | final-foundation.log |
| Reliability baseline | 184/184 passaram; 0 falharam | baseline-reliability.log |
| Reliability final | 184/184 passaram; 0 falharam | final-reliability.log |
| Regressões antes do fix | 0/5 passaram; 5 falharam | regressions-before.log |
| Regressões novas finais | 16/16 passaram; 0 falharam | new-regressions-final.log |
| Macro C | 4/4 passaram; 0 falharam | macro-c.log |
| Suíte Node ampliada — baseline | 1165/1174 passaram; 9 falharam | all-node-baseline.log |
| Suíte Node ampliada — corrigida | 1181/1190 passaram; 9 falharam | all-node-tests.log |
| Build | Passou | build.log |
| Browser Chromium | 11/11; 0 ignorados; 0 flaky | browser-results.json |
| Mutation testing seletivo | 5/5 eliminados por asserções | mutations.json |
| Ratchet de erros | Passou; 142 sinais mantidos | error-ratchet.log |
| Branch remota | Base sem drift antes do push | c0864514605b32ac6ff26605e9b35869ad19ed39 |

Contagens entre gates se sobrepõem. Não somar como testes únicos. [evidence.json](evidence.json) registra hashes dos logs. O JSON completo do Playwright é a evidência final de 11 casos; saídas textuais interrompidas foram preservadas, mas não contadas como aprovação.

```sh
npm run test:foundation-gate
npm run test:reliability
npm run test:macro-c-gate
npm run build
node --test tests/project-config-revision-concurrency.test.mjs tests/project-organization-isolation.test.mjs
node scripts/audit-revision-mutations.mjs
node scripts/audit-reliability-inventory.mjs
node node_modules/@playwright/test/cli.js test --project=chromium --reporter=json
node --experimental-strip-types --test tests/*.test.mjs scripts/audit-user-error-sinks.test.mjs
```

Para reproduzir antes do fix, use worktree descartável no SHA base, copie os testes novos da PR e execute o arquivo de concorrência. Não altere a base ou os gates para aceitar o resultado. Os cinco primeiros casos escritos falharam antes da edição dos módulos de produção.

## Falhas ampliadas presentes na base

- `geojson-organization-access`: assert estático SUPER_ADMIN_REQUIRED.
- `point-clustering-integration`: módulo point-cluster-count-layer.ts ausente.
- `point-clustering-policy`: export pointClusterLayerId ausente.
- `point-clustering-zoom`: export resolveVisibilityChanges ausente.
- `project-change-request-visualization-static`: marcador layer.visibility.update.
- `user-access-commercial`: três expectativas de textos comerciais/perfil personalizado.
- `user-management-evolution`: texto Editar usuário.

Mesmo conjunto de nove falhas em worktree limpa do SHA inicial. Nenhuma é declarada bug de produto apenas por esse resultado. Não foram apagadas, reescritas ou enfraquecidas.

## Riscos residuais e operação

- RECYCLE mantém exclusividade mesmo se a exclusão falhar ou a instância parar. Antes de qualquer recuperação manual: conferir HEAD canônico, ledger, checksum e existência/identidade do objeto, além de ausência de operação remota em voo. Não limpar marcador por timeout nem retroceder automaticamente para código antigo que ignora RECYCLE. Nenhum reparo remoto foi feito.
- Nove falhas ampliadas já existiam no SHA inicial: seis contratos estáticos e três imports antigos de clustering. Os gates oficiais executados passam, mas a suíte ampliada completa não está verde.
- Asserts de fonte e inventário estático não medem cobertura por linha nem execução de cada rota. Grandes uploads/legacy e namespaces remotos precisam de aceite operacional.
- Fidelidade aferida é de configuração e invariantes de algoritmo. Não houve comparação de pixels com tiles, GPU ou mapas reais autenticados.
- Runtime local Node 24.19; workflows usam Node 22. Dependências reutilizadas de instalação com package.json idêntico; nenhuma dependência foi atualizada. CI remoto terá evidência própria.
- Production, operadores, flags de Preview e Change Requests preservados. Nenhuma migration criada ou aplicada. Evidência histórica de 0009 não substitui confirmação atual de bindings e storage.
- Aceite de SLO exige observação real conforme runbook; testes do algoritmo e browser local não o encerram.

## Revisão e rollout

Mudança funcional e regressões em commit próprio; inventário, relatório e verificação seletiva em commit separado; um único push consolidado. Reutiliza test:project-revisions/foundation e Save contract validation. Nenhuma refatoração ampla ou atualização de dependência.

PR é entrega de código revisável. Deploy/Preview bem sucedido, quando disponível, não valida D1/Dropbox nem sessão autenticada. Não fazer rollback cego para código que ignora o bloqueio RECYCLE enquanto houver limpeza em voo ou marcador pendente.
