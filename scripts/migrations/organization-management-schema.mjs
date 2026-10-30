import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  PRODUCTION_DATABASE_NAME, PRODUCTION_DATABASE_ID, runWranglerJson, rowsFromD1Json,
  gateError, sha256Text, queryLedger, computePendingState, captureTimeTravelBookmark,
} from './production-migration-lib.mjs';

export const ORGANIZATION_MIGRATION = '0042_organization_management.sql';
export const ORGANIZATION_MIGRATION_SHA256 = 'e47d8a1444c8c14681589733867a5f00e2490835ffc588e0de9dde1bcac6aa00';
const ADDED_COLUMNS = Object.freeze({
  organizations: ['plan', 'project_limit', 'management_owner_id', 'management_version',
    'management_create_key', 'management_actor_id', 'management_request_id', 'management_action', 'management_reason'],
  organization_limit_requests: ['requested_limits_json', 'review_operation_key', 'management_version'],
});
const NEW_TABLES = ['organization_management_events', 'organization_management_operations',
  'organization_management_operation_items', 'organization_management_assertions'];
const TABLES = [...Object.keys(ADDED_COLUMNS), ...NEW_TABLES];
const INDEXES = ['idx_org_management_creation', 'idx_org_management_plan_active', 'idx_org_management_events_org',
  'idx_org_management_events_request', 'idx_org_management_operation_actor',
  'sqlite_autoindex_organization_management_operations_1', 'sqlite_autoindex_organization_management_operations_2',
  'sqlite_autoindex_organization_management_operation_items_1'];
// No caller-supplied identifiers/SQL. Namespace reads also detect unexpected objects.
export const ORGANIZATION_SCHEMA_QUERIES = Object.freeze({
  objects: 'SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name IN (' + TABLES.map(n => "'" + n + "'").join(',') +
    ") OR name GLOB 'org_management_*' OR name GLOB 'organization_management_*' OR name GLOB 'idx_org_management_*' ORDER BY type,name;",
  ...Object.fromEntries(TABLES.flatMap(name => [
    ['columns:' + name, 'PRAGMA table_info(' + name + ');'],
    ['foreignKeys:' + name, 'PRAGMA foreign_key_list(' + name + ');'],
    ['indexes:' + name, 'PRAGMA index_list(' + name + ');'],
  ])),
  ...Object.fromEntries(INDEXES.map(name => ['indexColumns:' + name, 'PRAGMA index_xinfo(' + name + ');'])),
});

// Keep quoted literals/operators exact; normalize only comments, whitespace and
// unquoted SQL case. Drift is never hidden by stripping text inside literals.
function tokens(sql) {
  return (String(sql || '').match(/'(?:''|[^'])*'|"(?:""|[^"])*"|\x60(?:\x60\x60|[^\x60])*\x60|\[[^\]]*\]|--[^\r\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[^\s]/g) || [])
    .filter(t => !t.startsWith('--') && !t.startsWith('/*'))
    .map(t => /^[A-Za-z_][A-Za-z_0-9]*$/.test(t) ? t.toLowerCase() : t)
    .filter((t, i, all) => t !== ';' || i !== all.length - 1);
}
function columnDefinition(sql, name) {
  const list = tokens(sql), start = list.indexOf('(');
  let depth = 0, part = [];
  for (const token of list.slice(start + 1)) {
    if ((token === ',' || token === ')') && depth === 0) {
      if (part[0] === name) return part;
      part = [];
      if (token === ')') break;
      continue;
    }
    part.push(token);
    if (token === '(') depth++;
    if (token === ')') depth--;
  }
  return null;
}
function select(row, fields) {
  return Object.fromEntries(fields.map(key => [key, row[key] ?? null]));
}
function stable(rows) {
  return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
}
function normalized(key, rows) {
  const [kind, name] = key.split(':');
  if (kind === 'columns') {
    return stable(rows.filter(r => !ADDED_COLUMNS[name] || ADDED_COLUMNS[name].includes(r.name))
      .map(r => select(r, ['name', 'type', 'notnull', 'dflt_value', 'pk'])));
  }
  if (kind === 'foreignKeys') {
    return stable(rows.filter(r => !ADDED_COLUMNS[name] || ADDED_COLUMNS[name].includes(r.from))
      .map(r => select(r, ['seq', 'table', 'from', 'to', 'on_update', 'on_delete', 'match'])));
  }
  if (kind === 'indexes') {
    return stable(rows.filter(r => !ADDED_COLUMNS[name] || INDEXES.includes(r.name))
      .map(r => select(r, ['name', 'unique', 'origin', 'partial'])));
  }
  if (kind === 'indexColumns') return stable(rows.map(r => select(r, ['seqno', 'cid', 'name', 'desc', 'coll', 'key'])));
  return rows;
}

export function expectedOrganizationSchema() {
  const sql = readFileSync(new URL('../../migrations/0042_organization_management.sql', import.meta.url), 'utf8');
  if (sha256Text(sql) !== ORGANIZATION_MIGRATION_SHA256) {
    throw gateError('ORGANIZATION_SCHEMA_SOURCE_DRIFT', 'A referência SQL da 0042 mudou; revisar o coletor.');
  }
  const schema = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
  const parts = schema.split('-- Organization management (migration 0042)');
  if (parts.length !== 2) throw gateError('ORGANIZATION_SCHEMA_SOURCE_DRIFT', 'Baseline local da 0042 não identificado.');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(parts[0]);
    db.exec(sql); // Local in-memory reference only; never passed to Wrangler.
    return Object.fromEntries(Object.entries(ORGANIZATION_SCHEMA_QUERIES).map(([key, query]) => [key, db.prepare(query).all()]));
  } finally { db.close(); }
}

export function evaluateOrganizationSchema(observed, expected = expectedOrganizationSchema()) {
  const mismatches = [], checks = [];
  const expectedObjects = expected.objects;
  const actualObjects = observed.objects || [];
  for (const object of expectedObjects) {
    const matches = actualObjects.filter(r => r.name === object.name && r.type === object.type);
    const actual = matches.length === 1 ? matches[0] : null;
    let want, got;
    if (ADDED_COLUMNS[object.name]) {
      want = ADDED_COLUMNS[object.name].map(n => columnDefinition(object.sql, n));
      got = ADDED_COLUMNS[object.name].map(n => columnDefinition(actual?.sql, n));
    } else {
      want = tokens(object.sql);
      got = tokens(actual?.sql);
    }
    const ok = actual?.tbl_name === object.tbl_name && JSON.stringify(want) === JSON.stringify(got);
    checks.push({ name: object.name, type: object.type, ok,
      expectedDigest: sha256Text(JSON.stringify(want)), observedDigest: sha256Text(JSON.stringify(got)) });
    if (!ok) mismatches.push('definition:' + object.name);
  }
  const unexpected = actualObjects.filter(r => !expectedObjects.some(e => e.name === r.name && e.type === r.type));
  if (unexpected.length) mismatches.push('unexpected_namespace_objects');
  for (const key of Object.keys(ORGANIZATION_SCHEMA_QUERIES).filter(k => k !== 'objects')) {
    const want = normalized(key, expected[key]);
    const got = normalized(key, observed[key] || []);
    const ok = JSON.stringify(want) === JSON.stringify(got);
    checks.push({ name: key, ok, expectedDigest: sha256Text(JSON.stringify(want)), observedDigest: sha256Text(JSON.stringify(got)) });
    if (!ok) mismatches.push(key);
  }
  // Export bounded known names/digests only, never raw SQL/default values.
  return { version: 1, migration: ORGANIZATION_MIGRATION, migrationSha256: ORGANIZATION_MIGRATION_SHA256,
    compatible: mismatches.length === 0, mismatches, checks, unexpectedObjectCount: unexpected.length,
    expectedCounts: { addedColumns: 12, tables: 4, namedIndexes: 5, triggers: 11 },
    remoteQueriesReadOnly: true, digest: sha256Text(JSON.stringify(checks)) };
}

export async function readOrganizationSchema(configPath, injected = {}) {
  const observed = {};
  for (const [key, sql] of Object.entries(ORGANIZATION_SCHEMA_QUERIES)) {
    observed[key] = rowsFromD1Json(await runWranglerJson(
      ['d1', 'execute', PRODUCTION_DATABASE_NAME, '--remote', '--command', sql], configPath, injected));
  }
  return evaluateOrganizationSchema(observed);
}

function checkedLedger(rows) {
  const names = new Set(), ids = new Set();
  const clean = rows.map(row => {
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || ids.has(row.id) ||
        typeof row.name !== 'string' || !/^\d{4}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/.test(row.name) ||
        names.has(row.name) || typeof row.appliedAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(row.appliedAt)) {
      throw gateError('ORGANIZATION_LEDGER_INVALID', 'Ledger inválido ou duplicado; nenhuma escrita foi executada.');
    }
    names.add(row.name); ids.add(row.id);
    return { id: row.id, name: row.name, appliedAt: row.appliedAt };
  }).sort((a, b) => a.id - b.id);
  for (const name of ['0007_create_organization_limit_requests.sql', '0016_map_panel_navigation_and_quota.sql', ORGANIZATION_MIGRATION]) {
    if (!names.has(name)) throw gateError('ORGANIZATION_LEDGER_REQUIRED', 'Migration necessária ausente do ledger; revisar somente leitura.');
  }
  return clean;
}

export async function collectOrganizationPostValidation(configPath, remote, migration, injected = {}) {
  if (migration.name !== ORGANIZATION_MIGRATION || migration.sha256 !== ORGANIZATION_MIGRATION_SHA256 ||
      remote.identity.name !== PRODUCTION_DATABASE_NAME || remote.identity.id !== PRODUCTION_DATABASE_ID) {
    throw gateError('ORGANIZATION_POSTVALIDATE_TARGET_INVALID', 'Alvo fixo da pós-validação 0042 divergente.');
  }
  const initialLedger = checkedLedger(remote.ledger);
  const schema = await readOrganizationSchema(configPath, injected);
  const backup = await captureTimeTravelBookmark(configPath, injected);
  const ledger = checkedLedger(await queryLedger(configPath, injected));
  if (JSON.stringify(initialLedger) !== JSON.stringify(ledger)) {
    throw gateError('ORGANIZATION_POSTVALIDATE_LEDGER_DRIFT', 'Ledger mudou durante a leitura; preservar evidência e revisar sem retry automático.');
  }
  const pending = computePendingState(remote.localMigrations, ledger.map(r => r.name), ORGANIZATION_MIGRATION);
  return { schema, ledger: { appliedCount: ledger.length, rows: ledger, digest: sha256Text(JSON.stringify(ledger)) },
    pending, backup, ledgerStableAcrossCollection: true, atomicDatabaseSnapshot: false };
}
