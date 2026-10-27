# Admin: Projetos e Mapas

## Funcionamento

Abra `/admin?section=projects`. O painel apresenta o inventário que a API administrativa autorizou: nome e slug, organização, estado do ciclo, flag de cadastro ativo, disponibilidade dos destinos e quantidade de vínculos de acesso. A flag de cadastro é separada do lifecycle: para projetos gerenciados, `ACTIVE` é a autoridade de publicação no backend. Uma identidade `DRAFT` não equivale a um mapa publicado.

Em **Detalhes**, consulte descrição, JSON principal, pasta, versão de metadados, versão do ciclo, revisão da configuração, autores e datas UTC. Ausência de informação aparece como tal; a interface não preenche uma pasta ou arquivo fictício. O painel não realiza leitura do conteúdo do mapa ou do Dropbox.

Digite a busca e escolha organização/estado. **Aplicar filtros** confirma a consulta; **Cancelar** descarta apenas as alterações ainda não aplicadas; **Limpar filtros** retorna à consulta inicial. O filtro de organização limita a coleção exibida, sem trocar a organização ativa da sessão. Busca, filtros aplicados, página e tamanho são guardados na URL. Voltar/Avançar do navegador recuperam a consulta, e a página é limitada ao intervalo que ainda existe após filtrar.

As páginas mostram 10, 25 ou 50 registros. A contagem informa registros filtrados e recebidos, com zero explícito somente após uma resposta bem-sucedida. A API existente entrega a coleção inteira: a paginação é de apresentação, não de servidor. Ela não reduz a transferência, o custo D1 ou a memória da lista. Não há limite máximo de registros certificado; a cobertura visual usa 27 projetos sintéticos. Grandes volumes exigem uma evolução separada, baseada em medição e contrato de paginação do servidor.

## Perfis e destinos

O painel continua exclusivo de **Super Admin**. Admin, Owner, Editor e Viewer não recebem acesso ao inventário administrativo. `admin.panel.access` permanece no backend; quando o endpoint é consultado com organização, sua autorização continua contextual. Esta entrega não altera grants, ACL ou vínculos.

- `/projects/:slug/manage`: disponível somente após leitura válida de projeto publicável, com organização conhecida e ativa, igual à organização ativa da sessão. O destino resolve o modo autorizado e revalida o acesso.
- `/projects/:slug/requests`: abre a caixa existente de solicitações do projeto nas mesmas condições e com a permissão de persistência verificada na UI. A API do destino continua autoritativa.
- `/projects/:slug/view`: a rota existe, mas a política atual atribui modo Editor ao Super Admin e não libera Viewer simultaneamente. Por isso, esta subaba explica a indisponibilidade da visualização direta e não fabrica um link permitido.
- `/projects/:slug/review/:id`: a caixa de solicitações retorna o ID e o link reais da revisão. O inventário não cria IDs nem outra interface de revisão.
- `/projects`: permite voltar ao workspace e selecionar a organização pelo fluxo existente. O filtro do inventário não faz essa alteração por conta própria.

Organização inativa, contexto desconhecido, rascunho, estado não publicado, erro de leitura e dados incompletos apresentam motivos de indisponibilidade. Estados não reconhecidos não recebem disponibilidade por inferência. `PENDING` é coberto como estado não publicável, sem transformar esse valor em um novo estado do domínio.

## Carregamento, recuperação e acessibilidade

As quatro leituras administrativas e seu bootstrap foram preservados. AbortController, sequência de requisição e remount por contexto de acesso continuam pertencendo ao Admin. Uma resposta antiga não pode repopular uma sessão/contexto invalidado. Uma resposta que chega após aplicar um filtro é apresentada sob o filtro atual; não apaga o rascunho digitado no formulário.

Uma falha transitória conserva dados anteriores, identifica que estão desatualizados e suspende os destinos até confirmação de uma leitura válida. **Tentar novamente** continua contextual aos erros recuperáveis. 403 limpa a região negada; 401 invalida o lote e seus resultados tardios. Nenhum desses erros se apresenta como lista vazia bem-sucedida ou disponibiliza retry de autorização. Não há botão global Atualizar.

Controles usam rótulos, foco visível e MaonoSelect. A tabela tem cabeçalhos, legenda e região de rolagem acessível por teclado; detalhes usam disclosure nativo. A navegação e a contagem de resultados são identificadas para tecnologias assistivas. No mobile, a rolagem horizontal fica na tabela e os controles mantêm alvos de 44 px. A raiz permanece 16 px e a sidebar existente permanece 240/72 px. Não foram introduzidos zoom, scale ou estilos globais.

## Implementação e limites

`AdminProjects.tsx`, `admin-projects-model.ts` e `admin-projects.css` concentram esta consulta. Em `Admin.tsx`, a mudança se limita ao import, tipo e renderização da subaba. O inverso de preservação foi estendido por substituições exatas; os hashes históricos e canários foram mantidos. Há testes do handler real com autenticação/D1 sintéticos, testes do modelo e testes de navegador da aplicação compilada. A execução remota própria está definida no workflow Admin Projects Inventory.

Não há editor duplicado, criação, ativação, exclusão ou reconciliação nesta subaba. `POST /api/admin/projects` continua criando DRAFT inativo pelo contrato existente. Não foram adicionados endpoint, índice, migration, feature flag ou dependência. Dados de preview e estado físico do armazenamento não são certificados por esta consulta.

As capturas e testes de navegador usam fixtures HTTP sintéticas com origens externas bloqueadas. As suítes locais de persistência usam fixtures/repositórios de teste. Esses resultados não são aceite autenticado de D1, Dropbox ou Produção.

## Verificação e rastreabilidade

Base: `e47deac18888195b945a244dadb9e27c5902638f`. Branch: `feat/admin-projects-maps`. Implementação inicial: `c35c2960c29d9e3f071546dc10afaee873602eb2`. Validação/capturas: `70bc41ac428f1b58190c8c275e262c8f8447d3a1`, sem alterações nos fontes de aplicação em relação à implementação.

[PR draft #256](https://github.com/matheusapc22/maono_kepler_v1/pull/256). [PDF de funcionamento e implementação](../../output/pdf/admin-projects-maps.pdf).

Validação local em 27/10/2026, no Windows, com os fontes de aplicação de `c35c2960`:

| Gate | Resultado |
| --- | --- |
| TypeScript app e node | Aprovados; build-info em pasta própria da tarefa. |
| Build Vite | Aprovado em 5m44s; avisos existentes de dependências e chunks grandes. |
| ESLint do escopo | Aprovado após incluir as capturas. |
| Preservação/Admin/loading/fallback/densidade/accent | 60/60 na rodada consolidada, baseline estrita habilitada. |
| Modelo/API, isolamento e rotas | 48/48; inclui 11 testes novos de inventário/API/preservação. |
| Lifecycle e metadata | Scripts completos aprovados; metadata 50/50. |
| Navegador da subaba | 63/63 cenários funcionais + 6/6 capturas, três motores, um worker, sem retries ou skips. |
| Regressão compartilhada | 240/240: 80 por motor, lotes finais com exit 0, sem retries/skips. |
| Inspeção visual | Desktop 1440 px e mobile 390 px conferidos em Chromium, Firefox e WebKit; geometria também cobre 320 px. |

[Captura desktop](../visual-maono/admin-projects-desktop.png) e [captura mobile](../visual-maono/admin-projects-mobile.png), com dados sintéticos. O desktop mostra o inventário; o mobile mostra o filtro Rascunho e sidebar recolhida pelo controle existente.

Regressão compartilhada: `admin-workspace.spec.ts`, `admin-progressive-loading.spec.ts` e `projects-theme-regression.spec.ts`. O lote inicial perdeu seu processo antes do relatório terminal; os três lotes finais separados concluíram com exit 0 (Chromium 3,7 min, Firefox 5,2 min, WebKit 7,5 min). A tentativa parcial foi descartada da contagem final.

O PDF tem cinco páginas, renderizadas e inspecionadas. Os checks da PR registram o resultado remoto do head publicado. Resultados locais não substituem CI nem aceite de Produção.

O primeiro Product Reliability UX incluiu indevidamente esta suíte compilada no runner Vite dev, causando duas cargas iniciais e quatro falhas de fixture. `playwright.config.ts` agora registra o mesmo isolamento já usado pelas outras suítes Admin: os 69 casos continuam obrigatórios no workflow Admin Projects Inventory e os 290 casos preexistentes continuam no gate dev. Nenhuma assertion, timeout ou teste foi removido; mudanças nessa configuração também disparam o workflow dedicado.

## Migrações, flags e reversão

Não é necessária migration nova ou mudança de flag para esta entrega. O ambiente deve ter o schema exigido pela API administrativa já existente; indisponibilidade de schema continua sendo erro, não autorização para executar migrations. Nenhuma migration remota, flag, credencial ou escrita de Produção foi executada.

A reversão é por revert da PR, sem rollback de dados. Integração futura com Organizações e Usuários pode exigir composição dos imports/renderizadores de `Admin.tsx` e dos inversos de preservação; não copiar commits de outras frentes. A entrega permanece em PR draft, sem merge ou auto-merge.
