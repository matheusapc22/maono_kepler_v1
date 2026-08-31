# Auditoria de accent — dourado Maõno

## Objetivo

Consolidar o dourado como único accent de identidade visual da plataforma Maõno e retirar verdes, teal e mint usados apenas como destaque de marca.

A migração não deve apagar significado funcional: verde continua permitido quando representar explicitamente sucesso, disponibilidade ou outro estado positivo real.

## Fonte oficial

Os tokens globais ficam em `src/maono-design-tokens.css` e são carregados antes dos estilos da aplicação em `src/main.tsx`.

Novos componentes devem usar `--maono-accent*` e `--maono-focus-ring` para identidade visual. Cores de estado devem usar `--maono-semantic-*`.

## Achados da auditoria inicial

### Projects — estilos globais

Arquivo: `src/pages/Projects/projects.css`

Achados de accent legado:

- `--mm-teal: #20c7b5`;
- múltiplos usos de `var(--mm-teal)` como cor de foco, destaque e borda;
- múltiplos `rgba(32, 199, 181, ...)` equivalentes ao teal;
- literais mint/cyan como `#67e8dd`, `#9af5eb` e `#99f6e4` usados em superfícies de destaque.

Ação futura: migrar usos de identidade visual para os tokens `--maono-accent*`, preservando somente ocorrências semanticamente justificadas.

### Cards de projetos

Arquivo estrutural legado: `src/pages/Projects/components/project-cards.css`

Achados de accent legado:

- bordas e glows em `rgba(52, 211, 153, ...)`;
- destaques em `rgba(110, 231, 183, ...)`;
- outros verdes do mesmo grupo aplicados a hover/seleção/abertura do card;
- fallback de preview e menu de ações também utilizavam verde como decoração de marca.

Ação da PR 3: os estados visuais passam a ser sobrescritos pela camada `src/pages/Projects/maono-card-list-accent.css`, consumindo exclusivamente tokens `--maono-accent*` e `--maono-focus-ring`. O CSS estrutural original permanece intacto para reduzir risco de regressão de layout.

### Drawer de metadados do projeto

Arquivo: `src/pages/Projects/components/project-metadata-panel.css`

Achados de accent legado:

- eyebrow/título de seção em verde;
- borda e glow do campo em foco em verde;
- ações de destaque com verde;
- estados de sucesso também usam verde.

Ação da PR 2: branding e interação do drawer passaram a consumir a camada `src/pages/Projects/maono-form-accent.css`, com eyebrow, brilho decorativo, spinner, ação principal, foco e focus ring dourados. O estado `.is-success` permanece sob as regras semânticas originais.

## PR 2 — formulários e modais

A segunda etapa da migração aplica os tokens definidos na PR 109 sem alterar regras de negócio ou estrutura dos componentes.

Escopo migrado:

- `input`, `textarea` e `select` em formulários de Projects recebem `--maono-accent-border-strong` e `--maono-accent-glow` durante foco;
- `focus-visible` do drawer de metadados e da Central de Chamados passa a usar `--maono-focus-ring`;
- `:focus-within` da busca composta da Central de Chamados passa a usar borda/glow dourados;
- eyebrow do drawer passa a `--maono-accent-text`;
- spinner de carregamento passa a `--maono-accent-bright`, pois loading não representa sucesso;
- botão primário do drawer passa a gradiente construído com `--maono-accent-bright` e `--maono-accent-strong`;
- brilho decorativo do fundo do drawer passa a `--maono-accent-surface`;
- labels comuns e headings principais permanecem neutros para preservar a hierarquia visual.

Fora do escopo da PR 2:

- cards e listagens;
- kanban, calendário, métricas e timeline enquanto elementos de visualização;
- shell do mapa/Kepler;
- aliases verdes legados ainda consumidos por áreas não migradas;
- estados semânticos de sucesso, aviso, erro e informação.

## PR 3 — cards e listagens

A terceira etapa migra a identidade visual dos cards de projeto e de suas listagens associadas sem alterar o componente React, o fluxo de abertura, favoritos ou comportamento responsivo.

Escopo migrado:

- hover do card passa a usar `--maono-accent-border` e `--maono-accent-glow`;
- estado `.is-opening` recebe contorno forte e glow dourado, deixando de parecer um estado verde de sucesso;
- fallbacks de preview passam a usar `--maono-accent-surface` e `--maono-accent-text` como decoração de marca;
- botões de favorito e mais ações passam a dourado no hover;
- favorito ativo e menu aberto (`aria-expanded="true"`) compartilham o mesmo contrato de estado ativo dourado;
- itens do menu de ações passam a usar surface/text/border dourados em hover e `focus-visible`;
- focus ring dos controles do card passa explicitamente a `--maono-focus-ring`;
- contorno e glow do CTA `Abrir projeto` passam a consumir os tokens globais de accent nos estados hover/active.

A camada `src/pages/Projects/maono-card-list-accent.css` é carregada depois dos tokens e da camada de formulários. Ela não contém aliases verdes, literais verdes legados nem regras de `.is-success`.

Fora do escopo da PR 3:

- kanban, calendário, métricas e timeline da Central de Chamados;
- shell do mapa/Kepler;
- Admin e Login;
- remoção global de `--mm-teal` enquanto áreas ainda não migradas o consumirem;
- estados semânticos de sucesso, aviso, erro e informação.

## PR 4 — Shell Maõno / Kepler / painéis

A quarta etapa transforma o ambiente cartográfico em consumidor efetivo do contrato global iniciado na PR 109, sem modificar a geometria do viewport, o `ResizeObserver` ou a arquitetura de overlay estabilizada nas PRs de layout do mapa.

Escopo migrado:

- `maono-map-tokens.css` deixa de manter uma paleta de marca paralela e passa a derivar accent e semântica de `--maono-accent*` e `--maono-semantic-*`;
- `src/pages/Kepler/maono-kepler-theme.ts` aplica o dourado aos slots nativos do Kepler v3 que originalmente usam verde/cyan em active, primary/CTA, selection, switch, checkbox e histogram;
- `maono-map-accent.css` consolida tabs, filtros, basemap, sidebar, botões flutuantes, ferramentas de análise e states ativos no contrato dourado;
- `--maono-filter-accent` continua disponível quando representar cor de dado/layer, evitando confundir identidade visual com codificação cartográfica;
- o painel de agrupamento de pontos deixa de usar `#20c7b5` e superfícies verdes e passa a usar fundo neutro, bordas/glow dourados, toggle dourado e focus ring global;
- o gate de acesso ao mapa deixa o CTA azul legado e passa ao CTA dourado Maõno;
- `is-clean` permanece verde de sucesso, `is-dirty` permanece warning, loading permanece info e erros permanecem danger, agora ligados aos tokens semânticos globais;
- mensagens de salvamento bem-sucedido continuam verdes por semântica funcional, e não por branding.

Proteção de regressão:

- `tests/maono-map-accent.test.mjs` garante sincronização entre tokens CSS e o bridge do tema Kepler;
- o teste impede a reintrodução dos defaults verdes/cyan ativos do Kepler no bridge;
- o painel de agrupamento não pode reintroduzir `#20c7b5` nem suas antigas superfícies verdes;
- a nova camada visual não pode definir `.maono-map-runtime__map` nem participar da lógica de `ResizeObserver`;
- o teste passa a integrar `test:map-panels`.

Fora do escopo da PR 4:

- cores de layer, swatches, categorias, resultados de Buffer/Isócrona e outras cores que codifiquem dados;
- alterações no contrato de layout/overlay do mapa;
- Admin, Login e superfícies residuais fora do Kepler;
- remoção global de `--mm-teal` enquanto ainda existirem consumidores fora das áreas migradas.

## PR 5 — Admin, Login e superfícies residuais

A quinta etapa fecha a migração visual das superfícies principais antes da limpeza estrutural final dos aliases históricos.

Escopo migrado:

- `src/pages/Admin/maono-admin-accent.css` faz `--admin-gold` e `--admin-gold-bright` derivarem do design system global e isola aliases neutros do Admin que ainda eram herdados de Projects;
- botões, links, tabs, inputs e selects do Admin passam a ter `focus-visible` dourado e campos ativos recebem border/glow do contrato Maõno;
- membership ativa continua verde por semântica funcional, guidance informativo usa `--maono-semantic-info` e warning permanece semântico;
- `src/pages/maono-login-accent.css` preserva o desenho atual do Login, mas passa spinner, labels, inputs, links, CTA, autofill e focus ring para os tokens `--maono-accent*` e `--maono-focus-ring`;
- `src/pages/Projects/maono-residual-accent.css` cobre os resíduos visuais da Central de Chamados: chip de organização, hover de ações, links/assuntos, métricas, drawers, anexos, timeline, empty state e focus ring;
- `metric-progress` e `priority-low` deixam de usar teal de marca e passam a `--maono-semantic-info`;
- métricas/feedback de fechado e toast de sucesso continuam em `--maono-semantic-success`;
- fundos decorativos teal de métricas e drawers passam para superfícies douradas derivadas dos tokens globais.

Estratégia de compatibilidade:

- `--mm-teal` continua temporariamente definido em `projects.css` para não misturar a migração visual com uma grande limpeza estrutural;
- os consumidores visuais conhecidos são supersedidos pela camada residual da PR 5;
- a remoção física de aliases/hardcodes antigos fica reservada para a PR 6, quando o risco de regressão visual estiver isolado.

Proteção de regressão:

- `tests/maono-residual-accent.test.mjs` valida Admin, Login e Central de Chamados;
- a camada residual não pode reintroduzir `#20c7b5`, `#67e8dd`, `#9af5eb` ou `rgba(32, 199, 181, ...)` como branding;
- o teste exige que estados funcionais continuem consumindo os tokens semânticos;
- o gate `test:accent-residual` passa a integrar `test:projects`.

Fora do escopo da PR 5:

- remoção física de aliases e regras legadas já sobrescritas;
- alterações de autenticação, permissões, chamados ou regras de negócio;
- mudanças no layout responsivo;
- qualquer modificação na arquitetura do mapa/Kepler.

## Regra de classificação

| Uso | Cor desejada | Token |
| --- | --- | --- |
| Marca, seleção, hover, focus, borda ativa, glow | Dourado | `--maono-accent*` |
| Focus ring | Dourado | `--maono-focus-ring` |
| Sucesso funcional | Verde | `--maono-semantic-success` |
| Aviso | Âmbar | `--maono-semantic-warning` |
| Erro | Vermelho | `--maono-semantic-danger` |
| Informação puramente semântica | Azul | `--maono-semantic-info` |

## Regra para código novo

Não adicionar novos literais verdes/teal/mint para identidade visual. Quando o elemento comunicar a marca Maõno, usar os tokens globais dourados. Verde só é aceito quando houver semântica funcional explícita.

## Fila de migração

1. ✅ Formulários e drawers: focus, labels, ações e estados ativos — PR 2.
2. ✅ Cards e listagens: bordas, glows, hover e seleção — PR 3.
3. ✅ Shell do mapa/Kepler: tabs, focus, filtros, painéis, botões e states — PR 4.
4. ✅ Admin, Login e superfícies residuais: tokenização e classificação semântica — PR 5.
5. Remover aliases verdes de marca, hardcodes históricos e regras sobrescritas; adicionar gate global — PR 6.

## Critério de conclusão

A migração estará completa quando nenhum verde for usado como accent de marca nas superfícies principais e qualquer verde remanescente tiver função semântica identificável e documentável.
