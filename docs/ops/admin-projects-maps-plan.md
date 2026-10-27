# Projetos e Mapas — plano de execução

Base: `e47deac18888195b945a244dadb9e27c5902638f`, `mano_kepler_v1`.
Branch dedicada: `feat/admin-projects-maps`. Entrega por PR draft, sem merge.

## Evidência e decisão

- A tabela de `/admin?section=projects` mostra apenas nome, slug, JSON, pasta, acessos e ativo. Substitui campos ausentes por caminhos fictícios e não distingue DRAFT de projeto publicado.
- `GET /api/admin/projects` exige `admin.panel.access`, aceita organização e retorna a coleção completa autorizada, sem cursor, limite ou total. Já retorna organização, lifecycle, autores, datas e metadataVersion.
- A interface Admin e a política can limitam o painel ao Super Admin. Não ampliar essa fronteira.
- `getAuthorizedProject` exige organização ativa na sessão, organização ativa no banco e projeto publicável. Um resultado do inventário global não autoriza abrir um mapa de outra organização.
- `POST /api/admin/projects` cria identidade DRAFT inativa. Nenhuma criação, ativação, edição, reconciliação ou exclusão será acrescentada nesta consulta.
- Não há `.agents/skills` nem AGENTS subordinado na base. AGENTS.md raiz e `admin-workspace-redesign.md` lidos. Sem migrações, índices, endpoints, flags ou dependências novos.

## Implementação prevista

### Volume e paginação: limite explícito do contrato

Na base `e47deac1`, `listAdminProjects` termina em `GROUP BY projects.id ORDER BY projects.updated_at DESC, projects.name ASC`, sem `LIMIT`, `OFFSET`, cursor ou contagem separada. `onRequest(GET)` devolve `projects: projects.map(publicAdminProject)` de uma única leitura; o Admin já carregava essa coleção inteira no bootstrap. O único filtro servidor dessa rota é organização, com autorização contextual anterior à consulta.

Esta entrega não aumenta a quantidade de requisições nem busca páginas adicionais. Os filtros e as páginas de 10/25/50 operam sobre a resposta recebida. A paginação limita somente as linhas renderizadas: **não reduz bytes transferidos, trabalho no D1 nem memória da coleção no cliente**. A busca percorre a coleção recebida. Não há limite máximo de registros declarado pelo endpoint nem capacidade medida em Produção; não se afirma suporte escalável a grandes volumes. Os testes de navegador usam 27 projetos sintéticos, suficientes para verificar três páginas, filtros e redução da coleção, não para certificar carga.

Não foi fornecida evidência de um volume que exija mudar esse contrato nesta subaba. Introduzir paginação servidor agora também afetaria as contagens de Painel e os consumidores da resposta completa. Portanto, preserva-se o contrato. Uma evolução para grandes inventários exige medição de latência/tamanho, paginação autorizada no servidor, filtros e total com semântica definida e adaptação explícita desses consumidores; não é substituída por uma alegação de escalabilidade da paginação local.

1. Extrair somente a apresentação da subaba para componente dedicado; preservar bootstrap, quatro leituras, ACL, cancelamento, sequência e retry contextual do Admin.
2. Usar os campos já retornados. Distinguir estado do ciclo, flag ativo, disponibilidade de navegação e ausência de informação. Exibir organização, versões, autores e datas; JSON/pasta em detalhes.
3. Filtrar localmente a coleção completa por busca, organização e ciclo; paginar 10/25/50 por página. Contagem explicitamente dos registros recebidos, sem total global inventado. Não buscar páginas adicionais.
4. Persistir filtros aplicados e página na URL. Aplicar, limpar e cancelar rascunho de filtro; Back/Forward restauram a consulta. Respostas tardias passam pela proteção existente e os filtros correntes continuam aplicados.
5. Links `/projects/:slug/manage` e `/requests` somente para projeto publicável da organização ativa conhecida. A leitura de `project-map-route-policy.js` e `project-map-navigation-service.js` confirmou que Super Admin recebe exclusivamente modo Editor: `/view` existe para Viewer, mas não é oferecido como link indisponível neste painel. Revisão `/review/:id` continua na caixa de solicitações, que conhece IDs reais; não inventar IDs. Destinos revalidam ACL.
6. Preservar dark/dourado, raiz 16px, sidebar 240/72 e densidade existente. Usar MaonoSelect, foco visível, tabela com rolagem local, descrição de indisponibilidade e controles de toque.
7. Estender inverso estrito de preservação apenas para as substituições exatas desta subaba, sem atualizar hashes históricos; acrescentar canários para rejeitar alterações fora do escopo.

## Verificação e entrega

- Reproduzir limites da tabela e testar filtros, páginas, DRAFT/ACTIVE/PENDING/desconhecido, contexto de organização, ausência de dados e navegação.
- Executar contratos API existentes de lifecycle/metadata/isolation, contratos de preservação e gates aplicáveis; TypeScript, lint do escopo e build.
- Browser real da aplicação com HTTP sintético isolado: desktop/mobile, roles, 401/403/503, resposta tardia, teclado, cancelamento e histórico. Mocks não representam D1/Dropbox real.
- Instalação/build/browser dependem da coordenação de recursos pelo executor principal, devido aos 8 GiB de RAM. Não encerrar processos alheios.
- Produzir PDF de funcionamento, perfis, rotas, implementado/limites, testes/SHA/PR, migrações/flags/reversão. Renderizar e inspecionar.
- Publicar branch, abrir PR draft, verificar SHA remoto e CI terminal. Registrar falhas preexistentes com baseline. Não fazer merge.

## Coordenação e reversão

Organizações (PR 254) e Usuários evoluem separadamente. Não alterar seus componentes, endpoints, ESLint global ou copiar commits. `Admin.tsx` e o helper de preservação podem exigir composição de imports/inversos no merge futuro. Reversão por revert da PR, sem rollback de dados.

## Registro da etapa leve — 27/10/2026

- Implementados componente, modelo, filtros aplicados em URL com cancelamento, paginação, detalhes, destinos e CSS isolado.
- Integração limitada a import/tipo/renderProjects em `Admin.tsx`. Nenhuma alteração funcional nos loaders, ACL, endpoints, bootstrap ou outras subabas.
- Adicionados 11 testes de modelo/API/inverso e suíte de navegador em `playwright.admin-projects.config.ts`, porta exclusiva 4197, um worker. Chromium/Firefox/WebKit previstos; ainda não executados nesta etapa.
- Lint do escopo passou. Contratos de Admin/preservação/visual: 69 de 71 inicialmente; as duas falhas eram CRLF no checkout Windows de `src/fallback-ui-styles.ts`, arquivo idêntico à base no diff Git. Após restaurar somente os finais LF locais, o teste de fallback passou 7/7, sem alterar assertions, hashes ou conteúdo versionado.
- `npm run test:project-lifecycle` e `npm run test:project-metadata` passaram (incluem isolamento/revisões/persistência sintética; metadados: 50/50).
- Contratos de rota + inventário/API: 48/48. O gate confirma que Super Admin usa Editor e não recebe link direto Viewer.
- Dependências existentes reutilizadas por junction, sem instalação/lockfile. Não executar `npm run build` local diretamente com esta junction: os tsconfigs gravam build-info em node_modules compartilhado. Para validação local, direcionar os dois build-info para pasta própria desta tarefa e executar Vite separadamente, com flags de mapa; CI usa instalação isolada normal.
- Pendente de coordenação técnica: TypeScript/build/browser, captura visual, PDF final renderizado, publicação/PR draft e CI terminal. Não representa entrega validada nem aceite de Produção.

## Retomada e validação - 27/10/2026

- Coordenação técnica liberou a execução sequencial. Após o bloqueio temporário de limite, a tentativa autorizada executou comandos reais e concluiu ambos os projetos TypeScript com exit 0.
- Build Vite aprovado em 5m44s, com outputs e cache próprios e flags de mapa somente locais. Avisos de dependências e tamanho de chunks preservados; nenhuma alteração global para contorná-los.
- Subaba: 21 cenários por motor (63/63) e duas capturas adicionais por motor (6/6), Chromium/Firefox/WebKit. Sem retries, skips ou alteração das assertions. Capturas desktop/mobile inspecionadas.
- O servidor de preview próprio usa a pasta compilada sem carregar configuração Vite, evitando escrita temporária no node_modules compartilhado. Porta 4197 exclusiva; nenhum processo alheio encerrado.
- O manual `admin-projects-maps.md` explicita funcionamento, rotas, permissões, limites de volume e fronteiras de operação. A regressão do shell, PDF e CI permanecem registrados separadamente até seus resultados terminais.
