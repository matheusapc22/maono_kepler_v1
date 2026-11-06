import { ManagementError } from './organization-management-contract.js';

// One comparison rule for availability, imports, lifecycle writes and audit.
// Display names are deliberately not replaced by this key.
export function canonicalOrganizationName(name) {
  return String(name).normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase().normalize('NFKC');
}
export function organizationIdentity(name, random = crypto) {
  const base = String(name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 54).replace(/-+$/g, '') || 'organizacao';
  // Rejection sampling avoids modulo bias, including leading zeroes.
  let value;
  do { value = random.getRandomValues(new Uint32Array(1))[0]; } while (value >= 4000000000);
  const suffix = String(value % 1000000000).padStart(9, '0');
  const slug = `${base}-${suffix}`;
  return { suffix, slug, path: `/projects/${slug}` };
}
export async function identitySchemaReady(env) {
  return Boolean(await env.DB.prepare("SELECT 1 FROM pragma_table_info('organizations') WHERE name='canonical_name'").first());
}
export async function assertOrganizationNameAvailable(env, name, ownId = null) {
  const key = canonicalOrganizationName(name);
  const rows = (await env.DB.prepare('SELECT id,name FROM organizations').all()).results || [];
  if (rows.some(row => Number(row.id) !== Number(ownId) && canonicalOrganizationName(row.name) === key)) {
    throw new ManagementError('Este nome já está em uso por outra organização.', 409, 'ORGANIZATION_NAME_EXISTS');
  }
  return key;
}
export function nameConstraintError(error) {
  return /organizations\.canonical_name|ORGANIZATION_NAME_EXISTS/.test(String(error));
}
