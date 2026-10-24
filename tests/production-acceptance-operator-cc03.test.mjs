import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { suiteContext, PRODUCTION_D1_ID } from '../scripts/acceptance/production-acceptance-lib.mjs';
import { main } from '../scripts/acceptance/operator.mjs';
import { manifest, run, prepare, verifyPreflight } from '../scripts/acceptance/suites/cc03-command-lifecycle.mjs';
import { commandResources, QA_IDS } from '../scripts/acceptance/suites/cc03-resources.mjs';
import { createTicketCommandDb } from './helpers/ticket-command-db.mjs';
import { onRequestPost as create, onRequestGet as list } from '../functions/api/organizations/[id]/tickets.js';
import { onRequestGet as detail, onRequestPatch as update } from '../functions/api/organizations/[id]/tickets/[ticketId].js';
import { onRequest as access } from '../functions/api/organizations/[id]/tickets/[ticketId]/access.js';
import { onRequest as state } from '../functions/api/organizations/[id]/tickets/[ticketId]/state.js';
import { onRequest as transition } from '../functions/api/organizations/[id]/tickets/[ticketId]/transitions.js';
import { onRequest as waits } from '../functions/api/organizations/[id]/tickets/[ticketId]/waits.js';
import { onRequest as reopen } from '../functions/api/organizations/[id]/tickets/[ticketId]/reopen.js';
import { onRequest as correction } from '../functions/api/organizations/[id]/tickets/[ticketId]/events/[eventId]/corrections.js';

const runId = '12345678-1234-4321-8123-123456789abc';
async function fixture(t, { intercept = null } = {}) {
  const db = await createTicketCommandDb(t);
  db.sqlite.exec(await readFile(new URL('../migrations/0027_ticket_selective_access.sql', import.meta.url), 'utf8'));
  db.sqlite.exec(`INSERT INTO users(id,email,name,role,password_hash) VALUES
    (5,'manager@synthetic.test','Synthetic manager','owner','fixture'),
    (11,'allowed@synthetic.test','Synthetic allowed','editor','fixture'),
    (7,'restricted@synthetic.test','Synthetic restricted','viewer','fixture');
    INSERT INTO organizations(id,name,slug,dropbox_root_path) VALUES(9,'Synthetic QA','maono-preview-qa','/synthetic');
    INSERT INTO organization_users(organization_id,user_id,access_level) VALUES(9,5,'owner'),(9,11,'editor'),(9,7,'viewer');
    INSERT INTO user_permissions(user_id,permission,organization_id,active) VALUES(7,'ticket.view',9,1),(11,'ticket.view',9,1);`);
  await db.ready(9);
  db.env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED = 'true';
  const journals = [], calls = [];
  const profiles = Object.fromEntries(Object.entries(QA_IDS).map(([name, id]) => [name, { cookie: db.sessionCookie(id, 9),
    organization: { id: 9, slug: 'maono-preview-qa' }, user: { id, role: name === 'manager' ? 'owner' : name === 'allowed' ? 'editor' : 'viewer',
      permissions: manifest.requiredPermissions[name] } }]));
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname, method = options.method;
    assert.notEqual(method, 'DELETE');
    assert.ok(path.startsWith('/api/organizations/9/tickets'), path);
    calls.push({ path, method, body: options.body, headers: options.headers });
    const match = path.match(/^\/api\/organizations\/9\/tickets(?:\/(\d+)(.*))?$/);
    assert.ok(match, path);
    const suffix = match[2] || '';
    const route = !match[1] ? (method === 'POST' ? create : list) :
      ({ '/access': access, '/state': state, '/transitions': transition, '/waits': waits, '/reopen': reopen })[suffix] ||
      (suffix.startsWith('/events/') ? correction : method === 'PATCH' ? update : detail);
    const execute = () => route({ env: db.env, params: { id: '9', ticketId: match[1], eventId: suffix.split('/')[2] }, request: new Request(url, options) });
    return intercept ? intercept({ path, method, options, execute, db, calls }) : execute();
  };
  const ctx = suiteContext({ baseUrl: 'https://synthetic.test', organizationId: 9, runId, profiles,
    deps: { fetchImpl, onResourceJournal: async journal => journals.push(structuredClone(journal)) } });
  return { db, ctx, calls, journals, fetchImpl };
}

test('CC03 complete API journey uses real handlers/SQLite and preserves exactly one private closed ticket', async t => {
  const f = await fixture(t);
  await prepare(f.ctx);
  let result;
  try { result = await run(f.ctx); } finally { assert.deepEqual(await f.ctx.cleanup(), [], JSON.stringify(f.journals.at(-1))); }
  assert.equal(result.syntheticTicketId, f.db.rows('organization_tickets')[0].id);
  assert.equal(f.db.rows('organization_tickets').length, 1);
  const row = f.db.row(result.syntheticTicketId);
  assert.equal(row.status, 'closed'); assert.equal(row.visibility, 'private'); assert.equal(row.active, 1);
  assert.equal(f.db.rows('ticket_cycles').length, 2);
  assert.ok(f.db.rows('ticket_cycles').every(row => row.closed_at && row.closure_json));
  assert.ok(f.db.rows('ticket_wait_intervals').every(row => row.ended_at));
  const events = f.db.rows('ticket_events');
  assert.equal(events.filter(row => row.event_type === 'ticket.created').length, 1);
  assert.equal(events.filter(row => row.event_type === 'ticket.event.corrected').length, 1);
  assert.ok(f.db.rows('ticket_command_outbox').length > 0);
  assert.equal(f.journals[0].unknownCreation, true);
  assert.equal(f.journals.at(-1).cleanupVerified, true);
  assert.deepEqual(f.ctx.cases.map(row => row.id).sort(), [...manifest.cases].sort());
  assert.ok(f.ctx.cases.every(row => row.status === 'PASS'));
  const writes = f.calls.filter(row => row.method !== 'GET');
  assert.equal(writes[1].path.endsWith('/access'), true, 'privatize immediately after create');
  assert.ok(writes.filter(row => row.method === 'PATCH').every(row => !JSON.parse(row.body).status));
});

for (const suffix of ['/waits', '/reopen', '/events/']) test(`CC03 interruption at ${suffix} still closes via fresh ETag without deleting history`, async t => {
  let interrupted = false;
  const f = await fixture(t, { intercept: async request => {
    const response = await request.execute();
    if (!interrupted && request.method === 'POST' && request.path.includes(suffix)) { interrupted = true; throw new Error('synthetic lost response'); }
    return response;
  } });
  await assert.rejects(run(f.ctx));
  const before = f.db.rows('ticket_events').map(row => ({ ...row }));
  assert.deepEqual(await f.ctx.cleanup(), [], JSON.stringify(f.journals.at(-1)));
  assert.ok(before.every(row => f.db.rows('ticket_events').some(next => JSON.stringify(next) === JSON.stringify(row))));
  assert.equal(f.db.rows('organization_tickets')[0].status, 'closed');
  assert.equal(f.journals.at(-1).cleanupVerified, true);
  assert.ok(f.calls.filter(row => row.path.endsWith('/transitions')).every(row => row.headers['If-Match']));
});

test('CC03 lost create response never adopts or retries an ID and reports uncertain containment', async t => {
  const f = await fixture(t, { intercept: async request => {
    const response = await request.execute();
    if (request.method === 'POST' && request.path.endsWith('/tickets')) throw new Error('lost create response');
    return response;
  } });
  await assert.rejects(run(f.ctx));
  assert.equal((await f.ctx.cleanup())[0].code, 'SYNTHETIC_RESOURCE_OUTCOME_UNCERTAIN');
  assert.equal(f.db.rows('organization_tickets').length, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.journals.at(-1).resources[0].id, null);
});

test('CC03 rejects changed ownership before cleanup writes and does not touch an existing record', async t => {
  const f = await fixture(t);
  await run(f.ctx);
  const id = f.db.rows('organization_tickets')[0].id;
  // Test-only corruption; production operator has no SQL mutation path.
  f.db.sqlite.prepare('UPDATE organization_tickets SET subject=? WHERE id=?').run('not this run', id);
  const start = f.calls.length;
  assert.equal((await f.ctx.cleanup())[0].code, 'SYNTHETIC_RESOURCE_SCOPE_MISMATCH');
  assert.ok(f.calls.slice(start).every(row => row.method === 'GET'));
});

test('CC03 context rejects other organizations, IDs and administrative/privileged negative profiles before HTTP', async t => {
  for (const mutate of [ctx => { ctx.organizationId = 8; }, ctx => { ctx.profiles.allowed.user.id = 4; },
    ctx => { ctx.profiles.allowed.user.role = 'admin'; }, ctx => { ctx.profiles.restricted.user.permissions = ['ticket.manage']; }]) {
    const f = await fixture(t); mutate(f.ctx);
    await assert.rejects(prepare(f.ctx));
    assert.equal(f.calls.length, 0);
  }
});

test('CC03 preflight requires explicit preserved privacy/triage and disabled commands in both snapshots', () => {
  const vars = Object.fromEntries(Object.entries(manifest.managedFlags).map(([name, value]) => [name, { type: 'plain_text', value: String(value.requiredBefore) }]));
  const project = { raw: { deployment_configs: { production: { env_vars: structuredClone(vars) } }, canonical_deployment: { env_vars: structuredClone(vars) } } };
  verifyPreflight(project);
  for (const options of [{ organizationId: 8 }, { organizationId: 9, projectSlug: 'other-project' }]) {
    assert.throws(() => verifyPreflight(project, options), { code: 'CC03_QA_SCOPE_MISMATCH' });
  }
  for (const key of Object.keys(vars)) {
    const invalid = structuredClone(project); delete invalid.raw.canonical_deployment.env_vars[key];
    assert.throws(() => verifyPreflight(invalid), { code: 'CC03_BASELINE_MISMATCH' });
  }
});

test('CC03 no-create cleanup is a verified no-op', async t => {
  const f = await fixture(t); commandResources(f.ctx);
  assert.deepEqual(await f.ctx.cleanup(), []);
  assert.equal(f.calls.length, 0);
  assert.equal(f.journals.at(-1).resources.length, 0);
});

test('CC03 leaves a pre-existing QA9 ticket byte-for-byte unchanged', async t => {
  const f = await fixture(t);
  f.db.sqlite.exec(`INSERT INTO organization_tickets(id,organization_id,code,subject,description,status,priority,category,created_by,visibility)
    VALUES(4,9,'PREEXISTING','Previously preserved synthetic record','preserve','closed','normal','support',5,'private')`);
  const before = { ...f.db.row(4) };
  await run(f.ctx);
  assert.deepEqual(await f.ctx.cleanup(), []);
  assert.deepEqual(f.db.row(4), before);
  assert.equal(f.db.rows('organization_tickets').length, 2);
  assert.ok(f.calls.every(row => !/\/tickets\/4(?:\/|$)/.test(row.path)));
});

test('CC03 lost cleanup close response is checked once and confirmed without repeating its transition', async t => {
  let lost = false, cleanup = false, closes = 0;
  const f = await fixture(t, { intercept: async request => {
    if (cleanup && request.path.endsWith('/transitions')) closes++;
    const response = await request.execute();
    if (cleanup && !lost && request.path.endsWith('/transitions')) { lost = true; throw new Error('lost close response'); }
    return response;
  } });
  const resources = commandResources(f.ctx);
  await resources.begin();
  const created = await f.ctx.api('manager', '/api/organizations/9/tickets', { method: 'POST', headers: { 'Idempotency-Key': 'cleanup-only' },
    json: { subject: resources.subject, description: 'synthetic', category: 'support', priority: 'normal', assignedTo: 5,
      demandNature: 'question_request', expectedResult: 'synthetic', context: 'synthetic', impact: 'individual', urgency: 'flexible', triageAnswers: {}, triageFormVersion: 1 } });
  await resources.observe(created.body.ticket);
  cleanup = true;
  assert.deepEqual(await f.ctx.cleanup(), []);
  assert.equal(closes, 1); assert.equal(f.journals.at(-1).cleanupVerified, true);
});

for (const scenario of ['success', 'suite-error', 'cleanup-error', 'stale-admission', 'short-window']) {
  test(`CC03 protected operator end-to-end (${scenario}): budget, journals, preserved flags and restoration`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'cc03-operator-')); t.after(() => rm(directory, { recursive: true, force: true }));
    t.mock.method(process.stdout, 'write', () => true);
    let cleanup = false, suiteFailed = false;
    const f = await fixture(t, { intercept: async request => {
      if (request.path.endsWith('/access') && request.method === 'PUT') {
        const data = JSON.parse(request.options.body); cleanup = data.acl.length === 1;
        if (cleanup && scenario === 'cleanup-error') return Response.json({ ok: false }, { status: 403 });
      }
      const response = await request.execute();
      if (scenario === 'suite-error' && !suiteFailed && request.path.endsWith('/waits')) {
        suiteFailed = true; throw new Error('synthetic interruption after wait');
      }
      return response;
    } });
    const sha = 'a'.repeat(40), start = Date.parse('2026-10-24T01:00:00.000Z'); let clock = start;
    let configured = false, canonical = false, canonicalId = 'baseline', patches = 0, logins = 0, deployments = 0, admissionDelayed = false;
    const flags = value => ({ MAONO_TICKET_COMMANDS_ENABLED: { type: 'plain_text', value: String(value) },
      MAONO_TICKET_TRIAGE_ENABLED: { type: 'plain_text', value: 'true' }, MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: { type: 'plain_text', value: 'true' } });
    const deployment = () => ({ id: canonicalId, environment: 'production', url: 'https://maono-kepler-v1.pages.dev', env_vars: flags(canonical),
      latest_stage: { name: 'deploy', status: 'success' }, deployment_trigger: { metadata: { commit_hash: sha, commit_dirty: false } } });
    const fetchImpl = async (url, options) => {
      const path = new URL(url).pathname;
      if (new URL(url).hostname === 'api.cloudflare.com') {
        if (scenario === 'stale-admission' && logins === 3 && !admissionDelayed) { clock += 11 * 60_000; admissionDelayed = true; }
        if (options.method === 'PATCH') {
          patches++;
          const vars = JSON.parse(options.body).deployment_configs.production.env_vars;
          assert.deepEqual(Object.keys(vars).sort(), Object.keys(flags(false)).sort());
          assert.equal(vars.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED.value, 'true');
          assert.equal(vars.MAONO_TICKET_TRIAGE_ENABLED.value, 'true');
          configured = vars.MAONO_TICKET_COMMANDS_ENABLED.value === 'true';
          if (!configured) {
            assert.ok(cleanup, 'cleanup attempted BEFORE restoring commands');
            if (scenario !== 'cleanup-error') assert.equal(f.db.rows('organization_tickets')[0].status, 'closed');
          }
          return Response.json({ success: true, result: {} });
        }
        if (options.method === 'POST') {
          assert.ok(path.endsWith('/retry')); deployments++;
          canonicalId = `deployment-${deployments}`; canonical = configured;
          f.db.env.MAONO_TICKET_COMMANDS_ENABLED = String(canonical);
          return Response.json({ success: true, result: { id: canonicalId } });
        }
        const result = path.endsWith('/deployments') ? [deployment()] : path.includes('/deployments/') ? deployment() :
          { name: 'maono-kepler-v1', production_branch: 'mano_kepler_v1', subdomain: 'maono-kepler-v1.pages.dev', canonical_deployment: deployment(),
            deployment_configs: { production: { env_vars: flags(configured), d1_databases: { DB: { id: PRODUCTION_D1_ID } } } } };
        return Response.json({ success: true, result });
      }
      if (path === '/api/auth/login') {
        logins++;
        return Response.json({ ok: true }, { headers: { 'set-cookie': `${Object.values(f.ctx.profiles)[logins - 1].cookie}; Secure; HttpOnly` } });
      }
      if (path === '/api/session') {
        const profile = Object.values(f.ctx.profiles)[logins - 1];
        return Response.json({ authenticated: true, activeOrganization: profile.organization, user: profile.user, permissions: profile.user.permissions });
      }
      assert.equal(canonical, true, 'no fixture requests before activation or after restoration');
      return f.fetchImpl(url, options);
    };
    const window = { version: 1, expectedCommit: sha, databaseId: PRODUCTION_D1_ID, observedAt: new Date(start).toISOString(),
      startsAt: new Date(start).toISOString(), endsAt: new Date(start + (scenario === 'short-window' ? 30 : 190) * 60_000).toISOString(),
      globalCommandsApproved: true, writersPaused: true, restorationOwner: 'synthetic-owner', evidenceSha256: 'b'.repeat(64),
      schemaCompatible: true, allActiveOrganizations: true, activeOrganizationCount: 1, organizations: [{ id: 9, status: 'ready', schemaVersion: 1, pendingCount: 0,
        skippedCount: 0, completedAt: new Date(start).toISOString(), actualPendingCount: 0, unclassifiedAdoptedCount: 0 }] };
    const reportPath = join(directory, 'report.json');
    const credentials = Object.fromEntries(Object.keys(QA_IDS).map(name => [name, { email: `${name}@synthetic.test`, password: 'synthetic-private-value' }]));
    const code = await main(['--mode', 'run', '--suite', manifest.id, '--organization-id', '9', '--qa-user-ids', '5,11,7', '--expected-commit', sha, '--report', reportPath],
      { GITHUB_ACTOR: 'synthetic-owner', GITHUB_RUN_ATTEMPT: '1', MAONO_ACCEPTANCE_CC03_WINDOW_JSON: JSON.stringify(window),
        MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN: 'synthetic', MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON: JSON.stringify(credentials) },
      { fetchImpl, now: () => clock, sleep: async ms => { clock += ms; } });
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(code, scenario === 'success' ? 0 : 1, JSON.stringify(report.error));
    assert.equal(report.configurationRestored, true, JSON.stringify(report.restoreError));
    assert.equal(canonical, false); assert.equal(configured, false);
    assert.doesNotMatch(JSON.stringify(report), /synthetic-private-value|maono_session|@synthetic.test/);
    if (['stale-admission', 'short-window'].includes(scenario)) {
      assert.equal(patches, 0); assert.equal(f.calls.length, 0); assert.equal(report.acceptanceExecuted, false);
    } else {
      assert.equal(patches, 2); assert.equal(deployments, 2); assert.equal(f.db.rows('organization_tickets').length, 1);
      assert.equal(report.cleanupComplete, scenario !== 'cleanup-error');
      assert.equal(report.complete, scenario === 'success');
      assert.equal(report.resourceJournal.cleanupVerified, scenario !== 'cleanup-error');
    }
  });
}
