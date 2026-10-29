import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exact inverse of this maintenance's moves. Historical behavior hashes are not
// recalculated; the moved definitions are independently checked by runtime and
// extraction tests, so moving a policy cannot hide a later policy mutation.
const fixture=JSON.parse(readFileSync(new URL('../fixtures/lint-module-extraction-preservation.json',import.meta.url),'utf8'));
assert.equal(fixture.base,'e47deac18888195b945a244dadb9e27c5902638f');
export function restoreLintModuleExtraction(path,source) {
  source=source.replace(/\r\n/g,'\n');
  for(const {before,after} of [...(fixture.changes[path]||[])].reverse()) {
    assert.equal(source.split(after).length-1,1,`exact lint extraction: ${path}`);
    source=source.replace(after,before);
  }
  return source;
}
