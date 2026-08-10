# ADR-002 - Engine Adapter como Anti-Corruption Layer

- Status: Accepted
- Data: 2026-08-10
- Snapshot: `aec5227d289fc8644cb22e9c083ff4ef44ef6e9e`

## Contexto

A plataforma já possui `KeplerEngineAdapterProvider`, comandos e selectors próprios, mas ainda existem bridges e componentes que conhecem detalhes da engine.

## Decisão

O Engine Adapter será a **Anti-Corruption Layer (ACL)** oficial entre o domínio Maõno e Kepler.gl.

Toda operação persistente ou semântica sobre layers, filtros, viewport, overlays, serialização e análises deverá convergir progressivamente para contratos Maõno expostos pelo adapter.

## Consequências

- UI não deve importar novas actions Kepler diretamente.
- Acesso a `state.demo.keplerGl` fora da infraestrutura de integração será progressivamente removido.
- Contract tests deverão proteger a fronteira em fases posteriores.
- Bridges legados podem coexistir durante migração, mas precisam de plano de retirada.
