import { assertHttpResponse, fail } from '../production-acceptance-lib.mjs';
import { assertQaContext } from './cc04-resources.mjs';

export const QA_IDS = Object.freeze({ manager: 5, allowed: 11, restricted: 7 });
export function assertCc03Context(ctx) {
  assertQaContext(ctx);
  if (ctx.organizationId !== 9 || Object.entries(QA_IDS).some(([name, id]) => Number(ctx.profiles[name].user.id) !== id)) {
    fail('CC03_QA_SCOPE_MISMATCH', 'CC03 exige QA9 e os IDs dedicados 5/11/7.');
  }
  const restricted = ctx.profiles.restricted.user;
  if (restricted.role !== 'viewer' || ['ticket.manage', 'ticket.create'].some(permission =>
    restricted.permissions?.includes(permission) && !restricted.deniedPermissions?.includes(permission))) {
    fail('QA_NEGATIVE_PROFILE_PRIVILEGED', 'O perfil restrito deve continuar viewer sem comandos.');
  }
}
export function expect(response, status, label) {
  assertHttpResponse(response, response.status === status, `${label}: HTTP inesperado (${response.status}).`);
  return response;
}
export const closure = () => ({ outcomeCode: 'answered', summary: 'Encerramento do teste sintético CC03.',
  evidence: 'Diário e relatório do operador protegido.', communication: 'Resultado registrado no relatório do teste.',
  pendingChangeAcknowledged: false });

// Exactly one new ticket. Never discover/adopt an existing ID, DELETE, or retry
// an uncertain creation. Preserve cycles, waits, events, audit and outbox.
export function commandResources(ctx) {
  assertCc03Context(ctx);
  const subject = `QA-CC03-${ctx.runId}`;
  const journal = { version: 1, policy: 'preserve-private-command-v1', runId: ctx.runId,
    organizationId: 9, cleanupVerified: false, unknownCreation: false, resources: [] };
  let item = null;
  const publish = () => ctx.publishResourceJournal({ ...journal, resources: item ? [{ ...item }] : [] });
  const path = suffix => `/api/organizations/9/tickets/${item.id}${suffix || ''}`;
  const own = ticket => {
    if (!item?.id || !ticket || String(ticket.id) !== item.id || ticket.organizationId !== 9 ||
      ticket.subject !== subject || Number(ticket.createdBy?.id) !== QA_IDS.manager) {
      fail('SYNTHETIC_RESOURCE_SCOPE_MISMATCH', 'Recurso não corresponde ao chamado desta execução.');
    }
  };
  const read = async () => {
    const result = expect(await ctx.api('manager', path()), 200, 'conferir chamado sintético');
    own(result.body?.ticket);
    return result.body;
  };
  const state = async () => {
    const result = expect(await ctx.api('manager', path('/state')), 200, 'ler estado canônico');
    const etag = result.headers?.get('etag');
    if (!/^"ticket-state-[a-f0-9]+"$/.test(etag || '') || Number(result.body?.state?.id) !== Number(item.id) ||
      Number(result.body?.state?.organizationId) !== 9) fail('CC03_STATE_INVALID', 'Estado/ETag canônico inválido.');
    return { etag, state: result.body.state };
  };
  const managerAcl = { principalType: 'user', principalId: QA_IDS.manager, action: 'ticket.manage', effect: 'allow' };
  const access = async (includeAllowed = false) => {
    await read(); // Ownership before every ACL write, including cleanup.
    expect(await ctx.api('manager', path('/access'), { method: 'PUT', json: { visibility: 'private', policyIds: [],
      acl: [managerAcl, ...(includeAllowed ? [{ principalType: 'user', principalId: QA_IDS.allowed, action: 'ticket.view', effect: 'allow' }] : [])] } }), 200, 'privatizar chamado sintético');
  };
  const command = async (suffix, json, method = 'POST') => {
    await read();
    const current = await state(); // ACL writes also change version: never reuse an earlier ETag.
    return expect(await ctx.api('manager', path(suffix), { method, json, headers: { 'If-Match': current.etag } }), 200, 'comando sintético');
  };
  ctx.registerCleanup(async () => {
    try {
      if (journal.unknownCreation) fail('SYNTHETIC_RESOURCE_OUTCOME_UNCERTAIN', 'Criação incerta: conferir inventário antes de qualquer repetição.');
      if (item) {
        await access(false);
        const current = await state();
        if (current.state.status !== 'closed') {
          // A lost response is checked once; never blindly repeat this command.
          try { expect(await ctx.api('manager', path('/transitions'), { method: 'POST',
            json: { status: 'closed', closure: closure() }, headers: { 'If-Match': current.etag } }), 200, 'encerrar chamado sintético'); }
          catch (error) { if ((await state()).state.status !== 'closed') throw error; }
        }
        const final = await read();
        const canonical = await state();
        const acl = expect(await ctx.api('manager', path('/access')), 200, 'conferir ACL final').body?.access;
        if (final.ticket.status !== 'closed' || final.ticket.visibility !== 'private' || canonical.state.status !== 'closed' ||
          canonical.state.wait != null || !canonical.state.closure || acl?.visibility !== 'private' || acl.policies?.length !== 0 ||
          acl.acl?.length !== 1 || acl.acl[0].principalType !== 'user' || Number(acl.acl[0].principalId) !== QA_IDS.manager ||
          acl.acl[0].action !== 'ticket.manage' || acl.acl[0].effect !== 'allow') fail('RESOURCE_CLEANUP_UNVERIFIED', 'Contenção final não comprovada.');
        for (const name of ['allowed', 'restricted']) for (const suffix of ['', '/state']) {
          expect(await ctx.api(name, path(suffix)), 404, 'conferir revogação final');
        }
        item.state = 'preserved_private_closed';
        item.finalVersion = canonical.state.version;
      }
      journal.cleanupVerified = true;
      await publish();
      ctx.record('CC03-CLEANUP', 'PASS', { verified: true, permanentDeletion: false, retainedTickets: item ? 1 : 0 });
    } catch (error) {
      journal.cleanupVerified = false;
      journal.failureCode = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'RESOURCE_CLEANUP_UNVERIFIED';
      await publish();
      ctx.record('CC03-CLEANUP', 'FAIL', { verified: false, permanentDeletion: false });
      throw error;
    }
  });
  return { subject, path, read, state, access, command,
    async begin() {
      if (item) fail('SYNTHETIC_RESOURCE_COLLISION', 'Uma única criação permitida por execução.');
      item = { kind: 'ticket', id: null, name: subject, state: 'intent' };
      journal.unknownCreation = true;
      await publish();
    },
    async observe(ticket) {
      if (!item || item.state !== 'intent' || !Number.isSafeInteger(Number(ticket?.id)) || Number(ticket.id) <= 0) {
        fail('SYNTHETIC_RESOURCE_SCOPE_MISMATCH', 'Resposta da criação não verificável.');
      }
      // Validate before retaining an ID for any later cleanup write.
      if (ticket.organizationId !== 9 || ticket.subject !== subject || Number(ticket.createdBy?.id) !== QA_IDS.manager) {
        fail('SYNTHETIC_RESOURCE_SCOPE_MISMATCH', 'Resposta fora do escopo sintético.');
      }
      item.id = String(ticket.id); item.state = 'observed'; journal.unknownCreation = false;
      await publish();
    },
  };
}
