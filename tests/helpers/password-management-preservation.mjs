import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { restoreTicketRequestSchema } from './ticket-request-schema-preservation.mjs';

// Exact inverse of the reviewed password fix, not a new baseline for unrelated
// domain/UI behavior. Existing independently pinned hashes remain unchanged.
const fixture = JSON.parse(readFileSync(new URL('../fixtures/password-management-preservation.json', import.meta.url), 'utf8'));
assert.equal(fixture.base, 'd8546346eff59f24c3a9c0ac906fd31ccadaedb2');
assert.equal(fixture.reviewed, '433144e3bd466e0df5eedcc5fca2f90d4138e66e');

export function restorePasswordManagement(path, source) {
  source = restoreTicketRequestSchema(path, source);
  for (const { before, after } of [...(fixture.changes[path] || [])].reverse()) {
    assert.equal(source.split(after).length - 1, 1, `exact reviewed password edit: ${path}`);
    source = source.replace(after, before);
  }
  return source;
}
