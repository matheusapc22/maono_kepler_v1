// Controlled rollout evidence. Credentials exist only in the Actions runner.
import { readFileSync, mkdirSync, copyFileSync, writeFileSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('Required Repository Secrets are unavailable');
const evidence = [];
function record(message) { evidence.push(message); console.log(message); }
async function api(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Cloudflare request failed: HTTP ${response.status}`);
  const body = await response.json();
  if (!body.success) throw new Error('Cloudflare reported an unsuccessful request');
  return body.result;
}
const directory = mkdtempSync(join(tmpdir(), 'maono-d1-preflight-'));
try {
  const databases = await api('d1/database?per_page=100');
  const matches = databases.filter(db => db.name === 'maono_maps');
  if (matches.length !== 1) throw new Error('Expected exactly one maono_maps database in configured account');
  const database = matches[0];
  record('Configured account authenticated; unique D1 maono_maps found.');
  let bindingConfirmed = false;
  let qaReady = false;
  try {
    const project = await api('pages/projects/maono-kepler-v1');
    const production = project.deployment_configs?.production?.d1_databases?.DB?.id;
    const preview = project.deployment_configs?.preview?.d1_databases?.DB?.id;
    bindingConfirmed = production === database.uuid;
    const qa = project.deployment_configs?.preview?.env_vars || {};
    qaReady = Boolean(qa.MAONO_PREVIEW_QA_ORG_ID?.value) && qa.MAONO_PREVIEW_MUTATIONS_ENABLED?.value === 'true';
    record(`Preview QA configuration: organization configured ${Boolean(qa.MAONO_PREVIEW_QA_ORG_ID?.value)}, mutations enabled ${qa.MAONO_PREVIEW_MUTATIONS_ENABLED?.value === 'true'}.`);
    record(`Production DB binding matches maono_maps: ${bindingConfirmed}; preview matches: ${preview === database.uuid}.`);
  } catch (error) {
    record(`Pages binding could not be verified (${error.message}); migration application remains blocked.`);
  }
  if (!bindingConfirmed) throw new Error('Production binding must be confirmed before proceeding');
  const config = join(directory, 'wrangler.json');
  writeFileSync(config, JSON.stringify({name:'maono-d1-preflight', compatibility_date:'2026-05-21',
    d1_databases:[{binding:'DB',database_name:'maono_maps',database_id:database.uuid,migrations_dir:join(directory,'migrations')}]}));
  function query(sql) {
    const result = spawnSync('npx', ['--yes','wrangler@4.113.0','d1','execute','DB','--remote','--config',config,'--command',sql,'--json'], {
      encoding:'utf8', env:{...process.env, WRANGLER_SEND_METRICS:'false'}, maxBuffer:4*1024*1024,
    });
    if (result.status !== 0) throw new Error('Wrangler read-only query failed; raw output suppressed to protect credentials');
    return JSON.parse(result.stdout).flatMap(item => item.results || []);
  }
  const migrations = query('SELECT name FROM d1_migrations ORDER BY id');
  // Only known migration filenames are reported; no row/user data is logged.
  const applied = migrations.some(row => row.name === '0021_change_request_lifecycle.sql');
  record(`Migration 0021 recorded as applied: ${applied}; total remote migrations: ${migrations.length}.`);
  const qaOrganizations = query("SELECT COUNT(*) AS count FROM organizations WHERE slug='maono-preview-qa'");
  record(`Dedicated QA organization exists: ${Number(qaOrganizations[0].count) === 1}; QA session supplied to runner: ${Boolean(process.env.MAONO_PREVIEW_SESSION_COOKIE)}.`);
  if (process.env.MAONO_APPLY_0021 === 'true') {
    if (!qaReady || !process.env.MAONO_PREVIEW_SESSION_COOKIE) throw new Error('Authenticated QA acceptance must be available before opening the incompatible-writer migration window');
    if (process.env.GITHUB_REF !== 'refs/heads/ops/change-request-0021-rollout') throw new Error('Apply requires the dedicated rollout branch');
    const migration = 'migrations/0021_change_request_lifecycle.sql';
    if (createHash('sha256').update(readFileSync(migration)).digest('hex') !== 'd22adb6de0e6f38b9d0100ee4517ce4689b7c9ca96da0d3942d4f6b9c2a1ba2f') throw new Error('Migration checksum differs from reviewed 0021');
    if (!applied) {
      const columns = query('PRAGMA table_info(project_change_requests)');
      if (columns.some(row => row.name === 'lifecycle_version')) throw new Error('Partial migration detected; refusing to reapply');
      if (Number(query("SELECT COUNT(*) AS count FROM project_change_requests WHERE status='applying'")[0].count)) throw new Error('An Apply is in flight; rollout blocked');
      mkdirSync(join(directory,'migrations'));
      copyFileSync(migration,join(directory,'migrations','0021_change_request_lifecycle.sql'));
      const result = spawnSync('npx',['--yes','wrangler@4.113.0','d1','migrations','apply','DB','--remote','--config',config], {
        encoding:'utf8',input:'y\n',env:{...process.env,CI:'true',WRANGLER_SEND_METRICS:'false'},maxBuffer:4*1024*1024,
      });
      if (result.status !== 0) throw new Error('Isolated migration command failed; inspect ledger before retry; raw output suppressed');
      record('Isolated migration command completed; only 0021 was supplied to Wrangler.');
    } else record('Migration already recorded; application skipped.');
    if (!query("SELECT name FROM d1_migrations WHERE name='0021_change_request_lifecycle.sql'").length) throw new Error('0021 missing from remote ledger after apply');
    const divergences = query("SELECT COUNT(*) AS count FROM project_change_requests r JOIN organization_tickets t ON t.id=r.ticket_id AND t.organization_id=r.organization_id WHERE t.status <> CASE r.status WHEN 'submitted' THEN 'new' WHEN 'under_review' THEN 'in_review' WHEN 'approved' THEN 'in_review' WHEN 'applying' THEN 'in_progress' ELSE 'closed' END OR (t.status='closed' AND t.closed_at IS NULL) OR (t.status<>'closed' AND t.closed_at IS NOT NULL)");
    if (Number(divergences[0].count)) throw new Error('Request/Ticket lifecycle divergence detected');
    const journal = query('SELECT COUNT(*) AS count FROM project_change_requests r LEFT JOIN project_change_request_events e ON e.change_request_id=r.id AND e.version=r.lifecycle_version WHERE e.change_request_id IS NULL OR e.to_status<>r.status');
    if (Number(journal[0].count)) throw new Error('Lifecycle journal divergence detected');
    record('0021 ledger verified; zero Request/Ticket divergences; journal matches every current lifecycle version.');
  }
  const schema = query("SELECT name FROM sqlite_master WHERE name IN ('project_change_requests','project_change_request_events','trg_change_request_lifecycle_guard','trg_change_request_lifecycle_sync','trg_change_request_lifecycle_created','trg_ticket_change_request_status_guard')");
  if (process.env.MAONO_APPLY_0021 === 'true' && schema.length !== 6) throw new Error('Incomplete lifecycle schema');
  record(`Lifecycle schema objects present: ${schema.map(row => row.name).join(', ')}.`);
  try {
    const health = await fetch('https://8ef07e75.maono-kepler-v1.pages.dev/api/health', {redirect:'manual'});
    if (process.env.MAONO_APPLY_0021 === 'true' && !health.ok) throw new Error('Required preview health HTTP check failed');
    const location = health.headers.get('location') || '';
    let accessRedirect = false;
    try { accessRedirect = new URL(location).hostname.endsWith('.cloudflareaccess.com'); } catch {}
    record(`Preview HTTP health status: ${health.status}; Cloudflare Access redirect: ${accessRedirect}. No D1 credential was sent to the preview.`);
    if (health.ok) {
      const body = await health.json();
      if (process.env.MAONO_APPLY_0021 === 'true' && body.checks?.changeRequestLifecycleReady !== true) throw new Error('Lifecycle health remains unready after migration');
      record(`Preview lifecycle readiness: ${body.checks?.changeRequestLifecycleReady === true}.`);
    }
  } catch { if (process.env.MAONO_APPLY_0021 === 'true') throw new Error('Required preview health verification failed after migration'); record('Preview HTTP health request unavailable from runner; D1 verification is independent.'); }
  if (!bindingConfirmed) throw new Error('Target environment binding unverified: Pages project read access or independently audited binding evidence required');
  record(process.env.MAONO_APPLY_0021 === 'true' ? 'Isolated 0021 schema rollout verified.' : 'Read-only target preflight passed. No migration was applied by this workflow.');
} finally {
  rmSync(directory, {recursive:true,force:true});
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, evidence.join('\n\n')+'\n');
}
