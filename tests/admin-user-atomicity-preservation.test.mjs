import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { atomicityFixture, restoreAdminUserAtomicity } from './helpers/admin-user-atomicity-preservation.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
for (const [path, expected] of Object.entries(atomicityFixture.baseHashes)) {
  test(`atomic transaction inverse preserves the published predecessor: ${path}`, () => {
    assert.equal(createHash('sha256').update(restoreAdminUserAtomicity(path, read(path))).digest('hex'), expected);
  });
}
for (const [path, before, after] of [
  ['functions/_lib/organizations.js', 'if (profile) statements.push(profile);', 'if (profile) await profile.run();'],
  ['functions/_lib/organizations.js', 'role: patch.role ?? null', 'role: null'],
  ['functions/_lib/owner-retention.js', 'audit ? [guardedAudit(env, mutationGuard, audit)] : []', '[]'],
  ['functions/api/admin/organization-users/[id].js', 'audit: {', 'untrackedAudit: {'],
  ['functions/api/admin/organizations/[id]/users.js', '[mutation, audit, await listOrganizationUsers(env, organizationId, true)]', '[mutation, await listOrganizationUsers(env, organizationId, true)]'],
  ['functions/api/admin/users/[id]/organizations/[organizationId].js', 'audit: {', 'untrackedAudit: {'],
  ['functions/api/organizations/[id]/users/[userId].js', 'audit: {', 'untrackedAudit: {'],
]) test(`atomicity inverse rejects removal of transaction protection: ${path} / ${before}`, () => {
  const source = read(path);
  assert.ok(source.includes(before));
  assert.throws(() => restoreAdminUserAtomicity(path, source.replace(before, after)), /exact reviewed.*atomicity/);
});
