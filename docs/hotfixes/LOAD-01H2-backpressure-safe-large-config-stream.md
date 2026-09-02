# LOAD-01H2 — Backpressure-safe & resilient Large MapConfig load

## Prioridade

P0 — hotfix de produção.

## Estado de partida

Base: `mano_kepler_v1` após merge da PR #123.

Commit-base: `9e06d09a895e987bc7c3bb41a49d000545c75c58`.

O projeto `demo` possui MapConfig na ordem de ~89 MiB. O mesmo projeto, sem evidência de troca de conteúdo entre as tentativas, apresenta comportamento intermitente: em algumas cargas abre corretamente; em outras o frontend exibe `A configuração armazenada não está em JSON válido.`

Esse padrão torna corrupção persistente do arquivo uma hipótese secundária e eleva falha/interrupção do transporte do body a hipótese principal.

## Diagnóstico técnico

### 1. O texto `JSON inválido` é ambíguo

Hoje o loader executa `await response.json()` e transforma qualquer exceção em `A configuração armazenada não está em JSON válido.`. Isso mistura pelo menos quatro classes diferentes:

- JSON realmente inválido;
- stream interrompido;
- conexão/body encerrado antes do EOF;
- falha/abort durante a transferência.

### 2. O LOAD-01H não preserva backpressure corretamente

`config-stream.js` envolve o `upstream.body` em um `ReadableStream`, mas o wrapper atual inicia um `pump()` recursivo dentro de `start()`:

`reader.read() -> enqueue() -> pump() -> reader.read() -> ...`

A leitura do Dropbox não é condicionada à demanda downstream (`pull()` / `controller.desiredSize`). Para um MapConfig de ~89 MiB o Worker pode ler mais rápido que o navegador consome e acumular chunks na fila do isolate, reintroduzindo pressão de memória justamente no caminho criado para evitá-la.

### 3. Retry atual termina nos headers

O frontend possui retry de GET para falha de rede ou HTTP retryable antes da resposta útil. Depois de receber HTTP 200, uma falha durante `response.json()` não reinicia o GET. Portanto uma oscilação no meio dos 89 MiB exige intervenção manual do usuário.

### 4. O endpoint já valida a revisão publicada no storage

Antes de iniciar o body, o backend confere metadata do objeto imutável publicado, incluindo tamanho e Dropbox `content_hash` quando disponíveis. Isso é suficiente para tratar o GET da revisão publicada como operação idempotente e segura para retry completo.

## Objetivo

Tornar o carregamento de MapConfigs grandes realmente streaming, bounded em memória e resiliente a interrupções transitórias de body, sem classificar falha de transporte como corrupção de JSON.

## Não objetivos

- não alterar save/lifecycle/CAS;
- não criar migration D1;
- não mudar formato do MapConfig;
- não externalizar datasets;
- não introduzir PostGIS/R2/PMTiles neste hotfix;
- não fazer retry infinito;
- não materializar o MapConfig inteiro no Worker;
- não fazer parser JSON server-side de ~89 MiB.

## Arquitetura proposta

### LOAD-01H2.1 — Stream server-side com backpressure real

Substituir o `pump()` recursivo em `ReadableStream.start()` por leitura dirigida por `pull(controller)`.

Fluxo desejado:

`browser demanda -> pull() -> reader.read() de 1 chunk -> enqueue -> aguarda nova demanda`

Garantias:

- no máximo O(1) chunks em trânsito no wrapper;
- o Worker não continua drenando o Dropbox quando o downstream está saturado;
- `cancel()` sempre propaga para o `reader` upstream;
- nenhuma chamada a `arrayBuffer()`, `text()` ou `json()` no Worker para o MapConfig.

### LOAD-01H2.2 — Watchdog compatível com backpressure

O watchdog de inatividade continua existindo, mas passa a proteger cada `reader.read()` solicitado pelo consumidor.

Política inicial:

- stream-start deadline: 20 s;
- inactivity deadline por leitura demandada: 20 s;
- timeout cancela o reader upstream e encerra o stream com erro;
- não executar leitura especulativa enquanto `pull()` não for solicitado.

O timeout não deve ser interpretado como JSON inválido no frontend.

### LOAD-01H2.3 — Content-Length / tamanho esperado explícito

Quando metadata e upstream confirmarem o mesmo tamanho, devolver:

- `X-Maono-Config-Size` — já existente;
- `Content-Length` — somente quando o valor for conhecido e coerente com o objeto servido.

Objetivo: permitir que o Fetch/browser detecte premature EOF como falha de body e não como documento JSON completo.

Nunca inventar `Content-Length` quando o tamanho não for conhecido com segurança.

### LOAD-01H2.4 — Retry end-to-end do GET, inclusive body

O retry passa a envolver a operação completa:

`fetch -> headers -> body -> response.json()`.

Para MapConfig grande e revisão imutável:

- tentativa 1 imediata;
- no máximo 1 retry automático de body neste hotfix (2 downloads totais);
- backoff inicial ~500–1000 ms + jitter;
- respeitar AbortController de navegação;
- HTTP 4xx não retryable permanece sem retry, exceto códigos já explicitamente classificados;
- retry de body somente para falha de transporte/stream; JSON completo porém sintaticamente inválido não entra em loop.

Motivo para limitar a 1 retry: um MapConfig de ~89 MiB torna cada repetição cara em banda e memória do browser.

### LOAD-01H2.5 — Revision pinning entre tentativas

Depois que a primeira resposta 200 fornece `X-Maono-Config-Revision = N`, qualquer retry do body deve pedir explicitamente a mesma revisão N.

Contrato proposto:

- frontend envia `X-Maono-Expected-Config-Revision: N` no retry;
- `config-stream` compara com a revisão publicada corrente;
- se o HEAD mudou, retorna `409 PROJECT_CONFIG_STREAM_REVISION_CHANGED` em vez de misturar duas revisões dentro da mesma tentativa lógica de carregamento.

Se a primeira tentativa falhar antes de receber headers, ainda não existe revision pin e o retry pode resolver a revisão publicada atual normalmente.

### LOAD-01H2.6 — Classificação correta de erro no frontend

Separar códigos:

- `MAP_CONFIG_STREAM_INTERRUPTED` — body/network interrompido após 200; retryable=true;
- `MAP_CONFIG_STREAM_TIMEOUT` — watchdog/abort de transporte; retryable=true;
- `MAP_CONFIG_STREAM_REVISION_CHANGED` — revisão mudou durante retry; retryable=false para a tentativa lógica, UI deve recarregar contexto;
- `MAP_CONFIG_STORED_JSON_INVALID` — somente quando o body foi recebido como documento completo e o parse sintático falhou; retryable=false.

A mensagem `A configuração armazenada não está em JSON válido.` deixa de ser fallback para qualquer exceção de `response.json()`.

### LOAD-01H2.7 — Observabilidade por tentativa

Registrar no trace de carregamento, sem conteúdo do projeto:

- correlationId;
- projectId;
- revision;
- attempt;
- expectedSizeBytes;
- responseStartMs;
- bodyDurationMs;
- failureClass (`headers`, `body`, `parse`, `revision_changed`);
- retryScheduled;
- finalOutcome.

Não registrar bytes do MapConfig, paths Dropbox, Authorization ou tokens.

## Fluxo final esperado

```text
GET config-stream
  ↓
metadata + content_hash OK
  ↓
headers 200 + revision N + size
  ↓
backpressure-safe body
  ↓
body completo?
  ├─ sim → JSON parse → hidratação Kepler
  └─ não → classifica STREAM_INTERRUPTED
            ↓
         1 retry GET da mesma revisão N
            ↓
         sucesso ou erro controlado
```

## Compatibilidade com SAVE-03 / SAVE-03H

- SAVE-03 continua responsável pela resiliência das chamadas Dropbox até obtenção da Response do provider;
- LOAD-01H2 cobre a fase posterior: entrega do body grande ao navegador;
- SAVE-03H continua responsável pelo upload grande em chunks;
- PR #123 continua responsável por reciclar N+1 abandonada e não publicada;
- nenhuma dessas garantias deve ser removida ou duplicada.

## Arquivos previstos

Alterar:

- `functions/api/projects/[slug]/config-stream.js`
- `src/pages/Kepler/map-url-loader/index.tsx`
- `src/pages/Kepler/observability/map-load-trace.ts` se necessário para métricas por tentativa
- `.github/workflows/save-contract-validation.yml` ou gate de runtime apropriado

Adicionar:

- `tests/project-config-stream-backpressure.test.mjs`
- `tests/project-large-load-resilience.test.mjs`

Opcional, se ajudar a manter o endpoint pequeno:

- `functions/_lib/backpressure-stream.js`

## Testes obrigatórios

### Servidor / stream

1. `pull()` lê apenas um chunk por demanda;
2. ausência de `pump()` recursivo no `start()`;
3. `cancel()` propaga ao upstream;
4. inactivity timeout cancela o reader;
5. start timeout continua protegido;
6. nenhum `arrayBuffer/text/json` sobre o MapConfig no Worker;
7. `Content-Length` só é emitido quando tamanho é confiável;
8. expected revision igual → 200;
9. expected revision diferente → 409 estruturado.

### Frontend

10. 200 + body completo + JSON válido → uma tentativa;
11. network failure antes dos headers → retry existente;
12. 200 + body interrompido → exatamente um retry end-to-end;
13. retry da mesma revisão → sucesso;
14. revisão muda entre tentativa 1 e retry → erro de revisão, não parse inválido;
15. body completo + SyntaxError real → `MAP_CONFIG_STORED_JSON_INVALID` sem loop;
16. AbortController de navegação interrompe tudo sem retry;
17. retry de projeto grande não excede duas transferências;
18. nenhum conteúdo do MapConfig aparece em logs/metrics.

### Regressão

19. projeto pequeno continua abrindo;
20. projeto legado continua abrindo;
21. projeto ACTIVE versionado continua abrindo;
22. projeto ~89 MiB abre repetidamente sem estado pendente infinito;
23. save pequeno e SAVE-03H permanecem inalterados;
24. Foundation Gate e Access Governance permanecem verdes.

## QA manual de produção/preview

No projeto `demo` (~89 MiB):

1. abrir e fechar o projeto 10 vezes no Preview;
2. registrar quantas cargas terminaram em sucesso;
3. repetir com DevTools aberto, sem throttling;
4. simular Slow 4G em 2 cargas;
5. confirmar que nenhum request fica indefinidamente em `Response headers (0)`;
6. confirmar que uma interrupção de body produz retry controlado;
7. confirmar que após sucesso aparecem as 7 camadas/15 filtros esperados;
8. alterar algo, salvar e reabrir;
9. repetir abertura 5 vezes após o novo save;
10. só liberar merge se não houver `1102`, parse falso ou spinner infinito.

## Critérios de aceite

- projeto ~89 MiB abre de forma repetível no Preview;
- nenhuma leitura contínua do Dropbox sem demanda downstream;
- falha de body tem no máximo 1 retry automático;
- revisão do retry permanece pinada;
- JSON inválido só é declarado quando houver evidência de body completo;
- nenhum request fica pendente indefinidamente;
- nenhuma regressão em save/lifecycle/permissões;
- CI, Foundation Gate e Cloudflare Preview verdes.

## Rollback

Reverter exclusivamente a PR LOAD-01H2. Nenhuma migration ou alteração persistente de D1 será criada por este hotfix.