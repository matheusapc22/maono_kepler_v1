import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitRuntimeReadiness, RUNTIME_READINESS_LIMITS, PRODUCTION_APP_ORIGIN, PRODUCTION_D1_ID, activeFlags, safeFlags, transitionFlags, safeError } from '../scripts/acceptance/production-acceptance-lib.mjs';
import { createExecutionBudget, PHASE_BUDGET_MS } from '../scripts/acceptance/execution-budget.mjs';
import { manifest } from '../scripts/acceptance/suites/durable-project-save.mjs';
import { manifest as cc04 } from '../scripts/acceptance/suites/cc04-selective-access.mjs';
import { onRequest as health } from '../functions/api/health.js';
import { persistenceFixture } from './helpers/project-persistence-fixture.mjs';
import { main } from '../scripts/acceptance/operator.mjs';

const origin = PRODUCTION_APP_ORIGIN, sha = 'a'.repeat(40);
const ready = (enabled = true, inline = false) => ({ ok: true, service: 'maono-kepler-v1',
  checks: { dbBinding: true, databaseReachable: true },
  runtime: { runtime: 'production', durableProjectSaveEnabled: enabled, durableProjectSaveInlineEnabled: inline } });
const json = body => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
const noSleep = async () => {};

function controlPlane({ runtime = () => json(ready()), initial = safeFlags(manifest), subdomain = 'maono-kepler-v1.pages.dev', commit = sha } = {}) {
  let configured = initial, deployed = initial, id = 'original';
  const calls = [], writes = [];
  const entries = values => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { type: 'plain_text', value: String(value) }]));
  const deployment = () => ({ id, environment: 'production', url: 'https://deployment-hash.pages.dev',
    deployment_trigger: { metadata: { commit_hash: commit, commit_dirty: false } }, latest_stage: { name: 'deploy', status: 'success' }, env_vars: entries(deployed) });
  const fetchImpl = async (url, options) => {
    const parsed = new URL(url), method = options.method;
    calls.push({ url: parsed.href, method });
    if (parsed.origin === origin) return runtime(options);
    assert.equal(parsed.hostname, 'api.cloudflare.com');
    if (method === 'PATCH') {
      configured = Object.fromEntries(Object.entries(JSON.parse(options.body).deployment_configs.production.env_vars).map(([name, entry]) => [name, entry.value === 'true']));
      writes.push(method);
      return Response.json({ success: true, result: {} });
    }
    if (method === 'POST') { deployed = configured; id = 'retry'; writes.push(method); return Response.json({ success: true, result: { id } }); }
    if (parsed.pathname.endsWith('/deployments')) return Response.json({ success: true, result: [deployment()] });
    if (parsed.pathname.includes('/deployments/')) return Response.json({ success: true, result: deployment() });
    return Response.json({ success: true, result: { name: 'maono-kepler-v1', production_branch: 'mano_kepler_v1', subdomain,
      canonical_deployment: deployment(), deployment_configs: { production: { d1_databases: { DB: { id: PRODUCTION_D1_ID } }, env_vars: entries(configured) } } } });
  };
  return { fetchImpl, calls, writes };
}

test('runtime gate consumes the real health handler and SQLite without writing or exposing secret values', async t => {
  const f = persistenceFixture(t), statements = [];
  const original = f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = sql => { statements.push(sql); return original(sql); };
  Object.assign(f.env, { MAONO_RUNTIME_ENV: 'production', PROJECT_DURABLE_SAVE_V1: 'true', PROJECT_DURABLE_SAVE_INLINE_ENABLED: 'false',
    DROPBOX_APP_KEY: 'private-key', DROPBOX_APP_SECRET: 'private-secret', DROPBOX_REFRESH_TOKEN: 'private-refresh' });
  const fetchImpl = async (url, options) => {
    assert.equal(String(url), `${origin}/api/health`);
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    return health({ env: f.env, request: new Request(url, options) });
  };
  const active = await waitRuntimeReadiness(origin, manifest, activeFlags(manifest), { fetchImpl });
  assert.equal(active.state, 'matched'); assert.equal(active.durableProjectSaveEnabled, true);
  f.env.PROJECT_DURABLE_SAVE_V1 = 'false';
  f.env.PROJECT_DURABLE_SAVE_INLINE_ENABLED = 'true';
  const restored = await waitRuntimeReadiness(origin, manifest, safeFlags(manifest), { fetchImpl });
  assert.equal(restored.state, 'matched'); assert.equal(restored.durableProjectSaveEnabled, false);
  assert.equal(restored.durableProjectSaveInlineEnabled, true);
  assert.equal(restored.deploymentIdentityVerified, false); assert.equal(restored.previewFlagsVerified, false);
  assert.deepEqual(statements, ['SELECT 1 AS ok', 'SELECT 1 AS ok']);
  assert.doesNotMatch(JSON.stringify([active, restored]), /private-|dropbox|commit|deployment-hash/);
});

test('control-plane ON cannot admit runtime OFF; convergence only retries public GETs and never deployment mutations', async () => {
  let reads = 0;
  const f = controlPlane({ runtime: () => json(ready(++reads >= 3)) });
  const observations = [];
  const result = await transitionFlags({ token: 'private-control-token', sourceDeploymentId: 'original', commit: sha,
    manifest, values: activeFlags(manifest), deps: { fetchImpl: f.fetchImpl, sleep: noSleep }, onRuntimeObservation: value => observations.push(value) });
  assert.deepEqual(observations.map(row => row.state), ['flags_mismatch', 'flags_mismatch', 'matched']);
  assert.equal(result.runtimeReadiness.attempts, 3);
  assert.deepEqual(f.writes, ['PATCH', 'POST']);
  assert.deepEqual(f.calls.filter(row => row.url.endsWith('/api/health')), Array.from({ length: 3 }, () => ({ url: `${origin}/api/health`, method: 'GET' })));
  assert.ok(!f.calls.some(row => row.url.includes('deployment-hash')));
});

test('runtime mismatch, unhealthy, malformed, redirect and transport failures stay bounded and sanitized', async () => {
  const secret = 'private-secret-cookie-token';
  const variants = [
    ['flags_mismatch', () => json(ready(false))],
    ['flags_mismatch', () => json(ready(true, true))],
    ['unhealthy', () => json({ ...ready(), ok: false, message: secret })],
    ['unhealthy', () => json({ ...ready(), checks: { dbBinding: true, databaseReachable: false } })],
    ['runtime_mismatch', () => json({ ...ready(), runtime: { ...ready().runtime, runtime: 'preview' } })],
    ...[null, {}, { ...ready(), service: 'other' }, { ...ready(), runtime: { ...ready().runtime, durableProjectSaveEnabled: 'true' } },
      { ...ready(), runtime: { ...ready().runtime, durableProjectSaveInlineEnabled: 1 } }].map(body => ['invalid_response', () => json(body)]),
    ['invalid_response', () => new Response(`{${secret}`, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })],
    ['invalid_response', () => Response.json(ready())],
    ['invalid_response', () => new Response(secret, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } })],
    ['http_error', () => new Response(secret, { status: 503 })],
    ['http_error', () => new Response(null, { status: 302, headers: { Location: `https://other.test/${secret}` } })],
    ['invalid_response', () => { const response = json(ready()); Object.defineProperty(response, 'redirected', { value: true }); return response; }],
    ['invalid_response', () => { const response = json(ready()); Object.defineProperty(response, 'url', { value: 'https://other.test/api/health' }); return response; }],
    ['response_too_large', () => json({ ...ready(), message: secret.repeat(2000) })],
    ['response_too_large', () => new Response('{}', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': String(RUNTIME_READINESS_LIMITS.responseBytes + 1) } })],
    ['transport_error', () => { throw new Error(secret); }],
    ['transport_error', () => new Response(new ReadableStream({ pull(controller) { controller.error(new DOMException(secret, 'AbortError')); } }),
      { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })],
  ];
  for (const [state, response] of variants) {
    const observations = []; let calls = 0;
    await assert.rejects(() => waitRuntimeReadiness(origin, manifest, activeFlags(manifest), { sleep: noSleep,
      fetchImpl: async () => { calls++; return response(); }, onRuntimeObservation: value => observations.push(value) }), error => {
      assert.doesNotMatch(JSON.stringify(safeError(error)), new RegExp(secret));
      return error.code === 'PRODUCTION_RUNTIME_READINESS_FAILED';
    });
    assert.equal(calls, RUNTIME_READINESS_LIMITS.attempts, state);
    assert.equal(observations.at(-1).state, state);
    assert.doesNotMatch(JSON.stringify(observations), new RegExp(secret));
  }
});

test('hung fetch/body are bounded, abort is honored, and elapsed activation does not consume restoration allocation', async () => {
  for (const body of [false, true]) {
    const observations = [], signals = [];
    await assert.rejects(() => waitRuntimeReadiness(origin, manifest, activeFlags(manifest), { sleep: noSleep,
      budget: { assertActive() {}, requestTimeoutMs: () => 1, pause: noSleep }, onRuntimeObservation: row => observations.push(row),
      fetchImpl: async (_url, options) => { signals.push(options.signal); return body ? new Response(new ReadableStream({ pull() {} }),
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }) : new Promise(() => {}); },
    }), { code: 'PRODUCTION_RUNTIME_READINESS_FAILED' });
    assert.equal(observations.at(-1).state, 'request_timeout');
    assert.ok(signals.every(signal => signal.aborted));
  }
  for (const alreadyAborted of [false, true]) {
    const controller = new AbortController(); if (alreadyAborted) controller.abort();
    let calls = 0;
    await assert.rejects(() => waitRuntimeReadiness(origin, manifest, activeFlags(manifest), { signal: controller.signal,
      fetchImpl: async () => { calls++; controller.abort(); return new Promise(() => {}); }, sleep: noSleep }), { code: 'PRODUCTION_RUNTIME_READINESS_ABORTED' });
    assert.equal(calls, alreadyAborted ? 0 : 1);
  }
  let now = 0, calls = 0;
  const budget = createExecutionBudget(manifest, { now: () => now });
  budget.enter('preflight'); budget.enter('activation'); now = budget.phaseDeadline - 1;
  await assert.rejects(() => waitRuntimeReadiness(origin, manifest, activeFlags(manifest), { budget, now: () => now,
    fetchImpl: async () => { calls++; now++; return json(ready()); } }), { code: 'ACCEPTANCE_PHASE_TIMEOUT' });
  assert.equal(calls, 1);
  budget.enter('cleanup'); budget.enter('restoration');
  assert.equal(budget.remainingMs(), PHASE_BUDGET_MS.restoration);
  assert.equal((await waitRuntimeReadiness(origin, manifest, safeFlags(manifest), { budget, now: () => now, fetchImpl: async () => json(ready(false, true)) })).state, 'matched');
});

test('gate enforces total deadline and exact canonical origin, while unrelated manifests skip health', async () => {
  let now = 0, calls = 0;
  await assert.rejects(() => waitRuntimeReadiness(origin, manifest, activeFlags(manifest), { now: () => now,
    fetchImpl: async () => { calls++; now += RUNTIME_READINESS_LIMITS.timeoutMs; return json(ready()); } }), { code: 'PRODUCTION_RUNTIME_READINESS_FAILED' });
  assert.equal(calls, 1);
  for (const baseUrl of ['https://deployment-hash.pages.dev', `${origin}/path`, 'https://user:password@maono-kepler-v1.pages.dev']) {
    await assert.rejects(() => waitRuntimeReadiness(baseUrl, manifest, activeFlags(manifest), { fetchImpl: async () => assert.fail('must not fetch') }), { code: 'PRODUCTION_RUNTIME_ORIGIN_MISMATCH' });
  }
  const f = controlPlane({ subdomain: 'wrong.pages.dev' });
  await assert.rejects(() => transitionFlags({ token: 'synthetic', sourceDeploymentId: 'original', commit: sha,
    manifest, values: activeFlags(manifest), deps: { fetchImpl: f.fetchImpl } }), { code: 'PRODUCTION_RUNTIME_ORIGIN_MISMATCH' });
  assert.deepEqual(f.writes, []);
  const drift = controlPlane({ commit: 'b'.repeat(40) });
  await assert.rejects(() => transitionFlags({ token: 'synthetic', sourceDeploymentId: 'original', commit: sha,
    manifest, values: activeFlags(manifest), deps: { fetchImpl: drift.fetchImpl } }), { code: 'PRODUCTION_DEPLOYMENT_MISMATCH' });
  assert.deepEqual(drift.writes, []);
  assert.deepEqual(await waitRuntimeReadiness('https://other.test', cc04, activeFlags(cc04), { fetchImpl: async () => assert.fail('no health for CC04') }), { state: 'not_applicable' });
});

test('independent closure must verify runtime OFF/inline TRUE even when metadata is already safe', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'acceptance-runtime-closure-')); t.after(() => rm(dir, { recursive: true, force: true }));
  t.mock.method(process.stdout, 'write', () => true);
  for (const [enabled, inline, matched] of [[false, true, true], [true, true, false], [false, false, false]]) {
    const f = controlPlane({ runtime: () => json(ready(enabled, inline)) }), reportPath = join(dir, `report-${enabled}-${inline}.json`);
    assert.equal(await main(['--mode', 'closure', '--suite', manifest.id, '--organization-id', '9', '--expected-commit', sha, '--report', reportPath],
      { MAONO_ACCEPTANCE_CLOUDFLARE_API_TOKEN: 'synthetic' }, { fetchImpl: f.fetchImpl, sleep: noSleep }), 1);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.configurationRestored, matched);
    assert.equal(report.restorationRuntime.state, matched ? 'matched' : 'flags_mismatch');
    assert.equal(report.acceptanceExecuted, false); assert.equal(report.complete, false);
    assert.deepEqual(f.writes, []);
  }
});
