import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Restore only the exact atomic transaction edits. All older independent
// baselines and their negative controls remain unchanged.
export const atomicityFixture = JSON.parse(readFileSync(new URL('../fixtures/admin-user-atomicity-preservation.json', import.meta.url), 'utf8'));
assert.equal(atomicityFixture.base, '78ed014e50da5ea920e8f81a68a8c871ecbc322f');
export function restoreAdminUserAtomicity(path, source) {
  source = source.replace(/\r\n/g, '\n');
  for (const { before, after } of [...(atomicityFixture.changes[path] || [])].reverse()) {
    assert.equal(source.split(after).length - 1, 1, `exact reviewed password edit / user safety / atomicity: ${path}`);
    source = source.replace(after, before);
  }
  return source;
}
