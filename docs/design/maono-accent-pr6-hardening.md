# PR 6 — Hardening do accent Maõno

## Objetivo

Fechar a migração visual iniciada na PR 109 com uma camada de proteção global contra a reintrodução de verde/teal/mint como identidade visual.

A PR 6 não tenta reescrever de uma vez os grandes stylesheets estruturais anteriores ao design system. Em vez disso, neutraliza os aliases históricos no runtime, classifica os últimos resíduos visuais e cria um gate que impede nova dívida.

## Fonte de verdade

`src/maono-design-tokens.css` continua sendo a única fonte oficial de marca e semântica.

A PR adiciona `--maono-accent-muted` para cobrir o antigo papel de `--mm-gold-muted` sem manter uma segunda paleta.

## Tombstones de compatibilidade

`src/pages/Projects/maono-residual-accent.css` passa a declarar em `html:root`:

```css
--mm-gold: var(--maono-accent-strong);
--mm-gold-bright: var(--maono-accent-bright);
--mm-gold-muted: var(--maono-accent-muted);
--mm-teal: var(--maono-accent);
--mm-danger: var(--maono-semantic-danger);
--mm-success: var(--maono-semantic-success);
```

O seletor possui especificidade maior que o `:root` estrutural legado. Assim, mesmo enquanto o monólito antigo ainda contém declarações físicas, o valor efetivo consumido pelo runtime vem do design system Maõno.

`--mm-teal` deixa, portanto, de carregar teal no runtime: ele existe apenas como tombstone temporário para consumidores históricos e resolve para o accent dourado oficial.

## Resíduos classificados nesta PR

- `projects-limit-progress`: chrome da plataforma, portanto dourado;
- `roadmap-shell`, milestones e ações ativas: chrome da plataforma, portanto dourado;
- barras de tarefas do Roadmap em andamento: informação funcional, portanto `--maono-semantic-info`;
- status padrão do Roadmap: informação funcional, portanto `--maono-semantic-info`;
- prioridade baixa e progresso dos chamados: informação funcional, não branding;
- sucesso/fechado: continuam `--maono-semantic-success`;
- warning, danger e info continuam separados da marca.

## Gate global

`scripts/design/maono-accent-gate.mjs` varre as superfícies de produto em Projects, Admin e Login e bloqueia em arquivos modernos:

- `#20c7b5` e RGB equivalente;
- mint/teal históricos `#67e8dd`, `#9af5eb`, `#99f6e4`;
- emeralds de branding `#34d399`, `#6ee7b7` e equivalentes RGB;
- novas definições hardcoded dos aliases de dourado de compatibilidade;
- uso de `--mm-teal` fora da área histórica congelada e do tombstone;
- consumo de `var(--mm-teal)` pela camada moderna.

O gate exige também que os aliases de compatibilidade apontem para os tokens globais corretos.

## Dívida histórica congelada

A remoção física completa não é feita nesta PR porque os arquivos abaixo são grandes stylesheets estruturais anteriores ao design system e misturam layout, responsividade e aparência:

- `src/pages/Projects/projects.css`;
- `src/pages/Projects/components/project-cards.css`;
- `src/pages/Projects/components/project-metadata-panel.css`;
- `src/pages/Admin/admin.css`.

Esses arquivos podem reduzir sua dívida, mas código moderno não pode copiá-la nem criar novos consumidores. O runtime fica protegido pelos bridges já criados nas PRs 2–6.

Uma remoção física futura deve acontecer junto da decomposição segura desses monólitos, evitando um diff massivo apenas para substituir literais que já estão neutralizados.

## Critério de aceite

- nenhum arquivo moderno cria nova paleta teal/mint/emerald de marca;
- o tombstone `--mm-teal` resolve para `--maono-accent`;
- novos aliases de dourado não são hardcoded fora da fonte oficial;
- Roadmap e limites não exibem teal de branding;
- estados funcionais continuam semanticamente classificados;
- `npm run test:accent-gate` participa do gate de Projects;
- nenhuma lógica de negócio, autenticação, permissões ou geometria do mapa é alterada.

## Próximo passo estrutural

Depois desta PR, qualquer trabalho adicional nessa frente deixa de ser uma migração visual e passa a ser refatoração de CSS legado: dividir os monólitos por domínio e então apagar fisicamente os aliases/tokens históricos sem risco de regressão ampla.
