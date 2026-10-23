import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { suiteContext, transitionFlags, PRODUCTION_D1_ID } from '../scripts/acceptance/production-acceptance-lib.mjs';
import { manifest, verifyDisabledState, verifyPreflight } from '../scripts/acceptance/suites/cc04-selective-access.mjs';
import { syntheticResources, assertQaContext } from '../scripts/acceptance/suites/cc04-resources.mjs';
import { createTicketCommandDb } from './helpers/ticket-command-db.mjs';
import { createTicketAccessGroup, replaceTicketLabels } from '../functions/_lib/ticket-access.js';
import { onRequestGet as detail, onRequestPatch as update } from '../functions/api/organizations/[id]/tickets/[ticketId].js';
import { onRequest as accessRoute } from '../functions/api/organizations/[id]/tickets/[ticketId]/access.js';
import { onRequest as labelsRoute } from '../functions/api/organizations/[id]/tickets/[ticketId]/labels.js';
import { onRequest as attachmentsRoute } from '../functions/api/organizations/[id]/tickets/[ticketId]/attachments.js';
import { onRequest as groupsRoute } from '../functions/api/organizations/[id]/ticket-access/groups.js';
import { onRequest as groupRoute } from '../functions/api/organizations/[id]/ticket-access/groups/[groupId].js';
import { onRequest as stateRoute } from '../functions/api/organizations/[id]/tickets/[ticketId]/state.js';

const runId = '12345678-1234-4321-8123-123456789abc';
const sha = 'a'.repeat(40);
function fixture() {
  const calls = [], journals = [];
  const ticket = { id: 101, organizationId: 9, subject: `QA-CC04-${runId}`, createdBy: { id: 10 }, status: 'open', visibility: 'organization' };
  const group = { id: 'tagrp_synthetic', organizationId: 9, name: `QA CC04 ${runId}`, active: true, memberCount: 1, members: [{ id: 11 }] };
  const attachment = { id: 102, organizationId: 9, ticketId: 101, name: `qa-${runId}.txt`, status: 'ACTIVE' };
  const label = { id: 'talbl_synthetic', name: `QA-${runId}` };
  let labels = [label], access = { visibility: 'organization', acl: [], policies: [] };
  const profiles = Object.fromEntries(['manager', 'allowed', 'restricted'].map((name, i) => [name, {
    cookie: `maono_session=${name}`, organization: { id: 9 }, user: { id: 10 + i, role: i ? 'viewer' : 'editor', permissions: ['ticket.view'] },
  }]));
  const fetchImpl = async (url, options) => {
    const path = new URL(url).pathname, method = options.method;
    calls.push({ path, method });
    assert.notEqual(method, 'DELETE', 'no permanent or provider deletion is allowed');
    if (options.headers.Cookie !== 'maono_session=manager') return Response.json({ ok: false }, { status: 404 });
    if (path.endsWith('/ticket-access/groups')) return Response.json({ ok: true, groups: [group] });
    if (path.endsWith('/ticket-access/groups/tagrp_synthetic')) {
      Object.assign(group, JSON.parse(options.body), { memberCount: 0 });
      return Response.json({ ok: true, group });
    }
    if (path.endsWith('/access')) {
      if (method === 'PUT') { const data = JSON.parse(options.body); access = { ...data, policies: [] }; ticket.visibility = data.visibility; }
      // Real D1 TEXT principal ids can be strings.
      return Response.json({ ok: true, access: { ...access, acl: access.acl.map(row => ({ ...row, principalId: String(row.principalId) })) } });
    }
    if (path.endsWith('/labels')) {
      if (method === 'PUT') labels = [];
      return Response.json({ ok: true, labels, available: [label] });
    }
    if (path.endsWith('/attachments')) return Response.json({ ok: true, attachments: [attachment] });
    assert.equal(path, '/api/organizations/9/tickets/101');
    if (method === 'PATCH') Object.assign(ticket, JSON.parse(options.body));
    return Response.json({ ok: true, ticket });
  };
  const ctx = suiteContext({ baseUrl: 'https://synthetic.test', organizationId: 9, runId, profiles,
    deps: { fetchImpl, onResourceJournal: async journal => journals.push(structuredClone(journal)) } });
  const resources = syntheticResources(ctx);
  const observe = async kind => {
    const row = { ticket, group, attachment, label }[kind];
    await resources.begin(kind); await resources.observe(kind, row);
  };
  return { ctx, resources, observe, calls, journals, ticket, group, attachment, label };
}

test('CC04 disabled /state is observed as disabled, never as proof of ACL coverage', () => {
  assert.deepEqual(verifyDisabledState({ status: 503, body: { code: 'TICKET_COMMANDS_DISABLED' } }),
    { status: 'NOT_EXERCISED', reason: 'TICKET_COMMANDS_DISABLED', httpStatus: 503 });
  for (const response of [{ status: 404 }, { status: 200 }, { status: 503, body: { code: 'OTHER' } }, { status: 503, body: { error: { code: 'TICKET_COMMANDS_DISABLED' } } }]) {
    assert.throws(() => verifyDisabledState(response), { code: 'ACCEPTANCE_ASSERTION_FAILED' });
  }
});

test('CC04 preflight refuses global COMMANDS enablement, absence, ambiguity and mismatched snapshots', () => {
  const project = value => ({ raw: { deployment_configs: { production: { env_vars: { MAONO_TICKET_COMMANDS_ENABLED: value } } },
    canonical_deployment: { env_vars: { MAONO_TICKET_COMMANDS_ENABLED: { type: 'plain_text', value: 'false' } } } } });
  assert.doesNotThrow(() => verifyPreflight(project({ type: 'plain_text', value: 'false' })));
  for (const flag of [undefined, { type: 'plain_text', value: 'true' }, { type: 'secret_text', value: 'false' }, { type: 'plain_text', value: '0' }]) {
    assert.throws(() => verifyPreflight(project(flag)), { code: 'CC04_COMMANDS_BASELINE_MISMATCH' });
  }
});

test('CC04 journals intent before IDs, then verifies private preservation with zero deletes', async () => {
  const f = fixture();
  for (const kind of ['ticket', 'attachment', 'label', 'group']) await f.observe(kind);
  assert.equal(f.journals[0].resources[0].state, 'intent');
  assert.equal(f.journals[0].unknownCreation, true);
  assert.equal(f.journals[1].resources[0].id, '101');
  assert.deepEqual(await f.ctx.cleanup(), []);
  const final = f.journals.at(-1);
  assert.equal(final.cleanupVerified, true);
  assert.equal(final.unknownCreation, false);
  assert.deepEqual(final.resources.map(row => row.state), ['preserved_private_closed', 'preserved_private', 'preserved_detached', 'preserved_inactive']);
  assert.equal(f.ctx.cases.find(row => row.id === 'CC04-CLEANUP').status, 'PASS');
  assert.ok(f.calls.every(row => row.method !== 'DELETE'));
  assert.ok(f.calls.filter(row => row.method !== 'GET').every(row => row.path.includes('/tickets/101') || row.path.endsWith('/groups/tagrp_synthetic')));
  assert.equal(JSON.stringify(final).includes('maono_session'), false);
});

test('CC04 refuses cleanup mutation of a ticket whose ownership changed', async () => {
  const f = fixture(); await f.observe('ticket'); f.ticket.subject = 'real user ticket';
  const errors = await f.ctx.cleanup();
  assert.equal(errors[0].code, 'RESOURCE_CLEANUP_UNVERIFIED');
  assert.ok(f.calls.every(row => row.method === 'GET'));
  assert.equal(f.journals.at(-1).cleanupVerified, false);
});

test('CC04 unknown create is not retried or adopted, and cannot be certified as cleanup complete', async () => {
  const f = fixture(); await f.resources.begin('ticket');
  const errors = await f.ctx.cleanup();
  assert.equal(errors[0].code, 'SYNTHETIC_RESOURCE_OUTCOME_UNCERTAIN');
  assert.equal(f.calls.length, 0);
  assert.equal(f.journals.at(-1).unknownCreation, true);
  assert.equal(f.journals.at(-1).cleanupVerified, false);
});

test('CC04 interrupted upload preserves bytes and reports unresolved cleanup', async () => {
  const f = fixture(); await f.observe('ticket'); await f.observe('attachment'); f.attachment.status = 'PENDING';
  const errors = await f.ctx.cleanup();
  assert.equal(errors[0].code, 'RESOURCE_CLEANUP_UNVERIFIED');
  assert.equal(f.ticket.visibility, 'private');
  assert.equal(f.ticket.status, 'closed');
  assert.ok(f.calls.every(row => row.method !== 'DELETE'));
});

test('CC04 privileged accounts, wrong organization and missing journal fail before creating fixtures', async () => {
  for (const role of ['admin', 'super_admin']) {
    const f = fixture(); f.ctx.profiles.manager.user.role = role;
    assert.throws(() => assertQaContext(f.ctx), { code: 'QA_PRIVILEGED_IDENTITY_FORBIDDEN' });
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.ctx.profiles.allowed.organization.id = 8;
  assert.throws(() => assertQaContext(f.ctx), { code: 'QA_ORGANIZATION_MISMATCH' });
  const other = fixture(); other.ctx.publishResourceJournal = async () => { throw new Error('disk failure'); };
  await assert.rejects(() => other.resources.begin('ticket'), /disk failure/);
  assert.equal(other.calls.length, 0);
});

function controlPlane({ drift = false, value = true } = {}) {
  const calls = []; let reads = 0;
  const fetchImpl = async (url, options) => {
    calls.push(options.method); assert.equal(options.method, 'GET');
    const flag = { type: 'plain_text', value: String(value) };
    const deployment = { id: 'canonical', environment: 'production', deployment_trigger: { metadata: { commit_hash: sha, commit_dirty: false } },
      latest_stage: { name: 'deploy', status: 'success' }, env_vars: { MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: flag } };
    if (new URL(url).pathname.endsWith('/deployments')) return Response.json({ success: true, result: [deployment] });
    reads++;
    if (drift && reads > 1) deployment.env_vars.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED = { ...flag, value: 'false' };
    return Response.json({ success: true, result: { name: 'maono-kepler-v1', production_branch: 'mano_kepler_v1', subdomain: 'maono-kepler-v1.pages.dev',
      canonical_deployment: deployment, deployment_configs: { production: { d1_databases: { DB: { id: PRODUCTION_D1_ID } }, env_vars: deployment.env_vars } } } });
  };
  return { calls, fetchImpl };
}

test('matching flags certify a fresh no-op without PATCH, retry, or mutation hook', async () => {
  const f = controlPlane();
  const result = await transitionFlags({ token: 'synthetic', manifest, commit: sha, sourceDeploymentId: 'canonical',
    values: { MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: true }, deps: { fetchImpl: f.fetchImpl }, onMutationStart: () => assert.fail('no mutation') });
  assert.equal(result.changed, false);
  assert.equal(f.calls.length, 4);
});

test('no-op races and read-only closure drift fail without overwriting concurrent changes', async () => {
  for (const options of [{ drift: true }, { value: false }]) {
    const f = controlPlane(options);
    await assert.rejects(() => transitionFlags({ token: 'synthetic', manifest, commit: sha, sourceDeploymentId: 'canonical', allowMutation: false,
      values: { MAONO_TICKET_SELECTIVE_ACCESS_ENABLED: true }, deps: { fetchImpl: f.fetchImpl } }), { code: 'PRODUCTION_FLAG_DRIFT' });
    assert.ok(f.calls.every(method => method === 'GET'));
  }
});

test('all Central worker examples preserve selective access while their operations are disabled', async () => {
  for (const name of ['ticket-notifications', 'change-reconciliation', 'ticket-exports']) {
    const source = await readFile(new URL(`../wrangler.${name}.toml.example`, import.meta.url), 'utf8');
    assert.match(source, /MAONO_TICKET_SELECTIVE_ACCESS_ENABLED = "true"/);
    assert.doesNotMatch(source, /MAONO_TICKET_SELECTIVE_ACCESS_ENABLED = "false"/);
  }
});

test('CC04 cleanup consumes real HTTP handlers and SQLite, preserving ticket/history while revoking QA access', async t => {
  const db = await createTicketCommandDb(t, { commandsEnabled: false, triageEnabled: false });
  db.sqlite.exec(await readFile(new URL('../migrations/0027_ticket_selective_access.sql', import.meta.url), 'utf8'));
  db.env.MAONO_TICKET_SELECTIVE_ACCESS_ENABLED = 'true';
  // Match the real suite's buildProfiles admission: both negative actors must
  // have coarse ticket.view, otherwise HTTP 403 would not exercise object ACLs.
  db.sqlite.exec("INSERT INTO user_permissions(user_id,permission,organization_id,active) VALUES(3,'ticket.view',1,1)");
  db.sqlite.prepare(`INSERT INTO organization_tickets (id,organization_id,code,subject,description,status,priority,category,created_by,active,created_at,updated_at)
    VALUES (101,1,'TKT-101',?,'synthetic','open','normal','support',1,1,'2026-10-01','2026-10-01')`).run(`QA-CC04-${runId}`);
  const group = await createTicketAccessGroup(db.env, 1, { name: `QA CC04 ${runId}`, members: [2] }, 1);
  const labelData = await replaceTicketLabels(db.env, 1, 101, { labels: [`QA-${runId}`] }, 1);
  const journals = [], methods = [];
  const profiles = Object.fromEntries(['manager', 'allowed', 'restricted'].map((name, i) => [name, {
    cookie: db.sessionCookie(i + 1, 1), organization: { id: 1 }, user: { id: i + 1, role: i === 2 ? 'viewer' : 'owner', permissions: ['ticket.view'] },
  }]));
  const fetchImpl = async (url, options) => {
    methods.push(options.method);
    const path = new URL(url).pathname;
    const params = { id: '1', ticketId: '101', groupId: group.id };
    const request = new Request(url, options);
    const context = { env: db.env, request, params };
    if (path.endsWith(`/groups/${group.id}`)) return groupRoute(context);
    if (path.endsWith('/groups')) return groupsRoute(context);
    if (path.endsWith('/access')) return accessRoute(context);
    if (path.endsWith('/labels')) return labelsRoute(context);
    if (path.endsWith('/attachments')) return attachmentsRoute(context);
    if (path.endsWith('/state')) return stateRoute(context);
    assert.equal(path, '/api/organizations/1/tickets/101');
    return options.method === 'PATCH' ? update(context) : detail(context);
  };
  const ctx = suiteContext({ baseUrl: 'https://synthetic.test', organizationId: 1, runId, profiles,
    deps: { fetchImpl, onResourceJournal: async value => journals.push(structuredClone(value)) } });
  const resources = syntheticResources(ctx);
  const ticket = (await ctx.api('manager', '/api/organizations/1/tickets/101')).body.ticket;
  for (const [kind, row] of [['ticket', ticket], ['group', group], ['label', labelData.labels[0]]]) {
    await resources.begin(kind); await resources.observe(kind, row);
  }
  assert.deepEqual(await ctx.cleanup(), [], JSON.stringify({ journal: journals.at(-1), status: db.row(101).status, visibility: db.row(101).visibility, methods }));
  assert.equal(db.row(101).status, 'closed');
  assert.equal(db.row(101).visibility, 'private');
  assert.equal(db.row(101).active, 1, 'ticket is retained, not deleted');
  assert.equal(db.rows('ticket_labels').length, 1, 'detached label is retained');
  assert.equal(db.rows('ticket_label_links').length, 0);
  assert.equal(db.rows('ticket_access_groups')[0].active, 0);
  assert.equal(db.rows('ticket_access_group_members').length, 0);
  assert.ok(db.rows('ticket_events').length > 0, 'audit history is preserved');
  assert.equal(journals.at(-1).cleanupVerified, true);
  assert.equal(verifyDisabledState(await ctx.api('restricted', '/api/organizations/1/tickets/101/state')).status, 'NOT_EXERCISED');
  assert.ok(methods.every(method => method !== 'DELETE'));
});
