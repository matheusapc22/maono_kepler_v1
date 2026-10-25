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
2. Choose an **empty dedicated organization other than QA9**, with no legacy tickets,
   a ready command backfill marker, and three dedicated non-admin accounts. The manager
   needs view/create/manage/access.manage; allowed and restricted need ticket.view
   without ACL bypass. No production IDs or identities are selected by this patch.
3. Approve infrastructure provisioning separately: one fixed Worker
   `maono-ticket-notifications`, no HTTP/queue/service handlers, canonical D1 DB only,
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
| version / productSha | Version 1 and exact pinned product SHA |
| organizationId / qaIds | Approved non-QA9 org and three distinct manager/allowed/restricted IDs |
| worker | offVersion/onVersion UUIDs, reviewed codeEtag, fixed cron `* * * * *` |
| policy | Fresh UUID runId, matching organizationId/managerId, UTC startAt/endAt, approved maxEvents/maxAttempts/batchSize |
| approval | actor, confirmedAt, writersPaused, syntheticOnly, workerVersionsReviewed, costAndVolumeApproved, humanRecoveryAvailable |
| qa9 | outboxCount 13 and digest from the reviewed structural SQL inventory |
| limits | Explicit deliveryWaitSeconds (60–600), quiescenceSeconds (125–300) |

Technical bounds are ceilings, not granted volume/cost: at most 25 events, 125 total
attempts, batch size 25 and a 210-minute window. The operator retains the 190-minute
execution/210-minute job limit, 75-minute cleanup/restoration reserve and 135-minute
initial admission. No timeouts may be expanded by input. Inventory validity is ten
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
profiles, renews evidence, arms restoration, publishes the inbox flag on the same SHA,
creates one synthetic ticket and immediately privatizes it before starting the Worker.
There is brief organization visibility between create and private ACL, with fictitious
content only. Delivery, create replay, recipient read/delete/restore and ACL revocation
are checked via API and the scheduled Worker. Local tests additionally fault-inject
retries/lease loss; a normal productive run does not prove provider outage behavior.

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
The existing preflight requires an empty target organization and must reject that
nonempty state. Do not delete records, change the organization identity or silently
exclude them to make a retry pass. A future retry needs separately reviewed support
for an exact preserved-record baseline (including rejection of all other activity),
and a fresh approved plan/window. Preparing the schedule ahead of time with the
consumer OFF is a separate sequencing proposal, not implemented or authorized here.
