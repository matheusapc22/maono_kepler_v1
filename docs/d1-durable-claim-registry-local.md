# Durable claim adapter: local experiment only

The adapter in `scripts/d1-batch-rehearsal/durable-claim-registry.mjs` uses
SQLite-backed Durable Object storage transactions. It has no default HTTP
handler, target D1 binding, credentials, deployment configuration or cleanup API.
`createRegistryStore` connects the protocol model to a single fixed named object.

## Contract and identity

`claimOnce` validates the synthetic operation key and allowlisted record, then
checks and stores it inside one storage transaction. It grants only one attempt;
existing records always deny another claim. `finish` accepts only the owner
attempt and a transition from claimed to unknown or returned-unverified. Neither
state means database completion. No TTL, alarm, delete, reset or lease exists.
Transactions contain no external calls. No allowUnconfirmed/allowConcurrency
options are used. The adapter never executes a target batch.

Namespace identity, class identity and the fixed object name MUST remain stable
for the entire target lifetime. Renaming/replacing the namespace or object,
deleting/restoring registry storage to a pre-claim state, or changing the key
scheme could reopen an attempted target and is forbidden as recovery. Deployment
attestation and registry protection against administrative changes remain unbuilt.
The key validator is not proof of an actual D1 binding or remote authorization.

## Verified locally

`node --test tests/d1-durable-claim-registry.test.mjs` uses the pinned Wrangler
4.140.0 runtime, workerd 1.20260923.1 and Miniflare on loopback, with no D1 binding.
It exercises real local SQLite-backed Durable Object storage, not a Map mock:

- 16 simultaneous model invocations yield one granted attempt and 15 denials.
- A terminal claim survives Miniflare disposal and recreation using the same
  persistence directory; a new audit hash cannot reopen it.
- A claim persisted without target execution survives disposal/recreation.
- Wrong-owner and invalid terminal transitions fail closed.
- Production UUID keys and malformed records are rejected.

The request-controlled fetch harness exists only as an embedded test string.
It is not exported by the adapter and must never be deployed. Target execution
is a counter, not D1. Disposal/recreation is an orderly local runtime restart,
NOT forced-crash testing, power-loss durability, multi-region contention,
network-partition testing or evidence of Cloudflare service persistence.

## Still required before any remote experiment

Independent adapter review, remote authenticated invocation, stable namespace
attestation, account isolation, immutable binding/payload verification, bounded
provisioning and cost/cleanup manifests, and explicit resource/access approval.
Actual remote persistence/concurrency/fault testing remains unexecuted. This
increment neither authorizes nor implements a production executor or migration.

API reference checked 2026-11-14:
https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
The documented transaction API provides atomic commit/abort and storage isolation;
that contract informs the implementation but does not substitute for remote tests.
