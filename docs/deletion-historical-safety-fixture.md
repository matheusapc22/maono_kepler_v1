# Historical deletion safety fixture

This is a complete **object projection for local deletion-safety tests**, not a recovered production SQL dump, general DDL equivalence certificate, migration, or approved operational profile. Production comparison remains blocked. No row from production is included.

## Inventory and source chain

The sanitized audit run [43144802055](https://github.com/matheusapc22/maono_kepler_v1/actions/runs/43144802055), product `4f48ed5d8299fca3745807e47baf78369578e5e8`, contains 532 non-SQLite-reserved objects. The fixture accounts for all of them:

- 469 exact canonical-source objects: 95 tables, 249 triggers, 125 explicit indexes.
- 30 exact versioned reconstructions: 13 tables, eight triggers, nine explicit indexes. These use the source chains already independently matched to the audit, not inferred DDL.
- 31 complete structural AST projections: seven tables and 24 explicit indexes. These are proposed safety references requiring review, not independent historical provenance. Versioned consumers supporting their role are listed per object, but consumers do not prove original DDL. `ticket_comments` has no current consumer located; its dependency remains, and no absence of data is inferred.
- Two explicitly accounted internal envelope objects: `d1_migrations` and protected `_cf_KV`. Neither is created in the application fixture; the protected object is not introspected. Both remain in the recorded audit envelope and full observed snapshot digest. Local workerd may create a different officially classified internal object; that does not silently substitute for the observed envelope.

The resulting application database has exactly **115 tables, 257 triggers, 158 explicit indexes, 1080 columns, 291 indexes including implicit ones, and 286 FK components**. The production audit's 1083 columns include the three ledger columns. The ledger/profile handling is not redefined by this fixture.

`tests/fixtures/deletion-historical-safety/manifest.json` pins each object's provenance and 23 source files. Two historical schema files are vendored with original Git revisions and file hashes so shallow CI does not need network/history access. For 30 reconstructed objects, each CREATE/ALTER statement must still exist verbatim in the pinned source and is replayed to regenerate the expected definition. Canonical definitions are regenerated from the canonical source. All 499 results must match the verified object definitions.

`schema.sql` is a fixed, local fixture, not a production migration. The helper verifies the inventory and every definition. Complete ASTs, not just hashes, cover the 31 structural projections. For their 24 indexes, the complete AST is authoritative for the local projection comparison, so formatting-sensitive SQL digests are not compared as semantic claims. Index keys, order, uniqueness, partial status, components, collations and creation-sequence metadata are still checked.

## Exactly seven synthetic values

Only these scalar default values are deliberately replaced:

- `role_permissions.scope_type`: synthetic text `fixture_scope`.
- `role_permissions.active`: synthetic number 11.
- `user_permissions.active`: synthetic number 13.
- `organization_feature_flags.enabled`: synthetic number 17.
- `ticket_comments.internal`: synthetic number 19.
- `tickets.status`: synthetic text `fixture_status`.
- `tickets.priority`: synthetic text `fixture_priority`.

These choices deliberately do not assert normal application defaults. No remote literal was guessed, enumerated or inferred from a hash. Test mutations preserve each slot's scalar class; functions, new expressions, changed classes, removed defaults and other default slots fail. Seven local values vary independently while the projected safety shape remains unchanged and the complete fixture snapshot-plus-envelope digest changes. The original observed full snapshot digest is retained separately and is never replaced by a fixture digest.

This establishes **fixture structure and explicit abstraction boundaries**, not that every application behavior is independent of those defaults. Runtime authorization, content lifecycle and all cleanup effects still require their own behavioral proof. `operationalApproval` remains false. The existing canonical audit continues to reject the historical profile, including all ten missing guard targets.

## Guard boundary

The unchanged canonical 0044 compiles against this complete application fixture, installing 62 direct INSERT/UPDATE pairs plus its special organization guards. It leaves exactly ten historical tables without pairs. The test reports that gap; it does not add a migration or silently omit those tables. Any future historical migration must be reviewed separately, include the required fixed guards, preserve OLD/NEW handling and pass physical cleanup/concurrency tests on this fixture.

## Reproducible checks

Run `node --test tests/deletion-historical-fixture.test.mjs` or the existing production migration gate, which now includes that test file. Tests replay all source chains, check complete metadata, verify seven scalar variations and fresh digests, reject missing/extra objects and changed FKs/constraints/predicates/triggers, and demonstrate that production compatibility is still false.

No runtime, canonical schema, migration, protected operator or compatibility reference is changed by this fixture-only work. No deployment, production query, remote dispatch or migration application is part of validation.

## Initialization is deliberately separate

Object completeness does not mean initialized application state or behavioral certification. This fixture intentionally contains no business rows and does not replay data backfills. A future behavioral fixture must explicitly load its required, versioned bootstrap rows before asserting epoch changes; otherwise an UPDATE of a missing singleton could produce a false-positive test.

Verified non-business bootstrap seeds in pinned `schema.sql` (same revision/hash as the manifest):

- `cc08_schema`: `INSERT INTO cc08_schema VALUES(1);`
- `ticket_sla_schema`: `INSERT INTO ticket_sla_schema VALUES(1);`
- `ticket_export_generation`: `INSERT INTO ticket_export_generation(id,version) VALUES(1,0);`
- `project_save_operation_schema`: `INSERT INTO project_save_operation_schema(version) VALUES (1);`
- `project_save_authorization_generation`: `INSERT INTO project_save_authorization_generation(id) VALUES (1);`
- `project_preview_operation_schema`: `INSERT INTO project_preview_operation_schema VALUES(1);`

These are source-defined local initialization values, not observations of production rows. The separate `app_schema_metadata` bootstrap is in pinned `migrations/0019_save_deploy_contract.sql`. Which seeds an execution test needs must be explicit; no business backfill should be inferred from this list. They are documented here but not executed by the structural-only fixture.
