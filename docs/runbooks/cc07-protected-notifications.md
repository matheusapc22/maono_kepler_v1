# CC07: preparation, protected test and account notice board

This change prepares code. It does not authorize a migration, Worker provisioning,
cron, protected dispatch, delivery, permanent rollout or retention policy.
COMMANDS, TRIAGE and SELECTIVE_ACCESS remain true throughout this suite and closure.
Only in-app notices exist; this implementation does not send email, SMS or push.

## Account notice board

The bell remains visible beside the profile, including when empty or unavailable.
It opens **Quadro de avisos** for the authenticated account in the current organization.
The existing profile menu is preserved. Read and unread items appear together;
opening the board or following a notice does not confirm visualization.
“Confirmar visualização” is explicit. Pending items have a textual state and badge.
Errors and loading do not imply a confirmed count of zero.

“Excluir” moves only that recipient's row to **Excluídos**. “Restaurar” reverses it.
Neither operation deletes events, candidates, outbox, another recipient's notice or
audit. Migration `0041_ticket_notification_recipient_state.sql` adds recipient-local
`dismissed_at`, `version`, `action_token`. Writes use version checks, desired-state
replay and an atomic audit batch. There is no automatic purge or invented retention.
Old schemas remain readable; reversible actions fail closed until 0041 is applied.
Apply requires the separate AGENTS migration audit, exact hash approval and human gate.
The additive SQL uses SQLite `ALTER TABLE ADD COLUMN`, so it is not itself repeatable.
Idempotence is enforced by the migration ledger/audit gate, which rejects reapplication.
Local tests cover upgrading existing rows, retained events/outbox and integrity, plus
rejection of a raw second application without changing the upgraded rows.

The board refreshes on focus, visibility, successful notice actions and each minute.
Session/organization transitions discard old content and ignore late responses.
Authorization, membership, private ticket ACL and internal-note permissions are
rechecked server-side for every list, count and action. This is not a global publisher.

## Required separate decisions before any protected test

1. Review and merge product and dispatcher PRs normally; verify their exact SHAs and
   Pages deployment. Audit/apply 0041 through the migration operator, separately.
2. Choose a **dedicated organization other than QA9**, empty except for an explicitly
   approved preserved baseline described below, with no legacy tickets,
   a ready command backfill marker, and three dedicated non-admin accounts. The manager
   needs view/create/manage/access.manage; allowed and restricted need ticket.view
   without ACL bypass. No production IDs or identities are selected by this patch.
3. Approve infrastructure provisioning separately: one fixed Worker
   `maono-ticket-notifications`, no HTTP/queue/service handlers, canonical D1 DB and
   native `CF_VERSION_METADATA` version metadata binding only,
   two reviewed immutable versions with identical code ETag/runtime/bindings except
   consumer OFF/ON. Baseline is OFF at 100% with no schedules. The operator never
   creates/uploads a Worker/version, secret, binding or account.
4. Approve the exact organization allowlist/cutoff in both Pages configuration and
   canonical deployment, keeping the inbox OFF before preflight. The operator only
   changes the registered boolean inbox flag; it does not invent scope/cutoff.
5. Choose a future window, pause writers, identify a human recovery owner and approve
   event/attempt/batch limits and cost. An API readback does not eliminate propagation
   delay or hard-interruption risk. Worker policy expires at the approved end time;
   an interruption can still require human configuration closure and exact-ID cleanup.
6. Provide secrets directly to the protected Environment, never to chat/artifacts:
   existing Pages-control token; `MAONO_ACCEPTANCE_CC07_WORKER_TOKEN` restricted to
   this Worker; `MAONO_ACCEPTANCE_CC07_D1_READ_TOKEN` with D1 **read-only** scope;
   `MAONO_ACCEPTANCE_CC07_QA_CREDENTIALS_JSON` containing only manager/allowed/restricted
   `{email,password}`. The old QA9 credential bundle is not exposed to CC07.

## Reviewed data-only plan (`cc07_plan`)

The exact shape is validated by `cc07-plan.mjs`. Unknown keys are rejected.
No URLs, SQL, command strings, HTTP methods, flag names or secret names are inputs.

| Field | Required evidence |
|---|---|
| version / productSha | Version 2 and exact pinned product SHA; old plans fail closed |
| organizationId / qaIds | Approved non-QA9 org and three distinct manager/allowed/restricted IDs |
| worker | offVersion/onVersion UUIDs, reviewed codeEtag, fixed cron `* * * * *` |
| policy | Fresh UUID runId, matching organizationId/managerId, UTC startAt/endAt, approved maxEvents/maxAttempts/batchSize |
| approval | actor, confirmedAt, writersPaused, syntheticOnly, workerVersionsReviewed, costAndVolumeApproved, humanRecoveryAvailable |
| qa9 | outboxCount 13 and digest from the reviewed structural SQL inventory |
| limits | Explicit deliveryWaitSeconds (60–600), quiescenceSeconds (125–300) |
| readiness | Explicit waitSeconds (60-1200) for each OFF scheduled proof; separate from delivery |
| preserved | null for empty scope, or reviewed ticketId/runId/managerId/recipientId/version/cycleNumber, exact two outboxIds/four eventIds and structural digest |

Technical bounds are ceilings, not granted volume/cost: at most 25 events, 125 total
attempts, batch size 25 and a 210-minute window. The operator retains the 190-minute
execution/210-minute job limit, 75-minute cleanup/restoration reserve and 135-minute
initial admission, rechecked before each ON transition. Readiness consumes existing
phase budgets; it does not extend them or the delivery deadline. Inventory validity is ten
minutes from its **oldest** query; it is renewed after authentication. Foreign activity,
truncated inventories, schema/identity/version drift and QA9 hash mismatch stop the run.

The Worker versions bind `MAONO_TICKET_NOTIFICATION_ACCEPTANCE_JSON` to the compact
JSON `policy` object, the single organization allowlist, and `START_AT=policy.startAt`.
The consumer filters the exact `QA-CC07-<runId>` ticket plus creator, org and cutoff;
rejects unrelated post-cutoff activity; caps aggregate attempts atomically at claim;
and caps leases at the window end. Production configuration including QA9 is rejected.
The 13 QA9 rows remain pending and unmodified; no “delivered” workaround is allowed.

## Protected sequence and limits of evidence

`preflight` performs only Cloudflare GETs and fixed D1 SELECTs; no QA secret, login,
fixture, schedule or flag write. It checks existing infrastructure and migration;
it cannot provision missing prerequisites. Report and stop for window authorization.

`run` requires owner/main, attempt 1, registered suite `cc07-notifications`,
`RUN_PRODUCTION_ACCEPTANCE` and human Environment approval. It authenticates dedicated
profiles, renews evidence, arms restoration, opens an ephemeral Worker Tail session,
and installs the fixed schedule with the reviewed OFF version still at 100%. It waits
for a successful scheduled invocation with an exact OFF receipt before publishing
the inbox flag on the same SHA,
creates one synthetic ticket and immediately privatizes it before starting the Worker.
There is brief organization visibility between create and private ACL, with fictitious
content only. Delivery, create replay, recipient read/delete/restore and ACL revocation
are checked via API and the scheduled Worker. Local tests additionally fault-inject
retries/lease loss; a normal productive run does not prove provider outage behavior.
The receipt is checked again after Pages publication, immediately before ON. Between
delivery and the revocation test, the schedule remains installed while the consumer
is OFF; another fresh OFF receipt is required before reactivation. The final cleanup
removes the schedule. This avoids treating schedule readback as proof of invocation.

Cleanup stops schedules and restores the approved OFF Worker version before closing
the exact owned ticket with a fresh canonical ETag and manager-only ACL. Ticket, cycles,
events, candidate decisions, notices and audit are retained. Closing can add a pending
outbox; it is preserved, not consumed. The inbox returns OFF; COMMANDS stays true.
The report verifies API configuration, quiescence, structural counts and outside-scope
digests. It does not assert instantaneous worldwide cron propagation, email delivery,
all-organization coverage, SLA, exports, notification retention or permanent readiness.

An uncertain write is read before another intent, never blindly repeated. An uncertain
creation has no auto-adoption or second fixture. `closure` contains infrastructure and
restores flags without logging into QA, but cannot claim the ticket is closed without
the original journal and a separately approved exact-ID recovery. Never cancel recovery
blindly or set SELECTIVE_ACCESS false. Permanent notifications remain a separate gate.

Cloudflare contracts: [versions](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/),
[deployments](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/),
[schedules](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/update/).
Unexpected response shapes fail closed and need review; no fallback endpoint bypass.

## Delivery timeout diagnosis and retry boundary

The report records `workerControls` (request/completion timestamps, confirmed or
unconfirmed control outcome, deployment/version/schedule readback) and `deliveryWaits`
(stage, fixed deadline, samples, result and last validated aggregate inventory).
Readback is explicitly `configurationReadbackOnly`: it is not a scheduled invocation
receipt. Inventory observations contain counts/states/timestamps, never notification
content, recipients, credentials, leases or raw provider errors. A diagnostic checkpoint
failure cannot replace the original error or prevent containment; the mandatory
checkpoint before arming configuration writes remains fail-closed.

`NO_PERSISTED_PROCESSING_OBSERVED` means exactly that. Zero attempts can result from
a scheduler that has not invoked the Worker, a handler failure before claim, or an
eligibility rejection. It cannot establish which happened. Check the reviewed version,
bindings, allowlist/cutoff/policy, scheduler history and existing observability before
attributing a cause. Local tests exercise the real scheduled handler with delayed
invocations and a database failure before claim; both can have zero attempts.

Cloudflare documents that [Cron Trigger additions, updates and removals can take up
to 15 minutes to propagate](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
An immediate five-minute delivery observation can therefore end before propagation;
this is a possible mechanism, not proof of a particular production failure. The patch
does not extend any deadline, reserve, retry count, lease or operational authorization.
After removal, OFF readback plus stable structural counters are bounded observations,
not proof of immediate global quiescence. Preserve the OFF version and verify existing
history/counters by read-only means after the propagation horizon when required.

A failed run leaves its private, closed synthetic ticket and pending outboxes intact.
Plan v2 can explicitly preserve one such baseline: exact origin run, ticket ID,
creator/version, closed/private state, one closed original cycle, manager-only ACL,
no attached policy, four approved events, and two pending outboxes with zero attempts,
no lease/delay/error/completion, two approved recipient candidates and no notices.
Counts and ID sets must agree. The canonical digest covers structural projections,
not message or closure text; append-only event content is not fetched into reports.
Use `preservedCc07Snapshot` and `preservedCc07Digest` only to construct the separately
reviewed plan from approved evidence. Never recompute/adopt a changed digest in a run.
The source timestamp remains the oldest query; hashing does not renew its validity.
Unknown rows still fail the empty/current-run checks. Old rows are partitioned only
after their full gate passes, verified again through final audit, and excluded from
consumption by the new run's subject/creator/cutoff policy. QA9 protection is unchanged.

## Observable OFF proof, access and interruption boundary

The [Cloudflare Tail create](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/tail/methods/create/)
and [delete](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/tail/methods/delete/)
APIs accept the existing `Individual Workers Editor` permission on this Worker. No
new token, Tail Worker, persistent logging or database heartbeat is introduced.
The reviewed versions must include the [native version metadata binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/).
They must be uploaded/reviewed separately; this code change does not update deployed versions.
The protected read-only preflight neither creates a Tail nor proves Tail access.
If access is denied during the authorized run, stop and report; never broaden the token.

The temporary trace-v1 stream is restricted to the fixed Worker and official Tail
websocket host. Raw frames, URLs, provider errors and credential values are never
persisted. Only a bounded successful scheduled event, with no exceptions and exactly
one receipt matching native OFF version ID, run, organization, cron and scheduled
time, can admit ON. The receipt must be after OFF readback and no more than 120 seconds
old. Missing proof, a failed handler, disconnection, malformed frame or expiry fails
closed. A fresh readback and inventory plus the 135-minute admission gate still apply.
This proves one OFF invocation, not global propagation, delivery or ON database health.
The existing delivery cases and diagnostic counters remain necessary; the original
production timeout cause is still unproven.

The Tail is deleted on normal success and all handled failures, independently of
configuration restoration. Uncertain creation is never retried automatically;
unconfirmed deletion is reported and cannot be marked complete. A hard kill can bypass
finally: the provider session has a bounded expiration (validated at at most 24 hours),
while policy expiry and separately authorized closure remain the production safeguards.
Do not resume an old run or accept an old receipt. Renew plan, evidence, versions and
human approval, inspecting actual state before any recovery mutation. Keep OFF after
final schedule removal; read-only counters/history after the documented propagation
horizon provide additional bounded quiescence evidence, not an instantaneous guarantee.

## CLI transport shutdown

Deleting the provider Tail does not prove that the local WebSocket has closed.
The operator therefore owns the ephemeral socket in an isolated Node worker thread,
with no inherited environment or runner arguments. Provider deletion, restoration
and report writing stay in the main process. Shutdown attempts both provider deletion
and local disposal, even if either fails; repeated/concurrent close shares one result
and never retries an uncertain DELETE. A prior operational error remains the primary
error, with separate cleanup evidence.

The socket has at most one second of handshake grace (shortened by the remaining
budget), then only its transport thread is terminated. Actual thread exit is awaited;
one second is the handshake limit, not a guaranteed operating-system termination
deadline. There is no forced process exit or early unref that could discard evidence.
The report distinguishes `transportClosed`, `transportTerminated` and provider
`deleted`; incomplete remote cleanup still fails the run. Expired budgets permit local
resource disposal, not extra production requests or a larger recovery window.

The CLI regression runs the actual entrypoint in child processes with local-only
provider/SQLite fixtures and a real loopback WebSocket peer. It checks natural process
exit and saved reports for normal/no-response close, DELETE rejection/timeout,
connection/readiness failures and preservation of the original error. Node 22 and 24
can reproduce the old live-socket failure when the peer ignores close. This establishes
a code failure mode; it does not identify an unrecorded handle from a past runner.
