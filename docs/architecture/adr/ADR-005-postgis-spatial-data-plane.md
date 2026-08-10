# ADR-005 - PostGIS como Spatial Data Plane

- Status: Accepted
- Data: 2026-08-10
- Snapshot: `aec5227d289fc8644cb22e9c083ff4ef44ef6e9e`

## Contexto

Análises espaciais volumosas e futuras representações server-side não devem depender da memória/CPU/GPU do navegador. O planejamento técnico aprovado define D1 como control plane, storage como origem e PostGIS como camada derivada de execução.

## Decisão

PostGIS será o **Spatial Data Plane** da Maõno Maps.

Ele armazenará representações espaciais derivadas, versionadas e reconstruíveis para predicates, agregações, filtros server-side e futura geração de produtos como MVT.

## Consequências

- PostGIS não substitui a fonte original de arquivos.
- Datasets espaciais terão catálogo/versão no D1.
- Ingestão será assíncrona, idempotente e separada das requests HTTP.
- Consultas deverão aplicar tenant/projeto/dataset/versão explicitamente.
- Implementação física pertence às macrofases futuras; a S00 registra apenas a decisão.
