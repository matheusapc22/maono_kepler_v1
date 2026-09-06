import { appendFileSync } from 'node:fs';

const baseUrl = normalizeBaseUrl(process.env.MAONO_PREVIEW_BASE_URL);
const projectSlug = String(process.env.MAONO_ACCEPTANCE_QA_PROJECT_SLUG || '').trim();
const viewerCookie = normalizeCookie(
  process.env.MAONO_PREVIEW_VIEWER_SESSION_COOKIE,
  'MAONO_PREVIEW_VIEWER_SESSION_COOKIE',
);
const reviewerCookie = normalizeCookie(
  process.env.MAONO_PREVIEW_REVIEWER_SESSION_COOKIE,
  'MAONO_PREVIEW_REVIEWER_SESSION_COOKIE',
);
const evidence = [];

if (!/^qa-smoke-[a-z0-9-]{3,80}$/.test(projectSlug)) {
  throw new Error('QA identity preflight requires a disposable qa-smoke-* project');
}
if (viewerCookie === reviewerCookie) {
  throw new Error('Viewer and Reviewer session cookies must be distinct');
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

async function loadSession(cookie, label) {
  const response = await fetch(`${baseUrl}/api/session`, {
    method: 'GET',
    redirect: 'manual',
    cache: 'no-store',
    headers: { Accept: 'application/json', Cookie: cookie },
  });
  if (!response.ok) {
    throw new Error(`${label} session preflight returned HTTP ${response.status}`);
  }
  const body = await response.json().catch(() => null);
  if (!body?.authenticated || !body?.user?.id) {
    throw new Error(`${label} session is not authenticated`);
  }
  if (body?.activeOrganization?.slug !== 'maono-preview-qa') {
    throw new Error(`${label} session is not scoped to Maõno Preview QA`);
  }
  const project = (Array.isArray(body.projects) ? body.projects : [])
    .find(item => item?.slug === projectSlug);
  if (!project) {
    throw new Error(`${label} session cannot access the disposable QA project`);
  }
  return { user: body.user, project };
}

const [viewer, reviewer] = await Promise.all([
  loadSession(viewerCookie, 'Viewer'),
  loadSession(reviewerCookie, 'Reviewer'),
]);

if (String(viewer.user.id) === String(reviewer.user.id)) {
  throw new Error('Viewer and Reviewer must be different authenticated users');
}
const viewerRole = String(viewer.user.role || '').trim().toLowerCase();
const viewerAccess = String(
  viewer.project.accessLevel || viewer.project.access_level || '',
).trim().toLowerCase();
if (viewerRole !== 'viewer' || viewerAccess !== 'viewer') {
  throw new Error('Viewer QA identity must resolve to the Viewer project route');
}

const reviewerRole = String(reviewer.user.role || '').trim().toLowerCase();
const reviewerAccess = String(
  reviewer.project.accessLevel || reviewer.project.access_level || '',
).trim().toLowerCase();
if (
  reviewerRole === 'viewer' ||
  !['editor', 'write', 'owner'].includes(reviewerAccess)
) {
  throw new Error('Reviewer QA identity must resolve to an Editor-capable project route');
}

record('Distinct Viewer and Reviewer QA identities are authenticated in Maõno Preview QA.');
record('Viewer route and Editor-capable Reviewer route are confirmed before any acceptance mutation.');

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    evidence.map(line => `- ${line}`).join('\n') + '\n',
  );
}
