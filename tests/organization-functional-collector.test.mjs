import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { validateOrganizationEvidence, verifyOrganizationEvidence } from '../scripts/acceptance/organization-functional-evidence.mjs';

const source = await readFile(new URL('../scripts/acceptance/organization-functional-evidence.js', import.meta.url), 'utf8');
const runId = '11111111-1111-4111-8111-111111111111';
const deployment = '33333333-3333-4333-8333-333333333333';
const operation = '22222222-2222-4222-8222-222222222222';
function options(mode = 'diagnostic') {
  return { runId, organizationId: 11, expectedCommit: 'a'.repeat(40), expectedDeploymentId: deployment, mode, requestedCases: ['snapshot'] };
}
function harness({ origin = 'https://maono-kepler-v1.pages.dev', handler = null, synthetic = true } = {}) {
  let clock = Date.parse('2026-11-25T12:00:00.000Z'), nextTimer = 0;
  const events = [], timers = new Map();
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const auditEntry = { id: 'frame:8', createdAt: '2026-11-25T11:59:50.000Z', actor: { id: 7, name: 'PRIVATE_PERSON_SENTINEL' }, organization: { id: 11, name: 'PRIVATE_NAME_SENTINEL' },
    action: 'organization.update', result: 'failed', legacy: false, summary: 'PRIVATE_MESSAGE_SENTINEL' };
  function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
  const normal = path => {
    if (path === '/api/session') return json({ authenticated: true, user: { id: 7, role: 'super_admin', email: 'PRIVATE_EMAIL_SENTINEL', name: 'PRIVATE_PERSON_SENTINEL' } });
    if (path === '/api/admin/organization-management/organizations/11') return json({ ok: true, organization: { id: 11, name: synthetic ? `QA Auditoria ${runId}` : 'PRIVATE_NAME_SENTINEL',
      slug: 'private-slug-sentinel', description: 'PRIVATE_DRAFT_SENTINEL', version: 3, active: false, storageStatus: 'DISABLED', projectCount: 0, fileCount: 0, userCount: 1,
      owner: { id: 9, email: 'PRIVATE_EMAIL_SENTINEL' }, dropboxPath: '/PRIVATE_PROVIDER_SENTINEL' } });
    if (path.endsWith('/deletion-preview')) return json({ ok: true, organizationId: 11, eligible: false, version: 3, blockers: [{ code: 'UNRESOLVED_OPERATION', count: 1,
      description: 'PRIVATE_MESSAGE_SENTINEL', action: { kind: 'query', enabled: true, operationId: operation, organizationId: 11, reason: 'PRIVATE_REASON_SENTINEL' } }], waitUntil: null });
    if (path === '/api/admin/audit') return json({ ok: true, capabilities: { operations: true }, entries: [auditEntry], nextBefore: null });
    if (path === '/api/admin/audit/frame%3A8') return json({ ok: true, capabilities: { operations: true }, entry: auditEntry,
      technical: { operationId: operation, source: 'organization_operation', originalActor: { id: 7, name: 'PRIVATE_PERSON_SENTINEL' }, version: 3, secret: 'PRIVATE_TOKEN_SENTINEL' } });
    throw new Error(`Unexpected fixture route: ${path}`);
  };
  const location = new URL(`${origin}/admin?section=organizations&org_id=11`);
  const sandbox = {
    location, URL, TextEncoder, TextDecoder, AbortController, Uint8Array, Date: Clock,
    crypto: webcrypto, structuredClone, document: { querySelectorAll: () => [], visibilityState: 'visible' },
    fetch: async (url, request) => {
      clock += 5;
      events.push({ url: String(url), request });
      return handler ? handler(new URL(url), request, normal, events.length) : normal(new URL(url).pathname);
    },
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  vm.createContext(sandbox); vm.runInContext(source, sandbox, { filename: 'organization-functional-evidence.js' });
  return { api: sandbox.MaonoOrganizationEvidence, events, sandbox, now: () => clock, timers, json };
}

test('GET-only collector projects existing-session responses and round-trips without private text', async () => {
  const h = harness(); await h.api.start(options());
  const evidence = await h.api.export();
  const parsed = validateOrganizationEvidence(evidence, { now: h.now() });
  assert.equal(parsed.captures[0].audit.details[0].operationId, operation);
  assert.equal(parsed.captures[0].preview.blockers[0].action.kind, 'query');
  assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE_|email|password|Cookie|Authorization|dropboxPath/);
  assert.equal(h.events.length, 5);
  for (const { url, request } of h.events) {
    assert.equal(new URL(url).origin, 'https://maono-kepler-v1.pages.dev');
    assert.equal(request.method, 'GET'); assert.equal(request.mode, 'same-origin'); assert.equal(request.credentials, 'same-origin');
    assert.equal(request.redirect, 'error'); assert.equal(request.cache, 'no-store'); assert.ok(request.signal);
    assert.equal(Object.hasOwn(request, 'body'), false); assert.equal(Object.hasOwn(request.headers, 'Cookie'), false);
  }
  const certificate = verifyOrganizationEvidence(evidence, { now: h.now() });
  assert.equal(certificate.observationsComplete, true); assert.equal(certificate.environment.matched, false);
  assert.equal(certificate.complete, false); assert.equal(certificate.migrationVerified, false);
});

test('public collector methods cannot accept a URL, HTTP method or payload override', async () => {
  const h = harness();
  await assert.rejects(h.api.start({ ...options(), url: '/api/admin/users' }), /ORG_COLLECTOR_OPTIONS_INVALID/);
  assert.equal(h.events.length, 0);
  await h.api.start(options());
  await assert.rejects(h.api.capture('/api/admin/users'), /ORG_ARGUMENTS_INVALID/);
  await assert.rejects(h.api.begin('POST'), /ORG_RECORDING_CASE_INVALID/);
  assert.equal(h.events.length, 5);
  assert.equal(Object.isFrozen(h.api), true);
});

test('unknown source labels are minimized; unknown action does not become an organization action', async () => {
  const h = harness({ handler: async (url, _request, normal) => {
    const response = normal(url.pathname);
    if (!url.pathname.includes('frame%3A')) return response;
    const body = await response.json(); body.technical.source = 'private_source_sentinel';
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  } });
  await h.api.start(options()); const evidence = await h.api.export();
  assert.equal(evidence.captures[0].audit.details[0].source, 'other');
  assert.doesNotMatch(JSON.stringify(evidence), /private_source_sentinel/);
});

for (const status of [401, 403]) test(`access denial ${status} invalidates previous context and prevents export`, async () => {
  let deny = false;
  const h = harness({ handler: (url, _request, normal) => deny ? new Response('PRIVATE_ERROR_SENTINEL', { status }) : normal(url.pathname) });
  await h.api.start(options()); deny = true;
  await assert.rejects(h.api.capture(), /ORG_SESSION_CHANGED/);
  await assert.rejects(h.api.export(), /ORG_COLLECTOR_INVALIDATED/);
});

test('actor change is rejected before subsequent organization reads and invalidates export', async () => {
  let swapped = false;
  const h = harness({ handler: (url, _request, normal) => swapped && url.pathname === '/api/session'
    ? new Response(JSON.stringify({ authenticated: true, user: { id: 8, role: 'super_admin' } }), { headers: { 'Content-Type': 'application/json' } }) : normal(url.pathname) });
  await h.api.start(options()); swapped = true; const count = h.events.length;
  await assert.rejects(h.api.capture(), /ORG_SESSION_CHANGED/);
  assert.equal(h.events.length, count + 1);
  await assert.rejects(h.api.export(), /ORG_COLLECTOR_INVALIDATED/);
});

test('foreign origin and diagnostic mutation cases are rejected without any request', async () => {
  const foreign = harness({ origin: 'https://unrelated.example' });
  await assert.rejects(foreign.api.start(options()), /ORG_COLLECTOR_START_FORBIDDEN/); assert.equal(foreign.events.length, 0);
  const local = harness();
  await assert.rejects(local.api.start({ ...options(), requestedCases: ['save_success'] }), /ORG_DIAGNOSTIC_MUTATION_CASE/); assert.equal(local.events.length, 0);
});

test('functional observation requires exact run marker, not an arbitrary existing organization', async () => {
  const h = harness({ synthetic: false });
  await assert.rejects(h.api.start(options('functional')), /ORG_SYNTHETIC_SCOPE_UNCONFIRMED/);
  assert.equal(h.events.length, 2);
});

test('oversized streaming response is canceled, never exported or passed to the JSON parser', async () => {
  let canceled = false;
  const h = harness({ handler: () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(256 * 1024 + 1)); }, cancel() { canceled = true; },
  }), { headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(h.api.start(options()), /ORG_RESPONSE_TOO_LARGE/); assert.equal(canceled, true);
  await assert.rejects(h.api.export(), /ORG_COLLECTOR_INVALIDATED/);
});

test('hung GET is bounded by its abort timer and retains no exportable context', async () => {
  const h = harness({ handler: (_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })) });
  const pending = h.api.start(options());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.timers.size, 1);
  const timer = [...h.timers.values()][0]; assert.equal(timer.ms, 10_000); timer.fn();
  await assert.rejects(pending, /ORG_REQUEST_TIMEOUT/);
  await assert.rejects(h.api.export(), /ORG_COLLECTOR_INVALIDATED/);
});

test('malformed JSON and redirects produce controlled errors without remote text', async () => {
  const bad = harness({ handler: () => new Response('PRIVATE_ERROR_SENTINEL{', { headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(bad.api.start(options()), /ORG_RESPONSE_INVALID_JSON/);
  await assert.rejects(bad.api.export(), /ORG_COLLECTOR_INVALIDATED/);
  const redirect = harness({ handler: () => ({ redirected: true, url: 'https://other.example/private' }) });
  await assert.rejects(redirect.api.start(options()), /ORG_REDIRECT_FORBIDDEN/);
});

test('identifiers require exact strings without coercion or a trailing newline', async () => {
  for (const key of ['runId', 'expectedCommit', 'expectedDeploymentId']) {
    for (const change of [value => [value], value => `${value}\n`]) {
      const h = harness(), input = options(); input[key] = change(input[key]);
      await assert.rejects(h.api.start(input), /ORG_COLLECTOR_OPTIONS_INVALID/);
      assert.equal(h.events.length, 0);
    }
  }
});

test('response identifiers and provenance reject array coercion and trailing newlines', async () => {
  for (const field of ['id', 'operationId', 'source', 'blockerCode']) {
    for (const change of [value => [value], value => `${value}\n`]) {
      const h = harness({ handler: async (url, _request, normal) => {
        const response = normal(url.pathname), body = await response.json();
        if (field === 'id' && url.pathname === '/api/admin/audit') body.entries[0].id = change(body.entries[0].id);
        if (['operationId', 'source'].includes(field) && url.pathname.includes('frame%3A')) body.technical[field] = change(body.technical[field]);
        if (field === 'blockerCode' && url.pathname.endsWith('/deletion-preview')) body.blockers[0].code = change(body.blockers[0].code);
        return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
      } });
      await assert.rejects(h.api.start(options()), /^Error: ORG_(?:AUDIT_SCOPE_INVALID|AUDIT_DETAIL_INVALID|PREVIEW_INVALID)$/);
      await assert.rejects(h.api.export(), /ORG_COLLECTOR_INVALIDATED/);
    }
  }
});

test('a transport error cannot impersonate the internal safe-code catalogue', async () => {
  const h = harness({ handler: () => { throw Object.assign(new Error('PRIVATE_ERROR_SENTINEL'), { code: 'ORG_PRIVATE_SENTINEL' }); } });
  await assert.rejects(h.api.start(options()), { message: 'ORG_READ_UNCONFIRMED', code: 'ORG_READ_UNCONFIRMED' });
  await assert.rejects(h.api.export(), /ORG_COLLECTOR_INVALIDATED/);
});
