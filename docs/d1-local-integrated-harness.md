# Integrated local authentication / identity / claim harness

This increment is a composition experiment, NOT a remote executor. The only target
operation is an internal counter. No SQL, D1 binding, target callback, credential
loader, provisioning, real API transport or production-policy change is added.

The configured operation and approval are copied once. A caller supplies only a
Request to an exact synthetic `.invalid` audience. The harness checks:

1. HMAC authentication before fixture collection or registry access.
2. A local collector verifies normalized in-memory provider snapshots and signed
   synthetic bundle provenance; it never claims those snapshots are authentic
   Cloudflare responses.
3. Freshness, identity and HMAC validity are checked again after asynchronous
   collection and before an at-most-once claim.
4. After the claim, validity is checked again before incrementing the test counter.
   If validity expires while claiming, no target simulation runs; the claim remains
   closed in unknown state, not reset for retry.
5. A replay cannot increment the counter again. A successful simulation still returns
   `simulationOnly:true`, `remoteIdentityAuthenticated:false` and
   `operationalAuthorization:false`.

The local tests use a Map implementation of the registry interface for controlled
faults and timing. The separate SQLite Durable Object tests cover its own local
persistent implementation. This is NOT an integrated remote Durable Object + D1
experiment, and does not establish remote attestation or exactly-once completion.

## Remaining trust boundary

A future protected collector needs a real read-only provider transport, narrow
permissions, response provenance, proof of current deployment routing, observed
bindings, reviewed artifact authenticity and trusted time. The transport in this
increment contains copied fixture data only; it cannot turn supplied JSON into
trust. Signed synthetic provenance proves possession of the ephemeral local test
key, not GitHub build authenticity or human authorization.

Before any real execution, the separate resource/access/cost/cleanup manifest and
explicit approval gates still apply. No real host can be invoked through this
harness. Current-time callbacks and local fixtures are test facilities, never
request-controlled inputs for a future operational integration.
