# Remote synthetic rehearsal protocol: design only

Status: local protocol model; NOT a deployable executor. No remote adapter,
credentials, resource creation or production-policy change is included.

## Boundary

The next experiment must use a newly approved synthetic D1 identity, never
`maono_maps` or its UUID, and never the retired temporary database. A matching
name prefix is NOT identity proof. Provisioning evidence must bind account,
returned UUID, database name, Worker deployment/version, immutable payload hash,
Git SHA, fixture hash and run ID. Review the emitted binding configuration before
invocation. The model's explicit production-identity denial is defense in depth,
not proof that a future deployed binding points to the claimed target.

Keep credentials in a protected GitHub Environment, not agent runtime. Before
provisioning, verify actual API scope granularity; do not assume a D1 token can
be narrowed to an individual database. If its access reaches production, require
a separate account/stronger isolation or a specifically approved security design.
No permission grant is requested by this draft.

## State machine and durable claim

`ready` means no record exists in a trusted registry EXTERNAL to the target D1.
An atomic, durable create-if-absent changes it to `claimed` BEFORE target batch
execution. Key by fresh target UUID, not by payload/audit/attempt: changing those
must not permit another invocation. Retain the record without TTL while the
resource exists. There is no reset, unlock, retry or automatic recovery write.

Only a successful durable claim permits the fixed, reviewed batch. Claimed
records are never reclaimed after lease expiry. On execution error, disconnect,
timeout, process restart or uncertain storage acknowledgement: fail closed.
A crash before execution can strand a harmless unused target; this is preferred
to potentially repeating a write. A new trial requires a separately approved
fresh synthetic target, not a reset of the existing one.

A batch response yields `returned-unverified`, not completion. An exception
can yield `unknown`; if the terminal status write also fails, `claimed` remains
closed. Independently authenticated read-only reconciliation may later label
`verified-committed`, `verified-unchanged`, or `unresolved`, but NONE permit replay.
No controller state can prove the DB outcome without fresh observations.

The protocol model does not deploy a remote registry adapter. Shared-memory
tests exercise an atomic interface contract across invocations, not disk durability,
Durable Objects behavior, remote concurrency, or exactly-once delivery. A future
adapter must prove linearizable claim/create-if-absent and persistence across
restarts. Do not deploy the existing in-memory nonce/flag Worker as this adapter.

## Invocation and artifacts

Use a fixed operation endpoint and reviewed immutable payload. No request-supplied
SQL, DB identity, URL, script, payload or resource selection. Design authentication
with short-lived, scoped invocation credentials plus freshness/expiry and fixed
host checks; reject before accessing either registry or target. Separate provisioning,
invocation, read-only reconciliation and cleanup authority. Logging uses allowlisted
status/digest fields, never raw exceptions, SQL/default values or credentials.

The registry can be updated outside the migration transaction because it grants
only at-most-one ATTEMPT, not an assertion of commit. All target guards, candidate
DDL and final migration ledger insertion remain inside ONE D1 binding batch.
Fixture provisioning/fault injection are separate declared preparation steps.
Do not use generic REST SQL, Wrangler import/execute or automatic batch splitting
as a substitute for the documented binding transaction.

## Remote acceptance matrix (not executed)

- Fresh fixture provenance, complete prestate, integrity and exact deployed binding.
- Full real payload success and independently verified final catalog/metadata/ledger.
- Guard, early/middle DDL and final-ledger failure: full state unchanged.
- Actual concurrent invokes: one durable claim and at most one target attempt.
- Worker/registry restart after claim and after DB commit: no second attempt.
- Actual client disconnection/lost acknowledgement, with read-only reconciliation.
- Real foreign writer conflict/drift and absent/replaced ledger: fail closed.
- Missing/invalid/expired auth and substituted identity/payload: zero target calls.
- Local tests of production-deny rules and unchanged production operator gate.

The complete operation must fit remote platform limits without splitting its
transaction. A local fast run does not establish remote timing. The D1 docs say
one batch counts as one query against per-invocation limits, per-statement SQL
limits still apply, and a batch must resolve within 30 seconds. A caller timeout
or Promise.race DOES NOT cancel the underlying write. Treat it as uncertain.

Sources checked 2026-11-14:
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/observability/debug-d1/
- https://developers.cloudflare.com/d1/worker-api/d1-database/

## Next approval checkpoint

First review this protocol and implement/test a concrete remote registry adapter,
authentication/verifier and binding-identity attestation locally. Then present the
exact resource manifest, account isolation, credentials/permissions, maximum
resource count, lifetime, cost cap, cleanup criteria and deploy hashes for approval.
Only after that provision a fresh synthetic experiment. Permanent deletion is a
separate exact-resource confirmation; never infer it for production. Passing this
experiment would still require a separately reviewed production executor/policy,
protected audit and exact human production authorization. No merge is implied.

## Local identity comparison contract

`synthetic-identity-model.mjs` compares an approved manifest against a freshly
observed manifest with exact account, UUID/name, Worker name/deployment, Git SHA,
payload/fixture hashes and registry namespace. It denies expired approvals,
observations older than 60 seconds or from the future, extra/substituted D1 bindings,
and production identifiers. Exactly one D1 binding named TARGET is allowed.

This is only the comparison predicate. The caller cannot prove identity by supplying
two matching JSON objects: trusted approval retrieval, Cloudflare metadata collection,
actual binding attestation, signature/provenance verification and authentication
are NOT implemented. Consequently a match explicitly reports
`remoteIdentityAuthenticated:false` and `operationalAuthorization:false`. Never
interpret these tests as permission to invoke an arbitrary deployed Worker.
