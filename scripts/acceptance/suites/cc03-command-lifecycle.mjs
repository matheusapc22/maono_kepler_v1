import { fail } from '../production-acceptance-lib.mjs';
import { assertCc03Context, commandResources, expect, closure, QA_IDS } from './cc03-resources.mjs';

export const manifest = Object.freeze({
  id: 'cc03-command-lifecycle', version: 1,
  description: 'CC03 API command lifecycle on one preserved synthetic QA9 ticket',
  mutationMode: 'controlled_mutation', requiresBrowser: false, requiresApprovedIdentities: true,
  requiresGlobalWindow: true,
  requiredOrganization: { id: 9, slug: 'maono-preview-qa' },
  requiredProfiles: ['manager', 'allowed', 'restricted'],
  requiredPermissions: { manager: ['ticket.view', 'ticket.create', 'ticket.manage', 'ticket.access.manage'],
    allowed: ['ticket.view'], restricted: ['ticket.view'] },
  managedFlags: {
    MAONO_TICKET_COMMANDS_ENABLED: { requiredBefore: false, activeValue: true, safeValue: false },
    MAONO_TICKET_TRIAGE_ENABLED: { requiredBefore: true, activeValue: true, safeValue: true },
    MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: { requiredBefore: true, activeValue: true, safeValue: true },
  },
  prerequisites: ['Global COMMANDS window explicitly approved; writers paused across all active organizations',
    'Fresh complete aggregate SQL evidence; no pending legacy rows, invalid markers or unclassified adopted tickets',
    'QA9: manager=5, allowed=11, restricted=7; no administrative bypass',
    'Initial synthetic ticket visibility is organization-wide until the immediately following ACL request',
    'API only: no UI, CR, attachments, notifications, SLA or permanent rollout acceptance'],
  cleanup: { policy: 'preserve-private-command-v1', resources: 'At most one new UUID ticket; no existing IDs accepted',
    method: 'Verify ownership; private manager-only ACL; fresh /state ETag; close via /transitions before restoring COMMANDS=false',
    retention: 'Preserve ticket, cycles, waits, original/correction events, audit and outbox; no deletion or retention invented',
    interruption: 'Journal create intent and observed ID; uncertain creation prevents retry or inferred cleanup completion' },
  cases: ['CC03-IDEMPOTENCY', 'CC03-CAS', 'CC03-ACL', 'CC03-LIFECYCLE', 'CC03-CORRECTION', 'CC03-CLEANUP'],
});

export function verifyPreflight(project, options = { organizationId: 9 }) {
  if (options.organizationId !== 9 || options.projectSlug) fail('CC03_QA_SCOPE_MISMATCH', 'CC03 aceita somente QA9 sem projeto.');
  for (const vars of [project.raw?.deployment_configs?.production?.env_vars, project.raw?.canonical_deployment?.env_vars]) {
    for (const [name, config] of Object.entries(manifest.managedFlags)) {
      if (vars?.[name]?.type !== 'plain_text' || String(vars[name].value).trim().toLowerCase() !== String(config.requiredBefore)) {
        fail('CC03_BASELINE_MISMATCH', 'CC03 exige TRIAGE/SELECTIVE_ACCESS=true e COMMANDS=false nos dois snapshots.');
      }
    }
  }
}
export async function prepare(ctx) { assertCc03Context(ctx); }
const check = (condition, label) => { if (!condition) fail('ACCEPTANCE_ASSERTION_FAILED', label); };

export async function run(ctx) {
  const resources = commandResources(ctx);
  const path = '/api/organizations/9/tickets';
  const payload = { subject: resources.subject, description: 'Conteúdo fictício do teste CC03.', category: 'support', priority: 'normal',
    assignedTo: QA_IDS.manager, demandNature: 'question_request', expectedResult: 'Verificar comandos com dados sintéticos.',
    context: 'Janela aprovada do operador.', impact: 'individual', urgency: 'flexible', priorityReason: '', triageAnswers: {}, triageFormVersion: 1 };
  const create = { method: 'POST', json: payload, headers: { 'Idempotency-Key': `cc03-${ctx.runId}` } };
  await resources.begin();
  const first = expect(await ctx.api('manager', path, create), 201, 'criar chamado CC03');
  await resources.observe(first.body?.ticket);
  // Minimize initial organization visibility: no upload or test before privatization.
  await resources.access(true);
  const beforeReplay = await resources.state();
  const replay = expect(await ctx.api('manager', path, create), 201, 'replay idempotente');
  check(replay.headers.get('Idempotency-Replayed') === 'true' && replay.body?.ticket?.id === first.body.ticket.id, 'Replay não comprovado.');
  expect(await ctx.api('manager', path, { ...create, json: { ...payload, description: 'Colisão sintética de intenção.' } }), 409, 'colisão de idempotência');
  check((await resources.state()).etag === beforeReplay.etag, 'Replay/colisão alterou o chamado.');
  ctx.record('CC03-IDEMPOTENCY', 'PASS', { replay: 201, collision: 409, sameTicket: true });

  const beforeCas = await resources.state();
  expect(await ctx.api('manager', resources.path(), { method: 'PATCH', json: { nextAction: 'Sem validador' } }), 428, 'If-Match obrigatório');
  check((await resources.state()).etag === beforeCas.etag, 'Comando sem If-Match alterou estado.');
  await resources.command('', { nextAction: 'Próxima ação sintética.' }, 'PATCH');
  const afterCas = await resources.state();
  check(afterCas.etag !== beforeCas.etag && afterCas.state.version === beforeCas.state.version + 1, 'Versão CAS não avançou uma vez.');
  expect(await ctx.api('manager', resources.path('/transitions'), { method: 'POST', json: { status: 'open', nextAction: 'Obsoleto' },
    headers: { 'If-Match': beforeCas.etag } }), 412, 'validador obsoleto');
  check((await resources.state()).etag === afterCas.etag, 'CAS rejeitado alterou estado.');
  ctx.record('CC03-CAS', 'PASS', { missing: 428, stale: 412, accepted: 200 });

  expect(await ctx.api('allowed', resources.path('/state')), 200, 'leitura permitida de /state');
  expect(await ctx.api('restricted', resources.path('/state')), 404, 'ACL privada de /state');
  expect(await ctx.api('restricted', resources.path('/transitions'), { method: 'POST', json: { status: 'closed', closure: closure() },
    headers: { 'If-Match': afterCas.etag } }), 403, 'viewer sem comandos');
  check((await resources.state()).etag === afterCas.etag, 'Comando negado alterou estado.');
  ctx.record('CC03-ACL', 'PASS', { allowedState: 200, restrictedState: 404, viewerCommand: 403 });

  for (const status of ['open', 'in_progress']) {
    await resources.command('/transitions', { status, nextAction: 'Continuar teste sintético.' });
    check((await resources.state()).state.status === status, 'Transição não persistiu.');
  }
  await resources.command('/waits', { action: 'start', reason: 'Espera fictícia.', responsibleId: QA_IDS.manager, nextAction: 'Retomar teste.' });
  check(Boolean((await resources.state()).state.wait), 'Espera não persistiu.');
  await resources.command('/waits', { action: 'end', reason: 'Insumo fictício recebido.', nextAction: 'Conferir teste.' });
  check((await resources.state()).state.wait === null, 'Espera não terminou.');
  await resources.command('/transitions', { status: 'in_review', nextAction: 'Conferir resultado.', evidence: 'Evidência sintética.' });
  check((await resources.state()).state.status === 'in_review', 'Revisão não persistiu.');
  await resources.command('/transitions', { status: 'closed', closure: closure() });
  const closed = await resources.state();
  check(closed.state.status === 'closed' && Boolean(closed.state.closure), 'Conclusão não persistiu.');
  await resources.command('/reopen', { reason: 'Reabertura sintética autorizada.', nextAction: 'Conferir segundo ciclo.' });
  const reopened = await resources.state();
  check(reopened.state.status === 'open' && reopened.state.cycle?.number === closed.state.cycle?.number + 1, 'Novo ciclo não comprovado.');
  check((await resources.read()).closureHistory?.some(row => row.cycleNumber === closed.state.cycle.number), 'Histórico de conclusão não preservado.');
  ctx.record('CC03-LIFECYCLE', 'PASS', { triage: true, progress: true, wait: true, review: true, closed: true, reopened: true });

  const beforeCorrection = await resources.read();
  const original = beforeCorrection.events?.find(event => event.type === 'ticket.created');
  check(Number.isSafeInteger(original?.id) && original.id > 0, 'Evento original não encontrado.');
  await resources.command(`/events/${original.id}/corrections`, { reason: 'Correção fictícia.', correction: 'Complemento sintético sem apagar o evento.' });
  const afterCorrection = await resources.read();
  check(JSON.stringify(afterCorrection.events.find(event => event.id === original.id)) === JSON.stringify(original), 'Evento original alterado.');
  check(afterCorrection.events.some(event => event.type === 'ticket.event.corrected' && Number(event.metadata?.eventId) === original.id), 'Correção não vinculada ao original.');
  await resources.command('/transitions', { status: 'closed', closure: closure() });
  check((await resources.read()).closureHistory?.length === 2, 'Duas conclusões não preservadas.');
  ctx.record('CC03-CORRECTION', 'PASS', { originalPreserved: true, correctionLinked: true, closedCycles: 2 });
  return { syntheticTicketId: first.body.ticket.id, userIds: QA_IDS, coverage: 'API_ONLY', permanentDeletion: false };
}
