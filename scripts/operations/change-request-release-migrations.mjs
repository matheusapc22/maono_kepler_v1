import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const MIGRATIONS = Object.freeze([
  '0021_change_request_lifecycle.sql',
  '0022_change_request_apply_artifacts.sql',
  '0023_change_request_resubmissions.sql',
]);
const LIFECYCLE_COLUMNS = Object.freeze([
  'lifecycle_version',
  'decision',
  'feedback',
  'decided_by_user_id',
  'decided_at',
  'transition_actor_user_id',
  'applied_revision',
]);
const LIFECYCLE_OBJECTS = Object.freeze([
  'project_change_request_events',
  'trg_change_request_lifecycle_guard',
  'trg_change_request_lifecycle_sync',
  'trg_change_request_lifecycle_created',
  'trg_ticket_change_request_status_guard',
]);
const APPLY_OBJECTS = Object.freeze([
  'project_change_request_apply_artifacts',
  'trg_change_request_apply_artifact_immutable',
]);
const RESUBMISSION_OBJECTS = Object.freeze([
  'uq_project_change_request_resubmission_source',
  'trg_project_change_request_resubmission_immutable',
  'trg_project_change_request_resubmission_guard',
]);

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const previewBaseUrl = normalizeBaseUrl(
  process.env.MAONO_PREVIEW_BASE_URL,
  'MAONO_PREVIEW_BASE_URL',
);
const qaProjectSlug = String(process.env.MAONO_ACCEPTANCE_QA_PROJECT_SLUG || '').trim();
const viewerCookie = normalizeCookie(
  process.env.MAONO_PREVIEW_VIEWER_SESSION_COOKIE,
  'MAONO_PREVIEW_VIEWER_SESSION_COOKIE',
);
const reviewerCookie = normalizeCookie(
  process.env.MAONO_PREVIEW_REVIEWER_SESSION_COOKIE,
  'MAONO_PREVIEW_REVIEWER_SESSION_COOKIE',
);
const evidence = [];

if (!account || !token) {
  throw new Error('Required Cloudflare Repository Secrets are unavailable');
}
if (!/^qa-smoke-[a-z0-9-]{3,80}$/.test(qaProjectSlug)) {
  throw new Error('Migration gate requires the disposable qa-smoke-* project');
}
if (viewerCookie === reviewerCookie) {
  throw new Error('Viewer and Reviewer migration-gate sessions must be distinct');
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

async function cloudflareApi(path) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/${path}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) {
    throw new Error(`Cloudflare API request failed: HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!body.success) throw new Error('Cloudflare API reported an unsuccessful request');
  return body.result;
}

async function readSession(cookie, label) {
  const response = await fetch(`${previewBaseUrl}/api/session`, {
    method: 'GET',
    redirect: 'manual',
    cache: 'no-store',
    headers: { Accept: 'application/json', Cookie: cookie },
  });
  if (!response.ok) {
    throw new Error(`${label} QA session readiness returned HTTP ${response.status}`);
  }
  const body = await response.json().catch(() => null);
  if (!body?.authenticated || !body?.user?.id) {
    throw new Error(`${label} QA session is not authenticated`);
  }
  if (body?.activeOrganization?.slug !== 'maono-preview-qa') {
    throw new Error(`${label} QA session is not scoped to Maõno Preview QA`);
  }
  const project = (Array.isArray(body.projects) ? body.projects : [])
    .find(item => item?.slug === qaProjectSlug);
  if (!project) {
    throw new Error(`${label} QA session cannot access the disposable project`);
  }
  return { user: body.user, project };
}

function setEqualsPrefix(appliedNames) {
  const states = MIGRATIONS.map(name => appliedNames.has(name));
  const firstMissing = states.indexOf(false);
  if (firstMissing >= 0 && states.slice(firstMissing + 1).some(Boolean)) {
    throw new Error('Change Request migrations are not recorded as a contiguous 0021 -> 0023 prefix');
  }
}

function hasAll(set, values) {
  return values.every(value => set.has(value));
}

const directory = mkdtempSync(join(tmpdir(), 'maono-change-request-migrations-'));
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
    throw new Error('Production and Preview must both point to the audited maono_maps D1');
  }

  const previewVars = pages.deployment_configs?.preview?.env_vars || {};
  const qaId = String(previewVars.MAONO_PREVIEW_QA_ORG_ID?.value || '').trim();
  const qaSlug = String(previewVars.MAONO_PREVIEW_QA_ORG_SLUG?.value || '').trim();
  const runtime = String(previewVars.MAONO_RUNTIME_ENV?.value || '').trim();
  const mutations = String(previewVars.MAONO_PREVIEW_MUTATIONS_ENABLED?.value || '').trim();
  if (!qaId || qaSlug !== 'maono-preview-qa' || runtime !== 'preview') {
    throw new Error('Preview QA scope/runtime configuration is incomplete');
  }
  if (mutations !== 'false') {
    throw new Error('Migration gate requires MAONO_PREVIEW_MUTATIONS_ENABLED=false');
  }
  record('Bindings and fail-closed Preview configuration verified before migration.');

  const [viewerSession, reviewerSession] = await Promise.all([
    readSession(viewerCookie, 'Viewer'),
    readSession(reviewerCookie, 'Reviewer'),
  ]);
  if (String(viewerSession.user.id) === String(reviewerSession.user.id)) {
    throw new Error('Viewer and Reviewer must be different authenticated identities');
  }
  if (String(viewerSession.user.role || '').toLowerCase() !== 'viewer') {
    throw new Error('Viewer QA identity must resolve to role viewer');
  }
  const viewerAccess = String(
    viewerSession.project.accessLevel || viewerSession.project.access_level || '',
  ).toLowerCase();
  if (viewerAccess !== 'viewer') {
    throw new Error('Viewer QA project access must resolve to viewer');
  }
  const reviewerAccess = String(
    reviewerSession.project.accessLevel || reviewerSession.project.access_level || '',
  ).toLowerCase();
  const reviewerRole = String(reviewerSession.user.role || '').toLowerCase();
  if (
    reviewerRole === 'viewer' ||
    !['editor', 'write', 'owner'].includes(reviewerAccess)
  ) {
    throw new Error('Reviewer QA identity must resolve to an Editor-capable project route');
  }
  record('Distinct Viewer and Reviewer identities are authenticated and scoped to the QA project.');

  const migrationsDir = join(directory, 'migrations');
  mkdirSync(migrationsDir);
  const config = join(directory, 'wrangler.json');
  writeFileSync(config, JSON.stringify({
    name: 'maono-change-request-release-migrations',
    compatibility_date: '2026-05-21',
    d1_databases: [{
      binding: 'DB',
      database_name: 'maono_maps',
      database_id: database.uuid,
      migrations_dir: migrationsDir,
    }],
  }));

  function query(sql) {
    const normalized = String(sql || '').trim();
    if (!/^(SELECT|PRAGMA|WITH)\b/i.test(normalized)) {
      throw new Error('Migration gate internal query must be read-only');
    }
    const result = spawnSync(
      'npx',
      [
        '--yes',
        'wrangler@4.113.0',
        'd1',
        'execute',
        'DB',
        '--remote',
        '--config',
        config,
        '--command',
        normalized,
        '--json',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (result.status !== 0) {
      throw new Error('Wrangler read-only migration query failed; raw output suppressed');
    }
    return JSON.parse(result.stdout).flatMap(item => item.results || []);
  }

  function schemaSnapshot() {
    const requestColumns = new Set(
      query('PRAGMA table_info(project_change_requests)').map(row => row.name),
    );
    const artifactColumns = new Set(
      query('PRAGMA table_info(project_change_request_apply_artifacts)').map(row => row.name),
    );
    const schemaObjects = new Set(
      query(`SELECT name FROM sqlite_master WHERE name IN (
        'project_change_request_events',
        'trg_change_request_lifecycle_guard',
        'trg_change_request_lifecycle_sync',
        'trg_change_request_lifecycle_created',
        'trg_ticket_change_request_status_guard',
        'project_change_request_apply_artifacts',
        'trg_change_request_apply_artifact_immutable',
        'uq_project_change_request_resubmission_source',
        'trg_project_change_request_resubmission_immutable',
        'trg_project_change_request_resubmission_guard'
      )`).map(row => row.name),
    );
    return {
      requestColumns,
      artifactColumns,
      schemaObjects,
      ready21:
        hasAll(requestColumns, LIFECYCLE_COLUMNS) &&
        hasAll(schemaObjects, LIFECYCLE_OBJECTS),
      any21:
        LIFECYCLE_COLUMNS.some(name => requestColumns.has(name)) ||
        LIFECYCLE_OBJECTS.some(name => schemaObjects.has(name)),
      ready22:
        hasAll(schemaObjects, APPLY_OBJECTS) &&
        hasAll(
          artifactColumns,
          ['change_request_id', 'checksum', 'size_bytes', 'base_revision', 'created_at'],
        ),
      any22:
        APPLY_OBJECTS.some(name => schemaObjects.has(name)) || artifactColumns.size > 0,
      ready23:
        requestColumns.has('resubmitted_from_request_id') &&
        hasAll(schemaObjects, RESUBMISSION_OBJECTS),
      any23:
        requestColumns.has('resubmitted_from_request_id') ||
        RESUBMISSION_OBJECTS.some(name => schemaObjects.has(name)),
    };
  }

  let ledger = new Set(
    query('SELECT name FROM d1_migrations ORDER BY id').map(row => row.name),
  );
  setEqualsPrefix(ledger);
  let snapshot = schemaSnapshot();
  const states = [
    { name: MIGRATIONS[0], ready: snapshot.ready21, any: snapshot.any21 },
    { name: MIGRATIONS[1], ready: snapshot.ready22, any: snapshot.any22 },
    { name: MIGRATIONS[2], ready: snapshot.ready23, any: snapshot.any23 },
  ];
  for (const state of states) {
    const recorded = ledger.has(state.name);
    if (recorded && !state.ready) {
      throw new Error(`Migration ledger/schema divergence detected for ${state.name}`);
    }
    if (!recorded && state.any) {
      throw new Error(`Partial unrecorded schema detected for ${state.name}`);
    }
  }

  const applying = Number(
    query("SELECT COUNT(*) AS count FROM project_change_requests WHERE status='applying'")[0]?.count || 0,
  );
  if (applying !== 0) {
    throw new Error('At least one Change Request is applying; migration window is blocked');
  }

  const qaProject = query(`SELECT p.id,o.id AS organization_id
    FROM projects p JOIN organizations o ON o.id=p.organization_id
    WHERE p.slug='${qaProjectSlug.replaceAll("'", "''")}' AND o.slug='maono-preview-qa' LIMIT 2`);
  if (qaProject.length !== 1 || String(qaProject[0].organization_id) !== qaId) {
    throw new Error('Disposable QA project is not uniquely scoped to the configured QA organization');
  }

  const pending = MIGRATIONS.filter(name => !ledger.has(name));
  if (pending.length) {
    for (const name of pending) {
      copyFileSync(join('migrations', name), join(migrationsDir, name));
    }
    record(`Prepared isolated migration directory with ${pending.join(', ')} only.`);

    const result = spawnSync(
      'npx',
      [
        '--yes',
        'wrangler@4.113.0',
        'd1',
        'migrations',
        'apply',
        'DB',
        '--remote',
        '--config',
        config,
      ],
      {
        encoding: 'utf8',
        input: 'y\n',
        env: {
          ...process.env,
          CI: 'true',
          WRANGLER_SEND_METRICS: 'false',
        },
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (result.status !== 0) {
      throw new Error('Isolated migration command failed; inspect ledger before retry; raw output suppressed');
    }
    record('Isolated 0021-0023 migration command completed.');
  } else {
    record('0021-0023 are already recorded; no migration write was attempted.');
  }

  ledger = new Set(
    query('SELECT name FROM d1_migrations ORDER BY id').map(row => row.name),
  );
  if (!MIGRATIONS.every(name => ledger.has(name))) {
    throw new Error('Required Change Request migrations are missing from the D1 ledger after apply');
  }
  snapshot = schemaSnapshot();
  if (!snapshot.ready21 || !snapshot.ready22 || !snapshot.ready23) {
    throw new Error('Change Request schema is incomplete after the migration command');
  }

  const divergences = Number(query(`SELECT COUNT(*) AS count
    FROM project_change_requests r
    JOIN organization_tickets t ON t.id=r.ticket_id AND t.organization_id=r.organization_id
    WHERE t.status <> CASE r.status
      WHEN 'submitted' THEN 'new' WHEN 'under_review' THEN 'in_review'
      WHEN 'approved' THEN 'in_review' WHEN 'applying' THEN 'in_progress' ELSE 'closed' END
      OR (t.status='closed' AND t.closed_at IS NULL)
      OR (t.status<>'closed' AND t.closed_at IS NOT NULL)`)[0]?.count || 0);
  if (divergences !== 0) {
    throw new Error(`Request/Ticket divergence detected after migrations: ${divergences}`);
  }

  const journal = Number(query(`SELECT COUNT(*) AS count FROM (
    SELECT r.id
    FROM project_change_requests r
    LEFT JOIN project_change_request_events e ON e.change_request_id=r.id
    GROUP BY r.id,r.lifecycle_version,r.status
    HAVING COUNT(e.version) <> r.lifecycle_version + 1
      OR MIN(e.version) <> 0
      OR MAX(e.version) <> r.lifecycle_version
      OR MAX(CASE WHEN e.version=r.lifecycle_version AND e.to_status=r.status THEN 1 ELSE 0 END) <> 1
  )`)[0]?.count || 0);
  if (journal !== 0) {
    throw new Error(`Lifecycle journal divergence detected after migrations: ${journal}`);
  }

  const health = await fetch(`${previewBaseUrl}/api/health`, {
    redirect: 'manual',
    headers: { Accept: 'application/json' },
  });
  if (!health.ok) {
    throw new Error(`Preview health returned HTTP ${health.status} after migrations`);
  }
  const body = await health.json();
  for (const key of [
    'changeRequestLifecycleReady',
    'changeRequestApplyArtifactReady',
    'changeRequestResubmissionReady',
  ]) {
    if (body?.checks?.[key] !== true) {
      throw new Error(`Preview health remains unready after migrations: ${key}`);
    }
  }
  if (body?.runtime?.previewMutationsEnabled !== false) {
    throw new Error('Preview mutation kill switch changed during migration gate');
  }

  record('D1 ledger, schema, lifecycle journal and Request/Ticket invariants verified after 0021-0023.');
  record('Preview remains fail-closed; enable mutations only for the explicit authenticated acceptance window.');
} finally {
  rmSync(directory, { recursive: true, force: true });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      evidence.map(line => `- ${line}`).join('\n') + '\n',
    );
  }
}
