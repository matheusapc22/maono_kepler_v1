import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveAndCapture, verifyPrivateImageCache, installBrowserWriteGuard } from '../scripts/acceptance/preview-browser.mjs';
import { manifest } from '../scripts/acceptance/suites/durable-project-preview.mjs';
import { safeFlags, activeFlags, PRODUCTION_D1_ID } from '../scripts/acceptance/production-acceptance-lib.mjs';
import { main } from '../scripts/acceptance/operator.mjs';

const helperUrl = new URL('../scripts/acceptance/preview-browser.mjs', import.meta.url).href;
const suiteUrl = new URL('../scripts/acceptance/suites/durable-project-preview.mjs', import.meta.url).href;

// A real Node process is intentional: node:test / Playwright Test supervision
// could mask the standalone operator's uncaught-exception failure mode.
for (const fault of ['save-json', 'preview-json', 'uri', 'body', 'url', 'get-route', 'post-route', 'abort-route', 'request-getter', 'closed-route']) {
  test(`asynchronous browser callback ${fault} cannot terminate the process or bypass finally`, () => {
    const script = `
      import { EventEmitter } from 'node:events';
      import { saveAndCapture, installBrowserWriteGuard } from ${JSON.stringify(helperUrl)};
      import { boundedBrowserOwner, withBrowserDeadline } from ${JSON.stringify(suiteUrl)};
      const fault = ${JSON.stringify(fault)}, page = new EventEmitter();
      let caught = null, closed = false, cleanup = false, restored = false, handler;
      const ctx = { baseUrl: 'https://maono.test', organizationId: 9, assertAdmission() {},
        isBrowserScopeClosed: () => fault === 'closed-route' || closed,
        requestTimeoutMs: () => 1000, pause: () => new Promise(resolve => setTimeout(resolve, 5)) };
      const project = { id: 101, slug: 'qa-small' };
      page.isClosed = () => closed;
      page.route = async (_pattern, fn) => { handler = fn; };
      page.locator = () => ({ click: async () => { setTimeout(() => page.emit('request', {
        url() { if (fault === 'url') throw new Error('SYNTHETIC_PRIVATE_PARSER_TEXT');
          return 'https://maono.test/api/projects/qa-small/' + (fault === 'preview-json' ? 'thumbnail' : fault === 'uri' ? 'save-operations/%E0%A4%A/payload' : fault === 'body' ? 'save-operations/valid-operation/payload' : 'save-operations'); },
        method: () => ['uri', 'body'].includes(fault) ? 'PUT' : 'POST',
        postDataJSON() { throw new Error('SYNTHETIC_PRIVATE_PARSER_TEXT'); },
        postDataBuffer() { throw new Error('SYNTHETIC_PRIVATE_BODY_TEXT'); },
      }), 0); } });
      const owner = boundedBrowserOwner({ close: async () => { closed = true; } });
      try {
        await withBrowserDeadline(owner, 500, async () => {
          if (!fault.endsWith('route') && fault !== 'request-getter') return saveAndCapture(page, ctx, project, 1);
          const guard = await installBrowserWriteGuard(page, ctx, project);
          setTimeout(() => { void handler({
            request() { if (fault === 'request-getter') throw new Error('SYNTHETIC_PRIVATE_REQUEST_TEXT');
              return { method: () => ['post-route', 'abort-route'].includes(fault) ? 'POST' : 'GET',
                url: () => 'https://maono.test/api/projects/' + (fault === 'abort-route' ? 'unrelated' : 'qa-small') + '/thumbnail' }; },
            fallback: async () => { throw new Error('SYNTHETIC_PRIVATE_ROUTE_TEXT'); },
            abort: async () => { throw new Error('SYNTHETIC_PRIVATE_ABORT_TEXT'); },
          }); }, 0);
          await guard.run(() => new Promise(resolve => setTimeout(resolve, 30)));
          guard();
        });
      } catch (error) { caught = { code: error.code, message: error.message }; }
      finally { cleanup = true; restored = true; }
      // Let any uncaught rejection from an event-dispatched route surface.
      await new Promise(resolve => setTimeout(resolve, 30));
      console.log(JSON.stringify({ caught, closed, cleanup, restored, requestListeners: page.listenerCount('request') }));
    `;
    const child = spawnSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.signal, null);
    const result = JSON.parse(child.stdout.trim());
    assert.equal(result.closed, true);
    assert.equal(result.cleanup, true);
    assert.equal(result.restored, true);
    assert.equal(result.requestListeners, 0);
    assert.doesNotMatch(child.stdout + child.stderr, /SYNTHETIC_PRIVATE/);
    const expected = fault === 'closed-route' ? null : fault === 'abort-route' ? 'PNG_BROWSER_WRITE_OUT_OF_SCOPE' :
      ['get-route', 'post-route', 'request-getter'].includes(fault) ? 'PNG_BROWSER_ROUTE_FAILED' : 'PNG_BROWSER_REQUEST_UNVERIFIED';
    assert.equal(result.caught?.code ?? null, expected);
  });
}

async function observedFailure() {
  const page = new EventEmitter();
  page.locator = () => ({ click: async () => {
    setTimeout(() => page.emit('request', {
      url: () => 'https://maono.test/api/projects/qa-small/save-operations', method: () => 'POST',
      postDataJSON() { throw new Error('SYNTHETIC_PRIVATE_PARSER_TEXT'); },
    }), 0);
  } });
  return saveAndCapture(page, { baseUrl: 'https://maono.test', assertAdmission() {}, requestTimeoutMs: () => 1000,
    pause: () => new Promise(resolve => setTimeout(resolve, 5)) }, { id: 101, slug: 'qa-small' }, 1);
}

async function routingFailure() {
  let handler;
  const page = { route: async (_pattern, fn) => { handler = fn; }, isClosed: () => false };
  const guard = await installBrowserWriteGuard(page, { baseUrl: 'https://maono.test', assertAdmission() {} }, { slug: 'qa-small' });
  setTimeout(() => { void handler({
    request: () => ({ method: () => 'GET', url: () => 'https://maono.test/api/projects/qa-small/thumbnail' }),
    fallback: async () => { throw new Error('SYNTHETIC_PRIVATE_ROUTE_TEXT'); },
    abort: async () => { throw new Error('SYNTHETIC_PRIVATE_ABORT_TEXT'); },
  }); }, 0);
  return guard.run(() => new Promise(resolve => setTimeout(resolve, 30)));
}

for (const fault of ['observation', 'routing']) test(`registered PNG operator retains manual cleanup and restores five flags after ${fault} callback failure`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'png-callback-cleanup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sha = 'a'.repeat(40), events = [], patches = [];
  const organization = { id: 9, slug: 'maono-preview-qa', active: true };
  const prerequisites = Object.fromEntries(['VITE_MAONO_MAP_SHELL_V1', 'VITE_MAONO_LAYER_MANAGER_V1', 'VITE_MAONO_MAP_OVERLAY_V1', 'VITE_ASYNC_PROJECT_THUMBNAIL']
    .map(name => [name, { type: 'plain_text', value: 'true' }]));
  const entries = values => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { type: 'plain_text', value: String(value) }]));
  let configured = { ...prerequisites, ...entries(safeFlags(manifest)) }, canonicalFlags = structuredClone(configured), canonicalId = 'original';
  let actor = null, project = null, file = null;
  const appCalls = [];
  const deployment = () => ({ id: canonicalId, environment: 'production', url: 'https://maono-kepler-v1.pages.dev',
    deployment_trigger: { metadata: { commit_hash: sha, commit_dirty: false } }, latest_stage: { name: 'deploy', status: 'success' }, env_vars: canonicalFlags });
  const reply = (value, status = 200) => Response.json({ ok: true, ...value }, { status });
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url), path = parsed.pathname, method = options.method;
    if (parsed.hostname === 'api.cloudflare.com') {
      if (method === 'PATCH') {
        const changed = JSON.parse(options.body).deployment_configs.production.env_vars;
        configured = { ...configured, ...changed };
        patches.push(Object.fromEntries(Object.entries(changed).map(([name, value]) => [name, value.value === 'true'])));
        events.push(patches.length === 1 ? 'activate' : 'restore');
        return Response.json({ success: true, result: {} });
      }
      if (method === 'POST') { canonicalId = `retry-${patches.length}`; canonicalFlags = structuredClone(configured); return Response.json({ success: true, result: { id: canonicalId } }); }
      if (path.endsWith('/deployments')) return Response.json({ success: true, result: [deployment()] });
      if (path.includes('/deployments/')) return Response.json({ success: true, result: deployment() });
      return Response.json({ success: true, result: { name: 'maono-kepler-v1', production_branch: 'mano_kepler_v1', subdomain: 'maono-kepler-v1.pages.dev',
        canonical_deployment: deployment(), deployment_configs: { production: { d1_databases: { DB: { id: PRODUCTION_D1_ID } }, env_vars: configured } } } });
    }
    appCalls.push({ path, method });
    assert.ok(!path.startsWith('/api/admin/'), 'CI has no administrator API access');
    assert.ok(!['DELETE', 'PATCH'].includes(method), 'CI cannot perform resource cleanup');
    if (path === '/api/auth/login') {
      assert.equal(JSON.parse(options.body).email, 'creator@example.test');
      actor = { id: 11, role: 'editor' };
      return Response.json({ ok: true }, { headers: { 'set-cookie': 'maono_session=synthetic; Secure; HttpOnly' } });
    }
    if (path === '/api/session') return reply({ authenticated: true, activeOrganization: organization, user: actor,
      permissions: ['project.create'] });
    if (path === '/api/projects' && method === 'GET') return reply({ projects: project ? [project] : [] });
    if (path === '/api/projects' && method === 'POST') {
      const body = JSON.parse(options.body);
      project = { id: 101, name: body.name, slug: body.name.toLowerCase().replaceAll(' ', '-'), organizationId: 9, createdBy: { id: 11 }, organizationFileId: 102 };
      file = { id: 102, name: body.name, organizationId: 9, active: false, isProject: true };
      events.push('reserve');
      return reply({ project, status: 'pending', creation: { transport: 'durable-operation', expectedRevision: 0 } }, 202);
    }
    if (path.endsWith('/save-operations') && method === 'POST') {
      // Inject the actual asynchronous observer failure through the transport
      // seam after a real suite reservation, without launching a live browser.
      events.push('callback-fault');
      return fault === 'observation' ? observedFailure() : routingFailure();
    }
    throw new Error(`Unexpected synthetic route: ${method} ${path}`);
  };
  t.mock.method(process.stdout, 'write', () => true);
  const runId = '12345678-1234-4234-8234-123456789abc';
  const credentials = { creator: { email: 'creator@example.test', password: 'synthetic' },
    manualInventory: { schemaVersion: 1, kind: 'qa-before-inventory', suite: manifest.id, expectedCommit: sha, runId, workflowRunId: '123456789', workflowRunAttempt: 1, administratorUserId: 12,
      organization, capturedAt: new Date().toISOString(), origin: 'https://maono-kepler-v1.pages.dev', inventory: { projects: [], files: [] } } };
  const reportPath = join(directory, 'report.json');
  const code = await main(['--mode', 'run', '--suite', manifest.id, '--organization-id', '9', '--expected-commit', sha, '--report', reportPath],
    { GITHUB_RUN_ID: '123456789', GITHUB_RUN_ATTEMPT: '1', MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN: 'synthetic', MAONO_ACCEPTANCE_QA_CREDENTIALS_JSON: JSON.stringify(credentials) }, { fetchImpl, sleep: async () => {} });
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  assert.equal(code, 1);
  assert.equal(report.error.code, fault === 'observation' ? 'PNG_BROWSER_REQUEST_UNVERIFIED' : 'PNG_BROWSER_ROUTE_FAILED');
  assert.equal(report.cleanupComplete, false);
  assert.equal(report.operationalTestsPassed, false);
  assert.equal(report.configurationRestored, true);
  assert.equal(report.ok, false); assert.equal(report.complete, false);
  assert.deepEqual(patches, [activeFlags(manifest), safeFlags(manifest)]);
  assert.deepEqual(events, ['activate', 'reserve', 'callback-fault', 'restore']);
  assert.equal(project.id, 101); assert.equal(file.active, false); assert.equal(file.isProject, true);
  assert.ok(report.cases.some(value => value.id === 'DS-CLEANUP' && value.status === 'PENDING_MANUAL'));
  assert.ok(report.cleanupErrors.some(value => value.code === 'MANUAL_CLEANUP_REQUIRED'));
  assert.equal(report.runId, runId);
  assert.equal(report.workflowRunId, '123456789'); assert.equal(report.workflowRunAttempt, 1);
  assert.equal(report.manualAdministration.resources[0].projectId, 101);
  assert.equal(report.manualAdministration.resources[0].organizationFileId, 102);
  assert.equal(appCalls.filter(call => call.path === '/api/auth/login').length, 1);
  assert.ok(!appCalls.some(call => call.path.startsWith('/api/admin/') || ['DELETE', 'PATCH'].includes(call.method)));
  assert.doesNotMatch(JSON.stringify(report), /SYNTHETIC_PRIVATE|password|maono_session=synthetic/);
});


test('image cache evidence requires exact directives and Vary names, not substring lookalikes', () => {
  for (const headers of [
    { cache: 'private, no-cache', vary: 'Cookie, Authorization' },
    { cache: ' No-Cache, PRIVATE ', vary: 'authorization, COOKIE, Origin' },
  ]) assert.doesNotThrow(() => verifyPrivateImageCache(headers));
  for (const headers of [
    { cache: 'public, not-private, x-no-cache', vary: 'Cookie, Authorization' },
    { cache: 'private, x-no-cache', vary: 'Cookie, Authorization' },
    { cache: 'not-private, no-cache', vary: 'Cookie, Authorization' },
    { cache: 'private, no-cache, public', vary: 'Cookie, Authorization' },
    { cache: 'private=Cookie, no-cache', vary: 'Cookie, Authorization' },
    { cache: 'private, no-cache', vary: 'Not-Cookie, Not-Authorization' },
    { cache: 'private, no-cache', vary: 'Cookie, Not-Authorization' },
    { cache: 'private, no-cache', vary: 'Not-Cookie, Authorization' },
  ]) assert.throws(() => verifyPrivateImageCache(headers));
});


test('PNG acceptance specs stay exclusively in their flagged compiled browser gate', async () => {
  const development = await readFile(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  const dedicated = await readFile(new URL('../playwright.production-acceptance.config.ts', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/acceptance-preview-validation.yml', import.meta.url), 'utf8');
  assert.match(development, /testIgnore:[^\n]*"\*\*\/production-acceptance-preview\.spec\.ts"/);
  assert.match(dedicated, /testMatch: 'production-acceptance-preview\.spec\.ts'/);
  assert.match(dedicated, /127\.0\.0\.1:4187/);
  assert.match(workflow, /playwright test --config=playwright\.production-acceptance\.config\.ts/);
  assert.match(workflow, /VITE_PROJECT_PREVIEW_OPERATIONS_V1: 'true'/);
  assert.match(workflow, /'playwright\.config\.ts'/);
});
