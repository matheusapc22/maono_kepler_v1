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

Ação futura: migrar eyebrow, foco e ações de marca para dourado. Manter feedback de sucesso como semântico, preferencialmente através de `--maono-semantic-success`.

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

1. Formulários e drawers: focus, labels, ações e estados ativos.
2. Cards e listagens: bordas, glows, hover e seleção.
3. Shell do mapa/Kepler: tabs, focus, filtros, painéis e controles residuais.
4. Admin, login e demais superfícies: varredura de hardcodes e aliases legados.
5. Remover aliases verdes de marca, como `--mm-teal`, quando não houver mais consumidores.

## Critério de conclusão

A migração estará completa quando nenhum verde for usado como accent de marca nas superfícies principais e qualquer verde remanescente tiver função semântica identificável e documentável.
