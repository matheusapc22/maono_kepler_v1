import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseBasicHealth, basicHealthSummary } from '../src/pages/Admin/components/admin-system-model.ts';
import { onRequest } from '../functions/api/health.js';
import { restoreApprovedAdminWorkspace, adminWorkspaceBaseline } from './helpers/admin-workspace-preservation.mjs';

const full = { dbBinding: true, databaseReachable: true, dropboxAppKey: true, dropboxAppSecret: true, dropboxRefreshToken: true };
test('basic health preserves booleans including a legitimate ok:false result', () => {
  assert.deepEqual(parseBasicHealth({ ok: true, checks: full }), full);
  assert.match(basicHealthSummary(parseBasicHealth({ ok: false, checks: { ...full, dropboxAppKey: false } })), /não confirmadas/);
  assert.equal(basicHealthSummary(full), 'Verificações básicas confirmadas.');
});
test('missing and nonboolean checks stay unavailable; arbitrary runtime/secret values never enter the model', () => {
  const result = parseBasicHealth({ ok: true, service: 'SECRET', runtime: { token: 'SECRET' }, checks: { dbBinding: 'SECRET', databaseReachable: 1, custom: 'SECRET' } });
  assert.ok(Object.values(result).every(value => value === null));
  assert.match(basicHealthSummary(result), /Resposta parcial/);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|runtime|custom|service/);
  for (const value of [null, {}, { ok: true, checks: [] }, { ok: 'true', checks: full }]) assert.throws(() => parseBasicHealth(value));
});
test('existing health contract only checks presence and SELECT 1, with no remote storage access', async () => {
  const queries = [];
  const env = { DB: { prepare(sql) { queries.push(sql); return { async first() { return { ok: 1 }; } }; } }, DROPBOX_APP_KEY: 'PRIVATE_KEY', DROPBOX_APP_SECRET: 'PRIVATE_SECRET', DROPBOX_REFRESH_TOKEN: 'PRIVATE_TOKEN' };
  const response = await onRequest({ request: new Request('https://example.test/api/health'), env });
  const data = await response.json();
  assert.equal(response.status, 200); assert.deepEqual(data.checks, full);
  assert.deepEqual(queries, ['SELECT 1 AS ok']); assert.doesNotMatch(JSON.stringify(data), /PRIVATE/);
  assert.equal((await onRequest({ request: new Request('https://example.test/api/health', { method: 'POST' }), env })).status, 405);
  assert.equal(queries.length, 1);
});
test('missing bindings produce false checks, not an assertion of full platform health', async () => {
  const response = await onRequest({ request: new Request('https://example.test/api/health'), env: {} });
  const data = await response.json();
  assert.equal(data.ok, false); assert.ok(Object.values(data.checks).every(value => value === false));
  assert.match(basicHealthSummary(parseBasicHealth(data)), /não confirmadas/);
});
test('system extraction preserves historical Admin logic and never polls or persists diagnostics', () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const source = read('src/pages/Admin.tsx');
  assert.equal(createHash('sha256').update(restoreApprovedAdminWorkspace('src/pages/Admin.tsx', source)).digest('hex'), adminWorkspaceBaseline);
  assert.throws(() => restoreApprovedAdminWorkspace('src/pages/Admin.tsx', source.replace('sessionAvailable={!error}', 'sessionAvailable={true}')));
  const component = read('src/pages/Admin/components/AdminSystem.tsx');
  assert.match(component, /controller.signal.aborted/); assert.match(component, /cache: 'no-store'/);
  assert.match(component, /\[401, 403, 404\].includes\(status\)/);
  assert.doesNotMatch(component, /setInterval|localStorage|sessionStorage|addEventListener|JSON.stringify|dangerouslySetInnerHTML/);
  assert.match(component, /não certifica a saúde integral/);
});
