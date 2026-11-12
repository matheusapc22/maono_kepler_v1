# Historical 0044 lifecycle: local implementation and validation

## Current boundary

This branch implements a dedicated historical operator and protected-workflow
routing locally; no production operation or deployment is performed by these
changes/tests. Generic migration helpers still deny the historical filename.
Only the byte-exact historical basename reaches the dedicated read-only lifecycle.
Historical apply is explicitly denied before credentials; its write executor was
removed after the separate Wrangler ledger-bootstrap race was identified.
Existing matched-prestate supplements and Phase A digests are not authorization.

## Phase A proof baseline

## Fixed action

Contract: `historical-0044-isolated-apply-v1`.
Profile: `deletion-safety-historical-v1`, deletion-specific only.
Candidate: `scripts/migrations/candidates/0044_organization_permanent_deletion_historical.sql`.
SHA-256: `b04a164e85fe09d292dd8e81ac744ce4deec8927290d38cff326c77e030354fa`.
The authoritative constant and source validation in code govern; no report hash
can substitute for source verification. Exactly 150 explicit CREATE objects:
three tables and 147 triggers. No business-row DML, ALTER, DROP, or activation.

## Evidence boundaries

Private runner state includes all five metadata projections and complete
sqlite_schema rows: rowid/type/name/tbl_name/sql, including autoindexes,
protected internals and sqlite_sequence definition. sqlite_sequence application
counters are never read. Rootpage is excluded. Full snapshot changes include
opaque scalar defaults, even when the seven reviewed scalar slots remain within
the deletion-only projection. There is no general DDL equivalence assertion.

Catalog rowid alone is not asserted to determine index_list.seq. The renderer
also guards the complete fixed index_list projection, and connection settings
foreign_keys=1, defer_foreign_keys=0, plus the observed recursive_triggers value.
Metadata and catalog reads are not a single transactional audit snapshot. Atomic
preconditions at execution are separate and tested, not inferred from the audit.

Sanitized evidence contains hashes/counts and validated migration names. The D1
ledger has no checksum column: id/name/appliedAt are its observed facts; any local
source checksum is separately labeled and absent historical files remain absent.
Pending evidence retains all local names/checksums, including the excluded
canonical alternative, but only the fixed historical candidate is selected.
The action digest is explicitly local-proof-only, never an approvalHash/token.

## Atomic and post-state proof

The fixed source hash is distinct from guarded execution-file hash and exact
Wrangler 4.140.0 wire-request hash (including its appended ledger INSERT).
Execution assertions precede every candidate CREATE in the same migration query.
Wrangler initializes the ledger in a separate request. Prechecking that the
ledger exists is NOT sufficient: a concurrent DROP before initialization can
recreate it outside the guarded transaction. This is an unresolved apply blocker. Raw execution text, including reversible hex literals, belongs
only in protected ephemeral runner memory/files with logs disabled, never in
reports, source, artifacts or exception snippets.

Post-state comparison requires every old catalog row unchanged, exact new
source-derived objects including implicit indexes, all old metadata plus the
exact source-derived metadata delta, unchanged connection settings, intact old
ledger rows and exactly one historical ledger entry. Integrity must pass.
Canonical/historical dual entries, missing/extra objects and partial states block.
Read-only reconciliation never permits retry: matching prestate stops as currently
unapplied, exact poststate stops as committed observed, anything else stops blocked.
A structural-only invocation of the existing prestate matcher uses local placeholder
Git/pending values internally during reconciliation; those are never operational
evidence and never emitted as an audit result.

## Remaining operational gates

The dedicated local Phase B implementation below requires final review and normal
publication/merge coordination. The changed workflow must separately be present
on the default branch main before dispatch supports the fixed outside-directory
candidate; merging product code alone does not synchronize that dispatcher.
Generic operational denial stays intact. Local workerd rollback and pinned transport
prove their respective local boundaries; official D1 documentation supplies the
service migration rollback contract, not evidence of a remote execution in this task.

Before any Phase B authorization builder, reconstruct all evidence from the fresh
validated audit context, source pins and clean Git state. Phase A accepts a plain
local evidence object and deliberately cannot certify its provenance or user
authorization; its digest must never be reused as an operational approval. The
renderer is recomputed from the private snapshot and pinned candidate, and both
the concatenated SQL payload hash and exact serialized JSON request-body hash
are separately labeled and bound.

## Local proof provenance (not production evidence)

The complete historical structural fixture is synthetic at the seven documented
scalar default slots. The physical tests preserve its constraints and triggers;
no production business rows are loaded. Wrangler is pinned to 4.140.0. Real local
Miniflare/workerd verifies full guarded candidate success and rollback on the
appended ledger write failure. A loopback transport test commits against real
local SQLite, drops the response, then reconciles the complete physical poststate
read-only without replay. The loopback does not simulate remote D1's implementation.

Full fixture execution: 978 assertions and 946,833 SQL bytes. The local D1 response
contained 1,129 statement results with summed statement meta.duration 178ms; that
is not remote REST latency or a guaranteed production service time. Single-action
CLI and post-read wall time was approximately 24.7 seconds in the measured local run.
Statement size and request size limits remain enforced independently of timing.
The service rollback claim is separately documented at
https://developers.cloudflare.com/d1/wrangler-commands/#d1-migrations-apply .
No remote test or production migration was performed.

## Sanitized cross-job inversion prerequisite

The original Phase A lost-response test retains private before/after snapshots.
The additional recovery prerequisite deliberately closes the original physical
SQLite connection and discards its private snapshot. Only JSON-serialized
sanitized audit evidence is passed to recovery alongside a fresh private snapshot
from the reopened database. No raw DDL/default values are stored in that artifact.

Recovery removes the complete, exact source-derived added catalog definitions and
metadata multiset, including implicit indexes, plus exactly one valid historical
ledger entry. It preserves remaining rowids, row order, connection settings and
all old ledger IDs/names/timestamps. It rebuilds the full sanitized evidence and
requires equality of every field and independent full/catalog/metadata/ledger/
connection digest. Missing, extra, partial, dual-ledger or reordered evidence
fails closed. The candidate is additive; this is not a generic inverse-migration
engine and performs no writes or replay.

Results say only that the fresh state corresponds to the supplied artifact.
`artifactAuthenticityVerified` and `operationalAuthorization` are always false.
An internally consistent forged artifact cannot authenticate its own Git claim
or origin, demonstrated explicitly by a test. Before operational integration,
the protected workflow must independently authenticate/pin the audit artifact,
source/Git/context and explicit human authorization. These are still Phase B gates;
local correspondence never supplies that authority.

## Current dedicated read-only operator contract

`historical-0044-operator-v1`, version 1, now emits only
`historical-audit-transport-blocked`. Both readyForAuthorization and
approvalEligible are false. The blocker is WRANGLER_LEDGER_BOOTSTRAP_RACE.
There is no approval object, actionable authorization text or apply command.
The evidenceIdentity uses the separate domain
`maono-production-historical-0044-observation-v1`; it identifies observations,
not authority to write. Bookmarks and generation times are reported separately
from stable observed structural/source material.

Historical apply is rejected at the CLI/operator and workflow validation before
credentials. The dedicated module contains no remote write executor. Generic
historical denial and canonical/historical mutual-exclusion protections remain.
No alternative direct POST or import path is introduced.

Read-only postvalidation can authenticate the original blocked-audit artifact
and compare an already-existing state using the proven inverse projection. The
legacy --approval/approval_hash argument is only evidence identity in this mode.
GitHub origin verification occurs before D1 credential use and is repeated in
process, not delegated to a trusted-looking sidecar boolean. It verifies fixed
repository/owner/workflow/run/attempt/actor/ancestry, immutable artifact digest,
strict bounded one-entry ZIP, audited bytes and matching local file. Reports
include authenticated origin and original/fresh bookmarks, never write authority.

## Exact remaining transport blocker

Wrangler 4.140.0 unconditionally sends CREATE TABLE IF NOT EXISTS d1_migrations
in an earlier request before its guarded migration query and appended ledger
INSERT. No supported skip-initialization option was found. A concurrent ledger
DROP between fresh audit and initialization can therefore cause an unguarded
CREATE even though the subsequent candidate guards abort correctly. The existing
payload rollback tests do not close this earlier request boundary.

A future fix requires reviewed supported no-bootstrap transport and proof of its
specific atomicity, exact request bytes, one-attempt behavior, limits, recovery
and compliance with AGENTS.md. The current policy mandates isolated Wrangler
migration apply. Its rollback documentation alone is not permission or proof to
substitute a generic /query POST. Until that is resolved, no audit authorizes apply.

## Offline integration evidence

The prototype audit/apply/post pipeline tests passed their individual fixtures,
but readiness approval was withdrawn on identifying the bootstrap race. They do
not establish safe production application. Current tests instead require hard
apply denial before credentials/D1 and absence of any dedicated write executor.
Read-only audit emits exactly audit.json with blocked flags. A synthetic
already-applied database can be inspected by authenticated postvalidation with
zero writes. The tests use isolated child working directories and intercepted
Git/npx/GitHub transports, not live services or production data.

The ZIP compatibility fixture was generated with archiver 7.0.1 pinned by the
reviewed upload-artifact action's @actions/artifact 6.2.0 dependency. Its SHA-256 is
71188d7efb5310d83c3b851ec702bdd42d7cd68eddd90d7d564e43b13c1d1281.
This verifies format compatibility locally, not a live GitHub artifact or migration.
