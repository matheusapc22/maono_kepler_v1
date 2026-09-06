import { appendFileSync } from 'node:fs';
import { buildProjectChangeProposal } from '../../functions/_lib/project-change-request-operations.js';
import { dropboxContentHashHex } from '../../functions/_lib/dropbox-content-hash.js';

const baseUrl = normalizeBaseUrl(process.env.MAONO_PREVIEW_BASE_URL);
const projectSlug = String(process.env.MAONO_ACCEPTANCE_QA_PROJECT_SLUG || '').trim();
const viewerCookie = normalizeCookie(process.env.MAONO_PREVIEW_VIEWER_SESSION_COOKIE, 'MAONO_PREVIEW_VIEWER_SESSION_COOKIE');
const reviewerCookie = normalizeCookie(process.env.MAONO_PREVIEW_REVIEWER_SESSION_COOKIE, 'MAONO_PREVIEW_REVIEWER_SESSION_COOKIE');
const baseRevision = Number(process.env.MAONO_ACCEPTANCE_BASE_REVISION);
const evidence = [];

if (!/^qa-smoke-[a-z0-9-]{3,80}$/.test(projectSlug)) {
  throw new Error('Acceptance project must be a disposable qa-smoke-* project');
}
if (!Number.isInteger(baseRevision) || baseRevision < 0) {
  throw new Error('MAONO_ACCEPTANCE_BASE_REVISION is unavailable or invalid');
}
if (viewerCookie === reviewerCookie) {
  throw new Error('Viewer and Reviewer acceptance sessions must be distinct');
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || '').trim());
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('MAONO_PREVIEW_BASE_URL must be an HTTPS origin without embedded credentials');
  }
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function normalizeCookie(value, name) {
  const cookie = String(value || '').trim();
  if (!/^maono_session=[^;\s]+$/.test(cookie)) {
    throw new Error(`${name} is unavailable or not an isolated maono_session cookie`);
  }
  return cookie;
}

function record(message) {
  evidence.push(message);
  console.log(message);
}

function appendEnv(name, value) {
  if (!process.env.GITHUB_ENV) return;
  appendFileSync(process.env.GITHUB_ENV, `${name}=${String(value)}\n`);
}

async function api(path, {
  cookie,
  method = 'GET',
  headers = {},
  body = undefined,
  expected = null,
} = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    redirect: 'manual',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      Cookie: cookie,
      ...headers,
    },
    body,
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null;
  const expectedStatuses = expected == null ? null : new Set(Array.isArray(expected) ? expected : [expected]);
  if (!response.ok || (expectedStatuses && !expectedStatuses.has(response.status)) || payload?.ok === false) {
    const code = String(payload?.error?.code || 'HTTP_ERROR');
    throw new Error(`Acceptance request failed: ${method} ${path} -> HTTP ${response.status} (${code})`);
  }
  return { response, payload };
}

function collectionPath() {
  return `/api/projects/${encodeURIComponent(projectSlug)}/change-requests`;
}

function requestPath(requestId, suffix = '') {
  return `${collectionPath()}/${encodeURIComponent(requestId)}${suffix}`;
}

function findTracked(items, id) {
  return (Array.isArray(items) ? items : []).find(item => item?.id === id) || null;
}

const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const sourceKey = `qa-release-source-${suffix}`;
const resubmitKey = `qa-release-resubmit-${suffix}`;
const feedback = `QA release gate rejection ${suffix}`;
const approveFeedback = `QA release gate approval ${suffix}`;
const operation = {
  id: `op_qa_${suffix}`,
  type: 'point.create',
  version: 1,
  payload: {
    latitude: -15.78,
    longitude: -47.92,
    targetMode: 'new',
    targetDataId: `qa-release-data-${suffix}`,
    targetLayerId: `qa-release-layer-${suffix}`,
    targetLabel: `QA Release ${suffix}`,
    tempId: `qa-release-point-${suffix}`,
    properties: {
      name: `QA release point ${suffix}`,
      source: 'change-request-production-acceptance',
    },
  },
  createdAt: new Date().toISOString(),
};
const sourceSubmission = {
  baseRevision,
  reason: `QA release gate source ${suffix}`,
  operations: [operation],
};

const sourceResult = await api(collectionPath(), {
  cookie: viewerCookie,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': sourceKey,
  },
  body: JSON.stringify(sourceSubmission),
  expected: 201,
});
const sourceId = String(sourceResult.payload?.changeRequest?.id || '').trim();
if (!sourceId) throw new Error('Viewer submission did not return a Change Request id');
record('Viewer session created the disposable QA Change Request.');

const rejectBody = JSON.stringify({ action: 'reject', comment: feedback });
let rejectResult = await api(requestPath(sourceId, '/review'), {
  cookie: reviewerCookie,
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: rejectBody,
});
if (rejectResult.payload?.review?.changeRequest?.status !== 'rejected' ||
    rejectResult.payload?.review?.changeRequest?.feedback !== feedback) {
  throw new Error('Reviewer rejection did not persist canonical feedback');
}
rejectResult = await api(requestPath(sourceId, '/review'), {
  cookie: reviewerCookie,
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: rejectBody,
});
if (rejectResult.payload?.review?.changeRequest?.status !== 'rejected' ||
    rejectResult.payload?.review?.changeRequest?.feedback !== feedback) {
  throw new Error('Reviewer rejection retry was not idempotent');
}
record('Reviewer rejection + feedback retry is idempotent.');

let tracking = await api(`${collectionPath()}/tracking?limit=50`, { cookie: viewerCookie });
let sourceTracked = findTracked(tracking.payload?.items, sourceId);
if (!sourceTracked || sourceTracked.status !== 'rejected' || sourceTracked.feedback !== feedback) {
  throw new Error('Viewer tracking did not expose the canonical rejection feedback');
}
record('Viewer tracking exposes rejection status and feedback.');

const correctedOperation = {
  ...operation,
  id: `op_qa_corrected_${suffix}`,
  payload: {
    ...operation.payload,
    latitude: -15.7799,
    longitude: -47.9199,
    targetDataId: `qa-release-corrected-data-${suffix}`,
    targetLayerId: `qa-release-corrected-layer-${suffix}`,
    targetLabel: `QA Release corrected ${suffix}`,
    tempId: `qa-release-corrected-point-${suffix}`,
    properties: {
      ...operation.payload.properties,
      corrected: true,
    },
  },
  createdAt: new Date().toISOString(),
};
const correctionSubmission = {
  baseRevision,
  reason: `QA release correction ${suffix}`,
  operations: [correctedOperation],
};
const resubmitHeaders = {
  'Content-Type': 'application/json',
  'Idempotency-Key': resubmitKey,
};
let resubmitResult = await api(requestPath(sourceId, '/resubmit'), {
  cookie: viewerCookie,
  method: 'POST',
  headers: resubmitHeaders,
  body: JSON.stringify(correctionSubmission),
  expected: 201,
});
const childId = String(resubmitResult.payload?.changeRequest?.id || '').trim();
if (!childId || resubmitResult.payload?.changeRequest?.resubmittedFromRequestId !== sourceId) {
  throw new Error('Resubmission did not create a linked child request');
}
resubmitResult = await api(requestPath(sourceId, '/resubmit'), {
  cookie: viewerCookie,
  method: 'POST',
  headers: resubmitHeaders,
  body: JSON.stringify(correctionSubmission),
  expected: 200,
});
if (resubmitResult.payload?.replayed !== true || resubmitResult.payload?.changeRequest?.id !== childId) {
  throw new Error('Resubmission retry did not converge to the original child request');
}
tracking = await api(`${collectionPath()}/tracking?limit=50`, { cookie: viewerCookie });
sourceTracked = findTracked(tracking.payload?.items, sourceId);
const childTracked = findTracked(tracking.payload?.items, childId);
if (sourceTracked?.resubmittedToRequestId !== childId || childTracked?.resubmittedFromRequestId !== sourceId) {
  throw new Error('Viewer tracking did not expose immutable resubmission lineage');
}
record('Resubmission lineage and idempotent replay are visible to the Viewer.');

await api(requestPath(childId, '/review'), {
  cookie: reviewerCookie,
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'start' }),
});
const approveBody = JSON.stringify({ action: 'approve', comment: approveFeedback });
let approveResult = await api(requestPath(childId, '/review'), {
  cookie: reviewerCookie,
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: approveBody,
});
if (approveResult.payload?.review?.changeRequest?.status !== 'approved') {
  throw new Error('Reviewer approval did not reach approved state');
}
approveResult = await api(requestPath(childId, '/review'), {
  cookie: reviewerCookie,
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: approveBody,
});
const approved = approveResult.payload?.review?.changeRequest;
if (approved?.status !== 'approved' || approved?.feedback !== approveFeedback) {
  throw new Error('Approval retry did not preserve the canonical decision');
}
const lifecycleVersion = Number(approved.lifecycleVersion);
if (!Number.isInteger(lifecycleVersion) || lifecycleVersion < 1) {
  throw new Error('Approved Change Request did not expose a valid lifecycle version');
}
record('Reviewer start/approve flow is canonical and approval retry is idempotent.');

const configResult = await api(`/api/projects/${encodeURIComponent(projectSlug)}/config`, {
  cookie: reviewerCookie,
});
const baseConfig = configResult.payload?.config;
if (!baseConfig || typeof baseConfig !== 'object' || Array.isArray(baseConfig)) {
  throw new Error('QA project base MapConfig is unavailable');
}
const proposal = buildProjectChangeProposal({
  baseConfig,
  operations: [correctedOperation],
});
const serialized = JSON.stringify(proposal.config);
const bytes = new TextEncoder().encode(serialized);
const checksum = await dropboxContentHashHex(bytes);
const configVersion = String(proposal.config?.version || '').trim();
if (!configVersion || !/^[a-f0-9]{64}$/.test(checksum)) {
  throw new Error('Generated QA proposal is missing config version or checksum');
}

const applyHeaders = {
  'Content-Type': 'application/vnd.maono.map-config+json; charset=utf-8',
  'X-Maono-Large-Config': '1',
  'X-Maono-Expected-Revision': String(baseRevision),
  'X-Maono-Config-Size': String(bytes.byteLength),
  'X-Maono-Dataset-Count': String(Array.isArray(proposal.config.datasets) ? proposal.config.datasets.length : 0),
  'X-Maono-Config-Schema': 'legacy-kepler',
  'X-Maono-Config-Schema-Version': '1',
  'X-Maono-Config-Version': configVersion,
  'X-Maono-Config-Checksum': checksum,
  'X-Maono-Change-Request-Version': String(lifecycleVersion),
};
let applyResult = await api(requestPath(childId, '/apply'), {
  cookie: reviewerCookie,
  method: 'POST',
  headers: applyHeaders,
  body: bytes,
});
const appliedRevision = Number(applyResult.payload?.appliedRevision);
if (appliedRevision !== baseRevision + 1 || applyResult.payload?.review?.changeRequest?.status !== 'applied') {
  throw new Error('Streaming Apply did not publish the expected next revision');
}
applyResult = await api(requestPath(childId, '/apply'), {
  cookie: reviewerCookie,
  method: 'POST',
  headers: applyHeaders,
  body: bytes,
});
if (applyResult.payload?.idempotent !== true || Number(applyResult.payload?.appliedRevision) !== appliedRevision) {
  throw new Error('Streaming Apply retry did not return the canonical applied revision');
}
record('Streaming Apply published exactly one revision and retry is idempotent.');

tracking = await api(`${collectionPath()}/tracking?limit=50`, { cookie: viewerCookie });
const appliedTracked = findTracked(tracking.payload?.items, childId);
if (appliedTracked?.status !== 'applied' || Number(appliedTracked?.appliedRevision) !== appliedRevision) {
  throw new Error('Viewer tracking did not observe the applied resubmission');
}
record('Viewer tracking observes the final applied lifecycle state.');

appendEnv('MAONO_ACCEPTANCE_SOURCE_REQUEST_ID', sourceId);
appendEnv('MAONO_ACCEPTANCE_RESUBMISSION_ID', childId);
appendEnv('MAONO_ACCEPTANCE_ARTIFACT_CHECKSUM', checksum);
appendEnv('MAONO_ACCEPTANCE_APPLIED_REVISION', appliedRevision);
record('Authenticated Change Request production acceptance passed inside disposable QA scope.');

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, evidence.map(line => `- ${line}`).join('\n') + '\n');
}
