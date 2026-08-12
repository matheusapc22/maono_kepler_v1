# S08 — Benchmark Harness

## Papel na MACROFASE B

A S08 é a primeira etapa do Performance Safety Plane e existe para produzir evidência antes de qualquer política de limite.

A ordem obrigatória permanece:

`benchmark -> analyzer -> D1/metadata -> shadow -> calibração -> warn -> block`

Nenhum número de `safe`, `warn`, `block`, `risk_score` ou threshold operacional é definido nesta sprint.

## Corpus canônico

O corpus é sintético, determinístico e não utiliza dados de clientes.

Dimensões cobertas:

- JSON: 2, 5, 10, 20 e 40 MiB;
- features: 10k, 50k, 100k, 250k, 500k e 1M;
- posições coordenadas: 100k, 250k, 500k, 1M, 2M e 5M;
- maior feature: 10k, 50k, 100k, 250k e 500k posições;
- geometrias: Point, LineString, Polygon, MultiPolygon, Polygon com holes e GeometryCollection;
- layers visíveis: 1, 3, 5, 10 e 20.

O corpus não usa produto cartesiano completo. Ele é dividido em sweeps controlados de bytes, features, posições, tipo geométrico, maior feature e fan-out de layers.

## Artefatos locais

Os arquivos grandes são gerados em:

`.benchmark-data/s08/`

Esse diretório é ignorado pelo Git.

O repositório versiona somente:

- especificação do corpus;
- gerador;
- seeds;
- contrato dos resultados;
- harness;
- scripts de relatório;
- testes;
- resultados finais selecionados quando aprovados para documentação.

## Comandos

Gerar corpus completo:

```bash
npm run benchmark:s08:generate
```

Gerar somente corpus pequeno para smoke:

```bash
npm run benchmark:s08:generate:smoke
```

Abrir harness local:

```bash
npm run benchmark:s08:serve
```

URL padrão:

`http://localhost:4174/benchmarks/s08/index.html`

Gerar relatório a partir dos resultados locais:

```bash
npm run benchmark:s08:report
```

Rodar gates estruturais:

```bash
npm run test:benchmark-harness
```

## Dispositivos obrigatórios

A calibração futura deve possuir resultados de quatro equipamentos físicos:

1. `ENTRY_NOTEBOOK`;
2. `STANDARD_NOTEBOOK`;
3. `HIGH_END_DESKTOP`;
4. `SUPPORTED_MOBILE`.

O arquivo `benchmarks/s08/device-profiles.example.json` deve ser copiado e preenchido com os equipamentos reais utilizados.

Emulação de mobile ou CPU throttling pode ser usada em investigação, mas não substitui hardware físico para derivar políticas futuras.

## Protocolo de execução

Para cada dispositivo:

1. fechar workloads concorrentes não relacionados;
2. registrar sistema operacional, browser e classe de hardware;
3. gerar o corpus a partir do mesmo commit;
4. abrir o harness;
5. executar uma passagem de aquecimento quando aplicável;
6. executar ao menos três runs medidos por fixture da rodada exploratória;
7. registrar separadamente `COLD` e `WARM` quando a família exigir comparação de cache;
8. repetir com maior amostragem nas regiões que exibirem inflexão, long tasks elevadas, queda de FPS, context loss, reload ou falha;
9. gerar o relatório agregado;
10. não transformar a observação em threshold dentro da S08.

## Métricas

O harness mede:

- TTFB;
- download do body;
- download total;
- `JSON.parse` no browser;
- `KeplerGlSchema.load`;
- tempo síncrono do dispatch `addDataToMap`;
- hidratação até primeiro render pronto;
- tempo total até mapa pronto;
- contagem, soma e maior Long Task;
- FPS médio;
- mediana, p95 e pior frame time;
- frames acima de 33,34 ms;
- disponibilidade e versão coarse de WebGL;
- context loss/context restored;
- heap JS quando a API do browser estiver disponível;
- outcome `SUCCESS`, `ERROR`, `TIMEOUT`, `RELOAD`, `WEBGL_CONTEXT_LOST`, `PAGE_CRASH` ou `INCOMPLETE`.

## Falha e reload

Ao iniciar um run, o harness registra estado mínimo em `sessionStorage`. Se a página reaparecer antes do resultado terminal, a execução anterior é registrada como `RELOAD`.

Esse mecanismo transforma travamentos/reloads em dado de benchmark em vez de simplesmente perder a execução.

## Privacidade

Resultados podem conter somente metadados e métricas coarse:

- fixture id;
- classe de dispositivo;
- browser class;
- viewport;
- bytes;
- contagens estruturais;
- timings;
- FPS;
- WebGL coarse;
- outcome e código técnico.

Resultados não podem conter:

- MapConfig;
- datasets;
- GeoJSON;
- features;
- coordenadas;
- geometrias;
- rows;
- tokens;
- cookies;
- headers de autorização;
- paths Dropbox;
- SQL;
- payload bruto.

## CI

GitHub Actions não executa o corpus pesado. O runner do CI não representa notebook de entrada, notebook padrão, desktop forte ou mobile suportado.

O CI executa apenas:

- build;
- GATE A de regressão;
- cobertura das dimensões do corpus;
- determinismo do gerador;
- geração de fixture pequeno;
- validação do contrato dos resultados;
- gate de privacidade;
- presença da instrumentação exigida.

## Definition of Done

A implementação da S08 está pronta quando:

- harness e gerador estão versionados e verdes em CI;
- GATE A continua verde;
- corpus completo pode ser gerado localmente;
- os quatro perfis físicos estão documentados;
- os quatro dispositivos executaram o protocolo real;
- resultados possuem repetição suficiente para revelar regiões de inflexão;
- relatório de evidência foi produzido;
- nenhum threshold operacional foi criado.

A etapa seguinte utiliza o corpus e sua ground truth para construir o Analyzer. A classificação `safe/warn/block` permanece proibida até as etapas posteriores de shadow e calibração.
