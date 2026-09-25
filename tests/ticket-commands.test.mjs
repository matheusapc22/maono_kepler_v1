import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalTicketState, ticketStateEtag, getTicketCommandCapability,
  executeTicketCreate, executeTicketUpdate, executeTicketTransition, executeTicketReopen,
  readTicketCommandState,
} from '../functions/_lib/ticket-commands.js';
import { createTicket, updateTicket } from '../functions/_lib/ticket-center.js';
import { createTicketCommandDb, COMMAND_ACTORS } from './helpers/ticket-command-db.mjs';

const actor = COMMAND_ACTORS.owner;
const payload = () => ({ subject: 'Atendimento verificável', description: 'Contexto da solicitação', priority: 'normal', category: 'support', assignedTo: 2,
  demandNature: 'question_request', expectedResult: 'Orientação recebida', context: '', impact: 'individual', urgency: 'flexible', triageAnswers: {}, triageFormVersion: 1 });
const request = (headers = {}) => new Request('https://cc03.test/api/organizations/1/tickets', { method: 'POST', headers });
const create = (db, key = 'unit-create') => executeTicketCreate(db.env, 1, actor, payload(), request({ 'Idempotency-Key': key }));
const closePayload = (ack = true) => ({ status: 'closed', closure: { outcomeCode: 'answered', summary: 'Resultado comunicado', evidence: 'Registro verificável', communication: 'Orientação ao solicitante', pendingChangeAcknowledged: ack } });

test('canonical state hashes semantic JSON consistently and excludes display/envelope fields', async () => {
  const row = { id: 1, organization_id: 1, version: 3, demand_nature: 'question_request', triage_source: 'human', triage_answers: '{"z":"Último","a":"Primeiro"}', current_cycle_json: '{"number":1,"origin":"created"}' };
  const reordered = { ...row, triage_answers: '{"a":"Primeiro","z":"Último"}', current_cycle_json: '{"origin":"created","number":1}', creator_name: 'Nome', attachments_count: 90 };
  assert.equal(await ticketStateEtag(row), await ticketStateEtag(reordered));
  assert.match(await ticketStateEtag(row), /^"ticket-state-[a-f0-9]{64}"$/);
  assert.equal(canonicalTicketState(row).needsTriage, false);
  assert.equal(canonicalTicketState({ ...row, demand_nature: null }).needsTriage, true);
  assert.notEqual(await ticketStateEtag(row), await ticketStateEtag({ ...row, organization_id: 2 }));
  assert.notEqual(await ticketStateEtag(row), await ticketStateEtag({ ...row, version: 4 }));
});

for (const objectName of ['ticket_events_no_update', 'ticket_lifecycle_requires_command', 'idx_ticket_wait_open']) {
  test(`a partial migration missing ${objectName} cannot enable commands`, async (t) => {
    const db = await createTicketCommandDb(t);
    db.sqlite.exec(`DROP ${objectName.startsWith('idx_') ? 'INDEX' : 'TRIGGER'} ${objectName}`);
    const before = db.snapshot();
    assert.equal(await getTicketCommandCapability(db.env, 1), false);
    await assert.rejects(create(db), { status: 503, code: 'TICKET_COMMANDS_NOT_READY' });
    assert.deepEqual(db.snapshot(), before);
  });
}

test('rollback blocks core edits to adopted tickets and preserves previous closure on reenable', async (t) => {
  const db = await createTicketCommandDb(t);
  let state = await create(db);
  state = await executeTicketTransition(db.env, 1, state.ticket.id, actor, closePayload(), request({ 'If-Match': state.etag }));
  const before = db.snapshot();
  db.env.MAONO_TICKET_COMMANDS_ENABLED = 'false';
  for (const patch of [{ status: 'open' }, { subject: 'Mudança sem comando' }]) {
    await assert.rejects(updateTicket(db.env, 1, state.ticket.id, actor, patch, request()), { status: 503 });
    assert.deepEqual(db.snapshot(), before);
  }
  assert.throws(() => db.sqlite.prepare("UPDATE organization_tickets SET status='open' WHERE id=?").run(state.ticket.id), /TICKET_LIFECYCLE_COMMAND_REQUIRED/);
  db.env.MAONO_TICKET_COMMANDS_ENABLED = 'true';
  state = await executeTicketReopen(db.env, 1, state.ticket.id, actor, { reason: 'Solicitante voltou', nextAction: 'Conferir retorno' }, request({ 'If-Match': state.etag }));
  assert.equal(state.ticket.cycle.number, 2);
  const cycles = db.rows('ticket_cycles');
  assert.equal(cycles[0].closure_json, before.ticket_cycles[0].closure_json);
  assert.equal(cycles[1].closure_json, null);
});

test('a keyed direct retry after rollback cannot create a legacy duplicate', async (t) => {
  const db = await createTicketCommandDb(t);
  await create(db, 'lost-response');
  const before = db.snapshot();
  db.env.MAONO_TICKET_COMMANDS_ENABLED = 'false';
  await assert.rejects(createTicket(db.env, 1, actor, payload(), request({ 'Idempotency-Key': 'lost-response' })), { status: 503 });
  assert.deepEqual(db.snapshot(), before);
});

test('a pending CR arriving between validation and close batch requires acknowledgement with no phantom effects', async (t) => {
  const db = await createTicketCommandDb(t);
  const created = await create(db);
  db.sqlite.exec("INSERT INTO projects(id,organization_id,name,slug,dropbox_root_path,created_by) VALUES(1,1,'Projeto','projeto','/projects/projeto',1)");
  const before = db.snapshot();
  db.beforeNextBatch((sqlite) => sqlite.prepare(`INSERT INTO project_change_requests(id,organization_id,project_id,requested_by_user_id,ticket_id,base_revision,reason,idempotency_key,submission_hash)
    VALUES('concurrent-cr',1,1,1,?,0,'Proposta concorrente','concurrent-cr','hash')`).run(created.ticket.id));
  await assert.rejects(executeTicketTransition(db.env, 1, created.ticket.id, actor, closePayload(false), request({ 'If-Match': created.etag })), { status: 409, code: 'TICKET_PENDING_CHANGE_ACK_REQUIRED' });
  for (const table of ['organization_tickets', 'ticket_cycles', 'ticket_events', 'ticket_commands', 'audit_logs', 'ticket_command_outbox']) assert.deepEqual(db.rows(table), before[table]);
  const unchanged = await readTicketCommandState(db.env, 1, created.ticket.id);
  assert.equal(unchanged.etag, created.etag);
  await executeTicketTransition(db.env, 1, created.ticket.id, actor, closePayload(true), request({ 'If-Match': unchanged.etag }));
  assert.equal(db.rows('project_change_requests')[0].status, 'submitted');
});

test('invalid next action lengths/types reject before writes', async (t) => {
  const db = await createTicketCommandDb(t);
  const created = await create(db);
  const before = db.snapshot();
  for (const value of ['', 'x'.repeat(1001), {}, 12]) {
    await assert.rejects(executeTicketUpdate(db.env, 1, created.ticket.id, actor, { nextAction: value }, request({ 'If-Match': created.etag })), { status: 400 });
    assert.deepEqual(db.snapshot(), before);
  }
});
