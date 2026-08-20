# MACRO C — Execution Baseline (C0)

Data de captura: 2026-08-20

## 1. Base autoritativa

- Repositório: `matheusapc22/maono_kepler_v1`
- Branch base: `mano_kepler_v1`
- SHA congelado para abertura do C0: `46fbf2ec434be9d22e51d1575eb608e83f9d5cdb`
- Commit: merge da PR #70 — `feat: S07 observabilidade do carregamento e Gate A`
- Branch de execução da S17: `feat/s17-maono-mapschema-v1`

A branch S17 foi criada diretamente de `mano_kepler_v1`. O C0 não deve ser empilhado sobre a branch da S08.

## 2. Estado da PR #71 / S08 no início do C0

- PR: #71 — `feat: S08 benchmark harness da Performance Safety Plane`
- Estado: OPEN / DRAFT
- Base: `mano_kepler_v1`
- Base SHA: `46fbf2ec434be9d22e51d1575eb608e83f9d5cdb`
- Head: `feat/s08-benchmark-harness`
- Head SHA observado: `bb05abda6857b3fe92edd2e1e9aa0efebef9ef08`
- Commits observados: 58
- Mergeable no momento da captura: `true`

Regra operacional: S17 pode evoluir em paralelo apenas enquanto não depender de mudanças da S08. Antes da primeira alteração funcional no hot path, rebasear a branch S17 sobre a `mano_kepler_v1` atualizada após a integração da S08.

## 3. Migrations existentes no repositório

Snapshot observado em `mano_kepler_v1`:

1. `0002_organizations_files.sql`
2. `0006_create_organization_exports.sql`
3. `0007_create_organization_limit_requests.sql`
4. `0007_project_save_role_permissions.sql`
5. `0008_harden_organization_files.sql`
6. `0008_session_active_organization.sql`
7. `0009_organization_storage_invariant.sql`
8. `0010_ticket_center.sql`
9. `0011_roadmap_gantt.sql`
10. `0012_access_delegation_policy.sql`
11. `0013_user_permission_denials.sql`
12. `0014_project_metadata_ownership.sql`
13. `0015_project_preview_lifecycle.sql`
14. `0016_map_panel_navigation_and_quota.sql`
15. `0017_map_isochrone_rate_limit.sql`
16. `0018_project_lifecycle.sql`

### Observação de numeração

O histórico já possui números repetidos (`0007` e `0008`). O C0 não cria migration nova e não reserva `0019`. A numeração da futura migration de Dataset deve ser definida apenas quando a S20 for iniciada, após reconciliar quaisquer migrations adicionadas por S09–S16 ou outros trabalhos paralelos.

## 4. Contratos arquiteturais já vigentes

- D1 é Control Plane; não é storage principal de geometrias volumosas.
- Storage de objetos é uma porta de infraestrutura; Dropbox permanece implementação atual.
- `project_config_revisions` registra revisões imutáveis do MapConfig e `projects.config_revision` é o HEAD autoritativo.
- O formato persistente atual continua `legacy-kepler@1`.
- Kepler é engine de apresentação e deve permanecer atrás da Anti-Corruption Layer / Engine Adapter.
- PostGIS está decidido como futuro Spatial Data Plane, mas não é implementado no C0/S17.

## 5. Hot paths que o C0 não altera

- `/api/projects/:slug/config`
- `project-config-service.js`
- `project-config-integrity.js`
- `MapConfigRepository`
- `map-url-loader`
- hidratação via `KeplerGlSchema.load`
- dispatch `addDataToMap`
- save/publicação de revisão
- lifecycle de projeto
- schema D1

## 6. Baseline de CI imediatamente anterior ao merge da base

A execução de GitHub Actions associada ao head da PR #70 (`9e63099c1ad586435ce335acc2640f283a137fe8`) foi concluída com sucesso:

- Workflow run: `31548623661`
- Job: `validate`
- Build: SUCCESS
- Access governance and runtime tests: SUCCESS
- `GATE A — Foundation stability`: SUCCESS

O merge commit `46fbf2e...` não possui run `pull_request` próprio porque o workflow registrado foi executado no head da PR. Como o merge incorporou esse head e não há mudança funcional posterior na base capturada, essa execução é a evidência de baseline pré-C0. A PR C0/S17 deverá produzir sua própria execução verde antes de qualquer merge.

## 7. Regra de saída do C0

C0 só é considerado concluído quando:

- Golden Maps sintéticos/sanitizados estiverem versionados;
- semantic snapshots estiverem versionados e determinísticos;
- `test:macro-c-gate` existir sem duplicar o GATE A;
- allowlist inicial de imports Kepler estiver congelada;
- build, GATE A e gate C0 da nova PR estiverem verdes;
- nenhuma migration D1 ou alteração do hot path tiver sido introduzida.
