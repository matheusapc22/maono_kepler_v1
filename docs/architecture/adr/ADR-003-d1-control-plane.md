# ADR-003 - D1 como Control Plane

- Status: Accepted
- Data: 2026-08-10
- Snapshot: `aec5227d289fc8644cb22e9c083ff4ef44ef6e9e`

## Contexto

O D1 já armazena identidade, sessões, organizações, projetos, permissões, metadados de arquivos, auditoria, quotas, previews e rate limits.

## Decisão

Cloudflare D1 será o **Control Plane** da plataforma Maõno Maps.

O D1 mantém metadados, estados, políticas, referências, versões e auditoria. Ele não deve ser usado como repositório principal de geometrias volumosas nem como object storage genérico em produção.

## Consequências

- Novos recursos persistentes devem registrar estado operacional e relações no D1 quando aplicável.
- Dados espaciais massivos serão derivados para PostGIS.
- Configs e objetos permanecem em repositório de objetos/storage.
- Migrations D1 precisam evoluir para registro/versionamento formal em fases posteriores.
