# Skeleton progressivo por região

## Escopo e inventário anterior à implementação

Base desta fase: `1ec6b11fef5cf70f9b8d206d459289ad62f8f60e`, após concluir a fase de Projects. PR draft #222, branch `fix/ticket-kanban-instant-status`, base `mano_kepler_v1`. Sem merge, produção, backend, banco, novas rotas ou mudanças nas permissões.

O inventário começou por `rg -l -i 'skeleton|shimmer' src` (22 arquivos) e foi cruzado com estados de carregamento e imports a partir de `main.tsx → App.tsx → Routes.tsx → route-modules.ts`. Nomes de arquivos sozinhos não foram usados para classificar código legado. Os componentes de administração denominados `AdminUserManagerLegacy` continuam ativos por import do wrapper.

| Região ativa | Fonte / composição | Dependências e tratamento |
| --- | --- | --- |
| Entrada Projects e Admin | `Routes.tsx`, `Projects.tsx`, `Admin.tsx`; `Skeleton.tsx` | Fallback de módulo/autenticação continua protegido. Um status externo; chrome público conhecido real; controles dependentes de autorização não são antecipados. |
| Admin | `Admin.tsx`, `AdminUserManagerLegacy.tsx` | Projetos, usuários, organizações e acessos começam juntos. Cada resposta libera sua região; acesso é fallback de usuários apenas quando necessário. Cabeçalho, navegação e seções estáticas não aguardam esses endpoints. |
| Todos, Recentes, Favoritos | `ProjectsSection.tsx`, `ProjectPagesUi.tsx`, `Projects.tsx` | Grade adaptada à página e área visível. Rodapé distingue total desconhecido e atualização. Cache válido não volta a Skeleton; falha transitória preserva o conteúdo, acesso negado limpa. |
| Prévia de projeto | `ProjectCard.tsx`, `ProjectCardSkeleton`, `Skeleton.css` | Texto, ações e metadados não aguardam a imagem. Placeholder e busy somente na mídia; cache decodificado e fallback de geração/imagem anterior preservados. |
| Organização | `OrganizationSection.tsx` | Um GET real fornece detalhes e métricas. Títulos, rótulos, perfil e nome de sessão disponíveis são reais; apenas valores desconhecidos ficam provisórios. |
| Limites e Planos | `LimitsPlansSection.tsx` | Um GET fornece limites e solicitações. Formulário autorizado, rótulos e opções ficam montados; valores e solicitações têm placeholder. Operação de envio mantém seu indicador próprio. |
| Usuários e Acessos | `UsersAccessSection.tsx → UsersAccessOverviewSection.tsx`, `ProjectSectionSkeletons.tsx` | Pessoas, limites e governança publicam independentemente. Controles dependentes de governança só aparecem com a resposta autorizada. Limite ausente é desconhecido, não estimativa apresentada como dado real. |
| Roadmap Gantt/Lista | `RoadmapSection.tsx`, `roadmap-workspace.css` | Índice → ID → bundle é dependência legítima, preservada. Filtros conhecidos, visualização, cabeçalhos e rodapé ficam reais; bundle único libera seus valores/tarefas. |
| Documentos lista/grade/lixeira/pastas | `DocumentsSection.tsx`, `TicketLoadingSkeletons.tsx` | Pastas e arquivos carregam independentemente. Geometria acompanha o modo e página; contagens dependentes de facets não viram zero prematuro. Expansão preserva os itens existentes. |
| Central lista/Kanban/calendário | `TicketsSection.tsx`, `TicketListView.tsx`, `TicketKanbanBoard.tsx`, `TicketKanbanView.tsx`, `TicketCalendarView.tsx` | Métricas/linhas têm rótulos reais. Snapshot inicial é dependência real; filas subsequentes podem revelar suas respostas separadamente. Refresh conserva conteúdo com sinalização; expansão somente onde faltam itens. |
| Detalhe de chamado | `TicketDetailDrawer.tsx`, `TicketLoadingSkeletons.tsx` | Título/fechar continuam reais; resumo pendente segue geometria do detalhe. Status acessível externo e tratamento explícito de perda de acesso. |

### Ocorrências mantidas e exceções fundamentadas

- `ExportsSection.tsx`: contém os componentes compartilhados, mas não tem import/re-export consumidor em `src` nem rota ativa. O arquivo fica documentado como inativo, sem inventar integração.
- `projects.css`: os seletores antigos `.ticket-detail-loading`, `.ticket-view-skeleton` e `.roadmap-skeleton` não têm consumidor JSX ativo após a migração. Permanecem inertes para preservar os contratos históricos de fonte; não existe segunda animação de Skeleton ativa na interface.
- `DocumentsTransferPanel.css`: shimmer representa progresso de transferência, com reduced motion próprio. É operação, não placeholder de consulta. A atualização dos documentos não aguarda o progresso visual terminar.
- `LoadingProvider`, `LoadingOverlay`, `UniversalLoader`, boot, login/callback e transições para o mapa representam operações/autorização/readiness do canvas. Seus controles não foram substituídos por Skeleton.
- `ProjectMapPlaceholder`: geração da prévia do mapa mantém sua apresentação específica. A animação decorativa não oculta o texto pronto do projeto.
- `components/access/**`, painéis auxiliares de tickets, dialogs de metadados e fluxos Kepler sem Skeleton conservam seus indicadores específicos. Esta fase padroniza as ocorrências de Skeleton/Shimmer inventariadas, não redesenha todos os indicadores da plataforma.
- `AdminFiles.tsx`, `AdminDropboxBrowser.tsx`, `pages/Login/index.tsx` e `AddDataSidebar.tsx` não têm import consumidor nas rotas vigentes. `/admin/files` redireciona para a administração de organizações.

## Base compartilhada e duas camadas

- `Skeleton.tsx` e `Skeleton.css` continuam sendo a implementação única: forma, cores, brilho, direção, duração, raio, transição e reduced motion.
- A estrutura conhecida e autorizada aparece imediatamente. Somente seus valores realmente pendentes recebem placeholders. Esses espaços estão reservados no primeiro render.
- A política anti-piscada é **reserva estática discreta imediata + ativação tardia do brilho**. O limiar padrão de 160 ms e o pequeno deslocamento visual de grupo são CSS, aplicados uma vez na entrada. Não há mínimo obrigatório de exibição, fila de requests ou espera por ciclo para liberar dados.
- `useSkeletonCount.ts` calcula uma estimativa visual determinística, limitada por viewport/página/metadados e, quando disponível, geometria computada da região. Listener e ResizeObserver são removidos no cleanup. Quantidade estimada nunca é apresentada como total de registros.
- `LoadingStatus` oferece uma mensagem por região, fora do `aria-busy`, e indicação prolongada após oito segundos. Nos rodapés com live region existente, não cria um segundo anúncio. Seu timer é cancelado ao concluir/desmontar.
- `region-loading-policy.ts` contém utilidades de contagem, classificação descritiva de estado e identificação de perda de acesso. As transições reais continuam nos controllers existentes, com suas dependências e guards; testes isolados desses utilitários não substituem os testes de fluxo.
- Refresh mantém conteúdo ainda válido, marcado como atualização. Erros transitórios preservam dados; 401/403 e perda de contexto descartam dados/seleções incompatíveis. Respostas antigas não podem recolocá-los. Falhas encerram placeholders; sucesso vazio permanece distinto de pending.
- Nenhum timer ou atualização por quadro controla a prontidão. Reduced motion usa placeholders estáticos. Cada placeholder é decorativo, `aria-hidden`, não editável e fora da ordem de foco.

## Preservação e evidências

Os hashes originais de contratos não foram recalculados para aceitar mudanças. Inversas exatas, com substituição única, isolam os deltas de carregamento antes de verificar as baselines históricas. Canários continuam rejeitando mudanças em endpoints, payloads, permissões, opções e destinos. Os testes de leitura exercitam publicação independente, supersessão e falhas, além dos contratos de fonte.

Os testes de navegador usam o aplicativo **compilado** e respostas HTTP sintéticas interceptadas, nos três motores. Não são validação de requisições reais autenticadas nem aceite de produção. Não são usados dados, contas ou writes reais de usuários. O preview público só comprova que o login serve o bundle publicado.

### Registro final de validação

- **2.458/2.458 testes Node** no agregado completo; nenhum skip. Os subconjuntos não são somados novamente.
- Typecheck e build compilado aprovados; ratchet estrito idêntico à baseline. Nenhuma alteração em backend, migrations, dependências ou lockfile.
- Lint de 32 arquivos focados sem erros; permanece o warning já existente do efeito de TaskDrawer. O erro preexistente de React Refresh no arquivo `Projects.tsx` foi comparado com `1ec6b11` e não foi introduzido por esta fase. A supressão TypeScript desnecessária do Admin e os seus dois erros anteriores de lint foram removidos com tipos explícitos.
- **390 combinações distintas de cenário/motor** na matriz progressiva/regional abaixo. A rodada inicial concluiu 363 cenários fora de Admin; após corrigir duas suposições de fixture (fallback transitório e guard de acesso já existente), todo o Admin foi reexecutado, **27/27**. O último rebuild contém somente limpeza de tipos/lint do Admin em relação à matriz inicial; a suíte inteira do Admin e as cinco capturas foram repetidas nele. Nenhum resultado duplicado é contado como cobertura adicional.
- **131 regressões amplas em Chromium**: Documentos (79), Central (46) e seletor da Central (6). Os modelos antigos que usavam 403 como falha transitória foram separados: os dois testes de retenção/retry usam e verificam 503; 401/403 continuam exigindo limpeza dos dados. A última expectativa de contador fictício foi corrigida e o caso de revogação/restauração passou nos **três motores**. Demais verificações de foco, cursor, ordenação e mutação foram preservadas.
- Cinco capturas finais inspecionadas, com **5/5** execuções aprovadas no bundle final: estrutura de Projects, equipe parcialmente pronta, imagem isoladamente pendente, Documentos mobile e conteúdo preservado no refresh do Roadmap. Essas repetições não são somadas aos cenários distintos.
- Os resultados de **CI para o SHA publicado**, incluindo as regressões amplas nos três motores e o preview público, são registrados no corpo da PR depois de cada gate terminar. Não se deve atribuir a um SHA resultados de outro.

| Suíte local progressiva/regional | Cenários por motor | Chromium + Firefox + WebKit |
| --- | ---: | ---: |
| Admin progressivo | 9 | 27 |
| Projects / imagem progressivos | 10 | 30 |
| Organização / Limites / carregamento de equipe | 25 | 75 |
| Usuários e Acessos, regressões completas | 28 | 84 |
| Roadmap progressivo | 8 | 24 |
| Roadmap, regressões completas | 20 | 60 |
| Documentos / Central progressivos | 30 | 90 |
| **Total distinto** | **130** | **390** |

A nova configuração `playwright.progressive-loading.config.ts` e o workflow `Progressive Loading` executam o aplicativo compilado nos três motores. Os gates existentes de Users/Projects, Roadmap, Documentos, Central e Project Pages continuam ativos, sem remover verificações.

### Limite da comprovação integrada

Os atrasos, falhas, revogações, escritas de teste e respostas fora de ordem são **fixtures HTTP sintéticas**. Abertura do login público no preview comprova publicação/serving, não autenticação nem aceite real de produção. Uma janela de aceite autenticado continua sujeita ao processo humano já previsto no repositório.

## Arquivos de produção ajustados nesta fase

- `src/components/loading/Skeleton.css`
- `src/components/loading/Skeleton.tsx`
- `src/components/loading/index.ts`
- `src/components/loading/region-loading-policy.ts`
- `src/components/loading/useSkeletonCount.ts`
- `src/pages/Admin.tsx`
- `src/pages/Admin/components/AdminUserManagerLegacy.tsx`
- `src/pages/Projects.tsx`
- `src/pages/Projects/components/DocumentsSection.tsx`
- `src/pages/Projects/components/LimitsPlansSection.tsx`
- `src/pages/Projects/components/OrganizationSection.tsx`
- `src/pages/Projects/components/ProjectCard.tsx`
- `src/pages/Projects/components/ProjectPagesUi.tsx`
- `src/pages/Projects/components/ProjectSectionSkeletons.tsx`
- `src/pages/Projects/components/ProjectsSection.tsx`
- `src/pages/Projects/components/RoadmapSection.tsx`
- `src/pages/Projects/components/TicketCalendarView.tsx`
- `src/pages/Projects/components/TicketDetailDrawer.tsx`
- `src/pages/Projects/components/TicketKanbanBoard.tsx`
- `src/pages/Projects/components/TicketKanbanView.tsx`
- `src/pages/Projects/components/TicketListView.tsx`
- `src/pages/Projects/components/TicketLoadingSkeletons.css`
- `src/pages/Projects/components/TicketLoadingSkeletons.tsx`
- `src/pages/Projects/components/TicketsSection.tsx`
- `src/pages/Projects/components/UsersAccessOverviewSection.tsx`
- `src/pages/Projects/components/roadmap-workspace.css`
- `src/pages/ProjectsSidebar.tsx`

A inspeção visual também identificou o layout amplo do painel Admin legado. Ele vem de regras preexistentes de `fallback-ui-styles.ts`; não foi redesenhado nesta tarefa. As novas composições preservam essa apresentação final.
