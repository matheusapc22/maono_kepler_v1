# S17 — Maõno Map Schema V1

## Status

Contrato canônico: `maono-map@1`.
Compatibilidade de leitura: `legacy-kepler@1` permanece suportado.
Persistência `maono-map@1`: controlada por `MAONO_MAP_SCHEMA_WRITE_V1` e desligada por padrão.

## Objetivo

Separar o contrato persistente Maõno do contrato interno do Kepler sem remover a compatibilidade existente. O documento V1 mantém um `engine.payload` Kepler temporário para round-trip e hidratação, enquanto os campos Maõno de alto nível passam a formar a fronteira que será evoluída nas S18–S23.

## Envelope V1

Campos obrigatórios:

- `schema`: literal `maono-map`;
- `version`: inteiro `1`;
- `map`: metadados de viewport/basemap que não carregam registros de dataset;
- `datasets`: referências leves; não podem copiar `allData`/`fields` volumosos;
- `layers`: referências leves entre identidade Maõno transitória e identidade do engine;
- `filters`: referências leves de filtros;
- `analyses`: lista, vazia quando não houver análise materializada;
- `engine.type`: `kepler` na V1;
- `engine.payload`: documento `legacy-kepler@1` completo e legível pelo bridge;
- `extensions`: objeto de extensões Maõno. É obrigatório no serializer/adaptador e aceito como opcional pelo validator para tolerar documentos V1 produzidos antes da normalização final.

## Detecção

`detectSchema(document)` possui quatro resultados sem heurística silenciosa: `legacy-kepler@1`, `maono-map@1`, `future` e `invalid`. `future` e `invalid` são fail-closed e não devem alcançar o engine.

## Canonical serialization

A serialização de `maono-map@1` ordena chaves de objetos recursivamente, preserva ordem de arrays, normaliza `-0` para `0`, rejeita valores fora de JSON/ciclos, não adiciona whitespace e produz UTF-8 determinístico para SHA-256 e `size_bytes` do ledger.

O formato `legacy-kepler@1` mantém a serialização histórica enquanto a write flag estiver OFF, preservando o rollback operacional.

## Adapter legado

`legacyKeplerToMaonoMapV1` é puramente em memória. Abrir um mapa legado nunca persiste uma migração automaticamente. O dataset volumoso continua existindo uma única vez em `engine.payload.datasets`; o array Maõno `datasets` contém somente identidade/ref/label. `extensions` preserva o conteúdo de `legacy.maono` e o bridge de volta ao Kepler o mescla sem remover campos desconhecidos.

## Regras de integração S17

- `project_config_revisions` não sofre migration;
- `schema_name`, `schema_version`, checksum, size e storage ref existentes são reutilizados;
- o backend valida que metadata do ledger e conteúdo detectado coincidem;
- `MAONO_MAP_SCHEMA_WRITE_V1=OFF` mantém escrita legacy;
- `MAONO_MAP_SCHEMA_WRITE_V1=ON` converte o JSON Kepler recebido para `maono-map@1` antes de reservar a revisão;
- leitura é dual independentemente da write flag;
- versão futura jamais é convertida implicitamente.

## Rollback

Desligar `MAONO_MAP_SCHEMA_WRITE_V1` impede novas gravações V1 sem migration. Revisões V1 já publicadas continuam legíveis pelo loader dual. O rollback não exige alterar D1 nem reescrever revisões imutáveis.
