import { readFileSync } from 'node:fs';

// Independent construction from the complete canonical dependency context.
// Production reference generation instead executes a migration slice with a
// minimal scaffold. No production builder is imported here.
export function installMigratedOrganizationSchema(db, { include0042 = true } = {}) {
  const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
  const parts = read('schema.sql').split('-- Organization management (migration 0042)');
  if (parts.length !== 2) throw new Error('Expected a unique 0042 boundary');
  const create = /CREATE TABLE IF NOT EXISTS organizations \([\s\S]*?\n\);/g;
  const original = [...read('migrations/0002_organizations_files.sql').matchAll(create)];
  if (original.length !== 1 || [...parts[0].matchAll(create)].length !== 1) throw new Error('Expected a unique organizations definition');
  db.exec(parts[0].replace(create, () => original[0][0] + '\n' + read('migrations/0009_organization_storage_invariant.sql')));
  if (include0042) db.exec(read('migrations/0042_organization_management.sql'));
}
