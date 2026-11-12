# Historical deletion prestate supplement v1

## Scope and non-authority

Profile `deletion-safety-historical-v1`, version 1, is supplemental evidence for a proposed empty-organization deletion candidate. It is **not a final operational certification**, general schema equivalence, permission to apply, or evidence that guards are installed.

The existing protected operator still receives `mode=audit` and canonical `0044_organization_permanent_deletion.sql`. Historical schema still fails canonical compatibility and exits with `DELETION_SCHEMA_BLOCKED`. Its existing retained blocked report may additionally contain `deletionSafetyCertification.status = matched-prestate`, `guards = planned-not-installed`, `compatible = false`, `readyForAuthorization = false`, and `approvalEligible = false`. No approval hash, token, material, human authorization text or apply command is produced. A blocked or missing supplement never repairs canonical compatibility.

No workflow or dispatch input changes are needed. The dispatcher on `main` remains distinct from product code; this patch does not update or bypass it. Existing protected environment, product SHA pinning, artifact retention and human gate remain required. No remote dispatch is performed by this work.

## Static candidate and exact inputs

The candidate is deliberately outside generic migration discovery:

`scripts/migrations/candidates/0044_organization_permanent_deletion_historical.sql`

Its bytes are LF-normalized canonical 0044 core, one newline, then the exact reviewed 20 test guards. SHA-256:

`b04a164e85fe09d292dd8e81ac744ce4deec8927290d38cff326c77e030354fa`

Core SHA-256: `cde2cbad6ded662faf004eac176309b3003641ec2f0714eda06b890127fb3aba`.
Additional guards SHA-256: `5d13f486390711458806fc53c8ce585a8d398e7549eff9aa1e8da32c63920cd0`.

The fixed contract in `scripts/migrations/references/deletion-historical-safety-v1.json` pins the full fixture, its provenance manifest, structural metadata, static candidate, source SQL and relevant runtime/auth/classifier files. Source base is product `4ab38311f3c43726268a403011e6e1e191635aaf`; fixture historical source provenance remains `4f48ed5d8299fca3745807e47baf78369578e5e8` plus explicitly pinned historical revisions. Reviewed fixture/proof commits were imported without repeating the already merged runtime change.

All 530 application objects must match: 499 reconstructed from pinned independent versioned sources and 31 explicit structural safety references (seven tables and 24 indexes). Those 31 references are **not recovered historical DDL**. Their complete AST, all remaining literals/clauses, columns, keys, FK groups, index uniqueness/order/collations/predicates and trigger definitions are fixed. Only the seven specified scalar DEFAULT slots/classes may vary. Functions, expressions, different literal classes, new slots, unknown syntax, missing/extra objects and altered constraints fail closed.

The existing narrow non-business D1 ledger/protected-internal shape checks remain in force. They are not a blanket prefix exemption. Their complete raw definitions and defaults remain in the full snapshot digest; extra associated objects are not omitted from inventory. Application AST/index formatting is compared structurally only after complete recognition, never by guessing a literal hash.

## Finite non-interference argument for the seven slots

This argument concerns the pinned Super Admin deletion flow and exact schema only. It is not authorization equivalence for other application actions.

| Slot | Exact schema effects | Deletion property |
| --- | --- | --- |
| role_permissions.scope_type | NOT NULL; global UNIQUE(role, permission, scope_type) | Global table is neither selected nor mutated by cleanup. Scope changes can alter general uniqueness/authorization and are expressly not equivalent. |
| role_permissions.active | NOT NULL; two non-unique lookup indexes | Global table untouched; pinned Super Admin path bypasses role-grant queries. |
| user_permissions.active | NOT NULL; three non-unique lookup indexes | Guards use organization_id; mixed-scope veto uses organization_id/project_id; DELETE uses organization_id, irrespective of active/expiry. Three partial UNIQUE predicates do not reference active. |
| organization_feature_flags.enabled | NOT NULL; non-unique (organization_id, enabled) index | Every organization row vetoes deletion; enabled never selects a cleanup exception. |
| ticket_comments.internal | NOT NULL; no FK/key/CHECK/index expression on this slot | Not cleaned up. Mandatory ticket_id FK requires a tickets parent; that parent's mandatory organization_id is fully vetoed. |
| tickets.status | NOT NULL; non-unique (organization_id, status) index | Every organization row vetoes deletion irrespective of status. |
| tickets.priority | NOT NULL; no FK/key/CHECK/index expression on this slot | Every organization row vetoes deletion irrespective of priority. |

None of the seven slots is a FK target/source, generated expression, CHECK dependency or SET DEFAULT destination. No partial/expression-index predicate reads them. The only inbound FK to these five tables is ticket_comments.ticket_id -> tickets.id (CASCADE), and that parent is never deleted by empty-organization cleanup when any ticket exists.

Exactly six relevant triggers exist: project_save_auth_{role_permissions,user_permissions}_{insert,update,delete}. Each unconditionally increments `project_save_authorization_generation.version` for id=1, without reading OLD/NEW or a scalar slot. This destination has no trigger or incoming/outgoing FK. The versioned source and full object inventory prevent an unreviewed downstream effect from being accepted.

A scalar DEFAULT evaluates only for an inserted field omitted by that write; it does not mutate existing rows. Here, even an insertion using a different allowed scalar cannot change ownership, any business veto predicate, mixed-scope predicate, or OLD/NEW ownership guard. A uniqueness failure in global role permissions aborts that insertion rather than creating a cleanup path. A successful permission insertion has the same unconditional epoch effect, independent of its scalar. Writes into a claimed organization are stopped by fixed guards; writes before the claim are included by the atomic predicates. All business content is vetoed, never conditionally deleted by status.

Pinned HTTP management requires actor.role=super_admin. requireSession reads sessions/users, not these defaults. Bound global/organization callbacks are repeated by stepDeletion. permissions.can resolves context and returns the Super Admin path before role/user grant queries; admin.panel.access is not revoked by the paused organization. These exact source files are pinned; new authorization logic requires a new review.

For ticket_comments, the argument requires FK integrity, mandatory tickets ownership and the planned ticket guards. Orphans, missing FKs, altered ownership, additional triggers or integrity failures do not match. This is not permission to repair data or delete a dangling business row.

## Evidence requirements and invalidation

A matched prestate requires valid quick_check and empty foreign_key_check in the same audit, two equal complete metadata snapshots, strict complete ledger validation, a pinned Git SHA, pending digest and all source hashes. Ledger and integrity are read before the two metadata snapshots. Snapshot equality is a drift check, not a transactional snapshot joining data, integrity and ledger, or ongoing monitoring. The supplement explicitly reports atomicDatabaseSnapshot=false and integrityObservation=same-audit-before-metadata-reads.

The ledger has no migration-content hash column; none is fabricated. Any prestate 0044 entry, historical alias, duplicate/malformed row or partial/full installed deletion schema blocks matching. Canonical apply additionally rejects historical ledger entries and rechecks the strict ledger immediately before its existing write boundary. Existing 0042/0043 ledger behavior remains unchanged.

The full observed snapshot digest includes all object SQL, default literals, internal objects, columns, FKs and index metadata. Changing an otherwise allowed scalar changes this digest and supplemental evidence digest. Old evidence is not reusable. No application/business rows or raw SQL/default literals are emitted in the supplement.

## Anti-apply boundary and tests

The historical filename is denied centrally by operational filename resolution, pending selection, approval-material construction, report comparison, remote-state selection and isolated migration preparation. CLI audit/apply/postvalidate reject it before credentials. Path/case/whitespace aliases cannot reach execution. It cannot be discovered by the generic migrations directory.

Tests cover full matching with non-authorizing output; seven scalar variations with changed digests; unsupported expressions/classes; FK/index/predicate/constraint/trigger/auth-source drift; missing/extra objects; incomplete integrity/snapshots/ledger; partial/full installed state; and offline canonical CLI report retention. Present, absent or forged-ready supplements still cannot make canonical apply succeed. Physical SQLite and local D1 batch proofs remain separately documented in `deletion-historical-execution-proof.md`.

Next operational work, if separately authorized, would need a reviewed executable profile/selection lifecycle, fresh protected evidence and the existing explicit migration authorization. This patch deliberately implements none of that lifecycle and does not enable the feature.

## Local D1 evidence

Wrangler 4.161.0 compiled the complete synthetic prestate in a fresh local database. Two fixed metadata-query passes and quick/FK checks were collected without remote access; the real D1 result matched all 530 application objects, reported 147 planned guards, and kept compatible/ready false. This local evidence uses synthetic ledger/Git/pending context and cannot substitute for a protected production audit.

Capture Wrangler JSON as UTF-8 bytes (the operator's Node process path), not a PowerShell text pipeline using an OEM encoding. An initial local capture changed a Unicode literal in cc08_cr_record and was correctly rejected. Recapturing the same read-only queries as exact UTF-8 bytes matched without changing SQL, database state, reference hashes or the matcher. This was a local evidence-transport error, not a schema exemption.
