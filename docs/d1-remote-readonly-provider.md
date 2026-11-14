# Read-only pinned Cloudflare metadata provider

`readonly-provider.mjs` implements only three sequential GET operations against
fixed `https://api.cloudflare.com/client/v4` paths scoped to validated identifiers:
D1 database details, a Worker deployment by exact ID, and its version by exact ID.
No lists, SQL, invocation, creation, deletion, migration or permission grants exist.
The canonical production account and maono_maps UUID/name are rejected before I/O.
Synthetic naming is defense in depth, not proof of account ownership/isolation.

The provider accepts a token parameter for a future protected GitHub operator.
It does not read environment variables, credentials, browser sessions or files.
The default fetch can perform a real authenticated GET, so it must only be called
inside the separately approved protected read-only operator. Tests supply a fake
fetch implementation and a plainly synthetic test token; no remote call was run.

## Failure and disclosure controls

Redirects are errors, credentials are not included by the browser, URLs have no
caller-defined base/query/path, and the method is fixed GET. Each request has a
bounded timeout across headers and body, aborts on timeout and is never retried.
Responses are capped at 1 MiB; HTTP/JSON/schema mismatches stop the sequence.
The provider requires successful API envelopes with empty errors and object results.
Paged/list envelopes are rejected: no pagination or implicit first-item selection.

Errors are fixed strings, without raw API bodies, URLs, token, SQL or nested causes.
The output excludes author details, annotations, script text and etag. Only reviewed
identity/binding metadata and explicit capability limitations are returned.
`observedAtMs` is conservatively the collection start and `collectedAtMs` its end;
these reads are not an atomic snapshot. Tokens and provider responses are never logged.

## What a match does not prove

A pinned deployment GET may be historical. This code NEVER claims it is currently
active. It requires exactly one recorded version at 100%, but active routing,
pagination/current selection and race-free invocation remain unresolved.
`activeDeploymentVerified` is always false.

Version bindings must be exactly D1 TARGET and Durable Object REGISTRY. Unexpected
kinds/fields, extra bindings, mismatched IDs, external script names and missing
namespace IDs fail closed. Omitted script_name means the same script, following
the official Wrangler implementation; explicit names must match. This narrow
allowlist deliberately rejects secret bindings until separately reviewed.

No namespace storage object is read, no token permission scope is introspected,
and no artifact is fetched or attested. Script etag is NOT substituted for a
reviewed bundle hash. Therefore bundleProvenanceVerified,
liveInvocationBindingVerified, namespaceStorageIdentityVerified, tokenScopeVerified
and operationalAuthorization all remain false. A successful audit is not a deploy,
active-binding attestation, authorization or readiness signal for migration.

## Evidence and source review

Six fake-fetch tests exercise exact GET-only URLs, production/path denial,
identity and binding substitutions, split traffic, error redaction, pagination,
redirect denial, timeouts, stalled bodies, oversized responses and token hygiene.
These tests do not establish provider access or remote response compatibility.

Official documentation checked 2026-11-14:
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/
- https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/

D1 detail results expose UUID/name; deployment detail exposes strategy and version
percentages. Version API documents resources.bindings broadly. Its concrete binding
array and Durable Object namespace_id/class_name/script_name interpretation were
also inspected in installed official Wrangler 4.140.0. Unrecognized future shapes
are rejected, not guessed or silently normalized into approval.
