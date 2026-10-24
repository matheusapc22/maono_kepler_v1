import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTicketState, ticketStateEtag } from '../functions/_lib/ticket-commands.js';
import { safeError } from '../scripts/acceptance/production-acceptance-lib.mjs';
import { validateCc03State } from '../scripts/acceptance/suites/cc03-state.mjs';

async function response() {
  const row = { id: 5, organization_id: 9, version: 4, status: 'new', active: 1,
    subject: 'synthetic, never logged', triage_answers: '{"z":1,"a":{"c":2,"b":1}}',
    current_cycle_json: '{"number":1,"origin":"created"}', triage_source: 'human', demand_nature: 'question_request' };
  return { status: 200, responseFormat: 'json', body: { ok: true, state: canonicalTicketState(row) },
    headers: new Headers({ ETag: await ticketStateEtag(row), 'CF-Ray': '0123456789abcdef-GRU' }) };
}
test('state validator agrees with real server canonical hash, not a mocked tag', async () => {
  const result = await response();
  const observed = validateCc03State(result, 5);
  assert.equal(observed.etag, result.headers.get('etag'));
  assert.equal(observed.state, result.body.state);
});

for (const [name, code, change] of [
  ['non-200', 'HTTP', r => { r.status = 503; }],
  ['invalid JSON', 'ENVELOPE', r => { r.body = null; r.responseFormat = 'invalid-json'; }],
  ['array envelope', 'ENVELOPE', r => { r.body.state = []; }],
  ['wrong ticket', 'TICKET_ID', r => { r.body.state.id = 6; }],
  ['coerced ticket ID', 'TICKET_ID', r => { r.body.state.id = '5'; }],
  ['wrong organization', 'ORGANIZATION_ID', r => { r.body.state.organizationId = 8; }],
  ['invalid version', 'VERSION', r => { r.body.state.version = null; }],
  ['missing ETag', 'ETAG_MISSING', r => { r.headers.delete('etag'); }],
  ['weak ETag', 'ETAG_WEAK', r => { r.headers.set('etag', `W/${r.headers.get('etag')}`); }],
  ['short digest', 'ETAG_FORMAT', r => { r.headers.set('etag', '"ticket-state-ab"'); }],
  ['wildcard', 'ETAG_FORMAT', r => { r.headers.set('etag', '*'); }],
  ['multiple validators', 'ETAG_FORMAT', r => { r.headers.set('etag', `${r.headers.get('etag')}, "other"`); }],
  ['different canonical data', 'ETAG_DIGEST', r => { r.body.state.status = 'closed'; }],
]) test(`CC03 distinguishes ${name}, fails closed, and emits no body/header values`, async () => {
  const result = await response(); change(result);
  let captured;
  assert.throws(() => validateCc03State(result, 5), error => { captured = safeError(error); return error.code === `CC03_STATE_${code}`; });
  assert.equal(captured.httpStatus, result.status);
  assert.equal(captured.cfRay, '0123456789abcdef-GRU');
  assert.ok(!JSON.stringify(captured).includes('synthetic, never logged'));
  assert.ok(!JSON.stringify(captured).includes('ticket-state-'));
});
