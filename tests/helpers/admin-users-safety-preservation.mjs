import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreAdminUserAtomicity } from './admin-user-atomicity-preservation.mjs';

// Exact, reviewable inverse of this functional change. Existing password,
// progressive-loading and UI baselines remain independently pinned.
export const usersSafetyFixture = JSON.parse(readFileSync(new URL('../fixtures/admin-users-safety-preservation.json', import.meta.url), 'utf8'));
assert.equal(usersSafetyFixture.base, 'e47deac18888195b945a244dadb9e27c5902638f');
export function restoreAdminUsersSafety(path, source) {
  source = restoreAdminUserAtomicity(path, source);
  for (const { before, after } of [...(usersSafetyFixture.changes[path] || [])].reverse()) {
    assert.equal(source.split(after).length - 1, 1, `exact reviewed password edit / user safety: ${path}`);
    source = source.replace(after, before);
  }
  return source;
}
