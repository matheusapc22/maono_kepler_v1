import { readFileSync } from 'node:fs';
import { auditOrganizationIdentities } from './preflight-organization-identity.mjs';
import { canonicalOrganizationName } from '../../functions/_lib/organization-name.js';
import { ORGANIZATION_SCHEMA_QUERIES, compareOrganizationSchema } from './organization-management-schema.mjs';
import { buildOrganizationSchemaReferences, buildOrganizationIdentityReferences,
  IDENTITY_MIGRATION, IDENTITY_MIGRATION_SHA256 } from './organization-schema-references.mjs';
import { PRODUCTION_DATABASE_NAME, PRODUCTION_DATABASE_ID, gateError, sha256Text,
  runWranglerJson, computePendingState, captureTimeTravelBookmark } from './production-migration-lib.mjs';

export { IDENTITY_MIGRATION, IDENTITY_MIGRATION_SHA256 };
const fail = (code, message) => { throw gateError('IDENTITY_0043_' + code, message); };
const quote = s => "'" + s.replaceAll("'", "''") + "'";
const table = 'organization_creation_identities';
const indexes = ['idx_organization_canonical_name', 'idx_organization_numeric_suffix',
  ...[1, 2, 3, 4].map(n => `sqlite_autoindex_${table}_${n}`)];
export const IDENTITY_SCHEMA_QUERIES = Object.freeze({
  ...ORGANIZATION_SCHEMA_QUERIES,
  objects: ORGANIZATION_SCHEMA_QUERIES.objects.replace(' ORDER BY type,name;',
    " OR tbl_name='organization_creation_identities' OR name GLOB 'org_identity_*'" +
    " OR name GLOB 'organization_creation_*' OR name GLOB 'idx_organization_canonical_*'" +
    " OR name GLOB 'idx_organization_numeric_*' ORDER BY type,name;"),
  ['columns:' + table]: `PRAGMA table_info(${table});`,
  ['foreignKeys:' + table]: `PRAGMA foreign_key_list(${table});`,
  ['indexes:' + table]: `PRAGMA index_list(${table});`,
  ...Object.fromEntries(indexes.map(n => ['indexColumns:' + n, `PRAGMA index_xinfo(${n});`])),
});
const fields = {
  objects: ['type','name','tbl_name','sql'], columns: ['cid','name','type','notnull','dflt_value','pk'],
  foreignKeys: ['id','seq','table','from','to','on_update','on_delete','match'],
  indexes: ['seq','name','unique','origin','partial'],
  indexColumns: ['seqno','cid','name','desc','coll','key'],
};
function asSelect(sql) {
  const pragma = sql.match(/^PRAGMA (\w+)\((\w+)\);$/);
  return pragma ? `SELECT * FROM pragma_${pragma[1]}('${pragma[2]}')` : sql.replace(/;$/, '');
}
function jsonRows(sql, names) {
  return `(SELECT json_group_array(json_object(${names.flatMap(n => [quote(n), '"' + n + '"']).join(',')})) FROM (${asSelect(sql)}))`;
}
const inventoryFields = ['id','name','slug','dropbox_root_path'];
const inventorySql = 'SELECT id,name,slug,dropbox_root_path FROM organizations ORDER BY id';
const ledgerSql = 'SELECT id,name,applied_at FROM d1_migrations ORDER BY id';
// D1 limits SQL functions to 32 arguments. Aggregate key/value rows instead of
// constructing one json_object with two arguments per metadata query.
const schemaJson = '(SELECT json_group_object(k,json(v)) FROM (' +
  Object.entries(IDENTITY_SCHEMA_QUERIES).map(([key, sql]) =>
    `SELECT ${quote(key)} AS k, ${jsonRows(sql, fields[key.split(':')[0]])} AS v`).join(' UNION ALL ') + '))';
// ONE fixed read-only statement: the count, all organizations, ledger and all
// certified metadata share one SQLite read snapshot. No LIMIT, active filter,
// caller-supplied SQL or use of the minimized QA inventory.
export const IDENTITY_SNAPSHOT_SQL = `SELECT (SELECT COUNT(*) FROM organizations) AS total,
  ${jsonRows(inventorySql, inventoryFields)} AS inventory_json,
  ${jsonRows(ledgerSql, ['id','name','applied_at'])} AS ledger_json,
  ${schemaJson} AS schema_json;`;

function strictResponse(value) {
  const entries = Array.isArray(value) ? value : [value];
  if (entries.length !== 1 || entries[0]?.success !== true ||
      !Array.isArray(entries[0].results) || entries[0].results.length !== 1) {
    fail('RESPONSE_INVALID', 'Resposta D1 incompleta ou sem sucesso explícito.');
  }
  return entries[0].results[0];
}
function strictLedger(rows, phase) {
  const ids = new Set(), names = new Set();
  if (!Array.isArray(rows)) fail('LEDGER_INVALID', 'Ledger inválido.');
  for (const r of rows) {
    if (!r || !Number.isSafeInteger(r.id) || r.id <= 0 || ids.has(r.id) ||
        typeof r.name !== 'string' || !/^\d{4}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/.test(r.name) || names.has(r.name) ||
        typeof r.applied_at !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(r.applied_at)) {
      fail('LEDGER_INVALID', 'Ledger inválido ou duplicado.');
    }
    ids.add(r.id); names.add(r.name);
  }
  if (!names.has('0042_organization_management.sql') || names.has(IDENTITY_MIGRATION) !== (phase === 'post')) {
    fail('LEDGER_PHASE', '0042 deve estar aplicada; o estado de 0043 deve corresponder à fase selecionada.');
  }
  return rows.map(r => ({ id:r.id, name:r.name, appliedAt:r.applied_at }));
}

export function evaluateIdentitySchema(observed, phase) {
  if (!['pre','post'].includes(phase)) fail('PHASE_INVALID', 'Perfil 0043 deve ser pre ou post.');
  const references = phase === 'pre' ? buildOrganizationSchemaReferences(IDENTITY_SCHEMA_QUERIES)
    : buildOrganizationIdentityReferences(IDENTITY_SCHEMA_QUERIES);
  const results = references.map(reference => ({ reference, report: compareOrganizationSchema(observed, reference.schema, {
    queries: IDENTITY_SCHEMA_QUERIES, migration: IDENTITY_MIGRATION, migrationSha256: IDENTITY_MIGRATION_SHA256,
    expectedCounts: phase === 'pre' ? { addedColumns:12,tables:4,namedIndexes:5,triggers:11 }
      : { addedColumns:13,tables:5,namedIndexes:7,triggers:14 },
  }) }));
  const matches = results.filter(r => r.report.compatible);
  const selected = matches.length === 1 ? matches[0] : null;
  return { ...(selected?.report ?? results[0].report), compatible:Boolean(selected), phase,
    profile:selected?.reference.id ?? null, requiredMigrations:selected?.reference.requiredMigrations ?? [],
    referenceSources:selected?.reference.sources ?? [],
    profiles:results.map(r => ({ id:r.reference.id, compatible:r.report.compatible, digest:r.report.digest })) };
}

export function validateIdentitySnapshot(raw, phase) {
  if (!raw || ['inventory_json','ledger_json','schema_json'].some(k => typeof raw[k] !== 'string') ||
      ['inventory_json','ledger_json','schema_json'].reduce((n,k) => n + Buffer.byteLength(raw[k]), 0) > 1800000) {
    fail('SNAPSHOT_SIZE', 'Snapshot ausente ou excede o orçamento seguro de 1,8 MB; nunca truncar.');
  }
  let rows, ledgerRows, observed;
  try { rows=JSON.parse(raw.inventory_json); ledgerRows=JSON.parse(raw.ledger_json); observed=JSON.parse(raw.schema_json); }
  catch { fail('SNAPSHOT_INVALID', 'Snapshot incompleto ou JSON inválido.'); }
  let preflight;
  try { preflight=auditOrganizationIdentities(rows); }
  catch { fail('INVENTORY_INVALID', 'Inventário inválido; nenhuma linha pode ser omitida.'); }
  if (!Number.isSafeInteger(raw.total) || raw.total < 0 || rows.length !== raw.total ||
      rows.some((r,i) => i > 0 && r.id <= rows[i-1].id)) {
    fail('INVENTORY_INCOMPLETE', 'Contagem, ordem ou completude do inventário divergente.');
  }
  if (!preflight.ok) fail('CONFLICTS', 'Conflito de nome Unicode, sufixo ou pasta; resolver por decisão separada.');
  const ledger = strictLedger(ledgerRows, phase);
  const schema = evaluateIdentitySchema(observed, phase);
  if (!schema.compatible) fail('SCHEMA_INCOMPATIBLE', 'Schema fora dos perfis exatos de 0043.');
  if (schema.requiredMigrations.some(n => !ledger.some(r => r.name === n))) {
    fail('LEDGER_REQUIRED', 'Ledger não comprova todas as fontes estruturais do perfil.');
  }
  // Raw strings are hashed before normalization; a same-count rename, Unicode
  // spelling change, ID substitution or path change invalidates authorization.
  const inventoryDigest = sha256Text(JSON.stringify(rows));
  const ledgerDigest = sha256Text(JSON.stringify(ledgerRows));
  const schemaDigest = sha256Text(JSON.stringify(observed));
  const report = { version:1, phase, schema, inventory:{ complete:true, total:raw.total,
    digest:inventoryDigest, includesPaused:true, conflicts:0 }, ledger:{ rows:ledger, digest:ledgerDigest },
    schemaDigest, atomicDatabaseSnapshot:true, remoteQueriesReadOnly:true,
    digest:sha256Text(JSON.stringify({ phase,inventoryDigest,ledgerDigest,schemaDigest })) };
  return { report, rows, ledgerRows, observed };
}

export async function collectIdentityEvidence(configPath, remote, migration, phase, injected = {}) {
  if (migration.name !== IDENTITY_MIGRATION || migration.sha256 !== IDENTITY_MIGRATION_SHA256 ||
      remote.identity.name !== PRODUCTION_DATABASE_NAME || remote.identity.id !== PRODUCTION_DATABASE_ID) {
    fail('TARGET_INVALID', 'Alvo fixo ou hash da migration 0043 divergente.');
  }
  const value = await runWranglerJson(['d1','execute',PRODUCTION_DATABASE_NAME,'--remote','--command',IDENTITY_SNAPSHOT_SQL], configPath, injected);
  const evidence = validateIdentitySnapshot(strictResponse(value), phase);
  if (JSON.stringify(remote.ledger) !== JSON.stringify(evidence.report.ledger.rows)) {
    fail('LEDGER_DRIFT', 'Ledger mudou durante a coleta; novo audit obrigatório.');
  }
  evidence.report.pending = computePendingState(remote.localMigrations, evidence.report.ledger.rows.map(r => r.name), IDENTITY_MIGRATION);
  return evidence;
}

export function assertIdentityEvidenceUnchanged(previous, current) {
  if (!previous || previous.phase !== 'pre' || current.phase !== 'pre' || previous.digest !== current.digest) {
    fail('AUDIT_DRIFT', 'Inventário, ledger ou schema mudou; nova auditoria e autorização são obrigatórias.');
  }
}

const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value)
  : `CAST(X'${Buffer.from(value, 'utf8').toString('hex')}' AS TEXT)`;
const assertion = predicate => `SELECT CASE WHEN (${predicate}) THEN 1 ELSE abs(-9223372036854775808) END;\n`;

// Audit and apply deterministically render the SAME reviewed execution file.
// Only equality assertions precede the untouched pinned SQL. No new writer,
// table, transaction command, template SQL input, or extra migration is added.
// Wrangler applies one migration atomically, including the ledger insert.
export function guardedIdentityMigration(evidence, sourceSql = readFileSync(new URL('../../migrations/' + IDENTITY_MIGRATION, import.meta.url), 'utf8')) {
  if (evidence.report.phase !== 'pre' || sha256Text(sourceSql) !== IDENTITY_MIGRATION_SHA256) {
    fail('SOURCE_INVALID', 'Somente o SQL revisado de 0043 pode ser preparado.');
  }
  const statements = [assertion(`(SELECT COUNT(*) FROM organizations)=${evidence.rows.length}`)];
  for (const row of evidence.rows) {
    statements.push(assertion(`EXISTS(SELECT 1 FROM organizations WHERE ${inventoryFields.map(k =>
      `"${k}" IS ${literal(row[k])} COLLATE BINARY`).join(' AND ')})`));
  }
  // Ledger and every observed metadata query are checked inside the same write
  // transaction as the migration, closing the final read-to-write race.
  for (const [sql, rows, names] of [[ledgerSql,evidence.ledgerRows,['id','name','applied_at']],
    ...Object.entries(IDENTITY_SCHEMA_QUERIES).map(([k,sql]) => [sql,evidence.observed[k],fields[k.split(':')[0]]])]) {
    const select = asSelect(sql);
    statements.push(assertion(`(SELECT COUNT(*) FROM (${select}))=${rows.length}`));
    for (const row of rows) statements.push(assertion(`EXISTS(SELECT 1 FROM (${select}) WHERE ${names.map(k =>
      `"${k}" IS ${literal(row[k])} COLLATE BINARY`).join(' AND ')})`));
  }
  // Fail closed, never truncate or batch into separately committed pieces.
  // Conservative below D1's 100 KB per-statement limit (hex doubles bytes).
  if (statements.some(s => Buffer.byteLength(s) > 90000)) fail('GUARD_TOO_LARGE', 'Uma prova excede o limite seguro de SQL; revisão necessária, sem truncar.');
  const sql = statements.join('') + sourceSql;
  if (Buffer.byteLength(sql) > 8000000) fail('EXECUTION_TOO_LARGE', 'Arquivo guardado excede o orçamento operacional de 8 MB; revisão necessária.');
  return { sql, sha256:sha256Text(sql), sourceSha256:IDENTITY_MIGRATION_SHA256,
    requestSha256:sha256Text(identityWranglerRequest(sql)),
    assertionCount:statements.length, bytes:Buffer.byteLength(sql), atomic:true };
}

export function identityApprovalEvidence(evidence, execution) {
  return sha256Text(JSON.stringify({ snapshot:evidence.report.digest,
    executionSha256:execution.sha256, requestSha256:execution.requestSha256 }));
}

// Exact ledger suffix from Wrangler 4.140.0 buildMigrationQuery; verified by
// the real CLI against a loopback API in the dedicated offline transport test.
export function identityWranglerRequest(sql) {
  return sql + `\nINSERT INTO "d1_migrations" (name)\nvalues ('${IDENTITY_MIGRATION}');`;
}

export async function collectIdentityPostValidation(configPath, remote, migration, injected = {}) {
  const evidence = await collectIdentityEvidence(configPath, remote, migration, 'post', injected);
  const backup = await captureTimeTravelBookmark(configPath, injected);
  return { ...evidence.report, backup, normalizationRule:'NFKC/trim/Unicode-whitespace/lowercase/NFKC',
    legacyWritersMayOmitCanonicalName:true, rolloutRequiresFreshValidation:true };
}

// Export the exact pure rule for offline parity tests; no application hook.
export { canonicalOrganizationName };
