# Arquitetura Maõno Maps

Este diretório concentra as decisões e o baseline arquitetural da plataforma Maõno Maps.

## Regra de governança

Mudanças estruturais devem atualizar ou criar um ADR quando alterarem fronteiras de responsabilidade, persistência, engine cartográfica, segurança, performance ou processamento espacial.

## Estrutura

- `adr/`: Architecture Decision Records.
- `baseline/`: inventários e snapshots de arquitetura.

## Snapshot inicial

A S00 da Sprint de Consolidação Arquitetural foi congelada sobre a branch `mano_kepler_v1` no commit `aec5227d289fc8644cb22e9c083ff4ef44ef6e9e` (merge da PR #60).

A S00 é exclusivamente documental: não altera runtime, schema, migrations, flags, APIs ou comportamento de usuário.
