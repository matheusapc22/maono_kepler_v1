import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { restoreAdminOwnerError } from './helpers/admin-owner-error-preservation.mjs';
import { restoreAdminUserAtomicity } from './helpers/admin-user-atomicity-preservation.mjs';
import { errorResponse } from '../functions/_lib/http.js';
import { normalizeMaonoError } from '../functions/_lib/maono-error.js';
import { ApiError } from '../src/lib/error-contract.ts';
import { normalizeUserError } from '../src/lib/user-error-catalog.ts';

for (const [message, driverCode] of [
  ['MANAGEMENT_OWNER_REASSIGN_REQUIRED', 'ERR_SQLITE_ERROR'],
  ['D1_ERROR: MANAGEMENT_OWNER_REASSIGN_REQUIRED: SQLITE_CONSTRAINT', 'ADMIN_USER_ERROR'],
]) test(`recognized owner constraint becomes a safe non-retryable conflict: ${driverCode}`, async () => {
  const response = errorResponse(message, 500, driverCode, { sql: 'private-sql' }, { correlationId: 'owner-conflict-reference' });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'MANAGEMENT_OWNER_REASSIGN_REQUIRED');
  assert.equal(body.error.category, 'PERMISSION');
  assert.equal(body.error.retryable, false);
  assert.equal(body.error.correlationId, 'owner-conflict-reference');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(body.error.message, /responsável principal/);
  assert.doesNotMatch(JSON.stringify(body), /private-sql|SQLITE|D1_ERROR|ERR_SQLITE/);
});

test('other database failures and explicit access denial keep their original classification', () => {
  for (const message of ['FOREIGN KEY constraint failed', 'D1_ERROR: other failure: SQLITE_CONSTRAINT', 'prefix MANAGEMENT_OWNER_REASSIGN_REQUIRED suffix']) {
    const result = normalizeMaonoError({ message, code: 'ERR_SQLITE_ERROR', status: 500 });
    assert.equal(result.status, 500);
    assert.equal(result.code, 'ERR_SQLITE_ERROR');
  }
  for (const status of [{ status: 403 }, { statusCode: 403 }]) {
    const denied = normalizeMaonoError({ message: 'MANAGEMENT_OWNER_REASSIGN_REQUIRED', code: 'FORBIDDEN', ...status });
    assert.equal(denied.status, 403);
    assert.equal(denied.code, 'FORBIDDEN');
  }
});

test('the user sees reassignment guidance instead of another-owner or retry advice', () => {
  const result = normalizeUserError(new ApiError({
    status: 409, code: 'MANAGEMENT_OWNER_REASSIGN_REQUIRED', category: 'PERMISSION', retryable: false,
  }, null, 'unsafe technical message'));
  assert.match(result.message, /responsável principal/);
  assert.match(result.message, /Gestão de Organizações/);
  assert.equal(result.retryable, false);
  assert.notEqual(result.action, 'retry');
  assert.doesNotMatch(result.message, /unsafe technical message/);
});

test('the error adapter preserves the composed predecessor and rejects a weakened response', () => {
  const path = 'functions/_lib/organizations.js';
  const source = restoreAdminUserAtomicity(path, readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
  // Independently captured from git show cb41163:functions/_lib/organizations.js.
  assert.equal(createHash('sha256').update(restoreAdminOwnerError(path, source)).digest('hex'), '72ebafba73f1ae22b4d2d76be3a8876042a8f3cf6c337c2469e6e87462a1c575');
  const changed = source.replace('errorResponse(managementError.message, 409', 'errorResponse(managementError.message, 200');
  assert.notEqual(changed, source);
  assert.throws(() => restoreAdminOwnerError(path, changed), /exact manager conflict translation/);
  const catalogPath = 'src/lib/user-error-catalog.ts';
  const catalog = readFileSync(new URL('../' + catalogPath, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(restoreAdminOwnerError(catalogPath, catalog)).digest('hex'), '5abab4bb448a89d6929c3083c02debda912f0039fcf5fd050159126ebc3f8f12');
  const changedCatalog = catalog.replace('severity: "warning", retryable: false,\n  },', 'severity: "warning", retryable: true,\n  },');
  assert.notEqual(changedCatalog, catalog);
  assert.throws(() => restoreAdminOwnerError(catalogPath, changedCatalog), /exact manager conflict translation/);
});
