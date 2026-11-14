# Local HMAC invocation verifier experiment

`local-invocation-auth.mjs` is a local cryptographic boundary experiment, not a
remote endpoint or deployable executor. It neither reads credentials nor makes
network requests, creates resources, invokes D1 or grants access.

The factory captures fixed approved strings and a non-extractable HMAC-SHA256
CryptoKey with at least 256 bits. Tests generate random ephemeral keys in memory;
no key or token is printed, persisted, loaded from user storage or sent remotely.

## Signed request contract

The sole allowed URL is an exact HTTPS synthetic audience beneath `.invalid`,
ending in `/fixed-batch`. Real domains are intentionally rejected in this local
increment. A future real deployment requires separate endpoint/security review.
Only POST with a null body is accepted. Query strings, alternate paths, fragments,
wrong hosts and other methods fail closed.

The Authorization envelope is `Maono-HMAC <base64url-claims>.<base64url-signature>`.
Canonical claims contain, in order: databaseUuid, payloadSha256, auditSha256,
attemptId, deploymentId, registryNamespaceId, audience, issuedAtMs, expiresAtMs.
All identity strings must exactly match the captured configuration. Production
UUIDs are denied. The TTL is positive and at most 60 seconds, issuance cannot
be in the future, and expiry is exclusive. Timestamps are nonnegative integer
milliseconds; the verifier takes a trusted current-time argument for local tests.
A real integration must supply its own clock, never a caller-provided timestamp.

The signed bytes are UTF-8 of `maono-synthetic-invocation-v1\nPOST\n` followed by
the canonical base64url claims. Verification calls `crypto.subtle.verify` with
HMAC, never a manual signature comparison. Bad encoding, duplicate/extra JSON
keys, wrong keys, mismatched pins and crypto errors produce the same redacted
error without logging the input. Inputs and header size are bounded.

## What a successful result does NOT mean

`localSignatureVerified:true` only shows knowledge of the ephemeral test key for
the exact signed request. It does not attest a Cloudflare account, binding,
deployed version, current database state, human approval or operational permission.
The result explicitly retains `remoteIdentityAuthenticated:false` and
`operationalAuthorization:false`.

A valid request can verify more than once during its short lifetime. The result
therefore includes `replayProtectionProvided:false`. At-most-one execution must
still require the separate stable durable claim registry, after authentication
and binding verification and before any target call. No integration exists here.
A stolen valid envelope remains a replayable bearer capability during its lifetime;
TLS and protected token handling are required for any later remote design.

Before remote use, require trusted provisioning/approval and binding evidence,
key generation/distribution/rotation/revocation policy, correct Worker clock,
protected invocation, registry stability, isolated account scope, exact resource
manifest and separate permission approvals. Future real secrets belong only in
the protected operator environment and approved Worker secret mechanism, never
chat, agent runtime, repository, logs or published artifacts. No remote secrets
are requested or installed by this change.

## Local evidence

`node --test tests/d1-local-invocation-auth.test.mjs`: seven tests cover valid
signature (with explicit replay limitation), each valid-shaped field substitution,
wrong key/tampering/encoding, HTTP boundaries, time boundaries, strict JSON/types,
production/real-host denial and immutable captured pins. This is Node WebCrypto
local evidence, not a deployed Worker authentication or end-to-end service test.

Official API reference checked 2026-11-14:
https://developers.cloudflare.com/workers/runtime-apis/web-crypto/

The local verifier now returns authenticated issued/expiry timestamps. A caller
must compare its trusted clock after asynchronous verification, not assume the
pre-crypto time remains current. The integrated local harness checks that metadata
synchronously after the final await and before its counter; a short-token regression
test keeps the approval valid while the token expires during that verification.
