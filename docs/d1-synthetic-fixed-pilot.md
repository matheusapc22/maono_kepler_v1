# Fixed synthetic pilot: implementation review, not remote authorization

## Scope and current account

The isolated Free account Maono - Ensaios was reported created on 2026-11-16:
`1988481e4c75c760516161104b7e1e50`. This is an explicit allowlist target,
not a claim that local code has authenticated account ownership or live bindings.
Production account `09d455fa1cf988b0d9db89987b73eaff` and D1
`5bc4dc32-f3bd-4c92-bbd1-cbda63e467db` / `maono_maps` remain prohibited.

This increment prepares a small fixed synthetic transport pilot. It is not the
historical migration, not a replacement for the production lifecycle, and not a
claim that the full historical batch fits Free CPU limits. Existing production
scripts, workflows, read-only audit manifest and policies remain untouched.
No deployment configuration, cloud token, resource creation or workflow activation
is part of this change. Local test keys are ephemeral fixtures, not credentials
installed in any service.

## Review packet before external actions

Proposed inventory: exactly one dedicated Worker, one SQLite Durable Object
namespace and one newly created D1. No production bindings, real customer data,
DNS/domain changes, cron, paid upgrade or account-wide cleanup. Maximum pilot
window 24 hours; Free-only budget USD 0, with no automatic upgrade. This replaces
neither the still-unapproved older USD 1 proposal nor any existing authorization.
The owner must approve the final inventory/permission/window proposal first.

Record real UUIDs and receipts after separately approved provisioning; do not
fabricate IDs now. Pin reviewed source SHA, bundle hash, fixed payload hash,
Worker version, D1 UUID, namespace/object identity, audience and invocation window.
Deploying secrets changes version identity: finalize all bindings and secrets
before final pins. Never treat environment variables that repeat expected IDs as
independent evidence that the service actually bound those resources.

Provisioning authority, if approved later: temporary D1 Write and Workers Scripts
Write restricted to the isolated account, not global keys or the existing broad
OAuth. These privileges can alter/delete resources in that account, not merely
create the named pilot. A separate read-only audit token must not inherit writes.
Invocation authentication is distinct from Cloudflare administrative credentials.
Tokens must be handled by a separately approved protected mechanism, never chat,
repository, logs or sanitized artifacts. Do not create/store/grant them in this PR.

## Reviewer decision

The existing synthetic audit requires prevent_self_review=true. The same GitHub
identity cannot dispatch and review under that setting. Either obtain approval for
an actual independent reviewer, or explicitly approve a synthetic-only policy
allowing Matheus to approve his own run, with admin bypass still disabled. The
latter is human approval, NOT independent review. Do not select another collaborator,
modify production environments or change the existing draft workflow implicitly.

## Proof obligations before first effectful remote request

- Establish account ownership and exact real resource inventory.
- Verify credentials' effective account/product scope, not only API acceptance.
- Audit exact version, build provenance and complete bindings. A historical
  deployment GET or 100 percent traffic allocation alone does not prove serving
  version, propagation or resistance to version override/affinity.
- Choose and verify the actual endpoint semantics before opening invocation.
- Bind a fresh short-lived authenticated request to the reviewed fixed operation.
- Keep durable claim identity stable for the D1 UUID, independent of changing
  approval/payload/attempt. No reset, unlock, TTL or automatic retry.
- Recheck request expiry after asynchronous work, immediately before effect.
- Once a claim may have persisted, any unacknowledged effect remains unknown and
  closed. An HTTP timeout cannot cancel D1 work. Reconcile read-only before making
  any later decision; a returned batch is still unverified until poststate checks.
- Local Miniflare/workerd is not Cloudflare remote durability, CPU or routing proof.

One target and permanent UUID claim intentionally permit only one application.
Do not reset the claim to run the entire ten-case matrix. Additional remote failure
cases require separately approved fresh targets and inventory/cleanup changes.

## Free constraints and stopping rules

Workers Free provides 10 ms CPU per HTTP request and 100,000 requests/day; waiting
for D1 I/O does not count as CPU. Auth and statement preparation still cost CPU.
D1 Free allows 500 MB/database and 10 databases/account; daily 5 million rows read
and 100,000 written. A batch counts as one query against the per-invocation limit,
but individual SQL limits and the 30 second query limit still apply.
DO on Free must use SQLite. Its daily included limits are 100,000 requests,
13,000 GB-s, 5 million rows read and 100,000 written, with 5 GB stored total.
Exceeding Free limits is a stop/error, not approval to upgrade or weaken checks.
Remote metrics and poststate, not local timings, decide whether a later larger
pilot is viable. Stop after first unexpected identity, authentication, CPU, quota,
SQL or acknowledgement failure. No retry loop or automatic target replacement.

## Cleanup proposal, not an executable cleanup command

At completion or the 24-hour deadline: stop accepting invocations under the
approved access scope, preserve sanitized receipts/results and reconcile unknown
outcomes. Then request exact-resource confirmation for irreversible deletion.
Revoke temporary credentials through the approved channel. Delete only the
confirmed synthetic inventory, including DO stored data/namespace and Worker,
not merely the Worker script. Keep claim records while the target could still be
invoked. Verify absence and report anything remaining. Never delete maono_maps,
its UUID, the production account, or an arbitrary name-prefix match.

## Official references checked 2026-11-16

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/
- https://developers.cloudflare.com/workers/versions-and-deployments/
- https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/

## Local implementation and running tests

`scripts/d1-synthetic-pilot/local-source.mjs` builds disabled source by default.
Opting into local test configuration still accepts only the allowlisted isolated
account and an `.invalid` audience. It embeds three constant SQL statements:
a sentinel assertion, creation of one synthetic result table, and one fixed row.
The payload hash covers SQL and bound identity values. No caller-supplied SQL,
migration loading, arbitrary route or remote enable flag is accepted.

The source composes the existing HMAC verifier and SQLite Durable Object registry
with a real local D1 binding. All responses expressly retain
`remoteIdentityAuthenticated:false` and `operationalAuthorization:false`.
A sentinel row and local runtime variables are test correlations, not trusted
Cloudflare account/version/D1 attestation. The default generated source returns
503 and has no database operation.

Run with the pinned local Wrangler 4.140.0 / workerd 1.20260923.1 installation,
using MAONO_LOCAL_WRANGLER_PACKAGE to its package directory and
WRANGLER_SEND_METRICS=false:

```text
node --test tests/d1-synthetic-pilot-*.test.mjs
node --test tests/d1-*.test.mjs
```

Tests bind 127.0.0.1 with cf:false and persist only local temporary SQLite state.
Orderly runtime disposal/recreation is restart coverage, not remote crash/power
loss proof. Discarding a completed response body simulates a caller losing the
acknowledgement; it is not an injected provider network failure. Do not count this
small transport fixture as the full historical migration matrix.

### Empty HTTP body integration finding

Real local workerd can represent an empty POST body as a stream rather than null.
The pilot authenticates a bodyless view of the exact URL/method/headers, then
requires EOF from the original body before claiming. Any content chunk is denied,
and expiry is rechecked afterwards. EOF is bounded to one second; nonzero Content-Length and Transfer-Encoding are denied. This is still not public endpoint security proof.
The shared verifier and production request handlers were not relaxed.


The new PR-only local-pilot CI installs the pinned emulator and runs only the new local tests. It has contents:read, no secrets, dispatch, deployment or remote operation.
