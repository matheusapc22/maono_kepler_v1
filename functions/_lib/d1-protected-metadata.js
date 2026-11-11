// Cloudflare workerd owns these tables. Never attempt their protected PRAGMAs.
// Sources: cloudflare/workerd@aa494794c44a900592c8281b191302d3b0a6e2a5
// src/workerd/util/sqlite-{metadata,kv}.c++ (SQLite omits IF NOT EXISTS in stored DDL).
const definitions = Object.freeze({
  _cf_METADATA: 'CREATE TABLE _cf_METADATA (key INTEGER PRIMARY KEY, value BLOB)',
  _cf_KV: 'CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB) WITHOUT ROWID',
});
const tokens = sql => typeof sql === 'string' ? sql.trim().replace(/;$/, '').match(/[A-Za-z_][A-Za-z_0-9]*|[^\s]/g)?.map(t => t.toLowerCase()).join(' ') : null;
export const protectedMetadataName = name => typeof name === 'string' && name.toLowerCase().startsWith('_cf_');
export function classifyProtectedMetadata(objects) {
  const recognized = [], issues = [];
  for (const row of objects) {
    if (!protectedMetadataName(row.name)) continue;
    const expected = Object.hasOwn(definitions, row.name) ? definitions[row.name] : null;
    const associated = objects.some(other => other !== row && String(other.tbl_name).toLowerCase() === row.name.toLowerCase());
    if (!expected || row.type !== 'table' || row.tbl_name !== row.name || tokens(row.sql) !== tokens(expected) || associated) {
      issues.push({code: 'PROTECTED_METADATA_UNREVIEWED', name: row.name});
    } else recognized.push(row.name);
  }
  return {recognized, issues};
}
