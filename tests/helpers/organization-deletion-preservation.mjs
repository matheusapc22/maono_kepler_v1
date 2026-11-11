import assert from 'node:assert/strict';
// Exact inverse of the three reviewed storage-write fence additions only.
// Historical hashes remain frozen; any other source drift remains observable.
const additions = [
  'import { assertDropboxPathWritable } from "./dropbox.js";\n',
  '  await assertDropboxPathWritable(env, safePath);\n',
  '    signal: AbortSignal.timeout(8_000),\n',
];
export function restoreOrganizationDeletionFence(path, source) {
  if (path !== 'functions/_lib/organizations.js') return source;
  source = source.replace(/\r\n/g, '\n');
  for (const addition of additions) {
    assert.equal(source.split(addition).length - 1, 1, 'exact reviewed organization deletion fence');
    source = source.replace(addition, '');
  }
  return source;
}
