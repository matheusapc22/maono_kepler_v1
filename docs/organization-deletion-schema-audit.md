# Read-only 0044 schema audit

This collector is called by the existing protected production D1 operator in `audit` mode for `0044_organization_permanent_deletion.sql`. Dispatch remains on `main`, and the runner checks out the pinned `mano_kepler_v1` SHA. No new arbitrary SQL or command input is introduced.

## Evidence and limits

The collector reads fixed metadata projections for SQLite objects and definitions, table columns (including hidden/generated columns), foreign keys, indexes and ordered index components. It repeats the complete collection and rejects drift. This is a stable observed metadata sequence, not an atomic database snapshot. It does not read application rows or prove an organization empty, provider storage empty, or feature rollout safe.

Definitions and default expressions stay in runner memory; artifacts contain definition digests, safe identifiers, FK relationships, table inventory, planned guard hashes and mismatch codes. Malformed, duplicated, unbounded or unexpected response fields are rejected. Only SQLite-reserved names are excluded. The exact d1_migrations ledger has a narrow accepted column shape with no foreign keys; unknown d1_ and _cf_ objects remain visible and fail closed. Runtime inventory also retains prefix lookalikes, so they cannot hide tenant dependencies.

The reviewed baseline is hash-pinned canonical schema immediately before 0044. Full definitions are checked, with SQL literal contents preserved. Historical or unknown tables, views, indexes, triggers, virtual tables, missing objects and changed shapes fail closed. A historical deployment can therefore produce a useful blocked report rather than an approval hash. This is intentional: a successful generic migration preflight is not deletion readiness.

## Historical coverage requiring review

The actual 0006 and 0011 migration fixtures add these seven organization-linked tables absent from the canonical baseline and planned 0044 guard pairs:

- organization_exports
- organization_roadmaps
- roadmap_phases
- roadmap_tasks
- roadmap_dependencies
- roadmap_comments
- roadmap_events

Their presence in production must be observed, not assumed from repository history. An empty historical table still blocks runtime deletion without its insert/update exclusion guards. Unknown direct dependencies and indirect FK descendants are inventoried; unknown objects are not silently blessed. Do not remove blockers or add production guards without a separately reviewed migration plan.

## Authorization

A compatible audit binds its metadata digest into the existing approval material for 0044. Apply requires that digest and re-collects metadata both during preflight and immediately before the isolated write. Other migration approval formats are unchanged. The audit cannot authorize its own apply; an explicit human authorization for the exact migration and hash, the protected environment gate, and all existing integrity, pending-set and backup checks remain mandatory.

Schema changes can still occur after the last read. Production schema changes must remain serialized through the protected operator. No row mutation, flag activation, migration apply, merge or deployment is performed by this collector.

## Local verification

`npm run test:production-migration-gate` includes the new metadata tests with canonical and real historical fixtures, unknown direct/indirect dependencies, view/trigger/virtual-table drift, literal confidentiality, malformed responses, collection drift, source drift and approval binding. All fixtures are local synthetic SQLite databases.

## D1 protected internal metadata

D1/workerd allows object enumeration but denies application PRAGMA introspection of protected internal tables. The local reproduction used Wrangler 4.140.0 and synthetic data only: both sqlite_schema and sqlite_master enumeration succeeded, while table_xinfo and foreign_key_list on `_cf_METADATA` failed with SQLITE_AUTH. The same correlated PRAGMA joins succeeded for application tables. This does not establish which internal objects exist in Production.

The collector and runtime classify protected objects before introspection. Recognition requires exact reviewed names and complete tokenized official DDL, with no unexpected associated objects. Unrecognized protected names, case variants, changed definitions, or application foreign keys targeting protected objects fail closed. Recognized objects remain visible in the metadata evidence and digest; their columns are not represented as independently PRAGMA-verified. This does not grant access to internal data or broaden credentials. Generic `_cf_*` and `d1_*` exclusions remain forbidden.

Official sources:
- https://developers.cloudflare.com/d1/sql-api/sql-statements/
- https://github.com/cloudflare/workerd/blob/aa494794c44a900592c8281b191302d3b0a6e2a5/src/workerd/util/sqlite-metadata.c%2B%2B
- https://github.com/cloudflare/workerd/blob/aa494794c44a900592c8281b191302d3b0a6e2a5/src/workerd/util/sqlite-kv.c%2B%2B
- https://github.com/cloudflare/workerd/blob/2c8abc502175df3e7dd54cb05a7110659125563b/src/workerd/api/sql.c%2B%2B

The regulator's `_cf_` restriction is case-insensitive; recognition is deliberately stricter. Upstream definitions are reference evidence, not proof of a remote object's identity or shape. Unexpected shapes require review rather than an authorizer workaround.

Read diagnostics distinguish DELETION_OBJECTS, DELETION_COLUMNS, DELETION_FOREIGN_KEYS, DELETION_INDEXES and DELETION_INDEX_COLUMNS. A failed 0044 audit with an explicit report path writes `<report>.failure.json`, containing only a sanitized error and false writesPerformed/readyForAuthorization flags. The existing always-run artifact upload retains that file. It contains no approval hash, raw SQL, defaults, credentials or business rows. Earlier migration failure-artifact contracts and workflow protection remain unchanged.

Local correction verification used a fresh synthetic D1 database with canonical pre-0044 schema and the genuine workerd-created `_cf_METADATA` object. All three corrected queries succeeded, and the evaluator returned compatible=true for 103 tables with no mismatches. This verifies local workerd compatibility, not Production readiness. On Windows, capture Wrangler JSON as UTF-8; default console decoding can corrupt non-ASCII SQL literals and must not be compensated by weakening definition comparison.

## Sanitized structural diagnostics

Structural evidence is diagnostic, not a new schema allowlist. Unknown objects, missing guards and changed definitions still block authorization. The additional projections participate in both complete reads and the metadata/evidence digests, including the rechecks before any separately authorized apply.

Column evidence contains validated names and bounded structural fields. Default expressions are represented only by presence and digest. Declared types and collations are not assumed safe: only explicitly recognized values may appear as text; other values are hashed. Foreign keys include every inspected application table and preserve id/seq ordering for composite constraints. Index evidence includes uniqueness, origin, partial status and ordered component metadata; expression and rowid components retain their structural distinction without exporting expression text. Index definitions are represented by digests, not raw SQL or partial-index predicates.

A digest can confirm equality with a reviewed candidate source. It cannot explain an unknown predicate, establish the business purpose of a table, or justify accepting an observed schema automatically. Historical reference profiles must be reconstructed from reviewed versioned sources and compared completely. If sources are missing, keep the mismatch blocked and obtain additional reviewed structural evidence rather than guessing DDL.

No business rows, row counts or organization eligibility are inferred from this schema audit. It does not prove provider storage empty or authorize cleanup. Direct and indirect guard coverage, retention/removal policy, and concurrency require separate implementation and tests; these diagnostic fields do not change those policies.

The version 2 report adds `structuralMetadata` with columns, all inspected foreign keys, and indexes with ordered components. The index projections include per-table index counts and per-index component counts, so missing groups/components fail closed rather than producing a seemingly complete report. Local Wrangler 4.140.0 verification of the extended projections passed against the same synthetic canonical fixture: 103 tables, 957 column descriptors, 253 indexes (including implicit indexes), and 256 foreign-key component rows. These counts describe the synthetic fixture only.

## Pending 0044 ownership-update fence

Each of the 62 direct organization UPDATE guards in pending migration 0044 and the canonical bootstrap checks both OLD.organization_id and NEW.organization_id against the deletion records. A locked organization must not lose a row through reassignment to another organization or NULL, and another organization must not move a row into a locked organization. Updates within a locked organization remain blocked. Unlocked-to-unlocked updates retain their existing behavior, subject to all other application constraints.

The correction does not change INSERT guards, the three special organization guards, session detachment, DELETE-based access cleanup, retained audit archival, or the finalization transaction. It does not add the missing historical guards or certify an unknown schema. The pending migration and canonical source hashes change, so previous audit evidence cannot authorize the revised migration. A new protected read-only audit and separate exact-hash human approval remain required before any production application.

Regression coverage must exercise all guard definitions and movement directions, NULL ownership, locked non-ownership updates, preserved INSERT fences, frozen-claim interleavings and the legitimate end-to-end cleanup/finalization path. Passing these tests does not establish production organization eligibility or provider-storage emptiness.
