import {
  appendFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REQUIRED_MIGRATIONS = Object.freeze([
  '0021_change_request_lifecycle.sql',
  '0022_change_request_apply_artifacts.sql',
  '0023_change_request_resubmissions.sql',
]);
const REQUIRED_SCHEMA_OBJECTS = Object.freeze([
  'project_change_request_events',
  'trg_change_request_lifecycle_guard',
  'trg_change_request_lifecycle_sync',
  'trg_change_request_lifecycle_created',
  'trg_ticket_change_request_status_guard',
  'project_change_request_apply_artifacts',
  'trg_change_request_apply_artifact_immutable',
  'uq_project_change_request_resubmission_source',
  'trg_project_change_request_resubmission_immutable',
  'trg_project_change_request_resubmission_guard',
]);
const REQUIRED_REQUEST_COLUMNS = Object.freeze([
  'lifecycle_version',
  'decision',
  'feedback',
  'decided_by_user_id',
  'decided_at',
  'transition_actor_user_id',
  'applied_revision',
  'resubmitted_from_request_id',
]);
const REQUIRED_ARTIFACT_COLUMNS = Object.freeze([
  'change_request_id',
  'checksum',
  'size_bytes',
  'base_revision',
  'created_at',
]);

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const phase = String(process.env.MAONO_RELEASE_GATE_PHASE || 'pre').trim().toLowerCase();
const qaProjectSlug = String(process.env.MAONO_ACCEPTANCE_QA_PROJECT_SLUG || '').trim();
const requirePreviewMutations = String(process.env.MAONO_REQUIRE_PREVIEW_MUTATIONS_ENABLED || '').toLowerCase() === 'true';
const staleApplyMinutes = Math.max(Number(process.env.MAONO_RELEASE_GATE_APPLY_STALE_MINUTES || 30), 5);
const evidence = [];

if (!account || !token) throw new Error('Required Cloudflare Repository Secrets are unavailable');
if (!['pre', 'post'].includes(phase)) throw new Error('MAONO_RELEASE_GATE_PHASE must be pre or post');

function record(message) {
  evidence.push(message);
  console.log(message);
}

function appendEnv(name, value) {
  if (!process.env.GITHUB_ENV) return;
  appendFileSync(process.env.GITHUB_ENV, `${name}=${String(value)}\n`);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
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

function assertReadOnlySql(sql) {
  const normalized = String(sql || '').trim();
  if (!/^(SELECT|PRAGMA|WITH)\b/i.test(normalized)) {
    throw new Error('Release observability accepts read-only SQL only');
  }
  if (/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|ATTACH|DETACH)\b/i.test(normalized)) {
    throw new Error('Release observability rejected a mutating SQL statement');
  }
  return normalized;
}

async function cloudflareApi(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Cloudflare API request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!body.success) throw new Error('Cloudflare API reported an unsuccessful request');
  return body.result;
}

async function checkHealth(baseUrl, expectedRuntime, { requireMutations = false } = {}) {
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
    if (body?.checks?.[key] !== true) throw new Error(`${expectedRuntime} health gate failed: ${key}`);
  }
  if (requireMutations && body?.runtime?.previewMutationsEnabled !== true) {
    throw new Error('Preview mutations are not enabled for authenticated QA acceptance');
  }
  record(`${expectedRuntime} health confirms D1 + 0021/0022/0023 readiness${requireMutations ? ' and QA mutations enabled' : ''}.`);
}

const directory = mkdtempSync(join(tmpdir(), 'maono-change-request-release-'));
try {
  const databases = await cloudflareApi('d1/database?per_page=100');
  const matches = databases.filter(database => database.name === 'maono_maps');
  if (matches.length !== 1) throw new Error('Expected exactly one maono_maps database in configured account');
  const database = matches[0];

  const pages = await cloudflareApi('pages/projects/maono-kepler-v1');
  const productionBinding = pages.deployment_configs?.production?.d1_databases?.DB?.id;
  const previewBinding = pages.deployment_configs?.preview?.d1_databases?.DB?.id;
  if (productionBinding !== database.uuid || previewBinding !== database.uuid) {
    throw new Error('Production and Preview DB bindings must both point to the audited maono_maps D1');
  }
  record('Cloudflare bindings verified: Production and Preview share the audited maono_maps D1.');

  const previewVars = pages.deployment_configs?.preview?.env_vars || {};
  const configuredQaId = String(previewVars.MAONO_PREVIEW_QA_ORG_ID?.value || '').trim();
  const configuredQaSlug = String(previewVars.MAONO_PREVIEW_QA_ORG_SLUG?.value || '').trim();
  const configuredRuntime = String(previewVars.MAONO_RUNTIME_ENV?.value || '').trim();
  const configuredMutations = String(previewVars.MAONO_PREVIEW_MUTATIONS_ENABLED?.value || '').trim();
  if (!configuredQaId || configuredQaSlug !== 'maono-preview-qa' || configuredRuntime !== 'preview') {
    throw new Error('Preview QA scope/runtime configuration is incomplete');
  }
  if (requirePreviewMutations && configuredMutations !== 'true') {
    throw new Error('Preview mutation kill switch must be enabled before authenticated acceptance');
  }
  record(`Preview QA configuration verified; mutation kill switch required=${requirePreviewMutations} satisfied=${configuredMutations === 'true'}.`);

  const config = join(directory, 'wrangler.json');
  writeFileSync(config, JSON.stringify({
    name: 'maono-change-request-release-observability',
    compatibility_date: '2026-05-21',
    d1_databases: [{
      binding: 'DB',
      database_name: 'maono_maps',
      database_id: database.uuid,
    }],
  }));

  function query(sql) {
    const command = assertReadOnlySql(sql);
    const result = spawnSync(
      'npx',
      ['--yes', 'wrangler@4.113.0', 'd1', 'execute', 'DB', '--remote', '--config', config, '--command', command, '--json'],
      {
        encoding: 'utf8',
        env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (result.status !== 0) {
      throw new Error('Wrangler read-only release query failed; raw output suppressed');
    }
    return JSON.parse(result.stdout).flatMap(item => item.results || []);
  }

  const migrations = query('SELECT name FROM d1_migrations ORDER BY id');
  const applied = new Set(migrations.map(row => row.name));
  const missingMigrations = REQUIRED_MIGRATIONS.filter(name => !applied.has(name));
  if (missingMigrations.length) {
    throw new Error(`Release blocked: missing required migrations ${missingMigrations.join(', ')}`);
  }
  record('Migration ledger confirms 0021, 0022 and 0023.');

  const requestColumns = new Set(query('PRAGMA table_info(project_change_requests)').map(row => row.name));
  if (!REQUIRED_REQUEST_COLUMNS.every(name => requestColumns.has(name))) {
    throw new Error('project_change_requests is missing required lifecycle/resubmission columns');
  }
  const artifactColumns = new Set(query('PRAGMA table_info(project_change_request_apply_artifacts)').map(row => row.name));
  if (!REQUIRED_ARTIFACT_COLUMNS.every(name => artifactColumns.has(name))) {
    throw new Error('project_change_request_apply_artifacts schema is incomplete');
  }
  const schemaObjects = new Set(
    query(`SELECT name FROM sqlite_master WHERE name IN (${REQUIRED_SCHEMA_OBJECTS.map(sqlLiteral).join(',')})`)
      .map(row => row.name),
  );
  const missingObjects = REQUIRED_SCHEMA_OBJECTS.filter(name => !schemaObjects.has(name));
  if (missingObjects.length) throw new Error(`Release blocked: missing schema objects ${missingObjects.join(', ')}`);
  record('Lifecycle, apply-artifact and resubmission schema objects are complete.');

  const invariantQueries = [
    ['Request/Ticket lifecycle divergence', `SELECT COUNT(*) AS count
      FROM project_change_requests r
      JOIN organization_tickets t ON t.id=r.ticket_id AND t.organization_id=r.organization_id
      WHERE t.status <> CASE r.status
        WHEN 'submitted' THEN 'new' WHEN 'under_review' THEN 'in_review'
        WHEN 'approved' THEN 'in_review' WHEN 'applying' THEN 'in_progress' ELSE 'closed' END
        OR (t.status='closed' AND t.closed_at IS NULL)
        OR (t.status<>'closed' AND t.closed_at IS NOT NULL)`],
    ['Lifecycle journal divergence', `SELECT COUNT(*) AS count FROM (
      SELECT r.id
      FROM project_change_requests r
      LEFT JOIN project_change_request_events e ON e.change_request_id=r.id
      GROUP BY r.id, r.lifecycle_version, r.status
      HAVING COUNT(e.version) <> r.lifecycle_version + 1
        OR MIN(e.version) <> 0
        OR MAX(e.version) <> r.lifecycle_version
        OR MAX(CASE WHEN e.version=r.lifecycle_version AND e.to_status=r.status THEN 1 ELSE 0 END) <> 1
    )`],
    ['Decision/applied revision divergence', `SELECT COUNT(*) AS count
      FROM project_change_requests
      WHERE (status IN ('approved','applying','applied') AND decision IS NOT 'approved')
         OR (status='rejected' AND decision IS NOT 'rejected')
         OR (status='applied' AND applied_revision IS NOT base_revision + 1)`],
    ['Apply artifact divergence', `SELECT COUNT(*) AS count
      FROM project_change_request_apply_artifacts a
      JOIN project_change_requests r ON r.id=a.change_request_id
      WHERE a.base_revision <> r.base_revision OR length(a.checksum) <> 64 OR a.size_bytes <= 0`],
    ['Resubmission lineage divergence', `SELECT COUNT(*) AS count
      FROM project_change_requests child
      LEFT JOIN project_change_requests parent ON parent.id=child.resubmitted_from_request_id
      WHERE child.resubmitted_from_request_id IS NOT NULL AND (
        parent.id IS NULL OR parent.organization_id<>child.organization_id OR parent.project_id<>child.project_id
        OR parent.requested_by_user_id<>child.requested_by_user_id OR parent.status NOT IN ('rejected','conflict')
      )`],
    ['Stale applying requests', `SELECT COUNT(*) AS count
      FROM project_change_requests
      WHERE status='applying' AND datetime(updated_at) < datetime('now', '-${Math.trunc(staleApplyMinutes)} minutes')`],
  ];
  for (const [label, sql] of invariantQueries) {
    const count = Number(query(sql)[0]?.count || 0);
    if (count !== 0) throw new Error(`Release blocked: ${label} count=${count}`);
    record(`${label}: 0.`);
  }

  const statusCounts = query(`SELECT status, COUNT(*) AS count FROM project_change_requests GROUP BY status ORDER BY status`);
  record(`Lifecycle population observed across ${statusCounts.length} status bucket(s); row data suppressed.`);

  const qaOrganization = query("SELECT id FROM organizations WHERE slug='maono-preview-qa'");
  if (qaOrganization.length !== 1 || String(qaOrganization[0].id) !== configuredQaId) {
    throw new Error('Preview QA organization does not match the configured D1 scope');
  }

  if (qaProjectSlug) {
    if (!/^qa-smoke-[a-z0-9-]{3,80}$/.test(qaProjectSlug)) {
      throw new Error('Acceptance project must be a disposable qa-smoke-* project');
    }
    const projects = query(`SELECT p.id,p.config_revision,o.slug AS organization_slug
      FROM projects p JOIN organizations o ON o.id=p.organization_id
      WHERE p.slug=${sqlLiteral(qaProjectSlug)} LIMIT 2`);
    if (projects.length !== 1 || projects[0].organization_slug !== 'maono-preview-qa') {
      throw new Error('Acceptance project must exist uniquely inside Maõno Preview QA');
    }
    if (phase === 'pre') {
      appendEnv('MAONO_ACCEPTANCE_BASE_REVISION', Number(projects[0].config_revision || 0));
      appendEnv('MAONO_ACCEPTANCE_PROJECT_ID', Number(projects[0].id));
    }
    record(`Disposable QA project scope verified for ${phase}-acceptance observability.`);
  }

  const previewBaseUrl = normalizeBaseUrl(process.env.MAONO_PREVIEW_BASE_URL, 'MAONO_PREVIEW_BASE_URL');
  const productionBaseUrl = normalizeBaseUrl(process.env.MAONO_PRODUCTION_BASE_URL, 'MAONO_PRODUCTION_BASE_URL');
  await checkHealth(previewBaseUrl, 'preview', { requireMutations: requirePreviewMutations });
  await checkHealth(productionBaseUrl, 'production');

  if (phase === 'post') {
    const sourceId = String(process.env.MAONO_ACCEPTANCE_SOURCE_REQUEST_ID || '').trim();
    const childId = String(process.env.MAONO_ACCEPTANCE_RESUBMISSION_ID || '').trim();
    const checksum = String(process.env.MAONO_ACCEPTANCE_ARTIFACT_CHECKSUM || '').trim().toLowerCase();
    const appliedRevision = Number(process.env.MAONO_ACCEPTANCE_APPLIED_REVISION);
    if (!sourceId || !childId || !/^[a-f0-9]{64}$/.test(checksum) || !Number.isInteger(appliedRevision)) {
      throw new Error('Post-acceptance evidence variables are incomplete');
    }
    const rows = query(`SELECT source.status AS source_status, child.status AS child_status,
        child.resubmitted_from_request_id, child.base_revision, child.applied_revision,
        artifact.checksum, ticket.status AS ticket_status
      FROM project_change_requests source
      JOIN project_change_requests child ON child.id=${sqlLiteral(childId)} AND child.resubmitted_from_request_id=source.id
      JOIN project_change_request_apply_artifacts artifact ON artifact.change_request_id=child.id
      LEFT JOIN organization_tickets ticket ON ticket.id=child.ticket_id AND ticket.organization_id=child.organization_id
      WHERE source.id=${sqlLiteral(sourceId)} LIMIT 1`);
    const row = rows[0];
    if (!row || row.source_status !== 'rejected' || row.child_status !== 'applied' ||
        row.resubmitted_from_request_id !== sourceId || Number(row.applied_revision) !== appliedRevision ||
        Number(row.applied_revision) !== Number(row.base_revision) + 1 || row.checksum !== checksum ||
        row.ticket_status !== 'closed') {
      throw new Error('Post-acceptance lineage/apply evidence did not match the expected canonical state');
    }
    record('Post-acceptance D1 evidence confirms rejected parent, applied resubmission, immutable artifact and closed Ticket.');
  }

  record(`Change Request release observability ${phase} gate passed without D1 mutations.`);
} finally {
  rmSync(directory, { recursive: true, force: true });
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, evidence.map(line => `- ${line}`).join('\n') + '\n');
  }
}
