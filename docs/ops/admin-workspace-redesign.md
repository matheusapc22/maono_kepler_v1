# Workspace Admin — contrato visual e verificação

## Escopo

A rota `/admin` adota o padrão escuro e dourado de Projects e a composição aprovada, sem o botão **Atualizar**. A mudança concentra a apresentação em `AdminSidebar.tsx`, `AdminOverview.tsx`, `AdminIcon.tsx` e `admin-workspace.css`; `Admin.tsx` continua responsável pelos dados, autorização e callbacks.

Base da implementação: `3233037d6c94c6da20de0edd698e685cdf4976c9`, na linha de produto `mano_kepler_v1`.

## Contrato visual

| Elemento | Contrato |
| --- | --- |
| Sidebar desktop | 240 px aberta (mesma densidade de Projects) e 72 px recolhida, com logo oficial, avatar por iniciais e identidade da sessão. |
| Navegação | Sete destinos em dois grupos; item ativo identificado visualmente e por `aria-current`. Rodapé com retorno a Projetos e Sair. |
| Breadcrumb e cabeçalho | Alturas mínimas de 52 px e 92 px no desktop; título, ícone e descrição acompanham a seção. |
| Indicadores | Organizações, Projetos, Usuários e Arquivos; grade de 4 → 2 → 1 colunas conforme a largura disponível. Números com 40 px e entrelinha de 44 px, protegidos contra a cascata legada de Projects. |
| Acesso rápido | Três cartões para Organizações, Projetos e Auditoria; grade de 3 → 2 → 1 colunas. |
| Mobile | Até 960 px, sidebar expansível no fluxo da página; controles de toque com pelo menos 44 px. Tabelas preservam rolagem horizontal local. |
| Carregamento | O bootstrap e o conteúdo real compartilham a raiz `.maono-admin-workspace` e a geometria do novo shell; Skeleton importa o CSS antecipadamente. |

Os indicadores usam os cálculos existentes: organizações, projetos e usuários ativos; arquivos somados a partir de `fileCount` de todas as organizações retornadas. Nome, e-mail, perfil e iniciais vêm da sessão. As contagens das capturas são fixtures sintéticas, não valores fixos da interface.

## Limites preservados e recuperação

Permanecem os sete destinos: Painel, Gestão de Organizações, Usuários e Permissões, Projetos e Mapas, Solicitações, Auditoria e Sistema. Endpoints, payloads, filtros, permissões, logout e callbacks de mutações conservam seus contratos. Solicitações, Auditoria e Sistema mantêm o conteúdo que já possuíam; esta mudança não cria funcionalidades nesses módulos.

A carga inicial e as atualizações após mutações continuam chamando `refreshAdminData`. Não há polling, atualização ao trocar de seção ou atualização ao recuperar o foco da janela.

**Tentar novamente** aparece somente junto ao erro de uma região quando o normalizador o classifica como recuperável e não há acesso negado. O botão aguarda o lote ativo terminar e chama o mesmo callback das quatro leituras administrativas. Falhas transitórias preservam dados válidos; 403 limpa a região negada; perda de sessão invalida o lote e impede respostas tardias de restaurar dados. Não se oferece retry para esses erros de autorização.

O isolamento do fallback usa exclusivamente `.maono-admin-workspace`, inclusive no bootstrap. A classe legada `.maono-admin-page` sozinha continua no fallback. Detalhes e histórico: [Projects fallback scope](projects-fallback-scope.md).

## Verificação reproduzível

Executar a partir do checkout completo com as dependências instaladas, registrando o SHA efetivamente validado:

```sh
node --experimental-strip-types --test tests/admin-progressive-loading.test.mjs tests/initial-loading-presentation.test.mjs tests/projects-fallback-scope.test.mjs
npx tsc -b --pretty false
VITE_MAONO_MAP_SHELL_V1=true VITE_MAONO_LAYER_MANAGER_V1=true VITE_MAONO_MAP_OVERLAY_V1=true npm run build
npx playwright test --config=playwright.progressive-loading.config.ts admin-workspace.spec.ts admin-progressive-loading.spec.ts projects-theme-regression.spec.ts
```

O último comando usa a aplicação compilada e os três motores configurados. As fixtures interceptam HTTP, permitem apenas mutações sintéticas explicitamente previstas e bloqueiam origens externas. Essa cobertura não representa aceite autenticado em produção.

Inspecionar desktop aberto/recolhido, mobile, os sete destinos, três atalhos, teclado/foco, ausência de overflow da página e navegação SPA Projects → Admin → Projects. Conferir também carga parcial, erro/retry, preservação de filtro e rolagem após mutação, 401/403 e a paridade do fallback legado.

O helper de preservação restaura exatamente o `Admin.tsx` anterior e compara seu SHA-256 fixado; canários rejeitam alterações em autorização, endpoints, invalidação, cálculos e callbacks. Não atualizar a baseline para acomodar mudanças funcionais nesta entrega.

## Registro da execução inicial e capturas

Validação local das fontes desta PR, derivadas da base registrada acima, em 25/10/2026. O commit publicado e os resultados de CI ficam identificados na PR.

| Verificação | Resultado |
| --- | --- |
| Contratos Node | 252 aprovados; zero falhas e zero ignorados. Inclui preservação estrita com o commit histórico disponível, densidade e regras de accent. |
| TypeScript e build Vite | Aprovados com as três flags de mapa indicadas no comando acima. |
| ESLint dos componentes, testes e configurações alterados | Aprovado. |
| Chromium | 80 testes de navegador aprovados. |
| Firefox | 80 testes de navegador aprovados. |
| WebKit | 80 testes de navegador aprovados. |
| Total de navegador | 240 aprovados; zero falhas, repetições por instabilidade ou ignorados. |
| Revisão visual | Capturas desktop e mobile conferidas; desktop também inspecionado em Firefox e WebKit. |

A rodada de navegador combina a aplicação React compilada e os contratos isolados de CSS. A aplicação foi verificada em 1774×887, 1440×900, 960×800, 768×1024, 390×844 e 320×700. A matriz de fallback também cobre as larguras históricas e forced colors. O workflow Progressive Loading passou a incluir o novo workspace e a regressão de tema nos três motores.

Os contratos Node executados incluem o gate de `.github/workflows/progressive-loading.yml`, mais `platform-density.test.mjs`, `maono-residual-accent.test.mjs` e `maono-accent-gate.test.mjs`, com `PROJECT_PAGES_REQUIRE_BASELINE=1`. O ambiente local usou Node 24.22.1; o CI mantém Node 22. A instalação seguiu o procedimento do CI com `--package-lock=false`, sem alterações de dependências ou lockfiles. O build mantém avisos de dependências e chunks grandes; não houve erro de compilação.

Capturas da aplicação compilada em Chromium, com dados sintéticos:

- [Admin desktop](../visual-maono/admin-workspace-desktop.png).
- [Admin mobile](../visual-maono/admin-workspace-mobile.png).

## Revisão de integração após a densidade compacta

O pedido posterior de aplicar a densidade de Projects substitui a proposta inicial
 de sidebar de 262 px: o contrato desktop é 240 px aberta e 72 px recolhida, com
 raiz de 16 px preservada. O CSS compartilha os tokens de densidade sem modificar
 a folha global, sem zoom e sem scale.

O CI do head e87674b teve 561 testes de navegador aprovados e 12 falhas: as três
 asserções equivalentes ainda exigiam 262 px em quatro casos por motor. A revisão
 corrige esse contrato histórico mantendo a tolerância original e acrescenta a
 comparação direta entre a sidebar de Projects e a do Admin durante navegação SPA.
 Não altera o CSS para desfazer a compactação solicitada nem ignora testes.

Os resultados da tabela anterior e as capturas são da implementação inicial,
 anterior à compactação. A validação da integração com e8fbfa0 (PR 252) deve ser
 registrada no novo head e no CI antes do merge.