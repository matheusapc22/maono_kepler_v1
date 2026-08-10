# ADR-006 - Performance Safety Plane

- Status: Accepted
- Data: 2026-08-10
- Snapshot: `aec5227d289fc8644cb22e9c083ff4ef44ef6e9e`

## Contexto

Mapas e GeoJSONs podem exceder a capacidade segura de CPU, memória, GPU ou main thread do dispositivo do usuário. A plataforma precisa decidir risco antes de transportar/processar payloads perigosos.

## Decisão

A Maõno terá um **Performance Safety Plane** independente do renderer.

Ele será responsável por métricas de complexidade, classificação de dispositivo, policy engine, decisões SAFE/WARN/BLOCK/PENDING/STALE, performance budgets e futura seleção de representação apropriada.

## Consequências

- O servidor define hard caps; o cliente pode apenas tornar a política mais conservadora.
- O Load Guard deve ocorrer antes de download/parse/hidratação pesada.
- Limites finais serão derivados de benchmark, não de estimativas arbitrárias.
- PostGIS e representação otimizada complementam o Safety Plane, mas não o substituem.
