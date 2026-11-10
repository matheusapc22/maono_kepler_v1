import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  APPROVAL_PREFIX,
  PRODUCTION_DATABASE_ID,
  PRODUCTION_DATABASE_NAME,
  analyzeMigrationSql,
  assertApprovalToken,
  assertAuditMatchesCurrent,
  buildApproval,
  computePendingState,
  createWranglerConfig,
  normalizeMigrationName,
  rowsFromD1Json,
  runWranglerJson, runWranglerApply, classifyWranglerFailure, safeError, gateError,
  readRemoteState, queryLedger, queryIntegrity, captureTimeTravelBookmark, WRANGLER_VERSION,
} from '../scripts/migrations/production-migration-lib.mjs';

const MIGRATION_HASH = 'a'.repeat(64);
const GIT_SHA = 'b'.repeat(40);
const PENDING_DIGEST = 'c'.repeat(64);

test('migration names are basename-only and versioned SQL', () => {
  assert.equal(normalizeMigrationName('0027_example_change.sql'), '0027_example_change.sql');
  for (const invalid of ['../0027_example.sql', 'migrations/0027_example.sql', 'example.sql', '0027_example.txt', '']) {
    assert.throws(() => normalizeMigrationName(invalid), /formato 0000_nome\.sql/);
  }
});

test('SQL inspection flags row rewrites/destructive changes separately from additive schema', () => {
  const additive = analyzeMigrationSql(`
    ALTER TABLE tickets ADD COLUMN sample TEXT;
    CREATE INDEX IF NOT EXISTS idx_sample ON tickets(sample);
  `);
  assert.equal(additive.risk, 'MEDIUM');
  assert.equal(additive.destructive, false);
  assert.equal(additive.writesExistingRows, false);
  assert.ok(additive.operations.includes('ALTER_TABLE_ADD'));

  const destructive = analyzeMigrationSql('DELETE FROM tickets WHERE active = 0; DROP INDEX idx_old;');
  assert.equal(destructive.risk, 'HIGH');
  assert.equal(destructive.destructive, true);
  assert.equal(destructive.writesExistingRows, true);
});

test('pending state preserves intentionally skipped earlier migrations instead of auto-applying them', () => {
  const local = [
    '0020_old.sql',
    '0024_documents.sql',
    '0025_triage.sql',
    '0026_commands.sql',
    '0027_next.sql',
  ];
  const applied = ['0025_triage.sql', '0026_commands.sql'];
  const state = computePendingState(local, applied, '0027_next.sql');
  assert.deepEqual(state.pending, ['0020_old.sql', '0024_documents.sql', '0027_next.sql']);
  assert.deepEqual(state.earlierPending, ['0020_old.sql', '0024_documents.sql']);
  assert.equal(state.selectedPending, true);
  assert.match(state.pendingDigest, /^[0-9a-f]{64}$/);
});

test('authorization token binds migration hash, git SHA, queue digest and production database', () => {
  const first = buildApproval({
    migration: '0027_example.sql',
    migrationSha256: MIGRATION_HASH,
    gitSha: GIT_SHA,
    pendingDigest: PENDING_DIGEST,
    databaseId: PRODUCTION_DATABASE_ID,
  });
  const second = buildApproval({
    migration: '0027_example.sql',
    migrationSha256: MIGRATION_HASH,
    gitSha: GIT_SHA,
    pendingDigest: 'd'.repeat(64),
    databaseId: PRODUCTION_DATABASE_ID,
  });
  assert.match(first.token, new RegExp(`^${APPROVAL_PREFIX}:0027_example\\.sql:[0-9a-f]{64}$`));
  assert.notEqual(first.token, second.token);
  assert.doesNotThrow(() => assertApprovalToken(first.token, first.token));
  assert.throws(() => assertApprovalToken(second.token, first.token), /não corresponde exatamente/);
});

test('audit drift invalidates authorization before any apply', () => {
  const approval = buildApproval({
    migration: '0027_example.sql',
    migrationSha256: MIGRATION_HASH,
    gitSha: GIT_SHA,
    pendingDigest: PENDING_DIGEST,
    databaseId: PRODUCTION_DATABASE_ID,
  });
  const audit = {
    reportVersion: 1,
    phase: 'audit',
    writesPerformed: false,
    database: { name: PRODUCTION_DATABASE_NAME, id: PRODUCTION_DATABASE_ID },
    git: { sha: GIT_SHA, clean: true },
    migration: { name: '0027_example.sql', sha256: MIGRATION_HASH },
    pending: { digest: PENDING_DIGEST, selectedPending: true },
    approval: { hash: approval.approvalHash },
  };
  const current = {
    databaseName: PRODUCTION_DATABASE_NAME,
    databaseId: PRODUCTION_DATABASE_ID,
    migration: '0027_example.sql',
    migrationSha256: MIGRATION_HASH,
    gitSha: GIT_SHA,
    gitClean: true,
    pendingDigest: PENDING_DIGEST,
    selectedPending: true,
    approvalHash: approval.approvalHash,
  };
  assert.doesNotThrow(() => assertAuditMatchesCurrent(audit, current));
  assert.throws(
    () => assertAuditMatchesCurrent(audit, { ...current, migrationSha256: 'e'.repeat(64) }),
    /Nova auditoria é obrigatória/,
  );
});

test('isolated Wrangler config targets only canonical production D1 and explicit migrations_dir', () => {
  const config = createWranglerConfig('f'.repeat(32), { migrationsDir: 'migrations' });
  assert.equal(config.account_id, 'f'.repeat(32));
  assert.equal(config.d1_databases.length, 1);
  assert.deepEqual(config.d1_databases[0], {
    binding: 'DB',
    database_name: PRODUCTION_DATABASE_NAME,
    database_id: PRODUCTION_DATABASE_ID,
    migrations_dir: 'migrations',
  });
});

test('Wrangler D1 JSON row extraction accepts current common response shapes', () => {
  assert.deepEqual(rowsFromD1Json([{ success: true, results: [{ name: 'x' }] }]), [{ name: 'x' }]);
  assert.deepEqual(rowsFromD1Json({ results: [{ name: 'y' }] }), [{ name: 'y' }]);
});

test('write path never passes repository migrations directory to migrations apply', async () => {
  const source = await readFile(new URL('../scripts/migrations/apply-production.mjs', import.meta.url), 'utf8');
  assert.match(source, /isolatedMigration: migration/);
  assert.match(source, /repositoryMigrationsDirectoryPassedToApply: false/);
  assert.doesNotMatch(source, /migrations apply maono_maps --remote/);
});


test('apply diagnostics classify both CLI streams without exposing raw data', async () => {
  const { runProcess, safeError, gateError } = await import('../scripts/migrations/production-migration-lib.mjs');
  let captured;
  try {
    await runProcess(process.execPath, ['-e', 'process.stdout.write("SQLITE_AUTH not authorized secret-value");process.stderr.write("Bearer private-value");process.exit(1)'],
      { errorCode: 'WRANGLER_APPLY_FAILED', safeMessage: 'Apply failed' });
  } catch (error) { captured = error; }
  const safe = safeError(captured);
  assert.deepEqual(safe.diagnostic.categories, ['SQLITE_AUTH']);
  assert.equal(safe.diagnostic.exitCode, 1);
  assert.equal(safe.diagnostic.stdoutCaptured, true);
  assert.equal(safe.diagnostic.stderrCaptured, true);
  assert.doesNotMatch(JSON.stringify(safe), /secret-value|private-value|Bearer|process.stdout/);
  assert.deepEqual(safeError(gateError('WRANGLER_APPLY_FAILED', 'failed', {stderr:'unknown private response'})).diagnostic.categories, ['UNCLASSIFIED']);
});

test('apply failure evidence is retained separately without retrying writes', async () => {
  const source = await readFile(new URL('../scripts/migrations/apply-production.mjs', import.meta.url), 'utf8');
  const failure = source.slice(source.indexOf('} catch (error) {'));
  assert.match(failure, /writeJsonReport\(failurePath, failure\)/);
  assert.match(failure, /failure\.json/);
  assert.doesNotMatch(failure, /runWranglerApply\(/);
});

const privateDiagnostic = 'PRIVATE_TOKEN Bearer PRIVATE_CREDENTIAL SELECT PRIVATE_SQL /private/path https://private.example.test';
const privateFailure = () => gateError('WRANGLER_COMMAND_FAILED', privateDiagnostic, {
  exitCode: 17, stdout: 'SQLITE_AUTH ' + privateDiagnostic, stderr: 'ETIMEDOUT ' + privateDiagnostic,
  args: [privateDiagnostic], command: privateDiagnostic, stage: privateDiagnostic,
  categories: [privateDiagnostic], response: { privateDiagnostic },
});
const failingReader = { runProcess: async () => { throw privateFailure(); } };
function verifyPrivateDiagnostic(error, stage) {
  const safe = safeError(error);
  assert.equal(safe.code, 'WRANGLER_COMMAND_FAILED');
  assert.equal(safe.diagnostic.stage, stage);
  assert.equal(safe.diagnostic.exitCode, 17);
  assert.deepEqual(safe.diagnostic.categories, ['SQLITE_AUTH', 'NETWORK_TIMEOUT']);
  assert.equal(safe.diagnostic.stdoutCaptured, true);
  assert.equal(safe.diagnostic.stderrCaptured, true);
  assert.doesNotMatch(JSON.stringify(safe), /PRIVATE|Bearer|SELECT|private\.example|\/private\/path|"args"|"response"/);
  return true;
}

test('Wrangler read diagnostics preserve argv, SQL bytes and log suppression without retries', async () => {
  const args = ['d1', 'execute', PRODUCTION_DATABASE_NAME, '--remote', '--command', 'SELECT 1;\n'];
  let calls = 0;
  await assert.rejects(runWranglerJson(args, '/private/config', { runProcess: async (command, actual, options) => {
    calls++;
    assert.equal(command, 'npx');
    assert.deepEqual(actual, ['--yes', `wrangler@${WRANGLER_VERSION}`, ...args, '--config', '/private/config', '--json']);
    assert.deepEqual(options.env, { WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false' });
    throw privateFailure();
  } }, 'D1_QUICK_CHECK'), error => verifyPrivateDiagnostic(error, 'D1_QUICK_CHECK'));
  assert.equal(calls, 1);
  const result = { success: true, results: [{ name: privateDiagnostic }] };
  assert.deepEqual(await runWranglerJson(args, 'fixture', { runProcess: async () => ({ code: 0, stdout: JSON.stringify(result) }) }, 'D1_QUICK_CHECK'), result);
});

for (const [stage, read] of [
  ['D1_INFO', () => readRemoteState('fixture', '0043_organization_creation_identity.sql', failingReader)],
  ['D1_LEDGER', () => queryLedger('fixture', failingReader)],
  ['D1_TIME_TRAVEL_INFO', () => captureTimeTravelBookmark('fixture', failingReader)],
  ['D1_QUICK_CHECK', () => queryIntegrity('fixture', failingReader)],
]) test('read helper attaches its fixed stage: ' + stage, async () => {
  await assert.rejects(read(), error => verifyPrivateDiagnostic(error, stage));
});

test('foreign-key check keeps the original quick-check then foreign-key order', async () => {
  const queries = [];
  await assert.rejects(queryIntegrity('fixture', { runProcess: async (_, args) => {
    queries.push(args[args.indexOf('--command') + 1]);
    if (queries.length === 1) return { stdout: '[{"results":[{"quick_check":"ok"}]}]' };
    throw privateFailure();
  } }), error => verifyPrivateDiagnostic(error, 'D1_FOREIGN_KEY_CHECK'));
  assert.deepEqual(queries, ['PRAGMA quick_check;', 'PRAGMA foreign_key_check;']);
});

for (const cc of ['08', '09', '10', '11', '12', '13', '15']) {
  test('CC schema reader has a fixed stage: ' + cc, async () => {
    const mod = await import(`../scripts/migrations/cc${cc}-schema-preflight.mjs`);
    await assert.rejects(mod[`readCC${cc}Schema`]('fixture', [], failingReader), error => verifyPrivateDiagnostic(error, `CC${cc}_SCHEMA`));
  });
}

test('organization schema, strict ledger and identity snapshot label their own reads', async () => {
  const { readOrganizationSchema, queryOrganizationLedger } = await import('../scripts/migrations/organization-management-schema.mjs');
  const { collectIdentityEvidence, IDENTITY_MIGRATION, IDENTITY_MIGRATION_SHA256 } = await import('../scripts/migrations/organization-identity-0043.mjs');
  await assert.rejects(readOrganizationSchema('fixture', failingReader, []), error => verifyPrivateDiagnostic(error, 'ORGANIZATION_SCHEMA'));
  await assert.rejects(queryOrganizationLedger('fixture', failingReader), error => verifyPrivateDiagnostic(error, 'ORGANIZATION_LEDGER'));
  await assert.rejects(collectIdentityEvidence('fixture', { identity: { name: PRODUCTION_DATABASE_NAME, id: PRODUCTION_DATABASE_ID } },
    { name: IDENTITY_MIGRATION, sha256: IDENTITY_MIGRATION_SHA256 }, 'pre', failingReader), error => verifyPrivateDiagnostic(error, 'ORGANIZATION_IDENTITY_SNAPSHOT'));
});

test('null, primitives and non-string streams never coerce arbitrary objects', () => {
  const hostile = { toString() { throw new Error('Object coercion forbidden'); }, toJSON() { throw new Error('Object serialization forbidden'); } };
  for (const details of [null, undefined, 3, true, 'PRIVATE', Symbol('PRIVATE'), [],
    { stdout: hostile, stderr: hostile, exitCode: hostile, stage: hostile }]) {
    const safe = safeError(gateError('WRANGLER_COMMAND_FAILED', privateDiagnostic, details));
    assert.deepEqual(safe.diagnostic, { exitCode: null, categories: ['UNCLASSIFIED'], stdoutCaptured: false, stderrCaptured: false, stage: 'UNSPECIFIED_READ' });
    assert.doesNotThrow(() => JSON.stringify(safe));
    assert.doesNotMatch(JSON.stringify(safe), /PRIVATE/);
    assert.deepEqual(classifyWranglerFailure(details).categories, ['UNCLASSIFIED']);
  }
});

test('exit codes are numeric integers 0..255 only and stages are revalidated when serialized', async () => {
  for (const value of ['1', '', false, true, NaN, Infinity, -Infinity, 1.5, -1, 256, 2 ** 32, null, undefined, {}, []]) {
    assert.equal(classifyWranglerFailure({ exitCode: value }).exitCode, null);
  }
  for (const value of [0, 1, 17, 255]) assert.equal(classifyWranglerFailure({ exitCode: value }).exitCode, value);
  for (const stage of [privateDiagnostic, 'd1_info', 'MIGRATION_APPLY', null, {}, ['D1_INFO']]) {
    let captured;
    try { await runWranglerJson(['PRIVATE_ARG'], 'PRIVATE_CONFIG', failingReader, stage); } catch (error) { captured = error; }
    captured.details.stage = stage; // Defense in depth against mutation after the wrapper.
    assert.equal(safeError(captured).diagnostic.stage, 'UNSPECIFIED_READ');
    assert.doesNotMatch(JSON.stringify(safeError(captured)), /PRIVATE/);
  }
});

test('spawn failures and empty/invalid JSON keep their stage and fixed safe messages', async () => {
  for (const [code, runner] of [
    ['WRANGLER_COMMAND_FAILED', async () => { throw Object.assign(new Error(privateDiagnostic), { code: 'ENOENT', path: privateDiagnostic }); }],
    ['WRANGLER_EMPTY_JSON', async () => ({ code: 0, stdout: ' \n', stderr: privateDiagnostic })],
    ['WRANGLER_INVALID_JSON', async () => ({ code: 0, stdout: '<html>' + privateDiagnostic, stderr: privateDiagnostic })],
    ['WRANGLER_INVALID_JSON', async () => ({ code: 0, stdout: { privateDiagnostic }, stderr: { privateDiagnostic } })],
  ]) {
    await assert.rejects(runWranglerJson(['PRIVATE_ARG'], 'PRIVATE_CONFIG', { runProcess: runner }, 'D1_INFO'), error => {
      const safe = safeError(error);
      assert.equal(safe.code, code); assert.equal(safe.diagnostic.stage, 'D1_INFO');
      assert.doesNotMatch(JSON.stringify(safe), /PRIVATE|Bearer|private\.example/);
      assert.equal(safe.diagnostic.exitCode, code === 'WRANGLER_COMMAND_FAILED' ? null : 0);
      return true;
    });
  }
});

test('apply keeps capture booleans and uncertainty-compatible diagnostics with a fixed message', async () => {
  let calls = 0;
  await assert.rejects(runWranglerApply('PRIVATE_CONFIG', { runProcess: async (_, args, options) => {
    calls++; assert.ok(args.includes('apply')); assert.equal(options.env.WRANGLER_WRITE_LOGS, 'false');
    throw gateError('WRANGLER_APPLY_FAILED', privateDiagnostic, { exitCode: 1, stdout: privateDiagnostic, stderr: 'constraint failed', stage: privateDiagnostic });
  } }), error => {
    const safe = safeError(error);
    assert.equal(safe.diagnostic.stage, 'MIGRATION_APPLY');
    assert.deepEqual(safe.diagnostic.categories, ['SQLITE_CONSTRAINT']);
    assert.equal(safe.diagnostic.stdoutCaptured, true); assert.equal(safe.diagnostic.stderrCaptured, true);
    assert.doesNotMatch(JSON.stringify(safe), /PRIVATE|Bearer|private\.example/); return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(classifyWranglerFailure({ stderr: 'Unknown arguments: PRIVATE_SQL --PRIVATE_ARG' }).categories, ['CLI_ARGUMENT']);
});
