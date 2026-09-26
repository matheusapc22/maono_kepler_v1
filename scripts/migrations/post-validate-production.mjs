import { resolve } from 'node:path';
import {
  PRODUCTION_DATABASE_ID,
  PRODUCTION_DATABASE_NAME,
  REPORT_VERSION,
  WRANGLER_VERSION,
  defaultPostReportPath,
  ensureMigrationFile,
  ensureReportDir,
  gateError,
  makeTemporaryWranglerConfig,
  parseNamedArgs,
  queryIntegrity,
  queryLedger,
  readGitSnapshot,
  readRemoteState,
  requireCloudflareEnvironment,
  safeError,
  writeJsonReport,
} from './production-migration-lib.mjs';

const args = parseNamedArgs(process.argv.slice(2), new Set(['migration', 'report']));
if (!args.migration) throw gateError('MIGRATION_REQUIRED', '--migration é obrigatório.');

let temporary;
try {
  const { accountId } = requireCloudflareEnvironment();
  const migration = await ensureMigrationFile(args.migration);
  const git = await readGitSnapshot();
  temporary = await makeTemporaryWranglerConfig(accountId);
  const remote = await readRemoteState(temporary.configPath, migration.name);
  const ledger = await queryLedger(temporary.configPath);
  const applied = ledger.find((row) => row.name === migration.name) || null;
  const integrity = await queryIntegrity(temporary.configPath);
  const ok = Boolean(applied && integrity.quickCheckOk && integrity.foreignKeyCheckOk);

  await ensureReportDir();
  const reportPath = args.report ? resolve(args.report) : defaultPostReportPath(migration.name, git.sha);
  const report = {
    reportVersion: REPORT_VERSION,
    phase: 'postvalidate-read-only',
    generatedAt: new Date().toISOString(),
    wranglerVersion: WRANGLER_VERSION,
    writesPerformed: false,
    database: { name: remote.identity.name, id: remote.identity.id, verified: true },
    git,
    migration: {
      name: migration.name,
      sha256: migration.sha256,
      applied: Boolean(applied),
      appliedAt: applied?.appliedAt || null,
      stillPendingLocallyAgainstLedger: remote.pending.selectedPending,
    },
    integrity,
    ok,
  };
  await writeJsonReport(reportPath, report);

  process.stdout.write([
    '============================================================',
    'PRODUCTION MIGRATION POST-VALIDATION (READ ONLY)',
    '============================================================',
    `Database: ${PRODUCTION_DATABASE_NAME} (${PRODUCTION_DATABASE_ID})`,
    `Migration: ${migration.name}`,
    `Ledger: ${applied ? `APPLIED (${applied.appliedAt ?? 'timestamp unavailable'})` : 'NOT APPLIED'}`,
    `Integrity: quick_check=${integrity.quickCheck}; foreign_key_violations=${integrity.foreignKeyViolations.length}`,
    `Result: ${ok ? 'PASS' : 'FAIL'}`,
    `Report: ${reportPath}`,
    'Writes performed by this command: NO',
    '============================================================',
    '',
  ].join('\n'));

  if (!ok) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, writesPerformed: false, error: safeError(error) }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await temporary?.cleanup().catch(() => {});
}
