# Read-only 0044 schema audit

This collector is called by the existing protected production D1 operator in `audit` mode for `0044_organization_permanent_deletion.sql`. Dispatch remains on `main`, and the runner checks out the pinned `mano_kepler_v1` SHA. No new arbitrary SQL or command input is introduced.

## Evidence and limits

The collector reads three fixed metadata projections: SQLite objects and definitions, table columns (including hidden/generated columns), and foreign keys. It repeats the complete collection and rejects drift. This is a stable observed metadata sequence, not an atomic database snapshot. It does not read application rows or prove an organization empty, provider storage empty, or feature rollout safe.

Definitions and default expressions stay in runner memory; artifacts contain definition digests, safe identifiers, FK relationships, table inventory, planned guard hashes and mismatch codes. Malformed, duplicated, unbounded or unexpected response fields are rejected. Only SQLite-reserved names are excluded. The exact d1_migrations ledger has a narrow accepted column shape with no foreign keys; unknown d1_ and _cf_ objects remain visible and fail closed. Runtime inventory uses the same SQLite-only exclusion, so prefix lookalikes cannot hide tenant dependencies.

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
