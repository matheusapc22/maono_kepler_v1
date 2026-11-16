# Synthetic remote pilot manifest and read-only operational increment

## Decision

Stop expanding generic local models. This PR supplies only the first operational
bridge: a narrowly scoped GET-only metadata audit, tested with fake HTTP responses.
It does not create resources, deploy code, query SQL, install secrets or delete data.
The checked-in manifest is intentionally unconfigured and audit-disabled. Nothing
may fall back to repository production configuration or a current Wrangler login.

## Account and authority

An isolated Free account Maono - Ensaios was reported created on 2026-11-16:
1988481e4c75c760516161104b7e1e50. The operational manifest stays unconfigured
until the concrete pilot is approved and actual resource receipts exist.
The account 09d455fa1cf988b0d9db89987b73eaff was observed in the Maono Pages check URLs;
it is excluded from this synthetic audit along with the canonical maono_maps UUID.
This exclusion is a guard, not evidence that another account belongs to the user.

Before enabling even this audit, identify an existing isolated account by its exact
ID and owner-approved scope. Record actual resource receipts after separately
approved provisioning. Fill manifest through a reviewed PR; do not accept arbitrary
account/database inputs in workflow_dispatch. No remote token enters chat or agent
runtime. Use a dedicated protected GitHub Environment for a read-only audit token.

## Proposed pilot budget, not authorization

Initial proposal: one Worker, one SQLite Durable Object namespace and one fresh
synthetic D1, at most 24 hours, USD 1 maximum incremental spend. This is a suggested
ceiling, not a price estimate, guaranteed provider spending cap, purchase approval
or promise of zero cost. authorizedSpendingLimitUSD stays null until the owner
approves actual plan/limits and the concrete manifest. No subscription upgrade is
included. Confirm quotas and existing plan before provisioning. Do not provision
the entire ten-case matrix before the first success checkpoint.

## Lifecycle

1. Review this GET-only bridge and exact target/account identity, without grants.
2. Approve a concrete pilot manifest, narrowly scoped credentials and resource cost
   ceiling. Provisioning/deploy are a separate change, not implemented here.
3. Use protected runner receipts to pin D1, deployment/version, namespace and bundle.
   Account API ownership, active routing, complete bindings and artifact authenticity
   must be independently established; a local HMAC fixture is not real provenance.
4. First perform the read-only metadata audit. It is NOT production migration audit
   and never generates a production apply approval token.
5. Only after another reviewed executor change, invoke one fixed synthetic batch.
   Verify complete poststate independently. A timeout is unknown, never retry.
6. Expand to rollback/lost-response tests in new targets only after reviewing the
   first result and an expanded resource budget. Full remote matrix remains needed
   before proposing any production executor.

## Cleanup contract

Keep each UUID/name/deployment/namespace and receipt in an allowlisted inventory.
At completion or the proposed 24-hour deadline, report remaining resources and
seek exact-resource confirmation before irreversible deletion. No automatic delete,
account-wide enumeration-and-delete, prefix-only deletion or TTL registry reset.
Disable invocation access first under its own approved scope. Preserve sanitized
receipts and results; preserve claim records while their target can still be invoked.
Remove only confirmed synthetic resources, never maono_maps or the excluded account.
If cleanup fails, report the exact resource and continued exposure/cost; do not claim
it is gone. This PR does not implement cleanup or schedule an unapproved deletion.

## Permission plan

Read-only D1 metadata: D1 Read. Worker version/deployment metadata: Workers Scripts
Read or the supported individual-Worker read role. Prefer individual scope once a
synthetic Worker exists. Do not request Workers/D1 Write for this audit. The later
provisioner would require D1 Write and Worker write/editor capabilities, and must be
separately approved. A token being accepted for an API is not proof it cannot reach
other resources. Validate the effective resource scope, particularly for D1.

## Still absent

Provisioner, real deployment/invocation secret management, production executor,
real build-attestation authority, mutation fencing and remote failure evidence.
A GET audit can establish only the fields it actually observes; exact version
metadata is not automatically proof of currently active routing or bundle bytes.
Do not label this PR or passing mocked tests as remotely proven.

## Workflow activation barriers

`d1-synthetic-readonly-audit.yml` runs mocked tests and validates the disabled
manifest for PRs. Remote audit is dispatch-only from main, requires a configured
manifest explicitly enabled in reviewed code, an exact manifest hash, and the fixed
GitHub Environment synthetic-d1-readonly-audit. The workflow first reads that
existing environment's protection metadata and refuses unless reviewers exist,
the chosen owner-manual-review policy matches and admin bypass is disabled. A forbidden/unavailable
GitHub metadata request fails closed; do not broaden token permissions automatically.
The environment must be configured separately before enabling the manifest. No
secret-bearing job is scheduled from a PR, arbitrary branch or the default draft.
The fixed token secret is only for synthetic metadata reads. No input selects
account/Worker/database/URL or supplies SQL. Passing tests cannot enable the audit.

## Routing / propagation is not proved by this audit

Cloudflare documents deployment propagation and version overrides, including
selection of a version configured for 0% traffic. Reading deployment metadata
reporting 100% does NOT establish which version receives a particular request.
The GET-by-ID audit may inspect a historical deployment, so it always emits
activeDeploymentVerified:false, deploymentPropagationVerified:false,
versionOverrideProtectionVerified:false and liveInvocationBindingVerified:false.
No effectful gate may treat pinnedMetadataMatched as operational readiness.

This PR never invokes a Worker and sends no version override or affinity header.
For a later invocation design, explicitly determine whether the chosen endpoint
supports overrides, prevent unintended override/affinity inputs before platform
routing, and establish the effective running version/binding with trusted evidence.
Rejecting a header inside an already selected Worker alone cannot prove what code
was selected before its handler ran. Do not assume Version URLs, service bindings
and ordinary routes share identical behavior. Until those endpoint-specific proofs
exist, effectful execution stays blocked. The present audit cannot provide them.

Sources checked 2026-11-14:
- https://developers.cloudflare.com/workers/versions-and-deployments/
- https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/

## Human-reviewer decision selected 2026-11-16

Matheus chose his own manual approval for the isolated synthetic environment,
acknowledging this is not independent review. The prepared validator pins the
repository, dispatch actor numeric ID and exactly one owner reviewer. It requires
prevent_self_review=false and can_admins_bypass=false, never autoapproves, and
fails closed on absent/unreadable protection metadata. This is code preparation,
not environment configuration or credential authorization. Production rules remain
unchanged. See d1-synthetic-fixed-pilot.md for exact identity and remaining gates.

## Reproducible manifest digest

The approval input is SHA-256 of the manifest's UTF-8 text normalized from CRLF to
LF. BOM, malformed UTF-8, lone CR and oversized input are rejected. No JSON semantic
reordering is performed. This makes Windows and Linux checkout hashes agree while
still binding the reviewed manifest text. Run `cli.mjs --validate` to obtain this
canonical digest; do not substitute a platform-specific raw-file hash.
