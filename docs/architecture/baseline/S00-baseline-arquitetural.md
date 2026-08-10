# S00 - Baseline arquitetural e congelamento

## Escopo

Snapshot documental da arquitetura Maõno Maps antes da Sprint de Consolidação Arquitetural.

- Branch-base: `mano_kepler_v1`
- Commit congelado: `aec5227d289fc8644cb22e9c083ff4ef44ef6e9e`
- Origem do commit: merge da PR #60
- Natureza: inventário e decisões; **sem alteração funcional**

## 1. Inventário de rotas

Fonte: `src/Routes.tsx`.

Rotas Maõno principais:

- `/` -> `/projects`
- `/login`
- `/projects`
- `/admin`
- `/admin/files` -> `/admin?section=organizations`
- `/projects/:projectSlug/manage`
- `/projects/:projectSlug/view`
- `/projects/:projectSlug/edit`
- `/projects/:projectSlug/create`
- `/projects/:projectSlug/map` -> `/projects/:projectSlug/manage`
- `/maps/new/create`
- `/maps/new/edit` -> `/maps/new/create`
- `/map` -> `/maps/new/create`
- `/auth`

Rotas herdadas/demo ainda existentes:

- `(:id)`
- `map/:provider`
- `demo/map`
- `demo/map/:provider`

**Finding congelado:** um projeto existente ainda pode possuir rota `/projects/:slug/create`; a correção semântica pertence à S02, não à S00.

## 2. Cloudflare, bindings e variáveis de runtime

Não há um arquivo Wrangler canônico versionado na raiz do snapshot. Portanto, o estado efetivo do ambiente Cloudflare continua parcialmente externo ao repositório. A S00 registra os contratos exigidos pelo código.

### D1

Bindings aceitos pelo backend:

- `DB` - binding preferencial
- `D1` - alias legado
- `MAONO_DB` - alias legado

### Dropbox

Secrets/vars exigidos no modo Dropbox:

- `DROPBOX_APP_KEY`
- `DROPBOX_APP_SECRET`
- `DROPBOX_REFRESH_TOKEN`

Modo local alternativo:

- `APP_ENV=local`
- `STORAGE_DRIVER=local-d1`

### Geoapify / análises

- `GEOAPIFY_API_KEY`
- `MAONO_ISOCHRONE_KILL_SWITCH`
- `MAONO_ISOCHRONE_V1` permanece como contrato compatível exposto pelo runtime, mas o backend atual o normaliza após o rollout.

### Flags de mapa/control plane

Registradas em `functions/_lib/map-panel-service.js` e `organization-limit-service.js`:

- `MAP_MANAGEMENT_HOME_V1`
- `MAP_PANEL_MODES_V1`
- `PROJECT_MAP_EDIT_PERMISSION_V1`
- `PROJECT_QUOTA_RESERVATION_V1`
- `PROJECT_QUOTA_RESERVATION_TTL_SECONDS`
- `MAP_CREATE_ROUTE_V1`
- `MAONO_LAYER_MANAGER_V1`
- `MAONO_MAP_SHELL_V1`
- `MAONO_MAP_OVERLAY_V1`
- `MAONO_ISOCHRONE_V1`

Limites configuráveis adicionais:

- `PROJECT_LIMIT_FREE|PRO|ENTERPRISE`
- `STORAGE_LIMIT_MB_FREE|PRO|ENTERPRISE`

### Flags/vars de frontend

- `VITE_POINT_CLUSTERING_V1`
- `VITE_MapboxToken` / `VITE_MAPBOX_TOKEN`
- `VITE_MapboxExportToken` / `VITE_MAPBOX_EXPORT_TOKEN`
- `VITE_DropboxClientId`
- `VITE_CartoClientId`
- `VITE_FoursquareClientId`
- `VITE_FoursquareDomain`
- `VITE_FoursquareAPIURL`
- `VITE_FoursquareUserMapsURL`

### Outras flags operacionais observadas

- `ASYNC_PROJECT_THUMBNAIL`

**Finding congelado:** flags e bindings não possuem hoje um registro canônico único com owner, default, ambiente e data de retirada. Isso será tratado nas fases posteriores.

## 3. D1 - schema e migrations

Fonte canônica atual: `schema.sql`.

Principais famílias de dados existentes:

- identidade e sessão: `users`, `sessions`
- organizações: `organizations`, `organization_users`
- governança: `organization_access_delegations`, `delegation_permissions`, `delegation_target_levels`, `user_permission_denials`
- arquivos: `organization_files`
- projetos: `projects`, `user_projects`
- reserva de capacidade: `organization_resource_reservations`
- análise: `map_analysis_rate_limits`
- auditoria: `audit_logs`
- chamados: `organization_tickets`, `ticket_attachments`, `ticket_events`

Migrations críticas verificadas no snapshot:

- `0008_session_active_organization.sql` - organização ativa persistida por sessão
- `0012_access_delegation_policy.sql` - delegações e regras de revogação
- `0014_project_metadata_ownership.sql` - autoria/snapshots/versionamento de metadados

O schema também contém estruturas mais novas de preview, quota e rate limiting. A S00 registra que o repositório não possui hoje um manifesto único e legível por máquina que relacione **todas** as migrations, ordem, checksum e estado esperado por ambiente.

## 4. Storage / Dropbox

Fonte: `functions/_lib/dropbox.js`.

Responsabilidades atuais:

- refresh token OAuth do Dropbox
- criação/listagem de pastas
- upload/download de arquivos
- metadata
- upload session para arquivos maiores
- exclusão
- preview/thumbnail revisionado

Há uma implementação alternativa `local-d1` em `functions/_lib/local-storage.js`, usada quando `APP_ENV=local` e `STORAGE_DRIVER=local-d1`.

O projeto continua armazenando no D1 metadados e caminhos; a configuração real é carregada por `dropbox_root_path + default_config_file`.

## 5. Stack cartográfica

Fonte: `package.json`.

Versões declaradas:

- Kepler.gl packages: `^3.1.0`
- React: `18.2.0`
- Redux: `4.2.1`
- React Redux: `8.0.5`
- Vite: `7.1.2`
- TypeScript: `~5.8.3`

Resolutions relevantes:

- `@deck.gl/core`: `8.9.27`
- `@deck.gl/extensions`: `8.9.27`
- `@luma.gl/core`: `8.5.21`
- `@luma.gl/webgl`: `8.5.21`

Decisão congelada: Kepler é engine de apresentação; regras de produto Maõno devem migrar progressivamente para uma camada anticorrupção.

## 6. Serviços externos

### Dropbox

Fonte/repositório operacional de configs, arquivos e thumbnails.

### Geoapify

Provider atual de isócronas, acessado somente pelo backend em `/api/maps/isochrones`.

### Cloud providers herdados do demo Kepler

O frontend ainda instancia providers para:

- Dropbox
- CARTO
- Foursquare

Também existem referências de demonstração a assets/datasets públicos do Kepler.

**Finding congelado:** separar dependências necessárias ao produto das dependências herdadas do demo será uma futura limpeza, não uma alteração S00.

## 7. Sessão

Frontend: `src/auth/session.tsx`.
Backend: `functions/_lib/auth.js`.

Características:

- cookie `maono_session`
- sessão D1 com hash do token
- TTL atual de 8 horas
- PBKDF2/SHA-256 para senhas
- organização ativa persistida em `sessions.active_organization_id`
- sessão publica usuário, organizações, permissões e projetos
- normalização do papel legado `client -> owner`

A S00 congela o fluxo atual; resiliência/fail-safe será tratada na S01.

## 8. Contexto e capabilities de mapa

Frontend:

- `src/pages/Kepler/map-panel/types.ts`
- `map-panel-api.ts`
- `MapPanelContext.tsx`

Backend:

- `functions/_lib/map-panel-service.js`
- `/api/projects/[slug]/map-navigation`
- `/api/maps/new/context`

Modelo atual:

- modos: `manage`, `viewer`, `editor`, `create`
- policy version: 2
- features booleanas
- capabilities booleanas por ação
- retries seletivos para contexto de navegação

Finding congelado: `manage` ainda prioriza `create` quando `createAllowed=true`; revisão semântica pertence à S02.

## 9. Carregamento de mapas

Fonte: `src/pages/Kepler/map-url-loader/index.tsx`.

Fluxo atual:

1. resolve `projectSlug`
2. fecha modal nativo aberto durante hidratação
3. GET `/api/projects/:slug/config`
4. retry em 408/425/429/5xx
5. valida envelope salvo
6. prepara extensão Maõno de clustering
7. `KeplerGlSchema.load`
8. fallback seguro se schema load falhar
9. `addDataToMap`

Finding congelado: a existência de `projectSlug` dispara carregamento mesmo na rota `create` de projeto existente.

## 10. Save / persistência atual

Backend principal: `functions/api/projects/[slug]/config.js`.

Responsabilidades atuais:

- autenticação/autorização
- validação do JSON Kepler
- upload do config no storage
- atualização de `config_revision`
- atualização do `organization_file`
- auditoria
- geração/armazenamento de thumbnail revisionado
- estados de preview no D1

Finding congelado: o formato persistente continua sendo primariamente um JSON Kepler enriquecido; ainda não existe envelope `maono-map` versionado.

## 11. Clustering

Arquivos principais:

- `src/pages/Kepler/clustering/point-cluster-policy.ts`
- `point-cluster-controller.ts`
- `point-cluster-store.ts`
- `point-cluster-adaptive-layer.ts`
- `point-cluster-native-data-adapter.ts`

Contrato atual:

- extensão persistente versionada `POINT_CLUSTERING_VERSION=2`
- compatibilidade com versão 1
- uma layer lógica no Redux
- subcamada transitória `DeckGLClusterLayer` / Supercluster
- `clusterSize` padrão 40
- `clusterMaxZoom`, histerese e contagem configuráveis
- classificação `safe | warn | tile_required`
- `MAX_CLIENT_POINT_COUNT=300000`
- flag `VITE_POINT_CLUSTERING_V1`

Testes oficiais incluem fidelidade e single-layer.

## 12. Filtros

Painel atual: `src/pages/Kepler/components/maono-layer-panel/FilterPanel.tsx`.

Características:

- grupos recolhíveis por layer/dataset
- edição focada de um filtro por vez
- compatibilidade de filtros sem layer
- smart histogram
- range brush
- exportação CSV filtrada
- centralização de resultados pelo Engine Adapter

Testes oficiais incluem smart histogram e accordion/branding.

## 13. Isócronas

Frontend:

- `MapOverlayControls`
- hook/runtime de preview e pin

Backend:

- `/api/maps/isochrones`
- `_lib/isochrone-service.js`
- `_lib/map-analysis-runtime.js`

Características:

- proxy server-side
- `GEOAPIFY_API_KEY` nunca vai ao browser
- request limitado
- rate limiting D1
- kill switch operacional
- preview transitório e persistência via fluxo de save
- propriedades semânticas enriquecidas no GeoJSON

## 14. Engine Adapter

Arquivo central: `src/pages/Kepler/engine-adapter/KeplerEngineAdapterProvider.tsx`.

Funções já consolidadas:

- estado normalizado de layers/datasets/filtros/viewport
- capabilities
- seleção de layer
- comandos encapsulados
- map flight
- cálculo de dirty/save baseline
- datasets transitórios
- telemetria

Finding congelado: o Adapter já funciona como uma ACL parcial, mas ainda há componentes e bridges legados que conhecem detalhes do Kepler. A ampliação pertence à fase Domain Architecture.

## 15. Fixtures e testes históricos

O repositório possui ampla cobertura comportamental, registrada em `package.json`, incluindo:

- project cards/preview/metadata
- engine adapter
- single-layer clustering
- cluster fidelity
- map flight
- smart histogram
- filter accordion
- login/autofill/session
- map panel/navigation
- isochrone service/contract
- map marker
- native overlays
- runtime recovery

**Gap congelado:** não existe ainda um corpus canônico de mapas históricos versionados usado como Golden Maps. A S00 cria o catálogo em `tests/fixtures/maps/manifest.json` e documenta que a captura sanitizada dos JSONs reais será promovida em etapa posterior.

## 16. Riscos e dívidas congeladas

Não corrigir na S00:

1. rota `project/:slug/create` para projeto existente
2. flags sem registro central/lifecycle
3. bindings efetivos dependentes do Dashboard Cloudflare
4. formato persistente centrado no schema Kepler
5. ausência de Migration Registry
6. ausência de golden map corpus real
7. DOM adapters para overlays nativos ainda presentes
8. dependências herdadas do demo Kepler ainda disponíveis
9. capabilities misturam, em alguns fluxos, autorização e disponibilidade de infraestrutura
10. limites de performance ainda não derivados de benchmark formal
11. PostGIS ainda não implementado
12. Performance Safety Plane ainda não implementado

## 17. Freeze contract da S00

Até a conclusão da S00:

- nenhuma rota é removida;
- nenhuma flag muda de default;
- nenhuma migration é aplicada;
- nenhum binding é alterado;
- nenhum schema é alterado;
- nenhum comportamento de clustering/filtros/isócronas é alterado;
- nenhum formato salvo é migrado.

As mudanças desta branch são estritamente `docs/` e `tests/fixtures/maps/` descritivos.
