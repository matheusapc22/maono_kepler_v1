import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { cfRequest } from './production-acceptance-lib.mjs';
import { cc07Digest as fingerprint } from './cc07-infrastructure.mjs';
import { createOrganizationTestRestoration } from './organization-test-restoration.mjs';
import { EXECUTORS } from './organization-window.mjs';

export const account = '1988481e4c75c760516161104b7e1e50';
const root = '/client/v4/accounts/' + account;
export const fixtures = Object.freeze([
  { name: 'maono-ac01-test-pages', type: 'pages', a: '31daab70-9b9f-4b53-b757-36b66edf4b41', b: '178a6c23-8f11-459b-957c-7f8af3c95497' },
  { name: 'maono-ac01-test-deletion', type: 'worker', a: '46a021cc-8b95-4f5d-b19e-fba42b951fbe', b: 'd1c82c78-3b7e-404e-9213-a97ae57d4d0f' },
  { name: 'maono-ac01-test-recovery', type: 'worker', a: 'eb1431cb-0c5d-4aca-bb41-6d1725eced11', b: '4b1e54d4-06e1-424b-95aa-72401fcc8b4f' },
].map(Object.freeze));

function requireEvidence(ok, code) {
  if (!ok) throw new Error('B1_' + code);
}
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const empty = value => value === null || (isRecord(value) && Object.keys(value).length === 0);
const domain = f => f.name + (f.type === 'pages' ? '.pages.dev' : '.ma-no-ensaios.workers.dev');
const path = f => root + (f.type === 'pages' ? '/pages/projects/' : '/workers/scripts/') + f.name;

function pagesSnapshot(f, project, versions, customDomains) {
  requireEvidence(project?.name === f.name && project.subdomain === domain(f) && project.id &&
    project.production_branch === 'main' && !project.source && Array.isArray(customDomains) &&
    !customDomains.length, 'PAGES_IDENTITY');
  const config = project.deployment_configs?.production;
  requireEvidence(isRecord(config), 'PAGES_CONFIG_MISSING');
  const permitted = new Set(['env_vars', 'compatibility_date', 'compatibility_flags',
    'always_use_latest_compatibility_date', 'build_image_major_version', 'build_image_auto_upgrade',
    'usage_model', 'fail_open', 'placement', 'limits', 'smart_placement', 'wrangler_config_hash',
    'deployment_trigger', 'preview_deployment_setting', 'production_branch', 'production_deployments_enabled']);
  for (const [key, value] of Object.entries(config)) {
    if (permitted.has(key) && key !== 'env_vars') continue;
    requireEvidence(empty(value) || (Array.isArray(value) && !value.length), 'PAGES_BINDINGS');
  }
  const ids = [f.a, f.b];
  const configs = versions.map((v, i) => {
    requireEvidence(v?.id === ids[i] && v.project_id === project.id && v.project_name === f.name &&
      v.environment === 'production' && v.latest_stage?.name === 'deploy' && v.latest_stage.status === 'success' &&
      v.is_skipped === false && v.uses_functions === false && empty(v.env_vars) &&
      new URL(v.url).origin === 'https://' + ids[i].slice(0, 8) + '.' + domain(f), 'PAGES_VERSION');
    return { build: v.build_config, env: v.env_vars, functions: v.uses_functions, config };
  });
  requireEvidence(fingerprint(configs[0]) === fingerprint(configs[1]), 'PAGES_CONFIG_DIFF');
  const live = project.canonical_deployment;
  requireEvidence(ids.includes(live?.id) && live.latest_stage?.status === 'success' &&
    live.latest_stage.name === 'deploy', 'PAGES_ACTIVE');
  return { deployment: live.id, configuration: fingerprint(configs[0]) };
}

function workerSnapshot(f, active, versions, schedules, subdomain) {
  const ids = [f.a, f.b];
  const deployment = active?.deployments?.[0];
  const traffic = deployment?.versions;
  requireEvidence(deployment?.strategy === 'percentage' && traffic?.length === 1 &&
    traffic[0].percentage === 100 && ids.includes(traffic[0].version_id), 'WORKER_TRAFFIC');
  requireEvidence(subdomain?.enabled === true && Array.isArray(schedules?.schedules) &&
    !schedules.schedules.length, 'WORKER_TRIGGERS');
  const configs = versions.map((v, i) => {
    const resources = v?.resources;
    requireEvidence(v?.id === ids[i] && Array.isArray(resources?.bindings) && resources.bindings.length === 0 &&
      isRecord(resources.script_runtime) && resources.script_runtime.compatibility_date &&
      resources.script?.handlers?.length === 1 && resources.script.handlers[0] === 'fetch' &&
      !resources.script.named_handlers?.length, 'WORKER_CONFIG');
    // The script etag and upload tool describe the fixture code, not its configuration.
    const { script, ...settings } = resources;
    return { settings, handlers: script.handlers, named: script.named_handlers ?? [], subdomain };
  });
  requireEvidence(fingerprint(configs[0]) === fingerprint(configs[1]), 'WORKER_CONFIG_DIFF');
  return { deployment: traffic[0].version_id, configuration: fingerprint(configs[0]) };
}

export function cloudflareSandbox(token, fetchImpl = fetch) {
  const api = (url, options) => cfRequest(token, url, { fetchImpl, ...options });
  return {
    async observe(f) {
      requireEvidence(fixtures.includes(f), 'TARGET');
      const base = path(f);
      if (f.type === 'pages') {
        const [project, a, b, domains] = await Promise.all([api(base), api(base + '/deployments/' + f.a),
          api(base + '/deployments/' + f.b), api(base + '/domains')]);
        return pagesSnapshot(f, project, [a, b], domains);
      }
      const [live, a, b, schedules, subdomain] = await Promise.all([api(base + '/deployments'),
        api(base + '/versions/' + f.a), api(base + '/versions/' + f.b), api(base + '/schedules'),
        api(base + '/subdomain')]);
      return workerSnapshot(f, live, [a, b], schedules, subdomain);
    },
    async isolate() {
      // Token scope must include Zone Read for every zone in this isolated account.
      for (let page = 1; ; page++) {
        const zones = await api('/client/v4/zones?account.id=' + account + '&per_page=50&page=' + page);
        requireEvidence(Array.isArray(zones), 'ZONES');
        for (const zone of zones) {
          requireEvidence(zone.account?.id === account && /^[a-f0-9]{32}$/.test(zone.id), 'ZONE_IDENTITY');
          const routes = await api('/client/v4/zones/' + zone.id + '/workers/routes');
          requireEvidence(Array.isArray(routes) && !routes.some(route => fixtures.some(f => route.script === f.name)),
            'WORKER_ROUTES');
        }
        if (zones.length < 50) break;
      }
      const domains = await api(root + '/workers/domains');
      requireEvidence(Array.isArray(domains) && domains.every(d => typeof d?.service === 'string' &&
        !fixtures.some(f => f.name === d.service)), 'CUSTOM_DOMAINS');
    },
    async select(f, id) {
      requireEvidence(fixtures.includes(f) && (id === f.a || id === f.b), 'TARGET');
      if (f.type === 'pages') {
        await api(path(f) + '/deployments/' + id + '/rollback', { method: 'POST' });
      } else {
        await api(path(f) + '/deployments', { method: 'POST', body: {
          strategy: 'percentage', versions: [{ version_id: id, percentage: 100 }],
        } });
      }
    },
    async marker(f, id) {
      requireEvidence(fixtures.includes(f) && (id === f.a || id === f.b), 'TARGET');
      const expected = id === f.a ? 'B1-A' : 'B1-B';
      const url = 'https://' + domain(f) + '/?b1=' + randomUUID();
      const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) return false;
      const body = (await response.text()).trim();
      if (f.type === 'worker') return body === expected;
      return body.includes('<p>' + expected + '</p>') && body.includes('<title>' + expected + '</title>');
    },
  };
}

export async function rehearse({ mode, sha, expectedDigest, transport, record, pause = sleep }) {
  requireEvidence(['preflight', 'run', 'closure'].includes(mode) && /^[a-f0-9]{40}$/.test(sha), 'INVOCATION');
  await transport.isolate();
  const initial = await Promise.all(fixtures.map(f => transport.observe(f)));
  const targets = Object.fromEntries(fixtures.map((f, i) => [EXECUTORS[i], {
    name: f.name, type: f.type,
    baseline: { deployment: f.a, configuration: initial[i].configuration },
    staged: { deployment: f.b, configuration: initial[i].configuration },
  }]));
  const digest = fingerprint({ sha, account, targets });
  const read = async f => {
    const observed = await transport.observe(f);
    requireEvidence(observed.configuration === targets[EXECUTORS[fixtures.indexOf(f)]].baseline.configuration,
      'CONFIG_DRIFT');
    return observed;
  };
  async function confirm(f, id) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const observed = await read(f);
      const matches = observed.deployment === id && await transport.marker(f, id);
      if (matches) return;
      if (attempt < 11) await pause(2000);
    }
    throw new Error('B1_READBACK');
  }
  const observePhase = async (phase, ids) => {
    const reads = await Promise.allSettled(fixtures.map((f, i) => confirm(f, ids[i])));
    const observations = fixtures.map((f, i) => ({ name: f.name, id: ids[i], ok: reads[i].status === 'fulfilled' }));
    await record({ phase, digest, observations });
    requireEvidence(observations.every(o => o.ok), 'PHASE_' + phase);
  };
  const initialIds = initial.map(row => row.deployment);
  await record({ phase: 'inventory', account, digest, fixtures: Object.values(targets) });
  if (mode !== 'closure') requireEvidence(fixtures.every((f, i) => initialIds[i] === f.a), 'BASELINE');
  if (mode === 'closure') {
    // An unhealthy B marker must never prevent a separate recovery of a known deployment.
    await record({ phase: 'initialRecovery', digest, observations: initial.map((row, i) =>
      ({ name: fixtures[i].name, ...row })) });
  } else {
    await observePhase('initial', initialIds);
  }
  if (mode === 'preflight') return digest;
  requireEvidence(digest === expectedDigest, 'UNAPPROVED_DIGEST');
  async function change(f, from, to) {
    await transport.isolate();
    const observed = await read(f);
    requireEvidence(observed.deployment === from, 'DEPLOYMENT_DRIFT');
    await record({ phase: 'intent', target: f.name, from, to });
    await transport.select(f, to);
    await confirm(f, to);
  }
  const lookup = name => fixtures.find(f => f.name === name);
  const adapter = createOrganizationTestRestoration({ account, targets }, {
    async read({ name }) {
      const f = lookup(name);
      return { ...await read(f), account, name, type: f.type, terminal: true };
    },
    async restore({ name, from, to }) { await change(lookup(name), from.deployment, to.deployment); },
  });
  try {
    if (mode === 'run') {
      for (const f of fixtures) await change(f, f.a, f.b);
      await observePhase('staged', fixtures.map(f => f.b));
    }
  } finally {
    // Reconcile from independent live reads after partial staging or an ambiguous response.
    const beforeRestore = await Promise.all(fixtures.map(read));
    await record({ phase: 'beforeRestore', digest, observations: beforeRestore.map((row, i) =>
      ({ name: fixtures[i].name, ...row })) });
    const results = await Promise.allSettled(EXECUTORS.map(key => adapter.restore(key, targets[key].baseline)));
    await observePhase('final', fixtures.map(f => f.a));
    requireEvidence(results.every(r => r.status === 'fulfilled'), 'RESTORE_INCOMPLETE');
  }
  return digest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { B1_MODE: mode, GITHUB_SHA: sha, B1_BASELINE: expectedDigest, B1_REPORT: output } = process.env;
  const report = { mode, sha, account, run: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    functionalAcceptance: false, status: 'started', events: [] };
  const save = () => writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  // Serialize durable evidence writes even when the three restorations run concurrently.
  let pending = Promise.resolve();
  try {
    await save();
    report.digest = await rehearse({ mode, sha, expectedDigest, transport: cloudflareSandbox(process.env.B1_CF_TOKEN),
      record(event) {
        report.events.push({ ...event, at: new Date().toISOString() });
        pending = pending.then(save);
        return pending;
      } });
    report.status = 'verified';
    console.log('B1 configuration digest: ' + report.digest);
  } catch (error) {
    report.status = 'incomplete';
    report.error = /^B1_[A-Z_a-z]+$/.test(error.message) ? error.message : 'PROVIDER_OR_READBACK_ERROR';
    console.error('B1: ' + report.error);
    process.exitCode = 1;
  }
  await pending;
  await save();
}
