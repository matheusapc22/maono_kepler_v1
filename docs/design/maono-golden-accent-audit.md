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

Arquivo: `src/pages/Projects/components/project-cards.css`

Achados de accent legado:

- bordas e glows em `rgba(52, 211, 153, ...)`;
- destaques em `rgba(110, 231, 183, ...)`;
- outros verdes do mesmo grupo aplicados a hover/seleção/abertura do card.

Esses usos correspondem ao contorno verde de destaque observado nos cards e são identidade visual, não estado semântico.

Ação futura: substituir borda, glow, hover e seleção por `--maono-accent-border*` e `--maono-accent-glow*`.

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
2. Cards e listagens: bordas, glows, hover e seleção.
3. Shell do mapa/Kepler: tabs, focus, filtros, painéis e controles residuais.
4. Admin, login e demais superfícies: varredura de hardcodes e aliases legados.
5. Remover aliases verdes de marca, como `--mm-teal`, quando não houver mais consumidores.

## Critério de conclusão

A migração estará completa quando nenhum verde for usado como accent de marca nas superfícies principais e qualquer verde remanescente tiver função semântica identificável e documentável.
