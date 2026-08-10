# ADR-001 - Kepler como presentation engine

- Status: Accepted
- Data: 2026-08-10
- Snapshot: `aec5227d289fc8644cb22e9c083ff4ef44ef6e9e`

## Contexto

A plataforma utiliza Kepler.gl 3.1.x como motor de visualização e interação cartográfica. Ao longo da evolução, regras de produto Maõno passaram a coexistir com detalhes internos do Kepler.

## Decisão

Kepler.gl será tratado como **presentation engine cartográfico**, responsável por renderização, interação visual e capacidades que a plataforma optar por reutilizar.

Regras de domínio, autorização, persistência, análises espaciais, versionamento, governança e políticas de performance pertencem à Maõno e não devem depender diretamente do estado interno do Kepler.

## Consequências

- Atualizações do Kepler devem ser absorvidas preferencialmente pela camada de integração.
- Funcionalidades novas não devem usar o Redux/DOM interno do Kepler como fonte de verdade de produto.
- O Kepler pode continuar sendo substituído/estendido sem redefinir o domínio Maõno.
