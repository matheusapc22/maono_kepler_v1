# ADR-004 - Storage como fonte/repositório de objetos

- Status: Accepted
- Data: 2026-08-10
- Snapshot: `aec5227d289fc8644cb22e9c083ff4ef44ef6e9e`

## Contexto

Projetos, configurações, arquivos importados e thumbnails são hoje persistidos principalmente via Dropbox, com metadados e referências no D1. O repositório também possui um modo `local-d1` para desenvolvimento local.

## Decisão

A plataforma tratará o storage de objetos como **porta de infraestrutura**, e não como parte do domínio.

No estado atual, Dropbox permanece a implementação principal e fonte reconstruível dos objetos. A arquitetura deve evoluir para um `MapConfigRepository/ObjectStoragePort`, permitindo futuras implementações como R2/S3 sem alterar UI ou domínio.

## Consequências

- Caminhos internos do Dropbox não devem vazar para contratos públicos.
- O D1 referencia objetos; não substitui o storage em produção.
- Configurações e artefatos devem evoluir para revisão/checksum antes de mudanças de storage.
- O modo `local-d1` permanece restrito ao desenvolvimento e testes.
