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
