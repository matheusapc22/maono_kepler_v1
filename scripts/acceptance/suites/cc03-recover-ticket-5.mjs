import { fail, safeError } from '../production-acceptance-lib.mjs';
import { manifest as lifecycle, verifyPreflight } from './cc03-command-lifecycle.mjs';
import { assertCc03Context, expect, closure } from './cc03-resources.mjs';
import { readCc03State } from './cc03-state.mjs';

// Reviewed incident identity; NOT workflow inputs or a general existing-ID runner.
export const target = Object.freeze({ organizationId: 9, ticketId: 5, managerId: 5,
  sourceWorkflowRunId: '40085700282', sourceRunId: '10e3a3a8-6857-4a0f-a830-942c2ff5b95b',
  sourceReportSha256: '15402cc6155a31a0793560152910696c99f891e5221242217e901243b86df710',
  createdAt: '2026-10-24T10:30:12.860Z', baselineVersion: 4, cycleNumber: 1 });
const subject = `QA-CC03-${target.sourceRunId}`;
const root = '/api/organizations/9/tickets/5';
const recoveryClosure = () => ({ ...closure(), summary: 'Recuperação preservadora CC03 / execução 40085700282 / QA9 chamado 5.' });
export const manifest = Object.freeze({ ...lifecycle,
  id: 'cc03-recover-ticket-5', version: 1,
  description: 'Close only the preserved QA9 ticket 5 from incident 40085700282; never rerun lifecycle acceptance',
  prerequisites: [...lifecycle.prerequisites.filter(value => !value.startsWith('Initial synthetic')),
    'Separate explicit recovery authorization and NEW window; the original expired window is invalid',
    'Read-only exact-ID audit confirms unchanged incident provenance, version 4, cycle 1, private manager-only ACL',
    'No fixture creation, ACL expansion, SQL mutation, waits, reopening, event correction or destructive cleanup'],
  cleanup: { policy: 'preserve-private-incident-v1', resources: 'Only existing QA9 ticket 5, fixed source UUID, creator and creation time',
    method: 'Verify existing manager-only ACL; close once via /transitions with fresh strong state ETag; verify closure and denied reads',
    retention: 'Preserve existing cycle, events, outbox and ACL; append only the normal closure command/event/outbox',
    interruption: 'Never repeat an uncertain POST; check state. Flag restoration is independent; final D1 preservation audit remains required' },
  cases: ['CC03-RECOVERY-SCOPE', 'CC03-RECOVERY-CLOSURE', 'CC03-RECOVERY-ACL'],
});
export { verifyPreflight };
const check = (value, code) => { if (!value) fail(code, 'Recuperação QA9/5 bloqueada: evidência fora do contrato revisado.'); };
async function access(ctx) {
  const acl = expect(await ctx.api('manager', `${root}/access`), 200, 'verificar ACL existente').body?.access;
  check(acl?.visibility === 'private' && acl.policies?.length === 0 && acl.acl?.length === 1 &&
    acl.acl[0].principalType === 'user' && Number(acl.acl[0].principalId) === 5 &&
    acl.acl[0].action === 'ticket.manage' && acl.acl[0].effect === 'allow', 'CC03_RECOVERY_ACL_DRIFT');
}
function owned(state) {
  check(state.id === 5 && state.organizationId === 9 && state.subject === subject && state.createdById === 5 &&
    state.createdAt === target.createdAt && state.active === 1 && state.tombstonedAt === null &&
    state.cycle?.number === 1 && state.wait === null, 'CC03_RECOVERY_SCOPE_DRIFT');
}
function closed(state) {
  owned(state);
  return state.status === 'closed' && state.version === target.baselineVersion + 1 &&
    state.closedAt && state.closedAt === state.closure?.closedAt && state.closure.closedBy === 5 &&
    Object.entries(recoveryClosure()).every(([key, value]) => state.closure[key] === value);
}
function admissible(state) {
  owned(state);
  check((state.status === 'new' && state.version === target.baselineVersion && state.closedAt === null && state.closure === null) ||
    closed(state), 'CC03_RECOVERY_STATE_DRIFT');
}

export async function prepare(ctx) {
  assertCc03Context(ctx);
  // GET /access has no legacy-import path. Do not call detail/list with COMMANDS off.
  await access(ctx);
}

export async function run(ctx) {
  assertCc03Context(ctx);
  let admitted = false;
  const item = { kind: 'ticket', id: '5', state: 'existing_verification_pending' };
  const journal = { version: 1, policy: manifest.cleanup.policy, runId: ctx.runId, organizationId: 9,
    sourceWorkflowRunId: target.sourceWorkflowRunId, sourceRunId: target.sourceRunId,
    sourceReportSha256: target.sourceReportSha256, cleanupVerified: false, unknownCreation: false, resources: [item] };
  const publish = () => ctx.publishResourceJournal(journal);
  ctx.registerCleanup(async () => {
    try {
      check(admitted, 'CC03_RECOVERY_NOT_ADMITTED');
      await access(ctx);
      const current = await readCc03State(ctx, 5);
      admissible(current.state);
      if (!closed(current.state)) {
        item.state = 'close_intent';
        await publish(); // Persist intent before the only application write.
        try {
          expect(await ctx.api('manager', `${root}/transitions`, { method: 'POST',
            json: { status: 'closed', closure: recoveryClosure() }, headers: { 'If-Match': current.etag } }), 200, 'encerrar incidente sintético');
        } catch (error) {
          // May have committed: read exactly once, never resend the transition.
          if (!closed((await readCc03State(ctx, 5)).state)) throw error;
        }
      }
      const final = await readCc03State(ctx, 5);
      check(closed(final.state), 'CC03_RECOVERY_CLOSURE_UNVERIFIED');
      await access(ctx);
      for (const name of ['allowed', 'restricted']) {
        expect(await ctx.api(name, `${root}/state`), 404, 'conferir acesso negado ao estado privado');
      }
      item.state = 'preserved_private_closed';
      item.finalVersion = final.state.version;
      journal.cleanupVerified = true;
      journal.databasePreservationAudit = 'REQUIRED_SEPARATE_READ_ONLY_VERIFICATION';
      await publish();
      ctx.record('CC03-RECOVERY-CLOSURE', 'PASS', { ticketId: 5, cycleNumber: 1, permanentDeletion: false, newFixtures: 0 });
      ctx.record('CC03-RECOVERY-ACL', 'PASS', { managerOnly: true, allowedState: 404, restrictedState: 404, aclWrites: 0 });
    } catch (error) {
      journal.cleanupVerified = false;
      journal.failureCode = safeError(error).code;
      await publish();
      ctx.record('CC03-RECOVERY-CLOSURE', 'FAIL', { verified: false, newFixtures: 0, permanentDeletion: false });
      throw error;
    }
  });
  await publish();
  // /state is side-effect-free and fails closed if commands/readiness are off.
  const current = await readCc03State(ctx, 5);
  admissible(current.state);
  await access(ctx);
  admitted = true;
  item.state = 'existing_scope_verified';
  await publish();
  ctx.record('CC03-RECOVERY-SCOPE', 'PASS', { organizationId: 9, ticketId: 5, sourceWorkflowRunId: target.sourceWorkflowRunId });
  return { recoveredTicketId: 5, newFixtures: 0, lifecycleAcceptanceExecuted: false };
}
