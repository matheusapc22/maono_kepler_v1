# ADR-007 - Uma layer lógica para clustering

- Status: Accepted
- Data: 2026-08-10
- Snapshot: `aec5227d289fc8644cb22e9c083ff4ef44ef6e9e`

## Contexto

A evolução do agrupamento espacial mostrou que criar layers Redux separadas para pontos e clusters causa inconsistências de visibilidade, ordenação e UX. A implementação atual usa uma única layer lógica e troca apenas a representação renderizada conforme zoom/política.

## Decisão

Clustering será uma **estratégia de rendering de uma única MapLayer lógica**.

A identidade, dataset, ordem, filtros e visibilidade permanecem únicos. Point/cluster/heatmap podem ser representações internas, mas não devem criar duplicações lógicas para o usuário ou para a persistência.

## Consequências

- O Redux/estado de domínio não deve ganhar uma segunda layer para cluster.
- A paridade com o cluster nativo deve ser medida em membership, count, filtros, zoom e agregação.
- A configuração `spatialGrouping` pertence à layer lógica e será versionada no schema Maõno.
