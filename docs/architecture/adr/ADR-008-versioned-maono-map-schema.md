# ADR-008 - Schema Maõno versionado

- Status: Accepted
- Data: 2026-08-10
- Snapshot: `aec5227d289fc8644cb22e9c083ff4ef44ef6e9e`

## Contexto

O formato persistente atual é centrado no JSON do Kepler, com extensões Maõno adicionadas de forma incremental. Isso dificulta evolução independente, migrations formais e compatibilidade de longo prazo.

## Decisão

A plataforma adotará um envelope persistente próprio, **`maono-map` versionado**, capaz de encapsular o estado da engine e os domínios Maõno.

Estrutura-alvo conceitual:

```json
{
  "schema": "maono-map",
  "version": 1,
  "engine": {"type": "kepler"},
  "map": {},
  "layers": [],
  "filters": [],
  "analyses": [],
  "extensions": {}
}
```

## Consequências

- Toda mudança persistente deverá possuir versão/migration quando aplicável.
- O estado Kepler poderá continuar encapsulado durante a migração.
- Golden Maps e Migration Registry protegerão compatibilidade histórica.
- A S00 não muda o formato salvo atual; apenas congela a decisão arquitetural.
