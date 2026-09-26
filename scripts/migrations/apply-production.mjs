import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  PRODUCTION_DATABASE_ID,
  PRODUCTION_DATABASE_NAME,
  REPORT_VERSION,
  WRANGLER_VERSION,
  assertApprovalToken,
  assertAuditMatchesCurrent,
  buildApproval,
  captureTimeTravelBookmark,
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
  runWranglerApply,
  safeError,
  writeJsonReport,
} from './production-migration-lib.mjs';

const args = parseNamedArgs(process.argv.slice(2), new Set(['migration', 'audit-report', 'approval', 'report']));
if (!args.migration) throw gateError('MIGRATION_REQUIRED', '--migration é obrigatório.');
if (!args['audit-report']) throw gateError('AUDIT_REPORT_REQUIRED', '--audit-report é obrigatório.');
if (!args.approval) throw gateError('PRODUCTION_AUTHORIZATION_REQUIRED', '--approval é obrigatório e deve vir de autorização humana explícita.');

let preflightTemporary;
let applyTemporary;
let applyStarted = false;
let applyCompleted = false;
let backup = null;
let reportPath = null;
let migration = null;
let git = null;

try {
  const { accountId } = requireCloudflareEnvironment();
  migration = await ensureMigrationFile(args.migration);
  git = await readGitSnapshot();
  if (!git.clean) {
    throw gateError('GIT_TREE_NOT_CLEAN', 'A aplicação de produção exige worktree limpo.');
  }

  let audit;
  try {
    audit = JSON.parse(await readFile(resolve(args['audit-report']), 'utf8'));
  } catch {
    throw gateError('AUDIT_REPORT_UNREADABLE', 'Não foi possível ler o relatório de audit informado.');
  }

  preflightTemporary = await makeTemporaryWranglerConfig(accountId);
  const remote = await readRemoteState(preflightTemporary.configPath, migration.name);
  const approval = buildApproval({
    migration: migration.name,
    migrationSha256: migration.sha256,
    gitSha: git.sha,
    pendingDigest: remote.pending.pendingDigest,
    databaseId: remote.identity.id,
  });

  assertAuditMatchesCurrent(audit, {
    databaseName: remote.identity.name,
    databaseId: remote.identity.id,
    migration: migration.name,
    migrationSha256: migration.sha256,
    gitSha: git.sha,
    gitClean: git.clean,
    pendingDigest: remote.pending.pendingDigest,
    selectedPending: remote.pending.selectedPending,
    approvalHash: approval.approvalHash,
  });
  assertApprovalToken(args.approval, approval.token);

  const preIntegrity = await queryIntegrity(preflightTemporary.configPath);
  if (!preIntegrity.quickCheckOk || !preIntegrity.foreignKeyCheckOk) {
    throw gateError('DATABASE_INTEGRITY_FAILED', 'A integridade do D1 mudou desde o audit; aplicação bloqueada.');
  }

  // Capture a fresh recovery point immediately before the only remote write.
  backup = await captureTimeTravelBookmark(preflightTemporary.configPath);

  // Critical safety property: the config used for `migrations apply` contains
  // exactly one SQL file, the explicitly authorized migration. The repository's
  // complete migrations directory is never passed to the write command.
  applyTemporary = await makeTemporaryWranglerConfig(accountId, { isolatedMigration: migration });
  applyStarted = true;
  const applyResult = await runWranglerApply(applyTemporary.configPath);
  applyCompleted = true;

  const postLedger = await queryLedger(preflightTemporary.configPath);
  const applied = postLedger.find((row) => row.name === migration.name) || null;
  if (!applied) {
    throw gateError('POST_APPLY_LEDGER_MISSING', 'O Wrangler retornou sucesso, mas a migration não apareceu no ledger remoto. Interrompa e investigue.');
  }
  const postIntegrity = await queryIntegrity(preflightTemporary.configPath);
  if (!postIntegrity.quickCheckOk || !postIntegrity.foreignKeyCheckOk) {
    throw gateError('POST_APPLY_INTEGRITY_FAILED', 'A migration consta aplicada, mas a validação de integridade falhou. Use o bookmark registrado para investigação/recuperação.');
  }

  await ensureReportDir();
  reportPath = args.report ? resolve(args.report) : defaultPostReportPath(migration.name, git.sha);
  const report = {
    reportVersion: REPORT_VERSION,
    phase: 'apply-and-postvalidate',
    generatedAt: new Date().toISOString(),
    wranglerVersion: WRANGLER_VERSION,
    database: {
      name: PRODUCTION_DATABASE_NAME,
      id: PRODUCTION_DATABASE_ID,
      verified: true,
    },
    git,
    migration: {
      name: migration.name,
      sha256: migration.sha256,
      appliedAt: applied.appliedAt,
      risk: migration.analysis.risk,
      operations: migration.analysis.operations,
    },
    authorization: {
      auditReport: resolve(args['audit-report']),
      hash: approval.approvalHash,
      tokenMatched: true,
    },
    backup: {
      ...backup,
      source: 'wrangler_d1_time_travel_info_before_apply',
    },
    isolation: {
      selectedMigrationOnly: true,
      repositoryMigrationsDirectoryPassedToApply: false,
      earlierPendingAtAuthorization: remote.pending.earlierPending,
      pendingDigestAtAuthorization: remote.pending.pendingDigest,
    },
    preIntegrity,
    postIntegrity,
    writesPerformed: true,
    complete: true,
    ok: true,
    applyOutput: applyResult.stdout.trim().slice(-4000),
  };
  await writeJsonReport(reportPath, report);

  process.stdout.write([
    '============================================================',
    'PRODUCTION MIGRATION APPLIED AND VALIDATED',
    '============================================================',
    `Database: ${PRODUCTION_DATABASE_NAME} (${PRODUCTION_DATABASE_ID})`,
    `Migration: ${migration.name}`,
    `Migration SHA256: ${migration.sha256}`,
    `Git SHA: ${git.sha}`,
    `D1 ledger applied_at: ${applied.appliedAt ?? 'present'}`,
    `Recovery bookmark: ${backup.bookmark}`,
    `Integrity: quick_check=${postIntegrity.quickCheck}; foreign_key_violations=${postIntegrity.foreignKeyViolations.length}`,
    `Post report: ${reportPath}`,
    '',
    'No other migration was included in the apply migrations_dir.',
    'A new migration requires a new audit and new explicit authorization.',
    '============================================================',
    '',
  ].join('\n'));
} catch (error) {
  const safe = safeError(error);
  const failure = {
    ok: false,
    complete: false,
    phase: 'apply-and-postvalidate',
    migration: migration?.name || args.migration,
    gitSha: git?.sha || null,
    applyStarted,
    applyCompleted,
    writesMayHaveOccurred: applyStarted,
    backup,
    error: safe,
  };
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await applyTemporary?.cleanup().catch(() => {});
  await preflightTemporary?.cleanup().catch(() => {});
}
