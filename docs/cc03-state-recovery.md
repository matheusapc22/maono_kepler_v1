# CC03: state contract and exact incident recovery

## Evidence and limits

Run `40085700282` failed with `CC03_STATE_INVALID` after creating the synthetic
QA9 ticket 5 and making it private. The old validator combined ETag format,
`state.id`, and `state.organizationId` in one condition. Its sanitized artifact
contains neither the observed header nor the response body. Therefore it does
**not** establish which field differed. The existing artifact remains immutable.

The production source at `2b06285958954bc9a65379d8ce3fdb9c1b258988` returns
`{ok:true,state}` and the strong header `"ticket-state-<SHA256, 64 lowercase hex>"`.
The hash covers recursively sorted canonical state JSON. The production middleware
returns this response unchanged. `If-Match` requires that exact strong validator.
Local tests use the real handlers, middleware and SQLite, not fabricated state tags.

A transforming proxy can weaken/remove an ETag. Cloudflare documents this behavior
and `no-transform` protection. This is a plausible transport explanation, **not a
proven diagnosis of the failed production response**:

- https://developers.cloudflare.com/cache/reference/etag-headers/
- https://developers.cloudflare.com/cache/concepts/cache-control/

The patch preserves strong tags using `private, no-store, no-transform` on state,
draft and message responses carrying ETags. CC03 state requests ask for identity
encoding. The validator now distinguishes HTTP/envelope/ticket/organization/version,
missing/weak/malformed tags and digest mismatch. It verifies the 64-character digest
against the returned canonical state and never strips `W/`, synthesizes a validator,
or falls back to a detail projection. Diagnostics contain bounded codes and existing
sanitized HTTP evidence, not response content, arbitrary headers, credentials or
sessions. A downstream transform that ignores these directives still fails closed.

## Recovery contract

`cc03-recover-ticket-5` is a separate registered suite, not a rerun of CC03 acceptance.
It fixes organization 9, ticket 5, creator 5, the source run UUID, creation time,
baseline version 4, and cycle 1 in reviewed code. These are not workflow inputs.
Source report SHA256:
`15402cc6155a31a0793560152910696c99f891e5221242217e901243b86df710`.

The suite requires the normal protected Environment, approved IDs 5/11/7, a NEW
explicit global window, fresh complete aggregate evidence (at most 10 minutes old
before logins and flag activation), and unchanged baseline flags. Prepare reads
only `/access`; it avoids the ticket detail/list GETs that can import legacy rows
with commands disabled. After activation, `/state` verifies ownership, version and
cycle before any application write. Any material drift stops recovery.

The application write allowlist is one POST to
`/api/organizations/9/tickets/5/transitions`, closing with a freshly verified strong
ETag. There is no creation, DELETE, PATCH, ACL PUT, wait, reopen, correction, or SQL
mutation. The existing private manager-only ACL must already match, and is preserved.
The close uses the domain command, retaining the cycle and appending its normal
command/event/audit/outbox. It does not remove or drain the existing outbox.

If the close response is lost, the runner reads the state and does not resend the
POST. Already closed state is accepted only at version 5 with this exact recovery
closure and provenance. Success verifies private manager-only ACL and denied
`/state` reads for 11/7. A successful suite report proves this API contract; a separate
exact-ID read-only D1 audit must confirm retained cycle/event/outbox records. It is
not full lifecycle acceptance and does not close A-02 or authorize permanent rollout.

The original 24 October window is expired for admission and MUST NOT be reused.
Budgets are unchanged: operator 190 minutes, protected job 210, closure reserve 75,
activation admission requiring 135 minutes remaining. No timeout or gate is relaxed.

## Publication and execution order (not performed by this patch)

1. Review product patch against `mano_kepler_v1` and the one-line dispatcher guard
   against `main`. Obtain publication/merge/deploy authorization where required;
   satisfy CI, human review and branch protection. Never bypass gates.
2. Confirm served product SHA and main dispatcher, health, D1 identity, no concurrent
   run/deployment, and COMMANDS=false / TRIAGE=true / SELECTIVE_ACCESS=true.
3. Run only the new suite's protected preflight after authorization; human approves
   its Environment. Preflight uses no QA login and creates no fixtures.
4. Agree a future window of sufficient length and reconfirm global writer pause and
   a human restoration contact. Renew all-organization aggregate schema/inventory
   and exact-ID incident audit. Reject any unrelated pending writer activity. The
   incident's existing outbox entry is retained; do not mistake it for a newly
   authorized queue drain or silently discard it.
5. With explicit recovery authorization, dispatch once from main with mode `run`,
   suite `cc03-recover-ticket-5`, organization `9`, QA IDs `5,11,7`, the exact published
   SHA, confirmation `RUN_PRODUCTION_ACCEPTANCE`, and fresh reviewed window JSON.
   Stop for human Environment approval. Do not use a stale window or rerun attempt.
6. Observe closure and flag restoration, terminal Pages publication, same code SHA,
   health, both configured/effective flags and zero pending deployments. Independently
   audit ticket 5: private/closed/version 5/cycle 1 closed; original 3 events retained
   plus one closure, original command/outbox retained plus one close command/outbox,
   no open wait, manager-only ACL unchanged. Compare exact pre/post rows in the
   authorized local evidence store; do not publish personal or secret content.
7. If any outcome is uncertain, inspect it before another action. Do not create a new
   fixture, repeat the transition, cancel restoration blindly, or claim completion.

## Authorization text to complete with a future window

“Autoriza uma única recuperação do chamado sintético 5 da QA9, na nova janela
[data, início e fim em Brasília e UTC], com pausa de uso da Central em todas as
organizações ativas? O fluxo protegido usará as contas QA 5/11/7 e as credenciais
já salvas, sem exibi-las; ativará COMMANDS temporariamente de forma global e
republicará o mesmo código. Fechará apenas esse chamado, mantendo-o privado com
ACL somente do gestor 5, sem nova fixture nem exclusão. Preservará o ciclo, os
eventos e o outbox existentes e acrescentará os registros normais do fechamento.
Ao terminar, restaurará COMMANDS=false e republicará o mesmo SHA, mantendo
TRIAGE=true e SELECTIVE_ACCESS=true. Você estará disponível para aprovar o
Environment e ajudar numa recuperação se houver interrupção? Não há garantia de
recuperação automática. Essa autorização não inclui nova execução de acceptance,
ativação permanente, alteração de contas ou migrations.”

Publication and this recovery window are separate decisions. No production action,
secret access or dispatch is part of the local patch/tests.
