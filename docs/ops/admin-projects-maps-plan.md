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
