import { appendFileSync } from 'node:fs';

const account = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();
const evidence = [];

if (!account || !token) {
  throw new Error('Required Cloudflare Repository Secrets are unavailable');
}

function record(message) {
  evidence.push(message);
  console.log(message);
}

function normalizeBaseUrl(value, label) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error(`${label} is required`);
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${label} must be an HTTPS origin without embedded credentials`);
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

async function cloudflareApi(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Cloudflare API request failed: HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!body.success) throw new Error('Cloudflare API reported an unsuccessful request');
  return body.result;
}

async function checkHealth(baseUrl, expectedRuntime, { requirePreviewClosed = false } = {}) {
  const response = await fetch(`${baseUrl}/api/health`, {
    redirect: 'manual',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${expectedRuntime} health returned HTTP ${response.status}`);
  const body = await response.json();
  if (body?.runtime?.runtime !== expectedRuntime) {
    throw new Error(`${expectedRuntime} health reported an unexpected runtime`);
  }
  for (const key of [
    'dbBinding',
    'databaseReachable',
    'changeRequestLifecycleReady',
    'changeRequestApplyArtifactReady',
    'changeRequestResubmissionReady',
  ]) {
    if (body?.checks?.[key] !== true) {
      throw new Error(`${expectedRuntime} health gate failed: ${key}`);
    }
  }
  if (requirePreviewClosed && body?.runtime?.previewMutationsEnabled !== false) {
    throw new Error('Preview mutation kill switch is not confirmed fail-closed');
  }
  record(`${expectedRuntime} health confirms D1 and Change Request stack readiness${requirePreviewClosed ? ' with Preview mutations disabled' : ''}.`);
}

try {
  const databases = await cloudflareApi('d1/database?per_page=100');
  const matches = databases.filter(database => database.name === 'maono_maps');
  if (matches.length !== 1) {
    throw new Error('Expected exactly one maono_maps database in configured account');
  }
  const database = matches[0];

  const pages = await cloudflareApi('pages/projects/maono-kepler-v1');
  const productionBinding = pages.deployment_configs?.production?.d1_databases?.DB?.id;
  const previewBinding = pages.deployment_configs?.preview?.d1_databases?.DB?.id;
  if (productionBinding !== database.uuid || previewBinding !== database.uuid) {
    throw new Error('Production and Preview DB bindings must both point to the audited maono_maps D1');
  }
  record('Cloudflare bindings remain pinned to the audited maono_maps D1.');

  const previewVars = pages.deployment_configs?.preview?.env_vars || {};
  const configuredQaId = String(previewVars.MAONO_PREVIEW_QA_ORG_ID?.value || '').trim();
  const configuredQaSlug = String(previewVars.MAONO_PREVIEW_QA_ORG_SLUG?.value || '').trim();
  const configuredRuntime = String(previewVars.MAONO_RUNTIME_ENV?.value || '').trim();
  const configuredMutations = String(previewVars.MAONO_PREVIEW_MUTATIONS_ENABLED?.value || '').trim();

  if (!configuredQaId || configuredQaSlug !== 'maono-preview-qa' || configuredRuntime !== 'preview') {
    throw new Error('Preview QA scope/runtime configuration is incomplete');
  }
  if (configuredMutations !== 'false') {
    throw new Error('Preview mutation kill switch must be explicitly false before release closure');
  }
  record('Cloudflare Pages configuration confirms MAONO_PREVIEW_MUTATIONS_ENABLED=false.');

  const previewBaseUrl = normalizeBaseUrl(process.env.MAONO_PREVIEW_BASE_URL, 'MAONO_PREVIEW_BASE_URL');
  const productionBaseUrl = normalizeBaseUrl(process.env.MAONO_PRODUCTION_BASE_URL, 'MAONO_PRODUCTION_BASE_URL');
  await checkHealth(previewBaseUrl, 'preview', { requirePreviewClosed: true });
  await checkHealth(productionBaseUrl, 'production');

  record('Change Request release window is verified closed; no remote mutation was performed.');
} finally {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, evidence.map(line => `- ${line}`).join('\n') + '\n');
  }
}
