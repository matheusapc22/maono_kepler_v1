# Historical D1 batch rehearsal: local Worker foundation

## Scope and status

This is the first, **local-only** increment of the replacement for manual SQL
transport through the desktop. It adds GitHub Actions automation and exercises
an actual local Worker through `Miniflare.dispatchFetch`, with the operation
under test executed by `env.DB.batch()` inside workerd. It does not create a
remote Worker, database, token, route, binding, or production authorization.

PR #282 and its historical-apply hard denial remain unchanged. AGENTS.md and
the production workflow remain unchanged. No test in this increment changes
production flags or writes to Cloudflare. The old temporary database is not
referenced, reset, reused or deleted by this code.

## Running

Node 24 and Python 3.14 are required. From the repository root:

```
npm install --prefix .tmp/d1-batch-rehearsal-runtime --no-save --package-lock=false wrangler@4.140.0
node --test tests/d1-batch-rehearsal.test.mjs
node scripts/d1-batch-rehearsal/run-local.mjs
```

The optional `MAONO_LOCAL_WRANGLER_PACKAGE` is a local package-directory override
for an already installed official Wrangler 4.140.0. It is not a credential or a
remote target. Runtime code also verifies workerd 1.20260923.1. Python receives
and emits UTF-8 explicitly, including on Windows, to preserve non-ASCII SQL.
No application dependency installation or Cloudflare login is needed.

## Provenance and execution

The existing versioned historical fixture is reconstructed/verified before any
case. It has 530 application objects and seven deliberately synthetic scalar
defaults, not recovered production values. The pinned historical candidate has
150 explicit CREATE statements. SQLite `complete_statement` extracts whole SQL
statements, including complete trigger bodies. Python executes each fixture and
candidate chunk separately in an in-memory SQLite database and verifies the
catalog delta against the existing source-derived contract. No semicolon split.

Each case provisions an isolated local D1 store before its baseline. The existing
unchanged renderer produces guarded SQL from a fresh local snapshot. The parser
extracts the SELECT guards and candidate statements with exact byte recomposition.
The final ledger INSERT is in the same batch. The Worker is generated locally
with this fixed payload; requests cannot supply SQL, URLs, database IDs or scripts.
The accepted request is a bodyless POST to a fixed localhost path, with a random
per-instance nonce. Requests to other paths/origins, wrong auth, bodies and repeats
are refused. Error responses never contain D1/SQL exception text.

Fixture preparation and fault injection occur before the operation-under-test
and are not silently counted as target writes. Only the target batch goes through
the Worker. Post-observation uses the local binding read-only. Complete catalog,
metadata, ledger and PRAGMA comparisons reuse the existing lifecycle/recovery
checks. Synthetic detailed evidence stays in a unique OS temporary directory;
CI uploads only the allowlisted sanitized summary file, never that directory.

## Matrix and limits

Ten cases: success; absent ledger; ledger DROP after snapshot; replacement ledger;
catalog drift; guard failure; early/middle DDL failure; final ledger failure; and
synthetic lost acknowledgement after commit. Missing-ledger preflight refuses the
fresh payload; the stale-payload defense is a deliberately local test injection.
Each case also rejects unauthenticated invocation and replay on the same Worker.
The lost-acknowledgement case restarts the local runtime and reconciles from its
sanitized artifact plus new read-only observations without resubmitting the batch.

These are sequential interleavings, not simultaneous writer/concurrency proof.
Lost acknowledgement is a synthetic caller throw after the response, not an actual
network drop. The elapsed <30s assertion is measured after completion and is NOT
transaction cancellation. An in-memory single-invocation flag is NOT durable
remote replay protection. The localhost nonce is NOT a production auth design.

The lifecycle evidence helper uses the existing canonical database labels as
pure schema-contract context; the physical binding uses only synthetic UUID
`00000000-0000-4000-8000-000000000044`, `cf:false`, and local persistence.
`operationalAuthorization`/`remoteServiceProven` remain false. No local result
establishes artifact authenticity or satisfies production migration approval.

## Gates before any remote experiment

1. Independent code review and successful CI of this exact version.
2. Versioned remote-only design, including fresh database identity, fixed code,
   authenticated invocation, durable replay protection, redacted logs and
   read-only reconciliation of uncertain outcomes. Do not merely deploy this
   local harness or substitute Wrangler exec/import.
3. Review specific resource/permission scope and grant only what is needed via
   protected GitHub Environment. No production write credential in agent runtime.
4. Explicit fresh synthetic resource lifetime/cost budget and cleanup contract.
   The old temporary D1 is being closed separately and must not be reused.
5. Remote full-payload tests, including actual network interruption and concurrency,
   plus independent full-state verification. A timeout is unknown, not a retry.
6. Only after that, a separately reviewed production executor/policy proposal,
   dispatcher synchronization, fresh audit and exact human authorization.

No merge, remote provisioning, remote run or production activation is implied by
this draft. Irrecoverable removal of a named D1 database requires its own concrete
confirmation. Existing proof artifacts and PR #282 are preserved as evidence.
