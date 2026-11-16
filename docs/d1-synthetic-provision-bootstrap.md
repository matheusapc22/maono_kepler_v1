# Isolated Free pilot bootstrap: code preparation

This branch prepares a fixed runner, not a production migration. The owner approved
one D1, one Worker and one SQLite DO namespace in account
1988481e4c75c760516161104b7e1e50 for at most 24 hours, Free/USD 0, no card or upgrade.
The source plan remains enabled:false. No resource or credential was created while
implementing or testing this branch. Previous local tests are NOT remote evidence.

## Real observation and its limit

On 2026-11-16 at approximately 14:56 UTC the authenticated dashboard for
Maono - Ensaios / Workers Plans showed Gratuito, US$0 and Plano atual.
The observation is recorded in ops/d1-synthetic-provision/free-observation.json.
It is operator-observed evidence, not cryptographic provider attestation. The core
must reject it when more than one hour old. A fresh observation is required at
execution; an old screenshot/JSON cannot guarantee today's subscription. The
provisioning token cannot change subscriptions and the code never requests it.
No billing permissions are silently added to the approved Workers/D1 scope.

## Fixed resource/bootstrap design

Names and account are fixed in source/plan. Preflight requires an empty D1,
Workers and DO inventory in this isolated account, not merely absent name matches.
No incomplete pagination, unknown response shape or authorization failure means
empty. One D1 is created, then one fixed module Worker exporting a SQLite DO class.
The bootstrap rejects every HTTP method/path with a generic 403. It has no SQL,
storage effects, secrets, claim endpoint, user data or effectful invocation.

Upload and disabling workers.dev/Version URLs are separate provider operations.
Therefore the first deny-all version may temporarily have an endpoint; no operation
or information is exposed by its handler. A subsequent fixed request disables both
public endpoints, followed by a readback. Failure leaves a deny-all resource and
unknown/partial inventory, not an enabled executor. No DNS, route, subdomain
creation, invocation, migration or deletion is included.

Worker upload is an upsert. Empty preflight and a single protected job do not
provide a provider-side create-only transaction. The owner must not create/change
resources concurrently in this dedicated account during the approved window.
If that coordination cannot be assured, stop instead of overwriting a resource.

## Protected runner and replay exclusion

The prepared workflow runs local tests on PRs without secrets. Actual provisioning
would require a reviewed enabled plan on main, exact plan hash, fixed repository,
Matheus numeric actor ID, run_attempt 1, and the new synthetic-d1-provision protected
environment. Its owner-manual approval is deliberately non-independent; required
owner review stays mandatory and admin bypass must be false. No API approves jobs.
Production environments and the existing production policies remain unchanged.

Before the secret job, complete GitHub run history must show exactly one dispatch
for this fixed workflow: the current run. Any earlier/second dispatch or retry is
blocked, including a first attempt that failed before mutation. This conservative
one-shot fence requires explicit investigation/new reviewed plan after failure;
never delete run history to reopen it. Constant workflow concurrency prevents
parallel runs. Missing/forbidden history or environment metadata fails closed.
The separate filesystem journal uses exclusive creation and fsync before/after
each write. It is process/run durability, not a replacement for the GitHub fence.

The core never retries writes. A timeout is not cancellation. Any lost write or
journal acknowledgement stops with sanitized partial inventory and unknown status.
Artifacts are uploaded even after failure, but runner loss can prevent upload;
absence of an artifact is NOT evidence of no resource. Read-only reconciliation
of the fixed account/names is mandatory before any subsequent decision.

## Required before activation

1. Review code, unit/fake API tests and deny-all source behavior.
2. Refresh Free observation and inspect account inventory/permissions.
3. Create the isolated protected environment with Matheus required reviewer,
   self-review allowed and admin bypass disabled, then independently read it back.
4. Install a temporary provisioning token scoped only to the approved account and
   a separate read-only token through the protected credential channel. Never use
   broad OAuth, production credentials, chat or repository secrets.
5. Integrate the reviewed workflow into main through an explicitly approved code
   lifecycle; update the reviewed enabled plan/hash only once prerequisites match.
6. Matheus manually approves the protected job. Bootstrap receipts must then be
   checked against the actual account, bindings, namespace and endpoint state.

Passing this bootstrap does not authorize an effectful Worker or SQL. Later
identity/authentication/version proof and the fixed synthetic batch are separate.
The runtime version metadata binding and control-plane configuration must be tied
to the reviewed artifact; plain env vars or a sentinel cannot attest remote identity.

## Closure

The 24-hour window starts at the runner journal reservation before resource creation, not at code
preparation. Schedule a check then. Stop invocations (bootstrap already denies),
reconcile partial state and revoke temporary credentials through the approved
channel. Preserve receipts. Ask for exact-resource confirmation before irreversible
D1/DO/Worker deletion; verify deletion, never assume Worker removal clears DO data.
Never delete maono_maps or its UUID 5bc4dc32-f3bd-4c92-bbd1-cbda63e467db.
No automatic destructive cleanup or upgrade is implemented.

Journal notes: operational CLI requires Linux. It writes every byte, fsyncs the file and parent directories before acknowledgement. Local Windows tests do not attest Linux crash durability. The GitHub single-dispatch fence assumes workflow run history is not administratively deleted; it is not an external immutable deduplication store. No runner-host loss or lost artifact may be treated as permission to retry.

## Minimal main integration
This operational-only port is based on main 1585f29df7c019a177e106893aeac4b472acb50b. Sources were reviewed in product-stack PR286 at 5a00bb54538b46f74046266c64886016d0a812e1. Only bootstrap artifacts and the pure owner-review policy/test are copied. No product application, production operator, SQL migration, package.json or branch-history merge is included. Both checked-in plan and execution remain disabled; main integration alone must not dispatch this workflow. The read-only-audit policy helper is reused only for owner identity semantics after the bootstrap gate verifies its distinct environment name.
