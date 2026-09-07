import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const MIGRATION_CHECKSUMS = Object.freeze({
  '0021_change_request_lifecycle.sql': '96399c9e5ad98e3dbf5cb5adfdcfb3afe268d5ae683a68721a9cc24a7febd78a',
  '0022_change_request_apply_artifacts.sql': 'd1e3acce061263cc0d977583bd367b2a10ba7ac00c316ed100a29d5840d7da90',
  '0023_change_request_resubmissions.sql': 'c9b6f850f577ba792979bb7be8c3c7af00bf6c9c66ee5bbc95386f3e2aec9ef4',
});

export function verifyMigrationChecksums(read = name => readFileSync(`migrations/${name}`)) {
  for (const [name, expected] of Object.entries(MIGRATION_CHECKSUMS)) {
    if (createHash('sha256').update(read(name)).digest('hex') !== expected) {
      throw new Error(`Reviewed migration checksum mismatch: ${name}`);
    }
  }
}

// Cookies may only leave the runner for this Pages project's Preview origin.
// Reject credentials/path/query rather than including invalid input in errors.
export function previewOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Invalid Preview origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      url.pathname !== '/' || url.search || url.hash ||
      !/^[a-z0-9-]+\.maono-kepler-v1\.pages\.dev$/.test(url.hostname)) {
    throw new Error('Preview origin must belong to the audited maono-kepler-v1 Pages project');
  }
  return url.origin;
}

export const MIN_ACCEPTANCE_BYTES = 90 * 1024 * 1024;
export const MAX_ACCEPTANCE_BYTES = 100 * 1024 * 1024;
export function assertLargeAcceptanceSize(bytes) {
  if (!Number.isInteger(bytes) || bytes < MIN_ACCEPTANCE_BYTES || bytes > MAX_ACCEPTANCE_BYTES) {
    throw new Error('Release acceptance requires a persisted MapConfig between 90 and 100 MiB');
  }
}

export function assertReleaseHealth(response, body, expectedRuntime, { stack = true, mutations } = {}) {
  if (!response.ok || response.headers.get('X-Maono-Runtime-Env') !== expectedRuntime ||
      body?.service !== 'maono-kepler-v1' || body?.runtime?.runtime !== expectedRuntime) {
    throw new Error(`${expectedRuntime} health identity/runtime mismatch`);
  }
  const checks = ['dbBinding','databaseReachable','dropboxAppKey','dropboxAppSecret','dropboxRefreshToken'];
  if (stack) checks.push('changeRequestLifecycleReady','changeRequestApplyArtifactReady','changeRequestResubmissionReady');
  if (checks.some(key => body?.checks?.[key] !== true)) throw new Error(`${expectedRuntime} required health checks failed`);
  if (mutations !== undefined && body?.runtime?.previewMutationsEnabled !== mutations) {
    throw new Error('Preview mutation kill switch differs from the required phase');
  }
}

export async function verifyPreviewDeployment(origin, fetcher = fetch, env = process.env) {
  const base = previewOrigin(origin);
  const sha = env.VALIDATED_RELEASE_SHA || env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Validated release SHA is required before session use');
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) throw new Error('Cloudflare deployment verification credentials unavailable');
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/maono-kepler-v1/deployments?env=preview&per_page=100`, {
    redirect: 'manual', headers: {Authorization:`Bearer ${env.CLOUDFLARE_API_TOKEN}`},
  });
  if (!response.ok) throw new Error('Pages deployment verification failed');
  const data = await response.json();
  const deployment = data.success && Array.isArray(data.result) && data.result.find(item =>
    item.url === base || item.aliases?.includes(base));
  if (!deployment || deployment.environment !== 'preview' || deployment.latest_stage?.status !== 'success' ||
      deployment.deployment_trigger?.metadata?.commit_hash !== sha) {
    throw new Error('Preview deployment does not match the validated release SHA');
  }
}
