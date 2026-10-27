import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { restoreAdminUsersSafety, usersSafetyFixture } from './helpers/admin-users-safety-preservation.mjs';

test('exact inverse preserves every independent predecessor hash', () => {
  for (const [path, expected] of Object.entries(usersSafetyFixture.baseHashes)) {
    const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
    assert.equal(createHash('sha256').update(restoreAdminUsersSafety(path, source)).digest('hex'), expected, path);
  }
});

for (const [path, before, after] of [
  ['src/pages/Admin/components/AdminUserManagerLegacy.tsx', '!selected || busy || mutationPending.current', '!selected'],
  ['src/pages/Admin/components/AdminUserManagerLegacy.tsx', 'selectionIsCurrent(targetId, targetVersion)', 'true'],
  ['functions/api/admin/users/[id]/organizations/[organizationId].js', 'await changeMembership(env, { userId, organizationId, accessLevel })', 'Promise.resolve()'],
  ['functions/api/admin/users/[id].js', 'AND ${guard.sql}', ''],
  ['functions/api/admin/organizations/[id]/users.js', 'WHERE ${guard.sql}', ''],
]) test(`inverse rejects removal of the reviewed safety contract: ${path} / ${before}`, () => {
  const source = readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  assert.ok(source.includes(before));
  assert.throws(() => restoreAdminUsersSafety(path, source.replace(before, after)), /exact reviewed password edit \/ user safety/);
});
