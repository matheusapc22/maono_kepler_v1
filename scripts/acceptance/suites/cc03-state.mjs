import { createHash } from 'node:crypto';
import { assertHttpResponse } from '../production-acceptance-lib.mjs';

// Same sorted JSON contract as ticketStateEtag(), verified independently in tests.
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const stateDigest = state => createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex');

export function validateCc03State(result, ticketId) {
  const check = (condition, field) => assertHttpResponse(result, condition,
    `Contrato canônico CC03 inválido: ${field}.`, `CC03_STATE_${field}`);
  check(result.status === 200, 'HTTP');
  check(result.body?.ok === true && result.body.state !== null && typeof result.body.state === 'object' &&
    !Array.isArray(result.body.state), 'ENVELOPE');
  const state = result.body.state;
  check(Number.isSafeInteger(state.id) && state.id === Number(ticketId), 'TICKET_ID');
  check(state.organizationId === 9, 'ORGANIZATION_ID');
  check(Number.isSafeInteger(state.version) && state.version > 0, 'VERSION');
  const etag = result.headers?.get?.('etag');
  check(typeof etag === 'string' && etag.length > 0, 'ETAG_MISSING');
  check(!etag.startsWith('W/'), 'ETAG_WEAK');
  check(/^"ticket-state-[a-f0-9]{64}"$/.exec(etag)?.[0] === etag, 'ETAG_FORMAT');
  check(etag === `"ticket-state-${stateDigest(state)}"`, 'ETAG_DIGEST');
  // Never strip W/, trim, synthesize a tag, or fall back to a detail projection.
  return { etag, state };
}

export async function readCc03State(ctx, ticketId) {
  const result = await ctx.api('manager', `/api/organizations/9/tickets/${ticketId}/state`, {
    headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-transform' },
  });
  return validateCc03State(result, ticketId);
}
