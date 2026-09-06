// Read-only rollout evidence. Credentials exist only in the Actions runner.
import { writeFileSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
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
  try {
    const project = await api('pages/projects/maono-kepler-v1');
    const production = project.deployment_configs?.production?.d1_databases?.DB?.id;
    const preview = project.deployment_configs?.preview?.d1_databases?.DB?.id;
    bindingConfirmed = production === database.uuid;
    record(`Production DB binding matches maono_maps: ${bindingConfirmed}; preview matches: ${preview === database.uuid}.`);
  } catch (error) {
    record(`Pages binding could not be verified (${error.message}); migration application remains blocked.`);
  }
  const config = join(directory, 'wrangler.json');
  writeFileSync(config, JSON.stringify({name:'maono-d1-preflight', compatibility_date:'2026-05-21',
    d1_databases:[{binding:'DB',database_name:'maono_maps',database_id:database.uuid}]}));
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
  const schema = query("SELECT name FROM sqlite_master WHERE name IN ('project_change_requests','project_change_request_events','trg_change_request_lifecycle_guard','trg_change_request_lifecycle_sync','trg_change_request_lifecycle_created','trg_ticket_change_request_status_guard')");
  record(`Lifecycle schema objects present: ${schema.map(row => row.name).join(', ')}.`);
  if (!bindingConfirmed) throw new Error('Target environment binding unverified: Pages project read access or independently audited binding evidence required');
  record('Read-only target preflight passed. No migration was applied by this workflow.');
} finally {
  rmSync(directory, {recursive:true,force:true});
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, evidence.join('\n\n')+'\n');
}
