# S07 — Observabilidade do carregamento

## Objetivo

Instrumentar a abertura canônica de projetos sem alterar o conteúdo do MapConfig, sem criar migration D1 e sem iniciar ainda a nova infraestrutura de performance.

A S07 transforma cada abertura de `/projects/:slug/view` ou `/projects/:slug/edit` em um trace determinístico identificado por um único `correlationId`.

## Sequência canônica

1. `MAP_OPEN_REQUESTED`
2. `SESSION_RESOLVED`
3. `PROJECT_RESOLVED`
4. `LOAD_GUARD_STARTED`
5. `CONFIG_REQUESTED`
6. `CONFIG_VALIDATED`
7. `MIGRATED`
8. `ENGINE_HYDRATION_STARTED`
9. `MAP_READY`

A máquina de estados aceita apenas essa ordem e ignora duplicações. Retries HTTP não criam novos eventos lógicos.

## Envelope mínimo de evento

Cada evento contém somente:

- `correlationId`;
- `projectId`;
- `revision`;
- `schemaVersion`;
- `duration` em milissegundos desde `MAP_OPEN_REQUESTED`.

Campos ainda desconhecidos permanecem `null` até que a etapa autoritativa os resolva.

## Correlation ID

O frontend cria um `correlationId` por abertura e o encaminha em `X-Correlation-Id` para `map-navigation` e `config`. O backend preserva esse identificador no boundary HTTP.

## Semântica dos marcos

### MAP_OPEN_REQUESTED

Início da navegação canônica para view/edit.

### SESSION_RESOLVED

A sessão pública conhecida está disponível. Em navegação SPA, pode ocorrer quase imediatamente. Uma resolução de projeto bem-sucedida também prova que a sessão já foi resolvida e pode fechar esse marco caso a publicação da sessão tenha ocorrido antes do observador.

### PROJECT_RESOLVED

O endpoint `map-navigation` devolveu contexto autorizado. É o primeiro ponto autoritativo para `projectId` e `revision`.

### LOAD_GUARD_STARTED

Fronteira arquitetural reservada ao futuro Load Guard. Na S07 não há classificação de complexidade nem bloqueio de performance.

### CONFIG_REQUESTED

Primeiro GET lógico de `/api/projects/:slug/config`. Retries usam o mesmo trace.

### CONFIG_VALIDATED

O GET de configuração terminou com sucesso no backend e o frontend validou a forma mínima necessária ao loader. O backend só responde `ok:true` após `readPublishedProjectConfig`, que aplica as invariantes de leitura da revisão publicada.

### MIGRATED

O MapConfig foi normalizado pelo `KeplerGlSchema.load` ou pelo fallback seguro já existente. Não significa migration SQL/D1.

### ENGINE_HYDRATION_STARTED

O frontend está prestes a executar `addDataToMap` com datasets/config já validados e normalizados.

### MAP_READY

O trace só termina após hidratação iniciada, render do runtime com style carregado e, quando o Maõno Map Shell está ativo, `data-map-ready=true` e `data-map-loading=false`.

## Transporte

Os eventos permanecem em memória durante a abertura. Ao terminar em `MAP_READY`, erro terminal ou saída da página, um único lote é enviado para `/api/observability/map-load`.

O endpoint:

- exige sessão;
- valida ordem, duração e correlationId;
- reduz o payload a uma allowlist;
- registra apenas metadados seguros via structured log;
- não grava D1.

## Privacidade

É proibido registrar:

- datasets;
- rows/features;
- GeoJSON, geometria ou coordenadas;
- MapConfig/configuração completa;
- filtros com valores de negócio;
- tokens, cookies e Authorization;
- caminhos Dropbox;
- SQL;
- URLs assinadas.

O sanitizador do backend reconstrói o payload exclusivamente a partir da allowlist, portanto campos extras nunca chegam ao log.

## Não escopo

- metas de p50/p75/p95;
- Load Guard real;
- streaming;
- PostGIS;
- materializações;
- catálogo de datasets;
- degradação de render;
- migration D1.

Esses trabalhos só podem começar após o GATE A.
