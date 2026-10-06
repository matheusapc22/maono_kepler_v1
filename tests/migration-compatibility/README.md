# Pre-cutover migration compatibility

Run `node tests/migration-compatibility/run.mjs` with Node 24, Git history containing
`e12abfd908af81b0c55f2671ec71b161f820ef63`, and `tar`. No dependency install or credentials
are required. The dedicated workflow fetches history and uploads TAP and JSON evidence.

The runner extracts the **unchanged product runtime at that exact SHA** into a disposable
local directory. It adds the candidate migration files and instruments only the existing
test fixture, leaving production handlers, frontend, schema, packages, the 27 persistence
tests and five recycle tests untouched. Eight handler cases exercise real sessions,
ACL checks, inline/large/legacy saves, JSON/PNG reads, admin deletion, populated rows and
optional grants. SQLite executes actual SQL; only external Dropbox HTTP is simulated.
All real global fetches are rejected. After testing, all original product files are
checked byte-for-byte and the disposable directory is removed.

The same 40 cases run at baseline, after 0039, and after 0039 plus 0040. Each fixture uses
the exact old migration 0019 to supply the schema-19 metadata absent from `schema.sql`.
The migration hashes are pinned to the reviewed SQL; integrity checks must pass and the
new save/preview journals and outboxes must remain empty. Old revisions and projects
must not acquire durable operation/artifact IDs. Existing populated data, ACL grants
and JSON/PNG behavior must survive sequential migration application.

This is historical **pre-cutover** evidence: the additive migrations coexist with old
writers only before any durable operation has been accepted. It is not a rollback or
mixed-writer guarantee after cutover, a production D1 audit, a production ledger check,
or authorization to apply migrations or enable new writers. A merge does not apply SQL.
Use the protected production migration operator and its separate human approvals.

The pinned snapshot is test-only and is extracted at execution time, never shipped as
a legacy runtime or fallback. Future runtime changes do not change this historical
proof; their own tests must validate the new writers. Changing the pinned SHA or SQL
hashes requires a fresh compatibility review, not silently repinning to fix a failure.
