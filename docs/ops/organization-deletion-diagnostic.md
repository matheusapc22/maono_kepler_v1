# Organization 10 diagnostic (read only)

This preparatory collector uses the existing protected production D1 migration operator. It does not apply 0043 or 0044, create infrastructure, change flags, delete rows, or access Dropbox.

Scope: organization ID 10 must retain slug maono-qa-organizacoes-20261102. Source context is owner-only workflow_dispatch on main, pinned clean mano_kepler_v1 SHA, canonical account/database and production-d1-migrations approval. No SQL, endpoint or organization ID input is added.

The existing post-0043 identity validation is reused before and after collection. Fixed SELECT/read-only PRAGMA statements check target state, path overlap, mixed permissions, unresolved management items, all organization_id dependencies, unusual organization foreign keys and integrity. Each dependency emits a hash of the structural table name, classification and count, not raw content. Map hashes to local schema names offline if needed.

Repeated matching reads are not an atomic database snapshot or an exclusive window. The result deliberately never claims deletion eligibility. Owner identity, Dropbox folder identity, contents/legacy root, runtime flags and acceptance remain to be verified separately. Global unresolved item counts are conservative diagnostics, not target-specific failures.

Deployment order: review and merge product scripts/tests first; narrowly port the workflow/test contract to main if different, without merging whole branches. Only then dispatch mode organization-deletion-diagnostic with migration 0043_organization_creation_identity.sql and empty approval_hash. This document prepares that path, not permission to dispatch or migrate.

An unexpected schema, missing/substituted target, malformed result or observed drift stops the collector. Failure output is minimized and never prints SQL rows or token details. Artifacts retain evidence for 3 days. No local production invocation is permitted by this preparation.

Local verification: node --test tests/organization-deletion-diagnostic.test.mjs; npm run test:production-migration-gate.
