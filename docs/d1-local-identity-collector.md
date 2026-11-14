# Local identity collector and synthetic provenance

This is a local contract experiment, NOT a trustworthy Cloudflare collector.
It has no fetch/network transport, API client, credentials, remote resources,
D1 execution or provider-authentication implementation.

## Interface

`createLocalIdentityFixtureTransport(fixtures)` copies synthetic snapshots into
an internal WeakMap and returns a frozen marker. An arbitrary transport object or
network callback cannot be supplied to the collector. This branding is an
in-process test boundary, not proof that the fixtures came from Cloudflare.

`collectLocalSyntheticIdentity({approved, transport, provenanceKey, nowMs})`
validates those snapshots and returns `observed`, `localEvidenceVerified:true`,
`remoteIdentityAuthenticated:false`, and `operationalAuthorization:false`.
The supplied clock is trusted only within the local harness. No request timestamp
may substitute for the protected collector's own clock in a future integration.

The test-only helper `makeLocalIdentityCollectorFixture` creates synthetic records,
a non-extractable ephemeral HMAC-SHA256 key, and signed local provenance. It does
not load, persist or transmit credentials. It is not part of the production code.

## Normalized fixture contract

- `account`: id and observedAtMs.
- `database`: uuid, name and observedAtMs.
- `deploymentBefore` and `deploymentAfter`: deployment id, observedAtMs and exactly
  one `versions` entry containing version_id and numeric percentage 100.
- `version`: id, observedAtMs, resources.bindings.
- Exactly two bindings: D1 TARGET with type/name/id, and durable_object_namespace
  REGISTRY with type/name/namespace_id/class_name/script_name. Unknown binding
  kinds, extra bindings and unreviewed binding fields fail closed. script_name
  is explicitly normalized to the approved Worker, not implicitly inferred.
- `bundleUtf8`: nonempty synthetic artifact text, at most 1 MiB.
- `provenance`: statement and signatureBase64url.

The statement is the canonical ordered object defined by LOCAL_PROVENANCE_FIELDS:
account, database UUID/name, Worker name, deploymentId, distinct versionId, Git SHA,
payload/fixture hashes, registry namespace, bundle SHA256, class and object names.
The signed bytes are UTF-8 of `maono-local-provenance-v1\n` plus canonical JSON.
Verification uses crypto.subtle.verify and independently hashes the bundle bytes.
A forged statement/hash without the local signing key does not verify. Someone
controlling both the fixture and signing key CAN manufacture a locally passing
proof: this is not a trusted build-attestation service or remote chain of trust.
No claim is made that Git, SQL or fixture bytes were independently downloaded.

The existing identity comparator checks exact approved correspondence, production
denials and expiry. Snapshot timestamps must be no more than 60 seconds old and
not in the future. Before/after observations must report the same approved
single-version 100% deployment. This detects observed drift, but equal snapshots
DO NOT rule out an intermediate ABA change or a change after collection. Remote
TOCTOU protection, immutable invocation/version routing and fencing remain open.

## API schema research and unresolved normalization

Official API documentation exposes D1 UUID/name, deployment version/percentage
records, and version resources/bindings. These informed the synthetic schema:
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/

Checked 2026-11-14. These fixtures are NOT full raw API response parsers. A future
protected provider must verify API success/envelopes, account-scoped endpoints,
authentication, pagination, complete binding inventory and current active selection.
Reading an arbitrary historical deployment is not evidence that it is active.
Version ID and deployment ID are distinct; this code never treats them as synonyms.
No remote active-deployment selector, account ownership proof, immutable bundle
retrieval, upload receipt validation or real provenance authority exists yet.

The strict two-binding fixture deliberately excludes secret bindings and all other
capabilities. A real authentication deployment may need an approved secret binding;
that requires explicit metadata-only allowlist design, without reading its value.
This local experiment therefore is not a remotely ready deployment configuration.

## Local evidence and remaining boundary

Six Node tests cover valid synthetic provenance, transport substitution, immutable
fixture capture, changed before/after deployments, ambiguous traffic, wrong version,
stale/future observations, account/D1 substitutions, extra bindings, absent/forged
provenance, wrong key, changed artifact and forged approved/statement digests.

The local orchestrator must authenticate before collection, recheck time/approval
after asynchronous work, and acquire a durable claim before its internal fake
counter. Even that composition cannot confer remote authorization. Real provider
implementation, provenance trust roots, resource/access approvals, isolated account
scope and binding attestation remain separate unimplemented requirements.
