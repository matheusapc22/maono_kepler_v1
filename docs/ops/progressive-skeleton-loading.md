# Skeleton progressivo por região

## Escopo e inventário anterior à implementação

Base desta fase: `1ec6b11fef5cf70f9b8d206d459289ad62f8f60e`, após concluir a fase de Projects. PR draft #222, branch `fix/ticket-kanban-instant-status`, base `mano_kepler_v1`. Sem merge, produção, backend, banco, novas rotas ou mudanças nas permissões.

O inventário começou por `rg -l -i 'skeleton|shimmer' src` (22 arquivos) e foi cruzado com estados de carregamento e imports a partir de `main.tsx → App.tsx → Routes.tsx → route-modules.ts`. Nomes de arquivos sozinhos não foram usados para classificar código legado. Os componentes de administração denominados `AdminUserManagerLegacy` continuam ativos por import do wrapper.

| Região ativa | Fonte / composição | Dependências e tratamento |
| --- | --- | --- |
| Entrada Projects e Admin | `Routes.tsx`, `Projects.tsx`, `Admin.tsx`; `Skeleton.tsx` | Fallback de módulo/autenticação continua protegido. Um status externo; textos de estrutura mascarados enquanto módulo/autorização estão pendentes; controles dependentes de autorização não são antecipados. |
| Admin | `Admin.tsx`, `AdminUserManagerLegacy.tsx` | Projetos, usuários, organizações e acessos começam juntos. Cada resposta libera sua região; acesso é fallback de usuários apenas quando necessário. Cabeçalho, navegação e seções estáticas liberam no estágio de 80 ms, sem aguardar esses endpoints. |
| Todos, Recentes, Favoritos | `ProjectsSection.tsx`, `ProjectPagesUi.tsx`, `Projects.tsx` | Grade adaptada à página e área visível. Rodapé distingue total desconhecido e atualização. Cache válido não volta a Skeleton; falha transitória preserva o conteúdo, acesso negado limpa. |
| Prévia de projeto | `ProjectCard.tsx`, `ProjectCardSkeleton`, `Skeleton.css` | Texto, ações e metadados não aguardam a imagem. Placeholder e busy somente na mídia; cache decodificado e fallback de geração/imagem anterior preservados. |
| Organização | `OrganizationSection.tsx` | Um GET real fornece detalhes e métricas. Títulos/rótulos autorizados liberam aos 80 ms; perfil e métricas respeitam a prontidão real e a janela total de 260 ms. |
| Limites e Planos | `LimitsPlansSection.tsx` | Um GET fornece limites e solicitações. Formulário autorizado, rótulos e opções ficam montados; textos estáticos liberam aos 80 ms e valores/solicitações respeitam a janela total de 260 ms. Operação de envio mantém seu indicador próprio. |
| Usuários e Acessos | `UsersAccessSection.tsx → UsersAccessOverviewSection.tsx`, `ProjectSectionSkeletons.tsx` | Pessoas, limites e governança publicam independentemente. Controles dependentes de governança só aparecem com a resposta autorizada. Limite ausente é desconhecido, não estimativa apresentada como dado real. |
| Roadmap Gantt/Lista | `RoadmapSection.tsx`, `roadmap-workspace.css` | Índice → ID → bundle é dependência legítima, preservada. Filtros conhecidos, visualização, cabeçalhos e rodapé liberam aos 80 ms; bundle único libera seus valores/tarefas quando pronto após a janela total de 260 ms. |
| Documentos lista/grade/lixeira/pastas | `DocumentsSection.tsx`, `TicketLoadingSkeletons.tsx` | Pastas e arquivos carregam independentemente. Geometria acompanha o modo e página; contagens dependentes de facets não viram zero prematuro. Expansão preserva os itens existentes. |
| Central lista/Kanban/calendário | `TicketsSection.tsx`, `TicketListView.tsx`, `TicketKanbanBoard.tsx`, `TicketKanbanView.tsx`, `TicketCalendarView.tsx` | Rótulos e estrutura liberam aos 80 ms; métricas/linhas respeitam a janela inicial de 260 ms. Snapshot inicial é dependência real; filas subsequentes podem revelar suas respostas separadamente. Refresh conserva conteúdo com sinalização; expansão somente onde faltam itens. |
| Opcionais da Central | `TicketKnowledgePanel.tsx`, `TicketCasesPanel.tsx`, `TicketFeedbackPanel.tsx`, `TicketMetricsPanel.tsx`, `TicketExportsPanel.tsx` | Disponibilidade e autorização precedem qualquer domínio real. Unknown/off não exibem cartão pronto; enabled compartilha o mesmo relógio inicial da Central. Refresh mantém painel e foco. |
| Detalhe de chamado | `TicketDetailDrawer.tsx`, `TicketLoadingSkeletons.tsx` | Título/fechar mantêm os nomes acessíveis durante a máscara inicial; resumo pendente segue a geometria do detalhe. Status acessível externo e tratamento explícito de perda de acesso. |

### Ocorrências mantidas e exceções fundamentadas

- `ExportsSection.tsx`: contém os componentes compartilhados, mas não tem import/re-export consumidor em `src` nem rota ativa. O arquivo fica documentado como inativo, sem inventar integração.
- `projects.css`: os seletores antigos `.ticket-detail-loading`, `.ticket-view-skeleton` e `.roadmap-skeleton` não têm consumidor JSX ativo após a migração. Permanecem inertes para preservar os contratos históricos de fonte; não existe segunda animação de Skeleton ativa na interface.
- `DocumentsTransferPanel.css`: shimmer representa progresso de transferência, com reduced motion próprio. É operação, não placeholder de consulta. A atualização dos documentos não aguarda o progresso visual terminar.
- `LoadingProvider`, `LoadingOverlay`, `UniversalLoader`, boot, login/callback e transições para o mapa representam operações/autorização/readiness do canvas. Seus controles não foram substituídos por Skeleton.
- `ProjectMapPlaceholder`: geração da prévia do mapa mantém sua apresentação específica. A animação decorativa não oculta o texto pronto do projeto.
- `components/access/**`, os demais painéis auxiliares de tickets, dialogs de metadados e fluxos Kepler sem Skeleton conservam seus indicadores específicos. Conhecimento, Incidentes, Feedback, Métricas e Exportações foram incluídos na correção de disponibilidade descrita abaixo. O inventário não equivale a converter todo indicador da plataforma em Skeleton.
- `AdminFiles.tsx`, `AdminDropboxBrowser.tsx`, `pages/Login/index.tsx` e `AddDataSidebar.tsx` não têm import consumidor nas rotas vigentes. `/admin/files` redireciona para a administração de organizações.

## Ajuste explícito do contrato de apresentação

Após revisar o preview, o solicitante pediu que títulos e informações estáticas também participassem do carregamento e aparecessem antes dos dados variáveis, autorizando um pequeno atraso visual nestes últimos. Esse pedido substitui a regra anterior de revelar todo texto conhecido imediatamente e de não reter visualmente uma resposta rápida.

- Primeira carga sem cache válido: textos estáticos autorizados usam a sua geometria real como Skeleton por **80 ms**; o conteúdo variável tem uma janela mínima **total de 260 ms desde o início do pending**, não 260 ms depois da resposta.
- Respostas lentas que chegam após a janela aparecem assim que realmente prontas. Leituras continuam imediatas/paralelas, respeitando somente dependências reais.
- Os parâmetros são centralizados, configuráveis e limitados a 600 ms. Reduced motion elimina o atraso artificial. Erro, cancelamento ou perda de acesso encerram os gates imediatamente.
- Cache válido, refresh, filtro, ordenação e paginação da mesma região não repetem a sequência. O Kanban mantém seu isolamento de requests por consulta, mas o relógio e os cancelamentos visuais pertencem ao owner acima dos remounts. Os gates de apresentação não substituem estado de dados, autorização, query, controllers ou timers de operação.
- `StaticLoadingText` mantém o mesmo texto/elemento e nome acessível; a máscara é somente visual, não cria outro controle nem outra cópia acessível. Fallbacks de módulo/autorização não iniciam um segundo relógio decorativo.
- Subárvores já prontas que iniciam leituras dependentes permanecem montadas e ocultas somente durante a janela visual. As primeiras imagens visíveis de projetos têm uma exceção eager limitada pela geometria/página (máximo nove), evitando que a máscara atrase a rede; as demais preservam lazy loading.

## Base compartilhada e duas camadas

- `Skeleton.tsx` e `Skeleton.css` continuam sendo a implementação única: forma, cores, brilho, direção, duração, raio, transição e reduced motion.
- A estrutura conhecida e autorizada participa do estágio de 80 ms na primeira carga sem cache. Valores pendentes mantêm seus espaços reservados; dados prontos aguardam somente o restante da janela visual total de 260 ms. Cache e refresh preservam imediatamente a apresentação já revelada.
- A política anti-piscada mantém **reserva discreta imediata + ativação tardia do brilho**. O limiar de animação de 160 ms e o deslocamento visual de grupo são CSS, aplicados uma vez na entrada. A sequência 80/260 ms é uma política de apresentação separada, pedida posteriormente; não cria fila de requests nem espera um ciclo de animação.
- `useSkeletonCount.ts` calcula uma estimativa visual determinística, limitada por viewport/página/metadados e, quando disponível, geometria computada da região. Listener e ResizeObserver são removidos no cleanup. Quantidade estimada nunca é apresentada como total de registros.
- `LoadingStatus` oferece uma mensagem por região, fora do `aria-busy`, e indicação prolongada após oito segundos. Nos rodapés com live region existente, não cria um segundo anúncio. Seu timer é cancelado ao concluir/desmontar.
- `region-loading-policy.ts` contém utilidades de contagem, classificação descritiva de estado e identificação de perda de acesso. As transições reais continuam nos controllers existentes, com suas dependências e guards; testes isolados desses utilitários não substituem os testes de fluxo.
- Refresh mantém conteúdo ainda válido, marcado como atualização. Erros transitórios preservam dados; 401/403 e perda de contexto descartam dados/seleções incompatíveis. Respostas antigas não podem recolocá-los. Falhas encerram placeholders; sucesso vazio permanece distinto de pending.
- Nenhum timer controla a prontidão real dos dados. `initial-loading-presentation.ts` e `useInitialLoadingPresentation.ts` controlam apenas os dois prazos visuais, com cleanup e rejeição de callbacks antigos. Não há atualizações por quadro. Reduced motion usa placeholders estáticos sem atraso simulado. Skeletons dinâmicos são decorativos, `aria-hidden`, não editáveis e fora da ordem de foco; textos conhecidos mantêm seus nomes acessíveis durante a máscara visual.

## Correção do flash de painéis opcionais da Central

A reprodução no aplicativo compilado identificou uma apresentação prematura de cinco painéis antes da resposta de disponibilidade. Conhecimento e Incidentes tinham `background: #fff`; o branco apareceu por aproximadamente 16 ms em navegação normal e por 307 ms com CPU/recursos atrasados. O comportamento foi reproduzido nos três motores em desktop e mobile. Os estilos já estavam carregados antes do clique: não era CSS lazy nem a animação do Skeleton.

Os painéis agora só apresentam seus controles de domínio depois de `enabled: true` confirmado. Estado desconhecido/desabilitado não simula um cartão pronto. Falhas permanecem visíveis, com retry da própria consulta, e perda de acesso/contexto descarta o estado incompatível. `TicketOptionalPanelState.tsx` compartilha a apresentação de falha; Conhecimento e Incidentes usam os tokens escuros/dourados existentes quando efetivamente habilitados. Os cinco painéis recebem a mesma etapa visual inicial da Central, sem relógios próprios: disponibilidade é confirmada antes de qualquer interface pronta, títulos liberam primeiro e os corpos continuam montados enquanto ocultos. Um erro local cancela definitivamente o restante da retenção; retry não a reinicia. Flags, configuração, endpoints, payloads e backend não mudaram.

A disponibilidade confirmada foi separada do payload temporário: refresh não desmonta `details`, nem perde seu estado aberto. Os dois botões manuais de consulta de Feedback/Métricas restauram somente foco realmente perdido ao ficarem desabilitados, sem roubar foco após outra interação, navegação, revogação ou remoção do alvo. A reserva de pastas no contexto de densidade inclui os dois pixels de borda do cartão real.

## Preservação e evidências

Os hashes originais de contratos não foram recalculados para aceitar mudanças. Inversas exatas, com substituição única, isolam os deltas de carregamento antes de verificar as baselines históricas. Canários continuam rejeitando mudanças em endpoints, payloads, permissões, opções e destinos. Os testes de leitura exercitam publicação independente, supersessão e falhas, além dos contratos de fonte.

Os testes de navegador usam o aplicativo **compilado** e respostas HTTP sintéticas interceptadas, nos três motores. Não são validação de requisições reais autenticadas nem aceite de produção. Não são usados dados, contas ou writes reais de usuários. O preview público só comprova que o login serve o bundle publicado.

### Registro final de validação

- **2.520/2.520 testes Node** no agregado completo; nenhum skip. Os subconjuntos não são somados novamente.
- Typecheck e build compilado aprovados; ratchet estrito idêntico à baseline. Nenhuma alteração em backend, migrations, dependências ou lockfile. Os hashes de todas as fontes de produção e dos assets compilados foram conferidos depois dos retestes.
- Lint de **41 arquivos focados**, sem erros, com **oito warnings preexistentes**: um do TaskDrawer e sete dos painéis opcionais. Todos foram comparados com `baf3637`. O erro preexistente de React Refresh em `Projects.tsx` permanece documentado, sem ser introduzido nem suprimido por esta fase.
- **588 combinações distintas de cenário/motor**, reconciliadas por arquivo, título e motor contra o inventário atual de testes, sem ausência ou resultado final pendente. O aplicativo de produção permaneceu idêntico durante os retestes. As primeiras medições revelaram seis falhas de fixture (origem do relógio/barreiras HTTP, comparação entre coordenadas com precisão diferente, scroll mobile e seletor ambíguo). Os testes passaram a medir o mesmo referencial e aguardar eventos reais; nenhuma tolerância, asserção de domínio ou condição de aplicação foi relaxada. As duas suítes afetadas foram repetidas por inteiro (**189/189**); os módulos opcionais passaram **81/81**; a continuação WebKit concluiu **48/48**. Esses números são partes/repetições da matriz, não cobertura adicional.
- **131 regressões amplas em Chromium** no mesmo bundle: Documentos (79), Central (46) e seletor da Central (6). As falhas transitórias usam 503; 401/403 exigem limpeza de dados. As verificações existentes de foco, cursor, ordenação, mutação e controle de acesso foram preservadas.
- As cinco fixtures de geometria de `StaticLoadingText` foram verificadas com o CSS real em Chromium, Firefox e WebKit (**15/15**, verificações adicionais de geometria, fora da matriz acima). O texto mascarado conserva largura, altura e semântica; seletores legados de badges não alteram suas dimensões.
- **Sete capturas finais** inspecionadas: Projects inicial, equipe parcialmente pronta, imagem isoladamente pendente, Documentos mobile, refresh do Roadmap, estrutura liberada aos 80 ms e Central sem cards prematuros. As cinco evidências anteriores foram atualizadas preservando a identidade; duas novas documentam o complemento. São anexos nativos na entrega ao solicitante, não dados ou requisições autenticadas reais.
- Os resultados de **CI para o SHA publicado**, incluindo as regressões amplas nos três motores e o preview público, são registrados no corpo da PR depois de cada gate terminar. Não se deve atribuir a um SHA resultados de outro. O head anterior `baf3637` concluiu 31/31 checks e 14/14 workflows; esses resultados não substituem o CI do complemento.

| Suíte local progressiva/regional | Cenários por motor | Chromium + Firefox + WebKit |
| --- | ---: | ---: |
| Admin progressivo | 13 | 39 |
| Projects / imagem progressivos | 15 | 45 |
| Organização / Limites / carregamento de equipe | 34 | 102 |
| Usuários e Acessos, regressões completas | 28 | 84 |
| Roadmap progressivo | 11 | 33 |
| Roadmap, regressões completas | 20 | 60 |
| Documentos / Central progressivos | 48 | 144 |
| Opcionais da Central / prevenção de flash | 27 | 81 |
| **Total distinto** | **196** | **588** |

A cobertura inclui carga rápida/lenta, fases 79/80/259/260 ms, configuração limitada, reduced motion, cache/reentrada, refresh, paginação/filtros, erro/retry sem nova retenção, cancelamento/unmount, callbacks fora de ordem, troca de organização e 401/403, respostas independentes, imagens, expansão, foco/seleção/rolagem, geometria desktop/mobile e quantidade responsiva. O scheduler é testado também com callback antecipado e rearmamento: o arredondamento dos prazos não deixa um gate preso nem aceita callback de outra geração.

A nova configuração `playwright.progressive-loading.config.ts` e o workflow `Progressive Loading` executam o aplicativo compilado nos três motores. Os gates existentes de Users/Projects, Roadmap, Documentos, Central e Project Pages continuam ativos, sem remover verificações.

### Limite da comprovação integrada

Os atrasos, falhas, revogações, escritas de teste e respostas fora de ordem são **fixtures HTTP sintéticas**. Abertura do login público no preview comprova publicação/serving, não autenticação nem aceite real de produção. Uma janela de aceite autenticado continua sujeita ao processo humano já previsto no repositório.

## Arquivos de produção ajustados nesta fase

- `src/components/loading/Skeleton.css`
- `src/components/loading/Skeleton.tsx`
- `src/components/loading/index.ts`
- `src/components/loading/initial-loading-presentation.ts`
- `src/components/loading/region-loading-policy.ts`
- `src/components/loading/useInitialLoadingPresentation.ts`
- `src/components/loading/useSkeletonCount.ts`
- `src/pages/Admin.tsx`
- `src/pages/Admin/components/AdminUserManagerLegacy.tsx`
- `src/pages/Projects.tsx`
- `src/pages/Projects/components/DocumentsPagination.tsx`
- `src/pages/Projects/components/DocumentsSection.tsx`
- `src/pages/Projects/components/DocumentsUi.tsx`
- `src/pages/Projects/components/LimitsPlansSection.tsx`
- `src/pages/Projects/components/OrganizationSection.tsx`
- `src/pages/Projects/components/ProjectCard.tsx`
- `src/pages/Projects/components/ProjectPagesUi.tsx`
- `src/pages/Projects/components/ProjectSectionSkeletons.tsx`
- `src/pages/Projects/components/ProjectsSection.tsx`
- `src/pages/Projects/components/RoadmapSection.tsx`
- `src/pages/Projects/components/TicketCalendarView.tsx`
- `src/pages/Projects/components/TicketCasesPanel.tsx`
- `src/pages/Projects/components/TicketDetailDrawer.tsx`
- `src/pages/Projects/components/TicketExportsPanel.tsx`
- `src/pages/Projects/components/TicketFeedbackPanel.tsx`
- `src/pages/Projects/components/TicketKanbanBoard.tsx`
- `src/pages/Projects/components/TicketKanbanView.tsx`
- `src/pages/Projects/components/TicketKnowledgePanel.tsx`
- `src/pages/Projects/components/TicketListView.tsx`
- `src/pages/Projects/components/TicketLoadingSkeletons.css`
- `src/pages/Projects/components/TicketLoadingSkeletons.tsx`
- `src/pages/Projects/components/TicketMetricsPanel.tsx`
- `src/pages/Projects/components/TicketOptionalPanelState.tsx`
- `src/pages/Projects/components/TicketsSection.tsx`
- `src/pages/Projects/components/TicketsToolbar.tsx`
- `src/pages/Projects/components/UsersAccessOverviewSection.tsx`
- `src/pages/Projects/components/roadmap-workspace.css`
- `src/pages/Projects/components/ticket-cases.css`
- `src/pages/Projects/components/ticket-knowledge.css`
- `src/pages/Projects/components/ticket-optional-panel-state.css`
- `src/pages/Projects/components/useManualRefreshFocus.ts`
- `src/pages/Projects/components/useTicketOptionalPresentation.ts`
- `src/pages/ProjectsSidebar.tsx`

A inspeção visual também identificou o layout amplo do painel Admin legado. Ele vem de regras preexistentes de `fallback-ui-styles.ts`; não foi redesenhado nesta tarefa. As novas composições preservam essa apresentação final.
