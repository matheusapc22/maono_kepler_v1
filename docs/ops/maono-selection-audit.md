# Auditoria de filtros e seletores Maõno

Data: 2026-10-04. Base de código: `be531dea28ce6a0b7a36a10028ad58777714bc36` (PR #221 já integrada).

## Resultado e limites do inventário

A busca estática de todas as declarações JSX de `select` em `src`, cruzada com as rotas/imports, encontrou **93 controles em 31 arquivos**: **88 declarações alcançáveis no aplicativo em 29 arquivos**, **2 em `ExportsSection.tsx` sem import atual**, e **3 no antigo `AdminFiles.tsx`**, que não tem import de produção. **90 declarações foram migradas em 30 arquivos**: as 88 alcançáveis e, preventivamente, as 2 de `ExportsSection.tsx`. A verificação de alcance percorreu os imports relativos desde `src/main.tsx` (378 arquivos alcançados), além da inspeção das rotas. Os números contam declarações no código, não cada instância gerada por listas, nem os controles internos da biblioteca Kepler.

Também foram auditados dropdowns/listboxes customizados, filtros de busca/data/faixa, checklists, radios e modais relacionados. Não se afirma que todas as combinações de dados, permissões, hardware ou tecnologia assistiva foram exercitadas em navegador.

- O componente compartilhado controla tanto a face quanto o menu aberto: superfície dark, borda e destaque dourados, seleção marcada, nomes longos com quebra, rolagem limitada e chevron único que gira no centro.
- O `select` real continua visível e é o único controle focável. `value`, `defaultValue`, `name`, `form`, `required`, `disabled`, refs, labels, opções e os handlers nativos de `change` permanecem. O popup é um listbox DOM em popover/portal dentro da fronteira do modal, com Esc, Tab, Shift+Tab, setas, Home/End/PageUp/PageDown, F4, busca por digitação e clique fora.
- A troca mecânica não altera regras de filtros, APIs, backend, papéis, permissões ou persistência. Os handlers só recebem a mesma alteração do controle nativo; abrir, navegar e cancelar não enviam mudanças.

## Cobertura por área

| Área ou componente | Declarações migradas | Arquivos e controles |
| --- | ---: | --- |
| Projetos: Todos, Recentes e Favoritos, em `/projects` | 3 | `ProjectPagesUi.tsx`: status, ordem e itens por página; componente compartilhado pelas três seções |
| Arquivos e Documentos | 5 | `DocumentsSection.tsx` (4: tipo, projeto, pasta, ordem); `DocumentsPagination.tsx` (1: itens por página), também usado pela Central |
| Central de Chamados e subpainéis | 42 | `TicketsToolbar.tsx` (5), `TicketKanbanView.tsx` (1), `TicketCasesPanel.tsx` (9), `TicketTriageFields.tsx` (3), `NewTicketPopover.tsx` (3), `TicketDetailDrawer.tsx` (4), `TicketLifecyclePanel.tsx` (4), `TicketKnowledgePanel.tsx` (5), `TicketFeedbackPanel.tsx` (3), `TicketSlaPanel.tsx` (1), `TicketExportsPanel.tsx` (3), `TicketChanges.tsx` (1) |
| Roadmap | 9 | `RoadmapSection.tsx`: roadmap, status, fase, responsável, escala e quatro campos do drawer; o layout desta seção é uma mudança coordenada separadamente |
| Usuários e Acessos | 2 | `UsersAccessOverviewSection.tsx`: situação e perfil |
| Modais compartilhados de acesso | 2 | `OrganizationPermissionManager.tsx`: pessoa; `ProjectMapAccessManager.tsx`: rota Viewer/Editor por projeto |
| Limites e Planos | 2 | `LimitsPlansSection.tsx`: tipo de solicitação e plano solicitado |
| Exportações antigas, sem import atual | 2 | `ExportsSection.tsx`: filtros de formato e situação |
| Administração, `/admin` | 7 | `AdminUserManagerLegacy.tsx`: filtros, edição, perfil na organização e cadastro. É montado pelo wrapper atual, apesar do nome Legacy |
| Mapa/Kepler e solicitações de alteração | 16 | `LayerStyleEditor.tsx` (6), `LayerInspector.tsx` (2), `FilterPanel.tsx` (2), `FilterDetailView.tsx` (2), `BufferDialog.tsx` (1), `IsochroneDialog.tsx` (1), `PointFromPinWorkflow.tsx` (1), `EditorRequestInboxPage.tsx` (1) |
| **Total migrado** | **90** | **30 arquivos: 88 declarações alcançáveis + 2 legadas** |

Os componentes de Projects estão em `src/pages/Projects/components/`; os de administração em `src/pages/Admin/components/`; os de mapa em `src/pages/Kepler/components/` e `src/pages/Kepler/change-requests/`; os de acesso em `src/components/access/`.

## Controles já temáticos, preservados

- `OrganizationWorkspaceSwitcher`: busca, listbox, opções e portal já dark/gold, com teclado e estados ativo/desabilitado.
- `ProjectActionsMenu`, menus de documentos, seletor de pastas no diálogo Mover, menus de camadas e ações do mapa: menus DOM já com tokens Maõno e foco próprio; não foram reconstruídos.
- Kepler de terceiros: dropdowns DOM/styled-components já recebem `maono-kepler-theme.ts` e seus tokens gold. Cores de dados, paletas e cores semânticas não foram substituídas por dourado.
- Editor categórico do mapa: checklist customizado, histogramas e handles de faixa já temáticos. O seletor booleano nativo recebeu `accent-color` dourado.
- Organização: resumo read-only, sem select editável. O seletor de contexto fica no componente de organização acima.
- Busca, datas e paginação de Projetos/Documentos já tinham faces dark e foco temático; sua lógica não foi alterada.

## Lacunas adicionais corrigidas

- O select Viewer/Editor em `.org-permission-option` não estava coberto pela regra que estiliza apenas `.org-permission-target select`. Agora usa a face e o menu compartilhados; o modal também recebe foco gold e checks/radios com accent Maõno.
- Busca em Usuários e Acessos e campos do diálogo de ponto do mapa tinham foco/cor do navegador sem a mesma cobertura. Correções são restritas a esses escopos em `maono-filter-controls.css`.
- Selects de Adicionar filtro, formulários de limites, diálogos de buffer/isócrona e inbox de alterações passam a ter a mesma face/menu. Datas/datetime nas superfícies auditadas recebem `color-scheme: dark` onde faltava.
- O QA visual compilado detectou ainda o injetor legado `fallback-ui-styles.ts`, cujo `#root` e cores brancas `!important` venciam as regras locais, inclusive o `-webkit-text-fill-color`. Overrides são restritos a `MaonoSelect` nas três raízes afetadas (Admin, Inbox e Review), mais busca e data de delegação do Admin; o injetor e as demais regras de layout ficam intactos. A regressão verifica cor computada, text-fill, layout grid e screenshot, não somente `appearance`.
- O perfil por organização no Admin usava um select transparente sobre uma superfície inserida por MutationObserver. O wrapper não cria essa superfície para `MaonoSelect`; overrides específicos removem a aparência nativa residual e preservam o estado desabilitado. Não há dupla seta nem mudança na API de permissões.
- Foi verificada a inexistência de seletores CSS de consumidores do tipo `> select` que perderiam o alvo com o wrapper, e auditados `appearance`, `opacity`, backgrounds e estilos inline relacionados. A exceção de aparência do Admin foi corrigida explicitamente.

## Exceções fundamentadas

1. **Componentes sem import atual:** `ExportsSection.tsx` teve seus 2 controles migrados preventivamente, sem reativar a tela. **`src/pages/AdminFiles.tsx`: 3 selects legados, não migrados.** `/admin/files` redireciona para `/admin?section=organizations`; o arquivo só tem consumidor em fixture antigo de testes. O teste de cobertura impede reintroduzi-lo por import de produção sem revisar essa exceção. Não se declara essa tela órfã visualmente padronizada.
2. **Calendário/data/datetime, seletor de arquivos e de cor do sistema:** as faces DOM são tematizadas quando aplicável; a janela/picker do sistema operacional continua sob controle do navegador. Não se promete popup gold nesses controles. Sliders e radios conservam sua semântica nativa.
3. **`select multiple` ou `size > 1`:** o componente conserva a lista nativa para não perder seleção múltipla; não há tal declaração em consumidor ativo hoje. A compatibilidade está coberta por fixture.
4. **Tecnologia assistiva física e aparelhos reais:** verificaram-se nomes/roles/estado focado via navegador e interações desktop/touch em emulação. Não foi feita validação manual com NVDA, JAWS, VoiceOver ou dispositivo iOS/Android real.

## Verificações

- `tests/maono-select-migration.test.mjs`: **30/30**. Inclui hashes SHA-256 de 27 consumidores após reverter exclusivamente import/tags da extração visual; protege todas as demais linhas de domínio, opções, handlers e permissões. O teste de inventário impede novos selects ativos não auditados.
- Subconjunto anterior com os guards existentes de Projects/organização: **78/78**; o guard adicional do fallback é incluído no gate final. As normalizações antigas continuam; a única normalização nova reverte import/tag do controle.
- `tests/browser/maono-select.spec.ts`: **35/35** em Chromium, Firefox e WebKit desktop, Chromium mobile e WebKit mobile. Mouse/teclado, um único change, cancelamento, disabled, required, `name`/`form`, reset não controlado, ref, alteração controlada externa, lista vazia, optgroup desabilitado, nomes longos, rolagem, viewport e popover em diálogo nativo, desabilitação herdada de fieldset durante abertura, retorno de enabled sem reabertura indevida, troca assíncrona de opções, unmount e ativação repetida.
- Central em rota React real: **18/18 em Vite dev**, cobrindo três engines, touch, teclado, focus/Esc, mesmos SVGs, filtros e parâmetros. O gate final usa também o aplicativo compilado.
- Typecheck passou; lint do novo componente e dos novos testes passou sem erros. Os erros de Fast Refresh já existentes em `OrganizationPermissionManager.tsx` e `Projects.tsx` são anteriores à migração.
- CI dedicado: `.github/workflows/maono-selectors.yml`. Os gates de Projects, Documentos e Central também observam alterações no componente compartilhado.
- QA compilado final de consumidores representativos no asset `index-BsJ4M0Fp.js`: **14 cenários distintos passaram**. Projetos (Todos/Recentes/Favoritos e paginação), Documentos (filtros e paginação), Admin (filtro e perfil por organização) e Inbox (filtro de situação) passaram em Chromium, Firefox e WebKit; o filtro do mapa passou em Chromium e WebKit. As capturas finais de Admin, mapa, Inbox, Documentos desktop/mobile e Projetos mobile foram inspecionadas.
- **Limitação local explícita:** o 15º cenário, mapa em Firefox headless, parou antes de abrir o painel porque o ambiente não criou WebGL (`FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`). Não é registrado como aprovação desse fluxo. O teste continua sem skip no gate de Project Pages, que usa Firefox com tela virtual/headed; o resultado remoto deve ser conferido na PR.
- O helper de Inbox foi corrigido para navegar diretamente à sua rota: iniciar Admin e interrompê-lo imediatamente com outro `page.goto` gerava cancelamentos de preload/API no teste. Repetição isolada da rota correta: **3/3**, sem ignorar erros de console. Nenhum source de aplicação foi alterado para esse ajuste do teste.
- Build integrado e agregado de domínio são reportados separadamente na PR pelo publicador; não se usa Vite dev como substituto do gate compilado.

Todos os cenários de navegador usam dados e respostas HTTP sintéticos locais. Esta auditoria não é uma aceitação em produção, não usa credenciais de produção e não autoriza merge, implantação ou alterações no D1.
