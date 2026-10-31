import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { gateError, sha256Text } from './production-migration-lib.mjs';

// Public, versioned sources only. Never derive a reference from remote metadata.
export const ORGANIZATION_SCHEMA_SOURCES = Object.freeze({
  'schema.sql': '84007790e4e1969d69737dfbaf46193563965619e0a038ca79bbd6551f6e5e18',
  'migrations/0002_organizations_files.sql': '4fd20c1d27a6e7030e28ffa84188b3fd5193ffe57b33dee3063467e68d26bd4d',
  'migrations/0007_create_organization_limit_requests.sql': 'b1f3c6c598fd54bcd8e6a52f05b27b1131a117ffbafad90b0383579b34319ebb',
  'migrations/0009_organization_storage_invariant.sql': '1dd135c0e516598025ae79d6de0c7a1dfedbcee24cf1d73682584dfb2ddb82fb',
  'migrations/0016_map_panel_navigation_and_quota.sql': 'f5617b81fe7a9335cddd446a88bff2a8cd04d1ecd258207b43c96c5e9f7408d8',
  'migrations/0035_ticket_report_exports.sql': '43029aa0e4126521aa584becb88c12eec5c70c083dd7c2bde9085951ad8e4229',
  'migrations/0039_project_save_operations.sql': '0ef8d78946235a089b754f818e35c83aa3a754a2e3092d09d86c88248cd98ab8',
  'migrations/0040_project_preview_operations.sql': 'de1937e98e405fdf2ebb2c13e6b077a4ff3b767580559fbcb279b331e1cc5202',
  'migrations/0042_organization_management.sql': 'e47d8a1444c8c14681589733867a5f00e2490835ffc588e0de9dde1bcac6aa00',
});
export const ORGANIZATION_SCHEMA_PROFILES = Object.freeze(['canonical-bootstrap-v1', 'migrated-0002-0042-v1']);
const MIGRATION = 'migrations/0042_organization_management.sql';
const TRIGGERS = Object.freeze({
  'migrations/0035_ticket_report_exports.sql': [
    'ticket_export_epoch_organizations_insert', 'ticket_export_epoch_organizations_update', 'ticket_export_epoch_organizations_delete',
  ],
  'migrations/0039_project_save_operations.sql': [
    'project_save_auth_organizations_insert', 'project_save_auth_organizations_update',
    'project_save_auth_organizations_delete', 'project_save_deleted_organizations',
  ],
  'migrations/0040_project_preview_operations.sql': ['project_preview_deleted_organization'],
});
const COMMON_LEDGER = ['0007_create_organization_limit_requests.sql', '0016_map_panel_navigation_and_quota.sql', '0042_organization_management.sql'];
const defaultRead = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const sourceError = () => gateError('ORGANIZATION_SCHEMA_SOURCE_DRIFT', 'Fontes locais da referência estrutural mudaram; revisar o coletor.');

// Complete definitions from hash-pinned files, not a general SQL parser. These
// eight bodies contain no nested END; extraction is fixed-name and fail-closed.
function attachedTriggers(sql, names) {
  return names.map(name => {
    const matches = [...sql.matchAll(new RegExp('^CREATE TRIGGER ' + name + '\\b[\\s\\S]*?\\bEND;', 'gm'))];
    if (matches.length !== 1 || !/\bON organizations\s+BEGIN\b/.test(matches[0][0])) throw sourceError();
    return matches[0][0];
  });
}

// Every mutating statement below executes only in an empty :memory: database.
// The historical reference is complete for the collector's six tables and all
// their attached objects, not a replay/certification of the entire database.
export function buildOrganizationSchemaReferences(queries, readSource = defaultRead) {
  const sources = Object.fromEntries(Object.entries(ORGANIZATION_SCHEMA_SOURCES).map(([path, digest]) => {
    let sql;
    try { sql = readSource(path); } catch { throw sourceError(); }
    if (typeof sql !== 'string' || sha256Text(sql) !== digest) throw sourceError();
    return [path, sql];
  }));
  const descriptors = [
    { id: ORGANIZATION_SCHEMA_PROFILES[0], paths: ['schema.sql', MIGRATION], requiredMigrations: COMMON_LEDGER },
    { id: ORGANIZATION_SCHEMA_PROFILES[1], paths: Object.keys(sources).filter(path => path !== 'schema.sql'),
      requiredMigrations: Object.keys(sources).filter(path => path.startsWith('migrations/')).map(path => path.slice(11)) },
  ];
  return descriptors.map(profile => {
    const db = new DatabaseSync(':memory:');
    try {
      if (profile.id === ORGANIZATION_SCHEMA_PROFILES[0]) {
        const parts = sources['schema.sql'].split('-- Organization management (migration 0042)');
        if (parts.length !== 2) throw sourceError();
        db.exec(parts[0]);
        db.exec(sources[MIGRATION]);
      } else {
        // Fixed scaffolds only satisfy CREATE/ALTER dependencies. Neither table
        // is among the six tables certified by the collector.
        db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY, active INTEGER); CREATE TABLE projects(id INTEGER PRIMARY KEY, active INTEGER);');
        for (const path of profile.paths.filter(path => !Object.hasOwn(TRIGGERS, path))) db.exec(sources[path]);
        // Render the eight older attached triggers after ALTERs; no data is
        // inserted. This avoids requiring unrelated operational tables in the
        // scaffold and yields the exact same final trigger definitions.
        for (const [path, names] of Object.entries(TRIGGERS)) {
          for (const trigger of attachedTriggers(sources[path], names)) db.exec(trigger);
        }
      }
      return { id: profile.id, requiredMigrations: [...profile.requiredMigrations],
        sources: profile.paths.map(path => ({ path, sha256: ORGANIZATION_SCHEMA_SOURCES[path] })),
        schema: Object.fromEntries(Object.entries(queries).map(([key, sql]) => [key, db.prepare(sql).all()])) };
    } finally { db.close(); }
  });
}
