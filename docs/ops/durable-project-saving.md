# Durable project saving

## Contract and guarantees

The only publication writer is `project-save-operations.js`. Explicit user save
attempts receive a stable operation ID, immutable byte manifest and a historical
receipt. Client/API contract 2 rejects contract 1 and headerless old writers before
reading their payload. Keep the draft or export it before manually updating an
old tab. There is no automatic reload and no legacy-write fallback.

Schema 19 remains unchanged. Migration `0039_project_save_operations.sql` adds the
separate version-1 capability; missing capability fails closed. Reading historical
revision and legacy storage references remains supported. No bulk storage
migration is implied.

Registration is not upload acceptance. Only a complete verified operation-owned
object plus atomic D1 `PAYLOAD_STORED` and outbox commit is durably accepted. The
browser may close after that boundary. Before it, remaining bytes require the
browser snapshot. D1 publication is at most once per operation; Dropbox effects
are idempotent, not a cross-provider exactly-once transaction.

The processor fences permission-generation, grant expiration, project revision,
lifecycle and its lease epoch in the same transaction that creates the revision,
project pointer, domain completion, outbox effects and receipt. SQL zero-row CAS
must abort the transaction. A delayed worker cannot publish its old lease.

Objects use server-derived operation/upload-epoch names. Upload finish response
loss is reconciled by downloading and checking the immutable candidate before any
new bytes are sent. Different attempts cannot overwrite each other's object.

## Browser recovery and retention

Only explicit save snapshots are persisted, with account + organization + project
scope, exact Blob bytes, versioned manifest, operation ID and edit generation.
When a browser rejects native Blob persistence, the same IndexedDB store uses a
versioned ArrayBuffer encoding and reconstructs the exact Blob on read. Existing
Blob records remain readable. Only the known native Blob preparation/cloning
failures permit this encoding change; quota, corruption and transaction failures
still block transmission. A save is locally accepted only after the transaction
commits. Expiry purges both payload bytes and creation metadata; a later verified
server receipt can still confirm an expired local attempt without restoring bytes.
No cookie/token is stored. Later edits are not autosaved and are not guaranteed to
survive closing the tab. A late receipt cannot remount the editor or mark newer
edits saved. Recovery queries status before deciding whether upload is needed.

Pending local payloads have a seven-day recovery window. Expired or damaged data
requires an explicit warning/export decision; it is never silently resent as a
new operation. Confirmed receipts remove local payload bytes. Account switching
must not expose another account's snapshots. Confirm deployment's shared-device
logout/preservation policy before activation.

Server receiving operations expire after seven days; durably received processing
has bounded retry/backoff with explicit terminal failure. Receipt identity is
retained and never reused. No automatic storage garbage collection ships in this
cut: operation-owned orphan candidates are retained until a separately reviewed,
reference-aware cleanup policy is approved. This avoids deleting a delayed upload
or a published object merely because a timer elapsed.

## Removed or adapted equivalent writers

- Editor inline update and streaming update: operation endpoints
- Legacy map save, small and large: operation-owned promotion
- Creation: metadata reservation, then the same operation protocol
- Change-request apply: approved artifact and same atomic publication core
- Legacy lifecycle reconciliation: same operation core
- `POST /projects/{slug}/save` and `PUT /projects/{slug}/config`: retired (412)
- Unused administrative multipart map creation endpoint: retired (412); imports
  must use the same reservation/operation contract as editor creation
- Generic organization-file upload: rejects collision with a linked map config
- Old revision reservation/recycler/overwrite implementation: removed
- Read-only versioned config delivery, current map UI and independent thumbnails:
  preserved

## Activation gates (not performed by this code change)

1. Finish local/CI tests and review. No merge, deployment or real-data mutation is
   implied by implementing or publishing this draft PR.
2. Audit migration 0039 using the protected production D1 migration operator on
   an exact clean Git SHA. Report filename/SHA-256, database identity, pending
   digest, integrity checks, Time Travel bookmark and approval hash, then stop.
3. Obtain human authorization explicitly naming that migration and approval hash.
   Apply only that migration using the isolated operator. Post-validate and stop.
4. Verify Pages and recovery Worker bindings read-only. Preview may share
   production; never treat it as safe for mutation based on its name.
5. Separately approve Worker provisioning, secrets, costs, retention policy and
   deployment. Enable its recovery worker and prove scheduled recovery with the
   registered synthetic acceptance suite in an authorized window.
6. Only then separately authorize `PROJECT_DURABLE_SAVE_V1=true` admissions. The
   legacy writer remains unavailable whether this flag is on or off.
7. Production acceptance, permanent rollout and merge remain separate approvals.

Cron's minute granularity is not a completion SLA. Outbox is the durable source;
HTTP `waitUntil`, a running tab or a best-effort immediate worker is insufficient.
Observe oldest due outbox age, pending counts, retries, terminal errors and worker
invocations. Alert on stalled accepted operations before the recovery window ends.

## Safe rollback

Pause new admissions, retain compatible readers/status endpoints and keep the
recovery Worker draining accepted operations. Do not restore the overwritten
legacy writer, drop operation tables/receipts or roll back schema destructively.
A compatible rollback build must understand operation storage refs and historical
receipts. Resolve terminal conflicts explicitly; never change base revision just
to force an old snapshot over newer content.

## Verification evidence

Record exact commit, passed/failed/not-run lint, typecheck, build, expanded unit
suite, SQL fault injection and local browser cases with the PR. Local SQLite and
simulated Dropbox HTTP validate the protocol implementation; they do not prove
production bindings, cloud scheduling or real Dropbox service behavior. Production
acceptance is blocked until its separate protected human-gated window.

## Pre-existing in-flight legacy revisions

Before enabling admissions, execute the read-only inventory in
`scripts/audits/project-save-cutover-readonly.sql` through the authorized audit
process. Retain its report with the pinned migration SHA. Unpublished legacy
WRITING/READY candidates at N+1 are an activation blocker, not evidence of an
orphan. Old requests must finish/drain; compare D1 pointer/lineage and exact
storage metadata before deciding how to reconcile each remaining row. A repair
that writes D1 or removes storage requires its own protected human authorization.
Do not mark a candidate failed or delete it merely because thirty seconds passed.

The new processor returns the explicit terminal intervention reason
`PROJECT_SAVE_LEGACY_CANDIDATE_RECONCILIATION_REQUIRED` instead of overwriting such
a candidate or retrying generic transaction failures eight times. Preserve the
clicked snapshot for a reviewed new attempt after the operator resolves the
blocker. Post-migration health queries are in
`scripts/audits/project-save-health-readonly.sql`; alert on accepted operations
stagnating longer than the operational recovery target, and investigate terminal
errors rather than silently abandoning them.

The administrative file-to-project conversion also uses the durable core. Its
small account/organization-scoped intent is stored before submission; source bytes
already exist on the server and are copied unchanged into an immutable operation
object. Original files remain intact. The selected administrative organization is
request-local and does not change the user's session organization. Current
organization access copying and creator ownership commit atomically with the
initial revision and receipt.

## Additional runtime details

`PROJECT_DURABLE_SAVE_INLINE_ENABLED` defaults to true and controls only the
immediate call of the common processor. False leaves the already committed
payload/outbox for the independent Worker; it never selects another writer.
The registered acceptance suite uses false to prove browserless continuation.
The recovery Worker emits per-operation ID/stage/state/duration/error-code logs
and a `PROJECT_SAVE_STAGNANT_OPERATIONS` alert log for accepted work older than
15 minutes. Routing that alert to the operator's monitoring destination remains
an activation task; no external notification integration is silently provisioned.

`VITE_ASYNC_PROJECT_THUMBNAIL=false` suppresses background PNG generation. There
is no legacy synchronous PNG-in-config fallback; the default is true. IndexedDB
payload expiration is swept on the next database access, not while the browser
is closed. Confirmed/acknowledged metadata may remain for recovery while payload
bytes follow the seven-day maximum or are purged after a validated receipt.

This replacement build intentionally contains no legacy writer. Deploying it
before the additive migration and admission activation creates a save-maintenance
window: readers continue working, but new saves remain paused. Plan that window
explicitly; this PR is not a zero-downtime activation by itself. Do not enable the
new writer until the independent Worker, bindings, ACL/cutover audit, acceptance
and rollback-compatible build are ready. `PROJECT_LIFECYCLE_V1` must already permit
creation; the durable-save suite never broadens unrelated product feature flags.

## Registered synthetic acceptance (code prepared; execution separately gated)

`durable-project-save` is registered in the existing protected Production
Acceptance Operator. The unaudited large-create Preview runner and its workflow
are retired: a Preview hostname cannot establish isolated database/storage
bindings. Neither entrypoint performs remote requests now. Do not dispatch the
protected suite as part of preparing, reviewing or publishing this code.

The suite is fixed to organization **9 / maono-preview-qa** and at most two
new run-UUID-scoped projects. The runner authenticates only `creator`, a dedicated
QA editor with global `project.create`. Real owned-project API responses establish
its project rights; no artificial global view/save/map-edit permissions are added.
A different human `super_admin` captures the read-only administrative inventory
in their existing canonical-origin browser session. Their credentials never enter
CI. No existing project slug is accepted.

The existing protected QA secret has exactly
`{creator:{email,password},manualInventory:<before export>}`; additional credential
profiles, including `administrator`, are rejected. No new workflow, input or
secret is needed. `manualInventory` binds the registered suite, exact release SHA,
new UUID, active organization 9, canonical origin, human administrator and complete
sanitized synthetic inventory, plus `workflowRunId` (decimal string) and
`workflowRunAttempt:1`. The operator requires matching `GITHUB_RUN_ID` and
`GITHUB_RUN_ATTEMPT` exactly `1`; the final report carries both. The export must
be no older than 15 minutes before activation and is rechecked immediately before
the first flag write, after queue quiescence. A post-deployment recheck permits
up to 75 minutes from capture, allowing the separately bounded 60-minute activation. Existing
synthetic projects or active/linked files block a new run. Historical inactive,
unlinked tombstones are retained.

After window authorization, dispatch the registered `run` and wait for validation
to finish and the protected Environment approval to become pending. Only then
capture `before({suite,expectedCommit,workflowRunId})`, using the actual ID from
that Actions run URL, and save the fresh bundle in the existing
`production-acceptance` **Environment-level** QA secret. Do not approve until it
is saved; repository/organization secret fallback does not support this timing.
GitHub reads Environment secrets at job start and gates access on approval; see
[GitHub's reference](https://docs.github.com/en/actions/reference/security/secrets#when-github-actions-reads-secrets).
The protected job has no application build; setup step caps total 11 minutes.

Missing/expired binding or any failed attempt requires a new dispatch, new export
and new UUID after preserving/checking prior state and proving no mutations or
pending resources remain (or completing separate reconciliation), even if the internal preflight
failed before mutations. Never rerun the job, reuse the bundle/UUID, or try to
change a running/approved job's secret. First-attempt/run binding and the human
rule prevent ordinary replay; this is not a server-side single-use ledger.

Its managed flag window is explicit:

- `PROJECT_DURABLE_SAVE_V1`: required baseline false, active true, restored false.
- `PROJECT_DURABLE_SAVE_INLINE_ENABLED`: required baseline true, active false,
  restored true. The normal application default is true, but acceptance requires
  explicitly observed configured and deployed values, not an assumed default.

The independent scheduled Worker must already be deployed and enabled following
its own binding audit and human approval. The suite never provisions or deploys
it. Upload must confirm durably received bytes. Normally this is
`202 / PAYLOAD_STORED`; an independent Worker may already advance to processing
or return `200 / PUBLISHED` with a matching immutable receipt before the upload
response arrives. This race is valid with inline processing disabled. Subsequent
GET-only polling observes publication within an eight-minute observation window;
this is evidence of asynchronous processing with the inline path disabled, not a
promise that cron will finish within one minute. Failure to observe a terminal
state fails acceptance and still runs the closure barrier, preserves the resource
journal and attempts flag restoration; it does not make resource deletion safe.

Coverage uses the real reservation (`durableSave:true`), manifest registration,
raw payload and status routes with stable `X-Maono-Project-Id`. It includes a small
creation, an exact 94 MiB creation, duplicate registration/payload/reservation,
same-ID/different-manifest rejection, a historical revision-1 receipt after
revision 2, a stale-base conflict with no overwrite, and headerless/contract-1
rejection. Lost acknowledgement is explicitly **modeled** by discarding the
accepted upload result and polling; it does not claim physical network fault
injection. Large read coverage verifies the revisioned direct-download descriptor;
byte integrity is evidenced by the server-verified receipt, not an independent
client download. Local HTTP/SQLite and browser tests remain distinct evidence.

A closure barrier and a sanitized resource journal are armed before the first
reservation. The before-export UUID becomes the report/checkpoint run ID; journal
artifacts record intended names and known project/file IDs at reservation
boundaries. The runner never calls administrative APIs or DELETEs resources.
A lost reservation ACK stays uncertain even if an immediate inventory is empty:
the original request may still create metadata. Do not infer closure or broaden
the cleanup scope from a prefix search.

Even when all functional cases pass and flags are restored, the original run
ends with `operationalTestsPassed:true`, `DS-CLEANUP=PENDING_MANUAL`,
`cleanupComplete:false`, `MANUAL_CLEANUP_REQUIRED`, `complete:false` and exit 1.
Do not rerun acceptance to turn this expected pending-manual result green.

Only an otherwise successful functional run is eligible for the normal manual
cleanup flow: all required cases PASS, `operationalTestsPassed:true`,
`acceptanceStatus:PENDING_MANUAL_CLEANUP`, `MANUAL_CLEANUP_REQUIRED`, verified safe
restoration and no budget/restore failure. Failed, cancelled or interrupted runs
retain IDs/journals for separate human read-only reconciliation. An acknowledged
reservation, closed browser, restored flags or empty inventory cannot prove that
accepted remote Worker operations are terminal. Do not delete resources until
terminality is established and the exact IDs receive separate approval. This
procedure adds no D1 repair/write or new operator.

The read-only browser helper `scripts/acceptance/manual-admin-evidence.js`
provides `before`, `inspect` and `after` against fixed same-origin GET routes,
using the human's existing session without reading cookies/storage. `inspect`
binds exact creator, organization, name, slug, project and linked file to the
unchanged report. The ordinary Admin UI has no matching cleanup controls;
`/admin/files` redirects to the organization screen. After explicit approval of
the exact IDs and effects, the human performs irreversible
`DELETE /api/admin/projects/{projectId}` (HTTP 200, `deleted:true`; then GET 404)
and reversible `PATCH /api/admin/organization-files/{organizationFileId}` with
`{"active":false,"isProject":false}` (HTTP 200, matching file and flags false).
The file PATCH cannot restore the deleted project. No bulk sweep, file DELETE,
Dropbox deletion, ACL change or storage garbage collection is authorized.
Immutable JSON/PNG objects, historical receipts and tombstones remain retained.

`after` confirms project absence and exact inactive/unlinked files against a new
inventory. The offline `scripts/acceptance/verify-manual-cleanup.mjs` validates
that export with the immutable final report and writes a separate certificate.
It does not rewrite the pending original run. `inspect` and certificate validation
reject functional failures, cancellation, interruption or budget/restore errors;
they cannot issue a cleanup certificate for those runs. Content hashes bind
evidence but do not authenticate the human export,
so artifact/session provenance must be reviewed. Follow the exact procedure in
[the operator runbook](../runbooks/production-acceptance-operator.md#inventário-e-cleanup-humanos-para-jsonpng).
An interrupted run's separate `closure` restores flags only; uncertain resource
outcomes require investigation, not another acceptance window.

A separate fail-closed prerequisite checks `PROJECT_QUOTA_RESERVATION_V1` in both
configured and canonical Pages environments before opening the window, including
a fresh check immediately before its first flag mutation. It must be absent or
explicitly disabled. If quota reservation is enabled, a failed creation can leave
an active quota reservation, and existing public cleanup endpoints cannot prove
its release. The suite refuses to run in that condition; it never disables quota.
Whether the real account has that flag enabled has **not** been verified remotely.
Supporting that configuration needs a separately reviewed cleanup implementation
and contract tests before acceptance can run. Active-quota behavior remains a
local integration-test responsibility meanwhile.

The protected operator runs from the repository default branch `main` and checks
out the pinned product release according to its existing workflow. Ensure that
the reviewed operator and registered-suite code are present in that protected
release path before attempting `describe` or `preflight`. This implementation
does not create or merge a separate default-branch PR. The acceptance baseline
requires both admission=false and inline-processing=true to be explicitly
observable in configured and canonical deployment variables.


### Bounded acceptance and interruption evidence

The reviewed operator phases have separate limits: preflight 10 minutes,
activation 60, suite mutation 45, cleanup 10, restoration 60, and report 5. Their
combined maximum is 190 minutes. The protected job limit is 210 minutes. Its
setup steps are independently capped at 11 minutes total (checkout 3, ref check
1, Node setup 2, browser installation 5); the operator step has 192 minutes,
summary 1 and artifact upload 2. The sum of step caps is 206 minutes, leaving four
minutes of job overhead. Setup failure therefore happens before the protected
operator receives credentials or changes flags; setup time is not assumed free.

The phase deadline caps Cloudflare waits, request timeouts, response-body reads
and application polling. Before activation or application admission the operator
requires the remaining cleanup/restoration/report reserve. An expired suite gets
fresh cleanup and restoration phase budgets rather than reusing its expired
request deadline. Unknown outcomes remain failures. Limits are reviewed code,
not arbitrary workflow inputs; they are observation budgets, not service SLAs.

After QA authentication and before any flag or suite-resource mutation, a
sanitized checkpoint is written and
its run ID is printed to the durable Actions log. The artifact pattern includes
the checkpoint as well as the final report. Preparation also refuses prior
run-scoped projects or active/pending synthetic files, while allowing inert file
tombstones. A missing ACK for a reservation cannot be proven safe by a zero-row
inventory alone.

`finally` cannot survive runner loss, hard termination or job cancellation.
These bounds reserve time for ordinary timeout recovery; they are not an external
fail-safe. If interruption still happens, use the recorded run ID and checkpoint
for separately authorized closure, verify safe flags and reconcile synthetic
resources before opening another window. Never infer completion from elapsed
time, a missing report, an empty immediate inventory, or flags alone.
