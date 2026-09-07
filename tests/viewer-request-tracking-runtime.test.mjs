import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

const [runtime, api] = await Promise.all([
  source('src/pages/Kepler/change-requests/ViewerRequestTrackingRuntime.tsx'),
  source('src/pages/Kepler/change-requests/viewer-request-tracking-api.ts'),
]);

test('Viewer tracking exposes canonical lifecycle status, feedback and lineage', () => {
  for (const label of [
    'Enviada',
    'Em revisão',
    'Aprovada',
    'Rejeitada',
    'Conflito',
    'Aplicando',
    'Aplicada',
    'Substituída',
  ]) {
    assert.match(runtime, new RegExp(label));
  }
  assert.match(runtime, /Feedback da revisão/);
  assert.match(runtime, /resubmittedFromRequestId/);
  assert.match(runtime, /resubmittedToRequestId/);
  assert.match(runtime, /appliedRevision/);
});

test('Viewer tracking refreshes periodically and supports explicit refresh without caching', () => {
  assert.match(runtime, /setInterval\(\(\) => void refresh\(\), 30_000\)/);
  assert.match(runtime, /Atualizar/);
  assert.match(api, /cache: "no-store"/);
  assert.match(api, /credentials: "include"/);
  assert.match(api, /AbortSignal/);
});

test('correction flow preserves local work and refuses stale or unsaved state', () => {
  assert.match(runtime, /Há alterações locais de uma revisão anterior\. Elas foram preservadas/);
  assert.match(runtime, /Suas alterações locais existentes foram preservadas/);
  assert.match(runtime, /requestItem\.baseRevision !== baseRevision/);
  assert.match(runtime, /engineState\.hasUnsavedChanges/);
  assert.match(runtime, /assertCurrentRevision\(baseRevision\)/);
  assert.match(runtime, /workingCopy\.baseRevision !== baseRevision/);
});

test('resubmission requires explicit corrected operations and reason and carries idempotency', () => {
  assert.match(runtime, /Selecione pelo menos uma alteração corrigida/);
  assert.match(runtime, /Informe o motivo da correção/);
  assert.match(runtime, /selectedIds\.includes\(operation\.id\)/);
  assert.match(runtime, /idempotencyKey: `\$\{workingCopy\.submissionKey\}:resubmit:\$\{source\.id\}`/);
  assert.match(api, /"Idempotency-Key": input\.idempotencyKey/);
  assert.match(api, /method: "POST"/);
});

test('only rejected or conflict requests without an existing child can be corrected', () => {
  assert.match(runtime, /request\.status === "rejected" \|\| request\.status === "conflict"/);
  assert.match(runtime, /!request\.resubmittedToRequestId/);
  assert.match(runtime, /Corrigir e reenviar/);
  assert.match(runtime, /Reenviar correção/);
});
